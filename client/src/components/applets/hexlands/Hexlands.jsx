import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import PlayOnline, { OnlineResultBar, PlayOnlineButton, useOnlineRoom } from "../../shared/online"
import { unlock } from "../../../utils/achievements"
import Table from "./Table.jsx"
import Tutorial from "./Tutorial.jsx"
import SettingsForm from "./SettingsForm.jsx"
import { createLocalGame } from "./local.js"
import { DEFAULTS, describeSettings, validateSettings } from "./logic.js"
import { PERSONAS, chooseAction, personaFor } from "./bot.js"
import { BoardDefs, CityPiece, HEX_POINTS, LogoMark, SettlementPiece, Tile } from "./art.jsx"
import { geometry } from "./board.js"
import { createSounds } from "./audio.js"
import "./Hexlands.css"
import { helpItem } from "../../../utils/help"
import MoreOptions from "../../shared/MoreOptions"
import PrimaryBar from "../../shared/PrimaryBar"
import { summarize } from "../../../utils/disclosure"

// Hexlands: an original settle-and-trade island game. Collect timber, clay, wool, grain and
// ore from the tiles around your settlements, build, trade and race to 10 points. Play 1-5
// computer players right here (local.js runs the rules in the browser), or online with 2-6
// people (server/arcade/games/hexlands.js runs the very same rules on the server).

const ICON = "/assets/program_icons/hexlands.svg"
const KEY = "98ish.hexlands"
// five computer players with five different personalities (bot.js personaFor)
const BOT_NAMES = ["Ada", "Alan", "Hedy", "Ken", "Linus"]
const SOLO_DEFAULTS = { ...DEFAULTS, players: 4, timer: 0 }
const ONLINE_DEFAULTS = { ...DEFAULTS, players: 4, timer: 90 }
const COACH_GAME = { ...DEFAULTS, players: 3, level: "easy", layout: "beginner", timer: 0 }

const loadData = () => {
  const fallback = { prefs: { sound: true, tips: true }, solo: SOLO_DEFAULTS, stats: { played: 0, won: 0 } }
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "{}")
    const solo = validateSettings({ ...SOLO_DEFAULTS, ...d.solo })
    return { prefs: { ...fallback.prefs, ...d.prefs }, solo: solo.error ? SOLO_DEFAULTS : solo, stats: { ...fallback.stats, ...d.stats } }
  } catch {
    return fallback
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
  <div className={`hxLogo${small ? " is-small" : ""}`} aria-label="Hexlands">
    <LogoMark size={small ? 48 : 92} />
    <div className="hxLogoWord">
      <span>HEX</span>
      <span>LANDS</span>
    </div>
  </div>
)

// a little island along the bottom of the title screen
const TITLE_TILES = [
  ["fields", -6, 0.75],
  ["forest", -5, 0.75],
  ["hills", -5.5, 0],
  ["pasture", -4, 0.75],
  ["mountains", -6.5, 0],
  ["pasture", 4, 0.75],
  ["forest", 5, 0.75],
  ["fields", 5.5, 0],
  ["mountains", 6, 0.75],
  ["forest", 6.5, 0],
]
const W = 173.2
const TitleIsland = () => (
  <svg className="hxTitleIsland" viewBox="-1250 -280 2500 460" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    <BoardDefs />
    {TITLE_TILES.map(([t, x, y], i) => (
      <polygon key={`s${i}`} points={HEX_POINTS} transform={`translate(${x * W} ${y * 200}) scale(1.1)`} fill="#e8d59c" />
    ))}
    {TITLE_TILES.map(([t, x, y], i) => (
      <Tile key={i} t={t} x={x * W} y={y * 200} seed={i * 7 + 3} />
    ))}
    <SettlementPiece x={-5 * W} y={-50} fill="#d23b2f" dark="#7c1a14" scale={1.7} />
    <CityPiece x={5 * W} y={-50} fill="#2f67cf" dark="#13306b" scale={1.5} />
  </svg>
)

// ---------- a game against the computer ----------

