import React, { useEffect, useMemo, useRef, useState } from "react"
import Dialog from "../../shared/Dialog"
import { recordText } from "../../../utils/clipHistory"
import "./CharMap.css"

// Character Map, as in Windows 98: pick a font, press a character to see it enlarged (drag
// to browse), double-click or Select to add it to "Characters to copy", then Copy. The
// status bar shows how to type it (Alt+0169). Beyond the classic Windows character set
// there are a few Unicode subsets, since browsers can show them all.

const PREFS_KEY = "98ish.charmap"

// Windows-1252: 128-159 hold the euro sign, curly quotes, dashes...; five codes are unused
const CP1252 = {
  128: 0x20ac, 130: 0x201a, 131: 0x0192, 132: 0x201e, 133: 0x2026, 134: 0x2020, 135: 0x2021, 136: 0x02c6, 137: 0x2030, 138: 0x0160, 139: 0x2039, 140: 0x0152, 142: 0x017d,
  145: 0x2018, 146: 0x2019, 147: 0x201c, 148: 0x201d, 149: 0x2022, 150: 0x2013, 151: 0x2014, 152: 0x02dc, 153: 0x2122, 154: 0x0161, 155: 0x203a, 156: 0x0153, 158: 0x017e, 159: 0x0178,
}
const UNUSED_1252 = [129, 141, 143, 144, 157]

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const unassigned = /\p{Cn}|\p{Cc}/u

export const SUBSETS = [
  { id: "windows", label: "Windows Characters", windows: true },
  { id: "latinA", label: "Latin Extended-A", from: 0x100, to: 0x17f },
  { id: "greek", label: "Greek", from: 0x370, to: 0x3ff },
  { id: "cyrillic", label: "Cyrillic", from: 0x400, to: 0x45f },
  { id: "punct", label: "General Punctuation", from: 0x2010, to: 0x205e },
  { id: "currency", label: "Currency Symbols", from: 0x20a0, to: 0x20c0 },
  { id: "letterlike", label: "Letterlike Symbols", from: 0x2100, to: 0x214f },
  { id: "arrows", label: "Arrows", from: 0x2190, to: 0x21ff },
  { id: "math", label: "Mathematical Operators", from: 0x2200, to: 0x22ff },
  { id: "box", label: "Box Drawing", from: 0x2500, to: 0x259f },
  { id: "shapes", label: "Geometric Shapes", from: 0x25a0, to: 0x25ff },
  { id: "symbols", label: "Miscellaneous Symbols", from: 0x2600, to: 0x26ff },
  { id: "dingbats", label: "Dingbats", from: 0x2700, to: 0x27bf },
]

// one cell: { cp: code point, code: Windows code (Alt+0nnn) or null }
export const cellsFor = (subset) => {
  if (subset.windows)
    return range(32, 255).map((code) => ({ code, cp: UNUSED_1252.includes(code) ? null : CP1252[code] ?? code }))
  return range(subset.from, subset.to)
    .filter((cp) => !unassigned.test(String.fromCodePoint(cp)))
    .map((cp) => ({ cp, code: null }))
}

