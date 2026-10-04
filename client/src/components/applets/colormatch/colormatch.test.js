// Color Match's rules. Run: node --test client/src/components/applets/colormatch/colormatch.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as R from "./rules.js"

test("questions are the same for the same seed and index, and about half are Yes", () => {
  let yes = 0
  for (let i = 0; i < 400; i++) {
    const a = R.questionAt(1234, i)
    assert.deepEqual(a, R.questionAt(1234, i))
    assert.equal(typeof a.answer, "boolean")
    assert.equal(a.answer, a.left.word === a.right.ink, "Yes exactly when the left word's meaning is the right word's ink")
    if (a.answer) yes++
    for (const c of [a.left.word, a.left.ink, a.right.word, a.right.ink]) assert.ok(R.COLORS.slice(0, R.CLASSIC_COLORS).some((x) => x.id === c))
  }
  assert.ok(yes > 160 && yes < 240, `${yes} Yes of 400`)
  assert.notDeepEqual(R.questionAt(1, 0), R.questionAt(2, 0))
})

test("swatch questions: the word's color is a tile, the misleading ink is a tile too, 4 then 6 then 9 tiles", () => {
  for (let i = 0; i < 60; i++) {
    const q = R.questionAt(99, i, "swatch")
    assert.equal(q.tiles.length, R.tilesFor(i))
    assert.equal(new Set(q.tiles).size, q.tiles.length)
    assert.equal(q.tiles[q.answer], q.word)
    assert.notEqual(q.ink, q.word)
    assert.ok(q.tiles.includes(q.ink))
  }
  assert.deepEqual([0, 7, 8, 19, 20].map(R.tilesFor), [4, 4, 6, 6, 9])
})

test("scoring: 50 x multiplier, +1 every 4 in a row up to x5, back to x1 after a mistake", () => {
  const seed = 42
  let run = R.newRun()
  const scores = []
  for (let k = 0; k < 22; k++) {
    const q = R.questionAt(seed, run.i)
    const r = R.answer(run, seed, "classic", q.answer)
    assert.equal(r.right, true)
    scores.push(r.points)
    run = r.run
  }
  assert.deepEqual(scores.slice(0, 9), [50, 50, 50, 50, 100, 100, 100, 100, 150])
  assert.equal(scores[16], 250)
  assert.equal(scores[21], 250, "capped at x5")
  const q = R.questionAt(seed, run.i)
  const wrong = R.answer(run, seed, "classic", !q.answer)
  assert.equal(wrong.right, false)
  assert.equal(wrong.points, 0)
  assert.equal(wrong.run.streak, 0)
  assert.equal(wrong.run.best, 22)
  assert.equal(R.multFor(wrong.run.streak), 1)
  assert.equal(R.accuracy(wrong.run), 96)
})

test("settings are checked", () => {
  assert.deepEqual(R.validateSettings({}), R.DEFAULTS)
  assert.ok(R.validateSettings({ mode: "nope" }).error)
  assert.ok(R.validateSettings({ seconds: 45 }).error)
  assert.ok(R.validateSettings({ players: 9 }).error)
  assert.equal(R.validateSettings({ mode: "swatch", seconds: 30 }).seconds, 30)
  assert.equal(R.bucket({ mode: "swatch", seconds: 30 }), "swatch:30")
})

test("online: answers are checked against the seed, in order, only between GO and time's up", () => {
  const now = 1_000_000
  const s0 = R.create({ players: [{ name: "A" }, { name: "B" }], settings: R.DEFAULTS, random: () => 0.25, now })
  const ctx = (t) => ({ now: t, random: () => 0.5 })
  assert.match(R.action(s0, 0, { type: "answer", i: 0, choice: true }, ctx(now + 100)).error, /GO/)
  const q0 = R.questionAt(s0.seed, 0)
  let s = R.action(s0, 0, { type: "answer", i: 0, choice: q0.answer }, ctx(s0.goAt + 500))
  assert.equal(s.players[0].run.score, 50)
  assert.match(R.action(s, 0, { type: "answer", i: 0, choice: true }, ctx(s0.goAt + 900)).error, /gone by/)
  assert.match(R.action(s, 0, { type: "answer", i: 1, choice: true }, ctx(s0.goAt + 550)).error, /fast/)
  const q1 = R.questionAt(s0.seed, 1)
  s = R.action(s, 1, { type: "answer", i: 0, choice: !q0.answer }, ctx(s0.goAt + 700))
  assert.equal(s.players[1].run.score, 0)
  s = R.action(s, 0, { type: "answer", i: 1, choice: q1.answer }, ctx(s0.goAt + 900))
  assert.match(R.action(s, 0, { type: "answer", i: 2, choice: true }, ctx(s0.endsAt + 1)).error, /Time/)
  assert.equal(R.isOver(s), null)
  s = R.action(s, null, { type: "tick" }, ctx(s0.endsAt + 1))
  const over = R.isOver(s)
  assert.deepEqual(over.winners, [0])
  const v = R.view(s)
  assert.equal(v.players[0].score, 100)
  assert.equal(v.players[0].i, 2)
})

test("online: computer players answer on the tick at a human pace", () => {
  const now = 5_000_000
  let seedR = 7
  const random = () => (seedR = (seedR * 16807) % 2147483647) / 2147483647
  let s = R.create({ players: [{ name: "Me" }, { name: "Ada", bot: true }], settings: { ...R.DEFAULTS, seconds: 30 }, random, now })
  for (let t = now; t <= s.endsAt + 300; t += R.TICK_MS) s = R.action(s, null, { type: "tick" }, { now: t, random })
  const bot = s.players[1].run
  assert.ok(bot.i >= 15 && bot.i <= 30, `${bot.i} answers in 30 s`)
  assert.ok(bot.right / bot.i > 0.7)
  assert.equal(s.phase, "over")
  assert.deepEqual(R.isOver(s).winners, [1])
})
