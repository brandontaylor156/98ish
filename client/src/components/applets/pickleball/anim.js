// Pickleball 98: how the players move. Pure JavaScript (no three.js): every frame this
// turns a player's state in the match (where they are, how fast they're going, the ball,
// their swing) into world positions for every joint of a simple skeleton, which rig.js
// draws. Node tests check that feet stay planted, legs and arms keep their lengths, and the
// paddle meets the ball.
//
// - Feet: locomotion.js (a blend space of walk / run / sprint / shuffle / backpedal, a step
//   clock calibrated so stride x cadence = speed, feet locked to the court in stance, swing
//   paths from motion capture), and which way to face (turn and run, or shuffle facing the
//   net). Planted feet never move.
// - Legs and arms: two-bone inverse kinematics (hip-knee-ankle, shoulder-elbow-wrist).
// - The pelvis drops when the feet are wide (a lunge) so legs always reach the court.
// - Strokes: the paddle hand follows a backswing, the forward swing to the actual contact
//   point, and a follow-through, in the body's own frame, per shot type (drive, slice,
//   dink, drop, lob, volley, smash, the underhand serve).
// - Moods: the ready stance (knees bent, weight shifting), the split step when the other
//   side hits, and celebrating or sulking after a point.

import { createGait, updateGait, facingFor, turnToward, hopGait } from "./locomotion.js"
import { createStroke, mixPose, predictContact, stepStroke } from "./strokes.js"
import { armIK, limitStep, limitTurn, lookToward, pushOut, ramp, smoothW } from "./upper.js"
import { sideOf } from "./rules.js"

// ---- the skeleton (meters) ----
export const BODY = {
  thigh: 0.43,
  shin: 0.43,
  ankle: 0.075, // ankle joint above the court
  hipHalf: 0.095, // hip joints either side of the pelvis center
  spine: 0.5, // pelvis center to the base of the neck
  shoulderHalf: 0.19,
  upperArm: 0.29,
  forearm: 0.27,
  neck: 0.17, // base of the neck to the center of the head
  paddleReach: 0.25, // wrist to the paddle face's center
  footLen: 0.26,
}
const LEG = BODY.thigh + BODY.shin
const ARM = BODY.upperArm + BODY.forearm

// ---- small vector helpers ({x, y, z} objects, like physics.js) ----
const V = (x = 0, y = 0, z = 0) => ({ x, y, z })
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z)
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z)
const mul = (a, s) => V(a.x * s, a.y * s, a.z * s)
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
const len = (a) => Math.hypot(a.x, a.y, a.z)
const norm = (a, fallback = V(0, 1, 0)) => {
  const l = len(a)
  return l > 1e-9 ? mul(a, 1 / l) : { ...fallback }
}
const lerp = (a, b, t) => a + (b - a) * t
const lerpV = (a, b, t) => V(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t))
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const smooth = (t) => {
  const u = clamp(t, 0, 1)
  return u * u * (3 - 2 * u)
}
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3)
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const UP = V(0, 1, 0)

// A body frame: yaw 0 faces +z. forward = (sin yaw, 0, cos yaw), right = (-cos yaw, 0, sin yaw)
export const frame = (yaw) => ({ f: V(Math.sin(yaw), 0, Math.cos(yaw)), r: V(-Math.cos(yaw), 0, Math.sin(yaw)) })
// body-local (x right, y up, z forward) -> world, around a ground point
const toWorld = (o, fr, l) => V(o.x + fr.r.x * l.x + fr.f.x * l.z, o.y + l.y, o.z + fr.r.z * l.x + fr.f.z * l.z)
const toLocal = (o, fr, w) => {
  const d = sub(w, o)
  return V(dot(d, fr.r), d.y, dot(d, fr.f))
}
const dirToWorld = (fr, l) => V(fr.r.x * l.x + fr.f.x * l.z, l.y, fr.r.z * l.x + fr.f.z * l.z)

// ---- inverse kinematics ----

// Two bones from a (lengths l1, l2) reaching for t, bending toward pole. Returns the middle
// joint and the end (t, or as close as the bones reach).
export const twoBone = (a, t, l1, l2, pole) => {
  const d = sub(t, a)
  const dist0 = len(d)
  const dir = norm(d, V(0, -1, 0))
  const dist = clamp(dist0, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4)
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1)
  const sinA = Math.sqrt(1 - cosA * cosA)
  let pp = sub(pole, mul(dir, dot(pole, dir)))
  if (len(pp) < 1e-6) pp = Math.abs(dir.y) < 0.9 ? cross(dir, UP) : cross(dir, V(1, 0, 0))
  pp = norm(pp)
  const mid = add(a, add(mul(dir, l1 * cosA), mul(pp, l1 * sinA)))
  const end = add(a, mul(dir, dist))
  return { mid, end, reached: dist0 <= l1 + l2 }
}

// a critically damped spring toward a target (numbers or vectors), k = 1/s
const springV = (s, target, k, dt) => {
  if (!s.p) {
    s.p = { ...target }
    s.v = V()
    return s.p
  }
  if (k >= 200 || dt <= 0) {
    if (dt > 0) s.v = mul(sub(target, s.p), 1 / Math.max(dt, 1e-3))
    s.p = { ...target }
    return s.p
  }
  // semi-implicit, stable for k*dt up to ~1
  const h = Math.min(dt, 0.6 / k)
  let left = dt
  while (left > 1e-6) {
    const step = Math.min(h, left)
    const ax = k * k * (target.x - s.p.x) - 2 * k * s.v.x
    const ay = k * k * (target.y - s.p.y) - 2 * k * s.v.y
    const az = k * k * (target.z - s.p.z) - 2 * k * s.v.z
    s.v = V(s.v.x + ax * step, s.v.y + ay * step, s.v.z + az * step)
    s.p = V(s.p.x + s.v.x * step, s.p.y + s.v.y * step, s.p.z + s.v.z * step)
    left -= step
  }
  return s.p
}
const springN = (s, target, k, dt) => {
  if (s.p === undefined) {
    s.p = target
    s.v = 0
    return s.p
  }
  const h = Math.min(dt, 0.6 / k)
  let left = dt
  while (left > 1e-6) {
    const step = Math.min(h, left)
    s.v += (k * k * (target - s.p) - 2 * k * s.v) * step
    s.p += s.v * step
    left -= step
  }
  return s.p
}

