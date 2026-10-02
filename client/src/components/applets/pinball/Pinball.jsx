import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import TouchControls, { fromPx, useTouchControlsMenuItem, useTouchControlsVisible } from "../../shared/controls"
import { useIsTouch } from "../../../hooks/useMediaQuery"
import * as G from "./game"
import { createRenderer } from "./render"
import { createSounds } from "./audio"
import { LANE, inShooterLane } from "./table"
import "./Pinball.css"

// Pinball: Deep Sea Dive. The table's physics and rules live in physics.js / game.js; this
// component runs the loop, draws with render.js, reads keys and touches, and shows the
// score panel, menus and high scores.

const OPTIONS_KEY = "98ish.pinball"
const SCORES_KEY = "98ish.pinball.scores"
const TITLE = "Pinball: Deep Sea Dive"

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

const LEFT_KEYS = ["KeyZ", "ShiftLeft"]
const RIGHT_KEYS = ["Slash", "ShiftRight", "NumpadDivide"]
const PLUNGER_KEYS = ["Space", "Enter", "NumpadEnter", "ArrowDown"]
const NUDGE_KEYS = { KeyX: "left", Period: "right", ArrowUp: "up" }

const CONTROLS = [
  ["Left flipper", "Z or Left Shift"],
  ["Right flipper", "/ or Right Shift"],
  ["Plunger", "Hold Space (or Enter), let go"],
  ["Nudge the table", "X (left), . (right), Up arrow"],
  ["New game", "F2"],
  ["Pause / resume", "F3"],
]

const fmt = (n) => n.toLocaleString("en-US")

// On-screen controls (shared/controls, players can move and resize them). The flippers are
// two big invisible zones, the left and right halves of the table by default. LAUNCH sits
// over the shooter lane (lane = where the table is drawn, from the renderer).
const touchControls = (lane, inLane, playing) => [
  { id: "flipLeft", action: "left", label: "Left flipper", kind: "zone", mirror: false, hidden: !playing, default: { x: 0, y: 0, w: 50, h: 100 } },
  { id: "flipRight", action: "right", label: "Right flipper", kind: "zone", mirror: false, hidden: !playing, default: { x: 50, y: 0, w: 50, h: 100 } },
  {
    id: "launch",
    label: "Launch",
    icon: (
      <>
        <span>▼</span>
        LAUNCH
      </>
    ),
    className: "pbLaunch",
    hidden: !inLane,
    default: (size) =>
      lane
        ? fromPx(size, { left: Math.min(lane.left, size.width - lane.width - 4), top: lane.top, width: lane.width, height: 64 })
        : fromPx(size, { right: 40, bottom: 80, width: 54, height: 64 }),
  },
  { id: "nudge", label: "Nudge", icon: "NUDGE", className: "pbNudge", hidden: !playing, default: (size) => fromPx(size, { left: 6, top: 6, width: 66, height: 34 }) },
]

const hudOf = (g) => {
  const mission = G.currentMission(g)
  const ball = g.world.balls[0]
  return {
    mode: g.mode,
    score: g.score,
    ball: g.ballNumber,
    multiplier: g.multiplier,
    extraBalls: g.extraBalls,
    rank: G.rankName(g.rank),
    mission: mission.text,
    progress: g.missionProgress,
    goal: G.missionGoal(g),
    message: g.message?.text || "",
    inLane: g.mode === "play" && g.world.balls.length === 1 && !!ball && inShooterLane(ball) && ball.y > 800,
    tilted: g.tilted,
    multiball: g.multiball,
  }
}
const sameHud = (a, b) => Object.keys(a).every((k) => a[k] === b[k])

