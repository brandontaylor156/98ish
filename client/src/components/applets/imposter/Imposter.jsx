import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import PlayOnline, { OnlineResultBar, PlayOnlineButton, useOnlineRoom } from "../../shared/online"
import MoreOptions from "../../shared/MoreOptions"
import PrimaryBar from "../../shared/PrimaryBar"
import { helpItem } from "../../../utils/help"
import { DEFAULTS, MAX_PLAYERS, MIN_PLAYERS, describe, validateSettings } from "./rules"
import { createLocalGame } from "./local"
import { createSounds } from "./sounds"
import SettingsForm from "./SettingsForm"
import { LocalTable, OnlineTable } from "./Table"
import "./Imposter.css"

// Imposter: the party word game. Everyone gets the secret word except the imposter(s);
// take turns giving a clue, talk it over, vote. Pass one phone around (local.js runs the
// rules here) or play online with each person on their own phone (server/arcade/games/
// imposter.js runs the very same rules on the server and keeps every card private).

const ICON = "/assets/program_icons/imposter.svg"
const KEY = "98ish.imposter"
const START_NAMES = ["Player 1", "Player 2", "Player 3", "Player 4"]

const loadData = () => {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "{}")
    const names = Array.isArray(d.names) && d.names.length >= MIN_PLAYERS ? d.names.slice(0, MAX_PLAYERS).map((n) => String(n).slice(0, 16)) : START_NAMES
    return { names, settings: validateSettings({ ...DEFAULTS, ...d.settings }), sound: d.sound !== false, online: validateSettings({ ...DEFAULTS, ...(d.online || {}) }) }
  } catch {
    return { names: START_NAMES, settings: { ...DEFAULTS }, sound: true, online: { ...DEFAULTS } }
  }
}
const saveData = (d) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch {
    // private window: lasts for this visit
  }
  return d
}

export const Logo = () => (
  <div className="ipLogo" aria-label="Imposter">
    <img src={ICON} alt="" width="48" height="48" />
    <span>IMPOSTER</span>
  </div>
)

const HowTo = ({ onClose }) => (
  <Dialog title="How to Play Imposter" onOk={onClose} onCancel={onClose}>
    <div className="ipHow">
      <p>
        <b>Everyone gets the same secret word, except the imposter.</b> Nobody knows who it is.
      </p>
      <ol>
        <li>Look at your card in private (pass the phone around, or each on your own phone online).</li>
        <li>Take turns giving a one-word clue about the word. Crew: prove you know it without giving it away. Imposter: bluff!</li>
        <li>Talk it over, then vote for who you think the imposter is.</li>
        <li>Catch them and the crew wins, unless the caught imposter can name the word and steal it.</li>
      </ol>
      <p className="ipMuted">Under More options: several imposters (or maybe none!), close-word variants, your own words, timers, tie rules, scoring and more.</p>
    </div>
  </Dialog>
)

// ---------- pass-and-play ----------

const useLocal = () => {
  const [, setRev] = useState(0)
  const ref = useRef(null)
  useEffect(() => () => ref.current?.stop(), [])
  const start = (names, settings) => {
    ref.current?.stop()
    const players = names.map((name, id) => ({ id, name }))
    const game = createLocalGame({ settings, players, onChange: () => setRev((r) => r + 1) })
    ref.current = game
    if (import.meta.env.DEV) window.__imposter = game
    setRev((r) => r + 1)
  }
  const stop = () => {
    ref.current?.stop()
    ref.current = null
    setRev((r) => r + 1)
  }
  return { game: ref.current, start, stop }
}

const OnlineScreen = ({ online, sounds, settings, onSettings, onBack }) => {
  const { room } = online
  const playing = room && (room.phase === "playing" || room.phase === "over") && online.view
  // dev builds: tests read this player's view
  if (import.meta.env.DEV) window.__imposterView = online.view
  if (playing) {
    return <OnlineTable key={`${room.id}:${room.round}`} view={online.view} act={online.act} now={online.serverNow} sounds={sounds} footer={room.phase === "over" ? <OnlineResultBar online={online} /> : null} />
  }
  return (
    <div className="ipOnline">
      <PlayOnline
        online={online}
        title="Imposter"
        icon={ICON}
        blurb="3 to 20 players, each on their own phone: make a room, share the code, and say your clues out loud (or type them). The server deals the cards, so nobody can peek."
        defaultSettings={settings}
        onBack={room ? null : onBack}
        renderSettings={(s, set, { disabled }) => (
          <SettingsForm
            settings={s}
            onChange={(next) => {
              set(next)
              onSettings(next)
            }}
            disabled={disabled}
            mode="online"
          />
        )}
      />
    </div>
  )
}

