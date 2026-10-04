const test = require("node:test")
const assert = require("node:assert/strict")
const express = require("express")
const { syncRouter, contentKey } = require("../sync")
const { memorySyncStore, encodeBlob, decodeBlob } = require("../syncStore")
const { memoryStore } = require("../store")

const TOKEN_A = "a".repeat(48)
const TOKEN_B = "b".repeat(48)

// A server with two signed-on 98 Messenger sessions (alice, bob); `clock` moves time
const start = async (options = {}) => {
  const sessions = new Map([
    ["alice", { key: "alice", token: TOKEN_A, user: { screenName: "Alice" } }],
    ["bob", { key: "bob", token: TOKEN_B, user: { screenName: "Bob" } }],
  ])
  const clock = { t: Date.parse("2026-10-03T12:00:00Z") }
  const store = memorySyncStore()
  const legacy = options.legacy || memoryStore()
  const app = express()
  app.use("/api/drive/sync", syncRouter({ aim: Promise.resolve({ sessions }), store, legacy, now: () => clock.t, ...options }))
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/drive/sync`
  const call = async (method, path, { token = TOKEN_A, body, text } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : text !== undefined ? { "Content-Type": "text/plain;charset=utf-8" } : {}),
      },
      body: body ? JSON.stringify(body) : text,
    })
    const type = response.headers.get("content-type") || ""
    return { status: response.status, body: type.includes("json") ? await response.json() : await response.text() }
  }
  const upload = (text, token = TOKEN_A) => call("PUT", `/blob/${contentKey(text)}`, { token, text })
  const push = (changes, token = TOKEN_A, device = "Test PC") => call("POST", "/push", { token, body: { device, changes } })
  const file = (path, text, baseRev = 0, extra = {}) => ({ path, kind: "f", type: "text", hash: contentKey(text), size: text.length, mtime: clock.t, baseRev, ...extra })
  return { sessions, clock, store, legacy, call, upload, push, file, close: () => server.close() }
}

const PHOTO = `data:image/jpeg;base64,${Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 37) % 256)).toString("base64")}`

test("contents are stored small and come back exactly", () => {
  const photo = encodeBlob(PHOTO)
  assert.equal(photo.enc, "b64")
  assert.equal(photo.size, 3000) // the JPEG's bytes, not the base64 text
  assert.equal(decodeBlob(photo), PHOTO)
  const text = "Dear diary, ".repeat(500)
  const z = encodeBlob(text)
  assert.equal(z.enc, "z")
  assert.ok(z.size < text.length / 5)
  assert.equal(decodeBlob(z), text)
  // odd ones are kept as they are
  for (const odd of ["short", "data:image/png;base64,abc", `data:image/png;base64,${"A".repeat(99)}=`, "naïve café ✓ 🙂".repeat(3)]) assert.equal(decodeBlob(encodeBlob(odd)), odd)
})

test("every request needs a signed-on session or a device sync token", async () => {
  const s = await start()
  try {
    assert.equal((await s.call("GET", "/state", { token: null })).status, 401)
    assert.equal((await s.call("GET", "/state", { token: "c".repeat(48) })).status, 401)
    assert.equal((await s.call("GET", "/state", { token: "c".repeat(64) })).status, 401)
    assert.equal((await s.call("GET", "/state", { token: "nope" })).status, 401)
    assert.equal((await s.call("POST", "/push", { token: null, body: { changes: [] } })).status, 401)
    assert.equal((await s.call("GET", "/blob/abc-1", { token: null })).status, 401)
    const state = await s.call("GET", "/state")
    assert.equal(state.status, 200)
    assert.deepEqual([state.body.seq, state.body.usage, state.body.files], [0, 0, 0])
    assert.equal(state.body.quota, 100 * 1024 * 1024)

    // a device token keeps working after the session ends (signed on somewhere else)
    const device = await s.call("POST", "/device", { body: { name: "iPhone" } })
    assert.equal(device.status, 200)
    assert.match(device.body.token, /^[0-9a-f]{64}$/)
    s.sessions.delete("alice")
    assert.equal((await s.call("GET", "/state")).status, 401)
    const viaDevice = await s.call("GET", "/state", { token: device.body.token })
    assert.equal(viaDevice.status, 200)
    // ...but can't make more device tokens
    assert.equal((await s.call("POST", "/device", { token: device.body.token, body: {} })).status, 403)
    // the store keeps only a hash of it
    assert.equal(await s.store.findDevice(device.body.token), null)
    // it expires after 60 days unused
    s.clock.t += 61 * 24 * 60 * 60_000
    assert.equal((await s.call("GET", "/state", { token: device.body.token })).status, 401)

    // forgetting a device ends it
    s.sessions.set("alice", { key: "alice", token: TOKEN_A, user: { screenName: "Alice" } })
    const again = await s.call("POST", "/device", { body: { name: "PC" } })
    assert.equal((await s.call("DELETE", "/device", { token: again.body.token })).status, 200)
    assert.equal((await s.call("GET", "/state", { token: again.body.token })).status, 401)
  } finally {
    s.close()
  }
})

test("pushes, pulls, revisions, conflicts and tombstones", async () => {
  const s = await start()
  try {
    // contents first: checked against their key
    assert.equal((await s.call("PUT", `/blob/${contentKey("other")}`, { text: "hello" })).status, 400)
    const up = await s.upload(PHOTO)
    assert.equal(up.status, 200, JSON.stringify(up.body))
    assert.equal(up.body.stored, true)
    assert.equal((await s.upload(PHOTO)).body.stored, false) // once per account
    const have = await s.call("POST", "/have", { body: { hashes: [contentKey(PHOTO), contentKey("nope"), "../bad"] } })
    assert.deepEqual(have.body.missing, [contentKey("nope")])

    // a change whose contents aren't uploaded is refused
    const missing = await s.push([s.file("C:/Documents/a", "never sent")])
    assert.equal(missing.body.results[0].missing, true)

    await s.upload("one")
    const first = await s.push([
      { path: "C:/My Pictures", kind: "d", type: "folder", baseRev: 0 },
      s.file("C:/My Pictures/PHOTO001.JPG", PHOTO, 0, { type: "image" }),
      s.file("C:/Documents/notes", "one"),
    ])
    assert.equal(first.status, 200)
    assert.deepEqual(first.body.results.map((r) => [r.ok, r.rev]), [[true, 1], [true, 2], [true, 3]])
    assert.equal(first.body.seq, 3)

    // another device pulls everything
    const pulled = await s.call("GET", "/changes?since=0")
    assert.equal(pulled.body.seq, 3)
    assert.equal(pulled.body.more, false)
    assert.deepEqual(pulled.body.entries.map((e) => e.path), ["C:/My Pictures", "C:/My Pictures/PHOTO001.JPG", "C:/Documents/notes"])
    const photo = pulled.body.entries[1]
    assert.equal(photo.device, "Test PC")
    const got = await s.call("GET", `/blob/${photo.hash}`)
    assert.equal(got.body, PHOTO)
    assert.equal((await s.call("GET", "/changes?since=3")).body.entries.length, 0)
    // paging
    const page = await s.call("GET", "/changes?since=0&limit=2")
    assert.deepEqual([page.body.entries.length, page.body.more, page.body.seq], [2, true, 2])

    // an edit based on the current revision is fine; one based on an old one is a conflict
    await s.upload("two")
    const edit = await s.push([s.file("C:/Documents/notes", "two", 3)])
    assert.equal(edit.body.results[0].rev, 4)
    await s.upload("three")
    const stale = await s.push([s.file("C:/Documents/notes", "three", 3)], TOKEN_A, "iPhone")
    assert.equal(stale.body.results[0].conflict, true)
    assert.equal(stale.body.results[0].current.rev, 4)
    assert.equal(stale.body.results[0].current.hash, contentKey("two"))
    // creating something that exists is a conflict too
    assert.equal((await s.push([s.file("C:/Documents/notes", "three", 0)])).body.results[0].conflict, true)

    // deleting leaves a tombstone; the photo's contents are freed
    const usageBefore = (await s.call("GET", "/state")).body.usage
    const gone = await s.push([{ path: "C:/My Pictures/PHOTO001.JPG", kind: "f", deleted: true, baseRev: 2 }])
    assert.equal(gone.body.results[0].rev, 5)
    const after = await s.call("GET", "/state")
    assert.equal(after.body.usage, usageBefore - 3000)
    assert.equal(after.body.files, 1)
    const tomb = (await s.call("GET", "/changes?since=4")).body.entries[0]
    assert.deepEqual([tomb.path, tomb.deleted, tomb.hash], ["C:/My Pictures/PHOTO001.JPG", true, null])
    assert.equal((await s.call("GET", `/blob/${contentKey(PHOTO)}`)).status, 404)
    // deleting again (or something never there) changes nothing
    assert.deepEqual((await s.push([{ path: "C:/My Pictures/PHOTO001.JPG", kind: "f", deleted: true, baseRev: 5 }])).body.results[0], { path: "C:/My Pictures/PHOTO001.JPG", ok: true, rev: 5 })
    // and it can come back
    await s.upload(PHOTO)
    assert.equal((await s.push([s.file("C:/My Pictures/PHOTO001.JPG", PHOTO, 5, { type: "image" })])).body.results[0].rev, 6)

    // accounts are separate
    assert.equal((await s.call("GET", "/changes?since=0", { token: TOKEN_B })).body.entries.length, 0)
    assert.equal((await s.call("GET", `/blob/${contentKey(PHOTO)}`, { token: TOKEN_B })).status, 404)

    // damaged changes are refused one by one
    const bad = await s.push([
      { path: "D:/x", kind: "f", hash: contentKey("one"), baseRev: 0 },
      { path: "C:/a/../b", kind: "f", hash: contentKey("one"), baseRev: 0 },
      { path: "C:/a:b", kind: "f", hash: contentKey("one"), baseRev: 0 },
      { path: "C:/ok", kind: "x", baseRev: 0 },
      { path: "C:/ok", kind: "f", hash: "nope", baseRev: 0 },
      { path: "C:/ok", kind: "f", hash: contentKey("one"), type: "Bad!", baseRev: 0 },
      { path: "C:/ok", kind: "f", hash: contentKey("one") },
    ])
    assert.ok(bad.body.results.every((r) => r.ok === false && r.error), JSON.stringify(bad.body.results))
    assert.equal((await s.call("POST", "/push", { body: { changes: "all" } })).status, 400)
    assert.equal((await s.call("POST", "/push", { body: { changes: Array.from({ length: 201 }, () => ({})) } })).status, 400)
  } finally {
    s.close()
  }
})

test("all accounts together stop at the server's total (MongoDB's free tier is 512 MB in all)", async () => {
  const s = await start({ quotaBytes: 10_000, totalBytes: 5000 })
  const photo = (seed) => `data:image/jpeg;base64,${Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * seed) % 256)).toString("base64")}`
  try {
    assert.equal((await s.upload(photo(7))).status, 200) // alice: 3000 bytes
    const bob = await s.upload(photo(11), TOKEN_B) // 6000 in all: over the server's 5000
    assert.equal(bob.status, 413)
    assert.equal(bob.body.full, true)
    assert.match(bob.body.error, /online storage is full/)
    assert.equal((await s.call("GET", "/state", { token: TOKEN_B })).body.usage, 0)
  } finally {
    s.close()
  }
})

test("quota and file size limits", async () => {
  const s = await start({ quotaBytes: 5000, maxFileChars: 6000 })
  try {
    const photo = await s.upload(PHOTO) // 3000 bytes stored
    assert.equal(photo.status, 200)
    const big = `data:image/jpeg;base64,${Buffer.alloc(2500, 7).toString("base64")}`
    const full = await s.upload(big)
    assert.equal(full.status, 413)
    assert.equal(full.body.full, true)
    assert.match(full.body.error, /full/)
    const tooBig = await s.upload("x".repeat(7000))
    assert.equal(tooBig.status, 413)
    assert.equal(tooBig.body.ok, false)
    // way too big for the body parser: still JSON
    const huge = await s.call("PUT", `/blob/${contentKey("y".repeat(20_000))}`, { text: "y".repeat(20_000) })
    assert.equal(huge.status, 413)
    assert.equal(huge.body.ok, false)
  } finally {
    s.close()
  }
})

test("a cap on how many files and folders an account can sync", async () => {
  const s = await start({ maxEntries: 3 })
  try {
    await s.upload("x")
    const r = await s.push(["a", "b", "c", "d"].map((n) => s.file(`C:/Documents/${n}`, "x")))
    assert.deepEqual(r.body.results.map((x) => x.ok), [true, true, true, false])
    assert.match(r.body.results[3].error, /too many/)
    // changing what's there still works
    assert.equal((await s.push([s.file("C:/Documents/a", "x", 1, { type: "note" })])).body.results[0].ok, true)
    const blob = await s.call("GET", `/blob/${contentKey("x")}`)
    assert.equal(blob.body, "x")
  } finally {
    s.close()
  }
})

test("unused contents are swept after a day", async () => {
  const s = await start()
  try {
    await s.upload(PHOTO) // never pushed (the device went away)
    await s.upload("kept")
    await s.push([s.file("C:/Documents/kept", "kept")])
    assert.equal((await s.call("GET", "/state")).body.usage > 3000, true)
    s.clock.t += 25 * 60 * 60_000
    await s.upload("later")
    await s.push([s.file("C:/Documents/later", "later")])
    const state = await s.call("GET", "/state")
    assert.equal(state.body.usage, encodeBlob("kept").size + encodeBlob("later").size)
    assert.equal((await s.call("GET", `/blob/${contentKey("kept")}`)).body, "kept")
  } finally {
    s.close()
  }
})

test("an old whole-drive online copy becomes synced files", async () => {
  const legacy = memoryStore()
  const snapshot = {
    drive: {
      root: [
        {
          k: "d",
          n: "C:",
          t: "drive",
          c: [
            { k: "d", n: "Documents", t: "documents", c: [{ k: "f", n: "letter", t: "text", x: "Hi!" }] },
            { k: "d", n: "My Pictures", t: "folder", c: [{ k: "f", n: "PHOTO001.JPG", t: "image", x: PHOTO }] },
            { k: "d", n: "Programs", t: "programs", c: [{ k: "f", n: "Tetris", t: "tetris", x: "" }] },
          ],
        },
      ],
      bin: [],
    },
    achievements: { unlocked: { bsod: 1700000000000 }, progress: {} },
  }
  await legacy.put("alice", { data: JSON.stringify(snapshot), size: 100 }, 0)
  const s = await start({ legacy })
  try {
    const changes = await s.call("GET", "/changes?since=0")
    assert.deepEqual(
      changes.body.entries.map((e) => e.path),
      ["C:/Documents", "C:/Documents/letter", "C:/My Pictures", "C:/My Pictures/PHOTO001.JPG"]
    )
    assert.equal((await s.call("GET", `/blob/${contentKey(PHOTO)}`)).body, PHOTO)
    assert.deepEqual((await s.call("GET", "/achievements")).body.achievements.unlocked, { bsod: 1700000000000 })
    // only once
    assert.equal((await s.call("GET", "/changes?since=0")).body.entries.length, 4)

    // achievements merge (earliest time wins, steps add up)
    const merged = await s.call("PUT", "/achievements", { body: { achievements: { unlocked: { bsod: 1600000000000, xyzzy: 5 }, progress: { paint: ["pencil"] } } } })
    assert.deepEqual(merged.body.achievements.unlocked, { bsod: 1600000000000, xyzzy: 5 })
    assert.equal((await s.call("PUT", "/achievements", { body: { achievements: { unlocked: { "<b>": 1 } } } })).status, 400)

    // deleting everything forgets the old copy too, and starts empty
    assert.equal((await s.call("DELETE", "/")).status, 200)
    assert.equal(await legacy.get("alice"), null)
    const state = await s.call("GET", "/state")
    assert.deepEqual([state.body.seq, state.body.usage, state.body.files], [0, 0, 0])
    assert.equal((await s.call("GET", "/changes?since=0")).body.entries.length, 0)
  } finally {
    s.close()
  }
})

test("rate limits per account and bad tokens per IP", async () => {
  const s = await start({ limits: { reads: 3, writes: 2, badTokens: 3, uploadBytes: 50 } })
  try {
    for (let i = 0; i < 3; i++) assert.equal((await s.call("GET", "/state")).status, 200)
    assert.equal((await s.call("GET", "/state")).status, 429)
    assert.equal((await s.call("GET", "/state", { token: TOKEN_B })).status, 200)
    assert.equal((await s.upload("x".repeat(40), TOKEN_B)).status, 200)
    assert.equal((await s.upload("y".repeat(40), TOKEN_B)).status, 429) // too many bytes at once
    for (let i = 0; i < 3; i++) assert.equal((await s.call("GET", "/state", { token: "e".repeat(48) })).status, 401)
    assert.equal((await s.call("GET", "/state", { token: "e".repeat(48) })).status, 429)
  } finally {
    s.close()
  }
})
