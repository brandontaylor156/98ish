import React, { useEffect, useRef, useState } from "react"
import MoreOptions from "../../shared/MoreOptions"
import { unlock } from "../../../utils/achievements"
import * as VP from "./videoPoker"
import { ChipBar, PlayingCard, formatChips } from "./parts"
import { sfx } from "./sounds"

// Video Poker, Jacks or Better (9/6): Bet One / Bet Max, Deal, tap cards to hold, Draw.
// The paytable sits on top (on a phone, just the column for your bet); the coin size and
// the strategy hint are under More options.

const KEY = "98ish.casino.videopoker"
const DENOMS = [1, 5, 25, 100]
const load = () => {
  try {
    return { coins: 5, denom: 5, hint: false, ...JSON.parse(localStorage.getItem(KEY) || "{}") }
  } catch {
    return { coins: 5, denom: 5, hint: false }
  }
}

const VideoPoker = ({ bank, onLobby, mobile }) => {
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
  const [round, setRound] = useState(null) // { hand, deck, held, phase: "hold" | "done", bet, result }
  const [error, setError] = useState("")
  const roundRef = useRef(round)
  roundRef.current = round
  const bet = prefs.coins * prefs.denom

  // closing the window mid-hand: draw nothing (stand pat) and pay what the hand pays
  useEffect(
    () => () => {
      const r = roundRef.current
      if (r?.phase === "hold") {
        const pay = VP.payFor(r.hand, r.coins, r.denom)
        bank.give(pay.win, pay.win - r.bet)
      }
    },
    []
  )

  const deal = () => {
    if (!bank.take(bet)) return setError("Not enough chips. Bet fewer coins or a smaller coin.")
    setError("")
    sfx.deal(5)
    const d = VP.deal()
    setRound({ ...d, held: [false, false, false, false, false], phase: "hold", bet, coins: prefs.coins, denom: prefs.denom, result: null, n: (round?.n || 0) + 1 })
  }
  const toggle = (i) => {
    if (round?.phase !== "hold") return
    sfx.hold()
    setRound({ ...round, held: round.held.map((h, k) => (k === i ? !h : h)) })
  }
  const draw = () => {
    const next = VP.draw(round, round.held)
    const pay = VP.payFor(next.hand, round.coins, round.denom)
    bank.give(pay.win, pay.win - round.bet)
    const drawn = round.held.filter((h) => !h).length
    if (drawn) sfx.deal(drawn)
    if (pay.id === "royal") unlock("casino-royal")
    if (pay.win >= round.bet * 25) setTimeout(() => sfx.bigWin(), 250)
    else if (pay.win > 0) setTimeout(() => sfx.win(), 250)
    setRound({ ...round, ...next, phase: "done", result: pay })
  }
  const main = () => (round?.phase === "hold" ? draw() : deal())

  useEffect(() => {
    if (mobile) return
    const onKey = (e) => {
      if (e.target.closest?.("input, select, textarea")) return
      if (e.key >= "1" && e.key <= "5") toggle(Number(e.key) - 1)
      else if (e.key === "Enter" || e.key === " ") {
        if (document.activeElement?.tagName === "BUTTON") return
        e.preventDefault()
        main()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const hold = round?.phase === "hold"
  const hintHeld = hold && prefs.hint ? VP.hint(round.hand) : null
  const current = hold ? VP.classify(round.hand) : round?.result?.id
  const coinsShown = round && hold ? round.coins : prefs.coins
  const cols = mobile ? [coinsShown] : [1, 2, 3, 4, 5]

  return (
    <div className="csGame csVideoPoker">
      <ChipBar title="Video Poker" onLobby={onLobby} bank={bank} />
      <div className="csFelt csVpFelt" data-touch-surface>
        <table className="csVpPays" aria-label="Paytable">
          <thead>
            <tr>
              <th>Jacks or Better</th>
              {cols.map((c) => (
                <th key={c} className={c === coinsShown ? "is-on" : ""}>
                  {c} coin{c > 1 ? "s" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {VP.HANDS.map((h) => (
              <tr key={h.id} className={current === h.id ? "is-hit" : ""}>
                <td>{h.name}</td>
                {cols.map((c) => (
                  <td key={c} className={c === coinsShown ? "is-on" : ""}>
                    {formatChips(h.pays[c - 1] * (round && hold ? round.denom : prefs.denom))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="csVpHand">
          {(round?.hand || [null, null, null, null, null]).map((c, i) => (
            <button key={c ? `${round.n}-${c.id}` : i} type="button" className={`csVpCard${round?.held[i] ? " is-held" : ""}${hintHeld?.[i] ? " is-hint" : ""}`} disabled={!hold} onClick={() => toggle(i)} data-card={i} aria-pressed={!!round?.held[i]}>
              <span className="csHeld">{round?.held[i] ? "HELD" : hintHeld?.[i] ? "hold?" : " "}</span>
              <PlayingCard card={c} down={!c} small={mobile} className={c ? "csDealt" : ""} />
            </button>
          ))}
        </div>
        <div className="csMsgRow" aria-live="polite">
          {error ? (
            <span className="csMsg is-error">{error}</span>
          ) : round?.phase === "done" ? (
            <span className={`csMsg ${round.result.win ? "is-win" : "is-lose"}`} data-win={round.result.win}>
              {round.result.win ? `${round.result.name}! You win ${formatChips(round.result.win)}.` : "No win. Deal again?"}
            </span>
          ) : hold ? (
            <span className="csMsg">Tap the cards to hold, then Draw.</span>
          ) : (
            <span className="csMsg">Bet {formatChips(bet)} ({prefs.coins} coin{prefs.coins > 1 ? "s" : ""} of {prefs.denom}). Deal!</span>
          )}
        </div>
      </div>
      <div className="csControls">
        <div className="csActions">
          <button type="button" disabled={hold} onClick={() => (sfx.click(), setPrefs({ coins: (prefs.coins % 5) + 1 }))} data-betone>
            Bet One ({prefs.coins})
          </button>
          <button type="button" disabled={hold || prefs.coins === 5} onClick={() => (sfx.click(), setPrefs({ coins: 5 }))} data-betmax>
            Bet Max
          </button>
          <button type="button" className="csBig csPrimary" disabled={!hold && bet > bank.balance} onClick={main} data-act={hold ? "draw" : "deal"}>
            {hold ? "Draw" : "Deal"}
          </button>
        </div>
        <MoreOptions id="casino.videopoker" inline className="csMore" summary={`Coin ${prefs.denom}${prefs.hint ? " · Hints" : ""}`}>
          <div className="csOpts">
            <label className="csField">
              <span>Coin size</span>
              <select value={prefs.denom} disabled={hold} onChange={(e) => setPrefs({ denom: Number(e.target.value) })}>
                {DENOMS.map((d) => (
                  <option key={d} value={d}>
                    {d} chip{d > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input type="checkbox" checked={prefs.hint} onChange={(e) => setPrefs({ hint: e.target.checked })} /> Suggest which cards to hold
            </label>
            <span className="csMuted">Full-pay 9/6 Jacks or Better returns about 99.5% with perfect play. Five coins turns the royal flush from 250 a coin into 800 a coin.</span>
          </div>
        </MoreOptions>
      </div>
    </div>
  )
}

export default VideoPoker
