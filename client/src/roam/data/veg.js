// Roam: the real vegetation from the aerial (docs/open-world.md "Vegetation"). Pure; Node-tested
// (veg.test.js). The owner: "It looked like a barren wasteland": the map (OpenStreetMap) has few
// trees and little land use, but the USGS NAIP aerial imagery (public domain, 0.6 m, four bands:
// red, green, blue and near-infrared) shows every tree and lawn. tools/roam/add-vegetation.mjs
// samples it per tile (about 1.2 m a pixel) and this module turns the pixels into:
//
// - a ground raster (VEG_N x VEG_N cells, ~8 m): paved/bare, dry (tan: dry grass, dirt, the
//   golden hills), green (irrigated lawn, landscaping, medians), canopy (under trees);
// - the trees: crowns found in the canopy (a distance transform; the biggest crowns first),
//   each with its radius; a crown under ~1.7 m is a shrub.
//
// Green is from NDVI = (NIR - red) / (NIR + red) (plants reflect near-infrared strongly); trees
// from lawn by texture (a crown is lumpy and shaded, a lawn smooth and bright in NIR); dry from
// colour (tan: red over blue). Nothing is placed where the imagery shows no plant.
// Stored per tile as `g: { n, c, t }`: c the raster (2 bits a cell), t the trees (u, v in
// 1/1024 of the tile, radius in 0.5 m steps: 24 bits each), both base64.

export const VEG_N = 64 // raster cells a side
export const VEG = { none: 0, dry: 1, green: 2, canopy: 3 }
export const NDVI_GREEN = 0.15
export const NDVI_TREE = 0.24
export const NDVI_DRY = 0.06
export const MAX_TREES = 560 // a tile
export const SHRUB_R = 2.2 // a crown smaller than this is a shrub
const TREE_TEX = 14 // the NIR's local spread over which green is a crown
const TREE_NIR = 150 // or darker than this in NIR (crowns are shaded; lawns bright)
const TREE_LUM = 92 // a crown from above is darker than this in natural colour

export const ndviOf = (nir, red) => (nir - red) / (nir + red + 1)

// is a crown d metres from a road's line standing on its lanes? A wide two-way road (14 m+) keeps
// the trees on its outer verge (the last 1.5 m: OSM's widths often take in the parkway strip the
// street trees stand in) and in its median (within 1.5 m of the line: the aerial only shows a
// crown there when there is a planted median, Valencia's boulevards; the traffic's lanes start
// 2.6 m out). margin: added to the road's half width.
export const onLanes = (r, d, oneway = false, margin = 0) => {
  if (d >= r.width / 2 + margin) return false
  if (!oneway && r.width >= 14 && (d < 1.5 || d > r.width / 2 - 1.5)) return false
  return true
}

// a young street tree or a grey-green one (elms, olives, ficus kept small): only weakly green in
// NIR at 1.2 m, but dark and green from above and not bright in NIR the way a lawn is. Checked
// against Valencia's Town Center, where these line every street. Only among paving (the hills'
// dark chaparral looks the same from above and is scrub, not trees: classifyImage's urban test)
export const youngTree = (nir, red, r, g, b) => ndviOf(nir, red) > 0.12 && (r + g + b) / 3 < 108 && nir < 165 && g >= r + 5 && g >= b + 5

// one pixel: nir, red, green (0-255), the NIR's local spread, its natural colour (r, g, b), and
// whether it stands among paving (a town's street, not the hills)
export const classifyPixel = (nir, red, green, spread, r = red, g = green, b = green, urban = true) => {
  const v = ndviOf(nir, red)
  if (urban && youngTree(nir, red, r, g, b)) return VEG.canopy
  // (a crown: strongly green and lumpy or shaded; the hills' chaparral is only weakly green and
  // reads as dry scrub, not trees)
  // (from above a crown is dark: its own shade between the leaves; a watered lawn is a light,
  // even green. In natural colour that tells them apart best; the NIR's lumps help in shade)
  if (v > NDVI_TREE) {
    const lum = (r + g + b) / 3
    return lum < TREE_LUM || (spread > TREE_TEX && lum < TREE_LUM + 8) || nir < TREE_NIR - 40 ? VEG.canopy : VEG.green
  }
  if (v > NDVI_GREEN) return spread > TREE_TEX + 4 || nir < TREE_NIR - 20 ? VEG.dry : VEG.green
  if (v > NDVI_DRY) return VEG.dry
  // (no plants: tan ground is dry grass or dirt, grey is paving or a roof)
  return r > g + 8 && r > b + 18 ? VEG.dry : VEG.none
}

