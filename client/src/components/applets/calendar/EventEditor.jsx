import React, { useMemo, useState } from "react"
import { REMINDER_CHOICES, WEEKDAYS, WEEKDAYS_SHORT, addDays, dateIn, daysBetween, describeReminder, describeRepeat, parseDate, weekdayOf, zonedTime } from "./recur"
import { COLOR_NAMES, LOCAL_ID, colorOf } from "./store"
import { hhmm } from "./util"
import Sheet from "./Sheet"
import CheckBox from "./CheckBox"

// New Event / Edit Event (and memos): a dialog on a computer, a sheet from the bottom on a
// phone. Times are typed in the event's own time zone (where it was planned).

const toTime = (s) => {
  const [h, m] = String(s || "0:0").split(":").map(Number)
  return { h: h || 0, m: m || 0 }
}

const REPEATS = [
  ["none", "Does not repeat"],
  ["daily", "Every day"],
  ["weekdays", "Every weekday (Mon-Fri)"],
  ["weekly", "Every week"],
  ["monthly", "Every month"],
  ["yearly", "Every year"],
  ["custom", "Custom..."],
]

const repeatChoice = (repeat) => {
  if (!repeat) return "none"
  if (repeat.interval > 1 || repeat.until || repeat.count) return "custom"
  if (repeat.freq === "weekly" && repeat.byDay?.join() === "1,2,3,4,5") return "weekdays"
  if (repeat.freq === "weekly" && repeat.byDay?.length > 1) return "custom"
  if (repeat.freq === "monthly" && repeat.monthly && repeat.monthly !== "day") return "custom"
  return repeat.freq
}

