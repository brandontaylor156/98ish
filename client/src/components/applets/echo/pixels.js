// Echo Pads' pixel picture (pure; Node previews draw exactly this): an original electronic
// memory toy, drawn the way a 1995 CD-ROM game would: a moulded charcoal case on a wooden desk,
// four pads that sit dark until lit (then bright, with a glow spilling onto the case), a
// brushed-silver hub with a chunky logo and a red LED window, screws and a power light. Pad
// symbols (triangle, circle, square, star) for colour-blind players. All art is original.
//
//   minSize(cssW, cssH, online) / layout(W, H, { online })
//   drawToy(b, L, s)   s = { lit, pressed, symbols, center (LED text), status, steps, best,
//                            wait (0..1 or null), players (online), t, reduced, over }
//   drawBanner(b, t)

import {
  UI_COLORS,
  bevel,
  blit,
  createBitmap,
  createPalette,
  disc,
  drawCounter,
  drawLed,
  drawMeter,
  drawText,
  drawTitle,
  ellipse,
  ellipseOutline,
  hline,
  ledWidth,
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
  wrapText,
} from "../../../utils/retro/index.js"

export const pal = createPalette(UI_COLORS)
const P = (n) => pal.idx(n)
// each pad: an unlit ramp (dark plastic) and a lit ramp (glowing), dark -> light
const PAD = [
  { off: ["#021a08", "#06300e", "#0c4a18", "#146424", "#207c30"], on: ["#18a03c", "#2cd04c", "#68f070", "#b4ffb0", "#ffffff"], glow: "#58ff70" },
  { off: ["#200404", "#3c0808", "#5a0e0e", "#781414", "#941c1c"], on: ["#d42020", "#ff4434", "#ff8070", "#ffc4b8", "#ffffff"], glow: "#ff5c48" },
  { off: ["#1e1802", "#3a2e04", "#564406", "#725a0a", "#8a6e10"], on: ["#e0b800", "#ffdc10", "#fff058", "#fffcb0", "#ffffff"], glow: "#fff040" },
  { off: ["#020a24", "#061440", "#0c2060", "#142e80", "#1c3c9c"], on: ["#1c5ce8", "#3c84ff", "#78b0ff", "#c0dcff", "#ffffff"], glow: "#5c9cff" },
].map((p, i) => ({ off: pal.ramp(`p${i}o`, p.off), on: pal.ramp(`p${i}n`, p.on), glow: pal.add(`p${i}g`, p.glow) }))
const C = {
  black: P("black"),
  white: P("white"),
  case: pal.ramp("case", ["#08080a", "#141418", "#202026", "#30303a", "#46464f", "#62626c"]),
  silver: pal.ramp("slv", ["#4c5258", "#6c747c", "#90989e", "#b4bcc0", "#d8dcdc", "#f4f4f0"]),
  wood: pal.ramp("wd", ["#2e1608", "#4a260e", "#683816", "#86501e", "#a46a2c", "#c08640"]),
  shadow: pal.add("shd", "#180a02"),
  logo: pal.ramp("lg", ["#600000", "#c01010", "#ff4020", "#ffa040", "#fff080"]),
  power: pal.add("pwr", "#30ff40"),
  power2: pal.add("pwr2", "#0c5010"),
  status: pal.add("stat", "#ffe860"),
  out: pal.add("out", "#707070"),
}
const UI = uiColors(pal)

// ---------------------------------------------------------------- layout
const HUD_H = 21
export const minSize = (cssW, cssH, online = false) => (cssW > cssH * 1.15 ? { minW: 280, minH: online ? 190 : 170 } : { minW: 200, minH: online ? 270 : 250 })

export const layout = (W, H, { online = false } = {}) => {
  const hud = online ? null : { x: 0, y: 0, w: W, h: HUD_H }
  let y = online ? 0 : HUD_H
  const players = online ? { x: 0, y, w: W, h: 11 } : null
  if (online) y += 11
  const status = online ? { x: 0, y, w: W, h: 12 } : null
  if (online) y += 12
  const wait = { x: 0, y, w: W, h: 5 }
  y += 5
  const room = { x: 0, y, w: W, h: H - y }
  const D = Math.max(80, Math.min(room.w - 10, room.h - 10, 460))
  const R = Math.floor(D / 2)
  const cx = Math.floor(W / 2)
  const cy = Math.floor(room.y + room.h / 2)
  const toy = { x: cx - R, y: cy - R, w: R * 2, h: R * 2, cx, cy, R }
  const pause = online ? null : { x: W - 19, y: 3, w: 16, h: 15 }
  return { W, H, online, hud, players, status, wait, room, toy, pause }
}

