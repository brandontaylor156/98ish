// Paint's pixel routines. Everything works on a "surface" { width, height, data } (an
// ImageData, or a plain object in tests) and draws hard-edged pixels like the 1998
// original, so Fill With Color fills exactly the area you see. No DOM in here.

// The 28 colors in the color box, top row then bottom row
export const PALETTE = [
  "#000000", "#808080", "#800000", "#808000", "#008000", "#008080", "#000080", "#800080", "#808040", "#004040", "#0080ff", "#004080", "#8000ff", "#804000",
  "#ffffff", "#c0c0c0", "#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ffff80", "#00ff80", "#80ffff", "#8080ff", "#ff0080", "#ff8040",
]

// The 48 "Basic colors" in Edit Colors (8 across, 6 down)
export const BASIC_COLORS = [
  "#ff8080", "#ffff80", "#80ff80", "#00ff80", "#80ffff", "#0080ff", "#ff80c0", "#ff80ff",
  "#ff0000", "#ffff00", "#80ff00", "#00ff40", "#00ffff", "#0080c0", "#8080c0", "#ff00ff",
  "#804040", "#ff8040", "#00ff00", "#008080", "#004080", "#8080ff", "#800040", "#ff0080",
  "#800000", "#ff8000", "#008000", "#008040", "#0000ff", "#0000a0", "#800080", "#8000ff",
  "#400000", "#804000", "#004000", "#004040", "#000080", "#000040", "#400040", "#400080",
  "#000000", "#808000", "#808040", "#808080", "#408080", "#c0c0c0", "#400040", "#ffffff",
]

// ---------- colors ----------

export const parseColor = (hex) => {
  const n = parseInt(String(hex).replace("#", ""), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const toHex = ([r, g, b]) => "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)

// Windows' color picker counts hue, saturation and luminosity from 0 to 240
export const rgbToHsl = ([r, g, b]) => {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [160, 0, Math.round(l * 240)]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h /= 6
  return [Math.round(h * 240) % 240, Math.round(s * 240), Math.round(l * 240)]
}

export const hslToRgb = ([h, s, l]) => {
  h = (((h % 240) + 240) % 240) / 240
  s = Math.min(240, Math.max(0, s)) / 240
  l = Math.min(240, Math.max(0, l)) / 240
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t) => {
    t = (t + 1) % 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => Math.round(v * 255))
}

// a color as one 32-bit number in the surface's own byte order
const packBytes = new Uint8ClampedArray(4)
const packWord = new Uint32Array(packBytes.buffer)
export const pack = (rgb, alpha = 255) => {
  packBytes[0] = rgb[0]
  packBytes[1] = rgb[1]
  packBytes[2] = rgb[2]
  packBytes[3] = alpha
  return packWord[0]
}

const words = (s) => new Uint32Array(s.data.buffer, s.data.byteOffset, s.width * s.height)

// ---------- surfaces ----------

export const createSurface = (width, height, rgb = [255, 255, 255]) => {
  const s = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  words(s).fill(pack(rgb))
  return s
}

export const cloneSurface = (s) => ({ width: s.width, height: s.height, data: new Uint8ClampedArray(s.data) })

export const getPixel = (s, x, y) => {
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return null
  const i = (y * s.width + x) * 4
  return [s.data[i], s.data[i + 1], s.data[i + 2]]
}

export const setPixel = (s, x, y, rgb) => {
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return
  words(s)[y * s.width + x] = pack(rgb)
}

// one row, clipped
const row = (v, s, y, xl, xr, p) => {
  if (y < 0 || y >= s.height) return
  xl = Math.max(0, xl)
  xr = Math.min(s.width - 1, xr)
  if (xl <= xr) v.fill(p, y * s.width + xl, y * s.width + xr + 1)
}

export const fillRect = (s, x, y, w, h, rgb) => {
  const v = words(s)
  const p = pack(rgb)
  for (let yy = y; yy < y + h; yy++) row(v, s, yy, x, x + w - 1, p)
}

// spans: [[y, xl, xr], ...]
export const fillSpans = (s, spans, rgb) => {
  const v = words(s)
  const p = pack(rgb)
  for (const [y, xl, xr] of spans) row(v, s, y, xl, xr, p)
}

// ---------- lines and brushes ----------

// Bresenham: calls fn(x, y) for every pixel from one end to the other
export const forLine = (x0, y0, x1, y1, fn) => {
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
    fn(x0, y0)
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

// The pixels a brush covers, as [dx, dy] offsets from the pointer
export const stampOffsets = (shape, size) => {
  const out = []
  const o = Math.floor(size / 2)
  if (shape === "square") {
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) out.push([dx - o, dy - o])
  } else if (shape === "slash") {
    for (let i = 0; i < size; i++) out.push([i - o, size - 1 - i - o])
  } else if (shape === "backslash") {
    for (let i = 0; i < size; i++) out.push([i - o, i - o])
  } else {
    // round
    const r = size / 2
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++) if ((dx + 0.5 - r) ** 2 + (dy + 0.5 - r) ** 2 <= r * r + 0.5) out.push([dx - o, dy - o])
  }
  return out
}

