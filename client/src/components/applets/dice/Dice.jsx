import React, { useEffect, useRef, useState } from "react"
import MoreOptions from "../../shared/MoreOptions"
import "./Dice.css"

// Dice & Coin: Roll (two six-sided dice to start) or Flip a coin, with a short tumble and the
// total. More options: how many dice (1-6), how many sides (4 to 100), and the last rolls.
// Fair: crypto.getRandomValues with rejection sampling (no modulo bias).

const KEY = "98ish.dice"
const SIDES = [4, 6, 8, 10, 12, 20, 100]

export const fairInt = (n, rand = (buf) => crypto.getRandomValues(buf)) => {
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / n) * n
  for (;;) {
    rand(buf)
    if (buf[0] < limit) return (buf[0] % n) + 1
  }
}

const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}

const PIPS = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[28, 25], [72, 25], [28, 50], [72, 50], [28, 75], [72, 75]] }

const Die = ({ value, sides, rolling }) =>
  sides === 6 ? (
    <svg viewBox="0 0 100 100" className={`dcDie${rolling ? " is-rolling" : ""}`} role="img" aria-label={`${value}`}>
      <rect x="4" y="4" width="92" height="92" rx="14" fill="#fff" stroke="#000" strokeWidth="3" />
      <rect x="8" y="8" width="84" height="84" rx="10" fill="none" stroke="#c0c0c0" strokeWidth="2" />
      {PIPS[value].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="9" fill={value === 1 ? "#c00000" : "#000"} />
      ))}
    </svg>
  ) : (
    <svg viewBox="0 0 100 100" className={`dcDie${rolling ? " is-rolling" : ""}`} role="img" aria-label={`${value}`}>
      <polygon points={sides === 4 ? "50,6 95,90 5,90" : sides === 20 || sides === 100 ? "50,4 92,27 92,73 50,96 8,73 8,27" : sides === 8 ? "50,4 96,50 50,96 4,50" : "50,4 94,36 77,92 23,92 6,36"} fill="#fff" stroke="#000" strokeWidth="3" strokeLinejoin="round" />
      <text x="50" y={sides === 4 ? 70 : 60} textAnchor="middle" fontSize={value >= 100 ? 26 : 32} fontWeight="bold" fontFamily="Arial, sans-serif" fill="#000080">
        {value}
      </text>
      <text x="50" y="86" textAnchor="middle" fontSize="10" fill="#808080">
        d{sides}
      </text>
    </svg>
  )

const Coin = ({ side, flipping }) => (
  <svg viewBox="0 0 100 100" className={`dcCoin${flipping ? " is-flipping" : ""}`} role="img" aria-label={side}>
    <circle cx="50" cy="50" r="44" fill={side === "Heads" ? "#e8c84a" : "#c9a83a"} stroke="#806010" strokeWidth="4" />
    <circle cx="50" cy="50" r="35" fill="none" stroke="#806010" strokeWidth="1.5" strokeDasharray="3 3" />
    {side === "Heads" ? (
      // a little 98ish window
      <g>
        <rect x="32" y="34" width="36" height="30" fill="#fff8d0" stroke="#806010" strokeWidth="2" />
        <rect x="32" y="34" width="36" height="7" fill="#806010" />
      </g>
    ) : (
      <text x="50" y="62" textAnchor="middle" fontSize="30" fontWeight="bold" fontFamily="Georgia, serif" fill="#806010">
        98
      </text>
    )}
  </svg>
)

