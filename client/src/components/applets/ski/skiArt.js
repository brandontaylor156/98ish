// Downhill's pixel art, all drawn here in code: little offscreen canvases (one canvas pixel
// per world unit) that the game scales up with smoothing off.

import { ANGLES } from "./skiEngine.js"

const canvas = (w, h, draw) => {
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h })
  const ctx = c.getContext("2d")
  const px = (x, y, color, ww = 1, hh = 1) => {
    ctx.fillStyle = color
    ctx.fillRect(Math.round(x), Math.round(y), ww, hh)
  }
  draw(px, ctx)
  return c
}

// A pine: layered triangles, shaded on the right, snow on the left tips. `ax`/`ay` is the
// point that sits on the snow (the middle of the trunk's foot).
const pine = (w, layers, light, dark, snowy) => {
  const h = layers * 6 + 6
  return {
    ax: Math.floor(w / 2),
    ay: h - 1,
    img: canvas(w, h, (px) => {
      const mid = Math.floor(w / 2)
      px(mid - 1, h - 5, "#6b4220", 3, 5)
      px(mid + 1, h - 5, "#4a2c14", 1, 5)
      for (let l = 0; l < layers; l++) {
        const top = l * 6
        const rows = l === 0 ? 7 : 8
        for (let r = 0; r < rows; r++) {
          const half = Math.min(Math.floor(w / 2), Math.floor(((l + 1) * (r + 1)) / 2.2) + (l === 0 ? 0 : 1))
          for (let x = -half; x <= half; x++) px(mid + x, top + r, x > half / 3 ? dark : light)
          if (snowy && r === rows - 1) px(mid - half, top + r, "#ffffff", Math.max(1, Math.floor(half * 0.8)), 1)
        }
      }
      px(mid, 0, "#ffffff")
    }),
  }
}

const rock = (w, h) => ({
  ax: Math.floor(w / 2),
  ay: h - 2,
  img: canvas(w, h, (px) => {
    for (let y = 0; y < h; y++) {
      const t = y / (h - 1)
      const half = Math.round((w / 2) * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.62) / 0.62, 2))))
      for (let x = -half; x < half; x++) {
        const shade = x > half * 0.3 || y > h - 3 ? "#5e6168" : x < -half * 0.4 && y < h / 2 ? "#c3c7cf" : "#8b8f98"
        px(w / 2 + x, y, shade)
      }
    }
    px(w / 2 - 3, 1, "#ffffff", 5, 1)
    px(w / 2 - 4, 2, "#ffffff", 3, 1)
  }),
})

const stump = () => ({
  ax: 5,
  ay: 8,
  img: canvas(11, 10, (px) => {
    px(1, 3, "#6b4220", 9, 6)
    px(7, 3, "#4a2c14", 3, 6)
    px(1, 1, "#c9a26b", 9, 3)
    px(3, 2, "#9a7444", 5, 1)
    px(1, 0, "#ffffff", 6, 1)
    px(0, 8, "#4a2c14", 11, 1)
  }),
})

const deadTree = () => ({
  ax: 5,
  ay: 21,
  img: canvas(12, 22, (px) => {
    px(5, 4, "#5a3a20", 2, 18)
    px(2, 7, "#5a3a20", 3, 1)
    px(1, 5, "#5a3a20", 1, 2)
    px(7, 10, "#5a3a20", 3, 1)
    px(10, 8, "#5a3a20", 1, 2)
    px(3, 13, "#5a3a20", 2, 1)
    px(5, 3, "#ffffff", 2, 1)
    px(1, 4, "#ffffff", 1, 1)
  }),
})

const mogul = () => ({
  ax: 12,
  ay: 5,
  img: canvas(24, 8, (px) => {
    for (let y = 0; y < 8; y++) {
      const half = Math.round(12 * Math.sqrt(Math.max(0, 1 - Math.pow((y - 5) / 5, 2))))
      for (let x = -half; x < half; x++) px(12 + x, y, y >= 5 && x > -half + 2 ? "#c6d6f0" : "#ffffff")
    }
    px(5, 6, "#a9bde2", 15, 1)
  }),
})

