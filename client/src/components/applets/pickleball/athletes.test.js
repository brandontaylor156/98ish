// Pickleball 98: the athletes' movement round (docs/pickleball-log.md "Athletes' movement
// round", docs/ppa-reference.md "For the animation work"). The ready stance by court position,
// the split step that keeps momentum, the computer players' reaction and staged approach to the
// kitchen line, and the overhead's set-up (sideways, the tracking arm, the drop step, the jump
// and landing) with the paddle still meeting the ball.
// node --test client/src/components/applets/pickleball/athletes.test.js
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"
import { OVERHEAD_SET, ZONES, dropStep, isOverhead, landingSink, overheadTurn, readyFor } from "./pro.js"
import { createAnim, splitStep, updateAnim } from "./anim.js"
import { studioScript } from "./studio.js"
import { simulate } from "./tools/rallysim.mjs"
import { buildLibrary } from "./mm/library.js"
import { setMotionLibrary, setEnabled } from "./mm/runtime.js"
import { STEP_Z } from "./ai.js"

const lib = (() => {
  const dir = fileURLToPath(new URL("../../../../public/assets/pickleball/", import.meta.url))
  if (!fs.existsSync(dir + "motion.bin")) return null
  return buildLibrary(JSON.parse(fs.readFileSync(dir + "motion.json", "utf8")), new Uint8Array(zlib.gunzipSync(fs.readFileSync(dir + "motion.bin"))))
})()

const D3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const ang = (a, b, c) => {
  const u = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
  const v = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z }
  return (Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / (Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z))))) * 180) / Math.PI
}
// the footage's measures: hips above the (standing) ankle as a share of upright, knee angle,
// feet apart
const measure = (p) => {
  const up = (0.99 * (D3(p.hipL, p.kneeL) + D3(p.kneeL, p.ankleL) + D3(p.hipR, p.kneeR) + D3(p.kneeR, p.ankleR))) / 2
  return {
    hip: ((p.hipL.y + p.hipR.y) / 2 - Math.min(p.ankleL.y, p.ankleR.y)) / up,
    knee: (ang(p.hipL, p.kneeL, p.ankleL) + ang(p.hipR, p.kneeR, p.ankleR)) / 2,
    feet: Math.hypot(p.ankleL.x - p.ankleR.x, p.ankleL.z - p.ankleR.z),
  }
}
// run a studio state and measure at the other side's contact (the split step's landing, t = 1.0)
const at = (state, mm, t = 1.1) => {
  const sc = studioScript(state, 0, -4.6, {})
  const s0 = sc.at(0)
  const a = createAnim(s0.x, s0.z, 0)
  a.useMM = mm
  const ev = [...(sc.events || [])]
  let out = null
  let pose
  for (let i = 0; i <= Math.round(sc.T * 60); i++) {
    const tt = i / 60
    while (ev.length && ev[0][0] <= tt) ev.shift()[1](a)
    pose = updateAnim(a, sc.at(tt), 1 / 60)
    if (!out && tt >= t - 1e-9) out = { ...measure(pose), pose, a }
  }
  return out || { ...measure(pose), pose, a }
}

test("ready stance by position: blended kitchen -> transition -> baseline (pro.js READY, ZONES)", () => {
  const k = readyFor("allcourt", 2.5)
  const m = readyFor("allcourt", ZONES.mid)
  const b = readyFor("allcourt", 7)
  assert.ok(k.stance > b.stance && b.crouch > m.crouch && m.crouch > k.crouch, "wide and tall at the kitchen, lower at the baseline")
  // smooth through the zone: never a jump
  let last = readyFor("allcourt", 2.9)
  for (let d = 2.9; d < 5.8; d += 0.05) {
    const r = readyFor("allcourt", d)
    assert.ok(Math.abs(r.crouch - last.crouch) < 0.004 && Math.abs(r.stance - last.stance) < 0.006, `smooth at ${d.toFixed(2)} m`)
    last = r
  }
  // (a boolean still picks the old kitchen / baseline choice: replays and online copies)
  assert.equal(readyFor("allcourt", true), readyFor("allcourt", 2))
})

