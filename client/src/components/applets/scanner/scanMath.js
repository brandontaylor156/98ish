// Scanner 98's math, pure (scanMath.test.js): finding a page's four corners in a photo,
// straightening it (a perspective warp through a homography), and the three looks (Color,
// Grayscale, Black & white document). Everything works on plain typed arrays so Node can
// test it with made-up pages; Scanner.jsx feeds it canvas pixels. All on the device.

// ---- corners ----
// A corner is { x, y } in the photo's pixels. Four corners are always in the order
// top-left, top-right, bottom-right, bottom-left (orderCorners puts any four in that order).

export const DETECT_SIDE = 256 // the photo is shrunk to this (longest side) to look for the page

// luminance of RGBA pixels -> a Uint8Array (one byte per pixel)
export const toGray = (rgba, w, h) => {
  const out = new Uint8Array(w * h)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8
  return out
}

// a 3x3 box blur (twice is close to a small Gaussian): text and paper grain stop mattering
export const blur3 = (gray, w, h) => {
  const out = new Uint8Array(gray.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          sum += gray[yy * w + xx]
          n++
        }
      }
      out[y * w + x] = Math.round(sum / n)
    }
  }
  return out
}

// Otsu's threshold: the gray level that best splits the picture into two groups
export const otsu = (gray) => {
  const hist = new Array(256).fill(0)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const total = gray.length
  let sumAll = 0
  for (let t = 0; t < 256; t++) sumAll += t * hist[t]
  let sumB = 0
  let wB = 0
  let best = 0
  let bestT = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      bestT = t
    }
  }
  return bestT
}

// The biggest group of touching pixels where mask is 1 -> { size, pixels: Int32Array of indexes }
export const largestComponent = (mask, w, h) => {
  const label = new Int32Array(w * h)
  const stack = new Int32Array(w * h)
  let best = { size: 0, id: 0 }
  let id = 0
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue
    id++
    let top = 0
    let size = 0
    stack[top++] = start
    label[start] = id
    while (top) {
      const i = stack[--top]
      size++
      const x = i % w
      if (x > 0 && mask[i - 1] && !label[i - 1]) (label[i - 1] = id), (stack[top++] = i - 1)
      if (x < w - 1 && mask[i + 1] && !label[i + 1]) (label[i + 1] = id), (stack[top++] = i + 1)
      if (i >= w && mask[i - w] && !label[i - w]) (label[i - w] = id), (stack[top++] = i - w)
      if (i < w * (h - 1) && mask[i + w] && !label[i + w]) (label[i + w] = id), (stack[top++] = i + w)
    }
    if (size > best.size) best = { size, id }
  }
  const pixels = new Int32Array(best.size)
  if (best.size) for (let i = 0, n = 0; i < label.length; i++) if (label[i] === best.id) pixels[n++] = i
  return { size: best.size, pixels, label, id: best.id }
}

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

// convex hull (Andrew's monotone chain), counter-clockwise in screen terms, no repeats
export const convexHull = (points) => {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length < 3) return pts
  const lower = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

export const polygonArea = (pts) => {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}

const triArea = (a, b, c) => Math.abs(cross(a, b, c)) / 2

// The four hull points that enclose the most area (a page's corners are the hull's "pointiest"
// places). O(n^3) on at most ~64 points.
export const maxAreaQuad = (hull) => {
  let pts = hull
  if (pts.length > 64) {
    const step = pts.length / 64
    pts = Array.from({ length: 64 }, (_, i) => hull[Math.floor(i * step)])
  }
  const n = pts.length
  if (n < 4) return null
  let best = null
  let bestArea = -1
  for (let i = 0; i < n; i++) {
    for (let k = i + 2; k < n; k++) {
      if (i === 0 && k === n - 1) continue
      let j = -1
      let aj = -1
      for (let m = i + 1; m < k; m++) {
        const a = triArea(pts[i], pts[m], pts[k])
        if (a > aj) (aj = a), (j = m)
      }
      let l = -1
      let al = -1
      for (let m = k + 1; m < n + i; m++) {
        const idx = m % n
        const a = triArea(pts[k], pts[idx], pts[i])
        if (a > al) (al = a), (l = idx)
      }
      if (j < 0 || l < 0) continue
      if (aj + al > bestArea) {
        bestArea = aj + al
        best = [pts[i], pts[j], pts[k], pts[l]]
      }
    }
  }
  return best
}

