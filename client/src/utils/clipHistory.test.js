// Clipboard history: caps, pins, password fields, one store per user, erasing.
// node --test client/src/utils/clipHistory.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as C from "./clipCore.js"
import { clipDbName, createClipStore } from "./clipStore.js"
import { createFakeIndexedDb } from "./fakeIndexedDb.js"

const png = (bytes) => `data:image/png;base64,${"A".repeat(Math.ceil((bytes * 4) / 3 / 4) * 4)}`

test("text is counted as UTF-8 and pictures by their decoded size", () => {
  assert.equal(C.textBytes("abc"), 3)
  assert.equal(C.textBytes("é"), 2)
  assert.equal(C.textBytes("€"), 3)
  assert.equal(C.textBytes("😀"), 4)
  assert.equal(C.dataUrlBytes("data:image/png;base64,AAAA"), 3)
  assert.equal(C.dataUrlBytes("data:image/png;base64,AAA="), 2)
  assert.ok(Math.abs(C.dataUrlBytes(png(1000)) - 1000) <= 3)
})

test("empty text and things that aren't pictures are not kept; 256 KB per item", () => {
  assert.equal(C.addClip([], { kind: "text", text: "   \n" }).added, false)
  assert.equal(C.addClip([], { kind: "image", dataUrl: "data:text/html;base64,AAAA" }).added, false)
  assert.equal(C.addClip([], { kind: "text", text: "x".repeat(256 * 1024) }).added, true)
  assert.equal(C.addClip([], { kind: "text", text: "x".repeat(256 * 1024 + 1) }).reason, "too big")
  assert.equal(C.addClip([], { kind: "image", dataUrl: png(300 * 1024) }).reason, "too big")
  assert.equal(C.addClip([], { kind: "image", dataUrl: png(200 * 1024), w: 10, h: 10 }).added, true)
})

test("newest first, the same words again move to the top, at most 25", () => {
  let list = []
  for (let i = 0; i < 30; i++) list = C.addClip(list, { kind: "text", text: `item ${i}` }, { now: i }).list
  assert.equal(list.length, 25)
  assert.equal(list[0].text, "item 29")
  assert.equal(list.at(-1).text, "item 5", "the oldest went first")
  const again = C.addClip(list, { kind: "text", text: "item 10" }, { now: 99 }).list
  assert.equal(again.length, 25)
  assert.equal(again[0].text, "item 10")
  assert.equal(again.filter((i) => i.text === "item 10").length, 1)
})

test("pinned items stay when the list is full and through Clear all", () => {
  let list = []
  for (let i = 0; i < 25; i++) list = C.addClip(list, { kind: "text", text: `t${i}` }, { now: i }).list
  const oldest = list.at(-1)
  list = C.pinClip(list, oldest.id, true)
  for (let i = 25; i < 40; i++) list = C.addClip(list, { kind: "text", text: `t${i}` }, { now: i }).list
  assert.equal(list.length, 25)
  assert.ok(list.some((i) => i.id === oldest.id && i.pinned), "the pinned oldest item is still there")
  assert.equal(C.ordered(list)[0].id, oldest.id, "pinned items are listed first")
  const cleared = C.clearClips(list)
  assert.deepEqual(cleared.map((i) => i.id), [oldest.id])
  assert.equal(C.pinClip(cleared, oldest.id, false)[0].pinned, false)
  assert.deepEqual(C.removeClip(cleared, oldest.id), [])
})

test("4 MB in all: big pictures push out the oldest unpinned ones", () => {
  let list = []
  for (let i = 0; i < 20; i++) list = C.addClip(list, { kind: "image", dataUrl: png(250 * 1024).replace("AAAA", `AA${String(i).padStart(2, "0").replace(/\d/g, (d) => "ABCDEFGHIJ"[d])}`), w: 1, h: 1 }, { now: i }).list
  assert.ok(C.totalBytes(list) <= C.CLIP_CAPS.totalBytes)
  assert.equal(list.length, 16, "16 x 250 KB fit in 4 MB")
  // everything pinned: a new item that doesn't fit is refused, not the pinned ones dropped
  const all = list.reduce((l, i) => C.pinClip(l, i.id, true), list)
  const r = C.addClip(all, { kind: "image", dataUrl: png(250 * 1024).replace("AAAA", "ZZZZ"), w: 1, h: 1 })
  assert.equal(r.added, false)
  assert.equal(r.reason, "full of pinned items")
  assert.equal(r.list.length, 16)
})

