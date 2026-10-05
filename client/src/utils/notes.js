import { useSyncExternalStore } from "react"
import * as core from "../components/applets/notes/notesCore.js"
import { registerSearchProvider } from "./searchIndex"

// Notes (sticky notes): kept on this device (localStorage "98ish.notes", so each 98ish user
// has their own: utils/userStorage.js) and, while signed on to 98 Messenger, synced with that
// account on the 98ish server (server/notes), note by note: each field newest-wins, each
// checklist item its own entry (notesCore.js). Notes made signed off go up at the next sign
// on; a guest who never signs on keeps them only here. Shared notes (a buddy edits them too)
// arrive like any other, with `share` saying who's in them; live changes come as
// "notes:changed" on the 98 Messenger socket (NotesBridge calls syncNow).
//
// Device-only (not synced): which notes are pinned to this desktop and where
// ("98ish.notes.desk"), and the sort order ("98ish.notes.prefs").
//
// Used by Notes, the desktop's sticky notes and phone Notes panel, Us, search and the
// Notification Center.

export const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"
const KEY = "98ish.notes"
const DESK_KEY = "98ish.notes.desk"
const PREFS_KEY = "98ish.notes.prefs"
const stashKey = (account) => `98ish.notes.acct.${account}`
const SYNC_EVERY_MS = 5 * 60_000
const SINCE_SLACK_MS = 10_000
const BATCH = 150

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}
const blank = () => ({ notes: {}, share: {}, dirty: [], rejected: {}, account: null, since: 0, syncedAt: null })
const loadBook = (saved) => ({ ...blank(), ...(saved && typeof saved === "object" ? saved : {}) })

let book = loadBook(read(KEY, null))
let desk = read(DESK_KEY, {}) || {}
let prefs = { sort: "recent", ...read(PREFS_KEY, {}) }
let status = { sync: "local", error: null, full: false } // local | syncing | synced | error
let snapshot = null
let version = 0
const listeners = new Set()

const rebuild = () => {
  const all = Object.values(book.notes).filter((n) => !core.isPurged(n))
  const pinned = new Set(Object.keys(desk).filter((id) => book.notes[id] && !core.isPurged(book.notes[id]) && !core.isTrashed(book.notes[id])))
  version++
  snapshot = {
    version,
    notes: core.sortNotes(
      all.filter((n) => !core.isTrashed(n)),
      prefs.sort,
      { pinned }
    ),
    trash: core.sortNotes(all.filter(core.isTrashed), "recent"),
    share: book.share,
    rejected: book.rejected,
    pinned,
    desk,
    sort: prefs.sort,
    account: book.account,
    signedOn: !!session,
    syncedAt: book.syncedAt,
    ...status,
  }
}

const emit = () => {
  rebuild()
  listeners.forEach((fn) => fn())
}
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(book))
    if (status.full) status = { ...status, full: false }
    return true
  } catch {
    status = { ...status, full: true }
    return false // storage full: kept for this visit
  }
}
// typing saves a moment later (a big book is a lot to write on every key); leaving the page
// writes at once
let saveTimer = null
const saveSoon = () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    save()
  }, 250)
}
const flush = () => {
  if (saveTimer === null) return
  clearTimeout(saveTimer)
  saveTimer = null
  save()
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush)
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush())
}
const saveDesk = () => {
  try {
    localStorage.setItem(DESK_KEY, JSON.stringify(desk))
  } catch {
    // ignore
  }
}

export const subscribeNotes = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const getNotesState = () => snapshot
export const useNotes = () => useSyncExternalStore(subscribeNotes, getNotesState)
export const getNote = (id) => {
  const n = book.notes[id]
  return n && !core.isPurged(n) ? n : null
}
export const shareOf = (id) => book.share[id] || null
export const isShared = (id) => !!book.share[id]

// "Shared with Tina", "Shared by Tina", "Shared with Tina and 2 others"
export const shareLabel = (share, me = book.account) => {
  if (!share) return ""
  const others = share.members.filter((m) => m.key !== me).map((m) => m.name)
  if (!others.length) return ""
  const names = others.length === 1 ? others[0] : others.length === 2 ? `${others[0]} and ${others[1]}` : `${others[0]} and ${others.length - 1} others`
  return `Shared with ${names}`
}

