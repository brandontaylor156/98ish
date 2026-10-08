// Players v3: photo faces. The math that carries a photo-textured head (Microsoft Rocketbox's
// avatars, MIT; see ../../CREDITS.md) onto the MakeHuman athletes' own head: the athletes keep
// their topology, skeleton, skin weights, expressions, eyes, teeth, hair and kits, and get the
// photographed face's shape (front of the head only: the cranium stays, so every hairstyle and
// hat still fits) and its skin, baked into their own UV layout. Pure functions, no I/O (tested
// in faces.test.js); tools/build-faces.mjs runs them.
//
// The steps (build-faces.mjs):
//   1. landmarks on both heads (eye centers, mouth corners, lips, nose tip, brows, chin);
//   2. a similarity transform (scale, turn, shift) puts the source head on ours by them;
//   3. a thin-plate spline bends our face so the landmarks meet, then a few rounds of
//      closest-point fitting with a smoothed displacement (a non-rigid ICP) pull its surface
//      onto the source's;
//   4. every texel of our skin atlas finds its point on our (fitted) surface, then the closest
//      point on the source head, and takes the source texture there.

// ---- small vector helpers (arrays [x, y, z]) ----
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (a) => Math.hypot(a[0], a[1], a[2])
export const norm = (a) => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const P = (pos, i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]
export const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// ---- welding (UV seams duplicate vertices: they must move together) ----
// canonical id per vertex (vertices at the same position share one), and the count
export const weld = (pos, eps = 1e-5) => {
  const n = pos.length / 3
  const map = new Map()
  const canon = new Int32Array(n)
  let k = 0
  const q = (x) => Math.round(x / eps)
  for (let i = 0; i < n; i++) {
    const key = q(pos[i * 3]) + "," + q(pos[i * 3 + 1]) + "," + q(pos[i * 3 + 2])
    let c = map.get(key)
    if (c === undefined) map.set(key, (c = k++))
    canon[i] = c
  }
  return { canon, count: k }
}
// the welded mesh: positions per canonical id and triangles on them
export const weldedMesh = (pos, index, w = weld(pos)) => {
  const cp = new Float64Array(w.count * 3)
  for (let i = 0; i < w.canon.length; i++) for (let k = 0; k < 3; k++) cp[w.canon[i] * 3 + k] = pos[i * 3 + k]
  const tris = new Int32Array(index.length)
  for (let t = 0; t < index.length; t++) tris[t] = w.canon[index[t]]
  return { pos: cp, index: tris, canon: w.canon, count: w.count }
}
// neighbors of each vertex (by the triangles' edges)
export const adjacency = (n, index) => {
  const sets = Array.from({ length: n }, () => new Set())
  for (let t = 0; t < index.length; t += 3)
    for (let j = 0; j < 3; j++) {
      const a = index[t + j]
      const b = index[t + ((j + 1) % 3)]
      if (a === b) continue
      sets[a].add(b)
      sets[b].add(a)
    }
  return sets.map((s) => Int32Array.from(s))
}
// area-weighted vertex normals
export const normalsOf = (pos, index, n = pos.length / 3) => {
  const out = new Float64Array(n * 3)
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]]
    const f = cross(sub(P(pos, b), P(pos, a)), sub(P(pos, c), P(pos, a)))
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) out[v * 3 + k] += f[k]
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]) || 1
    for (let k = 0; k < 3; k++) out[i * 3 + k] /= l
  }
  return out
}

// ---- closest point on a triangle (Ericson, Real-Time Collision Detection 5.1.5) ----
// returns the barycentric weights [u, v, w] of the closest point (p = u a + v b + w c)
export const closestOnTriangle = (p, a, b, c) => {
  const ab = sub(b, a)
  const ac = sub(c, a)
  const ap = sub(p, a)
  const d1 = dot(ab, ap)
  const d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0]
  const bp = sub(p, b)
  const d3 = dot(ab, bp)
  const d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0]
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return [1 - v, v, 0]
  }
  const cp = sub(p, c)
  const d5 = dot(ab, cp)
  const d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1]
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return [1 - w, 0, w]
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return [0, 1 - w, w]
  }
  const den = 1 / (va + vb + vc)
  const v = vb * den
  const w = vc * den
  return [1 - v - w, v, w]
}

