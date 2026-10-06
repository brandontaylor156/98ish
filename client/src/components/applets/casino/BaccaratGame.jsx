import React, { useEffect, useRef, useState } from "react"
import MoreOptions from "../../shared/MoreOptions"
import * as B from "./baccarat"
import { ChipBar, ChipPicker, Chip, PlayingCard, formatChips } from "./parts"
import { sfx } from "./sounds"

// Baccarat (punto banco): put chips on PLAYER, BANKER or TIE, Deal. The cards come out one
// at a time by the fixed drawing rules; the bead road keeps the last results. Banker wins pay
// 19 to 20, ties 8 to 1 (and push the other bets).

const KEY = "98ish.casino.baccarat"
const CARD_MS = 520
const SIDES = [
  { id: "player", label: "PLAYER", pays: "1 to 1" },
  { id: "tie", label: "TIE", pays: "8 to 1" },
  { id: "banker", label: "BANKER", pays: "19 to 20" },
]
const load = () => {
  try {
    return { chip: 25, ...JSON.parse(localStorage.getItem(KEY) || "{}") }
  } catch {
    return { chip: 25 }
  }
}

const Baccarat = ({ bank, onLobby }) => {
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
  const [shoe, setShoe] = useState(() => B.newShoeFor())
  const [bets, setBets] = useState({ player: 0, banker: 0, tie: 0 })
  const [lastBets, setLastBets] = useState(null)
  const [coup, setCoup] = useState(null)
  const [shown, setShown] = useState(0) // cards turned over so far
  const [settled, setSettled] = useState(null)
  const [road, setRoad] = useState([])
  const [error, setError] = useState("")
  const timers = useRef([])
  const pendingRef = useRef(null)
  const betsRef = useRef(bets)
  betsRef.current = bets

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout)
      // closing mid-deal still pays; chips waiting on the felt come back
      const p = pendingRef.current
      if (p) bank.give(p.returned, p.net)
      else {
        const back = Object.values(betsRef.current).reduce((s, a) => s + a, 0)
        if (back) bank.give(back)
      }
    },
    []
  )

  const dealing = !!coup && !settled
  const total = bets.player + bets.banker + bets.tie

  const add = (side) => {
    if (dealing) return
    if (settled) {
      setCoup(null)
      setSettled(null)
    }
    if (!bank.take(prefs.chip)) return setError("Not enough chips.")
    sfx.chip()
    setError("")
    setBets((b) => ({ ...b, [side]: b[side] + prefs.chip }))
  }
  const clear = () => {
    if (dealing || !total) return
    bank.give(total)
    setBets({ player: 0, banker: 0, tie: 0 })
  }
  const rebet = () => {
    const cost = Object.values(lastBets).reduce((s, a) => s + a, 0)
    if (!bank.take(cost)) return setError("Not enough chips to rebet.")
    sfx.chips()
    setCoup(null)
    setSettled(null)
    setBets(lastBets)
  }

  const deal = () => {
    if (dealing) return
    if (!total) return setError("Put chips on Player, Banker or Tie first.")
    setError("")
    let s = shoe
    if (B.shoeLow(s)) {
      s = B.newShoeFor()
      sfx.shuffle()
    }
    const c = B.coup(s)
    setShoe(c.shoe)
    setCoup(c)
    setSettled(null)
    setShown(0)
    const order = c.player.length + c.banker.length
    const result = B.settle(bets, c.winner)
    pendingRef.current = result
    const placed = bets
    for (let i = 1; i <= order; i++) {
      timers.current.push(
        setTimeout(() => {
          setShown(i)
          sfx.card()
        }, i * CARD_MS)
      )
    }
    timers.current.push(
      setTimeout(() => {
        pendingRef.current = null
        bank.give(result.returned, result.net)
        setSettled(result)
        setLastBets(placed)
        setBets({ player: 0, banker: 0, tie: 0 })
        setRoad((r) => [...r, c.winner].slice(-36))
        if (result.net > 0) sfx.win()
        else if (result.net === 0) sfx.push()
        else sfx.lose()
      }, (order + 1) * CARD_MS)
    )
  }

  // the order cards are turned: P1 B1 P2 B2, then the player's third, then the banker's
  const visible = (side, i) => {
    if (!coup) return false
    const seq = [
      ["player", 0],
      ["banker", 0],
      ["player", 1],
      ["banker", 1],
    ]
    if (coup.player[2]) seq.push(["player", 2])
    if (coup.banker[2]) seq.push(["banker", 2])
    const k = seq.findIndex(([s, j]) => s === side && j === i)
    return k >= 0 && k < shown
  }
  const sideTotal = (side) => {
    if (!coup) return null
    const cards = coup[side].filter((_, i) => visible(side, i))
    return cards.length ? B.total(cards) : null
  }

  const shownBets = settled ? lastBets : bets
  let message
  if (error) message = <span className="csMsg is-error">{error}</span>
  else if (settled)
    message = (
      <span className={`csMsg ${settled.net > 0 ? "is-win" : settled.net < 0 ? "is-lose" : ""}`} data-net={settled.net}>
        {coup.winner === "tie" ? `Tie, ${coup.playerTotal} each.` : `${coup.winner === "player" ? "Player" : "Banker"} wins, ${Math.max(coup.playerTotal, coup.bankerTotal)} to ${Math.min(coup.playerTotal, coup.bankerTotal)}.`}{" "}
        {settled.net > 0 ? `You win ${formatChips(settled.net)}!` : settled.net < 0 ? `You lose ${formatChips(-settled.net)}.` : "Your bets come back."}
      </span>
    )
  else if (dealing) message = <span className="csMsg">Dealing...</span>
  else message = <span className="csMsg">{total ? `${formatChips(total)} bet. Deal!` : "Pick a chip and tap Player, Banker or Tie."}</span>

  return (
    <div className="csGame csBaccarat">
      <ChipBar title="Baccarat" onLobby={onLobby} bank={bank} />
      <div className="csFelt" data-touch-surface>
        <div className="csBacHands">
          {["player", "banker"].map((side) => (
            <div key={side} className={`csBacHand${settled && coup.winner === side ? " is-winner" : ""}`}>
              <div className="csHandInfo">
                <span className="csHandLabel">{side === "player" ? "PLAYER" : "BANKER"}</span>
                {sideTotal(side) != null && <b className="csTotal">{sideTotal(side)}</b>}
                {settled && coup.natural && Math.max(coup.playerTotal, coup.bankerTotal) >= 8 && B.total(coup[side].slice(0, 2)) >= 8 && <span className="csResult is-win">Natural</span>}
              </div>
              <div className="csCards csFan">
                {coup ? coup[side].map((c, i) => (visible(side, i) ? <PlayingCard key={c.id} card={c} className={`csDealt${i === 2 ? " is-third" : ""}`} /> : <span key={c.id} className="csSlot" />)) : <span className="csSlot" />}
              </div>
            </div>
          ))}
        </div>
        <div className="csMsgRow" aria-live="polite">
          {message}
        </div>
        <div className="csBacSpots" role="group" aria-label="Bets">
          {SIDES.map((s) => (
            <button key={s.id} type="button" className={`csSpot csBac-${s.id}${settled && coup.winner === s.id ? " is-hit" : ""}`} disabled={dealing} onClick={() => add(s.id)} data-spot={s.id}>
              <b>{s.label}</b>
              <small>pays {s.pays}</small>
              <Chip amount={shownBets?.[s.id] || 0} />
            </button>
          ))}
        </div>
        {road.length > 0 && (
          <div className="csRoad" aria-label="Last results">
            {road.map((r, i) => (
              <span key={i} className={`csBead is-${r}`} title={r}>
                {r[0].toUpperCase()}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="csControls">
        <ChipPicker value={prefs.chip} onChange={(chip) => setPrefs({ chip })} max={Math.max(5, bank.balance)} />
        <div className="csActions">
          <button type="button" disabled={dealing || !total} onClick={clear} data-clear>
            Clear
          </button>
          {!total && lastBets && !dealing ? (
            <button type="button" className="csBig" onClick={rebet} data-rebet>
              Rebet {formatChips(Object.values(lastBets).reduce((s, a) => s + a, 0))}
            </button>
          ) : null}
          <button type="button" className="csBig csPrimary" disabled={dealing || !total} onClick={deal} data-act="deal">
            Deal
          </button>
        </div>
        <MoreOptions id="casino.baccarat" inline className="csMore" summary="The drawing rules">
          <div className="csMuted csRules">
            <p>Cards count their last digit: 10s and faces are 0, aces 1. An 8 or 9 on the first two cards is a natural: nobody draws.</p>
            <p>The Player draws a third card on 0-5 and stands on 6-7. If the Player stood, the Banker draws on 0-5. If the Player drew, the Banker draws on 0-2; on 3 unless the Player's third card was an 8; on 4 against 2-7; on 5 against 4-7; on 6 against 6-7; and stands on 7.</p>
            <p>{shoe.length} cards left in the 8-deck shoe.</p>
          </div>
        </MoreOptions>
      </div>
    </div>
  )
}

export default Baccarat