// ---- the gait: feet that stay put (locomotion.js) ----

const STANCE = { idle: 0.15, ready: 0.21, wide: 0.27, run: 0.11 }
export { createGait, updateGait }

// ---- strokes: strokes.js (which stroke, when, and the arm's path through the contact) ----
// how much lower a stroke gets (knees), by the shot
const SERVE_Y = 0.52 // the serve's contact height (match.js SERVE_CONTACT_Y)
const CROUCH = { drive: 0.04, return: 0.04, slice: 0.03, dink: 0.1, drop: 0.07, block: 0.06, reset: 0.06, punch: 0.04, speedup: 0.04, counter: 0.04, roll: 0.07, lob: 0.07, smash: 0.02, serve: 0.05 }

// ---- the whole body ----

export const createAnim = (x, z, yaw) => ({
  yaw,
  turn: { yaw, w: 0 }, // the body's turn (a spring with a top speed)
  face: {}, // facing decisions (turned to run or not)
  vel: null, // the body's smoothed velocity and acceleration
  gait: createGait(x, z, yaw),
  hand: {},
  axis: {},
  normal: {},
  off: {},
  twist: {},
  hipTwist: {},
  shift: {},
  lean: {},
  roll: {},
  crouch: {},
  head: {},
  pelvisY: undefined,
  hop: 0, // split step timer (s left)
  hopNow: false,
  mood: null, // { kind, t, variant }
  swingId: null,
  t: 0,
  // the upper body: layer weights, the stroke, the pop limiter's last targets, the elbows'
  // bends, the head
  w: { relax: 0, pumpP: 0, pumpO: 0, hold: 0, mood: 0 },
  stroke: createStroke(),
  handLim: null,
  axisLim: null,
  axisOut: null,
  offLim: null,
  ikP: {},
  ikO: {},
  look: {},
  extraCrouch: 0,
  moodPose: null,
})

// After a hit by the other side: a little hop to get on the toes (the split step)
export const splitStep = (a) => {
  a.hop = 0.32
  a.hopNow = true
}
// After a point: winners celebrate, losers don't
export const setMood = (a, kind, variant = 0) => {
  a.mood = { kind, t: 0, variant }
}

// The body's velocity and acceleration: the match's velocity, steadied with how the position
// actually moved (an online player's updates arrive in jumps), smoothed over a few frames
const motion = (a, s, dt) => {
  if (!a.vel || dt <= 0) {
    a.vel = { x: s.vx, z: s.vz, ax: 0, az: 0, px: s.x, pz: s.z }
    return a.vel
  }
  const v = a.vel
  let mx = s.vx
  let mz = s.vz
  const dx = s.x - v.px
  const dz = s.z - v.pz
  if (Math.hypot(dx, dz) < 0.5) {
    // (a jump of half a meter is a new point's placement, not movement)
    mx = 0.5 * s.vx + 0.5 * clamp(dx / dt, -9, 9)
    mz = 0.5 * s.vz + 0.5 * clamp(dz / dt, -9, 9)
  }
  const k = 1 - Math.exp(-dt * 16)
  const nx = v.x + (mx - v.x) * k
  const nz = v.z + (mz - v.z) * k
  const ka = 1 - Math.exp(-dt * 8)
  v.ax += (clamp((nx - v.x) / dt, -30, 30) - v.ax) * ka
  v.az += (clamp((nz - v.z) / dt, -30, 30) - v.az) * ka
  v.x = nx
  v.z = nz
  v.px = s.x
  v.pz = s.z
  return v
}

