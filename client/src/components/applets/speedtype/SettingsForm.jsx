import React, { useId } from "react"
import { CATEGORIES, LENGTHS } from "./prompts/index.js"
import { MAX_CUSTOM, MODES } from "./rules"

// The race settings: mode, prompt length and category, strict typing, the computer
// racers' speed, and (online, private rooms) seats and the host's own text.
// where: "online" | "local"

export const BOT_SPEEDS = [
  [0, "Mixed (40-100 WPM)"],
  [25, "Beginner (25 WPM)"],
  [40, "Casual (40 WPM)"],
  [60, "Quick (60 WPM)"],
  [80, "Fast (80 WPM)"],
  [100, "Pro (100 WPM)"],
  [130, "Legend (130 WPM)"],
]

const SettingsForm = ({ settings: s, onChange, disabled = false, where = "online", opponents, onOpponents }) => {
  const id = useId()
  const set = (patch) => onChange({ ...s, ...patch })
  const useCustom = !!(s.useCustom || s.custom)
  return (
    <div className="stSettings">
      <label>
        <span>Mode</span>
        <select value={s.mode} disabled={disabled} onChange={(e) => set({ mode: e.target.value })} data-setting="mode">
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <p className="stMuted stModeText">{MODES.find((m) => m.id === s.mode)?.text}</p>
      <label>
        <span>Length</span>
        <select value={s.length} disabled={disabled || useCustom} onChange={(e) => set({ length: e.target.value })} data-setting="length">
          <option value="any">Any length</option>
          {LENGTHS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label} ({l.text})
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Prompts</span>
        <select value={s.category} disabled={disabled || useCustom} onChange={(e) => set({ category: e.target.value })} data-setting="category">
          <option value="any">Anything</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {where === "local" ? (
        <label>
          <span>Opponents</span>
          <select value={opponents} disabled={disabled} onChange={(e) => onOpponents(Number(e.target.value))} data-setting="opponents">
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} computer {n === 1 ? "racer" : "racers"}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          <span>Seats</span>
          <select value={s.players} disabled={disabled} onChange={(e) => set({ players: Number(e.target.value) })} data-setting="players">
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} racers
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        <span>Computer speed</span>
        <select value={s.botWpm} disabled={disabled} onChange={(e) => set({ botWpm: Number(e.target.value) })} data-setting="botWpm">
          {BOT_SPEEDS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="stCheck">
        <input id={`${id}-strict`} type="checkbox" checked={!!s.strict} disabled={disabled} onChange={(e) => set({ strict: e.target.checked })} data-setting="strict" />
        <label htmlFor={`${id}-strict`}>Strict typing: wrong keys don't go in, no backspace</label>
      </div>
      {where === "online" && (
        <>
          <div className="stCheck">
            <input id={`${id}-custom`} type="checkbox" checked={!!useCustom} disabled={disabled} onChange={(e) => set({ useCustom: e.target.checked, custom: e.target.checked ? s.custom || "" : "" })} data-setting="useCustom" />
            <label htmlFor={`${id}-custom`}>Race my own text (private rooms)</label>
          </div>
          {useCustom && (
            <textarea
              className="stCustomText"
              value={s.custom || ""}
              disabled={disabled}
              maxLength={MAX_CUSTOM}
              rows={3}
              placeholder="Type or paste something for everyone to race (10 to 600 characters)."
              onChange={(e) => set({ custom: e.target.value })}
              data-setting="custom"
            />
          )}
        </>
      )}
    </div>
  )
}

export default SettingsForm