const hex = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`

// "Keystroke: Alt+0169", "Keystroke: Spacebar", "Keystroke: A"
export const keystrokeFor = (cell) => {
  if (!cell || cell.cp === null) return ""
  if (cell.code === null) return "Keystroke: (none)"
  if (cell.code === 32) return "Keystroke: Spacebar"
  if (cell.code < 127) return `Keystroke: ${String.fromCharCode(cell.code)}`
  return `Keystroke: Alt+0${cell.code}`
}

// fonts worth offering; only the ones this computer has are listed
const FONT_CANDIDATES = [
  "Arial",
  "Arial Black",
  "Comic Sans MS",
  "Courier New",
  "Georgia",
  "Impact",
  "Lucida Console",
  "Lucida Sans Unicode",
  "Palatino Linotype",
  "Segoe UI Symbol",
  "Symbol",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Webdings",
  "Wingdings",
  "Menlo",
  "Roboto",
]
const GENERIC = [
  ["Pixelated MS Sans Serif", "MS Sans Serif (pixel)"],
  ["serif", "Serif"],
  ["sans-serif", "Sans Serif"],
  ["monospace", "Monospace"],
]

// a font is installed if text set in it measures differently from the fallbacks
const installedFonts = () => {
  try {
    const ctx = document.createElement("canvas").getContext("2d")
    const sample = "mmmmmmmmmmlliWW@#ÄÖ€ 0123456789"
    const width = (font) => {
      ctx.font = `48px ${font}`
      return ctx.measureText(sample).width
    }
    const bases = ["monospace", "serif", "sans-serif"].map((b) => [b, width(b)])
    return FONT_CANDIDATES.filter((f) => bases.some(([b, w]) => width(`"${f}", ${b}`) !== w))
  } catch {
    return ["Arial", "Times New Roman", "Courier New"]
  }
}

const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}
  } catch {
    return {}
  }
}

const fontStack = (font) => (GENERIC.some(([f]) => f === font) && font !== "Pixelated MS Sans Serif" ? font : `"${font}", sans-serif`)

const CharMap = ({ onClose }) => {
  const fonts = useMemo(() => {
    const found = installedFonts()
    return [...found.map((f) => [f, f]), ...GENERIC]
  }, [])
  const prefs = useMemo(loadPrefs, [])
  const [font, setFont] = useState(() => (fonts.some(([f]) => f === prefs.font) ? prefs.font : fonts.find(([f]) => f === "Arial")?.[0] || fonts[0][0]))
  const [subsetId, setSubsetId] = useState(() => (SUBSETS.some((s) => s.id === prefs.subset) ? prefs.subset : "windows"))
  const [selected, setSelected] = useState(0)
  const [magnify, setMagnify] = useState(false)
  const [text, setText] = useState("")
  const [dialog, setDialog] = useState(null)
  const gridRef = useRef(null)
  const inputRef = useRef(null)
  const pressing = useRef(false)

  const subset = SUBSETS.find((s) => s.id === subsetId)
  const cells = useMemo(() => cellsFor(subset), [subsetId])
  const cell = cells[selected]

  // Symbol fonts (Wingdings...) keep their pictures at the font's own codes, which browsers
  // reach through U+F0xx; the 128-159 row needs that, since those codes became € “ ” ...
  const symbolFont = ["Symbol", "Wingdings", "Webdings"].includes(font)
  const glyph = (c) => String.fromCodePoint(symbolFont && c.code >= 128 && c.code < 160 ? 0xf000 + c.code : c.cp)

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ font, subset: subsetId }))
    } catch {
      // not remembered
    }
  }, [font, subsetId])

  useEffect(() => {
    gridRef.current?.focus({ preventScroll: true })
  }, [])

  // keep the selected cell in view (arrow keys on a scrolling phone grid)
  useEffect(() => {
    const el = gridRef.current?.querySelector(`[data-index="${selected}"]`)
    el?.scrollIntoView?.({ block: "nearest" })
  }, [selected, subsetId])

  // the magnifier follows the pointer while it's held down, anywhere on the page
  useEffect(() => {
    const up = () => {
      if (!pressing.current) return
      pressing.current = false
      setMagnify(false)
    }
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
    return () => {
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
  }, [])

  const indexAt = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-index]")
    return el && gridRef.current.contains(el) ? Number(el.dataset.index) : null
  }

  const choose = (i) => {
    if (cells[i]?.cp !== null && cells[i]) setSelected(i)
  }

  const append = (i = selected) => {
    const c = cells[i]
    if (!c || c.cp === null) return
    setText((t) => t + String.fromCodePoint(c.cp))
  }

  const onPointerDown = (e) => {
    const i = indexAt(e)
    if (i === null || cells[i].cp === null) return
    if (e.pointerType === "mouse" && e.button !== 0) return
    e.preventDefault() // no text selection while dragging; keep the keyboard on the grid
    gridRef.current.focus({ preventScroll: true })
    pressing.current = true
    setSelected(i)
    setMagnify(true)
  }

  const onPointerMove = (e) => {
    if (!pressing.current) return
    const i = indexAt(e)
    if (i !== null) choose(i)
  }

  const columns = () => {
    const tpl = getComputedStyle(gridRef.current).gridTemplateColumns
    return Math.max(1, tpl.split(" ").filter(Boolean).length)
  }

  const onKeyDown = (e) => {
    const cols = columns()
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols, Home: -selected, End: cells.length - 1 - selected, PageUp: -cols * 4, PageDown: cols * 4 }
    if (moves[e.key] !== undefined) {
      e.preventDefault()
      let i = Math.min(cells.length - 1, Math.max(0, selected + moves[e.key]))
      // skip the unused codes
      const step = moves[e.key] < 0 ? -1 : 1
      while (cells[i] && cells[i].cp === null) i += step
      if (cells[i]) setSelected(i)
      setMagnify(true)
      return
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      append()
      return
    }
    if (e.key === "Escape") {
      setMagnify(false)
      return
    }
    // typing a character jumps to it
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const i = cells.findIndex((c) => c.cp === e.key.codePointAt(0))
      if (i >= 0) {
        e.preventDefault()
        setSelected(i)
        setMagnify(true)
      }
    }
  }

  const copy = async () => {
    if (!text) return
    recordText(text) // 98ish's clipboard history (Ctrl+Shift+V)
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // fall back to selecting the field and the copy command
    }
    const input = inputRef.current
    input.focus()
    input.select()
    let ok = false
    try {
      ok = document.execCommand("copy")
    } catch {
      ok = false
    }
    if (!ok) setDialog("This browser won't let Character Map use the clipboard. The characters are selected: press Ctrl+C (or long-press and Copy).")
  }

  const pickSubset = (id) => {
    setSubsetId(id)
    setSelected(0)
    setMagnify(false)
  }

  // the magnifier sits over the selected cell, kept inside the grid
  const magnifier = (() => {
    if (!magnify || !cell || cell.cp === null || !gridRef.current) return null
    const el = gridRef.current.querySelector(`[data-index="${selected}"]`)
    if (!el) return null
    const size = el.offsetWidth * 2.6
    const grid = gridRef.current
    const left = Math.min(Math.max(0, el.offsetLeft + el.offsetWidth / 2 - size / 2), grid.scrollWidth - size)
    const top = Math.min(Math.max(grid.scrollTop, el.offsetTop + el.offsetHeight / 2 - size / 2), grid.scrollTop + grid.clientHeight - size)
    return { left, top, size }
  })()

  return (
    <div className="cmRoot">
      <div className="cmRow cmTop">
        <label className="cmField">
          <span>Font:</span>
          <select value={font} onChange={(e) => setFont(e.target.value)}>
            {fonts.map(([f, label]) => (
              <option key={f} value={f}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="cmField">
          <span>Subset:</span>
          <select value={subsetId} onChange={(e) => pickSubset(e.target.value)}>
            {SUBSETS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="cmClose" onClick={() => onClose?.()}>
          Close
        </button>
      </div>

      <div className="cmGridWrap">
        <div
          ref={gridRef}
          className="cmGrid"
          style={{ fontFamily: fontStack(font) }}
          role="grid"
          aria-label="Characters"
          aria-activedescendant={cell ? `cm-${selected}` : undefined}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onDoubleClick={(e) => {
            const i = indexAt(e)
            if (i !== null) append(i)
          }}
          onBlur={() => setMagnify(false)}
        >
          {cells.map((c, i) => (
            <div
              key={c.code ?? c.cp}
              id={`cm-${i}`}
              data-index={i}
              role="gridcell"
              aria-selected={i === selected}
              title={c.cp === null ? undefined : hex(c.cp)}
              className={`cmCell${i === selected ? " is-selected" : ""}${c.cp === null ? " is-empty" : ""}`}
            >
              {c.cp === null ? "" : glyph(c)}
            </div>
          ))}
          {magnifier && (
            <div className="cmMagnifier" style={{ left: magnifier.left, top: magnifier.top, width: magnifier.size, height: magnifier.size, fontSize: magnifier.size * 0.62 }} aria-hidden="true">
              {glyph(cell)}
            </div>
          )}
        </div>
      </div>

      <div className="cmRow cmBottom">
        <label className="cmField cmCopyField">
          <span>Characters to copy:</span>
          <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} style={{ fontFamily: fontStack(font) }} spellCheck="false" autoCapitalize="off" autoCorrect="off" />
        </label>
        <button type="button" onClick={() => append()} disabled={!cell || cell.cp === null}>
          Select
        </button>
        <button type="button" onClick={copy} disabled={!text}>
          Copy
        </button>
      </div>

      <div className="status-bar cmStatus">
        <p className="status-bar-field">{cell && cell.cp !== null ? `${hex(cell.cp)}  ${String.fromCodePoint(cell.cp)}` : ""}</p>
        <p className="status-bar-field cmKeystroke">{keystrokeFor(cell)}</p>
      </div>

      {dialog && (
        <Dialog title="Character Map" onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog}</p>
        </Dialog>
      )}
    </div>
  )
}

export default CharMap
