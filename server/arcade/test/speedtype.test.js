// Speed Typist 98 on the online room system (server/arcade/games/speedtype.js): the server
// picks the prompt, runs the countdown and the clock, checks every progress report, types
// for the computer racers and works out the places.
const test = require("node:test")
const assert = require("node:assert/strict")
const { createRooms } = require("../rooms")
const speedtype = require("../games/speedtype")

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
const PEOPLE = { a: "Alice", b: "Bob", c: "Carol" }
const me = (pid) => ({ pid, name: PEOPLE[pid], key: null })

const setup = () => {
  const clock = fakeClock()
  const inbox = { a: [], b: [], c: [] }
  const rooms = createRooms({ games: [speedtype], emit: (pid, event, payload) => inbox[pid]?.push({ event, payload }), clock, random: seeded(7) })
  const last = (pid) => [...inbox[pid]].reverse().find((m) => m.event === "room:state")?.payload
  return { rooms, clock, inbox, last }
}

test.before(async () => {
  await speedtype.ready
})

test("two people race through a room code: same prompt, server countdown, places by finish time", () => {
  const t = setup()
  const made = t.rooms.create(me("a"), "speedtype", { players: 2, length: "short", category: "twisters" })
  assert.ok(made.ok, made.error)
  assert.ok(t.rooms.join(me("b"), { code: made.code }).ok)
  assert.ok(t.rooms.ready("b", made.roomId, true).ok)
  assert.ok(t.rooms.start("a", made.roomId).ok)
  const va = t.last("a").view
  const vb = t.last("b").view
  assert.equal(va.prompt.text, vb.prompt.text, "everyone races the same prompt")
  assert.equal(va.prompt.category, "twisters")
  assert.equal(va.phase, "countdown")
  assert.equal(va.you, 0)
  assert.equal(vb.you, 1)
  const text = va.prompt.text

  // too early
  const early = t.rooms.act("a", made.roomId, { type: "progress", text: text.slice(0, 2), keys: 2, mistakes: 0 })
  assert.equal(early.ok, false)
  assert.match(early.error, /green light/)

  t.clock.advance(va.goAt - t.clock.now() + 10)
  assert.equal(t.last("a").view.phase, "racing")

  // Bob types a little faster than Alice; Alice slips once
  let a = 0
  let b = 0
  while (b < text.length) {
    t.clock.advance(1000)
    a = Math.min(text.length, a + 4)
    b = Math.min(text.length, b + 6)
    assert.ok(t.rooms.act("b", made.roomId, { type: "progress", text: text.slice(0, b), keys: b, mistakes: 0 }).ok)
    if (t.last("a").phase === "playing") assert.ok(t.rooms.act("a", made.roomId, { type: "progress", text: text.slice(0, a), keys: a + 1, mistakes: 1 }).ok)
  }
  while (a < text.length) {
    t.clock.advance(1000)
    a = Math.min(text.length, a + 4)
    assert.ok(t.rooms.act("a", made.roomId, { type: "progress", text: text.slice(0, a), keys: a + 1, mistakes: 1 }).ok)
  }
  const room = t.last("a")
  assert.equal(room.phase, "over")
  assert.deepEqual(room.result.winners, [1])
  const table = room.view.results[0].table
  assert.deepEqual(
    table.map((r) => [r.seat, r.place]),
    [
      [1, 1],
      [0, 2],
    ]
  )
  assert.ok(table[0].wpm > table[1].wpm)
  assert.ok(table[1].acc < 100 && table[1].mistakes === 1)
  assert.equal(table[0].acc, 100)
})

test("the server refuses text that isn't the prompt and impossible speed", () => {
  const t = setup()
  const made = t.rooms.create(me("a"), "speedtype", { players: 2, length: "long" })
  assert.ok(t.rooms.join(me("b"), { code: made.code }).ok)
  t.rooms.ready("b", made.roomId, true)
  t.rooms.start("a", made.roomId)
  const v = t.last("a").view
  t.clock.advance(v.goAt - t.clock.now() + 500)
  const wrong = t.rooms.act("a", made.roomId, { type: "progress", text: "Something else entirely", keys: 23, mistakes: 0 })
  assert.match(wrong.error, /match/)
  const pasted = t.rooms.act("a", made.roomId, { type: "progress", text: v.prompt.text, keys: v.prompt.text.length, mistakes: 0 })
  assert.match(pasted.error, /faster/)
  assert.equal(t.last("a").view.racers[0].pos, 0)
})

