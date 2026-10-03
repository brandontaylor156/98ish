// The online room system (server/arcade/rooms.js): codes, seats, ready-up, hidden
// information, turns, computer players, timers, Quick Match, invitations, reconnecting,
// real-time relay rooms, spectators and rate limits. Uses a test-only tic-tac-toe.
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const path = require("node:path")
const { Server } = require("socket.io")
const { createRooms, CODE_CHARS } = require("../rooms")
const { createGames } = require("../../net/games")
const { attachNet } = require("../../net")
const tictactoe = require("./tictactoe.fixture")
const checkers = require("../games/checkers")

// A clock the tests move by hand
const fakeClock = () => {
  let t = 1_000_000
  let ids = 0
  const timers = new Map()
  return {
    now: () => t,
    setTimeout: (fn, ms) => {
      const h = ++ids
      timers.set(h, { at: t + ms, fn })
      return h
    },
    clearTimeout: (h) => timers.delete(h),
    advance(ms) {
      const end = t + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        t = due[1].at
        due[1].fn()
      }
      t = end
    },
    pending: () => timers.size,
  }
}

const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647

const PEOPLE = { a: "Alice", b: "Bob", c: "Carol", d: "Dave" }
const me = (pid) => ({ pid, name: PEOPLE[pid], key: null })

const setup = (options = {}) => {
  const clock = fakeClock()
  const inbox = { a: [], b: [], c: [], d: [] }
  const fast = { a: [], b: [], c: [], d: [] }
  const chat = []
  const rooms = createRooms({
    games: [tictactoe, ...(options.games || [])],
    emit: (pid, event, payload) => inbox[pid]?.push({ event, payload }),
    emitVolatile: (pid, event, payload) => fast[pid]?.push({ event, payload }),
    blocked: options.blocked || (() => false),
    clock,
    random: options.random || seeded(42),
    times: options.times,
  })
  rooms.onEvent((id, text) => chat.push(text))
  const last = (pid, event = "room:state") => inbox[pid].filter((m) => m.event === event).at(-1)?.payload
  return { rooms, clock, inbox, fast, chat, last }
}

// a private room with Alice (host) and Bob, ready and started
const started = (options) => {
  const env = setup(options)
  const made = env.rooms.create(me("a"), "tictactoe", options?.settings)
  assert.ok(made.ok, made.error)
  assert.ok(env.rooms.join(me("b"), { code: made.code }).ok)
  assert.ok(env.rooms.ready("b", made.roomId, true).ok)
  assert.ok(env.rooms.start("a", made.roomId).ok)
  return { ...env, id: made.roomId, code: made.code }
}

test("register refuses modules without the basics", () => {
  assert.throws(() => createRooms({ games: [{ id: "Bad Id", minPlayers: 1, maxPlayers: 2, create() {}, action() {} }] }))
  assert.throws(() => createRooms({ games: [{ id: "x", minPlayers: 1, maxPlayers: 2 }] }))
  assert.throws(() => createRooms({ games: [{ id: "x", minPlayers: 3, maxPlayers: 2, create() {}, action() {} }] }))
  const { rooms } = setup()
  assert.equal(rooms.has("tictactoe"), true)
  assert.equal(rooms.nameOf("tictactoe"), "Tic-Tac-Toe")
  assert.equal(rooms.create(me("a"), "poker").ok, false)
})

