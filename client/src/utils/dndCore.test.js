// Do Not Disturb rules: schedules (overnight, weekdays), durations, turning off during a
// schedule, who may call. Run: node --test client/src/utils/dndCore.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { DND_DEFAULTS, cleanDnd, daysLabel, dndActive, dndAllows, dndEndsAt, dndReason, nextLocal, scheduleActive, scheduleEnd, turnedOff, turnedOn, untilFor, wallClock } from "./dndCore.js"

// local wall-clock times (2026-10-05 is a Monday)
const at = (day, hh, mm = 0) => new Date(2026, 9, 4 + day, hh, mm).getTime() // day 0 = Sunday Oct 4
const SUN = 0
const MON = 1
const FRI = 5
const SAT = 6

const nightly = (patch = {}) => cleanDnd({ schedule: { on: true, from: "22:00", to: "07:00", days: [0, 1, 2, 3, 4, 5, 6], ...patch } })

test("cleanDnd: junk becomes the defaults", () => {
  assert.deepEqual(cleanDnd(null), DND_DEFAULTS)
  assert.deepEqual(cleanDnd("x"), DND_DEFAULTS)
  const s = cleanDnd({ on: true, until: "soon", schedule: { from: "25:00", to: "7", days: [9, 1, 1, "2"] }, calls: "aliens", favorites: ["Big Bird", "big bird", "", 7] })
  assert.equal(s.until, null)
  assert.equal(s.schedule.from, "22:00")
  assert.equal(s.schedule.to, "07:00")
  assert.deepEqual(s.schedule.days, [1, 2])
  assert.equal(s.calls, "favorites")
  assert.deepEqual(s.favorites, ["bigbird", "7"])
  // until only means something while on
  assert.equal(cleanDnd({ on: false, until: 123 }).until, null)
})

test("off by default; on by hand until turned off", () => {
  assert.equal(dndActive(DND_DEFAULTS, at(MON, 12)), false)
  const s = turnedOn(DND_DEFAULTS, "off", at(MON, 12))
  assert.equal(s.until, null)
  assert.equal(dndReason(s, at(MON, 12)), "manual")
  assert.equal(dndActive(s, at(SAT, 3)), true)
  assert.equal(dndEndsAt(s, at(MON, 12)), null)
})

test("For 1 hour ends an hour later", () => {
  const t = at(MON, 14, 20)
  const s = turnedOn(DND_DEFAULTS, "hour", t)
  assert.equal(s.until, t + 3_600_000)
  assert.equal(dndActive(s, t + 59 * 60_000), true)
  assert.equal(dndActive(s, t + 60 * 60_000), false)
  assert.equal(dndEndsAt(s, t), t + 3_600_000)
})

test("Until tomorrow morning: the next 7:00 (today's, if it's still early)", () => {
  assert.equal(untilFor("morning", at(MON, 23, 30)), at(MON + 1, 7))
  assert.equal(untilFor("morning", at(MON, 3)), at(MON, 7))
  assert.equal(untilFor("morning", at(MON, 7)), at(MON + 1, 7))
  assert.equal(untilFor("off"), null)
  assert.equal(nextLocal("07:00", at(MON, 6, 59)), at(MON, 7))
})

test("overnight schedule wraps midnight", () => {
  const s = nightly()
  assert.equal(dndActive(s, at(MON, 21, 59)), false)
  assert.equal(dndActive(s, at(MON, 22)), true)
  assert.equal(dndActive(s, at(MON, 23, 59)), true)
  assert.equal(dndActive(s, at(MON + 1, 0, 30)), true)
  assert.equal(dndActive(s, at(MON + 1, 6, 59)), true)
  assert.equal(dndActive(s, at(MON + 1, 7)), false)
  assert.equal(dndReason(s, at(MON, 23)), "schedule")
  assert.equal(dndEndsAt(s, at(MON, 23)), at(MON + 1, 7))
})

test("weekday nights: Friday night runs into Saturday; Saturday and Sunday nights are free", () => {
  const s = nightly({ days: [1, 2, 3, 4, 5] })
  assert.equal(dndActive(s, at(FRI, 23)), true)
  assert.equal(dndActive(s, at(SAT, 2)), true, "Friday's night")
  assert.equal(dndActive(s, at(SAT, 23)), false)
  assert.equal(dndActive(s, at(SUN + 7, 2)), false, "Saturday night isn't a weekday")
  assert.equal(dndActive(s, at(SUN, 23)), false)
  assert.equal(dndActive(s, at(MON, 2)), false, "Sunday night isn't on")
  assert.equal(dndActive(s, at(MON, 22, 30)), true)
})

