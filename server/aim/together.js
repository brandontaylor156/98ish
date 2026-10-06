// Watch & Listen Together: a shared YouTube player for an IM conversation or a chat room.
// The videos play in each person's own YouTube player (the official embed); this only
// relays who controls what: the queue, play/pause, the position, the speed. Nothing is
// saved: a session lives in memory while people are in it.
//
// The server keeps the truth as { playing, pos, rate, at }: the position `pos` (seconds) at
// server time `at` (ms). Anyone's expected position right now is
//   pos + (now - at) / 1000 * rate   (while playing)
// and each player corrects itself toward that (client: applets/together/syncCore.js).
//
// client -> server (all acked with { ok, ... })
//   tg:start { with | room, video?, title?, start? }  -> { ok, id, state, now } (an open session
//                                       for the same conversation is joined instead)
//   tg:join { id }                      -> { ok, state, chat, now }
//   tg:leave { id }
//   tg:end { id }                       host only: ends it for everyone
//   tg:cmd { id, op, pos?, rate?, index? }  op: play | pause | seek | rate | select | next | prev | ended
//   tg:queue { id, op, video?, title?, item?, to? }  op: add | remove | move
//   tg:settings { id, anyone }          host only: can everyone control (default yes)
//   tg:react { id, emoji }              floats over everyone's video
//   tg:say { id, text }                 the chat strip under the video
//   tg:time {}                          -> { ok, now } (clients estimate their clock offset)
//   tg:mine {}                          -> { ok, sessions: [...] } open sessions you can join
//   tg:vc { id, on }                    -> { ok, on: [key], ice }   voice chat on/off
//   tg:sig { id, to, kind, data }       a voice connection message (server/voice/relay.js; the
//                                       audio goes browser to browser, never through here)
// server -> client
//   tg:invite { id, from, with?, room?, title }   tg:state { id, ...state }
//   tg:react { id, from, emoji }   tg:say { id, line }   tg:end { id, reason }
//   tg:vc { room: id, on: [key] }   tg:sig { room: id, from, kind, data }
//
// Who may join: in an IM session the two people in the conversation (neither blocking the
// other); in a chat-room session whoever is in that room right now.

const crypto = require("crypto")
const { validate, normalize } = require("./screenNames")
const { createVoiceRelay } = require("../voice/relay")

const MAX_SESSIONS = 300 // all of them, server-wide (each is a few KB of memory)
const MAX_HOSTED = 3 // per person
const MAX_QUEUE = 100
const MAX_CHAT_KEPT = 30 // for people who join late
const MAX_TEXT = 200
const MAX_TITLE = 100
const MAX_PEOPLE = 20 // chat rooms can be big
const LOST_MS = 20_000 // a dropped connection (a phone asleep) keeps its place this long
const EMPTY_MS = 60_000 // a session nobody's in waits this long for someone to come back
const IDLE_MS = 6 * 3600_000 // nothing happened at all
const COMMANDS_PER_10S = 40
const CHAT_PER_10S = 8
const REACTS_PER_10S = 20
const STARTS_PER_MINUTE = 6
const REACTIONS = ["❤️", "😂", "😮", "👏", "🔥", "😢", "👍", "🎉"]
const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const cleanText = (value, max) =>
  String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, max)
const cleanPos = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n < 48 * 3600 ? n : null
}

