// Boom Frenzy's pixel art and renderer (pure: no DOM, so Node previews draw exactly this).
// A 256-colour desert in the style of a mid-90s shareware arcade game: dithered sky, mesas,
// sand with speckles, dug holes, round cartoon bombs (procedural pixel sprites, shaded with
// ordered dithering, big eyes, a fuse that burns down pixel by pixel with a flickering spark),
// a wooden mallet with squash and stretch, 8-frame explosions, pixel-font score pops, a 98
// HUD with LED counters, bevelled weapon buttons. All art is original.
//
//   layout(W, H, mode)            where everything goes (shared with the hit boxes in the UI)
//   minSize(cssW, cssH, mode)     the smallest logical screen (for fitPixels)
//   drawGame(b, g, L, view)       one frame; view = { t, fx, pressed, reduced, sortHeld }
//   drawBanner(b, t)              the title screen's attract loop
//   bombSprite(type, opts)        a bomb (for the How to Play list and the intro card)

import {
  UI_COLORS,
  blit,
  createBitmap,
  createPalette,
  createParticles,
  disc,
  drawButton,
  drawCounter,
  drawMeter,
  drawText,
  drawTitle,
  ellipse,
  ellipseOutline,
  explosionFrames,
  frame,
  gradientV,
  hline,
  line,
  paint,
  pset,
  rampAt,
  rect,
  remapRect,
  remapTable,
  resetClip,
  setClip,
  shadeDisc,
  sparkleFrames,
  sprite,
  textWidth,
  threshold,
  tint,
  titleWidth,
  uiColors,
  bevel,
  vline,
} from "../../../utils/retro/index.js"
import { BOMBS, HOLD_TIME, METER_MAX, WEAPONS, WEAPON_IDS, canUse, ghostVisible, isFrozen, isPanic, isSnip, multFor } from "./engine.js"
import * as S from "./sort.js"

// ---------------------------------------------------------------- palette
export const pal = createPalette(UI_COLORS)
const P = (n) => pal.idx(n)
const R = {
  sky: pal.ramp("sky", ["#1c3c9c", "#2858c0", "#3c78dc", "#5c98ec", "#84b8f4", "#b0d8fc", "#dcf0ff"]),
  panic: pal.ramp("pan", ["#400000", "#780800", "#b01808", "#e03c10", "#ff7020", "#ffa848", "#ffd890"]),
  sand: pal.ramp("sand", ["#8a5420", "#a86c2c", "#c48a3c", "#d8a450", "#e8bc68", "#f4d488"]),
  mesaFar: pal.ramp("mf", ["#9c5c58", "#b47468", "#c88c78"]),
  mesa: pal.ramp("me", ["#6a2c14", "#8c3c1c", "#ac5428", "#c87038"]),
  dirt: pal.ramp("dirt", ["#1a0c04", "#2e1608", "#4a2810", "#6a3c18", "#8c5424", "#ae7034", "#c88c48"]),
  cactus: pal.ramp("cac", ["#0c3c14", "#1a5c1c", "#2c7c28", "#48a038", "#78c454"]),
  wood: pal.ramp("wood", ["#2c1404", "#5a2c0c", "#8a4c1c", "#b4702c", "#d89a4c", "#f0c27c"]),
  metal: pal.ramp("met", ["#283038", "#48545c", "#748088", "#a4b0b8", "#dce4e8"]),
  fire: pal.ramp("fire", ["#3c0800", "#8c1400", "#d02c00", "#ff6c00", "#ffb000", "#fff050", "#ffffff"]),
  smoke: pal.ramp("smk", ["#1c1c1c", "#383838", "#585858", "#7c7c7c", "#a4a4a4"]),
  grass: pal.ramp("grs", ["#163c0c", "#245a14", "#38781c", "#509a28", "#74bc3c", "#a4dc5c"]),
  olive: pal.ramp("olv", ["#1e2408", "#38441a", "#56682a", "#7c9040", "#a8b864"]),
  fuse: [pal.add("fuse0", "#4a2c10"), pal.add("fuse1", "#8c6430"), pal.add("fuse2", "#c49c5c")],
  spark: [pal.add("spk0", "#ff3000"), pal.add("spk1", "#ff9000"), pal.add("spk2", "#ffe000"), pal.add("spk3", "#ffffff")],
  heart: [pal.add("hrt0", "#7a0418"), pal.add("hrt1", "#d8143c"), pal.add("hrt2", "#ff6c88")],
  empty: [pal.add("emp0", "#404040"), pal.add("emp1", "#686868")],
}
// one dark-to-light ramp per bomb colour
const BODY = {
  black: ["#08080e", "#181822", "#2a2a38", "#40404e", "#5c5c70", "#82829a"],
  quick: ["#3c0404", "#7a0c0c", "#b81818", "#e43828", "#ff7058", "#ffb0a0"],
  helmet: ["#08080e", "#181822", "#2a2a38", "#40404e", "#5c5c70", "#82829a"],
  arrow: ["#042008", "#0c4c18", "#16802a", "#2cb040", "#64d86c", "#b0f4b0"],
  skull: ["#140a1e", "#2c1840", "#46285e", "#62407c", "#8464a0", "#b49cd0"],
  jumper: ["#401c00", "#7a3800", "#b45808", "#e8801c", "#ffb04c", "#ffdc98"],
  iron: ["#1c2228", "#343e48", "#525e6a", "#76848e", "#9eacb6", "#d0dae0"],
  ice: ["#06244c", "#124a90", "#2878cc", "#4ca8ec", "#8cd0fc", "#d4f0ff"],
  ghost: ["#4c5274", "#6c7498", "#9098bc", "#b4bcdc", "#d8dcf4", "#ffffff"],
  splitter: ["#1c0638", "#3a1270", "#5c24a8", "#8448d8", "#b080f4", "#dcc0ff"],
  hold: ["#040c34", "#0c1c64", "#1a3498", "#3058cc", "#5c88f0", "#a4c0ff"],
  heart: ["#4c041e", "#8c103c", "#cc2c64", "#f05a90", "#ff98bc", "#ffd4e4"],
  clock: ["#041e20", "#0c3c40", "#1a6064", "#30888c", "#5cb8b8", "#a8e4e0"],
  chain: ["#3a2800", "#6c5000", "#a07800", "#d0a810", "#f4d840", "#fff4a0"],
  gold: ["#4a2c00", "#8a5c00", "#c48c00", "#ecb800", "#ffe040", "#fffcc8"],
  red: ["#3c0404", "#7a0c0c", "#b81818", "#e43828", "#ff7058", "#ffb0a0"],
  blue: ["#040c3c", "#0c2080", "#1a3cc4", "#3464ec", "#6c98ff", "#b4ccff"],
  green: ["#042008", "#0c4c18", "#16802a", "#2cb040", "#64d86c", "#b0f4b0"],
  hot: ["#3c0000", "#800000", "#d00000", "#ff3010", "#ff8040", "#ffd0a0"],
  flash: ["#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff"],
}
const BR = Object.fromEntries(Object.entries(BODY).map(([k, v]) => [k, pal.ramp(`b_${k}`, v)]))
const C = {
  black: P("black"),
  white: P("white"),
  ink: pal.add("ink", "#100c08"),
  bone: pal.add("bone", "#f4ecd8"),
  bone2: pal.add("bone2", "#b8ac94"),
  yellow: pal.add("yel", "#ffe838"),
  orange: pal.add("org", "#ff8c18"),
  pink: pal.add("pnk", "#ff5c9c"),
  cyan: pal.add("cyn", "#58e8ff"),
  purple: pal.add("pur", "#9c48e8"),
  sun: pal.add("sun", "#fff4b0"),
  sun2: pal.add("sun2", "#ffd860"),
  shadowSand: pal.add("ssd", "#7a4818"),
  redPen: pal.add("pr", "#b42c1c"),
  redPen2: pal.add("pr2", "#d8503c"),
  bluePen: pal.add("pb", "#2c48b4"),
  bluePen2: pal.add("pb2", "#5070dc"),
  greenPen: pal.add("pg", "#1c8c34"),
  greenPen2: pal.add("pg2", "#3cb050"),
  lock: pal.add("lck", "#5c5c64"),
  flower1: pal.add("fl1", "#ff5c9c"),
  flower2: pal.add("fl2", "#ffffff"),
}
const UI = uiColors(pal)
// tints done the 256-colour way: remap every colour to its nearest palette entry after a change
const ICE = remapTable(pal, tint.ice())
const DARK = remapTable(pal, tint.darker(0.62))
const GREY = remapTable(pal, tint.grey())

