// Version history (docs/storage-sync.md): Notepad, WordPad and Paint keep the contents a file
// had before each save, so File > Restore Previous Version... (and a file's Properties) can
// bring it back. On this device only (never synced, never in Backup), per 98ish user:
// IndexedDB named through the storage seam (keyPrefix() + "versions"), deleted with a removed
// user (onUserRemoved) and by Delete My Account's "erase this device". Caps: versionsCore.js
// VERSION_CAPS (10 versions a file, 30 days, 16 MB a file, 64 MB in all).
//
// How saves get here: fs.js writeAndSave calls the keeper installed below for every
// overwrite of a versioned type (WordPad, Paint, Save As over an existing file); Notepad,
// which sets textContent itself, calls keepBefore(file) first.

import { FILE_TYPE, fs, readContent, setVersionKeeper, writeAndSave } from "./fs"
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

// keep `oldText` (what the file held) as a version; never throws
export const keepVersion = (file, oldText) => {
  const key = versionKey(file)
  if (!key || !hasHistory(file) || typeof oldText !== "string" || !oldText) return Promise.resolve(null)
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

// a removed 98ish user's whole database
onUserRemoved((id, prefix) => versionStore.dropDatabase(versionDbName(prefix)))

if (typeof window !== "undefined" && import.meta.env?.DEV) window.__versions = { store: versionStore, versionsOf, readVersion, keepVersion }
