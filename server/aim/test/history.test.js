// 98 Messenger, done properly: saved conversations (caps, cursors, clearing, the privacy
// switches, Delete My Account), reactions, read receipts, "Delivered", and pictures / voice
// messages in the online storage bucket (the real @vercel/blob SDK against the fake store).
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const path = require("node:path")
const { Server } = require("socket.io")
const { attachAim } = require("..")
const { createStore } = require("../store")
const { memoryHistory, toWire, packStyle, unpackStyle, pairConv } = require("../history")
const { createMedia, memoryMediaStore } = require("../media")
const { mediaPreview } = require("../conversations")
const { createBucket, vercelAdapter } = require("../../drive/bucket")
const { memorySyncStore } = require("../../drive/syncStore")
const { memoryStore: memoryPushStore } = require("../../push/store")
const { startFakeBlob } = require("../../drive/test/fakeBlob")
const { DELETED_NAME } = require("../../account")

let ioClient = null
try {
  ioClient = require(path.join(__dirname, "../../../client/node_modules/socket.io-client"))
} catch {
  ioClient = null
}

const DAY = 86_400_000
const RW = "vercel_blob_rw_teststore_secret456"
const quiet = { log() {}, warn() {}, error() {} }
let n = 0
const id = () => (++n).toString(16).padStart(20, "0")
const T0 = Date.now() - 10 * DAY
const msg = (c, fk, f, to, t, at, p) => ({ _id: id(), c, p, f, fk, to, t, at: at < 1e12 ? T0 + at : at })

test("history store: per-conversation caps, the global guard, cursors, recent and older pages", async () => {
  const h = memoryHistory({ perPair: 5, perRoom: 3, maxDocs: 12 })
  const ab = pairConv("alice", "bob")
  for (let i = 0; i < 8; i++) await h.add(msg(ab, "alice", "Alice", "Bob", `hi ${i}`, 1000 + i, ["alice", "bob"]))
  const all = await h.older("alice", ab, Infinity, 50)
  assert.deepEqual(all.map((d) => d.t), ["hi 7", "hi 6", "hi 5", "hi 4", "hi 3"], "the newest 5 of the pair stay")
  for (let i = 0; i < 5; i++) await h.add(msg("#lobby", "carol", "Carol", "Lobby", `room ${i}`, 2000 + i, ["alice", "carol"]))
  assert.equal((await h.older("carol", "#lobby", Infinity)).length, 3, "rooms keep fewer")

  // changes come in order, page by page, and only what you may read
  const first = await h.changes("alice", 0, 4)
  assert.equal(first.docs.length, 4)
  assert.equal(first.more, true)
  const rest = await h.changes("alice", first.docs.at(-1).u, 100)
  assert.equal(rest.more, false)
  assert.equal(first.docs.length + rest.docs.length, 8)
  assert.ok(first.docs.every((d, i) => i === 0 || d.u > first.docs[i - 1].u))
  assert.equal((await h.changes("bob", 0, 100)).docs.length, 5, "bob isn't in the room")
  // a reaction is a change too
  const cursor = (await h.changes("bob", 0, 100)).docs.at(-1).u
  const reacted = await h.react(all[0]._id, "bob", "heart")
  assert.deepEqual(reacted.r, { bob: "heart" })
  const after = await h.changes("bob", cursor, 100)
  assert.deepEqual(after.docs.map((d) => d.t), ["hi 7"])

  // recent: the newest of each conversation; older: scrolling back before a time
  const recent = await h.recent("alice", 2)
  assert.deepEqual(recent.map((d) => d.t).sort(), ["hi 6", "hi 7", "room 3", "room 4"])
  assert.deepEqual((await h.older("alice", ab, T0 + 1006, 2)).map((d) => d.t), ["hi 5", "hi 4"])

  // the global guard: everyone together stays under maxDocs (oldest first)
  for (let i = 0; i < 10; i++) await h.add(msg(pairConv("dan", `e${i}`), "dan", "Dan", `E${i}`, "x", 3000 + i, ["dan"]))
  assert.ok((await h.count()) <= 12)

  // the wire shape: from each side
  const w = toWire(reacted, "bob")
  assert.deepEqual([w.conv, w.ck, w.mine, w.from, w.text, w.r.bob], ["Alice", "alice", false, "Alice", "hi 7", "heart"])
  assert.deepEqual([toWire(reacted, "alice").conv, toWire(reacted, "alice").ck, toWire(reacted, "alice").mine], ["Bob", "bob", true])
  const roomWire = toWire((await h.older("alice", "#lobby", Infinity, 1))[0], "alice")
  assert.deepEqual([roomWire.conv, roomWire.ck, roomWire.room], ["#Lobby", "#lobby", "Lobby"])
})

