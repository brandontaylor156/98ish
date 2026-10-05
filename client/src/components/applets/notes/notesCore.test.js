import test from "node:test"
import assert from "node:assert/strict"
import {
  addItem,
  checkedToBottom,
  cleanNote,
  daysLeft,
  editItem,
  isEmptyNote,
  liveItems,
  matches,
  mergeNotes,
  moveItem,
  newNote,
  noteTime,
  noteTitle,
  progress,
  pruneNote,
  purgeNote,
  removeChecked,
  removeItem,
  restoreNote,
  setField,
  sameNote,
  sortNotes,
  trashExpired,
  trashNote,
  LIMITS,
  TRASH_MS,
  TOMBSTONE_MS,
  DAY,
} from "./notesCore.js"

const T = 1_700_000_000_000
const texts = (note) => liveItems(note).map((i) => i.text)

test("a new note and its fields", () => {
  const n = newNote({ id: "a".repeat(16), title: "Groceries", items: ["milk", "eggs"], now: T })
  assert.equal(noteTitle(n), "Groceries")
  assert.deepEqual(texts(n), ["milk", "eggs"])
  assert.equal(n.color.v, "yellow")
  const renamed = setField(n, "title", "Shopping", T - 1000) // a slow clock still changes it
  assert.equal(renamed.title.v, "Shopping")
  assert.ok(renamed.title.t > n.title.t)
  assert.equal(setField(n, "title", "Groceries", T + 5), n) // no change, same note
  assert.equal(noteTitle(newNote({ body: "\n  first line\nsecond" })), "first line")
  assert.equal(noteTitle(newNote()), "(Empty note)")
  assert.ok(isEmptyNote(newNote()))
})

test("checklist: add, edit, check, remove, reorder, checked to bottom", () => {
  let n = newNote({ items: ["a", "b", "c", "d"], now: T })
  const ids = liveItems(n).map((i) => i.id)
  const added = addItem(n, "b2", T + 1, { afterId: ids[1] })
  n = added.note
  assert.deepEqual(texts(n), ["a", "b", "b2", "c", "d"])
  n = editItem(n, ids[0], { done: true }, T + 2)
  n = editItem(n, ids[2], { done: true }, T + 3)
  assert.deepEqual(progress(n), { done: 2, total: 5 })
  n = checkedToBottom(n, T + 4)
  assert.deepEqual(texts(n), ["b", "b2", "d", "a", "c"])
  // again: nothing moves
  assert.equal(checkedToBottom(n, T + 5), n)
  n = moveItem(n, ids[3], 0, T + 6)
  assert.deepEqual(texts(n), ["d", "b", "b2", "a", "c"])
  n = moveItem(n, ids[3], 99, T + 7)
  assert.deepEqual(texts(n), ["b", "b2", "a", "c", "d"])
  n = removeItem(n, added.id, T + 8)
  assert.deepEqual(texts(n), ["b", "a", "c", "d"])
  assert.equal(n.items[added.id].deleted, true)
  n = removeChecked(n, T + 9)
  assert.deepEqual(texts(n), ["b", "d"])
})

test("merge: fields newest-wins, items one by one, tombstones win when newer", () => {
  const base = newNote({ id: "b".repeat(16), title: "Date ideas", items: ["picnic", "museum"], now: T })
  const [picnic, museum] = liveItems(base).map((i) => i.id)
  // me: tick picnic, add bowling; Tina (later): rename, delete museum, add karaoke
  let mine = editItem(base, picnic, { done: true }, T + 10)
  mine = addItem(mine, "bowling", T + 11).note
  let hers = setField(base, "title", "Our date ideas", T + 20)
  hers = removeItem(hers, museum, T + 21)
  hers = addItem(hers, "karaoke", T + 22).note
  const ab = mergeNotes(mine, hers)
  const ba = mergeNotes(hers, mine)
  assert.deepEqual(ab, ba) // either order
  assert.deepEqual(mergeNotes(ab, ab), ab) // idempotent
  assert.equal(ab.title.v, "Our date ideas")
  assert.deepEqual(texts(ab).sort(), ["bowling", "karaoke", "picnic"])
  assert.equal(texts(ab)[0], "picnic")
  assert.equal(liveItems(ab)[0].done, true)
  // both changed the same item: the newer wins
  const x = editItem(base, picnic, { text: "picnic in the park" }, T + 30)
  const y = editItem(base, picnic, { done: true }, T + 31)
  assert.deepEqual(liveItems(mergeNotes(x, y)).find((i) => i.id === picnic), { id: picnic, text: "picnic", done: true, order: 1, t: T + 31 })
  // associativity with three copies
  const z = setField(base, "color", "pink", T + 40)
  assert.deepEqual(mergeNotes(mergeNotes(x, y), z), mergeNotes(x, mergeNotes(y, z)))
  // a purged note stays purged
  assert.deepEqual(mergeNotes(purgeNote(base, T + 50), z), { id: base.id, purgedAt: T + 50 })
  assert.ok(noteTime(ab) >= T + 22)
  // the same note with its keys in another order (as the server stores it) is the same
  const shuffled = JSON.parse(JSON.stringify({ items: ab.items, id: ab.id, trashedAt: ab.trashedAt, color: ab.color, body: ab.body, title: ab.title, createdAt: ab.createdAt }))
  assert.equal(sameNote(ab, shuffled), true)
  assert.equal(sameNote(ab, setField(ab, "body", "x", T + 99)), false)
})

