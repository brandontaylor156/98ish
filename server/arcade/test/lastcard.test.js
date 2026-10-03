// Last Card on the online room system (server/arcade/games/lastcard.js): the server deals
// and keeps every hand to itself, runs the turn clock and the Last Card catch window on its
// own clock, takes moves first come first served, and computer players fill in.
const test = require("node:test")
const assert = require("node:assert/strict")
const { createRooms } = require("../rooms")
const lastcard = require("../games/lastcard")

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

const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647
const PEOPLE = { a: "Alice", b: "Bob", c: "Carol", d: "Dave" }
const me = (pid) => ({ pid, name: PEOPLE[pid], key: null })

const setup = () => {
  const clock = fakeClock()
  const inbox = { a: [], b: [], c: [], d: [] }
  const rooms = createRooms({ games: [lastcard], emit: (pid, event, payload) => inbox[pid]?.push({ event, payload }), clock, random: seeded(21) })
  const last = (pid) => [...inbox[pid]].reverse().find((m) => m.event === "room:state")?.payload
  return { rooms, clock, inbox, last }
}

// a private room with these settings, everyone in and ready, started
const startRoom = (t, settings, pids = ["a", "b"]) => {
  const made = t.rooms.create(me(pids[0]), "lastcard", { players: pids.length, ...settings })
  assert.ok(made.ok, made.error)
  for (const pid of pids.slice(1)) {
    assert.ok(t.rooms.join(me(pid), { code: made.code }).ok)
    assert.ok(t.rooms.ready(pid, made.roomId, true).ok)
  }
  const started = t.rooms.start(pids[0], made.roomId)
  assert.ok(started.ok, started.error)
  return made.roomId
}

const stateOf = (t, roomId) => t.rooms.rooms.get(roomId).state
let nextId = 5000
const C = (spec) => ({ id: nextId++, c: spec[0], v: spec.slice(1) })
// set the table up just so (tests only): hands by seat, the top card, whose turn
const rig = (t, roomId, { hands, top = "r3", turn = 0 }) => {
  const s = stateOf(t, roomId)
  s.hands = hands.map((h) => h.map(C))
  s.discard = [C(top)]
  s.color = top[0]
  s.turn = turn
  s.called = hands.map(() => false)
  return s
}
const idOf = (t, roomId, seat, spec) => stateOf(t, roomId).hands[seat].find((c) => c.c + c.v === spec).id

test.before(async () => {
  await lastcard.ready
})

test("the room's seats follow the players setting (2 to 10)", () => {
  const t = setup()
  const made = t.rooms.create(me("a"), "lastcard", { players: 6 })
  assert.ok(made.ok)
  assert.equal(t.last("a").seats.length, 6)
  assert.ok(t.rooms.setSettings("a", made.roomId, { players: 10, stacking: true }).ok)
  assert.equal(t.last("a").seats.length, 10)
  assert.equal(t.last("a").settings.stacking, true)
  assert.match(t.rooms.setSettings("a", made.roomId, { players: 12 }).error, /2 to 10/)
  assert.match(t.rooms.setSettings("a", made.roomId, { timer: 7 }).error, /timer/)
})

test("everyone sees their own hand and only the number of cards the others hold", () => {
  const t = setup()
  const roomId = startRoom(t, { handSize: 7 }, ["a", "b", "c"])
  const s = stateOf(t, roomId)
  const views = ["a", "b", "c"].map((pid) => t.last(pid).view)
  views.forEach((v, seat) => {
    assert.deepEqual(v.hand.map((c) => c.id).sort(), s.hands[seat].map((c) => c.id).sort())
    assert.deepEqual(v.counts, [7, 7, 7])
    const text = JSON.stringify(v)
    for (const [other, hand] of s.hands.entries()) if (other !== seat) for (const c of hand) assert.ok(!text.includes(`"id":${c.id},`), "a hidden card leaked")
    for (const c of s.deck) assert.ok(!text.includes(`"id":${c.id},`), "the draw pile leaked")
  })
  // a spectator: no hand at all
  t.rooms.join(me("d"), { code: t.rooms.rooms.get(roomId).code })
  assert.equal(t.last("d").spectator, true)
  assert.equal(t.last("d").view.hand, null)
})

