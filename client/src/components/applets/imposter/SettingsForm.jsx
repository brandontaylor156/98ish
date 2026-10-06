import React, { useId } from "react"
import { DEFAULTS, MAX_PLAYERS, MIN_PLAYERS, PRESETS, presetSettings } from "./rules"
import { CATEGORIES, CATEGORY_IDS } from "./words"

// Every Imposter house rule: pass-and-play's More options (mode "local") and the online
// room's settings (mode "online": how many seats). Presets set many rules at once; each one
// can still be changed after.

const PRESET_TEXT = {
  classic: "1 imposter, 2 clue rounds, a vote",
  quick: "1 clue round, timers, 3 rounds",
  undercover: "The imposter gets a close word and doesn't know",
  chaos: "Maybe 0-3 imposters, guess any time",
}

const presetOf = (s) =>
  Object.keys(PRESETS).find((k) => {
    const want = presetSettings(k, s)
    return Object.keys(DEFAULTS).every((key) => key === "players" || key === "categories" || key === "custom" || key === "customOnly" || JSON.stringify(want[key]) === JSON.stringify(s[key]))
  }) || null

const Pick = ({ label, value, onChange, options, disabled, field }) => (
  <label className="ipField">
    <span>{label}</span>
    <select disabled={disabled} value={String(value)} onChange={(e) => onChange(e.target.value)} data-field={field}>
      {options.map(([v, text]) => (
        <option key={String(v)} value={String(v)}>
          {text}
        </option>
      ))}
    </select>
  </label>
)

const Check = ({ label, checked, onChange, disabled, field, hint }) => {
  const id = useId()
  return (
    <div className="ipCheck">
      <input type="checkbox" id={id} checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-field={field} />
      <label htmlFor={id}>
        {label}
        {hint && <small>{hint}</small>}
      </label>
    </div>
  )
}

const secs = (list, off = "Off") => list.map((v) => [v, v === 0 ? off : v < 60 ? `${v} seconds` : `${v / 60} minute${v === 60 ? "" : "s"}`])

