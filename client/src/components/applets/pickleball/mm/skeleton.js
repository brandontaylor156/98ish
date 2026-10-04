// Pickleball 98 motion matching: the canonical skeleton every motion-capture take is
// retargeted to, and forward kinematics. Pure JavaScript (Node-tested, mm.test.js).
//
// The canonical skeleton has the game's own proportions (anim.js BODY: 0.43 m thigh and
// shin, ankles 7.5 cm up, shoulders 0.19 m out...) and the bone names of the athletes'
// skeleton (Unreal-style: pelvis, spine_01.., thigh_l...). Its rest pose is a T-pose facing
// +z, the left side at +x, every bone's rest rotation the identity. A pose is one rotation
// per bone (D: the bone's world rotation from that rest pose, in the character's own space)
// plus where the pelvis is.
//
// Retargeting (tools/build-motion.mjs) maps a source skeleton (100STYLE's BVH, CMU's ASF)
// onto it bone by bone: each canonical bone has a rest direction (toward its child) and a
// second "hint" direction (fixing its twist: forward, or up for the feet); a source bone's
// motion (its world rotation from its own rest pose) is applied to the canonical bone after
// a rest alignment, the rotation taking the canonical rest (direction, hint) onto the
// source's. A game model (athlete.js) is posed the same way with its own rest alignment, so
// the database never depends on one model.

import { frameOf, qinv, qmul, qnorm, qrot, Q } from "./quat.js"

export const BONES = ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head", "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l", "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r", "thigh_l", "calf_l", "foot_l", "ball_l", "thigh_r", "calf_r", "foot_r", "ball_r"]
export const NB = BONES.length
export const B = Object.fromEntries(BONES.map((b, i) => [b, i]))
export const PARENT = BONES.map((b) => ({ pelvis: -1, spine_01: "pelvis", spine_02: "spine_01", spine_03: "spine_02", neck_01: "spine_03", head: "neck_01", clavicle_l: "spine_03", upperarm_l: "clavicle_l", lowerarm_l: "upperarm_l", hand_l: "lowerarm_l", clavicle_r: "spine_03", upperarm_r: "clavicle_r", lowerarm_r: "upperarm_r", hand_r: "lowerarm_r", thigh_l: "pelvis", calf_l: "thigh_l", foot_l: "calf_l", ball_l: "foot_l", thigh_r: "pelvis", calf_r: "thigh_r", foot_r: "calf_r", ball_r: "foot_r" })[b]).map((p) => (p === -1 ? -1 : BONES.indexOf(p)))
// the mirror image of each bone (left <-> right)
export const MIRROR = BONES.map((b) => BONES.indexOf(b.endsWith("_l") ? b.slice(0, -2) + "_r" : b.endsWith("_r") ? b.slice(0, -2) + "_l" : b))

// rest offsets from the parent joint (meters; T-pose, facing +z, left = +x). Proportions from
// anim.js BODY: hips 0.935 m up with the ankles at 0.075, pelvis to the base of the neck 0.5,
// shoulders 0.19 out and 4.5 cm under it, upper arm 0.29, forearm 0.27
const V = (x, y, z) => ({ x, y, z })
export const ANKLE_Y = 0.075
export const BALL_Y = 0.022
export const HIP_Y = 0.935
const OFF = {
  pelvis: V(0, HIP_Y, 0),
  spine_01: V(0, 0.1, -0.01),
  spine_02: V(0, 0.13, 0),
  spine_03: V(0, 0.13, 0.01),
  neck_01: V(0, 0.14, 0),
  head: V(0, 0.09, 0.01),
  clavicle_l: V(0.03, 0.08, 0.02),
  upperarm_l: V(0.16, 0.015, -0.02),
  lowerarm_l: V(0.29, 0, 0),
  hand_l: V(0.27, 0, 0),
  thigh_l: V(0.095, 0, 0),
  calf_l: V(0, -0.43, 0),
  foot_l: V(0, -0.43, 0),
  ball_l: V(0, BALL_Y - ANKLE_Y, 0.145),
}
for (const k of Object.keys(OFF)) if (k.endsWith("_l")) OFF[k.slice(0, -2) + "_r"] = V(-OFF[k].x, OFF[k].y, OFF[k].z)
export const REST_OFFSET = BONES.map((b) => OFF[b])
// the ends of the bones without a child bone (head top, hand to the fingers, the toe tip)
const END = { head: V(0, 0.2, 0), hand_l: V(0.09, 0, 0), hand_r: V(-0.09, 0, 0), ball_l: V(0, -BALL_Y + 0.004, 0.06), ball_r: V(0, -BALL_Y + 0.004, 0.06) }

