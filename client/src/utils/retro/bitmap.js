// An indexed framebuffer, like a VGA mode 13h screen: one byte per pixel, each a palette index
// (palette.js). Pure (no DOM), so Node renders the same pictures for tests and previews.
// Everything clips to the bitmap and to its clip rectangle (setClip).
//
//   const b = createBitmap(200, 150)
//   rect(b, 0, 0, 200, 20, sky); disc(b, 50, 50, 12, red); blit(b, sprite, x, y)
//   present(b, imageDataU32, pal.lut)   (the browser side: utils/retro/screen.js)

import { rampAt, threshold } from "./dither.js"

export const createBitmap = (w, h) => ({ w, h, data: new Uint8Array(w * h), cx0: 0, cy0: 0, cx1: w, cy1: h })

export const setClip = (b, x, y, w, h) => {
  b.cx0 = Math.max(0, Math.floor(x))
  b.cy0 = Math.max(0, Math.floor(y))
  b.cx1 = Math.min(b.w, Math.floor(x + w))
  b.cy1 = Math.min(b.h, Math.floor(y + h))
}
export const resetClip = (b) => {
  b.cx0 = 0
  b.cy0 = 0
  b.cx1 = b.w
  b.cy1 = b.h
}

export const clear = (b, c = 0) => b.data.fill(c)

export const pset = (b, x, y, c) => {
  x = Math.floor(x)
  y = Math.floor(y)
  if (x >= b.cx0 && y >= b.cy0 && x < b.cx1 && y < b.cy1) b.data[y * b.w + x] = c
}
export const pget = (b, x, y) => (x >= 0 && y >= 0 && x < b.w && y < b.h ? b.data[(y | 0) * b.w + (x | 0)] : 0)

export const rect = (b, x, y, w, h, c) => {
  const x0 = Math.max(b.cx0, Math.floor(x))
  const y0 = Math.max(b.cy0, Math.floor(y))
  const x1 = Math.min(b.cx1, Math.floor(x + w))
  const y1 = Math.min(b.cy1, Math.floor(y + h))
  if (x1 <= x0) return
  for (let yy = y0; yy < y1; yy++) b.data.fill(c, yy * b.w + x0, yy * b.w + x1)
}
export const hline = (b, x, y, w, c) => rect(b, x, y, w, 1, c)
export const vline = (b, x, y, h, c) => rect(b, x, y, 1, h, c)
// a 1-pixel outline
export const frame = (b, x, y, w, h, c) => {
  hline(b, x, y, w, c)
  hline(b, x, y + h - 1, w, c)
  vline(b, x, y, h, c)
  vline(b, x + w - 1, y, h, c)
}

// Bresenham; thick > 1 draws a square brush
export const line = (b, x0, y0, x1, y1, c, thick = 1) => {
  x0 = Math.round(x0)
  y0 = Math.round(y0)
  x1 = Math.round(x1)
  y1 = Math.round(y1)
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  const off = Math.floor((thick - 1) / 2)
  for (;;) {
    if (thick > 1) rect(b, x0 - off, y0 - off, thick, thick, c)
    else pset(b, x0, y0, c)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
}

// a filled ellipse (rx, ry may be fractional: a radius of 4.5 gives an even 9-pixel disc)
export const ellipse = (b, cx, cy, rx, ry, c) => {
  if (rx <= 0 || ry <= 0) return
  const y0 = Math.floor(cy - ry)
  const y1 = Math.ceil(cy + ry)
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry
    if (dy < -1 || dy > 1) continue
    const half = rx * Math.sqrt(1 - dy * dy)
    const xa = Math.round(cx - half)
    const xb = Math.round(cx + half)
    if (xb > xa) rect(b, xa, y, xb - xa, 1, c)
  }
}
export const disc = (b, cx, cy, r, c) => ellipse(b, cx, cy, r, r, c)

