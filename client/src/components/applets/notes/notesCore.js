// Notes (sticky notes): the data rules, with no browser, React or storage in them, so Node
// can test them and the 98ish server can use the very same merge (server/notes loads this
// file): node --test client/src/components/applets/notes/notesCore.test.js
//
// A note is built so two copies changed apart (a phone offline, two people in a shared
// note) always merge the same way, whichever order they meet in:
//
//   { id: 16 hex,
//     title:     { v: "Groceries", t },     each field is a register: its value and the
//     body:      { v: "text...", t },       time it was set; the newer one wins
//     color:     { v: "yellow", t },
//     trashedAt: { v: null | ms, t },       in the Recycle Bin since (30 days, then purged)
//     items: { [8 hex]: { text, done, order, t } | { deleted: true, order, t } },
//                                           checklist items, each its own entry: the newer
//                                           wins; a deleted one stays as a tombstone
//     createdAt }
//   purged: { id, purgedAt } once it left the Recycle Bin for good (that always wins)
//
// Times are the device's clock in ms; a change always stamps at least one more than the
// time it replaces, so a slow clock can still change things.

export const COLORS = ["yellow", "green", "pink", "purple", "blue", "white"]
// the classic sticky-note paper, and a darker edge for each
export const PAPER = {
  yellow: { paper: "#fff7a1", edge: "#e6d65a", ink: "#000" },
  green: { paper: "#ccf5c4", edge: "#8fcf84", ink: "#000" },
  pink: { paper: "#ffd1e8", edge: "#e89cc0", ink: "#000" },
  purple: { paper: "#e2d3fa", edge: "#b49be0", ink: "#000" },
  blue: { paper: "#cde8ff", edge: "#8dbde6", ink: "#000" },
  white: { paper: "#ffffff", edge: "#b8b8b8", ink: "#000" },
}
export const COLOR_NAMES = { yellow: "Yellow", green: "Green", pink: "Pink", purple: "Purple", blue: "Blue", white: "White" }

export const LIMITS = {
  noteBytes: 20 * 1024, // one note, as JSON
  items: 200, // checklist items in a note (tombstones not counted)
  allItems: 400, // with tombstones
  title: 120,
  body: 16_000,
  item: 500,
  notes: 2000, // per account
  accountBytes: 3 * 1024 * 1024, // every note an account owns, together
  members: 10, // people in one shared note
}
export const DAY = 86_400_000
export const TRASH_MS = 30 * DAY // the Recycle Bin keeps a note this long
export const TOMBSTONE_MS = 180 * DAY // a deleted item or note is remembered this long
export const FUTURE_SLACK_MS = 5 * 60_000 // clocks ahead by more than this are pulled back

const FIELDS = ["title", "body", "color", "trashedAt"]
const NOTE_ID = /^[a-f0-9]{16}$/
const ITEM_ID = /^[a-f0-9]{8}$/

export const isNoteId = (id) => NOTE_ID.test(String(id))

const hex = (bytes) => {
  const a = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(a)
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("")
}
export const newNoteId = () => hex(8)
export const newItemId = () => hex(4)

const reg = (v, t) => ({ v, t })
// stamp a change: now, but always after what it replaces
const after = (old, now) => Math.max(now, (old?.t || 0) + 1)

// ---------- making and changing ----------

export const newNote = ({ id = newNoteId(), title = "", body = "", color = "yellow", items = [], now = Date.now() } = {}) => {
  const note = { id, title: reg(title, now), body: reg(body, now), color: reg(COLORS.includes(color) ? color : "yellow", now), trashedAt: reg(null, now), items: {}, createdAt: now }
  items.forEach((text, i) => {
    note.items[newItemId()] = { text: String(text), done: false, order: i + 1, t: now }
  })
  return note
}

export const setField = (note, field, value, now = Date.now()) => {
  if (!FIELDS.includes(field)) throw new Error(`no field ${field}`)
  if (note[field]?.v === value) return note
  return { ...note, [field]: reg(value, after(note[field], now)) }
}

export const trashNote = (note, now = Date.now()) => setField(note, "trashedAt", now, now)
export const restoreNote = (note, now = Date.now()) => setField(note, "trashedAt", null, now)
export const purgeNote = (note, now = Date.now()) => ({ id: note.id, purgedAt: now })

// the checklist as shown: live items in order -> [{ id, text, done, order, t }]
export const liveItems = (note) =>
  Object.entries(note?.items || {})
    .filter(([, item]) => !item.deleted)
    .map(([id, item]) => ({ id, ...item }))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))

const putItem = (note, id, item) => ({ ...note, items: { ...note.items, [id]: item } })

// add an item at the end, or right after `afterId` -> { note, id }
export const addItem = (note, text = "", now = Date.now(), { afterId = null, id = newItemId() } = {}) => {
  const list = liveItems(note)
  const at = afterId ? list.findIndex((i) => i.id === afterId) : -1
  let order
  // at the end: after every item ever (tombstones too), so items added apart rarely tie
  if (at < 0) order = Math.max(0, ...Object.values(note.items || {}).map((i) => i.order)) + 1
  else order = list[at + 1] ? (list[at].order + list[at + 1].order) / 2 : list[at].order + 1
  return { note: putItem(note, id, { text: String(text).slice(0, LIMITS.item), done: false, order, t: Math.max(now, (note.items?.[id]?.t || 0) + 1) }), id }
}

