// Pickleball 98: the athletes' arms. Pure JavaScript (no three.js), tested in Node
// (arms.test.js). The anatomy behind the numbers, with sources: docs/pickleball-arms.md.
//
// - armMetrics: reads the drawn bones and reports, per arm, what an anatomist would: the
//   elbow's flexion, the upper arm's elevation and direction against the chest, the humerus'
//   rotation (where the elbow crease faces), the forearm's pronation, the wrist's flexion and
//   deviation, the shoulder girdle, where the elbow points, any stretch, the fingers' curl,
//   and whether the arm is inside the torso (tests and filmstrips).
// - The arm solver (solveArm, solvePaddleArm): two-bone IK on the model's own bones with real
//   joint limits. The elbow never locks straight or stretches (a soft reach: the arm comes
//   up just short instead, and the shoulder girdle reaches the rest of the way); the elbow's
//   direction (the swivel round the shoulder-wrist line) is chosen, not given: the one that
//   keeps the humerus' rotation, the forearm's twist and the wrist inside their ranges, the
//   elbow out of the torso, near where the stroke wants it and near last frame's. For the
//   paddle arm the paddle's roll about its own face normal is free too (the face's center and
//   its normal stay exactly where the shot needs them), and which face the palm is behind:
//   that's what keeps the wrist from bending past what a wrist can do.
// - The wrist and the forearm's twist: the hand's rotation against the forearm split into a
//   twist about the forearm (pronation / supination) and a swing (flexion / deviation), each
//   limited; the twist is shared out along the forearm by twist bones (the skinning: twist
//   weights), so the forearm turns like a radius round the ulna instead of wringing at the
//   elbow or the wrist.
// - The shoulder girdle (clavicleFor): the clavicle rises as the arm goes above about 40
//   degrees (the scapulohumeral rhythm), comes forward (protraction) on reaches in front and
//   across, back on a backswing.
// - Hands (FINGERS, fingerPose): relaxed (a cascade: each finger a little more curled than
//   the one before, the thumb resting), the grip round the handle, cupped, a fist, open.

import { Q, qmul, qinv as qinvQ, qrot as qrotQ, qaxis, qnorm, qslerp, qangle, frameOf } from "./mm/quat.js"
import { resolvePaddle } from "./paddlebody.js"

const V = (x = 0, y = 0, z = 0) => ({ x, y, z })
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z)
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z)
const mul = (a, s) => V(a.x * s, a.y * s, a.z * s)
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
const len = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
const norm = (a, fb = V(0, 1, 0)) => {
  const l = len(a)
  return l > 1e-9 ? mul(a, 1 / l) : { ...fb }
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const DEG = 180 / Math.PI
const RAD = Math.PI / 180
const qrot = qrotQ
const qinv = qinvQ
const perp = (v, a) => sub(v, mul(a, dot(v, a)))
// signed angle from u to v about axis a (all unit-ish), radians
const signedAbout = (u, v, a) => Math.atan2(dot(a, cross(u, v)), dot(u, v))
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a))
// the world rotation taking a bone's rest directions (p0 along it, s0 fixing its roll) to p, s
export const aimDelta = (p0, s0, p, s) => qmul(frameOf(p, s), qinv(frameOf(p0, s0)))
// (Rodrigues) v turned by angle about the unit axis k
const turn = (v, k, angle) => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)))
}
// the twist angle of q about the unit axis a (q = swing * twist)
export const twistOf = (q, a) => wrapA(2 * Math.atan2(q.x * a.x + q.y * a.y + q.z * a.z, q.w))

// ---- joint ranges (degrees; docs/pickleball-arms.md) ----
// elbow: flexion from straight (soft: where the soft reach starts); pron: the forearm from
// neutral (thumb up), - supination, + pronation; flex: the wrist, - extension, + flexion; dev:
// - ulnar, + radial; hum: the humerus from where an arm swung straight up from hanging has it
// (the crease forward), - internal, + external rotation
export const JOINTS = {
  elbow: { min: 7, soft: 22, max: 145 },
  pron: { min: -80, max: 75 },
  flex: { min: -65, max: 70 },
  dev: { min: -30, max: 18 },
  hum: { min: -80, max: 95 },
}
// a relaxed arm's elbow never quite straightens (a hanging arm's rests 10-20 degrees bent)
export const RELAXED_ELBOW = { min: 13, soft: 32, max: 145 }
// where a hand rests when nothing makes it go further (away from contact: the paddle follows
// the hand, so there's no reason for a wrist at its end stop)
export const COMFORT = { ...JOINTS, hum: { min: -80, max: 70 }, pron: { min: -60, max: 60 }, flex: { min: -40, max: 45 }, dev: { min: -22, max: 10 } }

// The bones armMetrics reads
export const ARM_PROBE = ["spine_03", "pelvis", "neck_01", "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r", "middle_01_l", "middle_01_r", "middle_02_l", "middle_02_r", "middle_03_l", "middle_03_r", "index_01_l", "index_01_r", "index_02_l", "index_02_r", "thumb_01_l", "thumb_01_r", "thumb_02_l", "thumb_02_r"]

// The rest references, from a model's rest pose (rest: { name: { wq, wp } } in world space;
// the model faces +z with its left at +x, arms out in a T, palms down): each direction kept in
// the bone's own space, so it follows the bone
export const armReference = (rest) => {
  const loc = (bone, v) => qrot(qinv(rest[bone].wq), v)
  const ref = { chest: { right: loc("spine_03", V(-1, 0, 0)), up: loc("spine_03", V(0, 1, 0)), fwd: loc("spine_03", V(0, 0, 1)) } }
  for (const s of ["l", "r"]) {
    const hand = rest["hand_" + s]
    const finger = norm(sub(rest["middle_01_" + s].wp, hand.wp))
    const thumb0 = sub(rest["thumb_01_" + s].wp, hand.wp)
    let palm = norm(cross(finger, thumb0))
    if (s === "r") palm = mul(palm, -1)
    const thumb = norm(perp(thumb0, finger))
    ref[s] = {
      palm: loc("hand_" + s, palm),
      thumb: loc("hand_" + s, thumb),
      finger: loc("hand_" + s, finger),
      // (the elbow's crease faces forward in a T-pose with the palms down)
      crease: loc("upperarm_" + s, V(0, 0, 1)),
      clavicle: norm(sub(rest["upperarm_" + s].wp, rest["clavicle_" + s].wp)),
    }
  }
  return ref
}

// The paddle in a hand (a continental, "handshake" grip): the handle runs diagonally across
// the palm, from the heel of the hand toward the thumb and index finger, the face out past
// them; its frame (y the handle toward the face, z the face's normal on the palm's side) and
// the grip's center (just in front of the palm) in the hand bone's own space
export const gripFrame = (rest, side) => {
  const hand = rest["hand_" + side]
  const finger = norm(sub(rest["middle_01_" + side].wp, hand.wp))
  const thumb0 = sub(rest["thumb_01_" + side].wp, hand.wp)
  let palm = norm(cross(finger, thumb0))
  if (side === "r") palm = mul(palm, -1)
  const across = norm(cross(palm, finger))
  const acrossS = dot(across, thumb0) > 0 ? across : mul(across, -1) // (toward the thumb)
  const axis = norm(add(mul(acrossS, 0.86), mul(finger, 0.5)))
  const normal = norm(sub(palm, mul(axis, dot(palm, axis))))
  const center = add(add(hand.wp, mul(finger, 0.072)), mul(palm, 0.028))
  const handInv = qinv(hand.wq)
  return { q: qmul(handInv, frameOf(axis, normal)), p: qrot(handInv, sub(center, hand.wp)), palmLocal: qrot(handInv, palm) }
}

