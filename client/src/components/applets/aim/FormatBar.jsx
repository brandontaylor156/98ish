import React from "react"
import { FONTS, SIZES, useAim } from "./AimContext"

// Defined outside FormatBar so re-renders don't remount it mid-click
const Toggle = ({ style, set, prop, label, children }) => (
  <button
    type="button"
    className={style[prop] ? "aimFormatButton is-on" : "aimFormatButton"}
    aria-pressed={style[prop]}
    aria-label={label}
    title={label}
    onClick={() => set({ [prop]: !style[prop] })}
  >
    {children}
  </button>
)

// The formatting toolbar. Like classic messengers, it sets your default font and color,
// which every message you send then uses (and is remembered between visits).
const FormatBar = () => {
  const { prefs, setPrefs } = useAim()
  const style = prefs.style
  const sizeIndex = SIZES.indexOf(style.size)
  const set = (patch) => setPrefs({ style: patch })

  return (
    <div className="aimFormatBar">
      <select value={style.font} onChange={(e) => set({ font: e.target.value })} aria-label="Font" style={{ fontFamily: style.font }}>
        {FONTS.map((font) => (
          <option key={font} value={font} style={{ fontFamily: font }}>
            {font}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="aimFormatButton"
        aria-label="Smaller text"
        title="Smaller text"
        disabled={sizeIndex <= 0}
        onClick={() => set({ size: SIZES[sizeIndex - 1] })}
      >
        <span style={{ fontSize: 10 }}>A</span>
      </button>
      <button
        type="button"
        className="aimFormatButton"
        aria-label="Larger text"
        title="Larger text"
        disabled={sizeIndex >= SIZES.length - 1}
        onClick={() => set({ size: SIZES[sizeIndex + 1] })}
      >
        <span style={{ fontSize: 15 }}>A</span>
      </button>
      <Toggle style={style} set={set} prop="bold" label="Bold">
        <b>B</b>
      </Toggle>
      <Toggle style={style} set={set} prop="italic" label="Italic">
        <i>I</i>
      </Toggle>
      <Toggle style={style} set={set} prop="underline" label="Underline">
        <u>U</u>
      </Toggle>
      <label className="aimColor" title="Text color">
        <span className="aimColorSwatch" style={{ background: style.color }} />
        <input type="color" value={style.color} onChange={(e) => set({ color: e.target.value })} aria-label="Text color" />
      </label>
    </div>
  )
}

export default FormatBar
