import { addDays, anchorOf, dateIn, daysBetween, ruleDates, zoneParts, zonedTime } from "./recur"
import { toICS } from "./ics"
import { LOCAL_ID, calendarById, colorOf, getCal } from "./store"

// Small helpers the Calendar's views and dialogs share.

// An occurrence's color: its label, else (TimeTree-style) the color of the member who added
// it, else its calendar's
export const colorFor = (occ, calendar = calendarById(occ.calendarId)) => {
  if (occ.label) return colorOf(occ.label)
  const author = calendar?.members?.find((m) => m.key === occ.event?.createdBy)
  if (author && calendar.members.length > 1) return colorOf(author.color)
  return colorOf(calendar?.color)
}

export const pad = (n) => String(n).padStart(2, "0")
export const hhmm = (t, zone) => {
  const p = zoneParts(t, zone)
  return `${pad(p.h)}:${pad(p.mi)}`
}

// A new event starting on `date` (at `hour`, or the next whole hour today)
export const blankEvent = ({ date, hour = null, allDay = false, zone, calendarId, kind = "event" }) => {
  if (kind === "memo") return { kind: "memo", title: "", notes: "", checklist: [], label: "", calendarId }
  if (allDay) return { kind: "event", title: "", allDay: true, start: date, end: date, tz: zone, location: "", notes: "", label: "", repeat: null, reminders: [0], attendees: [], todo: false, done: false, checklist: [], exceptions: {}, calendarId }
  let h = hour
  if (h === null) {
    const now = zoneParts(Date.now(), zone)
    h = now.date === date ? Math.min(23, now.h + 1) : 9
  }
  const start = zonedTime(date, h, 0, zone)
  return { kind: "event", title: "", allDay: false, start, end: start + 3_600_000, tz: zone, location: "", notes: "", label: "", repeat: null, reminders: [15], attendees: [], todo: false, done: false, checklist: [], exceptions: {}, calendarId }
}

// Save a file from the page (an .ics for the phone's calendar)
export const download = (name, text, type = "text/calendar") => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const safeName = (s) => String(s || "event").replace(/[^\w\- ]+/g, "").trim().slice(0, 40) || "event"

// one event as an .ics file: { name, data, mime } (Add to my phone, Share...)
export const eventFile = (event) => ({ name: `${safeName(event.title)}.ics`, data: toICS([event], { name: event.title, domain: "98ish.vercel.app", byName: (e) => e.createdByName && e.createdByName !== "You" ? e.createdByName : "" }), mime: "text/calendar" })

export const downloadEvent = (event) => {
  const file = eventFile(event)
  download(file.name, file.data)
}

export const downloadCalendar = (calendarId) => {
  const s = getCal()
  const calendar = calendarById(calendarId, s)
  download(`${safeName(calendar?.name || "calendar")}.ics`, toICS(s.events[calendarId] || [], { name: calendar?.name || "98ish Calendar", domain: "98ish.vercel.app", byName: (e) => e.createdByName && e.createdByName !== "You" ? e.createdByName : "" }))
}

// ---- recurring edits ----

// "This and following": the series stops the day before `key`; the rest becomes a new
// series starting at the edited occurrence. Returns { cut, rest } (rest has no id).
export const splitSeries = (event, key, edited) => {
  const first = anchorOf(event).date
  const rest = { ...edited }
  delete rest.id
  rest.exceptions = {}
  for (const [k, v] of Object.entries(event.exceptions || {})) if (k >= key) rest.exceptions[k] = v
  if (event.repeat?.count) {
    const before = ruleDates(first, event.repeat, first, addDays(key, -1)).length
    rest.repeat = rest.repeat ? { ...rest.repeat, count: Math.max(1, event.repeat.count - before), until: undefined } : null
  }
  // the new series' changed days only stay if its days didn't move
  const newFirst = edited.allDay ? edited.start : dateIn(edited.start, edited.tz)
  if (newFirst !== key) rest.exceptions = {}
  const cut = { ...event, repeat: { ...event.repeat, until: addDays(key, -1), count: undefined }, exceptions: Object.fromEntries(Object.entries(event.exceptions || {}).filter(([k]) => k < key)) }
  delete cut.repeat.count
  delete rest.repeat?.until
  return { cut, rest }
}

// "All events": edits made while looking at one occurrence move the whole series by the
// same amount (an hour later, a day later...)
export const shiftSeries = (event, occ, edited) => {
  const out = { ...edited }
  if (edited.allDay && event.allDay) {
    const delta = daysBetween(occ.start, edited.start)
    const span = daysBetween(edited.start, edited.end)
    out.start = addDays(event.start, delta)
    out.end = addDays(out.start, span)
    if (delta) out.exceptions = {}
  } else if (!edited.allDay && !event.allDay) {
    const delta = edited.start - occ.start
    out.start = event.start + delta
    out.end = out.start + (edited.end - edited.start)
    if (dateIn(out.start, edited.tz) !== dateIn(event.start, event.tz)) out.exceptions = {}
  } else {
    // switched between all-day and timed: start from this occurrence's day
    out.exceptions = {}
  }
  return out
}

export const isShared = (calendar) => !!calendar && calendar.id !== LOCAL_ID && calendar.members.length > 1
