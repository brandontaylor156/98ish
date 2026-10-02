// Tetris Online match logic, on a fake clock: matchmaking, KOs, attacks and targets,
// races, bots, disconnects, invitations and stars
const test = require("node:test")
const assert = require("node:assert/strict")
const { createTetris, pickTarget, raceOrder, starsFor, ready } = require("../tetris")
const { memoryRanks, rankOf } = require("../tetrisRanks")

const fakeClock = () => {
  let t = 1_000_000
  let seq = 0
  const timers = new Map()
  return {
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = ++seq
      timers.set(id, { at: t + Math.max(0, ms), fn })
      return id
    },
    clearTimeout: (id) => timers.delete(id),
    advance(ms) {
      const end = t + ms
      for (;;) {
        let next = null
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at || (x.at === next[1].at && id < next[0]))) next = [id, x]
        if (!next) break
        timers.delete(next[0])
        t = next[1].at
        next[1].fn()
      }
      t = end
    },
  }
}

// a seeded random so the tests don't flake
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

const setup = () => {
  const clock = fakeClock()
  const inbox = {}
  const ranks = memoryRanks()
  const t = createTetris({ emit: (pid, event, payload) => (inbox[pid] ||= []).push({ event, payload }), clock, random: seeded(), ranks })
  const last = (pid, event) => (inbox[pid] || []).filter((m) => m.event === event).at(-1)?.payload
  const all = (pid, event) => (inbox[pid] || []).filter((m) => m.event === event).map((m) => m.payload)
  const P = (pid, key = null) => ({ pid, name: pid.toUpperCase(), key })
  return { t, clock, inbox, last, all, P, ranks }
}

const startBattle = (s, keys = [null, null]) => {
  const a = s.t.quick(s.P("a", keys[0]), "battle")
  const b = s.t.quick(s.P("b", keys[1]), "battle")
  assert.equal(a.roomId, b.roomId)
  assert.equal(s.last("a", "tetris:room").phase, "countdown")
  s.clock.advance(3000)
  assert.equal(s.last("b", "tetris:room").phase, "playing")
  return a.roomId
}

test("Battle 2P: quick match pairs two players, KOs count, first to 3 wins and earns a star", async () => {
  const s = setup()
  const id = startBattle(s, ["alice", "bob"])
  const seedA = s.last("a", "tetris:room").seed
  assert.equal(seedA, s.last("b", "tetris:room").seed)
  assert.equal(s.t.topout("b", id).ok, true)
  assert.equal(s.last("a", "tetris:ko").victim, "b")
  s.t.topout("b", id) // the same top-out reported twice within a second counts once
  assert.equal(s.last("a", "tetris:room").players.find((p) => p.id === "a").kos, 1)
  s.clock.advance(1500)
  s.t.topout("b", id)
  s.clock.advance(1500)
  s.t.topout("a", id)
  s.clock.advance(1500)
  s.t.topout("b", id)
  const room = s.last("a", "tetris:room")
  assert.equal(room.phase, "over")
  assert.equal(room.result.reason, "kos")
  assert.deepEqual(room.result.placements.map((p) => [p.id, p.place, p.kos, p.stars]), [["a", 1, 3, 1], ["b", 2, 1, 0]])
  await new Promise((r) => setImmediate(r))
  assert.equal(s.last("a", "tetris:rank").stars, 1)
  assert.equal(s.last("a", "tetris:rank").wins, 1)
  assert.equal(s.last("b", "tetris:rank").played, 1)
  const board = await s.t.leaderboard("battle", "alice")
  assert.equal(board.top[0].screenName, "A")
  assert.equal(board.me.stars, 1)
})

test("Battle 2P: at time, most KOs wins, then most lines sent; a full tie is a draw with no stars", () => {
  for (const [setupFn, expect] of [
    [(s, id) => s.t.topout("b", id), "a"],
    [(s, id) => s.t.attack("b", id, { lines: 4 }), "b"],
    [() => {}, null],
  ]) {
    const s = setup()
    const id = startBattle(s, ["ka", "kb"])
    setupFn(s, id)
    s.clock.advance(120_000)
    const room = s.last("a", "tetris:room")
    assert.equal(room.phase, "over")
    assert.equal(room.result.reason, "time")
    if (expect) assert.equal(room.result.placements[0].id, expect)
    else {
      assert.equal(room.result.draw, true)
      assert.ok(room.result.placements.every((p) => p.place === 1 && p.stars === 0))
    }
  }
})