// ---------------------------------------------------------------- layout
export const HUD_H = 21
export const MIN_CELL = 62
const landscape = (W, H, mode) => mode !== "sort" && W > H * 1.15

export const minSize = (cssW, cssH, mode = "stage") => {
  if (mode !== "sort" && cssW > cssH * 1.15) return { minW: 3 * MIN_CELL + 70, minH: HUD_H + 3 * 52 }
  return { minW: 3 * MIN_CELL, minH: HUD_H + 3 * 56 + (mode === "sort" ? 0 : 40) }
}

export const layout = (W, H, mode = "stage") => {
  const land = landscape(W, H, mode)
  const hud = { x: 0, y: 0, w: W, h: HUD_H }
  let weapons = null
  let area
  if (mode === "sort") area = { x: 0, y: HUD_H, w: W, h: H - HUD_H }
  else if (land) {
    const ww = 70
    weapons = { x: W - ww, y: HUD_H, w: ww, h: H - HUD_H, vertical: true }
    area = { x: 0, y: HUD_H, w: W - ww, h: H - HUD_H }
  } else {
    const wh = 46
    weapons = { x: 0, y: H - wh, w: W, h: wh, vertical: false }
    area = { x: 0, y: HUD_H, w: W, h: H - HUD_H - wh }
  }
  let cw = Math.floor((area.w - 4) / 3)
  let ch = Math.floor((area.h - 4) / 3)
  ch = Math.min(ch, Math.floor(cw * 1.35))
  cw = Math.min(cw, Math.floor(ch * 1.35))
  // the field sits low in the area: sky above it
  const fx = area.x + Math.floor((area.w - cw * 3) / 2)
  const fy = area.y + area.h - ch * 3 - Math.max(2, Math.floor((area.h - ch * 3) * 0.25))
  const field = { x: fx, y: fy, w: cw * 3, h: ch * 3, cw, ch }
  const horizon = Math.max(area.y + 10, fy + Math.floor(ch * 0.42))
  const r = cw >= 84 ? 17 : cw >= 70 ? 15 : cw >= 58 ? 14 : 11
  const holes = Array.from({ length: 9 }, (_, i) => {
    const x = fx + (i % 3) * cw
    const y = fy + Math.floor(i / 3) * ch
    const hx = x + Math.floor(cw / 2)
    const hy = y + ch - Math.max(7, Math.floor(ch * 0.2))
    const rx = Math.min(Math.floor(cw * 0.43), r * 2 + 3)
    const ry = Math.max(4, Math.round(rx * 0.34))
    return { x, y, w: cw, h: ch, hx, hy, rx, ry, r }
  })
  // Sort Rush's yard: the rules work in 0..1 both ways, so it may be taller than wide
  const yw = Math.max(60, area.w - 6)
  const yh = Math.max(60, Math.min(area.h - 6, Math.round(yw * 1.45)))
  const yard = { x: area.x + Math.floor((area.w - yw) / 2), y: area.y + Math.floor((area.h - yh) / 2), w: yw, h: yh }
  // weapon buttons + meter
  let meter = null
  let buttons = []
  if (weapons) {
    if (weapons.vertical) {
      meter = { x: weapons.x + 4, y: weapons.y + 4, w: weapons.w - 8, h: 7 }
      const top = meter.y + meter.h + 3
      const bh = Math.floor((weapons.y + weapons.h - 3 - top - 6) / 3)
      buttons = WEAPON_IDS.map((id, k) => ({ id, x: weapons.x + 4, y: top + k * (bh + 3), w: weapons.w - 8, h: bh }))
    } else {
      meter = { x: weapons.x + 4, y: weapons.y + 3, w: weapons.w - 8, h: 7 }
      const bw = Math.floor((weapons.w - 8 - 6) / 3)
      buttons = WEAPON_IDS.map((id, k) => ({ id, x: weapons.x + 4 + k * (bw + 3), y: meter.y + meter.h + 3, w: bw, h: weapons.h - meter.h - 9 }))
    }
  }
  const pause = { x: W - 19, y: 3, w: 16, h: 15 }
  return { W, H, mode, land, hud, area, field, horizon, holes, yard, weapons, meter, buttons, pause, r }
}

// ---------------------------------------------------------------- small sprites
const LG = { k: C.black, w: C.white, r: R.heart[1], R: R.heart[0], p: R.heart[2], g: R.empty[1], G: R.empty[0], y: C.yellow, o: C.orange, b: C.bone, B: C.bone2, m: R.metal[2], M: R.metal[0], n: R.metal[3], c: C.cyan, i: R.metal[4], u: P("navy"), s: R.sky[3], d: R.wood[2], D: R.wood[1], e: R.wood[4], x: R.cactus[2], X: R.cactus[1], Y: R.cactus[3], q: R.cactus[0] }
const HEART_ROWS = [".kk.kk.", "krpkrrk", "krrrrrk", ".krrrk.", "..krk..", "...k..."]
const HEART = sprite(HEART_ROWS, LG)
const HEART_EMPTY = sprite(HEART_ROWS.map((r) => r.replace(/[rp]/g, "g")), LG)
const STAR = sprite(["....k....", "...kyk...", "...kyk...", "kkkkyykkk", "kyyyyyyyk", ".kyyyyyk.", "..kyyyk..", ".kyykyyk.", ".kyk.kyk.", "kkk...kkk"].map((r) => r), LG)
const STAR_OFF = sprite(["....k....", "...kgk...", "...kgk...", "kkkkggkkk", "kgggggggk", ".kgggggk.", "..kgggk..", ".kggkggk.", ".kgk.kgk.", "kkk...kkk"], LG)
export const STAR_SPRITES = { on: STAR, off: STAR_OFF }
// weapon icons (13 x 13)
const ICONS = {
  mallet: sprite(["kkkkkkkkkkk..", "kiDeeeeeDik..", "kmDdddddDmk..", "kmDdddddDmk..", "kkkkkkkkkkk..", "....kdk......", "....kdk......", "....kdk......", "....kdk......", "....kdk......", "....kDk......", "....kDk......", "....kkk......"], LG),
  freeze: sprite(["......k......", "...k..c..k...", "....k.c.k....", ".....kck.....", "..k...c...k..", "...k..c..k...", "kccccciccccck", "...k..c..k...", "..k...c...k..", ".....kck.....", "....k.c.k....", "...k..c..k...", "......k......"], LG),
  snip: sprite([".k.......k...", ".kk.....kk...", "..kk...kk....", "...kk.kk.....", "....kmk......", ".....k.......", "....kmk......", "...kk.kk.....", ".kkk...kkk...", "krrk...krrk..", "kr.rk.kr.rk..", "kr.rk.kr.rk..", ".kkk...kkk..."], LG),
}
// a saguaro (11 x 18) and a small barrel cactus
const CACTUS = sprite(
  [
    "....kkk....",
    "...kYxXk...",
    "...kYxXk...",
    "...kYxXk.k.",
    ".k.kYxXkkXk",
    "kYkkYxXkYXk",
    "kYxkYxXkYXk",
    "kYxkYxXkYXk",
    "kYxkYxXxXk.",
    ".kxxYxXXk..",
    "..kkYxXk...",
    "...kYxXk...",
    "...kYxXk...",
    "...kYxXk...",
    "...kYxXk...",
    "...kYxXk...",
    "...kYxqk...",
    "...kkkkk...",
  ],
  LG,
)
const BARREL = sprite([".kkkk.", "kYxxXk", "kYxxXk", "kYxxXk", ".kkkk."], LG)
const PAUSE_ICON = sprite(["kk.kk", "kk.kk", "kk.kk", "kk.kk", "kk.kk", "kk.kk", "kk.kk"], LG)