// One frame. s (the player's situation):
//   x, z, vx, vz: on court; facing: yaw to face by default (the net)
//   ball: { x, y, z } and whether this player holds it (held) or has just tossed it (toss)
//   swing: { t, kind, hand: "fh" | "bh", x, y, z (contact), n (paddle normal), whiff } or null
//   prep: { ttc, x, y, z, kind, forward } a coming contact (backswing, then the forward swing)
//   charging: holding a shot button (backswing held)
//   between: between points (walking, relaxed); atNet: at the kitchen line
//   goal: { x, z } where the player is heading, if known (turn and run for long moves)
// Returns the pose: world positions of every joint and the paddle's frame.
export const updateAnim = (a, s, dt) => {
  a.t += dt
  const mv = motion(a, s, dt)
  const speed = Math.hypot(mv.x, mv.z)
  const swing = s.swing && !s.swing.whiff && s.swing.t < 0.75 ? s.swing : null
  const whiff = s.swing?.whiff && s.swing.t < 0.5 ? s.swing : null
  if (a.mood) a.mood.t += dt
  if (a.mood && (a.mood.t > 2.6 || (!s.between && a.mood.t > 0.6))) a.mood = null
  if (a.hop > 0) a.hop -= dt

  // which way to face: square to the net and the ball while shuffling and backpedaling; turned
  // to run for a long, fast move (or walking between points); squared up again when a ball is
  // coming. The body turns with a top speed, never in a snap.
  const fc = facingFor(a.face, { vx: mv.x, vz: mv.z, facing: s.facing, ball: s.ball, between: s.between, incoming: !!(swing || s.prep || s.holding || s.charging), goal: s.goal || null, x: s.x, z: s.z }, dt)
  let yaw = fc.yaw
  if (swing || s.prep) {
    // open up toward the contact
    const c = swing || s.prep
    const cy = Math.atan2(c.x - s.x, c.z - s.z)
    yaw = yaw + clamp(wrap(cy - yaw), -0.6, 0.6) * 0.35
  }
  if (a.turn.yaw === undefined) a.turn.yaw = a.yaw
  a.yaw = turnToward(a.turn, yaw, dt, { maxRate: fc.mode === "face" ? (speed > 1.5 ? 8 : 6) : 10, k: speed > 1.5 || swing ? 16 : 11 })
  const fr = frame(a.yaw)
  const ground = V(s.x, 0, s.z)
  // the acceleration in the body's frame (lean into it)
  const accF = mv.ax * fr.f.x + mv.az * fr.f.z
  const accR = mv.ax * fr.r.x + mv.az * fr.r.z
  const bl = a.gait.blend?.weights || { walk: 0, run: 0, sprint: 0, shuffleL: 0, shuffleR: 0, back: 0 }
  const lateral = bl.shuffleL + bl.shuffleR + bl.back

  // ---- crouch, stance and the lunge ----
  let crouch = s.between ? 0.03 : s.atNet ? 0.12 : 0.09 // knees bent, ready
  // shuffles and backpedals stay low; a run lifts a little; a hard stop sinks into it
  if (!s.between) crouch += lateral * 0.04 - (bl.run + bl.sprint) * 0.02
  const braking = speed > 0.6 ? clamp(-(mv.ax * mv.x + mv.az * mv.z) / speed / 9, 0, 1) : 0
  crouch += braking * 0.06
  let stance = s.between ? STANCE.idle : STANCE.ready
  let reach = null
  const c = swing || s.prep
  let lungeLean = 0
  let lowLean = 0
  if (c && !s.between) {
    crouch += CROUCH[c.kind] ?? 0.04
    const lc = toLocal(ground, fr, V(c.x, 0, c.z))
    const near = swing ? 1 : clamp(1 - (s.prep.ttc - 0.05) / (c.y < 0.6 ? 0.45 : 0.3), 0, 1) // (down early for a low ball)
    // low balls: get down to them (knees, and a bend at the waist)
    if (c.y < 0.6) crouch += (0.6 - c.y) * 0.55
    lowLean = clamp((0.65 - c.y) * 0.6, 0, 0.36) * Math.max(near, 0.4)
    // wide balls: step out with the near foot and lean in
    const wide = Math.abs(lc.x) - 0.62
    if (wide > 0 && near > 0) {
      crouch += Math.min(0.22, wide * 0.4) * near
      lungeLean = Math.sign(lc.x) * Math.min(0.35, wide * 0.6) * near
      const foot = lc.x > 0 ? 1 : 0
      const spot = toWorld(ground, fr, V(clamp(lc.x * 0.72, -0.5, 0.5), 0, clamp(lc.z * 0.6 - 0.1, -0.35, 0.45)))
      reach = { foot, x: spot.x, z: spot.z }
      stance = STANCE.wide
    } else if (Math.abs(lc.z) > 0.55) stance = STANCE.wide
  }
  if (s.holding) crouch = 0.04
  if (s.charging) crouch += 0.03
  crouch += a.extraCrouch // (the stroke's own knee bend, last frame's)
  // split step: up on the toes, then landing lower (the feet hop too when they're still)
  let hopY = 0
  if (a.hopNow) {
    a.hopNow = false
    hopGait(a.gait)
  }
  if (a.hop > 0) {
    const u = 1 - a.hop / 0.32
    hopY = u < 0.45 ? Math.sin((u / 0.45) * Math.PI) * 0.05 : -Math.sin(((u - 0.45) / 0.55) * Math.PI) * 0.045
    stance = STANCE.wide
  }
  // moods
  const mood = a.mood && s.between ? a.mood : null
  if (mood?.kind === "sulk" && mood.variant === 1) crouch = 0.2 // hands on knees
  if (mood?.kind === "cheer" && mood.variant === 2) hopY += Math.max(0, Math.sin(mood.t * 9)) * 0.08 * (mood.t < 0.8 ? 1 : 0)

  // standing still: weight shifts slowly from foot to foot; ready at the net, a light bounce
  const still = 1 - clamp(speed / 0.5, 0, 1)
  const sway = s.between ? Math.sin(a.t * 0.9) * 0.012 * still : Math.sin(a.t * 1.6) * 0.022 * still
  const bob = s.between ? 0 : (0.5 - 0.5 * Math.cos(a.t * 2 * Math.PI * 1.3)) * 0.008 * still
  const crouchS = springN(a.crouch, crouch, 10, dt)

  updateGait(a.gait, { x: s.x, z: s.z, vx: mv.x, vz: mv.z, yaw: a.yaw, stance, reach, minHip: 0.93 - crouchS - 0.1, crossover: fc.mode !== "face" }, dt)
  const feet = a.gait.feet

  // ---- the upper body: layers ----
  // Worked out for a right-hander in the body frame (x right, y up, z forward) and mirrored
  // for a left-hander. Layers, each with a weight that fades in and out: the ready position
  // (or relaxed between points), the run's arm swing (off on the paddle arm while it holds
  // ready), the serve's hold, a stroke (strokes.js), a mood. The legs (above) never see them.
  // Poses are made for a standard posture (shoulders 1.3 m up and 0.1 m ahead of the feet)
  // and moved with the real one (ofs: a deep crouch, a bend at the waist, a reach), so the
  // hands keep their place relative to the shoulders; the contact point stays where it is.
  const hand = s.hand ?? 1 // +1: holds the paddle in the right hand
  const RH = (l) => V(l.x * hand, l.y, l.z) // body frame <-> right-handed (its own inverse)
  const local = (p) => toLocal(ground, fr, V(p.x, p.y, p.z))
  const W = a.w
  const sh = 1.3 // (the standard shoulders' height)
  const lean0 = a.lean.p ?? 0.2
  const sft = a.shift.p ? toLocal(V(0, 0, 0), fr, a.shift.p) : V()
  const ofs = V(sft.x, 0.935 - crouchS + sft.y + 0.455 * Math.cos(lean0) - sh, sft.z + 0.455 * Math.sin(lean0) - 0.1)
  const toStd = (l) => RH(sub(l, ofs)) // a body-frame point -> the standard, right-handed pose
  let normalT = null
  // forward from the hips: more into a run, and into the acceleration (back on a hard stop)
  const running = bl.run + bl.sprint + bl.walk * 0.3
  let leanT = (s.between ? 0.04 : 0.2) + Math.min(0.16, speed * 0.04) * running + clamp(accF * 0.018, -0.14, 0.14)
  const rollT = clamp(accR * 0.016, -0.12, 0.12) * (1 - running * 0.5)
  let lookAt = s.ball

  // the ready position: the paddle up in front of the chest, elbows bent, the other hand by
  // the paddle's throat (a little higher at the kitchen line); between points, relaxed
  const net = s.atNet && !s.between ? 1 : 0
  const ready = { hand: V(0.15, 1.09 + net * 0.05, 0.48), axis: norm(V(0.14, 0.62 + net * 0.1, 0.72)), coil: 0, off: V(0.07, 1.1 + net * 0.05, 0.52), pole: V(0.6, -1, -0.15), lean: 0, crouch: 0, sh }
  const relaxed = { hand: V(0.25, 0.84, 0.13), axis: norm(V(0.05, -0.95, 0.25)), coil: 0, off: V(-0.23, 0.82, 0.08), pole: V(0.3, -1, -0.4), lean: 0, crouch: 0, sh }
  W.relax = ramp(W.relax, s.between && !mood ? 1 : 0, dt, 0.45, 0.2)
  let pose = mixPose(ready, relaxed, smoothW(W.relax))

  // the run's arm swing: the arms against the legs (the right arm forward as the left foot
  // lands: the step clock's 0). The other arm swings fully; the paddle arm swings only on a
  // long run between shots (turned to run), less, and not at all while it holds ready
  // (shuffles, backpedals, a ball on the way) or swings
  const ph = a.gait.phase
  const cph = Math.cos(ph)
  const pump = (bl.run + bl.sprint) * clamp((speed - 1.0) / 2, 0, 1) + bl.walk * 0.45 * clamp(speed / 1.2, 0, 1)
  const incoming = !!(s.prep || swing || whiff || s.holding || s.charging)
  const holdReady = s.between ? 0 : incoming || fc.mode === "face" ? 1 : 0.55
  W.pumpP = ramp(W.pumpP, pump * (1 - holdReady), dt, 0.3, 0.12)
  W.pumpO = ramp(W.pumpO, s.holding ? 0 : pump * (fc.mode === "face" && !s.between ? 0.3 : 1), dt, 0.25, 0.2)
  const amp = 0.55 + 0.45 * clamp(pump, 0, 1)
  if (W.pumpP > 1e-3) {
    const at = lerpV(V(0.22, 0.96, 0.2), relaxed.hand, smoothW(W.relax))
    const swingP = { ...pose, hand: add(at, V(0, Math.max(0, cph) * 0.08 * amp, cph * 0.22 * amp)), axis: norm(lerpV(V(0.15, 0.5, 0.85), relaxed.axis, smoothW(W.relax))), pole: V(0.35, -0.6, -1) }
    pose = { ...mixPose(pose, swingP, smoothW(Math.min(1, W.pumpP * 1.5))), off: pose.off }
  }
  if (W.pumpO > 1e-3) {
    const at = lerpV(V(-0.21, 0.94, 0.12), relaxed.off, smoothW(W.relax))
    const off = add(at, V(0, Math.max(0, -cph) * (0.14 - 0.07 * W.relax) * amp, -cph * 0.3 * amp))
    pose = { ...pose, off: lerpV(pose.off, off, smoothW(Math.min(1, W.pumpO * 1.5))) }
  }
  // the shoulders turn against the hips with the stride
  const runTwist = cph * 0.16 * Math.min(1, pump) * Math.max(W.pumpO, W.pumpP, 0.35)

  // waiting to serve: the ball in the other hand out in front, the paddle back and low
  W.hold = ramp(W.hold, s.holding ? 1 : 0, dt, 0.25, 0.2)
  if (W.hold > 1e-3) {
    const held = { hand: V(0.34, 0.84, -0.18), axis: norm(V(0.2, -0.8, -0.5)), coil: 0.25, off: s.holding ? toStd(local(s.ball)) : V(0.12, 0.96, 0.46), pole: V(0.4, -1, -0.4), lean: -0.08, crouch: 0 }
    pose = mixPose(pose, held, smoothW(W.hold))
  }

  // ---- a stroke (strokes.js): wind-up, the forward swing through the contact, follow-through ----
  let inp = null
  // (a new ball on its way beats the end of the last swing: quick exchanges at the net)
  if (swing && !(s.prep && swing.t > 0.1)) inp = { key: "s" + (swing.id ?? `${swing.kind}${swing.x?.toFixed(3)}${swing.z?.toFixed(3)}`), kind: swing.kind, c: toStd(local(swing)), tRel: swing.t, after: true, forward: true }
  else if (whiff && !s.prep) inp = { key: "w" + whiff.kind + whiff.y.toFixed(3), kind: "block", c: V(0.32, clamp(whiff.y, 0.7, 1.5), 0.58), tRel: whiff.t, after: true, forward: true }
  else if (s.prep) {
    const p = s.prep
    inp = { key: "p" + (p.id ?? 0), kind: p.kind, c: toStd(local(p)), tRel: -p.ttc, after: false, forward: !!p.forward && !s.charging, volley: !!p.volley }
  }
  const so = stepStroke(a.stroke, inp, pose, dt)
  if (so.w > 0) pose = so.pose
  // eyes on the contact point until just after the hit, then on the ball
  if (so.phase !== "none" && inp && !inp.after && s.prep) lookAt = V(s.prep.x, s.prep.y, s.prep.z)
  else if (so.phase !== "none" && swing && swing.t < 0.15) lookAt = V(swing.x, swing.y, swing.z)
  if (swing && swing.t < 0.05 && swing.n) normalT = swing.n
  a.extraCrouch = so.w > 0 ? (so.pose.crouch || 0) * so.w : 0

  // ---- moods: celebrating or sulking after a point ----
  W.mood = ramp(W.mood, mood ? 1 : 0, dt, 0.18, 0.3)
  if (mood) {
    const v = mood.variant
    const pumpUp = Math.sin(mood.t * 10) * 0.5 + 0.5
    let mp
    if (mood.kind === "cheer") {
      if (v === 0) mp = { hand: V(0.3, 0.94, 0.2), axis: norm(V(0.1, 0.9, 0.2)), off: V(-0.2, 1.12 + pumpUp * 0.3, 0.34), pole: V(0.4, -1, -0.3), offPole: V(-0.35, -1, 0.15) } // a fist pump (elbow down)
      else if (v === 1) mp = { hand: V(0.22, 1.85, 0.18), axis: norm(V(0, 1, 0.1)), off: V(-0.28, 1.16 + pumpUp * 0.14, 0.32), pole: V(1, -0.2, 0) } // the paddle in the air
      else mp = { hand: V(0.22, 1.82, 0.16), axis: norm(V(0, 1, 0.1)), off: V(-0.25, 1.8, 0.16), pole: V(1, -0.2, 0) } // both arms up
      lookAt = add(add(ground, V(0, 1.8, 0)), mul(fr.f, 3))
    } else if (v === 0) {
      // hands on the hips (where the hips are, whatever the posture), head down
      mp = { hand: toStd(V(0.25, 0.98, -0.02)), axis: norm(V(0.3, -0.6, -0.7)), off: toStd(V(-0.25, 0.98, -0.02)), pole: V(1, -0.3, -0.2) }
      lookAt = add(ground, mul(fr.f, 1.2))
    } else if (v === 1) {
      mp = { hand: toStd(V(0.13, 0.62, 0.3)), axis: norm(V(0.3, -0.9, 0.2)), off: toStd(V(-0.13, 0.62, 0.3)), pole: V(0.6, -0.3, -1) } // hands on the knees
      leanT = 0.7
      lookAt = add(ground, mul(fr.f, 0.8))
    } else {
      mp = { hand: V(0.3, 0.82, 0.13), axis: norm(V(0.1, -1, 0.1)), off: V(-0.12, 1.62, 0.22), pole: V(0.3, -1, -0.3) } // looking up at the sky
      lookAt = add(add(ground, V(0, 4, 0)), mul(fr.f, 1))
    }
    a.moodPose = { ...mp, coil: 0, lean: 0, crouch: 0 }
  }
  if (W.mood > 1e-3 && a.moodPose) pose = mixPose(pose, a.moodPose, smoothW(W.mood))

  // (tests: the point the stroke is aiming at)
  const aimAt = inp ? (inp.after ? swing : s.prep) : null

  // ---- back to the body frame ----
  const handT = add(RH(pose.hand), ofs)
  const axisT = RH(pose.axis)
  const offT = add(RH(pose.off), ofs)
  const poleT = RH(pose.pole)
  const twistT = -pose.coil * hand + runTwist
  leanT += (pose.lean || 0) + lowLean
  // how quickly the hands may move: a swing is fast, everything else smooth
  const fast = so.fast
  const k = so.w > 0.02 ? (fast ? 200 : 45) : 22

  // ---- the pelvis: as high as the stance wants, low enough that both legs reach ----
  // (the steps' own rise and fall, from the gait)
  let py = 0.935 - crouchS + bob + a.gait.bob + hopY
  // reaching: if the paddle hand can't get to where the stroke wants it, the whole upper
  // body goes toward it (a step in, a bend at the knees), as far as the legs allow
  const want = toWorld(ground, fr, handT)
  const shR = toWorld(ground, fr, V(hand * BODY.shoulderHalf, 0.935 - crouchS + BODY.spine - 0.05, 0.08))
  const gap = sub(want, shR)
  const over = len(gap) - ARM * 0.96
  let shiftT = V()
  // (only around contact: a backswing or a ready pose never drags the body down)
  const reaching = (swing && swing.t < 0.3) || (s.prep && s.prep.forward && s.prep.ttc < 0.35)
  if (over > 0 && !s.between && reaching) {
    const d = norm(gap)
    shiftT = V(clamp(d.x * over, -0.38, 0.38), clamp(d.y * over, -0.34, 0.04), clamp(d.z * over, -0.38, 0.38))
  }
  const shift = springV(a.shift, shiftT, k >= 200 ? 30 : 14, dt)
  py += shift.y
  const side = sway * 1.2 + a.gait.sway
  const pelvisXZ = V(s.x + fr.r.x * side + shift.x, 0, s.z + fr.r.z * side + shift.z)
  // ...but never so far that a planted foot comes off the court
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 2; i++) {
      const f = feet[i]
      if (f.step) continue
      const side = i ? 1 : -1
      const hx = pelvisXZ.x + fr.r.x * side * BODY.hipHalf - f.x
      const hz = pelvisXZ.z + fr.r.z * side * BODY.hipHalf - f.z
      const h = Math.hypot(hx, hz)
      if (h > 0.66) {
        pelvisXZ.x -= (hx / h) * (h - 0.66)
        pelvisXZ.z -= (hz / h) * (h - 0.66)
      }
    }
  }
  for (let i = 0; i < 2; i++) {
    const side = i ? 1 : -1
    const hip = V(pelvisXZ.x + fr.r.x * side * BODY.hipHalf, 0, pelvisXZ.z + fr.r.z * side * BODY.hipHalf)
    const f = feet[i]
    const h = Math.hypot(f.x - hip.x, f.z - hip.z)
    const ay = f.y + BODY.ankle
    const maxY = ay + Math.sqrt(Math.max(0.01, (LEG * 0.985) ** 2 - h * h))
    if (!f.step && py > maxY) py = maxY // hips can't float above a planted foot
  }
  py = Math.max(py, 0.55)
  if (a.pelvisY === undefined || dt <= 0) a.pelvisY = py
  // fast down (the legs must reach), gentler up
  a.pelvisY = py < a.pelvisY ? py : a.pelvisY + (py - a.pelvisY) * (1 - Math.exp(-dt * 14))
  const pelvis = V(pelvisXZ.x, a.pelvisY, pelvisXZ.z)

  // ---- springs: smooth everything that isn't a hard swing ----
  // (the hips turn quicker than the shoulders: in a swing the hips lead, the shoulders
  // follow, then the arm)
  const twist = springN(a.twist, twistT, fast ? 40 : 14, dt)
  const hipTwist = springN(a.hipTwist, twistT * 0.4, fast ? 70 : 18, dt)
  const lean = springN(a.lean, leanT + Math.abs(lungeLean) * 0.4, 8, dt)
  const roll = springN(a.roll, lungeLean + rollT, 8, dt)

  // ---- the spine ----
  // the hips turn a little with the shoulders, and swivel with the stride (the leg going
  // forward takes its hip with it)
  const swivel = -Math.cos(ph) * 0.12 * pump
  const pfr = frame(a.yaw + hipTwist + swivel)
  const cfr = frame(a.yaw + twist) // the shoulders turn all the way
  const spineDir = norm(add(add(mul(UP, Math.cos(lean)), mul(fr.f, Math.sin(lean))), mul(fr.r, Math.sin(roll))))
  const neck = add(pelvis, mul(spineDir, BODY.spine))
  // shoulders: square to the chest's frame, perpendicular to the spine
  let sr = sub(cfr.r, mul(spineDir, dot(cfr.r, spineDir)))
  sr = norm(sr, cfr.r)
  const shoulderR = add(sub(neck, mul(spineDir, 0.045)), mul(sr, BODY.shoulderHalf))
  const shoulderL = add(sub(neck, mul(spineDir, 0.045)), mul(sr, -BODY.shoulderHalf))
  const chestF = norm(cross(spineDir, sr), fr.f)
  const hipR = add(pelvis, mul(pfr.r, BODY.hipHalf))
  const hipL = add(pelvis, mul(pfr.r, -BODY.hipHalf))

  // ---- legs ----
  const legs = [0, 1].map((i) => {
    const f = feet[i]
    const hip = i ? hipR : hipL
    let ankle = V(f.x, f.y + BODY.ankle, f.z)
    if (f.step) {
      // a foot in the air stays within the leg's reach (it lands where it was going)
      const dy = hip.y - ankle.y
      const hMax = Math.sqrt(Math.max(0, (LEG * 0.98) ** 2 - dy * dy))
      const hx = ankle.x - hip.x
      const hz = ankle.z - hip.z
      const h = Math.hypot(hx, hz)
      if (h > hMax) ankle = V(hip.x + (hx / h) * hMax, ankle.y, hip.z + (hz / h) * hMax)
    }
    const ff = frame(f.yaw)
    const pole = add(norm(add(ff.f, mul(ff.r, i ? 0.25 : -0.25))), V(0, 0.05, 0)) // knees bend forward, a bit out
    const ik = twoBone(hip, ankle, BODY.thigh, BODY.shin, pole)
    return { hip, knee: ik.mid, ankle: ik.end, foot: { x: ik.end.x, y: ik.end.y - BODY.ankle, z: ik.end.z, yaw: f.yaw, pitch: f.step ? Math.sin(Math.PI * f.step.t) * -0.35 : 0, planted: !f.step } }
  })

  // ---- arms ----
  // targets are in the body frame around the ground point; the hands are springs in that
  // frame so a turn carries them along, then the pop limiter: a hand moves at most so far a
  // frame (a forward swing really is that fast; nothing else is)
  let handL = springV(a.hand, handT, k, dt)
  let axisL = norm(springV(a.axis, axisT, fast ? 200 : Math.min(k, 60), dt))
  let offL = springV(a.off, offT, 16, dt)
  handL = a.handLim = limitStep(a.handLim, handL, (fast ? 16 : 7) * dt)
  axisL = a.axisLim = limitTurn(a.axisLim, axisL, (fast ? 40 : 12) * dt)
  offL = a.offLim = limitStep(a.offLim, offL, 6 * dt)
  const paddleSide = hand > 0 ? shoulderR : shoulderL
  const otherSide = hand > 0 ? shoulderL : shoulderR
  let handW = toWorld(ground, fr, handL)
  let offW = toWorld(ground, fr, offL)
  let axisW = norm(dirToWorld(fr, axisL))
  // the elbows point where the stroke says (in the chest's frame, so they turn with it)
  const chestDir = (l) => norm(add(add(mul(sr, l.x), mul(UP, l.y)), mul(chestF, l.z)))
  const poleP = chestDir(poleT)
  const offUp = clamp((offL.y - sh) / 0.3, 0, 1) // (an arm raised: the elbow goes out to the side)
  let poleO = chestDir(V(-hand * lerp(0.6, 1, offUp), lerp(-1, -0.15, offUp), lerp(lerp(-0.15, -1, W.pumpO), 0.1, offUp)))
  if (a.moodPose?.offPole && W.mood > 0) poleO = norm(lerpV(poleO, chestDir(RH(a.moodPose.offPole)), smoothW(W.mood)))
  // the hands and the paddle stay out of the torso and the thighs (except right at contact:
  // the ball is never inside anybody)
  const atContact = (swing && swing.t < 0.04) || (s.prep && s.prep.ttc < 0.04 && s.prep.forward)
  if (!atContact) {
    const keepOut = (q, rT, rL) => {
      let d = pushOut(q, pelvis, neck, rT)
      for (const leg of legs) {
        const e = pushOut(add(q, d), leg.hip, leg.knee, rL)
        d = add(d, e)
      }
      return d
    }
    const faceP = add(handW, mul(axisW, BODY.paddleReach))
    const midP = add(handW, mul(axisW, BODY.paddleReach * 0.5))
    let push = keepOut(handW, 0.15, 0.09)
    for (const q of [midP, faceP]) {
      const e = keepOut(add(q, push), 0.16, 0.1)
      push = add(push, e)
    }
    handW = add(handW, push)
    offW = add(offW, keepOut(offW, 0.14, 0.09))
  }
  // two-bone IK with the elbow's limits; the bend turns smoothly (no flips)
  const armP = armIK(a.ikP, paddleSide, handW, BODY.upperArm, BODY.forearm, poleP, { maxTurn: (fast ? 40 : 14) * dt })
  const armO = armIK(a.ikO, otherSide, offW, BODY.upperArm, BODY.forearm, poleO, { maxTurn: 12 * dt })
  // a ball just out of reach: the paddle reaches for it (pointed at where its face should be
  // from where the hand got to, so arm and paddle make one long lever)
  const short = len(sub(armP.end, handW))
  if (short > 0.005 && fast) {
    const faceT = add(handW, mul(axisW, BODY.paddleReach))
    axisW = norm(lerpV(axisW, norm(sub(faceT, armP.end), axisW), clamp(short / 0.08, 0, 1)), axisW)
  }
  // (the paddle turns no faster than a swing turns it)
  axisW = a.axisOut = limitTurn(a.axisOut, axisW, (fast ? 40 : 12) * dt)
  // the paddle face: square to where it's going (at contact, exactly the face the shot used)
  let normalW = normalT ? norm(normalT) : norm(cross(axisW, cross(fr.f, axisW)), fr.f)
  if (dot(normalW, fr.f) < 0 && !normalT) normalW = mul(normalW, -1)
  normalW = norm(sub(normalW, mul(axisW, dot(normalW, axisW))), fr.f)
  // (either face can hit: keep the side it had, so the face never swings through edge-on)
  if (a.normal.p && dot(normalW, a.normal.p) < 0) normalW = mul(normalW, -1)
  const springNormal = springV(a.normal, normalW, normalT ? 200 : 40, dt)
  normalW = norm(sub(springNormal, mul(axisW, dot(springNormal, axisW))), fr.f)

  // ---- the head looks at the ball: smoothly, within a neck's reach, at a top speed ----
  const headBase = add(neck, mul(spineDir, BODY.neck))
  const lookW = norm(sub(V(lookAt.x, lookAt.y, lookAt.z), headBase), chestF)
  const lookS = norm(springV(a.head, lookW, 14, dt), chestF)
  const head = lookToward(a.look, lookS, chestF, dt, { maxYaw: 1.25, maxUp: 0.6, maxDown: 0.75, rate: 8 })
  return {
    yaw: a.yaw,
    pelvis,
    pelvisRight: pfr.r,
    spine: spineDir,
    neck,
    chestRight: sr,
    chestForward: chestF,
    head: headBase,
    look: norm(head, chestF),
    shoulderL,
    shoulderR,
    hipL: legs[0].hip,
    hipR: legs[1].hip,
    kneeL: legs[0].knee,
    kneeR: legs[1].knee,
    ankleL: legs[0].ankle,
    ankleR: legs[1].ankle,
    footL: legs[0].foot,
    footR: legs[1].foot,
    paddleShoulder: paddleSide,
    elbowP: armP.mid,
    wristP: armP.end,
    elbowO: armO.mid,
    wristO: armO.end,
    // where the elbows point (smooth, even with an arm straight): the athletes' IK poles
    bendP: armP.bend,
    bendO: armO.bend,
    paddle: { grip: armP.end, axis: axisW, normal: normalW, face: add(armP.end, mul(axisW, BODY.paddleReach)) },
    hand,
    // for the skinned athletes' motion-capture layers (athlete.js)
    info: { speed, phase: a.gait.phase, cycle: a.gait.cycle, moving: a.gait.moving, blend: a.gait.blend.weights, timeScale: a.gait.blend.timeScale, facing: a.face.mode || "face", swinging: !!(swing || s.prep || whiff), between: !!s.between, mood: mood ? { kind: mood.kind, variant: mood.variant } : null, stroke: so.w, style: so.style, fast, ready: (1 - W.pumpP) * (1 - smoothW(W.relax)), offGrip: so.w < 0.5 && W.relax < 0.5 && W.pumpO < 0.3 && !mood && !s.holding, fist: mood?.kind === "cheer", strokePhase: so.phase, aim: aimAt ? { x: aimAt.x, y: aimAt.y, z: aimAt.z, ttc: -inp.tRel } : null },
  }
}