test("daytime schedule and all-day schedule", () => {
  const day = nightly({ from: "09:00", to: "17:00", days: [1, 2, 3, 4, 5] })
  assert.equal(dndActive(day, at(MON, 8, 59)), false)
  assert.equal(dndActive(day, at(MON, 9)), true)
  assert.equal(dndActive(day, at(MON, 17)), false)
  assert.equal(dndActive(day, at(SAT, 12)), false)
  const allDay = nightly({ from: "00:00", to: "00:00", days: [0, 6] })
  assert.equal(dndActive(allDay, at(SAT, 15)), true)
  assert.equal(dndActive(allDay, at(MON, 15)), false)
  // all weekend: ends Monday at midnight
  assert.equal(scheduleEnd(allDay.schedule, at(SAT, 15)), at(MON + 7, 0))
  assert.equal(scheduleActive({ on: true, from: "22:00", to: "07:00", days: [] }, { day: 1, minutes: 23 * 60 }), false)
})

test("turning it off during the schedule rests the schedule until it would end", () => {
  const s = nightly()
  const off = turnedOff(s, at(MON, 23))
  assert.equal(off.skip, at(MON + 1, 7))
  assert.equal(dndActive(off, at(MON, 23, 30)), false)
  assert.equal(dndActive(off, at(MON + 1, 22, 30)), true, "the next night is quiet again")
  // turning it on by hand clears the rest
  assert.equal(dndActive(turnedOn(off, "off", at(MON, 23, 30)), at(MON, 23, 31)), true)
})

test("For 1 hour running into the schedule ends when the schedule does", () => {
  const s = turnedOn(nightly(), "hour", at(MON, 21, 30))
  assert.equal(dndEndsAt(s, at(MON, 21, 31)), at(MON + 1, 7))
})

test("who gets through: calls from favorites, reminders if allowed, nothing else", () => {
  const s = turnedOn({ ...DND_DEFAULTS, favorites: ["Sweet Pea"] }, "off", at(MON, 12))
  const t = at(MON, 13)
  assert.equal(dndAllows(s, { kind: "calls", from: "sweetpea" }, t), true)
  assert.equal(dndAllows(s, { kind: "calls", from: "Sweet Pea" }, t), true)
  assert.equal(dndAllows(s, { kind: "calls", from: "Stranger" }, t), false)
  assert.equal(dndAllows(s, { kind: "calls" }, t), false)
  assert.equal(dndAllows({ ...s, calls: "everyone" }, { kind: "calls", from: "Stranger" }, t), true)
  assert.equal(dndAllows({ ...s, calls: "none" }, { kind: "calls", from: "sweetpea" }, t), false)
  assert.equal(dndAllows(s, { kind: "calendar" }, t), true)
  assert.equal(dndAllows({ ...s, reminders: false }, { kind: "calendar" }, t), false)
  // your own alarms always ring, whatever else is held
  assert.equal(dndAllows({ ...s, reminders: false, calls: "none" }, { kind: "alarms" }, t), true)
  for (const kind of ["im", "mail", "games", "couples", "system"]) assert.equal(dndAllows(s, { kind }, t), false, kind)
  // off: everything gets through
  assert.equal(dndAllows(DND_DEFAULTS, { kind: "im" }, t), true)
})

test("wallClock in a time zone (the server's view of a schedule)", () => {
  // 2026-10-05 03:30 UTC is Sunday 23:30 in New York (EDT, UTC-4)
  const t = Date.UTC(2026, 9, 5, 3, 30)
  assert.deepEqual(wallClock(t, "America/New_York"), { day: 0, minutes: 23 * 60 + 30 })
  assert.deepEqual(wallClock(t, "UTC"), { day: 1, minutes: 3 * 60 + 30 })
  const s = nightly({ days: [0] })
  assert.equal(dndActive(s, t, "America/New_York"), true)
  assert.equal(dndActive(s, t, "Asia/Tokyo"), false) // Monday 12:30 there
})

test("daysLabel", () => {
  assert.equal(daysLabel([0, 1, 2, 3, 4, 5, 6]), "Every day")
  assert.equal(daysLabel([1, 2, 3, 4, 5]), "Weekdays")
  assert.equal(daysLabel([6, 0]), "Weekends")
  assert.equal(daysLabel([1, 3]), "Mon, Wed")
})
