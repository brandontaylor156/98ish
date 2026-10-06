// Real Ball: finding the ball in the picture. Pure (no DOM): it gets three consecutive frames
// as RGBA pixels (the reader's 640 px copies) and returns the likeliest ball spots in the
// middle one.
//
// The idea is TrackNet/WASB's (three frames in, the ball's spot out) done by hand: on a
// fixed fence camera the ball is a small thing that moves between every frame and is
// yellow-green. Players move too but are big; the court and the stands don't move. So:
//   1. motion: a pixel that changed against BOTH neighbors (three-frame differencing: the
//      ball where it is now, without its ghost where it was),
//   2. color: how ball-like it is (yellow/green/orange, bright, saturated),
//   3. blobs: small connected spots (not a player's shirt), scored by motion x color.
// Many candidates per frame are fine: the flight fit (flight.js) keeps the ones that agree
// with physics. A learned scorer (scorer.js: a tiny CNN, also shipped as ONNX) re-ranks the
// candidates when its weights have loaded.

import { rescore } from "./scorer.js"

// The region worth looking at: the court, and the air above it up to `airM` meters (the ball's
// highest lobs), from the camera (flight.js cameraFromHomography). Returns { x0, y0, x1, y1 }.
export const searchRegion = (cam, W, H, { airM = 5, margin = 0.06 } = {}) => {
  const xs = []
  const ys = []
  for (const x of [-3.6, 3.6]) for (const z of [-7.6, 7.6]) for (const y of [0, airM]) {
    const p = cam.project({ x, y, z })
    if (!p) continue
    xs.push(p[0])
    ys.push(p[1])
  }
  if (!xs.length) return { x0: 0, y0: 0, x1: W, y1: H }
  const mx = W * margin
  return {
    x0: Math.max(0, Math.floor(Math.min(...xs) - mx)),
    y0: Math.max(0, Math.floor(Math.min(...ys) - mx)),
    x1: Math.min(W, Math.ceil(Math.max(...xs) + mx)),
    y1: Math.min(H, Math.ceil(Math.max(...ys) + mx)),
  }
}

// how ball-like a color is, 0..1 (a pickleball: yellow-green, or orange/pink/white-ish under
// harsh light; the court is blue/green/grey, so plain greens score low)
export const ballColor = (r, g, b) => {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  if (mx < 70) return 0
  const sat = (mx - mn) / mx
  const yellow = (Math.min(r, g) - b) / 255 // high when red and green both beat blue
  const bright = mx / 255
  let s = Math.max(0, yellow) * 2.2 + Math.max(0, sat - 0.25) * 0.4 + Math.max(0, bright - 0.75) * 0.8
  // a court-green (g >> r) or a court-blue isn't the ball
  if (g > r * 1.6 && b > r) s *= 0.3
  if (b > r && b > g) s *= 0.2
  return Math.max(0, Math.min(1, s))
}

