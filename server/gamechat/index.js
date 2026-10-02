// Game chat: a little chat beside every game, over the same Socket.io connection.
//   lobby:<game>     one public room per game for everyone playing it right now (solo games too)
//   match:<matchId>  the players of one network match (games.js); nobody else may join or post
// People are who Network Neighborhood says they are: their 98 Messenger screen name when
// signed on, GUEST-XXXX otherwise. Messages are plain text (the browser renders text, never
// HTML), at most MAX_TEXT characters, rate limited, with links, slurs and spam refused and
// swear words starred out in `masked` (the browser picks which to show by its filter level).
// The last HISTORY messages of a room are kept in memory for people who join later.
//
// Events (all with an ack):
//   gchat:join  { room }          -> { ok, room, history, count, me }
//   gchat:leave { room }
//   gchat:send  { room, text } | { room, quick } -> { ok, message } | { ok: false, error }
// Sent to the room: gchat:msg (a message or a system line), gchat:count { room, count }

const crypto = require("crypto")
const { limiter } = require("../net/limiter")
const { isProfane, LINK } = require("../net/guestbook")

const MAX_TEXT = 200
const HISTORY = 50
const MAX_ROOMS_PER_SOCKET = 6
const MAX_LOBBIES = 200
const RATE = { count: 5, windowMs: 10_000 }

// One-tap messages (phones): the server holds the text, the browser sends the id
const QUICK = {
  gg: "Good game!",
  nice: "Nice move!",
  rematch: "Rematch?",
  oops: "Oops!",
  wp: "Well played!",
  smile: ":)",
  ty: "Thanks!",
  wow: "Wow!",
  turn: "Your turn!",
  hi: "Hi everyone!",
  gl: "Good luck!",
  high: "New high score!",
  lol: "LOL",
  sad: ":(",
  brb: "Be right back",
  bye: "Bye!",
}

// Refused outright, whatever the reader's filter: slurs and spam words
const NEVER = ["nigger", "nigga", "faggot", "fag", "retard", "spic", "chink", "kike", "tranny", "porn", "porno", "viagra", "cialis", "casino"]
const NEVER_PATTERN = new RegExp(`\\b(${NEVER.join("|")})s?\\b`, "i")
const squash = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[0@4]/g, (c) => ({ 0: "o", "@": "a", 4: "a" })[c])
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/[5$]/g, "s")
    .replace(/(\w)[*.\-_]+(?=\w)/g, "$1")
    .replace(/(\w)\1+/g, "$1")
const NEVER_SQUASHED = new Set(NEVER.flatMap((w) => [squash(w), `${squash(w)}s`]))
const isSlur = (text) => NEVER_PATTERN.test(text) || squash(text).split(/[^a-z]+/).some((word) => NEVER_SQUASHED.has(word))

const clean = (text) =>
  String(text ?? "")
    .replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

// Star out each swear word, keeping its first letter: "what the f***"
const mask = (text) => text.replace(/[^\s]+/g, (word) => (isProfane(word) ? word[0] + "*".repeat(Math.max(2, word.length - 1)) : word))

// -> { ok: true, text, masked? } | { ok: false, error }
const checkText = (raw) => {
  const text = clean(raw)
  if (!text) return { ok: false, error: "Type a message first." }
  if (text.length > MAX_TEXT) return { ok: false, error: `Messages can be at most ${MAX_TEXT} characters.` }
  if (LINK.test(text)) return { ok: false, error: "Links can't be posted in game chat." }
  if (isSlur(text)) return { ok: false, error: "Please keep it friendly!" }
  if (/(.)\1{11,}/.test(text.replace(/\s/g, ""))) return { ok: false, error: "That message looks like spam." }
  const masked = isProfane(text) ? mask(text) : null
  return masked && masked !== text ? { ok: true, text, masked } : { ok: true, text }
}

const ROOM = /^(lobby:[a-z0-9-]{1,24}|match:[a-f0-9]{6,24})$/

