// Tests for the 98-style pickers' pure parts: reading a select's options, the open list's
// keyboard (moves, type-ahead, commit/cancel), date grid math, value formats and times.
// Run: node --test client/src/components/shared/select/select.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { findTyped, listKey, pickable, readItems, rowOfIndex, TYPE_PAUSE } from "./list.js"
import {
  addDays,
  addMonths,
  clampDay,
  dayAllowed,
  dayKey,
  daysInMonth,
  formatFor,
  from12,
  minuteChoices,
  minuteStep,
  monthGrid,
  parseDate,
  parseDateTime,
  parseFor,
  parseMonth,
  parseTime,
  roundTime,
  timeLabel,
  to12,
  weekdayOf,
} from "./dates.js"
import { pickerKind } from "./fields.js"

// a select-like tree for readItems
const opt = (label, extra = {}) => ({ tagName: "OPTION", label, value: label.toLowerCase(), ...extra })
const group = (label, children, extra = {}) => ({ tagName: "OPTGROUP", label, children, ...extra, querySelectorAll: () => children })
const items = (children) => readItems({ children })

test("readItems: options, groups, disabled and hidden options", () => {
  const list = items([opt("Never"), group("Weekly", [opt("Mon"), opt("Tue", { disabled: true })]), group("Off", [opt("X")], { disabled: true }), opt("Gone", { hidden: true }), opt("Last")])
  assert.deepEqual(
    list.map((it) => [it.kind, it.label, it.index, !!it.disabled, !!it.inGroup]),
    [
      ["option", "Never", 0, false, false],
      ["group", "Weekly", undefined, false, false],
      ["option", "Mon", 1, false, true],
      ["option", "Tue", 2, true, true],
      ["group", "Off", undefined, true, false],
      ["option", "X", 3, true, true],
      // the hidden option still takes index 4
      ["option", "Last", 5, false, false],
    ]
  )
  assert.equal(rowOfIndex(list, 5), 6)
  assert.equal(rowOfIndex(list, 99), 0, "unknown index: the first pickable row")
  assert.equal(pickable(list[1]), false)
  assert.equal(pickable(list[3]), false)
})

const fruit = items(["Apple", "Apricot", "Banana", "Blueberry", "Cherry", "Date"].map((l) => opt(l)).concat([opt("Elder", { disabled: true }), opt("Fig")]))

test("listKey: arrows skip disabled rows and stop at the ends", () => {
  let s = { active: 5, query: "", typedAt: 0 }
  s = listKey(fruit, s, "ArrowDown")
  assert.equal(s.active, 7, "Elder is disabled")
  s = listKey(fruit, s, "ArrowDown")
  assert.equal(s.active, 7, "stays on the last")
  s = listKey(fruit, s, "ArrowUp")
  assert.equal(s.active, 5)
  assert.equal(listKey(fruit, { active: 0 }, "ArrowUp").active, 0)
  assert.equal(listKey(fruit, { active: 3 }, "Home").active, 0)
  assert.equal(listKey(fruit, { active: 0 }, "End").active, 7)
  assert.equal(listKey(fruit, { active: 0 }, "PageDown", { page: 3 }).active, 3)
  assert.equal(listKey(fruit, { active: 7 }, "PageUp", { page: 3 }).active, 3)
  assert.equal(listKey(fruit, { active: -1 }, "ArrowDown").active, 0)
})

test("listKey: Enter, Space, F4, Alt+arrow commit; Escape cancels; Tab commits and passes", () => {
  for (const key of ["Enter", "F4", " "]) assert.equal(listKey(fruit, { active: 2 }, key, { now: 5000 }).action, "commit", key)
  assert.equal(listKey(fruit, { active: 2 }, "ArrowDown", { alt: true }).action, "commit")
  assert.equal(listKey(fruit, { active: 2 }, "Escape").action, "cancel")
  const tab = listKey(fruit, { active: 2 }, "Tab")
  assert.equal(tab.action, "commit")
  assert.equal(tab.keepKey, true)
  const shift = { active: 2 }
  assert.equal(listKey(fruit, shift, "Shift"), shift, "other keys change nothing")
})

