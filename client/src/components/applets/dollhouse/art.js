// Dream House's drawings, all original and all drawn with canvas paths: every catalog
// item, the little people, and the wallpapers and floors. Each item draws itself into
// its own box (0,0)-(w,h) in house units; env is { t (seconds), night, item }.

import { SKINS, HAIR_COLORS, CLOTHES, itemDef } from "./catalogData.js"

export const OL = "#5b4256" // the soft plum outline on everything
const PINK = "#ffb3cf"
const PINKD = "#f27fa8"
const ROSE = "#ff8fb8"
const LILAC = "#c9b3ff"
const LILACD = "#9d82e8"
const MINT = "#a8e6cf"
const MINTD = "#6cc4a1"
const SKY = "#a9dcff"
const SKYD = "#6cb6ea"
const CREAM = "#fff4e0"
const BUTTER = "#ffe28a"
const PEACH = "#ffc6a5"
const WOOD = "#d9a066"
const WOODL = "#ecc591"
const WOODD = "#a8703f"
const WHITE = "#ffffff"
const GRAY = "#d7dae3"
const GRAYD = "#a9adbb"
const GREEN = "#7cc47f"
const GREEND = "#4f9a5d"
const LEAF = "#69b578"
const RED = "#ff6b81"
const NAVY = "#4a4f6e"
const TEAL = "#5fc6c0"
const TAU = Math.PI * 2

// ---------- helpers ----------

const stroke = (c, lw = 2, color = OL) => {
  c.lineWidth = lw
  c.strokeStyle = color
  c.lineJoin = "round"
  c.lineCap = "round"
  c.stroke()
}
const paint = (c, fill, lw = 2) => {
  if (fill) {
    c.fillStyle = fill
    c.fill()
  }
  if (lw) stroke(c, lw)
}
export const rrPath = (c, x, y, w, h, r = 4) => {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}
const box = (c, x, y, w, h, r, fill, lw = 2) => {
  rrPath(c, x, y, w, h, r)
  paint(c, fill, lw)
}
const oval = (c, cx, cy, rx, ry, fill, lw = 2) => {
  c.beginPath()
  c.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU)
  paint(c, fill, lw)
}
const dot = (c, cx, cy, r, fill) => {
  c.beginPath()
  c.arc(cx, cy, Math.max(0.1, r), 0, TAU)
  c.fillStyle = fill
  c.fill()
}
const poly = (c, pts, fill, lw = 2) => {
  c.beginPath()
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
  c.closePath()
  paint(c, fill, lw)
}
const line = (c, pts, color = OL, lw = 2) => {
  c.beginPath()
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
  stroke(c, lw, color)
}
const curve = (c, x0, y0, cx, cy, x1, y1, color = OL, lw = 2) => {
  c.beginPath()
  c.moveTo(x0, y0)
  c.quadraticCurveTo(cx, cy, x1, y1)
  stroke(c, lw, color)
}
export const heartPath = (c, cx, cy, s) => {
  c.beginPath()
  c.moveTo(cx, cy + s * 0.42)
  c.bezierCurveTo(cx - s * 0.95, cy - s * 0.15, cx - s * 0.45, cy - s * 0.85, cx, cy - s * 0.32)
  c.bezierCurveTo(cx + s * 0.45, cy - s * 0.85, cx + s * 0.95, cy - s * 0.15, cx, cy + s * 0.42)
  c.closePath()
}
export const heart = (c, cx, cy, s, fill, lw = 1.5) => {
  heartPath(c, cx, cy, s)
  paint(c, fill, lw)
}
const star = (c, cx, cy, r, fill, lw = 1.2, points = 5) => {
  c.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points
    const rr = i % 2 ? r * 0.45 : r
    c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
  }
  c.closePath()
  paint(c, fill, lw)
}
const shine = (c, x, y, w, h) => {
  rrPath(c, x, y, w, h, Math.min(w, h) / 2)
  c.fillStyle = "rgba(255,255,255,0.55)"
  c.fill()
}
// a cute face: two dot eyes, pink cheeks and a little smile
const face = (c, cx, cy, s, blink = false) => {
  if (blink) {
    line(c, [[cx - s * 0.55, cy], [cx - s * 0.25, cy]], OL, s * 0.18)
    line(c, [[cx + s * 0.25, cy], [cx + s * 0.55, cy]], OL, s * 0.18)
  } else {
    dot(c, cx - s * 0.4, cy, s * 0.16, OL)
    dot(c, cx + s * 0.4, cy, s * 0.16, OL)
  }
  dot(c, cx - s * 0.68, cy + s * 0.3, s * 0.17, "rgba(255,120,150,0.55)")
  dot(c, cx + s * 0.68, cy + s * 0.3, s * 0.17, "rgba(255,120,150,0.55)")
  c.beginPath()
  c.arc(cx, cy + s * 0.12, s * 0.16, 0.15 * Math.PI, 0.85 * Math.PI)
  stroke(c, s * 0.12)
}
const leaf = (c, x, y, len, ang, fill = LEAF, lw = 1.5) => {
  c.save()
  c.translate(x, y)
  c.rotate(ang)
  c.beginPath()
  c.moveTo(0, 0)
  c.quadraticCurveTo(len * 0.5, -len * 0.38, len, 0)
  c.quadraticCurveTo(len * 0.5, len * 0.38, 0, 0)
  paint(c, fill, lw)
  c.restore()
}
const flower = (c, cx, cy, r, petal, center = BUTTER) => {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU
    oval(c, cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, r * 0.55, r * 0.55, petal, 1)
  }
  dot(c, cx, cy, r * 0.45, center)
}
const pot = (c, x, y, w, h, fill = "#f3a07a") => {
  poly(c, [[x, y], [x + w, y], [x + w - w * 0.14, y + h], [x + w * 0.14, y + h]], fill)
  box(c, x - 2, y - 2, w + 4, h * 0.28, 2, fill)
}
const legs = (c, x0, x1, top, bottom, fill = WOODD, wd = 5) => {
  box(c, x0, top, wd, bottom - top, 1.5, fill)
  box(c, x1 - wd, top, wd, bottom - top, 1.5, fill)
}
const glowDot = (c, x, y, r, color, on) => {
  if (!on) return
  const g = c.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, color)
  g.addColorStop(1, "rgba(255,255,255,0)")
  c.fillStyle = g
  c.fillRect(x - r, y - r, r * 2, r * 2)
}

// ---------- the catalog ----------

