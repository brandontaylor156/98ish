// Bitmap fonts drawn pixel by pixel (no system fonts inside a retro game). Pure, tested in
// retro.test.js. All glyphs are original.
//
//   FONT        a 5x7 proportional font: capitals 7 high, lower case with 2-pixel descenders
//               (cell 9 high, baseline under row 6), digits all 5 wide (scores don't jiggle)
//   textWidth(text, { font, scale, bold, spacing })
//   drawText(b, text, x, y, color, { font, scale, align, shadow, outline, bold, spacing })
//   wrapText(text, maxW, opts) -> lines
//   drawTitle(b, text, x, y, { scale, ramp, outline, shadow, ... })  a chunky 90s logo:
//               bold, scaled, a dithered vertical gradient fill, an outline and a drop shadow
//   drawLed(b, text, x, y, { on, off, digitW, digitH, thick })        7-segment digits
//   ledWidth(text, opts)

import { rect, pset } from "./bitmap.js"
import { rampAt } from "./dither.js"

// "#" = ink. Rows joined with "|". 7 rows (capitals) or 9 (descenders). Widths vary.
const GLYPHS = {
  A: ".###.|#...#|#...#|#####|#...#|#...#|#...#",
  B: "####.|#...#|#...#|####.|#...#|#...#|####.",
  C: ".###.|#...#|#....|#....|#....|#...#|.###.",
  D: "####.|#...#|#...#|#...#|#...#|#...#|####.",
  E: "#####|#....|#....|####.|#....|#....|#####",
  F: "#####|#....|#....|####.|#....|#....|#....",
  G: ".###.|#...#|#....|#.###|#...#|#...#|.####",
  H: "#...#|#...#|#...#|#####|#...#|#...#|#...#",
  I: "###|.#.|.#.|.#.|.#.|.#.|###",
  J: "..###|...#.|...#.|...#.|...#.|#..#.|.##..",
  K: "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#",
  L: "#....|#....|#....|#....|#....|#....|#####",
  M: "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#",
  N: "#...#|##..#|#.#.#|#..##|#...#|#...#|#...#",
  O: ".###.|#...#|#...#|#...#|#...#|#...#|.###.",
  P: "####.|#...#|#...#|####.|#....|#....|#....",
  Q: ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#",
  R: "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
  S: ".####|#....|#....|.###.|....#|....#|####.",
  T: "#####|..#..|..#..|..#..|..#..|..#..|..#..",
  U: "#...#|#...#|#...#|#...#|#...#|#...#|.###.",
  V: "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..",
  W: "#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.",
  X: "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
  Y: "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..",
  Z: "#####|....#|...#.|..#..|.#...|#....|#####",
  0: ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.",
  1: "..#..|.##..|..#..|..#..|..#..|..#..|.###.",
  2: ".###.|#...#|....#|...#.|..#..|.#...|#####",
  3: "#####|...#.|..#..|...#.|....#|#...#|.###.",
  4: "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.",
  5: "#####|#....|####.|....#|....#|#...#|.###.",
  6: "..##.|.#...|#....|####.|#...#|#...#|.###.",
  7: "#####|....#|...#.|..#..|.#...|.#...|.#...",
  8: ".###.|#...#|#...#|.###.|#...#|#...#|.###.",
  9: ".###.|#...#|#...#|.####|....#|...#.|.##..",
  a: "....|....|.##.|...#|.###|#..#|.###",
  b: "#...|#...|###.|#..#|#..#|#..#|###.",
  c: "....|....|.###|#...|#...|#...|.###",
  d: "...#|...#|.###|#..#|#..#|#..#|.###",
  e: "....|....|.##.|#..#|####|#...|.###",
  f: ".##|#..|###|#..|#..|#..|#..",
  g: "....|....|.###|#..#|#..#|#..#|.###|...#|.##.",
  h: "#...|#...|###.|#..#|#..#|#..#|#..#",
  i: "#|.|#|#|#|#|#",
  j: "..#|...|..#|..#|..#|..#|..#|#.#|.#.",
  k: "#...|#...|#..#|#.#.|##..|#.#.|#..#",
  l: "##|.#|.#|.#|.#|.#|.#",
  m: ".....|.....|##.#.|#.#.#|#.#.#|#.#.#|#.#.#",
  n: "....|....|###.|#..#|#..#|#..#|#..#",
  o: "....|....|.##.|#..#|#..#|#..#|.##.",
  p: "....|....|###.|#..#|#..#|#..#|###.|#...|#...",
  q: "....|....|.###|#..#|#..#|#..#|.###|...#|...#",
  r: "....|....|#.##|##..|#...|#...|#...",
  s: "....|....|.###|#...|.##.|...#|###.",
  t: ".#.|.#.|###|.#.|.#.|.#.|..#",
  u: "....|....|#..#|#..#|#..#|#..#|.###",
  v: ".....|.....|#...#|#...#|#...#|.#.#.|..#..",
  w: ".....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.",
  x: "....|....|#..#|#..#|.##.|#..#|#..#",
  y: "....|....|#..#|#..#|#..#|#..#|.###|...#|.##.",
  z: "....|....|####|...#|..#.|.#..|####",
  " ": "...|...|...|...|...|...|...",
  "!": "#|#|#|#|#|.|#",
  "?": ".###.|#...#|....#|...#.|..#..|.....|..#..",
  ".": ".|.|.|.|.|.|#",
  ",": "..|..|..|..|..|..|.#|.#|#.",
  ":": ".|.|#|.|.|#|.",
  ";": "..|..|.#|..|..|.#|.#|#.",
  "'": "#|#|.|.|.|.|.",
  '"': "#.#|#.#|...|...|...|...|...",
  "-": "...|...|...|###|...|...|...",
  "+": ".....|..#..|..#..|#####|..#..|..#..|.....",
  "=": "....|....|####|....|####|....|....",
  "/": "....#|....#|...#.|..#..|.#...|#....|#....",
  "\\": "#....|#....|.#...|..#..|...#.|....#|....#",
  "(": ".#|#.|#.|#.|#.|#.|.#",
  ")": "#.|.#|.#|.#|.#|.#|#.",
  "[": "##|#.|#.|#.|#.|#.|##",
  "]": "##|.#|.#|.#|.#|.#|##",
  "{": "..#|.#.|.#.|#..|.#.|.#.|..#",
  "}": "#..|.#.|.#.|..#|.#.|.#.|#..",
  "<": "...#|..#.|.#..|#...|.#..|..#.|...#",
  ">": "#...|.#..|..#.|...#|..#.|.#..|#...",
  "*": ".....|#.#.#|.###.|#####|.###.|#.#.#|.....",
  "#": ".#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.",
  "%": "##..#|##..#|...#.|..#..|.#...|#..##|#..##",
  "&": ".##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#",
  $: "..#..|.####|#.#..|.###.|..#.#|####.|..#..",
  "@": ".###.|#...#|#.###|#.#.#|#.###|#....|.###.",
  _: "....|....|....|....|....|....|####",
  "^": "..#..|.#.#.|#...#|.....|.....|.....|.....",
  "~": ".....|.....|.#...|#.#.#|...#.|.....|.....",
  "`": "#.|.#|..|..|..|..|..",
  "|": "#|#|#|#|#|#|#",
  "·": ".|.|.|#|.|.|.",
  "•": "...|...|.#.|###|.#.|...|...",
  "…": ".....|.....|.....|.....|.....|.....|#.#.#",
  "×": ".....|.....|#...#|.#.#.|..#..|.#.#.|#...#",
  "↑": "..#..|.###.|#.#.#|..#..|..#..|..#..|..#..",
  "↓": "..#..|..#..|..#..|..#..|#.#.#|.###.|..#..",
  "←": ".....|..#..|.#...|#####|.#...|..#..|.....",
  "→": ".....|..#..|...#.|#####|...#.|..#..|.....",
  "♥": ".....|.#.#.|#####|#####|.###.|..#..|.....",
  "★": "..#..|..#..|#####|.###.|.###.|##.##|#...#",
  "✓": ".....|....#|...#.|#.#..|.#...|.....|.....",
  "✗": ".....|#...#|.#.#.|..#..|.#.#.|#...#|.....",
  "▶": "#...|##..|###.|####|###.|##..|#...",
  "°": ".#.|#.#|.#.|...|...|...|...",
}
// common look-alikes the font doesn't carry
const ALIAS = { "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", é: "e", è: "e", á: "a", à: "a", ö: "o", ü: "u", ñ: "n", " ": " " }

