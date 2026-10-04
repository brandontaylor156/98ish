import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import PlayOnline, { OnlineResultBar, PlayOnlineButton, useOnlineRoom } from "../../shared/online"
import { unlock } from "../../../utils/achievements"
import GameScreen from "./GameScreen"
import SettingsForm from "./SettingsForm"
import { createLocalGame } from "./local"
import { makeRules } from "./rules"
import { loadWords, makeDict } from "./words"
import { DEFAULTS, PRESETS, describe, presetSettings, validateSettings } from "./settings"
import { dayKey, dayNumber, shareText } from "./logic"
import { createSounds } from "./audio"
import { load, recordGame, resetStats, saveDaily, savePrefs, statsFor } from "./storage"
import { shareOut, textPayload } from "../../../utils/share"
import "./WordDuel.css"
import { helpItem } from "../../../utils/help"

// Word Duel: guess the hidden word. Green is the right letter in the right spot, yellow
// is in the word somewhere else, gray isn't in it. Solo: the daily word (the same for
// everyone), unlimited practice, Absurd, Speed Rush, Multi-board, Hard Mode or any custom
// game against computer players. Online (server/arcade/games/wordduel.js): races, turns,
// best-of series, battle royale, co-op, sabotage... every knob in settings.js.

const ICON = "/assets/program_icons/wordduel.svg"
const BOT_NAMES = ["Ada", "Grace", "Alan", "Linus", "Hedy", "Dennis", "Ken"]
const ONLINE_DEFAULTS = presetSettings("race")

const Logo = ({ small = false }) => (
  <div className={`wdLogo${small ? " is-small" : ""}`} aria-label="Word Duel">
    {"WORD".split("").map((c, i) => (
      <span key={`a${i}`} className={`wdLogoTile is-${["g", "y", "b", "g"][i]}`} style={{ "--i": i }}>
        {c}
      </span>
    ))}
    <span className="wdLogoGap" />
    {"DUEL".split("").map((c, i) => (
      <span key={`b${i}`} className={`wdLogoTile is-${["y", "g", "g", "b"][i]}`} style={{ "--i": i + 4 }}>
        {c}
      </span>
    ))}
  </div>
)

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const box = document.createElement("textarea")
    box.value = text
    box.style.position = "fixed"
    box.style.opacity = "0"
    document.body.appendChild(box)
    box.select()
    const ok = document.execCommand?.("copy")
    box.remove()
    return !!ok
  }
}

const msToMidnight = () => {
  const d = new Date()
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  return next - d
}

// ---------- statistics ----------

const MODES = [
  ["daily", "Daily Word"],
  ["practice", "Practice"],
  ["absurd", "Absurd"],
  ["rush", "Speed Rush"],
  ["quad", "Multi-board"],
  ["hard", "Hard Mode"],
  ["custom", "Custom Games"],
]

