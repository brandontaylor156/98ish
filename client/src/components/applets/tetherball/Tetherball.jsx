import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import GameStart from "../../shared/GameStart"
import PlayOnline, { OnlineResultBar, useOnlineRoom } from "../../shared/online"
import { Check, HowToDialog, PausedPanel, QuickGameRoot, ScoresDialog, TitleScreen, useAutoPause, useGameLoop } from "../../shared/quickgame"
import { unlock } from "../../../utils/achievements"
import { helpItem } from "../../../utils/help"
import { createScores } from "../../../utils/gameKit"
import { createSynth, midi } from "../../../utils/gameSynth"
import * as M from "./match"
import { MAX_WRAPS, wraps } from "./physics"
import { createMirror, pack, SNAP_MS } from "./netplay"
import { createScene } from "./scene"
import "./Tetherball.css"

// Tetherball: a ball on a rope round a pole. You hit it one way round, the other player the
// other way; wind the rope all the way round in your direction to win the game. Against the
// computer (Easy, Medium, Hard) or online one against one (server/arcade/games/tetherball.js,
// relay: the host's browser runs the match, netplay.js). Physics in physics.js, the match in
// match.js, the 3D picture in scene.js.
//
// Controls: your player runs to the ball by themselves; you choose when to hit, how hard and
// how high. Swipe across the screen (faster = harder, upward = higher) or tap for a medium hit;
// Space (hold for a harder hit, with Up/Down for high/low) or click on a computer.

const ICON = "/assets/program_icons/tetherball.svg"
const store = createScores("98ish.tetherball", { defaults: { sound: true, level: "medium", target: 2 } })
const LEVEL_IDS = ["easy", "medium", "hard"]

const createSounds = () => {
  const s = createSynth({ gain: 0.6 })
  return {
    setEnabled: s.setEnabled,
    hit: (power = 0.6) => s.play(({ tone, noise }) => (noise({ len: 0.09, vol: 0.4 + power * 0.3, freq: 700 + power * 600, type: "bandpass", q: 1.4 }), tone(140 + power * 60, { len: 0.12, type: "sine", vol: 0.35, to: 70 }))),
    pole: () => s.play(({ tone }) => (tone(820, { len: 0.5, type: "sine", vol: 0.12 }), tone(1235, { len: 0.35, type: "sine", vol: 0.06 }))),
    whiff: () => s.play(({ noise }) => noise({ len: 0.18, vol: 0.12, freq: 300, to: 2000, type: "bandpass", q: 1.5 })),
    game: (won) => s.play(({ tone }) => (won ? [67, 72, 76, 79] : [67, 64, 60]).forEach((m, i) => tone(midi(m), { at: i * 0.1, len: 0.2, type: "square", vol: 0.08 }))),
    match: (won) => s.play(({ tone }) => (won ? [60, 64, 67, 72, 76, 79, 84] : [72, 67, 63, 60]).forEach((m, i) => tone(midi(m), { at: i * 0.1, len: 0.22, type: "triangle", vol: 0.14 }))),
    rope: () => s.play(({ noise }) => noise({ len: 0.05, vol: 0.08, freq: 3000, type: "highpass" })),
  }
}

// a swipe -> { power, loft }
export const swipeToHit = (dx, dy, ms) => {
  const len = Math.hypot(dx, dy)
  const speed = len / Math.max(30, ms) // px per ms
  const power = Math.max(0.3, Math.min(1, 0.25 + speed * 0.55))
  const loft = Math.max(-0.3, Math.min(0.6, 0.15 + (-dy / Math.max(1, len)) * 0.4))
  return { power, loft }
}

