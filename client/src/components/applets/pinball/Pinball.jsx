import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import Dialog from "../../shared/Dialog"
import GameStart from "../../shared/GameStart"
import { Check } from "../../shared/quickgame"
import TouchControls, { fromPx, useTouchControlsMenuItem, useTouchControlsVisible } from "../../shared/controls"
import { useIsTouch } from "../../../hooks/useMediaQuery"
import { createFrameClock } from "../../../utils/frameClock"
import { reducedMotion } from "../../../utils/settings"
import * as G from "./game"
import { createRenderer } from "./render"
import { createDmd, dmdContent } from "./dmd"
import { createSounds } from "./audio"
import { LANE, inShooterLane } from "./table"
import { K } from "./art"
import "./Pinball.css"
import { helpItem } from "../../../utils/help"

// Pinball: Blue Screen. An original 90s-style PC pinball table themed on 98ish itself.
// physics.js moves the ball, table.js lays out the table, game.js has the rules, art.js +
// render.js draw it as pixel art, dmd.js runs the dot-matrix display, audio.js the
// sounds. This component runs the loop (fixed physics steps on the shared frame clock),
// reads keys, touches, the mouse and gamepads, and shows the menus and dialogs.

const OPTIONS_KEY = "98ish.pinball"
const SCORES_KEY = "98ish.pinball.scores" // per user (the storage seam); Deep Sea Dive's scores carry over
const TITLE = "Pinball: Blue Screen"

const load = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key))
    return v ?? fallback
  } catch {
    return fallback
  }
}
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or blocked: keep it for this visit
  }
}

const LEFT_KEYS = ["KeyZ", "ShiftLeft", "ArrowLeft"]
const RIGHT_KEYS = ["Slash", "ShiftRight", "NumpadDivide", "ArrowRight"]
const PLUNGER_KEYS = ["Space", "Enter", "NumpadEnter", "ArrowDown"]
const NUDGE_KEYS = { KeyX: "left", Period: "right", ArrowUp: "up" }

const CONTROLS = [
  ["Left flippers", "Z, Left Shift or Left arrow"],
  ["Right flipper", "/, Right Shift or Right arrow"],
  ["Plunger", "Hold Space (or Down), let go"],
  ["Nudge the table", "X (left), . (right), Up arrow"],
  ["New game", "F2"],
  ["Pause / resume", "F3"],
  ["Gamepad", "Bumpers/triggers flip, A launches, B/X/Y nudge, Start = new game"],
]

const fmt = (n) => n.toLocaleString("en-US")

// On-screen buttons (shared/controls: players can move and resize them). The flippers are
// the left and right halves of the table itself; the plunger can also be dragged down.
const touchControls = (inLane, playing) => [
  {
    id: "launch",
    label: "Launch",
    icon: (
      <>
        <span>▼︎</span>
        HOLD
      </>
    ),
    className: "pbLaunch",
    hidden: !inLane,
    default: (size) => fromPx(size, { right: 40, bottom: 4, width: 76, height: 30 }),
  },
  { id: "nudge", label: "Nudge", icon: "NUDGE", className: "pbNudge", hidden: !playing, default: (size) => fromPx(size, { left: 6, top: 6, width: 62, height: 30 }) },
]

const ballInLane = (g) => {
  if (g.mode !== "play") return false
  const plays = g.world.balls.filter((b) => b.kind === "play")
  return plays.length === 1 && inShooterLane(plays[0]) && plays[0].y > 800
}

const hudOf = (g) => ({
  mode: g.mode,
  score: g.score,
  inLane: ballInLane(g),
  multiball: g.multiball,
  rank: g.rank,
  missionsDone: g.missionsDone,
  progress: g.missionProgress,
  ball: g.ballNumber,
  extraBalls: g.extraBalls,
})
const sameHud = (a, b) => Object.keys(a).every((k) => a[k] === b[k])

