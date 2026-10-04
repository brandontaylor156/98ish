import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import PlayOnline, { OnlineResultBar, PlayOnlineButton, useOnlineRoom } from "../../shared/online"
import { unlock } from "../../../utils/achievements"
import Board from "./Board"
import { Card } from "./Card"
import CardArt from "./CardArt"
import DeckBuilder from "./DeckBuilder"
import Packs from "./Packs"
import Rules from "./Rules"
import { CARD } from "./engine/cards"
import { STARTERS } from "./engine/decks"
import { BEST_OF, LIFE_POINTS, TURN_TIMES } from "./engine/rules"
import { createLocalMatch } from "./local"
import { LEVEL_NAMES, OPPONENTS, opponentById } from "./opponents"
import { createSounds } from "./audio"
import { STEPS, TUTORIAL_YOU, tutorialBot } from "./tutorial"
import { collectionProgress, deckFor, load, recordResult, savePrefs, update } from "./storage"
import "./MonsterDuel.css"
import "./Screens.css"
import { helpItem } from "../../../utils/help"

// Monster Duel: a trading card duel. Summon monsters, set traps, chain spells, and bring
// your opponent's Life Points to 0. Duel the computer (eight opponents, three levels) to
// earn card packs, build decks from what you pull, or Play Online (server/arcade/games/
// monsterduel.js) with Quick Match, rooms with codes, and best-of-three matches. The rules
// are engine/*.js, shared with the server.

const ICON = "/assets/program_icons/monsterduel.svg"
const ONLINE_DEFAULTS = { bestOf: 1, turnTime: 180, lp: 8000 }
const TIME_NAMES = { 0: "No limit", 60: "1 minute", 120: "2 minutes", 180: "3 minutes", 300: "5 minutes" }

export const Logo = ({ small = false }) => (
  <div className={`mdLogo${small ? " is-small" : ""}`} aria-label="Monster Duel">
    <span className="mdLogoTop">MONSTER</span>
    <span className="mdLogoBottom">DUEL</span>
  </div>
)

const Avatar = ({ opp, size = 44 }) => {
  const starter = STARTERS.find((s) => s.id === opp.deck)
  return (
    <span className="mdAvatar" style={{ width: size, height: size, "--ring": opp.color }}>
      {starter && CARD[starter.icon] ? <CardArt card={CARD[starter.icon]} /> : null}
      <b>{opp.glyph}</b>
    </span>
  )
}

// every deck you could play: the starters, then your own
const deckChoices = (data) => [...STARTERS.map((s) => ({ key: `starter:${s.id}`, name: s.name, note: "Starter deck", color: s.color, icon: s.icon })), ...data.decks.map((d) => ({ key: `deck:${d.id}`, name: d.name, note: `${d.main.length} cards`, color: "#555", icon: d.main.find((id) => CARD[id]?.kind === "monster") }))]

const DeckList = ({ data, value, onChange, compact = false }) => (
  <div className={`mdDeckList${compact ? " is-compact" : ""}`} role="radiogroup" aria-label="Your deck">
    {deckChoices(data).map((c) => (
      <button key={c.key} type="button" role="radio" aria-checked={value === c.key} className={`mdDeckChoice${value === c.key ? " is-on" : ""}`} onClick={() => onChange(c.key)} style={{ "--deck": c.color }} data-deck={c.key}>
        <span className="mdDeckChoiceArt">{c.icon && CARD[c.icon] && <CardArt card={CARD[c.icon]} />}</span>
        <span className="mdDeckChoiceText">
          <b>{c.name}</b>
          <small>{c.note}</small>
        </span>
      </button>
    ))}
  </div>
)

// ---------- duels against the computer (and the tutorial) ----------

const resultText = (reason, won) =>
  reason === "deckout" ? (won ? "Your opponent ran out of cards." : "You ran out of cards to draw.") : reason === "surrender" ? (won ? "Your opponent surrendered." : "You surrendered.") : reason === "left" ? "Your opponent left." : won ? "Their Life Points hit 0!" : "Your Life Points hit 0."