const EventEditor = ({ initial, calendars, zone: viewZone, mobile, isNew, scopeNote, lockDates, onSave, onCancel, busy, error }) => {
  const memo = initial.kind === "memo"
  const zone = initial.tz || viewZone
  const [title, setTitle] = useState(initial.title || "")
  const [calendarId, setCalendarId] = useState(initial.calendarId)
  const [allDay, setAllDay] = useState(!!initial.allDay)
  const startDate0 = memo ? "" : initial.allDay ? initial.start : dateIn(initial.start, zone)
  const endDate0 = memo ? "" : initial.allDay ? initial.end || initial.start : dateIn(initial.end ?? initial.start, zone)
  const [startDate, setStartDate] = useState(startDate0)
  const [endDate, setEndDate] = useState(endDate0)
  const [startTime, setStartTime] = useState(memo || initial.allDay ? "09:00" : hhmm(initial.start, zone))
  const [endTime, setEndTime] = useState(memo || initial.allDay ? "10:00" : hhmm(initial.end ?? initial.start, zone))
  const [repeat, setRepeat] = useState(initial.repeat || null)
  const [choice, setChoice] = useState(repeatChoice(initial.repeat))
  const [reminders, setReminders] = useState(initial.reminders || [])
  const [label, setLabel] = useState(initial.label || "")
  const [location, setLocation] = useState(initial.location || "")
  const [notes, setNotes] = useState(initial.notes || "")
  const [todo, setTodo] = useState(!!initial.todo)
  const [attendees, setAttendees] = useState(initial.attendees || [])
  const [checklist, setChecklist] = useState(initial.checklist || [])
  const [newItem, setNewItem] = useState("")
  const [problem, setProblem] = useState(null)

  const calendar = calendars.find((c) => c.id === calendarId) || calendars[0]
  const members = calendar?.members || []
  const labels = calendar?.labels || COLOR_NAMES.map((c) => ({ id: c, color: c, name: "" }))

  // keep the end after the start when the start moves
  const moveStartDate = (value) => {
    if (!value) return
    const span = startDate && endDate ? Math.max(0, daysBetween(startDate, endDate)) : 0
    setStartDate(value)
    setEndDate(addDays(value, span))
  }
  const moveStartTime = (value) => {
    const a = toTime(startTime)
    const b = toTime(endTime)
    const length = b.h * 60 + b.m - (a.h * 60 + a.m)
    const n = toTime(value)
    setStartTime(value)
    if (startDate === endDate && length >= 0) {
      const end = Math.min(23 * 60 + 59, n.h * 60 + n.m + length)
      setEndTime(`${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`)
    }
  }

  const pickRepeat = (value) => {
    setChoice(value)
    const wd = startDate ? weekdayOf(startDate) : 1
    if (value === "none") setRepeat(null)
    else if (value === "daily") setRepeat({ freq: "daily", interval: 1 })
    else if (value === "weekdays") setRepeat({ freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5] })
    else if (value === "weekly") setRepeat({ freq: "weekly", interval: 1, byDay: [wd] })
    else if (value === "monthly") setRepeat({ freq: "monthly", interval: 1, monthly: "day" })
    else if (value === "yearly") setRepeat({ freq: "yearly", interval: 1 })
    else setRepeat(repeat || { freq: "weekly", interval: 1, byDay: [wd] })
  }

  const ends = repeat?.until ? "until" : repeat?.count ? "count" : "never"
  const setEnds = (value) => {
    const { until, count, ...rest } = repeat
    if (value === "until") setRepeat({ ...rest, until: addDays(startDate, 30) })
    else if (value === "count") setRepeat({ ...rest, count: 10 })
    else setRepeat(rest)
  }

  const nth = startDate ? Math.ceil(parseDate(startDate).d / 7) : 1
  const ordinal = ["", "first", "second", "third", "fourth", "last"][Math.min(nth, 5)]

  const save = (e) => {
    e?.preventDefault()
    setProblem(null)
    const cleanTitle = title.trim()
    if (!cleanTitle) return setProblem("Give it a title.")
    const base = { ...initial, title: cleanTitle, label, notes, checklist: checklist.filter((c) => c.text.trim()), calendarId: calendar.id }
    if (memo) return onSave(base, calendar.id)
    if (!startDate) return setProblem("Pick a day.")
    let draft
    if (allDay) {
      const end = endDate && endDate >= startDate ? endDate : startDate
      draft = { ...base, allDay: true, start: startDate, end, tz: zone }
    } else {
      const a = toTime(startTime)
      const b = toTime(endTime)
      const start = zonedTime(startDate, a.h, a.m, zone)
      let end = zonedTime(endDate || startDate, b.h, b.m, zone)
      if (end < start) return setProblem("It has to end after it starts.")
      draft = { ...base, allDay: false, start, end, tz: zone }
    }
    Object.assign(draft, { location, repeat, reminders, todo, done: todo ? !!initial.done : false, attendees: attendees.filter((k) => members.some((m) => m.key === k)) })
    if (repeat?.until && repeat.until < startDate) return setProblem("It has to stop repeating after it starts.")
    onSave(draft, calendar.id)
  }

  const shared = calendar && calendar.id !== LOCAL_ID && members.length > 1
  const sameZone = zone === viewZone

  return (
    <Sheet
      title={memo ? (isNew ? "New Memo" : "Edit Memo") : isNew ? "New Event" : "Edit Event"}
      mobile={mobile}
      onClose={onCancel}
      className="calEditor"
      footer={
        <>
          <button type="submit" form="calEditorForm" className="calPrimary" disabled={busy}>
            {busy ? "Saving..." : "Save"}
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </>
      }
    >
      <form id="calEditorForm" className="calForm" onSubmit={save}>
        {scopeNote && <p className="calNote">{scopeNote}</p>}
        <label className="calField">
          <span>Title</span>
          <input type="text" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={memo ? "Gift ideas, packing list..." : "Dinner, dentist, movie night..."} autoFocus={!mobile} />
        </label>
        <label className="calField">
          <span>Calendar</span>
          <select value={calendar?.id} onChange={(e) => setCalendarId(e.target.value)} disabled={!isNew && calendars.length < 2}>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.members.length > 1 ? ` (shared with ${c.members.length - 1})` : ""}
              </option>
            ))}
          </select>
        </label>

        {!memo && (
          <>
            <fieldset className="calGroup">
              <legend>When</legend>
              <CheckBox checked={allDay} onChange={setAllDay}>
                All day
              </CheckBox>
              <div className="calWhen">
                <span>Starts</span>
                <input type="date" aria-label="Start date" value={startDate} onChange={(e) => moveStartDate(e.target.value)} />
                {!allDay && <input type="time" aria-label="Start time" value={startTime} step="300" onChange={(e) => moveStartTime(e.target.value)} />}
              </div>
              <div className="calWhen">
                <span>Ends</span>
                <input type="date" aria-label="End date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
                {!allDay && <input type="time" aria-label="End time" value={endTime} step="300" onChange={(e) => setEndTime(e.target.value)} />}
              </div>
              {!allDay && !sameZone && <p className="calNote">Times are in {zone.replace(/_/g, " ")}, where this was planned.</p>}
            </fieldset>

            {lockDates !== "repeat" && (
              <fieldset className="calGroup">
                <legend>Repeat</legend>
                <select aria-label="Repeat" value={choice} onChange={(e) => pickRepeat(e.target.value)}>
                  {REPEATS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {value === "weekly" && startDate ? `Every week on ${WEEKDAYS[weekdayOf(startDate)]}` : value === "monthly" && startDate ? `Every month on day ${parseDate(startDate).d}` : value === "yearly" && startDate ? `Every year on ${describeRepeat({ freq: "yearly", interval: 1 }, startDate).replace("Every year on ", "")}` : label}
                    </option>
                  ))}
                </select>
                {choice === "custom" && repeat && (
                  <div className="calCustom">
                    <div className="calWhen">
                      <span>Every</span>
                      <input type="number" aria-label="Repeat every" min="1" max="99" value={repeat.interval} onChange={(e) => setRepeat({ ...repeat, interval: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} />
                      <select aria-label="Repeat unit" value={repeat.freq} onChange={(e) => setRepeat({ freq: e.target.value, interval: repeat.interval, ...(e.target.value === "weekly" ? { byDay: [weekdayOf(startDate)] } : {}), ...(e.target.value === "monthly" ? { monthly: "day" } : {}), ...(repeat.until ? { until: repeat.until } : {}), ...(repeat.count ? { count: repeat.count } : {}) })}>
                        <option value="daily">day(s)</option>
                        <option value="weekly">week(s)</option>
                        <option value="monthly">month(s)</option>
                        <option value="yearly">year(s)</option>
                      </select>
                    </div>
                    {repeat.freq === "weekly" && (
                      <div className="calWeekdays" role="group" aria-label="On these days">
                        {WEEKDAYS_SHORT.map((d, i) => {
                          const on = (repeat.byDay || []).includes(i)
                          return (
                            <button key={d} type="button" aria-pressed={on} className={on ? "calOn" : ""} onClick={() => setRepeat({ ...repeat, byDay: on ? (repeat.byDay.length > 1 ? repeat.byDay.filter((x) => x !== i) : repeat.byDay) : [...(repeat.byDay || []), i].sort() })}>
                              {d.slice(0, 2)}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {repeat.freq === "monthly" && (
                      <select aria-label="Which day of the month" value={repeat.monthly || "day"} onChange={(e) => setRepeat({ ...repeat, monthly: e.target.value })}>
                        <option value="day">On day {parseDate(startDate)?.d}</option>
                        {nth <= 4 && <option value="weekday">On the {ordinal} {WEEKDAYS[weekdayOf(startDate)]}</option>}
                        <option value="lastWeekday">On the last {WEEKDAYS[weekdayOf(startDate)]}</option>
                      </select>
                    )}
                    <div className="calWhen">
                      <span>Ends</span>
                      <select aria-label="Ends" value={ends} onChange={(e) => setEnds(e.target.value)}>
                        <option value="never">Never</option>
                        <option value="until">On a date</option>
                        <option value="count">After a number of times</option>
                      </select>
                      {ends === "until" && <input type="date" aria-label="Last day" value={repeat.until} min={startDate} onChange={(e) => setRepeat({ ...repeat, until: e.target.value })} />}
                      {ends === "count" && <input type="number" aria-label="Times" min="1" max="999" value={repeat.count} onChange={(e) => setRepeat({ ...repeat, count: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })} />}
                    </div>
                    <p className="calNote">{describeRepeat(repeat, startDate)}</p>
                  </div>
                )}
              </fieldset>
            )}

            <fieldset className="calGroup">
              <legend>Reminders</legend>
              <ul className="calReminders">
                {reminders.map((m) => (
                  <li key={m}>
                    🔔 {describeReminder(m, allDay)}
                    <button type="button" aria-label={`Remove reminder ${describeReminder(m, allDay)}`} onClick={() => setReminders(reminders.filter((x) => x !== m))}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              {reminders.length < 5 && (
                <select
                  aria-label="Add a reminder"
                  value=""
                  onChange={(e) => {
                    const m = Number(e.target.value)
                    if (e.target.value !== "" && !reminders.includes(m)) setReminders([...reminders, m].sort((a, b) => a - b))
                  }}
                >
                  <option value="">Add a reminder...</option>
                  {REMINDER_CHOICES.filter((m) => !reminders.includes(m) && (!allDay || m === 0 || m % 1440 === 0)).map((m) => (
                    <option key={m} value={m}>
                      {describeReminder(m, allDay)}
                    </option>
                  ))}
                </select>
              )}
            </fieldset>
          </>
        )}

        <fieldset className="calGroup">
          <legend>Color</legend>
          <div className="calSwatches" role="radiogroup" aria-label="Color">
            <button type="button" role="radio" aria-checked={!label} className={`calSwatch calSwatchAuto${!label ? " calOn" : ""}`} title={shared ? "The color of whoever added it" : "The calendar's color"} onClick={() => setLabel("")}>
              Auto
            </button>
            {labels.map((l) => (
              <button key={l.id} type="button" role="radio" aria-checked={label === l.id} aria-label={l.name || l.color} title={l.name || l.color} className={`calSwatch${label === l.id ? " calOn" : ""}`} style={{ background: colorOf(l.color) }} onClick={() => setLabel(l.id)}>
                {l.name ? <span className="calSwatchName">{l.name}</span> : null}
              </button>
            ))}
          </div>
        </fieldset>

        {!memo && (
          <label className="calField">
            <span>Place</span>
            <input type="text" value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} placeholder="Where?" />
          </label>
        )}
        <label className="calField calFieldTall">
          <span>Notes</span>
          <textarea value={notes} maxLength={4000} rows={mobile ? 3 : 3} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <fieldset className="calGroup">
          <legend>{memo ? "Checklist" : "Checklist (optional)"}</legend>
          {checklist.map((item, i) => (
            <div key={i} className="calCheckItem">
              <CheckBox label={`Done: ${item.text}`} checked={item.done} onChange={(done) => setChecklist(checklist.map((c, j) => (j === i ? { ...c, done } : c)))} />
              <input type="text" aria-label="Checklist item" value={item.text} maxLength={200} onChange={(e) => setChecklist(checklist.map((c, j) => (j === i ? { ...c, text: e.target.value } : c)))} />
              <button type="button" aria-label="Remove item" onClick={() => setChecklist(checklist.filter((c, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          {checklist.length < 50 && (
            <div className="calCheckItem">
              <input
                type="text"
                aria-label="New checklist item"
                value={newItem}
                maxLength={200}
                placeholder="Add an item"
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    if (newItem.trim()) setChecklist([...checklist, { text: newItem.trim(), done: false }])
                    setNewItem("")
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (newItem.trim()) setChecklist([...checklist, { text: newItem.trim(), done: false }])
                  setNewItem("")
                }}
              >
                Add
              </button>
            </div>
          )}
        </fieldset>

        {!memo && (
          <CheckBox checked={todo} onChange={setTodo}>
            It's a to-do (tick it off when it's done)
          </CheckBox>
        )}

        {!memo && shared && (
          <fieldset className="calGroup">
            <legend>Who's going</legend>
            <p className="calNote">Pick people and only they get its reminders. Pick nobody and everyone does.</p>
            <div className="calPeople">
              {members.map((m) => (
                <CheckBox key={m.key} className="calPerson" style={{ "--chip": colorOf(m.color) }} checked={attendees.includes(m.key)} onChange={(on) => setAttendees(on ? [...attendees, m.key] : attendees.filter((k) => k !== m.key))}>
                  {m.name}
                </CheckBox>
              ))}
            </div>
          </fieldset>
        )}
        {(problem || error) && <p className="calError" role="alert">{problem || error}</p>}
      </form>
    </Sheet>
  )
}

export default EventEditor
