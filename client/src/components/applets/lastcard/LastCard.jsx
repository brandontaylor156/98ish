import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import PlayOnline, { OnlineResultBar, PlayOnlineButton, useOnlineRoom } from "../../shared/online"
import { unlock } from "../../../utils/achievements"
import Card from "./Card"
import Table from "./Table"
import SettingsForm from "./SettingsForm"
import { createLocalGame } from "./local"
import { DEFAULTS, PERSONAS, describeRules, personaFor, validateSettings } from "./cards"
import { createSounds } from "./audio"
import "./LastCard.css"
import { helpItem } from "../../../utils/help"
import MoreOptions from "../../shared/MoreOptions"
import PrimaryBar from "../../shared/PrimaryBar"
import { summarize } from "../../../utils/disclosure"

// Last Card: an original take on the classic "match the color or the number" card game.
// Get rid of your cards first; call "Last Card!" when you're down to one. Play 1-9 computer
// players right here (local.js runs the rules in the browser), or online with 2-10 people
// (server/arcade/games/lastcard.js runs the very same rules on the server). House rules:
// stacking, 7-0, jump-in, draw until you can play, forced play, challenges, extra cards.

const ICON = "/assets/program_icons/lastcard.svg"
const KEY = "98ish.lastcard"
const BOT_NAMES = ["Ada", "Grace", "Alan", "Linus", "Hedy", "Dennis", "Ken", "Barbara", "Margaret"]
const ONLINE_DEFAULTS = { ...DEFAULTS, players: 4, timer: 30 }
const SOLO_DEFAULTS = { ...DEFAULTS, players: 4, timer: 0 }

const loadData = () => {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "{}")
    return { prefs: { sound: true, sort: "color", ...d.prefs }, solo: validateSettings({ ...SOLO_DEFAULTS, ...d.solo }), stats: { played: 0, won: 0, ...d.stats } }
  } catch {
    return { prefs: { sound: true, sort: "color" }, solo: SOLO_DEFAULTS, stats: { played: 0, won: 0 } }
  }
}
const saveData = (d) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch {
    // private window: settings last for this visit
  }
  return d
}

export const Logo = ({ small = false }) => (
  <div className={`lcLogo${small ? " is-small" : ""}`} aria-label="Last Card">
    <div className="lcLogoFan" aria-hidden="true">
      <Card card={{ id: 1, c: "b", v: "rev" }} />
      <Card card={{ id: 2, c: "r", v: "7" }} />
      <Card card={{ id: 3, c: "w", v: "wild" }} />
      <Card card={{ id: 4, c: "y", v: "d2" }} />
    </div>
    <div className="lcLogoWord">
      <span>LAST</span>
      <span>CARD</span>
    </div>
  </div>
)

