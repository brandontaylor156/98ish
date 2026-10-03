import React, { useState } from "react"
import { BOARD_COUNTS, FORMATS, PRESETS, describe, guessesForBoards, presetSettings, validateSettings } from "./settings"

// The Custom Game / Create Room form: presets on top, every knob below ("Customize").
// mode: "online" (a room: players, spectators, handicaps by seat) or "solo" (you plus
// computer players, run in this browser). seatNames: the room's seats, for handicaps.

const Field = ({ label, children, hint }) => (
  <label className="wdField">
    <span className="wdFieldLabel">{label}</span>
    {children}
    {hint && <small className="wdHint">{hint}</small>}
  </label>
)

const SettingsForm = ({ settings, onChange, disabled = false, mode = "online", seatNames = [] }) => {
  const [open, setOpen] = useState(settings.preset === "custom")
  const s = settings
  // a knob changed: it's a custom game now
  const set = (patch) => {
    const next = { ...s, ...patch, preset: "custom" }
    const clean = validateSettings(next)
    onChange(clean.error ? next : { ...next, ...clean, list: next.list ?? clean.list })
  }
  const choose = (name) => {
    const next = presetSettings(name, s)
    if (mode === "online" && next.players < 2 && next.format !== "absurd") next.players = 2
    if (mode === "online" && name === "absurd") next.players = 2
    if (mode === "solo" && PRESETS[name].settings.players === undefined) next.players = s.players || 1
    onChange(next)
  }
  const solo = mode === "solo"
  const presetNames = Object.keys(PRESETS).filter((k) => (solo ? true : k !== "classic"))
  const shared = s.format === "turns" || s.format === "coop"
  const bots = Math.max(0, s.players - 1)

  return (
    <div className={`wdSettings${disabled ? " is-disabled" : ""}`}>
      <div className="wdPresets" role="radiogroup" aria-label="Game type">
        {presetNames.map((name) => (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={s.preset === name}
            className={`wdPreset${s.preset === name ? " is-on" : ""}`}
            disabled={disabled}
            data-preset={name}
            onClick={() => choose(name)}
            title={PRESETS[name].text}
          >
            <b>{PRESETS[name].label}</b>
            <small>{PRESETS[name].text}</small>
          </button>
        ))}
      </div>
      <p className="wdSummary" data-summary>
        {describe(s)}
      </p>
      <button type="button" className="wdCustomize" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} Customize every setting
      </button>
      {open && (
        <fieldset className="wdKnobs" disabled={disabled}>
          <Field label="Format" hint={FORMATS[s.format]?.text}>
            <select value={s.format} onChange={(e) => set({ format: e.target.value })} data-knob="format">
              {Object.entries(FORMATS).map(([id, f]) => (
                <option key={id} value={id}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          {solo ? (
            <Field label="Computer opponents">
              <select value={bots} onChange={(e) => set({ players: 1 + Number(e.target.value) })} data-knob="bots-count">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "None (just me)" : n}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Players">
              <select value={s.players} onChange={(e) => set({ players: Number(e.target.value) })} data-knob="players">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Word length">
            <select value={s.length} onChange={(e) => set({ length: Number(e.target.value) })} data-knob="length">
              {[4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n} letters
                </option>
              ))}
            </select>
          </Field>
          <Field label="Guesses">
            <select value={s.guesses} onChange={(e) => set({ guesses: Number(e.target.value) })} data-knob="guesses">
              {[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              <option value={0}>Unlimited</option>
            </select>
          </Field>
          {s.format !== "rush" && s.format !== "absurd" && s.format !== "sabotage" && (
            <Field label="Boards at once" hint={s.boards > 1 ? "Every guess goes on every board." : null}>
              <select value={s.boards} onChange={(e) => set({ boards: Number(e.target.value), guesses: guessesForBoards(Number(e.target.value)) })} data-knob="boards">
                {BOARD_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {s.format === "rush" ? (
            <Field label="Rush clock">
              <select value={s.rushSecs} onChange={(e) => set({ rushSecs: Number(e.target.value) })} data-knob="rushSecs">
                {[60, 120, 180, 300, 600].map((n) => (
                  <option key={n} value={n}>
                    {n / 60} minute{n === 60 ? "" : "s"}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            s.format !== "royale" && (
              <Field label="Rounds">
                <span className="wdInline">
                  <select value={s.rounds} onChange={(e) => set({ rounds: Number(e.target.value) })} data-knob="rounds">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  {s.rounds > 1 && (
                    <select value={s.series} onChange={(e) => set({ series: e.target.value })} data-knob="series" aria-label="Series">
                      <option value="points">add up the points</option>
                      <option value="wins">best of {s.rounds} (most round wins)</option>
                    </select>
                  )}
                </span>
              </Field>
            )
          )}
          {s.format !== "rush" && (
            <Field label="Timer">
              <span className="wdInline">
                <select value={s.timer} onChange={(e) => set({ timer: e.target.value })} data-knob="timer">
                  <option value="none">None</option>
                  <option value="guess">Per guess</option>
                  <option value="round">Per round</option>
                </select>
                {s.timer !== "none" && (
                  <select value={s.timerSecs} onChange={(e) => set({ timerSecs: Number(e.target.value) })} data-knob="timerSecs" aria-label="Seconds">
                    {[10, 15, 20, 30, 45, 60, 90, 120, 150, 180, 240, 300, 600].map((n) => (
                      <option key={n} value={n}>
                        {n < 60 ? `${n} seconds` : `${n / 60} min`}
                      </option>
                    ))}
                  </select>
                )}
              </span>
            </Field>
          )}
          {!["rush", "coop", "royale"].includes(s.format) && (
            <Field label="Scoring">
              <select value={s.scoring} onChange={(e) => set({ scoring: e.target.value })} data-knob="scoring">
                <option value="guesses">Fewest guesses</option>
                <option value="time">Fastest solve (first to solve wins)</option>
                <option value="tiles">Points per tile (2 per green, 1 per letter found, 10 to solve)</option>
              </select>
            </Field>
          )}
          {!shared && (
            <Field label="Others' boards">
              <select value={s.show} onChange={(e) => set({ show: e.target.value })} data-knob="show">
                <option value="none">Hidden (just how many guesses)</option>
                <option value="colors">Colors only</option>
                <option value="full">Colors and letters</option>
              </select>
            </Field>
          )}
          {s.format !== "sabotage" && (
            <Field label="The word" hint={s.source === "custom" ? "Player 1 types the secret word and watches the others try." : s.source === "daily" ? "Today's word: the same for everyone." : null}>
              <select value={s.source} onChange={(e) => set({ source: e.target.value })} data-knob="source">
                <option value="random">Random</option>
                {s.format !== "absurd" && <option value="daily">Today's daily word</option>}
                {s.format !== "absurd" && s.format !== "rush" && !solo && <option value="custom">Player 1 picks it</option>}
                <option value="list">From my own list</option>
              </select>
            </Field>
          )}
          {s.source === "list" && (
            <Field label="Your word list" hint={`${s.length}-letter words, separated by spaces or commas. Other lengths are skipped.`}>
              <textarea value={s.list} maxLength={1500} rows={3} onChange={(e) => onChange({ ...s, list: e.target.value, preset: "custom" })} placeholder="crane, pixel, mango, ..." data-knob="list" />
            </Field>
          )}
          {s.format === "coop" && (
            <Field label="Co-op style">
              <select value={s.coopMode} onChange={(e) => set({ coopMode: e.target.value })} data-knob="coopMode">
                <option value="vote">Suggest and vote</option>
                <option value="alternate">Take turns</option>
                <option value="free">Anyone, any time</option>
              </select>
            </Field>
          )}
          <div className="wdChecks">
            <label>
              <input type="checkbox" checked={s.hard} onChange={(e) => set({ hard: e.target.checked })} data-knob="hard" /> Hard mode (use every hint)
            </label>
            <label>
              <input type="checkbox" checked={!s.strict} onChange={(e) => set({ strict: !e.target.checked })} data-knob="strict" /> Allow any letters (not just real words)
            </label>
            {(s.format === "race" || s.format === "absurd") && s.players >= 3 && (
              <label>
                <input type="checkbox" checked={s.teams} onChange={(e) => set({ teams: e.target.checked })} data-knob="teams" /> Teams (odd seats vs. even seats, one board per team)
              </label>
            )}
            {!solo && (
              <label>
                <input type="checkbox" checked={s.spectators} onChange={(e) => set({ spectators: e.target.checked })} data-knob="spectators" /> Let people watch
              </label>
            )}
          </div>
          <Field label="Computer players">
            <select value={s.bots} onChange={(e) => set({ bots: e.target.value })} data-knob="botLevel">
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
          </Field>
          {s.guesses > 0 && !shared && !s.teams && (
            <div className="wdHandicaps">
              <span className="wdFieldLabel">Handicaps (extra guesses)</span>
              <div className="wdHandicapGrid">
                {Array.from({ length: solo ? 1 : s.players }, (_, i) => (
                  <label key={i}>
                    <span>{solo ? "You" : seatNames[i] || `Player ${i + 1}`}</span>
                    <select
                      value={s.handicap?.[i] || 0}
                      onChange={(e) => {
                        const handicap = [...(s.handicap || [])]
                        handicap[i] = Number(e.target.value)
                        set({ handicap })
                      }}
                      data-knob={`handicap-${i}`}
                    >
                      {[-3, -2, -1, 0, 1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n > 0 ? `+${n}` : n}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}
        </fieldset>
      )}
    </div>
  )
}

export default SettingsForm
