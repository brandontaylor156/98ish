// Version history's storage: one IndexedDB database per 98ish user on this device, named
// through the storage seam (keyPrefix: "98ish.versions" for the first user, "98ish.u.<id>.versions"
// for others), never synced or uploaded. Two stores: "meta" holds the index (versionsCore.js),
// "data" each version's text by id. A factory so tests can hand in a fake IndexedDB
// (versions.test.js); the app's instance is in utils/versions.js.

import { addVersion, cleanIndex, emptyIndex, enforceCaps, listVersions, moveFile, removeFile, removeVersion, totals } from "./versionsCore.js"

const META = "meta"
const DATA = "data"
const INDEX_KEY = "index"

// deps: { idb: () => indexedDB | null, dbName: () => string, now?: () => number, caps? }
export const createVersionStore = ({ idb, dbName, now = () => Date.now(), caps } = {}) => {
  let index = emptyIndex()
  let loaded = null
  let dbPromise = null
  let dbFor = null
  const listeners = new Set()
  const emit = () => listeners.forEach((fn) => fn(index))

  const openDb = () => {
    const name = dbName()
    if (dbPromise && dbFor === name) return dbPromise
    dbFor = name
    loaded = null
    const factory = idb()
    if (!factory) return (dbPromise = Promise.resolve(null))
    dbPromise = new Promise((resolve) => {
      try {
        const req = factory.open(name, 1)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
          if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA)
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

  const get = (store, key) =>
    openDb().then(
      (db) =>
        db &&
        new Promise((resolve) => {
          try {
            const req = db.transaction(store, "readonly").objectStore(store).get(key)
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => resolve(undefined)
          } catch {
            resolve(undefined)
          }
        })
    )

  // one transaction: the new index, new texts, deleted texts (all or nothing)
  let writing = Promise.resolve(true)
  const commit = ({ next, puts = [], drops = [] }) => {
    writing = writing.then(async () => {
      const db = await openDb()
      if (!db) return false
      return new Promise((resolve) => {
        try {
          const tx = db.transaction([META, DATA], "readwrite")
          tx.objectStore(META).put(next, INDEX_KEY)
          const data = tx.objectStore(DATA)
          for (const [id, text] of puts) data.put(text, id)
          for (const id of drops) data.delete(id)
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
    // another 98ish user's database (tests; the app reloads on a switch): start over
    if (dbFor !== null && dbFor !== dbName()) {
      loaded = null
      index = emptyIndex()
    }
    loaded ||= get(META, INDEX_KEY).then(async (raw) => {
      const clean = cleanIndex(raw)
      // versions past their 30 days go on the first look
      const capped = enforceCaps(clean, now(), caps)
      index = capped.index
      if (capped.drop.length) await commit({ next: index, drops: capped.drop })
      emit()
      return index
    })
    return loaded.then(() => index)
  }

  const change = async (result, puts = []) => {
    index = result.index
    emit()
    return commit({ next: index, puts, drops: result.drop || [] })
  }

  return {
    load,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    // the contents a file had before a save -> the version kept, or null (same/too big/empty)
    keep: async (path, text, type) => {
      if (!(await openDb())) return null // no IndexedDB (some private windows): no history
      await load()
      const result = addVersion(index, { path, text, type, at: now() }, caps)
      if (!result.added) return null
      const ok = await change(result, [[result.added.id, text]])
      return ok ? result.added : null
    },
    list: async (path) => (await load(), listVersions(index, path)),
    read: async (id) => {
      const text = await get(DATA, id)
      return typeof text === "string" ? text : null
    },
    remove: async (path, id) => (await load(), change(removeVersion(index, path, id))),
    forget: async (path) => (await load(), change(removeFile(index, path))),
    move: async (from, to) => (await load(), change(moveFile(index, from, to, caps))),
    totals: async () => (await load(), totals(index)),
    // everything (Delete My Account erasing the device)
    erase: async () => {
      await load()
      const drop = Object.values(index.files).flatMap((l) => l.map((v) => v.id))
      return change({ index: emptyIndex(), drop })
    },
    // a removed user's whole database (users.js onUserRemoved)
    dropDatabase: (name) => {
      try {
        idb()?.deleteDatabase?.(name)
        return true
      } catch {
        return false
      }
    },
    flush: () => writing,
  }
}