const build = (defs) => {
  const glyphs = {}
  for (const [ch, def] of Object.entries(defs)) {
    const rows = def.split("|")
    const w = Math.max(...rows.map((r) => r.length))
    const h = rows.length
    const data = new Uint8Array(w * h)
    rows.forEach((r, y) => {
      for (let x = 0; x < r.length; x++) if (r[x] === "#") data[y * w + x] = 1
    })
    glyphs[ch] = { w, h, data }
  }
  return glyphs
}

export const FONT = { height: 9, ascent: 7, spacing: 1, glyphs: build(GLYPHS), name: "pixel5x7" }

const glyphFor = (font, ch) => {
  const g = font.glyphs[ch] || font.glyphs[ALIAS[ch]] || font.glyphs[ch.toUpperCase?.()]
  return g || font.glyphs["?"]
}

export const textWidth = (text, { font = FONT, scale = 1, bold = false, spacing = font.spacing } = {}) => {
  const s = String(text)
  if (!s.length) return 0
  let w = 0
  for (const ch of s) w += glyphFor(font, ch).w + spacing + (bold ? 1 : 0)
  return (w - spacing) * scale
}

// the lines of `text` that fit in maxW (word wrap; a word wider than a line is split)
export const wrapText = (text, maxW, opts = {}) => {
  const out = []
  for (const para of String(text).split("\n")) {
    let line = ""
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word
      if (textWidth(tryLine, opts) <= maxW) {
        line = tryLine
        continue
      }
      if (line) out.push(line)
      if (textWidth(word, opts) <= maxW) line = word
      else {
        // split a long word
        let part = ""
        for (const ch of word) {
          if (textWidth(part + ch, opts) > maxW && part) {
            out.push(part)
            part = ""
          }
          part += ch
        }
        line = part
      }
    }
    out.push(line)
  }
  return out
}

