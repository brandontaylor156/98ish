// Tasks (an Outlook 98-style task list): the rules, with no React and no storage, so Node can
// test them: node --test client/src/components/applets/tasks/tasksCore.test.js
//
// ONE SOURCE OF TRUTH: a task IS a to-do event in 98ish Calendar (`todo: true`), kept by the
// Calendar store (applets/calendar/store.js) in whichever calendar it belongs to: "On this
// device" (anyone, signed on or not), My Calendar, the couple's Us calendar or a group
// calendar (a shared task list). So tasks sync, share, repeat (recur.js), remind (in-app
// and Web Push, through the reminder path Calendar already has) and show in Calendar with
// no second copy to keep in step:
//   - due on a day:          an all-day to-do event on that date
//   - due at a time:         a timed to-do event (start = end = the due time)
//   - no due date (Someday): a to-do memo (memos are Calendar's dateless lists)
//   - repeating:             a repeating to-do event; ticking one occurrence marks just that
//                            occurrence done (an exception), and the next one shows up
//   - priority:              event.priority "high" | "low" | "" (normal)
//   - assigned to:           event.attendees (members of a shared calendar)
//   - notes, checklist:      the event's notes and checklist
// Memos with a checklist (Calendar's lists) show under Someday too, to tick off.

import { addDays, dateIn, dateLabel, occurrences, timeLabel, startMs, WEEKDAYS, zonedTime, daysBetween } from "../calendar/recur.js"

export const PRIORITIES = [
  ["high", "High"],
  ["", "Normal"],
  ["low", "Low"],
]
const RANK = { high: 0, "": 1, low: 2 }
export const VIEWS = [
  ["today", "Today"],
  ["upcoming", "Upcoming"],
  ["someday", "Someday"],
  ["done", "Done"],
]
const DAY = 86_400_000
const DONE_DAYS = 30 // done occurrences of repeating tasks listed under Done this long

export const isTask = (event) => event?.todo === true
export const isList = (event) => event?.kind === "memo" && !event.todo && (event.checklist || []).length > 0

const base = (calendar, event) => ({
  calendarId: calendar.id,
  calendarName: calendar.name,
  shared: calendar.kind !== "local" && (calendar.members || []).length > 1,
  id: event.id,
  event,
  title: event.title || "(No title)",
  notes: event.notes || "",
  checklist: event.checklist || [],
  priority: event.priority || "",
  assigned: event.attendees || [],
  recurring: !!event.repeat,
  list: isList(event),
  doneAt: event.updatedAt || 0,
})

const fromOcc = (calendar, event, occ, zone) => ({
  ...base(calendar, event),
  rowKey: `${calendar.id}:${event.id}:${occ.key || ""}`,
  key: occ.recurring ? occ.key : null,
  occ,
  title: occ.title || "(No title)",
  notes: occ.notes || "",
  checklist: occ.checklist || [],
  done: !!occ.done,
  allDay: occ.allDay,
  dueDate: occ.allDay ? occ.start : dateIn(occ.start, zone),
  due: occ.allDay ? null : occ.start,
  sortTime: startMs(occ, zone),
})

// Every task (and Calendar list) in the calendars -> rows
//   calendars: [{ id, name, kind, members, readOnly }], events: { [calendarId]: [event] }
export const taskRows = (calendars, events, { now = Date.now(), zone = "UTC" } = {}) => {
  const rows = []
  for (const calendar of calendars) {
    if (calendar.readOnly) continue
    for (const event of events[calendar.id] || []) {
      if (!isTask(event) && !isList(event)) continue
      if (event.kind === "memo" || event.start === null || event.start === undefined) {
        rows.push({ ...base(calendar, event), rowKey: `${calendar.id}:${event.id}:`, key: null, occ: null, done: isTask(event) && !!event.done, allDay: true, dueDate: null, due: null, sortTime: Infinity })
        continue
      }
      if (!event.repeat) {
        const at = event.allDay ? zonedTime(event.start, 12, 0, zone) : event.start
        const occ = occurrences(event, at - 3 * DAY, at + 3 * DAY + Math.max(0, (event.allDay ? 0 : (event.end ?? event.start) - event.start)), zone)[0]
        if (occ) rows.push(fromOcc(calendar, event, occ, zone))
        continue
      }
      // a repeating task: the first occurrence not done yet, and the ones done lately
      const occs = occurrences(event, now - 400 * DAY, now + 800 * DAY, zone)
      const next = occs.find((o) => !o.done)
      if (next) rows.push(fromOcc(calendar, event, next, zone))
      for (const o of occs) if (o.done && startMs(o, zone) > now - DONE_DAYS * DAY && startMs(o, zone) < now + 800 * DAY) rows.push({ ...fromOcc(calendar, event, o, zone), doneAt: startMs(o, zone) })
    }
  }
  return rows
}

