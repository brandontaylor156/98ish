import { useSyncExternalStore } from "react"
import * as core from "../components/applets/locator/locateCore.js"

// Buddy Locator's state on this device (the server is server/locate; the rules are
// applets/locator/locateCore.js). Lives outside React so sharing keeps going while the
// Buddy Locator window is closed: while you share with someone (and haven't paused), this
// watches the device's location and sends it up at most every 30 s, after moving 50 m, or
// every 2 minutes. A web page can only do that while it's open: on an iPhone, updates stop
// when 98ish is in the background or the screen locks, and the app says so.
//
//   setLocateSession({ token, screenName } | null)   from AimContext (signing on/off)
//   useLocate() -> { status, error, me, friends, geo, here, alerts }
//   shareWith(name, choice), stopSharing(name), stopAll(), setPaused(b), setCoarse(b),
//   askToSee(name), answerAsk(from, accept, choice), savePlaces(list), setWatch(who, place, on),
//   locateMe() -> { ok, pos }  (this device only; nothing is sent)
//   socket events (LocatorBridge): onPos, onGone, onShared, onChanged
//
// Nothing is kept in localStorage: it all comes from the server when you sign on.

export const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"
const CHECK_MS = 30_000 // shares running out, "2 min ago" ticking

const EMPTY = { status: "off", error: null, me: null, friends: [], geo: { state: "idle", error: null }, here: null, sentAt: 0, tick: 0 }
let state = EMPTY
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
export const getLocate = () => state
export const useLocate = () => useSyncExternalStore(subscribe, getLocate)

let session = null // { token, key, name }
let watchId = null
let lastSent = null // { lat, lon, at }
let ticker = null
let geoApi = () => (typeof navigator !== "undefined" ? navigator.geolocation : null)
// tests and the browser script can swap the device's location source
export const _setGeolocation = (api) => {
  geoApi = () => api
}

const keyOf = (name) => String(name || "").replace(/\s+/g, "").toLowerCase()

