import React, { useEffect, useRef, useState } from "react"
import MoreOptions from "../../shared/MoreOptions"
import { unlock } from "../../../utils/achievements"
import * as S from "./slots"
import { ChipBar, formatChips } from "./parts"
import { sfx } from "./sounds"

// Lucky 98 slots: pick the lines (1-5) and the coin, Spin. The reels are long strips that
// scroll and stop one after another; winning lines light up. The paytable is under More
// options.

const KEY = "98ish.casino.slots"
const STOP_MS = [900, 1300, 1700]
const LOOPS = 3 // whole strips each reel travels per spin
const load = () => {
  try {
    return { lines: 5, coin: 1, ...JSON.parse(localStorage.getItem(KEY) || "{}") }
  } catch {
    return { lines: 5, coin: 1 }
  }
}

// original symbol art (SVG, 40 x 40)
export const SlotSymbol = ({ id }) => {
  switch (id) {
    case "wild":
      return (
        <svg viewBox="0 0 40 40" aria-label="98 Wild">
          <rect x="3" y="7" width="34" height="26" rx="5" fill="#008080" stroke="#003c3c" strokeWidth="2" />
          <rect x="6" y="10" width="28" height="20" rx="3" fill="none" stroke="#7ff" strokeWidth="1" />
          <text x="20" y="25.5" textAnchor="middle" fontFamily="Arial Black, Arial" fontWeight="900" fontSize="15" fill="#ff0" stroke="#000" strokeWidth="0.8">
            98
          </text>
        </svg>
      )
    case "seven":
      return (
        <svg viewBox="0 0 40 40" aria-label="Lucky 7">
          <path d="M9 7h23v5L19 34h-7l12-21H9z" fill="#e01b24" stroke="#5a0000" strokeWidth="2" strokeLinejoin="round" />
          <path d="M11 9h18" stroke="#ff9" strokeWidth="1.5" />
        </svg>
      )
    case "floppy":
      return (
        <svg viewBox="0 0 40 40" aria-label="Floppy">
          <path d="M6 5h24l5 5v25H6z" fill="#2a4bd7" stroke="#0b1a5c" strokeWidth="2" strokeLinejoin="round" />
          <rect x="12" y="5" width="14" height="10" fill="#c8c8d0" stroke="#0b1a5c" strokeWidth="1.5" />
          <rect x="21" y="7" width="3" height="6" fill="#2a4bd7" />
          <rect x="10" y="20" width="20" height="13" fill="#fff" stroke="#0b1a5c" strokeWidth="1.5" />
          <path d="M13 24h14M13 28h10" stroke="#888" strokeWidth="1.2" />
        </svg>
      )
    case "bell":
      return (
        <svg viewBox="0 0 40 40" aria-label="Bell">
          <path d="M20 5c-7 0-10 6-10 13v6l-4 5h28l-4-5v-6c0-7-3-13-10-13z" fill="#f6c21c" stroke="#7a5600" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="20" cy="32" r="4" fill="#f6c21c" stroke="#7a5600" strokeWidth="2" />
          <path d="M14 12c1-3 3-4 5-4" stroke="#fff6b0" strokeWidth="2" fill="none" />
        </svg>
      )
    case "star":
      return (
        <svg viewBox="0 0 40 40" aria-label="Star">
          <path d="M20 4l4.8 10 11 1.4-8 7.6 2 10.9L20 28.6l-9.8 5.3 2-10.9-8-7.6 11-1.4z" fill="#ffe14d" stroke="#8a6a00" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      )
    case "coffee":
      return (
        <svg viewBox="0 0 40 40" aria-label="Coffee">
          <path d="M8 14h20v11a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8z" fill="#fff" stroke="#3b2414" strokeWidth="2" />
          <path d="M28 17h3a4 4 0 0 1 0 8h-3" fill="none" stroke="#3b2414" strokeWidth="2" />
          <path d="M10 16h16v3H10z" fill="#6b3a1a" />
          <path d="M14 5c-2 3 2 4 0 7M20 4c-2 3 2 4 0 7" stroke="#999" strokeWidth="1.5" fill="none" />
        </svg>
      )
    case "cherry":
      return (
        <svg viewBox="0 0 40 40" aria-label="Cherry">
          <path d="M14 26c2-8 6-15 14-20M26 27c-1-8 0-14 2-21" stroke="#2f7a1c" strokeWidth="2.2" fill="none" />
          <path d="M28 6c4 0 7 2 8 5-4 1-7 0-8-5z" fill="#4caf2a" />
          <circle cx="13" cy="29" r="7" fill="#d4142a" stroke="#5a0010" strokeWidth="1.8" />
          <circle cx="26" cy="30" r="7" fill="#d4142a" stroke="#5a0010" strokeWidth="1.8" />
          <circle cx="11" cy="27" r="1.8" fill="#ff9aa6" />
          <circle cx="24" cy="28" r="1.8" fill="#ff9aa6" />
        </svg>
      )
    default:
      return <svg viewBox="0 0 40 40" aria-label="Blank" />
  }
}

