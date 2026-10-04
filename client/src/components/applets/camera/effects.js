// Camera and Photos' retro effects, done by hand on pixels so they work the same in every
// browser (no CSS filters, no WebGL). Every effect takes an image shaped like ImageData
// ({ data: Uint8ClampedArray RGBA, width, height }) and changes its pixels in place.
// Options: scale (how big the picture is next to a 480-pixel one, so scanlines and pixel
// blocks look the same in the small preview and the saved photo) and t (a frame number,
// for the VHS tape's moving noise). Nothing here touches the DOM, so Node can test it.

export const EFFECTS = [
  { id: "none", label: "Normal" },
  { id: "sepia", label: "Sepia" },
  { id: "mono", label: "Black & White" },
  { id: "crt", label: "CRT Monitor" },
  { id: "websafe", label: "Web Safe 216" },
  { id: "handheld", label: "Handheld" },
  { id: "pixel", label: "Pixelate" },
  { id: "vhs", label: "VHS Tape" },
  { id: "fisheye", label: "Fisheye" },
  { id: "mirror", label: "Mirror" },
  { id: "thermal", label: "Heat Vision" },
  { id: "negative", label: "Negative" },
  { id: "popart", label: "Pop Art" },
]

export const effectLabel = (id) => EFFECTS.find((e) => e.id === id)?.label || "Normal"

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b

// a small seeded random number generator (mulberry32): the same t gives the same noise
export const seeded = (seed) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// the 4x4 ordered-dither threshold map, as offsets from -0.5 to +0.5
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5)
export const bayerAt = (x, y) => BAYER[(y & 3) * 4 + (x & 3)]

// one channel to the nearest of `levels` evenly spaced values, nudged by a dither offset
export const quantize = (v, levels, offset = 0) => {
  const step = 255 / (levels - 1)
  const q = Math.round(v / step + offset)
  return clamp(Math.max(0, Math.min(levels - 1, q)) * step)
}

// the 216 "web safe" colors are 6 levels per channel: 0, 51, 102, 153, 204, 255
export const WEB_SAFE_LEVELS = [0, 51, 102, 153, 204, 255]

// a handheld game's four greens, darkest first
export const HANDHELD = [
  [15, 56, 15],
  [48, 98, 48],
  [139, 172, 15],
  [155, 188, 15],
]

// heat vision: cold to hot
const HEAT = [
  [0, 0, 0],
  [20, 0, 120],
  [140, 0, 160],
  [230, 30, 40],
  [255, 150, 0],
  [255, 240, 80],
  [255, 255, 255],
]
const gradient = (stops, v) => {
  const p = (v / 255) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(p))
  const f = p - i
  const a = stops[i]
  const b = stops[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

const perPixel = (img, fn) => {
  const d = img.data
  for (let i = 0; i < d.length; i += 4) fn(d, i)
}

const sepia = (img) =>
  perPixel(img, (d, i) => {
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    d[i] = clamp(r * 0.393 + g * 0.769 + b * 0.189)
    d[i + 1] = clamp(r * 0.349 + g * 0.686 + b * 0.168)
    d[i + 2] = clamp(r * 0.272 + g * 0.534 + b * 0.131)
  })

const mono = (img) =>
  perPixel(img, (d, i) => {
    // a little extra contrast, like a newspaper photo
    const v = clamp((luma(d[i], d[i + 1], d[i + 2]) - 128) * 1.15 + 128)
    d[i] = d[i + 1] = d[i + 2] = v
  })

const negative = (img) =>
  perPixel(img, (d, i) => {
    d[i] = 255 - d[i]
    d[i + 1] = 255 - d[i + 1]
    d[i + 2] = 255 - d[i + 2]
  })

const thermal = (img) =>
  perPixel(img, (d, i) => {
    const [r, g, b] = gradient(HEAT, luma(d[i], d[i + 1], d[i + 2]))
    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
  })

const popart = (img) =>
  perPixel(img, (d, i) => {
    // saturate, then posterize to 4 levels a channel
    const l = luma(d[i], d[i + 1], d[i + 2])
    for (let c = 0; c < 3; c++) d[i + c] = quantize(clamp(l + (d[i + c] - l) * 1.8), 4)
  })

// average color of each block x block square
const pixelate = (img, block) => {
  const { data: d, width: w, height: h } = img
  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      const ex = Math.min(w, bx + block)
      const ey = Math.min(h, by + block)
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4
          r += d[i]
          g += d[i + 1]
          b += d[i + 2]
          n++
        }
      }
      r /= n
      g /= n
      b /= n
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4
          d[i] = r
          d[i + 1] = g
          d[i + 2] = b
        }
      }
    }
  }
}

// chunky pixels (cell x cell), each dithered to a palette: the 8-bit look
const dithered = (img, cell, toColor) => {
  pixelate(img, cell)
  const { data: d, width: w, height: h } = img
  for (let y = 0; y < h; y++) {
    const cy = Math.floor(y / cell)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const [r, g, b] = toColor(d[i], d[i + 1], d[i + 2], bayerAt(Math.floor(x / cell), cy))
      d[i] = r
      d[i + 1] = g
      d[i + 2] = b
    }
  }
}

const websafe = (img, scale) => dithered(img, Math.max(1, Math.round(scale * 1.5)), (r, g, b, o) => [quantize(r, 6, o), quantize(g, 6, o), quantize(b, 6, o)])

const handheld = (img, scale) =>
  dithered(img, Math.max(2, Math.round(scale * 3)), (r, g, b, o) => {
    const shade = Math.round(Math.max(0, Math.min(3, (luma(r, g, b) / 255) * 3 + o)))
    return HANDHELD[shade]
  })

