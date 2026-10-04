import { useEffect, useState } from "react"
import { DIRECTORY_TYPE, fs, fsReady, onFsChange, peekContent, readDriveMeta, saveNow, uniqueName, writeDriveMeta } from "./fs"
import { contentKey } from "./driveStore"
import { mergeAchievements, readAchievements, writeAchievements } from "./driveSnapshot"
import { DEFAULT_FOLDERS, NEVER_SYNC, baseOf, conflictName, decide, deviceName, inScope, planPush, scanLocal } from "./syncPlan"

// File sync with your 98 Messenger account (server/drive/sync.js): the folders you pick
// (My Documents, My Pictures and Desktop to start with) are kept the same on every device
// you sign on from. Changes here go up a few seconds after you make them; changes made
// elsewhere come down when you sign on, every minute while 98ish is open, and when you come
// back to it. If a file changed in both places, both are kept: the other one gets the
// file's name and this device's copy becomes "name (from iPhone)". Deletes go to the
// Recycle Bin. The decisions are in syncPlan.js.
//
// Signing on gives this device a sync token of its own, so it keeps syncing after 98
// Messenger signs it off because you signed on somewhere else. Signing off on purpose (or
// turning sync off) forgets it.

// { enabled, folders, account: { key, screenName, device }, told }. Sync is ON unless the
// person turned it off: signing on to 98 Messenger is what keeps photos and files safe (a
// phone's browser may clear website storage), so a device that never chose starts syncing at
// its first sign on and says so once (`told`; DriveSync.jsx shows the notice).
const PREFS_KEY = "98ish.drive.sync"
const PUSH_DELAY_MS = 4_000
const POLL_MS = 60_000
const ACH_EVERY_MS = 10 * 60_000
const KEPT_SHOWN_MS = 10 * 60_000
const BATCH = 100
const SERVER = (import.meta.env?.VITE_SOCKET_URL || "http://localhost:8000").replace(/\/$/, "")
const API = `${SERVER}/api/drive/sync`
const DEVICE = typeof navigator !== "undefined" ? deviceName(navigator.userAgent) : "another computer"

// ---------- remembered between visits ----------

const loadPrefs = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY))
    const folders = Array.isArray(saved?.folders) ? saved.folders.filter((f) => typeof f === "string" && !NEVER_SYNC.includes(f)) : DEFAULT_FOLDERS
    const account = saved?.account?.key ? { key: saved.account.key, screenName: saved.account.screenName || saved.account.key, device: saved.account.device || null } : null
    // nothing saved: on, with the notice. Saved "off" by a version from before sync was on by
    // default (it saved "off" on every sign off, so it may or may not have been chosen): stays
    // off, and the next sign on asks once (`ask`). Once told or asked, "off" stays off.
    if (!saved) return { enabled: true, folders, account, told: false }
    if (saved.told === undefined && !saved.enabled) return { enabled: false, folders, account, told: false, ask: true }
    return { enabled: !!saved.enabled, folders, account, told: saved.told !== false, ask: !saved.enabled && !!saved.ask }
  } catch {
    return { enabled: true, folders: DEFAULT_FOLDERS, account: null, told: false }
  }
}
let prefs = typeof localStorage !== "undefined" ? loadPrefs() : { enabled: false, folders: DEFAULT_FOLDERS, account: null, told: true }
const savePrefs = () => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // storage full: sync still works this visit
  }
}

// this device's bookkeeping for an account: { seq, base: { [path]: base }, achAt }
const stateKey = (key) => `sync:${key}`
const loadState = async (key) => {
  const saved = await readDriveMeta(stateKey(key))
  return { seq: Number(saved?.seq) || 0, base: saved?.base && typeof saved.base === "object" ? saved.base : {}, achAt: Number(saved?.achAt) || 0 }
}
const storeState = (key, st) => writeDriveMeta(stateKey(key), { seq: st.seq, base: st.base, achAt: st.achAt })