// the pad under a point (or -1): quarters 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right
export const padAt = (L, x, y) => {
  const dx = x - L.toy.cx
  const dy = y - L.toy.cy
  const r = Math.hypot(dx, dy)
  if (r < L.toy.R * 0.36 || r > L.toy.R) return -1
  return (dy < 0 ? 0 : 2) + (dx < 0 ? 0 : 1)
}

// ---------------------------------------------------------------- symbols (11 x 11)
const SYM = (() => {
  const L = { k: 1, w: 2 }
  const make = (rows) => sprite(rows, L)
  return {
    triangle: make(["....kk.....", "....kwk....", "...kwwk....", "...kwwwk...", "..kwwwwk...", "..kwwwwwk..", ".kwwwwwwk..", ".kwwwwwwwk.", "kwwwwwwwwk.", "kkkkkkkkkkk", "..........."].map((r) => r)),
    circle: make(["...kkkkk...", "..kwwwwwk..", ".kwwwwwwwk.", "kwwwwwwwwwk", "kwwwwwwwwwk", "kwwwwwwwwwk", "kwwwwwwwwwk", "kwwwwwwwwwk", ".kwwwwwwwk.", "..kwwwwwk..", "...kkkkk..."]),
    square: make(["kkkkkkkkkk.", "kwwwwwwwwk.", "kwwwwwwwwk.", "kwwwwwwwwk.", "kwwwwwwwwk.", "kwwwwwwwwk.", "kwwwwwwwwk.", "kwwwwwwwwk.", "kwwwwwwwwk.", "kkkkkkkkkk.", "..........."]),
    star: make(["....kkk....", "....kwk....", "...kwwwk...", "kkkkwwwkkkk", "kwwwwwwwwwk", ".kwwwwwwwk.", "..kwwwwwk..", "..kwwkwwk..", ".kwwk.kwwk.", ".kwk...kwk.", ".kk.....kk."]),
  }
})()
const SYMBOLS = ["triangle", "circle", "square", "star"]
// a symbol in two colours (outline, fill), scaled by whole pixels
const drawSymbol = (b, kind, cx, cy, outline, fill, scale = 1) => {
  const s = SYM[kind]
  const x0 = Math.round(cx - (s.w * scale) / 2)
  const y0 = Math.round(cy - (s.h * scale) / 2)
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const v = s.data[y * s.w + x]
      if (v) rect(b, x0 + x * scale, y0 + y * scale, scale, scale, v === 1 ? outline : fill)
    }
  }
}

// ---------------------------------------------------------------- the toy
const geom = (L) => {
  const { R } = L.toy
  return { r0: R * 0.4, r1: R * 0.9, hub: R * 0.36, gap: Math.max(2, Math.round(R * 0.035)) }
}
const quad = (dx, dy) => (dy < 0 ? 0 : 2) + (dx < 0 ? 0 : 1)

