// Little drawings shared by Photo Puzzle and Doodle Together: hearts, stars, flowers and
// smiles (stickers, confetti), and the built-in sample pictures for puzzles. All drawn
// with canvas paths, no image files.

import { rng } from "./jigsaw.js"

// A heart centered on (x, y), `size` across
export const heartPath = (ctx, x, y, size) => {
  const s = size / 2
  ctx.beginPath()
  ctx.moveTo(x, y + s * 0.95)
  ctx.bezierCurveTo(x - s * 0.15, y + s * 0.8, x - s, y + s * 0.25, x - s, y - s * 0.25)
  ctx.bezierCurveTo(x - s, y - s * 0.75, x - s * 0.45, y - s * 0.95, x, y - s * 0.5)
  ctx.bezierCurveTo(x + s * 0.45, y - s * 0.95, x + s, y - s * 0.75, x + s, y - s * 0.25)
  ctx.bezierCurveTo(x + s, y + s * 0.25, x + s * 0.15, y + s * 0.8, x, y + s * 0.95)
  ctx.closePath()
}

export const starPath = (ctx, x, y, size, points = 5) => {
  const outer = size / 2
  const inner = outer * 0.45
  ctx.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer
    const a = -Math.PI / 2 + (i * Math.PI) / points
    const px = x + Math.cos(a) * r
    const py = y + Math.sin(a) * r
    if (i) ctx.lineTo(px, py)
    else ctx.moveTo(px, py)
  }
  ctx.closePath()
}

