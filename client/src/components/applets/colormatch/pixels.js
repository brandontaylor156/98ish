// Color Match's pixel picture (pure; Node previews draw exactly this). A mid-90s edutainment
// look: a scrolling patterned backdrop, words in a chunky pixel font on index cards, big
// bevelled YES / NO buttons, red LED counters, and "Professor Hoot", an owl in a mortarboard
// who cheers your streaks. All art is original.
//
//   minSize(cssW, cssH) / layout(W, H, { mode, tiles, online })
//   drawBoard(b, L, s)  s = { mode, q, run, left, total, countdown, flash, standings, t, now,
//                             pressed, reduced, keys, paused }
//   drawBanner(b, t)

import {
  UI_COLORS,
  bevel,
  blit,
  createBitmap,
  createPalette,
  drawCounter,
  drawMeter,
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
  sprite,
  textWidth,
  threshold,
  titleWidth,
  uiColors,
  vline,
  wrapText,
  hexToRgb,
  rgbToHex,
} from "../../../utils/retro/index.js"
import { COLORS, MAX_MULT, multFor } from "./rules.js"

export const pal = createPalette(UI_COLORS)
const P = (n) => pal.idx(n)
const shade = (hex, k) => rgbToHex(...hexToRgb(hex).map((v) => (k < 1 ? v * k : v + (255 - v) * (k - 1))))
// every game colour, plus a darker (outline) and a lighter (bevel) shade
const INK = {}
for (const c of COLORS) {
  INK[c.id] = { base: pal.add(`c_${c.id}`, c.hex), dark: pal.add(`cd_${c.id}`, c.id === "black" ? "#5a5a5a" : shade(c.hex, 0.45)), light: pal.add(`cl_${c.id}`, shade(c.hex, 1.45)), deep: pal.add(`cx_${c.id}`, shade(c.hex, 0.7)) }
}
const C = {
  black: P("black"),
  white: P("white"),
  cream: pal.add("cream", "#fff6dc"),
  cream2: pal.add("cream2", "#f0e2bc"),
  rule: pal.add("rule", "#9cc0ec"),
  margin: pal.add("margin", "#ec8c8c"),
  tabY: pal.add("tabY", "#ffe060"),
  tabP: pal.add("tabP", "#ff9ccc"),
  navy: P("navy"),
  yes: pal.ramp("yes", ["#04400c", "#0c7a1c", "#1cae30", "#5cdc5c", "#b4f8a4"]),
  no: pal.ramp("no", ["#4c0404", "#900c0c", "#d42020", "#ff6a5c", "#ffc0b4"]),
  bgA: pal.ramp("bga", ["#24104c", "#3a1a78", "#5428a4"]),
  bgB: pal.ramp("bgb", ["#0c5c78", "#1890a8", "#40c0cc"]),
  bgDot: pal.add("bgdot", "#ffd44c"),
  bgDot2: pal.add("bgdot2", "#ff6cb4"),
  owl: pal.ramp("owl", ["#2c1406", "#58300e", "#86501c", "#b07834", "#d8a45c"]),
  tan: pal.ramp("tan", ["#c89c64", "#ecd09c", "#fff0cc"]),
  beak: pal.ramp("bk", ["#b46400", "#ffb000", "#ffe050"]),
  cap: pal.ramp("cap", ["#080c20", "#1c2448", "#343e70"]),
  tassel: pal.add("tsl", "#ffd000"),
  star: pal.add("star", "#fff07c"),
  tear: pal.add("tear", "#7cc8ff"),
  pip: pal.add("pip", "#30ff40"),
  pipOff: pal.add("pipOff", "#0c3010"),
}
const UI = uiColors(pal)

// ---------------------------------------------------------------- layout
const HUD_H = 21
export const minSize = (cssW, cssH) => (cssW > cssH * 1.2 ? { minW: 300, minH: 176 } : { minW: 200, minH: 250 })

export const tileGrid = (n) => (n <= 4 ? [2, 2] : n <= 6 ? [3, 2] : [3, 3])