// the humerus' rotation (radians, + external): the crease against where it would face with
// the arm swung straight from hanging (the crease forward); ua: the upper arm's direction,
// chest: { up, fwd }; sg: +1 left arm, -1 right
export const humeralOf = (ua, crease, chest, sg) => {
  const down = mul(chest.up, -1)
  const ax = cross(down, ua)
  let ref
  if (len(ax) < 1e-4) ref = dot(down, ua) > 0 ? chest.fwd : mul(chest.fwd, -1)
  else ref = turn(chest.fwd, norm(ax), Math.acos(clamp(dot(down, ua), -1, 1)))
  ref = norm(perp(ref, ua))
  return -sg * signedAbout(ref, norm(perp(crease, ua)), ua)
}

// bones: { name: { p, q } } world; ref: armReference; opts: { paddleSide, stretch: { l, r } }
export const armMetrics = (bones, ref, opts = {}) => {
  const chestQ = bones.spine_03.q
  const right = norm(qrot(chestQ, ref.chest.right))
  const up = norm(qrot(chestQ, ref.chest.up))
  const fwd = norm(qrot(chestQ, ref.chest.fwd))
  const chest = (v) => ({ x: dot(v, right), y: dot(v, up), z: dot(v, fwd) }) // (x: the figure's right)
  const pelvis = bones.pelvis.p
  const neck = bones.neck_01.p
  const out = {}
  for (const s of ["l", "r"]) {
    const sg = s === "l" ? 1 : -1 // (+1: the left arm; the figure's left is -right)
    const S = bones["upperarm_" + s].p
    const E = bones["lowerarm_" + s].p
    const W = bones["hand_" + s].p
    const ua = norm(sub(E, S))
    const fa = norm(sub(W, E))
    const elbow = 180 - Math.acos(clamp(dot(mul(ua, -1), fa), -1, 1)) * DEG
    // the upper arm against the chest: how far up from hanging (0 = down along the side, 90 =
    // level), and which way (0 = forward, 90 = out to its own side, 180 = back)
    const uc = chest(ua)
    const elevation = Math.acos(clamp(-uc.y, -1, 1)) * DEG
    const azimuth = Math.atan2(-sg * uc.x, uc.z) * DEG
    // where the elbow points (away from the shoulder-wrist line), in the chest's frame
    const mid = mul(add(S, W), 0.5)
    const out0 = perp(sub(E, mid), norm(sub(W, S)))
    const ep = len(out0) > 0.01 ? chest(norm(out0)) : null
    const crease = norm(perp(qrot(bones["upperarm_" + s].q, ref[s].crease), ua))
    const humeral = humeralOf(ua, crease, { up, fwd }, sg) * DEG
    // the forearm: the palm against the elbow crease, round the forearm (0 = palm facing the
    // same way as the crease, supinated; 90 = neutral, thumb up; 180 = pronated)
    const palm = norm(qrot(bones["hand_" + s].q, ref[s].palm))
    // (the crease carried round the elbow's hinge onto the forearm: a plain projection would
    // flip over past 90 degrees of flexion)
    const hinge = norm(cross(ua, crease))
    const creaseF = norm(cross(hinge, fa))
    // (read from the thumb's side of the hand: a flexed or deviated wrist doesn't change it)
    const thumb = norm(qrot(bones["hand_" + s].q, ref[s].thumb))
    const thumbF = norm(perp(thumb, fa))
    let pronation = 90 + sg * signedAbout(creaseF, thumbF, fa) * DEG
    if (pronation < -90) pronation += 360 // (-90..270: outside about -10..190 the forearm is wrung)
    // the wrist: the forearm's direction seen from the hand (fingers bent toward the palm tip
    // it toward the back of the hand)
    const finger = bones["middle_01_" + s] ? norm(sub(bones["middle_01_" + s].p, W)) : norm(qrot(bones["hand_" + s].q, ref[s].finger))
    const fx = dot(fa, finger)
    const flexion = Math.atan2(-dot(fa, palm), fx) * DEG // (+: flexion, toward the palm; -: extension)
    const deviation = Math.atan2(-dot(fa, thumb), fx) * DEG // (+: radial, toward the thumb)
    const wristBend = Math.acos(clamp(fx, -1, 1)) * DEG
    // the shoulder girdle: the clavicle's rise against the chest
    const clav = norm(sub(S, bones["clavicle_" + s].p))
    const cc = chest(clav)
    const clavicleUp = Math.asin(clamp(cc.y, -1, 1)) * DEG
    const clavicleFwd = Math.asin(clamp(cc.z, -1, 1)) * DEG
    // the fingers' curl (degrees between the middle finger's segments)
    const segAng = (a, b, c) => (bones[a] && bones[b] && bones[c] ? Math.acos(clamp(dot(norm(sub(bones[b].p, bones[a].p)), norm(sub(bones[c].p, bones[b].p))), -1, 1)) * DEG : null)
    const curl = segAng("hand_" + s, "middle_01_" + s, "middle_02_" + s)
    const curl2 = segAng("middle_01_" + s, "middle_02_" + s, "middle_03_" + s)
    // inside the torso? (a capsule from the pelvis to the neck, 0.12 m: about the chest's half
    // depth): how far the elbow, the middle of the forearm and the wrist are in
    const into = (p) => {
      const ab = sub(neck, pelvis)
      const t = clamp(dot(sub(p, pelvis), ab) / (dot(ab, ab) || 1), 0, 1)
      return Math.max(0, 0.12 - len(sub(p, add(pelvis, mul(ab, t)))))
    }
    const inside = Math.max(into(E), into(mul(add(E, W), 0.5)), into(W))
    out[s] = { elbow, elevation, azimuth, elbowPoints: ep, humeral, pronation, flexion, deviation, wristBend, clavicleUp, clavicleFwd, stretch: opts.stretch ? opts.stretch[s] : 1, curl, curl2, inside, paddle: opts.paddleSide === s, wrist: W, elbowP: E, shoulder: S }
  }
  return out
}

// ---- the arm solver ----

// What the solver needs to know about one arm of a model (rest: world rest transforms by bone
// name, unscaled; s: the athlete's scale; grip: athlete.js's { q, p } for that hand, or null)
export const armRig = (rest, side, s = 1, grip = null) => {
  const ref = armReference(rest)[side]
  const R = (n) => rest[n + "_" + side]
  const FWD = V(0, 0, 1)
  const ua0 = norm(sub(R("lowerarm").wp, R("upperarm").wp))
  const la0 = norm(sub(R("hand").wp, R("lowerarm").wp))
  const uaN0 = norm(cross(ua0, FWD))
  const laN0 = norm(cross(la0, FWD))
  // the rest forearm basis (frameOf's: y along the bone, z the hint, x = y cross z) and the
  // rest hand's directions in it: the neutral hand rides on the forearm's frame
  const Y0 = la0
  const Z0 = norm(perp(laN0, la0))
  const X0 = cross(Y0, Z0)
  const inBasis = (v) => V(dot(v, X0), dot(v, Y0), dot(v, Z0))
  const handQ = R("hand").wq
  const fingerW = qrot(handQ, ref.finger)
  const thumbW = qrot(handQ, ref.thumb)
  const palmW = qrot(handQ, ref.palm)
  const rig = {
    side,
    sg: side === "l" ? 1 : -1,
    l1: len(sub(R("lowerarm").wp, R("upperarm").wp)) * s,
    l2: len(sub(R("hand").wp, R("lowerarm").wp)) * s,
    ua0,
    la0,
    uaN0,
    laN0,
    restUA: R("upperarm").wq,
    restLA: R("lowerarm").wq,
    restHand: handQ,
    finger: ref.finger,
    thumb: ref.thumb,
    palm: ref.palm,
    // (the neutral hand in the forearm's basis)
    nb: { f: inBasis(fingerW), t: inBasis(thumbW), p: inBasis(palmW) },
    clavLen: len(sub(R("upperarm").wp, R("clavicle").wp)) * s,
    s,
  }
  if (grip) {
    // the hand's directions and the grip point in the paddle's frame (x, y = handle, z = face)
    const inv = qinv(grip.q)
    rig.grip = { f: qrot(inv, ref.finger), t: qrot(inv, ref.thumb), p: qrot(inv, ref.palm), at: qrot(inv, mul(grip.p, s)), q: grip.q }
  }
  return rig
}

