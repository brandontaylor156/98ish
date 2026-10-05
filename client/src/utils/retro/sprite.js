// Palette-indexed pixel sprites, authored as strings in code (pure, tested in retro.test.js).
//
//   const legend = { k: pal.idx("black"), w: pal.idx("white"), r: pal.idx("red") }
//   const heart = sprite([
//     ".rr.rr.",
//     "rrwrrrr",
//     ".rrrrr.",
//     "..rrr..",
//     "...r...",
//   ], legend)                       "." and " " are see-through (index 0)
//   blit(bitmap, heart, x, y)        (bitmap.js)
//
//   outlined(s, color)    a copy with a 1-pixel outline round the shape (1 px bigger each side)
//   recolor(s, map)       a copy with colours swapped ({ from: to } or a 256-entry table)
//   flipped(s), rotated(s) (quarter turns), padded(s, n), toBitmap/fromBitmap

import { createBitmap } from "./bitmap.js"

export const sprite = (rows, legend) => {
  const h = rows.length
  const w = Math.max(...rows.map((r) => r.length))
  const data = new Uint8Array(w * h)
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const ch = r[x]
      if (ch === "." || ch === " ") continue
      const c = legend[ch]
      if (c === undefined) throw new Error(`sprite: no colour for "${ch}"`)
      data[y * w + x] = c
    }
  })
  return { w, h, data }
}

export const blank = (w, h) => ({ w, h, data: new Uint8Array(w * h) })

// a sprite from a bitmap (or any { w, h, data }), e.g. one drawn with the bitmap tools
export const fromBitmap = (b) => ({ w: b.w, h: b.h, data: b.data.slice() })
export const toBitmap = (s) => {
  const b = createBitmap(s.w, s.h)
  b.data.set(s.data)
  return b
}

export const outlined = (s, color) => {
  const w = s.w + 2
  const h = s.h + 2
  const data = new Uint8Array(w * h)
  const at = (x, y) => (x >= 0 && y >= 0 && x < s.w && y < s.h ? s.data[y * s.w + x] : 0)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = at(x - 1, y - 1)
      if (c) data[y * w + x] = c
      else if (at(x - 2, y - 1) || at(x, y - 1) || at(x - 1, y - 2) || at(x - 1, y)) data[y * w + x] = color
    }
  }
  return { w, h, data }
}

export const recolor = (s, map) => {
  const table = map instanceof Uint8Array ? map : null
  const data = s.data.map((c) => (c === 0 ? 0 : table ? table[c] : (map[c] ?? c)))
  return { w: s.w, h: s.h, data }
}

export const flipped = (s, { x = true, y = false } = {}) => {
  const data = new Uint8Array(s.w * s.h)
  for (let yy = 0; yy < s.h; yy++) for (let xx = 0; xx < s.w; xx++) data[yy * s.w + xx] = s.data[(y ? s.h - 1 - yy : yy) * s.w + (x ? s.w - 1 - xx : xx)]
  return { w: s.w, h: s.h, data }
}

// quarter turns clockwise
export const rotated = (s, turns = 1) => {
  let cur = s
  for (let t = 0; t < ((turns % 4) + 4) % 4; t++) {
    const w = cur.h
    const h = cur.w
    const data = new Uint8Array(w * h)
    for (let y = 0; y < cur.h; y++) for (let x = 0; x < cur.w; x++) data[x * w + (w - 1 - y)] = cur.data[y * cur.w + x]
    cur = { w, h, data }
  }
  return cur
}

export const padded = (s, n = 1) => {
  const w = s.w + n * 2
  const h = s.h + n * 2
  const data = new Uint8Array(w * h)
  for (let y = 0; y < s.h; y++) data.set(s.data.subarray(y * s.w, (y + 1) * s.w), (y + n) * w + n)
  return { w, h, data }
}

// nearest-neighbour scale to a new size (chunky, no smoothing)
export const scaled = (s, w, h) => {
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = s.data[Math.floor((y * s.h) / h) * s.w + Math.floor((x * s.w) / w)]
  return { w, h, data }
}
