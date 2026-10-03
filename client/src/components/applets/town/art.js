// Sunny Acres art: every building, crop, animal and icon is drawn here with canvas paths,
// in one style (soft colors, thin dark outlines, light from the left). Map sprites are
// drawn once per zoom step into offscreen canvases and reused every frame.

export const TW = 64 // a tile's width on the map, in world pixels
export const TH = 32

// world position of tile corner (u, v) at height z
export const isoX = (u, v) => (u - v) * (TW / 2)
export const isoY = (u, v, z = 0) => (u + v) * (TH / 2) - z

const OUT = "rgba(52, 36, 24, 0.55)"

// lighten (amt > 0) or darken (amt < 0) a #rrggbb color
export const shade = (hex, amt) => {
  const n = parseInt(hex.slice(1), 16)
  const ch = (c) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))
  const r = ch((n >> 16) & 255)
  const g = ch((n >> 8) & 255)
  const b = ch(n & 255)
  return `rgb(${r},${g},${b})`
}

// ---- a drawing kit in tile coordinates (u, v, height z) ----
const kit = (ctx) => {
  const path = (pts) => {
    ctx.beginPath()
    pts.forEach(([u, v, z = 0], i) => (i ? ctx.lineTo(isoX(u, v), isoY(u, v, z)) : ctx.moveTo(isoX(u, v), isoY(u, v, z))))
    ctx.closePath()
  }
  const poly = (pts, fill, stroke = OUT) => {
    path(pts)
    if (fill) {
      ctx.fillStyle = fill
      ctx.fill()
    }
    if (stroke) {
      ctx.strokeStyle = stroke
      ctx.lineWidth = 1
      ctx.lineJoin = "round"
      ctx.stroke()
    }
  }
  // a box: left face (v = v1), right face (u = u1), top
  const box = (u0, v0, u1, v1, z0, z1, c, { top = true, stroke = OUT, topColor } = {}) => {
    poly([[u0, v1, z0], [u1, v1, z0], [u1, v1, z1], [u0, v1, z1]], shade(c, 0), stroke)
    poly([[u1, v0, z0], [u1, v1, z0], [u1, v1, z1], [u1, v0, z1]], shade(c, -0.2), stroke)
    if (top) poly([[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]], topColor || shade(c, 0.18), stroke)
  }
  // a gable roof; ridge along u ("u") or along v ("v"); o = overhang
  const gable = (u0, v0, u1, v1, z, zr, c, axis = "u", o = 0.12, wall) => {
    if (axis === "u") {
      const vm = (v0 + v1) / 2
      poly([[u0 - o, vm, zr], [u1 + o, vm, zr], [u1 + o, v0 - o, z], [u0 - o, v0 - o, z]], shade(c, -0.25))
      if (wall) poly([[u1, v0, z], [u1, v1, z], [u1, vm, zr]], shade(wall, -0.2))
      poly([[u0 - o, vm, zr], [u1 + o, vm, zr], [u1 + o, v1 + o, z], [u0 - o, v1 + o, z]], c)
      // shingle lines
      ctx.strokeStyle = "rgba(0,0,0,0.12)"
      for (let k = 1; k < 4; k++) {
        const t = k / 4
        ctx.beginPath()
        ctx.moveTo(isoX(u0 - o, vm + (v1 + o - vm) * t), isoY(u0 - o, vm + (v1 + o - vm) * t, zr + (z - zr) * t))
        ctx.lineTo(isoX(u1 + o, vm + (v1 + o - vm) * t), isoY(u1 + o, vm + (v1 + o - vm) * t, zr + (z - zr) * t))
        ctx.stroke()
      }
      // the roof's edge over the gable end
      poly([[u1 + o, vm, zr], [u1 + o, v1 + o, z]], null)
    } else {
      const um = (u0 + u1) / 2
      poly([[um, v0 - o, zr], [um, v1 + o, zr], [u0 - o, v1 + o, z], [u0 - o, v0 - o, z]], shade(c, -0.1))
      if (wall) poly([[u0, v1, z], [u1, v1, z], [um, v1, zr]], wall)
      poly([[um, v0 - o, zr], [um, v1 + o, zr], [u1 + o, v1 + o, z], [u1 + o, v0 - o, z]], shade(c, -0.3))
      ctx.strokeStyle = "rgba(0,0,0,0.12)"
      for (let k = 1; k < 4; k++) {
        const t = k / 4
        ctx.beginPath()
        ctx.moveTo(isoX(um + (u1 + o - um) * t, v0 - o), isoY(um + (u1 + o - um) * t, v0 - o, zr + (z - zr) * t))
        ctx.lineTo(isoX(um + (u1 + o - um) * t, v1 + o), isoY(um + (u1 + o - um) * t, v1 + o, zr + (z - zr) * t))
        ctx.stroke()
      }
      // the visible gable end sits on the left face
      if (wall) poly([[u0 - o, v1 + o, z], [um, v1 + o, zr], [um, v1, zr], [u0, v1, z]], c)
    }
  }
  // a pyramid roof
  const pyramid = (u0, v0, u1, v1, z, zr, c, o = 0.1) => {
    const um = (u0 + u1) / 2
    const vm = (v0 + v1) / 2
    poly([[u0 - o, v1 + o, z], [u1 + o, v1 + o, z], [um, vm, zr]], c)
    poly([[u1 + o, v0 - o, z], [u1 + o, v1 + o, z], [um, vm, zr]], shade(c, -0.25))
  }
  // a window/door on the left face (v fixed) or the right face (u fixed)
  const winL = (v, a, b, z0, z1, glass = "#a8dcf7", frame = "#fffaf0") => {
    poly([[a - 0.04, v, z0 - 2], [b + 0.04, v, z0 - 2], [b + 0.04, v, z1 + 2], [a - 0.04, v, z1 + 2]], frame, null)
    poly([[a, v, z0], [b, v, z0], [b, v, z1], [a, v, z1]], glass)
    poly([[a, v, z1], [a + (b - a) * 0.45, v, z1], [a, v, z0 + (z1 - z0) * 0.4]], "rgba(255,255,255,0.45)", null)
  }
  const winR = (u, a, b, z0, z1, glass = "#86c4e6", frame = "#efe6d6") => {
    poly([[u, a - 0.04, z0 - 2], [u, b + 0.04, z0 - 2], [u, b + 0.04, z1 + 2], [u, a - 0.04, z1 + 2]], frame, null)
    poly([[u, a, z0], [u, b, z0], [u, b, z1], [u, a, z1]], glass)
  }
  const doorL = (v, a, b, h, c = "#8a5a35") => {
    poly([[a, v, 0], [b, v, 0], [b, v, h], [a, v, h]], c)
    const [x, y] = [isoX(b - (b - a) * 0.25, v), isoY(b - (b - a) * 0.25, v, h * 0.45)]
    ctx.fillStyle = "#f3d36b"
    ctx.fillRect(x - 1, y - 1, 2, 2)
  }
  // a flat diamond on the ground
  const ground = (u0, v0, u1, v1, c, stroke = null) => poly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], c, stroke)
  const circle = (u, v, z, r, fill, stroke = OUT) => {
    ctx.beginPath()
    ctx.arc(isoX(u, v), isoY(u, v, z), r, 0, Math.PI * 2)
    if (fill) {
      ctx.fillStyle = fill
      ctx.fill()
    }
    if (stroke) {
      ctx.strokeStyle = stroke
      ctx.stroke()
    }
  }
  const ellipse = (u, v, z, rx, ry, fill, stroke = OUT) => {
    ctx.beginPath()
    ctx.ellipse(isoX(u, v), isoY(u, v, z), rx, ry, 0, 0, Math.PI * 2)
    if (fill) {
      ctx.fillStyle = fill
      ctx.fill()
    }
    if (stroke) {
      ctx.strokeStyle = stroke
      ctx.stroke()
    }
  }
  // a sign on the left face showing a goods icon
  const signL = (v, u, z, size, icon) => {
    const x = isoX(u, v)
    const y = isoY(u, v, z)
    ctx.save()
    ctx.translate(x, y)
    ctx.transform(1, 0.5, 0, 1, 0, 0)
    ctx.fillStyle = "#fffaf0"
    ctx.strokeStyle = OUT
    roundRect(ctx, -size / 2 - 2, -size / 2 - 2, size + 4, size + 4, 3)
    ctx.fill()
    ctx.stroke()
    ctx.translate(-size / 2, -size / 2)
    drawIcon(ctx, icon, size)
    ctx.restore()
  }
  const chimney = (u, v, z0, h, c = "#9b6a55") => box(u - 0.12, v - 0.12, u + 0.12, v + 0.12, z0, z0 + h, c)
  return { ctx, poly, box, gable, pyramid, winL, winR, doorL, ground, circle, ellipse, signL, chimney }
}

export const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ---- the buildings ----
// Each takes the kit and draws with the footprint's top corner at the origin. `up` is how
// far above that corner the art reaches; chimney is where smoke comes out (u, v, z).
const lot = (K, n, c = "#a9d98a") => K.ground(0.04, 0.04, n - 0.04, n - 0.04, c, "rgba(60,100,40,0.25)")
const path2 = (K, n, a, b) => K.ground(a, n - 0.6, b, n - 0.02, "#e8d9b5", null)

const house = (wall, roof, h, opts = {}) => (K) => {
  lot(K)
  path2(K, 2, 0.75, 1.15)
  const [a, b] = [0.3, 1.7]
  K.box(a, a, b, b, 0, h, wall, { top: false })
  if (opts.stories > 1) {
    K.winL(b, 0.45, 0.7, h * 0.6, h * 0.85)
    K.winL(b, 1.25, 1.5, h * 0.6, h * 0.85)
    K.winR(b, 0.5, 0.8, h * 0.6, h * 0.85)
    K.winR(b, 1.2, 1.5, h * 0.6, h * 0.85)
  }
  K.winL(b, 0.42, 0.68, 7, h * (opts.stories > 1 ? 0.4 : 0.7))
  K.doorL(b, 0.82, 1.08, Math.min(20, h * 0.7))
  K.winL(b, 1.25, 1.52, 7, h * (opts.stories > 1 ? 0.4 : 0.7))
  K.winR(b, 0.55, 0.9, 7, h * (opts.stories > 1 ? 0.4 : 0.7))
  K.winR(b, 1.15, 1.45, 7, h * (opts.stories > 1 ? 0.4 : 0.7))
  if (opts.chimney) K.chimney(0.65, 0.75, h + 6, 18)
  if (opts.flat) {
    K.box(a - 0.06, a - 0.06, b + 0.06, b + 0.06, h, h + 5, roof)
  } else K.gable(a, a, b, b, h, h + (opts.roofH || 26), roof, opts.axis || "u", 0.14, wall)
  if (opts.flowers) {
    for (const u of [0.45, 0.6, 1.3, 1.45]) K.circle(u, b + 0.08, 3, 2.5, ["#ff7aa8", "#ffd34d", "#ff9b4d", "#c58cff"][Math.round(u * 10) % 4], null)
  }
}

