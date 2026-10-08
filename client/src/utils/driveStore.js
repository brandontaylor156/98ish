// Where the 98ish drive lives in the browser. Since October 2026 that's IndexedDB (hundreds
// of megabytes, kept safe with navigator.storage.persist()); before, the whole drive was one
// JSON text in localStorage ("98ish.fs.v1", about 5 MB at most). This module knows both, and
// moves a drive from the old place to the new one without losing anything:
//
//   1. the old drive is copied into IndexedDB in one transaction,
//   2. read back and compared, file by file, with the original,
//   3. only then marked as moved ("98ish.fs.migrated"). The old copy stays in localStorage
//      for RETAIN_MS (3 days) more, so a problem can still be fixed, and is never touched
//      when anything goes wrong: the next start simply tries again.
//
// IndexedDB layout (database "98ish-drive"):
//   meta     "index" -> { version: 2, root: [node], bin: [node], defaults: [path], savedAt }
//            "migration" -> { at, files, chars }
//   contents <content key> -> the text of one big file (a picture, a sound, a long document)
//   blobs    <media key> -> a big media file kept as it came (a Blob: a long video, a big
//            song or PDF). The file's own text is then a short reference (mediaRef below):
//            "98ish-media:<key>;<mime>;<bytes>". Such files stay on this device (file sync
//            skips them) and are read with mediaBlob() in fs.js. Added in DB_VERSION 2.
// node = { k: "d", n, t, m, c: [node] }
//      | { k: "f", n, t, m, s: bytes, v: modified (ms), x: text (small files)
//          | h: content key and hd: its first characters (big files),
//          th: thumbnail data URL (big pictures) }
// A content key is a hash of the text, so copies of a file share one stored copy and a
// stored text is removed once nothing points at it any more.
//
// No React and no fs.js here: Node tests drive it with a small fake IndexedDB.

export const DB_NAME = "98ish-drive"
export const DB_VERSION = 2
export const OLD_KEY = "98ish.fs.v1"
export const MIGRATED_KEY = "98ish.fs.migrated"
export const INLINE_MAX = 8 * 1024 // texts longer than this are kept in "contents"
// how long the old copy stays after a move (it still fills localStorage, which settings and
// the wallpaper share, so not too long; a problem with the new drive shows on the next start)
export const RETAIN_MS = 3 * 24 * 60 * 60 * 1000

// ---------- big media kept as files (blobs) ----------

export const MEDIA_PREFIX = "98ish-media:"
// a media file's text: where its bytes are, what they are and how many
export const mediaRef = ({ key, mime = "application/octet-stream", size = 0 }) =>
  `${MEDIA_PREFIX}${key};${String(mime || "").replace(/[;\s]/g, "") || "application/octet-stream"};${Math.max(0, Math.round(Number(size) || 0))}`
