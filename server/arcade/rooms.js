// Online rooms: the shared multiplayer layer for 98ish games. A game writes its rules as a
// small module; this file does everything else: Quick Match, private rooms with join codes,
// invitations (through Network Neighborhood / 98 Messenger, server/net/games.js), seats,
// ready-up, kicking, computer players, timers, rematches, spectators, reconnecting, rate
// limits and game chat (server/gamechat knows the room's players). The browser side is
// client/src/components/shared/online (useOnlineRoom, PlayOnline, PlayOnlineButton).
//
// ============================== ADDING A NEW ONLINE GAME ==============================
//
// 1. Write the rules: server/arcade/games/<id>.js exporting a module (plain data, no I/O):
//
//      module.exports = {
//        id: "tictactoe",               // short, [a-z0-9-]; also the client's game id
//        name: "Tic-Tac-Toe",           // shown in invitations and chat
//        minPlayers: 2, maxPlayers: 2,
//        defaultSettings: { size: 3 },
//        // the settings a room may use: return the cleaned settings, or { error }
//        validateSettings: (s) => ([3, 4].includes(s.size) ? { size: s.size } : { error: "Pick 3 or 4." }),
//        // a new game. players: [{ id, name, bot }] where id is the seat number 0..n-1
//        create: ({ players, settings, random, now, after }) => ({ board: Array(9).fill(null), turn: 0, players: players.length }),
//        // a player's move -> the next state, or { error: "Not your turn." } to refuse it.
//        // playerId is the seat, or null for the server (timers and ticks). Never mutate
//        // `state`: return a new object.
//        action: (state, playerId, action, ctx) => { ... },
//        // what one player may see (hide other hands here!). playerId null = a spectator
//        view: (state, playerId) => ({ board: state.board, yourTurn: state.turn === playerId }),
//        // null while playing, then { winners: [seat...], draw?, reason? }
//        isOver: (state) => state.winner == null ? null : { winners: [state.winner], reason: "three" },
//        // optional: a computer player's next action, or null if it has nothing to do
//        bot: (state, playerId, { random }) => (state.turn === playerId ? { type: "mark", cell: ... } : null),
//      }
//
//    Optional fields: botDelay (ms before a computer player acts, default 700; or a function
//    (state, seat, action, { now }) -> ms, and then the computer player with the quickest
//    move goes first: thinking times, catching someone a moment after a slip), fillTo
//    (Quick Match fills up to this many seats with computer players; default maxPlayers),
//    tickMs (the server sends action { type: "tick" } with playerId null this often while
//    playing), bucket(settings) (Quick Match pairs people whose bucket matches; default: all
//    settings must match), spectate: false (no spectators; or a function of the settings),
//    seats(settings) (how many seats a room with these settings has, minPlayers..maxPlayers;
//    default maxPlayers: e.g. a "players" setting), relay: true (see below),
//    onLeave(state, seat, ctx) -> state (a player left for good and there's no bot: carry
//    on without them; default: everyone else wins, reason "left"), quickSeats(settings) (Quick
//    Match treats a room as full, and starts it, at this many players; default maxPlayers).
//    An action (or tick) that returns the very same state object changed nothing: nobody
//    is sent an update.
//
//    Timers: ctx.after(ms, action, key = "timer") makes the server call
//    action(state, null, action, ctx) later (a turn clock, a round timer). A new timer with
//    the same key replaces the old one; ctx.cancel(key) drops it. Timers set by a refused
//    action never start, and all timers stop when the game ends. ctx also has now, random
//    and players. create() gets `after` too.
//
// 2. List it in server/arcade/games/index.js. That's the server done: no socket code.
//
// 3. Client: see client/src/components/shared/online/index.js (useOnlineRoom + PlayOnline),
//    and give the game's program entry in client/src/utils/programs.js `online: "<id>"` so
//    invitations and join links open the right window.
//
// Real-time games (relay: true, e.g. Pickleball): no create/action/view. The host's
// browser runs the simulation and streams snapshots (room:snap, ~20-30 a second, volatile:
// late ones are dropped, never queued); guests send inputs (room:input) that go only to the
// host; room:relay carries reliable messages (a point scored); the host ends the game with
// room:finish { result }. If anyone leaves mid-game the room goes back to its lobby.
//
// Socket events (client -> server, all with an ack unless noted; every answer is
// { ok: true, ... } or { ok: false, error } with a sentence to show):
//   room:hello    { game }               -> { roomId? , invited? }  (also re-sends room:state)
//   room:quick    { game, settings }     -> { roomId }   Quick Match
//   room:create   { game, settings }     -> { roomId, code }   a private room
//   room:join     { code } | { roomId }  -> { roomId, spectator }
//   room:peek     { code }               -> { game, gameName }   (for join links)
//   room:leave    { roomId }
//   room:ready    { roomId, ready }
//   room:settings { roomId, settings }   host, in the lobby
//   room:start    { roomId }             host
//   room:kick     { roomId, seat }       host, in the lobby
//   room:bots     { roomId }             fill empty seats with computer players
//   room:act      { roomId, action }     a move (turn-based games)
//   room:rematch  { roomId }
//   room:lobby    { roomId }             host, after a game: back to the lobby
//   room:snap     { roomId, data }       relay host -> everyone (no ack, volatile)
//   room:input    { roomId, data }       relay guest -> host (no ack, volatile)
//   room:relay    { roomId, data, to? }  reliable relay message (host -> all or seat `to`, guest -> host)
//   room:finish   { roomId, result }     relay host ends the game
// Server -> client: room:state (your view of the room, below), room:gone { roomId, reason },
// room:invited { roomId, game }, room:snap { roomId, data }, room:input { roomId, from, data },
// room:relay { roomId, from, data }.
//
// room:state: { id, code, game, gameName, mode: "turns" | "relay", phase: "lobby" |
// "playing" | "over", private, quick, round, rev, now, settings, you (your seat or null),
// spectator, host (are you), hostName, seats: [{ seat, name, bot, ready, away, left, host,
// you, user } | null], min, max, spectators: [names], invited: [names], canStart,
// waitingFor (why it can't start yet), canFillBots, botOfferAt, startsAt, result
// ({ winners, winnerNames, draw, reason } once over), rematch: [seats], notice, view (the
// game's view(state, you)) }
//
// Players are network computer ids (pids) with a name, exactly as Network Neighborhood
// knows them (98 Messenger screen name, or GUEST-XXXX): guests can play. A dropped
// connection keeps its seat for the network's 30 second grace (server/net/index.js), then a
// computer player takes over (or the game is forfeited). Everything lives in memory.

