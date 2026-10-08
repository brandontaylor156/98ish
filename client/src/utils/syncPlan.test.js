// node --test client/src/utils/syncPlan.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as P from "./syncPlan.js"

// a little drive tree with the shape scanLocal reads
const dir = (name, type, children = []) => ({ name, type, isDirectory: true, content: children })
const file = (name, hash, type = "text") => ({ name, type, isDirectory: false, contentHash: hash, size: 10, mtime: 1 })

const drive = () =>
  dir("C:", "drive", [
    dir("Documents", "documents", [file("notes", "h1"), dir("Trip", "folder", [file("beach", "h2")])]),
    dir("My Pictures", "folder", [file("PHOTO001.JPG", "p1", "image")]),
    dir("Desktop", "desktop", []),
    dir("Programs", "programs", [file("Paint", "x", "paint")]),
    dir("Games", "folder", [file("save", "g1")]),
  ])

const FOLDERS = P.DEFAULT_FOLDERS

test("scanLocal sees only the synced folders", () => {
  const local = P.scanLocal(drive(), FOLDERS)
  assert.deepEqual([...local.keys()], ["C:/Documents", "C:/Documents/notes", "C:/Documents/Trip", "C:/Documents/Trip/beach", "C:/My Pictures", "C:/My Pictures/PHOTO001.JPG", "C:/Desktop"])
  assert.equal(local.get("C:/Documents").type, "documents")
  assert.equal(local.get("C:/My Pictures/PHOTO001.JPG").hash, "p1")
  assert.ok(P.inScope("C:/Documents/x", FOLDERS))
  assert.ok(!P.inScope("C:/Documents2/x", FOLDERS))
  assert.ok(!P.inScope("C:/Programs/Paint", FOLDERS))
})

test("planPush: new and changed things go up, folders first; deletes last, deepest first", () => {
  const local = P.scanLocal(drive(), FOLDERS)
  const base = {
    "C:/Documents": { rev: 1, kind: "d", type: "documents" },
    "C:/Documents/notes": { rev: 2, kind: "f", type: "text", hash: "h0" }, // changed here
    "C:/My Pictures": { rev: 3, kind: "d", type: "folder" },
    "C:/My Pictures/PHOTO001.JPG": { rev: 4, kind: "f", type: "image", hash: "p1" }, // same
    "C:/Desktop": { rev: 5, kind: "d", type: "desktop" },
    "C:/Desktop/Old": { rev: 6, kind: "d", type: "folder" }, // deleted here
    "C:/Desktop/Old/a": { rev: 7, kind: "f", type: "text", hash: "a" }, // deleted here
    "C:/Desktop/gone": { rev: 8, kind: "f", type: "text", hash: "z", deleted: true }, // already a tombstone
    "C:/Games/save": { rev: 9, kind: "f", type: "text", hash: "g0" }, // not synced here: left alone
  }
  const plan = P.planPush(local, base, FOLDERS)
  assert.deepEqual(
    plan.map((c) => [c.path, c.deleted ? "del" : "up", c.baseRev]),
    [
      ["C:/Documents/notes", "up", 2],
      ["C:/Documents/Trip", "up", 0],
      ["C:/Documents/Trip/beach", "up", 0],
      ["C:/Desktop/Old/a", "del", 7],
      ["C:/Desktop/Old", "del", 6],
    ]
  )
  assert.equal(plan[0].hash, "h1")
  // nothing changed: nothing to send
  const synced = Object.fromEntries([...local].map(([path, l]) => [path, { rev: 1, kind: l.kind, type: l.type, hash: l.hash }]))
  assert.deepEqual(P.planPush(local, synced, FOLDERS), [])
})