const B = {}
B.cottage = { n: 2, up: 70, draw: house("#f6e7c8", "#e0614f", 26, { chimney: true, flowers: true }) }
B.bungalow = { n: 2, up: 66, draw: house("#cfe8f5", "#4f7fc4", 24, { axis: "v", flowers: true }) }
B.farmhouse = { n: 2, up: 84, draw: house("#f3d9a8", "#8e5b3c", 40, { stories: 2, chimney: true }) }
B.townhouse = { n: 2, up: 92, draw: house("#e8b4a8", "#5a6a7e", 48, { stories: 2, axis: "v", roofH: 22 }) }
B.villa = {
  n: 2, up: 96,
  draw: (K) => {
    house("#fff6e6", "#d0744a", 46, { stories: 2, roofH: 24, flowers: true })(K)
    K.box(1.55, 0.3, 1.75, 0.55, 0, 58, "#fff6e6")
    K.pyramid(1.5, 0.25, 1.8, 0.6, 58, 72, "#d0744a", 0.03)
  },
}
B.apartments = {
  n: 2, up: 110,
  draw: (K) => {
    lot(K, 2, "#c9d3c0")
    const h = 78
    K.box(0.22, 0.22, 1.78, 1.78, 0, h, "#c98b6b", { top: false })
    for (let f = 0; f < 3; f++) {
      const z = 8 + f * 24
      for (const [a, b] of [[0.35, 0.6], [0.8, 1.05], [1.3, 1.55]]) {
        if (!(f === 0 && a === 0.8)) K.winL(1.78, a, b, z, z + 13)
        K.winR(1.78, a, b, z, z + 13)
      }
    }
    K.doorL(1.78, 0.8, 1.15, 18, "#5a4636")
    K.box(0.16, 0.16, 1.84, 1.84, h, h + 6, "#8b5d48")
    K.box(0.5, 0.5, 0.8, 0.8, h + 6, h + 14, "#9aa4ad")
  },
}

const civic = (wall, roof, h, extra) => (K) => {
  lot(K, 3, "#cfe0b8")
  path2(K, 3, 1.2, 1.8)
  K.box(0.35, 0.35, 2.65, 2.65, 0, h, wall, { top: false })
  extra(K, h, wall, roof)
}

B.townhall = {
  n: 3, up: 140,
  draw: civic("#f4ead6", "#4a76b8", 44, (K, h, wall, roof) => {
    for (const [a, b] of [[0.55, 0.85], [2.15, 2.45]]) K.winL(2.65, a, b, 10, 34)
    for (const [a, b] of [[0.6, 0.95], [1.35, 1.65], [2.05, 2.4]]) K.winR(2.65, a, b, 12, 34)
    // columns and steps
    K.box(1.05, 2.65, 1.95, 2.95, 0, 4, "#e3d9c3")
    for (const u of [1.1, 1.4, 1.65, 1.9]) K.box(u - 0.04, 2.7, u + 0.04, 2.78, 4, h - 4, "#fffaf0")
    K.doorL(2.65, 1.3, 1.7, 26, "#6b4a2e")
    K.gable(0.35, 0.35, 2.65, 2.65, h, h + 22, roof, "v", 0.12, wall)
    // clock tower
    K.box(1.2, 1.2, 1.8, 1.8, h + 10, h + 52, wall)
    K.circle(1.5, 1.8, h + 36, 7, "#fffaf0")
    const c = K.ctx
    c.strokeStyle = "#333"
    c.beginPath()
    const [x, y] = [isoX(1.5, 1.8), isoY(1.5, 1.8, h + 36)]
    c.moveTo(x, y)
    c.lineTo(x, y - 5)
    c.moveTo(x, y)
    c.lineTo(x + 3, y + 1)
    c.stroke()
    K.pyramid(1.15, 1.15, 1.85, 1.85, h + 52, h + 80, roof, 0.05)
    // a flag
    const [fx, fy] = [isoX(1.5, 1.5), isoY(1.5, 1.5, h + 80)]
    c.strokeStyle = "#555"
    c.beginPath()
    c.moveTo(fx, fy)
    c.lineTo(fx, fy - 14)
    c.stroke()
    c.fillStyle = "#ffcf3f"
    c.beginPath()
    c.moveTo(fx, fy - 14)
    c.lineTo(fx + 10, fy - 11)
    c.lineTo(fx, fy - 8)
    c.fill()
  }),
}
B.postoffice = {
  n: 3, up: 100,
  draw: civic("#fde9b9", "#d4483b", 36, (K, h, wall, roof) => {
    for (const [a, b] of [[0.6, 1.0], [2.0, 2.4]]) K.winL(2.65, a, b, 10, 28)
    for (const [a, b] of [[0.7, 1.1], [1.6, 2.0]]) K.winR(2.65, a, b, 10, 28)
    K.doorL(2.65, 1.3, 1.7, 24, "#3c6db0")
    K.gable(0.35, 0.35, 2.65, 2.65, h, h + 26, roof, "u", 0.14, wall)
    // a mailbox and an envelope sign
    K.box(2.75, 2.8, 2.95, 2.95, 0, 14, "#2f6fd1")
    K.signL(2.65, 1.5, h - 6, 12, "envelope")
  }),
}
B.school = {
  n: 3, up: 120,
  draw: civic("#e46b55", "#5b6070", 50, (K, h, wall, roof) => {
    for (let f = 0; f < 2; f++) {
      for (const [a, b] of [[0.5, 0.8], [0.95, 1.2], [1.8, 2.05], [2.2, 2.5]]) K.winL(2.65, a, b, 8 + f * 22, 22 + f * 22)
      for (const [a, b] of [[0.55, 0.85], [1.05, 1.35], [1.6, 1.9], [2.1, 2.4]]) K.winR(2.65, a, b, 8 + f * 22, 22 + f * 22)
    }
    K.doorL(2.65, 1.32, 1.68, 20, "#f4ead6")
    K.box(0.3, 0.3, 2.7, 2.7, h, h + 5, "#f4ead6")
    // bell tower
    K.box(1.25, 1.25, 1.75, 1.75, h + 5, h + 30, "#f4ead6")
    K.circle(1.5, 1.75, h + 18, 4, "#f2c230")
    K.pyramid(1.2, 1.2, 1.8, 1.8, h + 30, h + 50, roof, 0.04)
  }),
}
B.clinic = {
  n: 3, up: 100,
  draw: civic("#f7fbff", "#7fb6d9", 44, (K, h, wall) => {
    for (const [a, b] of [[0.5, 0.9], [2.05, 2.45]]) K.winL(2.65, a, b, 10, 32)
    for (const [a, b] of [[0.6, 1.0], [1.3, 1.7], [2.0, 2.4]]) K.winR(2.65, a, b, 10, 32)
    K.doorL(2.65, 1.2, 1.8, 24, "#9fd3f0")
    K.box(0.3, 0.3, 2.7, 2.7, h, h + 6, "#7fb6d9")
    // a red cross sign on the roof
    K.box(1.1, 1.3, 1.9, 1.5, h + 6, h + 30, "#ffffff")
    const c = K.ctx
    const [x, y] = [isoX(1.5, 1.5), isoY(1.5, 1.5, h + 18)]
    c.fillStyle = "#e5413b"
    c.save()
    c.translate(x, y)
    c.transform(1, -0.5, 0, 1, 0, 0)
    c.fillRect(-9, -3, 18, 6)
    c.fillRect(-3, -9, 6, 18)
    c.restore()
  }),
}
B.firehouse = {
  n: 3, up: 110,
  draw: civic("#c9433a", "#3f3f46", 46, (K, h, wall) => {
    // two big garage doors
    for (const [a, b] of [[0.55, 1.25], [1.6, 2.3]]) {
      K.poly([[a, 2.65, 0], [b, 2.65, 0], [b, 2.65, 30], [a, 2.65, 30]], "#f2f2f2")
      for (let z = 6; z < 30; z += 6) K.poly([[a, 2.65, z], [b, 2.65, z]], null, "rgba(0,0,0,0.2)")
    }
    for (const [a, b] of [[0.7, 1.1], [1.6, 2.0]]) K.winR(2.65, a, b, 14, 34)
    K.box(0.3, 0.3, 2.7, 2.7, h, h + 6, "#3f3f46")
    // hose tower
    K.box(0.45, 0.45, 1.05, 1.05, h + 6, h + 46, wall)
    K.winL(1.05, 0.6, 0.9, h + 26, h + 38)
    K.pyramid(0.4, 0.4, 1.1, 1.1, h + 46, h + 60, "#3f3f46", 0.04)
    K.circle(2.2, 2.65, 38, 4, "#f7d64a")
  }),
}
B.library = {
  n: 3, up: 110,
  draw: civic("#e9dcc0", "#2f7a6a", 44, (K, h, wall, roof) => {
    K.box(0.9, 2.65, 2.1, 2.95, 0, 4, "#d8ccb0")
    for (const u of [0.95, 1.25, 1.75, 2.05]) K.box(u - 0.05, 2.7, u + 0.05, 2.8, 4, h, "#fffdf6")
    K.doorL(2.65, 1.3, 1.7, 26, "#5b3a22")
    for (const [a, b] of [[0.5, 0.75], [2.25, 2.5]]) K.winL(2.65, a, b, 10, 34)
    for (const [a, b] of [[0.6, 0.9], [1.35, 1.65], [2.1, 2.4]]) K.winR(2.65, a, b, 10, 34)
    K.poly([[0.85, 2.85, h], [2.15, 2.85, h], [1.5, 2.85, h + 16]], "#fffdf6")
    K.box(0.3, 0.3, 2.7, 2.7, h, h + 6, roof)
    K.ellipse(1.5, 1.5, h + 18, 18, 12, roof)
    K.signL(2.65, 1.5, h - 6, 10, "book")
  }),
}