const useLocal = (onDone) => {
  const [game, setGame] = useState(null)
  const ref = useRef(null)
  useEffect(() => () => ref.current?.local?.stop(), [])
  const stop = () => {
    ref.current?.local?.stop()
    ref.current = null
    setGame(null)
  }
  const start = (settings, { coach = false } = {}) => {
    ref.current?.local?.stop()
    const clean = validateSettings(settings)
    if (clean.error) return clean
    const players = Array.from({ length: clean.players }, (_, i) => (i === 0 ? { id: 0, name: "You", bot: false } : { id: i, name: BOT_NAMES[i - 1], bot: true }))
    const entry = { id: Date.now(), settings: clean, players, coach, local: null, done: false }
    ref.current = entry
    const update = (g) => {
      if (ref.current !== entry) return
      setGame({ ...entry, local: g, view: g.view(0), result: g.result })
      if (g.result && !entry.done) {
        entry.done = true
        onDone?.(g.result, entry)
      }
    }
    entry.local = createLocalGame({ settings: clean, players, onChange: update, speed: entry.speed || 1 })
    update(entry.local)
    return { ok: true }
  }
  const act = (action) => Promise.resolve(ref.current?.local ? ref.current.local.act(action) : { ok: false, error: "No game." })
  return { game, start, stop, act, ref }
}

// ---------- online ----------

const OnlineScreen = ({ online, sounds, mobile, coach, onBack, onEvent }) => {
  const { room } = online
  const playing = room && (room.phase === "playing" || room.phase === "over") && online.view
  const wonRef = useRef(null)
  useEffect(() => {
    if (room?.phase === "over" && room.result?.winners?.includes(room.you) && wonRef.current !== room.round) {
      wonRef.current = room.round
      if (room.seats.filter((s) => s && !s.bot).length > 1) unlock("hexlands-online")
    }
  }, [room?.phase, room?.round])
  if (playing) {
    const names = room.seats.map((s) => s?.name || null)
    return (
      <Table
        key={`${room.id}:${room.round}`}
        view={online.view}
        names={names}
        seats={room.seats}
        act={online.act}
        serverNow={online.serverNow}
        sounds={sounds}
        mobile={mobile}
        coach={coach}
        onEvent={onEvent}
        endFooter={room.phase === "over" ? <OnlineResultBar online={online} /> : null}
      />
    )
  }
  return (
    <div className="hxOnline">
      <PlayOnline
        online={online}
        title="Hexlands"
        icon={ICON}
        blurb="2 to 6 players: Quick Match with anyone, or make a room, pick the map and rules and share the code. Computer players fill empty seats and take over for anyone who drops out."
        defaultSettings={ONLINE_DEFAULTS}
        computer
        onBack={room ? null : onBack}
        renderSettings={(s, set, { disabled }) => <SettingsForm settings={s} onChange={set} disabled={disabled} mode="online" />}
      />
    </div>
  )
}

// ---------- the window ----------