const deskCache = new Map()
const desk = (L, symbols) => {
  const key = `${L.W}x${L.H}|${L.toy.R}|${L.toy.cy}|${symbols}|${L.online}`
  const hit = deskCache.get(key)
  if (hit) return hit
  if (deskCache.size > 4) deskCache.clear()
  const b = createBitmap(L.W, L.H)
  // a wooden desk: long grain lines, knots, dithered between tones
  paint(b, 0, 0, L.W, L.H, (x, y) => {
    const grain = Math.sin(y * 0.55 + Math.sin(x * 0.045 + y * 0.03) * 2.2) * 0.5 + 0.5
    const plank = Math.floor(y / 26) % 2 ? 0.08 : 0
    return rampAt(C.wood, 0.35 + grain * 0.35 + plank, x, y)
  })
  for (let y = 25; y < L.H; y += 26) hline(b, 0, y, L.W, C.wood[0])
  const { cx, cy, R } = L.toy
  const { r0, r1, hub, gap } = geom(L)
  // the toy's shadow on the desk
  ellipse(b, cx + 4, cy + 6, R, R, C.shadow)
  // the case: charcoal plastic, a sheen on the top-left rim
  paint(b, cx - R, cy - R, R * 2 + 1, R * 2 + 1, (x, y) => {
    const dx = x + 0.5 - cx
    const dy = y + 0.5 - cy
    const r = Math.hypot(dx, dy)
    if (r > R) return -1
    if (r > R - 1) return C.black
    // rim bevel: lit at the top left, dark at the bottom right
    const rim = (R - r) / R
    const lit = (-dx - dy) / (r || 1)
    if (rim < 0.06) return rampAt(C.case, 0.45 + lit * 0.4, x, y)
    // the pads
    if (r >= r0 && r <= r1 && Math.abs(dx) > gap && Math.abs(dy) > gap) {
      const q = quad(dx, dy)
      const edge = Math.min(r - r0, r1 - r, Math.abs(dx) - gap, Math.abs(dy) - gap)
      if (edge < 1) return C.black
      // dished plastic: lighter toward the outer top-left
      const t = 0.25 + ((r - r0) / (r1 - r0)) * 0.35 + lit * 0.2
      return rampAt(PAD[q].off, t, x, y)
    }
    if (r < hub) return -1
    return rampAt(C.case, 0.22 + lit * 0.12, x, y)
  })
  // the hub: brushed silver with a bevelled edge
  paint(b, cx - hub - 1, cy - hub - 1, hub * 2 + 3, hub * 2 + 3, (x, y) => {
    const dx = x + 0.5 - cx
    const dy = y + 0.5 - cy
    const r = Math.hypot(dx, dy)
    if (r > hub) return -1
    if (r > hub - 1) return C.black
    const lit = (-dx - dy) / (r || 1)
    if (r > hub - 3) return rampAt(C.silver, 0.5 + lit * 0.45, x, y)
    // brushed: faint horizontal streaks
    const streak = ((y * 7 + Math.floor(x / 9)) % 5) / 25
    return rampAt(C.silver, 0.62 + streak - dy / hub * 0.12, x, y)
  })
  // screws round the case
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2
    const sx = Math.round(cx + Math.cos(a) * (R - Math.max(4, R * 0.05)))
    const sy = Math.round(cy + Math.sin(a) * (R - Math.max(4, R * 0.05)))
    disc(b, sx, sy, 1.6, C.silver[1])
    pset(b, sx - 1, sy, C.silver[4])
    pset(b, sx, sy, C.black)
  }
  // the logo on the hub
  const s = hub >= 40 ? 2 : 1
  if (hub >= 26) drawTitle(b, "ECHO", cx, cy - hub * 0.55, { scale: s, ramp: C.logo.slice(1), outline: C.black, shadow: C.silver[1], depth: 1, align: "center" })
  // the power light
  disc(b, cx - hub * 0.5, cy + hub * 0.62, 1.6, C.power)
  pset(b, cx - hub * 0.5 - 1, cy + hub * 0.62 - 1, C.white)
  // a speaker grill
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) pset(b, Math.round(cx + hub * 0.32 + j * 2), Math.round(cy + hub * 0.52 + k * 2), C.silver[0])
  // symbols on the unlit pads
  if (symbols) {
    for (let q = 0; q < 4; q++) {
      const { x, y } = symAt(L, q)
      // dark pads still show their symbol clearly: black outline, the lit colour's darkest tone
      drawSymbol(b, SYMBOLS[q], x, y, C.black, PAD[q].on[0], R >= 70 ? 2 : 1)
    }
  }
  deskCache.set(key, b)
  return b
}
const symAt = (L, q) => {
  const { cx, cy, R } = L.toy
  const { r0, r1 } = geom(L)
  const rr = (r0 + r1) / 2
  const sx = q % 2 ? 1 : -1
  const sy = q < 2 ? -1 : 1
  return { x: Math.round(cx + sx * rr * 0.7071), y: Math.round(cy + sy * rr * 0.7071) }
}

