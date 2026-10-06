import React, { useEffect, useMemo, useRef, useState } from "react"
import { PlayingCard, Chip, formatChips } from "./parts"
import { sfx } from "./sounds"
import { ordinal } from "./holdem"

// The Hold'em table: seats round an oval felt (you at the bottom), the board and the pot in
// the middle, and your actions underneath: Fold, Check/Call, and Raise with a slider and
// quick sizes (Min, ½ Pot, Pot, All-in). Works for tables against the computer and online
// (view = holdem.js view(); act(action) -> Promise<{ ok, error }>).

const seatSpot = (k, n, mobile) => {
  // k = places to the left of you (0 = you, at the bottom)
  const a = Math.PI / 2 + (k * 2 * Math.PI) / n
  const rx = mobile ? 38 : 42
  const ry = mobile ? 40 : 37
  return { x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a) }
}

const Countdown = ({ deadline, now, turnId }) => {
  if (!deadline) return null
  const left = Math.max(0, deadline - now())
  return <span key={turnId} className="csClock" style={{ animationDuration: `${left}ms` }} aria-hidden="true" />
}

const HoldemTable = ({ view, names, act, mobile, footer = null, frozen = false, now = () => Date.now(), onEvent }) => {
  const you = view.you
  const n = view.seats.length
  const legal = view.legal
  const [raiseTo, setRaiseTo] = useState(0)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const anchor = you ?? 0
  const winners = useMemo(() => {
    const out = new Set()
    for (const p of view.results?.pots || []) for (const w of p.winners) out.add(w)
    return out
  }, [view.results])
  const bestIds = useMemo(() => {
    const ids = new Set()
    if (view.results && !view.results.uncontested) for (const w of winners) for (const id of view.results.hands?.[w]?.best || []) ids.add(id)
    return ids
  }, [view.results, winners])

  // sounds and events: new cards, your turn, the end of a hand
  const seen = useRef({ board: 0, hand: 0, turn: 0, done: false })
  useEffect(() => {
    const s = seen.current
    if (view.handNo !== s.hand) {
      s.hand = view.handNo
      s.board = 0
      s.done = false
      sfx.deal(Math.min(6, view.seats.filter((x) => !x.out).length))
    }
    if (view.board.length > s.board) {
      for (let i = s.board; i < view.board.length; i++) sfx.card((i - s.board) * 0.12)
      s.board = view.board.length
    }
    if (legal && view.turnId !== s.turn) {
      s.turn = view.turnId
      sfx.turn()
    }
    if (view.done && !s.done) {
      s.done = true
      const mine = view.results?.won?.[you]
      if (mine) sfx.chips()
      onEvent?.({ type: "hand", won: mine || 0, view })
    }
  }, [view.handNo, view.board.length, view.turnId, view.done])

  // the raise slider starts at the minimum each turn
  useEffect(() => {
    if (legal) setRaiseTo(legal.minTo)
    setError("")
  }, [view.turnId, !!legal])

  const send = async (action) => {
    if (busy) return
    setBusy(true)
    sfx.chip()
    const out = await act(action)
    setBusy(false)
    if (out && !out.ok && out.error) {
      setError(out.error)
      sfx.bad()
    }
  }

  const potAfterCall = legal ? legal.pot + legal.toCall : 0
  const sizes = legal
    ? [
        { label: "Min", to: legal.minTo },
        { label: "½ Pot", to: legal.currentBet + Math.round(potAfterCall / 2) },
        { label: "Pot", to: legal.currentBet + potAfterCall },
        { label: "All-in", to: legal.maxTo },
      ].map((s) => ({ ...s, to: Math.max(legal.minTo, Math.min(legal.maxTo, s.to)) }))
    : []
  const step = Math.max(1, view.blinds.sb)

  const toActName = view.toAct >= 0 ? names[view.toAct] : null
  let status
  if (view.finished || frozen) status = null
  else if (view.done && view.results) {
    const pots = view.results.pots
    status = pots
      .map((p, k) => {
        const who = p.winners.map((w) => (w === you ? "You" : names[w])).join(" & ")
        const what = pots.length > 1 ? (k === 0 ? "main pot" : `side pot ${k}`) : "the pot"
        return `${who} ${p.winners.length > 1 ? "split" : p.winners[0] === you ? "win" : "wins"} ${what} (${formatChips(p.amount)})${p.hand ? ` with ${p.hand}` : ""}`
      })
      .join(". ")
  } else if (view.runout) status = "All-in! Running out the board..."
  else if (legal) status = legal.toCall > 0 ? `Your turn: ${formatChips(legal.toCall)} to call.` : "Your turn."
  else if (toActName) status = `${toActName} is thinking...`

  const blindsText = `Blinds ${formatChips(view.blinds.sb)}/${formatChips(view.blinds.bb)}${view.blinds.handsLeft ? ` · up in ${view.blinds.handsLeft}` : ""}`

  return (
    <div className={`csHoldem${mobile ? " is-mobile" : ""}`}>
      <div className="csPokerArea" data-touch-surface>
        <div className="csOval">
          <div className="csBoard" aria-label="Board">
            {[0, 1, 2, 3, 4].map((i) =>
              view.board[i] ? <PlayingCard key={view.board[i].id} card={view.board[i]} small={mobile} glow={bestIds.has(view.board[i].id)} dim={bestIds.size > 0 && !bestIds.has(view.board[i].id)} className="csDealt" /> : <span key={i} className={`csSlot${mobile ? " is-small" : ""}`} />
            )}
          </div>
          <div className="csPot" data-pot={view.pot}>
            {view.pot > 0 ? (
              <>
                <Chip amount={view.pot} small /> Pot {formatChips(view.pot)}
              </>
            ) : (
              <span className="csMuted">{blindsText}</span>
            )}
          </div>
        </div>
        {view.seats.map((s, i) => {
          const k = (i - anchor + n) % n
          const spot = seatSpot(k, n, mobile)
          const me = i === you
          const betSpot = { x: spot.x + (50 - spot.x) * 0.42, y: spot.y + (50 - spot.y) * 0.42 }
          const showCards = s.cards.length > 0
          return (
            <React.Fragment key={i}>
              <div
                className={`csSeat${me ? " is-you" : ""}${view.toAct === i ? " is-turn" : ""}${s.folded ? " is-folded" : ""}${s.out ? " is-out" : ""}${winners.has(i) && view.done ? " is-winner" : ""}`}
                style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
                data-seat={i}
              >
                {showCards && (
                  <div className={`csHole${me ? " is-mine" : ""}`}>
                    {s.cards.map((c, j) => (
                      <PlayingCard key={c ? c.id : `d${j}`} card={c} down={!c} small={!me || mobile} glow={c && bestIds.has(c.id)} className="csDealt" />
                    ))}
                  </div>
                )}
                <div className="csPlate">
                  <b className="csName">{me ? "You" : names[i]}</b>
                  <span className="csStack">{s.out ? (s.place ? `${ordinal(s.place)} place` : "Out") : formatChips(s.stack)}</span>
                  {s.last && !s.out && <span className={`csLast${s.last === "Fold" ? " is-fold" : s.last === "All-in" ? " is-allin" : ""}`}>{s.last}</span>}
                  {view.toAct === i && <Countdown deadline={view.deadline} now={now} turnId={view.turnId} />}
                </div>
                {view.button === i && !s.out && <span className="csDealerBtn" title="Dealer button">D</span>}
              </div>
              {s.bet > 0 && (
                <div className="csBetChip" style={{ left: `${betSpot.x}%`, top: `${betSpot.y}%` }}>
                  <Chip amount={s.bet} small /> <span>{formatChips(s.bet)}</span>
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>
      <div className="csMsgRow csHoldemMsg" aria-live="polite">
        {error ? <span className="csMsg is-error">{error}</span> : status ? <span className={`csMsg${view.done && view.results?.won?.[you] ? " is-win" : ""}`}>{status}</span> : null}
      </div>
      {footer}
      {legal && !view.finished && !frozen && (
        <div className="csControls csPokerControls">
          {legal.canRaise && (
            <div className="csRaise">
              <div className="csSizes">
                {sizes.map((s) => (
                  <button key={s.label} type="button" className={raiseTo === s.to ? "is-on" : ""} onClick={() => setRaiseTo(s.to)}>
                    {s.label}
                  </button>
                ))}
              </div>
              <input
                type="range"
                className="csSlider"
                min={legal.minTo}
                max={legal.maxTo}
                step={step}
                value={raiseTo}
                onChange={(e) => setRaiseTo(Math.min(legal.maxTo, Math.max(legal.minTo, Number(e.target.value))))}
                aria-label="Raise to"
              />
            </div>
          )}
          <div className="csActions">
            <button type="button" className="csBig" disabled={busy} onClick={() => send({ type: "fold" })} data-act="fold">
              Fold
            </button>
            <button type="button" className="csBig csPrimary" disabled={busy} onClick={() => send({ type: legal.canCheck ? "check" : "call" })} data-act="call">
              {legal.canCheck ? "Check" : legal.toCall >= legal.stack ? `All-in ${formatChips(legal.toCall)}` : `Call ${formatChips(legal.toCall)}`}
            </button>
            {legal.canRaise && (
              <button type="button" className="csBig" disabled={busy} onClick={() => send({ type: "raise", to: raiseTo })} data-act="raise">
                {raiseTo >= legal.maxTo ? `All-in ${formatChips(raiseTo)}` : `${legal.currentBet ? "Raise to" : "Bet"} ${formatChips(raiseTo)}`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default HoldemTable
