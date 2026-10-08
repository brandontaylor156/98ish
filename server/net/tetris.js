// Tetris Online: Battle 2P, Arena (2-6 players) and Sprint Race (2-5) for the Tetris app.
//
// Each browser plays its own board (the engine in client/.../tetris/utils) and reports to
// the server: a compact snapshot of its board a few times a second, the attacks it sends,
// topping out, finishing a race. The server keeps the match: rooms and matchmaking, the
// clock, who gets each attack (and where its hole goes), KOs, placements and stars. It
// sanity-checks what clients claim (attack sizes and rates, board snapshots, race times)
// and runs computer players itself, with the same engine.
//
// Players are network computer ids (pids), plus a name and, for signed-in 98 Messenger
// users, a rank key (guests can play but don't rank). Like games.js it never touches
// sockets except in wire(); it talks through the emit(pid, event, payload) it's given.

const crypto = require("crypto")
const path = require("path")
const { pathToFileURL } = require("url")
const { rankOf } = require("./tetrisRanks")

const LIB_DIR = path.join(__dirname, "../../client/src/components/applets/tetris/utils")
const lib = { engine: null, bot: null, modes: null }
const load = (name) => import(pathToFileURL(path.join(LIB_DIR, `${name}.js`)).href)
const ready = Promise.all([load("engine"), load("bot"), load("modes")]).then(([engine, bot, modes]) => Object.assign(lib, { engine, bot, modes }))
ready.catch((error) => console.error("[tetris] couldn't load the engine", error))

const MODES = {
  battle: { name: "Battle 2P", min: 2, max: 2, duration: 120_000, kosToWin: 3, fill: 2 },
  arena: { name: "Arena", min: 2, max: 6, escalateAfter: 120_000, escalateEvery: 8_000, hardEnd: 300_000, fill: 4 },
  // (autoFill: alone in a Quick Match, computer racers fill in by themselves after botOffer and
  // the race starts, so a solo Sprint Race never just waits; the other modes offer the button)
  race: { name: "Sprint Race", min: 2, max: 5, duration: 180_000, goal: 40, fill: 4, autoFill: true },
}
const ITEMS = ["shield", "sweep", "mirror", "darkness"]
const OFFENSIVE = ["mirror", "darkness"]
const TARGETS = ["random", "leader", "danger", "attackers"]
const BOT_LEVELS = ["easy", "medium", "hard"]
const BOT_NAMES = ["Blocky", "Stacker", "Lineo", "Tess", "Quad", "Spinner", "Wedge"]
const SNAPSHOT = /^[.ijlostzg#]{200}$/

const TIMES = {
  countdown: 3000,
  autoStart: 8000, // a quick-match room with enough players waits this long for more
  botOffer: 10_000, // alone this long in a quick match: offer computer players
  grace: 5000, // disconnected this long mid-match: you lose
  boards: 150, // opponents' boards go out at most this often (about 6 a second)
  koCredit: 10_000, // a top-out counts as a KO for whoever attacked in the last 10 s
  invite: 60_000,
  effect: 5000, // Mirror and Darkness
}
const MAX_ATTACK = 24 // more than any single clear can send (T-spin triple + b2b + combo + perfect clear)
const ATTACK_BURST = 40 // lines a player may send in ATTACK_WINDOW
const ATTACK_WINDOW = 3000
const MIN_RACE_MS = 10_000 // nobody clears 40 lines faster than this
const MAX_ROOMS = 300
const FULL = { ok: false, error: "Tetris Online is full right now. Try again in a minute." }

const newId = () => crypto.randomBytes(6).toString("hex")
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v)) || 0))

const realClock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) }

// ---------- pure rules (exported for tests) ----------

// Who an Arena attack goes to. strategy: random | leader (most lines sent) | danger
// (tallest stack, closest to topping out) | attackers (whoever is targeting you)
const pickTarget = (players, from, strategy = "random", random = Math.random) => {
  const others = players.filter((p) => p.alive && p.pid !== from.pid)
  if (!others.length) return null
  const pickAmong = (list) => list[Math.floor(random() * list.length)]
  const best = (score) => {
    const top = Math.max(...others.map(score))
    return pickAmong(others.filter((p) => score(p) === top))
  }
  if (strategy === "leader") return best((p) => p.sent)
  if (strategy === "danger") return best((p) => p.height)
  if (strategy === "attackers") {
    const attackers = others.filter((p) => p.targetPid === from.pid)
    if (attackers.length) return pickAmong(attackers)
  }
  return pickAmong(others)
}