for (const mm of [false, true]) {
  test(`ready stance at the other side's contact matches the PPA footage (${mm ? "motion matching" : "procedural"})`, { skip: mm && !lib }, () => {
    if (mm) setMotionLibrary(lib)
    setEnabled(mm)
    try {
      const K = at("ready-kitchen", mm)
      const M = at("ready-mid", mm)
      const B = at("ready-base", mm)
      // tour: kitchen hips 90% (73-100), feet ~0.65 m; transition 89%; baseline 85% (63-99), ~0.54 m
      assert.ok(K.hip > 0.86 && K.hip < 0.97, `kitchen hips ${K.hip.toFixed(2)}`)
      assert.ok(B.hip > 0.8 && B.hip < 0.93, `baseline hips ${B.hip.toFixed(2)}`)
      assert.ok(B.hip < K.hip - 0.01, `lower at the baseline (${B.hip.toFixed(2)} vs ${K.hip.toFixed(2)})`)
      assert.ok(M.hip <= K.hip + 0.01 && M.hip >= B.hip - 0.01, `transition in between (${M.hip.toFixed(2)})`)
      assert.ok(K.feet > 0.55 && K.feet < 0.75, `kitchen feet ${K.feet.toFixed(2)} m (wider than the shoulders)`)
      assert.ok(K.feet > B.feet, "the kitchen's base is the widest")
      // knees: bent, never the old half-squat (footage 156 deg; a rigid two-bone leg at 90% hips
      // and a 0.65 m base can't straighten past ~140)
      assert.ok(K.knee > 128 && K.knee < 170, `kitchen knees ${K.knee.toFixed(0)} deg`)
    } finally {
      setEnabled(true)
    }
  })
}

test("split step: a small hop as the other side hits that keeps the momentum (feet keep moving)", { skip: !lib }, () => {
  setMotionLibrary(lib)
  const sc = studioScript("split-move", 0, -4.6, {})
  const a = createAnim(sc.at(0).x, sc.at(0).z, 0)
  a.useMM = true
  const ev = [...sc.events]
  let maxHop = 0
  let pelvisZ0 = null
  let pelvisZ1 = null
  let stepsDuring = 0
  let prevPlant = null
  for (let i = 0; i <= Math.round(sc.T * 60); i++) {
    const t = i / 60
    while (ev.length && ev[0][0] <= t) ev.shift()[1](a)
    const p = updateAnim(a, sc.at(t), 1 / 60)
    if (p.info.split) maxHop = Math.max(maxHop, Math.min(p.footL.y, p.footR.y))
    if (Math.abs(t - 0.8) < 1e-6) pelvisZ0 = p.pelvis.z
    if (Math.abs(t - 0.95) < 1e-6) pelvisZ1 = p.pelvis.z
    const plant = `${p.footL.planted ? 1 : 0}${p.footR.planted ? 1 : 0}`
    if (t > 0.6 && t < 1.1 && prevPlant !== null && plant !== prevPlant) stepsDuring++
    prevPlant = plant
  }
  assert.ok(maxHop > 0.005 && maxHop < 0.09, `a small hop (${(maxHop * 100).toFixed(1)} cm)`)
  // the body carries on forward through the landing (the match checks it gently)
  assert.ok(pelvisZ1 - pelvisZ0 > 0.1, `still moving through the split (${(pelvisZ1 - pelvisZ0).toFixed(2)} m in 0.15 s)`)
  assert.ok(stepsDuring >= 2, `the feet keep stepping (${stepsDuring} changes)`)
})

// one simulator run shared by the match-level tests
let sim = null
const pro = () => (sim ||= simulate({ level: "pro", games: 4 }))

test("computer players: reaction ~0.30 s after the far contact (tour 0.30, 0.20-0.35); still drifting at it", () => {
  const L = pro()
  const r = L.movement.reaction
  assert.ok(r.n > 100, `reactions ${r.n}`)
  assert.ok(r.median >= 0.27 && r.median <= 0.34, `reaction ${r.median} s`)
  // (the split step doesn't freeze them: tour players move ~1.0 m/s at the far contact; the old
  // stop-dead read gave 0.31 m/s, measured the footage's way)
  assert.ok(L.movement.speedAtOppHit.smoothed > 0.36, `moving at the far contact (${L.movement.speedAtOppHit.smoothed} m/s)`)
  // (round 2: the footage's own count, the third shot on, at the kitchen line: tour 0.76 m/s
  // with the feet tracked; the game's body 0.34 before the team shaded with the ball, ai.js SHADE)
  const kz = L.movement.speedAtOppHitFootage.kitchen
  assert.ok(kz.n > 100 && kz.median > 0.42, `moving at the kitchen line at the far contact (${kz.median} m/s, n=${kz.n})`)
  // short bursts, not sprints (tour 3.31 m/s, 4.9 m/s^2)
  assert.ok(L.movement.speed95.median > 2.9 && L.movement.speed95.median < 3.7, `speed95 ${L.movement.speed95.median}`)
  assert.ok(L.movement.acc95.median > 4.3 && L.movement.acc95.median < 5.9, `acc95 ${L.movement.acc95.median}`)
})

test("kitchen arrival: returners ~1.6 s after the return, the serving team in stages ~4.9 s after the serve", () => {
  const L = pro()
  const ret = L.movement.kitchenReturner
  const srv = L.movement.kitchenServingTeam
  assert.ok(ret.n > 30 && srv.n > 20, `samples ${ret.n} / ${srv.n}`)
  assert.ok(ret.median >= 1.4 && ret.median <= 1.8, `returning team ${ret.median} s (tour 1.6, 1.5-2.0)`)
  // (they used to rush straight in after a third-shot drop: 4.07 s)
  assert.ok(srv.median >= 4.4 && srv.median <= 5.6, `serving team ${srv.median} s (tour 4.85, 3.85-7.65)`)
  // the stage: a couple of steps inside the transition zone
  assert.ok(STEP_Z > 2.9 && STEP_Z < 4.3)
})

