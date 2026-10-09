// Version history: the caps (10 a file, 7 days, per-version, per-file and total sizes),
// keeping/restoring through the IndexedDB store, moving with a renamed file, per-user
// databases and erasing. Run: node --test client/src/utils/versions.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { VERSION_CAPS, addVersion, cleanIndex, copyName, emptyIndex, enforceCaps, fingerprint, moveFile, previewText, textBytes, totals } from "./versionsCore.js"
import { createVersionStore } from "./versionStore.js"
import { createFakeIndexedDb } from "./fakeIndexedDb.js"

const DAY = 86_400_000
const T0 = Date.UTC(2026, 9, 8, 12)

test("caps: the last 10 versions or 7 days, whichever is fewer", () => {
  assert.equal(VERSION_CAPS.perFile, 10)
  assert.equal(VERSION_CAPS.maxAgeDays, 7)
  let index = emptyIndex()
  for (let i = 0; i < 14; i++) index = addVersion(index, { path: "C:/a.txt", text: `v${i}`, at: T0 + i * 1000 }).index
  const list = index.files["C:/a.txt"]
  assert.equal(list.length, 10)
  assert.equal(list[0].hash, fingerprint("v13"), "newest first")
  assert.equal(list.at(-1).hash, fingerprint("v4"))
  // a week later the old ones go
  const later = enforceCaps(index, T0 + 7 * DAY + 5000)
  assert.equal(later.index.files["C:/a.txt"].length, 9, "v4 (more than 7 days old) went")
  assert.equal(enforceCaps(index, T0 + 8 * DAY).index.files["C:/a.txt"], undefined)
  assert.equal(enforceCaps(index, T0 + 8 * DAY).drop.length, 10)
})

test("the same contents again, empty, or too big aren't kept", () => {
  let index = addVersion(emptyIndex(), { path: "p", text: "hello", at: T0 }).index
  assert.equal(addVersion(index, { path: "p", text: "hello", at: T0 + 1 }).reason, "same")
  assert.equal(addVersion(index, { path: "p", text: "", at: T0 + 1 }).reason, "empty")
  const caps = { ...VERSION_CAPS, versionBytes: 10 }
  assert.equal(addVersion(index, { path: "p", text: "x".repeat(11), at: T0 + 1 }, caps).reason, "too big")
})

test("per-file and total size caps drop the oldest first", () => {
  const caps = { ...VERSION_CAPS, fileBytes: 25, totalBytes: 30 }
  let index = emptyIndex()
  for (let i = 0; i < 4; i++) index = addVersion(index, { path: "a", text: `${i}`.repeat(10), at: T0 + i }, caps).index
  assert.equal(index.files.a.length, 2, "two of 10 bytes fit in 25")
  for (let i = 0; i < 3; i++) index = addVersion(index, { path: "b", text: `${i}b`.repeat(5), at: T0 + 10 + i }, caps).index
  assert.ok(totals(index).bytes <= 30)
  assert.equal(index.files.b.length, 2)
  assert.equal(index.files.a.length, 1, "the oldest version (of any file) went to make room")
  assert.equal(index.files.a[0].hash, fingerprint("3".repeat(10)))
})

test("sizes: pictures by decoded bytes, text as UTF-8", () => {
  assert.equal(textBytes("abc"), 3)
  assert.equal(textBytes("é"), 2)
  assert.equal(textBytes("😀"), 4)
  assert.equal(textBytes("data:image/png;base64,AAAA"), 3)
  assert.equal(textBytes("data:image/png;base64,AAA="), 2)
})

test("moving a file takes its versions along; a broken index is cleaned", () => {
  let index = addVersion(emptyIndex(), { path: "C:/old.txt", text: "one", at: T0 }).index
  index = moveFile(index, "C:/old.txt", "C:/new.txt").index
  assert.equal(index.files["C:/old.txt"], undefined)
  assert.equal(index.files["C:/new.txt"].length, 1)
  assert.deepEqual(cleanIndex({ files: { x: [{ id: 1 }], y: "nope" } }), emptyIndex())
  assert.deepEqual(cleanIndex(null), emptyIndex())
})

