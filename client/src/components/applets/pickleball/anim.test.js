// Animation tests for Pickleball 98: the skeleton stays in one piece, feet stay planted
// (no sliding), legs always reach the court, and the paddle meets the ball at contact.
// Run: node --test client/src/components/applets/pickleball/
import test from "node:test"
import assert from "node:assert/strict"
import { BODY, createAnim, createGait, updateGait, updateAnim, situation, twoBone, boneLengths, splitStep, setMood } from "./anim.js"
import { createMatch, step } from "./match.js"
import { STEP } from "./physics.js"

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`)

test("two-bone IK keeps both bones' lengths and reaches targets in range", () => {
  const a = { x: 0, y: 1, z: 0 }
  for (const t of [{ x: 0.3, y: 0.3, z: 0.2 }, { x: 0, y: 0.15, z: 0 }, { x: 0.5, y: 0.9, z: 0.5 }, { x: 2, y: 0, z: 0 }]) {
    const { mid, end, reached } = twoBone(a, t, 0.43, 0.43, { x: 0, y: 0, z: 1 })
    near(Math.hypot(mid.x - a.x, mid.y - a.y, mid.z - a.z), 0.43, 1e-6, "upper bone")
    near(Math.hypot(end.x - mid.x, end.y - mid.y, end.z - mid.z), 0.43, 1e-6, "lower bone")
    if (reached) near(Math.hypot(end.x - t.x, end.y - t.y, end.z - t.z), 0, 1e-3, "reaches")
    if (Math.hypot(t.x, t.y - 1, t.z) < 0.85) assert.ok(mid.z > 0.01, "bends toward the pole")
  }
})

test("gait: walking moves the feet in steps; planted feet never slide", () => {
  const g = createGait(0, 0, 0)
  let x = 0
  const dt = 1 / 60
  // (a planted foot's spot: where it was put down; the heel may peel up round the ball of the
  // foot, which stays put too: locomotion.test.js checks that)
  let prev = g.feet.map((f) => ({ x: f.bx, z: f.bz, step: !!f.step }))
  let slid = 0
  for (let i = 0; i < 240; i++) {
    x += 2.5 * dt
    updateGait(g, { x, z: 0, vx: 2.5, vz: 0, yaw: Math.PI / 2, stance: 0.12, reach: null }, dt)
    g.feet.forEach((f, k) => {
      if (!f.step && !prev[k].step) slid = Math.max(slid, Math.hypot(f.bx - prev[k].x, f.bz - prev[k].z))
    })
    prev = g.feet.map((f) => ({ x: f.bx, z: f.bz, step: !!f.step }))
  }
  assert.equal(slid, 0, "planted feet stayed put")
  assert.ok(g.steps >= 12, `took steps: ${g.steps}`)
  // both feet came along
  for (const f of g.feet) assert.ok(Math.abs(f.x - x) < 0.6, `foot kept up: ${f.x} vs ${x}`)
})

test("gait: a side shuffle never crosses the feet", () => {
  const g = createGait(0, 0, Math.PI) // facing -z: right is +x
  let x = 0
  const dt = 1 / 60
  for (let i = 0; i < 180; i++) {
    x += 2 * dt
    updateGait(g, { x, z: 0, vx: 2, vz: 0, yaw: Math.PI, stance: 0.21, reach: null }, dt)
    // the left foot (index 0) stays on the -x side of the right foot
    assert.ok(g.feet[0].x < g.feet[1].x + 0.02, `feet crossed at ${i}: ${g.feet[0].x} ${g.feet[1].x}`)
  }
})

// animate a whole computer match and check every frame of every player
test("a whole match animates: feet on the court, no sliding, bones keep their length", () => {
  const m = createMatch({ doubles: true, level: "pro", seed: 5 })
  m.autoplay = true
  const anims = m.players.map((p) => createAnim(p.x, p.z, p.team === 0 ? Math.PI : 0))
  const dt = 1 / 60
  const prev = m.players.map(() => null)
  let frames = 0
  let worstSlide = 0
  let worstFloat = 0
  let hits = 0
  let paddleMiss = []
  const L = 0.43
  while (m.phase !== "over" && frames < 60 * 150) {
    for (let k = 0; k < 4; k++) {
      step(m, STEP)
      for (const e of m.events) {
        if (e.type === "hit") {
          hits++
          for (const p of m.players) if (p.team !== e.team) splitStep(anims[m.players.indexOf(p)])
        }
        if (e.type === "point") m.players.forEach((p, i) => setMood(anims[i], p.team === e.winner ? "cheer" : "sulk", i % 3))
      }
      m.events.length = 0
    }
    frames++
    m.players.forEach((p, i) => {
      const s = situation(m, p)
      const pose = updateAnim(anims[i], s, dt)
      const vals = [pose.pelvis, pose.kneeL, pose.kneeR, pose.ankleL, pose.ankleR, pose.wristP, pose.elbowP, pose.head, pose.paddle.face]
      for (const v of vals) assert.ok(Number.isFinite(v.x + v.y + v.z), "finite pose")
      const b = boneLengths(pose)
      for (const [name, l] of Object.entries(b)) near(l, name.startsWith("upper") ? BODY.upperArm : name.startsWith("fore") ? BODY.forearm : L, 1e-4, name)
      // feet: on the court when planted; the ankle joint is where the foot is
      // planted feet (the gait's spots): the leg reaches them exactly
      anims[i].gait.feet.forEach((f, k) => {
        const ankle = k ? pose.ankleR : pose.ankleL
        assert.ok((k ? pose.footR : pose.footL).y >= -1e-9, "foot not under the court")
        if (f.step) return
        const gap = Math.hypot(ankle.x - f.x, ankle.y - BODY.ankle - f.y, ankle.z - f.z)
        worstFloat = Math.max(worstFloat, gap)
      })
      // planted feet: no sliding between frames
      const g = anims[i].gait
      if (prev[i]) {
        g.feet.forEach((f, k) => {
          const was = prev[i][k]
          if (!f.step && !was.step) worstSlide = Math.max(worstSlide, Math.hypot(f.bx - was.x, f.bz - was.z))
        })
      }
      prev[i] = g.feet.map((f) => ({ x: f.bx, z: f.bz, step: !!f.step }))
      // the paddle meets the ball at contact
      if (p.swing && !p.swing.whiff && p.swing.t > 0 && p.swing.t < 1 / 60 + 1e-9) {
        const d = Math.hypot(pose.paddle.face.x - p.swing.x, pose.paddle.face.y - p.swing.y, pose.paddle.face.z - p.swing.z)
        paddleMiss.push(d)
      }
    })
  }
  assert.ok(hits > 30, `plenty of shots: ${hits}`)
  assert.equal(worstSlide, 0, "planted feet never slide")
  // (3.5 cm: since players walk back between points at a brisk 1.7 m/s, match.js WALK_BACK, the
  // procedural walk's longest strides land a few millimeters further than the legs quite reach)
  assert.ok(worstFloat < 0.035, `ankles reach the feet (worst gap ${worstFloat.toFixed(3)} m)`)
  paddleMiss.sort((a, b) => a - b)
  const median = paddleMiss[Math.floor(paddleMiss.length / 2)]
  assert.ok(paddleMiss.length > 10, "saw contacts")
  assert.ok(median < 0.08, `the paddle is at the ball at contact (median ${median?.toFixed(3)} m)`)
})
