import React, { useId, useState } from "react"
import { getSettings, setSettings, useSettings } from "../../../utils/settings"

// The pieces every Control Panel applet shares: a draft of some settings (OK / Cancel /
// Apply, as in Windows: nothing changes until OK or Apply), and the property sheet itself
// (98 tabs, the panel, the buttons).

const pick = (s, keys) => Object.fromEntries(keys.map((k) => [k, s[k]]))

export const useDraft = (keys) => {
  const settings = useSettings()
  const [draft, setDraft] = useState(() => pick(getSettings(), keys))
  const update = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const changed = JSON.stringify(draft) !== JSON.stringify(pick(settings, keys))
  const apply = () => setSettings(draft)
  return { draft, update, changed, apply, settings }
}

export const PropSheet = ({ name, tabs = [], tab, onTab, onOk, onCancel, onApply, changed, children, className = "" }) => (
  <div className={`cplSheet ${className}`} data-applet={name}>
    {tabs.length > 0 && (
      <menu role="tablist" className="cplTabs" aria-label={name}>
        {tabs.map((t) => (
          <li key={t.id} role="tab" aria-selected={tab === t.id}>
            <a
              href="#"
              data-tab={t.id}
              onClick={(e) => {
                e.preventDefault()
                onTab(t.id)
              }}
            >
              {t.label}
            </a>
          </li>
        ))}
      </menu>
    )}
    <div className="window cplPanel" role="tabpanel" aria-label={tabs.find((t) => t.id === tab)?.label || name}>
      {children}
    </div>
    <div className="cplButtons">
      <button type="button" className="default" onClick={onOk}>
        OK
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      )}
      {onApply && (
        <button type="button" disabled={!changed} onClick={onApply}>
          Apply
        </button>
      )}
    </div>
  </div>
)

// a labelled check box (98.css draws the box on the label)
export const Check = ({ label, checked, onChange, disabled, id }) => {
  const auto = useId()
  const key = id || auto
  return (
    <div className="field-row cplCheck">
      <input id={key} type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={key}>{label}</label>
    </div>
  )
}

// a set of option buttons
export const Radios = ({ name, value, options, onChange, disabled }) => {
  const auto = useId()
  return (
    <div className="cplRadios" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <div className="field-row" key={String(o.id)}>
          <input id={`${auto}-${o.id}`} type="radio" name={auto} checked={value === o.id} disabled={disabled} onChange={() => onChange(o.id)} />
          <label htmlFor={`${auto}-${o.id}`}>{o.label}</label>
        </div>
      ))}
    </div>
  )
}

// a label and a drop-down list on one row
export const Choice = ({ label, value, options, onChange, disabled }) => {
  const id = useId()
  return (
    <div className="cplChoice">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={String(o.id)} value={String(o.id)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// 512 bytes, 14.2 KB, 3.1 MB, 1.2 GB
export const bytesText = (n) => {
  if (!Number.isFinite(n) || n < 0) return "unknown"
  if (n < 1024) return `${Math.round(n)} bytes`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

// the standard OK / Cancel / Apply wiring for a draft
export const sheetButtons = ({ apply, changed }, onClose) => ({
  onOk: () => {
    if (changed) apply()
    onClose?.()
  },
  onCancel: () => onClose?.(),
  onApply: apply,
  changed,
})
