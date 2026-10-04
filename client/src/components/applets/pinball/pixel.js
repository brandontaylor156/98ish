// A tiny software renderer for pixel art: a 256-color-style palette, a surface (a Uint32
// pixel buffer the canvas shows with putImageData), and primitives that never anti-alias:
// points, lines, rectangles, filled shapes tested pixel by pixel, ordered (Bayer)
// dithering instead of gradients, palette-indexed sprites from strings, and two bitmap
// fonts (5x7 and 3x5). Pure (no DOM), so Node's tests can draw with it too.

// ---- the palette (VGA-ish, picked by hand; every pixel on the table is one of these) ----
const HEX = {
  clear: null,
  black: "000000",
  ink: "101018",
  g1: "282830",
  g2: "404048",
  g3: "606068",
  g4: "808088",
  g5: "a0a0a8",
  g6: "c0c0c0",
  g7: "dfdfdf",
  white: "ffffff",
  navy0: "000020",
  navy1: "000040",
  navy: "000080",
  blue: "0000aa", // the blue screen
  blue2: "2a2ad4",
  blue3: "5555ff",
  sky: "1084d0", // title bar blue
  sky2: "6cb4f0",
  teal0: "002828",
  teal1: "004040",
  teal2: "005c5c",
  teal: "008080", // the desktop
  teal4: "00a0a0",
  cyan: "55ffff",
  cyan2: "aaffff",
  red0: "400000",
  red1: "800000",
  red: "c00000",
  red3: "ff4040",
  pink: "ff9090",
  brown: "805000",
  orange: "ff8000",
  amber: "ffb000",
  yellow0: "605800",
  yellow1: "a09800",
  yellow: "ffff40",
  cream: "ffffc0",
  green0: "003000",
  green1: "006000",
  green: "00b000",
  lime: "60ff60",
  mint: "c0ffc0",
  mag0: "400040",
  mag1: "800080",
  mag: "d000d0",
  pinkhi: "ff80ff",
  beige0: "605838",
  beige1: "a09870",
  beige: "d8d0b0",
  beige3: "f0ecd8",
  dmd0: "140800",
  dmd1: "3a1800",
  dmd2: "8a3a00",
  dmd: "ff7000",
  dmd4: "ffb060",
}

export const NAMES = Object.keys(HEX)
export const C = Object.fromEntries(NAMES.map((n, i) => [n, i])) // name -> index
export const RGB = NAMES.map((n) => (HEX[n] ? [parseInt(HEX[n].slice(0, 2), 16), parseInt(HEX[n].slice(2, 4), 16), parseInt(HEX[n].slice(4, 6), 16)] : [0, 0, 0]))
// ImageData is RGBA in memory: a little-endian Uint32 is 0xAABBGGRR
export const PAL32 = Uint32Array.from(RGB, ([r, g, b], i) => (i === 0 ? 0 : (0xff000000 | (b << 16) | (g << 8) | r) >>> 0))

// ---- ordered dithering ----
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)
export const bayer = (x, y) => BAYER4[((y & 3) << 2) | (x & 3)]
// a color from a ramp (dark -> light) at t 0..1, dithered between the two nearest
export const rampAt = (ramp, t, x, y) => {
  const f = Math.max(0, Math.min(1, t)) * (ramp.length - 1)
  const i = Math.floor(f)
  return ramp[i + (f - i > bayer(x, y) && i + 1 < ramp.length ? 1 : 0)]
}

// ---- surfaces ----
export const surface = (w, h) => ({ w, h, buf: new Uint32Array(w * h) })

export const pset = (s, x, y, c) => {
  x |= 0
  y |= 0
  if (c > 0 && x >= 0 && y >= 0 && x < s.w && y < s.h) s.buf[y * s.w + x] = PAL32[c]
}
// raw 32-bit write (for copying)
export const pset32 = (s, x, y, v) => {
  if (x >= 0 && y >= 0 && x < s.w && y < s.h) s.buf[y * s.w + x] = v
}

export const rect = (s, x, y, w, h, c) => {
  x |= 0
  y |= 0
  const x0 = Math.max(0, x)
  const y0 = Math.max(0, y)
  const x1 = Math.min(s.w, x + w)
  const y1 = Math.min(s.h, y + h)
  if (c <= 0) return
  const v = PAL32[c]
  for (let yy = y0; yy < y1; yy++) s.buf.fill(v, yy * s.w + x0, yy * s.w + x1)
}

export const frame = (s, x, y, w, h, c) => {
  rect(s, x, y, w, 1, c)
  rect(s, x, y + h - 1, w, 1, c)
  rect(s, x, y, 1, h, c)
  rect(s, x + w - 1, y, 1, h, c)
}