// ---------- the window ----------

const Imposter = ({ mobile = false, onClose }) => {
  const [data, setData] = useState(loadData)
  const [screen, setScreen] = useState("setup") // setup | game | online
  const [dialog, setDialog] = useState(null)
  const sounds = useMemo(() => createSounds(), [])
  const online = useOnlineRoom("imposter")
  const chatItem = useGameChatMenuItem("imposter")
  const local = useLocal()
  const update = (fn) => setData((d) => saveData(fn(d)))

  useEffect(() => sounds.setEnabled(data.sound), [data.sound])
  // an invitation or a join link: straight to the room
  useEffect(() => {
    if (online.room && screen !== "online") {
      local.stop()
      setScreen("online")
    }
  }, [online.room?.id])

  const names = data.names
  const cleanNames = names.map((n, i) => n.trim() || `Player ${i + 1}`)
  const dupes = new Set(cleanNames.filter((n, i) => cleanNames.findIndex((m) => m.toLowerCase() === n.toLowerCase()) !== i))
  const setNames = (list) => update((d) => ({ ...d, names: list }))
  const start = () => {
    local.start(cleanNames, data.settings)
    setScreen("game")
  }
  const goOnline = () => {
    local.stop()
    setScreen("online")
  }
  const mainMenu = () => {
    local.stop()
    if (online.room) online.leave()
    setScreen("setup")
  }

  const menus = [
    {
      label: "Game",
      items: [
        { label: "New Game (pass the phone)", onClick: start },
        { label: "Play Online...", onClick: goOnline },
        "-",
        { label: "Players and Rules", onClick: mainMenu },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    { label: "Options", items: [{ label: "Sound", checked: data.sound, onClick: () => update((d) => ({ ...d, sound: !d.sound })) }, chatItem] },
    { label: "Help", items: [helpItem({ program: "Imposter" }), "-", { label: "How to Play...", onClick: () => setDialog("howto") }] },
  ]

  let body
  if (screen === "online") {
    body = <OnlineScreen online={online} sounds={sounds} settings={data.online} onSettings={(s) => update((d) => ({ ...d, online: validateSettings(s) }))} onBack={mainMenu} />
  } else if (screen === "game" && local.game) {
    body = <LocalTable game={local.game} sounds={sounds} onAgain={start} onSetup={mainMenu} />
  } else {
    body = (
      <form className="ipSetup" onSubmit={(e) => (e.preventDefault(), start())}>
        <Logo />
        <p className="ipTagline">Everyone knows the word. Except one of you.</p>
        <fieldset className="ipPlayers">
          <legend>Players ({names.length})</legend>
          <div className="ipNames">
            {names.map((n, i) => (
              <div key={i} className="ipName">
                <input
                  type="text"
                  value={n}
                  maxLength={16}
                  aria-label={`Player ${i + 1} name`}
                  className={dupes.has(cleanNames[i]) ? "is-dupe" : ""}
                  onChange={(e) => setNames(names.map((m, j) => (j === i ? e.target.value : m)))}
                  onFocus={(e) => /^Player \d+$/.test(n) && e.target.select()}
                  data-name={i}
                />
                <button type="button" aria-label={`Remove ${cleanNames[i]}`} disabled={names.length <= MIN_PLAYERS} onClick={() => setNames(names.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            ))}
          </div>
          <button type="button" disabled={names.length >= MAX_PLAYERS} onClick={() => setNames([...names, `Player ${names.length + 1}`])} data-add>
            Add player
          </button>
          {dupes.size > 0 && <p className="ipError">Two players have the same name.</p>}
        </fieldset>
        <MoreOptions id="imposter.options" className="ipMore" summary={describe(data.settings)}>
          <SettingsForm settings={data.settings} onChange={(s) => update((d) => ({ ...d, settings: validateSettings(s) }))} mode="local" />
          <button type="button" onClick={() => setDialog("howto")}>
            How to Play
          </button>
        </MoreOptions>
        <PrimaryBar className="ipStartBar" align="stretch">
          <button type="submit" className="ipBig ipPrimary" disabled={dupes.size > 0} data-start>
            Start ({names.length} players)
          </button>
        </PrimaryBar>
        <PlayOnlineButton onClick={goOnline} size="small" sub="Each on their own phone, 3 to 20 players" data-online />
      </form>
    )
  }

  return (
    <div className={`ipRoot${mobile ? " is-mobile" : ""}`} data-screen={screen}>
      <MenuBar menus={menus} />
      <GameChat game="imposter" title="Imposter" room={online.chatRoom} />
      <div className="ipBody">{body}</div>
      {dialog === "howto" && <HowTo onClose={() => setDialog(null)} />}
    </div>
  )
}

export default Imposter