const DRAW = {
  // ---- furniture ----
  bed(c, w, h) {
    box(c, 2, 12, 14, h - 14, 4, WOOD)
    heart(c, 9, 14, 16, PINKD)
    box(c, 6, h - 9, 6, 9, 1, WOODD)
    box(c, w - 14, h - 9, 6, 9, 1, WOODD)
    box(c, 12, 42, w - 20, 26, 6, CREAM)
    box(c, 44, 34, w - 50, 32, 9, PINK)
    for (let i = 0; i < 4; i++) heart(c, 58 + i * 22, 50 + (i % 2) * 6, 8, WHITE, 0)
    curve(c, 44, 66, 90, 74, w - 8, 64, PINKD, 1.5)
    box(c, 16, 30, 32, 15, 7, WHITE)
    box(c, w - 12, 30, 10, h - 32, 3, WOOD)
  },
  bed_single(c, w, h) {
    box(c, 2, 8, 12, h - 10, 6, LILAC)
    oval(c, 8, 10, 6, 6, LILAC)
    box(c, 6, h - 8, 5, 8, 1, WOODD)
    box(c, w - 12, h - 8, 5, 8, 1, WOODD)
    box(c, 10, 40, w - 14, 24, 6, CREAM)
    box(c, 38, 32, w - 42, 30, 8, MINT)
    for (let x = 46; x < w - 10; x += 12) line(c, [[x, 34], [x, 60]], "rgba(255,255,255,.7)", 2)
    box(c, 14, 28, 28, 15, 7, WHITE)
    heart(c, 28, 36, 8, PINK, 1)
  },
  sofa(c, w, h, e, color = ROSE, dark = PINKD) {
    box(c, 10, 6, w - 20, h - 30, 14, color)
    box(c, 0, 26, 22, h - 32, 10, color)
    box(c, w - 22, 26, 22, h - 32, 10, color)
    box(c, 18, h - 36, w - 36, 20, 6, color)
    line(c, [[w / 2, h - 36], [w / 2, h - 16]], dark, 2)
    box(c, 24, 18, 26, 22, 8, CREAM)
    heart(c, 37, 29, 10, dark, 1)
    box(c, 6, h - 10, 6, 10, 2, WOODD)
    box(c, w - 12, h - 10, 6, 10, 2, WOODD)
  },
  sofa_sage(c, w, h, e) {
    DRAW.sofa(c, w, h, e, "#a9d3a5", "#76ad74")
  },
  armchair(c, w, h) {
    box(c, 8, 4, w - 16, h - 26, 14, BUTTER)
    box(c, 0, 26, 16, h - 34, 8, BUTTER)
    box(c, w - 16, 26, 16, h - 34, 8, BUTTER)
    box(c, 12, h - 32, w - 24, 18, 6, "#ffd36a")
    box(c, 6, h - 10, 5, 10, 2, WOODD)
    box(c, w - 11, h - 10, 5, 10, 2, WOODD)
    dot(c, w / 2, 20, 2.5, OL)
  },
  beanbag(c, w, h) {
    c.beginPath()
    c.moveTo(4, h - 2)
    c.bezierCurveTo(0, h - 26, 16, 2, w / 2, 4)
    c.bezierCurveTo(w - 14, 4, w, h - 24, w - 4, h - 2)
    c.closePath()
    paint(c, LILAC)
    curve(c, 16, h - 14, w / 2, h - 22, w - 14, h - 12, LILACD, 1.5)
    shine(c, 18, 12, 10, 6)
  },
  coffee_table(c, w, h) {
    box(c, 0, 0, w, 8, 4, WOODL)
    legs(c, 8, w - 8, 8, h)
    box(c, 14, 16, w - 28, 5, 2, WOOD)
  },
  dining_table(c, w, h) {
    box(c, 0, 0, w, 8, 3, WOODL)
    poly(c, [[6, 8], [w - 6, 8], [w - 10, 18], [10, 18]], "#ffe3ee", 1.5)
    for (let x = 12; x < w - 12; x += 12) dot(c, x, 13, 2, PINKD)
    legs(c, 10, w - 10, 18, h, WOODD, 6)
  },
  chair(c, w, h) {
    box(c, 4, 0, 8, h, 3, WOOD)
    box(c, 2, 4, 12, 30, 5, PINK)
    box(c, 4, h - 34, w - 4, 7, 3, WOODL)
    box(c, w - 7, h - 27, 5, 27, 1, WOODD)
    heart(c, 8, 17, 7, WHITE, 1)
  },
  stool(c, w, h) {
    box(c, 0, 0, w, 7, 3, MINT)
    line(c, [[6, 7], [3, h]], WOODD, 3)
    line(c, [[w - 6, 7], [w - 3, h]], WOODD, 3)
    line(c, [[5, h - 12], [w - 5, h - 12]], WOODD, 2)
  },
  desk(c, w, h) {
    box(c, 0, 0, w, 8, 3, WOODL)
    box(c, w - 40, 8, 36, h - 8, 3, WOOD)
    box(c, w - 36, 14, 28, 14, 2, WOODL)
    box(c, w - 36, 32, 28, 14, 2, WOODL)
    dot(c, w - 22, 21, 2, OL)
    dot(c, w - 22, 39, 2, OL)
    box(c, 6, 8, 6, h - 8, 1.5, WOODD)
  },
  nightstand(c, w, h) {
    box(c, 0, 0, w, h - 6, 4, WOODL)
    box(c, 5, 8, w - 10, 13, 2, CREAM)
    box(c, 5, 24, w - 10, 13, 2, CREAM)
    heart(c, w / 2, 15, 6, PINK, 1)
    heart(c, w / 2, 31, 6, PINK, 1)
    box(c, 3, h - 6, 5, 6, 1, WOODD)
    box(c, w - 8, h - 6, 5, 6, 1, WOODD)
  },
  dresser(c, w, h) {
    box(c, 0, 0, w, h - 6, 4, "#f7d1dc")
    for (let i = 0; i < 3; i++) {
      box(c, 6, 7 + i * 18, w - 12, 15, 3, "#fde8ee", 1.5)
      oval(c, w / 2, 14.5 + i * 18, 6, 2.5, WOODD, 1)
    }
    box(c, 4, h - 6, 6, 6, 1, WOODD)
    box(c, w - 10, h - 6, 6, 6, 1, WOODD)
  },
  wardrobe(c, w, h) {
    box(c, 0, 6, w, h - 12, 6, WOODL)
    poly(c, [[-2, 8], [w / 2, -1], [w + 2, 8]], WOOD)
    line(c, [[w / 2, 12], [w / 2, h - 12]])
    box(c, 6, 14, w / 2 - 10, h - 34, 4, "#f6dcc0", 1.5)
    box(c, w / 2 + 4, 14, w / 2 - 10, h - 34, 4, "#f6dcc0", 1.5)
    heart(c, w / 4 + 1, 40, 12, PINK, 1)
    heart(c, (3 * w) / 4 - 1, 40, 12, PINK, 1)
    dot(c, w / 2 - 5, h / 2, 2.5, OL)
    dot(c, w / 2 + 5, h / 2, 2.5, OL)
    box(c, 4, h - 6, 8, 6, 1, WOODD)
    box(c, w - 12, h - 6, 8, 6, 1, WOODD)
  },
  bookshelf(c, w, h) {
    box(c, 0, 0, w, h, 4, WOOD)
    const cols = [PINK, SKY, MINT, BUTTER, LILAC, PEACH, RED, TEAL]
    for (let s = 0; s < 4; s++) {
      const y = 6 + s * 33
      box(c, 5, y, w - 10, 28, 2, "#8a5a33", 1.5)
      let x = 8
      let n = s * 3
      while (x < w - 14) {
        const bw = 6 + ((n * 7) % 5)
        const bh = 18 + ((n * 5) % 8)
        if (s === 2 && x > w / 2) {
          oval(c, x + 8, y + 18, 8, 9, LEAF, 1.5)
          box(c, x + 2, y + 18, 12, 9, 2, "#f3a07a", 1.5)
          break
        }
        box(c, x, y + 28 - bh, bw, bh, 1, cols[n % cols.length], 1.2)
        x += bw + 1
        n++
      }
    }
  },
  vanity(c, w, h) {
    oval(c, w / 2, 26, 24, 26, "#fde8ee")
    oval(c, w / 2, 26, 18, 20, "#dff4ff", 1.5)
    shine(c, w / 2 - 10, 12, 5, 14)
    star(c, w / 2 + 9, 14, 3, WHITE, 0)
    box(c, 0, 54, w, 8, 3, WOODL)
    box(c, 4, 62, 24, h - 62, 3, "#f7d1dc")
    box(c, w - 28, 62, 24, h - 62, 3, "#f7d1dc")
    dot(c, 16, 74, 2, OL)
    dot(c, w - 16, 74, 2, OL)
    box(c, 34, 46, 7, 9, 2, PINKD, 1)
    box(c, 45, 44, 6, 11, 2, LILAC, 1)
  },
  side_table(c, w, h) {
    oval(c, w / 2, 4, w / 2, 4, WOODL)
    line(c, [[w / 2, 8], [w / 2, h - 4]], WOODD, 4)
    oval(c, w / 2, h - 3, 12, 3, WOODD)
  },
  pouf(c, w, h) {
    box(c, 0, 2, w, h - 2, 12, PEACH)
    line(c, [[w / 2, 6], [w / 2, h - 3]], "#f0a080", 1.5)
    line(c, [[8, h / 2 + 1], [w - 8, h / 2 + 1]], "#f0a080", 1.5)
    dot(c, w / 2, h / 2 + 1, 2.5, OL)
  },
  wall_shelf(c, w, h) {
    box(c, 0, 0, w, 7, 2, WOODL)
    poly(c, [[8, 7], [16, 7], [8, h]], WOODD, 1.5)
    poly(c, [[w - 16, 7], [w - 8, 7], [w - 8, h]], WOODD, 1.5)
  },

  // ---- kitchen ----
  fridge(c, w, h) {
    box(c, 0, 0, w, h - 4, 10, "#cdeee6")
    line(c, [[2, 44], [w - 2, 44]])
    box(c, w - 12, 12, 5, 22, 2, WHITE, 1.5)
    box(c, w - 12, 54, 5, 30, 2, WHITE, 1.5)
    heart(c, 16, 60, 10, PINKD, 1)
    star(c, 28, 78, 6, BUTTER, 1)
    box(c, 10, 88, 16, 12, 1, WHITE, 1)
    line(c, [[13, 92], [23, 92]], SKYD, 1)
    line(c, [[13, 96], [21, 96]], SKYD, 1)
    shine(c, 6, 6, 5, 30)
    box(c, 4, h - 4, 8, 4, 1, GRAYD)
    box(c, w - 12, h - 4, 8, 4, 1, GRAYD)
  },
  stove(c, w, h) {
    box(c, 0, 0, w, 6, 2, GRAYD)
    oval(c, 18, 0, 10, 2.5, NAVY, 1)
    oval(c, w - 18, 0, 10, 2.5, NAVY, 1)
    box(c, 0, 14, w, h - 18, 5, "#ffd9c7")
    box(c, 0, 6, w, 10, 2, "#fff0e8")
    for (let i = 0; i < 4; i++) dot(c, 12 + i * 13, 11, 2.5, OL)
    box(c, 8, 22, w - 16, h - 36, 5, "#5b4256")
    box(c, 13, 27, w - 26, h - 46, 4, "#ffcf7a", 0)
    line(c, [[14, 22 + 4], [w - 14, 22 + 4]], GRAYD, 2)
    box(c, 4, h - 4, 7, 4, 1, GRAYD)
    box(c, w - 11, h - 4, 7, 4, 1, GRAYD)
  },
  counter_sink(c, w, h) {
    DRAW.counter(c, w, h - 12, null, 12)
    line(c, [[w / 2 + 10, 12], [w / 2 + 10, 0], [w / 2 - 2, 0], [w / 2 - 2, 4]], GRAYD, 3)
    box(c, w / 2 - 22, 10, 44, 4, 2, "#cfe9f5", 1.2)
  },
  counter(c, w, h, e, dy = 0) {
    c.save()
    c.translate(0, dy)
    box(c, 0, 0, w, 7, 2, "#f7f1ea")
    box(c, 2, 7, w - 4, h - 9, 3, MINT)
    line(c, [[w / 2, 9], [w / 2, h - 4]])
    box(c, 6, 11, w / 2 - 10, h - 19, 2, "#c9f0e0", 1.2)
    box(c, w / 2 + 4, 11, w / 2 - 10, h - 19, 2, "#c9f0e0", 1.2)
    dot(c, w / 2 - 6, 24, 2, OL)
    dot(c, w / 2 + 6, 24, 2, OL)
    c.restore()
  },
  wall_cabinet(c, w, h) {
    box(c, 0, 0, w, h, 4, MINT)
    line(c, [[w / 2, 2], [w / 2, h - 2]])
    box(c, 6, 6, w / 2 - 12, h - 12, 3, "#dff7ee", 1.2)
    box(c, w / 2 + 6, 6, w / 2 - 12, h - 12, 3, "#dff7ee", 1.2)
    heart(c, w / 4, h / 2 + 1, 9, PINK, 1)
    heart(c, (3 * w) / 4, h / 2 + 1, 9, PINK, 1)
  },
  pans(c, w, h) {
    line(c, [[2, 4], [w - 2, 4]], WOODD, 4)
    const items = [[12, 28, 10, "#f7b267"], [34, 34, 13, "#e98a8a"], [60, 26, 9, SKYD]]
    for (const [x, len, r, col] of items) {
      line(c, [[x, 4], [x, 4 + len - r * 2]], GRAYD, 2)
      oval(c, x, 4 + len - r, r, r, col)
      oval(c, x, 4 + len - r, r * 0.55, r * 0.55, "rgba(255,255,255,.35)", 0)
    }
    line(c, [[w - 8, 4], [w - 8, 30]], GRAYD, 2)
    oval(c, w - 8, 36, 4, 7, WOODL, 1.5)
  },
  microwave(c, w, h) {
    box(c, 0, 0, w, h, 4, "#ffe2ea")
    box(c, 4, 4, w - 16, h - 8, 3, NAVY, 1.5)
    shine(c, 7, 6, 10, 3)
    dot(c, w - 6, 8, 2, OL)
    dot(c, w - 6, 15, 2, OL)
    box(c, w - 9, 20, 6, 4, 1, PINKD, 1)
  },
  kettle(c, w, h, e) {
    poly(c, [[5, h], [w - 5, h], [w - 8, 8], [8, 8]], "#ff9ea5")
    oval(c, w / 2, 8, 7, 3, "#ff9ea5")
    dot(c, w / 2, 3, 2.5, OL)
    line(c, [[w - 7, 14], [w, 8]], OL, 3)
    curve(c, 7, 12, -2, 16, 6, h - 4)
    shine(c, 8, 12, 3, 8)
    if (e && Math.sin(e.t * 1.3) > 0.3) {
      const a = Math.sin(e.t * 2) * 2
      curve(c, w, 4, w + 3 + a, -2, w + 1, -8, "rgba(255,255,255,0.8)", 2)
    }
  },
  toaster(c, w, h, e) {
    const pop = e ? Math.max(0, Math.sin(e.t * 0.7)) ** 8 * 8 : 0
    box(c, 6, 0 - pop, 7, 10, 2, "#f1c27d", 1.2)
    box(c, 17, 0 - pop, 7, 10, 2, "#f1c27d", 1.2)
    box(c, 0, 5, w, h - 5, 6, "#bfe7ff")
    shine(c, 4, 8, 10, 3)
    box(c, w - 6, 10, 4, 6, 1, OL, 0)
  },
  coffee_maker(c, w, h) {
    box(c, 0, 0, w, 10, 3, NAVY)
    box(c, 0, 0, 8, h, 2, NAVY)
    box(c, 0, h - 5, w, 5, 2, NAVY)
    box(c, 11, h - 20, 13, 15, 3, CREAM)
    curve(c, 24, h - 16, 29, h - 12, 24, h - 9)
    heart(c, 17, h - 13, 6, PINKD, 0)
    dot(c, 15, 14, 2, "#c58b5a")
  },
  teapot(c, w, h) {
    oval(c, w / 2, h - 10, 12, 10, "#c9e9ff")
    line(c, [[w / 2 + 10, h - 12], [w, h - 18]], OL, 3)
    curve(c, w / 2 - 11, h - 15, 0, h - 10, w / 2 - 10, h - 5)
    oval(c, w / 2, h - 19, 6, 2.5, "#c9e9ff")
    dot(c, w / 2, h - 23, 2, OL)
    flower(c, w / 2, h - 9, 3.5, PINK)
  },
  fruit_bowl(c, w, h) {
    dot(c, 12, 8, 6, RED)
    dot(c, 22, 6, 6, "#ffb347")
    dot(c, 29, 9, 5, "#b5e26b")
    line(c, [[22, 0], [23, -3]], WOODD, 1.5)
    c.beginPath()
    c.moveTo(1, 9)
    c.quadraticCurveTo(w / 2, h + 6, w - 1, 9)
    c.closePath()
    paint(c, "#bfe7ff")
    for (let x = 8; x < w - 4; x += 8) dot(c, x, 13, 1.5, WHITE)
  },
  cake(c, w, h) {
    box(c, 0, h - 4, w, 4, 2, WHITE)
    box(c, 3, h - 22, w - 6, 18, 3, "#ffd6e5")
    box(c, 3, h - 22, w - 6, 6, 3, WHITE)
    for (let x = 7; x < w - 4; x += 6) dot(c, x, h - 16, 2, WHITE)
    dot(c, 10, h - 25, 4, RED)
    dot(c, w / 2, h - 26, 4, RED)
    dot(c, w - 10, h - 25, 4, RED)
    box(c, w / 2 - 1.5, h - 34, 3, 8, 1, SKY, 1)
  },
  herbs(c, w, h) {
    for (let i = 0; i < 3; i++) {
      const x = 2 + i * 13
      for (let j = 0; j < 4; j++) leaf(c, x + 6, 12, 8, -Math.PI / 2 + (j - 1.5) * 0.45, j % 2 ? LEAF : GREEN, 1)
      pot(c, x + 1, 12, 10, h - 12, ["#f3a07a", "#bfe7ff", "#ffd6e5"][i])
    }
  },

  // ---- bath ----
  bathtub(c, w, h, e) {
    oval(c, 30, 20, 10, 6, WHITE, 1.5)
    oval(c, 46, 14, 12, 8, WHITE, 1.5)
    oval(c, 66, 18, 10, 7, WHITE, 1.5)
    oval(c, 86, 15, 9, 6, WHITE, 1.5)
    if (e) {
      const b = (e.t * 8) % 20
      oval(c, 60 + Math.sin(e.t) * 6, 8 - b, 3, 3, "rgba(200,235,255,.8)", 1)
    }
    c.beginPath()
    c.moveTo(4, 22)
    c.lineTo(w - 4, 22)
    c.quadraticCurveTo(w - 6, h - 10, w - 30, h - 8)
    c.lineTo(30, h - 8)
    c.quadraticCurveTo(6, h - 10, 4, 22)
    c.closePath()
    paint(c, "#fff6fb")
    box(c, 0, 18, w, 8, 4, "#ffc9de")
    line(c, [[w - 14, 18], [w - 14, 4], [w - 26, 4]], GRAYD, 3)
    poly(c, [[26, h - 9], [34, h - 9], [30, h]], GRAYD, 1.5)
    poly(c, [[w - 34, h - 9], [w - 26, h - 9], [w - 30, h]], GRAYD, 1.5)
  },
  toilet(c, w, h) {
    box(c, 2, 0, 18, 34, 4, WHITE)
    box(c, 0, 30, w, 9, 4, "#ffe3ee")
    c.beginPath()
    c.moveTo(6, 39)
    c.quadraticCurveTo(w / 2 + 6, 62, w - 4, 39)
    c.closePath()
    paint(c, WHITE)
    box(c, 14, 50, 16, h - 50, 3, WHITE)
    dot(c, 11, 8, 2, GRAYD)
  },
  bath_sink(c, w, h) {
    line(c, [[w / 2, 50], [w / 2, 42], [w / 2 + 8, 42]], GRAYD, 3)
    c.beginPath()
    c.moveTo(0, 54)
    c.quadraticCurveTo(w / 2, 74, w, 54)
    c.closePath()
    paint(c, WHITE)
    box(c, 0, 52, w, 6, 3, "#e8f6ff")
    poly(c, [[w / 2 - 8, 64], [w / 2 + 8, 64], [w / 2 + 6, h], [w / 2 - 6, h]], WHITE)
  },
  mirror(c, w, h) {
    box(c, 0, 0, w, h, w / 2, "#f7d1dc")
    box(c, 5, 5, w - 10, h - 10, w / 2 - 5, "#e2f4ff", 1.5)
    shine(c, 12, 12, 5, 18)
    shine(c, 20, 10, 3, 8)
    heart(c, w / 2, 2, 10, PINKD, 1.2)
  },
  towels(c, w, h) {
    line(c, [[2, 6], [w - 2, 6]], GRAYD, 3)
    dot(c, 2, 6, 3, GRAYD)
    dot(c, w - 2, 6, 3, GRAYD)
    box(c, 6, 4, 18, h - 6, 3, PINK)
    for (let y = 14; y < h - 6; y += 8) line(c, [[8, y], [22, y]], WHITE, 1.5)
    box(c, 28, 4, 18, h - 16, 3, SKY)
    line(c, [[30, h - 18], [44, h - 18]], WHITE, 2)
  },
  duck(c, w, h) {
    oval(c, 10, h - 6, 9, 6, BUTTER)
    dot(c, 15, 5, 5.5, BUTTER)
    c.beginPath()
    c.arc(15, 5, 5.5, 0, TAU)
    stroke(c, 1.5)
    poly(c, [[19, 5], [w, 6], [19, 8]], "#ff9f43", 1)
    dot(c, 16, 4, 1.2, OL)
    curve(c, 5, h - 8, 9, h - 10, 12, h - 7, "#e8b84a", 1.5)
  },
  bath_mat(c, w, h) {
    oval(c, w / 2, h / 2, w / 2, h / 2, MINT)
    oval(c, w / 2, h / 2, w / 2 - 6, h / 2 - 2.5, null, 1)
    for (let x = 12; x < w - 8; x += 10) dot(c, x, h / 2, 1.5, WHITE)
  },
  laundry(c, w, h) {
    oval(c, 12, 6, 9, 6, PINK, 1.5)
    oval(c, 26, 5, 9, 5, SKY, 1.5)
    poly(c, [[0, 8], [w, 8], [w - 4, h], [4, h]], "#f3dfc0")
    for (let y = 13; y < h; y += 6) line(c, [[3, y], [w - 3, y]], "#d8b98d", 1.2)
    box(c, -1, 7, w + 2, 5, 2, "#e8c99a")
  },
  soaps(c, w, h) {
    box(c, 0, h - 18, 10, 18, 3, PINK)
    box(c, 3, h - 22, 4, 4, 1, WHITE, 1)
    box(c, 12, h - 24, 10, 24, 4, LILAC)
    box(c, 15, h - 28, 4, 4, 1, WHITE, 1)
    oval(c, 28, h - 4, 6, 4, MINT)
    dot(c, 26, h - 10, 2, WHITE)
    dot(c, 30, h - 13, 1.5, WHITE)
  },

  // ---- decor ----
  rug_round(c, w, h) {
    oval(c, w / 2, h / 2, w / 2, h / 2, "#ffc9de")
    oval(c, w / 2, h / 2, w / 2 - 12, h / 2 - 4, "#ffe3ee", 1.2)
    oval(c, w / 2, h / 2, w / 2 - 28, h / 2 - 7, PINK, 1.2)
  },
  rug_heart(c, w, h) {
    c.save()
    c.translate(w / 2, h / 2)
    c.scale(1, 0.24)
    heart(c, 0, 8, w * 0.95, ROSE, 6)
    heart(c, 0, 4, w * 0.62, "#ffd6e5", 5)
    c.restore()
  },
  rug_stripe(c, w, h) {
    box(c, 0, 0, w, h, 4, CREAM)
    const cols = [SKY, BUTTER, PINK, MINT, LILAC]
    for (let i = 0; i < 9; i++) box(c, 8 + i * 13, 2, 7, h - 4, 1, cols[i % 5], 0)
    box(c, 0, 0, w, h, 4, null)
    for (const x of [0, w]) for (let y = 3; y < h; y += 4) line(c, [[x, y], [x + (x ? 4 : -4), y]], OL, 1)
  },
  poster_heart(c, w, h) {
    box(c, 0, 0, w, h, 2, "#fff0f5")
    heart(c, w / 2, h / 2 - 2, 34, ROSE)
    shine(c, w / 2 - 10, h / 2 - 12, 6, 4)
    line(c, [[10, h - 9], [w - 10, h - 9]], PINKD, 2)
    dot(c, w / 2, 3, 2, RED)
  },
  poster_cat(c, w, h) {
    box(c, 0, 0, w, h, 2, "#e8f6ff")
    oval(c, w / 2, h - 18, 14, 12, "#ffd9a8")
    oval(c, w / 2, h / 2 - 2, 14, 12, "#ffd9a8")
    poly(c, [[w / 2 - 13, h / 2 - 8], [w / 2 - 11, h / 2 - 20], [w / 2 - 3, h / 2 - 12]], "#ffd9a8", 1.5)
    poly(c, [[w / 2 + 13, h / 2 - 8], [w / 2 + 11, h / 2 - 20], [w / 2 + 3, h / 2 - 12]], "#ffd9a8", 1.5)
    face(c, w / 2, h / 2, 6)
    heart(c, 10, 10, 8, PINK, 1)
    dot(c, w / 2, 3, 2, SKYD)
  },
  poster_rainbow(c, w, h) {
    box(c, 0, 0, w, h, 2, "#fffaf0")
    const cols = ["#ff8fa3", "#ffc078", "#ffe17a", "#9be3b5", "#8fd0ff", "#b9a2ff"]
    cols.forEach((col, i) => {
      c.beginPath()
      c.arc(w / 2, h / 2 + 12, 20 - i * 3, Math.PI, 0)
      c.lineWidth = 3.2
      c.strokeStyle = col
      c.stroke()
    })
    oval(c, w / 2 - 18, h / 2 + 14, 8, 5, WHITE, 1.5)
    oval(c, w / 2 + 18, h / 2 + 14, 8, 5, WHITE, 1.5)
    dot(c, w / 2, 3, 2, LILACD)
  },
  photo_frame(c, w, h) {
    box(c, 0, 0, w, h, 3, "#f6c9a8")
    box(c, 5, 5, w - 10, h - 10, 2, "#dff1ff", 1.5)
    oval(c, w / 2, h - 6, w / 2 - 6, 4, "#b8e2a6", 0)
    dot(c, 15, 18, 4, "#f6cba8")
    box(c, 11, 22, 8, 10, 3, PINK, 1)
    dot(c, 29, 18, 4, "#c68658")
    box(c, 25, 22, 8, 10, 3, SKY, 1)
    heart(c, w / 2, 12, 7, RED, 0)
    heart(c, w - 4, 4, 9, ROSE, 1)
  },
  painting(c, w, h) {
    box(c, 0, 0, w, h, 2, "#e0b16a")
    box(c, 5, 5, w - 10, h - 10, 1, "#cfefff", 1.5)
    c.save()
    rrPath(c, 5, 5, w - 10, h - 10, 1)
    c.clip()
    oval(c, 24, h - 4, 34, 18, "#a5dc97", 1.2)
    oval(c, w - 22, h - 2, 36, 22, "#86cf8e", 1.2)
    dot(c, w - 18, 16, 6, BUTTER)
    oval(c, 22, 15, 8, 4, WHITE, 0)
    oval(c, 30, 13, 6, 4, WHITE, 0)
    for (let i = 0; i < 4; i++) dot(c, 18 + i * 10, h - 14 + (i % 2) * 3, 2, PINKD)
    c.restore()
  },
  clock(c, w, h, e) {
    oval(c, w / 2, h / 2, w / 2 - 1, h / 2 - 1, "#ffe3ee")
    oval(c, w / 2, h / 2, w / 2 - 5, h / 2 - 5, WHITE, 1.2)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU
      dot(c, w / 2 + Math.cos(a) * 12, h / 2 + Math.sin(a) * 12, i % 3 ? 0.9 : 1.6, OL)
    }
    const now = new Date()
    const hr = ((now.getHours() % 12) + now.getMinutes() / 60) / 12
    const mn = now.getMinutes() / 60
    const hand = (f, len, lw) => line(c, [[w / 2, h / 2], [w / 2 + Math.sin(f * TAU) * len, h / 2 - Math.cos(f * TAU) * len]], OL, lw)
    hand(hr, 7, 2.2)
    hand(mn, 10.5, 1.5)
    heart(c, w / 2, h / 2 + 1, 4, PINKD, 0)
  },
  window_round(c, w, h, e) {
    oval(c, w / 2, h / 2, w / 2 - 1, h / 2 - 1, WOODL)
    windowSky(c, w / 2, h / 2, w / 2 - 6, e?.night, e?.t || 0)
    line(c, [[w / 2, 5], [w / 2, h - 5]], WOODL, 3)
    line(c, [[5, h / 2], [w - 5, h / 2]], WOODL, 3)
    oval(c, w / 2, h / 2, w / 2 - 6, h / 2 - 6, null, 1.5)
  },
  window(c, w, h, e) {
    box(c, 0, 0, w, h - 8, 4, WHITE)
    c.save()
    rrPath(c, 6, 6, w - 12, h - 20, 2)
    c.clip()
    skyFill(c, 6, 6, w - 12, h - 20, e?.night, e?.t || 0)
    c.restore()
    rrPath(c, 6, 6, w - 12, h - 20, 2)
    stroke(c, 1.5)
    line(c, [[w / 2, 6], [w / 2, h - 14]], WHITE, 3)
    line(c, [[6, (h - 8) / 2], [w - 6, (h - 8) / 2]], WHITE, 3)
    box(c, -4, h - 10, w + 8, 8, 3, WOODL)
    flower(c, 12, h - 13, 3.5, PINK)
    flower(c, w - 12, h - 13, 3.5, LILAC)
  },
  curtains(c, w, h, e) {
    c.save()
    c.translate(12, 10)
    DRAW.window(c, w - 24, h - 14, e)
    c.restore()
    line(c, [[0, 6], [w, 6]], WOODD, 4)
    for (const side of [0, 1]) {
      c.save()
      if (side) {
        c.translate(w, 0)
        c.scale(-1, 1)
      }
      c.beginPath()
      c.moveTo(2, 6)
      c.lineTo(30, 6)
      c.quadraticCurveTo(18, h * 0.45, 26, h - 6)
      c.lineTo(4, h - 6)
      c.closePath()
      paint(c, PINK)
      for (let i = 0; i < 3; i++) curve(c, 8 + i * 6, 10, 6 + i * 6, h * 0.5, 9 + i * 6, h - 10, PINKD, 1)
      box(c, 12, h * 0.48, 12, 6, 3, BUTTER, 1.2)
      c.restore()
    }
  },
  garland(c, w, h) {
    c.beginPath()
    c.moveTo(0, 4)
    c.quadraticCurveTo(w / 2, 22, w, 4)
    stroke(c, 1.5)
    const cols = [PINKD, PINK, RED, LILAC, ROSE]
    for (let i = 0; i < 8; i++) {
      const tt = (i + 0.5) / 8
      const x = tt * w
      const y = 4 + 18 * 2 * tt * (1 - tt) * 2 * 0.5 + 2
      heart(c, x, y + 6, 13, cols[i % cols.length], 1.2)
    }
  },
  balloons(c, w, h, e) {
    const sway = e ? Math.sin(e.t * 1.2) * 2 : 0
    const b = [[14, 18, PINK], [w - 14, 22, SKY], [w / 2, 10, BUTTER]]
    for (const [x, y] of b) curve(c, x + sway, y + 14, x, h * 0.7, w / 2, h - 4, OL, 1)
    for (const [x, y, col] of b) {
      oval(c, x + sway, y, 12, 14, col)
      shine(c, x + sway - 6, y - 8, 4, 7)
      poly(c, [[x + sway - 2, y + 14], [x + sway + 2, y + 14], [x + sway, y + 17]], col, 1)
    }
    box(c, w / 2 - 4, h - 6, 8, 6, 2, PINKD, 1)
  },
  home_sign(c, w, h) {
    line(c, [[10, 8], [w / 2, -6], [w - 10, 8]], OL, 1.5)
    box(c, 0, 6, w, h - 6, 6, WOODL)
    box(c, 4, 10, w - 8, h - 14, 4, "#fff1dd", 1.2)
    c.fillStyle = PINKD
    c.font = "bold 15px 'Comic Sans MS', 'Chalkboard SE', cursive"
    c.textAlign = "center"
    c.textBaseline = "middle"
    c.fillText("home", w / 2 - 6, h / 2 + 4)
    heart(c, w - 14, h / 2 + 3, 9, RED, 1)
  },
  teddy(c, w, h) {
    dot(c, 8, 8, 5, "#c8945f")
    dot(c, w - 8, 8, 5, "#c8945f")
    oval(c, w / 2, h - 10, 12, 10, "#d9a56e")
    oval(c, w / 2, 14, 11, 10, "#d9a56e")
    c.beginPath()
    c.arc(8, 8, 5, 0, TAU)
    stroke(c, 1.5)
    c.beginPath()
    c.arc(w - 8, 8, 5, 0, TAU)
    stroke(c, 1.5)
    oval(c, w / 2, 18, 5, 3.5, "#f3d3ad", 1)
    dot(c, w / 2, 16.5, 1.6, OL)
    dot(c, w / 2 - 5, 12, 1.5, OL)
    dot(c, w / 2 + 5, 12, 1.5, OL)
    oval(c, 6, h - 6, 5, 4, "#d9a56e", 1.5)
    oval(c, w - 6, h - 6, 5, 4, "#d9a56e", 1.5)
    heart(c, w / 2, h - 10, 8, PINKD, 1)
    poly(c, [[w / 2 - 6, 22], [w / 2, 25], [w / 2 + 6, 22], [w / 2 + 6, 28], [w / 2, 25], [w / 2 - 6, 28]], RED, 1)
  },
  cushion(c, w, h) {
    heart(c, w / 2, h / 2 + 2, w, PINK, 2)
    heart(c, w / 2, h / 2 + 1, w * 0.45, WHITE, 0)
  },

  // ---- lights ----
  floor_lamp(c, w, h, e) {
    glowDot(c, w / 2, 20, 26, "rgba(255,230,160,0.9)", e?.night)
    poly(c, [[6, 30], [w - 6, 30], [w - 12, 4], [12, 4]], BUTTER)
    for (let x = 12; x < w - 8; x += 7) dot(c, x, 30, 1.6, PINKD)
    line(c, [[w / 2, 30], [w / 2, h - 6]], WOODD, 3)
    oval(c, w / 2, h - 4, 14, 4, WOODD)
  },
  table_lamp(c, w, h, e) {
    glowDot(c, w / 2, 10, 18, "rgba(255,230,160,0.9)", e?.night)
    line(c, [[w / 2, 16], [w / 2, h - 16]], WOODD, 2.5)
    poly(c, [[2, 18], [w - 2, 18], [w - 7, 2], [7, 2]], "#ffd6e5")
    oval(c, w / 2, h - 10, 8, 9, MINT)
    shine(c, w / 2 - 5, h - 16, 3, 6)
    box(c, w / 2 - 6, h - 3, 12, 3, 1, WOODD, 1)
  },
  pendant(c, w, h, e) {
    line(c, [[w / 2, 0], [w / 2, h - 26]], OL, 1.5)
    glowDot(c, w / 2, h - 8, 26, "rgba(255,230,160,0.9)", e?.night)
    c.beginPath()
    c.moveTo(2, h - 8)
    c.quadraticCurveTo(w / 2, h - 44, w - 2, h - 8)
    c.closePath()
    paint(c, "#ffc9a8")
    dot(c, w / 2, h - 6, 5, e?.night ? "#fff6c8" : "#fff2d6")
  },
  fairy_lights(c, w, h, e) {
    c.beginPath()
    c.moveTo(0, 4)
    c.quadraticCurveTo(w / 4, 20, w / 2, 6)
    c.quadraticCurveTo((3 * w) / 4, 20, w, 4)
    stroke(c, 1.2)
    const cols = ["#ffe17a", "#ff9ccc", "#9fe0ff", "#b6f0b0", "#d2b6ff"]
    for (let i = 0; i < 12; i++) {
      const tt = (i + 0.5) / 12
      const half = tt < 0.5 ? tt * 2 : (tt - 0.5) * 2
      const x = tt * w
      const y = 4 + 16 * 2 * half * (1 - half) * 2 * 0.55 + 4
      const on = e ? Math.sin(e.t * 2.4 + i * 1.7) > -0.3 : true
      if (e?.night && on) glowDot(c, x, y + 3, 9, cols[i % 5], true)
      oval(c, x, y + 3, 2.8, 3.6, on ? cols[i % 5] : "#e9e2ea", 1)
    }
  },
  lava_lamp(c, w, h, e) {
    poly(c, [[3, 8], [w - 3, 8], [w - 1, h - 10], [1, h - 10]], "#ffd6f0")
    const t = e?.t || 0
    dot(c, w / 2 + Math.sin(t) * 2, 14 + ((t * 6) % 18), 3.5, "#ff6fb5")
    dot(c, w / 2 - Math.sin(t * 0.7) * 2, h - 16 - ((t * 4) % 14), 3, "#ff6fb5")
    poly(c, [[3, 8], [w - 3, 8], [w - 1, h - 10], [1, h - 10]], null, 1.5)
    poly(c, [[5, 2], [w - 5, 2], [w - 3, 8], [3, 8]], LILACD, 1.5)
    poly(c, [[1, h - 10], [w - 1, h - 10], [w + 2, h], [-2, h]], LILACD, 1.5)
  },
  neon_heart(c, w, h, e) {
    box(c, 0, 0, w, h, 6, "rgba(255,255,255,0.15)", 1)
    heartPath(c, w / 2, h / 2 + 2, 40)
    if (e?.night) {
      c.shadowColor = "#ff5fa8"
      c.shadowBlur = 12
    }
    stroke(c, 4, e?.night ? "#ffd0e6" : "#ff7fb6")
    c.shadowBlur = 0
    heartPath(c, w / 2, h / 2 + 2, 40)
    stroke(c, 1.5, "#ff3d8e")
  },
  candles(c, w, h, e) {
    const flick = e ? Math.sin(e.t * 9) * 0.6 : 0
    const cs = [[3, 14, CREAM], [13, 20, "#ffd6e5"], [24, 11, LILAC]]
    for (const [x, ch, col] of cs) {
      glowDot(c, x + 4, h - ch - 6, 10, "rgba(255,200,120,0.9)", e?.night)
      box(c, x, h - ch, 8, ch, 2, col, 1.5)
      line(c, [[x + 4, h - ch], [x + 4, h - ch - 3]], OL, 1)
      c.beginPath()
      c.ellipse(x + 4 + flick * 0.5, h - ch - 6, 2.2, 4 + flick * 0.4, 0, 0, TAU)
      c.fillStyle = "#ffb347"
      c.fill()
      dot(c, x + 4, h - ch - 5, 1.2, "#fff6c8")
    }
  },
  star_mobile(c, w, h, e) {
    const sw = e ? Math.sin(e.t * 0.8) * 0.12 : 0
    line(c, [[w / 2, 0], [w / 2, 14]], OL, 1.2)
    c.save()
    c.translate(w / 2, 14)
    c.rotate(sw)
    line(c, [[-w / 2 + 4, 0], [w / 2 - 4, 0]], WOODD, 2)
    const hang = [[-w / 2 + 6, 26, BUTTER, "star"], [0, 46, "#fff2a8", "moon"], [w / 2 - 6, 32, PINK, "star"]]
    for (const [x, len, col, kind] of hang) {
      line(c, [[x, 0], [x, len - 6]], OL, 1)
      if (e?.night) glowDot(c, x, len, 12, "rgba(255,240,170,0.8)", true)
      if (kind === "star") star(c, x, len, 7, col)
      else {
        c.beginPath()
        c.arc(x, len, 8, 0.6, TAU - 0.6 + 0.6)
        c.arc(x + 4, len - 2, 6.5, TAU, 0, true)
        c.closePath()
        paint(c, col, 1.2)
      }
    }
    c.restore()
  },
  lantern(c, w, h, e) {
    line(c, [[w / 2 - 4, 4], [w / 2, -2], [w / 2 + 4, 4]], OL, 1.5)
    box(c, 2, 4, w - 4, 4, 2, NAVY, 1.2)
    box(c, 3, 8, w - 6, h - 14, 3, e?.night ? "#fff1b8" : "#e6f6ff")
    if (e?.night) glowDot(c, w / 2, h / 2, 12, "rgba(255,210,120,0.9)", true)
    c.beginPath()
    c.ellipse(w / 2, h / 2 + 2, 2.5, 4.5, 0, 0, TAU)
    c.fillStyle = "#ffb347"
    c.fill()
    line(c, [[w / 2, 8], [w / 2, h - 6]], NAVY, 1)
    box(c, 1, h - 6, w - 2, 6, 2, NAVY, 1.2)
  },

  // ---- plants ----
  monstera(c, w, h) {
    const ls = [[-2.3, 30, 30], [-1.9, 36, 34], [-1.4, 32, 38], [-0.9, 30, 32], [-2.7, 22, 28], [-0.5, 22, 26]]
    for (const [a, len, y] of ls) {
      line(c, [[w / 2, h - 30], [w / 2 + Math.cos(a) * len * 0.6, h - 30 + Math.sin(a) * len * 0.6]], GREEND, 2)
      monsteraLeaf(c, w / 2 + Math.cos(a) * len * 0.6, h - 30 + Math.sin(a) * len * 0.6, len * 0.75, a)
    }
    pot(c, w / 2 - 15, h - 30, 30, 30, "#fff1e3")
    line(c, [[w / 2 - 12, h - 18], [w / 2 + 12, h - 18]], PINK, 3)
  },
  cactus(c, w, h) {
    box(c, w / 2 - 6, 6, 12, h - 16, 6, "#8fd19e")
    box(c, 2, 14, 7, 12, 3.5, "#8fd19e", 1.5)
    box(c, w - 9, 10, 7, 12, 3.5, "#8fd19e", 1.5)
    line(c, [[w / 2, 9], [w / 2, h - 14]], "#6bb17d", 1)
    flower(c, w / 2, 6, 3, PINK)
    pot(c, w / 2 - 9, h - 12, 18, 12, "#ffd6e5")
  },
  succulent(c, w, h) {
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6) * Math.PI
      leaf(c, w / 2, h - 9, 10 + (i % 2) * 2, a, i % 2 ? "#9fd9b6" : "#b9e7c9", 1)
    }
    dot(c, w / 2, h - 11, 2.5, PINK)
    pot(c, w / 2 - 8, h - 9, 16, 9, "#bfe7ff")
  },
  hanging_plant(c, w, h, e) {
    const sw = e ? Math.sin(e.t * 0.9) * 0.05 : 0
    c.save()
    c.translate(w / 2, 0)
    c.rotate(sw)
    line(c, [[0, 0], [-12, 30]], OL, 1)
    line(c, [[0, 0], [12, 30]], OL, 1)
    for (let v = 0; v < 4; v++) {
      const x = -14 + v * 9
      line(c, [[x, 36], [x + (v % 2 ? 3 : -3), 36 + 20 + v * 6]], GREEND, 1.5)
      for (let k = 0; k < 4; k++) leaf(c, x + (k % 2 ? 1 : -1), 40 + k * 8 + v * 2, 8, k % 2 ? 0.6 : Math.PI - 0.6, LEAF, 1)
    }
    poly(c, [[-14, 30], [14, 30], [10, 42], [-10, 42]], "#ffe3ee")
    c.restore()
  },
  tulips(c, w, h) {
    const t = [[6, 10, RED], [w / 2, 4, PINK], [w - 6, 12, LILAC]]
    for (const [x, y] of t) curve(c, x, y + 6, (x + w / 2) / 2, h - 18, w / 2, h - 14, GREEND, 2)
    for (const [x, y, col] of t) {
      c.beginPath()
      c.moveTo(x - 5, y)
      c.lineTo(x - 2.5, y + 3)
      c.lineTo(x, y - 1)
      c.lineTo(x + 2.5, y + 3)
      c.lineTo(x + 5, y)
      c.quadraticCurveTo(x + 5, y + 10, x, y + 10)
      c.quadraticCurveTo(x - 5, y + 10, x - 5, y)
      paint(c, col, 1.2)
    }
    poly(c, [[w / 2 - 8, h - 16], [w / 2 + 8, h - 16], [w / 2 + 6, h], [w / 2 - 6, h]], "rgba(190,230,255,0.75)", 1.5)
  },
  sunflower(c, w, h, e) {
    const sw = e ? Math.sin(e.t * 0.6) * 0.04 : 0
    c.save()
    c.translate(w / 2, h - 26)
    c.rotate(sw)
    line(c, [[0, 0], [0, -h + 46]], GREEND, 3)
    leaf(c, 0, -30, 16, -0.4, LEAF)
    leaf(c, 0, -46, 14, Math.PI + 0.4, LEAF)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU
      leaf(c, Math.cos(a) * 5, -h + 46 + Math.sin(a) * 5, 11, a, "#ffd23f", 1)
    }
    oval(c, 0, -h + 46, 8, 8, "#9b6a3c")
    face(c, 0, -h + 46, 4)
    c.restore()
    pot(c, w / 2 - 14, h - 26, 28, 26, "#f3a07a")
  },
  fern(c, w, h) {
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI + 0.25 + (i / 6) * (Math.PI - 0.5)
      const len = 34 - Math.abs(i - 3) * 3
      const ex = w / 2 + Math.cos(a) * len
      const ey = h - 22 + Math.sin(a) * len
      curve(c, w / 2, h - 22, (w / 2 + ex) / 2, ey - 6, ex, ey, GREEND, 1.8)
      for (let k = 1; k < 5; k++) {
        const px = w / 2 + (ex - w / 2) * (k / 5)
        const py = h - 22 + (ey - h + 22) * (k / 5) - 3
        leaf(c, px, py, 7, a - 0.9, LEAF, 0.8)
        leaf(c, px, py, 7, a + 0.9, LEAF, 0.8)
      }
    }
    pot(c, w / 2 - 14, h - 22, 28, 22, "#c9b3ff")
  },
  bonsai(c, w, h) {
    curve(c, w / 2, h - 8, w / 2 - 8, h - 18, w / 2 + 2, 14, WOODD, 3.5)
    oval(c, w / 2 - 8, 14, 11, 7, LEAF, 1.5)
    oval(c, w / 2 + 9, 11, 10, 6, GREEN, 1.5)
    oval(c, w / 2 + 2, 6, 9, 5, "#8fd19e", 1.5)
    dot(c, w / 2 - 10, 12, 1.8, PINK)
    dot(c, w / 2 + 11, 9, 1.8, PINK)
    box(c, 2, h - 8, w - 4, 8, 2, NAVY, 1.5)
  },
  roses(c, w, h) {
    for (const [x, y] of [[7, 9], [w / 2, 5], [w - 7, 10]]) line(c, [[x, y], [w / 2, h - 16]], GREEND, 1.5)
    leaf(c, 6, 20, 7, Math.PI - 0.4, LEAF, 1)
    leaf(c, w - 6, 20, 7, 0.4, LEAF, 1)
    for (const [x, y] of [[7, 9], [w / 2, 5], [w - 7, 10]]) {
      oval(c, x, y, 5, 5, RED, 1.2)
      c.beginPath()
      c.arc(x, y, 2.5, 0, 4.5)
      stroke(c, 1, "#c94a62")
    }
    oval(c, w / 2, h - 9, 9, 9, "#ffe3ee")
    box(c, w / 2 - 5, h - 20, 10, 4, 2, "#ffe3ee", 1.5)
  },

  // ---- fun ----
  tv(c, w, h, e) {
    line(c, [[w / 2 - 8, 6], [w / 2 - 14, -4]], OL, 1.5)
    line(c, [[w / 2 + 8, 6], [w / 2 + 16, -6]], OL, 1.5)
    box(c, 0, 6, w, h - 14, 8, "#ffb3a0")
    box(c, 6, 11, w - 22, h - 24, 6, "#3c3b5c", 1.5)
    tvPicture(c, 8, 13, w - 26, h - 28, e)
    dot(c, w - 9, 18, 2.5, OL)
    dot(c, w - 9, 27, 2.5, OL)
    box(c, 10, h - 8, 6, 8, 1, WOODD)
    box(c, w - 16, h - 8, 6, 8, 1, WOODD)
  },
  record_player(c, w, h, e) {
    box(c, 0, 8, w, h - 8, 4, "#ffd9a8")
    oval(c, w / 2 - 6, 9, 16, 4, NAVY, 1.5)
    const a = (e?.t || 0) * 3
    dot(c, w / 2 - 6 + Math.cos(a) * 9, 9 + Math.sin(a) * 2, 1.5, "#8a8fb8")
    dot(c, w / 2 - 6, 9, 3, PINK)
    line(c, [[w - 8, 4], [w - 6, 12], [w / 2 + 4, 10]], GRAYD, 2)
    dot(c, 8, h - 8, 2.5, OL)
    dot(c, 16, h - 8, 2.5, OL)
    if (e && Math.sin(e.t * 2) > 0) {
      const y = -4 - ((e.t * 10) % 10)
      musicNote(c, w - 6 + Math.sin(e.t * 3) * 3, y, PINKD)
    }
  },
  computer(c, w, h, e) {
    box(c, 4, 0, w - 8, h - 14, 5, "#efe6d5")
    box(c, 9, 5, w - 18, h - 26, 2, "#3a8f8a", 1.5)
    c.save()
    rrPath(c, 9, 5, w - 18, h - 26, 2)
    c.clip()
    box(c, 12, 9, 6, 5, 0, WHITE, 0)
    box(c, 12, 17, 6, 5, 0, BUTTER, 0)
    box(c, 22, 11, 16, 11, 0, "#c0c0c0", 0)
    box(c, 22, 11, 16, 2.5, 0, "#000080", 0)
    box(c, 9, h - 25, w - 18, 4, 0, "#c0c0c0", 0)
    if (e && Math.sin(e.t * 3) > 0) box(c, 25, 15, 1, 3, 0, OL, 0)
    c.restore()
    box(c, w / 2 - 6, h - 14, 12, 6, 1, "#e0d6c2", 1.5)
    box(c, 0, h - 8, w, 8, 3, "#efe6d5")
    for (let x = 5; x < w - 4; x += 5) dot(c, x, h - 4, 1, GRAYD)
    heart(c, w - 10, 6, 7, PINKD, 1)
  },
  arcade(c, w, h, e) {
    poly(c, [[2, 0], [w - 2, 0], [w - 2, h], [2, h]], "#b9a2ff")
    box(c, 0, 0, w, 16, 4, "#ff9ccc")
    c.fillStyle = WHITE
    c.font = "bold 8px Arial"
    c.textAlign = "center"
    c.textBaseline = "middle"
    c.fillText("♥ 98 ♥", w / 2, 8.5)
    box(c, 6, 22, w - 12, 34, 3, "#2d2b4a", 1.5)
    const t = e?.t || 0
    for (let i = 0; i < 4; i++) dot(c, 12 + ((t * 18 + i * 12) % (w - 24)), 30 + i * 6, 2.2, ["#ffe17a", "#ff9ccc", "#9fe0ff", "#b6f0b0"][i])
    heart(c, w / 2, 48, 8, "#ff6fb5", 0)
    box(c, 0, 60, w, 12, 2, "#a28aef")
    dot(c, 14, 64, 3, RED)
    line(c, [[14, 64], [14, 60]], OL, 2)
    dot(c, w - 18, 66, 2.5, BUTTER)
    dot(c, w - 10, 66, 2.5, SKY)
    box(c, 10, 80, w - 20, 26, 3, "#a28aef", 1.5)
    box(c, w / 2 - 6, 88, 12, 6, 1, "#2d2b4a", 1)
  },
  guitar(c, w, h) {
    c.save()
    c.translate(w / 2, h)
    c.rotate(0.12)
    box(c, -3, -h + 4, 6, 40, 1, WOODD, 1.5)
    box(c, -5, -h, 10, 10, 2, WOODD, 1.5)
    oval(c, 0, -26, 15, 18, "#ffb347")
    oval(c, 0, -46, 11, 12, "#ffb347")
    oval(c, 0, -26, 15, 18, null)
    dot(c, 0, -40, 4.5, OL)
    box(c, -6, -18, 12, 4, 1, WOODD, 1)
    for (let i = -1; i <= 1; i++) line(c, [[i * 1.5, -h + 6], [i * 1.5, -16]], "#f5f0e8", 0.7)
    c.restore()
  },
  piano(c, w, h) {
    box(c, 0, 0, w, h - 6, 4, "#f7f1ea")
    box(c, 6, 8, w - 12, 30, 3, "#ffe3ee", 1.5)
    musicNote(c, 26, 26, PINKD)
    musicNote(c, 46, 20, LILACD)
    box(c, -4, 44, w + 8, 14, 2, WHITE)
    for (let x = 4; x < w; x += 8) line(c, [[x, 44], [x, 58]], GRAYD, 1)
    for (let x = 6; x < w - 6; x += 8) if (x % 24 !== 22) box(c, x + 3, 44, 4, 8, 0.5, OL, 0)
    box(c, 6, 58, w - 12, h - 70, 3, "#f0e6da", 1.5)
    box(c, 6, h - 6, 8, 6, 1, WOODD)
    box(c, w - 14, h - 6, 8, 6, 1, WOODD)
  },
  speaker(c, w, h) {
    box(c, 0, 0, w, h, 4, NAVY)
    oval(c, w / 2, 11, 6, 6, "#8a8fb8", 1.5)
    oval(c, w / 2, h - 12, 8, 8, "#8a8fb8", 1.5)
    dot(c, w / 2, h - 12, 3, OL)
    heart(c, w / 2, 11, 5, PINK, 0)
  },
  books(c, w, h) {
    box(c, 0, h - 9, w, 9, 2, SKY)
    box(c, 3, h - 18, w - 4, 9, 2, PINK)
    box(c, 1, h - 26, w - 6, 8, 2, BUTTER)
    box(c, 4, h - 33, w - 10, 7, 2, MINT)
    line(c, [[4, h - 5], [w - 4, h - 5]], WHITE, 1)
    heart(c, w / 2, h - 13, 5, WHITE, 0)
  },
  globe(c, w, h, e) {
    c.beginPath()
    c.arc(w / 2, 16, 17, -0.4, Math.PI + 0.4)
    stroke(c, 2, WOODD)
    oval(c, w / 2, 16, 13, 13, SKY)
    c.save()
    c.beginPath()
    c.arc(w / 2, 16, 12.5, 0, TAU)
    c.clip()
    const off = ((e?.t || 0) * 4) % 26
    for (const dx of [-26, 0, 26]) {
      oval(c, w / 2 - 4 + dx - off + 13, 12, 5, 4, GREEN, 0)
      oval(c, w / 2 + 6 + dx - off + 13, 20, 4, 5, GREEN, 0)
    }
    c.restore()
    line(c, [[w / 2, 30], [w / 2, h - 4]], WOODD, 3)
    oval(c, w / 2, h - 3, 9, 3, WOODD)
  },
  easel(c, w, h) {
    line(c, [[w / 2, 0], [8, h]], WOODD, 3)
    line(c, [[w / 2, 0], [w - 8, h]], WOODD, 3)
    line(c, [[w / 2, 0], [w / 2, h - 10]], WOODD, 3)
    box(c, 6, 14, w - 12, 50, 2, WHITE)
    heart(c, w / 2 - 6, 36, 20, PINK, 1.5)
    dot(c, w / 2 + 14, 26, 5, BUTTER)
    curve(c, 12, 56, w / 2, 46, w - 12, 56, MINTD, 2)
    box(c, 4, 64, w - 8, 5, 1, WOOD)
  },
  telescope(c, w, h, e) {
    line(c, [[w / 2, h - 38], [8, h]], WOODD, 2.5)
    line(c, [[w / 2, h - 38], [w - 8, h]], WOODD, 2.5)
    line(c, [[w / 2, h - 38], [w / 2, h]], WOODD, 2.5)
    c.save()
    c.translate(w / 2, h - 42)
    c.rotate(-0.6)
    box(c, -18, -7, 46, 14, 4, LILAC)
    box(c, 26, -9, 8, 18, 2, LILACD, 1.5)
    box(c, -24, -4, 8, 8, 2, NAVY, 1.5)
    c.restore()
    if (e?.night) star(c, w - 4, 6, 4, BUTTER, 1)
  },
  radio(c, w, h) {
    line(c, [[w - 8, 6], [w - 2, -8]], OL, 1.5)
    box(c, 0, 6, w, h - 6, 6, "#9be3b5")
    oval(c, 12, h / 2 + 3, 8, 8, "#e8fff2")
    for (let i = -4; i <= 4; i += 4) line(c, [[8, h / 2 + 3 + i], [16, h / 2 + 3 + i]], OL, 1)
    box(c, 24, 11, 12, 6, 2, BUTTER, 1)
    dot(c, 27, h - 6, 2, OL)
    dot(c, 33, h - 6, 2, OL)
  },
  yarn(c, w, h) {
    dot(c, 10, 8, 7, PINK)
    dot(c, 24, 7, 7, LILAC)
    for (const [x, col] of [[10, PINKD], [24, LILACD]]) {
      c.beginPath()
      c.arc(x, 8, 7, 0, TAU)
      stroke(c, 1.5)
      curve(c, x - 5, 4, x, 10, x + 5, 4, col, 1)
      curve(c, x - 5, 9, x, 15, x + 5, 9, col, 1)
    }
    line(c, [[30, 4], [w + 2, -8]], WOODL, 2)
    line(c, [[28, 2], [w - 4, -10]], WOODL, 2)
    poly(c, [[0, 10], [w, 10], [w - 4, h], [4, h]], "#f3dfc0")
    for (let x = 6; x < w; x += 6) line(c, [[x, 11], [x - 1, h - 1]], "#d8b98d", 1)
  },

  // ---- pets ----
  cat(c, w, h, e, coat = "#c9ccd8", patch = "#9da2b4") {
    const step = e?.moving ? Math.sin(e.t * 12) * 2.5 : 0
    const tail = Math.sin((e?.t || 0) * 3) * 4
    curve(c, 6, h - 14, -2 + tail, h - 26, 4 + tail, h - 34, coat, 5)
    curve(c, 6, h - 14, -2 + tail, h - 26, 4 + tail, h - 34, OL, 1.2)
    oval(c, w / 2 - 2, h - 12, 15, 9, coat)
    oval(c, w / 2 - 6, h - 15, 6, 4, patch, 0)
    for (const [x, d] of [[12, step], [w - 18, -step]]) box(c, x + d, h - 8, 5, 8, 2, coat, 1.5)
    oval(c, w - 13, h - 22, 11, 10, coat)
    poly(c, [[w - 22, h - 27], [w - 20, h - 37], [w - 14, h - 30]], coat, 1.5)
    poly(c, [[w - 4, h - 27], [w - 6, h - 37], [w - 12, h - 30]], coat, 1.5)
    poly(c, [[w - 20, h - 29], [w - 19.5, h - 34], [w - 16, h - 30]], PINK, 0)
    face(c, w - 13, h - 22, 5, e && (e.t + w) % 4 < 0.15)
    line(c, [[w - 3, h - 20], [w + 3, h - 21]], OL, 0.8)
    line(c, [[w - 3, h - 18], [w + 3, h - 17]], OL, 0.8)
  },
  cat_ginger(c, w, h, e) {
    DRAW.cat(c, w, h, e, "#ffc68a", "#f39c55")
  },
  dog(c, w, h, e) {
    const step = e?.moving ? Math.sin(e.t * 12) * 3 : 0
    const wag = Math.sin((e?.t || 0) * (e?.moving ? 14 : 6)) * 5
    curve(c, 8, h - 20, 0, h - 30 + wag * 0.3, 2 + wag, h - 34, "#f3d3ad", 5)
    curve(c, 8, h - 20, 0, h - 30 + wag * 0.3, 2 + wag, h - 34, OL, 1.2)
    oval(c, w / 2 - 4, h - 16, 18, 11, "#f3d3ad")
    for (const [x, d] of [[10, step], [w - 26, -step]]) box(c, x + d, h - 10, 6, 10, 2.5, "#f3d3ad", 1.5)
    box(c, w - 24, h - 25, 12, 5, 2, RED, 1.2)
    dot(c, w - 18, h - 18, 2.5, BUTTER)
    oval(c, w - 14, h - 30, 13, 12, "#f3d3ad")
    oval(c, w - 26, h - 28, 5, 9, "#c8945f")
    oval(c, w - 2, h - 26, 5, 6, "#fff4e0", 1.2)
    dot(c, w, h - 29, 2.5, OL)
    face(c, w - 13, h - 32, 5, e && (e.t + 1) % 5 < 0.15)
    if (e && !e.moving && Math.sin(e.t * 1.7) > 0.6) {
      c.beginPath()
      c.ellipse(w - 6, h - 23, 2.2, 3.5, 0, 0, Math.PI)
      c.fillStyle = "#ff8fa3"
      c.fill()
    }
  },
  bunny(c, w, h, e) {
    oval(c, w / 2 - 2, h - 10, 12, 9, WHITE)
    dot(c, 5, h - 12, 4, WHITE)
    c.beginPath()
    c.arc(5, h - 12, 4, 0, TAU)
    stroke(c, 1.2)
    oval(c, w - 10, h - 17, 8, 7, WHITE)
    oval(c, w - 14, h - 29, 3, 8, WHITE, 1.5)
    oval(c, w - 7, h - 30, 3, 8, WHITE, 1.5)
    oval(c, w - 14, h - 29, 1.4, 5, PINK, 0)
    oval(c, w - 7, h - 30, 1.4, 5, PINK, 0)
    face(c, w - 9, h - 17, 3.5, e && (e.t + 2) % 4 < 0.15)
    oval(c, w / 2 + 2, h - 3, 4, 2.5, WHITE, 1.2)
  },
  fishbowl(c, w, h, e) {
    oval(c, w / 2, h / 2 + 2, w / 2 - 1, h / 2 - 3, "rgba(190,235,255,0.75)")
    c.save()
    c.beginPath()
    c.ellipse(w / 2, h / 2 + 2, w / 2 - 2, h / 2 - 4, 0, 0, TAU)
    c.clip()
    box(c, 0, 4, w, 5, 0, "rgba(255,255,255,0.4)", 0)
    oval(c, w / 2, h - 2, w / 2, 5, "#ffe2a8", 0)
    const t = e?.t || 0
    const fx = w / 2 + Math.sin(t * 0.9) * 8
    const dir = Math.cos(t * 0.9) >= 0 ? 1 : -1
    c.save()
    c.translate(fx, h / 2 + 3 + Math.sin(t * 2) * 1.5)
    c.scale(dir, 1)
    poly(c, [[-5, 0], [-10, -4], [-10, 4]], "#ff9f43", 1)
    oval(c, 0, 0, 6, 4.5, "#ffb347", 1)
    dot(c, 2.5, -1, 1, OL)
    c.restore()
    dot(c, 10, 12 - ((t * 6) % 8), 1.4, WHITE)
    c.restore()
    oval(c, w / 2, h / 2 + 2, w / 2 - 1, h / 2 - 3, null, 1.5)
    box(c, w / 2 - 9, 1, 18, 4, 2, "rgba(190,235,255,0.9)", 1.5)
    shine(c, 6, 10, 3, 9)
  },
  bird_cage(c, w, h, e) {
    line(c, [[w / 2, 0], [w / 2, 10]], OL, 1.5)
    c.beginPath()
    c.arc(w / 2, 12, 3, 0, TAU)
    stroke(c, 1.5)
    const t = e?.t || 0
    const bob = Math.abs(Math.sin(t * 2.2)) * 2
    c.save()
    c.translate(w / 2 + 2, h - 22 - bob)
    oval(c, 0, 0, 7, 6, SKY, 1.5)
    dot(c, 4, -4, 4.5, SKY)
    c.beginPath()
    c.arc(4, -4, 4.5, 0, TAU)
    stroke(c, 1.2)
    poly(c, [[8, -4], [11, -3], [8, -2]], "#ff9f43", 0.8)
    dot(c, 5, -5, 1, OL)
    leaf(c, -2, 0, 7, Math.PI - 0.3, SKYD, 1)
    c.restore()
    line(c, [[8, h - 16], [w - 8, h - 16]], WOODD, 2)
    c.beginPath()
    c.moveTo(4, h - 6)
    c.lineTo(4, 30)
    c.quadraticCurveTo(w / 2, 6, w - 4, 30)
    c.lineTo(w - 4, h - 6)
    for (let x = 10; x < w - 4; x += 6) {
      c.moveTo(x, h - 6)
      c.lineTo(x, 22 + Math.abs(x - w / 2) * 0.5)
    }
    stroke(c, 1.2, "#e0b16a")
    box(c, 0, h - 7, w, 7, 2, PINK)
  },
  cat_tree(c, w, h) {
    box(c, w / 2 - 6, 10, 12, h - 16, 2, "#e9d2b0")
    for (let y = 16; y < h - 8; y += 5) line(c, [[w / 2 - 5, y], [w / 2 + 5, y + 2]], "#cfae80", 1)
    box(c, 0, 0, w - 10, 10, 4, LILAC)
    box(c, 10, h / 2, w - 10, 10, 4, PINK)
    box(c, 0, h - 8, w, 8, 3, LILAC)
    line(c, [[16, 10], [16, 22]], OL, 1)
    dot(c, 16, 24, 3, BUTTER)
    box(c, w - 26, h / 2 + 10, 20, 20, 8, "#d9c6ff", 1.5)
    oval(c, w - 16, h / 2 + 22, 5, 6, NAVY, 0)
  },
  pet_bed(c, w, h) {
    oval(c, w / 2, h / 2 + 2, w / 2, h / 2 - 1, "#ffb3cf")
    oval(c, w / 2, h / 2 + 1, w / 2 - 9, h / 2 - 5, "#fff0f5", 1.5)
    for (let x = 14; x < w - 10; x += 12) {
      dot(c, x, h - 4, 1.5, WHITE)
    }
    oval(c, 12, 10, 4, 3, "#f3d3ad", 1)
  },
  food_bowls(c, w, h) {
    for (const [x, col, food] of [[11, PINK, "#c8945f"], [w - 11, SKY, "#cfeaff"]]) {
      oval(c, x, 4, 8, 3, food, 0)
      poly(c, [[x - 11, 4], [x + 11, 4], [x + 8, h], [x - 8, h]], col)
    }
    heart(c, 11, 10, 5, WHITE, 0)
  },

  // ---- garden ----
  tree(c, w, h, e) {
    const sw = e ? Math.sin(e.t * 0.7) * 1.5 : 0
    poly(c, [[w / 2 - 12, h], [w / 2 - 7, h - 70], [w / 2 + 7, h - 70], [w / 2 + 12, h]], "#b07a4a")
    line(c, [[w / 2, h - 60], [w / 2 + 22, h - 92]], "#b07a4a", 5)
    const blobs = [[w / 2, 50, 48], [w / 2 - 34, 78, 34], [w / 2 + 34, 76, 34], [w / 2 - 18, 104, 30], [w / 2 + 20, 104, 30], [w / 2, 30, 30]]
    for (const [x, y, r] of blobs) oval(c, x + sw, y, r, r * 0.9, GREEN)
    for (const [x, y, r] of blobs) oval(c, x + sw, y, r - 2, r * 0.9 - 2, GREEN, 0)
    for (const [x, y] of [[-30, 70], [20, 40], [36, 84], [-10, 96], [-24, 46], [8, 72]]) {
      dot(c, w / 2 + x + sw, y, 6, RED)
      dot(c, w / 2 + x + sw - 2, y - 2, 1.8, "rgba(255,255,255,0.8)")
    }
    oval(c, w / 2 - 4, h - 40, 6, 7, "#7a4d2a", 0)
  },
  bush(c, w, h) {
    for (const [x, y, r] of [[18, h - 18, 18], [w / 2, h - 26, 22], [w - 18, h - 18, 18]]) oval(c, x, y, r, r * 0.9, GREEN)
    for (const [x, y, r] of [[18, h - 18, 18], [w / 2, h - 26, 22], [w - 18, h - 18, 18]]) oval(c, x, y, r - 2, r * 0.9 - 2, GREEN, 0)
    box(c, 4, h - 6, w - 8, 6, 2, GREEND, 0)
    for (const [x, y] of [[16, 16], [36, 10], [54, 18], [28, 26]]) flower(c, x, y, 3.5, PINK)
  },
  flower_bed(c, w, h, e) {
    const cols = [PINK, BUTTER, LILAC, RED, SKY, PEACH]
    for (let i = 0; i < 8; i++) {
      const x = 8 + i * 12
      const sw = e ? Math.sin(e.t * 1.4 + i) * 1.2 : 0
      line(c, [[x, h - 12], [x + sw, 10 + (i % 3) * 5]], GREEND, 1.5)
      leaf(c, x, h - 18, 6, -0.5 - (i % 2) * 2.2, LEAF, 1)
      flower(c, x + sw, 10 + (i % 3) * 5, 4.5, cols[i % cols.length])
    }
    box(c, 0, h - 12, w, 12, 3, "#b07a4a")
    for (let x = 6; x < w; x += 16) line(c, [[x, h - 10], [x, h - 2]], "#8d5c33", 1)
  },
  bench(c, w, h) {
    for (let i = 0; i < 3; i++) box(c, 6, 2 + i * 8, w - 12, 6, 2, i === 1 ? "#ffb3cf" : "#ffc9de")
    box(c, 0, 28, w, 7, 2, "#ffb3cf")
    for (const x of [8, w - 16]) {
      line(c, [[x + 4, 35], [x, h], [x + 8, h]], NAVY, 2.5)
    }
    line(c, [[10, 2], [10, 30]], NAVY, 2.5)
    line(c, [[w - 10, 2], [w - 10, 30]], NAVY, 2.5)
    heart(c, w / 2, 14, 10, WHITE, 1)
  },
  swing(c, w, h, e) {
    line(c, [[4, h], [w / 2 - 8, 4]], "#e0b16a", 4)
    line(c, [[w - 4, h], [w / 2 + 8, 4]], "#e0b16a", 4)
    line(c, [[w / 2 - 14, 6], [w / 2 + 14, 6]], WOODD, 4)
    const a = e ? Math.sin(e.t * 1.6) * 0.22 : 0
    c.save()
    c.translate(w / 2, 6)
    c.rotate(a)
    line(c, [[-10, 0], [-10, h - 40]], OL, 1.2)
    line(c, [[10, 0], [10, h - 40]], OL, 1.2)
    box(c, -16, h - 42, 32, 6, 2, PINK)
    flower(c, -10, 12, 3, PINK)
    flower(c, 10, 24, 3, BUTTER)
    c.restore()
  },
  fountain(c, w, h, e) {
    const t = e?.t || 0
    for (const dir of [-1, 1]) {
      c.beginPath()
      c.moveTo(w / 2, 10)
      c.quadraticCurveTo(w / 2 + dir * 18, -6, w / 2 + dir * 26, 30)
      stroke(c, 2, "rgba(140,210,255,0.9)")
    }
    for (let i = 0; i < 5; i++) dot(c, w / 2 + Math.sin(t * 3 + i) * 20, 18 + ((t * 30 + i * 9) % 18), 1.5, "#bfe7ff")
    box(c, w / 2 - 5, 8, 10, 26, 3, "#e8e4f0")
    oval(c, w / 2, 10, 12, 4, "#e8e4f0", 1.5)
    box(c, 0, 34, w, h - 34, 8, "#e8e4f0")
    box(c, 6, 38, w - 12, 10, 4, "#9fd8ff", 1.2)
    box(c, 4, h - 8, w - 8, 4, 2, "#d3cde2", 0)
  },
  mailbox(c, w, h) {
    line(c, [[w / 2, 26], [w / 2, h]], WOODD, 5)
    box(c, 0, 4, w - 4, 24, 10, SKY)
    box(c, 0, 4, w - 4, 24, 10, null)
    oval(c, 4, 16, 3, 11, SKYD, 1.2)
    line(c, [[w - 4, 22], [w - 4, 2]], OL, 1.5)
    heart(c, w - 1, 4, 9, RED, 1)
    poly(c, [[10, 12], [22, 12], [22, 20], [10, 20]], WHITE, 1)
    line(c, [[10, 12], [16, 17], [22, 12]], OL, 1)
  },
  picnic(c, w, h) {
    c.save()
    c.beginPath()
    c.moveTo(6, 0)
    c.lineTo(w - 6, 0)
    c.lineTo(w, h)
    c.lineTo(0, h)
    c.closePath()
    paint(c, WHITE)
    c.clip()
    for (let x = 0; x < w; x += 12) box(c, x, 0, 6, h, 0, "rgba(255,107,129,0.55)", 0)
    for (let y = 0; y < h; y += 8) box(c, 0, y, w, 4, 0, "rgba(255,107,129,0.35)", 0)
    c.restore()
    poly(c, [[6, 0], [w - 6, 0], [w, h], [0, h]], null, 1.5)
    box(c, w - 34, -14, 24, 16, 3, "#e0b16a")
    curve(c, w - 32, -14, w - 22, -26, w - 12, -14, WOODD, 2)
  },
  umbrella_table(c, w, h, e) {
    line(c, [[w / 2, 18], [w / 2, h]], GRAYD, 3)
    c.beginPath()
    c.moveTo(2, 28)
    c.quadraticCurveTo(w / 2, -16, w - 2, 28)
    c.closePath()
    paint(c, WHITE)
    c.save()
    c.clip()
    for (let i = 0; i < 6; i += 2) poly(c, [[w / 2, 0], [(i * w) / 6, 30], [((i + 1) * w) / 6, 30]], PINK, 0)
    c.restore()
    c.beginPath()
    c.moveTo(2, 28)
    c.quadraticCurveTo(w / 2, -16, w - 2, 28)
    c.closePath()
    stroke(c, 2)
    for (let i = 0; i < 6; i++) {
      c.beginPath()
      c.arc(((i + 0.5) * w) / 6, 28, w / 12, 0, Math.PI)
      paint(c, i % 2 ? WHITE : PINK, 1.2)
    }
    oval(c, w / 2, h - 34, w / 2 - 14, 5, WHITE)
    line(c, [[w / 2 - 14, h - 30], [w / 2 - 18, h]], GRAYD, 2)
    line(c, [[w / 2 + 14, h - 30], [w / 2 + 18, h]], GRAYD, 2)
    box(c, w / 2 + 8, h - 46, 8, 10, 2, "#bfe7ff", 1.2)
    line(c, [[w / 2 + 14, h - 52], [w / 2 + 12, h - 44]], PINKD, 1.5)
  },
  birdhouse(c, w, h, e) {
    line(c, [[w / 2, 36], [w / 2, h]], WOODD, 4)
    box(c, 2, 12, w - 4, 26, 3, BUTTER)
    poly(c, [[-2, 14], [w / 2, -2], [w + 2, 14]], RED)
    dot(c, w / 2, 24, 4.5, OL)
    line(c, [[w / 2, 32], [w / 2 + 6, 32]], WOODD, 2)
    if (e && Math.sin(e.t * 0.5) > 0.2) {
      dot(c, w / 2, 23, 3.4, SKY)
      dot(c, w / 2 + 1, 22, 0.9, OL)
    }
  },
  lamp_post(c, w, h, e) {
    line(c, [[w / 2, 24], [w / 2, h - 6]], NAVY, 4)
    box(c, w / 2 - 8, h - 8, 16, 8, 2, NAVY)
    if (e?.night) glowDot(c, w / 2, 14, 24, "rgba(255,225,150,0.95)", true)
    poly(c, [[4, 6], [w - 4, 6], [w - 7, 24], [7, 24]], e?.night ? "#fff1b8" : "#e6f6ff")
    poly(c, [[1, 6], [w / 2, -4], [w - 1, 6]], NAVY)
    box(c, 5, 24, w - 10, 4, 1, NAVY)
    flower(c, w / 2 + 6, h - 36, 3.5, PINK)
    leaf(c, w / 2, h - 30, 8, -0.4, LEAF, 1)
  },
  fence(c, w, h) {
    line(c, [[0, 16], [w, 16]], OL, 7)
    line(c, [[0, 16], [w, 16]], WHITE, 4)
    line(c, [[0, h - 12], [w, h - 12]], OL, 7)
    line(c, [[0, h - 12], [w, h - 12]], WHITE, 4)
    for (let x = 2; x < w - 8; x += 14) poly(c, [[x, h], [x, 8], [x + 5, 2], [x + 10, 8], [x + 10, h]], WHITE, 1.6)
    flower(c, 22, h - 6, 3.5, PINK)
    flower(c, 64, h - 4, 3.5, BUTTER)
  },
  pond(c, w, h, e) {
    oval(c, w / 2, h / 2, w / 2, h / 2, "#cfc6b8")
    oval(c, w / 2, h / 2, w / 2 - 6, h / 2 - 3, "#8fd0ff", 1.5)
    const t = e?.t || 0
    c.beginPath()
    c.ellipse(w / 2 + 10, h / 2, 10 + ((t * 4) % 8), 2 + ((t * 0.8) % 1.6), 0, 0, TAU)
    stroke(c, 0.8, "rgba(255,255,255,0.8)")
    oval(c, 24, h / 2, 9, 3.5, "#7cc47f", 1)
    flower(c, 24, h / 2 - 2, 2.8, PINK)
    const dx = Math.sin(t * 0.4) * 18
    oval(c, w / 2 + dx, h / 2, 6, 3.5, WHITE, 1)
    dot(c, w / 2 + dx + 5, h / 2 - 4, 3, WHITE)
    c.beginPath()
    c.arc(w / 2 + dx + 5, h / 2 - 4, 3, 0, TAU)
    stroke(c, 1)
    poly(c, [[w / 2 + dx + 7.5, h / 2 - 4], [w / 2 + dx + 11, h / 2 - 3.5], [w / 2 + dx + 7.5, h / 2 - 2.5]], "#ff9f43", 0.6)
  },
  mushroom(c, w, h, e) {
    if (e?.night) glowDot(c, w / 2, 14, 22, "rgba(255,170,200,0.9)", true)
    box(c, w / 2 - 7, 18, 14, h - 18, 5, CREAM)
    c.beginPath()
    c.moveTo(1, 22)
    c.quadraticCurveTo(w / 2, -12, w - 1, 22)
    c.closePath()
    paint(c, e?.night ? "#ffb3c6" : "#ff8fa3")
    for (const [x, y, r] of [[w / 2, 8, 3.5], [10, 16, 2.5], [w - 10, 15, 3]]) dot(c, x, y, r, WHITE)
    dot(c, w / 2 - 3, 30, 1.4, OL)
    dot(c, w / 2 + 3, 30, 1.4, OL)
    box(c, w / 2 - 3, h - 9, 6, 9, 3, "#c79bff", 1)
  },
}

