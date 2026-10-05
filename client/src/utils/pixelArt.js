// Tiny pixel-art raster for original Win98-style icons (Weather's icons, the Do Not
// Disturb moon): shapes are filled into a grid of colors, outlined in black like the icons
// of the time, and drawn as an SVG of square pixels (crisp at any size). Pure: the icon
// files in public/ are written from the same drawings.
//
//   const c = canvas(32, 32)
//   disc(c, 16, 16, 8, { base: "#ffd800", light: "#fff8a0", dark: "#ff9c00" })
//   outline(c)
//   toSvg(c) -> "<svg ...>" / rows(c) -> [{ x, y, w, color }] for React

export const canvas = (w, h) => ({ w, h, px: new Array(w * h).fill(null) })

const inside = (c, x, y) => x >= 0 && y >= 0 && x < c.w && y < c.h
export const set = (c, x, y, color) => {
  if (inside(c, x, y)) c.px[y * c.w + x] = color
}
export const get = (c, x, y) => (inside(c, x, y) ? c.px[y * c.w + x] : null)

// colors: one color, or { base, light, dark } lit from the top left (a 3D look)
const shadeAt = (colors, dx, dy, r) => {
  if (typeof colors === "string" || colors === null) return colors
  const d = (-dx - dy) / (Math.SQRT2 * Math.max(r, 1))
  return d > 0.42 ? colors.light ?? colors.base : d < -0.38 ? colors.dark ?? colors.base : colors.base
}

// a filled circle (pixel centers within r of the center); colors null erases
export const disc = (c, cx, cy, r, colors) => {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy <= r * r) set(c, x, y, shadeAt(colors, dx, dy, r))
    }
}

export const rect = (c, x0, y0, w, h, color) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(c, x, y, color)
}

// a line one pixel wide (Bresenham)
export const line = (c, x0, y0, x1, y1, color) => {
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    set(c, x0, y0, color)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
}

// rows of text, one character per pixel, with a palette: ".": empty
export const stamp = (c, x0, y0, rowsOfText, palette) =>
  rowsOfText.forEach((row, y) => [...row].forEach((ch, x) => ch !== "." && palette[ch] !== undefined && set(c, x0 + x, y0 + y, palette[ch])))

// every empty pixel touching a filled one (not diagonally) becomes the outline color
export const outline = (c, color = "#000000", { diagonal = false } = {}) => {
  const add = []
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      if (get(c, x, y)) continue
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1], ...(diagonal ? [[1, 1], [-1, -1], [1, -1], [-1, 1]] : [])]
      if (near.some(([dx, dy]) => get(c, x + dx, y + dy) && get(c, x + dx, y + dy) !== color)) add.push([x, y])
    }
  add.forEach(([x, y]) => set(c, x, y, color))
  return c
}

// one layer over another (null pixels let the lower one show)
export const over = (lower, upper, dx = 0, dy = 0) => {
  for (let y = 0; y < upper.h; y++) for (let x = 0; x < upper.w; x++) if (get(upper, x, y)) set(lower, x + dx, y + dy, get(upper, x, y))
  return lower
}

// runs of one color per row, for drawing
export const rows = (c) => {
  const out = []
  for (let y = 0; y < c.h; y++) {
    let x = 0
    while (x < c.w) {
      const color = get(c, x, y)
      let w = 1
      while (x + w < c.w && get(c, x + w, y) === color) w++
      if (color) out.push({ x, y, w, color })
      x += w
    }
  }
  return out
}

// the drawing as an SVG file (for public/assets icons)
export const toSvg = (c, size = c.w) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c.w} ${c.h}" width="${size}" height="${Math.round((size * c.h) / c.w)}" shape-rendering="crispEdges">` +
  rows(c)
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="1" fill="${r.color}"/>`)
    .join("") +
  "</svg>"