const api = async (path, body) => {
  if (!session) return { ok: false, error: "Sign on to 98 Messenger to use Buddy Locator." }
  try {
    const response = await fetch(`${SERVER_URL}/api/locate${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    })
    return await response.json().catch(() => ({ ok: false, error: `The server had a problem (${response.status}).` }))
  } catch {
    return { ok: false, error: "Couldn't reach the 98ish server. Try again in a minute." }
  }
}

// ---- what I'm sharing ----

export const activeShares = (me = state.me, now = Date.now()) => (me?.shares || []).filter((s) => core.shareActive(s, now))
export const isSharing = (s = state) => activeShares(s.me).length > 0 && !s.me?.paused

const applyMe = (me) => {
  if (!me) return
  set({ me })
  syncWatching()
}

export const refresh = async () => {
  if (!session) return { ok: false }
  if (state.status === "off") set({ status: "loading" })
  const result = await api("/state")
  if (!session) return result
  if (!result.ok) {
    set({ status: state.me ? "ready" : "error", error: result.error })
    return result
  }
  set({ status: "ready", error: null, me: result.me, friends: result.friends })
  syncWatching()
  return result
}

const act = async (path, body) => {
  const result = await api(path, body)
  if (result.ok && result.me) applyMe(result.me)
  else if (!result.ok) set({ error: result.error })
  return result
}

// choice: "hour" | "today" | "forever"
export const shareWith = async (name, choice = "hour") => {
  // the location prompt has to come from the tap: start watching first
  startWatching()
  return act("/share", { to: name, until: core.untilFor(choice, Date.now()) })
}
export const stopSharing = (name) => act("/unshare", { to: keyOf(name) })
export const stopAll = () => act("/unshare", { all: true })
export const setPaused = (paused) => {
  if (!paused) startWatching()
  return act("/pause", { paused })
}
export const setCoarse = (coarse) => act("/settings", { coarse })
export const askToSee = (name) => api("/ask", { to: name })
export const answerAsk = async (from, accept, choice = "hour") => {
  if (accept) startWatching()
  return act("/answer", { from, accept, until: accept ? core.untilFor(choice, Date.now()) : null })
}
export const savePlaces = (places) => act("/places", { places })
export const setWatch = (who, place, on) => act("/watch", { who, place, on })

// ---- the device's location ----

let pendingTimer = null
const sendIfDue = async (pos) => {
  if (!session || !isSharing()) return
  const now = Date.now()
  if (!core.shouldSend(lastSent, pos, now)) {
    // moved far enough but too soon: send the newest fix once the 30 s are up (a buddy who
    // then stands still would otherwise stay at the old spot until the 2-minute refresh)
    if (lastSent && core.distanceM(lastSent, pos) >= core.SEND_MIN_MOVE && !pendingTimer) {
      pendingTimer = setTimeout(() => {
        pendingTimer = null
        if (state.here) sendIfDue(state.here)
      }, Math.max(0, lastSent.at + core.SEND_MIN_MS - now) + 50)
    }
    return
  }
  clearTimeout(pendingTimer)
  pendingTimer = null
  // approximate location is rounded here too, so the exact spot never leaves the device
  const out = state.me?.coarse ? core.coarsen(pos) : pos
  lastSent = { lat: pos.lat, lon: pos.lon, at: now }
  const result = await api("/update", out)
  if (result.ok) set({ sentAt: now })
  else lastSent = null
}

const onFix = (fix) => {
  const c = fix.coords
  const pos = { lat: c.latitude, lon: c.longitude, acc: Math.round(c.accuracy || 0) }
  set({ here: { ...pos, at: Date.now() }, geo: { state: "watching", error: null } })
  sendIfDue(pos)
}
const onGeoError = (error) => {
  const denied = error?.code === 1
  set({ geo: { state: denied ? "denied" : "error", error: denied ? "Location is off for 98ish. Turn it on in Settings > Privacy > Location Services (Safari Websites), then try again." : "Couldn't find where you are right now." } })
  if (denied) stopWatching()
}

export const startWatching = () => {
  const geo = geoApi()
  if (!geo) {
    set({ geo: { state: "unavailable", error: "This browser can't share its location." } })
    return false
  }
  if (watchId != null) return true
  set({ geo: { state: "starting", error: null } })
  watchId = geo.watchPosition(onFix, onGeoError, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 })
  return true
}
export const stopWatching = () => {
  if (watchId != null) geoApi()?.clearWatch(watchId)
  watchId = null
  lastSent = null
  clearTimeout(pendingTimer)
  pendingTimer = null
  if (state.geo.state === "watching" || state.geo.state === "starting") set({ geo: { state: "idle", error: null } })
}

// watch while sharing; after a reload, start again by itself only if the browser already
// allows it (otherwise the tray and the app offer a "Resume" tap: iPhone wants the prompt
// to come from a tap)
const syncWatching = async () => {
  if (!session || !isSharing()) return stopWatching()
  // a fix that came in before the share was saved goes up now
  if (state.here && Date.now() - state.here.at < 60_000) sendIfDue(state.here)
  if (watchId != null) return
  try {
    const p = await navigator.permissions?.query?.({ name: "geolocation" })
    if (p?.state === "granted") return startWatching()
  } catch {
    // no Permissions API (older Safari)
  }
  if (watchId == null) set({ geo: { state: "needs-tap", error: null } })
}

// one fix for this device only ("Me" on the map, a place "Here")
export const locateMe = () =>
  new Promise((resolve) => {
    const geo = geoApi()
    if (!geo) return resolve({ ok: false, error: "This browser can't find its location." })
    if (state.here && Date.now() - state.here.at < 30_000) return resolve({ ok: true, pos: state.here })
    geo.getCurrentPosition(
      (fix) => {
        const c = fix.coords
        const here = { lat: c.latitude, lon: c.longitude, acc: Math.round(c.accuracy || 0), at: Date.now() }
        set({ here })
        resolve({ ok: true, pos: here })
      },
      (error) => resolve({ ok: false, error: error?.code === 1 ? "Location is off for 98ish." : "Couldn't find where you are." }),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 }
    )
  })

// ---- live changes from the server (98 Messenger socket, through LocatorBridge) ----

const upsertFriend = (key, patch) => {
  const list = state.friends.some((f) => f.key === key) ? state.friends.map((f) => (f.key === key ? { ...f, ...patch } : f)) : [...state.friends, { key, ...patch }]
  set({ friends: list.sort((a, b) => String(a.name).localeCompare(String(b.name))) })
}
export const onPos = ({ key, name, pos, paused }) => {
  if (!key) return
  upsertFriend(key, { name, pos, ...(paused !== undefined ? { paused } : pos ? { paused: false } : {}) })
}
export const onGone = ({ key, reason }) => {
  if (!key) return
  if (reason === "paused") upsertFriend(key, { pos: null, paused: true })
  else set({ friends: state.friends.filter((f) => f.key !== key) })
}
export const onShared = ({ key, name, until, pos }) => {
  if (!key) return
  upsertFriend(key, { name, until, pos: pos || null, paused: false })
}
export const onChanged = () => refresh()

// ---- signing on and off ----

export const setLocateSession = (next) => {
  const key = next?.token ? keyOf(next.screenName) : null
  if (!key) {
    session = null
    stopWatching()
    clearInterval(ticker)
    ticker = null
    state = EMPTY
    emit()
    return
  }
  if (session?.token === next.token) return
  session = { token: next.token, key, name: next.screenName }
  state = { ...EMPTY, status: "loading" }
  emit()
  clearInterval(ticker)
  ticker = setInterval(() => {
    // a share of mine ran out, or one with me did: read again; otherwise just tick the clocks
    const now = Date.now()
    const mineEnded = (state.me?.shares || []).some((s) => !core.shareActive(s, now))
    const theirsEnded = state.friends.some((f) => f.until != null && f.until <= now)
    if (mineEnded || theirsEnded) refresh()
    else set({ tick: now })
    if (!isSharing()) stopWatching()
    // standing still: the device sends no new fixes, so refresh "2 min ago" with the last one
    else if (state.here && watchId != null) sendIfDue(state.here)
  }, CHECK_MS)
  refresh()
}

export const locateAccount = () => session?.key || null

// dev hook (browser scripts): what this device knows
if (typeof window !== "undefined") window.__locate = { get: getLocate, refresh }
