// Color Match, Echo Pads and Tetherball on the room system: rooms, settings, server-checked
// answers and the clock (Color Match), turns and knock-outs with computer players (Echo
// Pads), and the relay with its message checks (Tetherball).
const test = require("node:test")
const assert = require("node:assert/strict")
const { createRooms } = require("../rooms")
const colormatch = require("../games/colormatch")
const echo = require("../games/echo")
const tetherball = require("../games/tetherball")
const games = require("../games")

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
  }
}

const NAMES = { a: "Alice", b: "Bob", c: "Carol" }
const me = (pid) => ({ pid, name: NAMES[pid], key: null })
const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647

const setup = (game) => {
  const clock = fakeClock()
  const inbox = {}
  const fast = {}
  const box = (o, pid) => (o[pid] ||= [])
  const rooms = createRooms({
    games: [game],
    emit: (pid, event, payload) => box(inbox, pid).push({ event, payload }),
    emitVolatile: (pid, event, payload) => box(fast, pid).push({ event, payload }),
    clock,
    random: seeded(11),
  })
  const last = (pid) => [...box(inbox, pid)].reverse().find((m) => m.event === "room:state")?.payload
  return { rooms, clock, inbox, fast, last }
}

// Play the Computer, as the client does it: a private room, computer players, start
const vsComputer = (t, pid, game, settings) => {
  const made = t.rooms.create(me(pid), game, settings)
  if (!made.ok) return made
  const bots = t.rooms.fillBots(pid, made.roomId)
  if (!bots.ok) return bots
  const started = t.rooms.start(pid, made.roomId)
  return started.ok ? { ok: true, roomId: made.roomId } : started
}

let cm = null
let ec = null
test.before(async () => {
  await colormatch.ready
  await echo.ready
  cm = await import("../../../client/src/components/applets/colormatch/rules.js")
  ec = await import("../../../client/src/components/applets/echo/rules.js")
})

test("the three games are listed", () => {
  for (const id of ["colormatch", "echo", "tetherball"]) assert.ok(games.some((g) => g.id === id), id)
  assert.equal(tetherball.relay, true)
})

test("Color Match: a room, the same questions for both, server-checked answers, best score wins", () => {
  const t = setup(colormatch)
  const made = t.rooms.create(me("a"), "colormatch", { mode: "classic", seconds: 30, players: 2 })
  assert.ok(made.ok, made.error)
  assert.ok(t.rooms.join(me("b"), { code: made.code }).ok)
  assert.ok(t.rooms.ready("b", made.roomId, true).ok)
  assert.ok(t.rooms.start("a", made.roomId).ok)
  const va = t.last("a").view
  assert.equal(va.seed, t.last("b").view.seed, "one sequence for everyone")
  assert.equal(va.phase, "countdown")
  const early = t.rooms.act("a", made.roomId, { type: "answer", i: 0, choice: true })
  assert.equal(early.ok, false)
  t.clock.advance(va.goAt - t.clock.now() + 10)
  assert.equal(t.last("a").view.phase, "playing")
  // Alice answers 10 right; Bob 10 wrong
  for (let i = 0; i < 10; i++) {
    const q = cm.questionAt(va.seed, i, "classic")
    t.clock.advance(400)
    assert.ok(t.rooms.act("a", made.roomId, { type: "answer", i, choice: q.answer }).ok)
    assert.ok(t.rooms.act("b", made.roomId, { type: "answer", i, choice: !q.answer }).ok)
  }
  const mid = t.last("b").view
  assert.equal(mid.players[0].score, 4 * 50 + 4 * 100 + 2 * 150)
  assert.equal(mid.players[1].score, 0)
  t.clock.advance(31_000)
  const end = t.last("a")
  assert.equal(end.phase, "over")
  assert.deepEqual(end.result.winnerNames, ["Alice"])
})

test("Color Match: Quick Match against the computer finishes with scores for both", () => {
  const t = setup(colormatch)
  const r = vsComputer(t, "a", "colormatch", { mode: "swatch", seconds: 30, players: 2 })
  assert.ok(r.ok, r.error)
  const v = t.last("a").view
  t.clock.advance(v.goAt - t.clock.now() + 31_000)
  const end = t.last("a")
  assert.equal(end.phase, "over")
  assert.ok(end.view.players[1].score > 0, "the computer answered")
  assert.deepEqual(end.result.winnerNames, [end.seats[1].name])
})

