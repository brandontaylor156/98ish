// Zap It!'s pixel picture (pure; Node previews draw exactly this): the ZAP-TRON, an original
// handheld toy in black plastic with neon parts, the way a 1996 electronic toy (or its CD-ROM
// game) looked: a big dome to TAP ringed with timer lights, a SLIDER to swipe, a KNOB to twist,
// a LEVER to flick, a T-HANDLE to pull, and a speaker that buzzes for SHAKE. The part being
// called blinks and moves; the call is in a big pixel font on the toy's LCD.
//
//   minSize(cssW, cssH) / layout(W, H)
//   drawZap(b, L, s)   s = { cmd, frac (time left 0..1), score, best, who, ticks, feedback:
//                            { cmd, ok, at }, keys, t, now, reduced, over, shake }
//   drawBanner(b, t)

import {
  UI_COLORS,
  bevel,
  blit,
  createBitmap,
  createPalette,
  disc,
  drawCounter,
  drawText,
  drawTitle,
  ellipse,
  ellipseOutline,
  frame,
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
} from "../../../utils/retro/index.js"

export const pal = createPalette(UI_COLORS)
const P = (n) => pal.idx(n)
const NEON = {
  tap: ["#5a3c00", "#a87400", "#ecb400", "#ffe040", "#fff8b0"],
  swipe: ["#003c58", "#006c98", "#18a8d8", "#58e0ff", "#c4f8ff"],
  twist: ["#30084c", "#5c1c8c", "#9040d0", "#bc78ff", "#e8ccff"],
  pull: ["#4c1800", "#943400", "#e06000", "#ff9c3c", "#ffd8a8"],
  flick: ["#043c10", "#0c7424", "#1cb03c", "#5ce070", "#c0ffc4"],
  shake: ["#4c0424", "#900c48", "#e02c7c", "#ff70b0", "#ffc8e0"],
}
const N = Object.fromEntries(Object.entries(NEON).map(([k, v]) => [k, pal.ramp(`n_${k}`, v)]))
const C = {
  black: P("black"),
  white: P("white"),
  body: pal.ramp("body", ["#06060c", "#10101c", "#1c1c2e", "#2a2a44", "#3c3c5c", "#565678"]),
  trim: pal.ramp("trim", ["#6c5000", "#b48c00", "#f0c800", "#fff070"]),
  lcd: pal.ramp("lcd", ["#1c2c10", "#2c4418", "#48682c", "#7c9c48", "#a8c068"]),
  metal: pal.ramp("mtl", ["#383c44", "#5c6470", "#8c96a0", "#bcc4cc", "#eef0f2"]),
  bgA: pal.ramp("bga", ["#080418", "#120a30", "#1c1048"]),
  star: pal.add("star", "#9c8cff"),
  red: pal.add("red", "#ff3020"),
  green: pal.add("green", "#30ff40"),
  ledOff: pal.add("ledoff", "#301010"),
  cord: pal.add("cord", "#202028"),
}
const UI = uiColors(pal)

// ---------------------------------------------------------------- layout
const HUD_H = 21
export const TOY_W = 150
export const TOY_H = 164
export const minSize = (cssW, cssH) => (cssW > cssH * 1.2 ? { minW: 290, minH: HUD_H + TOY_H + 6 } : { minW: 172, minH: HUD_H + TOY_H + 52 })

export const layout = (W, H) => {
  const land = W > H * 1.2
  const hud = { x: 0, y: 0, w: W, h: HUD_H }
  const pause = { x: W - 19, y: 3, w: 16, h: 15 }
  const room = { x: 0, y: HUD_H, w: W, h: H - HUD_H }
  // the toy: a fixed design, placed in the room (left of the call in landscape)
  const tw = TOY_W
  const th = TOY_H
  let toy
  let call
  if (land) {
    toy = { x: Math.max(4, Math.floor(room.w * 0.3 - tw / 2)), y: room.y + Math.floor((room.h - th) / 2), w: tw, h: th }
    call = { x: toy.x + tw + 6, y: room.y + 6, w: W - (toy.x + tw + 10), h: room.h - 12 }
  } else {
    const callH = 44
    toy = { x: Math.floor((W - tw) / 2), y: Math.max(room.y + callH + 2, room.y + Math.floor((room.h - th - callH) / 2) + callH), w: tw, h: th }
    call = { x: 4, y: toy.y - callH - 2, w: W - 8, h: callH }
  }
  return { W, H, land, hud, pause, room, toy, call }
}