test("history store: styles pack small; expired messages aren't served; clear, forget and reads", async () => {
  assert.equal(packStyle({ font: "Arial", size: 12, color: "#000000" }), undefined, "the default style isn't stored")
  const style = { font: "Comic Sans MS", size: 18, color: "#ff0080", bold: true, italic: false, underline: true }
  assert.deepEqual(unpackStyle(packStyle(style)), style)

  const clock = { t: Date.now() }
  const h = memoryHistory({ now: () => clock.t })
  const ab = pairConv("alice", "bob")
  const old = await h.add(msg(ab, "alice", "Alice", "Bob", "a year ago", clock.t - 400 * DAY, ["alice", "bob"]))
  assert.equal((await h.changes("alice", 0)).docs.length, 0, "older than a year: gone")
  assert.ok(old.x < clock.t)
  for (let i = 0; i < 3; i++) await h.add(msg(ab, i % 2 ? "bob" : "alice", i % 2 ? "Bob" : "Alice", i % 2 ? "Alice" : "Bob", `m${i}`, clock.t + i, ["alice", "bob"]))
  // bob clears: his copy goes, alice keeps hers; his other devices hear about it
  const cleared = await h.clear("bob", ab, clock.t + 1)
  assert.deepEqual((await h.changes("bob", 0)).docs.map((d) => d.t), ["m2"])
  assert.equal((await h.changes("alice", 0)).docs.length, 3)
  assert.deepEqual((await h.clearsSince("bob", 0)).map((c) => [c.c, c.at]), [[ab, clock.t + 1]])
  assert.equal((await h.clearsSince("bob", cleared.u)).length, 0)
  // a message only bob kept is deleted when he clears it
  await h.add(msg(ab, "bob", "Bob", "Alice", "only bob saves", clock.t + 5, ["bob"]))
  await h.clear("bob", ab, clock.t + 10)
  assert.equal((await h.older("alice", ab, Infinity)).some((d) => d.t === "only bob saves"), false)
  // turning "Save my conversations" off: every saved copy of theirs goes
  await h.forget("alice")
  assert.equal((await h.changes("alice", 0)).docs.length, 0)
  // reads: the newest one stays
  await h.setRead("bob", "alice", ab, 50, 60)
  await h.setRead("bob", "alice", ab, 40, 70)
  assert.deepEqual((await h.readsFor("alice")).map((r) => [r.r, r.at, r.w]), [["bob", 50, 60]])
  await h.forgetReads("bob")
  assert.equal((await h.readsFor("alice")).length, 0)
})

test("history store: Delete My Account takes alice's copies; bob keeps his, without her name", async () => {
  const h = memoryHistory()
  const ab = pairConv("alice", "bob")
  await h.add(msg(ab, "alice", "Alice", "Bob", "from alice", 1, ["alice", "bob"]))
  await h.add(msg(ab, "bob", "Bob", "Alice", "from bob", 2, ["alice", "bob"]))
  await h.add(msg(ab, "alice", "Alice", "Bob", "only alice kept", 3, ["alice"]))
  const reacted = await h.add(msg(ab, "bob", "Bob", "Alice", "bob's, alice loved it", 4, ["bob"]))
  await h.react(reacted._id, "alice", "heart")
  await h.add(msg("#lobby", "alice", "Alice", "Lobby", "alice in the room", 5, ["alice", "carol"]))
  await h.add(msg(pairConv("bob", "carol"), "bob", "Bob", "Carol", "not alice's", 6, ["bob", "carol"]))
  await h.setRead("alice", "bob", ab, 2, 3)
  await h.setRead("bob", "alice", ab, 1, 3)
  await h.clear("alice", pairConv("alice", "zed"), 0)

  await h.eraseAccount("alice")

  assert.equal((await h.changes("alice", 0)).docs.length, 0)
  assert.equal((await h.clearsSince("alice", 0)).length, 0)
  assert.equal((await h.readsFor("bob")).length + (await h.readsFor("alice")).length, 0)
  const bobs = (await h.changes("bob", 0)).docs.map((d) => toWire(d, "bob"))
  const withHer = bobs.filter((m) => m.text !== "not alice's")
  assert.deepEqual(withHer.map((m) => m.text), ["from alice", "from bob", "bob's, alice loved it"])
  assert.ok(withHer.every((m) => m.conv === DELETED_NAME), "the conversation no longer carries her name")
  assert.equal(new Set(withHer.map((m) => m.ck)).size, 1, "still one conversation for bob")
  assert.ok(withHer[0].ck.startsWith("~"))
  assert.equal(withHer[0].from, DELETED_NAME)
  assert.equal(withHer[2].r, undefined, "her reaction went")
  assert.ok(!JSON.stringify(await h.changes("bob", 0)).includes("\"alice\""), "no trace of her key")
  const carol = (await h.changes("carol", 0)).docs.map((d) => toWire(d, "carol"))
  assert.deepEqual(carol.find((m) => m.room).from, DELETED_NAME, "rooms keep the words, not the name")
  assert.equal(carol.find((m) => m.text === "not alice's").from, "Bob")
  // a new account with her name doesn't inherit anything
  assert.equal((await h.older("alice", ab, Infinity)).length, 0)
  assert.equal((await h.older("bob", ab, Infinity)).length, 0)
})