// an image: cir (NIR, red, green per pixel, 3 bytes) and rgb (3 bytes), w x h -> Uint8Array of classes
export const classifyImage = ({ cir, rgb = null, w, h }) => {
  const out = new Uint8Array(w * h)
  // (the NIR's spread in a 5 x 5 window, from running sums; it counts only for a pixel on the dark
  // side of it: a crown's shaded lumps, not the bright lawn beside a crown or a kerb)
  const S = new Float64Array((w + 1) * (h + 1))
  const S2 = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let a = 0
    let a2 = 0
    for (let x = 0; x < w; x++) {
      const n = cir[(y * w + x) * 3]
      a += n
      a2 += n * n
      S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + a
      S2[(y + 1) * (w + 1) + x + 1] = S2[y * (w + 1) + x + 1] + a2
    }
  }
  const box = (A, x0, y0, x1, y1) => A[y1 * (w + 1) + x1] - A[y0 * (w + 1) + x1] - A[y1 * (w + 1) + x0] + A[y0 * (w + 1) + x0]
  // (paving round a pixel: grey, no plants; a street tree stands among it, the hills' scrub doesn't)
  const PV = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let a = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const r = rgb ? rgb[i] : cir[i + 1]
      const g = rgb ? rgb[i + 1] : cir[i + 2]
      const b = rgb ? rgb[i + 2] : cir[i + 2]
      if (ndviOf(cir[i], cir[i + 1]) < 0.06 && Math.abs(r - b) < 22 && (r + g + b) / 3 > 60) a++
      PV[(y + 1) * (w + 1) + x + 1] = PV[y * (w + 1) + x + 1] + a
    }
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 2)
      const y0 = Math.max(0, y - 2)
      const x1 = Math.min(w, x + 3)
      const y1 = Math.min(h, y + 3)
      const c = (x1 - x0) * (y1 - y0)
      const m = box(S, x0, y0, x1, y1) / c
      const spread = Math.sqrt(Math.max(0, box(S2, x0, y0, x1, y1) / c - m * m))
      const i = (y * w + x) * 3
      const sp = spread
      const ux0 = Math.max(0, x - 6)
      const uy0 = Math.max(0, y - 6)
      const ux1 = Math.min(w, x + 7)
      const uy1 = Math.min(h, y + 7)
      const urban = box(PV, ux0, uy0, ux1, uy1) / ((ux1 - ux0) * (uy1 - uy0)) >= 0.15
      out[y * w + x] = rgb ? classifyPixel(cir[i], cir[i + 1], cir[i + 2], sp, rgb[i], rgb[i + 1], rgb[i + 2], urban) : classifyPixel(cir[i], cir[i + 1], cir[i + 2], sp, cir[i + 1], cir[i + 2], cir[i + 2], urban)
    }
  // (a crown's sunlit lumps: green with canopy on three sides is canopy too)
  const fill = []
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (out[i] !== VEG.green) continue
      const n = (out[i - 1] === VEG.canopy) + (out[i + 1] === VEG.canopy) + (out[i - w] === VEG.canopy) + (out[i + w] === VEG.canopy)
      if (n >= 3) fill.push(i)
    }
  for (const i of fill) out[i] = VEG.canopy
  return out
}

// the ground raster: classes (w x h) -> Uint8Array VEG_N x VEG_N (a cell is what covers the
// most of it, plants first: a cell a third green is green)
export const vegRaster = (cls, w, h, n = VEG_N) => {
  const out = new Uint8Array(n * n)
  const counts = new Uint32Array(n * n * 4)
  for (let y = 0; y < h; y++) {
    const cy = Math.min(n - 1, Math.floor((y / h) * n))
    for (let x = 0; x < w; x++) counts[(cy * n + Math.min(n - 1, Math.floor((x / w) * n))) * 4 + cls[y * w + x]]++
  }
  for (let i = 0; i < n * n; i++) {
    const c = counts.subarray(i * 4, i * 4 + 4)
    const all = c[0] + c[1] + c[2] + c[3] || 1
    if (c[3] / all > 0.45) out[i] = VEG.canopy
    else if ((c[2] + c[3]) / all > 0.3) out[i] = VEG.green
    else if (c[1] / all > 0.35) out[i] = VEG.dry
    else out[i] = VEG.none
  }
  return out
}

// the crowns in the canopy: classes (w x h), metres a pixel -> [{ x, y (pixels), r (m) }], biggest
// first. A distance transform (chamfer 3-4) says how deep in the canopy each pixel is; the deepest
// pixel not yet under a crown becomes a crown of that depth (capped at 8 m: wider canopy is more
// than one tree), and so on down to shrubs.
export const canopyTrees = (cls, w, h, mpp, { max = MAX_TREES } = {}) => {
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) d[i] = cls[i] === VEG.canopy ? INF : 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!d[i]) continue
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + 3)
      if (y > 0) v = Math.min(v, d[i - w] + 3)
      if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + 4)
      if (x < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + 4)
      if (x === 0 || y === 0) v = Math.min(v, 3)
      d[i] = v
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!d[i]) continue
      let v = d[i]
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3)
      if (y < h - 1) v = Math.min(v, d[i + w] + 3)
      if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + 4)
      if (x > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + 4)
      if (x === w - 1 || y === h - 1) v = Math.min(v, 3)
      d[i] = v
    }
  // candidates: canopy pixels, deepest first
  const idx = []
  for (let i = 0; i < w * h; i++) if (d[i] >= 3) idx.push(i)
  idx.sort((a, b) => d[b] - d[a])
  const taken = new Uint8Array(w * h)
  const out = []
  for (const i of idx) {
    if (taken[i]) continue
    // (depth in pixels -> the crown's radius: the distance to the canopy's edge, a little more)
    // (depth in pixels to the canopy's edge; the edge pixels are part crown)
    const r = Math.min(8, Math.max(0.9, (d[i] / 3 - 0.5) * mpp + 0.6))
    const x = i % w
    const y = (i - x) / w
    out.push({ x: x + 0.5, y: y + 0.5, r })
    if (out.length >= max) break
    // (no other crown's middle under this one)
    const rp = Math.ceil(r / mpp + 0.5)
    for (let yy = Math.max(0, y - rp); yy <= Math.min(h - 1, y + rp); yy++)
      for (let xx = Math.max(0, x - rp); xx <= Math.min(w - 1, x + rp); xx++) if ((xx - x) ** 2 + (yy - y) ** 2 <= rp * rp) taken[yy * w + xx] = 1
  }
  // (a lone pixel or two of canopy is noise: under 0.9 m is dropped; shrubs at most a third)
  const big = out.filter((t) => t.r >= SHRUB_R)
  const small = out.filter((t) => t.r >= 0.9 && t.r < SHRUB_R).slice(0, Math.max(40, Math.round(big.length / 2)))
  return [...big, ...small].slice(0, max)
}