// the reach: how far from the shoulder the wrist can be with the elbow between its limits; a
// target further out (or closer in) is brought in softly, never with a snap
const reachOf = (l1, l2, flexDeg) => Math.sqrt(l1 * l1 + l2 * l2 + 2 * l1 * l2 * Math.cos(flexDeg * RAD))
export const softReach = (d, l1, l2, J = JOINTS.elbow) => {
  const dMax = reachOf(l1, l2, J.min)
  const dSoft = reachOf(l1, l2, J.soft)
  const dMin = reachOf(l1, l2, J.max)
  if (d < dMin) return dMin
  if (d <= dSoft) return d
  const k = dMax - dSoft
  return dSoft + k * (1 - Math.exp(-(d - dSoft) / k))
}

// the elbow's natural direction for a hand at dir (unit, from the shoulder) in the chest frame:
// down and a little out and back when the hand is low or in front (relaxed, elbows in); out to
// the side and forward as the hand rises above the shoulder
export const naturalBend = (dir, chest, sg) => {
  const out = mul(chest.right, -sg) // (toward that arm's own side)
  const h = dot(dir, chest.up)
  const lowW = clamp(1 - (h + 0.2) / 0.9, 0, 1)
  const low = add(add(mul(chest.up, -1), mul(out, 0.45)), mul(chest.fwd, -0.3))
  const high = add(add(mul(out, 1), mul(chest.up, -0.25)), mul(chest.fwd, 0.15))
  return norm(add(mul(low, lowW), mul(high, 1 - lowW)))
}

// where the elbow goes for a wrist W (reachable) and an elbow direction b (unit, across the
// shoulder-wrist line)
const elbowFor = (S, dir, d, l1, l2, b) => {
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)
  const sinA = Math.sqrt(1 - cosA * cosA)
  return add(S, add(mul(dir, l1 * cosA), mul(b, l1 * sinA)))
}

// Everything about one arm configuration, cheaply (vectors only): the elbow, the bones'
// directions, the hinge, the humerus' rotation, the neutral hand; and with a hand (f, t, p in
// world), the forearm's twist and the wrist's flexion and deviation. Degrees.
export const ARM_STATS = { assess: 0, global: 0, tracked: 0 }
const assess = (rig, S, W, dir, d, b, chest, hand, torso) => {
  const E = elbowFor(S, dir, d, rig.l1, rig.l2, b)
  const ua = norm(sub(E, S))
  const fa = norm(sub(W, E))
  const n = norm(cross(b, dir)) // (the hinge: the elbow bends round it, whatever the flexion)
  const crease = cross(n, ua)
  const hum = humeralOf(ua, crease, chest, rig.sg) * DEG
  const X = cross(fa, n)
  const nb = rig.nb
  const t0 = add(add(mul(X, nb.t.x), mul(fa, nb.t.y)), mul(n, nb.t.z))
  const out = { E, ua, fa, n, hum, pron: 0, flex: 0, dev: 0, inside: 0 }
  if (hand) {
    out.pron = rig.sg * signedAbout(norm(perp(t0, fa)), norm(perp(hand.t, fa)), fa) * DEG
    const fx = dot(fa, hand.f)
    out.flex = Math.atan2(-dot(fa, hand.p), fx) * DEG
    out.dev = Math.atan2(-dot(fa, hand.t), fx) * DEG
  }
  if (torso) {
    const ab = sub(torso.b, torso.a)
    const l2 = dot(ab, ab) || 1
    const into = (p) => {
      const t = clamp(dot(sub(p, torso.a), ab) / l2, 0, 1)
      return Math.max(0, torso.r - len(sub(p, add(torso.a, mul(ab, t)))))
    }
    out.inside = Math.max(into(E), into(add(mul(E, 0.5), mul(W, 0.5))))
  }
  return out
}
const over = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0)
// how unnatural a configuration is (0 = comfortably inside every range)
const costOf = (a, J = JOINTS) => {
  const h = over(a.hum, J.hum.min, J.hum.max) / 10
  const p = over(a.pron, J.pron.min, J.pron.max) / 8
  const f = over(a.flex, J.flex.min, J.flex.max) / 8
  const dv = over(a.dev, J.dev.min, J.dev.max) / 6
  const i = a.inside / 0.025
  return h * h + p * p + f * f + dv * dv + i * i
}
// the elbow directions to try: round the shoulder-wrist line from a reference direction
const swivelBasis = (dir, ref) => {
  let u1 = perp(ref, dir)
  if (len(u1) < 1e-4) u1 = perp(Math.abs(dir.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0), dir)
  u1 = norm(u1)
  return { u1, u2: cross(dir, u1) }
}
const angleBetween = (a, b) => Math.acos(clamp(dot(norm(a), norm(b)), -1, 1))

