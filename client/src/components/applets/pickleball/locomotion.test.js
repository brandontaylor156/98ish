// Footwork tests (locomotion.js): the blend space's weights and cadences, feet that never
// slide or cross, steps that keep pace with the body, which way the body faces.
// Run: node --test client/src/components/applets/pickleball/locomotion.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { blendSpace, CLIPS, contactPoint, createGait, facingFor, FOOT, GAITS, hopGait, turnToward, updateGait } from "./locomotion.js"
import { createAnim, updateAnim } from "./anim.js"

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`)
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)

test("blend space: weights sum to 1 and follow the direction and speed", () => {
  for (let a = 0; a < 16; a++)
    for (const v of [0, 0.2, 0.5, 1, 2, 3, 4, 5]) {
      const ang = (a / 16) * Math.PI * 2
      const bs = blendSpace({ vx: Math.sin(ang) * v, vz: Math.cos(ang) * v, yaw: 0.3 })
      near(sum(bs.weights), 1, 1e-9, `weights at ${a}/${v}`)
      for (const w of Object.values(bs.weights)) assert.ok(w >= 0 && w <= 1)
    }
  // standing still: all idle
  assert.equal(blendSpace({}).weights.idle, 1)
  // facing +z (yaw 0): forward is +z, the right is -x
  const fwd = (v) => blendSpace({ vz: v }).weights
  assert.ok(fwd(1).walk > 0.9, "a slow forward move is a walk")
  assert.ok(fwd(3).run > 0.99, "3 m/s forward is a run")
  assert.ok(fwd(5).sprint > 0.99, "5 m/s is a sprint")
  assert.ok(blendSpace({ vx: -2 }).weights.shuffleR > 0.99, "to the right: a shuffle right")
  assert.ok(blendSpace({ vx: 2 }).weights.shuffleL > 0.99, "to the left: a shuffle left")
  assert.ok(blendSpace({ vz: -2 }).weights.back > 0.99, "backward: a backpedal")
  const diag = blendSpace({ vx: -2, vz: 2 }).weights
  near(diag.run + diag.walk + diag.sprint, 0.5, 0.01, "a diagonal blends forward and side")
  near(diag.shuffleR, 0.5, 0.01, "...half and half")
  // turned to run: every direction is a running stride
  assert.ok(blendSpace({ vx: -3, crossover: true }).weights.run > 0.99)
})

test("blend space: cadence and stride match the ground speed (no moonwalking), within human ranges", () => {
  let prev = 0
  for (const v of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]) {
    const bs = blendSpace({ vz: v })
    near(bs.stride * bs.sps, v, 1e-9, `stride x cadence = speed at ${v}`)
    assert.ok(bs.sps >= prev - 1e-9, "cadence rises with speed")
    prev = bs.sps
    assert.ok(bs.sps >= 1.8 && bs.sps <= 4.3, `steps a second at ${v}: ${bs.sps}`)
    assert.ok(bs.stride <= 1.25, `a step at ${v} m/s: ${bs.stride} m`)
    assert.ok(bs.duty > 0.3 && bs.duty < 0.65)
    // the clips play at the cadence: (cycles a second) x (the clip's length)
    for (const C of Object.values(CLIPS)) near(bs.timeScale[C.clip], (bs.sps / 2) * C.duration, 1e-9, C.clip)
  }
  // walking duty over half (both feet down at times), running under (a flight phase)
  assert.ok(blendSpace({ vz: 1 }).duty > 0.5)
  assert.ok(blendSpace({ vz: 4 }).duty < 0.45)
  // shuffles and backpedals are quick, short steps
  assert.ok(blendSpace({ vx: 2 }).stride < blendSpace({ vz: 2 }).stride + 0.05)
  for (const k of Object.keys(GAITS)) assert.ok(GAITS[k].sps(3) > 2 && GAITS[k].sps(3) < 4.3, k)
})

// run a gait at a steady velocity; returns stats
const steady = ({ vx = 0, vz = 0, yaw = 0, secs = 4, crossover = false }) => {
  const g = createGait(0, 0, yaw)
  const dt = 1 / 60
  let x = 0
  let z = 0
  let slide = 0
  let crossed = 0
  let maxReach = 0
  let behind = 0
  const prev = [null, null]
  const N = Math.round(secs * 60)
  let steps0 = 0
  for (let i = 0; i < N; i++) {
    const k = Math.min(1, i / 15)
    x += vx * k * dt
    z += vz * k * dt
    updateGait(g, { x, z, vx: vx * k, vz: vz * k, yaw, stance: 0.21, reach: null, minHip: 0.78, crossover }, dt)
    if (i === 60) steps0 = g.steps
    g.feet.forEach((f, j) => {
      // the point of the foot on the court (heel, flat or the ball of the foot) never moves
      const c = { ...contactPoint(f), heel: (f.pitch || 0) < 0 }
      if (!f.step && prev[j] && prev[j].heel === c.heel) slide = Math.max(slide, Math.hypot(c.x - prev[j].x, c.z - prev[j].z))
      prev[j] = f.step ? null : c
      if (!f.step) maxReach = Math.max(maxReach, Math.hypot(f.bx - x, f.bz - z))
    })
    if (i > 60) behind = Math.max(behind, Math.hypot((g.feet[0].bx + g.feet[1].bx) / 2 - x, (g.feet[0].bz + g.feet[1].bz) / 2 - z))
    const r = { x: -Math.cos(yaw), z: Math.sin(yaw) }
    const latL = g.feet[0].bx * r.x + g.feet[0].bz * r.z
    const latR = g.feet[1].bx * r.x + g.feet[1].bz * r.z
    if (latL > latR - 0.05) crossed++
  }
  return { slide, crossed, maxReach, behind, sps: (g.steps - steps0) / (secs - 1), count: g.count }
}

test("steady moves: planted feet never slide, steps keep pace, cadence as calibrated", () => {
  const dirs = { forward: [0, 1], right: [-1, 0], left: [1, 0], back: [0, -1], diagonal: [-0.7071, 0.7071] }
  for (const [name, [dx, dz]] of Object.entries(dirs))
    for (const v of [0.6, 1.5, 2.5, 3.5]) {
      if (name === "back" && v > 3) continue
      const s = steady({ vx: dx * v, vz: dz * v })
      assert.ok(s.slide < 1e-9, `${name} ${v}: a planted foot slid ${s.slide}`)
      assert.ok(s.maxReach < 0.75, `${name} ${v}: a planted foot got ${s.maxReach} m from the body`)
      assert.ok(s.behind < 0.75, `${name} ${v}: the feet fell ${s.behind} m behind`)
      const bs = blendSpace({ vx: dx * v, vz: dz * v })
      // (a side shuffle faster than about 3 m/s runs out of legs and steps quicker; in play
      // a move that fast turns into a run, see facingFor)
      const flatOut = (name === "right" || name === "left") && v > 3
      if (!flatOut) assert.ok(Math.abs(s.sps - bs.sps) < 0.75, `${name} ${v}: ${s.sps.toFixed(2)} steps/s vs ${bs.sps.toFixed(2)} calibrated`)
      // (the old gait patted 12 steps a second at a sprint)
      assert.ok(s.sps < (flatOut ? 5 : 4.6), `${name} ${v}: ${s.sps} steps/s`)
      if (name === "right" || name === "left") assert.equal(s.crossed, 0, `${name} ${v}: the feet crossed in a shuffle`)
    }
})

test("standing still: no steps; a small drift settles in a step or two", () => {
  const g = createGait(0, 0, 0)
  for (let i = 0; i < 300; i++) updateGait(g, { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, stance: 0.21, reach: null }, 1 / 60)
  assert.equal(g.steps, 0, "no fidgeting")
  // the body drifts 15 cm (slower than walking pace): a settling step or two, not a run
  let x = 0
  for (let i = 0; i < 120; i++) {
    if (i < 30) x -= 0.005
    updateGait(g, { x, z: 0, vx: i < 30 ? -0.3 : 0, vz: 0, yaw: 0, stance: 0.21, reach: null }, 1 / 60)
  }
  assert.ok(g.steps >= 1 && g.steps <= 4, `settled in ${g.steps} steps`)
  // a turn in place: small pivot steps until the feet face the new way
  const steps = g.steps
  for (let i = 0; i < 120; i++) updateGait(g, { x, z: 0, vx: 0, vz: 0, yaw: 1.2, stance: 0.21, reach: null }, 1 / 60)
  assert.ok(g.steps - steps >= 2 && g.steps - steps <= 5, `turned in ${g.steps - steps} steps`)
  for (const [i, f] of g.feet.entries()) assert.ok(Math.abs(f.yaw - (1.2 + (i ? -1 : 1) * (FOOT.toeOut + 0.04))) < 0.5, "feet face the new way")
})

test("the first step: a quick step with the foot on the side you're going", () => {
  for (const [vx, foot] of [[-2.5, 1], [2.5, 0]]) {
    const g = createGait(0, 0, 0)
    let x = 0
    let first = null
    for (let i = 0; i < 20 && first === null; i++) {
      x += vx * Math.min(1, i / 10) * (1 / 60)
      updateGait(g, { x, z: 0, vx: vx * Math.min(1, i / 10), vz: 0, yaw: 0, stance: 0.21, reach: null }, 1 / 60)
      first = g.feet.findIndex((f) => f.step)
      if (first < 0) first = null
    }
    assert.equal(first, foot, `moving ${vx > 0 ? "left" : "right"}: the ${foot ? "right" : "left"} foot leads`)
  }
})

test("a split step hops both feet when they're still, and lands them wider", () => {
  const g = createGait(0, 0, 0)
  assert.ok(hopGait(g))
  assert.ok(g.feet.every((f) => f.step))
  let maxY = 0
  for (let i = 0; i < 30; i++) {
    updateGait(g, { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, stance: 0.27, reach: null }, 1 / 60)
    maxY = Math.max(maxY, ...g.feet.map((f) => f.y))
  }
  assert.ok(maxY > 0.02 && maxY < 0.06, `hopped ${maxY} m`)
  near(Math.abs(g.feet[0].bx - g.feet[1].bx), 0.54, 0.03, "landed wide")
  // moving: no hop (the feet are busy)
  const h = createGait(0, 0, 0)
  for (let i = 0; i < 20; i++) updateGait(h, { x: -i * 0.04, z: 0, vx: -2.4, vz: 0, yaw: 0, stance: 0.21, reach: null }, 1 / 60)
  assert.equal(hopGait(h), false)
})

test("facing: shuffle facing the net for short moves; turn and run for long fast ones; square up for the ball", () => {
  const base = { facing: 0, ball: { x: 0, y: 1, z: 6 }, between: false, incoming: false, x: 0, z: 0 }
  const dt = 1 / 60
  // a short move sideways: face the net (shuffles)
  let st = {}
  for (let i = 0; i < 30; i++) facingFor(st, { ...base, vx: -1.6, vz: 0, goal: { x: -1.5, z: 0 } }, dt)
  assert.equal(st.mode, "face")
  // a quicker one: a crossover (hips open toward the move, a yaw to the right is smaller)
  st = {}
  let fx
  for (let i = 0; i < 30; i++) fx = facingFor(st, { ...base, vx: -2.5, vz: 0, goal: { x: -1.5, z: 0 } }, dt)
  assert.equal(fx.mode, "cross")
  assert.ok(fx.yaw < -0.5 && fx.yaw > -1, `hips open about 43 degrees toward the move (${fx.yaw})`)
  // ...and with the ball coming it stays a crossover (shoulders kept square by anim.js)
  assert.equal(facingFor(st, { ...base, vx: -2.5, vz: 0, goal: { x: -1.5, z: 0 }, incoming: true }, dt).mode, "cross")
  // slowing down for the ball: back to facing the net
  for (let i = 0; i < 5; i++) fx = facingFor(st, { ...base, vx: -1.0, vz: 0, goal: { x: -1.5, z: 0 }, incoming: true }, dt)
  assert.equal(fx.mode, "face")
  // a long fast move sideways: turned to run
  st = {}
  let f
  for (let i = 0; i < 30; i++) f = facingFor(st, { ...base, vx: -3.6, vz: 0, goal: { x: -5, z: 0 } }, dt)
  assert.equal(f.mode, "travel")
  near(f.yaw, -Math.PI / 2, 1e-9, "faces the run")
  // ...then the ball comes: square up again (still moving fast: a crossover, chest to the net)
  f = facingFor(st, { ...base, vx: -3.6, vz: 0, goal: { x: -5, z: 0 }, incoming: true }, dt)
  assert.equal(f.mode, "cross")
  f = facingFor(st, { ...base, vx: -0.8, vz: 0, goal: { x: -5, z: 0 }, incoming: true }, dt)
  assert.equal(f.mode, "face")
  // without a goal (a person playing), only a sustained fast run turns them (a crossover first)
  st = {}
  f = facingFor(st, { ...base, vx: -3.5, vz: 0 }, dt)
  assert.equal(f.mode, "cross")
  for (let i = 0; i < 20; i++) f = facingFor(st, { ...base, vx: -3.5, vz: 0 }, dt)
  assert.equal(f.mode, "travel")
  // a deep lob over the head: turned side-on, running back
  st = {}
  for (let i = 0; i < 30; i++) f = facingFor(st, { ...base, vx: 0, vz: -3.4, goal: { x: 0, z: -5 } }, dt)
  assert.equal(f.mode, "retreat")
  assert.ok(Math.abs(Math.abs(f.yaw - 0) - Math.PI / 2) < 0.8, `side-on: ${f.yaw}`)
  // a backpedal of a couple of steps stays square
  st = {}
  for (let i = 0; i < 30; i++) f = facingFor(st, { ...base, vx: 0, vz: -2, goal: { x: 0, z: -1.5 } }, dt)
  assert.equal(f.mode, "face")
  // between points: walk where you're going, then face the net
  st = {}
  f = facingFor(st, { ...base, between: true, vx: 1.2, vz: 0, goal: { x: 4, z: 0 } }, dt)
  assert.equal(f.mode, "travel")
  f = facingFor(st, { ...base, between: true, vx: 0, vz: 0, goal: { x: 0.1, z: 0 } }, dt)
  assert.equal(f.mode, "face")
})

test("turning: a smooth start and stop under a top speed, never a snap", () => {
  const st = { yaw: 0, w: 0 }
  let maxW = 0
  let prev = 0
  for (let i = 0; i < 120; i++) {
    turnToward(st, Math.PI * 0.9, 1 / 60, { maxRate: 8, k: 14 })
    maxW = Math.max(maxW, Math.abs(st.yaw - prev) * 60)
    prev = st.yaw
  }
  assert.ok(maxW <= 8 + 1e-6, `top turning speed ${maxW}`)
  near(st.yaw, Math.PI * 0.9, 0.02, "got there")
  // the short way round
  const s2 = { yaw: 3, w: 0 }
  for (let i = 0; i < 60; i++) turnToward(s2, -3, 1 / 60)
  near(Math.abs(s2.yaw), 3, 0.05, "turned through pi, not the long way")
})

test("a whole run cycle through anim.js: the body moves smoothly with the player (no pops)", () => {
  const a = createAnim(0, 0, 0)
  const dt = 1 / 60
  let x = 0
  let prev = null
  let worst = 0
  for (let i = 0; i < 240; i++) {
    const v = i < 120 ? Math.min(3.5, i * 0.12) : Math.max(0, 3.5 - (i - 120) * 0.15)
    x -= v * dt
    const pose = updateAnim(a, { x, z: 0, vx: -v, vz: 0, facing: 0, ball: { x: 0, y: 1, z: 7 }, holding: false, swing: null, prep: null, charging: false, between: false, atNet: false, hand: 1 }, dt)
    if (prev) {
      const jump = Math.hypot(pose.pelvis.x - prev.x, pose.pelvis.z - prev.z) - v * dt
      worst = Math.max(worst, jump)
    }
    prev = { ...pose.pelvis }
  }
  assert.ok(worst < 0.04, `the body never jumps ahead of the player (worst ${worst.toFixed(3)} m in a frame)`)
})
