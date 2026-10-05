import test from "node:test"
import assert from "node:assert/strict"
import { checklistChange, doneChange, dueLabel, groupTasks, taskDraft, taskFields, taskRows } from "./tasksCore.js"
import { zonedTime } from "../calendar/recur.js"

const Z = "America/Chicago"
// Wed, Oct 7, 2026, 10:00 in Chicago
const NOW = zonedTime("2026-10-07", 10, 0, Z)
const CAL = { id: "c1", name: "My Calendar", kind: "personal", members: [{ key: "me" }] }
const SHARED = { id: "c2", name: "Groceries", kind: "group", members: [{ key: "me" }, { key: "tina" }] }
const ev = (id, patch) => ({ id, ...taskDraft({ title: id, zone: Z, now: NOW, ...patch }), updatedAt: NOW - 1000 })

test("drafts: today, tomorrow, a time, someday", () => {
  const today = taskDraft({ title: "  Call mom ", zone: Z, now: NOW })
  assert.equal(today.kind, "event")
  assert.equal(today.todo, true)
  assert.equal(today.allDay, true)
  assert.equal(today.start, "2026-10-07")
  assert.equal(today.title, "Call mom")
  assert.equal(taskDraft({ title: "x", when: "tomorrow", zone: Z, now: NOW }).start, "2026-10-08")
  const timed = taskDraft({ title: "Dentist", when: "date", date: "2026-10-09", time: "14:30", reminder: 15, priority: "high", zone: Z, now: NOW })
  assert.equal(timed.allDay, false)
  assert.equal(timed.start, zonedTime("2026-10-09", 14, 30, Z))
  assert.equal(timed.end, timed.start)
  assert.deepEqual(timed.reminders, [15])
  assert.equal(timed.priority, "high")
  const someday = taskDraft({ title: "Learn guitar", when: "someday", zone: Z, now: NOW })
  assert.equal(someday.kind, "memo")
  assert.equal(someday.todo, true)
  // and back for the task dialog
  const f = taskFields({ ...timed, id: "x" }, Z)
  assert.deepEqual([f.when, f.date, f.time, f.priority, f.reminder], ["date", "2026-10-09", "14:30", "high", 15])
  assert.equal(taskFields(someday, Z).when, "someday")
})

test("grouping: overdue and today, upcoming, someday, done; priority order", () => {
  const events = {
    c1: [
      ev("late", { when: "date", date: "2026-10-05" }),
      ev("today-low", { priority: "low" }),
      ev("today-high", { priority: "high" }),
      ev("earlier-today", { time: "08:00" }),
      ev("friday", { when: "date", date: "2026-10-09" }),
      ev("someday", { when: "someday" }),
      { ...ev("finished", {}), done: true },
      { id: "event", kind: "event", title: "Not a task", allDay: true, start: "2026-10-07", end: "2026-10-07", todo: false },
      { id: "list", kind: "memo", title: "Packing", checklist: [{ text: "socks", done: false }] },
    ],
    c2: [ev("milk", {})],
  }
  const rows = taskRows([CAL, SHARED, { id: "b", readOnly: true }], events, { now: NOW, zone: Z })
  const g = groupTasks(rows, { now: NOW, zone: Z })
  assert.equal(g.today.length, 5)
  assert.equal(g.today[0].id, "late")
  assert.equal(g.today[0].overdue, true)
  // all-day today ones sort by priority; the 8:00 one (passed) is overdue
  const allDay = g.today.filter((r) => r.allDay && r.id !== "late").map((r) => r.id)
  assert.deepEqual(allDay, ["today-high", "milk", "today-low"])
  assert.equal(g.today.find((r) => r.id === "earlier-today").overdue, true)
  assert.equal(g.today.find((r) => r.id === "milk").shared, true)
  assert.deepEqual(g.upcoming.map((r) => r.id), ["friday"])
  assert.deepEqual(g.someday.map((r) => r.id).sort(), ["list", "someday"])
  assert.deepEqual(g.done.map((r) => r.id), ["finished"])
  assert.equal(dueLabel(g.upcoming[0], { now: NOW, zone: Z }), "Friday")
  assert.equal(dueLabel(g.today[0], { now: NOW, zone: Z }), "Mon, Oct 5")
  assert.equal(dueLabel(g.today.find((r) => r.id === "earlier-today"), { now: NOW, zone: Z }), "Today, 8:00 AM")
})

test("a repeating task: the next one not done; ticking one shows the next", () => {
  const weekly = ev("trash", { when: "date", date: "2026-10-06", repeat: { freq: "weekly", interval: 1 } })
  let rows = taskRows([CAL], { c1: [weekly] }, { now: NOW, zone: Z })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].dueDate, "2026-10-06")
  assert.equal(rows[0].key, "2026-10-06")
  // tick it: an exception for that occurrence
  const change = doneChange(rows[0], true)
  assert.deepEqual(change, { occurrence: { key: "2026-10-06", change: { done: true } } })
  const after = { ...weekly, exceptions: { "2026-10-06": { done: true } } }
  rows = taskRows([CAL], { c1: [after] }, { now: NOW, zone: Z })
  const g = groupTasks(rows, { now: NOW, zone: Z })
  assert.deepEqual(g.upcoming.map((r) => r.dueDate), ["2026-10-13"])
  assert.deepEqual(g.done.map((r) => r.dueDate), ["2026-10-06"])
  // a plain task saves the whole event
  const plain = taskRows([CAL], { c1: [ev("plain", { checklist: [{ text: "a", done: false }] })] }, { now: NOW, zone: Z })[0]
  assert.equal(doneChange(plain, true).event.done, true)
  assert.deepEqual(checklistChange(plain, 0, true).event.checklist, [{ text: "a", done: true }])
})