// -> { key, mime, size } | null
export const parseMediaRef = (text) => {
  const value = String(text ?? "")
  if (!value.startsWith(MEDIA_PREFIX) || value.length > 300) return null
  const [key, mime, size] = value.slice(MEDIA_PREFIX.length).split(";")
  if (!key || !/^[\w-]{4,80}$/.test(key)) return null
  return { key, mime: mime || "application/octet-stream", size: Number(size) || 0 }
}
export const isMediaRef = (text) => typeof text === "string" && text.startsWith(MEDIA_PREFIX)
// a new media key: random (a big file isn't read just to hash it)
export const newMediaKey = (size = 0) => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${Math.max(0, Math.floor(Number(size) || 0)).toString(36)}`
// Every media key that saved nodes point at (files in folders and in the Recycle Bin)
export const mediaKeysIn = (nodes, out = new Set()) => {
  for (const node of nodes || []) {
    if (node.k === "d") mediaKeysIn(node.c, out)
    else if (typeof node.x === "string" && isMediaRef(node.x)) {
      const ref = parseMediaRef(node.x)
      if (ref) out.add(ref.key)
    }
  }
  return out
}

// Which stored media blobs can go: nothing points at them any more, and they weren't just
// written (a file is made for a new blob right after it's stored: holdMs keeps it meanwhile)
export const MEDIA_HOLD_MS = 10 * 60 * 1000
export const blobsToDelete = (storedKeys, usedKeys, fresh = new Map(), now = Date.now(), holdMs = MEDIA_HOLD_MS) =>
  [...storedKeys].filter((key) => !usedKeys.has(key) && !(fresh.has(key) && now - fresh.get(key) < holdMs))

// ---------- little helpers ----------

// cyrb53: a quick 53-bit hash of a string
export const hashText = (text) => {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

// A file's text -> its content key (hash and length, so a clash would need both to match)
export const contentKey = (text) => `${hashText(text)}-${text.length.toString(36)}`

// How many bytes a file's text stands for: a data URL counts the bytes of the picture or
// sound itself; other text counts as UTF-8
export const byteSize = (text) => {
  const value = String(text ?? "")
  if (isMediaRef(value)) return parseMediaRef(value)?.size || 0
  const comma = value.startsWith("data:") ? value.indexOf(",") : -1
  if (comma > 0 && value.slice(0, comma).endsWith(";base64")) {
    const body = value.length - comma - 1
    const pad = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0
    return Math.max(0, Math.floor((body * 3) / 4) - pad)
  }
  let bytes = 0
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdfff ? 2 : 3
  }
  return bytes
}

export const isQuotaError = (error) => {
  const name = error?.name || ""
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || /quota|space|full/i.test(error?.message || "")
}

// ---------- IndexedDB ----------

const req = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const finished = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error("The drive couldn't be saved."))
    tx.onabort = () => reject(tx.error || new Error("The drive couldn't be saved."))
  })

const wrap = (db) => {
  db.onversionchange = () => db.close() // a newer 98ish in another tab wants to upgrade
  const store = (name, mode = "readonly") => db.transaction(name, mode).objectStore(name)
  return {
    getIndex: () => req(store("meta").get("index")).then((value) => value || null),
    getMeta: (key) => req(store("meta").get(key)),
    putMeta: async (key, value) => {
      const tx = db.transaction("meta", "readwrite")
      tx.objectStore("meta").put(value, key)
      await finished(tx)
    },
    getContent: (key) => req(store("contents").get(key)),
    contentKeys: () => req(store("contents").getAllKeys()),
    // big media files (Blobs), written on their own before a file points at them
    putBlob: async (key, blob) => {
      const tx = db.transaction("blobs", "readwrite")
      tx.objectStore("blobs").put(blob, key)
      await finished(tx)
    },
    getBlob: (key) => req(store("blobs").get(key)),
    blobKeys: () => req(store("blobs").getAllKeys()),
    // Everything in one transaction: all of it is saved, or none of it
    commit: async ({ index = null, puts = [], deletes = [], blobDeletes = [], meta = {} } = {}) => {
      const tx = db.transaction(blobDeletes.length ? ["meta", "contents", "blobs"] : ["meta", "contents"], "readwrite")
      const contents = tx.objectStore("contents")
      for (const [key, text] of puts) contents.put(text, key)
      for (const key of deletes) contents.delete(key)
      if (blobDeletes.length) {
        const blobs = tx.objectStore("blobs")
        for (const key of blobDeletes) blobs.delete(key)
      }
      const metaStore = tx.objectStore("meta")
      if (index) metaStore.put(index, "index")
      for (const [key, value] of Object.entries(meta)) metaStore.put(value, key)
      await finished(tx)
    },
    clear: async () => {
      const tx = db.transaction(["meta", "contents", "blobs"], "readwrite")
      tx.objectStore("meta").clear()
      tx.objectStore("contents").clear()
      tx.objectStore("blobs").clear()
      await finished(tx)
    },
    close: () => db.close(),
  }
}

// -> a drive database, or null if this browser won't give us IndexedDB (some private
// windows, blocked storage, or it doesn't answer within timeoutMs)
export const openDriveDb = (factory, { name = DB_NAME, timeoutMs = 6000 } = {}) =>
  new Promise((resolve) => {
    if (!factory) return resolve(null)
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    let request
    try {
      request = factory.open(name, DB_VERSION)
    } catch {
      return finish(null)
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta")
      if (!db.objectStoreNames.contains("contents")) db.createObjectStore("contents")
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs")
    }
    request.onsuccess = async () => {
      const db = request.result
      if (settled) return db.close()
      const wrapped = wrap(db)
      // some private windows open a database but refuse every write: try one
      try {
        await wrapped.putMeta("probe", Date.now())
        finish(wrapped)
      } catch {
        db.close()
        finish(null)
      }
    }
    request.onerror = () => finish(null)
  })

// ---------- node shapes ----------

// Old nodes ({ k, n, t, m, x }: everything inline) -> new nodes; big texts go into `contents`
export const splitNodes = (nodes, contents) => (nodes || []).map((node) => splitNode(node, contents))

const splitNode = (node, contents) => {
  if (node.k === "d") return { k: "d", n: node.n, t: node.t, m: node.m || {}, c: splitNodes(node.c, contents) }
  const x = typeof node.x === "string" ? node.x : ""
  const out = { k: "f", n: node.n, t: node.t, m: node.m || {}, s: byteSize(x), v: Number(node.v) || 0 }
  if (x.length > INLINE_MAX) {
    const key = contentKey(x)
    contents.set(key, x)
    out.h = key
    out.hd = x.slice(0, 48)
  } else out.x = x
  return out
}

// Every file and folder in a node list: [{ path, node }]
export const flatten = (nodes, prefix = "", out = []) => {
  for (const node of nodes || []) {
    const path = `${prefix}/${node.n}`
    out.push({ path, node })
    if (node.k === "d") flatten(node.c, path, out)
  }
  return out
}

// Counts and total characters of an old-style (inline) drive
export const measureNodes = (nodes) => {
  let files = 0
  let folders = 0
  let chars = 0
  for (const { node } of flatten(nodes)) {
    if (node.k === "d") folders++
    else {
      files++
      chars += typeof node.x === "string" ? node.x.length : 0
    }
  }
  return { files, folders, chars }
}

// ---------- the old localStorage drive ----------

export const readOldDrive = (storage) => {
  let raw = null
  try {
    raw = storage?.getItem(OLD_KEY) ?? null
  } catch {
    return { raw: null, drive: null }
  }
  if (!raw) return { raw: null, drive: null }
  try {
    const drive = JSON.parse(raw)
    return { raw, drive: drive && Array.isArray(drive.root) ? drive : null }
  } catch {
    return { raw, drive: null }
  }
}

export const readMarker = (storage) => {
  try {
    const value = JSON.parse(storage?.getItem(MIGRATED_KEY))
    return value && Number.isFinite(value.at) ? value : null
  } catch {
    return null
  }
}

// Compare a stored drive (new nodes + their contents) with the original old nodes.
// -> null when every folder and file (name, type, text) is there, else what's wrong
export const compareDrives = async (original, stored, getContent) => {
  for (const part of ["root", "bin"]) {
    const a = flatten(original[part] || [])
    const b = flatten(stored[part] || [])
    if (a.length !== b.length) return `${part === "bin" ? "The Recycle Bin" : "The drive"} has ${b.length} items instead of ${a.length}.`
    for (let i = 0; i < a.length; i++) {
      const [x, y] = [a[i], b[i]]
      if (x.path !== y.path || x.node.k !== y.node.k || x.node.t !== y.node.t) return `${x.path} didn't copy correctly.`
      if (x.node.k !== "f") continue
      const want = typeof x.node.x === "string" ? x.node.x : ""
      const got = typeof y.node.x === "string" ? y.node.x : y.node.h ? await getContent(y.node.h) : ""
      if (got !== want) return `The contents of ${x.path} didn't copy correctly.`
    }
  }
  return null
}