test("private rooms: a short code, join by code, ready-up, then only the host starts", () => {
  const { rooms, last } = setup()
  const made = rooms.create(me("a"), "tictactoe", { turnMs: 0 })
  assert.ok(made.ok)
  assert.match(made.code, new RegExp(`^[${CODE_CHARS}]{4}$`))
  let view = last("a")
  assert.equal(view.phase, "lobby")
  assert.equal(view.host, true)
  assert.equal(view.code, made.code)
  assert.equal(view.seats.length, 2)
  assert.equal(view.canStart, false)
  assert.equal(view.waitingFor, "Waiting for 1 more player.")

  assert.match(rooms.join(me("b"), { code: "zz" }).error, /4 letters/)
  assert.match(rooms.join(me("b"), { code: "QQQQ" }).error, /no room with the code QQQQ/)
  // codes are forgiving: lower case, spaces, dashes
  const joined = rooms.join(me("b"), { code: ` ${made.code.slice(0, 2).toLowerCase()}-${made.code.slice(2)} ` })
  assert.ok(joined.ok, joined.error)
  assert.equal(joined.spectator, false)
  assert.equal(last("b").you, 1)
  assert.equal(last("a").waitingFor, "Waiting for Bob to be ready.")
  assert.equal(rooms.start("b", made.roomId).ok, false, "only the host starts")
  assert.match(rooms.start("a", made.roomId).error, /Bob to be ready/)
  rooms.ready("b", made.roomId, true)
  assert.equal(last("a").canStart, true)

  // settings: the host's, checked by the game, and changing them un-readies everyone
  assert.match(rooms.setSettings("a", made.roomId, { turnMs: -5 }).error, /turn clock/)
  assert.equal(rooms.setSettings("b", made.roomId, { turnMs: 0 }).ok, false)
  assert.ok(rooms.setSettings("a", made.roomId, { style: "fancy" }).ok)
  assert.deepEqual(last("b").settings, { turnMs: 0, style: "fancy" })
  assert.equal(last("a").canStart, false)
  rooms.ready("b", made.roomId, true)
  assert.ok(rooms.start("a", made.roomId).ok)
  view = last("a")
  assert.equal(view.phase, "playing")
  assert.equal(view.round, 1)
  assert.ok(view.view.board)
})

test("hidden information: each player sees only their own secret; spectators see none", () => {
  const { rooms, last, id, code } = started()
  const a = last("a").view
  const b = last("b").view
  assert.equal(typeof a.secret, "number")
  assert.equal(typeof b.secret, "number")
  // nowhere in Alice's whole room view is Bob's secret
  const bobs = (rooms.rooms.get(id).state.secrets[1])
  assert.equal(JSON.stringify(last("a")).includes(String(bobs)), false)
  // a third person with the code watches
  const watch = rooms.join(me("c"), { code })
  assert.ok(watch.ok)
  assert.equal(watch.spectator, true)
  const c = last("c")
  assert.equal(c.spectator, true)
  assert.equal(c.you, null)
  assert.equal(c.view.secret, null)
  assert.deepEqual(last("a").spectators, ["Carol"])
  assert.match(rooms.act("c", id, { type: "mark", cell: 0 }).error, /watching/)
  assert.deepEqual(rooms.playersOf(id).sort(), ["a", "b", "c"])
})

