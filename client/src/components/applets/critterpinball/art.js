// Critter Catch Pinball's artwork, in the same mid-90s pixel style as Blue Screen (280 x
// 500 pixels, half a table unit per pixel, the palette and drawing helpers from
// ../pinball/): a grassy Ember table with mushroom bumpers and a volcano ramp, a watery
// Tide table with shell bumpers and a waterfall ramp, and a base layer for each bonus
// stage. buildArt(T) paints what never moves once; render.js stamps the rest each frame.

import { C, FONTS, bayer, bevel, capture, disc, frame, inPoly, line, pset, rampAt, rect, ring, segDist, shape, surface, text } from "../pinball/pixel.js"
import { METAL, RUBBER, capsule, paintLamp, post, windowDecal } from "../pinball/art.js"
import { BONUS_DOME, DOME, GUIDES, HEIGHT, INLANES, LANE, LANE_BOTTOM, LANE_GUIDES, LANE_TOP, MID, MOLE_HOLES, OUTLANES, ROLLOVERS, SEPARATORS, SLINGS, WIDTH, bankTargets } from "./layout.js"
import { buildSprite } from "./sprites.js"

export const K = 0.5
export const W = Math.round(WIDTH * K)
export const H = Math.round(HEIGHT * K)
const p = (u) => u * K
const UP = -Math.PI / 2

export const THEMES = {
  ember: {
    name: "EMBER",
    cabinet: [C.ink, C.brn0, C.brn1, C.g1],
    floor: [C.green0, C.green1, C.olive, C.moss],
    dots: [C.yellow, C.pink, C.white],
    sling: [C.red1, C.red, C.red3],
    plastic: [C.orange, C.amber],
    plasticGlint: C.cream,
    sign: "VOLCANO",
    signBar: C.red1,
    lamp: "orange",
    text: C.cream,
    textOutline: C.green0,
    bumperSkirt: [C.red0, C.red1, C.red],
    bumperSkirtLit: [C.red, C.red3, C.yellow],
    bumperCap: [C.red1, C.red, C.red3, C.pink],
    bumperCapLit: [C.red, C.red3, C.pink, C.white],
    key: [C.cream, C.amber],
  },
  tide: {
    name: "TIDE",
    cabinet: [C.ink, C.navy0, C.navy1, C.teal0],
    floor: [C.navy0, C.navy1, C.teal1, C.teal2, C.teal],
    dots: [C.cyan2, C.white, C.sky2],
    sling: [C.mag1, C.mag, C.pinkhi],
    plastic: [C.sky, C.sky2],
    plasticGlint: C.ice,
    sign: "WATERFALL",
    signBar: C.navy,
    lamp: "cyan",
    text: C.ice,
    textOutline: C.navy0,
    bumperSkirt: [C.mag0, C.mag1, C.mag],
    bumperSkirtLit: [C.mag, C.pinkhi, C.white],
    bumperCap: [C.red, C.pink, C.peach, C.white],
    bumperCapLit: [C.pink, C.peach, C.white, C.white],
    key: [C.ice, C.sky2],
  },
}

// the screen in the middle of the table, where critters show (px)
export const screenRect = (T) => {
  const cx = Math.round(p(T.critter.x))
  const cy = Math.round(p(T.critter.y))
  return { x: cx - 35, y: cy - 29, w: 70, h: 58, cx, cy }
}

