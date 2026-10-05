import { canvas, disc, outline, set } from "./pixelArt.js"

// Do Not Disturb's moon: a pixel-art crescent (16x16 for the tray and the bell, 32x32 for
// the Control Panel icon), yellow when it's on, grey when off.
const cache = new Map()
export const moonArt = (on = true, size = 16) => {
  const id = `${on}-${size}`
  if (cache.has(id)) return cache.get(id)
  const c = canvas(size, size)
  const k = size / 16
  const colors = on ? { base: "#ffe066", light: "#fff6c0", dark: "#d0a000" } : { base: "#c0c0c0", light: "#e8e8e8", dark: "#909090" }
  disc(c, 7.2 * k, 8.6 * k, 6.2 * k, colors)
  disc(c, 10.6 * k, 5.6 * k, 5.2 * k, null)
  outline(c)
  if (on) {
    // a twinkle
    const x = Math.round(12.8 * k)
    const y = Math.round(3.2 * k)
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) set(c, x + dx, y + dy, "#ffffff")
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]]) set(c, x + dx, y + dy, "#000080")
  }
  cache.set(id, c)
  return c
}