// ---------------------------------------------------------------- the toy's parts
// positions inside the 150 x 164 toy
const PART = {
  slider: { x: 28, y: 17, w: 94, h: 14 },
  knob: { cx: 25, cy: 88, r: 12 },
  lever: { cx: 124, cy: 100, len: 26 },
  dome: { cx: 75, cy: 82, r: 20 },
  handle: { cx: 75, top: 134 },
  speaker: { x: 51, y: 118, w: 48, h: 11 },
  plate: { cx: 75, y: 37 },
}

const shaded = (b, cx, cy, rx, ry, ramp, { outline = C.black, lift = 0.5 } = {}) => {
  paint(b, cx - rx - 1, cy - ry - 1, rx * 2 + 3, ry * 2 + 3, (x, y) => {
    const nx = (x + 0.5 - cx) / rx
    const ny = (y + 0.5 - cy) / ry
    const d = nx * nx + ny * ny
    if (d > 1) return -1
    if (outline >= 0 && d > 0.86) return outline
    return rampAt(ramp, lift + 0.45 - nx * 0.28 - ny * 0.38 - d * 0.25, x, y)
  })
}

// part animation 0..1 (how far it's moved): the called part bobs; a right answer snaps it fully
const motion = (s, cmd) => {
  if (s.feedback && s.feedback.cmd === cmd) {
    const age = (s.now - s.feedback.at) / 1000
    if (age < 0.35) return Math.sin(Math.min(1, age / 0.35) * Math.PI)
  }
  if (s.cmd === cmd && !s.reduced && !s.over) return (Math.sin(s.t * 10) * 0.5 + 0.5) * 0.35
  return 0
}
const isCalled = (s, cmd) => s.cmd === cmd && !s.over
const glowOn = (s, cmd) => isCalled(s, cmd) && (s.reduced || Math.floor(s.t * 6) % 2 === 0)

// the shell (a rounded slab, lit at the top left, a yellow trim line, screws, the brand
// plate) never changes: drawn once into a sprite
let shell = null
const shellSprite = () => {
  if (shell) return shell
  const w = TOY_W
  const h = TOY_H
  const rad = 18
  const b = createBitmap(w, h)
  paint(b, 0, 0, w, h, (lx, ly) => {
    const cx = lx < rad ? rad : lx > w - 1 - rad ? w - 1 - rad : lx
    const cy = ly < rad ? rad : ly > h - 1 - rad ? h - 1 - rad : ly
    const d = Math.hypot(lx - cx, ly - cy)
    if (d > rad) return -1
    if (d > rad - 1.2) return C.black
    if (d > rad - 3.2) return rampAt(C.trim, 0.7 - ((lx + ly) / (w + h)) * 0.6, lx, ly)
    // a soft vertical sheen
    return rampAt(C.body, 0.62 - (ly / h) * 0.4 + (lx < 30 ? 0.1 : 0), lx, ly)
  })
  for (const [sx, sy] of [[10, 10], [w - 11, 10], [10, h - 11], [w - 11, h - 11]]) {
    disc(b, sx, sy, 2, C.metal[1])
    pset(b, sx - 1, sy - 1, C.metal[3])
    line(b, sx - 1, sy + 1, sx + 1, sy - 1, C.black)
  }
  rect(b, PART.plate.cx - 30, PART.plate.y, 60, 11, C.black)
  drawText(b, "ZAP-TRON", PART.plate.cx, PART.plate.y + 2, C.trim[3], { align: "center" })
  shell = { w, h, data: b.data }
  return shell
}
const drawBody = (b, x, y) => blit(b, shellSprite(), x, y)

const drawSlider = (b, x, y, s) => {
  const p = PART.slider
  const m = motion(s, "swipe")
  // the track
  rect(b, x + p.x, y + p.y + 4, p.w, 6, C.black)
  rect(b, x + p.x + 1, y + p.y + 5, p.w - 2, 4, C.body[0])
  // arrows when called
  if (glowOn(s, "swipe")) {
    drawText(b, "←", x + p.x - 9, y + p.y + 4, N.swipe[3])
    drawText(b, "→", x + p.x + p.w + 3, y + p.y + 4, N.swipe[3])
  }
  // the slider: slides right as it moves
  const kx = x + p.x + 4 + Math.round(m * (p.w - 28))
  rect(b, kx, y + p.y, 20, p.h, C.black)
  for (let k = 0; k < p.h - 2; k++) hline(b, kx + 1, y + p.y + 1 + k, 18, rampAt(N.swipe, 0.95 - k / p.h, kx, y + p.y + k))
  for (let k = 0; k < 4; k++) vline(b, kx + 5 + k * 3, y + p.y + 3, p.h - 6, N.swipe[0])
  if (glowOn(s, "swipe")) frame(b, kx - 2, y + p.y - 2, 24, p.h + 4, N.swipe[4])
}