// ---------- over sockets ----------

const setup = async ({ push = null, media = null } = {}) => {
  const server = http.createServer()
  const io = new Server(server)
  const store = await createStore("")
  const history = memoryHistory()
  await attachAim(io, { store, history, push, media })
  await new Promise((r) => server.listen(0, r))
  const url = `http://127.0.0.1:${server.address().port}`
  const sockets = []
  const connect = async () => {
    const socket = ioClient(url, { transports: ["websocket"], forceNew: true })
    sockets.push(socket)
    await new Promise((r) => socket.on("connect", r))
    return socket
  }
  const ask = (socket, event, payload) => new Promise((r) => socket.emit(event, payload, r))
  const next = (socket, event) => new Promise((r) => socket.once(event, r))
  const signOn = async (name, register = true) => {
    const s = await connect()
    const result = await ask(s, "aim:signOn", { screenName: name, password: "hunter22", register })
    assert.equal(result.ok, true, result.error)
    return s
  }
  const close = () => {
    sockets.forEach((s) => s.close())
    io.close()
    server.close()
  }
  return { store, history, connect, ask, next, signOn, close }
}

test("sockets: IMs get ids and are saved; a new device catches up; reactions and read receipts pass live", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  const t = await setup()
  try {
    const alice = await t.signOn("Alice")
    const bob = await t.signOn("Bob")
    const got = t.next(bob, "aim:im")
    const sent = await t.ask(alice, "aim:im", { to: "bob", text: "hello bob", style: { font: "Verdana", size: 14, color: "#123456" } })
    assert.equal(sent.ok, true)
    assert.match(sent.id, /^[0-9a-f]{20}$/)
    const im = await got
    assert.equal(im.id, sent.id)
    await new Promise((r) => setTimeout(r, 50))

    // a device with nothing (since 0) gets the newest messages and a cursor
    const fresh = await t.ask(bob, "aim:history", { since: 0 })
    assert.equal(fresh.fresh, true)
    assert.deepEqual(fresh.messages.map((m) => [m.id, m.ck, m.conv, m.text, m.style.font]), [[sent.id, "alice", "Alice", "hello bob", "Verdana"]])
    assert.deepEqual(fresh.prefs, { saveHistory: true, receipts: true })

    // a reaction: alice hears it live, and it's in bob's next catch-up as a change
    const reaction = t.next(alice, "aim:react")
    assert.equal((await t.ask(bob, "aim:react", { id: sent.id, ck: "alice", emoji: "heart" })).ok, true)
    assert.deepEqual(await reaction, { id: sent.id, from: "Bob", key: "bob", emoji: "heart", ck: "bob" })
    const changes = await t.ask(alice, "aim:history", { since: fresh.cursor - 10_000_000 })
    assert.deepEqual(changes.messages.find((m) => m.id === sent.id).r, { bob: "heart" })
    assert.equal((await t.ask(bob, "aim:react", { id: sent.id, ck: "alice", emoji: "kiss" })).ok, false, "only the six")
    assert.equal((await t.ask(bob, "aim:react", { id: sent.id, ck: "carol", emoji: "lol" })).ok, false, "not someone else's conversation")

    // read receipts: bob reads, alice sees when
    const read = t.next(alice, "aim:read")
    await t.ask(bob, "aim:read", { ck: "alice", at: im.time })
    const receipt = await read
    assert.equal(receipt.ck, "bob")
    assert.equal(receipt.at, im.time)
    assert.deepEqual((await t.ask(alice, "aim:history", { since: changes.cursor })).reads.map((r) => [r.ck, r.at]), [["bob", im.time]])

    // receipts off on bob's side: none sent, and he sees none
    assert.deepEqual((await t.ask(bob, "aim:setPrefs", { receipts: false })).prefs, { saveHistory: true, receipts: false })
    let heard = false
    alice.once("aim:read", () => (heard = true))
    await t.ask(bob, "aim:read", { ck: "alice", at: im.time + 1 })
    bob.once("aim:read", () => (heard = true))
    await t.ask(alice, "aim:read", { ck: "bob", at: im.time })
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(heard, false)
    assert.deepEqual((await t.ask(alice, "aim:history", { since: changes.cursor })).reads, [], "his old read is forgotten too")
    assert.deepEqual((await t.ask(bob, "aim:history", { since: 1 })).reads, [])

    // "Save my conversations on the server" off for alice: her copies go, bob's stay, new
    // messages are kept only for him
    await t.ask(alice, "aim:setPrefs", { saveHistory: false })
    await t.ask(alice, "aim:im", { to: "bob", text: "not saved for me" })
    await new Promise((r) => setTimeout(r, 50))
    assert.equal((await t.ask(alice, "aim:history", { since: 0 })).messages.length, 0)
    assert.deepEqual((await t.ask(bob, "aim:history", { since: 0 })).messages.map((m) => m.text).sort(), ["hello bob", "not saved for me"])

    // bob clears the conversation: gone for him, and his other devices are told
    const before = (await t.ask(bob, "aim:history", { since: 0 })).cursor
    assert.equal((await t.ask(bob, "aim:clearHistory", { ck: "alice", upTo: Date.now() })).ok, true)
    const afterClear = await t.ask(bob, "aim:history", { since: before - 1 })
    assert.deepEqual(afterClear.clears.map((c) => c.ck), ["alice"])
    assert.equal((await t.ask(bob, "aim:history", { since: 0 })).messages.length, 0)

    // rooms: messages have ids and are saved for the people there
    await t.ask(alice, "aim:setPrefs", { saveHistory: true })
    await t.ask(alice, "aim:chatJoin", { room: "Lobby" })
    await t.ask(bob, "aim:chatJoin", { room: "Lobby" })
    const said = await t.ask(alice, "aim:chatSay", { room: "Lobby", text: "hi room" })
    assert.match(said.id, /^[0-9a-f]{20}$/)
    await new Promise((r) => setTimeout(r, 50))
    const bobRoom = (await t.ask(bob, "aim:history", { since: 0 })).messages.find((m) => m.room)
    assert.deepEqual([bobRoom.ck, bobRoom.conv, bobRoom.text], ["#lobby", "#Lobby", "hi room"])
    const roomReact = t.next(alice, "aim:react")
    await t.ask(bob, "aim:react", { id: said.id, ck: "#lobby", emoji: "lol" })
    assert.equal((await roomReact).emoji, "lol")
    // scrolling back
    const older = await t.ask(bob, "aim:historyOlder", { ck: "#lobby", before: Date.now() + 1000 })
    assert.deepEqual(older.messages.map((m) => m.text), ["hi room"])
  } finally {
    t.close()
  }
})

