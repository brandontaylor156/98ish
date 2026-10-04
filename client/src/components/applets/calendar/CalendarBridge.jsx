import React, { useEffect, useRef, useState } from "react"
import { useAim } from "../aim/AimContext"
import { launch, programByName } from "../../../utils/programs"
import { now as wallNow } from "../../../utils/clock"
import { useFloating } from "../../../hooks/useFloating"
import { dateIn, dueReminders, whenLabel, zoneParts } from "./recur"
import { OPEN_EVENT, VIEW_EVENT, allEvents, applyLive, calendarById, getCal, answerInvite, openCalendar, refresh, signedOn, useCalendar, zone } from "./store"
import { dueAlarms, getClockApp, markRang, cancelTimer, useClockApp, timerLeft } from "./clockStore"
import { playNotice, playReminder, ringAlarm } from "./sounds"
import "./CalendarBridge.css"

// Lives on the desktop (inside 98 Messenger's provider), whether or not Calendar is open:
//   - keeps the calendar store signed on with 98 Messenger and applies live cal:* notices
//   - fires event reminders (a Reminder window with Snooze and Dismiss, a chime, and a
//     system notification when 98ish is in the background and notifications are allowed)
//   - rings the Clock's alarms and timer
//   - shows toasts when someone else adds, changes or comments on an event
//   - opens Calendar and Clock when asked (openCalendar(), the taskbar clock, ?calendar= links)

const STATE_KEY = "98ish.cal.reminders"
const CHECK_MS = 10_000
const MISSED_MS = 12 * 60 * 60_000 // reminders missed while 98ish was closed: up to 12 hours back
const SNOOZES = [
  [5, "5 minutes"],
  [10, "10 minutes"],
  [15, "15 minutes"],
  [30, "30 minutes"],
  [60, "1 hour"],
  [240, "4 hours"],
  [1440, "1 day"],
]

const readState = () => {
  try {
    return { lastCheck: 0, fired: {}, snoozed: [], open: [], ...JSON.parse(localStorage.getItem(STATE_KEY)) }
  } catch {
    return { lastCheck: 0, fired: {}, snoozed: [], open: [] }
  }
}
const writeState = (s) => {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(s))
  } catch {
    // storage blocked: this visit only
  }
}

// a system notification, when 98ish isn't in front and they've been allowed
const notify = (title, body, tag) => {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted" || document.visibilityState === "visible") return
    const options = { body, tag, icon: "/assets/program_icons/calendar.svg" }
    if (navigator.serviceWorker?.controller) navigator.serviceWorker.ready.then((r) => r.showNotification(title, options)).catch(() => {})
    else new Notification(title, options)
  } catch {
    // not supported here
  }
}

// the reminder as shown: what, when, which calendar
const describe = (due) => {
  const calendar = calendarById(due.occ.calendarId)
  return {
    fireKey: due.fireKey,
    at: due.at,
    title: due.occ.title,
    when: whenLabel(due.occ, zone()),
    start: due.occ.allDay ? due.occ.start : due.occ.start,
    allDay: due.occ.allDay,
    location: due.occ.location,
    calendarId: due.occ.calendarId,
    calendar: calendar?.name || "",
    eventId: due.occ.id,
    key: due.occ.key,
  }
}

// "In 15 minutes", "Now", "2 hours ago"
const dueIn = (item, now) => {
  if (item.allDay) {
    const today = dateIn(now, zone())
    if (item.start === today) return "Today"
    return item.start > today ? "Upcoming" : "Earlier"
  }
  const diff = Math.round((item.start - now) / 60_000)
  if (Math.abs(diff) < 1) return "Now"
  const unit = (n) => (n >= 1440 ? `${Math.round(n / 1440)} day${Math.round(n / 1440) === 1 ? "" : "s"}` : n >= 60 ? `${Math.round(n / 60)} hour${Math.round(n / 60) === 1 ? "" : "s"}` : `${n} minute${n === 1 ? "" : "s"}`)
  return diff > 0 ? `In ${unit(diff)}` : `${unit(-diff)} ago`
}