test("recycle bin: trash, restore, 30 days, prune", () => {
  const n = newNote({ now: T })
  const trashed = trashNote(n, T + 1)
  assert.equal(daysLeft(trashed, T + 1), 30)
  assert.equal(trashExpired(trashed, T + 1 + TRASH_MS), true)
  assert.equal(trashExpired(trashed, T + TRASH_MS - DAY), false)
  assert.equal(restoreNote(trashed, T + 2).trashedAt.v, null)
  // item tombstones older than 180 days go
  let m = newNote({ items: ["x"], now: T })
  m = removeItem(m, liveItems(m)[0].id, T + 1)
  assert.equal(Object.keys(pruneNote(m, T + 2).items).length, 1)
  assert.equal(Object.keys(pruneNote(m, T + 2 + TOMBSTONE_MS).items).length, 0)
})

test("sorting and search", () => {
  const a = newNote({ id: "1".repeat(16), title: "Apples", color: "green", now: T })
  const b = newNote({ id: "2".repeat(16), title: "Bananas", color: "yellow", now: T + 5 })
  const c = newNote({ id: "3".repeat(16), body: "call the plumber", color: "pink", now: T + 9 })
  assert.deepEqual(sortNotes([a, b, c]).map((n) => n.id[0]), ["3", "2", "1"])
  assert.deepEqual(sortNotes([a, b, c], "pinned", { pinned: new Set([a.id]) }).map((n) => n.id[0]), ["1", "3", "2"])
  assert.deepEqual(sortNotes([a, b, c], "color").map((n) => n.id[0]), ["2", "1", "3"])
  assert.equal(matches(c, "PLUMBER call"), true)
  assert.equal(matches(c, "plumber apples"), false)
  assert.equal(matches(c, ""), true)
})

test("cleanNote checks what the server is sent", () => {
  const n = addItem(newNote({ id: "c".repeat(16), title: "ok\nline", body: "a\nb\u0007", now: T }), "item", T).note
  const ok = cleanNote({ ...n, evil: "<script>" }, T)
  assert.equal(ok.ok, true)
  assert.equal(ok.note.evil, undefined)
  assert.equal(ok.note.title.v, "ok line")
  assert.equal(ok.note.body.v, "a\nb")
  // clocks far ahead are pulled back
  assert.equal(cleanNote(setField(n, "title", "later", T + 10 * DAY), T).note.title.t, T + 5 * 60_000)
  assert.deepEqual(cleanNote({ id: n.id, purgedAt: T }, T).note, { id: n.id, purgedAt: T })
  for (const bad of [null, [], { ...n, id: "short" }, { ...n, title: null }, { ...n, items: { zz: { text: "x", order: 1, t: 1 } } }, { ...n, body: { v: "x".repeat(100), t: "soon" } }]) {
    assert.equal(cleanNote(bad, T).ok, false, JSON.stringify(bad)?.slice(0, 60))
  }
  let big = newNote({ id: "d".repeat(16), now: T })
  for (let i = 0; i < LIMITS.items + 1; i++) big = addItem(big, "x", T).note
  assert.equal(cleanNote(big, T).ok, false)
  const long = setField(newNote({ id: "e".repeat(16), now: T }), "body", "é".repeat(12_000), T)
  assert.equal(cleanNote(long, T).ok, false) // 24 KB of UTF-8
})