// A line drawn by pressing a brush at every pixel along it
export const drawStroke = (s, x0, y0, x1, y1, offsets, rgb) => {
  const v = words(s)
  const p = pack(rgb)
  const { width: w, height: h } = s
  forLine(x0, y0, x1, y1, (x, y) => {
    for (const [dx, dy] of offsets) {
      const px = x + dx
      const py = y + dy
      if (px >= 0 && py >= 0 && px < w && py < h) v[py * w + px] = p
    }
  })
}

// The eraser's right-button mode: only pixels of one color turn into another
export const replaceStroke = (s, x0, y0, x1, y1, offsets, fromRgb, toRgb) => {
  const v = words(s)
  const from = pack(fromRgb)
  const to = pack(toRgb)
  const { width: w, height: h } = s
  forLine(x0, y0, x1, y1, (x, y) => {
    for (const [dx, dy] of offsets) {
      const px = x + dx
      const py = y + dy
      if (px >= 0 && py >= 0 && px < w && py < h && v[py * w + px] === from) v[py * w + px] = to
    }
  })
}

// Random dots in a circle (the airbrush)
export const sprayDots = (cx, cy, radius, count, rand = Math.random) => {
  const out = []
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2
    const d = Math.sqrt(rand()) * radius
    out.push([Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d)])
  }
  return out
}

// ---------- fill ----------

// Fill With Color: everything touching (x, y) that is exactly the same color (4-way)
export const floodFill = (s, x, y, rgb) => {
  x = Math.floor(x)
  y = Math.floor(y)
  const { width: w, height: h } = s
  if (x < 0 || y < 0 || x >= w || y >= h) return false
  const v = words(s)
  const target = v[y * w + x]
  const p = pack(rgb)
  if (target === p) return false
  const stack = [x, y]
  while (stack.length) {
    const cy = stack.pop()
    const cx = stack.pop()
    if (v[cy * w + cx] !== target) continue
    let l = cx
    let r = cx
    while (l > 0 && v[cy * w + l - 1] === target) l--
    while (r < w - 1 && v[cy * w + r + 1] === target) r++
    v.fill(p, cy * w + l, cy * w + r + 1)
    for (const ny of [cy - 1, cy + 1]) {
      if (ny < 0 || ny >= h) continue
      let inRun = false
      for (let k = l; k <= r; k++) {
        const match = v[ny * w + k] === target
        if (match && !inRun) stack.push(k, ny)
        inRun = match
      }
    }
  }
  return true
}

// ---------- shapes ----------

// two corners -> { x0, y0, x1, y1 } with x0 <= x1, y0 <= y1
export const boxOf = (ax, ay, bx, by) => ({ x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) })

