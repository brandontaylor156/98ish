// My Park leisure: the body in the water (pure; Node-tested). Poses in the same shape anim.js
// gives the athletes (world positions of every joint; seatedPose's keys), so the skinned athlete
// and the mannequin both take them:
//   swimPose({ x, z, yaw, t, style, surface, speed })  style: "free" (freestyle, face down, the
//     arms over the water in turn, a flutter kick, a breath to the side every other stroke),
//     "tread" (upright, head and shoulders out, sculling), "float" (on your back, arms out)
//   tuckPose({ x, y, z, yaw })                     a cannonball in the air
//   tubPose(seat, lookAt)                          sitting in the hot tub, arms along the rim
// The water hides what's under it (the pool is drawn level with the deck, and the body under its
// surface is under the ground): what shows is the head, the back and the arms coming over.

import { BODY, frame, seatedPose, twoBone } from "../../anim.js"

const V = (x = 0, y = 0, z = 0) => ({ x, y, z })
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z)
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z)
const mul = (a, s) => V(a.x * s, a.y * s, a.z * s)
const cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
const norm = (a) => {
  const l = Math.hypot(a.x, a.y, a.z)
  return l > 1e-9 ? mul(a, 1 / l) : V(0, 1, 0)
}
const UP = V(0, 1, 0)
const DOWN = V(0, -1, 0)
const TAU = Math.PI * 2

// strokes a second at full speed (an easy freestyle: ~0.6 cycles a second)
export const STROKE_RATE = 0.62
// how deep the hips ride under the surface
export const DEPTH = { free: 0.12, tread: 0.58, float: 0.06 }

const limb = (root, target, l1, l2, pole) => twoBone(root, target, l1, l2, pole)
const footAt = (ankle, yaw, pitch) => ({ x: ankle.x, y: ankle.y - BODY.ankle, z: ankle.z, yaw, pitch, planted: false })

// one body from its frame: pelvis, spine (pelvis -> neck), chest forward and right
const torso = (pelvis, spine, cf, cr) => {
  const neck = add(pelvis, mul(spine, BODY.spine))
  const shoulderR = add(sub(neck, mul(spine, 0.045)), mul(cr, BODY.shoulderHalf))
  const shoulderL = add(sub(neck, mul(spine, 0.045)), mul(cr, -BODY.shoulderHalf))
  const hipR = add(pelvis, mul(cr, BODY.hipHalf))
  const hipL = add(pelvis, mul(cr, -BODY.hipHalf))
  const head = add(neck, mul(spine, BODY.neck))
  return { neck, shoulderR, shoulderL, hipR, hipL, head }
}
const assemble = ({ yaw, pelvis, spine, cf, cr, T, look, armR, armL, legR, legL, footR, footL }) => ({
  yaw,
  pelvis,
  pelvisRight: cr,
  spine,
  neck: T.neck,
  chestRight: cr,
  chestForward: cf,
  head: T.head,
  look,
  shoulderL: T.shoulderL,
  shoulderR: T.shoulderR,
  hipL: T.hipL,
  hipR: T.hipR,
  kneeL: legL.mid,
  kneeR: legR.mid,
  ankleL: legL.end,
  ankleR: legR.end,
  footL,
  footR,
  paddleShoulder: T.shoulderR,
  elbowP: armR.mid,
  wristP: armR.end,
  elbowO: armL.mid,
  wristO: armL.end,
  paddle: { grip: armR.end, axis: norm(sub(armR.end, armR.mid)), normal: cf, face: armR.end },
  hand: 1,
  water: true,
})

// the arm's hand in a freestyle stroke at phase p (0..1): the catch out front, the pull under the
// body to the hip, then out and over the water forward again (elbow high)
export const strokeHand = (S, f, r, side, p) => {
  if (p < 0.55) {
    const k = p / 0.55
    return { hand: add(add(add(S, mul(f, 0.6 - 0.92 * k)), mul(r, side * (0.1 + 0.04 * Math.sin(Math.PI * k)))), mul(DOWN, 0.22 + 0.2 * Math.sin(Math.PI * k))), pole: add(UP, mul(r, side * 0.4)), over: false }
  }
  const k = (p - 0.55) / 0.45
  return { hand: add(add(add(S, mul(f, -0.32 + 0.92 * k)), mul(r, side * (0.24 - 0.08 * k))), mul(UP, 0.08 + 0.26 * Math.sin(Math.PI * k))), pole: add(UP, mul(r, side * 0.9)), over: true }
}