const Reel = ({ index, stop, start, spinning, onStopped }) => {
  const strip = S.REELS[index]
  const L = strip.length
  // the strip, repeated: copy 0 for resting, and LOOPS more to travel through
  const items = []
  for (let k = 0; k <= LOOPS + 2; k++) for (let i = 0; i < L; i++) items.push(strip[i])
  // the middle row shows `stop`: row height is --row; offset so `stop - 1` is at the top
  const pos = spinning ? stop + LOOPS * L : start
  const ref = useRef(null)
  useEffect(() => {
    if (!spinning) return
    const t = setTimeout(onStopped, STOP_MS[index])
    return () => clearTimeout(t)
  }, [spinning])
  return (
    <div className="csReel">
      <div
        ref={ref}
        className="csStrip"
        style={{
          transform: `translateY(calc(var(--row) * ${-(pos - 1 + L)}))`,
          transition: spinning ? `transform ${STOP_MS[index]}ms cubic-bezier(0.25, 0.1, 0.25, 1.06)` : "none",
        }}
      >
        {items.map((s, i) => (
          <div key={i} className={`csSym is-${s}`}>
            <SlotSymbol id={s} />
          </div>
        ))}
      </div>
    </div>
  )
}

const Slots = ({ bank, onLobby, mobile }) => {
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
  const [stops, setStops] = useState(() => [3, 7, 11])
  const [from, setFrom] = useState(() => [3, 7, 11]) // where each reel rests before a spin
  const [spinning, setSpinning] = useState([false, false, false])
  const [result, setResult] = useState(null)
  const [error, setError] = useState("")
  const pendingRef = useRef(null)
  const stoppedRef = useRef(0)
  const cost = prefs.lines * prefs.coin
  const busy = spinning.some(Boolean)

  // closing mid-spin: the spin still pays
  useEffect(
    () => () => {
      const p = pendingRef.current
      if (p) bank.give(p.total, p.total - p.cost)
    },
    []
  )

  const spin = () => {
    if (busy) return
    if (!bank.take(cost)) return setError("Not enough chips. Fewer lines or a smaller coin?")
    setError("")
    sfx.chip()
    const next = S.spin()
    const out = S.evaluateSpin(next, prefs.lines, prefs.coin)
    pendingRef.current = out
    setFrom(stops)
    setStops(next)
    setResult(null)
    stoppedRef.current = 0
    // start the reels on the next frame so the jump back to copy 0 doesn't animate
    requestAnimationFrame(() => requestAnimationFrame(() => setSpinning([true, true, true])))
  }
  const stopped = (i) => {
    sfx.reelStop(i)
    setSpinning((s) => s.map((v, k) => (k === i ? false : v)))
    setFrom((f) => f.map((v, k) => (k === i ? stops[i] : v)))
    stoppedRef.current += 1
    if (stoppedRef.current === 3) finish()
  }
  const finish = () => {
    const out = pendingRef.current
    pendingRef.current = null
    if (!out) return
    bank.give(out.total, out.total - out.cost)
    setResult(out)
    if (out.wins.some((w) => w.symbols.every((s) => s === "wild"))) {
      unlock("casino-jackpot")
      sfx.bigWin()
    } else if (out.total >= out.cost * 10) sfx.bigWin()
    else if (out.total > 0) sfx.win()
  }

  // keyboard: space spins
  useEffect(() => {
    if (mobile) return
    const onKey = (e) => {
      if (e.key === " " && !e.target.closest?.("input, select, textarea, button")) {
        e.preventDefault()
        spin()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const winLines = new Set((result?.wins || []).map((w) => w.line))
  const lineLabel = ["Middle", "Top", "Bottom", "Diagonal", "Diagonal"]
  return (
    <div className="csGame csSlots">
      <ChipBar title="Slots" onLobby={onLobby} bank={bank} />
      <div className="csFelt csSlotsFelt" data-touch-surface>
        <div className="csCabinet">
          <div className="csMarquee is-small" aria-hidden="true">
            <span>LUCKY</span>
            <b>98</b>
          </div>
          <div className="csReelBox">
            <div className="csLineMarks is-left" aria-hidden="true">
              {[1, 3, 0, 2, 4].map((l) => (
                <span key={l} className={`${l < prefs.lines ? "is-on" : ""}${winLines.has(l) ? " is-win" : ""}`} data-line={l}>
                  {l + 1}
                </span>
              ))}
            </div>
            <div className="csReels">
              {[0, 1, 2].map((i) => (
                <Reel key={i} index={i} stop={stops[i]} start={from[i]} spinning={spinning[i]} onStopped={() => stopped(i)} />
              ))}
              <svg className="csPaylines" viewBox="0 0 300 300" preserveAspectRatio="none" aria-hidden="true">
                {S.LINES.map((line, l) =>
                  winLines.has(l) ? <polyline key={l} points={line.rows.map((r, k) => `${50 + k * 100},${50 + r * 100}`).join(" ")} fill="none" stroke="#ff2" strokeWidth="6" strokeLinejoin="round" opacity="0.85" /> : null
                )}
              </svg>
            </div>
          </div>
          <div className="csLed" aria-live="polite" data-win={result?.total ?? 0}>
            {error ? <span className="is-error">{error}</span> : busy ? "GOOD LUCK!" : result ? (result.total ? `WIN ${formatChips(result.total)}` : "TRY AGAIN") : `BET ${formatChips(cost)}`}
          </div>
          {result?.wins?.length > 0 && (
            <div className="csWinList">
              {result.wins.map((w) => (
                <span key={w.line}>
                  {lineLabel[w.line]} line: {formatChips(w.pay)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="csControls">
        <div className="csSlotsBets">
          <label className="csField">
            <span>Lines</span>
            <span className="csStepper">
              <button type="button" aria-label="Fewer lines" disabled={busy || prefs.lines <= 1} onClick={() => (sfx.click(), setPrefs({ lines: prefs.lines - 1 }))}>
                −
              </button>
              <b data-lines>{prefs.lines}</b>
              <button type="button" aria-label="More lines" disabled={busy || prefs.lines >= 5} onClick={() => (sfx.click(), setPrefs({ lines: prefs.lines + 1 }))}>
                +
              </button>
            </span>
          </label>
          <label className="csField">
            <span>Coin</span>
            <select value={prefs.coin} disabled={busy} onChange={(e) => setPrefs({ coin: Number(e.target.value) })}>
              {S.COINS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <span className="csField">
            <span>Bet</span>
            <b>{formatChips(cost)}</b>
          </span>
        </div>
        <div className="csActions">
          <button type="button" className="csBig csPrimary csSpin" disabled={busy || cost > bank.balance} onClick={spin} data-act="spin">
            {busy ? "..." : "SPIN"}
          </button>
        </div>
        <MoreOptions id="casino.slots" inline className="csMore" summary="Paytable">
          <table className="csPaytable">
            <tbody>
              {Object.entries(S.PAYS).map(([sym, pay]) => (
                <tr key={sym}>
                  <td className="csPaySyms">
                    {[0, 1, 2].map((k) => (
                      <span key={k} className="csMiniSym">
                        <SlotSymbol id={sym} />
                      </span>
                    ))}
                  </td>
                  <td>{pay} × coin</td>
                </tr>
              ))}
              <tr>
                <td className="csPaySyms">
                  <span className="csMiniSym">
                    <SlotSymbol id="cherry" />
                  </span>
                  <span className="csMiniSym">
                    <SlotSymbol id="cherry" />
                  </span>
                  <span className="csMiniSym csAny">any</span>
                </td>
                <td>{S.CHERRY_TWO} × coin</td>
              </tr>
              <tr>
                <td className="csPaySyms">
                  <span className="csMiniSym">
                    <SlotSymbol id="cherry" />
                  </span>
                  <span className="csMiniSym csAny">any</span>
                  <span className="csMiniSym csAny">any</span>
                </td>
                <td>{S.CHERRY_ONE} × coin</td>
              </tr>
            </tbody>
          </table>
          <p className="csMuted">The 98 Wild stands in for any symbol. Lines: 1 middle, 2 top, 3 bottom, 4 and 5 the diagonals. Pays back about {Math.round(S.rtp().rtp * 1000) / 10}% over time.</p>
        </MoreOptions>
      </div>
    </div>
  )
}

export default Slots
