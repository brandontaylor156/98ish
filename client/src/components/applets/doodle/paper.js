// Doodle Together's drawing: backgrounds (templates), smooth strokes, the paint bucket and
// stickers, on canvases that are CANVAS x CANVAS logical pixels (the same for everyone)
// drawn at RES times that for sharpness. Everyone replays the same list of ops the same
// way, so every screen shows the same picture.

import { drawSticker, heartPath } from "../puzzle/art"

export const CANVAS = 960
export const RES = 1.5
export const PX = Math.round(CANVAS * RES)

export const TEMPLATES = [
  { id: "blank", name: "Blank" },
  { id: "lined", name: "Lined Paper" },
  { id: "heart", name: "Fill in the Heart" },
  { id: "coloring", name: "Coloring Page" },
]
export const STICKERS = ["heart", "star", "flower", "smile"]
export const PENCIL_WIDTH = 3
export const SIZES = [4, 8, 14, 24, 40]

// ---------- backgrounds ----------

const outline = (ctx, width = 6) => {
  ctx.strokeStyle = "#222"
  ctx.lineWidth = width
  ctx.lineJoin = "round"
  ctx.lineCap = "round"
  ctx.stroke()
}

const coloringPage = (ctx) => {
  // sun
  ctx.beginPath()
  ctx.arc(780, 170, 80, 0, Math.PI * 2)
  outline(ctx)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(780 + Math.cos(a) * 100, 170 + Math.sin(a) * 100)
    ctx.lineTo(780 + Math.cos(a) * 135, 170 + Math.sin(a) * 135)
    outline(ctx)
  }
  // cloud
  ctx.beginPath()
  ctx.moveTo(140, 220)
  ctx.arc(170, 190, 40, Math.PI * 0.75, Math.PI * 1.6)
  ctx.arc(240, 160, 55, Math.PI * 1.1, Math.PI * 1.9)
  ctx.arc(320, 190, 42, Math.PI * 1.35, Math.PI * 0.3)
  ctx.lineTo(140, 230)
  ctx.closePath()
  outline(ctx)
  // ground
  ctx.beginPath()
  ctx.moveTo(0, 700)
  ctx.bezierCurveTo(240, 650, 520, 720, 960, 660)
  outline(ctx)
  // house
  ctx.beginPath()
  ctx.rect(170, 450, 260, 230)
  outline(ctx)
  ctx.beginPath()
  ctx.moveTo(140, 460)
  ctx.lineTo(300, 320)
  ctx.lineTo(460, 460)
  ctx.closePath()
  outline(ctx)
  ctx.beginPath()
  ctx.rect(270, 560, 70, 120)
  outline(ctx)
  ctx.beginPath()
  ctx.rect(195, 490, 60, 55)
  ctx.moveTo(225, 490)
  ctx.lineTo(225, 545)
  ctx.moveTo(195, 517)
  ctx.lineTo(255, 517)
  outline(ctx, 5)
  ctx.beginPath()
  heartPath(ctx, 385, 515, 50)
  outline(ctx, 5)
  // tree
  ctx.beginPath()
  ctx.rect(640, 520, 50, 160)
  outline(ctx)
  ctx.beginPath()
  ctx.arc(665, 440, 95, Math.PI * 0.62, Math.PI * 2.38)
  outline(ctx)
  for (const [x, y] of [[625, 410], [700, 450], [655, 480], [690, 395]]) {
    ctx.beginPath()
    ctx.arc(x, y, 14, 0, Math.PI * 2)
    outline(ctx, 4)
  }
  // flowers
  for (const [x, y] of [[90, 790], [500, 800], [820, 780], [300, 860], [680, 880]]) {
    ctx.beginPath()
    ctx.moveTo(x, y + 26)
    ctx.lineTo(x, y + 90)
    outline(ctx, 5)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2
      ctx.beginPath()
      ctx.arc(x + Math.cos(a) * 24, y + Math.sin(a) * 24, 16, 0, Math.PI * 2)
      outline(ctx, 4)
    }
    ctx.beginPath()
    ctx.arc(x, y, 13, 0, Math.PI * 2)
    ctx.fillStyle = "#fff"
    ctx.fill()
    outline(ctx, 4)
  }
}

