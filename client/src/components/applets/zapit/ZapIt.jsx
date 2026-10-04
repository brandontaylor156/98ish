import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import GameStart from "../../shared/GameStart"
import { Check, HowToDialog, PausedPanel, QuickGameRoot, ScoresDialog, TitleScreen, useAutoPause, useGameLoop } from "../../shared/quickgame"
import { unlock } from "../../../utils/achievements"
import { helpItem } from "../../../utils/help"
import { createScores } from "../../../utils/gameKit"
import { createSynth, midi } from "../../../utils/gameSynth"
import { getSettings, masterGain } from "../../../utils/settings"
import * as Z from "./gestures"
import "./ZapIt.css"

// Zap It!: do what it calls before the next beat. Tap it, Swipe it, Twist it (two fingers, or
// circle one finger / the mouse), Pull it (drag down), Flick it (flick up), and Shake it where
// the device's motion sensor works (Android at once; iPhone after an "Allow motion" tap).
// Each call is spoken (if the device has a voice), has its own sound and a big picture. The
// beat speeds up every 5 right. Party mode passes the phone round. Gestures: gestures.js.

const store = createScores("98ish.zapit", { defaults: { sound: true, voice: true, players: 3 } })
const KEY_CMD = { " ": "tap", Enter: "tap", ArrowLeft: "swipe", ArrowRight: "swipe", ArrowDown: "pull", ArrowUp: "flick", t: "twist", T: "twist", s: "shake", S: "shake" }

// ---- what each call looks like ----
const ICONS = {
  tap: (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="30" fill="#ffd400" stroke="#000" strokeWidth="4" />
      <circle cx="50" cy="50" r="42" fill="none" stroke="#000" strokeWidth="3" strokeDasharray="6 6" />
      <path d="M44 30 v26 l-6 -5 l-4 4 l12 14 h14 l4 -18 l-10 -3 v-18 z" fill="#fff" stroke="#000" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  ),
  swipe: (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path d="M8 50 h70" stroke="#000" strokeWidth="10" strokeLinecap="round" />
      <path d="M8 50 h70" stroke="#3ad0ff" strokeWidth="5" strokeLinecap="round" />
      <path d="M66 32 l22 18 l-22 18" fill="none" stroke="#000" strokeWidth="8" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M34 32 l-22 18 l22 18" fill="none" stroke="#000" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" opacity="0.4" />
    </svg>
  ),
  twist: (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path d="M50 14 a36 36 0 1 1 -33 22" fill="none" stroke="#000" strokeWidth="10" strokeLinecap="round" />
      <path d="M50 14 a36 36 0 1 1 -33 22" fill="none" stroke="#b060ff" strokeWidth="5" strokeLinecap="round" />
      <path d="M6 32 l12 6 l6 -13" fill="none" stroke="#000" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="38" cy="50" r="7" fill="#fff" stroke="#000" strokeWidth="3" />
      <circle cx="62" cy="50" r="7" fill="#fff" stroke="#000" strokeWidth="3" />
    </svg>
  ),
  pull: (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path d="M50 8 v62" stroke="#000" strokeWidth="10" strokeLinecap="round" />
      <path d="M50 8 v62" stroke="#ff8a00" strokeWidth="5" strokeLinecap="round" />
      <path d="M30 60 l20 26 l20 -26" fill="none" stroke="#000" strokeWidth="8" strokeLinejoin="round" strokeLinecap="round" />
      <rect x="36" y="4" width="28" height="12" rx="6" fill="#fff" stroke="#000" strokeWidth="3" />
    </svg>
  ),
  flick: (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path d="M50 90 v-58" stroke="#000" strokeWidth="10" strokeLinecap="round" />
      <path d="M50 90 v-58" stroke="#20d060" strokeWidth="5" strokeLinecap="round" />
      <path d="M30 40 l20 -26 l20 26" fill="none" stroke="#000" strokeWidth="8" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M22 70 l-10 -6 M78 70 l10 -6 M24 84 l-12 0 M76 84 l12 0" stroke="#000" strokeWidth="4" strokeLinecap="round" />
    </svg>
  ),
  shake: (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <rect x="32" y="18" width="36" height="64" rx="6" fill="#c0c0c0" stroke="#000" strokeWidth="4" transform="rotate(-12 50 50)" />
      <rect x="38" y="26" width="24" height="40" fill="#008080" transform="rotate(-12 50 50)" />
      <path d="M14 30 q-6 20 0 40 M86 30 q6 20 0 40 M22 36 q-4 14 0 28 M78 36 q4 14 0 28" fill="none" stroke="#000" strokeWidth="4" strokeLinecap="round" />
    </svg>
  ),
}
const COLORS = { tap: "#ffd400", swipe: "#3ad0ff", twist: "#b060ff", pull: "#ff8a00", flick: "#20d060", shake: "#ff4a8a" }

