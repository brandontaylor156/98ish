import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import { copyText, displayText, initialState, isEnabled, keyFor, parenDepth, pasteText, press } from "./engine"
import "./Calculator.css"
import { helpItem } from "../../../utils/help"

// Calculator, as in Windows 98: Standard and Scientific views (View menu), memory, Hex/Dec/
// Oct/Bin, Inv and Hyp, the Statistics Box, keyboard input and Edit > Copy/Paste. The math
// lives in engine.js; this file is the buttons.

const PREFS_KEY = "98ish.calc"

const loadPrefs = () => {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY))
    return { mode: p?.mode === "scientific" ? "scientific" : "standard", grouping: !!p?.grouping }
  } catch {
    return { mode: "standard", grouping: false }
  }
}

const savePrefs = (state) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: state.mode, grouping: state.grouping }))
  } catch {
    // not remembered, that's all
  }
}

// [label, key, color, arg, shown]. Color-coded families, each with its own key face (Calculator.css):
// digits (light), operators (lavender, navy signs), memory (green), clears (rose), functions
// (purple/navy text), and = (navy, the one to find at a glance). `shown` is the drawn glyph
// when it differs from the label (the label stays the accessible name).
// Standard: a pocket-calculator pad, 4 balanced columns: memory and functions in two
// short rows on top, then clears and the operator column down the right.
const STANDARD_ROWS = [
  [["MC", "mc", "mem"], ["MR", "mr", "mem"], ["MS", "ms", "mem"], ["M+", "mplus", "mem"]],
  [["sqrt", "sqrt", "fn", null, "√x"], ["%", "pct", "fn"], ["1/x", "recip", "fn", null, "¹⁄x"], ["+/-", "neg", "fn", null, "±"]],
  [["C", "c", "clear"], ["CE", "ce", "clear"], ["Backspace", "back", "clear", null, "⌫"], ["/", "div", "op", null, "÷"]],
  [["7", "7", "digit"], ["8", "8", "digit"], ["9", "9", "digit"], ["*", "mul", "op", null, "×"]],
  [["4", "4", "digit"], ["5", "5", "digit"], ["6", "6", "digit"], ["-", "sub", "op", null, "−"]],
  [["1", "1", "digit"], ["2", "2", "digit"], ["3", "3", "digit"], ["+", "add", "op", null, "+"]],
  [["0", "0", "digit"], [".", ".", "digit"], ["=", "eq", "eq"]],
]
const OP_SIGNS = { add: "+", sub: "−", mul: "×", div: "÷", pow: "^", root: "yroot", mod: "Mod", and: "And", or: "Or", xor: "Xor", lsh: "Lsh", rsh: "Rsh" }
const SIGN_FOR = { "/": "÷", "*": "×", "-": "−" }

const STAT_KEYS = [["Sta", "sta"], ["Ave", "ave"], ["Sum", "sum"], ["s", "s"], ["Dat", "dat"]]

const FUNCTION_KEYS = [
  [["F-E", "fe"], ["(", "lparen"], [")", "rparen"]],
  [["dms", "dms"], ["Exp", "exp"], ["ln", "ln"]],
  [["sin", "sin"], ["x^y", "pow"], ["log", "log"]],
  [["cos", "cos"], ["x^3", "cube"], ["n!", "fact"]],
  [["tan", "tan"], ["x^2", "sqr"], ["1/x", "recip"]],
]

const MEMORY_KEYS = [["MC", "mc"], ["MR", "mr"], ["MS", "ms"], ["M+", "mplus"], ["pi", "pi"]]

