import { test } from "node:test"
import assert from "node:assert/strict"
import { faceTargets, stepSweat, faceDetail } from "./face.js"

test("faces react to play: smile after a point, grimace after an error, determination before a serve", () => {
  const won = faceTargets({ mood: { kind: "cheer", variant: 1 } })
  assert.ok(won.smile > 0.8 && won.effort === 0)
  const shouting = faceTargets({ mood: { kind: "cheer", variant: 2 } })
  assert.ok(shouting.shout > 0.7)
  const err = faceTargets({ mood: { kind: "sulk" } })
  assert.ok(err.effort >= 0.5 && err.smile === 0 && err.shout > 0, "a grimace: brows down, jaw a little open")
  const serve = faceTargets({ holding: true, between: true })
  assert.ok(serve.effort > 0.3 && serve.smile === 0, "a set jaw, no smile, while holding the ball to serve")
  const relaxed = faceTargets({ between: true })
  assert.ok(relaxed.smile > 0 && relaxed.effort === 0)
})

test("effort follows the swing: harder for fast shots", () => {
  assert.ok(faceTargets({ stroke: 1, fast: true }).effort > faceTargets({ stroke: 1 }).effort)
  assert.equal(faceTargets({ stroke: 0.1, ready: 0.9 }).effort, 0.18)
})

test("sweat builds over a long rally, not after one shot, and dries between points", () => {
  let s = 0
  // one quick swing
  for (let t = 0; t < 1; t += 1 / 30) s = stepSweat(s, { speed: 1, stroke: t < 0.3 ? 1 : 0 }, 1 / 30)
  assert.ok(s < 0.02, `one shot: ${s}`)
  // a 40-second rally of running and swinging
  s = 0
  for (let t = 0; t < 40; t += 1 / 30) s = stepSweat(s, { speed: 4, stroke: (t % 3) < 0.5 ? 1 : 0 }, 1 / 30)
  assert.ok(s > 0.45 && s <= 1, `a long rally: ${s}`)
  const after = s
  for (let t = 0; t < 30; t += 1 / 30) s = stepSweat(s, { between: true }, 1 / 30)
  assert.ok(s < after && s > after * 0.5, "dries slowly between points")
  assert.equal(stepSweat(0.3, { speed: 5 }, 0), 0.3)
})

test("detail levels: pores only on High; the cheap details on both", () => {
  assert.equal(faceDetail("high").pores, true)
  assert.equal(faceDetail("medium").pores, false)
  for (const d of ["medium", "high"]) {
    const f = faceDetail(d)
    assert.ok(f.hairSpec && f.eyelid && f.wetEyes && f.gearSheen && f.sweat)
  }
})
