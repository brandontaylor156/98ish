import React, { useState } from "react"
import { DECKS, DEV, DEV_TYPES, TIMERS } from "./logic.js"
import { geoFor } from "./board.js"

// The game's settings: players, points to win, the map, the turn clock and house rules.
// Used for games against the computer and in online rooms (renderSettings).

const LAYOUT_TEXT = {
  balanced: "Balanced: shuffled, but no red numbers (6, 8) touching",
  random: "Random: anything goes",
  beginner: "Beginner: the same fair island every time",
}

const SettingsForm = ({ settings: s, onChange, disabled = false, mode = "solo" }) => {
  const [deckOpen, setDeckOpen] = useState(!!s.deck)
  const set = (patch) => onChange({ ...s, ...patch })
  const base = DECKS[geoFor(s.players)]
  const deck = s.deck || base
  return (
    <div className="hxSettings">
      <label className="hxField">
        <span>{mode === "solo" ? "Opponents" : "Players"}</span>
        <select value={s.players} disabled={disabled} onChange={(e) => set({ players: Number(e.target.value), deck: null })} data-field="players">
          {[2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {mode === "solo" ? `${n - 1} computer${n > 2 ? "s" : ""}` : `${n} players`}
              {n >= 5 ? " (big island)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="hxField">
        <span>Computer players</span>
        <select value={s.level} disabled={disabled} onChange={(e) => set({ level: e.target.value })} data-field="level">
          <option value="easy">Easy</option>
          <option value="normal">Normal</option>
          <option value="hard">Hard</option>
        </select>
      </label>
      <label className="hxField">
        <span>Points to win</span>
        <select value={s.target} disabled={disabled} onChange={(e) => set({ target: Number(e.target.value) })} data-field="target">
          {[8, 9, 10, 11, 12, 13, 14].map((n) => (
            <option key={n} value={n}>
              {n}
              {n === 10 ? " (classic)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="hxField">
        <span>Map</span>
        <select value={s.layout} disabled={disabled} onChange={(e) => set({ layout: e.target.value })} data-field="layout">
          {Object.entries(LAYOUT_TEXT).map(([k, t]) => (
            <option key={k} value={k}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="hxField">
        <span>Turn timer</span>
        <select value={s.timer} disabled={disabled} onChange={(e) => set({ timer: Number(e.target.value) })} data-field="timer">
          {TIMERS.map((t) => (
            <option key={t} value={t}>
              {t ? `${t} seconds` : "Off"}
            </option>
          ))}
        </select>
      </label>
      <label className="hxField">
        <span>On a 7, discard half over</span>
        <select value={s.discard} disabled={disabled} onChange={(e) => set({ discard: Number(e.target.value) })} data-field="discard">
          {[5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
            <option key={n} value={n}>
              {n} cards{n === 7 ? " (classic)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="hxCheck">
        <input type="checkbox" checked={s.friendly} disabled={disabled} onChange={(e) => set({ friendly: e.target.checked })} data-field="friendly" />
        <span>
          Friendly Bandit <small>(leaves players with 2 points or fewer alone)</small>
        </span>
      </label>
      <label className="hxCheck">
        <input type="checkbox" checked={s.botTrade} disabled={disabled} onChange={(e) => set({ botTrade: e.target.checked })} data-field="botTrade" />
        <span>
          Computer players trade <small>(with people and each other)</small>
        </span>
      </label>
      {s.players >= 5 && (
        <label className="hxCheck">
          <input type="checkbox" checked={s.special} disabled={disabled} onChange={(e) => set({ special: e.target.checked })} data-field="special" />
          <span>
            Special building <small>(everyone may build between turns)</small>
          </span>
        </label>
      )}
      <div className="hxDeckBox">
        <button type="button" className="hxLink" onClick={() => setDeckOpen(!deckOpen)} disabled={disabled && !s.deck} data-deck-toggle>
          {deckOpen ? "▾" : "▸"} Development deck: {s.deck ? "custom" : `standard (${Object.values(base).reduce((a, b) => a + b, 0)} cards)`}
        </button>
        {deckOpen && (
          <div className="hxDeck">
            {DEV_TYPES.map((t) => (
              <label key={t} className="hxDeckRow">
                <span>{DEV[t].label}</span>
                <input
                  type="number"
                  min="0"
                  max="25"
                  value={deck[t]}
                  disabled={disabled}
                  onChange={(e) => set({ deck: { ...deck, [t]: Math.max(0, Math.min(25, Number(e.target.value) || 0)) } })}
                  data-deck={t}
                />
              </label>
            ))}
            {s.deck && (
              <button type="button" className="hxLink" disabled={disabled} onClick={() => set({ deck: null })}>
                Back to the standard deck
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default SettingsForm
