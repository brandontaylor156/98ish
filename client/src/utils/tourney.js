import { useSyncExternalStore } from "react"

// Pickleball 98 tournaments on this device (the server is server/tourney; the rules and the
// schedule are applets/pbclub/tourneyCore.js). Outside React so the live notices
// (PbClubBridge), Real Games' Tournaments tab, My Park and the Locker Room share it.
//
//   setTourneySession({ token, screenName } | null)   from AimContext
//   useTourneys() -> { status, error, me, events: [summary], trophies, docs: { id: record }, now }
//   refresh(), open(id) (the full record), enter(id, div, partner), withdraw(id),
//   answer(id, accept), here(id, match), room(id, match, code), report(id, match, score)
//
// Kept on this device (per user, through the storage seam): your trophies
// ("98ish.tourney.trophies"), so the Locker Room shows them signed off too.

export const SERVER_URL = import.meta.env?.VITE_SOCKET_URL || "http://localhost:8000"
const TROPHIES = "98ish.tourney.trophies"

const readTrophies = () => {
  try {
    const list = JSON.parse(localStorage.getItem(TROPHIES) || "[]")
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}
const writeTrophies = (list) => {
  try {
    localStorage.setItem(TROPHIES, JSON.stringify(list.slice(0, 60)))
  } catch {
    // storage blocked
  }
}

const EMPTY = { status: "off", error: null, me: null, events: [], trophies: [], docs: {}, now: 0 }
let state = { ...EMPTY, trophies: typeof localStorage === "undefined" ? [] : readTrophies() }
const listeners = new Set()
const set = (patch) => {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}
const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn))
export const getTourneys = () => state
export const useTourneys = () => useSyncExternalStore(subscribe, getTourneys)

let session = null
const keyOf = (name) => String(name || "").replace(/\s+/g, "").toLowerCase()

const api = async (path, body) => {
  if (!session) return { ok: false, offline: true, error: "Sign on to 98 Messenger to play in tournaments." }
  try {
    const response = await fetch(`${SERVER_URL}/api/tourney${path}`, { method: "POST", headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
    return await response.json().catch(() => ({ ok: false, error: `The server had a problem (${response.status}).` }))
  } catch {
    return { ok: false, offline: true, error: "Couldn't reach the 98ish server." }
  }
}

const mergeTrophies = (server) => {
  const byId = new Map(readTrophies().map((t) => [t.id, t]))
  for (const t of server || []) byId.set(t.id, t)
  const list = [...byId.values()].sort((a, b) => b.at - a.at)
  writeTrophies(list)
  return list
}

export const refresh = async () => {
  if (!session) return { ok: false }
  if (state.status === "off") set({ status: "loading" })
  const r = await api("/list", {})
  if (!session) return r
  if (!r.ok) return set({ status: state.events.length ? "ready" : "error", error: r.error }), r
  set({ status: "ready", error: null, events: r.events, trophies: mergeTrophies(r.trophies), now: r.now })
  // keep open records fresh too
  for (const id of Object.keys(state.docs)) open(id)
  return r
}
let soon = null
export const refreshSoon = () => {
  clearTimeout(soon)
  soon = setTimeout(refresh, 300)
}

const took = (r) => {
  if (r?.ok && r.tourney) set({ docs: { ...state.docs, [r.tourney.id]: r.tourney }, now: r.now || state.now })
  if (r?.ok) refreshSoon()
  return r
}
export const open = async (id) => took(await api("/get", { id }))
export const enter = async (id, div, partner = "") => took(await api("/enter", { id, div, partner }))
export const withdraw = async (id) => took(await api("/withdraw", { id }))
export const answer = async (id, accept) => took(await api("/partner", { id, act: accept ? "accept" : "decline" }))
export const here = async (id, match) => took(await api("/here", { id, match }))
export const room = async (id, match, code) => took(await api("/room", { id, match, code }))
export const report = async (id, match, score) => took(await api("/report", { id, match, score }))

export const setTourneySession = (next) => {
  const key = next?.token ? keyOf(next.screenName) : null
  if (!key) {
    session = null
    state = { ...EMPTY, trophies: readTrophies() }
    listeners.forEach((fn) => fn())
    return
  }
  if (session?.key === key && session.token === next.token) return
  session = { token: next.token, key, name: next.screenName }
  state = { ...EMPTY, status: "loading", me: key, trophies: readTrophies() }
  listeners.forEach((fn) => fn())
  refresh()
}
export const signedOn = () => !!session

// a match you just played in Pickleball 98 (the result card): { id, match, side }
let playing = null
export const setPlaying = (p) => (playing = p)
export const getPlaying = () => playing

if (typeof window !== "undefined" && import.meta.env?.DEV) window.__tourney = { getTourneys, refresh, open, enter, report, room, here }
