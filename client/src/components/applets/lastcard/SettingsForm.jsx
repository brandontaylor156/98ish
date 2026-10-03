import React, { useId } from "react"
import { DEFAULTS, describeRules } from "./cards"

// The house rules form: Create Room and the lobby (mode "online": how many seats) and games
// against the computer (mode "solo": how many computer opponents). Presets set several
// rules at once; every checkbox can still be changed after.

export const PRESETS = {
  classic: { label: "Classic", text: "The rules on the box", settings: { stacking: false, sevenO: false, jumpIn: false, drawUntil: false, forcePlay: false, challenge: true, extras: false } },
  party: { label: "Party", text: "Stacking, jump-in, 7-0", settings: { stacking: true, sevenO: true, jumpIn: true, drawUntil: false, forcePlay: false, challenge: true, extras: false } },
  mayhem: { label: "Mayhem", text: "Everything on, extra cards", settings: { stacking: true, sevenO: true, jumpIn: true, drawUntil: true, forcePlay: true, challenge: true, extras: true } },
  quick: { label: "Quick", text: "One round, 5 cards each", settings: { target: 0, handSize: 5 } },
}

const RULES = [
  ["stacking", "Stacking", "Draw Two on a Draw Two (a Draw Four on either) passes the pile on."],
  ["sevenO", "7-0", "A 7 swaps hands with someone you pick; a 0 passes every hand along."],
  ["jumpIn", "Jump-in", "Got the very same card? Play it out of turn."],
  ["drawUntil", "Draw until you can play", "Keep drawing until a card fits (instead of one)."],
  ["forcePlay", "Forced play", "A drawn card that fits must be played."],
  ["challenge", "Challenge Draw Fours", "Think it's a bluff? Challenge it: the loser draws."],
  ["extras", "Extra cards", "Adds Skip All, Discard All and Wild Draw Six."],
]

const presetOf = (s) =>
  Object.keys(PRESETS).find((k) => Object.entries(PRESETS[k].settings).every(([key, v]) => s[key] === v) && (k === "quick" || (s.target !== 0 && s.handSize === 7))) || null

const Row = ({ label, children }) => (
  <label className="lcField">
    <span>{label}</span>
    {children}
  </label>
)

const SettingsForm = ({ settings, onChange, disabled = false, mode = "online" }) => {
  const s = { ...DEFAULTS, ...settings }
  const set = (patch) => onChange({ ...s, ...patch })
  const preset = presetOf(s)
  const solo = mode === "solo"
  const uid = useId()
  return (
    <div className={`lcSettings${disabled ? " is-disabled" : ""}`} data-settings>
      <div className="lcPresets" role="radiogroup" aria-label="House rules preset">
        {Object.entries(PRESETS).map(([k, p]) => (
          <button key={k} type="button" role="radio" aria-checked={preset === k} className={preset === k ? "is-on" : ""} disabled={disabled} data-preset={k} onClick={() => set({ ...(k === "quick" ? {} : { target: s.target || 500, handSize: 7 }), ...p.settings })}>
            <b>{p.label}</b>
            <small>{p.text}</small>
          </button>
        ))}
      </div>
      <div className="lcFields">
        <Row label={solo ? "Opponents" : "Players"}>
          <select disabled={disabled} value={solo ? s.players - 1 : s.players} onChange={(e) => set({ players: Number(e.target.value) + (solo ? 1 : 0) })} data-field="players">
            {(solo ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [2, 3, 4, 5, 6, 7, 8, 9, 10]).map((k) => (
              <option key={k} value={k}>
                {solo ? `${k} computer${k === 1 ? "" : "s"}` : `${k} seats`}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Cards each">
          <select disabled={disabled} value={s.handSize} onChange={(e) => set({ handSize: Number(e.target.value) })} data-field="handSize">
            {[5, 6, 7, 8, 9, 10].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Play to">
          <select disabled={disabled} value={s.target} onChange={(e) => set({ target: Number(e.target.value) })} data-field="target">
            <option value={0}>One round</option>
            <option value={250}>250 points</option>
            <option value={500}>500 points</option>
          </select>
        </Row>
        <Row label="Turn timer">
          <select disabled={disabled} value={s.timer} onChange={(e) => set({ timer: Number(e.target.value) })} data-field="timer">
            <option value={0}>Off</option>
            <option value={15}>15 seconds</option>
            <option value={30}>30 seconds</option>
            <option value={60}>60 seconds</option>
          </select>
        </Row>
        <Row label="Decks">
          <select disabled={disabled} value={s.decks} onChange={(e) => set({ decks: Number(e.target.value) })} data-field="decks">
            <option value={0}>Auto (enough for the table)</option>
            <option value={1}>1 deck</option>
            <option value={2}>2 decks</option>
            <option value={3}>3 decks</option>
          </select>
        </Row>
        <Row label="Computer players">
          <select disabled={disabled} value={s.bots} onChange={(e) => set({ bots: e.target.value })} data-field="bots">
            <option value="easy">Easy</option>
            <option value="normal">Normal</option>
            <option value="hard">Hard</option>
          </select>
        </Row>
      </div>
      <fieldset className="lcRules">
        <legend>House rules</legend>
        <div className="lcRulesGrid">
        {RULES.map(([key, label, text]) => (
          <div key={key} className="lcRule">
            <input type="checkbox" id={`${uid}-${key}`} disabled={disabled} checked={!!s[key]} onChange={(e) => set({ [key]: e.target.checked })} data-rule={key} />
            <label htmlFor={`${uid}-${key}`} data-rule-label={key}>
              <b>{label}</b>
              <small>{text}</small>
            </label>
          </div>
        ))}
        </div>
      </fieldset>
      <p className="lcMuted lcSummary">{describeRules(s)}{s.timer ? ` · ${s.timer}s turns` : ""}{s.target ? ` · to ${s.target}` : " · one round"}</p>
    </div>
  )
}

export default SettingsForm