const EXPLOSION = explosionFrames({ size: 44, frames: 8, fire: R.fire, smoke: R.smoke, seed: 11 })
const EXPLOSION_SMALL = explosionFrames({ size: 30, frames: 8, fire: R.fire, smoke: R.smoke, seed: 5 })
const SPARKLE = sparkleFrames({ size: 7, colors: [C.orange, C.yellow, C.white] })

// a cartoon eye: a white oval with a black rim, a tall pupil with a glint
const eye = (b, x, y, rx, ry, look, mood) => {
  if (mood === "closed") {
    hline(b, x - Math.floor(rx), y + 1, Math.ceil(rx * 2), C.ink)
    pset(b, x - Math.floor(rx) - 1, y, C.ink)
    pset(b, x + Math.ceil(rx), y, C.ink)
    return
  }
  ellipse(b, x, y, rx, ry, C.white)
  ellipseOutline(b, x, y, rx, ry, C.ink)
  const pw = rx >= 2.8 ? 2 : 1
  const ph = ry >= 3.8 ? 3 : 2
  const px = Math.round(x - pw / 2 + look[0])
  const py = Math.round(y - ph / 2 + 0.5 + look[1])
  rect(b, px, py, pw, ph, C.ink)
  if (mood !== "worried" && pw > 1) pset(b, px, py, C.white)
}

// the face: eyes (and worried brows plus a little "o" mouth when the fuse is short)
const face = (b, cx, cy, r, mood, dy = 0) => {
  const rx = Math.max(1.8, r * 0.2)
  const ry = Math.max(2.6, r * 0.29)
  const ex = Math.max(3, Math.round(r * 0.34))
  const ey = cy - Math.round(r * 0.16) + dy
  const look = mood === "worried" ? [0, -Math.round(ry * 0.45)] : [Math.round(rx * 0.3), Math.round(ry * 0.25)]
  eye(b, cx - ex, ey, rx, ry, look, mood)
  eye(b, cx + ex, ey, rx, ry, look, mood)
  if (mood === "worried") {
    const top = Math.round(ey - ry - 2)
    line(b, cx - ex - Math.ceil(rx), top + 1, cx - ex + Math.ceil(rx), top - 1, C.ink)
    line(b, cx + ex - Math.ceil(rx), top - 1, cx + ex + Math.ceil(rx), top + 1, C.ink)
    const my = Math.round(ey + ry + 2)
    rect(b, cx - 1, my, 3, 3, C.ink)
    pset(b, cx, my + 1, BR.hot[2])
  } else if (mood === "happy") {
    const my = Math.round(ey + ry + 2)
    hline(b, cx - 2, my + 1, 5, C.ink)
    pset(b, cx - 3, my, C.ink)
    pset(b, cx + 3, my, C.ink)
  }
}

const ARROW = sprite(["....kk....", "...kwwk...", "..kwwwwk..", ".kwwwwwwk.", "kwwwwwwwwk", "kkkwwwwkkk", "..kwwwwk..", "..kwwwwk..", "..kwwwwk..", "..kkkkkk.."], LG)
const SKULL = sprite(["..kkkkkk..", ".kbbbbbbk.", "kbbbbbbbbk", "kbkkbbkkbk", "kbkkbbkkbk", "kbbbbbbbbk", ".kbbkkbbk.", "..kbbbbk..", "..kbkbkk..", "...kkkk..."], LG)
const BONES = sprite(["kk......kk", "kbk....kbk", ".kbk..kbk.", "..kbkkbk..", "...kbbk...", "..kbkkbk..", ".kbk..kbk.", "kbk....kbk", "kk......kk"], LG)
const HEART_BIG = sprite([".kk.kk.", "kwwkwwk", "kwwwwwk", ".kwwwk.", "..kwk..", "...k..."], LG)
const FLAKE = sprite(["...w...", ".w.w.w.", "..www..", "wwwcwww", "..www..", ".w.w.w.", "...w..."], LG)
const CLOCKFACE = sprite(["..kkkk..", ".kwwwwk.", "kwwwkwwk", "kwwwkwwk", "kwwwkkwk", "kwwwwwwk", ".kwwwwk.", "..kkkk.."], LG)

