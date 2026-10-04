// Date and time math for the 98-style pickers, on plain { y, m, d } days (m is 0-11) and
// { h, min } times, with the inputs' own value formats:
//   date "YYYY-MM-DD", time "HH:MM", datetime-local "YYYY-MM-DDTHH:MM", month "YYYY-MM".
// No Date objects in the grid math, so time zones and DST can't shift a day.

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3))
export const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"]

const pad = (n, size = 2) => String(n).padStart(size, "0")

export const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

// 0 = Sunday
export const weekdayOf = ({ y, m, d }) => new Date(Date.UTC(y, m, d)).getUTCDay()

export const parseDate = (s) => {
  const r = /^(\d{4,6})-(\d{2})-(\d{2})/.exec(s || "")
  if (!r) return null
  const y = Number(r[1])
  const m = Number(r[2]) - 1
  const d = Number(r[3])
  if (m < 0 || m > 11 || d < 1 || d > daysInMonth(y, m)) return null
  return { y, m, d }
}

export const formatDate = ({ y, m, d }) => `${pad(y, 4)}-${pad(m + 1)}-${pad(d)}`

export const parseMonth = (s) => {
  const r = /^(\d{4,6})-(\d{2})$/.exec(s || "")
  if (!r || Number(r[2]) < 1 || Number(r[2]) > 12) return null
  return { y: Number(r[1]), m: Number(r[2]) - 1, d: 1 }
}

export const formatMonth = ({ y, m }) => `${pad(y, 4)}-${pad(m + 1)}`

export const parseTime = (s) => {
  const r = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(s || "")
  if (!r || Number(r[1]) > 23 || Number(r[2]) > 59) return null
  return { h: Number(r[1]), min: Number(r[2]), s: r[3] ? Number(r[3]) : 0 }
}

// seconds only when there are some (and the field takes them)
export const formatTime = ({ h, min, s = 0 }, withSeconds = false) =>
  `${pad(h)}:${pad(min)}${withSeconds || s ? `:${pad(s)}` : ""}`

export const parseDateTime = (s) => {
  const [date, time] = String(s || "").split("T")
  const day = parseDate(date)
  const t = parseTime(time)
  return day && t ? { ...day, ...t } : null
}

export const formatDateTime = (v) => `${formatDate(v)}T${formatTime(v)}`

// -1, 0 or 1
export const compareDays = (a, b) => Math.sign(a.y - b.y || a.m - b.m || a.d - b.d)

export const sameDay = (a, b) => !!a && !!b && compareDays(a, b) === 0

// is the day inside the field's min/max (as parsed days, either may be null)?
export const dayAllowed = (day, min, max) => (!min || compareDays(day, min) >= 0) && (!max || compareDays(day, max) <= 0)

export const clampDay = (day, min, max) => {
  if (min && compareDays(day, min) < 0) return min
  if (max && compareDays(day, max) > 0) return max
  return day
}

export const addDays = ({ y, m, d }, n) => {
  const t = new Date(Date.UTC(y, m, d + n))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() }
}

// the same day n months on, or that month's last day (Jan 31 + 1 month = Feb 28/29)
export const addMonths = ({ y, m, d }, n) => {
  const total = y * 12 + m + n
  const ny = Math.floor(total / 12)
  const nm = total - ny * 12
  return { y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) }
}

// The six weeks shown for a month, starting on firstDay (0 = Sunday): 42 days, with
// `inMonth` false for the grey days of the months either side.
export const monthGrid = (y, m, firstDay = 0) => {
  const lead = (weekdayOf({ y, m, d: 1 }) - firstDay + 7) % 7
  const start = addDays({ y, m, d: 1 }, -lead)
  return Array.from({ length: 42 }, (_, i) => {
    const day = addDays(start, i)
    return { ...day, inMonth: day.m === m && day.y === y }
  })
}

// The date picker's keyboard: a key -> the newly highlighted day, or null for other keys
export const dayKey = (day, key, { shift = false } = {}) => {
  switch (key) {
    case "ArrowLeft":
      return addDays(day, -1)
    case "ArrowRight":
      return addDays(day, 1)
    case "ArrowUp":
      return addDays(day, -7)
    case "ArrowDown":
      return addDays(day, 7)
    case "PageUp":
      return addMonths(day, shift ? -12 : -1)
    case "PageDown":
      return addMonths(day, shift ? 12 : 1)
    case "Home":
      return { ...day, d: 1 }
    case "End":
      return { ...day, d: daysInMonth(day.y, day.m) }
    default:
      return null
  }
}

// ---- times ----

// minutes between choices from the input's step (in seconds; 60 by default). Steps that
// don't divide an hour evenly (or are under a minute) fall back to every minute.
export const minuteStep = (step) => {
  const n = Number(step)
  if (!step || step === "any" || !(n >= 60)) return 1
  const minutes = Math.round(n / 60)
  return minutes >= 1 && minutes <= 60 && 60 % minutes === 0 ? minutes : 1
}

// the minutes offered: every `stepMinutes`, plus the current one if it's off the step
export const minuteChoices = (stepMinutes, current = null) => {
  const list = []
  for (let m = 0; m < 60; m += stepMinutes) list.push(m)
  if (current != null && !list.includes(current)) list.push(current), list.sort((a, b) => a - b)
  return list
}

// 24-hour h -> { h12: 1-12, pm }
export const to12 = (h) => ({ h12: h % 12 === 0 ? 12 : h % 12, pm: h >= 12 })
export const from12 = (h12, pm) => (h12 % 12) + (pm ? 12 : 0)

// does this locale write times with AM/PM?
export const uses12Hour = (locale) => {
  try {
    const o = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions()
    if (o.hourCycle) return o.hourCycle === "h11" || o.hourCycle === "h12"
    return !!o.hour12
  } catch {
    return true
  }
}

// a time rounded to the nearest step (for an empty field: now)
export const roundTime = ({ h, min }, stepMinutes) => {
  const total = Math.round((h * 60 + min) / stepMinutes) * stepMinutes
  const wrapped = ((total % 1440) + 1440) % 1440
  return { h: Math.floor(wrapped / 60), min: wrapped % 60, s: 0 }
}

export const timeLabel = ({ h, min }, h12) => {
  if (!h12) return `${pad(h)}:${pad(min)}`
  const t = to12(h)
  return `${t.h12}:${pad(min)} ${t.pm ? "PM" : "AM"}`
}

// "Today: 10/3/2026" as Windows' calendar wrote it (in the locale's short form)
export const shortDate = ({ y, m, d }, locale) => {
  try {
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m, d)))
  } catch {
    return `${m + 1}/${d}/${y}`
  }
}

// The value a picker writes back, for the input's type
export const formatFor = (type, v) => {
  if (type === "date") return formatDate(v)
  if (type === "month") return formatMonth(v)
  if (type === "time") return formatTime(v)
  if (type === "datetime-local") return formatDateTime(v)
  return ""
}

// ...and reads (null for an empty or unreadable value)
export const parseFor = (type, s) => {
  if (type === "date") return parseDate(s)
  if (type === "month") return parseMonth(s)
  if (type === "time") return parseTime(s)
  if (type === "datetime-local") return parseDateTime(s)
  return null
}
