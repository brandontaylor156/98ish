import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import ContextMenu from "../../shared/ContextMenu"
import MoreOptions from "../../shared/MoreOptions"
import { useLongPress } from "../../../hooks/useLongPress"
import { helpItem } from "../../../utils/help"
import { changeOccurrence, deleteEvent, isReadOnly, moveEvent, openCalendar, pickDefault, saveEvent, useCalendar, zone as viewZone } from "../calendar/store"
import { addDays, dateIn, describeReminder, describeRepeat } from "../calendar/recur"
import { Tick } from "../notes/Checklist"
import { PRIORITIES, VIEWS, checklistChange, defaultWhen, doneChange, dueLabel, groupTasks, taskDraft, taskFields, taskRows } from "./tasksCore"
import "./Tasks.css"

// Tasks: an Outlook 98-style task list (Start > Programs > Accessories > Tasks). It opens to
// Today with a big Add task box; Upcoming, Someday and Done are tabs. A task is a to-do event
// in 98ish Calendar (see tasksCore.js for why), so it shows in Calendar, syncs and is shared
// with the calendar it's in, and reminds through Calendar's reminders (in 98ish and by push).
// Due date, time, priority, reminder, repeat, list and notes wait under More options.
// handoff: { id, calendarId, eventId } opens that task.

const REMINDERS = [
  ["", "No reminder"],
  ["0", "At the due time"],
  ["15", "15 minutes before"],
  ["60", "1 hour before"],
  ["1440", "1 day before"],
]
const REPEATS = [
  ["", "Doesn't repeat"],
  ["daily", "Every day"],
  ["weekdays", "Every weekday"],
  ["weekly", "Every week"],
  ["monthly", "Every month"],
  ["yearly", "Every year"],
]
const repeatOf = (choice) => (!choice ? null : choice === "weekdays" ? { freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5] } : { freq: choice, interval: 1 })
const choiceOf = (repeat) => (!repeat ? "" : repeat.freq === "weekly" && repeat.byDay?.join() === "1,2,3,4,5" ? "weekdays" : repeat.freq)
const priorityName = (p) => PRIORITIES.find(([id]) => id === p)?.[1] || "Normal"

const PriorityMark = ({ p }) => (p === "high" ? <span className="tkPri tkPri--high" title="High priority" aria-label="High priority">!</span> : p === "low" ? <span className="tkPri tkPri--low" title="Low priority" aria-label="Low priority">↓</span> : null)

