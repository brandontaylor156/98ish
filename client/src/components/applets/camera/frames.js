// Frames and stickers drawn over a photo with the canvas 2D API: the same drawing at any
// size (everything is measured from the picture's short side), so the preview and the
// saved photo match. All original art.

export const FRAMES = [
  { id: "none", label: "No Frame" },
  { id: "instant", label: "Instant Photo" },
  { id: "film", label: "Film Strip" },
  { id: "window", label: "98ish Window" },
  { id: "camcorder", label: "Camcorder" },
  { id: "hearts", label: "Hearts" },
  { id: "stars", label: "Sparkles" },
  { id: "party", label: "Party Time" },
  { id: "gold", label: "Gold Frame" },
]

export const frameLabel = (id) => FRAMES.find((f) => f.id === id)?.label || "No Frame"

const pad2 = (n) => String(n).padStart(2, "0")
// "OCT 03 2026" and "2:05 PM"
const stamp = (date) => {
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][date.getMonth()]
  const h = date.getHours()
  return { day: `${month} ${pad2(date.getDate())} ${date.getFullYear()}`, time: `${h % 12 || 12}:${pad2(date.getMinutes())} ${h < 12 ? "AM" : "PM"}` }
}

const heart = (ctx, x, y, size, fill) => {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 32, size / 32)
  ctx.beginPath()
  ctx.moveTo(0, 10)
  ctx.bezierCurveTo(-16, 0, -14, -14, 0, -6)
  ctx.bezierCurveTo(14, -14, 16, 0, 0, 10)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = "rgba(90, 10, 40, 0.8)"
  ctx.stroke()
  ctx.restore()
}

const sparkle = (ctx, x, y, r, fill) => {
  ctx.save()
  ctx.translate(x, y)
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    const len = i % 2 ? r * 0.32 : r
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len)
  }
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.shadowColor = "rgba(255, 255, 255, 0.9)"
  ctx.shadowBlur = r * 0.6
  ctx.fill()
  ctx.restore()
}

// a fixed scatter of points along the edges (the same every time)
const edgeSpots = (w, h, count, seed = 7) => {
  let s = seed
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const spots = []
  for (let i = 0; i < count; i++) {
    const side = i % 4
    const along = rand()
    const inset = rand() * 0.12
    const x = side === 0 ? along * w : side === 1 ? w * (1 - inset) : side === 2 ? along * w : w * inset
    const y = side === 0 ? h * inset : side === 2 ? h * (1 - inset) : along * h
    spots.push({ x, y, r: rand() })
  }
  return spots
}