test("attacks: Battle sends solid rows to the opponent; sizes and rates are checked", () => {
  const s = setup()
  const id = startBattle(s)
  assert.equal(s.t.attack("a", id, { lines: 0 }).ok, false)
  assert.equal(s.t.attack("a", id, { lines: 99 }).ok, false)
  assert.equal(s.t.attack("a", id, { lines: 2.5 }).ok, false)
  assert.equal(s.t.attack("a", id, { lines: 4 }).ok, true)
  const g = s.last("b", "tetris:garbage")
  assert.deepEqual([g.lines, g.solid, g.from], [4, true, "a"])
  // a burst bigger than any real game can make is refused
  let refused = false
  for (let i = 0; i < 12; i++) refused ||= !s.t.attack("a", id, { lines: 6 }).ok
  assert.ok(refused)
  s.clock.advance(3500)
  assert.equal(s.t.attack("a", id, { lines: 6 }).ok, true)
  // nobody else's room
  assert.equal(s.t.attack("zz", id, { lines: 1 }).ok, false)
})

test("garbage cancellation happens on the board: the server just routes what's left", async () => {
  await ready
  const s = setup()
  const { roomId } = s.t.quick(s.P("a"), "battle")
  s.clock.advance(10_000)
  assert.equal(s.last("a", "tetris:room").canFillBots, true)
  s.t.fillBots("a", roomId, "easy")
  s.clock.advance(3000)
  const room = s.t.rooms.get(roomId)
  const bot = room.players.find((p) => p.bot)
  s.t.attack("a", roomId, { lines: 3 })
  assert.equal(bot.bot.state.pending.reduce((n, g) => n + g.lines, 0), 3)
  assert.equal(bot.bot.state.pending[0].solid, true)
})

test("Arena target selection: random, leader, danger, attackers; never yourself or the fallen", () => {
  const p = (pid, extra = {}) => ({ pid, alive: true, sent: 0, height: 0, targetPid: null, ...extra })
  const me = p("me", { sent: 99, height: 20 })
  const players = [me, p("x", { sent: 5, height: 3 }), p("y", { sent: 9, height: 12, targetPid: "me" }), p("z", { sent: 50, height: 19, alive: false })]
  assert.equal(pickTarget(players, me, "leader").pid, "y")
  assert.equal(pickTarget(players, me, "danger").pid, "y")
  assert.equal(pickTarget(players, me, "attackers").pid, "y")
  assert.equal(pickTarget([me, p("x")], me, "attackers").pid, "x") // nobody targeting you: random
  const seen = new Set()
  const random = seeded(3)
  for (let i = 0; i < 50; i++) seen.add(pickTarget(players, me, "random", random).pid)
  assert.deepEqual([...seen].sort(), ["x", "y"])
  assert.equal(pickTarget([me], me, "random"), null)
})

