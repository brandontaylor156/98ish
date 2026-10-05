import { useSyncExternalStore } from "react"
import { cleanDnd, dndAllows, dndEndsAt, dndReason, turnedOff, turnedOn } from "./dndCore.js"

// Do Not Disturb on this device (the rules are in ./dndCore.js, shared with the push
// server). Saved per user (98ish.dnd, through the storage seam) and, while signed on to 98
// Messenger, synced to the account (PUT /api/push/dnd: the newest change wins), so pushes
// to the phone are held while it's on and calls only ring for the people let through.
//
//   useDnd() -> { state, active, reason, endsAt }
//   dndAllowsNow(kind, from): may a toast/sound/ring of this kind interrupt right now?
//     (kind: an app id from utils/notifications: "calls" with from, "calendar", "im"...)
//   turnOnDnd("hour" | "morning" | "off"), turnOffDnd(), setDnd(patch)
//   syncDnd(token): fetch the account's state and keep the newer one
// Everything that interrupts asks notifications.js's interrupts(), which asks this.

const KEY = "98ish.dnd"
const TICK_MS = 15_000
const SERVER_URL = (import.meta.env && import.meta.env.VITE_SOCKET_URL) || "http://localhost:8000"

const load = () => {
  try {
    return cleanDnd(JSON.parse(localStorage.getItem(KEY)))
  } catch {
    return cleanDnd(null)
  }
}

let state = load()
let token = null // the signed-on 98 Messenger session's token (NotifyBridge sets it)
const listeners = new Set()

const snap = (t = Date.now()) => {
  const reason = dndReason(state, t)
  return { state, active: !!reason, reason, endsAt: reason ? dndEndsAt(state, t) : null }
}
let snapshot = snap()

const emit = () => {
  snapshot = snap()
  listeners.forEach((fn) => fn())
}

// the schedule and "for 1 hour" turn it on and off by themselves
let timer = null
const tick = () => {
  const next = snap()
  if (next.active !== snapshot.active || next.reason !== snapshot.reason || next.endsAt !== snapshot.endsAt) emit()
}
const startTicking = () => {
  if (timer || typeof window === "undefined") return
  timer = setInterval(tick, TICK_MS)
  document.addEventListener?.("visibilitychange", tick)
}

const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // storage blocked: this visit only
  }
}

const api = async (method, body) => {
  if (!token) return null
  try {
    const response = await fetch(`${SERVER_URL}/api/push/dnd`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    return response.ok && data.ok ? cleanDnd(data.dnd) : null
  } catch {
    return null
  }
}

// keep whichever is newer (another device may have changed it)
const adopt = (remote) => {
  if (!remote || remote.updatedAt <= state.updatedAt) return false
  state = remote
  save()
  emit()
  return true
}

const upload = async () => {
  const winner = await api("PUT", { dnd: state, tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
  if (winner) adopt(winner)
}

export const subscribeDnd = (fn) => {
  startTicking()
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const getDnd = () => snapshot
export const useDnd = () => useSyncExternalStore(subscribeDnd, getDnd)

export const setDnd = (patch) => {
  state = cleanDnd({ ...state, ...patch, updatedAt: Math.max(Date.now(), state.updatedAt + 1) })
  save()
  emit()
  upload()
}
export const turnOnDnd = (choice = "off") => setDnd(turnedOn(state, choice))
export const turnOffDnd = () => setDnd(turnedOff(state))
export const toggleDnd = () => (snapshot.active ? turnOffDnd() : turnOnDnd("off"))

export const dndAllowsNow = (kind, from) => dndAllows(state, { kind, from })

// the signed-on account: its state comes down, ours goes up if it's newer
export const setDndSession = (value) => {
  token = value || null
  if (token) syncDnd()
}
export const syncDnd = async () => {
  const remote = await api("GET")
  if (!remote) return
  if (!adopt(remote) && state.updatedAt > remote.updatedAt) upload()
}

// the Address Book's favorites (their screen names) may ring through
// (the account's newest state first, so an old one here doesn't win by being touched)
export const setDndFavorites = async (keys) => {
  const next = [...new Set(keys)].sort()
  if (next.join() === [...state.favorites].sort().join()) return
  await syncDnd()
  if (next.join() !== [...state.favorites].sort().join()) setDnd({ favorites: next })
}

// for tests in the browser: window.__dnd
if (typeof window !== "undefined" && import.meta.env && import.meta.env.DEV) window.__dnd = { get: () => snapshot, setDnd, turnOnDnd, turnOffDnd, sync: syncDnd }
