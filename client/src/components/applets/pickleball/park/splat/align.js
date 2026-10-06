// Placing a captured splat on a venue's court: a similarity transform (scale, rotation,
// translation) from point pairs, Horn's closed form (1987, unit quaternions): the 4x4
// matrix's top eigenvector is the rotation. Pure math, no three.js: tested in Node.
//   similarity(src, dst) -> { s, q: [x, y, z, w], t: [x, y, z], rms }   with dst ≈ s·R(q)·src + t

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const centroid = (pts) => {
  const c = [0, 0, 0]
  for (const p of pts) for (let i = 0; i < 3; i++) c[i] += p[i] / pts.length
  return c
}

// Jacobi eigenvalue iteration for a symmetric 4x4: returns the eigenvector of the largest eigenvalue
const topEigen4 = (A) => {
  const a = A.map((r) => r.slice())
  const v = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q]
    if (off < 1e-20) break
    for (let p = 0; p < 4; p++)
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < 4; k++) {
          const akp = a[k][p]
          const akq = a[k][q]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p][k]
          const aqk = a[q][k]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k][p]
          const vkq = v[k][q]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
  }
  let best = 0
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i
  return [v[0][best], v[1][best], v[2][best], v[3][best]]
}

export const rotate = (q, p) => {
  const [x, y, z, w] = q
  // v' = v + 2w(u×v) + 2u×(u×v)
  const u = [x, y, z]
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const uv = cross(u, p)
  const uuv = cross(u, uv)
  return [p[0] + 2 * (w * uv[0] + uuv[0]), p[1] + 2 * (w * uv[1] + uuv[1]), p[2] + 2 * (w * uv[2] + uuv[2])]
}

export const apply = (T, p) => {
  const r = rotate(T.q, p)
  return [T.s * r[0] + T.t[0], T.s * r[1] + T.t[1], T.s * r[2] + T.t[2]]
}

export const similarity = (src, dst) => {
  if (src.length !== dst.length || src.length < 3) throw new Error("Need at least 3 matching points.")
  const cs = centroid(src)
  const cd = centroid(dst)
  const a = src.map((p) => sub(p, cs))
  const b = dst.map((p) => sub(p, cd))
  // scale: the ratio of spreads (Horn's symmetric form)
  let ssa = 0
  let ssb = 0
  for (let i = 0; i < a.length; i++) {
    ssa += a[i][0] ** 2 + a[i][1] ** 2 + a[i][2] ** 2
    ssb += b[i][0] ** 2 + b[i][1] ** 2 + b[i][2] ** 2
  }
  if (ssa < 1e-12) throw new Error("The points are all in one place.")
  const s = Math.sqrt(ssb / ssa)
  // cross-covariance M (src -> dst)
  const M = [0, 1, 2].map(() => [0, 0, 0])
  for (let i = 0; i < a.length; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[r][c] += a[i][r] * b[i][c]
  const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = M
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ]
  const [w, x, y, z] = topEigen4(N)
  const n = Math.hypot(w, x, y, z) || 1
  const q = [x / n, y / n, z / n, w / n]
  const rc = rotate(q, cs)
  const t = [cd[0] - s * rc[0], cd[1] - s * rc[1], cd[2] - s * rc[2]]
  const T = { s, q, t }
  let err = 0
  for (let i = 0; i < src.length; i++) {
    const p = apply(T, src[i])
    err += (p[0] - dst[i][0]) ** 2 + (p[1] - dst[i][1]) ** 2 + (p[2] - dst[i][2]) ** 2
  }
  T.rms = Math.sqrt(err / src.length)
  return T
}

// a court's four corners in venue meters (y = 0), in tap order: near-left, near-right,
// far-right, far-left as seen from the court's near baseline. c: { x, z, rot } (layout courts)
export const COURT_W = 6.1
export const COURT_L = 13.41
export const courtCorners = (c) => {
  const hw = COURT_W / 2
  const hl = COURT_L / 2
  const local = [
    [-hw, hl],
    [hw, hl],
    [hw, -hl],
    [-hw, -hl],
  ]
  const cos = Math.cos(c.rot || 0)
  const sin = Math.sin(c.rot || 0)
  return local.map(([lx, lz]) => [c.x + lx * cos + lz * sin, 0, c.z - lx * sin + lz * cos])
}

// the splat's "up": a court scene is flat, so the direction of least spread among the
// centers is (nearly) up. Power iteration on the inverse is overkill: Jacobi on the 3x3
// embedded in a 4x4 with a zero row works with the same solver.
export const upAxis = (centers, sample = 20000) => {
  const n = centers.length / 3
  const step = Math.max(1, Math.floor(n / sample))
  let cx = 0
  let cy = 0
  let cz = 0
  let k = 0
  for (let i = 0; i < n; i += step, k++) {
    cx += centers[i * 3]
    cy += centers[i * 3 + 1]
    cz += centers[i * 3 + 2]
  }
  cx /= k
  cy /= k
  cz /= k
  const C = [0, 1, 2].map(() => [0, 0, 0])
  for (let i = 0; i < n; i += step) {
    const d = [centers[i * 3] - cx, centers[i * 3 + 1] - cy, centers[i * 3 + 2] - cz]
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r][c] += d[r] * d[c]
  }
  // smallest eigenvector of C = largest of (trace·I − C)
  const tr = C[0][0] + C[1][1] + C[2][2]
  const B = [
    [tr - C[0][0], -C[0][1], -C[0][2], 0],
    [-C[1][0], tr - C[1][1], -C[1][2], 0],
    [-C[2][0], -C[2][1], tr - C[2][2], 0],
    [0, 0, 0, -1],
  ]
  const v = topEigen4(B)
  const len = Math.hypot(v[0], v[1], v[2]) || 1
  return { up: [v[0] / len, v[1] / len, v[2] / len], center: [cx, cy, cz] }
}
