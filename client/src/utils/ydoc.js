// Shared documents on this device (Come Over): a Notepad text, a Paint picture or the Shared
// with Friends folder, each a Yjs document that everyone in it edits at once. The relay is
// server/aim/ydocs.js; this keeps one Y.Doc per open document, syncs it both ways when it
// opens and every time 98 Messenger reconnects (which is also how edits made offline merge),
// sends local changes (merged into one update every 40 ms), and passes cursors around.
//
//   const h = openShared(id)   // { doc, ready, meta, onAware(fn), aware(state), close(), status }
//   h.doc.getText("t") ...     // local edits sync by themselves
//   h.close()

import * as Y from "yjs"
import { useSyncExternalStore } from "react"

let link = null // { request, emit, meKey } from AimContext
const open = new Map() // id -> entry
let metas = [] // documents shared with me (yd:list + yd:meta)
const metaListeners = new Set()
let sentBytes = 0
let gotBytes = 0

const b64 = (u8) => {
  let s = ""
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (text) => {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const ask = async (event, payload) => {
  if (!link) return { ok: false, error: "Sign on to 98 Messenger to share with friends.", offline: true }
  sentBytes += JSON.stringify(payload || {}).length
  try {
    const res = (await link.request(event, payload)) || { ok: false }
    gotBytes += JSON.stringify(res).length
    return res
  } catch {
    return { ok: false, error: "Couldn't reach 98 Messenger.", offline: true }
  }
}
export const ydocTraffic = () => ({ sent: sentBytes, got: gotBytes })

// ---- the list of shared documents ----
const setMetas = (next) => {
  metas = next
  metaListeners.forEach((fn) => fn())
}
export const useSharedDocs = () =>
  useSyncExternalStore(
    (fn) => (metaListeners.add(fn), () => metaListeners.delete(fn)),
    () => metas,
    () => metas
  )
export const refreshShared = async () => {
  const res = await ask("yd:list", {})
  if (res.ok) setMetas(res.docs)
  return res
}
export const createShared = async (kind, title, withNames = []) => {
  const res = await ask("yd:create", { kind, title, with: withNames })
  if (res.ok) setMetas([res.meta, ...metas.filter((m) => m.id !== res.id)])
  return res
}
export const shareWith = (id, names) => ask("yd:share", { id, with: names })
export const deleteShared = async (id) => {
  const res = await ask("yd:delete", { id })
  if (res.ok) setMetas(metas.filter((m) => m.id !== id))
  return res
}
export const metaOf = (id) => metas.find((m) => m.id === id) || open.get(id)?.meta || null

// ---- one open document ----

const sync = async (entry) => {
  if (!link || entry.closed) return
  entry.status = "syncing"
  entry.emit()
  const res = await ask("yd:open", { id: entry.id, sv: b64(Y.encodeStateVector(entry.doc)) })
  if (entry.closed) return
  if (!res.ok) {
    entry.status = res.gone ? "gone" : res.offline ? "offline" : "error"
    entry.error = res.error
    entry.emit()
    if (!res.gone) entry.resolve?.()
    return
  }
  entry.meta = res.meta
  Y.applyUpdate(entry.doc, unb64(res.update), "remote")
  // what the server hasn't got yet (edits made offline, or before it answered)
  const missing = Y.encodeStateAsUpdate(entry.doc, unb64(res.sv))
  entry.pending = []
  if (missing.length > 2) await send(entry, missing)
  entry.status = "live"
  entry.error = null
  entry.emit()
  entry.resolve?.()
}

const send = async (entry, update) => {
  const u = b64(update)
  const res = await ask("yd:up", { id: entry.id, u })
  if (res.ok) return true
  if (res.reopen || res.offline) {
    // the server forgot we had it open (a reconnect): the next sync sends it
    if (!res.offline) sync(entry)
    return false
  }
  if (res.retry) {
    setTimeout(() => send(entry, update), 1500)
    return false
  }
  entry.error = res.error
  if (res.full) entry.status = "full"
  if (res.gone) entry.status = "gone"
  entry.emit()
  return false
}

const flush = (entry) => {
  entry.timer = null
  if (!entry.pending.length || entry.status !== "live" || !link) return
  const merged = entry.pending.length === 1 ? entry.pending[0] : Y.mergeUpdates(entry.pending)
  entry.pending = []
  send(entry, merged)
}

export const openShared = (id) => {
  let entry = open.get(id)
  if (entry) {
    entry.refs++
    return entry.handle
  }
  const doc = new Y.Doc()
  entry = { id, doc, refs: 1, status: link ? "syncing" : "offline", error: null, meta: metaOf(id), pending: [], timer: null, closed: false, aware: new Map(), listeners: new Set(), awareListeners: new Set() }
  entry.emit = () => entry.listeners.forEach((fn) => fn())
  const ready = new Promise((r) => (entry.resolve = r))
  doc.on("update", (update, origin) => {
    if (origin === "remote") return
    entry.pending.push(update)
    if (!entry.timer) entry.timer = setTimeout(() => flush(entry), 40)
  })
  entry.handle = {
    id,
    doc,
    ready,
    get status() {
      return entry.status
    },
    get error() {
      return entry.error
    },
    get meta() {
      return entry.meta
    },
    subscribe: (fn) => (entry.listeners.add(fn), () => entry.listeners.delete(fn)),
    // others' cursors/selections: Map key -> { name, ...state }
    others: () => entry.aware,
    onAware: (fn) => (entry.awareListeners.add(fn), () => entry.awareListeners.delete(fn)),
    aware: (state) => {
      if (!link || entry.status !== "live") return
      sentBytes += JSON.stringify(state || {}).length
      link.emit("yd:aw", { id, a: state })
    },
    close: () => {
      entry.refs--
      if (entry.refs > 0) return
      entry.closed = true
      clearTimeout(entry.timer)
      flush({ ...entry, closed: false, status: "live" })
      open.delete(id)
      if (link) link.emit("yd:close", { id })
      doc.destroy()
    },
  }
  open.set(id, entry)
  sync(entry)
  return entry.handle
}

// ---- events (AimContext forwards these) ----

export const YDOC_EVENTS = ["yd:up", "yd:aw", "yd:meta", "yd:gone"]
export const handleYdocEvent = (event, payload) => {
  const entry = open.get(payload?.id)
  switch (event) {
    case "yd:up":
      gotBytes += (payload.u || "").length
      if (entry) Y.applyUpdate(entry.doc, unb64(payload.u), "remote")
      break
    case "yd:aw":
      gotBytes += JSON.stringify(payload.a || {}).length
      if (!entry) break
      if (payload.a == null) entry.aware.delete(payload.k)
      else entry.aware.set(payload.k, { ...payload.a, name: payload.n, at: Date.now() })
      entry.awareListeners.forEach((fn) => fn(entry.aware))
      break
    case "yd:meta":
      setMetas([payload.meta, ...metas.filter((m) => m.id !== payload.id)])
      if (entry) {
        entry.meta = payload.meta
        entry.emit()
      }
      break
    case "yd:gone":
      setMetas(metas.filter((m) => m.id !== payload.id))
      if (entry) {
        entry.status = "gone"
        entry.error = "This shared document was deleted or isn't shared with you any more."
        entry.emit()
      }
      break
    default:
  }
}

// AimContext hands over its socket while signed on; every reconnect re-syncs what's open
export const attachYdocs = (next) => {
  const was = link
  link = next
  if (!next) {
    for (const entry of open.values()) {
      entry.status = "offline"
      entry.emit()
    }
    return
  }
  if (!was) {
    for (const entry of open.values()) sync(entry)
    refreshShared()
  }
}

export const useSharedStatus = (handle) =>
  useSyncExternalStore(
    (fn) => (handle ? handle.subscribe(fn) : () => {}),
    () => (handle ? handle.status : "none"),
    () => (handle ? handle.status : "none")
  )

if (typeof window !== "undefined" && import.meta.env?.DEV) window.__ydoc = { openShared, createShared, refreshShared, open, ydocTraffic }
