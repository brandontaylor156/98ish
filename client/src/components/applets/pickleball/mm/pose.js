// Pickleball 98 motion matching: from the controller's pose to the drawn body. Pure JavaScript
// (Node-tested). The world pose (root yaw applied), forward kinematics, foot locking, a small
// pelvis drop when a pinned foot would be out of a leg's reach, two-bone IK for the legs.
// Returns every canonical joint's world position, the bones' world rotations (D) and the feet
// (where they're pinned, their yaw), for anim.js (pose fields) and athlete.js (bone rotations).

import { qrot } from "./quat.js"
import { B, NB, fk, endOf, REST_OFFSET } from "./skeleton.js"
import { createFootLock, legIK, stepFootLock } from "./footlock.js"
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
// (raise a foot: the split step), still: standing about (settling steps allowed) }
export const solveMMPose = (st, o, dt, extra = {}) => {
  const w = worldOf(o)
  const D = w.D
  const pelvis = { ...w.pelvis }
  const P0 = fk(D, pelvis)
  const feet = ["l", "r"].map((s) => ({ ankle: P0[B["foot_" + s]], ball: P0[B["ball_" + s]], yaw: footYaw(D[B["foot_" + s]]) }))
  const lift = extra.lift || [0, 0]
  const down = [!!(o.contacts & 1) && lift[0] <= 0.002, !!(o.contacts & 2) && lift[1] <= 0.002]
  const fl = stepFootLock(st.lock, feet, down, dt, { still: extra.still ?? true })
  for (let i = 0; i < 2; i++) {
    fl[i].ankle.y += lift[i]
    fl[i].ball.y += lift[i]
  }
  // the pelvis comes down (smoothly) as far as a pinned foot needs, and for a crouch
  const hipW = (s) => P0[B["thigh_" + s]]
  let need = 0
  for (let i = 0; i < 2; i++) {
    if (!fl[i].locked) continue // (a foot in the air just reaches as far as it can)
    const h = hipW(i ? "r" : "l")
    const a = fl[i].ankle
    const dh = Math.hypot(a.x - h.x, a.z - h.z)
    const maxY = a.y + Math.sqrt(Math.max(0, (LEG * 0.985) ** 2 - dh * dh))
    need = Math.max(need, h.y - maxY)
  }
  const want = Math.max(0, need) + (extra.drop || 0)
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
  const P = fk(D, pelvis)
  // legs to the pinned feet
  const knees = []
  for (const [i, s] of [[0, "l"], [1, "r"]]) {
    const r = legIK(P[B["thigh_" + s]], P[B["calf_" + s]], fl[i].ankle, THIGH, SHIN)
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