// Race standings: finishers by time, then those still going by lines, then those who
// topped out or left by lines
const raceOrder = (players) => {
  const group = (p) => (p.finishTime != null ? 0 : p.alive ? 1 : 2)
  return [...players].sort((a, b) => group(a) - group(b) || (group(a) === 0 ? a.finishTime - b.finishTime : b.lines - a.lines))
}

// Stars for a finished match. Wins count; bigger rooms pay more for the podium.
const starsFor = (mode, place, count) => {
  if (mode === "battle") return place === 1 ? 1 : 0
  if (place === 1) return count >= 4 ? 2 : 1
  if (place === 2 && count >= 4) return 1
  return 0
}

const createTetris = ({ emit, clock = realClock, random = Math.random, ranks = null, times: timeOverrides = {}, onChange = () => {} } = {}) => {
  const T = { ...TIMES, ...timeOverrides }
  const rooms = new Map() // id -> room
  const roomOf = new Map() // pid -> room id
  const invited = new Map() // pid -> { roomId, at }
  let ranksStore = null
  const getRanks = () => (ranksStore ??= Promise.resolve(ranks))
  const itemAt = new Map() // pid -> when they last used an item

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
    for (const p of room.players) if (p.bot?.timer) p.bot.timer = null
  }

  // ---------- views ----------

  const humans = (room) => room.players.filter((p) => !p.bot && !p.left)

  const playerView = (room, p) => ({
    id: p.pid,
    name: p.name,
    bot: p.bot ? p.bot.level : null,
    ranked: !!p.key,
    alive: p.alive,
    kos: p.kos,
    lines: p.lines,
    sent: p.sent,
    height: p.height,
    place: p.place,
    finishTime: p.finishTime,
    clientTime: p.clientTime,
    away: !!p.away,
    left: !!p.left,
    target: p.targetPid,
  })

  const view = (room, pid) => {
    const now = clock.now()
    const me = room.players.find((p) => p.pid === pid)
    const alone = humans(room).length === 1 && room.players.length === 1
    return {
      id: room.id,
      mode: room.mode,
      modeName: MODES[room.mode].name,
      phase: room.phase,
      private: room.private,
      quick: room.quick,
      round: room.round,
      host: room.host === pid,
      hostName: room.players.find((p) => p.pid === room.host)?.name || null,
      you: pid,
      seed: room.phase === "waiting" ? null : room.seed,
      now,
      startAt: room.startAt,
      endsAt: room.endsAt,
      escalateAt: room.escalateAt,
      waitingSince: room.waitingSince,
      canFillBots: room.phase === "waiting" && (room.private ? room.host === pid && room.players.length < MODES[room.mode].max : alone && now - room.waitingSince >= T.botOffer),
      min: MODES[room.mode].min,
      max: MODES[room.mode].max,
      strategy: me?.strategy || "random",
      players: room.players.map((p) => playerView(room, p)),
      invited: [...room.invitedNames],
      result: room.result,
    }
  }

  const publish = (room) => {
    for (const p of humans(room)) send(p.pid, "tetris:room", view(room, p.pid))
    onChange()
  }

  const toAll = (room, event, payload) => {
    for (const p of humans(room)) send(p.pid, event, { roomId: room.id, ...payload })
  }

  // ---------- rooms ----------

  const newPlayer = ({ pid, name, key = null }, bot = null) => ({
    pid,
    name,
    key: bot ? null : key,
    bot,
    alive: true,
    kos: 0,
    lines: 0,
    sent: 0,
    received: 0,
    height: 0,
    place: null,
    snap: null,
    strategy: "random",
    targetPid: null,
    lastHit: null, // { pid, at }: who attacked last (KO credit)
    attacks: [], // [{ at, lines }]
    finishTime: null,
    clientTime: null,
    left: false,
    away: false,
  })

  const makeRoom = (mode, { isPrivate = false, quick = false, host = null } = {}) => {
    const room = {
      id: newId(),
      mode,
      private: isPrivate,
      quick,
      host,
      round: 0,
      phase: "waiting",
      players: [],
      seed: null,
      startAt: null,
      endsAt: null,
      escalateAt: null,
      waitingSince: clock.now(),
      timers: new Set(),
      autoStart: null,
      dirty: new Set(),
      result: null,
      invitedNames: new Set(),
    }
    rooms.set(room.id, room)
    return room
  }

  const closeRoom = (room) => {
    stopTimers(room)
    rooms.delete(room.id)
    for (const p of room.players) if (roomOf.get(p.pid) === room.id) roomOf.delete(p.pid)
    onChange()
  }

  const currentRoom = (pid) => {
    const id = roomOf.get(pid)
    const room = id && rooms.get(id)
    return room && room.players.some((p) => p.pid === pid && !p.left) ? room : null
  }

  const addPlayer = (room, player) => {
    const p = newPlayer(player)
    room.players.push(p)
    roomOf.set(p.pid, room.id)
    invited.delete(p.pid)
    room.invitedNames.delete(p.name)
    if (!room.private && room.players.length === 1) room.waitingSince = clock.now()
    return p
  }

  // Leave the room you're in before joining another (a match in progress is forfeited)
  const leaveCurrent = (pid) => {
    const room = currentRoom(pid)
    if (room) leave(pid, room.id)
  }

  const checkQuickStart = (room) => {
    if (!room.quick || room.phase !== "waiting") return
    const n = room.players.length
    const { min, max } = MODES[room.mode]
    if (n >= max) return start(room)
    if (n >= min && !room.autoStart) room.autoStart = later(room, T.autoStart, () => room.phase === "waiting" && room.players.length >= min && start(room))
    // alone: offer computer players (or, for a race, fill them in and go)
    if (n === 1)
      later(room, T.botOffer, () => {
        if (room.phase !== "waiting") return
        const alone = humans(room).length === 1 && room.players.length === 1
        if (MODES[room.mode].autoFill && alone && lib.engine && clock.now() - room.waitingSince >= T.botOffer) return fillQuick(room, room.botLevel || "medium")
        publish(room)
      })
  }

  const quick = (player, mode, { level } = {}) => {
    if (!MODES[mode]) return { ok: false, error: "Unknown mode." }
    leaveCurrent(player.pid)
    let room = [...rooms.values()].find((r) => r.quick && r.mode === mode && r.phase === "waiting" && r.players.length < MODES[mode].max)
    if (!room && rooms.size >= MAX_ROOMS) return FULL
    if (!room) room = makeRoom(mode, { quick: true })
    // (the computer racers' level if nobody turns up: the one picked on this device)
    if (BOT_LEVELS.includes(level) && !room.players.length) room.botLevel = level
    addPlayer(room, player)
    publish(room)
    checkQuickStart(room)
    return { ok: true, roomId: room.id }
  }

  const create = (player, { mode = "battle", isPrivate = true } = {}) => {
    if (!MODES[mode]) return { ok: false, error: "Unknown mode." }
    leaveCurrent(player.pid)
    if (rooms.size >= MAX_ROOMS) return FULL
    const room = makeRoom(mode, { isPrivate: !!isPrivate, host: player.pid })
    addPlayer(room, player)
    publish(room)
    return { ok: true, roomId: room.id }
  }

  const join = (player, roomId) => {
    const room = rooms.get(roomId)
    if (!room) return { ok: false, error: "That room has closed." }
    if (room.players.some((p) => p.pid === player.pid && !p.left)) return publish(room), { ok: true, roomId }
    const wasInvited = invited.get(player.pid)?.roomId === roomId
    if (room.private && !wasInvited) return { ok: false, error: "That room is invitation only." }
    if (room.phase !== "waiting" && room.phase !== "over") return { ok: false, error: "That match has already started." }
    if (room.players.filter((p) => !p.left).length >= MODES[room.mode].max) return { ok: false, error: "That room is full." }
    leaveCurrent(player.pid)
    if (room.phase === "over") resetRoom(room)
    addPlayer(room, player)
    publish(room)
    checkQuickStart(room)
    return { ok: true, roomId }
  }

  // Public rooms waiting for players
  const list = () =>
    [...rooms.values()]
      .filter((r) => !r.private && r.phase === "waiting" && r.players.length < MODES[r.mode].max)
      .map((r) => ({ id: r.id, mode: r.mode, modeName: MODES[r.mode].name, players: r.players.map((p) => p.name), max: MODES[r.mode].max }))

  const setMode = (pid, roomId, mode) => {
    const room = rooms.get(roomId)
    if (!room || room.host !== pid) return { ok: false, error: "Only the host can change the mode." }
    if (!MODES[mode]) return { ok: false, error: "Unknown mode." }
    if (room.phase !== "waiting" && room.phase !== "over") return { ok: false, error: "The match has started." }
    if (room.players.length > MODES[mode].max) return { ok: false, error: `${MODES[mode].name} is for at most ${MODES[mode].max} players.` }
    if (room.phase === "over") resetRoom(room)
    room.mode = mode
    publish(room)
    return { ok: true }
  }

  const setStrategy = (pid, roomId, strategy) => {
    const room = rooms.get(roomId)
    const p = room?.players.find((q) => q.pid === pid)
    if (!p || !TARGETS.includes(strategy)) return { ok: false, error: "No such target." }
    p.strategy = strategy
    publish(room)
    return { ok: true }
  }

  // ---------- computer players ----------

  const botName = (room) => {
    const taken = new Set(room.players.map((p) => p.name))
    return BOT_NAMES.find((n) => !taken.has(n)) || `Bot ${room.players.length + 1}`
  }

  const addBot = (room, level) => {
    const p = newPlayer({ pid: `bot:${newId()}`, name: botName(room) }, { level, state: null, timer: null, slowUntil: 0 })
    room.players.push(p)
    return p
  }

  // Quick match alone: fill the room with computer players and start. Private room: the
  // host adds one at a time.
  const fillBots = (pid, roomId, level = "medium") => {
    const room = rooms.get(roomId)
    if (!room || !room.players.some((p) => p.pid === pid)) return { ok: false, error: "No such room." }
    if (room.phase !== "waiting") return { ok: false, error: "The match has started." }
    if (!BOT_LEVELS.includes(level)) level = "medium"
    if (!lib.engine) return { ok: false, error: "Tetris Online is still starting up. Try again in a moment." }
    if (room.private) {
      if (room.host !== pid) return { ok: false, error: "Only the host can add computer players." }
      if (room.players.length >= MODES[room.mode].max) return { ok: false, error: "The room is full." }
      addBot(room, level)
      publish(room)
      return { ok: true }
    }
    return fillQuick(room, level)
  }
  // the level computer racers will have if they fill in by themselves (a Sprint Race)
  const botLevel = (pid, roomId, level) => {
    const room = rooms.get(roomId)
    if (!room || !room.players.some((p) => p.pid === pid && !p.left) || room.phase !== "waiting") return { ok: false, error: "No such room." }
    if (!BOT_LEVELS.includes(level)) return { ok: false, error: "No such level." }
    room.botLevel = level
    return { ok: true }
  }
  const fillQuick = (room, level) => {
    while (room.players.length < MODES[room.mode].fill) addBot(room, level)
    room.botLevel = level
    start(room)
    return { ok: true }
  }

  const botSnap = (room, p) => {
    const st = p.bot.state
    p.snap = lib.engine.toSnapshot(st)
    p.height = lib.engine.stackHeight(st.board)
    p.lines = st.lines
    room.dirty.add(p.pid)
  }

  const botTurn = (room, p) => {
    if (room.phase !== "playing" || !p.alive || !p.bot) return
    const before = p.bot.state
    let st = lib.bot.botMove(before, p.bot.level, random)
    p.bot.state = st
    if (st.attack && st.attack.id !== before.attack?.id && st.attack.sent > 0) route(room, p, st.attack.sent)
    if (room.mode === "race" && st.lines >= MODES.race.goal && p.finishTime == null) {
      p.finishTime = clock.now() - room.startAt
      p.clientTime = p.finishTime
      p.lines = st.lines
      raceProgress(room)
    } else if (st.status === "over") {
      if (room.mode === "battle") p.bot.state = lib.engine.respawn(st)
      topout(p.pid, room.id)
    }
    if (rooms.get(room.id) !== room || room.phase !== "playing") return
    if (p.alive && p.bot) botSnap(room, p)
    scheduleBot(room, p)
  }

  const scheduleBot = (room, p) => {
    if (!p.alive || p.finishTime != null) return
    const { interval } = lib.bot.BOT_LEVELS[p.bot.level]
    const slow = clock.now() < p.bot.slowUntil ? 1.6 : 1
    p.bot.timer = later(room, Math.round(interval * slow * (0.8 + random() * 0.4)), () => botTurn(room, p))
  }

  // ---------- a match ----------

  const resetRoom = (room) => {
    stopTimers(room)
    room.players = room.players.filter((p) => !p.left)
    for (const p of room.players) Object.assign(p, newPlayer(p, p.bot ? { ...p.bot, state: null, timer: null } : null), { strategy: p.strategy, key: p.key })
    room.phase = "waiting"
    room.result = null
    room.autoStart = null
    room.startAt = room.endsAt = room.escalateAt = null
    room.waitingSince = clock.now()
  }

  const start = (room) => {
    if (room.phase === "over") resetRoom(room)
    if (room.phase !== "waiting") return { ok: false, error: "Already started." }
    if (room.players.length < MODES[room.mode].min) return { ok: false, error: `${MODES[room.mode].name} needs at least ${MODES[room.mode].min} players. Invite someone or add computer players.` }
    stopTimers(room)
    for (const inv of [...invited]) if (inv[1].roomId === room.id) invited.delete(inv[0])
    room.invitedNames.clear()
    room.round++
    room.phase = "countdown"
    room.seed = Math.floor(random() * 2 ** 31)
    room.startAt = clock.now() + T.countdown
    const m = MODES[room.mode]
    room.endsAt = m.duration ? room.startAt + m.duration : null
    room.escalateAt = m.escalateAfter ? room.startAt + m.escalateAfter : null
    for (const p of room.players) {
      if (p.bot) p.bot.state = lib.engine.createGame({ seed: room.seed, ...lib.modes.MODES[room.mode].options })
    }
    publish(room)
    later(room, T.countdown, () => begin(room))
    return { ok: true }
  }

  const begin = (room) => {
    room.phase = "playing"
    const m = MODES[room.mode]
    for (const p of room.players) if (p.bot) scheduleBot(room, p)
    if (m.duration) later(room, m.duration, () => finish(room, "time"))
    if (m.escalateAfter) later(room, m.escalateAfter, () => escalate(room))
    if (m.hardEnd) later(room, m.hardEnd, () => finish(room, "time"))
    flushLoop(room)
    publish(room)
  }

  // Arena overtime: everyone still standing gets garbage, more and more of it
  const escalate = (room) => {
    if (room.phase !== "playing") return
    const over = clock.now() - room.escalateAt
    const lines = 1 + Math.floor(over / 30_000)
    for (const p of room.players) if (p.alive) deliver(room, p, { lines, hole: Math.floor(random() * 10), solid: false, from: null })
    later(room, MODES.arena.escalateEvery, () => escalate(room))
  }

  const flushLoop = (room) => {
    if (room.dirty.size) {
      const boards = {}
      for (const pid of room.dirty) {
        const p = room.players.find((q) => q.pid === pid)
        if (p?.snap) boards[pid] = { b: p.snap, h: p.height, l: p.lines, s: p.sent }
      }
      room.dirty.clear()
      toAll(room, "tetris:boards", { boards })
    }
    if (room.phase === "playing") later(room, T.boards, () => flushLoop(room))
  }

  const deliver = (room, target, { lines, hole, solid, from }) => {
    target.received += lines
    if (from) target.lastHit = { pid: from.pid, at: clock.now() }
    if (target.bot) {
      target.bot.state = lib.engine.receiveGarbage(target.bot.state, { lines, hole, solid })
      return
    }
    send(target.pid, "tetris:garbage", { roomId: room.id, from: from?.pid || null, fromName: from?.name || "Arena", lines, hole, solid })
  }

  // An attack goes to the opponent (Battle: solid rows) or a target (Arena: one hole)
  const route = (room, from, lines) => {
    if (room.mode === "race") return null
    const target = room.mode === "battle" ? room.players.find((p) => p.pid !== from.pid) : pickTarget(room.players, from, from.strategy, random)
    if (!target) return null
    from.sent += lines
    from.targetPid = target.pid
    deliver(room, target, { lines, hole: Math.floor(random() * 10), solid: room.mode === "battle", from })
    return target
  }

  const playing = (pid, roomId) => {
    const room = rooms.get(roomId)
    const p = room?.players.find((q) => q.pid === pid && !q.left)
    if (!room || !p) return { error: "No such match." }
    if (room.phase !== "playing") return { error: "The match isn't on." }
    return { room, p }
  }

  const attack = (pid, roomId, { lines } = {}) => {
    const { room, p, error } = playing(pid, roomId)
    if (error) return { ok: false, error }
    if (!p.alive) return { ok: false, error: "You're out." }
    const n = Number(lines)
    if (!Number.isInteger(n) || n < 1 || n > MAX_ATTACK) return { ok: false, error: "Bad attack." }
    const now = clock.now()
    p.attacks = p.attacks.filter((a) => now - a.at < ATTACK_WINDOW)
    if (p.attacks.reduce((sum, a) => sum + a.lines, 0) + n > ATTACK_BURST) return { ok: false, error: "Too many attacks." }
    p.attacks.push({ at: now, lines: n })
    const target = route(room, p, n)
    return { ok: true, target: target?.pid || null }
  }

  const state = (pid, roomId, { b, lines, height } = {}) => {
    const { room, p, error } = playing(pid, roomId)
    if (error) return { ok: false, error }
    if (typeof b !== "string" || !SNAPSHOT.test(b)) return { ok: false, error: "Bad board." }
    const now = clock.now()
    if (p.lastSnapAt && now - p.lastSnapAt < 60) return { ok: true } // too often: skip
    p.lastSnapAt = now
    p.snap = b
    p.height = clampInt(height, 0, 22)
    const l = clampInt(lines, 0, 9999)
    if (l >= p.lines && l <= p.lines + 8) p.lines = l // a few lines per update at most
    room.dirty.add(pid)
    return { ok: true }
  }

  // Topped out. Battle: the board is refilled and the opponent scores a KO. Arena: out,
  // and whoever attacked last gets the KO. Race: out.
  const topout = (pid, roomId) => {
    const { room, p, error } = playing(pid, roomId)
    if (error) return { ok: false, error }
    if (!p.alive) return { ok: true }
    const now = clock.now()
    if (p.lastTopout && now - p.lastTopout < 1000) return { ok: true }
    p.lastTopout = now
    if (room.mode === "battle") {
      const other = room.players.find((q) => q.pid !== pid)
      other.kos++
      toAll(room, "tetris:ko", { by: other.pid, byName: other.name, victim: pid, victimName: p.name })
      if (other.kos >= MODES.battle.kosToWin) finish(room, "kos")
      else publish(room)
      return { ok: true }
    }
    eliminate(room, p, now)
    return { ok: true }
  }

  const eliminate = (room, p, now = clock.now()) => {
    const alive = room.players.filter((q) => q.alive)
    p.alive = false
    p.place = alive.length
    if (room.mode === "arena") {
      const hit = p.lastHit && now - p.lastHit.at <= T.koCredit && room.players.find((q) => q.pid === p.lastHit.pid)
      if (hit) hit.kos++
      toAll(room, "tetris:ko", { by: hit?.pid || null, byName: hit?.name || null, victim: p.pid, victimName: p.name })
      if (alive.length - 1 <= 1) return finish(room, "last")
      return publish(room)
    }
    raceProgress(room)
  }

  const raceProgress = (room) => {
    if (room.players.every((p) => p.finishTime != null || !p.alive)) return finish(room, "done")
    publish(room)
  }

  const finishRace = (pid, roomId, { time, lines } = {}) => {
    const { room, p, error } = playing(pid, roomId)
    if (error) return { ok: false, error }
    if (room.mode !== "race") return { ok: false, error: "Not a race." }
    if (!p.alive || p.finishTime != null) return { ok: true }
    const elapsed = clock.now() - room.startAt
    if (Number(lines) < MODES.race.goal || elapsed < MIN_RACE_MS) return { ok: false, error: "That doesn't add up." }
    p.finishTime = elapsed
    p.clientTime = clampInt(time, 0, elapsed + 2000)
    p.lines = MODES.race.goal
    raceProgress(room)
    return { ok: true }
  }

  const finish = (room, reason) => {
    if (room.phase !== "playing" && room.phase !== "countdown") return
    stopTimers(room)
    room.phase = "over"
    const players = room.players
    let order
    let draw = false
    if (room.mode === "race") order = raceOrder(players)
    else if (room.mode === "battle") {
      const [a, b] = players
      const aWins = a.kos !== b.kos ? a.kos > b.kos : a.sent !== b.sent ? a.sent > b.sent : null
      if (a.left !== b.left) order = a.left ? [b, a] : [a, b]
      else order = aWins === null ? [a, b] : aWins ? [a, b] : [b, a]
      draw = aWins === null && a.left === b.left
      order.forEach((p, i) => (p.place = draw ? 1 : i + 1))
    } else {
      // Arena: those still standing share the top places by KOs and lines sent
      const standing = players.filter((p) => p.alive).sort((a, b) => b.kos - a.kos || b.sent - a.sent)
      standing.forEach((p, i) => (p.place = i + 1))
      order = [...players].sort((a, b) => a.place - b.place)
    }
    if (room.mode === "race") order.forEach((p, i) => (p.place = i + 1))
    const count = players.length
    const humanCount = players.filter((p) => !p.bot).length
    // stars need someone to beat: another person, or hard computer players
    const ranked = humanCount >= 2 || players.some((p) => p.bot?.level === "hard")
    room.result = {
      reason,
      ranked,
      draw,
      placements: order.map((p) => ({
        id: p.pid,
        name: p.name,
        place: p.place,
        bot: p.bot ? p.bot.level : null,
        kos: p.kos,
        sent: p.sent,
        lines: p.lines,
        time: p.finishTime,
        clientTime: p.clientTime,
        stars: !p.bot && p.key && ranked && !draw ? starsFor(room.mode, p.place, count) : 0,
        left: p.left,
      })),
    }
    publish(room)
    recordRanks(room)
    for (const p of players) if (p.bot) p.bot.state = null
  }

  const recordRanks = (room) => {
    const store = getRanks()
    for (const r of room.result.placements) {
      const p = room.players.find((q) => q.pid === r.id)
      if (!p || p.bot || !p.key || !room.result.ranked) continue
      store
        .then((s) => s && s.record(p.key, p.name, room.mode, { stars: r.stars, win: r.place === 1 && !room.result.draw }))
        .then((m) => m && send(p.pid, "tetris:rank", { mode: room.mode, ...m, ...rankOf(m.stars), gained: r.stars }))
        .catch((error) => console.error("[tetris] couldn't save ranks", error.message))
    }
  }

  // Arena items: Shield and Sweep work on your own board (the server only tells the room);
  // Mirror and Darkness hit a target for a few seconds
  const useItem = (pid, roomId, { item } = {}) => {
    const { room, p, error } = playing(pid, roomId)
    if (error) return { ok: false, error }
    if (room.mode !== "arena" || !ITEMS.includes(item) || !p.alive) return { ok: false, error: "No such item." }
    if (clock.now() - (itemAt.get(pid) ?? -Infinity) < 3000) return { ok: false, error: "Too fast." }
    itemAt.set(pid, clock.now())
    let target = null
    if (OFFENSIVE.includes(item)) {
      target = pickTarget(room.players, p, p.strategy, random)
      if (!target) return { ok: false, error: "Nobody to hit." }
      if (target.bot) target.bot.slowUntil = clock.now() + T.effect
      else send(target.pid, "tetris:effect", { roomId: room.id, item, from: p.pid, fromName: p.name, ms: T.effect })
    }
    toAll(room, "tetris:item", { item, by: p.pid, byName: p.name, target: target?.pid || null, targetName: target?.name || null })
    return { ok: true, target: target?.pid || null }
  }

  // ---------- leaving and connections ----------

  const leave = (pid, roomId) => {
    const room = rooms.get(roomId)
    const p = room?.players.find((q) => q.pid === pid && !q.left)
    if (!p) return { ok: true }
    if (room.phase === "playing" || room.phase === "countdown") {
      // a match in progress: you lose it (the others play on)
      p.left = true
      clock.clearTimeout(p.awayTimer)
      if (room.mode === "battle" && room.phase === "playing") {
        finish(room, "left")
      } else if (room.phase === "countdown") {
        p.alive = false
        if (room.players.filter((q) => !q.left).length < 2) finish(room, "left")
        else publish(room)
      } else if (p.alive) {
        eliminate(room, p)
      }
      if (rooms.get(room.id) === room && room.phase === "over") publish(room)
    } else {
      room.players = room.players.filter((q) => q !== p)
    }
    if (roomOf.get(pid) === room.id) roomOf.delete(pid)
    if (!humans(room).length) return closeRoom(room), { ok: true }
    if (room.host === pid) room.host = humans(room)[0].pid
    if (room.phase === "waiting" && room.quick && room.players.length < MODES[room.mode].min && room.autoStart) {
      clock.clearTimeout(room.autoStart)
      room.timers.delete(room.autoStart)
      room.autoStart = null
    }
    publish(room)
    return { ok: true }
  }

  // Lost connection mid-match: a short grace, then you lose that match
  const setAway = (pid, away) => {
    const room = currentRoom(pid)
    if (!room) return
    const p = room.players.find((q) => q.pid === pid)
    clock.clearTimeout(p.awayTimer)
    p.awayTimer = null
    p.away = away
    if (away && (room.phase === "playing" || room.phase === "countdown")) {
      p.awayTimer = clock.setTimeout(() => {
        if (p.away) leave(pid, room.id)
      }, T.grace)
    }
    if (rooms.get(room.id) === room) publish(room)
  }

  const drop = (pid) => {
    invited.delete(pid)
    itemAt.delete(pid)
    const room = currentRoom(pid)
    if (room) leave(pid, room.id)
  }

  // A Tetris window opened (or reconnected): send its room, or a pending invitation
  const hello = (pid) => {
    const room = currentRoom(pid)
    if (room) {
      send(pid, "tetris:room", view(room, pid))
      return { ok: true, roomId: room.id }
    }
    const inv = invited.get(pid)
    if (inv && clock.now() - inv.at < T.invite && rooms.has(inv.roomId)) {
      send(pid, "tetris:invited", { roomId: inv.roomId })
      return { ok: true, invited: inv.roomId }
    }
    return { ok: true }
  }

  // Invitations go through games.js (Network Neighborhood and 98 Messenger); accepting one
  // lets you into the private room
  const canInvite = (pid, roomId) => {
    const room = rooms.get(roomId)
    if (!room || !room.players.some((p) => p.pid === pid)) return { ok: false, error: "Open a Tetris Online room first." }
    if (room.players.length >= MODES[room.mode].max) return { ok: false, error: "The room is full." }
    if (room.phase === "playing" || room.phase === "countdown") return { ok: false, error: "The match has already started." }
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
    if (!room) return { ok: false, error: "Sorry, that Tetris room has closed." }
    invited.set(pid, { roomId, at: clock.now() })
    send(pid, "tetris:invited", { roomId })
    return { ok: true, tetrisRoom: roomId }
  }

  const busy = (pid) => {
    const room = currentRoom(pid)
    return !!room && (room.phase === "playing" || room.phase === "countdown")
  }

  const leaderboard = async (mode, key) => {
    if (!MODES[mode]) return { ok: false, error: "Unknown mode." }
    const store = await getRanks()
    if (!store) return { ok: true, top: [], me: null }
    const top = (await store.top(mode, 20)).map((r) => ({ ...r, ...rankOf(r.stars) }))
    const mine = key ? await store.get(key) : null
    const m = mine?.modes?.[mode] || (key ? { stars: 0, wins: 0, played: 0 } : null)
    return { ok: true, top, me: m && { ...m, ...rankOf(m.stars) } }
  }

  // ---------- sockets ----------

  // current(): this socket's computer or null; who(computer): { pid, name, key }
  const wire = (socket, current, who) => {
    const on = (event, handler) =>
      socket.on(event, async (payload = {}, ack = () => {}) => {
        if (typeof ack !== "function") ack = () => {}
        const computer = current()
        if (!computer) return ack({ ok: false, error: "Not connected to the network." })
        try {
          ack((await handler(who(computer), payload && typeof payload === "object" ? payload : {})) || { ok: true })
        } catch (error) {
          console.error(`[tetris] ${event} failed`, error)
          ack({ ok: false, error: "Something went wrong. Please try again." })
        }
      })
    const id = (v) => String(v ?? "")
    on("tetris:hello", (me) => hello(me.pid))
    on("tetris:quick", (me, { mode, level }) => quick(me, id(mode), { level: id(level) }))
    on("tetris:botLevel", (me, { roomId, level }) => botLevel(me.pid, id(roomId), id(level)))
    on("tetris:create", (me, { mode, isPrivate }) => create(me, { mode: id(mode), isPrivate: isPrivate !== false }))
    on("tetris:join", (me, { roomId }) => join(me, id(roomId)))
    on("tetris:list", () => ({ ok: true, rooms: list() }))
    on("tetris:leave", (me, { roomId }) => leave(me.pid, id(roomId)))
    on("tetris:mode", (me, { roomId, mode }) => setMode(me.pid, id(roomId), id(mode)))
    on("tetris:start", (me, { roomId }) => {
      const room = rooms.get(id(roomId))
      if (!room || room.host !== me.pid) return { ok: false, error: "Only the host can start." }
      return start(room)
    })
    on("tetris:bots", (me, { roomId, level }) => fillBots(me.pid, id(roomId), id(level)))
    on("tetris:target", (me, { roomId, strategy }) => setStrategy(me.pid, id(roomId), id(strategy)))
    on("tetris:state", (me, { roomId, ...snap }) => state(me.pid, id(roomId), snap))
    on("tetris:attack", (me, { roomId, lines }) => attack(me.pid, id(roomId), { lines }))
    on("tetris:topout", (me, { roomId }) => topout(me.pid, id(roomId)))
    on("tetris:finish", (me, { roomId, time, lines }) => finishRace(me.pid, id(roomId), { time, lines }))
    on("tetris:item", (me, { roomId, item }) => useItem(me.pid, id(roomId), { item: id(item) }))
    on("tetris:leaderboard", (me, { mode }) => leaderboard(id(mode), me.key))
  }

  return {
    ready,
    quick,
    create,
    join,
    list,
    leave,
    setMode,
    setStrategy,
    fillBots,
    botLevel,
    // the people (not computer players) in a room, for its match chat
    playersOf: (roomId) => {
      const room = rooms.get(roomId)
      return room ? humans(room).map((p) => p.pid) : null
    },
    start: (pid, roomId) => {
      const room = rooms.get(roomId)
      if (!room || room.host !== pid) return { ok: false, error: "Only the host can start." }
      return start(room)
    },
    state,
    attack,
    topout,
    finishRace,
    useItem,
    setAway,
    drop,
    hello,
    canInvite,
    invitedTo,
    inviteEnded,
    allow,
    busy,
    leaderboard,
    wire,
    rooms,
  }
}

module.exports = { createTetris, pickTarget, raceOrder, starsFor, TETRIS_MODES: MODES, ITEMS, TARGETS, ready }
