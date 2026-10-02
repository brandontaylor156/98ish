// Shared bits for the canvas 2D screensavers

// Sizes a canvas to w x h CSS pixels at the given pixel ratio; returns its size in device pixels
export const fit2d = (canvas, w, h, dpr) => {
  const width = Math.max(1, Math.round(w * dpr))
  const height = Math.max(1, Math.round(h * dpr))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  return { width, height }
}

export const rand = (a, b) => a + Math.random() * (b - a)

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

// a number setting, kept in range even if storage holds something odd
export const num = (value, fallback, min, max) => {
  const n = Number(value)
  return Number.isFinite(n) ? clamp(n, min, max) : fallback
}