export const layout = (W, H, { mode = "classic", tiles = 4, online = false } = {}) => {
  const land = W > H * 1.2
  const hud = { x: 0, y: 0, w: W, h: HUD_H }
  const timebar = { x: 0, y: HUD_H, w: W, h: 6 }
  let y = HUD_H + 6
  const standings = online ? { x: 0, y, w: W, h: 11 } : null
  if (online) y += 11
  const pause = { x: W - 19, y: 3, w: 16, h: 15 }
  const avail = { x: 0, y, w: W, h: H - y }
  const bw = Math.min(W - 12, land ? 300 : 280)
  const bx = Math.floor((W - bw) / 2)
  if (mode === "swatch") {
    const [cols, rows] = tileGrid(tiles)
    const promptH = 12
    const wordH = land ? 30 : 38
    const mascotH = land ? 0 : 44
    const gap = 6
    const left = avail.h - promptH - wordH - gap * 3 - mascotH
    const ts = Math.max(20, Math.min(Math.floor((Math.min(bw, land ? 220 : bw) - (cols - 1) * 4) / cols), Math.floor((left - (rows - 1) * 4) / rows)))
    const gw = cols * ts + (cols - 1) * 4
    const gh = rows * ts + (rows - 1) * 4
    const blockH = promptH + wordH + gap * 2 + gh
    let top = avail.y + Math.max(3, Math.floor((avail.h - mascotH - blockH) / 2))
    const prompt = { x: bx, y: top, w: bw, h: promptH }
    top += promptH + gap
    const word = { x: Math.floor((W - Math.min(bw, 200)) / 2), y: top, w: Math.min(bw, 200), h: wordH }
    top += wordH + gap
    const gx = Math.floor((W - gw) / 2)
    const tileBoxes = Array.from({ length: tiles }, (_, i) => ({ x: gx + (i % cols) * (ts + 4), y: top + Math.floor(i / cols) * (ts + 4), w: ts, h: ts }))
    const mascot = mascotH ? { x: bx, y: Math.min(H - mascotH, top + gh + 4), w: bw, h: mascotH } : land ? { x: 2, y: H - 40, w: Math.max(0, gx - 4), h: 40 } : null
    return { W, H, land, mode, hud, timebar, standings, pause, prompt, word, tiles: tileBoxes, mascot }
  }
  const promptH = 12
  const labelH = 10
  const gap = land ? 4 : 8
  const mascotH = land ? 0 : 58
  const room = avail.h - mascotH - promptH - labelH - gap * 2 - 6
  const cardH = land ? Math.max(36, Math.min(56, Math.floor(room * 0.55))) : Math.max(58, Math.min(112, Math.floor(room * 0.55)))
  const ansH = land ? Math.max(28, Math.min(46, Math.floor(room * 0.42))) : Math.max(46, Math.min(86, Math.floor(room * 0.4)))
  const blockH = promptH + gap + labelH + cardH + gap + ansH + mascotH
  let top = avail.y + Math.max(3, Math.floor((avail.h - blockH) / 2))
  const prompt = { x: bx, y: top, w: bw, h: promptH }
  top += promptH + gap + labelH
  const cw = Math.floor((bw - 6) / 2)
  const cards = [
    { x: bx, y: top, w: cw, h: cardH },
    { x: bx + bw - cw, y: top, w: cw, h: cardH },
  ]
  top += cardH + gap
  const answers = { no: { x: bx, y: top, w: cw, h: ansH }, yes: { x: bx + bw - cw, y: top, w: cw, h: ansH } }
  const mascot = mascotH ? { x: bx, y: top + ansH + 4, w: bw, h: mascotH - 4 } : W - bw >= 70 ? { x: 2, y: H - 40, w: bx - 4, h: 40 } : null
  return { W, H, land, mode, hud, timebar, standings, pause, prompt, cards, answers, mascot }
}