// ---- bits used by more than one drawing ----

function monsteraLeaf(c, x, y, len, ang) {
  c.save()
  c.translate(x, y)
  c.rotate(ang)
  c.beginPath()
  c.moveTo(0, 0)
  c.bezierCurveTo(len * 0.3, -len * 0.6, len * 1.05, -len * 0.45, len, 0)
  c.bezierCurveTo(len * 1.05, len * 0.45, len * 0.3, len * 0.6, 0, 0)
  paint(c, LEAF, 1.5)
  line(c, [[2, 0], [len * 0.9, 0]], GREEND, 1)
  for (const s of [-1, 1]) {
    line(c, [[len * 0.45, s * len * 0.12], [len * 0.55, s * len * 0.4]], "#fdf6ee", 1.6)
    line(c, [[len * 0.7, s * len * 0.08], [len * 0.8, s * len * 0.3]], "#fdf6ee", 1.6)
  }
  c.restore()
}

function musicNote(c, x, y, col) {
  dot(c, x, y + 6, 3, col)
  line(c, [[x + 2.5, y + 6], [x + 2.5, y - 4], [x + 7, y - 2]], col, 1.6)
}

// a little sky for windows: blue with a cloud by day, navy with stars and a moon at night
export function skyFill(c, x, y, w, h, night, t) {
  const g = c.createLinearGradient(0, y, 0, y + h)
  if (night) {
    g.addColorStop(0, "#232052")
    g.addColorStop(1, "#4b3f7a")
  } else {
    g.addColorStop(0, "#9fd8ff")
    g.addColorStop(1, "#e8f6ff")
  }
  c.fillStyle = g
  c.fillRect(x, y, w, h)
  if (night) {
    for (let i = 0; i < 6; i++) {
      const sx = x + ((i * 37) % w)
      const sy = y + ((i * 23) % h)
      dot(c, sx, sy, 1 + (Math.sin(t * 2 + i) > 0.5 ? 0.6 : 0), "#fff6c8")
    }
    dot(c, x + w * 0.7, y + h * 0.3, Math.min(w, h) * 0.14, "#fff2b0")
  } else {
    const cx = x + ((t * 3) % (w + 30)) - 15
    oval(c, cx, y + h * 0.35, 9, 4, WHITE, 0)
    oval(c, cx + 6, y + h * 0.3, 6, 4, WHITE, 0)
  }
}
function windowSky(c, cx, cy, r, night, t) {
  c.save()
  c.beginPath()
  c.arc(cx, cy, r, 0, TAU)
  c.clip()
  skyFill(c, cx - r, cy - r, r * 2, r * 2, night, t)
  c.restore()
}

