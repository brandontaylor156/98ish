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

// ---- strokes ----
// Paddle-hand keyframes in the body frame (x right, y up, z forward), for a right-hander's
// forehand; the backhand mirrors x. axis: where the paddle points from the hand.
const STROKES = {
  drive: { back: [0.58, 0.05, -0.38], backAxis: [0.25, 0.25, -0.95], twist: 0.75, follow: [-0.32, 1.45, 0.3], followAxis: [-0.55, 0.65, -0.3], followTwist: -0.65, crouch: 0.04 },
  return: { back: [0.55, 0.05, -0.35], backAxis: [0.25, 0.25, -0.95], twist: 0.7, follow: [-0.3, 1.4, 0.3], followAxis: [-0.55, 0.65, -0.3], followTwist: -0.6, crouch: 0.04 },
  slice: { back: [0.55, 0.38, -0.3], backAxis: [0.35, 0.55, -0.75], twist: 0.6, follow: [-0.08, 0.92, 0.58], followAxis: [-0.25, 0.05, 1], followTwist: -0.25, crouch: 0.03 },
  dink: { back: [0.36, 0.1, 0.06], backAxis: [0.3, -0.85, 0.3], twist: 0.18, follow: [0.12, 0.22, 0.3], followAxis: [0.15, -0.55, 0.85], followTwist: 0, crouch: 0.1, short: true },
  drop: { back: [0.45, -0.02, -0.15], backAxis: [0.3, -0.7, -0.5], twist: 0.35, follow: [0.1, 0.45, 0.35], followAxis: [0.1, 0.35, 0.95], followTwist: -0.1, crouch: 0.07, short: true },
  block: { back: [0.42, 0.04, 0.12], backAxis: [0.4, 0.35, 0.85], twist: 0.15, follow: [0.12, 0.06, 0.28], followAxis: [0.25, 0.3, 0.95], followTwist: 0, crouch: 0.06, short: true },
  punch: { back: [0.48, 0.1, 0.02], backAxis: [0.45, 0.45, -0.6], twist: 0.3, follow: [0.05, 0.02, 0.4], followAxis: [0.1, 0.35, 0.95], followTwist: -0.2, crouch: 0.04, short: true },
  lob: { back: [0.5, -0.15, -0.3], backAxis: [0.3, -0.7, -0.6], twist: 0.45, follow: [0.12, 1.75, 0.35], followAxis: [0.05, 0.95, 0.3], followTwist: -0.15, crouch: 0.07 },
  smash: { back: [0.32, 0.55, -0.32], backAxis: [0.15, 0.4, -0.9], twist: 0.6, follow: [-0.32, 0.72, 0.42], followAxis: [-0.3, -0.75, 0.6], followTwist: -0.75, crouch: 0.02, overhead: true },
  serve: { back: [0.38, 0.45, -0.55], backAxis: [0.25, -0.75, -0.6], twist: 0.45, follow: [0.06, 1.38, 0.55], followAxis: [0.0, 0.9, 0.45], followTwist: -0.2, crouch: 0.05, absolute: true },
}
// the touch shots borrow a stroke: a reset is a block, a speed-up or counter a punch, a roll
// a short brushed drop
STROKES.reset = STROKES.block
STROKES.speedup = STROKES.punch
STROKES.counter = STROKES.punch
STROKES.roll = STROKES.drop
const strokeOf = (kind) => STROKES[kind] || STROKES.drive
const A = (a, hand) => V(a[0] * hand, a[1], a[2])

// the paddle's direction from the hand at contact, for a ball at height y on that side
const contactAxis = (y, hand, overhead) => {
  if (overhead) return norm(V(0.1 * hand, 0.9, 0.3))
  if (y < 0.55) return norm(V(0.35 * hand, -0.85 + y * 0.6, 0.35))
  if (y > 1.35) return norm(V(0.45 * hand, 0.75, 0.25))
  return norm(V(0.95 * hand, (y - 0.95) * 0.9, 0.3))
}

// ---- the whole body ----

