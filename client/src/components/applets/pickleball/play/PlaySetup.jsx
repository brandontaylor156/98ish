import React from "react"
import Combo from "../../../shared/select/Combo"
import MoreOptions from "../../../shared/MoreOptions"
import { listClones } from "../twin/clone/store.js"
import { CHARACTERS, OUTFITS, characterById } from "../looks.js"
import { LEVELS } from "../ai.js"
import { LEVEL_NAMES } from "../menus.jsx"
import { TIMES, nightOk, timeAt } from "../park/timeofday.js"
import { placeLists, placeNote, placeText } from "./places.js"
import "./play.css"

// Pickleball 98's "Play" (the owner: "it's confusing that the 'Start game' button is there but
// there are other options below for playing online. Bad UI"):
//   1. the first choice: vs Computer or Online (two tabs at the top)
//   2. each path shows only its own options: vs Computer = format, level, where & when; the rest
//      under More options (who exactly, scoring, World Tour, 2 Players). Online is the Play
//      Online screen (shared/online) under the same two tabs.
//   3. the one primary button sits at the bottom, always in view (390x844 included)

const Radio = ({ name, value, options, onChange }) => (
  <div className="pkRadios" role="radiogroup" aria-label={name}>
    {options.map(([v, label]) => (
      <label key={String(v)} className={`pkRadio${value === v ? " is-on" : ""}`}>
        <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
        <span>{label}</span>
      </label>
    ))}
  </div>
)

// a small face for "You" (the menus' portrait, drawn the same way)
const Face = ({ c, outfit }) => {
  const look = c.look
  const shirt = OUTFITS.find((o) => o.id === outfit)?.shirt || look.shirt
  return (
    <span className="pkFace" aria-hidden="true" style={{ "--skin": ["#f6d3b3", "#eab98f", "#d39a6a", "#b5784a", "#8c5734", "#5f3a22"][look.skin] || "#d39a6a", "--hair": look.hairColor, "--shirt": shirt, "--hat": look.hat === "none" ? "transparent" : look.hatColor }}>
      <span className="pkFaceShirt" />
      <span className="pkFaceHead" />
      <span className={`pkFaceHair pkFaceHair--${look.hair}`} />
      {look.hat !== "none" && <span className={`pkFaceHat pkFaceHat--${look.hat}`} />}
    </span>
  )
}

// vs Computer | Online: the first choice, on both screens
export const PlayTabs = ({ tab, onTab }) => (
  <div className="pkPlayTabs" role="tablist" aria-label="How do you want to play?">
    {[
      ["cpu", "vs Computer", "Right now, on this device"],
      ["online", "Online", "With friends or anyone"],
    ].map(([id, label, sub]) => (
      <button key={id} type="button" role="tab" aria-selected={tab === id} className={`pkPlayTab${tab === id ? " is-on" : ""}`} data-play-tab={id} onClick={() => tab !== id && onTab(id)}>
        <b>{label}</b>
        <small>{sub}</small>
      </button>
    ))}
  </div>
)

// "Where & when: Newport Beach Club · Golden hour  [Change]" (opens the venue sheet)
export const WhereRow = ({ place, tod, onChange, label = "Where" }) => (
  <div className="pkField pkWhere" data-where={place?.id || ""}>
    <span>{label}</span>
    <button type="button" className="pkWhereBtn" onClick={onChange} data-action="where">
      <b>{placeText(place, tod)}</b>
      <small>Change</small>
    </button>
  </div>
)