test("Arena: targets, KO credit to the last attacker, escalating garbage, last one standing", () => {
  const s = setup()
  const { roomId: id } = s.t.quick(s.P("a", "ka"), "arena")
  s.t.quick(s.P("b", "kb"), "arena")
  s.t.quick(s.P("c", "kc"), "arena")
  s.clock.advance(8000) // enough players: starts after a short wait for more
  assert.equal(s.last("a", "tetris:room").phase, "countdown")
  s.clock.advance(3000)
  // boards: c has the tallest stack, so "danger" targets c
  s.t.state("b", id, { b: ".".repeat(190) + "g".repeat(10), lines: 2, height: 4 })
  s.t.state("c", id, { b: ".".repeat(100) + "g".repeat(100), lines: 0, height: 10 })
  s.t.state("c", id, { b: "x".repeat(200) }) // nonsense is ignored
  s.clock.advance(200)
  const boards = s.last("a", "tetris:boards").boards
  assert.deepEqual(Object.keys(boards).sort(), ["b", "c"])
  assert.equal(boards.c.h, 10)
  s.t.setStrategy("a", id, "danger")
  assert.equal(s.t.attack("a", id, { lines: 2 }).target, "c")
  const g = s.last("c", "tetris:garbage")
  assert.equal(g.solid, false)
  assert.ok(g.hole >= 0 && g.hole < 10)
  // c tops out: a gets the KO, c is third
  s.t.topout("c", id)
  let room = s.last("a", "tetris:room")
  assert.equal(room.players.find((p) => p.id === "a").kos, 1)
  assert.equal(room.players.find((p) => p.id === "c").place, 3)
  assert.equal(room.phase, "playing")
  // overtime after 2 minutes: everyone standing gets garbage
  s.clock.advance(120_000)
  assert.equal(s.last("b", "tetris:garbage").fromName, "Arena")
  assert.equal(s.last("b", "tetris:garbage").lines, 1)
  s.clock.advance(40_000)
  assert.equal(s.last("b", "tetris:garbage").lines, 2)
  s.t.topout("b", id)
  room = s.last("a", "tetris:room")
  assert.equal(room.phase, "over")
  assert.deepEqual(room.result.placements.map((p) => [p.id, p.place]), [["a", 1], ["b", 2], ["c", 3]])
  assert.deepEqual(room.result.placements.map((p) => p.stars), [1, 0, 0]) // 3 players: just the winner
  // items: Darkness hits the target
  assert.equal(starsFor("arena", 2, 5), 1)
})

test("Arena items: offensive ones reach a target, rate-limited", () => {
  const s = setup()
  const { roomId: id } = s.t.quick(s.P("a"), "arena")
  s.t.quick(s.P("b"), "arena")
  s.clock.advance(11_000)
  assert.equal(s.t.useItem("a", id, { item: "darkness" }).target, "b")
  assert.equal(s.last("b", "tetris:effect").item, "darkness")
  assert.equal(s.t.useItem("a", id, { item: "mirror" }).ok, false) // too soon
  s.clock.advance(3100)
  assert.equal(s.t.useItem("a", id, { item: "shield" }).ok, true)
  assert.equal(s.last("b", "tetris:item").item, "shield")
  assert.equal(s.t.useItem("a", id, { item: "nuke" }).ok, false)
})

test("Sprint race: the same seed for all, ordered by the server's clock, no impossible times", () => {
  const s = setup()
  const { roomId: id } = s.t.quick(s.P("a"), "race")
  s.t.quick(s.P("b"), "race")
  s.t.quick(s.P("c"), "race")
  s.clock.advance(8000)
  const seeds = ["a", "b", "c"].map((pid) => s.last(pid, "tetris:room").seed)
  assert.ok(Number.isInteger(seeds[0]))
  assert.equal(new Set(seeds).size, 1)
  s.clock.advance(3000)
  assert.equal(s.t.finishRace("b", id, { time: 5000, lines: 40 }).ok, false) // too fast to be real
  s.clock.advance(50_000)
  assert.equal(s.t.finishRace("b", id, { time: 49_000, lines: 40 }).ok, true)
  assert.equal(s.t.finishRace("a", id, { time: 1, lines: 12 }).ok, false) // not done
  s.clock.advance(5000)
  s.t.state("a", id, { b: ".".repeat(200), lines: 4, height: 0 })
  s.t.topout("c", id)
  s.t.finishRace("a", id, { time: 54_000, lines: 40 })
  const room = s.last("a", "tetris:room")
  assert.equal(room.phase, "over")
  assert.deepEqual(room.result.placements.map((p) => [p.id, p.place]), [["b", 1], ["a", 2], ["c", 3]])
  assert.equal(room.result.placements[0].time, 50_000)
  // pure ordering: finishers by time, then still racing by lines, then out
  const order = raceOrder([
    { pid: "out", alive: false, lines: 30, finishTime: null },
    { pid: "slow", alive: true, lines: 39, finishTime: null },
    { pid: "fast", alive: true, lines: 40, finishTime: 40_000 },
    { pid: "faster", alive: true, lines: 40, finishTime: 35_000 },
    { pid: "behind", alive: true, lines: 10, finishTime: null },
  ]).map((p) => p.pid)
  assert.deepEqual(order, ["faster", "fast", "slow", "behind", "out"])
})

