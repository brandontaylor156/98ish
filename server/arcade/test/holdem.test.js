// Texas Hold'em on the online room system (server/arcade/games/holdem.js): the server deals
// and keeps the deck and everyone's hole cards, runs the turn clock on its own clock, and
// computer players fill seats and take over for anyone who leaves.
const test = require("node:test")
const assert = require("node:assert/strict")
const { createRooms } = require("../rooms")
const holdem = require("../games/holdem")

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
  const rooms = createRooms({ games: [holdem], emit: (pid, event, payload) => inbox[pid]?.push({ event, payload }), clock, random: seeded(21) })
  const last = (pid) => [...inbox[pid]].reverse().find((m) => m.event === "room:state")?.payload
  return { rooms, clock, inbox, last }
}

const startRoom = (t, settings, pids = ["a", "b"]) => {
  const made = t.rooms.create(me(pids[0]), "holdem", { players: pids.length, ...settings })
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
const pidAt = (pids, seat) => pids[seat]

test.before(async () => {
  await holdem.ready
})

test("settings: 2 to 8 seats, and online tables always have a turn clock", () => {
  const t = setup()
  const made = t.rooms.create(me("a"), "holdem", { players: 6, timer: 0 })
  assert.ok(made.ok, made.error)
  assert.equal(t.last("a").seats.length, 6)
  assert.equal(t.last("a").settings.timer, 30)
  assert.match(t.rooms.setSettings("a", made.roomId, { players: 9 }).error, /2 to 8/)
  assert.ok(t.rooms.setSettings("a", made.roomId, { players: 3, blind: 25, stack: 2500, timer: 45 }).ok)
  assert.equal(t.last("a").seats.length, 3)
})

test("everyone sees their own hole cards, nobody else's, and never the deck", () => {
  const t = setup()
  const pids = ["a", "b", "c"]
  const roomId = startRoom(t, {}, pids)
  const s = stateOf(t, roomId)
  pids.forEach((pid, seat) => {
    const v = t.last(pid).view
    assert.deepEqual(v.seats[seat].cards.map((c) => c.id), s.hand.players[seat].cards.map((c) => c.id))
    const text = JSON.stringify(v)
    for (const [other, p] of s.hand.players.entries()) if (other !== seat) for (const c of p.cards) assert.ok(!text.includes(`"id":"${c.id}"`), "a hidden card leaked")
    for (const c of s.hand.deck) assert.ok(!text.includes(`"id":"${c.id}"`), "the deck leaked")
  })
  t.rooms.join(me("d"), { code: t.rooms.rooms.get(roomId).code })
  const spec = t.last("d")
  assert.equal(spec.spectator, true)
  assert.ok(spec.view.seats.every((x) => x.cards.every((c) => c === null)))
})

test("moves go through the server's rules: out of turn and bad raises are refused", () => {
  const t = setup()
  const pids = ["a", "b", "c"]
  const roomId = startRoom(t, { timer: 30 }, pids)
  const s = stateOf(t, roomId)
  const turn = s.hand.toAct
  const other = pidAt(pids, (turn + 1) % 3)
  assert.match(t.rooms.act(other, roomId, { type: "call" }).error, /isn't your turn/)
  assert.match(t.rooms.act(pidAt(pids, turn), roomId, { type: "raise", to: 25 }).error, /smallest raise/)
  assert.ok(t.rooms.act(pidAt(pids, turn), roomId, { type: "raise", to: 60 }).ok)
  assert.equal(t.last("a").view.seats[turn].bet, 60)
  assert.equal(t.last("a").view.toAct, (turn + 1) % 3)
})

test("the turn clock runs on the server: out of time, you check or fold", () => {
  const t = setup()
  const pids = ["a", "b", "c"]
  const roomId = startRoom(t, { timer: 15 }, pids)
  const turn = stateOf(t, roomId).hand.toAct
  assert.equal(t.last("a").view.deadline, t.clock.now() + 15_000)
  t.clock.advance(15_001)
  assert.equal(stateOf(t, roomId).hand.players[turn].folded, true)
})

test("Play the Computer: a table of computer players plays a whole game while you time out", () => {
  const t = setup()
  const made = t.rooms.create(me("a"), "holdem", { players: 5, stack: 500, blind: 25, blindsUp: 5, timer: 15, bots: "hard" })
  assert.ok(t.rooms.fillBots("a", made.roomId).ok)
  assert.ok(t.rooms.start("a", made.roomId).ok)
  const warn = console.warn
  const warnings = []
  console.warn = (...a) => warnings.push(a.join(" "))
  try {
    for (let i = 0; i < 6000 && t.last("a").phase === "playing"; i++) t.clock.advance(2000)
  } finally {
    console.warn = warn
  }
  assert.equal(t.last("a").phase, "over")
  assert.deepEqual(warnings, [])
  const v = t.last("a").view
  const winner = t.last("a").result.winners[0]
  assert.equal(v.seats[winner].stack, 5 * 500)
  assert.equal(t.last("a").result.reason, "chips")
})

test("a player who leaves mid-game is replaced by a computer player who keeps their chips", () => {
  const t = setup()
  const pids = ["a", "b"]
  const roomId = startRoom(t, { timer: 30 }, pids)
  const stack = stateOf(t, roomId).seats[1].stack
  t.rooms.leave("b", roomId)
  const view = t.last("a")
  assert.equal(view.seats[1].bot, true)
  assert.match(view.seats[1].name, /Bob/)
  assert.equal(stateOf(t, roomId).seats[1].stack, stack)
  // the computer plays Bob's turns
  const s = stateOf(t, roomId)
  if (s.hand.toAct === 1) {
    t.clock.advance(3000)
    assert.notEqual(stateOf(t, roomId).hand.toAct === 1 && stateOf(t, roomId).hand.turnId === s.hand.turnId, true)
  }
})

test("Quick Match keeps the same table size and stakes together", () => {
  const t = setup()
  const a = t.rooms.quick(me("a"), "holdem", { players: 4, blind: 10, stack: 1000 })
  const b = t.rooms.quick(me("b"), "holdem", { players: 4, blind: 10, stack: 1000 })
  assert.equal(a.roomId, b.roomId)
  const c = t.rooms.quick(me("c"), "holdem", { players: 4, blind: 25, stack: 1000 })
  assert.notEqual(c.roomId, a.roomId)
})