const SettingsForm = ({ settings, onChange, disabled = false, mode = "local" }) => {
  const s = { ...DEFAULTS, ...settings }
  const set = (patch) => onChange({ ...s, ...patch })
  const num = (key) => (v) => set({ [key]: Number(v) })
  const preset = presetOf(s)
  const online = mode === "online"
  const allCats = s.categories.length === CATEGORY_IDS.length
  return (
    <div className={`ipSettings${disabled ? " is-disabled" : ""}`} data-settings>
      <div className="ipPresets" role="radiogroup" aria-label="Preset">
        {Object.entries(PRESETS).map(([k, p]) => (
          <button key={k} type="button" role="radio" aria-checked={preset === k} className={preset === k ? "is-on" : ""} disabled={disabled} data-preset={k} onClick={() => onChange(presetSettings(k, s))}>
            <b>{p.label}</b>
            <small>{PRESET_TEXT[k]}</small>
          </button>
        ))}
      </div>

      <fieldset>
        <legend>Imposters</legend>
        <div className="ipGrid">
          {online && (
            <Pick label="Seats" field="players" value={s.players} disabled={disabled} onChange={num("players")} options={Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => [i + MIN_PLAYERS, `${i + MIN_PLAYERS} players`])} />
          )}
          <Pick label={s.randomImposters ? "Up to" : "How many"} field="imposters" value={s.imposters} disabled={disabled} onChange={num("imposters")} options={[1, 2, 3, 4, 5, 6].map((n) => [n, `${n} imposter${n === 1 ? "" : "s"}`])} />
          <Pick label="Chance of none" field="zeroChance" value={s.zeroChance} disabled={disabled} onChange={num("zeroChance")} options={[[0, "Never"], [10, "10% of rounds"], [20, "20% of rounds"], [35, "35% of rounds"], [50, "50% of rounds"]]} />
        </div>
        <Check label="Random number each round" hint="From 1 up to the number above" field="randomImposters" checked={s.randomImposters} disabled={disabled} onChange={(v) => set({ randomImposters: v })} />
        <Check label="Imposters know each other" field="impostersKnow" checked={s.impostersKnow} disabled={disabled} onChange={(v) => set({ impostersKnow: v })} />
        <p className="ipMuted">At most (players − 1) ÷ 2 imposters, so the crew always outnumbers them.</p>
      </fieldset>

      <fieldset>
        <legend>What the imposter gets</legend>
        <div className="ipGrid">
          <Pick
            label="Imposter's card"
            field="imposterInfo"
            value={s.imposterInfo}
            disabled={disabled}
            onChange={(v) => set({ imposterInfo: v })}
            options={[
              ["none", "Nothing at all"],
              ["category", "The category"],
              ["hint", "Category + a hint"],
              ["decoy", "A close word (told they're the imposter)"],
              ["undercover", "A close word (not told!)"],
            ]}
          />
        </div>
        <Check label="Everyone sees the category" field="crewSeeCategory" checked={s.crewSeeCategory} disabled={disabled} onChange={(v) => set({ crewSeeCategory: v })} />
      </fieldset>

      <fieldset>
        <legend>Words</legend>
        <div className="ipCats">
          <button type="button" disabled={disabled} onClick={() => set({ categories: allCats ? [] : [...CATEGORY_IDS] })} data-allcats>
            {allCats ? "Clear all" : "Select all"}
          </button>
          {CATEGORY_IDS.map((id) => (
            <Check
              key={id}
              label={CATEGORIES[id].name}
              field={`cat-${id}`}
              checked={s.categories.includes(id)}
              disabled={disabled || s.customOnly}
              onChange={(v) => set({ categories: v ? [...s.categories, id] : s.categories.filter((c) => c !== id) })}
            />
          ))}
        </div>
        <label className="ipField ipCustom">
          <span>Your own words (one per line; "word:close word" adds the imposter's close word)</span>
          <textarea disabled={disabled} rows={3} value={s.custom} maxLength={1400} onChange={(e) => onChange({ ...s, custom: e.target.value })} placeholder={"Grandma's lasagna\nOur road trip:Camping trip"} data-field="custom" />
        </label>
        <Check label="Only use my words" field="customOnly" checked={s.customOnly} disabled={disabled || !s.custom.trim()} onChange={(v) => set({ customOnly: v })} />
      </fieldset>

      <fieldset>
        <legend>Clues and talking</legend>
        <div className="ipGrid">
          <Pick label="Clues" field="clueMode" value={s.clueMode} disabled={disabled} onChange={(v) => set({ clueMode: v })} options={[["spoken", "Said out loud"], ["typed", "Typed in"]]} />
          <Pick label="Clue rounds" field="clueRounds" value={s.clueRounds} disabled={disabled} onChange={num("clueRounds")} options={[1, 2, 3, 4, 5].map((n) => [n, `${n} round${n === 1 ? "" : "s"}`])} />
          <Pick label="Time per clue" field="clueTime" value={s.clueTime} disabled={disabled} onChange={num("clueTime")} options={secs([0, 10, 20, 30, 60])} />
          <Pick label="Discussion" field="discussTime" value={s.discussTime} disabled={disabled} onChange={num("discussTime")} options={[[-1, "None: vote right away"], [0, "Until everyone's ready"], ...secs([30, 60, 120, 180, 300]).map(([v, t]) => [v, t])]} />
          <Pick label="Who starts" field="starter" value={s.starter} disabled={disabled} onChange={(v) => set({ starter: v })} options={[["random", "Random"], ["rotate", "Takes turns"]]} />
        </div>
        <Check label="An imposter never goes first" field="imposterNotFirst" checked={s.imposterNotFirst} disabled={disabled} onChange={(v) => set({ imposterNotFirst: v })} />
      </fieldset>

      <fieldset>
        <legend>Voting</legend>
        <div className="ipGrid">
          <Pick
            label="Votes"
            field="voteStyle"
            value={s.voteStyle}
            disabled={disabled}
            onChange={(v) => set({ voteStyle: v })}
            options={[
              ["secret", online ? "Secret, shown together" : "Secret (pass the phone)"],
              ["open", "Open: seen as they come"],
              ["group", "Out loud: one shared pick"],
            ]}
          />
          <Pick label="Vote timer" field="voteTime" value={s.voteTime} disabled={disabled} onChange={num("voteTime")} options={secs([0, 15, 30, 60, 120])} />
          <Pick label="A tie" field="tieRule" value={s.tieRule} disabled={disabled} onChange={(v) => set({ tieRule: v })} options={[["revote", "Revote between them"], ["noone", "No one is out"], ["random", "One at random is out"], ["all", "All of them are out"]]} />
          <Pick label="Rounds of voting" field="voteMode" value={s.voteMode} disabled={disabled} onChange={(v) => set({ voteMode: v })} options={[["once", "One vote decides"], ["elimination", "Keep going until caught"]]} />
        </div>
        <Check label={'Allow "No one / skip"'} hint={s.zeroChance > 0 ? "Always on when a round may have no imposter" : null} field="allowSkip" checked={s.allowSkip || s.zeroChance > 0} disabled={disabled || s.zeroChance > 0} onChange={(v) => set({ allowSkip: v })} />
      </fieldset>

      <fieldset>
        <legend>The imposter's last chance</legend>
        <div className="ipGrid">
          <Pick label="Guess the word" field="guessWhen" value={s.guessWhen} disabled={disabled} onChange={(v) => set({ guessWhen: v })} options={[["caught", "When caught, to steal the win"], ["anytime", "Any time (wrong = lose)"], ["off", "Never"]]} />
          <Pick label="Guessing" field="guessStyle" value={s.guessStyle} disabled={disabled || s.guessWhen === "off"} onChange={(v) => set({ guessStyle: v })} options={[["choice", "Pick from 8 words"], ["type", "Type it in"]]} />
        </div>
      </fieldset>

      <fieldset>
        <legend>Scoring and length</legend>
        <div className="ipGrid">
          <Pick label="Game length" field="length" value={s.length} disabled={disabled} onChange={(v) => set({ length: v })} options={[["rounds", "A number of rounds"], ...(s.scoring ? [["score", "First to a score"]] : []), ["endless", "Until we stop"]]} />
          {s.length !== "endless" && (
            <Pick label={s.length === "score" ? "Points to win" : "Rounds"} field="lengthN" value={s.lengthN} disabled={disabled} onChange={num("lengthN")} options={[1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map((n) => [n, String(n)])} />
          )}
        </div>
        <Check label="Keep score" hint="Crew +1 for a win (+1 for voting an imposter); imposters +2 for escaping, +3 for naming the word" field="scoring" checked={s.scoring} disabled={disabled} onChange={(v) => set({ scoring: v, length: !v && s.length === "score" ? "rounds" : s.length })} />
        <Check label="Show who the imposters were" hint="Off: escaped imposters stay secret" field="revealRoles" checked={s.revealRoles} disabled={disabled} onChange={(v) => set({ revealRoles: v })} />
      </fieldset>
    </div>
  )
}

export default SettingsForm