export const editItem = (note, id, patch, now = Date.now()) => {
  const old = note.items?.[id]
  if (!old || old.deleted) return note
  const next = { ...old, ...("text" in patch ? { text: String(patch.text).slice(0, LIMITS.item) } : {}), ...("done" in patch ? { done: !!patch.done } : {}) }
  if (next.text === old.text && next.done === old.done) return note
  return putItem(note, id, { ...next, t: after(old, now) })
}

export const removeItem = (note, id, now = Date.now()) => {
  const old = note.items?.[id]
  if (!old || old.deleted) return note
  return putItem(note, id, { deleted: true, order: old.order, t: after(old, now) })
}

// move an item to a place in the shown list (0 = first)
export const moveItem = (note, id, toIndex, now = Date.now()) => {
  const list = liveItems(note)
  const from = list.findIndex((i) => i.id === id)
  if (from < 0) return note
  const rest = list.filter((i) => i.id !== id)
  const to = Math.max(0, Math.min(rest.length, toIndex))
  if (to === from) return note
  const before = rest[to - 1]
  const next = rest[to]
  const order = before && next ? (before.order + next.order) / 2 : before ? before.order + 1 : next ? next.order - 1 : 1
  const old = note.items[id]
  return putItem(note, id, { ...old, order, t: after(old, now) })
}

// "Move checked to bottom": ticked items after the rest, each group keeping its order
export const checkedToBottom = (note, now = Date.now()) => {
  const list = liveItems(note)
  const open = list.filter((i) => !i.done)
  const done = list.filter((i) => i.done)
  let prev = open.at(-1)?.order ?? 0
  let out = note
  for (const item of done) {
    // already below every open item (and the ticked ones before it): it stays put
    if (item.order > prev) {
      prev = item.order
      continue
    }
    prev += 1
    const old = note.items[item.id]
    out = putItem(out, item.id, { ...old, order: prev, t: after(old, now) })
  }
  return out
}

export const uncheckAll = (note, now = Date.now()) => liveItems(note).reduce((n, i) => (i.done ? editItem(n, i.id, { done: false }, now) : n), note)
export const removeChecked = (note, now = Date.now()) => liveItems(note).reduce((n, i) => (i.done ? removeItem(n, i.id, now) : n), note)

// ---------- merging ----------

// JSON with every object's keys sorted, so two equal notes always read the same
const canon = (v) => (v && typeof v === "object" ? (Array.isArray(v) ? `[${v.map(canon).join(",")}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`) : JSON.stringify(v ?? null))
const same = (a, b) => canon(a) === canon(b)
// the newer register; a tie goes to the larger value (so both sides agree)
const pick = (a, b) => {
  if (!a) return b
  if (!b) return a
  if (b.t !== a.t) return b.t > a.t ? b : a
  return canon(b.v) > canon(a.v) ? b : a
}
const pickItem = (a, b) => {
  if (!a) return b
  if (!b) return a
  if (b.t !== a.t) return b.t > a.t ? b : a
  if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b
  return canon(b) > canon(a) ? b : a
}

export const isPurged = (note) => !!note?.purgedAt

// Two copies of a note -> one (commutative, associative, idempotent)
export const mergeNotes = (a, b) => {
  if (!a) return b || null
  if (!b) return a
  if (a.purgedAt || b.purgedAt) return { id: a.id, purgedAt: Math.max(a.purgedAt || 0, b.purgedAt || 0) }
  const out = { id: a.id, createdAt: Math.min(a.createdAt || Infinity, b.createdAt || Infinity) }
  if (!Number.isFinite(out.createdAt)) out.createdAt = 0
  for (const f of FIELDS) out[f] = pick(a[f], b[f]) || reg(f === "color" ? "yellow" : f === "trashedAt" ? null : "", 0)
  out.items = {}
  for (const id of new Set([...Object.keys(a.items || {}), ...Object.keys(b.items || {})])) out.items[id] = pickItem(a.items?.[id], b.items?.[id])
  return out
}

export const sameNote = (a, b) => same(a, b)

// the last time anything in it changed
export const noteTime = (note) => {
  if (!note) return 0
  if (note.purgedAt) return note.purgedAt
  let t = note.createdAt || 0
  for (const f of FIELDS) t = Math.max(t, note[f]?.t || 0)
  for (const item of Object.values(note.items || {})) t = Math.max(t, item.t || 0)
  return t
}

// forget item tombstones nobody needs any more
export const pruneNote = (note, now = Date.now()) => {
  if (!note || note.purgedAt) return note
  const items = Object.fromEntries(Object.entries(note.items || {}).filter(([, i]) => !i.deleted || now - i.t < TOMBSTONE_MS))
  return Object.keys(items).length === Object.keys(note.items || {}).length ? note : { ...note, items }
}

