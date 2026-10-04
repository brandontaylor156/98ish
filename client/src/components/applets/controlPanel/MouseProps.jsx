import React, { useRef, useState } from "react"
import { CURSORS, CURSOR_TRAILS, POINTER_SCHEMES } from "../../../utils/settings"
import { useIsTouch } from "../../../hooks/useMediaQuery"
import { Check, Choice, PropSheet, Radios, sheetButtons, useDraft } from "./Sheet"

const TABS = [
  { id: "buttons", label: "Buttons" },
  { id: "pointers", label: "Pointers" },
  { id: "motion", label: "Motion" },
  { id: "touch", label: "Touch" },
]

const KEYS = ["swapButtons", "doubleClickMs", "cursor", "cursorTrail", "longPressMs", "tapTargets"]

// the pointer's own picture, for the previews (the standard arrow is drawn here)
const pointerUrl = (id) => CURSORS[id]?.match(/url\("([^"]+)"\)/)?.[1] || null
const StandardArrow = () => (
  <svg width="16" height="24" viewBox="0 0 12 19" aria-hidden="true">
    <path d="M.5.5v15l3.5-3.5 3 6 2-1-3-6h5z" fill="#fff" stroke="#000" />
  </svg>
)

// Win98's test area: a box that pops open on a double-click at this speed
const TestBox = ({ ms }) => {
  const [open, setOpen] = useState(false)
  const last = useRef(0)
  return (
    <div
      className="cplTestBox"
      role="button"
      tabIndex={0}
      aria-label={open ? "Test area: open" : "Test area: closed"}
      data-open={open}
      onClick={(e) => {
        const now = e.timeStamp
        if (now - last.current <= ms) {
          setOpen((o) => !o)
          last.current = 0
        } else last.current = now
      }}
      onKeyDown={(e) => e.key === "Enter" && setOpen((o) => !o)}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
        {open ? (
          <>
            <path d="M14 30q-6-6 0-10t0-10" fill="none" stroke="#808080" strokeWidth="2" />
            <circle cx="14" cy="9" r="6" fill="#ffd800" stroke="#000" />
            <circle cx="12" cy="8" r="1" />
            <circle cx="16" cy="8" r="1" />
            <path d="M11 11q3 2 6 0" fill="none" stroke="#000" />
            <path d="M6 28h22v10H6z" fill="#c04040" stroke="#000" />
            <path d="M28 28l8-10" stroke="#000" strokeWidth="2" />
          </>
        ) : (
          <>
            <path d="M8 18h24v18H8z" fill="#c04040" stroke="#000" />
            <path d="M6 14h28v4H6z" fill="#e06060" stroke="#000" />
            <path d="M18 24h4v6h-4z" fill="#ffd800" stroke="#000" />
          </>
        )}
      </svg>
    </div>
  )
}

// a spot to try the long press
const HoldBox = ({ ms }) => {
  const [state, setState] = useState("Hold here")
  const timer = useRef(null)
  const stop = () => clearTimeout(timer.current)
  return (
    <div
      className="cplTestBox"
      style={{ width: 120, fontSize: 11 }}
      onPointerDown={() => {
        stop()
        setState("Holding...")
        timer.current = setTimeout(() => setState("Menu!"), ms)
      }}
      onPointerUp={() => {
        stop()
        setTimeout(() => setState("Hold here"), 900)
      }}
      onPointerLeave={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state}
    </div>
  )
}