function tvPicture(c, x, y, w, h, e) {
  const t = e?.t || 0
  c.save()
  rrPath(c, x, y, w, h, 4)
  c.clip()
  const scene = Math.floor(t / 6) % 3
  if (scene === 0) {
    c.fillStyle = "#ffd6e5"
    c.fillRect(x, y, w, h)
    heart(c, x + w / 2, y + h / 2 + Math.sin(t * 3) * 2, 16 + Math.sin(t * 6) * 2, ROSE, 1.2)
  } else if (scene === 1) {
    skyFill(c, x, y, w, h, false, t * 4)
    oval(c, x + w / 2, y + h + 4, w * 0.7, 14, GREEN, 0)
    dot(c, x + w - 10, y + 8, 5, BUTTER)
  } else {
    c.fillStyle = "#3c3b5c"
    c.fillRect(x, y, w, h)
    for (let i = 0; i < 5; i++) star(c, x + ((i * 13 + t * 10) % w), y + 6 + ((i * 7) % (h - 8)), 2.5, ["#ffe17a", "#ff9ccc", "#9fe0ff"][i % 3], 0)
  }
  c.restore()
  shine(c, x + 3, y + 3, 10, 3)
}

// ---------- people ----------

// A person (44 x 98): their look ({ skin, hair, hairStyle, top, bottom, outfit, acc }),
// breathing, blinking and now and then waving.
export function drawPerson(c, w, h, look, e = {}) {
  const t = e.t || 0
  const seed = e.seed || 0
  const skin = SKINS[look.skin] || SKINS[0]
  const hair = HAIR_COLORS[look.hair] || HAIR_COLORS[0]
  const top = CLOTHES[look.top] || CLOTHES[0]
  const bottom = CLOTHES[look.bottom] || CLOTHES[7]
  const breathe = Math.sin(t * 2 + seed) * 0.8
  const blink = (t + seed * 0.37) % 4.2 < 0.13
  const wave = Math.max(0, Math.sin((t + seed) * 0.45)) > 0.93
  const cx = w / 2
  const hy = 26 + breathe * 0.5 // head center
  const hijab = look.acc === "hijab"

  // legs and shoes
  const legTop = 74
  if (look.outfit === "dress") {
    box(c, cx - 8, legTop, 6, h - legTop - 4, 2, skin, 1.5)
    box(c, cx + 2, legTop, 6, h - legTop - 4, 2, skin, 1.5)
  } else {
    box(c, cx - 9, legTop - 4, 8, h - legTop, 2, bottom, 1.5)
    box(c, cx + 1, legTop - 4, 8, h - legTop, 2, bottom, 1.5)
  }
  box(c, cx - 11, h - 6, 10, 6, 3, "#5b4256", 0)
  box(c, cx + 1, h - 6, 10, 6, 3, "#5b4256", 0)

  // hair behind the head
  if (!hijab) {
    if (look.hairStyle === "long") box(c, cx - 15, hy - 6, 30, 38, 10, hair, 1.5)
    if (look.hairStyle === "ponytail") {
      c.save()
      c.translate(cx + 12, hy - 8)
      c.rotate(0.3 + Math.sin(t * 2 + seed) * 0.08)
      oval(c, 6, 14, 6, 14, hair, 1.5)
      c.restore()
    }
    if (look.hairStyle === "pigtails") {
      oval(c, cx - 17, hy + 6, 6, 11, hair, 1.5)
      oval(c, cx + 17, hy + 6, 6, 11, hair, 1.5)
    }
    if (look.hairStyle === "bob") box(c, cx - 16, hy - 8, 32, 26, 10, hair, 1.5)
    if (look.hairStyle === "curly") for (let i = 0; i < 9; i++) dot(c, cx + Math.cos((i / 8) * Math.PI) * 15, hy - 2 + Math.sin((i / 8) * Math.PI) * 10, 6, hair)
  } else {
    box(c, cx - 16, hy - 14, 32, 40, 14, top, 1.5)
  }

  // body
  const by = 44 + breathe
  if (look.outfit === "dress") {
    poly(c, [[cx - 9, by], [cx + 9, by], [cx + 15, legTop + 6], [cx - 15, legTop + 6]], top)
    line(c, [[cx - 12, legTop + 1], [cx + 12, legTop + 1]], "rgba(255,255,255,0.7)", 2)
  } else {
    box(c, cx - 11, by, 22, legTop - by + 2, 6, top)
    if (look.outfit === "sweater") for (let y = by + 8; y < legTop; y += 7) line(c, [[cx - 9, y], [cx + 9, y]], "rgba(255,255,255,0.6)", 2)
    if (look.outfit === "hoodie") {
      box(c, cx - 7, by + 14, 14, 8, 3, "rgba(0,0,0,0.08)", 1)
      line(c, [[cx - 3, by + 2], [cx - 3, by + 9]], OL, 1)
      line(c, [[cx + 3, by + 2], [cx + 3, by + 9]], OL, 1)
    }
    if (look.outfit === "overalls") {
      box(c, cx - 8, by + 10, 16, legTop - by - 8, 3, bottom, 1.5)
      line(c, [[cx - 7, by + 10], [cx - 9, by]], bottom, 3)
      line(c, [[cx + 7, by + 10], [cx + 9, by]], bottom, 3)
      dot(c, cx - 6, by + 13, 1.5, BUTTER)
      dot(c, cx + 6, by + 13, 1.5, BUTTER)
    }
    if (look.outfit === "tee") heart(c, cx, by + 13, 8, "rgba(255,255,255,0.75)", 0)
  }
  // arms
  box(c, cx - 15, by + 2, 6, 22, 3, top, 1.5)
  dot(c, cx - 12, by + 26, 3.2, skin)
  if (wave) {
    c.save()
    c.translate(cx + 12, by + 4)
    c.rotate(-2.4 + Math.sin(t * 14) * 0.25)
    box(c, -3, 0, 6, 20, 3, top, 1.5)
    dot(c, 0, 23, 3.2, skin)
    c.restore()
  } else {
    box(c, cx + 9, by + 2, 6, 22, 3, top, 1.5)
    dot(c, cx + 12, by + 26, 3.2, skin)
  }

  // head
  box(c, cx - 4, hy + 10, 8, 8, 2, skin, 0)
  oval(c, cx, hy, 14, 14, skin, 1.8)
  face(c, cx, hy + 2, 6, blink)
  if (look.acc === "freckles") for (const [dx, dy] of [[-8, 5], [-6, 7], [6, 5], [8, 7]]) dot(c, cx + dx, hy + dy, 0.8, "#b8754a")

  // hair in front
  if (hijab) {
    c.beginPath()
    c.arc(cx, hy, 16, Math.PI * 1.05, Math.PI * 1.95)
    c.quadraticCurveTo(cx + 14, hy - 4, cx + 10, hy - 6)
    c.quadraticCurveTo(cx, hy - 12, cx - 10, hy - 6)
    c.quadraticCurveTo(cx - 14, hy - 4, cx - 15.2, hy - 5)
    paint(c, top, 1.5)
    c.beginPath()
    c.ellipse(cx, hy + 1, 15.5, 16, 0, Math.PI * 0.05, Math.PI * 0.95, true)
    stroke(c, 1.5)
  } else if (look.hairStyle === "buzz") {
    c.beginPath()
    c.arc(cx, hy, 14.5, Math.PI * 1.08, Math.PI * 1.92)
    paint(c, hair, 1.5)
  } else {
    c.beginPath()
    c.moveTo(cx - 15, hy + 2)
    c.quadraticCurveTo(cx - 16, hy - 17, cx, hy - 16)
    c.quadraticCurveTo(cx + 16, hy - 17, cx + 15, hy + 2)
    c.quadraticCurveTo(cx + 8, hy - 9, cx + 2, hy - 7)
    c.quadraticCurveTo(cx - 6, hy - 4, cx - 15, hy + 2)
    c.closePath()
    paint(c, hair, 1.5)
    if (look.hairStyle === "bun") {
      oval(c, cx, hy - 19, 8, 7, hair, 1.5)
    }
    if (look.hairStyle === "curly") for (let i = 0; i < 5; i++) dot(c, cx - 10 + i * 5, hy - 13 + (i % 2) * 2, 4, hair)
  }

  // accessories
  if (look.acc === "glasses") {
    c.beginPath()
    c.arc(cx - 5, hy + 2, 4, 0, TAU)
    c.moveTo(cx + 9, hy + 2)
    c.arc(cx + 5, hy + 2, 4, 0, TAU)
    c.moveTo(cx - 1, hy + 2)
    c.lineTo(cx + 1, hy + 2)
    stroke(c, 1.3)
  }
  if (look.acc === "bow") {
    poly(c, [[cx + 8, hy - 12], [cx + 16, hy - 18], [cx + 16, hy - 6]], PINKD, 1.2)
    poly(c, [[cx + 8, hy - 12], [cx + 1, hy - 19], [cx + 1, hy - 6]], PINKD, 1.2)
    dot(c, cx + 8, hy - 12, 2.5, ROSE)
  }
  if (look.acc === "flower") flower(c, cx - 10, hy - 11, 4.2, "#fff6fb", BUTTER)
  if (look.acc === "beanie") {
    c.beginPath()
    c.arc(cx, hy - 4, 15, Math.PI, 0)
    c.closePath()
    paint(c, bottom === top ? PINK : bottom, 1.5)
    box(c, cx - 16, hy - 6, 32, 6, 3, "#fff4e0", 1.5)
    dot(c, cx, hy - 20, 4, "#fff4e0")
  }
  if (look.acc === "headphones") {
    c.beginPath()
    c.arc(cx, hy - 1, 16, Math.PI * 1.05, Math.PI * 1.95)
    stroke(c, 2.5, OL)
    box(c, cx - 19, hy - 4, 6, 11, 3, PINK, 1.5)
    box(c, cx + 13, hy - 4, 6, 11, 3, PINK, 1.5)
  }
}