// a Win98 3D bevel: raised (light top-left) or sunken
export const bevel = (s, x, y, w, h, raised = true, face = C.g6) => {
  rect(s, x, y, w, h, face)
  const [lt, dk] = raised ? [C.white, C.g2] : [C.g2, C.white]
  rect(s, x, y, w - 1, 1, lt)
  rect(s, x, y, 1, h - 1, lt)
  rect(s, x, y + h - 1, w, 1, dk)
  rect(s, x + w - 1, y, 1, h, dk)
  if (w > 4 && h > 4) {
    rect(s, x + 1, y + h - 2, w - 2, 1, raised ? C.g4 : C.g7)
    rect(s, x + w - 2, y + 1, 1, h - 2, raised ? C.g4 : C.g7)
  }
}

export const line = (s, x0, y0, x1, y1, c) => {
  x0 = Math.round(x0)
  y0 = Math.round(y0)
  x1 = Math.round(x1)
  y1 = Math.round(y1)
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    pset(s, x0, y0, c)
    if (x0 === x1 && y0 === y1) return
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

// Fill every pixel in a box that fn(x, y) gives a color for (the pixel's center is
// x + 0.5, y + 0.5). The workhorse for shaded, outlined pixel shapes.
export const shape = (s, x0, y0, x1, y1, fn) => {
  x0 = Math.max(0, Math.floor(x0))
  y0 = Math.max(0, Math.floor(y0))
  x1 = Math.min(s.w - 1, Math.ceil(x1))
  y1 = Math.min(s.h - 1, Math.ceil(y1))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = fn(x, y)
      if (c > 0) s.buf[y * s.w + x] = PAL32[c]
    }
  }
}

export const disc = (s, cx, cy, r, c) => shape(s, cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r ? c : 0))

export const ring = (s, cx, cy, r, c, width = 1) =>
  shape(s, cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
    return d <= r && d > r - width ? c : 0
  })

// distance from p to the segment a-b
export const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

// a filled polygon (even-odd), points as [[x, y]...]
export const inPoly = (pts, x, y) => {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
export const poly = (s, pts, c) => {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  shape(s, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (x, y) => (inPoly(pts, x + 0.5, y + 0.5) ? c : 0))
}

// ---- sprites: rows of characters, each mapped to a palette index ("." is clear) ----
export const sprite = (rows, map) => {
  const h = rows.length
  const w = Math.max(...rows.map((r) => r.length))
  const data = new Int16Array(w * h).fill(-1)
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (ch === "." || ch === " ") continue
      const c = map[ch]
      if (c === undefined) throw new Error(`sprite: no color for "${ch}"`)
      data[y * w + x] = c
    }
  })
  return { w, h, data }
}

// draw a sprite; swap (optional) maps palette index -> palette index (lit lamps, flashes)
export const blit = (s, spr, x, y, swap) => {
  x = Math.round(x)
  y = Math.round(y)
  for (let j = 0; j < spr.h; j++) {
    const yy = y + j
    if (yy < 0 || yy >= s.h) continue
    for (let i = 0; i < spr.w; i++) {
      let c = spr.data[j * spr.w + i]
      if (c < 0) continue
      if (swap && swap[c] !== undefined) c = swap[c]
      const xx = x + i
      if (xx >= 0 && xx < s.w && c > 0) s.buf[yy * s.w + xx] = PAL32[c]
    }
  }
}

// grab a part of a surface as a sprite (palette-free: raw pixels, 0 = clear)
export const capture = (s, x, y, w, h) => {
  const data = new Uint32Array(w * h)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = x + i < s.w && y + j < s.h ? s.buf[(y + j) * s.w + x + i] : 0
  return { w, h, raw: data }
}
export const blitRaw = (s, spr, x, y) => {
  for (let j = 0; j < spr.h; j++) {
    const yy = y + j
    if (yy < 0 || yy >= s.h) continue
    for (let i = 0; i < spr.w; i++) {
      const v = spr.raw[j * spr.w + i]
      const xx = x + i
      if (v && xx >= 0 && xx < s.w) s.buf[yy * s.w + xx] = v
    }
  }
}

