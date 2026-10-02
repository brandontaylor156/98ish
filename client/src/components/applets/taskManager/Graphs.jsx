import React, { useEffect, useRef } from "react"

const GRID = 12
const STEP = 3 // px the history graph scrolls per sample

const LIT = "#00ff00"
const UNLIT = "#005c00"
const GRID_COLOR = "#008040"

// Keeps the canvas bitmap the same size as its box and redraws on resize.
const useCanvas = (draw, deps) => {
  const ref = useRef(null)
  const drawRef = useRef(draw)
  drawRef.current = draw

  const paint = () => {
    const canvas = ref.current
    if (!canvas) return
    const w = Math.max(1, canvas.clientWidth)
    const h = Math.max(1, canvas.clientHeight)
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, w, h)
    drawRef.current(ctx, w, h)
  }

  useEffect(paint, deps)

  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !ref.current) return
    const observer = new ResizeObserver(() => paint())
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return ref
}

// The LED-style bar meter (CPU Usage / MEM Usage boxes).
export const Meter = ({ value, label }) => {
  const ref = useCanvas(
    (ctx, w, h) => {
      const textH = 16
      const top = 5
      const bottom = h - textH - 2
      const rows = Math.max(1, Math.floor((bottom - top) / 3))
      const lit = Math.round((rows * Math.min(100, Math.max(0, value))) / 100)
      const colW = Math.min(13, Math.floor((w - 14) / 2))
      const left = Math.round(w / 2 - colW)
      for (let i = 0; i < rows; i++) {
        const y = bottom - (i + 1) * 3 + 1
        ctx.fillStyle = i < lit ? LIT : UNLIT
        ctx.fillRect(left, y, colW, 2)
        ctx.fillRect(left + colW + 1, y, colW, 2)
      }
      ctx.fillStyle = LIT
      ctx.font = '11px "Pixelated MS Sans Serif", Arial'
      ctx.textAlign = "center"
      ctx.textBaseline = "bottom"
      ctx.fillText(label, w / 2, h - 3)
    },
    [value, label]
  )
  return <canvas ref={ref} className="tm-canvas" />
}

// The scrolling green-on-black history graph.
export const HistoryGraph = ({ data, max, tick, color = LIT }) => {
  const ref = useCanvas(
    (ctx, w, h) => {
      const offset = (tick * STEP) % GRID
      ctx.strokeStyle = GRID_COLOR
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let y = h - 1; y >= 0; y -= GRID) {
        ctx.moveTo(0, y + 0.5)
        ctx.lineTo(w, y + 0.5)
      }
      for (let x = w - 1 - (GRID - offset); x >= 0; x -= GRID) {
        ctx.moveTo(x + 0.5, 0)
        ctx.lineTo(x + 0.5, h)
      }
      ctx.stroke()

      if (!data.length) return
      ctx.strokeStyle = color
      ctx.beginPath()
      const usable = h - 2
      for (let i = 0; i < data.length; i++) {
        const v = data[data.length - 1 - i]
        const x = w - 1 - i * STEP
        const y = Math.round(h - 1 - (Math.min(v, max) / max) * usable) + 0.5
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
        if (x < 0) break
      }
      ctx.stroke()
    },
    [data, max, tick, color]
  )
  return <canvas ref={ref} className="tm-canvas" />
}