// The lamps of a table (positions from its layout)
export const lampsFor = (T) => {
  const th = THEMES[T.id]
  const den = T.den
  const cave = T.cave
  const L = []
  ROLLOVERS.forEach((r, i) => L.push({ id: "lane" + i, kind: "circle", x: p(r.x), y: p(r.y) + 1, r: 7, color: "yellow", letter: "UP!"[i] }))
  "CATCH".split("").forEach((ch, i) => L.push({ id: "letter" + i, kind: "rect", x: p(MID) + (i - 2) * 13, y: p(585), w: 11, h: 9, color: th.lamp, label: ch }))
  bankTargets(T.bank).forEach((t, i) => L.push({ id: "target" + i, kind: "circle", x: p(t.x), y: p(t.y) + 9, r: 2.5, color: "green" }))
  L.push({ id: "evoArrow", kind: "arrow", x: p((T.bank.x0 + T.bank.x1) / 2), y: p(Math.max(T.bank.y0, T.bank.y1)) + 18, a: UP, w: 10, h: 8, color: "green" })
  // the Den: what sinking it does now
  L.push({ id: "denArrow", kind: "arrow", x: p(den.x), y: p(den.y) + 22, a: UP, w: 11, h: 9, color: "red" })
  L.push({ id: "denCatch", kind: "rect", x: p(den.x), y: p(den.y) + 34, w: 26, h: 6, color: "red", label: "CATCH" })
  L.push({ id: "denEvo", kind: "rect", x: p(den.x), y: p(den.y) + 41, w: 30, h: 6, color: "green", label: "EVOLVE" })
  // the Cave
  L.push({ id: "caveMap", kind: "rect", x: p(cave.x), y: p(cave.y) + 19, w: 18, h: 6, color: "blue", label: "MAP" })
  L.push({ id: "caveBonus", kind: "rect", x: p(cave.x), y: p(cave.y) + 26, w: 26, h: 6, color: "mag", label: "BONUS" })
  L.push({ id: "caveArrow", kind: "arrow", x: p(cave.x), y: p(cave.y) + 37, a: UP, w: 11, h: 9, color: "blue" })
  // shots
  L.push({ id: "rampArrow", kind: "arrow", x: p(T.ramp.mouth.x), y: p(T.ramp.mouth.y) + 14, a: UP, w: 14, h: 12, color: "cyan" })
  L.push({ id: "orbitL", kind: "arrow", x: p(46), y: p(T.mirrored ? 530 : 560), a: -1.75, w: 12, h: 10, color: "green" })
  L.push({ id: "orbitR", kind: "arrow", x: p(480), y: p(T.mirrored ? 560 : 500), a: -1.45, w: 12, h: 10, color: "green" })
  // Sparkit's charge, next to the spinner
  const sx = p((T.spinner.ax + T.spinner.bx) / 2)
  for (let i = 0; i < 4; i++) L.push({ id: "charge" + i, kind: "circle", x: sx - 6 + i * 4, y: p(T.spinner.ay) + 12, r: 1.6, color: "yellow" })
  // ball upgrade level
  ;["1X", "2X", "3X", "5X"].forEach((t, i) => L.push({ id: "level" + i, kind: "circle", x: p(MID) + (i - 1.5) * 14, y: p(745), r: 5, color: "yellow", letter: t }))
  L.push({ id: "save", kind: "rect", x: p(MID), y: p(845), w: 20, h: 6, color: "cyan", label: "SAVE" })
  L.push({ id: "extra", kind: "rect", x: p(MID), y: p(812), w: 24, h: 6, color: "red", label: "EXTRA" })
  INLANES.forEach((l, i) => L.push({ id: "inlane" + i, kind: "arrow", x: p(l.x), y: p(l.y) + 10, a: Math.PI / 2, w: 9, h: 8, color: "cyan" }))
  OUTLANES.forEach((l, i) => L.push({ id: "outlane" + i, kind: "circle", x: p(l.x), y: p(l.y) + 16, r: 3, color: "red" }))
  return L
}

// ---- base layers ----
const inDome = (ux, uy, dome) => uy >= dome.cy || Math.hypot(ux - dome.cx, uy - dome.cy) <= dome.r
const inPlayfield = (x, y) => {
  const ux = x / K
  const uy = y / K
  if (ux < 20 || ux > LANE.right) return false
  return inDome(ux, uy, DOME)
}
const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const paintCabinet = (s, th) => {
  shape(s, 0, 0, W - 1, H - 1, (x, y) => rampAt(th.cabinet, 0.25 + 0.2 * Math.sin(y * 0.05 + x * 0.02) + 0.15 * ((x * 7 + y * 3) % 5 === 0 ? 1 : 0), x, y))
  for (let y = 30; y < H; y += 60) {
    post(s, 3, y, 2, METAL)
    post(s, W - 4, y, 2, METAL)
  }
}

