import React, { useEffect, useRef } from "react"
import { reducedMotion } from "../../utils/settings"

// A little trail of sparkles or hearts behind the mouse (Display Properties > Appearance,
// and some Desktop Themes). Mouse only: not on touch screens, and not at all when the
// system asks for reduced motion. It draws only while there's something to draw.

const COLORS = {
  sparkle: ["#ffffff", "#ffd1e6", "#d8c8ff", "#fff3a8", "#bff0ff"],
  hearts: ["#ff8fb1", "#ffb3c8", "#ff6f91", "#e7a6ff"],
}
const MAX = 40
const LIFE = 0.75 // seconds

export const trailAllowed = () => {
  const mq = (q) => !!window.matchMedia?.(q).matches
  return mq("(hover: hover) and (pointer: fine)") && !reducedMotion()
}

const sparkle = (ctx, s) => {
  ctx.beginPath()
  ctx.moveTo(0, -s)
  ctx.quadraticCurveTo(s * 0.18, -s * 0.18, s, 0)
  ctx.quadraticCurveTo(s * 0.18, s * 0.18, 0, s)
  ctx.quadraticCurveTo(-s * 0.18, s * 0.18, -s, 0)
  ctx.quadraticCurveTo(-s * 0.18, -s * 0.18, 0, -s)
  ctx.fill()
}

const heart = (ctx, s) => {
  ctx.beginPath()
  ctx.moveTo(0, s * 0.3)
  ctx.bezierCurveTo(-s * 0.05, s * 0.26, -s * 0.5, 0, -s * 0.5, -s * 0.16)
  ctx.bezierCurveTo(-s * 0.5, -s * 0.42, -s * 0.12, -s * 0.48, 0, -s * 0.22)
  ctx.bezierCurveTo(s * 0.12, -s * 0.48, s * 0.5, -s * 0.42, s * 0.5, -s * 0.16)
  ctx.bezierCurveTo(s * 0.5, 0, s * 0.05, s * 0.26, 0, s * 0.3)
  ctx.fill()
}

// Windows 98's pointer trails: ghost arrows where the pointer just was (Control Panel > Mouse)
const arrow = (ctx) => {
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, 16)
  ctx.lineTo(4, 12)
  ctx.lineTo(7, 18)
  ctx.lineTo(9, 17)
  ctx.lineTo(6, 11)
  ctx.lineTo(11, 11)
  ctx.closePath()
  ctx.fillStyle = "#fff"
  ctx.fill()
  ctx.strokeStyle = "#000"
  ctx.lineWidth = 1
  ctx.stroke()
}

const CursorTrail = ({ kind = "sparkle" }) => {
  const ref = useRef(null)

  useEffect(() => {
    if (!trailAllowed()) return
    const canvas = ref.current
    const ctx = canvas.getContext("2d")
    const colors = COLORS[kind] || COLORS.sparkle
    const parts = []
    let raf = 0
    let last = 0
    let lastX = -1
    let lastY = -1
    let dpr = 1
    const life = kind === "pointer" ? 0.3 : LIFE

    const size = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(window.innerWidth * dpr)
      canvas.height = Math.round(window.innerHeight * dpr)
    }

    const loop = (now) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
      last = now
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]
        p.age += dt
        if (p.age >= life) {
          parts.splice(i, 1)
          continue
        }
        p.x += p.vx * dt
        p.y += p.vy * dt
        const k = 1 - p.age / life
        ctx.save()
        ctx.globalAlpha = k
        ctx.translate(p.x, p.y)
        ctx.rotate(p.spin * p.age)
        ctx.fillStyle = p.color
        if (kind === "pointer") arrow(ctx)
        else if (kind === "hearts") heart(ctx, p.size * (0.6 + 0.4 * k))
        else sparkle(ctx, p.size * (0.4 + 0.6 * Math.sin(k * Math.PI)))
        ctx.restore()
      }
      if (parts.length) raf = requestAnimationFrame(loop)
      else {
        // all gone: rest until the mouse moves again
        raf = 0
        last = 0
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }

    const onMove = (e) => {
      if (e.pointerType && e.pointerType !== "mouse") return
      const dist = Math.hypot(e.clientX - lastX, e.clientY - lastY)
      if (dist < 9) return
      lastX = e.clientX
      lastY = e.clientY
      if (parts.length >= MAX) parts.shift()
      if (kind === "pointer") parts.push({ x: e.clientX, y: e.clientY, vx: 0, vy: 0, size: 1, spin: 0, color: "#fff", age: 0 })
      else parts.push({
        x: e.clientX + 10 + (Math.random() - 0.5) * 8,
        y: e.clientY + 14 + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 30,
        vy: kind === "hearts" ? -20 - Math.random() * 20 : 15 + Math.random() * 25,
        size: kind === "hearts" ? 8 + Math.random() * 6 : 4 + Math.random() * 4,
        spin: kind === "hearts" ? (Math.random() - 0.5) * 2 : (Math.random() - 0.5) * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        age: 0,
      })
      if (!raf) raf = requestAnimationFrame(loop)
    }

    size()
    window.addEventListener("resize", size)
    window.addEventListener("pointermove", onMove, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", size)
      window.removeEventListener("pointermove", onMove)
    }
  }, [kind])

  return <canvas ref={ref} className="cursorTrail" aria-hidden="true" style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 2147483000 }} />
}

export default CursorTrail
