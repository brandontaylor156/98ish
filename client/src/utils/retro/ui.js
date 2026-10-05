// The game-side 98 widgets, drawn in the game's own pixels (pure): a bevelled button, an LED
// counter in a sunken well, a window panel with a title bar, a segmented meter. They look up
// the UI colours every kit palette carries (palette.js UI_COLORS).
//
//   const ui = uiColors(pal)
//   drawButton(b, ui, x, y, w, h, "YES", { pressed, disabled, icon, color })
//   drawCounter(b, ui, x, y, "042", { digits: 3 })     -> { w, h }
//   drawPanel(b, ui, x, y, w, h, "Paused")
//   drawMeter(b, ui, x, y, w, h, frac, { on, off, segments })

import { bevel, blit, frame, rect, remapRect, well } from "./bitmap.js"
import { drawLed, drawText, ledWidth, textWidth } from "./font.js"
import { threshold } from "./dither.js"

export const uiColors = (pal) => ({
  face: pal.idx("face"),
  white: pal.idx("white"),
  light: pal.idx("light"),
  shadow: pal.idx("shadow"),
  black: pal.idx("black"),
  dark: pal.idx("dark"),
  navy: pal.idx("navy"),
  ledBg: pal.idx("ledBg"),
  ledOn: pal.idx("ledOn"),
  ledOff: pal.idx("ledOff"),
  gold: pal.idx("gold"),
})

// a raised 98 button with a centred label (and an optional icon sprite to its left or above)
export const drawButton = (b, ui, x, y, w, h, label, opts = {}) => {
  const { pressed = false, disabled = false, icon = null, color = ui.black, face = ui.face, scale = 1, stack = false, focus = false } = opts
  bevel(b, x, y, w, h, { ...ui, face }, { pressed })
  const off = pressed ? 1 : 0
  const tw = label ? textWidth(label, { scale }) : 0
  const ink = disabled ? ui.shadow : color
  if (stack && icon) {
    const total = icon.h + (label ? 2 + 7 * scale : 0)
    const iy = y + Math.floor((h - total) / 2) + off
    blit(b, icon, x + Math.floor((w - icon.w) / 2) + off, iy, disabled ? { only: ui.shadow } : {})
    if (label) drawText(b, label, x + w / 2 + off, iy + icon.h + 2, ink, { align: "center", scale, shadow: disabled ? ui.white : -1 })
  } else {
    const gap = icon && label ? 3 : 0
    const total = (icon ? icon.w : 0) + gap + tw
    let cx = x + Math.floor((w - total) / 2) + off
    if (icon) {
      blit(b, icon, cx, y + Math.floor((h - icon.h) / 2) + off, disabled ? { only: ui.shadow } : {})
      cx += icon.w + gap
    }
    if (label) drawText(b, label, cx, y + Math.floor((h - 7 * scale) / 2) + off, ink, { scale, shadow: disabled ? ui.white : -1 })
  }
  // the dotted focus rectangle a 98 button gets
  if (focus) {
    for (let k = 0; k < w - 8; k += 2) {
      rect(b, x + 4 + k, y + 4 + off, 1, 1, ui.black)
      rect(b, x + 4 + k, y + h - 5 + off, 1, 1, ui.black)
    }
    for (let k = 0; k < h - 8; k += 2) {
      rect(b, x + 4 + off, y + 4 + k, 1, 1, ui.black)
      rect(b, x + w - 5 + off, y + 4 + k, 1, 1, ui.black)
    }
  }
}

// an LED counter (red 7-segment digits in a sunken black well); text is padded to `digits`
export const counterSize = (text, { digits = 3, digitW = 7, digitH = 11 } = {}) => {
  const t = String(text).padStart(digits, " ")
  return { w: ledWidth(t, { digitW }) + 6, h: digitH + 6 }
}
export const drawCounter = (b, ui, x, y, text, opts = {}) => {
  const { digits = 3, digitW = 7, digitH = 11, thick = 1, on = ui.ledOn, off = ui.ledOff, align = "left" } = opts
  const t = String(text).padStart(digits, " ")
  const { w, h } = counterSize(text, opts)
  const x0 = Math.round(align === "right" ? x - w : align === "center" ? x - w / 2 : x)
  well(b, x0, y, w, h, ui, ui.ledBg)
  drawLed(b, t, x0 + 3, y + 3, { on, off, digitW, digitH, thick })
  return { x: x0, w, h }
}

// a 98 window: grey face, raised edge, a navy title bar with white text
export const drawPanel = (b, ui, x, y, w, h, title, { titleH = 11, barColor = ui.navy } = {}) => {
  bevel(b, x, y, w, h, ui)
  if (title != null) {
    rect(b, x + 3, y + 3, w - 6, titleH, barColor)
    drawText(b, title, x + 5, y + 3 + Math.floor((titleH - 7) / 2), ui.white)
  }
  return { x: x + 4, y: y + 3 + (title != null ? titleH + 3 : 1), w: w - 8, h: h - (title != null ? titleH + 9 : 7) }
}

// a segmented bar (an LED power meter), frac 0..1
export const drawMeter = (b, ui, x, y, w, h, frac, { on = ui.ledOn, off = ui.ledOff, segments = 0, hot = -1 } = {}) => {
  well(b, x, y, w, h, ui, ui.ledBg)
  const ix = x + 2
  const iw = w - 4
  const ih = h - 4
  const n = segments || Math.max(1, Math.floor(iw / 4))
  const sw = iw / n
  for (let k = 0; k < n; k++) {
    const lit = (k + 1) / n <= frac + 1e-6
    const c = lit ? (hot >= 0 && k >= n * 0.75 ? hot : on) : off
    rect(b, Math.round(ix + k * sw), y + 2, Math.max(1, Math.round(sw) - 1), ih, c)
  }
}

// "screen door" darkening of a box: every other pixel through the remap table (a 50% shade
// the way a 256-colour game faked transparency), or all of it when solid
export const shadeBox = (b, x, y, w, h, table, level = 0.5) => {
  if (level >= 1) return remapRect(b, x, y, w, h, table)
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(b.w, Math.floor(x + w))
  const y1 = Math.min(b.h, Math.floor(y + h))
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      if (level > threshold(xx, yy)) b.data[yy * b.w + xx] = table[b.data[yy * b.w + xx]]
    }
  }
}

// a thin 1-pixel box in one colour (a selection or a dotted focus line)
export const box = (b, x, y, w, h, c) => frame(b, x, y, w, h, c)