const paintFloor = (s, T, th, inside = inPlayfield) => {
  shape(s, 0, 0, W - 1, H - 1, (x, y) => {
    const px = x + 0.5
    const py = y + 0.5
    if (!inside(px, py)) return 0
    if (px / K > LANE.left && inside === inPlayfield) return rampAt([C.ink, C.g1, C.g2], 0.4 + 0.3 * (y / H), x, y)
    const cx = (px - 131) / 140
    const cy = (py - 200) / 330
    let t = 0.85 - 0.55 * Math.hypot(cx, cy)
    if (T.id === "tide") {
      // ripples, and sand toward the flippers
      if ((y + Math.round(Math.sin(x * 0.12 + y * 0.02) * 3)) % 11 === 0) t += 0.25
      if (py > 360) return rampAt([C.sand0, C.sand, C.sand3], 0.35 + 0.4 * ((py - 360) / 140) + (hash(x, y) - 0.5) * 0.25, x, y)
    } else if (hash(x >> 1, y >> 1) > 0.93) t += 0.2 // grass tufts
    return rampAt(th.floor, t, x, y)
  })
  // little flowers / bubbles
  for (let i = 0; i < 140; i++) {
    const x = Math.floor(hash(i, 7) * W)
    const y = Math.floor(hash(i, 13) * H)
    if (!inside(x, y) || x / K > LANE.left - 8) continue
    pset(s, x, y, th.dots[i % th.dots.length])
  }
}

const paintWalls = (s, T) => {
  const R = p(DOME.r)
  const dcx = p(DOME.cx)
  const dcy = p(DOME.cy)
  shape(s, 0, 0, W - 1, dcy + 1, (x, y) => {
    const px = x + 0.5
    const py = y + 0.5
    if (py > dcy) return 0
    const d = Math.hypot(px - dcx, py - dcy)
    if (d < R || d > R + 5) return 0
    if (d < R + 1 || d > R + 4) return C.ink
    const ny = (py - dcy) / d
    return rampAt(METAL, 0.4 - ny * 0.5 + (d - R) * 0.05, x, y)
  })
  capsule(s, p(20) - 2.5, p(DOME.cy), p(20) - 2.5, H + 4, 3)
  capsule(s, p(LANE.right) + 2.5, p(DOME.cy), p(LANE.right) + 2.5, H + 4, 3)
  capsule(s, p(LANE.left), p(LANE.top), p(LANE.left), H + 4, 2)
  const wire = (ax, ay, bx, by) => {
    line(s, p(ax), p(ay), p(bx), p(by), C.g7)
    line(s, p(ax), p(ay) + 1, p(bx), p(by) + 1, C.g2)
  }
  wire(LANE.right - 2, 296, LANE.left, LANE.top)
  for (const g of T.orbitGates) wire(...g.a)
  for (const o of [T.orbitL, T.orbitR]) {
    capsule(s, p(o.x), p(o.y0), p(o.x), p(o.y1), 2.5)
    if (o.flare) capsule(s, p(o.x), p(o.y1), p(o.flare[0]), p(o.flare[1]), 2.5)
  }
  for (const x of LANE_GUIDES) capsule(s, p(x), p(LANE_TOP), p(x), p(LANE_BOTTOM), 2.5, RUBBER)
  const b = T.bank
  line(s, p(b.x0), p(b.y0) + 2, p(b.x1), p(b.y1) + 2, C.ink)
  post(s, p(b.x0 - 3), p(b.y0), 3)
  post(s, p(b.x1 + 3), p(b.y1), 3)
}

const paintLower = (s, th) => {
  SLINGS.forEach((sl) => {
    const pts = sl.map(([x, y]) => [p(x), p(y)])
    const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3
    shape(s, Math.min(...pts.map((q) => q[0])) - 1, pts[0][1] - 1, Math.max(...pts.map((q) => q[0])) + 1, pts[2][1] + 1, (x, y) => (inPoly(pts, x + 0.5, y + 0.5) ? rampAt(th.sling, 0.3 + (0.3 * Math.abs(x - cx)) / 14 + 0.2 * Math.sin(y * 0.4), x, y) : 0))
    for (let i = 0; i < 3; i++) {
      const [ax, ay] = pts[i]
      const [bx, by] = pts[(i + 1) % 3]
      capsule(s, ax, ay, bx, by, 2.5, RUBBER)
    }
  })
  SEPARATORS.forEach((sp) => capsule(s, p(sp.x), p(sp.y0), p(sp.x), p(sp.y1), 2))
  GUIDES.forEach(([ax, ay, bx, by]) => capsule(s, p(ax), p(ay), p(bx), p(by), 2))
}

