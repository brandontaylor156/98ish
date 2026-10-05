import { canvas, disc, get, line, outline, over, rect, set, stamp } from "../../../utils/pixelArt.js"

// 98ish Weather's icons: original 32x32 pixel art in the Windows 98 manner (bright
// fills, light from the top left, black outlines), drawn with utils/pixelArt.js.
// artFor(icon) -> a canvas (cached); ICONS lists them all.

const SUN = { base: "#ffd800", light: "#fff79a", dark: "#f0a000" }
const RAY = "#ff9c00"
const MOON = { base: "#fff0a0", light: "#fffbe0", dark: "#d8c060" }
const CLOUD = { base: "#ffffff", light: "#ffffff", dark: "#c0c0c0" }
const GREY_CLOUD = { base: "#c0c0c0", light: "#e0e0e0", dark: "#909090" }
const STORM_CLOUD = { base: "#808080", light: "#a0a0a0", dark: "#505050" }
const RAIN = "#0060ff"
const RAIN_LIGHT = "#60a0ff"
const FLAKE = "#ffffff"
const FLAKE_EDGE = "#5080c0"
const BOLT = "#ffe000"
const FOG = "#d0d0d0"
const STAR = "#fff8c0"

const layer = (draw) => {
  const c = canvas(32, 32)
  draw(c)
  return c
}

const sunLayer = (cx, cy, r, rays = true) =>
  layer((c) => {
    if (rays) {
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4
        const x0 = Math.round(cx + Math.cos(a) * (r + 2) - 0.5)
        const y0 = Math.round(cy + Math.sin(a) * (r + 2) - 0.5)
        const x1 = Math.round(cx + Math.cos(a) * (r + 4.5) - 0.5)
        const y1 = Math.round(cy + Math.sin(a) * (r + 4.5) - 0.5)
        line(c, x0, y0, x1, y1, RAY)
      }
    }
    disc(c, cx, cy, r, SUN)
    outline(c)
  })

// a crescent; facing -1 opens to the left (the lit side on the right)
const moonLayer = (cx, cy, r, facing = 1) =>
  layer((c) => {
    disc(c, cx, cy, r, MOON)
    disc(c, cx + facing * r * 0.55, cy - r * 0.45, r * 0.85, null)
    // a couple of craters
    set(c, Math.round(cx - facing * r * 0.45), Math.round(cy + r * 0.1), MOON.dark)
    set(c, Math.round(cx - facing * r * 0.1), Math.round(cy + r * 0.5), MOON.dark)
    outline(c)
  })

// a puffy cloud: three puffs and a flat bottom; (x, y) is its top left, w its width
const cloudLayer = (x, y, w, colors = CLOUD) =>
  layer((c) => {
    const s = w / 24
    disc(c, x + 6 * s, y + 9 * s, 5 * s, colors.base)
    disc(c, x + 12.5 * s, y + 6 * s, 6.5 * s, colors.base)
    disc(c, x + 18.5 * s, y + 9.5 * s, 4.8 * s, colors.base)
    rect(c, Math.round(x + 4 * s), Math.round(y + 9 * s), Math.round(16 * s), Math.round(5 * s), colors.base)
    // lit along the top, shaded along the bottom and the right
    const filled = (px, py) => !!get(c, px, py)
    const shade = []
    for (let py = 0; py < 32; py++)
      for (let px = 0; px < 32; px++) {
        if (!filled(px, py)) continue
        if (!filled(px, py + 1) || !filled(px, py + 2) || !filled(px + 1, py)) shade.push([px, py, colors.dark])
        else if (!filled(px, py - 1) || !filled(px - 1, py)) shade.push([px, py, colors.light])
      }
    shade.forEach(([px, py, color]) => set(c, px, py, color))
    outline(c)
  })

const star = (c, x, y) => {
  set(c, x, y, STAR)
  set(c, x - 1, y, STAR)
  set(c, x + 1, y, STAR)
  set(c, x, y - 1, STAR)
  set(c, x, y + 1, STAR)
}

const drops = (c, spots, color = RAIN, length = 3) =>
  spots.forEach(([x, y]) => {
    line(c, x, y, x - 1, y + length - 1, color)
    set(c, x, y, RAIN_LIGHT)
  })

// six-armed flakes, white with a blue edge
const flakes = (c, spots) => {
  const f = canvas(32, 32)
  spots.forEach(([x, y]) => stamp(f, x - 2, y - 2, ["w...w", ".w.w.", "..w..", ".w.w.", "w...w"].map((r, i) => (i === 2 ? "wwwww" : r)), { w: FLAKE }))
  outline(f, FLAKE_EDGE)
  over(c, f)
}

const bolt = (c, x, y) => {
  stamp(c, x, y, ["...kkkkk", "...kyyyk", "..kyyyk.", "..kyyk..", ".kyyykkk", ".kyyyyyk", ".kkkkyk.", "....kyk.", "...kyk..", "...kk...", "..kk...."], { k: "#000000", y: BOLT })
}

