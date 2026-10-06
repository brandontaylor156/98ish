// Come Over on this device: the hangout you're in (who's here, their cursors, their desktops,
// who follows whom), invitations, and files handed to you. Kept outside React so it survives
// windows re-rendering; AimContext forwards the hg:* events here and hands over its socket.
// The server is server/aim/hangout.js; the pure parts are applets/hangout/hangoutCore.js.

import { useSyncExternalStore } from "react"
import { throttle } from "../components/applets/hangout/hangoutCore"
import { createVoiceSession } from "./voice/session.js"

const EMPTY = { id: null, state: null, cursors: {}, desks: {}, invites: [], gifts: [], docs: [], error: null, ended: null, view: null, acts: [], stats: { sent: 0, got: 0, since: 0 } }
let snap = EMPTY
const listeners = new Set()
let link = null // { request(event, payload) -> Promise, emit(event, payload), meKey() } from AimContext

const set = (patch) => {
  snap = { ...snap, ...patch }
  listeners.forEach((fn) => fn())
}
export const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const getSnapshot = () => snap
export const useHangout = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
export const meKey = () => link?.meKey?.() || null
export const online = () => !!link

// bytes on the wire (roughly: the JSON) for Come Over's own numbers in its window
const count = (dir, payload) => {
  const n = payload == null ? 0 : typeof payload === "string" ? payload.length : JSON.stringify(payload).length
  const stats = { ...snap.stats, since: snap.stats.since || Date.now() }
  stats[dir] += n + 12
  snap = { ...snap, stats }
}

export const attachHangout = (next) => {
  const was = link
  link = next
  if (!next) {
    if (snap.id) set({ ...EMPTY, invites: [], ended: { reason: "signedoff" } })
    return
  }
  // back after a reconnect: the server kept our place (or ended it); ask
  if (!was && snap.id) join(snap.id)
}

const ask = async (event, payload) => {
  if (!link) return { ok: false, error: "Sign on to 98 Messenger to have friends come over." }
  count("sent", payload)
  try {
    const res = (await link.request(event, payload)) || { ok: false }
    count("got", res)
    return res
  } catch {
    return { ok: false, error: "Couldn't reach 98 Messenger." }
  }
}
const fire = (event, payload) => {
  if (!link) return
  count("sent", payload)
  link.emit(event, payload)
}

// ---- actions ----

export const invite = async (name) => {
  const res = await ask("hg:invite", { to: name })
  if (res.ok) set({ id: res.state.id, state: res.state, error: null, ended: null })
  else set({ error: res.error })
  return res
}

export const join = async (id) => {
  const res = await ask("hg:join", { id })
  if (!res.ok) {
    set({ error: res.error, invites: snap.invites.filter((i) => i.id !== id), ...(res.ended ? { id: null, state: null } : {}) })
    return res
  }
  const desks = {}
  for (const d of res.desks || []) desks[d.k] = d.snap
  set({ id: res.state.id, state: res.state, desks, cursors: {}, error: null, ended: null, invites: snap.invites.filter((i) => i.id !== id), stats: { sent: 0, got: 0, since: Date.now() } })
  return res
}

export const decline = (id) => {
  set({ invites: snap.invites.filter((i) => i.id !== id) })
  ask("hg:decline", { id })
}

export const leave = async () => {
  if (!snap.id) return
  stopVoice()
  sendPresence.cancel()
  await ask("hg:leave", {})
  set({ ...EMPTY, invites: snap.invites })
}

// the cursor (or a tap), at most 15 times a second; f: the focused window (only on change)
const rawPresence = (p) => fire("hg:p", p)
export const sendPresence = throttle(rawPresence)
let lastFocus = undefined
let myCursor = null // where your own pointer is (voice pans friends relative to it)
export const presence = (x, y, { tap = false, focus } = {}) => {
  if (!snap.id) return
  const p = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }
  myCursor = { x: p.x, y: p.y }
  if (tap) p.t = 1
  const f = focus ? JSON.stringify(focus) : null
  if (focus !== undefined && f !== lastFocus) {
    p.f = focus
    lastFocus = f
  }
  if (tap || p.f !== undefined) {
    sendPresence.cancel()
    rawPresence(p)
  } else sendPresence(p)
}

export const publishDesk = (snapshot) => (snap.id ? ask("hg:desk", { snap: snapshot }) : Promise.resolve({ ok: false }))
export const allowTouch = (touch) => ask("hg:perm", { touch })
export const act = (to, action) => ask("hg:act", { to, act: action })
export const follow = (key) => ask("hg:watch", { key: key || null })
const rawView = (v) => fire("hg:view", v)
export const sendView = throttle(rawView, 4)
export const give = (to, file) => ask("hg:give", { to, file })
export const shareDoc = (id) => ask("hg:doc", { id })
export const dismissGift = (gift) => set({ gifts: snap.gifts.filter((g) => g !== gift) })
export const takeActs = () => {
  const acts = snap.acts
  if (acts.length) snap = { ...snap, acts: [] }
  return acts
}
export const clearEnded = () => set({ ended: null, error: null })
export const watching = () => snap.state?.people?.find((p) => p.key === meKey())?.watching || null