// Paint a background onto ctx (already scaled to logical pixels)
export const drawTemplate = (ctx, id) => {
  ctx.save()
  ctx.fillStyle = id === "lined" ? "#fffdf3" : "#ffffff"
  ctx.fillRect(0, 0, CANVAS, CANVAS)
  if (id === "lined") {
    ctx.strokeStyle = "#a9c7ec"
    ctx.lineWidth = 2
    for (let y = 120; y < CANVAS; y += 48) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(CANVAS, y)
      ctx.stroke()
    }
    ctx.strokeStyle = "#f19aa8"
    ctx.beginPath()
    ctx.moveTo(110, 0)
    ctx.lineTo(110, CANVAS)
    ctx.stroke()
    for (const y of [240, 480, 720]) {
      ctx.beginPath()
      ctx.arc(45, y, 16, 0, Math.PI * 2)
      ctx.fillStyle = "#e8e2d4"
      ctx.fill()
    }
  } else if (id === "heart") {
    heartPath(ctx, CANVAS / 2, CANVAS / 2 + 10, 700)
    outline(ctx, 8)
    for (const [x, y, s] of [[120, 130, 70], [840, 150, 60], [130, 840, 56], [830, 820, 74]]) {
      heartPath(ctx, x, y, s)
      outline(ctx, 5)
    }
  } else if (id === "coloring") coloringPage(ctx)
  ctx.restore()
}

// ---------- strokes ----------

