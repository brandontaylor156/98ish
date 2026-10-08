// A tiny in-memory IndexedDB for Node tests of driveStore.js (no fake-indexeddb package):
// databases, object stores with out-of-line keys, get/put/delete/clear/getAllKeys, and
// transactions that apply all their writes or none. Options let a test act like a full
// disk (quotaChars), a broken browser (failOpen, failWrites) or one that never answers.

const later = (fn) => setTimeout(fn, 0)

const sizeOf = (value) => (typeof value === "string" ? value.length : typeof Blob !== "undefined" && value instanceof Blob ? value.size : JSON.stringify(value ?? null).length)

export const createFakeIndexedDb = ({ quotaChars = Infinity, failOpen = false, failWrites = false, hang = false } = {}) => {
  const databases = new Map() // name -> { version, stores: Map(name -> Map(key -> value)) }
  const control = { quotaChars, failOpen, failWrites, hang, commits: 0 }

  const used = () => {
    let n = 0
    for (const db of databases.values()) for (const store of db.stores.values()) for (const value of store.values()) n += sizeOf(value)
    return n
  }

  const request = () => ({ result: undefined, error: null, onsuccess: null, onerror: null })

  const makeDb = (data) => {
    const db = {
      onversionchange: null,
      objectStoreNames: { contains: (name) => data.stores.has(name) },
      createObjectStore: (name) => {
        data.stores.set(name, new Map())
        return {}
      },
      close: () => {},
      transaction: (names, mode = "readonly") => {
        const list = Array.isArray(names) ? names : [names]
        const writes = [] // [store, op, key, value]
        const tx = { oncomplete: null, onerror: null, onabort: null, error: null }
        let pending = 0
        let finished = false
        const finish = () => {
          if (finished || pending) return
          finished = true
          later(() => {
            if (writes.length) {
              if (control.failWrites) {
                tx.error = new DOMException("The write failed.", "UnknownError")
                return tx.onerror?.() ?? tx.onabort?.()
              }
              // what the stores would hold afterwards
              let after = used()
              for (const [store, op, key, value] of writes) {
                const old = data.stores.get(store).get(key)
                if (op === "put") after += sizeOf(value) - (old === undefined ? 0 : sizeOf(old))
                if (op === "delete" && old !== undefined) after -= sizeOf(old)
                if (op === "clear") for (const v of data.stores.get(store).values()) after -= sizeOf(v)
              }
              if (after > control.quotaChars) {
                tx.error = new DOMException("The quota has been exceeded.", "QuotaExceededError")
                tx.onerror?.()
                return tx.onabort?.()
              }
              for (const [store, op, key, value] of writes) {
                const map = data.stores.get(store)
                if (op === "put") map.set(key, value)
                if (op === "delete") map.delete(key)
                if (op === "clear") map.clear()
              }
              control.commits++
            }
            tx.oncomplete?.()
          })
        }
        const queue = (fn) => {
          const r = request()
          pending++
          later(() => {
            pending--
            try {
              r.result = fn()
              r.onsuccess?.()
            } catch (error) {
              r.error = error
              r.onerror?.()
            }
            finish()
          })
          return r
        }
        tx.objectStore = (name) => {
          if (!list.includes(name) || !data.stores.has(name)) throw new DOMException(`No store ${name}.`, "NotFoundError")
          const map = data.stores.get(name)
          const write = (op, key, value) => {
            if (mode !== "readwrite") throw new DOMException("Read-only transaction.", "ReadOnlyError")
            writes.push([name, op, key, structuredClone(value)])
          }
          return {
            get: (key) => queue(() => structuredClone(map.get(key))),
            getAllKeys: () => queue(() => [...map.keys()]),
            put: (value, key) => queue(() => write("put", key, value)),
            delete: (key) => queue(() => write("delete", key)),
            clear: () => queue(() => write("clear")),
          }
        }
        // a transaction with no requests still completes
        later(finish)
        return tx
      },
    }
    return db
  }

  const factory = {
    control,
    used,
    open: (name, version = 1) => {
      if (control.failOpen) throw new DOMException("IndexedDB is off.", "SecurityError")
      const r = { ...request(), onupgradeneeded: null, onblocked: null }
      if (control.hang) return r
      later(() => {
        let data = databases.get(name)
        const upgrade = !data || data.version < version
        if (!data) {
          data = { version, stores: new Map() }
          databases.set(name, data)
        }
        r.result = makeDb(data)
        if (upgrade) {
          data.version = version
          r.onupgradeneeded?.()
        }
        r.onsuccess?.()
      })
      return r
    },
    deleteDatabase: (name) => {
      databases.delete(name)
      const r = request()
      later(() => r.onsuccess?.())
      return r
    },
    // for tests: a store's contents, and the databases there are
    peek: (name, store) => new Map(databases.get(name)?.stores.get(store) || []),
    names: () => [...databases.keys()],
  }
  return factory
}

// localStorage for tests: a Map with the Storage methods (and an optional size limit)
export const createFakeStorage = (initial = {}, { quotaChars = Infinity } = {}) => {
  const map = new Map(Object.entries(initial))
  const used = () => [...map].reduce((n, [k, v]) => n + k.length + v.length, 0)
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      const old = map.get(key)
      map.set(key, String(value))
      if (used() > quotaChars) {
        if (old === undefined) map.delete(key)
        else map.set(key, old)
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError")
      }
    },
    removeItem: (key) => map.delete(key),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}