// Mouse Properties: button order and double-click speed, pointers, pointer trails, and the
// touch screen's long press
const MouseProps = ({ onClose, tab: initialTab }) => {
  const touch = useIsTouch()
  const [tab, setTab] = useState(initialTab || (touch ? "touch" : "buttons"))
  const d = useDraft(KEYS)
  const { draft, update } = d
  // the slider goes from slow (left) to fast (right)
  const speed = 1100 - draft.doubleClickMs

  return (
    <PropSheet name="Mouse Properties" tabs={TABS} tab={tab} onTab={setTab} {...sheetButtons(d, onClose)}>
      {tab === "buttons" && (
        <>
          <fieldset>
            <legend>Button configuration</legend>
            <Radios
              name="Button configuration"
              value={draft.swapButtons ? "left" : "right"}
              options={[
                { id: "right", label: "Right-handed" },
                { id: "left", label: "Left-handed" },
              ]}
              onChange={(v) => update({ swapButtons: v === "left" })}
            />
            <p className="cplHint">{draft.swapButtons ? "Right button: click and drag. Left button: the right-click menu." : "Left button: click and drag. Right button: the right-click menu."}</p>
          </fieldset>
          <fieldset>
            <legend>Double-click speed</legend>
            <div className="cplRow">
              <span>Slow</span>
              <input type="range" min="200" max="900" step="50" value={speed} aria-label="Double-click speed" onChange={(e) => update({ doubleClickMs: 1100 - Number(e.target.value) })} />
              <span>Fast</span>
              <TestBox ms={draft.doubleClickMs} />
            </div>
            <p className="cplHint">Double-click the box to try the speed ({draft.doubleClickMs} ms between clicks).</p>
          </fieldset>
        </>
      )}

      {tab === "pointers" && (
        <fieldset>
          <legend>Pointers</legend>
          <Choice label="Scheme:" value={draft.cursor || "default"} options={POINTER_SCHEMES} onChange={(cursor) => update({ cursor })} />
          <div className="cplPointers" aria-hidden="true">
            {POINTER_SCHEMES.map((p) => (
              <span key={p.id} title={p.label} style={draft.cursor === p.id || (!draft.cursor && p.id === "default") ? { outline: "2px solid #000080" } : undefined}>
                {pointerUrl(p.id) ? <img src={pointerUrl(p.id)} alt="" width="28" height="28" /> : <StandardArrow />}
              </span>
            ))}
          </div>
          <p className="cplHint" style={{ marginTop: 8 }}>The large pointers are easier to see. Desktop Themes change the pointers too.</p>
        </fieldset>
      )}

      {tab === "motion" && (
        <fieldset>
          <legend>Pointer trail</legend>
          <Check label="Show pointer trails" checked={draft.cursorTrail !== "none"} onChange={(on) => update({ cursorTrail: on ? "pointer" : "none" })} />
          <Choice label="Trail:" value={draft.cursorTrail === "none" ? "pointer" : draft.cursorTrail} options={CURSOR_TRAILS.filter((t) => t.id !== "none")} disabled={draft.cursorTrail === "none"} onChange={(cursorTrail) => update({ cursorTrail })} />
          <p className="cplHint">Trails follow a mouse, not a finger, and stay off when motion is reduced (Accessibility Options).</p>
        </fieldset>
      )}

      {tab === "touch" && (
        <>
          <fieldset>
            <legend>Touch and hold</legend>
            <p>On a touch screen, touching and holding stands in for the right mouse button.</p>
            <div className="cplRow">
              <span>Short</span>
              <input type="range" min="300" max="1500" step="100" value={draft.longPressMs} aria-label="Touch and hold delay" onChange={(e) => update({ longPressMs: Number(e.target.value) })} />
              <span>Long</span>
            </div>
            <div className="cplRow">
              <span className="cplHint">{(draft.longPressMs / 1000).toFixed(1)} seconds</span>
              <span className="cplEnd">
                <HoldBox ms={draft.longPressMs} />
              </span>
            </div>
          </fieldset>
          <fieldset>
            <legend>Tap targets</legend>
            <Check label="Larger tap targets (buttons, menus and lists)" checked={draft.tapTargets === "large"} onChange={(on) => update({ tapTargets: on ? "large" : "normal" })} />
          </fieldset>
        </>
      )}
    </PropSheet>
  )
}

export default MouseProps