// factories
const factory = (wall, roof, h, icon, extra) => (K) => {
  lot(K, 3, "#d7cdb4")
  K.ground(1.0, 2.4, 2.0, 2.96, "#c8b998", null)
  K.box(0.3, 0.3, 2.7, 2.7, 0, h, wall, { top: false })
  extra(K, h, wall, roof)
  if (icon) K.signL(2.7, 0.62, h * 0.55, 13, icon)
}
B.feedmill = {
  n: 3, up: 130, chimney: [0.9, 0.9, 92],
  draw: factory("#d9a35f", "#a5442f", 40, "cowfeed", (K, h, wall, roof) => {
    K.doorL(2.7, 1.3, 1.9, 28, "#7b4b2a")
    K.poly([[1.3, 2.7, 0], [1.9, 2.7, 28]], null, "rgba(0,0,0,0.25)")
    K.poly([[1.9, 2.7, 0], [1.3, 2.7, 28]], null, "rgba(0,0,0,0.25)")
    K.winR(2.7, 0.7, 1.1, 14, 30)
    K.gable(0.3, 1.2, 2.7, 2.7, h, h + 24, roof, "u", 0.12, wall)
    // silo with a dome
    const c = K.ctx
    const [x, y] = [isoX(0.9, 0.9), isoY(0.9, 0.9)]
    c.fillStyle = "#cfd6dc"
    c.strokeStyle = OUT
    c.beginPath()
    c.ellipse(x, y, 20, 10, 0, 0, Math.PI)
    c.lineTo(x - 20, y - 80)
    c.ellipse(x, y - 80, 20, 10, 0, Math.PI, 0)
    c.closePath()
    c.fill()
    c.stroke()
    const g = c.createLinearGradient(x - 20, 0, x + 20, 0)
    g.addColorStop(0, "rgba(255,255,255,0.35)")
    g.addColorStop(1, "rgba(0,0,0,0.15)")
    c.fillStyle = g
    c.fill()
    for (let z = 15; z < 80; z += 15) {
      c.beginPath()
      c.ellipse(x, y - z, 20, 10, 0, 0, Math.PI)
      c.strokeStyle = "rgba(0,0,0,0.15)"
      c.stroke()
    }
    c.beginPath()
    c.ellipse(x, y - 80, 20, 18, 0, Math.PI, 0)
    c.fillStyle = "#a5442f"
    c.fill()
    c.strokeStyle = OUT
    c.stroke()
  }),
}
B.dairy = {
  n: 3, up: 100, chimney: [0.8, 1.6, 70],
  draw: factory("#f5f8fb", "#4a8fd6", 40, "milk", (K, h, wall, roof) => {
    K.doorL(2.7, 1.3, 1.8, 26, "#4a8fd6")
    K.winL(2.7, 2.0, 2.45, 12, 30)
    for (const [a, b] of [[0.6, 1.0], [1.3, 1.7], [2.0, 2.4]]) K.winR(2.7, a, b, 12, 30)
    K.gable(0.3, 0.3, 2.7, 2.7, h, h + 24, roof, "v", 0.12, wall)
    // cow spots
    for (const [u, z] of [[1.0, 30], [2.2, 8]]) K.ellipse(u, 2.7, z, 5, 3, "#2b2b2b", null)
    K.chimney(0.8, 1.6, h + 8, 22, "#c7ccd2")
  }),
}
B.bakery = {
  n: 3, up: 100, chimney: [0.8, 0.8, 80],
  draw: factory("#d77a52", "#7a4a33", 38, "bread", (K, h, wall, roof) => {
    // awning
    K.doorL(2.7, 1.35, 1.75, 24, "#fff1d6")
    K.winL(2.7, 1.95, 2.45, 10, 26, "#ffe6a8")
    for (let k = 0; k < 6; k++) {
      const a = 1.2 + k * 0.23
      K.poly([[a, 2.7, 30], [a + 0.23, 2.7, 30], [a + 0.23, 2.95, 24], [a, 2.95, 24]], k % 2 ? "#fff6ea" : "#e0574a")
    }
    K.winR(2.7, 0.7, 1.2, 12, 28)
    K.gable(0.3, 0.3, 2.7, 2.7, h, h + 22, roof, "u", 0.12, wall)
    K.chimney(0.8, 0.8, h + 10, 26, "#a26248")
  }),
}
B.sugarmill = {
  n: 3, up: 120, chimney: [0.7, 0.7, 100],
  draw: factory("#e9e1f5", "#8a6bbf", 44, "sugar", (K, h, wall, roof) => {
    K.doorL(2.7, 1.3, 1.9, 30, "#8a6bbf")
    for (const [a, b] of [[0.6, 1.0], [1.3, 1.7], [2.0, 2.4]]) K.winR(2.7, a, b, 14, 32)
    K.box(0.25, 0.25, 2.75, 2.75, h, h + 6, roof)
    // tall brick stack
    K.box(0.55, 0.55, 0.85, 0.85, h + 6, h + 56, "#b5674e")
    K.box(0.5, 0.5, 0.9, 0.9, h + 56, h + 60, "#8f4c39")
  }),
}
B.textile = {
  n: 3, up: 100, chimney: [2.2, 0.6, 75],
  draw: factory("#a9c7e8", "#e7e2d6", 38, "fabric", (K, h, wall, roof) => {
    K.doorL(2.7, 1.3, 1.8, 26, "#3e5f86")
    K.winL(2.7, 2.0, 2.5, 12, 28)
    for (const [a, b] of [[0.6, 1.0], [1.3, 1.7], [2.0, 2.4]]) K.winR(2.7, a, b, 12, 28)
    // saw-tooth roof
    for (let k = 0; k < 3; k++) {
      const u0 = 0.3 + k * 0.8
      K.poly([[u0, 0.3, h], [u0, 2.7, h], [u0 + 0.8, 2.7, h + 22], [u0 + 0.8, 0.3, h + 22]], roof)
      K.poly([[u0 + 0.8, 0.3, h], [u0 + 0.8, 2.7, h], [u0 + 0.8, 2.7, h + 22], [u0 + 0.8, 0.3, h + 22]], "#8ec3e8")
      K.poly([[u0, 2.7, h], [u0 + 0.8, 2.7, h], [u0 + 0.8, 2.7, h + 22]], shade(wall, 0))
    }
    K.chimney(2.2, 0.6, h + 22, 14, "#8a7f72")
  }),
}
B.sweetshop = {
  n: 3, up: 110, chimney: [0.8, 0.8, 84],
  draw: factory("#ffd1e3", "#ff7fae", 40, "icecream", (K, h, wall, roof) => {
    K.doorL(2.7, 1.35, 1.75, 24, "#fff4f8")
    K.winL(2.7, 1.95, 2.45, 10, 26, "#fff0b8")
    for (let k = 0; k < 6; k++) {
      const a = 1.2 + k * 0.23
      K.poly([[a, 2.7, 31], [a + 0.23, 2.7, 31], [a + 0.23, 2.97, 24], [a, 2.97, 24]], k % 2 ? "#ffffff" : "#5ec7c0")
    }
    K.winR(2.7, 0.7, 1.2, 12, 28, "#fff0b8")
    K.gable(0.3, 0.3, 2.7, 2.7, h, h + 22, roof, "v", 0.12, wall)
    K.chimney(0.8, 0.8, h + 14, 20, "#d0a0b8")
    // a giant lollipop
    K.box(2.82, 0.5, 2.88, 0.56, 0, 50, "#fff")
    K.circle(2.85, 0.53, 58, 9, "#ff5a8a")
    K.circle(2.85, 0.53, 58, 5, "#ffd1e3", null)
  }),
}

// special buildings
B.barn = {
  n: 3, up: 120,
  draw: (K) => {
    lot(K, 3, "#d7cdb4")
    const h = 44
    K.box(0.3, 0.3, 2.7, 2.7, 0, h, "#c8423a", { top: false })
    // white trim and X doors
    const door = (a, b, z1) => {
      K.poly([[a, 2.7, 0], [b, 2.7, 0], [b, 2.7, z1], [a, 2.7, z1]], "#a8322c", "#fff")
      K.poly([[a, 2.7, 0], [b, 2.7, z1]], null, "#fff")
      K.poly([[b, 2.7, 0], [a, 2.7, z1]], null, "#fff")
    }
    door(1.05, 1.95, 32)
    K.winR(2.7, 1.2, 1.8, 18, 32, "#ffeaa0", "#fff")
    K.gable(0.3, 0.3, 2.7, 2.7, h, h + 40, "#6b4b3a", "v", 0.12, "#c8423a")
    K.poly([[0.3, 2.7, h], [2.7, 2.7, h]], null, "#fff")
    // loft window
    K.poly([[1.3, 2.7, h + 8], [1.7, 2.7, h + 8], [1.7, 2.7, h + 22], [1.3, 2.7, h + 22]], "#5a2b25", "#fff")
    // hay bales
    K.box(2.75, 0.4, 2.98, 0.75, 0, 10, "#f1cf62")
    K.box(2.75, 0.85, 2.98, 1.2, 0, 10, "#f1cf62")
  },
}
B.helipad = {
  n: 3, up: 20,
  draw: (K) => {
    lot(K, 3, "#bcd9a2")
    K.ground(0.35, 0.35, 2.65, 2.65, "#7d8794", OUT)
    K.ellipse(1.5, 1.5, 0, 46, 23, null, "#ffffff")
    const c = K.ctx
    c.save()
    c.translate(isoX(1.5, 1.5), isoY(1.5, 1.5))
    c.transform(1, 0.5, -1, 0.5, 0, 0)
    c.fillStyle = "#ffffff"
    c.fillRect(-12, -14, 5, 28)
    c.fillRect(7, -14, 5, 28)
    c.fillRect(-7, -2.5, 14, 5)
    c.restore()
    for (const [u, v] of [[0.4, 0.4], [2.6, 0.4], [0.4, 2.6], [2.6, 2.6]]) K.circle(u, v, 2, 2.5, "#ffd23f")
  },
}
B.station = {
  n: 3, up: 90,
  draw: (K) => {
    lot(K, 3, "#d9cfb6")
    K.box(0.0, 0.0, 3.0, 0.9, 0, 6, "#c9c1b0") // platform along the track
    K.box(0.6, 1.2, 2.4, 2.6, 0, 34, "#f1d4a0", { top: false })
    K.winL(2.6, 0.8, 1.2, 10, 26)
    K.doorL(2.6, 1.4, 1.75, 22, "#2f5f8a")
    K.winL(2.6, 1.95, 2.25, 10, 26)
    K.winR(2.4, 1.4, 1.8, 10, 26)
    K.gable(0.6, 1.2, 2.4, 2.6, 34, 56, "#2f7a6a", "u", 0.1, "#f1d4a0")
    // canopy on posts over the platform
    for (const u of [0.3, 1.5, 2.7]) K.box(u - 0.04, 0.6, u + 0.04, 0.68, 6, 34, "#5c5c5c")
    K.box(0.1, 0.05, 2.9, 0.9, 34, 37, "#2f7a6a")
    // clock
    K.circle(1.5, 2.6, 44, 5, "#fffaf0")
  },
}

// animal pens: drawn in two parts so the animals can stand between them
const fence = (K, n, side, c = "#fdf6e8") => {
  const posts = []
  const k = n * 3
  for (let i = 0; i <= k; i++) {
    const t = (i / k) * (n - 0.2) + 0.1
    if (side === "back") posts.push([t, 0.1], [0.1, t])
    else posts.push([t, n - 0.1], [n - 0.1, t])
  }
  const rail = (pts, z) => {
    K.ctx.beginPath()
    pts.forEach(([u, v], i) => (i ? K.ctx.lineTo(isoX(u, v), isoY(u, v, z)) : K.ctx.moveTo(isoX(u, v), isoY(u, v, z))))
    K.ctx.strokeStyle = OUT
    K.ctx.lineWidth = 3
    K.ctx.stroke()
    K.ctx.strokeStyle = c
    K.ctx.lineWidth = 1.6
    K.ctx.stroke()
    K.ctx.lineWidth = 1
  }
  const line = side === "back" ? [[0.1, n - 0.1], [0.1, 0.1], [n - 0.1, 0.1]] : [[0.1, n - 0.1], [n - 0.1, n - 0.1], [n - 0.1, 0.1]]
  for (const [u, v] of posts) K.box(u - 0.035, v - 0.035, u + 0.035, v + 0.035, 0, 11, c)
  rail(line, 9)
  rail(line, 5)
}
const penBack = (grass, extra) => (K) => {
  K.ground(0.05, 0.05, 2.95, 2.95, grass, "rgba(60,100,40,0.3)")
  for (let i = 0; i < 14; i++) {
    const u = 0.3 + ((i * 0.37) % 2.4)
    const v = 0.3 + ((i * 0.61) % 2.4)
    K.circle(u, v, 0, 1.2, shade(grass.length === 7 ? grass : "#8fd16a", -0.15), null)
  }
  extra?.(K)
  fence(K, 3, "back")
}
const trough = (K, u, v, c = "#9b6b43") => {
  K.box(u, v, u + 0.7, v + 0.22, 0, 6, c)
  K.poly([[u + 0.05, v + 0.03, 6], [u + 0.65, v + 0.03, 6], [u + 0.65, v + 0.19, 6], [u + 0.05, v + 0.19, 6]], "#6a4a2c", null)
}
B.cowpen = { n: 3, up: 30, draw: penBack("#93d46f", (K) => trough(K, 0.35, 0.3)), front: (K) => fence(K, 3, "front") }
B.coop = {
  n: 3, up: 70,
  draw: penBack("#d9c08a", (K) => {
    // a little hen house at the back
    K.box(0.3, 0.3, 1.3, 1.1, 0, 22, "#f0c25a", { top: false })
    K.poly([[0.6, 1.1, 2], [0.9, 1.1, 2], [0.9, 1.1, 14], [0.6, 1.1, 14]], "#5a3d24")
    K.gable(0.3, 0.3, 1.3, 1.1, 22, 38, "#d4483b", "u", 0.08, "#f0c25a")
    trough(K, 1.8, 0.3, "#b08050")
  }),
  front: (K) => fence(K, 3, "front", "#f0e2c0"),
}
B.sheeppen = {
  n: 3, up: 30,
  draw: penBack("#a5dc7a", (K) => {
    trough(K, 1.7, 0.3)
    K.circle(0.6, 0.6, 2, 6, "#9aa3a8")
  }),
  front: (K) => fence(K, 3, "front", "#d6c3a2"),
}