// draw one glyph's ink with a callback per (scaled) pixel
const eachInk = (text, x, y, { font = FONT, scale = 1, bold = false, spacing = font.spacing }, fn) => {
  let cx = x
  for (const ch of String(text)) {
    const g = glyphFor(font, ch)
    for (let gy = 0; gy < g.h; gy++) {
      for (let gx = 0; gx < g.w; gx++) {
        if (!g.data[gy * g.w + gx]) continue
        fn(cx + gx * scale, y + gy * scale)
        if (bold) fn(cx + (gx + 1) * scale, y + gy * scale)
      }
    }
    cx += (g.w + spacing + (bold ? 1 : 0)) * scale
  }
}

// align: left | center | right (x is that edge / the middle). y is the top of the cell.
export const drawText = (b, text, x, y, color, opts = {}) => {
  const { scale = 1, align = "left", shadow = -1, outline = -1, shadowOffset = 1 } = opts
  const w = textWidth(text, opts)
  const x0 = Math.round(align === "center" ? x - w / 2 : align === "right" ? x - w : x)
  const y0 = Math.round(y)
  const dot = (c) => (px, py) => rect(b, px, py, scale, scale, c)
  if (outline >= 0) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) eachInk(text, x0 + dx * scale, y0 + dy * scale, opts, dot(outline))
  }
  if (shadow >= 0) eachInk(text, x0 + shadowOffset * scale, y0 + shadowOffset * scale, opts, dot(shadow))
  eachInk(text, x0, y0, opts, dot(color))
  return w
}

