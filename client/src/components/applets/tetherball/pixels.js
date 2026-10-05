// Tetherball's pixel parts (pure; Node previews draw exactly this): the HUD drawn over the 3D
// court at the same low resolution (a rope meter, names, games, banners in a pixel font), the
// title screen's 2D attract loop, and the little pixel-art textures and billboards the PS1-
// style scene uses (asphalt, grass, the ball's panels, faces, trees, a slide, swings, a school,
// clouds). All art is original.
//
//   minSize(cssW, cssH) / layout(W, H)
//   drawHud(b, L, s)     s = { wraps (-1..1 of the way), turns, names, games, target, banner,
//                              big, hint, pressed, paused }
//   drawBanner(b, t)
//   TEXTURES             { name: { w, h, rgba: Uint8Array } } for three.js DataTextures

import {
  UI_COLORS,
  bevel,
  blit,
  createBitmap,
  createPalette,
  disc,
  drawText,
  drawTitle,
  ellipse,
  ellipseOutline,
  frame,
  gradientV,
  hline,
  line,
  paint,
  polygon,
  pset,
  rampAt,
  rect,
  textWidth,
  threshold,
  titleWidth,
  uiColors,
  vline,
  wrapText,
} from "../../../utils/retro/index.js"

export const pal = createPalette(UI_COLORS)
const P = (n) => pal.idx(n)
const C = {
  black: P("black"),
  white: P("white"),
  red: pal.ramp("red", ["#580808", "#a01414", "#e02c24", "#ff6c58"]),
  blue: pal.ramp("blue", ["#081858", "#1430a0", "#2c58e0", "#6c94ff"]),
  tip: pal.add("tip", "#ffffe1"),
  ball: pal.ramp("ball", ["#6c4c00", "#b48800", "#f0c400", "#ffe848", "#fffcb0"]),
  sky: pal.ramp("sky", ["#2c64c8", "#4c88e4", "#78acf4", "#a8d0fc", "#d8ecff"]),
  grass: pal.ramp("grs", ["#1c4c14", "#2c6c1c", "#448c28", "#64ac38", "#8cc850"]),
  asphalt: pal.ramp("asp", ["#3c3c44", "#56565e", "#707078", "#8c8c94"]),
  pole: pal.ramp("pole", ["#6c747c", "#9ca4ac", "#d0d4d8", "#f4f4f4"]),
  rope: pal.add("rope", "#f0e8d0"),
  rope2: pal.add("rope2", "#b4a888"),
  gold: P("gold"),
}
const UI = uiColors(pal)

// ---------------------------------------------------------------- layout
export const minSize = (cssW, cssH) => (cssW > cssH * 1.15 ? { minW: 300, minH: 176 } : { minW: 160, minH: 240 })

export const layout = (W, H) => {
  const top = { x: 0, y: 0, w: W, h: 20 }
  const pause = { x: W - 18, y: 23, w: 15, h: 14 }
  return { W, H, top, pause, meter: { x: 40, y: 3, w: Math.max(40, W - 80), h: 14 } }
}

// ---------------------------------------------------------------- the HUD
const dots = (b, x, y, won, target, ramp, alignRight) => {
  for (let k = 0; k < target; k++) {
    const dx = alignRight ? x - k * 7 - 5 : x + k * 7
    disc(b, dx + 2.5, y + 2.5, 2.6, C.black)
    if (k < won) disc(b, dx + 2.5, y + 2.5, 1.8, ramp[2])
    else disc(b, dx + 2.5, y + 2.5, 1.5, C.asphalt[1])
  }
}