const Row = ({ row, now, zone, onTick, onOpen, onMenu, onCheck }) => {
  const longPress = useLongPress((x, y) => onMenu(row, x, y))
  const label = dueLabel(row, { now, zone })
  const done = row.checklist.filter((c) => c.done).length
  return (
    <li className={`tkRow${row.done ? " is-done" : ""}${row.overdue ? " is-overdue" : ""}`} data-task={row.id}>
      {row.list ? <span className="tkListIcon" aria-hidden="true">☰</span> : <Tick checked={row.done} label={`Done: ${row.title}`} onChange={(d) => onTick(row, d)} />}
      <button
        type="button"
        className="tkRowMain"
        onClick={() => onOpen(row)}
        onContextMenu={(e) => {
          e.preventDefault()
          onMenu(row, e.clientX, e.clientY)
        }}
        {...longPress}
      >
        <span className="tkTitle">
          <PriorityMark p={row.priority} />
          {row.title}
        </span>
        <span className="tkMeta">
          {label && <span className={`tkDue${row.overdue ? " is-late" : ""}`}>{label}</span>}
          {row.recurring && <span title="Repeats">↻</span>}
          {row.event.reminders?.length > 0 && !row.done && <span title="Reminder">⏰</span>}
          {row.checklist.length > 0 && (
            <span>
              {done}/{row.checklist.length}
            </span>
          )}
          {(row.shared || row.calendarId === "local" || row.list) && <span className="tkList">{row.calendarName}</span>}
        </span>
      </button>
      {row.checklist.length > 0 && row.list && (
        <ul className="tkSubs">
          {row.checklist.map((c, i) => (
            <li key={i}>
              <Tick checked={c.done} label={c.text} onChange={(d) => onCheck(row, i, d)}>
                <span className={c.done ? "tkSubDone" : ""}>{c.text}</span>
              </Tick>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

// the fields under More options (Add task) and in the task dialog
const Fields = ({ f, set, calendars, members, showTitle = false }) => {
  const dated = f.when !== "someday"
  return (
    <div className="tkFields">
      {showTitle && (
        <label className="tkField tkField--wide">
          <span>Task:</span>
          <input type="text" value={f.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
        </label>
      )}
      <label className="tkField">
        <span>Due:</span>
        <select value={f.when} onChange={(e) => set({ when: e.target.value, date: e.target.value === "date" ? f.date || dateIn(Date.now(), viewZone()) : f.date })}>
          <option value="today">Today</option>
          <option value="tomorrow">Tomorrow</option>
          <option value="date">On a date...</option>
          <option value="someday">Someday (no date)</option>
        </select>
      </label>
      {f.when === "date" && (
        <label className="tkField">
          <span>Date:</span>
          <input type="date" value={f.date || ""} onChange={(e) => set({ date: e.target.value })} />
        </label>
      )}
      {dated && (
        <label className="tkField">
          <span>Time:</span>
          <input type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} />
        </label>
      )}
      <label className="tkField">
        <span>Priority:</span>
        <select value={f.priority} onChange={(e) => set({ priority: e.target.value })}>
          {PRIORITIES.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {dated && (
        <label className="tkField">
          <span>Reminder:</span>
          <select value={f.reminder === null || f.reminder === undefined ? "" : String(f.reminder)} onChange={(e) => set({ reminder: e.target.value === "" ? null : Number(e.target.value) })}>
            {REMINDERS.map(([v, name]) => (
              <option key={v} value={v}>
                {v !== "" && !f.time ? describeReminder(Number(v), true) : name}
              </option>
            ))}
          </select>
        </label>
      )}
      {dated && (
        <label className="tkField">
          <span>Repeat:</span>
          <select value={choiceOf(f.repeat)} onChange={(e) => set({ repeat: repeatOf(e.target.value) })}>
            {REPEATS.map(([v, name]) => (
              <option key={v} value={v}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="tkField">
        <span>List:</span>
        <select value={f.calendarId} onChange={(e) => set({ calendarId: e.target.value, attendees: [] })}>
          {calendars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.members?.length > 1 && c.kind !== "local" ? " (shared)" : ""}
            </option>
          ))}
        </select>
      </label>
      {members.length > 1 && (
        <label className="tkField">
          <span>For:</span>
          <select value={f.attendees[0] || ""} onChange={(e) => set({ attendees: e.target.value ? [e.target.value] : [] })}>
            <option value="">Anyone</option>
            {members.map((m) => (
              <option key={m.key} value={m.key}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="tkField tkField--wide">
        <span>Notes:</span>
        <textarea rows={3} value={f.notes} maxLength={4000} onChange={(e) => set({ notes: e.target.value })} />
      </label>
    </div>
  )
}

const summaryOf = (f, calendars) =>
  [
    { today: "Due today", tomorrow: "Due tomorrow", someday: "Someday", date: f.date ? `Due ${f.date}` : "Due on a date" }[f.when] + (f.time && f.when !== "someday" ? ` ${f.time}` : ""),
    `${priorityName(f.priority)} priority`,
    f.reminder !== null && f.reminder !== undefined && f.when !== "someday" ? "Reminder" : null,
    f.repeat && f.when !== "someday" ? describeRepeat(f.repeat, f.date || dateIn(Date.now(), viewZone())) : null,
    calendars.find((c) => c.id === f.calendarId)?.name,
  ]
    .filter(Boolean)
    .join(" · ")

const blankFields = (view, calendarId) => ({ title: "", when: defaultWhen(view), date: null, time: "", priority: "", reminder: null, repeat: null, notes: "", checklist: [], attendees: [], calendarId })

const Tasks = ({ mobile, handoff, onTitle }) => {
  const cal = useCalendar()
  const z = viewZone()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const [view, setView] = useState("today")
  const writable = cal.calendars.filter((c) => !isReadOnly(c))
  const [add, setAdd] = useState(() => blankFields("today", pickDefault(cal)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [edit, setEdit] = useState(null) // { row, f }
  const [menu, setMenu] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const input = useRef(null)

  useEffect(() => onTitle?.("Tasks"), [])
  useEffect(() => {
    // the list new tasks go in follows Calendar's default until one is picked
    if (!writable.some((c) => c.id === add.calendarId)) setAdd((a) => ({ ...a, calendarId: pickDefault(cal) }))
  }, [cal.calendars])

  const rows = useMemo(() => taskRows(cal.calendars, cal.events, { now, zone: z }), [cal.events, cal.calendars, now, z])
  const groups = useMemo(() => groupTasks(rows, { now, zone: z }), [rows, now, z])
  const shown = groups[view]

  // open a task asked for (search, a reminder, a notification)
  useEffect(() => {
    if (!handoff?.eventId) return
    const row = rows.find((r) => r.id === handoff.eventId && (!handoff.calendarId || r.calendarId === handoff.calendarId))
    if (!row) return
    setView(row.done ? "done" : !row.dueDate ? "someday" : groups.today.some((r) => r.rowKey === row.rowKey) ? "today" : "upcoming")
    openRow(row)
  }, [handoff?.id, rows.length > 0])

  const act = async (fn) => {
    setError(null)
    const result = await fn()
    if (result && result.ok === false) setError(result.error || "That didn't work.")
    return result
  }

  const changeView = (v) => {
    setView(v)
    if (v !== "done") setAdd((a) => ({ ...a, when: a.when === "date" ? a.when : defaultWhen(v) }))
  }

  const submit = async (e) => {
    e?.preventDefault()
    if (!add.title.trim() || busy) return
    setBusy(true)
    const draft = taskDraft({ ...add, zone: z, now: Date.now() })
    const result = await act(() => saveEvent(add.calendarId, draft))
    setBusy(false)
    if (!result?.ok) return
    setAdd((a) => ({ ...a, title: "" }))
    const target = draft.kind === "memo" ? "someday" : add.when === "today" || (add.when === "date" && add.date <= dateIn(Date.now(), z)) ? "today" : "upcoming"
    if (view !== target && view !== "done") setView(target)
    input.current?.focus()
  }

  const apply = (row, change) => (change.occurrence ? changeOccurrence(row.calendarId, row.id, change.occurrence.key, change.occurrence.change) : saveEvent(row.calendarId, change.event))
  const tick = (row, done) => act(() => apply(row, doneChange(row, done)))
  const check = (row, i, done) => act(() => apply(row, checklistChange(row, i, done)))

  const openRow = (row) => {
    if (row.list) return openCalendar({ calendarId: row.calendarId, eventId: row.id })
    setEdit({ row, f: { ...taskFields(row.event, z), calendarId: row.calendarId } })
  }

  const saveEdit = async () => {
    const { row, f } = edit
    if (!f.title.trim()) return setError("A task needs a name.")
    const draft = taskDraft({ ...f, zone: z, now: Date.now() })
    // keep what the dialog doesn't change (done, exceptions of a repeating task)
    const event = { ...row.event, ...draft, id: row.event.id, done: row.event.done, exceptions: draft.kind === "memo" || !draft.repeat ? {} : row.event.exceptions || {} }
    if (draft.kind === "memo") for (const k of ["start", "end", "allDay", "tz", "repeat", "reminders"]) delete event[k]
    const result = await act(() => (f.calendarId !== row.calendarId ? moveEvent(row.calendarId, f.calendarId, event) : saveEvent(row.calendarId, event)))
    if (result?.ok) setEdit(null)
  }

  const remove = async (row) => {
    const result = await act(() => deleteEvent(row.calendarId, row.id))
    if (result?.ok !== false) setEdit(null)
    setConfirm(null)
  }

  const menuFor = (row) => [
    { label: "Open", bold: true, onClick: () => openRow(row) },
    ...(row.list ? [] : [{ label: row.done ? "Mark Not Done" : "Mark Done", onClick: () => tick(row, !row.done) }]),
    ...(row.list || row.done || !row.dueDate
      ? []
      : [
          { label: "Due Tomorrow", onClick: () => act(() => saveEvent(row.calendarId, { ...row.event, ...moveDue(row.event, addDays(dateIn(now, z), 1)) })) },
          { label: "Due Next Week", onClick: () => act(() => saveEvent(row.calendarId, { ...row.event, ...moveDue(row.event, addDays(dateIn(now, z), 7)) })) },
        ]),
    { label: "Priority", items: PRIORITIES.map(([id, name]) => ({ label: name, checked: row.priority === id, onClick: () => act(() => saveEvent(row.calendarId, { ...row.event, priority: id })) })) },
    { label: "Show in Calendar", onClick: () => openCalendar(row.dueDate ? { calendarId: row.calendarId, eventId: row.id, key: row.key, date: row.dueDate } : { calendarId: row.calendarId, eventId: row.id }) },
    "-",
    { label: "Delete", onClick: () => setConfirm(row) },
  ]
  // a non-repeating task moved to another day (keeping its time)
  const moveDue = (event, date) => {
    if (event.repeat) return {}
    if (event.allDay) return { start: date, end: date }
    const f = taskFields(event, z)
    const d = taskDraft({ when: "date", date, time: f.time, zone: event.tz || z })
    return { start: d.start, end: d.end }
  }

  const menus = [
    {
      label: "File",
      items: [
        { label: "New Task", onClick: () => input.current?.focus() },
        { label: "Open Calendar", onClick: () => openCalendar({}) },
      ],
    },
    { label: "View", items: VIEWS.map(([id, name]) => ({ label: `${name} (${groups[id].length})`, checked: view === id, onClick: () => changeView(id) })) },
    { label: "Help", items: [helpItem({ program: "Tasks" })] },
  ]

  const members = (id) => cal.calendars.find((c) => c.id === id && c.kind !== "local")?.members || []
  const empty = {
    today: "Nothing due today. Type a task above and press Enter.",
    upcoming: "Nothing coming up. Tasks with a due date after today show here.",
    someday: "Tasks with no date wait here (and Calendar's memo lists).",
    done: "Ticked tasks show here.",
  }[view]

  return (
    <div className={`tkRoot${mobile ? " is-phone" : ""}`}>
      {!mobile && <MenuBar menus={menus} />}
      <div className="tkTabs" role="tablist" aria-label="Tasks">
        {VIEWS.map(([id, name]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className={`tkTab${view === id ? " is-on" : ""}`} onClick={() => changeView(id)}>
            {name}
            {groups[id].length > 0 && id !== "done" ? ` (${groups[id].length})` : ""}
          </button>
        ))}
      </div>
      <div className="tkBody">
        {view !== "done" && (
          <form className="tkAdd" onSubmit={submit}>
            <div className="tkAddRow">
              <input ref={input} type="text" className="tkAddInput" placeholder="Add a task" aria-label="Add a task" value={add.title} maxLength={120} onChange={(e) => setAdd({ ...add, title: e.target.value })} />
              <button type="submit" className="tkAddBtn" disabled={!add.title.trim() || busy}>
                Add task
              </button>
            </div>
            <MoreOptions id="tasks.add" className="tkMore" summary={summaryOf(add, writable)}>
              <Fields f={add} set={(p) => setAdd({ ...add, ...p })} calendars={writable} members={members(add.calendarId)} />
            </MoreOptions>
          </form>
        )}
        {error && (
          <p className="tkError" role="alert">
            {error}
          </p>
        )}
        {cal.status === "loading" && <p className="tkHint">Loading your calendars...</p>}
        {shown.length ? (
          <ul className="tkRows" aria-label={VIEWS.find(([id]) => id === view)[1]}>
            {shown.map((row) => (
              <Row key={row.rowKey} row={row} now={now} zone={z} onTick={tick} onCheck={check} onOpen={openRow} onMenu={(r, x, y) => setMenu({ x, y, items: menuFor(r) })} />
            ))}
          </ul>
        ) : (
          <div className="tkEmpty">{empty}</div>
        )}
      </div>
      {!mobile && (
        <div className="status-bar">
          <p className="status-bar-field">
            {groups.today.length} today · {groups.upcoming.length} upcoming · {groups.someday.length} someday
          </p>
          <p className="status-bar-field">{cal.status === "ready" ? "Synced with your calendars" : "On this device"}</p>
        </div>
      )}
      {menu && <ContextMenu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
      {edit && (
        <Dialog title="Task" okLabel="Save" onOk={saveEdit} onCancel={() => setEdit(null)}>
          <div className="tkDialog">
            <Fields f={edit.f} set={(p) => setEdit({ ...edit, f: { ...edit.f, ...p } })} calendars={writable} members={members(edit.f.calendarId)} showTitle />
            {edit.row.recurring && <p className="tkHint">Changes apply to every time it repeats.</p>}
            <div className="tkDialogRow">
              <button type="button" onClick={() => setConfirm(edit.row)}>
                Delete...
              </button>
              <button type="button" onClick={() => (setEdit(null), openCalendar({ calendarId: edit.row.calendarId, eventId: edit.row.id, key: edit.row.key, date: edit.row.dueDate || undefined }))}>
                Open in Calendar
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {confirm && (
        <Dialog title="Delete Task" okLabel="Delete" sound="ding" onOk={() => remove(confirm)} onCancel={() => setConfirm(null)}>
          <p className="dialogText">
            Delete "{confirm.title}"{confirm.recurring ? " and every time it repeats" : ""}? It's taken off the calendar too{confirm.shared ? ", for everyone in it" : ""}.
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default Tasks
