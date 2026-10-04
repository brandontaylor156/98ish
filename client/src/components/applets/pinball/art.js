// Blue Screen's artwork, as 1990s PC pinball pixel art: the table is drawn at 280 x 500
// pixels (half a table unit per pixel) with the palette in pixel.js, ordered dithering for
// shading, 1 px dark outlines and highlight pixels, hand-placed sprites and bitmap text.
// buildArt() paints everything that never moves once (the base layer), plus the overlays
// drawn over the balls (the ramp's see-through plastic, the taskbar apron) and the sprites
// render.js stamps each frame (lamps lit by palette swap, bumpers, keycap targets, balls).

import {
  BANK,
  BUMPERS,
  CAPTIVE,
  DOME,
  FLOPPY,
  GUIDES,
  HEIGHT,
  INLANES,
  LANE,
  LANE_BOTTOM,
  LANE_GUIDES,
  LANE_TOP,
  MONITOR,
  ORBIT_GATES,
  ORBIT_L,
  ORBIT_R,
  OUTLANES,
  RAMP,
  ROLLOVERS,
  SCOOP,
  SEPARATORS,
  SLINGS,
  SPINNER,
  TARGETS,
  WIDTH,
} from "./table.js"
import { C, FONTS, bayer, bevel, capture, disc, frame, inPoly, line, pset, rampAt, rect, ring, segDist, shape, sprite, surface, text } from "./pixel.js"

export const K = 0.5 // pixels per table unit
export const W = Math.round(WIDTH * K)
export const H = Math.round(HEIGHT * K)
const p = (u) => u * K

// ---- sprites drawn by hand ----
export const ICONS = {
  computer: sprite(
    [
      "..kkkkkkkkkkkk..",
      "..kwwwwwwwwwbk..",
      "..kwkkkkkkkkbk..",
      "..kwkcssssskbk..",
      "..kwkcssssskbk..",
      "..kwksssssskbk..",
      "..kwksssssskbk..",
      "..kwkkkkkkkkbk..",
      "..kbbbbbbbbbdk..",
      "..kkkkkkkkkkkk..",
      ".....kbbbbk.....",
      "..kkkkkkkkkkkk..",
      "..kwbbbbbbbbdk..",
      "..kbkkkkkbgbdk..",
      "..kddddddddddk..",
      "..kkkkkkkkkkkk..",
    ],
    { k: C.ink, w: C.beige3, b: C.beige, d: C.beige1, s: C.blue, c: C.sky2, g: C.lime },
  ),
  bin: sprite(
    [
      "....kkkkkkkk....",
      "...kwwwwwwwwk...",
      "..kkkkkkkkkkkk..",
      "...kwgwgwgwgk...",
      "...kgwgwgwgwk...",
      "...kwgGGGgwgk...",
      "...kgGwgwGwgk...",
      "...kwgGGGgwgk...",
      "...kgwgwgwgwk...",
      "....kwgwgwgk....",
      "....kgwgwgwk....",
      "....kkkkkkkk....",
    ],
    { k: C.ink, w: C.g7, g: C.g4, G: C.green },
  ),
  floppy: sprite(
    [
      "kkkkkkkkkkkkkk",
      "knnnggggggnnnk",
      "knnngkkgggnnnk",
      "knnngkkgggnnnk",
      "knnnggggggnnnk",
      "knnnnnnnnnnnnk",
      "knnnnnnnnnnnnk",
      "knnwwwwwwwwnnk",
      "knnwkkkkkkwnnk",
      "knnwwwwwwwwnnk",
      "knnwkkkkkwwnnk",
      "knnwwwwwwwwnnk",
      "kkkkkkkkkkkkkk",
    ],
    { k: C.ink, n: C.navy, g: C.g6, w: C.white },
  ),
  window: sprite(["kkkkkkk", "knnnnnk", "kwwwwwk", "kwwwwwk", "kwwwwwk", "kkkkkkk"], { k: C.ink, n: C.navy, w: C.white }),
  hourglass: sprite(["kkkkk", ".kak.", "..k..", ".kak.", "kkkkk"], { k: C.ink, a: C.amber }),
  drive: sprite(
    ["kkkkkkkkkk", "kggggggggk", "kgkkkkkkgk", "kgkddddkgk", "kgkkkkkkgk", "kggggggLgk", "kkkkkkkkkk"],
    { k: C.ink, g: C.g6, d: C.g3, L: C.lime },
  ),
}