// a lit pad as a sprite over its quarter (bright, a white hot spot, a glow onto the case)
const litCache = new Map()
const litPad = (L, q, symbols) => {
  const key = `${L.toy.R}|${q}|${symbols}`
  const hit = litCache.get(key)
  if (hit) return hit
  if (litCache.size > 16) litCache.clear()
  const { R } = L.toy
  const { r0, r1, gap } = geom(L)
  const size = R + 2
  const b = createBitmap(size * 2 + 1, size * 2 + 1)
  const c = size
  paint(b, 0, 0, b.w, b.h, (x, y) => {
    const dx = x + 0.5 - c
    const dy = y + 0.5 - c
    if (quad(dx, dy) !== q) return -1
    const r = Math.hypot(dx, dy)
    const inPad = r >= r0 && r <= r1 && Math.abs(dx) > gap && Math.abs(dy) > gap
    if (inPad) {
      const edge = Math.min(r - r0, r1 - r, Math.abs(dx) - gap, Math.abs(dy) - gap)
      if (edge < 1) return PAD[q].on[0]
      const mid = (r0 + r1) / 2
      const hot = 1 - Math.min(1, Math.hypot(Math.abs(dx) * 0.7071 + Math.abs(dy) * 0.7071 - mid, (Math.abs(dx) - Math.abs(dy)) * 0.7071) / (r1 - r0))
      return rampAt(PAD[q].on, 0.25 + hot * 0.85, x, y)
    }
    // the glow: dithered sparkle on the case just round the pad
    const d = r > r1 ? r - r1 : r < r0 ? r0 - r : Math.min(Math.abs(dx), Math.abs(dy)) <= gap ? gap - Math.min(Math.abs(dx), Math.abs(dy)) + 1 : 99
    if (d < 5 && r < R - 1) {
      const level = 1 - d / 5
      return level * 0.8 > threshold(x, y) ? PAD[q].glow : -1
    }
    return -1
  })
  if (symbols) {
    const { x, y } = symAt(L, q)
    drawSymbol(b, SYMBOLS[q], x - L.toy.cx + c, y - L.toy.cy + c, C.black, C.white, R >= 70 ? 2 : 1)
  }
  const out = { w: b.w, h: b.h, data: b.data, ox: c }
  litCache.set(key, out)
  return out
}

// ---------------------------------------------------------------- HUD, status, players
const drawHud = (b, L, s) => {
  bevel(b, 0, 0, L.W, L.hud.h, UI)
  drawCounter(b, UI, 3, 2, String(Math.min(999, s.steps)), { digits: 3, digitW: 6 })
  const right = L.pause.x - 3
  const best = drawCounter(b, UI, right, 2, String(Math.min(999, s.best)), { digits: 3, digitW: 6, align: "right" })
  const mid = (32 + best.x) / 2
  const room = best.x - 36
  const lines = wrapText(s.status || "", room)
  if (lines.length <= 1) drawText(b, lines[0] || "", mid, 7, C.black, { align: "center" })
  else lines.slice(0, 2).forEach((l, i) => drawText(b, l, mid, 2 + i * 9, C.black, { align: "center" }))
  bevel(b, L.pause.x, L.pause.y, L.pause.w, L.pause.h, UI, { pressed: s.pressed === "pause" })
  const o = s.pressed === "pause" ? 1 : 0
  rect(b, L.pause.x + 5 + o, L.pause.y + 4 + o, 2, 7, C.black)
  rect(b, L.pause.x + 9 + o, L.pause.y + 4 + o, 2, 7, C.black)
}

const drawOnlineBars = (b, L, s) => {
  rect(b, 0, L.players.y, L.W, L.players.h, C.black)
  let x = 3
  for (const p of s.players || []) {
    const txt = `${p.turn ? "▶" : ""}${p.name.slice(0, 10)}${p.you ? "*" : ""}`
    drawText(b, txt, x, L.players.y + 2, p.out ? C.out : p.turn ? C.status : C.white)
    if (p.out) hline(b, x, L.players.y + 5, textWidth(txt), C.out)
    x += textWidth(txt) + 7
    if (x > L.W - 8) break
  }
  bevel(b, 0, L.status.y, L.W, L.status.h, UI)
  const t = wrapText(s.status || "", L.W - 6)[0] || ""
  drawText(b, t, L.W / 2, L.status.y + 3, C.black, { align: "center" })
}

