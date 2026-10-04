import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import PlayOnline, { OnlineResultBar, PlayOnlineButton, useOnlineRoom } from "../../shared/online"
import { unlock } from "../../../utils/achievements"
import { createLocalGame } from "../wordduel/local"
import RaceScreen from "./RaceScreen"
import SettingsForm from "./SettingsForm"
import StatsDialog from "./StatsDialog"
import { Car, COLORS } from "./Track"
import rules, { DEFAULTS, validateSettings } from "./rules"
import { dailyPrompt } from "./prompts/index.js"
import { DRILLS, makeDrill } from "./drills"
import { createSounds } from "./audio"
import { bestGhost, load, recordRace, savePrefs } from "./storage"
import "./SpeedType.css"
import { helpItem } from "../../../utils/help"

// Speed Typist 98: typing races. Everyone gets the same prompt; your car moves as you type
// it right. Online (server/arcade/games/speedtype.js): Quick Match by length and category,
// private rooms with a code, invitations, best of 3 and sudden death, with the server as
// referee. Here in the browser: race the computer, race your own best run (your ghost),
// the daily prompt, and practice drills. The rules (rules.js) are the same everywhere.

const ICON = "/assets/program_icons/speedtype.svg"
const BOT_NAMES = ["Turbo", "Pixel", "Clacky", "Floppy", "Byte", "Zippy"]
const ONLINE_DEFAULTS = { ...DEFAULTS, players: 4 }

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const dayNumber = (key) => Math.round((Date.parse(`${key}T12:00:00Z`) - Date.parse("2026-01-01T12:00:00Z")) / 86_400_000) + 1

const Logo = ({ small = false }) => (
  <div className={`stLogo${small ? " is-small" : ""}`} aria-label="Speed Typist 98">
    <div className="stLogoCars" aria-hidden="true">
      <Car color={COLORS[0]} size={small ? 36 : 56} />
      <Car color={COLORS[1]} size={small ? 36 : 56} />
    </div>
    <div className="stLogoText">
      <span>SPEED</span>
      <span>TYPIST</span>
      <b>98</b>
    </div>
  </div>
)

// Achievements and statistics for a race that just ended. kind: race | online | ghost | daily | drill | practice
const recordRound = (kind, { result, timeline, view }, { day } = {}) => {
  const row = result.table.find((r) => r.seat === view.you)
  if (!row) return null
  const p = result.prompt
  const saved = recordRace({
    wpm: row.wpm,
    acc: row.acc,
    mistakes: row.mistakes,
    length: p.length,
    category: p.category,
    kind,
    place: row.finished ? row.place : null,
    racers: result.table.length,
    promptId: kind === "drill" || kind === "practice" ? null : p.id,
    finished: row.finished,
    timeline,
    dayKey: day,
  })
  if (row.finished) {
    unlock("speedtype-first")
    if (row.wpm >= 60) unlock("speedtype-60")
    if (row.wpm >= 100) unlock("speedtype-100")
    if (row.acc >= 100 && p.length !== "short" && kind !== "drill") unlock("speedtype-perfect")
    if (kind === "daily") unlock("speedtype-daily")
    const ghost = result.table.find((r) => r.ghost)
    if (ghost && row.place < ghost.place) unlock("speedtype-ghost")
    const people = result.table.filter((r) => !r.bot).length
    if (kind === "online" && row.place === 1 && people > 1) unlock("speedtype-online")
    if (view.mode === "sudden" && row.place === 1 && result.table.length > 1) unlock("speedtype-sudden")
  }
  return { ...saved, row, length: p.length }
}

const bestNote = (rec) => {
  if (!rec) return null
  if (rec.newBest) return `New personal best for ${rec.length} prompts: ${Math.round(rec.row.wpm)} WPM (was ${Math.round(rec.oldBest)})!`
  if (rec.oldBest == null && rec.row.finished && rec.data.best[rec.length]) return `Your first ${rec.length} prompt: ${Math.round(rec.row.wpm)} WPM. Beat it next time!`
  return null
}

// ---------- races here in the browser ----------

