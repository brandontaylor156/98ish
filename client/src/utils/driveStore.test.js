// node --test client/src/utils/driveStore.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as S from "./driveStore.js"
import { createFakeIndexedDb, createFakeStorage } from "./fakeIndexedDb.js"

// a picture-like data URL of about `kb` kilobytes (different per seed)
const picture = (kb, seed = 1, mime = "image/jpeg") => {
  const bytes = Buffer.alloc(kb * 1024)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + seed * 7) % 251
  return `data:${mime};base64,${bytes.toString("base64")}`
}

// A realistic drive as the old 98ish saved it in localStorage
const oldDrive = () => {
  const photos = Array.from({ length: 6 }, (_, i) => ({ k: "f", n: `PHOTO${String(i + 1).padStart(3, "0")}.JPG`, t: "image", x: picture(170, i), m: {} }))
  return {
    root: [
      {
        k: "d",
        n: "C:",
        t: "drive",
        m: {},
        c: [
          {
            k: "d",
            n: "Documents",
            t: "documents",
            m: {},
            c: [
              { k: "f", n: "Shopping list", t: "text", x: "milk\r\neggs\r\nbread", m: {} },
              { k: "f", n: "Welcome to WordPad", t: "richtext", x: "<p><b>Hello</b> 🙂 naïve</p>", m: {} },
              { k: "f", n: "Long story", t: "text", x: "Once upon a time. ".repeat(900), m: {} },
              { k: "f", n: "My Painting", t: "image", x: picture(40, 99, "image/png"), m: {} },
              { k: "f", n: "Hello", t: "sound", x: `data:audio/wav;base64,${Buffer.alloc(30_000, 3).toString("base64")}`, m: {} },
              { k: "d", n: "Empty Folder", t: "folder", m: {}, c: [] },
              { k: "d", n: "Trip", t: "folder", m: {}, c: [{ k: "f", n: "notes", t: "note", x: "beach", m: {} }] },
            ],
          },
          { k: "d", n: "My Pictures", t: "folder", m: {}, c: [...photos, { ...photos[0], n: "PHOTO001 copy.JPG" }] },
          { k: "d", n: "Desktop", t: "desktop", m: {}, c: [{ k: "f", n: "Shortcut to Trip", t: "shortcut", x: "C:\\Documents\\Trip", m: {} }] },
          { k: "d", n: "Programs", t: "programs", m: {}, c: [{ k: "f", n: "Paint", t: "paint", x: "", m: {} }] },
        ],
      },
    ],
    bin: [
      { k: "f", n: "old photo", t: "image", x: picture(120, 42), m: { deletedFrom: "C:\\My Pictures", deletedAt: 1700000000000, originalName: "old photo" } },
      { k: "d", n: "Old Folder", t: "folder", m: { deletedFrom: "C:\\Documents", deletedAt: 1700000000001, originalName: "Old Folder" }, c: [{ k: "f", n: "a", t: "text", x: "a", m: {} }] },
    ],
    defaults: ["C:", "C:/Documents"],
  }
}

const withOld = (drive = oldDrive(), opts) => createFakeStorage({ [S.OLD_KEY]: JSON.stringify(drive), "98ish.settings": "{}" }, opts)

test("hashes, content keys and byte sizes", () => {
  assert.equal(S.hashText("hello"), S.hashText("hello"))
  assert.notEqual(S.hashText("hello"), S.hashText("hellp"))
  assert.match(S.contentKey("hello"), /^[0-9a-z]+-5$/)
  assert.equal(S.byteSize("abc"), 3)
  assert.equal(S.byteSize("é"), 2)
  assert.equal(S.byteSize("🙂"), 4)
  assert.equal(S.byteSize(`data:image/png;base64,${Buffer.alloc(1000).toString("base64")}`), 1000)
  assert.equal(S.byteSize(`data:image/png;base64,${Buffer.alloc(1001).toString("base64")}`), 1001)
  assert.ok(S.isQuotaError(new DOMException("x", "QuotaExceededError")))
  assert.ok(!S.isQuotaError(new Error("nope")))
})

test("opening: works, and says no when IndexedDB is off, broken or silent", async () => {
  const ok = await S.openDriveDb(createFakeIndexedDb())
  assert.ok(ok)
  assert.equal(await ok.getIndex(), null)
  assert.equal(await S.openDriveDb(null), null)
  assert.equal(await S.openDriveDb(createFakeIndexedDb({ failOpen: true })), null)
  assert.equal(await S.openDriveDb(createFakeIndexedDb({ failWrites: true })), null) // private windows that refuse writes
  assert.equal(await S.openDriveDb(createFakeIndexedDb({ hang: true }), { timeoutMs: 50 }), null)
})

