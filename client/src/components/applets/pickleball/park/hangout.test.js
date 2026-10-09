import test from "node:test"
import assert from "node:assert/strict"
import { HANG_LINES, benchPair, helloFor, seatAt, seatNextTo } from "./hangout.js"
import { createRegular, startHang, think, tickRegular } from "./regulars.js"
import { ALL_SEATS } from "./layout.js"
import { chordAt } from "./chillmusic.js"
import { EMOTES, EMOTE_MOOD } from "./lines.js"

const seeded = (s = 1) => () => ((s = (s * 16807) % 2147483647) / 2147483647)

test("seats: the one a friend sits on, a free one next to them (same bench first), a pair side by side", () => {
  const seats = [
    { id: "b1s0", bench: "b1", x: 0, z: 0, y: 0.45 },
    { id: "b1s1", bench: "b1", x: 0.9, z: 0, y: 0.45 },
    { id: "b2s0", bench: "b2", x: 1.5, z: 0.5, y: 0.45 },
    { id: "b2s1", bench: "b2", x: 2.4, z: 0.5, y: 0.45 },
    { id: "far", bench: "b9", x: 30, z: 0, y: 0.45 },
  ]
  assert.equal(seatAt(seats, 0.1, 0.05).id, "b1s0")
  assert.equal(seatAt(seats, 5, 5), null)
  const taken = new Set(["b1s0"])
  const free = (s) => !taken.has(s.id)
  assert.equal(seatNextTo(seats, free, seats[0]).id, "b1s1", "same bench")
  taken.add("b1s1")
  assert.equal(seatNextTo(seats, free, seats[0]).id, "b2s0", "else the nearest within reach")
  taken.add("b2s0").add("b2s1")
  assert.equal(seatNextTo(seats, free, seats[0]), null, "nothing near")
  const pair = benchPair(seats, () => true, { x: 2, z: 0.5 })
  assert.deepEqual(pair.map((s) => s.id).sort(), ["b2s0", "b2s1"])
  assert.equal(benchPair(seats, (s) => s.id !== "b2s1" && s.id !== "b1s1", { x: 0, z: 0 }), null, "no two free together")
})

test("two regulars sit on a bench together and chat; a passer-by waves hello by name", () => {
  const rand = seeded(7)
  const a = createRegular(0, rand, { x: 0, z: 0 })
  const b = createRegular(1, rand, { x: 1, z: 0 })
  const taken = new Map()
  const ctx = { rand, seatFree: (s) => !taken.has(s.id), takeSeat: (s, r) => taken.set(s.id, r.id), freeSeat: (s) => taken.delete(s.id) }
  const pair = benchPair(ALL_SEATS, ctx.seatFree, a)
  assert.ok(pair, "Riverside has benches")
  startHang(a, b, pair, ctx, rand)
  assert.equal(a.state, "sit")
  assert.ok(a.hang && b.hang)
  assert.equal(taken.size, 2)
  // walk them there, then they talk now and then
  for (const r of [a, b]) {
    r.x = r.path.at(-1).x
    r.z = r.path.at(-1).z
    r.path = []
  }
  const said = []
  for (let t = 0; t < 20; t += 0.1) {
    for (const r of [a, b]) {
      tickRegular(r, 0.1, [], t, rand)
      if (r.say && !said.includes(r.say.at + r.id)) said.push(r.say.at + r.id)
    }
  }
  assert.ok(a.seated && b.seated)
  assert.ok(said.length >= 3, `they chatted (${said.length} lines)`)
  assert.ok(HANG_LINES.includes(a.say?.text || b.say?.text || HANG_LINES[0]))
  // thinking again gets up and frees the seat
  think(a, { ...ctx, courts: [], queueSpot: () => ({ x: 0, z: 0 }) })
  assert.equal(a.hang, false)
  assert.equal(taken.size, 1)
  // hello by name: always from someone you've met, sometimes from others, never without a name
  assert.match(helloFor("Ava", true, seeded(3)), /Ava/)
  const r2 = seeded(11)
  const n = Array.from({ length: 400 }, () => helloFor("Ava", false, r2)).filter(Boolean).length
  assert.ok(n > 80 && n < 220, `about a third wave (${n}/400)`)
  assert.equal(helloFor("", true, seeded(1)), null)
})

test("the wave emote and the chill music's chords", () => {
  assert.ok(EMOTES.some((e) => e.id === "wave"))
  assert.deepEqual(EMOTE_MOOD.wave, ["wave", 0])
  for (let bar = 0; bar < 8; bar++) {
    const c = chordAt(bar)
    assert.equal(c.length, 5)
    assert.ok(c.every((m) => m >= 40 && m <= 76))
  }
  assert.deepEqual(chordAt(4), chordAt(0), "a four-bar loop")
})
