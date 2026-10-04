import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import GameStart from "../../shared/GameStart"
import PlayOnline, { OnlineResultBar, useOnlineRoom } from "../../shared/online"
import { Check, HowToDialog, PausedPanel, QuickGameRoot, ScoresDialog, TitleScreen, useAutoPause, useGameLoop } from "../../shared/quickgame"
import { unlock } from "../../../utils/achievements"
import { helpItem } from "../../../utils/help"
import { createScores } from "../../../utils/gameKit"
import { createSynth } from "../../../utils/gameSynth"
import * as R from "./rules"
import "./EchoPads.css"

// Echo Pads: a Simon-style memory game. Four pads light up and sing a sequence; repeat it.
// Every round adds a step. Classic, Reverse, Rewind (forwards then back) and Speed; online
// "Pass the Pads": take turns repeating the shared sequence and adding a step; a slip and
// you're out (server/arcade/games/echo.js; rules in rules.js, shared with the server).
// Each pad has a symbol (triangle, circle, square, star) for color-blind players.

const ICON = "/assets/program_icons/echo.svg"
const store = createScores("98ish.echo", { defaults: { sound: true, symbols: true, mode: "classic" } })
const INPUT_MS = 5000 // to make each press in a solo game
const KEYMAP = { q: 0, w: 1, a: 2, s: 3, 1: 0, 2: 1, 3: 2, 4: 3, ArrowUp: 0, ArrowRight: 1, ArrowLeft: 2, ArrowDown: 3 }

// the pads: four quarters of a ring around a hub, drawn in SVG
const ARC = (i) => {
  // quarters: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right
  const start = [180, 270, 90, 0][i] + 3
  const end = start + 84
  const R1 = 96
  const R0 = 42
  const p = (r, a) => [100 + r * Math.cos((a * Math.PI) / 180), 100 + r * Math.sin((a * Math.PI) / 180)]
  const [a, b] = [p(R1, start), p(R1, end)]
  const [c, d] = [p(R0, end), p(R0, start)]
  return `M${a} A${R1} ${R1} 0 0 1 ${b} L${c} A${R0} ${R0} 0 0 0 ${d} Z`
}
const SYMBOL_AT = [
  [62, 62],
  [138, 62],
  [62, 138],
  [138, 138],
]
const Symbol = ({ kind, x, y }) => {
  const s = 13
  if (kind === "triangle") return <path d={`M${x} ${y - s} L${x + s} ${y + s * 0.8} L${x - s} ${y + s * 0.8} Z`} />
  if (kind === "circle") return <circle cx={x} cy={y} r={s * 0.9} />
  if (kind === "square") return <rect x={x - s * 0.8} y={y - s * 0.8} width={s * 1.6} height={s * 1.6} />
  const pts = Array.from({ length: 10 }, (_, k) => {
    const r = k % 2 ? s * 0.45 : s
    const a = -Math.PI / 2 + (k * Math.PI) / 5
    return `${x + r * Math.cos(a)},${y + r * Math.sin(a)}`
  }).join(" ")
  return <polygon points={pts} />
}

const Pads = ({ lit, onPress, onRelease, enabled, symbols, center }) => (
  <svg viewBox="0 0 200 200" className={`epPads${enabled ? " is-on" : ""}`} role="group" aria-label="Echo pads">
    <circle cx="100" cy="100" r="99" fill="#202020" />
    {R.PADS.map((p, i) => (
      <path
        key={p.id}
        d={ARC(i)}
        className={`epPad epPad-${p.id}${lit === i ? " is-lit" : ""}`}
        data-pad={i}
        role="button"
        aria-label={`${p.name} (${p.symbol})`}
        onPointerDown={(e) => {
          if (!enabled) return
          e.preventDefault()
          e.currentTarget.setPointerCapture?.(e.pointerId)
          onPress(i)
        }}
        onPointerUp={() => enabled && onRelease?.(i)}
        onPointerCancel={() => enabled && onRelease?.(i)}
      />
    ))}
    {symbols && (
      <g className="epSymbols" pointerEvents="none">
        {R.PADS.map((p, i) => (
          <g key={p.id} className={lit === i ? "is-lit" : ""}>
            <Symbol kind={p.symbol} x={SYMBOL_AT[i][0]} y={SYMBOL_AT[i][1]} />
          </g>
        ))}
      </g>
    )}
    <circle cx="100" cy="100" r="38" fill="#c0c0c0" stroke="#000" strokeWidth="2" />
    <text x="100" y="96" textAnchor="middle" className="epHubTitle">
      ECHO
    </text>
    <text x="100" y="114" textAnchor="middle" className="epHubText">
      {center}
    </text>
  </svg>
)