const spriteCache = new Map()
// A bomb as a sprite: body centre at (ox, oy) = (r + 4, r + 9); the fuse is drawn live.
// opts: r, hits, dir, mood (calm | worried | closed), hot (red flash), flash (white)
export const bombSprite = (type, { r = 11, hits = 1, dir = "up", mood = "calm", hot = false, flash = false } = {}) => {
  const key = `${type}|${r}|${hits}|${dir}|${mood}|${hot}|${flash}`
  const hit = spriteCache.get(key)
  if (hit) return hit
  const w = r * 2 + 9
  const h = r * 2 + 12
  const b = createBitmap(w, h)
  const cx = r + 4
  const cy = r + 9
  const ramp = flash ? BR.flash : hot ? BR.hot : BR[type] || BR.black
  // the cap the fuse comes out of
  const capX = cx + Math.round(r * 0.45)
  const capY = cy - r - 2
  rect(b, capX - 1, capY, 6, 5, C.black)
  rect(b, capX, capY + 1, 4, 3, R.metal[2])
  rect(b, capX, capY + 1, 4, 1, R.metal[3])
  shadeDisc(b, cx, cy, r + 0.5, ramp, { outline: C.black, glint: flash ? -1 : C.white })
  // a second, softer highlight blob: the cartoon shine
  if (!flash) {
    pset(b, cx - Math.round(r * 0.5), cy - Math.round(r * 0.55), C.white)
    pset(b, cx - Math.round(r * 0.5) - 1, cy - Math.round(r * 0.45), ramp[ramp.length - 1])
  }
  let faceDy = 0
  let showFace = true
  if (type === "helmet" && hits > 1) {
    // an army helmet: an olive dome over the top half, with a rim
    paint(b, cx - r - 2, cy - r - 2, r * 2 + 5, r + 2, (x, y) => {
      const nx = (x + 0.5 - cx) / (r + 1.5)
      const ny = (y + 0.5 - (cy - 1)) / (r + 1)
      const d = nx * nx + ny * ny
      if (d > 1 || y > cy - 2) return -1
      if (d > 0.82) return C.black
      return rampAt(R.olive, 0.95 - (nx + 1) * 0.25 - (ny + 1) * 0.35, x, y)
    })
    rect(b, cx - r - 2, cy - 2, r * 2 + 5, 3, C.black)
    hline(b, cx - r - 1, cy - 1, r * 2 + 3, R.olive[2])
    faceDy = 3
  }
  if (type === "iron") {
    for (const [ax, ay] of [[-0.62, -0.42], [0.62, -0.42], [-0.7, 0.3], [0.7, 0.3], [0, 0.78]]) {
      const x = Math.round(cx + ax * r)
      const y = Math.round(cy + ay * r)
      pset(b, x, y, R.metal[0])
      pset(b, x - 1, y - 1, R.metal[4])
    }
    if (hits < 3) line(b, cx + 3, cy - r + 2, cx + 1, cy - 3, C.black), line(b, cx + 1, cy - 3, cx + 4, cy, C.black)
    if (hits < 2) line(b, cx - 4, cy + 2, cx - 1, cy + 6, C.black), line(b, cx - 1, cy + 6, cx - 5, cy + 9, C.black)
  }
  if (type === "arrow") {
    const turns = { up: 0, right: 1, down: 2, left: 3 }[dir] || 0
    let a = ARROW
    for (let t = 0; t < turns; t++) {
      const data = new Uint8Array(a.w * a.h)
      for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) data[x * a.h + (a.h - 1 - y)] = a.data[y * a.w + x]
      a = { w: a.h, h: a.w, data }
    }
    blit(b, a, cx - Math.floor(a.w / 2), cy - Math.floor(a.h / 2) + 1)
    showFace = false
  }
  if (type === "skull") {
    blit(b, SKULL, cx - 5, cy - 7)
    blit(b, BONES, cx - 5, cy + 2, { mask: (x, y) => y > cy + 3 })
    showFace = false
  }
  if (type === "jumper") {
    // springy chevrons on the belly
    for (const dy of [3, 6]) {
      line(b, cx - 4, cy + dy + 2, cx, cy + dy - 2, C.white)
      line(b, cx, cy + dy - 2, cx + 4, cy + dy + 2, C.white)
    }
    faceDy = -2
  }
  if (type === "ice") {
    blit(b, FLAKE, cx - 3, cy + Math.round(r * 0.25))
    faceDy = -2
  }
  if (type === "splitter") {
    const pts = [[0, -r], [-2, -r + 4], [2, -2], [-2, 2], [1, r - 3], [0, r]]
    for (let k = 0; k + 1 < pts.length; k++) line(b, cx + pts[k][0], cy + pts[k][1], cx + pts[k + 1][0], cy + pts[k + 1][1], C.white)
  }
  if (type === "heart") {
    blit(b, HEART_BIG, cx - 3, cy + Math.round(r * 0.22))
    faceDy = -2
  }
  if (type === "clock") {
    blit(b, CLOCKFACE, cx - 4, cy + Math.round(r * 0.18))
    faceDy = -3
  }
  if (type === "chain") {
    for (const [ax, ay] of [[-1, 0.15], [1, 0.15]]) {
      const x = Math.round(cx + ax * (r + 0.5))
      const y = Math.round(cy + ay * r)
      ellipseOutline(b, x, y, 2.5, 3.5, R.metal[1])
      ellipseOutline(b, x + ax * 3, y + 3, 2.5, 2.5, R.metal[2])
    }
  }
  if (type === "gold") {
    drawText(b, "100", cx, cy + Math.round(r * 0.2), BR.gold[0], { align: "center" })
    faceDy = -3
  }
  if (type === "ghost") mood = "closed"
  if (showFace) face(b, cx, cy, r, mood, faceDy)
  const out = { w, h, data: b.data, ox: cx, oy: cy, r }
  if (spriteCache.size > 600) spriteCache.clear()
  spriteCache.set(key, out)
  return out
}

// the fuse: a curl of rope from the cap, `frac` of it left; the spark flickers at its end
const fusePath = (r) => {
  const pts = []
  // a hand-tuned curl, relative to the cap's top
  const curl = [[0, 0], [1, -1], [2, -2], [2, -3], [3, -4], [4, -4], [5, -5], [5, -6], [4, -7], [3, -7], [2, -8], [2, -9], [3, -10], [4, -10]]
  for (const [x, y] of curl) pts.push([Math.round(r * 0.45) + 2 + x, -r - 2 + y])
  return pts
}
const FUSES = { 9: fusePath(9), 11: fusePath(11), 13: fusePath(13) }
const drawFuse = (b, cx, cy, r, frac, t, { reduced }) => {
  const path = FUSES[r] || fusePath(r)
  const n = Math.max(0, Math.min(path.length, Math.ceil(frac * path.length)))
  for (let k = 0; k < n; k++) pset(b, cx + path[k][0], cy + path[k][1], k % 2 ? R.fuse[1] : R.fuse[2])
  for (let k = 0; k < n; k++) pset(b, cx + path[k][0] + 1, cy + path[k][1], R.fuse[0])
  if (n <= 0 || frac <= 0) return
  const [sx, sy] = path[n - 1]
  const x = cx + sx
  const y = cy + sy
  const ph = reduced ? 1 : Math.floor(t * 18) % 3
  // a little cross of fire, its size flickering, plus a stray spark pixel
  const arms = ph === 0 ? 1 : ph === 1 ? 2 : 3
  for (let d = -arms; d <= arms; d++) {
    const c = Math.abs(d) === 0 ? R.spark[3] : Math.abs(d) === 1 ? R.spark[2] : R.spark[1]
    pset(b, x + d, y - 1, c)
    pset(b, x, y - 1 + d, c)
  }
  if (!reduced) {
    const a = (t * 37) % 6.28
    pset(b, x + Math.round(Math.cos(a) * 4), y - 1 + Math.round(Math.sin(a) * 3), R.spark[0])
  }
}

// ---------------------------------------------------------------- the desert
const hash = (x, y) => {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177)
  h ^= h >>> 13
  return ((Math.imul(h, 1274126177) ^ (h >>> 16)) >>> 0) / 4294967296
}

