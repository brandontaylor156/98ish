// Upper-body tests for Pickleball 98: which stroke for which ball, the swing meeting the ball
// on time, the arm IK's limits, the layer weights, the pop limiters, the head's limits and
// the contact prediction against the match's own rules.
// Run: node --test client/src/components/applets/pickleball/strokes.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { chooseStroke, chooseSide, contactAxis, contactHand, createStroke, stepStroke, predictContact, hermite, arcLerp, STYLES, PADDLE_REACH, strokeKeys } from "./strokes.js"
import { armIK, elbowBend, limitStep, limitTurn, lookToward, pushOut, ramp, ARM_LIMITS, angleBetween } from "./upper.js"
import { limitQuat, steadyGrip, unwrapNear, qaxis, qangle, qmul } from "./retarget.js"
import { createAnim, updateAnim, situation } from "./anim.js"
import { createMatch, step, canHit } from "./match.js"
import { STEP } from "./physics.js"

const V = (x, y, z) => ({ x, y, z })
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const ready = { hand: V(0.15, 1.09, 0.48), axis: V(0.16, 0.65, 0.74), coil: 0, off: V(0.07, 1.1, 0.52), pole: V(0.6, -1, -0.15), lean: 0, crouch: 0, sh: 1.3 }

test("stroke selection follows the contact: height, side and the shot", () => {
  assert.equal(chooseStroke("dink", V(0.4, 0.3, 0.5)), "dink")
  assert.equal(chooseStroke("reset", V(0.4, 0.9, 0.5)), "block")
  assert.equal(chooseStroke("drive", V(0.5, 1.9, 0.3)), "overhead")
  assert.equal(chooseStroke("smash", V(0.3, 2.0, 0.3)), "overhead")
  assert.equal(chooseStroke("smash", V(0.3, 1.2, 0.3)), "punch", "a low smash is a punch")
  assert.equal(chooseStroke("drive", V(0.5, 1.1, 0.4), { volley: true }), "punch", "a volley at the chest is a punch")
  assert.equal(chooseStroke("drive", V(0.5, 0.8, 0.4)), "drive")
  assert.equal(chooseStroke("lob", V(0.5, 0.7, 0.4)), "lob")
  assert.equal(chooseStroke("serve", V(0.3, 0.52, 0.45)), "serve")
  // forehand on the paddle side, backhand on the other
  assert.equal(chooseSide(V(0.5, 0.9, 0.4), "drive"), 1)
  assert.equal(chooseSide(V(-0.5, 0.9, 0.4), "drive"), -1)
  // a ball at the chest, in front of the body at the net: the backhand
  assert.equal(chooseSide(V(0.08, 1.1, 0.4), "punch"), -1)
  // ...and a choice sticks while the ball stays near the middle
  assert.equal(chooseSide(V(0.1, 0.8, 0.4), "drive", -1), -1)
  assert.equal(chooseSide(V(0.6, 0.8, 0.4), "drive", -1), 1, "but not once it's clearly on the other side")
  // overheads and serves are always on the paddle side
  assert.equal(chooseSide(V(-0.3, 2.0, 0.3), "overhead"), 1)
})

test("the paddle at contact: low balls head down, high ones head up, backhands to the other side", () => {
  assert.ok(contactAxis(V(0.5, 0.25, 0.4), 1, "drive").y < -0.4)
  assert.ok(contactAxis(V(0.5, 1.5, 0.4), 1, "drive").y > 0.5)
  assert.ok(contactAxis(V(0.5, 1.0, 0.4), 1, "drive").x > 0.8)
  assert.ok(contactAxis(V(-0.5, 1.0, 0.4), -1, "drive").x < -0.8)
  const c = V(0.6, 0.9, 0.4)
  const ax = contactAxis(c, 1, "drive")
  assert.ok(Math.abs(dist(contactHand(c, ax), c) - PADDLE_REACH) < 1e-9)
})

// run a stroke at 60 Hz: the ball first seen `first` seconds out, contact at t = 0
const runStroke = (kind, c, { first = 0.62, after = 0.9 } = {}) => {
  const st = createStroke()
  const frames = []
  const dt = 1 / 60
  const n0 = Math.round(first * 60)
  for (let i = -n0; i <= Math.round(after * 60); i++) {
    const tt = i / 60
    const inp = tt < 0 ? { key: "p1", kind, c, tRel: tt, after: false, forward: true } : { key: "s1", kind, c, tRel: tt, after: true, forward: true }
    const out = stepStroke(st, inp, ready, dt)
    frames.push({ t: tt, ...out, hand: { ...out.pose.hand }, face: V(out.pose.hand.x + out.pose.axis.x * PADDLE_REACH, out.pose.hand.y + out.pose.axis.y * PADDLE_REACH, out.pose.hand.z + out.pose.axis.z * PADDLE_REACH) })
  }
  return frames
}