test("sockets: an IM held for someone signed off says Delivered when they sign on", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  const pushStore = memoryPushStore()
  const sent = []
  const push = { enabled: true, wouldSend: async () => true, getStore: async () => pushStore, notify: async (key, category, message) => void sent.push({ key, message }), useAim() {} }
  const t = await setup({ push })
  try {
    const bobFirst = await t.signOn("Bob")
    bobFirst.emit("aim:signOff")
    await new Promise((r) => setTimeout(r, 50))
    const alice = await t.signOn("Alice")
    const held = await t.ask(alice, "aim:im", { to: "Bob", text: "see you later" })
    assert.equal(held.offline, true)
    await new Promise((r) => setTimeout(r, 50))
    assert.equal((await t.ask(alice, "aim:history", { since: 0 })).messages[0].held, true)
    assert.equal(sent[0].message.body, "see you later")

    const delivered = t.next(alice, "aim:delivered")
    const bob = await t.connect()
    const arrives = t.next(bob, "aim:im")
    await t.ask(bob, "aim:signOn", { screenName: "Bob", password: "hunter22" })
    assert.equal((await arrives).id, held.id)
    const notice = await delivered
    assert.deepEqual([notice.ck, notice.ids], ["bob", [held.id]])
    await new Promise((r) => setTimeout(r, 50))
    assert.equal((await t.ask(alice, "aim:history", { since: 0 })).messages[0].held, undefined)
  } finally {
    t.close()
  }
})