// ---- the court: the 3D view plus the controls ----
const Court = ({ seat, source, onSwing, paused, onFrame }) => {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const viewRef = useRef(null)
  const ptr = useRef(null)
  const key = useRef(null)
  const [error, setError] = useState(null)
  useLayoutEffect(() => {
    let view
    try {
      view = createScene(canvasRef.current, { seat })
    } catch {
      setError("This device can't draw 3D (WebGL) right now.")
      return
    }
    viewRef.current = view
    const fit = () => {
      const r = wrapRef.current.getBoundingClientRect()
      view.resize(r.width, r.height)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(wrapRef.current)
    return () => {
      ro.disconnect()
      view.dispose()
      viewRef.current = null
    }
  }, [seat])

  useGameLoop((dt, now) => {
    const t0 = performance.now()
    const m = onFrame(dt, now)
    if (m) viewRef.current?.draw(m, dt, { workMs: performance.now() - t0, now })
  }, !paused)

  // swipes and taps
  const onDown = (e) => {
    if (paused) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    ptr.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), done: false }
  }
  const onMove = (e) => {
    const p = ptr.current
    if (!p || p.id !== e.pointerId || p.done) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (Math.hypot(dx, dy) > 28) {
      p.done = true
      onSwing(swipeToHit(dx, dy, performance.now() - p.t))
    }
  }
  const onUp = (e) => {
    const p = ptr.current
    if (!p || p.id !== e.pointerId) return
    ptr.current = null
    if (!p.done && e.type === "pointerup") onSwing({ power: 0.62, loft: 0.15 })
  }
  // Space: hold for power, Up/Down for high/low
  useEffect(() => {
    const down = (e) => {
      if (!wrapRef.current?.closest(".qgRoot")?.contains(document.activeElement) && document.activeElement !== document.body) return
      if (e.key === " " && !e.repeat && !paused) {
        e.preventDefault()
        key.current = { t: performance.now(), up: false, down: false }
      } else if (key.current && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault()
        key.current[e.key === "ArrowUp" ? "up" : "down"] = true
      }
    }
    const up = (e) => {
      if (e.key !== " " || !key.current) return
      e.preventDefault()
      const k = key.current
      key.current = null
      const held = Math.min(0.6, (performance.now() - k.t) / 1000)
      onSwing({ power: 0.4 + held, loft: k.up ? 0.45 : k.down ? -0.15 : 0.15 })
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  })

  return (
    <div className="tbCourt" ref={wrapRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <canvas ref={canvasRef} className="tbCanvas" />
      {error && <div className="tbError">{error}</div>}
    </div>
  )
}

const WrapMeter = ({ ball, names, games, target }) => {
  const w = ball ? wraps(ball) : 0
  const f = Math.max(-1, Math.min(1, w / MAX_WRAPS))
  return (
    <div className="qgHud tbHud">
      <div className="tbSide is-p1">
        <b>{names[0]}</b>
        <span className="tbGames">{"●".repeat(games[0])}{"○".repeat(Math.max(0, target - games[0]))}</span>
      </div>
      <div className="tbMeter" title="How far round the rope is">
        <div className="tbMeterMid" />
        <div className={`tbMeterFill ${f >= 0 ? "is-p1" : "is-p2"}`} style={f >= 0 ? { left: "50%", width: `${f * 50}%` } : { right: "50%", width: `${-f * 50}%` }} />
        <span className="tbMeterText">{Math.abs(w).toFixed(1)} turns</span>
      </div>
      <div className="tbSide is-p2">
        <b>{names[1]}</b>
        <span className="tbGames">{"●".repeat(games[1])}{"○".repeat(Math.max(0, target - games[1]))}</span>
      </div>
    </div>
  )
}

const Banner = ({ m, seat, names }) => {
  if (m.phase === "serve") return <div className="tbBanner">{m.server === seat ? "Your serve: swipe or tap!" : `${names[m.server]} serves...`}</div>
  if (m.phase === "point" && m.gameWinner != null) return <div className="tbBanner is-big">{m.gameWinner === seat ? "You win the game!" : `${names[m.gameWinner]} wins the game`}</div>
  return null
}

// ---- online ----
const OnlineMatch = ({ online, sounds, onBack, onRecord }) => {
  const { room } = online
  const seat = room?.you ?? 0
  const host = seat === 0
  const matchRef = useRef(null) // host: the match; guest: the mirror
  const evId = useRef(0)
  const recent = useRef([])
  const lastSnap = useRef(0)
  const [, setTick] = useState(0)
  const [final, setFinal] = useState(null)
  const playing = room?.phase === "playing"
  const names = room ? [room.seats[0]?.name || "Host", room.seats[1]?.name || "Guest"] : ["", ""]
  const target = room?.settings?.target || 2

  // a new match
  useEffect(() => {
    if (!playing) return
    setFinal(null)
    recent.current = []
    if (host) {
      matchRef.current = M.createMatch({ players: ["human", "remote"], target, seed: Date.now(), rewind: true })
      online.sendRelay({ type: "start", seed: 1, target })
    } else matchRef.current = createMirror({ seat, target })
    setTick((t) => t + 1)
  }, [playing, room?.round])

  useEffect(() => {
    if (!playing) return
    const offSnap = online.onSnap((d) => !host && matchRef.current?.snap?.(d, performance.now()))
    const offRelay = online.onRelay((d) => {
      if (host && d.type === "swing" && matchRef.current?.players) {
        M.remoteSwing(matchRef.current, 1, d.at, d.power, d.loft)
      } else if (!host && d.type === "final") setFinal(d)
    })
    return () => {
      offSnap()
      offRelay()
    }
  }, [playing, host])

  const handleEvents = (events) => {
    for (const e of events) {
      if (e.type === "hit") sounds.hit(e.power)
      else if (e.type === "pole") sounds.pole()
      else if (e.type === "whiff") sounds.whiff()
      else if (e.type === "game") sounds.game(e.seat === seat)
      else if (e.type === "match") sounds.match(e.seat === seat)
    }
  }

  const onFrame = (dt) => {
    const m = matchRef.current
    if (!m) return null
    if (host) {
      M.step(m, dt)
      const events = M.takeEvents(m)
      for (const e of events) recent.current.push({ ...e, id: ++evId.current })
      if (recent.current.length > 16) recent.current = recent.current.slice(-16)
      handleEvents(events)
      const now = performance.now()
      if (now - lastSnap.current >= SNAP_MS) {
        lastSnap.current = now
        online.sendSnap(pack(m, recent.current.slice(-6)))
      }
      if (m.phase === "over" && !m.reported) {
        m.reported = true
        online.sendRelay({ type: "final", games: m.games, winner: m.winner })
        online.finish({ winners: [m.winner], reason: `${m.games[m.winner]}-${m.games[1 - m.winner]}`, scores: m.games })
        onRecord({ won: m.winner === seat, games: m.games, online: true })
      }
      setTick((t) => (t + 1) % 1e9)
      return m
    }
    m.step(dt)
    handleEvents(m.takeEvents())
    setTick((t) => (t + 1) % 1e9)
    const v = m.view
    if (!v.ball) return null
    return { ...v, ball: m.shown(), players: v.players }
  }
  const onSwing = ({ power, loft }) => {
    const m = matchRef.current
    if (!m) return
    if (host) M.swing(m, 0, power, loft)
    else online.sendRelay(m.swing(power, loft, performance.now()))
  }
  useEffect(() => {
    if (room?.phase === "over" && !host && final) onRecord({ won: final.winner === seat, games: final.games, online: true })
  }, [room?.phase, final])
  // dev hook for tests: the host's match or the guest's mirror
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__tetherballOnline = {
      host,
      seat,
      match: () => matchRef.current,
      inReach: () => {
        const m = matchRef.current
        const v = m && (host ? m : m.view)
        return !!(v?.ball && v.phase === "play" && M.inReach(v, v.players[seat]))
      },
      phase: () => {
        const m = matchRef.current
        return m && (host ? m.phase : m.view.phase)
      },
    }
    return () => delete window.__tetherballOnline
  })

  if (!room || (room.phase !== "playing" && room.phase !== "over")) {
    return (
      <div className="tbOnline">
        <PlayOnline
          online={online}
          title="Tetherball"
          icon={ICON}
          blurb="One against one, anywhere: wind the rope all the way round in your direction. Quick Match finds someone; a private room gets a code to share."
          defaultSettings={{ target: 2 }}
          quickSettings
          onBack={room ? null : onBack}
          renderSettings={(s, set, { disabled }) => (
            <label className="qgOptionRow">
              Games to win:
              <select disabled={disabled} value={s.target || 2} onChange={(e) => set({ ...s, target: Number(e.target.value) })}>
                <option value={1}>1 (one game)</option>
                <option value={2}>2 (best of 3)</option>
                <option value={3}>3 (best of 5)</option>
              </select>
            </label>
          )}
        />
      </div>
    )
  }
  const m = matchRef.current
  const v = m ? (host ? m : m.view) : null
  return (
    <div className="tbPlay">
      {v && <WrapMeter ball={host ? v.ball : m.shown()} names={names} games={v.games} target={target} />}
      <div className="qgStage tbStage">
        {playing && <Court seat={seat} source={m} onSwing={onSwing} paused={false} onFrame={onFrame} />}
        {v && playing && <Banner m={{ ...v, gameWinner: v.gameWinner ?? null }} seat={seat} names={names} />}
        {room.phase === "over" && (
          <div className="qgOverlay">
            <div className="qgPanel window">
              <div className="title-bar">
                <div className="title-bar-text">Match over</div>
              </div>
              <div className="window-body qgPanelBody">
                <OnlineResultBar online={online} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---- the window ----
const Tetherball = ({ mobile = false, paused = false, onClose }) => {
  const chatItem = useGameChatMenuItem("tetherball")
  const sounds = useMemo(() => createSounds(), [])
  const [data, setData] = useState(store.load)
  const prefs = data.prefs
  const [screen, setScreen] = useState("title") // title | play | online
  const matchRef = useRef(null)
  const [, setTick] = useState(0)
  const [hold, setHold] = useState(false)
  const [over, setOver] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [last, setLast] = useState(null)
  const rootRef = useRef(null)
  const online = useOnlineRoom("tetherball")
  const m = matchRef.current

  useEffect(() => {
    sounds.setEnabled(prefs.sound)
  }, [prefs.sound])
  const setPref = (patch) => setData(store.setPrefs(patch))
  useEffect(() => {
    if (online.room && screen !== "online") setScreen("online")
  }, [online.room?.id])

  const record = ({ won, games, level, online: wasOnline }) => {
    if (!wasOnline) {
      const key = level
      const d = store.load()
      const wins = { ...(d.extra.wins || {}) }
      const played = { ...(d.extra.played || {}) }
      played[key] = (played[key] || 0) + 1
      if (won) wins[key] = (wins[key] || 0) + 1
      setData(store.setExtra({ wins, played }))
      if (won && level === "hard") unlock("tetherball-hard")
    }
    if (won) unlock("tetherball-win")
    if (wasOnline && won) unlock("tetherball-online")
    setLast({ won, games, level, online: wasOnline })
  }

  const start = (level = prefs.level, target = prefs.target) => {
    setPref({ level, target })
    matchRef.current = M.createMatch({ players: ["human", "cpu"], level, target, seed: Date.now(), server: 0 })
    setOver(null)
    setHold(false)
    setScreen("play")
    setTimeout(() => rootRef.current?.focus({ preventScroll: true }), 0)
  }
  const toTitle = () => {
    if (online.room) online.leave()
    matchRef.current = null
    setOver(null)
    setHold(false)
    setScreen("title")
  }

  useAutoPause(paused, () => matchRef.current && matchRef.current.phase !== "over" && screen === "play" && setHold(true))

  const onFrame = (dt) => {
    const match = matchRef.current
    if (!match) return null
    if (!hold && !over && !dialog) {
      M.step(match, dt)
      for (const e of M.takeEvents(match)) {
        if (e.type === "hit") sounds.hit(e.power)
        else if (e.type === "pole") sounds.pole()
        else if (e.type === "whiff") sounds.whiff()
        else if (e.type === "game") sounds.game(e.seat === 0)
        else if (e.type === "match") {
          sounds.match(e.seat === 0)
          const res = { won: e.seat === 0, games: [...match.games], level: match.level }
          record(res)
          setOver(res)
        }
      }
      setTick((t) => (t + 1) % 1e9)
    }
    return match
  }
  const onSwing = ({ power, loft }) => {
    if (!matchRef.current || hold || over) return
    M.swing(matchRef.current, 0, power, loft)
  }

  const onKeyDown = (e) => {
    if (screen !== "play") return
    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      e.preventDefault()
      if (!over) setHold((h) => !h)
    }
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__tetherball = { match: () => matchRef.current, M }
    return () => delete window.__tetherball
  }, [])

  const wins = data.extra.wins || {}
  const played = data.extra.played || {}
  const menus = [
    {
      label: "Game",
      items: [
        ...LEVEL_IDS.map((l) => ({ label: `Play ${M.LEVELS[l].name}`, checked: prefs.level === l, onClick: () => start(l) })),
        { label: "Play Online...", onClick: () => (toTitle(), setScreen("online")) },
        "-",
        ...[1, 2, 3].map((n) => ({ label: n === 1 ? "One Game" : `First to ${n}`, checked: prefs.target === n, onClick: () => setPref({ target: n }) })),
        "-",
        { label: "Statistics...", onClick: () => setDialog("scores") },
        { label: "Title Screen", onClick: toTitle },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    { label: "Options", items: [{ label: "Sound", checked: prefs.sound, onClick: () => setPref({ sound: !prefs.sound }) }, chatItem] },
    { label: "Help", items: [helpItem({ program: "Tetherball" }), "-", { label: "How to Play...", onClick: () => setDialog("howto") }] },
  ]

  const title = (
    <TitleScreen>
      <GameStart
        id="tetherball"
        title={
          <div className="qgLogo">
            <img src={ICON} alt="" />
            <div className="qgLogoText tbLogo">Tetherball</div>
            <div className="qgTagline">Wind it all the way round!</div>
          </div>
        }
        play={{ label: last && !last.online ? "Play again" : "Play", sub: `Against the computer · ${M.LEVELS[prefs.level].name} · ${prefs.target === 1 ? "one game" : `first to ${prefs.target}`}`, onClick: () => start(), autoFocus: true, "data-play": true }}
        online={{ onClick: () => setScreen("online"), sub: "One against one, anywhere" }}
        modes={LEVEL_IDS.filter((l) => l !== prefs.level).map((l) => ({ key: l, label: M.LEVELS[l].name, sub: `Won ${wins[l] || 0} of ${played[l] || 0}`, onClick: () => start(l), "data-level": l }))}
        optionsSummary={`${prefs.target === 1 ? "One game" : `First to ${prefs.target}`} · Sound ${prefs.sound ? "on" : "off"}`}
        options={
          <>
            <label className="qgOptionRow">
              Match:
              <select value={prefs.target} onChange={(e) => setPref({ target: Number(e.target.value) })}>
                <option value={1}>One game</option>
                <option value={2}>First to 2 (best of 3)</option>
                <option value={3}>First to 3 (best of 5)</option>
              </select>
            </label>
            <Check id="tb-opt1" checked={prefs.sound} onChange={() => setPref({ sound: !prefs.sound })}>
              Sound
            </Check>
          </>
        }
      >
        {last && (
          <fieldset className="qgResult">
            <legend>Last match{last.online ? " (online)" : `, ${M.LEVELS[last.level]?.name || ""}`}</legend>
            {last.won ? "You won" : "You lost"} {last.games ? `${Math.max(...last.games)}-${Math.min(...last.games)}` : ""}
          </fieldset>
        )}
      </GameStart>
    </TitleScreen>
  )

  const names = ["You", `Computer (${M.LEVELS[prefs.level].name})`]
  let body = title
  if (screen === "online") body = <OnlineMatch online={online} sounds={sounds} onBack={() => setScreen("title")} onRecord={record} />
  else if (screen === "play" && m) {
    body = (
      <div className="tbPlay">
        <WrapMeter ball={m.ball} names={["You", "Computer"]} games={m.games} target={m.target} />
        <div className="qgStage tbStage">
          <Court seat={0} source={m} onSwing={onSwing} paused={false} onFrame={onFrame} />
          <Banner m={m} seat={0} names={names} />
          {m.phase === "play" && m.rally === 0 && !hold && <div className="tbHint">{mobile ? "Swipe across when the ball comes to you (faster = harder, upward = higher), or tap" : "Space when the ball comes round (hold for harder; Up/Down for high/low), or swipe with the mouse"}</div>}
          <button type="button" className="qgPauseBtn tbPause" onClick={() => setHold(true)} aria-label="Pause" title="Pause (P)">
            ||
          </button>
          {hold && !over && <PausedPanel onResume={() => (setHold(false), rootRef.current?.focus({ preventScroll: true }))} onQuit={toTitle} />}
          {over && (
            <div className="qgOverlay" data-over={over.won ? "won" : "lost"}>
              <div className="qgPanel window">
                <div className="title-bar">
                  <div className="title-bar-text">{over.won ? "You win!" : "The computer wins"}</div>
                </div>
                <div className="window-body qgPanelBody">
                  <p className="qgFinal">
                    {over.games[0]} - {over.games[1]}
                  </p>
                  <div className="qgPanelButtons">
                    <button type="button" className="qgBig" autoFocus onClick={() => start(prefs.level)} data-again>
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
    <QuickGameRoot ref={rootRef} className="tbRoot" mobile={mobile} onKeyDown={onKeyDown} data-screen={screen}>
      <MenuBar menus={menus} />
      <GameChat game="tetherball" title="Tetherball" room={online.chatRoom} />
      {body}
      {dialog === "scores" && (
        <ScoresDialog
          title="Tetherball Statistics"
          onClose={() => setDialog(null)}
          tables={LEVEL_IDS.map((l) => ({ label: `${M.LEVELS[l].name}: won ${wins[l] || 0} of ${played[l] || 0}`, rows: [] }))}
        />
      )}
      {dialog === "howto" && (
        <HowToDialog title="How to Play Tetherball" onClose={() => setDialog(null)}>
          <p>The ball hangs on a rope from the top of the pole. You hit it one way round; the other player hits it back the other way. Wind the rope all the way round the pole in your direction to win the game.</p>
          <ul>
            <li>You stand on your half of the circle (the near side) and can only hit the ball there. Your player runs to the ball by themselves: you choose when to hit, how hard and how high.</li>
            <li>The ring on the ground lights up when the ball is in reach. Hit then!</li>
            <li>Phone: swipe across the screen (faster is harder, upward is higher), or tap for a medium hit.</li>
            <li>Computer: Space (hold it longer for a harder hit; hold Up or Down as well for a high or low hit), or swipe with the mouse. P pauses.</li>
            <li>As the rope winds it gets shorter, so the ball goes round faster and lower: the closer to the end, the harder it is to stop.</li>
          </ul>
          <p>
            <b>Play Online</b>: one against one with someone anywhere.
          </p>
        </HowToDialog>
      )}
    </QuickGameRoot>
  )
}

export default Tetherball
