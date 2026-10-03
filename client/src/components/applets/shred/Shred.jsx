import React, { useEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import TouchControls, { GLYPHS, fromPx, useTouchControlsMenuItem, useTouchControlsVisible } from "../../shared/controls"
import { unlock } from "../../../utils/achievements"
import { masterGain, useSettings } from "../../../utils/settings"
import { SONGS, TIERS } from "./songs/index.js"
import { KEYS, loadPrefs, loadProgress, record, save, tierUnlocked, totalStars, load } from "./progress.js"
import { CAL_DEFAULT } from "./timing.js"
import { zoneOf } from "./rockmeter.js"
import {
  CalibrateScreen, FailedScreen, HowToScreen, LANE_CSS, Logo, OptionsScreen, PauseScreen, ResultsScreen, SongScreen, TitleScreen, fmtScore, keyName, DIFF_LABEL,
} from "./screens.jsx"
import "./Shred.css"

// Shred 98: a rock rhythm game. React draws the menus, the HUD and the call-outs; the stage
// and the note highway are three.js (engine.js, loaded on first open with three.js); the
// rules are game.js, the charts chart.js, the music audio.js.

// on-screen controls (shared/controls): the bottom of the screen is the five lanes, plus
// star power and pause buttons
const touchControls = [
  {
    id: "frets",
    label: "Fret lanes (tap)",
    kind: "zone",
    mirror: false,
    default: {
      portrait: (s) => fromPx(s, { left: 0, bottom: 0, width: s.width, height: Math.round(s.height * 0.34) }),
      landscape: (s) => fromPx(s, { left: 0, bottom: 0, width: s.width, height: Math.round(s.height * 0.46) }),
    },
  },
  { id: "star", label: "Star power", icon: <span className="shBolt">⚡</span>, shape: "round", className: "shTouchStar", default: (s) => fromPx(s, { right: 10, top: Math.round(s.height * 0.3), width: 62, height: 62 }) },
  { id: "pause", label: "Pause", icon: GLYPHS.pause, shape: "round", className: "shTouchPause", default: (s) => fromPx(s, { right: 10, top: 10, width: 40, height: 40 }) },
]

let calloutId = 0
const MENU_SCREENS = ["title", "songs", "practice", "options", "calibrate", "howto"]
const JUDGE_TEXT = { perfect: "Perfect", great: "Great", good: "Good" }

const RockMeter = ({ value }) => {
  const angle = -80 + value * 160
  return (
    <div className={`shMeter is-${zoneOf(value)}`} aria-label={`Rock meter ${Math.round(value * 100)}%`}>
      <svg viewBox="0 0 120 70" aria-hidden="true">
        <defs>
          <linearGradient id="shMeterRim" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#f4f4f8" />
            <stop offset="1" stopColor="#5d5d68" />
          </linearGradient>
        </defs>
        <path d="M8 62 A52 52 0 0 1 112 62" fill="none" stroke="url(#shMeterRim)" strokeWidth="14" />
        <path d="M12 62 A48 48 0 0 1 36.4 20.2" fill="none" stroke="#e8202c" strokeWidth="9" />
        <path d="M37.5 19.6 A48 48 0 0 1 82.5 19.6" fill="none" stroke="#ffcf1f" strokeWidth="9" />
        <path d="M83.6 20.2 A48 48 0 0 1 108 62" fill="none" stroke="#2bd94f" strokeWidth="9" />
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: "60px 62px", transition: "transform 0.18s ease-out" }}>
          <path d="M58 62 L60 18 L62 62 Z" fill="#fff" />
        </g>
        <circle cx="60" cy="62" r="6" fill="#222" stroke="#bbb" strokeWidth="2" />
      </svg>
      <span>Rock</span>
    </div>
  )
}

const Multiplier = ({ hud, pulse }) => {
  const notch = hud.baseMultiplier >= 4 ? 10 : hud.streak % 10
  return (
    <div className={`shMult m${hud.multiplier > 4 ? "s" : hud.multiplier} ${pulse ? "is-pulse" : ""}`} key={pulse}>
      <svg viewBox="0 0 80 80" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => {
          const a = ((i / 10) * 360 - 90) * (Math.PI / 180)
          return <circle key={i} cx={40 + Math.cos(a) * 33} cy={40 + Math.sin(a) * 33} r="4.2" className={i < notch ? "on" : ""} />
        })}
      </svg>
      <b>x{hud.multiplier}</b>
    </div>
  )
}

