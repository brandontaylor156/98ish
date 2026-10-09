// Pickleball 98: how the players move. Pure JavaScript (no three.js): every frame this
// turns a player's state in the match (where they are, how fast they're going, the ball,
// their swing) into world positions for every joint of a simple skeleton, which rig.js
// draws. Node tests check that feet stay planted, legs and arms keep their lengths, and the
// paddle meets the ball.
//
// - Motion matching (mm/, the skinned athletes on Medium/High once the database is in): the
//   legs, hips and trunk are real motion capture (100STYLE, CMU) that follows the game's
//   movement: mm/drive.js runs the controller, pins the feet, solves the legs; this file then
//   layers the strokes, the ready position, moods and between-point acts (between.js) on top,
//   exactly as below. The captured arms swing on runs and hang between points. Without the
//   database (Low quality, loading, failure) everything below is procedural.
// - Feet: locomotion.js (a blend space of walk / run / sprint / shuffle / backpedal, a step
//   clock calibrated so stride x cadence = speed, feet locked to the court in stance, swing
//   paths from motion capture), and which way to face (turn and run, or shuffle facing the
//   net). Planted feet never move.
// - Legs and arms: two-bone inverse kinematics (hip-knee-ankle, shoulder-elbow-wrist).
// - The pelvis drops when the feet are wide (a lunge) so legs always reach the court.
// - The upper body is layered over the legs, each layer with a weight that fades in and out:
//   the ready position (paddle up in front of the chest, the other hand at its throat), the
//   run's arm swing (off on the paddle arm while it holds ready or swings), the serve's hold,
//   a stroke (strokes.js: which stroke for the ball, a wind-up, the forward swing reaching
//   the predicted contact point exactly when the ball does, the follow-through, recovery)
//   and a mood. The shoulders turn with the stroke and lead the arm; the hips lead them.
// - Arms: two-bone IK with joint limits and elbows that turn smoothly (upper.js); the hands
//   and paddle are kept out of the torso and thighs; a pop limiter caps how far anything
//   moves in a frame outside a swing. The head follows the ball within a neck's limits.
// - Moods: the ready stance (knees bent, weight shifting), the split step when the other
//   side hits, and celebrating or sulking after a point.
// - Pro movement (pro.js, docs/pickleball-movement.md): an athletic ready position (wider
//   feet, knees bent about 40 degrees, hips back, chest over the knees, the paddle out in
//   front between the waist and the chest, tip toward the backhand side); a split step that
//   lands as the other side hits; small quick steps at the kitchen line, a crossover for a
//   wide ball, a lunge (front knee bent, back leg long) for a low wide one; stepping into
//   drives with the weight going forward; two-handed backhands for two-handed players.
// - Handedness: s.hand (+1 right, -1 left). Everything is worked out for a right-hander and
//   mirrored, so a left-hander's forehand is on their left, the two-handed backhand on their
//   right, the serve, the arm swing while running and the celebrations all from the left hand.

import { createGait, updateGait, facingFor, turnToward, hopGait } from "./locomotion.js"
import { ON_HANDLE, createStroke, mixPose, predictContact, stepStroke } from "./strokes.js"
import { armIK, limitStep, limitTurn, lookToward, pushOut, ramp, smoothW } from "./upper.js"
import { sideOf } from "./rules.js"
import { FAST_BALL } from "./shots.js"
import { CROSS, OVERHEAD_SET, READY, SPLIT, dropStep, isOverhead, landingSink, lungePlan, overheadLift, overheadTurn, quickSteps, readyFor, shouldSplit, splitHeight, stepIn, weightFor } from "./pro.js"
import { motionLibrary } from "./mm/runtime.js"
import { qaxis, qmul, qrot } from "./mm/quat.js"
import { driveMM } from "./mm/drive.js"
import { betweenActs } from "./between.js"
import { gestureArms } from "./mm/gesture.js"
import { createIdle, stepIdle } from "./idle.js"
import { createGaitArms, stepGaitArms } from "./gaitarms.js"
import { bodyCapsules, paddleDepth, resolvePaddle, rollPaddle, skipFor } from "./paddlebody.js"

// the paddle kept out of the body (paddlebody.js): how far clear (m)
export const GUARD = { margin: 0.02 }
// (around contact the paddle may roll about its face if the arm gets the hand within this of its
// new place: a ball low by the legs, the handle swung out of the thigh)
const ROLL_REACH = 0.006
// a rotation scaled toward none (f: how much of it is left)
const qscale = (q, f) => {
  const w = Math.max(-1, Math.min(1, q.w))
  const ang = 2 * Math.acos(Math.abs(w))
  const s = Math.sqrt(Math.max(0, 1 - w * w))
  if (ang < 1e-6 || s < 1e-9) return { x: 0, y: 0, z: 0, w: 1 }
  const sg = w < 0 ? -1 : 1
  return qaxis({ x: (q.x / s) * sg, y: (q.y / s) * sg, z: (q.z / s) * sg }, ang * f)
}
const guardCaps = []
const offCaps = []
const guardSkip = skipFor({})
const capsule = (a, b, ra, rb, part) => ({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, ra, rb, part })

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

const STANCE = { idle: READY.between.stance, wide: 0.04 } // (wide: added to the ready stance)
// the server's back foot (paddle side, body frame, right-handed): under the hip, a little back
const SERVE_BACK = { x: 0.07, z: -0.12 }
export { createGait, updateGait }

// ---- strokes: strokes.js (which stroke, when, and the arm's path through the contact) ----
// how much lower a stroke gets (knees), by the shot
const SERVE_Y = 0.52 // the serve's contact height (match.js SERVE_CONTACT_Y)
// (pros get low from the knees AND a hinge at the hips, not a deep squat: these are small)
// (PPA footage: at their own contact at the kitchen line pros' hips stay at ~87% of upright on
// a wide base: the dink is played from the wide stance and a hinge, with little extra knee)
const CROUCH = { drive: 0.03, return: 0.03, slice: 0.02, dink: 0.03, drop: 0.03, block: 0.02, reset: 0.035, punch: 0.02, speedup: 0.02, counter: 0.02, roll: 0.03, lob: 0.04, smash: 0.01, serve: 0.03 }
// (motion matching: a pinned foot settles anywhere within ~7 cm of where the capture has it, so
// the ready stance is asked a little wider to land at the tour's width: pro.js READY)
const MM_WIDE = 0.035
// the procedural feet on the move in a rally keep this share of the ready stance's width
// (locomotion.js body.athletic; motion matching has its own captured shuffles)
const ATHLETIC = 0.95
const MAX_CROUCH = 0.24 // (outside lunges: lower than this, the trunk bends instead)
// strokes played off the bounce from the back, which rise out of the ready crouch
// (a groundstroke from the back: the crouch it comes up to (m), and the share of a low
// ball's reach that the hinge takes over from the hips)
const GROUND_CROUCH = 0.03
const GROUND_HINGE = 0.4
const GROUND = new Set(["drive", "return", "slice", "drop", "lob", "reset", "roll"])

// ---- a ball at the body: making room ----
// Pros meet volleys and dinks out in front (30-50 cm) and to the side. A ball coming at the
// chest or hip can't be: real players lean back or away from it, turn the body out of its way,
// and (when there's time) take a small step back or aside, so the paddle can meet it with the
// face on the ball and the hand and handle outside the body. The torso is taken as an ellipse
// round its axis at the ball's height; a contact inside the room ellipse (side, front, back:
// the torso's own half width or depth plus a paddle's room) moves the body away from it by what's
// missing, up to `max`. A person's player only leans (the upper body; nothing moves their feet or
// where they stand); a computer player's hips take `cpu` of it too.
export const ROOM = { side: 0.36, front: 0.42, back: 0.3, max: 0.22, cpu: 0.5, lean: [-0.55, 0.25], roll: 0.4 }
const makeRoom = (body, c, hand, cpu) => {
  if (!body) return null
  const P = body.pelvis
  const up = sub(body.neck, P)
  const H = len(up)
  const t = clamp(((c.x - P.x) * up.x + (c.y - P.y) * up.y + (c.z - P.z) * up.z) / (H * H), -0.6, 1.25)
  // (only at the trunk's heights: the legs keep their own room, ai.js stands low balls off)
  const w = smooth((t + 0.45) / 0.3) * smooth((1.3 - t) / 0.15)
  if (w <= 0) return null
  const dx = c.x - (P.x + up.x * t)
  const dz = c.z - (P.z + up.z * t)
  const fl = Math.hypot(body.f.x, body.f.z) || 1
  const f = V(body.f.x / fl, 0, body.f.z / fl)
  const r = V(-f.z, 0, f.x) // (the chest's right, horizontal: frame()'s convention)
  const u = dx * r.x + dz * r.z
  const v = dx * f.x + dz * f.z
  const d = Math.hypot(u, v)
  // the direction from the axis to the ball (straight ahead if it's on the axis)
  const du = d > 1e-3 ? u / d : 0
  const dv = d > 1e-3 ? v / d : 1
  const B = dv >= 0 ? ROOM.front : ROOM.back
  const re = 1 / Math.hypot(du / ROOM.side, dv / B)
  const m = clamp(re - d, 0, ROOM.max) * w
  if (m <= 0.002) return null
  // the body moves away from the ball (world, horizontal), at the ball's height above the pelvis
  return { x: -(r.x * du + f.x * dv) * m, z: -(r.z * du + f.z * dv) * m, h: Math.max(0.25, t * H), cpu, m }
}

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
  splitAt: -9, // when the last split step started (a.t)
  extra: {}, // the hips: back in the ready position, over to a lunging foot, the weight shift
  weightT: 0,
  mood: null, // { kind, t, variant }
  swingId: null,
  t: 0,
  // the upper body: layer weights, the stroke, the pop limiter's last targets, the elbows'
  // bends, the head
  w: { relax: 0, pumpP: 0, pumpO: 0, hold: 0, mood: 0, two: 0, track: 0 },
  stroke: createStroke(),
  handLim: null,
  axisLim: null,
  axisOut: null,
  normalOut: null,
  offLim: null,
  ikP: {},
  ikO: {},
  look: {},
  extraCrouch: 0,
  moodPose: null,
  mmLean: {}, // (motion matching: a stroke's extra bend at the waist)
  idle: null, // (idle.js: weight shifts, the ready bounce, breathing)
  lifeW: {},
})

