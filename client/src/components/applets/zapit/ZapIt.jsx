import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import GameStart from "../../shared/GameStart"
import { Check, HowToDialog, QuickGameRoot, ScoresDialog, TitleScreen, useAutoPause, useGameLoop } from "../../shared/quickgame"
import { Hit, PixelButton, PixelLed, PixelP, PixelScores, PixelText, RetroBanner, RetroPanel, RetroPaused, RetroStage, Sr, useRetroScreen } from "../../shared/retro"
import { unlock } from "../../../utils/achievements"
import { helpItem } from "../../../utils/help"
import { createScores } from "../../../utils/gameKit"
import { getSettings, masterGain, reducedMotion } from "../../../utils/settings"
import * as Z from "./gestures"
import { drawBanner, drawZap, layout, minSize, pal } from "./pixels"
import { createSounds } from "./sounds"
import "./ZapIt.css"

// Zap It!: do what it calls before the next beat. Tap it, Swipe it, Twist it (two fingers, or
// circle one finger / the mouse), Pull it (drag down), Flick it (flick up), and Shake it where
// the device's motion sensor works (Android at once; iPhone after an "Allow motion" tap).
// Each call is spoken (if the device has a voice), has its own sound, and the ZAP-TRON (an
// original pixel-art toy, pixels.js) moves the part to use. The beat speeds up every 5 right.
// Party mode passes the phone round. Gestures: gestures.js.

const store = createScores("98ish.zapit", { defaults: { sound: true, voice: true, players: 3 } })
const KEY_CMD = { " ": "tap", Enter: "tap", ArrowLeft: "swipe", ArrowRight: "swipe", ArrowDown: "pull", ArrowUp: "flick", t: "twist", T: "twist", s: "shake", S: "shake" }

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

