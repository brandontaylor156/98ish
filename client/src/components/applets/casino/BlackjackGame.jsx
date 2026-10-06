import React, { useEffect, useRef, useState } from "react"
import MoreOptions from "../../shared/MoreOptions"
import { unlock } from "../../../utils/achievements"
import * as BJ from "./blackjack"
import { ChipBar, ChipPicker, Chip, PlayingCard, formatChips, signed } from "./parts"
import { sfx } from "./sounds"

// Blackjack: bet from the chip rack, Deal, then Hit / Stand / Double / Split (Insurance when
// the dealer shows an ace). House rules and the basic-strategy hint are under More options.

const RESULT_TEXT = { blackjack: "Blackjack!", win: "Win", lose: "Lose", push: "Push", bust: "Bust", surrender: "Surrendered" }
const KEY = "98ish.casino.blackjack"
const load = () => {
  try {
    return { chip: 25, bet: 25, h17: false, surrender: false, hint: false, ...JSON.parse(localStorage.getItem(KEY) || "{}") }
  } catch {
    return { chip: 25, bet: 25, h17: false, surrender: false, hint: false }
  }
}

const Hand = ({ cards, hidden = false, label, total, active, result, bet, doubled }) => (
  <div className={`csBjHand${active ? " is-active" : ""}${result ? ` is-${result}` : ""}`}>
    <div className="csCards csFan">
      {cards.map((c, i) => (
        <PlayingCard key={c.id + i} card={c} down={hidden && i === 1} className="csDealt" />
      ))}
    </div>
    <div className="csHandInfo">
      {label && <span className="csHandLabel">{label}</span>}
      {total && <b className="csTotal">{total}</b>}
      {bet > 0 && <Chip amount={bet} small title={doubled ? "Doubled" : undefined} />}
      {result && <span className={`csResult is-${result}`}>{RESULT_TEXT[result]}</span>}
    </div>
  </div>
)