// ---- lamps: inserts in the playfield, drawn dark in the base layer and stamped lit ----
const LAMP_COLORS = {
  red: { off: [C.red0, C.red1], on: [C.red, C.red3, C.pink] },
  yellow: { off: [C.yellow0, C.yellow1], on: [C.amber, C.yellow, C.cream] },
  green: { off: [C.green0, C.green1], on: [C.green, C.lime, C.mint] },
  blue: { off: [C.navy1, C.navy], on: [C.blue2, C.blue3, C.cyan2] },
  cyan: { off: [C.teal0, C.teal1], on: [C.teal4, C.cyan, C.cyan2] },
  mag: { off: [C.mag0, C.mag1], on: [C.mag, C.pinkhi, C.white] },
  orange: { off: [C.red0, C.brown], on: [C.orange, C.amber, C.cream] },
  white: { off: [C.g1, C.g3], on: [C.g6, C.g7, C.white] },
}

// an arrow pointing at angle a (radians, 0 = right, -PI/2 = up), w long and h wide
const arrowPts = (x, y, a, w, h) => {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const pt = (u, v) => [x + u * c - v * s, y + u * s + v * c]
  return [pt(w / 2, 0), pt(-w / 2, h / 2), pt(-w / 4, 0), pt(-w / 2, -h / 2)]
}

// The lamp list: id, shape and color; the game state that lights each one lives in render.js
const UP = -Math.PI / 2
export const LAMPS = [
  ...ROLLOVERS.map((r, i) => ({ id: "lane" + i, kind: "circle", x: p(r.x), y: p(r.y) + 1, r: 7, color: "yellow", letter: r.letter })),
  ...TARGETS.map((t, i) => ({ id: "target" + i, kind: "circle", x: p(t.x), y: p(t.y) + 12, r: 2.5, color: "yellow" })),
  { id: "bankArrow", kind: "arrow", x: p(262), y: p(530), a: UP, w: 12, h: 10, color: "yellow" },
  ...[0, 1, 2].map((i) => ({ id: "lock" + i, kind: "circle", x: p(MONITOR.x0) + 6 + i * 10, y: p(MONITOR.y0) - 5, r: 3, color: "blue" })),
  { id: "lockArrow", kind: "arrow", x: p(212), y: p(447), a: -1.1, w: 10, h: 8, color: "blue" },
  { id: "rampArrow", kind: "arrow", x: p(RAMP.mouth.x), y: p(RAMP.mouth.y) + 14, a: UP, w: 14, h: 12, color: "cyan" },
  { id: "jackpot", kind: "rect", x: p(RAMP.mouth.x), y: p(RAMP.mouth.y) + 27, w: 31, h: 7, color: "mag", label: "JACKPOT" },
  { id: "orbitL", kind: "arrow", x: p(46), y: p(560), a: -1.75, w: 12, h: 10, color: "green" },
  { id: "orbitR", kind: "arrow", x: p(480), y: p(500), a: -1.45, w: 12, h: 10, color: "green" },
  { id: "spinner", kind: "rect", x: p(42), y: p(SPINNER.ay) - 12, w: 16, h: 5, color: "orange", label: "DIAL" },
  { id: "floppyArrow", kind: "arrow", x: p(FLOPPY.x) + 14, y: p(FLOPPY.y) + 18, a: -2.3, w: 10, h: 8, color: "red" },
  { id: "extraBall", kind: "rect", x: p(FLOPPY.x), y: p(FLOPPY.y) - 15, w: 18, h: 6, color: "red", label: "EXTRA" },
  { id: "driveArrow", kind: "arrow", x: p((CAPTIVE.x0 + CAPTIVE.x1) / 2), y: p(CAPTIVE.mouth) + 14, a: UP, w: 10, h: 8, color: "orange" },
  { id: "drive", kind: "circle", x: p((CAPTIVE.x0 + CAPTIVE.x1) / 2), y: p(CAPTIVE.top) - 5, r: 2.5, color: "green" },
  ...INLANES.map((l, i) => ({ id: "inlane" + i, kind: "arrow", x: p(l.x), y: p(l.y) + 10, a: Math.PI / 2, w: 9, h: 8, color: "cyan" })),
  ...OUTLANES.map((l, i) => ({ id: "outlane" + i, kind: "circle", x: p(l.x), y: p(l.y) + 16, r: 3, color: "red" })),
  { id: "kickback", kind: "rect", x: p(39), y: p(740), w: 11, h: 45, color: "green", label: "RESTORE", vertical: true },
  ...[2, 3, 4, 5, 6].map((n, i) => ({ id: "bonus" + n, kind: "circle", x: p(200) + i * 13, y: p(745), r: 5, color: "orange", letter: n + "X" })),
  { id: "save", kind: "rect", x: p(262), y: p(845), w: 20, h: 6, color: "cyan", label: "SAVE" },
  { id: "shootAgain", kind: "rect", x: p(150), y: p(966), w: 38, h: 8, color: "red", label: "SHOOT AGAIN" },
]
// the rank ladder: lamps in the RANK.EXE window decal
export const RANK_WIN = { x: 86, y: 266, w: 90, h: 88 }
for (let i = 0; i < 8; i++) LAMPS.push({ id: "rank" + i, kind: "circle", x: RANK_WIN.x + 8, y: RANK_WIN.y + 17 + i * 9, r: 3, color: "green" })