const mid = (p, i) => [(p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2]

const strokeStyle = (ctx, op) => {
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.lineWidth = op.t === "pencil" ? PENCIL_WIDTH : op.w
  ctx.strokeStyle = op.c
  ctx.fillStyle = op.c
  ctx.globalCompositeOperation = op.t === "eraser" ? "destination-out" : "source-over"
}

// Draw a stroke's points from point index `from` (0 = the start) up to what it has now.
// Smooth: curves through the midpoints, each point the control. The tail (from the last
// midpoint to the last point) waits for the stroke to end (drawStrokeEnd), so drawing a
// stroke bit by bit and drawing it all at once give the same picture.
export const drawStrokePart = (ctx, op, from) => {
  const p = op.p
  const n = p.length / 2
  if (!n) return
  ctx.save()
  strokeStyle(ctx, op)
  if (from === 0) {
    // a dot where it starts (a tap leaves a dot)
    ctx.beginPath()
    ctx.arc(p[0], p[1], ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.beginPath()
  let started = false
  for (let i = Math.max(1, from); i < n; i++) {
    // segment i: from the midpoint before point i-1 (or the first point) to the midpoint
    // of points i-1 and i, curving through point i-1
    const a = i === 1 ? [p[0], p[1]] : mid(p, (i - 2) * 2)
    const b = mid(p, (i - 1) * 2)
    if (!started) {
      ctx.moveTo(a[0], a[1])
      started = true
    }
    ctx.quadraticCurveTo(p[(i - 1) * 2], p[(i - 1) * 2 + 1], b[0], b[1])
  }
  if (started) ctx.stroke()
  ctx.restore()
}

export const drawStrokeEnd = (ctx, op) => {
  const p = op.p
  const n = p.length / 2
  if (n < 2) return
  ctx.save()
  strokeStyle(ctx, op)
  ctx.beginPath()
  const a = mid(p, (n - 2) * 2)
  ctx.moveTo(a[0], a[1])
  ctx.lineTo(p[(n - 1) * 2], p[(n - 1) * 2 + 1])
  ctx.stroke()
  ctx.restore()
}

// ---------- the paint bucket ----------

const hexRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}

// Fill the area around (x, y) (logical pixels) on `ink`, judging edges by what you see:
// the background and the ink together. Close colors count as the same (antialiased
// edges), and the fill reaches one pixel past its edge so no pale fringe is left.
export const floodFill = (inkCtx, bgCtx, x, y, color) => {
  const W = inkCtx.canvas.width
  const H = inkCtx.canvas.height
  const sx = Math.floor((x / CANVAS) * W)
  const sy = Math.floor((y / CANVAS) * H)
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return
  const ink = inkCtx.getImageData(0, 0, W, H)
  const bg = bgCtx.getImageData(0, 0, W, H)
  const d = ink.data
  const b = bg.data
  // what each pixel looks like: ink over the background
  const seen = new Uint8ClampedArray(W * H * 3)
  for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
    const a = d[i + 3] / 255
    seen[j] = d[i] * a + b[i] * (1 - a)
    seen[j + 1] = d[i + 1] * a + b[i + 1] * (1 - a)
    seen[j + 2] = d[i + 2] * a + b[i + 2] * (1 - a)
  }
  const start = (sy * W + sx) * 3
  const [r0, g0, b0] = [seen[start], seen[start + 1], seen[start + 2]]
  const [fr, fg, fb] = hexRgb(color)
  const tolerance = 70
  const same = (p) => {
    const j = p * 3
    return Math.abs(seen[j] - r0) + Math.abs(seen[j + 1] - g0) + Math.abs(seen[j + 2] - b0) <= tolerance
  }
  const mark = new Uint8Array(W * H)
  const stack = [sy * W + sx]
  mark[sy * W + sx] = 1
  let filled = 0
  while (stack.length) {
    const p = stack.pop()
    filled++
    const px = p % W
    const py = (p - px) / W
    if (px > 0 && !mark[p - 1] && same(p - 1)) (mark[p - 1] = 1), stack.push(p - 1)
    if (px < W - 1 && !mark[p + 1] && same(p + 1)) (mark[p + 1] = 1), stack.push(p + 1)
    if (py > 0 && !mark[p - W] && same(p - W)) (mark[p - W] = 1), stack.push(p - W)
    if (py < H - 1 && !mark[p + W] && same(p + W)) (mark[p + W] = 1), stack.push(p + W)
  }
  // grow by a pixel into the edge
  const grow = new Uint8Array(mark)
  for (let p = 0; p < W * H; p++) {
    if (!mark[p]) continue
    const px = p % W
    if (px > 0) grow[p - 1] = 1
    if (px < W - 1) grow[p + 1] = 1
    if (p >= W) grow[p - W] = 1
    if (p < W * (H - 1)) grow[p + W] = 1
  }
  for (let p = 0; p < W * H; p++) {
    if (!grow[p]) continue
    const i = p * 4
    // keep dark outlines dark: an edge pixel only takes the color if it was light
    if (!mark[p]) {
      const j = p * 3
      if (seen[j] + seen[j + 1] + seen[j + 2] < 240) continue
    }
    d[i] = fr
    d[i + 1] = fg
    d[i + 2] = fb
    d[i + 3] = 255
  }
  inkCtx.putImageData(ink, 0, 0)
  return filled
}

// ---------- everything ----------

// Draw one finished op (or what there is of a stroke so far) onto the ink
export const drawOp = (inkCtx, bgCtx, op) => {
  if (op.k === "s") {
    drawStrokePart(inkCtx, op, 0)
    if (op.end) drawStrokeEnd(inkCtx, op)
  } else if (op.k === "f") floodFill(inkCtx, bgCtx, op.x, op.y, op.c)
  else if (op.k === "k") drawSticker(inkCtx, op.n, op.x, op.y, op.s, op.c)
}

// Start a canvas pair scaled to logical pixels
export const scaled = (canvas) => {
  canvas.width = PX
  canvas.height = PX
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  ctx.setTransform(PX / CANVAS, 0, 0, PX / CANVAS, 0, 0)
  return ctx
}