const Blackjack = ({ bank, onLobby, mobile }) => {
  const [prefs, setPrefsRaw] = useState(load)
  const setPrefs = (patch) =>
    setPrefsRaw((p) => {
      const next = { ...p, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // private window
      }
      return next
    })
  const [table, setTable] = useState(() => BJ.createTable({ h17: prefs.h17, surrender: prefs.surrender }))
  const [bet, setBet] = useState(0) // chips in the betting circle before the deal
  const [error, setError] = useState("")
  const settled = useRef(0)
  const tableRef = useRef(table)
  tableRef.current = table

  // closing the window mid-round: decline insurance, stand on every hand, and settle
  useEffect(
    () => () => {
      let t = tableRef.current
      if (t.phase !== "player" && t.phase !== "insurance") return
      if (t.phase === "insurance") t = BJ.insurance(t, false)
      while (t.phase === "player") t = BJ.stand(t)
      if (t.phase === "done") bank.give(t.returned, t.result.net)
    },
    []
  )

  // house rules apply from the next shoe position on
  useEffect(() => {
    setTable((t) => ({ ...t, settings: { ...t.settings, h17: prefs.h17, surrender: prefs.surrender } }))
  }, [prefs.h17, prefs.surrender])

  // settle a finished round once: chips back to the bank
  useEffect(() => {
    if (table.phase !== "done" || settled.current === table.round) return
    settled.current = table.round
    bank.give(table.returned, table.result.net)
    const res = table.hands.map((h) => h.result)
    if (res.includes("blackjack")) {
      sfx.bigWin()
      unlock("casino-blackjack")
    } else if (table.result.net > 0) sfx.win()
    else if (table.result.net === 0) sfx.push()
    else sfx.lose()
  }, [table.phase, table.round])

  const apply = (next, cost = 0) => {
    if (next.error) {
      setError(next.error)
      sfx.bad()
      return
    }
    if (cost > 0 && !bank.take(cost)) {
      setError("Not enough chips.")
      return
    }
    setError("")
    setTable(next)
  }

  const inRound = table.phase === "player" || table.phase === "insurance"
  const betting = !inRound

  const addChip = () => {
    if (!betting) return
    if (bet + prefs.chip > bank.balance) return setError("Not enough chips for that.")
    setError("")
    sfx.chip()
    setBet(bet + prefs.chip)
  }
  const deal = (amount = bet || prefs.bet) => {
    if (!(amount > 0)) return setError("Tap the circle (or a chip) to bet first.")
    if (amount > bank.balance) return setError("Not enough chips for that bet.")
    const next = BJ.deal(table, amount)
    if (next.error) return setError(next.error)
    bank.take(amount)
    setPrefs({ bet: amount })
    setBet(0)
    setError("")
    if (next.reshuffled) sfx.shuffle()
    sfx.deal(4)
    setTable(next)
  }

  const act = (kind) => {
    const before = table.staked
    let next
    if (kind === "hit") next = BJ.hit(table)
    else if (kind === "stand") next = BJ.stand(table)
    else if (kind === "double") next = BJ.double(table, bank.balance)
    else if (kind === "split") next = BJ.split(table, bank.balance)
    else if (kind === "surrender") next = BJ.surrender(table)
    else if (kind === "insure") next = BJ.insurance(table, true, bank.balance)
    else if (kind === "noinsure") next = BJ.insurance(table, false)
    if (!next.error) sfx.card()
    apply(next, next.error ? 0 : next.staked - before)
  }

  // keyboard: H S D P, Enter deals
  useEffect(() => {
    if (mobile) return
    const onKey = (e) => {
      if (e.target.closest?.("input, textarea, select")) return
      const k = e.key.toLowerCase()
      if (table.phase === "player") {
        if (k === "h") act("hit")
        else if (k === "s") act("stand")
        else if (k === "d" && BJ.canDouble(table, bank.balance)) act("double")
        else if (k === "p" && BJ.canSplit(table, bank.balance)) act("split")
      } else if (betting && k === "enter" && document.activeElement?.tagName !== "BUTTON") deal()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const hint = prefs.hint ? BJ.hint(table) : null
  const dealerTotal = table.dealer.length ? (table.holeHidden ? BJ.describe([table.dealer[0]]) : BJ.describe(table.dealer)) : null
  const multi = table.hands.length > 1
  const lastBet = prefs.bet

  let message = null
  if (error) message = <span className="csMsg is-error">{error}</span>
  else if (table.phase === "insurance") message = <span className="csMsg">Dealer shows an ace. Insurance?</span>
  else if (table.phase === "done" && table.result)
    message = (
      <span className={`csMsg ${table.result.net > 0 ? "is-win" : table.result.net < 0 ? "is-lose" : ""}`} data-net={table.result.net}>
        {table.result.dealerBJ ? "Dealer has blackjack. " : ""}
        {table.result.net > 0 ? `You win ${formatChips(table.result.net)}!` : table.result.net < 0 ? `You lose ${formatChips(-table.result.net)}.` : "Push: your bet comes back."}
      </span>
    )
  else if (hint) message = <span className="csMsg">Hint: {hint}</span>
  else if (betting) message = <span className="csMsg">{bet ? `Bet ${formatChips(bet)}. Deal when you're ready.` : "Pick a chip and tap the circle to bet."}</span>

  return (
    <div className="csGame csBlackjack">
      <ChipBar title="Blackjack" onLobby={onLobby} bank={bank} />
      <div className="csFelt" data-touch-surface>
        <div className="csFeltText">BLACKJACK PAYS 3 TO 2 · DEALER {table.settings.h17 ? "HITS" : "STANDS ON"} SOFT 17</div>
        <div className="csDealer">
          {table.dealer.length ? <Hand cards={table.dealer} hidden={table.holeHidden} label="Dealer" total={dealerTotal} /> : <div className="csEmptyHand">Dealer</div>}
        </div>
        <div className="csMsgRow">{message}</div>
        <div className={`csPlayer${multi ? " is-multi" : ""}`}>
          {inRound || table.phase === "done" ? (
            table.hands.map((h, i) => (
              <Hand
                key={i}
                cards={h.cards}
                label={multi ? `Hand ${i + 1}` : "You"}
                total={BJ.describe(h.cards)}
                active={table.phase === "player" && i === table.active && multi}
                result={table.phase === "done" ? h.result : null}
                bet={h.bet}
                doubled={h.doubled}
              />
            ))
          ) : null}
          {betting && (
            <button type="button" className={`csBetSpot${bet ? " has-bet" : ""}`} onClick={addChip} aria-label={`Bet circle: ${bet} chips. Tap to add a ${prefs.chip} chip.`} data-spot>
              {bet ? <Chip amount={bet} /> : <span>BET</span>}
            </button>
          )}
        </div>
        {table.insurance > 0 && <div className="csSide">Insurance {formatChips(table.insurance)}</div>}
      </div>
      <div className="csControls">
        {table.phase === "player" && (
          <div className="csActions">
            <button type="button" className="csBig" onClick={() => act("hit")} data-act="hit">
              Hit
            </button>
            <button type="button" className="csBig" onClick={() => act("stand")} data-act="stand">
              Stand
            </button>
            <button type="button" className="csBig" disabled={!BJ.canDouble(table, bank.balance)} onClick={() => act("double")} data-act="double">
              Double
            </button>
            <button type="button" className="csBig" disabled={!BJ.canSplit(table, bank.balance)} onClick={() => act("split")} data-act="split">
              Split
            </button>
            {BJ.canSurrender(table) && (
              <button type="button" className="csBig" onClick={() => act("surrender")} data-act="surrender">
                Surrender
              </button>
            )}
          </div>
        )}
        {table.phase === "insurance" && (
          <div className="csActions">
            <button type="button" className="csBig" disabled={!BJ.canInsure(table, bank.balance)} onClick={() => act("insure")} data-act="insure">
              Insure ({formatChips(Math.floor(table.hands[0].bet / 2))})
            </button>
            <button type="button" className="csBig csPrimary" onClick={() => act("noinsure")} data-act="noinsure">
              No Insurance
            </button>
          </div>
        )}
        {betting && (
          <>
            <ChipPicker value={prefs.chip} onChange={(chip) => setPrefs({ chip })} max={bank.balance} />
            <div className="csActions">
              <button type="button" disabled={!bet} onClick={() => setBet(0)} data-clear>
                Clear
              </button>
              {!bet && lastBet > 0 && table.round > 0 ? (
                <button type="button" className="csBig csPrimary" disabled={lastBet > bank.balance} onClick={() => deal(lastBet)} data-act="rebet">
                  Deal {formatChips(lastBet)} again
                </button>
              ) : (
                <button type="button" className="csBig csPrimary" disabled={!bet} onClick={() => deal()} data-act="deal">
                  Deal
                </button>
              )}
            </div>
          </>
        )}
        {betting && (
          <MoreOptions id="casino.blackjack" inline className="csMore" summary={`${table.settings.decks} decks · Dealer ${prefs.h17 ? "hits" : "stands on"} soft 17${prefs.surrender ? " · Surrender" : ""}${prefs.hint ? " · Hints" : ""}`}>
            <div className="csOpts">
              <label>
                <input type="checkbox" checked={prefs.h17} onChange={(e) => setPrefs({ h17: e.target.checked })} /> Dealer hits soft 17
              </label>
              <label>
                <input type="checkbox" checked={prefs.surrender} onChange={(e) => setPrefs({ surrender: e.target.checked })} /> Late surrender
              </label>
              <label>
                <input type="checkbox" checked={prefs.hint} onChange={(e) => setPrefs({ hint: e.target.checked })} /> Show the basic-strategy hint
              </label>
              <span className="csMuted">
                Last round: {table.result ? signed(table.result.net) : "none yet"} · {table.shoe.length} cards left in the shoe
              </span>
            </div>
          </MoreOptions>
        )}
      </div>
    </div>
  )
}

export default Blackjack
