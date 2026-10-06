// Live Broadcast (Pickleball 98 > Real Games > Go Live): a real game filmed by a phone on the
// fence, watched live in 3D by friends anywhere. The filming phone tracks the players itself
// and sends only tracked data: ~10 ticks a second of positions (34 bytes for four players)
// and an event now and then (a hit, the score, the roster). No video ever comes here.
//
// The server checks the bytes' shape (the format is client/src/components/applets/
// pickleball/twin/live/packet.js), keeps the last RING_S seconds in memory so someone joining
// late (or rewinding 10 s) has them, and relays to the viewers. Nothing is stored: a
// broadcast ends when its host stops, leaves, or after MAX_S, and is forgotten.
//
// Who may watch: the host's buddies (not blocked either way; they're told when it starts:
// a live notice and a push), or anyone with the share link's code.
//
// Socket events (client -> server, with an ack unless noted):
//   bc:start  { title, venue, court, players: [{ name, team, hand }], notify }  -> { ok, id, code }
//   bc:tick   <bytes>                     (host, no ack; ~10 a second)
//   bc:ev     { k: "hit" | "score" | "roster", ... }   (host)
//   bc:stop   {}
//   bc:watch  { id } | { code }  -> { ok, info, ring: [<bytes>], events, viewers }
//   bc:unwatch {}
//   bc:react  { e }                (a reaction, a few allowed emoji, rate limited)
//   bc:list   {}  -> { ok, live: [info] }   the broadcasts you may watch (your buddies')
// Server -> client: bc:t <bytes> (volatile), bc:ev event, bc:info { id, viewers },
// bc:react { e, name }, bc:end { id, reason }, bc:live info (to buddies when one starts).

const crypto = require("crypto")

const RING_S = 60
const MAX_S = 3 * 60 * 60
const MAX_BROADCASTS = 12
const MAX_VIEWERS = 30
const TICK_RATE = 25 // per second, at most (the phone sends ~10)
const EVENT_RATE = 10
const REACT_RATE = 1
const PUSH_QUIET_MS = 30 * 60 * 1000
const REACTIONS = ["👏", "🔥", "😮", "🎉", "😂", "💪"]
const tickBytes = (n) => 6 + 7 * n
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v)
const str = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, "").slice(0, n)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const normalize = (s) => String(s || "").replace(/\s+/g, "").toLowerCase()

// is this a well-formed tick? (packet.js: u8 version 1, u8 n <= 4, then 4 + 7n bytes)
const validTick = (buf) => {
  if (!buf || typeof buf.length !== "number" || buf.length < 6 || buf.length > tickBytes(4)) return false
  return buf[0] === 1 && buf[1] <= 4 && buf.length === tickBytes(buf[1])
}

// the events, as packet.js cleanEvent (kept in step; Node's require can't load the ESM file)
const cleanEvent = (e) => {
  if (!isObject(e)) return null
  const t = Number.isFinite(Number(e.t)) ? clamp(Math.round(Number(e.t)), 0, 0xffffffff) : 0
  if (e.k === "hit") {
    const p = Number(e.p)
    if (!Number.isInteger(p) || p < 0 || p > 3) return null
    return { k: "hit", t, p, h: clamp(Math.round(Number(e.h) || 100), 10, 300), s: e.s === "bh" ? "bh" : "fh", src: e.src === "swing" ? "swing" : "sound" }
  }
  if (e.k === "score") return { k: "score", t, a: clamp(Math.round(Number(e.a) || 0), 0, 99), b: clamp(Math.round(Number(e.b) || 0), 0, 99), call: str(e.call, 16), over: !!e.over }
  if (e.k === "roster" && Array.isArray(e.players)) return { k: "roster", t, players: cleanPlayers(e.players) }
  return null
}
const cleanPlayers = (players) =>
  (Array.isArray(players) ? players : []).slice(0, 4).map((p, i) => ({ slot: i, name: str(p?.name, 32) || `Player ${i + 1}`, team: p?.team === 1 ? 1 : 0, hand: p?.hand === -1 ? -1 : 1 }))

// a per-key sliding window counter
const limiter = (perSecond, now) => {
  const hits = new Map()
  return (key) => {
    const t = now()
    const arr = (hits.get(key) || []).filter((x) => t - x < 1000)
    if (arr.length >= perSecond) {
      hits.set(key, arr)
      return false
    }
    arr.push(t)
    hits.set(key, arr)
    return true
  }
}

