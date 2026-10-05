import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import GameStart from "../../shared/GameStart"
import PlayOnline, { OnlineResultBar, useOnlineRoom } from "../../shared/online"
import { Check, HowToDialog, QuickGameRoot, ScoresDialog, TitleScreen, useAutoPause, useGameLoop } from "../../shared/quickgame"
import { PixelButton, PixelText, RetroBanner, RetroPanel, RetroPaused, RetroStage, Sr, Hit, useRetroScreen } from "../../shared/retro"
import { unlock } from "../../../utils/achievements"
import { helpItem } from "../../../utils/help"
import { reducedMotion } from "../../../utils/settings"
import { createScores } from "../../../utils/gameKit"
import { createSynth, midi } from "../../../utils/gameSynth"
import * as M from "./match"
import { MAX_WRAPS, wraps } from "./physics"
import { createMirror, pack, SNAP_MS } from "./netplay"
import { createScene } from "./scene"
import { drawBanner, drawHud, layout as hudLayout, minSize, pal } from "./pixels"
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

// 8-bit sounds (the chip voices in utils/gameSynth.js)
const createSounds = () => {
  const s = createSynth({ gain: 0.6 })
  return {
    setEnabled: s.setEnabled,
    hit: (power = 0.6) => s.play(({ chipNoise, tri }) => (chipNoise({ len: 0.08, vol: 0.3 + power * 0.25, pitch: 0.55 + power * 0.25 }), tri(150 + power * 60, { len: 0.12, to: 60, vol: 0.35 }))),
    pole: () => s.play(({ pulse }) => (pulse(831, { len: 0.45, duty: 0.125, vol: 0.07, curve: 0.6 }), pulse(1245, { len: 0.3, duty: 0.25, vol: 0.04 }))),
    whiff: () => s.play(({ chipNoise }) => chipNoise({ len: 0.16, vol: 0.12, pitch: 0.3, toPitch: 0.8 })),
    game: (won) => s.play(({ jingle }) => jingle(won ? [[67, 1], [72, 1], [76, 1], [79, 3]] : [[67, 2], [64, 2], [60, 4]], { frames: 6, duty: 0.5, vol: 0.08 })),
    match: (won) =>
      s.play(({ jingle }) => {
        jingle(won ? [[60, 1], [64, 1], [67, 1], [72, 2], [76, 1], [79, 1], [84, 5]] : [[72, 2], [67, 2], [63, 2], [60, 6]], { frames: 6, duty: 0.5, vol: 0.08 })
        jingle(won ? [[48, 3], [55, 3], [48, 6]] : [[48, 6], [43, 6]], { frames: 6, voice: "tri", vol: 0.15 })
      }),
    rope: () => s.play(({ chipNoise }) => chipNoise({ len: 0.05, vol: 0.06, pitch: 0.95, short: true })),
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

// ---- the court: the low-resolution 3D view, the pixel HUD over it, the controls ----
// hud(m) -> what the HUD shows (pixels.js drawHud); children: panels over the court
const Court = ({ seat, onSwing, paused, onFrame, hud, onPause, status, children }) => {
  const viewRef = useRef(null)
  const glRef = useRef(null)
  const ptr = useRef(null)
  const key = useRef(null)
  const lastM = useRef(null)
  const pauseDown = useRef(false)
  const hudRef = useRef(hud)
  hudRef.current = hud
  const [error, setError] = useState(null)
  const Lref = useRef(null)
  const scr = useRetroScreen({
    layout: minSize,
    palette: pal,
    transparent: true,
    render: (b, fit) => {
      const L = Lref.current
      if (!L || L.W !== fit.w || L.H !== fit.h) return b.data.fill(0)
      drawHud(b, L, { ...hudRef.current(lastM.current), pressed: pauseDown.current ? "pause" : null, noPause: !onPause })
    },
  })
  const L = useMemo(() => (scr.fit ? hudLayout(scr.fit.w, scr.fit.h) : null), [scr.fit])
  Lref.current = L
  useLayoutEffect(() => {
    let view
    try {
      view = createScene(glRef.current, { seat })
    } catch {
      setError("This device can't draw 3D (WebGL) right now.")
      return
    }
    viewRef.current = view
    return () => {
      view.dispose()
      viewRef.current = null
    }
  }, [seat])
  // the 3D view draws at the same low resolution as the HUD
  useLayoutEffect(() => {
    if (scr.fit && viewRef.current) viewRef.current.resize(scr.fit.w, scr.fit.h)
  }, [scr.fit, seat])
  useEffect(() => scr.paint())

  useGameLoop((dt, now) => {
    const m = onFrame(dt, now)
    if (m) {
      lastM.current = m
      viewRef.current?.draw(m, dt, { now })
    }
    scr.paint()
  }, !paused)

  // swipes and taps
  const onDown = (e) => {
    if (paused || e.target.closest?.("button")) return
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
      if (!glRef.current?.closest(".qgRoot")?.contains(document.activeElement) && document.activeElement !== document.body) return
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
    <RetroStage screen={scr} className="qgStage tbStage tbCourt" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <canvas ref={glRef} className="tbCanvas" aria-hidden="true" />
      {L && onPause && (
        <Hit
          as="button"
          {...L.pause}
          className="qgPauseBtn tbPause"
          aria-label="Pause"
          title="Pause (P)"
          onPointerDown={() => ((pauseDown.current = true), scr.paint())}
          onPointerUp={() => ((pauseDown.current = false), scr.paint())}
          onPointerLeave={() => ((pauseDown.current = false), scr.paint())}
          onClick={onPause}
        />
      )}
      <div className="rtSr" aria-live="polite">
        {status}
      </div>
      {error && (
        <RetroPanel title="Tetherball">
          <PixelText text={error} wrap={140} />
          <Sr>{error}</Sr>
        </RetroPanel>
      )}
      {children}
    </RetroStage>
  )
}

// what React shows (panels, the screen-reader line) changes only with these; the HUD canvas and
// the 3D view read the match every frame
const matchSig = (m) => `${m.phase}|${m.games}|${m.server}|${m.gameWinner}|${m.rally === 0}|${m.winner}`

// what the HUD shows for a match (or a guest's mirror)
const hudFor = (m, { seat, names, target, ball, hint }) => {
  if (!m) return { names, games: [0, 0], target }
  const b = ball || m.ball
  const w = b ? wraps(b) : 0
  let banner = null
  let big = null
  if (m.phase === "serve") banner = m.server === seat ? "Your serve: swipe or tap!" : `${names[m.server]} serves...`
  if (m.phase === "point" && m.gameWinner != null) big = m.gameWinner === seat ? "You win the game!" : `${names[m.gameWinner]} wins the game`
  return { wraps: w / MAX_WRAPS, turns: w, names, games: m.games, target, banner, big, bigWin: m.gameWinner === seat, hint }
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
  const sigRef = useRef("")
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
      const sg = matchSig(m)
      if (sg !== sigRef.current) {
        sigRef.current = sg
        setTick((t) => (t + 1) % 1e9)
      }
      return m
    }
    m.step(dt)
    handleEvents(m.takeEvents())
    const sg = matchSig(m.view)
    if (sg !== sigRef.current) {
      sigRef.current = sg
      setTick((t) => (t + 1) % 1e9)
    }
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
  const status = v ? hudFor(v, { seat, names, target }) : null
  return (
    <div className="tbPlay">
      {playing ? (
        <Court seat={seat} onSwing={onSwing} paused={false} onFrame={onFrame} status={status?.banner || status?.big || ""} hud={() => (v ? hudFor(v, { seat, names, target, ball: host ? v.ball : m.shown() }) : { names, games: [0, 0], target })} />
      ) : (
        <div className="qgStage tbStage tbIdle" />
      )}
      {room.phase === "over" && (
        <RetroPanel title="Match over" data-online-over>
          <OnlineResultBar online={online} />
        </RetroPanel>
      )}
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

  const soloSig = useRef("")
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
      const sg = matchSig(match)
      if (sg !== soloSig.current) {
        soloSig.current = sg
        setTick((t) => (t + 1) % 1e9)
      }
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
        title={<RetroBanner className="tbBanner" palette={pal} minW={220} minH={92} aspect={2.4} paused={paused} label="Tetherball: wind it all the way round" draw={(b, t) => drawBanner(b, t, { reduced: reducedMotion() })} />}
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

  const names = ["You", "CPU"]
  let body = title
  if (screen === "online") body = <OnlineMatch online={online} sounds={sounds} onBack={() => setScreen("title")} onRecord={record} />
  else if (screen === "play" && m) {
    const hint = m.phase === "play" && m.rally === 0 && !hold ? (mobile ? "Swipe across when the ball comes to you (faster = harder, upward = higher), or tap" : "Space when the ball comes round (hold for harder; Up/Down for high/low), or swipe with the mouse") : null
    const st = hudFor(m, { seat: 0, names, target: m.target })
    body = (
      <div className="tbPlay">
        <Court seat={0} onSwing={onSwing} paused={false} onFrame={onFrame} onPause={() => setHold(true)} status={[st.banner, st.big, hint].filter(Boolean).join(". ")} hud={(mm) => hudFor(mm || m, { seat: 0, names, target: m.target, hint })}>
          {hold && !over && <RetroPaused onResume={() => (setHold(false), rootRef.current?.focus({ preventScroll: true }))} onQuit={toTitle} />}
          {over && (
            <RetroPanel
              title={over.won ? "You win!" : "The computer wins"}
              data-over={over.won ? "won" : "lost"}
              buttons={
                <>
                  <PixelButton label="Play Again" big autoFocus data-again onClick={() => start(prefs.level)} />
                  <PixelButton label="Title Screen" onClick={toTitle} />
                </>
              }
            >
              <PixelText text={`${over.games[0]} - ${over.games[1]}`} scale={3} color="#000080" />
              <p className="qgFinal rtSr">
                {over.games[0]} - {over.games[1]}
              </p>
              <PixelText text={`${M.LEVELS[over.level]?.name || ""} · won ${wins[over.level] || 0} of ${played[over.level] || 0}`} color="#404040" />
            </RetroPanel>
          )}
        </Court>
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