const bgCache = new Map()
const desert = (L, panic) => {
  const key = `${L.W}x${L.H}|${L.field.x},${L.field.y},${L.field.cw},${L.field.ch}|${panic}`
  const hit = bgCache.get(key)
  if (hit) return hit
  if (bgCache.size > 6) bgCache.clear()
  const { W, H, area, horizon } = L
  const b = createBitmap(W, H)
  const sky = panic ? R.panic : R.sky
  // sky: dark at the top, pale at the horizon
  gradientV(b, 0, area.y, W, horizon - area.y, sky, { from: 0.05, to: 1 })
  // the sun (a dithered halo, then the disc)
  const sx = Math.round(W * 0.78)
  const sy = area.y + Math.max(8, Math.round((horizon - area.y) * 0.35))
  paint(b, sx - 16, sy - 16, 33, 33, (x, y) => {
    const d = Math.hypot(x + 0.5 - sx, y + 0.5 - sy)
    if (d < 7) return panic ? C.sun2 : C.sun
    if (d < 11) return 0.5 > threshold(x, y) ? (panic ? C.orange : C.sun2) : -1
    if (d < 15) return 0.2 > threshold(x, y) ? (panic ? C.orange : sky[sky.length - 2]) : -1
    return -1
  })
  // far mesas (pale) and near mesas (dark), flat-topped, procedural from a fixed seed
  const mesas = (ramp, base, height, seed, step) => {
    let x = -10
    let k = seed
    while (x < W + 10) {
      const w = 18 + Math.floor(hash(k, 1) * 40)
      const hgt = Math.floor(height * (0.45 + hash(k, 2) * 0.55))
      const top = base - hgt
      const slope = 3 + Math.floor(hash(k, 3) * 4)
      if (hash(k, 4) > 0.3) {
        paint(b, x, top, w, base - top + 1, (px, py) => {
          const inset = Math.floor(((py - top) * slope) / Math.max(1, hgt))
          if (px < x + slope - inset || px > x + w - slope + inset) return -1
          // layered rock: bands, lit on the left
          const band = Math.floor((py - top) / 3) % 2
          const lit = px < x + w * 0.35 ? 1 : 0
          return ramp[Math.min(ramp.length - 1, band + lit)]
        })
      }
      x += w + Math.floor(hash(k, 5) * step)
      k++
    }
  }
  mesas(R.mesaFar, horizon, Math.max(8, Math.floor((horizon - area.y) * 0.45)), 3, 24)
  mesas(R.mesa, horizon, Math.max(6, Math.floor((horizon - area.y) * 0.28)), 17, 50)
  // the ground: sand getting lighter toward the viewer, speckled
  gradientV(b, 0, horizon, W, area.y + area.h - horizon, R.sand, { from: 0.3, to: 0.95 })
  paint(b, 0, horizon, W, area.y + area.h - horizon, (x, y) => {
    const v = hash(x, y)
    if (v < 0.035) return R.sand[1]
    if (v > 0.985) return R.sand[5]
    return -1
  })
  hline(b, 0, horizon, W, R.sand[2])
  // pebbles and a few tufts away from the holes
  for (let k = 0; k < Math.floor(W / 8); k++) {
    const x = Math.floor(hash(k, 9) * W)
    const y = horizon + 3 + Math.floor(hash(k, 10) * (area.y + area.h - horizon - 4))
    if (L.holes.some((h) => Math.abs(x - h.hx) < h.rx + 6 && Math.abs(y - h.hy) < h.ry + 22)) continue
    if (hash(k, 11) < 0.6) {
      rect(b, x, y, 2, 1, R.sand[1])
      pset(b, x, y - 1, R.sand[4])
    } else {
      pset(b, x, y, R.cactus[1])
      pset(b, x - 1, y - 1, R.cactus[2])
      pset(b, x + 1, y - 2, R.cactus[3])
    }
  }
  // cacti on the horizon and at the sides
  const cacti = [[0.06, 0], [0.93, 1], [0.4, 2]]
  for (const [fx, k] of cacti) {
    const x = Math.round(W * fx) - 5
    const y = horizon - CACTUS.h + 4 + (k === 2 ? -2 : 0)
    if (k === 2 && W < 260) continue
    blit(b, CACTUS, x, y)
  }
  blit(b, BARREL, Math.round(W * 0.22), horizon + 1)
  // the holes: a dirt mound ring, a dark pit
  for (const h of L.holes) {
    // shadow under the mound
    ellipse(b, h.hx + 1, h.hy + 2, h.rx + 4, h.ry + 3, C.shadowSand)
    // the mound (lit from the top left)
    paint(b, h.hx - h.rx - 5, h.hy - h.ry - 4, h.rx * 2 + 11, h.ry * 2 + 9, (x, y) => {
      const nx = (x + 0.5 - h.hx) / (h.rx + 4)
      const ny = (y + 0.5 - h.hy) / (h.ry + 3)
      const d = nx * nx + ny * ny
      if (d > 1) return -1
      return rampAt(R.dirt, 0.92 - ny * 0.32 - nx * 0.12 - d * 0.18, x, y)
    })
    // clods
    for (let k = 0; k < 6; k++) {
      const a = hash(h.hx, k) * Math.PI * 2
      const x = Math.round(h.hx + Math.cos(a) * (h.rx + 3))
      const y = Math.round(h.hy + Math.sin(a) * (h.ry + 2))
      rect(b, x, y, 2, 2, R.dirt[3])
      pset(b, x, y, R.dirt[5])
    }
    // the pit: dark, darker at the back
    paint(b, h.hx - h.rx, h.hy - h.ry, h.rx * 2 + 1, h.ry * 2 + 1, (x, y) => {
      const nx = (x + 0.5 - h.hx) / h.rx
      const ny = (y + 0.5 - h.hy) / h.ry
      if (nx * nx + ny * ny > 1) return -1
      return rampAt(R.dirt, (ny + 1) * 0.22, x, y)
    })
  }
  bgCache.set(key, b)
  return b
}

// the front lip of a hole, drawn over a bomb's bottom
const lip = (b, h) => {
  paint(b, h.hx - h.rx - 5, h.hy, h.rx * 2 + 11, h.ry + 4, (x, y) => {
    const nx = (x + 0.5 - h.hx) / (h.rx + 4)
    const ny = (y + 0.5 - h.hy) / (h.ry + 3)
    const d = nx * nx + ny * ny
    const nx2 = (x + 0.5 - h.hx) / h.rx
    const ny2 = (y + 0.5 - h.hy) / h.ry
    if (d > 1 || nx2 * nx2 + ny2 * ny2 <= 1) return -1
    return rampAt(R.dirt, 0.92 - ny * 0.32 - nx * 0.12 - d * 0.18, x, y)
  })
  // the pit's front rim edge
  paint(b, h.hx - h.rx, h.hy, h.rx * 2 + 1, h.ry + 1, (x, y) => {
    const nx = (x + 0.5 - h.hx) / h.rx
    const ny = (y + 0.5 - h.hy) / h.ry
    const d = nx * nx + ny * ny
    return d <= 1 && d > 0.72 && ny > 0.2 ? R.dirt[2] : -1
  })
}

// ---------------------------------------------------------------- the mallet
// A wooden mallet as two rotated boxes (handle + head), outlined, wood-shaded; angle 0 = the
// head flat on the ground. squash < 1 flattens the head on impact.
const box = (b, cx, cy, w, h, ang, shade) => {
  const ca = Math.cos(ang)
  const sa = Math.sin(ang)
  const ext = Math.ceil(Math.hypot(w, h) / 2) + 2
  paint(b, cx - ext, cy - ext, ext * 2 + 1, ext * 2 + 1, (x, y) => {
    const dx = x + 0.5 - cx
    const dy = y + 0.5 - cy
    const u = dx * ca + dy * sa
    const v = -dx * sa + dy * ca
    if (Math.abs(u) > w / 2 || Math.abs(v) > h / 2) return -1
    if (Math.abs(u) > w / 2 - 1 || Math.abs(v) > h / 2 - 1) return C.black
    return shade(u / w + 0.5, v / h + 0.5, x, y)
  })
}
const drawMallet = (b, px, py, ang, squash = 1, size = 11) => {
  // pivot (px, py) = where the head hits; the handle points up and to the right
  const hw = Math.round(size * 1.9)
  const hh = Math.round(size * 1.05 * squash)
  const hx = px
  const hy = py - hh / 2
  const ca = Math.cos(ang)
  const sa = Math.sin(ang)
  // handle from the head's middle, perpendicular to it
  const len = Math.round(size * 2)
  const mx = hx + sa * (hh / 2 + len / 2)
  const my = hy - ca * (hh / 2 + len / 2)
  box(b, mx, my, size >= 14 ? 5 : 4, len, ang, (u, v, x, y) => rampAt(R.wood, 0.75 - u * 0.5, x, y))
  box(b, hx, hy, hw, hh, ang, (u, v, x, y) => {
    if (u < 0.16 || u > 0.84) return rampAt(R.metal, 0.9 - v * 0.7, x, y)
    return rampAt(R.wood, 0.95 - v * 0.75, x, y)
  })
}

