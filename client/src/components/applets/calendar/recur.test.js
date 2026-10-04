import test from "node:test"
import assert from "node:assert/strict"
import {
  addDays,
  addMonths,
  dateIn,
  describeRepeat,
  dueReminders,
  lastRuleDate,
  monthGrid,
  occurrences,
  onDate,
  reminderTimes,
  ruleDates,
  weekdayOf,
  zonedTime,
  zoneParts,
} from "./recur.js"

const CHI = "America/Chicago"
const SYD = "Australia/Sydney"
const at = (iso) => Date.parse(iso)
const HOUR = 3_600_000

test("date helpers", () => {
  assert.equal(addDays("2026-02-27", 2), "2026-03-01")
  assert.equal(addDays("2024-02-28", 1), "2024-02-29")
  assert.equal(weekdayOf("2026-10-03"), 6) // a Saturday
  assert.equal(weekdayOf("1970-01-01"), 4)
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28")
  const grid = monthGrid(2026, 10)
  assert.equal(grid.length, 42)
  assert.equal(grid[0], "2026-09-27")
  assert.equal(weekdayOf(grid[0]), 0)
})

test("wall-clock times across daylight saving", () => {
  // Chicago: CDT (UTC-5) until Nov 1 2026, then CST (UTC-6)
  assert.equal(zonedTime("2026-10-31", 9, 0, CHI), at("2026-10-31T14:00:00Z"))
  assert.equal(zonedTime("2026-11-02", 9, 0, CHI), at("2026-11-02T15:00:00Z"))
  // 2:30 on the spring-forward night (Mar 8 2026) doesn't exist: 3:30 CDT
  assert.equal(zonedTime("2026-03-08", 2, 30, CHI), at("2026-03-08T08:30:00Z"))
  assert.equal(zoneParts(zonedTime("2026-03-08", 2, 30, CHI), CHI).h, 3)
  // 1:30 on the fall-back night (Nov 1 2026) happens twice: the first (CDT)
  assert.equal(zonedTime("2026-11-01", 1, 30, CHI), at("2026-11-01T06:30:00Z"))
  // the southern hemisphere goes the other way (Sydney starts DST Oct 4 2026)
  assert.equal(zonedTime("2026-10-03", 9, 0, SYD), at("2026-10-02T23:00:00Z"))
  assert.equal(zonedTime("2026-10-05", 9, 0, SYD), at("2026-10-04T22:00:00Z"))
  // a zone with a 30-minute offset
  assert.equal(zonedTime("2026-01-01", 0, 0, "Asia/Kolkata"), at("2025-12-31T18:30:00Z"))
})