const lampShape = (l) => {
  if (l.kind === "circle") return { x0: l.x - l.r - 1, y0: l.y - l.r - 1, x1: l.x + l.r + 1, y1: l.y + l.r + 1, inside: (x, y) => Math.hypot(x - l.x, y - l.y) <= l.r, edge: (x, y) => Math.hypot(x - l.x, y - l.y) > l.r - 1 }
  if (l.kind === "rect") {
    const x0 = Math.round(l.x - l.w / 2)
    const y0 = Math.round(l.y - l.h / 2)
    return { x0, y0, x1: x0 + l.w - 1, y1: y0 + l.h - 1, inside: (x, y) => x >= x0 && x < x0 + l.w && y >= y0 && y < y0 + l.h, edge: (x, y) => x < x0 + 1 || y < y0 + 1 || x >= x0 + l.w - 1 || y >= y0 + l.h - 1 }
  }
  const pts = arrowPts(l.x, l.y, l.a, l.w, l.h)
  const xs = pts.map((q) => q[0])
  const ys = pts.map((q) => q[1])
  const inside = (x, y) => inPoly(pts, x, y)
  return {
    x0: Math.min(...xs) - 1,
    y0: Math.min(...ys) - 1,
    x1: Math.max(...xs) + 1,
    y1: Math.max(...ys) + 1,
    inside,
    edge: (x, y) => !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1),
  }
}

// paints a lamp (lit or not) onto a surface
const paintLamp = (s, l, lit) => {
  const sh = lampShape(l)
  const cols = LAMP_COLORS[l.color]
  const ramp = lit ? cols.on : cols.off
  const cx = (sh.x0 + sh.x1 + 1) / 2
  const cy = (sh.y0 + sh.y1 + 1) / 2
  const rr = Math.max(2, Math.max(sh.x1 - sh.x0, sh.y1 - sh.y0) / 2)
  shape(s, sh.x0, sh.y0, sh.x1, sh.y1, (x, y) => {
    const px = x + 0.5
    const py = y + 0.5
    if (!sh.inside(px, py)) return 0
    if (sh.edge(px, py)) return C.ink
    // brighter toward the middle and the top-left, dithered
    const d = Math.hypot(px - cx + 1, py - cy + 1) / rr
    return rampAt(ramp, 1 - d * 0.9, x, y)
  })
  const ink = lit ? C.ink : ramp === cols.off && l.color === "white" ? C.g5 : C.g5
  if (l.letter) text(s, l.letter, l.x + 0.5, l.y - (l.letter.length > 1 ? 2 : 2), lit ? C.ink : C.g4, { font: FONTS.small, align: "center" })
  if (l.label) {
    if (l.vertical) {
      const n = l.label.length
      for (let i = 0; i < n; i++) text(s, l.label[i], l.x + 0.5, l.y - (n * 6) / 2 + i * 6 + 1, lit ? C.ink : C.g4, { font: FONTS.small, align: "center" })
    } else text(s, l.label, l.x + 0.5, l.y - 2, lit ? C.ink : ink, { font: FONTS.small, align: "center" })
  }
  return sh
}

// ---- shaded rails, posts and rubbers ----
const LIGHT = [-0.6, -0.8]
const METAL = [C.g2, C.g4, C.g6, C.g7, C.white]
const RUBBER = [C.g5, C.g7, C.white]
const BEIGE = [C.beige0, C.beige1, C.beige, C.beige3]

