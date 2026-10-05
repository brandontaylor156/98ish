// Palettes for the retro look (pure, tested in retro.test.js). A 90s game drew into a
// 256-colour (or 16-colour) screen: every pixel is an INDEX into a palette, and tricks like
// a flash, a frozen tint or a glowing pad were done by changing or remapping palette
// entries rather than mixing colours. The kit works the same way: games build a palette of at
// most 256 named colours, draw indices into a bitmap (bitmap.js), and present it through the
// palette's lookup table.
//
//   const pal = createPalette([["sky", "#5aa0ff"], ...])   index 0 is always "clear"
//   pal.idx("sky") -> 1      pal.ramp("bomb", ["#111", "#333", "#555"]) -> [i, j, k]
//   pal.lut          Uint32Array of ABGR words for ImageData (index 0 transparent)
//   nearest(pal, r, g, b)    the closest entry (quantize)
//   WIN16            the Windows 16-colour system palette; vga256() the VGA default palette

export const hexToRgb = (hex) => {
  let h = String(hex).replace("#", "")
  if (h.length === 3) h = h.split("").map((c) => c + c).join("")
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const rgbToHex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`

// ABGR as a little-endian Uint32 (what an ImageData's Uint32Array view expects)
export const packRgb = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0

// the 16 colours of Windows 3.1/95/98's system palette (the 20 minus the 4 reserved extras)
export const WIN16 = [
  ["black", "#000000"],
  ["maroon", "#800000"],
  ["green", "#008000"],
  ["olive", "#808000"],
  ["navy", "#000080"],
  ["purple", "#800080"],
  ["teal", "#008080"],
  ["silver", "#c0c0c0"],
  ["gray", "#808080"],
  ["red", "#ff0000"],
  ["lime", "#00ff00"],
  ["yellow", "#ffff00"],
  ["blue", "#0000ff"],
  ["fuchsia", "#ff00ff"],
  ["aqua", "#00ffff"],
  ["white", "#ffffff"],
]

// The colours every game palette starts with, so the shared pieces (98-style bevels, the
// LED counters, panels, the pixel font's shadow) can find them by name.
export const UI_COLORS = [
  ["black", "#000000"],
  ["white", "#ffffff"],
  ["face", "#c0c0c0"], // a 98 button's face
  ["light", "#dfdfdf"], // its inner highlight
  ["shadow", "#808080"], // its inner shadow
  ["dark", "#404040"],
  ["navy", "#000080"], // a title bar
  ["ledBg", "#000000"],
  ["ledOn", "#ff2010"],
  ["ledOff", "#3a0804"],
  ["ledGreen", "#30ff40"],
  ["ledGreenOff", "#08300c"],
  ["gold", "#ffd800"],
]

// The VGA's default 256-colour palette (mode 13h), built the way the BIOS table is laid out:
// 16 EGA colours, 16 greys, then 9 blocks of 24 hues (3 brightnesses x 3 saturations).
export const vga256 = () => {
  const out = []
  const ega = ["#000000", "#0000aa", "#00aa00", "#00aaaa", "#aa0000", "#aa00aa", "#aa5500", "#aaaaaa", "#555555", "#5555ff", "#55ff55", "#55ffff", "#ff5555", "#ff55ff", "#ffff55", "#ffffff"]
  ega.forEach((h) => out.push(hexToRgb(h)))
  const greys = [0, 5, 8, 11, 14, 17, 20, 24, 28, 32, 36, 40, 45, 50, 56, 63]
  greys.forEach((v) => out.push([v * 4 + (v >> 4), v * 4 + (v >> 4), v * 4 + (v >> 4)].map((x) => Math.min(255, x))))
  // each block: a ring of 24 hues between a "high" and a "low" channel value (6-bit DAC)
  const blocks = [
    [63, 0],
    [63, 31],
    [63, 45],
    [28, 0],
    [28, 14],
    [28, 20],
    [16, 0],
    [16, 8],
    [16, 11],
  ]
  for (const [hi, lo] of blocks) {
    const steps = [lo, lo + (hi - lo) / 4, lo + (hi - lo) / 2, lo + ((hi - lo) * 3) / 4]
    const ring = []
    // blue -> magenta -> red -> yellow -> green -> cyan -> back to blue, 4 steps per edge
    for (let k = 0; k < 4; k++) ring.push([steps[k], lo, hi])
    for (let k = 0; k < 4; k++) ring.push([hi, lo, steps[3 - k]])
    for (let k = 0; k < 4; k++) ring.push([hi, steps[k], lo])
    for (let k = 0; k < 4; k++) ring.push([steps[3 - k], hi, lo])
    for (let k = 0; k < 4; k++) ring.push([lo, hi, steps[k]])
    for (let k = 0; k < 4; k++) ring.push([lo, steps[3 - k], hi])
    ring.forEach((c) => out.push(c.map((v) => Math.min(255, Math.round(v * 4.048)))))
  }
  while (out.length < 256) out.push([0, 0, 0])
  return out.slice(0, 256)
}

// the lookup table (index -> ABGR word); index 0 transparent
const buildLut = (rgb, over = null) => {
  const lut = new Uint32Array(256)
  rgb.forEach(([r, g, b], i) => (lut[i] = i === 0 ? 0 : packRgb(r, g, b)))
  if (over) for (const [i, hex] of over) lut[i] = packRgb(...hexToRgb(hex))
  return lut
}

// A palette from [[name, hex]...] (or {name: hex}). Index 0 is "clear" (transparent in an
// overlay, never drawn by sprites). Names may repeat a colour; up to 256 entries.
export const createPalette = (entries = []) => {
  const list = Array.isArray(entries) ? entries : Object.entries(entries)
  const names = new Map([["clear", 0]])
  const rgb = [[0, 0, 0]]
  let lut = null
  const pal = {
    names,
    rgb,
    get size() {
      return rgb.length
    },
    // index -> ABGR words for ImageData (rebuilt after add)
    get lut() {
      return lut || (lut = buildLut(rgb))
    },
    // adds a colour (or returns the index a name already has)
    add(name, hex) {
      if (names.has(name)) return names.get(name)
      if (rgb.length >= 256) throw new Error(`palette full (adding ${name})`)
      rgb.push(hexToRgb(hex))
      names.set(name, rgb.length - 1)
      lut = null
      return rgb.length - 1
    },
    idx(name) {
      const i = names.get(name)
      if (i === undefined) throw new Error(`no colour "${name}" in the palette`)
      return i
    },
    has: (name) => names.has(name),
    // a shading ramp, dark to light: registers name0..nameN, returns their indices
    ramp(name, hexes) {
      return hexes.map((h, k) => pal.add(`${name}${k}`, h))
    },
    hex: (i) => rgbToHex(...rgb[i]),
    // a copy of the lookup table with some entries replaced: palette cycling and flashes
    // changes: { name | index: "#hex" }
    lutWith(changes) {
      const pairs = Object.entries(changes).map(([k, hex]) => [/^\d+$/.test(k) ? Number(k) : pal.idx(k), hex])
      return buildLut(rgb, pairs)
    },
  }
  for (const [n, h] of list) pal.add(n, h)
  return pal
}

// perceptual-ish distance ("redmean"), cheap and good enough for picking a palette entry
export const colorDistance = (a, b) => {
  const rm = (a[0] + b[0]) / 2
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db
}

// the palette entry closest to a colour (skipping index 0, "clear")
export const nearest = (pal, r, g, b) => {
  const rgb = Array.isArray(pal) ? pal : pal.rgb
  const start = Array.isArray(pal) ? 0 : 1
  let best = start
  let bestD = Infinity
  for (let i = start; i < rgb.length; i++) {
    const d = colorDistance([r, g, b], rgb[i])
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

// a remap table (256 entries) sending every colour to the closest one of `targets` after
// `fn` changes it (e.g. an icy tint, a darker shadow, greyed-out): a 256-colour trick
export const remapTable = (pal, fn, targets = null) => {
  const table = new Uint8Array(256)
  const pool = targets ? targets.map((i) => pal.rgb[i]) : null
  for (let i = 0; i < 256; i++) {
    if (i === 0 || i >= pal.rgb.length) {
      table[i] = i
      continue
    }
    const [r, g, b] = fn(pal.rgb[i], i)
    table[i] = pool ? targets[nearest(pool, r, g, b)] : nearest(pal, r, g, b)
  }
  return table
}

// common colour changes for remapTable
export const tint = {
  darker: (k = 0.6) => ([r, g, b]) => [r * k, g * k, b * k],
  grey: () => ([r, g, b]) => {
    const y = r * 0.3 + g * 0.59 + b * 0.11
    return [y, y, y]
  },
  ice: () => ([r, g, b]) => {
    const y = r * 0.3 + g * 0.59 + b * 0.11
    return [y * 0.55 + 40, y * 0.8 + 50, y * 0.6 + 120]
  },
  red: () => ([r, g, b]) => {
    const y = r * 0.3 + g * 0.59 + b * 0.11
    return [y * 0.5 + 140, y * 0.45, y * 0.35]
  },
  flash: () => () => [255, 255, 255],
}