// Picks the elbow's direction (the swivel round the shoulder-wrist line). S: the shoulder joint;
// W: the wrist (within reach); chest: { right, up, fwd }; opts: { pole: the direction the stroke
// / pose wants the elbow (or null), poleW: how much that matters (0..1), prev: last frame's
// elbow direction, maxTurn: radians it may swing round in a frame, hand: { f, t, p } world
// directions of a hand that has to be just so (or null: the wrist follows the forearm), torso:
// { a, b, r }, global: search all the way round (otherwise, with a prev, it tracks: a few
// directions near last frame's, all the way round only if those are all poor) }.
// Returns { c (cost), a (assess), b (the elbow's direction) }.
export const chooseBend = (rig, S, W, chest, { pole = null, poleW = 0.5, prev = null, maxTurn = Infinity, hand = null, torso = null, steps = 16, global = false, globalAbove = 2.5, lite = false, tag = null } = {}) => {
  const dv = sub(W, S)
  const d = len(dv)
  const dir = norm(dv, V(0, -1, 0))
  const nat = naturalBend(dir, chest, rig.sg)
  const want = pole && len(perp(pole, dir)) > 0.2 ? norm(perp(norm(pole), dir)) : null
  const prevB = prev && len(perp(prev, dir)) > 0.2 ? norm(perp(prev, dir)) : null
  const { u1, u2 } = swivelBasis(dir, prevB || want || nat)
  const at = (phi) => add(mul(u1, Math.cos(phi)), mul(u2, Math.sin(phi)))
  // The cost of one elbow direction (phi round from u1), in plain numbers: no objects made,
  // since it runs a few dozen times a frame per arm (assess, below, is the same with objects)
  const { l1, l2, sg } = rig
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)
  const sinA = Math.sqrt(1 - cosA * cosA)
  const [dx, dy, dz] = [dir.x, dir.y, dir.z]
  const [ax1, ay1, az1, ax2, ay2, az2] = [u1.x, u1.y, u1.z, u2.x, u2.y, u2.z]
  const [upx, upy, upz, fwx, fwy, fwz] = [chest.up.x, chest.up.y, chest.up.z, chest.fwd.x, chest.fwd.y, chest.fwd.z]
  const nbt = rig.nb.t
  const J = JOINTS
  const natW = 1.2 / (want ? 2.56 : 1.0)
  const wantW = want ? (2 * poleW) / 0.36 : 0
  const tA = torso ? torso.a : null
  const tab = torso ? sub(torso.b, torso.a) : null
  const tl2 = torso ? dot(tab, tab) || 1 : 1
  const into = (px, py, pz) => {
    const qx = px - tA.x
    const qy = py - tA.y
    const qz = pz - tA.z
    const t = clamp((qx * tab.x + qy * tab.y + qz * tab.z) / tl2, 0, 1)
    const ex = qx - tab.x * t
    const ey = qy - tab.y * t
    const ez = qz - tab.z * t
    return Math.max(0, torso.r - Math.sqrt(ex * ex + ey * ey + ez * ez))
  }
  const cost = (phi) => {
    ARM_STATS.assess++
    const cp = Math.cos(phi)
    const sp = Math.sin(phi)
    const bx = ax1 * cp + ax2 * sp
    const by = ay1 * cp + ay2 * sp
    const bz = az1 * cp + az2 * sp
    // the upper arm and the elbow
    const ux = dx * cosA + bx * sinA
    const uy = dy * cosA + by * sinA
    const uz = dz * cosA + bz * sinA
    const Ex = S.x + ux * l1
    const Ey = S.y + uy * l1
    const Ez = S.z + uz * l1
    // the forearm
    let fx = W.x - Ex
    let fy = W.y - Ey
    let fz = W.z - Ez
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1
    fx /= fl
    fy /= fl
    fz /= fl
    // the hinge, and the elbow's crease
    const nx = by * dz - bz * dy
    const ny = bz * dx - bx * dz
    const nz = bx * dy - by * dx
    const cx = ny * uz - nz * uy
    const cy = nz * ux - nx * uz
    const cz = nx * uy - ny * ux
    // the humerus' rotation (humeralOf)
    const ddot = -(upx * ux + upy * uy + upz * uz)
    const qx = -upy * uz + upz * uy // cross(down, ua)
    const qy = -upz * ux + upx * uz
    const qz = -upx * uy + upy * ux
    const s2 = qx * qx + qy * qy + qz * qz
    let rx
    let ry
    let rz
    if (s2 < 1e-8) {
      const k = ddot > 0 ? 1 : -1
      rx = fwx * k
      ry = fwy * k
      rz = fwz * k
    } else {
      const k = ((qx * fwx + qy * fwy + qz * fwz) * (1 - ddot)) / s2
      rx = fwx * ddot + (qy * fwz - qz * fwy) + qx * k
      ry = fwy * ddot + (qz * fwx - qx * fwz) + qy * k
      rz = fwz * ddot + (qx * fwy - qy * fwx) + qz * k
    }
    const rd = rx * ux + ry * uy + rz * uz
    rx -= ux * rd
    ry -= uy * rd
    rz -= uz * rd
    const hum = -sg * Math.atan2(ux * (ry * cz - rz * cy) + uy * (rz * cx - rx * cz) + uz * (rx * cy - ry * cx), rx * cx + ry * cy + rz * cz) * DEG
    let c = (over(hum, J.hum.min, J.hum.max) / 10) ** 2
    if (hand) {
      // the neutral hand's thumb, and the hand's: the forearm's twist; the wrist
      const Xx = fy * nz - fz * ny
      const Xy = fz * nx - fx * nz
      const Xz = fx * ny - fy * nx
      let t0x = Xx * nbt.x + fx * nbt.y + nx * nbt.z
      let t0y = Xy * nbt.x + fy * nbt.y + ny * nbt.z
      let t0z = Xz * nbt.x + fz * nbt.y + nz * nbt.z
      const a0 = t0x * fx + t0y * fy + t0z * fz
      t0x -= fx * a0
      t0y -= fy * a0
      t0z -= fz * a0
      const ht = hand.t
      const a1 = ht.x * fx + ht.y * fy + ht.z * fz
      const tx = ht.x - fx * a1
      const ty = ht.y - fy * a1
      const tz = ht.z - fz * a1
      const pron = sg * Math.atan2(fx * (t0y * tz - t0z * ty) + fy * (t0z * tx - t0x * tz) + fz * (t0x * ty - t0y * tx), t0x * tx + t0y * ty + t0z * tz) * DEG
      const fxh = fx * hand.f.x + fy * hand.f.y + fz * hand.f.z
      const flex = Math.atan2(-(fx * hand.p.x + fy * hand.p.y + fz * hand.p.z), fxh) * DEG
      const dev = Math.atan2(-a1, fxh) * DEG
      c += (over(pron, J.pron.min, J.pron.max) / 8) ** 2 + (over(flex, J.flex.min, J.flex.max) / 8) ** 2 + (over(dev, J.dev.min, J.dev.max) / 6) ** 2
    }
    if (torso) {
      const i = Math.max(into(Ex, Ey, Ez), into((Ex + W.x) / 2, (Ey + W.y) / 2, (Ez + W.z) / 2)) / 0.025
      c += i * i
    }
    // ((angle / k)^2 ~ 2 (1 - cos angle) / k^2)
    c += (1 - (bx * nat.x + by * nat.y + bz * nat.z)) * natW
    if (want) c += (1 - (bx * want.x + by * want.y + bz * want.z)) * wantW
    if (prevB) {
      // (u1 is last frame's direction: phi is how far round from it)
      const t = Math.abs(wrapA(phi))
      c += (t / 0.35) ** 2 * 0.5 + (t > maxTurn ? 50 * (t - maxTurn) : 0)
    }
    return c
  }
  let bestC = Infinity
  let bestPhi = 0
  const take = (phi) => {
    const c = cost(phi)
    if (c < bestC) {
      bestC = c
      bestPhi = phi
    }
  }
  const refine = (step, rounds) => {
    for (let it = 0; it < rounds; it++) {
      const p0 = bestPhi
      take(p0 - step)
      take(p0 + step)
      step /= 2
    }
  }
  const result = () => {
    const b = at(bestPhi)
    return { c: bestC, a: assess(rig, S, W, dir, d, b, chest, hand, torso), b, phi: bestPhi }
  }
  if (prevB && lite && !global) {
    // (a light frame: last frame's direction kept, the arm solved to the new wrist)
    take(0)
    return result()
  }
  if (prevB && !global) {
    // tracking: last frame's direction and a few either side
    for (const phi of [0, -0.1, 0.1]) take(phi)
    // (still turning the same way: a bigger step that way)
    if (bestPhi !== 0) take(bestPhi * 3)
    refine(0.05, 1)
    ARM_STATS.tracked++
    if (bestC <= globalAbove) return result()
  }
  ARM_STATS.global++
  if (tag) ARM_STATS[tag] = (ARM_STATS[tag] || 0) + 1
  for (let k = 0; k < steps; k++) take((k / steps) * 2 * Math.PI)
  refine(Math.PI / steps, 3)
  // (and never round faster than maxTurn from last frame's)
  if (prevB && Math.abs(wrapA(bestPhi)) > maxTurn) {
    bestPhi = Math.sign(wrapA(bestPhi)) * maxTurn
    bestC = cost(bestPhi)
  }
  return result()
}