const crypto = require("crypto")
const { limiter } = require("../net/limiter")

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no I, O, 0 or 1 to misread
const CODE = /^[A-Z0-9]{4}$/
const GAME_ID = /^[a-z0-9-]{1,24}$/
const TIMES = {
  botOffer: 15_000, // alone this long in Quick Match: offer computer players
  quickStart: 8_000, // Quick Match with enough players (but room for more) starts after this
  botDelay: 700,
  invite: 60_000,
}
const MAX_ROOMS = 1000
const MAX_ACTION = 4096 // characters of JSON in one move
const MAX_RELAY = 32 * 1024 // characters of JSON in one snapshot or relay message
const BOT_NAMES = ["Ada", "Grace", "Alan", "Linus", "Hedy", "Dennis", "Ken", "Barbara"]
const FULL = { ok: false, error: "The game server is full right now. Try again in a minute." }

const realClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms)
    handle.unref?.()
    return handle
  },
  clearTimeout: (h) => clearTimeout(h),
}

const newId = () => crypto.randomBytes(6).toString("hex")
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v)
// a move a rules module refused: { error: "..." } and nothing else
const isRefusal = (v) => isObject(v) && typeof v.error === "string" && Object.keys(v).length === 1
const sizeOf = (v) => {
  try {
    return JSON.stringify(v ?? null).length
  } catch {
    return Infinity
  }
}
// settings as a string that doesn't depend on key order (the Quick Match bucket)
const stable = (v) => (isObject(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}` : Array.isArray(v) ? `[${v.map(stable).join(",")}]` : JSON.stringify(v ?? null))

// games: the rules modules; emit(pid, event, payload) reaches one computer, emitVolatile
// the same but may drop it (snapshots); blocked(a, b): either blocks the other in 98 Messenger
const createRooms = ({ games = [], emit = () => {}, emitVolatile = null, blocked = () => false, clock = realClock, random = Math.random, times = {}, maxRooms = MAX_ROOMS } = {}) => {
  const T = { ...TIMES, ...times }
  const volatile = emitVolatile || emit
  const registry = new Map()
  const rooms = new Map() // id -> room
  const codes = new Map() // code -> room
  const roomOf = new Map() // pid -> room id (one room at a time)
  const invited = new Map() // pid -> { roomId, at } let in by an accepted invitation
  const listeners = new Set() // game chat: (roomId, text)

  const actLimit = limiter(40, 10_000)
  const joinLimit = limiter(20, 60_000)
  const snapLimit = limiter(80, 2000) // 40 a second
  const inputLimit = limiter(140, 2000) // 70 a second

  const send = (pid, event, payload) => pid && emit(pid, event, payload)
  const say = (room, text) => listeners.forEach((fn) => fn(room.id, text))

  const register = (mod) => {
    if (!mod || !GAME_ID.test(mod.id || "")) throw new Error(`[rooms] a game needs an id like "uno": ${mod?.id}`)
    if (!mod.relay && (typeof mod.create !== "function" || typeof mod.action !== "function")) throw new Error(`[rooms] ${mod.id} needs create() and action() (or relay: true)`)
    if (!(mod.minPlayers >= 1 && mod.maxPlayers >= mod.minPlayers && mod.maxPlayers <= 12)) throw new Error(`[rooms] ${mod.id}: bad minPlayers/maxPlayers`)
    registry.set(mod.id, mod)
  }
  games.forEach(register)

  // ---------- who's where ----------

  const humans = (room) => room.seats.filter((s) => s && !s.bot && !s.left)
  const seatOf = (room, pid) => room.seats.findIndex((s) => s && !s.bot && !s.left && s.pid === pid)
  const audience = (room) => [...humans(room).map((s) => s.pid), ...room.spectators.keys()]
  const filled = (room) => room.seats.filter(Boolean).length
  const freeSeat = (room) => room.seats.findIndex((s) => !s)
  const currentRoom = (pid) => {
    const room = rooms.get(roomOf.get(pid))
    return room && (seatOf(room, pid) >= 0 || room.spectators.has(pid)) ? room : null
  }
  const inRoom = (room, pid) => !!room && (seatOf(room, pid) >= 0 || room.spectators.has(pid))

  // ---------- settings ----------

  const cleanSettings = (mod, raw) => {
    const settings = { ...(mod.defaultSettings || {}), ...(isObject(raw) ? raw : {}) }
    if (sizeOf(settings) > 2048) return { error: "Those settings are too big." }
    if (!mod.validateSettings) return { settings: mod.defaultSettings ? Object.fromEntries(Object.keys(mod.defaultSettings).map((k) => [k, settings[k]])) : {} }
    try {
      const result = mod.validateSettings(settings)
      if (!isObject(result)) return { error: "Those settings aren't allowed." }
      if (typeof result.error === "string") return { error: result.error }
      return { settings: result }
    } catch (error) {
      console.error(`[rooms] ${mod.id} validateSettings failed`, error)
      return { error: "Those settings aren't allowed." }
    }
  }
  // how many seats a room has (the game's seats(settings), else its maxPlayers)
  const capacityFor = (mod, settings) => {
    if (typeof mod.seats !== "function") return mod.maxPlayers
    try {
      const n = Math.round(Number(mod.seats(settings)))
      return Number.isFinite(n) ? Math.min(mod.maxPlayers, Math.max(mod.minPlayers, n)) : mod.maxPlayers
    } catch {
      return mod.maxPlayers
    }
  }
  const capacity = (room) => capacityFor(room.game, room.settings)
  const canWatch = (room) => {
    const s = room.game.spectate
    if (typeof s !== "function") return s !== false
    try {
      return s(room.settings) !== false
    } catch {
      return true
    }
  }
  const bucketOf = (mod, settings) => `${mod.id}:${mod.bucket ? String(mod.bucket(settings)) : stable(settings)}`

  // ---------- views ----------

  // why the host can't start yet, or null
  const startProblem = (room) => {
    const count = filled(room)
    const mod = room.game
    if (count < mod.minPlayers) {
      const need = mod.minPlayers - count
      return `Waiting for ${need} more player${need === 1 ? "" : "s"}.`
    }
    const unready = room.seats.filter((s) => s && !s.bot && s.pid !== room.host && !s.ready)
    if (unready.length) return `Waiting for ${unready.map((s) => s.name).join(", ")} to be ready.`
    return null
  }

  const botsAllowed = (room) => !!room.game.bot && !room.game.relay

  const view = (room, pid) => {
    const mod = room.game
    const seat = seatOf(room, pid)
    const spectator = seat < 0
    const now = clock.now()
    let gameView = null
    if (room.state != null && mod.view) {
      try {
        gameView = mod.view(room.state, spectator ? null : seat)
      } catch (error) {
        console.error(`[rooms] ${mod.id} view failed`, error)
      }
    }
    const hostSeat = room.seats.find((s) => s && !s.bot && s.pid === room.host)
    const problem = room.phase === "lobby" ? startProblem(room) : null
    const alone = humans(room).length === 1 && filled(room) === 1
    return {
      id: room.id,
      code: room.code,
      game: mod.id,
      gameName: mod.name,
      mode: mod.relay ? "relay" : "turns",
      phase: room.phase,
      private: room.private,
      quick: room.quick,
      round: room.round,
      rev: room.rev,
      now,
      settings: room.settings,
      you: spectator ? null : seat,
      spectator,
      host: room.host === pid,
      hostName: hostSeat?.name || null,
      seats: room.seats.map((s, i) =>
        s
          ? { seat: i, name: s.name, bot: !!s.bot, ready: !!(s.bot || s.ready || s.pid === room.host), away: !!s.away, left: !!s.left, host: !s.bot && s.pid === room.host, you: !s.bot && !s.left && s.pid === pid, user: !!s.key }
          : null
      ),
      min: mod.minPlayers,
      max: capacity(room),
      spectators: [...room.spectators.values()],
      invited: [...room.invitedNames],
      canStart: room.phase === "lobby" && room.host === pid && !room.quick && !problem,
      waitingFor: problem,
      canFillBots: room.phase === "lobby" && botsAllowed(room) && freeSeat(room) >= 0 && (room.quick ? alone && now >= room.waitingSince + T.botOffer : room.host === pid),
      botOfferAt: room.quick && botsAllowed(room) && room.phase === "lobby" ? room.waitingSince + T.botOffer : null,
      startsAt: room.startsAt,
      result: room.result,
      rematch: [...room.rematch],
      notice: room.notice,
      view: gameView,
    }
  }

  const publish = (room) => {
    if (rooms.get(room.id) !== room) return
    room.rev++
    for (const pid of audience(room)) send(pid, "room:state", view(room, pid))
  }

  // ---------- timers ----------

  const stopTimers = (room) => {
    for (const h of room.timers.values()) clock.clearTimeout(h)
    room.timers.clear()
    clock.clearTimeout(room.botTimer)
    room.botTimer = null
  }
  const stopAutoStart = (room) => {
    clock.clearTimeout(room.autoStart)
    room.autoStart = null
    room.startsAt = null
  }

  // what rules modules get with every call
  const contextFor = (room, pending) => ({
    now: clock.now(),
    random,
    players: room.seats.map((s, i) => ({ id: i, name: s?.name || null, bot: !!s?.bot })),
    after: (ms, action, key = "timer") => pending.set(String(key), { ms: Math.max(0, Number(ms) || 0), action }),
    cancel: (key = "timer") => pending.set(String(key), null),
  })

  const commitTimers = (room, pending) => {
    for (const [key, timer] of pending) {
      if (room.timers.has(key)) clock.clearTimeout(room.timers.get(key))
      room.timers.delete(key)
      if (!timer) continue
      const round = room.round
      const handle = clock.setTimeout(() => {
        room.timers.delete(key)
        if (rooms.get(room.id) !== room || room.phase !== "playing" || room.round !== round) return
        apply(room, null, timer.action)
      }, timer.ms)
      room.timers.set(key, handle)
    }
  }

  const scheduleTick = (room) => {
    const ms = room.game.tickMs
    if (!(ms > 0) || room.phase !== "playing") return
    const round = room.round
    const handle = clock.setTimeout(() => {
      room.timers.delete("__tick")
      if (rooms.get(room.id) !== room || room.phase !== "playing" || room.round !== round) return
      apply(room, null, { type: "tick" })
      scheduleTick(room)
    }, ms)
    room.timers.set("__tick", handle)
  }

  // ---------- playing ----------

  const finish = (room, over) => {
    const winners = Array.isArray(over.winners) ? over.winners.filter((w) => Number.isInteger(w) && room.seats[w]) : []
    room.result = {
      ...(isObject(over) ? over : {}),
      winners,
      winnerNames: winners.map((w) => room.seats[w].name),
      draw: !!over.draw || !winners.length,
      reason: typeof over.reason === "string" ? over.reason : null,
    }
    room.phase = "over"
    room.rematch = new Set()
    stopTimers(room)
    say(room, room.result.draw && !winners.length ? "Game over: it's a draw." : `${room.result.winnerNames.join(" and ")} ${winners.length > 1 ? "win" : "wins"}!`)
  }

  const checkOver = (room) => {
    if (room.phase !== "playing" || room.game.relay || !room.game.isOver) return
    let over = null
    try {
      over = room.game.isOver(room.state)
    } catch (error) {
      console.error(`[rooms] ${room.game.id} isOver failed`, error)
    }
    if (over) finish(room, over)
  }

  // A move by a seat (or the server: seat null) through the rules
  const apply = (room, seat, action) => {
    const mod = room.game
    const pending = new Map()
    let next
    try {
      next = mod.action(room.state, seat, action, contextFor(room, pending))
    } catch (error) {
      console.error(`[rooms] ${mod.id} action failed`, error)
      return { ok: false, error: "That move didn't work. Please try again." }
    }
    if (next == null) return { ok: false, error: "That isn't allowed." }
    if (isRefusal(next)) return { ok: false, error: next.error }
    const changed = next !== room.state
    room.state = next
    commitTimers(room, pending)
    if (changed) {
      checkOver(room)
      publish(room)
    }
    scheduleBots(room)
    return { ok: true }
  }

  const botAction = (room, seat) => {
    try {
      return room.game.bot(room.state, seat, { random, now: clock.now() }) ?? null
    } catch (error) {
      console.error(`[rooms] ${room.game.id} bot failed`, error)
      return null
    }
  }

  const botDelayFor = (room, seat, action) => {
    const delay = room.game.botDelay
    if (typeof delay !== "function") return delay ?? T.botDelay
    try {
      const ms = Number(delay(room.state, seat, action, { now: clock.now() }))
      return Number.isFinite(ms) ? Math.max(0, ms) : T.botDelay
    } catch (error) {
      console.error(`[rooms] ${room.game.id} botDelay failed`, error)
      return T.botDelay
    }
  }

  // The first computer player with something to do does it, after a moment (with a
  // botDelay function: the one with the quickest move)
  const scheduleBots = (room) => {
    clock.clearTimeout(room.botTimer)
    room.botTimer = null
    if (room.phase !== "playing" || !botsAllowed(room)) return
    const timed = typeof room.game.botDelay === "function"
    let seat = -1
    let wait = 0
    for (let i = 0; i < room.seats.length; i++) {
      if (!room.seats[i]?.bot) continue
      const action = botAction(room, i)
      if (action == null) continue
      const ms = botDelayFor(room, i, action)
      if (seat < 0 || ms < wait) [seat, wait] = [i, ms]
      if (!timed) break
    }
    if (seat < 0) return
    const round = room.round
    room.botTimer = clock.setTimeout(() => {
      room.botTimer = null
      if (rooms.get(room.id) !== room || room.phase !== "playing" || room.round !== round || !room.seats[seat]?.bot) return
      const action = botAction(room, seat)
      if (action == null) return scheduleBots(room)
      const result = apply(room, seat, action)
      if (!result.ok) console.warn(`[rooms] ${room.game.id}: the computer player's move was refused: ${result.error}`)
    }, wait)
  }

  const startGame = (room) => {
    const mod = room.game
    stopAutoStart(room)
    stopTimers(room)
    room.seats = room.seats.filter(Boolean)
    room.round++
    room.result = null
    room.notice = null
    room.rematch = new Set()
    room.phase = "playing"
    for (const s of room.seats) s.ready = false
    if (mod.relay) {
      room.state = null
      publish(room)
      say(room, room.round > 1 ? `Round ${room.round} begins.` : "The game begins!")
      return { ok: true }
    }
    const pending = new Map()
    const ctx = contextFor(room, pending)
    try {
      room.state = mod.create({ players: ctx.players, settings: room.settings, random, now: ctx.now, after: ctx.after })
    } catch (error) {
      console.error(`[rooms] ${mod.id} create failed`, error)
      room.phase = "lobby"
      room.round--
      while (room.seats.length < capacity(room)) room.seats.push(null)
      publish(room)
      return { ok: false, error: "The game couldn't start. Please try again." }
    }
    commitTimers(room, pending)
    scheduleTick(room)
    say(room, room.round > 1 ? `Rematch! Round ${room.round} begins.` : "The game begins!")
    checkOver(room)
    publish(room)
    scheduleBots(room)
    return { ok: true }
  }

  // Quick Match: a full room starts now; one with enough players (but room for more) soon
  const quickFull = (room) => Math.max(room.game.minPlayers, Math.min(room.game.maxPlayers, room.game.quickSeats?.(room.settings) || room.game.maxPlayers))
  const quickCheck = (room) => {
    if (!room.quick || room.phase !== "lobby") return
    const count = filled(room)
    if (count >= Math.min(capacity(room), quickFull(room))) return startGame(room)
    if (count >= room.game.minPlayers && humans(room).length >= 2) {
      if (!room.autoStart) {
        room.startsAt = clock.now() + T.quickStart
        room.autoStart = clock.setTimeout(() => {
          room.autoStart = null
          if (rooms.get(room.id) === room && room.phase === "lobby" && filled(room) >= room.game.minPlayers) startGame(room)
        }, T.quickStart)
      }
    } else stopAutoStart(room)
  }

  // ---------- rooms ----------

  const newCode = () => {
    for (;;) {
      let code = ""
      for (let i = 0; i < 4; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]
      if (!codes.has(code)) return code
    }
  }

  const makeRoom = (mod, settings, { isPrivate, quick }) => {
    const room = {
      id: newId(),
      code: isPrivate ? newCode() : null,
      game: mod,
      settings,
      private: !!isPrivate,
      quick: !!quick,
      bucket: quick ? bucketOf(mod, settings) : null,
      host: null,
      phase: "lobby",
      seats: Array(capacityFor(mod, settings)).fill(null),
      spectators: new Map(),
      state: null,
      round: 0,
      result: null,
      rematch: new Set(),
      timers: new Map(),
      botTimer: null,
      autoStart: null,
      startsAt: null,
      waitingSince: clock.now(),
      rev: 0,
      notice: null,
      invitedNames: new Set(),
      allowed: new Set(),
      banned: new Set(),
    }
    rooms.set(room.id, room)
    if (room.code) codes.set(room.code, room)
    return room
  }

  const closeRoom = (room, reason) => {
    stopTimers(room)
    stopAutoStart(room)
    rooms.delete(room.id)
    if (room.code) codes.delete(room.code)
    for (const pid of audience(room)) {
      if (roomOf.get(pid) === room.id) roomOf.delete(pid)
      if (reason) send(pid, "room:gone", { roomId: room.id, reason })
    }
    for (const [pid, inv] of invited) if (inv.roomId === room.id) invited.delete(pid)
  }

  const botName = (room) => {
    const taken = new Set(room.seats.filter(Boolean).map((s) => s.name))
    return BOT_NAMES.find((n) => !taken.has(n)) || `Computer ${filled(room) + 1}`
  }

  const blockedFrom = (room, pid) => audience(room).some((other) => other !== pid && blocked(other, pid))

  // Into another room: out of this one (its window hears it's gone)
  const moveOut = (pid, room) => {
    leave(pid, room.id)
    send(pid, "room:gone", { roomId: room.id, reason: null })
  }

  // Sit down (or watch) in a room; leaves any other room first
  const enter = (room, me, { watch = false } = {}) => {
    if (inRoom(room, me.pid)) return { ok: true, roomId: room.id, spectator: seatOf(room, me.pid) < 0 }
    if (room.banned.has(me.pid) || blockedFrom(room, me.pid)) return { ok: false, error: "You can't join that room." }
    const seat = room.phase === "lobby" && !watch ? freeSeat(room) : -1
    if (seat < 0 && !canWatch(room)) return { ok: false, error: room.phase === "lobby" ? "That room is full." : "That game has already started." }
    const previous = currentRoom(me.pid)
    if (previous) moveOut(me.pid, previous)
    if (seat >= 0) {
      room.seats[seat] = { pid: me.pid, name: me.name, key: me.key || null, ready: false, away: false, bot: false }
      if (!room.host || !humans(room).some((s) => s.pid === room.host)) room.host = me.pid
    } else room.spectators.set(me.pid, me.name)
    roomOf.set(me.pid, room.id)
    invited.delete(me.pid)
    room.allowed.delete(me.pid)
    room.invitedNames.delete(me.name)
    if (seat >= 0 && room.phase === "lobby" && humans(room).length > 1) say(room, `${me.name} sat down.`)
    quickCheck(room)
    publish(room)
    return { ok: true, roomId: room.id, spectator: seat < 0 }
  }

  const gameFor = (id) => {
    const mod = registry.get(String(id ?? ""))
    return mod || null
  }

  const quick = (me, gameId, rawSettings) => {
    const mod = gameFor(gameId)
    if (!mod) return { ok: false, error: "That game isn't available online." }
    if (joinLimit(me.pid)) return { ok: false, error: "Slow down a little and try again in a minute." }
    const { settings, error } = cleanSettings(mod, rawSettings)
    if (error) return { ok: false, error }
    const bucket = bucketOf(mod, settings)
    const previous = currentRoom(me.pid)
    if (previous) moveOut(me.pid, previous)
    let room = [...rooms.values()].find((r) => r.quick && r.bucket === bucket && r.phase === "lobby" && freeSeat(r) >= 0 && filled(r) < quickFull(r) && !r.banned.has(me.pid) && !blockedFrom(r, me.pid))
    if (!room) {
      if (rooms.size >= maxRooms) return FULL
      room = makeRoom(mod, settings, { quick: true })
    }
    return enter(room, me)
  }

  const create = (me, gameId, rawSettings) => {
    const mod = gameFor(gameId)
    if (!mod) return { ok: false, error: "That game isn't available online." }
    if (joinLimit(me.pid)) return { ok: false, error: "Slow down a little and try again in a minute." }
    const { settings, error } = cleanSettings(mod, rawSettings)
    if (error) return { ok: false, error }
    if (rooms.size >= maxRooms) return FULL
    const previous = currentRoom(me.pid)
    if (previous) moveOut(me.pid, previous)
    const room = makeRoom(mod, settings, { isPrivate: true })
    const result = enter(room, me)
    return result.ok ? { ...result, code: room.code } : result
  }

  const normalizeCode = (code) => String(code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "")

  const join = (me, { code, roomId } = {}) => {
    if (joinLimit(me.pid)) return { ok: false, error: "Slow down a little and try again in a minute." }
    let room = null
    if (code !== undefined && code !== null && code !== "") {
      const c = normalizeCode(code)
      if (!CODE.test(c)) return { ok: false, error: "Room codes are 4 letters or numbers, like K7QX." }
      room = codes.get(c)
      if (!room) return { ok: false, error: `There's no room with the code ${c}. Check the code and try again.` }
    } else {
      room = rooms.get(String(roomId ?? ""))
      // a private room by its id: only for people let in by an invitation
      if (room && room.private && !room.allowed.has(me.pid) && !inRoom(room, me.pid)) room = null
      if (!room) return { ok: false, error: "Sorry, that room has closed." }
    }
    return enter(room, me)
  }

  const peek = (code) => {
    const room = codes.get(normalizeCode(code))
    return room ? { ok: true, game: room.game.id, gameName: room.game.name, roomId: room.id } : { ok: false, error: "There's no room with that code." }
  }

  // Leave a room (closing the window, the Leave button, or gone for good)
  const leave = (pid, roomId) => {
    const room = rooms.get(String(roomId ?? ""))
    if (!room || !inRoom(room, pid)) {
      if (roomOf.get(pid) === roomId) roomOf.delete(pid)
      return { ok: true }
    }
    roomOf.delete(pid)
    if (room.spectators.delete(pid)) {
      if (!humans(room).length) closeRoom(room, "Everyone left.")
      else publish(room)
      return { ok: true }
    }
    const seat = seatOf(room, pid)
    const s = room.seats[seat]
    const mod = room.game
    if (room.phase === "lobby") {
      room.seats[seat] = null
    } else if (mod.relay) {
      // the host's browser was running the game (or someone's missing): back to the lobby
      stopTimers(room)
      room.seats[seat] = null
      if (room.phase === "playing") room.notice = `${s.name} left, so the game stopped.`
      room.phase = "lobby"
      room.state = null
      room.result = null
      room.seats = room.seats.filter(Boolean)
    } else if (botsAllowed(room)) {
      room.seats[seat] = { bot: true, name: `${s.name} (computer)`, ready: true }
      room.rematch.delete(seat)
    } else if (room.phase === "playing") {
      s.left = true
      const pending = new Map()
      let carried = false
      if (mod.onLeave) {
        try {
          const next = mod.onLeave(room.state, seat, contextFor(room, pending))
          if (next != null && !isRefusal(next)) {
            room.state = next
            commitTimers(room, pending)
            carried = true
          }
        } catch (error) {
          console.error(`[rooms] ${mod.id} onLeave failed`, error)
        }
      }
      if (carried) checkOver(room)
      else finish(room, { winners: room.seats.map((x, i) => (x && !x.left ? i : -1)).filter((i) => i >= 0), reason: "left", left: seat })
    } else {
      s.left = true
      room.rematch.delete(seat)
    }
    if (room.phase === "lobby") while (room.seats.length < capacity(room)) room.seats.push(null)
    if (!humans(room).length) {
      closeRoom(room, room.spectators.size ? "Everyone left." : null)
      return { ok: true }
    }
    if (room.host === pid) room.host = humans(room)[0].pid
    if (room.phase !== "lobby" || room.quick) say(room, `${s.name} left.`)
    if (room.quick && room.phase === "lobby") room.waitingSince = humans(room).length === 1 ? clock.now() : room.waitingSince
    quickCheck(room)
    publish(room)
    scheduleBots(room)
    maybeRematch(room)
    return { ok: true }
  }

  const hostRoom = (pid, roomId, phase = "lobby") => {
    const room = rooms.get(String(roomId ?? ""))
    if (!room || !inRoom(room, pid)) return { error: "You aren't in that room." }
    if (room.host !== pid) return { error: "Only the host can do that." }
    if (phase && room.phase !== phase) return { error: phase === "lobby" ? "The game has already started." : "Not right now." }
    return { room }
  }

  const ready = (pid, roomId, value) => {
    const room = rooms.get(String(roomId ?? ""))
    const seat = room ? seatOf(room, pid) : -1
    if (seat < 0 || room.phase !== "lobby") return { ok: false, error: "You aren't waiting in that room." }
    room.seats[seat].ready = !!value
    publish(room)
    return { ok: true }
  }

  const setSettings = (pid, roomId, raw) => {
    const { room, error } = hostRoom(pid, roomId)
    if (error) return { ok: false, error }
    if (room.quick) return { ok: false, error: "Quick Match rooms keep their settings." }
    const cleaned = cleanSettings(room.game, raw)
    if (cleaned.error) return { ok: false, error: cleaned.error }
    const cap = capacityFor(room.game, cleaned.settings)
    const people = room.seats.filter(Boolean)
    if (people.length > cap) return { ok: false, error: `There are ${people.length} players here, more than that allows. Remove someone first.` }
    room.settings = cleaned.settings
    // more or fewer seats (the people keep their order)
    if (room.seats.length > cap) room.seats = [...people, ...Array(cap - people.length).fill(null)]
    while (room.seats.length < cap) room.seats.push(null)
    for (const s of room.seats) if (s && !s.bot) s.ready = false
    publish(room)
    return { ok: true }
  }

  const start = (pid, roomId) => {
    const { room, error } = hostRoom(pid, roomId)
    if (error) return { ok: false, error }
    const problem = startProblem(room)
    if (problem) return { ok: false, error: problem }
    return startGame(room)
  }

  const kick = (pid, roomId, seat) => {
    const { room, error } = hostRoom(pid, roomId)
    if (error) return { ok: false, error }
    const s = room.seats[Number(seat)]
    if (!s) return { ok: false, error: "That seat is empty." }
    if (!s.bot && s.pid === pid) return { ok: false, error: "You can't remove yourself. Use Leave instead." }
    room.seats[Number(seat)] = null
    if (!s.bot) {
      room.banned.add(s.pid)
      roomOf.delete(s.pid)
      send(s.pid, "room:gone", { roomId: room.id, reason: "The host removed you from the room.", kicked: true })
    }
    publish(room)
    return { ok: true }
  }

  const fillBots = (pid, roomId) => {
    const room = rooms.get(String(roomId ?? ""))
    if (!room || seatOf(room, pid) < 0) return { ok: false, error: "You aren't in that room." }
    if (!botsAllowed(room)) return { ok: false, error: "This game doesn't have computer players." }
    if (room.phase !== "lobby") return { ok: false, error: "The game has already started." }
    if (room.private && room.host !== pid) return { ok: false, error: "Only the host can add computer players." }
    if (room.quick && clock.now() < room.waitingSince + T.botOffer) return { ok: false, error: "Give people a few more seconds to find you." }
    const target = room.quick ? Math.max(room.game.minPlayers, Math.min(capacity(room), room.game.fillTo || capacity(room))) : capacity(room)
    while (filled(room) < target && freeSeat(room) >= 0) room.seats[freeSeat(room)] = { bot: true, name: botName(room), ready: true }
    if (room.quick) return startGame(room)
    publish(room)
    return { ok: true }
  }

  const act = (pid, roomId, action) => {
    const room = rooms.get(String(roomId ?? ""))
    const seat = room ? seatOf(room, pid) : -1
    if (seat < 0) return { ok: false, error: room && room.spectators.has(pid) ? "You're watching this game." : "You aren't in that game." }
    if (room.game.relay) return { ok: false, error: "This game sends moves differently." }
    if (room.phase !== "playing") return { ok: false, error: room.phase === "over" ? "The game is over." : "The game hasn't started yet." }
    if (!isObject(action) || sizeOf(action) > MAX_ACTION) return { ok: false, error: "That isn't a move." }
    if (actLimit(pid)) return { ok: false, error: "You're moving too fast. Slow down a little." }
    return apply(room, seat, action)
  }

  // Everyone still here agreed: play again with the same seats
  const maybeRematch = (room) => {
    if (room.phase !== "over" || !room.rematch.size) return
    const voters = room.seats.map((s, i) => (s && !s.bot && !s.left ? i : -1)).filter((i) => i >= 0)
    if (!voters.length || !voters.every((i) => room.rematch.has(i))) return
    if (room.seats.some((s) => s?.left)) return
    startGame(room)
  }

  const rematch = (pid, roomId) => {
    const room = rooms.get(String(roomId ?? ""))
    const seat = room ? seatOf(room, pid) : -1
    if (seat < 0) return { ok: false, error: "You aren't in that game." }
    if (room.phase !== "over") return { ok: false, error: "The game isn't over yet." }
    const gone = room.seats.find((s) => s?.left)
    if (gone) return { ok: false, error: `${gone.name} left, so there's no rematch. Start a new game.` }
    room.rematch.add(seat)
    publish(room)
    maybeRematch(room)
    return { ok: true }
  }

  // After a game the host can take everyone back to the lobby (to change settings)
  const toLobby = (pid, roomId) => {
    const { room, error } = hostRoom(pid, roomId, "over")
    if (error) return { ok: false, error }
    room.phase = "lobby"
    room.state = null
    room.result = null
    room.rematch = new Set()
    room.seats = room.seats.filter((s) => s && !s.left)
    for (const s of room.seats) if (!s.bot) s.ready = false
    while (room.seats.length < capacity(room)) room.seats.push(null)
    room.waitingSince = clock.now()
    publish(room)
    return { ok: true }
  }

  // ---------- real-time (relay) games ----------

  const relayRoom = (pid, roomId) => {
    const room = rooms.get(String(roomId ?? ""))
    if (!room || !room.game.relay || room.phase !== "playing") return null
    return seatOf(room, pid) >= 0 ? room : null
  }

  const snap = (pid, roomId, data) => {
    const room = relayRoom(pid, roomId)
    if (!room || room.host !== pid || snapLimit(pid) || sizeOf(data) > MAX_RELAY) return
    for (const other of audience(room)) if (other !== pid) volatile(other, "room:snap", { roomId: room.id, data })
  }

  const input = (pid, roomId, data) => {
    const room = relayRoom(pid, roomId)
    if (!room || room.host === pid || inputLimit(pid) || sizeOf(data) > MAX_RELAY) return
    volatile(room.host, "room:input", { roomId: room.id, from: seatOf(room, pid), data })
  }

  const relay = (pid, roomId, data, to) => {
    const room = relayRoom(pid, roomId)
    if (!room) return { ok: false, error: "That game isn't running." }
    if (sizeOf(data) > MAX_RELAY) return { ok: false, error: "That message is too big." }
    if (actLimit(pid)) return { ok: false, error: "Too many messages. Slow down a little." }
    const from = seatOf(room, pid)
    const payload = { roomId: room.id, from, data }
    if (room.host !== pid) send(room.host, "room:relay", payload)
    else if (Number.isInteger(to) && room.seats[to] && !room.seats[to].bot) send(room.seats[to].pid, "room:relay", payload)
    else for (const other of audience(room)) if (other !== pid) send(other, "room:relay", payload)
    return { ok: true }
  }

  const finishRelay = (pid, roomId, result = {}) => {
    const room = relayRoom(pid, roomId)
    if (!room || room.host !== pid) return { ok: false, error: "Only the host can end the game." }
    const r = isObject(result) ? result : {}
    const clean = {
      winners: Array.isArray(r.winners) ? r.winners.filter((w) => Number.isInteger(w)).slice(0, 12) : [],
      draw: !!r.draw,
      reason: typeof r.reason === "string" ? r.reason.slice(0, 40) : null,
    }
    if (Array.isArray(r.scores)) clean.scores = r.scores.slice(0, 12).map((n) => (Number.isFinite(Number(n)) ? Number(n) : 0))
    finish(room, clean)
    publish(room)
    return { ok: true }
  }

  // ---------- connections ----------

  const setAway = (pid, away) => {
    const room = currentRoom(pid)
    if (!room) return
    const seat = seatOf(room, pid)
    if (seat >= 0) {
      room.seats[seat].away = !!away
      publish(room)
    }
  }

  const drop = (pid) => {
    invited.delete(pid)
    const room = currentRoom(pid)
    if (room) leave(pid, room.id)
  }

  // A game window opened (or came back): send its room, or a pending invitation
  const hello = (pid, gameId) => {
    const room = currentRoom(pid)
    if (room && (!gameId || room.game.id === gameId)) {
      send(pid, "room:state", view(room, pid))
      return { ok: true, roomId: room.id }
    }
    const inv = invited.get(pid)
    const target = inv && rooms.get(inv.roomId)
    if (target && clock.now() - inv.at < T.invite && (!gameId || target.game.id === gameId)) {
      send(pid, "room:invited", { roomId: target.id, game: target.game.id })
      return { ok: true, invited: target.id }
    }
    return { ok: true }
  }

  // ---------- invitations (server/net/games.js) ----------

  const canInvite = (pid, roomId) => {
    const room = rooms.get(String(roomId ?? ""))
    if (!room || seatOf(room, pid) < 0) return { ok: false, error: "Open a room first, then invite people to it." }
    if (room.phase !== "lobby") return { ok: false, error: "The game has already started." }
    if (freeSeat(room) < 0) return { ok: false, error: "The room is full." }
    return { ok: true, name: room.game.name }
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
    if (!room) return { ok: false, error: "Sorry, that room has closed." }
    room.allowed.add(pid)
    invited.set(pid, { roomId, at: clock.now() })
    send(pid, "room:invited", { roomId, game: room.game.id })
    return { ok: true, onlineRoom: roomId, onlineGame: room.game.id }
  }

  const busy = (pid) => {
    const room = currentRoom(pid)
    return !!room && room.phase === "playing" && seatOf(room, pid) >= 0
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
          ack(handler(who(computer), isObject(payload) ? payload : {}) || { ok: true })
        } catch (error) {
          console.error(`[rooms] ${event} failed`, error)
          ack({ ok: false, error: "Something went wrong. Please try again." })
        }
      })
    // fire and forget, as often as 30 times a second: no acks, no logging
    const fast = (event, handler) =>
      socket.on(event, (payload) => {
        const computer = isObject(payload) && current()
        if (!computer) return
        try {
          handler(computer.pid, payload)
        } catch {
          // a bad snapshot is just dropped
        }
      })
    const id = (v) => String(v ?? "")
    on("room:hello", (me, { game }) => hello(me.pid, game ? id(game) : null))
    on("room:quick", (me, { game, settings }) => quick(me, id(game), settings))
    on("room:create", (me, { game, settings }) => create(me, id(game), settings))
    on("room:join", (me, { code, roomId }) => join(me, { code, roomId }))
    on("room:peek", (me, { code }) => peek(code))
    on("room:leave", (me, { roomId }) => leave(me.pid, id(roomId)))
    on("room:ready", (me, { roomId, ready: value }) => ready(me.pid, id(roomId), value))
    on("room:settings", (me, { roomId, settings }) => setSettings(me.pid, id(roomId), settings))
    on("room:start", (me, { roomId }) => start(me.pid, id(roomId)))
    on("room:kick", (me, { roomId, seat }) => kick(me.pid, id(roomId), seat))
    on("room:bots", (me, { roomId }) => fillBots(me.pid, id(roomId)))
    on("room:act", (me, { roomId, action }) => act(me.pid, id(roomId), action))
    on("room:rematch", (me, { roomId }) => rematch(me.pid, id(roomId)))
    on("room:lobby", (me, { roomId }) => toLobby(me.pid, id(roomId)))
    on("room:relay", (me, { roomId, data, to }) => relay(me.pid, id(roomId), data, to))
    on("room:finish", (me, { roomId, result }) => finishRelay(me.pid, id(roomId), result))
    fast("room:snap", (pid, { roomId, data }) => snap(pid, id(roomId), data))
    fast("room:input", (pid, { roomId, data }) => input(pid, id(roomId), data))
  }

  return {
    register,
    has: (gameId) => registry.has(gameId),
    nameOf: (gameId) => registry.get(gameId)?.name || null,
    quick,
    create,
    join,
    peek,
    leave,
    ready,
    setSettings,
    start,
    kick,
    fillBots,
    act,
    rematch,
    toLobby,
    snap,
    input,
    relay,
    finishRelay,
    setAway,
    drop,
    hello,
    canInvite,
    invitedTo,
    inviteEnded,
    allow,
    busy,
    wire,
    // the people (players and spectators, not computer players) in a room, for its chat
    playersOf: (roomId) => {
      const room = rooms.get(roomId)
      return room ? audience(room) : null
    },
    roomOf: (pid) => currentRoom(pid)?.id || null,
    view: (roomId, pid) => {
      const room = rooms.get(roomId)
      return room ? view(room, pid) : null
    },
    // game chat: (roomId, text) for "Alice wins!" and the like
    onEvent: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    rooms,
    TIMES: T,
  }
}

module.exports = { createRooms, TIMES, CODE_CHARS }