const StatsDialog = ({ onClose, initial = "daily", highlight }) => {
  const [mode, setMode] = useState(initial)
  const [data, setData] = useState(load)
  const s = statsFor(data, mode)
  const top = Math.max(1, ...s.dist.slice(1))
  return (
    <Dialog title="Statistics" onOk={onClose} onCancel={onClose} okLabel="Close">
      <div className="wdStats">
        <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Mode">
          {MODES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <div className="wdStatNums">
          <div>
            <b data-stat="played">{s.played}</b>
            <small>Played</small>
          </div>
          <div>
            <b data-stat="winpct">{s.played ? Math.round((s.won / s.played) * 100) : 0}</b>
            <small>Win %</small>
          </div>
          <div>
            <b data-stat="streak">{s.streak}</b>
            <small>Current streak</small>
          </div>
          <div>
            <b>{s.best}</b>
            <small>Max streak</small>
          </div>
        </div>
        <div className="wdDist" aria-label="Guess distribution">
          {s.dist.slice(1).map((n, i) =>
            n || i < 6 ? (
              <div key={i} className="wdDistRow">
                <span>{i + 1}</span>
                <span className={`wdDistBar${highlight === i + 1 && mode === initial ? " is-now" : ""}`} style={{ width: `${Math.max(8, (n / top) * 100)}%` }}>
                  {n}
                </span>
              </div>
            ) : null
          )}
          {s.dist[0] > 0 && (
            <div className="wdDistRow">
              <span>X</span>
              <span className="wdDistBar is-x" style={{ width: `${Math.max(8, (s.dist[0] / top) * 100)}%` }}>
                {s.dist[0]}
              </span>
            </div>
          )}
        </div>
        <button type="button" className="wdLinkBtn" onClick={() => setData(resetStats())}>
          Reset statistics
        </button>
      </div>
    </Dialog>
  )
}

const HowTo = ({ onClose }) => (
  <Dialog title="How to Play Word Duel" onOk={onClose} onCancel={onClose}>
    <div className="wdHow">
      <p>Guess the hidden word. Type a word and press Enter. Each tile then turns:</p>
      <ul>
        <li>
          <span className="wdTile is-g wdTile--demo">
            <span>A</span>
          </span>{" "}
          green: the right letter in the right spot
        </li>
        <li>
          <span className="wdTile is-y wdTile--demo">
            <span>B</span>
          </span>{" "}
          yellow: in the word, but somewhere else
        </li>
        <li>
          <span className="wdTile is-b wdTile--demo">
            <span>C</span>
          </span>{" "}
          gray: not in the word (or not that many times)
        </li>
      </ul>
      <p>
        <b>Play Online</b> for races, turns, best-of series, Battle Royale for up to 8, Co-op, Sabotage (pick your opponent's word) and more. Every setting is yours to change under <b>Customize</b>.
      </p>
      <p>Options &gt; High Contrast Colors swaps green and yellow for orange and blue.</p>
    </div>
  </Dialog>
)

// ---------- a game in this browser ----------

const useLocal = () => {
  const [game, setGame] = useState(null) // { id, settings, mode, players, local, view, result, words }
  const ref = useRef(null)
  const stop = () => {
    ref.current?.local?.stop()
    ref.current = null
    setGame(null)
  }
  useEffect(() => () => ref.current?.local?.stop(), [])
  const start = async ({ settings, mode, replay = [] }) => {
    ref.current?.local?.stop()
    const clean = validateSettings(settings)
    if (clean.error) return { ok: false, error: clean.error }
    const words = await loadWords(clean.length)
    // (two quick starts: the one that finished loading first is already running)
    ref.current?.local?.stop()
    const rules = makeRules(makeDict([words]))
    const players = Array.from({ length: clean.players }, (_, i) => (i === 0 ? { id: 0, name: "You", bot: false } : { id: i, name: BOT_NAMES[i - 1], bot: true }))
    const entry = { id: Date.now(), settings: clean, mode, players, words, local: null, view: null, result: null }
    ref.current = entry
    const update = (g) => {
      if (ref.current !== entry) return
      setGame({ ...entry, local: g, view: g.view(0), result: g.result })
    }
    entry.local = createLocalGame({ rules, settings: clean, players, onChange: update })
    for (const word of replay) entry.local.act({ type: "guess", word })
    update(entry.local)
    return { ok: true }
  }
  return { game, start, stop, act: (action) => Promise.resolve(ref.current?.local ? ref.current.local.act(action) : { ok: false, error: "No game." }), restart: () => ref.current?.local?.restart() }
}

// ---------- online ----------

const OnlineScreen = ({ online, sounds, contrast, mobile, onBack }) => {
  const { room } = online
  const playing = room && (room.phase === "playing" || room.phase === "over") && online.view
  const [words, setWords] = useState(null)
  const length = room?.settings?.length
  useEffect(() => {
    if (length) loadWords(length).then(setWords, () => {})
  }, [length])
  const names = room?.seats?.map((s) => s?.name) || []
  const wonRef = useRef(null)
  useEffect(() => {
    if (room?.phase === "over" && room.result?.winners?.includes(room.you) && wonRef.current !== room.round) {
      wonRef.current = room.round
      if (room.seats.length > 1) unlock("wordduel-online")
    }
  }, [room?.phase, room?.round])

  if (playing) {
    return (
      <GameScreen
        key={room.id}
        view={online.view}
        act={online.act}
        names={names}
        serverNow={online.serverNow}
        sounds={sounds}
        contrast={contrast}
        mobile={mobile}
        words={words}
        footer={<OnlineResultBar online={online} text=" " />}
        onLeave={online.leave}
        onSolved={(set) => set.words <= 2 && unlock("wordduel-two")}
      />
    )
  }
  return (
    <div className="wdOnline">
      <PlayOnline
        online={online}
        title="Word Duel"
        icon={ICON}
        blurb="Race a friend to the same word, battle up to 8 people, team up, or pick a nasty word for your opponent. Share the room code, or get matched with anyone."
        defaultSettings={ONLINE_DEFAULTS}
        quickSettings
        computer
        onBack={room ? null : onBack}
        renderSettings={(s, set, { disabled }) => <SettingsForm settings={{ ...DEFAULTS, ...s }} onChange={set} disabled={disabled} mode="online" seatNames={names} />}
      />
    </div>
  )
}

// ---------- the window ----------

const WordDuel = ({ mobile = false, onClose }) => {
  const [data, setData] = useState(load)
  const prefs = data.prefs
  const [screen, setScreen] = useState("title") // title | game | custom | online
  const [dialog, setDialog] = useState(null) // stats | howto | about
  const [lastWin, setLastWin] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [customSettings, setCustomSettings] = useState(() => validateSettings({ ...(prefs.settings || presetSettings("classic")), players: prefs.settings?.players || 1 }))
  const sounds = useMemo(() => createSounds(), [])
  const local = useLocal()
  const online = useOnlineRoom("wordduel")
  const chatItem = useGameChatMenuItem("wordduel")
  const recorded = useRef(null)
  const today = dayKey()
  const dailyDone = data.daily?.key === today && data.daily.done

  useEffect(() => {
    sounds.setEnabled(prefs.sound)
  }, [prefs.sound])
  const setPref = (patch) => setData(savePrefs(patch))

  // an invitation or a join link: straight to the room
  useEffect(() => {
    if (online.room && screen !== "online") {
      local.stop()
      setScreen("online")
    }
  }, [online.room?.id])

  const play = async (mode, settings, replay) => {
    setError(null)
    recorded.current = null
    const result = await local.start({ settings, mode, replay })
    if (!result.ok) return setError(result.error)
    setScreen("game")
  }

  const startDaily = () => {
    const saved = load().daily
    const replay = saved?.key === today ? saved.words : []
    play("daily", { ...presetSettings("classic"), source: "daily", length: 5, guesses: 6 }, replay)
  }
  const startPractice = () => play("practice", { ...presetSettings("classic"), length: prefs.length })
  const startPreset = (name) => play(name, { ...presetSettings(name), length: prefs.length, players: 1 })
  const startCustom = (settings) => {
    setPref({ settings })
    play("custom", settings)
  }

  // the daily word: remember each guess, so it survives closing the window
  const g = local.game
  const myWords = g?.view?.sets?.[g.view.mine]
  useEffect(() => {
    if (!g || g.mode !== "daily" || !g.local?.state) return
    const set = g.local.state.sets[0]
    if (!set) return
    setData(saveDaily({ key: today, words: set.words.filter(Boolean), done: !!g.result, solved: !!set.solved }))
  }, [myWords?.words, g?.result])

  // statistics and achievements when a solo game ends
  useEffect(() => {
    if (!g?.result || recorded.current === g.id) return
    recorded.current = g.id
    const v = g.view
    const set = v.sets[v.mine] || v.sets[0]
    const won = g.result.winners?.includes(0)
    const guesses = set ? set.words : 0
    // a finished daily word opened again isn't another game
    const already = g.mode === "daily" && load().stats.daily?.last === dayNumber(today)
    if (!already) setData(recordGame(g.mode, { won, guesses, day: g.mode === "daily" ? dayNumber(today) : null }))
    setLastWin(won ? guesses : null)
    if (won && g.mode === "daily") unlock("wordduel-daily")
    if (won && g.mode === "absurd") unlock("wordduel-absurd")
  }, [g?.result])

  const resultText = () => {
    const v = g.view
    const set = v.sets[v.mine]
    const rows = set.boards[0].rows
    const title = g.mode === "daily" ? `Word Duel #${dayNumber(today)}` : `Word Duel (${g.settings.length} letters)`
    return { title, text: shareText({ title, rows, solved: set.solved, max: set.max, contrast: prefs.contrast, hard: g.settings.hard }) }
  }

  const copyResult = async () => {
    const ok = await copyText(resultText().text)
    setCopied(ok ? "Copied to the clipboard!" : "Couldn't copy. Try again.")
    setTimeout(() => setCopied(false), 2200)
  }

  // the phone's share sheet (Messages, WhatsApp...), straight from the tap; where there's
  // none, it's copied instead
  const share = () => {
    const { title, text } = resultText()
    shareOut(textPayload(title, text), "apps", { title: "Word Duel" })
  }

  const menus = [
    {
      label: "Game",
      items: [
        { label: "Daily Word", onClick: startDaily },
        { label: "Practice", onClick: startPractice },
        { label: "Absurd", onClick: () => startPreset("absurd") },
        { label: "Speed Rush", onClick: () => startPreset("rush") },
        { label: "Multi-board", onClick: () => startPreset("quad") },
        { label: "Hard Mode", onClick: () => startPreset("hard") },
        { label: "Custom Game...", onClick: () => setScreen("custom") },
        "-",
        { label: "Play Online...", onClick: () => (local.stop(), setScreen("online")) },
        "-",
        { label: "Statistics...", onClick: () => setDialog("stats") },
        { label: "Main Menu", onClick: () => (local.stop(), online.room ? online.leave() : null, setScreen("title")) },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Options",
      items: [
        ...[4, 5, 6, 7].map((n) => ({ label: `${n}-Letter Words`, checked: prefs.length === n, onClick: () => setPref({ length: n }) })),
        "-",
        { label: "High Contrast Colors", checked: prefs.contrast, onClick: () => setPref({ contrast: !prefs.contrast }) },
        { label: "Sound", checked: prefs.sound, onClick: () => setPref({ sound: !prefs.sound }) },
        chatItem,
      ],
    },
    {
      label: "Help",
      items: [helpItem({ program: "Word Duel" }), "-",
        { label: "How to Play...", onClick: () => setDialog("howto") },
        { label: "About Word Duel...", onClick: () => setDialog("about") },
      ],
    },
  ]

  let body
  if (screen === "online") {
    body = (
      <OnlineScreen
        online={online}
        sounds={sounds}
        contrast={prefs.contrast}
        mobile={mobile}
        onBack={() => {
          online.leave()
          setScreen("title")
        }}
      />
    )
  } else if (screen === "game" && g?.view) {
    const solo = g.players.length === 1
    const extra =
      g.result && solo && (g.mode === "daily" || g.mode === "practice" || g.mode === "hard") ? (
        <div className="wdShare">
          <button type="button" className="wdPrimary" onClick={share} data-share>
            Share...
          </button>
          <button type="button" onClick={copyResult} data-copy>
            Copy
          </button>
          {copied && <span className="wdCopied">{copied}</span>}
          {g.mode === "daily" && <span className="wdMuted">Next word in {Math.ceil(msToMidnight() / 3_600_000)}h</span>}
        </div>
      ) : null
    const footer = g.result ? (
      <div className="wdRowBtns wdFooterBtns">
        {g.mode !== "daily" && (
          <button type="button" className="wdPrimary" onClick={() => play(g.mode, g.settings)} data-again>
            Play Again
          </button>
        )}
        <button type="button" onClick={() => setDialog("stats")}>
          Statistics
        </button>
        {g.mode === "custom" && (
          <button type="button" onClick={() => setScreen("custom")}>
            Change Settings
          </button>
        )}
        <button type="button" onClick={() => (local.stop(), setScreen("title"))}>
          Main Menu
        </button>
      </div>
    ) : null
    body = (
      <GameScreen
        key={g.id}
        view={g.view}
        act={local.act}
        sounds={sounds}
        contrast={prefs.contrast}
        mobile={mobile}
        words={g.words}
        extra={extra}
        footer={footer}
        onSolved={(set) => set.words <= 2 && !set.rush && unlock("wordduel-two")}
        title={g.mode === "daily" ? `Daily Word #${dayNumber(today)}` : g.mode === "practice" ? "Practice" : null}
      />
    )
  } else if (screen === "custom") {
    body = (
      <form
        className="wdCustom"
        onSubmit={(e) => {
          e.preventDefault()
          startCustom(customSettings)
        }}
      >
        <h2>Custom Game</h2>
        <p className="wdMuted">Pick a preset or change any setting. Play alone or against computer players, right here (no internet needed).</p>
        <SettingsForm settings={customSettings} onChange={setCustomSettings} mode="solo" />
        {error && <p className="wdError">{error}</p>}
        <div className="wdRowBtns">
          <button type="submit" className="wdPrimary" data-start>
            Start Game
          </button>
          <button type="button" onClick={() => setScreen("title")}>
            Back
          </button>
        </div>
      </form>
    )
  } else {
    const n = dayNumber(today)
    body = (
      <div className="wdTitle">
        <Logo />
        <p className="wdTagline">Guess the word. Beat your friends.</p>
        <PlayOnlineButton onClick={() => setScreen("online")} sub="Races, Battle Royale, Co-op, Sabotage..." className="wdOnlineBtn" data-online />
        <div className="wdMenu">
          <button type="button" className="wdMenuBtn is-daily" onClick={startDaily} data-mode="daily">
            <b>Daily Word #{n}</b>
            <small>{dailyDone ? (data.daily.solved ? `Solved in ${data.daily.words.length} ✓` : "Done for today") : "Same word for everyone today"}</small>
          </button>
          <button type="button" className="wdMenuBtn" onClick={startPractice} data-mode="practice">
            <b>Practice</b>
            <small>Unlimited words, {prefs.length} letters</small>
          </button>
          {["absurd", "rush", "quad", "hard"].map((name) => (
            <button key={name} type="button" className="wdMenuBtn" onClick={() => startPreset(name)} data-mode={name}>
              <b>{PRESETS[name].label}</b>
              <small>{PRESETS[name].text}</small>
            </button>
          ))}
          <button type="button" className="wdMenuBtn" onClick={() => setScreen("custom")} data-mode="custom">
            <b>Custom Game...</b>
            <small>Every setting, vs. the computer</small>
          </button>
          <button type="button" className="wdMenuBtn" onClick={() => setDialog("stats")} data-mode="stats">
            <b>Statistics</b>
            <small>Streaks and guess counts</small>
          </button>
        </div>
        {error && <p className="wdError">{error}</p>}
        <div className="wdLengths" role="radiogroup" aria-label="Word length">
          {[4, 5, 6, 7].map((k) => (
            <button key={k} type="button" role="radio" aria-checked={prefs.length === k} className={prefs.length === k ? "is-on" : ""} onClick={() => setPref({ length: k })}>
              {k} letters
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={`wdRoot${prefs.contrast ? " wd-contrast" : ""}${mobile ? " is-mobile" : ""}`} data-screen={screen}>
      <MenuBar menus={menus} />
      <GameChat game="wordduel" title="Word Duel" room={online.chatRoom} />
      <div className="wdBody">{body}</div>
      {dialog === "stats" && <StatsDialog onClose={() => setDialog(null)} initial={g?.mode && MODES.some(([m]) => m === g.mode) ? g.mode : "daily"} highlight={lastWin} />}
      {dialog === "howto" && <HowTo onClose={() => setDialog(null)} />}
      {dialog === "about" && (
        <Dialog title="About Word Duel" onOk={() => setDialog(null)} onCancel={() => setDialog(null)}>
          <div className="wdHow">
            <Logo small />
            <p>Word Duel 98, a word game for one to eight players.</p>
            <p className="wdMuted">Words from SCOWL (Copyright 2000-2018 Kevin Atkinson, used with permission per its license) and the public domain ENABLE word list. Definitions link to Wiktionary.</p>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default WordDuel
