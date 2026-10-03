import React, { useEffect, useRef } from "react"
import { loadImages } from "./CardTable"

// Solitaire's famous ending: the cards leap off the foundations one at a time and bounce
// across the felt, leaving a trail of themselves. The canvas is never cleared, which is
// what makes the trails. Any click, tap or key stops it.
//
// launches: [{ card, x, y }] in the order they fly (kings first)

const STEP = 1000 / 60 // physics runs at a fixed 60 steps a second

const WinCascade = ({ launches, cw, ch, width, height, onLaunch, onDone }) => {
  const canvasRef = useRef(null)
  const done = useRef(false)

  const finish = () => {
    if (done.current) return
    done.current = true
    onDone()
  }

  useEffect(() => {
    done.current = false
    const canvas = canvasRef.current
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    const ctx = canvas.getContext("2d")
    ctx.scale(dpr, dpr)
    const scale = cw / 71
    let images = null
    let raf = 0
    let next = 0
    let flying = null
    let last = 0
    let carry = 0

    const launch = () => {
      if (next >= launches.length) return null
      const { card, x, y } = launches[next]
      next++
      onLaunch(next)
      // sideways at a random speed, never straight up; a random hop up or down
      const dir = Math.random() < 0.5 ? -1 : 1
      return {
        img: images.get(card.id),
        x,
        y,
        vx: dir * (3 + Math.random() * 6) * scale,
        vy: -Math.random() * 10 * scale,
      }
    }

    const step = () => {
      const f = flying
      f.vy += 0.6 * scale
      f.x += f.vx
      f.y += f.vy
      if (f.y + ch > height) {
        f.y = height - ch
        f.vy = -f.vy * (0.72 + Math.random() * 0.12)
      }
      if (f.img) ctx.drawImage(f.img, f.x, f.y, cw, ch)
      if (f.x + cw < 0 || f.x > width) flying = launch()
    }

    const frame = (t) => {
      if (done.current) return
      carry += Math.min(100, t - (last || t))
      last = t
      while (carry >= STEP && flying) {
        carry -= STEP
        step()
      }
      if (!flying) return finish()
      raf = requestAnimationFrame(frame)
    }

    loadImages(launches.map((l) => l.card)).then((map) => {
      if (done.current) return
      images = map
      flying = launch()
      raf = requestAnimationFrame(frame)
    })

    const stop = (e) => {
      if (e.type === "keydown" && ["Shift", "Control", "Alt"].includes(e.key)) return
      // only keys pressed in this game's window (not typing in Notepad)
      const own = canvasRef.current?.closest(".window")
      if (own && !own.contains(e.target) && e.target !== document.body) return
      finish()
    }
    window.addEventListener("keydown", stop)
    return () => {
      done.current = true
      cancelAnimationFrame(raf)
      window.removeEventListener("keydown", stop)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="cardsWinCanvas"
      style={{ width, height }}
      onPointerDown={(e) => {
        e.stopPropagation()
        finish()
      }}
    />
  )
}

export default WinCascade
