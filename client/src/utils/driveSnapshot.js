import { exportDrive, importDrive } from "./fs"
import { DEFAULT_SETTINGS, getSettings, getWallpaperImage, saveWallpaperImage, setSettings } from "./settings"

// Copies of the whole C: drive: Backup files you download (drive + settings + achievements)
// and the online copy kept with your 98 Messenger account (drive + achievements only:
// settings like the screen saver or the phone's icon layout belong to each device).
// Anything read back is checked first, so a damaged or hand-edited file can't break 98ish.
// The server checks online copies with the same rules (server/drive/validate.js).

export const BACKUP_FORMAT = "98ish-backup"
export const BACKUP_VERSION = 1
export const BACKUP_EXT = ".98ish"
export const MAX_BACKUP_BYTES = 12 * 1024 * 1024
export const MAX_ONLINE_BYTES = 2 * 1024 * 1024

const ACHIEVEMENTS_KEY = "98ish.achievements"
const PROGRESS_KEY = "98ish.achievements.progress"

const MAX_NODES = 20_000
const MAX_DEPTH = 40
const MAX_META = 2_000
const BAD_NAME = /[\\/:"<>|\u0000-\u001F\u007F]/
const TYPE = /^[a-z][a-z0-9]{0,31}$/
const ACHIEVEMENT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/

const isPlain = (value) => !!value && typeof value === "object" && !Array.isArray(value)

// ---------- checking ----------

const nameProblem = (name) => {
  if (typeof name !== "string" || !name || name !== name.trim() || name.length > 64) return true
  if (/^[A-Za-z]:$/.test(name)) return false
  return BAD_NAME.test(name)
}

const checkNodes = (nodes, budget, depth = 0) => {
  if (!Array.isArray(nodes)) return "A folder's contents must be a list."
  if (depth > MAX_DEPTH) return "Folders are nested too deeply."
  for (const node of nodes) {
    if (--budget.nodes < 0) return "There are too many files."
    if (!isPlain(node) || (node.k !== "d" && node.k !== "f")) return "A file entry is damaged."
    if (nameProblem(node.n)) return "A file name is not valid."
    if (typeof node.t !== "string" || !TYPE.test(node.t)) return `"${node.n}" has an unknown type.`
    if (node.m !== undefined && node.m !== null && (!isPlain(node.m) || JSON.stringify(node.m).length > MAX_META)) return `"${node.n}" is damaged.`
    if (node.k === "f" && typeof node.x !== "string") return `"${node.n}" is damaged.`
    if (node.k === "d") {
      const problem = checkNodes(node.c, budget, depth + 1)
      if (problem) return problem
    }
  }
  return null
}

// -> an error message, or null if it's a usable drive
export const validateDrive = (drive) => {
  if (!isPlain(drive) || !Array.isArray(drive.root)) return "There is no drive in it."
  if (drive.bin !== undefined && !Array.isArray(drive.bin)) return "The Recycle Bin is damaged."
  if (drive.root.length > 26) return "There are too many drives."
  if (!drive.root.some((node) => isPlain(node) && node.k === "d" && node.n === "C:")) return "There is no drive C: in it."
  const budget = { nodes: MAX_NODES }
  return checkNodes(drive.root, budget) || checkNodes(drive.bin || [], budget)
}

export const validateAchievements = (achievements) => {
  if (achievements === undefined || achievements === null) return null
  if (!isPlain(achievements)) return "The achievements are damaged."
  const { unlocked = {}, progress = {} } = achievements
  if (!isPlain(unlocked) || !isPlain(progress)) return "The achievements are damaged."
  if (Object.keys(unlocked).length > 200 || Object.keys(progress).length > 200) return "There are too many achievements."
  for (const [id, time] of Object.entries(unlocked)) if (!ACHIEVEMENT_ID.test(id) || !Number.isFinite(time)) return "The achievements are damaged."
  for (const [id, steps] of Object.entries(progress)) {
    if (!ACHIEVEMENT_ID.test(id) || !Array.isArray(steps) || steps.length > 64 || steps.some((s) => typeof s !== "string" || s.length > 40)) return "The achievements are damaged."
  }
  return null
}

// Known settings must have the right kind of value; unknown ones (from a newer 98ish) are
// kept only if they're small and simple
const cleanSettings = (settings) => {
  if (!isPlain(settings)) return {}
  const out = {}
  for (const [key, value] of Object.entries(settings)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key)) continue
    const known = DEFAULT_SETTINGS[key]
    if (known !== undefined) {
      if (isPlain(known) ? isPlain(value) && JSON.stringify(value).length < 20_000 : typeof value === typeof known) out[key] = value
    } else if (["string", "number", "boolean"].includes(typeof value) && String(value).length < 200) out[key] = value
  }
  return out
}

// ---------- achievements ----------

const readJson = (key) => {
  try {
    const value = JSON.parse(localStorage.getItem(key))
    return isPlain(value) ? value : {}
  } catch {
    return {}
  }
}

export const readAchievements = () => ({ unlocked: readJson(ACHIEVEMENTS_KEY), progress: readJson(PROGRESS_KEY) })