export const drawHud = (b, L, s) => {
  b.data.fill(0)
  const { W } = L
  // the top bar: a 98 strip with the names, the games and the rope meter
  bevel(b, 0, 0, W, L.top.h, UI)
  const short = W < 230
  const nm = (n, d) => {
    const t = (n || d).toUpperCase()
    return t.slice(0, short ? 5 : 8)
  }
  drawText(b, nm(s.names?.[0], "YOU"), 3, 2, C.red[1])
  drawText(b, nm(s.names?.[1], "CPU"), W - 3, 2, C.blue[1], { align: "right" })
  dots(b, 3, 11, s.games?.[0] || 0, s.target || 2, C.red, false)
  dots(b, W - 3, 11, s.games?.[1] || 0, s.target || 2, C.blue, true)
  const mw = Math.max(40, W - (short ? 70 : 104))
  const mx = Math.round((W - mw) / 2)
  const m = { x: mx, y: 3, w: mw, h: 14 }
  // the meter: a sunken well, red filling right (your way), blue filling left
  rect(b, m.x, m.y, m.w, m.h, C.black)
  rect(b, m.x + 1, m.y + 1, m.w - 2, m.h - 2, C.asphalt[0])
  const mid = m.x + Math.floor(m.w / 2)
  const f = Math.max(-1, Math.min(1, s.wraps || 0))
  const len = Math.round(Math.abs(f) * (m.w / 2 - 2))
  if (f > 0) for (let k = 0; k < len; k += 3) rect(b, mid + 1 + k, m.y + 2, 2, m.h - 4, f > 0.75 ? C.red[3] : C.red[2])
  if (f < 0) for (let k = 0; k < len; k += 3) rect(b, mid - 2 - k, m.y + 2, 2, m.h - 4, f < -0.75 ? C.blue[3] : C.blue[2])
  vline(b, mid, m.y, m.h, C.white)
  const turns = `${Math.abs(s.turns || 0).toFixed(1)}`
  drawText(b, turns, mid + (f >= 0 ? -3 : 4), m.y + 4, C.white, { align: f >= 0 ? "right" : "left", outline: C.black })
  // pause
  if (!s.noPause) {
    bevel(b, L.pause.x, L.pause.y, L.pause.w, L.pause.h, UI, { pressed: s.pressed === "pause" })
    const o = s.pressed === "pause" ? 1 : 0
    rect(b, L.pause.x + 4 + o, L.pause.y + 3 + o, 2, 7, C.black)
    rect(b, L.pause.x + 8 + o, L.pause.y + 3 + o, 2, 7, C.black)
  }
  // a tooltip-yellow banner under the bar
  if (s.banner) {
    const lines = wrapText(s.banner, W - 30)
    const bw = Math.max(...lines.map((l) => textWidth(l))) + 8
    const bx = Math.round((W - bw) / 2)
    rect(b, bx, 24, bw, lines.length * 9 + 4, C.black)
    rect(b, bx + 1, 25, bw - 2, lines.length * 9 + 2, C.tip)
    lines.forEach((l, i) => drawText(b, l, W / 2, 26 + i * 9, C.black, { align: "center" }))
  }
  // a big win/lose message in the middle
  if (s.big) {
    const lines = wrapText(s.big.toUpperCase(), (W - 16) / 2)
    const y0 = Math.round(L.H * 0.36)
    lines.forEach((l, i) => drawTitle(b, l, W / 2, y0 + i * 18, { scale: 2, ramp: s.bigWin ? C.ball.slice(1) : C.blue.slice(1), outline: C.black, shadow: C.black, depth: 2, align: "center" }))
  }
  // a hint along the bottom, on a screen-door dark strip
  if (s.hint) {
    const lines = wrapText(s.hint, W - 10)
    const h = lines.length * 9 + 4
    const y = L.H - h - 2
    paint(b, 0, y, W, h, (x, yy) => ((x + yy) % 2 ? C.black : -1))
    lines.forEach((l, i) => drawText(b, l, W / 2, y + 2 + i * 9, C.white, { align: "center", outline: C.black }))
  }
}

// ---------------------------------------------------------------- the title banner (2D)
export const drawBanner = (b, t, { reduced = false } = {}) => {
  const W = b.w
  const H = b.h
  const horizon = Math.round(H * 0.55)
  gradientV(b, 0, 0, W, horizon, C.sky, { from: 0.1, to: 1 })
  gradientV(b, 0, horizon, W, H - horizon, C.grass, { from: 0.8, to: 0.3 })
  // the court: an ellipse of asphalt, a white edge
  const cx = Math.round(W * 0.27)
  const cy = Math.round(H * 0.82)
  ellipse(b, cx, cy, 44, 11, C.white)
  ellipse(b, cx, cy, 42, 10, C.asphalt[2])
  hline(b, cx - 42, cy, 84, C.white)
  // the pole
  const top = 12
  rect(b, cx - 1, top, 3, cy - top, C.pole[2])
  vline(b, cx - 1, top, cy - top, C.pole[3])
  vline(b, cx + 1, top, cy - top, C.pole[0])
  // the ball swings round on its rope (in front of the pole half the time)
  const a = reduced ? 0.6 : t * 3.2
  const bx = cx + Math.cos(a) * 32
  const by = top + 30 + Math.sin(a) * 6
  const front = Math.sin(a) > 0
  const drawBall = () => {
    line(b, cx, top + 6, bx, by, C.rope)
    disc(b, bx, by, 5.5, C.black)
    paint(b, bx - 6, by - 6, 13, 13, (x, y) => {
      const d = Math.hypot(x + 0.5 - bx, y + 0.5 - by)
      if (d > 4.6) return -1
      return rampAt(C.ball, 0.95 - (x - bx + y - by) / 10 - d / 9, x, y)
    })
  }
  if (!front) drawBall()
  rect(b, cx - 1, top, 3, 8, C.pole[2])
  if (front) drawBall()
  // two kids, one each side
  for (const [kx, col] of [[cx - 34, C.red], [cx + 30, C.blue]]) {
    const ky = cy - 3
    rect(b, kx - 2, ky - 4, 2, 5, C.asphalt[0])
    rect(b, kx + 1, ky - 4, 2, 5, C.asphalt[0])
    rect(b, kx - 3, ky - 13, 7, 9, col[2])
    rect(b, kx - 2, ky - 19, 5, 6, P("light"))
    rect(b, kx - 2, ky - 19, 5, 2, C.red[0])
  }
  // the logo, in the space right of the court; the tagline along the bottom
  const x0 = cx + 46
  const lx = Math.round((x0 + W) / 2)
  let scale = 3
  while (scale > 1 && titleWidth("TETHER", { scale }) > W - x0 - 6) scale--
  drawTitle(b, "TETHER", lx, 6, { scale, ramp: C.ball.slice(1), outline: C.black, shadow: C.red[0], depth: 2, align: "center" })
  drawTitle(b, "BALL", lx, 6 + 8 * scale + 2, { scale, ramp: C.ball.slice(1), outline: C.black, shadow: C.red[0], depth: 2, align: "center" })
  if (H >= 70) drawText(b, "WIND IT ALL THE WAY ROUND!", textWidth("WIND IT ALL THE WAY ROUND!") <= W - x0 ? lx : W / 2, H - 10, C.white, { align: "center", outline: C.black })
}