const createSounds = () => {
  const s = createSynth({ gain: 0.6 })
  return {
    setEnabled: s.setEnabled,
    beat: (accent) => s.play(({ tone, noise }) => (tone(accent ? 110 : 80, { len: 0.12, type: "sine", vol: accent ? 0.4 : 0.25, to: 45 }), noise({ len: 0.03, vol: 0.12, freq: 4000, type: "highpass" }))),
    call: (cmd) =>
      s.play(({ tone, noise }) => {
        if (cmd === "tap") (tone(200, { len: 0.12, type: "square", vol: 0.12, to: 90 }), noise({ len: 0.05, vol: 0.3, freq: 1600, type: "bandpass" }))
        else if (cmd === "swipe") noise({ len: 0.35, vol: 0.35, freq: 400, to: 5000, type: "bandpass", q: 2 })
        else if (cmd === "twist") for (let i = 0; i < 6; i++) noise({ at: i * 0.05, len: 0.03, vol: 0.35, freq: 2500, type: "bandpass", q: 4 })
        else if (cmd === "pull") tone(1400, { len: 0.45, type: "sine", vol: 0.15, to: 300 })
        else if (cmd === "flick") tone(300, { len: 0.25, type: "triangle", vol: 0.18, to: 1600 })
        else if (cmd === "shake") for (let i = 0; i < 4; i++) noise({ at: i * 0.07, len: 0.05, vol: 0.3, freq: 6000, type: "highpass" })
      }),
    right: (n) => s.play(({ tone }) => tone(midi(72 + (n % 12)), { len: 0.08, type: "square", vol: 0.07 })),
    wrong: () => s.play(({ tone }) => (tone(160, { len: 0.5, type: "sawtooth", vol: 0.15, to: 60 }), tone(150, { at: 0.05, len: 0.5, type: "square", vol: 0.08, to: 55 }))),
    best: () => s.play(({ tone }) => [60, 64, 67, 72, 67, 72].forEach((m, i) => tone(midi(m), { at: i * 0.1, len: i === 5 ? 0.5 : 0.14, type: "square", vol: 0.09 }))),
  }
}

// the calls, spoken (when the device has a voice and sound is on)
const speak = (text, on) => {
  try {
    if (!on || !("speechSynthesis" in window) || !getSettings().systemSounds || !masterGain()) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.35
    u.pitch = 1.15
    u.volume = Math.min(1, Math.sqrt(masterGain()))
    window.speechSynthesis.speak(u)
  } catch {
    // no voice: the sound and the picture are enough
  }
}

// ---- motion (Shake it) ----
const needsMotionPermission = () => typeof window !== "undefined" && typeof window.DeviceMotionEvent?.requestPermission === "function"

