import { useEffect, useState } from "react"
import { fs, importDrive, itemsFromNodes, onFsChange, saveNow, uniqueName } from "./fs"
import { MAX_ONLINE_BYTES, checkOnlineSnapshot, countDrive, formatBytes, mergeAchievements, onlineSnapshot, readAchievements, writeAchievements } from "./driveSnapshot"

// Keeps the C: drive in sync with an online copy saved under your 98 Messenger account
// (server/drive). While you're signed on and sync is turned on: changes go up 10 seconds
// after you make them (and when you leave the page), and signing on brings down anything
// newer. If the drive changed here AND online since the last sync, you choose which to keep.

const PREFS_KEY = "98ish.drive.sync" // { enabled, accounts: { [key]: { revision, hash, achHash, savedAt } } }
const PUSH_DELAY_MS = 10_000
const BEACON_MAX = 60_000 // browsers send at most 64 KB as the page closes
const SERVER = (import.meta.env?.VITE_SOCKET_URL || "http://localhost:8000").replace(/\/$/, "")
const API = `${SERVER}/api/drive`

// ---------- remembered between visits ----------

const loadPrefs = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY))
    return { enabled: !!saved?.enabled, accounts: saved?.accounts && typeof saved.accounts === "object" ? saved.accounts : {} }
  } catch {
    return { enabled: false, accounts: {} }
  }
}
let prefs = loadPrefs()
const savePrefs = () => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // storage full: sync still works this visit
  }
}
const recordFor = (key) => prefs.accounts[key] || null
const remember = (key, record) => {
  prefs = { ...prefs, accounts: { ...prefs.accounts, [key]: record } }
  savePrefs()
}

// ---------- state everyone can watch ----------

let account = null // { key, screenName, token }
let state = { phase: prefs.enabled ? "signedOut" : "off", text: "", info: null, conflict: null, busy: false }
const listeners = new Set()
const set = (patch) => {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn(state))
}

export const getSyncState = () => state
export const subscribeSync = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const useDriveSync = () => {
  const [value, setValue] = useState(state)
  useEffect(() => {
    setValue(state)
    return subscribeSync(setValue)
  }, [])
  return value
}

export const isSyncEnabled = () => prefs.enabled
export const syncAccount = () => account

const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "")

// A short line for status bars
export const statusText = (s = state) => {
  switch (s.phase) {
    case "off":
      return "Sync is off."
    case "signedOut":
      return "Sign on to 98 Messenger to sync your files."
    case "syncing":
      return "Syncing your files..."
    case "pending":
      return "Changes will sync in a few seconds."
    case "synced":
      return `Synced${s.info?.savedAt ? ` at ${time(s.info.savedAt)}` : ""}.`
    case "conflict":
      return "Your files changed here and online. Choose which to keep."
    default:
      return s.text || "Sync isn't working right now."
  }
}

// ---------- fingerprints (did anything change since the last sync?) ----------

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
const fingerprint = (snapshot) => ({ hash: hashText(JSON.stringify(snapshot.drive)), achHash: hashText(JSON.stringify(snapshot.achievements)) })

// ---------- talking to the server ----------