// ---- a uniform grid over a set of triangles, for closest-point queries ----
// pos/index: the mesh; tris: which triangles (ids) to search (default all); cell in meters
export const triangleGrid = (pos, index, tris = null, cell = 0.006) => {
  const ids = tris || Array.from({ length: index.length / 3 }, (_, i) => i)
  const cells = new Map()
  // (a number per cell: within +-1000 cells each way)
  const key = (x, y, z) => (x + 1024) * 4194304 + (y + 1024) * 2048 + (z + 1024)
  const fl = (x) => Math.floor(x / cell)
  const stamp = new Int32Array(index.length / 3)
  let query_id = 0
  for (const t of ids) {
    const a = P(pos, index[t * 3])
    const b = P(pos, index[t * 3 + 1])
    const c = P(pos, index[t * 3 + 2])
    const lo = [0, 1, 2].map((k) => fl(Math.min(a[k], b[k], c[k])))
    const hi = [0, 1, 2].map((k) => fl(Math.max(a[k], b[k], c[k])))
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const k = key(x, y, z)
          let l = cells.get(k)
          if (!l) cells.set(k, (l = []))
          l.push(t)
        }
  }
  // closest point within maxR (null if none); accept(t) can skip triangles (e.g. facing away)
  const query = (p, maxR = 0.05, accept = null) => {
    const c0 = [fl(p[0]), fl(p[1]), fl(p[2])]
    let best = null
    const qid = ++query_id
    const rings = Math.ceil(maxR / cell)
    for (let r = 0; r <= rings; r++) {
      // (a ring's closest possible point is (r - 1) cells away: stop once that's beyond the best)
      if (best && (r - 1) * cell > Math.sqrt(best.d2)) break
      for (let x = -r; x <= r; x++)
        for (let y = -r; y <= r; y++)
          for (let z = -r; z <= r; z++) {
            if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== r) continue
            const l = cells.get(key(c0[0] + x, c0[1] + y, c0[2] + z))
            if (!l) continue
            for (const t of l) {
              if (stamp[t] === qid) continue
              stamp[t] = qid
              if (accept && !accept(t)) continue
              const a = P(pos, index[t * 3])
              const b = P(pos, index[t * 3 + 1])
              const c = P(pos, index[t * 3 + 2])
              const w = closestOnTriangle(p, a, b, c)
              const q = [a[0] * w[0] + b[0] * w[1] + c[0] * w[2], a[1] * w[0] + b[1] * w[1] + c[1] * w[2], a[2] * w[0] + b[2] * w[1] + c[2] * w[2]]
              const d = sub(q, p)
              const d2 = dot(d, d)
              if (d2 <= maxR * maxR && (!best || d2 < best.d2)) best = { t, w, p: q, d2 }
            }
          }
    }
    return best
  }
  return { query, cell }
}

// ---- similarity transform (Horn's quaternion method + scale): dst ~ s R src + t ----
const jacobiEigen4 = (A) => {
  // symmetric 4x4 eigen-decomposition (cyclic Jacobi); returns { values, vectors (columns) }
  const a = A.map((r) => r.slice())
  const v = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) off += a[i][j] * a[i][j]
    if (off < 1e-22) break
    for (let p = 0; p < 4; p++)
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1))
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
  return { values: [0, 1, 2, 3].map((i) => a[i][i]), vectors: v }
}
export const quatToMat = ([w, x, y, z]) => [
  [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
  [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
  [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
]
// weights: optional per pair; returns { s, R (rows), t, apply(p) }
export const similarity = (src, dst, weights = null) => {
  const n = src.length
  const W = weights || src.map(() => 1)
  const sw = W.reduce((a, b) => a + b, 0)
  const cs = [0, 0, 0]
  const cd = [0, 0, 0]
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) (cs[k] += (src[i][k] * W[i]) / sw), (cd[k] += (dst[i][k] * W[i]) / sw)
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  let ss = 0
  let sd = 0
  for (let i = 0; i < n; i++) {
    const a = sub(src[i], cs)
    const b = sub(dst[i], cd)
    ss += W[i] * dot(a, a)
    sd += W[i] * dot(b, b)
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += W[i] * a[r] * b[c]
  }
  const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = S
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ]
  const { values, vectors } = jacobiEigen4(N)
  let bi = 0
  for (let i = 1; i < 4; i++) if (values[i] > values[bi]) bi = i
  const q = [vectors[0][bi], vectors[1][bi], vectors[2][bi], vectors[3][bi]]
  const R = quatToMat(q)
  const s = Math.sqrt(sd / ss)
  const rot = (p) => [R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2], R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2], R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2]]
  const rc = rot(cs)
  const t = [cd[0] - s * rc[0], cd[1] - s * rc[1], cd[2] - s * rc[2]]
  return { s, R, t, apply: (p) => add(mul(rot(p), s), t) }
}