test("Quick Match: computer racers fill the empty lanes by themselves and type at a human pace", () => {
  const t = setup()
  const q = t.rooms.quick(me("a"), "speedtype", { length: "short", botWpm: 60 })
  assert.ok(q.ok, q.error)
  assert.equal(t.rooms.fillBots("a", q.roomId).ok, false, "people get a chance to show up first")
  t.clock.advance(10_000)
  assert.equal(t.last("a").phase, "lobby", "still waiting for people")
  // alone past the offer time: the computer racers join and the race starts with nobody pressing anything
  t.clock.advance(6_000)
  let room = t.last("a")
  assert.equal(room.phase, "playing")
  assert.equal(room.seats.filter((s) => s?.bot).length, 3, "fills up to four racers")
  const v = room.view
  t.clock.advance(v.goAt - t.clock.now())
  // three seconds in, the computer racers have moved, but not impossibly far
  t.clock.advance(3000)
  room = t.last("a")
  const moved = room.view.racers.filter((r) => r.bot && r.pos > 0)
  assert.ok(moved.length >= 2, "the computer racers are typing")
  for (const r of moved) assert.ok(r.pos <= 25, `about 60 WPM is ~5 characters a second (${r.pos})`)
  // Alice gives up: the time limit ends the race, and the computer racers finish
  t.clock.advance(v.limitAt - t.clock.now() + 500)
  room = t.last("a")
  assert.equal(room.phase, "over")
  const table = room.view.results[0].table
  assert.equal(table.filter((r) => r.bot && r.finished).length, 3)
  assert.ok(room.result.winners[0] !== 0)
})

test("a player who leaves mid-race is out, and the race goes on", () => {
  const t = setup()
  const made = t.rooms.create(me("a"), "speedtype", { players: 3 })
  assert.ok(t.rooms.join(me("b"), { code: made.code }).ok)
  assert.ok(t.rooms.join(me("c"), { code: made.code }).ok)
  t.rooms.ready("b", made.roomId, true)
  t.rooms.ready("c", made.roomId, true)
  assert.ok(t.rooms.start("a", made.roomId).ok)
  const v = t.last("a").view
  t.clock.advance(v.goAt - t.clock.now() + 1000)
  t.rooms.leave("c", made.roomId)
  t.clock.advance(400)
  const room = t.last("a")
  assert.equal(room.phase, "playing")
  assert.equal(room.view.racers[2].out, true)
  assert.equal(room.view.racers[2].left, true)
})

test("best of 3 and sudden death are room settings; a host's own text is raced as is", () => {
  const t = setup()
  const custom = "Our club's secret motto: type fast, laugh often, and always bring snacks."
  const made = t.rooms.create(me("a"), "speedtype", { players: 2, mode: "best3", custom })
  assert.ok(made.ok, made.error)
  assert.equal(t.last("a").settings.mode, "best3")
  assert.ok(t.rooms.join(me("b"), { code: made.code }).ok)
  t.rooms.ready("b", made.roomId, true)
  assert.ok(t.rooms.start("a", made.roomId).ok)
  const v = t.last("b").view
  assert.equal(v.rounds, 3)
  assert.equal(v.prompt.text, custom)
  assert.equal(v.prompt.category, "custom")

  const bad = t.rooms.create(me("c"), "speedtype", { mode: "relay" })
  assert.equal(bad.ok, false)
  const tooShort = t.rooms.create(me("c"), "speedtype", { custom: "hi" })
  assert.match(tooShort.error, /at least/)
  const sudden = t.rooms.create(me("c"), "speedtype", { mode: "sudden" })
  assert.ok(sudden.ok)
  assert.equal(t.last("c").settings.mode, "sudden")
})