const request = async (method, path = "", body, { keepalive = false } = {}) => {
  const response = await fetch(API + path, {
    method,
    keepalive,
    headers: { Authorization: `Bearer ${account?.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = {}
  try {
    data = await response.json()
  } catch {
    // not JSON (a proxy error page)
  }
  return { status: response.status, ...data }
}

// A failed request -> what the status line says
const failure = (result) => {
  if (result.status === 401) {
    account = null // the session is over: stop trying until the next sign on
    return { phase: "error", text: "Your 98 Messenger session ended. Sign on again to sync." }
  }
  if (result.status === 413) return { phase: "error", text: result.error || `Your files are too big for the online copy (${formatBytes(MAX_ONLINE_BYTES)} at most).` }
  return { phase: "error", text: result.error || "The online drive isn't answering. Your files are safe here; sync will try again." }
}

// ---------- syncing ----------

let pushTimer = null
let running = null // the sync in progress (one at a time)

const counts = (drive) => countDrive(drive)

const applyOnline = (snapshot) => {
  if (!importDrive(snapshot.drive)) throw new Error("The online copy doesn't fit in this browser's storage.")
  writeAchievements(mergeAchievements(readAchievements(), snapshot.achievements))
}

// Send this computer's drive up, based on `base` (the revision we last saw)
const push = async (base) => {
  const key = account.key
  const snapshot = onlineSnapshot()
  const size = new Blob([JSON.stringify(snapshot)]).size
  if (size > MAX_ONLINE_BYTES) {
    return set({ phase: "error", text: `Your files take ${formatBytes(size)}, but an online copy can hold ${formatBytes(MAX_ONLINE_BYTES)}. Delete some pictures or sounds to sync again.` })
  }
  const result = await request("PUT", "", { baseRevision: base, snapshot })
  if (result.status === 409) return reconcile() // another device saved first
  if (!result.ok) return set(failure(result))
  remember(key, { revision: result.revision, savedAt: result.savedAt, ...fingerprint(snapshot) })
  set({ phase: "synced", info: { revision: result.revision, savedAt: result.savedAt, size: result.size }, text: "" })
}

// Compare this computer, the online copy and the last sync, then do the right thing
const reconcile = async () => {
  const key = account.key
  const record = recordFor(key)
  const local = onlineSnapshot()
  const mine = fingerprint(local)
  const online = await request("GET")
  if (account?.key !== key) return
  if (!online.ok) return set(failure(online))
  const info = { revision: online.revision, savedAt: online.savedAt, size: online.size }
  set({ info })

  if (!online.revision) return push(0) // nothing online yet
  if (record && online.revision === record.revision) {
    if (mine.hash !== record.hash || mine.achHash !== record.achHash) return push(record.revision)
    return set({ phase: "synced", text: "" })
  }

  // the online copy has changes this computer hasn't seen
  const checked = checkOnlineSnapshot(online.snapshot)
  if (!checked.ok) return set({ phase: "error", text: checked.error })
  const theirs = fingerprint(checked.snapshot)
  const merged = mergeAchievements(local.achievements, checked.snapshot.achievements)
  if (theirs.hash === mine.hash || (record && mine.hash === record.hash)) {
    // same files, or only the online copy changed: take it
    if (theirs.hash !== mine.hash) applyOnline(checked.snapshot)
    else writeAchievements(merged)
    remember(key, { revision: online.revision, savedAt: online.savedAt, hash: fingerprint(onlineSnapshot()).hash, achHash: theirs.achHash })
    set({ phase: "synced", text: "" })
    // achievements found here that the online copy doesn't have yet
    if (hashText(JSON.stringify(merged)) !== theirs.achHash) return push(online.revision)
    return
  }
  set({
    phase: "conflict",
    conflict: {
      snapshot: checked.snapshot,
      revision: online.revision,
      savedAt: online.savedAt,
      size: online.size,
      local: counts(local.drive),
      online: counts(checked.snapshot.drive),
      firstTime: !record,
      deferred: false,
    },
  })
}

// Sync right now (signing on, the Sync Now button). Resolves when done.
export const syncNow = () => {
  if (!prefs.enabled || !account) return Promise.resolve()
  if (state.phase === "conflict" && state.conflict) return Promise.resolve(set({ conflict: { ...state.conflict, deferred: false } }))
  if (running) return running
  clearTimeout(pushTimer)
  set({ phase: "syncing", busy: true })
  running = reconcile()
    .catch((error) => set({ phase: "error", text: error.message || "Sync didn't work. It will try again." }))
    .finally(() => {
      running = null
      set({ busy: false })
    })
  return running
}

// The answer to "which copy do you want to keep?": "local" | "online" | "both" | "later"
export const resolveConflict = async (choice) => {
  const conflict = state.conflict
  if (!conflict || !account) return
  if (choice === "later") return set({ conflict: { ...conflict, deferred: true } })
  set({ phase: "syncing", busy: true, conflict: null })
  try {
    if (choice === "online") {
      applyOnline(conflict.snapshot)
      const fp = fingerprint(onlineSnapshot())
      remember(account.key, { revision: conflict.revision, savedAt: conflict.savedAt, hash: fp.hash, achHash: hashText(JSON.stringify(conflict.snapshot.achievements)) })
      set({ phase: "synced", text: "" })
      // achievements from this computer go up too
      if (fp.achHash !== hashText(JSON.stringify(conflict.snapshot.achievements))) await push(conflict.revision)
      return
    }
    if (choice === "both") {
      // the online drive goes in C:\Online Copy, next to this computer's files
      const drive = fs.resolve("C:")
      const onlineC = conflict.snapshot.drive.root.find((node) => node.k === "d" && node.n === "C:")
      const folder = fs.createDirectoryIn(drive, uniqueName(drive, "Online Copy"))
      for (const item of itemsFromNodes(onlineC.c || [])) folder.insertItem(item)
      if (!saveNow()) {
        drive.removeItem(folder.name)
        saveNow()
        throw new Error("The online copy doesn't fit next to your files. Delete some pictures or sounds, or choose one copy.")
      }
      writeAchievements(mergeAchievements(readAchievements(), conflict.snapshot.achievements))
    }
    await push(conflict.revision) // "local" and "both": this computer's drive becomes the online copy
  } catch (error) {
    set({ phase: "error", text: error.message })
  } finally {
    set({ busy: false })
  }
}

export const setSyncEnabled = (enabled) => {
  prefs = { ...prefs, enabled: !!enabled }
  savePrefs()
  clearTimeout(pushTimer)
  if (!enabled) return set({ phase: "off", text: "", conflict: null })
  set({ phase: account ? "syncing" : "signedOut", text: "" })
  return syncNow()
}

// Who's signed on to 98 Messenger (null when nobody): DriveSync calls this
export const setSyncAccount = (next) => {
  const same = next && account && next.key === account.key && next.token === account.token
  if (same || (!next && !account)) return
  account = next ? { key: next.key, screenName: next.screenName, token: next.token } : null
  clearTimeout(pushTimer)
  if (!account) return set({ phase: prefs.enabled ? "signedOut" : "off", conflict: null, info: null, text: "" })
  if (prefs.enabled) syncNow()
}

// Online copy details (any time you're signed on, even with sync off)
export const fetchOnlineInfo = async () => {
  if (!account) return null
  const result = await request("GET", "/info")
  return result.ok ? { revision: result.revision, savedAt: result.savedAt, size: result.size } : { error: failure(result).text }
}

export const deleteOnlineCopy = async () => {
  if (!account) return { ok: false, error: "Sign on to 98 Messenger first." }
  const result = await request("DELETE")
  if (!result.ok) return { ok: false, error: failure(result).text }
  const accounts = { ...prefs.accounts }
  delete accounts[account.key]
  prefs = { ...prefs, enabled: false, accounts }
  savePrefs()
  set({ phase: "off", info: { revision: 0, savedAt: null, size: 0 }, conflict: null, text: "" })
  return { ok: true }
}

// ---------- watching for changes ----------

const changedSinceSync = () => {
  const record = account && recordFor(account.key)
  if (!record) return true
  const fp = fingerprint(onlineSnapshot())
  return fp.hash !== record.hash || fp.achHash !== record.achHash
}

const pushSoon = () => {
  if (!prefs.enabled || !account || state.phase === "conflict" || running) return
  clearTimeout(pushTimer)
  set({ phase: "pending" })
  pushTimer = setTimeout(() => {
    if (changedSinceSync()) syncNow()
    else set({ phase: "synced" })
  }, PUSH_DELAY_MS)
}

onFsChange(() => {
  if (!running) pushSoon()
})

const canSendNow = () => prefs.enabled && account && state.phase !== "conflict" && !running && recordFor(account.key)

if (typeof window !== "undefined") {
  // switching tabs or apps on a phone: send now, while the page can still finish a request
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && canSendNow() && changedSinceSync()) syncNow()
  })
  // closing the page: a small drive can still go up on the way out
  window.addEventListener("pagehide", () => {
    if (!canSendNow() || !changedSinceSync()) return
    const snapshot = onlineSnapshot()
    const body = { baseRevision: recordFor(account.key).revision, snapshot }
    if (JSON.stringify(body).length > BEACON_MAX) return // it goes up next time you sign on
    request("PUT", "", body, { keepalive: true }).catch(() => {})
  })
}

// for the Backup app: how big is the drive as an online copy?
export const onlineSize = () => new Blob([JSON.stringify(onlineSnapshot())]).size