// ---------- reading ----------

export const isTrashed = (note) => !!note?.trashedAt?.v
export const trashExpired = (note, now = Date.now()) => isTrashed(note) && now - note.trashedAt.v >= TRASH_MS
export const daysLeft = (note, now = Date.now()) => (isTrashed(note) ? Math.max(0, Math.ceil((note.trashedAt.v + TRASH_MS - now) / DAY)) : null)

const firstLine = (text) =>
  String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean) || ""

// what a note is called in lists
export const noteTitle = (note) => {
  if (!note || note.purgedAt) return ""
  return (note.title?.v || "").trim() || firstLine(note.body?.v).slice(0, 60) || liveItems(note)[0]?.text?.trim().slice(0, 60) || "(Empty note)"
}

// all its words (search)
export const noteText = (note) => [note?.title?.v, note?.body?.v, ...liveItems(note).map((i) => i.text)].filter(Boolean).join("\n")

export const isEmptyNote = (note) => !note?.title?.v?.trim() && !note?.body?.v?.trim() && !liveItems(note).some((i) => i.text.trim())

export const progress = (note) => {
  const list = liveItems(note)
  return { done: list.filter((i) => i.done).length, total: list.length }
}

// sort: "recent" (last changed first), "pinned" (pinned to the desktop first), "color"
export const SORTS = { recent: "Date changed", pinned: "Pinned first", color: "Color" }
export const sortNotes = (notes, how = "recent", { pinned = new Set() } = {}) => {
  const recent = (a, b) => noteTime(b) - noteTime(a) || (a.id < b.id ? -1 : 1)
  const list = [...notes]
  if (how === "pinned") return list.sort((a, b) => (pinned.has(b.id) ? 1 : 0) - (pinned.has(a.id) ? 1 : 0) || recent(a, b))
  if (how === "color") return list.sort((a, b) => COLORS.indexOf(a.color?.v) - COLORS.indexOf(b.color?.v) || recent(a, b))
  return list.sort(recent)
}

// does a note match what's typed in the search box (every word, anywhere)?
export const matches = (note, query) => {
  const words = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return true
  const text = noteText(note).toLowerCase()
  return words.every((w) => text.includes(w))
}

// ---------- checking what comes in (the server; the client before sending) ----------

export const utf8Length = (text) => {
  let n = 0
  for (const ch of String(text)) {
    const c = ch.codePointAt(0)
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }
  return n
}
export const noteBytes = (note) => utf8Length(JSON.stringify(note))

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const cleanText = (v, max, lines) => {
  let s = String(v ?? "").replace(CONTROL, "")
  if (!lines) s = s.replace(/[\r\n\t]+/g, " ")
  return s.slice(0, max)
}
const cleanTime = (t, now) => {
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(Math.min(n, now + FUTURE_SLACK_MS))
}

// Anything sent as a note -> { ok, note } | { ok: false, error } (unknown fields dropped)
export const cleanNote = (input, now = Date.now()) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "That isn't a note." }
  if (!isNoteId(input.id)) return { ok: false, error: "That note's id isn't right." }
  if (input.purgedAt !== undefined) {
    const t = cleanTime(input.purgedAt, now)
    return t === null ? { ok: false, error: "That note's time isn't right." } : { ok: true, note: { id: input.id, purgedAt: t } }
  }
  const note = { id: input.id, createdAt: cleanTime(input.createdAt, now) ?? 0, items: {} }
  for (const f of FIELDS) {
    const r = input[f]
    const t = cleanTime(r?.t, now)
    if (!r || typeof r !== "object" || t === null) return { ok: false, error: "That note is damaged." }
    let v = r.v
    if (f === "title") v = cleanText(v, LIMITS.title, false)
    else if (f === "body") v = cleanText(v, LIMITS.body, true)
    else if (f === "color") v = COLORS.includes(v) ? v : "yellow"
    else v = v === null || v === undefined ? null : cleanTime(v, now)
    note[f] = { v, t }
  }
  const entries = Object.entries(input.items && typeof input.items === "object" && !Array.isArray(input.items) ? input.items : {})
  if (entries.length > LIMITS.allItems) return { ok: false, error: `A note can have at most ${LIMITS.items} checklist items.` }
  let live = 0
  for (const [id, item] of entries) {
    if (!ITEM_ID.test(id) || !item || typeof item !== "object") return { ok: false, error: "A checklist item is damaged." }
    const t = cleanTime(item.t, now)
    const order = Number(item.order)
    if (t === null || !Number.isFinite(order)) return { ok: false, error: "A checklist item is damaged." }
    if (item.deleted) note.items[id] = { deleted: true, order, t }
    else {
      live++
      note.items[id] = { text: cleanText(item.text, LIMITS.item, false), done: item.done === true, order, t }
    }
  }
  if (live > LIMITS.items) return { ok: false, error: `A note can have at most ${LIMITS.items} checklist items.` }
  if (noteBytes(note) > LIMITS.noteBytes) return { ok: false, error: "That note is too long (20 KB at most). Split it into two notes." }
  return { ok: true, note }
}