// a hole in the floor with a rim: the Den (a burrow) and the Cave (a rocky arch)
const paintHole = (s, spot, kind) => {
  const x = p(spot.x)
  const y = p(spot.y)
  if (kind === "cave") {
    shape(s, x - 11, y - 11, x + 11, y + 8, (px, py) => {
      const d = Math.hypot(px + 0.5 - x, py + 0.5 - y)
      if (d > 10.5 || d < 6.5 || py + 0.5 > y + 6) return 0
      return rampAt([C.g2, C.g3, C.g5, C.g6], 0.7 - (py - y + 10) / 22 + (hash(px, py) - 0.5) * 0.4, px, py)
    })
  } else {
    disc(s, x, y + 1, 9.5, C.brn0)
    ring(s, x, y + 1, 9.5, C.brn, 2)
  }
  disc(s, x, y, 6.5, C.ink)
  disc(s, x - 0.5, y - 0.5, 5, C.g1)
}

const paintDecals = (s, T, th) => {
  // the screen: a 98 window with a handheld LCD in it
  const sc = screenRect(T)
  windowDecal(s, sc.x - 4, sc.y - 14, sc.w + 8, sc.h + 18, "CRITTERS")
  rect(s, sc.x - 1, sc.y - 1, sc.w + 2, sc.h + 2, C.ink)
  rect(s, sc.x, sc.y, sc.w, sc.h, C.gb3)
  paintHole(s, T.den, "den")
  paintHole(s, T.cave, "cave")
  text(s, "DEN", p(T.den.x) + 0.5, p(T.den.y) - 16, th.text, { font: FONTS.small, align: "center", outline: th.textOutline })
  text(s, "CAVE", p(T.cave.x) + 0.5, p(T.cave.y) + 9, th.text, { font: FONTS.small, align: "center", outline: th.textOutline })
  // the table's name
  text(s, th.name, p(MID) + 0.5, p(640), C.white, { align: "center", outline: th.textOutline, scale: 2 })
  text(s, "UPGRADE", p(MID), p(62), th.text, { font: FONTS.small, align: "center", outline: th.textOutline })
  text(s, "BALL", p(MID) - 36, p(745) - 2, th.text, { font: FONTS.small, align: "right", outline: th.textOutline })
  for (let i = 0; i < 6; i++) text(s, "LAUNCH"[i], p((LANE.left + LANE.right) / 2) + 0.5, p(600) + i * 7, C.g3, { font: FONTS.small, align: "center" })
}

// The apron at the foot of the table: a 98 taskbar (the tray shows the ball)
export const APRON = { y: 466, gapX0: 108, gapX1: 154 }
const paintApron = (s) => {
  const y = APRON.y
  for (const [x0, x1] of [
    [8, APRON.gapX0],
    [APRON.gapX1, Math.round(p(LANE.left)) - 1],
  ]) {
    rect(s, x0, y, x1 - x0, H - y, C.g6)
    rect(s, x0, y, x1 - x0, 1, C.g7)
    rect(s, x0, y + 1, x1 - x0, 1, C.white)
    frame(s, x0, y, x1 - x0, H - y + 1, C.ink)
  }
  bevel(s, 12, y + 5, 40, 14, true)
  text(s, "START", 22, y + 9, C.ink, { font: FONTS.small })
  rect(s, 15, y + 9, 5, 5, C.green)
  rect(s, 16, y + 10, 1, 1, C.yellow)
  bevel(s, APRON.gapX1 + 40, y + 5, 54, 14, false)
  for (let i = 0; i < 6; i++) {
    rect(s, APRON.gapX0 - 6 + i, y - 6 + i, 1, 6 - i, C.g4)
    rect(s, APRON.gapX1 + 5 - i, y - 6 + i, 1, 6 - i, C.g4)
  }
}