// ---------------------------------------------------------------- the backdrop
// a 16 x 16 tile of shapes on a two-tone dithered ground, scrolled diagonally
const TILE = (() => {
  const t = new Uint8Array(32 * 32)
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      // diagonal bands, dithered between two purples
      const band = ((x + y) >> 3) % 2
      t[y * 32 + x] = band ? C.bgA[1] : 0.5 > threshold(x, y) ? C.bgA[1] : C.bgA[0]
    }
  }
  // little shapes: a star, a ring, a triangle, a plus (one each per tile)
  const put = (x, y, c) => (t[(y & 31) * 32 + (x & 31)] = c)
  for (const [dx, dy] of [[0, -2], [0, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [0, 1], [-1, 2], [1, 2]]) put(6 + dx, 6 + dy, C.bgDot)
  for (let a = 0; a < 12; a++) put(Math.round(22 + Math.cos((a / 12) * 6.28) * 3), Math.round(9 + Math.sin((a / 12) * 6.28) * 3), C.bgB[2])
  for (let k = 0; k < 5; k++) for (let j = 0; j <= k; j++) put(8 - Math.floor(k / 2) + j, 20 + k, C.bgDot2)
  for (let k = -2; k <= 2; k++) (put(24 + k, 24, C.bgB[1]), put(24, 24 + k, C.bgB[1]))
  return t
})()
const backdrop = (b, t, reduced, y0 = 0) => {
  const o = reduced ? 0 : Math.floor(t * 8)
  const d = b.data
  for (let y = y0; y < b.h; y++) {
    const row = y * b.w
    const ty = ((y + o) & 31) * 32
    for (let x = 0; x < b.w; x++) d[row + x] = TILE[ty + ((x + o) & 31)]
  }
}

// a coloured 98 bevel (a YES / NO button, a swatch tile)
const colorBevel = (b, x, y, w, h, ramp, pressed) => {
  const [k, d, f, l, hi] = ramp
  bevel(b, x, y, w, h, { face: f, white: hi, light: l, shadow: d, black: k }, { pressed })
}

// ---------------------------------------------------------------- the owl
// Professor Hoot, drawn from shapes: mood calm | happy | wow | sad; blinks now and then
export const drawOwl = (b, cx, by, mood = "calm", t = 0, reduced = false) => {
  const hop = mood === "wow" && !reduced ? Math.round(Math.abs(Math.sin(t * 9)) * -4) : 0
  const y = by + hop
  // feet
  rect(b, cx - 6, y - 2, 4, 2, C.beak[0])
  rect(b, cx + 2, y - 2, 4, 2, C.beak[0])
  // body: a brown egg, lit from the top left
  const bcx = cx
  const bcy = y - 14
  paint(b, bcx - 12, bcy - 13, 25, 26, (px, py) => {
    const nx = (px + 0.5 - bcx) / 11
    const ny = (py + 0.5 - bcy) / 12.5
    const dd = nx * nx + ny * ny
    if (dd > 1) return -1
    if (dd > 0.84) return C.owl[0]
    return rampAt(C.owl, 0.85 - nx * 0.3 - ny * 0.35, px, py)
  })
  // the belly: tan with little feather v's
  paint(b, bcx - 7, bcy - 4, 15, 15, (px, py) => {
    const nx = (px + 0.5 - bcx) / 6.5
    const ny = (py + 0.5 - (bcy + 3)) / 7.5
    if (nx * nx + ny * ny > 1) return -1
    if ((px - bcx + 20) % 4 === 0 && (py - bcy) % 3 === 0) return C.tan[0]
    return rampAt(C.tan, 0.8 - ny * 0.3, px, py)
  })
  // wings: down, or up and out when happy
  const up = mood === "happy" || mood === "wow"
  for (const s of [-1, 1]) {
    if (up) {
      polygon(b, [[bcx + s * 9, bcy - 2], [bcx + s * 17, bcy - 12], [bcx + s * 15, bcy + 1], [bcx + s * 10, bcy + 4]], C.owl[0])
      polygon(b, [[bcx + s * 10, bcy - 1], [bcx + s * 15, bcy - 9], [bcx + s * 14, bcy], [bcx + s * 10, bcy + 2]], C.owl[2])
    } else {
      ellipse(b, bcx + s * 10, bcy + 3 + (mood === "sad" ? 2 : 0), 3.5, 8, C.owl[0])
      ellipse(b, bcx + s * 10, bcy + 3 + (mood === "sad" ? 2 : 0), 2.4, 7, C.owl[1])
    }
  }
  // eyes: big discs with a dark rim; pupils look at the cards (up), down when sad
  const blink = !reduced && mood === "calm" && t % 3.2 < 0.12
  for (const s of [-1, 1]) {
    const ex = bcx + s * 5
    const ey = bcy - 6
    ellipse(b, ex, ey, 4.6, 4.6, C.tan[2])
    ellipseOutline(b, ex, ey, 4.6, 4.6, C.owl[0])
    if (blink) hline(b, ex - 3, ey, 6, C.owl[0])
    else if (mood === "happy" || mood === "wow") {
      // ^ ^ eyes
      line(b, ex - 3, ey + 1, ex, ey - 2, C.black)
      line(b, ex, ey - 2, ex + 2, ey + 1, C.black)
    } else {
      const py = mood === "sad" ? ey + 1 : ey - 1
      rect(b, ex - 1, py - 1, 3, 3, C.black)
      pset(b, ex - 1, py - 1, C.white)
    }
  }
  // brows when sad
  if (mood === "sad") {
    line(b, bcx - 9, bcy - 11, bcx - 3, bcy - 13, C.owl[0])
    line(b, bcx + 3, bcy - 13, bcx + 9, bcy - 11, C.owl[0])
    // a tear
    pset(b, bcx - 9, bcy - 1, C.tear)
    rect(b, bcx - 10, bcy, 2, 2, C.tear)
  }
  // the beak
  polygon(b, [[bcx - 2, bcy - 3], [bcx + 3, bcy - 3], [bcx + 0.5, bcy + 2]], C.beak[1])
  pset(b, bcx - 1, bcy - 3, C.beak[2])
  // the mortarboard: a flat diamond on a band, and a tassel
  rect(b, bcx - 6, bcy - 15, 13, 3, C.cap[1])
  polygon(b, [[bcx - 13, bcy - 17], [bcx + 1, bcy - 22], [bcx + 14, bcy - 17], [bcx, bcy - 12]], C.cap[2])
  polygon(b, [[bcx - 11, bcy - 17], [bcx + 1, bcy - 21], [bcx + 12, bcy - 17], [bcx, bcy - 13]], C.cap[1])
  const swing = reduced ? 0 : Math.round(Math.sin(t * 3))
  vline(b, bcx + 10 + swing, bcy - 17, 6, C.tassel)
  rect(b, bcx + 9 + swing, bcy - 11, 3, 3, C.tassel)
  // stars round a delighted owl
  if (mood === "wow") {
    for (let k = 0; k < 4; k++) {
      const a = t * 3 + k * 1.57
      const sx = Math.round(bcx + Math.cos(a) * 19)
      const sy = Math.round(bcy - 6 + Math.sin(a) * 9)
      pset(b, sx, sy, C.star)
      pset(b, sx - 1, sy, C.star)
      pset(b, sx + 1, sy, C.star)
      pset(b, sx, sy - 1, C.star)
      pset(b, sx, sy + 1, C.star)
    }
  }
}