// The bones' world rotations for a solved arm (the hinge the same for the upper arm and the
// forearm: the elbow bends only one way), and the neutral hand (no twist, a straight wrist)
export const armRotations = (rig, a) => {
  const ua = aimDelta(rig.ua0, rig.uaN0, a.ua, a.n)
  const la = aimDelta(rig.la0, rig.laN0, a.fa, a.n)
  return { upper: qmul(ua, rig.restUA), lower: qmul(la, rig.restLA), neutral: qmul(la, rig.restHand) }
}

// The joint angles (degrees) of an arm given as bone rotations (what the solver hands
// athlete.js): the elbow's flexion, the humerus, the forearm's twist from neutral, the wrist
export const armAngles = (rig, { upper, lower, hand }, chest) => {
  const dU = qmul(upper, qinv(rig.restUA))
  const dL = qmul(lower, qinv(rig.restLA))
  const ua = norm(qrot(dU, rig.ua0))
  const fa = norm(qrot(dL, rig.la0))
  const n = norm(perp(qrot(dU, rig.uaN0), ua))
  const neutral = qmul(dL, rig.restHand)
  const t0 = qrot(neutral, rig.thumb)
  const f = qrot(hand, rig.finger)
  const p = qrot(hand, rig.palm)
  const t = qrot(hand, rig.thumb)
  const fx = dot(fa, f)
  return {
    elbow: Math.acos(clamp(dot(ua, fa), -1, 1)) * DEG,
    hum: humeralOf(ua, cross(n, ua), chest, rig.sg) * DEG,
    pron: rig.sg * signedAbout(norm(perp(t0, fa)), norm(perp(t, fa)), fa) * DEG,
    flex: Math.atan2(-dot(fa, p), fx) * DEG,
    dev: Math.atan2(-dot(fa, t), fx) * DEG,
  }
}

// A hand's rotation against the neutral one, split: the forearm's twist (radians about the
// forearm, the raw rotation's sense) and the wrist's swing; limited (lim: JOINTS) if asked
export const wristSplit = (H, neutral, fa) => {
  const D = qmul(H, qinv(neutral))
  const tw = twistOf(D, fa)
  const twist = qaxis(fa, tw)
  const swing = qmul(D, qinv(twist))
  return { twist: tw, swing }
}

// A relaxed or placed hand on a solved arm: the neutral hand, twisted by pron (degrees, +
// pronation) and bent at the wrist by flex / dev (degrees)
export const handOn = (rig, a, neutral, { pron = 0, flex = 0, dev = 0 } = {}) => {
  const twist = qaxis(a.fa, rig.sg * pron * RAD)
  let H = qmul(twist, neutral)
  const f = qrot(H, rig.finger)
  const p = qrot(H, rig.palm)
  const t = qrot(H, rig.thumb)
  if (flex) H = qmul(qaxis(norm(cross(f, p)), flex * RAD), H)
  if (dev) H = qmul(qaxis(norm(cross(f, t)), dev * RAD), H)
  return qnorm(H)
}

// The hand's twist and wrist kept inside their ranges: H moved (as little as can be) back
// into them. Returns the limited hand.
export const limitHand = (rig, a, neutral, H, J = JOINTS) => {
  const { twist: tw, swing } = wristSplit(H, neutral, a.fa)
  const pron = rig.sg * tw * DEG
  const pronL = clamp(pron, J.pron.min, J.pron.max)
  const twisted = qmul(qaxis(a.fa, rig.sg * pronL * RAD), neutral)
  // the wrist's angles with a share k of the swing
  const angles = (k) => {
    const sw = k >= 1 ? swing : qslerpId(swing, k)
    const Hk = qmul(sw, twisted)
    const f = qrot(Hk, rig.finger)
    const fx = dot(a.fa, f)
    return { H: Hk, flex: Math.atan2(-dot(a.fa, qrot(Hk, rig.palm)), fx) * DEG, dev: Math.atan2(-dot(a.fa, qrot(Hk, rig.thumb)), fx) * DEG }
  }
  const okAt = (x) => !over(x.flex, J.flex.min, J.flex.max) && !over(x.dev, J.dev.min, J.dev.max)
  const full = angles(1)
  if (okAt(full)) return pronL === pron ? H : full.H
  // (as much of the swing as stays in range: halving)
  let lo = 0
  let hi = 1
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2
    if (okAt(angles(mid))) lo = mid
    else hi = mid
  }
  return angles(lo).H
}
// a share k of a rotation (from the identity)
const qslerpId = (q, k) => {
  const w = clamp(q.w, -1, 1)
  const s = w < 0 ? -1 : 1
  const th = Math.acos(Math.abs(w))
  if (th < 1e-6) return Q()
  const f = Math.sin(k * th) / Math.sin(th)
  return qnorm(Q(q.x * s * f, q.y * s * f, q.z * s * f, Math.cos(k * th)))
}

// One arm, solved: the wrist brought within reach, the elbow's direction chosen, the bones'
// rotations, the hand (given, or relaxed with relax: { pron, flex, dev }), the forearm's twist.
export const solveArm = (rig, S, Wt, chest, opts = {}) => {
  const d0 = len(sub(Wt, S))
  const d = softReach(d0, rig.l1, rig.l2, opts.elbow || JOINTS.elbow)
  const W = d0 > 1e-6 ? add(S, mul(sub(Wt, S), d / d0)) : Wt
  const handDirs = opts.H ? { f: qrot(opts.H, rig.finger), t: qrot(opts.H, rig.thumb), p: qrot(opts.H, rig.palm) } : null
  const best = chooseBend(rig, S, W, chest, { globalAbove: 6, tag: "free", ...opts, hand: handDirs })
  const rot = armRotations(rig, best.a)
  let H = opts.H ? limitHand(rig, best.a, rot.neutral, opts.H) : handOn(rig, best.a, rot.neutral, opts.relax || {})
  const { twist } = wristSplit(H, rot.neutral, best.a.fa)
  return { E: best.a.E, W, short: d0 - d, bend: best.b, upper: rot.upper, lower: rot.lower, hand: H, twist, a: best.a, cost: best.c }
}

