// 98ish Calendar's date math, with no React and no storage, so Node can test it.
//
// An event is either
//   all-day: { allDay: true, start: "2026-10-03", end: "2026-10-04" }  (dates, end inclusive)
//   timed:   { allDay: false, start: ms, end: ms, tz: "America/Chicago" } (real instants, plus
//            the zone it was planned in: a weekly 9:00 stays 9:00 there across daylight saving)
// and may repeat:
//   repeat: { freq: "daily" | "weekly" | "monthly" | "yearly", interval: 1..99,
//             byDay: [0..6] (weekly; Sunday = 0), monthly: "day" | "weekday" | "lastWeekday",
//             until: "YYYY-MM-DD" | null (inclusive), count: n | null }
//   exceptions: { "YYYY-MM-DD" (the occurrence's original date): { deleted } or changes }
//
// occurrences(event, fromMs, toMs, viewZone) lists what shows between two instants.
// reminderTimes(occurrence, minutes, viewZone) says when its reminders go off: minutes before
// the start, or for all-day events minutes before 9:00 on the day (in the viewer's zone).

export const DAY_MS = 86_400_000
export const ALL_DAY_REMINDER_HOUR = 9
const MAX_STEPS = 60_000

// ---------- dates as "YYYY-MM-DD" ----------

