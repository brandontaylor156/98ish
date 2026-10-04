import { test } from "node:test"
import assert from "node:assert/strict"
import { createFrameClock, substeps, FRAME_MS, MAX_FRAME_MS } from "./frameClock.js"
import { createResolution } from "./dynamicResolution.js"

// game time from a run of rAF timestamps
const run = (clock, hz, seconds, start = 1000) => {
  let total = 0
  const n = Math.round(seconds * hz)
  for (let i = 0; i <= n; i++) total += clock.tick(start + (i * 1000) / hz)
  return total
}

test("game time follows real time at 30, 42, 60, 120 and 144 Hz", () => {
  for (const hz of [30, 42, 60, 120, 144]) {
    const clock = createFrameClock()
    const ms = run(clock, hz, 10)
    // (the first frame counts as one 60 Hz frame)
    assert.ok(Math.abs(ms - 10000 - FRAME_MS) < 1e-6, `${hz} Hz: ${ms}`)
  }
})

test("the first frame after a reset is one ordinary frame and says so", () => {
  const clock = createFrameClock()
  assert.equal(clock.tick(5000), FRAME_MS)
  assert.equal(clock.first, true)
  assert.equal(clock.tick(5033), 33)
  assert.equal(clock.first, false)
  clock.reset()
  assert.equal(clock.running, false)
  // (a pause of a minute doesn't count)
  assert.equal(clock.tick(65000), FRAME_MS)
  assert.equal(clock.first, true)
  assert.equal(clock.tick(65016), 16)
})

test("not resetting between frames keeps the clock (the old bug reset it every frame)", () => {
  const clock = createFrameClock()
  let total = 0
  for (let i = 0; i < 300; i++) total += clock.tick(i * 33.3)
  assert.ok(Math.abs(total - 299 * 33.3 - FRAME_MS) < 1e-6)
})

test("a long frame is clamped and time never runs backwards", () => {
  const clock = createFrameClock({ maxMs: 50 })
  clock.tick(0)
  assert.equal(clock.tick(400), 50)
  assert.equal(clock.tick(390), 0)
  assert.equal(createFrameClock().tick(0) <= MAX_FRAME_MS, true)
})

test("substeps splits a frame into steps no longer than the limit", () => {
  assert.equal(substeps(0.016, 1 / 30), 1)
  assert.equal(substeps(1 / 30, 1 / 30), 1)
  assert.equal(substeps(0.05, 1 / 30), 2)
  assert.equal(substeps(0.1, 1 / 30), 3)
  assert.equal(substeps(0, 1 / 30), 1)
})

// ---- dynamic resolution ----
const feed = (res, ms, seconds, work = 4) => {
  let changes = 0
  for (let t = 0; t < seconds * 1000; t += ms) if (res.frame(ms, work)) changes++
  return changes
}

test("slow frames lower the ratio a step per window, never under the floor", () => {
  const res = createResolution({ max: 1.5, min: 1 })
  assert.equal(res.ratio, 1.5)
  feed(res, 25, 2.1)
  assert.equal(res.ratio, 1.25)
  feed(res, 25, 10)
  assert.equal(res.ratio, 1)
})

test("on-target frames with spare time raise it again, slower to retry the ratio that last failed", () => {
  const res = createResolution({ max: 1.5, min: 1, upAfter: 3 })
  feed(res, 25, 4.1) // 1.5 -> 1.25 -> 1
  assert.equal(res.ratio, 1)
  feed(res, 1000 / 60, 6.1, 3) // three good windows aren't enough: 1.25 was the last too slow
  assert.equal(res.ratio, 1)
  feed(res, 1000 / 60, 6.5, 3) // six are
  assert.equal(res.ratio, 1.25)
  feed(res, 1000 / 60, 12.5, 3)
  assert.equal(res.ratio, 1.5)
})

test("busy frames on target don't raise it (no headroom)", () => {
  const res = createResolution({ max: 1.5, min: 1 })
  feed(res, 25, 2.1)
  feed(res, 1000 / 60, 20, 12)
  assert.equal(res.ratio, 1.25)
})

test("a device capped at 30 fps is left alone (target 33 ms)", () => {
  const res = createResolution({ max: 1.5, min: 1 })
  feed(res, 1000 / 30, 10, 5)
  assert.equal(res.ratio, 1.5)
  assert.equal(res.capped, true)
  assert.ok(Math.abs(res.target - 1000 / 30) < 1e-9)
  // but a GPU-bound 30 fps (busy frames) is not a cap
  const busy = createResolution({ max: 1.5, min: 1 })
  feed(busy, 1000 / 30, 2.1, 20)
  assert.equal(busy.ratio, 1.25)
})

test("60 Hz on target stays put; setMax starts from the new ceiling", () => {
  const res = createResolution({ max: 2, min: 1 })
  assert.equal(feed(res, 1000 / 60, 10), 0)
  assert.equal(res.ratio, 2)
  res.setMax(1)
  assert.equal(res.ratio, 1)
  assert.equal(feed(res, 50, 10), 0)
})

test("it climbs back one step at a time", () => {
  const res = createResolution({ max: 1.5, min: 1, upAfter: 3 })
  feed(res, 25, 2.1) // 1.5 -> 1.25
  feed(res, 1000 / 60, 12.5, 3) // 1.5 failed: six windows
  assert.equal(res.ratio, 1.5)
  const fresh = createResolution({ max: 1.5, min: 1, upAfter: 3 })
  fresh.setMax(2)
  feed(fresh, 25, 2.1) // 2 -> 1.75, failed 2
  feed(fresh, 25, 2.1) // 1.75 -> 1.5, failed 1.75
  feed(fresh, 1000 / 60, 12.5, 3)
  assert.equal(fresh.ratio, 1.75)
})