const NUMBER_KEYS = [
  [["7", "7", "blue"], ["8", "8", "blue"], ["9", "9", "blue"], ["/", "div", "red"], ["Mod", "mod", "red"], ["And", "and", "red"]],
  [["4", "4", "blue"], ["5", "5", "blue"], ["6", "6", "blue"], ["*", "mul", "red"], ["Or", "or", "red"], ["Xor", "xor", "red"]],
  [["1", "1", "blue"], ["2", "2", "blue"], ["3", "3", "blue"], ["-", "sub", "red"], ["Lsh", "lsh", "red"], ["Not", "not", "red"]],
  [["0", "0", "blue"], ["+/-", "neg", "blue"], [".", ".", "blue"], ["+", "add", "red"], ["=", "eq", "eq"], ["Int", "int", "red"]],
  [["A", "A", "blue"], ["B", "B", "blue"], ["C", "C", "blue"], ["D", "D", "blue"], ["E", "E", "blue"], ["F", "F", "blue"]],
]

const BASES = [
  [16, "Hex"],
  [10, "Dec"],
  [8, "Oct"],
  [2, "Bin"],
]
const ANGLES = [
  ["deg", "Deg"],
  ["rad", "Rad"],
  ["grad", "Grad"],
]
const WORDS = [
  ["dword", "Dword"],
  ["word", "Word"],
  ["byte", "Byte"],
]

const HELP = [
  ["Esc", "C (clear)"],
  ["Del", "CE (clear entry)"],
  ["Backspace", "Backspace"],
  ["Enter or =", "="],
  ["F9", "+/-"],
  ["@", "sqrt (x^2 in Scientific)"],
  ["r", "1/x"],
  ["Ctrl+M / R / L / P", "MS / MR / MC / M+"],
  ["Ctrl+C / Ctrl+V", "Copy / Paste"],
  ["s o t", "sin cos tan"],
  ["y  #  !  n  l  p", "x^y  x^3  n!  ln  log  pi"],
  ["i  h", "Inv  Hyp"],
  ["& | ^ ~ < % ;", "And Or Xor Not Lsh Mod Int"],
  ["F5 F6 F7 F8", "Hex Dec Oct Bin"],
  ["F2 F3 F4", "Deg Rad Grad (Dword Word Byte)"],
  ["Ctrl+S, Insert", "Sta, Dat"],
]

// a phone held sideways: the Scientific keys, whatever View says (like a phone's calculator)
const LANDSCAPE = "(orientation: landscape) and (max-height: 520px)"
const useLandscape = (on) => {
  const [landscape, setLandscape] = useState(() => on && typeof window !== "undefined" && !!window.matchMedia?.(LANDSCAPE).matches)
  useEffect(() => {
    if (!on || !window.matchMedia) return setLandscape(false)
    const mq = window.matchMedia(LANDSCAPE)
    const change = () => setLandscape(mq.matches)
    change()
    mq.addEventListener?.("change", change)
    return () => mq.removeEventListener?.("change", change)
  }, [on])
  return landscape
}

// what's waiting for the next number, as a little line above the readout ("12 + 3 ×")
const pendingText = (calc) => {
  if (calc.error) return ""
  const show = (v) => displayText({ ...calc, error: null, entry: null, value: v })
  return calc.frames
    .map((f, i) => `${i ? "( " : ""}${f.values.map((v, j) => `${show(v)}${f.ops[j] ? ` ${OP_SIGNS[f.ops[j]] || f.ops[j]}` : ""}`).join(" ")}`)
    .join(" ")
    .trim()
}