const Dice = () => {
  const saved = load()
  const [mode, setMode] = useState(saved.mode === "coin" ? "coin" : "dice")
  const [count, setCount] = useState(Math.min(6, Math.max(1, saved.count || 2)))
  const [sides, setSides] = useState(SIDES.includes(saved.sides) ? saved.sides : 6)
  const [faces, setFaces] = useState(() => Array.from({ length: Math.min(6, Math.max(1, saved.count || 2)) }, () => 1))
  const [coin, setCoin] = useState("Heads")
  const [busy, setBusy] = useState(false)
  const [settled, setSettled] = useState(false)
  const [history, setHistory] = useState([])
  const timer = useRef(0)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ mode, count, sides }))
    } catch {
      // private mode
    }
  }, [mode, count, sides])
  useEffect(() => () => clearInterval(timer.current), [])
  useEffect(() => setFaces((f) => Array.from({ length: count }, (_, i) => Math.min(f[i] || 1, sides))), [count, sides])

  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  const go = () => {
    if (busy) return
    setBusy(true)
    setSettled(false)
    const finish = () => {
      clearInterval(timer.current)
      if (mode === "coin") {
        const side = fairInt(2) === 1 ? "Heads" : "Tails"
        setCoin(side)
        setHistory((h) => [side, ...h].slice(0, 12))
      } else {
        const rolled = Array.from({ length: count }, () => fairInt(sides))
        setFaces(rolled)
        setHistory((h) => [`${rolled.join(" + ")}${rolled.length > 1 ? ` = ${rolled.reduce((a, b) => a + b, 0)}` : ""}`, ...h].slice(0, 12))
      }
      setBusy(false)
      setSettled(true)
      navigator.vibrate?.(20)
    }
    if (reduced) return finish()
    // a short tumble
    let n = 0
    timer.current = setInterval(() => {
      n++
      if (mode === "coin") setCoin((c) => (c === "Heads" ? "Tails" : "Heads"))
      else setFaces(Array.from({ length: count }, () => fairInt(sides)))
      if (n >= 8) finish()
    }, 70)
  }

  const total = faces.reduce((a, b) => a + b, 0)
  return (
    <div className="dcRoot" data-dice="">
      <div className="dcModes" role="radiogroup" aria-label="Dice or coin">
        <button type="button" role="radio" aria-checked={mode === "dice"} className={mode === "dice" ? "is-on" : ""} onClick={() => (setMode("dice"), setSettled(false))}>
          Dice
        </button>
        <button type="button" role="radio" aria-checked={mode === "coin"} className={mode === "coin" ? "is-on" : ""} onClick={() => (setMode("coin"), setSettled(false))}>
          Coin
        </button>
      </div>

      <div className="dcTable" onClick={go} data-touch-surface="">
        {mode === "coin" ? (
          <Coin side={coin} flipping={busy} />
        ) : (
          <div className={`dcDice dcDice--${count}`}>
            {faces.map((v, i) => (
              <Die key={i} value={v} sides={sides} rolling={busy} />
            ))}
          </div>
        )}
      </div>

      <div className="dcResult" aria-live="polite" data-dice-result="">
        {mode === "coin" ? (settled ? coin : " ") : settled && count > 1 ? `Total: ${total}` : settled ? `${faces[0]}` : " "}
      </div>

      <button type="button" className="dcGo" onClick={go} disabled={busy} data-dice-go="">
        {mode === "coin" ? "Flip" : count === 1 ? "Roll" : "Roll Dice"}
      </button>

      <MoreOptions id="dice.more" summary={mode === "coin" ? "Last flips" : `${count} dice, ${sides} sides · last rolls`}>
        <div className="dcMore">
          {mode === "dice" && (
            <div className="dcRow">
              <label>
                Dice:{" "}
                <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sides:{" "}
                <select value={sides} onChange={(e) => setSides(Number(e.target.value))}>
                  {SIDES.map((n) => (
                    <option key={n} value={n}>
                      d{n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <fieldset>
            <legend>{mode === "coin" ? "Last flips" : "Last rolls"}</legend>
            {history.length ? (
              <ol className="dcHistory">
                {history.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ol>
            ) : (
              <div className="dcEmpty">Nothing yet.</div>
            )}
          </fieldset>
        </div>
      </MoreOptions>
    </div>
  )
}

export default Dice