test("every stroke gets the paddle face to the ball exactly at contact, with no jumps", () => {
  const cases = [
    ["drive", V(0.62, 0.85, 0.42)],
    ["drive", V(-0.6, 0.9, 0.4)],
    ["dink", V(0.42, 0.3, 0.55)],
    ["dink", V(-0.4, 0.28, 0.55)],
    ["punch", V(0.45, 1.12, 0.45)],
    ["block", V(0.05, 1.05, 0.45)],
    ["smash", V(0.25, 2.05, 0.35)],
    ["lob", V(0.55, 0.6, 0.4)],
    ["slice", V(0.55, 0.95, 0.4)],
    ["serve", V(0.3, 0.52, 0.45)],
  ]
  for (const [kind, c] of cases) {
    const frames = runStroke(kind, c)
    const at = frames.find((f) => f.t === 0)
    assert.ok(at, "a frame at contact")
    assert.ok(dist(at.face, c) < 1e-6, `${kind} ${JSON.stringify(c)}: the face is at the ball at contact (${dist(at.face, c)})`)
    // the hand never jumps: at most 25 cm in a frame anywhere, 10 cm before the forward swing
    for (let i = 1; i < frames.length; i++) {
      const d = dist(frames[i].hand, frames[i - 1].hand)
      const limit = frames[i].fast || frames[i - 1].fast ? 0.25 : 0.1
      assert.ok(d <= limit, `${kind}: the hand moved ${d.toFixed(3)} m in one frame at t ${frames[i].t.toFixed(3)} (${frames[i].phase})`)
    }
    // fastest around contact: the swing accelerates into the ball
    const speedAt = (i) => dist(frames[i].hand, frames[i - 1].hand) * 60
    const iC = frames.indexOf(at)
    const windUp = Math.max(...frames.slice(1, iC - 12).map((_, k) => speedAt(k + 1)))
    assert.ok(speedAt(iC) > windUp, `${kind}: faster at contact (${speedAt(iC).toFixed(2)} m/s) than in the wind-up (${windUp.toFixed(2)} m/s)`)
    // and it finishes back in the ready position
    const last = frames[frames.length - 1]
    assert.equal(last.phase, "none", `${kind} recovered`)
  }
})

test("a forehand winds up (paddle shoulder back) and follows through (paddle shoulder through)", () => {
  const frames = runStroke("drive", V(0.62, 0.85, 0.42))
  const back = frames.find((f) => f.t > -0.2 && f.phase === "wind")
  const finish = frames.find((f) => f.t > 0.26)
  assert.ok(back.pose.coil > 0.5, `coiled at the back (${back.pose.coil})`)
  assert.ok(back.pose.hand.z < 0, "the paddle goes back behind the body")
  assert.ok(finish.pose.coil < -0.5, `uncoiled through the ball (${finish.pose.coil})`)
  assert.ok(finish.pose.hand.x < 0, "the forehand finishes across the body")
  // the shoulders lead the arm: halfway through the forward swing the coil has unwound more
  // than the hand has travelled
  const fwd = frames.filter((f) => f.phase === "forward")
  const mid = fwd[Math.floor(fwd.length / 2)]
  const from = fwd[0]
  const K = strokeKeys("drive", 1, V(0.62, 0.85, 0.42))
  const coilDone = (from.pose.coil - mid.pose.coil) / (from.pose.coil - K.contact.coil)
  const handDone = dist(from.hand, mid.hand) / dist(from.hand, K.contact.hand)
  assert.ok(coilDone > handDone, `shoulders lead (coil ${coilDone.toFixed(2)} vs hand ${handDone.toFixed(2)})`)
  // a backhand winds the other way
  const bh = runStroke("drive", V(-0.6, 0.9, 0.4))
  assert.ok(bh.find((f) => f.t > -0.2 && f.phase === "wind").pose.coil < -0.5, "backhand coil")
})

