// Live Quiz Show games between computers on the network (Network Neighborhood, 98
// Messenger invitations): How Well Do You Know Me (two players), This or That, Party
// Trivia and Deep Talk cards (two to eight). The server keeps each room: who's in it, the
// questions, everyone's answers (kept secret until the reveal), the clock and the scores.
//
// Players are network computer ids (pids), plus a name and, for signed-in 98 Messenger
// users, a key (the pair's running score is recorded for them). Like tetris.js it never
// touches sockets except in wire(); invitations go through games.js.

const crypto = require("crypto")
const { quizContent } = require("./content")

const MODES = {
  knowme: { name: "How Well Do You Know Me?", min: 2, max: 2 },
  tot: { name: "This or That", min: 2, max: 8 },
  trivia: { name: "Party Trivia", min: 2, max: 8 },
  deep: { name: "Deep Talk Cards", min: 2, max: 8 },
}
const TIMERS = [0, 10, 15, 20, 30]
const REACTIONS = ["heart", "laugh", "wow", "clap", "blush"]
const TIMES = {
  invite: 60_000,
  grace: 45_000, // disconnected this long: you leave the room
  revealMin: 800, // a reveal stays up at least this long before Next works
}
const MAX_ROOMS = 300

const newId = () => crypto.randomBytes(6).toString("hex")
const clampInt = (v, lo, hi, fallback) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback
}
const realClock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) }

// Room options, cleaned: { count, timer, pack, level }
const cleanOptions = (mode, input = {}, packs = []) => {
  const timerDefault = mode === "trivia" ? 20 : 0
  const timer = TIMERS.includes(Number(input.timer)) ? Number(input.timer) : timerDefault
  if (mode === "knowme") return { count: clampInt(input.count, 3, 10, 5), timer }
  if (mode === "tot") return { count: clampInt(input.count, 5, 20, 10), timer }
  if (mode === "trivia") return { count: clampInt(input.count, 5, 15, 10), timer, pack: packs.includes(input.pack) || input.pack === "mix" ? input.pack : "mix" }
  return { level: clampInt(input.level, 1, 3, 1), timer: 0 }
}

const defaultRecord = async ({ a, b, mode, percent }) => {
  const { sharedQuizStore } = require("./store")
  const store = await sharedQuizStore()
  await store.addScore(a, b, { mode, percent })
}

