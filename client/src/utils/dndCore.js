// Do Not Disturb: the rules, with no browser, storage or React in them. The client
// (utils/dnd.js) and the push server (server/push, through a dynamic import) both use them,
// so a phone with 98ish closed and the desktop in front of you agree on when it's quiet.
// Tests: node --test client/src/utils/dndCore.test.js
//
// The state (saved per user, synced per 98 Messenger account):
//   { on, until, skip, schedule: { on, from, to, days }, calls, reminders, away, favorites, updatedAt }
//   on + until: turned on by hand, until a time (ms) or until turned off (until: null)
//   skip: turned off by hand while the schedule had it on: the schedule rests until then
//   schedule: every day in `days` (0 = Sunday) from `from` to `to` ("22:00" to "07:00"
//     wraps midnight: it belongs to the day it starts, so Friday night runs into Saturday)
//   calls: who can still ring: "everyone", "favorites" (starred in the Address Book) or "none"
//   reminders: calendar reminders still pop up
//   away: 98 Messenger shows you as Away while it's on
//   favorites: the favorites' screen-name keys (lowercase, no spaces)

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY_MS = 86_400_000
export const MORNING = "07:00" // "Until tomorrow morning"

export const DND_DEFAULTS = {
  on: false,
  until: null,
  skip: null,
  schedule: { on: false, from: "22:00", to: "07:00", days: [0, 1, 2, 3, 4, 5, 6] },
  calls: "favorites",
  reminders: true,
  away: false,
  favorites: [],
  updatedAt: 0,
}

export const keyOf = (name) => String(name || "").replace(/\s+/g, "").toLowerCase()

const time = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : null)

// anything saved (or sent to the server) back into shape
export const cleanDnd = (raw) => {
  const r = raw && typeof raw === "object" ? raw : {}
  const s = r.schedule && typeof r.schedule === "object" ? r.schedule : {}
  const days = Array.isArray(s.days) ? [...new Set(s.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : DND_DEFAULTS.schedule.days
  return {
    on: !!r.on,
    until: r.on ? time(r.until) : null,
    skip: time(r.skip),
    schedule: {
      on: !!s.on,
      from: TIME.test(s.from) ? s.from : DND_DEFAULTS.schedule.from,
      to: TIME.test(s.to) ? s.to : DND_DEFAULTS.schedule.to,
      days,
    },
    calls: ["everyone", "favorites", "none"].includes(r.calls) ? r.calls : DND_DEFAULTS.calls,
    reminders: r.reminders !== false,
    away: !!r.away,
    favorites: Array.isArray(r.favorites) ? [...new Set(r.favorites.map(keyOf).filter((k) => k && k.length <= 32))].slice(0, 200) : [],
    updatedAt: time(r.updatedAt) || 0,
  }
}

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))

// { day (0 = Sunday), minutes since midnight } at `t` in time zone `tz` (or this device's)
export const wallClock = (t, tz) => {
  if (!tz) {
    const d = new Date(t)
    return { day: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() }
  }
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(t))
  const get = (type) => parts.find((p) => p.type === type)?.value
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"))
  return { day, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) }
}

// is the schedule on at this wall-clock moment?
export const scheduleActive = (schedule, { day, minutes }) => {
  if (!schedule?.on || !schedule.days?.length) return false
  const from = toMinutes(schedule.from)
  const to = toMinutes(schedule.to)
  const has = (d) => schedule.days.includes(((d % 7) + 7) % 7)
  if (from === to) return has(day) // all day
  if (from < to) return has(day) && minutes >= from && minutes < to
  // overnight: tonight's part, or the morning part of a night that began yesterday
  return (has(day) && minutes >= from) || (has(day - 1) && minutes < to)
}

// "manual" (turned on by hand), "schedule", or null (off)
export const dndReason = (state, t = Date.now(), tz) => {
  const s = cleanDnd(state)
  if (s.on && (!s.until || t < s.until)) return "manual"
  if (s.skip && t < s.skip) return null
  return scheduleActive(s.schedule, wallClock(t, tz)) ? "schedule" : null
}
export const dndActive = (state, t = Date.now(), tz) => !!dndReason(state, t, tz)

// may this get through right now? kind: "calls" (from: a screen name), "calendar", or
// anything else (IMs, mail, invitations, couples, system: all held while it's on)
export const dndAllows = (state, { kind, from } = {}, t = Date.now(), tz) => {
  if (!dndActive(state, t, tz)) return true
  const s = cleanDnd(state)
  if (kind === "calls") return s.calls === "everyone" || (s.calls === "favorites" && !!from && s.favorites.includes(keyOf(from)))
  if (kind === "calendar") return s.reminders
  // Clock's alarms and timer: you set them yourself, so they always ring (like a phone's)
  if (kind === "alarms") return true
  return false
}

// the next time it's `hhmm` on this device's clock, strictly after t
export const nextLocal = (hhmm, t = Date.now()) => {
  const d = new Date(t)
  d.setHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)), 0, 0)
  if (d.getTime() <= t) d.setDate(d.getDate() + 1)
  return d.getTime()
}

// the turn-on choices: "hour", "morning" (the next 7:00), "off" (until turned off)
export const untilFor = (choice, t = Date.now()) => (choice === "hour" ? t + 3_600_000 : choice === "morning" ? nextLocal(MORNING, t) : null)

// when the schedule's current quiet time ends (this device's clock), or null
export const scheduleEnd = (schedule, t = Date.now()) => {
  if (!scheduleActive(schedule, wallClock(t))) return null
  // walk forward to the first minute it's off (at most 8 days)
  let at = nextLocal(schedule.to, t)
  for (let i = 0; i < 9 && scheduleActive(schedule, wallClock(at)); i++) at = nextLocal(schedule.to, at)
  return at <= t + 8 * DAY_MS ? at : null
}

// when it turns off by itself (ms), null if it doesn't (or isn't on)
export const dndEndsAt = (state, t = Date.now()) => {
  const s = cleanDnd(state)
  const reason = dndReason(s, t)
  if (reason === "manual") {
    if (!s.until) return null
    // a schedule that's on when the hour runs out keeps it quiet
    const after = scheduleEnd(s.schedule, s.until)
    return after || s.until
  }
  if (reason === "schedule") return scheduleEnd(s.schedule, t)
  return null
}

// turning it off by hand: the schedule rests until its quiet time ends
export const turnedOff = (state, t = Date.now()) => {
  const s = cleanDnd(state)
  const end = scheduleEnd(s.schedule, t)
  return { ...s, on: false, until: null, skip: end && end > t ? end : null }
}
export const turnedOn = (state, choice, t = Date.now()) => ({ ...cleanDnd(state), on: true, until: untilFor(choice, t), skip: null })

// "Mon-Fri", "Every day", "Sat, Sun"
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
export const daysLabel = (days = []) => {
  const set = [...new Set(days)].sort()
  if (set.length === 7) return "Every day"
  if (!set.length) return "No days"
  if (set.join() === "1,2,3,4,5") return "Weekdays"
  if (set.join() === "0,6") return "Weekends"
  return set.map((d) => DAY_NAMES[d]).join(", ")
}
