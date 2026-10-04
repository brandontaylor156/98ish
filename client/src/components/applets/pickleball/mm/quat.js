// Pickleball 98 motion matching: vector and quaternion helpers ({x, y, z} and {x, y, z, w}),
// standalone (no imports) so the mm/ modules never sit in an import cycle with anim.js and
// retarget.js. The same conventions as retarget.js.

export const V = (x = 0, y = 0, z = 0) => ({ x, y, z })
export const vsub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z)
export const vadd = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z)
export const vmul = (a, s) => V(a.x * s, a.y * s, a.z * s)
export const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
export const vcross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
export const vlen = (a) => Math.hypot(a.x, a.y, a.z)
export const vnorm = (a, fallback = V(0, 1, 0)) => {
  const l = vlen(a)
  return l > 1e-9 ? vmul(a, 1 / l) : { ...fallback }
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export const Q = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w })
export const qmul = (a, b) => Q(a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z)
export const qinv = (q) => Q(-q.x, -q.y, -q.z, q.w)
export const qnorm = (q) => {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1
  return Q(q.x / l, q.y / l, q.z / l, q.w / l)
}
export const qrot = (q, v) => {
  const u = V(q.x, q.y, q.z)
  const t = vmul(vcross(u, v), 2)
  return vadd(vadd(v, vmul(t, q.w)), vcross(u, t))
}
export const qaxis = (axis, angle) => {
  const a = vnorm(axis)
  const s = Math.sin(angle / 2)
  return Q(a.x * s, a.y * s, a.z * s, Math.cos(angle / 2))
}
export const qslerp = (a, b, t) => {
  let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
  const s = d < 0 ? -1 : 1
  d *= s
  if (d > 0.9995) return qnorm(Q(a.x + (s * b.x - a.x) * t, a.y + (s * b.y - a.y) * t, a.z + (s * b.z - a.z) * t, a.w + (s * b.w - a.w) * t))
  const th = Math.acos(d)
  const k0 = Math.sin((1 - t) * th) / Math.sin(th)
  const k1 = (s * Math.sin(t * th)) / Math.sin(th)
  return Q(a.x * k0 + b.x * k1, a.y * k0 + b.y * k1, a.z * k0 + b.z * k1, a.w * k0 + b.w * k1)
}
export const qangle = (a, b) => 2 * Math.acos(clamp(Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w), 0, 1))
export const qbasis = (x, y, z) => {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = [x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z]
  const tr = m00 + m11 + m22
  let q
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1)
    q = Q((m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s)
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    q = Q(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s)
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    q = Q((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s)
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    q = Q((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s)
  }
  return qnorm(q)
}
// a frame: y = primary (exact), z = the hint made perpendicular, x = y cross z
export const frameOf = (primary, hint) => {
  const y = vnorm(primary)
  let z = vsub(hint, vmul(y, vdot(hint, y)))
  if (vlen(z) < 1e-6) z = Math.abs(y.y) < 0.9 ? vcross(V(0, 1, 0), y) : vcross(V(1, 0, 0), y)
  z = vnorm(z)
  return qbasis(vcross(y, z), y, z)
}

// two bones from a (lengths l1, l2) toward t, bending toward pole (as anim.js twoBone)
export const twoBone = (a, t, l1, l2, pole) => {
  const d = vsub(t, a)
  const dist0 = vlen(d)
  const dir = vnorm(d, V(0, -1, 0))
  const dist = clamp(dist0, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4)
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1)
  const sinA = Math.sqrt(1 - cosA * cosA)
  let pp = vsub(pole, vmul(dir, vdot(pole, dir)))
  if (vlen(pp) < 1e-6) pp = Math.abs(dir.y) < 0.9 ? vcross(dir, V(0, 1, 0)) : vcross(dir, V(1, 0, 0))
  pp = vnorm(pp)
  const mid = vadd(a, vadd(vmul(dir, l1 * cosA), vmul(pp, l1 * sinA)))
  const end = vadd(a, vmul(dir, dist))
  return { mid, end, reached: dist0 <= l1 + l2 }
}