// the play screen: the toy picture is the gesture pad. live() gives what changes every frame
// (the timer ring, the beat lights); the pad paints itself, so React renders only on events.
const Pad = ({ view, live, animate = true, onDown, onMove, onUp, onPause, children }) => {
  const viewRef = useRef(view)
  viewRef.current = view
  const liveRef = useRef(live)
  liveRef.current = live
  const pauseDown = useRef(false)
  const Lref = useRef(null)
  const scr = useRetroScreen({
    layout: minSize,
    palette: pal,
    render: (b, fit) => {
      const L = Lref.current
      if (!L || L.W !== fit.w || L.H !== fit.h) return
      const now = performance.now()
      drawZap(b, L, { ...viewRef.current, ...(liveRef.current?.() || {}), t: now / 1000, now, reduced: reducedMotion(), pressed: pauseDown.current ? "pause" : null })
    },
  })
  const L = useMemo(() => (scr.fit ? layout(scr.fit.w, scr.fit.h) : null), [scr.fit])
  Lref.current = L
  useEffect(() => scr.paint())
  useGameLoop(() => scr.paint(), animate)
  return (
    <RetroStage screen={scr} className="qgStage zpStage zpPad" data-command={view.cmd} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {L && (
        <>
          {!view.over && <Hit {...L.toy} className="zpCall" aria-hidden="true" />}
          {onPause && (
            <Hit
              as="button"
              {...L.pause}
              className="qgPauseBtn"
              aria-label="Pause"
              title="Pause (P)"
              onPointerDown={(e) => (e.stopPropagation(), (pauseDown.current = true), scr.paint())}
              onPointerUp={(e) => (e.stopPropagation(), (pauseDown.current = false), scr.paint())}
              onPointerLeave={() => ((pauseDown.current = false), scr.paint())}
              onClick={onPause}
            />
          )}
          <div className="rtSr" aria-live="assertive">
            {view.cmd && !view.over ? Z.LABELS[view.cmd] : ""} <span data-score={view.score}>{view.score} zaps</span>
          </div>
        </>
      )}
      {children}
    </RetroStage>
  )
}

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
      setLast({ score, best: rec.best, place: rec.place })
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
      setFeedback({ cmd, ok: false, at: performance.now() })
      return end(game, `wrong:${cmd}`)
    }
    game.s = r.state
    const beat = Z.beatFor(r.state.score)
    game.left = beat
    game.beat = beat
    game.beatT = 0
    game.ticks = 0
    sounds.right(r.state.score)
    setFeedback({ cmd, ok: true, at: performance.now() })
    setTimeout(() => callOut(r.state.command), 90)
    redraw()
  }

  const running = screen === "play" && !!g && !g.over && !hold && !dialog
  useAutoPause(paused, () => gameRef.current && !gameRef.current.over && screen === "play" && setHold(true))
  // the rules' clock (the pad paints itself every frame from live())
  useGameLoop((dt) => {
    const game = gameRef.current
    if (!game || game.over || !running) return
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
        title={<RetroBanner className="zpBanner" palette={pal} minW={220} minH={96} aspect={2.3} paused={paused} label="Zap It! Tap it, swipe it, twist it, pull it, flick it!" draw={(b, t) => drawBanner(b, t, { reduced: reducedMotion() })} />}
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

  // the pad shows the toy idle behind the party's panels too
  const idle = { cmd: null, frac: 0, score: 0, best: null, ticks: -1, keys: !mobile }
  let body = title
  if (screen === "pass" && party) {
    const p = party.players[party.turn]
    body = (
      <div className="zpPlay">
        <Pad view={{ ...idle, who: p.name }}>
          <RetroPanel
            title={`Party: turn ${party.turn + 1} of ${party.players.length}`}
            buttons={
              <>
                <PixelButton label="I'm ready!" big autoFocus data-ready onClick={begin} />
                <PixelButton label="Stop the party" onClick={toTitle} />
              </>
            }
          >
            <PixelP text={`Pass the ${mobile ? "phone" : "keyboard"} to`} />
            <PixelText text={p.name.toUpperCase()} color="#000080" scale={2} />
            <Sr>{p.name}</Sr>
          </RetroPanel>
        </Pad>
      </div>
    )
  } else if (screen === "party-over" && party) {
    const ranked = [...party.players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    body = (
      <div className="zpPlay">
        <Pad view={idle}>
          <RetroPanel
            title="Party results"
            data-party-over
            wide
            buttons={
              <>
                <PixelButton label="Play Again" big autoFocus onClick={() => startParty(party.players.length)} />
                <PixelButton label="Title Screen" onClick={toTitle} />
              </>
            }
          >
            <PixelText text={`${ranked[0].name} wins!`.toUpperCase()} color="#000080" scale={2} />
            <p className="qgFinal rtSr">{ranked[0].name} wins!</p>
            <PixelScores title="RESULTS" rows={ranked.map((p) => ({ score: p.score ?? 0, note: p.name }))} unit=" zaps" max={6} mark={0} />
          </RetroPanel>
        </Pad>
      </div>
    )
  } else if (screen === "play" && g) {
    const cmd = g.s.command
    const view = {
      cmd,
      score: g.s.score,
      best: party ? null : store.best(data, "solo"),
      who: party ? party.players[party.turn].name : null,
      feedback,
      keys: !mobile,
      over: !!g.over,
      overText: g.over ? (g.over.why === "late" ? "TOO SLOW!" : "WRONG!") : null,
      shake: g.s.shake,
    }
    body = (
      <div className="zpPlay">
        <Pad view={view} live={() => (gameRef.current ? { frac: Math.max(0, gameRef.current.left / gameRef.current.beat), ticks: gameRef.current.ticks } : {})} animate={!hold && !dialog} onDown={onDown} onMove={onMove} onUp={onUp} onPause={() => setHold(true)}>
          {hold && !g.over && <RetroPaused onResume={() => (setHold(false), rootRef.current?.focus({ preventScroll: true }))} onQuit={toTitle} />}
          {g.over && (
            <RetroPanel
              title={g.over.why === "late" ? "Too slow!" : "Wrong move!"}
              data-over
              buttons={
                <>
                  {party ? (
                    <PixelButton label={party.turn + 1 < party.players.length ? `Next: ${party.players[party.turn + 1].name}` : "See who won"} big autoFocus data-next onClick={nextTurn} />
                  ) : (
                    <PixelButton label="Play Again" big autoFocus data-again onClick={begin} />
                  )}
                  <PixelButton label="Title Screen" onClick={toTitle} />
                </>
              }
            >
              <PixelP text={`It said ${Z.LABELS[cmd]}${g.over.why.startsWith("wrong:") ? ` (you did ${Z.LABELS[g.over.why.slice(6)].replace("!", "")})` : ""}`} />
              <PixelLed text={String(g.over.score)} />
              <p className="qgFinal rtSr">{g.over.score} zaps</p>
              {!party && last?.best && <PixelP className="qgNewBest zpNewBest" text="NEW BEST!" color="#c00000" />}
              {!party && <PixelScores rows={data.scores.solo || []} mark={last?.place ?? -1} unit=" zaps" max={3} />}
            </RetroPanel>
          )}
        </Pad>
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
          <p>Do what it calls before the ring of lights runs out. Every 5 right, the beat gets quicker. One wrong move (or too slow) and it's over.</p>
          <ul>
            <li>
              <b>Tap it</b>: tap the screen. <b>Swipe it</b>: swipe sideways. <b>Pull it</b>: drag down. <b>Flick it</b>: flick up.
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