// a thick line a-b (px) of radius r, lit from the top-left, outlined in ink
const capsule = (s, ax, ay, bx, by, r, ramp = METAL, outline = C.ink) => {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy || 1
  shape(s, Math.min(ax, bx) - r - 1, Math.min(ay, by) - r - 1, Math.max(ax, bx) + r + 1, Math.max(ay, by) + r + 1, (x, y) => {
    const px = x + 0.5
    const py = y + 0.5
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    const nx = px - ax - t * dx
    const ny = py - ay - t * dy
    const d = Math.hypot(nx, ny)
    if (d > r) return 0
    if (d > r - 1 && outline) return outline
    const lit = d < 0.01 ? 0.5 : 0.5 - 0.5 * ((nx * LIGHT[0] + ny * LIGHT[1]) / d) * Math.min(1, d / (r * 0.7))
    return rampAt(ramp, 1 - lit, x, y)
  })
}

const post = (s, x, y, r, ramp = RUBBER) =>
  shape(s, x - r - 1, y - r - 1, x + r + 1, y + r + 1, (px, py) => {
    const nx = px + 0.5 - x
    const ny = py + 0.5 - y
    const d = Math.hypot(nx, ny)
    if (d > r) return 0
    if (d > r - 1) return C.ink
    const lit = 0.5 + 0.5 * ((-nx * LIGHT[0] - ny * LIGHT[1]) / (d || 1)) * (d / r)
    return rampAt(ramp, lit, px, py)
  })

// ---- the base layer ----
const inPlayfield = (x, y) => {
  const ux = x / K
  const uy = y / K
  if (ux < 20 || ux > LANE.right) return false
  return uy >= DOME.cy || Math.hypot(ux - DOME.cx, uy - DOME.cy) <= DOME.r
}

const paintCabinet = (s) => {
  // dark cabinet wood/metal round the glass, dithered
  shape(s, 0, 0, W - 1, H - 1, (x, y) => rampAt([C.ink, C.navy0, C.navy1, C.g1], 0.25 + 0.2 * Math.sin(y * 0.05 + x * 0.02) + 0.15 * ((x * 7 + y * 3) % 5 === 0 ? 1 : 0), x, y))
  // side rails' bolts
  for (let y = 30; y < H; y += 60) {
    post(s, 3, y, 2, METAL)
    post(s, W - 4, y, 2, METAL)
  }
}

const paintFloor = (s) => {
  const floor = [C.teal0, C.teal1, C.teal2, C.teal, C.teal4]
  shape(s, 0, 0, W - 1, H - 1, (x, y) => {
    const px = x + 0.5
    const py = y + 0.5
    if (!inPlayfield(px, py)) return 0
    if (px / K > LANE.left) return rampAt([C.ink, C.g1, C.g2], 0.4 + 0.3 * (y / H), x, y) // the shooter lane's floor
    // a light over the middle of the table, darker toward the edges and the bottom
    const cx = (px - 131) / 140
    const cy = (py - 200) / 330
    const t = 0.82 - 0.55 * Math.hypot(cx, cy)
    return rampAt(floor, t, x, y)
  })
  // a faint desktop grid, like icon spacing
  for (let y = 150; y < 460; y += 24) for (let x = 20; x < 250; x += 24) if (inPlayfield(x, y)) pset(s, x, y, C.teal4)
}

// a Win98 window decal: title bar and gray body
const windowDecal = (s, x, y, w, h, title) => {
  rect(s, x + 2, y + 2, w, h, C.teal0) // shadow on the playfield
  bevel(s, x, y, w, h, true, C.g6)
  rect(s, x + 3, y + 3, w - 6, 9, C.navy)
  for (let i = 0; i < w - 6; i++) if (i > (w - 6) * 0.55 && bayer(i, 0) < (i - (w - 6) * 0.55) / ((w - 6) * 0.45)) for (let j = 0; j < 9; j++) if (bayer(i, j) < (i - (w - 6) * 0.5) / ((w - 6) * 0.5)) pset(s, x + 3 + i, y + 3 + j, C.sky)
  text(s, title, x + 5, y + 5, C.white, { font: FONTS.small })
  // the close box
  bevel(s, x + w - 12, y + 4, 8, 7, true)
  text(s, "X", x + w - 9, y + 5, C.ink, { font: FONTS.small })
}