const Pinball = ({ onClose, onTitle, mobile }) => {
  const touch = useIsTouch()
  const rootRef = useRef(null)
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const gameRef = useRef(null)
  if (!gameRef.current) {
    gameRef.current = G.createGame()
    G.startGame(gameRef.current)
  }
  const soundsRef = useRef(null)
  if (!soundsRef.current) soundsRef.current = createSounds()
  const input = useRef({ keys: new Set(), pointers: new Map(), zones: new Set(), plungerTouch: false, nudges: [] })
  const pausedRef = useRef(false)
  const loopRef = useRef({ start: () => {}, redraw: () => {} })
  const [paused, setPausedState] = useState(false)
  const [hud, setHud] = useState(() => hudOf(gameRef.current))
  const [options, setOptions] = useState(() => ({ sound: true, music: true, ...load(OPTIONS_KEY, {}) }))
  const [scores, setScores] = useState(() => load(SCORES_KEY, []))
  const scoresRef = useRef(scores)
  scoresRef.current = scores
  const [dialog, setDialog] = useState(null)
  const dialogRef = useRef(dialog)
  dialogRef.current = dialog
  const [width, setWidth] = useState(600)
  const [laneButton, setLaneButton] = useState(null) // where the touch plunger sits

  const compact = mobile || width < 470
  const touchVisible = useTouchControlsVisible()
  const controlsMenuItem = useTouchControlsMenuItem()
  const showPad = compact || touchVisible // on-screen LAUNCH, NUDGE and flipper zones
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    onTitle?.(TITLE)
    rootRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    soundsRef.current.setOptions(options)
    save(OPTIONS_KEY, options)
  }, [options])

  const setPaused = (value) => {
    if (pausedRef.current === value) return
    pausedRef.current = value
    setPausedState(value)
    input.current.keys.clear()
    input.current.pointers.clear()
    input.current.zones.clear()
    input.current.plungerTouch = false
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
    let raf = 0
    let last = 0
    let animTime = 0
    let size = { w: 0, h: 0 }
    let hudClock = 0
    let lastMode = gameRef.current.mode
    let disposed = false
    const perf = { frames: 0, updateMs: 0, drawMs: 0 }

    const held = (keys) => keys.some((k) => input.current.keys.has(k))
    const touching = (side) => [...input.current.pointers.values()].includes(side)

    const frame = (now) => {
      raf = 0
      if (disposed || !size.w || !size.h) return
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
      last = now
      const g = gameRef.current
      const t0 = performance.now()
      if (!pausedRef.current) {
        const i = input.current
        G.update(g, dt, {
          left: held(LEFT_KEYS) || touching("left") || i.zones.has("left"),
          right: held(RIGHT_KEYS) || touching("right") || i.zones.has("right"),
          plunger: held(PLUNGER_KEYS) || i.plungerTouch,
          nudges: i.nudges.splice(0),
        })
        for (const cue of g.sfx) sounds.play(cue)
        g.sfx.length = 0
        animTime += dt
      }
      const t1 = performance.now()
      renderer.draw(g, animTime)
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
        if (g.mode === "over" && G.qualifies(scoresRef.current, g.score)) {
          setDialog({ kind: "initials", score: g.score, name: load(OPTIONS_KEY, {}).initials || "" })
        }
      }
      if (!pausedRef.current) raf = requestAnimationFrame(frame)
    }
    const start = () => {
      if (raf || disposed || !size.w) return
      last = 0
      raf = requestAnimationFrame(frame)
    }
    const redraw = () => {
      if (size.w) renderer.draw(gameRef.current, animTime)
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
      renderer.resize(w, h, window.devicePixelRatio || 1)
      const v = renderer.view
      setLaneButton({
        left: v.x + LANE.left * v.scale - 18,
        width: (LANE.right - LANE.left) * v.scale + 36,
        top: v.y + 820 * v.scale,
      })
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
        G,
      }
    }

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      observer.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("devicemotion", onMotion)
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
      return setPaused(!pausedRef.current)
    }
    const code = e.code
    const game = LEFT_KEYS.includes(code) || RIGHT_KEYS.includes(code) || PLUNGER_KEYS.includes(code) || NUDGE_KEYS[code]
    if (!game) return
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
    input.current.keys.clear()
    input.current.pointers.clear()
    input.current.zones.clear()
    input.current.plungerTouch = false
    if (gameRef.current.mode === "play") setPaused(true)
  }

  // ---- touches and clicks: the left half works the left flipper, the right half the right ----
  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return
    soundsRef.current.unlock()
    if (pausedRef.current) {
      setPaused(false)
      return
    }
    // with on-screen controls the flipper zones take the touches
    if (gameRef.current.mode !== "play" || showPad) return
    const rect = wrapRef.current.getBoundingClientRect()
    const side = e.clientX - rect.left < rect.width / 2 ? "left" : "right"
    input.current.pointers.set(e.pointerId, side)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // the pointer is already gone
    }
  }
  const onPointerUp = (e) => {
    input.current.pointers.delete(e.pointerId)
  }

  // on-screen controls
  const padPress = (action) => {
    soundsRef.current.unlock()
    if (pausedRef.current) return setPaused(false)
    if (action === "left" || action === "right") input.current.zones.add(action)
    else if (action === "launch") input.current.plungerTouch = true
    else if (action === "nudge") input.current.nudges.push("up")
  }
  const padRelease = (action) => {
    if (action === "left" || action === "right") input.current.zones.delete(action)
    else if (action === "launch") input.current.plungerTouch = false
  }
  const playing = hud.mode === "play" && !paused
  const controls = useMemo(() => touchControls(laneButton, hud.inLane, playing), [laneButton, hud.inLane, playing])

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
      ],
    },
    {
      label: "Help",
      items: [
        { label: "How to Play...", onClick: () => setDialog({ kind: "help" }) },
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
    save(OPTIONS_KEY, { ...options, initials: name })
    setDialog({ kind: "scores", highlight: entry.date })
  }

  const hint = hud.mode !== "play"
    ? compact ? "Tap New Game to play" : "Press F2 for a new game"
    : hud.inLane
      ? touchVisible ? "Hold LAUNCH, then let go" : "Hold Space, then let go"
      : ""
  const status = hud.message || hint

  const missionLine = `${hud.mission} ${Math.min(hud.progress, hud.goal)}/${hud.goal}`

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
    >
      <MenuBar menus={menus} />
      <div className="pbBody">
        {compact && (
          <div className="pbTopBar">
            <div className="pbTopScore">{fmt(hud.score)}</div>
            <div className="pbTopInfo">
              <span>Ball {hud.ball}</span>
              {hud.multiplier > 1 && <span>{hud.multiplier}x</span>}
              {hud.extraBalls > 0 && <span>+{hud.extraBalls}</span>}
              <span className="pbTopRank">{hud.rank}</span>
            </div>
            <div className="pbTopMission">{status || missionLine}</div>
          </div>
        )}
        <div
          className="pbTable"
          ref={wrapRef}
          onPointerDown={onPointerDown}
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
          {paused && hud.mode === "play" && (
            <div className="pbOverlay">
              <div className="pbOverlayBox">
                <b>Paused</b>
                <span>{touch ? "Tap" : "Click"} to resume</span>
              </div>
            </div>
          )}
          {hud.mode === "over" && !dialog && (
            <div className="pbOverlay pbOver" onPointerDown={(e) => e.stopPropagation()}>
              <div className="pbOverlayBox">
                <span>Final score</span>
                <b>{fmt(hud.score)}</b>
                <button
                  type="button"
                  onClick={() => {
                    keepFocus()
                    newGame()
                  }}
                >
                  New Game
                </button>
                <button type="button" onClick={() => setDialog({ kind: "scores" })}>
                  High Scores
                </button>
              </div>
            </div>
          )}
        </div>
        {!compact && (
          <div className="pbPanel">
            <div className="pbLogo">
              <span>DEEP SEA</span>
              <b>DIVE</b>
            </div>
            <div className="pbLcd">
              <div className="pbLcdLabel">SCORE</div>
              <div className="pbScore" data-testid="pb-score">
                {fmt(hud.score)}
              </div>
            </div>
            <div className="pbStats">
              <div>
                <span>BALL</span>
                <b>{hud.ball}</b>
              </div>
              <div>
                <span>PLAYER</span>
                <b>1</b>
              </div>
              <div>
                <span>BONUS</span>
                <b>{hud.multiplier}x</b>
              </div>
              {hud.extraBalls > 0 && (
                <div className="pbExtra">
                  <span>EXTRA BALL</span>
                  <b>{hud.extraBalls}</b>
                </div>
              )}
            </div>
            <div className="pbLcd pbMission">
              <div className="pbLcdLabel">RANK</div>
              <div className="pbRank">{hud.rank}</div>
              <div className="pbLcdLabel">MISSION</div>
              <div className="pbMissionText">{missionLine}</div>
              <div className="pbBar">
                <i style={{ width: `${(100 * Math.min(hud.progress, hud.goal)) / hud.goal}%` }} />
              </div>
            </div>
            <div className={`pbLcd pbStatus${hud.tilted ? " is-tilt" : ""}`}>{status || " "}</div>
            <div className="pbKeys">
              <div>
                <kbd>Z</kbd> <kbd>/</kbd> flippers
              </div>
              <div>
                <kbd>Space</kbd> plunger
              </div>
              <div>
                <kbd>X</kbd> <kbd>.</kbd> <kbd>↑</kbd> nudge
              </div>
            </div>
          </div>
        )}
      </div>

      {dialog?.kind === "initials" && (
        <Dialog title="New High Score!" okLabel="OK" onOk={saveInitials} onCancel={closeDialog}>
          <p className="dialogText">
            You scored <b>{fmt(dialog.score)}</b>, one of the five best dives!
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
            On a touch screen: hold the left or right half of the table for that flipper (both at once works), hold
            LAUNCH to pull the plunger, and tap NUDGE (or give the phone a shake) to bump the table. Options &gt;
            Customize Touch Controls (or the gear) moves and resizes them.
          </p>
        </Dialog>
      )}

      {dialog?.kind === "help" && (
        <Dialog title="How to Play" onOk={closeDialog}>
          <p className="dialogText">
            Pull the plunger back and let go to launch. Keep the ball out of the drain with the flippers: you have 3 balls.
            <br />
            <br />
            <b>Missions</b> rank you up from Snorkeler to Leviathan, and some ranks earn an extra ball. Roll through
            <b> D-I-V-E</b> up top to raise the multiplier (the flippers move the lit lanes). Knock down the <b>clams</b>, and
            sink the <b>treasure chest</b> three times for multiball. Nudge the table to save a ball, but too much is a TILT.
          </p>
        </Dialog>
      )}

      {dialog?.kind === "about" && (
        <Dialog title="About Pinball" onOk={closeDialog}>
          <p className="dialogText">
            <b>{TITLE}</b> for 98ish.
            <br />
            An original table with its own physics, drawn and played right here in your browser. All synth, no samples.
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default Pinball