const LocalDuel = ({ config, data, setData, sounds, mobile, onExit, onAgain, onPacks, control }) => {
  const [view, setView] = useState(null)
  const [step, setStep] = useState(0)
  const [reward, setReward] = useState(null)
  const matchRef = useRef(null)
  const finishedRef = useRef(false)
  const recorded = useRef(false)
  const tut = !!config.tutorial
  const opp = config.opponent

  useEffect(() => {
    finishedRef.current = false
    recorded.current = false
    setStep(0)
    setReward(null)
    const m = createLocalMatch({
      players: [{ name: "You" }, { name: tut ? "Coach Bramble" : opp.name, bot: true }],
      settings: { bestOf: config.bestOf || 1, turnTime: config.turnTime || 0, lp: config.lp || 8000, tutorial: tut },
      ai: [null, tut ? null : { level: opp.level, style: opp.style, deck: opp.deck }],
      pace: data.prefs.pace,
      botFor: tut ? tutorialBot(() => finishedRef.current) : null,
      onChange: (mm) => setView(mm.view(0)),
    })
    matchRef.current = m
    if (control) control.current = { surrender: () => m.act({ type: "surrender" }) }
    // dev hook for browser tests: let the computer play your side too
    if (import.meta.env?.DEV) window.__mdLocal = m
    const deck = tut ? { main: TUTORIAL_YOU, extra: [], name: "Tutorial Deck" } : config.deck
    const picked = m.act(deck.starter ? { type: "deck", starter: deck.starter } : { type: "deck", main: deck.main, extra: deck.extra || [], name: deck.name })
    // a saved deck that no longer passes the deck rules would leave the duel on "Shuffling..."
    // forever: play a starter deck instead
    if (picked && picked.ok === false) m.act({ type: "deck", starter: STARTERS[0].id })
    m.act({ type: "prefs", respond: tut ? "auto" : data.prefs.respond })
    return () => m.stop()
  }, [config.key])

  useEffect(() => {
    matchRef.current?.setPace(data.prefs.pace)
  }, [data.prefs.pace])

  // the tutorial moves on when the duel shows the lesson happened
  const d = view?.duel
  useEffect(() => {
    if (!tut || !d) return
    let i = step
    while (i < STEPS.length && !STEPS[i].next && STEPS[i].done?.(d)) i++
    if (i !== step) setStep(i)
  }, [d, step, tut])

  const finishTutorial = useCallback(() => {
    finishedRef.current = true
    setStep(STEPS.length)
    if (!load().tutorialDone) {
      setData(update((x) => ({ ...x, tutorialDone: true, packs: x.packs + 3 })))
      unlock("monsterduel-tutorial")
      setReward({ packs: 3, tutorial: true })
    }
  }, [setData])

  // a finished match: record it, hand out packs
  useEffect(() => {
    if (view?.stage !== "over" || recorded.current) return
    recorded.current = true
    const won = view.winner === 0
    const draw = view.winner == null
    if (won) sounds.win()
    else if (!draw) sounds.lose()
    if (tut) {
      if (!finishedRef.current) finishTutorial()
      return
    }
    const { data: next, earned } = recordResult({ won, draw, opponent: opp.id, packs: opp.packs })
    setData(next)
    if (won) {
      unlock("monsterduel-win")
      if (opp.level === "hard") unlock("monsterduel-hard")
    }
    setReward((r) => ({ ...r, packs: earned }))
  }, [view?.stage])

  const act = useCallback((move) => Promise.resolve(matchRef.current ? matchRef.current.act(move) : { ok: false, error: "No duel." }), [])

  if (!view || !view.duel) return <div className="mdLoading">Shuffling...</div>

  const s = tut && step < STEPS.length ? STEPS[step] : null
  const tutorial = s
    ? {
        title: s.title,
        text: s.text,
        where: s.where,
        glow: (s.glow?.(d) || []).filter(Boolean),
        allow: (m) => !!s.allow?.(m, d),
        nope: "Follow the hint in the yellow box for now.",
        next: s.next ? () => (step === STEPS.length - 1 ? finishTutorial() : setStep(step + 1)) : null,
        nextLabel: s.nextLabel,
      }
    : null

  let overlay = null
  if (view.stage === "over") {
    const won = view.winner === 0
    const draw = view.winner == null
    overlay = (
      <div className={`mdOver ${draw ? "is-draw" : won ? "is-win" : "is-lose"}`} data-result={draw ? "draw" : won ? "win" : "lose"}>
        <div className="mdOverTitle">{draw ? "DRAW" : won ? "VICTORY!" : "DEFEAT"}</div>
        <p>{resultText(view.reason, won)}</p>
        {view.settings.bestOf > 1 && (
          <p>
            Match: {view.wins[0]} - {view.wins[1]}
          </p>
        )}
        {reward?.packs > 0 && (
          <div className="mdOverPacks">
            <span className="mdPackIcon" />
            {reward.tutorial ? `Tutorial complete! You earned ${reward.packs} card packs.` : `You earned ${reward.packs} card pack${reward.packs > 1 ? "s" : ""}!`}
          </div>
        )}
        <div className="mdOverBtns">
          {reward?.packs > 0 && (
            <button type="button" onClick={onPacks} data-open-packs>
              Open Packs
            </button>
          )}
          {!tut && (
            <button type="button" onClick={onAgain} data-again>
              Rematch
            </button>
          )}
          <button type="button" onClick={onExit} data-menu>
            Main Menu
          </button>
        </div>
      </div>
    )
  } else if (view.stage === "between") {
    const last = view.results[view.results.length - 1]
    overlay = (
      <div className={`mdOver ${last?.winner === 0 ? "is-win" : "is-lose"}`}>
        <div className="mdOverTitle">{last?.winner === 0 ? "DUEL WON" : last?.winner == null ? "DRAW" : "DUEL LOST"}</div>
        <p>
          Match: {view.wins[0]} - {view.wins[1]} (best of {view.settings.bestOf})
        </p>
        <div className="mdOverBtns">
          <button type="button" onClick={() => act({ type: "next" })} data-next>
            Next Duel
          </button>
        </div>
      </div>
    )
  } else if (reward?.tutorial) {
    overlay = (
      <div className="mdTutDone" onClick={() => setReward(null)}>
        <b>Tutorial complete!</b> You earned 3 card packs. Keep playing this duel, or open them from the main menu.
      </div>
    )
  }

  return (
    <Board
      view={view}
      seat={0}
      act={act}
      sounds={sounds}
      mobile={mobile}
      respond={data.prefs.respond}
      onRespond={(respond) => {
        setData(savePrefs({ respond }))
        act({ type: "prefs", respond })
      }}
      tutorial={tutorial}
      overlay={overlay}
    />
  )
}