const drawKnob = (b, x, y, s) => {
  const p = PART.knob
  const cx = x + p.cx
  const cy = y + p.cy
  const m = motion(s, "twist")
  // a skirt with tick marks
  disc(b, cx, cy, p.r + 4, C.black)
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2
    pset(b, cx + Math.cos(a) * (p.r + 3), cy + Math.sin(a) * (p.r + 3), C.metal[2])
  }
  shaded(b, cx, cy, p.r, p.r, N.twist)
  // knurls round the edge, turning with the knob
  const turn = m * 2.2
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + turn
    pset(b, cx + Math.cos(a) * (p.r - 2), cy + Math.sin(a) * (p.r - 2), N.twist[0])
  }
  // the pointer
  const a = -Math.PI / 2 + turn
  line(b, cx, cy, cx + Math.cos(a) * (p.r - 4), cy + Math.sin(a) * (p.r - 4), C.white, 2)
  if (glowOn(s, "twist")) {
    // a curved arrow round the top of the knob
    const rr = p.r + 7
    for (let k = 0; k <= 14; k++) {
      const aa = -Math.PI * 0.95 + (k / 14) * Math.PI * 0.8
      rect(b, Math.round(cx + Math.cos(aa) * rr), Math.round(cy + Math.sin(aa) * rr), 2, 2, N.twist[4])
    }
    const ea = -Math.PI * 0.15
    const ax = Math.round(cx + Math.cos(ea) * rr)
    const ay = Math.round(cy + Math.sin(ea) * rr)
    polygon(b, [[ax - 3, ay - 4], [ax + 4, ay - 1], [ax - 2, ay + 4]], N.twist[4])
  }
}

const drawLever = (b, x, y, s) => {
  const p = PART.lever
  const cx = x + p.cx
  const cy = y + p.cy
  const m = motion(s, "flick")
  // the hinge plate
  rect(b, cx - 9, cy - 4, 19, 12, C.black)
  rect(b, cx - 8, cy - 3, 17, 10, C.metal[1])
  hline(b, cx - 8, cy - 3, 17, C.metal[3])
  // the stick, swinging from leaning back to flicked forward (up)
  const a = -Math.PI / 2 - 0.55 + m * 1.0
  const ex = cx + Math.cos(a) * p.len
  const ey = cy + Math.sin(a) * p.len
  line(b, cx, cy, ex, ey, C.black, 5)
  line(b, cx, cy, ex, ey, C.metal[3], 3)
  line(b, cx - 1, cy, ex - 1, ey, C.metal[4], 1)
  shaded(b, ex, ey, 7, 7, N.flick)
  if (glowOn(s, "flick")) {
    ellipseOutline(b, ex, ey, 9.5, 9.5, N.flick[4])
    drawText(b, "↑", ex + 12, ey - 6, N.flick[4])
  }
}

const drawDome = (b, x, y, s) => {
  const p = PART.dome
  const cx = x + p.cx
  const cy = y + p.cy
  const m = motion(s, "tap")
  // the timer ring: 20 lights, lit for the time left
  const n = 20
  const lit = Math.ceil((s.frac ?? 0) * n)
  disc(b, cx, cy, p.r + 10, C.black)
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (k / n) * Math.PI * 2
    const lx = Math.round(cx + Math.cos(a) * (p.r + 6))
    const ly = Math.round(cy + Math.sin(a) * (p.r + 6))
    const on = k < lit
    const col = on ? ((s.frac ?? 0) < 0.3 ? C.red : N[s.cmd || "tap"][3]) : C.ledOff
    rect(b, lx - 1, ly - 1, 3, 3, col)
    if (on) pset(b, lx - 1, ly - 1, C.white)
  }
  // the dome, pushed down (smaller, darker) when tapped
  const press = Math.round(m * 3)
  shaded(b, cx, cy + press, p.r - press, p.r - press, N.tap, { lift: 0.55 - m * 0.3 })
  // a glint
  rect(b, cx - 10, cy - 12 + press, 5, 2, N.tap[4])
  pset(b, cx - 11, cy - 10 + press, N.tap[4])
  drawText(b, "TAP", cx, cy - 3 + press, N.tap[0], { align: "center" })
  if (glowOn(s, "tap")) ellipseOutline(b, cx, cy, p.r + 11.5, p.r + 11.5, N.tap[4])
}