// Any four corners -> top-left, top-right, bottom-right, bottom-left
export const orderCorners = (pts) => {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  // clockwise on screen (y down) starting from the one most up-and-left
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let start = 0
  for (let i = 1; i < sorted.length; i++) if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i
  return [0, 1, 2, 3].map((i) => ({ x: sorted[(start + i) % 4].x, y: sorted[(start + i) % 4].y }))
}

// corners a little inside the photo's edges (when no page was found)
export const defaultCorners = (w, h, inset = 0.06) => [
  { x: w * inset, y: h * inset },
  { x: w * (1 - inset), y: h * inset },
  { x: w * (1 - inset), y: h * (1 - inset) },
  { x: w * inset, y: h * (1 - inset) },
]

// Is it a sensible page outline? Convex, big enough, every corner a real corner
export const plausibleQuad = (q, w, h, { minShare = 0.12 } = {}) => {
  if (!q || q.length !== 4) return false
  const area = polygonArea(q)
  if (area < w * h * minShare) return false
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const c = cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4])
    if (Math.abs(c) < 1e-9) return false
    const s = Math.sign(c)
    if (sign && s !== sign) return false
    sign = s
  }
  // no angle sharper than ~35 degrees (a sliver isn't a page)
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4]
    const b = q[i]
    const c = q[(i + 1) % 4]
    const v1 = { x: a.x - b.x, y: a.y - b.y }
    const v2 = { x: c.x - b.x, y: c.y - b.y }
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1)
    if (cos > Math.cos((35 * Math.PI) / 180)) return false
  }
  return true
}

// Find the page in a (small) gray picture -> { found, corners } in that picture's pixels.
// A page is usually brighter than what it lies on: split bright from dark (Otsu), take the
// biggest bright patch, its outline's convex hull, and the four hull points with the most
// area between them. Not found (white page on a white table, nothing page-like): corners
// just inside the edges, for dragging into place.
export const detectCorners = (gray, w, h) => {
  const smooth = blur3(blur3(gray, w, h), w, h)
  const t = otsu(smooth)
  // the two groups must really differ (a plain wall has nothing to find)
  let lo = 0
  let nlo = 0
  let hi = 0
  let nhi = 0
  for (let i = 0; i < smooth.length; i++) {
    if (smooth[i] > t) (hi += smooth[i]), nhi++
    else (lo += smooth[i]), nlo++
  }
  const contrast = nhi && nlo ? hi / nhi - lo / nlo : 0
  const fallback = { found: false, corners: defaultCorners(w, h) }
  if (contrast < 25) return fallback
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < mask.length; i++) mask[i] = smooth[i] > t ? 1 : 0
  const comp = largestComponent(mask, w, h)
  if (comp.size < w * h * 0.08) return fallback
  // the patch's outline: its pixels with a neighbor outside it (or on the photo's edge)
  const outline = []
  const { label, id } = comp
  for (const i of comp.pixels) {
    const x = i % w
    const y = (i - x) / w
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || label[i - 1] !== id || label[i + 1] !== id || label[i - w] !== id || label[i + w] !== id) outline.push({ x: x + 0.5, y: y + 0.5 })
  }
  const hull = convexHull(outline)
  const quad = maxAreaQuad(hull)
  if (!quad) return fallback
  const corners = orderCorners(quad)
  // a patch that fills the whole picture is the background, not a page
  if (polygonArea(corners) > w * h * 0.97 || !plausibleQuad(corners, w, h)) return fallback
  return { found: true, corners: corners.map((p) => ({ x: Math.min(w, Math.max(0, p.x)), y: Math.min(h, Math.max(0, p.y)) })) }
}

// corners in one picture's pixels -> another size's
export const scaleCorners = (corners, sx, sy = sx) => corners.map((p) => ({ x: p.x * sx, y: p.y * sy }))