// What a player is doing, read from the match, for updateAnim. me: the match player; m: the
// match (or an online copy of it); predicted: the contact this player expects (or null)
export const situation = (m, p) => {
  const ball = m.ball
  const r = m.rally
  const team = p.team
  const facing = team === 0 ? Math.PI : 0
  const between = m.phase === "dead" || m.phase === "intro" || m.phase === "over"
  const holding = ball.held === p.id
  let prep = null
  const swing = p.swing && !p.swing.whiff && p.swing.t < 0.75 ? p.swing : p.swing?.whiff ? p.swing : null
  // the serve: once the ball is let go, the swing meets it as it drops to the contact height
  if (!holding && p.serving && r && r.hits === 0) {
    const vy = -ball.v.y
    const drop = Math.max(0, ball.p.y - SERVE_Y)
    const ttc = (Math.sqrt(Math.max(0, vy * vy + 2 * 9.81 * drop)) - vy) / 9.81
    prep = { ttc: Math.max(0, ttc), x: ball.p.x, y: SERVE_Y, z: ball.p.z, kind: "serve", hand: "fh", forward: true, id: "serve" }
  } else if (!between && p.expect && r && r.lastTeam !== team && (!swing || swing.t > 0.1)) {
    const human = p.ctrl === "human" || p.ctrl === "remote"
    const committed = !human || p.charge || p.armed
    let e = p.expect
    let ttc = e.at - m.t
    if (committed && ttc > -0.1 && ttc < 0.95 && !ball.held) {
      // where the paddle will really meet it: the ball's own flight and the match's reach rules
      // (the AI hits the first moment it can, not at its planned instant)
      const goal = p.target && p.ctrl === "cpu" ? p.target : p.intercept?.stand && !p.intercept.letGo ? p.intercept.stand : null
      const bounces = (r.bounces || 0) + (m.held?.length || 0)
      const pc = predictContact({ ball, x: p.x, z: p.z, vx: p.vx, vz: p.vz, goal, side: sideOf(team), bounces, needBounce: bounces === 0 && (!!p.armed?.waitBounce || r.hits < 3 || e.volley === false), lunge: !!p.armed?.lunge })
      if (pc && Math.abs(pc.t - ttc) < 0.45) {
        e = { ...pc, volley: pc.volley }
        ttc = pc.t
      }
    }
    if (ttc > -0.1 && ttc < 0.65 && committed) {
      const local = (e.x - p.x) * (team === 0 ? 1 : -1)
      // a person's swing shape from how long they've held the hit control (the pace)
      const pace = p.armed?.pace ?? (p.charge ? Math.max(0, Math.min(1, (m.t - p.charge.start - 0.05) / 0.42)) : null)
      const kind = pace !== null ? guessKind(pace, e, p) : e.y > 1.35 && Math.abs(p.z) < 5 ? "smash" : Math.abs(p.z) < 3.4 ? (e.volley ? "punch" : "dink") : e.volley ? "block" : "drive"
      prep = { ttc, x: e.x, y: e.y, z: e.z, kind, hand: local >= -0.05 ? "fh" : "bh", forward: !human || !!p.armed, volley: !!e.volley, id: r.hits }
    }
  }
  if (p.charge?.kind === "serve") prep = null
  return {
    x: p.x,
    z: p.z,
    vx: p.vx,
    vz: p.vz,
    facing,
    ball: { x: ball.p.x, y: ball.p.y, z: ball.p.z },
    holding,
    swing,
    prep,
    charging: !!p.charge,
    between,
    atNet: Math.abs(p.z) < 3.4,
    // where they're heading (a computer player's spot, or the stand-in's intercept)
    goal: p.target && (between || p.ctrl === "cpu") ? { x: p.target.x, z: p.target.z } : p.intercept?.stand && !p.intercept.letGo ? { x: p.intercept.stand.x, z: p.intercept.stand.z } : null,
  }
}

