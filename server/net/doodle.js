// Doodle Together: a shared drawing canvas for two (or a few) people on the network.
//
// Each browser draws on its own canvas and sends what it draws: strokes in small batches of
// points (a stroke starts with its color, size and tool and ends with `end`), paint-bucket
// fills, stickers and undos. The server checks each one (sizes, colors, coordinates, rates),
// keeps it in the room's history and passes it on to everyone else in the room. Someone who
// joins later gets the history. When the history gets big, the server asks one member to
// flatten it into a picture (a snapshot) and keeps only what came after.
//
// Rooms are private: you're in one because you made it or were invited (through games.js,
// from Network Neighborhood or 98 Messenger). Players are network computer ids (pids). Like
// games.js it talks through the emit(pid, event, payload) it's given; wire() hooks up a
// socket. Everything lives in memory.

const crypto = require("crypto")
const { limiter } = require("./limiter")

const CANVAS = 960 // the canvas is CANVAS x CANVAS logical pixels for everyone
const MAX_MEMBERS = 4
const MAX_ROOMS = 300
const TEMPLATES = ["blank", "lined", "heart", "coloring"]
const TOOLS = ["pencil", "brush", "eraser"]
const STICKERS = ["heart", "star", "flower", "smile"]
const CURSOR_COLORS = ["#e0457b", "#2f7fd8", "#21a35a", "#f08c00"]
const LIMITS = {
  batchNumbers: 240, // x,y pairs in one stroke message (120 points)
  strokeNumbers: 6000, // one stroke at most (3000 points): longer ones start a new stroke
  snapshotAt: 60_000, // numbers of history (or ops * 20) before a snapshot is asked for
  hardCap: 160_000, // past this, new drawing waits for the snapshot
  snapshotBytes: 900 * 1024,
  messagesPerSecond: 60, // strokes, fills, stickers and undos together
  cursorsPerSecond: 30,
  clearMs: 30_000, // a clear request waits this long for an answer
  graceMs: 60_000, // a room whose members all dropped stays this long
}
const HEX = /^#[0-9a-f]{6}$/i
const OP_ID = /^[a-z0-9]{4,16}$/
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

const newId = () => crypto.randomBytes(6).toString("hex")
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const inCanvas = (v, slack = 0) => v !== null && v >= -slack && v <= CANVAS + slack
// how much history an op is "worth"
const weightOf = (op) => (op.k === "s" ? op.p.length + 20 : 20)

const realClock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) }

