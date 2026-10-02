import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import TouchControls, { fromPx, useTouchControlsMenuItem, useTouchControlsVisible } from "../../shared/controls"
import { ANGLES, MOOSE_AT, UNIT, addScore, distanceOf, ensureCells, loadScores, newGame, objectsNear, scoreOf, speedKmh, step } from "./skiEngine"
import { mooseSprite, objectSprites, skierSprite } from "./skiArt"
import "./Ski.css"

// Downhill: ski as far as you can. Arrow keys (or point with the mouse, or touch and hold
// on a phone) to steer, Space to jump (and to spin off the ramps), Up to slow down.
// F2 starts over, P pauses. After 2,000 m, watch out for the Snow-Moose.

const SKIER_Y = 0.32 // the skier sits this far down the view
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

// On-screen buttons (shared/controls: players can move, resize and add them). Steering is
// touch-and-hold on the slope itself. "Slow" (the Up key) is off until turned on.
const touchControls = (paused) => [
  { id: "jump", label: "Jump", className: "skiPadButton", opacity: 0.9, default: (size) => fromPx(size, { right: 80, bottom: 8, width: 64, height: 44 }) },
  { id: "pause", label: paused ? "Go" : "Pause", className: "skiPadButton", opacity: 0.9, default: (size) => fromPx(size, { right: 8, bottom: 8, width: 64, height: 44 }) },
  { id: "brake", label: "Slow", className: "skiPadButton", opacity: 0.9, enabled: false, default: (size) => fromPx(size, { left: 8, bottom: 8, width: 64, height: 44 }) },
]

