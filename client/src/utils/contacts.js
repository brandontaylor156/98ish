import { useSyncExternalStore } from "react"
import { contactForScreenName, mergeBooks, normalizeContact, screenKey, sortContacts, DEFAULT_GROUPS } from "./contactsCore"

// The Address Book's contacts: kept on this device (localStorage, so each 98ish user has
// their own; see utils/userStorage.js) and, while signed on to 98 Messenger, synced with
// that account's copy on the 98ish server (server/contacts), so they follow you to every
// device. Changes made while signed off are sent at the next sign on.
// Used by the Address Book, 98ish Mail (To/Cc suggestions), 98 Messenger (Add to Address
// Book), Calendar (the Birthdays calendar) and search.

export const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"
const KEY = "98ish.contacts"
const stashKey = (account) => `98ish.contacts.acct.${account}`
const SYNC_EVERY_MS = 5 * 60_000

const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key)) || null
  } catch {
    return null
  }
}
const blank = () => ({ contacts: [], dirty: [], account: null, groups: [], syncedAt: null })
const loadBook = (saved) => ({
  ...blank(),
  ...saved,
  contacts: (Array.isArray(saved?.contacts) ? saved.contacts : []).map((c) => normalizeContact(c)),
  dirty: Array.isArray(saved?.dirty) ? saved.dirty : [],
  groups: Array.isArray(saved?.groups) ? saved.groups : [],
})

let book = loadBook(read(KEY))
let status = { sync: "local", error: null } // local | syncing | synced | error
let live = [] // the contacts that aren't deleted, sorted (what everyone shows)
let snapshot = null
const listeners = new Set()

const rebuild = () => {
  live = sortContacts(book.contacts.filter((c) => !c.deleted))
  snapshot = { contacts: live, groups: groupNames(), account: book.account, syncedAt: book.syncedAt, ...status }
}
const groupNames = () => {
  const used = new Set(book.contacts.flatMap((c) => c.groups || []))
  return [...new Set([...DEFAULT_GROUPS, ...book.groups, ...used])]
}
rebuild()

const emit = () => {
  rebuild()
  listeners.forEach((fn) => fn())
}
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(book))
    return true
  } catch {
    return false // storage full: kept for this visit
  }
}

export const subscribeContacts = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const getContactsState = () => snapshot
export const useContacts = () => useSyncExternalStore(subscribeContacts, getContactsState)
export const getContacts = () => live
export const contactById = (id) => live.find((c) => c.id === id) || null
export const contactByScreenName = (screenName) => contactForScreenName(live, screenName)

// ---- changes ----

const touch = (contact) => {
  const i = book.contacts.findIndex((c) => c.id === contact.id)
  const contacts = i >= 0 ? book.contacts.map((c, j) => (j === i ? contact : c)) : [...book.contacts, contact]
  book = { ...book, contacts, dirty: [...new Set([...book.dirty, contact.id])] }
  const ok = save()
  emit()
  scheduleSync()
  return ok
}

// Add or change a contact -> { ok, contact } (ok false if this device's storage is full)
export const saveContact = (draft) => {
  const old = draft.id ? book.contacts.find((c) => c.id === draft.id) : null
  const contact = normalizeContact({ ...draft, updatedAt: Math.max(Date.now(), (old?.updatedAt || 0) + 1) })
  const ok = touch(contact)
  return ok ? { ok, contact } : { ok, contact, error: "This device's storage is full: the contact is kept only until 98ish closes. Remove some pictures." }
}

export const deleteContact = (id) => {
  const old = book.contacts.find((c) => c.id === id)
  if (!old) return
  touch({ id, updatedAt: Math.max(Date.now(), old.updatedAt + 1), deleted: true })
}

export const toggleFavorite = (id) => {
  const c = contactById(id)
  if (c) saveContact({ ...c, favorite: !c.favorite })
}

export const addGroup = (name) => {
  const clean = String(name || "").trim().slice(0, 30)
  if (!clean || groupNames().some((g) => g.toLowerCase() === clean.toLowerCase())) return false
  book = { ...book, groups: [...book.groups, clean] }
  save()
  emit()
  return true
}