const DRAW = {
  "clear-day": () => sunLayer(16, 16, 8),
  "clear-night": () =>
    layer((c) => {
      over(c, moonLayer(15, 17, 10))
      star(c, 25, 6)
      star(c, 6, 5)
      set(c, 27, 14, STAR)
    }),
  "partly-day": () =>
    layer((c) => {
      over(c, sunLayer(12, 11, 6))
      over(c, cloudLayer(7, 12, 24))
    }),
  "partly-night": () =>
    layer((c) => {
      over(c, moonLayer(11, 11, 7))
      star(c, 26, 5)
      over(c, cloudLayer(7, 12, 24))
    }),
  cloudy: () =>
    layer((c) => {
      over(c, cloudLayer(9, 3, 22, GREY_CLOUD))
      over(c, cloudLayer(1, 11, 25))
    }),
  fog: () =>
    layer((c) => {
      over(c, cloudLayer(4, 2, 24, GREY_CLOUD))
      const bars = layer((b) => {
        rect(b, 3, 20, 20, 2, FOG)
        rect(b, 9, 24, 21, 2, FOG)
        rect(b, 2, 28, 17, 2, FOG)
        outline(b, "#606060")
      })
      over(c, bars)
    }),
  drizzle: () =>
    layer((c) => {
      over(c, cloudLayer(4, 2, 24, GREY_CLOUD))
      drops(c, [[10, 21], [17, 23], [24, 21], [13, 27], [21, 28]], RAIN, 2)
    }),
  rain: () =>
    layer((c) => {
      over(c, cloudLayer(4, 2, 24, GREY_CLOUD))
      drops(c, [[9, 20], [14, 21], [19, 20], [24, 21], [11, 26], [16, 27], [21, 26], [26, 27]], RAIN, 4)
    }),
  "showers-day": () =>
    layer((c) => {
      over(c, sunLayer(22, 9, 5))
      over(c, cloudLayer(2, 6, 22))
      drops(c, [[8, 22], [13, 23], [18, 22], [10, 27], [16, 28]], RAIN, 3)
    }),
  "showers-night": () =>
    layer((c) => {
      over(c, moonLayer(22, 8, 7, -1))
      star(c, 9, 3)
      over(c, cloudLayer(2, 6, 22))
      drops(c, [[8, 22], [13, 23], [18, 22], [10, 27], [16, 28]], RAIN, 3)
    }),
  sleet: () =>
    layer((c) => {
      over(c, cloudLayer(4, 2, 24, GREY_CLOUD))
      drops(c, [[10, 20], [21, 21], [15, 26]], RAIN, 4)
      flakes(c, [[15, 21], [25, 26], [8, 27]])
    }),
  snow: () =>
    layer((c) => {
      over(c, cloudLayer(4, 2, 24, GREY_CLOUD))
      flakes(c, [[9, 21], [17, 22], [25, 21], [13, 27], [22, 28]])
    }),
  storm: () =>
    layer((c) => {
      over(c, cloudLayer(3, 1, 26, STORM_CLOUD))
      drops(c, [[8, 21], [23, 20], [26, 26], [10, 27]], RAIN, 4)
      bolt(c, 12, 16)
    }),
  wind: () =>
    layer((c) => {
      // three gusts, two ending in a curl, and a leaf blown along
      const gusts = layer((g) => {
        const W = "#ffffff"
        // a gust two pixels thick from x0 to x1 on rows y, y+1, curling up (or down) at the end
        const gust = (y, x0, x1, curl = 0) => {
          rect(g, x0, y, x1 - x0 + 1, 2, W)
          if (!curl) return
          const cy = curl < 0 ? y - 2 : y + 3
          const ring = canvas(32, 32)
          disc(ring, x1 + 0.5, cy + 0.5, 3.6, W)
          disc(ring, x1 + 0.5, cy + 0.5, 1.7, null)
          // open on the side the gust comes from
          for (let py = 0; py < 32; py++) for (let px = 0; px <= x1; px++) if (curl < 0 ? py > cy : py <= cy) set(ring, px, py, null)
          over(g, ring)
        }
        gust(9, 2, 20, -1)
        gust(16, 5, 28)
        gust(23, 2, 17, 1)
        outline(g, "#3a3a3a")
      })
      over(c, gusts)
      const leaf = layer((l) => {
        stamp(l, 24, 3, [".gg", "gGg", "gg."], { g: "#20a020", G: "#80e060" })
        outline(l)
      })
      over(c, leaf)
    }),
}

export const ICONS = Object.keys(DRAW)

const cache = new Map()
export const artFor = (icon) => {
  const name = DRAW[icon] ? icon : "cloudy"
  if (!cache.has(name)) cache.set(name, DRAW[name]())
  return cache.get(name)
}