// ---------------------------------------------------------------- textures for the 3D scene
// each is drawn in palette indices with the kit, then turned into RGBA (index 0 = see-through)
const tex = (w, h, draw) => {
  const b = createBitmap(w, h)
  draw(b)
  const rgba = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const c = b.data[i]
    // three.js DataTextures start at the bottom row
    const y = Math.floor(i / w)
    const x = i % w
    const o = ((h - 1 - y) * w + x) * 4
    if (!c) continue
    const [r, g, bl] = pal.rgb[c]
    rgba[o] = r
    rgba[o + 1] = g
    rgba[o + 2] = bl
    rgba[o + 3] = 255
  }
  return { w, h, rgba }
}
const noise = (x, y) => (((x * 374761393 + y * 668265263) ^ (x * 2246822519)) >>> 0) % 1000 / 1000
const K = {
  bark: pal.ramp("bark", ["#3c2410", "#5c3818", "#7c5024"]),
  leaf: pal.ramp("leaf", ["#123c10", "#1e5a18", "#2e7c22", "#46a032", "#6cc048"]),
  slide: pal.ramp("sld", ["#a01c10", "#d8341c", "#ff6040"]),
  metal: pal.ramp("mtl", ["#4c545c", "#7c848c", "#b4bcc4"]),
  brick: pal.ramp("brk", ["#6c2418", "#94341c", "#b44c2c"]),
  roof: pal.ramp("roof", ["#2c2c34", "#44444e"]),
  win: pal.ramp("win", ["#2c4c7c", "#5c8cc4", "#bcdcff"]),
  cloud: pal.ramp("cld", ["#c8d8ec", "#e8f0fc", "#ffffff"]),
  skin: pal.ramp("skin", ["#b47c54", "#e0a878", "#f4c89c"]),
  hair: pal.ramp("hair", ["#2c1808", "#4c2c10"]),
  eye: pal.add("eye", "#101018"),
  mouth: pal.add("mouth", "#8c3c2c"),
}

