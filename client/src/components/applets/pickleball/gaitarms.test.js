// gaitarms.js and the arms anim.js draws walking about: biomechanics ranges for standing,
// walking, jogging and running, the counter-swing with the legs, both paths (motion matching
// and procedural) the same, no paddle jitter. node --test gaitarms.test.js
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import zlib from "node:zlib"
import { armAngles, armFK, createGaitArms, stepGaitArms, runness } from "./gaitarms.js"
import { createAnim, updateAnim } from "./anim.js"
import { buildLibrary } from "./mm/library.js"
import { setMotionLibrary } from "./mm/runtime.js"

const elbowOf = (S, E, W) => {
  const u = { x: S.x - E.x, y: S.y - E.y, z: S.z - E.z }
  const v = { x: W.x - E.x, y: W.y - E.y, z: W.z - E.z }
  const c = (u.x * v.x + u.y * v.y + u.z * v.z) / (Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z))
  return 180 - (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI
}

test("angles: standing relaxed, walking a small swing, running elbows near 90 and a bigger swing", () => {
  const stand = armAngles(0)
  const walk = armAngles(1.4)
  const jog = armAngles(3)
  const run = armAngles(5)
  assert.ok(walk.elbowBack < 25 && walk.elbowFront < 45, "walking elbows 15-40")
  assert.ok(walk.fwd + walk.back > 25 && walk.fwd + walk.back < 40, "walking swing ~30 degrees")
  for (const a of [jog, run]) {
    assert.ok(a.elbowFront > 55 && a.elbowFront < 95 && a.elbowBack > 85 && a.elbowBack < 110, "running elbows near 90")
  }
  assert.ok(run.fwd > jog.fwd && jog.fwd > walk.fwd && walk.fwd > stand.fwd, "the swing grows with speed")
  assert.equal(runness(1.2), 0)
  assert.equal(runness(3), 1)
})

test("armFK: bone lengths kept, the elbow bend as asked", () => {
  for (const elbow of [10, 45, 90, 110]) {
    const a = armFK(1, 20, 10, elbow, 10)
    assert.ok(Math.abs(Math.hypot(a.elbow.x - a.shoulder.x, a.elbow.y - a.shoulder.y, a.elbow.z - a.shoulder.z) - 0.29) < 1e-9)
    assert.ok(Math.abs(Math.hypot(a.wrist.x - a.elbow.x, a.wrist.y - a.elbow.y, a.wrist.z - a.elbow.z) - 0.27) < 1e-9)
    assert.ok(Math.abs(elbowOf(a.shoulder, a.elbow, a.wrist) - elbow) < 0.01)
  }
})

test("the counter-swing: the right arm forward as the left foot leads, the left arm back; mirrored for a lefty", () => {
  const st = createGaitArms()
  let r = null
  for (let i = 0; i < 120; i++) r = stepGaitArms(st, { spread: 0.6, speed: 1.4, hand: 1, dt: 1 / 60 })
  assert.ok(r.P.hand.z > r.O.hand.z + 0.15, "paddle (right) hand ahead")
  const st2 = createGaitArms()
  for (let i = 0; i < 120; i++) r = stepGaitArms(st2, { spread: 0.6, speed: 1.4, hand: -1, dt: 1 / 60 })
  assert.ok(r.P.hand.z < r.O.hand.z - 0.15, "a lefty's paddle (left) hand back")
})

// the arms anim.js really draws, walking straight ahead at a speed, between points
const sit = (b, t) => ({ x: b.x, z: b.z, vx: 0, vz: b.vz, facing: 0, ball: { x: b.x, y: 1.1, z: b.z + 3 }, holding: false, swing: null, prep: null, charging: false, between: true, atNet: false, goal: null, hand: 1, twoHand: false, oppHit: null, want: { x: 0, z: b.vz }, id: "t", phase: "intro", phaseT: t, point: 0, mate: null, across: null, receiving: false })
const walkAbout = (speed, mm) => {
  const b = { x: 0, z: 0, vz: 0 }
  const a = createAnim(0, 0, 0)
  a.useMM = mm
  a.mmEvery = 0.1
  const out = []
  let prev = null
  for (let i = 0; i < 60 * 7; i++) {
    const t = i / 60
    b.vz = Math.min(speed, speed * t)
    b.z += b.vz / 60
    const p = updateAnim(a, sit(b, t), 1 / 60)
    if (t < 3) continue
    const hipY = (p.hipL.y + p.hipR.y) / 2
    const shY = (p.shoulderL.y + p.shoulderR.y) / 2
    const ax = p.paddle.axis
    out.push({
      elbowP: elbowOf(p.shoulderR, p.elbowP, p.wristP),
      elbowO: elbowOf(p.shoulderL, p.elbowO, p.wristO),
      handY: (p.wristO.y - hipY) / (shY - hipY),
      chestY: shY - 0.12,
      wristOY: p.wristO.y,
      turn: prev ? (Math.acos(Math.max(-1, Math.min(1, prev.x * ax.x + prev.y * ax.y + prev.z * ax.z))) * 180) / Math.PI : 0,
    })
    prev = ax
  }
  return out
}
const pct = (arr, p) => [...arr].sort((x, y) => x - y)[Math.floor(p * (arr.length - 1))]

const lib = (() => {
  try {
    const dir = new URL("../../../../public/assets/pickleball/", import.meta.url)
    const json = JSON.parse(fs.readFileSync(new URL("motion.json", dir), "utf8"))
    return buildLibrary(json, new Uint8Array(zlib.gunzipSync(fs.readFileSync(new URL("motion.bin", dir)))))
  } catch {
    return null
  }
})()

for (const mm of [false, true]) {
  test(`walking about (${mm ? "motion matching" : "procedural"}): arms by gait`, { skip: mm && !lib ? "no motion database" : false }, () => {
    setMotionLibrary(mm ? lib : null)
    const stand = walkAbout(0, mm)
    assert.ok(pct(stand.map((f) => f.elbowO), 0.5) < 25, "standing: elbows only a little bent")
    assert.ok(pct(stand.map((f) => f.handY), 0.5) < 0, "standing: hands below the hips' joints, at the sides")
    const walk = walkAbout(1.4, mm)
    const we = walk.map((f) => f.elbowO)
    assert.ok(pct(we, 0.5) > 12 && pct(we, 0.95) < 45, "walking: elbow ~10-40")
    assert.ok(pct(walk.map((f) => f.handY), 0.95) < 0.15, "walking: hands no higher than the hip line")
    for (const v of [3, 5]) {
      const run = walkAbout(v, mm)
      const re = run.map((f) => f.elbowO)
      assert.ok(pct(re, 0.05) > 60 && pct(re, 0.95) < 115, `running ${v}: elbows near 90 (${pct(re, 0.05)}..${pct(re, 0.95)})`)
      assert.ok(run.every((f) => f.wristOY < f.chestY + 0.02), `running ${v}: hands never above the chest`)
      assert.ok(pct(run.map((f) => f.handY), 0.05) > 0.05, `running ${v}: never hanging straight`)
      // (the paddle turns with the swing; no frame-to-frame vibration)
      assert.ok(pct(run.map((f) => f.turn), 0.95) < 6, `paddle: smooth (${pct(run.map((f) => f.turn), 0.95)} at p95)`)
    }
    setMotionLibrary(null)
  })
}