test("decide: every case of here vs there", () => {
  const base = { rev: 3, kind: "f", type: "text", hash: "A" }
  const here = (hash) => ({ kind: "f", type: "text", hash })
  const there = (hash, extra = {}) => ({ path: "C:/Documents/x", kind: "f", type: "text", hash, rev: 4, ...extra })
  const gone = { path: "C:/Documents/x", kind: "f", rev: 4, deleted: true, hash: null }
  // only there changed
  assert.equal(P.decide(there("B"), here("A"), base), "take")
  // both made the same change
  assert.equal(P.decide(there("B"), here("B"), base), "same")
  // both changed, differently: keep both
  assert.equal(P.decide(there("B"), here("C"), base), "keepBoth")
  // only here changed, and there's a newer revision of... the same content? (a rename back)
  assert.equal(P.decide(there("A"), here("A"), base), "same")
  // new there, not here
  assert.equal(P.decide(there("B"), null, undefined), "take")
  // new in both places (first sync of two devices): different -> keep both, same -> same
  assert.equal(P.decide(there("B"), here("C"), undefined), "keepBoth")
  assert.equal(P.decide(there("B"), here("B"), undefined), "same")
  // deleted there: recycle ours if we didn't touch it, keep ours if we did
  assert.equal(P.decide(gone, here("A"), base), "take")
  assert.equal(P.decide(gone, here("C"), base), "keepOurs")
  assert.equal(P.decide(gone, null, base), "ignore")
  // deleted here, changed there: theirs comes back
  assert.equal(P.decide(there("B"), null, base), "take")
  // came back after a delete we already know about
  assert.equal(P.decide(there("B"), null, { ...base, deleted: true }), "take")
  // folders
  const folder = { path: "C:/Documents/F", kind: "d", type: "folder", rev: 9 }
  assert.equal(P.decide(folder, { kind: "d", type: "folder" }, undefined), "same")
  assert.equal(P.decide({ ...folder, deleted: true }, { kind: "d", type: "folder" }, { rev: 2, kind: "d", type: "folder" }), "take")
  // a file there where we have a new folder of that name: keep both
  assert.equal(P.decide(there("B"), { kind: "d", type: "folder" }, undefined), "keepBoth")
  // the type changed there (a text file became a picture with the same bytes)
  assert.equal(P.decide(there("A", { type: "image" }), here("A"), base), "take")
})

test("conflict names keep the extension and never clash", () => {
  assert.equal(P.conflictName("photo.jpg", "iPhone"), "photo (from iPhone).jpg")
  assert.equal(P.conflictName("PHOTO001.JPG", "Windows PC"), "PHOTO001 (from Windows PC).JPG")
  assert.equal(P.conflictName("Shopping list", "iPhone"), "Shopping list (from iPhone)")
  assert.equal(P.conflictName("v1.2 notes about stuff", "iPhone"), "v1.2 notes about stuff (from iPhone)")
  const taken = new Set(["photo (from iPhone).jpg", "photo (from iPhone) 2.jpg"])
  assert.equal(P.conflictName("photo.jpg", "iPhone", (n) => taken.has(n)), "photo (from iPhone) 3.jpg")
  const long = P.conflictName("x".repeat(64), "Android tablet")
  assert.ok(long.length <= 64, long)
})

test("device names", () => {
  assert.equal(P.deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "iPhone")
  assert.equal(P.deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Mobile/15E148"), "iPad")
  assert.equal(P.deviceName("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile"), "Android phone")
  assert.equal(P.deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140"), "Windows PC")
  assert.equal(P.deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari"), "Mac")
  assert.equal(P.deviceName(""), "another computer")
})

test("staysOnDevice: big media kept on this device and over-long texts never go online", () => {
  assert.equal(P.staysOnDevice({ isDirectory: false, deviceOnly: true, textLength: 60 }), true)
  assert.equal(P.staysOnDevice({ isDirectory: false, deviceOnly: false, textLength: 13_000_000 }, 12 * 1024 * 1024), true)
  assert.equal(P.staysOnDevice({ isDirectory: false, deviceOnly: false, textLength: 9_000_000 }, 12 * 1024 * 1024), false)
  assert.equal(P.staysOnDevice({ isDirectory: true, deviceOnly: false }), false)
  assert.equal(P.staysOnDevice(null), false)
})