const BellArt = () => (
  <svg className="cbBell" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
    <path d="M16 3c1.2 0 2 .8 2 2v1.2c4 .9 6.5 4.2 6.5 8.8v5.5l3 3.5H4.5l3-3.5V15c0-4.6 2.5-7.9 6.5-8.8V5c0-1.2.8-2 2-2z" fill="#ffd84a" stroke="#000" strokeWidth="1.2" />
    <path d="M12.5 25.5a3.5 3.5 0 007 0" fill="#c89a00" stroke="#000" strokeWidth="1.2" />
    <path d="M10.5 15c0-3 1.6-5.2 4-6" fill="none" stroke="#fff6c0" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

// The Reminder window: every reminder that's gone off, Dismiss / Snooze / Open
const ReminderWindow = ({ items, onDismiss, onDismissAll, onSnooze, onOpen, mobile }) => {
  const floating = useFloating({ center: true })
  const [selected, setSelected] = useState(items[0]?.fireKey)
  const [snooze, setSnooze] = useState(5)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])
  const current = items.find((i) => i.fireKey === selected) || items[0]
  useEffect(() => {
    if (!items.some((i) => i.fireKey === selected)) setSelected(items[0]?.fireKey)
  }, [items])
  if (!current) return null
  return (
    <div ref={mobile ? undefined : floating} className="window cbReminder" role="alertdialog" aria-label="Reminder">
      <div className="title-bar">
        <div className="title-bar-text">{items.length === 1 ? "1 Reminder" : `${items.length} Reminders`}</div>
        <div className="title-bar-controls">
          <button type="button" aria-label="Close" onClick={() => onDismissAll()} />
        </div>
      </div>
      <div className="window-body cbReminderBody">
        <div className="cbReminderHead">
          <BellArt />
          <div>
            <div className="cbReminderTitle">{current.title}</div>
            <div className="cbReminderWhen">{current.when}</div>
            {current.location && <div className="cbReminderWhere">{current.location}</div>}
          </div>
        </div>
        <ul className="cbReminderList" role="listbox" aria-label="Reminders">
          {items.map((item) => (
            <li key={item.fireKey} role="option" aria-selected={item === current} className={item === current ? "cbSel" : ""} onClick={() => setSelected(item.fireKey)}>
              <span className="cbReminderItem">{item.title}</span>
              <span className="cbReminderDue">{dueIn(item, now)}</span>
            </li>
          ))}
        </ul>
        <div className="cbReminderButtons">
          <button type="button" onClick={onDismissAll}>
            Dismiss All
          </button>
          <button type="button" onClick={() => onOpen(current)}>
            Open Item
          </button>
          <button type="button" className="cbDefault" onClick={() => onDismiss(current)}>
            Dismiss
          </button>
        </div>
        <div className="cbSnoozeRow">
          <label htmlFor="cbSnooze">Click Snooze to be reminded again in:</label>
          <div className="cbSnoozeControls">
            <select id="cbSnooze" value={snooze} onChange={(e) => setSnooze(Number(e.target.value))}>
              {SNOOZES.map(([m, label]) => (
                <option key={m} value={m}>
                  {label}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => onSnooze(current, snooze)}>
              Snooze
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const AlarmWindow = ({ alarm, onStop, onSnooze }) => (
  <div className="window cbReminder cbAlarm" role="alertdialog" aria-label="Alarm">
    <div className="title-bar">
      <div className="title-bar-text">{alarm.kind === "timer" ? "Timer" : "Alarm"}</div>
      <div className="title-bar-controls">
        <button type="button" aria-label="Close" onClick={onStop} />
      </div>
    </div>
    <div className="window-body cbReminderBody">
      <div className="cbReminderHead">
        <BellArt />
        <div>
          <div className="cbReminderTitle">{alarm.kind === "timer" ? "Time's up!" : alarm.time12}</div>
          <div className="cbReminderWhen">{alarm.label || (alarm.kind === "timer" ? "Your timer is done." : "Alarm")}</div>
        </div>
      </div>
      <div className="cbReminderButtons">
        {alarm.kind !== "timer" && (
          <button type="button" onClick={onSnooze}>
            Snooze 9 min
          </button>
        )}
        <button type="button" className="cbDefault" onClick={onStop}>
          Stop
        </button>
      </div>
    </div>
  </div>
)

const Toast = ({ toast, onClose }) => {
  useEffect(() => {
    const t = setTimeout(onClose, toast.sticky ? 30000 : 9000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="window cbToast" role="status">
      <div className="title-bar">
        <div className="title-bar-text">{toast.title}</div>
        <div className="title-bar-controls">
          <button type="button" aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="window-body cbToastBody">
        <span className="cbToastIcon" aria-hidden="true">
          {toast.icon}
        </span>
        <div className="cbToastText">{toast.text}</div>
        <div className="cbToastActions">
          {(toast.actions || []).map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => {
                onClose()
                a.run()
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const ACTIONS = { added: "added", changed: "changed", deleted: "deleted", skipped: "skipped a day of", completed: "checked off", reopened: "reopened", commented: "commented on", imported: "added" }

const CalendarBridge = ({ socket, windows, dispatch, mobile }) => {
  const aim = useAim()
  const cal = useCalendar()
  const clockApp = useClockApp()
  const [items, setItems] = useState(() => readState().open || [])
  const [toasts, setToasts] = useState([])
  const [alarm, setAlarm] = useState(null)
  const stopRing = useRef(null)
  const windowsRef = useRef(windows)
  windowsRef.current = windows
  const toastId = useRef(0)

  const toast = (t) => setToasts((list) => [...list.slice(-2), { ...t, id: ++toastId.current }])
  const closeToast = (id) => setToasts((list) => list.filter((t) => t.id !== id))

  // ---- signing on and off ----
  useEffect(() => {
    if (aim?.status === "online" && aim.token) signedOn({ token: aim.token, key: aim.me?.screenName?.replace(/\s+/g, "").toLowerCase(), name: aim.me?.screenName })
    else signedOn(null)
  }, [aim?.status, aim?.token])

  // ---- opening Calendar and Clock ----
  useEffect(() => {
    const open = (e) => {
      const { program: name = "Calendar", ...extra } = e.detail || {}
      const program = programByName(name)
      if (!program) return
      const index = windowsRef.current.findIndex((w) => !w.closed && w.program === program.name)
      if (index >= 0) {
        dispatch({ type: "focus_window", payload: { index } })
        window.dispatchEvent(new CustomEvent(VIEW_EVENT, { detail: { program: program.name, ...extra } }))
      } else dispatch({ type: "open_window", payload: launch(program.name, { calendarView: extra }) })
    }
    window.addEventListener(OPEN_EVENT, open)
    // an invite link: https://98ish.../?calendar=K7QXM2PA
    try {
      const url = new URL(window.location.href)
      const code = url.searchParams.get("calendar")
      if (code) {
        url.searchParams.delete("calendar")
        window.history.replaceState(window.history.state, "", url.toString())
        setTimeout(() => openCalendar({ join: code.slice(0, 16) }), 300)
      }
    } catch {
      // no link
    }
    return () => window.removeEventListener(OPEN_EVENT, open)
  }, [])

  // ---- live notices from other members ----
  useEffect(() => {
    if (!socket) return
    const onAny = (event, payload) => {
      if (typeof event !== "string" || !event.startsWith("cal:")) return
      applyLive(event, payload || {})
      const s = getCal()
      const calendar = calendarById(payload?.calendarId, s)
      const muted = s.muted.includes(payload?.calendarId)
      const a = payload?.activity
      if (event === "cal:invite") {
        playNotice()
        toast({
          title: "Calendar invitation",
          icon: "📅",
          text: `${payload.by} invited you to the calendar "${payload.name}".`,
          sticky: true,
          actions: [
            { label: "Join", run: () => answerInvite(payload.calendarId, true).then((r) => r.ok && openCalendar({ calendarId: payload.calendarId })) },
            { label: "Later", run: () => {} },
          ],
        })
        notify("Calendar invitation", `${payload.by} invited you to "${payload.name}"`, `cal-invite-${payload.calendarId}`)
        return
      }
      if (event === "cal:calendar" && payload.removed) {
        toast({ title: "Calendar", icon: "📅", text: `${payload.by} removed "${payload.name}".` })
        return
      }
      if (muted || !calendar || !a) return
      if (event === "cal:comment" && payload.comment) {
        playNotice()
        const text = `${payload.comment.byName} on "${payload.title}": ${payload.comment.text.slice(0, 120)}`
        toast({ title: calendar.name, icon: "💬", text, actions: [{ label: "Reply", run: () => openCalendar({ calendarId: payload.calendarId, eventId: payload.eventId, comments: true }) }] })
        notify(`${calendar.name}: new comment`, text, `cal-comment-${payload.eventId}`)
        return
      }
      if (event === "cal:event" || (event === "cal:calendar" && a.action === "joined")) {
        const what = a.action === "joined" ? `${a.byName} joined "${calendar.name}".` : `${a.byName} ${ACTIONS[a.action] || "changed"} "${a.title}"${a.when && a.action !== "deleted" ? ` · ${a.when}` : ""}`
        playNotice()
        toast({
          title: calendar.name,
          icon: a.action === "deleted" ? "🗑️" : a.action === "completed" ? "✔️" : "📅",
          text: what,
          actions: payload.event ? [{ label: "Open", run: () => openCalendar({ calendarId: payload.calendarId, eventId: payload.event.id }) }] : [],
        })
        notify(calendar.name, what, `cal-${payload.calendarId}`)
      }
    }
    socket.onAny(onAny)
    // notices sent while the connection was down (a phone asleep, the server waking up) are
    // lost: catch up on reconnecting and on coming back to 98ish
    let last = Date.now()
    const catchUp = () => {
      if (getCal().status !== "ready" || document.visibilityState === "hidden" || Date.now() - last < 20_000) return
      last = Date.now()
      refresh()
    }
    socket.on("connect", catchUp)
    document.addEventListener("visibilitychange", catchUp)
    window.addEventListener("focus", catchUp)
    return () => {
      socket.offAny(onAny)
      socket.off("connect", catchUp)
      document.removeEventListener("visibilitychange", catchUp)
      window.removeEventListener("focus", catchUp)
    }
  }, [socket])

  // ---- reminders ----
  const check = () => {
    const s = getCal()
    const memory = readState()
    const now = Date.now()
    const since = Math.max(memory.lastCheck || now - 15 * 60_000, now - MISSED_MS)
    const me = s.me?.key
    const wants = (occ) => {
      if (s.muted.includes(occ.calendarId) || occ.done) return false
      const calendar = calendarById(occ.calendarId, s)
      if (!calendar) return false
      // a shared event with people picked: just them
      if (occ.attendees?.length && calendar.kind !== "local" && calendar.members.length > 1 && me && !occ.attendees.includes(me)) return false
      return true
    }
    const fresh = since < now ? dueReminders(allEvents(s), since, now, zone(), { wants }).filter((d) => !memory.fired[d.fireKey]) : []
    // snoozed ones whose time has come
    const back = memory.snoozed.filter((x) => x.until <= now)
    const open = [...memory.open]
    for (const d of fresh) {
      memory.fired[d.fireKey] = now
      // only the latest reminder of an occurrence stays in the list
      const item = describe(d)
      const sameOcc = open.findIndex((o) => o.eventId === item.eventId && o.key === item.key)
      if (sameOcc >= 0) open.splice(sameOcc, 1)
      open.push(item)
    }
    for (const x of back) if (!open.some((o) => o.fireKey === x.item.fireKey)) open.push(x.item)
    memory.snoozed = memory.snoozed.filter((x) => x.until > now)
    // forget fired keys after two weeks
    for (const [k, t] of Object.entries(memory.fired)) if (now - t > 14 * 86_400_000) delete memory.fired[k]
    memory.lastCheck = now
    memory.open = open
    writeState(memory)
    if (fresh.length || back.length) {
      playReminder()
      const first = fresh[0] ? describe(fresh[0]) : back[0].item
      notify(`Reminder: ${first.title}`, first.when, `cal-rem-${first.fireKey}`)
      setItems(open)
    }
  }

  const checkRef = useRef(check)
  checkRef.current = check
  useEffect(() => {
    const tick = () => checkRef.current()
    // a moment after the calendars load
    const first = setTimeout(tick, 1500)
    const timer = setInterval(tick, CHECK_MS)
    const back = () => document.visibilityState === "visible" && tick()
    document.addEventListener("visibilitychange", back)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      document.removeEventListener("visibilitychange", back)
    }
  }, [])
  // signing on brings more events (and maybe some reminders due now)
  useEffect(() => {
    if (cal.status === "ready") checkRef.current()
  }, [cal.status, cal.events])

  const settle = (fn) => {
    const memory = readState()
    fn(memory)
    writeState(memory)
    setItems(memory.open)
  }
  const dismiss = (item) => settle((m) => (m.open = m.open.filter((o) => o.fireKey !== item.fireKey)))
  const dismissAll = () => settle((m) => (m.open = []))
  const snooze = (item, minutes) =>
    settle((m) => {
      m.open = m.open.filter((o) => o.fireKey !== item.fireKey)
      m.snoozed = [...m.snoozed.filter((x) => x.item.fireKey !== item.fireKey), { item, until: Date.now() + minutes * 60_000 }]
    })
  const openItem = (item) => {
    dismiss(item)
    openCalendar({ calendarId: item.calendarId, eventId: item.eventId, date: item.allDay ? item.start : dateIn(item.start, zone()) })
  }

  // ---- alarms and the timer ----
  const watching = clockApp.alarms.some((a) => a.on) || !!clockApp.timer?.endsAt
  useEffect(() => {
    if (!watching) return
    const tick = () => {
      const app = getClockApp()
      if (app.timer?.endsAt && timerLeft(app.timer) <= 0) {
        cancelTimer()
        ring({ kind: "timer", label: app.timer.label })
      }
      const w = wallNow()
      const wall = { date: `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, "0")}-${String(w.getDate()).padStart(2, "0")}`, wd: w.getDay(), h: w.getHours(), mi: w.getMinutes() }
      for (const a of dueAlarms(app.alarms, wall)) {
        markRang(a, wall)
        const [h, m] = a.time.split(":").map(Number)
        ring({ kind: "alarm", id: a.id, label: a.label, time12: `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}` })
      }
      // a snoozed alarm
      if (snoozedAlarm.current && snoozedAlarm.current.until <= Date.now()) {
        const again = snoozedAlarm.current.alarm
        snoozedAlarm.current = null
        ring(again)
      }
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [watching])
  const snoozedAlarm = useRef(null)
  const ring = (what) => {
    stopRing.current?.()
    stopRing.current = ringAlarm()
    setAlarm(what)
    notify(what.kind === "timer" ? "Timer" : "Alarm", what.label || (what.kind === "timer" ? "Time's up!" : what.time12), "clock-alarm")
  }
  const stopAlarm = () => {
    stopRing.current?.()
    stopRing.current = null
    setAlarm(null)
  }
  const snoozeAlarm = () => {
    snoozedAlarm.current = { alarm, until: Date.now() + 9 * 60_000 }
    stopAlarm()
  }
  useEffect(() => () => stopRing.current?.(), [])
  // keep the alarm loop alive for a snooze even with no alarms on
  const [, force] = useState(0)
  useEffect(() => {
    if (watching || !snoozedAlarm.current) return
    const t = setInterval(() => {
      if (snoozedAlarm.current && snoozedAlarm.current.until <= Date.now()) {
        const again = snoozedAlarm.current.alarm
        snoozedAlarm.current = null
        ring(again)
        force((n) => n + 1)
      }
    }, 1000)
    return () => clearInterval(t)
  }, [watching, alarm])

  return (
    <>
      {items.length > 0 && <ReminderWindow items={items} mobile={mobile} onDismiss={dismiss} onDismissAll={dismissAll} onSnooze={snooze} onOpen={openItem} />}
      {alarm && <AlarmWindow alarm={alarm} onStop={stopAlarm} onSnooze={snoozeAlarm} />}
      {toasts.length > 0 && (
        <div className="cbToasts">
          {toasts.map((t) => (
            <Toast key={t.id} toast={t} onClose={() => closeToast(t.id)} />
          ))}
        </div>
      )}
    </>
  )
}

export default CalendarBridge
