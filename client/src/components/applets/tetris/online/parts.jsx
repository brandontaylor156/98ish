import React, { useEffect, useLayoutEffect, useRef, useState } from "react"

// Small pieces shared by the lobby, rooms and matches

// Progress toward the next rank: filled and empty stars
export const Stars = ({ into, need }) => (
  <span className="tetrisStars" aria-label={`${into} of ${need} stars to the next rank`}>
    {"★".repeat(into)}
    <span className="tetrisStarsEmpty">{"☆".repeat(Math.max(0, need - into))}</span>
  </span>
)

// The current time, ticking every `ms`
export const useNow = (ms = 200) => {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

export const useSize = (ref) => {
  const [size, setSize] = useState(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize((s) => (s && s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return size
}

const COLORS = {
  i: "#00c8d0",
  j: "#2850e0",
  l: "#f08000",
  o: "#e0d000",
  s: "#20b840",
  t: "#a040d0",
  z: "#e02020",
  g: "#8a8a8a",
  "#": "#5c5c5c",
}
const CELL = 8

// An opponent's board from its 200-character snapshot, drawn on a canvas (cheap to redraw
// a few times a second for six players)
export const MiniBoard = React.memo(({ snap, dead }) => {
  const ref = useRef(null)
  useEffect(() => {
    const ctx = ref.current?.getContext("2d")
    if (!ctx) return
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, 10 * CELL, 20 * CELL)
    if (!snap) return
    for (let i = 0; i < 200; i++) {
      const c = snap[i]
      if (c === ".") continue
      const x = (i % 10) * CELL
      const y = Math.floor(i / 10) * CELL
      ctx.fillStyle = dead ? "#555" : COLORS[c] || "#888"
      ctx.fillRect(x, y, CELL - 1, CELL - 1)
      ctx.fillStyle = "rgba(255,255,255,0.35)"
      ctx.fillRect(x, y, CELL - 1, 1)
      ctx.fillRect(x, y, 1, CELL - 1)
    }
  }, [snap, dead])
  return <canvas ref={ref} className="tetrisMiniCanvas" width={10 * CELL} height={20 * CELL} />
})

export const placeName = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`)
