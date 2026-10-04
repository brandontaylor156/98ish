// Checks for everything 98ish Calendar is sent. Text is plain text (the client draws it as
// text, never HTML). Shapes match client/src/components/applets/calendar/recur.js.

const v = require("../couples/validate")

const COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "navy", "purple", "pink", "brown", "gray"]
const FREQS = ["daily", "weekly", "monthly", "yearly"]
const MONTHLY = ["day", "weekday", "lastWeekday"]
const REMINDERS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080]
const MIN_TIME = Date.UTC(1970, 0, 1)
const MAX_TIME = Date.UTC(2100, 0, 1)
const DAY = 86_400_000
const MAX_EXCEPTIONS = 400
const MAX_CHECKLIST = 50

const validZone = (zone) => {
  if (typeof zone !== "string" || !zone || zone.length > 64) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone })
    return true
  } catch {
    return false
  }
}

const date = (value, label) => v.date(value, { label })
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY)

const time = (value, label) => {
  const t = Number(value)
  if (!Number.isFinite(t) || t < MIN_TIME || t > MAX_TIME) v.fail(`${label} isn't a time 98ish Calendar understands.`)
  return Math.round(t / 1000) * 1000
}

const color = (value, fallback = "") => (value === undefined || value === null || value === "" ? fallback : v.pick(value, COLORS, undefined, "That color"))

const reminders = (value) => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 5) v.fail("An event can have at most 5 reminders.")
  return [...new Set(value.map((m) => (REMINDERS.includes(Number(m)) ? Number(m) : v.fail("That reminder isn't one of the choices."))))].sort((a, b) => a - b)
}

const checklist = (value) => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_CHECKLIST) v.fail(`A checklist can have at most ${MAX_CHECKLIST} items.`)
  return value
    .map((item) => ({ text: v.text(item?.text, { max: 200, label: "A checklist item", lines: false }), done: item?.done === true }))
    .filter((item) => item.text)
}

const repeat = (value, start) => {
  if (value === undefined || value === null || value === false) return null
  if (typeof value !== "object") v.fail("That repeat isn't one of the choices.")
  const freq = v.pick(value.freq, FREQS, undefined, "How often it repeats")
  const interval = Number(value.interval ?? 1)
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) v.fail("Repeat every 1 to 99.")
  const out = { freq, interval }
  if (freq === "weekly" && value.byDay !== undefined && value.byDay !== null) {
    if (!Array.isArray(value.byDay) || value.byDay.length > 7 || value.byDay.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) v.fail("Pick days of the week.")
    if (value.byDay.length) out.byDay = [...new Set(value.byDay)].sort()
  }
  if (freq === "monthly") out.monthly = v.pick(value.monthly, MONTHLY, "day", "Which day of the month")
  if (value.until) {
    out.until = date(value.until, "The last day")
    if (out.until < start) v.fail("It has to stop repeating after it starts.")
  } else if (value.count !== undefined && value.count !== null && value.count !== "") {
    const count = Number(value.count)
    if (!Number.isInteger(count) || count < 1 || count > 999) v.fail("Repeat 1 to 999 times.")
    out.count = count
  }
  return out
}

// keys of the calendar's members that may be attendees
const attendees = (value, memberKeys) => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 50) v.fail("Too many people.")
  return [...new Set(value.map(String))].filter((k) => memberKeys.includes(k))
}

// One occurrence's changes ("just this one"): { deleted } or a few fields
const change = (value, allDay) => {
  if (!value || typeof value !== "object") v.fail("That change is empty.")
  if (value.deleted === true) return { deleted: true }
  const out = {}
  if (value.title !== undefined) out.title = v.text(value.title, { max: 120, min: 1, label: "The title", lines: false })
  if (value.location !== undefined) out.location = v.text(value.location, { max: 200, label: "The place", lines: false })
  if (value.notes !== undefined) out.notes = v.text(value.notes, { max: 4000, label: "The notes" })
  if (value.label !== undefined) out.label = color(value.label)
  if (value.done !== undefined) out.done = value.done === true
  if (value.reminders !== undefined) out.reminders = reminders(value.reminders)
  if (value.checklist !== undefined) out.checklist = checklist(value.checklist)
  if (value.start !== undefined && value.start !== null) {
    if (allDay) {
      out.start = date(value.start, "The day")
      out.end = value.end ? date(value.end, "The last day") : out.start
      if (out.end < out.start || days(out.start, out.end) > 366) v.fail("The last day has to be after the first.")
    } else {
      out.start = time(value.start, "The start")
      out.end = value.end === undefined || value.end === null ? out.start : time(value.end, "The end")
      if (out.end < out.start || out.end - out.start > 31 * DAY) v.fail("It has to end after it starts.")
    }
  }
  return out
}

// A whole event (or memo) from the client -> what's stored (without ids and authors)
const event = (input, { memberKeys = [] } = {}) => {
  if (!input || typeof input !== "object") v.fail("That event is empty.")
  const kind = input.kind === "memo" ? "memo" : "event"
  const out = {
    kind,
    title: v.text(input.title, { max: 120, min: 1, label: "The title", lines: false }),
    location: v.text(input.location, { max: 200, label: "The place", lines: false }),
    notes: v.text(input.notes, { max: 4000, label: "The notes" }),
    label: color(input.label),
    checklist: checklist(input.checklist),
    todo: input.todo === true,
    done: input.done === true,
    attendees: attendees(input.attendees, memberKeys),
  }
  if (kind === "memo") return { ...out, allDay: false, start: null, end: null, tz: null, repeat: null, exceptions: {}, reminders: [] }
  out.allDay = input.allDay === true
  if (out.allDay) {
    out.start = date(input.start, "The day")
    out.end = input.end ? date(input.end, "The last day") : out.start
    if (out.end < out.start || days(out.start, out.end) > 366) v.fail("The last day has to be on or after the first.")
    out.tz = null
  } else {
    out.start = time(input.start, "The start")
    out.end = input.end === undefined || input.end === null ? out.start : time(input.end, "The end")
    if (out.end < out.start) v.fail("It has to end after it starts.")
    if (out.end - out.start > 31 * DAY) v.fail("An event can be at most 31 days long.")
    if (!validZone(input.tz)) v.fail("That time zone isn't one 98ish Calendar knows.")
    out.tz = input.tz
  }
  // (a timed event's own date depends on its zone: a day of slack either way)
  const firstDate = out.allDay ? out.start : new Date(out.start - DAY).toISOString().slice(0, 10)
  out.repeat = repeat(input.repeat, firstDate)
  out.reminders = reminders(input.reminders)
  out.exceptions = {}
  if (out.repeat && input.exceptions && typeof input.exceptions === "object") {
    const entries = Object.entries(input.exceptions)
    if (entries.length > MAX_EXCEPTIONS) v.fail("That event has too many changed days.")
    for (const [key, value] of entries) out.exceptions[date(key, "A changed day")] = change(value, out.allDay)
  }
  return out
}

const calendarName = (value) => v.text(value, { max: 40, min: 1, label: "The calendar's name", lines: false })

module.exports = { COLORS, REMINDERS, FREQS, validZone, event, change, color, calendarName, text: v.text, Invalid: v.Invalid, fail: v.fail, date }