// Contacts from a vCard file or the phone -> { added, updated, skipped }. Someone already
// here (same screen name, or same name and a shared phone number or e-mail address) gets the
// new details filled in instead of a second card.
export const importContacts = (incoming) => {
  let added = 0
  let updated = 0
  let skipped = 0
  const digits = (v) => String(v).replace(/[^\d]/g, "").slice(-9)
  for (const raw of incoming) {
    const c = normalizeContact({ ...raw, id: undefined, updatedAt: undefined })
    if (!c.first && !c.last && !c.nickname && !c.company && !c.screenName && !c.emails.length && !c.phones.length) {
      skipped++
      continue
    }
    const name = `${c.first} ${c.last}`.trim().toLowerCase()
    const same = live.find((o) => {
      if (c.screenName && screenKey(o.screenName) === screenKey(c.screenName)) return true
      if (!name || `${o.first} ${o.last}`.trim().toLowerCase() !== name) return false
      const emails = new Set(o.emails.map((e) => e.value.toLowerCase()))
      const phones = new Set(o.phones.map((p) => digits(p.value)))
      return c.emails.some((e) => emails.has(e.value.toLowerCase())) || c.phones.some((p) => phones.has(digits(p.value))) || (!c.emails.length && !c.phones.length)
    })
    if (!same) {
      saveContact(c)
      added++
      continue
    }
    // fill in what's missing; lists gain what's new
    const merged = { ...same }
    for (const k of ["first", "last", "nickname", "company", "screenName", "mail", "birthday", "anniversary", "notes", "picture"]) if (!merged[k] && c[k]) merged[k] = c[k]
    if (!Object.values(merged.address).some(Boolean)) merged.address = c.address
    merged.emails = [...same.emails, ...c.emails.filter((e) => !same.emails.some((x) => x.value.toLowerCase() === e.value.toLowerCase()))].slice(0, 8)
    merged.phones = [...same.phones, ...c.phones.filter((p) => !same.phones.some((x) => digits(x.value) === digits(p.value)))].slice(0, 8)
    merged.groups = [...new Set([...same.groups, ...c.groups])]
    merged.favorite = same.favorite || c.favorite
    if (JSON.stringify(merged) === JSON.stringify(same)) skipped++
    else {
      saveContact(merged)
      updated++
    }
  }
  return { added, updated, skipped }
}

// ---- syncing with the 98ish server ----

let session = null // { token, key }
let syncTimer = null
let everyTimer = null
let running = null
let again = false

const setStatus = (patch) => {
  status = { ...status, ...patch }
  emit()
}

const api = async (method, path, body) => {
  try {
    const response = await fetch(`${SERVER_URL}/api/contacts${path}`, {
      method,
      headers: { Authorization: `Bearer ${session.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return await response.json().catch(() => ({ ok: false, error: `The server had a problem (${response.status}).` }))
  } catch {
    return { ok: false, error: "Couldn't reach the 98ish server. Your contacts are safe on this device and sync later." }
  }
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
    const sent = new Set(book.dirty)
    const changes = book.contacts.filter((c) => sent.has(c.id))
    const result = await api("POST", "/sync", { contacts: changes })
    if (!result?.ok) {
      setStatus({ sync: "error", error: result?.error || "Couldn't sync your contacts." })
      return result
    }
    // contacts changed while the request was out stay dirty (they're newer than what came back)
    const changedSince = book.dirty.filter((id) => !sent.has(id))
    const merged = mergeBooks(book.contacts, result.contacts.map((c) => normalizeContact(c)), changedSince)
    book = { ...book, contacts: merged.contacts, dirty: merged.dirty, account: session.key, syncedAt: Date.now() }
    save()
    setStatus({ sync: "synced", error: null })
    return { ok: true }
  })().finally(() => {
    running = null
    if (again || book.dirty.length) {
      again = false
      if (book.dirty.length) scheduleSync(1500)
    }
  })
  return running
}

const scheduleSync = (wait = 2000) => {
  if (!session) return
  clearTimeout(syncTimer)
  syncTimer = setTimeout(syncNow, wait)
}

const onFocus = () => {
  if (session && document.visibilityState === "visible") syncNow()
}

// 98 Messenger signed on ({ token, screenName }) or off (null)
export const setSyncSession = (next) => {
  const key = next?.token ? screenKey(next.screenName) : null
  if (!key) {
    session = null
    clearTimeout(syncTimer)
    clearInterval(everyTimer)
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onFocus)
    if (status.sync !== "local") setStatus({ sync: "local", error: null })
    return
  }
  if (session?.token === next.token) return
  // another account than this book last synced with: put that one's book aside (it comes
  // back when that account signs on here again) and pick up this account's
  if (book.account && book.account !== key) {
    try {
      localStorage.setItem(stashKey(book.account), JSON.stringify(book))
    } catch {
      // full: its contacts are still on the server
    }
    book = loadBook(read(stashKey(key))) || blank()
    try {
      localStorage.removeItem(stashKey(key))
    } catch {
      // ignore
    }
    save()
    emit()
  }
  // a book never synced before goes up to this account (contacts made signed off)
  if (!book.account) book = { ...book, dirty: [...new Set([...book.dirty, ...book.contacts.map((c) => c.id)])] }
  session = { token: next.token, key }
  clearInterval(everyTimer)
  everyTimer = setInterval(syncNow, SYNC_EVERY_MS)
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onFocus)
  syncNow()
}

// for tests and the Address Book's status bar
export const syncState = () => ({ ...status, signedOn: !!session, account: book.account, dirty: book.dirty.length })
