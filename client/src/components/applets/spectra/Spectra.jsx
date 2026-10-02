import React, { useEffect, useMemo, useRef, useState } from "react"
import TouchControls, { GLYPHS, fromPx, useTouchControlsVisible } from "../../shared/controls"
import { LOBBY, useAim } from "../aim/AimContext"
import { zoneName } from "./logic"
import "./Spectra.css"

// SPECTRA: React only draws the screens over the game (title, HUD, pause, game over).
// The game itself (three.js, ~600KB) is loaded on first open, from engine.js.

const BEST_KEY = "98ish.spectra.best"
const MUTED_KEY = "98ish.spectra.muted"
const RESTART_GUARD_MS = 450 // ignore restarts right after a crash (frantic tapping)

const read = (key, fallback) => {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : JSON.parse(v)
  } catch {
    return fallback
  }
}
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable: lasts for this visit
  }
}

const fmt = (n) => Math.floor(n).toLocaleString("en-US")

// On-screen controls (shared/controls: players can move and resize them). Dragging anywhere
// else still spins the ship.
const touchControls = (meterFull) => [
  { id: "left", label: "Spin left", icon: GLYPHS.left, shape: "round", className: "spPad", default: (size) => fromPx(size, { left: 16, bottom: 44, width: 64, height: 64 }) },
  { id: "right", label: "Spin right", icon: GLYPHS.right, shape: "round", className: "spPad", default: (size) => fromPx(size, { left: 92, bottom: 44, width: 64, height: 64 }) },
  {
    id: "overdrive",
    label: "Overdrive",
    icon: "\u26A1",
    shape: "round",
    className: meterFull ? "spBolt is-ready" : "spBolt",
    ariaDisabled: !meterFull,
    default: (size) => fromPx(size, { right: 18, bottom: 44, width: 64, height: 64 }),
  },
  { id: "pause", label: "Pause", icon: GLYPHS.pause, shape: "round", className: "spPad spPad--small", default: (size) => fromPx(size, { right: 10, top: 50, width: 32, height: 32 }) },
]

