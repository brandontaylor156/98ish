import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import TouchControls, { GLYPHS, fromPx, useTouchControlsMenuItem, useTouchControlsVisible } from "../../shared/controls"
import { unlock } from "../../../utils/achievements"
import { RulesPrimer, ControlsHelp } from "./RulesPrimer"
import "./Pickleball.css"

// Pickleball 98: React draws the menus, the scoreboard and the call-outs. The court, the
// players and the ball are three.js (engine.js, loaded on first open with three.js); the
// game itself is match.js (physics.js + rules.js + ai.js).

const PREFS_KEY = "98ish.pickleball"
const DEFAULTS = { doubles: true, level: "intermediate", scoring: "sideout", target: 11, sound: true, camera: "follow", aid: true, assist: true }
const LEVEL_LABEL = { beginner: "Beginner", intermediate: "Intermediate", pro: "Pro" }

const readPrefs = () => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY)) }
  } catch {
    return { ...DEFAULTS }
  }
}
const writePrefs = (p) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    // storage unavailable: lasts for this visit
  }
}

// on-screen controls (shared/controls): a joystick area on the left, shot buttons on the right
const touchControls = (serveTime) => [
  { id: "move", label: "Move (drag)", kind: "zone", mirror: true, default: { portrait: (s) => fromPx(s, { left: 0, bottom: 0, width: Math.round(s.width * 0.5), height: Math.round(s.height * 0.42) }), landscape: (s) => fromPx(s, { left: 0, bottom: 0, width: Math.round(s.width * 0.4), height: Math.round(s.height * 0.6) }) } },
  { id: "drive", label: serveTime ? "Hard serve" : "Drive", shape: "round", className: "pkShot pkShot--drive", default: (s) => fromPx(s, { right: 14, bottom: 84, width: 66, height: 66 }) },
  { id: "dink", label: serveTime ? "Soft serve" : "Dink", shape: "round", className: "pkShot pkShot--dink", default: (s) => fromPx(s, { right: 88, bottom: 22, width: 66, height: 66 }) },
  { id: "drop", label: "Drop", shape: "round", className: "pkShot pkShot--drop", default: (s) => fromPx(s, { right: 14, bottom: 10, width: 60, height: 60 }) },
  { id: "lob", label: "Lob", shape: "round", className: "pkShot pkShot--lob", default: (s) => fromPx(s, { right: 92, bottom: 104, width: 54, height: 54 }) },
  { id: "pause", label: "Pause", icon: GLYPHS.pause, shape: "round", className: "pkShot pkShot--small", default: (s) => fromPx(s, { right: 8, top: 64, width: 36, height: 36 }) },
]
const SHOT_POWER = { drive: 0.85, dink: 0.25, drop: 0.4, lob: 0.5 }

let calloutId = 0