const READY = { hand: V(0.17, 1.06, 0.4), axis: norm(V(0.12, 0.85, 0.4)), off: V(-0.16, 1.03, 0.36) }
const RELAXED = { hand: V(0.27, 0.86, 0.06), axis: norm(V(0.05, -0.95, 0.2)), off: V(-0.24, 0.84, 0.0) }

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
  if (c && !s.between) {
    const st = strokeOf(c.kind)
    crouch += st.crouch
    const lc = toLocal(ground, fr, V(c.x, 0, c.z))
    // low balls: get down to them
    if (c.y < 0.55) crouch += (0.55 - c.y) * 0.45
    // wide balls: step out with the near foot and lean in
    const wide = Math.abs(lc.x) - 0.62
    const near = swing ? 1 : clamp(1 - (s.prep.ttc - 0.05) / 0.3, 0, 1)
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

  // ---- the paddle hand, the other hand, the torso twist ----
  const hand = s.hand ?? 1 // +1: holds the paddle in the right hand
  let handT = READY.hand
  let axisT = READY.axis
  let offT = READY.off
  let normalT = null
  let twistT = 0
  // forward from the hips: more into a run, and into the acceleration (back on a hard stop)
  const running = bl.run + bl.sprint + bl.walk * 0.3
  let leanT = (s.between ? 0.04 : 0.2) + Math.min(0.16, speed * 0.04) * running + clamp(accF * 0.018, -0.14, 0.14)
  let rollT = clamp(accR * 0.016, -0.12, 0.12) * (1 - running * 0.5)
  let k = 22
  let lookAt = s.ball
  if (s.atNet && !s.between) handT = V(0.16, 1.15, 0.42)
  if (s.between && !mood) {
    handT = RELAXED.hand
    axisT = RELAXED.axis
    offT = RELAXED.off
  }
  // arms swing against the legs when walking or running (the right arm forward as the left
  // foot lands: the step clock's 0); in a shuffle or backpedal the paddle stays up, ready
  const ph = a.gait.phase
  const pump = (bl.run + bl.sprint) * clamp((speed - 1.0) / 2, 0, 1) + bl.walk * 0.45 * clamp(speed / 1.2, 0, 1)
  if (pump > 0.02 && !swing && !s.prep && !s.holding && !mood) {
    const cph = Math.cos(ph)
    const amp = pump
    // (elbows bent, hands swinging past the hips: the off hand more, the paddle hand a bit less)
    const base = s.between ? RELAXED : { hand: V(0.23, 0.94, 0.14), off: V(-0.21, 0.95, 0.04), axis: norm(V(0.2, 0.6, 0.6)) }
    offT = lerpV(offT, V(base.off.x, base.off.y + Math.max(0, -cph) * 0.12 * amp, base.off.z - cph * 0.32 * amp), clamp(amp * 1.5, 0, 1))
    handT = lerpV(handT, V(base.hand.x, base.hand.y + Math.max(0, cph) * 0.08 * amp, base.hand.z + cph * 0.22 * amp), clamp(amp * 1.5, 0, 1))
    axisT = norm(lerpV(axisT, base.axis, clamp(amp * 1.5, 0, 1)))
    twistT = cph * 0.16 * amp
  }

  if (s.holding) {
    // waiting to serve: ball in the other hand out in front, paddle back and low
    offT = toLocal(ground, fr, V(s.ball.x, s.ball.y, s.ball.z))
    handT = V(0.34, 0.8, -0.26)
    axisT = norm(V(0.2, -0.8, -0.5))
    twistT = 0.25
    leanT = 0.12
  }

  const local = (p) => toLocal(ground, fr, V(p.x, p.y, p.z))
  if (swing) {
    // after contact: the follow-through, then back to ready
    const st = strokeOf(swing.kind)
    const h = swing.hand === "bh" ? -hand : hand
    const cl = local(swing)
    const cAxis = contactAxis(swing.y, h, st.overhead)
    const cHand = sub(cl, mul(cAxis, BODY.paddleReach))
    const u = swing.t
    const fin = st.short ? V(cl.x * 0.7 + st.follow[0] * h * 0.3, cl.y + st.follow[1], cl.z + st.follow[2]) : A(st.follow, h)
    if (u < 0.32) {
      const e = easeOut(u / (st.short ? 0.2 : 0.32))
      handT = lerpV(cHand, fin, e)
      axisT = norm(lerpV(cAxis, A(st.followAxis, h), e))
      twistT = lerp(0, st.followTwist * (swing.hand === "bh" ? -1 : 1), e)
      k = 200
    } else {
      const e = smooth((u - 0.32) / 0.43)
      handT = lerpV(fin, READY.hand, e)
      axisT = norm(lerpV(A(st.followAxis, h), READY.axis, e))
      twistT = lerp(st.followTwist * (swing.hand === "bh" ? -1 : 1), 0, e)
      k = 26
    }
    if (u < 0.05 && swing.n) normalT = swing.n
    leanT += st.overhead ? 0.15 : 0.08
    offT = swing.hand === "bh" ? V(-0.45 * hand, 1.0, -0.25) : V(-0.3 * hand, 1.02, 0.18)
    lookAt = V(swing.x, swing.y, swing.z)
    if (u > 0.15) lookAt = s.ball
  } else if (s.prep) {
    // the ball is coming: backswing, and from FWD seconds out, the forward swing
    const p = s.prep
    const st = strokeOf(p.kind)
    const h = p.hand === "bh" ? -hand : hand
    const cl = local(p)
    const back = st.absolute ? A(st.back, h) : V(st.back[0] * h + (st.short ? cl.x * 0.4 : 0), (st.overhead ? 1.45 : Math.max(0.42, cl.y)) + st.back[1], st.back[2] + (st.short ? cl.z * 0.3 : 0))
    const bAxis = norm(A(st.backAxis, h))
    const cAxis = contactAxis(p.y, h, st.overhead)
    const cHand = sub(cl, mul(cAxis, BODY.paddleReach))
    const FWD = st.short ? 0.09 : 0.13
    const twist = st.twist * (p.hand === "bh" ? -1 : 1)
    if (p.forward && p.ttc < FWD) {
      const e = 1 - clamp(p.ttc / FWD, 0, 1)
      const ee = e * e
      handT = lerpV(back, cHand, ee)
      axisT = norm(lerpV(bAxis, cAxis, ee))
      twistT = lerp(twist, 0, e)
      k = 200
    } else {
      const ready = s.charging || !p.forward ? 1 : smooth((0.62 - p.ttc) / 0.32)
      handT = lerpV(READY.hand, back, ready)
      axisT = norm(lerpV(READY.axis, bAxis, ready))
      twistT = twist * ready
      k = 18
    }
    // the other hand: out front for balance on a forehand, on the paddle's throat for a backhand
    if (p.hand === "bh") offT = add(handT, mul(axisT, 0.08))
    else offT = V(-0.32 * hand, 1.08, 0.42)
    lookAt = V(p.x, p.y, p.z)
  } else if (whiff) {
    const e = easeOut(whiff.t / 0.3)
    handT = lerpV(V(0.5, 0.9, -0.3), V(-0.2, 1.2, 0.45), e)
    axisT = norm(V(0.3 - e, 0.4, 0.4))
    twistT = lerp(0.5, -0.4, e)
    k = 60
  }

  if (mood) {
    const v = mood.variant
    if (mood.kind === "cheer") {
      const pump = Math.sin(mood.t * 10) * 0.5 + 0.5
      if (v === 0) {
        offT = V(-0.25, 1.35 + pump * 0.25, 0.25) // fist pump
        handT = V(0.32, 0.95, 0.12)
        axisT = norm(V(0.1, 0.9, 0.2))
      } else {
        handT = V(0.2, 1.95, 0.1) // paddle in the air
        axisT = norm(V(0, 1, 0.1))
        offT = v === 2 ? V(-0.25, 1.9, 0.1) : V(-0.28, 1.2 + pump * 0.15, 0.25)
      }
      lookAt = add(ground, V(0, 1.8, 0))
      lookAt = add(lookAt, mul(fr.f, 3))
    } else {
      if (v === 0) {
        // hands on hips, head down
        handT = V(0.24, 0.98, -0.02)
        axisT = norm(V(0.3, -0.6, -0.7))
        offT = V(-0.24, 0.98, -0.02)
        lookAt = add(ground, mul(fr.f, 1.2))
      } else if (v === 1) {
        // hands on knees
        handT = V(0.12, 0.62, 0.3)
        axisT = norm(V(0.3, -0.9, 0.2))
        offT = V(-0.12, 0.62, 0.3)
        leanT = 0.7
        lookAt = add(ground, mul(fr.f, 0.8))
      } else {
        // looking up at the sky
        handT = V(0.3, 0.82, 0.05)
        axisT = norm(V(0.1, -1, 0.1))
        offT = V(-0.12, 1.65, 0.12)
        lookAt = add(add(ground, V(0, 4, 0)), mul(fr.f, 1))
      }
    }
  }

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
  const reaching = (swing && swing.t < 0.3) || (s.prep && s.prep.forward && s.prep.ttc < 0.3)
  if (over > 0 && !s.between && reaching) {
    const d = norm(gap)
    shiftT = V(clamp(d.x * over, -0.32, 0.32), clamp(d.y * over, -0.3, 0), clamp(d.z * over, -0.32, 0.32))
  }
  const shift = springV(a.shift, shiftT, k >= 200 ? 24 : 12, dt)
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
  const twist = springN(a.twist, twistT, swing && swing.t < 0.32 ? 30 : 12, dt)
  const lean = springN(a.lean, leanT + Math.abs(lungeLean) * 0.4, 8, dt)
  const roll = springN(a.roll, lungeLean + rollT, 8, dt)

  // ---- the spine ----
  // the hips turn a little with the shoulders, and swivel with the stride (the leg going
  // forward takes its hip with it)
  const swivel = -Math.cos(ph) * 0.12 * pump
  const pfr = frame(a.yaw + twist * 0.35 + swivel)
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
  // frame so a turn carries them along
  const handL = springV(a.hand, handT, k, dt)
  const axisL = norm(springV(a.axis, axisT, Math.min(k, 60), dt))
  const offL = springV(a.off, offT, 16, dt)
  const paddleSide = hand > 0 ? shoulderR : shoulderL
  const otherSide = hand > 0 ? shoulderL : shoulderR
  const handW = toWorld(ground, fr, handL)
  const offW = toWorld(ground, fr, offL)
  const elbowPole = (sh, target, side) => norm(add(add(mul(UP, -1), mul(chestF, -0.35)), mul(sr, side * 0.6)))
  const armP = twoBone(paddleSide, handW, BODY.upperArm, BODY.forearm, elbowPole(paddleSide, handW, hand))
  const armO = twoBone(otherSide, offW, BODY.upperArm, BODY.forearm, elbowPole(otherSide, offW, -hand))
  let axisW = norm(dirToWorld(fr, axisL))
  // the paddle face: square to where it's going (at contact, exactly the face the shot used)
  let normalW = normalT ? norm(normalT) : norm(cross(axisW, cross(fr.f, axisW)), fr.f)
  if (dot(normalW, fr.f) < 0 && !normalT) normalW = mul(normalW, -1)
  normalW = norm(sub(normalW, mul(axisW, dot(normalW, axisW))), fr.f)
  const springNormal = springV(a.normal, normalW, normalT ? 200 : 40, dt)
  normalW = norm(sub(springNormal, mul(axisW, dot(springNormal, axisW))), fr.f)

  // ---- the head looks at the ball (within reason) ----
  const headBase = add(neck, mul(spineDir, BODY.neck))
  const look = norm(sub(V(lookAt.x, lookAt.y, lookAt.z), headBase), chestF)
  let lookF = norm(V(look.x, clamp(look.y, -0.7, 0.6), look.z), chestF)
  // can't turn the head all the way round
  if (dot(V(lookF.x, 0, lookF.z), fr.f) < -0.2) lookF = norm(add(fr.f, V(0, look.y, 0)))
  const head = springV(a.head, lookF, 10, dt)

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
    paddle: { grip: armP.end, axis: axisW, normal: normalW, face: add(armP.end, mul(axisW, BODY.paddleReach)) },
    hand,
    // for the skinned athletes' motion-capture layers (athlete.js)
    info: { speed, phase: a.gait.phase, cycle: a.gait.cycle, moving: a.gait.moving, blend: a.gait.blend.weights, timeScale: a.gait.blend.timeScale, facing: a.face.mode || "face", swinging: !!(swing || s.prep || whiff), between: !!s.between, mood: mood ? { kind: mood.kind, variant: mood.variant } : null },
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
  // the serve: once the ball is tossed, the swing comes as it drops to the contact height
  if (!holding && p.serving && r && r.hits === 0) {
    const ttc = Math.max(0, (ball.p.y - 0.52) / Math.max(0.5, -ball.v.y + 1.2))
    prep = { ttc, x: ball.p.x, y: 0.52, z: ball.p.z, kind: "serve", hand: "fh", forward: true }
  } else if (!between && p.expect && r && r.lastTeam !== team && (!swing || swing.t > 0.3)) {
    const ttc = p.expect.at - m.t
    const human = p.ctrl === "human" || p.ctrl === "remote"
    const committed = !human || p.charge || p.armed
    if (ttc > -0.1 && ttc < 0.65 && committed) {
      const e = p.expect
      const local = (e.x - p.x) * (team === 0 ? 1 : -1)
      // a person's swing shape from how long they've held the hit control (the pace)
      const pace = p.armed?.pace ?? (p.charge ? Math.max(0, Math.min(1, (m.t - p.charge.start - 0.05) / 0.42)) : null)
      const kind = pace !== null ? guessKind(pace, e, p) : e.y > 1.35 && Math.abs(p.z) < 5 ? "smash" : Math.abs(p.z) < 3.4 ? (e.volley ? "punch" : "dink") : e.volley ? "block" : "drive"
      prep = { ttc, x: e.x, y: e.y, z: e.z, kind, hand: local >= -0.05 ? "fh" : "bh", forward: !human || !!p.armed }
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
