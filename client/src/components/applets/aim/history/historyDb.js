// 98 Messenger conversations kept on this device: IndexedDB, one database per 98ish user
// (utils/users.js: the first user has "98ish-im", others "98ish-im-<id>"), and inside it
// everything is per screen name (`acct`, the key of whoever was signed on).
//
//   msgs   { pk: "<acct>|<id>", acct, ck, time, ...message }   index conv: [acct, ck, time]
//   meta   { acct, cursor (the server's change counter), reads: { ck: { at, when } } }
//   media  { pk: "<acct>|<media id>", acct, id, blob, mime, at }   pictures and voice messages
//          fetched or sent, so each is downloaded once (the newest 400 are kept)
//
// Without IndexedDB (some private windows) it all lives in memory for the visit. Nothing here
// throws: a failure just means less history.

import { currentUserId, DEFAULT_ID, onUserRemoved } from "../../../../utils/users"

const DB = "98ish-im"
const MAX_MEDIA = 400
const dbName = (id = currentUserId()) => (!id || id === DEFAULT_ID ? DB : `${DB}-${id}`)

onUserRemoved((id) => {
  try {
    if (typeof indexedDB !== "undefined" && id && id !== DEFAULT_ID) indexedDB.deleteDatabase(dbName(id))
  } catch {
    // gone already
  }
})

const reqP = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })

let opening = null
const open = () => {
  if (opening) return opening
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null)
      const req = indexedDB.open(dbName(), 1)
      req.onupgradeneeded = () => {
        const db = req.result
        const msgs = db.createObjectStore("msgs", { keyPath: "pk" })
        msgs.createIndex("conv", ["acct", "ck", "time"])
        msgs.createIndex("acct", "acct")
        db.createObjectStore("meta", { keyPath: "acct" })
        const media = db.createObjectStore("media", { keyPath: "pk" })
        media.createIndex("at", "at")
        media.createIndex("acct", "acct")
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

// ---- in memory, without IndexedDB ----
const mem = { msgs: new Map(), meta: new Map(), media: new Map() }

const keep = (m) => m && m.id && !m.system && !String(m.id).startsWith("t-")
const record = (acct, m) => {
  const { pending, failed, ...rest } = m
  return { ...rest, pk: `${acct}|${m.id}`, acct }
}
const strip = ({ pk, acct, ...m }) => m

export const putMessages = async (acct, list) => {
  const items = (list || []).filter(keep)
  if (!acct || !items.length) return
  const db = await open()
  if (!db) {
    for (const m of items) mem.msgs.set(`${acct}|${m.id}`, { ...(mem.msgs.get(`${acct}|${m.id}`) || {}), ...record(acct, m) })
    return
  }
  try {
    const tx = db.transaction("msgs", "readwrite")
    const store = tx.objectStore("msgs")
    for (const m of items) {
      const pk = `${acct}|${m.id}`
      const prev = await reqP(store.get(pk))
      const next = { ...(prev || {}), ...record(acct, m) }
      if (prev?.thumb && !m.thumb) next.thumb = prev.thumb
      if (prev?.deliveredAt && !m.deliveredAt) Object.assign(next, { deliveredAt: prev.deliveredAt, held: false })
      store.put(next)
    }
    await done(tx)
  } catch {
    // storage full or closed: the conversation still shows
  }
}

// change one saved message (a reaction, "Delivered"): `change` is a patch or fn(message) -> message
export const patchMessage = async (acct, id, change) => {
  const apply = (prev) => (typeof change === "function" ? { ...change(strip(prev)), pk: prev.pk, acct: prev.acct } : { ...prev, ...change })
  const db = await open()
  const pk = `${acct}|${id}`
  if (!db) {
    if (mem.msgs.has(pk)) mem.msgs.set(pk, apply(mem.msgs.get(pk)))
    return
  }
  try {
    const tx = db.transaction("msgs", "readwrite")
    const prev = await reqP(tx.objectStore("msgs").get(pk))
    if (prev) tx.objectStore("msgs").put(apply(prev))
    await done(tx)
  } catch {
    // never mind
  }
}

const range = (acct, ck, from, to) => IDBKeyRange.bound([acct, ck, from], [acct, ck, to])

// the newest `limit` messages of a conversation before `before` (oldest first)
export const loadBefore = async (acct, ck, before = Infinity, limit = 50) => {
  const db = await open()
  if (!db) {
    return [...mem.msgs.values()]
      .filter((m) => m.acct === acct && m.ck === ck && m.time < before)
      .sort((a, b) => a.time - b.time)
      .slice(-limit)
      .map(strip)
  }
  try {
    const tx = db.transaction("msgs")
    const out = []
    await new Promise((resolve, reject) => {
      const req = tx.objectStore("msgs").index("conv").openCursor(range(acct, ck, -Infinity, before === Infinity ? Number.MAX_SAFE_INTEGER : before - 0.001), "prev")
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor || out.length >= limit) return resolve()
        out.push(strip(cursor.value))
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
    })
    return out.reverse()
  } catch {
    return []
  }
}
export const loadLatest = (acct, ck, limit = 50) => loadBefore(acct, ck, Infinity, limit)

