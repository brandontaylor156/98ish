import { useId } from "react"
import { Check, Slider } from "../../../shared/controls"
import { SENSITIVITY_RANGE } from "../utils/gestures"
import { SCHEMES, setTouchPrefs } from "../utils/touchPrefs"

// Tetris's own options at the top of the controls editor (Customize Controls panel):
// gestures and/or buttons, how far a drag moves the piece, and what a tap rotates
const TouchSettings = ({ prefs }) => {
  const id = useId()
  const swipe = prefs.scheme !== "buttons"
  return (
    <div className="tetrisTouchSettings">
      <div className="tcRow">
        <label htmlFor={id}>Play with:</label>
        <select id={id} name="tetris-scheme" value={prefs.scheme} onChange={(e) => setTouchPrefs({ scheme: e.target.value })}>
          {SCHEMES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>
      {swipe && (
        <>
          <Slider
            label="Drag speed"
            name="tetris-sensitivity"
            min={SENSITIVITY_RANGE[0]}
            max={SENSITIVITY_RANGE[1]}
            value={prefs.sensitivity}
            onChange={(v) => setTouchPrefs({ sensitivity: v })}
          />
          <div className="tcRow">
            <Check label="Tap left half to rotate left" checked={prefs.tapSides} onChange={(on) => setTouchPrefs({ tapSides: on })} />
          </div>
          <div className="tetrisTouchHelp">Drag: move. Drag down: soft drop. Flick down: hard drop. Swipe up: hold. Tap: rotate.</div>
        </>
      )}
    </div>
  )
}

export default TouchSettings