const paintDecals = (s) => {
  // RANK.EXE: the mission ladder
  const r = RANK_WIN
  windowDecal(s, r.x, r.y, r.w, r.h, "RANK.EXE")
  rect(s, r.x + 3, r.y + 12, r.w - 6, r.h - 15, C.white)
  frame(s, r.x + 3, r.y + 12, r.w - 6, r.h - 15, C.g4)
  const names = ["INTERN", "HELP DESK", "TECHNICIAN", "POWER USER", "PROGRAMMER", "NETWORK ADMIN", "WEBMASTER", "SYSADMIN"]
  names.forEach((n, i) => text(s, n, r.x + 15, r.y + 15 + i * 9, C.ink, { font: FONTS.small }))
  // bonus multiplier row label
  text(s, "BONUS", p(200) - 8, p(745) - 2, C.cyan2, { font: FONTS.small, align: "right", outline: C.teal0 })

  // the table's name, under the bumpers
  text(s, "BLUE", p(160), p(318), C.white, { outline: C.navy })
  text(s, "SCREEN", p(160), p(338), C.white, { outline: C.navy })

  // My Computer under the ramp's mouth, Recycle Bin at the drain
  // floppy drive round the saucer
  const fx = Math.round(p(FLOPPY.x))
  const fy = Math.round(p(FLOPPY.y))
  rect(s, fx - 13, fy - 10, 26, 20, C.navy1)
  bevel(s, fx - 12, fy - 9, 24, 18, true, C.beige)
  rect(s, fx - 9, fy - 2, 18, 4, C.ink) // the slot
  rect(s, fx + 6, fy + 5, 3, 2, C.green1) // its LED
  disc(s, fx, fy, 6.5, C.ink)
  disc(s, fx - 0.5, fy - 0.5, 5, C.g1)
  text(s, "A:", fx - 10, fy + 4, C.beige0, { font: FONTS.small })

  // the hard drive's channel: a drive case
  const hx = Math.round(p(CAPTIVE.x0)) - 3
  const hy = Math.round(p(CAPTIVE.top)) - 3
  const hw = Math.round(p(CAPTIVE.x1 - CAPTIVE.x0)) + 6
  const hh = Math.round(p(CAPTIVE.mouth - CAPTIVE.top)) + 6
  bevel(s, hx, hy, hw, hh, true, C.g5)
  rect(s, hx + 3, hy + 3, hw - 6, hh - 6, C.g1)
  for (let y = hy + 4; y < hy + hh - 4; y += 3) line(s, hx + 3, y, hx + hw - 4, y, C.g2)
  text(s, "C:", hx + hw / 2 + 0.5, hy + hh + 2, C.cyan2, { font: FONTS.small, align: "center", outline: C.teal0 })

  // the monitor (the walls are its bezel), the blue screen inside
  const mx0 = Math.round(p(MONITOR.x0))
  const mx1 = Math.round(p(MONITOR.x1))
  const my0 = Math.round(p(MONITOR.y0))
  const my1 = Math.round(p(MONITOR.y1))
  rect(s, mx0, my0, mx1 - mx0, my1 - my0 + 2, C.blue)
  for (let y = my0 + 3; y < my1; y += 4) for (let x = mx0 + 4; x < mx1 - 4; x++) if (bayer(x, y) < 0.35) pset(s, x, y, C.blue2)
  rect(s, mx0 + 8, my0 + 4, mx1 - mx0 - 16, 5, C.g6)
  text(s, "98ISH", (mx0 + mx1) / 2 + 0.5, my0 + 4, C.blue, { font: FONTS.small, align: "center" })
  // the stand
  rect(s, (mx0 + mx1) / 2 - 5, my1 + 3, 10, 3, C.beige1)
  disc(s, p(SCOOP.x), p(SCOOP.y), 6.5, C.ink)
  ring(s, p(SCOOP.x), p(SCOOP.y), 7, C.g4)

  // the Recycle Bin at the drain, between the flippers
  for (let j = 0; j < ICONS.bin.h; j++)
    for (let i = 0; i < ICONS.bin.w; i++) pset(s, Math.round(p(262)) - 8 + i, 451 + j, ICONS.bin.data[j * ICONS.bin.w + i])
  // My Computer, big, under the ramp's U turn (seen through the plastic)
  const cx = Math.round(p(RAMP.turn.cx)) - 16
  const cy = Math.round(p(RAMP.turn.cy)) + 6
  for (let j = 0; j < ICONS.computer.h; j++)
    for (let i = 0; i < ICONS.computer.w; i++) {
      const c = ICONS.computer.data[j * ICONS.computer.w + i]
      if (c > 0) rect(s, cx + i * 2, cy + j * 2, 2, 2, c)
    }

  // lane labels
  text(s, "IM", p(262), p(60), C.cyan2, { font: FONTS.small, align: "center", outline: C.teal0 })
  text(s, "WEB", p(42), p(380), C.cyan2, { font: FONTS.small, align: "center", outline: C.teal0 })
  text(s, "WEB", p(482), p(380), C.cyan2, { font: FONTS.small, align: "center", outline: C.teal0 })
  // the shooter lane
  for (let i = 0; i < 6; i++) text(s, "LAUNCH"[i], p((LANE.left + LANE.right) / 2) + 0.5, p(600) + i * 7, C.g3, { font: FONTS.small, align: "center" })
}