// ---- 3D thin-plate spline (kernel |r|, plus an affine part): src points -> dst points ----
const solve = (A, b) => {
  // Gaussian elimination with partial pivoting (small dense systems)
  const n = A.length
  const M = A.map((r, i) => [...r, ...b[i]])
  const m = b[0].length
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    const d = M[c][c]
    if (Math.abs(d) < 1e-14) continue
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / d
      if (!f) continue
      for (let k = c; k < n + m; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((r, i) => r.slice(n).map((x) => x / (M[i][i] || 1)))
}
// the sphere through points (algebraic least squares): { center, radius }
export const fitSphere = (pts) => {
  // |p|^2 = 2 c.p + k  (k = r^2 - |c|^2)
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
  const b = [[0], [0], [0], [0]]
  for (const p of pts) {
    const row = [2 * p[0], 2 * p[1], 2 * p[2], 1]
    const y = dot(p, p)
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]
      b[i][0] += row[i] * y
    }
  }
  const x = solve(A, b).map((r) => r[0])
  const center = [x[0], x[1], x[2]]
  return { center, radius: Math.sqrt(Math.max(0, x[3] + dot(center, center))) }
}
export const thinPlate = (src, dst, lambda = 0) => {
  const n = src.length
  const N = n + 4
  const A = Array.from({ length: N }, () => new Array(N).fill(0))
  const b = Array.from({ length: N }, () => [0, 0, 0])
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i][j] = len(sub(src[i], src[j])) + (i === j ? lambda : 0)
    A[i][n] = 1
    A[i][n + 1] = src[i][0]
    A[i][n + 2] = src[i][1]
    A[i][n + 3] = src[i][2]
    A[n][i] = 1
    A[n + 1][i] = src[i][0]
    A[n + 2][i] = src[i][1]
    A[n + 3][i] = src[i][2]
    b[i] = sub(dst[i], src[i]) // (the spline carries the displacement)
  }
  const w = solve(A, b)
  return (p) => {
    const d = [w[n][0] + w[n + 1][0] * p[0] + w[n + 2][0] * p[1] + w[n + 3][0] * p[2], w[n][1] + w[n + 1][1] * p[0] + w[n + 2][1] * p[1] + w[n + 3][1] * p[2], w[n][2] + w[n + 1][2] * p[0] + w[n + 2][2] * p[1] + w[n + 3][2] * p[2]]
    for (let i = 0; i < n; i++) {
      const r = len(sub(p, src[i]))
      for (let k = 0; k < 3; k++) d[k] += w[i][k] * r
    }
    return add(p, d)
  }
}