test("commits are all or nothing", async () => {
  const idb = createFakeIndexedDb({ quotaChars: 1000 })
  const db = await S.openDriveDb(idb)
  await db.commit({ index: { root: [] }, puts: [["a", "x".repeat(400)]] })
  await assert.rejects(db.commit({ index: { root: [1] }, puts: [["b", "y".repeat(800)]] }), (e) => S.isQuotaError(e))
  assert.deepEqual(await db.getIndex(), { root: [] }) // unchanged
  assert.equal(await db.getContent("b"), undefined)
  await db.commit({ deletes: ["a"], puts: [["b", "y".repeat(800)]] }) // room once "a" goes
  assert.deepEqual((await db.contentKeys()).sort(), ["b"])
})

test("migration moves every file, checks it, and keeps the old copy", async () => {
  const idb = createFakeIndexedDb()
  const storage = withOld()
  const db = await S.openDriveDb(idb)
  const result = await S.migrateFromLocal({ db, storage, now: 1_800_000_000_000 })
  assert.equal(result.ok, true, result.error)
  const original = oldDrive()
  const counted = S.measureNodes([...original.root, ...original.bin])
  assert.deepEqual([result.files, result.folders], [counted.files, counted.folders])
  assert.equal(result.files, 17)

  // big texts went to "contents" (two identical photos share one), small ones stay inline
  const index = await db.getIndex()
  const docs = index.root[0].c[0].c
  assert.equal(docs.find((n) => n.n === "Shopping list").x, "milk\r\neggs\r\nbread")
  const painting = docs.find((n) => n.n === "My Painting")
  assert.ok(painting.h && painting.x === undefined)
  assert.equal(painting.hd.slice(0, 22), "data:image/png;base64,")
  assert.equal(painting.s, 40 * 1024)
  const keys = await db.contentKeys()
  assert.equal(keys.length, 6 /* photos */ + 1 /* painting */ + 1 /* sound */ + 1 /* long story */ + 1 /* binned photo */)

  // everything reads back exactly as it was, Recycle Bin and its "deleted from" notes included
  const join = async (nodes) =>
    Promise.all(
      nodes.map(async (n) => (n.k === "d" ? { k: "d", n: n.n, t: n.t, m: n.m, c: await join(n.c) } : { k: "f", n: n.n, t: n.t, x: n.x ?? (await db.getContent(n.h)), m: n.m }))
    )
  assert.deepEqual(await join(index.root), original.root)
  assert.deepEqual(await join(index.bin), original.bin)
  assert.deepEqual(index.defaults, original.defaults)

  // marked as moved; the old copy is still there
  assert.equal(JSON.parse(storage.getItem(S.MIGRATED_KEY)).files, 17)
  assert.equal(storage.getItem(S.OLD_KEY), JSON.stringify(original))
  assert.equal((await db.getMeta("migration")).files, 17)
})

test("a failed migration changes nothing and can be tried again", async () => {
  const original = JSON.stringify(oldDrive())
  // not enough room
  const small = createFakeIndexedDb({ quotaChars: 200_000 })
  const storage = withOld()
  const db = await S.openDriveDb(small)
  const full = await S.migrateFromLocal({ db, storage })
  assert.equal(full.ok, false)
  assert.match(full.error, /room/)
  assert.equal(await db.getIndex(), null)
  assert.equal((await db.contentKeys()).length, 0)
  assert.equal(storage.getItem(S.OLD_KEY), original)
  assert.equal(storage.getItem(S.MIGRATED_KEY), null)
  // more room next time: it works
  small.control.quotaChars = Infinity
  assert.equal((await S.migrateFromLocal({ db, storage })).ok, true)

  // contents that don't read back the same: undone
  const idb = createFakeIndexedDb()
  const db2 = await S.openDriveDb(idb)
  const realGet = db2.getContent
  db2.getContent = async (key) => ((await realGet(key)) || "").slice(0, -1)
  const bad = await S.migrateFromLocal({ db: db2, storage: withOld() })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /didn't copy correctly/)
  db2.getContent = realGet
  assert.equal(await db2.getIndex(), null)
  assert.equal((await db2.contentKeys()).length, 0)

  // a damaged old drive is left alone
  const broken = createFakeStorage({ [S.OLD_KEY]: "{not json" })
  const db3 = await S.openDriveDb(createFakeIndexedDb())
  const damaged = await S.migrateFromLocal({ db: db3, storage: broken })
  assert.equal(damaged.ok, false)
  assert.equal(broken.getItem(S.OLD_KEY), "{not json")
  assert.equal(await db3.getIndex(), null)

  // nothing to move
  assert.deepEqual(await S.migrateFromLocal({ db: db3, storage: createFakeStorage() }), { ok: false, none: true })
})

test("a full localStorage can't stop the move (the record lives in IndexedDB too)", async () => {
  const text = JSON.stringify(oldDrive())
  const storage = createFakeStorage({ [S.OLD_KEY]: text }, { quotaChars: text.length + S.OLD_KEY.length + 5 })
  const db = await S.openDriveDb(createFakeIndexedDb())
  const result = await S.migrateFromLocal({ db, storage, now: 5 })
  assert.equal(result.ok, true)
  assert.equal(storage.getItem(S.MIGRATED_KEY), null)
  assert.equal((await db.getMeta("migration")).at, 5)
})