const drawHandle = (b, x, y, s) => {
  const p = PART.handle
  const m = motion(s, "pull")
  const cx = x + p.cx
  const top = y + p.top
  const dy = Math.round(m * 14)
  // the cord out of a slot
  rect(b, cx - 8, top - 2, 17, 4, C.black)
  vline(b, cx, top, 10 + dy, C.cord)
  vline(b, cx + 1, top, 10 + dy, C.body[3])
  // the T-handle
  const hy = top + 10 + dy
  rect(b, cx - 15, hy, 31, 9, C.black)
  for (let k = 0; k < 7; k++) hline(b, cx - 14, hy + 1 + k, 29, rampAt(N.pull, 0.9 - k / 8, cx, hy + k))
  hline(b, cx - 13, hy + 2, 6, N.pull[4])
  if (glowOn(s, "pull")) {
    frame(b, cx - 17, hy - 2, 35, 13, N.pull[4])
    drawText(b, "↓", cx + 20, hy, N.pull[4])
  }
}

const drawSpeaker = (b, x, y, s) => {
  const p = PART.speaker
  const sx = x + p.x
  const sy = y + p.y
  rect(b, sx, sy, p.w, p.h, C.black)
  const on = glowOn(s, "shake")
  for (let r = 0; r < 2; r++) for (let k = 0; k < 11; k++) pset(b, sx + 3 + k * 4 + (r % 2) * 2, sy + 3 + r * 4, on ? N.shake[3] : C.body[3])
  if (s.shake !== false && on) drawText(b, "SHAKE!", sx + p.w / 2, sy + p.h + 2, N.shake[4], { align: "center" })
}

// ---------------------------------------------------------------- the call (LCD) and HUD
const LABEL = { tap: "TAP IT!", swipe: "SWIPE IT!", twist: "TWIST IT!", pull: "PULL IT!", flick: "FLICK IT!", shake: "SHAKE IT!" }
const KEY = { tap: "SPACE", swipe: "← / →", twist: "T", pull: "↓", flick: "↑", shake: "S" }

const drawCall = (b, L, s) => {
  const c = L.call
  // an LCD panel with a bezel
  bevel(b, c.x, c.y, c.w, c.h, { face: C.body[2], white: C.body[5], light: C.body[4], shadow: C.body[1], black: C.black }, { fill: true })
  rect(b, c.x + 4, c.y + 4, c.w - 8, c.h - 8, C.black)
  // the LCD's own dithered green glass
  paint(b, c.x + 5, c.y + 5, c.w - 10, c.h - 10, (x, y) => rampAt(C.lcd, 0.62 + (y - c.y) / c.h * 0.15, x, y))
  if (!s.cmd || s.over) {
    if (s.over) drawTitle(b, s.overText || "OOPS!", c.x + c.w / 2, c.y + c.h / 2 - 10, { scale: 3, ramp: [C.lcd[0]], align: "center" })
    return
  }
  const text = LABEL[s.cmd]
  let scale = 3
  while (scale > 1 && titleWidth(text, { scale }) > c.w - 24) scale--
  const lines = L.land && titleWidth(text, { scale }) > c.w - 24 ? text.split(" ") : [text]
  const y0 = c.y + Math.floor(c.h / 2) - Math.floor((7 * scale + (s.keys ? 9 : 0)) / 2)
  // LCD segments: dark text with a faint "ghost" shadow (the unlit segments of a cheap LCD)
  lines.forEach((ln, i) => {
    drawTitle(b, ln, c.x + c.w / 2 + 1, y0 + 1 + i * (8 * scale), { scale, ramp: [C.lcd[3]], align: "center" })
    drawTitle(b, ln, c.x + c.w / 2, y0 + i * (8 * scale), { scale, ramp: [C.lcd[0]], align: "center" })
  })
  if (s.keys) drawText(b, `KEY: ${KEY[s.cmd]}`, c.x + c.w / 2, y0 + 7 * scale + 3, C.lcd[1], { align: "center" })
}