const ZapIt = ({ mobile = false, paused = false, onClose }) => {
  const chatItem = useGameChatMenuItem("zapit")
  const sounds = useMemo(() => createSounds(), [])
  const [data, setData] = useState(store.load)
  const prefs = data.prefs
  const [screen, setScreen] = useState("title") // title | play | pass | party-over
  const gameRef = useRef(null) // { s (gestures.js round), left (ms), beat (ms), beatT, beats }
  const [, setFrame] = useState(0)
  const [hold, setHold] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [last, setLast] = useState(null)
  const [party, setParty] = useState(null) // { players: [{ name, score }], turn }
  const [motion, setMotion] = useState(needsMotionPermission() ? "ask" : "unknown") // ask | unknown | on | denied
  const [feedback, setFeedback] = useState(null)
  const trace = useRef({ pointers: {}, down: 0 })
  const shaker = useRef(Z.shakeDetector())
  const rootRef = useRef(null)
  const g = gameRef.current
  const redraw = () => setFrame((f) => (f + 1) % 1e9)

  useEffect(() => {
    sounds.setEnabled(prefs.sound)
  }, [prefs.sound])
  const setPref = (patch) => setData(store.setPrefs(patch))
  useEffect(() => () => window.speechSynthesis?.cancel?.(), [])

  // Shake: listen for motion; the first real reading turns Shake it on (Android, no prompt)
  useEffect(() => {
    if (motion === "ask" || motion === "denied" || typeof window === "undefined" || !("DeviceMotionEvent" in window)) return
    const onMotion = (e) => {
      const a = e.acceleration?.x != null ? e.acceleration : e.accelerationIncludingGravity
      if (!a || a.x == null) return
      if (motion !== "on") setMotion("on")
      if (shaker.current.feed({ x: a.x, y: a.y, z: a.z, t: performance.now(), gravity: a === e.accelerationIncludingGravity })) did("shake")
    }
    window.addEventListener("devicemotion", onMotion)
    return () => window.removeEventListener("devicemotion", onMotion)
  })
  // iPhone: motion only after asking, from a tap
  const allowMotion = () => {
    try {
      window.DeviceMotionEvent.requestPermission().then(
        (r) => setMotion(r === "granted" ? "unknown" : "denied"),
        () => setMotion("denied"),
      )
    } catch {
      setMotion("denied")
    }
  }

  const callOut = (cmd) => {
    sounds.call(cmd)
    speak(Z.LABELS[cmd], prefs.voice)
  }

  const begin = () => {
    const s = Z.newRound({ shake: motion === "on" })
    const beat = Z.beatFor(0)
    gameRef.current = { s, left: beat + 900, beat: beat + 900, beatT: 0, ticks: 0 }
    shaker.current.reset()
    setHold(false)
    setFeedback(null)
    setScreen("play")
    redraw()
    setTimeout(() => callOut(s.command), 120)
    setTimeout(() => rootRef.current?.focus({ preventScroll: true }), 0)
  }
  const startSolo = () => {
    setParty(null)
    begin()
  }
  const startParty = (n = prefs.players) => {
    setPref({ players: n })
    setParty({ players: Array.from({ length: n }, (_, i) => ({ name: `Player ${i + 1}`, score: null })), turn: 0 })
    setScreen("pass")
  }
  const toTitle = () => {
    gameRef.current = null
    setParty(null)
    setHold(false)
    setScreen("title")
    window.speechSynthesis?.cancel?.()
  }

  const end = (game, why) => {
    sounds.wrong()
    speak(why === "late" ? "Too slow!" : "Oops!", prefs.voice)
    const score = game.s.score
    game.over = { why, score }
    if (score >= 25) unlock("zapit-25")
    if (score >= 50) unlock("zapit-50")
    if (party) {
      const players = party.players.map((p, i) => (i === party.turn ? { ...p, score } : p))
      setParty({ ...party, players })
    } else {
      const rec = store.record("solo", { score, note: `${score} zaps` })
      setData(rec.data)
      setLast({ score, best: rec.best })
      if (rec.best && score > 0) setTimeout(() => sounds.best(), 600)
    }
    redraw()
  }

  // the player did something
  const did = (cmd) => {
    const game = gameRef.current
    if (!game || game.over || hold || screen !== "play") return
    const r = Z.act(game.s, cmd)
    if (!r.right) {
      game.s = r.state
      setFeedback({ cmd, ok: false, n: Date.now() })
      return end(game, `wrong:${cmd}`)
    }
    game.s = r.state
    const beat = Z.beatFor(r.state.score)
    game.left = beat
    game.beat = beat
    game.beatT = 0
    game.ticks = 0
    sounds.right(r.state.score)
    setFeedback({ cmd, ok: true, n: Date.now() })
    setTimeout(() => callOut(r.state.command), 90)
    redraw()
  }

  const running = screen === "play" && !!g && !g.over && !hold && !dialog
  useAutoPause(paused, () => gameRef.current && !gameRef.current.over && screen === "play" && setHold(true))
  useGameLoop((dt) => {
    const game = gameRef.current
    if (!game || game.over) return
    game.left -= dt * 1000
    // the beat: four ticks per window, the first one louder
    const quarter = game.beat / 4
    const ticks = Math.floor((game.beat - game.left) / quarter)
    if (ticks > game.ticks && ticks < 4) {
      game.ticks = ticks
      sounds.beat(false)
    }
    if (game.left <= 0) {
      game.s = Z.timeout(game.s)
      return end(game, "late")
    }
    redraw()
  }, running)

  // ---- gestures on the pad ----
  const onDown = (e) => {
    if (!running) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const t = trace.current
    if (t.down === 0) t.pointers = {}
    t.down++
    t.pointers[e.pointerId] = [{ x: e.clientX, y: e.clientY, t: performance.now() }]
  }
  const onMove = (e) => {
    const list = trace.current.pointers[e.pointerId]
    if (!list || !trace.current.down) return
    list.push({ x: e.clientX, y: e.clientY, t: performance.now() })
    if (list.length > 200) list.splice(1, 1)
  }
  const onUp = (e) => {
    const t = trace.current
    const list = t.pointers[e.pointerId]
    if (!list) return
    list.push({ x: e.clientX, y: e.clientY, t: performance.now() })
    t.down = Math.max(0, t.down - 1)
    if (t.down > 0) return
    const cmd = Z.classify(t)
    t.pointers = {}
    if (cmd) did(cmd)
  }

  const onKeyDown = (e) => {
    if (e.target.closest?.("input, select, textarea, .menuBar")) return
    if (screen !== "play" || !gameRef.current) return
    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      e.preventDefault()
      if (!gameRef.current.over) setHold((h) => !h)
      return
    }
    const cmd = KEY_CMD[e.key]
    if (!cmd || e.repeat || !running) return
    e.preventDefault()
    if (cmd === "shake" && !gameRef.current.s.shake) return
    did(cmd)
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__zapit = { state: () => gameRef.current, did, classify: Z.classify }
    return () => delete window.__zapit
  })

  // party: the next player, or the end
  const nextTurn = () => {
    const next = party.turn + 1
    if (next >= party.players.length) {
      setScreen("party-over")
      if (party.players.length >= 3) unlock("zapit-party")
      const top = Math.max(...party.players.map((p) => p.score ?? 0))
      store.record("party", { score: top, note: `${party.players.length} players` })
      setData(store.load())
      return
    }
    setParty({ ...party, turn: next })
    gameRef.current = null
    setScreen("pass")
  }

  const menus = [
    {
      label: "Game",
      items: [
        { label: "Solo", onClick: startSolo },
        { label: "Party (pass the phone)...", onClick: () => startParty() },
        "-",
        { label: "High Scores...", onClick: () => setDialog("scores") },
        { label: "Title Screen", onClick: toTitle },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Options",
      items: [
        { label: "Sound", checked: prefs.sound, onClick: () => setPref({ sound: !prefs.sound }) },
        { label: "Spoken Calls", checked: prefs.voice, onClick: () => setPref({ voice: !prefs.voice }) },
        { label: motion === "on" ? "Shake It: on" : "Allow Motion (Shake it)", disabled: motion !== "ask", onClick: allowMotion },
        chatItem,
      ],
    },
    { label: "Help", items: [helpItem({ program: "Zap It!" }), "-", { label: "How to Play...", onClick: () => setDialog("howto") }] },
  ]

  const motionNote = motion === "on" ? "Shake it: on (this device has a motion sensor)" : motion === "ask" ? "Shake it needs your OK on this device" : motion === "denied" ? "Shake it is off (motion not allowed)" : "Shake it comes in on phones with a motion sensor"
  const title = (
    <TitleScreen>
      <GameStart
        id="zapit"
        title={
          <div className="qgLogo">
            <div className="zpLogo">{ICONS.tap}</div>
            <div className="qgLogoText zpLogoText">Zap It!</div>
            <div className="qgTagline">Tap it! Swipe it! Twist it! Pull it! Flick it!</div>
          </div>
        }
        play={{ label: last ? "Play again" : "Play", sub: `Solo · Best: ${store.best(data, "solo")} zaps`, onClick: startSolo, autoFocus: true, "data-play": true }}
        modes={[
          { key: "party", label: "Party", sub: `Pass the phone · ${prefs.players} players`, onClick: () => startParty(), "data-mode": "party" },
          { key: "scores", label: "High Scores...", sub: "Solo and party bests", onClick: () => setDialog("scores") },
        ]}
        optionsSummary={`${motionNote} · Calls ${prefs.voice ? "spoken" : "not spoken"}`}
        options={
          <>
            {motion === "ask" && (
              <button type="button" onClick={allowMotion} data-allow-motion>
                Allow motion (for Shake it)
              </button>
            )}
            <span className="zpNote">{motionNote}</span>
            <Check id="zp-opt1" checked={prefs.voice} onChange={() => setPref({ voice: !prefs.voice })}>
              Speak the calls
            </Check>
            <Check id="zp-opt2" checked={prefs.sound} onChange={() => setPref({ sound: !prefs.sound })}>
              Sound
            </Check>
            <label className="qgOptionRow">
              Party players:
              <select value={prefs.players} onChange={(e) => setPref({ players: Number(e.target.value) })}>
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      >
        {last && (
          <fieldset className="qgResult">
            <legend>Last game</legend>
            <b>{last.score}</b> zaps{last.best && <span className="qgNewBest"> New best!</span>}
          </fieldset>
        )}
      </GameStart>
    </TitleScreen>
  )

  let body = title
  if (screen === "pass" && party) {
    const p = party.players[party.turn]
    body = (
      <div className="qgStage zpStage">
        <div className="qgPanel window zpPass">
          <div className="title-bar">
            <div className="title-bar-text">Party: turn {party.turn + 1} of {party.players.length}</div>
          </div>
          <div className="window-body qgPanelBody">
            <p>Pass the {mobile ? "phone" : "keyboard"} to</p>
            <p className="qgFinal">{p.name}</p>
            <div className="qgPanelButtons">
              <button type="button" className="qgBig" autoFocus onClick={begin} data-ready>
                I'm ready!
              </button>
              <button type="button" onClick={toTitle}>
                Stop the party
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  } else if (screen === "party-over" && party) {
    const ranked = [...party.players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    body = (
      <div className="qgStage zpStage">
        <div className="qgPanel window zpPass" data-party-over>
          <div className="title-bar">
            <div className="title-bar-text">Party results</div>
          </div>
          <div className="window-body qgPanelBody">
            <p className="qgFinal">{ranked[0].name} wins!</p>
            <ol className="zpRank">
              {ranked.map((p) => (
                <li key={p.name}>
                  {p.name}: <b>{p.score ?? 0}</b>
                </li>
              ))}
            </ol>
            <div className="qgPanelButtons">
              <button type="button" className="qgBig" autoFocus onClick={() => startParty(party.players.length)}>
                Play Again
              </button>
              <button type="button" onClick={toTitle}>
                Title Screen
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  } else if (screen === "play" && g) {
    const cmd = g.s.command
    const frac = Math.max(0, g.left / g.beat)
    body = (
      <div className="zpPlay">
        <div className="qgHud">
          <div className="qgCounter">
            <span className="qgLabel">Zaps</span>
            <span className="qgNum" data-score={g.s.score}>
              {g.s.score}
            </span>
          </div>
          <div className="zpWho">{party ? party.players[party.turn].name : `Beat ${(Z.beatFor(g.s.score) / 1000).toFixed(2)} s`}</div>
          <div className="qgCounter">
            <span className="qgLabel">Best</span>
            <span className="qgNum">{party ? "-" : store.best(data, "solo")}</span>
          </div>
          <button type="button" className="qgPauseBtn" onClick={() => setHold(true)} aria-label="Pause" title="Pause (P)">
            ||
          </button>
        </div>
        <div
          className={`qgStage zpStage zpPad${feedback ? (feedback.ok ? " is-right" : " is-wrong") : ""}`}
          key={feedback?.n}
          style={{ "--zp": COLORS[cmd] }}
          data-command={cmd}
          data-touch-surface
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {!g.over && !hold && (
            <div className="zpCall" key={`${g.s.score}-${cmd}`}>
              <svg className="zpRing" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="46" fill="none" stroke="rgb(0 0 0 / 0.25)" strokeWidth="6" />
                <circle cx="50" cy="50" r="46" fill="none" stroke="#000" strokeWidth="6" strokeDasharray={`${frac * 289} 289`} transform="rotate(-90 50 50)" />
              </svg>
              <div className="zpIcon">{ICONS[cmd]}</div>
              <div className="zpLabel">{Z.LABELS[cmd]}</div>
              {!mobile && <div className="zpKey">{Z.KEYS[cmd]}</div>}
            </div>
          )}
          {hold && !g.over && <PausedPanel onResume={() => (setHold(false), rootRef.current?.focus({ preventScroll: true }))} onQuit={toTitle} />}
          {g.over && (
            <div className="qgOverlay" data-over>
              <div className="qgPanel window">
                <div className="title-bar">
                  <div className="title-bar-text">{g.over.why === "late" ? "Too slow!" : "Wrong move!"}</div>
                </div>
                <div className="window-body qgPanelBody">
                  <p>
                    It said <b>{Z.LABELS[cmd]}</b>
                    {g.over.why.startsWith("wrong:") ? ` (you did ${Z.LABELS[g.over.why.slice(6)].replace("!", "")})` : ""}
                  </p>
                  <p className="qgFinal">{g.over.score} zaps</p>
                  {!party && last?.best && <p className="qgNewBest">New best!</p>}
                  <div className="qgPanelButtons">
                    {party ? (
                      <button type="button" className="qgBig" autoFocus onClick={nextTurn} data-next>
                        {party.turn + 1 < party.players.length ? `Next: ${party.players[party.turn + 1].name}` : "See who won"}
                      </button>
                    ) : (
                      <button type="button" className="qgBig" autoFocus onClick={begin} data-again>
                        Play Again
                      </button>
                    )}
                    <button type="button" onClick={toTitle}>
                      Title Screen
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <QuickGameRoot ref={rootRef} className="zpRoot" mobile={mobile} onKeyDown={onKeyDown} data-screen={screen}>
      <MenuBar menus={menus} />
      <GameChat game="zapit" title="Zap It!" />
      {body}
      {dialog === "scores" && (
        <ScoresDialog
          title="Zap It! High Scores"
          unit=" zaps"
          onClose={() => setDialog(null)}
          tables={[
            { label: "Solo", rows: data.scores.solo },
            { label: "Party (the winner's score)", rows: data.scores.party },
          ]}
        />
      )}
      {dialog === "howto" && (
        <HowToDialog title="How to Play Zap It!" onClose={() => setDialog(null)}>
          <p>Do what it calls before the ring runs out. Every 5 right, the beat gets quicker. One wrong move (or too slow) and it's over.</p>
          <ul>
            <li>
              <b>Tap it</b>: tap the pad. <b>Swipe it</b>: swipe sideways. <b>Pull it</b>: drag down. <b>Flick it</b>: flick up.
            </li>
            <li>
              <b>Twist it</b>: two fingers turning, like a knob (or draw a circle with one finger or the mouse).
            </li>
            <li>
              <b>Shake it</b>: shake the phone. Android phones have it right away; on iPhone, tap Allow motion in Options first. Computers don't get Shake it.
            </li>
            <li>Keys: Space = Tap, Left/Right = Swipe, Down = Pull, Up = Flick, T = Twist. P pauses.</li>
          </ul>
          <p>
            <b>Party</b>: pass the phone. Everyone has one go; the most zaps wins.
          </p>
        </HowToDialog>
      )}
    </QuickGameRoot>
  )
}

export default ZapIt
