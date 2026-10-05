// How big a game's pixels are (pure, tested in retro.test.js).
//
// A retro game draws a small logical screen (a few hundred pixels across) and the browser
// blows it up. Every logical pixel must be the same whole number of DEVICE pixels, or some
// columns come out wider than others (shimmer). fitPixels picks the biggest whole number k of
// device pixels per logical pixel that still leaves the game at least minW x minH logical
// pixels, and uses the rest of the space (the logical screen grows to fill the box).
//
//   fitPixels({ w, h, dpr, minW, minH, maxK }) -> { k, w, h, css, offsetX, offsetY }
//     w, h      the box in CSS pixels; dpr = devicePixelRatio
//     k         device pixels per logical pixel (a whole number, >= 1)
//     w, h      the logical screen
//     css       CSS pixels per logical pixel (k / dpr)
//     offsetX/Y CSS pixels to centre the screen in the box (whole device pixels)

export const fitPixels = ({ w, h, dpr = 1, minW = 160, minH = 120, maxK = 16 }) => {
  const dw = Math.max(1, Math.floor(w * dpr))
  const dh = Math.max(1, Math.floor(h * dpr))
  const k = Math.max(1, Math.min(maxK, Math.floor(dw / minW), Math.floor(dh / minH)))
  const lw = Math.max(1, Math.floor(dw / k))
  const lh = Math.max(1, Math.floor(dh / k))
  return {
    k,
    w: lw,
    h: lh,
    css: k / dpr,
    offsetX: Math.floor((dw - lw * k) / 2) / dpr,
    offsetY: Math.floor((dh - lh * k) / 2) / dpr,
  }
}

// a client point -> logical pixels, given the screen element's bounding rect and the fit
export const toLogical = (clientX, clientY, rect, fit) => ({ x: (clientX - rect.left) / fit.css, y: (clientY - rect.top) / fit.css })