// The split step: a little hop that lands as the other side hits (anim.js starts it itself
// from s.oppHit; the engine also calls it at the other side's hit, as a fallback, which does
// nothing if one has just been done)
export const splitStep = (a, { fallback = false } = {}) => {
  if (fallback && (a.t - (a.splitAt ?? -9) < SPLIT.again || (a.vel && Math.hypot(a.vel.x, a.vel.z) > 2.2))) return false
  a.splitAt = a.t
  a.hop = SPLIT.dur
  a.hopNow = true
  return true
}
// After a point: winners celebrate, losers don't
// (keep: My Park's Together moods (holding hands, dancing, a selfie) stay until taken away)
export const setMood = (a, kind, variant = 0, keep = false) => {
  a.mood = { kind, t: 0, variant, keep }
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
//   hand: +1 right-handed, -1 left-handed; twoHand: a two-handed backhand player
//   oppHit: seconds until the other side hits (the split step lands then), or null
// Returns the pose: world positions of every joint and the paddle's frame.
export const updateAnim = (a, s, dt) => {
  a.t += dt
  const mv = motion(a, s, dt)
  const speed = Math.hypot(mv.x, mv.z)
  const swing = s.swing && !s.swing.whiff && s.swing.t < 0.75 ? s.swing : null
  const whiff = s.swing?.whiff && s.swing.t < 0.5 ? s.swing : null
  if (a.mood) a.mood.t += dt
  if (a.mood && !a.mood.keep && (a.mood.t > 2.6 || (!s.between && a.mood.t > 0.6))) a.mood = null
  // the split step: off the court just before the other side hits, landing as they do
  // (not mid-sprint: a player running hard to a ball just keeps running)
  if (!s.between && shouldSplit(s.oppHit, a.t - (a.splitAt ?? -9)) && Math.hypot(s.vx, s.vz) < 2.2) splitStep(a)
  if (a.hop > 0) a.hop -= dt
  const hand = s.hand ?? 1 // +1: holds the paddle in the right hand
  const proStyle = s.twoHand ? "twohand" : "allcourt"
  // (the ready position by where they stand: kitchen line, transition, baseline; pro.js)
  const R = readyFor(proStyle, typeof s.depth === "number" ? s.depth : !!s.atNet)

  // which way to face: square to the net and the ball while shuffling and backpedaling; turned
  // to run for a long, fast move (or walking between points); squared up again when a ball is
  // coming. The body turns with a top speed, never in a snap.
  // between points and after the game: taps, glances, fidgets (between.js)
  const bt = betweenActs(a.bt || (a.bt = {}), s, speed, a.t, dt)
  const fc = facingFor(a.face, { vx: mv.x, vz: mv.z, facing: s.facing, ball: s.ball, between: s.between, incoming: !!(swing || s.prep || s.holding || s.charging), goal: s.goal || null, x: s.x, z: s.z }, dt)
  let yaw = fc.yaw
  // (not the serve: its ball drops beside the front foot, and turning to it put it in front of
  // the legs, the swing through the thighs)
  if ((swing || s.prep) && (swing || s.prep).kind !== "serve") {
    // open up toward the contact
    const c = swing || s.prep
    const cy = Math.atan2(c.x - s.x, c.z - s.z)
    // (a ball met beside or behind them (a late one, a ball that got past): the body turns to
    // it, so the paddle doesn't reach back through the hips)
    const ang = wrap(cy - yaw)
    const behind = isOverhead(c.kind, c.y) ? 0 : smooth((Math.abs(ang) - 1.0) / 0.6) * (Math.hypot(c.x - s.x, c.z - s.z) > 0.15 ? 1 : 0)
    yaw = yaw + clamp(ang, -0.6, 0.6) * 0.35 + clamp(ang, -2.0, 2.0) * 0.4 * behind
  }
  // an overhead: sideways as soon as the high ball is read (pro.js OVERHEAD_SET), the paddle
  // side back, through square again with the smash
  const oh = s.prep && isOverhead(s.prep.kind, s.prep.y) ? { ...s.prep, tRel: -s.prep.ttc } : swing && isOverhead(swing.kind, swing.y) ? { ...swing, tRel: swing.t } : s.high && !swing ? { ...s.high, tRel: -s.high.ttc } : null
  // (the serve: square to the net, the ball dropped out beside the front foot; facingFor's turn
  // toward the ball put it in front of the legs)
  if (s.holding || (swing || s.prep)?.kind === "serve") yaw = s.facing
  const ohW = oh ? overheadTurn(oh.tRel) : 0
  if (ohW > 0) yaw += wrap(s.facing - hand * OVERHEAD_SET.turn - yaw) * ohW
  if (a.turn.yaw === undefined) a.turn.yaw = a.yaw
  // motion matching (mm/: the skinned athletes on Medium/High once the database is in): the
  // legs, hips and trunk come from motion capture that follows the game's movement; the
  // facing above is what it's asked for, and it turns as the captured body turns. (Last
  // frame's crouch and the split step's hop go on top.) Otherwise the procedural footwork.
  const mmLib = a.useMM ? motionLibrary() : null
  let mmo = null
  if (mmLib) {
    const hopPrev = (a.hop > 0 ? splitHeight(SPLIT.dur - a.hop) : 0) + (a.jumpY || 0)
    // (a stroke coming or under way: the body right at the game's position, so the paddle
    // meets the ball where the match says)
    const tight = swing && swing.t < 0.25 ? 1 : s.prep ? clamp(1 - (s.prep.ttc - 0.15) / 0.45, 0, 1) : 0
    mmo = driveMM(a, s, mv, dt, { lib: mmLib, yaw, crouch: a.crouch.p ?? 0, down: (a.mmDown || 0) + Math.max(0, -hopPrev), hopY: Math.max(0, hopPrev), every: a.mmEvery, stance: s.between ? READY.between.stance : R.stance + MM_WIDE, tight, reach: a.mmReach || null, shift: { x: (a.shift.p?.x || 0) + (a.mmLunge?.x || 0) + (a.roomPelvis?.x || 0), z: (a.shift.p?.z || 0) + (a.mmLunge?.z || 0) + (a.roomPelvis?.z || 0) } })
    a.yaw = mmo.yaw
    a.turn.yaw = a.yaw
    a.turn.w = 0
  } else {
    if (a.mm) a.mm = null // (back to the procedural footwork: the controller starts afresh next time)
    a.yaw = turnToward(a.turn, yaw, dt, { maxRate: fc.mode === "face" ? (speed > 1.5 ? 8 : 6) : 10, k: speed > 1.5 || swing ? 16 : 11 })
  }
  const fr = frame(a.yaw)
  const ground = V(s.x, 0, s.z)
  // the acceleration in the body's frame (lean into it)
  const accF = mv.ax * fr.f.x + mv.az * fr.f.z
  const accR = mv.ax * fr.r.x + mv.az * fr.r.z
  const bl = a.gait.blend?.weights || { walk: 0, run: 0, sprint: 0, shuffleL: 0, shuffleR: 0, back: 0 }
  const lateral = bl.shuffleL + bl.shuffleR + bl.back

  // ---- crouch, stance and the lunge ----
  // the ready position: knees bent and hips back (pro.js READY); a little lower at the kitchen
  let crouch = s.between ? READY.between.crouch : R.crouch
  // shuffles and backpedals stay low; a run lifts a little; a hard stop sinks into it
  // (pros run low: a lower pelvis also keeps the head level, the legs never at full stretch)
  if (!s.between) crouch += lateral * clamp(speed / 2.5, 0.6, 1.6) * 0.04 + (bl.run + bl.sprint) * 0.035
  const braking = speed > 0.6 ? clamp(-(mv.ax * mv.x + mv.az * mv.z) / speed / 9, 0, 1) : 0
  crouch += braking * 0.05
  let stance = s.between ? STANCE.idle : R.stance
  let reach = null
  const c = swing || s.prep
  let lungeLean = 0
  let lowLean = 0
  // (a groundstroke from the back: how far it comes up out of the crouch, 0..1)
  let groundUp = 0
  // the hips (body frame): back in the ready position, over a lunging foot, forward with the
  // weight through a drive
  const running01 = clamp(bl.run + bl.sprint + bl.walk * 0.5, 0, 1)
  const extraT = V(0, 0, s.between ? 0 : -R.back * (1 - running01))
  let lunging = false
  let roomT = null
  let roomW = 0
  if (c && !s.between) {
    const lc = toLocal(ground, fr, V(c.x, 0, c.z))
    // (down early for a low ball; back up through the follow-through)
    const near = swing ? clamp(1 - (swing.t - 0.12) / 0.4, 0, 1) : clamp(1 - (s.prep.ttc - 0.05) / (c.y < 0.6 ? 0.5 : 0.3), 0, 1)
    // the stroke's knee bend, and low balls: get down to them as they arrive (knees, and a
    // hinge at the hips; the arm reaches the rest)
    let down = ((CROUCH[c.kind] ?? 0.03) + Math.max(0, 0.6 - c.y) * 0.22) * smooth(Math.max(near, swing ? 0 : 0.25))
    // (a groundstroke from the back comes UP out of the ready crouch: the legs drive into it.
    // PPA footage: at their own contact baseline players' hips are at ~92% of upright vs ~85%
    // while waiting; at the kitchen they stay down on a wide base, ~87%)
    const depth = typeof s.depth === "number" ? s.depth : s.atNet ? 2.5 : 6
    // (an overhead: tall into it, out of the ready crouch, the legs pushing up into the jump)
    if (isOverhead(c.kind, c.y)) crouch -= R.crouch * near
    else if (GROUND.has(c.kind) && !c.volley) {
      groundUp = smooth(clamp((depth - 3.6) / 1.6, 0, 1)) * near
      crouch -= (R.crouch + (CROUCH[c.kind] ?? 0.03) + braking * 0.05) * 0.85 * groundUp
    }
    lowLean = clamp((0.75 - c.y) * 1.1, 0, 0.5) * near
    // a ball at the body: make room (see ROOM)
    roomT = makeRoom(a.lastBody, c, hand, s.person ? 0 : 1)
    roomW = smooth(swing ? 1 - (swing.t - 0.1) / 0.3 : 1 - (s.prep.ttc - 0.12) / 0.3)
    // wide or far, and low: the lunge (pro.js): the near foot steps out, that knee bends, the
    // back leg stays long, the hips go over toward the front foot
    // (not on an overhead: that one turns sideways and steps back, pro.js OVERHEAD_SET)
    const lp = near > 0 && !isOverhead(c.kind, c.y) ? lungePlan(lc, c.y) : null
    if (lp) {
      lunging = true
      // (down into the lunge once the front foot is down, not before: the back leg stays long)
      const ff = a.gait.feet[lp.foot]
      const mmFoot = mmo ? a.mmPose?.lock?.[lp.foot] : null
      const landed = mmFoot ? !!mmFoot.reach && mmFoot.reach.t >= 1 : !ff.step && ((ff.bx - s.x) * fr.r.x + (ff.bz - s.z) * fr.r.z) * (lp.foot ? 1 : -1) > 0.4
      down = (down + lp.crouch * near) * (landed ? 1 : 0.25)
      lungeLean = lp.roll * near
      const spot = toWorld(ground, fr, V(lp.spot.x, 0, lp.spot.z))
      reach = { foot: lp.foot, x: spot.x, z: spot.z }
      stance = R.stance + STANCE.wide
      // (the hips go over toward the front foot as it lands)
      const over = landed ? Math.max(near, 0.8) : near * 0.8
      extraT.x += lp.shift * over
      extraT.z += lp.shiftZ * over
      // (motion matching: the hips over toward the lunging foot, next frame, in the world)
      a.mmLungeT = { x: fr.r.x * lp.shift * over + fr.f.x * lp.shiftZ * over, z: fr.r.z * lp.shift * over + fr.f.z * lp.shiftZ * over }
    } else if (Math.abs(lc.z) > 0.55) stance = R.stance + STANCE.wide
    crouch += down
    // (round 2: the legs drive up into a groundstroke from the back whatever else asked them
    // down (a shuffle's or a run's lower pelvis, a low ball): the low ball is met with a hinge
    // at the hips and the arm, below. PPA footage, measured the same way: own contact at the
    // baseline, hips at 92% of upright; the game was at 83-87%)
    if (groundUp > 0 && !lp) crouch = lerp(crouch, Math.min(crouch, GROUND_CROUCH), groundUp * 0.85)
    // a drive (or lob, or the serve) from a standstill: the front foot steps toward the ball as
    // the weight goes forward (pro.js stepIn; worked out right-handed, mirrored)
    const st0 = a.stroke
    const soon = swing ? swing.t < 0.35 : s.prep.ttc < 0.42
    // (an overhead whose ball is behind them: the drop step, the paddle-side foot back)
    const ds = !lp && s.prep && isOverhead(c.kind, c.y) ? dropStep(V(lc.x * hand, 0, lc.z), s.prep.ttc) : null
    if (ds) {
      const spot = toWorld(ground, fr, V(ds.spot.x * hand, 0, ds.spot.z))
      reach = { foot: hand > 0 ? ds.foot : 1 - ds.foot, x: spot.x, z: spot.z }
    } else if (!lp && soon && st0.style && st0.phase !== "none") {
      const si = stepIn(st0.style, st0.side, V(lc.x * hand, 0, lc.z), speed)
      if (si) {
        const spot = toWorld(ground, fr, V(si.spot.x * hand, 0, si.spot.z))
        reach = { foot: hand > 0 ? si.foot : 1 - si.foot, x: spot.x, z: spot.z }
      }
    }
  }
  if (!lunging) crouch = Math.min(crouch, MAX_CROUCH)
  // (a step out never further than a leg reaches with the hips at a sensible height, measured
  // from where the hips are going)
  if (reach) {
    const sd = reach.foot ? 1 : -1
    const hx = s.x + fr.r.x * (sd * BODY.hipHalf + extraT.x) + fr.f.x * extraT.z
    const hz = s.z + fr.r.z * (sd * BODY.hipHalf + extraT.x) + fr.f.z * extraT.z
    const d = Math.hypot(reach.x - hx, reach.z - hz)
    if (d > 0.6) {
      reach.x = hx + ((reach.x - hx) * 0.6) / d
      reach.z = hz + ((reach.z - hz) * 0.6) / d
    }
  }
  if (s.holding) crouch = 0.04
  // the serve: a staggered stance, the paddle-side foot back under its hip while the ball is held
  // (the other one steps forward into the swing: stepIn), so the pendulum swing passes in front of
  // the back knee to a ball dropped beside the front foot (the square ready stance had that knee
  // forward, in the paddle's path)
  let hold = null
  // (until they move off after it: then the feet are the gait's again)
  if ((s.holding || (c && c.kind === "serve" && speed < 0.4)) && !s.between) {
    const spot = toWorld(ground, fr, V(hand * SERVE_BACK.x, 0, SERVE_BACK.z))
    hold = { foot: hand > 0 ? 1 : 0, x: spot.x, z: spot.z }
    if (!reach) reach = hold
  }
  crouch += bt.crouch // (the returner waits low)
  if (s.charging) crouch += 0.02
  crouch += a.extraCrouch // (the stroke's own knee bend, last frame's)
  // the weight moving through the stroke (last frame's stroke)
  extraT.z += a.weightT
  // split step: off the toes, landing (as the other side hits) a little wider and lower
  let hopY = 0
  if (a.hopNow) {
    a.hopNow = false
    hopGait(a.gait, { dur: SPLIT.lead, h: 0.025, wider: SPLIT.wider })
  }
  if (a.hop > 0) {
    hopY = splitHeight(SPLIT.dur - a.hop)
    stance = R.stance + SPLIT.wider
  }
  // an overhead on a ball above standing reach: jump into it (pro.js overheadLift)
  {
    const hi = swing ? { y: swing.y, t: swing.t } : s.prep ? { y: s.prep.y, t: -s.prep.ttc } : null
    a.jumpY = hi && hi.y > 1.62 ? overheadLift(hi.y, hi.t) : 0
    hopY += a.jumpY
    // (touching down from it: the knees take the landing)
    if (a.jumpY > 0.005) a.landE = -1
    else if (a.landE === -1 && (a.jumpPrev || 0) > 0.005) a.landE = 0
    if (a.landE >= 0) {
      crouch += landingSink(a.landE)
      a.landE += dt
      if (a.landE > OVERHEAD_SET.absorb) a.landE = undefined
    }
  }
  // moods
  const mood = a.mood && s.between ? a.mood : null
  if (mood?.kind === "sulk" && mood.variant === 1) crouch = 0.2 // hands on knees
  if (mood?.kind === "cheer" && mood.variant === 2) hopY += Math.max(0, Math.sin(mood.t * 9)) * 0.08 * (mood.t < 0.8 ? 1 : 0)
  // (My Park, together: a dance bounces on the lo-fi's beat, 72 a minute; a high five rises onto the toes)
  if (mood?.kind === "dance") {
    hopY += Math.abs(Math.sin(mood.t * Math.PI * 1.2)) * 0.045
    crouch = Math.max(crouch, 0.06 + 0.05 * Math.abs(Math.sin(mood.t * Math.PI * 1.2)))
  }
  if (mood?.kind === "highfive") hopY += Math.max(0, Math.sin(Math.min(1, mood.t / 0.9) * Math.PI)) * 0.05
  // (My Park activities, park/acts/: a jump shot's dip and lift; a workout's reps, mood.p the
  // rep's phase 0..1 from the beat)
  if (mood?.kind === "shoot") {
    const p = mood.p ?? clamp(mood.t / 1.2, 0, 1)
    crouch = Math.max(crouch, 0.15 * Math.sin(clamp(p / 0.42, 0, 1) * Math.PI))
    if (p > 0.38 && p < 0.86) hopY += Math.sin(((p - 0.38) / 0.48) * Math.PI) * 0.13
  }
  if (mood?.kind === "squat") crouch = Math.max(crouch, 0.4 * Math.sin(clamp(mood.p ?? 0, 0, 1) * Math.PI))
  if (mood?.kind === "jack") hopY += Math.sin(clamp(mood.p ?? 0, 0, 1) * Math.PI) * 0.09

  // standing still: weight shifts slowly from foot to foot; ready at the net, a light bounce
  const still = 1 - clamp(speed / 0.5, 0, 1)
  const sway = s.between ? Math.sin(a.t * 0.9) * 0.012 * still : Math.sin(a.t * 1.6) * 0.022 * still
  const bob = s.between ? 0 : (0.5 - 0.5 * Math.cos(a.t * 2 * Math.PI * 1.3)) * 0.008 * still
  // (motion matching: idle.js's weight shifts, bounce and breathing, below)
  const idleQuiet = !swing && !s.prep && !whiff && !s.holding && !s.charging && !(a.hop > 0) && !mood && !bt.tap ? 1 : 0
  const life = stepIdle(a.idle || (a.idle = createIdle(1 + Math.abs(s.x * 3.1 + s.z * 7.7))), { between: !!s.between, still: idleQuiet * still, run: clamp((speed - 1.5) / 3, 0, 1) }, dt)
  let idleMove = null
  const crouchS = springN(a.crouch, crouch, 10, dt)

  updateGait(a.gait, { x: s.x, z: s.z, vx: mv.x, vz: mv.z, yaw: a.yaw, stance, athletic: s.between ? 0 : R.stance * ATHLETIC, reach, hold: hold && hold !== reach ? hold : null, minHip: 0.93 - crouchS - 0.1, crossover: fc.mode !== "face", quick: quickSteps(speed, !!s.atNet && !s.between) }, dt)
  const feet = a.gait.feet
  const extra = springV(a.extra, extraT, 24, dt)
  // making room for a ball at the body (ROOM): world, horizontal; the hips take a computer
  // player's share, the trunk leans the rest away at the ball's height
  const roomV = springV(a.room || (a.room = {}), roomT ? V(roomT.x * roomW, 0, roomT.z * roomW) : V(), 22, dt)
  if (roomT) a.roomH = roomT.h
  const roomHip = roomT && roomT.cpu ? ROOM.cpu : a.roomHip ?? 0
  if (roomT) a.roomHip = roomHip
  const roomLean = mul(roomV, 1 - roomHip)
  const roomH = a.roomH || 0.45
  const roomLeanF = clamp((roomLean.x * fr.f.x + roomLean.z * fr.f.z) / roomH, ROOM.lean[0], ROOM.lean[1])
  const roomRoll = clamp((roomLean.x * fr.r.x + roomLean.z * fr.r.z) / roomH, -ROOM.roll, ROOM.roll)
  const roomPelvis = mul(roomV, roomHip)
  a.roomPelvis = roomPelvis // (motion matching: the hips over, next frame)

  // ---- the upper body: layers ----
  // Worked out for a right-hander in the body frame (x right, y up, z forward) and mirrored
  // for a left-hander. Layers, each with a weight that fades in and out: the ready position
  // (or relaxed between points), the run's arm swing (off on the paddle arm while it holds
  // ready), the serve's hold, a stroke (strokes.js), a mood. The legs (above) never see them.
  // Poses are made for a standard posture (shoulders 1.3 m up and 0.1 m ahead of the feet)
  // and moved with the real one (ofs: a deep crouch, a bend at the waist, a reach), so the
  // hands keep their place relative to the shoulders; the contact point stays where it is.
  const RH = (l) => V(l.x * hand, l.y, l.z) // body frame <-> right-handed (its own inverse)
  const local = (p) => toLocal(ground, fr, V(p.x, p.y, p.z))
  const W = a.w
  const sh = 1.3 // (the standard shoulders' height)
  const lean0 = (a.lean.p ?? 0.2) + roomLeanF
  const sft = a.shift.p ? toLocal(V(0, 0, 0), fr, a.shift.p) : V()
  // (with motion matching the posture is the captured one: where its shoulders really are)
  // (with last frame's extra bend at the waist, see below)
  const mmSh = mmo ? local(add(mmo.pelvis, qrot(qaxis(mul(fr.r, -1), (a.mmLean.p ?? 0) + roomLeanF), sub(mul(add(mmo.shoulderL, mmo.shoulderR), 0.5), mmo.pelvis)))) : null
  const ofs = mmo ? V(mmSh.x, mmSh.y - sh, mmSh.z - 0.1) : V(sft.x + extra.x, 0.935 - crouchS + sft.y + 0.455 * Math.cos(lean0) - sh, sft.z + extra.z + 0.455 * Math.sin(lean0) - 0.1)
  const toStd = (l) => RH(sub(l, ofs)) // a body-frame point -> the standard, right-handed pose
  let normalT = null
  // forward from the hips: more into a run, and into the acceleration (back on a hard stop)
  const running = bl.run + bl.sprint + bl.walk * 0.3
  // (ready: the chest over the knees, the back about parallel to the shins; running: more upright)
  let leanT = (s.between ? READY.between.lean : lerp(R.lean, 0.2, clamp(running, 0, 1))) + Math.min(0.16, speed * 0.04) * running + clamp(accF * 0.018, -0.14, 0.14)
  const rollT = clamp(accR * 0.016, -0.12, 0.12) * (1 - running * 0.5)
  let lookAt = s.ball

  // the ready position: the paddle up in front of the chest, elbows bent, the other hand by
  // the paddle's throat (a little higher at the kitchen line); between points, relaxed
  // (pro.js READY: out in front between the waist and the chest, tip toward the backhand
  // side; a two-handed player's other hand on the handle, a one-handed player's at the throat)
  const rAxis = norm(V(R.tip.x, R.tip.y, R.tip.z))
  const rHand = V(R.hand.x, R.hand.y, R.hand.z)
  const rOff = s.twoHand ? add(rHand, mul(rAxis, ON_HANDLE)) : add(rHand, add(mul(rAxis, 0.13), V(-0.03, -0.01, 0.03)))
  const ready = { hand: rHand, axis: rAxis, coil: 0, off: rOff, pole: V(0.6, -1, -0.2), lean: 0, crouch: 0, sh }
  // the arms walking about, jogging and running (gaitarms.js): one model for every gait, driven
  // by the legs as drawn (last frame's ankles), with motion matching or without. (The capture's
  // own arms changed with whichever clip the search picked: straight hanging arms on a walk, high
  // fists on a jog, open elbows on a run; the old procedural pose bent the elbows 75 degrees even
  // standing.)
  const ga = stepGaitArms(a.gaitArms || (a.gaitArms = createGaitArms()), { spread: a.lastSpread || 0, speed, hand, dt, paddle: !a.noPaddle })
  const relaxed = { hand: ga.P.hand, axis: ga.axis, coil: 0, off: ga.O.hand, pole: ga.P.pole, offPole: ga.O.pole, lean: 0, crouch: 0, sh }
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
  // (running hard the arms pump, the paddle arm too, the paddle kept up in front; shuffling or
  // with a ball on the way the paddle arm holds ready and the other arm swings less: a player's
  // arms never stop moving with the legs, though; docs/pickleball-arms.md)
  const fastRun = clamp((speed - 1.8) / 1.2, 0, 1)
  const facing = fc.mode === "face" || fc.mode === "cross"
  const holdReady = s.between ? 0 : incoming ? 1 : facing ? 1 - 0.45 * fastRun : 0.45
  W.pumpP = ramp(W.pumpP, pump * (1 - holdReady), dt, 0.3, 0.12)
  W.pumpO = ramp(W.pumpO, s.holding ? 0 : pump * (s.between ? 1 : incoming ? 0.35 : facing ? 0.55 + 0.45 * fastRun : 1), dt, 0.25, 0.2)
  if (W.pumpP > 1e-3) {
    // (the gait's own swing: the paddle hand between the hip and the lower chest, the paddle up
    // along the forearm running)
    const swingP = { ...pose, hand: ga.P.hand, axis: ga.axis, pole: ga.P.pole }
    pose = { ...mixPose(pose, swingP, smoothW(Math.min(1, W.pumpP * 1.5))), off: pose.off }
  }
  if (W.pumpO > 1e-3) pose = { ...pose, off: lerpV(pose.off, ga.O.hand, smoothW(Math.min(1, W.pumpO * 1.5))) }
  // the shoulders turn against the hips with the stride (the captured trunk turns by itself)
  const runTwist = mmo ? 0 : cph * 0.16 * Math.min(1, pump) * Math.max(W.pumpO, W.pumpP, 0.35)

  // waiting to serve: the ball in the other hand out in front, the paddle back and low
  W.hold = ramp(W.hold, s.holding ? 1 : 0, dt, 0.25, 0.2)
  if (W.hold > 1e-3) {
    const held = { hand: V(0.34, 0.84, -0.18), axis: norm(V(0.2, -0.8, -0.5)), coil: 0.25, off: s.holding ? toStd(local(s.ball)) : V(0.12, 0.96, 0.46), pole: V(0.4, -1, -0.4), lean: -0.08, crouch: 0 }
    pose = mixPose(pose, held, smoothW(W.hold))
  }

  // ---- a stroke (strokes.js): wind-up, the forward swing through the contact, follow-through ----
  let inp = null
  // (a new ball on its way beats the end of the last swing: quick exchanges at the net)
  if (swing && !(s.prep && swing.t > 0.1)) inp = { key: "s" + (swing.id ?? `${swing.kind}${swing.x?.toFixed(3)}${swing.z?.toFixed(3)}`), kind: swing.kind, c: toStd(local(swing)), y: swing.y, tRel: swing.t, after: true, forward: true, two: !!s.twoHand, fast: !!swing.fast }
  else if (whiff && !s.prep) inp = { key: "w" + whiff.kind + whiff.y.toFixed(3), kind: "block", c: V(0.32, clamp(whiff.y, 0.7, 1.5), 0.58), tRel: whiff.t, after: true, forward: true }
  else if (s.prep) {
    const p = s.prep
    inp = { key: "p" + (p.id ?? 0), kind: p.kind, c: toStd(local(p)), y: p.y, tRel: -p.ttc, after: false, forward: !!p.forward && !s.charging, volley: !!p.volley, two: !!s.twoHand, fast: !!p.fast }
  }
  // (the knees, last frame's, in the stroke's frame: a low ball by the legs is met with the hand
  // and handle out beside the knee, strokes.js roomAxis)
  a.stroke.knees = a.lastKnees ? [toStd(local(a.lastKnees[0])), toStd(local(a.lastKnees[1]))] : null
  const so = stepStroke(a.stroke, inp, pose, dt)
  // the weight through the stroke (pro.js WEIGHT; used next frame by the hips)
  a.weightT = so.w > 0 ? weightFor(so.style, so.phase, so.u) * so.w : 0
  if (so.w > 0) pose = so.pose
  // (an overhead's set-up: the other arm up, pointing at the falling ball, until the swing
  // pulls it down across the chest)
  W.track = ramp(W.track || 0, oh && oh.tRel < -0.14 && !s.between ? 1 : 0, dt, 0.25, 0.12)
  if (W.track > 1e-3) {
    const o = V(-0.18, sh, 0.1)
    const b = toStd(local(s.ball))
    const toward = norm(sub(b, o), V(0, 0.8, 0.6))
    // (not behind the head: the arm points up and out in front of it)
    const dir = norm(V(toward.x, Math.max(0.45, toward.y), Math.max(0.15, toward.z)))
    pose = { ...pose, off: lerpV(pose.off, add(o, mul(dir, OVERHEAD_SET.track)), smoothW(W.track))}
  }
  // eyes on the contact point until just after the hit, then on the ball
  if (so.phase !== "none" && inp && !inp.after && s.prep) lookAt = V(s.prep.x, s.prep.y, s.prep.z)
  // (players v3: the eyes stay on the contact point a moment after it, as pros' heads do)
  else if (so.phase !== "none" && swing && swing.t < 0.22) lookAt = V(swing.x, swing.y, swing.z)
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
    } else if (mood.kind === "wave") {
      // a hello: the paddle hand up beside the head, swaying side to side (My Park)
      const sway = Math.sin(mood.t * 11) * 0.12
      mp = { hand: V(0.34 + sway, 1.72, 0.22), axis: norm(V(0.15 + sway, 1, 0.15)), off: V(-0.22, 0.95, 0.08), pole: V(1, -0.3, -0.2) }
      lookAt = add(add(ground, V(0, 1.6, 0)), mul(fr.f, 3))
    } else if (mood.kind === "carry" || mood.kind === "sip") {
      // (My Park leisure, park/leisure/: something to eat or drink in the paddle hand) carry:
      // held in front at the waist, upright; sip: up to the mouth, tipped toward it (mood.p 0..1:
      // up, a moment there, back down), the head a little back
      const up = mood.kind === "sip" ? smoothW(clamp((mood.p ?? clamp(mood.t / 1.6, 0, 1)) / 0.3, 0, 1)) * (1 - smoothW(clamp(((mood.p ?? clamp(mood.t / 1.6, 0, 1)) - 0.72) / 0.28, 0, 1))) : 0
      const carry = { hand: V(0.17, 1.02, 0.27), axis: V(0, 1, 0) }
      const mouth = { hand: V(0.05, 1.47, 0.15), axis: norm(V(-0.05, 0.62, -0.78)) }
      mp = { hand: lerpV(carry.hand, mouth.hand, up), axis: norm(lerpV(carry.axis, mouth.axis, up)), off: V(-0.22, 0.92, 0.06), pole: V(0.7, -1, -0.2), offPole: V(-0.4, -1, -0.2) }
      lookAt = add(add(ground, V(0, 1.6 + 0.6 * up, 0)), mul(fr.f, 3))
    } else if (mood.kind === "fan") {
      // hot and thirsty: the free hand fanning the face, the other hanging
      const sway = Math.sin(mood.t * 13) * 0.07
      mp = { hand: V(0.24, 0.92, 0.06), axis: norm(V(0.1, -1, 0.1)), off: V(-0.1 + sway, 1.52, 0.22), pole: V(0.6, -1, -0.2), offPole: V(-1, -0.4, -0.2) }
      lookAt = add(add(ground, V(0, 1.75, 0)), mul(fr.f, 3))
    } else if (mood.kind === "hold") {
      // hand in hand (My Park, together): the near hand out low toward the other one, the far
      // arm loose. variant 0: they're on the paddle hand's side; 1: on the other side
      const swing = Math.sin(a.t * 3.1) * 0.03 * clamp(speed / 1.4, 0, 1)
      if (v === 0) mp = { hand: V(0.42, 0.9, 0.06 + swing), axis: norm(V(0.2, -1, 0.1)), off: V(-0.2, 0.86, 0.03 - swing), pole: V(0.6, -0.4, -0.6), offPole: V(-0.4, -1, -0.2) }
      else mp = { hand: V(0.22, 0.86, 0.05 - swing), axis: norm(V(0.05, -1, 0.15)), off: V(-0.42, 0.9, 0.06 + swing), pole: V(0.4, -1, -0.2), offPole: V(-0.6, -0.4, -0.6) }
    } else if (mood.kind === "hug") {
      // a warm hug, arms all the way round: the hands cross behind the other one's back (the
      // right hand to their far shoulder blade, the left to the small of the back), the two
      // rocking gently, heads turned past each other's shoulder. variant 0 hugs over the
      // shoulders, 1 round the waist (so the two pairs of arms don't meet in the same place)
      const k = clamp(mood.t / 0.55, 0, 1)
      const e = k * k * (3 - 2 * k)
      const rock = Math.sin(mood.t * 1.7) * 0.025 * e
      const hi = v === 1 ? 1.1 : 1.4
      const lo = v === 1 ? 1.04 : 1.16
      mp = {
        hand: V(0.24 - 0.34 * e + rock, hi, 0.22 + 0.3 * e),
        axis: norm(V(-0.8, 0.1, -0.3)),
        off: V(-0.24 + 0.34 * e + rock, lo, 0.22 + 0.28 * e),
        pole: V(1, v === 1 ? -0.5 : 0.1, -0.1),
        offPole: V(-1, -0.4, -0.1),
      }
      lookAt = add(add(ground, V((v === 1 ? -0.55 : 0.55) + rock * 4, 1.5, 0)), mul(fr.f, 1.6))
    } else if (mood.kind === "thumbs") {
      // a thumbs up: the hand out in front at the chest, the other arm loose
      const k = clamp(mood.t / 0.3, 0, 1)
      mp = { hand: V(0.26, 1.0 + 0.26 * k, 0.18 + 0.16 * k), axis: norm(V(0, 1, 0.1)), off: V(-0.22, 0.92, 0.06), pole: V(1, -0.8, -0.2) }
      lookAt = add(add(ground, V(0, 1.6, 0)), mul(fr.f, 3))
    } else if (mood.kind === "point") {
      // pointing out ahead ("look at that!")
      const k = clamp(mood.t / 0.35, 0, 1)
      mp = { hand: V(0.3, 1.1 + 0.36 * k, 0.2 + 0.4 * k), axis: norm(V(0.05, 0.15, 1)), off: V(-0.22, 0.92, 0.06), pole: V(1, -0.6, -0.4) }
      lookAt = add(add(ground, V(0.3, 1.7, 0)), mul(fr.f, 6))
    } else if (mood.kind === "highfive") {
      // a paddle tap up high: up and back, then forward to meet theirs in the middle
      const k = clamp((mood.t - 0.25) / 0.3, 0, 1)
      mp = { hand: V(0.08, 1.74 + 0.08 * (1 - k), 0.12 + 0.28 * k), axis: norm(V(0, 0.4, 1)), off: V(-0.22, 0.98, 0.1), pole: V(1, -0.6, -0.2) }
      lookAt = add(add(ground, V(0, 1.8, 0)), mul(fr.f, 1.5))
    } else if (mood.kind === "twirl") {
      // variant 0: the one turning, a hand up over the head; 1: the other, holding that hand up
      if (v === 0) mp = { hand: V(0.24, 0.92, 0.08), axis: norm(V(0.1, -1, 0.1)), off: V(-0.06, 2.0, 0.08), pole: V(0.6, -1, -0.2), offPole: V(-1, 0.2, 0) }
      else mp = { hand: V(0.24, 0.92, 0.1), axis: norm(V(0.1, -1, 0.1)), off: V(-0.05, 1.92, 0.34), pole: V(0.6, -1, -0.2), offPole: V(-1, -0.2, 0) }
      lookAt = add(add(ground, V(0, 1.6, 0)), mul(fr.f, 2))
    } else if (mood.kind === "dance") {
      // to the beat: the arms swing in turn, a little different for each of the two
      const b = mood.t * Math.PI * 1.2
      const s1 = Math.sin(b)
      const s2 = Math.sin(b + (v ? 1.2 : 0))
      mp = { hand: V(0.3 + 0.08 * s2, 1.12 + 0.24 * s1, 0.24), axis: norm(V(0.2 * s1, 1, 0.3)), off: V(-0.3 - 0.08 * s2, 1.12 - 0.24 * s1, 0.24), pole: V(1, -0.6, -0.3), offPole: V(-1, -0.6, -0.3) }
      lookAt = add(add(ground, V(0.3 * s1, 1.6, 0)), mul(fr.f, 2))
    } else if (mood.kind === "selfie") {
      // (nobody holds a phone: the picture takes itself) variant 0: a peace sign by the face,
      // the paddle down; 1: a wave with the free hand, the paddle down
      if (v === 0) mp = { hand: V(0.24, 0.94, 0.08), axis: norm(V(0.1, -1, 0.1)), off: V(-0.18, 1.62, 0.16), pole: V(0.6, -1, -0.2), offPole: V(-0.8, -0.5, -0.2) }
      else mp = { hand: V(0.24, 0.94, 0.08), axis: norm(V(0.1, -1, 0.1)), off: V(-0.32 + Math.sin(mood.t * 9) * 0.06, 1.6, 0.16), pole: V(0.6, -1, -0.2), offPole: V(-1, -0.4, -0.2) }
      lookAt = add(add(ground, V(0, 1.55, 0)), mul(fr.f, 3))
    } else if (mood.kind === "shoot") {
      // a jump shot (My Park > Shoot hoops): the ball set in front of the forehead, then the
      // shooting arm up and through, the other hand guiding, held a moment (the wrist flicked)
      const p = mood.p ?? clamp(mood.t / 1.2, 0, 1)
      const k = smoothW(clamp((p - 0.4) / 0.22, 0, 1))
      mp = { hand: lerpV(V(0.12, 1.5, 0.3), V(0.1, 2.12, 0.42), k), axis: norm(lerpV(V(0, 1, 0.25), V(0, 0.4, 1), k)), off: lerpV(V(-0.12, 1.46, 0.3), V(-0.12, 1.85, 0.32), k), pole: V(0.5, -1, -0.15), offPole: V(-0.7, -0.6, -0.2) }
      lookAt = add(add(ground, V(0, 2.6, 0)), mul(fr.f, 5))
    } else if (mood.kind === "dribble") {
      // bouncing the ball at the side (mood.p: 0 the hand up, 0.5 down to push it)
      const b = Math.sin((mood.p ?? 0) * Math.PI)
      mp = { hand: V(0.36, 0.98 - 0.22 * b, 0.28), axis: norm(V(0, -0.3, 1)), off: V(-0.24, 0.98, 0.16), pole: V(1, -0.4, -0.4), offPole: V(-0.6, -1, -0.2) }
    } else if (mood.kind === "squat") {
      // arms out in front for balance, down with the body
      const b = Math.sin(clamp(mood.p ?? 0, 0, 1) * Math.PI)
      mp = { hand: V(0.17, 1.3 - 0.36 * b, 0.46), axis: norm(V(0, 0.2, 1)), off: V(-0.17, 1.3 - 0.36 * b, 0.46), pole: V(0.6, -1, -0.3), offPole: V(-0.6, -1, -0.3) }
      lookAt = add(add(ground, V(0, 1.5 - 0.3 * b, 0)), mul(fr.f, 4))
    } else if (mood.kind === "curl") {
      // both hands from the thighs up to the shoulders, the elbows kept at the sides
      const b = Math.sin(clamp(mood.p ?? 0, 0, 1) * Math.PI)
      mp = { hand: V(0.22, 0.86 + 0.48 * b, 0.12 + 0.16 * b), axis: norm(V(0, 0.3 + 0.7 * b, 1 - 0.6 * b)), off: V(-0.22, 0.86 + 0.48 * b, 0.12 + 0.16 * b), pole: V(0.2, -1, -0.5), offPole: V(-0.2, -1, -0.5) }
    } else if (mood.kind === "press") {
      // from the shoulders straight up overhead
      const b = Math.sin(clamp(mood.p ?? 0, 0, 1) * Math.PI)
      mp = { hand: V(0.27 - 0.08 * b, 1.48 + 0.6 * b, 0.1 - 0.04 * b), axis: norm(V(0, 1, 0.1)), off: V(-0.27 + 0.08 * b, 1.48 + 0.6 * b, 0.1 - 0.04 * b), pole: V(1, -0.6, -0.1), offPole: V(-1, -0.6, -0.1) }
      lookAt = add(add(ground, V(0, 1.7, 0)), mul(fr.f, 4))
    } else if (mood.kind === "row") {
      // bent over at the hips, pulling both hands from hanging to the ribs
      const b = Math.sin(clamp(mood.p ?? 0, 0, 1) * Math.PI)
      mp = { hand: V(0.2, 0.72 + 0.28 * b, 0.42 - 0.3 * b), axis: norm(V(0, -0.2, 1)), off: V(-0.2, 0.72 + 0.28 * b, 0.42 - 0.3 * b), pole: V(0.4, 0.4, -1), offPole: V(-0.4, 0.4, -1) }
      leanT = 0.6
      lookAt = add(ground, mul(fr.f, 2))
    } else if (mood.kind === "jack") {
      // jumping jacks: the arms out and up over the head, and back down
      const b = Math.sin(clamp(mood.p ?? 0, 0, 1) * Math.PI)
      mp = { hand: V(0.3 + 0.35 * Math.sin(b * Math.PI * 0.5), 0.85 + 1.15 * b, 0.05), axis: norm(V(0.3, 1, 0)), off: V(-0.3 - 0.35 * Math.sin(b * Math.PI * 0.5), 0.85 + 1.15 * b, 0.05), pole: V(1, -0.5, -0.2), offPole: V(-1, -0.5, -0.2) }
    } else if (mood.kind === "watch") {
      // standing watching something up ahead (the TV), arms folded loosely
      mp = { hand: V(0.08, 1.12, 0.18), axis: norm(V(-1, 0.1, 0.1)), off: V(-0.1, 1.14, 0.2), pole: V(1, -0.6, 0), offPole: V(-1, -0.6, 0) }
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
    // (motion matching: the big celebration and the frustrated arms-out are motion capture,
    // mm/gesture.js: the captured arms from the player's own shoulders)
    const gName = mmo ? (mood.kind === "cheer" && v === 2 ? "joy" : mood.kind === "sulk" && v === 2 ? "upset" : null) : null
    const g = gName ? gestureArms(mmLib, gName, mood.t) : null
    if (g) {
      const cr = mmo.chestRight
      const cf = mmo.chestForward
      const cu = norm(cross(cf, cr))
      // (the chest frame: x the body's left, y up, z forward)
      const W2 = (o, v2) => add(o, add(add(mul(cr, -v2.x), mul(cu, v2.y)), mul(cf, v2.z)))
      const sP = hand > 0 ? mmo.shoulderR : mmo.shoulderL
      const sO = hand > 0 ? mmo.shoulderL : mmo.shoulderR
      const aP = hand > 0 ? g.r : g.l
      const aO = hand > 0 ? g.l : g.r
      const wP = W2(sP, aP.wrist)
      const wO = W2(sO, aO.wrist)
      const chestL = (v2) => RH(V(dot(v2, cr), dot(v2, cu), dot(v2, cf)))
      mp = { hand: toStd(local(wP)), axis: RH(toLocal(V(), fr, norm(W2(V(), aP.hand)))), off: toStd(local(wO)), pole: chestL(sub(W2(sP, aP.elbow), mul(add(sP, wP), 0.5))), offPole: chestL(sub(W2(sO, aO.elbow), mul(add(sO, wO), 0.5))) }
    }
    a.moodPose = { ...mp, coil: 0, lean: 0, crouch: 0 }
  }
  if (W.mood > 1e-3 && a.moodPose) pose = mixPose(pose, a.moodPose, smoothW(W.mood))

  // ---- between points (between.js): paddle taps, glances, fidgets ----
  if (bt.tap && !swing && !s.prep) {
    // the paddle up and out toward the other paddle, the face square to it
    const T = V(bt.tap.x, bt.tap.y, bt.tap.z)
    const dirW = V(bt.tap.nx, 0, bt.tap.nz)
    const axW = norm(add(mul(UP, 0.8), mul(dirW, 0.6)))
    const wrist = sub(T, mul(axW, BODY.paddleReach))
    const tapPose = { ...pose, hand: toStd(local(wrist)), axis: RH(toLocal(V(), fr, axW)), pole: V(0.6, -0.7, -0.6), coil: 0, lean: 0, crouch: 0 }
    pose = mixPose(pose, tapPose, smoothW(bt.tap.w))
    pose.off = mixPose({ ...pose }, { ...pose, off: V(-0.22, 0.86, 0.1) }, smoothW(bt.tap.w)).off
  }
  if (bt.wipe !== null && !swing && !s.prep) {
    // the other hand brushes down the side of the shorts, twice
    const u = bt.wipe
    const wipeOff = V(-0.21, 0.96 - 0.22 * Math.abs(Math.sin(2 * Math.PI * u)), 0.05)
    pose = { ...pose, off: lerpV(pose.off, wipeOff, smoothW(Math.sin(Math.PI * u) * 1.6)) }
  }
  if (bt.look && !swing && !s.prep) lookAt = bt.look

  // (tests: the point the stroke is aiming at)
  const aimAt = inp ? (inp.after ? swing : s.prep) : null

  // ---- back to the body frame ----
  const handT = add(RH(pose.hand), ofs)
  const axisT = RH(pose.axis)
  const offT = add(RH(pose.off), ofs)
  const poleT = RH(pose.pole)
  // (a crossover opens the hips toward the ball; the shoulders stay turned to the net)
  // (motion matching: only the stroke's turn goes on top of the captured trunk)
  const twistT = mmo ? -pose.coil * hand : -pose.coil * hand + runTwist + (fc.side || 0) * CROSS.chest
  // (a ball the arm can't reach down to: bend at the hips first, then the knees)
  leanT += (pose.lean || 0) + lowLean + clamp((a.overDown || 0) * 2, 0, 0.45)
  // how quickly the hands may move: a swing is fast, everything else smooth
  const fast = so.fast
  // (the captured arms swing freely: followed closely)
  const k = so.w > 0.02 ? (fast ? 200 : 45) : 22 + 23 * Math.max(smoothW(W.relax), W.pumpP)

  // ---- the pelvis: as high as the stance wants, low enough that both legs reach ----
  // (the steps' own rise and fall, from the gait)
  let py = 0.935 - crouchS + bob + a.gait.bob + hopY
  // reaching: if the paddle hand can't get to where the stroke wants it, the whole upper
  // body goes toward it (a step in, a bend at the knees), as far as the legs allow
  const want = toWorld(ground, fr, handT)
  // (the shoulder where the posture puts it, before any reach)
  const shR = toWorld(ground, fr, V(hand * BODY.shoulderHalf, sh + ofs.y - sft.y, 0.1 + ofs.z - sft.z))
  const gap = sub(want, shR)
  const over = len(gap) - ARM * 0.92
  let shiftT = V()
  // (only around contact: a backswing or a ready pose never drags the body down)
  const reaching = (swing && swing.t < 0.3) || (s.prep && s.prep.forward && s.prep.ttc < 0.35)
  const downNow = over > 0 && !s.between && reaching && gap.y < 0 ? over * clamp(-gap.y / len(gap), 0, 1) : 0
  a.overDown = (a.overDown || 0) + (downNow - (a.overDown || 0)) * (1 - Math.exp(-dt * (downNow > (a.overDown || 0) ? 20 : 8)))
  if (over > 0 && !s.between && reaching) {
    const d = norm(gap)
    // (down: a hinge at the hips takes a share first, the knees the rest: overDown leans the
    // trunk below. Pros reach a low ball with the hips back and the chest over it, not a squat)
    // (a groundstroke from the back: less of it from the hips, more from the hinge)
    shiftT = V(clamp(d.x * over, -0.4, 0.4), clamp(d.y * over * 0.6 * (1 - GROUND_HINGE * groundUp), -0.3, 0.04), clamp(d.z * over, -0.4, 0.4))
  }
  const shift = springV(a.shift, shiftT, k >= 200 ? 36 : 16, dt)
  py += shift.y
  const side = sway * 1.2 + a.gait.sway
  const pelvisXZ = V(s.x + fr.r.x * (side + extra.x) + fr.f.x * extra.z + shift.x + roomPelvis.x, 0, s.z + fr.r.z * (side + extra.x) + fr.f.z * extra.z + shift.z + roomPelvis.z)
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
    const ay = f.y + BODY.ankle + (a.jumpY || 0) // (in an overhead's jump the feet are off the court too)
    const maxY = ay + Math.sqrt(Math.max(0.01, (LEG * 0.985) ** 2 - h * h))
    if (!f.step && py > maxY) py = maxY // hips can't float above a planted foot
    else if (f.step?.want) {
      // a long step (a lunge): the hips come down while the foot travels, not all at once
      // when it lands
      // (measured from where the hips are heading: they move over toward that foot)
      const hx = hip.x + fr.r.x * (extraT.x - extra.x) + fr.f.x * (extraT.z - extra.z)
      const hz = hip.z + fr.r.z * (extraT.x - extra.x) + fr.f.z * (extraT.z - extra.z)
      const hw = Math.hypot(f.step.want.x - hx, f.step.want.z - hz)
      const landY = BODY.ankle + Math.sqrt(Math.max(0.01, (LEG * 0.985) ** 2 - hw * hw))
      if (hw < LEG * 0.95) py = Math.min(py, landY + (1 - f.step.t) * 0.2)
    }
  }
  py = Math.max(py, 0.55)
  if (a.pelvisY === undefined || dt <= 0) a.pelvisY = py
  // fast down (the legs must reach; never a drop of more than a few cm in a frame), gentler up
  // (an overhead's jump goes up quickly: the take-off)
  // (landing from an overhead's jump: the hips come down with the feet)
  const jumpDrop = Math.max(0, (a.jumpPrev || 0) - (a.jumpY || 0))
  a.jumpPrev = a.jumpY || 0
  // (a foot landing far out, say a step as a walk starts sideways: what's past a few cm comes
  // down at once, so the leg still reaches it)
  a.pelvisY = py < a.pelvisY ? Math.max(py, a.pelvisY - 4.8 * dt - jumpDrop * 1.05 - Math.max(0, a.pelvisY - py - 0.1) * 0.6) : a.pelvisY + (py - a.pelvisY) * (1 - Math.exp(-dt * ((a.jumpY || 0) > 0.005 ? 40 : 14)))
  let pelvis = V(pelvisXZ.x, a.pelvisY, pelvisXZ.z)

  // ---- springs: smooth everything that isn't a hard swing ----
  // (the hips turn quicker than the shoulders: in a swing the hips lead, the shoulders
  // follow, then the arm)
  // (players v3: the unit turn comes early and full, as soon as the ball is read)
  const twist = springN(a.twist, twistT, fast ? 40 : so.w > 0.02 ? 24 : 14, dt)
  // (players v3, the kinetic chain: in the take-back the hips hold back while the shoulders
  // coil, a stretch between them (hip-shoulder separation, 25-35 degrees in a pro's drive); in
  // the forward swing the hips fire first and further, the shoulders follow, then the arm)
  const hipTwist = springN(a.hipTwist, twistT * (fast ? 0.6 : 0.26), fast ? 80 : 18, dt)
  // (never folded more than about 52 degrees at the hips)
  const lean = springN(a.lean, Math.min(0.92, leanT + Math.abs(lungeLean) * 0.4), 12, dt) + roomLeanF
  const roll = springN(a.roll, lungeLean + rollT, 8, dt) + roomRoll

  // ---- the spine ----
  // the hips turn a little with the shoulders, and swivel with the stride (the leg going
  // forward takes its hip with it)
  const swivel = -Math.cos(ph) * 0.12 * pump
  const pfr = frame(a.yaw + hipTwist + swivel)
  const cfr = frame(a.yaw + twist) // the shoulders turn all the way
  let spineDir = norm(add(add(mul(UP, Math.cos(lean)), mul(fr.f, Math.sin(lean))), mul(fr.r, Math.sin(roll))))
  let neck = add(pelvis, mul(spineDir, BODY.spine))
  // shoulders: square to the chest's frame, perpendicular to the spine
  let sr = sub(cfr.r, mul(spineDir, dot(cfr.r, spineDir)))
  sr = norm(sr, cfr.r)
  let shoulderR = add(sub(neck, mul(spineDir, 0.045)), mul(sr, BODY.shoulderHalf))
  let shoulderL = add(sub(neck, mul(spineDir, 0.045)), mul(sr, -BODY.shoulderHalf))
  let chestF = norm(cross(spineDir, sr), fr.f)
  let hipR = add(pelvis, mul(pfr.r, BODY.hipHalf))
  let hipL = add(pelvis, mul(pfr.r, -BODY.hipHalf))
  let pelvisRight = pfr.r

  // ---- legs ----
  let legs = [0, 1].map((i) => {
    const f = feet[i]
    const hip = i ? hipR : hipL
    let ankle = V(f.x, f.y + BODY.ankle + (a.jumpY || 0), f.z)
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
    // knees bend forward and out, over the toes (the server's back knee straight forward, in
    // under the swing, not out into the paddle's path)
    const out = hold && hold.foot === i ? 0 : 0.32
    const pole = add(norm(add(ff.f, mul(ff.r, i ? out : -out))), V(0, 0.05, 0))
    const ik = twoBone(hip, ankle, BODY.thigh, BODY.shin, pole)
    return { hip, knee: ik.mid, ankle: ik.end, foot: { x: ik.end.x, y: ik.end.y - BODY.ankle, z: ik.end.z, yaw: f.yaw, pitch: f.step ? Math.sin(Math.PI * f.step.t) * -0.35 : 0, planted: !f.step && !((a.jumpY || 0) > 0.01) } }
  })

  // ---- motion matching: the captured pelvis, legs and trunk instead ----
  // (on top: a stroke's bend at the waist and its shoulder turn, round the pelvis; a low
  // ball the arm can't reach down to brings the hips down next frame)
  if (mmo) {
    a.mmDown = Math.max(0, -shift.y)
    // (for next frame: a lunge's or a drive's step out, and the hips going over that foot)
    a.mmReach = reach ? (hold && hold !== reach ? [{ foot: reach.foot, x: reach.x, z: reach.z }, { ...hold }] : { foot: reach.foot, x: reach.x, z: reach.z }) : null
    const lt = lunging && a.mmLungeT ? a.mmLungeT : { x: 0, z: 0 }
    a.mmLunge = springV(a.mmLungeS || (a.mmLungeS = {}), V(lt.x, 0, lt.z), 14, dt)
    pelvis = mmo.pelvis
    // (in a rally the ready position's forward lean, pro.js READY, where the capture stands
    // more upright: the chest over the knees, the shoulders and paddle out in front)
    const mLean = Math.atan2(dot(mmo.spine, fr.f), mmo.spine.y)
    const readyLean = s.between ? 0 : Math.max(0, R.lean - mLean) * (1 - clamp(running01, 0, 1)) * 0.85
    const leanS = springN(a.mmLean, clamp((pose.lean || 0) + lowLean + clamp((a.overDown || 0) * 2, 0, 0.45) + readyLean, -0.3, 0.7), fast ? 30 : 12, dt)
    const Rl = qmul(qaxis(fr.f, roomRoll), qaxis(mul(fr.r, -1), leanS + roomLeanF))
    spineDir = norm(qrot(Rl, mmo.spine))
    const Rot = qmul(qaxis(spineDir, twist), Rl)
    const rel = (p) => add(pelvis, qrot(Rot, sub(p, pelvis)))
    neck = rel(mmo.neck)
    shoulderL = rel(mmo.shoulderL)
    shoulderR = rel(mmo.shoulderR)
    sr = norm(qrot(Rot, mmo.chestRight))
    chestF = norm(qrot(Rot, mmo.chestForward))
    hipL = mmo.hipL
    hipR = mmo.hipR
    pelvisRight = mmo.pelvisRight
    legs = [
      { hip: mmo.hipL, knee: mmo.kneeL, ankle: mmo.ankleL, foot: mmo.footL },
      { hip: mmo.hipR, knee: mmo.kneeR, ankle: mmo.ankleR, foot: mmo.footR },
    ]
    // (players v3, the kinetic chain: the captured hips join the stroke, turning about the
    // pelvis by their own spring, ahead of the shoulders in the forward swing; the knees bend
    // again to the pinned feet. Before, only the chest turned for a stroke over the captured hips)
    if (Math.abs(hipTwist) > 1e-3) {
      const Rh = qaxis(UP, hipTwist)
      const relH = (p) => add(pelvis, qrot(Rh, sub(p, pelvis)))
      hipL = relH(hipL)
      hipR = relH(hipR)
      pelvisRight = norm(qrot(Rh, pelvisRight))
      legs = legs.map((l, i) => {
        const hip = i ? hipR : hipL
        const pole = sub(l.knee, mul(add(l.hip, l.ankle), 0.5))
        const r = twoBone(hip, l.ankle, len(sub(l.knee, l.hip)), len(sub(l.ankle, l.knee)), pole)
        return { ...l, hip, knee: r.mid }
      })
    }
    // standing like an athlete (idle.js): the captured body never freezes. Between points the
    // weight goes over one leg, then the other (the hips over the standing leg, the other hip
    // dropping); ready in a rally, a light bounce and small shifts. The pinned feet stay put
    // (the legs bend to them); the upper body and the hands ride along.
    const lw = springN(a.lifeW, idleQuiet * (1 - clamp(speed / 0.45, 0, 1)), 4, dt)
    if (lw > 1e-3 && life) {
      idleMove = add(mul(fr.r, life.shift * lw), V(0, life.bob * lw - Math.abs(life.shift) * 0.25 * lw, 0))
      const tilt = qaxis(fr.f, -life.roll * lw)
      const mv2 = (p) => add(add(pelvis, qrot(tilt, sub(p, pelvis))), idleMove)
      hipL = mv2(hipL)
      hipR = mv2(hipR)
      pelvisRight = norm(qrot(tilt, pelvisRight))
      // (the chest leans back over the hips a little: the spine stays about upright)
      neck = add(neck, idleMove)
      shoulderL = add(shoulderL, idleMove)
      shoulderR = add(shoulderR, idleMove)
      pelvis = add(pelvis, idleMove)
      legs = legs.map((l, i) => ({ ...l, hip: i ? hipR : hipL }))
    }
  } else a.mmDown = 0

  // ---- arms ----
  // targets are in the body frame around the ground point; the hands are springs in that
  // frame so a turn carries them along, then the pop limiter: a hand moves at most so far a
  // frame (a forward swing really is that fast; nothing else is)
  let handL = springV(a.hand, handT, k, dt)
  let axisL = norm(springV(a.axis, axisT, fast ? 200 : Math.min(k, 60), dt))
  let offL = springV(a.off, offT, 16 + 29 * Math.max(smoothW(W.relax), W.pumpO), dt)
  handL = a.handLim = limitStep(a.handLim, handL, (fast ? 16 : 7) * dt)
  axisL = a.axisLim = limitTurn(a.axisLim, axisL, (fast ? 40 : 12) * dt)
  offL = a.offLim = limitStep(a.offLim, offL, 6 * dt)
  // a two-handed backhand (and a two-handed player's ready position): the other hand rides on
  // the handle, exactly, however fast the swing
  const readyW = (1 - W.pumpP) * (1 - smoothW(W.relax)) * (1 - smoothW(W.hold)) * (1 - smoothW(W.mood))
  const twoT = so.two ? so.w : s.twoHand && !s.between ? readyW * (1 - so.w) : 0
  W.two = ramp(W.two, twoT, dt, 0.12, 0.12)
  if (W.two > 1e-3) {
    const grip = add(handL, mul(axisL, ON_HANDLE))
    offL = lerpV(offL, grip, smoothW(W.two))
    a.offLim = { ...offL }
    a.off.p = { ...offL }
  }
  const paddleSide = hand > 0 ? shoulderR : shoulderL
  const otherSide = hand > 0 ? shoulderL : shoulderR
  let handW = toWorld(ground, fr, handL)
  let offW = toWorld(ground, fr, offL)
  // (the gait's arms are made for the standard shoulders: moved with the real ones, so a crouch,
  // a lean or broad shoulders never shorten or stretch them: the elbows bend as gaitarms.js says)
  {
    const gw = (1 - smoothW(Math.min(1, so.w * 2))) * (1 - smoothW(W.hold)) * (1 - smoothW(W.mood)) * (1 - W.two)
    // (not over a paddle tap, a wipe of the hand on the shorts, an arm up tracking a lob)
    const tapW = bt.tap && !swing && !s.prep ? smoothW(bt.tap.w) : 0
    const wipeW = bt.wipe !== null && !swing && !s.prep ? smoothW(clamp(Math.sin(Math.PI * bt.wipe) * 1.6, 0, 1)) : 0
    const wP = gw * (1 - tapW) * Math.max(smoothW(W.relax), smoothW(Math.min(1, W.pumpP * 1.5)))
    const wO = gw * (1 - tapW) * (1 - wipeW) * (1 - smoothW(W.track || 0)) * Math.max(smoothW(W.relax), smoothW(Math.min(1, W.pumpO * 1.5)))
    const sP = hand > 0 ? shoulderR : shoulderL
    const sO = hand > 0 ? shoulderL : shoulderR
    // (from each real shoulder, in the chest's frame: the arms swing with the trunk as it turns
    // and leans; "up" halfway between the spine and plumb, the arms hang with gravity)
    if (wP > 1e-3 || wO > 1e-3) {
      const cu = norm(add(mul(norm(sub(neck, pelvis)), 0.5), mul(UP, 0.5)))
      const cf = norm(sub(chestF, mul(cu, dot(chestF, cu))), fr.f)
      const cr = norm(sub(sub(sr, mul(cu, dot(sr, cu))), mul(cf, dot(sr, cf))), fr.r)
      const place = (s0, l) => add(s0, add(add(mul(cr, l.x), mul(cu, l.y)), mul(cf, l.z)))
      if (wP > 1e-3) handW = lerpV(handW, place(sP, RH(sub(ga.P.hand, V(BODY.shoulderHalf, sh, 0.1)))), wP)
      if (wO > 1e-3) offW = lerpV(offW, place(sO, RH(sub(ga.O.hand, V(-BODY.shoulderHalf, sh, 0.1)))), wO)
    }
  }
  if (idleMove) {
    handW = add(handW, idleMove)
    offW = add(offW, idleMove)
  }
  // the arms have weight: they lag a little behind what the body does (a start, a stop, a
  // turn) and swing back on a soft spring; standing about, the hands are never quite still
  // (a slow drift of a centimeter or so). Not in a stroke, not with two hands on the handle.
  {
    const lagT = V(clamp(-mv.ax * 0.0055, -0.05, 0.05), 0, clamp(-mv.az * 0.0055, -0.05, 0.05))
    const lag = springV(a.armLag || (a.armLag = {}), lagT, 7, dt)
    const free = 1 - smoothW(Math.min(1, so.w * 2))
    const drift = still * (s.between ? 1 : 0.35)
    const dO = V(Math.sin(a.t * 0.71 + 1.3) * 0.009, Math.sin(a.t * 1.13) * 0.006, Math.sin(a.t * 0.93 + 0.4) * 0.011)
    const dP = V(Math.sin(a.t * 0.83 + 2.1) * 0.007, Math.sin(a.t * 1.29 + 0.7) * 0.005, Math.sin(a.t * 0.61 + 2.9) * 0.009)
    offW = add(offW, mul(add(lag, mul(dO, drift)), free * (1 - W.two)))
    handW = add(handW, mul(add(mul(lag, 0.5), mul(dP, drift)), free * (1 - W.two)))
  }
  let axisW = norm(dirToWorld(fr, axisL))
  // the elbows point where the stroke says (in the chest's frame, so they turn with it)
  const chestDir = (l) => norm(add(add(mul(sr, l.x), mul(UP, l.y)), mul(chestF, l.z)))
  const poleP = chestDir(poleT)
  const offUp = clamp((offL.y - sh) / 0.3, 0, 1) // (an arm raised: the elbow goes out to the side)
  let poleO = chestDir(V(-hand * lerp(0.6, 1, offUp), lerp(-1, -0.15, offUp), lerp(lerp(-0.15, -1, W.pumpO), 0.1, offUp)))
  // (walking about or running: the free arm's elbow where the gait has it, gaitarms.js)
  {
    const wArm = Math.max(smoothW(W.relax), smoothW(Math.min(1, W.pumpO * 1.5)))
    if (wArm > 1e-3) poleO = norm(lerpV(poleO, chestDir(RH(relaxed.offPole)), wArm))
  }
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
  const springNormal = springV(a.normal, normalW, normalT ? 200 : fast ? 30 : 14, dt)
  normalW = norm(sub(springNormal, mul(axisW, dot(springNormal, axisW))), fr.f)
  // (and the face turns round the handle no faster than a wrist turns it)
  normalW = a.normalOut = limitTurn(a.normalOut, normalW, normalT ? Math.PI : (fast ? 30 : 10) * dt)
  normalW = norm(sub(normalW, mul(axisW, dot(normalW, axisW))), fr.f)
  // (a paddle tap: the face turned to the other paddle; a twirl: spun round the handle)
  if (bt.tap) normalW = norm(lerpV(normalW, norm(sub(V(bt.tap.nx, 0, bt.tap.nz), mul(axisW, bt.tap.nx * axisW.x + bt.tap.nz * axisW.z)), normalW), smoothW(bt.tap.w)), normalW)
  if (bt.twirl) normalW = norm(qrot(qaxis(axisW, bt.twirl), normalW), normalW)

  // ---- the paddle's whole shape kept out of the body (paddlebody.js): its face, edge and
  // handle against the trunk, head, legs and this arm; turned at the wrist first, the hand
  // moved out only for what turning can't do (and the arm solved again); never right at
  // contact (the face is where the ball is). Then the other arm out of the paddle's way. The
  // skinned athletes check the drawn paddle again on their own bones (athlete.js). ----
  let armPf = armP
  let armOf = armO
  if (!a.noGuard && !(typeof window !== "undefined" && window.__pbNoGuard)) {
    const tRel = inp ? inp.tRel : null
    const exact = tRel === null || so.w < 0.3 ? 0 : clamp(1 - (Math.abs(tRel) - 0.05) / 0.12, 0, 1)
    // (how much the guard may move the face: none at contact, coming back slowly after it)
    const keep = (1 - exact) * (1 - exact)
    // (the other hand holding the paddle: a two-hander, the hand on the throat in the ready)
    const cup = so.w < 0.5 && W.relax < 0.5 && W.pumpO < 0.3 && len(sub(armO.end, armP.end)) < 0.2
    const holds = W.two >= 0.5 || cup
    const up = norm(sub(neck, pelvis))
    // (the other upper arm too; its forearm and hand move out of the way below)
    const J = { pelvis, neck, pelvisRight, chestRight: sr, head: add(neck, mul(up, 0.13)), headUp: up, headFwd: chestF, shoulderP: paddleSide, elbowP: armP.mid, wristP: armP.end, shoulderO: holds ? undefined : otherSide, elbowO: holds ? undefined : armO.mid, handTipO: null, hipL: legs[0].hip, kneeL: legs[0].knee, ankleL: legs[0].ankle, hipR: legs[1].hip, kneeR: legs[1].knee, ankleR: legs[1].ankle }
    bodyCapsules(J, { kind: "any", out: guardCaps })
    if (exact > 0.02) {
      // around contact: the face stays on the ball; the paddle rolls about the face's normal
      // (the handle and the hand swing round it) and the arm follows
      const face = add(armP.end, mul(axisW, BODY.paddleReach))
      const r = rollPaddle({ face, axis: axisW, normal: normalW }, guardCaps, { margin: GUARD.margin, skip: guardSkip, maxTurn: 1.1 * exact })
      if (Math.abs(r.angle) > 1e-3) {
        // (only if the arm reaches the hand's new place: the face stays on the ball)
        const want = sub(face, mul(r.paddle.axis, BODY.paddleReach))
        const st = { bend: a.ikP.bend }
        const arm = armIK(st, paddleSide, want, BODY.upperArm, BODY.forearm, poleP, { maxTurn: (fast ? 40 : 14) * dt })
        if (len(sub(arm.end, want)) < ROLL_REACH) {
          a.ikP.bend = st.bend
          armPf = arm
          axisW = a.axisOut = r.paddle.axis
        }
      }
    }
    if (keep > 0.02) {
      // (the correction is kept from frame to frame and eased back only once the paddle is clear:
      // worked out afresh each frame from the uncorrected paddle, it flipped between "in the
      // thigh" and "pushed out" every other frame on a run, the owner's "paddle vibrates in hand")
      const gq = a.gTurn || (a.gTurn = { x: 0, y: 0, z: 0, w: 1 })
      const gs = a.gShift || (a.gShift = V())
      let ax0 = norm(qrot(gq, axisW), axisW)
      let nm0 = norm(qrot(gq, normalW), normalW)
      if (len(gs) > 0.0005) armPf = armIK(a.ikP, paddleSide, add(armPf.end, mul(gs, keep)), BODY.upperArm, BODY.forearm, poleP, { maxTurn: (fast ? 40 : 14) * dt })
      const pdl = { face: add(armPf.end, mul(ax0, BODY.paddleReach)), axis: ax0, normal: nm0 }
      const r = resolvePaddle(pdl, guardCaps, { pivot: armPf.end, margin: GUARD.margin, skip: guardSkip, maxTurn: 0.9 * keep, maxShift: 0.14 * keep })
      a.guard = r.before
      if (r.before > -GUARD.margin) {
        ax0 = r.paddle.axis
        nm0 = r.paddle.normal
        a.gTurn = qmul(r.turn, gq)
        if (len(r.shift) > 0.0005) {
          a.gShift = add(gs, r.shift)
          // (the hand goes out: the arm solved again to it)
          armPf = armIK(a.ikP, paddleSide, add(armPf.end, r.shift), BODY.upperArm, BODY.forearm, poleP, { maxTurn: (fast ? 40 : 14) * dt })
        }
      } else if (r.before < -2.5 * GUARD.margin) {
        // clear by a good margin: the correction eases away (a third of it a second... gently)
        const f = Math.exp(-dt * 2.5)
        a.gTurn = qscale(gq, f)
        a.gShift = mul(gs, f)
      }
      // (a.axisOut / normalOut keep the uncorrected paddle for the limiters: the kept correction
      // goes on top again next frame)
      axisW = ax0
      normalW = nm0
    } else {
      a.gTurn = null
      a.gShift = null
    }
    // the other arm out of the paddle's way (not while it holds it)
    if (!holds) {
      const pdl = { face: add(armPf.end, mul(axisW, BODY.paddleReach)), axis: axisW, normal: normalW }
      for (let i = 0; i < 4; i++) {
        const tip = add(armOf.end, mul(norm(sub(armOf.end, armOf.mid)), 0.13))
        offCaps.length = 0
        offCaps.push(capsule(otherSide, armOf.mid, 0.063, 0.049, "upperarmO"), capsule(armOf.mid, armOf.end, 0.042, 0.026, "forearmO"), capsule(armOf.end, tip, 0.028, 0.022, "handO"))
        const d = paddleDepth(pdl, offCaps, { margin: GUARD.margin })
        if (d.depth <= -GUARD.margin) break
        offW = sub(armOf.end, mul(d.n, d.depth + GUARD.margin * 1.5))
        armOf = armIK(a.ikO, otherSide, offW, BODY.upperArm, BODY.forearm, poleO, { maxTurn: 12 * dt })
      }
    }
  }

  // ---- the head looks at the ball: smoothly, within a neck's reach, at a top speed ----
  const headBase = add(neck, mul(spineDir, BODY.neck))
  const lookW = norm(sub(V(lookAt.x, lookAt.y, lookAt.z), headBase), chestF)
  const lookS = norm(springV(a.head, lookW, 14, dt), chestF)
  const head = lookToward(a.look, lookS, chestF, dt, { maxYaw: 1.25, maxUp: 0.6, maxDown: 0.75, rate: 8 })
  // (next frame's room for a ball at the body: ROOM)
  a.lastBody = { pelvis, neck, f: chestF }
  a.lastKnees = [legs[0].knee, legs[1].knee]
  // (the arms' swing next frame: how far the left ankle leads the right, gaitarms.js)
  a.lastSpread = (legs[0].ankle.x - legs[1].ankle.x) * fr.f.x + (legs[0].ankle.z - legs[1].ankle.z) * fr.f.z
  return {
    yaw: a.yaw,
    pelvis,
    pelvisRight,
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
    elbowP: armPf.mid,
    wristP: armPf.end,
    elbowO: armOf.mid,
    wristO: armOf.end,
    // where the elbows point (smooth, even with an arm straight): the athletes' IK poles
    bendP: armPf.bend,
    bendO: armOf.bend,
    paddle: { grip: armPf.end, axis: axisW, normal: normalW, face: add(armPf.end, mul(axisW, BODY.paddleReach)) },
    hand,
    // for the skinned athletes' motion-capture layers (athlete.js)
    info: { breath: life.breath, breathDepth: life.depth, speed, phase: a.gait.phase, cycle: a.gait.cycle, moving: a.gait.moving, blend: a.gait.blend.weights, timeScale: a.gait.blend.timeScale, facing: a.face.mode || "face", swinging: !!(swing || s.prep || whiff), between: !!s.between, holding: !!s.holding, mood: mood ? { kind: mood.kind, variant: mood.variant } : null, stroke: so.w, style: so.style, fast, ready: (1 - W.pumpP) * (1 - smoothW(W.relax)), offGrip: so.w < 0.5 && W.relax < 0.5 && W.pumpO < 0.3 && !mood && !s.holding, fist: mood?.kind === "cheer", strokePhase: so.phase, tRel: inp ? inp.tRel : null, tap: !!(bt.tap || bt.twirl), aim: aimAt ? { x: aimAt.x, y: aimAt.y, z: aimAt.z, ttc: -inp.tRel } : null, side: so.side, two: W.two > 0.5, footwork: fc.mode, split: a.hop > 0, lunge: lunging, mm: mmo ? { v: mmo.v, contacts: mmo.contacts, locked: mmo.locked, searches: mmo.stats.searches, jumps: mmo.stats.jumps, gap: Math.hypot(mmo.root.x - s.x, mmo.root.z - s.z) } : null },
  }
}