test("Echo Pads: turns go round, a wrong press knocks you out, a computer player keeps up", () => {
  const t = setup(echo)
  const made = t.rooms.create(me("a"), "echo", { players: 3, replay: false })
  assert.ok(made.ok, made.error)
  assert.ok(t.rooms.join(me("b"), { code: made.code }).ok)
  assert.ok(t.rooms.join(me("c"), { code: made.code }).ok)
  t.rooms.ready("b", made.roomId, true)
  t.rooms.ready("c", made.roomId, true)
  assert.ok(t.rooms.start("a", made.roomId).ok)
  const pid = ["a", "b", "c"]
  let v = t.last("a").view
  // the first player adds a step
  assert.equal(v.phase, "add")
  const first = v.turn
  assert.equal(t.rooms.act(pid[(first + 1) % 3], made.roomId, { type: "press", pad: 0 }).ok, false, "not your turn")
  assert.ok(t.rooms.act(pid[first], made.roomId, { type: "press", pad: 2 }).ok)
  v = t.last("a").view
  assert.deepEqual(v.seq, [2])
  assert.equal(v.turn, (first + 1) % 3)
  // next player gets it wrong: out
  assert.ok(t.rooms.act(pid[v.turn], made.roomId, { type: "press", pad: 1 }).ok)
  const out = v.turn
  v = t.last("a").view
  assert.equal(v.alive[out], false)
  assert.equal(v.last.ok, false)
  // the third player repeats and adds; then the clock runs out on the first player
  const third = v.turn
  assert.ok(t.rooms.act(pid[third], made.roomId, { type: "press", pad: 2 }).ok)
  assert.ok(t.rooms.act(pid[third], made.roomId, { type: "press", pad: 3 }).ok)
  t.clock.advance(ec.FIRST_MS + 50)
  const end = t.last("a")
  assert.equal(end.phase, "over")
  assert.deepEqual(end.result.winnerNames, [NAMES[pid[third]]])

  // against the computer: it repeats what it saw and adds its own step
  const u = setup(echo)
  const r = vsComputer(u, "a", "echo", { replay: false, players: 2 })
  assert.ok(r.ok, r.error)
  for (let round = 0; round < 3; round++) {
    let w = u.last("a").view
    if (w.turn !== 0) {
      u.clock.advance(1500)
      w = u.last("a").view
    }
    if (w.phase === "over") break
    for (const pad of ec.expectedFor(w.seq, w.mode)) assert.ok(u.rooms.act("a", r.roomId, { type: "press", pad }).ok)
    assert.ok(u.rooms.act("a", r.roomId, { type: "press", pad: round % 4 }).ok)
    u.clock.advance(800 * (w.seq.length + 2))
  }
  const w = u.last("a").view
  assert.ok(w.seq.length >= 4 || w.phase === "over", `sequence ${w.seq.length}`)
})

test("Tetherball: settings, relay of snapshots, swings checked, result recorded", () => {
  assert.deepEqual(tetherball.validateSettings({}), { target: 2 })
  assert.ok(tetherball.validateSettings({ target: 7 }).error)
  assert.equal(tetherball.filterRelay({ type: "swing", at: "x", power: 1, loft: 0 }), null)
  assert.deepEqual(tetherball.filterRelay({ type: "swing", at: 12.5, power: 3, loft: 0.2, extra: 1 }), { type: "swing", at: 12.5, power: 1, loft: 0.2, id: 0 })
  assert.equal(tetherball.filterRelay({ type: "cheat" }), null)
  const t = setup(tetherball)
  const made = t.rooms.create(me("a"), "tetherball", { target: 1 })
  assert.ok(made.ok, made.error)
  assert.ok(t.rooms.join(me("b"), { code: made.code }).ok)
  t.rooms.ready("b", made.roomId, true)
  assert.ok(t.rooms.start("a", made.roomId).ok)
  assert.equal(t.last("a").phase, "playing")
  assert.equal(t.last("a").mode, "relay")
  t.rooms.snap("a", made.roomId, { b: [0, 1, 2] })
  assert.ok((t.fast.b || []).some((m) => m.event === "room:snap"))
  t.rooms.relay("b", made.roomId, { type: "swing", at: 3.2, power: 0.7, loft: 0.1 })
  assert.ok((t.inbox.a || []).some((m) => m.event === "room:relay" && m.payload.data.type === "swing"))
  const fin = t.rooms.finishRelay("a", made.roomId, { winners: [1], reason: "1-0" })
  assert.ok(fin.ok, fin.error)
  assert.deepEqual(t.last("a").result.winnerNames, ["Bob"])
})