const drawHud = (b, L, s) => {
  bevel(b, 0, 0, L.W, L.hud.h, UI)
  drawCounter(b, UI, 3, 2, String(Math.min(999, s.score)), { digits: 3, digitW: 6 })
  const right = L.pause.x - 3
  const best = drawCounter(b, UI, right, 2, s.best == null ? "---" : String(Math.min(999, s.best)), { digits: 3, digitW: 6, align: "right" })
  // the four beat lights
  const mid = (32 + best.x) / 2
  // (smaller, under the player's name in a party)
  const sz = s.who ? 5 : 11
  const ly0 = s.who ? 12 : 5
  for (let k = 0; k < 4; k++) {
    const lx = Math.round(mid - (s.who ? 13 : 26) + k * (sz + 3))
    const on = k <= (s.ticks ?? -1) && !s.over
    rect(b, lx, ly0, sz, sz, C.black)
    rect(b, lx + 1, ly0 + 1, sz - 2, sz - 2, on ? (k === 3 ? C.red : C.green) : C.ledOff)
    if (on && sz > 6) rect(b, lx + 2, ly0 + 2, 2, 2, C.white)
  }
  if (s.who) drawText(b, s.who, mid, 2, C.black, { align: "center" })
  bevel(b, L.pause.x, L.pause.y, L.pause.w, L.pause.h, UI, { pressed: s.pressed === "pause" })
  const o = s.pressed === "pause" ? 1 : 0
  rect(b, L.pause.x + 5 + o, L.pause.y + 4 + o, 2, 7, C.black)
  rect(b, L.pause.x + 9 + o, L.pause.y + 4 + o, 2, 7, C.black)
}

// a starfield-ish backdrop: deep blue, cached per size; a few stars twinkle on top
const spaceCache = new Map()
const space = (b, y0, t, reduced) => {
  const key = `${b.w}x${b.h}|${y0}`
  let e = spaceCache.get(key)
  if (!e) {
    if (spaceCache.size > 6) spaceCache.clear()
    const bg = createBitmap(b.w, b.h)
    const stars = []
    paint(bg, 0, y0, b.w, b.h - y0, (x, y) => {
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0
      if (h % 97 === 0) {
        stars.push([x, y, h % 7])
        return C.star
      }
      return rampAt(C.bgA, 0.25 + (y / b.h) * 0.6, x, y)
    })
    e = { bg, stars }
    spaceCache.set(key, e)
  }
  b.data.set(e.bg.data)
  if (!reduced) for (const [x, y, ph] of e.stars) if (Math.floor(t * 3 + ph) % 3 === 0) b.data[y * b.w + x] = C.white
}

export const drawToy = (b, x, y, s) => {
  drawBody(b, x, y)
  drawSlider(b, x, y, s)
  drawKnob(b, x, y, s)
  drawLever(b, x, y, s)
  drawDome(b, x, y, s)
  drawSpeaker(b, x, y, s)
  drawHandle(b, x, y, s)
}

export const drawZap = (b, L, s) => {
  space(b, L.hud.h, s.t, s.reduced)
  // feedback: a green or red frame round the screen for a moment
  const age = s.feedback ? (s.now - s.feedback.at) / 1000 : 99
  if (age < 0.3) {
    const c = s.feedback.ok ? C.green : C.red
    for (let k = 0; k < (s.feedback.ok ? 3 : 6); k++) frame(b, k, L.hud.h + k, L.W - k * 2, L.H - L.hud.h - k * 2, c)
  }
  // shake wiggles the toy (not with Reduce Motion)
  const wig = s.cmd === "shake" && !s.reduced && !s.over ? (Math.floor(s.t * 20) % 2 ? 2 : -2) : 0
  drawToy(b, L.toy.x + wig, L.toy.y, s)
  drawCall(b, L, s)
  drawHud(b, L, s)
}

// ---------------------------------------------------------------- the title banner
const DEMO = ["tap", "swipe", "twist", "pull", "flick"]
export const drawBanner = (b, t, { reduced = false } = {}) => {
  space(b, 0, t, reduced)
  const cmd = DEMO[Math.floor(t / 1.1) % DEMO.length]
  const s = { cmd, frac: 1 - (t % 1.1) / 1.1, t, now: t * 1000, reduced, feedback: { cmd, ok: true, at: (Math.floor(t / 1.1) * 1.1 + 0.55) * 1000 } }
  // a close-up of the toy (the dome and the lever), cropped by the banner's left edge
  const ox = b.w >= 300 ? 4 : -42
  drawToy(b, ox, Math.round(b.h / 2) - PART.dome.cy, s)
  const x0 = ox + TOY_W + 4
  const room = b.w - x0
  const lx = x0 + room / 2
  let scale = 4
  while (scale > 1 && titleWidth("ZAP IT!", { scale }) > room - 8) scale--
  const wob = reduced ? 0 : Math.round(Math.sin(t * 6) * 1)
  drawTitle(b, "ZAP IT!", lx, 14 + wob, { scale, ramp: N.tap.slice(1), outline: C.black, shadow: N.twist[1], depth: 3, align: "center" })
  const cs = textWidth(LABEL[cmd], { scale: 2 }) <= room - 6 ? 2 : 1
  drawText(b, LABEL[cmd], lx, 14 + 7 * scale + 12, N[cmd][3], { align: "center", outline: C.black, scale: cs })
}
export { LABEL }
