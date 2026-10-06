import React, { useEffect, useRef, useState } from "react"
import MoreOptions from "../../shared/MoreOptions"
import { useDisclosure } from "../../../utils/disclosure"
import * as C from "./craps"
import { ChipBar, ChipPicker, Chip, formatChips } from "./parts"
import { sfx } from "./sounds"

// Craps: the Pass Line and its Odds are always on the table; Don't Pass, Come, Don't Come,
// the Field and Place bets (tap a number box) come out with More options. Roll!

const KEY = "98ish.casino.craps"
const MORE = "casino.craps"
const ROLL_MS = 700
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }
const load = () => {
  try {
    return { chip: 5, ...JSON.parse(localStorage.getItem(KEY) || "{}") }
  } catch {
    return { chip: 5 }
  }
}

const Die = ({ value, rolling }) => (
  <span className={`csDie${rolling ? " is-rolling" : ""}`} aria-label={`Die showing ${value}`}>
    {Array.from({ length: 9 }, (_, i) => (
      <i key={i} className={PIPS[value].includes(i) ? "is-pip" : ""} />
    ))}
  </span>
)

const Craps = ({ bank, onLobby }) => {
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
  const [table, setTable] = useState(C.newTable)
  const [dice, setDice] = useState([3, 4])
  const [rolling, setRolling] = useState(false)
  const [last, setLast] = useState(null) // { total, results, returned }
  const [error, setError] = useState("")
  const [advanced] = useDisclosure(MORE, false)
  const tableRef = useRef(table)
  tableRef.current = table
  const timer = useRef(null)

  // closing the window: every bet still on the table comes back (a friendly house)
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      const back = C.onTable(tableRef.current)
      if (back) bank.give(back)
    },
    []
  )

  const bet = (kind, number = null, amount = prefs.chip) => {
    if (rolling) return
    const next = C.placeBet(table, { kind, amount, number })
    if (next.error) {
      sfx.bad()
      return setError(next.error)
    }
    if (!bank.take(amount)) return setError("Not enough chips.")
    sfx.chip()
    setError("")
    setTable(next)
  }
  const odds = (kind, number = null) => {
    const have = table.bets.find((b) => b.kind === kind && (b.number ?? null) === number)?.amount || 0
    const room = C.maxOdds(table, kind, number) - have
    if (room <= 0) return setError(room === 0 && have ? "That's the most odds allowed." : "Put a bet on the line first.")
    bet(kind, number, Math.min(room, prefs.chip))
  }
  const takeDown = (i) => {
    const out = C.removeBet(table, i)
    if (out.error) return setError(out.error)
    bank.give(out.refund)
    sfx.chip()
    setTable(out.state)
  }

  const roll = () => {
    if (rolling) return
    if (!table.bets.length) return setError(table.point ? "Put a bet down first." : "Bet the Pass Line first: pick a chip and tap PASS LINE.")
    setError("")
    setRolling(true)
    sfx.dice()
    const final = C.rollDice()
    const shake = setInterval(() => setDice(C.rollDice()), 90)
    timer.current = setTimeout(() => {
      clearInterval(shake)
      setDice(final)
      const out = C.resolve(tableRef.current, final)
      if (out.returned) bank.give(out.returned, null)
      setTable(out.state)
      setLast(out)
      setRolling(false)
      const won = out.results.filter((r) => r.outcome === "win").length
      const lost = out.results.filter((r) => r.outcome === "lose").length
      if (won && out.returned >= 100) sfx.bigWin()
      else if (won) sfx.win()
      else if (lost) sfx.lose()
    }, ROLL_MS)
  }

  const amountOf = (kind, number = null) => table.bets.filter((b) => b.kind === kind && (number == null || b.number === number)).reduce((s, b) => s + b.amount, 0)
  const point = table.point

  let message
  if (error) message = <span className="csMsg is-error">{error}</span>
  else if (rolling) message = <span className="csMsg">Rolling...</span>
  else if (last) {
    const won = last.results.filter((r) => r.outcome === "win").reduce((s, r) => s + r.returned, 0)
    const lost = last.results.filter((r) => r.outcome === "lose").reduce((s, r) => s + r.bet.amount, 0)
    const call = last.total === 7 && !point ? (table.history.length && last.results.some((r) => r.outcome === "lose") ? "Seven out!" : "Seven!") : point && point === last.total && last.results.some((r) => r.bet.kind === "pass") ? `${last.total}: point is on.` : `${last.total}!`
    message = (
      <span className={`csMsg ${won > 0 ? "is-win" : lost > 0 ? "is-lose" : ""}`} data-total={last.total}>
        {call} {won > 0 ? `You collect ${formatChips(won)}.` : ""} {lost > 0 ? `Lost ${formatChips(lost)}.` : ""}
      </span>
    )
  } else message = <span className="csMsg">{point ? `The point is ${point}. Roll it again before a 7.` : "Come-out roll: bet the Pass Line, then Roll."}</span>

  const pointHint = point ? `Point ${point}: roll ${point} before 7` : "Come-out roll"
  const removable = table.bets.map((b, i) => ({ b, i })).filter(({ b }) => C.canRemove(table, b))

  return (
    <div className="csGame csCraps">
      <ChipBar title="Craps" onLobby={onLobby} bank={bank} />
      <div className="csFelt csCrapsFelt" data-touch-surface>
        <div className="csDiceRow">
          <Die value={dice[0]} rolling={rolling} />
          <Die value={dice[1]} rolling={rolling} />
          <span className={`csPuck${point ? " is-on" : ""}`}>{point ? "ON" : "OFF"}</span>
        </div>
        <div className="csMsgRow" aria-live="polite">
          {message}
        </div>
        <div className="csBoxes" role="group" aria-label="Numbers">
          {C.POINTS.map((n) => {
            const place = amountOf("place", n)
            const come = amountOf("come", n)
            const comeOdds = amountOf("comeodds", n)
            const dcome = amountOf("dontcome", n)
            const dcomeOdds = amountOf("dontcomeodds", n)
            return (
              <div key={n} className={`csBox${point === n ? " is-point" : ""}`} data-box={n}>
                <button type="button" className="csBoxNum" disabled={!advanced || rolling} onClick={() => bet("place", n)} aria-label={advanced ? `Place ${n}` : `${n}`}>
                  {n === 6 ? "SIX" : n === 9 ? "NINE" : n}
                </button>
                {point === n && <span className="csPuck is-on is-small">ON</span>}
                {place > 0 && (
                  <span className="csBoxBet" title="Place bet">
                    <Chip amount={place} small /> place
                  </span>
                )}
                {come > 0 && (
                  <span className="csBoxBet">
                    <Chip amount={come} small /> come
                    <button type="button" className="csOddsBtn" disabled={rolling} onClick={() => odds("comeodds", n)}>
                      +odds{comeOdds ? ` ${comeOdds}` : ""}
                    </button>
                  </span>
                )}
                {dcome > 0 && (
                  <span className="csBoxBet">
                    <Chip amount={dcome} small /> don't
                    <button type="button" className="csOddsBtn" disabled={rolling} onClick={() => odds("dontcomeodds", n)}>
                      +odds{dcomeOdds ? ` ${dcomeOdds}` : ""}
                    </button>
                  </span>
                )}
              </div>
            )
          })}
        </div>
        {advanced && (
          <div className="csCrapsRow">
            <button type="button" className="csSpot csCome" disabled={rolling} onClick={() => bet("come")} data-spot="come">
              <b>COME</b>
              {amountOf("come", null) > 0 && <Chip amount={table.bets.filter((b) => b.kind === "come" && b.number == null).reduce((s, b) => s + b.amount, 0)} small />}
            </button>
            <button type="button" className="csSpot csFieldBet" disabled={rolling} onClick={() => bet("field")} data-spot="field">
              <b>FIELD</b>
              <small>2 pays double · 3 4 9 10 11 · 12 pays triple</small>
              <Chip amount={amountOf("field")} small />
            </button>
            <button type="button" className="csSpot" disabled={rolling} onClick={() => bet("dontcome")} data-spot="dontcome">
              <b>DON'T COME</b>
              {table.bets.some((b) => b.kind === "dontcome" && b.number == null) && <Chip amount={table.bets.filter((b) => b.kind === "dontcome" && b.number == null).reduce((s, b) => s + b.amount, 0)} small />}
            </button>
          </div>
        )}
        {advanced && (
          <div className="csCrapsRow">
            <button type="button" className="csSpot csDont" disabled={rolling} onClick={() => bet("dontpass")} data-spot="dontpass">
              <b>DON'T PASS BAR 12</b>
              <Chip amount={amountOf("dontpass")} small />
            </button>
            <button type="button" className="csSpot csOdds" disabled={rolling || !point || !amountOf("dontpass")} onClick={() => odds("dontodds")} data-spot="dontodds">
              <b>DON'T ODDS</b>
              <Chip amount={amountOf("dontodds")} small />
            </button>
          </div>
        )}
        <div className="csCrapsRow">
          <button type="button" className="csSpot csPass" disabled={rolling} onClick={() => bet("pass")} data-spot="pass">
            <b>PASS LINE</b>
            <small>{pointHint}</small>
            <Chip amount={amountOf("pass")} />
          </button>
          <button type="button" className="csSpot csOdds" disabled={rolling || !point || !amountOf("pass")} onClick={() => odds("passodds")} data-spot="passodds">
            <b>ODDS</b>
            <small>{point ? `pays ${C.ODDS[point][0]} to ${C.ODDS[point][1]}` : "after the point"}</small>
            <Chip amount={amountOf("passodds")} />
          </button>
        </div>
        {removable.length > 0 && !rolling && (
          <div className="csBetList">
            {removable.map(({ b, i }) => (
              <span key={i} className="csBetTag">
                <Chip amount={b.amount} small /> {C.describeBet(b)}
                <button type="button" aria-label={`Take down ${C.describeBet(b)}`} onClick={() => takeDown(i)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="csControls">
        <ChipPicker value={prefs.chip} onChange={(chip) => setPrefs({ chip })} max={Math.max(5, bank.balance)} />
        <div className="csActions">
          <span className="csOnTable">On the table: {formatChips(C.onTable(table))}</span>
          <button type="button" className="csBig csPrimary" disabled={rolling} onClick={roll} data-act="roll">
            {rolling ? "Rolling..." : "Roll"}
          </button>
        </div>
        <MoreOptions id={MORE} inline className="csMore" summary="Don't Pass, Come, Field, Place bets">
          <p className="csMuted">
            Tap a number box to Place it (4 and 10 pay 9 to 5, 5 and 9 pay 7 to 5, 6 and 8 pay 7 to 6; off on come-out rolls). Come and Don't Come work like the line bets, moving to the next number rolled; then they can take odds. Odds are capped at 3x, 4x and 5x (4/10, 5/9, 6/8).
          </p>
        </MoreOptions>
      </div>
    </div>
  )
}

export default Craps