// The paddle arm. paddle: { face (the face's center), axis (the handle, toward the face),
// normal }; faceFromGrip: the face's center from the grip point along the handle (m).
//
// Two ways to solve it, blended by opts.exact (0..1: 1 around contact):
// - exact (the paddle comes first): the face's center and its normal exactly where the shot
//   needs them; the paddle's roll about its normal (psi, up to psiMax from the pose's axis), the
//   face the palm is behind (side) and the elbow's direction chosen for the most natural arm;
// - arm-first (away from contact): the wrist where the pose has it (opts.wrist), the hand turned
//   the paddle's way as far as a comfortable wrist allows (COMFORT), the paddle following the
//   hand: nothing ever bends past what a wrist does, and nothing jumps.
// opts as chooseBend, plus wrist, exact, sideWant (+1 the palm behind the face, for a
// forehand; -1 a backhand: kept through a stroke), prev (last frame's result: the next frame's
// start), psiMax, handRate (radians the paddle-true hand may turn in a frame near contact),
// handTurn (radians the wrist may move in a frame away from contact).
export const solvePaddleArm = (rig, S, paddle, chest, opts = {}) => {
  const g = rig.grip
  const N = norm(perp(paddle.normal, norm(paddle.axis)))
  const A0 = norm(paddle.axis)
  const prev = opts.prev || {}
  const psiMax = opts.psiMax ?? 1.4
  const handRate = opts.handRate ?? Infinity
  const ffg = opts.faceFromGrip
  const exact = clamp(opts.exact ?? 1, 0, 1)
  const prevExact = prev.exact ?? 0
  // a candidate paddle (roll psi about the face's normal, the palm behind face side): the
  // hand's rotation and directions and where its wrist must be
  const candidate = (psi, side) => {
    const Y = norm(turn(A0, N, psi))
    const Z = mul(N, side)
    const X = cross(Y, Z)
    const W3 = (v) => add(add(mul(X, v.x), mul(Y, v.y)), mul(Z, v.z))
    const Wt = sub(sub(paddle.face, mul(Y, ffg)), W3(g.at))
    const H = qmul(frameOf(Y, Z), qinv(g.q))
    return { psi, side, Y, Z, H, hand: { f: W3(g.f), t: W3(g.t), p: W3(g.p) }, Wt }
  }
  const side0 = opts.sideWant || prev.side || 1
  // ---- exact (the paddle-true arm), every frame: tracked from last frame's; searched all the
  // way round coming into contact (the best arm for the shot whatever the arm was doing: the
  // drawn arm blends into it) or when tracking finds only poor arms near contact ----
  let X = null
  const entering = exact > 0 && !(prevExact > 0)
  // (not needed in the middle of a swing away from contact once the arm-first arm has taken
  // over, or on a light frame: last frame's stands)
  const needX = !prev.X || exact > 0 || ((prev.kc ?? 0) > 0.02 && !opts.lite) || ((opts.stroke || 0) < 0.5 && !opts.lite)
  if (!needX) X = prev.X
  else {
    const tracking = !entering && prev.X && prev.X.side === side0
    let best = null
    const tried = new Set()
    const tryOne = (psi, side, global = false, force = false) => {
      if (Math.abs(psi) > psiMax + 1e-9) return
      const key = side + ":" + psi.toFixed(4)
      if (tried.has(key)) return
      const c = candidate(psi, side)
      const turnA = tracking ? qangle(prev.X.hand, c.H) : 0
      if (!force && tracking && exact >= 0.5 && turnA > handRate) return
      tried.add(key)
      const d0 = len(sub(c.Wt, S))
      // (right at contact, a ball just out of reach: the arm may lengthen by up to 2.5%, which
      // nobody sees, rather than miss it)
      const full = reachOf(rig.l1, rig.l2, JOINTS.elbow.min)
      const stretch = exact > 0 ? clamp(d0 / full, 1, 1 + 0.025 * exact) : 1
      const rg = stretch > 1 ? { ...rig, l1: rig.l1 * stretch, l2: rig.l2 * stretch } : rig
      const d = softReach(d0, rg.l1, rg.l2, stretch > 1 ? { ...JOINTS.elbow, soft: JOINTS.elbow.min + 2 } : JOINTS.elbow)
      const W = add(S, mul(sub(c.Wt, S), d / Math.max(d0, 1e-6)))
      const r = chooseBend(rg, S, W, chest, { ...opts, lite: false, prev: tracking ? prev.X.bend : null, hand: c.hand, steps: 12, global, globalAbove: exact >= 0.5 ? 8 : Infinity, tag: global ? "gX" : "tX" })
      r.stretch = stretch
      let cost = r.c + ((d0 - d) / 0.012) ** 2 + (psi / 0.9) ** 2 * 0.3
      if (tracking) cost += (turnA / 0.35) ** 2 * 0.6
      // (a stroke on the way: the palm behind the face for a forehand, the back of the hand for
      // a backhand, from the take-back to the finish: no regrip in the middle of a swing)
      if (opts.sideWant && side !== opts.sideWant) cost += 12
      if (!best || cost < best.cost) best = { cost, c, W, d0, d, r }
    }
    const refine = (step, rounds) => {
      for (let it = 0; it < rounds; it++) {
        const b0 = best
        tryOne(b0.c.psi - step, b0.c.side)
        tryOne(b0.c.psi + step, b0.c.side)
        step /= 2
      }
    }
    if (tracking && exact < 0.5) {
      // (away from contact: last frame's roll and one step toward the better side)
      tryOne(clamp(prev.X.psi, -psiMax, psiMax), side0)
      const k0 = best
      tryOne(clamp(prev.X.psi + 0.08, -psiMax, psiMax), side0)
      if (best === k0) tryOne(clamp(prev.X.psi - 0.08, -psiMax, psiMax), side0)
    } else if (tracking) {
      for (const dpsi of [0, -0.1, 0.1]) tryOne(clamp(prev.X.psi + dpsi, -psiMax, psiMax), side0)
      if (best) refine(0.05, 1)
    }
    if (!best || !tracking || (best.cost > 5 && exact >= 0.5)) {
      // (the roll all round; the elbow all round too unless tracking)
      const grid = [-1.4, -0.93, -0.47, 0, 0.47, 0.93, 1.4]
      for (const side of opts.sideWant ? [opts.sideWant] : [1, -1]) for (const psi of grid) tryOne(psi, side, !tracking)
      if (!best) for (const side of opts.sideWant ? [opts.sideWant] : [1, -1]) for (const psi of grid) tryOne(psi, side, !tracking, true)
      refine(0.12, 3)
    }
    const { c, W, d0, d, r } = best
    const rot = armRotations(rig, r.a)
    X = { upper: rot.upper, lower: rot.lower, hand: c.H, bend: r.b, psi: c.psi, side: c.side, E: r.a.E, W, short: d0 - d, a: r.a, cost: best.cost, stretch: r.stretch || 1 }
    // (leaving contact: the paddle-true arm held as it was, fading out)
    if (exact > 0 && exact < prevExact && prev.X) X = { ...prev.X }
  }
  // How much of the paddle-true arm to draw: all of it at contact; away from contact, as much
  // as it's comfortable (the pose's own paddle when a natural arm can hold it: the ready
  // position, a tap; the arm-first hand when not), changing slowly; never in the middle of a
  // stroke's swing
  const carry = clamp(opts.carry || 0, 0, 1)
  const comfy = clamp((3.5 - X.cost) / 2.5, 0, 1) * (1 - clamp(opts.stroke || 0, 0, 1)) * (1 - carry)
  const kc = prev.kc === undefined ? comfy : prev.kc + clamp(comfy - prev.kc, -(opts.dt ?? 1 / 60) * 3, (opts.dt ?? 1 / 60) * 3)
  const k = Math.max(exact, kc)
  // ---- arm-first ----
  let out
  if (k < 0.999) {
    const c = candidate(clamp(X.psi, -psiMax, psiMax), X.side)
    const Wt = opts.wrist || c.Wt
    const d0 = len(sub(Wt, S))
    const d = softReach(d0, rig.l1, rig.l2, RELAXED_ELBOW)
    const W = add(S, mul(sub(Wt, S), d / Math.max(d0, 1e-6)))
    // (the elbow: tracked from last frame's, judged by the arm alone: the hand is fitted to it)
    const r = chooseBend(rig, S, W, chest, { ...opts, prev: prev.bend || null, hand: null, steps: 12, globalAbove: 6, tag: "armFirst" })
    const rot = armRotations(rig, r.a)
    let H = c.H
    // (carried, not played: running, walking between points, the paddle simply rides in a
    // relaxed hand, thumb up, the face to the side: the way people carry one)
    // (opts.carryAxis: the paddle's way when carried, from the body: its tip out and forward of
    // the leg, the face to the side, whichever face is nearer; the hand follows, in range)
    if (carry > 0 && opts.carryAxis) {
      const cY = norm(opts.carryAxis)
      const cZ = norm(perp(opts.carryNormal || V(1, 0, 0), cY))
      const Ha = qmul(frameOf(cY, cZ), qinv(g.q))
      const Hb = qmul(frameOf(cY, mul(cZ, -1)), qinv(g.q))
      H = qslerp(H, qangle(Ha, H) < qangle(Hb, H) ? Ha : Hb, carry)
    } else if (carry > 0) H = qslerp(H, handOn(rig, r.a, rot.neutral, opts.carryHand || { pron: 10, flex: 8, dev: 4 }), carry)
    if (prev.hand && prev.neutral && opts.handTurn) H = wristRate(rot.neutral, H, prev.neutral, prev.hand, opts.handTurn)
    H = limitHand(rig, r.a, rot.neutral, H, COMFORT)
    out = { upper: rot.upper, lower: rot.lower, hand: H, bend: r.b, psi: c.psi, side: c.side, E: r.a.E, W, short: 0, a: r.a, cost: r.c }
    // (in between: a blend, toward the paddle-true arm)
    out = { ...out, upper: qslerp(out.upper, X.upper, k), lower: qslerp(out.lower, X.lower, k), hand: qslerp(out.hand, X.hand, k), psi: X.psi, side: X.side }
    if (k > 0.5) out = { ...out, bend: X.bend, E: X.E, W: X.W, short: X.short, a: X.a }
  } else out = { ...X }
  const fa = norm(qrot(qmul(out.lower, qinv(rig.restLA)), rig.la0))
  const neutral = qmul(qmul(out.lower, qinv(rig.restLA)), rig.restHand)
  // (a hand blending out of contact never jumps: its wrist moves no faster than twice a wrist's
  // turn)
  if (prev.hand && prev.neutral && opts.handTurn && exact < 0.5) out.hand = wristRate(neutral, out.hand, prev.neutral, prev.hand, 2 * opts.handTurn)
  out.neutral = neutral
  out.stretch = 1 + ((X.stretch || 1) - 1) * k
  out.exact = exact
  out.kc = kc
  out.blend = k
  out.X = X
  out.exactHand = X.hand
  out.twist = wristSplit(out.hand, neutral, fa).twist
  const P = qmul(out.hand, g.q)
  out.axis = qrot(P, V(0, 1, 0))
  out.normal = qrot(P, V(0, 0, 1))
  return out
}

