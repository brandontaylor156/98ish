import React, { useEffect, useRef, useState } from "react"
import MoreOptions from "../../shared/MoreOptions"
import * as R from "./roulette"
import { ChipBar, ChipPicker, Chip, formatChips } from "./parts"
import { sfx } from "./sounds"

// Roulette: tap a chip, tap numbers (straight up) and the outside bets, Spin. Split, street,
// corner and six-line bets, and the American wheel, are under More options. The layout lies
// across on a computer and stands up on a phone (1 2 3 across, like the apps).

const KEY = "98ish.casino.roulette"
const SPIN_MS = 4200
const MODES = [
  ["straight", "Straight up (1 number, 35 to 1)"],
  ["split", "Split (2 side by side, 17 to 1)"],
  ["street", "Street (a row of 3, 11 to 1)"],
  ["corner", "Corner (4 touching, 8 to 1)"],
  ["line", "Six line (2 rows, 5 to 1)"],
]
const load = () => {
  try {
    return { chip: 5, wheel: "european", mode: "straight", ...JSON.parse(localStorage.getItem(KEY) || "{}") }
  } catch {
    return { chip: 5, wheel: "european", mode: "straight" }
  }
}

// where each cell sits in the grid: [colStart, colSpan, rowStart, rowSpan]
const place = (vertical, cell) => {
  if (!vertical) {
    // 14 columns (zero, 12 numbers, 2:1), 8 rows (3 numbers x2 sub-rows, dozens, outside)
    if (cell.n != null) return cell.n === 0 ? [1, 1, cell.american ? 4 : 1, cell.american ? 3 : 6] : cell.n === R.DOUBLE_ZERO ? [1, 1, 1, 3] : [2 + R.colOf(cell.n), 1, 1 + R.rowOf(cell.n) * 2, 2]
    if (cell.column != null) return [14, 1, 1 + R.rowOf(cell.column + 1) * 2, 2]
    if (cell.dozen != null) return [2 + cell.dozen * 4, 4, 7, 1]
    const order = ["low", "even", "red", "black", "odd", "high"]
    return [2 + order.indexOf(cell.outside) * 2, 2, 8, 1]
  }
  // standing up: 8 columns (outside, dozens, 3 numbers x2 sub-columns), 14 rows
  if (cell.n != null) return cell.n === 0 ? [3, cell.american ? 3 : 6, 1, 1] : cell.n === R.DOUBLE_ZERO ? [6, 3, 1, 1] : [3 + (2 - R.rowOf(cell.n)) * 2, 2, 2 + R.colOf(cell.n), 1]
  if (cell.column != null) return [3 + (2 - R.rowOf(cell.column + 1)) * 2, 2, 14, 1]
  if (cell.dozen != null) return [2, 1, 2 + cell.dozen * 4, 4]
  const order = ["low", "even", "red", "black", "odd", "high"]
  return [1, 1, 2 + order.indexOf(cell.outside) * 2, 2]
}

