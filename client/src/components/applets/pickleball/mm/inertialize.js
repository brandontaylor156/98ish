// Pickleball 98 motion matching: inertialization (after David Bollo's GDC 2018 talk and Daniel
// Holden's "Spring-It-On" / motion-matching articles). Pure JavaScript (Node-tested).
//
// When the search jumps to another frame, the pose would pop. Instead, the difference between
// what was on screen and the new frame (an offset per bone, and its velocity) is kept and
// decays to nothing with a critically damped spring: the new animation plays from the start,
// the offset hides the jump and fades out within a fraction of a second, without ever
// blending two animations (no foot sliding from averaging two walks).

import { qinv, qmul, qnorm } from "./quat.js"

const LN2 = Math.log(2)
export const halflifeToDamping = (h) => (4 * LN2) / (h + 1e-5)

// the exact critically damped spring toward 0: x position, v velocity (numbers)
export const decaySpring = (x, v, halflife, dt) => {
  const y = halflifeToDamping(halflife) / 2
  const j1 = v + x * y
  const e = Math.exp(-y * dt)
  return { x: e * (x + j1 * dt), v: e * (v - j1 * y * dt) }
}

// quaternion <-> scaled angle-axis (the rotation vector: axis * angle)
export const qlogv = (q) => {
  let { x, y, z, w } = q
  if (w < 0) {
    x = -x
    y = -y
    z = -z
    w = -w
  }
  const s = Math.hypot(x, y, z)
  if (s < 1e-8) return { x: 2 * x, y: 2 * y, z: 2 * z }
  const a = (2 * Math.atan2(s, w)) / s
  return { x: x * a, y: y * a, z: z * a }
}
export const qexpv = (v) => {
  const a = Math.hypot(v.x, v.y, v.z)
  if (a < 1e-8) return qnorm({ x: v.x / 2, y: v.y / 2, z: v.z / 2, w: 1 })
  const s = Math.sin(a / 2) / a
  return { x: v.x * s, y: v.y * s, z: v.z * s, w: Math.cos(a / 2) }
}
// the angular velocity taking q0 to q1 in dt (world frame, rad/s vector)
export const angVel = (q0, q1, dt) => {
  const r = qlogv(qmul(q1, qinv(q0)))
  return { x: r.x / dt, y: r.y / dt, z: r.z / dt }
}

// nb bones' rotation offsets + a position offset (the pelvis)
export const createInert = (nb) => ({
  rx: new Float32Array(nb * 3),
  rv: new Float32Array(nb * 3),
  px: new Float32Array(3),
  pv: new Float32Array(3),
  nb,
})

// a jump: prev (on screen: D, angular velocities W, hip H, hip velocity HV) -> src (the new
// frame, same fields). The offset becomes prev - src (on top of what's still decaying)
export const transition = (st, prev, src) => {
  for (let b = 0; b < st.nb; b++) {
    const o = qlogv(qmul(prev.D[b], qinv(src.D[b])))
    st.rx[b * 3] = o.x
    st.rx[b * 3 + 1] = o.y
    st.rx[b * 3 + 2] = o.z
    st.rv[b * 3] = prev.W[b].x - src.W[b].x
    st.rv[b * 3 + 1] = prev.W[b].y - src.W[b].y
    st.rv[b * 3 + 2] = prev.W[b].z - src.W[b].z
  }
  st.px[0] = prev.H.x - src.H.x
  st.px[1] = prev.H.y - src.H.y
  st.px[2] = prev.H.z - src.H.z
  st.pv[0] = prev.HV.x - src.HV.x
  st.pv[1] = prev.HV.y - src.HV.y
  st.pv[2] = prev.HV.z - src.HV.z
}

// decay the offsets for dt
export const decay = (st, halflife, dt) => {
  for (let k = 0; k < st.rx.length; k++) {
    const r = decaySpring(st.rx[k], st.rv[k], halflife, dt)
    st.rx[k] = r.x
    st.rv[k] = r.v
  }
  for (let k = 0; k < 3; k++) {
    const r = decaySpring(st.px[k], st.pv[k], halflife, dt)
    st.px[k] = r.x
    st.pv[k] = r.v
  }
}

// the pose on screen: the offsets on top of the animation's own pose
export const applyInert = (st, D, H, outD, outH) => {
  for (let b = 0; b < st.nb; b++) {
    const off = qexpv({ x: st.rx[b * 3], y: st.rx[b * 3 + 1], z: st.rx[b * 3 + 2] })
    outD[b] = qnorm(qmul(off, D[b]))
  }
  outH.x = H.x + st.px[0]
  outH.y = H.y + st.px[1]
  outH.z = H.z + st.px[2]
  return { D: outD, H: outH }
}
// how big the offsets still are (radians, worst bone)
export const offsetSize = (st) => {
  let m = 0
  for (let b = 0; b < st.nb; b++) m = Math.max(m, Math.hypot(st.rx[b * 3], st.rx[b * 3 + 1], st.rx[b * 3 + 2]))
  return m
}