const byDue = (a, b) => a.sortTime - b.sortTime || RANK[a.priority || ""] - RANK[b.priority || ""] || a.title.localeCompare(b.title)
const byPriority = (a, b) => RANK[a.priority || ""] - RANK[b.priority || ""] || b.doneAt - a.doneAt || a.title.localeCompare(b.title)

// rows -> { today, upcoming, someday, done } (today includes anything overdue)
export const groupTasks = (rows, { now = Date.now(), zone = "UTC" } = {}) => {
  const today = dateIn(now, zone)
  const out = { today: [], upcoming: [], someday: [], done: [] }
  for (const row of rows) {
    if (row.done) out.done.push(row)
    else if (!row.dueDate) out.someday.push(row)
    else if (row.dueDate <= today) out.today.push({ ...row, overdue: row.dueDate < today || (row.due !== null && row.due < now) })
    else out.upcoming.push(row)
  }
  out.today.sort(byDue)
  out.upcoming.sort(byDue)
  out.someday.sort(byPriority)
  out.done.sort((a, b) => b.doneAt - a.doneAt)
  out.done = out.done.slice(0, 300)
  return out
}

// "Today", "Tomorrow, 9:00 AM", "Fri", "Mon, Oct 12", "Wed, Sep 30" (overdue: the date)
export const dueLabel = (row, { now = Date.now(), zone = "UTC" } = {}) => {
  if (!row.dueDate) return ""
  const today = dateIn(now, zone)
  const diff = daysBetween(today, row.dueDate)
  let day
  if (diff === 0) day = "Today"
  else if (diff === 1) day = "Tomorrow"
  else if (diff === -1) day = "Yesterday"
  else if (diff > 1 && diff < 7) day = WEEKDAYS[new Date(`${row.dueDate}T12:00:00Z`).getUTCDay()]
  else day = dateLabel(row.dueDate, { year: Math.abs(diff) > 300 })
  return row.due !== null && row.due !== undefined ? `${day}, ${timeLabel(row.due, zone)}` : day
}

// When a quick-add puts the due date: the view it was typed in
export const defaultWhen = (view) => (view === "upcoming" ? "tomorrow" : view === "someday" ? "someday" : "today")

// A new task from the Add task box / the task dialog -> a Calendar event to save
//   when: "today" | "tomorrow" | "someday" | "date" (with date "YYYY-MM-DD"); time "HH:MM" or ""
export const taskDraft = ({ title, when = "today", date = null, time = "", priority = "", reminder = null, repeat = null, notes = "", checklist = [], attendees = [], zone = "UTC", now = Date.now() } = {}) => {
  const today = dateIn(now, zone)
  const day = when === "today" ? today : when === "tomorrow" ? addDays(today, 1) : when === "date" ? date : null
  const common = { title: String(title || "").trim().slice(0, 120), notes, label: "", todo: true, done: false, priority: RANK[priority] !== undefined ? priority : "", checklist, attendees }
  if (!day) return { kind: "memo", ...common, location: "", reminders: [] }
  const reminders = reminder === null || reminder === undefined || reminder === "" ? [] : [Number(reminder)]
  const shared = { kind: "event", ...common, location: "", repeat: repeat || null, reminders, exceptions: {}, tz: zone }
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || "")
  if (!m) return { ...shared, allDay: true, start: day, end: day }
  const start = zonedTime(day, Number(m[1]), Number(m[2]), zone)
  return { ...shared, allDay: false, start, end: start }
}

// The fields of a task as the task dialog edits them (the reverse of taskDraft)
export const taskFields = (event, zone = "UTC") => {
  const dated = event.kind !== "memo" && event.start !== null && event.start !== undefined
  const date = !dated ? null : event.allDay ? event.start : dateIn(event.start, event.tz || zone)
  const time = dated && !event.allDay ? shortClock(event.start, event.tz || zone) : ""
  return {
    title: event.title || "",
    when: dated ? "date" : "someday",
    date,
    time,
    priority: event.priority || "",
    reminder: event.reminders?.length ? event.reminders[0] : null,
    repeat: event.repeat || null,
    notes: event.notes || "",
    checklist: event.checklist || [],
    attendees: event.attendees || [],
  }
}
const shortClock = (t, zone) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t))
  const get = (type) => p.find((x) => x.type === type)?.value || "00"
  return `${get("hour")}:${get("minute")}`
}

// What ticking a row does -> { occurrence: { key, change } } (one of a repeating task) or
// { event } (the whole task saved again)
export const doneChange = (row, done) => (row.key ? { occurrence: { key: row.key, change: { done } } } : { event: { ...row.event, done } })
export const checklistChange = (row, index, done) => {
  const checklist = row.checklist.map((c, i) => (i === index ? { ...c, done } : c))
  return row.key ? { occurrence: { key: row.key, change: { checklist } } } : { event: { ...row.event, checklist } }
}

// Search: every task's words -> [{ rowKey, title, text, ... }]
export const taskSearchText = (row) => [row.title, row.notes, ...row.checklist.map((c) => c.text)].filter(Boolean).join(" ")

export const counts = (groups) => Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]))