const StarMeter = ({ energy, active, ready }) => (
  <div className={`shStarMeter ${active ? "is-active" : ""} ${ready ? "is-ready" : ""}`} aria-label={`Star power ${Math.round(energy * 100)}%`}>
    <i style={{ height: `${energy * 100}%` }} />
    <span className="half" />
  </div>
)

const Shred = ({ onClose, mobile }) => {
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const navRef = useRef(null)
  const timers = useRef(new Set())
  const [phase, setPhase] = useState("loading") // loading | error | title | songs | practice | options | calibrate | howto | playing | paused | results | failed
  const [prefs, setPrefsState] = useState(loadPrefs)
  const [progress, setProgress] = useState(loadProgress)
  const [cal, setCalState] = useState(() => ({ ...CAL_DEFAULT, ...load(KEYS.calibration, {}) }))
  const [hud, setHud] = useState(null)
  const [callouts, setCallouts] = useState([])
  const [judge, setJudge] = useState(null)
  const [result, setResult] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [editing, setEditing] = useState(false)
  const [selectedId, setSelectedId] = useState(SONGS[0].id)
  const [optionsFrom, setOptionsFrom] = useState("title")
  const [multPulse, setMultPulse] = useState(0)
  const [loopInfo, setLoopInfo] = useState(null)
  const [titleSel, setTitleSel] = useState(0)
  const settings = useSettings()
  const touchVisible = useTouchControlsVisible()
  const controlsMenuItem = useTouchControlsMenuItem()
  const chatItem = useGameChatMenuItem("shred")
  const showPad = mobile || touchVisible
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const progressRef = useRef(progress)
  progressRef.current = progress
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const showPadRef = useRef(showPad)
  showPadRef.current = showPad

  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
  }
  const callout = (text, kind = "info", ms = 1500) => {
    const id = ++calloutId
    setCallouts((list) => [...list.slice(-2), { id, text, kind }])
    later(() => setCallouts((list) => list.filter((c) => c.id !== id)), ms)
  }

  const setPrefs = (patch) => {
    const next = { ...prefsRef.current, ...patch }
    setPrefsState(next)
    prefsRef.current = next
    save(KEYS.prefs, next)
    engineRef.current?.setPrefs(next)
    engineRef.current?.setVolume(masterGain())
  }
  const setCal = (next) => {
    setCalState(next)
    save(KEYS.calibration, next)
    engineRef.current?.setCalibration(next)
    callout("Calibration saved", "good")
  }
  const setUnlockAll = (on) => {
    const next = { ...progressRef.current, unlockAll: on }
    setProgress(next)
    save(KEYS.progress, next)
  }

  // the taskbar volume and mute
  useEffect(() => {
    engineRef.current?.setVolume(masterGain(settings))
  }, [settings])

  // ---------- the engine (three.js loads here, on first open) ----------
  useEffect(() => {
    let cancelled = false
    let engine = null
    import("./engine.js")
      .then(({ createEngine }) => {
        if (cancelled) return
        try {
          engine = createEngine({
            canvas: canvasRef.current,
            container: stageRef.current,
            prefs: prefsRef.current,
            calibration: cal,
            onStatus: (s) => {
              if (s === "playing" || s === "paused") setPhase(s)
            },
            onHud: setHud,
            onMenu: (a) => navRef.current?.(a),
            onEvent: handleEvent,
          })
        } catch (error) {
          console.error(error)
          setPhase("error")
          return
        }
        engineRef.current = engine
        engine.setVolume(masterGain())
        setPhase("title")
        stageRef.current?.focus({ preventScroll: true })
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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleEvent = (e) => {
    switch (e.type) {
      case "judge":
        setJudge({ id: ++calloutId, text: JUDGE_TEXT[e.judge], kind: e.judge })
        break
      case "multiplier":
        setMultPulse((n) => n + 1)
        break
      case "streak":
        callout(`${e.value} note streak!`, "streak", 1500)
        break
      case "starReady": {
        const k = prefsRef.current.keys.star[0]
        callout(showPadRef.current ? "Star power ready! Tap ⚡" : `Star power ready! Press ${keyName(k)}`, "star", 2200)
        break
      }
      case "starPhrase":
        callout("Star phrase!", "starSmall", 900)
        break
      case "starOn":
        callout("Star Power!", "starOn", 1600)
        break
      case "loop":
        setLoopInfo({ ...e.results, id: ++calloutId })
        callout(`Loop: ${e.results.accuracy}% hit`, "info", 1600)
        break
      case "results": {
        const r = e.results
        let newBest = false
        let unlockedTier = null
        if (!e.practice) {
          const before = progressRef.current
          const rec = record(before, e.song.id, e.difficulty, r)
          newBest = rec.newBest
          for (const tier of TIERS) {
            if (!tierUnlocked(before, tier, SONGS) && tierUnlocked(rec.progress, tier, SONGS)) unlockedTier = tier.name
          }
          setProgress(rec.progress)
          save(KEYS.progress, rec.progress)
          unlock("shred-encore")
          if (r.stars >= 5) unlock("shred-five")
          if (r.fullCombo) unlock("shred-fc")
          if (e.difficulty === "expert") unlock("shred-expert")
        }
        setResult({ ...e, newBest, unlockedTier })
        setPhase("results")
        break
      }
      case "failed":
        setResult(e)
        setPhase("failed")
        break
      default:
    }
  }

  // ---------- flow ----------
  const go = (next) => {
    engineRef.current?.sfx(next === "title" ? "back" : "select")
    if (next !== "songs" && next !== "practice") engineRef.current?.stopPreview()
    setPhase(next)
    stageRef.current?.focus({ preventScroll: true })
  }
  const playSong = (opts) => {
    const e = engineRef.current
    if (!e) return
    setResult(null)
    setHud(null)
    setCallouts([])
    setJudge(null)
    setLoopInfo(null)
    e.sfx("select")
    e.play({ ...opts, touch: showPadRef.current })
  }
  const resume = () => engineRef.current?.resume()
  const restart = () => {
    setResult(null)
    setCallouts([])
    setHud(null)
    engineRef.current?.restart()
  }
  const quitToSongs = () => {
    const practice = engineRef.current?.run?.practice
    engineRef.current?.quit()
    setResult(null)
    setHud(null)
    setCallouts([])
    go(practice ? "practice" : "songs")
  }
  const openOptions = (from) => {
    setOptionsFrom(from)
    go("options")
  }

  // the keyboard in menus: arrows, Enter/Space, Escape (fret keys in the song list too)
  const onKeyDown = (e) => {
    // form fields keep their keys (except Escape, which always goes back)
    if (e.key !== "Escape" && e.target.closest?.("select, input")) return
    const p = phaseRef.current
    if (p === "playing" || p === "loading" || p === "error") return
    if (p === "calibrate" && e.key !== "Escape") return
    const nav = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "ok", " ": "ok", Escape: "back", Backspace: "back" }[e.key]
    if (!nav) return
    if (p === "paused" && (e.key === "Escape" || e.key === "p" || e.key === "P")) {
      e.preventDefault()
      return resume()
    }
    if (navRef.current?.(nav)) {
      e.preventDefault()
      if (nav === "up" || nav === "down" || nav === "left" || nav === "right") engineRef.current?.sfx("move")
      return
    }
    if (nav === "back" && p !== "title" && MENU_SCREENS.includes(p)) {
      e.preventDefault()
      go(p === "options" && optionsFrom === "paused" ? "paused" : "title")
    }
  }

  const titleItems = [
    { label: "Career", note: "Play the set list", onSelect: () => go("songs") },
    { label: "Practice", note: "Slow it down, loop a part", onSelect: () => go("practice") },
    { label: "Calibrate Lag", onSelect: () => go("calibrate") },
    { label: "Options", onSelect: () => openOptions("title") },
    { label: "How to Play", onSelect: () => go("howto") },
  ]
  const pauseItems = [
    { label: "Resume", onSelect: resume },
    { label: "Restart", onSelect: restart },
    { label: "Options", onSelect: () => openOptions("paused") },
    { label: "Quit Song", onSelect: quitToSongs },
  ]
  const resultItems = [
    { label: "Continue", onSelect: quitToSongs },
    { label: "Play Again", onSelect: restart },
  ]
  const failedItems = [
    { label: "Retry", onSelect: restart },
    { label: "Practice It", onSelect: () => {
      const r = engineRef.current?.run
      engineRef.current?.quit()
      if (r) setSelectedId(r.song.id)
      go("practice")
    } },
    { label: "Quit", onSelect: quitToSongs },
  ]

  // touch controls
  const padPress = (action) => {
    const e = engineRef.current
    if (!e) return
    if (action === "pause") e.pause()
    if (action === "star") e.activateStar()
  }
  useEffect(() => {
    if (editing && engineRef.current?.status === "playing") engineRef.current.pause()
  }, [editing])
  // where the lanes meet the bottom of the screen, for the colored touch hints
  const [laneXs, setLaneXs] = useState([])
  useEffect(() => {
    if (!showPad || phase !== "playing") return
    const measure = () => {
      const xs = engineRef.current?.lanePositions() || []
      setLaneXs((old) => (old.length === xs.length && old.every((x, i) => Math.abs(x - xs[i]) < 1) ? old : xs))
    }
    measure()
    const t = setInterval(measure, 700)
    return () => clearInterval(t)
  }, [showPad, phase, prefs.lefty])
  const setEditingAndFocus = (value) => {
    setEditing(value)
    if (!value) stageRef.current?.focus({ preventScroll: true })
  }

  const inSong = phase === "playing" || phase === "paused" || phase === "results" || phase === "failed"
  const run = engineRef.current?.run
  const menus = [
    {
      label: "Game",
      items: [
        { label: "Set List", disabled: phase === "loading" || phase === "error", onClick: () => (inSong ? quitToSongs() : go("songs")) },
        { label: "Practice", disabled: phase === "loading" || phase === "error", onClick: () => (engineRef.current?.quit(), go("practice")) },
        { label: phase === "paused" ? "Resume (Esc)" : "Pause (Esc)", disabled: phase !== "playing" && phase !== "paused", onClick: () => (phase === "paused" ? resume() : engineRef.current?.pause()) },
        { label: "Restart Song", disabled: !inSong, onClick: restart },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Options",
      items: [
        { label: "Easy Strum", checked: prefs.easyStrum, onClick: () => setPrefs({ easyStrum: !prefs.easyStrum }) },
        { label: "No-Fail Mode", checked: prefs.noFail, onClick: () => setPrefs({ noFail: !prefs.noFail }) },
        { label: "Lefty Flip", checked: prefs.lefty, onClick: () => setPrefs({ lefty: !prefs.lefty }) },
        { label: "Crowd and Effects", checked: prefs.sfx, onClick: () => setPrefs({ sfx: !prefs.sfx }) },
        "-",
        { label: "More Options...", disabled: phase === "playing" || phase === "loading", onClick: () => openOptions(inSong ? "paused" : "title") },
        { label: "Calibrate Lag...", disabled: inSong || phase === "loading", onClick: () => go("calibrate") },
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
        { label: "How to Play", disabled: inSong, onClick: () => go("howto") },
        "-",
        { label: "About Shred 98...", onClick: () => setDialog("about") },
      ],
    },
  ]

  const back = (to = "title") => () => go(to)
  const songProps = {
    progress,
    prefs,
    setPrefs,
    navRef,
    selectedId,
    setSelectedId,
    onPlay: playSong,
    onBack: back("title"),
    onPreview: (song) => engineRef.current?.preview(song),
  }
  const totalMax = SONGS.length * 5

  return (
    <div className={mobile ? "shRoot is-mobile" : "shRoot"} onKeyDown={onKeyDown}>
      <MenuBar menus={menus} />
      <GameChat game="shred" title="Shred 98" />
      <div className="shStage" ref={stageRef} tabIndex={0} data-phase={phase} data-lefty={prefs.lefty ? "1" : undefined}>
        <canvas className="shCanvas" ref={canvasRef} aria-label="Shred 98 stage" />

        {phase === "loading" && <div className="shCenter shLoading">Tuning up...</div>}
        {phase === "error" && (
          <div className="shCenter">
            <div className="shPanel">
              <div className="shPanelHead">
                <h2>Can't start Shred 98</h2>
              </div>
              <p className="shHint">This game needs WebGL graphics, which this browser or device doesn't have available right now. Try another browser, or turn on hardware acceleration.</p>
            </div>
          </div>
        )}

        {phase === "title" && <TitleScreen items={titleItems} navRef={navRef} stars={totalStars(progress, SONGS)} maxStars={totalMax} sel={titleSel} setSel={setTitleSel} />}
        {phase === "songs" && <SongScreen mode="career" {...songProps} />}
        {phase === "practice" && <SongScreen mode="practice" {...songProps} />}
        {phase === "options" && (
          <div className="shCenter">
            <OptionsScreen prefs={prefs} setPrefs={setPrefs} navRef={navRef} unlockAll={progress.unlockAll} setUnlockAll={setUnlockAll} inGame={optionsFrom === "paused"} onBack={() => (optionsFrom === "paused" ? setPhase("paused") : go("title"))} />
          </div>
        )}
        {phase === "calibrate" && engineRef.current && (
          <div className="shCenter">
            <CalibrateScreen audio={engineRef.current.audio} cal={cal} setCal={setCal} navRef={navRef} onBack={back("title")} touch={showPad} />
          </div>
        )}
        {phase === "howto" && (
          <div className="shCenter">
            <HowToScreen navRef={navRef} onBack={back("title")} prefs={prefs} touch={showPad} />
          </div>
        )}
        {(phase === "songs" || phase === "practice") && <div className="shMenuDim" aria-hidden="true" />}

        {hud && inSong && (
          <div className="shHud" aria-live="off">
            <div className="shHudTop">
              <div className="shNow">
                <b>{run?.song.title}</b>
                <span>
                  {run?.song.artist} &middot; {DIFF_LABEL[run?.difficulty]}
                  {run?.practice ? ` · Practice ${Math.round((run.practice.rate || 1) * 100)}%${run.section ? ` · ${run.section.label}` : ""}` : ""}
                </span>
                <i className="shProgress">
                  <i style={{ width: `${hud.progress * 100}%` }} />
                </i>
              </div>
            </div>
            <div className="shHudLeft">
              <RockMeter value={hud.meter} />
              <div className="shHudRow">
                <StarMeter energy={hud.energy} active={hud.starActive} ready={hud.starReady} />
                <Multiplier hud={hud} pulse={multPulse} />
              </div>
            </div>
            <div className="shHudRight">
              <div className="shScore" data-testid="shred-hud-score">
                {fmtScore(hud.score)}
              </div>
              <div className="shStreak">
                <b>{hud.streak}</b> streak
              </div>
              {loopInfo && run?.practice && <div className="shLoopInfo">Last loop: {loopInfo.accuracy}%</div>}
            </div>
            {judge && phase === "playing" && (
              <div key={judge.id} className={`shJudge is-${judge.kind}`}>
                {judge.text}
              </div>
            )}
            <div className="shCallouts" aria-live="polite">
              {callouts.map((c) => (
                <div key={c.id} className={`shCallout is-${c.kind}`}>
                  {c.text}
                </div>
              ))}
            </div>
            {hud.starActive && <div className="shStarGlow" aria-hidden="true" />}
          </div>
        )}
        {!inSong && callouts.length > 0 && (
          <div className="shCallouts shCallouts--menu" aria-live="polite">
            {callouts.map((c) => (
              <div key={c.id} className={`shCallout is-${c.kind}`}>
                {c.text}
              </div>
            ))}
          </div>
        )}

        {phase === "paused" && !editing && <PauseScreen items={pauseItems} navRef={navRef} practice={!!run?.practice} />}
        {phase === "results" && result && <ResultsScreen data={result} items={resultItems} navRef={navRef} />}
        {phase === "failed" && result && <FailedScreen data={result} items={failedItems} navRef={navRef} />}

        {showPad && phase === "playing" && !editing && laneXs.length === 5 && (
          <div className="shLaneHints" aria-hidden="true">
            {LANE_CSS.map((c, i) => {
              const step = Math.abs(laneXs[4] - laneXs[0]) / 4
              return <i key={i} style={{ "--c": c, left: laneXs[i] - step * 0.45, width: step * 0.9 }} />
            })}
          </div>
        )}
        {showPad && phase !== "loading" && phase !== "error" && (
          <TouchControls
            game="shred"
            controls={touchControls}
            onPress={padPress}
            show={phase === "playing"}
            editing={editing}
            onEditingChange={setEditingAndFocus}
            gearStyle={{ right: 58, top: 13, width: 34, height: 34 }}
            gearClassName="shGear"
          />
        )}
      </div>

      {dialog === "about" && (
        <Dialog title="About Shred 98" onOk={() => setDialog(null)}>
          <div className="dialogText shAbout">
            <Logo small />
            <p>
              Six original songs, written for Shred 98 and played live by your browser's synthesizer: no recordings, no samples. The lead guitar is yours; miss a
              note and it cuts out.
            </p>
            <p>
              {SONGS.length} songs &middot; 4 difficulties &middot; career stars {totalStars(progress, SONGS)} / {totalMax}
            </p>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default Shred
