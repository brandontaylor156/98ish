// Version history (docs/storage-sync.md): Notepad, WordPad and Paint keep the contents a file
// had before each save, so File > Restore Previous Version... (and a file's Properties) can
// bring it back. On this device only (never synced, never in Backup), per 98ish user:
// IndexedDB named through the storage seam (keyPrefix() + "versions"), deleted with a removed
// user (onUserRemoved) and by Delete My Account's "erase this device". Caps: versionsCore.js
// VERSION_CAPS (10 versions a file, 7 days, 6 MB a version, 16 MB a file, 64 MB in all).
// Versions follow their file: renamed or moved, they move with it; in the Recycle Bin they
// stay (a restored file keeps its history); deleted for good, they go (`watchFiles`).
//
// How saves get here: fs.js writeAndSave calls the keeper installed below for every
// overwrite of a versioned type (WordPad, Paint, Save As over an existing file); Notepad,
// which sets textContent itself, calls keepBefore(file) first.

import { FILE_TYPE, fs, fsReady, onFsChange, readContent, setVersionKeeper, writeAndSave } from "./fs"
import { keyPrefix, onUserRemoved } from "./users"
import { isVersioned } from "./versionsCore"
import { createVersionStore } from "./versionStore"

export const versionDbName = (prefix = keyPrefix()) => `${prefix}versions`

export const versionStore = createVersionStore({
  idb: () => (typeof indexedDB !== "undefined" ? indexedDB : null),
  dbName: () => versionDbName(),
})

// the key a file's versions are kept under: its path on the drive ("C:/Documents/Letter.txt")
export const versionKey = (file) => (file && !file.isDirectory && file.parent ? fs.partsOf(file).join("/") : null)

export const hasHistory = (file) => !!file && !file.isDirectory && isVersioned(file.type)

// ---- following files ----
// The drive's File objects stay the same through renames, moves and the Recycle Bin, so each
// path with versions is tied to its object; after every drive change each one is checked.
const tracked = new Map() // path -> File

// where a file is now: "drive" | "bin" | "gone"
export const whereIs = (file, root = fs.root, bin = fs.recycleBin) => {
  let n = file
  while (n?.parent) n = n.parent
  return n === root ? "drive" : n === bin ? "bin" : "gone"
}

const track = (key, file) => key && file && tracked.set(key, file)

// after a drive change: moved files' versions follow, deleted-for-good files' versions go
export const followFiles = async () => {
  const moves = []
  const gone = []
  for (const [key, file] of tracked) {
    const where = whereIs(file)
    if (where === "gone") gone.push(key)
    else if (where === "drive") {
      const now = versionKey(file)
      if (now && now !== key) moves.push([key, now, file])
    }
  }
  for (const key of gone) {
    tracked.delete(key)
    await versionStore.forget(key).catch(() => {})
  }
  for (const [from, to, file] of moves) {
    tracked.delete(from)
    tracked.set(to, file)
    await versionStore.move(from, to).catch(() => {})
  }
}

let watching = null
// once the drive is ready: tie every path with versions to its file (paths that no longer
// lead anywhere and aren't in the Recycle Bin are cleared), then watch the drive
export const watchFiles = () => {
  watching ||= (async () => {
    await fsReady
    const index = await versionStore.load()
    const inBin = new Map()
    for (const item of fs.recycleBin.content) {
      const from = String(item.meta?.deletedFrom || "").split("\\").filter(Boolean)
      if (item.meta?.originalName) inBin.set([...from, item.meta.originalName].join("/"), item)
    }
    for (const key of Object.keys(index.files)) {
      const file = fs.resolve(key.split("/")) || inBin.get(key)
      if (file && !file.isDirectory) track(key, file)
      else await versionStore.forget(key).catch(() => {})
    }
    let timer = null
    onFsChange(() => {
      clearTimeout(timer)
      timer = setTimeout(() => followFiles(), 400)
    })
  })().catch(() => {})
  return watching
}

// keep `oldText` (what the file held) as a version; never throws
export const keepVersion = (file, oldText) => {
  const key = versionKey(file)
  if (!key || !hasHistory(file) || typeof oldText !== "string" || !oldText) return Promise.resolve(null)
  track(key, file)
  return versionStore.keep(key, oldText, file.type).catch(() => null)
}

// before overwriting a file yourself (Notepad): keep what it holds now
export const keepBefore = async (file, newText) => {
  if (!hasHistory(file) || !file.parent) return null
  const old = await readContent(file)
  if (old === newText) return null
  return keepVersion(file, old)
}

export const versionsOf = (file) => {
  const key = versionKey(file)
  return key ? versionStore.list(key).catch(() => []) : Promise.resolve([])
}

export const readVersion = (id) => versionStore.read(id).catch(() => null)

// put a version back: the file's current contents become a version themselves (writeAndSave
// keeps them), so a restore can be undone -> { ok, text } | { ok: false, error }
export const restoreVersion = async (file, id) => {
  const text = await readVersion(id)
  if (typeof text !== "string") return { ok: false, error: "That version couldn't be read. It may have been cleared." }
  const ok = await writeAndSave(file, text)
  return ok ? { ok: true, text } : { ok: false, error: "Drive C: is full, so the version couldn't be put back. Delete some files you no longer need, then try again." }
}

// a version as a new file next to the original -> { ok, file } | { ok: false, error }
export const saveVersionCopy = async (file, id, name) => {
  const text = await readVersion(id)
  if (typeof text !== "string") return { ok: false, error: "That version couldn't be read." }
  try {
    const made = fs.createFileIn(file.parent, name, FILE_TYPE[file.type] ? file.type : "text", "")
    if (!(await writeAndSave(made, text, { created: true }))) return { ok: false, error: "Drive C: is full." }
    return { ok: true, file: made }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

// a file renamed: its history follows it
export const versionsFollow = (oldKey, file) => {
  const key = versionKey(file)
  if (!oldKey || !key || oldKey === key || !hasHistory(file)) return Promise.resolve()
  return versionStore.move(oldKey, key).catch(() => {})
}

export const forgetVersions = (file) => {
  const key = versionKey(file)
  return key ? versionStore.forget(key).catch(() => {}) : Promise.resolve()
}

// Delete My Account with "erase this device": everything
export const eraseVersions = () => versionStore.erase().catch(() => false)

// fs.js writeAndSave hands every overwrite of a versioned file here
setVersionKeeper((file, oldText) => keepVersion(file, oldText))

// start following files a little after the desktop is up (one small IndexedDB read)
if (typeof window !== "undefined" && typeof indexedDB !== "undefined") setTimeout(() => watchFiles(), 4000)

// a removed 98ish user's whole database
onUserRemoved((id, prefix) => versionStore.dropDatabase(versionDbName(prefix)))

if (typeof window !== "undefined" && import.meta.env?.DEV) window.__versions = { store: versionStore, versionsOf, readVersion, keepVersion }
