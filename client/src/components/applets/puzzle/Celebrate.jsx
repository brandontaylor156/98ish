import React, { useEffect, useRef, useState } from "react"
import { drawSticker } from "./art"
import { formatTime } from "./image"

// The finished-puzzle party: hearts float up and confetti falls over the picture, and a
// card says how long it took. A puzzle with a hidden message comes with an envelope that
// opens to show it (as plain text).

const COLORS = ["#ff5e8a", "#ffb3c8", "#ffd23f", "#9be7c4", "#b9a6ff", "#7cc7ff", "#ff9f7a"]

const Party = ({ hearts = true }) => {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas.getContext("2d")
    let raf = 0
    let w = 0
    let h = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const resize = () => {
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, w * dpr)
      canvas.height = Math.max(1, h * dpr)
    }
    resize()
    const bits = []
    const add = (count, burst) => {
      for (let i = 0; i < count; i++) {
        const heart = hearts && Math.random() < 0.35
        bits.push({
          heart,
          x: burst ? w / 2 + (Math.random() - 0.5) * 40 : Math.random() * w,
          y: heart ? h + 20 + Math.random() * h * 0.5 : burst ? h * 0.45 : -20 - Math.random() * h * 0.6,
          vx: burst ? (Math.random() - 0.5) * 9 : (Math.random() - 0.5) * 1.2,
          vy: heart ? -(1 + Math.random() * 1.6) : burst ? -4 - Math.random() * 6 : 1.5 + Math.random() * 2,
          size: heart ? 14 + Math.random() * 22 : 5 + Math.random() * 6,
          spin: Math.random() * Math.PI,
          vs: (Math.random() - 0.5) * 0.3,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          life: 0,
        })
      }
    }
    add(120, true)
    add(60, false)
    const start = performance.now()
    let last = start
    const frame = (t) => {
      const dt = Math.min(3, (t - last) / 16.7)
      last = t
      if (t - start < 4000 && bits.length < 260) add(2, false)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i]
        b.life += dt
        if (b.heart) {
          b.x += Math.sin(b.life / 18 + b.spin) * 0.8 * dt
          b.y += b.vy * dt
        } else {
          b.vy += 0.12 * dt
          b.vx *= 0.99
          b.vy = Math.min(b.vy, 3.2)
          b.x += b.vx * dt
          b.y += b.vy * dt
          b.spin += b.vs * dt
        }
        if (b.y > h + 40 || b.y < -80) {
          bits.splice(i, 1)
          continue
        }
        if (b.heart) {
          ctx.globalAlpha = Math.min(1, b.life / 20)
          drawSticker(ctx, "heart", b.x, b.y, b.size, b.color)
        } else {
          ctx.globalAlpha = 1
          ctx.save()
          ctx.translate(b.x, b.y)
          ctx.rotate(b.spin)
          ctx.fillStyle = b.color
          ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2)
          ctx.restore()
        }
      }
      ctx.globalAlpha = 1
      if (bits.length || t - start < 4000) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    window.addEventListener("resize", resize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
    }
  }, [])
  return <canvas className="pzParty" ref={ref} />
}

// message: the hidden message (string), null when there isn't one; `waiting` while it's
// being fetched
const Celebrate = ({ time, moves, best, from, message, waiting, error, onAgain, onDone, againLabel = "Play Again" }) => {
  const [open, setOpen] = useState(false)
  const hasEnvelope = !!from && (waiting || message)
  useEffect(() => {
    if (!hasEnvelope || waiting) return
    const id = setTimeout(() => setOpen(true), 1100)
    return () => clearTimeout(id)
  }, [hasEnvelope, waiting])

  return (
    <div className="pzCelebrate" role="dialog" aria-label="Puzzle solved">
      <Party hearts />
      <div className={`pzCard window${hasEnvelope ? " has-envelope" : ""}`}>
        <div className="title-bar">
          <div className="title-bar-text">Puzzle Solved!</div>
        </div>
        <div className="window-body pzCardBody">
          <p className="pzCardTitle">You did it!</p>
          <p>
            Solved in <b>{formatTime(time)}</b>
            {moves ? ` with ${moves} moves` : ""}.{best ? " A new best time!" : ""}
          </p>
          {hasEnvelope && (
            <div className={`pzEnvelope${open ? " is-open" : ""}`} onClick={() => setOpen(true)}>
              <div className="pzEnvBack" />
              <div className="pzLetter">
                <div className="pzLetterFrom">From {from}</div>
                <div className="pzLetterText">{waiting ? "..." : message}</div>
              </div>
              <div className="pzEnvFront" />
              <div className="pzEnvFlap" />
              <div className="pzEnvSeal" aria-hidden="true">
                ♥
              </div>
            </div>
          )}
          {hasEnvelope && !open && !waiting && <p className="pzHint">There's a message for you...</p>}
          {error && <p className="pzError">{error}</p>}
          <div className="pzCardButtons">
            {onAgain && (
              <button type="button" onClick={onAgain}>
                {againLabel}
              </button>
            )}
            <button type="button" onClick={onDone}>
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Celebrate