const Calculator = ({ fitWindow, mobile = false }) => {
  const [calc, setCalc] = useState(() => initialState(loadPrefs()))
  const landscape = useLandscape(mobile)
  const [statsOpen, setStatsOpen] = useState(false)
  const [statPick, setStatPick] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [flash, setFlash] = useState(null) // the key being typed, to light its button
  const rootRef = useRef(null)
  const bodyRef = useRef(null)
  const calcRef = useRef(calc)
  calcRef.current = calc
  const id = useId()
  const sci = calc.mode === "scientific" || landscape

  const update = (fn) =>
    setCalc((current) => {
      const next = fn(current)
      if (next.mode !== current.mode || next.grouping !== current.grouping) savePrefs(next)
      return next
    })

  const send = (key, arg) => {
    if (key === "sta") return openStats()
    if (["ave", "sum", "s", "dat"].includes(key) && !statsOpen) return
    update((s) => press(s, key, arg))
  }

  const openStats = () => {
    setStatsOpen(true)
    setStatPick(null)
  }

  // the keyboard goes to the calculator: on opening, and after a dialog closes
  useEffect(() => {
    if (!dialog) rootRef.current?.focus({ preventScroll: true })
  }, [dialog])

  // On a desktop the window takes the size of the buttons (it grows for Scientific and the
  // Statistics Box); phones and maximized windows stretch the buttons instead
  useLayoutEffect(() => {
    if (!fitWindow) return
    const root = rootRef.current
    const windowEl = root.closest(".window")
    if (!windowEl) return
    const frameW = windowEl.offsetWidth - root.clientWidth
    const frameH = windowEl.offsetHeight - root.clientHeight
    const menuH = root.querySelector(".menuBar").offsetHeight
    fitWindow(bodyRef.current.offsetWidth + frameW, bodyRef.current.offsetHeight + menuH + frameH)
  }, [calc.mode, statsOpen, !!fitWindow])

  // ---- clipboard ----

  const copy = async () => {
    const text = copyText(calcRef.current)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // older browsers: a copy command, answered by onCopy below
      document.execCommand?.("copy")
    }
  }

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      update((s) => pasteText(s, text))
    } catch {
      setDialog({ title: "Calculator", text: "This browser doesn't let menus read the clipboard. Press Ctrl+V instead." })
    }
  }

  // ---- keyboard ----

  const onKeyDown = (e) => {
    if (dialog || e.target.closest?.(".dialog")) return
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && ["c", "v", "x"].includes(e.key.toLowerCase())) return // onCopy / onPaste
    if (ctrl && e.key.toLowerCase() === "s" && sci) {
      e.preventDefault()
      return openStats()
    }
    const mapped = keyFor(calcRef.current, e)
    if (!mapped) return
    e.preventDefault()
    const [key, arg] = mapped
    if (["ave", "sum", "s", "dat"].includes(key) && !statsOpen) return
    if (!["base", "angle", "word"].includes(key) && !isEnabled(calcRef.current, key)) return
    setFlash(key)
    send(key, arg)
  }

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 110)
    return () => clearTimeout(t)
  }, [flash])

  const onCopy = (e) => {
    if (e.target.closest?.(".dialog")) return
    e.preventDefault()
    e.clipboardData.setData("text/plain", copyText(calcRef.current))
  }

  const onPaste = (e) => {
    if (e.target.closest?.(".dialog")) return
    e.preventDefault()
    const text = e.clipboardData.getData("text/plain")
    update((s) => pasteText(s, text))
  }

  // ---- pieces ----

  const key = ([label, k, color = "purple", , shown], extra = "") => {
    const statKey = ["ave", "sum", "s", "dat"].includes(k)
    const disabled = (statKey && !statsOpen) || !isEnabled(calc, k)
    const active = (k === "inv" && calc.inv) || (k === "hyp" && calc.hyp)
    return (
      <button
        key={k}
        type="button"
        className={`calcKey calcKey--${color}${flash === k ? " is-pressed" : ""}${active ? " is-on" : ""} ${extra}`}
        data-key={k}
        disabled={disabled}
        aria-label={label}
        onMouseDown={(e) => e.preventDefault()} // keep the focus (and keyboard) on the calculator
        onClick={() => send(k)}
      >
        <span aria-hidden="true">{shown || SIGN_FOR[label] || label}</span>
      </button>
    )
  }

  const radios = (name, options, value, onPick) => (
    <fieldset className="calcRadios" role="radiogroup">
      {options.map(([v, label]) => (
        <span key={v} className="calcRadio">
          <input id={`${id}-${name}-${v}`} type="radio" name={`${id}-${name}`} checked={value === v} onChange={() => onPick(v)} />
          <label htmlFor={`${id}-${name}-${v}`}>{label}</label>
        </span>
      ))}
    </fieldset>
  )

  const clearKeys = (
    <div className="calcClears">
      {key(["Backspace", "back", "clear"], "calcKey--wide")}
      {key(["CE", "ce", "clear"], "calcKey--wide")}
      {key(["C", "c", "clear"], "calcKey--wide")}
    </div>
  )

  const depth = parenDepth(calc)
  const pending = pendingText(calc)

  // the LCD: a little status line (memory, Inv/Hyp, parentheses, base and angle) and what's
  // waiting, over the big readout
  const display = (
    <div className="calcLcd">
      <div className="calcLcdTop" aria-hidden="true">
        <span className={`calcFlag${calc.memory !== 0 ? " is-lit" : ""}`}>M</span>
        {sci && (
          <>
            <span className={`calcFlag${calc.inv ? " is-lit" : ""}`}>INV</span>
            <span className={`calcFlag${calc.hyp ? " is-lit" : ""}`}>HYP</span>
            <span className={`calcFlag${statsOpen ? " is-lit" : ""}`}>STA</span>
            <span className={`calcFlag${depth ? " is-lit" : ""}`}>{depth ? `(${depth}` : "( )"}</span>
            <span className="calcFlag is-lit">{calc.base === 10 ? calc.angle.toUpperCase() : { 16: "HEX", 8: "OCT", 2: "BIN" }[calc.base]}</span>
          </>
        )}
        <span className="calcPending">{pending}</span>
      </div>
      <div className="calcDisplay" role="status" aria-label="Display" data-error={calc.error ? "" : undefined}>
        {displayText(calc)}
      </div>
    </div>
  )

  const viewMenu = [
    { label: "Standard", checked: !sci, onClick: () => send("mode", "standard") },
    { label: "Scientific", checked: sci, onClick: () => send("mode", "scientific") },
    "-",
    ...(sci
      ? [
          ...BASES.map(([b, label]) => ({ label: { 16: "Hex F5", 10: "Decimal F6", 8: "Octal F7", 2: "Binary F8" }[b], checked: calc.base === b, onClick: () => send("base", b) })),
          "-",
          ...(calc.base === 10
            ? ANGLES.map(([a, label], i) => ({ label: `${["Degrees", "Radians", "Grads"][i]} F${i + 2}`, checked: calc.angle === a, onClick: () => send("angle", a) }))
            : WORDS.map(([w, label], i) => ({ label: `${label} F${i + 2}`, checked: calc.word === w, onClick: () => send("word", w) }))),
          "-",
        ]
      : []),
    { label: "Digit grouping", checked: calc.grouping, onClick: () => send("grouping") },
  ]

  const menus = [
    {
      label: "Edit",
      items: [
        { label: "Copy Ctrl+C", onClick: copy },
        { label: "Paste Ctrl+V", onClick: paste },
      ],
    },
    { label: "View", items: viewMenu },
    {
      label: "Help",
      items: [helpItem({ program: "Calculator" }), "-",
        { label: "Calculator Keys...", onClick: () => setDialog({ kind: "help" }) },
        "-",
        { label: "About Calculator", onClick: () => setDialog({ title: "About Calculator", text: "Calculator for 98ish. Scientific view follows operator precedence: 2 + 3 * 4 = 14." }) },
      ],
    },
  ]

  // menu items hand the keyboard back to the calculator once they've run
  const refocused = menus.map((menu) => ({
    ...menu,
    items: menu.items.map((item) =>
      item === "-"
        ? item
        : {
            ...item,
            onClick: () => {
              item.onClick()
              requestAnimationFrame(() => {
                if (!rootRef.current?.querySelector(".dialog")) rootRef.current?.focus({ preventScroll: true })
              })
            },
          }
    ),
  }))

  return (
    <div
      ref={rootRef}
      className={`calcRoot${fitWindow ? " is-fitted" : ""}${sci ? " is-scientific" : ""}${landscape ? " is-landscape" : ""}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onPaste={onPaste}
      onPointerDown={(e) => {
        // a click on the display or between the keys still gets the keyboard
        if (!e.target.closest("input, select, textarea, .menuBar, .dialog, .calcStatsList")) rootRef.current?.focus({ preventScroll: true })
      }}
    >
      <MenuBar menus={refocused} />
      <div className="calcBody" ref={bodyRef}>
        {display}

        {!sci && (
          <div className="calcPad">
            {STANDARD_ROWS.map((row, i) => (
              <div key={i} className={`calcPadRow${i < 2 ? " calcPadRow--small" : ""}`}>
                {row.map((k) => key(k, k[1] === "0" ? "calcKey--zero" : ""))}
              </div>
            ))}
          </div>
        )}

        {sci && (
          <>
            <div className="calcModes">
              {radios("base", BASES, calc.base, (b) => send("base", b))}
              {calc.base === 10 ? radios("angle", ANGLES, calc.angle, (a) => send("angle", a)) : radios("word", WORDS, calc.word, (w) => send("word", w))}
            </div>
            <div className="calcTopRow">
              <fieldset className="calcRadios calcChecks">
                <span className="calcRadio">
                  <input id={`${id}-inv`} type="checkbox" checked={calc.inv} onChange={() => send("inv")} />
                  <label htmlFor={`${id}-inv`}>Inv</label>
                </span>
                <span className="calcRadio">
                  <input id={`${id}-hyp`} type="checkbox" checked={calc.hyp} onChange={() => send("hyp")} />
                  <label htmlFor={`${id}-hyp`}>Hyp</label>
                </span>
              </fieldset>
              {clearKeys}
            </div>
            <div className="calcSciKeys">
              <div className="calcSciBlock">
                <div className="calcCol calcStatCol">{STAT_KEYS.map(([l, k]) => key([l, k, "fn"]))}</div>
                <div className="calcFnGrid">{FUNCTION_KEYS.flat().map((k) => key(k))}</div>
              </div>
              <div className="calcSciBlock">
                <div className="calcCol calcMemCol">
                  {MEMORY_KEYS.map(([l, k]) => key([l, k, k === "pi" ? "fn" : "mem"]))}
                </div>
                <div className="calcNumGrid">{NUMBER_KEYS.flat().map((k) => key(k))}</div>
              </div>
            </div>
          </>
        )}

        {sci && statsOpen && (
          <div className="window calcStats">
            <div className="title-bar">
              <div className="title-bar-text">Statistics Box</div>
              <div className="title-bar-controls">
                <button type="button" aria-label="Close" onClick={() => setStatsOpen(false)} />
              </div>
            </div>
            <div className="calcStatsBody">
              <ul className="calcStatsList" role="listbox" aria-label="Statistics">
                {calc.stats.map((v, i) => (
                  <li key={i} role="option" aria-selected={statPick === i}>
                    <button type="button" className={statPick === i ? "is-selected" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => setStatPick(i)} onDoubleClick={() => send("statLoad", i)}>
                      {displayText({ ...calc, error: null, entry: null, value: v })}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="calcStatsButtons">
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => rootRef.current?.focus()}>
                  RET
                </button>
                <button type="button" disabled={statPick === null || statPick >= calc.stats.length} onMouseDown={(e) => e.preventDefault()} onClick={() => send("statLoad", statPick)}>
                  LOAD
                </button>
                <button
                  type="button"
                  disabled={statPick === null || statPick >= calc.stats.length}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    send("statRemove", statPick)
                    setStatPick(null)
                  }}
                >
                  CD
                </button>
                <button
                  type="button"
                  disabled={!calc.stats.length}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    send("statClear")
                    setStatPick(null)
                  }}
                >
                  CAD
                </button>
                <span className="calcStatsCount">n={calc.stats.length}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {dialog?.kind === "help" && (
        <Dialog title="Calculator Help" onOk={() => setDialog(null)}>
          <p className="dialogText">Click the buttons or use the keyboard:</p>
          <div className="calcHelpScroll">
            <table className="calcHelp">
              <tbody>
                {HELP.map(([k, what]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Dialog>
      )}
      {dialog && dialog.kind !== "help" && (
        <Dialog title={dialog.title} onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
    </div>
  )
}

export default Calculator