const guessKind = (pace, e, p) => {
  if (pace < 0.36) return e.volley ? "block" : Math.abs(p.z) < 3.4 ? "dink" : "drop"
  if (e.y > 1.3) return "smash"
  if (e.volley) return "punch"
  return "drive"
}

// segment lengths of a pose (for tests: the skeleton never stretches)
export const boneLengths = (pose) => ({
  thighL: len(sub(pose.kneeL, pose.hipL)),
  shinL: len(sub(pose.ankleL, pose.kneeL)),
  thighR: len(sub(pose.kneeR, pose.hipR)),
  shinR: len(sub(pose.ankleR, pose.kneeR)),
  upperP: len(sub(pose.elbowP, pose.paddleShoulder)),
  foreP: len(sub(pose.wristP, pose.elbowP)),
})

// The umpire, sitting in the chair: seat { x, y, z, yaw }, looking at the ball. signal: "out"
// (an arm straight out to the side) or "fault" (an arm up), or null.
export const seatedPose = (seat, lookAt, signal = null) => {
  const fr = frame(seat.yaw)
  const o = V(seat.x, 0, seat.z)
  const pelvis = V(seat.x, seat.y + 0.1, seat.z)
  const spine = norm(add(UP, mul(fr.f, 0.12)))
  const neck = add(pelvis, mul(spine, BODY.spine))
  const sr = fr.r
  const shoulderR = add(sub(neck, mul(spine, 0.045)), mul(sr, BODY.shoulderHalf))
  const shoulderL = add(sub(neck, mul(spine, 0.045)), mul(sr, -BODY.shoulderHalf))
  const hipR = add(pelvis, mul(sr, BODY.hipHalf))
  const hipL = add(pelvis, mul(sr, -BODY.hipHalf))
  // feet on the chair's footrest, knees forward
  const legs = [hipL, hipR].map((hip, i) => {
    const foot = toWorld(o, fr, V((i ? 1 : -1) * 0.14, seat.y - 0.72, 0.36))
    const ik = twoBone(hip, V(foot.x, foot.y + BODY.ankle, foot.z), BODY.thigh, BODY.shin, fr.f)
    return { knee: ik.mid, ankle: ik.end, foot: { x: ik.end.x, y: ik.end.y - BODY.ankle, z: ik.end.z, yaw: seat.yaw, pitch: 0, planted: true } }
  })
  const rest = (side) => toWorld(o, fr, V(side * 0.16, seat.y + 0.2, 0.3))
  let handR = rest(1)
  const handL = rest(-1)
  if (signal === "out") handR = add(shoulderR, mul(sr, ARM * 0.98))
  if (signal === "fault") handR = add(shoulderR, V(0, ARM * 0.98, 0))
  const pole = (side) => norm(add(V(0, -1, 0), mul(sr, side * 0.5)))
  const armR = twoBone(shoulderR, handR, BODY.upperArm, BODY.forearm, pole(1))
  const armL = twoBone(shoulderL, handL, BODY.upperArm, BODY.forearm, pole(-1))
  const head = add(neck, mul(spine, BODY.neck))
  let look = norm(sub(V(lookAt.x, lookAt.y, lookAt.z), head), fr.f)
  look = norm(V(look.x, clamp(look.y, -0.6, 0.4), look.z))
  if (dot(look, fr.f) < 0) look = fr.f
  const axis = norm(add(mul(fr.f, 0.6), V(0, -0.8, 0)))
  return {
    yaw: seat.yaw,
    pelvis,
    pelvisRight: sr,
    spine,
    neck,
    chestRight: sr,
    chestForward: fr.f,
    head,
    look,
    shoulderL,
    shoulderR,
    hipL,
    hipR,
    kneeL: legs[0].knee,
    kneeR: legs[1].knee,
    ankleL: legs[0].ankle,
    ankleR: legs[1].ankle,
    footL: legs[0].foot,
    footR: legs[1].foot,
    paddleShoulder: shoulderR,
    elbowP: armR.mid,
    wristP: armR.end,
    elbowO: armL.mid,
    wristO: armL.end,
    paddle: { grip: armR.end, axis, normal: fr.f, face: armR.end },
    hand: 1,
  }
}
