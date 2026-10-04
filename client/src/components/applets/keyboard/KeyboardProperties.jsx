import React, { useState } from "react"
import { getSettings, setSettings } from "../../../utils/settings"
import { useIsTouch } from "../../../hooks/useMediaQuery"
import "./KeyboardProperties.css"

// Keyboard Properties (Start > Settings > Keyboard): which keyboard a touch screen types with
// (the 98ish on-screen keyboard, components/shared/keyboard, or the phone's own), how it
// feels, and Windows' Speed tab for how fast a held key repeats.

// repeat delay, Long to Short, and repeat rate, Slow to Fast (ms between repeats)
const DELAYS = [1000, 750, 500, 250]
const RATES = [200, 170, 140, 115, 95, 80, 68, 58, 50, 42, 34]
const nearest = (list, value) => list.reduce((best, v, i) => (Math.abs(v - value) < Math.abs(list[best] - value) ? i : best), 0)

// a little picture of the keyboard on the Touch Keyboard tab
const MiniKeyboard = ({ phone }) => (
  <div className={phone ? "kpMini is-phone" : "kpMini"} aria-hidden="true">
    {phone ? (
      <div className="kpMiniPhone">
        <span>Aa</span>
        <span>your phone's keyboard</span>
      </div>
    ) : (
      <>
        <div className="kpMiniTitle">Keyboard</div>
        {[10, 9, 9, 5].map((n, r) => (
          <div key={r} className="kpMiniRow">
            {Array.from({ length: n }, (_, i) => (
              <span key={i} className={r === 3 && i === 2 ? "kpMiniKey is-space" : r === 3 && i === 4 ? "kpMiniKey is-enter" : "kpMiniKey"} />
            ))}
          </div>
        ))}
      </>
    )}
  </div>
)

const KeyboardProperties = ({ onClose, tab: firstTab }) => {
  const touch = useIsTouch()
  const [tab, setTab] = useState(firstTab === "speed" ? "speed" : "touch")
  const [draft, setDraft] = useState(getSettings)
  const update = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const keys = ["keyboard", "keyClicks", "keyVibrate", "keyPreviews", "autoCaps", "periodShortcut", "keyRepeatDelay", "keyRepeatRate"]
  const saved = getSettings()
  const changed = keys.some((k) => draft[k] !== saved[k])

  const apply = () => setSettings(Object.fromEntries(keys.map((k) => [k, draft[k]])))

  const check = (id, key, label) => (
    <div className="field-row">
      <input id={id} type="checkbox" checked={!!draft[key]} onChange={(e) => update({ [key]: e.target.checked })} />
      <label htmlFor={id}>{label}</label>
    </div>
  )

  return (
    <div className="kpRoot">
      <menu role="tablist" className="kpTabs">
        {[
          ["touch", "Touch Keyboard"],
          ["speed", "Speed"],
        ].map(([t, label]) => (
          <li key={t} role="tab" aria-selected={tab === t}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                setTab(t)
              }}
            >
              {label}
            </a>
          </li>
        ))}
      </menu>

      <div className="window kpPanel" role="tabpanel">
        {tab === "touch" && (
          <>
            <fieldset className="kpField">
              <legend>On a touch screen, type with</legend>
              <div className="kpChoice">
                <div className="kpRadios">
                  <div className="field-row">
                    <input id="kp-98" type="radio" name="kp-keyboard" checked={draft.keyboard !== "phone"} onChange={() => update({ keyboard: "98ish" })} />
                    <label htmlFor="kp-98">The 98ish keyboard</label>
                  </div>
                  <div className="field-row">
                    <input id="kp-phone" type="radio" name="kp-keyboard" checked={draft.keyboard === "phone"} onChange={() => update({ keyboard: "phone" })} />
                    <label htmlFor="kp-phone">My phone's own keyboard</label>
                  </div>
                </div>
                <MiniKeyboard phone={draft.keyboard === "phone"} />
              </div>
              <p className="kpHint">
                On the 98ish keyboard, the phone button in its title bar switches one box to your phone's keyboard, for emoji, dictation, other languages and password AutoFill.
              </p>
            </fieldset>
            <fieldset className="kpField" disabled={draft.keyboard === "phone"}>
              <legend>While typing</legend>
              {check("kp-clicks", "keyClicks", "Click sound on each key")}
              {check("kp-vibrate", "keyVibrate", "Vibrate on each key (where the phone allows)")}
              {check("kp-previews", "keyPreviews", "Show each letter as you tap it")}
              {check("kp-caps", "autoCaps", "Capital letters to start sentences")}
              {check("kp-period", "periodShortcut", "Double space types a period")}
            </fieldset>
            {!touch && <p className="kpHint">These are for phones and tablets. With a mouse and keyboard, nothing changes.</p>}
          </>
        )}

        {tab === "speed" && (
          <>
            <fieldset className="kpField">
              <legend>Character repeat</legend>
              <div className="kpSlider">
                <span className="kpSliderLabel">Repeat delay:</span>
                <span className="kpEnd">Long</span>
                <input
                  type="range"
                  min={0}
                  max={DELAYS.length - 1}
                  step={1}
                  aria-label="Repeat delay"
                  value={nearest(DELAYS, draft.keyRepeatDelay)}
                  onChange={(e) => update({ keyRepeatDelay: DELAYS[Number(e.target.value)] })}
                />
                <span className="kpEnd">Short</span>
              </div>
              <div className="kpSlider">
                <span className="kpSliderLabel">Repeat rate:</span>
                <span className="kpEnd">Slow</span>
                <input
                  type="range"
                  min={0}
                  max={RATES.length - 1}
                  step={1}
                  aria-label="Repeat rate"
                  value={nearest(RATES, draft.keyRepeatRate)}
                  onChange={(e) => update({ keyRepeatRate: RATES[Number(e.target.value)] })}
                />
                <span className="kpEnd">Fast</span>
              </div>
              <label className="kpTestLabel" htmlFor="kp-test">
                {touch ? "Tap here, type, then hold Backspace to test the repeat rate:" : "Click here and hold down a key to test repeat rate:"}
              </label>
              <input id="kp-test" type="text" className="kpTest" autoComplete="off" spellCheck="false" />
              {touch && <p className="kpHint">Press Apply first to try new speeds.</p>}
            </fieldset>
          </>
        )}
      </div>

      <div className="kpButtons">
        <button
          type="button"
          className="default"
          onClick={() => {
            apply()
            onClose?.()
          }}
        >
          OK
        </button>
        <button type="button" onClick={() => onClose?.()}>
          Cancel
        </button>
        <button type="button" disabled={!changed} onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  )
}

export default KeyboardProperties
