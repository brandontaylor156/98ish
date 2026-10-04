import { useSyncExternalStore } from "react"
import { currentZone } from "../../../utils/clock"

// 98ish Calendar's data, shared by the Calendar app, the Clock app and CalendarBridge (which
// keeps it in step with 98 Messenger and fires reminders):
//   - calendars on the 98ish server (signed on to 98 Messenger): My Calendar, Us (couples),
//     group calendars; their events, kept up to date live (cal:* socket events)
//   - "On this device": a calendar kept in this browser's localStorage, for anyone, signed
//     on or not, which can be uploaded to an account later
// useCalendar() -> { status, me, calendars, invites, events: { [calendarId]: [event] },
//                    hidden, muted, ... }. Every action resolves to { ok, ... } or
//                    { ok: false, error } and never throws.

export const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"
export const LOCAL_ID = "local"
export const OPEN_EVENT = "98ish:calendar-open" // { program, view, date, eventId, calendarId, join }
export const LIVE_EVENT = "98ish:calendar-live" // a comment or change arrived ({ type, ... })
export const VIEW_EVENT = "98ish:calendar-view" // an open Calendar or Clock asked to show something

const LOCAL_KEY = "98ish.cal.local"
const PREFS_KEY = "98ish.cal.prefs"

export const COLORS = {
  red: "#d03030",
  orange: "#e07818",
  yellow: "#c8a000",
  green: "#2a9a3a",
  teal: "#008080",
  blue: "#2858c8",
  navy: "#000080",
  purple: "#8040b0",
  pink: "#e0509a",
  brown: "#8a5a2a",
  gray: "#707070",
}
export const COLOR_NAMES = Object.keys(COLORS)
export const colorOf = (name, fallback = "#2858c8") => COLORS[name] || fallback

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage blocked: this visit only
  }
}

const randomId = () => {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
}

// ---- the state ----

const prefs = read(PREFS_KEY, {})
const localData = read(LOCAL_KEY, { events: [], name: "On this device", color: "teal" })

const localCalendar = () => ({
  id: LOCAL_ID,
  kind: "local",
  name: localData.name || "On this device",
  color: localData.color || "teal",
  role: "owner",
  members: [{ key: "me", name: "You", role: "owner", color: localData.color || "teal" }],
  invites: [],
  labels: COLOR_NAMES.map((c) => ({ id: c, color: c, name: (localData.labels || {})[c] || "" })),
  local: true,
})

let state = {
  status: "signed-out", // "signed-out" | "loading" | "ready" | "error"
  me: null, // { key, name }
  calendars: [localCalendar()],
  invites: [],
  events: { [LOCAL_ID]: localData.events || [] },
  hidden: prefs.hidden || [], // calendar ids not shown
  muted: prefs.muted || [], // calendar ids whose reminders are off
  defaultCalendar: prefs.defaultCalendar || null,
  error: null,
}
let token = null
let offset = 0
const listeners = new Set()