// ---- events from the server (AimContext forwards these) ----

export const HANGOUT_EVENTS = ["hg:invite", "hg:state", "hg:p", "hg:desk", "hg:act", "hg:view", "hg:gift", "hg:doc", "hg:end", "hg:vc", "hg:sig"]
const listenersFor = new Map() // event -> Set(fn): the desktop layer reacts to some at once
export const onHangoutEvent = (event, fn) => {
  if (!listenersFor.has(event)) listenersFor.set(event, new Set())
  listenersFor.get(event).add(fn)
  return () => listenersFor.get(event)?.delete(fn)
}

export const handleHangoutEvent = (event, payload) => {
  count("got", payload)
  switch (event) {
    case "hg:invite":
      if (!snap.invites.some((i) => i.id === payload.id)) set({ invites: [...snap.invites, { ...payload, at: Date.now() }].slice(-5) })
      break
    case "hg:state":
      if (snap.id && payload.id !== snap.id) break
      {
        // people who left take their cursors and desktops with them
        const here = new Set(payload.people.map((p) => p.key))
        const cursors = Object.fromEntries(Object.entries(snap.cursors).filter(([k]) => here.has(k)))
        const desks = Object.fromEntries(Object.entries(snap.desks).filter(([k]) => here.has(k)))
        set({ id: payload.id, state: payload, cursors, desks })
      }
      break
    case "hg:p": {
      const prev = snap.cursors[payload.k] || {}
      const next = { ...prev, x: payload.x, y: payload.y, at: Date.now() }
      if (payload.t) next.tapAt = Date.now()
      if (payload.f !== undefined) next.focus = payload.f
      snap = { ...snap, cursors: { ...snap.cursors, [payload.k]: next } }
      listeners.forEach((fn) => fn())
      break
    }
    case "hg:desk":
      set({ desks: { ...snap.desks, [payload.k]: payload.snap } })
      break
    case "hg:act":
      set({ acts: [...snap.acts, payload].slice(-10) })
      break
    case "hg:view":
      set({ view: { ...payload, at: Date.now() } })
      break
    case "hg:gift":
      set({ gifts: [...snap.gifts, { ...payload, at: Date.now() }].slice(-10) })
      break
    case "hg:doc":
      set({ docs: [...snap.docs.filter((d) => d.id !== payload.id), payload] })
      break
    case "hg:end":
      stopVoice()
      set({ ...EMPTY, invites: snap.invites, ended: payload })
      break
    default:
  }
  listenersFor.get(event)?.forEach((fn) => fn(payload))
}

// ---- voice (utils/voice): talk while you hang out; a friend's voice comes from where their
// pointer is (left or right of yours), or plainly with Spatial Sound off ----
let voice = null // { id, session }
let voiceState = { status: "off", peers: {}, on: [], spatial: true }
const voiceListeners = new Set()
const voiceSet = (s) => {
  voiceState = { ...voiceState, ...s }
  voiceListeners.forEach((fn) => fn())
}
const voiceFor = () => {
  if (!snap.id) return null
  if (voice?.id === snap.id) return voice.session
  voice?.session.stop()
  const space = {
    get me() {
      return meKey()
    },
    mode: "pan",
    join: (on) => ask("hg:vc", { on }),
    send: (to, kind, data) => ask("hg:sig", { to, kind, data }),
    listen: (onList, onSignal) => {
      const a = onHangoutEvent("hg:vc", (d) => onList(d?.on || []))
      const b = onHangoutEvent("hg:sig", (d) => d && onSignal(d.from, d.kind, d.data))
      return () => (a(), b())
    },
    place: () => (voiceState.spatial ? { mine: myCursor, people: snap.cursors } : { mine: null, people: {} }),
  }
  const session = createVoiceSession({ space })
  session.subscribe((s) => voiceSet(s))
  voice = { id: snap.id, session }
  return session
}
export const voiceSession = () => voiceFor()
export const toggleVoice = () => {
  const s = voiceFor()
  if (!s) return
  if (s.state.status === "off" || s.state.status === "error") s.start()
  else s.stop()
}
export const setSpatialVoice = (b) => voiceSet({ spatial: !!b })
function stopVoice() {
  voice?.session.stop()
  voice = null
  voiceSet({ status: "off", peers: {}, on: [], talking: false })
}
const subscribeVoice = (fn) => (voiceListeners.add(fn), () => voiceListeners.delete(fn))
const voiceSnapshot = () => voiceState
export const useHangoutVoice = () => useSyncExternalStore(subscribeVoice, voiceSnapshot, voiceSnapshot)

// dev/test hooks
if (typeof window !== "undefined" && import.meta.env?.DEV) window.__hangout = { getSnapshot, invite, join, leave, presence, give, follow, allowTouch, publishDesk, act, toggleVoice, voiceSession, voice: () => voiceState }