// ---------- state everyone can watch ----------

let session = null // { key, screenName, token } while signed on to 98 Messenger
const initialPhase = () => (!prefs.enabled ? "off" : prefs.account?.device ? "idle" : "signedOut")
// turnedOn: when sync was turned on by itself at this device's first sign on (for the notice)
let state = { phase: initialPhase(), text: "", lastSync: null, usage: null, quota: null, files: null, kept: 0, progress: null, busy: false, screenName: prefs.account?.screenName || null }
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
export const getSyncFolders = () => [...prefs.folders]
export const syncAccount = () => (session ? { key: session.key, screenName: session.screenName } : prefs.account ? { key: prefs.account.key, screenName: prefs.account.screenName } : null)

// top-level folders on C: that can sync
export const syncableFolders = () => {
  const drive = fs.resolve("C:")
  const names = drive?.isDirectory ? drive.content.filter((item) => item.isDirectory && !NEVER_SYNC.includes(item.name) && item.type !== DIRECTORY_TYPE.programs).map((item) => item.name) : []
  for (const name of prefs.folders) if (!names.includes(name)) names.push(name)
  return names
}

const time = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "")

// A short line for status bars
export const statusText = (s = state) => {
  switch (s.phase) {
    case "off":
      return "Sync is off."
    case "signedOut":
      return "Sign on to 98 Messenger to sync your files."
    case "syncing":
      return s.progress?.total ? `Syncing ${s.progress.done} of ${s.progress.total}...` : "Syncing your files..."
    case "pending":
      return "Changes will sync in a few seconds."
    case "offline":
      return "Offline. Your changes will sync when you're connected."
    case "idle":
      return `${s.kept ? `Kept both copies of ${s.kept} file${s.kept === 1 ? "" : "s"} changed on two devices. ` : ""}${s.lastSync ? `Synced at ${time(s.lastSync)}.` : "Ready to sync."}`
    default:
      return s.text || "Sync isn't working right now."
  }
}

// ---------- talking to the server ----------

class SyncError extends Error {
  constructor(message, { status = 0, offline = false, full = false } = {}) {
    super(message)
    Object.assign(this, { status, offline, full })
  }
}

const authToken = () => session?.token || prefs.account?.device || null

const request = async (method, path, { json, text, raw = false, keepalive = false } = {}) => {
  let response
  try {
    response = await fetch(API + path, {
      method,
      keepalive,
      headers: {
        Authorization: `Bearer ${authToken()}`,
        ...(json ? { "Content-Type": "application/json" } : text !== undefined ? { "Content-Type": "text/plain;charset=utf-8" } : {}),
      },
      body: json ? JSON.stringify(json) : text,
    })
  } catch {
    throw new SyncError("The sync server isn't answering.", { offline: true })
  }
  if (raw && response.ok) return response.text()
  let data = {}
  try {
    data = await response.json()
  } catch {
    // not JSON (a proxy page while the server wakes up)
  }
  if (!response.ok || data.ok === false) {
    if (response.status >= 500 || response.status === 0 || response.status === 502 || response.status === 503) throw new SyncError("The sync server is waking up. Sync will try again.", { status: response.status, offline: true })
    throw new SyncError(data.error || `Sync failed (${response.status}).`, { status: response.status, full: !!data.full })
  }
  return data
}