const createBroadcasts = ({ emit = () => {}, emitVolatile = null, aim = () => null, notify = null, now = Date.now, limits = {} } = {}) => {
  const L = { ringS: RING_S, maxS: MAX_S, maxBroadcasts: MAX_BROADCASTS, maxViewers: MAX_VIEWERS, ...limits }
  const relay = emitVolatile || emit
  const broadcasts = new Map() // id -> broadcast
  const byHost = new Map() // pid -> id
  const watching = new Map() // pid -> id
  const pushedAt = new Map() // `${host}>${buddy}` -> ms
  const tickOk = limiter(TICK_RATE, now)
  const eventOk = limiter(EVENT_RATE, now)
  const reactOk = limiter(REACT_RATE, now)
  const totals = { ticksIn: 0, bytesIn: 0, bytesOut: 0, started: 0 }

  const sessions = () => aim()?.sessions || null
  const userOf = (key) => (key ? sessions()?.get(key)?.user || null : null)
  const buddiesOf = (key) => {
    const out = new Set()
    for (const g of userOf(key)?.groups || []) for (const b of g.buddies || []) out.add(normalize(b))
    return out
  }
  const blocked = (a, b) => {
    const ua = userOf(a)
    const ub = userOf(b)
    return !!((ua?.blocked || []).includes(b) || (ub?.blocked || []).includes(a))
  }
  // may this person watch? (the host, a buddy of the host, or the link's code)
  const mayWatch = (b, me, code) => {
    if (b.host.pid === me.pid) return true
    if (code && code === b.code) return !(me.key && b.host.key && blocked(b.host.key, me.key))
    if (!me.key || !b.host.key || blocked(b.host.key, me.key)) return false
    return buddiesOf(b.host.key).has(me.key)
  }

  const info = (b) => ({ id: b.id, title: b.title, venue: b.venue, court: b.court, host: b.host.name, players: b.players, startedAt: b.startedAt, viewers: b.viewers.size, score: b.score })
  const toViewers = (b, event, payload, { volatile = false, host = false } = {}) => {
    const send = volatile ? relay : emit
    for (const pid of b.viewers) {
      send(pid, event, payload)
      if (payload && payload.length) totals.bytesOut += payload.length
    }
    if (host) emit(b.host.pid, event, payload)
  }
  const viewerCount = (b) => toViewers(b, "bc:info", { id: b.id, viewers: b.viewers.size }, { host: true })

  const trim = (b) => {
    const cut = now() - L.ringS * 1000
    while (b.ring.length && b.ring[0].at < cut) b.ring.shift()
    while (b.events.length && b.events[0].at < cut) b.events.shift()
  }

  const end = (b, reason) => {
    if (!broadcasts.has(b.id)) return
    broadcasts.delete(b.id)
    byHost.delete(b.host.pid)
    clearTimeout(b.timer)
    for (const pid of b.viewers) {
      watching.delete(pid)
      emit(pid, "bc:end", { id: b.id, reason })
    }
    emit(b.host.pid, "bc:end", { id: b.id, reason })
    b.viewers.clear()
  }

  // ---- the host ----
  const start = (me, p) => {
    if (byHost.has(me.pid)) end(broadcasts.get(byHost.get(me.pid)), "replaced")
    if (broadcasts.size >= L.maxBroadcasts) return { ok: false, error: "Too many games are live right now. Try again in a little while." }
    const id = crypto.randomBytes(6).toString("hex")
    const b = {
      id,
      code: crypto.randomBytes(5).toString("hex"),
      host: { pid: me.pid, key: me.key || null, name: me.name || "Someone" },
      title: str(p.title, 60) || "Live game",
      venue: str(p.venue, 40) || null,
      court: p.court === null || p.court === undefined ? null : str(p.court, 40),
      players: cleanPlayers(p.players),
      startedAt: now(),
      viewers: new Set(),
      ring: [],
      events: [],
      roster: null,
      score: null,
      bytesIn: 0,
    }
    b.timer = setTimeout(() => end(b, "time"), L.maxS * 1000)
    b.timer.unref?.()
    broadcasts.set(id, b)
    byHost.set(me.pid, id)
    totals.started++
    // buddies are told (a live notice now; a push at most every 30 min per host and buddy)
    if (p.notify !== false && me.key) {
      const live = info(b)
      for (const k of [...buddiesOf(me.key)].slice(0, 100)) {
        if (k === me.key || blocked(me.key, k)) continue
        sessions()?.get(k)?.socket?.emit?.("bc:live", live)
        const pair = `${me.key}>${k}`
        if (notify && (!pushedAt.has(pair) || now() - pushedAt.get(pair) > PUSH_QUIET_MS)) {
          pushedAt.set(pair, now())
          Promise.resolve(
            notify(k, {
              title: `${b.host.name} is live${p.venueName ? ` at ${str(p.venueName, 40)}` : ""}${p.courtName ? `, ${str(p.courtName, 20)}` : ""}`,
              body: "Watch the game live in 3D in Pickleball 98.",
              tag: `bc-${id}`,
              url: `/?open=program&name=Pickleball%2098&live=${id}`,
            })
          ).catch(() => {})
        }
      }
    }
    return { ok: true, id, code: b.code }
  }

  const tick = (pid, data) => {
    const id = byHost.get(pid)
    const b = id && broadcasts.get(id)
    if (!b) return
    const buf = Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : null
    if (!validTick(buf) || !tickOk(pid)) return
    totals.ticksIn++
    totals.bytesIn += buf.length
    b.bytesIn += buf.length
    b.ring.push({ at: now(), buf })
    if (b.ring.length % 20 === 0) trim(b)
    toViewers(b, "bc:t", buf, { volatile: true })
  }

  const event = (me, p) => {
    const b = broadcasts.get(byHost.get(me.pid))
    if (!b) return { ok: false, error: "You're not live." }
    if (!eventOk(me.pid)) return { ok: false, error: "Slow down." }
    const e = cleanEvent(p)
    if (!e) return { ok: false, error: "That isn't something a broadcast sends." }
    if (e.k === "roster") {
      b.roster = e
      b.players = e.players
    } else if (e.k === "score") b.score = { a: e.a, b: e.b, call: e.call, over: e.over }
    else {
      b.events.push({ at: now(), e })
      trim(b)
    }
    toViewers(b, "bc:ev", e)
    return { ok: true }
  }

  const stop = (me) => {
    const b = broadcasts.get(byHost.get(me.pid))
    if (b) end(b, "ended")
    return { ok: true }
  }

  // ---- viewers ----
  const unwatch = (pid) => {
    const id = watching.get(pid)
    watching.delete(pid)
    const b = id && broadcasts.get(id)
    if (b && b.viewers.delete(pid)) viewerCount(b)
    return { ok: true }
  }
  const watch = (me, p) => {
    const code = typeof p.code === "string" ? p.code.slice(0, 20) : null
    const b = typeof p.id === "string" ? broadcasts.get(p.id) : code ? [...broadcasts.values()].find((x) => x.code === code) : null
    if (!b) return { ok: false, error: "That game isn't live anymore." }
    if (!mayWatch(b, me, code)) return { ok: false, error: "Only the player's buddies (or people with the link) can watch." }
    if (watching.get(me.pid) !== b.id) {
      unwatch(me.pid)
      if (b.viewers.size >= L.maxViewers) return { ok: false, error: "This game has as many viewers as it can take." }
      b.viewers.add(me.pid)
      watching.set(me.pid, b.id)
    }
    trim(b)
    const ring = b.ring.map((r) => r.buf)
    for (const r of ring) totals.bytesOut += r.length
    viewerCount(b)
    const events = [...(b.roster ? [b.roster] : []), ...b.events.map((x) => x.e), ...(b.score ? [{ k: "score", t: 0, ...b.score }] : [])]
    return { ok: true, info: info(b), ring, events, viewers: b.viewers.size, now: now() - b.startedAt }
  }
  const react = (me, p) => {
    const id = watching.get(me.pid) || byHost.get(me.pid)
    const b = id && broadcasts.get(id)
    if (!b) return { ok: false }
    if (!REACTIONS.includes(p.e) || !reactOk(me.pid)) return { ok: false }
    toViewers(b, "bc:react", { e: p.e, name: str(me.name, 32) }, { host: true })
    return { ok: true }
  }
  const list = (me) => ({ ok: true, live: [...broadcasts.values()].filter((b) => b.host.pid !== me.pid && mayWatch(b, me, null)).map(info) })

  const drop = (pid) => {
    unwatch(pid)
    const id = byHost.get(pid)
    if (id) end(broadcasts.get(id), "left")
  }

  // ---------- sockets (server/net: wire(socket, current, who)) ----------
  const wire = (socket, current, who) => {
    const on = (event, handler) =>
      socket.on(event, (payload = {}, ack = () => {}) => {
        if (typeof ack !== "function") ack = () => {}
        const computer = current()
        if (!computer) return ack({ ok: false, error: "Not connected to the network." })
        try {
          ack(handler(who(computer), isObject(payload) ? payload : {}) || { ok: true })
        } catch (error) {
          console.error(`[broadcast] ${event} failed`, error)
          ack({ ok: false, error: "Something went wrong. Please try again." })
        }
      })
    on("bc:start", start)
    on("bc:ev", event)
    on("bc:stop", stop)
    on("bc:watch", watch)
    on("bc:unwatch", (me) => unwatch(me.pid))
    on("bc:react", react)
    on("bc:list", list)
    socket.on("bc:tick", (data) => {
      const computer = current()
      if (!computer) return
      try {
        tick(computer.pid, data)
      } catch {
        // a bad tick is just dropped
      }
    })
  }

  return {
    wire,
    drop,
    start,
    tick,
    event,
    stop,
    watch,
    unwatch,
    react,
    list,
    broadcasts,
    stats: () => ({ ...totals, live: broadcasts.size, viewers: [...broadcasts.values()].reduce((a, b) => a + b.viewers.size, 0) }),
  }
}

module.exports = { createBroadcasts, validTick, cleanEvent, REACTIONS, RING_S }