// decorations
const treeArt = (K, u, v, s = 1, c = "#5bb04a") => {
  K.box(u - 0.05 * s, v - 0.05 * s, u + 0.05 * s, v + 0.05 * s, 0, 14 * s, "#8a5a35")
  K.circle(u, v, 26 * s, 13 * s, shade(c, -0.1))
  K.circle(u - 0.12 * s, v + 0.1 * s, 22 * s, 9 * s, c, null)
  K.circle(u + 0.1 * s, v - 0.12 * s, 32 * s, 8 * s, shade(c, 0.15), null)
  K.circle(u - 0.18, v + 0.05, 30 * s, 3 * s, "rgba(255,255,255,0.25)", null)
}
const pineArt = (K, u, v, s = 1, c = "#3f9a5a") => {
  K.box(u - 0.04 * s, v - 0.04 * s, u + 0.04 * s, v + 0.04 * s, 0, 8 * s, "#7a4a2a")
  const x = isoX(u, v)
  const y = isoY(u, v)
  const ctx = K.ctx
  for (let k = 0; k < 3; k++) {
    const w = (14 - k * 3.5) * s
    const y0 = y - (6 + k * 10) * s
    ctx.beginPath()
    ctx.moveTo(x - w, y0)
    ctx.lineTo(x, y0 - 18 * s)
    ctx.lineTo(x + w, y0)
    ctx.closePath()
    ctx.fillStyle = shade(c, k * 0.08)
    ctx.fill()
    ctx.strokeStyle = OUT
    ctx.stroke()
  }
}
B.tree = { n: 1, up: 50, draw: (K) => treeArt(K, 0.5, 0.5, 1) }
B.flowers = {
  n: 1, up: 16,
  draw: (K) => {
    K.ground(0.12, 0.12, 0.88, 0.88, "#8a5a3a", OUT)
    const cols = ["#ff6f91", "#ffd23f", "#ff9a3c", "#b07cff", "#ffffff"]
    let k = 0
    for (let u = 0.25; u < 0.85; u += 0.18) for (let v = 0.25; v < 0.85; v += 0.18) {
      K.circle(u, v, 3, 1.6, "#3f8f3a", null)
      K.circle(u, v, 6, 2.6, cols[k++ % cols.length], null)
    }
  },
}
B.bench = {
  n: 1, up: 24,
  draw: (K) => {
    K.ground(0.15, 0.3, 0.85, 0.7, "#e2d4b0", null)
    K.box(0.2, 0.42, 0.8, 0.6, 6, 8, "#b07843")
    K.box(0.2, 0.36, 0.8, 0.42, 8, 18, "#b07843")
    for (const u of [0.25, 0.75]) K.box(u - 0.03, 0.45, u + 0.03, 0.57, 0, 6, "#444")
  },
}
B.lamp = {
  n: 1, up: 56,
  draw: (K) => {
    K.box(0.44, 0.44, 0.56, 0.56, 0, 4, "#3d4a55")
    K.box(0.47, 0.47, 0.53, 0.53, 4, 40, "#3d4a55")
    K.box(0.4, 0.4, 0.6, 0.6, 40, 50, "#ffe9a3")
    K.pyramid(0.38, 0.38, 0.62, 0.62, 50, 56, "#3d4a55", 0)
  },
}
B.fountain = {
  n: 2, up: 50,
  draw: (K) => {
    K.ground(0.1, 0.1, 1.9, 1.9, "#e2d9c6", OUT)
    K.ellipse(1, 1, 4, 44, 22, "#cfc6b4")
    K.ellipse(1, 1, 6, 38, 19, "#6cc8ee")
    K.ellipse(1, 1, 7, 26, 12, "rgba(255,255,255,0.25)", null)
    K.box(0.9, 0.9, 1.1, 1.1, 6, 26, "#d8cfbd")
    K.ellipse(1, 1, 26, 14, 7, "#cfc6b4")
    K.ellipse(1, 1, 27, 11, 5, "#8fdaf5", null)
  },
}
B.pond = {
  n: 2, up: 30,
  draw: (K) => {
    K.ellipse(1, 1, 0, 56, 26, "#e9d9a8", null)
    K.ellipse(1, 1, 0, 48, 22, "#4fb3e0")
    K.ellipse(0.9, 0.9, 0, 30, 12, "rgba(255,255,255,0.18)", null)
    K.ellipse(1.35, 0.65, 0, 7, 3.5, "#5bb04a", null)
    for (const [u, v] of [[0.2, 1.7], [1.8, 0.3]]) {
      K.box(u - 0.02, v - 0.02, u + 0.02, v + 0.02, 0, 18, "#5d8a3a")
      K.ellipse(u, v, 20, 2, 5, "#7a4a2a", null)
    }
  },
}
B.statue = {
  n: 2, up: 80,
  draw: (K) => {
    K.ground(0.15, 0.15, 1.85, 1.85, "#e2d9c6", OUT)
    K.box(0.55, 0.55, 1.45, 1.45, 0, 8, "#a9a297")
    K.box(0.65, 0.65, 1.35, 1.35, 8, 22, "#c3bcae")
    // a bronze farmer holding up a sheaf of wheat
    const bronze = "#c99a3e"
    K.box(0.86, 0.9, 0.96, 1.0, 22, 36, bronze)
    K.box(1.04, 0.9, 1.14, 1.0, 22, 36, bronze)
    K.box(0.84, 0.86, 1.16, 1.06, 36, 54, bronze)
    K.circle(1, 0.96, 60, 5.5, bronze)
    K.ellipse(1, 0.96, 64, 8, 2.5, "#a77a28")
    K.box(1.16, 0.92, 1.22, 0.98, 50, 70, bronze)
    for (const dx of [-3, 0, 3]) {
      K.ctx.fillStyle = "#e0b850"
      K.ctx.beginPath()
      K.ctx.ellipse(isoX(1.19, 0.95) + dx, isoY(1.19, 0.95, 76), 1.8, 4, dx * 0.1, 0, Math.PI * 2)
      K.ctx.fill()
    }
    K.box(0.56, 1.45, 1.44, 1.47, 3, 7, "#d9c27a", { top: false })
  },
}

// wild land: trees, bushes and rocks on land you don't own yet
B.wildOak = { n: 1, up: 50, draw: (K) => treeArt(K, 0.5, 0.5, 1.05, "#4e9e44") }
B.wildOak2 = { n: 1, up: 46, draw: (K) => treeArt(K, 0.45, 0.55, 0.9, "#6ab44f") }
B.wildPine = { n: 1, up: 62, draw: (K) => pineArt(K, 0.5, 0.5, 1.15) }
B.wildPine2 = { n: 1, up: 52, draw: (K) => pineArt(K, 0.5, 0.5, 0.95, "#2f8a55") }
B.bush = {
  n: 1, up: 20,
  draw: (K) => {
    K.circle(0.4, 0.5, 6, 7, "#4f9e3f")
    K.circle(0.6, 0.45, 8, 8, "#5bb04a")
    K.circle(0.5, 0.65, 5, 6, "#6ec25a")
  },
}
B.rock = {
  n: 1, up: 16,
  draw: (K) => {
    K.ellipse(0.5, 0.5, 5, 11, 7, "#a7a9ad")
    K.ellipse(0.42, 0.45, 8, 5, 3, "rgba(255,255,255,0.35)", null)
  },
}
// a "For sale" sign on land you can buy
B.saleSign = {
  n: 1, up: 46,
  draw: (K) => {
    K.box(0.47, 0.47, 0.53, 0.53, 0, 28, "#7a4a2a")
    const c = K.ctx
    const [x, y] = [isoX(0.5, 0.5), isoY(0.5, 0.5, 34)]
    c.fillStyle = "#fff4cf"
    c.strokeStyle = OUT
    roundRect(c, x - 16, y - 10, 32, 18, 3)
    c.fill()
    c.stroke()
    c.save()
    c.translate(x - 8, y - 9)
    drawIcon(c, "shovel", 16)
    c.restore()
  },
}

// a building site, shown while something is being built
B.site2 = { n: 2, up: 50, draw: (K) => site(K, 2) }
B.site3 = { n: 3, up: 70, draw: (K) => site(K, 3) }
const site = (K, n) => {
  K.ground(0.1, 0.1, n - 0.1, n - 0.1, "#c9a978", OUT)
  const h = n * 14
  for (const [u, v] of [[0.3, 0.3], [n - 0.3, 0.3], [0.3, n - 0.3], [n - 0.3, n - 0.3]]) K.box(u - 0.04, v - 0.04, u + 0.04, v + 0.04, 0, h, "#e0a33c")
  K.box(0.3, 0.3, n - 0.3, n - 0.3, h - 3, h, "#e0a33c", { top: false })
  K.box(0.5, n - 0.9, 1.0, n - 0.5, 0, 10, "#b5674e")
  K.box(n - 0.9, 0.6, n - 0.45, 1.0, 0, 8, "#9c7a54")
  K.box(n * 0.45, n * 0.45, n * 0.55, n * 0.55, 0, 6, "#a7a9ad")
}

// ---- playing together ----
// a heart centred on (x, y), about 2r wide
export const heartPath = (ctx, x, y, r) => {
  ctx.beginPath()
  ctx.moveTo(x, y + r * 0.95)
  ctx.bezierCurveTo(x - r * 1.5, y - r * 0.05, x - r * 0.95, y - r * 1.25, x, y - r * 0.45)
  ctx.bezierCurveTo(x + r * 0.95, y - r * 1.25, x + r * 1.5, y - r * 0.05, x, y + r * 0.95)
  ctx.closePath()
}
const heartAt = (ctx, x, y, r, fill = "#ff5f8f", stroke = OUT) => {
  heartPath(ctx, x, y, r)
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.stroke()
  }
  ctx.fillStyle = "rgba(255,255,255,0.55)"
  ctx.beginPath()
  ctx.ellipse(x - r * 0.45, y - r * 0.35, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2)
  ctx.fill()
}

// the Couple's Cottage: a pink cottage with a heart over the door and on the roof
B.lovecottage = {
  n: 2, up: 84,
  draw: (K) => {
    house("#ffe6ee", "#e8678f", 26, { chimney: true, flowers: true })(K)
    // a heart-shaped wreath over the door, and one on the ridge
    const c = K.ctx
    heartAt(c, isoX(0.95, 1.7), isoY(0.95, 1.7, 23), 4.5, "#ff7aa2")
    heartAt(c, isoX(1, 1), isoY(1, 1, 60), 7.5, "#ff4f86")
    // a little path of heart stepping stones
    for (const [u, k] of [[0.9, 0], [1.05, 1]]) {
      const x = isoX(u, 2.05 + k * 0.12)
      const y = isoY(u, 2.05 + k * 0.12)
      heartAt(c, x, y, 2.6, "#f6d2dc", "rgba(120,60,80,0.35)")
    }
  },
}

// a topiary clipped into a heart, in a terracotta pot
B.hearttree = {
  n: 1, up: 56,
  draw: (K) => {
    K.box(0.36, 0.36, 0.64, 0.64, 0, 9, "#c8714a")
    K.box(0.34, 0.34, 0.66, 0.66, 9, 11, "#b5603d")
    K.box(0.48, 0.48, 0.52, 0.52, 11, 20, "#7a4a2a")
    const c = K.ctx
    const x = isoX(0.5, 0.5)
    const y = isoY(0.5, 0.5, 36)
    heartAt(c, x, y, 15, "#4fae4a")
    heartAt(c, x - 2, y - 1, 11, "#62c25a", null)
    for (const [dx, dy] of [[-7, -4], [6, -6], [1, 4], [-2, -10], [8, 2]]) {
      c.fillStyle = "#ff8fb4"
      c.beginPath()
      c.arc(x + dx, y + dy, 1.8, 0, Math.PI * 2)
      c.fill()
    }
  },
}