// ---- non-rigid fit (ICP with a smoothed displacement field) ----
// mesh: welded { pos, index, count }; move: Float64Array weight per vertex (0 = stays, 1 = free);
// target: triangleGrid of the source surface (with its pos/index/normals for the facing test);
// pins: [[vertex, [x, y, z]]] landmarks held where they belong; returns new positions
export const fitSurface = (mesh, move, target, { pins = [], rounds = 12, maxR = 0.03, smooth = 12, stiff = [8, 1], normalsT = null, maxShift = 0.01, skip = null } = {}) => {
  const n = mesh.count
  const pos = Float64Array.from(mesh.pos)
  const start = mesh.pos
  const adj = adjacency(n, mesh.index)
  const pinned = new Map(pins)
  for (let round = 0; round < rounds; round++) {
    const lam = stiff[0] + ((stiff[1] - stiff[0]) * round) / Math.max(1, rounds - 1)
    const nrm = normalsOf(pos, mesh.index, n)
    const d = new Float64Array(n * 3)
    const c = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      if (move[i] <= 0) continue
      if (pinned.has(i)) {
        const q = pinned.get(i)
        for (let k = 0; k < 3; k++) d[i * 3 + k] = q[k] - pos[i * 3 + k]
        c[i] = 20
        continue
      }
      const p = P(pos, i)
      const ni = P(nrm, i)
      // (skipped vertices — the mouth's inside, the lips' seam — just ride along with their neighbors)
      if (skip?.[i]) continue
      const hit = target.query(p, maxR, normalsT ? (t) => dot(normalsT(t), ni) > 0.2 : null)
      if (!hit) continue
      const dd = sub(hit.p, p)
      for (let k = 0; k < 3; k++) d[i * 3 + k] = dd[k]
      // (a point straight along the normal is trusted more than one off to the side)
      const l = Math.sqrt(hit.d2) || 1e-9
      c[i] = 0.3 + 0.7 * Math.abs(dot(dd, ni)) / l
    }
    // smooth: each vertex's step toward its neighbors' (Jacobi), weighted by confidence
    let cur = d
    for (let s = 0; s < smooth; s++) {
      const nx = new Float64Array(n * 3)
      for (let i = 0; i < n; i++) {
        if (move[i] <= 0) continue
        const nb = adj[i]
        let sx = c[i] * d[i * 3]
        let sy = c[i] * d[i * 3 + 1]
        let sz = c[i] * d[i * 3 + 2]
        let sw = c[i]
        for (const j of nb) {
          sx += lam * cur[j * 3]
          sy += lam * cur[j * 3 + 1]
          sz += lam * cur[j * 3 + 2]
          sw += lam
        }
        nx[i * 3] = sx / sw
        nx[i * 3 + 1] = sy / sw
        nx[i * 3 + 2] = sz / sw
      }
      cur = nx
    }
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) pos[i * 3 + k] += cur[i * 3 + k] * move[i]
      // (never far from where the landmarks' bend put it: a cavity's inside — a nostril, the
      // mouth — must not be dragged onto some outer surface)
      const dx = pos[i * 3] - start[i * 3]
      const dy = pos[i * 3 + 1] - start[i * 3 + 1]
      const dz = pos[i * 3 + 2] - start[i * 3 + 2]
      const l = Math.hypot(dx, dy, dz)
      if (l > maxShift) {
        const f = maxShift / l
        pos[i * 3] = start[i * 3] + dx * f
        pos[i * 3 + 1] = start[i * 3 + 1] + dy * f
        pos[i * 3 + 2] = start[i * 3 + 2] + dz * f
      }
    }
  }
  return pos
}

