// Snipping Tool's numbers, pure (snipMath.test.js): selection rectangles, fitting the snip
// on screen, screen <-> picture coordinates, pen and highlighter strokes, crop, names.

// modern-screenshot (MIT, qq15725) draws the 98ish page into a picture; loaded from jsDelivr
// at a pinned version the first time you snip (as PDF Viewer loads pdf.js)
export const SHOT_VERSION = "4.6.8"
export const SHOT_URL = `https://cdn.jsdelivr.net/npm/modern-screenshot@${SHOT_VERSION}/dist/index.mjs`

export const MODES = [
  { id: "rect", label: "Rectangle" },
  { id: "window", label: "Window" },
  { id: "full", label: "Full screen" },
]
export const DELAYS = [0, 3, 5, 10]
export const MIN_SNIP = 6 // CSS px: a smaller drag is a tap

// the box a drag from (x0, y0) to (x1, y1) makes, whichever way it went
export const normRect = (x0, y0, x1, y1) => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) })

// kept inside 0..W, 0..H (null when nothing is left)
export const clampRect = (r, W, H) => {
  if (!r) return null
  const x = Math.max(0, Math.min(r.x, W))
  const y = Math.max(0, Math.min(r.y, H))
  const x2 = Math.max(0, Math.min(r.x + r.w, W))
  const y2 = Math.max(0, Math.min(r.y + r.h, H))
  return x2 - x > 0 && y2 - y > 0 ? { x, y, w: x2 - x, h: y2 - y } : null
}

// a CSS-pixel box -> whole picture pixels (the picture is `scale` times the screen), growing
// outward so nothing selected is cut off, and kept inside the picture
export const toImageRect = (r, scale, imgW, imgH) => {
  if (!r) return null
  const x = Math.floor(r.x * scale)
  const y = Math.floor(r.y * scale)
  const x2 = Math.ceil((r.x + r.w) * scale)
  const y2 = Math.ceil((r.y + r.h) * scale)
  return clampRect({ x, y, w: x2 - x, h: y2 - y }, imgW, imgH)
}

// the picture shown whole inside a box (never larger than `maxZoom` times its size)
export const fitBox = (imgW, imgH, boxW, boxH, maxZoom = 1) => {
  if (!(imgW > 0 && imgH > 0 && boxW > 0 && boxH > 0)) return { scale: 1, w: 0, h: 0, x: 0, y: 0 }
  const scale = Math.min(boxW / imgW, boxH / imgH, maxZoom)
  const w = imgW * scale
  const h = imgH * scale
  return { scale, w, h, x: (boxW - w) / 2, y: (boxH - h) / 2 }
}

// a point on the shown picture (relative to its box) -> picture pixels, kept inside it
export const viewToImage = (px, py, fit, imgW, imgH) => ({
  x: Math.max(0, Math.min(imgW, (px - fit.x) / fit.scale)),
  y: Math.max(0, Math.min(imgH, (py - fit.y) / fit.scale)),
})

// ---- markup ----

export const PEN_COLORS = [
  { id: "red", label: "Red", value: "#e00000" },
  { id: "blue", label: "Blue", value: "#0000e0" },
  { id: "black", label: "Black", value: "#000000" },
  { id: "green", label: "Green", value: "#008000" },
]
export const HIGHLIGHT = { color: "#ffe600", alpha: 0.4 }

// line widths in picture pixels: as wide on screen whatever the picture's size (`viewScale`:
// screen px per picture px), at least 1 px
export const strokeWidth = (tool, viewScale, size = "thin") => {
  const css = tool === "highlighter" ? (size === "thick" ? 22 : 14) : size === "thick" ? 6 : 3
  return Math.max(1, Math.round(css / Math.max(0.05, viewScale)))
}

// adds a point unless it's within `minGap` picture px of the last one (keeps strokes small)
export const addPoint = (points, x, y, minGap = 1.5) => {
  const last = points[points.length - 1]
  if (last && Math.hypot(x - last[0], y - last[1]) < minGap) return points
  return [...points, [Math.round(x * 10) / 10, Math.round(y * 10) / 10]]
}

// the box a stroke covers (with its width), for redrawing just that part
export const strokeBounds = (stroke) => {
  if (!stroke?.points?.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of stroke.points) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  const pad = stroke.width / 2
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + stroke.width, h: y1 - y0 + stroke.width }
}

// The markup history, as plain data: [{ type: "stroke", stroke } | { type: "crop", rect }].
// The picture you'd get is the original, with every stroke drawn and every crop applied in
// order; `layout` says what that is without drawing it: the final size, and for each step the
// offset of the picture it was drawn on from the original's top-left corner.
export const layout = (imgW, imgH, steps) => {
  let ox = 0
  let oy = 0
  let w = imgW
  let h = imgH
  const offsets = []
  for (const step of steps) {
    offsets.push({ x: ox, y: oy })
    if (step.type === "crop") {
      const r = clampRect(step.rect, w, h)
      if (!r) continue
      ox += r.x
      oy += r.y
      w = r.w
      h = r.h
    }
  }
  return { w, h, x: ox, y: oy, offsets }
}

// a crop drawn on the current picture (current-picture px) -> a step; null if too small
export const cropStep = (rect, curW, curH, min = 4) => {
  const r = clampRect(rect && { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) }, curW, curH)
  if (!r || r.w < min || r.h < min) return null
  if (r.x === 0 && r.y === 0 && r.w === curW && r.h === curH) return null
  return { type: "crop", rect: r }
}

// ---- names and files ----

const two = (n) => String(n).padStart(2, "0")
export const snipName = (date = new Date(), ext = "png") =>
  `Snip ${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} at ${two(date.getHours())}.${two(date.getMinutes())}.${two(date.getSeconds())}.${ext}`

// PNG keeps screen text sharp; a very big one (a full phone screen with photos) is a JPEG
export const PNG_MAX_CHARS = 2_000_000
export const pickFormat = (pngChars) => (pngChars <= PNG_MAX_CHARS ? "png" : "jpg")

// what the countdown badge says
export const countdownText = (left) => (left > 0 ? `Snip in ${left}...` : "Snip!")
