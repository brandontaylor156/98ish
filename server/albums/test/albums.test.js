const test = require("node:test")
const assert = require("node:assert/strict")
const express = require("express")
const { createAlbums, LIMITS } = require("..")
const { memoryAlbumStore } = require("../store")
const { createBucket, vercelAdapter } = require("../../drive/bucket")
const { memorySyncStore } = require("../../drive/syncStore")
const { startFakeBlob } = require("../../drive/test/fakeBlob")

const RW = "vercel_blob_rw_teststore_secret"
const TOKENS = { alice: "a".repeat(48), bob: "b".repeat(48), carol: "c".repeat(48), dave: "d".repeat(48) }
const NAMES = { alice: "Alice", bob: "Bob", carol: "Carol", dave: "Dave" }
const quiet = { log() {}, error() {}, warn() {} }
const THUMB = "data:image/jpeg;base64," + Buffer.from("tiny preview").toString("base64")

// A server with signed-on 98 Messenger sessions, sockets and push that remember what they
// were sent, and (unless bucket: false) the fake Vercel Blob behind file sync's bucket
const start = async ({ blocked = {}, env = {}, budgets, bucket: withBucket = true, clock = { t: Date.now() } } = {}) => {
  const emitted = []
  const pushed = []
  const sessions = new Map(
    Object.keys(TOKENS).map((key) => [key, { key, token: TOKENS[key], user: { screenName: NAMES[key], blocked: blocked[key] || [] }, socket: { emit: (event, payload) => emitted.push({ to: key, event, payload }) } }])
  )
  const aim = { sessions, store: { find: async (key) => (NAMES[key] ? { screenName: NAMES[key], blocked: blocked[key] || [] } : null) } }
  const push = { notify: async (key, category, message, opts) => (pushed.push({ key, category, message, opts }), { sent: 1 }) }
  let fake = null
  let storage = async () => null
  if (withBucket) {
    fake = await startFakeBlob({ token: RW })
    process.env.VERCEL_BLOB_API_URL = fake.apiUrl
    process.env.VERCEL_BLOB_RETRIES = "0"
    const adapter = vercelAdapter({ token: RW, env: { BLOB_STORE_URL: fake.storeUrl }, maxBytes: 40 * 1024 * 1024 })
    if (budgets) adapter.budgets = () => budgets
    const db = memorySyncStore()
    const bucket = createBucket({ adapter, db, env: {}, now: () => clock.t, log: quiet })
    storage = async () => ({ bucket, adapter, syncedBytes: () => db.bucketTotal() })
  }
  const store = memoryAlbumStore()
  const albums = createAlbums({ aim: () => aim, store, push, storage, env, now: () => clock.t, log: quiet, background: false })
  const app = express()
  app.use("/api/albums", albums.router())
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/albums`
  const call = async (who, path, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(base + path, { method, headers: { ...(who ? { Authorization: `Bearer ${TOKENS[who]}` } : {}), "Content-Type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify(body || {}) }) })
    return { status: response.status, body: await response.json() }
  }
  // the whole upload: ticket, signed PUT, commit
  const add = async (who, id, bytes = Buffer.alloc(5000, 7), info = {}) => {
    const ticket = await call(who, `/${id}/upload`, { kind: "image", mime: "image/jpeg", size: bytes.length, w: 40, h: 30, thumb: THUMB, taken: clock.t - 1000, ...info })
    if (ticket.status !== 200) return { ticket }
    const put = await fetch(ticket.body.url, { method: ticket.body.method, headers: ticket.body.headers, body: bytes })
    return { ticket, put, commit: await call(who, `/${id}/items/${ticket.body.item}/commit`, {}) }
  }
  const close = () => {
    server.close()
    fake?.close()
  }
  return { call, add, albums, store, emitted, pushed, sessions, fake, clock, close }
}

const newAlbum = async (s, who = "alice", name = "Beach Day") => (await s.call(who, "/", { name })).body.album

test("albums: start, invite a buddy, both see it; outsiders and blocked people can't", async (t) => {
  const s = await start({ blocked: { carol: ["alice"] } })
  t.after(s.close)
  assert.equal((await s.call(null, "/")).status, 401)
  const album = await newAlbum(s)
  assert.match(album.id, /^[0-9a-f]{16}$/)
  assert.equal(album.owner, "alice")
  assert.equal((await s.call("alice", "/", { name: "   " })).status, 400)
  // bob isn't in it yet
  assert.equal((await s.call("bob", `/${album.id}`)).status, 404)
  let r = await s.call("alice", `/${album.id}/invite`, { to: "Bob" })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.album.members.map((m) => m.name), ["Alice", "Bob"])
  // bob hears about it live and by push (always, even right after another push)
  assert.ok(s.emitted.some((e) => e.to === "bob" && e.event === "albums:changed" && e.payload.what === "invited"))
  assert.ok(s.pushed.some((p) => p.key === "bob" && p.category === "albums" && /shared the album "Beach Day"/.test(p.message.title)))
  r = await s.call("bob", "/")
  assert.equal(r.body.albums.length, 1)
  assert.equal(r.body.albums[0].lastWhat, "invited Bob")
  // carol blocked alice; nobody isn't a screen name; you can't invite yourself
  assert.equal((await s.call("alice", `/${album.id}/invite`, { to: "carol" })).status, 409)
  assert.equal((await s.call("alice", `/${album.id}/invite`, { to: "nobody123" })).status, 404)
  assert.equal((await s.call("alice", `/${album.id}/invite`, { to: "alice" })).status, 400)
  // any member can invite; only the owner renames
  assert.equal((await s.call("bob", `/${album.id}/invite`, { to: "dave" })).status, 200)
  assert.equal((await s.call("bob", `/${album.id}/rename`, { name: "Mine" })).status, 403)
  r = await s.call("alice", `/${album.id}/rename`, { name: "Beach Day 2026" })
  assert.equal(r.body.album.name, "Beach Day 2026")
})

test("photos: signed upload, size checked, only members get a link (and lose it when they leave)", async (t) => {
  const s = await start()
  t.after(s.close)
  const album = await newAlbum(s)
  await s.call("alice", `/${album.id}/invite`, { to: "bob" })
  const bytes = Buffer.from(Array.from({ length: 6000 }, (_, i) => i % 251))
  const up = await s.add("bob", album.id, bytes, { caption: "  sunset  " })
  assert.equal(up.ticket.status, 200, JSON.stringify(up.ticket.body))
  assert.equal(up.put.status, 200)
  assert.equal(up.commit.status, 200, JSON.stringify(up.commit.body))
  const rec = await s.store.getItem(up.ticket.body.item)
  assert.match(rec.path, /^a\/[0-9a-f]{24}\/[0-9a-f]{20}$/, "its own namespace, no names")
  assert.ok(!rec.path.includes(album.id) && !rec.path.includes("bob"))
  // the album shows it (no preview in the list; previews come separately)
  let r = await s.call("alice", `/${album.id}`)
  assert.equal(r.body.items.length, 1)
  const item = r.body.items[0]
  assert.equal(item.byName, "Bob")
  assert.equal(item.caption, "sunset")
  assert.equal(item.thumb, undefined)
  assert.equal(r.body.album.count, 1)
  assert.equal(r.body.album.cover, item.id)
  assert.equal(r.body.album.lastWhat, "added 1 photo")
  r = await s.call("alice", `/${album.id}/thumbs`, { ids: [item.id, "nope"] })
  assert.deepEqual(r.body.thumbs, { [item.id]: THUMB })
  // alice heard (live + push); bob didn't hear about his own photo
  assert.ok(s.pushed.some((p) => p.key === "alice" && p.message.title === "Bob added a photo"))
  assert.ok(!s.pushed.some((p) => p.key === "bob" && /added/.test(p.message.title)))
  // a member gets a signed link that works; an outsider gets nothing
  r = await s.call("alice", `/${album.id}/items/${item.id}/url`, {})
  assert.equal(r.status, 200)
  const got = await fetch(r.body.url)
  assert.equal(got.status, 200)
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), bytes)
  assert.equal((await s.call("carol", `/${album.id}/items/${item.id}/url`, {})).status, 404)
  // a second photo soon after adds up: "added 2 photos", and the push waits (10 minutes)
  await s.add("bob", album.id)
  r = await s.call("alice", "/")
  assert.equal(r.body.albums[0].lastWhat, "added 2 photos")
  assert.equal(s.pushed.filter((p) => p.key === "alice" && /added/.test(p.message.title)).length, 1)
  // bob leaves: no more links for him
  assert.equal((await s.call("bob", `/${album.id}/leave`, {})).status, 200)
  assert.equal((await s.call("bob", `/${album.id}/items/${item.id}/url`, {})).status, 404)
  assert.equal((await s.call("bob", "/")).body.albums.length, 0)
})

test("uploads: the wrong size, type or a missing file are refused", async (t) => {
  const s = await start()
  t.after(s.close)
  const album = await newAlbum(s)
  const ask = (info) => s.call("alice", `/${album.id}/upload`, { kind: "image", mime: "image/jpeg", size: 1000, thumb: THUMB, ...info })
  assert.equal((await ask({ mime: "image/png" })).status, 400)
  assert.equal((await ask({ kind: "audio", mime: "audio/mp4" })).status, 400)
  assert.equal((await ask({ size: LIMITS.image + 1 })).status, 413)
  assert.equal((await ask({ kind: "video", mime: "video/mp4", size: LIMITS.video + 1 })).status, 413)
  assert.equal((await ask({ kind: "video", mime: "video/quicktime", size: 1000, d: 90 })).status, 413)
  assert.equal((await ask({ thumb: "javascript:alert(1)" })).status, 400)
  assert.equal((await ask({ thumb: "data:image/jpeg;base64," + "A".repeat(LIMITS.thumbChars) })).status, 400)
  // a video within limits is fine
  const v = await s.add("alice", album.id, Buffer.alloc(3000, 1), { kind: "video", mime: "video/mp4", d: 12 })
  assert.equal(v.commit.status, 200)
  assert.equal((await s.call("alice", "/")).body.albums[0].lastWhat, "added 1 video")
  // said 5000 bytes, sent 4000: not kept
  const ticket = await s.call("alice", `/${album.id}/upload`, { kind: "image", mime: "image/jpeg", size: 5000, thumb: THUMB })
  await fetch(ticket.body.url, { method: "PUT", headers: ticket.body.headers, body: Buffer.alloc(4000) })
  const commit = await s.call("alice", `/${album.id}/items/${ticket.body.item}/commit`, {})
  assert.equal(commit.status, 409)
  assert.equal(await s.store.getItem(ticket.body.item), null)
  // somebody else's upload can't be committed by me
  await s.call("alice", `/${album.id}/invite`, { to: "bob" })
  const t2 = await s.call("alice", `/${album.id}/upload`, { kind: "image", mime: "image/jpeg", size: 100, thumb: THUMB })
  assert.equal((await s.call("bob", `/${album.id}/items/${t2.body.item}/commit`, {})).status, 403)
})

test("caps: per account quota, everyone's total, and no bucket = resting", async (t) => {
  const s = await start({ env: { ALBUM_QUOTA_MB: "0.01" } }) // ~10 KB each
  t.after(s.close)
  const album = await newAlbum(s)
  assert.equal((await s.add("alice", album.id, Buffer.alloc(6000))).commit.status, 200)
  const over = await s.add("alice", album.id, Buffer.alloc(6000))
  assert.equal(over.ticket.status, 413)
  assert.equal(over.ticket.body.full, true)
  assert.match(over.ticket.body.error, /Remove some/)
  // everyone together
  const s2 = await start({ env: { ALBUM_TOTAL_MB: "0.01" } })
  t.after(s2.close)
  const a2 = await newAlbum(s2)
  await s2.call("alice", `/${a2.id}/invite`, { to: "bob" })
  assert.equal((await s2.add("alice", a2.id, Buffer.alloc(6000))).commit.status, 200)
  const r = await s2.add("bob", a2.id, Buffer.alloc(6000))
  assert.equal(r.ticket.status, 503)
  assert.equal(r.ticket.body.resting, true)
  // no bucket at all
  const s3 = await start({ bucket: false })
  t.after(s3.close)
  const a3 = await newAlbum(s3)
  const none = await s3.add("alice", a3.id)
  assert.equal(none.ticket.status, 503)
  assert.equal(none.ticket.body.resting, true)
  assert.match(none.ticket.body.error, /resting/)
  // albums use at most their share of the free budgets (1/4 of 8 uploads = 2)
  const s4 = await start({ budgets: { totalBytes: 50 * 1024 * 1024, rules: [{ field: "adv", days: 31, limit: 8, label: "uploads" }, { field: "simple", days: 31, limit: 1000, label: "downloads" }, { field: "down", days: 31, limit: 1e9, label: "download size" }] } })
  t.after(s4.close)
  const a4 = await newAlbum(s4)
  // the signing token itself is an advanced op the first time
  const results = []
  for (let i = 0; i < 3; i++) results.push((await s4.add("alice", a4.id)).ticket.status)
  assert.ok(results.includes(503), `budget share runs out: ${results}`)
})

test("likes and comments: who can delete what, and who hears about it", async (t) => {
  const s = await start()
  t.after(s.close)
  const album = await newAlbum(s)
  await s.call("alice", `/${album.id}/invite`, { to: "bob" })
  await s.call("alice", `/${album.id}/invite`, { to: "carol" })
  const up = await s.add("alice", album.id)
  const item = up.ticket.body.item
  s.pushed.length = 0
  let r = await s.call("bob", `/${album.id}/items/${item}/like`, { on: true })
  assert.deepEqual(r.body.likes, ["bob"])
  assert.ok(s.pushed.some((p) => p.key === "alice" && p.message.title === "Bob liked your photo"))
  assert.ok(!s.pushed.some((p) => p.key === "carol"), "only the photo's owner gets a push for a like")
  r = await s.call("bob", `/${album.id}/items/${item}/like`, { on: false })
  assert.deepEqual(r.body.likes, [])
  r = await s.call("carol", `/${album.id}/items/${item}/comment`, { text: "  So pretty!  " })
  assert.equal(r.body.comment.text, "So pretty!")
  const cid = r.body.comment.id
  assert.equal((await s.call("carol", `/${album.id}/items/${item}/comment`, { text: "   " })).status, 400)
  r = await s.call("bob", `/${album.id}`)
  assert.deepEqual(r.body.items[0].comments.map((c) => [c.byName, c.text]), [["Carol", "So pretty!"]])
  assert.equal(r.body.album.lastWhat, "commented: So pretty!")
  // bob can't delete carol's comment; alice (the owner) can
  assert.equal((await s.call("bob", `/${album.id}/items/${item}/uncomment`, { id: cid })).status, 403)
  assert.equal((await s.call("alice", `/${album.id}/items/${item}/uncomment`, { id: cid })).body.removed, true)
  // bob can't remove alice's photo; alice can
  assert.equal((await s.call("bob", `/${album.id}/items/${item}/remove`, {})).status, 403)
  const objectsBefore = s.fake.objects.size
  assert.equal((await s.call("alice", `/${album.id}/items/${item}/remove`, {})).status, 200)
  assert.equal(s.fake.objects.size, objectsBefore - 1, "the object is deleted too")
  r = await s.call("bob", `/${album.id}`)
  assert.equal(r.body.items.length, 0)
  assert.equal(r.body.album.count, 0)
  assert.equal(r.body.album.cover, null)
})

test("members: the owner removes people, leaving passes the album on, deleting removes everything", async (t) => {
  const s = await start()
  t.after(s.close)
  const album = await newAlbum(s)
  await s.call("alice", `/${album.id}/invite`, { to: "bob" })
  await s.call("alice", `/${album.id}/invite`, { to: "carol" })
  assert.equal((await s.call("bob", `/${album.id}/remove`, { key: "carol" })).status, 403)
  let r = await s.call("alice", `/${album.id}/remove`, { key: "carol" })
  assert.deepEqual(r.body.album.members.map((m) => m.key), ["alice", "bob"])
  assert.ok(s.emitted.some((e) => e.to === "carol" && e.payload.what === "removed"))
  assert.equal((await s.call("carol", `/${album.id}`)).status, 404)
  await s.add("bob", album.id)
  await s.add("alice", album.id)
  // alice leaves: bob owns it now
  await s.call("alice", `/${album.id}/leave`, {})
  r = await s.call("bob", `/${album.id}`)
  assert.equal(r.body.album.owner, "bob")
  assert.equal(r.body.items.length, 2, "what alice added stays in the album")
  // bob deletes it: every object goes
  assert.equal(s.fake.objects.size, 2)
  assert.equal((await s.call("bob", `/${album.id}/delete`, {})).status, 200)
  assert.equal(s.fake.objects.size, 0)
  assert.equal((await s.call("bob", "/")).body.albums.length, 0)
  // the last member leaving deletes it too
  const solo = await newAlbum(s, "carol", "Just me")
  await s.add("carol", solo.id)
  r = await s.call("carol", `/${solo.id}/leave`, {})
  assert.equal(r.body.deleted, solo.id)
  assert.equal(s.fake.objects.size, 0)
})

test("Delete My Account: their photos, likes and comments go everywhere; the others are told", async (t) => {
  const s = await start()
  t.after(s.close)
  const shared = await newAlbum(s, "alice", "Trip")
  await s.call("alice", `/${shared.id}/invite`, { to: "bob" })
  await s.call("alice", `/${shared.id}/invite`, { to: "carol" })
  const mine = await newAlbum(s, "alice", "Only mine")
  await s.add("alice", mine.id)
  const a1 = (await s.add("alice", shared.id)).ticket.body.item
  const b1 = (await s.add("bob", shared.id)).ticket.body.item
  await s.call("alice", `/${shared.id}/items/${b1}/like`, { on: true })
  await s.call("alice", `/${shared.id}/items/${b1}/comment`, { text: "love it" })
  await s.call("carol", `/${shared.id}/items/${b1}/comment`, { text: "me too" })
  // an album alice left earlier but still has a comment in
  const other = await newAlbum(s, "dave", "Dave's")
  await s.call("dave", `/${other.id}/invite`, { to: "alice" })
  const d1 = (await s.add("dave", other.id)).ticket.body.item
  await s.call("alice", `/${other.id}/items/${d1}/comment`, { text: "nice" })
  await s.call("alice", `/${other.id}/leave`, {})
  assert.equal(s.fake.objects.size, 4)
  s.emitted.length = 0

  const result = await s.albums.eraseAccount({ key: "alice", screenName: "Alice" })
  assert.equal(result.removedItems, 2)
  assert.equal(result.deleted, 1, "the album only alice was in is deleted")
  assert.equal(result.left, 1)
  assert.equal(s.fake.objects.size, 2, "alice's objects are deleted, bob's and dave's stay")
  let r = await s.call("bob", `/${shared.id}`)
  assert.equal(r.body.album.owner, "bob", "the owner role passes on")
  assert.deepEqual(r.body.album.members.map((m) => m.key), ["bob", "carol"])
  assert.ok(!JSON.stringify(r.body.album).includes("Alice"), "her name is off the album")
  assert.deepEqual(r.body.items.map((i) => i.id), [b1])
  assert.deepEqual(r.body.items[0].likes, [])
  assert.deepEqual(r.body.items[0].comments.map((c) => c.text), ["me too"])
  assert.equal(r.body.album.count, 1)
  assert.equal(r.body.album.lastWhat, "A member deleted their account")
  assert.ok(s.emitted.some((e) => e.to === "bob" && e.payload.by === "(deleted account)"))
  r = await s.call("dave", `/${other.id}`)
  assert.deepEqual(r.body.items[0].comments, [])
  assert.equal(await s.store.getAlbum(mine.id), null)
  assert.equal(await s.store.getItem(a1), null)
  // running it again is fine (idempotent)
  const again = await s.albums.eraseAccount({ key: "alice", screenName: "Alice" })
  assert.deepEqual(again, { removedItems: 0, traces: 0, left: 0, deleted: 0 })
})

test("upkeep: uploads never finished are deleted after 30 minutes", async (t) => {
  const clock = { t: Date.now() }
  const s = await start({ clock })
  t.after(s.close)
  const album = await newAlbum(s)
  const ticket = await s.call("alice", `/${album.id}/upload`, { kind: "image", mime: "image/jpeg", size: 100, thumb: THUMB })
  await fetch(ticket.body.url, { method: "PUT", headers: ticket.body.headers, body: Buffer.alloc(100) })
  assert.equal((await s.call("alice", `/${album.id}`)).body.items.length, 0, "pending ones don't show")
  assert.deepEqual(await s.albums.maintain(), { removed: 0 })
  clock.t += 31 * 60_000
  assert.deepEqual(await s.albums.maintain(), { removed: 1 })
  assert.equal(s.fake.objects.size, 0)
})

test("limits: albums per account, people per album", async (t) => {
  const s = await start()
  t.after(s.close)
  for (let i = 0; i < LIMITS.owned; i++) assert.equal((await s.call("alice", "/", { name: `A${i}` })).status, 200)
  const r = await s.call("alice", "/", { name: "one too many" })
  assert.equal(r.status, 413)
  assert.match(r.body.error, /at most 20 albums/)
})
