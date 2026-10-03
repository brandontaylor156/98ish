import { fit2d, num, rand } from "./util"
import { parseMessages } from "./lovenotesText"

// Love Notes: pastel hearts floating up with a few twinkles, and your own short messages
// (typed in its Settings, one per line) fading in one at a time. Messages are drawn as
// canvas text, never HTML.

export { parseMessages }

export const PALETTES = {
  pink: ["#ff8fb1", "#ffb3c8", "#ff6f91", "#ffd1e0", "#ff9ec4"],
  rainbow: ["#ff9aa2", "#ffb7a8", "#ffe29a", "#b5ead7", "#a8d8ff", "#c7b8ff", "#f5b0ff"],
  red: ["#ff4d6d", "#ff758f", "#e0234e", "#ff8fa3", "#ffb3c1"],
  lilac: ["#c8b6ff", "#b8c0ff", "#e7c6ff", "#ffd6ff", "#a99bff"],
}

const FONT = '"Comic Sans MS", "Segoe Print", "Bradley Hand", "Chalkboard SE", cursive'

// a heart centered on (0, 0), about s wide
const heartPath = (ctx, s) => {
  ctx.beginPath()
  ctx.moveTo(0, s * 0.3)
  ctx.bezierCurveTo(-s * 0.05, s * 0.26, -s * 0.5, 0, -s * 0.5, -s * 0.16)
  ctx.bezierCurveTo(-s * 0.5, -s * 0.42, -s * 0.12, -s * 0.48, 0, -s * 0.22)
  ctx.bezierCurveTo(s * 0.12, -s * 0.48, s * 0.5, -s * 0.42, s * 0.5, -s * 0.16)
  ctx.bezierCurveTo(s * 0.5, 0, s * 0.05, s * 0.26, 0, s * 0.3)
  ctx.closePath()
}