test("moves go through the server's rules; out of turn is refused", () => {
  const t = setup()
  const roomId = startRoom(t, { timer: 0 }, ["a", "b", "c"])
  rig(t, roomId, { hands: [["r5", "b1"], ["y1", "y2"], ["g1", "g2"]] })
  assert.match(t.rooms.act("b", roomId, { type: "play", card: idOf(t, roomId, 1, "y1") }).error, /not your turn/)
  assert.match(t.rooms.act("a", roomId, { type: "play", card: idOf(t, roomId, 0, "b1") }).error, /doesn't match/)
  assert.ok(t.rooms.act("a", roomId, { type: "play", card: idOf(t, roomId, 0, "r5"), call: true }).ok)
  assert.equal(t.last("b").view.turn, 1)
  assert.equal(t.last("b").view.counts[0], 1)
  assert.equal(t.last("b").view.called[0], true)
})

test("the Last Card catch window runs on the server clock: the first catch counts, late ones don't", () => {
  const t = setup()
  const roomId = startRoom(t, { timer: 0 }, ["a", "b", "c"])
  rig(t, roomId, { hands: [["r5", "b1"], ["y1", "y2"], ["g1", "g2"]] })
  assert.ok(t.rooms.act("a", roomId, { type: "play", card: idOf(t, roomId, 0, "r5") }).ok)
  const v = t.last("c").view.vuln
  assert.equal(v.seat, 0)
  assert.equal(v.until, t.clock.now() + 3000)
  t.clock.advance(800)
  assert.ok(t.rooms.act("c", roomId, { type: "catch" }).ok)
  assert.match(t.rooms.act("b", roomId, { type: "catch" }).error, /nobody/)
  assert.equal(t.last("a").view.hand.length, 3)
  // forgetting again, and nobody catches in time: the window closes by itself
  const t2 = setup()
  const r2 = startRoom(t2, { timer: 0 }, ["a", "b"])
  rig(t2, r2, { hands: [["r5", "b1"], ["y1", "y2"]] })
  assert.ok(t2.rooms.act("a", r2, { type: "play", card: idOf(t2, r2, 0, "r5") }).ok)
  assert.ok(t2.last("b").view.vuln)
  t2.clock.advance(3001)
  assert.equal(t2.last("b").view.vuln, null)
  assert.match(t2.rooms.act("b", r2, { type: "catch" }).error, /nobody/)
})

test("jump-in: the first identical card to reach the server plays; play continues from the jumper", () => {
  const t = setup()
  const roomId = startRoom(t, { timer: 0, jumpIn: true }, ["a", "b", "c", "d"])
  rig(t, roomId, { hands: [["b1", "b2"], ["g4", "g5"], ["r3", "y9"], ["r3", "y8"]], top: "r3", turn: 0 })
  assert.ok(t.rooms.act("c", roomId, { type: "play", card: idOf(t, roomId, 2, "r3") }).ok)
  assert.equal(t.last("a").view.turn, 3)
  // Dave's red 3 is still the very same card: he can jump in on Carol's
  assert.ok(t.rooms.act("d", roomId, { type: "play", card: idOf(t, roomId, 3, "r3") }).ok)
  assert.equal(t.last("a").view.turn, 0)
  assert.match(t.rooms.act("b", roomId, { type: "play", card: idOf(t, roomId, 1, "g4") }).error, /very same|not your turn/)
})

test("the turn clock: out of time, you draw and play moves on", () => {
  const t = setup()
  const roomId = startRoom(t, { timer: 15 }, ["a", "b"])
  const s = stateOf(t, roomId)
  const who = s.turn
  const before = s.hands[who].length
  assert.equal(t.last("a").view.turnEnds, t.clock.now() + 15_000)
  t.clock.advance(15_001)
  const after = stateOf(t, roomId)
  assert.ok(after.hands[who].length === before + 1 || after.turn === who, "drew a card")
  assert.notEqual(after.turnId, s.turnId)
})

test("Play the Computer: computer players with characters play a whole game on their own", () => {
  const t = setup()
  const made = t.rooms.create(me("a"), "lastcard", { players: 5, target: 0, timer: 15, bots: "hard" })
  assert.ok(t.rooms.fillBots("a", made.roomId).ok)
  assert.ok(t.rooms.start("a", made.roomId).ok)
  const warn = console.warn
  const warnings = []
  console.warn = (...a) => warnings.push(a.join(" "))
  try {
    // Alice never moves: her clock runs out every turn while the computers play
    for (let i = 0; i < 400 && t.last("a").phase === "playing"; i++) t.clock.advance(2000)
  } finally {
    console.warn = warn
  }
  assert.equal(t.last("a").phase, "over")
  assert.deepEqual(warnings, [])
  assert.ok(t.last("a").view.personas.every((p) => ["bold", "careful", "sly", "chill"].includes(p)))
  assert.equal(t.last("a").result.reason, "out")
})

test("a player who leaves mid-game is replaced by a computer player who keeps their hand", () => {
  const t = setup()
  const roomId = startRoom(t, { timer: 0 }, ["a", "b"])
  stateOf(t, roomId).turn = 1
  const hand = stateOf(t, roomId).hands[1].map((c) => c.id)
  t.rooms.leave("b", roomId)
  const view = t.last("a")
  assert.equal(view.seats[1].bot, true)
  assert.match(view.seats[1].name, /Bob/)
  assert.deepEqual(stateOf(t, roomId).hands[1].map((c) => c.id).slice(0, hand.length), hand)
  // the computer plays Bob's turns
  for (let i = 0; i < 20 && stateOf(t, roomId).turn !== 0; i++) t.clock.advance(1600)
  assert.equal(stateOf(t, roomId).turn === 0 || t.last("a").phase !== "playing", true)
})

test("coming back (a new window) gets the same hand", () => {
  const t = setup()
  const roomId = startRoom(t, {}, ["a", "b"])
  const hand = t.last("b").view.hand.map((c) => c.id)
  t.inbox.b.length = 0
  assert.equal(t.rooms.hello("b", "lastcard").roomId, roomId)
  assert.deepEqual(t.last("b").view.hand.map((c) => c.id), hand)
})

test("Quick Match fills with computer players and keeps tables of the same size together", () => {
  const t = setup()
  const a = t.rooms.quick(me("a"), "lastcard", { players: 4 })
  const b = t.rooms.quick(me("b"), "lastcard", { players: 4, stacking: true })
  assert.equal(a.roomId, b.roomId)
  const c = t.rooms.quick(me("c"), "lastcard", { players: 6 })
  assert.notEqual(c.roomId, a.roomId)
  t.clock.advance(16_000)
  assert.ok(t.rooms.fillBots("c", c.roomId).ok)
  assert.equal(t.last("c").phase, "playing")
  assert.equal(t.last("c").seats.length, 6)
})