export const swimPose = ({ x, z, yaw, t = 0, style = "free", surface = 0.02, speed = 1 } = {}) => {
  const { f, r } = frame(yaw)
  if (style === "free") {
    const ph = (t * STROKE_RATE * (0.6 + 0.4 * Math.min(1, speed))) % 1
    // the body rolls toward the arm that's pulling (about 35 degrees each way)
    const roll = 0.6 * Math.sin(ph * TAU)
    const spine = norm(add(f, mul(UP, 0.28)))
    const cf0 = norm(cross(spine, r)) // (face down: the chest toward the pool floor)
    const cf = norm(add(mul(cf0, Math.cos(roll)), mul(r, Math.sin(roll))))
    const cr = norm(cross(cf, spine))
    const pelvis = add(V(x, surface - DEPTH.free, z), mul(f, -0.35))
    const T = torso(pelvis, spine, cf, cr)
    const hR = strokeHand(T.shoulderR, f, r, 1, ph)
    const hL = strokeHand(T.shoulderL, f, r, -1, (ph + 0.5) % 1)
    const armR = limb(T.shoulderR, hR.hand, BODY.upperArm, BODY.forearm, hR.pole)
    const armL = limb(T.shoulderL, hL.hand, BODY.upperArm, BODY.forearm, hL.pole)
    // the flutter kick: straight legs from the hips, the feet a little up and down in turn
    const kick = (side) => 0.11 * Math.sin(t * 9 + (side > 0 ? 0 : Math.PI))
    const legOf = (hip, side) => limb(hip, add(add(hip, mul(spine, -(BODY.thigh + BODY.shin) * 0.97)), mul(UP, kick(side))), BODY.thigh, BODY.shin, DOWN)
    const legR = legOf(T.hipR, 1)
    const legL = legOf(T.hipL, -1)
    // (a breath to the side every other stroke: the head turns toward the recovering arm)
    const breath = Math.max(0, Math.sin(ph * TAU * 0.5)) ** 4
    const look = norm(add(add(mul(f, 0.55), mul(DOWN, 0.8 - 0.6 * breath)), mul(r, -0.9 * breath)))
    return assemble({ yaw, pelvis, spine, cf, cr, T, look, armR, armL, legR, legL, footR: footAt(legR.end, yaw, Math.PI), footL: footAt(legL.end, yaw, Math.PI) })
  }
  if (style === "float") {
    // on your back, head toward where you face, arms out, toes up
    const spine = norm(add(f, mul(UP, 0.2)))
    const cf = UP
    const cr = norm(cross(cf, spine))
    const bob = 0.02 * Math.sin(t * 1.3)
    const pelvis = add(V(x, surface - DEPTH.float + bob, z), mul(f, -0.35))
    const T = torso(pelvis, spine, cf, cr)
    const out = (S, side) => add(add(S, mul(cr, side * 0.5)), mul(f, 0.1 + 0.06 * Math.sin(t * 0.8 + side)))
    const armR = limb(T.shoulderR, out(T.shoulderR, 1), BODY.upperArm, BODY.forearm, add(DOWN, mul(f, -0.3)))
    const armL = limb(T.shoulderL, out(T.shoulderL, -1), BODY.upperArm, BODY.forearm, add(DOWN, mul(f, -0.3)))
    const legOf = (hip, side) => limb(hip, add(add(hip, mul(spine, -(BODY.thigh + BODY.shin) * 0.95)), mul(cr, side * 0.1)), BODY.thigh, BODY.shin, UP)
    const legR = legOf(T.hipR, 1)
    const legL = legOf(T.hipL, -1)
    const look = norm(add(UP, mul(f, 0.4)))
    return assemble({ yaw, pelvis, spine, cf, cr, T, look, armR, armL, legR, legL, footR: footAt(legR.end, yaw + Math.PI, 0), footL: footAt(legL.end, yaw + Math.PI, 0) })
  }
  // treading water: upright, head and shoulders out, the hands sculling, the legs turning
  const spine = norm(add(UP, mul(f, 0.12)))
  const cf = norm(cross(spine, r))
  const cr = r
  const bob = 0.035 * Math.sin(t * 2.6)
  const pelvis = V(x, surface - DEPTH.tread + bob, z)
  const T = torso(pelvis, spine, cf, cr)
  const scull = (S, side) => add(add(add(S, mul(f, 0.3)), mul(r, side * (0.28 + 0.1 * Math.sin(t * 3.2 + (side > 0 ? 0 : Math.PI))))), mul(DOWN, 0.3))
  const armR = limb(T.shoulderR, scull(T.shoulderR, 1), BODY.upperArm, BODY.forearm, add(DOWN, mul(r, 0.8)))
  const armL = limb(T.shoulderL, scull(T.shoulderL, -1), BODY.upperArm, BODY.forearm, add(DOWN, mul(r, -0.8)))
  const legOf = (hip, side) => {
    const a = t * 3 + (side > 0 ? 0 : Math.PI)
    return limb(hip, add(add(add(hip, mul(DOWN, 0.62)), mul(f, 0.1 + 0.08 * Math.sin(a))), mul(r, side * (0.2 + 0.08 * Math.cos(a)))), BODY.thigh, BODY.shin, add(f, mul(r, side * 0.6)))
  }
  const legR = legOf(T.hipR, 1)
  const legL = legOf(T.hipL, -1)
  return assemble({ yaw, pelvis, spine, cf, cr, T, look: norm(add(f, mul(DOWN, 0.05))), armR, armL, legR, legL, footR: footAt(legR.end, yaw, 0.7), footL: footAt(legL.end, yaw, 0.7) })
}