// ---------- choosing an opponent ----------

const VsSetup = ({ data, setData, onStart, onBack }) => {
  const prefs = data.prefs
  const [oppId, setOppId] = useState(prefs.opponent || "rookie")
  const [deckKey, setDeckKey] = useState(deckFor(data, prefs.deck) ? prefs.deck : "starter:dragons")
  const [bestOf, setBestOf] = useState(1)
  const opp = opponentById(oppId)
  return (
    <div className="mdPage mdVs">
      <div className="mdPageHead">
        <h2>Duel the Computer</h2>
        <div className="mdPageBtns">
          <button type="button" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
      <div className="mdVsBody">
        <section className="mdVsOpps">
          <h3>Opponent</h3>
          <div className="mdOppGrid" role="radiogroup" aria-label="Opponent">
            {OPPONENTS.map((o) => (
              <button key={o.id} type="button" role="radio" aria-checked={o.id === oppId} className={`mdOpp${o.id === oppId ? " is-on" : ""}`} onClick={() => setOppId(o.id)} data-opp={o.id}>
                <Avatar opp={o} />
                <span className="mdOppText">
                  <b>{o.name}</b>
                  <small>
                    <span className={`mdLevel is-${o.level}`}>{LEVEL_NAMES[o.level]}</span> {STARTERS.find((s) => s.id === o.deck)?.name}
                  </small>
                  {data.stats.beaten[o.id] > 0 && <small className="mdBeaten">Beaten {data.stats.beaten[o.id]}x</small>}
                </span>
              </button>
            ))}
          </div>
          <p className="mdQuote">
            <Avatar opp={opp} size={32} /> "{opp.quote}" <small>Win: {opp.packs} pack{opp.packs > 1 ? "s" : ""}</small>
          </p>
        </section>
        <section className="mdVsDeck">
          <h3>Your deck</h3>
          <DeckList data={data} value={deckKey} onChange={setDeckKey} compact />
          <div className="mdVsOpts">
            <label>
              Life Points{" "}
              <select value={prefs.lp || 8000} onChange={(e) => setData(savePrefs({ lp: Number(e.target.value) }))}>
                {LIFE_POINTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Match{" "}
              <select value={bestOf} onChange={(e) => setBestOf(Number(e.target.value))}>
                {BEST_OF.map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "One duel" : `Best of ${n}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Turn timer{" "}
              <select value={prefs.turnTime || 0} onChange={(e) => setData(savePrefs({ turnTime: Number(e.target.value) }))}>
                {TURN_TIMES.map((n) => (
                  <option key={n} value={n}>
                    {TIME_NAMES[n]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      </div>
      <div className="mdVsGo">
        <button
          type="button"
          className="mdBigBtn"
          onClick={() => {
            setData(savePrefs({ opponent: oppId, deck: deckKey }))
            onStart({ opponent: opp, deck: deckFor(data, deckKey), bestOf, lp: prefs.lp || 8000, turnTime: prefs.turnTime || 0 })
          }}
          data-start
        >
          Duel!
        </button>
      </div>
    </div>
  )
}

// ---------- online ----------

const DeckPick = ({ data, view, online, serverNow }) => {
  const [key, setKey] = useState(deckFor(data, data.prefs.deck) ? data.prefs.deck : "starter:dragons")
  const [error, setError] = useState(null)
  const picked = view.picked[online.seat]
  const [now, setNow] = useState(serverNow())
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 500)
    return () => clearInterval(t)
  }, [serverNow])
  const left = view.stageEnds ? Math.max(0, Math.ceil((view.stageEnds - now) / 1000)) : null
  const choose = async () => {
    const deck = deckFor(data, key)
    if (!deck) return
    const r = await online.act(deck.starter ? { type: "deck", starter: deck.starter } : { type: "deck", main: deck.main, extra: deck.extra, name: deck.name })
    if (!r.ok) setError(r.error)
    else savePrefs({ deck: key })
  }
  return (
    <div className="mdPage mdDeckPick">
      <div className="mdPageHead">
        <h2>Choose your deck</h2>
        <div className="mdPageBtns">
          {left != null && <span className="mdClock">{left}s</span>}
          <button type="button" onClick={online.leave}>
            Leave
          </button>
        </div>
      </div>
      <p className="mdMuted">
        {view.names[0]} vs {view.names[1]}. {view.settings.bestOf > 1 ? "Best of three. " : ""}
        {view.settings.lp} LP.
      </p>
      {picked ? (
        <p className="mdWaitDeck">Deck chosen! Waiting for your opponent to choose theirs...</p>
      ) : (
        <>
          <DeckList data={data} value={key} onChange={setKey} />
          {error && <p className="mdError">{error}</p>}
          <div className="mdVsGo">
            <button type="button" className="mdBigBtn" onClick={choose} data-pick-deck>
              Use this deck
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const OnlineSettings = ({ s, set, disabled }) => (
  <div className="mdOnlineSettings">
    <label>
      Match{" "}
      <select disabled={disabled} value={s.bestOf} onChange={(e) => set({ ...s, bestOf: Number(e.target.value) })} data-setting="bestOf">
        {BEST_OF.map((n) => (
          <option key={n} value={n}>
            {n === 1 ? "One duel" : `Best of ${n}`}
          </option>
        ))}
      </select>
    </label>
    <label>
      Life Points{" "}
      <select disabled={disabled} value={s.lp} onChange={(e) => set({ ...s, lp: Number(e.target.value) })} data-setting="lp">
        {LIFE_POINTS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
    <label>
      Turn timer{" "}
      <select disabled={disabled} value={s.turnTime} onChange={(e) => set({ ...s, turnTime: Number(e.target.value) })} data-setting="turnTime">
        {TURN_TIMES.filter((n) => n).map((n) => (
          <option key={n} value={n}>
            {TIME_NAMES[n]}
          </option>
        ))}
      </select>
    </label>
  </div>
)

const OnlineScreen = ({ online, data, setData, sounds, mobile, onBack }) => {
  const { room } = online
  const v = online.view
  const playing = room && (room.phase === "playing" || room.phase === "over") && v
  const wonRef = useRef(null)
  const respond = data.prefs.respond

  // your "when to ask" preference goes to the server once the duel starts
  useEffect(() => {
    if (v?.stage === "duel" && room?.you != null && v.prefs !== respond) online.act({ type: "prefs", respond })
  }, [v?.stage, v?.game, respond])

  useEffect(() => {
    if (room?.phase === "over" && wonRef.current !== `${room.id}:${room.round}`) {
      wonRef.current = `${room.id}:${room.round}`
      const won = room.result?.winners?.includes(room.you)
      if (won) {
        sounds.win()
        unlock("monsterduel-online")
        const { data: next } = recordResult({ won: true, online: true, packs: 2 })
        setData(next)
      } else if (room.you != null && !room.result?.draw) sounds.lose()
    }
  }, [room?.phase, room?.round])

  if (playing && v.stage === "decks")
    return room.you == null ? (
      <div className="mdPage">
        <p className="mdWaitDeck">
          {v.names[0]} and {v.names[1]} are choosing their decks...
        </p>
      </div>
    ) : (
      <DeckPick data={data} view={v} online={online} serverNow={online.serverNow} />
    )
  if (playing && v.duel) {
    let overlay = null
    if (room.phase === "over") {
      const won = room.result?.winners?.includes(room.you)
      const draw = room.result?.draw
      overlay = (
        <div className={`mdOver ${draw ? "is-draw" : won ? "is-win" : "is-lose"}`} data-result={draw ? "draw" : won ? "win" : "lose"}>
          <div className="mdOverTitle">{room.you == null ? `${room.result?.winnerNames?.join(", ") || "Nobody"} wins` : draw ? "DRAW" : won ? "VICTORY!" : "DEFEAT"}</div>
          <p>{room.result?.reason ? resultText(room.result.reason, won) : ""}</p>
          {won && <div className="mdOverPacks">You earned 2 card packs!</div>}
          <div className="mdOverBar">
            <OnlineResultBar online={online} text=" " />
          </div>
        </div>
      )
    } else if (v.stage === "between") {
      const last = v.results[v.results.length - 1]
      const mine = last?.winner === room.you
      overlay = (
        <div className={`mdOver ${mine ? "is-win" : "is-lose"}`}>
          <div className="mdOverTitle">{last?.winner == null ? "DRAW" : mine ? "DUEL WON" : "DUEL LOST"}</div>
          <p>
            Match: {v.wins[0]} - {v.wins[1]} (best of {v.settings.bestOf})
          </p>
          <div className="mdOverBtns">
            {room.you != null && (
              <button type="button" disabled={v.ready[room.you]} onClick={() => online.act({ type: "next" })} data-next>
                {v.ready[room.you] ? "Waiting..." : "Next Duel"}
              </button>
            )}
          </div>
        </div>
      )
    }
    return (
      <Board
        key={room.id}
        view={v}
        seat={room.you}
        act={online.act}
        sounds={sounds}
        mobile={mobile}
        serverNow={online.serverNow}
        respond={respond}
        onRespond={(r) => {
          setData(savePrefs({ respond: r }))
          online.act({ type: "prefs", respond: r })
        }}
        overlay={overlay}
      />
    )
  }
  return (
    <div className="mdOnline">
      <PlayOnline
        online={online}
        title="Monster Duel"
        icon={ICON}
        blurb="Duel someone anywhere with your own deck. Quick Match pairs you up; Create Room gives you a code for a friend. One duel or best of three."
        defaultSettings={ONLINE_DEFAULTS}
        quickSettings
        computer
        onBack={room ? null : onBack}
        renderSettings={(s, set, { disabled }) => <OnlineSettings s={{ ...ONLINE_DEFAULTS, ...s }} set={set} disabled={disabled} />}
      />
    </div>
  )
}

// ---------- the title screen ----------

const Title = ({ data, onOnline, onVs, onTutorial, onBuilder, onPacks, onRules }) => {
  const progress = collectionProgress(data)
  return (
    <div className="mdTitle">
      <div className="mdTitleFan" aria-hidden="true">
        {["S03", "D08", "A11"].map((id, i) => (
          <div key={id} className={`mdFanCard f${i}`}>
            <Card id={id} />
          </div>
        ))}
      </div>
      <Logo />
      <p className="mdTagline">Summon. Set. Strike.</p>
      <PlayOnlineButton onClick={onOnline} sub="Quick Match, rooms with codes, best of three" className="mdOnlineBtn" data-online />
      <div className="mdTitleMenu">
        <button type="button" className="mdMenuBtn is-main" onClick={onVs} data-mode="vs">
          <b>Duel the Computer</b>
          <small>Eight opponents, earn card packs</small>
        </button>
        <button type="button" className="mdMenuBtn" onClick={onTutorial} data-mode="tutorial">
          <b>Tutorial{data.tutorialDone ? "" : " (start here!)"}</b>
          <small>{data.tutorialDone ? "Replay the lessons" : "Learn in one guided duel"}</small>
        </button>
        <button type="button" className="mdMenuBtn" onClick={onBuilder} data-mode="builder">
          <b>Deck Builder</b>
          <small>
            {progress.have}/{progress.total} cards collected
          </small>
        </button>
        <button type="button" className={`mdMenuBtn${data.packs ? " has-packs" : ""}`} onClick={onPacks} data-mode="packs">
          <b>Card Packs{data.packs ? ` (${data.packs})` : ""}</b>
          <small>{data.packs ? "Ready to open!" : "Win duels to earn packs"}</small>
        </button>
        <button type="button" className="mdMenuBtn" onClick={onRules} data-mode="rules">
          <b>Rules</b>
          <small>How a duel works</small>
        </button>
      </div>
      <p className="mdRecord">
        Record: {data.stats.wins} won, {data.stats.losses} lost{data.stats.online ? `, ${data.stats.online} online wins` : ""}
      </p>
    </div>
  )
}

// ---------- the window ----------

const MonsterDuel = ({ mobile = false, onClose }) => {
  const [data, setData] = useState(load)
  const [screen, setScreen] = useState("title") // title | vs | duel | online | builder | packs | rules
  const [config, setConfig] = useState(null)
  const [dialog, setDialog] = useState(null)
  const sounds = useMemo(() => createSounds(), [])
  const localControl = useRef(null)
  const online = useOnlineRoom("monsterduel")
  const chatItem = useGameChatMenuItem("monsterduel")
  const prefs = data.prefs

  useEffect(() => {
    sounds.setEnabled(prefs.sound)
  }, [prefs.sound])
  const setPref = (patch) => setData(savePrefs(patch))

  // an invitation or a join link: straight to the room
  useEffect(() => {
    if (online.room && screen !== "online") setScreen("online")
  }, [online.room?.id])

  const startDuel = (c) => {
    setConfig({ ...c, key: Date.now() })
    setScreen("duel")
  }
  const startTutorial = () => {
    setConfig({ tutorial: true, key: Date.now(), opponent: { id: "coach", name: "Coach Bramble" } })
    setScreen("duel")
  }
  const toMenu = () => {
    if (online.room) online.leave()
    setScreen("title")
  }
  const inDuel = screen === "duel" || (screen === "online" && online.room?.phase === "playing")

  const menus = [
    {
      label: "Game",
      items: [
        { label: "Duel the Computer...", onClick: () => (online.room && online.leave(), setScreen("vs")) },
        { label: "Play Online...", onClick: () => setScreen("online") },
        { label: "Tutorial Duel", onClick: () => (online.room && online.leave(), startTutorial()) },
        "-",
        { label: "Deck Builder", onClick: () => (online.room && online.leave(), setScreen("builder")) },
        { label: `Card Packs${data.packs ? ` (${data.packs})` : ""}`, onClick: () => (online.room && online.leave(), setScreen("packs")) },
        "-",
        { label: "Surrender", disabled: !inDuel, onClick: () => setDialog("surrender") },
        { label: "Main Menu", onClick: toMenu },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Options",
      items: [
        { label: "Sound", checked: prefs.sound, onClick: () => setPref({ sound: !prefs.sound }) },
        "-",
        { label: "Ask to Respond: Always", checked: prefs.respond === "always", onClick: () => setPref({ respond: "always" }) },
        { label: "Ask to Respond: When I Can", checked: prefs.respond === "auto", onClick: () => setPref({ respond: "auto" }) },
        { label: "Ask to Respond: Never", checked: prefs.respond === "never", onClick: () => setPref({ respond: "never" }) },
        "-",
        { label: "Computer Speed: Slow", checked: prefs.pace === "slow", onClick: () => setPref({ pace: "slow" }) },
        { label: "Computer Speed: Normal", checked: prefs.pace === "normal", onClick: () => setPref({ pace: "normal" }) },
        { label: "Computer Speed: Fast", checked: prefs.pace === "fast", onClick: () => setPref({ pace: "fast" }) },
        chatItem,
      ],
    },
    {
      label: "Help",
      items: [helpItem({ program: "Monster Duel" }), "-",
        { label: "Rules...", onClick: () => setScreen("rules") },
        { label: "Tutorial Duel", onClick: startTutorial },
        { label: "About Monster Duel...", onClick: () => setDialog("about") },
      ],
    },
  ]

  const surrender = () => {
    setDialog(null)
    if (screen === "online") online.act({ type: "surrender" })
    else localControl.current?.surrender()
  }

  let body
  if (screen === "duel" && config) {
    body = (
      <LocalDuel
        config={config}
        control={localControl}
        data={data}
        setData={setData}
        sounds={sounds}
        mobile={mobile}
        onExit={() => setScreen("title")}
        onAgain={() => startDuel({ ...config })}
        onPacks={() => setScreen("packs")}
      />
    )
  } else if (screen === "online") {
    body = <OnlineScreen online={online} data={data} setData={setData} sounds={sounds} mobile={mobile} onBack={toMenu} />
  } else if (screen === "vs") {
    body = <VsSetup data={data} setData={setData} onStart={startDuel} onBack={() => setScreen("title")} />
  } else if (screen === "builder") {
    body = <DeckBuilder data={data} setData={setData} mobile={mobile} onBack={() => setScreen("title")} />
  } else if (screen === "packs") {
    body = <Packs data={data} setData={setData} sounds={sounds} mobile={mobile} onBack={() => setScreen("title")} onBuilder={() => setScreen("builder")} />
  } else if (screen === "rules") {
    body = <Rules onBack={() => setScreen("title")} onTutorial={startTutorial} />
  } else {
    body = (
      <Title
        data={data}
        onOnline={() => setScreen("online")}
        onVs={() => setScreen("vs")}
        onTutorial={startTutorial}
        onBuilder={() => setScreen("builder")}
        onPacks={() => setScreen("packs")}
        onRules={() => setScreen("rules")}
      />
    )
  }

  return (
    <div className={`mdRoot${mobile ? " is-mobile" : ""}`} data-screen={screen}>
      <MenuBar menus={menus} />
      <GameChat game="monsterduel" title="Monster Duel" room={online.chatRoom} />
      <div className="mdBody">{body}</div>
      {dialog === "surrender" && (
        <Dialog title="Surrender" onOk={surrender} onCancel={() => setDialog(null)} okLabel="Surrender">
          <p className="dialogText">Give up this duel? It counts as a loss.</p>
        </Dialog>
      )}
      {dialog === "about" && (
        <Dialog title="About Monster Duel" onOk={() => setDialog(null)} onCancel={() => setDialog(null)}>
          <div className="mdAbout">
            <Logo small />
            <p>Monster Duel 98: a trading card duel for one or two players, with {Object.keys(CARD).length - 2} original cards.</p>
            <p className="mdMuted">Every card, name and picture is original to 98ish. The art is drawn by code, fresh each time.</p>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default MonsterDuel