// a 1-pixel ellipse outline (the boundary pixels of the filled shape)
export const ellipseOutline = (b, cx, cy, rx, ry, c) => {
  const inside = (x, y) => {
    const dx = (x + 0.5 - cx) / rx
    const dy = (y + 0.5 - cy) / ry
    return dx * dx + dy * dy <= 1
  }
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx); x++) {
      if (inside(x, y) && (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1))) pset(b, x, y, c)
    }
  }
}

// a filled polygon (even-odd scanlines), points [[x, y]...]
export const polygon = (b, pts, c) => {
  if (pts.length < 3) return
  let minY = Infinity
  let maxY = -Infinity
  for (const [, y] of pts) {
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const xs = []
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const sy = y + 0.5
    xs.length = 0
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i]
      const [bx, by] = pts[(i + 1) % pts.length]
      if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax))
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.round(xs[k])
      const xb = Math.round(xs[k + 1])
      if (xb > xa) rect(b, xa, y, xb - xa, 1, c)
    }
  }
}

// per-pixel painting over a box: fn(x, y) returns an index, or -1 to leave the pixel
export const paint = (b, x, y, w, h, fn) => {
  const x0 = Math.max(b.cx0, Math.floor(x))
  const y0 = Math.max(b.cy0, Math.floor(y))
  const x1 = Math.min(b.cx1, Math.floor(x + w))
  const y1 = Math.min(b.cy1, Math.floor(y + h))
  for (let yy = y0; yy < y1; yy++) {
    const row = yy * b.w
    for (let xx = x0; xx < x1; xx++) {
      const c = fn(xx, yy)
      if (c >= 0) b.data[row + xx] = c
    }
  }
}

// a vertical gradient over a ramp, ordered-dithered (no smooth blends in a 256-colour world)
export const gradientV = (b, x, y, w, h, ramp, { from = 0, to = 1, size = 4 } = {}) =>
  paint(b, x, y, w, h, (px, py) => rampAt(ramp, from + ((to - from) * (py - y + 0.5)) / h, px, py, size))

// a 50% (or any level) mix of two colours over a box
export const ditherRect = (b, x, y, w, h, a, c, level = 0.5, size = 4) => paint(b, x, y, w, h, (px, py) => (level > threshold(px, py, size) ? c : a))

// a shaded ball: Lambert light from the top left, dithered across the ramp (dark -> light),
// an optional 1-pixel outline and a specular glint
export const shadeDisc = (b, cx, cy, r, ramp, { outline = -1, glint = -1, light = [-0.55, -0.65, 0.52], ambient = 0.18, rim = 0 } = {}) => {
  const [lx, ly, lz] = light
  const ll = Math.hypot(lx, ly, lz)
  paint(b, cx - r - 1, cy - r - 1, r * 2 + 3, r * 2 + 3, (x, y) => {
    const nx = (x + 0.5 - cx) / r
    const ny = (y + 0.5 - cy) / r
    const d2 = nx * nx + ny * ny
    if (d2 > 1) return -1
    if (outline >= 0) {
      const edge = (r - 1) / r
      if (d2 > edge * edge) return outline
    }
    const nz = Math.sqrt(1 - d2)
    let t = Math.max(0, (nx * lx + ny * ly + nz * lz) / ll)
    t = ambient + (1 - ambient) * t + rim * Math.pow(1 - nz, 3)
    if (glint >= 0) {
      const spec = Math.pow(Math.max(0, (nx * lx + ny * ly + nz * lz) / ll), 18)
      if (spec > 0.55) return glint
    }
    return rampAt(ramp, t, x, y)
  })
}