const rampCenter = (R) => {
  const pts = [
    [R.mouth.x, R.mouth.y],
    [R.up.x, R.up.y],
  ]
  // the U from the up side to the down side
  const dir = R.down.x > R.up.x ? 1 : -1
  for (let k = 0; k <= 16; k++) {
    const a = dir > 0 ? Math.PI + (k * Math.PI) / 16 : -(k * Math.PI) / 16
    pts.push([R.turn.cx + Math.cos(a) * R.turn.r, R.turn.cy + Math.sin(a) * R.turn.r])
  }
  pts.push([R.bend.x, R.bend.y], [R.exit.x, R.exit.y])
  return pts
}
const paintRamp = (s, T, th) => {
  const R = T.ramp
  const pts = rampCenter(R).map(([x, y]) => [p(x), p(y)])
  const hw = p(R.half) + 1
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x - hw - 2)
    y0 = Math.min(y0, y - hw - 2)
    x1 = Math.max(x1, x + hw + 2)
    y1 = Math.max(y1, y + hw + 2)
  }
  const dist = (x, y) => {
    let d = Infinity
    for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(x, y, ...pts[i], ...pts[i + 1]))
    return d
  }
  shape(s, x0, y0, x1, y1, (x, y) => {
    const d = dist(x + 0.5, y + 0.5)
    if (d > hw + 1) return 0
    if (d > hw - 0.5) return d > hw ? C.ink : C.white
    if (d > hw - 1.5) return C.g4
    if (d < 1.2 && (y & 3) !== 0) return th.plasticGlint
    return (x & 1) === 0 && (y & 1) === 0 ? ((x + y) & 2 ? th.plastic[1] : th.plastic[0]) : 0
  })
  line(s, p(R.mouth.x - R.half), p(R.mouth.y), p(R.mouth.x + R.half), p(R.mouth.y), C.g7)
  line(s, p(R.exit.x - R.half), p(R.exit.y), p(R.exit.x + R.half), p(R.exit.y), C.g5)
  const sx = Math.round(p(R.turn.cx))
  const sy = Math.round(p(R.turn.cy - R.turn.r - R.half)) - 13
  const sw = th.sign.length * 4 + 8
  bevel(s, sx - sw / 2, sy, sw, 11, true)
  rect(s, sx - sw / 2 + 2, sy + 2, sw - 4, 7, th.signBar)
  text(s, th.sign, sx + 0.5, sy + 3, C.white, { font: FONTS.small, align: "center" })
  return { x: Math.max(0, Math.floor(Math.min(x0, sx - sw / 2))), y: Math.max(0, Math.floor(Math.min(y0, sy))), x1: Math.ceil(Math.max(x1, sx + sw / 2)), y1: Math.ceil(y1) }
}

// ---- sprites made by code ----

// a ball, r px, tinted by its upgrade level
export const BALL_TINTS = [
  [C.g2, C.g4, C.g6, C.g7, C.white],
  [C.navy, C.blue2, C.blue3, C.cyan2, C.white],
  [C.brn, C.orange, C.amber, C.yellow, C.white],
  [C.pur1, C.pur, C.pur3, C.pinkhi, C.white],
]
const ballSprite = (r, tint) => {
  const size = Math.ceil(r * 2)
  const s = surface(size, size)
  const c = size / 2
  shape(s, 0, 0, size - 1, size - 1, (x, y) => {
    const nx = (x + 0.5 - c) / r
    const ny = (y + 0.5 - c) / r
    const d = Math.hypot(nx, ny)
    if (d > 1) return 0
    if (d > 1 - 1 / r) return C.ink
    const nz = Math.sqrt(Math.max(0, 1 - d * d))
    const lit = Math.max(0, -nx * 0.5 - ny * 0.6 + nz * 0.62)
    return rampAt(tint, lit, x, y)
  })
  const hx = Math.round(c - r * 0.4)
  const hy = Math.round(c - r * 0.45)
  pset(s, hx, hy, C.white)
  pset(s, hx + 1, hy, C.white)
  pset(s, hx, hy + 1, C.white)
  return { ...capture(s, 0, 0, size, size), r: size / 2 }
}

