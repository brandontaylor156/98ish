// Pickleball 98 motion matching: from the controller's pose to the drawn body. Pure JavaScript
// (Node-tested). The world pose (root yaw applied), forward kinematics, foot locking, a small
// pelvis drop when a pinned foot would be out of a leg's reach, two-bone IK for the legs.
// Returns every canonical joint's world position, the bones' world rotations (D) and the feet
// (where they're pinned, their yaw), for anim.js (pose fields) and athlete.js (bone rotations).

import { qrot } from "./quat.js"
import { B, NB, fk, endOf, REST_OFFSET } from "./skeleton.js"
import { createFootLock, legIK, stepFootLock, SOFT } from "./footlock.js"
import { worldOf } from "./controller.js"

const LEG = 0.86 // thigh + shin
const THIGH = 0.43
const SHIN = 0.43

export const createMMPose = () => ({ lock: createFootLock(), drop: 0, dropV: 0 })

const footYaw = (q) => {
  const f = qrot(q, { x: 0, y: 0, z: 1 })
  return Math.atan2(f.x, f.z)
}

// o: updateMM's output; extra: { drop: m (lower the pelvis, e.g. a crouch), lift: [l, r] m
// (raise a foot: the split step), still: standing about (settling steps allowed), stance:
// half the ankles' distance wanted (wider than the capture: the feet go out as they step),
// stanceW: how much of that (0..1) }
export const solveMMPose = (st, o, dt, extra = {}) => {
  const w = worldOf(o)
  const D = w.D
  const pelvis = { ...w.pelvis }
  const P0 = fk(D, pelvis)
  // (a wider stance than the capture's: each foot further out along the body's side; a pinned
  // foot only moves out with its next step)
  const rx = -Math.cos(o.root.yaw)
  const rz = Math.sin(o.root.yaw)
  if (extra.stance) {
    // half the ankles' distance across the body in the capture, vs the stance wanted
    const aL = P0[B.foot_l]
    const aR = P0[B.foot_r]
    const half = Math.abs((aR.x - aL.x) * rx + (aR.z - aL.z) * rz) / 2
    const target = Math.max(0, Math.min(0.2, extra.stance - half)) * (extra.stanceW ?? 1)
    st.widen = (st.widen || 0) + (target - (st.widen || 0)) * (1 - Math.exp(-dt / 0.25))
  } else st.widen = (st.widen || 0) * Math.exp(-dt / 0.25)
  const wide = st.widen
  const feet = ["l", "r"].map((s) => {
    const k = (s === "l" ? -1 : 1) * wide
    const a = P0[B["foot_" + s]]
    const b = P0[B["ball_" + s]]
    return { ankle: { x: a.x + rx * k, y: a.y, z: a.z + rz * k }, ball: { x: b.x + rx * k, y: b.y, z: b.z + rz * k }, yaw: footYaw(D[B["foot_" + s]]) }
  })
  const lift = extra.lift || [0, 0]
  const down = [!!(o.contacts & 1) && lift[0] <= 0.002, !!(o.contacts & 2) && lift[1] <= 0.002]
  const fl = stepFootLock(st.lock, feet, down, dt, { still: extra.still ?? true, reach: extra.reach || null, release: extra.reach ? 0.3 : 0.2 })
  for (let i = 0; i < 2; i++) {
    fl[i].ankle.y += lift[i]
    fl[i].ball.y += lift[i]
  }
  // the pelvis comes down (smoothly) as far as a pinned foot needs, and for a crouch
  const sh = extra.shift || { x: 0, z: 0 }
  const hipW = (s) => ({ x: P0[B["thigh_" + s]].x + sh.x, y: P0[B["thigh_" + s]].y, z: P0[B["thigh_" + s]].z + sh.z })
  let need = 0
  for (let i = 0; i < 2; i++) {
    if (!fl[i].locked) continue // (a foot in the air just reaches as far as it can)
    const h = hipW(i ? "r" : "l")
    const a = fl[i].ankle
    const dh = Math.hypot(a.x - h.x, a.z - h.z)
    const maxY = a.y + Math.sqrt(Math.max(0, (LEG * SOFT) ** 2 - dh * dh))
    need = Math.max(need, h.y - maxY)
  }
  // (a deep drop only for a lunge or a step out; otherwise a foot left far behind steps over)
  const want = Math.min(extra.reach ? 0.22 : 0.07, Math.max(0, need)) + (extra.drop || 0)
  // (down fast, up gently: a critically damped spring with a quicker half-life going down)
  const hl = want > st.drop ? 0.05 : 0.15
  const y = (4 * Math.LN2) / hl / 2
  const j0 = st.drop - want
  const j1 = st.dropV + j0 * y
  const e = Math.exp(-y * dt)
  st.drop = e * (j0 + j1 * dt) + want
  st.dropV = e * (st.dropV - j1 * y * dt)
  // (anything left over the soft IK absorbs: the foot reaches a hair short, never a snap)
  pelvis.y -= st.drop
  // (a reach for a ball: the hips go toward it, the pinned feet stay)
  if (extra.shift) {
    pelvis.x += extra.shift.x
    pelvis.z += extra.shift.z
  }
  const P = fk(D, pelvis)
  // legs to the pinned feet
  const knees = []
  for (const [i, s] of [[0, "l"], [1, "r"]]) {
    // (the knee's direction from the capture, pushed out as far as the foot was)
    const kn = P[B["calf_" + s]]
    const kOut = (s === "l" ? -1 : 1) * wide
    const an = P[B["foot_" + s]]
    const r = legIK(P[B["thigh_" + s]], { x: kn.x + rx * kOut, y: kn.y, z: kn.z + rz * kOut }, fl[i].ankle, THIGH, SHIN, { x: an.x + rx * kOut, y: an.y, z: an.z + rz * kOut }, { x: Math.sin(o.root.yaw), y: 0, z: Math.cos(o.root.yaw) })
    const da = { x: r.ankle.x - P[B["foot_" + s]].x, y: r.ankle.y - P[B["foot_" + s]].y, z: r.ankle.z - P[B["foot_" + s]].z }
    P[B["calf_" + s]] = r.knee
    P[B["foot_" + s]] = r.ankle
    // the ball of the foot moves with the ankle (the foot keeps its animated rotation)
    const b = P[B["ball_" + s]]
    P[B["ball_" + s]] = { x: b.x + da.x, y: b.y + da.y, z: b.z + da.z }
    knees.push(r.knee)
  }
  const ends = { head: endOf(D, P, B.head), hand_l: endOf(D, P, B.hand_l), hand_r: endOf(D, P, B.hand_r), toe_l: endOf(D, P, B.ball_l), toe_r: endOf(D, P, B.ball_r) }
  return { D, P, pelvis, feet: fl, down, ends, drop: st.drop }
}
void NB
void REST_OFFSET
