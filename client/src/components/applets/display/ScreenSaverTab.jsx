import React, { useRef, useState } from "react"
import { createPortal } from "react-dom"
import Dialog from "../../shared/Dialog"
import { SCREENSAVERS, Screensaver, ScreensaverPreview, optionsFor, saverById } from "../../screensavers"
import { hasSecret } from "../../../utils/lock"
import { shellAction } from "../../../utils/shell"

// Display Properties > Screen Saver: pick one, how long to wait, its settings, and a
// preview (live in the little monitor, or full screen until you move the mouse).
// Works on the draft settings; Display Properties' OK / Apply saves them.
const ScreenSaverTab = ({ draft, update, screenStyle }) => {
  const ref = useRef(null)
  const [editing, setEditing] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [wait, setWait] = useState(String(draft.screensaverWait))
  const id = draft.screensaver
  const saver = saverById(id)
  const options = optionsFor(id, draft.screensaverOptions)

  const changeWait = (text) => {
    setWait(text)
    const n = Math.round(Number(text))
    if (text.trim() !== "" && n >= 1 && n <= 60) update({ screensaverWait: n })
  }

  return (
    <div className="dpStack" ref={ref}>
      <div className="dpMonitor" aria-hidden="true">
        <div className="dpScreen" style={saver ? { background: "#000" } : screenStyle}>
          {saver && !previewing && <ScreensaverPreview id={id} settings={options} />}
        </div>
        <div className="dpStand" />
      </div>

      <fieldset className="dpField">
        <legend>Screen Saver</legend>
        <div className="ssTabRow">
          <select id="dp-saver" aria-label="Screen Saver" value={saver ? id : "none"} onChange={(e) => update({ screensaver: e.target.value })}>
            <option value="none">(None)</option>
            {SCREENSAVERS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button type="button" disabled={!saver} onClick={() => setEditing(true)}>
            Settings...
          </button>
          <button type="button" disabled={!saver} onClick={() => setPreviewing(true)}>
            Preview
          </button>
        </div>
        <div className="ssTabRow">
          <label htmlFor="dp-wait">Wait:</label>
          <input
            id="dp-wait"
            className="ssWait"
            type="number"
            min="1"
            max="60"
            disabled={!saver}
            value={wait}
            onChange={(e) => changeWait(e.target.value)}
            onBlur={() => setWait(String(draft.screensaverWait))}
          />
          <label htmlFor="dp-wait">minutes</label>
        </div>
        {/* Windows 98's screen saver password: here it locks 98ish (utils/lock.js) */}
        <div className="ssTabRow">
          <input id="dp-saverlock" type="checkbox" disabled={!saver} checked={!!draft.lockOnSaver && hasSecret()} onChange={(e) => (hasSecret() ? update({ lockOnSaver: e.target.checked }) : shellAction("passwords"))} />
          <label htmlFor="dp-saverlock">Password protected</label>
          <button type="button" onClick={() => shellAction("passwords")}>
            Change...
          </button>
        </div>
      </fieldset>
      <p className="dpHint">The screen saver starts when you leave 98ish alone for the wait time. Move the mouse, press a key or touch the screen to come back.</p>

      {previewing && saver && <Screensaver id={id} settings={options} onExit={() => setPreviewing(false)} />}
      {/* over the whole Display Properties window, not just the tab */}
      {editing &&
        saver &&
        createPortal(
          <SaverSettings
            saver={saver}
            value={options}
            onOk={(value) => {
              update({ screensaverOptions: { ...draft.screensaverOptions, [id]: value } })
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />,
          ref.current?.closest(".dpRoot") || document.body
        )}
    </div>
  )
}

// The Settings... dialog, built from the screensaver's field list
const SaverSettings = ({ saver, value, onOk, onCancel }) => {
  const [form, setForm] = useState(value)
  const set = (key, v) => setForm((f) => ({ ...f, [key]: v }))

  return (
    <Dialog title={`${saver.label} Setup`} okLabel="OK" onOk={() => onOk(form)} onCancel={onCancel}>
      {saver.fields.map((field) => {
        const fid = `ss-${saver.id}-${field.key}`
        const v = form[field.key]
        return (
          <div key={field.key} className="ssField">
            <label htmlFor={fid}>{field.label}:</label>
            {field.type === "range" && (
              <div className="ssRange">
                <span>{field.low}</span>
                <input id={fid} type="range" min={field.min} max={field.max} step="1" value={v} onChange={(e) => set(field.key, Number(e.target.value))} />
                <span>{field.high}</span>
              </div>
            )}
            {field.type === "select" && (
              <select id={fid} value={v} onChange={(e) => set(field.key, e.target.value)}>
                {field.choices.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            {field.type === "text" && <input id={fid} type="text" maxLength={field.maxLength} value={v} onChange={(e) => set(field.key, e.target.value)} />}
            {field.type === "textarea" && (
              <textarea id={fid} className="ssTextarea" rows={field.rows || 4} maxLength={field.maxLength} value={v} onChange={(e) => set(field.key, e.target.value)} />
            )}
            {field.type === "color" && <input id={fid} className="ssColor" type="color" value={v} onChange={(e) => set(field.key, e.target.value)} />}
          </div>
        )
      })}
      <button type="button" className="ssDefaults" onClick={() => setForm({ ...saver.defaults })}>
        Defaults
      </button>
    </Dialog>
  )
}

export default ScreenSaverTab
