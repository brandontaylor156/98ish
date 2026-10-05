import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import GameStart from "../../shared/GameStart"
import PlayOnline, { OnlineResultBar, useOnlineRoom } from "../../shared/online"
import { Check, HowToDialog, QuickGameRoot, ScoresDialog, TitleScreen, useAutoPause, useGameLoop } from "../../shared/quickgame"
import { Hit, PixelButton, PixelLed, PixelP, PixelScores, RetroBanner, RetroPanel, RetroPaused, RetroStage, useRetroScreen } from "../../shared/retro"
import { unlock } from "../../../utils/achievements"
import { helpItem } from "../../../utils/help"
import { reducedMotion } from "../../../utils/settings"
import { createScores, fmtNum } from "../../../utils/gameKit"
import * as R from "./rules"
import { drawBanner, drawBoard, layout, minSize, pal } from "./pixels"
import { createSounds } from "./sounds"
import "./ColorMatch.css"

// Color Match: does the left word's MEANING match the right word's INK? Yes or No, against the
// clock, with a streak multiplier. Swatch mode: tap the swatch the word names. Online: the same
// questions for everyone (one seed), best score wins (server/arcade/games/colormatch.js; the
// rules are in rules.js, shared with the server). The board is a 256-colour pixel picture
// (pixels.js) with invisible buttons laid over it.

const ICON = "/assets/program_icons/colormatch.svg"
const store = createScores("98ish.colormatch", { defaults: { sound: true, seconds: 60, mode: "classic" } })
const NAME = Object.fromEntries(R.COLORS.map((c) => [c.id, c.name]))
const MODE_LABEL = { classic: "Classic", swatch: "Swatch" }
const keyOf = (mode, seconds) => `${mode}${seconds}`

// ---- the play field: the pixel board, the buttons over it, panels on top ----
// standings: [{ name, score, bot, you }] online; onPause: solo only. live() gives the clock
// every frame (the board paints itself; React renders only when the second changes)
const Field = ({ mode, seed, run, left, total, countdown, flash, standings, onAnswer, onPause, hidden, mobile, live, animate = false, children }) => {
  const showBoard = countdown <= 0 && !hidden
  const q = showBoard ? R.questionAt(seed, run.i, mode) : null
  const tiles = mode === "swatch" ? R.tilesFor(run.i) : 0
  const pressed = useRef(null)
  const state = { mode, q, run, left, total, countdown, flash, standings, paused: hidden, keys: !mobile, onPause: onPause ? true : false }
  const stateRef = useRef(state)
  stateRef.current = state
  const liveRef = useRef(live)
  liveRef.current = live
  const Lref = useRef(null)
  const scr = useRetroScreen({
    layout: minSize,
    palette: pal,
    render: (b, fit) => {
      const L = Lref.current
      if (!L || L.W !== fit.w || L.H !== fit.h) return
      const now = performance.now()
      drawBoard(b, L, { ...stateRef.current, ...(liveRef.current?.() || {}), t: now / 1000, now, pressed: pressed.current, reduced: reducedMotion() })
    },
  })
  const L = useMemo(() => (scr.fit ? layout(scr.fit.w, scr.fit.h, { mode, tiles, online: !!standings }) : null), [scr.fit, mode, tiles, !!standings])
  Lref.current = L
  useEffect(() => scr.paint())
  useGameLoop(() => scr.paint(), animate)
  const press = (id) => ({
    onPointerDown: () => ((pressed.current = id), scr.paint()),
    onPointerUp: () => ((pressed.current = null), scr.paint()),
    onPointerLeave: () => ((pressed.current = null), scr.paint()),
    onPointerCancel: () => ((pressed.current = null), scr.paint()),
  })
  const mult = R.multFor(run.streak)
  return (
    <RetroStage screen={scr} className="qgStage cmStage">
      {L && (
        <>
          {showBoard && q && (
            <div className={`cmBoard${mode === "swatch" ? " is-swatch" : ""}`} data-q={run.i}>
              {mode === "swatch" ? (
                <>
                  <span className="rtSr" data-word={q.word} data-ink={q.ink}>
                    The word says {NAME[q.word]}, printed in {q.ink}.
                  </span>
                  {q.tiles.map((c, i) =>
                    L.tiles[i] ? <Hit key={`${run.i}-${i}`} as="button" {...L.tiles[i]} className="cmTile" data-tile={i} data-color={c} aria-label={`${c} (${i + 1})`} onClick={() => onAnswer(i)} {...press(`tile${i}`)} /> : null,
                  )}
                </>
              ) : (
                <>
                  <span className="rtSr" data-left={q.left.word}>
                    Meaning: {NAME[q.left.word]}.
                  </span>
                  <span className="rtSr" data-right-ink={q.right.ink}>
                    Ink: the word {NAME[q.right.word]} printed in {q.right.ink}.
                  </span>
                  <Hit as="button" {...L.answers.no} className="cmNo" data-answer="no" aria-label="No" onClick={() => onAnswer(false)} {...press("no")} />
                  <Hit as="button" {...L.answers.yes} className="cmYes" data-answer="yes" aria-label="Yes" onClick={() => onAnswer(true)} {...press("yes")} />
                </>
              )}
            </div>
          )}
          {onPause && countdown <= 0 && !hidden && <Hit as="button" {...L.pause} className="qgPauseBtn cmPause" onClick={onPause} aria-label="Pause" title="Pause (P)" {...press("pause")} />}
          <div className="rtSr" aria-live="polite">
            {countdown > 0 && <span data-countdown>{Math.ceil(countdown)}</span>}
            <span data-score={run.score}>Score {run.score}</span> <span className="cmMult" data-mult={mult}>times {mult}</span> <span>{Math.ceil(left)} seconds left</span>
          </div>
          {standings && (
            <div className="cmStandings rtSr">
              {standings.map((p) => (
                <span key={p.seat} className={p.you ? "is-you" : ""}>
                  {p.name}
                  {p.bot ? " (computer)" : ""}: <b>{fmtNum(p.score)}</b>{" "}
                </span>
              ))}
            </div>
          )}
        </>
      )}
      {children}
    </RetroStage>
  )
}