test("notification previews never carry the media", () => {
  assert.equal(mediaPreview({ k: "image" }, ""), "📷 Picture")
  assert.equal(mediaPreview({ k: "audio" }, ""), "🎤 Voice message")
  assert.equal(mediaPreview(null, "hi"), "hi")
})

// ---------- pictures and voice messages ----------

let fake
const mediaSetup = async ({ env = {}, budgets, clock = { t: Date.now() } } = {}) => {
  const adapter = vercelAdapter({ token: RW, env: { BLOB_STORE_URL: fake.storeUrl }, maxBytes: 40 * 1024 * 1024 })
  if (budgets) adapter.budgets = () => budgets
  const db = memorySyncStore()
  const bucket = createBucket({ adapter, db, env: {}, now: () => clock.t, log: quiet })
  const media = createMedia({ store: memoryMediaStore(), storage: async () => ({ bucket, adapter, syncedBytes: () => db.bucketTotal() }), env, now: () => clock.t, log: quiet, background: false })
  const send = async (key, bytes, info = { kind: "image", mime: "image/jpeg", w: 10, h: 10 }) => {
    const ticket = await media.upload(key, { ...info, size: bytes.length })
    if (!ticket.ok) return { ticket }
    const put = await fetch(ticket.url, { method: ticket.method, headers: ticket.headers, body: bytes })
    return { ticket, put, commit: await media.commit(key, ticket.id) }
  }
  return { media, bucket, db, clock, send }
}