test("a late ball gets a short take-back, still on time", () => {
  const full = runStroke("drive", V(0.6, 0.9, 0.4))
  const late = runStroke("drive", V(0.6, 0.9, 0.4), { first: 0.2 })
  const backOf = (frames) => Math.min(...frames.filter((f) => f.t < 0).map((f) => f.hand.z))
  assert.ok(backOf(late) > backOf(full) + 0.1, `shorter take-back (${backOf(late).toFixed(2)} vs ${backOf(full).toFixed(2)})`)
  const at = late.find((f) => f.t === 0)
  assert.ok(dist(at.face, V(0.6, 0.9, 0.4)) < 1e-6, "on time")
})

test("a person holding the hit control holds the wind-up; a ball that never comes unwinds", () => {
  const st = createStroke()
  let out
  for (let i = 0; i < 40; i++) out = stepStroke(st, { key: "p1", kind: "drive", c: V(0.6, 0.9, 0.4), tRel: -0.1, after: false, forward: false }, ready, 1 / 60)
  assert.equal(out.phase, "wind")
  assert.ok(out.pose.coil > 0.7, "held at the back")
  for (let i = 0; i < 40; i++) out = stepStroke(st, null, ready, 1 / 60)
  assert.equal(out.phase, "none")
  assert.equal(out.w, 0)
})

test("curves: Hermite ends and arcs round the shoulder", () => {
  const p0 = V(0, 0, 0)
  const p1 = V(1, 0, 0)
  assert.ok(dist(hermite(p0, V(0, 0, 0), p1, V(2, 0, 0), 0.2, 0), p0) < 1e-12)
  assert.ok(dist(hermite(p0, V(0, 0, 0), p1, V(2, 0, 0), 0.2, 1), p1) < 1e-12)
  // from in front low to behind high round a shoulder: never closer to it than either end
  const o = V(0.18, 1.3, 0.1)
  const a = V(0.15, 1.1, 0.55)
  const b = V(0.3, 1.65, -0.2)
  for (let t = 0; t <= 1; t += 0.05) assert.ok(dist(arcLerp(a, b, t, o), o) >= Math.min(dist(a, o), dist(b, o)) - 1e-9)
})

test("arm IK: bones keep their length, the elbow can't fold the hand into the shoulder, and it never flips", () => {
  const sh = V(0, 1.3, 0)
  const st = {}
  // a target right at the shoulder: the hand stays at least the fold limit away
  const r = armIK(st, sh, V(0.01, 1.3, 0.01), 0.29, 0.27, V(0, -1, 0))
  assert.ok(dist(r.end, sh) >= ARM_LIMITS.minReach - 1e-9)
  assert.ok(Math.abs(dist(r.mid, sh) - 0.29) < 1e-9 && Math.abs(dist(r.end, r.mid) - 0.27) < 1e-9)
  // out of reach: a straight arm, never past it
  const far = armIK({}, sh, V(2, 1.3, 0), 0.29, 0.27, V(0, -1, 0))
  assert.ok(!far.reached && elbowBend(sh, far.mid, far.end) >= 0)
  // the pole swings to the other side: the elbow turns at most maxTurn a frame
  const s2 = {}
  armIK(s2, sh, V(0.3, 1.0, 0.3), 0.29, 0.27, V(1, 0, 0))
  const before = { ...s2.bend }
  armIK(s2, sh, V(0.3, 1.0, 0.3), 0.29, 0.27, V(-1, 0, 0), { maxTurn: 0.2 })
  assert.ok(angleBetween(before, s2.bend) <= 0.2 + 1e-6, `elbow turned ${angleBetween(before, s2.bend)}`)
  // a pole along the arm (useless): the elbow keeps where it was
  const s3 = {}
  armIK(s3, sh, V(0, 0.9, 0.3), 0.29, 0.27, V(1, 0, 0))
  const kept = { ...s3.bend }
  armIK(s3, sh, V(0, 0.9, 0.3), 0.29, 0.27, V(0, -0.4, 0.3))
  assert.ok(angleBetween(kept, s3.bend) < 0.05, "kept the elbow's side")
})

