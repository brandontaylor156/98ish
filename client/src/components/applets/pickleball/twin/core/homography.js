// Twin Replay: the picture -> the court. A homography (a 3x3 projective map) from image
// pixels to court meters, solved from the corners the user taps (DLT, least squares when
// more than 4 points are given), its inverse, and the standard court points.
//
// Court frame (Pickleball 98's): x across (-HALF_W left .. +HALF_W right as seen from the
// near baseline), z along the court (+HALF_L the near baseline, the camera's end; the net at
// z = 0), meters.

import { HALF_L, HALF_W, KITCHEN, NET_POST_X } from "../../physics.js"
export { HALF_L, HALF_W, KITCHEN, NET_POST_X }

// the points the user can tap, in the order the calibration asks for them
export const COURT_POINTS = [
  { id: "nearLeft", label: "Near left corner", x: -HALF_W, z: HALF_L },
  { id: "nearRight", label: "Near right corner", x: HALF_W, z: HALF_L },
  { id: "farRight", label: "Far right corner", x: HALF_W, z: -HALF_L },
  { id: "farLeft", label: "Far left corner", x: -HALF_W, z: -HALF_L },
  // optional extras (better fit): the kitchen line ends and the net posts' feet
  { id: "nearKitchenLeft", label: "Near kitchen line, left end", x: -HALF_W, z: KITCHEN, optional: true },
  { id: "nearKitchenRight", label: "Near kitchen line, right end", x: HALF_W, z: KITCHEN, optional: true },
  { id: "farKitchenRight", label: "Far kitchen line, right end", x: HALF_W, z: -KITCHEN, optional: true },
  { id: "farKitchenLeft", label: "Far kitchen line, left end", x: -HALF_W, z: -KITCHEN, optional: true },
]

// Solves A h = b (n x n, Gaussian elimination with partial pivoting); null if singular
export const solveLinear = (A, b) => {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      if (!f) continue
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

// Normalizes points (centroid at 0, mean distance sqrt 2) for a well-conditioned solve
const normalizer = (pts) => {
  const n = pts.length
  let cx = 0
  let cy = 0
  for (const p of pts) {
    cx += p[0]
    cy += p[1]
  }
  cx /= n
  cy /= n
  let d = 0
  for (const p of pts) d += Math.hypot(p[0] - cx, p[1] - cy)
  const s = d > 0 ? (Math.SQRT2 * n) / d : 1
  return { T: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1], apply: (p) => [(p[0] - cx) * s, (p[1] - cy) * s] }
}

export const mul3 = (A, B) => {
  const C = new Array(9).fill(0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c]
  return C
}
export const inv3 = (m) => {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-15) return null
  const k = 1 / det
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k]
}

// H maps src [x, y] -> dst [x, y]. pairs: [{ src: [x, y], dst: [x, y] }], 4 or more.
// Least squares on the 8 unknowns (h33 = 1) after normalizing both point sets.
export const solveHomography = (pairs) => {
  if (!pairs || pairs.length < 4) return null
  const ns = normalizer(pairs.map((p) => p.src))
  const nd = normalizer(pairs.map((p) => p.dst))
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0))
  const Atb = new Array(8).fill(0)
  const add = (row, rhs) => {
    for (let r = 0; r < 8; r++) {
      Atb[r] += row[r] * rhs
      for (let c = 0; c < 8; c++) AtA[r][c] += row[r] * row[c]
    }
  }
  for (const p of pairs) {
    const [x, y] = ns.apply(p.src)
    const [u, v] = nd.apply(p.dst)
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u)
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v)
  }
  const h = solveLinear(AtA, Atb)
  if (!h) return null
  const Hn = [...h, 1]
  const Td = inv3(nd.T)
  if (!Td) return null
  const H = mul3(mul3(Td, Hn), ns.T)
  const s = H[8]
  return Math.abs(s) < 1e-15 ? null : H.map((x) => x / s)
}

export const applyH = (H, x, y) => {
  const w = H[6] * x + H[7] * y + H[8]
  if (Math.abs(w) < 1e-12) return null
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]
}

// The calibration: taps [{ id, x, y }] in image pixels -> { H (image->court), Hinv
// (court->image), rms (court meters, the fit's error on the taps), ok }
export const calibrate = (taps) => {
  const pairs = []
  for (const t of taps || []) {
    const p = COURT_POINTS.find((q) => q.id === t.id)
    if (p && Number.isFinite(t.x) && Number.isFinite(t.y)) pairs.push({ src: [t.x, t.y], dst: [p.x, p.z] })
  }
  if (pairs.length < 4) return { ok: false, reason: "Tap all four corners." }
  const H = solveHomography(pairs)
  const Hinv = H && inv3(H)
  if (!H || !Hinv) return { ok: false, reason: "Those corners don't make a court. Try again." }
  let e = 0
  for (const p of pairs) {
    const q = applyH(H, p.src[0], p.src[1])
    e += q ? (q[0] - p.dst[0]) ** 2 + (q[1] - p.dst[1]) ** 2 : 100
  }
  const rms = Math.sqrt(e / pairs.length)
  // a quad that folds over itself (corners in the wrong order) maps the image's middle
  // outside the court or flips orientation: check the four corners' order is preserved
  const corners = ["nearLeft", "nearRight", "farRight", "farLeft"].map((id) => taps.find((t) => t.id === id))
  const area = signedArea(corners.map((c) => [c.x, c.y]))
  const courtArea = signedArea([
    [-HALF_W, HALF_L],
    [HALF_W, HALF_L],
    [HALF_W, -HALF_L],
    [-HALF_W, -HALF_L],
  ])
  if (!convex(corners.map((c) => [c.x, c.y]))) return { ok: false, reason: "The corners cross over. Tap them in the order shown.", H, Hinv, rms }
  return { ok: true, H, Hinv, rms, flipped: Math.sign(area) !== Math.sign(courtArea) }
}

const signedArea = (pts) => {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}
const convex = (pts) => {
  let sign = 0
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[(i + 1) % pts.length]
    const [cx, cy] = pts[(i + 2) % pts.length]
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
    if (Math.abs(z) < 1e-9) return false
    if (!sign) sign = Math.sign(z)
    else if (Math.sign(z) !== sign) return false
  }
  return true
}

// The court's lines in image space (for drawing the overlay on the video): segments of
// court points through Hinv
export const courtLinesImage = (Hinv) => {
  const L = [
    [[-HALF_W, -HALF_L], [HALF_W, -HALF_L]],
    [[-HALF_W, HALF_L], [HALF_W, HALF_L]],
    [[-HALF_W, -HALF_L], [-HALF_W, HALF_L]],
    [[HALF_W, -HALF_L], [HALF_W, HALF_L]],
    [[-HALF_W, -KITCHEN], [HALF_W, -KITCHEN]],
    [[-HALF_W, KITCHEN], [HALF_W, KITCHEN]],
    [[0, -HALF_L], [0, -KITCHEN]],
    [[0, KITCHEN], [0, HALF_L]],
    [[-NET_POST_X, 0], [NET_POST_X, 0]],
  ]
  return L.map(([a, b]) => [applyH(Hinv, a[0], a[1]), applyH(Hinv, b[0], b[1])]).filter(([a, b]) => a && b)
}
