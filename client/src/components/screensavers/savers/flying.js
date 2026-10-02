import { fit2d, num, rand } from "./util"

// Flying 98ish: little four-pane flags in the 98ish colors (teal, blue, vaporwave pink and
// desktop silver) waving as they fly out of the dark toward you, with a few speed streaks
// trailing off the pole side. Each pane is drawn as thin vertical strips, shaded by the
// slope of the wave so the cloth looks like it ripples.

const PANES = [
  { u: [0, 0.47], v: [0, 0.46], rgb: [16, 168, 168] }, // teal
  { u: [0.53, 1], v: [0, 0.46], rgb: [32, 120, 224] }, // blue
  { u: [0, 0.47], v: [0.54, 1], rgb: [255, 113, 206] }, // pink
  { u: [0.53, 1], v: [0.54, 1], rgb: [200, 200, 200] }, // silver
]
const SHADES = 16
const STRIPS = 6
const FLAG_H = 0.8 // flag height for a width of 1

// shaded fill styles per pane, made once
const STYLES = PANES.map(({ rgb }) =>
  Array.from({ length: SHADES }, (_, i) => {
    const k = 0.55 + (0.6 * i) / (SHADES - 1)
    const [r, g, b] = rgb.map((c) => Math.min(255, Math.round(c * k)))
    return `rgb(${r},${g},${b})`
  })
)

// the wave: vertical offset and shading at u (0 at the pole, 1 at the free edge)
const waveY = (u, t, phase) => Math.sin(u * 5.2 - t * 5 + phase) * 0.07 * (0.25 + u)
const shade = (u, t, phase) => {
  const slope = Math.cos(u * 5.2 - t * 5 + phase)
  return Math.max(0, Math.min(SHADES - 1, Math.round(((slope + 1) / 2) * (SHADES - 1))))
}

const drawFlag = (ctx, t, phase) => {
  const alpha = ctx.globalAlpha
  for (let p = 0; p < PANES.length; p++) {
    const { u, v } = PANES[p]
    const styles = STYLES[p]
    const y0 = (v[0] - 0.5) * FLAG_H
    const y1 = (v[1] - 0.5) * FLAG_H
    // speed streaks behind the pole-side panes
    if (u[0] === 0) {
      ctx.fillStyle = styles[SHADES >> 1]
      const off = waveY(0, t, phase)
      for (let k = 0; k < 3; k++) {
        const gapX = -0.5 - 0.07 - k * 0.11
        const band = (y1 - y0) * (0.62 - k * 0.16)
        ctx.globalAlpha = alpha * (0.75 - k * 0.22)
        ctx.fillRect(gapX, (y0 + y1) / 2 - band / 2 + off, 0.06 - k * 0.01, band)
      }
      ctx.globalAlpha = alpha
    }
    for (let s = 0; s < STRIPS; s++) {
      const ua = u[0] + ((u[1] - u[0]) * s) / STRIPS
      const ub = u[0] + ((u[1] - u[0]) * (s + 1)) / STRIPS
      const xa = ua - 0.5
      // a hair of overlap hides seams between strips
      const xb = ub - 0.5 + (s < STRIPS - 1 ? 0.006 : 0)
      const oa = waveY(ua, t, phase)
      const ob = waveY(ub, t, phase)
      ctx.fillStyle = styles[shade((ua + ub) / 2, t, phase)]
      ctx.beginPath()
      ctx.moveTo(xa, y0 + oa)
      ctx.lineTo(xb, y0 + ob)
      ctx.lineTo(xb, y1 + ob)
      ctx.lineTo(xa, y1 + oa)
      ctx.closePath()
      ctx.fill()
    }
  }
}

export default function createFlying(canvas, opts, env) {
  const ctx = canvas.getContext("2d", { alpha: false })
  const speed = num(opts.speed, 5, 1, 10)
  const count = Math.round(num(opts.count, 20, 3, 60))
  const velocity = 0.04 + speed * 0.03
  const size = 0.11 // flag width in world units

  const spawn = (f, anywhere) => {
    f.x = rand(-1.3, 1.3)
    f.y = rand(-1, 1)
    f.z = anywhere ? rand(0.15, 1) : 1
    f.phase = rand(0, Math.PI * 2)
    f.tilt = rand(-0.25, 0.25)
    f.spin = rand(-0.15, 0.15)
    return f
  }
  const flags = Array.from({ length: count }, () => spawn({}, true))

  let w = 1
  let h = 1
  let t = 0

  return {
    resize(cssW, cssH, ratio) {
      const s = fit2d(canvas, cssW, cssH, ratio)
      w = s.width
      h = s.height
    },
    frame(dt) {
      t += dt
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, w, h)
      const cx = w / 2
      const cy = h / 2
      const f = Math.max(w, h) * 0.5

      for (const flag of flags) {
        flag.z -= velocity * dt
        flag.tilt += flag.spin * dt
        const scale = (size / flag.z) * f
        const sx = cx + (flag.x / flag.z) * f * 0.5
        const sy = cy + (flag.y / flag.z) * f * 0.5
        if (flag.z < 0.04 || sx < -scale || sx > w + scale || sy < -scale || sy > h + scale) spawn(flag, false)
      }
      flags.sort((a, b) => b.z - a.z)

      for (const flag of flags) {
        const scale = (size / flag.z) * f
        const sx = cx + (flag.x / flag.z) * f * 0.5
        const sy = cy + (flag.y / flag.z) * f * 0.5
        const c = Math.cos(flag.tilt) * scale
        const s = Math.sin(flag.tilt) * scale
        // fade in from the distance
        const alpha = Math.min(1, (1 - flag.z) / 0.25)
        if (alpha <= 0.01) continue
        ctx.globalAlpha = alpha
        ctx.setTransform(c, s, -s, c, sx, sy)
        drawFlag(ctx, t, flag.phase)
      }
      ctx.globalAlpha = 1
      ctx.setTransform(1, 0, 0, 1, 0, 0)
    },
    dispose() {},
  }
}