const useLocalRace = () => {
  const [game, setGame] = useState(null)
  const ref = useRef(null)
  const stop = () => {
    ref.current?.local?.stop()
    ref.current = null
    setGame(null)
  }
  useEffect(() => () => ref.current?.local?.stop(), [])
  // kind: race | ghost | daily | drill | practice; opponents: computer racers
  const start = ({ kind, settings, opponents = 0, label = null, name = "You" }) => {
    ref.current?.local?.stop()
    const clean = validateSettings({ ...settings, players: opponents + 1 }, { local: true })
    if (clean.error) return { ok: false, error: clean.error }
    const players = Array.from({ length: opponents + 1 }, (_, i) => (i === 0 ? { id: 0, name, bot: false } : { id: i, name: BOT_NAMES[(i - 1) % BOT_NAMES.length], bot: true }))
    const entry = { id: Date.now(), kind, label, settings: clean, opponents, raw: settings, local: null, view: null, result: null }
    ref.current = entry
    const update = (g) => {
      if (ref.current !== entry) return
      setGame({ ...entry, local: g, view: g.view(0), result: g.result })
    }
    entry.local = createLocalGame({ rules, settings: clean, players, onChange: update })
    update(entry.local)
    return { ok: true }
  }
  const act = (action) => Promise.resolve(ref.current?.local ? ref.current.local.act(action) : { ok: false, error: "No race." })
  return { game, start, stop, act }
}

// ---------- online ----------

const OnlineScreen = ({ online, sounds, mobile, onBack, onRecord, note }) => {
  const { room } = online
  const playing = room && (room.phase === "playing" || room.phase === "over") && online.view
  if (playing) {
    return (
      <RaceScreen
        key={room.id}
        view={online.view}
        act={online.act}
        now={online.serverNow}
        sounds={sounds}
        mobile={mobile}
        online
        onRoundEnd={(info) => onRecord("online", info)}
        heading={room.private ? <span className="stCode">Room {room.code}</span> : <span className="stCode">Quick Match</span>}
        footer={
          <>
            {note && <p className="stBest">{note}</p>}
            <OnlineResultBar online={online} />
          </>
        }
      />
    )
  }
  return (
    <div className="stOnline">
      <PlayOnline
        online={online}
        title="Speed Typist 98"
        icon={ICON}
        blurb="Race people anywhere to type the same prompt. Quick Match pairs you by length and category (computer racers fill empty lanes); a private room gets a code to share, best of 3, sudden death or your own text."
        defaultSettings={ONLINE_DEFAULTS}
        quickSettings
        computer
        onBack={room ? null : onBack}
        renderSettings={(s, set, { disabled }) => <SettingsForm settings={{ ...ONLINE_DEFAULTS, ...s }} onChange={set} disabled={disabled} where="online" />}
      />
    </div>
  )
}

// ---------- the window ----------

const HowTo = ({ onClose }) => (
  <Dialog title="How to Play Speed Typist 98" onOk={onClose} onCancel={onClose}>
    <div className="stHow">
      <p>Everyone gets the same prompt. After the 3-2-1, type it into the box: your car moves with every letter you get right.</p>
      <ul>
        <li>The current word is highlighted. A wrong letter turns red, and you have to fix it (Backspace) before you can go on.</li>
        <li>Curly quotes and long dashes from phone keyboards count as plain ones.</li>
        <li>WPM counts five characters (spaces included) as one word. Accuracy is the share of your keys that were right.</li>
        <li>
          <b>Strict</b> races don't let wrong keys in and have no backspace. In <b>Sudden Death</b>, one wrong key and you're out.
        </li>
      </ul>
      <p>
        <b>Play Online</b> for Quick Match, private rooms with a code, invitations, Best of 3 and Sudden Death. Race the computer, your own ghost (your best run of a prompt), today's Daily Prompt or a practice drill right here.
      </p>
    </div>
  </Dialog>
)