const Wheel = ({ wheel, rotation, result, spinning, small }) => {
  const pockets = R.WHEELS[wheel]
  const seg = 360 / pockets.length
  const r = 100
  return (
    <div className={`csWheel${small ? " is-small" : ""}`}>
      <svg viewBox="-110 -110 220 220" aria-label={result != null && !spinning ? `The ball landed on ${R.label(result)}` : "Roulette wheel"}>
        <circle r="108" fill="#5a3214" stroke="#2b1606" strokeWidth="3" />
        <g style={{ transform: `rotate(${rotation}deg)`, transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.6, 0.18, 1)` : "none" }}>
          {pockets.map((n, i) => {
            const a0 = ((i - 0.5) * seg - 90) * (Math.PI / 180)
            const a1 = ((i + 0.5) * seg - 90) * (Math.PI / 180)
            const color = R.colorOf(n) === "red" ? "#c8102e" : R.colorOf(n) === "black" ? "#111" : "#0a7a3a"
            const tx = Math.cos((i * seg - 90) * (Math.PI / 180)) * 86
            const ty = Math.sin((i * seg - 90) * (Math.PI / 180)) * 86
            return (
              <g key={n}>
                <path d={`M0 0 L${Math.cos(a0) * r} ${Math.sin(a0) * r} A${r} ${r} 0 0 1 ${Math.cos(a1) * r} ${Math.sin(a1) * r} Z`} fill={color} stroke="#d8b25a" strokeWidth="0.6" />
                <text x={tx} y={ty} fill="#fff" fontSize="8" fontFamily="Arial" fontWeight="bold" textAnchor="middle" dominantBaseline="central" transform={`rotate(${i * seg} ${tx} ${ty})`}>
                  {R.label(n)}
                </text>
              </g>
            )
          })}
          <circle r="66" fill="#3a2010" stroke="#d8b25a" strokeWidth="2" />
          <circle r="22" fill="#d8b25a" />
          {[0, 1, 2, 3].map((k) => (
            <rect key={k} x="-3" y="-60" width="6" height="40" fill="#d8b25a" transform={`rotate(${k * 90})`} />
          ))}
        </g>
        <path d="M-7 -110 L7 -110 L0 -96 Z" fill="#f2c200" stroke="#5a3214" />
        {result != null && !spinning && <circle cx="0" cy="-92" r="5" fill="#fff" stroke="#999" />}
      </svg>
    </div>
  )
}

const Roulette = ({ bank, onLobby, mobile }) => {
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
  const [bets, setBets] = useState([])
  const [undo, setUndo] = useState([]) // [{ key, amount }]
  const [lastBets, setLastBets] = useState([])
  const [pending, setPending] = useState(null) // the first number of a split
  const [spinning, setSpinning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [result, setResult] = useState(null)
  const [outcome, setOutcome] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState("")
  const timer = useRef(null)
  const betsRef = useRef(bets)
  betsRef.current = bets
  const wheel = prefs.wheel
  const american = wheel === "american"
  const vertical = mobile

  // closing the window: chips on the table come back
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      const back = betsRef.current.reduce((s, b) => s + b.amount, 0)
      if (back) bank.give(back)
    },
    []
  )

  const keyOf = (b) => `${b.kind}:${b.numbers.join(",")}`
  const total = bets.reduce((s, b) => s + b.amount, 0)

  const addBet = (kind, numbers) => {
    if (spinning) return
    const bet = R.makeBet(kind, numbers, prefs.chip, wheel)
    if (bet.error) return setError(bet.error)
    if (!bank.take(prefs.chip)) return setError("Not enough chips.")
    sfx.chip()
    setError("")
    setOutcome(null)
    const key = keyOf(bet)
    setBets((list) => {
      const found = list.find((b) => keyOf(b) === key)
      return found ? list.map((b) => (keyOf(b) === key ? { ...b, amount: b.amount + prefs.chip } : b)) : [...list, bet]
    })
    setUndo((u) => [...u, { key, amount: prefs.chip }])
  }

  const tapNumber = (n) => {
    if (spinning) return
    const mode = prefs.mode
    if (mode === "straight") return addBet("straight", [n])
    if (mode === "split") {
      if (pending == null) return setPending(n)
      if (pending === n) return setPending(null)
      const pair = R.splitOf(pending, n, wheel)
      setPending(null)
      if (!pair) return setError("A split is two numbers side by side. Tap one, then its neighbour.")
      return addBet("split", pair)
    }
    if (n === 0 || n === R.DOUBLE_ZERO) {
      // the zeroes' own combination bets
      return american ? addBet("basket", R.BASKET) : addBet("first4", R.FIRST4)
    }
    const nums = R.insideBet(mode, n)
    if (nums) addBet(mode, nums)
  }

  const removeKey = (key, amount) => {
    setBets((list) => list.map((b) => (keyOf(b) === key ? { ...b, amount: b.amount - amount } : b)).filter((b) => b.amount > 0))
    bank.give(amount)
  }
  const undoLast = () => {
    const last = undo[undo.length - 1]
    if (!last || spinning) return
    removeKey(last.key, last.amount)
    setUndo(undo.slice(0, -1))
  }
  const clear = () => {
    if (spinning || !total) return
    bank.give(total)
    setBets([])
    setUndo([])
  }
  const rebet = () => {
    const cost = lastBets.reduce((s, b) => s + b.amount, 0)
    if (!cost || !bank.take(cost)) return setError("Not enough chips to rebet.")
    sfx.chips()
    setBets(lastBets)
    setUndo(lastBets.map((b) => ({ key: keyOf(b), amount: b.amount })))
    setOutcome(null)
  }

  const spin = () => {
    if (spinning) return
    if (!bets.length) return setError("Place a bet first: pick a chip, then tap the table.")
    setError("")
    setPending(null)
    const n = R.spin(wheel)
    const pockets = R.WHEELS[wheel]
    const seg = 360 / pockets.length
    const target = -pockets.indexOf(n) * seg
    const base = rotation - (rotation % 360)
    setRotation(base + 360 * 5 + (((target % 360) + 360) % 360))
    setSpinning(true)
    setResult(n)
    setOutcome(null)
    sfx.ball(SPIN_MS / 1000 - 0.4)
    const placed = bets
    timer.current = setTimeout(() => {
      const out = R.settleAll(placed, n)
      bank.give(out.returned, out.net)
      setSpinning(false)
      setOutcome(out)
      setHistory((h) => [n, ...h].slice(0, 14))
      setLastBets(placed)
      setBets([])
      setUndo([])
      if (out.net > 0) (out.returned >= out.staked * 10 ? sfx.bigWin : sfx.win)()
      else sfx.lose()
    }, SPIN_MS)
  }

  // the chips on each cell (straight and outside bets), and the numbers other bets cover
  const onCell = (match) => bets.filter(match).reduce((s, b) => s + b.amount, 0)
  const combos = bets.filter((b) => !["straight", "red", "black", "odd", "even", "low", "high", "dozen", "column"].includes(b.kind))
  const covered = new Set(combos.flatMap((b) => b.numbers))
  const winning = !spinning && result != null && outcome
  const isWinCell = (nums) => winning && nums.includes(result)

  const cells = []
  const numbers = [...(american ? [R.DOUBLE_ZERO] : []), 0, ...Array.from({ length: 36 }, (_, i) => i + 1)]
  for (const n of numbers) cells.push({ n, american, key: `n${n}`, nums: [n], amount: onCell((b) => b.kind === "straight" && b.numbers[0] === n), label: R.label(n), color: R.colorOf(n), onClick: () => tapNumber(n) })
  for (let k = 0; k < 3; k++) cells.push({ column: k, key: `c${k}`, nums: R.column(k), amount: onCell((b) => b.kind === "column" && b.numbers[0] === k + 1), label: "2 to 1", onClick: () => addBet("column", R.column(k)) })
  for (let k = 0; k < 3; k++) cells.push({ dozen: k, key: `d${k}`, nums: R.dozen(k), amount: onCell((b) => b.kind === "dozen" && b.numbers[0] === k * 12 + 1), label: ["1st 12", "2nd 12", "3rd 12"][k], onClick: () => addBet("dozen", R.dozen(k)) })
  for (const o of ["low", "even", "red", "black", "odd", "high"])
    cells.push({ outside: o, key: o, nums: R.OUTSIDE[o].numbers, amount: onCell((b) => b.kind === o), label: R.OUTSIDE[o].label, color: o === "red" || o === "black" ? o : null, onClick: () => addBet(o, R.OUTSIDE[o].numbers) })

  let message
  if (error) message = <span className="csMsg is-error">{error}</span>
  else if (spinning) message = <span className="csMsg">No more bets!</span>
  else if (outcome)
    message = (
      <span className={`csMsg ${outcome.net > 0 ? "is-win" : "is-lose"}`} data-net={outcome.net}>
        <b className={`csPocket is-${R.colorOf(result)}`}>{R.label(result)}</b> {outcome.net > 0 ? `You win ${formatChips(outcome.returned)}!` : outcome.returned > 0 ? `${formatChips(outcome.returned)} back.` : "No luck this time."}
      </span>
    )
  else if (pending != null) message = <span className="csMsg">Split: now tap a number next to {R.label(pending)}.</span>
  else message = <span className="csMsg">{total ? `${formatChips(total)} on the table. Spin when ready.` : prefs.mode === "straight" ? "Pick a chip, then tap a number or an outside bet." : `${MODES.find((m) => m[0] === prefs.mode)[1].split(" (")[0]}: tap a number.`}</span>

  return (
    <div className={`csGame csRoulette${vertical ? " is-upright" : ""}`}>
      <ChipBar title="Roulette" onLobby={onLobby} bank={bank} />
      <div className="csFelt csRouletteFelt" data-touch-surface>
        <div className="csWheelRow">
          <Wheel wheel={wheel} rotation={rotation} result={result} spinning={spinning} small={mobile} />
          <div className="csHistory" aria-label="Last numbers">
            {history.map((n, i) => (
              <span key={i} className={`csPocket is-${R.colorOf(n)}${i === 0 ? " is-last" : ""}`}>
                {R.label(n)}
              </span>
            ))}
          </div>
        </div>
        <div className="csMsgRow">{message}</div>
        <div className={`csLayout${vertical ? " is-upright" : ""}${american ? " is-american" : ""}`} role="group" aria-label="Betting table">
          {cells.map((c) => {
            const [col, cs, row, rs] = place(vertical, c)
            const cls = c.n != null ? `csNum is-${c.color}` : `csOut${c.color ? ` is-${c.color}` : ""}`
            return (
              <button
                key={c.key}
                type="button"
                className={`${cls}${c.n != null && covered.has(c.n) ? " is-covered" : ""}${pending === c.n && c.n != null ? " is-pending" : ""}${isWinCell(c.nums) ? " is-hit" : ""}`}
                style={{ gridColumn: `${col} / span ${cs}`, gridRow: `${row} / span ${rs}` }}
                disabled={spinning}
                onClick={c.onClick}
                data-cell={c.key}
              >
                <span className="csCellLabel">{c.label}</span>
                {c.amount > 0 && <Chip amount={c.amount} small className="csOnCell" />}
              </button>
            )
          })}
        </div>
        {combos.length > 0 && (
          <div className="csBetList">
            {combos.map((b) => (
              <span key={keyOf(b)} className="csBetTag">
                <Chip amount={b.amount} small /> {R.describeBet(b)}
                <button type="button" aria-label={`Take back ${R.describeBet(b)}`} disabled={spinning} onClick={() => removeKey(keyOf(b), b.amount)}>
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
          <button type="button" disabled={spinning || !undo.length} onClick={undoLast} data-undo>
            Undo
          </button>
          <button type="button" disabled={spinning || !total} onClick={clear} data-clear>
            Clear
          </button>
          {!total && lastBets.length > 0 && !spinning ? (
            <button type="button" className="csBig" onClick={rebet} data-rebet>
              Rebet {formatChips(lastBets.reduce((s, b) => s + b.amount, 0))}
            </button>
          ) : null}
          <button type="button" className="csBig csPrimary" disabled={spinning || !total} onClick={spin} data-act="spin">
            {spinning ? "Spinning..." : "Spin"}
          </button>
        </div>
        <MoreOptions id="casino.roulette" inline className="csMore" summary={`${american ? "American (0, 00)" : "European (0)"} · ${MODES.find((m) => m[0] === prefs.mode)[1].split(" (")[0]}`}>
          <div className="csOpts">
            <label className="csField">
              <span>Bet type for number taps</span>
              <select value={prefs.mode} onChange={(e) => (setPrefs({ mode: e.target.value }), setPending(null))} data-mode>
                {MODES.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="csField">
              <span>Wheel</span>
              <select value={wheel} disabled={spinning || total > 0} onChange={(e) => setPrefs({ wheel: e.target.value })}>
                <option value="european">European: one zero (2.7% house edge)</option>
                <option value="american">American: 0 and 00 (5.3% house edge)</option>
              </select>
            </label>
            <span className="csMuted">In any bet type but Split, tapping 0{american ? " or 00 bets the top line (0, 00, 1, 2, 3; 6 to 1)" : " bets the first four (0, 1, 2, 3; 8 to 1)"}.</span>
          </div>
        </MoreOptions>
      </div>
    </div>
  )
}

export default Roulette
