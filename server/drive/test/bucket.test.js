// File sync with an online storage bucket: the real @vercel/blob SDK against a fake Vercel
// Blob (fakeBlob.js), and the S3 signer against AWS's published Signature V4 examples.
const test = require("node:test")
const assert = require("node:assert/strict")
const express = require("express")
const { syncRouter, contentKey } = require("../sync")
const { memorySyncStore, encodeBlob } = require("../syncStore")
const { memoryStore } = require("../store")
const { vercelAdapter, dayOf } = require("../bucket")
const { presignUrl, signHeaders } = require("../s3")
const { startFakeBlob } = require("./fakeBlob")

const TOKEN_A = "a".repeat(48)
const TOKEN_B = "b".repeat(48)
const RW = "vercel_blob_rw_teststore_secret123"
const DAY = 24 * 60 * 60_000
const quiet = { log() {}, warn() {}, error() {} }

const photo = (seed, length = 3000) => `data:image/jpeg;base64,${Buffer.from(Array.from({ length }, (_, i) => (i * seed + 11) % 256)).toString("base64")}`
const PHOTO = photo(37)
const DIARY = "Dear diary, today was a good day. ".repeat(300)

// how a device sends contents to the bucket (as client/src/utils/driveSync.js does)
const pack = (text) => {
  const m = text.length > 64 && /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(text)
  return m ? { enc: "b64", mime: m[1], bytes: Buffer.from(m[2], "base64") } : { enc: "t", mime: "", bytes: Buffer.from(text, "utf8") }
}
const unpack = (bytes, enc, mime) => (enc === "b64" ? `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` : Buffer.from(bytes).toString("utf8"))

let fake
test.before(async () => {
  fake = await startFakeBlob({ token: RW })
  process.env.VERCEL_BLOB_API_URL = fake.apiUrl
  process.env.VERCEL_BLOB_RETRIES = "0"
})
test.after(() => fake.close())
test.beforeEach(() => {
  fake.objects.clear()
  fake.state.suspended = false
  for (const k of Object.keys(fake.counts)) fake.counts[k] = 0
})