const createDoodle = ({ emit, clock = realClock, limits: overrides = {} } = {}) => {
  const L = { ...LIMITS, ...overrides }
  const rooms = new Map() // id -> room
  const roomOf = new Map() // pid -> room id
  const invited = new Map() // pid -> { roomId, at }
  const drawLimit = limiter(L.messagesPerSecond, 1000)
  const cursorLimit = limiter(L.cursorsPerSecond, 1000)
  const roomLimit = limiter(10, 60_000)

  const send = (pid, event, payload) => pid && emit(pid, event, payload)
  const others = (room, pid) => room.members.filter((m) => m.pid !== pid && !m.away)
  const toOthers = (room, pid, event, payload) => others(room, pid).forEach((m) => send(m.pid, event, payload))

  const view = (room, pid) => ({
    id: room.id,
    template: room.template,
    host: room.host === pid,
    members: room.members.map((m) => ({ id: m.pid, name: m.name, color: m.color, me: m.pid === pid, away: !!m.away })),
    invited: [...room.invitedNames],
  })
  const publish = (room) => room.members.forEach((m) => !m.away && send(m.pid, "doodle:room", view(room, m.pid)))

  // the history a newcomer needs: the snapshot, then every op after it (undone ones left out)
  const stateOf = (room) => ({
    snapshot: room.snapshot,
    ops: room.ops.filter((op) => !op.undone).map(publicOp),
    template: room.template,
  })
  const publicOp = (op) => {
    if (op.k === "s") return { k: "s", id: op.id, by: op.by, c: op.c, w: op.w, t: op.t, p: op.p, end: op.end }
    if (op.k === "f") return { k: "f", id: op.id, by: op.by, x: op.x, y: op.y, c: op.c }
    return { k: "k", id: op.id, by: op.by, x: op.x, y: op.y, n: op.n, s: op.s, c: op.c }
  }

  const currentRoom = (pid) => {
    const id = roomOf.get(pid)
    return (id && rooms.get(id)) || null
  }
  const memberOf = (room, pid) => room.members.find((m) => m.pid === pid) || null

  const addMember = (room, me) => {
    const used = new Set(room.members.map((m) => m.color))
    const color = CURSOR_COLORS.find((c) => !used.has(c)) || CURSOR_COLORS[0]
    room.members.push({ pid: me.pid, name: me.name, color, away: false })
    roomOf.set(me.pid, room.id)
    room.invitedNames.delete(me.name)
  }

  const closeRoom = (room) => {
    clock.clearTimeout(room.emptyTimer)
    clock.clearTimeout(room.clear?.timer)
    rooms.delete(room.id)
    for (const m of room.members) if (roomOf.get(m.pid) === room.id) roomOf.delete(m.pid)
  }

  // ---------- rooms ----------

  // image: the drawing so far (made alone before inviting someone), as a starting snapshot
  const create = (me, { template, image } = {}) => {
    if (roomLimit(me.pid)) return { ok: false, error: "You're opening rooms too fast. Wait a minute." }
    if (image !== undefined && image !== null && image !== "" && (typeof image !== "string" || image.length > L.snapshotBytes || !IMAGE.test(image))) {
      return { ok: false, error: "That drawing is too big to share. Try clearing some of it." }
    }
    const old = currentRoom(me.pid)
    if (old) leave(me.pid, old.id)
    if (rooms.size >= MAX_ROOMS) return { ok: false, error: "Doodle Together is full right now. Try again in a minute." }
    const room = {
      id: newId(),
      host: me.pid,
      template: TEMPLATES.includes(template) ? template : "blank",
      members: [],
      allowed: new Set([me.pid]),
      invitedNames: new Set(),
      ops: [],
      weight: 0,
      snapshot: image || null,
      snapshotAsk: null,
      clear: null,
      emptyTimer: null,
    }
    rooms.set(room.id, room)
    addMember(room, me)
    publish(room)
    return { ok: true, roomId: room.id, room: view(room, me.pid), state: stateOf(room) }
  }

  const join = (me, roomId) => {
    const room = rooms.get(roomId)
    if (!room) return { ok: false, error: "Sorry, that drawing has been closed." }
    if (memberOf(room, me.pid)) return { ok: true, roomId, room: view(room, me.pid), state: stateOf(room) }
    if (!room.allowed.has(me.pid)) return { ok: false, error: "You need an invitation to draw here." }
    if (room.members.length >= MAX_MEMBERS) return { ok: false, error: "That drawing already has four artists." }
    const old = currentRoom(me.pid)
    if (old) leave(me.pid, old.id)
    invited.delete(me.pid)
    addMember(room, me)
    clock.clearTimeout(room.emptyTimer)
    room.emptyTimer = null
    publish(room)
    toOthers(room, me.pid, "doodle:notice", { text: `${me.name} joined the drawing.` })
    return { ok: true, roomId, room: view(room, me.pid), state: stateOf(room) }
  }

  const leave = (pid, roomId) => {
    const room = rooms.get(roomId)
    const member = room && memberOf(room, pid)
    if (!member) return { ok: true }
    room.members = room.members.filter((m) => m !== member)
    if (roomOf.get(pid) === room.id) roomOf.delete(pid)
    if (!room.members.length) return closeRoom(room), { ok: true }
    if (room.host === pid) room.host = room.members[0].pid
    if (room.clear) resolveClear(room, room.clear.from === pid ? false : null)
    if (room.snapshotAsk?.pid === pid) room.snapshotAsk = null
    publish(room)
    toOthers(room, pid, "doodle:notice", { text: `${member.name} left the drawing.` })
    return { ok: true }
  }

  // ---------- drawing ----------

  // the room a drawing message is for, if this pid may draw there
  const drawable = (pid, roomId) => {
    const room = rooms.get(roomId)
    if (!room || !memberOf(room, pid)) return { error: { ok: false, error: "You aren't in that drawing." } }
    if (drawLimit(pid)) return { error: { ok: false, error: "Slow down a little!", code: "rate" } }
    return { room }
  }

  const addOp = (room, op) => {
    room.ops.push(op)
    room.weight += weightOf(op)
    askForSnapshot(room)
  }
  const full = (room) => room.weight >= L.hardCap

  const points = (list) => {
    if (!Array.isArray(list) || list.length % 2 || list.length > L.batchNumbers) return null
    const out = []
    for (const v of list) {
      const n = num(v)
      if (!inCanvas(n, 64)) return null
      out.push(Math.round(n * 10) / 10)
    }
    return out
  }

  // { id, p: [x, y, ...], start?: { c, w, t }, end?: true }
  const stroke = (pid, roomId, { id, p, start, end } = {}) => {
    const { room, error } = drawable(pid, roomId)
    if (error) return error
    const pts = points(p ?? [])
    if (!pts) return { ok: false, error: "That stroke couldn't be read." }
    const key = String(id ?? "")
    if (!OP_ID.test(key)) return { ok: false, error: "That stroke couldn't be read." }
    let op
    if (start) {
      if (full(room)) return { ok: false, error: "Saving the canvas... draw again in a second.", code: "full" }
      if (!start || !HEX.test(start.c) || !TOOLS.includes(start.t)) return { ok: false, error: "That stroke couldn't be read." }
      const w = num(start.w)
      if (w === null || w < 1 || w > 64) return { ok: false, error: "That brush is too big." }
      if (room.ops.some((o) => o.by === pid && o.id === key)) return { ok: false, error: "That stroke is already drawn." }
      op = { k: "s", id: key, by: pid, c: start.c.toLowerCase(), w: Math.round(w * 2) / 2, t: start.t, p: [], end: false }
      addOp(room, op)
    } else {
      op = room.ops.find((o) => o.k === "s" && o.by === pid && o.id === key)
      if (!op || op.end) return { ok: false, error: "That stroke is already finished." }
    }
    if (op.p.length + pts.length > L.strokeNumbers) return { ok: false, error: "That stroke is too long." }
    op.p.push(...pts)
    room.weight += pts.length
    if (end) op.end = true
    askForSnapshot(room)
    toOthers(room, pid, "doodle:stroke", { by: pid, id: key, p: pts, ...(start ? { start: { c: op.c, w: op.w, t: op.t } } : {}), ...(end ? { end: true } : {}) })
    return { ok: true }
  }

  const fill = (pid, roomId, { id, x, y, c } = {}) => {
    const { room, error } = drawable(pid, roomId)
    if (error) return error
    const key = String(id ?? "")
    const px = num(x)
    const py = num(y)
    if (!OP_ID.test(key) || !inCanvas(px) || !inCanvas(py) || !HEX.test(c)) return { ok: false, error: "That fill couldn't be read." }
    if (full(room)) return { ok: false, error: "Saving the canvas... try again in a second.", code: "full" }
    const op = { k: "f", id: key, by: pid, x: Math.floor(px), y: Math.floor(py), c: c.toLowerCase() }
    addOp(room, op)
    toOthers(room, pid, "doodle:op", publicOp(op))
    return { ok: true }
  }

  const sticker = (pid, roomId, { id, x, y, n, s, c } = {}) => {
    const { room, error } = drawable(pid, roomId)
    if (error) return error
    const key = String(id ?? "")
    const px = num(x)
    const py = num(y)
    const size = num(s)
    if (!OP_ID.test(key) || !inCanvas(px) || !inCanvas(py) || !STICKERS.includes(n) || size === null || size < 8 || size > 240 || !HEX.test(c)) {
      return { ok: false, error: "That sticker couldn't be read." }
    }
    if (full(room)) return { ok: false, error: "Saving the canvas... try again in a second.", code: "full" }
    const op = { k: "k", id: key, by: pid, x: Math.round(px), y: Math.round(py), n, s: Math.round(size), c: c.toLowerCase() }
    addOp(room, op)
    toOthers(room, pid, "doodle:op", publicOp(op))
    return { ok: true }
  }

  // Undo one of your own things (still in the history: not yet in a snapshot)
  const undo = (pid, roomId, { id } = {}) => {
    const { room, error } = drawable(pid, roomId)
    if (error) return error
    const op = room.ops.find((o) => o.by === pid && o.id === String(id ?? "") && !o.undone)
    if (!op) return { ok: false, error: "That can't be undone anymore." }
    op.undone = true
    op.end = true
    toOthers(room, pid, "doodle:undo", { by: pid, id: op.id })
    return { ok: true }
  }

  const setTemplate = (pid, roomId, template) => {
    const room = rooms.get(roomId)
    if (!room || !memberOf(room, pid)) return { ok: false, error: "You aren't in that drawing." }
    if (!TEMPLATES.includes(template)) return { ok: false, error: "Unknown background." }
    room.template = template
    publish(room)
    return { ok: true }
  }

  const cursor = (pid, roomId, { x, y } = {}) => {
    const room = rooms.get(roomId)
    if (!room || !memberOf(room, pid) || cursorLimit(pid)) return { ok: true }
    const px = num(x)
    const py = num(y)
    if (px === null && py === null) toOthers(room, pid, "doodle:cursor", { by: pid, x: null, y: null })
    else if (inCanvas(px, 64) && inCanvas(py, 64)) toOthers(room, pid, "doodle:cursor", { by: pid, x: Math.round(px), y: Math.round(py) })
    return { ok: true }
  }

  // ---------- clearing (everyone else has to agree) ----------

  const wipe = (room) => {
    room.ops = []
    room.weight = 0
    room.snapshot = null
    room.snapshotAsk = null
    room.members.forEach((m) => send(m.pid, "doodle:cleared", {}))
  }

  // accepted: true clears, false declines, null cancels quietly
  const resolveClear = (room, accepted, byName) => {
    const req = room.clear
    if (!req) return
    clock.clearTimeout(req.timer)
    room.clear = null
    if (accepted) wipe(room)
    else send(req.from, "doodle:clearResult", { ok: false, text: accepted === false && byName ? `${byName} wants to keep the drawing.` : "Nobody answered, so the drawing was kept." })
    room.members.forEach((m) => send(m.pid, "doodle:clearDone", {}))
  }

  const clear = (pid, roomId) => {
    const room = rooms.get(roomId)
    const me = room && memberOf(room, pid)
    if (!me) return { ok: false, error: "You aren't in that drawing." }
    if (others(room, pid).length === 0) return wipe(room), { ok: true, cleared: true }
    if (room.clear) return { ok: false, error: "Someone already asked to clear the drawing." }
    room.clear = { from: pid, waiting: new Set(others(room, pid).map((m) => m.pid)) }
    room.clear.timer = clock.setTimeout(() => resolveClear(room, false), L.clearMs)
    toOthers(room, pid, "doodle:clearAsk", { from: me.name })
    return { ok: true, asked: true }
  }

  const clearReply = (pid, roomId, accept) => {
    const room = rooms.get(roomId)
    const req = room?.clear
    if (!req || !req.waiting.has(pid)) return { ok: true }
    if (!accept) return resolveClear(room, false, memberOf(room, pid)?.name), { ok: true }
    req.waiting.delete(pid)
    if (!req.waiting.size) resolveClear(room, true)
    return { ok: true }
  }

  // ---------- snapshots ----------

  // Big history: ask one member (the longest there) to flatten everything so far
  const askForSnapshot = (room) => {
    if (room.weight < L.snapshotAt || room.snapshotAsk) return
    const member = room.members.find((m) => !m.away)
    if (!member) return
    // only finished ops can go into a picture
    let upTo = room.ops.length
    const open = room.ops.findIndex((o) => o.k === "s" && !o.end && !o.undone)
    if (open >= 0) upTo = open
    if (upTo < 1) return
    room.snapshotAsk = { pid: member.pid, token: newId(), upTo, count: room.ops.length }
    send(member.pid, "doodle:needSnapshot", { roomId: room.id, token: room.snapshotAsk.token, upTo, lastId: room.ops[upTo - 1].id, lastBy: room.ops[upTo - 1].by })
  }

  const snapshot = (pid, roomId, { token, image } = {}) => {
    const room = rooms.get(roomId)
    const ask = room?.snapshotAsk
    if (!ask || ask.pid !== pid || ask.token !== token) return { ok: false, error: "No picture was asked for." }
    room.snapshotAsk = null
    if (typeof image !== "string" || image.length > L.snapshotBytes || !IMAGE.test(image)) return { ok: false, error: "That picture couldn't be used." }
    // a clear since the request: nothing to flatten
    if (room.ops.length < ask.upTo) return { ok: true }
    const kept = room.ops.slice(ask.upTo)
    room.snapshot = image
    room.ops = kept
    room.weight = kept.reduce((sum, op) => sum + weightOf(op), 0) + Math.round(image.length / 100)
    room.members.forEach((m) => m.pid !== pid && send(m.pid, "doodle:flattened", { upTo: ask.upTo }))
    askForSnapshot(room)
    return { ok: true }
  }

  // One person saved the drawing: the others save their own copy too
  const saved = (pid, roomId) => {
    const room = rooms.get(roomId)
    const me = room && memberOf(room, pid)
    if (!me) return { ok: false, error: "You aren't in that drawing." }
    if (roomLimit(`save:${pid}`)) return { ok: false, error: "Slow down!" }
    toOthers(room, pid, "doodle:saved", { by: me.name })
    return { ok: true }
  }

  // ---------- network glue (games.js invitations, coming and going) ----------

  const canInvite = (pid, roomId) => {
    const room = rooms.get(roomId)
    if (!room || !memberOf(room, pid)) return { ok: false, error: "Open Doodle Together first." }
    if (room.members.length + room.invitedNames.size >= MAX_MEMBERS) return { ok: false, error: "Four artists is the most a drawing can have." }
    return { ok: true }
  }
  const invitedTo = (roomId, name) => {
    const room = rooms.get(roomId)
    if (room) {
      room.invitedNames.add(name)
      publish(room)
    }
  }
  const inviteEnded = (roomId, name) => {
    const room = rooms.get(roomId)
    if (room && room.invitedNames.delete(name)) publish(room)
  }
  const allow = (pid, roomId) => {
    const room = rooms.get(roomId)
    if (!room) return { ok: false, error: "Sorry, that drawing has been closed." }
    room.allowed.add(pid)
    invited.set(pid, { roomId, at: clock.now() })
    send(pid, "doodle:invited", { roomId })
    return { ok: true, doodleRoom: roomId }
  }

  // A Doodle window opened (or reconnected): its room, or the invitation it was opened for
  const hello = (pid) => {
    const room = currentRoom(pid)
    if (room) return { ok: true, roomId: room.id, room: view(room, pid), state: stateOf(room) }
    const inv = invited.get(pid)
    if (inv && clock.now() - inv.at < 120_000 && rooms.has(inv.roomId)) return { ok: true, invited: inv.roomId }
    return { ok: true }
  }

  const setAway = (pid, away) => {
    const room = currentRoom(pid)
    const member = room && memberOf(room, pid)
    if (!member) return
    member.away = away
    if (room.snapshotAsk?.pid === pid) room.snapshotAsk = null
    clock.clearTimeout(room.emptyTimer)
    room.emptyTimer = null
    if (room.members.every((m) => m.away)) room.emptyTimer = clock.setTimeout(() => closeRoom(room), L.graceMs)
    publish(room)
    if (!away) askForSnapshot(room)
  }

  const drop = (pid) => {
    invited.delete(pid)
    const room = currentRoom(pid)
    if (room) leave(pid, room.id)
  }

  const wire = (socket, current, who) => {
    const on = (event, handler) =>
      socket.on(event, (payload = {}, ack = () => {}) => {
        if (typeof ack !== "function") ack = () => {}
        const computer = current()
        if (!computer) return ack({ ok: false, error: "Not connected to the network." })
        try {
          ack(handler(who(computer), payload && typeof payload === "object" ? payload : {}) || { ok: true })
        } catch (error) {
          console.error(`[doodle] ${event} failed`, error)
          ack({ ok: false, error: "Something went wrong. Please try again." })
        }
      })
    const id = (v) => String(v ?? "")
    on("doodle:hello", (me) => hello(me.pid))
    on("doodle:create", (me, { template, image }) => create(me, { template: id(template), image }))
    on("doodle:join", (me, { roomId }) => join(me, id(roomId)))
    on("doodle:leave", (me, { roomId }) => leave(me.pid, id(roomId)))
    on("doodle:stroke", (me, { roomId, ...data }) => stroke(me.pid, id(roomId), data))
    on("doodle:fill", (me, { roomId, ...data }) => fill(me.pid, id(roomId), data))
    on("doodle:sticker", (me, { roomId, ...data }) => sticker(me.pid, id(roomId), data))
    on("doodle:undo", (me, { roomId, ...data }) => undo(me.pid, id(roomId), data))
    on("doodle:template", (me, { roomId, template }) => setTemplate(me.pid, id(roomId), id(template)))
    on("doodle:cursor", (me, { roomId, ...data }) => cursor(me.pid, id(roomId), data))
    on("doodle:clear", (me, { roomId }) => clear(me.pid, id(roomId)))
    on("doodle:clearReply", (me, { roomId, accept }) => clearReply(me.pid, id(roomId), !!accept))
    on("doodle:snapshot", (me, { roomId, ...data }) => snapshot(me.pid, id(roomId), data))
    on("doodle:saved", (me, { roomId }) => saved(me.pid, id(roomId)))
  }

  return {
    create,
    join,
    leave,
    stroke,
    fill,
    sticker,
    undo,
    setTemplate,
    cursor,
    clear,
    clearReply,
    snapshot,
    saved,
    hello,
    canInvite,
    invitedTo,
    inviteEnded,
    allow,
    setAway,
    drop,
    wire,
    rooms,
    stateOf: (roomId) => (rooms.has(roomId) ? stateOf(rooms.get(roomId)) : null),
    // the people in a room, for its match chat
    playersOf: (roomId) => {
      const room = rooms.get(roomId)
      return room ? room.members.map((m) => m.pid) : null
    },
  }
}

module.exports = { createDoodle, CANVAS, TEMPLATES, TOOLS, STICKERS, LIMITS, MAX_MEMBERS }