// the mailbox (gifts arrive here); the flag goes up when one is waiting
const mailbox = (flag) => (K) => {
  K.ground(0.3, 0.3, 0.7, 0.7, "rgba(0,0,0,0.08)", null)
  K.box(0.47, 0.47, 0.53, 0.53, 0, 20, "#8a5a35")
  K.box(0.3, 0.42, 0.7, 0.58, 20, 30, "#5b8ee0")
  const c = K.ctx
  // the rounded top
  c.fillStyle = "#6f9fe8"
  c.strokeStyle = OUT
  c.beginPath()
  const [x0, y0] = [isoX(0.3, 0.58), isoY(0.3, 0.58, 30)]
  const [x1, y1] = [isoX(0.7, 0.58), isoY(0.7, 0.58, 30)]
  c.moveTo(x0, y0)
  c.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 - 12, x1, y1)
  c.lineTo(isoX(0.7, 0.42), isoY(0.7, 0.42, 30))
  c.quadraticCurveTo((x1 + isoX(0.3, 0.42)) / 2 + 4, (y1 + isoY(0.3, 0.42, 30)) / 2 - 14, isoX(0.3, 0.42), isoY(0.3, 0.42, 30))
  c.closePath()
  c.fill()
  c.stroke()
  heartAt(c, isoX(0.5, 0.58), isoY(0.5, 0.58, 25), 3, "#ff7aa2", null)
  // the flag on the right side
  const fx = isoX(0.7, 0.5)
  const fy = isoY(0.7, 0.5, 26)
  c.strokeStyle = "#5a3a2a"
  c.lineWidth = 1.5
  c.beginPath()
  c.moveTo(fx, fy)
  c.lineTo(fx + (flag ? 1 : 9), fy - (flag ? 14 : 2))
  c.stroke()
  c.lineWidth = 1
  c.fillStyle = "#e5413b"
  c.strokeStyle = OUT
  c.beginPath()
  if (flag) c.rect(fx + 1, fy - 14, 7, 5)
  else c.rect(fx + 5, fy - 3, 6, 4)
  c.fill()
  c.stroke()
}
B.mailbox = { n: 1, up: 50, draw: mailbox(false) }
B.mailboxUp = { n: 1, up: 50, draw: mailbox(true) }

// the welcome sign by the station (the names are written on live, see render.js)
export const WELCOME_BOARD = { w: 76, h: 28, z: 30 }
B.welcome = {
  n: 1, up: 66,
  draw: (K) => {
    for (const u of [0.22, 0.78]) K.box(u - 0.04, 0.46, u + 0.04, 0.54, 0, 32, "#8a5a35")
    const c = K.ctx
    const x = isoX(0.5, 0.5)
    const y = isoY(0.5, 0.5, WELCOME_BOARD.z)
    c.fillStyle = "#9b6b43"
    c.strokeStyle = OUT
    roundRect(c, x - WELCOME_BOARD.w / 2 - 3, y - WELCOME_BOARD.h - 3, WELCOME_BOARD.w + 6, WELCOME_BOARD.h + 6, 5)
    c.fill()
    c.stroke()
    c.fillStyle = "#fff4dc"
    roundRect(c, x - WELCOME_BOARD.w / 2, y - WELCOME_BOARD.h, WELCOME_BOARD.w, WELCOME_BOARD.h, 3)
    c.fill()
    // flowers at its feet
    for (const [u, col] of [[0.3, "#ff7aa2"], [0.5, "#ffd34d"], [0.7, "#c58cff"]]) K.circle(u, 0.62, 3, 2.6, col, null)
  },
}

// a note a visitor left: a little card on a stake with a heart pin
B.noteSign = {
  n: 1, up: 40,
  draw: (K) => {
    K.box(0.48, 0.48, 0.52, 0.52, 0, 16, "#8a5a35")
    const c = K.ctx
    const x = isoX(0.5, 0.5)
    const y = isoY(0.5, 0.5, 16)
    c.save()
    c.translate(x, y)
    c.rotate(-0.06)
    c.fillStyle = "#fffaf0"
    c.strokeStyle = OUT
    roundRect(c, -11, -17, 22, 16, 2)
    c.fill()
    c.stroke()
    c.strokeStyle = "rgba(90,70,110,0.45)"
    for (const ly of [-12, -8, -4]) {
      c.beginPath()
      c.moveTo(-7, ly)
      c.lineTo(7, ly)
      c.stroke()
    }
    heartAt(c, 0, -17, 3.2, "#ff4f86")
    c.restore()
  },
}

export const BUILDINGS = B