// ---- landmarks on our (MakeHuman) head, from its own geometry and expressions ----
// body: { pos, index }; eyes: positions of the Eyes mesh; smile/shout: morph deltas on the body
// (per vertex, same order); returns named points (and the vertex each one is on, if any)
export const ourLandmarks = ({ pos, eyes, smile, shout }) => {
  // the eyes: the eyeball meshes' centers (x > 0 is the athlete's left)
  const eye = { l: [0, 0, 0, 0], r: [0, 0, 0, 0] }
  for (let i = 0; i < eyes.length; i += 3) {
    const e = eyes[i] > 0 ? eye.l : eye.r
    e[0] += eyes[i]
    e[1] += eyes[i + 1]
    e[2] += eyes[i + 2]
    e[3]++
  }
  const eyeL = [eye.l[0] / eye.l[3], eye.l[1] / eye.l[3], eye.l[2] / eye.l[3]]
  const eyeR = [eye.r[0] / eye.r[3], eye.r[1] / eye.r[3], eye.r[2] / eye.r[3]]
  return faceLandmarks({ pos, eyeL, eyeR, smile, jaw: shout })
}
// Which of a head's morph targets opens the jaw and which smiles (a source whose targets have no
// names): the jaw moves the chin down the most; a smile pulls both mouth corners out and up
export const classifyTargets = (pos, targets, mid) => {
  const n = pos.length / 3
  let jaw = -1
  let smile = -1
  let bj = 0
  let bs = 0
  targets.forEach((d, t) => {
    if (!d) return
    let down = 0
    const side = [0, 0]
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3]
      const y = pos[i * 3 + 1] - mid[1]
      const z = pos[i * 3 + 2] - mid[2]
      if (z < -0.05) continue
      if (y < -0.11 && y > -0.17) down += Math.max(0, -d[i * 3 + 1])
      if (y > -0.1 && y < -0.05 && Math.abs(x) > 0.015 && Math.abs(x) < 0.04) {
        const out = Math.sign(x) * d[i * 3]
        side[x > 0 ? 0 : 1] += Math.max(0, out) + Math.max(0, d[i * 3 + 1])
      }
    }
    if (down > bj) (bj = down), (jaw = t)
    const both = Math.min(side[0], side[1])
    if (both > bs) (bs = both), (smile = t)
  })
  return { jaw, smile }
}
// The same landmarks on any head, from its eye centers and its smile and jaw-open targets:
// mouth corners, the lips' middles, nose tip, chin, the brows' ridge
export const faceLandmarks = ({ pos, eyeL, eyeR, smile, jaw }) => {
  const n = pos.length / 3
  const shout = jaw
  const mid = mul(add(eyeL, eyeR), 0.5)
  // (the midline: vertices within a few mm of x = 0; wider if a mesh has none that close)
  let midTol = 0.002
  for (; midTol < 0.012; midTol *= 1.5) {
    let c = 0
    for (let i = 0; i < n; i++) if (Math.abs(pos[i * 3]) <= midTol && pos[i * 3 + 2] > mid[2] - 0.02) c++
    if (c > 20) break
  }
  const ipd = len(sub(eyeL, eyeR))
  const near = (i, dy0, dy1, dzMin = -1) => {
    const y = pos[i * 3 + 1] - mid[1]
    return y > dy0 && y < dy1 && pos[i * 3 + 2] - mid[2] > dzMin
  }
  // the mouth corners: where the smile moves the face the most, each side
  let cl = -1
  let cr = -1
  let bl = 0
  let br = 0
  for (let i = 0; i < n; i++) {
    if (!near(i, -0.12, -0.04, -0.02)) continue
    const m = Math.hypot(smile[i * 3], smile[i * 3 + 1], smile[i * 3 + 2])
    if (pos[i * 3] > 0.01 && m > bl) (bl = m), (cl = i)
    if (pos[i * 3] < -0.01 && m > br) (br = m), (cr = i)
  }
  const mouthY = (pos[cl * 3 + 1] + pos[cr * 3 + 1]) / 2
  // where the lips meet (on the midline, in front): between the lowest point that stays put
  // when the jaw opens and the highest that goes down with it; then each lip's front-most point
  // within 15 mm above / below that
  let maxDown = 0
  const midMouth = []
  for (let i = 0; i < n; i++) {
    if (Math.abs(pos[i * 3]) > midTol || Math.abs(pos[i * 3 + 1] - mouthY) > 0.025) continue
    if (pos[i * 3 + 2] - mid[2] < -0.01) continue
    midMouth.push(i)
    maxDown = Math.max(maxDown, -shout[i * 3 + 1])
  }
  let seamUp = Infinity
  let seamLo = -Infinity
  for (const i of midMouth) {
    const y = pos[i * 3 + 1]
    const down = -shout[i * 3 + 1]
    if (down < 0.3 * maxDown) seamUp = Math.min(seamUp, y < mouthY + 0.004 ? Infinity : y)
    if (down > 0.5 * maxDown) seamLo = Math.max(seamLo, y > mouthY + 0.004 ? -Infinity : y)
  }
  // (the stomion: if the rule found no clean seam, the mouth corners' height)
  const seam = Number.isFinite(seamUp) && Number.isFinite(seamLo) && seamUp > seamLo ? (seamUp + seamLo) / 2 : mouthY
  let up = -1
  let lo = -1
  for (let i = 0; i < n; i++) {
    if (Math.abs(pos[i * 3]) > midTol) continue
    const y = pos[i * 3 + 1] - seam
    if (pos[i * 3 + 2] - mid[2] < -0.01) continue
    if (y > 0 && y < 0.015 && (up < 0 || pos[i * 3 + 2] > pos[up * 3 + 2])) up = i
    if (y < 0 && y > -0.015 && (lo < 0 || pos[i * 3 + 2] > pos[lo * 3 + 2])) lo = i
  }
  // the nose tip: the front-most point on the midline between the eyes and the mouth
  let nose = -1
  for (let i = 0; i < n; i++) {
    if (Math.abs(pos[i * 3]) > 2 * midTol) continue
    const y = pos[i * 3 + 1]
    if (y > mid[1] - 0.01 || y < mouthY + 0.01) continue
    if (nose < 0 || pos[i * 3 + 2] > pos[nose * 3 + 2]) nose = i
  }
  // the chin: the front-most midline point below the lower lip (within 6 cm)
  let chin = -1
  for (let i = 0; i < n; i++) {
    if (Math.abs(pos[i * 3]) > 2 * midTol) continue
    const y = pos[i * 3 + 1]
    if (y > pos[lo * 3 + 1] - 0.02 || y < pos[lo * 3 + 1] - 0.06) continue
    if (chin < 0 || pos[i * 3 + 2] > pos[chin * 3 + 2]) chin = i
  }
  // the chin's underside: the lowest midline point in front of the neck
  let under = -1
  for (let i = 0; i < n; i++) {
    if (Math.abs(pos[i * 3]) > 2 * midTol) continue
    if (pos[i * 3 + 2] < pos[chin * 3 + 2] - 0.03) continue
    const y = pos[i * 3 + 1]
    if (y > pos[chin * 3 + 1] || y < pos[chin * 3 + 1] - 0.05) continue
    if (under < 0 || y < pos[under * 3 + 1]) under = i
  }
  // the brow ridge over each eye, and between them (the most forward point 2-3.5 cm above the eye)
  const brow = (x0) => {
    let b = -1
    for (let i = 0; i < n; i++) {
      if (Math.abs(pos[i * 3] - x0) > 0.007) continue
      const y = pos[i * 3 + 1] - mid[1]
      if (y < 0.012 || y > 0.035) continue
      if (b < 0 || pos[i * 3 + 2] > pos[b * 3 + 2]) b = i
    }
    return b
  }
  const vtx = { mouthL: cl, mouthR: cr, lipUp: up, lipLo: lo, nose, chin, under, browL: brow(eyeL[0]), browR: brow(eyeR[0]), browM: brow(0) }
  const pts = { eyeL, eyeR }
  for (const [k, i] of Object.entries(vtx)) if (i >= 0) pts[k] = P(pos, i)
  return { pts, vtx, mid, ipd, seam }
}