// ---- the paddle kept out of the body (paddlebody.js) ----
// Where a solved arm's elbow and wrist really are: from its bones' rotations (a result blended
// between the arm-first and the paddle-true arm keeps one arm's E and W, but draws the blend)
export const armFK = (rig, S, res) => {
  const st = res.stretch || 1
  const E = add(S, mul(qrot(qmul(res.upper, qinv(rig.restUA)), rig.ua0), rig.l1 * st))
  const W = add(E, mul(qrot(qmul(res.lower, qinv(rig.restLA)), rig.la0), rig.l2 * st))
  return { E, W }
}
// Where a solved paddle arm puts the paddle (W: its wrist, armFK's): { face, axis, normal, grip }
export const paddleOfArm = (rig, res, faceFromGrip, W = res.W) => {
  const P = qmul(res.hand, rig.grip.q)
  const axis = qrot(P, V(0, 1, 0))
  const grip = add(W, qrot(P, rig.grip.at))
  return { face: add(grip, mul(axis, faceFromGrip)), axis, normal: qrot(P, V(0, 0, 1)), grip }
}
// The same arm with another hand (its forearm's twist and the paddle's directions follow)
export const armWithHand = (rig, res, H) => {
  const fa = norm(qrot(qmul(res.lower, qinv(rig.restLA)), rig.la0))
  const neutral = res.neutral || qmul(qmul(res.lower, qinv(rig.restLA)), rig.restHand)
  const P = qmul(H, rig.grip.q)
  return { ...res, hand: H, neutral, twist: wristSplit(H, neutral, fa).twist, axis: qrot(P, V(0, 1, 0)), normal: qrot(P, V(0, 0, 1)) }
}
// The paddle arm's hand turned (at the wrist, within the wrist's and forearm's real ranges) so
// the paddle's whole shape clears the body's capsules (bodyCapsules, without this arm's own
// hand) by margin. S: the shoulder; keep: 1 away from contact, 0 at it (the face exactly on
// the ball). Returns { res (the arm, maybe with a new hand), before, depth, shift (what turning
// couldn't do: where the wrist would have to go) }
export const guardPaddleArm = (rig, S, res, caps, { faceFromGrip, margin = 0.015, skip = null, keep = 1, maxTurn = 0.9, maxShift = 0.1 } = {}) => {
  if (keep <= 0.02) return { res, before: null, depth: null, shift: null }
  const { W } = armFK(rig, S, res)
  const p = paddleOfArm(rig, res, faceFromGrip, W)
  // (turning only: what the wrist can do)
  const r = resolvePaddle(p, caps, { pivot: W, margin, skip, maxTurn: maxTurn * keep, maxShift: 0 })
  if (r.before <= -margin) return { res, before: r.before, depth: r.before, shift: null }
  let out = res
  let depth = r.depth
  if (r.turned > 1e-4) {
    const H = qnorm(qmul(r.turn, res.hand))
    const fa = norm(qrot(qmul(res.lower, qinv(rig.restLA)), rig.la0))
    const neutral = res.neutral || qmul(qmul(res.lower, qinv(rig.restLA)), rig.restHand)
    const H2 = limitHand(rig, { fa }, neutral, H, JOINTS)
    out = armWithHand(rig, res, H2)
    // (the wrist at the end of its range: where that leaves the paddle)
    if (qangle(H2, H) > 0.01) depth = null
  }
  // what turning couldn't do: how far the wrist would have to move
  let shift = null
  if (depth === null || depth > -margin) {
    const r2 = resolvePaddle(paddleOfArm(rig, out, faceFromGrip, W), caps, { pivot: W, margin, skip, maxTurn: 0, maxShift: maxShift * keep })
    depth = r2.before
    if (len(r2.shift) > 0.0005) shift = r2.shift
  }
  return { res: out, before: r.before, depth, shift, part: r.part }
}

// the hand's turn against its forearm (its wrist) changed by at most rate from last frame's
// (N: the forearm's neutral hand now; prevN, prevH: last frame's): a hand rides along with a
// fast-moving forearm, only the wrist's own move is limited
const wristRate = (N, H, prevN, prevH, rate) => {
  const r = qmul(qinv(N), H)
  const rp = qmul(qinv(prevN), prevH)
  const ang = qangle(rp, r)
  return ang > rate ? qnorm(qmul(N, qslerp(rp, r, rate / ang))) : H
}
const qbasisOf = (x, y, z) => frameOf(y, z) // (y the handle exactly, z the face: x follows)