const Pinball = ({ onClose, onTitle, mobile }) => {
  const chatItem = useGameChatMenuItem("pinball")
  const touch = useIsTouch()
  const rootRef = useRef(null)
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const dmdRef = useRef(null)
  const gameRef = useRef(null)
  if (!gameRef.current) gameRef.current = G.createGame() // starts in attract mode
  const soundsRef = useRef(null)
  if (!soundsRef.current) soundsRef.current = createSounds()
  const input = useRef({ keys: new Set(), pointers: new Map(), pad: new Set(), plungerTouch: false, pull: undefined, drag: null, nudges: [] })
  const pausedRef = useRef(false)
  const loopRef = useRef({ start: () => {}, redraw: () => {}, resize: () => {} })
  const layoutRef = useRef({ scale: 1, left: 0, top: 0 })
  const [paused, setPausedState] = useState(false)
  const [hud, setHud] = useState(() => hudOf(gameRef.current))
  const [options, setOptions] = useState(() => ({ sound: true, music: true, ...load(OPTIONS_KEY, {}) }))
  const [scores, setScores] = useState(() => G.migrateScores(load(SCORES_KEY, [])))
  const scoresRef = useRef(scores)
  scoresRef.current = scores
  const [dialog, setDialog] = useState(null)
  const dialogRef = useRef(dialog)
  dialogRef.current = dialog
  const [width, setWidth] = useState(600)
  const [layout, setLayout] = useState(null)

  const compact = mobile || width < 520
  const compactRef = useRef(compact)
  compactRef.current = compact
  const touchVisible = useTouchControlsVisible()
  const controlsMenuItem = useTouchControlsMenuItem()
  const showPad = touch || touchVisible
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    onTitle?.(TITLE)
    rootRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    soundsRef.current.setOptions(options)
    save(OPTIONS_KEY, options)
  }, [options])

  const clearInput = () => {
    const i = input.current
    i.keys.clear()
    i.pointers.clear()
    i.pad.clear()
    i.plungerTouch = false
    i.pull = undefined
    i.drag = null
  }

  const setPaused = (value) => {
    if (pausedRef.current === value) return
    pausedRef.current = value
    setPausedState(value)
    clearInput()
    if (!value) loopRef.current.start()
    else loopRef.current.redraw()
  }

  const newGame = () => {
    G.startGame(gameRef.current)
    setDialog(null)
    setPaused(false)
    setHud(hudOf(gameRef.current))
    rootRef.current?.focus({ preventScroll: true })
    loopRef.current.start()
  }

  const keepFocus = () => rootRef.current?.focus({ preventScroll: true })

  // ---- the loop ----
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    const renderer = createRenderer(canvas)
    const sounds = soundsRef.current
    const clock = createFrameClock()
    let raf = 0
    let size = { w: 0, h: 0 }
    let hudClock = 0
    let lastMode = gameRef.current.mode
    let disposed = false
    let dmd = null
    let dmdRows = 0
    let shake = [0, 0]
    let padsKnown = false
    const perf = { frames: 0, updateMs: 0, drawMs: 0, intervals: [], substeps: 0 }
    let lastFrame = 0

    const held = (keys) => keys.some((k) => input.current.keys.has(k))
    const touching = (side) => [...input.current.pointers.values()].includes(side)

    // gamepads: polled only once one has been seen
    const readPads = () => {
      const pad = input.current.pad
      pad.clear()
      if (!padsKnown || !navigator.getGamepads) return
      for (const gp of navigator.getGamepads()) {
        if (!gp) continue
        const b = (i) => gp.buttons[i]?.pressed
        if (b(4) || b(6) || b(14)) pad.add("left")
        if (b(5) || b(7) || b(15)) pad.add("right")
        if (b(0) || b(13)) pad.add("plunger")
        for (const [i, dir] of [[1, "right"], [2, "left"], [3, "up"]]) {
          if (b(i) && !gp["was" + i]) input.current.nudges.push(dir)
          gp["was" + i] = b(i)
        }
        if (b(9) && !pad.start) {
          pad.start = true
          if (gameRef.current.mode !== "play") newGame()
        } else if (!b(9)) pad.start = false
      }
    }
    const onPad = () => {
      padsKnown = true
    }
    window.addEventListener("gamepadconnected", onPad)
    if (navigator.getGamepads?.().some(Boolean)) padsKnown = true

    const renderDmd = (g) => {
      const rows = compactRef.current ? 16 : 32
      const el = dmdRef.current
      if (!el) return
      if (!dmd || dmdRows !== rows || dmd.canvas !== el) {
        const cssW = el.parentElement?.clientWidth || 200
        const dpr = Math.min(3, window.devicePixelRatio || 1)
        const pitch = Math.max(1, Math.floor((cssW * dpr) / 128))
        dmd = createDmd(el, rows, pitch)
        dmd.canvas = el
        dmdRows = rows
        el.style.width = `${(128 * pitch) / dpr}px`
        el.style.height = `${(rows * pitch) / dpr}px`
      }
      dmd.render(dmdContent(g, g.time, { rows, scores: scoresRef.current, prompt: touch ? "TAP PLAY" : "PRESS F2" }))
    }

    const applyShake = (g) => {
      const next = renderer.shakeOffset(g, reducedMotion())
      if (next[0] === shake[0] && next[1] === shake[1]) return
      shake = next
      const s = layoutRef.current.scale
      canvas.style.transform = next[0] || next[1] ? `translate(${next[0] * s}px, ${next[1] * s}px)` : ""
    }

    const frame = (now) => {
      raf = 0
      if (disposed || !size.w || !size.h) return
      if (lastFrame) perf.intervals.push(now - lastFrame)
      if (perf.intervals.length > 600) perf.intervals.shift()
      lastFrame = now
      const dt = clock.tick(now) / 1000
      const g = gameRef.current
      const t0 = performance.now()
      if (!pausedRef.current) {
        readPads()
        const i = input.current
        const sub0 = g.world.substeps
        G.update(g, dt, {
          left: held(LEFT_KEYS) || touching("left") || i.pad.has("left"),
          right: held(RIGHT_KEYS) || touching("right") || i.pad.has("right"),
          plunger: held(PLUNGER_KEYS) || i.plungerTouch || i.pad.has("plunger"),
          pull: i.pull,
          nudges: i.nudges.splice(0),
        })
        perf.substeps += g.world.substeps - sub0
        for (const cue of g.sfx) sounds.play(cue)
        g.sfx.length = 0
        sounds.setMusic(g.multiball && g.mode === "play")
      }
      const t1 = performance.now()
      renderer.draw(g, g.time)
      applyShake(g)
      renderDmd(g)
      perf.frames++
      perf.updateMs += t1 - t0
      perf.drawMs += performance.now() - t1

      hudClock += dt
      if (hudClock > 0.1 || g.mode !== lastMode) {
        hudClock = 0
        const next = hudOf(g)
        setHud((prev) => (sameHud(prev, next) ? prev : next))
      }
      if (g.mode !== lastMode) {
        lastMode = g.mode
        if (g.mode === "over") {
          sounds.setMusic(false)
          if (G.qualifies(scoresRef.current, g.score)) setDialog({ kind: "initials", score: g.score, name: load(OPTIONS_KEY, {}).initials || "" })
        }
      }
      if (!pausedRef.current) raf = requestAnimationFrame(frame)
    }
    const start = () => {
      if (raf || disposed || !size.w) return
      clock.reset()
      lastFrame = 0
      raf = requestAnimationFrame(frame)
    }
    const redraw = () => {
      if (!size.w) return
      sounds.setMusic(false)
      renderer.draw(gameRef.current, gameRef.current.time)
      renderDmd(gameRef.current)
    }
    loopRef.current = { start, redraw }

    const resize = () => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      size = { w, h }
      setWidth(rootRef.current?.clientWidth || w)
      if (!w || !h) {
        // minimized (or closed): stop until the window comes back
        if (gameRef.current.mode === "play") setPaused(true)
        if (raf) cancelAnimationFrame(raf)
        raf = 0
        return
      }
      const fit = renderer.resize(w, h, Math.min(3, window.devicePixelRatio || 1))
      layoutRef.current = fit
      canvas.style.width = `${fit.width}px`
      canvas.style.height = `${fit.height}px`
      canvas.style.left = `${fit.left}px`
      canvas.style.top = `${fit.top}px`
      canvas.classList.toggle("is-smooth", fit.smooth)
      setLayout({ ...fit })
      dmd = null
      redraw()
      if (!pausedRef.current) start()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)

    const onVisibility = () => {
      if (document.hidden && gameRef.current.mode === "play") setPaused(true)
    }
    document.addEventListener("visibilitychange", onVisibility)

    // shaking a phone nudges the table
    let lastShake = 0
    const onMotion = (e) => {
      const a = e.acceleration
      if (!a || pausedRef.current) return
      const m = Math.hypot(a.x || 0, a.y || 0, a.z || 0)
      if (m > 20 && performance.now() - lastShake > 450) {
        lastShake = performance.now()
        input.current.nudges.push("up")
      }
    }
    if (touch) window.addEventListener("devicemotion", onMotion)

    if (import.meta.env.DEV) {
      window.__pinball = {
        game: () => gameRef.current,
        perf,
        paused: () => pausedRef.current,
        layout: () => layoutRef.current,
        input: input.current,
        newGame,
        G,
      }
    }

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      observer.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("devicemotion", onMotion)
      window.removeEventListener("gamepadconnected", onPad)
      sounds.close()
      if (import.meta.env.DEV) delete window.__pinball
    }
  }, [])

  // ---- keys ----
  const onKeyDown = (e) => {
    if (dialogRef.current || e.target.closest?.("input, textarea, select")) return
    soundsRef.current.unlock()
    if (e.key === "F2") {
      e.preventDefault()
      return newGame()
    }
    if (e.key === "F3") {
      e.preventDefault()
      if (gameRef.current.mode !== "play" && !pausedRef.current) return
      return setPaused(!pausedRef.current)
    }
    const code = e.code
    const game = LEFT_KEYS.includes(code) || RIGHT_KEYS.includes(code) || PLUNGER_KEYS.includes(code) || NUDGE_KEYS[code]
    if (!game || gameRef.current.mode !== "play") return
    e.preventDefault()
    if (pausedRef.current) return
    if (NUDGE_KEYS[code]) {
      if (!e.repeat) input.current.nudges.push(NUDGE_KEYS[code])
      return
    }
    input.current.keys.add(code)
  }
  const onKeyUp = (e) => {
    input.current.keys.delete(e.code)
  }
  const onBlur = (e) => {
    if (rootRef.current?.contains(e.relatedTarget)) return
    clearInput()
    if (gameRef.current.mode === "play") setPaused(true)
  }

  // ---- touches and clicks: the left half works the left flippers, the right half the
  // right one; with the ball in the shooter lane, drag the plunger down and let go ----
  const tablePoint = (e) => {
    const rect = wrapRef.current.getBoundingClientRect()
    const l = layoutRef.current
    return { x: (e.clientX - rect.left - l.left) / l.scale / K, y: (e.clientY - rect.top - l.top) / l.scale / K, rect }
  }
  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return
    soundsRef.current.unlock()
    if (pausedRef.current) {
      setPaused(false)
      return
    }
    const g = gameRef.current
    if (g.mode !== "play") return
    const pt = tablePoint(e)
    const i = input.current
    if (ballInLane(g) && pt.x > LANE.left - 120 && pt.y > 560 && !i.drag) {
      i.drag = { id: e.pointerId, y0: e.clientY, span: Math.max(60, 120 * layoutRef.current.scale * K * 2) }
      i.pull = 0
    } else {
      i.pointers.set(e.pointerId, pt.x < (LANE.left + 20) / 2 ? "left" : "right")
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // the pointer is already gone
    }
  }
  const onPointerMove = (e) => {
    const i = input.current
    if (i.drag && i.drag.id === e.pointerId) i.pull = Math.max(0, Math.min(1, (e.clientY - i.drag.y0) / i.drag.span))
  }
  const onPointerUp = (e) => {
    const i = input.current
    if (i.drag && i.drag.id === e.pointerId) {
      i.drag = null
      i.pull = undefined
    }
    i.pointers.delete(e.pointerId)
  }

  // on-screen buttons
  const padPress = (action) => {
    soundsRef.current.unlock()
    if (pausedRef.current) return setPaused(false)
    if (action === "launch") input.current.plungerTouch = true
    else if (action === "nudge") input.current.nudges.push("up")
  }
  const padRelease = (action) => {
    if (action === "launch") input.current.plungerTouch = false
  }
  const playing = hud.mode === "play" && !paused
  const controls = useMemo(() => touchControls(hud.inLane, playing), [hud.inLane, playing])

  // customizing the controls pauses the game (it stays paused after: tap to resume)
  useEffect(() => {
    if (editing && gameRef.current.mode === "play") setPaused(true)
  }, [editing])
  const setEditingAndFocus = (value) => {
    setEditing(value)
    if (!value) keepFocus()
  }

  // ---- menus ----
  const menus = [
    {
      label: "Game",
      items: [
        { label: "New Game F2", onClick: newGame },
        { label: paused ? "Resume Game F3" : "Pause Game F3", disabled: hud.mode !== "play", onClick: () => setPaused(!paused) },
        "-",
        { label: "High Scores...", onClick: () => setDialog({ kind: "scores" }) },
        "-",
        { label: "Exit", onClick: () => onClose?.() },
      ],
    },
    {
      label: "Options",
      items: [
        { label: "Sounds", checked: options.sound, onClick: () => setOptions((o) => ({ ...o, sound: !o.sound })) },
        { label: "Music", checked: options.music, onClick: () => setOptions((o) => ({ ...o, music: !o.music })) },
        "-",
        { label: "Player Controls...", onClick: () => setDialog({ kind: "controls" }) },
        controlsMenuItem,
        { label: "Customize Touch Controls...", disabled: !showPad, onClick: () => setEditing(true) },
        "-",
        chatItem,
      ],
    },
    {
      label: "Help",
      items: [
        helpItem({ program: "Pinball" }),
        "-",
        { label: "How to Play...", onClick: () => setDialog({ kind: "help" }) },
        { label: "Missions...", onClick: () => setDialog({ kind: "missions" }) },
        { label: "About Pinball...", onClick: () => setDialog({ kind: "about" }) },
      ],
    },
  ]

  // a dialog is open: the game waits behind it
  const openDialog = !!dialog
  useEffect(() => {
    if (openDialog && gameRef.current.mode === "play") setPaused(true)
    if (!openDialog) keepFocus()
  }, [openDialog])

  const closeDialog = () => setDialog(null)

  const saveInitials = () => {
    const name = G.cleanInitials(dialog.name)
    const entry = { name, score: dialog.score, date: Date.now() }
    const next = G.insertScore(scoresRef.current, entry)
    setScores(next)
    save(SCORES_KEY, next)
    setOptions((o) => ({ ...o, initials: name }))
    setDialog({ kind: "scores", highlight: entry.date })
  }

  const rankNow = G.rankName(hud.rank)
  const missionRows = G.MISSIONS.map((m, i) => {
    const done = i < hud.missionsDone % G.MISSIONS.length
    const current = i === hud.missionsDone % G.MISSIONS.length
    return { ...m, done, current, rank: G.RANKS[i] }
  })

  const startScreen = hud.mode !== "play" && !dialog && (
    <div className="pbStart" onPointerDown={(e) => e.stopPropagation()}>
      <div className="pbStartWin">
        <div className="pbStartTitle">{hud.mode === "over" ? "Game Over" : "Pinball"}</div>
        <GameStart
          id="pinball"
          title={hud.mode === "over" ? <div className="pbFinal">Final score <b>{fmt(hud.score)}</b></div> : <div className="pbLogo">BLUE SCREEN</div>}
          play={{
            label: hud.mode === "over" ? "Play Again" : "Play",
            sub: "3 balls - missions from Intern to Sysadmin",
            onClick: () => {
              soundsRef.current.unlock()
              newGame()
            },
          }}
          modes={[
            { key: "scores", label: "High Scores", sub: scores[0] ? `Best: ${scores[0].name} ${fmt(scores[0].score)}` : "No scores yet", onClick: () => setDialog({ kind: "scores" }) },
            { key: "how", label: "How to Play", sub: "Flippers, plunger, missions", onClick: () => setDialog({ kind: "help" }) },
          ]}
          moreLabel="More"
          options={
            <>
              <Check id="pbSound" checked={options.sound} onChange={() => setOptions((o) => ({ ...o, sound: !o.sound }))}>
                Sounds
              </Check>
              <Check id="pbMusic" checked={options.music} onChange={() => setOptions((o) => ({ ...o, music: !o.music }))}>
                Music
              </Check>
            </>
          }
          optionsSummary={[options.sound ? "Sounds on" : "Sounds off", options.music ? "Music on" : "Music off"].join(" · ")}
        />
      </div>
    </div>
  )

  return (
    <div
      className={`pbRoot${compact ? " pbCompact" : ""}`}
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
      onContextMenu={(e) => e.preventDefault()}
      data-paused={paused ? "1" : "0"}
      data-mode={hud.mode}
    >
      <MenuBar menus={menus} />
      <GameChat game="pinball" title="Pinball" />
      <div className="pbBody">
        {compact && (
          <div className="pbTopBar">
            <div className="pbDmdBox">
              <canvas ref={dmdRef} className="pbDmd" data-testid="pb-dmd" />
            </div>
          </div>
        )}
        <div
          className="pbTable"
          ref={wrapRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onLostPointerCapture={onPointerUp}
        >
          <canvas ref={canvasRef} className="pbCanvas" />
          {showPad && (
            <TouchControls
              game="pinball"
              controls={controls}
              onPress={padPress}
              onRelease={padRelease}
              show={playing}
              editing={editing}
              onEditingChange={setEditingAndFocus}
            />
          )}
          {hud.inLane && playing && touch && layout && (
            <div
              className="pbPullHint"
              style={{ left: layout.left + (LANE.left - 70) * K * layout.scale, top: layout.top + 820 * K * layout.scale }}
              aria-hidden="true"
            >
              PULL
              <br />▼︎
            </div>
          )}
          {paused && hud.mode === "play" && (
            <div className="pbOverlay">
              <div className="pbOverlayBox">
                <b>Paused</b>
                <span>{touch ? "Tap" : "Click"} to resume</span>
              </div>
            </div>
          )}
          {startScreen}
        </div>
        {!compact && (
          <div className="pbPanel">
            <div className="pbDmdBox">
              <canvas ref={dmdRef} className="pbDmd" data-testid="pb-dmd" />
            </div>
            <div className="pbScoreLine" data-testid="pb-score">
              {fmt(hud.score)}
            </div>
            <fieldset className="pbGroup">
              <legend>Missions - {rankNow}</legend>
              <ol className="pbMissions">
                {missionRows.map((m) => (
                  <li key={m.id} className={m.done ? "is-done" : m.current ? "is-current" : ""}>
                    <span className="pbTick">{m.done ? "✓︎" : m.current ? "▶︎" : ""}</span>
                    {m.name}
                  </li>
                ))}
              </ol>
            </fieldset>
            <div className="pbStats">
              <span>
                Ball <b>{hud.mode === "play" ? hud.ball : "-"}</b> of 3
              </span>
              {hud.extraBalls > 0 && <span className="pbExtra">+{hud.extraBalls} extra</span>}
            </div>
            <div className="pbKeys">
              <div>
                <kbd>Z</kbd> <kbd>/</kbd> flippers
              </div>
              <div>
                <kbd>Space</kbd> plunger
              </div>
              <div>
                <kbd>X</kbd> <kbd>.</kbd> <kbd>↑︎</kbd> nudge
              </div>
            </div>
          </div>
        )}
      </div>

      {dialog?.kind === "initials" && (
        <Dialog title="New High Score!" okLabel="OK" onOk={saveInitials} onCancel={closeDialog}>
          <p className="dialogText">
            You scored <b>{fmt(dialog.score)}</b>, one of the ten best!
            <br />
            Enter your initials:
          </p>
          <input
            className="pbInitials"
            maxLength={3}
            value={dialog.name}
            autoComplete="off"
            spellCheck={false}
            aria-label="Initials"
            onChange={(e) => setDialog({ ...dialog, name: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
          />
        </Dialog>
      )}

      {dialog?.kind === "scores" && (
        <Dialog title="High Scores" onOk={closeDialog}>
          <table className="pbScores">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: G.HIGH_SCORE_COUNT }, (_, i) => scores[i]).map((s, i) => (
                <tr key={i} className={s && s.date === dialog.highlight ? "is-new" : ""}>
                  <td>{i + 1}.</td>
                  <td>{s ? s.name : "---"}</td>
                  <td>{s ? fmt(s.score) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {scores.length > 0 && (
            <button
              type="button"
              className="pbReset"
              onClick={() => {
                setScores([])
                save(SCORES_KEY, [])
              }}
            >
              Reset Scores
            </button>
          )}
        </Dialog>
      )}

      {dialog?.kind === "controls" && (
        <Dialog title="Player Controls" onOk={closeDialog}>
          <table className="pbControls">
            <tbody>
              {CONTROLS.map(([what, keys]) => (
                <tr key={what}>
                  <td>{what}</td>
                  <td>
                    <b>{keys}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="dialogText">
            On a touch screen: hold the left or right half of the table for those flippers (both at once works). With the ball in the
            shooter lane, drag the plunger down and let go (or hold the HOLD button). Tap NUDGE, or give the phone a shake, to bump the
            table. Options &gt; Customize Touch Controls moves and resizes the buttons.
          </p>
        </Dialog>
      )}

      {dialog?.kind === "help" && (
        <Dialog title="How to Play" onOk={closeDialog}>
          <p className="dialogText">
            Pull the plunger back and let go to launch. Keep the ball out of the drain with the flippers: you have 3 balls. The left
            button also works the little flipper on the upper left.
            <br />
            <br />
            Complete <b>missions</b> (shown on the display) to climb from Intern to Sysadmin. Knock down <b>9-8-I-S-H</b> to light the
            lock, then shoot the <b>Blue Screen</b>: three locked balls start multiball, and the <b>My Computer</b> ramp scores jackpots.
            Roll through <b>M-S-G</b> up top to raise the bonus (the flippers move the lit lanes). The <b>Floppy drive</b> relights
            <b> Restore</b>, which kicks a ball back from the left outlane once. Nudge to save a ball, but too much is a TILT.
          </p>
        </Dialog>
      )}

      {dialog?.kind === "missions" && (
        <Dialog title="Missions" onOk={closeDialog}>
          <table className="pbControls">
            <tbody>
              {G.MISSIONS.map((m, i) => (
                <tr key={m.id}>
                  <td>
                    <b>{m.name}</b>
                  </td>
                  <td>{m.text}</td>
                  <td>{G.RANKS[Math.min(i + 1, G.RANKS.length - 1)]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="dialogText">Ranks 3 and 6 light an extra ball at the Floppy drive. After Sysadmin, the missions go round again and ask for more.</p>
        </Dialog>
      )}

      {dialog?.kind === "about" && (
        <Dialog title="About Pinball" onOk={closeDialog}>
          <p className="dialogText">
            <b>{TITLE}</b> for 98ish.
            <br />
            An original table in the spirit of 1990s PC pinball: hand-made pixel art, its own physics, all sounds synthesized right here.
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default Pinball