// ---- landmarks on the source head: its face rig's bones, pulled onto its skin ----
// bones: name -> [x, y, z] (the source's rest pose, in our frame); surface: triangleGrid;
// returns the same names as ourLandmarks
export const sourceLandmarks = (bones, surface, forward = [0, 0, 1]) => {
  const B = (n) => bones[n]
  const onSkin = (p, reach = 0.04) => {
    // (the skin point in front of a bone: the closest one to a point a little ahead of it)
    const ahead = add(p, mul(forward, 0.02))
    const h = surface.query(ahead, reach)
    return h ? h.p : p
  }
  const eyeL = B("LEye")
  const eyeR = B("REye")
  const lipUp = onSkin(B("MUpperLip"))
  const lipLo = onSkin(B("MBottomLip"))
  const pts = {
    eyeL,
    eyeR,
    mouthL: onSkin(B("LMouthCorner")),
    mouthR: onSkin(B("RMouthCorner")),
    lipUp,
    lipLo,
    nose: onSkin(add(B("MNose"), mul(forward, 0.02))),
    browL: onSkin(mul(add(B("LInnerEyebrow"), B("LOuterEyebrow")), 0.5)),
    browR: onSkin(mul(add(B("RInnerEyebrow"), B("ROuterEyebrow")), 0.5)),
    browM: onSkin(B("MMiddleEyebrow")),
  }
  return { pts, mid: mul(add(eyeL, eyeR), 0.5), ipd: len(sub(eyeL, eyeR)) }
}

