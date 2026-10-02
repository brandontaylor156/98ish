import { fit2d, num, rand } from "./util"

// Scrolling Marquee: one line of text sliding right to left, centered or at a new height
// each time it comes round.

const FONTS = {
  serif: '"Times New Roman", Times, serif',
  sans: 'Arial, Helvetica, sans-serif',
  mono: '"Courier New", Courier, monospace',
}

export default function createMarquee(canvas, opts, env) {
  const ctx = canvas.getContext("2d", { alpha: false })
  const text = String(opts.text || "").trim() || "98ish"
  const speed = num(opts.speed, 5, 1, 10)
  const family = FONTS[opts.font] || FONTS.serif
  const color = opts.color || "#ffff00"
  const background = opts.background || "#000000"
  const random = opts.position === "random"

  let w = 1
  let h = 1
  let size = 10
  let textW = 0
  let x = null
  let y = 0

  const place = () => {
    y = random ? rand(size * 1.1, Math.max(size * 1.2, h - size * 0.4)) : h / 2 + size * 0.35
  }

  return {
    resize(cssW, cssH, ratio) {
      const s = fit2d(canvas, cssW, cssH, ratio)
      const scale = x === null ? 0 : x / w
      w = s.width
      h = s.height
      size = Math.round(h * (env.preview ? 0.22 : 0.13))
      ctx.font = `bold ${size}px ${family}`
      textW = ctx.measureText(text).width
      x = x === null ? w : scale * w
      place()
    },
    frame(dt) {
      x -= (0.06 + speed * 0.035) * Math.max(w, h * 1.3) * dt
      if (x + textW < 0) {
        x = w
        if (random) place()
      }
      ctx.fillStyle = background
      ctx.fillRect(0, 0, w, h)
      ctx.font = `bold ${size}px ${family}`
      ctx.fillStyle = color
      ctx.textBaseline = "alphabetic"
      ctx.fillText(text, Math.round(x), Math.round(y))
    },
    dispose() {},
  }
}
