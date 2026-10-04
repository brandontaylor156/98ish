import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import GameStart from "../../shared/GameStart"
import PlayOnline, { OnlineResultBar, useOnlineRoom } from "../../shared/online"
import { Check, HowToDialog, PausedPanel, QuickGameRoot, ScoresDialog, TitleScreen, useAutoPause, useGameLoop } from "../../shared/quickgame"
import { unlock } from "../../../utils/achievements"
import { helpItem } from "../../../utils/help"
import { createScores, fmtNum, fmtTime } from "../../../utils/gameKit"
import * as R from "./rules"
import { createSounds } from "./sounds"
import "./ColorMatch.css"

// Color Match: does the left word's MEANING match the right word's INK? Yes or No, against the
// clock, with a streak multiplier. Swatch mode: tap the swatch the word names. Online: the same
// questions for everyone (one seed), best score wins (server/arcade/games/colormatch.js; the
// rules are in rules.js, shared with the server).

const ICON = "/assets/program_icons/colormatch.svg"
const store = createScores("98ish.colormatch", { defaults: { sound: true, seconds: 60, mode: "classic" } })
const HEX = Object.fromEntries(R.COLORS.map((c) => [c.id, c.hex]))
const NAME = Object.fromEntries(R.COLORS.map((c) => [c.id, c.name]))
const MODE_LABEL = { classic: "Classic", swatch: "Swatch" }
const keyOf = (mode, seconds) => `${mode}${seconds}`

// ---- the board: one question at a time (solo and online) ----
const Board = ({ mode, seed, run, onAnswer, flash, mobile }) => {
  const q = R.questionAt(seed, run.i, mode)
  if (mode === "swatch") {
    const cols = q.tiles.length === 4 ? 2 : 3
    return (
      <div className="cmBoard is-swatch" data-q={run.i}>
        <div className="cmPrompt">
          <span className="cmQ">Tap the color this word says:</span>
          <div className="cmCard cmWordCard">
            <span className="cmWord" style={{ color: HEX[q.ink] }} data-word={q.word} data-ink={q.ink}>
              {NAME[q.word]}
            </span>
          </div>
        </div>
        <div className="cmTiles" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {q.tiles.map((c, i) => (
            <button key={`${run.i}-${i}`} type="button" className="cmTile" data-tile={i} data-color={c} style={{ background: HEX[c] }} onClick={() => onAnswer(i)} aria-label={c}>
              {!mobile && <span className="cmTileKey">{i + 1}</span>}
            </button>
          ))}
        </div>
        {flash && <div className={`cmFlash ${flash.right ? "is-right" : "is-wrong"}`} key={flash.n} />}
      </div>
    )
  }
  return (
    <div className="cmBoard" data-q={run.i}>
      <span className="cmQ">Does the MEANING on the left match the INK COLOR on the right?</span>
      <div className="cmCards">
        <div className="cmCardCol">
          <span className="cmCardLabel">meaning</span>
          <div className="cmCard">
            <span className="cmWord" style={{ color: HEX[q.left.ink] }} data-left={q.left.word}>
              {NAME[q.left.word]}
            </span>
          </div>
        </div>
        <div className="cmCardCol">
          <span className="cmCardLabel">ink color</span>
          <div className="cmCard">
            <span className="cmWord" style={{ color: HEX[q.right.ink] }} data-right-ink={q.right.ink}>
              {NAME[q.right.word]}
            </span>
          </div>
        </div>
      </div>
      <div className="cmAnswers">
        <button type="button" className="cmNo" onClick={() => onAnswer(false)} data-answer="no">
          <span className="cmBig">✗ No</span>
          {!mobile && <small>Left arrow / F</small>}
        </button>
        <button type="button" className="cmYes" onClick={() => onAnswer(true)} data-answer="yes">
          <span className="cmBig">✓ Yes</span>
          {!mobile && <small>Right arrow / J</small>}
        </button>
      </div>
      {flash && <div className={`cmFlash ${flash.right ? "is-right" : "is-wrong"}`} key={flash.n} />}
    </div>
  )
}