test("Sprint race ends at the time limit", () => {
  const s = setup()
  const { roomId: id } = s.t.quick(s.P("a"), "race")
  s.t.quick(s.P("b"), "race")
  s.clock.advance(11_000)
  s.t.state("b", id, { b: ".".repeat(200), lines: 3 })
  s.clock.advance(180_000)
  const room = s.last("a", "tetris:room")
  assert.equal(room.result.reason, "time")
  assert.equal(room.result.placements[0].id, "b")
})

test("Quick Match alone: bots offered after 10 s, they fill the room and play", async () => {
  await ready
  const s = setup()
  const { roomId: id } = s.t.quick(s.P("a", "ka"), "arena")
  assert.equal(s.last("a", "tetris:room").canFillBots, false)
  s.clock.advance(10_000)
  assert.equal(s.last("a", "tetris:room").canFillBots, true)
  assert.equal(s.t.fillBots("a", id, "hard").ok, true)
  let room = s.last("a", "tetris:room")
  assert.equal(room.players.length, 4)
  assert.equal(room.players.filter((p) => p.bot === "hard").length, 3)
  s.clock.advance(3000)
  s.clock.advance(5000)
  const boards = s.all("a", "tetris:boards")
  assert.ok(boards.length > 10, "boards stream in")
  assert.ok(boards.every((m) => !m.boards.a))
  const lastBoards = Object.assign({}, ...boards.map((m) => m.boards))
  assert.equal(Object.keys(lastBoards).length, 3)
  assert.ok(Object.values(lastBoards).every((b) => /^[.ijlostzg#]{200}$/.test(b.b)))
  // the human loses: bots win, and a match against hard bots counts for stars
  s.t.topout("a", id)
  s.clock.advance(400_000)
  room = s.last("a", "tetris:room")
  assert.equal(room.phase, "over")
  assert.equal(room.result.ranked, true)
  assert.equal(room.result.placements.find((p) => p.id === "a").place, 4)
})

test("bots in a race finish 40 lines on the shared pieces", async () => {
  await ready
  const s = setup()
  const { roomId: id } = s.t.quick(s.P("a"), "race")
  s.clock.advance(10_000)
  s.t.fillBots("a", id, "hard")
  s.clock.advance(3000 + 90_000)
  const room = s.last("a", "tetris:room")
  const bots = room.players.filter((p) => p.bot)
  assert.ok(bots.every((p) => p.finishTime > 10_000), JSON.stringify(bots))
})

test("disconnects: a short grace, then you lose that match; back in time and you play on", () => {
  const s = setup()
  const id = startBattle(s)
  s.t.setAway("b", true)
  assert.equal(s.last("a", "tetris:room").players.find((p) => p.id === "b").away, true)
  s.clock.advance(3000)
  s.t.setAway("b", false)
  s.clock.advance(5000)
  assert.equal(s.last("a", "tetris:room").phase, "playing")
  s.t.setAway("b", true)
  s.clock.advance(5000)
  const room = s.last("a", "tetris:room")
  assert.equal(room.phase, "over")
  assert.equal(room.result.reason, "left")
  assert.equal(room.result.placements[0].id, "a")
  // in an Arena the others play on
  const s2 = setup()
  const { roomId } = s2.t.quick(s2.P("a"), "arena")
  s2.t.quick(s2.P("b"), "arena")
  s2.t.quick(s2.P("c"), "arena")
  s2.clock.advance(11_000)
  s2.t.drop("c")
  const r2 = s2.last("a", "tetris:room")
  assert.equal(r2.phase, "playing")
  assert.equal(r2.players.find((p) => p.id === "c").alive, false)
  assert.ok(s2.t.rooms.has(roomId))
})

test("private rooms: invitation only; the host invites, adds bots, picks the mode and starts", async () => {
  await ready
  const s = setup()
  const { roomId: id } = s.t.create(s.P("a"), { mode: "battle" })
  assert.equal(s.t.join(s.P("b"), id).ok, false)
  assert.equal(s.t.canInvite("a", id).ok, true)
  assert.equal(s.t.canInvite("b", id).ok, false)
  s.t.invitedTo(id, "B")
  assert.deepEqual(s.last("a", "tetris:room").invited, ["B"])
  assert.equal(s.t.allow("b", id).tetrisRoom, id)
  assert.equal(s.last("b", "tetris:invited").roomId, id)
  s.t.hello("b") // the Tetris window opens and finds the invitation
  assert.equal(s.all("b", "tetris:invited").length, 2)
  assert.equal(s.t.join(s.P("b"), id).ok, true)
  assert.deepEqual(s.last("a", "tetris:room").invited, [])
  assert.equal(s.t.setMode("b", id, "arena").ok, false) // only the host
  assert.equal(s.t.setMode("a", id, "arena").ok, true)
  assert.equal(s.t.fillBots("a", id, "easy").ok, true)
  assert.equal(s.last("b", "tetris:room").players.length, 3)
  assert.equal(s.t.start("b", id).ok, false)
  assert.equal(s.t.start("a", id).ok, true)
  assert.equal(s.t.busy("b"), true)
  // the room list only shows public rooms
  assert.equal(s.t.list().length, 0)
  s.t.quick(s.P("z"), "race")
  assert.deepEqual(s.t.list().map((r) => r.mode), ["race"])
})

test("stars and ranks", () => {
  assert.deepEqual(rankOf(0), { rank: 1, into: 0, need: 1 })
  assert.deepEqual(rankOf(1), { rank: 2, into: 0, need: 2 })
  assert.deepEqual(rankOf(4), { rank: 3, into: 1, need: 3 })
  assert.equal(starsFor("battle", 1, 2), 1)
  assert.equal(starsFor("battle", 2, 2), 0)
  assert.equal(starsFor("race", 1, 5), 2)
  assert.equal(starsFor("race", 3, 5), 0)
})

test("guests and easy bots don't rank", () => {
  const s = setup()
  const id = startBattle(s, ["ka", null])
  s.t.topout("a", id)
  s.clock.advance(1500)
  s.t.topout("a", id)
  s.clock.advance(1500)
  s.t.topout("a", id)
  const room = s.last("a", "tetris:room")
  assert.equal(room.result.placements[0].id, "b")
  assert.equal(room.result.placements[0].stars, 0) // b is a guest
})

test("invitations through Network Neighborhood / 98 Messenger let a friend into a private room", () => {
  const { createGames } = require("../games")
  const s = setup()
  const inbox = []
  const games = createGames({ emit: (pid, event, payload) => inbox.push({ pid, event, payload }), tetris: s.t })
  assert.equal(games.invite({ from: "a", fromName: "A", to: "b", toName: "B", game: "tetris", matchId: "nope" }).ok, false)
  const { roomId } = s.t.create(s.P("a"), { mode: "race" })
  const inv = games.invite({ from: "a", fromName: "A", to: "b", toName: "B", game: "tetris", matchId: roomId })
  assert.ok(inv.ok)
  assert.equal(inbox.find((m) => m.event === "net:invited").payload.options.mode, "race")
  assert.deepEqual(s.last("a", "tetris:room").invited, ["B"])
  const reply = games.replyInvite("b", inv.inviteId, true)
  assert.equal(reply.tetrisRoom, roomId)
  assert.equal(s.t.join(s.P("b"), roomId).ok, true)
  // a declined one clears the "invited" line
  const inv2 = games.invite({ from: "a", fromName: "A", to: "c", toName: "C", game: "tetris", matchId: roomId })
  assert.deepEqual(s.last("a", "tetris:room").invited, ["C"])
  games.replyInvite("c", inv2.inviteId, false)
  assert.deepEqual(s.last("a", "tetris:room").invited, [])
})