// scanlines, a little glow on each color stripe, rounded dark corners
const crt = (img, scale) => {
  const { data: d, width: w, height: h } = img
  const period = Math.max(2, Math.round(3 * scale))
  const cx = w / 2
  const cy = h / 2
  const maxD = cx * cx + cy * cy
  for (let y = 0; y < h; y++) {
    const line = y % period === period - 1 ? 0.5 : 1.08
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const dx = x - cx
      const dy = y - cy
      const vignette = 1 - 0.45 * ((dx * dx + dy * dy) / maxD)
      const stripe = Math.floor(x / Math.max(1, Math.round(scale))) % 3
      const k = line * vignette
      d[i] = clamp(d[i] * k * (stripe === 0 ? 1.12 : 0.94))
      d[i + 1] = clamp(d[i + 1] * k * (stripe === 1 ? 1.12 : 0.94))
      d[i + 2] = clamp(d[i + 2] * k * (stripe === 2 ? 1.12 : 0.94))
    }
  }
}

// a worn tape: colors bleed sideways, rows wobble, snow, and a tracking band rolling down
const vhs = (img, scale, t) => {
  const { data: d, width: w, height: h } = img
  const src = new Uint8ClampedArray(d)
  const rand = seeded(1234 + t * 7919)
  const shift = Math.max(1, Math.round(3 * scale))
  const band = ((t * 3) % (h + 40)) - 20 // the tracking band's top row
  const bandH = Math.max(4, Math.round(10 * scale))
  for (let y = 0; y < h; y++) {
    const inBand = y >= band && y < band + bandH
    const wobble = Math.round(Math.sin((y + t * 2) * 0.09) * scale * 0.8) + (inBand ? Math.round((rand() - 0.3) * 12 * scale) : 0)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const at = (xx) => (y * w + Math.max(0, Math.min(w - 1, xx))) * 4
      const r = src[at(x - wobble + shift)]
      const g = src[at(x - wobble) + 1]
      const b = src[at(x - wobble - shift) + 2]
      // washed-out colors
      const l = luma(r, g, b)
      const noise = (rand() - 0.5) * (inBand ? 90 : 26)
      d[i] = clamp(l + (r - l) * 0.75 + noise + 6)
      d[i + 1] = clamp(l + (g - l) * 0.75 + noise)
      d[i + 2] = clamp(l + (b - l) * 0.75 + noise + 4)
    }
  }
}

// the middle swells toward you, like a peephole
const fisheye = (img) => {
  const { data: d, width: w, height: h } = img
  const src = new Uint8ClampedArray(d)
  const cx = (w - 1) / 2
  const cy = (h - 1) / 2
  const radius = Math.min(w, h) * 0.55
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = bulgeSource(x, y, cx, cy, radius)
      const i = (y * w + x) * 4
      const j = (Math.round(sy) * w + Math.round(sx)) * 4
      d[i] = src[j]
      d[i + 1] = src[j + 1]
      d[i + 2] = src[j + 2]
    }
  }
}

// Where a fisheye pixel takes its color from: inside the circle, closer to the middle
export const bulgeSource = (x, y, cx, cy, radius, power = 1.8) => {
  const dx = x - cx
  const dy = y - cy
  const dist = Math.hypot(dx, dy)
  if (dist >= radius || dist === 0) return [x, y]
  const k = Math.pow(dist / radius, power - 1)
  return [cx + dx * k, cy + dy * k]
}

// the left half, reflected onto the right
const mirror = (img) => {
  const { data: d, width: w, height: h } = img
  const half = Math.floor(w / 2)
  for (let y = 0; y < h; y++) {
    for (let x = w - half; x < w; x++) {
      const i = (y * w + x) * 4
      const j = (y * w + (w - 1 - x)) * 4
      d[i] = d[j]
      d[i + 1] = d[j + 1]
      d[i + 2] = d[j + 2]
    }
  }
}

// Apply an effect by id. Unknown ids leave the picture alone. Returns the image.
export const applyEffect = (id, img, { scale = img.width / 480, t = 0 } = {}) => {
  const s = Math.max(0.25, scale)
  switch (id) {
    case "sepia":
      sepia(img)
      break
    case "mono":
      mono(img)
      break
    case "negative":
      negative(img)
      break
    case "thermal":
      thermal(img)
      break
    case "popart":
      popart(img)
      break
    case "pixel":
      pixelate(img, Math.max(4, Math.round(10 * s)))
      break
    case "websafe":
      websafe(img, s)
      break
    case "handheld":
      handheld(img, s)
      break
    case "crt":
      crt(img, s)
      break
    case "vhs":
      vhs(img, s, t)
      break
    case "fisheye":
      fisheye(img)
      break
    case "mirror":
      mirror(img)
      break
    default:
      break
  }
  return img
}

// Brightness and contrast, -100 to 100 each, the same math as CSS
// `filter: brightness(1 + b/100) contrast(1 + c/100)` so a live preview matches the result
export const adjustPixels = (img, { brightness = 0, contrast = 0 } = {}) => {
  const bf = 1 + brightness / 100
  const cf = 1 + contrast / 100
  perPixel(img, (d, i) => {
    for (let c = 0; c < 3; c++) d[i + c] = clamp((d[i + c] * bf - 127.5) * cf + 127.5)
  })
  return img
}

export const adjustFilterCss = ({ brightness = 0, contrast = 0 } = {}) => `brightness(${1 + brightness / 100}) contrast(${1 + contrast / 100})`