// When player q will hit the ball (seconds from now), or null if not known: the serve as the
// dropped ball reaches the contact height, or the contact they expect
const SERVE_HIT = (ball) => {
  const vy = -ball.v.y
  const drop = Math.max(0, ball.p.y - SERVE_Y)
  return (Math.sqrt(Math.max(0, vy * vy + 2 * 9.81 * drop)) - vy) / 9.81
}
export const hitClock = (m, q) => {
  const r = m.rally
  if (!r || m.phase !== "rally" && m.phase !== "serve") return null
  if (q.serving && r.hits === 0) return m.ball.held === q.id ? null : SERVE_HIT(m.ball)
  if (r.lastTeam === q.team || !q.expect || m.ball.held) return null
  // (their own predicted contact, from their situation this frame or the last: the AI hits
  // the first moment it can, not at its planned instant)
  const age = m.t - (q.animPrepT ?? -9)
  if (age >= 0 && age < 0.05 && q.animPrepTtc !== null && q.animPrepTtc !== undefined) return q.animPrepTtc - age
  const t = q.expect.at - m.t
  return t > -0.1 && t < 1.5 ? t : null
}

// What a player is doing, read from the match, for updateAnim. me: the match player; m: the
// match (or an online copy of it); predicted: the contact this player expects (or null)
export const situation = (m, p) => {
  const ball = m.ball
  const r = m.rally
  const team = p.team
  const hand = p.hand === -1 ? -1 : 1
  const facing = team === 0 ? Math.PI : 0
  const between = m.phase === "dead" || m.phase === "intro" || m.phase === "over"
  const holding = ball.held === p.id
  let prep = null
  const swing = p.swing && !p.swing.whiff && p.swing.t < 0.75 ? p.swing : p.swing?.whiff ? p.swing : null
  // the serve: once the ball is let go, the swing meets it as it drops to the contact height
  if (!holding && p.serving && r && r.hits === 0) {
    const ttc = SERVE_HIT(ball)
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
      const local = (e.x - p.x) * (team === 0 ? 1 : -1) * hand
      // a person's swing shape from how long they've held the hit control (the pace)
      const pace = p.armed?.pace ?? (p.charge ? Math.max(0, Math.min(1, (m.t - p.charge.start - 0.05) / 0.42)) : null)
      const kind = pace !== null ? guessKind(pace, e, p) : e.y > 1.35 && Math.abs(p.z) < 5 ? "smash" : Math.abs(p.z) < 3.4 ? (e.volley ? "punch" : "dink") : e.volley ? "block" : "drive"
      // (a hand battle: a fast ball at someone near the net, match.js handBattle)
      const fast = Math.hypot(ball.v.x, ball.v.y, ball.v.z) > FAST_BALL && Math.abs(p.z) < 4.6
      prep = { ttc, x: e.x, y: e.y, z: e.z, kind, hand: local >= -0.05 ? "fh" : "bh", forward: !human || !!p.armed, volley: !!e.volley, id: r.hits, fast }
    }
  }
  if (p.charge?.kind === "serve") prep = null
  // an overhead on its way (presentation: the body turns sideways as soon as the lob is read,
  // before the swing's own window opens; pro.js OVERHEAD_SET)
  let high = null
  if (!between && !prep && p.expect && r && r.lastTeam !== team && !ball.held && (p.ctrl === "cpu" || p.ctrl === "feeder" || p.charge || p.armed)) {
    const ttc = p.expect.at - m.t
    if (p.expect.y > OVERHEAD_SET.y && ttc > 0 && ttc < OVERHEAD_SET.readAt) high = { ttc, x: p.expect.x, y: p.expect.y, z: p.expect.z, kind: "smash" }
  }
  // (remembered for the other side's split steps: hitClock; presentation only)
  p.animPrepT = m.t
  p.animPrepTtc = prep && prep.kind !== "serve" && prep.forward ? prep.ttc : null
  // the other side's next hit (the split step lands on it)
  let oppHit = null
  if (!between) for (const q of m.players) {
    if (q.team === team) continue
    const t = hitClock(m, q)
    if (t !== null && (oppHit === null || t < oppHit)) oppHit = t
  }
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
    high,
    charging: !!p.charge,
    between,
    atNet: Math.abs(p.z) < 3.4,
    // (how far from the net: the ready position blends kitchen / transition / baseline)
    depth: Math.abs(p.z),
    // where they're heading (a computer player's spot, or the stand-in's intercept)
    goal: p.target && (between || p.ctrl === "cpu") ? { x: p.target.x, z: p.target.z } : p.intercept?.stand && !p.intercept.letGo ? { x: p.intercept.stand.x, z: p.intercept.stand.z } : null,
    hand,
    twoHand: !!p.twoHand,
    // (a person's player: nothing moves where they stand for them; making room is a lean only)
    person: p.ctrl === "human" || p.ctrl === "remote",
    oppHit,
    // the velocity the match is taking them toward (motion matching predicts the path from it)
    want: p.want ? { x: p.want.x, z: p.want.z } : null,
    // between points (between.js): the phase, the partner and the player across the net, the
    // point count, who's receiving
    id: p.id,
    phase: m.phase,
    phaseT: m.phaseT ?? 0,
    point: m.stats?.rallies ?? 0,
    mate: mateOf(m, p),
    across: acrossOf(m, p),
    receiving: m.phase === "serve" && !!r && p.team !== m.game?.serving && Math.abs(p.z) > 5.4,
  }
}
const mateOf = (m, p) => {
  const q = m.players.find((o) => o !== p && o.team === p.team)
  return q ? { x: q.x, z: q.z, id: q.id } : null
}
const acrossOf = (m, p) => {
  let best = null
  let bd = Infinity
  for (const q of m.players) {
    if (q.team === p.team) continue
    const d = Math.hypot(q.x - p.x, q.z - p.z)
    if (d < bd) {
      bd = d
      best = { x: q.x, z: q.z, id: q.id }
    }
  }
  return best
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
// (My Park's benches and bleachers: opts.drop / opts.ahead put the feet on the ground in front
// of a low seat; opts.clap (a clock, s) claps the hands in front of the chest)
export const seatedPose = (seat, lookAt, signal = null, { drop = 0.72, ahead = 0.36, clap = null } = {}) => {
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
    const foot = toWorld(o, fr, V((i ? 1 : -1) * 0.14, seat.y - drop, ahead))
    const ik = twoBone(hip, V(foot.x, foot.y + BODY.ankle, foot.z), BODY.thigh, BODY.shin, fr.f)
    return { knee: ik.mid, ankle: ik.end, foot: { x: ik.end.x, y: ik.end.y - BODY.ankle, z: ik.end.z, yaw: seat.yaw, pitch: 0, planted: true } }
  })
  const rest = (side) => toWorld(o, fr, V(side * 0.16, seat.y + 0.2, 0.3))
  let handR = rest(1)
  let handL = rest(-1)
  if (clap !== null) {
    // hands meeting in front of the chest, about two and a half claps a second
    const gap = 0.025 + 0.085 * (0.5 + 0.5 * Math.cos(clap * Math.PI * 5))
    const front = add(add(neck, mul(spine, -0.16)), mul(fr.f, 0.3))
    handR = add(front, mul(sr, gap))
    handL = add(front, mul(sr, -gap))
  }
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
