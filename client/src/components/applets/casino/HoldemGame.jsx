import React, { useEffect, useRef, useState } from "react"
import MoreOptions from "../../shared/MoreOptions"
import Dialog from "../../shared/Dialog"
import GameChat from "../../shared/GameChat"
import PlayOnline, { OnlineResultBar, PlayOnlineButton, useOnlineRoom } from "../../shared/online"
import { unlock } from "../../../utils/achievements"
import { summarize } from "../../../utils/disclosure"
import * as H from "./holdem"
import { createLocalGame } from "./local"
import HoldemTable from "./HoldemTable"
import { ChipBar, formatChips, signed } from "./parts"
import { sfx } from "./sounds"

// Texas Hold'em's window: a table against the computer (buy in from the chip bank, cash out
// any time; local.js runs holdem.js right here), or Play Online with friends (the server runs
// the same rules: server/arcade/games/holdem.js; online tables play with their own chips).

const ICON = "/assets/program_icons/holdem.svg"
const KEY = "98ish.casino.holdem"
const BOT_NAMES = ["Ada", "Grace", "Alan", "Linus", "Hedy", "Dennis", "Ken", "Barbara"]
const BUY_INS = [100, 200, 500, 1000, 2500, 5000, 10000]
const SOLO = { opponents: 5, bots: "normal", buyIn: 500, blind: 5, blindsUp: 10 }
const ONLINE_DEFAULTS = { ...H.DEFAULTS, players: 6, timer: 30 }

const loadSolo = () => {
  try {
    return { ...SOLO, ...JSON.parse(localStorage.getItem(KEY) || "{}") }
  } catch {
    return SOLO
  }
}
const saveSolo = (s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // private window
  }
}

const Select = ({ label, value, options, onChange, disabled }) => (
  <label className="csField">
    <span>{label}</span>
    <select value={value} disabled={disabled} onChange={(e) => onChange(isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value))}>
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  </label>
)

const BLIND_OPTS = H.BLINDS.map((b) => [b, `${b}/${b * 2}`])
const UP_OPTS = H.BLINDS_UP.map((u) => [u, u ? `Every ${u} hands` : "Never"])
const BOT_OPTS = [
  ["easy", "Easy"],
  ["normal", "Normal"],
  ["hard", "Hard"],
]

// the online room's settings
const OnlineSettings = ({ s, set, disabled }) => (
  <div className="csOpts csGrid">
    <Select label="Seats" value={s.players} disabled={disabled} options={[2, 3, 4, 5, 6, 7, 8].map((p) => [p, String(p)])} onChange={(players) => set({ ...s, players })} />
    <Select label="Starting chips" value={s.stack} disabled={disabled} options={[500, 1000, 2000, 5000, 10000].map((v) => [v, formatChips(v)])} onChange={(stack) => set({ ...s, stack })} />
    <Select label="Blinds" value={s.blind} disabled={disabled} options={BLIND_OPTS} onChange={(blind) => set({ ...s, blind })} />
    <Select label="Blinds go up" value={s.blindsUp} disabled={disabled} options={UP_OPTS} onChange={(blindsUp) => set({ ...s, blindsUp })} />
    <Select label="Turn timer" value={s.timer || 30} disabled={disabled} options={[15, 20, 30, 45, 60].map((t) => [t, `${t} seconds`])} onChange={(timer) => set({ ...s, timer })} />
    <Select label="Computer players" value={s.bots} disabled={disabled} options={BOT_OPTS} onChange={(bots) => set({ ...s, bots })} />
  </div>
)

const OnlineScreen = ({ online, mobile, onBack }) => {
  const { room } = online
  const playing = room && (room.phase === "playing" || room.phase === "over") && online.view
  const wonRef = useRef(null)
  useEffect(() => {
    if (room?.phase === "over" && room.result?.winners?.includes(room.you) && wonRef.current !== room.round) {
      wonRef.current = room.round
      if (room.seats.filter((s) => s && !s.bot).length > 1) unlock("casino-holdem-online")
    }
  }, [room?.phase, room?.round])
  if (playing) {
    const names = online.view.seats.map((s, i) => room.seats[i]?.name || s.name)
    return <HoldemTable key={`${room.id}:${room.round}`} view={online.view} names={names} act={online.act} mobile={mobile} now={online.serverNow} footer={room.phase === "over" ? <OnlineResultBar online={online} /> : null} />
  }
  return (
    <div className="csOnline">
      <PlayOnline
        online={online}
        title="Texas Hold'em"
        icon={ICON}
        blurb="2 to 8 players, no-limit, everyone starts with the same chips; last one with chips wins. Computer players fill empty seats. Online tables use their own chips, not your bank."
        defaultSettings={ONLINE_DEFAULTS}
        computer
        onBack={room ? null : onBack}
        renderSettings={(s, set, { disabled }) => <OnlineSettings s={s} set={set} disabled={disabled} />}
      />
    </div>
  )
}