const paintWalls = (s) => {
  // the dome: a thick rail round the top
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
  // side walls and the shooter lane wall
  capsule(s, p(20) - 2.5, p(DOME.cy), p(20) - 2.5, H + 4, 3)
  capsule(s, p(LANE.right) + 2.5, p(DOME.cy), p(LANE.right) + 2.5, H + 4, 3)
  capsule(s, p(LANE.left), p(LANE.top), p(LANE.left), H + 4, 2)
  // gates (thin wires)
  const wire = (ax, ay, bx, by) => {
    line(s, p(ax), p(ay), p(bx), p(by), C.g7)
    line(s, p(ax), p(ay) + 1, p(bx), p(by) + 1, C.g2)
  }
  wire(LANE.right - 2, 296, LANE.left, LANE.top)
  ORBIT_GATES.forEach((g) => wire(...g))
  // orbit inner walls
  capsule(s, p(ORBIT_L.x), p(ORBIT_L.y0), p(ORBIT_L.x), p(ORBIT_L.y1), 2.5)
  capsule(s, p(ORBIT_L.x), p(ORBIT_L.y1), p(ORBIT_L.flare[0]), p(ORBIT_L.flare[1]), 2.5)
  capsule(s, p(ORBIT_R.x), p(ORBIT_R.y0), p(ORBIT_R.x), p(ORBIT_R.y1), 2.5)
  // top lane dividers (rubber posts)
  for (const x of LANE_GUIDES) capsule(s, p(x), p(LANE_TOP), p(x), p(LANE_BOTTOM), 2.5, RUBBER)
  // monitor bezel
  const { x0, x1, y0, y1 } = MONITOR
  capsule(s, p(x0), p(y1), p(x0), p(y0), 2.5, BEIGE)
  capsule(s, p(x0), p(y0), p(x1), p(y0), 2.5, BEIGE)
  capsule(s, p(x1), p(y0), p(x1), p(y1), 2.5, BEIGE)
  // the hard drive channel walls
  capsule(s, p(CAPTIVE.x0), p(CAPTIVE.mouth), p(CAPTIVE.x0), p(CAPTIVE.top), 2)
  capsule(s, p(CAPTIVE.x0), p(CAPTIVE.top), p(CAPTIVE.x1), p(CAPTIVE.top), 2)
  capsule(s, p(CAPTIVE.x1), p(CAPTIVE.top), p(CAPTIVE.x1), p(CAPTIVE.mouth), 2)
  // drop target slots and the bank's posts
  line(s, p(BANK.x0), p(BANK.y0) + 2, p(BANK.x1), p(BANK.y1) + 2, C.ink)
  post(s, p(BANK.x0 - 3), p(BANK.y0 + 1), 3)
  post(s, p(BANK.x1 + 3), p(BANK.y1 - 1), 3)
  // slingshots: plastic, with white rubber round them
  SLINGS.forEach((sl) => {
    const pts = sl.map(([x, y]) => [p(x), p(y)])
    const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3
    shape(s, Math.min(...pts.map((q) => q[0])) - 1, pts[0][1] - 1, Math.max(...pts.map((q) => q[0])) + 1, pts[2][1] + 1, (x, y) => (inPoly(pts, x + 0.5, y + 0.5) ? rampAt([C.navy, C.blue, C.blue2], 0.3 + 0.3 * Math.abs(x - cx) / 14 + 0.2 * Math.sin(y * 0.4), x, y) : 0))
    for (let i = 0; i < 3; i++) {
      const [ax, ay] = pts[i]
      const [bx, by] = pts[(i + 1) % 3]
      capsule(s, ax, ay, bx, by, 2.5, RUBBER)
    }
  })
  SEPARATORS.forEach((sp) => capsule(s, p(sp.x), p(sp.y0), p(sp.x), p(sp.y1), 2))
  GUIDES.forEach(([ax, ay, bx, by]) => capsule(s, p(ax), p(ay), p(bx), p(by), 2))
}