// Both sets together: every achievement found anywhere (earliest time wins), every step taken
export const mergeAchievements = (a = {}, b = {}) => {
  const unlocked = { ...a.unlocked }
  for (const [id, time] of Object.entries(b.unlocked || {})) unlocked[id] = unlocked[id] ? Math.min(unlocked[id], time) : time
  const progress = { ...a.progress }
  for (const [id, steps] of Object.entries(b.progress || {})) progress[id] = [...new Set([...(progress[id] || []), ...steps])].slice(0, 64)
  return { unlocked, progress }
}

// Takes effect the next time 98ish starts (the achievements list reads them then)
export const writeAchievements = ({ unlocked = {}, progress = {} } = {}) => {
  try {
    localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(unlocked))
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress))
    return true
  } catch {
    return false
  }
}

// ---------- counting ----------

export const countDrive = (drive) => {
  const counts = { files: 0, folders: 0, recycled: (drive.bin || []).length }
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.k === "d") {
        if (node.t !== "drive") counts.folders++
        walk(node.c || [])
      } else counts.files++
    }
  }
  walk(drive.root)
  return counts
}

export const formatBytes = (bytes) =>
  bytes < 1024 ? `${bytes} bytes` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

// ---------- backup files ----------

const pad = (n) => String(n).padStart(2, "0")
export const backupFileName = (date = new Date()) => `98ish-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}${BACKUP_EXT}`

export const createBackup = () => {
  const settings = getSettings()
  const wallpaper = settings.wallpaper === "custom" ? getWallpaperImage() : null
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    drive: exportDrive(),
    settings,
    wallpaper: wallpaper || null,
    achievements: readAchievements(),
  }
}

// Text of a backup file -> { ok, backup, summary } | { ok: false, error }
export const readBackup = (text) => {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "This file is empty." }
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: `This file is too big to be a 98ish backup (they're at most ${formatBytes(MAX_BACKUP_BYTES)}).` }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: "This isn't a 98ish backup file (or it's damaged)." }
  }
  if (!isPlain(data) || data.format !== BACKUP_FORMAT) return { ok: false, error: "This isn't a 98ish backup file." }
  if (!Number.isInteger(data.version) || data.version < 1) return { ok: false, error: "This backup is damaged." }
  if (data.version > BACKUP_VERSION) return { ok: false, error: "This backup was made by a newer version of 98ish." }
  const problem = validateDrive(data.drive) || validateAchievements(data.achievements)
  if (problem) return { ok: false, error: `This backup is damaged: ${problem}` }
  const createdAt = Date.parse(data.createdAt)
  const w = data.wallpaper
  const wallpaper = typeof w === "string" && w.length < 5_000_000 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(w) ? w : null
  const backup = {
    createdAt: Number.isFinite(createdAt) ? new Date(createdAt) : null,
    drive: { root: data.drive.root, bin: data.drive.bin || [] },
    settings: cleanSettings(data.settings),
    wallpaper,
    achievements: { unlocked: {}, progress: {}, ...data.achievements },
  }
  return {
    ok: true,
    backup,
    summary: {
      ...countDrive(backup.drive),
      achievements: Object.keys(backup.achievements.unlocked).length,
      settings: Object.keys(backup.settings).length > 0,
      wallpaper: !!wallpaper,
      size: text.length,
      createdAt: backup.createdAt,
    },
  }
}

// Replace everything with a backup. -> { ok, warning } | { ok: false, error }; on an error
// nothing has changed. Reload the page afterwards so every window starts fresh.
export const restoreBackup = (backup) => {
  const before = exportDrive()
  let saved
  try {
    saved = importDrive(backup.drive)
  } catch (error) {
    return { ok: false, error: `This backup couldn't be restored: ${error.message}` }
  }
  if (!saved) {
    importDrive(before)
    return { ok: false, error: "This backup doesn't fit in this browser's storage. Nothing was changed." }
  }
  let warning = null
  const settings = { ...DEFAULT_SETTINGS, ...backup.settings }
  if (settings.wallpaper === "custom" && !(backup.wallpaper && saveWallpaperImage(backup.wallpaper))) {
    settings.wallpaper = DEFAULT_SETTINGS.wallpaper
    if (backup.wallpaper) warning = "Your wallpaper picture didn't fit, so the standard one is back."
  }
  setSettings(settings)
  writeAchievements(backup.achievements)
  return { ok: true, warning }
}

// ---------- online copies ----------

export const onlineSnapshot = () => ({ drive: exportDrive(), achievements: readAchievements() })

// An online copy from the server -> { ok, snapshot } | { ok: false, error }
export const checkOnlineSnapshot = (snapshot) => {
  if (!isPlain(snapshot)) return { ok: false, error: "The online copy is damaged." }
  const problem = validateDrive(snapshot.drive) || validateAchievements(snapshot.achievements)
  if (problem) return { ok: false, error: `The online copy is damaged: ${problem}` }
  return { ok: true, snapshot: { drive: { root: snapshot.drive.root, bin: snapshot.drive.bin || [] }, achievements: { unlocked: {}, progress: {}, ...snapshot.achievements } } }
}