// a dragged corner stays inside the photo
export const clampCorner = (p, w, h) => ({ x: Math.min(w, Math.max(0, p.x)), y: Math.min(h, Math.max(0, p.y)) })

// the photo turned a quarter turn clockwise: where the corners go (and their order)
export const rotateCornersCW = (corners, w, h) => {
  // (x, y) in a w x h photo -> (h - y, x) in the h x w photo; the old bottom-left is the new top-left
  const turned = corners.map((p) => ({ x: h - p.y, y: p.x }))
  return [turned[3], turned[0], turned[1], turned[2]]
}

// ---- straightening ----

// Solve A x = b (8x8) by Gaussian elimination with partial pivoting
const solve = (A, b) => {
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

// The homography that sends four points `from` to four points `to` -> [h0..h8] (h8 = 1)
export const homography = (from, to) => {
  const A = []
  const b = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]
    const { x: u, y: v } = to[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }
  const h = solve(A, b)
  return h ? [...h, 1] : null
}

export const applyH = (H, x, y) => {
  const d = H[6] * x + H[7] * y + H[8]
  return { x: (H[0] * x + H[1] * y + H[2]) / d, y: (H[3] * x + H[4] * y + H[5]) / d }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// Paper shapes a page is snapped to when it's close (height / width): Letter, A4, Legal
export const PAPER_RATIOS = [
  { id: "letter", ratio: 11 / 8.5 },
  { id: "a4", ratio: 297 / 210 },
  { id: "legal", ratio: 14 / 8.5 },
]

// How big the straightened page should be: the longer of each pair of opposite sides (snapped
// to a paper shape within 6%), then made to fit `maxSide` -> { w, h, paper }
export const outputSize = (corners, { maxSide = 2000, snap = true } = {}) => {
  const [tl, tr, br, bl] = corners
  let w = Math.max(dist(tl, tr), dist(bl, br))
  let h = Math.max(dist(tl, bl), dist(tr, br))
  if (w < 1 || h < 1) return { w: 1, h: 1, paper: null }
  let paper = null
  if (snap) {
    const portrait = h >= w
    const r = portrait ? h / w : w / h
    for (const p of PAPER_RATIOS) {
      if (Math.abs(r - p.ratio) / p.ratio <= 0.06) {
        paper = p.id
        if (portrait) h = w * p.ratio
        else w = h * p.ratio
        break
      }
    }
  }
  const scale = Math.min(1, maxSide / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)), paper }
}

// Straighten: every pixel of an outW x outH picture is read from the photo through the
// homography (bilinear) -> RGBA Uint8ClampedArray
export const warpPerspective = (src, sw, sh, corners, outW, outH) => {
  const out = new Uint8ClampedArray(outW * outH * 4)
  const H = homography(
    [
      { x: 0, y: 0 },
      { x: outW, y: 0 },
      { x: outW, y: outH },
      { x: 0, y: outH },
    ],
    corners
  )
  if (!H) return out.fill(255)
  for (let v = 0; v < outH; v++) {
    const yv = v + 0.5
    for (let u = 0; u < outW; u++) {
      const xu = u + 0.5
      const d = H[6] * xu + H[7] * yv + H[8]
      let x = (H[0] * xu + H[1] * yv + H[2]) / d - 0.5
      let y = (H[3] * xu + H[4] * yv + H[5]) / d - 0.5
      if (x < 0) x = 0
      if (y < 0) y = 0
      if (x > sw - 1) x = sw - 1
      if (y > sh - 1) y = sh - 1
      const x0 = x | 0
      const y0 = y | 0
      const x1 = x0 < sw - 1 ? x0 + 1 : x0
      const y1 = y0 < sh - 1 ? y0 + 1 : y0
      const fx = x - x0
      const fy = y - y0
      const p00 = (y0 * sw + x0) * 4
      const p10 = (y0 * sw + x1) * 4
      const p01 = (y1 * sw + x0) * 4
      const p11 = (y1 * sw + x1) * 4
      const o = (v * outW + u) * 4
      for (let c = 0; c < 3; c++) {
        const top = src[p00 + c] + (src[p10 + c] - src[p00 + c]) * fx
        const bottom = src[p01 + c] + (src[p11 + c] - src[p01 + c]) * fx
        out[o + c] = top + (bottom - top) * fy
      }
      out[o + 3] = 255
    }
  }
  return out
}

