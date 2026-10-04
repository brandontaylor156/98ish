import React, { useCallback, useEffect, useMemo, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import { launch } from "../../../utils/programs"
import { MONTHS, addDays, addMonths, dateIn, dateLabel, expandAll, monthGrid, occurrences, parseDate, startOfDay, weekdayOf } from "./recur"
import {
  LOCAL_ID,
  calendarById,
  changeOccurrence,
  colorOf,
  deleteEvent,
  findEvent,
  moveEvent,
  answerInvite,
  pickDefault,
  saveEvent,
  setDefaultCalendar,
  toggleHidden,
  uploadLocal,
  useCalendar,
  VIEW_EVENT,
  visibleEvents,
  zone as currentZone,
} from "./store"
import { AgendaView, DayList, HourGrid, MemoView, MiniMonth, MonthView, byDates } from "./views"
import { blankEvent, downloadCalendar, shiftSeries, splitSeries } from "./util"
import EventEditor from "./EventEditor"
import EventDetails from "./EventDetails"
import { CalendarSettings, JoinCalendar, NewCalendar } from "./CalendarSettings"
import Sheet from "./Sheet"
import CheckBox from "./CheckBox"
import { useSettings } from "../../../utils/settings"
import { weekStart } from "../../../utils/region"
import "./Calendar.css"

// 98ish Calendar: month, week, day, agenda and memos; your calendar on this device, your
// own calendar on 98ish, the Us calendar for couples, and group calendars shared with
// family and friends (live, with comments and an activity feed). The data lives in
// ./store.js and reminders ring from ./CalendarBridge.jsx, so they work with this closed.

const VIEW_KEY = "98ish.cal.view"
const VIEWS = [
  ["month", "Month"],
  ["week", "Week"],
  ["day", "Day"],
  ["agenda", "List"],
  ["memos", "Memos"],
]

const readView = () => {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    if (VIEWS.some(([id]) => id === v)) return v
  } catch {
    // no storage
  }
  return "month"
}

// An occurrence of an event by its key (its original date), or its first one
const occurrenceOf = (event, key, zone) => {
  if (event.kind === "memo") return { ...event, event, key: null, recurring: false, allDay: false, done: !!event.done, reminders: [], attendees: [], checklist: event.checklist || [] }
  const anchor = key || (event.allDay ? event.start : dateIn(event.start, event.tz || zone))
  const from = startOfDay(addDays(anchor, -45), zone)
  const to = startOfDay(addDays(anchor, 45), zone)
  const list = occurrences(event, from, to, zone)
  return list.find((o) => o.key === anchor) || list[0] || occurrences(event, -8.64e15, 8.64e15, zone)[0] || null
}

const ScopeAsk = ({ kind, mobile, onPick, onCancel, first }) => (
  <Sheet
    title={kind === "delete" ? "Delete Repeating Event" : "Change Repeating Event"}
    mobile={mobile}
    onClose={onCancel}
    className="calScope"
    footer={
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    }
  >
    <p>{kind === "delete" ? "This event repeats. Delete:" : "This event repeats. Change:"}</p>
    <div className="calScopeButtons">
      <button type="button" onClick={() => onPick("one")}>
        Only this event
      </button>
      {!first && (
        <button type="button" onClick={() => onPick("following")}>
          This and all after it
        </button>
      )}
      <button type="button" onClick={() => onPick("all")}>
        All events in the series
      </button>
    </div>
  </Sheet>
)

