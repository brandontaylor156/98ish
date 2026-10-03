import { clamp, fit2d, num, rand } from "./util"

// Aquarium: little round-eyed fish swimming in schools (each kind keeps with its own,
// boids style), bubbles, swaying seaweed, light rays and a treasure chest that pops open
// now and then with a puff of bubbles. The sand and pebbles are drawn once per resize.

const KINDS = [
  { body: "#ff9f43", belly: "#ffd29a", fin: "#ff7a1a", stripes: "#fff", len: 1, tall: 0.62 }, // orange with white bands
  { body: "#5ec8ff", belly: "#c9f0ff", fin: "#2f8fe0", len: 1.15, tall: 0.5 }, // little blue
  { body: "#ff8fc8", belly: "#ffd3ea", fin: "#e85aa6", len: 0.9, tall: 0.78 }, // round pink
  { body: "#ffe066", belly: "#fff4b8", fin: "#f5b700", len: 0.8, tall: 0.95, angel: true }, // yellow angel
  { body: "#b39bff", belly: "#e2d8ff", fin: "#7e62e8", len: 1.3, tall: 0.45 }, // long lilac
]

const PLANT_COLORS = ["#3fbf7f", "#2fa86a", "#5fd38f", "#7fd06a"]

export default function createAquarium(canvas, opts, env) {
  const ctx = canvas.getContext("2d", { alpha: false })
  const count = Math.round(num(opts.count, 16, 4, 40) * (env.preview ? 0.6 : 1))
  const speed = num(opts.speed, 5, 1, 10)
  const pace = 0.4 + speed * 0.12

  let w = 1
  let h = 1
  let unit = 1 // a fish's body length, in pixels
  let floor = 1 // where the sand starts
  let back = null // the water, rays' backdrop, sand and pebbles
  let t = 0

  const fish = Array.from({ length: count }, (_, i) => ({
    kind: i % KINDS.length,
    x: Math.random(),
    y: Math.random(),
    vx: rand(-1, 1),
    vy: rand(-0.3, 0.3),
    size: rand(0.8, 1.2),
    phase: rand(0, 6.28),
    face: 1,
  }))

  const MAX_BUBBLES = env.preview ? 24 : 70
  const bubbles = []
  const addBubble = (x, y, r) => {
    if (bubbles.length >= MAX_BUBBLES) return
    bubbles.push({ x, y, r, wob: rand(0, 6.28), v: rand(0.7, 1.2) })
  }

  let plants = []
  let chest = { x: 0, y: 0, lid: 0, timer: 4 }

  const buildBack = () => {
    back = document.createElement("canvas")
    back.width = w
    back.height = h
    const b = back.getContext("2d")
    const g = b.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, "#7fe0f0")
    g.addColorStop(0.45, "#2ab0d0")
    g.addColorStop(1, "#14709e")
    b.fillStyle = g
    b.fillRect(0, 0, w, h)
    // the sand, with soft bumps
    b.fillStyle = "#f2d9a0"
    b.beginPath()
    b.moveTo(0, h)
    for (let x = 0; x <= w; x += w / 24) b.lineTo(x, floor + Math.sin(x * 0.01 + 1) * h * 0.012 + Math.sin(x * 0.033) * h * 0.006)
    b.lineTo(w, h)
    b.fill()
    b.fillStyle = "rgba(200,160,100,.35)"
    b.fillRect(0, floor + h * 0.06, w, h)
    // pebbles in candy colors
    const pebbles = ["#ffb3c8", "#c6b8ff", "#9fe3d0", "#ffe08a", "#ffffff"]
    for (let i = 0; i < 60; i++) {
      b.fillStyle = pebbles[i % pebbles.length]
      b.beginPath()
      b.ellipse(Math.random() * w, floor + h * 0.03 + Math.random() * (h - floor), unit * rand(0.05, 0.12), unit * rand(0.035, 0.07), 0, 0, 6.28)
      b.fill()
    }
    // a cute rock castle on the left
    const cx = w * 0.12
    const ch = h * 0.2
    b.fillStyle = "#c9b8e8"
    b.strokeStyle = "#7d6aa8"
    b.lineWidth = Math.max(2, unit * 0.04)
    b.beginPath()
    b.rect(cx - ch * 0.35, floor - ch * 0.6, ch * 0.7, ch * 0.62)
    b.rect(cx - ch * 0.5, floor - ch, ch * 0.28, ch)
    b.rect(cx + ch * 0.22, floor - ch, ch * 0.28, ch)
    b.fill()
    b.stroke()
    b.fillStyle = "#ff8fb1"
    for (const tx of [cx - ch * 0.36, cx + ch * 0.36]) {
      b.beginPath()
      b.moveTo(tx - ch * 0.18, floor - ch)
      b.lineTo(tx, floor - ch * 1.3)
      b.lineTo(tx + ch * 0.18, floor - ch)
      b.fill()
      b.stroke()
    }
    b.fillStyle = "#5a4a8a"
    b.beginPath()
    b.arc(cx, floor - ch * 0.12, ch * 0.13, Math.PI, 0)
    b.lineTo(cx + ch * 0.13, floor)
    b.lineTo(cx - ch * 0.13, floor)
    b.fill()
    b.fillStyle = "#fff6a8"
    b.fillRect(cx - ch * 0.42, floor - ch * 0.75, ch * 0.1, ch * 0.12)
    b.fillRect(cx + ch * 0.32, floor - ch * 0.75, ch * 0.1, ch * 0.12)
  }

  const buildPlants = () => {
    plants = []
    const n = env.preview ? 7 : 14
    for (let i = 0; i < n; i++) {
      const x = ((i + rand(0.1, 0.9)) / n) * w
      plants.push({ x, h: h * rand(0.16, 0.36), segs: 7, color: PLANT_COLORS[i % PLANT_COLORS.length], phase: rand(0, 6.28), blades: Math.random() < 0.5 ? 2 : 3 })
    }
    chest = { x: w * 0.8, y: floor + h * 0.03, lid: 0, timer: 3, open: false }
  }

  const drawRays = () => {
    ctx.save()
    ctx.globalCompositeOperation = "lighter"
    for (let i = 0; i < 5; i++) {
      const x = ((i + 0.5) / 5) * w + Math.sin(t * 0.2 + i * 1.7) * w * 0.04
      const top = w * 0.03 + (i % 2) * w * 0.02
      const g = ctx.createLinearGradient(0, 0, 0, floor)
      g.addColorStop(0, "rgba(255,255,255,0.13)")
      g.addColorStop(1, "rgba(255,255,255,0)")
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(x - top, 0)
      ctx.lineTo(x + top, 0)
      ctx.lineTo(x + top * 3 + w * 0.08, floor)
      ctx.lineTo(x - top + w * 0.08, floor)
      ctx.fill()
    }
    ctx.restore()
  }

  const drawPlant = (p) => {
    ctx.strokeStyle = p.color
    ctx.lineCap = "round"
    for (let b = 0; b < p.blades; b++) {
      const off = (b - (p.blades - 1) / 2) * unit * 0.18
      ctx.lineWidth = unit * (0.16 - b * 0.02)
      ctx.beginPath()
      let x = p.x + off
      let y = floor + unit * 0.05
      ctx.moveTo(x, y)
      const step = (p.h * (1 - b * 0.15)) / p.segs
      for (let s = 1; s <= p.segs; s++) {
        const k = s / p.segs
        x = p.x + off + Math.sin(t * 1.1 + p.phase + s * 0.6 + b) * unit * 0.35 * k
        y -= step
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }

  const drawChest = (dt) => {
    const c = chest
    c.timer -= dt
    if (c.timer <= 0) {
      c.open = !c.open
      c.timer = c.open ? 3 : rand(5, 9)
      if (c.open) for (let i = 0; i < 12; i++) addBubble(c.x + rand(-1, 1) * unit * 0.4, c.y - unit * 0.5, unit * rand(0.05, 0.13))
    }
    c.lid += ((c.open ? 1 : 0) - c.lid) * Math.min(1, dt * 4)
    const s = unit * 1.3
    const x = c.x
    const y = c.y
    ctx.lineWidth = Math.max(2, s * 0.05)
    ctx.strokeStyle = "#6a3e22"
    // gold glow while open
    if (c.lid > 0.05) {
      const g = ctx.createRadialGradient(x, y - s * 0.55, 0, x, y - s * 0.55, s)
      g.addColorStop(0, `rgba(255,236,140,${0.7 * c.lid})`)
      g.addColorStop(1, "rgba(255,236,140,0)")
      ctx.fillStyle = g
      ctx.fillRect(x - s, y - s * 1.6, s * 2, s * 1.6)
      ctx.fillStyle = "#ffd34d"
      for (let i = 0; i < 5; i++) {
        ctx.beginPath()
        ctx.arc(x - s * 0.3 + i * s * 0.15, y - s * 0.5 - (i % 2) * s * 0.06, s * 0.08, 0, 6.28)
        ctx.fill()
      }
    }
    // box
    ctx.fillStyle = "#b8743e"
    ctx.beginPath()
    ctx.roundRect(x - s * 0.5, y - s * 0.5, s, s * 0.5, s * 0.06)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = "#ffd34d"
    ctx.fillRect(x - s * 0.5, y - s * 0.32, s, s * 0.08)
    ctx.fillRect(x - s * 0.06, y - s * 0.42, s * 0.12, s * 0.18)
    // lid, hinged at the back
    ctx.save()
    ctx.translate(x + s * 0.5, y - s * 0.5)
    ctx.rotate(c.lid * 1.2)
    ctx.fillStyle = "#c9854a"
    ctx.beginPath()
    ctx.moveTo(-s, 0)
    ctx.quadraticCurveTo(-s, -s * 0.32, -s * 0.5, -s * 0.32)
    ctx.quadraticCurveTo(0, -s * 0.32, 0, 0)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = "#ffd34d"
    ctx.fillRect(-s * 0.56, -s * 0.32, s * 0.12, s * 0.32)
    ctx.restore()
  }

  const drawFish = (f) => {
    const k = KINDS[f.kind]
    const L = unit * f.size * k.len
    const T = L * k.tall
    const wig = Math.sin(f.phase) * 0.35
    ctx.save()
    ctx.translate(f.x * w, f.y * floor)
    ctx.scale(f.face, 1)
    ctx.rotate(clamp(f.vy * 0.6, -0.4, 0.4) * f.face)
    ctx.lineWidth = Math.max(1.5, L * 0.045)
    ctx.strokeStyle = "rgba(60,40,80,.55)"
    // tail
    ctx.fillStyle = k.fin
    ctx.beginPath()
    ctx.moveTo(-L * 0.38, 0)
    ctx.lineTo(-L * 0.72, -T * 0.5 + wig * T * 0.4)
    ctx.quadraticCurveTo(-L * 0.6, wig * T * 0.3, -L * 0.72, T * 0.5 + wig * T * 0.4)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // fins
    ctx.beginPath()
    if (k.angel) {
      ctx.moveTo(-L * 0.1, -T * 0.4)
      ctx.lineTo(-L * 0.25, -T * 1.0)
      ctx.lineTo(L * 0.15, -T * 0.42)
      ctx.moveTo(-L * 0.1, T * 0.4)
      ctx.lineTo(-L * 0.25, T * 1.0)
      ctx.lineTo(L * 0.15, T * 0.42)
    } else {
      ctx.moveTo(-L * 0.15, -T * 0.42)
      ctx.quadraticCurveTo(0, -T * 0.85, L * 0.15, -T * 0.45)
    }
    ctx.fill()
    ctx.stroke()
    // body
    ctx.fillStyle = k.body
    ctx.beginPath()
    ctx.ellipse(0, 0, L * 0.45, T * 0.5, 0, 0, 6.28)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = k.belly
    ctx.beginPath()
    ctx.ellipse(L * 0.04, T * 0.2, L * 0.3, T * 0.22, 0, 0, 6.28)
    ctx.fill()
    if (k.stripes) {
      ctx.fillStyle = k.stripes
      ctx.fillRect(-L * 0.08, -T * 0.46, L * 0.1, T * 0.92)
      ctx.fillRect(L * 0.2, -T * 0.36, L * 0.07, T * 0.72)
    }
    // little side fin, flapping
    ctx.fillStyle = k.fin
    ctx.beginPath()
    ctx.ellipse(L * 0.02, T * 0.08, L * 0.12, T * 0.1, 0.6 + wig, 0, 6.28)
    ctx.fill()
    // face: big eye with a shine, blush, smile
    ctx.fillStyle = "#fff"
    ctx.beginPath()
    ctx.arc(L * 0.24, -T * 0.08, T * 0.17, 0, 6.28)
    ctx.fill()
    ctx.fillStyle = "#2a1f3a"
    ctx.beginPath()
    ctx.arc(L * 0.27, -T * 0.07, T * 0.11, 0, 6.28)
    ctx.fill()
    ctx.fillStyle = "#fff"
    ctx.beginPath()
    ctx.arc(L * 0.3, -T * 0.11, T * 0.04, 0, 6.28)
    ctx.fill()
    ctx.fillStyle = "rgba(255,120,160,.5)"
    ctx.beginPath()
    ctx.ellipse(L * 0.2, T * 0.14, T * 0.09, T * 0.05, 0, 0, 6.28)
    ctx.fill()
    ctx.strokeStyle = "#2a1f3a"
    ctx.lineWidth = Math.max(1, L * 0.03)
    ctx.beginPath()
    ctx.arc(L * 0.38, T * 0.08, T * 0.07, 0.2, 1.8)
    ctx.stroke()
    ctx.restore()
  }

  // schooling: each fish steers toward its own kind, away from crowding, and off the walls
  const steer = (dt) => {
    const aspect = w / Math.max(1, floor)
    for (const a of fish) {
      let cx = 0
      let cy = 0
      let ax = 0
      let ay = 0
      let sx = 0
      let sy = 0
      let n = 0
      for (const b of fish) {
        if (a === b) continue
        const dx = (b.x - a.x) * aspect
        const dy = b.y - a.y
        const d2 = dx * dx + dy * dy
        if (d2 < 0.012) {
          sx -= dx / (d2 + 0.001)
          sy -= dy / (d2 + 0.001)
        }
        if (b.kind === a.kind && d2 < 0.08) {
          cx += dx
          cy += dy
          ax += b.vx
          ay += b.vy
          n++
        }
      }
      if (n) {
        a.vx += (cx / n) * 0.9 * dt + (ax / n - a.vx) * 0.6 * dt
        a.vy += (cy / n) * 0.9 * dt + (ay / n - a.vy) * 0.6 * dt
      }
      a.vx += sx * 0.0016 * dt * 60
      a.vy += sy * 0.0016 * dt * 60
      // wander and walls
      a.vx += rand(-0.6, 0.6) * dt
      a.vy += rand(-0.4, 0.4) * dt
      if (a.x < 0.06) a.vx += 1.5 * dt
      if (a.x > 0.94) a.vx -= 1.5 * dt
      if (a.y < 0.1) a.vy += 1.2 * dt
      if (a.y > 0.88) a.vy -= 1.2 * dt
      const sp = Math.hypot(a.vx, a.vy)
      const max = 1.1
      const min = 0.35
      if (sp > max) {
        a.vx *= max / sp
        a.vy *= max / sp
      } else if (sp < min) {
        a.vx *= min / (sp || 1)
        a.vy *= min / (sp || 1)
      }
      a.vy *= 0.98
    }
    for (const a of fish) {
      a.x += (a.vx * 0.08 * dt) / Math.max(0.5, aspect / 1.6)
      a.y += a.vy * 0.08 * dt
      a.phase += dt * (6 + Math.abs(a.vx) * 6)
      if (Math.abs(a.vx) > 0.08) a.face = a.vx > 0 ? 1 : -1
      if (Math.random() < dt * 0.08) addBubble(a.x * w + a.face * unit * 0.45, a.y * floor, unit * 0.06)
    }
  }

  return {
    resize(cssW, cssH, ratio) {
      const s = fit2d(canvas, cssW, cssH, ratio)
      w = s.width
      h = s.height
      unit = Math.max(10, Math.min(w, h) * (env.preview ? 0.14 : 0.085))
      floor = h * 0.86
      buildBack()
      buildPlants()
    },
    frame(dt) {
      const step = dt * pace
      t += step
      ctx.drawImage(back, 0, 0)
      drawRays()
      for (let i = 0; i < plants.length; i += 2) drawPlant(plants[i])
      drawChest(step)
      steer(step)
      for (const f of fish) drawFish(f)
      for (let i = 1; i < plants.length; i += 2) drawPlant(plants[i])
      // bubbles: from a couple of spots on the floor, and the fish
      if (Math.random() < step * 3) addBubble(plants[0]?.x ?? w * 0.3, floor, unit * rand(0.04, 0.1))
      ctx.strokeStyle = "rgba(255,255,255,.85)"
      ctx.lineWidth = Math.max(1, unit * 0.025)
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]
        b.y -= b.v * unit * 1.4 * step
        b.wob += step * 3
        const x = b.x + Math.sin(b.wob) * unit * 0.08
        if (b.y < -b.r) {
          bubbles.splice(i, 1)
          continue
        }
        ctx.fillStyle = "rgba(255,255,255,.18)"
        ctx.beginPath()
        ctx.arc(x, b.y, b.r, 0, 6.28)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = "rgba(255,255,255,.9)"
        ctx.beginPath()
        ctx.arc(x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.25, 0, 6.28)
        ctx.fill()
      }
    },
    dispose() {
      back = null
    },
  }
}