test("the old copy is removed only after a few days", () => {
  const storage = withOld()
  const at = 1_800_000_000_000
  assert.equal(S.retireOldDrive(storage, { at }, at + S.RETAIN_MS - 1), false)
  assert.notEqual(storage.getItem(S.OLD_KEY), null)
  assert.equal(S.retireOldDrive(storage, null, at), false) // no record of a move: never
  assert.equal(S.retireOldDrive(storage, { at }, at + S.RETAIN_MS + 1), true)
  assert.equal(storage.getItem(S.OLD_KEY), null)
})

test("compareDrives notices every kind of difference", async () => {
  const drive = oldDrive()
  const contents = new Map()
  const stored = { root: S.splitNodes(drive.root, contents), bin: S.splitNodes(drive.bin, contents) }
  const get = async (k) => contents.get(k)
  assert.equal(await S.compareDrives(drive, stored, get), null)
  const missing = structuredClone(stored)
  missing.root[0].c[0].c.pop()
  assert.match(await S.compareDrives(drive, missing, get), /items instead of/)
  const renamed = structuredClone(stored)
  renamed.root[0].c[0].c[0].n = "Shopping List"
  assert.match(await S.compareDrives(drive, renamed, get), /didn't copy/)
  const edited = structuredClone(stored)
  edited.root[0].c[0].c[0].x = "milk"
  assert.match(await S.compareDrives(drive, edited, get), /contents/)
})

// ---- wave 2: big media kept as Blobs in the drive ----

test("a version 1 drive gains the blobs store; Blobs go in, come out, and go when nothing points at them", async () => {
  const factory = createFakeIndexedDb()
  // an old drive database (version 1: meta + contents only)
  await new Promise((resolve) => {
    const r = factory.open("98ish-drive", 1)
    r.onupgradeneeded = () => {
      r.result.createObjectStore("meta")
      r.result.createObjectStore("contents")
    }
    r.onsuccess = resolve
  })
  const db = await S.openDriveDb(factory)
  assert.ok(db, "opens at version 2")
  const video = new Blob([new Uint8Array(3 * 1024 * 1024).fill(9)], { type: "video/mp4" })
  await db.putBlob("mvideo1", video)
  await db.putBlob("mvideo2", new Blob(["x"], { type: "application/pdf" }))
  const back = await db.getBlob("mvideo1")
  assert.ok(back instanceof Blob)
  assert.equal(back.size, video.size)
  assert.equal(back.type, "video/mp4")
  assert.deepEqual((await db.blobKeys()).sort(), ["mvideo1", "mvideo2"])
  // a save that leaves mvideo2 unreferenced deletes it in the same transaction
  const index = { version: 2, root: [{ k: "d", n: "C:", t: "drive", m: {}, c: [{ k: "f", n: "Trip.mov", t: "movie", m: {}, x: S.mediaRef({ key: "mvideo1", mime: "video/mp4", size: video.size }) }] }], bin: [] }
  const used = S.mediaKeysIn(index.root)
  assert.deepEqual([...used], ["mvideo1"])
  const gone = S.blobsToDelete(new Set(await db.blobKeys()), used)
  assert.deepEqual(gone, ["mvideo2"])
  await db.commit({ index, blobDeletes: gone })
  assert.deepEqual(await db.blobKeys(), ["mvideo1"])
  // a full drive refuses a big Blob
  const tiny = createFakeIndexedDb({ quotaChars: 1024 })
  const small = await S.openDriveDb(tiny)
  tiny.control.quotaChars = 1024
  await assert.rejects(small.putBlob("mbig", new Blob([new Uint8Array(4096)])))
})

test("blobsToDelete keeps fresh and Recycle Bin blobs", () => {
  const stored = new Set(["a", "b", "c", "d"])
  const used = S.mediaKeysIn([{ k: "f", x: S.mediaRef({ key: "bbbb", size: 1 }) }], S.mediaKeysIn([{ k: "d", c: [{ k: "f", x: S.mediaRef({ key: "aaaa", size: 1 }) }] }]))
  assert.deepEqual([...used].sort(), ["aaaa", "bbbb"])
  const keys = new Set(["aaaa", "bbbb", "cccc", "dddd"])
  // cccc was just stored (its file is being made): kept for MEDIA_HOLD_MS
  const fresh = new Map([["cccc", 1000]])
  assert.deepEqual(S.blobsToDelete(keys, used, fresh, 1000 + 60_000), ["dddd"])
  assert.deepEqual(S.blobsToDelete(keys, used, fresh, 1000 + S.MEDIA_HOLD_MS + 1), ["cccc", "dddd"])
  assert.equal(stored.size, 4)
})