const Spectra = () => {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const timers = useRef(new Set())
  const overAt = useRef(0)
  const touch = useTouchControlsVisible()
  const [editing, setEditing] = useState(false)
  const aim = useAim()

  const [phase, setPhase] = useState("loading") // loading | error | title | playing | paused | over
  const [hud, setHud] = useState(null)
  const [result, setResult] = useState(null)
  const [pops, setPops] = useState([])
  const [banner, setBanner] = useState(null)
  const [muted, setMuted] = useState(() => read(MUTED_KEY, false))
  const [best, setBest] = useState(() => read(BEST_KEY, 0))
  const [bragged, setBragged] = useState(null)

  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
  }

  const pop = (text, kind) => {
    const id = Math.random()
    setPops((list) => [...list.slice(-4), { id, text, kind }])
    later(() => setPops((list) => list.filter((p) => p.id !== id)), 950)
  }

  useEffect(() => {
    let cancelled = false
    let engine = null
    import("./engine")
      .then(({ createEngine }) => {
        if (cancelled) return
        try {
          engine = createEngine({
            canvas: canvasRef.current,
            container: containerRef.current,
            best: read(BEST_KEY, 0),
            muted: read(MUTED_KEY, false),
            onStatus: (status) => {
              if (status === "playing" || status === "paused" || status === "title") setPhase(status)
            },
            onHud: setHud,
            onEvent: (e) => {
              switch (e.type) {
                case "graze":
                  pop("GRAZE +100", "graze")
                  break
                case "multiplier":
                  if (e.up) pop(`x${e.multiplier}`, "mult")
                  break
                case "smash":
                  pop("SMASH +200", "smash")
                  break
                case "overdrive":
                  pop("OVERDRIVE", "overdrive")
                  break
                case "zone":
                  setBanner({ zone: e.zone, name: zoneName(e.zone) })
                  later(() => setBanner(null), 2600)
                  break
                case "gameover":
                  overAt.current = performance.now()
                  setResult(e)
                  setBragged(null)
                  if (e.isBest) {
                    setBest(e.score)
                    write(BEST_KEY, e.score)
                  }
                  setPhase("over")
                  break
                case "muted":
                  setMuted(e.muted)
                  write(MUTED_KEY, e.muted)
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

  const start = () => {
    if (phase === "over" && performance.now() - overAt.current < RESTART_GUARD_MS) return
    setHud(null)
    setPops([])
    setBanner(null)
    engineRef.current?.startGame()
  }

  const brag = async () => {
    if (!result || aim?.status !== "online") return
    setBragged("Posting...")
    const joined = await aim.joinRoom(LOBBY)
    if (!joined.ok) return setBragged(joined.error)
    const said = await aim.say(
      LOBBY,
      `I just scored ${fmt(result.score)} in SPECTRA: ${fmt(result.distance)} m, reached ${result.zone}, x${result.maxMultiplier} multiplier. Beat that!`
    )
    setBragged(said.ok ? "Posted to the 98ish Lobby!" : said.error || "Couldn't post.")
  }

  const meterFull = hud && hud.meter >= 1 && hud.overdrive <= 0
  const controls = useMemo(() => touchControls(!!meterFull), [!!meterFull])

  // customizing the controls pauses the game
  useEffect(() => {
    if (editing && engineRef.current?.status === "playing") engineRef.current.pause()
  }, [editing])
  const setEditingAndFocus = (value) => {
    setEditing(value)
    if (!value) containerRef.current?.focus({ preventScroll: true })
  }
  const padPress = (action) => {
    const engine = engineRef.current
    if (!engine) return
    if (action === "left") engine.hold("ArrowLeft", true)
    else if (action === "right") engine.hold("ArrowRight", true)
    else if (action === "overdrive") engine.overdrive()
    else if (action === "pause") engine.pause()
  }
  const padRelease = (action) => {
    if (action === "left") engineRef.current?.hold("ArrowLeft", false)
    else if (action === "right") engineRef.current?.hold("ArrowRight", false)
  }

  return (
    <div className="spRoot" ref={containerRef} tabIndex={0} data-phase={phase}>
      <canvas className="spCanvas" ref={canvasRef} />

      {phase === "loading" && <div className="spCenter spLoading">Loading SPECTRA...</div>}

      {phase === "error" && (
        <div className="spCenter spPanel">
          <h2>Can't start SPECTRA</h2>
          <p>This game needs WebGL graphics, which this browser or device doesn't have available right now.</p>
        </div>
      )}

      {phase === "title" && (
        <div className="spCenter spTitle">
          <h1 className="spLogo">SPECTRA</h1>
          <p className="spTagline">steer the light. slip the gates. ride the color.</p>
          <button type="button" className="spPlay" onClick={start} autoFocus>
            {touch ? "Tap to play" : "Play (Space)"}
          </button>
          <div className="spHow">
            {touch ? (
              <>
                <b>Drag</b> (or hold the arrows) to spin around the tunnel &middot; fly through the <b>gaps</b>
                <br />
                Grab <b>shards</b> for a multiplier &middot; tap <b>&#9889;</b> for Overdrive
              </>
            ) : (
              <>
                <b>&larr; &rarr;</b> / <b>A D</b> or drag to spin &middot; fly through the <b>gaps</b>
                <br />
                Grab <b>shards</b> for a multiplier &middot; <b>Space</b> for Overdrive &middot; <b>P</b> pause &middot; <b>M</b> mute
              </>
            )}
          </div>
          {best > 0 && <div className="spBest">Best: {fmt(best)}</div>}
          {touch && (
            <button type="button" className="spBrag" onClick={() => setEditing(true)}>
              Customize controls
            </button>
          )}
          <p className="spWarning">Contains flashing colors and fast motion.</p>
        </div>
      )}

      {(phase === "playing" || phase === "paused") && hud && (
        <div className="spHud" aria-live="off">
          <div className="spHudLeft">
            <div className="spScore">{fmt(hud.score)}</div>
            <div className={`spMult spMult--${hud.multiplier}`}>x{hud.multiplier}</div>
          </div>
          <div className="spHudRight">
            <div className="spDistance">{fmt(hud.distance)} m</div>
            <div className="spZone">{hud.zoneName}</div>
          </div>
          <div className="spMeter" aria-label="Overdrive meter">
            <div className={hud.overdrive > 0 ? "spMeterFill is-active" : meterFull ? "spMeterFill is-full" : "spMeterFill"} style={{ width: `${(hud.overdrive > 0 ? hud.overdrive / 4 : hud.meter) * 100}%` }} />
            <span>{hud.overdrive > 0 ? "OVERDRIVE" : meterFull ? (touch ? "OVERDRIVE READY" : "OVERDRIVE READY: SPACE") : "OVERDRIVE"}</span>
          </div>
        </div>
      )}

      {phase === "playing" && (
        <div className="spPops" aria-hidden="true">
          {pops.map((p) => (
            <div key={p.id} className={`spPop spPop--${p.kind}`}>
              {p.text}
            </div>
          ))}
        </div>
      )}

      {phase === "playing" && banner !== null && (
        <div className="spBanner" aria-live="polite">
          <div className="spBannerZone">ZONE {banner.zone + 1}</div>
          <div className="spBannerName">{banner.name}</div>
        </div>
      )}

      {touch && phase !== "loading" && phase !== "error" && (
        // Buttons never take focus and are never truly disabled: a focused button that
        // becomes disabled drops focus, which the game reads as "clicked away" and pauses
        <TouchControls
          game="spectra"
          controls={controls}
          onPress={padPress}
          onRelease={padRelease}
          show={phase === "playing"}
          editing={editing}
          onEditingChange={setEditingAndFocus}
          gearStyle={{ top: 90, right: 10, width: 32, height: 32 }}
          gearClassName="spGear"
        />
      )}

      {phase === "paused" && (
        <div className="spCenter spPanel">
          <h2>Paused</h2>
          <button type="button" className="spPlay" onClick={() => engineRef.current?.resume()} autoFocus>
            Resume
          </button>
          {!touch && <p className="spHint">P or Esc to resume</p>}
          {touch && (
            <button type="button" className="spBrag" onClick={() => setEditing(true)}>
              Customize controls
            </button>
          )}
        </div>
      )}

      {phase === "over" && result && (
        <div className="spCenter spPanel spOver">
          <h2 className="spLost">SIGNAL LOST</h2>
          {result.isBest && <div className="spNewBest">NEW BEST!</div>}
          <div className="spFinal">{fmt(result.score)}</div>
          <div className="spStats">
            <span>{fmt(result.distance)} m</span>
            <span>{result.zone}</span>
            <span>{result.shards} shards</span>
            <span>{result.grazes} grazes</span>
            <span>x{result.maxMultiplier} max</span>
          </div>
          <div className="spBest">Best: {fmt(best)}</div>
          <button type="button" className="spPlay" onClick={start} autoFocus>
            {touch ? "Play again" : "Play again (Space)"}
          </button>
          {aim?.status === "online" && (
            <button type="button" className="spBrag" onClick={brag} disabled={!!bragged}>
              {bragged || "Brag in the 98ish Lobby"}
            </button>
          )}
        </div>
      )}

      {phase !== "loading" && phase !== "error" && (
        // no focus: a focused button would swallow Space (overdrive) and toggle mute instead
        <button
          type="button"
          tabIndex={-1}
          onPointerDown={(e) => e.preventDefault()}
          className="spMute"
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={() => engineRef.current?.setMuted(!muted)}
        >
          {muted ? "\u{1F507}" : "\u{1F50A}"}
        </button>
      )}
    </div>
  )
}

export default Spectra