// a cannonball: knees hugged to the chest, in the air at height y (the pelvis)
export const tuckPose = ({ x, y, z, yaw }) => {
  const { f, r } = frame(yaw)
  const spine = norm(add(UP, mul(f, 0.35)))
  const cf = norm(add(f, mul(UP, -0.35)))
  const cr = r
  const pelvis = V(x, y, z)
  const T = torso(pelvis, spine, cf, cr)
  const legOf = (hip, side) => limb(hip, add(add(hip, mul(f, 0.3)), mul(DOWN, 0.18)), BODY.thigh, BODY.shin, add(f, mul(UP, 0.8)))
  const legR = legOf(add(T.hipR, mul(r, 0.03)), 1)
  const legL = legOf(add(T.hipL, mul(r, -0.03)), -1)
  // (the hands round the shins, just under the knees)
  const hug = (knee, side) => add(add(knee, mul(f, 0.06)), add(mul(DOWN, 0.1), mul(r, side * 0.02)))
  const armR = limb(T.shoulderR, hug(legR.mid, 1), BODY.upperArm, BODY.forearm, add(mul(r, 1), DOWN))
  const armL = limb(T.shoulderL, hug(legL.mid, -1), BODY.upperArm, BODY.forearm, add(mul(r, -1), DOWN))
  return assemble({ yaw, pelvis, spine, cf, cr, T, look: norm(add(f, mul(DOWN, 0.4))), armR, armL, legR, legL, footR: footAt(legR.end, yaw, 0.9), footL: footAt(legL.end, yaw, 0.9) })
}

// sitting in the hot tub: on the bench inside, shoulders at the water, arms out along the rim
export const tubPose = (seat, lookAt, { rim = 0.5, t = 0 } = {}) => {
  const p = seatedPose({ x: seat.x, y: seat.y, z: seat.z, yaw: seat.yaw }, lookAt, null, { drop: Math.max(0.05, seat.y - 0.02), ahead: 0.42 })
  const { f, r } = frame(seat.yaw)
  // (the hands on the rim behind and to each side; a little sway in the warm water)
  const sway = 0.02 * Math.sin(t * 0.9)
  const onRim = (S, side) => V(S.x + r.x * side * 0.36 - f.x * 0.3, rim + 0.04 + sway, S.z + r.z * side * 0.36 - f.z * 0.3)
  const armR = twoBone(p.shoulderR, onRim(p.shoulderR, 1), BODY.upperArm, BODY.forearm, add(DOWN, mul(f, -0.6)))
  const armL = twoBone(p.shoulderL, onRim(p.shoulderL, -1), BODY.upperArm, BODY.forearm, add(DOWN, mul(f, -0.6)))
  return { ...p, elbowP: armR.mid, wristP: armR.end, elbowO: armL.mid, wristO: armL.end, paddle: { ...p.paddle, grip: armR.end, face: armR.end }, water: true }
}