const Meter = ({ run, left, total }) => {
  const mult = R.multFor(run.streak)
  const pips = mult >= R.MAX_MULT ? 4 : run.streak % 4
  return (
    <div className="qgHud cmHud">
      <div className="qgCounter">
        <span className="qgLabel">Score</span>
        <span className="qgNum" data-score={run.score}>
          {fmtNum(run.score)}
        </span>
      </div>
      <div className="cmMult" data-mult={mult}>
        <b>x{mult}</b>
        <span className="cmPips">
          {[0, 1, 2, 3].map((k) => (
            <i key={k} className={k < pips ? "is-on" : ""} />
          ))}
        </span>
      </div>
      <div className={`qgCounter cmTime${left <= 5 ? " is-low" : ""}`}>
        <span className="qgLabel">Time</span>
        <span className="qgNum">{fmtTime(left)}</span>
      </div>
      <div className="cmTimeBar">
        <div style={{ width: `${Math.max(0, Math.min(1, left / total)) * 100}%` }} />
      </div>
    </div>
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
    setFlash({ right: r.right, n: r.run.i })
    if (r.right) {
      sounds.right(r.mult)
      if (R.multFor(r.run.streak) > r.mult) sounds.level()
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
  const countdown = now < view.goAt ? Math.ceil((view.goAt - now) / 1000) : 0
  const standings = view.players.map((p, i) => ({ ...p, seat: i, score: i === you ? run.score : p.score })).sort((a, b) => b.score - a.score)
  return (
    <div className="cmPlay">
      <Meter run={run} left={left} total={view.seconds} />
      <div className="cmStandings">
        {standings.map((p) => (
          <span key={p.seat} className={p.seat === you ? "is-you" : ""}>
            {p.name}
            {p.bot ? " (computer)" : ""}: <b>{fmtNum(p.score)}</b>
          </span>
        ))}
      </div>
      <div className="qgStage cmStage">
        {countdown > 0 ? <div className="cmCountdown">{countdown}</div> : room.phase === "playing" ? <Board mode={view.mode} seed={view.seed} run={run} onAnswer={answer} flash={flash} mobile={mobile} /> : null}
        {room.phase === "over" && (
          <div className="qgOverlay">
            <div className="qgPanel window">
              <div className="title-bar">
                <div className="title-bar-text">Time's up!</div>
              </div>
              <div className="window-body qgPanelBody">
                <p className="qgFinal">{fmtNum(run.score)}</p>
                <p>
                  {run.right} right · {run.wrong} wrong · best streak {run.best}
                </p>
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
  useGameLoop((dt) => {
    const g = gameRef.current
    if (!g || g.over) return
    if (g.countdown > 0) {
      const c = g.countdown - dt
      if (Math.ceil(c) !== Math.ceil(g.countdown)) sounds.count(Math.max(0, Math.ceil(c)))
      return update({ ...g, countdown: Math.max(0, c) })
    }
    const left = g.left - dt
    if (left <= 5 && Math.ceil(left) !== Math.ceil(g.left) && left > 0) sounds.tick()
    if (left <= 0) {
      const rec = record({ mode: g.mode, seconds: g.seconds, run: g.run })
      return update({ ...g, left: 0, over: true, best: rec.best })
    }
    update({ ...g, left })
  }, running)

  const answer = (choice) => {
    const g = gameRef.current
    if (!g || g.over || hold || g.countdown > 0) return
    const r = R.answer(g.run, g.seed, g.mode, choice)
    setFlash({ right: r.right, n: r.run.i })
    if (r.right) {
      sounds.right(r.mult)
      if (R.multFor(r.run.streak) > r.mult) sounds.level()
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
        title={
          <div className="qgLogo">
            <div className="qgLogoText cmLogo">
              <span style={{ color: HEX.red }}>C</span>
              <span style={{ color: HEX.blue }}>O</span>
              <span style={{ color: HEX.green }}>L</span>
              <span style={{ color: HEX.yellow }}>O</span>
              <span style={{ color: HEX.purple }}>R</span> <span style={{ color: HEX.orange }}>MATCH</span>
            </div>
            <div className="qgTagline">Read the word. Trust the ink. Beat the clock.</div>
          </div>
        }
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
        <Meter run={game.run} left={game.left} total={game.seconds} />
        <div className="qgStage cmStage">
          {hold && !game.over ? null : game.countdown > 0 ? (
            <div className="cmCountdown" data-countdown>
              {Math.ceil(game.countdown)}
            </div>
          ) : (
            !game.over && <Board mode={game.mode} seed={game.seed} run={game.run} onAnswer={answer} flash={flash} mobile={mobile} />
          )}
          {!game.over && game.countdown <= 0 && (
            <button type="button" className="qgPauseBtn cmPause" onClick={() => setHold(true)} aria-label="Pause" title="Pause (P)">
              ||
            </button>
          )}
          {hold && !game.over && <PausedPanel onResume={() => (setHold(false), rootRef.current?.focus({ preventScroll: true }))} onQuit={toTitle} />}
          {game.over && (
            <div className="qgOverlay" data-over>
              <div className="qgPanel window">
                <div className="title-bar">
                  <div className="title-bar-text">Time's up!</div>
                </div>
                <div className="window-body qgPanelBody">
                  <p className="qgFinal">{fmtNum(game.run.score)}</p>
                  <p>
                    {game.run.right} right · {game.run.wrong} wrong · {R.accuracy(game.run)}% · best streak {game.run.best}
                  </p>
                  {game.best && <p className="qgNewBest">New best score!</p>}
                  <div className="qgPanelButtons">
                    <button type="button" className="qgBig" autoFocus onClick={() => start(game.mode, game.seconds)} data-again>
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