test("overhead set-up: sideways early, through square at the smash; drop step for a ball behind; a landing", () => {
  assert.equal(overheadTurn(-OVERHEAD_SET.readAt - 0.1), 0)
  assert.equal(overheadTurn(-0.6), 1, "fully sideways while it falls")
  assert.ok(overheadTurn(0) < 0.5 && overheadTurn(0) > 0.2, "opening at contact")
  assert.equal(overheadTurn(OVERHEAD_SET.after + 0.01), 0, "square after")
  assert.ok(isOverhead("smash", 2.1) && !isOverhead("dink", 2.1) && !isOverhead("drive", 1.2))
  assert.ok(dropStep({ x: 0.2, z: 0.0 }, 0.5), "a ball over or behind: the drop step")
  assert.equal(dropStep({ x: 0.2, z: 0.6 }, 0.5), null, "out in front: no drop step")
  assert.ok(dropStep({ x: 0.2, z: 0.0 }, 0.5).spot.z < 0, "back")
  assert.ok(landingSink(OVERHEAD_SET.absorb / 2) > 0.03 && landingSink(OVERHEAD_SET.absorb + 0.01) === 0)
})

for (const mm of [false, true]) {
  test(`overhead on a lob (${mm ? "motion matching" : "procedural"}): turned sideways, the other arm up at the ball, a drop step, the jump; the face meets the ball`, { skip: mm && !lib }, () => {
    if (mm) setMotionLibrary(lib)
    setEnabled(mm)
    try {
      const sc = studioScript("overhead-lob", 0, -4.6, {})
      const a = createAnim(sc.at(0).x, sc.at(0).z, 0)
      a.useMM = mm
      let side = 0
      let armUp = 0
      let reached = false
      let best = 9
      let airborne = 0
      let landed = false
      let wasUp = false
      for (let i = 0; i <= Math.round(sc.T * 60); i++) {
        const t = i / 60
        const p = updateAnim(a, sc.at(t), 1 / 60)
        if (t > 0.6 && t < 1.0) {
          // the chest turned off the net (yaw 0 faces the net here)
          side = Math.max(side, Math.abs(Math.atan2(p.chestForward.x, p.chestForward.z)))
          armUp = Math.max(armUp, p.wristO.y - (p.shoulderL.y + p.shoulderR.y) / 2)
          if (a.mmReach || (a.gait.feet.some((f) => f.step?.want))) reached = true
        }
        if (Math.abs(t - 1.3) < 0.03) best = Math.min(best, D3(p.paddle.face, sc.contact))
        const up = Math.min(p.footL.y, p.footR.y) > 0.05
        if (up) airborne = Math.max(airborne, Math.min(p.footL.y, p.footR.y))
        if (wasUp && !up && t > 1.3) landed = true
        wasUp = up
      }
      assert.ok(side > 0.7, `sideways (${((side * 180) / Math.PI).toFixed(0)} deg)`)
      assert.ok(armUp > 0.2, `the other hand up tracking the ball (${armUp.toFixed(2)} m above the shoulders)`)
      assert.ok(reached || mm, "a drop step")
      assert.ok(best < 0.03, `the face meets the ball (${(best * 100).toFixed(1)} cm)`)
      assert.ok(airborne > 0.1 && airborne < 0.45, `a jump (${(airborne * 100).toFixed(0)} cm)`)
      assert.ok(landed, "and a landing")
    } finally {
      setEnabled(true)
    }
  })
}

test("around the post: a person's shot from outside the post goes round it and lands in (the same shot planner as the computer's)", async () => {
  const S = await import("./shots.js")
  const P = await import("./physics.js")
  const { sideOf } = await import("./rules.js")
  for (const team of [0, 1]) {
    const side = sideOf(team)
    for (const sx of [1, -1]) {
      const from = P.v3(sx * (P.NET_POST_X + 0.5), 0.35, side * 1.0)
      const plan = S.planIntent({ team, from, incoming: P.v3(sx * 2, -1, side * 5), target: { x: sx * (P.HALF_W - 0.5), z: -side * 3.5 }, pace: 0.5, shotNo: 6, rand: () => 0.5 })
      const out = S.playShot({ p: from, v: P.v3(), w: P.v3(), kind: "outdoor" }, plan, { rand: () => 0.5 })
      const a = S.assessBall(out.ball, team)
      assert.ok(a.atp && a.in, `round the post and in (team ${team}, side ${sx}): clearance ${a.clearance?.toFixed(2)}`)
      assert.equal(S.judgeShot("drive", a).tag, "atp")
    }
  }
})