const ramp = () => ({
  ax: 14,
  ay: 8,
  img: canvas(28, 12, (px) => {
    px(0, 2, "#f8fbff", 28, 6)
    px(1, 8, "#8a5a2e", 26, 3)
    px(1, 8, "#b07a44", 26, 1)
    px(0, 1, "#d4e2f7", 28, 1)
    for (let x = 3; x < 26; x += 5) px(x, 9, "#5a3a1a", 1, 2)
    px(0, 11, "#a9bde2", 28, 1)
  }),
})

const flag = (color) => ({
  ax: 1,
  ay: 17,
  img: canvas(9, 18, (px) => {
    px(1, 1, "#404040", 1, 17)
    const c = color === "red" ? "#e01818" : "#1838e0"
    const dark = color === "red" ? "#981010" : "#10208f"
    for (let r = 0; r < 6; r++) px(2, 1 + r, r < 3 ? c : dark, 6 - Math.abs(r - 2.5) * 2, 1)
    px(0, 17, "#a9bde2", 3, 1)
  }),
})

const banner = () => ({
  ax: 30,
  ay: 23,
  img: canvas(62, 24, (px, ctx) => {
    px(2, 4, "#404040", 2, 20)
    px(58, 4, "#404040", 2, 20)
    px(4, 4, "#000080", 54, 9)
    px(4, 12, "#00005a", 54, 1)
    ctx.fillStyle = "#ffffff"
    ctx.font = "bold 8px monospace"
    ctx.textBaseline = "top"
    ctx.fillText("START", 18, 5)
  }),
})

// The skier: hat, face, jacket, legs, and skis at the heading. pose: "ski" | "air" | "trick"
// | "crash"
const skierCache = new Map()
export const skierSprite = (dir, pose, frame = 0) => {
  const key = `${dir}${pose}${frame}`
  if (skierCache.has(key)) return skierCache.get(key)
  const w = 26
  const h = 26
  const cx = 13
  const sprite = {
    ax: cx,
    ay: 21,
    img: canvas(w, h, (px) => {
      if (pose === "crash") {
        // flat on the snow, skis everywhere
        px(4, 17, "#c6d6f0", 18, 3)
        px(6, 15, "#2050d8", 8, 4)
        px(14, 16, "#202020", 6, 2)
        px(3, 15, "#f2c79a", 3, 3)
        px(2, 14, "#d81818", 3, 2)
        for (let i = 0; i < 9; i++) {
          px(5 + i * 2, 21 - i, "#d81818", 2, 1)
          px(4 + i * 2, 11 + i, "#e8a000", 2, 1)
        }
        px(17, 5, "#ffffff", 1, 1)
        px(19, 3, "#ffffff", 1, 1)
        return
      }
      const angle = (ANGLES[dir + 3] * Math.PI) / 180
      const lean = Math.round(Math.sin(angle) * 2)
      // skis: two parallel lines at the heading (crossed for a trick)
      const ski = (offset, a) => {
        for (let t = -6; t <= 7; t++) {
          const x = cx + offset * Math.cos(a) + Math.sin(a) * t
          const y = 19 + -offset * Math.sin(a) * 0.4 + Math.cos(a) * t * 0.55
          px(x, y, t > 5 ? "#ff6060" : "#d81818", 2, 1)
        }
      }
      if (pose === "trick") {
        ski(0, angle + 0.8)
        ski(0, angle - 0.8)
      } else {
        ski(-2, angle)
        ski(2, angle)
      }
      // legs
      const bend = pose === "air" ? 1 : 0
      px(cx - 3 + lean, 13 + bend, "#202020", 2, 5 - bend)
      px(cx + 1 + lean, 13 + bend, "#202020", 2, 5 - bend)
      // jacket and arms (poles out to the sides)
      px(cx - 4 + lean, 7, "#2050d8", 8, 7)
      px(cx - 4 + lean, 7, "#4a78ff", 2, 6)
      px(cx - 6 + lean, 8, "#2050d8", 2, 4)
      px(cx + 4 + lean, 8, "#2050d8", 2, 4)
      px(cx - 7 + lean, 11, "#404040", 1, 8 - (frame ? 1 : 0))
      px(cx + 6 + lean, 11, "#404040", 1, 8 - (frame ? 0 : 1))
      // head and hat with a bobble
      px(cx - 2 + lean, 3, "#f2c79a", 4, 4)
      px(cx - 2 + lean, 1, "#d81818", 4, 3)
      px(cx - 1 + lean, 0, "#ffffff", 2, 1)
      px(cx - 2 + lean, 3, "#ffffff", 4, 1)
    }),
  }
  skierCache.set(key, sprite)
  return sprite
}

