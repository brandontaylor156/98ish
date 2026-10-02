import { fit2d, num, rand } from "./util"

// Warp-speed stars: each star flies from the far plane toward the viewer and is drawn as a
// streak from where it was last frame. Stars are grouped by brightness so each group is
// one path and one stroke.

const LEVELS = 8

export default function createStarfield(canvas, opts, env) {
  const ctx = canvas.getContext("2d", { alpha: false })
  const speed = num(opts.speed, 5, 1, 10)
  const density = num(opts.density, 5, 1, 10)
  const count = Math.round(120 + density * (env.preview ? 30 : 160))
  const velocity = 0.06 + speed * 0.055 // depth units per second

  const xs = new Float32Array(count)
  const ys = new Float32Array(count)
  const zs = new Float32Array(count)
  const spawn = (i, far) => {
    xs[i] = rand(-1, 1)
    ys[i] = rand(-1, 1)
    zs[i] = far ? rand(0.85, 1) : rand(0.05, 1)
  }
  for (let i = 0; i < count; i++) spawn(i, false)

  const buckets = Array.from({ length: LEVELS }, () => ({ n: 0, pts: new Float32Array(count * 4) }))
  const styles = Array.from({ length: LEVELS }, (_, l) => {
    const t = (l + 1) / LEVELS
    const r = Math.round(150 + 105 * t)
    const g = Math.round(170 + 85 * t)
    return `rgba(${r},${g},255,${(0.45 + 0.55 * t).toFixed(2)})`
  })

  let w = 1
  let h = 1
  let dpr = 1

  return {
    resize(cssW, cssH, ratio) {
      const size = fit2d(canvas, cssW, cssH, ratio)
      w = size.width
      h = size.height
      dpr = ratio
    },
    frame(dt) {
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, w, h)
      const cx = w / 2
      const cy = h / 2
      const f = Math.max(w, h) * 0.4
      const minLen = 1.6 * dpr
      for (const b of buckets) b.n = 0

      for (let i = 0; i < count; i++) {
        const pz = zs[i]
        let z = pz - velocity * dt
        if (z <= 0.02) {
          spawn(i, true)
          continue
        }
        zs[i] = z
        const x = cx + (xs[i] / z) * f
        const y = cy + (ys[i] / z) * f
        if (x < -20 || x > w + 20 || y < -20 || y > h + 20) {
          spawn(i, true)
          continue
        }
        let px = cx + (xs[i] / pz) * f
        let py = cy + (ys[i] / pz) * f
        // at least a short dash, pointing away from the center
        const len = Math.hypot(x - px, y - py)
        if (len < minLen) {
          const r = Math.hypot(x - cx, y - cy) || 1
          px = x - ((x - cx) / r) * minLen
          py = y - ((y - cy) / r) * minLen
        }
        const near = 1 - z
        const level = Math.min(LEVELS - 1, Math.floor(near * near * LEVELS))
        const b = buckets[level]
        const k = b.n * 4
        b.pts[k] = px
        b.pts[k + 1] = py
        b.pts[k + 2] = x
        b.pts[k + 3] = y
        b.n++
      }

      ctx.lineCap = "butt"
      for (let l = 0; l < LEVELS; l++) {
        const b = buckets[l]
        if (!b.n) continue
        ctx.strokeStyle = styles[l]
        ctx.lineWidth = (env.preview ? 0.7 + l * 0.2 : 1 + l * 0.42) * dpr
        ctx.beginPath()
        for (let k = 0; k < b.n * 4; k += 4) {
          ctx.moveTo(b.pts[k], b.pts[k + 1])
          ctx.lineTo(b.pts[k + 2], b.pts[k + 3])
        }
        ctx.stroke()
      }
    },
    dispose() {},
  }
}