const draw = {
  instant(ctx, w, h, u, date) {
    const side = Math.round(w * 0.05)
    const bottom = Math.round(h * 0.17)
    ctx.fillStyle = "#fbfaf5"
    ctx.fillRect(0, 0, w, side)
    ctx.fillRect(0, 0, side, h)
    ctx.fillRect(w - side, 0, side, h)
    ctx.fillRect(0, h - bottom, w, bottom)
    ctx.strokeStyle = "rgba(0, 0, 0, 0.18)"
    ctx.lineWidth = Math.max(1, u)
    ctx.strokeRect(side, side, w - side * 2, h - side - bottom)
    ctx.fillStyle = "#2b3a8c"
    ctx.font = `italic ${Math.round(bottom * 0.38)}px "Comic Sans MS", "Segoe Print", cursive`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(`98ish  ${stamp(date).day.toLowerCase()}`, w / 2, h - bottom / 2)
  },
  film(ctx, w, h, u) {
    const bar = Math.round(w * 0.075)
    ctx.fillStyle = "#141414"
    ctx.fillRect(0, 0, bar, h)
    ctx.fillRect(w - bar, 0, bar, h)
    const hole = bar * 0.45
    ctx.fillStyle = "#e8e2d0"
    for (let y = hole * 0.6; y < h; y += hole * 1.9) {
      for (const x of [(bar - hole) / 2, w - bar + (bar - hole) / 2]) {
        ctx.beginPath()
        ctx.roundRect ? ctx.roundRect(x, y, hole, hole * 1.2, hole * 0.2) : ctx.rect(x, y, hole, hole * 1.2)
        ctx.fill()
      }
    }
    ctx.save()
    ctx.fillStyle = "#ff9a1f"
    ctx.font = `bold ${Math.round(bar * 0.42)}px "Courier New", monospace`
    ctx.translate(w - bar * 0.25, h * 0.75)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText("98ISH 400  24A", 0, 0)
    ctx.restore()
  },
  window(ctx, w, h, u) {
    const border = Math.max(3, Math.round(4 * u))
    const title = Math.round(22 * u)
    ctx.fillStyle = "#c0c0c0"
    ctx.fillRect(0, 0, w, border + title)
    ctx.fillRect(0, 0, border, h)
    ctx.fillRect(w - border, 0, border, h)
    ctx.fillRect(0, h - border, w, border)
    const g = ctx.createLinearGradient(border, 0, w - border, 0)
    g.addColorStop(0, "#000080")
    g.addColorStop(1, "#1084d0")
    ctx.fillStyle = g
    ctx.fillRect(border, border, w - border * 2, title - 2 * u)
    ctx.fillStyle = "#fff"
    ctx.font = `bold ${Math.round(13 * u)}px Tahoma, Arial, sans-serif`
    ctx.textBaseline = "middle"
    ctx.textAlign = "left"
    ctx.fillText("Me.bmp - 98ish Camera", border + 6 * u, border + (title - 2 * u) / 2)
    const bs = title - 6 * u
    for (let i = 0; i < 3; i++) {
      const x = w - border - 3 * u - (3 - i) * (bs + 2 * u)
      const y = border + 2 * u
      ctx.fillStyle = "#c0c0c0"
      ctx.fillRect(x, y, bs, bs - 2 * u)
      ctx.fillStyle = "#fff"
      ctx.fillRect(x, y, bs, u)
      ctx.fillRect(x, y, u, bs - 2 * u)
      ctx.fillStyle = "#000"
      ctx.fillRect(x, y + bs - 3 * u, bs, u)
      ctx.fillRect(x + bs - u, y, u, bs - 2 * u)
      ctx.fillStyle = "#000"
      const m = bs * 0.3
      if (i === 0) ctx.fillRect(x + m, y + bs - m - 2 * u, bs - m * 2, 2 * u)
      if (i === 1) {
        ctx.strokeStyle = "#000"
        ctx.lineWidth = u
        ctx.strokeRect(x + m, y + m * 0.8, bs - m * 2, bs - m * 2)
      }
      if (i === 2) {
        ctx.strokeStyle = "#000"
        ctx.lineWidth = 1.6 * u
        ctx.beginPath()
        ctx.moveTo(x + m, y + m * 0.8)
        ctx.lineTo(x + bs - m, y + bs - m * 1.6)
        ctx.moveTo(x + bs - m, y + m * 0.8)
        ctx.lineTo(x + m, y + bs - m * 1.6)
        ctx.stroke()
      }
    }
  },
  camcorder(ctx, w, h, u, date) {
    const m = 18 * u
    const len = 26 * u
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)"
    ctx.lineWidth = 2.5 * u
    for (const [x, y, sx, sy] of [
      [m, m, 1, 1],
      [w - m, m, -1, 1],
      [m, h - m, 1, -1],
      [w - m, h - m, -1, -1],
    ]) {
      ctx.beginPath()
      ctx.moveTo(x, y + sy * len)
      ctx.lineTo(x, y)
      ctx.lineTo(x + sx * len, y)
      ctx.stroke()
    }
    const size = Math.round(17 * u)
    ctx.font = `bold ${size}px "Courier New", monospace`
    ctx.textBaseline = "top"
    ctx.shadowColor = "rgba(0,0,0,0.8)"
    ctx.shadowBlur = 2 * u
    ctx.fillStyle = "#ff2020"
    ctx.beginPath()
    ctx.arc(m + 14 * u, m + 12 * u + size / 2 - 2 * u, 6 * u, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "#fff"
    ctx.textAlign = "left"
    ctx.fillText("REC", m + 26 * u, m + 10 * u)
    ctx.textAlign = "right"
    ctx.fillText("SP", w - m - 10 * u, m + 10 * u)
    // battery
    const bx = w - m - 64 * u
    ctx.strokeStyle = "#fff"
    ctx.lineWidth = 1.5 * u
    ctx.strokeRect(bx, m + 12 * u, 22 * u, 11 * u)
    ctx.fillStyle = "#fff"
    ctx.fillRect(bx + 22 * u, m + 15 * u, 3 * u, 5 * u)
    ctx.fillRect(bx + 3 * u, m + 15 * u, 11 * u, 5 * u)
    const { day, time } = stamp(date)
    ctx.textAlign = "left"
    ctx.textBaseline = "bottom"
    ctx.fillText(time, m + 10 * u, h - m - 10 * u - size * 1.1)
    ctx.fillText(day, m + 10 * u, h - m - 10 * u)
    ctx.shadowBlur = 0
  },
  hearts(ctx, w, h, u) {
    const colors = ["#ff5e8a", "#ff8fb1", "#e0457b", "#ffc2d4"]
    edgeSpots(w, h, 22, 11).forEach((s, i) => heart(ctx, s.x, s.y, (22 + s.r * 26) * u, colors[i % colors.length]))
    heart(ctx, w - 46 * u, h - 46 * u, 70 * u, "#ff3d73")
  },
  stars(ctx, w, h, u) {
    const colors = ["#fff7a8", "#ffffff", "#b8f3ff", "#ffd1f5"]
    edgeSpots(w, h, 26, 23).forEach((s, i) => sparkle(ctx, s.x, s.y, (7 + s.r * 14) * u, colors[i % colors.length]))
  },
  party(ctx, w, h, u) {
    const colors = ["#ff4f4f", "#ffd23f", "#3fc1ff", "#7dff6a", "#d36bff", "#ff8a3d"]
    let s = 5
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 90; i++) {
      const x = rand() * w
      const yy = rand()
      // mostly along the top and bottom
      const y = yy < 0.5 ? yy * 0.36 * h : h - (yy - 0.5) * 0.36 * h
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(rand() * Math.PI)
      ctx.fillStyle = colors[i % colors.length]
      ctx.fillRect(-4 * u, -2 * u, 8 * u, 4 * u)
      ctx.restore()
    }
    // a banner
    const bh = 34 * u
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)"
    ctx.fillRect(0, h - bh - 10 * u, w, bh)
    ctx.fillStyle = "#d4145a"
    ctx.font = `bold ${Math.round(22 * u)}px "Comic Sans MS", "Arial Black", sans-serif`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("★ PARTY TIME ★", w / 2, h - bh / 2 - 10 * u)
  },
  gold(ctx, w, h, u) {
    const b = Math.round(Math.min(w, h) * 0.07)
    const g = ctx.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, "#7a5410")
    g.addColorStop(0.25, "#f6d77a")
    g.addColorStop(0.5, "#a8781e")
    g.addColorStop(0.75, "#ffe9a3")
    g.addColorStop(1, "#6b4608")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, b)
    ctx.fillRect(0, h - b, w, b)
    ctx.fillRect(0, 0, b, h)
    ctx.fillRect(w - b, 0, b, h)
    ctx.strokeStyle = "rgba(60, 35, 0, 0.7)"
    ctx.lineWidth = 2 * u
    ctx.strokeRect(b * 0.35, b * 0.35, w - b * 0.7, h - b * 0.7)
    ctx.strokeRect(b, b, w - b * 2, h - b * 2)
    for (const [x, y] of [
      [b / 2, b / 2],
      [w - b / 2, b / 2],
      [b / 2, h - b / 2],
      [w - b / 2, h - b / 2],
    ]) {
      ctx.fillStyle = "#fff3c4"
      ctx.beginPath()
      ctx.arc(x, y, b * 0.28, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  },
}

// Draw a frame over a w x h picture on ctx
export const drawFrame = (ctx, id, w, h, date = new Date()) => {
  const fn = draw[id]
  if (!fn) return
  const u = Math.min(w, h) / 360
  ctx.save()
  fn(ctx, w, h, u, date)
  ctx.restore()
}