// Move the old localStorage drive into IndexedDB, check it, mark it done.
// -> { ok: true, index, files, chars } | { ok: false, none: true } (nothing to move)
//  | { ok: false, error } (nothing changed: the old drive is untouched, IndexedDB is empty)
export const migrateFromLocal = async ({ db, storage, now = Date.now() }) => {
  const { raw, drive } = readOldDrive(storage)
  if (!raw) return { ok: false, none: true }
  if (!drive) return { ok: false, error: "The old drive couldn't be read." }
  const contents = new Map()
  const index = {
    version: 2,
    root: splitNodes(drive.root, contents),
    bin: splitNodes(drive.bin || [], contents),
    defaults: Array.isArray(drive.defaults) ? drive.defaults : null,
    savedAt: now,
  }
  const counted = measureNodes([...drive.root, ...(drive.bin || [])])
  const record = { at: now, files: counted.files, folders: counted.folders, chars: counted.chars }
  try {
    await db.commit({ index, puts: [...contents], meta: { migration: record } })
  } catch (error) {
    try {
      await db.clear()
    } catch {
      // nothing more we can do; the next start tries again
    }
    return { ok: false, error: isQuotaError(error) ? "There isn't enough room in this browser's storage." : `Saving failed (${error?.name || "error"}).` }
  }
  // read it all back and compare with the original
  let problem
  try {
    const stored = await db.getIndex()
    problem = stored ? await compareDrives(drive, stored, (key) => db.getContent(key)) : "The copied drive is missing."
  } catch (error) {
    problem = `The copy couldn't be read back (${error?.name || "error"}).`
  }
  if (problem) {
    try {
      await db.clear()
    } catch {
      // the next start tries again
    }
    return { ok: false, error: problem }
  }
  try {
    storage.setItem(MIGRATED_KEY, JSON.stringify(record))
  } catch {
    // localStorage is full (the old drive is still in it): the record in IndexedDB is enough
  }
  return { ok: true, index, ...record }
}

// After RETAIN_MS, the old copy is removed (only once the new drive has been used since)
export const retireOldDrive = (storage, migration, now = Date.now()) => {
  const at = migration?.at || readMarker(storage)?.at
  if (!at || now - at < RETAIN_MS) return false
  try {
    if (storage.getItem(OLD_KEY) === null) return false
    storage.removeItem(OLD_KEY)
    return true
  } catch {
    return false
  }
}