test("media: upload with a signed URL, size checked, only the two people can fetch it", async (t) => {
  fake = await startFakeBlob({ token: RW })
  process.env.VERCEL_BLOB_API_URL = fake.apiUrl
  process.env.VERCEL_BLOB_RETRIES = "0"
  t.after(() => fake.close())
  const s = await mediaSetup()
  const jpeg = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256))
  const up = await s.send("alice", jpeg)
  assert.equal(up.ticket.ok, true, JSON.stringify(up.ticket))
  assert.equal(up.put.status, 200)
  assert.deepEqual(up.commit, { ok: true })
  const rec = await (await s.media.getStore()).get(up.ticket.id)
  assert.match(rec.path, /^m\/[0-9a-f]{24}\/[0-9a-f]{20}$/, "its own namespace, no account name")
  assert.ok(!rec.path.includes("alice"))

  // the IM carries it to bob; carol can't fetch it
  const meta = await s.media.attach("alice", up.ticket.id, ["bob"])
  assert.deepEqual(meta, { id: up.ticket.id, k: "image", w: 10, h: 10, z: 5000 })
  assert.equal(await s.media.attach("carol", up.ticket.id, ["carol"]), null, "only the sender attaches it")
  const link = await s.media.url("bob", up.ticket.id)
  assert.equal(link.ok, true)
  assert.equal(link.mime, "image/jpeg")
  const back = Buffer.from(await (await fetch(link.url)).arrayBuffer())
  assert.ok(back.equals(jpeg))
  assert.deepEqual(await s.media.url("carol", up.ticket.id), { ok: false, expired: true })

  // wrong kinds and sizes are refused before anything is counted
  assert.equal((await s.media.upload("alice", { kind: "image", mime: "image/gif", size: 10 })).ok, false)
  assert.equal((await s.media.upload("alice", { kind: "image", mime: "image/jpeg", size: 2 * 1024 * 1024 })).ok, false)
  assert.equal((await s.media.upload("alice", { kind: "audio", mime: "audio/mp4;codecs=mp4a.40.2", size: 3000, d: 4, wf: "0123456789" })).ok, true, "voice: AAC in MP4")
  // 3D models (3D Viewer 98): .glb only, up to 2 MB, keeping a cleaned title and the triangle count
  assert.equal((await s.media.upload("alice", { kind: "model", mime: "model/gltf+json", size: 1000 })).ok, false, "only binary glTF")
  assert.equal((await s.media.upload("alice", { kind: "model", mime: "model/gltf-binary", size: 3 * 1024 * 1024 })).ok, false, "over 2 MB")
  const glbBytes = Buffer.alloc(1200, 7)
  const glb = await s.media.upload("alice", { kind: "model", mime: "model/gltf-binary", size: glbBytes.length, title: "Red\u0007 Mug", tris: 12000 })
  assert.equal(glb.ok, true)
  await fetch(glb.url, { method: glb.method, headers: glb.headers, body: glbBytes })
  assert.deepEqual(await s.media.commit("alice", glb.id), { ok: true })
  assert.deepEqual(await s.media.attach("alice", glb.id, ["bob"]), { id: glb.id, k: "model", t: "Red Mug", tr: 12000, z: 1200 })
  assert.equal(mediaPreview({ k: "model", t: "Red Mug" }), "🧊 3D model: Red Mug")

  // a file that didn't arrive whole is refused at commit
  const ticket = await s.media.upload("alice", { kind: "image", mime: "image/jpeg", size: 100 })
  await fetch(ticket.url, { method: ticket.method, headers: ticket.headers, body: Buffer.alloc(100) })
  const short = await s.media.upload("alice", { kind: "image", mime: "image/jpeg", size: 200 })
  assert.equal((await s.media.commit("alice", short.id)).ok, false, "never uploaded")
  assert.equal(await s.media.attach("alice", short.id, ["bob"]), null)
  assert.deepEqual(await s.media.commit("alice", ticket.id), { ok: true })

  // the usage is counted under the media scope too (half of each budget is media's)
  const today = (await s.db.usageDays("2000-01-01")).at(-1)
  assert.ok(today.media_adv >= 3 && today.media_simple >= 2 && today.media_down >= 5000)
  assert.equal(today.adv, today.media_adv)
  // and the bucket counts media's bytes with synced files
  assert.ok((await s.bucket.otherBytes()) >= 5000)
})

test("media: quota, budgets and no bucket all fall back to 'resting'; expiry and Delete My Account", async (t) => {
  fake = await startFakeBlob({ token: RW })
  process.env.VERCEL_BLOB_API_URL = fake.apiUrl
  t.after(() => fake.close())
  const bytes = Buffer.alloc(4000, 7)

  // per-account quota
  const q = await mediaSetup({ env: { MSG_MEDIA_QUOTA_MB: String(6000 / 1024 / 1024) } })
  assert.equal((await q.send("alice", bytes)).commit.ok, true)
  const full = await q.send("alice", bytes)
  assert.equal(full.ticket.ok, false)
  assert.equal(full.ticket.full, true)
  assert.match(full.ticket.error, /MB of pictures and voice messages/)
  assert.equal((await q.send("bob", bytes)).commit.ok, true, "bob has his own")

  // media may use only its share (half) of each budget: 4 uploads a month -> 2 for media
  const budgets = { totalBytes: 100 * 1024 * 1024, rules: [{ field: "adv", days: 31, limit: 4, label: "uploads" }, { field: "simple", days: 31, limit: 100, label: "downloads" }, { field: "down", days: 31, limit: 1e9, label: "download size" }] }
  const b = await mediaSetup({ budgets })
  assert.equal((await b.send("alice", bytes)).commit.ok, true)
  assert.equal((await b.send("alice", bytes)).commit.ok, true)
  const third = await b.send("alice", bytes)
  assert.equal(third.ticket.resting, true)
  assert.ok(Date.parse(third.ticket.until) > Date.now())
  assert.equal((await b.bucket.charge({ adv: 1 })).ok, true, "file sync still has its half")

  // no bucket at all
  const none = createMedia({ store: memoryMediaStore(), storage: async () => null, background: false, log: quiet })
  assert.deepEqual(await none.upload("alice", { kind: "image", mime: "image/jpeg", size: 10 }), { ok: false, resting: true })

  // expiry: 90 days, then "expired" and the object is deleted
  const clock = { t: Date.now() }
  const e = await mediaSetup({ clock })
  const sent = await e.send("alice", bytes)
  await e.media.attach("alice", sent.ticket.id, ["bob"])
  clock.t += 91 * DAY
  assert.deepEqual(await e.media.url("bob", sent.ticket.id), { ok: false, expired: true })
  const path = (await (await e.media.getStore()).get(sent.ticket.id)).path
  assert.ok(fake.objects.has(path))
  assert.equal((await e.media.maintain()).removed, 1)
  assert.ok(!fake.objects.has(path))

  // Delete My Account: what alice sent bob stays his (no longer hers) until it expires; what
  // only she had goes; what she got is no longer hers to fetch
  const d = await mediaSetup()
  const shared = await d.send("alice", bytes)
  await d.media.attach("alice", shared.ticket.id, ["bob"])
  const mine = await d.send("alice", Buffer.alloc(3000, 1))
  const fromBob = await d.send("bob", Buffer.alloc(2000, 2))
  await d.media.attach("bob", fromBob.ticket.id, ["alice"])
  const result = await d.media.eraseAccount({ key: "alice" })
  assert.deepEqual(result, { deleted: 1, keptForOthers: 1 })
  const recs = await d.media.getStore()
  assert.equal((await recs.get(shared.ticket.id)).k, "", "not tied to her any more")
  assert.equal((await d.media.url("bob", shared.ticket.id)).ok, true)
  assert.equal(await recs.get(mine.ticket.id), null)
  assert.deepEqual(await d.media.url("alice", fromBob.ticket.id), { ok: false, expired: true })
  assert.equal((await d.media.url("bob", fromBob.ticket.id)).ok, true)
})