// ---- base64 (the same in Node and the browser) ----
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const LOOK = new Int16Array(128).fill(-1)
for (let i = 0; i < 64; i++) LOOK[B64.charCodeAt(i)] = i
export const toB64 = (bytes) => {
  let s = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    const n = (a << 16) | (b << 8) | c
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=")
  }
  return s
}
export const fromB64 = (s) => {
  const clean = String(s || "").replace(/=+$/, "")
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < clean.length ? LOOK[clean.charCodeAt(i + k) & 127] : 0))
    if (v.some((q) => q < 0)) return new Uint8Array(0)
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3]
    if (o < out.length) out[o++] = (n >> 16) & 255
    if (o < out.length) out[o++] = (n >> 8) & 255
    if (o < out.length) out[o++] = n & 255
  }
  return out
}

// a tile's vegetation -> the tile's `g`. raster: Uint8Array n x n; trees: [{ u, v (0..1 of the
// tile), r (m) }]
export const encodeVeg = ({ raster, n = VEG_N, trees = [] }) => {
  const c = new Uint8Array(Math.ceil((n * n) / 4))
  for (let i = 0; i < n * n; i++) c[i >> 2] |= (raster[i] & 3) << ((i & 3) * 2)
  const t = new Uint8Array(trees.length * 3)
  trees.forEach((q, k) => {
    const u = Math.max(0, Math.min(1023, Math.round(q.u * 1024)))
    const v = Math.max(0, Math.min(1023, Math.round(q.v * 1024)))
    const r = Math.max(0, Math.min(15, Math.round((q.r - 0.75) / 0.5)))
    const bits = (u << 14) | (v << 4) | r
    t[k * 3] = (bits >> 16) & 255
    t[k * 3 + 1] = (bits >> 8) & 255
    t[k * 3 + 2] = bits & 255
  })
  // (or as runs, when that's shorter: a hillside or a car park is one class for many cells.
  // A run is a byte: the class in the top two bits, the length - 1 in the low six)
  const runs = []
  for (let i = 0; i < n * n; ) {
    let j = i + 1
    while (j < n * n && j - i < 64 && raster[j] === raster[i]) j++
    runs.push(((raster[i] & 3) << 6) | (j - i - 1))
    i = j
  }
  if (runs.length < c.length) return { n, r: toB64(new Uint8Array(runs)), t: toB64(t) }
  return { n, c: toB64(c), t: toB64(t) }
}
// the tile's `g` -> { n, raster: Uint8Array, trees: [{ u, v, r }] } | null
export const decodeVeg = (g) => {
  if (!g || !g.n || (typeof g.c !== "string" && typeof g.r !== "string")) return null
  const n = g.n
  const raster = new Uint8Array(n * n)
  if (typeof g.r === "string") {
    let i = 0
    for (const b of fromB64(g.r)) for (let k = 0; k <= (b & 63) && i < n * n; k++) raster[i++] = b >> 6
  } else {
    const c = fromB64(g.c)
    for (let i = 0; i < n * n; i++) raster[i] = ((c[i >> 2] || 0) >> ((i & 3) * 2)) & 3
  }
  const t = fromB64(g.t || "")
  const trees = []
  for (let k = 0; k + 2 < t.length; k += 3) {
    const bits = (t[k] << 16) | (t[k + 1] << 8) | t[k + 2]
    trees.push({ u: ((bits >> 14) & 1023) / 1024, v: ((bits >> 4) & 1023) / 1024, r: 0.75 + (bits & 15) * 0.5 })
  }
  return { n, raster, trees }
}
// what the raster says at a tile-relative point (u, v in 0..1)
export const vegAt = (veg, u, v) => {
  if (!veg) return VEG.none
  const n = veg.n
  const i = Math.max(0, Math.min(n - 1, Math.floor(v * n))) * n + Math.max(0, Math.min(n - 1, Math.floor(u * n)))
  return veg.raster[i]
}