// ---- changes ----

const put = (note, { quiet = false } = {}) => {
  book = { ...book, notes: { ...book.notes, [note.id]: note }, dirty: book.account || session ? [...new Set([...book.dirty, note.id])] : book.dirty }
  if (book.rejected[note.id]) {
    const { [note.id]: gone, ...rest } = book.rejected
    book = { ...book, rejected: rest }
  }
  saveSoon()
  if (!quiet) emit()
  scheduleSync()
}

// a new note -> its id
export const createNote = (patch = {}) => {
  const note = core.newNote({ title: patch.title || "", body: patch.body || "", color: patch.color || prefs.lastColor || "yellow", items: patch.items || [] })
  put(note)
  return note.id
}

// change a note: fn(note, now) -> the changed note
export const updateNote = (id, fn) => {
  const old = getNote(id)
  if (!old) return null
  const next = fn(old, Date.now())
  if (!next || next === old) return old
  put(next)
  return next
}

export const setNoteField = (id, field, value) => updateNote(id, (n, now) => core.setField(n, field, value, now))
export const setNoteColor = (id, color) => {
  prefs = { ...prefs, lastColor: color }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // ignore
  }
  return setNoteField(id, "color", color)
}

const forgetLocal = (id) => {
  const { [id]: a, ...notes } = book.notes
  const { [id]: b, ...share } = book.share
  book = { ...book, notes, share, dirty: book.dirty.filter((d) => d !== id) }
  if (desk[id]) {
    const { [id]: c, ...rest } = desk
    desk = rest
    saveDesk()
  }
}

// Delete: into the Recycle Bin (30 days). A shared note isn't deleted for the others: you
// leave it and your copy goes to the Recycle Bin.
export const trashNote = (id) => {
  if (isShared(id)) return leaveNote(id, { trash: true })
  unpin(id)
  return updateNote(id, (n, now) => core.trashNote(n, now))
}
export const restoreNote = (id) => updateNote(id, (n, now) => core.restoreNote(n, now))

// gone for good (Recycle Bin > Delete, Empty Recycle Bin, or 30 days)
export const purgeNote = (id) => {
  const note = book.notes[id]
  if (!note) return
  if (!book.account && !session) {
    forgetLocal(id)
    save()
    emit()
    return
  }
  put(core.purgeNote(note, Date.now()))
}
export const emptyTrash = () => {
  for (const n of snapshot.trash) purgeNote(n.id)
}
export const purgeExpired = (now = Date.now()) => {
  for (const n of Object.values(book.notes)) if (core.trashExpired(n, now)) purgeNote(n.id)
}

// Leave a shared note: you keep a copy of your own (a new note; in the Recycle Bin with
// trash), and the note leaves your list (the server takes you out of it at the next sync)
export const leaveNote = (id, { trash = false, copy = true } = {}) => {
  const note = getNote(id)
  if (!note) return null
  let copyId = null
  if (copy) {
    const t = Date.now()
    let mine = { ...core.mergeNotes(note, note), id: core.newNoteId() }
    if (trash) mine = core.trashNote(mine, t)
    book = { ...book, notes: { ...book.notes, [mine.id]: mine }, dirty: [...new Set([...book.dirty, mine.id])] }
    copyId = mine.id
  }
  const { [id]: gone, ...share } = book.share
  book = { ...book, share }
  unpin(id)
  put(core.purgeNote(note, Date.now()))
  return copyId
}

// ---- the desktop (this device only) ----

export const pin = (id, rect = null) => {
  if (!getNote(id)) return
  desk = { ...desk, [id]: rect || desk[id] || { x: null, y: null, w: 210, h: 210 } }
  saveDesk()
  emit()
}
export const unpin = (id) => {
  if (!desk[id]) return
  const { [id]: gone, ...rest } = desk
  desk = rest
  saveDesk()
  emit()
}
export const moveDesk = (id, rect) => {
  if (!desk[id]) return
  desk = { ...desk, [id]: { ...desk[id], ...rect } }
  saveDesk()
  emit()
}
export const setSort = (sort) => {
  prefs = { ...prefs, sort: core.SORTS[sort] ? sort : "recent" }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // ignore
  }
  emit()
}

