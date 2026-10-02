// The taskbar's Cascade Windows and Tile Windows Horizontally / Vertically, as a pure
// function of the window list (App's reducer calls it). Only open, unminimized windows
// move; maximized ones are restored first. `width` and `height` are the free screen
// above the taskbar.

const MIN_W = 220
const MIN_H = 140

export const arrangeWindows = (windows, { mode, width, height }) => {
  const shown = windows.map((w, i) => (!w.closed && !w.minimized ? i : -1)).filter((i) => i >= 0)
  if (!shown.length) return windows
  const boxes = {}

  if (mode === "cascade") {
    const step = 26
    const w = Math.max(MIN_W, Math.round(width * 0.6))
    const h = Math.max(MIN_H, Math.round(height * 0.6))
    shown.forEach((index, n) => {
      const k = n % Math.max(1, Math.floor((height - h) / step) + 1)
      boxes[index] = { x: k * step, y: k * step, width: Math.min(w, width - k * step), height: h }
    })
  } else {
    // horizontally: one above the other (rows); vertically: side by side (columns).
    // Too many for one line wraps into a grid.
    const n = shown.length
    let rows, cols
    if (mode === "horizontal") {
      rows = Math.min(n, Math.max(1, Math.floor(height / MIN_H)))
      cols = Math.ceil(n / rows)
    } else {
      cols = Math.min(n, Math.max(1, Math.floor(width / MIN_W)))
      rows = Math.ceil(n / cols)
    }
    shown.forEach((index, i) => {
      // fill down columns when tiling horizontally, across rows when vertically
      const col = mode === "horizontal" ? Math.floor(i / rows) : i % cols
      const row = mode === "horizontal" ? i % rows : Math.floor(i / cols)
      // the last column (or row) may have fewer windows: they share its space
      const inThisLine = mode === "horizontal" ? Math.min(rows, n - col * rows) : Math.min(cols, n - row * cols)
      const cellW = mode === "horizontal" ? width / cols : width / inThisLine
      const cellH = mode === "horizontal" ? height / inThisLine : height / rows
      boxes[index] = {
        x: Math.round(col * cellW),
        y: Math.round(row * cellH),
        width: Math.round(cellW),
        height: Math.round(cellH),
      }
    })
  }

  const last = shown.at(-1)
  return windows.map((w, i) =>
    boxes[i] ? { ...w, ...boxes[i], maximized: false, active: i === last } : { ...w, active: false }
  )
}