test("password fields, one-time codes and data-clip=off are never kept", () => {
  assert.equal(C.privateField({ tag: "INPUT", type: "password" }), true)
  assert.equal(C.privateField({ tag: "input", type: "PASSWORD" }), true)
  assert.equal(C.privateField({ tag: "INPUT", type: "text", autocomplete: "one-time-code" }), true)
  assert.equal(C.privateField({ tag: "INPUT", type: "text", autocomplete: "username current-password" }), true)
  assert.equal(C.privateField({ tag: "INPUT", type: "text", clipOff: true }), true)
  assert.equal(C.privateField({ tag: "TEXTAREA", type: "" }), false)
  assert.equal(C.privateField({ tag: "INPUT", type: "text", autocomplete: "off" }), false)
  assert.equal(C.privateField(null), false)
})

test("damaged records from storage are dropped", () => {
  const ok = { id: "a1", kind: "text", text: "hi", time: 1, pinned: true }
  const out = C.sanitize([ok, null, { id: 3, kind: "text", text: "x" }, { id: "b", kind: "image", dataUrl: "javascript:alert(1)" }, { id: "c", kind: "weird" }])
  assert.deepEqual(out, [{ kind: "text", text: "hi", bytes: 2, id: "a1", time: 1, pinned: true }])
  assert.deepEqual(C.sanitize("nope"), [])
})

test("shrinkToFit makes a picture small enough and never bigger", () => {
  assert.deepEqual(C.shrinkToFit(100, 50, 1000), { w: 100, h: 50 })
  const s = C.shrinkToFit(2000, 1000, 1024 * 1024)
  assert.ok(s.w < 2000 && s.h < 1000)
  assert.ok(s.w * s.h <= 2000 * 1000 * 0.25, "a quarter of the bytes: about a quarter of the area")
  assert.ok(Math.abs(s.w / s.h - 2) < 0.01, "the shape stays")
})

test("preview shows one tidy line", () => {
  assert.equal(C.preview({ kind: "text", text: "  hello\n\n world  " }), "hello world")
  assert.equal(C.preview({ kind: "image", w: 40, h: 30 }), "Picture 40 x 30")
  assert.equal(C.preview({ kind: "text", text: "x".repeat(200) }, 10).length, 10)
})

test("store: each user has their own database; reloading reads it back", async () => {
  const idb = createFakeIndexedDb()
  let user = "default"
  const a = createClipStore({ idb: () => idb, userId: () => user })
  await a.add({ kind: "text", text: "first user's words" })
  await a.flush()
  user = "ab12cd"
  const b = createClipStore({ idb: () => idb, userId: () => user })
  await b.add({ kind: "text", text: "Ana's words" })
  await b.flush()
  assert.deepEqual(idb.names().sort(), ["98ish-clipboard", "98ish-clipboard-ab12cd"])
  assert.equal(clipDbName("default"), "98ish-clipboard")
  // a new page load as each user
  user = "default"
  const a2 = createClipStore({ idb: () => idb, userId: () => user })
  assert.deepEqual((await a2.load()).map((i) => i.text), ["first user's words"])
  user = "ab12cd"
  const b2 = createClipStore({ idb: () => idb, userId: () => user })
  assert.deepEqual((await b2.load()).map((i) => i.text), ["Ana's words"])
})

test("store: pin, Clear all, erase (turning it off / Delete My Account) and a removed user", async () => {
  const idb = createFakeIndexedDb()
  const store = createClipStore({ idb: () => idb, userId: () => "default" })
  let seen = 0
  store.subscribe(() => seen++)
  const { item } = await store.add({ kind: "text", text: "keep me" })
  await store.add({ kind: "text", text: "drop me" })
  await store.pin(item.id, true)
  await store.clear()
  assert.deepEqual(store.get().map((i) => i.text), ["keep me"])
  await store.erase()
  assert.deepEqual(store.get(), [])
  const fresh = createClipStore({ idb: () => idb, userId: () => "default" })
  assert.deepEqual(await fresh.load(), [], "nothing left in storage after erase")
  assert.ok(seen >= 4)

  const other = createClipStore({ idb: () => idb, userId: () => "zz99yy" })
  await other.add({ kind: "text", text: "theirs" })
  await other.flush()
  assert.ok(idb.names().includes("98ish-clipboard-zz99yy"))
  assert.equal(store.dropUser("zz99yy"), true)
  assert.ok(!idb.names().includes("98ish-clipboard-zz99yy"))
  assert.equal(store.dropUser("default"), false, "the first user's history isn't dropped by user removal")
})

test("store: load() always gives what's kept now (the panel opens after copies)", async () => {
  const store = createClipStore({ idb: () => createFakeIndexedDb(), userId: () => "default" })
  await store.add({ kind: "text", text: "one" })
  await store.add({ kind: "text", text: "two" })
  assert.deepEqual((await store.load()).map((i) => i.text), ["two", "one"])
})

test("store: without IndexedDB it keeps copies for the visit only", async () => {
  const store = createClipStore({ idb: () => null, userId: () => "default" })
  await store.add({ kind: "text", text: "just now" })
  assert.equal(store.get().length, 1)
  assert.equal(await store.flush(), false)
})