// ---------- drawing an item ----------

// Draws catalog item `kind` into a w x h box at the origin
export const drawItem = (c, kind, env = {}) => {
  const def = itemDef(kind)
  if (!def) return
  c.save()
  try {
    if (kind === "avatar") drawPerson(c, def.w, def.h, env.look || {}, env)
    else DRAW[kind]?.(c, def.w, def.h, env)
  } finally {
    c.restore()
  }
}

export const hasDrawing = (kind) => kind === "avatar" || typeof DRAW[kind] === "function"

// ---------- wallpapers and floors ----------

const TILE = 2 // tiles are drawn at twice the size for crisp patterns

// each: [tile width, tile height, draw(c, w, h)]
const WALL_TILES = {
  cream: [24, 24, (c, w, h) => {
    c.fillStyle = "#fff3df"
    c.fillRect(0, 0, w, h)
    c.fillStyle = "#fbe8cc"
    c.fillRect(0, 0, 3, h)
    c.fillRect(12, 0, 1, h)
  }],
  hearts: [36, 36, (c, w, h) => {
    c.fillStyle = "#ffe3ee"
    c.fillRect(0, 0, w, h)
    heart(c, 9, 10, 9, "#ffb3cf", 0)
    heart(c, 27, 28, 9, "#ffc9de", 0)
    dot(c, 27, 9, 1.5, WHITE)
    dot(c, 9, 27, 1.5, WHITE)
  }],
  stripes: [24, 24, (c, w, h) => {
    c.fillStyle = "#fff0f5"
    c.fillRect(0, 0, w, h)
    c.fillStyle = "#ffd1e3"
    c.fillRect(0, 0, 9, h)
    c.fillStyle = "#ffe4ee"
    c.fillRect(12, 0, 2, h)
  }],
  dots: [24, 24, (c, w, h) => {
    c.fillStyle = "#efe6ff"
    c.fillRect(0, 0, w, h)
    dot(c, 6, 6, 3.5, WHITE)
    dot(c, 18, 18, 3.5, "#d9c9ff")
  }],
  clouds: [80, 60, (c, w, h) => {
    c.fillStyle = "#cfeaff"
    c.fillRect(0, 0, w, h)
    for (const [x, y] of [[20, 18], [62, 46]]) {
      oval(c, x, y, 12, 6, WHITE, 0)
      oval(c, x + 8, y - 4, 8, 6, WHITE, 0)
      oval(c, x - 8, y - 1, 7, 5, WHITE, 0)
    }
  }],
  sky: [80, 60, (c, w, h) => WALL_TILES.clouds[2](c, w, h)],
  floral: [40, 40, (c, w, h) => {
    c.fillStyle = "#fff6ea"
    c.fillRect(0, 0, w, h)
    for (const [x, y, col] of [[10, 10, "#ff9cb5"], [30, 30, "#ffb88c"]]) {
      leaf(c, x, y + 2, 7, 0.5, "#9dd6a0", 0)
      leaf(c, x, y + 2, 7, Math.PI - 0.5, "#9dd6a0", 0)
      dot(c, x, y, 4, col)
      dot(c, x - 1, y - 1, 1.5, "rgba(255,255,255,.7)")
    }
  }],
  gingham: [20, 20, (c, w, h) => {
    c.fillStyle = WHITE
    c.fillRect(0, 0, w, h)
    c.fillStyle = "rgba(255,120,150,0.28)"
    c.fillRect(0, 0, 10, h)
    c.fillRect(0, 0, w, 10)
  }],
  stars: [40, 40, (c, w, h) => {
    c.fillStyle = "#3d3b6e"
    c.fillRect(0, 0, w, h)
    star(c, 10, 10, 4, "#ffe17a", 0)
    star(c, 30, 28, 3, "#fff2b0", 0)
    dot(c, 30, 8, 1, WHITE)
    dot(c, 8, 30, 1, WHITE)
    dot(c, 20, 20, 0.8, "#c9b3ff")
  }],
  wood: [24, 48, (c, w, h) => {
    c.fillStyle = "#ecc591"
    c.fillRect(0, 0, w, h)
    c.fillStyle = "#e1b57c"
    c.fillRect(11, 0, 2, h)
    c.fillRect(23, 0, 1, h)
    curve(c, 4, 10, 7, 20, 4, 30, "#d9a96d", 1)
  }],
  scallop: [24, 16, (c, w, h) => {
    c.fillStyle = "#d9f2ec"
    c.fillRect(0, 0, w, h)
    for (const x of [0, 12, 24]) {
      c.beginPath()
      c.arc(x, 0, 6, 0, Math.PI)
      stroke(c, 1.2, "#9fd9c8")
    }
    for (const x of [6, 18]) {
      c.beginPath()
      c.arc(x, 8, 6, 0, Math.PI)
      stroke(c, 1.2, "#b8e6d9")
    }
  }],
  tiles: [20, 20, (c, w, h) => {
    c.fillStyle = "#cfe9f5"
    c.fillRect(0, 0, w, h)
    c.fillStyle = "#f7fcff"
    c.fillRect(1, 1, w - 2, h - 2)
    dot(c, 5, 5, 1.2, "rgba(160,210,240,0.6)")
  }],
  brick: [40, 20, (c, w, h) => {
    c.fillStyle = "#f6e4da"
    c.fillRect(0, 0, w, h)
    c.fillStyle = "#e8a08a"
    c.fillRect(1, 1, 18, 8)
    c.fillRect(21, 1, 18, 8)
    c.fillRect(-9, 11, 18, 8)
    c.fillRect(11, 11, 18, 8)
    c.fillRect(31, 11, 18, 8)
  }],
  daisy: [44, 44, (c, w, h) => {
    c.fillStyle = "#fffbd6"
    c.fillRect(0, 0, w, h)
    flower(c, 11, 11, 5, WHITE, "#ffd23f")
    flower(c, 33, 33, 4, WHITE, "#ffb347")
  }],
  hedge: [30, 30, (c, w, h) => {
    c.fillStyle = "#6fb070"
    c.fillRect(0, 0, w, h)
    for (const [x, y] of [[6, 6], [20, 4], [12, 16], [26, 20], [4, 24], [18, 28]]) dot(c, x, y, 6, (x + y) % 3 ? "#7fbf7a" : "#89c985")
    dot(c, 14, 10, 1.5, PINK)
  }],
  roses: [40, 40, (c, w, h) => {
    c.fillStyle = "#e8f6ff"
    c.fillRect(0, 0, w, h)
    line(c, [[0, 0], [w, h]], "#e0c39a", 2)
    line(c, [[w, 0], [0, h]], "#e0c39a", 2)
    leaf(c, 20, 20, 7, 0.6, LEAF, 0)
    dot(c, 20, 20, 4, "#ff8fa3")
    dot(c, 0, 0, 3, "#ff6b81")
    dot(c, 40, 40, 3, "#ff6b81")
    dot(c, 40, 0, 3, "#ff6b81")
    dot(c, 0, 40, 3, "#ff6b81")
  }],
  fence: [80, 60, (c, w, h) => WALL_TILES.clouds[2](c, w, h)],
}