// Shift held: lines snap to 0/45/90 degrees, boxes become squares
export const snapLine = (x0, y0, x1, y1) => {
  const dx = x1 - x0
  const dy = y1 - y0
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ax > 2 * ay) return [x1, y0]
  if (ay > 2 * ax) return [x0, y1]
  const d = Math.max(ax, ay)
  return [x0 + (dx < 0 ? -d : d), y0 + (dy < 0 ? -d : d)]
}

export const snapSquare = (x0, y0, x1, y1) => {
  const dx = x1 - x0
  const dy = y1 - y0
  const d = Math.max(Math.abs(dx), Math.abs(dy))
  return [x0 + (dx < 0 ? -d : d), y0 + (dy < 0 ? -d : d)]
}

export const ROUND_RADIUS = 8

// The pixels of row y inside a shape filling `box` ([xl, xr] or null). A pixel is in when
// its center is; rectangles are rounded rectangles with no rounding.
export const shapeSpan = (kind, box, y, radius = ROUND_RADIUS) => {
  if (box.x0 > box.x1 || box.y0 > box.y1 || y < box.y0 || y > box.y1) return null
  const yc = y + 0.5
  let inset = 0
  if (kind === "ellipse") {
    const a = (box.x1 - box.x0 + 1) / 2
    const b = (box.y1 - box.y0 + 1) / 2
    const t = (yc - (box.y0 + b)) / b
    if (Math.abs(t) > 1) return null
    inset = a - a * Math.sqrt(1 - t * t)
  } else if (kind === "roundrect" && radius > 0) {
    const rx = Math.min(radius, (box.x1 - box.x0 + 1) / 2)
    const ry = Math.min(radius, (box.y1 - box.y0 + 1) / 2)
    const top = box.y0 + ry
    const bottom = box.y1 + 1 - ry
    const t = yc < top ? (top - yc) / ry : yc > bottom ? (yc - bottom) / ry : 0
    if (t > 1) return null
    inset = rx - rx * Math.sqrt(1 - t * t)
  }
  const xl = Math.ceil(box.x0 + inset - 0.5)
  const xr = Math.floor(box.x1 + 1 - inset - 0.5)
  return xl <= xr ? [xl, xr] : null
}

// Rectangle / Ellipse / Rounded Rectangle with an outline `width` pixels thick.
// style: "outline" | "both" (outline + fill) | "fill"
export const drawShape = (s, kind, box, style, width, lineRgb, fillRgb) => {
  const inner = { x0: box.x0 + width, y0: box.y0 + width, x1: box.x1 - width, y1: box.y1 - width }
  const innerRadius = Math.max(0, ROUND_RADIUS - width)
  const line = []
  const fill = []
  for (let y = box.y0; y <= box.y1; y++) {
    const outer = shapeSpan(kind, box, y)
    if (!outer) continue
    if (style === "fill") {
      line.push([y, outer[0], outer[1]]) // a solid shape is all one color: the line color
      continue
    }
    const hole = shapeSpan(kind, inner, y, innerRadius)
    if (!hole) {
      line.push([y, outer[0], outer[1]])
      continue
    }
    if (hole[0] > outer[0]) line.push([y, outer[0], hole[0] - 1])
    if (hole[1] < outer[1]) line.push([y, hole[1] + 1, outer[1]])
    if (style === "both") fill.push([y, hole[0], hole[1]])
  }
  fillSpans(s, fill, fillRgb)
  fillSpans(s, line, lineRgb)
}