const HowTo = ({ onClose }) => (
  <Dialog title="How to Play Last Card" onOk={onClose} onCancel={onClose}>
    <div className="lcHow">
      <p>
        <b>Get rid of all your cards.</b> On your turn, play a card that matches the top card's <b>color</b> or its <b>number or symbol</b>, or play a <b>Wild</b> and pick the color. Nothing fits? Draw a card.
      </p>
      <ul>
        <li>
          <b>Skip</b>: the next player misses a turn. <b>Reverse</b>: play changes direction (with two players it's a Skip).
        </li>
        <li>
          <b>Draw Two</b>: the next player draws 2 and misses a turn. <b>Wild Draw Four</b>: pick a color; the next player draws 4 and misses a turn, unless they challenge it and you were bluffing (you had the color in play).
        </li>
        <li>
          Down to your last card? Press <b>LAST CARD!</b> before you play your next-to-last card. Forget, and anyone can <b>Catch</b> you for 3 seconds: you draw 2.
        </li>
        <li>Go out first to win the round: you score the points left in everyone's hands (numbers at face value, action cards 20, wilds 50). First to the target wins.</li>
      </ul>
      <p className="lcMuted">Tap or drag a card up to play it. D draws, K keeps a drawn card. House rules (stacking, 7-0, jump-in and more) are under Game &gt; House Rules, and in every online room.</p>
    </div>
  </Dialog>
)

// ---------- a game against the computer ----------

const useLocal = (onDone) => {
  const [game, setGame] = useState(null) // { id, settings, players, view, result }
  const ref = useRef(null)
  useEffect(() => () => ref.current?.local?.stop(), [])
  const stop = () => {
    ref.current?.local?.stop()
    ref.current = null
    setGame(null)
  }
  const start = (settings) => {
    ref.current?.local?.stop()
    const clean = validateSettings(settings)
    if (clean.error) return clean
    const players = Array.from({ length: clean.players }, (_, i) => (i === 0 ? { id: 0, name: "You", bot: false } : { id: i, name: BOT_NAMES[i - 1], bot: true }))
    const entry = { id: Date.now(), settings: clean, players, local: null }
    ref.current = entry
    const update = (g) => {
      if (ref.current !== entry) return
      setGame({ ...entry, local: g, view: g.view(0), result: g.result })
      if (g.result && !entry.done) {
        entry.done = true
        onDone?.(g.result, entry)
      }
    }
    entry.local = createLocalGame({ settings: clean, players, onChange: update })
    // dev builds: tests reach the game (window.__lastcard.state, .act(action, seat))
    if (import.meta.env.DEV) window.__lastcard = entry.local
    update(entry.local)
    return { ok: true }
  }
  const act = (action) => Promise.resolve(ref.current?.local ? ref.current.local.act(action) : { ok: false, error: "No game." })
  return { game, start, stop, act }
}

// ---------- online ----------

const OnlineScreen = ({ online, sounds, mobile, sort, onBack, onEvent }) => {
  const { room } = online
  const playing = room && (room.phase === "playing" || room.phase === "over") && online.view
  const wonRef = useRef(null)
  useEffect(() => {
    if (room?.phase === "over" && room.result?.winners?.includes(room.you) && wonRef.current !== room.round) {
      wonRef.current = room.round
      if (room.seats.filter((s) => s && !s.bot).length > 1) unlock("lastcard-online")
    }
  }, [room?.phase, room?.round])
  if (playing) {
    return (
      <Table
        key={`${room.id}:${room.round}`}
        view={online.view}
        seats={room.seats}
        act={online.act}
        serverNow={online.serverNow}
        sounds={sounds}
        mobile={mobile}
        sort={sort}
        onEvent={onEvent}
        footer={room.phase === "over" ? <OnlineResultBar online={online} /> : null}
      />
    )
  }
  return (
    <div className="lcOnline">
      <PlayOnline
        online={online}
        title="Last Card"
        icon={ICON}
        blurb="2 to 10 players: Quick Match with anyone, or make a room, pick your house rules and share the code. Computer players fill empty seats."
        defaultSettings={ONLINE_DEFAULTS}
        computer
        onBack={room ? null : onBack}
        renderSettings={(s, set, { disabled }) => <SettingsForm settings={s} onChange={set} disabled={disabled} mode="online" />}
      />
    </div>
  )
}

// ---------- the window ----------

const LastCard = ({ mobile = false, onClose }) => {
  const [data, setData] = useState(loadData)
  const prefs = data.prefs
  const [screen, setScreen] = useState("title") // title | rules | game | online
  const [dialog, setDialog] = useState(null)
  const [rulesDraft, setRulesDraft] = useState(data.solo)
  const sounds = useMemo(() => createSounds(), [])
  const online = useOnlineRoom("lastcard")
  const chatItem = useGameChatMenuItem("lastcard")
  const update = (fn) => setData((d) => saveData(fn(d)))
  const setPref = (patch) => update((d) => ({ ...d, prefs: { ...d.prefs, ...patch } }))

  const local = useLocal((result, entry) => {
    const won = result.winners?.includes(0)
    update((d) => ({ ...d, stats: { played: d.stats.played + 1, won: d.stats.won + (won ? 1 : 0) } }))
    if (won) unlock("lastcard-win")
    if (won && entry.settings.players >= 6) unlock("lastcard-crowd")
  })

  useEffect(() => {
    sounds.setEnabled(prefs.sound)
  }, [prefs.sound])

  // an invitation or a join link: straight to the room
  useEffect(() => {
    if (online.room && screen !== "online") {
      local.stop()
      setScreen("online")
    }
  }, [online.room?.id])

  const startSolo = (settings = data.solo) => {
    update((d) => ({ ...d, solo: settings }))
    const result = local.start(settings)
    if (result.ok) setScreen("game")
  }
  const goOnline = () => {
    local.stop()
    setScreen("online")
  }
  const mainMenu = () => {
    local.stop()
    if (online.room) online.leave()
    setScreen("title")
  }
  const onEvent = (e) => {
    const you = screen === "online" ? online.room?.you : 0
    if (e.t === "catch" && e.by === you) unlock("lastcard-catch")
  }

  const menus = [
    {
      label: "Game",
      items: [
        { label: "New Game vs. Computer", onClick: () => startSolo() },
        { label: "Play Online...", onClick: goOnline },
        "-",
        { label: "House Rules...", onClick: () => (setRulesDraft(data.solo), setScreen("rules")) },
        { label: "Main Menu", onClick: mainMenu },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Options",
      items: [
        { label: "Sort by Color", checked: prefs.sort === "color", onClick: () => setPref({ sort: "color" }) },
        { label: "Sort by Number", checked: prefs.sort === "value", onClick: () => setPref({ sort: "value" }) },
        "-",
        { label: "Sound", checked: prefs.sound, onClick: () => setPref({ sound: !prefs.sound }) },
        chatItem,
      ],
    },
    {
      label: "Help",
      items: [helpItem({ program: "Last Card" }), "-",
        { label: "How to Play...", onClick: () => setDialog("howto") },
        { label: "About Last Card...", onClick: () => setDialog("about") },
      ],
    },
  ]

  const g = local.game
  let body
  if (screen === "online") {
    body = <OnlineScreen online={online} sounds={sounds} mobile={mobile} sort={prefs.sort} onEvent={onEvent} onBack={mainMenu} />
  } else if (screen === "game" && g?.view) {
    const footer = g.result ? (
      <div className="lcRowBtns lcSoloEnd">
        <b>{g.result.winners.includes(0) ? "You win!" : `${g.players[g.result.winners[0]].name} wins.`}</b>
        <button type="button" className="lcPrimary" onClick={() => startSolo(g.settings)} data-again>
          Play Again
        </button>
        <button type="button" onClick={() => (setRulesDraft(g.settings), setScreen("rules"))}>
          House Rules
        </button>
        <button type="button" onClick={mainMenu}>
          Main Menu
        </button>
      </div>
    ) : null
    body = <Table key={g.id} view={g.view} seats={g.players} act={local.act} sounds={sounds} mobile={mobile} sort={prefs.sort} onEvent={onEvent} footer={footer} />
  } else if (screen === "rules") {
    body = (
      <form
        className="lcSetup"
        onSubmit={(e) => {
          e.preventDefault()
          startSolo(validateSettings(rulesDraft))
        }}
      >
        <h2>Play the Computer</h2>
        <p className="lcMuted">Pick your opponents and house rules. Everything runs right here, no internet needed.</p>
        <SettingsForm settings={rulesDraft} onChange={setRulesDraft} mode="solo" />
        {/* Deal! stays on screen however long the house rules get (docs/simplicity.md) */}
        <PrimaryBar className="lcRowBtns lcSetupBar" align="end">
          <button type="submit" className="lcPrimary" data-start>
            Deal!
          </button>
          <button type="button" onClick={() => setScreen("title")}>
            Back
          </button>
        </PrimaryBar>
      </form>
    )
  } else {
    const s = data.solo
    const opponents = s.players - 1
    const setSolo = (patch) => update((d) => ({ ...d, solo: validateSettings({ ...d.solo, ...patch }) }))
    body = (
      <div className="lcTitle">
        <Logo />
        <p className="lcTagline">Match the color. Match the number. Don't get caught with one card.</p>
        {/* the shared launcher pattern (docs/simplicity.md): Play, Play Online, then the
            table's settings, House Rules and How to Play under More options */}
        <div className="lcSoloBox">
          <button type="button" className="lcBigBtn" onClick={() => startSolo()} data-solo>
            <b>Play the Computer</b>
            <small>
              {opponents} opponent{opponents === 1 ? "" : "s"} · {s.bots} · {describeRules(s)}
            </small>
          </button>
        </div>
        <PlayOnlineButton onClick={goOnline} sub="Quick Match, private rooms, 2 to 10 players" className="lcOnlineBtn" data-online />
        <MoreOptions id="lastcard.options" className="lcMore" summary={summarize(`${opponents} opponent${opponents === 1 ? "" : "s"}`, s.bots[0].toUpperCase() + s.bots.slice(1), describeRules(s))}>
          <div className="lcSoloBox">
            <div className="lcQuick">
              <span>Opponents</span>
              <span className="lcStepper">
                <button type="button" aria-label="Fewer opponents" disabled={opponents <= 1} onClick={() => setSolo({ players: s.players - 1 })}>
                  −
                </button>
                <b data-opponents>{opponents}</b>
                <button type="button" aria-label="More opponents" disabled={opponents >= 9} onClick={() => setSolo({ players: s.players + 1 })}>
                  +
                </button>
              </span>
              <select value={s.bots} onChange={(e) => setSolo({ bots: e.target.value })} aria-label="Difficulty">
                <option value="easy">Easy</option>
                <option value="normal">Normal</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <div className="lcFaces" aria-hidden="true">
              {BOT_NAMES.slice(0, opponents).map((name) => (
                <span key={name} title={`${name}: ${PERSONAS[personaFor(name)].text}`}>
                  {name}
                  <small>{PERSONAS[personaFor(name)].label}</small>
                </span>
              ))}
            </div>
          </div>
          <div className="lcRowBtns">
            <button type="button" onClick={() => (setRulesDraft(data.solo), setScreen("rules"))} data-rules>
              House Rules...
            </button>
            <button type="button" onClick={() => setDialog("howto")}>
              How to Play
            </button>
          </div>
        </MoreOptions>
        {data.stats.played > 0 && (
          <p className="lcMuted">
            Won {data.stats.won} of {data.stats.played} games against the computer.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={`lcRoot${mobile ? " is-mobile" : ""}`} data-screen={screen}>
      <MenuBar menus={menus} />
      <GameChat game="lastcard" title="Last Card" room={online.chatRoom} />
      <div className="lcBody">{body}</div>
      {dialog === "howto" && <HowTo onClose={() => setDialog(null)} />}
      {dialog === "about" && (
        <Dialog title="About Last Card" onOk={() => setDialog(null)} onCancel={() => setDialog(null)}>
          <div className="lcHow">
            <Logo small />
            <p>Last Card 98, a card game for 2 to 10 players.</p>
            <p className="lcMuted">An original game with its own cards, in the tradition of the classic shedding games played at kitchen tables everywhere.</p>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default LastCard