test("previews and copy names", () => {
  assert.equal(previewText("<p>Hi &amp; bye</p><p>Two</p>", "richtext"), "Hi & bye\nTwo")
  assert.match(copyName("Letter.txt", T0), /^Letter \(.+\)\.txt$/)
  assert.match(copyName("Notes", T0), /^Notes \(.+\)$/)
})

test("the store keeps, lists, reads, moves and erases through IndexedDB", async () => {
  const idb = createFakeIndexedDb()
  let now = T0
  const store = createVersionStore({ idb: () => idb, dbName: () => "98ish.versions", now: () => now })
  const v1 = await store.keep("C:/a.txt", "first", "text")
  now += 1000
  const v2 = await store.keep("C:/a.txt", "second", "text")
  assert.ok(v1 && v2)
  assert.equal(await store.keep("C:/a.txt", "second", "text"), null, "same as the newest")
  const list = await store.list("C:/a.txt")
  assert.deepEqual(
    list.map((v) => v.id),
    [v2.id, v1.id]
  )
  assert.equal(await store.read(v1.id), "first")
  await store.move("C:/a.txt", "C:/b.txt")
  assert.equal((await store.list("C:/b.txt")).length, 2)
  await store.flush()

  // a fresh instance (another page load) sees the same
  const again = createVersionStore({ idb: () => idb, dbName: () => "98ish.versions", now: () => now })
  assert.equal((await again.list("C:/b.txt")).length, 2)
  assert.equal(await again.read(v2.id), "second")
  // a week later they're gone on the first look, texts included
  const weekLater = createVersionStore({ idb: () => idb, dbName: () => "98ish.versions", now: () => T0 + 8 * DAY })
  assert.equal((await weekLater.list("C:/b.txt")).length, 0)
  await weekLater.flush()
  assert.equal(await weekLater.read(v1.id), null)
})

test("restore round trip: the current contents become a version too", async () => {
  const idb = createFakeIndexedDb()
  let now = T0
  const store = createVersionStore({ idb: () => idb, dbName: () => "v", now: () => (now += 1000) })
  // the file held "draft 1", then was saved as "draft 2"
  const kept = await store.keep("C:/doc.txt", "draft 1", "text")
  let current = "draft 2"
  // restore = what it holds now is kept, then the old text goes back (versions.js restoreVersion via writeAndSave)
  const old = await store.read(kept.id)
  await store.keep("C:/doc.txt", current, "text")
  current = old
  assert.equal(current, "draft 1")
  const list = await store.list("C:/doc.txt")
  assert.equal(list.length, 2)
  assert.equal(await store.read(list[0].id), "draft 2", "the restore can be undone")
})

test("each 98ish user has their own database; erase and a removed user's database", async () => {
  const idb = createFakeIndexedDb()
  let user = "98ish."
  const store = createVersionStore({ idb: () => idb, dbName: () => `${user}versions`, now: () => T0 })
  await store.keep("C:/a.txt", "mine", "text")
  await store.flush()
  user = "98ish.u.bob."
  assert.equal((await store.list("C:/a.txt")).length, 0, "bob doesn't see the first user's versions")
  await store.keep("C:/a.txt", "bob's", "text")
  await store.erase()
  await store.flush()
  assert.equal((await store.totals()).versions, 0)
  user = "98ish."
  assert.equal((await store.list("C:/a.txt")).length, 1, "erasing bob left the first user alone")
  assert.equal(store.dropDatabase("98ish.u.bob.versions"), true)
})

test("no IndexedDB: nothing is kept, nothing throws", async () => {
  const store = createVersionStore({ idb: () => null, dbName: () => "x" })
  assert.equal(await store.keep("C:/a.txt", "text", "text"), null)
  assert.deepEqual(await store.list("C:/a.txt"), [])
})