// The inside of a polygon ([[x, y], ...]), even-odd, as spans
export const polygonSpans = (points) => {
  const spans = []
  if (points.length < 3) return spans
  const ys = points.map((p) => p[1])
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  for (let y = top; y <= bottom; y++) {
    const yc = y + 0.5
    const xs = []
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = points[i]
      const [bx, by] = points[(i + 1) % points.length]
      const ayc = ay + 0.5
      const byc = by + 0.5
      if ((ayc <= yc && yc < byc) || (byc <= yc && yc < ayc)) xs.push(ax + 0.5 + ((yc - ayc) * (bx - ax)) / (byc - ayc))
    }
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xl = Math.ceil(xs[i] - 0.5)
      const xr = Math.floor(xs[i + 1] - 0.5)
      if (xl <= xr) spans.push([y, xl, xr])
    }
  }
  return spans
}

export const drawPolyline = (s, points, offsets, rgb, closed = false) => {
  if (points.length === 1) return drawStroke(s, points[0][0], points[0][1], points[0][0], points[0][1], offsets, rgb)
  for (let i = 0; i + 1 < points.length; i++) drawStroke(s, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], offsets, rgb)
  if (closed && points.length > 2) drawStroke(s, points.at(-1)[0], points.at(-1)[1], points[0][0], points[0][1], offsets, rgb)
}

export const drawPolygon = (s, points, style, offsets, lineRgb, fillRgb) => {
  if (style !== "outline") fillSpans(s, polygonSpans(points), style === "fill" ? lineRgb : fillRgb)
  if (style !== "fill") drawPolyline(s, points, offsets, lineRgb, true)
}

// A cubic Bezier as a list of whole-pixel points (the Curve tool)
export const bezierPoints = (p0, p1, p2, p3) => {
  const length = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1])
  const n = Math.max(2, Math.ceil(length / 2))
  const out = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0]
    const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
    const pt = [Math.round(x), Math.round(y)]
    if (!out.length || out.at(-1)[0] !== pt[0] || out.at(-1)[1] !== pt[1]) out.push(pt)
  }
  return out
}

// ---------- pieces (selections) ----------

// Copy a rectangle out of a surface. With a polygon (in surface coordinates) only the
// pixels inside it are kept; the rest are see-through (alpha 0).
export const extract = (s, x, y, w, h, polygon = null) => {
  const out = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
  const src = words(s)
  const dst = words(out)
  const keep = (yy, xl, xr) => {
    for (let xx = Math.max(xl, x, 0); xx <= Math.min(xr, x + w - 1, s.width - 1); xx++) dst[(yy - y) * w + (xx - x)] = src[yy * s.width + xx]
  }
  if (polygon) {
    for (const [yy, xl, xr] of polygonSpans(polygon)) if (yy >= y && yy < y + h && yy >= 0 && yy < s.height) keep(yy, xl, xr)
    // the outline itself belongs to the selection too
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]
      const b = polygon[(i + 1) % polygon.length]
      forLine(a[0], a[1], b[0], b[1], (px, py) => {
        if (py >= y && py < y + h && py >= 0 && py < s.height) keep(py, px, px)
      })
    }
  } else {
    for (let yy = Math.max(0, y); yy < Math.min(s.height, y + h); yy++) keep(yy, x, x + w - 1)
  }
  return out
}

// Fill whatever `piece` covers (its non-see-through pixels) at (x, y) with a color: the
// hole a selection leaves behind when it's moved
export const clearUnder = (s, piece, x, y, rgb) => {
  const dst = words(s)
  const p = pack(rgb)
  for (let py = 0; py < piece.height; py++) {
    const ty = y + py
    if (ty < 0 || ty >= s.height) continue
    for (let px = 0; px < piece.width; px++) {
      const tx = x + px
      if (tx < 0 || tx >= s.width) continue
      if (piece.data[(py * piece.width + px) * 4 + 3]) dst[ty * s.width + tx] = p
    }
  }
}