// ---------- vs Computer ----------
export const PlaySetup = ({ prefs, setPrefs, place, onWhere, onStart, onBack, onPlayers, onTab, onTour, onVersus }) => {
  const me = characterById(prefs.character)
  const clones = listClones().map((c) => [`clone:${c.id}`, `Clone: ${c.name}`])
  const pickers = [["random", "Random"], ...clones, ...CHARACTERS.filter((c) => !c.boss && c.id !== prefs.character).map((c) => [c.id, c.nick])]
  const nameOf = (id) => pickers.find(([v]) => v === id)?.[1] || "Random"
  const summary = [`vs ${nameOf(prefs.opponent)}`, prefs.scoring === "rally" ? "Rally" : "Side-out", `to ${prefs.target}`].join(" · ")
  return (
    <div className="pkPanel2 window is-wide pkPlay" data-play="cpu">
      <div className="title-bar">
        <div className="title-bar-text">Play</div>
        <div className="title-bar-controls">
          <button aria-label="Close" onClick={onBack} />
        </div>
      </div>
      <div className="window-body pkPanelBody pkPlayBody">
        <PlayTabs tab="cpu" onTab={onTab} />
        <div className="pkForm">
          <div className="pkField">
            <span>You</span>
            <button type="button" className="pkWho" onClick={onPlayers}>
              <Face c={me} outfit={prefs.outfit} /> {me.name} <small>(change)</small>
            </button>
          </div>
          <div className="pkField">
            <span>Format</span>
            <Radio name="Format" value={prefs.doubles} options={[[false, "Singles"], [true, "Doubles"]]} onChange={(v) => setPrefs({ doubles: v })} />
          </div>
          <div className="pkField">
            <span>Opponents</span>
            <Radio name="Opponents" value={prefs.level} options={Object.keys(LEVELS).map((k) => [k, LEVEL_NAMES[k]])} onChange={(v) => setPrefs({ level: v })} />
          </div>
          <WhereRow place={place} tod={prefs.tod} onChange={onWhere} />
        </div>
        <MoreOptions id="pickleball.play" summary={summary} className="pkPlayMore">
          <div className="pkForm">
            <div className="pkField">
              <span>Against</span>
              <Combo value={prefs.opponent} options={pickers} onChange={(v) => setPrefs({ opponent: v })} ariaLabel="Opponent" name="opponent" />
            </div>
            {prefs.doubles && (
              <div className="pkField">
                <span>Partner</span>
                <Combo value={prefs.partner} options={pickers} onChange={(v) => setPrefs({ partner: v })} ariaLabel="Partner" name="partner" />
              </div>
            )}
            <div className="pkField">
              <span>Scoring</span>
              <Radio name="Scoring" value={prefs.scoring} options={[["sideout", "Side-out"], ["rally", "Rally"]]} onChange={(v) => setPrefs({ scoring: v })} />
            </div>
            <div className="pkField">
              <span>Game to</span>
              <Radio name="Game to" value={prefs.target} options={[[7, "7"], [11, "11"], [15, "15"], [21, "21"]]} onChange={(v) => setPrefs({ target: v })} />
            </div>
            <div className="pkField">
              <span>Also</span>
              <button type="button" onClick={onTour} data-menu="tour">
                World Tour...
              </button>
              <button type="button" onClick={onVersus} data-menu="versus">
                2 Players (one device)...
              </button>
            </div>
          </div>
        </MoreOptions>
      </div>
      <div className="pkPlayGo">
        <button type="button" className="pkPrimary pkGo" onClick={onStart} data-action="start" autoFocus>
          Start Match
        </button>
      </div>
    </div>
  )
}

// ---------- where & when: a sheet at the bottom, the court behind it previews each venue ----------
// (the panel it came from is hidden meanwhile, so the 3D venue shows above)
// locked: arenas the World Tour hasn't opened yet
export const VenueSheet = ({ prefs, current, tod, loading = null, error = null, locked = [], onPick, onTime, onDone, title = "Where & when" }) => {
  const { real, finder, arenas } = placeLists(prefs)
  const night = current?.kind === "arena" ? false : nightOk(current)
  const shown = timeAt(tod, current)
  const Row = ({ p }) => (
    <li>
      <button type="button" className={`pkVenueRow${p.id === current?.id ? " is-on" : ""}`} aria-pressed={p.id === current?.id} disabled={locked.includes(p.id)} onClick={() => onPick(p)} data-place={p.id}>
        <b>{p.short}</b>
        <small>{locked.includes(p.id) ? "Unlock it on the World Tour" : placeNote(p)}</small>
        {loading === p.id && <small className="pkVenueLoading">Loading the venue...</small>}
      </button>
    </li>
  )
  return (
    <div className="pkVenueSheet window" role="dialog" aria-label={title} data-venue-sheet>
      <div className="title-bar">
        <div className="title-bar-text">{title}</div>
        <div className="title-bar-controls">
          <button aria-label="Close" onClick={onDone} />
        </div>
      </div>
      <div className="window-body pkVenueBody">
        <div className="pkVenueNow" aria-live="polite">
          <b>{current?.name}</b>
          {loading ? <small>Loading the venue...</small> : <small>{error || "The court behind this is where you'll play."}</small>}
        </div>
        {current?.kind === "arena" ? (
          <p className="pkVenueTimeNote">{current.short} always plays at its own time: {current.time}.</p>
        ) : (
          <div className="pkVenueTimes" role="radiogroup" aria-label="Time of day">
            {TIMES.map((t) => {
              const off = t.id === "night" && !night
              return (
                <button key={t.id} type="button" role="radio" aria-checked={shown === t.id} disabled={off} title={off ? "No court lights here, so no night games" : t.hint || t.label} className={`pkTimeChip${shown === t.id ? " is-on" : ""}`} onClick={() => onTime(t.id)} data-time={t.id}>
                  {t.label}
                </button>
              )
            })}
          </div>
        )}
        {current && current.kind !== "arena" && !night && <p className="pkVenueTimeNote">No court lights here: no night games.</p>}
        <div className="pkVenueLists">
          <h4>Real courts</h4>
          <ul>
            {real.map((p) => (
              <Row key={p.id} p={p} />
            ))}
          </ul>
          {finder.length > 0 && (
            <>
              <h4>From Venue Finder</h4>
              <ul>
                {finder.map((p) => (
                  <Row key={p.id} p={p} />
                ))}
              </ul>
            </>
          )}
          <h4>Arenas</h4>
          <ul>
            {arenas.map((p) => (
              <Row key={p.id} p={p} />
            ))}
          </ul>
        </div>
      </div>
      <div className="pkPlayGo">
        <button type="button" className="pkPrimary pkGo" onClick={onDone} data-action="where-done">
          Done
        </button>
      </div>
    </div>
  )
}
