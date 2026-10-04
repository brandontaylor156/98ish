import { useSyncExternalStore } from "react"

// Couples ("Us"): who you're paired with on 98 Messenger, shared by every couple feature.
//   useCouple() -> { status: "signed-out" | "single" | "pending-out" | "pending-in" | "paired",
//                    me, partner, coupleId, since, incoming, outgoing, partnerOnline, partnerAway,
//                    letters, bouquets, ...actions }
//   requestPair(name), acceptPair(from?), declinePair(from?), cancelPair(), unpair(deleteNow?)
//   on("couple:letter", fn) -> unsubscribe     live notices from the server (couple:*)
//   coupleApi(method, path, body)                 /api/couples, signed with the Messenger session
//   serverNow()                                   the server's clock (letters unlock by it)
//   openCouples(program?, extra?)                 open Us (or "Love Letters", "Our Story"...)
// CoupleBridge (inside 98 Messenger's provider) keeps this up to date; this file stays small
// because the taskbar uses it too.

export const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"
export const OPEN_EVENT = "98ish:couple-open"
// an open couple program asked to show something ({ program, view, ... })
export const VIEW_EVENT = "98ish:couple-view"
// show the next Our Story photo on the "Our photos" wallpaper
export const NEXT_PHOTO_EVENT = "98ish:our-photos-next"

const SIGNED_OUT = {
  status: "signed-out",
  me: null,
  partner: null,
  coupleId: null,
  since: null,
  incoming: [],
  outgoing: null,
  partnerOnline: false,
  partnerAway: false,
  letters: null, // { inbox, outbox } (headers only)
  bouquets: null, // flowers sent to me, newest first
}

let state = SIGNED_OUT
let token = null
let offset = 0 // the server's clock minus ours
const listeners = new Set()
const handlers = new Map() // "couple:..." -> Set(fn)

export const getCouple = () => state
export const setCouple = (patch) => {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}
export const resetCouple = () => {
  token = null
  setCouple(SIGNED_OUT)
}
export const setCoupleToken = (value) => (token = value)
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const serverNow = () => Date.now() + offset

// ---- the HTTP API: resolves to { ok, ... } or { ok: false, error } (never throws) ----

export const coupleApi = async (method, path = "", body) => {
  if (!token) return { ok: false, status: 401, error: "Sign on to 98 Messenger first." }
  try {
    const response = await fetch(`${SERVER_URL}/api/couples${path}`, {
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

const STATUS_FIELDS = ["status", "me", "partner", "coupleId", "since", "incoming", "outgoing"]
const applyStatus = (result) => {
  if (!result?.ok) return result
  const patch = Object.fromEntries(STATUS_FIELDS.map((k) => [k, result[k]]))
  // leaving a couple forgets its things
  if (result.coupleId !== state.coupleId) Object.assign(patch, { letters: null, bouquets: null })
  setCouple(patch)
  // the person you were paired with deleted their 98 Messenger account (told once)
  if (result.notice === "closed") queueMicrotask(() => emitCouple("couple:closed", {}))
  return result
}

export const refreshCouple = async () => applyStatus(await coupleApi("GET", "/"))
export const requestPair = async (name) => applyStatus(await coupleApi("POST", "/request", { to: name }))
export const acceptPair = async (from) => applyStatus(await coupleApi("POST", "/accept", { from }))
export const declinePair = async (from) => applyStatus(await coupleApi("POST", "/decline", { from }))
export const cancelPair = async () => applyStatus(await coupleApi("POST", "/cancel", {}))
export const unpair = async (deleteNow = false) => applyStatus(await coupleApi("POST", "/unpair", { deleteNow }))

// The paired couple's letters and flowers (headers only), for badges and the flower widget
export const refreshCoupleThings = async () => {
  if (state.status !== "paired") return
  const [letters, flowers] = await Promise.all([coupleApi("GET", "/letters"), coupleApi("GET", "/flowers")])
  if (state.status !== "paired") return
  setCouple({
    ...(letters.ok ? { letters: { inbox: letters.inbox, outbox: letters.outbox } } : {}),
    ...(flowers.ok ? { bouquets: flowers.received } : {}),
  })
}

// ---- live notices ----

export const on = (event, fn) => {
  if (!handlers.has(event)) handlers.set(event, new Set())
  handlers.get(event).add(fn)
  return () => handlers.get(event)?.delete(fn)
}
export const emitCouple = (event, payload) => handlers.get(event)?.forEach((fn) => fn(payload))

// ---- opening things ----

export const openCouples = (program = "Us", extra = {}) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { program, extra } }))

// letters ready to read that haven't been opened ("Open when..." ones wait for their moment)
export const unreadLetters = (s = state, now = serverNow()) =>
  (s.letters?.inbox || []).filter((l) => !l.openedAt && l.unlockAt <= now && l.delivery !== "openwhen").length

export const useCouple = () => {
  const value = useSyncExternalStore(subscribe, getCouple)
  return { ...value, requestPair, acceptPair, declinePair, cancelPair, unpair, refresh: refreshCouple, api: coupleApi, on, token }
}
