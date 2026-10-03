// Pickleball 98 on the room system: settings, Quick Match sizes (singles starts with two,
// doubles waits a little for four), and the relay (snapshots, inputs, hits, the result).
const test = require("node:test")
const assert = require("node:assert/strict")
const { createRooms } = require("../rooms")
const pickleball = require("../games/pickleball")
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

const NAMES = { a: "Alice", b: "Bob", c: "Carol", d: "Dave", e: "Eve" }
const me = (pid) => ({ pid, name: NAMES[pid], key: null })

const setup = () => {
  const clock = fakeClock()
  const inbox = {}
  const fast = {}
  const box = (o, pid) => (o[pid] ||= [])
  const rooms = createRooms({
    games: [pickleball],
    emit: (pid, event, payload) => box(inbox, pid).push({ event, payload }),
    emitVolatile: (pid, event, payload) => box(fast, pid).push({ event, payload }),
    clock,
    random: () => 0.5,
  })
  const last = (pid) => [...box(inbox, pid)].reverse().find((m) => m.event === "room:state")?.payload
  return { rooms, clock, inbox, fast, last }
}

test("pickleball is listed with the online games and is a relay game", () => {
  assert.ok(games.some((g) => g.id === "pickleball"))
  assert.equal(pickleball.relay, true)
  assert.equal(pickleball.maxPlayers, 4)
})

test("settings: sensible defaults, bad values refused", () => {
  const v = pickleball.validateSettings
  assert.deepEqual(v({}), { format: "singles", target: 11, scoring: "sideout", venue: "stadium" })
  assert.deepEqual(v({ format: "doubles", target: "15", scoring: "rally", venue: "park" }), { format: "doubles", target: 15, scoring: "rally", venue: "park" })
  assert.match(v({ format: "triples" }).error, /singles or doubles/)
  assert.match(v({ target: 99 }).error, /7, 11 or 15/)
  assert.match(v({ scoring: "x" }).error, /scoring/)
  assert.match(v({ venue: "moon" }).error, /venue/)
  assert.equal(pickleball.bucket(v({ venue: "park" })), pickleball.bucket(v({ venue: "club" })), "the venue doesn't split Quick Match")
})

test("Quick Match: singles starts as soon as two people are in", () => {
  const { rooms, last } = setup()
  const a = rooms.quick(me("a"), "pickleball", { format: "singles" })
  assert.ok(a.ok)
  assert.equal(last("a").phase, "lobby")
  const b = rooms.quick(me("b"), "pickleball", { format: "singles" })
  assert.equal(b.roomId, a.roomId)
  assert.equal(last("a").phase, "playing")
  assert.equal(last("a").mode, "relay")
  // a third singles player gets a new room, not a seat in the full game
  const c = rooms.quick(me("c"), "pickleball", { format: "singles" })
  assert.notEqual(c.roomId, a.roomId)
})

test("Quick Match: doubles waits a moment for four, then plays with who's there", () => {
  const { rooms, last, clock } = setup()
  const a = rooms.quick(me("a"), "pickleball", { format: "doubles" })
  rooms.quick(me("b"), "pickleball", { format: "doubles" })
  assert.equal(last("a").phase, "lobby", "two people: waiting for more")
  assert.ok(last("a").startsAt, "but it starts on its own soon")
  rooms.quick(me("c"), "pickleball", { format: "singles" }) // a different game
  clock.advance(9000)
  assert.equal(last("a").phase, "playing")
  assert.equal(last("a").seats.filter(Boolean).length, 2)
  // four at once: starts right away
  const env = setup()
  for (const p of ["a", "b", "c", "d"]) env.rooms.quick(me(p), "pickleball", { format: "doubles" })
  assert.equal(env.last("d").phase, "playing")
  assert.equal(env.last("d").seats.length, 4)
  assert.ok(a.ok)
})

test("a private room: the relay carries snapshots, inputs and hits; the host reports the result", () => {
  const { rooms, last, fast, inbox } = setup()
  const made = rooms.create(me("a"), "pickleball", { format: "singles", venue: "park" })
  assert.equal(last("a").settings.venue, "park")
  rooms.join(me("b"), { code: made.code })
  rooms.ready("b", made.roomId, true)
  assert.ok(rooms.start("a", made.roomId).ok)
  rooms.snap("a", made.roomId, { v: 1, t: 1.5, b: [0, 1, 2] })
  assert.equal(fast.b.at(-1).event, "room:snap")
  rooms.input("b", made.roomId, { s: 1, x: 0.5, z: -6 })
  assert.deepEqual(fast.a.at(-1).payload.data, { s: 1, x: 0.5, z: -6 })
  assert.equal(fast.a.at(-1).payload.from, 1)
  assert.ok(rooms.relay("b", made.roomId, { type: "hit", s: { t: 1.4 } }).ok)
  assert.equal(inbox.a.at(-1).event, "room:relay")
  assert.ok(rooms.finishRelay("a", made.roomId, { winners: [1], reason: "11-7", scores: [7, 11] }).ok)
  const over = last("a")
  assert.equal(over.phase, "over")
  assert.deepEqual(over.result.winnerNames, ["Bob"])
  assert.deepEqual(over.result.scores, [7, 11])
})