// a server whose contents go to the fake bucket; `budgets` replaces the free budgets
const start = async ({ budgets, store = memorySyncStore(), clock = { t: Date.now() }, ...options } = {}) => {
  const sessions = new Map([
    ["alice", { key: "alice", token: TOKEN_A, user: { screenName: "Alice" } }],
    ["bob", { key: "bob", token: TOKEN_B, user: { screenName: "Bob" } }],
  ])
  const adapter = vercelAdapter({ token: RW, env: { BLOB_STORE_URL: fake.storeUrl }, maxBytes: 40 * 1024 * 1024 })
  if (budgets) adapter.budgets = () => budgets
  const router = syncRouter({ aim: Promise.resolve({ sessions }), store, legacy: memoryStore(), now: () => clock.t, bucket: options.noBucket ? null : adapter, background: false, log: quiet, ...options })
  const app = express()
  app.use("/api/drive/sync", router)
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/drive/sync`
  const call = async (method, path, { token = TOKEN_A, body, text } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : text !== undefined ? { "Content-Type": "text/plain;charset=utf-8" } : {}) },
      body: body ? JSON.stringify(body) : text,
    })
    const type = response.headers.get("content-type") || ""
    return { status: response.status, body: type.includes("json") ? await response.json() : await response.text() }
  }
  // the direct way: /upload, PUT to the signed URL, /commit
  const send = async (text, token = TOKEN_A, { bytes } = {}) => {
    const p = pack(text)
    const ticket = await call("POST", "/upload", { token, body: { hash: contentKey(text), size: p.bytes.length, enc: p.enc, mime: p.mime } })
    if (ticket.status !== 200 || !ticket.body.url) return { ticket }
    const put = await fetch(ticket.body.url, { method: ticket.body.method, headers: ticket.body.headers, body: bytes || p.bytes })
    const commit = await call("POST", "/commit", { token, body: { hash: contentKey(text) } })
    return { ticket, put, commit }
  }
  const fetchBack = async (hash, token = TOKEN_A) => {
    const r = await call("POST", "/urls", { token, body: { hashes: [hash] } })
    const t = r.body.urls?.[hash]
    if (!t) return { r }
    const got = await fetch(t.url)
    return { r, text: unpack(Buffer.from(await got.arrayBuffer()), t.enc, t.mime) }
  }
  const push = (changes, token = TOKEN_A) => call("POST", "/push", { token, body: { device: "Test PC", changes } })
  const file = (path, text, baseRev = 0) => ({ path, kind: "f", type: "text", hash: contentKey(text), size: text.length, mtime: 1, baseRev })
  return { router, store, clock, call, send, fetchBack, push, file, close: () => server.close() }
}

test("with a bucket: uploads and downloads go straight to it with signed URLs, MongoDB keeps only records", async () => {
  const s = await start()
  try {
    const state = await s.call("GET", "/state")
    assert.equal(state.body.direct, true)
    assert.equal(state.body.quota, 300 * 1024 * 1024) // the per-account default with a bucket

    const up = await s.send(PHOTO)
    assert.equal(up.ticket.status, 200, JSON.stringify(up.ticket.body))
    assert.equal(up.put.status, 200)
    assert.equal(up.commit.body.stored, true)
    assert.equal(up.commit.body.usage, 3000) // the JPEG's bytes
    assert.equal(fake.counts.presignedPut, 1)
    const rec = await s.store.getBlob("alice", contentKey(PHOTO))
    assert.equal(rec.store, "bucket")
    assert.equal(rec.data, undefined) // nothing in MongoDB
    assert.match(rec.path, /^u\/[0-9a-f]{24}\/[0-9a-z]+-[0-9a-z]+$/)
    assert.ok(!rec.path.includes("alice")) // object names don't carry the account
    assert.equal(fake.objects.get(rec.path).body.length, 3000)

    // once there, asking again needs no upload
    const again = await s.call("POST", "/upload", { body: { hash: contentKey(PHOTO), size: 3000, enc: "b64", mime: "image/jpeg" } })
    assert.deepEqual([again.body.stored, again.body.url], [false, undefined])

    assert.equal((await s.push([s.file("C:/My Pictures/PHOTO001.JPG", PHOTO)])).body.results[0].ok, true)
    const back = await s.fetchBack(contentKey(PHOTO))
    assert.equal(back.text, PHOTO)
    assert.equal(fake.counts.presignedGet, 1)

    // only the account's own contents
    const bobs = await s.call("POST", "/urls", { token: TOKEN_B, body: { hashes: [contentKey(PHOTO)] } })
    assert.deepEqual([Object.keys(bobs.body.urls).length, bobs.body.missing], [0, [contentKey(PHOTO)]])
    // a download URL can't be bent to another object
    const t = (await s.call("POST", "/urls", { body: { hashes: [contentKey(PHOTO)] } })).body.urls[contentKey(PHOTO)]
    const bent = t.url.replace(/\/store\/u\/[0-9a-f]+\//, "/store/u/000000000000000000000000/")
    fake.objects.set(bent.split("/store/")[1].split("?")[0], { body: Buffer.from("x"), type: "x", at: 0, etag: "" })
    assert.equal((await fetch(bent)).status, 403)

    // text goes as plain UTF-8
    const diary = await s.send(DIARY)
    assert.equal(diary.commit.body.stored, true)
    assert.equal((await s.fetchBack(contentKey(DIARY))).text, DIARY)

    // the old routes still work (older cached clients): the server talks to the bucket
    assert.equal((await s.call("GET", `/blob/${contentKey(PHOTO)}`)).body, PHOTO)
    assert.equal(fake.counts.get, 1)
    const old = await s.call("PUT", `/blob/${contentKey("from an old client")}`, { text: "from an old client" })
    assert.equal(old.body.stored, true)
    const oldRec = await s.store.getBlob("alice", contentKey("from an old client"))
    assert.equal(oldRec.store, "bucket")
    assert.equal(fake.objects.get(oldRec.path).body.toString(), "from an old client")

    // deleting the file deletes its object
    await s.push([{ path: "C:/My Pictures/PHOTO001.JPG", kind: "f", deleted: true, baseRev: 1 }])
    assert.equal(fake.objects.has(rec.path), false)
    assert.equal((await s.call("GET", "/state")).body.usage, Buffer.byteLength(DIARY) + "from an old client".length)
  } finally {
    s.close()
  }
})

test("uploads: sizes must match, reservations run out, quota counts uploads in progress, total cap", async () => {
  const s = await start({ quotaBytes: 5000, budgets: { totalBytes: 5000, rules: [] } })
  try {
    // a size that can't be this file
    assert.equal((await s.call("POST", "/upload", { body: { hash: contentKey(PHOTO), size: 9999, enc: "b64", mime: "image/jpeg" } })).status, 400)
    assert.equal((await s.call("POST", "/upload", { body: { hash: contentKey(PHOTO), size: 3000, enc: "b64", mime: "text/html<x>" } })).status, 400)
    assert.equal((await s.call("POST", "/upload", { body: { hash: "nope", size: 1, enc: "t" } })).status, 400)

    // more bytes than asked for: the bucket refuses them
    const big = await s.send(PHOTO, TOKEN_A, { bytes: Buffer.alloc(3500, 1) })
    assert.notEqual(big.put.status, 200)
    // fewer: the bucket takes them, and /commit sees the size is wrong and throws them away
    const short = await s.send(PHOTO, TOKEN_A, { bytes: Buffer.alloc(2000, 1) })
    assert.equal(short.commit.status, 400)
    assert.equal((await s.store.getBlob("alice", contentKey(PHOTO))), null)
    assert.equal(fake.objects.size, 0)

    // never uploaded
    await s.call("POST", "/upload", { body: { hash: contentKey(PHOTO), size: 3000, enc: "b64", mime: "image/jpeg" } })
    assert.equal((await s.call("POST", "/commit", { body: { hash: contentKey(PHOTO) } })).status, 409)
    // an upload in progress counts toward the quota: a second 3000 doesn't fit in 5000
    const second = photo(53)
    const full = await s.call("POST", "/upload", { body: { hash: contentKey(second), size: 3000, enc: "b64", mime: "image/jpeg" } })
    assert.equal(full.status, 413)
    assert.equal(full.body.full, true)
    // the reservation runs out after 30 minutes; the upkeep throws it (and any object) away
    const p = pack(PHOTO)
    const ticket = (await s.call("POST", "/upload", { body: { hash: contentKey(PHOTO), size: 3000, enc: "b64", mime: "image/jpeg" } })).body
    await fetch(ticket.url, { method: "PUT", headers: ticket.headers, body: p.bytes })
    assert.equal(fake.objects.size, 1)
    s.clock.t += 31 * 60_000
    assert.equal((await s.call("POST", "/commit", { body: { hash: contentKey(PHOTO) } })).status, 410)
    assert.equal(fake.objects.size, 0)
    await s.call("POST", "/upload", { body: { hash: contentKey(second), size: 3000, enc: "b64", mime: "image/jpeg" } })
    s.clock.t += 31 * 60_000
    await s.router.maintain()
    assert.equal(await s.store.getBlob("alice", contentKey(second)), null)

    // all accounts together stop at the bucket's total
    assert.equal((await s.send(PHOTO)).commit.body.stored, true) // 3000
    // 3000 + 3000 is over the bucket's 5000 in all, though bob has room of his own
    const over = await s.call("POST", "/upload", { token: TOKEN_B, body: { hash: contentKey(photo(71)), size: 3000, enc: "b64", mime: "image/jpeg" } })
    assert.equal(over.status, 413)
    assert.match(over.body.error, /online storage is full/)
  } finally {
    s.close()
  }
})

test("budgets: used up -> resting until a date, counted in the store so a restart remembers", async () => {
  const store = memorySyncStore()
  const clock = { t: Date.now() }
  const budgets = { totalBytes: 1e9, rules: [{ field: "simple", days: 31, limit: 3, label: "downloads" }, { field: "down", days: 31, limit: 1e6, label: "download size" }] }
  let s = await start({ store, clock, budgets })
  try {
    await s.send(PHOTO)
    for (let i = 0; i < 2; i++) assert.equal((await s.call("POST", "/urls", { body: { hashes: [contentKey(PHOTO)] } })).status, 200)
    // commit's head was one; two downloads; the next would be a fourth
    const refused = await s.call("POST", "/urls", { body: { hashes: [contentKey(PHOTO)] } })
    assert.equal(refused.status, 429)
    assert.equal(refused.body.resting, true)
    assert.match(refused.body.error, /Online storage is resting until/)
    assert.equal(refused.body.until, new Date(Date.parse(`${dayOf(clock.t)}T00:00:00Z`) + 31 * DAY).toISOString())
    // the old way is counted the same
    assert.equal((await s.call("GET", `/blob/${contentKey(PHOTO)}`)).status, 429)
    s.close()
    // a restart: same counts
    s = await start({ store, clock, budgets })
    assert.equal((await s.call("POST", "/urls", { body: { hashes: [contentKey(PHOTO)] } })).status, 429)
    const status = await s.call("GET", "/status", { token: null })
    assert.equal(status.status, 200)
    assert.equal(status.body.bucket, "vercel")
    assert.equal(status.body.stored, 3000)
    assert.deepEqual(status.body.budgets.map((b) => [b.what, b.used, b.limit]), [["simple", 3, 3], ["down", 6000, 1e6]])
    assert.equal(JSON.stringify(status.body).includes("alice"), false)
    // a month later there's room again
    clock.t += 31 * DAY
    assert.equal((await s.call("POST", "/urls", { body: { hashes: [contentKey(PHOTO)] } })).status, 200)
  } finally {
    s.close()
  }
})

test("the bucket says its limits are reached: everything rests until tomorrow, nothing breaks", async () => {
  const clock = { t: Date.now() }
  const s = await start({ clock })
  try {
    await s.send(PHOTO)
    fake.state.suspended = true
    const p = pack(DIARY)
    const ticket = await s.call("POST", "/upload", { body: { hash: contentKey(DIARY), size: p.bytes.length, enc: "t" } })
    assert.equal(ticket.status, 200) // signing is done here, no call to the bucket
    await fetch(ticket.body.url, { method: "PUT", headers: ticket.body.headers, body: p.bytes })
    const commit = await s.call("POST", "/commit", { body: { hash: contentKey(DIARY) } })
    assert.equal(commit.status, 429)
    assert.equal(commit.body.resting, true)
    const calls = fake.counts.refused
    // later requests rest without asking the bucket
    assert.equal((await s.call("POST", "/urls", { body: { hashes: [contentKey(PHOTO)] } })).status, 429)
    assert.equal((await s.call("PUT", `/blob/${contentKey("x")}`, { text: "x" })).status, 429)
    assert.equal(fake.counts.refused, calls)
    assert.ok((await s.call("GET", "/status", { token: null })).body.resting)
    // the synced file list still works
    assert.equal((await s.call("GET", "/changes?since=0")).status, 200)
    fake.state.suspended = false
    clock.t += DAY + 60_000
    assert.equal((await s.call("POST", "/urls", { body: { hashes: [contentKey(PHOTO)] } })).status, 200)
  } finally {
    s.close()
  }
})

test("contents already in MongoDB move to the bucket in the background, checked, kept 7 days, within budget", async () => {
  const store = memorySyncStore()
  const clock = { t: Date.now() }
  // first without a bucket: contents in MongoDB
  const before = await start({ store, clock, noBucket: true })
  const texts = [PHOTO, DIARY, photo(5)]
  for (const text of texts) assert.equal((await before.call("PUT", `/blob/${contentKey(text)}`, { text })).body.stored, true)
  await before.push(texts.map((text, i) => before.file(`C:/Documents/f${i}`, text)))
  const usageBefore = (await before.call("GET", "/state")).body.usage
  before.close()
  assert.equal(usageBefore, 3000 + encodeBlob(DIARY).size + 3000) // the diary is deflated in MongoDB

  // then with one; the background may use 70% of a budget: 2 of 3 uploads
  const s = await start({ store, clock, budgets: { totalBytes: 1e9, rules: [{ field: "adv", days: 1, limit: 3, label: "uploads" }] } })
  try {
    assert.equal((await s.router.maintain()).work, 2)
    assert.equal(await store.countToMove(), 1)
    assert.equal((await s.router.maintain()).work, 0) // the rest waits for the budget
    clock.t += DAY
    assert.equal((await s.router.maintain()).work, 1)
    assert.equal(await store.countToMove(), 0)
    assert.equal((await s.router.maintain()).work, 0) // again: nothing to do
    assert.equal(fake.objects.size, 3)
    assert.equal(fake.counts.get, 3) // each one read back and compared (the first 20 are)
    for (const text of texts) {
      const rec = await store.getBlob("alice", contentKey(text))
      assert.equal(rec.store, "bucket")
      assert.ok(rec.data) // MongoDB's copy is kept for now
    }
    // usage follows what the bucket holds (the diary as plain text now)
    assert.equal((await s.call("GET", "/state")).body.usage, 6000 + Buffer.byteLength(DIARY))
    // devices download from the bucket; the old route still reads MongoDB's copy (no bucket call)
    assert.equal((await s.fetchBack(contentKey(DIARY))).text, DIARY)
    assert.equal((await s.call("GET", `/blob/${contentKey(DIARY)}`)).body, DIARY)
    assert.equal(fake.counts.get, 3)
    // 7 days later the MongoDB copies go
    clock.t += 8 * DAY
    await s.router.maintain()
    for (const text of texts) assert.equal((await store.getBlob("alice", contentKey(text))).data, undefined)
    assert.equal((await s.call("GET", `/blob/${contentKey(DIARY)}`)).body, DIARY)
    assert.equal((await s.call("GET", `/blob/${contentKey(PHOTO)}`)).body, PHOTO)
    assert.equal(fake.counts.get, 5)
  } finally {
    s.close()
  }
})

test("Delete My Account and Delete online files remove the account's objects; strays are tidied weekly", async () => {
  const s = await start()
  try {
    await s.send(PHOTO)
    await s.send(DIARY)
    await s.send(photo(3), TOKEN_B)
    assert.equal(fake.objects.size, 3)
    assert.deepEqual(await s.router.eraseAccount({ key: "alice" }), { files: "deleted" })
    assert.equal(fake.objects.size, 1)
    await s.router.eraseAccount({ key: "alice" }) // again: nothing left, no error
    assert.equal((await s.call("DELETE", "/", { token: TOKEN_B })).status, 200)
    assert.equal(fake.objects.size, 0)

    // strays: an object with no record (an upload whose record went), old and new
    await s.send(PHOTO)
    fake.objects.set("u/0123456789abcdef01234567/old-1", { body: Buffer.from("x"), type: "application/octet-stream", at: s.clock.t - 2 * DAY, etag: "" })
    fake.objects.set("u/0123456789abcdef01234567/new-1", { body: Buffer.from("x"), type: "application/octet-stream", at: s.clock.t, etag: "" })
    s.clock.t += 60_000
    await s.router.maintain()
    assert.deepEqual([...fake.objects.keys()].filter((k) => k.includes("0123456789abcdef01234567")), ["u/0123456789abcdef01234567/new-1"])
    assert.equal(fake.objects.size, 2) // alice's photo stays
    const lists = fake.counts.list
    await s.router.maintain() // not again this week (listing is budgeted)
    assert.equal(fake.counts.list, lists)
  } finally {
    s.close()
  }
})

test("without a bucket everything is as before", async () => {
  const s = await start({ noBucket: true })
  try {
    assert.equal((await s.call("GET", "/state")).body.direct, false)
    assert.equal((await s.call("GET", "/state")).body.quota, 100 * 1024 * 1024)
    assert.equal((await s.call("POST", "/upload", { body: { hash: contentKey("x"), size: 1, enc: "t" } })).status, 404)
    assert.deepEqual((await s.call("GET", "/status", { token: null })).body, { ok: true, bucket: null })
    assert.equal((await s.call("PUT", `/blob/${contentKey("x")}`, { text: "x" })).body.stored, true)
    assert.equal(fake.counts.put + fake.counts.presignedPut, 0)
  } finally {
    s.close()
  }
})

// ---------- the S3 adapter's signer (AWS's published examples) ----------

const AWS = { keyId: "AKIAIOSFODNN7EXAMPLE", secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", date: Date.parse("2013-05-24T00:00:00Z") }

test("S3 signer: AWS's query-string (presigned URL) example", () => {
  const url = presignUrl({ ...AWS, method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", expires: 86400 })
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/)
  assert.match(url, /X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request/)
})

test("S3 signer: AWS's header example (GET with a Range header)", () => {
  const headers = signHeaders({ ...AWS, method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", headers: { range: "bytes=0-9" } })
  assert.match(headers.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/)
  assert.match(headers.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date/)
})