// ---------------------------------------------------------------- a frame
export const drawToy = (b, L, s) => {
  b.data.set(desk(L, s.symbols).data)
  const lit = s.pressed != null && typeof s.pressed === "number" ? s.pressed : s.lit
  if (lit != null && lit >= 0) {
    const spr = litPad(L, lit, s.symbols)
    blit(b, spr, L.toy.cx - spr.ox, L.toy.cy - spr.ox)
  }
  // the LED window on the hub
  const { hub } = geom(L)
  const txt = String(s.center ?? "").slice(0, 5)
  const dw = hub >= 40 ? 6 : 4
  const dh = hub >= 40 ? 11 : 7
  const ww = Math.max(ledWidth("88/88", { digitW: dw }), ledWidth(txt, { digitW: dw })) + 6
  const wx = Math.round(L.toy.cx - ww / 2)
  const wy = Math.round(L.toy.cy - dh / 2 + hub * 0.05)
  rect(b, wx - 1, wy - 1, ww + 2, dh + 8, C.silver[0])
  rect(b, wx, wy, ww, dh + 6, C.black)
  const blinkOff = s.over && !s.reduced && Math.floor(s.t * 4) % 2
  if (!blinkOff) drawLed(b, txt, L.toy.cx, wy + 3, { on: P("ledOn"), off: P("ledOff"), digitW: dw, digitH: dh, align: "center" })
  if (s.wait != null) drawMeter(b, UI, L.wait.x, L.wait.y, L.wait.w, L.wait.h, s.wait, { on: s.wait < 0.3 ? P("ledOn") : C.power, off: C.power2, segments: 25 })
  else rect(b, L.wait.x, L.wait.y, L.wait.w, L.wait.h, C.wood[0])
  if (L.hud) drawHud(b, L, s)
  if (L.online) drawOnlineBars(b, L, s)
}

// ---------------------------------------------------------------- the title banner
export const drawBanner = (b, t, { reduced = false, symbols = true } = {}) => {
  const W = b.w
  const H = b.h
  const R = Math.floor(H / 2) - 4
  const L = { W, H, online: false, toy: { cx: R + 8, cy: Math.floor(H / 2), R, x: 8, y: Math.floor(H / 2) - R, w: R * 2, h: R * 2 } }
  b.data.set(desk(L, symbols).data)
  // a demo tune: the pads light in turn
  const tune = [0, 1, 3, 2, 0, 3, 1, 2]
  const k = Math.floor(t / 0.42)
  const on = reduced ? 0 : (t % 0.42) < 0.3 ? tune[k % tune.length] : -1
  if (on >= 0) {
    const spr = litPad(L, on, symbols)
    blit(b, spr, L.toy.cx - spr.ox, L.toy.cy - spr.ox)
  }
  const { hub } = geom(L)
  rect(b, L.toy.cx - 9, L.toy.cy - 2, 19, 11, C.black)
  drawLed(b, String((k % 8) + 1).padStart(2, " "), L.toy.cx, L.toy.cy, { on: P("ledOn"), off: P("ledOff"), digitW: 4, digitH: 7, align: "center" })
  // the logo
  const lx = L.toy.cx + R + 8 + (W - (L.toy.cx + R + 8)) / 2
  const scale = W - R * 2 > 150 ? 3 : 2
  drawTitle(b, "ECHO", lx, 10, { scale, ramp: C.logo.slice(1), outline: C.black, shadow: C.black, depth: 2, align: "center" })
  drawTitle(b, "PADS", lx, 10 + 8 * scale + 2, { scale, ramp: PAD[3].on.slice(0, 4), outline: C.black, shadow: C.black, depth: 2, align: "center" })
  drawText(b, "WATCH. LISTEN. REPEAT.", lx, 10 + 16 * scale + 8, C.white, { align: "center", outline: C.black })
  void hub
}