// Put a piece down at (x, y). Pixels of `transparentRgb` are skipped (Draw Transparent).
export const stamp = (s, piece, x, y, transparentRgb = null) => {
  const dst = words(s)
  const src = words(piece)
  const skip = transparentRgb ? pack(transparentRgb) : null
  for (let py = 0; py < piece.height; py++) {
    const ty = y + py
    if (ty < 0 || ty >= s.height) continue
    for (let px = 0; px < piece.width; px++) {
      const tx = x + px
      if (tx < 0 || tx >= s.width) continue
      const i = py * piece.width + px
      if (!piece.data[i * 4 + 3]) continue
      if (skip !== null && src[i] === skip) continue
      dst[ty * s.width + tx] = src[i]
    }
  }
}

// ---------- whole-picture changes (also used on selections) ----------

export const invert = (s) => {
  const d = s.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i]
    d[i + 1] = 255 - d[i + 1]
    d[i + 2] = 255 - d[i + 2]
  }
  return s
}

const remap = (s, width, height, from) => {
  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  const src = words(s)
  const dst = words(out)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = from(x, y)
      if (at) dst[y * width + x] = src[at[1] * s.width + at[0]]
    }
  return out
}

export const flipHorizontal = (s) => remap(s, s.width, s.height, (x, y) => [s.width - 1 - x, y])
export const flipVertical = (s) => remap(s, s.width, s.height, (x, y) => [x, s.height - 1 - y])

// clockwise
export const rotate = (s, degrees) => {
  const d = ((degrees % 360) + 360) % 360
  if (d === 90) return remap(s, s.height, s.width, (x, y) => [y, s.height - 1 - x])
  if (d === 180) return remap(s, s.width, s.height, (x, y) => [s.width - 1 - x, s.height - 1 - y])
  if (d === 270) return remap(s, s.height, s.width, (x, y) => [s.width - 1 - y, x])
  return cloneSurface(s)
}

// Stretch to a percentage of the size (nearest pixel, like the original)
export const stretch = (s, xPercent, yPercent) => {
  const width = Math.max(1, Math.round((s.width * xPercent) / 100))
  const height = Math.max(1, Math.round((s.height * yPercent) / 100))
  return remap(s, width, height, (x, y) => [Math.min(s.width - 1, Math.floor((x * s.width) / width)), Math.min(s.height - 1, Math.floor((y * s.height) / height))])
}

// Skew by an angle (degrees, -89..89). The new corners are filled with `bgRgb`, or left
// see-through when it's null.
export const skew = (s, xDegrees, yDegrees, bgRgb = null) => {
  let out = s
  const fill = (surface) => {
    if (bgRgb) {
      const d = surface.data
      const [r, g, b] = bgRgb
      for (let i = 0; i < d.length; i += 4)
        if (!d[i + 3]) {
          d[i] = r
          d[i + 1] = g
          d[i + 2] = b
          d[i + 3] = 255
        }
    }
    return surface
  }
  if (xDegrees) {
    const t = Math.tan((xDegrees * Math.PI) / 180)
    const extra = Math.round(Math.abs(t) * (out.height - 1))
    const src = out
    const shift = (y) => Math.round(t >= 0 ? (src.height - 1 - y) * t : -y * t)
    out = remap(src, src.width + extra, src.height, (x, y) => {
      const sx = x - shift(y)
      return sx >= 0 && sx < src.width ? [sx, y] : null
    })
  }
  if (yDegrees) {
    const t = Math.tan((yDegrees * Math.PI) / 180)
    const extra = Math.round(Math.abs(t) * (out.width - 1))
    const src = out
    const shift = (x) => Math.round(t >= 0 ? (src.width - 1 - x) * t : -x * t)
    out = remap(src, src.width, src.height + extra, (x, y) => {
      const sy = y - shift(x)
      return sy >= 0 && sy < src.height ? [x, sy] : null
    })
  }
  return fill(out === s ? cloneSurface(s) : out)
}

// New canvas size: keeps the top-left corner, new space is `bgRgb`
export const resizeCanvas = (s, width, height, bgRgb) => {
  const out = createSurface(width, height, bgRgb)
  stamp(out, s, 0, 0)
  return out
}