// ---- bitmap fonts ----
// 5x7 (an LCD-style font: rows top to bottom, 5 bits, left = 16)
const F5 = {
  0: [14, 17, 19, 21, 25, 17, 14],
  1: [4, 12, 4, 4, 4, 4, 14],
  2: [14, 17, 1, 2, 4, 8, 31],
  3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2],
  5: [31, 16, 30, 1, 1, 17, 14],
  6: [6, 8, 16, 30, 17, 17, 14],
  7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14],
  9: [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 17, 31, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 17, 25, 21, 19, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 12, 12],
  ",": [0, 0, 0, 0, 12, 4, 8],
  ":": [0, 12, 12, 0, 12, 12, 0],
  "!": [4, 4, 4, 4, 0, 0, 4],
  "?": [14, 17, 1, 2, 4, 0, 4],
  "-": [0, 0, 0, 31, 0, 0, 0],
  "+": [0, 4, 4, 31, 4, 4, 0],
  "/": [0, 1, 2, 4, 8, 16, 0],
  "\\": [0, 16, 8, 4, 2, 1, 0],
  "'": [12, 4, 8, 0, 0, 0, 0],
  '"': [10, 10, 10, 0, 0, 0, 0],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  "*": [0, 4, 21, 14, 21, 4, 0],
  "#": [10, 10, 31, 10, 31, 10, 10],
  "%": [24, 25, 2, 4, 8, 19, 3],
  "=": [0, 0, 31, 0, 31, 0, 0],
  ">": [8, 4, 2, 1, 2, 4, 8],
  "<": [2, 4, 8, 16, 8, 4, 2],
  _: [0, 0, 0, 0, 0, 0, 31],
  "@": [14, 17, 1, 13, 21, 21, 14],
  "&": [12, 18, 20, 8, 21, 18, 13],
}
// 3x5 (rows, 3 bits, left = 4)
const F3 = {
  A: [2, 5, 7, 5, 5],
  B: [6, 5, 6, 5, 6],
  C: [3, 4, 4, 4, 3],
  D: [6, 5, 5, 5, 6],
  E: [7, 4, 6, 4, 7],
  F: [7, 4, 6, 4, 4],
  G: [3, 4, 5, 5, 3],
  H: [5, 5, 7, 5, 5],
  I: [7, 2, 2, 2, 7],
  J: [1, 1, 1, 5, 2],
  K: [5, 5, 6, 5, 5],
  L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5],
  N: [6, 5, 5, 5, 5],
  O: [2, 5, 5, 5, 2],
  P: [6, 5, 6, 4, 4],
  Q: [2, 5, 5, 6, 3],
  R: [6, 5, 6, 5, 5],
  S: [3, 4, 2, 1, 6],
  T: [7, 2, 2, 2, 2],
  U: [5, 5, 5, 5, 7],
  V: [5, 5, 5, 5, 2],
  W: [5, 5, 7, 7, 5],
  X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2],
  Z: [7, 1, 2, 4, 7],
  0: [7, 5, 5, 5, 7],
  1: [2, 6, 2, 2, 7],
  2: [6, 1, 2, 4, 7],
  3: [6, 1, 2, 1, 6],
  4: [5, 5, 7, 1, 1],
  5: [7, 4, 6, 1, 6],
  6: [3, 4, 7, 5, 7],
  7: [7, 1, 1, 2, 2],
  8: [7, 5, 7, 5, 7],
  9: [7, 5, 7, 1, 6],
  " ": [0, 0, 0, 0, 0],
  "-": [0, 0, 7, 0, 0],
  ".": [0, 0, 0, 0, 2],
  ",": [0, 0, 0, 2, 4],
  "!": [2, 2, 2, 0, 2],
  ":": [0, 2, 0, 2, 0],
  "+": [0, 2, 7, 2, 0],
  "/": [1, 1, 2, 4, 4],
  "'": [2, 2, 0, 0, 0],
  "?": [6, 1, 2, 0, 2],
  "*": [5, 2, 5, 0, 0],
  "\\": [4, 4, 2, 1, 1],
  ">": [4, 2, 1, 2, 4],
  "<": [1, 2, 4, 2, 1],
}
export const FONTS = {
  big: { glyphs: F5, w: 5, h: 7, bits: 16, gap: 1 },
  small: { glyphs: F3, w: 3, h: 5, bits: 4, gap: 1 },
}

export const textWidth = (str, font = FONTS.big, scale = 1) => (str.length ? (str.length * (font.w + font.gap) - font.gap) * scale : 0)

// each lit dot of a string: calls dot(x, y) in font pixels (times scale)
export const textDots = (str, font, x, y, scale, dot) => {
  const up = String(str).toUpperCase()
  let cx = x
  for (const ch of up) {
    const rows = font.glyphs[ch] || font.glyphs["?"]
    for (let r = 0; r < font.h; r++) {
      const bits = rows[r]
      if (!bits) continue
      for (let c = 0; c < font.w; c++) {
        if (!(bits & (font.bits >> c))) continue
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) dot(cx + c * scale + sx, y + r * scale + sy)
      }
    }
    cx += (font.w + font.gap) * scale
  }
}

// text on a surface; align "left" | "center" | "right"; outline draws a 1px border round it
export const text = (s, str, x, y, c, { font = FONTS.big, align = "left", outline = 0, scale = 1, shadow = 0 } = {}) => {
  const w = textWidth(String(str), font, scale)
  const x0 = Math.round(align === "center" ? x - w / 2 : align === "right" ? x - w : x)
  y = Math.round(y)
  if (outline) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) textDots(str, font, x0 + dx, y + dy, scale, (px, py) => pset(s, px, py, outline))
  }
  if (shadow) textDots(str, font, x0 + 1, y + 1, scale, (px, py) => pset(s, px, py, shadow))
  textDots(str, font, x0, y, scale, (px, py) => pset(s, px, py, c))
  return w
}