const Calendar = ({ calendarView: initial = {}, mobile, dispatch, onClose }) => {
  const cal = useCalendar()
  // Regional Settings: the first day of the week and 12/24-hour times
  const { region } = useSettings()
  const zone = currentZone()
  const today = dateIn(Date.now(), zone)
  const [selected, setSelected] = useState(initial.date || today)
  const [view, setViewState] = useState(readView)
  const [editor, setEditor] = useState(null) // { initial, isNew, occ }
  const [details, setDetails] = useState(null) // { calendarId, eventId, key, comments }
  const [scope, setScope] = useState(null) // { kind, run(scope), first }
  const [settings, setSettings] = useState(null) // { calendarId, tab }
  const [dialog, setDialog] = useState(initial.join ? { kind: "join", code: initial.join } : null) // newCal | join | confirm
  const [drawer, setDrawer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const [, setTick] = useState(0)

  const setView = (v) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // no storage
    }
  }

  // keep "today" right past midnight
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  // asked from outside: a reminder's Open Item, a toast, an invite link
  const follow = useCallback((detail = {}) => {
    if (detail.date) setSelected(detail.date)
    if (detail.join) setDialog({ kind: "join", code: detail.join })
    if (detail.calendarId && detail.eventId) {
      setDetails({ calendarId: detail.calendarId, eventId: detail.eventId, key: detail.key || null, comments: !!detail.comments })
      if (!detail.date) {
        const event = findEvent(detail.calendarId, detail.eventId)
        if (event && event.kind !== "memo") setSelected(event.allDay ? event.start : dateIn(event.start, zone))
      }
    } else if (detail.calendarId && detail.settings) setSettings({ calendarId: detail.calendarId, tab: detail.settings })
  }, [])
  useEffect(() => {
    follow(initial)
    const onView = (e) => e.detail?.program === "Calendar" && follow(e.detail)
    window.addEventListener(VIEW_EVENT, onView)
    return () => window.removeEventListener(VIEW_EVENT, onView)
  }, [])

  const p = parseDate(selected)
  const writable = cal.calendars.filter((c) => !cal.hidden.includes(c.id) && !c.readOnly)
  const events = visibleEvents(cal)

  // the dates on screen
  const dates = useMemo(() => {
    if (view === "month") return monthGrid(p.y, p.m)
    if (view === "week") return Array.from({ length: 7 }, (_, i) => addDays(selected, i - ((weekdayOf(selected) - weekStart() + 7) % 7)))
    if (view === "day") return [selected]
    if (view === "agenda") return Array.from({ length: 60 }, (_, i) => addDays(selected, i))
    return []
  }, [view, selected, region])

  const byDate = useMemo(() => {
    if (!dates.length) return new Map()
    const occs = expandAll(events, startOfDay(dates[0], zone), startOfDay(addDays(dates[dates.length - 1], 1), zone), zone)
    return byDates(occs, mobile && view === "month" ? [...new Set([...dates, selected])] : dates, zone)
  }, [events, dates, zone, selected, view, mobile])

  // the little month in the sidebar: which days have something
  const busyDays = useMemo(() => {
    if (mobile) return new Set()
    const grid = monthGrid(p.y, p.m)
    const occs = expandAll(events, startOfDay(grid[0], zone), startOfDay(addDays(grid[41], 1), zone), zone)
    const set = new Set()
    for (const o of occs) {
      if (o.allDay) for (let d = o.start; d <= o.end && d <= grid[41]; d = addDays(d, 1)) set.add(d)
      else set.add(dateIn(o.start, zone))
    }
    return set
  }, [events, p.y, p.m, zone])

  const memos = useMemo(() => events.filter((e) => e.kind === "memo").sort((a, b) => b.updatedAt - a.updatedAt), [events])

  // ---- moving around ----
  const step = (dir) => {
    if (view === "month") setSelected((s) => addMonths(s, dir))
    else if (view === "week") setSelected((s) => addDays(s, dir * 7))
    else if (view === "day") setSelected((s) => addDays(s, dir))
    else if (view === "agenda") setSelected((s) => addDays(s, dir * 30))
  }
  const heading = view === "month" || view === "memos" ? `${MONTHS[p.m - 1]} ${p.y}` : view === "week" ? (() => {
    const a = parseDate(dates[0])
    const b = parseDate(dates[6])
    return a.m === b.m ? `${MONTHS[a.m - 1].slice(0, 3)} ${a.d} - ${b.d}, ${b.y}` : `${MONTHS[a.m - 1].slice(0, 3)} ${a.d} - ${MONTHS[b.m - 1].slice(0, 3)} ${b.d}, ${b.y}`
  })() : view === "day" ? dateLabel(selected, { year: true }) : `From ${dateLabel(selected)}`

  // ---- events ----
  const say = (text, error = false) => {
    setStatus({ text, error })
    if (!error) setTimeout(() => setStatus((s) => (s?.text === text ? null : s)), 4000)
  }

  const newEvent = (date = selected, hour = null, allDay = false) => {
    const calendarId = pickDefault(cal)
    setEditor({ isNew: true, initial: blankEvent({ date, hour, allDay, zone, calendarId }) })
  }
  const newMemo = () => setEditor({ isNew: true, initial: blankEvent({ kind: "memo", calendarId: pickDefault(cal) }) })

  const openOcc = (occ) => setDetails({ calendarId: occ.calendarId, eventId: occ.id, key: occ.key })

  const shownEvent = details ? findEvent(details.calendarId, details.eventId, cal) : null
  const shownOcc = shownEvent ? occurrenceOf(shownEvent, details.key, zone) : null

  const act = async (fn, done) => {
    setBusy(true)
    const result = await fn()
    setBusy(false)
    if (!result?.ok) {
      say(result?.error || "That didn't work.", true)
      return result
    }
    done?.(result)
    return result
  }

  const saveDraft = async (draft, calendarId) => {
    const occ = editor.occ
    const old = editor.initial.id ? findEvent(editor.initial.calendarId, editor.initial.id) : null
    const finish = (r) => {
      setEditor(null)
      setDefaultCalendar(calendarId)
      if (draft.kind !== "memo") setSelected(draft.allDay ? draft.start : dateIn(draft.start, zone))
      say(editor.isNew ? `Added "${draft.title}".` : `Saved "${draft.title}".`)
      return r
    }
    if (!old) return act(() => saveEvent(calendarId, { ...draft, id: undefined }), finish)
    if (calendarId !== old.calendarId) return act(() => moveEvent(old.calendarId, calendarId, { ...old, ...draft }), finish)
    if (!old.repeat || !occ) return act(() => saveEvent(calendarId, { ...old, ...draft }), finish)
    // a repeating event: just this one, this and the rest, or all of them
    const first = occ.key === (old.allDay ? old.start : dateIn(old.start, old.tz || zone))
    setScope({
      kind: "save",
      first,
      run: (which) => {
        setScope(null)
        if (which === "one") {
          const change = { title: draft.title, location: draft.location, notes: draft.notes, label: draft.label, reminders: draft.reminders, checklist: draft.checklist }
          if (draft.allDay === occ.allDay && (draft.start !== occ.start || draft.end !== occ.end)) Object.assign(change, { start: draft.start, end: draft.end })
          return act(() => changeOccurrence(calendarId, old.id, occ.key, change), finish)
        }
        if (which === "following" && !first) {
          const { cut, rest } = splitSeries(old, occ.key, { ...old, ...draft })
          return act(async () => {
            const a = await saveEvent(calendarId, cut)
            if (!a.ok) return a
            return saveEvent(calendarId, rest)
          }, finish)
        }
        return act(() => saveEvent(calendarId, shiftSeries(old, occ, { ...old, ...draft })), finish)
      },
    })
  }

  const remove = (occ) => {
    const event = occ.event
    const done = () => {
      setDetails(null)
      say(`Deleted "${occ.title}".`)
    }
    if (!event.repeat) return setDialog({ kind: "confirm", text: `Delete "${occ.title}"${occ.calendarId !== LOCAL_ID && calendarById(occ.calendarId)?.members.length > 1 ? " for everyone in this calendar" : ""}?`, run: () => act(() => deleteEvent(occ.calendarId, event.id), done) })
    const first = occ.key === (event.allDay ? event.start : dateIn(event.start, event.tz || zone))
    setScope({
      kind: "delete",
      first,
      run: (which) => {
        setScope(null)
        if (which === "one") return act(() => changeOccurrence(occ.calendarId, event.id, occ.key, { deleted: true }), done)
        if (which === "following" && !first) {
          const { cut } = splitSeries(event, occ.key, event)
          return act(() => saveEvent(occ.calendarId, cut), done)
        }
        return act(() => deleteEvent(occ.calendarId, event.id), done)
      },
    })
  }

  const setDone = (occ, done) => {
    if (occ.event.repeat && occ.key) return act(() => changeOccurrence(occ.calendarId, occ.id, occ.key, { done }))
    return act(() => saveEvent(occ.calendarId, { ...occ.event, done }))
  }
  const setChecked = (occ, index, done) => {
    const checklist = occ.checklist.map((c, i) => (i === index ? { ...c, done } : c))
    if (occ.event.repeat && occ.key) return act(() => changeOccurrence(occ.calendarId, occ.id, occ.key, { checklist }))
    return act(() => saveEvent(occ.calendarId, { ...occ.event, checklist }))
  }

  const editOcc = (occ) => {
    const event = occ.event
    setDetails(null)
    if (event.kind === "memo") return setEditor({ isNew: false, initial: { ...event } })
    // edit what's on screen (this occurrence's times and changes)
    const initialDraft = { ...event, title: occ.title, location: occ.location, notes: occ.notes, label: occ.label, reminders: occ.reminders, checklist: occ.checklist, attendees: occ.attendees, done: occ.done, start: occ.start, end: occ.end }
    setEditor({ isNew: false, initial: initialDraft, occ: event.repeat ? occ : null })
  }

  // ---- the local calendar's upload ----
  const localCount = (cal.events[LOCAL_ID] || []).length
  const serverCalendars = cal.calendars.filter((c) => !c.local)
  const [uploadTo, setUploadTo] = useState("")
  const upload = () => {
    const target = uploadTo || serverCalendars.find((c) => c.kind === "personal")?.id
    if (!target) return
    act(() => uploadLocal(target), (r) => say(`Uploaded ${r.count} event${r.count === 1 ? "" : "s"}. They're on every device you sign on with now.`))
  }

  const signOn = () => dispatch?.({ type: "open_window", payload: launch("98 Messenger") })

  // ---- the sidebar ----
  const sidebar = (
    <aside className={`calSide${mobile ? " calDrawer" : ""}`} aria-label="Calendars">
      {mobile && (
        <div className="calDrawerHead">
          <b>Calendars</b>
          <button type="button" onClick={() => setDrawer(false)}>
            Done
          </button>
        </div>
      )}
      {!mobile && (
        <>
          <button type="button" className="calNewButton" onClick={() => newEvent()}>
            + New Event
          </button>
          <MiniMonth year={p.y} month={p.m} selected={selected} today={today} busy={busyDays} onPick={setSelected} onMonth={(d) => setSelected((s) => addMonths(s, d))} />
        </>
      )}
      <div className="calListHead">Calendars</div>
      <ul className="calList">
        {cal.calendars.map((c) => (
          <li key={c.id}>
            <CheckBox className="calListName" checked={!cal.hidden.includes(c.id)} onChange={() => toggleHidden(c.id)}>
              <span className="calSwatchMini" style={{ background: colorOf(c.color) }} />
              <span className="calListText" title={c.name}>{c.name}</span>
              {c.members.length > 1 && <span className="calShared" title={c.members.map((m) => m.name).join(", ")}>👥{c.members.length}</span>}
              {cal.muted.includes(c.id) && <span title="Reminders off on this device">🔕</span>}
            </CheckBox>
            <button type="button" className="calGear" aria-label={`${c.name} properties`} title="Properties" onClick={() => setSettings({ calendarId: c.id, tab: c.members.length > 1 || c.kind === "group" ? "people" : "general" })}>
              ⚙
            </button>
          </li>
        ))}
      </ul>
      {cal.status === "signed-out" ? (
        <div className="calSignOn">
          <p>Sign on to 98 Messenger to keep your calendar on every device and share calendars with your partner, family and friends.</p>
          <button type="button" onClick={signOn}>
            Sign on...
          </button>
        </div>
      ) : (
        <div className="calSideButtons">
          <button type="button" onClick={() => setDialog({ kind: "newCal" })}>
            New calendar...
          </button>
          <button type="button" onClick={() => setDialog({ kind: "join", code: "" })}>
            Join with a code...
          </button>
        </div>
      )}
      {cal.status === "loading" && <p className="calNote">Loading your calendars...</p>}
      {cal.status === "error" && <p className="calError">{cal.error}</p>}
      {cal.invites.length > 0 && (
        <div className="calInvites">
          <div className="calListHead">Invitations</div>
          {cal.invites.map((i) => (
            <div key={i.id} className="calInvite">
              <span>
                <b>{i.by}</b> invited you to <b>{i.name}</b>
              </span>
              <div className="calRowInline">
                <button type="button" onClick={() => act(() => answerInvite(i.id, true), () => say(`You joined ${i.name}.`))}>
                  Join
                </button>
                <button type="button" onClick={() => act(() => answerInvite(i.id, false))}>
                  No thanks
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {cal.status === "ready" && localCount > 0 && serverCalendars.length > 0 && (
        <div className="calUpload">
          <p>
            {localCount} event{localCount === 1 ? "" : "s"} on this device only. Upload to:
          </p>
          <select aria-label="Upload to" value={uploadTo || serverCalendars.find((c) => c.kind === "personal")?.id} onChange={(e) => setUploadTo(e.target.value)}>
            {serverCalendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy} onClick={upload}>
            Upload
          </button>
        </div>
      )}
    </aside>
  )

  // ---- menus ----
  const menus = [
    {
      label: "File",
      items: [
        { label: "New Event...", onClick: () => newEvent() },
        { label: "New All-Day Event...", onClick: () => newEvent(selected, null, true) },
        { label: "New Memo...", onClick: newMemo },
        "-",
        { label: "New Calendar...", onClick: () => setDialog({ kind: "newCal" }), disabled: cal.status === "signed-out" },
        { label: "Join a Calendar...", onClick: () => setDialog({ kind: "join", code: "" }) },
        "-",
        { label: "Download Calendar (.ics)", onClick: () => downloadCalendar(pickDefault(cal)) },
        "-",
        { label: "Close", onClick: () => onClose?.() },
      ],
    },
    {
      label: "View",
      items: [
        ...VIEWS.map(([id, label]) => ({ label, checked: view === id, onClick: () => setView(id) })),
        "-",
        { label: "Go to Today", onClick: () => setSelected(today) },
      ],
    },
    {
      label: "Calendar",
      items: cal.calendars.map((c) => ({ label: `${c.name} Properties...`, onClick: () => setSettings({ calendarId: c.id, tab: c.members.length > 1 || c.kind === "group" ? "people" : "general" }) })).concat(["-", { label: "Clock...", onClick: () => dispatch?.({ type: "open_window", payload: launch("Clock") }) }]),
    },
    {
      label: "Help",
      items: [{ label: "About 98ish Calendar", onClick: () => setDialog({ kind: "about" }) }],
    },
  ]

  const visibleCalendars = cal.calendars.filter((c) => !cal.hidden.includes(c.id))
  const mainView = (
    <>
      {view === "month" && (
        <>
          <MonthView year={p.y} month={p.m} today={today} selected={selected} byDate={byDate} zone={zone} mobile={mobile} onSelect={(d, more) => (setSelected(d), more && !mobile && setView("day"))} onOpen={openOcc} onNew={(d) => newEvent(d)} onSwipe={step} />
          {mobile && <DayList date={selected} list={byDate.get(selected) || []} zone={zone} today={today} onOpen={openOcc} onNew={(d) => newEvent(d)} />}
        </>
      )}
      {(view === "week" || view === "day") && <HourGrid dates={dates} today={today} selected={selected} byDate={byDate} zone={zone} mobile={mobile} onOpen={openOcc} onNew={(d, h, allDay) => newEvent(d, h ?? null, !!allDay)} onSwipe={step} onSelect={(d) => (setSelected(d), setView("day"))} />}
      {view === "agenda" && <AgendaView from={selected} byDate={byDate} zone={zone} today={today} onOpen={openOcc} />}
      {view === "memos" && <MemoView memos={memos} onOpen={(m) => setDetails({ calendarId: m.calendarId, eventId: m.id, key: null })} onNew={newMemo} />}
    </>
  )

  return (
    <div className={`calRoot${mobile ? " calPhone" : ""}`}>
      {!mobile && <MenuBar menus={menus} />}
      <div className="calToolbar">
        {mobile && (
          <button type="button" className="calIconButton" aria-label="Calendars" onClick={() => setDrawer(true)}>
            ☰
          </button>
        )}
        <button type="button" onClick={() => setSelected(today)}>
          Today
        </button>
        {view !== "memos" && (
          <>
            <button type="button" className="calIconButton" aria-label="Previous" onClick={() => step(-1)}>
              ◀︎
            </button>
            <button type="button" className="calIconButton" aria-label="Next" onClick={() => step(1)}>
              ▶︎
            </button>
          </>
        )}
        <h2 className="calHeading" aria-live="polite">
          {view === "memos" ? "Memos" : heading}
        </h2>
        {!mobile && (
          <div className="calViews" role="tablist" aria-label="View">
            {VIEWS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? "calOn" : ""} onClick={() => setView(id)}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {mobile && (
        <div className="calViews calViewsPhone" role="tablist" aria-label="View">
          {VIEWS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? "calOn" : ""} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="calBody">
        {!mobile && sidebar}
        <main className="calMain">{visibleCalendars.length ? mainView : <p className="calEmpty">Every calendar is hidden. Tick one in the list.</p>}</main>
      </div>
      <div className="calStatus status-bar">
        <p className="status-bar-field">{status ? <span className={status.error ? "calError" : ""}>{status.text}</span> : cal.status === "signed-out" ? "Not signed on: events are kept on this device" : cal.me ? `Signed on as ${cal.me.name}` : "98ish Calendar"}</p>
        {!mobile && <p className="status-bar-field calStatusZone">{zone.replace(/_/g, " ")}</p>}
      </div>
      {mobile && (
        <button type="button" className="calFab" aria-label={view === "memos" ? "New memo" : "New event"} onClick={() => (view === "memos" ? newMemo() : newEvent())}>
          +
        </button>
      )}
      {mobile && drawer && (
        <div className="calBackdrop calBackdropPhone calDrawerBack" onPointerDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          {sidebar}
        </div>
      )}

      {shownOcc && (
        <EventDetails
          occ={shownOcc}
          calendar={calendarById(shownOcc.calendarId, cal)}
          zone={zone}
          mobile={mobile}
          me={cal.me?.key}
          focusComments={details.comments}
          onClose={() => setDetails(null)}
          onEdit={() => editOcc(shownOcc)}
          onDelete={() => remove(shownOcc)}
          onDone={(done) => setDone(shownOcc, done)}
          onChecklist={(i, done) => setChecked(shownOcc, i, done)}
        />
      )}
      {editor && (
        <EventEditor
          key={editor.initial.id || "new"}
          initial={editor.initial}
          isNew={editor.isNew}
          calendars={editor.isNew ? writable : cal.calendars}
          zone={zone}
          mobile={mobile}
          busy={busy}
          lockDates={editor.occ ? null : null}
          scopeNote={editor.occ ? "This event repeats. When you save, you'll choose which ones to change." : null}
          onSave={saveDraft}
          onCancel={() => setEditor(null)}
        />
      )}
      {scope && <ScopeAsk kind={scope.kind} first={scope.first} mobile={mobile} onPick={scope.run} onCancel={() => setScope(null)} />}
      {settings && <CalendarSettings calendarId={settings.calendarId} tab={settings.tab} mobile={mobile} onClose={() => setSettings(null)} />}
      {dialog?.kind === "newCal" && <NewCalendar mobile={mobile} onClose={() => setDialog(null)} onMade={(c) => (setDialog(null), setSettings({ calendarId: c.id, tab: "people" }))} />}
      {dialog?.kind === "join" && <JoinCalendar mobile={mobile} code={dialog.code} onClose={() => setDialog(null)} onJoined={(c) => (setDialog(null), say(`You joined ${c.name}.`))} />}
      {dialog?.kind === "confirm" && (
        <Sheet
          title="98ish Calendar"
          mobile={mobile}
          onClose={() => setDialog(null)}
          className="calConfirm"
          footer={
            <>
              <button type="button" className="calPrimary" onClick={() => (setDialog(null), dialog.run())}>
                Yes
              </button>
              <button type="button" onClick={() => setDialog(null)}>
                No
              </button>
            </>
          }
        >
          <p>{dialog.text}</p>
        </Sheet>
      )}
      {dialog?.kind === "about" && (
        <Sheet title="About 98ish Calendar" mobile={mobile} onClose={() => setDialog(null)} dismissable footer={<button type="button" onClick={() => setDialog(null)}>OK</button>}>
          <p>
            <b>98ish Calendar</b>
          </p>
          <p>Plan things together. Share a calendar with your partner (the Us calendar), your family or friends: everyone sees changes right away, can comment on events, and gets reminders.</p>
          <p>Reminders ring while 98ish is open. For reminders with 98ish closed, add events to your phone's calendar (📲 in an event) or subscribe to a calendar (Properties &gt; Phone).</p>
        </Sheet>
      )}
    </div>
  )
}

export default Calendar