// ---- crops on fields ----
const plantAt = (K, crop, stage, u, v) => {
  const ctx = K.ctx
  const x = isoX(u, v)
  const y = isoY(u, v)
  const blade = (dx, h, c, w = 1.4) => {
    ctx.strokeStyle = c
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.moveTo(x + dx * 0.3, y)
    ctx.quadraticCurveTo(x + dx * 0.6, y - h * 0.6, x + dx, y - h)
    ctx.stroke()
    ctx.lineWidth = 1
  }
  if (stage === 1) {
    blade(-2, 4, "#5fbf4a")
    blade(2, 4, "#5fbf4a")
    return
  }
  const ripe = stage === 4
  const g = ripe ? "#4fa63f" : "#5fbf4a"
  if (crop === "wheat") {
    const c = ripe ? "#e9bf3c" : stage === 3 ? "#bfd65a" : "#7fcf5a"
    const h = stage === 2 ? 8 : 13
    for (const dx of [-3, 0, 3]) {
      blade(dx, h, c, 1.3)
      if (stage >= 3) {
        ctx.fillStyle = ripe ? "#f6d35a" : "#cfe07a"
        ctx.beginPath()
        ctx.ellipse(x + dx, y - h - 2, 1.6, 3.2, dx * 0.08, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  } else if (crop === "corn") {
    const h = stage === 2 ? 10 : 18
    blade(-1, h, g, 2)
    blade(-5, h * 0.6, g, 1.4)
    blade(4, h * 0.65, g, 1.4)
    if (stage >= 3) {
      ctx.fillStyle = ripe ? "#ffd53a" : "#d8e27a"
      ctx.strokeStyle = OUT
      ctx.beginPath()
      ctx.ellipse(x + 2, y - h * 0.55, 2.2, 4.5, 0.3, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  } else if (crop === "carrot") {
    if (stage >= 3) {
      ctx.fillStyle = ripe ? "#ff8a2a" : "#f0a860"
      ctx.beginPath()
      ctx.ellipse(x, y - 1, 2.6, 2, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const dx of [-3, 0, 3]) blade(dx, stage === 2 ? 6 : 9, g, 1.6)
  } else if (crop === "sugarcane") {
    const h = stage === 2 ? 10 : 20
    for (const dx of [-3, 1, 4]) {
      ctx.strokeStyle = ripe ? "#9fcf4a" : "#79c25a"
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.moveTo(x + dx, y)
      ctx.lineTo(x + dx, y - h)
      ctx.stroke()
      ctx.lineWidth = 1
      ctx.strokeStyle = "rgba(60,90,30,0.6)"
      for (let z = 5; z < h; z += 5) {
        ctx.beginPath()
        ctx.moveTo(x + dx - 1.2, y - z)
        ctx.lineTo(x + dx + 1.2, y - z)
        ctx.stroke()
      }
    }
    blade(-6, h * 0.8, g)
    blade(6, h * 0.9, g)
  } else if (crop === "cotton") {
    ctx.fillStyle = ripe ? "#4f8f3a" : "#5fae45"
    ctx.beginPath()
    ctx.ellipse(x, y - 5, 6, 5, 0, 0, Math.PI * 2)
    ctx.fill()
    if (stage >= 3)
      for (const [dx, dy] of [[-3, -8], [3, -9], [0, -4]]) {
        ctx.fillStyle = ripe ? "#ffffff" : "#e6f0d8"
        ctx.beginPath()
        ctx.arc(x + dx, y + dy, ripe ? 2.8 : 1.8, 0, Math.PI * 2)
        ctx.fill()
      }
  } else if (crop === "strawberry") {
    ctx.fillStyle = "#4ea53c"
    for (const dx of [-4, 0, 4]) {
      ctx.beginPath()
      ctx.ellipse(x + dx, y - 3, 3.2, 2.2, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    if (stage >= 3)
      for (const dx of [-3, 3]) {
        ctx.fillStyle = ripe ? "#ff3b4e" : "#f2c6a0"
        ctx.beginPath()
        ctx.arc(x + dx, y - 1, 2.4, 0, Math.PI * 2)
        ctx.fill()
      }
  }
}

export const drawField = (K, crop, stage) => {
  K.ground(0.06, 0.06, 0.94, 0.94, crop ? "#9a6236" : "#b07646", "rgba(70,40,20,0.5)")
  const ctx = K.ctx
  ctx.strokeStyle = "rgba(70,40,20,0.35)"
  for (const t of [0.28, 0.5, 0.72]) {
    ctx.beginPath()
    ctx.moveTo(isoX(0.12, t), isoY(0.12, t))
    ctx.lineTo(isoX(0.88, t), isoY(0.88, t))
    ctx.stroke()
  }
  if (!crop || !stage) return
  for (const v of [0.28, 0.5, 0.72]) for (const u of [0.25, 0.5, 0.75]) plantAt(K, crop, stage, u, v)
}

// ---- sprites ----
// A sprite is an offscreen canvas plus where the footprint's top corner sits in it.
let spriteScale = 1
const spriteCache = new Map()
export const setSpriteScale = (k) => {
  if (k === spriteScale) return
  spriteScale = k
  spriteCache.clear()
}
export const getSpriteScale = () => spriteScale

const PAD = 12
export const makeSprite = (key, n, up, draw, k = spriteScale) => {
  const id = `${key}@${k}`
  let s = spriteCache.get(id)
  if (s) return s
  const w = n * TW + PAD * 2
  const h = up + n * TH + PAD
  const canvas = document.createElement("canvas")
  canvas.width = Math.ceil(w * k)
  canvas.height = Math.ceil(h * k)
  const ctx = canvas.getContext("2d")
  ctx.scale(k, k)
  ctx.translate(n * (TW / 2) + PAD, up)
  draw(kit(ctx))
  s = { canvas, ox: n * (TW / 2) + PAD, oy: up, w, h }
  spriteCache.set(id, s)
  return s
}

export const buildingSprite = (type, part = "draw") => {
  const b = B[type]
  if (!b) return null
  if (part === "front") return b.front ? makeSprite(`${type}:front`, b.n, 20, b.front) : null
  return makeSprite(type, b.n, b.up, b.draw)
}
export const fieldSprite = (crop, stage) => makeSprite(`field:${crop || "-"}:${crop ? stage : 0}`, 1, 30, (K) => drawField(K, crop, stage))

// ---- animals ----
export const drawAnimal = (ctx, kind, x, y, s, flip, t, eating) => {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(flip ? -s : s, s)
  ctx.strokeStyle = OUT
  ctx.lineWidth = 1 / s
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.18)"
  ctx.beginPath()
  ctx.ellipse(0, 0, 9, 3.5, 0, 0, Math.PI * 2)
  ctx.fill()
  const bob = eating ? Math.sin(t * 8) * 1.2 : 0
  if (kind === "cow") {
    ctx.fillStyle = "#3b3b3b"
    for (const lx of [-6, -3, 3, 6]) ctx.fillRect(lx - 1, -5, 2, 5)
    ctx.fillStyle = "#ffffff"
    ctx.beginPath()
    ctx.ellipse(0, -9, 9, 5.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = "#2f2f2f"
    ctx.beginPath()
    ctx.ellipse(-3, -10, 3, 2.2, 0.3, 0, Math.PI * 2)
    ctx.ellipse(4, -8, 2.2, 1.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "#ffffff"
    ctx.beginPath()
    ctx.ellipse(9, -11 + bob, 4, 3.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = "#f7b9b0"
    ctx.beginPath()
    ctx.ellipse(11.5, -10 + bob, 2.2, 1.8, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "#222"
    ctx.fillRect(8.5, -13 + bob, 1.2, 1.2)
    ctx.fillStyle = "#e9d38a"
    ctx.fillRect(7, -16 + bob, 1.4, 2.4)
    ctx.fillRect(10, -16 + bob, 1.4, 2.4)
  } else if (kind === "chicken") {
    ctx.fillStyle = "#e3a23b"
    ctx.fillRect(-1.5, -3, 1, 3)
    ctx.fillRect(1, -3, 1, 3)
    ctx.fillStyle = "#ffffff"
    ctx.beginPath()
    ctx.ellipse(0, -6, 5, 4, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(4, -10 + bob, 2.6, 2.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = "#e5413b"
    ctx.fillRect(3.2, -13.4 + bob, 2, 1.6)
    ctx.fillStyle = "#f2a531"
    ctx.beginPath()
    ctx.moveTo(6.4, -10 + bob)
    ctx.lineTo(8.4, -9.2 + bob)
    ctx.lineTo(6.4, -8.6 + bob)
    ctx.fill()
    ctx.fillStyle = "#222"
    ctx.fillRect(4.4, -10.8 + bob, 1, 1)
  } else {
    ctx.fillStyle = "#2f2f2f"
    for (const lx of [-5, -2, 2, 5]) ctx.fillRect(lx - 0.8, -4, 1.6, 4)
    ctx.fillStyle = "#fbf6ea"
    for (const [dx, dy, r] of [[-5, -8, 4], [0, -10, 5], [5, -8, 4], [-2, -6, 4], [3, -6, 4]]) {
      ctx.beginPath()
      ctx.arc(dx, dy, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.beginPath()
    ctx.ellipse(0, -8, 8, 5, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = "#3a3a3a"
    ctx.beginPath()
    ctx.ellipse(9, -10 + bob, 3, 2.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "#fff"
    ctx.fillRect(9.5, -11 + bob, 1, 1)
  }
  ctx.restore()
}

// ---- the helicopter and the train ----
export const drawHelicopter = (ctx, x, y, s, t, spin) => {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s, s)
  ctx.strokeStyle = OUT
  ctx.lineWidth = 1 / s
  // skids
  ctx.strokeStyle = "#444"
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(-14, 2)
  ctx.lineTo(12, 8)
  ctx.moveTo(-18, 6)
  ctx.lineTo(8, 12)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.strokeStyle = OUT
  // tail
  ctx.fillStyle = "#e9573f"
  ctx.beginPath()
  ctx.moveTo(-8, -8)
  ctx.lineTo(-34, -16)
  ctx.lineTo(-34, -11)
  ctx.lineTo(-8, -2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#fff"
  ctx.fillRect(-36, -21, 4, 9)
  // body
  ctx.fillStyle = "#f2643f"
  ctx.beginPath()
  ctx.ellipse(0, -6, 15, 10, 0.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#9fdcf8"
  ctx.beginPath()
  ctx.ellipse(7, -9, 7, 6, 0.3, -1.6, 1.4)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#ffd23f"
  ctx.fillRect(-8, -4, 10, 3)
  // rotor
  ctx.fillStyle = "#555"
  ctx.fillRect(-1, -19, 2, 4)
  const a = t * (spin ? 30 : 0.5)
  ctx.strokeStyle = spin ? "rgba(60,60,60,0.55)" : "#555"
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let k = 0; k < 2; k++) {
    const ang = a + k * Math.PI / 2
    ctx.moveTo(Math.cos(ang) * -28, -19 + Math.sin(ang) * -7)
    ctx.lineTo(Math.cos(ang) * 28, -19 + Math.sin(ang) * 7)
  }
  ctx.stroke()
  if (spin) {
    ctx.strokeStyle = "rgba(80,80,80,0.18)"
    ctx.beginPath()
    ctx.ellipse(0, -19, 28, 7, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

// a train car on the rails: u is its front along the track, kind "engine" or a cargo color
export const drawTrainCar = (K, u, v, kind, len = 1.3) => {
  const v0 = v + 0.2
  const v1 = v + 0.8
  const u0 = u - len
  if (kind === "engine") {
    K.box(u0, v0, u, v1, 5, 18, "#2f7a4a")
    K.box(u0 + 0.05, v0 + 0.05, u0 + 0.6, v1 - 0.05, 18, 36, "#2f7a4a")
    K.winL(v1 - 0.05, u0 + 0.15, u0 + 0.45, 22, 31)
    K.box(u0, v0 - 0.02, u0 + 0.65, v1 + 0.02, 36, 39, "#24333a")
    K.box(u - 0.45, v + 0.42, u - 0.3, v + 0.58, 18, 34, "#24333a")
    K.box(u - 0.05, v0 + 0.05, u + 0.08, v1 - 0.05, 3, 12, "#e5413b")
    K.circle(u + 0.02, v + 0.5, 14, 2.6, "#fff6b0")
  } else {
    K.box(u0, v0, u, v1, 5, 24, kind)
    K.poly([[u0 + 0.1, v1, 9], [u - 0.1, v1, 9], [u - 0.1, v1, 20], [u0 + 0.1, v1, 20]], null, "rgba(255,255,255,0.5)")
  }
  for (const w of [u0 + 0.25, u - 0.25]) K.circle(w, v1, 4, 3.2, "#2c2c2c")
}
export const trainKit = (ctx) => kit(ctx)

// ---- icons for goods, materials and money ----
const I = {}
const blob = (ctx, x, y, rx, ry, fill, rot = 0) => {
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.stroke()
}
const sack = (c) => (ctx) => {
  ctx.fillStyle = "#e8d3a6"
  ctx.beginPath()
  ctx.moveTo(9, 7)
  ctx.quadraticCurveTo(4, 18, 7, 28)
  ctx.lineTo(25, 28)
  ctx.quadraticCurveTo(28, 18, 23, 7)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#d4b984"
  ctx.fillRect(10, 4, 12, 4)
  ctx.strokeRect(10, 4, 12, 4)
  ctx.fillStyle = c
  roundRect(ctx, 9, 14, 14, 9, 2)
  ctx.fill()
  ctx.stroke()
}
I.wheat = (ctx) => {
  ctx.strokeStyle = "#b8862a"
  ctx.lineWidth = 1.5
  for (const a of [-0.35, 0, 0.35]) {
    ctx.save()
    ctx.translate(16, 28)
    ctx.rotate(a)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(0, -20)
    ctx.stroke()
    ctx.fillStyle = "#f2c94c"
    for (let k = 0; k < 4; k++) {
      blob(ctx, -2.2, -12 - k * 3.6, 1.8, 3, "#f2c94c", -0.5)
      blob(ctx, 2.2, -12 - k * 3.6, 1.8, 3, "#f2c94c", 0.5)
    }
    ctx.restore()
  }
  ctx.fillStyle = "#c0392b"
  ctx.fillRect(11, 20, 10, 3)
}
I.corn = (ctx) => {
  blob(ctx, 16, 15, 6, 11, "#ffd53a", 0.35)
  ctx.fillStyle = "rgba(200,140,0,0.4)"
  for (let k = 0; k < 5; k++) for (let j = -1; j <= 1; j++) ctx.fillRect(14 + j * 3 + k * 1.3, 7 + k * 3.5, 1.5, 1.5)
  ctx.fillStyle = "#5fb04a"
  ctx.beginPath()
  ctx.moveTo(12, 29)
  ctx.quadraticCurveTo(4, 18, 10, 9)
  ctx.quadraticCurveTo(10, 20, 17, 24)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(14, 29)
  ctx.quadraticCurveTo(26, 22, 24, 12)
  ctx.quadraticCurveTo(21, 22, 15, 24)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
}
I.carrot = (ctx) => {
  ctx.fillStyle = "#ff8a2a"
  ctx.beginPath()
  ctx.moveTo(10, 10)
  ctx.quadraticCurveTo(22, 8, 22, 12)
  ctx.lineTo(9, 29)
  ctx.quadraticCurveTo(6, 18, 10, 10)
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = "rgba(160,70,0,0.6)"
  ctx.beginPath()
  ctx.moveTo(12, 15)
  ctx.lineTo(16, 14)
  ctx.moveTo(11, 20)
  ctx.lineTo(14, 19.5)
  ctx.stroke()
  ctx.strokeStyle = OUT
  ctx.fillStyle = "#4fae3c"
  for (const a of [-0.6, 0, 0.6]) blob(ctx, 19 + a * 4, 6 - Math.abs(a) * 2, 2, 5, "#4fae3c", a + 0.6)
}
I.sugarcane = (ctx) => {
  for (const [x, c] of [[10, "#8fcf4a"], [16, "#a5d95a"], [22, "#8fcf4a"]]) {
    ctx.fillStyle = c
    ctx.fillRect(x - 2.5, 4, 5, 25)
    ctx.strokeRect(x - 2.5, 4, 5, 25)
    ctx.fillStyle = "rgba(60,100,20,0.5)"
    for (let y = 9; y < 29; y += 6) ctx.fillRect(x - 2.5, y, 5, 1.5)
  }
}
I.cotton = (ctx) => {
  ctx.strokeStyle = "#7a4a2a"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(16, 30)
  ctx.lineTo(16, 16)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.strokeStyle = OUT
  for (const [x, y, r] of [[10, 13, 6], [22, 13, 6], [16, 8, 7], [16, 16, 6]]) blob(ctx, x, y, r, r, "#ffffff")
}
I.strawberry = (ctx) => {
  ctx.fillStyle = "#ff3b4e"
  ctx.beginPath()
  ctx.moveTo(16, 29)
  ctx.bezierCurveTo(4, 20, 5, 9, 16, 10)
  ctx.bezierCurveTo(27, 9, 28, 20, 16, 29)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#ffe08a"
  for (const [x, y] of [[12, 15], [17, 14], [21, 17], [14, 20], [19, 22], [16, 25]]) ctx.fillRect(x, y, 1.4, 1.8)
  ctx.fillStyle = "#4fae3c"
  for (const a of [-1, 0, 1]) blob(ctx, 16 + a * 4, 9, 3.5, 2, "#4fae3c", a * 0.6)
}
I.cowfeed = sack("#fff")
I.chickenfeed = sack("#ffd23f")
I.sheepfeed = sack("#9fd97a")
const decorateSack = (base, draw) => (ctx) => {
  base(ctx)
  draw(ctx)
}
I.cowfeed = decorateSack(I.cowfeed, (ctx) => {
  ctx.fillStyle = "#333"
  ctx.beginPath()
  ctx.ellipse(13, 18, 2, 1.6, 0, 0, Math.PI * 2)
  ctx.ellipse(19, 19, 1.6, 1.3, 0, 0, Math.PI * 2)
  ctx.fill()
})
I.milk = (ctx) => {
  ctx.fillStyle = "#ffffff"
  ctx.beginPath()
  ctx.moveTo(12, 9)
  ctx.lineTo(20, 9)
  ctx.lineTo(20, 12)
  ctx.quadraticCurveTo(25, 15, 24, 20)
  ctx.lineTo(24, 28)
  ctx.lineTo(8, 28)
  ctx.lineTo(8, 20)
  ctx.quadraticCurveTo(7, 15, 12, 12)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#3b82d6"
  ctx.fillRect(11, 4, 10, 5)
  ctx.strokeRect(11, 4, 10, 5)
  ctx.fillStyle = "#cfe6fa"
  ctx.fillRect(10, 19, 12, 6)
}
I.egg = (ctx) => {
  blob(ctx, 12, 19, 6, 8, "#fff3df", -0.2)
  blob(ctx, 21, 20, 6, 8, "#f3d2a8", 0.2)
  ctx.fillStyle = "rgba(255,255,255,0.7)"
  ctx.fillRect(9, 14, 2, 3)
}
I.wool = (ctx) => {
  blob(ctx, 16, 17, 11, 10, "#fbf6ea")
  ctx.strokeStyle = "rgba(150,130,100,0.6)"
  for (const r of [3, 6, 9]) {
    ctx.beginPath()
    ctx.arc(16, 17, r, 0.4, 4.6)
    ctx.stroke()
  }
}
I.cream = (ctx) => {
  ctx.fillStyle = "#fffaf0"
  roundRect(ctx, 8, 12, 16, 17, 3)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#ff8fb0"
  ctx.fillRect(7, 8, 18, 5)
  ctx.strokeRect(7, 8, 18, 5)
  ctx.fillStyle = "#9fd3f0"
  ctx.fillRect(10, 18, 12, 5)
}
I.butter = (ctx) => {
  blob(ctx, 16, 23, 13, 4, "#d9e4ec")
  ctx.fillStyle = "#ffe066"
  ctx.beginPath()
  ctx.moveTo(6, 21)
  ctx.lineTo(18, 24)
  ctx.lineTo(27, 19)
  ctx.lineTo(27, 12)
  ctx.lineTo(15, 9)
  ctx.lineTo(6, 14)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(6, 14)
  ctx.lineTo(18, 17)
  ctx.lineTo(27, 12)
  ctx.moveTo(18, 17)
  ctx.lineTo(18, 24)
  ctx.stroke()
}
I.cheese = (ctx) => {
  ctx.fillStyle = "#ffc93c"
  ctx.beginPath()
  ctx.moveTo(4, 22)
  ctx.lineTo(26, 27)
  ctx.lineTo(28, 14)
  ctx.lineTo(10, 7)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#e0a420"
  for (const [x, y, r] of [[12, 15, 2.4], [20, 19, 2], [16, 22, 1.6], [22, 13, 1.5]]) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
}
I.bread = (ctx) => {
  blob(ctx, 16, 18, 13, 8, "#d9893d")
  ctx.fillStyle = "#e9a95b"
  ctx.beginPath()
  ctx.ellipse(16, 16, 11, 5.5, 0, Math.PI, 0)
  ctx.fill()
  ctx.strokeStyle = "#a35d21"
  for (const x of [10, 16, 22]) {
    ctx.beginPath()
    ctx.moveTo(x - 2, 19)
    ctx.lineTo(x + 2, 13)
    ctx.stroke()
  }
}
I.cornbread = (ctx) => {
  ctx.fillStyle = "#f4c542"
  roundRect(ctx, 6, 10, 20, 16, 3)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#e0a42a"
  ctx.fillRect(6, 10, 20, 4)
  ctx.fillStyle = "rgba(160,100,10,0.4)"
  for (const [x, y] of [[10, 18], [15, 21], [20, 17], [22, 22], [12, 23]]) ctx.fillRect(x, y, 1.5, 1.5)
}
I.cookies = (ctx) => {
  for (const [x, y] of [[11, 19], [21, 14]]) {
    blob(ctx, x, y, 8, 8, "#d9a066")
    ctx.fillStyle = "#5a3418"
    for (const [dx, dy] of [[-3, -2], [2, -3], [0, 2], [3, 2], [-3, 3]]) ctx.fillRect(x + dx, y + dy, 2, 2)
  }
}
I.sugar = (ctx) => {
  for (const [x, y] of [[6, 16], [16, 16], [11, 7]]) {
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(x, y, 10, 10)
    ctx.strokeRect(x, y, 10, 10)
    ctx.fillStyle = "#e7eef5"
    ctx.fillRect(x + 6, y + 1, 3, 8)
  }
}
I.syrup = (ctx) => {
  ctx.fillStyle = "#c97a1e"
  ctx.beginPath()
  ctx.moveTo(13, 6)
  ctx.lineTo(19, 6)
  ctx.lineTo(19, 11)
  ctx.lineTo(24, 16)
  ctx.lineTo(24, 28)
  ctx.lineTo(8, 28)
  ctx.lineTo(8, 16)
  ctx.lineTo(13, 11)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#fff4d8"
  ctx.fillRect(10, 18, 12, 6)
  ctx.fillStyle = "rgba(255,255,255,0.4)"
  ctx.fillRect(10, 13, 2, 12)
}
I.fabric = (ctx) => {
  ctx.fillStyle = "#6fa8dc"
  roundRect(ctx, 5, 9, 22, 14, 4)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#4a86c0"
  ctx.fillRect(5, 13, 22, 3)
  ctx.fillStyle = "#9cc7ef"
  roundRect(ctx, 5, 19, 22, 8, 3)
  ctx.fill()
  ctx.stroke()
}
I.yarn = (ctx) => {
  blob(ctx, 16, 17, 11, 11, "#ff7fae")
  ctx.strokeStyle = "rgba(160,30,80,0.5)"
  for (const a of [-0.8, 0, 0.8]) {
    ctx.beginPath()
    ctx.ellipse(16, 17, 11, 4, a, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.strokeStyle = "#ff7fae"
  ctx.beginPath()
  ctx.moveTo(25, 23)
  ctx.quadraticCurveTo(30, 28, 24, 30)
  ctx.stroke()
}
I.sweater = (ctx) => {
  ctx.fillStyle = "#e5413b"
  ctx.beginPath()
  ctx.moveTo(11, 5)
  ctx.lineTo(21, 5)
  ctx.lineTo(29, 11)
  ctx.lineTo(26, 18)
  ctx.lineTo(23, 16)
  ctx.lineTo(23, 28)
  ctx.lineTo(9, 28)
  ctx.lineTo(9, 16)
  ctx.lineTo(6, 18)
  ctx.lineTo(3, 11)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#fff"
  for (let x = 11; x < 22; x += 4) ctx.fillRect(x, 15, 2, 2)
  ctx.fillRect(9, 24, 14, 2)
}
I.popcorn = (ctx) => {
  for (const [x, y] of [[11, 9], [16, 7], [21, 9], [13, 5], [19, 4]]) blob(ctx, x, y, 3.5, 3.2, "#fff8dc")
  ctx.fillStyle = "#fff"
  ctx.beginPath()
  ctx.moveTo(7, 11)
  ctx.lineTo(25, 11)
  ctx.lineTo(22, 29)
  ctx.lineTo(10, 29)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#e5413b"
  for (const x of [10, 15, 20]) {
    ctx.beginPath()
    ctx.moveTo(x - 1, 11)
    ctx.lineTo(x + 2, 11)
    ctx.lineTo(x + 1.3, 29)
    ctx.lineTo(x - 0.4, 29)
    ctx.fill()
  }
}
I.carrotcake = (ctx) => {
  ctx.fillStyle = "#c98a4a"
  ctx.beginPath()
  ctx.moveTo(4, 18)
  ctx.lineTo(24, 26)
  ctx.lineTo(28, 20)
  ctx.lineTo(10, 12)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#fff6e6"
  ctx.beginPath()
  ctx.moveTo(4, 18)
  ctx.lineTo(10, 12)
  ctx.lineTo(28, 20)
  ctx.lineTo(24, 21)
  ctx.lineTo(4, 14)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = "#ff8a2a"
  ctx.fillRect(14, 11, 4, 3)
  ctx.fillStyle = "#4fae3c"
  ctx.fillRect(16, 9, 2, 2)
}
I.jam = (ctx) => {
  ctx.fillStyle = "#d42a4a"
  roundRect(ctx, 7, 11, 18, 18, 4)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#fff"
  ctx.beginPath()
  ctx.moveTo(6, 11)
  ctx.lineTo(26, 11)
  ctx.lineTo(24, 5)
  ctx.lineTo(8, 5)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#e5413b"
  for (let x = 9; x < 24; x += 4) ctx.fillRect(x, 6, 2, 2)
  ctx.fillStyle = "#fff4d8"
  ctx.fillRect(10, 16, 12, 7)
}
I.icecream = (ctx) => {
  ctx.fillStyle = "#e3a35a"
  ctx.beginPath()
  ctx.moveTo(9, 15)
  ctx.lineTo(23, 15)
  ctx.lineTo(16, 30)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  blob(ctx, 12, 13, 5, 5, "#ffd1e3")
  blob(ctx, 20, 13, 5, 5, "#fff6e0")
  blob(ctx, 16, 8, 5.5, 5, "#ff7fae")
  ctx.fillStyle = "#e5413b"
  ctx.beginPath()
  ctx.arc(16, 3.5, 2, 0, Math.PI * 2)
  ctx.fill()
}
I.brick = (ctx) => {
  for (const [x, y] of [[4, 18], [16, 18], [10, 10]]) {
    ctx.fillStyle = "#c8553d"
    ctx.fillRect(x, y, 12, 8)
    ctx.strokeRect(x, y, 12, 8)
    ctx.fillStyle = "#a8432f"
    ctx.fillRect(x, y + 5, 12, 3)
  }
}
I.glass = (ctx) => {
  ctx.fillStyle = "#bfe8ff"
  ctx.beginPath()
  ctx.moveTo(6, 8)
  ctx.lineTo(24, 4)
  ctx.lineTo(26, 26)
  ctx.lineTo(8, 29)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(11, 12)
  ctx.lineTo(16, 9)
  ctx.moveTo(12, 17)
  ctx.lineTo(21, 11)
  ctx.stroke()
  ctx.lineWidth = 1
}
I.slab = (ctx) => {
  ctx.fillStyle = "#b9bcc2"
  ctx.beginPath()
  ctx.moveTo(4, 16)
  ctx.lineTo(16, 10)
  ctx.lineTo(28, 16)
  ctx.lineTo(16, 22)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#9a9ea6"
  ctx.beginPath()
  ctx.moveTo(4, 16)
  ctx.lineTo(16, 22)
  ctx.lineTo(16, 27)
  ctx.lineTo(4, 21)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#83878f"
  ctx.beginPath()
  ctx.moveTo(28, 16)
  ctx.lineTo(16, 22)
  ctx.lineTo(16, 27)
  ctx.lineTo(28, 21)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
}
I.hammer = (ctx) => {
  ctx.save()
  ctx.translate(16, 16)
  ctx.rotate(-0.7)
  ctx.fillStyle = "#b07843"
  ctx.fillRect(-2, -4, 4, 18)
  ctx.strokeRect(-2, -4, 4, 18)
  ctx.fillStyle = "#8d949c"
  ctx.fillRect(-9, -11, 18, 7)
  ctx.strokeRect(-9, -11, 18, 7)
  ctx.restore()
}
I.shovel = (ctx) => {
  ctx.save()
  ctx.translate(16, 16)
  ctx.rotate(0.6)
  ctx.fillStyle = "#b07843"
  ctx.fillRect(-1.6, -14, 3.2, 17)
  ctx.strokeRect(-1.6, -14, 3.2, 17)
  ctx.fillRect(-5, -15, 10, 3)
  ctx.fillStyle = "#9aa3ab"
  ctx.beginPath()
  ctx.moveTo(-6, 3)
  ctx.lineTo(6, 3)
  ctx.lineTo(5, 11)
  ctx.lineTo(0, 15)
  ctx.lineTo(-5, 11)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}
I.coin = (ctx) => {
  blob(ctx, 16, 16, 12, 12, "#f6c02c")
  blob(ctx, 16, 16, 8.5, 8.5, "#ffd95a")
  ctx.fillStyle = "#c98f0a"
  ctx.font = "bold 12px Arial, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText("$", 16, 16.5)
}
I.clover = (ctx) => {
  ctx.strokeStyle = "#2f7a2f"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(16, 16)
  ctx.quadraticCurveTo(18, 24, 22, 29)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.strokeStyle = OUT
  for (const [dx, dy] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
    ctx.save()
    ctx.translate(16 + dx, 15 + dy)
    ctx.rotate(Math.atan2(dy, dx) + Math.PI / 4)
    ctx.fillStyle = "#3fbf5a"
    ctx.beginPath()
    ctx.moveTo(0, 5)
    ctx.bezierCurveTo(-8, -1, -3, -8, 0, -3)
    ctx.bezierCurveTo(3, -8, 8, -1, 0, 5)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
}
I.xp = (ctx) => {
  ctx.fillStyle = "#4a90e2"
  ctx.beginPath()
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? 5.5 : 13
    const a = -Math.PI / 2 + (k * Math.PI) / 5
    ctx.lineTo(16 + Math.cos(a) * r, 17 + Math.sin(a) * r)
  }
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "rgba(255,255,255,0.45)"
  ctx.beginPath()
  ctx.arc(13, 13, 3, 0, Math.PI * 2)
  ctx.fill()
}
I.people = (ctx) => {
  blob(ctx, 11, 11, 4.5, 4.5, "#f2c79a")
  blob(ctx, 21, 11, 4.5, 4.5, "#c98d5c")
  ctx.fillStyle = "#4a90e2"
  ctx.beginPath()
  ctx.ellipse(11, 24, 7, 8, 0, Math.PI, 0)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#e5413b"
  ctx.beginPath()
  ctx.ellipse(21, 24, 7, 8, 0, Math.PI, 0)
  ctx.fill()
  ctx.stroke()
}
I.envelope = (ctx) => {
  ctx.fillStyle = "#fffaf0"
  ctx.fillRect(4, 8, 24, 16)
  ctx.strokeRect(4, 8, 24, 16)
  ctx.beginPath()
  ctx.moveTo(4, 8)
  ctx.lineTo(16, 18)
  ctx.lineTo(28, 8)
  ctx.stroke()
  ctx.fillStyle = "#e5413b"
  ctx.fillRect(22, 10, 4, 4)
}
I.book = (ctx) => {
  ctx.fillStyle = "#2f7a6a"
  ctx.fillRect(6, 6, 20, 22)
  ctx.strokeRect(6, 6, 20, 22)
  ctx.fillStyle = "#fffaf0"
  ctx.fillRect(9, 9, 14, 3)
  ctx.fillStyle = "#f2c230"
  ctx.fillRect(6, 6, 3, 22)
}
I.lock = (ctx) => {
  ctx.strokeStyle = "#6b6f75"
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(16, 13, 6, Math.PI, 0)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.strokeStyle = OUT
  ctx.fillStyle = "#f2c230"
  roundRect(ctx, 7, 13, 18, 14, 3)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#7a5a10"
  ctx.fillRect(15, 18, 2, 5)
}
I.check = (ctx) => {
  blob(ctx, 16, 16, 12, 12, "#4cc35a")
  ctx.strokeStyle = "#fff"
  ctx.lineWidth = 3.5
  ctx.beginPath()
  ctx.moveTo(10, 16)
  ctx.lineTo(14.5, 21)
  ctx.lineTo(22.5, 11)
  ctx.stroke()
  ctx.lineWidth = 1
}
I.clock = (ctx) => {
  blob(ctx, 16, 16, 12, 12, "#fffaf0")
  ctx.strokeStyle = "#333"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(16, 16)
  ctx.lineTo(16, 8)
  ctx.moveTo(16, 16)
  ctx.lineTo(21, 18)
  ctx.stroke()
  ctx.lineWidth = 1
}

// buttons along the bottom
I.shop = (ctx) => {
  ctx.fillStyle = "#f6e7c8"
  ctx.fillRect(6, 14, 20, 14)
  ctx.strokeRect(6, 14, 20, 14)
  ctx.fillStyle = "#8a5a35"
  ctx.fillRect(13, 19, 6, 9)
  for (let k = 0; k < 5; k++) {
    ctx.fillStyle = k % 2 ? "#fff" : "#e5413b"
    ctx.beginPath()
    ctx.moveTo(3 + k * 5.2, 8)
    ctx.lineTo(8.2 + k * 5.2, 8)
    ctx.lineTo(8.2 + k * 5.2, 13)
    ctx.arc(5.6 + k * 5.2, 13, 2.6, 0, Math.PI)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  ctx.fillStyle = "#4a8fd6"
  ctx.fillRect(3, 4, 26, 4)
  ctx.strokeRect(3, 4, 26, 4)
}
I.barn = (ctx) => {
  ctx.fillStyle = "#c8423a"
  ctx.beginPath()
  ctx.moveTo(4, 14)
  ctx.lineTo(16, 4)
  ctx.lineTo(28, 14)
  ctx.lineTo(28, 29)
  ctx.lineTo(4, 29)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#6b4b3a"
  ctx.beginPath()
  ctx.moveTo(2, 15)
  ctx.lineTo(16, 3)
  ctx.lineTo(30, 15)
  ctx.lineTo(28, 16)
  ctx.lineTo(16, 6)
  ctx.lineTo(4, 16)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = "#fff"
  ctx.lineWidth = 1.5
  ctx.strokeRect(10, 17, 12, 12)
  ctx.beginPath()
  ctx.moveTo(10, 17)
  ctx.lineTo(22, 29)
  ctx.moveTo(22, 17)
  ctx.lineTo(10, 29)
  ctx.stroke()
  ctx.lineWidth = 1
}
I.heli = (ctx) => {
  ctx.save()
  ctx.translate(15, 18)
  ctx.scale(0.62, 0.62)
  drawHelicopter(ctx, 4, 4, 1, 0.3, false)
  ctx.restore()
}
I.train = (ctx) => {
  ctx.fillStyle = "#2f7a4a"
  ctx.fillRect(4, 12, 24, 12)
  ctx.strokeRect(4, 12, 24, 12)
  ctx.fillRect(16, 5, 10, 8)
  ctx.strokeRect(16, 5, 10, 8)
  ctx.fillStyle = "#a8dcf7"
  ctx.fillRect(18, 7, 6, 4)
  ctx.fillStyle = "#24333a"
  ctx.fillRect(7, 6, 4, 6)
  ctx.fillStyle = "#e5413b"
  ctx.fillRect(4, 18, 24, 2)
  for (const x of [9, 16, 23]) blob(ctx, x, 26, 3, 3, "#2c2c2c")
}
I.move = (ctx) => {
  ctx.fillStyle = "#4a8fd6"
  ctx.beginPath()
  const arm = (a) => {
    ctx.save()
    ctx.translate(16, 16)
    ctx.rotate(a)
    ctx.moveTo(-3, -4)
    ctx.lineTo(-3, -9)
    ctx.lineTo(-7, -9)
    ctx.lineTo(0, -15)
    ctx.lineTo(7, -9)
    ctx.lineTo(3, -9)
    ctx.lineTo(3, -4)
    ctx.restore()
  }
  for (let k = 0; k < 4; k++) arm((k * Math.PI) / 2)
  ctx.fill()
  ctx.stroke()
  blob(ctx, 16, 16, 5, 5, "#4a8fd6")
}

// playing together
I.heart = (ctx) => heartAt(ctx, 16, 17, 11)
I.heartOutline = (ctx) => heartAt(ctx, 16, 17, 11, "#fffaf0")
I.gift = (ctx) => {
  ctx.fillStyle = "#ff8fb4"
  ctx.fillRect(6, 13, 20, 15)
  ctx.strokeRect(6, 13, 20, 15)
  ctx.fillStyle = "#ffb3cb"
  ctx.fillRect(4, 9, 24, 5)
  ctx.strokeRect(4, 9, 24, 5)
  ctx.fillStyle = "#f6c02c"
  ctx.fillRect(14, 9, 4, 19)
  ctx.strokeRect(14, 9, 4, 19)
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.ellipse(16 + s * 5, 6, 5, 3, s * 0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
}
I.friends = (ctx) => {
  blob(ctx, 11, 12, 4.5, 4.5, "#f2c79a")
  blob(ctx, 21, 12, 4.5, 4.5, "#e8b48a")
  ctx.fillStyle = "#6fb4ff"
  ctx.beginPath()
  ctx.ellipse(11, 25, 7, 8, 0, Math.PI, 0)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#ff8fb4"
  ctx.beginPath()
  ctx.ellipse(21, 25, 7, 8, 0, Math.PI, 0)
  ctx.fill()
  ctx.stroke()
  heartAt(ctx, 16, 6, 4.2, "#ff4f86")
}
I.note = (ctx) => {
  ctx.fillStyle = "#fffaf0"
  roundRect(ctx, 6, 5, 20, 22, 2)
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = "rgba(90,70,110,0.5)"
  for (const y of [12, 16, 20]) {
    ctx.beginPath()
    ctx.moveTo(10, y)
    ctx.lineTo(22, y)
    ctx.stroke()
  }
  heartAt(ctx, 16, 6, 3.5, "#ff4f86")
}
I.home = (ctx) => {
  ctx.fillStyle = "#f6e7c8"
  ctx.fillRect(8, 15, 16, 13)
  ctx.strokeRect(8, 15, 16, 13)
  ctx.fillStyle = "#e0614f"
  ctx.beginPath()
  ctx.moveTo(4, 16)
  ctx.lineTo(16, 5)
  ctx.lineTo(28, 16)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "#8a5a35"
  ctx.fillRect(14, 20, 5, 8)
}
I.help = (ctx) => {
  blob(ctx, 16, 16, 12, 12, "#ff9a3c")
  ctx.fillStyle = "#fff"
  ctx.font = "bold 18px Arial, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText("!", 16, 17)
}
I.mailbox = (ctx) => {
  ctx.fillStyle = "#8a5a35"
  ctx.fillRect(14, 18, 4, 12)
  ctx.fillStyle = "#5b8ee0"
  ctx.beginPath()
  ctx.moveTo(5, 19)
  ctx.lineTo(5, 12)
  ctx.quadraticCurveTo(5, 5, 13, 5)
  ctx.lineTo(19, 5)
  ctx.quadraticCurveTo(27, 5, 27, 12)
  ctx.lineTo(27, 19)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  heartAt(ctx, 13, 12, 3.5, "#ff7aa2", null)
  ctx.fillStyle = "#e5413b"
  ctx.fillRect(24, 2, 5, 4)
}

// draw an icon (any good, material, coin, clover, xp, people...) into a size x size box
export const drawIcon = (ctx, id, size = 32) => {
  const f = I[id]
  ctx.save()
  ctx.scale(size / 32, size / 32)
  ctx.lineWidth = 1
  ctx.strokeStyle = OUT
  if (f) f(ctx)
  else {
    ctx.fillStyle = "#ccc"
    ctx.fillRect(6, 6, 20, 20)
  }
  ctx.restore()
}
export const hasIcon = (id) => !!I[id]

// icons as image URLs for the HTML panels (made once)
const iconUrls = new Map()
export const iconUrl = (id, size = 48) => {
  const key = `${id}@${size}`
  if (iconUrls.has(key)) return iconUrls.get(key)
  if (typeof document === "undefined") return ""
  const c = document.createElement("canvas")
  c.width = c.height = size
  drawIcon(c.getContext("2d"), id, size)
  const url = c.toDataURL()
  iconUrls.set(key, url)
  return url
}

// a building (or field) drawn small for the shop
const thumbs = new Map()
export const thumbUrl = (type, size = 72) => {
  if (thumbs.has(type)) return thumbs.get(type)
  if (typeof document === "undefined") return ""
  const s = type === "field" ? makeSprite("thumb:field", 1, 30, (K) => drawField(K, "wheat", 4), 2) : B[type] ? makeSprite(`thumb:${type}`, B[type].n, B[type].up, B[type].draw, 2) : null
  if (!s) return ""
  const c = document.createElement("canvas")
  c.width = c.height = size
  const ctx = c.getContext("2d")
  const k = Math.min(size / s.w, size / s.h) * 0.98
  ctx.drawImage(s.canvas, (size - s.w * k) / 2, (size - s.h * k) / 2, s.w * k, s.h * k)
  if (B[type]?.front) {
    const f = makeSprite(`thumb:${type}:front`, B[type].n, 20, B[type].front, 2)
    ctx.drawImage(f.canvas, (size - s.w * k) / 2, (size - s.h * k) / 2 + (s.oy - f.oy) * k, f.w * k, f.h * k)
  }
  const url = c.toDataURL()
  thumbs.set(type, url)
  return url
}

