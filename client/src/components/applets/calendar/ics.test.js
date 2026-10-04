import test from "node:test"
import assert from "node:assert/strict"
import { escapeText, toICS } from "./ics.js"
import { dueAlarms } from "./clockStore.js"

const at = (iso) => Date.parse(iso)

test("iCalendar: text escaped, lines folded, repeats in the event's zone", () => {
  assert.equal(escapeText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne")
  const ics = toICS(
    [
      {
        id: "e1",
        title: "Yoga, then brunch; long title ".repeat(4).trim(),
        allDay: false,
        start: at("2026-10-05T13:00:00Z"),
        end: at("2026-10-05T14:00:00Z"),
        tz: "America/Chicago",
        repeat: { freq: "monthly", interval: 1, monthly: "weekday", count: 6 },
        exceptions: { "2026-11-02": { deleted: true }, "2026-12-07": { title: "Holiday yoga", start: at("2026-12-07T16:00:00Z"), end: at("2026-12-07T17:00:00Z") } },
        reminders: [15],
        notes: "Bring a mat",
        createdByName: "Ana",
      },
      { id: "e2", title: "Trip", allDay: true, start: "2026-10-09", end: "2026-10-11", reminders: [1440] },
      { id: "m1", kind: "memo", title: "Gift ideas", start: null },
    ],
    { name: "Us", stamp: at("2026-10-03T00:00:00Z"), byName: (e) => e.createdByName || "" }
  )
  const lines = ics.split("\r\n")
  assert.ok(lines.every((l) => new TextEncoder().encode(l).length <= 75))
  const unfolded = ics.replace(/\r\n /g, "")
  assert.match(unfolded, /DTSTART;TZID=America\/Chicago:20261005T080000/)
  assert.match(unfolded, /RRULE:FREQ=MONTHLY;BYDAY=1MO;COUNT=6/)
  assert.match(unfolded, /EXDATE;TZID=America\/Chicago:20261102T080000/)
  assert.match(unfolded, /RECURRENCE-ID;TZID=America\/Chicago:20261207T080000/)
  assert.match(unfolded, /SUMMARY:Holiday yoga/)
  assert.match(unfolded, /SUMMARY:Yoga\\, then brunch\\; long title/)
  assert.match(unfolded, /DESCRIPTION:Bring a mat\\n\\nAdded by Ana/)
  assert.match(unfolded, /DTSTART;VALUE=DATE:20261009\r\nDTEND;VALUE=DATE:20261012/)
  assert.match(unfolded, /TRIGGER:-PT900M/) // 9:00 the day before
  assert.ok(!unfolded.includes("Gift ideas")) // memos have no date
  assert.equal(unfolded.match(/BEGIN:VEVENT/g).length, 3)
})

test("alarms: the right minute, the right days, once", () => {
  const wall = { date: "2026-10-05", wd: 1, h: 7, mi: 30 }
  const alarms = [
    { id: "a", time: "07:30", days: [1, 2, 3, 4, 5], on: true, lastRang: null },
    { id: "b", time: "07:30", days: [0, 6], on: true, lastRang: null },
    { id: "c", time: "07:30", days: [], on: true, lastRang: "2026-10-05 07:30" },
    { id: "d", time: "07:31", days: [], on: true, lastRang: null },
    { id: "e", time: "07:30", days: [], on: false, lastRang: null },
    { id: "f", time: "07:30", days: [], on: true, lastRang: "2026-10-04 07:30" },
  ]
  assert.deepEqual(dueAlarms(alarms, wall).map((a) => a.id), ["a", "f"])
})