// a bumper: a mushroom cap (Ember) or a shell (Tide), lit or not
const bumperSprite = (r, th, lit, id) => {
  const size = Math.ceil(r * 2) + 4
  const s = surface(size, size)
  const c = size / 2
  const skirt = lit ? th.bumperSkirtLit : th.bumperSkirt
  const cap = lit ? th.bumperCapLit : th.bumperCap
  shape(s, 0, 0, size - 1, size - 1, (x, y) => {
    const nx = x + 0.5 - c
    const ny = y + 0.5 - c
    const d = Math.hypot(nx, ny)
    if (d > r + 2) return 0
    if (d > r + 1) return C.ink
    if (d > r - 2) return rampAt(skirt, 0.5 - (nx + ny) / (2 * r), x, y)
    if (d > r - 3) return C.ink
    const k = d / (r - 3)
    const shade = 0.55 + 0.45 * ((nx * -0.6 + ny * -0.8) / (d || 1)) * k
    if (th.name === "TIDE") {
      // shell ridges
      const a = Math.atan2(ny, nx)
      if (Math.abs(Math.sin(a * 4)) < 0.18 && d > 2) return cap[0]
    }
    return rampAt(cap, shade, x, y)
  })
  if (th.name === "EMBER") {
    // white spots on the mushroom cap
    for (const [dx, dy] of [[-4, -4], [3, -5], [5, 2], [-3, 3], [0, -1]]) {
      disc(s, c + dx, c + dy, 1.4, lit ? C.white : C.g7)
    }
  } else disc(s, c, c, 1.5, lit ? C.white : C.peach)
  void id
  return capture(s, 0, 0, size, size)
}

// an E-V-O drop target
const keySprite = (letter, th, lit) => {
  const s = surface(12, 12)
  bevel(s, 0, 0, 12, 12, true, lit ? C.white : th.key[0])
  rect(s, 2, 2, 8, 8, lit ? C.cream : th.key[1])
  text(s, letter, 6.5, 2.5, lit ? C.red : C.ink, { align: "center" })
  frame(s, 0, 0, 12, 12, C.ink)
  return capture(s, 0, 0, 12, 12)
}

// Sparkit, tiny, for the outlane saver (12 x 12)
const SPARKIT = [
  "..k......k..",
  "..kc....ck..",
  "...kkkkkk...",
  "..kyyyyyyk..",
  ".kyyyyyyyyk.",
  ".kykyyyykyk.",
  ".kyyyyyyyyk.",
  ".kyywyywyyk.",
  ".kyyykkyyyk.",
  "..kyyyyyyk..",
  "...kkkkkk...",
  "..kk....kk..",
]
const tinySprite = (rows, map) => {
  const h = rows.length
  const w = rows[0].length
  const data = new Int16Array(w * h).fill(-1)
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== "." && (data[y * w + x] = map[ch])))
  return { w, h, data }
}

export const buildArt = (T) => {
  const th = THEMES[T.id]
  const base = surface(W, H)
  paintCabinet(base, th)
  paintFloor(base, T, th)
  paintDecals(base, T, th)
  paintWalls(base, T)
  paintLower(base, th)
  const lit = surface(W, H)
  const lamps = lampsFor(T).map((l) => {
    const sh = paintLamp(base, l, false)
    lit.buf.fill(0)
    paintLamp(lit, l, true)
    const x = Math.max(0, Math.floor(sh.x0) - 1)
    const y = Math.max(0, Math.floor(sh.y0) - 7)
    const w = Math.ceil(sh.x1) - x + 3
    const h = Math.ceil(sh.y1) - y + 9
    return { ...l, x0: x, y0: y, on: capture(lit, x, y, w, h) }
  })
  const apronS = surface(W, H)
  paintApron(apronS)
  const apron = { x: 0, y: APRON.y - 6, ...capture(apronS, 0, APRON.y - 6, W, H - APRON.y + 6) }
  const rampS = surface(W, H)
  const box = paintRamp(rampS, T, th)
  const ramp = { x: box.x, y: box.y, ...capture(rampS, box.x, box.y, box.x1 - box.x + 1, box.y1 - box.y + 1) }
  const r = p(T.bumpers[0].r)
  return {
    T,
    theme: th,
    base,
    lamps,
    apron,
    ramp,
    balls: BALL_TINTS.map((t) => ballSprite(p(11), t)),
    ballsBig: BALL_TINTS.map((t) => ballSprite(p(11) * 1.25, t)),
    bumpers: T.bumpers.map((b, i) => [bumperSprite(p(b.r), th, false, i), bumperSprite(p(b.r), th, true, i)]),
    keys: "EVO".split("").map((ch) => [keySprite(ch, th, false), keySprite(ch, th, true)]),
    sparkit: tinySprite(SPARKIT, { k: C.ink, y: C.yellow, c: C.sky2, w: C.white }),
    sparkitLit: tinySprite(SPARKIT, { k: C.ink, y: C.cream, c: C.white, w: C.sky2 }),
    bumperR: r,
  }
}

