// The quick games' shared kit. Run: node --test client/src/utils/gameKit.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { createScores, rng, weighted, fmtTime } from "./gameKit.js"

const store = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

test("rng: the same seed gives the same numbers, all in 0..1", () => {
  const a = rng(42)
  const b = rng(42)
  for (let i = 0; i < 100; i++) {
    const x = a()
    assert.equal(x, b())
    assert.ok(x >= 0 && x < 1)
  }
  assert.notEqual(rng(1)(), rng(2)())
})

test("weighted picks follow the weights", () => {
  const r = rng(7)
  const n = { a: 0, b: 0 }
  for (let i = 0; i < 4000; i++) n[weighted(r, [["a", 3], ["b", 1]])]++
  assert.ok(n.a > n.b * 2.4 && n.a < n.b * 3.6, JSON.stringify(n))
})

test("scores: top 10 per mode, a new best flagged, prefs kept", () => {
  const s = createScores("t", { defaults: { sound: true }, store: store() })
  assert.equal(s.load().prefs.sound, true)
  s.setPrefs({ sound: false })
  assert.equal(s.load().prefs.sound, false)
  assert.equal(s.record("solo", { score: 10 }).best, true)
  assert.equal(s.record("solo", { score: 5 }).best, false)
  const r = s.record("solo", { score: 30 })
  assert.equal(r.best, true)
  assert.equal(r.place, 0)
  for (let i = 0; i < 12; i++) s.record("solo", { score: i })
  const d = s.load()
  assert.equal(d.scores.solo.length, 10)
  assert.equal(s.best(d, "solo"), 30)
  assert.equal(s.best(d, "other"), 0)
  // lower is better for times
  const t = createScores("u", { lower: ["sprint"], store: store() })
  t.record("sprint", { score: 50 })
  assert.equal(t.record("sprint", { score: 40 }).best, true)
  assert.equal(t.record("sprint", { score: 45 }).best, false)
  assert.equal(fmtTime(61), "1:01")
})