test("listKey: type-ahead finds words, cycles a repeated letter, and resets after a pause", () => {
  let s = { active: 0, query: "", typedAt: 0 }
  s = listKey(fruit, s, "b", { now: 2000 })
  assert.equal(s.active, 2)
  s = listKey(fruit, s, "l", { now: 2100 })
  assert.equal(s.active, 3, "'bl' is Blueberry")
  // a space inside a word is typed, not a choice
  assert.equal(listKey(fruit, s, " ", { now: 2200 }).action, undefined)
  s = listKey(fruit, { active: 0, query: "", typedAt: 0 }, "a", { now: 3000 })
  assert.equal(s.active, 1, "from Apple, 'a' moves to the next A")
  s = listKey(fruit, s, "a", { now: 3100 })
  assert.equal(s.active, 0, "'aa' cycles round the A's")
  s = listKey(fruit, s, "c", { now: 3100 + TYPE_PAUSE + 1 })
  assert.equal(s.active, 4, "a pause starts a new word")
  assert.equal(listKey(fruit, s, "e", { now: 9000 }).active, 4, "Elder is disabled: no move")
  assert.equal(findTyped(fruit, 0, "zz"), -1)
})

test("dates: parse and format each input type", () => {
  assert.deepEqual(parseDate("2026-10-03"), { y: 2026, m: 9, d: 3 })
  assert.equal(parseDate("2026-02-30"), null)
  assert.equal(parseDate(""), null)
  assert.deepEqual(parseMonth("2026-12"), { y: 2026, m: 11, d: 1 })
  assert.equal(parseMonth("2026-13"), null)
  assert.deepEqual(parseTime("07:05"), { h: 7, min: 5, s: 0 })
  assert.deepEqual(parseTime("23:59:30"), { h: 23, min: 59, s: 30 })
  assert.equal(parseTime("24:00"), null)
  assert.deepEqual(parseDateTime("2026-10-03T19:30"), { y: 2026, m: 9, d: 3, h: 19, min: 30, s: 0 })
  assert.equal(formatFor("date", { y: 2026, m: 0, d: 9 }), "2026-01-09")
  assert.equal(formatFor("month", { y: 987, m: 0 }), "0987-01")
  assert.equal(formatFor("time", { h: 9, min: 5 }), "09:05")
  assert.equal(formatFor("datetime-local", { y: 2026, m: 9, d: 3, h: 0, min: 0 }), "2026-10-03T00:00")
  for (const [type, s] of [["date", "2024-02-29"], ["time", "13:45"], ["datetime-local", "2026-12-31T23:55"], ["month", "2026-07"]])
    assert.equal(formatFor(type, parseFor(type, s)), s, `${type} round trip`)
})

test("dates: month grid, weekdays and day arithmetic", () => {
  assert.equal(daysInMonth(2024, 1), 29)
  assert.equal(daysInMonth(2026, 1), 28)
  assert.equal(weekdayOf({ y: 2026, m: 9, d: 3 }), 6, "Oct 3 2026 is a Saturday")
  const grid = monthGrid(2026, 9)
  assert.equal(grid.length, 42)
  // October 2026 starts on a Thursday: four grey September days first
  assert.deepEqual(grid[0], { y: 2026, m: 8, d: 27, inMonth: false })
  assert.deepEqual(grid[4], { y: 2026, m: 9, d: 1, inMonth: true })
  assert.equal(grid.filter((c) => c.inMonth).length, 31)
  assert.deepEqual(monthGrid(2026, 9, 1)[3], { y: 2026, m: 9, d: 1, inMonth: true }, "weeks from Monday")
  assert.deepEqual(addDays({ y: 2026, m: 11, d: 31 }, 1), { y: 2027, m: 0, d: 1 })
  assert.deepEqual(addDays({ y: 2024, m: 2, d: 1 }, -1), { y: 2024, m: 1, d: 29 })
  assert.deepEqual(addMonths({ y: 2026, m: 0, d: 31 }, 1), { y: 2026, m: 1, d: 28 })
  assert.deepEqual(addMonths({ y: 2026, m: 0, d: 15 }, -1), { y: 2025, m: 11, d: 15 })
  assert.deepEqual(addMonths({ y: 2026, m: 5, d: 15 }, 18), { y: 2027, m: 11, d: 15 })
})