const Pickleball = ({ onClose, mobile }) => {
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const timers = useRef(new Set())
  const [phase, setPhase] = useState("loading") // loading | error | title | playing | paused | over
  const [prefs, setPrefsState] = useState(readPrefs)
  const [hud, setHud] = useState(null)
  const [callouts, setCallouts] = useState([])
  const [shotLabel, setShotLabel] = useState(null)
  const [result, setResult] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [editing, setEditing] = useState(false)
  const [stickUi, setStickUi] = useState(null)
  const [zoneHint, setZoneHint] = useState(null)
  const touchVisible = useTouchControlsVisible()
  const controlsMenuItem = useTouchControlsMenuItem()
  const chatItem = useGameChatMenuItem("pickleball")
  const showPad = mobile || touchVisible
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
  }
  const callout = (text, kind = "info", ms = 1600) => {
    const id = ++calloutId
    setCallouts((list) => [...list.slice(-2), { id, text, kind }])
    later(() => setCallouts((list) => list.filter((c) => c.id !== id)), ms)
  }

  const setPrefs = (patch) => {
    const next = { ...prefsRef.current, ...patch }
    setPrefsState(next)
    writePrefs(next)
    engineRef.current?.setSettings({ sound: next.sound, camera: next.camera, aid: next.aid, assist: next.assist })
  }

  // ---- the engine (three.js loads here, on first open) ----
  useEffect(() => {
    let cancelled = false
    let engine = null
    import("./engine")
      .then(({ createEngine }) => {
        if (cancelled) return
        try {
          const p = prefsRef.current
          engine = createEngine({
            canvas: canvasRef.current,
            container: stageRef.current,
            settings: { sound: p.sound, camera: p.camera, aid: p.aid, assist: p.assist },
            onStatus: (s) => setPhase(s),
            onHud: setHud,
            onEvent: (e) => {
              switch (e.type) {
                case "call":
                  callout(e.call, "call", 1300)
                  break
                case "fault":
                  callout(e.call, e.yours ? "good" : "bad", 1700)
                  break
                case "line":
                  if (e.call === "In") callout("In!", "line", 900)
                  break
                case "point": {
                  const what = e.outcome === "side-out" ? "Side out" : e.outcome === "second-server" ? "Second server" : e.yours ? "Your point" : "Their point"
                  later(() => callout(what, e.yours ? "good" : "bad", 1300), 700)
                  break
                }
                case "hit":
                  if (e.mine) {
                    setShotLabel({ id: ++calloutId, text: e.volley && e.kind !== "smash" ? `${e.label} (volley)` : e.label })
                  }
                  break
                case "gameover":
                  setResult(e)
                  if (e.youWon) {
                    unlock("pickleball-win")
                    if (prefsRef.current.level === "pro") unlock("pickleball-pro")
                  }
                  break
                default:
              }
            },
          })
        } catch (error) {
          console.error(error)
          setPhase("error")
          return
        }
        engineRef.current = engine
        setPhase("title")
      })
      .catch((error) => {
        console.error(error)
        if (!cancelled) setPhase("error")
      })
    return () => {
      cancelled = true
      for (const id of timers.current) clearTimeout(id)
      timers.current.clear()
      engine?.dispose()
      engineRef.current = null
    }
  }, [])

  const newMatch = (patch) => {
    if (patch) setPrefs(patch)
    const p = { ...prefsRef.current, ...patch }
    setResult(null)
    setCallouts([])
    setShotLabel(null)
    engineRef.current?.newMatch({ doubles: p.doubles, level: p.level, scoring: p.scoring, target: p.target })
  }
  const togglePause = () => {
    const e = engineRef.current
    if (!e) return
    if (e.status === "playing") e.pause()
    else if (e.status === "paused") e.resume()
  }
  // a menu choice that changes the match starts a new one (if one is going)
  const matchOption = (patch) => {
    if (phase === "playing" || phase === "paused" || phase === "over") newMatch(patch)
    else setPrefs(patch)
  }

  const onKeyDown = (e) => {
    if (e.key === "F2") {
      e.preventDefault()
      newMatch()
    } else if ((e.key === "Enter" || e.key === " ") && (phase === "title" || phase === "over") && e.target === stageRef.current) {
      e.preventDefault()
      newMatch()
    }
  }

  // ---- the joystick: the "move" zone of the on-screen controls ----
  const stick = useRef(null)
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !showPad) return
    const R = 48
    const down = (e) => {
      if (stick.current || !e.target.closest?.('[data-control="move"]')) return
      const r = stage.getBoundingClientRect()
      stick.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY }
      setStickUi({ x: e.clientX - r.left, y: e.clientY - r.top, kx: 0, ky: 0 })
    }
    const move = (e) => {
      const s = stick.current
      if (!s || s.id !== e.pointerId) return
      let dx = e.clientX - s.x0
      let dy = e.clientY - s.y0
      const d = Math.hypot(dx, dy)
      if (d > R) {
        dx = (dx / d) * R
        dy = (dy / d) * R
      }
      const live = d > 6 // a small dead zone
      engineRef.current?.setStick(live ? dx / R : 0, live ? -dy / R : 0)
      setStickUi((u) => u && { ...u, kx: dx, ky: dy })
    }
    const up = (e) => {
      if (!stick.current || stick.current.id !== e.pointerId) return
      stick.current = null
      engineRef.current?.setStick(0, 0)
      setStickUi(null)
    }
    stage.addEventListener("pointerdown", down, true)
    stage.addEventListener("pointermove", move, true)
    stage.addEventListener("pointerup", up, true)
    stage.addEventListener("pointercancel", up, true)
    // where the joystick area is (players can move it), for the resting hint
    const measure = () => {
      const zone = stage.querySelector('[data-control="move"]')
      if (!zone) return setZoneHint(null)
      const r = stage.getBoundingClientRect()
      const z = zone.getBoundingClientRect()
      setZoneHint((h) => {
        const next = { x: z.left - r.left + z.width / 2, y: z.top - r.top + z.height / 2 }
        return h && Math.abs(h.x - next.x) < 1 && Math.abs(h.y - next.y) < 1 ? h : next
      })
    }
    const t = setInterval(measure, 600)
    measure()
    return () => {
      clearInterval(t)
      stage.removeEventListener("pointerdown", down, true)
      stage.removeEventListener("pointermove", move, true)
      stage.removeEventListener("pointerup", up, true)
      stage.removeEventListener("pointercancel", up, true)
    }
  }, [showPad])

  const serveTime = !!hud?.yourServe
  const controls = useMemo(() => touchControls(serveTime), [serveTime])
  const padPress = (action) => {
    const e = engineRef.current
    if (!e) return
    if (action === "pause") return togglePause()
    if (action === "move") return
    e.shot(action, SHOT_POWER[action] ?? 0.5)
  }
  useEffect(() => {
    if (editing && engineRef.current?.status === "playing") engineRef.current.pause()
  }, [editing])
  const setEditingAndFocus = (value) => {
    setEditing(value)
    if (!value) stageRef.current?.focus({ preventScroll: true })
  }

  const menus = [
    {
      label: "Game",
      items: [
        { label: "New Match (F2)", onClick: () => newMatch() },
        { label: phase === "paused" ? "Resume (P)" : "Pause (P)", disabled: phase !== "playing" && phase !== "paused", onClick: togglePause },
        "-",
        { label: "Singles", checked: !prefs.doubles, onClick: () => matchOption({ doubles: false }) },
        { label: "Doubles", checked: prefs.doubles, onClick: () => matchOption({ doubles: true }) },
        "-",
        ...Object.entries(LEVEL_LABEL).map(([level, label]) => ({ label, checked: prefs.level === level, onClick: () => matchOption({ level }) })),
        "-",
        { label: "Side-out Scoring", checked: prefs.scoring === "sideout", onClick: () => matchOption({ scoring: "sideout" }) },
        { label: "Rally Scoring", checked: prefs.scoring === "rally", onClick: () => matchOption({ scoring: "rally" }) },
        ...[11, 15, 21].map((target) => ({ label: `Game to ${target}`, checked: prefs.target === target, onClick: () => matchOption({ target }) })),
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Options",
      items: [
        { label: "Sound", checked: prefs.sound, onClick: () => setPrefs({ sound: !prefs.sound }) },
        { label: "Camera: Behind You", checked: prefs.camera === "follow", onClick: () => setPrefs({ camera: "follow" }) },
        { label: "Camera: High", checked: prefs.camera === "high", onClick: () => setPrefs({ camera: "high" }) },
        { label: "Show Trajectory Aid", checked: prefs.aid, onClick: () => setPrefs({ aid: !prefs.aid }) },
        { label: "Movement Assist", checked: prefs.assist, onClick: () => setPrefs({ assist: !prefs.assist }) },
        "-",
        controlsMenuItem,
        { label: "Customize Touch Controls...", disabled: !showPad, onClick: () => setEditing(true) },
        "-",
        chatItem,
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Rules Primer...", onClick: () => setDialog("rules") },
        { label: "Controls...", onClick: () => setDialog("controls") },
        "-",
        { label: "About Pickleball 98...", onClick: () => setDialog("about") },
      ],
    },
  ]

  const teamName = (team) => (team === 0 ? (hud?.doubles ? "You + Partner" : "You") : hud?.doubles ? "Opponents" : "Opponent")

  return (
    <div className={mobile ? "pkRoot is-mobile" : "pkRoot"} onKeyDown={onKeyDown}>
      <MenuBar menus={menus} />
      <GameChat game="pickleball" title="Pickleball 98" />
      <div className="pkStage" ref={stageRef} tabIndex={0} data-phase={phase}>
        <canvas className="pkCanvas" ref={canvasRef} aria-label="Pickleball court" />

        {phase === "loading" && <div className="pkCenter pkLoading">Loading the court...</div>}
        {phase === "error" && (
          <div className="pkCenter">
            <div className="pkPanel">
              <b>Can't start Pickleball 98</b>
              <p>This game needs WebGL graphics, which this browser or device doesn't have available right now.</p>
            </div>
          </div>
        )}

        {hud && (phase === "playing" || phase === "paused" || phase === "over") && (
          <div className="pkScore" aria-live="polite">
            <div className="pkCall" data-testid="score-call">
              {hud.call}
            </div>
            {[0, 1].map((team) => (
              <div key={team} className={`pkTeam pkTeam--${team}`}>
                <span className="pkServe" aria-label={hud.serving === team ? "serving" : undefined}>
                  {hud.serving === team ? "●" : ""}
                </span>
                <span className="pkTeamName">{teamName(team)}</span>
                <span className="pkPoints">{hud.score[team]}</span>
              </div>
            ))}
            <div className="pkMeta">
              {hud.scoring === "rally" ? "Rally scoring" : "Side-out"} &middot; to {hud.target}
              {hud.server ? ` · ${hud.server} serving` : ""}
            </div>
          </div>
        )}

        {(phase === "playing" || phase === "paused") && (
          <div className="pkCallouts" aria-live="assertive">
            {callouts.map((c) => (
              <div key={c.id} className={`pkCallout pkCallout--${c.kind}`}>
                {c.text}
              </div>
            ))}
          </div>
        )}
        {phase === "playing" && shotLabel && (
          <div key={shotLabel.id} className="pkShotLabel">
            {shotLabel.text}
          </div>
        )}
        {phase === "playing" && hud?.yourServe && (
          <div className="pkPrompt">{showPad ? "Your serve: tap Soft or Hard serve" : "Your serve: Space (hold for a harder serve), or click"}</div>
        )}

        {phase === "title" && (
          <div className="pkCenter pkTitleWrap">
            <div className="pkTitle window">
              <div className="title-bar">
                <div className="title-bar-text">Pickleball 98</div>
              </div>
              <div className="window-body">
                <div className="pkLogo" aria-hidden="true">
                  <span>Pickle</span>
                  <span>ball</span>
                  <small>98</small>
                </div>
                <p className="pkTag">Real-court physics. Real rules. Mind the kitchen.</p>
                <div className="pkChoices">
                  <fieldset>
                    <legend>Play</legend>
                    {[
                      [false, "Singles"],
                      [true, "Doubles"],
                    ].map(([value, label]) => (
                      <div className="field-row" key={label}>
                        <input id={`pk-mode-${label}`} type="radio" name="pk-mode" checked={prefs.doubles === value} onChange={() => setPrefs({ doubles: value })} />
                        <label htmlFor={`pk-mode-${label}`}>{label}</label>
                      </div>
                    ))}
                  </fieldset>
                  <fieldset>
                    <legend>Opponents</legend>
                    {Object.entries(LEVEL_LABEL).map(([level, label]) => (
                      <div className="field-row" key={level}>
                        <input id={`pk-level-${level}`} type="radio" name="pk-level" checked={prefs.level === level} onChange={() => setPrefs({ level })} />
                        <label htmlFor={`pk-level-${level}`}>{label}</label>
                      </div>
                    ))}
                  </fieldset>
                </div>
                <div className="pkTitleButtons">
                  <button type="button" className="pkPlay" onClick={() => newMatch()} autoFocus>
                    Play
                  </button>
                  <button type="button" onClick={() => setDialog("rules")}>
                    Rules Primer
                  </button>
                  {showPad && (
                    <button type="button" onClick={() => setEditing(true)}>
                      Customize Controls
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {phase === "paused" && !editing && (
          <div className="pkCenter pkDim" onClick={() => engineRef.current?.resume()}>
            <div className="pkPanel" onClick={(e) => e.stopPropagation()}>
              <b>Paused</b>
              <p>{showPad ? "Tap Resume to keep playing." : "Press P, or click Resume."}</p>
              <div className="pkTitleButtons">
                <button type="button" className="pkPlay" onClick={() => engineRef.current?.resume()} autoFocus>
                  Resume
                </button>
                {showPad && (
                  <button type="button" onClick={() => setEditing(true)}>
                    Customize Controls
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {phase === "over" && result && (
          <div className="pkCenter pkDim">
            <div className="pkPanel pkOver">
              <b className={result.youWon ? "pkWin" : "pkLose"}>{result.youWon ? "You win!" : "They win this one"}</b>
              <p className="pkFinal">
                {result.score[0]} - {result.score[1]}
              </p>
              <p>
                {result.stats.rallies} rallies &middot; longest {result.stats.longest} shots
              </p>
              <div className="pkTitleButtons">
                <button type="button" className="pkPlay" onClick={() => newMatch()} autoFocus>
                  Play Again (F2)
                </button>
              </div>
            </div>
          </div>
        )}

        {showPad && stickUi && (
          <div className="pkStick" style={{ left: stickUi.x, top: stickUi.y }} aria-hidden="true">
            <div className="pkKnob" style={{ transform: `translate(${stickUi.kx}px, ${stickUi.ky}px)` }} />
          </div>
        )}
        {showPad && !stickUi && zoneHint && phase === "playing" && !editing && (
          <div className="pkStick pkStick--hint" style={{ left: zoneHint.x, top: zoneHint.y }} aria-hidden="true">
            <div className="pkKnob" />
          </div>
        )}
        {showPad && phase !== "loading" && phase !== "error" && (
          <TouchControls
            game="pickleball"
            controls={controls}
            onPress={padPress}
            show={phase === "playing"}
            editing={editing}
            onEditingChange={setEditingAndFocus}
            gearStyle={{ right: 8, top: 108, width: 36, height: 36 }}
            gearClassName="pkGear"
          />
        )}
      </div>

      {dialog === "rules" && <RulesPrimer onClose={() => setDialog(null)} />}
      {dialog === "controls" && (
        <Dialog title="Pickleball 98 Controls" onOk={() => setDialog(null)}>
          <ControlsHelp touch={showPad} />
        </Dialog>
      )}
      {dialog === "about" && (
        <Dialog title="About Pickleball 98" onOk={() => setDialog(null)}>
          <p className="dialogText">
            Pickleball 98 plays on a regulation 20 x 44 ft court with a 34 in net at the center. The ball is a 26 g,
            74 mm outdoor ball with real drag, spin and bounce; the computer players use the same physics you do.
            <br />
            <br />
            {LEVEL_LABEL[prefs.level]} opponents, {prefs.doubles ? "doubles" : "singles"}, {prefs.scoring === "rally" ? "rally" : "side-out"} scoring to {prefs.target}.
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default Pickleball