const pad = (n) => String(n).padStart(2, "0")
export const dateKey = (y, m, d) => `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
export const parseDate = (s) => {
  const m = DATE.exec(String(s || ""))
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null
}
// days since 1970-01-01 (dates are counted in UTC so no zone ever shifts them)
export const dayNumber = (s) => {
  const p = parseDate(s)
  return p ? Math.round(Date.UTC(p.y, p.m - 1, p.d) / DAY_MS) : NaN
}
export const fromDayNumber = (n) => {
  const d = new Date(n * DAY_MS)
  return dateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}
export const addDays = (s, n) => fromDayNumber(dayNumber(s) + n)
export const daysBetween = (a, b) => dayNumber(b) - dayNumber(a)
export const weekdayOf = (s) => (((dayNumber(s) + 4) % 7) + 7) % 7 // 1970-01-01 was a Thursday
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
export const validDate = (s) => {
  const p = parseDate(s)
  return !!p && p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= daysInMonth(p.y, p.m)
}
export const addMonths = (s, n) => {
  const p = parseDate(s)
  const total = p.y * 12 + (p.m - 1) + n
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return dateKey(y, m, Math.min(p.d, daysInMonth(y, m)))
}

// ---------- time zones ----------

const formatters = new Map()
const formatterFor = (zone) => {
  let f = formatters.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
    formatters.set(zone, f)
  }
  return f
}

export const validZone = (zone) => {
  if (typeof zone !== "string" || !zone || zone.length > 64) return false
  try {
    formatterFor(zone)
    return true
  } catch {
    return false
  }
}

// the zone's wall clock at instant t: { y, m, d, h, mi, s, date: "YYYY-MM-DD", wd }
export const zoneParts = (t, zone) => {
  const parts = {}
  for (const p of formatterFor(zone).formatToParts(new Date(t))) parts[p.type] = p.value
  const y = +parts.year
  const m = +parts.month
  const d = +parts.day
  const date = dateKey(y, m, d)
  return { y, m, d, h: +parts.hour % 24, mi: +parts.minute, s: +parts.second, date, wd: weekdayOf(date) }
}

// how far (ms) the zone's clocks are ahead of UTC at instant t
export const zoneOffset = (t, zone) => {
  const p = zoneParts(t, zone)
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s)
  return asUtc - (t - (((t % 1000) + 1000) % 1000))
}

export const dateIn = (t, zone) => zoneParts(t, zone).date

// The instant a wall-clock time happens in a zone. A time the clocks skip (2:30 on the
// spring-forward night) moves forward by the gap (3:30); a time that happens twice (1:30 on
// the fall-back night) is the first one.
export const zonedTime = (date, hour, minute, zone) => {
  const p = parseDate(date)
  const guess = Date.UTC(p.y, p.m - 1, p.d, hour, minute)
  const offsets = [...new Set([zoneOffset(guess - 14 * 3_600_000, zone), zoneOffset(guess, zone), zoneOffset(guess + 14 * 3_600_000, zone)])]
  const matches = offsets
    .map((o) => guess - o)
    .filter((t) => {
      const q = zoneParts(t, zone)
      return q.date === date && q.h === hour && q.mi === minute
    })
  if (matches.length) return Math.min(...matches)
  return guess - Math.min(...offsets)
}

export const startOfDay = (date, zone) => zonedTime(date, 0, 0, zone)

// ---------- repeating ----------

export const FREQS = ["daily", "weekly", "monthly", "yearly"]

// which of its weekday a date is in its month: 1..5
const nthOfMonth = (d) => Math.ceil(d / 7)
// the date of the nth weekday (n = -1: the last) of a month, or null
const nthWeekday = (y, m, wd, n) => {
  if (n === -1) {
    const last = dateKey(y, m, daysInMonth(y, m))
    return addDays(last, -((weekdayOf(last) - wd + 7) % 7))
  }
  const first = dateKey(y, m, 1)
  const day = 1 + ((wd - weekdayOf(first) + 7) % 7) + (n - 1) * 7
  return day <= daysInMonth(y, m) ? dateKey(y, m, day) : null
}

// Every date a rule makes, in order, from its start: calls visit(date, index) until visit
// returns false or the rule ends. `from` lets daily and weekly rules skip ahead (only when
// no count is set: a count is numbered from the very first date).
export const eachRuleDate = (start, repeat, visit, from = null) => {
  if (!repeat) {
    visit(start, 0)
    return
  }
  const interval = Math.max(1, Math.min(99, Math.floor(repeat.interval) || 1))
  const until = repeat.until && validDate(repeat.until) ? repeat.until : null
  const count = repeat.count ? Math.max(1, Math.floor(repeat.count)) : null
  const s = parseDate(start)
  let index = 0
  let steps = 0
  const emit = (date) => {
    if (date < start) return true
    if (until && date > until) return false
    if (count && index >= count) return false
    const keep = visit(date, index)
    index++
    return keep !== false
  }
  const skip = from && !count ? Math.max(0, daysBetween(start, from)) : 0

  if (repeat.freq === "daily") {
    let k = Math.max(0, Math.floor(skip / interval) - 1)
    while (steps++ < MAX_STEPS && emit(addDays(start, k * interval))) k++
    return
  }
  if (repeat.freq === "weekly") {
    const days = [...new Set((repeat.byDay?.length ? repeat.byDay : [weekdayOf(start)]).map(Number))].filter((d) => d >= 0 && d <= 6).sort()
    const sunday = addDays(start, -weekdayOf(start))
    let w = Math.max(0, Math.floor(skip / 7 / interval) - 1)
    while (steps++ < MAX_STEPS) {
      const weekStart = addDays(sunday, w * interval * 7)
      for (const d of days) if (!emit(addDays(weekStart, d))) return
      w++
    }
    return
  }
  if (repeat.freq === "monthly") {
    const mode = repeat.monthly || "day"
    const wd = weekdayOf(start)
    const nth = mode === "lastWeekday" ? -1 : Math.min(nthOfMonth(s.d), 4) === nthOfMonth(s.d) ? nthOfMonth(s.d) : -1
    for (let k = 0; steps++ < MAX_STEPS; k++) {
      const total = s.y * 12 + (s.m - 1) + k * interval
      const y = Math.floor(total / 12)
      const m = (total % 12) + 1
      if (until && dateKey(y, m, 1) > until) return
      let date = null
      if (mode === "day") date = s.d <= daysInMonth(y, m) ? dateKey(y, m, s.d) : null // no 31st: skipped
      else date = nthWeekday(y, m, wd, nth)
      if (date && !emit(date)) return
    }
    return
  }
  if (repeat.freq === "yearly") {
    for (let k = 0; steps++ < MAX_STEPS; k++) {
      const y = s.y + k * interval
      if (until && dateKey(y, 1, 1) > until) return
      const date = s.d <= daysInMonth(y, s.m) ? dateKey(y, s.m, s.d) : null // Feb 29: leap years only
      if (date && !emit(date)) return
    }
  }
}

// Rule dates between two dates (inclusive)
export const ruleDates = (start, repeat, from, to) => {
  const out = []
  eachRuleDate(
    start,
    repeat,
    (date) => {
      if (date > to) return false
      if (date >= from) out.push(date)
      return true
    },
    from
  )
  return out
}

// The last date a rule makes, or null if it never ends
export const lastRuleDate = (start, repeat) => {
  if (!repeat) return start
  if (!repeat.until && !repeat.count) return null
  let last = start
  eachRuleDate(start, repeat, (date) => {
    last = date
    return true
  })
  return last
}

// ---------- occurrences ----------

const OVERRIDES = ["title", "location", "notes", "label", "done", "reminders", "attendees", "checklist"]

// The event's first date (in its own zone for timed events) and, for timed ones, its wall time
export const anchorOf = (event) => {
  if (event.allDay) return { date: event.start, hour: 0, minute: 0 }
  const p = zoneParts(event.start, event.tz || "UTC")
  return { date: p.date, hour: p.h, minute: p.mi }
}

const occurrence = (event, key, start, end, change) => {
  const occ = {
    id: event.id,
    key,
    calendarId: event.calendarId,
    event,
    recurring: !!event.repeat,
    allDay: !!event.allDay,
    start,
    end,
    title: event.title,
    location: event.location || "",
    notes: event.notes || "",
    label: event.label || "",
    done: !!event.done,
    reminders: event.reminders || [],
    attendees: event.attendees || [],
    checklist: event.checklist || [],
    changed: !!change,
  }
  if (change) for (const k of OVERRIDES) if (change[k] !== undefined) occ[k] = change[k]
  return occ
}

// Everything an event puts between fromMs and toMs (all-day events by the viewer's dates)
export const occurrences = (event, fromMs, toMs, viewZone = "UTC") => {
  if (!event || event.kind === "memo" || event.start === undefined || event.start === null) return []
  const out = []
  const exceptions = event.exceptions || {}
  if (event.allDay) {
    const span = Math.max(0, daysBetween(event.start, event.end || event.start))
    const fromDate = dateIn(fromMs, viewZone)
    const toDate = dateIn(Math.max(fromMs, toMs - 1), viewZone)
    // a margin, so occurrences moved in from nearby dates show up too
    for (const key of ruleDates(event.start, event.repeat, addDays(fromDate, -span - 31), addDays(toDate, 31))) {
      const change = exceptions[key]
      if (change?.deleted) continue
      const start = change?.start && validDate(change.start) ? change.start : key
      const end = change?.end && validDate(change.end) ? change.end : addDays(start, span)
      if (end < fromDate || start > toDate) continue
      out.push(occurrence(event, key, start, end, change))
    }
    return out
  }
  const zone = validZone(event.tz) ? event.tz : "UTC"
  const length = Math.max(0, (event.end ?? event.start) - event.start)
  const { hour, minute, date: first } = anchorOf({ ...event, tz: zone })
  const fromDate = dateIn(fromMs - length, zone)
  const toDate = dateIn(toMs, zone)
  for (const key of ruleDates(first, event.repeat, addDays(fromDate, -32), addDays(toDate, 32))) {
    const change = exceptions[key]
    if (change?.deleted) continue
    let start = key === first ? event.start : zonedTime(key, hour, minute, zone)
    let end = start + length
    if (typeof change?.start === "number") {
      start = change.start
      end = typeof change.end === "number" && change.end >= start ? change.end : start + length
    }
    const inside = end > start ? start < toMs && end > fromMs : start >= fromMs && start < toMs
    if (!inside) continue
    out.push(occurrence(event, key, start, end, change))
  }
  return out
}

// Every occurrence of many events in a range, sorted (all-day first on a day)
export const expandAll = (events, fromMs, toMs, viewZone) => {
  const all = []
  for (const e of events) for (const o of occurrences(e, fromMs, toMs, viewZone)) all.push(o)
  return all.sort((a, b) => startMs(a, viewZone) - startMs(b, viewZone) || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || a.title.localeCompare(b.title))
}

// An occurrence's start and end as instants in the viewer's zone (all-day: midnight to midnight)
export const startMs = (occ, zone) => (occ.allDay ? startOfDay(occ.start, zone) : occ.start)
export const endMs = (occ, zone) => (occ.allDay ? startOfDay(addDays(occ.end, 1), zone) : occ.end)

// Does an occurrence touch a date (in the viewer's zone)?
export const onDate = (occ, date, zone) => {
  if (occ.allDay) return occ.start <= date && occ.end >= date
  const a = dateIn(occ.start, zone)
  const b = dateIn(Math.max(occ.start, occ.end - 1), zone)
  return a <= date && b >= date
}

// ---------- reminders ----------

export const REMINDER_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080]

export const reminderTimes = (occ, minutes = occ.reminders, zone = "UTC") => {
  // all-day: whole days count on the calendar ("1 day before" is 9:00 the day before, even
  // when the clocks change overnight)
  const at = (m) => (occ.allDay ? zonedTime(addDays(occ.start, -Math.floor(m / 1440)), ALL_DAY_REMINDER_HOUR, 0, zone) - (m % 1440) * 60_000 : occ.start - m * 60_000)
  return [...new Set(minutes || [])].map((m) => ({ minutes: m, at: at(m) }))
}

// Reminders that go off in (sinceMs, untilMs]: [{ id, key, minutes, at, occ, fireKey }]
export const dueReminders = (events, sinceMs, untilMs, zone = "UTC", { wants = () => true } = {}) => {
  const longest = 10080 * 60_000 + DAY_MS
  const due = []
  for (const event of events) {
    if (!event.reminders?.length && !event.exceptions) continue
    for (const occ of occurrences(event, sinceMs - DAY_MS, untilMs + longest, zone)) {
      if (!wants(occ)) continue
      for (const r of reminderTimes(occ, occ.reminders, zone)) {
        if (r.at > sinceMs && r.at <= untilMs) due.push({ ...r, id: occ.id, key: occ.key, occ, fireKey: `${occ.id}|${occ.key}|${r.minutes}` })
      }
    }
  }
  return due.sort((a, b) => a.at - b.at)
}

// The next reminder after `afterMs` (looking ahead `withinMs`), or null
export const nextReminder = (events, afterMs, withinMs, zone, options) => dueReminders(events, afterMs, afterMs + withinMs, zone, options)[0] || null

// ---------- words ----------

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
export const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const ORDINALS = ["", "first", "second", "third", "fourth", "fifth"]

export const describeRepeat = (repeat, start) => {
  if (!repeat) return "Does not repeat"
  const n = Math.max(1, repeat.interval || 1)
  const p = parseDate(start)
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[repeat.freq]
  let text = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`
  if (repeat.freq === "daily" && n === 1) text = "Every day"
  if (repeat.freq === "weekly") {
    const days = repeat.byDay?.length ? [...repeat.byDay].sort() : [weekdayOf(start)]
    const names = days.join() === "1,2,3,4,5" ? "weekdays" : days.join() === "0,6" ? "weekends" : days.map((d) => WEEKDAYS_SHORT[d]).join(", ")
    text += ` on ${names}`
  }
  if (repeat.freq === "monthly" && p) {
    const wd = WEEKDAYS[weekdayOf(start)]
    if (repeat.monthly === "weekday" && Math.ceil(p.d / 7) <= 4) text += ` on the ${ORDINALS[Math.ceil(p.d / 7)]} ${wd}`
    else if (repeat.monthly === "weekday" || repeat.monthly === "lastWeekday") text += ` on the last ${wd}`
    else text += ` on day ${p.d}`
  }
  if (repeat.freq === "yearly" && p) text += ` on ${MONTHS[p.m - 1]} ${p.d}`
  if (repeat.until) {
    const u = parseDate(repeat.until)
    text += `, until ${MONTHS[u.m - 1].slice(0, 3)} ${u.d}, ${u.y}`
  } else if (repeat.count) text += `, ${repeat.count} times`
  return text
}

