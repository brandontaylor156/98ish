// Hexlands on the online room system (server/arcade/games/hexlands.js): the room's settings
// size it, the server keeps hands and the development deck to itself, trades go between
// people through the room, the turn clock and computer players keep the game moving.
const test = require("node:test")
const assert = require("node:assert/strict")
const { createRooms } = require("../rooms")
const hexlands = require("../games/hexlands")

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

const setup = (seed = 11) => {
  const clock = fakeClock()
  const inbox = { a: [], b: [], c: [], d: [] }
  const rooms = createRooms({ games: [hexlands], emit: (pid, event, payload) => inbox[pid]?.push({ event, payload }), clock, random: seeded(seed) })
  const last = (pid) => [...inbox[pid]].reverse().find((m) => m.event === "room:state")?.payload
  return { rooms, clock, inbox, last }
}

const startRoom = (t, settings, pids = ["a", "b"]) => {
  const made = t.rooms.create(me(pids[0]), "hexlands", settings)
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
let rules = null
let board = null

test.before(async () => {
  rules = await hexlands.ready
  board = await import("../../../client/src/components/applets/hexlands/board.js")
})

test("the room has as many seats as the players setting, and bad settings are refused", () => {
  const t = setup()
  const made = t.rooms.create(me("a"), "hexlands", { players: 3 })
  assert.equal(t.last("a").seats.length, 3)
  assert.equal(t.last("a").settings.timer, 90, "online games have a turn clock by default")
  assert.ok(t.rooms.setSettings("a", made.roomId, { players: 6, target: 12 }).ok)
  assert.equal(t.last("a").seats.length, 6)
  assert.equal(t.last("a").settings.target, 12)
  const bad = t.rooms.setSettings("a", made.roomId, { players: 4, deck: { ranger: 0, roads: 0, plenty: 0, monopoly: 0, monument: 0 } })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /deck/)
})

test("hands and the deck stay on the server: everyone sees only counts of other hands", () => {
  const t = setup()
  const roomId = startRoom(t, { players: 2, timer: 0 })
  const st = stateOf(t, roomId)
  assert.equal(st.players.length, 2)
  // play the setup through the room
  while (stateOf(t, roomId).phase === "setup") {
    const s = stateOf(t, roomId)
    const pid = s.turn === 0 ? "a" : "b"
    const a = rules.bot(s, s.turn, { random: seeded(3) })
    const r = t.rooms.act(pid, roomId, a)
    assert.ok(r.ok, r.error)
  }
  const s = stateOf(t, roomId)
  assert.equal(s.phase, "roll")
  const viewA = t.last("a").view
  assert.ok(viewA.players[0].hand)
  assert.equal(viewA.players[1].hand, null)
  assert.equal(viewA.players[1].cards, rules.view(s, 1).players[1].cards)
  assert.equal(typeof viewA.deck, "number")
  // nothing sent to Alice ever carried Bob's hand or the deck's order
  for (const m of t.inbox.a) {
    const v = m.payload?.view
    if (!v) continue
    assert.equal(v.players[1].hand, null)
    assert.ok(!Array.isArray(v.deck))
  }
  // moving out of turn is refused with a sentence
  const wrong = s.turn === 0 ? "b" : "a"
  const refused = t.rooms.act(wrong, roomId, { type: "roll" })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /turn/)
})

test("two people trade through the room: offer, counter, confirm", () => {
  const t = setup()
  const roomId = startRoom(t, { players: 2, timer: 0 })
  const room = t.rooms.rooms.get(roomId)
  // skip ahead to Alice's turn, after the roll, with cards to trade
  const s = structuredClone(room.state)
  s.phase = "main"
  s.turn = 0
  s.turnNo = 2
  s.setupStep = s.order.length
  s.players[0].hand = { timber: 2, clay: 0, wool: 3, grain: 0, ore: 0 }
  s.players[1].hand = { timber: 0, clay: 1, wool: 0, grain: 0, ore: 2 }
  room.state = s
  assert.ok(t.rooms.act("a", roomId, { type: "offer", give: { wool: 1 }, get: { ore: 1 } }).ok)
  const offer = t.last("b").view.trade
  assert.deepEqual(offer.give, { wool: 1 })
  assert.equal(t.rooms.act("b", roomId, { type: "reply", id: offer.id, answer: "counter", give: { wool: 2 }, get: { ore: 1 } }).ok, true)
  assert.equal(t.last("a").view.trade.replies[1].a, "counter")
  assert.ok(t.rooms.act("a", roomId, { type: "confirm", id: offer.id, with: 1 }).ok)
  assert.deepEqual(stateOf(t, roomId).players[0].hand, { timber: 2, clay: 0, wool: 1, grain: 0, ore: 1 })
  assert.deepEqual(t.last("b").view.players[1].hand, { timber: 0, clay: 1, wool: 2, grain: 0, ore: 1 })
  // an offer nobody answers runs out
  assert.ok(t.rooms.act("a", roomId, { type: "offer", give: { timber: 1 }, get: { clay: 1 } }).ok)
  t.clock.advance(46_000)
  assert.equal(stateOf(t, roomId).trade, null)
})

test("a steal is shown to the two players involved only", () => {
  const t = setup()
  const roomId = startRoom(t, { players: 3, timer: 0 }, ["a", "b", "c"])
  const room = t.rooms.rooms.get(roomId)
  const s = structuredClone(room.state)
  s.phase = "bandit"
  s.resume = "main"
  s.turn = 0
  s.turnNo = 2
  s.setupStep = s.order.length
  const tile = s.bandit === 0 ? 1 : 0
  // Bob has a settlement on the tile and one wool
  s.verts[board.geometry(s.geo).tiles[tile].corners[0]] = { p: 1, k: "s" }
  s.players[1].hand.wool = 1
  room.state = s
  assert.ok(t.rooms.act("a", roomId, { type: "bandit", tile, victim: 1 }).ok)
  const steal = (pid) => t.last(pid).view.log.find((e) => e.k === "steal")
  assert.equal(steal("a").r, "wool")
  assert.equal(steal("b").r, "wool")
  assert.equal(steal("c").r, undefined)
  for (const m of t.inbox.c) for (const e of m.payload?.view?.log || []) if (e.k === "steal") assert.equal(e.r, undefined)
})

test("the turn clock and computer players carry a game to the end", () => {
  const t = setup(5)
  const made = t.rooms.create(me("a"), "hexlands", { players: 4, timer: 45 })
  assert.ok(t.rooms.fillBots("a", made.roomId).ok)
  assert.ok(t.rooms.start("a", made.roomId).ok)
  // Alice never moves: the clock plays her turns; the computer players play theirs
  for (let i = 0; i < 4000 && t.last("a").phase === "playing"; i++) t.clock.advance(5000)
  const end = t.last("a")
  assert.equal(end.phase, "over")
  assert.equal(end.result.reason, "points")
  assert.ok(end.view.players.every((p) => p.hand), "hands are shown at the end")
})

test("a player who leaves mid-game is replaced by a computer player", () => {
  const t = setup(7)
  const roomId = startRoom(t, { players: 2, timer: 0 })
  t.rooms.leave("b", roomId)
  const seats = t.last("a").seats
  assert.ok(seats[1].bot)
  // the computer player places when it's its turn
  const s = stateOf(t, roomId)
  if (s.turn === 1) {
    t.clock.advance(5000)
    assert.notEqual(stateOf(t, roomId).setupStep + (stateOf(t, roomId).setupVertex != null ? 1 : 0), 0)
  }
  assert.ok(stateOf(t, roomId).players[1].bot || t.last("a").seats[1].bot)
})