test("a weekly 9:00 stays 9:00 through the clocks changing", () => {
  const event = { id: "e1", allDay: false, start: at("2026-10-26T14:00:00Z"), end: at("2026-10-26T15:00:00Z"), tz: CHI, title: "Standup", repeat: { freq: "weekly", interval: 1 } }
  const list = occurrences(event, at("2026-10-25T00:00:00Z"), at("2026-11-20T00:00:00Z"), CHI)
  assert.deepEqual(list.map((o) => o.key), ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"])
  for (const o of list) {
    assert.equal(zoneParts(o.start, CHI).h, 9)
    assert.equal(o.end - o.start, HOUR)
  }
  // the instant moved an hour (UTC 14:00 -> 15:00)
  assert.equal(new Date(list[1].start).getUTCHours(), 15)
  // seen from Sydney it's a different local time, same instants
  const fromSydney = occurrences(event, at("2026-10-25T00:00:00Z"), at("2026-11-20T00:00:00Z"), SYD)
  assert.deepEqual(fromSydney.map((o) => o.start), list.map((o) => o.start))
})

test("repeat rules: daily, weekly days, monthly, yearly, until and count", () => {
  assert.deepEqual(ruleDates("2026-10-01", { freq: "daily", interval: 2 }, "2026-10-01", "2026-10-08"), ["2026-10-01", "2026-10-03", "2026-10-05", "2026-10-07"])
  // weekdays only, starting on a Thursday
  assert.deepEqual(ruleDates("2026-10-01", { freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5] }, "2026-10-01", "2026-10-07"), ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"])
  // every other week on Tue and Sat
  assert.deepEqual(ruleDates("2026-10-06", { freq: "weekly", interval: 2, byDay: [2, 6] }, "2026-10-01", "2026-10-31"), ["2026-10-06", "2026-10-10", "2026-10-20", "2026-10-24"])
  // the 31st: months without one are skipped
  assert.deepEqual(ruleDates("2026-01-31", { freq: "monthly", interval: 1 }, "2026-01-01", "2026-06-30"), ["2026-01-31", "2026-03-31", "2026-05-31"])
  // the second Tuesday of each month
  assert.deepEqual(ruleDates("2026-10-13", { freq: "monthly", interval: 1, monthly: "weekday" }, "2026-10-01", "2027-01-31"), ["2026-10-13", "2026-11-10", "2026-12-08", "2027-01-12"])
  // the last Friday
  assert.deepEqual(ruleDates("2026-10-30", { freq: "monthly", interval: 1, monthly: "lastWeekday" }, "2026-10-01", "2027-01-31"), ["2026-10-30", "2026-11-27", "2026-12-25", "2027-01-29"])
  // Feb 29 comes around in leap years only
  assert.deepEqual(ruleDates("2024-02-29", { freq: "yearly", interval: 1 }, "2024-01-01", "2033-01-01"), ["2024-02-29", "2028-02-29", "2032-02-29"])
  // until is inclusive; count counts from the very first
  assert.deepEqual(ruleDates("2026-10-01", { freq: "daily", interval: 1, until: "2026-10-03" }, "2026-09-01", "2026-12-01"), ["2026-10-01", "2026-10-02", "2026-10-03"])
  assert.deepEqual(ruleDates("2026-10-01", { freq: "weekly", interval: 1, count: 3 }, "2026-10-10", "2026-12-01"), ["2026-10-15"])
  assert.equal(lastRuleDate("2026-10-01", { freq: "weekly", interval: 1, count: 3 }), "2026-10-15")
  assert.equal(lastRuleDate("2026-10-01", { freq: "weekly", interval: 1 }), null)
  // far in the future, quickly
  const t = Date.now()
  assert.deepEqual(ruleDates("2000-01-01", { freq: "daily", interval: 1 }, "2090-05-01", "2090-05-02"), ["2090-05-01", "2090-05-02"])
  assert.ok(Date.now() - t < 500)
})

test("exceptions: one occurrence deleted, one changed and moved", () => {
  const event = {
    id: "e2",
    allDay: false,
    start: at("2026-10-05T23:00:00Z"), // Mon 6pm Chicago
    end: at("2026-10-06T00:00:00Z"),
    tz: CHI,
    title: "Gym",
    repeat: { freq: "weekly", interval: 1 },
    exceptions: { "2026-10-12": { deleted: true }, "2026-10-19": { title: "Gym with Ana", start: at("2026-10-20T23:00:00Z"), end: at("2026-10-21T00:30:00Z") } },
  }
  const list = occurrences(event, at("2026-10-01T00:00:00Z"), at("2026-10-31T00:00:00Z"), CHI)
  assert.deepEqual(list.map((o) => o.key), ["2026-10-05", "2026-10-19", "2026-10-26"])
  assert.equal(list[1].title, "Gym with Ana")
  assert.equal(dateIn(list[1].start, CHI), "2026-10-20")
  assert.equal(list[1].end - list[1].start, 1.5 * HOUR)
  assert.equal(list[2].title, "Gym")
})

test("all-day events are dates, the same wherever you are", () => {
  const trip = { id: "t", allDay: true, start: "2026-10-09", end: "2026-10-11", title: "Trip" }
  for (const zone of [CHI, SYD, "UTC"]) {
    const from = zonedTime("2026-10-10", 0, 0, zone)
    const list = occurrences(trip, from, from + 86_400_000, zone)
    assert.equal(list.length, 1, zone)
    assert.ok(onDate(list[0], "2026-10-10", zone))
    assert.ok(!onDate(list[0], "2026-10-12", zone))
  }
  const birthday = { id: "b", allDay: true, start: "2000-03-15", end: "2000-03-15", title: "Ana's birthday", repeat: { freq: "yearly", interval: 1 } }
  const list = occurrences(birthday, at("2027-01-01T00:00:00Z"), at("2027-12-31T00:00:00Z"), CHI)
  assert.deepEqual(list.map((o) => o.start), ["2027-03-15"])
  assert.equal(describeRepeat(birthday.repeat, birthday.start), "Every year on March 15")
})

test("reminders: minutes before; all-day ones at 9:00 in the viewer's zone", () => {
  const timed = occurrences({ id: "m", allDay: false, start: at("2026-10-09T00:00:00Z"), end: at("2026-10-09T01:00:00Z"), tz: CHI, title: "Dinner", reminders: [0, 30, 1440] }, at("2026-10-01T00:00:00Z"), at("2026-10-31T00:00:00Z"), CHI)[0]
  assert.deepEqual(
    reminderTimes(timed, timed.reminders, CHI).map((r) => r.at),
    [at("2026-10-09T00:00:00Z"), at("2026-10-08T23:30:00Z"), at("2026-10-08T00:00:00Z")]
  )
  const allDay = occurrences({ id: "a", allDay: true, start: "2026-11-01", end: "2026-11-01", title: "Fall back", reminders: [0, 1440] }, at("2026-10-01T00:00:00Z"), at("2026-11-30T00:00:00Z"), CHI)[0]
  // Nov 1 9:00 is CST (UTC-6); Oct 31 9:00 is still CDT (UTC-5)
  assert.deepEqual(reminderTimes(allDay, allDay.reminders, CHI).map((r) => r.at), [at("2026-11-01T15:00:00Z"), at("2026-10-31T14:00:00Z")])
})

test("due reminders for a window of time, recurring ones included, once each", () => {
  const events = [
    { id: "w", allDay: false, start: at("2026-10-05T14:00:00Z"), end: at("2026-10-05T15:00:00Z"), tz: CHI, title: "Weekly", repeat: { freq: "weekly", interval: 1 }, reminders: [15], exceptions: { "2026-11-02": { deleted: true } } },
    { id: "x", allDay: false, start: at("2026-11-09T15:00:00Z"), end: at("2026-11-09T15:00:00Z"), tz: CHI, title: "No reminders", reminders: [] },
  ]
  // the deleted week has no reminder
  assert.equal(dueReminders(events, at("2026-11-02T00:00:00Z"), at("2026-11-03T00:00:00Z"), CHI).length, 0)
  const due = dueReminders(events, at("2026-11-09T14:00:00Z"), at("2026-11-09T15:00:00Z"), CHI)
  assert.equal(due.length, 1)
  assert.equal(due[0].at, at("2026-11-09T14:45:00Z")) // 8:45 CST
  assert.equal(due[0].fireKey, "w|2026-11-09|15")
  // windows that touch don't fire twice
  const a = dueReminders(events, at("2026-11-09T14:00:00Z"), at("2026-11-09T14:45:00Z"), CHI)
  const b = dueReminders(events, at("2026-11-09T14:45:00Z"), at("2026-11-09T15:30:00Z"), CHI)
  assert.equal(a.length + b.length, 1)
  // a filter (only my events, a muted calendar) skips some
  assert.equal(dueReminders(events, at("2026-11-09T14:00:00Z"), at("2026-11-09T15:00:00Z"), CHI, { wants: () => false }).length, 0)
})

test("describes repeats in words", () => {
  assert.equal(describeRepeat(null, "2026-10-01"), "Does not repeat")
  assert.equal(describeRepeat({ freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5] }, "2026-10-01"), "Every week on weekdays")
  assert.equal(describeRepeat({ freq: "monthly", interval: 1, monthly: "weekday" }, "2026-10-13"), "Every month on the second Tuesday")
  assert.equal(describeRepeat({ freq: "daily", interval: 3, count: 5 }, "2026-10-13"), "Every 3 days, 5 times")
})