const Holdem = ({ bank, mobile, onLobby }) => {
  const [solo, setSoloRaw] = useState(loadSolo)
  const setSolo = (patch) =>
    setSoloRaw((s) => {
      const next = { ...s, ...patch }
      saveSolo(next)
      return next
    })
  const [screen, setScreen] = useState("setup") // setup | table | online
  const [game, setGame] = useState(null) // { id, view, result, buyIn }
  const [confirm, setConfirm] = useState(false)
  const [summary, setSummary] = useState(null) // the last table's result
  const localRef = useRef(null) // { local, buyIn, paid }
  const online = useOnlineRoom("holdem")

  // the stack you'd walk away with now
  const stackNow = () => localRef.current?.local?.state?.seats[0]?.stack ?? 0
  // pay out a table once: your stack goes back to the bank
  const payOut = (reason) => {
    const entry = localRef.current
    if (!entry || entry.paid) return
    entry.paid = true
    const stack = entry.local.result ? (entry.local.result.winners.includes(0) ? entry.local.state.seats[0].stack : 0) : stackNow()
    entry.local.stop()
    bank.give(stack, stack - entry.buyIn)
    if (stack - entry.buyIn > 0) sfx.chips()
    setSummary({ reason, stack, buyIn: entry.buyIn, place: entry.local.state.seats[0].place })
  }
  // closing the window mid-table cashes you out (folding the hand you're in)
  useEffect(() => () => payOut("closed"), [])

  // an invitation or a join link: straight to the room
  useEffect(() => {
    if (online.room && screen !== "online") {
      if (localRef.current && !localRef.current.paid) payOut("left")
      setScreen("online")
    }
  }, [online.room?.id])

  const start = () => {
    const blind = solo.blind
    const buyIn = solo.buyIn
    if (buyIn > bank.balance) return
    const settings = H.validateSettings({ players: solo.opponents + 1, stack: buyIn, blind, blindsUp: solo.blindsUp, bots: solo.bots, timer: 0 })
    if (settings.error) return
    if (!bank.take(buyIn)) return
    sfx.chips()
    const players = Array.from({ length: settings.players }, (_, i) => (i === 0 ? { id: 0, name: "You", bot: false } : { id: i, name: BOT_NAMES[i - 1], bot: true }))
    const entry = { local: null, buyIn, paid: false, id: Date.now() }
    localRef.current = entry
    const update = (g) => {
      if (localRef.current !== entry) return
      setGame({ id: entry.id, view: g.view(0), result: g.result })
      if (g.result && !entry.paid) {
        if (g.result.winners.includes(0)) unlock("casino-holdem")
        payOut(g.result.winners.includes(0) ? "won" : "out")
      }
    }
    entry.local = createLocalGame({ rules: H, settings, players, onChange: update })
    if (import.meta.env.DEV) window.__holdem = entry.local
    setSummary(null)
    setScreen("table")
  }
  const cashOut = () => {
    setConfirm(false)
    payOut("cashed")
  }
  // you went out but the computers are still playing: stop and settle
  useEffect(() => {
    const me = game?.view?.seats?.[0]
    if (screen === "table" && me?.out && localRef.current && !localRef.current.paid) payOut("out")
  }, [game?.view?.seats?.[0]?.out])

  const names = ["You", ...BOT_NAMES]
  const backToSetup = () => {
    localRef.current = null
    setGame(null)
    setScreen("setup")
  }

  let body
  if (screen === "online") {
    body = (
      <OnlineScreen
        online={online}
        mobile={mobile}
        onBack={() => {
          if (online.room) online.leave()
          setScreen("setup")
        }}
      />
    )
  } else if (screen === "table" && game?.view) {
    const paid = localRef.current?.paid
    const footer = summary ? (
      <div className="csSummary" role="status">
        <b>
          {summary.reason === "won"
            ? `You won the table! ${formatChips(summary.stack)} chips back to your bank.`
            : summary.reason === "out"
              ? `You're out${summary.place ? ` in ${H.ordinal(summary.place)} place` : ""}.`
              : `Cashed out ${formatChips(summary.stack)} chips (${signed(summary.stack - summary.buyIn)}).`}
        </b>
        <span className="csRow">
          <button type="button" className="csPrimary" disabled={solo.buyIn > bank.balance} onClick={start} data-again>
            Buy In Again ({formatChips(solo.buyIn)})
          </button>
          <button type="button" onClick={backToSetup}>
            Back
          </button>
        </span>
      </div>
    ) : null
    body = <HoldemTable key={game.id} view={game.view} names={names} act={(a) => Promise.resolve(localRef.current?.local?.act(a) || { ok: false })} mobile={mobile} footer={footer} frozen={!!paid} />
  } else {
    const affordable = BUY_INS.filter((b) => b >= solo.blind * 20)
    const buyIn = solo.buyIn
    body = (
      <div className="csSetup">
        <div className="csMarquee is-small" aria-hidden="true">
          <span>TEXAS</span>
          <b>HOLD'EM</b>
        </div>
        <button type="button" className="csTile csBigTile" disabled={buyIn > bank.balance} onClick={start} data-solo>
          <b>Play the Computer</b>
          <small>
            Buy in {formatChips(buyIn)} · {solo.opponents} opponent{solo.opponents === 1 ? "" : "s"} · {solo.bots[0].toUpperCase() + solo.bots.slice(1)}
          </small>
        </button>
        {buyIn > bank.balance && <p className="csMsg is-error">Not enough chips for that buy-in. Pick a smaller one under More options{bank.needsRefill() ? ", or take the free refill" : ""}.</p>}
        <PlayOnlineButton onClick={() => setScreen("online")} sub="Quick Match, private rooms, 2 to 8 players" className="csOnlineBtn" data-online />
        <MoreOptions id="casino.holdem" className="csMore" summary={summarize(`Blinds ${solo.blind}/${solo.blind * 2}`, solo.blindsUp ? `up every ${solo.blindsUp} hands` : "blinds stay", `${solo.opponents} opponents`)}>
          <div className="csOpts csGrid">
            <Select label="Opponents" value={solo.opponents} options={[1, 2, 3, 4, 5, 6, 7].map((o) => [o, String(o)])} onChange={(opponents) => setSolo({ opponents })} />
            <Select label="Difficulty" value={solo.bots} options={BOT_OPTS} onChange={(bots) => setSolo({ bots })} />
            <Select
              label="Blinds"
              value={solo.blind}
              options={BLIND_OPTS.filter(([b]) => b <= 25)}
              onChange={(blind) => setSolo({ blind, buyIn: Math.max(solo.buyIn, BUY_INS.find((v) => v >= blind * 20)) })}
            />
            <Select label="Buy-in" value={buyIn} options={affordable.map((v) => [v, `${formatChips(v)}${v > bank.balance ? " (not enough)" : ""}`])} onChange={(v) => setSolo({ buyIn: v })} />
            <Select label="Blinds go up" value={solo.blindsUp} options={UP_OPTS} onChange={(blindsUp) => setSolo({ blindsUp })} />
          </div>
        </MoreOptions>
      </div>
    )
  }

  const atTable = screen === "table" && localRef.current && !localRef.current.paid
  return (
    <div className="csGame csHoldemGame">
      <ChipBar
        title="Texas Hold'em"
        onLobby={screen === "table" && atTable ? null : onLobby}
        bank={bank}
        extra={
          atTable ? (
            <button type="button" className="csLobbyBtn" onClick={() => (game?.view?.seats[0]?.inHand && !game.view.done ? setConfirm(true) : cashOut())} data-cashout>
              Cash Out ({formatChips(game?.view?.seats[0]?.stack ?? 0)})
            </button>
          ) : null
        }
      />
      <GameChat game="holdem" title="Texas Hold'em" room={online.chatRoom} />
      {body}
      {confirm && (
        <Dialog title="Cash Out" onOk={cashOut} onCancel={() => setConfirm(false)} okLabel="Cash Out">
          <p>You're in a hand: cashing out now folds it. Take {formatChips(game?.view?.seats[0]?.stack ?? 0)} chips back to your bank?</p>
        </Dialog>
      )}
    </div>
  )
}

export default Holdem
