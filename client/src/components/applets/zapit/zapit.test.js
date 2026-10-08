// Zap It!'s gestures and rules. Run: node --test client/src/components/applets/zapit/zapit.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as Z from "./gestures.js"

// a straight line of n samples from (x0, y0) to (x1, y1) over ms
const line = (x0, y0, x1, y1, ms, n = 10) => Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / (n - 1), y: y0 + ((y1 - y0) * i) / (n - 1), t: (ms * i) / (n - 1) }))
const one = (pts) => ({ pointers: { 1: pts } })
const arc = (cx, cy, r, a0, a1, ms, n = 20) => Array.from({ length: n }, (_, i) => {
  const a = a0 + ((a1 - a0) * i) / (n - 1)
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, t: (ms * i) / (n - 1) }
})

test("taps: short and small", () => {
  assert.equal(Z.classify(one([{ x: 100, y: 100, t: 0 }, { x: 103, y: 101, t: 120 }])), "tap")
  assert.equal(Z.classify(one([{ x: 100, y: 100, t: 0 }])), "tap")
  assert.equal(Z.classify(one([{ x: 100, y: 100, t: 0 }, { x: 101, y: 100, t: 900 }])), null, "a long press isn't a tap")
})

test("swipes go sideways either way; pulls go down; flicks go up fast", () => {
  assert.equal(Z.classify(one(line(50, 200, 250, 210, 180))), "swipe")
  assert.equal(Z.classify(one(line(250, 200, 60, 190, 300))), "swipe")
  assert.equal(Z.classify(one(line(150, 100, 155, 260, 400))), "pull")
  assert.equal(Z.classify(one(line(150, 300, 152, 230, 120))), "flick")
  assert.equal(Z.classify(one(line(150, 400, 150, 250, 600))), "flick", "a slow long drag up counts too")
  assert.equal(Z.classify(one(line(150, 300, 152, 260, 500))), null, "a slow short nudge up is nothing")
  assert.equal(Z.classify(one(line(100, 100, 160, 160, 200))), null, "diagonal is nothing")
})

test("twist: two fingers turning, either way; two fingers moving together isn't", () => {
  const a = arc(200, 200, 60, 0, Math.PI / 3, 300)
  const b = arc(200, 200, 60, Math.PI, Math.PI + Math.PI / 3, 300)
  assert.equal(Z.classify({ pointers: { 1: a, 2: b } }), "twist")
  const c = arc(200, 200, 60, 0, -Math.PI / 4, 300)
  const d = arc(200, 200, 60, Math.PI, Math.PI - Math.PI / 4, 300)
  assert.equal(Z.classify({ pointers: { 1: c, 2: d } }), "twist")
  assert.ok(Math.abs(Z.twoFingerTurn(a, b) - Math.PI / 3) < 0.05)
  const e = line(100, 100, 100, 200, 300)
  const f = line(200, 100, 200, 200, 300)
  assert.equal(Z.classify({ pointers: { 1: e, 2: f } }), null)
})

test("twist with one finger or the mouse: most of a circle", () => {
  assert.equal(Z.classify(one(arc(200, 200, 50, 0, Math.PI * 1.8, 700, 40))), "twist")
  assert.equal(Z.classify(one(arc(200, 200, 50, 0, -Math.PI * 1.7, 700, 40))), "twist")
  assert.notEqual(Z.classify(one(arc(200, 200, 50, 0, Math.PI * 0.6, 400, 20))), "twist")
})

test("shake: a few big back-and-forth jolts close together", () => {
  const s = Z.shakeDetector()
  let t = 0
  const feed = (x) => s.feed({ x, y: 0, z: 0, t: (t += 120) })
  assert.equal(feed(3), false)
  assert.equal(feed(-4), false)
  assert.equal(feed(20), false)
  assert.equal(feed(-20), false)
  assert.equal(feed(20), true)
  // the same jolts spread out over seconds are not a shake
  const slow = Z.shakeDetector()
  let u = 0
  const r = [20, -20, 20, -20].map((x) => slow.feed({ x, y: 0, z: 0, t: (u += 1000) }))
  assert.deepEqual(r, [false, false, false, false])
  // with gravity included, standing still is not a shake
  const g = Z.shakeDetector()
  assert.equal([0, 1, 2, 3, 4].some((i) => g.feed({ x: 0, y: 9.81, z: 0, t: i * 50, gravity: true })), false)
})

test("the game: the right move scores and calls the next; a wrong one or a late one ends it; the beat speeds up", () => {
  let n = 0
  const random = () => ((n = (n * 9301 + 49297) % 233280) / 233280)
  let s = Z.newRound({ random })
  assert.equal(s.command, "tap")
  for (let k = 0; k < 30; k++) {
    const r = Z.act(s, s.command)
    assert.equal(r.right, true)
    assert.notEqual(r.state.command, "shake", "no shake without motion")
    s = r.state
  }
  assert.equal(s.score, 30)
  const wrong = Z.act(s, s.command === "tap" ? "swipe" : "tap")
  assert.equal(wrong.state.over, true)
  assert.match(wrong.state.reason, /^wrong:/)
  assert.equal(Z.timeout(s).reason, "late")
  assert.equal(Z.beatFor(0), 1700)
  assert.ok(Z.beatFor(10) < Z.beatFor(5))
  assert.equal(Z.beatFor(500), 650)
  // never the same command three times in a row
  let t = Z.newRound({ random: () => 0, shake: true })
  const seen = [t.command]
  for (let k = 0; k < 10; k++) {
    t = Z.act(t, t.command).state
    seen.push(t.command)
  }
  for (let k = 2; k < seen.length; k++) assert.ok(!(seen[k] === seen[k - 1] && seen[k] === seen[k - 2]))
})

test("twist is easier now: 2/3 of a circle with one finger, a 30-degree two-finger turn; lines still aren't", () => {
  assert.equal(Z.classify(one(arc(200, 200, 45, 0, Math.PI * 1.3, 500, 30))), "twist")
  const a = arc(200, 200, 60, 0, (32 * Math.PI) / 180, 250)
  const b = arc(200, 200, 60, Math.PI, Math.PI + (32 * Math.PI) / 180, 250)
  assert.equal(Z.classify({ pointers: { 1: a, 2: b } }), "twist")
  // a long straight drag (its angle from the middle flips once) is a swipe or a pull, never a twist
  assert.equal(Z.classify(one(line(40, 200, 300, 205, 300, 30))), "swipe")
  assert.equal(Z.classify(one(line(150, 60, 152, 320, 400, 30))), "pull")
})

test("the on-screen knob: degrees turned round its middle, either way", () => {
  const pts = arc(100, 100, 50, 0, Math.PI / 2, 300, 12)
  assert.ok(Math.abs(Z.knobTurn(pts, 100, 100) - 90) < 1)
  assert.ok(Math.abs(Z.knobTurn(arc(100, 100, 50, 1, 1 - Math.PI / 3, 300, 12), 100, 100) + 60) < 1)
  assert.ok(Z.KNOB_DEGREES <= 90)
})

test("twisting the phone: 45 degrees of turn within 0.7 s, not a slow drift", () => {
  const d = Z.twistDetector()
  let t = 0
  let fired = false
  for (let i = 0; i < 10 && !fired; i++) fired = d.feed({ rate: 150, t: (t += 50) }) // 150 deg/s for ~0.5 s
  assert.equal(fired, true)
  const slow = Z.twistDetector()
  let u = 0
  let any = false
  for (let i = 0; i < 100; i++) any = slow.feed({ rate: 20, t: (u += 50) }) || any // 20 deg/s for 5 s
  assert.equal(any, false)
})