const SpeedType = ({ mobile = false, onClose }) => {
  const [data, setData] = useState(load)
  const prefs = data.prefs
  const [screen, setScreen] = useState("title") // title | setup | drills | race | online
  const [dialog, setDialog] = useState(null) // stats | howto | about
  const [setup, setSetup] = useState(() => ({ ...DEFAULTS, length: prefs.length, category: prefs.category, mode: prefs.mode, strict: prefs.strict, botWpm: prefs.botWpm }))
  const [opponents, setOpponents] = useState(prefs.bots || 3)
  const [ownText, setOwnText] = useState("")
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const sounds = useMemo(() => createSounds(), [])
  const local = useLocalRace()
  const online = useOnlineRoom("speedtype")
  const chatItem = useGameChatMenuItem("speedtype")
  const today = dayKey()
  const daily = dailyPrompt(today)
  const ghost = bestGhost(data)
  const g = local.game

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
  // a new online race: forget the last personal-best note
  useEffect(() => setNote(null), [online.room?.round, online.view?.round])

  const record = (kind, info) => {
    const rec = recordRound(kind, info, { day: kind === "daily" ? today : null })
    if (!rec) return
    setData(rec.data)
    const msg = bestNote(rec)
    setNote(msg)
    if (rec.newBest) sounds.best()
  }

  const begin = (opts) => {
    setError(null)
    setNote(null)
    const r = local.start(opts)
    if (!r.ok) return setError(r.error)
    setScreen("race")
  }
  const raceComputer = (settings = setup, n = opponents) => {
    setPref({ length: settings.length, category: settings.category, mode: settings.mode, strict: settings.strict, botWpm: settings.botWpm, bots: n })
    begin({ kind: "race", settings, opponents: n })
  }
  const raceGhost = () => {
    const best = bestGhost(load())
    if (!best) return setError("Finish a race first: your best run of each prompt becomes a ghost to race.")
    begin({ kind: "ghost", label: "Ghost Race", settings: { ...DEFAULTS, promptId: best.promptId, strict: prefs.strict, ghost: { name: `Your Ghost (${Math.round(best.wpm)} WPM)`, timeline: best.timeline } }, opponents: 1 })
  }
  const raceDaily = () => {
    const mine = bestGhost(load(), daily.id)
    const settings = { ...DEFAULTS, promptId: daily.id, strict: prefs.strict }
    if (mine) settings.ghost = { name: `Your Best (${Math.round(mine.wpm)} WPM)`, timeline: mine.timeline }
    begin({ kind: "daily", label: `Daily Prompt #${dayNumber(today)}`, settings, opponents: mine ? 1 : 0 })
  }
  const drill = (id) => {
    const d = DRILLS.find((x) => x.id === id)
    begin({ kind: "drill", label: `${d.label} Drill`, settings: { ...DEFAULTS, custom: makeDrill(id), label: d.label, strict: prefs.strict }, opponents: 0 })
  }
  const practiceText = () => begin({ kind: "practice", label: "Your Text", settings: { ...DEFAULTS, custom: ownText, strict: prefs.strict }, opponents: 0 })
  const again = () => {
    if (!g) return
    if (g.kind === "ghost") return raceGhost()
    if (g.kind === "daily") return raceDaily()
    if (g.kind === "drill") return drill(DRILLS.find((d) => d.label === g.raw.label)?.id || "common")
    begin({ kind: g.kind, label: g.label, settings: g.raw, opponents: g.opponents })
  }
  const goOnline = () => {
    local.stop()
    setScreen("online")
  }
  const home = () => {
    local.stop()
    if (online.room) online.leave()
    setError(null)
    setScreen("title")
  }

  const menus = [
    {
      label: "Game",
      items: [
        { label: "Race the Computer", onClick: () => raceComputer() },
        { label: "Race Settings...", onClick: () => (local.stop(), setScreen("setup")) },
        { label: "Race Your Ghost", onClick: raceGhost, disabled: !ghost },
        { label: "Daily Prompt", onClick: raceDaily },
        { label: "Practice Drills...", onClick: () => (local.stop(), setScreen("drills")) },
        "-",
        { label: "Play Online...", onClick: goOnline },
        "-",
        { label: "Statistics...", onClick: () => setDialog("stats") },
        { label: "Main Menu", onClick: home },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Options",
      items: [
        { label: "Sound", checked: prefs.sound, onClick: () => setPref({ sound: !prefs.sound }) },
        { label: "Strict Typing (no backspace)", checked: prefs.strict, onClick: () => (setPref({ strict: !prefs.strict }), setSetup((s) => ({ ...s, strict: !prefs.strict }))) },
        chatItem,
      ],
    },
    {
      label: "Help",
      items: [helpItem({ program: "Speed Typist 98" }), "-",
        { label: "How to Play...", onClick: () => setDialog("howto") },
        { label: "About Speed Typist 98...", onClick: () => setDialog("about") },
      ],
    },
  ]

  let body
  if (screen === "online") {
    body = <OnlineScreen online={online} sounds={sounds} mobile={mobile} onBack={home} onRecord={record} note={note} />
  } else if (screen === "race" && g?.view) {
    const board = g.kind === "daily" ? data.daily[today] || [] : null
    const footer = (
      <div className="stFooter">
        {note && (
          <p className="stBest" data-best-note>
            {note}
          </p>
        )}
        {board && board.length > 0 && (
          <div className="stDaily" data-daily-board>
            <b>Today's leaderboard (this computer)</b>
            <ol>
              {board.slice(0, 5).map((e) => (
                <li key={e.at}>
                  {Math.round(e.wpm)} WPM · {Math.round(e.acc)}% <small>{new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="stRowBtns">
          <button type="button" className="stPrimary" onClick={again} data-again>
            {g.kind === "daily" ? "Try Again" : g.kind === "drill" ? "New Drill" : "Race Again"}
          </button>
          {g.kind === "race" && (
            <button type="button" onClick={() => setScreen("setup")}>
              Settings
            </button>
          )}
          {(g.kind === "drill" || g.kind === "practice") && (
            <button type="button" onClick={() => setScreen("drills")}>
              Drills
            </button>
          )}
          <button type="button" onClick={home}>
            Main Menu
          </button>
        </div>
      </div>
    )
    body = (
      <RaceScreen
        key={g.id}
        view={g.view}
        act={local.act}
        now={Date.now}
        sounds={sounds}
        mobile={mobile}
        footer={footer}
        heading={g.label ? <span className="stCode">{g.label}</span> : null}
        onRoundEnd={(info) => record(g.kind, info)}
      />
    )
  } else if (screen === "setup") {
    body = (
      <form
        className="stPanel"
        onSubmit={(e) => {
          e.preventDefault()
          raceComputer(setup, opponents)
        }}
      >
        <h2>Race the Computer</h2>
        <p className="stMuted">Computer racers type like people: bursts, pauses between words, the odd slip. No internet needed.</p>
        <SettingsForm settings={setup} onChange={setSetup} where="local" opponents={opponents} onOpponents={setOpponents} />
        {error && <p className="stError">{error}</p>}
        <div className="stRowBtns">
          <button type="submit" className="stPrimary" data-start>
            Start Race
          </button>
          <button type="button" onClick={() => setScreen("title")}>
            Back
          </button>
        </div>
      </form>
    )
  } else if (screen === "drills") {
    body = (
      <div className="stPanel">
        <h2>Practice Drills</h2>
        <p className="stMuted">Just you and the clock. A fresh drill every time.</p>
        <div className="stDrills">
          {DRILLS.map((d) => (
            <button key={d.id} type="button" className="stMenuBtn" onClick={() => drill(d.id)} data-drill={d.id}>
              <b>{d.label}</b>
              <small>{d.text}</small>
            </button>
          ))}
        </div>
        <fieldset>
          <legend>Practice your own text</legend>
          <textarea className="stCustomText" rows={3} maxLength={2000} value={ownText} onChange={(e) => setOwnText(e.target.value)} placeholder="Type or paste anything (up to 2,000 characters)." />
          <button type="button" disabled={ownText.trim().length < 10} onClick={practiceText}>
            Practice This
          </button>
        </fieldset>
        {error && <p className="stError">{error}</p>}
        <div className="stRowBtns">
          <button type="button" onClick={() => setScreen("title")}>
            Back
          </button>
        </div>
      </div>
    )
  } else {
    const n = dayNumber(today)
    const best = Math.max(0, ...Object.values(data.best).map((b) => b.wpm))
    const dailyBest = (data.daily[today] || [])[0]
    body = (
      <div className="stTitle">
        <Logo />
        <p className="stTagline">Race anyone to the end of the sentence.</p>
        <PlayOnlineButton onClick={goOnline} sub="Quick Match, private rooms, best of 3..." className="stOnlineBtn" data-online />
        <div className="stMenu">
          <button type="button" className="stMenuBtn" onClick={() => setScreen("setup")} data-mode="computer">
            <b>Race the Computer</b>
            <small>1 to 4 computer racers, any speed</small>
          </button>
          <button type="button" className="stMenuBtn" onClick={raceGhost} disabled={!ghost} data-mode="ghost">
            <b>Race Your Ghost</b>
            <small>{ghost ? `Your best run: ${Math.round(ghost.wpm)} WPM` : "Finish a race to make one"}</small>
          </button>
          <button type="button" className="stMenuBtn" onClick={raceDaily} data-mode="daily">
            <b>Daily Prompt #{n}</b>
            <small>{dailyBest ? `Today's best: ${Math.round(dailyBest.wpm)} WPM` : "The same prompt for everyone today"}</small>
          </button>
          <button type="button" className="stMenuBtn" onClick={() => setScreen("drills")} data-mode="drills">
            <b>Practice Drills</b>
            <small>Home row, numbers, symbols...</small>
          </button>
          <button type="button" className="stMenuBtn" onClick={() => setDialog("stats")} data-mode="stats">
            <b>Statistics</b>
            <small>{best ? `Personal best: ${Math.round(best)} WPM` : "WPM history and bests"}</small>
          </button>
        </div>
        {error && <p className="stError">{error}</p>}
      </div>
    )
  }

  return (
    <div className={`stRoot${mobile ? " is-mobile" : ""}`} data-screen={screen}>
      <MenuBar menus={menus} />
      <GameChat game="speedtype" title="Speed Typist 98" room={online.chatRoom} />
      <div className="stBody">{body}</div>
      {dialog === "stats" && <StatsDialog onClose={() => (setDialog(null), setData(load()))} />}
      {dialog === "howto" && <HowTo onClose={() => setDialog(null)} />}
      {dialog === "about" && (
        <Dialog title="About Speed Typist 98" onOk={() => setDialog(null)} onCancel={() => setDialog(null)}>
          <div className="stHow">
            <Logo small />
            <p>Speed Typist 98, typing races for one to five.</p>
            <p className="stMuted">Every prompt was written for this game.</p>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default SpeedType