// ---- the looks ----

export const FILTERS = [
  { id: "color", label: "Color" },
  { id: "gray", label: "Grayscale" },
  { id: "bw", label: "Black & white" },
]

// the gray levels below which `lowShare` and above which `highShare` of the pixels lie
export const levels = (gray, lowShare = 0.01, highShare = 0.99) => {
  const hist = new Array(256).fill(0)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const lowN = gray.length * lowShare
  const highN = gray.length * highShare
  let lo = 0
  let hi = 255
  let seen = 0
  let gotLo = false
  for (let t = 0; t < 256; t++) {
    seen += hist[t]
    if (!gotLo && seen > lowN) (lo = t), (gotLo = true)
    if (seen >= highN) {
      hi = t
      break
    }
  }
  return { lo, hi: Math.max(hi, lo + 1) }
}

// Color and Grayscale: the darkest 1% go black, the brightest few percent go white (paper
// that looked gray in the room comes out white)
const stretchTable = (lo, hi) => {
  const table = new Uint8ClampedArray(256)
  for (let t = 0; t < 256; t++) table[t] = ((t - lo) * 255) / (hi - lo)
  return table
}

// Black & white document: each pixel is compared with the average around it (an integral
// image makes that one pass), so shadows and uneven light don't turn into black patches
export const adaptiveThreshold = (gray, w, h, { radius = Math.max(6, Math.round(Math.max(w, h) / 50)), offset = 12 } = {}) => {
  const W = w + 1
  const sums = new Float64Array(W * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x]
      sums[(y + 1) * W + (x + 1)] = sums[y * W + (x + 1)] + row
    }
  }
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(h, y + radius + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(w, x + radius + 1)
      const area = (y1 - y0) * (x1 - x0)
      const sum = sums[y1 * W + x1] - sums[y0 * W + x1] - sums[y1 * W + x0] + sums[y0 * W + x0]
      out[y * w + x] = gray[y * w + x] < sum / area - offset ? 0 : 255
    }
  }
  return out
}

// Apply a look to straightened RGBA pixels, in place -> the same array
export const applyFilter = (rgba, w, h, filter = "color") => {
  const gray = toGray(rgba, w, h)
  if (filter === "bw") {
    const bw = adaptiveThreshold(gray, w, h)
    for (let i = 0, p = 0; i < bw.length; i++, p += 4) rgba[p] = rgba[p + 1] = rgba[p + 2] = bw[i]
    return rgba
  }
  const { lo, hi } = levels(gray, 0.01, 0.97)
  const table = stretchTable(lo, hi)
  if (filter === "gray") {
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) rgba[p] = rgba[p + 1] = rgba[p + 2] = table[gray[i]]
    return rgba
  }
  for (let p = 0; p < rgba.length; p += 4) {
    rgba[p] = table[rgba[p]]
    rgba[p + 1] = table[rgba[p + 1]]
    rgba[p + 2] = table[rgba[p + 2]]
  }
  return rgba
}

// ---- names and limits ----

export const MAX_PAGES = 30 // pages in one scan (each photo is kept in memory until saved)
export const PHOTO_SIDE = 2400 // a photo is kept at most this big (longest side)
export const PAGE_SIDE = 2000 // a straightened page, longest side

const two = (n) => String(n).padStart(2, "0")
// "Scan 2026-10-08 at 14.32.05"
export const scanName = (d = new Date()) => `Scan ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} at ${two(d.getHours())}.${two(d.getMinutes())}.${two(d.getSeconds())}`

// the pages' order after moving page `from` by `delta` (-1 left, +1 right)
export const movePage = (list, from, delta) => {
  const to = from + delta
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

// fit a w x h picture inside a box -> { w, h, scale }
export const fitInside = (w, h, boxW, boxH) => {
  const scale = Math.min(boxW / w, boxH / h)
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)), scale }
}