// lighter version of a #rrggbb color, for the background glow
const lighten = (hex, k) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex))
  const n = m ? parseInt(m[1], 16) : 0x3a2350
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export default function createLoveNotes(canvas, opts, env) {
  const ctx = canvas.getContext("2d", { alpha: false })
  const messages = parseMessages(opts.messages)
  const colors = PALETTES[opts.palette] || PALETTES.pink
  const speed = num(opts.speed, 5, 1, 10)
  const pace = 0.4 + speed * 0.12
  // never a black screen: a pure black choice still gets a soft glow
  const background = /^#[0-9a-f]{6}$/i.test(opts.background || "") ? opts.background : "#3a2350"

  let w = 1
  let h = 1
  let unit = 1
  let bg = null

  const MAX_HEARTS = env.preview ? 16 : 46
  const hearts = []
  const spawnHeart = (anywhere) => ({
    x: Math.random(),
    y: anywhere ? Math.random() : 1.1,
    size: rand(0.5, 1.6),
    color: colors[Math.floor(Math.random() * colors.length)],
    sway: rand(0, 6.28),
    rise: rand(0.6, 1.3),
    spin: rand(-0.25, 0.25),
    alpha: rand(0.55, 0.95),
  })
  for (let i = 0; i < MAX_HEARTS; i++) hearts.push(spawnHeart(true))

  const MAX_TWINKLES = env.preview ? 10 : 30
  const twinkles = Array.from({ length: MAX_TWINKLES }, () => ({ x: Math.random(), y: Math.random(), ph: rand(0, 6.28), s: rand(0.5, 1) }))

  // the message showing now: fades in, holds, drifts up a little, fades out
  let index = Math.floor(Math.random() * messages.length)
  let age = 0
  let lines = []
  let spot = { x: 0.5, y: 0.5 }
  const IN = 1.2
  const HOLD = 4.5
  const OUT = 1.2
  let fontSize = 20

  const layout = () => {
    fontSize = Math.round(Math.min(w, h) * (env.preview ? 0.1 : 0.065))
    ctx.font = `bold ${fontSize}px ${FONT}`
    const max = w * 0.8
    lines = []
    let line = ""
    for (const word of messages[index].split(" ")) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width > max && line) {
        lines.push(line)
        line = word
      } else line = next
    }
    if (line) lines.push(line)
  }
  const nextMessage = () => {
    if (messages.length > 1) {
      let i = index
      while (i === index) i = Math.floor(Math.random() * messages.length)
      index = i
    }
    age = 0
    spot = { x: rand(0.42, 0.58), y: rand(0.35, 0.62) }
    layout()
  }

  const drawSparkle = (x, y, s) => {
    ctx.beginPath()
    ctx.moveTo(x, y - s)
    ctx.quadraticCurveTo(x + s * 0.18, y - s * 0.18, x + s, y)
    ctx.quadraticCurveTo(x + s * 0.18, y + s * 0.18, x, y + s)
    ctx.quadraticCurveTo(x - s * 0.18, y + s * 0.18, x - s, y)
    ctx.quadraticCurveTo(x - s * 0.18, y - s * 0.18, x, y - s)
    ctx.fill()
  }

  return {
    resize(cssW, cssH, ratio) {
      const s = fit2d(canvas, cssW, cssH, ratio)
      w = s.width
      h = s.height
      unit = Math.max(8, Math.min(w, h) * (env.preview ? 0.09 : 0.055))
      const g = ctx.createRadialGradient(w / 2, h * 0.55, 0, w / 2, h * 0.55, Math.max(w, h) * 0.75)
      g.addColorStop(0, lighten(background, 0.22))
      g.addColorStop(1, lighten(background, 0.04))
      bg = g
      if (!lines.length) nextMessage()
      else layout()
    },
    frame(dt) {
      const step = dt * pace
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)

      // twinkles
      ctx.fillStyle = "#fff"
      for (const t of twinkles) {
        t.ph += step * 2.5
        // each twinkle shows once, then pops up somewhere else
        if (t.ph > 6.28) {
          t.ph -= 6.28
          t.x = Math.random()
          t.y = Math.random()
        }
        const a = Math.max(0, Math.sin(t.ph))
        if (a < 0.05) continue
        ctx.globalAlpha = a * 0.9
        drawSparkle(t.x * w, t.y * h, unit * 0.18 * t.s * (0.6 + a * 0.4))
      }

      // hearts float up and sway
      for (const p of hearts) {
        p.y -= p.rise * step * 0.07
        p.sway += step * 1.2
        if (p.y < -0.1) Object.assign(p, spawnHeart(false))
        const s = unit * p.size * (1 + Math.sin(p.sway * 2) * 0.04)
        ctx.save()
        ctx.globalAlpha = p.alpha
        ctx.translate(p.x * w + Math.sin(p.sway) * unit * 0.6, p.y * h)
        ctx.rotate(Math.sin(p.sway) * p.spin)
        ctx.fillStyle = p.color
        heartPath(ctx, s)
        ctx.fill()
        ctx.fillStyle = "rgba(255,255,255,.55)"
        ctx.beginPath()
        ctx.ellipse(-s * 0.24, -s * 0.2, s * 0.09, s * 0.06, -0.6, 0, 6.28)
        ctx.fill()
        ctx.restore()
      }
      ctx.globalAlpha = 1

      // the message
      age += step
      if (age > IN + HOLD + OUT) nextMessage()
      const alpha = age < IN ? age / IN : age > IN + HOLD ? Math.max(0, 1 - (age - IN - HOLD) / OUT) : 1
      const lift = age * unit * 0.12
      const lineH = fontSize * 1.25
      const cx = spot.x * w
      const top = spot.y * h - ((lines.length - 1) * lineH) / 2 - lift
      ctx.globalAlpha = alpha
      ctx.font = `bold ${fontSize}px ${FONT}`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.lineJoin = "round"
      ctx.lineWidth = Math.max(3, fontSize * 0.22)
      ctx.strokeStyle = colors[0]
      ctx.shadowColor = "rgba(255,255,255,.55)"
      ctx.shadowBlur = fontSize * 0.5
      lines.forEach((line, i) => ctx.strokeText(line, cx, top + i * lineH))
      ctx.shadowBlur = 0
      ctx.fillStyle = "#fff"
      lines.forEach((line, i) => ctx.fillText(line, cx, top + i * lineH))
      // a little heart on each side of the first line
      const half = Math.min(w * 0.45, ctx.measureText(lines[0] || "").width / 2 + fontSize * 0.9)
      for (const side of [-1, 1]) {
        ctx.save()
        ctx.translate(cx + side * half, top)
        ctx.rotate(side * 0.25)
        ctx.fillStyle = colors[2 % colors.length]
        heartPath(ctx, fontSize * 0.9 * (1 + Math.sin(age * 4) * 0.08))
        ctx.fill()
        ctx.restore()
      }
      ctx.globalAlpha = 1
    },
    dispose() {
      bg = null
    },
  }
}