// The taskbar apron at the foot of the table, drawn over the balls (they roll under it).
// Left of the drain: a Start button; right of it: the tray (the clock shows the ball).
export const APRON = { y: 466, gapX0: 108, gapX1: 154 }
const paintApron = (s) => {
  const y = APRON.y
  const parts = [
    [8, APRON.gapX0],
    [APRON.gapX1, Math.round(p(LANE.left)) - 1],
  ]
  for (const [x0, x1] of parts) {
    rect(s, x0, y, x1 - x0, H - y, C.g6)
    rect(s, x0, y, x1 - x0, 1, C.g7)
    rect(s, x0, y + 1, x1 - x0, 1, C.white)
    frame(s, x0, y, x1 - x0, H - y + 1, C.ink)
  }
  // Start button
  bevel(s, 12, y + 5, 40, 14, true)
  text(s, "START", 22, y + 9, C.ink, { font: FONTS.small })
  for (let j = 0; j < ICONS.window.h; j++) for (let i = 0; i < ICONS.window.w; i++) pset(s, 14 + i, y + 9 + j, ICONS.window.data[j * ICONS.window.w + i])
  // the tray (sunken)
  bevel(s, APRON.gapX1 + 40, y + 5, 54, 14, false)
  // a slant into the drain on each side
  for (let i = 0; i < 6; i++) {
    rect(s, APRON.gapX0 - 6 + i, y - 6 + i, 1, 6 - i, C.g4)
    rect(s, APRON.gapX1 + 5 - i, y - 6 + i, 1, 6 - i, C.g4)
  }
}

// The ramp: see-through plastic (every other pixel), chrome wire rails, and its sign
const rampCenter = () => {
  const R = RAMP
  const pts = [[R.mouth.x, R.mouth.y], [R.up.x, R.up.y]]
  for (let a = Math.PI; a <= Math.PI * 2 + 1e-6; a += Math.PI / 16) pts.push([R.turn.cx + Math.cos(a) * R.turn.r, R.turn.cy + Math.sin(a) * R.turn.r])
  pts.push([R.bend.x, R.bend.y], [R.exit.x, R.exit.y])
  return pts
}
const paintRamp = (s) => {
  const pts = rampCenter().map(([x, y]) => [p(x), p(y)])
  const hw = p(RAMP.half) + 1
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
    if (d > hw - 0.5) return d > hw ? C.ink : C.white // the wire rails
    if (d > hw - 1.5) return C.g4
    // the plastic: one pixel in four tinted, so the playfield shows through, and a glint
    // along the middle
    if (d < 1.2 && (y & 3) !== 0) return C.cyan2
    return (x & 1) === 0 && (y & 1) === 0 ? ((x + y) & 2 ? C.sky2 : C.sky) : 0
  })
  // the ramp's flap at the mouth and the exit
  const R = RAMP
  line(s, p(R.mouth.x - R.half), p(R.mouth.y), p(R.mouth.x + R.half), p(R.mouth.y), C.g7)
  line(s, p(R.exit.x - R.half), p(R.exit.y), p(R.exit.x + R.half), p(R.exit.y), C.g5)
  // the sign over the U turn: MY COMPUTER on a title bar
  const sx = Math.round(p(R.turn.cx))
  const sy = Math.round(p(R.turn.cy - R.turn.r - R.half)) - 13
  bevel(s, sx - 27, sy, 54, 11, true)
  rect(s, sx - 25, sy + 2, 50, 7, C.navy)
  text(s, "MY COMPUTER", sx + 0.5, sy + 3, C.white, { font: FONTS.small, align: "center" })
  return { x: Math.max(0, Math.floor(Math.min(x0, sx - 27))), y: Math.max(0, Math.floor(Math.min(y0, sy))), x1: Math.ceil(x1), y1: Math.ceil(y1) }
}

// ---- sprites made by code ----