// every saved message of an account, newest first (for Find), at most `limit`
export const allMessages = async (acct, limit = 3000) => {
  const db = await open()
  if (!db) return [...mem.msgs.values()].filter((m) => m.acct === acct).sort((a, b) => b.time - a.time).slice(0, limit).map(strip)
  try {
    const list = await reqP(db.transaction("msgs").objectStore("msgs").index("acct").getAll(acct))
    return list.sort((a, b) => b.time - a.time).slice(0, limit).map(strip)
  } catch {
    return []
  }
}

// a conversation's messages up to `upTo` go (and their pictures and voice messages)
export const clearConv = async (acct, ck, upTo = Infinity) => {
  const db = await open()
  if (!db) {
    for (const [pk, m] of mem.msgs) if (m.acct === acct && m.ck === ck && m.time <= upTo) mem.msgs.delete(pk)
    return
  }
  try {
    const tx = db.transaction(["msgs", "media"], "readwrite")
    const media = tx.objectStore("media")
    await new Promise((resolve, reject) => {
      const req = tx.objectStore("msgs").index("conv").openCursor(range(acct, ck, -Infinity, upTo === Infinity ? Number.MAX_SAFE_INTEGER : upTo))
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return resolve()
        if (cursor.value.media?.id) media.delete(`${acct}|${cursor.value.media.id}`)
        cursor.delete()
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
    })
    await done(tx)
  } catch {
    // never mind
  }
}

// a buddy deleted their account: what this device kept moves to "(deleted account)", so
// whoever takes the name next starts a new conversation
export const renameConv = async (acct, ck, nextCk, conv) => {
  const list = await loadBefore(acct, ck, Infinity, 100_000)
  if (!list.length) return
  await clearConvOnly(acct, ck)
  await putMessages(acct, list.map((m) => ({ ...m, ck: nextCk, conv, from: m.mine ? m.from : conv })))
}
const clearConvOnly = async (acct, ck) => {
  const db = await open()
  if (!db) {
    for (const [pk, m] of mem.msgs) if (m.acct === acct && m.ck === ck) mem.msgs.delete(pk)
    return
  }
  try {
    const tx = db.transaction("msgs", "readwrite")
    await new Promise((resolve, reject) => {
      const req = tx.objectStore("msgs").index("conv").openCursor(range(acct, ck, -Infinity, Number.MAX_SAFE_INTEGER))
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return resolve()
        cursor.delete()
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
    })
    await done(tx)
  } catch {
    // never mind
  }
}

export const getMeta = async (acct) => {
  const db = await open()
  if (!db) return mem.meta.get(acct) || { acct, cursor: 0, reads: {} }
  try {
    return (await reqP(db.transaction("meta").objectStore("meta").get(acct))) || { acct, cursor: 0, reads: {} }
  } catch {
    return { acct, cursor: 0, reads: {} }
  }
}
export const setMeta = async (acct, patch) => {
  const next = { ...(await getMeta(acct)), ...patch, acct }
  const db = await open()
  if (!db) return void mem.meta.set(acct, next)
  try {
    const tx = db.transaction("meta", "readwrite")
    tx.objectStore("meta").put(next)
    await done(tx)
  } catch {
    // never mind
  }
}

// ---- pictures and voice messages (Blobs) ----

export const getMedia = async (acct, id) => {
  const db = await open()
  if (!db) return mem.media.get(`${acct}|${id}`)?.blob || null
  try {
    return (await reqP(db.transaction("media").objectStore("media").get(`${acct}|${id}`)))?.blob || null
  } catch {
    return null
  }
}
export const putMedia = async (acct, id, blob) => {
  if (!acct || !id || !blob) return
  const db = await open()
  if (!db) return void mem.media.set(`${acct}|${id}`, { blob })
  try {
    const tx = db.transaction("media", "readwrite")
    const store = tx.objectStore("media")
    store.put({ pk: `${acct}|${id}`, acct, id, blob, mime: blob.type, at: Date.now() })
    const count = await reqP(store.count())
    if (count > MAX_MEDIA) {
      let extra = count - MAX_MEDIA
      await new Promise((resolve) => {
        const req = store.index("at").openCursor()
        req.onsuccess = () => {
          const cursor = req.result
          if (!cursor || extra-- <= 0) return resolve()
          cursor.delete()
          cursor.continue()
        }
        req.onerror = () => resolve()
      })
    }
    await done(tx)
  } catch {
    // the device is full: it's fetched again next time
  }
}

// Delete My Account / forgetting the account on this device
export const eraseAccount = async (acct) => {
  if (!acct) return
  const db = await open()
  if (!db) {
    for (const map of [mem.msgs, mem.media]) for (const [pk, m] of map) if (pk.startsWith(`${acct}|`) || m.acct === acct) map.delete(pk)
    mem.meta.delete(acct)
    return
  }
  try {
    const tx = db.transaction(["msgs", "meta", "media"], "readwrite")
    for (const name of ["msgs", "media"]) {
      const keys = await reqP(tx.objectStore(name).index("acct").getAllKeys(acct))
      for (const k of keys) tx.objectStore(name).delete(k)
    }
    tx.objectStore("meta").delete(acct)
    await done(tx)
  } catch {
    // never mind
  }
}