export const getCal = () => state
const set = (patch) => {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const useCalendar = () => useSyncExternalStore(subscribe, getCal)

export const zone = () => currentZone()
export const serverNow = () => Date.now() + offset

const savePrefs = () => write(PREFS_KEY, { hidden: state.hidden, muted: state.muted, defaultCalendar: state.defaultCalendar })
const saveLocal = () => write(LOCAL_KEY, { ...localData, events: state.events[LOCAL_ID] || [] })

export const toggleHidden = (id) => {
  set({ hidden: state.hidden.includes(id) ? state.hidden.filter((h) => h !== id) : [...state.hidden, id] })
  savePrefs()
}
export const toggleMuted = (id) => {
  set({ muted: state.muted.includes(id) ? state.muted.filter((h) => h !== id) : [...state.muted, id] })
  savePrefs()
}
export const setDefaultCalendar = (id) => {
  set({ defaultCalendar: id })
  savePrefs()
}

export const calendarById = (id, s = state) => s.calendars.find((c) => c.id === id) || null
export const visibleEvents = (s = state) => s.calendars.filter((c) => !s.hidden.includes(c.id)).flatMap((c) => s.events[c.id] || [])
export const allEvents = (s = state) => s.calendars.flatMap((c) => s.events[c.id] || [])
export const findEvent = (calendarId, id, s = state) => (s.events[calendarId] || []).find((e) => e.id === id) || null

// the calendar new events go in
export const pickDefault = (s = state) => {
  const usable = s.calendars.filter((c) => !s.hidden.includes(c.id))
  return calendarById(s.defaultCalendar, s) && !s.hidden.includes(s.defaultCalendar) ? s.defaultCalendar : (usable.find((c) => c.kind === "personal") || usable[0] || s.calendars[0]).id
}

// ---- the server ----

export const calApi = async (method, path = "", body) => {
  if (!token) return { ok: false, status: 401, error: "Sign on to 98 Messenger to share calendars." }
  try {
    const response = await fetch(`${SERVER_URL}/api/calendar${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const result = await response.json().catch(() => ({ ok: false, error: `The server had a problem (${response.status}).` }))
    if (typeof result.now === "number") offset = result.now - Date.now()
    return { ...result, httpStatus: response.status }
  } catch {
    return { ok: false, error: "Couldn't reach the 98ish server. It may be waking up; try again in a minute." }
  }
}

const withLocal = (calendars) => [...calendars, localCalendar()]

const putEvent = (calendarId, event) => {
  const list = state.events[calendarId] || []
  const next = list.some((e) => e.id === event.id) ? list.map((e) => (e.id === event.id ? event : e)) : [...list, event]
  set({ events: { ...state.events, [calendarId]: next } })
  if (calendarId === LOCAL_ID) saveLocal()
}
const dropEvent = (calendarId, id) => {
  set({ events: { ...state.events, [calendarId]: (state.events[calendarId] || []).filter((e) => e.id !== id) } })
  if (calendarId === LOCAL_ID) saveLocal()
}

export const signedOn = (session) => {
  if (!session?.token) {
    token = null
    const local = state.events[LOCAL_ID]
    set({ status: "signed-out", me: null, calendars: [localCalendar()], invites: [], events: { [LOCAL_ID]: local } })
    return
  }
  const changed = token !== session.token
  token = session.token
  if (changed || state.status === "signed-out") {
    set({ status: "loading", me: { key: session.key, name: session.name } })
    refresh()
  }
}

let refreshing = null
export const refresh = () =>
  (refreshing ??= (async () => {
    const list = await calApi("GET", "/")
    if (!list.ok) {
      if (token) set({ status: state.status === "ready" ? "ready" : "error", error: list.error })
      return list
    }
    const results = await Promise.all(list.calendars.map((c) => calApi("GET", `/calendars/${c.id}/events`)))
    const events = { [LOCAL_ID]: state.events[LOCAL_ID] || [] }
    list.calendars.forEach((c, i) => (events[c.id] = results[i].ok ? results[i].events : state.events[c.id] || []))
    set({ status: "ready", error: null, calendars: withLocal(list.calendars), invites: list.invites, events })
    return list
  })().finally(() => (refreshing = null)))

// one calendar's details and events again (someone joined, renamed it...)
export const refreshCalendar = async (id) => {
  const result = await calApi("GET", `/calendars/${id}/events`)
  if (result.httpStatus === 404) {
    const { [id]: gone, ...events } = state.events
    set({ calendars: state.calendars.filter((c) => c.id !== id), events })
    return result
  }
  if (!result.ok) return result
  const exists = state.calendars.some((c) => c.id === id)
  set({
    calendars: exists ? state.calendars.map((c) => (c.id === id ? result.calendar : c)) : withLocal([...state.calendars.filter((c) => !c.local), result.calendar]),
    events: { ...state.events, [id]: result.events },
  })
  return result
}

// a live notice from another member (CalendarBridge passes them on)
export const applyLive = (type, payload) => {
  if (!payload?.calendarId || !state.calendars.some((c) => c.id === payload.calendarId)) {
    if (type === "cal:calendar" || type === "cal:invite") refresh()
    return
  }
  if (type === "cal:event") {
    if (payload.removed) dropEvent(payload.calendarId, payload.removed)
    else if (payload.event) putEvent(payload.calendarId, payload.event)
  } else if (type === "cal:comment") {
    const event = findEvent(payload.calendarId, payload.eventId)
    if (event) putEvent(payload.calendarId, { ...event, comments: Math.max(0, (event.comments || 0) + (payload.removed ? -1 : 1)) })
  } else if (type === "cal:calendar") {
    if (payload.removed) {
      const { [payload.calendarId]: gone, ...events } = state.events
      set({ calendars: state.calendars.filter((c) => c.id !== payload.calendarId), events })
    } else refreshCalendar(payload.calendarId)
  }
  window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: { type, ...payload } }))
}

// ---- events ----

const stamp = (event) => {
  const t = Date.now()
  return { ...event, createdBy: "me", createdByName: "You", updatedBy: "me", updatedByName: "You", updatedAt: t, createdAt: event.createdAt || t }
}

export const saveEvent = async (calendarId, event) => {
  if (calendarId === LOCAL_ID) {
    const saved = stamp({ ...event, id: event.id || randomId(), calendarId: LOCAL_ID, comments: 0 })
    putEvent(LOCAL_ID, saved)
    return { ok: true, event: saved }
  }
  const result = event.id ? await calApi("PUT", `/calendars/${calendarId}/events/${event.id}`, { event }) : await calApi("POST", `/calendars/${calendarId}/events`, { event })
  if (result.ok) putEvent(calendarId, result.event)
  return result
}

// Move an event to another calendar: add it there, then delete it here
export const moveEvent = async (fromId, toId, event) => {
  const { id, comments, exceptions, ...rest } = event
  const added = await saveEvent(toId, { ...rest, exceptions })
  if (!added.ok) return added
  await deleteEvent(fromId, id)
  return added
}

export const changeOccurrence = async (calendarId, eventId, key, change) => {
  if (calendarId === LOCAL_ID) {
    const event = findEvent(LOCAL_ID, eventId)
    if (!event) return { ok: false, error: "That event is gone." }
    const exceptions = { ...(event.exceptions || {}) }
    if (change === null) delete exceptions[key]
    else exceptions[key] = change.deleted ? { deleted: true } : { ...(exceptions[key]?.deleted ? {} : exceptions[key]), ...change }
    const saved = stamp({ ...event, exceptions })
    putEvent(LOCAL_ID, saved)
    return { ok: true, event: saved }
  }
  const result = await calApi("PATCH", `/calendars/${calendarId}/events/${eventId}/occurrence`, { key, change })
  if (result.ok) putEvent(calendarId, result.event)
  return result
}

export const deleteEvent = async (calendarId, id) => {
  if (calendarId === LOCAL_ID) {
    dropEvent(LOCAL_ID, id)
    return { ok: true }
  }
  const result = await calApi("DELETE", `/calendars/${calendarId}/events/${id}`)
  if (result.ok || result.httpStatus === 404) dropEvent(calendarId, id)
  return result
}

// ---- calendars and people ----

const replaceCalendar = (calendar) => set({ calendars: state.calendars.some((c) => c.id === calendar.id) ? state.calendars.map((c) => (c.id === calendar.id ? calendar : c)) : withLocal([...state.calendars.filter((c) => !c.local), calendar]) })

const after = (result) => {
  if (result.ok && result.calendar) replaceCalendar(result.calendar)
  return result
}

export const createCalendar = async (name, color) => {
  const result = after(await calApi("POST", "/calendars", { name, color }))
  if (result.ok) set({ events: { ...state.events, [result.calendar.id]: [] } })
  return result
}
export const updateCalendar = async (id, patch) => {
  if (id === LOCAL_ID) {
    if (patch.name !== undefined) localData.name = String(patch.name).slice(0, 40) || "On this device"
    if (patch.color !== undefined) localData.color = patch.color
    if (patch.labels) localData.labels = Object.fromEntries(patch.labels.map((l) => [l.id, l.name]))
    saveLocal()
    set({ calendars: state.calendars.map((c) => (c.local ? localCalendar() : c)) })
    return { ok: true }
  }
  return after(await calApi("PATCH", `/calendars/${id}`, patch))
}
export const setMyColor = async (id, color) => after(await calApi("PATCH", `/calendars/${id}/me`, { color }))
export const invite = async (id, to) => after(await calApi("POST", `/calendars/${id}/invite`, { to }))
export const newCode = async (id) => after(await calApi("POST", `/calendars/${id}/code`))
export const removeMember = async (id, key) => after(await calApi("DELETE", `/calendars/${id}/members/${encodeURIComponent(key)}`))
export const join = async (code) => {
  const result = await calApi("POST", "/join", { code })
  if (result.ok) await refreshCalendar(result.calendar.id)
  return result
}
export const answerInvite = async (id, yes) => {
  const result = await calApi("POST", `/calendars/${id}/${yes ? "accept" : "decline"}`)
  set({ invites: state.invites.filter((i) => i.id !== id) })
  if (result.ok && yes) await refreshCalendar(id)
  return result
}
const forget = (id) => {
  const { [id]: gone, ...events } = state.events
  set({ calendars: state.calendars.filter((c) => c.id !== id), events })
}
export const leaveCalendar = async (id) => {
  const result = await calApi("POST", `/calendars/${id}/leave`)
  if (result.ok) forget(id)
  return result
}
export const deleteCalendar = async (id) => {
  const result = await calApi("DELETE", `/calendars/${id}`)
  if (result.ok) forget(id)
  return result
}

export const comments = (calendarId, eventId) => calApi("GET", `/calendars/${calendarId}/events/${eventId}/comments`)
export const addComment = async (calendarId, eventId, text) => {
  const result = await calApi("POST", `/calendars/${calendarId}/events/${eventId}/comments`, { text })
  if (result.ok) {
    const event = findEvent(calendarId, eventId)
    if (event) putEvent(calendarId, { ...event, comments: (event.comments || 0) + 1 })
  }
  return result
}
export const deleteComment = async (calendarId, eventId, id) => {
  const result = await calApi("DELETE", `/calendars/${calendarId}/events/${eventId}/comments/${id}`)
  if (result.ok) {
    const event = findEvent(calendarId, eventId)
    if (event) putEvent(calendarId, { ...event, comments: Math.max(0, (event.comments || 0) - 1) })
  }
  return result
}
export const activity = (calendarId) => calApi("GET", `/calendars/${calendarId}/activity`)
export const feedUrl = async (calendarId, fresh = false) => {
  const result = await calApi(fresh ? "POST" : "GET", `/calendars/${calendarId}/feed`)
  if (!result.ok) return result
  const https = `${SERVER_URL.replace(/\/$/, "")}/api/calendar/feed/${result.token}.ics`
  return { ok: true, https, webcal: https.replace(/^https?:/, "webcal:") }
}

// Upload this device's calendar into one of your calendars on the server
export const uploadLocal = async (calendarId) => {
  const local = state.events[LOCAL_ID] || []
  if (!local.length) return { ok: true, count: 0 }
  const strip = ({ id, calendarId: c, createdBy, createdByName, updatedBy, updatedByName, createdAt, updatedAt, comments: n, ...rest }) => rest
  let count = 0
  for (let i = 0; i < local.length; i += 500) {
    const result = await calApi("POST", `/calendars/${calendarId}/import`, { events: local.slice(i, i + 500).map(strip) })
    if (!result.ok) return { ...result, count }
    count += result.events.length
  }
  set({ events: { ...state.events, [LOCAL_ID]: [] } })
  saveLocal()
  await refreshCalendar(calendarId)
  return { ok: true, count }
}

// "Calendar" or "Clock", opened from anywhere (the taskbar clock, toasts, Date/Time Properties)
export const openCalendar = (detail = {}) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { program: "Calendar", ...detail } }))
export const openClock = (detail = {}) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { program: "Clock", ...detail } }))
