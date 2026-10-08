// Clipboard history's rules (like Windows' Win+V), pure: no DOM, no storage. The store is
// utils/clipHistory.js; the panel is shared/clipboard/ClipHistory.jsx (docs/sharing.md).
//
// An item: { id, kind: "text" | "image", text?, dataUrl?, w?, h?, bytes, time, pinned }
// Caps: 25 items, 256 KB each (pictures and text alike), 4 MB in all. When there's no room,
// the oldest unpinned items go first; pinned items stay until unpinned or deleted.

export const CLIP_CAPS = { items: 25, itemBytes: 256 * 1024, totalBytes: 4 * 1024 * 1024 }

// bytes an item takes: text as UTF-8, a picture by its data URL's decoded size
export const textBytes = (text) => {
  const s = String(text ?? "")
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4
      i++
    } else n += 3
  }
  return n
}
export const dataUrlBytes = (dataUrl) => {
  const s = String(dataUrl ?? "")
  const comma = s.indexOf(",")
  if (comma < 0) return s.length
  const body = s.slice(comma + 1)
  if (!/;base64$/i.test(s.slice(0, comma))) return body.length
  const pad = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((body.length * 3) / 4) - pad)
}
export const itemBytes = (item) => (item?.kind === "image" ? dataUrlBytes(item.dataUrl) : textBytes(item?.text))
export const totalBytes = (list) => (list || []).reduce((sum, item) => sum + (item.bytes ?? itemBytes(item)), 0)

// what makes two items the same (copying the same words again moves them to the top)
export const sameContent = (a, b) => a.kind === b.kind && (a.kind === "image" ? a.dataUrl === b.dataUrl : a.text === b.text)

// Is a copy from this field kept? Never from password fields, one-time codes, or anything
// marked data-clip="off" (a secret link). `field` is a plain description: { tag, type,
// autocomplete, clipOff } (clipHistory.js reads it from the element).
export const privateField = (field) => {
  if (!field) return false
  if (field.clipOff) return true
  const tag = String(field.tag || "").toUpperCase()
  const type = String(field.type || "").toLowerCase()
  const auto = String(field.autocomplete || "").toLowerCase()
  if (tag === "INPUT" && type === "password") return true
  if (/(^|\s)(current-password|new-password|one-time-code)(\s|$)/.test(auto)) return true
  return false
}

// Can this be kept? -> { ok: true, entry } | { ok: false, reason }
export const checkEntry = (entry) => {
  if (!entry || (entry.kind !== "text" && entry.kind !== "image")) return { ok: false, reason: "nothing" }
  if (entry.kind === "text") {
    const text = String(entry.text ?? "")
    if (!text.trim()) return { ok: false, reason: "empty" }
    const bytes = textBytes(text)
    if (bytes > CLIP_CAPS.itemBytes) return { ok: false, reason: "too big" }
    return { ok: true, entry: { kind: "text", text, bytes } }
  }
  const dataUrl = String(entry.dataUrl ?? "")
  if (!/^data:image\/(png|jpeg|gif|webp);/i.test(dataUrl)) return { ok: false, reason: "not a picture" }
  const bytes = dataUrlBytes(dataUrl)
  if (bytes > CLIP_CAPS.itemBytes) return { ok: false, reason: "too big" }
  return { ok: true, entry: { kind: "image", dataUrl, w: entry.w | 0, h: entry.h | 0, bytes } }
}

// Drops the oldest unpinned items until the list fits the caps. The newest item (index 0)
// is dropped only if nothing else can make room (everything else is pinned).
export const enforceCaps = (list, caps = CLIP_CAPS) => {
  const out = [...list]
  const over = () => out.length > caps.items || totalBytes(out) > caps.totalBytes
  while (over()) {
    let drop = -1
    for (let i = out.length - 1; i >= 1; i--) {
      if (!out[i].pinned) {
        drop = i
        break
      }
    }
    if (drop < 0) {
      // only pinned items besides the newest: the newest doesn't fit
      if (out.length && !out[0].pinned) out.splice(0, 1)
      else break
      continue
    }
    out.splice(drop, 1)
  }
  return out
}

let seq = 0
export const newId = (now = Date.now()) => `${now.toString(36)}${(seq++ % 1296).toString(36).padStart(2, "0")}`

// Adds a copy at the top -> { list, item, added, reason }. The same words or picture again
// move the existing item to the top (keeping its pin).
export const addClip = (list, raw, { now = Date.now(), caps = CLIP_CAPS } = {}) => {
  const checked = checkEntry(raw)
  if (!checked.ok) return { list, item: null, added: false, reason: checked.reason }
  const existing = list.find((i) => sameContent(i, checked.entry))
  const item = existing ? { ...existing, time: now } : { id: newId(now), ...checked.entry, time: now, pinned: false }
  const next = enforceCaps([item, ...list.filter((i) => i !== existing)], caps)
  const kept = next.includes(item)
  return { list: next, item: kept ? item : null, added: kept, reason: kept ? null : "full of pinned items" }
}

export const pinClip = (list, id, pinned = true) => list.map((i) => (i.id === id ? { ...i, pinned: !!pinned } : i))
export const removeClip = (list, id) => list.filter((i) => i.id !== id)
// Clear all (as Windows): pinned items stay
export const clearClips = (list) => list.filter((i) => i.pinned)

// Pinned first, then the rest (each newest first, as kept)
export const ordered = (list) => [...list.filter((i) => i.pinned), ...list.filter((i) => !i.pinned)]

// Cleans what came back from storage (old or damaged records are dropped, caps re-applied)
export const sanitize = (raw, caps = CLIP_CAPS) => {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const r of raw) {
    if (!r || typeof r !== "object" || typeof r.id !== "string") continue
    const c = checkEntry(r)
    if (!c.ok) continue
    out.push({ ...c.entry, id: r.id, time: Number(r.time) || 0, pinned: !!r.pinned })
  }
  return enforceCaps(out, caps)
}

// a one-line label for a text item (the panel shows a few lines; screen readers get this)
export const preview = (item, max = 120) => {
  if (!item) return ""
  if (item.kind === "image") return `Picture${item.w && item.h ? ` ${item.w} x ${item.h}` : ""}`
  const flat = String(item.text).replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// The size (in pixels) to shrink a picture to so it fits the per-item cap: the area scales
// with the bytes, roughly. -> { w, h } (never bigger than it was)
export const shrinkToFit = (w, h, bytes, cap = CLIP_CAPS.itemBytes) => {
  if (!(w > 0 && h > 0) || !(bytes > cap)) return { w, h }
  const f = Math.sqrt((cap * 0.85) / bytes)
  return { w: Math.max(1, Math.floor(w * f)), h: Math.max(1, Math.floor(h * f)) }
}