// ---- syncing with the 98ish server ----

let session = null // { token, key, name }
let syncTimer = null
let everyTimer = null
let running = null
let again = false
const remoteListeners = new Set()
// fn({ id, note, share, isNew, wasShared }) for notes that changed on the server, not here
export const onRemoteChange = (fn) => {
  remoteListeners.add(fn)
  return () => remoteListeners.delete(fn)
}

const setStatus = (patch) => {
  status = { ...status, ...patch }
  emit()
}

const api = async (method, path, body) => {
  try {
    const response = await fetch(`${SERVER_URL}/api/notes${path}`, {
      method,
      headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    })
    return await response.json().catch(() => ({ ok: false, error: `The server had a problem (${response.status}).` }))
  } catch {
    return { ok: false, error: "Couldn't reach the 98ish server. Your notes are safe on this device and sync later." }
  }
}

const syncOnce = async () => {
  const sent = book.dirty.slice(0, BATCH)
  const sentNotes = new Map(sent.map((id) => [id, book.notes[id]]))
  const result = await api("POST", "/sync", { since: book.since || 0, notes: [...sentNotes.values()].filter(Boolean) })
  if (!result?.ok) return result
  const changed = []
  let notes = { ...book.notes }
  let share = { ...book.share }
  // notes changed here while the request was out stay dirty (they're newer)
  const stillDirty = new Set(book.dirty.filter((id) => !sentNotes.has(id) || book.notes[id] !== sentNotes.get(id)))
  for (const { note, share: s } of result.notes || []) {
    const local = notes[note.id]
    const merged = core.mergeNotes(local, note)
    const fromElsewhere = !sentNotes.has(note.id) && (!local || !core.sameNote(core.mergeNotes(local, local), merged))
    notes[note.id] = merged
    if (s) share[note.id] = s
    else delete share[note.id]
    if (fromElsewhere) changed.push({ id: note.id, note: merged, share: s, isNew: !local, wasShared: !!book.share[note.id] })
    if (!stillDirty.has(note.id) && local && !core.sameNote(core.mergeNotes(local, note), note)) stillDirty.add(note.id) // ours has something the server didn't
  }
  for (const id of result.gone || []) {
    delete notes[id]
    delete share[id]
    stillDirty.delete(id)
    if (desk[id]) {
      const { [id]: x, ...rest } = desk
      desk = rest
      saveDesk()
    }
  }
  const rejected = { ...book.rejected }
  for (const r of result.rejected || []) {
    rejected[r.id] = r.error
    stillDirty.delete(r.id)
  }
  // tombstones the server has: no need to keep them here
  for (const [id, n] of Object.entries(notes)) if (!stillDirty.has(id) && core.isPurged(n)) delete notes[id]
  book = { ...book, notes, share, rejected, dirty: [...stillDirty], account: session.key, since: Math.max(0, result.now - SINCE_SLACK_MS), syncedAt: Date.now() }
  save()
  emit()
  for (const c of changed) remoteListeners.forEach((fn) => fn(c))
  return { ok: true, more: book.dirty.some((id) => !sent.includes(id)) && sent.length === BATCH }
}

export const syncNow = () => {
  if (!session) return Promise.resolve({ ok: false, error: "Not signed on" })
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    clearTimeout(syncTimer)
    setStatus({ sync: "syncing", error: null })
    let result
    for (let round = 0; round < 20; round++) {
      result = await syncOnce()
      if (!result?.ok || !result.more) break
    }
    if (!result?.ok) setStatus({ sync: "error", error: result?.error || "Couldn't sync your notes." })
    else setStatus({ sync: "synced", error: null })
    return result
  })().finally(() => {
    running = null
    if (again || book.dirty.length) {
      again = false
      scheduleSync(book.dirty.length ? 1500 : 0)
    }
  })
  return running
}

const scheduleSync = (wait = 1200) => {
  if (!session) return
  clearTimeout(syncTimer)
  syncTimer = setTimeout(syncNow, wait)
}

const onFocus = () => {
  if (session && document.visibilityState === "visible") syncNow()
}

