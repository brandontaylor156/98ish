// Clipboard history's storage: one IndexedDB database per 98ish user on this device
// ("98ish-clipboard", plus "-<user id>" for extra profiles), never synced or uploaded.
// A factory so tests can hand in a fake IndexedDB and user (clipStore.test.js); the app's
// instance is made in utils/clipHistory.js. Rules (caps, pins) are in clipCore.js.

import { addClip, clearClips, pinClip, removeClip, sanitize } from "./clipCore.js"

export const CLIP_DB = "98ish-clipboard"
const STORE = "kv"
const KEY = "history"
export const DEFAULT_USER = "default"

export const clipDbName = (id) => (!id || id === DEFAULT_USER ? CLIP_DB : `${CLIP_DB}-${id}`)

// deps: { idb: () => indexedDB | null, userId: () => string, now?: () => number }
export const createClipStore = ({ idb, userId, now = () => Date.now() }) => {
  let list = []
  let loaded = null // a Promise once loading started
  let dbPromise = null
  let dbFor = null
  const listeners = new Set()
  const emit = () => listeners.forEach((fn) => fn(list))

  const openDb = () => {
    const id = userId()
    if (dbPromise && dbFor === id) return dbPromise
    dbFor = id
    const factory = idb()
    if (!factory) return (dbPromise = Promise.resolve(null))
    dbPromise = new Promise((resolve) => {
      try {
        const req = factory.open(clipDbName(id), 1)
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
        }
        req.onsuccess = () => {
          const db = req.result
          db.onversionchange = () => {
            db.close()
            dbPromise = null
          }
          resolve(db)
        }
        req.onerror = () => resolve(null)
        req.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
    return dbPromise
  }

  const readList = async () => {
    const db = await openDb()
    if (!db) return []
    return new Promise((resolve) => {
      try {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY)
        req.onsuccess = () => resolve(sanitize(req.result))
        req.onerror = () => resolve([])
      } catch {
        resolve([])
      }
    })
  }

  let writing = Promise.resolve()
  const writeList = () => {
    const snapshot = list
    writing = writing.then(async () => {
      const db = await openDb()
      if (!db) return false // kept for this visit only (private window)
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE, "readwrite")
          const store = tx.objectStore(STORE)
          if (snapshot.length) store.put(snapshot, KEY)
          else store.delete(KEY)
          tx.oncomplete = () => resolve(true)
          tx.onerror = () => resolve(false)
          tx.onabort = () => resolve(false)
        } catch {
          resolve(false)
        }
      })
    })
    return writing
  }

  const load = () => {
    loaded ||= readList().then((saved) => {
      list = saved
      emit()
    })
    // (what's kept now, not what was kept when loading finished)
    return loaded.then(() => list)
  }

  const change = (next) => {
    if (next === list) return list
    list = next
    emit()
    writeList()
    return list
  }

  return {
    load,
    get: () => list,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    // -> the item kept (or null with a reason)
    add: async (raw) => {
      await load()
      const result = addClip(list, raw, { now: now() })
      if (result.added) change(result.list)
      return result
    },
    pin: async (id, pinned = true) => (await load(), change(pinClip(list, id, pinned))),
    remove: async (id) => (await load(), change(removeClip(list, id))),
    // Clear all: pinned items stay
    clear: async () => (await load(), change(clearClips(list))),
    // everything, pinned too (turning history off, Delete My Account)
    erase: async () => {
      await load()
      list = []
      emit()
      await writeList()
      return true
    },
    // a removed user's whole database (users.js onUserRemoved)
    dropUser: (id) => {
      if (!id || id === DEFAULT_USER) return false
      try {
        idb()?.deleteDatabase?.(clipDbName(id))
        return true
      } catch {
        return false
      }
    },
    flush: () => writing,
  }
}