// each bone's rest direction (toward its child) and hint (twist)
const CHILD = { pelvis: "spine_01", spine_01: "spine_02", spine_02: "spine_03", spine_03: "neck_01", neck_01: "head", clavicle_l: "upperarm_l", upperarm_l: "lowerarm_l", lowerarm_l: "hand_l", clavicle_r: "upperarm_r", upperarm_r: "lowerarm_r", lowerarm_r: "hand_r", thigh_l: "calf_l", calf_l: "foot_l", foot_l: "ball_l", thigh_r: "calf_r", calf_r: "foot_r", foot_r: "ball_r" }
const unit = (v) => {
  const l = Math.hypot(v.x, v.y, v.z)
  return V(v.x / l, v.y / l, v.z / l)
}
export const REST_DIR = BONES.map((b) => {
  if (b === "pelvis") return V(0, 1, 0)
  const c = CHILD[b]
  return unit(c ? OFF[c] : END[b])
})
const FWD = V(0, 0, 1)
const UP = V(0, 1, 0)
export const REST_HINT = BONES.map((b) => (b.startsWith("foot") || b.startsWith("ball") ? UP : FWD))
export const REST_FRAME = BONES.map((b, i) => frameOf(REST_DIR[i], REST_HINT[i]))
export const BONE_END = BONES.map((b) => END[b] || null)

// leg length (hip joint to the ground, standing): what source takes are scaled to
export const LEG = HIP_Y

// Forward kinematics: D (NB quaternions, character space), the pelvis joint's position.
// Returns every joint's position (and the head top, hands and toe tips: ends).
export const fk = (D, pelvis, out = null) => {
  const p = out || new Array(NB)
  for (let i = 0; i < NB; i++) {
    const par = PARENT[i]
    if (par < 0) {
      p[i] = { x: pelvis.x, y: pelvis.y, z: pelvis.z }
      continue
    }
    const o = qrot(D[par], REST_OFFSET[i])
    const pp = p[par]
    p[i] = { x: pp.x + o.x, y: pp.y + o.y, z: pp.z + o.z }
  }
  return p
}
export const endOf = (D, P, i) => {
  const e = BONE_END[i]
  if (!e) return null
  const o = qrot(D[i], e)
  return { x: P[i].x + o.x, y: P[i].y + o.y, z: P[i].z + o.z }
}

// ---- retargeting a source skeleton ----
// map: canonical bone -> { joint: source joint index (its rotation drives the bone), dir:
// source rest direction of the bone (in the source's rest world space), hint } (hint
// defaults to the canonical one: the sources face +z with their left at +x, like ours).
// Returns per bone the alignment A: D = Dsrc * A (Dsrc: the source joint's world rotation
// from its rest)
export const restAlign = (map) =>
  BONES.map((b, i) => {
    const m = map[b]
    if (!m) return null
    const src = frameOf(m.dir, m.hint || REST_HINT[i])
    return qnorm(qmul(src, qinv(REST_FRAME[i])))
  })

// one source frame (world rotations wq of the source joints, their rest world rotations
// restQ) -> canonical D. Bones the source doesn't have copy their parent's rotation.
export const canonicalPose = (map, align, wq, restQ) => {
  const D = new Array(NB)
  for (let i = 0; i < NB; i++) {
    const m = map[BONES[i]]
    if (!m) {
      D[i] = PARENT[i] >= 0 ? D[PARENT[i]] : Q()
      continue
    }
    const dsrc = qmul(wq[m.joint], qinv(restQ[m.joint]))
    D[i] = qnorm(qmul(dsrc, align[i]))
  }
  return D
}

// mirror a pose left <-> right (in place on new arrays): the reflection x -> -x
export const mirrorQ = (q) => ({ x: q.x, y: -q.y, z: -q.z, w: q.w })
export const mirrorPose = (D) => BONES.map((b, i) => mirrorQ(D[MIRROR[i]]))