// copy a sprite ({ w, h, data }) onto the bitmap; index 0 in the sprite is see-through.
// opts: flipX, flipY, map (a 256-entry remap table), only (draw every pixel in this colour),
// mask(x, y) -> false skips a pixel (screen-door transparency), sx/sy integer-free scale
export const blit = (b, s, x, y, opts = {}) => {
  const { flipX = false, flipY = false, map = null, only = -1, mask = null, scaleX = 1, scaleY = 1 } = opts
  x = Math.round(x)
  y = Math.round(y)
  const dw = Math.max(1, Math.round(s.w * scaleX))
  const dh = Math.max(1, Math.round(s.h * scaleY))
  const x0 = Math.max(b.cx0, x)
  const y0 = Math.max(b.cy0, y)
  const x1 = Math.min(b.cx1, x + dw)
  const y1 = Math.min(b.cy1, y + dh)
  for (let yy = y0; yy < y1; yy++) {
    let sy = Math.floor(((yy - y) * s.h) / dh)
    if (flipY) sy = s.h - 1 - sy
    const row = yy * b.w
    for (let xx = x0; xx < x1; xx++) {
      let sx = Math.floor(((xx - x) * s.w) / dw)
      if (flipX) sx = s.w - 1 - sx
      const c = s.data[sy * s.w + sx]
      if (!c) continue
      if (mask && !mask(xx, yy)) continue
      b.data[row + xx] = only >= 0 ? only : map ? map[c] : c
    }
  }
}

// send every pixel of a box through a remap table (a tint, a shadow, a frozen field)
export const remapRect = (b, x, y, w, h, table) => {
  const x0 = Math.max(b.cx0, Math.floor(x))
  const y0 = Math.max(b.cy0, Math.floor(y))
  const x1 = Math.min(b.cx1, Math.floor(x + w))
  const y1 = Math.min(b.cy1, Math.floor(y + h))
  for (let yy = y0; yy < y1; yy++) {
    const row = yy * b.w
    for (let xx = x0; xx < x1; xx++) b.data[row + xx] = table[b.data[row + xx]]
  }
}
// a remap through a mask: only pixels where mask(x, y) is true (a dithered shadow)
export const remapWhere = (b, x, y, w, h, table, mask) => {
  paint(b, x, y, w, h, (px, py) => (mask(px, py) ? table[b.data[py * b.w + px]] : -1))
}

// a Windows 98 bevel: c = { face, white, light, shadow, black } (palette indices)
//   raised: white / light on the top-left, shadow / black on the bottom-right; pressed: inverted
export const bevel = (b, x, y, w, h, c, { pressed = false, fill = true, thin = false } = {}) => {
  if (fill) rect(b, x, y, w, h, c.face)
  const [o1, i1, i2, o2] = pressed ? [c.black, c.shadow, c.light, c.white] : [c.white, c.light, c.shadow, c.black]
  // outer ring
  hline(b, x, y, w - 1, o1)
  vline(b, x, y, h - 1, o1)
  hline(b, x, y + h - 1, w, o2)
  vline(b, x + w - 1, y, h, o2)
  if (thin) return
  // inner ring
  hline(b, x + 1, y + 1, w - 3, i1)
  vline(b, x + 1, y + 1, h - 3, i1)
  hline(b, x + 1, y + h - 2, w - 2, i2)
  vline(b, x + w - 2, y + 1, h - 2, i2)
}
// a sunken well (a 98 text box / LED window)
export const well = (b, x, y, w, h, c, face = c.face) => {
  rect(b, x, y, w, h, face)
  hline(b, x, y, w - 1, c.shadow)
  vline(b, x, y, h - 1, c.shadow)
  hline(b, x + 1, y + 1, w - 3, c.black)
  vline(b, x + 1, y + 1, h - 3, c.black)
  hline(b, x, y + h - 1, w, c.white)
  vline(b, x + w - 1, y, h, c.white)
  hline(b, x + 1, y + h - 2, w - 2, c.light)
  vline(b, x + w - 2, y + 1, h - 2, c.light)
}

// copy a whole bitmap of the same size (a cached background) in one go
export const copyFrom = (b, src) => {
  if (src.w === b.w && src.h === b.h) b.data.set(src.data)
  else blit(b, src, 0, 0)
}

// indices -> ABGR words (an ImageData's Uint32Array view)
export const present = (b, out32, lut) => {
  const d = b.data
  const n = d.length
  for (let i = 0; i < n; i++) out32[i] = lut[d[i]]
}