// ---------------------------------------------------------------- the HUD
const drawHud = (b, g, L, view) => {
  const { hud } = L
  bevel(b, hud.x, hud.y, hud.w, hud.h, UI)
  const score = drawCounter(b, UI, 3, 2, String(Math.min(99999, Math.round(g.score))), { digits: 5, digitW: 6, digitH: 11 })
  let x = score.x + score.w + 4
  const max = Math.max(g.hearts, 3)
  const hw = max > 3 ? 7 : 8
  for (let k = 0; k < Math.min(5, max); k++) blit(b, k < g.hearts ? HEART : HEART_EMPTY, x + k * hw, 7)
  x += Math.min(5, max) * hw + 4
  const mult = g.mode === "sort" ? S.multFor(g.combo) : multFor(g.combo)
  const multCol = mult >= 5 ? C.pink : mult >= 3 ? C.yellow : mult >= 2 ? R.fire[4] : UI.shadow
  const mw = textWidth(`x${mult}`, { scale: 2 }) + 6
  rect(b, x, 2, mw, 17, UI.shadow)
  rect(b, x + 1, 3, mw - 1, 16, UI.white)
  rect(b, x + 1, 3, mw - 2, 15, C.black)
  drawText(b, `x${mult}`, x + 3, 4, multCol, { scale: 2 })
  const goal = g.mode === "stage" ? `${Math.min(g.whacked, g.goal)}/${g.goal}` : String(g.mode === "sort" ? g.sorted : g.whacked)
  const right = L.pause.x - 3
  drawCounter(b, UI, right, 2, goal, { digits: g.mode === "stage" ? 5 : 3, digitW: 6, digitH: 11, align: "right" })
  // the pause button
  bevel(b, L.pause.x, L.pause.y, L.pause.w, L.pause.h, UI, { pressed: view.pressed === "pause" })
  blit(b, PAUSE_ICON, L.pause.x + 5 + (view.pressed === "pause" ? 1 : 0), L.pause.y + 4 + (view.pressed === "pause" ? 1 : 0))
}

const WEAPON_SHORT = { mallet: "MALLET", freeze: "FREEZE", snip: "SNIP" }
const drawWeapons = (b, g, L, view) => {
  if (!L.weapons) return
  const w = L.weapons
  rect(b, w.x, w.y, w.w, w.h, UI.face)
  hline(b, w.x, w.y, w.w, UI.white)
  if (w.vertical) vline(b, w.x, w.y, w.h, UI.white)
  drawMeter(b, UI, L.meter.x, L.meter.y, L.meter.w, L.meter.h, g.meter / METER_MAX, { on: R.fire[4], off: R.fire[0], hot: R.fire[5] })
  // tick marks at each weapon's cost
  for (const id of WEAPON_IDS) {
    const x = L.meter.x + 2 + Math.round(((L.meter.w - 4) * WEAPONS[id].cost) / METER_MAX) - 1
    vline(b, x, L.meter.y + L.meter.h, 2, UI.black)
  }
  for (const btn of L.buttons) {
    const ok = canUse(g, btn.id) && view.running
    const label = btn.w >= 46 ? WEAPON_SHORT[btn.id] : WEAPON_SHORT[btn.id].slice(0, 4)
    drawButton(b, UI, btn.x, btn.y, btn.w, btn.h, label, { icon: ICONS[btn.id], stack: btn.h >= 24, disabled: !ok, pressed: view.pressed === btn.id })
    // the cost in the corner
    drawText(b, String(WEAPONS[btn.id].cost), btn.x + btn.w - 3, btn.y + 3, ok ? R.fire[2] : UI.shadow, { align: "right" })
  }
}

// ---------------------------------------------------------------- banners
const banner = (b, L, text, ramp, y, t, reduced, blink = true) => {
  const w = titleWidth(text, { scale: 2 })
  const x = Math.round(L.W / 2)
  const on = reduced || !blink || Math.floor(t * 5) % 2 === 0
  rect(b, x - w / 2 - 5, y - 3, w + 10, 19, C.black)
  frame(b, x - w / 2 - 4, y - 2, w + 8, 17, on ? C.yellow : C.white)
  drawTitle(b, text, x, y + 1, { scale: 2, ramp, outline: C.black, shadow: -1, align: "center" })
}

