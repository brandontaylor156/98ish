import React, { useState } from "react"
import { CONTRAST_SCHEMES, MOTION_CHOICES, TEXT_SIZES, contrastScheme, textScale } from "../../../utils/a11y"
import { launch } from "../../../utils/programs"
import { useMediaQuery } from "../../../hooks/useMediaQuery"
import MoreOptions from "../../shared/MoreOptions"
import { Check, Choice, PropSheet, Radios, sheetButtons, useDraft } from "./Sheet"

const TABS = [
  { id: "display", label: "Display" },
  { id: "motion", label: "Motion" },
  { id: "magnifier", label: "Magnifier" },
  { id: "keyboard", label: "Keyboard" },
]

const KEYS = ["textSize", "contrast", "reduceMotion", "tapTargets", "magZoom", "magFollowMouse", "magFollowFocus"]

const SHORTCUTS = [
  ["Ctrl+Esc", "Open the Start menu (then the arrow keys, Enter and Esc)"],
  ["Alt+Q", "Switch between windows (hold Alt, press Q again to move on)"],
  ["Alt+F4", "Close the active window"],
  ["Shift+F10", "The right-click menu of the selected item (or the Menu key)"],
  ["Tab", "Move between desktop icons, buttons and boxes"],
  ["Enter", "Open the selected icon or item"],
  ["Ctrl+Alt+K", "All the keyboard shortcuts"],
  ["Ctrl+Alt+L", "Lock the computer"],
]

// a little window in the chosen colors, for the High Contrast preview
const ContrastPreview = ({ id }) => {
  const s = contrastScheme(id)
  const c = s?.colors || { bg: "#fff", fg: "#000", title: "#000080", titleFg: "#fff", hi: "#000080", hiFg: "#fff", face: "#c0c0c0" }
  return (
    <div className="cplMini hc-keep" style={{ background: c.bg, color: c.fg, borderColor: c.fg }} aria-hidden="true">
      <div className="cplMiniTitle" style={{ background: c.title, color: c.titleFg }}>
        Active Window
      </div>
      <p style={{ color: c.fg }}>
        Window Text <span className="cplMiniSel" style={{ background: c.hi, color: c.hiFg }}>Selected</span>
      </p>
    </div>
  )
}

// Accessibility Options: text size, High Contrast, less motion, the Magnifier (or larger
// tap targets on phones), and the keyboard shortcuts for using 98ish without a mouse.
const Accessibility = ({ mobile, dispatch, onClose, tab: initialTab = "display" }) => {
  const [tab, setTab] = useState(initialTab)
  const d = useDraft(KEYS)
  const { draft, update } = d
  const systemReduced = useMediaQuery("(prefers-reduced-motion: reduce)")
  const [scheme, setScheme] = useState(draft.contrast === "off" ? "black" : draft.contrast)
  const hc = draft.contrast !== "off"

  return (
    <PropSheet name="Accessibility Options" tabs={TABS} tab={tab} onTab={setTab} {...sheetButtons(d, onClose)}>
      {tab === "display" && (
        <>
          <fieldset>
            <legend>Text size</legend>
            <p>Makes the writing in every window, menu and title bar bigger.</p>
            <Radios name="Text size" value={draft.textSize} options={TEXT_SIZES} onChange={(textSize) => update({ textSize })} />
            <div className="cplSample hc-keep" style={{ fontSize: `${11 * textScale(draft.textSize)}px`, color: "#000" }} aria-hidden="true">
              The quick brown fox jumps over the lazy dog.
            </div>
          </fieldset>
          <fieldset>
            <legend>High Contrast</legend>
            <p>Shows windows, menus and the taskbar in strong colors that are easier to read.</p>
            <Check label="Use High Contrast" checked={hc} onChange={(on) => update({ contrast: on ? scheme : "off" })} />
            {/* the scheme and its preview: More options (docs/simplicity.md) */}
            <MoreOptions id="a11y.contrast" summary={`Color scheme: ${CONTRAST_SCHEMES.find((s) => s.id === scheme)?.label || scheme}`}>
              <Choice
                label="Color scheme:"
                value={scheme}
                options={CONTRAST_SCHEMES.filter((s) => s.colors)}
                disabled={!hc}
                onChange={(id) => {
                  setScheme(id)
                  if (hc) update({ contrast: id })
                }}
              />
              <ContrastPreview id={hc ? draft.contrast : "off"} />
            </MoreOptions>
          </fieldset>
        </>
      )}

      {tab === "motion" && (
        <fieldset>
          <legend>Motion</legend>
          <p>Less motion turns off window and menu animations, the startup animation, moving wallpapers, sliding notifications, confetti and screen shake.</p>
          <Radios name="Motion" value={draft.reduceMotion} options={MOTION_CHOICES} onChange={(reduceMotion) => update({ reduceMotion })} />
          <p className="cplHint">Your device's setting right now: {systemReduced ? "less motion" : "full motion"}.</p>
        </fieldset>
      )}

      {tab === "magnifier" && (
        <>
          {!mobile && (
            <fieldset>
              <legend>Magnifier</legend>
              <p>Magnifier shows the part of the screen around the mouse pointer (or the keyboard focus) bigger, in a window you can move and size.</p>
              <Choice label="Magnification level:" value={draft.magZoom} options={[2, 3, 4, 5, 6].map((n) => ({ id: n, label: `${n}x` }))} onChange={(v) => update({ magZoom: Number(v) })} />
              <Check label="Follow the mouse pointer" checked={draft.magFollowMouse} onChange={(magFollowMouse) => update({ magFollowMouse })} />
              <Check label="Follow the keyboard focus" checked={draft.magFollowFocus} onChange={(magFollowFocus) => update({ magFollowFocus })} />
              <div className="cplRow">
                <button
                  type="button"
                  onClick={() => {
                    if (d.changed) d.apply()
                    dispatch({ type: "open_window", payload: launch("Magnifier") })
                  }}
                >
                  Open Magnifier
                </button>
              </div>
            </fieldset>
          )}
          <fieldset>
            <legend>Touch</legend>
            {mobile && <p>Magnifier needs a mouse. On a phone, your phone's own zoom works with 98ish (on iPhone: Settings, Accessibility, Zoom), and larger tap targets make buttons easier to hit.</p>}
            <Check label="Larger tap targets (buttons, menus and lists)" checked={draft.tapTargets === "large"} onChange={(on) => update({ tapTargets: on ? "large" : "normal" })} />
          </fieldset>
        </>
      )}

      {tab === "keyboard" && (
        <fieldset>
          <legend>Using 98ish without a mouse</legend>
          <table className="cplTable">
            <tbody>
              {SHORTCUTS.map(([keys, what]) => (
                <tr key={keys}>
                  <th scope="row">
                    {keys.split("+").map((k) => (
                      <span key={k} className="cplKey">
                        {k}
                      </span>
                    ))}
                  </th>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="cplHint" style={{ marginTop: 8 }}>
            A dotted rectangle shows where the keyboard is. Screen readers hear each window's title, the taskbar's buttons and the Start menu's items.
          </p>
        </fieldset>
      )}
    </PropSheet>
  )
}

export default Accessibility