const createSounds = () => {
  const s = createSynth({ gain: 0.5 })
  let stop = null
  return {
    setEnabled: s.setEnabled,
    padOn: (i) => {
      stop?.()
      stop = s.hold(R.PADS[i].freq, { type: "triangle", vol: 0.24 })
    },
    padOff: () => {
      stop?.()
      stop = null
    },
    blip: (i, ms) => s.play(({ tone }) => (tone(R.PADS[i].freq, { len: ms / 1000, type: "triangle", vol: 0.24, attack: 0.01 }), tone(R.PADS[i].freq * 2, { len: ms / 1000, type: "sine", vol: 0.05 }))),
    wrong: () => s.play(({ tone }) => (tone(90, { len: 0.8, type: "sawtooth", vol: 0.16 }), tone(94, { len: 0.8, type: "square", vol: 0.08 }))),
    round: () => s.play(({ tone }) => [523, 659, 784].forEach((f, i) => tone(f, { at: i * 0.06, len: 0.1, type: "square", vol: 0.05 }))),
  }
}

// ---- online: Pass the Pads ----
const OnlineGame = ({ online, sounds, symbols, onBack, onRecord }) => {
  const { room, view } = online
  const [, setTick] = useState(0)
  const [flashPad, setFlashPad] = useState(null)
  const lastN = useRef(0)
  const lastStep = useRef(-1)
  const recorded = useRef(null)
  const you = room?.you
  const now = online.serverNow()
  const live = !!view && room?.phase === "playing"
  useGameLoop(() => setTick((t) => (t + 1) % 1e9), live)

  // someone pressed a pad: flash it and play its tone (a buzz for a slip)
  useEffect(() => {
    const l = view?.last
    if (!l || l.n === lastN.current) return
    lastN.current = l.n
    if (l.ok) {
      if (l.seat !== you) sounds.blip(l.pad, 220)
      setFlashPad(l.pad)
      const id = setTimeout(() => setFlashPad(null), 230)
      return () => clearTimeout(id)
    }
    sounds.wrong()
  }, [view?.last?.n])
  useEffect(() => {
    if (room?.phase === "over" && view && recorded.current !== room.round) {
      recorded.current = room.round
      onRecord({ steps: view.seq.length, won: view.winner === you && room.seats.some((s, i) => s && i !== you && !s.bot) })
    }
  }, [room?.phase])

  if (!room || (room.phase !== "playing" && room.phase !== "over") || !view) {
    return (
      <div className="epOnline">
        <PlayOnline
          online={online}
          title="Echo Pads"
          icon={ICON}
          blurb="Pass the Pads: take turns. On your turn, repeat the whole sequence, then add one step of your own. Slip, or run out of time, and you're out. Last one left wins."
          defaultSettings={R.DEFAULTS}
          quickSettings
          computer
          onBack={room ? null : onBack}
          renderSettings={(s, set, { disabled }) => (
            <div className="epSettings">
              <label className="qgOptionRow">
                Order:
                <select disabled={disabled} value={s.mode || "classic"} onChange={(e) => set({ ...s, mode: e.target.value })}>
                  <option value="classic">Classic (as played)</option>
                  <option value="reverse">Reverse (backwards)</option>
                </select>
              </label>
              <Check id="ep-opt1" disabled={disabled} checked={s.replay !== false} onChange={(e) => set({ ...s, replay: e.target.checked })}>
              Play the sequence before each turn
            </Check>
            </div>
          )}
        />
      </div>
    )
  }

  // the playback before a turn, from the server's clock
  let lit = flashPad
  if (view.phase === "showing" && now >= view.showFrom) {
    const step = view.stepMs * (1 + R.GAP_RATIO)
    const t = now - view.showFrom
    const k = Math.floor(t / step)
    if (k < view.seq.length && t - k * step < view.stepMs) {
      lit = view.seq[k]
      if (lastStep.current !== `${view.turns}:${k}`) {
        lastStep.current = `${view.turns}:${k}`
        sounds.blip(lit, view.stepMs * 0.9)
      }
    }
  }
  const mine = room.phase === "playing" && view.turn === you && (view.phase === "repeat" || view.phase === "add")
  const want = R.expectedFor(view.seq, view.mode).length
  const turnName = room.seats[view.turn]?.name || "?"
  const left = Math.max(0, (view.deadline - now) / 1000)
  const status =
    room.phase === "over"
      ? view.winner === you
        ? "You win!"
        : `${room.seats[view.winner]?.name || "Nobody"} wins!`
      : view.phase === "showing"
        ? view.turn === you
          ? "Watch... your turn next!"
          : `Watch: ${turnName} is next`
        : mine
          ? view.phase === "add"
            ? "Add a step: press any pad!"
            : `Your turn: repeat ${want} step${want === 1 ? "" : "s"} (${view.pos} done)`
          : `${turnName}'s turn${view.phase === "add" ? ": adding a step" : ""}`
  return (
    <div className="epPlay">
      <div className="epPlayers">
        {room.seats.map((s, i) =>
          s ? (
            <span key={i} className={`${view.alive[i] ? "" : "is-out"}${view.turn === i && room.phase === "playing" ? " is-turn" : ""}${i === you ? " is-you" : ""}`}>
              {s.name}
              {s.bot ? " (computer)" : ""}
            </span>
          ) : null,
        )}
      </div>
      <div className="epStatus" data-status>
        {status}
        {mine && <span className="epClock"> · {left.toFixed(1)} s</span>}
      </div>
      <div className="qgStage epStage">
        <Pads
          lit={lit}
          enabled={mine}
          symbols={symbols}
          center={`${view.seq.length}`}
          onPress={(i) => {
            sounds.blip(i, 220)
            setFlashPad(i)
            setTimeout(() => setFlashPad(null), 200)
            online.act({ type: "press", pad: i })
          }}
        />
        {room.phase === "over" && (
          <div className="epOverBar">
            <OnlineResultBar online={online} text={`${view.seq.length} steps`} />
          </div>
        )}
      </div>
    </div>
  )
}