const Hexlands = ({ mobile = false, onClose }) => {
  const [data, setData] = useState(loadData)
  const prefs = data.prefs
  const [screen, setScreen] = useState("title") // title | setup | game | online | tutorial
  const [dialog, setDialog] = useState(null)
  const [draft, setDraft] = useState(data.solo)
  const sounds = useMemo(() => createSounds(), [])
  const online = useOnlineRoom("hexlands")
  const chatItem = useGameChatMenuItem("hexlands")
  const update = (fn) => setData((d) => saveData(fn(d)))
  const setPref = (patch) => update((d) => ({ ...d, prefs: { ...d.prefs, ...patch } }))

  const local = useLocal((result, entry) => {
    const won = result.winners?.includes(0)
    if (!entry.coach) update((d) => ({ ...d, stats: { played: d.stats.played + 1, won: d.stats.won + (won ? 1 : 0) } }))
    if (won) unlock("hexlands-win")
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

  const startSolo = (settings = data.solo, opts = {}) => {
    if (online.room) online.leave()
    if (!opts.coach) update((d) => ({ ...d, solo: settings }))
    const result = local.start(settings, opts)
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
    if (e.k === "army" && e.p === you) unlock("hexlands-patrol")
  }

  // dev-only hooks for browser tests: drive the local game
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__hexlands = {
      screen,
      start: (settings, opts) => startSolo(validateSettings({ ...SOLO_DEFAULTS, ...settings }), opts),
      state: () => local.ref.current?.local?.state || null,
      view: () => local.ref.current?.local?.view(0) || online.view || null,
      act: (a, seat = 0) => local.ref.current?.local?.act(a, seat),
      speed: (n) => {
        if (local.ref.current) local.ref.current.speed = n
        local.ref.current?.local?.setSpeed(n)
      },
      // the computer plays your seat too (a whole game, hands off)
      autoplay: () => {
        const entry = local.ref.current
        if (!entry) return false
        entry.players[0].bot = true
        entry.local.setSpeed(entry.speed || 1)
        return true
      },
      poke: (fn) => local.ref.current?.local?.poke(fn),
      geometry,
      online: () => online.view,
      onlineAct: (a) => online.act(a),
      // what a computer player would do in your seat now
      suggest: () => {
        const v = online.view || local.ref.current?.local?.view(0)
        return v ? chooseAction(v, v.you, { level: "normal" }) : null
      },
    }
  })

  const menus = [
    {
      label: "Game",
      items: [
        { label: "New Game vs. Computer", onClick: () => startSolo() },
        { label: "Play Online...", onClick: goOnline },
        "-",
        { label: "Game Settings...", onClick: () => (setDraft(data.solo), setScreen("setup")) },
        { label: "Main Menu", onClick: mainMenu },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Options",
      items: [
        { label: "Sound", checked: prefs.sound, onClick: () => setPref({ sound: !prefs.sound }) },
        { label: "Show Tips", checked: prefs.tips, onClick: () => setPref({ tips: !prefs.tips }) },
        chatItem,
      ],
    },
    {
      label: "Help",
      items: [helpItem({ program: "Hexlands" }), "-",
        // mid-game, the summary (the step-by-step lesson would end the game)
        { label: "How to Play...", onClick: () => (screen === "game" || screen === "online" ? setDialog("rules") : setScreen("tutorial")) },
        { label: "Rules Summary...", onClick: () => setDialog("rules") },
        { label: "About Hexlands...", onClick: () => setDialog("about") },
      ],
    },
  ]

  const g = local.game
  let body
  if (screen === "online") {
    body = <OnlineScreen online={online} sounds={sounds} mobile={mobile} coach={prefs.tips} onEvent={onEvent} onBack={mainMenu} />
  } else if (screen === "game" && g?.view) {
    const endFooter = (
      <div className="hxRow hxEndBtns">
        <button type="button" className="hxGo" onClick={() => startSolo(g.coach ? { ...data.solo } : g.settings)} data-again>
          Play again
        </button>
        <button type="button" onClick={() => (setDraft(g.settings), setScreen("setup"))}>
          Change settings
        </button>
        <button type="button" onClick={mainMenu}>
          Main menu
        </button>
      </div>
    )
    body = <Table key={g.id} view={g.view} names={g.players.map((p) => p.name)} seats={g.players} act={local.act} sounds={sounds} mobile={mobile} coach={g.coach || prefs.tips} endFooter={endFooter} onEvent={onEvent} />
  } else if (screen === "tutorial") {
    body = <Tutorial onClose={() => setScreen("title")} onCoachGame={() => startSolo(COACH_GAME, { coach: true })} />
  } else if (screen === "setup") {
    body = (
      <form
        className="hxSetup"
        onSubmit={(e) => {
          e.preventDefault()
          const clean = validateSettings(draft)
          if (!clean.error) startSolo(clean)
        }}
      >
        <h2>Play the Computer</h2>
        <p className="hxMuted">Pick your opponents, the island and the house rules. Everything runs right here, no internet needed.</p>
        <SettingsForm settings={draft} onChange={setDraft} mode="solo" />
        {/* Start game stays on screen however long the settings get (docs/simplicity.md) */}
        <PrimaryBar className="hxRow hxSetupBar" align="end">
          <button type="submit" className="hxGo" data-start>
            Start game
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
    const setSolo = (patch) => update((d) => ({ ...d, solo: validateSettings({ ...d.solo, ...patch, deck: patch.players ? null : d.solo.deck }) }))
    body = (
      <div className="hxTitle">
        <div className="hxTitleSea" aria-hidden="true" />
        <TitleIsland />
        <Logo />
        <p className="hxTagline">Settle the island. Trade with your rivals. Build your way to 10 points.</p>
        {/* the shared launcher pattern (docs/simplicity.md): Play, Play Online, then the
            table's settings, How to Play and Settings... under More options */}
        <div className="hxSoloBox">
          <button type="button" className="hxBigBtn" onClick={() => startSolo()} data-solo>
            <b>Play the Computer</b>
            <small>{describeSettings(s)}</small>
          </button>
        </div>
        <PlayOnlineButton onClick={goOnline} sub="Quick Match, private rooms, 2 to 6 players" className="hxOnlineBtn" data-online />
        <MoreOptions id="hexlands.options" className="hxMore" summary={summarize(`${opponents} opponent${opponents === 1 ? "" : "s"}`, s.level[0].toUpperCase() + s.level.slice(1))}>
          <div className="hxSoloBox">
            <div className="hxQuick">
              <span>Opponents</span>
              <span className="hxStepper">
                <button type="button" aria-label="Fewer opponents" disabled={opponents <= 1} onClick={() => setSolo({ players: s.players - 1 })}>
                  −
                </button>
                <b data-opponents>{opponents}</b>
                <button type="button" aria-label="More opponents" disabled={opponents >= 5} onClick={() => setSolo({ players: s.players + 1 })}>
                  +
                </button>
              </span>
              <select value={s.level} onChange={(e) => setSolo({ level: e.target.value })} aria-label="Difficulty">
                <option value="easy">Easy</option>
                <option value="normal">Normal</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <div className="hxFaces" aria-hidden="true">
              {BOT_NAMES.slice(0, opponents).map((name) => (
                <span key={name} title={`${name}: ${PERSONAS[personaFor(name)].text}`}>
                  {name}
                  <small>{PERSONAS[personaFor(name)].label}</small>
                </span>
              ))}
            </div>
          </div>
          <div className="hxRow">
            <button type="button" onClick={() => setScreen("tutorial")} data-howto>
              How to Play
            </button>
            <button type="button" onClick={() => (setDraft(data.solo), setScreen("setup"))} data-settings>
              Settings...
            </button>
          </div>
        </MoreOptions>
        {data.stats.played > 0 && (
          <p className="hxMuted">
            Won {data.stats.won} of {data.stats.played} games against the computer.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={`hxRoot${mobile ? " is-mobile" : ""}`} data-screen={screen}>
      <MenuBar menus={menus} />
      <GameChat game="hexlands" title="Hexlands" room={online.chatRoom} />
      <div className="hxBody">{body}</div>
      {dialog === "rules" && (
        <Dialog title="Hexlands Rules" onOk={() => setDialog(null)} onCancel={() => setDialog(null)}>
          <div className="hxHow">
            <p>
              <b>Goal:</b> be the first to reach the target (10 points), on your own turn.
            </p>
            <p>
              <b>Setup:</b> in turn order each player places a settlement and a road, then again in reverse order. Your second settlement collects one of each resource around it.
            </p>
            <p>
              <b>Your turn:</b> roll the dice (tiles with that number pay their corners: 1 per settlement, 2 per city), then trade and build as you like, then end your turn.
            </p>
            <p>
              <b>Costs:</b> road = timber + clay. Settlement = timber + clay + wool + grain. City = 2 grain + 3 ore. Development card = wool + grain + ore.
            </p>
            <p>
              <b>Sevens:</b> anyone with more than 7 cards discards half; the roller moves the Bandit (it blocks a tile) and takes a card from someone next to it.
            </p>
            <p>
              <b>Points:</b> settlement 1, city 2, Longest Road (5+) 2, Largest Patrol (3+ Rangers) 2, Monument 1.
            </p>
            <p className="hxMuted">For a step-by-step lesson with a practice island, choose How to Play on the main menu.</p>
          </div>
        </Dialog>
      )}
      {dialog === "about" && (
        <Dialog title="About Hexlands" onOk={() => setDialog(null)} onCancel={() => setDialog(null)}>
          <div className="hxHow">
            <Logo small />
            <p>Hexlands 98, an island-settling game for 2 to 6 players.</p>
            <p className="hxMuted">An original game with its own map, art and cards, in the tradition of the classic resource-trading board games.</p>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default Hexlands