const shade = (hex, amount) => {
  const n = parseInt(hex.slice(1), 16)
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + amount * 255)))
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`
}

// Stickers: drawn filled with a darker outline and a shine
export const drawSticker = (ctx, kind, x, y, size, color = "#e0457b") => {
  ctx.save()
  ctx.lineJoin = "round"
  ctx.lineWidth = Math.max(1.5, size / 22)
  if (kind === "heart") {
    heartPath(ctx, x, y, size)
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = shade(color, -0.25)
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(x - size * 0.22, y - size * 0.18, size * 0.1, size * 0.06, -0.6, 0, Math.PI * 2)
    ctx.fillStyle = "rgba(255,255,255,0.7)"
    ctx.fill()
  } else if (kind === "star") {
    starPath(ctx, x, y, size)
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = shade(color, -0.25)
    ctx.stroke()
    starPath(ctx, x - size * 0.06, y - size * 0.05, size * 0.35)
    ctx.fillStyle = "rgba(255,255,255,0.45)"
    ctx.fill()
  } else if (kind === "flower") {
    const petals = 6
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2
      ctx.beginPath()
      ctx.ellipse(x + Math.cos(a) * size * 0.24, y + Math.sin(a) * size * 0.24, size * 0.2, size * 0.13, a, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.strokeStyle = shade(color, -0.22)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(x, y, size * 0.14, 0, Math.PI * 2)
    ctx.fillStyle = "#ffd23f"
    ctx.fill()
    ctx.strokeStyle = "#c98a00"
    ctx.stroke()
  } else if (kind === "smile") {
    ctx.beginPath()
    ctx.arc(x, y, size * 0.45, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = shade(color, -0.3)
    ctx.stroke()
    ctx.fillStyle = "#3a2330"
    for (const dx of [-0.15, 0.15]) {
      ctx.beginPath()
      ctx.ellipse(x + dx * size, y - size * 0.1, size * 0.045, size * 0.07, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.beginPath()
    ctx.arc(x, y + size * 0.02, size * 0.22, 0.15 * Math.PI, 0.85 * Math.PI)
    ctx.strokeStyle = "#3a2330"
    ctx.lineWidth = Math.max(1.5, size / 16)
    ctx.lineCap = "round"
    ctx.stroke()
    ctx.fillStyle = "rgba(255,120,150,0.55)"
    for (const dx of [-0.27, 0.27]) {
      ctx.beginPath()
      ctx.ellipse(x + dx * size, y + size * 0.08, size * 0.07, size * 0.045, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

// ---------- sample pictures ----------

const cloud = (ctx, x, y, s, color = "rgba(255,255,255,0.92)") => {
  ctx.fillStyle = color
  ctx.beginPath()
  for (const [dx, dy, r] of [[0, 0, 1], [0.9, -0.35, 0.8], [1.8, 0, 0.9], [0.9, 0.25, 0.85], [-0.8, 0.15, 0.7], [2.6, 0.2, 0.6]]) {
    ctx.moveTo(x + dx * s + r * s, y + dy * s)
    ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2)
  }
  ctx.fill()
}

const sky = (ctx, w, h, stops) => {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  stops.forEach(([at, color]) => g.addColorStop(at, color))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

const hills = (ctx, w, base, amp, color, phase, random) => {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, ctx.canvas.height)
  for (let x = 0; x <= w; x += 8) ctx.lineTo(x, base + Math.sin(x / 140 + phase) * amp + Math.sin(x / 47 + phase * 2) * amp * 0.25 + random() * 2)
  ctx.lineTo(w, ctx.canvas.height)
  ctx.closePath()
  ctx.fill()
}

const SAMPLE_DRAW = {
  // a pink sunset over the sea, with two heart balloons
  sunset: (ctx, w, h, random) => {
    sky(ctx, w, h, [[0, "#3b2a6b"], [0.35, "#c45b9c"], [0.62, "#ff9f7a"], [0.7, "#ffd59e"]])
    // sun
    const sun = ctx.createRadialGradient(w * 0.5, h * 0.66, 10, w * 0.5, h * 0.66, w * 0.2)
    sun.addColorStop(0, "#fff4c2")
    sun.addColorStop(0.5, "#ffd36e")
    sun.addColorStop(1, "rgba(255,180,90,0)")
    ctx.fillStyle = sun
    ctx.fillRect(0, 0, w, h)
    ctx.beginPath()
    ctx.arc(w * 0.5, h * 0.67, w * 0.09, 0, Math.PI * 2)
    ctx.fillStyle = "#ffe08a"
    ctx.fill()
    for (let i = 0; i < 5; i++) cloud(ctx, random() * w, h * (0.08 + random() * 0.35), 18 + random() * 22, `rgba(255,${200 + random() * 40},${210 + random() * 30},0.55)`)
    // sea with sparkles
    const sea = ctx.createLinearGradient(0, h * 0.7, 0, h)
    sea.addColorStop(0, "#d97aa7")
    sea.addColorStop(1, "#2c2a63")
    ctx.fillStyle = sea
    ctx.fillRect(0, h * 0.7, w, h * 0.3)
    for (let i = 0; i < 70; i++) {
      const y = h * 0.71 + random() * h * 0.28
      const len = 10 + random() * 40 * (1 - (y - h * 0.7) / (h * 0.3))
      ctx.fillStyle = `rgba(255, 230, 170, ${0.25 + random() * 0.5})`
      ctx.fillRect(w * 0.5 + (random() - 0.5) * w * (0.2 + (y - h * 0.7) / h), y, len, 2)
    }
    // a little sailboat
    ctx.fillStyle = "#3a2147"
    ctx.beginPath()
    ctx.moveTo(w * 0.18, h * 0.75)
    ctx.lineTo(w * 0.27, h * 0.75)
    ctx.lineTo(w * 0.25, h * 0.77)
    ctx.lineTo(w * 0.2, h * 0.77)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(w * 0.225, h * 0.745)
    ctx.lineTo(w * 0.225, h * 0.62)
    ctx.lineTo(w * 0.265, h * 0.74)
    ctx.fill()
    // heart balloons on strings
    for (const [x, y, s, c] of [[0.72, 0.28, 120, "#ff4f86"], [0.82, 0.38, 90, "#ff8fb3"]]) {
      ctx.strokeStyle = "rgba(60,30,60,0.6)"
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(w * x, h * y + s * 0.47)
      ctx.quadraticCurveTo(w * x - 30, h * y + s * 1.4, w * x - 10, h * 0.78)
      ctx.stroke()
      drawSticker(ctx, "heart", w * x, h * y, s, c)
    }
  },
  // a garden full of flowers and two butterflies
  garden: (ctx, w, h, random) => {
    sky(ctx, w, h, [[0, "#7cc7ff"], [0.5, "#c9ecff"], [0.55, "#e9f9ff"]])
    for (let i = 0; i < 4; i++) cloud(ctx, random() * w, 40 + random() * h * 0.2, 20 + random() * 18)
    ctx.beginPath()
    ctx.arc(w * 0.86, h * 0.14, 50, 0, Math.PI * 2)
    ctx.fillStyle = "#ffe066"
    ctx.fill()
    hills(ctx, w, h * 0.5, 30, "#8fd16a", 1, random)
    hills(ctx, w, h * 0.6, 26, "#5fb84a", 3, random)
    hills(ctx, w, h * 0.72, 20, "#3f9a3a", 5, random)
    const colors = ["#ff5e8a", "#ffb03b", "#b56cff", "#ff7bd0", "#ffffff", "#ff6b5e", "#62a8ff"]
    for (let i = 0; i < 70; i++) {
      const y = h * 0.6 + random() * h * 0.4
      const x = random() * w
      const s = 12 + ((y - h * 0.6) / (h * 0.4)) * 40
      ctx.strokeStyle = "#2f7a2a"
      ctx.lineWidth = Math.max(1.5, s / 10)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + (random() - 0.5) * 6, y + s * 1.2)
      ctx.stroke()
      drawSticker(ctx, "flower", x, y, s * 1.4, colors[Math.floor(random() * colors.length)])
    }
    // butterflies
    for (const [x, y, c] of [[0.3, 0.35, "#ff7a1a"], [0.62, 0.28, "#5d6bff"]]) {
      ctx.save()
      ctx.translate(w * x, h * y)
      ctx.fillStyle = c
      for (const side of [-1, 1]) {
        ctx.beginPath()
        ctx.ellipse(side * 16, -8, 16, 12, side * 0.5, 0, Math.PI * 2)
        ctx.ellipse(side * 12, 10, 10, 8, side * -0.4, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = "#3a2a1a"
      ctx.fillRect(-2, -14, 4, 28)
      ctx.restore()
    }
  },
  // hot air balloons over the mountains
  balloons: (ctx, w, h, random) => {
    sky(ctx, w, h, [[0, "#ffd1e8"], [0.5, "#ffe9d6"], [1, "#fff6e0"]])
    for (let i = 0; i < 6; i++) cloud(ctx, random() * w, 60 + random() * h * 0.5, 16 + random() * 26, "rgba(255,255,255,0.8)")
    const ridge = (base, amp, color, seed) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (let x = 0; x <= w; x += 20) ctx.lineTo(x, base - Math.abs(Math.sin(x / 160 + seed)) * amp - random() * 8)
      ctx.lineTo(w, h)
      ctx.fill()
    }
    ridge(h * 0.82, 150, "#b9a6e8", 1)
    ridge(h * 0.9, 110, "#8f7bd1", 2.5)
    ridge(h * 1.0, 70, "#6a58b0", 4)
    const balloon = (x, y, r, stripes) => {
      ctx.save()
      ctx.translate(x, y)
      // a round top with stripes, clipped
      ctx.beginPath()
      ctx.moveTo(-r * 0.35, r * 1.05)
      ctx.bezierCurveTo(-r * 1.3, r * 0.3, -r * 1.1, -r, 0, -r)
      ctx.bezierCurveTo(r * 1.1, -r, r * 1.3, r * 0.3, r * 0.35, r * 1.05)
      ctx.closePath()
      ctx.save()
      ctx.clip()
      const sw = (r * 2.4) / stripes.length
      stripes.forEach((c, i) => {
        ctx.fillStyle = c
        ctx.fillRect(-r * 1.2 + i * sw, -r * 1.1, sw + 1, r * 2.4)
      })
      const shine = ctx.createRadialGradient(-r * 0.4, -r * 0.5, 2, -r * 0.2, -r * 0.2, r * 1.3)
      shine.addColorStop(0, "rgba(255,255,255,0.45)")
      shine.addColorStop(1, "rgba(0,0,0,0.12)")
      ctx.fillStyle = shine
      ctx.fillRect(-r * 1.3, -r * 1.2, r * 2.6, r * 2.6)
      ctx.restore()
      ctx.strokeStyle = "rgba(60,40,40,0.7)"
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(-r * 0.33, r * 1.06)
      ctx.lineTo(-r * 0.2, r * 1.4)
      ctx.moveTo(r * 0.33, r * 1.06)
      ctx.lineTo(r * 0.2, r * 1.4)
      ctx.stroke()
      ctx.fillStyle = "#8a5a2b"
      ctx.fillRect(-r * 0.22, r * 1.38, r * 0.44, r * 0.3)
      ctx.restore()
    }
    balloon(w * 0.3, h * 0.36, 95, ["#ff5e7e", "#ffd23f", "#ff5e7e", "#ffd23f", "#ff5e7e"])
    balloon(w * 0.68, h * 0.24, 70, ["#5ec8ff", "#ffffff", "#5ec8ff", "#ffffff", "#5ec8ff"])
    balloon(w * 0.85, h * 0.52, 45, ["#9b6bff", "#ff9ed1", "#9b6bff", "#ff9ed1"])
    balloon(w * 0.12, h * 0.16, 32, ["#45c46b", "#fff07a", "#45c46b"])
  },
  // two cats on a hill under the stars
  stars: (ctx, w, h, random) => {
    sky(ctx, w, h, [[0, "#0d1240"], [0.6, "#2b2a7a"], [1, "#59439a"]])
    for (let i = 0; i < 220; i++) {
      const s = random() * 2.2 + 0.4
      ctx.fillStyle = `rgba(255,255,${200 + random() * 55},${0.5 + random() * 0.5})`
      ctx.fillRect(random() * w, random() * h * 0.75, s, s)
    }
    for (let i = 0; i < 8; i++) {
      starPath(ctx, random() * w, random() * h * 0.55, 10 + random() * 14)
      ctx.fillStyle = "#fff6b0"
      ctx.fill()
    }
    // moon
    ctx.beginPath()
    ctx.arc(w * 0.78, h * 0.22, 70, 0, Math.PI * 2)
    ctx.fillStyle = "#fff4cf"
    ctx.shadowColor = "#fff4cf"
    ctx.shadowBlur = 40
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.beginPath()
    ctx.arc(w * 0.75, h * 0.2, 12, 0, Math.PI * 2)
    ctx.arc(w * 0.81, h * 0.26, 8, 0, Math.PI * 2)
    ctx.fillStyle = "rgba(220,205,160,0.6)"
    ctx.fill()
    // hill
    ctx.fillStyle = "#1b1b3f"
    ctx.beginPath()
    ctx.moveTo(0, h)
    ctx.lineTo(0, h * 0.85)
    ctx.quadraticCurveTo(w * 0.45, h * 0.6, w, h * 0.82)
    ctx.lineTo(w, h)
    ctx.fill()
    // two cats sitting together
    const cat = (x, y, s, flip) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(flip * s, s)
      ctx.fillStyle = "#0b0b22"
      ctx.beginPath()
      ctx.ellipse(0, 0, 34, 44, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(0, -52, 24, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(-20, -62)
      ctx.lineTo(-16, -88)
      ctx.lineTo(-4, -72)
      ctx.moveTo(20, -62)
      ctx.lineTo(16, -88)
      ctx.lineTo(4, -72)
      ctx.fill()
      ctx.strokeStyle = "#0b0b22"
      ctx.lineWidth = 9
      ctx.lineCap = "round"
      ctx.beginPath()
      ctx.moveTo(26, 30)
      ctx.quadraticCurveTo(70, 30, 58, -10)
      ctx.stroke()
      ctx.restore()
    }
    cat(w * 0.42, h * 0.66, 1.1, 1)
    cat(w * 0.52, h * 0.67, 0.95, -1)
    drawSticker(ctx, "heart", w * 0.47, h * 0.3, 46, "#ff6b9a")
  },
}

export const SAMPLES = [
  { id: "sunset", name: "Sunset Hearts" },
  { id: "garden", name: "Flower Garden" },
  { id: "balloons", name: "Balloon Ride" },
  { id: "stars", name: "Starry Night" },
]

// A sample picture as a JPEG data URL (960 x 720), drawn once and remembered
const cache = new Map()
export const samplePicture = (id, w = 960, h = 720) => {
  const key = `${id}:${w}x${h}`
  if (cache.has(key)) return cache.get(key)
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  ;(SAMPLE_DRAW[id] || SAMPLE_DRAW.sunset)(ctx, w, h, rng(id.length * 7919 + id.charCodeAt(0)))
  const data = canvas.toDataURL("image/jpeg", 0.88)
  cache.set(key, data)
  return data
}