test("dates: keyboard moves and min/max", () => {
  const d = { y: 2026, m: 9, d: 3 }
  assert.deepEqual(dayKey(d, "ArrowLeft"), { y: 2026, m: 9, d: 2 })
  assert.deepEqual(dayKey(d, "ArrowDown"), { y: 2026, m: 9, d: 10 })
  assert.deepEqual(dayKey(d, "ArrowUp"), { y: 2026, m: 8, d: 26 })
  assert.deepEqual(dayKey(d, "PageDown"), { y: 2026, m: 10, d: 3 })
  assert.deepEqual(dayKey(d, "PageUp", { shift: true }), { y: 2025, m: 9, d: 3 })
  assert.deepEqual(dayKey(d, "End"), { y: 2026, m: 9, d: 31 })
  assert.deepEqual(dayKey(d, "Home"), { y: 2026, m: 9, d: 1 })
  assert.equal(dayKey(d, "x"), null)
  const min = { y: 2026, m: 9, d: 5 }
  const max = { y: 2026, m: 9, d: 20 }
  assert.equal(dayAllowed(d, min, max), false)
  assert.equal(dayAllowed({ y: 2026, m: 9, d: 20 }, min, max), true)
  assert.equal(dayAllowed(d, null, null), true)
  assert.deepEqual(clampDay(d, min, max), min)
  assert.deepEqual(clampDay({ y: 2027, m: 0, d: 1 }, min, max), max)
})

test("times: steps, 12-hour clock, rounding and labels", () => {
  assert.equal(minuteStep(undefined), 1)
  assert.equal(minuteStep("300"), 5)
  assert.equal(minuteStep("900"), 15)
  assert.equal(minuteStep("420"), 1, "7 minutes doesn't divide an hour")
  assert.equal(minuteStep("30"), 1)
  assert.equal(minuteStep("any"), 1)
  assert.deepEqual(minuteChoices(15), [0, 15, 30, 45])
  assert.deepEqual(minuteChoices(15, 20), [0, 15, 20, 30, 45], "an off-step value stays choosable")
  assert.deepEqual(to12(0), { h12: 12, pm: false })
  assert.deepEqual(to12(12), { h12: 12, pm: true })
  assert.deepEqual(to12(15), { h12: 3, pm: true })
  assert.equal(from12(12, false), 0)
  assert.equal(from12(12, true), 12)
  assert.equal(from12(3, true), 15)
  assert.deepEqual(roundTime({ h: 9, min: 58 }, 5), { h: 10, min: 0, s: 0 })
  assert.deepEqual(roundTime({ h: 23, min: 58 }, 5), { h: 0, min: 0, s: 0 })
  assert.equal(timeLabel({ h: 0, min: 5 }, true), "12:05 AM")
  assert.equal(timeLabel({ h: 13, min: 30 }, true), "1:30 PM")
  assert.equal(timeLabel({ h: 13, min: 30 }, false), "13:30")
})

test("pickerKind: which fields are taken over", () => {
  const el = (tagName, props = {}, attrs = {}) => ({
    nodeType: 1,
    tagName,
    disabled: false,
    readOnly: false,
    multiple: false,
    size: 0,
    ...props,
    getAttribute: (n) => attrs[n] ?? null,
    closest: (sel) => (sel === "[data-native-select]" && attrs.native ? {} : null),
  })
  assert.equal(pickerKind(el("SELECT")), "list")
  assert.equal(pickerKind(el("SELECT", { multiple: true })), null)
  assert.equal(pickerKind(el("SELECT", { size: 5 })), null)
  assert.equal(pickerKind(el("SELECT", { disabled: true })), null)
  assert.equal(pickerKind(el("SELECT", {}, { native: true })), null)
  assert.equal(pickerKind(el("INPUT", {}, { type: "date" })), "date")
  assert.equal(pickerKind(el("INPUT", {}, { type: "datetime-local" })), "datetime-local")
  assert.equal(pickerKind(el("INPUT", { readOnly: true }, { type: "time" })), null)
  assert.equal(pickerKind(el("INPUT", {}, { type: "text" })), null)
  assert.equal(pickerKind(null), null)
})