// ---------------------------------------------------------------- a whole frame
// view: { t (s), fx: [{ kind, hole, x, y, text, at, until }], pressed, running, reduced, now (ms) }
export const drawGame = (b, g, L, view) => {
  const { t, reduced } = view
  if (g.mode === "sort") return drawSort(b, g, L, view)
  const panic = isPanic(g)
  const bg = desert(L, panic)
  b.data.set(bg.data)
  // bombs, back row first, each clipped at its hole's lip
  for (let i = 0; i < 9; i++) {
    const h = L.holes[i]
    const bomb = g.holes[i]
    if (bomb) {
      const rise = Math.min(1, bomb.age / 0.14)
      const r = bomb.small ? Math.max(7, h.r - 3) : h.r
      const low = bomb.life === Infinity ? bomb.left / bomb.fuse : 1
      const hot = bomb.life === Infinity && bomb.left < 0.7 && !isFrozen(g)
      const flashing = hot && !reduced && Math.floor(t * 10) % 2 === 0
      const wasHit = view.hitAt?.[bomb.id] && view.now - view.hitAt[bomb.id] < 90
      const mood = low < 0.3 ? "worried" : bomb.type === "skull" ? "calm" : "calm"
      const spr = bombSprite(bomb.type, { r, hits: bomb.hits, dir: bomb.dir, mood, hot: flashing, flash: wasHit })
      const jx = hot && !reduced ? (Math.floor(t * 30) % 2 ? 1 : -1) : 0
      const bodyY = h.hy - Math.round(r * 0.5) - 1 + Math.round((1 - rise) * (r * 2 + 4)) + (bomb.holding ? 1 : 0)
      const x = h.hx - spr.ox + jx
      const y = bodyY - spr.oy
      setClip(b, h.x - 6, L.area.y, h.w + 12, h.hy + 1 - L.area.y)
      // ghosts fade in and out with screen-door transparency
      let mask = null
      if (bomb.type === "ghost") {
        const vis = Math.sin((bomb.age / 1.3 + bomb.phase) * Math.PI * 2)
        const alpha = ghostVisible(bomb) ? 0.55 + Math.max(0, vis) * 0.45 : 0.12
        mask = (px, py) => alpha > threshold(px, py)
      }
      blit(b, spr, x, y, { mask, flipX: false })
      if (bomb.life === Infinity && !g.over) drawFuse(b, x + spr.ox, y + spr.oy, r, isFrozen(g) ? low : low, t, { reduced })
      if (bomb.type === "gold" && !reduced) blit(b, SPARKLE[Math.floor(t * 8) % 4], x + spr.ox + r - 2, y + spr.oy - r - 2)
      // the Hold bomb's ring fills as you hold it
      if (bomb.type === "hold") {
        const frac = bomb.held / HOLD_TIME
        const rr = r + 4
        for (let k = 0; k < 48; k++) {
          const a = -Math.PI / 2 + (k / 48) * Math.PI * 2
          const px = Math.round(x + spr.ox + Math.cos(a) * rr)
          const py = Math.round(y + spr.oy + Math.sin(a) * rr)
          pset(b, px, py, k / 48 < frac ? C.yellow : k % 2 ? UI.white : C.black)
        }
        if (!bomb.holding) drawText(b, "HOLD", x + spr.ox, y + spr.oy + r + 1, C.white, { align: "center", outline: C.black })
      }
      resetClip(b)
    }
    lip(b, h)
  }
  // effects
  for (const f of view.fx) {
    const age = (view.now - f.at) / 1000
    if (f.hole != null && !L.holes[f.hole]) continue
    const h = f.hole != null ? L.holes[f.hole] : null
    if (f.kind === "boom") {
      const frames = h && h.r < 11 ? EXPLOSION_SMALL : EXPLOSION
      const k = Math.min(frames.length - 1, Math.floor(age / 0.07))
      const fr = frames[k]
      blit(b, fr, h.hx - fr.w / 2, h.hy - fr.h / 2 - h.r)
    } else if (f.kind === "mallet") {
      // raised -> smash (squashed) -> lifting away
      const ang = age < 0.05 ? -0.9 : age < 0.13 ? 0 : -0.5
      const sq = age >= 0.05 && age < 0.13 ? 0.7 : 1
      if (!reduced || (age >= 0.05 && age < 0.13)) drawMallet(b, h.hx + 2, h.hy - Math.round(h.r * 1.2) - (age < 0.05 ? 8 : age < 0.13 ? 0 : 6), ang, sq, h.r)
      if (age >= 0.05 && age < 0.16) {
        // impact stars
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + 0.3
          const d = 10 + age * 60
          pset(b, h.hx + Math.cos(a) * d, h.hy - h.r + Math.sin(a) * d * 0.6, k % 2 ? C.yellow : C.white)
        }
      }
    } else if (f.kind === "swipe") {
      const len = 6 + Math.floor(age * 80)
      for (let k = -1; k <= 1; k++) {
        const dir = f.dir || "right"
        const vx = dir === "left" ? -1 : dir === "right" ? 1 : 0
        const vy = dir === "up" ? -1 : dir === "down" ? 1 : 0
        const ox = h.hx + vy * k * 5 - (vx * len) / 2
        const oy = h.hy - h.r + vx * k * 5 - (vy * len) / 2
        line(b, ox, oy, ox + vx * len, oy + vy * len, C.white)
      }
    } else if (f.kind === "text" || f.kind === "nudge") {
      const rise = Math.min(14, age * 26)
      const x = h ? h.hx : L.yard.x + (f.x ?? 0.5) * L.yard.w
      const y = (h ? h.hy - h.r * 2 - 6 : L.yard.y + (f.y ?? 0.5) * L.yard.h - 10) - rise
      const col = f.kind === "nudge" ? C.white : f.big ? C.yellow : f.gold ? BR.gold[4] : C.yellow
      if (!(age > 0.55 && !reduced && Math.floor(age * 20) % 2)) drawText(b, f.text, x, y, col, { align: "center", outline: C.black, scale: f.big ? 2 : 1 })
    }
  }
  if (isFrozen(g)) remapRect(b, L.area.x, L.area.y, L.area.w, L.area.h, ICE)
  // banners across the top of the field
  let by = L.area.y + 4
  if (panic) {
    banner(b, L, L.W >= 180 ? "PANIC TIME! X2" : "PANIC! X2", Math.floor(t * 6) % 2 && !reduced ? R.fire.slice(3) : R.fire.slice(2, 6), by, t, reduced)
    by += 21
  }
  if (isFrozen(g)) {
    banner(b, L, "FROZEN", BR.ice.slice(1), by, t, reduced, false)
    by += 21
  }
  if (isSnip(g)) banner(b, L, "ONE-TAP SNIP", BR.splitter.slice(1), by, t, reduced, false)
  drawHud(b, g, L, view)
  drawWeapons(b, g, L, view)
}

// ---------------------------------------------------------------- Sort Rush
const yardCache = new Map()
const yardBg = (L, green) => {
  const key = `${L.W}x${L.H}|${L.yard.x},${L.yard.w}|${green}`
  const hit = yardCache.get(key)
  if (hit) return hit
  if (yardCache.size > 6) yardCache.clear()
  const { W, H, yard: Y } = L
  const b = createBitmap(W, H)
  // the area around the yard: sand
  gradientV(b, 0, L.area.y, W, L.area.h, R.sand, { from: 0.4, to: 0.8 })
  // grass, mown in stripes
  paint(b, Y.x, Y.y, Y.w, Y.h, (x, y) => {
    const v = hash(x, y)
    if (v < 0.03) return R.grass[1]
    if (v > 0.985) return R.grass[5]
    const stripe = Math.floor((x - Y.x) / 10) % 2
    return rampAt(R.grass, 0.55 + stripe * 0.12, x, y)
  })
  // flowers
  for (let k = 0; k < Math.floor(Y.w / 9); k++) {
    const x = Y.x + Math.floor(hash(k, 31) * Y.w)
    const y = Y.y + Math.floor(hash(k, 32) * Y.h)
    pset(b, x, y, hash(k, 33) < 0.5 ? C.flower1 : C.flower2)
    pset(b, x, y + 1, R.grass[2])
  }
  const pw = Math.round(S.PEN_W * Y.w)
  const ph = Math.round(S.PEN_TOP * Y.h)
  const pen = (x, y, w, h, c1, c2, open) => {
    // a dirt floor tinted the pen's colour, fenced with pickets
    paint(b, x, y, w, h, (px, py) => (0.35 > threshold(px, py) ? c2 : c1))
    if (!open) {
      paint(b, x, y, w, h, (px, py) => ((px + py) % 6 === 0 ? C.lock : -1))
    }
    frame(b, x, y, w, h, R.wood[0])
    frame(b, x + 1, y + 1, w - 2, h - 2, R.wood[3])
    // pickets along the inner edge
    const vert = h > w
    const n = Math.floor((vert ? h : w) / 6)
    for (let k = 0; k < n; k++) {
      const px = vert ? (x < Y.x + Y.w / 2 ? x + w - 3 : x + 1) : x + 3 + k * 6
      const py = vert ? y + 3 + k * 6 : y + h - 4
      rect(b, px, py, 2, 3, R.wood[4])
      pset(b, px, py, R.wood[5])
      pset(b, px + 1, py + 2, R.wood[1])
    }
  }
  pen(Y.x, Y.y, pw, Y.h, C.redPen, C.redPen2, true)
  pen(Y.x + Y.w - pw, Y.y, pw, Y.h, C.bluePen, C.bluePen2, true)
  pen(Y.x + pw, Y.y, Y.w - pw * 2, ph, C.greenPen, C.greenPen2, green)
  frame(b, Y.x - 1, Y.y - 1, Y.w + 2, Y.h + 2, R.wood[0])
  yardCache.set(key, b)
  return b
}

const sortBombSprite = (color, hot, t, reduced) => bombSprite(color, { r: 9, mood: hot ? "worried" : "calm", hot: hot && !reduced && Math.floor(t * 10) % 2 === 0 })

