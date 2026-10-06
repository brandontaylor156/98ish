// Watch & Listen Together on this device: the one session you're in, kept outside React so
// it survives the window re-rendering (and its events arrive before the window has loaded:
// AimContext forwards them here). The window reads it with useTogether().
//
// The server relays control state only (server/aim/together.js); the video plays in each
// person's own YouTube player.

import { useSyncExternalStore } from "react"
import { offsetFrom } from "./syncCore"

const EMPTY = { id: null, state: null, chat: [], reactions: [], offset: 0, error: null, ended: null, joining: false }
let snap = EMPTY
const listeners = new Set()
let link = null // { request(event, payload) -> Promise, meKey() } from AimContext
let reactionSeq = 0

const set = (patch) => {
  snap = { ...snap, ...patch }
  listeners.forEach((fn) => fn())
}

export const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const getSnapshot = () => snap
export const useTogether = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

// AimContext hands over its socket request function once signed on (null when signed off)
export const attachTogether = (next) => {
  const was = link
  link = next
  if (!next) {
    if (snap.id) set({ ...EMPTY, ended: snap.state ? { reason: "signedoff" } : null })
    return
  }
  // a fresh sign on (the old session was signed off): join again if it's still going
  if (!was && snap.id) join(snap.id)
}

const ask = async (event, payload) => {
  if (!link) return { ok: false, error: "Sign on to 98 Messenger to watch together." }
  try {
    return (await link.request(event, payload)) || { ok: false }
  } catch {
    return { ok: false, error: "Couldn't reach 98 Messenger." }
  }
}

export const meKey = () => link?.meKey?.() || null

// a few round trips to learn how far this device's clock is from the server's
export const syncClock = async (rounds = 4) => {
  const samples = []
  for (let i = 0; i < rounds; i++) {
    const t0 = Date.now()
    const res = await ask("tg:time", {})
    const t1 = Date.now()
    if (res?.ok) samples.push({ t0, t1, server: res.now })
  }
  if (samples.length) set({ offset: offsetFrom(samples) })
  return snap.offset
}
export const serverNow = () => Date.now() + snap.offset

const entered = (res) => {
  if (!res?.ok) {
    set({ joining: false, error: res?.error || "Couldn't start Watch Together.", ...(res?.ended ? { id: null, state: null } : {}) })
    return res
  }
  set({ id: res.id, state: res.state, chat: res.chat || [], error: null, ended: null, joining: false, reactions: [] })
  syncClock()
  return res
}

// { with } or { room }, optionally a first video { video, title, start }
export const start = async (options) => {
  if (snap.id) await leave()
  set({ joining: true, error: null })
  return entered(await ask("tg:start", options))
}

export const join = async (id) => {
  if (snap.id && snap.id !== id) await leave()
  set({ joining: true, error: null, id })
  return entered(await ask("tg:join", { id }))
}

export const leave = async () => {
  const id = snap.id
  if (!id) return
  set({ ...EMPTY, offset: snap.offset })
  await ask("tg:leave", { id })
}

export const endForEveryone = () => ask("tg:end", { id: snap.id })
export const cmd = (op, extra = {}) => ask("tg:cmd", { id: snap.id, op, ...extra })
export const addVideo = (video, title) => ask("tg:queue", { id: snap.id, op: "add", video, title })
export const removeItem = (item) => ask("tg:queue", { id: snap.id, op: "remove", item })
export const moveItem = (item, to) => ask("tg:queue", { id: snap.id, op: "move", item, to })
export const setAnyone = (anyone) => ask("tg:settings", { id: snap.id, anyone })
export const react = (emoji) => ask("tg:react", { id: snap.id, emoji })
export const say = (text) => ask("tg:say", { id: snap.id, text })
export const mine = () => ask("tg:mine", {})
export const clearError = () => set({ error: null })
export const dismissEnded = () => set({ ended: null })

// server events (forwarded by AimContext)
export const handleTogetherEvent = (event, payload) => {
  if (!payload || payload.id !== snap.id) return
  if (event === "tg:state") {
    // newer only (events can cross an ack)
    if (snap.state && payload.rev < snap.state.rev) return
    set({ state: payload })
  } else if (event === "tg:say") {
    set({ chat: [...snap.chat, payload.line].slice(-30) })
  } else if (event === "tg:react") {
    const r = { n: ++reactionSeq, emoji: payload.emoji, from: payload.from, x: 10 + Math.random() * 80 }
    set({ reactions: [...snap.reactions, r].slice(-24) })
    setTimeout(() => set({ reactions: snap.reactions.filter((x) => x !== r) }), 2600)
  } else if (event === "tg:end") {
    set({ ...EMPTY, offset: snap.offset, ended: { reason: payload.reason, title: snap.state?.queue?.[snap.state.index]?.title || "" } })
  }
}

export const TOGETHER_EVENTS = ["tg:state", "tg:say", "tg:react", "tg:end"]

// tests
export const resetTogether = () => {
  snap = EMPTY
  listeners.forEach((fn) => fn())
}