test("sockets: a picture IM: upload, send, the other side fetches it; resting without a bucket", { skip: !ioClient && "socket.io-client not installed" }, async (t) => {
  fake = await startFakeBlob({ token: RW })
  process.env.VERCEL_BLOB_API_URL = fake.apiUrl
  t.after(() => fake.close())
  const s = await mediaSetup()
  const a = await setup({ media: s.media })
  try {
    const alice = await a.signOn("Alice")
    const bob = await a.signOn("Bob")
    const jpeg = Buffer.alloc(6000, 9)
    const ticket = await a.ask(alice, "aim:mediaUpload", { kind: "image", mime: "image/jpeg", size: jpeg.length, w: 800, h: 600 })
    assert.equal(ticket.ok, true)
    await fetch(ticket.url, { method: ticket.method, headers: ticket.headers, body: jpeg })
    assert.equal((await a.ask(alice, "aim:mediaCommit", { id: ticket.id })).ok, true)
    const got = a.next(bob, "aim:im")
    const thumb = `data:image/jpeg;base64,${Buffer.alloc(300, 1).toString("base64")}`
    const sent = await a.ask(alice, "aim:im", { to: "Bob", text: "", media: { id: ticket.id }, thumb })
    assert.equal(sent.ok, true)
    const im = await got
    assert.deepEqual(im.media, { id: ticket.id, k: "image", w: 800, h: 600, z: 6000 })
    assert.equal(im.thumb, thumb, "the preview travels live")
    await new Promise((r) => setTimeout(r, 50))
    const saved = (await a.ask(bob, "aim:history", { since: 0 })).messages[0]
    assert.equal(saved.media.id, ticket.id)
    assert.ok(!JSON.stringify(saved).includes("base64"), "the saved copy is text only")
    const link = await a.ask(bob, "aim:mediaUrl", { id: ticket.id })
    assert.ok(Buffer.from(await (await fetch(link.url)).arrayBuffer()).equals(jpeg))
    // someone else's picture id can't be sent on
    const carol = await a.signOn("Carol")
    assert.equal((await a.ask(carol, "aim:im", { to: "Bob", media: { id: ticket.id } })).ok, false)
  } finally {
    a.close()
  }
  const off = await setup()
  try {
    const alice = await off.signOn("Alice")
    assert.deepEqual(await off.ask(alice, "aim:mediaUpload", { kind: "image", mime: "image/jpeg", size: 10 }), { ok: false, resting: true })
    await off.signOn("Bob")
    assert.equal((await off.ask(alice, "aim:im", { to: "Bob", text: "texts still work" })).ok, true)
  } finally {
    off.close()
  }
})
