import { useSyncExternalStore } from "react"
import * as core from "../components/applets/pbclub/clubCore.js"

// Pickleball 98's Real Games: state on this device (the server is server/pbclub; the rules are
// applets/pbclub/clubCore.js). Outside React so the live notices (PbClubBridge) and the app
// share it.
//
//   setClubSession({ token, screenName } | null)   from AimContext (signing on/off)
//   useClub() -> { status, error, me, sessions, matches, ladder, names, outbox, season }
//   refresh(), logMatch(match) (queued on this device while offline or signed off, sent
//   later), act(id, act), saveSession(session, { id, invite }), rsvp(id, s, late),
//   invite(id, names), say(id, text), setRotation(id, rotation), cancel(id), setSeason(ms)
//
// Saved on this device (per user, through the storage seam): matches waiting to be sent
// ("98ish.pbclub.outbox") and the scorekeeper's settings ("98ish.pbclub.prefs").

export const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"
const OUTBOX = "98ish.pbclub.outbox"
const PREFS = "98ish.pbclub.prefs"
const RETRY_MS = 60_000

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

const EMPTY = { status: "off", error: null, me: null, sessions: [], matches: [], ladder: { singles: {}, doubles: {} }, names: {}, outbox: [], season: 0 }
let state = { ...EMPTY, outbox: read(OUTBOX, []) }
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn())
const set = (patch) => {
  state = { ...state, ...patch }
  emit()
}
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const getClub = () => state
export const useClub = () => useSyncExternalStore(subscribe, getClub)

let session = null // { token, key, name }
let retry = null
const keyOf = (name) => String(name || "").replace(/\s+/g, "").toLowerCase()

export const getPrefs = () => ({ voice: true, format: "doubles", scoring: "sideout", to: 11, bestOf: 1, winBy: 2, freeze: false, ...read(PREFS, {}) })
export const setPrefs = (patch) => write(PREFS, { ...getPrefs(), ...patch })

const api = async (path, body) => {
  if (!session) return { ok: false, offline: true, error: "Sign on to 98 Messenger to share with your group." }
  try {
    const response = await fetch(`${SERVER_URL}/api/pbclub${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    })
    const json = await response.json().catch(() => ({ ok: false, error: `The server had a problem (${response.status}).` }))
    return { ...json, status: response.status }
  } catch {
    return { ok: false, offline: true, error: "Couldn't reach the 98ish server. Saved on this phone; it goes up when you're back online." }
  }
}

export const refresh = async () => {
  if (!session) return { ok: false }
  if (state.status === "off") set({ status: "loading" })
  const result = await api("/state", { season: state.season })
  if (!session) return result
  if (!result.ok) {
    set({ status: state.me ? "ready" : "error", error: result.error })
    return result
  }
  set({ status: "ready", error: null, me: result.me, sessions: result.sessions, matches: result.matches, ladder: result.ladder, names: result.names })
  return result
}

// a coalesced refresh for bursts of live notices
let refreshTimer = null
export const refreshSoon = () => {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(refresh, 250)
}

export const setSeason = (season) => {
  set({ season: Number(season) || 0 })
  return refresh()
}

// ---- matches ----

const flushOutbox = async () => {
  clearTimeout(retry)
  retry = null
  if (!session || !state.outbox.length) return
  const left = []
  let sent = 0
  for (const item of state.outbox) {
    // a queued match belongs to whoever logged it
    if (item.owner && item.owner !== session.key) {
      left.push(item)
      continue
    }
    const result = await api("/match", { match: item.match })
    if (result.ok) sent++
    else if (result.offline || result.status >= 500) left.push(item)
    else left.push({ ...item, error: result.error })
  }
  state = { ...state, outbox: left }
  write(OUTBOX, left)
  emit()
  if (left.some((i) => !i.error && (!i.owner || i.owner === session?.key))) retry = setTimeout(flushOutbox, RETRY_MS)
  if (sent) refresh()
}

export const logMatch = async (match) => {
  const m = { ...match, id: match.id || core.newId() }
  const result = await api("/match", { match: m })
  if (result.ok) {
    refresh()
    return result
  }
  if (result.offline || result.status >= 500) {
    const outbox = [...state.outbox, { match: m, owner: session?.key || null, at: Date.now() }].slice(-200)
    write(OUTBOX, outbox)
    set({ outbox })
    if (session && !retry) retry = setTimeout(flushOutbox, RETRY_MS)
    return { ok: true, queued: true }
  }
  return result
}
export const dropQueued = (id) => {
  const outbox = state.outbox.filter((i) => i.match.id !== id)
  write(OUTBOX, outbox)
  set({ outbox })
}

const after = async (result) => {
  if (result.ok) await refresh()
  else set({ error: result.error })
  return result
}
export const act = async (id, what) => after(await api(`/match/${id}`, { act: what }))

// ---- sessions ----

export const saveSession = async (session, { id = null, invite = [] } = {}) => after(await api("/session", { session, id, invite }))
export const rsvp = async (id, s, late) => after(await api(`/session/${id}/rsvp`, late === undefined ? { s } : s ? { s, late } : { late }))
export const invite = async (id, to) => after(await api(`/session/${id}/invite`, { to }))
export const say = async (id, text) => after(await api(`/session/${id}/say`, { text }))
export const setRotation = async (id, rotation) => after(await api(`/session/${id}/rotation`, { rotation }))
export const cancel = async (id) => after(await api(`/session/${id}/cancel`))

// ---- signing on and off ----

export const setClubSession = (next) => {
  const key = next?.token ? keyOf(next.screenName) : null
  if (!key) {
    session = null
    clearTimeout(retry)
    retry = null
    state = { ...EMPTY, outbox: read(OUTBOX, []) }
    emit()
    return
  }
  if (session?.key === key && session.token === next.token) return
  session = { token: next.token, key, name: next.screenName }
  state = { ...EMPTY, status: "loading", outbox: read(OUTBOX, []) }
  emit()
  refresh().then(flushOutbox)
}

if (typeof window !== "undefined") window.addEventListener("online", () => flushOutbox())

// for tests and the browser script
if (typeof window !== "undefined" && import.meta.env?.DEV) window.__pbclub = { getClub, refresh, logMatch, act, saveSession, rsvp, flushOutbox }
