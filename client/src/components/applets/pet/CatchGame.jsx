import React, { useEffect, useRef, useState } from "react"
import { Creature, Heart } from "./PetArt"
import { playPetSound } from "./sounds"

// Playtime: treats rain down for 20 seconds and you steer the pet to catch them (drag,
// touch or the arrow keys). Hearts are worth 3, stars 2, everything else 1.

const LENGTH_MS = 20_000
const KINDS = [
  { kind: "berry", points: 1, weight: 5 },
  { kind: "cookie", points: 1, weight: 4 },
  { kind: "star", points: 2, weight: 2 },
  { kind: "heart", points: 3, weight: 1 },
]
const pickKind = () => {
  let r = Math.random() * KINDS.reduce((n, k) => n + k.weight, 0)
  for (const k of KINDS) if ((r -= k.weight) < 0) return k
  return KINDS[0]
}

const heartPath = (g, x, y, s) => {
  g.beginPath()
  g.moveTo(x, y + s * 0.35)
  g.bezierCurveTo(x - s, y - s * 0.4, x - s * 0.5, y - s * 1.1, x, y - s * 0.45)
  g.bezierCurveTo(x + s * 0.5, y - s * 1.1, x + s, y - s * 0.4, x, y + s * 0.35)
}

const drawTreat = (g, t) => {
  g.save()
  g.translate(t.x, t.y)
  g.rotate(t.rot)
  g.lineWidth = 2
  if (t.kind === "berry") {
    g.fillStyle = "#ff4f6d"
    g.strokeStyle = "#9b2340"
    g.beginPath()
    g.moveTo(0, 13)
    g.bezierCurveTo(-14, 6, -13, -9, -6, -10)
    g.bezierCurveTo(-2, -11, 2, -11, 6, -10)
    g.bezierCurveTo(13, -9, 14, 6, 0, 13)
    g.fill()
    g.stroke()
    g.fillStyle = "#5dbb63"
    g.beginPath()
    g.ellipse(-4, -11, 5, 3, -0.5, 0, Math.PI * 2)
    g.ellipse(4, -11, 5, 3, 0.5, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = "#ffe28a"
    for (const [x, y] of [[-4, -3], [4, -3], [0, 3], [-5, 5], [5, 5]]) g.fillRect(x, y, 1.6, 2.4)
  } else if (t.kind === "cookie") {
    g.fillStyle = "#e6b073"
    g.strokeStyle = "#8a5a2b"
    g.beginPath()
    g.arc(0, 0, 12, 0, Math.PI * 2)
    g.fill()
    g.stroke()
    g.fillStyle = "#ffb3c9"
    heartPath(g, 0, 2, 8)
    g.fill()
  } else if (t.kind === "star") {
    g.fillStyle = "#ffd65a"
    g.strokeStyle = "#a87b10"
    g.beginPath()
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 6 : 14
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    g.closePath()
    g.fill()
    g.stroke()
  } else {
    g.fillStyle = "#ff5c8a"
    g.strokeStyle = "#9b2948"
    heartPath(g, 0, 2, 15)
    g.fill()
    g.stroke()
  }
  g.restore()
}

const CatchGame = ({ pet, onDone, onQuit }) => {
  const box = useRef(null)
  const canvas = useRef(null)
  const petEl = useRef(null)
  const bar = useRef(null)
  const [score, setScore] = useState(0)
  const [phase, setPhase] = useState("ready") // ready | play | done
  const [happy, setHappy] = useState(0)
  const [pops, setPops] = useState([])
  const game = useRef({ x: 0.5, target: 0.5, keys: 0, treats: [], score: 0 })

  useEffect(() => {
    const t = setTimeout(() => setPhase("play"), 1200)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (phase !== "play") return
    const g = game.current
    const el = box.current
    const cv = canvas.current
    const ctx = cv.getContext("2d")
    const start = performance.now()
    let last = start
    let nextSpawn = start + 300
    let raf = 0
    let popId = 0
    const fit = () => {
      const r = el.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.round(r.width * dpr)
      cv.height = Math.round(r.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    fit()
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { width: w, height: h } = el.getBoundingClientRect()
      const elapsed = now - start
      const left = Math.max(0, LENGTH_MS - elapsed)
      if (bar.current) bar.current.style.width = `${(left / LENGTH_MS) * 100}%`
      // steer
      if (g.keys) g.target = Math.min(1, Math.max(0, g.target + g.keys * dt * 1.3))
      g.x += (g.target - g.x) * Math.min(1, dt * 14)
      const px = 40 + g.x * (w - 80)
      if (petEl.current) petEl.current.style.transform = `translateX(${px - 55}px)`
      // treats
      if (now >= nextSpawn && left > 600) {
        const k = pickKind()
        g.treats.push({ ...k, x: 20 + Math.random() * (w - 40), y: -20, vy: 110 + Math.random() * 60 + elapsed / 140, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 3 })
        nextSpawn = now + Math.max(330, 620 - elapsed / 60) * (0.7 + Math.random() * 0.6)
      }
      const catchY = h - 70
      ctx.clearRect(0, 0, w, h)
      g.treats = g.treats.filter((t) => {
        t.y += t.vy * dt
        t.rot += t.spin * dt
        if (t.y > catchY && t.y < catchY + 40 && Math.abs(t.x - px) < 42) {
          g.score += t.points
          setScore(g.score)
          setHappy((n) => n + 1)
          const id = ++popId
          setPops((list) => [...list.slice(-5), { id, x: t.x, y: catchY - 10, text: `+${t.points}` }])
          playPetSound(t.kind === "heart" ? "heart" : "catch")
          return false
        }
        if (t.y > h + 20) return false
        drawTreat(ctx, t)
        return true
      })
      if (left <= 0) {
        setPhase("done")
        playPetSound("family")
        return
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    window.addEventListener("resize", fit)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", fit)
    }
  }, [phase])

  // arrows
  useEffect(() => {
    const g = game.current
    const down = (e) => {
      if (e.key === "ArrowLeft") g.keys = -1
      else if (e.key === "ArrowRight") g.keys = 1
      else return
      e.preventDefault()
    }
    const up = (e) => {
      if ((e.key === "ArrowLeft" && g.keys < 0) || (e.key === "ArrowRight" && g.keys > 0)) g.keys = 0
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [])

  const steer = (e) => {
    const r = box.current.getBoundingClientRect()
    game.current.target = Math.min(1, Math.max(0, (e.clientX - r.left - 40) / Math.max(1, r.width - 80)))
  }

  return (
    <div className="petGame" ref={box} data-touch-surface onPointerDown={steer} onPointerMove={(e) => (e.buttons || e.pointerType === "touch" || e.pointerType === "mouse") && steer(e)} tabIndex={-1}>
      <canvas ref={canvas} className="petGameCanvas" />
      <div className="petGameTop">
        <span className="petGameScore">
          <Heart size={16} /> {score}
        </span>
        <span className="petGameTime">
          <span ref={bar} />
        </span>
        <button type="button" className="petGameQuit" onClick={onQuit} aria-label="Stop playing">
          ✕
        </button>
      </div>
      {pops.map((p) => (
        <span key={p.id} className="petGamePop" style={{ left: p.x, top: p.y }} onAnimationEnd={() => setPops((list) => list.filter((x) => x.id !== p.id))}>
          {p.text}
        </span>
      ))}
      <div className="petGamePet" ref={petEl}>
        <Creature key={happy} species={pet.species} body={pet.body} accent={pet.accent} stage={pet.stage} worn={pet.worn} expression={phase === "done" || happy ? "happy" : "wow"} size={110} className={happy ? "is-hop" : ""} />
      </div>
      {phase === "ready" && <div className="petGameBanner">Catch the treats!</div>}
      {phase === "done" && (
        <div className="petGameDone">
          <div className="petGameCard">
            <Creature species={pet.species} body={pet.body} accent={pet.accent} stage={pet.stage} worn={pet.worn} expression="loved" size={110} className="is-bounce" />
            <b>{score === 1 ? "1 treat!" : `${score} treats!`}</b>
            <span>{score >= 25 ? `${pet.name} thinks you're the best ever!` : score >= 10 ? `${pet.name} had so much fun!` : `${pet.name} loved playing with you!`}</span>
            <button type="button" className="petBig" onClick={() => onDone(Math.min(60, score))}>
              Yay! ♥
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default CatchGame