// ---- the window ----
const EchoPads = ({ mobile = false, paused = false, onClose }) => {
  const chatItem = useGameChatMenuItem("echo")
  const sounds = useMemo(() => createSounds(), [])
  const [data, setData] = useState(store.load)
  const prefs = data.prefs
  const [screen, setScreen] = useState("title")
  const gameRef = useRef(null) // { s (rules state), t (ms into the playback), wait (ms left to press), lit, over }
  const [, setFrame] = useState(0)
  const [hold, setHold] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [last, setLast] = useState(null)
  const [pressed, setPressed] = useState(null)
  const rootRef = useRef(null)
  const online = useOnlineRoom("echo")
  const g = gameRef.current

  useEffect(() => {
    sounds.setEnabled(prefs.sound)
  }, [prefs.sound])
  useEffect(() => () => sounds.padOff(), [])
  const setPref = (patch) => setData(store.setPrefs(patch))
  const redraw = () => setFrame((f) => (f + 1) % 1e9)

  useEffect(() => {
    if (online.room && screen !== "online") setScreen("online")
  }, [online.room?.id])
  // a game starting online: keys go to this window
  useEffect(() => {
    if (online.room?.phase === "playing") rootRef.current?.focus({ preventScroll: true })
  }, [online.room?.phase, online.room?.round])

  const record = ({ mode, steps, won, online: wasOnline }) => {
    let best = false
    if (!wasOnline) {
      const rec = store.record(mode, { score: steps, note: `${steps} steps` })
      setData(rec.data)
      best = rec.best
    }
    if (steps >= 10) unlock("echo-10")
    if (steps >= 20) unlock("echo-20")
    if (wasOnline && won) unlock("echo-online")
    setLast({ mode, steps, best, online: wasOnline, won })
  }

  const start = (mode = prefs.mode) => {
    setPref({ mode })
    gameRef.current = { s: R.newSolo({ mode, seed: Date.now() }), t: -600, wait: INPUT_MS, lit: null, over: null }
    setHold(false)
    setScreen("play")
    redraw()
    setTimeout(() => rootRef.current?.focus({ preventScroll: true }), 0)
  }
  const toTitle = () => {
    if (online.room) online.leave()
    sounds.padOff()
    gameRef.current = null
    setHold(false)
    setScreen("title")
  }
  const lose = (game, wanted) => {
    sounds.padOff()
    sounds.wrong()
    const steps = R.scoreOf(game.s.over ? game.s : { ...game.s, over: true, best: game.s.seq.length - 1 })
    game.over = { steps, wanted }
    game.lit = wanted ?? null
    record({ mode: game.s.mode, steps })
    redraw()
  }

  const running = screen === "play" && !!g && !g.over && !hold && !dialog
  useAutoPause(paused, () => {
    if (gameRef.current && !gameRef.current.over) {
      sounds.padOff()
      setHold(true)
    }
  })

  useGameLoop((dt) => {
    const game = gameRef.current
    if (!game || game.over) return
    const s = game.s
    if (s.phase === "show") {
      game.t += dt * 1000
      const step = R.stepMs(s.seq.length, s.mode)
      const period = step * (1 + R.GAP_RATIO)
      const k = Math.floor(game.t / period)
      if (game.t < 0) game.lit = null
      else if (k >= s.seq.length) {
        game.s = R.toInput(s)
        game.lit = null
        game.wait = INPUT_MS
      } else {
        const on = game.t - k * period < step
        const lit = on ? s.seq[k] : null
        if (lit !== null && game.lit === null) sounds.blip(lit, step * 0.95)
        game.lit = lit
      }
    } else if (s.phase === "input") {
      game.wait -= dt * 1000
      if (game.wait <= 0) return lose(game, R.expectedFor(s.seq, s.mode)[s.pos])
    }
    redraw()
  }, running)

  const press = (i) => {
    const game = gameRef.current
    if (!game || game.over || game.s.phase !== "input" || hold) return
    sounds.padOn(i)
    setPressed(i)
    const r = R.press(game.s, i)
    if (!r.ok) {
      game.s = r.state
      return lose(game, r.wanted)
    }
    game.s = r.state
    game.wait = INPUT_MS
    if (r.done) {
      game.t = -800
      setTimeout(() => sounds.round(), 250)
      if (r.state.seq.length - 1 >= 10) unlock("echo-10")
    }
    redraw()
  }
  const release = () => {
    sounds.padOff()
    setPressed(null)
  }

  const onKeyDown = (e) => {
    if (e.target.closest?.("input, select, textarea, .menuBar")) return
    if (screen !== "play" || !gameRef.current) return
    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      e.preventDefault()
      if (!gameRef.current.over) setHold((h) => !h)
      return
    }
    const pad = KEYMAP[e.key.length === 1 ? e.key.toLowerCase() : e.key]
    if (pad === undefined || e.repeat || !running) return
    e.preventDefault()
    press(pad)
  }
  const onKeyUp = (e) => {
    const pad = KEYMAP[e.key.length === 1 ? e.key.toLowerCase() : e.key]
    if (pad !== undefined) release()
  }
  // online games take keys too
  const onlineKey = (e) => {
    if (screen !== "online") return
    const pad = KEYMAP[e.key.length === 1 ? e.key.toLowerCase() : e.key]
    const v = online.view
    if (pad === undefined || e.repeat || !v || online.room?.phase !== "playing" || v.turn !== online.room.you || !(v.phase === "repeat" || v.phase === "add")) return
    e.preventDefault()
    sounds.blip(pad, 220)
    online.act({ type: "press", pad })
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__echo = { state: () => gameRef.current, expected: () => gameRef.current && R.expectedFor(gameRef.current.s.seq, gameRef.current.s.mode), rules: R }
    return () => delete window.__echo
  }, [])

  const best = (m) => store.best(data, m)
  const menus = [
    {
      label: "Game",
      items: [
        ...R.MODES.map((m) => ({ label: R.MODE_NAMES[m], checked: prefs.mode === m, onClick: () => start(m) })),
        { label: "Play Online...", onClick: () => (toTitle(), setScreen("online")) },
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
        { label: "Pad Symbols (color-blind help)", checked: prefs.symbols, onClick: () => setPref({ symbols: !prefs.symbols }) },
        chatItem,
      ],
    },
    { label: "Help", items: [helpItem({ program: "Echo Pads" }), "-", { label: "How to Play...", onClick: () => setDialog("howto") }] },
  ]

  const MODE_SUB = { classic: "Repeat it as played", reverse: "Repeat it backwards", rewind: "Forwards, then back again", speed: "Classic, starting fast" }
  const title = (
    <TitleScreen>
      <GameStart
        id="echo"
        title={
          <div className="qgLogo">
            <div className="epLogo">
              <Pads lit={null} enabled={false} symbols={prefs.symbols} center="" />
            </div>
            <div className="qgLogoText">Echo Pads</div>
            <div className="qgTagline">Watch. Listen. Repeat.</div>
          </div>
        }
        play={{
          label: last && !last.online ? `${R.MODE_NAMES[prefs.mode]} again` : "Play",
          sub: `${R.MODE_NAMES[prefs.mode]} · Best: ${best(prefs.mode)} steps`,
          onClick: () => start(),
          autoFocus: true,
          "data-play": true,
        }}
        online={{ onClick: () => setScreen("online"), sub: "Pass the Pads: take turns adding steps, last one standing wins" }}
        modes={R.MODES.filter((m) => m !== prefs.mode).map((m) => ({ key: m, label: R.MODE_NAMES[m], sub: `${MODE_SUB[m]} · Best ${best(m)}`, onClick: () => start(m), "data-mode": m }))}
        optionsSummary={`Pad symbols ${prefs.symbols ? "on" : "off"} · Sound ${prefs.sound ? "on" : "off"}`}
        options={
          <>
            <Check id="ep-opt2" checked={prefs.symbols} onChange={() => setPref({ symbols: !prefs.symbols })}>
              Symbols on the pads (color-blind help)
            </Check>
            <Check id="ep-opt3" checked={prefs.sound} onChange={() => setPref({ sound: !prefs.sound })}>
              Sound
            </Check>
            <button type="button" onClick={() => setDialog("scores")}>
              High Scores...
            </button>
          </>
        }
      >
        {last && (
          <fieldset className="qgResult">
            <legend>{last.online ? "Pass the Pads" : R.MODE_NAMES[last.mode]}</legend>
            {last.online ? (last.won ? "You won! " : "") : ""}
            <b>{last.steps}</b> steps{last.best && <span className="qgNewBest"> New best!</span>}
          </fieldset>
        )}
      </GameStart>
    </TitleScreen>
  )

  let body = title
  if (screen === "online") body = <OnlineGame online={online} sounds={sounds} symbols={prefs.symbols} onBack={() => setScreen("title")} onRecord={({ steps, won }) => record({ mode: "online", steps, won, online: true })} />
  else if (screen === "play" && g) {
    const s = g.s
    const want = R.expectedFor(s.seq, s.mode)
    const lit = pressed ?? g.lit
    const center = g.over ? "X" : s.phase === "show" ? "..." : `${s.pos}/${want.length}`
    body = (
      <div className="epPlay">
        <div className="qgHud">
          <div className="qgCounter">
            <span className="qgLabel">Steps</span>
            <span className="qgNum" data-steps={s.seq.length}>
              {s.seq.length}
            </span>
          </div>
          <div className="epStatus" data-status>
            {g.over ? "Missed!" : s.phase === "show" ? "Watch and listen..." : s.mode === "reverse" ? "Your turn: backwards!" : s.mode === "rewind" ? (s.pos < s.seq.length ? "Your turn: forwards..." : "...and back again!") : "Your turn!"}
          </div>
          <div className="qgCounter">
            <span className="qgLabel">Best</span>
            <span className="qgNum">{best(s.mode)}</span>
          </div>
          <button type="button" className="qgPauseBtn" onClick={() => (sounds.padOff(), setHold(true))} aria-label="Pause" title="Pause (P)">
            ||
          </button>
        </div>
        {s.phase === "input" && !g.over && (
          <div className="epWait">
            <div style={{ width: `${(Math.max(0, g.wait) / INPUT_MS) * 100}%` }} />
          </div>
        )}
        <div className="qgStage epStage">
          <Pads lit={lit} enabled={running && s.phase === "input"} symbols={prefs.symbols} center={center} onPress={press} onRelease={release} />
          {hold && !g.over && <PausedPanel onResume={() => (setHold(false), rootRef.current?.focus({ preventScroll: true }))} onQuit={toTitle} />}
          {g.over && (
            <div className="qgOverlay is-low" data-over>
              <div className="qgPanel window">
                <div className="title-bar">
                  <div className="title-bar-text">Game over</div>
                </div>
                <div className="window-body qgPanelBody">
                  <p>{g.over.wanted != null ? `It was ${R.PADS[g.over.wanted].name} (${R.PADS[g.over.wanted].symbol}).` : "Out of time!"}</p>
                  <p className="qgFinal">{g.over.steps} steps</p>
                  {last?.best && <p className="qgNewBest">New best!</p>}
                  <div className="qgPanelButtons">
                    <button type="button" className="qgBig" autoFocus onClick={() => start(s.mode)} data-again>
                      Play Again
                    </button>
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
    <QuickGameRoot
      ref={rootRef}
      className="epRoot"
      mobile={mobile}
      onKeyDown={(e) => (screen === "online" ? onlineKey(e) : onKeyDown(e))}
      onKeyUp={onKeyUp}
      data-screen={screen}
    >
      <MenuBar menus={menus} />
      <GameChat game="echo" title="Echo Pads" room={online.chatRoom} />
      {body}
      {dialog === "scores" && <ScoresDialog title="Echo Pads Best Runs" unit=" steps" onClose={() => setDialog(null)} tables={R.MODES.map((m) => ({ label: R.MODE_NAMES[m], rows: data.scores[m] }))} />}
      {dialog === "howto" && (
        <HowToDialog title="How to Play Echo Pads" onClose={() => setDialog(null)}>
          <p>The pads light up and play a tune. When it's your turn, press the pads in the same order. Get it right and the tune grows by one step. It speeds up at 5, 9 and 13 steps.</p>
          <ul>
            <li>
              <b>Classic</b>: repeat it as played. <b>Reverse</b>: backwards. <b>Rewind</b>: forwards, then back again. <b>Speed</b>: Classic, starting fast.
            </li>
            <li>You have 5 seconds for each press.</li>
            <li>Keys: Q W / A S (or 1-4, or the arrow keys) press the pads. P pauses.</li>
            <li>Every pad has its own symbol (triangle, circle, square, star), so you don't need to tell the colors apart. Options turns them off.</li>
          </ul>
          <p>
            <b>Play Online</b> (Pass the Pads): take turns. Repeat the whole tune, then add a step of your own. A slip, or the clock running out, and you're out. Last one left wins.
          </p>
        </HowToDialog>
      )}
    </QuickGameRoot>
  )
}

export default EchoPads
