import React from "react"

// The on-screen keyboard, colored by what each letter has shown. With several boards each
// key is split into one patch per board (still being played), like the board layout.
// states: one { letter: "g" | "y" | "b" } per board. The keys never take the focus, so the
// physical keyboard keeps working (and Enter never "clicks" the last key pressed).

const ROWS = ["qwertyuiop", "asdfghjkl", "+zxcvbnm-"]

const COLOR_VAR = { g: "var(--wd-g)", y: "var(--wd-y)", b: "var(--wd-b)", "": "var(--wd-key)" }

const patches = (letter, states) => {
  const n = states.length
  if (n <= 1) return null
  const cols = n === 2 ? 2 : n === 4 ? 2 : 4
  const rows = Math.ceil(n / cols)
  const images = []
  const positions = []
  states.forEach((s, i) => {
    const c = COLOR_VAR[s?.[letter] || ""]
    images.push(`linear-gradient(${c}, ${c})`)
    const col = i % cols
    const row = Math.floor(i / cols)
    positions.push(`${cols === 1 ? 0 : (col / (cols - 1)) * 100}% ${rows === 1 ? 0 : (row / (rows - 1)) * 100}%`)
  })
  return { backgroundImage: images.join(","), backgroundPosition: positions.join(","), backgroundSize: `${100 / cols}% ${100 / rows}%`, backgroundRepeat: "no-repeat" }
}

const best = (letter, states) => {
  const order = { g: 3, y: 2, b: 1 }
  let top = ""
  for (const s of states) if ((order[s?.[letter]] || 0) > (order[top] || 0)) top = s[letter]
  return top
}

const Keyboard = ({ states = [{}], onKey, disabled = false, enterLabel = "ENTER" }) => {
  const multi = states.length > 1
  const press = (key) => (e) => {
    e.preventDefault()
    if (!disabled) onKey(key)
  }
  return (
    <div className={`wdKeyboard${disabled ? " is-disabled" : ""}`} role="group" aria-label="Keyboard">
      {ROWS.map((row, r) => (
        <div key={r} className="wdKeyRow">
          {r === 1 && <span className="wdKeyHalf" aria-hidden="true" />}
          {[...row].map((k) => {
            if (k === "+")
              return (
                <button key="enter" type="button" tabIndex={-1} className="wdKey wdKey--wide" data-key="Enter" onMouseDown={(e) => e.preventDefault()} onClick={press("Enter")}>
                  {enterLabel}
                </button>
              )
            if (k === "-")
              return (
                <button key="back" type="button" tabIndex={-1} className="wdKey wdKey--wide" data-key="Backspace" aria-label="Backspace" onMouseDown={(e) => e.preventDefault()} onClick={press("Backspace")}>
                  <svg viewBox="0 0 24 16" width="22" height="15" aria-hidden="true">
                    <path d="M8 1h14v14H8L1 8z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M11 5l6 6M17 5l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              )
            const state = best(k, states)
            return (
              <button
                key={k}
                type="button"
                tabIndex={-1}
                className={`wdKey${!multi && state ? ` is-${state}` : ""}${multi && state ? " is-split" : ""}`}
                data-key={k}
                data-state={state || ""}
                style={multi ? patches(k, states) : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={press(k)}
              >
                {k.toUpperCase()}
              </button>
            )
          })}
          {r === 1 && <span className="wdKeyHalf" aria-hidden="true" />}
        </div>
      ))}
    </div>
  )
}

export default Keyboard