// a comic speech bubble with a tail toward (tx, ty)
const bubble = (b, x, y, text, tx, ty) => {
  const lines = wrapText(text, 96)
  const w = Math.max(...lines.map((l) => textWidth(l))) + 8
  const h = lines.length * 9 + 5
  polygon(b, [[x + 6, y + h - 1], [tx, ty], [x + 14, y + h - 1]], C.black)
  polygon(b, [[x + 7, y + h - 2], [tx + 1, ty - 2], [x + 12, y + h - 2]], C.white)
  rect(b, x, y, w, h, C.black)
  rect(b, x + 1, y + 1, w - 2, h - 2, C.white)
  lines.forEach((l, i) => drawText(b, l, x + 4, y + 3 + i * 9, C.black))
  return w
}

// ---------------------------------------------------------------- cards and words
// the biggest pixel scale (1-3) a word fits a box at
const wordScale = (text, w, max = 3) => {
  for (let s = max; s >= 1; s--) if (titleWidth(text, { scale: s }) <= w - 8) return s
  return 1
}
const wordAt = (b, text, cx, cy, color, maxW, maxH) => {
  const s = Math.min(wordScale(text, maxW), Math.max(1, Math.floor((maxH - 4) / 8)))
  // the ink colour, its own darker shade as an outline, a soft drop shadow
  drawTitle(b, text, cx, cy - Math.floor((7 * s) / 2), { scale: s, ramp: [INK[color].base], outline: INK[color].dark, shadow: C.cream2, depth: 1, align: "center" })
}

const card = (b, x, y, w, h, label, tabColor) => {
  // the tab
  if (label) {
    const tw = textWidth(label) + 8
    rect(b, x + 4, y - 10, tw, 11, C.black)
    rect(b, x + 5, y - 9, tw - 2, 10, tabColor)
    drawText(b, label, x + 8, y - 8, C.black)
  }
  // an index card: cream, blue rules, a red margin, a hard shadow
  rect(b, x + 3, y + 3, w, h, C.bgA[0])
  rect(b, x, y, w, h, C.black)
  rect(b, x + 1, y + 1, w - 2, h - 2, C.cream)
  for (let ry = y + 10; ry < y + h - 2; ry += 7) hline(b, x + 2, ry, w - 4, C.rule)
  vline(b, x + 9, y + 1, h - 2, C.margin)
}

