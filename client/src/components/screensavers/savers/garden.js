import { clamp, fit2d, num, rand } from "./util"

// Flower Garden: flowers sprout, grow, bloom, wilt and come back, all across a little
// meadow, while butterflies flutter about. The sky turns from day to sunset to a starry
// night with fireflies and back again (or stays day, or stays night).

const PETALS = ["#ff8fb1", "#ffb3d1", "#c49bff", "#8fd3ff", "#ffd56b", "#ff9a7a", "#ffffff", "#f06a9a"]
const WINGS = [
  ["#ffb3d1", "#ffd56b"],
  ["#b8a6ff", "#8fd3ff"],
  ["#ffd56b", "#ff9a7a"],
  ["#9fe0c8", "#c49bff"],
]

// sky colors (top, bottom) for day, sunset and night
const SKY = {
  day: [[143, 212, 255], [222, 244, 255]],
  dusk: [[255, 150, 170], [255, 214, 160]],
  // before the night shade goes over everything
  night: [[24, 32, 85], [129, 94, 187]],
}

const mix = (a, b, k) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * k))
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`
const smooth = (a, b, x) => {
  const k = clamp((x - a) / (b - a), 0, 1)
  return k * k * (3 - 2 * k)
}

export default function createGarden(canvas, opts, env) {
  const ctx = canvas.getContext("2d", { alpha: false })
  const speed = num(opts.speed, 5, 1, 10)
  const cycle = ["auto", "day", "night"].includes(opts.cycle) ? opts.cycle : "auto"
  const period = 90 / (0.4 + speed * 0.12) // seconds per day
  const growPace = 0.35 + speed * 0.09

  let w = 1
  let h = 1
  let unit = 1
  let horizon = 1
  let clock = cycle === "night" ? 0.7 : 0.12 // 0..1 through the day
  let t = 0

  const stars = Array.from({ length: env.preview ? 40 : 140 }, () => ({ x: Math.random(), y: Math.random() * 0.6, r: rand(0.6, 1.8), tw: rand(0, 6.28) }))
  const flies = Array.from({ length: env.preview ? 8 : 26 }, () => ({ x: Math.random(), y: rand(0.65, 0.98), ph: rand(0, 6.28), sp: rand(0.5, 1.2) }))

  // flowers: grow 0..1 (stem), open 0..1 (bloom), then wilt 0..1, then reborn
  const MAX_FLOWERS = env.preview ? 14 : 40
  const flowers = []
  const newFlower = (f = {}) => {
    const depth = Math.random() // 0 far, 1 near
    return Object.assign(f, {
      x: Math.random(),
      depth,
      kind: Math.floor(Math.random() * 5),
      color: PETALS[Math.floor(Math.random() * PETALS.length)],
      height: rand(0.6, 1.1),
      lean: rand(-0.25, 0.25),
      grow: 0,
      open: 0,
      wilt: 0,
      life: rand(10, 22),
      age: -rand(0, 6), // waits a moment before sprouting
      sway: rand(0, 6.28),
    })
  }
  for (let i = 0; i < MAX_FLOWERS; i++) {
    const f = newFlower()
    // start partway so the garden isn't empty
    f.age = rand(0, 14)
    f.grow = clamp(f.age / 4, 0, 1)
    f.open = clamp((f.age - 3) / 3, 0, 1)
    flowers.push(f)
  }
  flowers.sort((a, b) => a.depth - b.depth)

  const butterflies = Array.from({ length: env.preview ? 3 : 6 }, (_, i) => ({
    x: Math.random(),
    y: rand(0.3, 0.7),
    tx: Math.random(),
    ty: rand(0.3, 0.75),
    ph: rand(0, 6.28),
    wings: WINGS[i % WINGS.length],
    size: rand(0.8, 1.2),
  }))

  const nightness = () => {
    if (cycle === "day") return 0
    if (cycle === "night") return 1
    // day 0-.4, sunset .4-.55, night .55-.9, dawn .9-1
    const c = clock
    if (c < 0.4) return 0
    if (c < 0.55) return smooth(0.4, 0.55, c)
    if (c < 0.9) return 1
    return 1 - smooth(0.9, 1, c)
  }
  const duskness = () => {
    if (cycle !== "auto") return 0
    const c = clock
    return Math.max(0, 1 - Math.abs(c - 0.47) / 0.1) + Math.max(0, 1 - Math.abs(c - 0.93) / 0.06) * 0.7
  }

  // the sky and the hills are painted on a canvas of their own, redrawn only as the light changes
  let sky = null
  let skyKey = ""
  const layer = () => {
    const c = document.createElement("canvas")
    c.width = w
    c.height = h
    return c
  }
  const drawSky = (n, dusk) => {
    const key = `${Math.round(n * 60)},${Math.round(dusk * 60)}`
    if (key !== skyKey || !sky) {
      skyKey = key
      sky ||= layer()
      const s = sky.getContext("2d")
      let top = mix(SKY.day[0], SKY.night[0], n)
      let bottom = mix(SKY.day[1], SKY.night[1], n)
      top = mix(top, SKY.dusk[0], dusk * 0.5)
      bottom = mix(bottom, SKY.dusk[1], dusk * 0.8)
      const g = s.createLinearGradient(0, 0, 0, horizon)
      g.addColorStop(0, rgb(top))
      g.addColorStop(1, rgb(bottom))
      s.fillStyle = g
      s.fillRect(0, 0, w, h)
      drawHills(s)
    }
    ctx.drawImage(sky, 0, 0)
  }

  const drawStars = (n) => {
    if (n < 0.05) return
    ctx.fillStyle = "#fff"
    for (const s of stars) {
      ctx.globalAlpha = n * (0.55 + 0.45 * Math.sin(t * 2 + s.tw))
      ctx.beginPath()
      ctx.arc(s.x * w, s.y * horizon, s.r * unit * 0.04, 0, 6.28)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  // the crescent moon, drawn once per size
  let moon = null
  const buildMoon = () => {
    const r = unit * 0.8
    moon = document.createElement("canvas")
    moon.width = moon.height = Math.ceil(r * 2 + 4)
    const m = moon.getContext("2d")
    const c = moon.width / 2
    m.fillStyle = "#fff1a8"
    m.beginPath()
    m.arc(c, c, r, 0, 6.28)
    m.fill()
    m.globalCompositeOperation = "destination-out"
    m.beginPath()
    m.arc(c + r * 0.45, c - r * 0.25, r * 0.85, 0, 6.28)
    m.fill()
    m.globalCompositeOperation = "source-over"
    // closed eye and a blush
    m.strokeStyle = "#b08a3e"
    m.lineWidth = r * 0.08
    m.lineCap = "round"
    m.beginPath()
    m.arc(c - r * 0.55, c + r * 0.05, r * 0.14, 0.2, Math.PI - 0.2)
    m.stroke()
    m.fillStyle = "rgba(255,150,150,.6)"
    m.beginPath()
    m.arc(c - r * 0.45, c + r * 0.35, r * 0.1, 0, 6.28)
    m.fill()
  }

  const drawSunMoon = (n, part) => {
    const r = unit * 0.9
    // the sun crosses during the day, the moon at night
    const dayK = cycle === "auto" ? clamp(clock / 0.52, 0, 1) : 0.3
    const nightK = cycle === "auto" ? clamp((clock - 0.5) / 0.45, 0, 1) : 0.65
    if (part === "sun" && n < 0.98) {
      const x = w * (0.1 + dayK * 0.8)
      const y = horizon * (0.7 - Math.sin(dayK * Math.PI) * 0.45)
      ctx.globalAlpha = 1 - n
      glow(x, y, r * 1.9, "rgba(255,240,150,.55)")
      ctx.fillStyle = "#ffe066"
      ctx.beginPath()
      ctx.arc(x, y, r, 0, 6.28)
      ctx.fill()
      // sleepy smile
      ctx.strokeStyle = "#b07a2e"
      ctx.lineWidth = r * 0.08
      ctx.lineCap = "round"
      ctx.beginPath()
      ctx.arc(x - r * 0.32, y - r * 0.1, r * 0.14, Math.PI * 1.1, Math.PI * 1.9)
      ctx.arc(x + r * 0.32, y - r * 0.1, r * 0.14, Math.PI * 1.1, Math.PI * 1.9)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x, y + r * 0.15, r * 0.25, 0.2, Math.PI - 0.2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    if (part === "moon" && n > 0.02) {
      const x = w * (0.15 + nightK * 0.7)
      const y = horizon * (0.62 - Math.sin(nightK * Math.PI) * 0.4)
      ctx.globalAlpha = n
      glow(x, y, r * 2.2, "rgba(255,246,200,.3)")
      if (moon) ctx.drawImage(moon, x - moon.width / 2, y - moon.height / 2)
      ctx.globalAlpha = 1
    }
  }

  const drawHills = (g) => {
    g.fillStyle = "#a6dc8e"
    g.beginPath()
    g.moveTo(0, h)
    for (let x = 0; x <= w; x += w / 20) g.lineTo(x, horizon - Math.sin((x / w) * 5 + 1) * h * 0.04)
    g.lineTo(w, h)
    g.fill()
    g.fillStyle = "#7cc874"
    g.beginPath()
    g.moveTo(0, h)
    for (let x = 0; x <= w; x += w / 20) g.lineTo(x, horizon + h * 0.08 - Math.sin((x / w) * 3.4 + 2) * h * 0.03)
    g.lineTo(w, h)
    g.fill()
  }

  const glow = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, r * 0.3, x, y, r)
    g.addColorStop(0, color)
    g.addColorStop(1, "rgba(255,240,170,0)")
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  const drawHead = (g, kind, color, size, open) => {
    const s = size * (0.25 + 0.75 * open)
    if (open < 0.15) {
      // a bud
      g.fillStyle = "#78c07a"
      g.beginPath()
      g.ellipse(0, 0, size * 0.18, size * 0.28, 0, 0, 6.28)
      g.fill()
      g.fillStyle = color
      g.beginPath()
      g.ellipse(0, -size * 0.12, size * 0.1, size * 0.16, 0, 0, 6.28)
      g.fill()
      return
    }
    g.fillStyle = color
    if (kind === 0 || kind === 4) {
      // daisy / sunflower-ish
      const n = kind === 0 ? 10 : 14
      // all the petals as one shape: one fill instead of a dozen
      g.beginPath()
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.28
        const cx = Math.cos(a) * s * 0.5
        const cy = Math.sin(a) * s * 0.5
        g.moveTo(cx + Math.cos(a) * s * 0.36, cy + Math.sin(a) * s * 0.36)
        g.ellipse(cx, cy, s * 0.36, s * 0.14, a, 0, 6.28)
      }
      g.fill()
      g.fillStyle = kind === 0 ? "#ffcf4a" : "#8a5a2e"
      g.beginPath()
      g.arc(0, 0, s * 0.3, 0, 6.28)
      g.fill()
    } else if (kind === 1) {
      // tulip
      g.beginPath()
      g.moveTo(-s * 0.45, -s * 0.5)
      g.quadraticCurveTo(-s * 0.45, s * 0.35, 0, s * 0.35)
      g.quadraticCurveTo(s * 0.45, s * 0.35, s * 0.45, -s * 0.5)
      g.lineTo(s * 0.22, -s * 0.25)
      g.lineTo(0, -s * 0.55)
      g.lineTo(-s * 0.22, -s * 0.25)
      g.closePath()
      g.fill()
    } else if (kind === 2) {
      // five round petals
      g.beginPath()
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * 6.28 - Math.PI / 2
        g.moveTo(Math.cos(a) * s * 0.42 + s * 0.34, Math.sin(a) * s * 0.42)
        g.arc(Math.cos(a) * s * 0.42, Math.sin(a) * s * 0.42, s * 0.34, 0, 6.28)
      }
      g.fill()
      g.fillStyle = "#fff3a8"
      g.beginPath()
      g.arc(0, 0, s * 0.24, 0, 6.28)
      g.fill()
    } else {
      // a swirly rose
      g.beginPath()
      g.arc(0, 0, s * 0.5, 0, 6.28)
      g.fill()
      g.strokeStyle = "rgba(255,255,255,.6)"
      g.lineWidth = s * 0.07
      g.beginPath()
      for (let a = 0; a < 12; a += 0.4) {
        const r = s * 0.04 * a
        if (a === 0) g.moveTo(0, 0)
        else g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      }
      g.stroke()
    }
    // a little shine
    g.fillStyle = "rgba(255,255,255,.35)"
    g.beginPath()
    g.arc(-s * 0.12, -s * 0.14, s * 0.1, 0, 6.28)
    g.fill()
  }

  // flower heads are drawn once per look (kind, color, size, how open) and reused
  const heads = new Map()
  const headSprite = (kind, color, size, open) => {
    const sb = Math.max(4, Math.round(size / 3) * 3)
    const ob = Math.round(open * 12) / 12
    const key = `${kind}|${color}|${sb}|${ob}`
    let c = heads.get(key)
    if (!c) {
      if (heads.size > 500) heads.clear()
      c = document.createElement("canvas")
      c.width = c.height = Math.ceil(sb * 1.9 + 4)
      const g = c.getContext("2d")
      g.translate(c.width / 2, c.height / 2)
      drawHead(g, kind, color, sb, ob)
      heads.set(key, c)
    }
    return c
  }

  const drawFlower = (f, n) => {
    if (f.age < 0) return
    const scale = 0.55 + f.depth * 0.75
    const baseY = horizon + h * 0.1 + f.depth * (h - horizon - h * 0.12)
    const x = f.x * w
    const stemH = unit * 2.6 * f.height * scale * f.grow
    const droop = f.wilt
    const sway = Math.sin(t * 1.3 + f.sway) * unit * 0.12 * scale
    const tipX = x + (f.lean * unit + sway) * f.grow + droop * unit * 0.6 * scale * Math.sign(f.lean || 1)
    const tipY = baseY - stemH * (1 - droop * 0.35)
    ctx.globalAlpha = 1 - f.wilt * 0.6
    ctx.strokeStyle = droop > 0.3 ? "#8aa060" : "#4f9a58"
    ctx.lineWidth = Math.max(1.5, unit * 0.07 * scale)
    ctx.lineCap = "round"
    ctx.beginPath()
    ctx.moveTo(x, baseY)
    ctx.quadraticCurveTo(x + f.lean * unit * 0.3, baseY - stemH * 0.5, tipX, tipY)
    ctx.stroke()
    // two leaves
    if (f.grow > 0.4) {
      ctx.fillStyle = "#6cbf6c"
      const lk = Math.min(1, (f.grow - 0.4) * 2) * scale * unit
      const ly = baseY - stemH * 0.35
      ctx.beginPath()
      ctx.ellipse(x + lk * 0.28, ly, lk * 0.32, lk * 0.12, -0.5, 0, 6.28)
      ctx.ellipse(x - lk * 0.26, ly - stemH * 0.15, lk * 0.28, lk * 0.11, 0.5, 0, 6.28)
      ctx.fill()
    }
    if (f.grow > 0.85) {
      ctx.save()
      ctx.translate(tipX, tipY)
      ctx.rotate(droop * 1.6 * Math.sign(f.lean || 1) + sway / unit)
      // flowers close up a bit at night
      const head = headSprite(f.kind, f.color, unit * 0.8 * scale, f.open * (1 - n * 0.35) * (1 - f.wilt * 0.4))
      ctx.drawImage(head, -head.width / 2, -head.height / 2)
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  const growFlowers = (dt) => {
    for (const f of flowers) {
      f.age += dt * growPace
      if (f.age < 0) continue
      if (f.grow < 1) f.grow = Math.min(1, f.grow + dt * growPace * 0.3)
      else if (f.open < 1 && f.wilt === 0) f.open = Math.min(1, f.open + dt * growPace * 0.35)
      if (f.age > f.life) f.wilt = Math.min(1, f.wilt + dt * growPace * 0.2)
      if (f.wilt >= 1) newFlower(f)
    }
  }

  const drawButterfly = (b, dt, alpha) => {
    // drift toward a target, pick a new one on arrival
    const dx = b.tx - b.x
    const dy = b.ty - b.y
    const d = Math.hypot(dx, dy)
    if (d < 0.03) {
      b.tx = Math.random()
      b.ty = rand(0.25, 0.8)
    } else {
      b.x += (dx / d) * dt * 0.06
      b.y += (dy / d) * dt * 0.06 + Math.sin(b.ph * 0.5) * dt * 0.03
    }
    b.ph += dt * 14
    if (alpha <= 0.02) return
    const s = unit * 0.55 * b.size
    const flap = 0.25 + 0.75 * Math.abs(Math.sin(b.ph))
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(b.x * w, b.y * h)
    ctx.rotate(clamp(dx * 3, -0.5, 0.5))
    for (const side of [-1, 1]) {
      ctx.save()
      ctx.scale(side * flap, 1)
      ctx.fillStyle = b.wings[0]
      ctx.beginPath()
      ctx.ellipse(s * 0.45, -s * 0.3, s * 0.48, s * 0.36, -0.5, 0, 6.28)
      ctx.fill()
      ctx.fillStyle = b.wings[1]
      ctx.beginPath()
      ctx.ellipse(s * 0.35, s * 0.25, s * 0.32, s * 0.24, 0.5, 0, 6.28)
      ctx.fill()
      ctx.fillStyle = "rgba(255,255,255,.6)"
      ctx.beginPath()
      ctx.arc(s * 0.55, -s * 0.35, s * 0.1, 0, 6.28)
      ctx.fill()
      ctx.restore()
    }
    ctx.fillStyle = "#5a3e74"
    ctx.beginPath()
    ctx.ellipse(0, 0, s * 0.08, s * 0.38, 0, 0, 6.28)
    ctx.fill()
    ctx.restore()
  }

  let fly = null // one firefly glow, reused
  const drawFireflies = (n, dt) => {
    if (n < 0.05) return
    if (!fly) {
      const r = Math.max(4, Math.round(unit * 0.3))
      fly = document.createElement("canvas")
      fly.width = fly.height = r * 2
      const g = fly.getContext("2d")
      const grad = g.createRadialGradient(r, r, 0, r, r, r)
      grad.addColorStop(0, "rgba(255,252,190,1)")
      grad.addColorStop(0.25, "rgba(255,245,150,.7)")
      grad.addColorStop(1, "rgba(255,240,120,0)")
      g.fillStyle = grad
      g.fillRect(0, 0, r * 2, r * 2)
    }
    for (const f of flies) {
      f.ph += dt * f.sp
      const x = (f.x + Math.sin(f.ph * 0.7) * 0.03) * w
      const y = f.y * h + Math.cos(f.ph) * unit * 0.3
      ctx.globalAlpha = n * (0.5 + 0.5 * Math.sin(f.ph * 3))
      ctx.drawImage(fly, x - fly.width / 2, y - fly.height / 2)
    }
    ctx.globalAlpha = 1
  }

  return {
    resize(cssW, cssH, ratio) {
      const s = fit2d(canvas, cssW, cssH, ratio)
      w = s.width
      h = s.height
      unit = Math.max(8, Math.min(w, h) * (env.preview ? 0.1 : 0.07))
      horizon = h * 0.55
      sky = fly = null
      heads.clear()
      buildMoon()
    },
    frame(dt) {
      t += dt
      if (cycle === "auto") clock = (clock + dt / period) % 1
      const n = nightness()
      const dusk = duskness()
      drawSky(n, dusk)
      drawSunMoon(n, "sun")
      growFlowers(dt)
      for (const f of flowers) drawFlower(f, n)
      for (const b of butterflies) drawButterfly(b, dt, 1 - n)
      // night falls over everything; then the night lights
      if (n > 0.01) {
        ctx.fillStyle = `rgba(20,18,60,${0.45 * n})`
        ctx.fillRect(0, 0, w, h)
      }
      drawStars(n)
      drawSunMoon(n, "moon")
      drawFireflies(n, dt)
    },
    dispose() {
      moon = sky = null
      heads.clear()
    },
  }
}