const Ski = ({ onClose, mobile }) => {
  const rootRef = useRef(null)
  const canvasRef = useRef(null)
  const gameRef = useRef(null)
  const input = useRef({ turn: 0, aim: null, brake: false, jump: false, trick: false })
  const pointer = useRef(null) // { x, y } steering target on the canvas, while active
  const tiltAim = useRef(null) // a heading from tilting the phone
  const [hud, setHud] = useState({ time: 0, distance: 0, speed: 0, style: 0, moose: false })
  const [paused, setPaused] = useState(false)
  const [over, setOver] = useState(null) // { run, scores, place }
  const [dialog, setDialog] = useState(null)
  const [tilt, setTilt] = useState(false)
  const [round, setRound] = useState(0)
  const touchVisible = useTouchControlsVisible()
  const controlsMenuItem = useTouchControlsMenuItem()
  const showPad = mobile || touchVisible
  const [editing, setEditing] = useState(false)

  const newRun = () => {
    gameRef.current = newGame()
    setOver(null)
    setPaused(false)
    setRound((r) => r + 1)
    rootRef.current?.focus()
  }

  if (!gameRef.current) gameRef.current = newGame()

  // ---- the game loop: step and draw every frame ----
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    const art = objectSprites()
    let raf = 0
    let last = performance.now()
    let hudAt = 0
    let scale = 2

    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(r.width * dpr))
      canvas.height = Math.max(1, Math.round(r.height * dpr))
      canvas.style.width = `${r.width}px`
      canvas.style.height = `${r.height}px`
      // bigger pixels on big windows, so there's always about the same amount of slope
      scale = Math.max(2, Math.min(3.5, r.width / 240)) * dpr
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas.parentElement)

    const draw = (g) => {
      const W = canvas.width
      const H = canvas.height
      const vw = W / scale // view size in world units
      const vh = H / scale
      const camX = g.x - vw / 2
      const camY = g.y - vh * SKIER_Y
      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = "#f6f9ff"
      ctx.fillRect(0, 0, W, H)
      // faint snow texture that scrolls with the slope
      ctx.fillStyle = "#e3ebf8"
      const step = 37
      for (let y = Math.floor(camY / step) * step; y < camY + vh; y += step) {
        for (let x = Math.floor(camX / step) * step; x < camX + vw; x += step) {
          const h = (Math.imul(x | 0, 2654435761) ^ Math.imul(y | 0, 40503)) >>> 0
          if (h % 3 === 0) ctx.fillRect(Math.round((x + (h % 29) - camX) * scale), Math.round((y + (h % 17) - camY) * scale), Math.ceil(3 * scale), Math.ceil(scale))
        }
      }
      const put = (sprite, x, y, alpha = 1) => {
        const sx = Math.round((x - sprite.ax - camX) * scale)
        const sy = Math.round((y - sprite.ay - camY) * scale)
        ctx.globalAlpha = alpha
        ctx.drawImage(sprite.img, sx, sy, Math.round(sprite.img.width * scale), Math.round(sprite.img.height * scale))
        ctx.globalAlpha = 1
      }

      // everything on screen, drawn top to bottom so nearer things overlap farther ones
      const things = objectsNear(g, camX - 40, camY - 20, camX + vw + 40, camY + vh + 60).map((o) => ({ y: o.y, draw: () => put(art[o.kind][o.v % art[o.kind].length], o.x, o.y) }))
      if (camY < 40) things.push({ y: -4, draw: () => put(art.banner, 0, -4) })
      for (const course of g.courses) {
        for (const gate of course.gates) {
          if (gate.y < camY - 30 || gate.y > camY + vh + 30) continue
          const sprite = art.flag[gate.color]
          things.push({ y: gate.y, draw: () => (put(sprite, gate.x, gate.y, gate.done === "missed" ? 0.45 : 1), put(sprite, gate.x + gate.w, gate.y, gate.done === "missed" ? 0.45 : 1)) })
        }
      }
      const caught = g.state === "caught" || (g.over && g.over.reason === "caught")
      if (!caught) {
        const lift = g.state === "air" ? Math.sin((g.air.t / g.air.total) * Math.PI) * (g.air.ramp ? 14 + g.air.total * 6 : 6) : 0
        const pose = g.state === "crashed" ? "crash" : g.state === "air" ? (g.trickT > 0 ? "trick" : "air") : "ski"
        const frame = Math.floor(g.t * 6) % 2
        things.push({
          y: g.y,
          draw: () => {
            if (lift) {
              ctx.fillStyle = "rgba(60, 80, 140, 0.25)"
              ctx.fillRect(Math.round((g.x - 6 - camX) * scale), Math.round((g.y - camY) * scale), Math.round(12 * scale), Math.round(3 * scale))
            }
            put(skierSprite(g.dir, pose, g.speed > 1 ? frame : 0), g.x, g.y - lift)
          },
        })
      }
      if (g.moose) {
        const m = g.moose
        things.push({ y: m.y, draw: () => put(mooseSprite(Math.floor(m.frame * 7) % 2, caught), m.x, m.y) })
      }
      things.sort((a, b) => a.y - b.y)
      for (const t of things) t.draw()

      // ski tracks would be nice; messages float up instead
      ctx.textAlign = "center"
      ctx.font = `bold ${Math.round(7 * scale)}px "Pixelated MS Sans Serif", Arial, sans-serif`
      for (const msg of g.messages) {
        ctx.globalAlpha = Math.min(1, msg.t * 1.5)
        ctx.fillStyle = msg.color
        ctx.fillText(msg.text, (msg.x - camX) * scale, (msg.y - camY - (1.4 - msg.t) * 20) * scale)
      }
      ctx.globalAlpha = 1

      // the moose is coming: an arrow at the top edge when it's off screen
      if (g.moose && g.moose.y < camY && !caught) {
        const ax = Math.max(12, Math.min(W - 12, (g.moose.x - camX) * scale))
        ctx.fillStyle = "#c00000"
        ctx.beginPath()
        ctx.moveTo(ax, 4 * scale)
        ctx.lineTo(ax - 5 * scale, 11 * scale)
        ctx.lineTo(ax + 5 * scale, 11 * scale)
        ctx.fill()
      }
    }

    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      const g = gameRef.current
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      // steering toward the pointer (mouse or a finger held down)
      const p = pointer.current
      if (p && g.state !== "over") {
        const r = canvas.getBoundingClientRect()
        const dx = p.x - r.width / 2
        const dy = p.y - r.height * SKIER_Y
        if (dy < -8) input.current.aim = dx < 0 ? -3 : 3
        else {
          const deg = (Math.atan2(dx, Math.max(1, dy)) * 180) / Math.PI
          let best = 0
          ANGLES.forEach((a, i) => Math.abs(a - deg) < Math.abs(ANGLES[best] - deg) && (best = i))
          input.current.aim = best - 3
        }
      }
      ensureCells(g, { w: canvas.width / scale, h: canvas.height / scale })
      step(g, dt, input.current)
      input.current = { ...input.current, turn: 0, jump: false, trick: false, aim: tiltAim.current ?? null }
      draw(g)
      if (g.state === "over" && !g.recorded) {
        g.recorded = true
        const saved = addScore(g.over)
        setOver({ run: g.over, ...saved })
      }
      if (now - hudAt > 120) {
        hudAt = now
        setHud({ time: g.t, distance: distanceOf(g), speed: speedKmh(g), style: Math.floor(g.style), moose: !!g.moose })
      }
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  // ---- pausing ----
  const setPause = (value) => {
    const g = gameRef.current
    if (g.state === "over") return
    g.paused = value
    setPaused(value)
  }
  // customizing the controls pauses the run (tap to carry on after)
  useEffect(() => {
    if (editing) setPause(true)
  }, [editing])
  const setEditingAndFocus = (value) => {
    setEditing(value)
    if (!value) rootRef.current?.focus()
  }
  const padPress = (action) => {
    const g = gameRef.current
    if (action === "pause") return setPause(!g.paused)
    if (g.paused) return
    if (action === "jump") {
      if (g.state === "air") input.current.trick = true
      else input.current.jump = true
    } else if (action === "brake") input.current.brake = true
  }
  const padRelease = (action) => {
    if (action === "brake") input.current.brake = false
  }
  const controls = useMemo(() => touchControls(paused), [paused])

  useEffect(() => {
    const hide = () => document.hidden && setPause(true)
    document.addEventListener("visibilitychange", hide)
    return () => document.removeEventListener("visibilitychange", hide)
  }, [])

  // ---- tilt steering (phones) ----
  useEffect(() => {
    if (!tilt) {
      tiltAim.current = null
      return
    }
    const onTilt = (e) => {
      if (e.gamma === null) return
      tiltAim.current = Math.max(-3, Math.min(3, Math.round(e.gamma / 10)))
    }
    window.addEventListener("deviceorientation", onTilt)
    return () => window.removeEventListener("deviceorientation", onTilt)
  }, [tilt])
  const toggleTilt = async () => {
    if (tilt) return setTilt(false)
    try {
      const ask = window.DeviceOrientationEvent?.requestPermission
      if (ask && (await ask()) !== "granted") return setDialog({ kind: "alert", text: "Tilt steering needs permission to use the motion sensors." })
      if (!("DeviceOrientationEvent" in window)) return setDialog({ kind: "alert", text: "This device can't tell which way it's tilted." })
      setTilt(true)
    } catch {
      setDialog({ kind: "alert", text: "Tilt steering isn't available here." })
    }
  }

  // ---- keys ----
  const onKeyDown = (e) => {
    const g = gameRef.current
    const k = e.key
    const used = () => (e.preventDefault(), e.stopPropagation())
    if (k === "F2") return used(), newRun()
    if (k === "p" || k === "P" || k === "F3" || k === "Pause" || (k === "Escape" && !paused)) return used(), setPause(!g.paused)
    if (g.paused) {
      if (k === "Escape" || k === " ") used(), setPause(false)
      return
    }
    pointer.current = null
    // presses add up until the next frame takes them
    if (k === "ArrowLeft" || k === "a") used(), (input.current.turn -= 1)
    else if (k === "ArrowRight" || k === "d") used(), (input.current.turn += 1)
    else if (k === "ArrowDown" || k === "s") used(), (input.current.aim = 0)
    else if (k === "ArrowUp" || k === "w") used(), (input.current.brake = true)
    else if (k === " " || k === "Enter") {
      used()
      if (g.state === "air") input.current.trick = true
      else input.current.jump = true
    }
  }
  const onKeyUp = (e) => {
    if (e.key === "ArrowUp" || e.key === "w") input.current.brake = false
  }

  // ---- mouse and touch ----
  const local = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const pointerProps = {
    onPointerMove: (e) => {
      if (e.pointerType === "mouse" || pointer.current) pointer.current = local(e)
    },
    onPointerDown: (e) => {
      rootRef.current?.focus()
      if (gameRef.current.paused) return
      if (e.pointerType === "mouse") {
        // a click jumps (or spins in the air)
        if (gameRef.current.state === "air") input.current.trick = true
        else input.current.jump = true
        pointer.current = local(e)
      } else {
        pointer.current = local(e)
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }
    },
    onPointerUp: (e) => {
      if (e.pointerType !== "mouse") pointer.current = null
    },
    onPointerCancel: () => (pointer.current = null),
    onPointerLeave: (e) => {
      if (e.pointerType === "mouse") pointer.current = null
    },
  }

  // ---- dev hook for tests: jump ahead, put something in the way ----
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__ski = {
      game: () => gameRef.current,
      setDistance: (meters) => {
        const g = gameRef.current
        g.y = meters * UNIT
        g.nextCourse = meters + 400
        g.cells.clear()
      },
      obstacleAhead: (kind = "tree") => {
        const g = gameRef.current
        g.dir = 0
        g.speed = Math.max(g.speed, 8)
        ensureCells(g)
        const key = `${Math.floor(g.x / 320)},${Math.floor((g.y + 30) / 320)}`
        g.cells.get(key)?.push({ kind, x: g.x, y: g.y + 30, v: 0 })
      },
    }
    return () => delete window.__ski
  }, [])

  useEffect(() => rootRef.current?.focus(), [])

  const menus = [
    {
      label: "Game",
      items: [
        { label: "New Game (F2)", onClick: newRun },
        { label: paused ? "Resume" : "Pause", checked: paused, onClick: () => setPause(!paused) },
        "-",
        { label: "High Scores...", onClick: () => setDialog({ kind: "scores" }) },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Options",
      items: [
        { label: "Tilt to Steer", checked: tilt, onClick: toggleTilt },
        "-",
        controlsMenuItem,
        { label: "Customize Touch Controls...", disabled: !showPad, onClick: () => setEditing(true) },
      ],
    },
    { label: "Help", items: [{ label: "How to Play...", onClick: () => setDialog({ kind: "help" }) }] },
  ]

  const scores = dialog?.kind === "scores" ? loadScores() : over?.scores || []

  return (
    <div
      className={mobile ? "skiRoot is-mobile" : "skiRoot"}
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      data-round={round}
    >
      <MenuBar menus={menus} />
      <div className="skiStage">
        <canvas ref={canvasRef} className="skiCanvas" {...pointerProps} onContextMenu={(e) => e.preventDefault()} aria-label="Ski slope" />
        {paused && !over && (
          <div className="skiOverlay" onClick={() => setPause(false)}>
            <div className="skiPanel">
              <b>Paused</b>
              <p>{mobile ? "Tap to carry on." : "Press P or click to carry on."}</p>
            </div>
          </div>
        )}
        {over && (
          <div className="skiOverlay">
            <div className="skiPanel skiOver">
              <b>{over.run.reason === "caught" ? "The Snow-Moose got you!" : "Game over"}</b>
              <p>
                {over.run.distance} m in {fmtTime(over.run.time)}, style {over.run.style}
                <br />
                Score: <b className="skiScore">{over.run.score}</b>
                {over.place === 0 && <span className="skiBest"> New best!</span>}
              </p>
              <ScoreTable scores={scores} highlight={over.place} />
              <button type="button" onClick={newRun} autoFocus>
                Ski Again (F2)
              </button>
            </div>
          </div>
        )}
        {showPad && (
          <TouchControls
            game="ski"
            className="skiTouchButtons"
            controls={controls}
            onPress={padPress}
            onRelease={padRelease}
            show={!over}
            editing={editing}
            onEditingChange={setEditingAndFocus}
          />
        )}
      </div>
      <div className="status-bar skiStatus">
        <p className="status-bar-field">Time {fmtTime(hud.time)}</p>
        <p className="status-bar-field" data-hud="distance">
          {hud.distance} m
        </p>
        <p className="status-bar-field">{hud.speed} km/h</p>
        <p className="status-bar-field">Style {hud.style}</p>
        {!mobile && <p className="status-bar-field skiHint">{hud.moose ? "Run!" : hud.distance < MOOSE_AT ? "Arrows steer, Space jumps" : ""}</p>}
      </div>

      {dialog?.kind === "scores" && (
        <Dialog title="Downhill High Scores" onOk={() => setDialog(null)}>
          <ScoreTable scores={scores} />
        </Dialog>
      )}
      {dialog?.kind === "help" && (
        <Dialog title="How to Play Downhill" onOk={() => setDialog(null)}>
          <p className="dialogText">
            Left and Right turn your skis, Down points them straight downhill, Up digs in to slow down. Turn all the way
            across the slope to stop. Or steer with the mouse: the skier heads toward the pointer, and a click jumps. On a
            phone, touch and hold where you want to go (or turn on Options &gt; Tilt to Steer).
            <br />
            <br />
            Space hops over rocks and stumps. Hit a ramp for a big jump, and press Space in the air to spin (but land
            before the spin ends). Ski between the flags of a slalom gate for points.
            <br />
            <br />
            Your score is the distance in meters plus style points. After 2,000 m something big and furry comes down the
            mountain. F2 starts over; P pauses.
          </p>
        </Dialog>
      )}
      {dialog?.kind === "alert" && (
        <Dialog title="Downhill" onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
    </div>
  )
}

const ScoreTable = ({ scores, highlight = -1 }) =>
  scores.length ? (
    <table className="skiScores">
      <thead>
        <tr>
          <th>#</th>
          <th>Score</th>
          <th>Distance</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
        {scores.map((s, i) => (
          <tr key={i} className={i === highlight ? "is-new" : ""}>
            <td>{i + 1}</td>
            <td>{s.score}</td>
            <td>{s.distance} m</td>
            <td>{new Date(s.date).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p className="dialogText">No runs yet. Get out there!</p>
  )

export default Ski