// ---- bonus stages ----
const BONUS_THEMES = {
  mole: { floor: [C.brn0, C.brn1, C.brn, C.brn3], sling: [C.olive, C.moss, C.mint], title: "BURROW BASH", textOutline: C.brn0 },
  ghost: { floor: [C.ink, C.pur0, C.pur1, C.pur], sling: [C.pur1, C.pur, C.pur3], title: "PHANTOM HALL", textOutline: C.ink },
  crab: { floor: [C.teal0, C.teal1, C.teal2, C.sand0, C.sand], sling: [C.red1, C.red, C.red3], title: "TIDAL TITAN", textOutline: C.teal0 },
}

const inBonus = (x, y) => {
  const ux = x / K
  const uy = y / K
  if (ux < 20 || ux > LANE.left) return false
  return inDome(ux, uy, BONUS_DOME)
}

export const MUDPUP = buildSprite({ plan: "round", main: "brown", acc: "pink", belly: "cream", ears: "round", eyes: "sleepy", marks: ["cheeks"], size: 0.62 })

export const buildBonusArt = (kind) => {
  const th = BONUS_THEMES[kind]
  const base = surface(W, H)
  paintCabinet(base, { cabinet: [C.ink, C.g1, C.navy0, C.ink] })
  paintFloor(base, { id: kind === "crab" ? "tide" : "bonus" }, { floor: th.floor, dots: kind === "ghost" ? [C.pur3, C.yellow] : [C.brn3, C.sand3] }, inBonus)
  // the dome rail and the side walls
  const R = p(BONUS_DOME.r)
  const dcx = p(BONUS_DOME.cx)
  const dcy = p(BONUS_DOME.cy)
  shape(base, 0, 0, W - 1, dcy + 1, (x, y) => {
    const px = x + 0.5
    const py = y + 0.5
    if (py > dcy) return 0
    const d = Math.hypot(px - dcx, py - dcy)
    if (d < R || d > R + 5) return 0
    if (d < R + 1 || d > R + 4) return C.ink
    return rampAt(METAL, 0.4 - ((py - dcy) / d) * 0.5, x, y)
  })
  capsule(base, p(20) - 2.5, p(BONUS_DOME.cy), p(20) - 2.5, H + 4, 3)
  capsule(base, p(LANE.left) + 2.5, p(BONUS_DOME.cy), p(LANE.left) + 2.5, H + 4, 3)
  if (kind === "mole") for (const h of MOLE_HOLES) {
    disc(base, p(h.x), p(h.y) + 3, 9.5, C.brn0)
    disc(base, p(h.x), p(h.y) + 3, 7, C.ink)
  }
  if (kind === "ghost") {
    // candles along the hall
    for (const x of [60, 100, 180, 220]) {
      rect(base, x, 150, 3, 8, C.cream)
      pset(base, x + 1, 148, C.amber)
      pset(base, x + 1, 147, C.yellow)
    }
  }
  if (kind === "crab") for (let i = 0; i < 30; i++) pset(base, 40 + Math.floor(hash(i, 3) * 200), 120 + Math.floor(hash(i, 5) * 300), C.sand3)
  text(base, th.title, p(MID) + 0.5, p(640), C.white, { align: "center", outline: th.textOutline })
  paintLower(base, th)
  const apronS = surface(W, H)
  paintApron(apronS)
  const apron = { x: 0, y: APRON.y - 6, ...capture(apronS, 0, APRON.y - 6, W, H - APRON.y + 6) }
  return { kind, base, apron, balls: BALL_TINTS.map((t) => ballSprite(p(11), t)), bumper: [bumperSprite(p(20), THEMES.ember, false), bumperSprite(p(20), THEMES.ember, true)] }
}

export { bayer }