test("pop limiters: points, directions and bone rotations move at most so far a frame", () => {
  assert.ok(dist(limitStep(V(0, 0, 0), V(1, 0, 0), 0.1), V(0.1, 0, 0)) < 1e-12)
  assert.deepEqual(limitStep(V(0, 0, 0), V(0.05, 0, 0), 0.1), V(0.05, 0, 0))
  const d = limitTurn(V(1, 0, 0), V(-1, 0.001, 0), 0.3)
  assert.ok(Math.abs(angleBetween(V(1, 0, 0), d) - 0.3) < 1e-6, "turned exactly the limit, even almost straight back")
  const q0 = qaxis(V(0, 1, 0), 0)
  const q1 = qaxis(V(0, 1, 0), 2)
  assert.ok(Math.abs(qangle(q0, limitQuat(q0, q1, 0.25)) - 0.25) < 1e-6)
  assert.equal(limitQuat(q0, qaxis(V(0, 1, 0), 0.1), 0.25).w, qaxis(V(0, 1, 0), 0.1).w, "small turns pass")
  // the grip: two ways to hold the same paddle (180 degrees apart round the handle); the hand
  // keeps the nearer one
  const flip = qaxis(V(0, 1, 0), Math.PI)
  const hold = qaxis(V(1, 0, 0), 0.3)
  assert.equal(steadyGrip(hold, qaxis(V(1, 0, 0), 0.35), qmul(qaxis(V(1, 0, 0), 0.35), flip), -1), 1)
  assert.equal(steadyGrip(hold, qmul(qaxis(V(1, 0, 0), 0.35), flip), qaxis(V(1, 0, 0), 0.35), 1), -1)
  assert.equal(steadyGrip(null, hold, hold, -1), -1)
  // an angle carried on from the last one (no jump from +180 to -180)
  assert.ok(Math.abs(unwrapNear(-3.1, 3.1) - (2 * Math.PI - 3.1)) < 1e-9)
})

test("layer weights fade in and out over their times; capsules push out; the head keeps to a neck's limits", () => {
  let w = 0
  for (let i = 0; i < 6; i++) w = ramp(w, 1, 1 / 60, 0.2, 0.1)
  assert.ok(Math.abs(w - 0.5) < 1e-9, "half way after half the fade")
  for (let i = 0; i < 12; i++) w = ramp(w, 1, 1 / 60, 0.2, 0.1)
  assert.equal(w, 1)
  for (let i = 0; i < 3; i++) w = ramp(w, 0, 1 / 60, 0.2, 0.1)
  assert.ok(Math.abs(w - 0.5) < 1e-9, "fades out at its own speed")
  const push = pushOut(V(0.05, 1.1, 0), V(0, 0.9, 0), V(0, 1.4, 0), 0.15)
  assert.ok(Math.abs(Math.hypot(0.05 + push.x, push.z) - 0.15) < 1e-9)
  assert.deepEqual(pushOut(V(0.5, 1.1, 0), V(0, 0.9, 0), V(0, 1.4, 0), 0.15), V(0, 0, 0))
  const st = {}
  let dir
  for (let i = 0; i < 120; i++) dir = lookToward(st, V(0, 0, -1), V(0, 0, 1), 1 / 60, { maxYaw: 1.25, rate: 8 })
  assert.ok(Math.abs(Math.atan2(Math.abs(dir.x), dir.z) - 1.25) < 1e-3, "can't look straight behind")
  const st2 = { dir: V(0, 0, 1) }
  const d1 = lookToward(st2, V(1, 0, 0.2), V(0, 0, 1), 1 / 60, { rate: 8 })
  assert.ok(angleBetween(V(0, 0, 1), d1) <= 8 / 60 + 1e-9, "turns at a top speed")
})

test("the contact prediction agrees with the match's own reach rule", () => {
  // a ball coming straight at a player who stands still: the predicted moment is the first
  // moment canHit says yes
  for (const [vy, needBounce] of [[2, false], [0.5, true]]) {
    const m = createMatch({ doubles: false, level: "pro", seed: 1 })
    const p = m.players.find((q) => q.team === 0)
    p.x = 0.3
    p.z = 5.5
    p.vx = p.vz = 0
    m.phase = "rally"
    m.rally.hits = 3
    m.rally.lastTeam = 1
    m.rally.bounces = 0
    m.ball.held = null
    m.ball.p = V(0, 1.0, 0.5)
    m.ball.v = V(0, vy, 9)
    m.ball.w = V(0, 0, 0)
    const pc = predictContact({ ball: m.ball, x: p.x, z: p.z, side: 1, needBounce })
    assert.ok(pc, "found a contact")
    // fly the real ball on and ask canHit
    const req = { kind: "ai", waitBounce: needBounce }
    let t = 0
    let bounces = 0
    while (t < 1.5) {
      const ok = canHit(m, p, req)
      if (ok && (!needBounce || bounces > 0)) break
      const vyWas = m.ball.v.y
      step(m, STEP)
      if (vyWas < 0 && m.ball.v.y > 0) bounces++
      t += STEP
    }
    assert.ok(Math.abs(t - pc.t) < 0.012, `predicted ${pc.t.toFixed(3)} s, the match hits at ${t.toFixed(3)} s`)
    assert.equal(pc.volley, !needBounce)
  }
  // out of reach: none
  assert.equal(predictContact({ ball: { p: V(3, 1, 0.5), v: V(0, 2, 9), w: V(0, 0, 0) }, x: -2.5, z: 5.5, side: 1 }), null)
})

