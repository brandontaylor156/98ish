import React, { useState } from "react"
import Dialog from "../shared/Dialog"
import MoreOptions from "../shared/MoreOptions"
import { summarize } from "../../utils/disclosure"
import { setDnd, turnOffDnd, turnOnDnd, useDnd } from "../../utils/dnd"
import { daysLabel } from "../../utils/dndCore"
import { usePushSession } from "../../utils/push"
import { MoonIcon, dndUntilText } from "./DndTray"

// Do Not Disturb's settings (the moon's Settings..., the Notification Center, Control Panel,
// Start search): the switch with how long, then under More options the schedule, who can
// still call, calendar reminders, and 98 Messenger's Away status.

const DAYS = [
  [0, "S", "Sunday"],
  [1, "M", "Monday"],
  [2, "T", "Tuesday"],
  [3, "W", "Wednesday"],
  [4, "T", "Thursday"],
  [5, "F", "Friday"],
  [6, "S", "Saturday"],
]
const CALLS = [
  ["favorites", "Favorites (starred in the Address Book)"],
  ["everyone", "Everyone"],
  ["none", "No one"],
]

const DndSettings = ({ onClose }) => {
  const dnd = useDnd()
  const session = usePushSession()
  const initialMode = !dnd.active ? "off" : dnd.reason === "manual" && !dnd.state.until ? "forever" : "keep"
  const [mode, setMode] = useState(initialMode)
  const [draft, setDraft] = useState(() => ({ schedule: { ...dnd.state.schedule }, calls: dnd.state.calls, reminders: dnd.state.reminders, away: dnd.state.away }))
  const change = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const changeSchedule = (patch) => setDraft((d) => ({ ...d, schedule: { ...d.schedule, ...patch } }))
  const toggleDay = (day) => changeSchedule({ days: draft.schedule.days.includes(day) ? draft.schedule.days.filter((d) => d !== day) : [...draft.schedule.days, day].sort() })

  const save = () => {
    setDnd(draft)
    if (mode !== initialMode) {
      if (mode === "off") turnOffDnd()
      else if (mode === "hour") turnOnDnd("hour")
      else if (mode === "morning") turnOnDnd("morning")
      else if (mode === "forever") turnOnDnd("off")
    }
    onClose()
  }

  const s = draft.schedule
  const favorites = dnd.state.favorites.length
  const summary = summarize(
    s.on ? `Every ${daysLabel(s.days) === "Every day" ? "day" : daysLabel(s.days)} ${s.from} to ${s.to}` : "No schedule",
    draft.calls === "everyone" ? "Calls from everyone" : draft.calls === "none" ? "No calls" : "Calls from favorites",
    draft.reminders ? "Reminders come through" : "Reminders wait",
    draft.away ? "Away in Messenger" : ""
  )
  const choices = [
    ...(initialMode === "keep" ? [["keep", dndUntilText(dnd)]] : []),
    ["off", "Off"],
    ["hour", "On for 1 hour"],
    ["morning", "On until tomorrow morning"],
    ["forever", "On until I turn it off"],
  ]

  return (
    <Dialog title="Do Not Disturb" onOk={save} onCancel={onClose}>
      <div className="dndSettings">
        <div className="dndHead">
          <MoonIcon on={dnd.active} size={32} />
          <p className="dialogText">
            Pop-ups and sounds wait while it's on. Everything still goes in the Notification Center, and games keep their sounds. Your own alarms still ring.
          </p>
        </div>
        <fieldset>
          <legend>Do Not Disturb</legend>
          {choices.map(([id, label]) => (
            <div className="field-row" key={id}>
              <input id={`dnd-${id}`} type="radio" name="dnd-mode" checked={mode === id} onChange={() => setMode(id)} />
              <label htmlFor={`dnd-${id}`}>{label}</label>
            </div>
          ))}
        </fieldset>
        <MoreOptions id="dnd.settings" className="dndMore" summary={summary}>
          <fieldset>
            <legend>Schedule</legend>
            <div className="field-row">
              <input id="dnd-sched" type="checkbox" checked={s.on} onChange={(e) => changeSchedule({ on: e.target.checked })} />
              <label htmlFor="dnd-sched">Turn on by itself</label>
            </div>
            <div className="field-row dndTimes">
              <label htmlFor="dnd-from">From</label>
              <input id="dnd-from" type="time" value={s.from} disabled={!s.on} onChange={(e) => e.target.value && changeSchedule({ from: e.target.value })} />
              <label htmlFor="dnd-to">to</label>
              <input id="dnd-to" type="time" value={s.to} disabled={!s.on} onChange={(e) => e.target.value && changeSchedule({ to: e.target.value })} />
            </div>
            <div className="dndDays" role="group" aria-label="Days">
              {DAYS.map(([day, letter, name]) => (
                <button key={day} type="button" title={name} aria-label={name} aria-pressed={s.days.includes(day)} disabled={!s.on} onClick={() => toggleDay(day)}>
                  {letter}
                </button>
              ))}
            </div>
            <p className="dialogText dndHint">A night schedule (22:00 to 07:00) runs into the next morning.</p>
          </fieldset>
          <fieldset>
            <legend>Still let through</legend>
            <div className="field-row dndCalls">
              <label htmlFor="dnd-calls">Calls from:</label>
              <select id="dnd-calls" value={draft.calls} onChange={(e) => change({ calls: e.target.value })}>
                {CALLS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {draft.calls === "favorites" && (
              <p className="dialogText dndHint">
                {favorites ? `${favorites} favorite${favorites === 1 ? "" : "s"} with a screen name.` : "No favorites yet."} Star someone in the Address Book to let their calls ring.
              </p>
            )}
            <div className="field-row">
              <input id="dnd-rem" type="checkbox" checked={draft.reminders} onChange={(e) => change({ reminders: e.target.checked })} />
              <label htmlFor="dnd-rem">Calendar reminders</label>
            </div>
          </fieldset>
          <div className="field-row">
            <input id="dnd-away" type="checkbox" checked={draft.away} onChange={(e) => change({ away: e.target.checked })} />
            <label htmlFor="dnd-away">Set my 98 Messenger status to Away while it's on</label>
          </div>
          <p className="dialogText dndHint">{session ? "Your phone's notifications follow it too: they wait until it's over." : "Sign on to 98 Messenger to have your phone's notifications and calls follow it too."}</p>
        </MoreOptions>
      </div>
    </Dialog>
  )
}

export default DndSettings