const createQuizLive = ({ emit, clock = realClock, random = Math.random, record = defaultRecord, times: timeOverrides = {} } = {}) => {
  const T = { ...TIMES, ...timeOverrides }
  const rooms = new Map() // id -> room
  const roomOf = new Map() // pid -> room id
  const invited = new Map() // pid -> { roomId, at }
  const reactAt = new Map() // pid -> [times]
  let lib = null // { logic, content } once loaded
  const ready = quizContent().then((value) => (lib = value))
  ready.catch((error) => console.error("[quiz] couldn't load the questions", error))

  const send = (pid, event, payload) => pid && emit(pid, event, payload)

  // ---------- timers ----------

  const later = (room, ms, fn) => {
    const handle = clock.setTimeout(() => {
      room.timers.delete(handle)
      if (rooms.get(room.id) === room) fn()
    }, ms)
    room.timers.add(handle)
    return handle
  }
  const stopTimers = (room) => {
    for (const h of room.timers) clock.clearTimeout(h)
    room.timers.clear()
  }

  // ---------- views ----------

  const active = (room) => room.players.filter((p) => !p.left)
  const playerOf = (room, pid) => room.players.find((p) => p.pid === pid && !p.left)

  const view = (room, pid) => {
    const item = room.items[room.step]
    const inQuestion = room.phase === "question" || room.phase === "reveal"
    return {
      id: room.id,
      mode: room.mode,
      modeName: MODES[room.mode].name,
      round: room.round,
      phase: room.phase,
      you: pid,
      host: room.host === pid,
      hostName: playerOf(room, room.host)?.name || null,
      min: MODES[room.mode].min,
      max: MODES[room.mode].max,
      players: active(room).map((p) => ({
        id: p.pid,
        name: p.name,
        away: !!p.away,
        signedIn: !!p.key,
        answered: room.phase === "question" && Object.hasOwn(room.answers, p.pid),
        score: room.scores[p.pid] || 0,
      })),
      invited: [...room.invitedNames],
      options: room.options,
      step: room.step,
      total: room.items.length,
      current: inQuestion && item ? { item: item.id, subject: item.subject || null } : null,
      yourAnswer: inQuestion && Object.hasOwn(room.answers, pid) ? room.answers[pid] : null,
      deadline: room.phase === "question" ? room.deadline : null,
      now: clock.now(),
      reveal: room.phase === "reveal" ? room.log[room.step] : null,
      log: room.phase === "done" ? room.log : [],
      card: room.mode === "deep" && room.card ? { ...room.card, drawn: room.drawn } : null,
      result: room.phase === "done" ? room.result : null,
      note: room.note,
    }
  }

  const publish = (room) => {
    for (const p of active(room)) send(p.pid, "quiz:room", view(room, p.pid))
  }

  // ---------- rooms ----------

  const currentRoom = (pid) => {
    const id = roomOf.get(pid)
    const room = id && rooms.get(id)
    return room && playerOf(room, pid) ? room : null
  }

  const addPlayer = (room, me) => {
    room.players = room.players.filter((p) => p.pid !== me.pid)
    room.players.push({ pid: me.pid, name: me.name, key: me.key || null, away: false })
    room.invitedNames.delete(me.name)
    roomOf.set(me.pid, room.id)
  }

  const create = (me, { mode, options } = {}) => {
    if (!lib) return { ok: false, error: "The Quiz Show is still warming up. Try again in a moment." }
    if (!MODES[mode]) return { ok: false, error: "Unknown game." }
    const old = currentRoom(me.pid)
    if (old) leave(me.pid, old.id)
    if (rooms.size >= MAX_ROOMS) return { ok: false, error: "The Quiz Show is full right now. Try again in a minute." }
    const room = {
      id: newId(),
      mode,
      round: 1,
      host: me.pid,
      players: [],
      invitedNames: new Set(),
      options: cleanOptions(mode, options, lib.content.triviaPacks.map((p) => p.id)),
      phase: "lobby",
      step: 0,
      items: [],
      answers: {},
      answeredAt: {},
      log: [],
      scores: {},
      deadline: null,
      revealAt: 0,
      result: null,
      note: null,
      card: null,
      drawn: 0,
      deck: {},
      timers: new Set(),
      recorded: false,
    }
    rooms.set(room.id, room)
    addPlayer(room, me)
    publish(room)
    return { ok: true, roomId: room.id }
  }

  const join = (me, roomId) => {
    const room = rooms.get(roomId)
    if (!room) return { ok: false, error: "Sorry, that game has closed." }
    if (playerOf(room, me.pid)) return publish(room), { ok: true, roomId }
    const inv = invited.get(me.pid)
    if (!inv || inv.roomId !== roomId || clock.now() - inv.at > T.invite * 2) return { ok: false, error: "You need an invitation to join that game." }
    if (active(room).length >= MODES[room.mode].max) return { ok: false, error: "That game is full." }
    if (room.phase !== "lobby" && room.mode !== "deep") return { ok: false, error: "That game has already started." }
    invited.delete(me.pid)
    const old = currentRoom(me.pid)
    if (old) leave(me.pid, old.id)
    addPlayer(room, me)
    publish(room)
    return { ok: true, roomId }
  }

  const setOptions = (pid, roomId, options) => {
    const room = rooms.get(roomId)
    if (!room || room.host !== pid || !playerOf(room, pid)) return { ok: false, error: "Only the host can change the game." }
    if (room.phase !== "lobby") return { ok: false, error: "The game has already started." }
    const mode = options && MODES[options.mode] && options.mode !== room.mode ? options.mode : room.mode
    if (mode !== room.mode && active(room).length > MODES[mode].max) return { ok: false, error: "Too many players for that game." }
    room.mode = mode
    room.options = cleanOptions(mode, { ...room.options, ...options }, lib.content.triviaPacks.map((p) => p.id))
    publish(room)
    return { ok: true }
  }

  // ---------- playing ----------

  const pickItems = (room) => {
    const { content, logic } = lib
    const { options } = room
    if (room.mode === "knowme") {
      const [a, b] = active(room)
      const picked = logic.pickSome(content.aboutMe, options.count * 2, random)
      return [...picked.slice(0, options.count).map((q) => ({ id: q.id, subject: a.pid })), ...picked.slice(options.count).map((q) => ({ id: q.id, subject: b.pid }))]
    }
    if (room.mode === "tot") return logic.pickSome(content.pairs, options.count, random).map((p) => ({ id: p.id }))
    const pool = options.pack === "mix" ? content.trivia : content.triviaPacks.find((p) => p.id === options.pack).questions
    return logic.pickSome(pool, options.count, random).map((q) => ({ id: q.id }))
  }

  const lookup = (room, id) => {
    const { content } = lib
    if (room.mode === "knowme") return content.aboutMe.find((q) => q.id === id)
    if (room.mode === "tot") return content.pairs.find((q) => q.id === id)
    return content.trivia.find((q) => q.id === id)
  }

  const optionCount = (room, item) => (room.mode === "tot" ? 2 : lookup(room, item.id).options.length)

  const begin = (room) => {
    stopTimers(room)
    room.answers = {}
    room.answeredAt = {}
    room.phase = "question"
    room.startedAt = clock.now()
    room.deadline = room.options.timer ? clock.now() + room.options.timer * 1000 : null
    if (room.deadline) later(room, room.options.timer * 1000 + 50, () => room.phase === "question" && reveal(room))
    publish(room)
  }

  const start = (pid, roomId) => {
    const room = rooms.get(roomId)
    if (!room || room.host !== pid || !playerOf(room, pid)) return { ok: false, error: "Only the host can start." }
    if (room.phase !== "lobby") return { ok: false, error: "The game has already started." }
    const n = active(room).length
    if (n < MODES[room.mode].min) return { ok: false, error: "Invite someone to play with first!" }
    if (n > MODES[room.mode].max) return { ok: false, error: `${MODES[room.mode].name} is for ${MODES[room.mode].max} players.` }
    room.note = null
    room.log = []
    room.scores = {}
    room.result = null
    room.recorded = false
    if (room.mode === "deep") {
      room.phase = "card"
      room.drawn = 0
      room.deck = {}
      draw(room, room.options.level)
      return { ok: true }
    }
    room.items = pickItems(room)
    room.step = 0
    begin(room)
    return { ok: true }
  }

  const answer = (pid, roomId, { step, answer: value } = {}) => {
    const room = rooms.get(roomId)
    if (!room || !playerOf(room, pid)) return { ok: false, error: "No such game." }
    if (room.phase !== "question" || Number(step) !== room.step) return { ok: false, error: "Too late for that question." }
    if (Object.hasOwn(room.answers, pid)) return { ok: false, error: "You've already answered." }
    const n = Number(value)
    if (!Number.isInteger(n) || n < 0 || n >= optionCount(room, room.items[room.step])) return { ok: false, error: "That isn't one of the answers." }
    room.answers[pid] = n
    room.answeredAt[pid] = clock.now()
    if (active(room).every((p) => Object.hasOwn(room.answers, p.pid))) reveal(room)
    else publish(room)
    return { ok: true }
  }

  // Everyone has answered (or time's up): show what everyone said
  const reveal = (room) => {
    stopTimers(room)
    const item = room.items[room.step]
    const answers = Object.fromEntries(active(room).map((p) => [p.pid, Object.hasOwn(room.answers, p.pid) ? room.answers[p.pid] : null]))
    const entry = { step: room.step, item: item.id, answers, names: Object.fromEntries(active(room).map((p) => [p.pid, p.name])) }
    if (room.mode === "knowme") {
      const guesser = active(room).find((p) => p.pid !== item.subject)
      entry.subject = item.subject
      entry.truth = answers[item.subject] ?? null
      entry.match = entry.truth !== null && guesser && answers[guesser.pid] === entry.truth
      if (entry.match && guesser) room.scores[guesser.pid] = (room.scores[guesser.pid] || 0) + 1
    } else if (room.mode === "tot") {
      const picks = Object.values(answers)
      entry.match = picks.length > 1 && picks.every((a) => a !== null && a === picks[0])
      if (entry.match) for (const pid of Object.keys(answers)) room.scores[pid] = (room.scores[pid] || 0) + 1
    } else {
      const q = lookup(room, item.id)
      entry.correct = q.answer
      entry.points = {}
      const total = room.options.timer * 1000
      for (const [pid, a] of Object.entries(answers)) {
        const left = room.deadline ? room.deadline - (room.answeredAt[pid] ?? room.deadline) : 0
        entry.points[pid] = lib.logic.triviaPoints(a === q.answer, left, total)
        room.scores[pid] = (room.scores[pid] || 0) + entry.points[pid]
      }
    }
    room.log[room.step] = entry
    room.phase = "reveal"
    room.revealAt = clock.now()
    publish(room)
  }

  const finish = (room, note = null) => {
    stopTimers(room)
    room.phase = "done"
    room.note = note
    const steps = room.log.filter(Boolean)
    if (room.mode === "knowme") {
      const matches = steps.filter((s) => s.match).length
      const players = Object.fromEntries(room.players.map((p) => [p.pid, { name: p.name, guessed: steps.filter((s) => s.subject !== p.pid && s.match).length, of: steps.filter((s) => s.subject !== p.pid).length }]))
      room.result = { percent: steps.length ? Math.round((matches / steps.length) * 100) : 0, matches, total: steps.length, players }
    } else if (room.mode === "tot") {
      const matches = steps.filter((s) => s.match).length
      room.result = { percent: steps.length ? Math.round((matches / steps.length) * 100) : 0, matches, total: steps.length }
    } else if (room.mode === "trivia") {
      const standings = room.players
        .map((p) => ({ id: p.pid, name: p.name, score: room.scores[p.pid] || 0, correct: steps.filter((s) => s.answers[p.pid] === s.correct).length, left: !!p.left }))
        .sort((a, b) => b.score - a.score)
      const top = standings[0]?.score || 0
      room.result = { standings, winners: standings.filter((s) => s.score === top && top > 0 && !s.left).map((s) => s.id), total: steps.length }
    } else room.result = { drawn: room.drawn }
    // two signed-in players who finished a couple game: keep their score together
    const people = active(room)
    if (!note && !room.recorded && (room.mode === "knowme" || room.mode === "tot") && people.length === 2 && people.every((p) => p.key) && people[0].key !== people[1].key) {
      room.recorded = true
      Promise.resolve(record({ a: people[0].key, b: people[1].key, mode: room.mode, percent: room.result.percent })).catch((error) => console.error("[quiz] couldn't save a score", error.message))
    }
    publish(room)
  }

  const next = (pid, roomId) => {
    const room = rooms.get(roomId)
    if (!room || !playerOf(room, pid)) return { ok: false, error: "No such game." }
    if (room.phase === "card") return draw(room, room.card?.level || room.options.level), { ok: true }
    if (room.phase !== "reveal") return { ok: false, error: "Not yet!" }
    if (clock.now() - room.revealAt < T.revealMin) return { ok: false, error: "Not yet!" }
    if (room.step + 1 >= room.items.length) finish(room)
    else {
      room.step++
      begin(room)
    }
    return { ok: true }
  }

  // Deep Talk: the next card of a level (each level is shuffled, then dealt in order)
  const draw = (room, level) => {
    const cards = lib.content.deep.filter((c) => c.level === level)
    let deck = room.deck[level]
    if (!deck || !deck.length) deck = room.deck[level] = lib.logic.shuffle(cards.map((c) => c.id), random).filter((id) => id !== room.card?.id)
    room.card = { id: deck.shift(), level }
    room.drawn++
    publish(room)
  }

  const setLevel = (pid, roomId, level) => {
    const room = rooms.get(roomId)
    if (!room || !playerOf(room, pid) || room.mode !== "deep" || room.phase !== "card") return { ok: false, error: "No such game." }
    draw(room, clampInt(level, 1, 3, 1))
    return { ok: true }
  }

  const again = (pid, roomId) => {
    const room = rooms.get(roomId)
    if (!room || room.host !== pid || !playerOf(room, pid)) return { ok: false, error: "Only the host can start a new game." }
    if (room.phase !== "done" && room.phase !== "card") return { ok: false, error: "The game isn't over yet." }
    stopTimers(room)
    room.round++
    room.phase = "lobby"
    room.items = []
    room.log = []
    room.step = 0
    room.scores = {}
    room.result = null
    room.note = null
    room.card = null
    publish(room)
    return { ok: true }
  }

  const react = (pid, roomId, kind) => {
    const room = rooms.get(roomId)
    const me = room && playerOf(room, pid)
    if (!me || !REACTIONS.includes(kind)) return { ok: false, error: "No such game." }
    const recent = (reactAt.get(pid) || []).filter((t) => clock.now() - t < 10_000)
    if (recent.length >= 12) return { ok: false, error: "Easy there!" }
    reactAt.set(pid, [...recent, clock.now()])
    for (const p of active(room)) send(p.pid, "quiz:reaction", { roomId, from: me.name, fromId: pid, kind })
    return { ok: true }
  }

  // ---------- leaving, dropping, coming back ----------

  const leave = (pid, roomId) => {
    const room = rooms.get(roomId)
    const me = room && playerOf(room, pid)
    if (!me) return { ok: true }
    clock.clearTimeout(me.awayTimer)
    if (room.phase === "lobby") room.players = room.players.filter((p) => p.pid !== pid)
    else me.left = true
    if (roomOf.get(pid) === roomId) roomOf.delete(pid)
    const left = active(room)
    if (!left.length) {
      stopTimers(room)
      rooms.delete(room.id)
      return { ok: true }
    }
    if (room.host === pid) room.host = left[0].pid
    const playing = room.phase === "question" || room.phase === "reveal"
    if (playing && left.length < MODES[room.mode].min) finish(room, `${me.name} left the game.`)
    else if (room.phase === "card" && left.length < 2) {
      room.note = `${me.name} left. You can keep drawing cards on your own.`
      publish(room)
    } else if (room.phase === "question" && left.every((p) => Object.hasOwn(room.answers, p.pid))) reveal(room)
    else publish(room)
    return { ok: true }
  }

  const setAway = (pid, away) => {
    const room = currentRoom(pid)
    if (!room) return
    const me = playerOf(room, pid)
    clock.clearTimeout(me.awayTimer)
    me.awayTimer = null
    me.away = away
    if (away) me.awayTimer = clock.setTimeout(() => me.away && leave(pid, room.id), T.grace)
    publish(room)
  }

  const drop = (pid) => {
    invited.delete(pid)
    reactAt.delete(pid)
    const room = currentRoom(pid)
    if (room) leave(pid, room.id)
  }

  // The Quiz Show window opened (or reconnected): send its room, or a pending invitation
  const hello = (pid) => {
    const room = currentRoom(pid)
    if (room) {
      send(pid, "quiz:room", view(room, pid))
      return { ok: true, roomId: room.id }
    }
    const inv = invited.get(pid)
    if (inv && clock.now() - inv.at < T.invite && rooms.has(inv.roomId)) {
      send(pid, "quiz:invited", { roomId: inv.roomId })
      return { ok: true, invited: inv.roomId }
    }
    return { ok: true }
  }

  // ---------- invitations (through games.js) ----------

  const canInvite = (pid, roomId) => {
    const room = rooms.get(roomId)
    if (!room || !playerOf(room, pid)) return { ok: false, error: "Open a Quiz Show game first." }
    if (active(room).length >= MODES[room.mode].max) return { ok: false, error: `${MODES[room.mode].name} is for ${MODES[room.mode].max} players.` }
    if (room.phase !== "lobby" && room.mode !== "deep") return { ok: false, error: "The game has already started." }
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
    if (!room) return { ok: false, error: "Sorry, that game has closed." }
    invited.set(pid, { roomId, at: clock.now() })
    send(pid, "quiz:invited", { roomId })
    return { ok: true, quizRoom: roomId }
  }

  const busy = (pid) => {
    const room = currentRoom(pid)
    return !!room && room.phase !== "lobby" && room.phase !== "done"
  }

  // ---------- sockets ----------

  // current(): this socket's computer or null; who(computer): { pid, name, key }
  const wire = (socket, current, who) => {
    const on = (event, handler) =>
      socket.on(event, (payload = {}, ack = () => {}) => {
        if (typeof ack !== "function") ack = () => {}
        const computer = current()
        if (!computer) return ack({ ok: false, error: "Not connected to the network." })
        try {
          ack(handler(who(computer), payload && typeof payload === "object" ? payload : {}) || { ok: true })
        } catch (error) {
          console.error(`[quiz] ${event} failed`, error)
          ack({ ok: false, error: "Something went wrong. Please try again." })
        }
      })
    const id = (v) => String(v ?? "")
    on("quiz:hello", (me) => hello(me.pid))
    on("quiz:create", (me, { mode, options }) => create(me, { mode: id(mode), options: options && typeof options === "object" ? options : {} }))
    on("quiz:join", (me, { roomId }) => join(me, id(roomId)))
    on("quiz:leave", (me, { roomId }) => leave(me.pid, id(roomId)))
    on("quiz:options", (me, { roomId, options }) => setOptions(me.pid, id(roomId), options && typeof options === "object" ? options : {}))
    on("quiz:start", (me, { roomId }) => start(me.pid, id(roomId)))
    on("quiz:answer", (me, { roomId, step, answer: value }) => answer(me.pid, id(roomId), { step, answer: value }))
    on("quiz:next", (me, { roomId }) => next(me.pid, id(roomId)))
    on("quiz:level", (me, { roomId, level }) => setLevel(me.pid, id(roomId), level))
    on("quiz:again", (me, { roomId }) => again(me.pid, id(roomId)))
    on("quiz:react", (me, { roomId, kind }) => react(me.pid, id(roomId), id(kind)))
  }

  return {
    ready,
    create,
    join,
    leave,
    setOptions,
    start,
    answer,
    next,
    setLevel,
    again,
    react,
    setAway,
    drop,
    hello,
    canInvite,
    invitedTo,
    inviteEnded,
    allow,
    busy,
    wire,
    rooms,
    // the people in a room, for its match chat
    playersOf: (roomId) => {
      const room = rooms.get(roomId)
      return room ? active(room).map((p) => p.pid) : null
    },
    modeOf: (roomId) => rooms.get(roomId)?.mode || null,
  }
}

module.exports = { createQuizLive, QUIZ_MODES: MODES, cleanOptions }
