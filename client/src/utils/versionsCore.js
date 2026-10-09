// Version history's rules, pure (versions.test.js). Notepad, WordPad and Paint keep the
// contents a file had before each save ("previous versions", like Windows' Previous
// Versions tab), on this device only. The index is plain data:
//   { files: { [path]: [{ id, at, size, type, hash }, ...newest first] } }
// and each version's text is stored separately under its id (versionStore.js).

export const VERSION_CAPS = {
  perFile: 10, // versions kept per file
  maxAgeDays: 7, // older ones go (the last 10 versions or the last week, whichever is fewer)
  versionBytes: 6 * 1024 * 1024, // a bigger save isn't kept as a version (a huge picture)
  fileBytes: 16 * 1024 * 1024, // one file's versions together
  totalBytes: 64 * 1024 * 1024, // every file's versions together, on this device
}

// the programs whose files keep versions (fs.js FILE_TYPE): Notepad "text" (and "note"),
// WordPad "richtext" (and "text"), Paint "image"
export const VERSIONED_TYPES = new Set(["text", "note", "richtext", "image"])
export const isVersioned = (type) => VERSIONED_TYPES.has(type)

const DAY = 86_400_000

// bytes a text takes: a data URL (a picture) by its decoded size, other text as UTF-8
export const textBytes = (text = "") => {
  const s = String(text)
  const m = /^data:[^,]*;base64,/.exec(s)
  if (m) {
    const body = s.length - m[0].length
    const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0
    return Math.max(0, Math.floor((body * 3) / 4) - pad)
  }
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) (n += 4), i++
    else n += 3
  }
  return n
}

// a quick fingerprint (FNV-1a over the text, plus its length): "the same contents again"
export const fingerprint = (text = "") => {
  const s = String(text)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${h.toString(36)}-${s.length.toString(36)}`
}

export const emptyIndex = () => ({ files: {} })

// a saved index, checked (anything odd is dropped rather than trusted)
export const cleanIndex = (raw) => {
  const out = emptyIndex()
  if (!raw || typeof raw !== "object" || !raw.files || typeof raw.files !== "object") return out
  for (const [path, list] of Object.entries(raw.files)) {
    if (typeof path !== "string" || !Array.isArray(list)) continue
    const good = list.filter((v) => v && typeof v.id === "string" && Number.isFinite(v.at) && Number.isFinite(v.size) && typeof v.hash === "string")
    if (good.length) out.files[path] = good.sort((a, b) => b.at - a.at)
  }
  return out
}

const sum = (list) => list.reduce((n, v) => n + v.size, 0)

// Apply the caps -> { index, drop: [ids to delete] }
export const enforceCaps = (index, now = Date.now(), caps = VERSION_CAPS) => {
  const files = {}
  const drop = []
  for (const [path, all] of Object.entries(index.files)) {
    const list = []
    let bytes = 0
    for (const v of all) {
      const tooOld = now - v.at > caps.maxAgeDays * DAY
      if (tooOld || list.length >= caps.perFile || bytes + v.size > caps.fileBytes) drop.push(v.id)
      else {
        list.push(v)
        bytes += v.size
      }
    }
    if (list.length) files[path] = list
  }
  // the whole device: the oldest versions of any file go first
  let total = Object.values(files).reduce((n, l) => n + sum(l), 0)
  if (total > caps.totalBytes) {
    const everything = Object.entries(files)
      .flatMap(([path, list]) => list.map((v) => ({ path, v })))
      .sort((a, b) => a.v.at - b.v.at)
    for (const { path, v } of everything) {
      if (total <= caps.totalBytes) break
      files[path] = files[path].filter((x) => x.id !== v.id)
      if (!files[path].length) delete files[path]
      drop.push(v.id)
      total -= v.size
    }
  }
  return { index: { files }, drop }
}

// A file is about to be saved over: keep what it held.
// -> { index, drop, added: version | null, reason }
export const addVersion = (index, { path, text, type = "text", at = Date.now(), id }, caps = VERSION_CAPS) => {
  if (!path || typeof text !== "string") return { index, drop: [], added: null, reason: "nothing" }
  if (!text.length) return { index, drop: [], added: null, reason: "empty" }
  const size = textBytes(text)
  if (size > caps.versionBytes) return { index, drop: [], added: null, reason: "too big" }
  const hash = fingerprint(text)
  const list = index.files[path] || []
  // saving the same contents again isn't a new version
  if (list[0]?.hash === hash) return { index, drop: [], added: null, reason: "same" }
  const version = { id: id || `${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at, size, type, hash }
  const next = { files: { ...index.files, [path]: [version, ...list] } }
  const capped = enforceCaps(next, at, caps)
  const kept = (capped.index.files[path] || []).some((v) => v.id === version.id)
  return { index: capped.index, drop: capped.drop, added: kept ? version : null, reason: kept ? "kept" : "full" }
}

export const listVersions = (index, path) => index.files[path] || []

// one version gone (deleted from the list)
export const removeVersion = (index, path, id) => {
  const list = (index.files[path] || []).filter((v) => v.id !== id)
  const files = { ...index.files }
  if (list.length) files[path] = list
  else delete files[path]
  return { index: { files }, drop: [id] }
}

// every version of a file gone
export const removeFile = (index, path) => {
  const drop = (index.files[path] || []).map((v) => v.id)
  const files = { ...index.files }
  delete files[path]
  return { index: { files }, drop }
}

// a file renamed or moved: its versions follow it (the new name's own ones, if any, merge in)
export const moveFile = (index, from, to, caps = VERSION_CAPS) => {
  if (from === to || !index.files[from]) return { index, drop: [] }
  const files = { ...index.files }
  const merged = [...files[from], ...(files[to] || [])].sort((a, b) => b.at - a.at)
  delete files[from]
  files[to] = merged
  return enforceCaps({ files }, Date.now(), caps)
}

export const totals = (index) => {
  const lists = Object.values(index.files)
  return { files: lists.length, versions: lists.reduce((n, l) => n + l.length, 0), bytes: lists.reduce((n, l) => n + sum(l), 0) }
}

// "Today, 2:31 PM" / "Yesterday, 9:05 AM" / "Mon, Oct 5, 4:10 PM"
export const whenLabel = (at, now = Date.now()) => {
  const d = new Date(at)
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  const day = (t) => {
    const x = new Date(t)
    return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
  }
  if (day(at) === day(now)) return `Today, ${time}`
  if (day(at) === day(now - DAY)) return `Yesterday, ${time}`
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${time}`
}

// what a version looks like in the list's preview: words for text (WordPad's HTML as words)
export const previewText = (text = "", type = "text", max = 600) => {
  let s = String(text)
  if (type === "richtext")
    s = s
      .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
  s = s.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  return s.length > max ? `${s.slice(0, max)}...` : s
}

// "Letter (Oct 8 2.31 PM).txt": a restored copy's name
export const copyName = (name, at) => {
  const d = new Date(at)
  const label = `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":", ".")}`
  const dot = name.lastIndexOf(".")
  return dot > 0 ? `${name.slice(0, dot)} (${label})${name.slice(dot)}` : `${name} (${label})`
}