// ---------------------------------------------------------------- the HUD
const drawHud = (b, L, s) => {
  bevel(b, 0, 0, L.W, L.hud.h, UI)
  const sc = drawCounter(b, UI, 3, 2, String(Math.min(99999, Math.round(s.run.score))), { digits: 5, digitW: 6 })
  // multiplier and the 4 pips toward the next one
  const mult = multFor(s.run.streak)
  const pips = mult >= MAX_MULT ? 4 : s.run.streak % 4
  let x = sc.x + sc.w + 5
  const mw = textWidth(`x${mult}`, { scale: 2 }) + 6
  rect(b, x, 2, mw, 17, UI.shadow)
  rect(b, x + 1, 3, mw - 1, 16, UI.white)
  rect(b, x + 1, 3, mw - 2, 15, C.black)
  drawText(b, `x${mult}`, x + 3, 4, mult >= 5 ? C.bgDot2 : mult >= 3 ? C.bgDot : mult >= 2 ? C.yes[3] : UI.shadow, { scale: 2 })
  x += mw + 3
  for (let k = 0; k < 4; k++) {
    rect(b, x + k * 6, 7, 5, 6, C.black)
    rect(b, x + k * 6 + 1, 8, 3, 4, k < pips ? C.pip : C.pipOff)
    if (k < pips) pset(b, x + k * 6 + 1, 8, C.white)
  }
  // the clock: blinks in the last five seconds
  const secs = Math.max(0, Math.ceil(s.left))
  const txt = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`
  const low = s.left <= 5 && s.countdown <= 0
  const show = !low || s.reduced || Math.floor(s.now / 250) % 2 === 0
  const right = L.pause ? L.pause.x - 3 : L.W - 3
  drawCounter(b, UI, right, 2, show ? txt : "    ", { digits: 4, digitW: 6, align: "right" })
  if (L.pause && s.onPause !== false) {
    bevel(b, L.pause.x, L.pause.y, L.pause.w, L.pause.h, UI, { pressed: s.pressed === "pause" })
    const o = s.pressed === "pause" ? 1 : 0
    rect(b, L.pause.x + 5 + o, L.pause.y + 4 + o, 2, 7, C.black)
    rect(b, L.pause.x + 9 + o, L.pause.y + 4 + o, 2, 7, C.black)
  }
  // the time bar
  drawMeter(b, UI, L.timebar.x, L.timebar.y, L.timebar.w, L.timebar.h, Math.max(0, Math.min(1, s.left / s.total)), { on: low ? P("ledOn") : C.rule, off: C.cap[0], segments: 30 })
}

// ---------------------------------------------------------------- a frame
const PRAISE = ["GOOD!", "NICE!", "RIGHT!", "YES!", "SMART!", "GREAT!"]
const OOPS = ["OOPS!", "NOPE!", "UH-OH!", "TRICKY!"]
export const owlMood = (s) => {
  const age = s.flash ? (s.now - s.flash.at) / 1000 : 99
  if (s.countdown > 0) return { mood: "calm", say: "GET READY..." }
  if (age < 0.9 && s.flash && !s.flash.right) return { mood: "sad", say: OOPS[s.run.i % OOPS.length] }
  if (age < 0.9 && s.flash?.level) return { mood: "wow", say: `x${multFor(s.run.streak)}! WOW!` }
  if (age < 0.6 && s.flash?.right) return { mood: "happy", say: PRAISE[s.run.i % PRAISE.length] }
  if (multFor(s.run.streak) >= MAX_MULT) return { mood: "wow", say: null }
  if (s.run.streak >= 4) return { mood: "happy", say: null }
  if (s.run.i === 0) return { mood: "calm", say: s.mode === "swatch" ? "TAP THE COLOUR THE WORD SAYS!" : "MEANING LEFT, INK RIGHT!" }
  return { mood: "calm", say: null }
}

export const drawBoard = (b, L, s) => {
  const { t, reduced } = s
  backdrop(b, t, reduced, L.timebar.y + L.timebar.h)
  drawHud(b, L, s)
  if (L.standings && s.standings) {
    rect(b, 0, L.standings.y, L.W, L.standings.h, C.black)
    let x = 3
    for (const p of s.standings) {
      const txt = `${p.name.slice(0, 10)}${p.bot ? "*" : ""} ${p.score}`
      drawText(b, txt, x, L.standings.y + 2, p.you ? C.bgDot : C.white)
      x += textWidth(txt) + 8
      if (x > L.W - 10) break
    }
  }
  // the owl (behind any panels)
  if (L.mascot && L.mascot.w >= 30) {
    const { mood, say } = owlMood(s)
    const ox = L.mascot.x + 18
    const oy = L.mascot.y + Math.min(L.mascot.h, 50) - 2
    drawOwl(b, ox, oy, mood, t, reduced)
    if (say && !L.land && L.mascot.w > 120) bubble(b, ox + 22, Math.max(L.mascot.y, oy - 44), say, ox + 10, oy - 30)
  }
  if (s.countdown > 0) {
    const n = Math.ceil(s.countdown)
    const fr = s.countdown - Math.floor(s.countdown)
    const scale = reduced ? 6 : fr > 0.75 ? 8 : 6
    const cy = Math.floor((L.timebar.y + (L.mascot && !L.land ? L.mascot.y : L.H)) / 2)
    drawTitle(b, String(n), L.W / 2, cy - scale * 3.5, { scale, ramp: C.yes.slice(1), outline: C.black, shadow: C.bgA[0], depth: 3, align: "center" })
    return
  }
  if (s.paused || !s.q) return
  const flashAge = s.flash ? (s.now - s.flash.at) / 1000 : 99
  const fl = flashAge < 0.35 ? (s.flash.right ? C.yes[3] : C.no[3]) : -1
  if (s.mode === "swatch") return drawSwatch(b, L, s, fl, flashAge)
  // the question strip
  rect(b, L.prompt.x, L.prompt.y, L.prompt.w, L.prompt.h, C.navy)
  drawText(b, L.prompt.w >= 196 ? "DOES THE MEANING MATCH THE INK?" : "MEANING = INK?", L.W / 2, L.prompt.y + 2, C.white, { align: "center" })
  const [cl, cr] = L.cards
  card(b, cl.x, cl.y, cl.w, cl.h, "MEANING", C.tabY)
  card(b, cr.x, cr.y, cr.w, cr.h, "INK", C.tabP)
  const name = (id) => COLORS.find((c) => c.id === id).name
  wordAt(b, name(s.q.left.word), cl.x + cl.w / 2 + 4, cl.y + cl.h / 2, s.q.left.ink, cl.w - 10, cl.h)
  wordAt(b, name(s.q.right.word), cr.x + cr.w / 2 + 4, cr.y + cr.h / 2, s.q.right.ink, cr.w - 10, cr.h)
  if (fl >= 0) {
    for (const c of L.cards) (frame(b, c.x - 2, c.y - 2, c.w + 4, c.h + 4, fl), frame(b, c.x - 3, c.y - 3, c.w + 6, c.h + 6, fl))
  }
  // YES / NO
  for (const [key, box, ramp, label] of [["no", L.answers.no, C.no, "NO"], ["yes", L.answers.yes, C.yes, "YES"]]) {
    const down = s.pressed === key
    colorBevel(b, box.x, box.y, box.w, box.h, ramp, down)
    const o = down ? 1 : 0
    const sc = box.h >= 40 ? 3 : 2
    const tw = titleWidth(label, { scale: sc })
    const iconW = sc * 5 + 4 + sc * 2
    const x0 = Math.round(box.x + (box.w - tw - iconW) / 2) + o
    const ty = box.y + Math.floor((box.h - 7 * sc) / 2) + o
    // a big check or cross drawn in thick pixels
    const ix = x0
    const iy = ty
    const sz = sc * 5
    if (key === "yes") {
      for (let k = 0; k < sc + 1; k++) {
        line(b, ix, iy + sz * 0.55 + k, ix + sz * 0.35, iy + sz * 0.9 + k, C.white)
        line(b, ix + sz * 0.35, iy + sz * 0.9 + k, ix + sz, iy + k, C.white)
      }
    } else {
      for (let k = 0; k < sc + 1; k++) {
        line(b, ix + k, iy, ix + sz + k, iy + sz, C.white)
        line(b, ix + sz + k, iy, ix + k, iy + sz, C.white)
      }
    }
    drawTitle(b, label, x0 + iconW, ty, { scale: sc, ramp: [C.white], outline: ramp[0], shadow: -1 })
    if (s.keys) drawText(b, key === "yes" ? "J / →" : "F / ←", box.x + box.w / 2 + o, box.y + box.h - 9 + o, ramp[4], { align: "center" })
  }
  // a big check / cross over the cards for a moment
  if (flashAge < 0.35 && !reduced) {
    const cx = L.W / 2
    const cy = L.cards[0].y + L.cards[0].h / 2
    drawText(b, s.flash.right ? "✓" : "✗", cx, cy - 10, s.flash.right ? C.yes[3] : C.no[3], { scale: 3, align: "center", outline: C.black })
  }
}

const drawSwatch = (b, L, s, fl, flashAge) => {
  rect(b, L.prompt.x, L.prompt.y, L.prompt.w, L.prompt.h, C.navy)
  drawText(b, L.prompt.w >= 180 ? "TAP THE COLOUR THE WORD SAYS" : "TAP WHAT IT SAYS", L.W / 2, L.prompt.y + 2, C.white, { align: "center" })
  const w = L.word
  card(b, w.x, w.y, w.w, w.h, null, 0)
  const name = COLORS.find((c) => c.id === s.q.word).name
  wordAt(b, name, w.x + w.w / 2 + 4, w.y + w.h / 2, s.q.ink, w.w - 12, w.h)
  if (fl >= 0) (frame(b, w.x - 2, w.y - 2, w.w + 4, w.h + 4, fl), frame(b, w.x - 3, w.y - 3, w.w + 6, w.h + 6, fl))
  s.q.tiles.forEach((c, i) => {
    const t = L.tiles[i]
    if (!t) return
    const ink = INK[c]
    const down = s.pressed === `tile${i}`
    colorBevel(b, t.x, t.y, t.w, t.h, [C.black, ink.dark, ink.base, ink.light, C.white], down)
    if (s.keys) drawText(b, String(i + 1), t.x + 4, t.y + 3, c === "yellow" || c === "pink" ? C.black : C.white)
  })
  if (flashAge < 0.35 && !s.reduced) drawText(b, s.flash.right ? "✓" : "✗", L.W / 2, w.y + w.h / 2 - 10, s.flash.right ? C.yes[3] : C.no[3], { scale: 3, align: "center", outline: C.black })
}

// ---------------------------------------------------------------- the title banner
const LOGO = [["C", "red"], ["O", "blue"], ["L", "green"], ["O", "yellow"], ["R", "purple"], [" ", "black"], ["M", "orange"], ["A", "pink"], ["T", "red"], ["C", "blue"], ["H", "green"]]
export const drawBanner = (b, t, { reduced = false } = {}) => {
  backdrop(b, t, reduced)
  const scale = b.w >= 300 ? 4 : 3
  const total = titleWidth(LOGO.map(([l]) => l).join(""), { scale })
  let x = Math.round((b.w - total) / 2)
  LOGO.forEach(([l, c], i) => {
    const bob = reduced ? 0 : Math.round(Math.sin(t * 4 + i * 0.7) * 1.5)
    if (l !== " ") drawTitle(b, l, x, 8 + bob, { scale, ramp: [INK[c].light, INK[c].base], outline: C.black, shadow: C.black, depth: 2, from: 1, to: 0 })
    x += titleWidth(l, { scale }) + scale
  })
  drawText(b, "READ THE WORD. TRUST THE INK!", b.w / 2, 8 + 7 * scale + 6, C.white, { align: "center", outline: C.black })
  // the owl and a word card that keeps changing its ink
  const k = Math.floor(t / 1.2)
  const word = COLORS[k % 6]
  const ink = COLORS[(k * 4 + 1) % 6]
  const cw = 70
  const cx = Math.round(b.w / 2 - cw / 2 + 16)
  const cy = b.h - 30
  card(b, cx, cy, cw, 24, null, 0)
  wordAt(b, word.name, cx + cw / 2 + 4, cy + 12, ink.id, cw - 10, 24)
  drawOwl(b, cx - 20, b.h - 2, k % 3 === 2 ? "happy" : "calm", t, reduced)
}

export const inkHex = (id) => COLORS.find((c) => c.id === id)?.hex