// net: attachNet()'s result (whoIs, blockedPids, games)
const attachGameChat = (io, net, { rate = RATE } = {}) => {
  const rooms = new Map() // name -> { name, kind, id, history, members: Map socket.id -> { socket, pid } }
  const sendLimit = limiter(rate.count, rate.windowMs)
  const joinLimit = limiter(30, 60_000)
  const newId = () => crypto.randomBytes(6).toString("hex")

  const lobbies = () => [...rooms.values()].filter((r) => r.kind === "lobby").length
  const pidsIn = (room) => new Set([...room.members.values()].map((m) => m.pid))
  // a match is a network game (games.js), a Tetris Online room (tetris.js), a Doodle
  // Together room (doodle.js) or a Quiz Show room (server/quiz)
  const playersOf = (id) => net.games.playersOf(id) || net.tetris?.playersOf(id) || net.doodle?.playersOf(id) || net.quiz?.playersOf(id) || null
  const isMatchPlayer = (room, pid) => (playersOf(room.id) || []).includes(pid)
  const blocked = (a, b) => a !== b && net.blockedPids(a, b)

  const deliver = (room, message) => {
    for (const member of room.members.values()) {
      if (message.fromId && blocked(message.fromId, member.pid)) continue
      member.socket.emit("gchat:msg", message)
    }
  }
  const remember = (room, message) => {
    room.history.push(message)
    if (room.history.length > HISTORY) room.history.splice(0, room.history.length - HISTORY)
  }
  const system = (room, text, { keep = true } = {}) => {
    const message = { id: newId(), room: room.name, system: true, text, time: Date.now() }
    if (keep) remember(room, message)
    deliver(room, message)
  }
  const sendCount = (room) => {
    const count = pidsIn(room).size
    for (const member of room.members.values()) member.socket.emit("gchat:count", { room: room.name, count })
  }

  const leaveRoom = (socket, room, reason = "left") => {
    const member = room.members.get(socket.id)
    if (!member) return
    room.members.delete(socket.id)
    socket.data.gchatRooms?.delete(room.name)
    const stillHere = pidsIn(room).has(member.pid)
    if (!stillHere && member.name) system(room, `${member.name} ${reason === "gone" ? "left" : "left the chat"}.`, { keep: room.kind === "match" })
    if (!room.members.size && room.kind === "lobby") rooms.delete(room.name)
    else sendCount(room)
  }

  // A match ended or started again: say so in its chat
  net.games.onEvent?.((m, type) => {
    const room = rooms.get(`match:${m.id}`)
    if (!room) return
    if (type === "rematch") return system(room, `Rematch! Round ${m.round} begins.`)
    if (m.game === "hearts") {
      const winners = (m.state?.winners || []).map((i) => m.seats[i]?.name).filter(Boolean)
      return system(room, winners.length ? `${winners.join(" and ")} ${winners.length > 1 ? "win" : "wins"}!` : "Game over.")
    }
    const result = m.result
    if (!result) return
    system(room, result.draw ? "It's a draw." : `${m.names[result.winner] || "Someone"} wins!`)
  })

  // Match rooms whose match is gone: tidy up now and then
  setInterval(() => {
    for (const room of rooms.values()) {
      if (room.kind === "match" && !playersOf(room.id) && !room.members.size) rooms.delete(room.name)
    }
  }, 60_000).unref?.()

  io.on("connection", (socket) => {
    socket.data.gchatRooms = new Set()
    const on = (event, handler) =>
      socket.on(event, (payload = {}, ack = () => {}) => {
        if (typeof ack !== "function") ack = () => {}
        try {
          ack(handler(payload && typeof payload === "object" ? payload : {}) || { ok: true })
        } catch (error) {
          console.error(`[gamechat] ${event} failed`, error)
          ack({ ok: false, error: "Something went wrong." })
        }
      })

    on("gchat:join", ({ room: name }) => {
      const me = net.whoIs(socket)
      if (!me) return { ok: false, error: "Not connected to the network yet." }
      if (typeof name !== "string" || !ROOM.test(name)) return { ok: false, error: "No such chat." }
      if (joinLimit(socket.id)) return { ok: false, error: "Too many requests." }
      let room = rooms.get(name)
      const [kind, id] = name.split(":")
      if (kind === "match" && !(playersOf(id) || []).includes(me.pid)) {
        return { ok: false, error: "Only the players in this game can use its chat." }
      }
      if (!room) {
        if (kind === "lobby" && lobbies() >= MAX_LOBBIES) return { ok: false, error: "Chat is busy right now." }
        room = { name, kind, id, history: [], members: new Map() }
        rooms.set(name, room)
      }
      if (!room.members.has(socket.id)) {
        if (socket.data.gchatRooms.size >= MAX_ROOMS_PER_SOCKET) return { ok: false, error: "Too many chats open." }
        const fresh = !pidsIn(room).has(me.pid)
        room.members.set(socket.id, { socket, pid: me.pid, name: me.name })
        socket.data.gchatRooms.add(name)
        if (fresh) system(room, `${me.name} joined the chat.`, { keep: kind === "match" })
        sendCount(room)
      }
      const history = room.history.filter((m) => !m.fromId || !blocked(m.fromId, me.pid))
      return { ok: true, room: name, history, count: pidsIn(room).size, me: me.name }
    })

    on("gchat:leave", ({ room: name }) => {
      const room = rooms.get(name)
      if (room) leaveRoom(socket, room)
      return { ok: true }
    })

    on("gchat:send", ({ room: name, text, quick }) => {
      const me = net.whoIs(socket)
      const room = typeof name === "string" && rooms.get(name)
      if (!me || !room || !room.members.has(socket.id)) return { ok: false, error: "Join the chat first." }
      // a player who left the match (or a match that's gone) can't post into it
      if (room.kind === "match" && !isMatchPlayer(room, me.pid)) return { ok: false, error: "This game's chat is closed." }
      let checked
      if (quick !== undefined) {
        if (!Object.hasOwn(QUICK, quick)) return { ok: false, error: "Unknown quick message." }
        checked = { ok: true, text: QUICK[quick] }
      } else checked = checkText(text)
      if (!checked.ok) return checked
      if (sendLimit(me.pid)) return { ok: false, error: "You're chatting too fast. Wait a few seconds." }
      // names follow sign-ons, so refresh the member's
      room.members.get(socket.id).name = me.name
      const message = { id: newId(), room: name, from: me.name, fromId: me.pid, text: checked.text, time: Date.now() }
      if (checked.masked) message.masked = checked.masked
      if (quick !== undefined) message.quick = quick
      remember(room, message)
      deliver(room, message)
      return { ok: true, message }
    })

    socket.on("disconnect", () => {
      for (const name of [...socket.data.gchatRooms]) {
        const room = rooms.get(name)
        if (room) leaveRoom(socket, room, "gone")
      }
    })
  })

  return { rooms }
}

module.exports = { attachGameChat, checkText, mask, QUICK, MAX_TEXT, HISTORY, RATE, ROOM }