// The Snow-Moose: a huge shaggy white moose on its hind legs, antlers and all
const mooseCache = new Map()
export const mooseSprite = (frame, carrying) => {
  const key = `${frame}${carrying}`
  if (mooseCache.has(key)) return mooseCache.get(key)
  const sprite = {
    ax: 18,
    ay: 45,
    img: canvas(36, 47, (px) => {
      const fur = "#f4f4f8"
      const shade = "#c9cfe0"
      // antlers
      const antler = "#8a5a2e"
      px(4, 2, antler, 10, 2)
      px(4, 0, antler, 2, 2)
      px(8, 0, antler, 2, 2)
      px(12, 1, antler, 2, 3)
      px(22, 2, antler, 10, 2)
      px(30, 0, antler, 2, 2)
      px(26, 0, antler, 2, 2)
      px(22, 1, antler, 2, 3)
      // head and long snout
      px(13, 4, fur, 10, 8)
      px(14, 11, fur, 8, 6)
      px(15, 16, "#e8d0c0", 6, 3)
      px(16, 17, "#5a3a3a", 1, 1)
      px(19, 17, "#5a3a3a", 1, 1)
      px(14, 7, "#d00000", 2, 2)
      px(20, 7, "#d00000", 2, 2)
      px(11, 5, fur, 2, 3)
      px(23, 5, fur, 2, 3)
      // shaggy body
      for (let y = 18; y < 38; y++) {
        const half = 9 + Math.round(Math.sin((y - 18) / 6) * 2)
        px(18 - half, y, fur, half * 2, 1)
        px(18 + half - 4, y, shade, 4, 1)
        if (y % 3 === 0) px(18 - half - 1, y, fur, 1, 1)
        if (y % 3 === 1) px(18 + half, y, shade, 1, 1)
      }
      px(15, 21, shade, 6, 1)
      px(14, 26, shade, 8, 1)
      // arms: up and grabbing, swapping as it runs
      const up = frame ? 0 : 3
      px(4, 14 + up, fur, 4, 12)
      px(28, 17 - up, fur, 4, 12)
      px(3, 13 + up, "#5a3a3a", 5, 2)
      px(28, 16 - up, "#5a3a3a", 5, 2)
      // legs
      px(10, 38, fur, 6, frame ? 7 : 5)
      px(20, 38, fur, 6, frame ? 5 : 7)
      px(10, frame ? 44 : 42, "#5a3a3a", 6, 2)
      px(20, frame ? 42 : 44, "#5a3a3a", 6, 2)
      if (carrying) {
        px(12, 24, "#2050d8", 10, 5)
        px(9, 24, "#f2c79a", 3, 3)
        px(8, 23, "#d81818", 3, 2)
        px(22, 25, "#202020", 5, 2)
      }
    }),
  }
  mooseCache.set(key, sprite)
  return sprite
}

let sprites = null
export const objectSprites = () =>
  (sprites ||= {
    tree: [pine(15, 3, "#1d7a3a", "#0f5226", true), pine(13, 3, "#2a8c45", "#156030", true), pine(15, 3, "#1d7a3a", "#0f5226", false), pine(13, 3, "#27803f", "#11552a", true)],
    bigtree: [pine(21, 4, "#1b6e34", "#0c4520", true), pine(21, 4, "#237d3d", "#0f5226", true), pine(19, 4, "#1b6e34", "#0c4520", false), pine(21, 4, "#1b6e34", "#0c4520", true)],
    rock: [rock(16, 9), rock(14, 8), rock(18, 10), rock(12, 7)],
    stump: [stump()],
    deadtree: [deadTree()],
    mogul: [mogul()],
    ramp: [ramp()],
    flag: { red: flag("red"), blue: flag("blue") },
    banner: banner(),
  })