const keyChoice = (e, mode, tiles) => {
  if (mode === "swatch") {
    const n = Number(e.key)
    return n >= 1 && n <= tiles ? n - 1 : null
  }
  if (e.key === "ArrowRight" || e.key === "j" || e.key === "J") return true
  if (e.key === "ArrowLeft" || e.key === "f" || e.key === "F") return false
  return null
}

// ---- online ----
const OnlineGame = ({ online, sounds, mobile, paused, onBack, onRecord }) => {
  const { room, view } = online
  const [local, setLocal] = useState(null) // my run, answered ahead of the server
  const [flash, setFlash] = useState(null)
  const [, setNow] = useState(0)
  const you = room?.you
  const server = view && you != null ? view.players[you] : null
  const recorded = useRef(null)
  useEffect(() => setLocal(null), [room?.round])
  // the server's word is final once it has caught up
  const run = local && server && local.i > server.i ? local : server ? { ...R.newRun(), ...server } : R.newRun()
  const now = online.serverNow()
  const playing = view && room.phase === "playing" && now >= view.goAt && now < view.endsAt
  useGameLoop(() => setNow(performance.now()), !!view && room.phase === "playing")
  useEffect(() => {
    if (room?.phase === "over" && view && recorded.current !== room.round && server) {
      recorded.current = room.round
      const won = room.result?.winners?.includes(you) && view.players.some((p, i) => i !== you && !p.bot)
      onRecord({ mode: view.mode, seconds: view.seconds, run: server, won, online: true })
    }
  }, [room?.phase])
  const answer = (choice) => {
    if (!playing || you == null) return
    const r = R.answer(run, view.seed, view.mode, choice)
    setLocal(r.run)
    const level = r.right && R.multFor(r.run.streak) > r.mult
    setFlash({ right: r.right, n: r.run.i, at: performance.now(), level })
    if (r.right) {
      sounds.right(r.mult)
      if (level) sounds.level()
    } else sounds.wrong()
    online.act({ type: "answer", i: run.i, choice })
  }
  useEffect(() => {
    const onKey = (e) => {
      // keys while this window is the active one (focus may be on the page after a button went away)
      if (!view || paused || (document.activeElement !== document.body && !e.target.closest?.(".cmRoot"))) return
      const tiles = view.mode === "swatch" ? R.tilesFor(run.i) : 0
      const c = keyChoice(e, view.mode, tiles)
      if (c === null) return
      e.preventDefault()
      answer(c)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (!room || (room.phase !== "playing" && room.phase !== "over") || !view) {
    return (
      <div className="cmOnline">
        <PlayOnline
          online={online}
          title="Color Match"
          icon={ICON}
          blurb="Everyone gets the same questions; best score when the clock runs out wins. Quick Match finds someone (or a computer player); a private room gets a code to share."
          defaultSettings={{ mode: "classic", seconds: 60, players: 4 }}
          quickSettings
          computer
          onBack={room ? null : onBack}
          renderSettings={(s, set, { disabled }) => (
            <div className="cmSettings">
              <label className="qgOptionRow">
                Game:
                <select disabled={disabled} value={s.mode || "classic"} onChange={(e) => set({ ...s, mode: e.target.value })}>
                  <option value="classic">Classic (meaning vs. ink)</option>
                  <option value="swatch">Swatch (tap the color)</option>
                </select>
              </label>
              <label className="qgOptionRow">
                Time:
                <select disabled={disabled} value={s.seconds || 60} onChange={(e) => set({ ...s, seconds: Number(e.target.value) })}>
                  {R.SECONDS.map((n) => (
                    <option key={n} value={n}>
                      {n} seconds
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        />
      </div>
    )
  }
  const left = Math.max(0, (view.endsAt - now) / 1000)
  const countdown = now < view.goAt ? (view.goAt - now) / 1000 : 0
  const standings = view.players.map((p, i) => ({ ...p, seat: i, you: i === you, score: i === you ? run.score : p.score })).sort((a, b) => b.score - a.score)
  return (
    <div className="cmPlay">
      <Field mode={view.mode} seed={view.seed} run={run} left={left} total={view.seconds} countdown={countdown} flash={flash} standings={standings} onAnswer={answer} hidden={room.phase !== "playing"} mobile={mobile}>
        {room.phase === "over" && (
          <RetroPanel title="Time's up!" data-online-over wide>
            <PixelLed text={String(run.score)} />
            <p className="qgFinal rtSr">{fmtNum(run.score)}</p>
            <PixelP text={`${run.right} right · ${run.wrong} wrong · best streak ${run.best}`} />
            <OnlineResultBar online={online} />
          </RetroPanel>
        )}
      </Field>
    </div>
  )
}

// ---- the window ----
const ColorMatch = ({ mobile = false, paused = false, onClose }) => {
  const chatItem = useGameChatMenuItem("colormatch")
  const sounds = useMemo(() => createSounds(), [])
  const [data, setData] = useState(store.load)
  const prefs = data.prefs
  const [screen, setScreen] = useState("title") // title | play | online
  const [game, setGame] = useState(null) // { mode, seconds, seed, run, left, countdown, over }
  const gameRef = useRef(null)
  const [hold, setHold] = useState(false)
  const [flash, setFlash] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [last, setLast] = useState(null)
  const rootRef = useRef(null)
  const online = useOnlineRoom("colormatch")

  useEffect(() => {
    sounds.setEnabled(prefs.sound)
  }, [prefs.sound])
  const setPref = (patch) => setData(store.setPrefs(patch))
  const update = (g) => {
    gameRef.current = g
    setGame(g)
  }

  // an invitation or a join link: straight to the room
  useEffect(() => {
    if (online.room && screen !== "online") setScreen("online")
  }, [online.room?.id])
  // a game starting online: keys go to this window
  useEffect(() => {
    if (online.room?.phase === "playing") rootRef.current?.focus({ preventScroll: true })
  }, [online.room?.phase, online.room?.round])

  const record = ({ mode, seconds, run, won, online: wasOnline }) => {
    const rec = store.record(keyOf(mode, seconds), { score: run.score, note: `${run.right} right, ${R.accuracy(run)}%` })
    setData(rec.data)
    if (R.multFor(run.best) >= R.MAX_MULT) unlock("colormatch-x5")
    if (mode === "classic" && seconds === 60 && run.score >= 2000) unlock("colormatch-2000")
    if (wasOnline && won) unlock("colormatch-online")
    setLast({ mode, seconds, run, best: rec.best, online: wasOnline })
    setTimeout(() => (rec.best && run.score > 0 ? sounds.best() : sounds.over()), 200)
    return rec
  }

  const start = (mode = prefs.mode, seconds = prefs.seconds) => {
    setPref({ mode, seconds })
    update({ mode, seconds, seed: Math.floor(Math.random() * 2 ** 31), run: R.newRun(), left: seconds, countdown: 3, over: false })
    setHold(false)
    setFlash(null)
    setScreen("play")
    setTimeout(() => rootRef.current?.focus({ preventScroll: true }), 0)
  }
  const toTitle = () => {
    if (online.room) online.leave()
    update(null)
    setHold(false)
    setScreen("title")
  }

  const running = screen === "play" && game && !game.over && !hold && !dialog
  useAutoPause(paused, () => gameRef.current && !gameRef.current.over && setHold(true))
  // the clock: React hears about it once a second (the board paints the rest from live())
  useGameLoop((dt) => {
    const g = gameRef.current
    if (!g || g.over) return
    if (g.countdown > 0) {
      const c = Math.max(0, g.countdown - dt)
      const next = { ...g, countdown: c }
      if (Math.ceil(c) !== Math.ceil(g.countdown)) {
        sounds.count(Math.ceil(c))
        return update(next)
      }
      gameRef.current = next
      return
    }
    const left = g.left - dt
    if (left <= 5 && Math.ceil(left) !== Math.ceil(g.left) && left > 0) sounds.tick()
    if (left <= 0) {
      const rec = record({ mode: g.mode, seconds: g.seconds, run: g.run })
      return update({ ...g, left: 0, over: true, best: rec.best, place: rec.place })
    }
    const next = { ...g, left }
    if (Math.ceil(left) !== Math.ceil(g.left)) update(next)
    else gameRef.current = next
  }, running)

  const answer = (choice) => {
    const g = gameRef.current
    if (!g || g.over || hold || g.countdown > 0) return
    const r = R.answer(g.run, g.seed, g.mode, choice)
    const level = r.right && R.multFor(r.run.streak) > r.mult
    setFlash({ right: r.right, n: r.run.i, at: performance.now(), level })
    if (r.right) {
      sounds.right(r.mult)
      if (level) sounds.level()
    } else sounds.wrong()
    update({ ...g, run: r.run })
  }

  const onKeyDown = (e) => {
    if (screen !== "play" || !gameRef.current) return
    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      e.preventDefault()
      if (!gameRef.current.over) setHold((h) => !h)
      return
    }
    if (!running || e.repeat) return
    const g = gameRef.current
    const c = keyChoice(e, g.mode, g.mode === "swatch" ? R.tilesFor(g.run.i) : 0)
    if (c === null) return
    e.preventDefault()
    answer(c)
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__colormatch = { state: () => gameRef.current, question: () => gameRef.current && R.questionAt(gameRef.current.seed, gameRef.current.run.i, gameRef.current.mode), rules: R }
    return () => delete window.__colormatch
  }, [])

  const menus = [
    {
      label: "Game",
      items: [
        { label: "Classic", onClick: () => start("classic") },
        { label: "Swatch", onClick: () => start("swatch") },
        { label: "Play Online...", onClick: () => (update(null), setScreen("online")) },
        "-",
        ...R.SECONDS.map((n) => ({ label: `${n} Seconds`, checked: prefs.seconds === n, onClick: () => setPref({ seconds: n }) })),
        "-",
        { label: "High Scores...", onClick: () => setDialog("scores") },
        { label: "Title Screen", onClick: toTitle },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    { label: "Options", items: [{ label: "Sound", checked: prefs.sound, onClick: () => setPref({ sound: !prefs.sound }) }, chatItem] },
    { label: "Help", items: [helpItem({ program: "Color Match" }), "-", { label: "How to Play...", onClick: () => setDialog("howto") }] },
  ]

  const other = prefs.mode === "classic" ? "swatch" : "classic"
  const title = (
    <TitleScreen>
      <GameStart
        id="colormatch"
        title={<RetroBanner className="cmBanner" palette={pal} minW={220} minH={92} aspect={2.4} paused={paused} label="Color Match: read the word, trust the ink" draw={(b, t) => drawBanner(b, t, { reduced: reducedMotion() })} />}
        play={{
          label: last && !last.online ? `${MODE_LABEL[prefs.mode]} again` : "Play",
          sub: `${MODE_LABEL[prefs.mode]} · ${prefs.seconds} seconds · Best: ${fmtNum(store.best(data, keyOf(prefs.mode, prefs.seconds)))}`,
          onClick: () => start(),
          autoFocus: true,
          "data-play": true,
        }}
        online={{ onClick: () => setScreen("online"), sub: "Same questions, best score in 60 seconds" }}
        modes={[
          { key: other, label: MODE_LABEL[other], sub: other === "swatch" ? "Tap the swatch the word names" : "Meaning vs. ink: Yes or No", onClick: () => start(other), "data-mode": other },
          { key: "scores", label: "High Scores...", sub: "Every mode and length", onClick: () => setDialog("scores") },
        ]}
        optionsSummary={`${prefs.seconds} seconds · Sound ${prefs.sound ? "on" : "off"}`}
        options={
          <>
            <label className="qgOptionRow">
              Length:
              <select value={prefs.seconds} onChange={(e) => setPref({ seconds: Number(e.target.value) })}>
                {R.SECONDS.map((n) => (
                  <option key={n} value={n}>
                    {n} seconds
                  </option>
                ))}
              </select>
            </label>
            <Check id="cm-opt1" checked={prefs.sound} onChange={() => setPref({ sound: !prefs.sound })}>
              Sound
            </Check>
          </>
        }
      >
        {last && (
          <fieldset className="qgResult">
            <legend>
              {MODE_LABEL[last.mode]}, {last.seconds} s{last.online ? " online" : ""}
            </legend>
            Score <b>{fmtNum(last.run.score)}</b> · {last.run.right} right · {R.accuracy(last.run)}%{last.best && <span className="qgNewBest"> New best!</span>}
          </fieldset>
        )}
      </GameStart>
    </TitleScreen>
  )

  let body = title
  if (screen === "online") body = <OnlineGame online={online} sounds={sounds} mobile={mobile} paused={paused} onBack={() => setScreen("title")} onRecord={record} />
  else if (screen === "play" && game) {
    body = (
      <div className="cmPlay">
        <Field
          mode={game.mode}
          seed={game.seed}
          run={game.run}
          left={game.left}
          total={game.seconds}
          countdown={game.countdown}
          flash={flash}
          onAnswer={answer}
          onPause={() => setHold(true)}
          hidden={(hold && !game.over) || game.over}
          mobile={mobile}
          live={() => (gameRef.current ? { left: gameRef.current.left, countdown: gameRef.current.countdown } : {})}
          animate={!hold && !dialog}
        >
          {hold && !game.over && <RetroPaused onResume={() => (setHold(false), rootRef.current?.focus({ preventScroll: true }))} onQuit={toTitle} />}
          {game.over && (
            <RetroPanel
              title="Time's up!"
              data-over
              wide
              buttons={
                <>
                  <PixelButton label="Play Again" big autoFocus data-again onClick={() => start(game.mode, game.seconds)} />
                  <PixelButton label="Title Screen" onClick={toTitle} />
                </>
              }
            >
              <PixelLed text={String(game.run.score)} />
              <p className="qgFinal rtSr">{fmtNum(game.run.score)}</p>
              <PixelP text={`${game.run.right} right · ${game.run.wrong} wrong · ${R.accuracy(game.run)}% · best streak ${game.run.best}`} />
              {game.best && <PixelP className="qgNewBest cmNewBest" text="NEW BEST SCORE!" color="#c00000" />}
              <PixelScores rows={data.scores[keyOf(game.mode, game.seconds)] || []} mark={game.place ?? -1} />
            </RetroPanel>
          )}
        </Field>
      </div>
    )
  }

  return (
    <QuickGameRoot ref={rootRef} className="cmRoot" mobile={mobile} onKeyDown={onKeyDown} data-screen={screen}>
      <MenuBar menus={menus} />
      <GameChat game="colormatch" title="Color Match" room={online.chatRoom} />
      {body}
      {dialog === "scores" && (
        <ScoresDialog
          title="Color Match High Scores"
          onClose={() => setDialog(null)}
          tables={R.MODES.flatMap((m) => R.SECONDS.map((n) => ({ label: `${MODE_LABEL[m]}, ${n} seconds`, rows: data.scores[keyOf(m, n)] })))}
        />
      )}
      {dialog === "howto" && (
        <HowToDialog title="How to Play Color Match" onClose={() => setDialog(null)}>
          <p>
            <b>Classic:</b> does the MEANING of the left word match the INK COLOR of the right word? Ignore what the right word says and what color the left word is printed in!
          </p>
          <p>
            <b>Swatch:</b> tap the swatch whose color the word names (not the color it's printed in).
          </p>
          <ul>
            <li>Each right answer scores 50 times your multiplier.</li>
            <li>Every 4 right in a row raises the multiplier by one, up to x5. A wrong answer drops it back to x1.</li>
            <li>Keys: Right arrow or J = Yes, Left arrow or F = No; in Swatch, 1-9 pick a swatch. P pauses.</li>
          </ul>
          <p>
            <b>Play Online</b>: everyone gets the same questions; the best score when time runs out wins.
          </p>
        </HowToDialog>
      )}
    </QuickGameRoot>
  )
}

export default ColorMatch