// a chrome ball, r px; light from the top-left, a dark outline, a highlight
const ballSprite = (r) => {
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
    // the floor's teal mirrored in the lower half
    if (ny > 0.35 && lit < 0.45) return (x + y) & 1 ? C.teal2 : C.g3
    return rampAt([C.g2, C.g4, C.g6, C.g7, C.white], lit, x, y)
  })
  const hx = Math.round(c - r * 0.4)
  const hy = Math.round(c - r * 0.45)
  pset(s, hx, hy, C.white)
  pset(s, hx + 1, hy, C.white)
  pset(s, hx, hy + 1, C.white)
  return { ...capture(s, 0, 0, size, size), r: size / 2 }
}

// a Start-button pop bumper cap (r px); lit = brighter colors
const bumperSprite = (r, lit) => {
  const size = Math.ceil(r * 2) + 4
  const s = surface(size, size)
  const c = size / 2
  const skirt = lit ? [C.red, C.red3, C.yellow] : [C.red0, C.red1, C.red]
  const cap = lit ? [C.g6, C.g7, C.cream, C.white] : [C.g4, C.g5, C.g6, C.g7]
  shape(s, 0, 0, size - 1, size - 1, (x, y) => {
    const nx = x + 0.5 - c
    const ny = y + 0.5 - c
    const d = Math.hypot(nx, ny)
    if (d > r + 2) return 0
    if (d > r + 1) return C.ink
    if (d > r - 2) return rampAt(skirt, 0.5 - (nx + ny) / (2 * r), x, y) // the skirt ring
    if (d > r - 3) return C.ink
    const k = d / (r - 3)
    const shade = 0.55 - 0.45 * ((nx * LIGHT[0] + ny * LIGHT[1]) / (d || 1)) * -k
    return rampAt(cap, 1 - shade + 0.2, x, y)
  })
  // the window logo and the word START
  const lx = Math.round(c - 3.5)
  const ly = Math.round(c - 7)
  for (let j = 0; j < ICONS.window.h; j++) for (let i = 0; i < ICONS.window.w; i++) pset(s, lx + i, ly + j, ICONS.window.data[j * ICONS.window.w + i])
  text(s, "START", c + 0.5, c + 1, lit ? C.red1 : C.ink, { font: FONTS.small, align: "center" })
  return capture(s, 0, 0, size, size)
}

// a keycap drop target, w x h px, with its letter
const keycapSprite = (letter, lit) => {
  const s = surface(13, 10)
  bevel(s, 0, 0, 13, 10, true, lit ? C.white : C.g7)
  rect(s, 2, 2, 9, 6, lit ? C.cream : C.g6)
  text(s, letter, 7, 2, lit ? C.red : C.ink, { font: FONTS.small, align: "center" })
  frame(s, 0, 0, 13, 10, C.ink)
  return capture(s, 0, 0, 13, 10)
}

export const buildArt = () => {
  const base = surface(W, H)
  paintCabinet(base)
  paintFloor(base)
  paintDecals(base)
  paintWalls(base)
  const lit = surface(W, H)
  const lamps = LAMPS.map((l) => {
    const sh = paintLamp(base, l, false)
    lit.buf.fill(0)
    paintLamp(lit, l, true)
    const x = Math.max(0, Math.floor(sh.x0) - 1)
    const y = Math.max(0, Math.floor(sh.y0) - 7)
    const w = Math.ceil(sh.x1) - x + 3
    const h = Math.ceil(sh.y1) - y + 9
    return { ...l, x0: x, y0: y, on: capture(lit, x, y, w, h) }
  })
  // overlays
  const apronS = surface(W, H)
  paintApron(apronS)
  const apron = { x: 0, y: APRON.y - 6, ...capture(apronS, 0, APRON.y - 6, W, H - APRON.y + 6) }
  const rampS = surface(W, H)
  const box = paintRamp(rampS)
  const ramp = { x: box.x, y: box.y, ...capture(rampS, box.x, box.y, box.x1 - box.x + 1, box.y1 - box.y + 1) }
  const r = p(BUMPERS[0].r)
  return {
    base,
    lamps,
    apron,
    ramp,
    ball: ballSprite(p(11)),
    ballBig: ballSprite(p(11) * 1.25),
    bumper: [bumperSprite(r, false), bumperSprite(r, true)],
    keycaps: TARGETS.map((t) => [keycapSprite(t.letter, false), keycapSprite(t.letter, true)]),
  }
}
