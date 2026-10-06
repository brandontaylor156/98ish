// Twin Replay: where to look. From a fence camera the far players are small (a 640 px frame
// gives them ~35 px: too few for the pose model), so the far half of the court is read
// separately from a sharper copy of the frame, cropped and enlarged. Both regions come from
// the calibration: the court's far half projected into the picture, raised by a player's
// height (meters per pixel measured along the far baseline).

import { applyH, HALF_L, HALF_W } from "./homography.js"

// Hinv: court -> image (in the analysis frame's pixels, W x H). Returns { far: { x, y, w, h } | null }
// (null when the far players are already big enough to read in the whole frame)
export const farRegion = (Hinv, W, H, { minPxPerM = 26, height = 2.3 } = {}) => {
  const pts = []
  for (const [x, z] of [
    [-HALF_W - 1.6, -HALF_L - 2.6],
    [HALF_W + 1.6, -HALF_L - 2.6],
    [HALF_W + 1.6, 0.8],
    [-HALF_W - 1.6, 0.8],
  ]) {
    const p = applyH(Hinv, x, z)
    if (!p) return null
    pts.push(p)
  }
  const a = applyH(Hinv, -HALF_W, -HALF_L)
  const b = applyH(Hinv, HALF_W, -HALF_L)
  if (!a || !b) return null
  const pxPerM = Math.hypot(b[0] - a[0], b[1] - a[1]) / (2 * HALF_W)
  if (pxPerM >= minPxPerM) return null
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const top = Math.min(...ys) - height * pxPerM
  const bottom = Math.max(...ys) + 0.3 * pxPerM
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const x = Math.max(0, Math.floor(left))
  const y = Math.max(0, Math.floor(top))
  const w = Math.min(W, Math.ceil(right)) - x
  const h = Math.min(H, Math.ceil(bottom)) - y
  if (w < 16 || h < 16) return null
  return { x, y, w, h, pxPerM }
}

// the whole court and its surrounds (where players can be), raised by a player's height at the
// far end: people outside it (spectators in the stands, the next court) aren't read at all.
// Returns { x, y, w, h } in frame pixels (the whole frame if the court can't be projected)
export const courtRegion = (Hinv, W, H, { side = 1.8, end = 2.8, height = 2.3 } = {}) => {
  const pts = []
  for (const [x, z] of [
    [-HALF_W - side, -HALF_L - end],
    [HALF_W + side, -HALF_L - end],
    [HALF_W + side, HALF_L + end],
    [-HALF_W - side, HALF_L + end],
  ]) {
    const p = applyH(Hinv, x, z)
    // (a corner behind the camera: no crop)
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return { x: 0, y: 0, w: W, h: H }
    pts.push(p)
  }
  const a = applyH(Hinv, -HALF_W, -HALF_L)
  const b = applyH(Hinv, HALF_W, -HALF_L)
  const pxPerM = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) / (2 * HALF_W) : 20
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const x = Math.max(0, Math.floor(Math.min(...xs)))
  const y = Math.max(0, Math.floor(Math.min(...ys) - height * pxPerM))
  const r = Math.min(W, Math.ceil(Math.max(...xs)))
  const btm = Math.min(H, Math.ceil(Math.max(...ys)))
  if (r - x < 32 || btm - y < 32) return { x: 0, y: 0, w: W, h: H }
  return { x, y, w: r - x, h: btm - y }
}

// pixels per meter of ground across the picture at court point (x, z)
export const scaleAt = (Hinv, x, z) => {
  const a = applyH(Hinv, x - 0.5, z)
  const b = applyH(Hinv, x + 0.5, z)
  return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0
}

// a square crop round a player standing at court (x, z): their whole body with room for a
// lunge, in frame pixels (clamped to the frame); null if they're off the picture
export const playerBox = (Hinv, x, z, W, H, { tall = 1.9, room = 1.55 } = {}) => {
  const f = applyH(Hinv, x, z)
  const k = scaleAt(Hinv, x, z)
  if (!f || !k) return null
  const side = Math.max(40, tall * k * room)
  const cx = f[0]
  const cy = f[1] - tall * k * 0.48
  let bx = Math.round(cx - side / 2)
  let by = Math.round(cy - side / 2)
  const s = Math.round(side)
  if (bx + s < 0 || by + s < 0 || bx > W || by > H) return null
  bx = Math.max(-s / 2, Math.min(W - s / 2, bx))
  by = Math.max(-s / 2, Math.min(H - s / 2, by))
  return { x: bx, y: by, w: s, h: s }
}

// square tiles over the court for finding players, sized so a player there is about a third of
// a tile's height (the model's comfortable size): a row across the far half (small tiles) and
// one across the near half (big tiles), overlapping by 30%
export const scanTiles = (court, Hinv, W, H) => {
  const tiles = []
  for (const z of [-HALF_L * 0.55, HALF_L * 0.55]) {
    const k = scaleAt(Hinv, 0, z)
    const foot = applyH(Hinv, 0, z)
    if (!k || !foot) continue
    const s = Math.round(Math.max(48, Math.min(Math.max(W, H), 3.2 * 1.9 * k)))
    const y = Math.round(Math.max(0, Math.min(H - s, foot[1] - s * 0.62)))
    const n = Math.max(1, Math.ceil((court.w - s) / (0.7 * s)) + 1)
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? court.x + (court.w - s) / 2 : court.x + ((court.w - s) * i) / (n - 1)
      tiles.push({ x: Math.round(x), y, w: s, h: s })
    }
  }
  return tiles
}

// people found in a crop -> the analysis frame's pixels. crop: { x, y, w, h } in frame pixels;
// the model saw it as cw x ch pixels
export const fromCrop = (people, crop, cw, ch) =>
  people.map((p) => ({
    ...p,
    lm: p.lm.map((q) => ({ x: crop.x + (q.x / cw) * crop.w, y: crop.y + (q.y / ch) * crop.h, v: q.v })),
  }))

// the same person seen in both regions (near the net): keep the better view. footAt(person)
// -> court [x, z] or null
export const mergePeople = (a, b, footAt, near = 0.6) => {
  const out = [...a]
  for (const p of b) {
    const fp = footAt(p)
    const dup = fp && out.findIndex((q) => {
      const fq = footAt(q)
      return fq && Math.hypot(fq[0] - fp[0], fq[1] - fp[1]) < near
    })
    if (dup >= 0 && dup !== false) {
      const vis = (x) => x.lm.reduce((s, q) => s + (q.v || 0), 0)
      if (vis(p) > vis(out[dup])) out[dup] = p
    } else out.push(p)
  }
  return out
}
