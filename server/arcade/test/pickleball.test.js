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
  // the real venues and the time of day (Pickleball 98's where & when)
  assert.equal(v({ venue: "newport", tod: "golden" }).venue, "newport")
  assert.equal(v({ venue: "bouquet" }).venue, "bouquet")
  assert.equal(v({ tod: "golden" }).tod, "golden")
  assert.match(v({ tod: "teatime" }).error, /time of day/)
  assert.match(v({ venue: "riverside" }).error, /venue/)
})

test("drilling with a friend: a two-person room, its own Quick Match line per drill", () => {
  const v = pickleball.validateSettings
  const d = v({ mode: "drill", drill: "dinks", format: "doubles" })
  assert.deepEqual([d.mode, d.drill, d.format], ["drill", "dinks", "singles"])
  assert.match(v({ mode: "drill" }).error, /drill/)
  assert.match(v({ mode: "drill", drill: "smash" }).error, /drill/)
  assert.match(v({ mode: "party" }).error, /match or a drill/)
  assert.equal(pickleball.seats(d), 2)
  assert.equal(pickleball.seats(v({})), 4)
  assert.notEqual(pickleball.bucket(d), pickleball.bucket(v({})), "a drill isn't a match")
  assert.notEqual(pickleball.bucket(d), pickleball.bucket(v({ mode: "drill", drill: "volleys" })), "nor another drill")
  const { rooms, last } = setup()
  const a = rooms.quick(me("a"), "pickleball", { mode: "drill", drill: "dinks" })
  rooms.quick(me("x"), "pickleball", { format: "singles" }) // someone after a match: not paired with a drill
  assert.equal(last("a").phase, "lobby")
  const b = rooms.quick(me("b"), "pickleball", { mode: "drill", drill: "dinks" })
  assert.equal(b.roomId, a.roomId)
  assert.equal(last("a").phase, "playing")
  assert.equal(last("a").seats.length, 2)
  assert.equal(last("a").settings.drill, "dinks")
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

test("looks over the relay: only known ids, #rrggbb colors and a height in range get through", () => {
  const { rooms, inbox } = setup()
  const made = rooms.create(me("a"), "pickleball", { format: "doubles", venue: "beach" })
  rooms.join(me("b"), { code: made.code })
  rooms.ready("b", made.roomId, true)
  assert.ok(rooms.start("a", made.roomId).ok)
  const look = { v: 2, body: "f", skin: "#D39A6A", hair: "long", hairColor: "#2b1b0e", height: 1.4, build: "strong", theme: "beach", style: "onepiece", shirtStyle: "onepiece", bottom: "swim", shirt: "#18a3b5", trim: "red", hat: "<img src=x>", glasses: "sport", wristbands: "yes", gloves: false, paddleDesign: "flame", extra: "x".repeat(50), __proto__x: 1 }
  assert.ok(rooms.relay("b", made.roomId, { type: "hello", character: "maya", outfit: "home", look }).ok)
  const got = inbox.a.at(-1).payload.data
  assert.equal(got.type, "hello")
  assert.equal(got.character, "maya")
  assert.equal(got.look.skin, "#d39a6a")
  assert.equal(got.look.height, 1.06) // clamped
  assert.equal(got.look.theme, "beach")
  assert.equal(got.look.style, "onepiece")
  assert.equal(got.look.shirtStyle, "onepiece")
  assert.equal(got.look.paddleDesign, "flame")
  assert.equal(got.look.trim, undefined) // not a color
  assert.equal(got.look.hat, undefined) // not a hat
  assert.equal(got.look.wristbands, undefined) // not a boolean
  assert.equal(got.look.extra, undefined)
  // a junk character id and a look that isn't one
  assert.ok(rooms.relay("b", made.roomId, { type: "hello", character: "../../x", look: "pink" }).ok)
  assert.equal(inbox.a.at(-1).payload.data.character, null)
  assert.equal(inbox.a.at(-1).payload.data.look, null)
  // the host's line-up: each person's look checked the same way
  assert.ok(rooms.relay("a", made.roomId, { type: "start", seed: 5, settings: { doubles: true }, people: [{ seat: 0, name: "Al", character: "dex", look: { shirt: "#ABCDEF", hat: "beanie", gloves: true } }, { seat: 1, name: "Bo", look: { shirt: "javascript:" } }] }).ok)
  const start = inbox.b.at(-1).payload.data
  assert.equal(start.seed, 5)
  assert.deepEqual(start.people[0].look, { v: 3, shirt: "#abcdef", hat: "beanie", gloves: true })
  assert.deepEqual(start.people[1].look, { v: 3 })
  // which hand plays and the pro style: known ids only; an older browser's look keeps its version
  assert.ok(rooms.relay("b", made.roomId, { type: "hello", character: "kenji", look: { v: 3, plays: "left", backhand: "two" } }).ok)
  assert.deepEqual(inbox.a.at(-1).payload.data.look, { v: 3, plays: "left", backhand: "two" })
  assert.ok(rooms.relay("b", made.roomId, { type: "hello", character: "kenji", look: { v: 2, plays: "both", backhand: 2 } }).ok)
  assert.deepEqual(inbox.a.at(-1).payload.data.look, { v: 2 })
  // not a message at all
  assert.equal(rooms.relay("b", made.roomId, ["hello"]).ok, false)
  // hits pass as they are
  assert.ok(rooms.relay("b", made.roomId, { type: "hit", s: { t: 2 } }).ok)
  assert.deepEqual(inbox.a.at(-1).payload.data, { type: "hit", s: { t: 2 } })
})