export const describeReminder = (minutes, allDay = false) => {
  if (allDay) {
    if (minutes === 0) return "On the day (9:00 AM)"
    if (minutes % 10080 === 0) return `${minutes / 10080} week${minutes > 10080 ? "s" : ""} before (9:00 AM)`
    if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes > 1440 ? "s" : ""} before (9:00 AM)`
  }
  if (minutes === 0) return "At the start"
  if (minutes % 10080 === 0) return `${minutes / 10080} week${minutes > 10080 ? "s" : ""} before`
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes > 1440 ? "s" : ""} before`
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes > 60 ? "s" : ""} before`
  return `${minutes} minutes before`
}

// "9:00 AM" in a zone
export const timeLabel = (t, zone) => {
  const p = zoneParts(t, zone)
  const h = p.h % 12 || 12
  return `${h}:${pad(p.mi)} ${p.h < 12 ? "AM" : "PM"}`
}
export const shortTime = (t, zone) => {
  const p = zoneParts(t, zone)
  const h = p.h % 12 || 12
  return `${h}${p.mi ? `:${pad(p.mi)}` : ""}${p.h < 12 ? "a" : "p"}`
}
export const dateLabel = (date, { weekday = true, year = false } = {}) => {
  const p = parseDate(date)
  if (!p) return ""
  return `${weekday ? `${WEEKDAYS_SHORT[weekdayOf(date)]}, ` : ""}${MONTHS[p.m - 1].slice(0, 3)} ${p.d}${year ? `, ${p.y}` : ""}`
}

// "Fri, Oct 9, 7:00 PM - 9:00 PM", "Sat, Oct 10 (all day)"
export const whenLabel = (occ, zone) => {
  if (occ.allDay) {
    if (occ.start === occ.end) return `${dateLabel(occ.start)} (all day)`
    return `${dateLabel(occ.start)} - ${dateLabel(occ.end)} (all day)`
  }
  const a = dateIn(occ.start, zone)
  const b = dateIn(occ.end, zone)
  if (occ.end === occ.start) return `${dateLabel(a)}, ${timeLabel(occ.start, zone)}`
  if (a === b) return `${dateLabel(a)}, ${timeLabel(occ.start, zone)} - ${timeLabel(occ.end, zone)}`
  return `${dateLabel(a)}, ${timeLabel(occ.start, zone)} - ${dateLabel(b)}, ${timeLabel(occ.end, zone)}`
}

// A month grid: 6 weeks of dates starting on Sunday
export const monthGrid = (y, m) => {
  const first = dateKey(y, m, 1)
  const start = addDays(first, -weekdayOf(first))
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}