// tell the server to forget a device sync token (signing off, sync turned off)
const forgetDevice = (token) => {
  if (token) fetch(`${API}/device`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
}

// ---------- applying what changed elsewhere ----------

let applying = 0 // >0 while sync writes to the drive (those changes aren't ours to send)

const itemAt = (path) => {
  let node = fs.root
  for (const part of path.split("/")) {
    if (!node?.isDirectory) return null
    node = node.getItem(part)
  }
  return node || null
}

const describeItem = (item) =>
  item ? (item.isDirectory ? { kind: "d", type: item.type, hash: null, item } : { kind: "f", type: item.type, hash: item.contentHash, size: item.size, item }) : null

// the folder a path goes in, made if missing (a file in the way is renamed)
const folderFor = (path) => {
  const parts = path.split("/").slice(0, -1)
  let dir = fs.root
  for (const part of parts) {
    let next = dir.getItem(part)
    if (next && !next.isDirectory) {
      next.name = conflictName(next.name, DEVICE, (n) => dir.hasItem(n))
      next = null
    }
    if (!next) next = fs.createDirectoryIn(dir, part, part === "C:" ? DIRECTORY_TYPE.drive : DIRECTORY_TYPE.folder)
    dir = next
  }
  return dir
}

// a file's contents: from this drive if any file here has them, else downloaded
const contentsFor = async (hash) => {
  const twin = fs.findItem((item) => !item.isDirectory && item.contentHash === hash)
  if (twin) return { twin }
  const text = await request("GET", `/blob/${encodeURIComponent(hash)}`, { raw: true })
  if (contentKey(text) !== hash) throw new SyncError("A file came down damaged. Sync will try again.")
  return { text }
}

// put an entry from the server on the drive (the decision is already "take" or "keepBoth")
const writeEntry = async (entry) => {
  const name = entry.path.split("/").pop()
  let existing = itemAt(entry.path)
  if (entry.kind === "d") {
    if (existing?.isDirectory) return
    if (existing) fs.deleteItem(existing)
    fs.createDirectoryIn(folderFor(entry.path), name, entry.type)
    return
  }
  const source = await contentsFor(entry.hash)
  existing = itemAt(entry.path) // may have changed while downloading
  if (existing && (existing.isDirectory || existing.type !== entry.type)) {
    fs.deleteItem(existing)
    existing = null
  }
  const file = existing || fs.createFileIn(folderFor(entry.path), name, entry.type, "")
  if (source.twin) file.copyContentFrom(source.twin)
  else file.textContent = source.text
  if (entry.mtime) file.mtime = entry.mtime
}

// One entry from the server. -> 1 if both copies were kept, else 0
const applyEntry = async (entry, st) => {
  const local = describeItem(itemAt(entry.path))
  const choice = decide(entry, local, st.base[entry.path])
  let kept = 0
  if (choice === "take") {
    if (entry.deleted) {
      // a folder goes only once it's empty (anything new in it stays, and is sent again)
      if (!(local.item.isDirectory && local.item.content.length)) fs.deleteItem(local.item)
    } else await writeEntry(entry)
  } else if (choice === "keepBoth") {
    const item = local.item
    item.name = conflictName(item.name, DEVICE, (n) => item.parent.hasItem(n))
    kept = 1
    await writeEntry(entry)
  }
  st.base[entry.path] = baseOf(entry)
  return kept
}

// ---------- one sync ----------

let running = null
let again = false
let pushTimer = null
let retryTimer = null
let failures = 0

const pull = async (st) => {
  let kept = 0
  for (let page = 0; page < 200; page++) {
    const result = await request("GET", `/changes?since=${st.seq}`)
    const wanted = result.entries.filter((e) => inScope(e.path, prefs.folders))
    set({ usage: result.usage, quota: result.quota })
    if (wanted.length) {
      applying++
      try {
        for (let i = 0; i < wanted.length; i++) {
          set({ progress: { done: i + 1, total: wanted.length } })
          try {
            kept += await applyEntry(wanted[i], st)
          } catch (error) {
            if (error instanceof SyncError) throw error
            // one odd entry (a name clash, a folder that can't go) doesn't stop the rest
            console.warn("[sync] couldn't apply", wanted[i].path, error)
          }
        }
      } finally {
        applying--
      }
      if (!(await saveNow({ quiet: true }))) throw new SyncError("Drive C: is full, so files from your other devices can't be saved here. Delete some files and sync again.", { full: true })
    }
    st.seq = result.seq
    await storeState(session?.key || prefs.account.key, st)
    if (!result.more) break
  }
  return kept
}

const push = async (st, maxFile) => {
  const byPath = scanLocal(fs.resolve("C:"), prefs.folders)
  const changes = planPush(byPath, st.base, prefs.folders)
  if (!changes.length) return { conflicts: 0, skipped: 0 }
  let skipped = 0
  // contents the server doesn't have yet
  const files = changes.filter((c) => c.kind === "f" && !c.deleted)
  const tooBig = new Set(files.filter((c) => maxFile && (byPath.get(c.path)?.item.textLength || 0) > maxFile).map((c) => c.path))
  skipped += tooBig.size
  const hashes = [...new Set(files.filter((c) => !tooBig.has(c.path)).map((c) => c.hash))]
  const missing = new Set()
  for (let i = 0; i < hashes.length; i += 500) for (const h of (await request("POST", "/have", { json: { hashes: hashes.slice(i, i + 500) } })).missing) missing.add(h)
  const uploaded = new Set()
  const failed = new Set()
  let done = 0
  const toSend = files.filter((c) => missing.has(c.hash) && !tooBig.has(c.path))
  for (const change of toSend) {
    set({ progress: { done: ++done, total: toSend.length } })
    if (uploaded.has(change.hash) || failed.has(change.hash)) continue
    const item = byPath.get(change.path)?.item
    const text = item ? await peekContent(item) : null
    // changed again since the scan: it goes next time
    if (text === null || contentKey(text) !== change.hash) {
      failed.add(change.hash)
      continue
    }
    const result = await request("PUT", `/blob/${encodeURIComponent(change.hash)}`, { text })
    set({ usage: result.usage, quota: result.quota })
    uploaded.add(change.hash)
  }
  const ready = changes.filter((c) => !tooBig.has(c.path) && !(c.hash && failed.has(c.hash)))
  let conflicts = 0
  for (let i = 0; i < ready.length; i += BATCH) {
    const batch = ready.slice(i, i + BATCH)
    const result = await request("POST", "/push", { json: { device: DEVICE, changes: batch.map(({ path, kind, type, hash, size, mtime, deleted, baseRev }) => ({ path, kind, type, hash, size, mtime, deleted, baseRev })) } })
    set({ usage: result.usage, quota: result.quota })
    for (const r of result.results) {
      const sent = batch.find((c) => c.path === r.path)
      if (r.ok) {
        if (sent.deleted && !r.rev) delete st.base[r.path]
        else st.base[r.path] = baseOf({ ...sent, rev: r.rev })
      } else if (r.conflict) conflicts++
      else skipped++
    }
    await storeState(session?.key || prefs.account.key, st)
  }
  return { conflicts, skipped }
}

const syncAchievements = async (st) => {
  if (Date.now() - st.achAt < ACH_EVERY_MS) return
  const mine = readAchievements()
  const theirs = (await request("GET", "/achievements")).achievements
  const merged = mergeAchievements(mine, theirs)
  if (JSON.stringify(merged) !== JSON.stringify(mine)) writeAchievements(merged)
  if (JSON.stringify(merged) !== JSON.stringify(mergeAchievements({}, theirs))) await request("PUT", "/achievements", { json: { achievements: merged } })
  st.achAt = Date.now()
}

// a sync token for this device, made while signed on (kept for when the session ends)
const ensureDevice = async () => {
  if (!session || (prefs.account?.key === session.key && prefs.account.device)) return
  const result = await request("POST", "/device", { json: { name: DEVICE } })
  prefs = { ...prefs, account: { key: session.key, screenName: session.screenName, device: result.token } }
  savePrefs()
}

const canSync = () => prefs.enabled && !!authToken() && !!(session || prefs.account)

const runCycle = async () => {
  await fsReady
  const key = session?.key || prefs.account.key
  set({ phase: "syncing", busy: true, progress: null, text: "" })
  try {
    await ensureDevice()
    const st = await loadState(key)
    const info = await request("GET", "/state")
    set({ usage: info.usage, quota: info.quota, files: info.files })
    let kept = 0
    let skipped = 0
    for (let round = 0; round < 3; round++) {
      kept += await pull(st)
      const pushed = await push(st, info.maxFile)
      skipped = pushed.skipped
      if (!pushed.conflicts) break
    }
    await syncAchievements(st)
    await storeState(key, st)
    failures = 0
    const after = await request("GET", "/state")
    // "kept both copies" stays in the status for a while (later syncs don't hide it)
    const recent = state.kept && Date.now() - (state.keptAt || 0) < KEPT_SHOWN_MS
    set({
      phase: "idle",
      lastSync: Date.now(),
      kept: kept || (recent ? state.kept : 0),
      keptAt: kept ? Date.now() : state.keptAt,
      usage: after.usage,
      quota: after.quota,
      files: after.files,
      text: skipped ? `${skipped} file${skipped === 1 ? " is" : "s are"} too big to sync.` : "",
    })
  } catch (error) {
    failures++
    if (error.status === 401) {
      // the device token was forgotten (or ran out): sign on again to sync
      if (!session) {
        prefs = { ...prefs, account: prefs.account ? { ...prefs.account, device: null } : null }
        savePrefs()
        set({ phase: "signedOut", text: "" })
        return
      }
    }
    set({ phase: error.offline ? "offline" : "error", text: error.message || "Sync isn't working right now." })
    // try again later (sooner while offline), backing off
    clearTimeout(retryTimer)
    retryTimer = setTimeout(() => syncNow(), Math.min(10 * 60_000, (error.offline ? 15_000 : 30_000) * 2 ** Math.min(5, failures - 1)))
  } finally {
    set({ busy: false, progress: null })
  }
}

// Sync right now (signing on, Sync Now, a change made a few seconds ago). Resolves when done.
export const syncNow = () => {
  clearTimeout(pushTimer)
  if (!canSync()) return Promise.resolve()
  if (running) {
    again = true
    return running
  }
  running = runCycle().finally(() => {
    running = null
    if (again) {
      again = false
      syncNow()
    }
  })
  return running
}

// ---------- settings ----------

export const setSyncEnabled = (enabled) => {
  prefs = { ...prefs, enabled: !!enabled, told: true, ask: false }
  if (!enabled) {
    // forget this device's sync token too (signing on again makes a new one)
    forgetDevice(prefs.account?.device)
    prefs = { ...prefs, account: prefs.account ? { ...prefs.account, device: null } : null }
  }
  savePrefs()
  clearTimeout(pushTimer)
  clearTimeout(retryTimer)
  if (!enabled) return set({ phase: "off", text: "", progress: null })
  set({ phase: canSync() ? "syncing" : "signedOut", text: "" })
  return syncNow()
}

export const setSyncFolders = async (folders) => {
  const next = [...new Set(folders.filter((f) => typeof f === "string" && !NEVER_SYNC.includes(f)))]
  const added = next.some((f) => !prefs.folders.includes(f))
  prefs = { ...prefs, folders: next }
  savePrefs()
  const key = session?.key || prefs.account?.key
  if (key) {
    const st = await loadState(key)
    // forget folders no longer synced; a new one is read from the start
    for (const path of Object.keys(st.base)) if (!inScope(path, next)) delete st.base[path]
    if (added) st.seq = 0
    await storeState(key, st)
  }
  return syncNow()
}

// The one-time question for a device whose sync was off from before (DriveSync.jsx asks):
// yes turns it on, no keeps it off for good (Backup can still turn it on).
export const answerSyncAsk = (yes) => {
  set({ askOn: null })
  if (yes) return setSyncEnabled(true)
  prefs = { ...prefs, told: true, ask: false }
  savePrefs()
}

// ---------- who's signed on ----------

// From DriveSync (98 Messenger's status): the session while signed on; null when signed
// off. `kicked`: signed off because the account signed on somewhere else (sync carries on
// with this device's token); otherwise it was on purpose, and this device stops syncing.
export const setSyncSession = (next, { kicked = false } = {}) => {
  const same = next && session && next.key === session.key && next.token === session.token
  if (same || (!next && !session && kicked)) return
  if (next) {
    if (prefs.account && prefs.account.key !== next.key) {
      // a different account on this device: the old one's token goes
      forgetDevice(prefs.account.device)
      prefs = { ...prefs, account: null }
      savePrefs()
    }
    session = { key: next.key, screenName: next.screenName, token: next.token }
    set({ screenName: next.screenName })
    if (prefs.enabled && !prefs.told) {
      // the first sign on of a device that never chose: sync is on, and it says so once
      prefs = { ...prefs, told: true }
      savePrefs()
      set({ turnedOn: Date.now() })
    }
    if (prefs.enabled) syncNow()
    else set({ phase: "off", askOn: prefs.ask ? Date.now() : null })
    return
  }
  const was = session
  session = null
  if (!kicked && was) {
    forgetDevice(prefs.account?.device)
    prefs = { ...prefs, account: null }
    savePrefs()
    clearTimeout(pushTimer)
    clearTimeout(retryTimer)
    set({ phase: prefs.enabled ? "signedOut" : "off", text: "", usage: null, quota: null, files: null, screenName: null })
  }
}

// Online usage (any time sync can sign in)
export const fetchSyncInfo = async () => {
  if (!authToken()) return null
  try {
    const info = await request("GET", "/state")
    set({ usage: info.usage, quota: info.quota, files: info.files })
    return info
  } catch (error) {
    return { error: error.message }
  }
}

// Delete everything synced online (files here stay) and turn sync off
export const deleteOnlineFiles = async () => {
  if (!authToken()) return { ok: false, error: "Sign on to 98 Messenger first." }
  const key = session?.key || prefs.account?.key
  try {
    await request("DELETE", "")
  } catch (error) {
    return { ok: false, error: error.message }
  }
  if (key) await writeDriveMeta(stateKey(key), null)
  setSyncEnabled(false)
  set({ usage: 0, files: 0 })
  return { ok: true }
}

// Delete My Account (the server already deleted everything synced): this device forgets the
// account, its sync token and bookkeeping. Files here stay unless the person erases them too.
export const forgetSyncAccount = async (key) => {
  clearTimeout(pushTimer)
  clearTimeout(retryTimer)
  session = null
  prefs = { enabled: false, folders: DEFAULT_FOLDERS, account: null }
  try {
    localStorage.removeItem(PREFS_KEY) // a new account later starts with sync on again
  } catch {
    // blocked
  }
  if (key) await writeDriveMeta(stateKey(key), null)
  set({ phase: "off", text: "", usage: null, quota: null, files: null, screenName: null, lastSync: null })
}

// ---------- watching for changes ----------

const pushSoon = () => {
  if (!canSync() || applying) return
  clearTimeout(pushTimer)
  if (!running && state.phase !== "offline" && state.phase !== "error") set({ phase: "pending" })
  pushTimer = setTimeout(syncNow, PUSH_DELAY_MS)
}

onFsChange(() => {
  if (!applying) pushSoon()
})

if (typeof window !== "undefined") {
  // a device token from an earlier visit keeps syncing without signing on
  fsReady.then(() => {
    if (canSync()) setTimeout(syncNow, 1500)
  })
  setInterval(() => {
    if (document.visibilityState === "visible" && canSync() && !running) syncNow()
  }, POLL_MS)
  document.addEventListener("visibilitychange", () => {
    // back to 98ish: see what changed elsewhere; leaving: send what's waiting
    if (canSync() && (document.visibilityState === "visible" || pushTimer)) syncNow()
  })
  window.addEventListener("online", () => canSync() && syncNow())
}

// dev-only handle for browser tests
if (typeof window !== "undefined" && import.meta.env?.DEV) window.__sync = { state: () => state, syncNow, prefs: () => prefs, device: DEVICE }