const FLOOR_TILES = {
  oak: [60, 12, (c, w, h) => {
    c.fillStyle = "#ecc591"
    c.fillRect(0, 0, w, h)
    c.fillStyle = "#d9a96d"
    c.fillRect(0, h - 1, w, 1)
    c.fillRect(30, 0, 1, h)
  }],
  walnut: [60, 12, (c, w, h) => {
    c.fillStyle = "#b07a4a"
    c.fillRect(0, 0, w, h)
    c.fillStyle = "#8d5c33"
    c.fillRect(0, h - 1, w, 1)
    c.fillRect(20, 0, 1, h)
  }],
  parquet: [24, 24, (c, w, h) => {
    c.fillStyle = "#e6b77f"
    c.fillRect(0, 0, w, h)
    c.fillStyle = "#d29e63"
    c.fillRect(0, 0, 12, 12)
    c.fillRect(12, 12, 12, 12)
    c.fillStyle = "rgba(0,0,0,0.12)"
    for (const y of [4, 8]) c.fillRect(0, y, 12, 0.6)
    for (const x of [16, 20]) c.fillRect(x, 0, 0.6, 12)
  }],
  checker: [24, 24, (c, w, h) => {
    c.fillStyle = WHITE
    c.fillRect(0, 0, w, h)
    c.fillStyle = "#ffc9de"
    c.fillRect(0, 0, 12, 12)
    c.fillRect(12, 12, 12, 12)
  }],
  mono: [24, 24, (c, w, h) => {
    c.fillStyle = "#fdfdfd"
    c.fillRect(0, 0, w, h)
    c.fillStyle = "#4a4f6e"
    c.fillRect(0, 0, 12, 12)
    c.fillRect(12, 12, 12, 12)
  }],
  mint: [20, 20, (c, w, h) => {
    c.fillStyle = "#9fd9c8"
    c.fillRect(0, 0, w, h)
    c.fillStyle = "#c6efe2"
    c.fillRect(1, 1, w - 2, h - 2)
  }],
  lilac: [16, 16, (c, w, h) => {
    c.fillStyle = "#d9c9ff"
    c.fillRect(0, 0, w, h)
    dot(c, 4, 4, 1, "#cbb6ff")
    dot(c, 12, 10, 1, "#e6dbff")
  }],
  blue: [16, 16, (c, w, h) => {
    c.fillStyle = "#a9d3f5"
    c.fillRect(0, 0, w, h)
    dot(c, 4, 4, 1, "#98c6ee")
    dot(c, 12, 10, 1, "#c3e2fb")
  }],
  stone: [30, 20, (c, w, h) => {
    c.fillStyle = "#b9b5c4"
    c.fillRect(0, 0, w, h)
    oval(c, 8, 6, 7, 4, "#d6d2df", 0)
    oval(c, 22, 14, 7, 4, "#cdc8d8", 0)
  }],
  grass: [20, 14, (c, w, h) => {
    c.fillStyle = "#8fd18b"
    c.fillRect(0, 0, w, h)
    line(c, [[4, 10], [5, 5]], "#78bf74", 1)
    line(c, [[14, 12], [13, 7]], "#a3dd9f", 1)
  }],
  meadow: [36, 20, (c, w, h) => {
    FLOOR_TILES.grass[2](c, w, h)
    dot(c, 8, 6, 1.8, WHITE)
    dot(c, 26, 14, 1.8, "#ffd23f")
    dot(c, 18, 4, 1.4, PINK)
  }],
  path: [60, 30, (c, w, h) => {
    FLOOR_TILES.grass[2](c, w, h)
    oval(c, 15, 15, 10, 5, "#e8e4f0", 0)
    oval(c, 45, 12, 9, 5, "#dcd7e6", 0)
  }],
  sand: [20, 20, (c, w, h) => {
    c.fillStyle = "#f6e2b3"
    c.fillRect(0, 0, w, h)
    dot(c, 5, 5, 0.8, "#e5cc93")
    dot(c, 14, 13, 0.8, "#e5cc93")
  }],
}