const keyOf = (name) => String(name || "").replace(/\s+/g, "").toLowerCase()

// 98 Messenger signed on ({ token, screenName }) or off (null)
export const setSyncSession = (next) => {
  const key = next?.token ? keyOf(next.screenName) : null
  if (!key) {
    session = null
    clearTimeout(syncTimer)
    clearInterval(everyTimer)
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onFocus)
    setStatus({ sync: "local", error: null })
    return
  }
  if (session?.token === next.token) return
  // another account than these notes last synced with: put them aside (they come back when
  // that account signs on here again) and pick up this account's
  if (book.account && book.account !== key) {
    try {
      localStorage.setItem(stashKey(book.account), JSON.stringify(book))
    } catch {
      // full: they're still on the server
    }
    book = loadBook(read(stashKey(key), null))
    try {
      localStorage.removeItem(stashKey(key))
    } catch {
      // ignore
    }
    desk = {}
    saveDesk()
    save()
  }
  // notes never synced before go up to this account (made signed off, or as a guest)
  if (!book.account) book = { ...book, since: 0, dirty: [...new Set([...book.dirty, ...Object.keys(book.notes)])] }
  session = { token: next.token, key, name: next.screenName }
  clearInterval(everyTimer)
  everyTimer = setInterval(syncNow, SYNC_EVERY_MS)
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onFocus)
  emit()
  syncNow()
}

export const notesAccount = () => session?.key || null

const needOnline = () => (session ? null : { ok: false, error: "Sign on to 98 Messenger to share notes." })

// Share a note with a buddy (98 Messenger screen name)
export const shareNote = async (id, to) => {
  const off = needOnline()
  if (off) return off
  if (book.dirty.includes(id)) await syncNow() // the server needs the note first
  const result = await api("POST", `/${id}/share`, { to })
  if (result.ok) {
    book = { ...book, share: { ...book.share, [id]: result.share } }
    save()
    emit()
  }
  return result
}
// the owner takes one person out (key), or everyone else; they each keep a copy
export const unshareNote = async (id, key = null) => {
  const off = needOnline()
  if (off) return off
  const result = await api("POST", `/${id}/unshare`, key ? { key } : {})
  if (result.ok) {
    const share = { ...book.share }
    if (result.share) share[id] = result.share
    else delete share[id]
    book = { ...book, share }
    save()
    emit()
  }
  return result
}

// Delete My Account: notes stop syncing with that account and stay on this device as local
// notes (unless this device's data is erased too); shared notes become plain copies (new
// ids: the shared ones live on with the others); notes set aside for that account go
export const forgetNotesAccount = (key) => {
  setSyncSession(null)
  try {
    localStorage.removeItem(stashKey(key))
  } catch {
    // ignore
  }
  if (book.account !== key) return
  const notes = {}
  for (const [id, n] of Object.entries(book.notes)) {
    if (core.isPurged(n)) continue
    const newId = book.share[id] ? core.newNoteId() : id
    notes[newId] = { ...n, id: newId }
    if (newId !== id && desk[id]) {
      desk = { ...desk, [newId]: desk[id] }
      delete desk[id]
    }
  }
  saveDesk()
  book = { ...blank(), notes }
  save()
  emit()
}

// for tests and the status bar
export const notesSyncState = () => ({ ...status, signedOn: !!session, account: book.account, dirty: book.dirty.length, count: Object.keys(book.notes).length })

// ---- search (Start menu box and Find) ----

registerSearchProvider("notes", {
  type: "notes",
  icon: "/assets/program_icons/notes.svg",
  version: () => version,
  entries: () =>
    snapshot.notes.map((n) => ({
      id: `note:${n.id}`,
      title: core.noteTitle(n),
      subtitle: [shareLabel(book.share[n.id]), snapshot.pinned.has(n.id) ? "Pinned to desktop" : "", new Date(core.noteTime(n)).toLocaleDateString()].filter(Boolean).join(" · "),
      detail: core.COLOR_NAMES[n.color?.v] || "",
      body: core.noteText(n),
      time: core.noteTime(n),
      noteId: n.id,
    })),
})

rebuild()
purgeExpired()
