import React, { useEffect, useRef } from "react"
import { reducedMotion } from "../../../utils/settings"

// Confetti over the game for a win: a burst from the middle, then a few seconds of
// pieces drifting down. Nothing under "reduce motion".

const COLORS = ["#2fa84f", "#e3b30b", "#1084d0", "#ff5e8a", "#ffffff", "#ff8a00", "#8a5cf6"]

const Confetti = ({ seconds = 3.5 }) => {
  const ref = useRef(null)
  useEffect(() => {
    if (reducedMotion()) return
    const canvas = ref.current
    const ctx = canvas.getContext("2d")
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = Math.max(1, w * dpr)
    canvas.height = Math.max(1, h * dpr)
    const bits = []
    const add = (count, burst) => {
      for (let i = 0; i < count; i++) {
        bits.push({
          x: burst ? w / 2 + (Math.random() - 0.5) * 60 : Math.random() * w,
          y: burst ? h * 0.4 : -10 - Math.random() * 40,
          vx: burst ? (Math.random() - 0.5) * 10 : (Math.random() - 0.5) * 1.5,
          vy: burst ? -3 - Math.random() * 7 : 1 + Math.random() * 2,
          size: 4 + Math.random() * 5,
          spin: Math.random() * Math.PI,
          vs: (Math.random() - 0.5) * 0.35,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
        })
      }
    }
    add(110, true)
    const start = performance.now()
    let last = start
    let raf = 0
    const frame = (t) => {
      const dt = Math.min(3, (t - last) / 16.7)
      last = t
      if (t - start < seconds * 1000) add(2, false)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i]
        b.vy += 0.12 * dt
        b.vx *= 0.99
        b.x += b.vx * dt
        b.y += Math.min(b.vy, 4.5) * dt
        b.spin += b.vs * dt
        if (b.y > h + 20) {
          bits.splice(i, 1)
          continue
        }
        ctx.save()
        ctx.translate(b.x, b.y)
        ctx.rotate(b.spin)
        ctx.fillStyle = b.color
        ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2 + Math.abs(Math.sin(b.spin)) * b.size * 0.4)
        ctx.restore()
      }
      if (bits.length || t - start < seconds * 1000) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} className="wdConfetti" aria-hidden="true" />
}

export default Confetti