const patternCache = new Map()
const makePattern = (c, table, id) => {
  const key = `${table === WALL_TILES ? "w" : "f"}:${id}`
  if (patternCache.has(key)) return patternCache.get(key)
  const spec = table[id]
  if (!spec || typeof document === "undefined") return null
  const [w, h, draw] = spec
  const tile = document.createElement("canvas")
  tile.width = w * TILE
  tile.height = h * TILE
  const tc = tile.getContext("2d")
  tc.scale(TILE, TILE)
  draw(tc, w, h)
  const pattern = c.createPattern(tile, "repeat")
  pattern?.setTransform?.(new DOMMatrix().scale(1 / TILE))
  patternCache.set(key, pattern)
  return pattern
}

// Fills a room's wall area with its wallpaper (x, y, w, h in house units).
// "sky" on the garden shows the real sky (nothing drawn); "fence" adds a picket fence.
export const fillWall = (c, id, x, y, w, h, { outdoor = false, night = false } = {}) => {
  if (outdoor && (id === "sky" || id === "fence")) {
    if (id === "fence") drawFenceRow(c, x, y + h - 52, w, 52)
    return
  }
  if (outdoor) {
    // outside, a backdrop is a low garden wall with a rounded top, the sky above it
    const wh = Math.min(h, 150)
    rrPath(c, x + 4, y + h - wh, w - 8, wh + 12, 22)
    c.save()
    c.clip()
    c.fillStyle = makePattern(c, WALL_TILES, id) || "#7fbf7a"
    c.fillRect(x, y + h - wh, w, wh + 12)
    c.restore()
    rrPath(c, x + 4, y + h - wh, w - 8, wh + 12, 22)
    stroke(c, 3)
    return
  }
  const pattern = makePattern(c, WALL_TILES, id) || makePattern(c, WALL_TILES, "cream")
  c.fillStyle = pattern || "#fff3df"
  c.fillRect(x, y, w, h)
  if (id === "fence") drawFenceRow(c, x, y + h - 52, w, 52)
  if (night && !outdoor) return
}

export const fillFloor = (c, id, x, y, w, h) => {
  const pattern = makePattern(c, FLOOR_TILES, id) || makePattern(c, FLOOR_TILES, "oak")
  c.fillStyle = pattern || "#ecc591"
  c.fillRect(x, y, w, h)
}

function drawFenceRow(c, x, y, w, h) {
  c.save()
  c.translate(x, y)
  for (let i = 0; i * 120 < w; i++) {
    c.save()
    c.translate(i * 120, 0)
    DRAW.fence(c, 120, h, null)
    c.restore()
  }
  c.restore()
}

// a swatch for the wallpaper / floor pickers
export const drawSwatch = (c, kind, id, size) => {
  c.save()
  if (kind === "wall") {
    if (id === "sky" || id === "fence") {
      skyFill(c, 0, 0, size, size, false, 0)
      if (id === "fence") drawFenceRow(c, 0, size - 26, size, 26)
    } else {
      c.fillStyle = makePattern(c, WALL_TILES, id) || "#fff"
      c.fillRect(0, 0, size, size)
    }
  } else {
    c.fillStyle = makePattern(c, FLOOR_TILES, id) || "#fff"
    c.fillRect(0, 0, size, size)
  }
  c.restore()
}