// prev, cur, next: Uint8ClampedArray RGBA (same W x H). region: searchRegion().
// opts.exclude: [{ x0, y0, x1, y1 }] boxes to downweight (players' bodies).
// Returns [{ u, v, score, area }] best first (at most `max`).
export const detectBall = (prev, cur, next, W, H, region, { max = 6, thresh = 22, minArea = 1, maxArea = 260, exclude = [], step = 1 } = {}) => {
  const { x0, y0, x1, y1 } = region
  const w = Math.max(0, Math.floor((x1 - x0) / step))
  const h = Math.max(0, Math.floor((y1 - y0) / step))
  if (!w || !h) return []
  const score = new Float32Array(w * h)
  const lum = (a, k) => a[k] * 0.299 + a[k + 1] * 0.587 + a[k + 2] * 0.114
  for (let j = 0; j < h; j++) {
    const y = y0 + j * step
    for (let i = 0; i < w; i++) {
      const x = x0 + i * step
      const k = (y * W + x) * 4
      const lc = lum(cur, k)
      const m = Math.min(Math.abs(lc - lum(prev, k)), Math.abs(lc - lum(next, k)))
      // color change too (a yellow ball over a blue court is a big chroma change even when
      // the brightness barely moves)
      const dc = Math.min(
        Math.abs(cur[k] - prev[k]) + Math.abs(cur[k + 2] - prev[k + 2]),
        Math.abs(cur[k] - next[k]) + Math.abs(cur[k + 2] - next[k + 2])
      )
      const motion = Math.max(m, dc * 0.5)
      if (motion < thresh * 0.5) continue
      const c = ballColor(cur[k], cur[k + 1], cur[k + 2])
      score[j * w + i] = motion * (0.25 + c)
    }
  }
  // blobs above the threshold (4-connected), each with its score and size
  const label = new Int32Array(w * h).fill(-1)
  const blobs = []
  const stack = []
  for (let p = 0; p < w * h; p++) {
    if (score[p] < thresh || label[p] >= 0) continue
    const id = blobs.length
    let sum = 0
    let sx = 0
    let sy = 0
    let n = 0
    let peak = 0
    stack.push(p)
    label[p] = id
    while (stack.length) {
      const q = stack.pop()
      const s = score[q]
      const qi = q % w
      const qj = (q - qi) / w
      sum += s
      sx += qi * s
      sy += qj * s
      n++
      if (s > peak) peak = s
      if (n > maxArea * 4) continue // (a player: stop growing, it'll be dropped)
      if (qi > 0 && label[q - 1] < 0 && score[q - 1] >= thresh) (label[q - 1] = id), stack.push(q - 1)
      if (qi < w - 1 && label[q + 1] < 0 && score[q + 1] >= thresh) (label[q + 1] = id), stack.push(q + 1)
      if (qj > 0 && label[q - w] < 0 && score[q - w] >= thresh) (label[q - w] = id), stack.push(q - w)
      if (qj < h - 1 && label[q + w] < 0 && score[q + w] >= thresh) (label[q + w] = id), stack.push(q + w)
    }
    const area = n * step * step
    if (area < minArea || area > maxArea) {
      blobs.push(null)
      continue
    }
    const u = x0 + (sx / sum) * step
    const v = y0 + (sy / sum) * step
    // small and intense beats big and diffuse: the mean score, a little for size
    let sc = (sum / n) * Math.min(1, Math.sqrt(n) / 2) + peak * 0.3
    for (const b of exclude) if (u >= b.x0 && u <= b.x1 && v >= b.y0 && v <= b.y1) sc *= 0.45
    blobs.push({ u, v, score: sc, area })
  }
  return blobs
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
}

// two frames all but identical (a sparse sample of pixels)
export const sameFrame = (a, b) => {
  const n = Math.min(a.length, b.length)
  const stride = Math.max(4, Math.floor(n / 4 / 3000) * 4)
  let d = 0
  let c = 0
  for (let k = 0; k < n; k += stride) {
    d += Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1])
    c++
  }
  return d / Math.max(1, c) < 0.6
}

// A rolling three-frame window: push(t, rgba) -> candidates for the PREVIOUS frame (the one
// that now has both neighbors), or null while it fills.
// scorer: the learned candidate scorer (scorer.js prepare()), optional
export const createBallFinder = ({ W, H, region, exclude = () => [], opts = {}, scorer = null }) => {
  let a = null
  let b = null
  return {
    push(t, rgba) {
      // a repeated frame (a phone that dropped frames, a variable-rate recording) has no
      // motion against its twin: skip it, the next new frame takes its place
      const last = b || a
      if (last && sameFrame(last.px, rgba)) return null
      const frame = { t, px: new Uint8ClampedArray(rgba) }
      if (!a) {
        a = frame
        return null
      }
      if (!b) {
        b = frame
        return null
      }
      let found = detectBall(a.px, b.px, frame.px, W, H, region, { ...opts, exclude: exclude(b.t) })
      if (scorer && found.length) found = rescore(scorer, a.px, b.px, frame.px, W, H, found)
      const out = { t: b.t, cands: found }
      a = b
      b = frame
      return out
    },
  }
}
