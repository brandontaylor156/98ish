// iCalendar (.ics) files from 98ish Calendar events, for "Add to my phone's calendar" (one
// event) and a calendar's subscription feed (the server imports this file too). Repeats
// become RRULEs in the event's own time zone, so phones keep them right across daylight
// saving; changed and deleted occurrences become RECURRENCE-ID events and EXDATEs.
// Reminders become alarms (all-day ones at 9:00 on the day, as in 98ish).

import { ALL_DAY_REMINDER_HOUR, addDays, anchorOf, parseDate, validZone, zoneParts, zonedTime } from "./recur.js"

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]
const pad = (n) => String(n).padStart(2, "0")

export const escapeText = (s) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n")

// lines are at most 75 bytes: longer ones continue on the next line after a space
const fold = (line) => {
  const out = []
  let current = ""
  let bytes = 0
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length
    if (bytes + size > (out.length ? 74 : 75)) {
      out.push(current)
      current = ""
      bytes = 0
    }
    current += ch
    bytes += size
  }
  out.push(current)
  return out.join("\r\n ")
}

const dateValue = (date) => date.replace(/-/g, "")
const utcValue = (t) => {
  const d = new Date(t)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}
const localValue = (t, zone) => {
  const p = zoneParts(t, zone)
  return `${p.y}${pad(p.m)}${pad(p.d)}T${pad(p.h)}${pad(p.mi)}${pad(p.s)}`
}

const rrule = (event, zone) => {
  const r = event.repeat
  const parts = [`FREQ=${r.freq.toUpperCase()}`]
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`)
  const first = anchorOf(event).date
  if (r.freq === "weekly" && r.byDay?.length) parts.push(`BYDAY=${r.byDay.map((d) => DAYS[d]).join(",")}`)
  if (r.freq === "monthly" && r.monthly && r.monthly !== "day") {
    const p = parseDate(first)
    const nth = r.monthly === "lastWeekday" || Math.ceil(p.d / 7) > 4 ? -1 : Math.ceil(p.d / 7)
    const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()
    parts.push(`BYDAY=${nth}${DAYS[wd]}`)
  }
  if (r.until) parts.push(`UNTIL=${event.allDay ? dateValue(r.until) : utcValue(zonedTime(r.until, 23, 59, zone))}`)
  else if (r.count) parts.push(`COUNT=${r.count}`)
  return `RRULE:${parts.join(";")}`
}

const alarm = (minutes, allDay, title) => {
  // before the start; all-day events start at midnight, and their reminders are at 9:00
  let offset = -minutes
  if (allDay) offset += ALL_DAY_REMINDER_HOUR * 60
  const sign = offset < 0 ? "-" : ""
  const m = Math.abs(offset)
  const value = m === 0 ? "PT0M" : `${sign}P${m >= 1440 && m % 1440 === 0 ? `${m / 1440}D` : `T${m}M`}`
  return ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(title)}`, `TRIGGER:${value}`, "END:VALARM"]
}

// The VEVENT lines for one event (plus one for each changed occurrence)
export const eventLines = (event, { stamp = Date.now(), domain = "98ish.vercel.app", by = "" } = {}) => {
  if (!event || event.kind === "memo" || event.start === null || event.start === undefined) return []
  const zone = event.allDay ? null : validZone(event.tz) ? event.tz : "UTC"
  const uid = `${event.id}@${domain}`
  const common = (data) => {
    const lines = [`SUMMARY:${escapeText(data.title)}${data.done ? " ✓" : ""}`]
    if (data.location) lines.push(`LOCATION:${escapeText(data.location)}`)
    const notes = [data.notes, by ? `Added by ${by}` : ""].filter(Boolean).join("\n\n")
    if (notes) lines.push(`DESCRIPTION:${escapeText(notes)}`)
    for (const m of data.reminders || []) lines.push(...alarm(m, event.allDay, data.title))
    return lines
  }
  const times = (start, end) => {
    if (event.allDay) return [`DTSTART;VALUE=DATE:${dateValue(start)}`, `DTEND;VALUE=DATE:${dateValue(addDays(end, 1))}`]
    if (event.repeat) return [`DTSTART;TZID=${zone}:${localValue(start, zone)}`, `DTEND;TZID=${zone}:${localValue(end, zone)}`]
    return [`DTSTART:${utcValue(start)}`, `DTEND:${utcValue(end)}`]
  }
  const out = ["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${utcValue(stamp)}`, ...(event.updatedAt ? [`LAST-MODIFIED:${utcValue(event.updatedAt)}`] : []), ...times(event.start, event.end)]
  const exceptions = Object.entries(event.exceptions || {})
  const { hour, minute } = anchorOf(event)
  const originalAt = (key) => (event.allDay ? `;VALUE=DATE:${dateValue(key)}` : `;TZID=${zone}:${localValue(zonedTime(key, hour, minute, zone), zone)}`)
  if (event.repeat) {
    out.push(rrule(event, zone))
    for (const [key, change] of exceptions) if (change.deleted) out.push(`EXDATE${originalAt(key)}`)
  }
  out.push(...common(event), "END:VEVENT")
  // changed occurrences
  if (event.repeat) {
    for (const [key, change] of exceptions) {
      if (change.deleted) continue
      const span = event.allDay ? Math.round((Date.parse(event.end) - Date.parse(event.start)) / 86_400_000) : event.end - event.start
      let start
      let end
      if (event.allDay) {
        start = change.start || key
        end = change.end || addDays(start, span)
      } else {
        start = typeof change.start === "number" ? change.start : zonedTime(key, hour, minute, zone)
        end = typeof change.end === "number" ? change.end : start + span
      }
      out.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${utcValue(stamp)}`, `RECURRENCE-ID${originalAt(key)}`, ...times(start, end), ...common({ ...event, ...change }), "END:VEVENT")
    }
  }
  return out
}

// A whole .ics file
export const toICS = (events, { name = "98ish Calendar", stamp = Date.now(), domain, byName = () => "" } = {}) => {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//98ish//98ish Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ]
  for (const event of events) lines.push(...eventLines(event, { stamp, domain, by: byName(event) }))
  lines.push("END:VCALENDAR")
  return lines.map(fold).join("\r\n") + "\r\n"
}