test("turns: the rules refuse bad moves; a win ends the game; rematch starts round 2", () => {
  const { rooms, last, chat, id } = started()
  assert.match(rooms.act("b", id, { type: "mark", cell: 0 }).error, /isn't your turn/)
  assert.ok(rooms.act("a", id, { type: "mark", cell: 0 }).ok)
  assert.match(rooms.act("b", id, { type: "mark", cell: 0 }).error, /taken/)
  assert.match(rooms.act("b", id, "cell 3").error, /isn't a move/)
  assert.equal(rooms.act("d", id, { type: "mark", cell: 3 }).ok, false)
  rooms.act("b", id, { type: "mark", cell: 3 })
  rooms.act("a", id, { type: "mark", cell: 1 })
  rooms.act("b", id, { type: "mark", cell: 4 })
  assert.equal(rooms.busy("a"), true)
  rooms.act("a", id, { type: "mark", cell: 2 })
  const view = last("b")
  assert.equal(view.phase, "over")
  assert.deepEqual(view.result.winners, [0])
  assert.deepEqual(view.result.winnerNames, ["Alice"])
  assert.equal(view.result.reason, "three")
  assert.equal(rooms.busy("a"), false)
  assert.ok(chat.includes("Alice wins!"))
  assert.match(rooms.act("b", id, { type: "mark", cell: 5 }).error, /over/)

  assert.ok(rooms.rematch("b", id).ok)
  assert.deepEqual(last("a").rematch, [1])
  assert.equal(last("a").phase, "over")
  rooms.rematch("a", id)
  assert.equal(last("a").phase, "playing")
  assert.equal(last("a").round, 2)
  assert.ok(chat.includes("Rematch! Round 2 begins."))
  // after a game the host can go back to the lobby
  rooms.act("a", id, { type: "mark", cell: 0 })
  rooms.act("b", id, { type: "mark", cell: 3 })
  rooms.act("a", id, { type: "mark", cell: 1 })
  rooms.act("b", id, { type: "mark", cell: 4 })
  rooms.act("a", id, { type: "mark", cell: 2 })
  assert.equal(rooms.toLobby("b", id).ok, false)
  assert.ok(rooms.toLobby("a", id).ok)
  assert.equal(last("b").phase, "lobby")
  assert.equal(last("b").view, null)
})

test("timers: a turn clock fires through the rules, and stops when the game ends", () => {
  const { rooms, clock, last, id } = started({ settings: { turnMs: 10_000 } })
  clock.advance(6000)
  rooms.act("a", id, { type: "mark", cell: 4 }) // restarts the clock for Bob
  clock.advance(6000)
  assert.equal(last("a").phase, "playing", "Bob still has 4 seconds")
  // a refused move doesn't touch the clock
  assert.equal(rooms.act("b", id, { type: "mark", cell: 4 }).ok, false)
  clock.advance(4001)
  const view = last("a")
  assert.equal(view.phase, "over")
  assert.equal(view.result.reason, "timeout")
  assert.deepEqual(view.result.winners, [0])
  assert.equal(clock.pending(), 0, "nothing left running")
})

test("ticks: tickMs sends { type: 'tick' } from the server while playing", () => {
  let ticks = 0
  const ticker = { ...tictactoe, id: "ticker", name: "Ticker", bot: undefined, tickMs: 1000, action: (s, seat, a, ctx) => (seat === null && a.type === "tick" ? (ticks++, { ...s, moves: s.moves }) : tictactoe.action(s, seat, a, ctx)) }
  const env = setup({ games: [ticker] })
  const made = env.rooms.create(me("a"), "ticker")
  env.rooms.join(me("b"), { code: made.code })
  env.rooms.ready("b", made.roomId, true)
  env.rooms.start("a", made.roomId)
  env.clock.advance(3500)
  assert.equal(ticks, 3)
  env.rooms.leave("a", made.roomId) // no bot: Bob wins, the ticking stops
  env.clock.advance(5000)
  assert.equal(ticks, 3)
})

test("Quick Match pairs strangers with the same settings and starts a full room", () => {
  const { rooms, last } = setup()
  const a = rooms.quick(me("a"), "tictactoe", { turnMs: 0 })
  assert.ok(a.ok)
  assert.equal(last("a").quick, true)
  assert.equal(last("a").code, null)
  // different settings: a different room
  const c = rooms.quick(me("c"), "tictactoe", { turnMs: 5000 })
  assert.notEqual(c.roomId, a.roomId)
  // same settings (key order doesn't matter): Alice's room, and it starts
  const b = rooms.quick(me("b"), "tictactoe", { style: "classic", turnMs: 0 })
  assert.equal(b.roomId, a.roomId)
  assert.equal(last("a").phase, "playing")
  assert.equal(last("b").phase, "playing")
  assert.equal(last("c").phase, "lobby")
  assert.match(rooms.quick(me("d"), "tictactoe", { turnMs: "soon" }).error, /turn clock/)
})

test("Quick Match offers computer players after a wait; they play their turns", () => {
  const { rooms, clock, last } = setup()
  const { roomId } = rooms.quick(me("a"), "tictactoe")
  assert.equal(last("a").canFillBots, false)
  assert.ok(last("a").botOfferAt > clock.now())
  assert.match(rooms.fillBots("a", roomId).error, /few more seconds/)
  clock.advance(15_100)
  assert.equal(rooms.view(roomId, "a").canFillBots, true)
  assert.equal(last("a").canFillBots, true, "the offer is sent without being asked")
  assert.ok(rooms.fillBots("a", roomId).ok)
  let view = last("a")
  assert.equal(view.phase, "playing")
  assert.equal(view.seats[1].bot, true)
  assert.equal(view.seats[1].name, "Ada")
  // Alice moves; the computer answers a moment later
  rooms.act("a", roomId, { type: "mark", cell: 4 })
  assert.equal(last("a").view.board.filter((x) => x !== null).length, 1)
  clock.advance(700)
  view = last("a")
  assert.equal(view.view.board[0], 1, "the bot took the first free square")
  assert.equal(view.view.yourTurn, true)
})

test("private rooms: the host adds computer players, kicks people, and hosting passes on", () => {
  const { rooms, last, inbox } = setup()
  const made = rooms.create(me("a"), "tictactoe")
  rooms.join(me("b"), { code: made.code })
  assert.match(rooms.kick("b", made.roomId, 0).error, /Only the host/)
  assert.ok(rooms.kick("a", made.roomId, 1).ok)
  assert.equal(inbox.b.at(-1).event, "room:gone")
  assert.equal(inbox.b.at(-1).payload.kicked, true)
  assert.match(rooms.join(me("b"), { code: made.code }).error, /can't join/)
  assert.ok(rooms.fillBots("a", made.roomId).ok)
  assert.equal(last("a").seats[1].bot, true)
  assert.equal(last("a").canStart, true)
  assert.ok(rooms.kick("a", made.roomId, 1).ok) // a computer player can be removed too
  rooms.join(me("c"), { code: made.code })
  rooms.leave("a", made.roomId)
  assert.equal(last("c").host, true)
  assert.equal(last("c").seats[0], null)
  rooms.leave("c", made.roomId)
  assert.equal(rooms.rooms.size, 0, "an empty room closes")
  assert.match(rooms.join(me("d"), { code: made.code }).error, /no room/)
})

test("joining another room leaves the first one", () => {
  const { rooms, last } = setup()
  const one = rooms.create(me("a"), "tictactoe")
  const two = rooms.create(me("b"), "tictactoe")
  rooms.join(me("a"), { code: two.code })
  assert.equal(rooms.roomOf("a"), two.roomId)
  assert.equal(rooms.rooms.has(one.roomId), false)
  assert.equal(last("a", "room:gone").roomId, one.roomId, "the first room's window hears it's gone")
})

test("reconnecting: away for a while keeps the seat; gone for good, a computer takes over", () => {
  const { rooms, clock, last, id } = started()
  rooms.setAway("b", true)
  assert.equal(last("a").seats[1].away, true)
  rooms.setAway("b", false)
  assert.equal(last("a").seats[1].away, false)
  rooms.hello("b", "tictactoe")
  assert.equal(last("b").id, id, "hello sends the room again")
  rooms.act("a", id, { type: "mark", cell: 4 })
  rooms.drop("b")
  const view = last("a")
  assert.equal(view.seats[1].bot, true)
  assert.equal(view.seats[1].name, "Bob (computer)")
  clock.advance(700)
  assert.equal(last("a").view.board[0], 1)
})

test("leaving a game without computer players: the others win, and there's no rematch", () => {
  const noBot = { ...tictactoe, id: "nobot", name: "No Bot", bot: undefined }
  const env = setup({ games: [noBot] })
  const made = env.rooms.create(me("a"), "nobot")
  env.rooms.join(me("b"), { code: made.code })
  env.rooms.ready("b", made.roomId, true)
  env.rooms.start("a", made.roomId)
  env.rooms.leave("b", made.roomId)
  const view = env.last("a")
  assert.equal(view.phase, "over")
  assert.equal(view.result.reason, "left")
  assert.deepEqual(view.result.winners, [0])
  assert.match(env.rooms.rematch("a", made.roomId).error, /Bob left/)
  assert.match(env.rooms.fillBots("a", made.roomId).error, /computer players/)
})

test("invitations through Network Neighborhood let people into a private room", () => {
  const env = setup()
  const inbox = { a: [], b: [] }
  const games = createGames({ emit: (pid, event, payload) => inbox[pid]?.push({ event, payload }), rooms: env.rooms })
  const made = env.rooms.create(me("a"), "tictactoe")
  // nobody gets in by id alone
  assert.match(env.rooms.join(me("b"), { roomId: made.roomId }).error, /closed/)
  const inv = games.invite({ from: "a", fromName: "Alice", to: "b", toName: "Bob", game: "anything", matchId: made.roomId })
  assert.ok(inv.ok, inv.error)
  const card = inbox.b.at(-1)
  assert.equal(card.event, "net:invited")
  assert.equal(card.payload.game, "tictactoe")
  assert.equal(card.payload.gameName, "Tic-Tac-Toe")
  assert.equal(card.payload.online, true)
  assert.deepEqual(env.last("a").invited, ["Bob"])
  assert.equal(games.invite({ from: "c", fromName: "Carol", to: "b", toName: "Bob", matchId: made.roomId }).ok, false, "only people in the room invite")
  const reply = games.replyInvite("b", inv.inviteId, true)
  assert.ok(reply.ok)
  assert.equal(reply.onlineRoom, made.roomId)
  assert.equal(reply.onlineGame, "tictactoe")
  assert.equal(env.last("b", "room:invited").roomId, made.roomId)
  // the game window opening asks hello and hears about it again
  assert.equal(env.rooms.hello("b", "tictactoe").invited, made.roomId)
  assert.ok(env.rooms.join(me("b"), { roomId: made.roomId }).ok)
  assert.deepEqual(env.last("a").invited, [])
  assert.equal(env.last("a").seats[1].name, "Bob")
  // a declined one says so
  const made2 = env.rooms.create(me("c"), "tictactoe")
  const inv2 = games.invite({ from: "c", fromName: "Carol", to: "a", toName: "Alice", matchId: made2.roomId })
  assert.deepEqual(env.last("c").invited, ["Alice"])
  games.replyInvite("a", inv2.inviteId, false)
  assert.deepEqual(env.last("c").invited, [])
})

test("people who block each other aren't matched or let in", () => {
  const { rooms } = setup({ blocked: (x, y) => [x, y].sort().join() === "a,b" })
  const a = rooms.quick(me("a"), "tictactoe")
  const b = rooms.quick(me("b"), "tictactoe")
  assert.notEqual(a.roomId, b.roomId)
  const made = rooms.create(me("c"), "tictactoe")
  rooms.join(me("a"), { code: made.code })
  assert.match(rooms.join(me("b"), { code: made.code }).error, /can't join/)
})

test("rate limits: too many moves too fast are refused", () => {
  const { rooms, id } = started()
  let refused = null
  for (let i = 0; i < 60 && !refused; i++) {
    const r = rooms.act("a", id, { type: "mark", cell: 99 })
    if (/too fast/.test(r.error || "")) refused = i
  }
  assert.ok(refused !== null && refused >= 30, `refused at ${refused}`)
})

test("relay rooms: the host streams snapshots, guests send inputs, the host ends the game", () => {
  const pong = { id: "pong", name: "Pong", minPlayers: 2, maxPlayers: 4, relay: true }
  const env = setup({ games: [pong] })
  const { rooms, fast, inbox, last } = env
  const made = rooms.create(me("a"), "pong")
  rooms.join(me("b"), { code: made.code })
  rooms.join(me("c"), { code: made.code })
  assert.match(rooms.fillBots("a", made.roomId).error, /computer players/)
  // before the game: nothing is relayed
  rooms.snap("a", made.roomId, { x: 1 })
  assert.equal(fast.b.length, 0)
  rooms.ready("b", made.roomId, true)
  rooms.ready("c", made.roomId, true)
  assert.ok(rooms.start("a", made.roomId).ok)
  assert.equal(last("b").mode, "relay")
  assert.equal(last("b").phase, "playing")
  rooms.snap("a", made.roomId, { ball: [1, 2] })
  assert.deepEqual(fast.b.at(-1), { event: "room:snap", payload: { roomId: made.roomId, data: { ball: [1, 2] } } })
  assert.equal(fast.c.at(-1).event, "room:snap")
  assert.equal(fast.a.length, 0, "not back to the host")
  rooms.snap("b", made.roomId, { cheat: true }) // only the host streams
  assert.equal(fast.c.length, 1)
  rooms.input("b", made.roomId, { up: true })
  assert.deepEqual(fast.a.at(-1), { event: "room:input", payload: { roomId: made.roomId, from: 1, data: { up: true } } })
  assert.equal(fast.c.length, 1, "inputs go to the host only")
  rooms.snap("a", made.roomId, { big: "x".repeat(40_000) })
  assert.equal(fast.b.length, 1, "oversized snapshots are dropped")
  // reliable messages
  assert.ok(rooms.relay("a", made.roomId, { point: 2 }).ok)
  assert.deepEqual(inbox.c.at(-1).payload, { roomId: made.roomId, from: 0, data: { point: 2 } })
  assert.ok(rooms.relay("c", made.roomId, { serve: true }).ok)
  assert.equal(inbox.a.at(-1).event, "room:relay")
  assert.equal(rooms.finishRelay("b", made.roomId, { winners: [1] }).ok, false)
  assert.ok(rooms.finishRelay("a", made.roomId, { winners: [1], reason: "11 points", scores: [7, 11, 3] }).ok)
  assert.deepEqual(last("c").result.winnerNames, ["Bob"])
  assert.deepEqual(last("c").result.scores, [7, 11, 3])
  // a rematch, then someone leaves mid-game: back to the lobby, with a note
  rooms.rematch("a", made.roomId)
  rooms.rematch("b", made.roomId)
  rooms.rematch("c", made.roomId)
  assert.equal(last("a").phase, "playing")
  rooms.leave("a", made.roomId)
  const view = last("b")
  assert.equal(view.phase, "lobby")
  assert.equal(view.notice, "Alice left, so the game stopped.")
  assert.equal(view.host, true)
  assert.equal(view.seats.length, 4)
})

test("checkers on rooms: a full game between computer players always ends", () => {
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const players = [{ id: 0, name: "A", bot: true }, { id: 1, name: "B", bot: true }]
  let state = checkers.create({ players, settings: {}, random })
  let plies = 0
  while (!checkers.isOver(state) && plies < 400) {
    const seat = state.colors.indexOf(state.game.turn)
    const action = checkers.bot(state, seat, { random })
    state = checkers.action(state, seat, action)
    assert.equal(state.error, undefined)
    plies++
  }
  assert.ok(checkers.isOver(state), "finished")
  // views: legal moves only for the side to move, nothing for spectators
  const fresh = checkers.create({ players, settings: {}, random: () => 0.1 })
  assert.equal(checkers.view(fresh, 0).legal.length, 7)
  assert.equal(checkers.view(fresh, 1).legal.length, 0)
  assert.equal(checkers.view(fresh, null).legal.length, 0)
  assert.match(checkers.action(fresh, 1, { type: "move", path: [40, 33] }).error, /isn't your turn/)
  const offered = checkers.action(fresh, 1, { type: "draw", answer: "offer" })
  assert.equal(checkers.view(offered, 0).drawOffer, "them")
  assert.equal(checkers.bot(offered, 0, { random }).answer, "decline")
  assert.deepEqual(checkers.isOver(checkers.action(fresh, 0, { type: "resign" })).winners, [1])
})

// ---------- over real sockets, through Network Neighborhood ----------

let ioClient = null
try {
  ioClient = require(path.join(__dirname, "../../../client/node_modules/socket.io-client"))
} catch {
  ioClient = null
}

test("sockets: create, join by code, play, and come back after a dropped connection", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  const server = http.createServer()
  const io = new Server(server)
  const pong = { id: "pong", name: "Pong", minPlayers: 2, maxPlayers: 2, relay: true }
  const net = attachNet(io, { rooms: { games: [tictactoe, pong] } })
  await new Promise((r) => server.listen(0, r))
  const url = `http://127.0.0.1:${server.address().port}`
  const sockets = []
  const connect = async (token) => {
    const socket = ioClient(url, { transports: ["websocket"], forceNew: true })
    sockets.push(socket)
    const hello = await new Promise((resolve) => socket.emit("net:hello", token ? { token } : {}, resolve))
    return { socket, hello, ask: (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve)) }
  }
  const next = (socket, event, test = () => true) =>
    new Promise((resolve) => {
      const fn = (payload) => {
        if (!test(payload)) return
        socket.off(event, fn)
        resolve(payload)
      }
      socket.on(event, fn)
    })
  try {
    const a = await connect()
    const b = await connect()
    const made = await a.ask("room:create", { game: "tictactoe", settings: {} })
    assert.ok(made.ok, made.error)
    const peek = await b.ask("room:peek", { code: made.code })
    assert.equal(peek.game, "tictactoe")
    const seen = next(a.socket, "room:state", (v) => v.seats[1]?.name === b.hello.me.name)
    assert.ok((await b.ask("room:join", { code: made.code })).ok)
    await seen
    await b.ask("room:ready", { roomId: made.roomId, ready: true })
    const playing = next(b.socket, "room:state", (v) => v.phase === "playing")
    assert.ok((await a.ask("room:start", { roomId: made.roomId })).ok)
    await playing
    assert.ok((await a.ask("room:act", { roomId: made.roomId, action: { type: "mark", cell: 4 } })).ok)
    assert.equal((await b.ask("room:act", { roomId: made.roomId, action: { type: "mark", cell: 4 } })).ok, false)
    assert.equal(net.computers.size, 2)
    // Bob's connection drops: Alice sees him away; he comes back with his token
    const away = next(a.socket, "room:state", (v) => v.seats[1].away)
    b.socket.close()
    await away
    const b2 = await connect(b.hello.token)
    const back = next(b2.socket, "room:state", (v) => v.id === made.roomId)
    assert.equal((await b2.ask("room:hello", { game: "tictactoe" })).roomId, made.roomId)
    const view = await back
    assert.equal(view.you, 1)
    assert.equal(view.seats[1].away, false)
    assert.ok((await b2.ask("room:act", { roomId: made.roomId, action: { type: "mark", cell: 0 } })).ok)
    // the room's chat is open to its players
    const chat = await a.ask("room:hello", { game: "tictactoe" })
    assert.equal(chat.roomId, made.roomId)
    assert.deepEqual(net.rooms.playersOf(made.roomId).length, 2)

    // a real-time (relay) room over the same sockets: volatile snapshots and inputs
    const relay = await a.ask("room:create", { game: "pong" })
    assert.ok(relay.ok, relay.error)
    assert.ok((await b2.ask("room:join", { code: relay.code })).ok)
    await b2.ask("room:ready", { roomId: relay.roomId, ready: true })
    assert.ok((await a.ask("room:start", { roomId: relay.roomId })).ok)
    const snap = next(b2.socket, "room:snap")
    a.socket.volatile.emit("room:snap", { roomId: relay.roomId, data: { ball: [3, 4] } })
    assert.deepEqual((await snap).data, { ball: [3, 4] })
    const input = next(a.socket, "room:input")
    b2.socket.volatile.emit("room:input", { roomId: relay.roomId, data: { left: true } })
    assert.deepEqual(await input, { roomId: relay.roomId, from: 1, data: { left: true } })
  } finally {
    sockets.forEach((s) => s.close())
    io.close()
    server.close()
  }
})