const createTogether = ({ sessions, hidden, emitTo, limiter, rooms, botKey = null, pushTo = null, ice = null, now = () => Date.now(), lostMs = LOST_MS, emptyMs = EMPTY_MS, idleMs = IDLE_MS }) => {
  const voice = createVoiceRelay({ prefix: "tg", emit: (key, event, payload) => emitTo(key, event, payload), now, maxPerRoom: 8 })
  const live = new Map() // id -> session
  const byConv = new Map() // "im:a|b" or "room:<key>" -> id
  const cmdLimited = limiter(COMMANDS_PER_10S, 10_000)
  const chatLimited = limiter(CHAT_PER_10S, 10_000)
  const reactLimited = limiter(REACTS_PER_10S, 10_000)
  const startLimited = limiter(STARTS_PER_MINUTE, 60_000)

  const nameOf = (key) => sessions.get(key)?.user.screenName || key

  const position = (s, at = now()) => (s.playing ? s.pos + ((at - s.at) / 1000) * s.rate : s.pos)
  // re-anchor the clock at "now" (before changing playing/rate)
  const anchor = (s, pos = position(s)) => {
    s.pos = Math.max(0, pos)
    s.at = now()
  }

  const view = (s) => ({
    id: s.id,
    host: nameOf(s.host),
    hostKey: s.host,
    kind: s.room ? "room" : "im",
    with: s.room ? null : s.members.map(nameOf),
    room: s.room ? s.roomName : null,
    people: [...s.joined.keys()].map((k) => ({ name: nameOf(k), key: k, away: !!s.joined.get(k).lostTimer })),
    queue: s.queue,
    index: s.index,
    playing: s.playing,
    pos: s.pos,
    at: s.at,
    rate: s.rate,
    anyone: s.anyone,
    rev: s.rev,
  })

  const broadcast = (s, event, payload) => {
    for (const key of s.joined.keys()) emitTo(key, event, payload)
  }
  const changed = (s) => {
    s.rev++
    s.touched = now()
    broadcast(s, "tg:state", view(s))
  }

  const mayJoin = (s, session) => {
    if (s.room) {
      const room = rooms.get(s.room)
      return !!room?.members.has(session.key)
    }
    if (!s.members.includes(session.key)) return false
    const other = sessions.get(s.members.find((k) => k !== session.key))
    return !other || !hidden(session, other)
  }

  const end = (s, reason) => {
    if (live.get(s.id) !== s) return
    clearTimeout(s.emptyTimer)
    for (const entry of s.joined.values()) clearTimeout(entry.lostTimer)
    broadcast(s, "tg:end", { id: s.id, reason })
    voice.drop(s.id)
    live.delete(s.id)
    if (byConv.get(s.conv) === s.id) byConv.delete(s.conv)
  }

  // the host left: the person who's been there longest takes over
  const handOff = (s) => {
    const next = [...s.joined.entries()].filter(([, e]) => !e.lostTimer).sort((a, b) => a[1].since - b[1].since)[0] || [...s.joined.entries()].sort((a, b) => a[1].since - b[1].since)[0]
    if (next) s.host = next[0]
  }

  const remove = (s, key) => {
    const entry = s.joined.get(key)
    if (!entry) return
    clearTimeout(entry.lostTimer)
    s.joined.delete(key)
    voice.set(s.id, key, false)
    if (s.host === key) handOff(s)
    if (s.joined.size === 0) {
      clearTimeout(s.emptyTimer)
      s.emptyTimer = setTimeout(() => end(s, "empty"), emptyMs)
      return
    }
    changed(s)
  }

  const add = (s, session) => {
    clearTimeout(s.emptyTimer)
    const entry = s.joined.get(session.key)
    if (entry) {
      clearTimeout(entry.lostTimer)
      entry.lostTimer = null
    } else s.joined.set(session.key, { since: now(), lostTimer: null })
    if (!s.joined.has(s.host)) s.host = session.key
    changed(s)
  }

  const find = (session, id) => {
    const s = live.get(String(id || ""))
    return s && s.joined.has(session.key) ? s : null
  }
  const canControl = (s, key) => s.anyone || s.host === key

  const cleanItem = (session, video, title) => {
    const v = String(video || "")
    if (!VIDEO_ID.test(v)) return null
    return { id: crypto.randomBytes(6).toString("hex"), v, title: cleanText(title, MAX_TITLE) || "YouTube video", by: session.user.screenName }
  }

  // jump to a queue item from its start
  const select = (s, index) => {
    if (index < 0 || index >= s.queue.length) return false
    s.index = index
    s.pos = 0
    s.at = now()
    s.playing = true
    return true
  }

  const sweep = () => {
    const t = now()
    for (const s of live.values()) if (t - s.touched > idleMs) end(s, "idle")
  }
  const sweeper = setInterval(sweep, 10 * 60_000)
  sweeper.unref?.()

  const invite = (s, session) => {
    const title = s.queue[s.index]?.title || ""
    const payload = { id: s.id, from: session.user.screenName, title, ...(s.room ? { room: s.roomName } : { with: session.user.screenName }) }
    const targets = s.room ? [...(rooms.get(s.room)?.members || [])] : s.members
    for (const key of targets) {
      if (key === session.key) continue
      const other = sessions.get(key)
      if (other && hidden(session, other)) continue
      if (other?.socket) emitTo(key, "tg:invite", payload)
      // away from 98ish (or signed off): a notification (Do Not Disturb holds it)
      if (pushTo)
        pushTo(key, "im", {
          title: s.room ? `${session.user.screenName} in ${s.roomName}` : session.user.screenName,
          body: `Watch Together${title ? `: ${title}` : ""}. Tap to join.`,
          tag: `tg-${s.id}`,
          key: `tg:${s.id}`,
          app: "im",
          url: `/?open=program&name=${encodeURIComponent("Watch Together")}&together=${s.id}`,
        })
    }
  }

  const bind = (on) => {
    on("tg:vc", async (session, { id, on: want }, ack) => {
      const s = find(session, id)
      if (!s) return ack({ ok: false, error: "You're not watching that." })
      const r = voice.set(s.id, session.key, !!want)
      if (!r.ok || !want) return ack(r)
      const cfg = ice ? await ice.config().catch(() => null) : null
      ack({ ...r, ice: cfg || { iceServers: [{ urls: "stun:stun.l.google.com:19302" }], turn: false } })
    })
    on("tg:sig", (session, { id, to, kind, data }, ack) => {
      const s = find(session, id)
      if (!s || typeof to !== "string") return ack({ ok: false, error: "You're not watching that." })
      const a = sessions.get(session.key)
      const b = sessions.get(to)
      if (a && b && hidden(a, b)) return ack({ ok: false, error: "They don't have voice on." })
      ack(voice.signal(s.id, session.key, to, { kind, data }))
    })
    on("tg:time", (session, payload, ack) => ack({ ok: true, now: now() }))

    on("tg:mine", (session, payload, ack) => {
      const list = [...live.values()].filter((s) => mayJoin(s, session)).map((s) => ({ id: s.id, host: nameOf(s.host), room: s.room ? s.roomName : null, with: s.room ? null : s.members.map(nameOf), title: s.queue[s.index]?.title || "", people: s.joined.size, joined: s.joined.has(session.key) }))
      ack({ ok: true, sessions: list })
    })

    on("tg:start", (session, { with: withName, room, video, title, start }, ack) => {
      let conv
      let members = null
      let roomKey = null
      let roomName = null
      if (room) {
        roomKey = normalize(cleanText(room, 32))
        const r = rooms.get(roomKey)
        if (!r?.members.has(session.key)) return ack({ ok: false, error: "Join the chat room first." })
        conv = `room:${roomKey}`
        roomName = r.name
      } else {
        const target = validate(withName)
        if (target.error) return ack({ ok: false, error: "Invalid screen name." })
        if (target.key === session.key) return ack({ ok: false, error: "Pick a buddy to watch with." })
        if (target.key === botKey) return ack({ ok: false, error: "SmarterChild doesn't have eyes. Pick a buddy to watch with! :-)" })
        const other = sessions.get(target.key)
        if (other && hidden(session, other)) return ack({ ok: false, error: `${target.screenName} is not currently signed on.` })
        members = [session.key, target.key].sort()
        conv = `im:${members.join("|")}`
      }
      const item = video ? cleanItem(session, video, title) : null
      if (video && !item) return ack({ ok: false, error: "That isn't a YouTube link." })

      // already watching together in this conversation: join that one (and add the video)
      const existing = live.get(byConv.get(conv))
      if (existing) {
        add(existing, session)
        if (item && existing.queue.length < MAX_QUEUE) {
          existing.queue.push(item)
          if (existing.queue.length === 1) select(existing, 0)
          changed(existing)
        }
        return ack({ ok: true, id: existing.id, state: view(existing), chat: existing.chat, now: now(), joined: true })
      }
      if (startLimited(session.key)) return ack({ ok: false, error: "Slow down a little and try again in a minute." })
      if (live.size >= MAX_SESSIONS) return ack({ ok: false, error: "Watch Together is full right now. Try again later." })
      if ([...live.values()].filter((s) => s.host === session.key).length >= MAX_HOSTED) return ack({ ok: false, error: "Close one of your Watch Together sessions first." })

      const s = {
        id: crypto.randomBytes(10).toString("hex"),
        conv,
        host: session.key,
        members,
        room: roomKey,
        roomName,
        joined: new Map(),
        queue: item ? [item] : [],
        index: 0,
        playing: false,
        pos: Math.min(cleanPos(start) || 0, 24 * 3600),
        at: now(),
        rate: 1,
        anyone: true,
        chat: [],
        rev: 0,
        touched: now(),
        emptyTimer: null,
      }
      live.set(s.id, s)
      byConv.set(conv, s.id)
      add(s, session)
      invite(s, session)
      ack({ ok: true, id: s.id, state: view(s), chat: [], now: now() })
    })

    on("tg:join", (session, { id }, ack) => {
      const s = live.get(String(id || ""))
      if (!s) return ack({ ok: false, error: "That Watch Together session has ended.", ended: true })
      if (!mayJoin(s, session)) return ack({ ok: false, error: s.room ? `Join the chat room ${s.roomName} to watch with them.` : "That Watch Together session isn't for you." })
      if (!s.joined.has(session.key) && s.joined.size >= MAX_PEOPLE) return ack({ ok: false, error: "That session is full." })
      add(s, session)
      ack({ ok: true, id: s.id, state: view(s), chat: s.chat, now: now() })
    })

    on("tg:leave", (session, { id }, ack) => {
      const s = find(session, id)
      if (s) remove(s, session.key)
      ack({ ok: true })
    })

    on("tg:end", (session, { id }, ack) => {
      const s = find(session, id)
      if (!s) return ack({ ok: false })
      if (s.host !== session.key) return ack({ ok: false, error: "Only the host can end it for everyone." })
      end(s, "ended")
      ack({ ok: true })
    })

    on("tg:cmd", (session, { id, op, pos, rate, index }, ack) => {
      const s = find(session, id)
      if (!s) return ack({ ok: false, error: "That Watch Together session has ended." })
      if (cmdLimited(session.key)) return ack({ ok: false, error: "Too many changes at once." })
      // the video ending is reported by everyone's player: only the first report for the
      // item that's playing counts
      if (op === "ended") {
        if (index !== s.index) return ack({ ok: true, stale: true })
        if (s.index + 1 < s.queue.length) select(s, s.index + 1)
        else {
          anchor(s, cleanPos(pos) ?? position(s))
          s.playing = false
        }
        changed(s)
        return ack({ ok: true })
      }
      if (!canControl(s, session.key)) return ack({ ok: false, error: `Only ${nameOf(s.host)} can control the video.` })
      const p = cleanPos(pos)
      switch (op) {
        case "play":
          if (!s.queue.length) return ack({ ok: false, error: "Add a video first." })
          anchor(s, p ?? position(s))
          s.playing = true
          break
        case "pause":
          anchor(s, p ?? position(s))
          s.playing = false
          break
        case "seek":
          if (p === null) return ack({ ok: false })
          anchor(s, p)
          break
        case "rate": {
          const r = Number(rate)
          if (!RATES.includes(r)) return ack({ ok: false })
          anchor(s)
          s.rate = r
          break
        }
        case "select":
          if (!select(s, Number(index))) return ack({ ok: false })
          break
        case "next":
          if (!select(s, s.index + 1)) return ack({ ok: false, error: "That's the last video." })
          break
        case "prev":
          // early in a video: the one before; later: back to the start
          if (position(s) > 5 || s.index === 0) anchor(s, 0)
          else select(s, s.index - 1)
          break
        default:
          return ack({ ok: false })
      }
      changed(s)
      ack({ ok: true })
    })

    on("tg:queue", (session, { id, op, video, title, item, to }, ack) => {
      const s = find(session, id)
      if (!s) return ack({ ok: false, error: "That Watch Together session has ended." })
      if (cmdLimited(session.key)) return ack({ ok: false, error: "Too many changes at once." })
      if (op === "add") {
        const entry = cleanItem(session, video, title)
        if (!entry) return ack({ ok: false, error: "That isn't a YouTube link." })
        if (s.queue.length >= MAX_QUEUE) return ack({ ok: false, error: `Up Next holds ${MAX_QUEUE} videos.` })
        s.queue.push(entry)
        // the first video starts right away
        if (s.queue.length === 1) select(s, 0)
        changed(s)
        return ack({ ok: true, item: entry })
      }
      if (!canControl(s, session.key)) return ack({ ok: false, error: `Only ${nameOf(s.host)} can change Up Next.` })
      const at = s.queue.findIndex((q) => q.id === item)
      if (at < 0) return ack({ ok: false })
      if (op === "remove") {
        s.queue.splice(at, 1)
        if (at < s.index) s.index--
        else if (at === s.index) {
          // removing what's playing: the next one plays (or nothing)
          if (s.index >= s.queue.length) {
            s.index = Math.max(0, s.queue.length - 1)
            s.playing = false
            anchor(s, 0)
          } else select(s, s.index)
        }
      } else if (op === "move") {
        const dest = Math.max(0, Math.min(s.queue.length - 1, Number(to) | 0))
        const current = s.queue[s.index]
        const [moved] = s.queue.splice(at, 1)
        s.queue.splice(dest, 0, moved)
        s.index = s.queue.indexOf(current)
      } else return ack({ ok: false })
      changed(s)
      ack({ ok: true })
    })

    on("tg:settings", (session, { id, anyone }, ack) => {
      const s = find(session, id)
      if (!s) return ack({ ok: false })
      if (s.host !== session.key) return ack({ ok: false, error: "Only the host can change that." })
      s.anyone = anyone !== false
      changed(s)
      ack({ ok: true })
    })

    on("tg:react", (session, { id, emoji }, ack) => {
      const s = find(session, id)
      if (!s || !REACTIONS.includes(emoji)) return ack({ ok: false })
      if (reactLimited(session.key)) return ack({ ok: false })
      s.touched = now()
      broadcast(s, "tg:react", { id: s.id, from: session.user.screenName, emoji })
      ack({ ok: true })
    })

    on("tg:say", (session, { id, text }, ack) => {
      const s = find(session, id)
      const t = cleanText(text, MAX_TEXT)
      if (!s || !t) return ack({ ok: false })
      if (chatLimited(session.key)) return ack({ ok: false, error: "You're typing too fast." })
      const line = { from: session.user.screenName, text: t, time: now() }
      s.chat = [...s.chat, line].slice(-MAX_CHAT_KEPT)
      s.touched = now()
      broadcast(s, "tg:say", { id: s.id, line })
      ack({ ok: true })
    })
  }

  // connection trouble and signing off
  const dropped = (key) => {
    for (const s of live.values()) {
      const entry = s.joined.get(key)
      if (!entry || entry.lostTimer) continue
      entry.lostTimer = setTimeout(() => {
        entry.lostTimer = null
        remove(s, key)
      }, lostMs)
      changed(s)
    }
  }
  const resumed = (session) => {
    for (const s of live.values()) {
      const entry = s.joined.get(session.key)
      if (!entry) continue
      if (entry.lostTimer) {
        clearTimeout(entry.lostTimer)
        entry.lostTimer = null
        changed(s)
      } else emitTo(session.key, "tg:state", view(s))
    }
  }
  const leaveAll = (key) => {
    for (const s of [...live.values()]) remove(s, key)
  }
  // someone left a chat room: they can't stay in its session
  const leftRoom = (key, roomKey) => {
    for (const s of [...live.values()]) if (s.room === roomKey) remove(s, key)
  }
  // blocking ends a two-person session
  const blocked = (a, b) => {
    for (const s of [...live.values()]) if (!s.room && s.members.includes(a) && s.members.includes(b)) end(s, "ended")
  }
  const close = () => {
    clearInterval(sweeper)
    for (const s of [...live.values()]) end(s, "closed")
  }

  return { bind, dropped, resumed, leaveAll, leftRoom, blocked, close, live, position, voice }
}

module.exports = { createTogether, REACTIONS, RATES, MAX_QUEUE, MAX_SESSIONS }