// ---- the shoulder girdle ----
// The clavicle's elevation and protraction (radians) for an arm whose hand target is at dir
// (unit, from the shoulder, in the chest frame: x the figure's right, y up, z forward) and
// reach (target distance / the arm's length). sg: +1 left, -1 right.
export const clavicleFor = (dir, reach, sg) => {
  const elevArm = Math.acos(clamp(-dir.y, -1, 1)) * DEG // (0 hanging .. 180 straight up)
  // (the scapulohumeral rhythm: past about 40 degrees the shoulder girdle rises too, about a
  // fifth of the arm's rise at the clavicle, up to about 26 degrees overhead)
  let elev = clamp((elevArm - 40) * 0.2, 0, 26)
  const lateral = -sg * dir.x
  const fwd = dir.z
  // forward and across: protraction; behind the body: retraction
  let prot = clamp(fwd, 0, 1) * 9 + clamp(-lateral, 0, 1) * 10 - clamp(-fwd, 0, 1) * 12
  // a long reach: the girdle reaches out after it (up to about 4 cm at the shoulder)
  const extra = clamp((reach - 0.94) / 0.12, 0, 1)
  prot += extra * 9 * clamp(fwd + Math.max(0, -lateral), 0, 1)
  elev += extra * 7 * clamp(dir.y + 0.3, 0, 1)
  // relaxed hanging: a touch down
  elev -= clamp((60 - elevArm) / 60, 0, 1) * 3
  return { elev: elev * RAD, prot: clamp(prot, -14, 20) * RAD }
}

// ---- hands ----
// Curls (radians) at the three joints of each finger [knuckle, middle, end] and the thumb
// [base, middle, tip]; spread: each finger's turn away from the middle finger (radians, +
// toward the little finger's side). A relaxed hand is a cascade (index least curled, little
// finger most), the thumb resting along the index; a grip wraps every finger round the
// handle, the index a little forward of the others; a fist folds the thumb over.
export const FINGERS = {
  relaxed: { index: [0.22, 0.32, 0.18], middle: [0.3, 0.42, 0.22], ring: [0.36, 0.5, 0.26], pinky: [0.44, 0.56, 0.3], thumb: [0.12, 0.18, 0.14], spread: { index: -0.04, middle: 0, ring: 0.04, pinky: 0.1 } },
  grip: { index: [1.0, 1.15, 0.6], middle: [1.25, 1.4, 0.8], ring: [1.32, 1.45, 0.82], pinky: [1.38, 1.45, 0.8], thumb: [0.45, 0.5, 0.35], spread: { index: -0.06, middle: 0, ring: 0.03, pinky: 0.06 } },
  cup: { index: [0.45, 0.55, 0.3], middle: [0.55, 0.65, 0.35], ring: [0.6, 0.7, 0.38], pinky: [0.66, 0.74, 0.4], thumb: [0.3, 0.32, 0.2], spread: { index: -0.03, middle: 0, ring: 0.03, pinky: 0.07 } },
  fist: { index: [1.45, 1.65, 1.0], middle: [1.5, 1.7, 1.05], ring: [1.5, 1.7, 1.05], pinky: [1.5, 1.65, 1.0], thumb: [0.65, 0.75, 0.55], spread: { index: 0, middle: 0, ring: 0, pinky: 0 } },
  open: { index: [0.05, 0.08, 0.05], middle: [0.05, 0.08, 0.05], ring: [0.07, 0.1, 0.06], pinky: [0.09, 0.12, 0.08], thumb: [0.0, 0.06, 0.06], spread: { index: -0.14, middle: 0, ring: 0.12, pinky: 0.24 } },
}
export const FINGER_NAMES = ["index", "middle", "ring", "pinky", "thumb"]
// a hand shape between two (t 0..1), every joint
export const fingerPose = (a, b = a, t = 0) => {
  const A = FINGERS[a] || FINGERS.relaxed
  const B = FINGERS[b] || A
  const out = { spread: {} }
  for (const f of FINGER_NAMES) out[f] = A[f].map((v, i) => v + (B[f][i] - v) * t)
  for (const f of ["index", "middle", "ring", "pinky"]) out.spread[f] = A.spread[f] + (B.spread[f] - A.spread[f]) * t
  return out
}
// a hand's current curls moved toward a shape at rate (radians a second)
export const stepFingers = (cur, target, dt, rate = 9) => {
  const k = rate * dt
  const out = { spread: {} }
  for (const f of FINGER_NAMES) out[f] = target[f].map((v, i) => (cur ? cur[f][i] + clamp(v - cur[f][i], -k, k) : v))
  for (const f of ["index", "middle", "ring", "pinky"]) out.spread[f] = cur ? cur.spread[f] + clamp(target.spread[f] - cur.spread[f], -k, k) : target.spread[f]
  return out
}

// ---- skinning: twist weights ----
// A limb segment's skin weights shared out along it with twist bones: for every vertex
// weighted to bone `from`, the part of that weight is split between the nodes (sorted by u:
// 0 at joint a, 1 at joint b; each node a bone index) by where the vertex lies along a-b. At
// most 4 influences per vertex are kept (the smallest dropped, the rest renormalized).
// position: Float32Array (xyz), skinIndex / skinWeight: 4 per vertex (changed in place).
export const splitTwistWeights = (position, skinIndex, skinWeight, from, a, b, nodes) => {
  const ab = sub(b, a)
  const l2 = dot(ab, ab) || 1
  const n = position.length / 3
  let changed = 0
  for (let i = 0; i < n; i++) {
    let k0 = -1
    for (let k = 0; k < 4; k++) if (skinIndex[i * 4 + k] === from && skinWeight[i * 4 + k] > 0) k0 = k
    if (k0 < 0) continue
    const w = skinWeight[i * 4 + k0]
    const p = V(position[i * 3], position[i * 3 + 1], position[i * 3 + 2])
    const u = clamp(dot(sub(p, a), ab) / l2, 0, 1)
    // the two nodes either side of u
    let j = 0
    while (j < nodes.length - 1 && u > nodes[j + 1][0]) j++
    const [u0, b0] = nodes[j]
    const [u1, b1] = nodes[Math.min(j + 1, nodes.length - 1)]
    const t = u1 > u0 ? clamp((u - u0) / (u1 - u0), 0, 1) : 0
    const parts = new Map()
    for (let k = 0; k < 4; k++) {
      if (k === k0) continue
      const wk = skinWeight[i * 4 + k]
      if (wk > 0) parts.set(skinIndex[i * 4 + k], (parts.get(skinIndex[i * 4 + k]) || 0) + wk)
    }
    if (w * (1 - t) > 0) parts.set(b0, (parts.get(b0) || 0) + w * (1 - t))
    if (w * t > 0) parts.set(b1, (parts.get(b1) || 0) + w * t)
    const top = [...parts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4)
    const sum = top.reduce((s, x) => s + x[1], 0) || 1
    for (let k = 0; k < 4; k++) {
      skinIndex[i * 4 + k] = top[k] ? top[k][0] : 0
      skinWeight[i * 4 + k] = top[k] ? top[k][1] / sum : 0
    }
    changed++
  }
  return changed
}
// how the twist is shared out along the forearm (the radius turns round the ulna: nothing at
// the elbow, all of it at the wrist) and the upper arm (the shoulder end keeps a counter-turn,
// so the skin there doesn't wring when the humerus rotates)
export const TWIST = {
  forearm: [[0, "lowerarm"], [0.5, "lowerarm_twist_01"], [1, "lowerarm_twist_02"]],
  forearmShare: { lowerarm_twist_01: 0.5, lowerarm_twist_02: 1 },
  upperarm: [[0, "upperarm_twist_01"], [0.5, "upperarm"]],
  upperarmCounter: 0.6,
}