export const TEXTURES = {
  asphalt: tex(32, 32, (b) =>
    paint(b, 0, 0, 32, 32, (x, y) => {
      const v = noise(x, y)
      if (v < 0.08) return C.asphalt[0]
      if (v > 0.93) return C.asphalt[3]
      return rampAt(C.asphalt.slice(1, 3), 0.5, x, y)
    }),
  ),
  grass: tex(16, 16, (b) =>
    paint(b, 0, 0, 16, 16, (x, y) => {
      const v = noise(x + 7, y)
      if (v < 0.12) return C.grass[1]
      if (v > 0.9) return C.grass[4]
      return rampAt(C.grass.slice(2, 4), 0.45, x, y)
    }),
  ),
  // the ball: yellow panels with a red band round the middle (shows it spinning)
  ball: tex(16, 8, (b) => {
    paint(b, 0, 0, 16, 8, (x, y) => (y === 3 || y === 4 ? C.red[2] : rampAt(C.ball.slice(1, 4), 0.5 + ((x >> 2) % 2) * 0.3, x, y)))
    for (let x = 0; x < 16; x += 4) vline(b, x, 0, 8, C.ball[0])
  }),
  // a face for the front of a blocky head
  face: tex(8, 8, (b) => {
    rect(b, 0, 0, 8, 8, K.skin[1])
    rect(b, 0, 0, 8, 2, K.hair[1])
    pset(b, 0, 2, K.hair[1])
    pset(b, 7, 2, K.hair[1])
    rect(b, 2, 3, 1, 2, K.eye)
    rect(b, 5, 3, 1, 2, K.eye)
    hline(b, 3, 6, 2, K.mouth)
  }),
  hair: tex(8, 8, (b) => {
    rect(b, 0, 0, 8, 8, K.hair[1])
    for (let k = 0; k < 8; k++) pset(b, k, (k * 3) % 8, K.hair[0])
  }),
  skin: tex(4, 4, (b) => rect(b, 0, 0, 4, 4, K.skin[1])),
  // billboards: a round tree, a slide, a swing set, a school, a cloud
  tree: tex(24, 32, (b) => {
    rect(b, 10, 18, 4, 14, K.bark[1])
    vline(b, 10, 18, 14, K.bark[2])
    vline(b, 13, 18, 14, K.bark[0])
    paint(b, 0, 0, 24, 24, (x, y) => {
      const blobs = [[12, 10, 10], [6, 14, 6], [18, 14, 6], [12, 5, 6]]
      let best = -1
      for (const [bx, by, r] of blobs) best = Math.max(best, 1 - Math.hypot(x + 0.5 - bx, y + 0.5 - by) / r)
      if (best <= 0) return -1
      return rampAt(K.leaf, 0.3 + best * 0.5 - y / 60 + (x < 12 ? 0.1 : 0), x, y)
    })
  }),
  slide: tex(32, 24, (b) => {
    // ladder on the left, platform, red slide down to the right
    for (const x of [3, 9]) vline(b, x, 4, 20, K.metal[1])
    for (let y = 6; y < 24; y += 4) hline(b, 3, y, 7, K.metal[2])
    rect(b, 2, 3, 10, 2, K.metal[0])
    polygon(b, [[11, 3], [14, 3], [31, 21], [31, 24], [27, 24]], K.slide[1])
    line(b, 12, 3, 30, 21, K.slide[2])
    vline(b, 30, 18, 6, K.metal[1])
  }),
  swings: tex(32, 24, (b) => {
    line(b, 2, 23, 7, 1, K.metal[1])
    line(b, 12, 23, 7, 1, K.metal[1])
    line(b, 20, 23, 25, 1, K.metal[1])
    line(b, 30, 23, 25, 1, K.metal[1])
    hline(b, 7, 1, 19, K.metal[2])
    hline(b, 7, 2, 19, K.metal[0])
    for (const sx of [11, 20]) {
      vline(b, sx, 2, 13, K.metal[2])
      vline(b, sx + 3, 2, 13, K.metal[2])
      rect(b, sx - 1, 15, 6, 2, K.slide[1])
    }
  }),
  school: tex(64, 32, (b) => {
    rect(b, 0, 8, 64, 24, K.brick[1])
    for (let y = 10; y < 32; y += 3) hline(b, 0, y, 64, K.brick[0])
    polygon(b, [[-2, 9], [32, 0], [66, 9]], K.roof[1])
    hline(b, 0, 8, 64, K.roof[0])
    for (let k = 0; k < 6; k++) {
      const wx = 4 + k * 10
      rect(b, wx, 13, 6, 6, K.win[0])
      rect(b, wx + 1, 14, 4, 4, K.win[1])
      pset(b, wx + 1, 14, K.win[2])
    }
    rect(b, 28, 22, 8, 10, K.roof[0])
    rect(b, 29, 23, 6, 9, K.bark[1])
    rect(b, 13, 1, 38, 9, K.roof[0])
    rect(b, 14, 2, 36, 7, C.white)
    drawText(b, "SCHOOL", 32, 1, K.roof[0], { align: "center" })
  }),
  cloud: tex(32, 12, (b) =>
    paint(b, 0, 0, 32, 12, (x, y) => {
      const blobs = [[9, 7, 6], [17, 5, 7], [25, 7, 5]]
      let best = -1
      for (const [bx, by, r] of blobs) best = Math.max(best, 1 - Math.hypot(x + 0.5 - bx, (y + 0.5 - by) * 1.3) / r)
      if (best <= 0 || y > 10) return -1
      return rampAt(K.cloud, 0.4 + best * 0.6 - y / 30, x, y)
    }),
  ),
}
