import React, { useState } from "react"
import { SOUND_EVENTS, SOUND_SCHEMES, previewSound } from "../../../utils/systemSounds"
import MoreOptions from "../../shared/MoreOptions"
import { summarize } from "../../../utils/disclosure"
import { Check, Choice, PropSheet, sheetButtons, useDraft } from "./Sheet"

// Sounds Properties: the system sounds (hear each event in the chosen scheme), whether they
// and the startup sound play, and the volume (the same as the taskbar's speaker)
const SoundsProps = ({ onClose }) => {
  const d = useDraft(["soundScheme", "systemSounds", "startupSound", "volume", "muted"])
  const { draft, update } = d
  const [event, setEvent] = useState(SOUND_EVENTS[0].id)

  const onKeyDown = (e) => {
    const at = SOUND_EVENTS.findIndex((s) => s.id === event)
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key]
    if (step) {
      e.preventDefault()
      setEvent(SOUND_EVENTS[Math.max(0, Math.min(SOUND_EVENTS.length - 1, at + step))].id)
    } else if (e.key === "Enter") previewSound(event, draft.soundScheme)
  }

  return (
    <PropSheet name="Sounds Properties" tabs={[{ id: "sounds", label: "Sounds" }]} tab="sounds" onTab={() => {}} {...sheetButtons(d, onClose)}>
      <fieldset>
        <legend>Volume</legend>
        <div className="cplRow">
          <span>Low</span>
          <input type="range" min="0" max="100" step="5" value={draft.volume} aria-label="Volume" onChange={(e) => update({ volume: Number(e.target.value) })} />
          <span>High</span>
        </div>
        <Check label="Mute" checked={draft.muted} onChange={(muted) => update({ muted })} />
        <Check label="Play system sounds" checked={draft.systemSounds} onChange={(systemSounds) => update({ systemSounds })} />
      </fieldset>
      {/* the scheme, each event's sound and the startup sound: More options (docs/simplicity.md) */}
      <MoreOptions id="sounds.events" label="Scheme and events" lessLabel="Hide scheme and events" summary={summarize(`Scheme: ${SOUND_SCHEMES.find((s) => s.id === draft.soundScheme)?.label || draft.soundScheme}`, draft.startupSound ? "Startup sound on" : "Startup sound off")}>
        <fieldset>
          <legend>Events</legend>
          <ul className="cplList cplSunken" role="listbox" aria-label="Events" tabIndex={0} style={{ height: 120 }} onKeyDown={onKeyDown}>
            {SOUND_EVENTS.map((s) => (
              <li key={s.id} role="option" aria-selected={event === s.id} className={event === s.id ? "is-selected" : ""} onClick={() => setEvent(s.id)} onDoubleClick={() => previewSound(s.id, draft.soundScheme)}>
                <img src="/assets/program_icons/cpl/sounds.svg" alt="" />
                {s.label}
              </li>
            ))}
          </ul>
          <div className="cplRow">
            <span>Preview:</span>
            <button type="button" aria-label="Play the sound" onClick={() => previewSound(event, draft.soundScheme)}>
              {"▶︎"} Play
            </button>
          </div>
          <Choice label="Scheme:" value={draft.soundScheme} options={SOUND_SCHEMES} onChange={(soundScheme) => update({ soundScheme })} />
          <Check label="Play the startup sound" checked={draft.startupSound} onChange={(startupSound) => update({ startupSound })} />
        </fieldset>
      </MoreOptions>
    </PropSheet>
  )
}

export default SoundsProps