// ---- where our face may change shape (1) and where it must keep ours (0) ----
// p: a rest position; mid: the eyes' midpoint. The front of the face, from above the brows to
// under the chin; the cranium (hair, hats), the ears and the neck keep their shape
export const faceWeight = (p, mid) => {
  const y = p[1] - mid[1]
  const z = p[2] - mid[2]
  const front = smoothstep(-0.07, -0.035, z)
  const top = 1 - smoothstep(0.035, 0.065, y)
  const bottom = smoothstep(-0.16, -0.115, y)
  return front * top * bottom
}
// where the photo's skin is used (1) or ours, tone-matched (0): the head and the neck down to
// its base (a soft seam into the body's skin under the collar line)
export const photoWeight = (p, mid) => {
  const y = p[1] - mid[1]
  return smoothstep(-0.27, -0.2, y)
}

// ---- grow an image's covered texels outward (mask 1 = covered), `passes` texels, in place ----
// (only the frontier is visited each pass: fast on 2048 maps)
export const grow = (img, mask, size, ch, passes = 4) => {
  const N = size * size
  let front = []
  for (let i = 0; i < N; i++) {
    if (mask[i]) continue
    const x = i % size
    const y = (i - x) / size
    if ((x > 0 && mask[i - 1]) || (x < size - 1 && mask[i + 1]) || (y > 0 && mask[i - size]) || (y < size - 1 && mask[i + size])) front.push(i)
  }
  const sum = new Float64Array(ch)
  for (let p = 0; p < passes && front.length; p++) {
    const vals = new Uint8Array(front.length * ch)
    for (let f = 0; f < front.length; f++) {
      const i = front[f]
      const x = i % size
      sum.fill(0)
      let n = 0
      for (const j of [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, i - size, i + size]) {
        if (j < 0 || j >= N || !mask[j]) continue
        for (let c = 0; c < ch; c++) sum[c] += img[j * ch + c]
        n++
      }
      for (let c = 0; c < ch; c++) vals[f * ch + c] = Math.round(sum[c] / (n || 1))
    }
    const next = new Set()
    for (let f = 0; f < front.length; f++) {
      const i = front[f]
      for (let c = 0; c < ch; c++) img[i * ch + c] = vals[f * ch + c]
      mask[i] = 1
    }
    for (const i of front) {
      const x = i % size
      for (const j of [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, i - size, i + size]) if (j >= 0 && j < N && !mask[j]) next.add(j)
    }
    front = [...next]
  }
}

// ---- color helpers (sRGB bytes <-> linear) ----
export const toLin = (c) => {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}
export const toSrgb = (x) => Math.round(255 * Math.max(0, Math.min(1, x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)))
// bilinear sample of an RGB(A) image at uv (glTF: v down from the top)
export const sampleImage = (img, u, v) => {
  const { width: W, height: H, channels: C, data } = img
  const x = Math.max(0, Math.min(W - 1.001, u * W - 0.5))
  const y = Math.max(0, Math.min(H - 1.001, v * H - 0.5))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const out = new Array(C)
  for (let c = 0; c < C; c++) {
    const a = data[(y0 * W + x0) * C + c]
    const b = data[(y0 * W + x0 + 1) * C + c]
    const d = data[((y0 + 1) * W + x0) * C + c]
    const e = data[((y0 + 1) * W + x0 + 1) * C + c]
    out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy
  }
  return out
}
// mean and spread of linear RGB over the pixels where mask is set
export const colorStats = (data, ch, mask) => {
  const m = [0, 0, 0]
  const s = [0, 0, 0]
  let n = 0
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    for (let k = 0; k < 3; k++) {
      const x = toLin(data[i * ch + k])
      m[k] += x
      s[k] += x * x
    }
    n++
  }
  for (let k = 0; k < 3; k++) {
    m[k] /= n || 1
    s[k] = Math.sqrt(Math.max(0, s[k] / (n || 1) - m[k] * m[k]))
  }
  return { mean: m, std: s, n }
}