const drawSort = (b, g, L, view) => {
  const { t, reduced } = view
  const Y = L.yard
  const green = g.t >= S.GREEN_AT
  b.data.set(yardBg(L, green).data)
  const pw = Math.round(S.PEN_W * Y.w)
  const ph = Math.round(S.PEN_TOP * Y.h)
  // pen counts on little signs
  const sign = (cx, cy, text, c) => {
    const w = textWidth(text) + 6
    rect(b, cx - w / 2, cy - 5, w, 11, C.black)
    rect(b, cx - w / 2 + 1, cy - 4, w - 2, 9, c)
    drawText(b, text, cx, cy - 3, C.white, { align: "center" })
  }
  sign(Y.x + pw / 2, Y.y + Y.h / 2, String(g.penned.red), C.redPen)
  sign(Y.x + Y.w - pw / 2, Y.y + Y.h / 2, String(g.penned.blue), C.bluePen)
  if (green) sign(Y.x + Y.w / 2, Y.y + ph / 2, String(g.penned.green), C.greenPen)
  else drawText(b, `OPENS AT ${S.GREEN_AT}s`, Y.x + Y.w / 2, Y.y + ph / 2 - 3, C.white, { align: "center", outline: C.black })
  // bombs: shadows first, then bodies (held ones lifted), sorted by y
  const list = [...g.bombs].sort((a, c) => a.y - c.y)
  for (const bomb of list) {
    const x = Y.x + bomb.x * Y.w
    const y = Y.y + bomb.y * Y.h
    ellipse(b, x, y + 8, 7, 2.5, R.grass[0])
  }
  for (const bomb of list) {
    const x = Math.round(Y.x + bomb.x * Y.w)
    const y = Math.round(Y.y + bomb.y * Y.h)
    const hot = bomb.left < 1.5
    const spr = sortBombSprite(bomb.color, hot, t, reduced)
    const lift = bomb.held ? 6 : 0
    // little feet that step while walking
    const step = bomb.held || reduced ? 0 : Math.floor((t + bomb.id * 0.13) * 8) % 2
    rect(b, x - 5, y + 7 - lift - (step ? 1 : 0), 3, 2, C.black)
    rect(b, x + 2, y + 7 - lift - (step ? 0 : 1), 3, 2, C.black)
    const bx = x - spr.ox
    const by = y - spr.oy - lift
    blit(b, spr, bx, by)
    drawFuse(b, x, y - lift, 9, bomb.left / bomb.fuse, t + bomb.id, { reduced })
  }
  for (const f of view.fx) {
    const age = (view.now - f.at) / 1000
    if (f.kind === "boom") {
      const k = Math.min(EXPLOSION_SMALL.length - 1, Math.floor(age / 0.07))
      const fr = EXPLOSION_SMALL[k]
      blit(b, fr, Y.x + f.x * Y.w - fr.w / 2, Y.y + f.y * Y.h - fr.h / 2)
    } else if (f.kind === "text") {
      const rise = Math.min(14, age * 26)
      drawText(b, f.text, Y.x + f.x * Y.w, Y.y + f.y * Y.h - 12 - rise, C.yellow, { align: "center", outline: C.black })
    }
  }
  if (g.t >= S.GREEN_AT && g.t < S.GREEN_AT + 2.5) banner(b, L, "GREEN PEN OPEN!", BR.green.slice(1), L.area.y + 4, t, reduced)
  drawHud(b, g, L, view)
}

// ---------------------------------------------------------------- the title banner
const BANNER_HOLES = [0.2, 0.5, 0.8]
export const drawBanner = (b, t, { reduced = false } = {}) => {
  const W = b.w
  const H = b.h
  const horizon = Math.round(H * 0.62)
  gradientV(b, 0, 0, W, horizon, R.sky, { from: 0.15, to: 1 })
  gradientV(b, 0, horizon, W, H - horizon, R.sand, { from: 0.35, to: 0.9 })
  hline(b, 0, horizon, W, R.sand[2])
  blit(b, CACTUS, 4, horizon - CACTUS.h + 3)
  blit(b, CACTUS, W - 16, horizon - CACTUS.h + 5)
  // three holes; a bomb pops up in turn and gets whacked (or blows up every third time)
  const cycle = 1.6
  const n = Math.floor(t / cycle)
  const local = t - n * cycle
  const which = n % 3
  const holes = BANNER_HOLES.map((fx) => ({ hx: Math.round(W * fx), hy: H - 9, rx: 14, ry: 5, r: 11, x: 0, w: W }))
  for (const h of holes) {
    ellipse(b, h.hx, h.hy, h.rx + 4, h.ry + 3, R.dirt[4])
    ellipse(b, h.hx, h.hy, h.rx, h.ry, R.dirt[0])
  }
  const h = holes[which]
  const types = ["black", "quick", "helmet", "gold", "ice", "heart"]
  const type = types[n % types.length]
  const boom = n % 3 === 2
  if (local < 1.0 || (boom && local < 0.9)) {
    const rise = Math.min(1, local / 0.15)
    const spr = bombSprite(type, { r: 11, mood: local > 0.6 ? "worried" : "calm" })
    setClip(b, 0, 0, W, h.hy + 1)
    const x = h.hx - spr.ox
    const y = h.hy - Math.round(11 * 0.5) - 1 + Math.round((1 - rise) * 26) - spr.oy
    blit(b, spr, x, y)
    if (type !== "gold") drawFuse(b, x + spr.ox, y + spr.oy, 11, 1 - local / 1.1, t, { reduced })
    resetClip(b)
  }
  lip(b, h)
  if (!boom && local >= 0.85 && local < 1.15) {
    const age = local - 0.85
    drawMallet(b, h.hx + 2, h.hy - 11 - (age < 0.06 ? 8 : 0), age < 0.06 ? -0.9 : 0, age < 0.06 ? 1 : 0.7)
    if (age >= 0.06) drawText(b, "+10", h.hx, h.hy - 34 - age * 20, C.yellow, { align: "center", outline: C.black })
  }
  if (boom && local >= 0.9 && local < 0.9 + 0.56) {
    const k = Math.min(7, Math.floor((local - 0.9) / 0.07))
    const fr = EXPLOSION[k]
    blit(b, fr, h.hx - fr.w / 2, h.hy - fr.h / 2 - 11)
  }
  // the logo
  const logo = { ramp: R.fire.slice(2), outline: C.black, shadow: R.fire[1], align: "center" }
  const one = titleWidth("BOOM FRENZY", { scale: 3 }) <= W - 12
  if (one) drawTitle(b, "BOOM FRENZY", W / 2, 7, { ...logo, scale: W >= 330 ? 4 : 3, depth: 3 })
  else {
    drawTitle(b, "BOOM", W / 2, 4, { ...logo, scale: 2, depth: 2 })
    drawTitle(b, "FRENZY", W / 2, 21, { ...logo, scale: 2, depth: 2 })
  }
  if (H >= 80) drawText(b, "WHACK 'EM BEFORE THEY BLOW!", W / 2, one ? (W >= 330 ? 40 : 33) : 39, C.white, { align: "center", outline: C.black })
}
export const BANNER_PAL = pal

// the intro card / How to Play bomb at a size: a bitmap with the bomb in it
export const bombCard = (type, size = 40) => {
  const b = createBitmap(size, size)
  const spr = bombSprite(type, { r: 13, dir: "right" })
  const x = Math.floor(size / 2) - spr.ox
  const y = Math.floor(size / 2) + 3 - spr.oy
  blit(b, spr, x, y)
  if (!["skull", "gold"].includes(type)) drawFuse(b, x + spr.ox, y + spr.oy, 13, 0.85, 0.2, { reduced: true })
  if (type === "hold") {
    for (let k = 0; k < 48; k++) {
      const a = -Math.PI / 2 + (k / 48) * Math.PI * 2
      pset(b, Math.round(x + spr.ox + Math.cos(a) * 17), Math.round(y + spr.oy + Math.sin(a) * 17), k < 30 ? C.yellow : C.black)
    }
  }
  return b
}
export const starSprites = STAR_SPRITES
export const heartSprites = { full: HEART, empty: HEART_EMPTY }
export const GREY_TABLE = GREY
export const DARK_TABLE = DARK
export const weaponIcon = (id) => ICONS[id]
export { createParticles }