test("in a match: the paddle arm doesn't swing with the run while holding ready or swinging", () => {
  const a = createAnim(0, 5, Math.PI)
  const base = { x: 0, z: 5, vx: 0, vz: 0, facing: Math.PI, ball: V(0, 1, 0), holding: false, swing: null, prep: null, charging: false, between: false, atNet: false, hand: 1 }
  // a long fast run between shots (turned to run): the other arm pumps, the paddle arm some
  let x = 0
  for (let i = 0; i < 90; i++) {
    x += 4 / 60
    updateAnim(a, { ...base, x, vx: 4, goal: { x: 9, z: 5 } }, 1 / 60)
  }
  assert.ok(a.w.pumpO > 0.6, `the other arm pumps (${a.w.pumpO})`)
  const travel = a.w.pumpP
  assert.ok(travel > 0.1, `the paddle arm swings a little on a long run (${travel})`)
  // a ball on its way: the paddle arm stops swinging within a fraction of a second
  for (let i = 0; i < 20; i++) {
    x += 4 / 60
    updateAnim(a, { ...base, x, vx: 4, prep: { ttc: 0.5, x: x + 0.6, y: 0.9, z: 4.6, kind: "drive", forward: true } }, 1 / 60)
  }
  assert.equal(a.w.pumpP, 0, "no run swing on the paddle arm while a ball comes")
})

test("a whole match: the paddle meets the ball, nothing pops, the hand never folds into the shoulder", () => {
  const m = createMatch({ doubles: true, level: "pro", seed: 7 })
  m.autoplay = true
  const anims = m.players.map((p) => createAnim(p.x, p.z, p.team === 0 ? Math.PI : 0))
  const prev = m.players.map(() => null)
  const miss = []
  let worstSlow = 0
  let fold = Infinity
  for (let f = 0; f < 60 * 60; f++) {
    for (let k = 0; k < 4; k++) {
      step(m, STEP)
      m.events.length = 0
    }
    m.players.forEach((p, i) => {
      const s = situation(m, p)
      s.hand = 1
      const pose = updateAnim(anims[i], s, 1 / 60)
      if (p.swing && !p.swing.whiff && p.swing.t > 0 && p.swing.t < 1 / 60 + 1e-9) miss.push(dist(pose.paddle.face, p.swing))
      const up = norm3(sub3(pose.elbowP, pose.paddleShoulder))
      if (prev[i] && !pose.info.fast && !prev[i].fast) worstSlow = Math.max(worstSlow, (angleBetween(up, prev[i].up) * 180) / Math.PI)
      prev[i] = { up, fast: pose.info.fast }
      fold = Math.min(fold, dist(pose.wristP, pose.paddleShoulder))
    })
  }
  miss.sort((a, b) => a - b)
  assert.ok(miss.length > 30, `saw contacts (${miss.length})`)
  const median = miss[Math.floor(miss.length / 2)]
  assert.ok(median < 0.06, `the paddle is at the ball at contact (median ${median.toFixed(3)} m)`)
  assert.ok(worstSlow < 50, `no elbow flips outside swings (worst ${worstSlow.toFixed(1)} deg a frame)`)
  assert.ok(fold >= ARM_LIMITS.minReach - 1e-6, `the hand never folds into the shoulder (${fold.toFixed(3)} m)`)
})

const sub3 = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z)
const norm3 = (a) => {
  const l = Math.hypot(a.x, a.y, a.z) || 1
  return V(a.x / l, a.y / l, a.z / l)
}
// (STYLES is the timing table: every style has its phases)
test("every stroke style has its timings", () => {
  for (const [name, S] of Object.entries(STYLES)) for (const k of ["prep", "fwd", "fin", "hold", "rec", "wind"]) assert.ok(S[k] > 0, `${name}.${k}`)
})
