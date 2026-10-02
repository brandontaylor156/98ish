import { fit2d, num, rand } from "./util"

// Mystify and Beziers: a few shapes whose points bounce around the screen, each leaving a
// trail of earlier copies that fade out. Mystify draws polygons; Beziers draws curves.
// Points live in 0..1 coordinates so resizing never loses them. The motion runs on a
// fixed 60 Hz step and a trail copy is kept every few steps, so it looks the same at any
// frame rate.

const STEP = 1 / 60

const createBouncers = (canvas, env, { shapes, points, lines, gap, speed, draw, width }) => {
  const ctx = canvas.getContext("2d", { alpha: false })
  const items = Array.from({ length: shapes }, () => ({
    hue: rand(0, 360),
    hueSpeed: rand(18, 40) * (Math.random() < 0.5 ? -1 : 1),
    pts: Array.from({ length: points }, () => ({
      x: rand(0.1, 0.9),
      y: rand(0.1, 0.9),
      vx: rand(0.12, 0.3) * speed * (Math.random() < 0.5 ? -1 : 1),
      vy: rand(0.12, 0.3) * speed * (Math.random() < 0.5 ? -1 : 1),
    })),
    trail: [], // { xy: Float32Array, hue }
  }))

  let w = 1
  let h = 1
  let dpr = 1
  let acc = 0
  let steps = 0

  const step = () => {
    steps++
    for (const item of items) {
      item.hue = (item.hue + item.hueSpeed * STEP + 360) % 360
      for (const p of item.pts) {
        p.x += p.vx * STEP
        p.y += p.vy * STEP
        if (p.x < 0 || p.x > 1) {
          p.vx = -Math.sign(p.x - 0.5) * Math.abs(p.vx) * rand(0.9, 1.1)
          p.x = Math.min(1, Math.max(0, p.x))
        }
        if (p.y < 0 || p.y > 1) {
          p.vy = -Math.sign(p.y - 0.5) * Math.abs(p.vy) * rand(0.9, 1.1)
          p.y = Math.min(1, Math.max(0, p.y))
        }
      }
      if (steps % gap === 0) {
        const xy = item.trail.length >= lines ? item.trail.shift().xy : new Float32Array(points * 2)
        item.pts.forEach((p, i) => {
          xy[i * 2] = p.x
          xy[i * 2 + 1] = p.y
        })
        item.trail.push({ xy, hue: item.hue })
      }
    }
  }
  for (let i = 0; i < gap * lines; i++) step()

  return {
    resize(cssW, cssH, ratio) {
      const size = fit2d(canvas, cssW, cssH, ratio)
      w = size.width
      h = size.height
      dpr = ratio
    },
    frame(dt) {
      acc += dt
      while (acc >= STEP) {
        acc -= STEP
        step()
      }
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, w, h)
      ctx.lineWidth = Math.max(1, width * dpr * (env.preview ? 0.7 : 1))
      ctx.lineJoin = "round"
      // keep shapes off the very edge so the lines never clip
      const m = 2 * dpr
      const sx = w - m * 2
      const sy = h - m * 2
      for (const item of items) {
        const n = item.trail.length
        item.trail.forEach((copy, k) => {
          const fade = (k + 1) / n
          ctx.strokeStyle = `hsla(${copy.hue.toFixed(0)},100%,${(45 + 15 * fade).toFixed(0)}%,${(fade * fade).toFixed(3)})`
          ctx.beginPath()
          draw(ctx, copy.xy, m, sx, sy)
          ctx.stroke()
        })
      }
    },
    dispose() {},
  }
}

const polygon = (ctx, xy, m, sx, sy) => {
  ctx.moveTo(m + xy[0] * sx, m + xy[1] * sy)
  for (let i = 2; i < xy.length; i += 2) ctx.lineTo(m + xy[i] * sx, m + xy[i + 1] * sy)
  ctx.closePath()
}

// 7 points: start, then two control points and an end for each of two joined curves
const curves = (ctx, xy, m, sx, sy) => {
  const X = (i) => m + xy[i * 2] * sx
  const Y = (i) => m + xy[i * 2 + 1] * sy
  ctx.moveTo(X(0), Y(0))
  ctx.bezierCurveTo(X(1), Y(1), X(2), Y(2), X(3), Y(3))
  ctx.bezierCurveTo(X(4), Y(4), X(5), Y(5), X(6), Y(6))
}

export default function createMystify(canvas, opts, env) {
  return createBouncers(canvas, env, {
    shapes: Math.round(num(opts.shapes, 2, 1, 4)),
    points: 4,
    lines: Math.round(num(opts.lines, 8, 1, 25)),
    gap: 4,
    speed: 1,
    draw: polygon,
    width: 1.5,
  })
}

export function createBeziers(canvas, opts, env) {
  return createBouncers(canvas, env, {
    shapes: Math.round(num(opts.curves, 2, 1, 4)),
    points: 7,
    lines: Math.round(num(opts.length, 12, 2, 30)),
    gap: 3,
    speed: 0.3 + num(opts.speed, 5, 1, 10) * 0.14,
    draw: curves,
    width: 1.3,
  })
}