// A chunky logo: bold glyphs at `scale`, filled with a dithered vertical gradient over `ramp`
// (dark -> light, so the top is lightest by default: from/to flip it), a 1-pixel outline and a
// drop shadow `depth` pixels deep (a stack of outline-coloured copies: the 90s extruded look).
export const drawTitle = (b, text, x, y, opts = {}) => {
  const { scale = 2, ramp = [1], outline = -1, shadow = -1, depth = 2, align = "left", bold = false, from = 1, to = 0.15, font = FONT, spacing = font.spacing } = opts
  const o = { font, scale, bold, spacing }
  const w = textWidth(text, o)
  const x0 = Math.round(align === "center" ? x - w / 2 : align === "right" ? x - w : x)
  const y0 = Math.round(y)
  const h = font.ascent * scale
  // which pixels are ink: rasterize once
  const pts = []
  eachInk(text, x0, y0, o, (px, py) => pts.push(px, py))
  const fill = (px, py) => rampAt(ramp, from + ((to - from) * (py - y0 + 0.5)) / h, px, py)
  if (shadow >= 0) {
    for (let d = depth; d >= 1; d--) for (let i = 0; i < pts.length; i += 2) rect(b, pts[i] + d, pts[i + 1] + d, scale, scale, shadow)
  }
  if (outline >= 0) {
    for (let i = 0; i < pts.length; i += 2) rect(b, pts[i] - 1, pts[i + 1] - 1, scale + 2, scale + 2, outline)
  }
  for (let i = 0; i < pts.length; i += 2) {
    for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) pset(b, pts[i] + xx, pts[i + 1] + yy, fill(pts[i] + xx, pts[i + 1] + yy))
  }
  return w
}
export const titleWidth = (text, { scale = 2, bold = false, font = FONT, spacing = font.spacing } = {}) => textWidth(text, { font, scale, bold, spacing })

// ---- 7-segment LED digits (the Minesweeper counter look) ----
//   segments: a top, b top right, c bottom right, d bottom, e bottom left, f top left, g middle
const SEGMENTS = {
  0: "abcdef",
  1: "bc",
  2: "abdeg",
  3: "abcdg",
  4: "bcfg",
  5: "acdfg",
  6: "acdefg",
  7: "abc",
  8: "abcdefg",
  9: "abcdfg",
  "-": "g",
  " ": "",
  A: "abcefg",
  b: "cdefg",
  C: "adef",
  d: "bcdeg",
  E: "adefg",
  F: "aefg",
  H: "bcefg",
  L: "def",
  o: "cdeg",
  P: "abefg",
  r: "eg",
  t: "defg",
  U: "bcdef",
  y: "bcdfg",
}

export const ledWidth = (text, { digitW = 7, gap = 2 } = {}) => {
  let w = 0
  for (const ch of String(text)) w += (ch === ":" || ch === "." ? 3 : ch === "/" ? digitW - 2 : digitW) + gap
  return Math.max(0, w - gap)
}

export const drawLed = (b, text, x, y, opts = {}) => {
  const { on, off = -1, digitW = 7, digitH = 11, thick = 1, gap = 2, align = "left" } = opts
  const w = ledWidth(text, opts)
  let cx = Math.round(align === "center" ? x - w / 2 : align === "right" ? x - w : x)
  y = Math.round(y)
  const mid = y + Math.floor((digitH - thick) / 2)
  const seg = (name, c, x0) => {
    const t = thick
    const W = digitW
    const H = digitH
    // horizontal segments are inset by one pixel each end; vertical ones by one pixel top/bottom
    if (name === "a") rect(b, x0 + 1, y, W - 2, t, c)
    else if (name === "g") rect(b, x0 + 1, mid, W - 2, t, c)
    else if (name === "d") rect(b, x0 + 1, y + H - t, W - 2, t, c)
    else if (name === "f") rect(b, x0, y + 1, t, mid - y - 1, c)
    else if (name === "b") rect(b, x0 + W - t, y + 1, t, mid - y - 1, c)
    else if (name === "e") rect(b, x0, mid + t, t, y + H - t - mid - t, c)
    else if (name === "c") rect(b, x0 + W - t, mid + t, t, y + H - t - mid - t, c)
  }
  for (const ch of String(text)) {
    if (ch === ":" || ch === ".") {
      if (ch === ":") {
        rect(b, cx, y + Math.floor(digitH * 0.28), thick, thick, on)
        rect(b, cx, y + Math.floor(digitH * 0.68), thick, thick, on)
      } else rect(b, cx, y + digitH - thick, thick, thick, on)
      cx += 3 + gap
      continue
    }
    if (ch === "/") {
      const ww = digitW - 2
      for (let k = 0; k < digitH; k++) rect(b, cx + Math.floor(((digitH - 1 - k) * ww) / digitH), y + k, thick, 1, on)
      cx += ww + gap
      continue
    }
    const lit = SEGMENTS[ch] ?? SEGMENTS[String(ch).toUpperCase()] ?? ""
    for (const s of "abcdefg") {
      const c = lit.includes(s) ? on : off
      if (c >= 0) seg(s, c, cx)
    }
    cx += digitW + gap
  }
  return w
}
