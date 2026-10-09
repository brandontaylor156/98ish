// Memories from My Park (Pickleball 98 > My Park > Together) in Our Story: kinds, caps, the
// couple's best rally, only the pair, and Delete My Account.
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const express = require("express")
const couples = require("..")
const { memoryStore } = require("../store")

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
const TOKENS = { alice: "a".repeat(48), bobby: "b".repeat(48), carol: "c".repeat(48) }

const serve = () => {
  const users = { alice: { key: "alice", screenName: "Alice", blocked: [] }, bobby: { key: "bobby", screenName: "Bobby", blocked: [] }, carol: { key: "carol", screenName: "Carol", blocked: [] } }
  const socket = () => ({ events: [], emit(event, payload) { this.events.push({ event, payload }) } })
  const sessions = new Map(Object.values(users).map((u) => [u.key, { key: u.key, user: u, socket: socket() }]))
  const byToken = Object.fromEntries(Object.entries(TOKENS).map(([k, t]) => [t, k]))
  const aim = { users, sessions, authenticate: (t) => sessions.get(byToken[t]) || null, store: { find: async (key) => users[key] || null } }
  const store = memoryStore()
  const service = couples.createCouples({ store, aim, now: () => Date.UTC(2026, 9, 9, 18), limits: { writesPerMinute: 1000, writesPerHour: 10000, pairRequestsPerHour: 1000 } })
  const app = express()
  app.use("/api/couples", couples.couplesRouter({ service }))
  const server = http.createServer(app).listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api/couples`
  const call = (who, method, path, body) =>
    fetch(base + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${TOKENS[who]}` }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ ...(await r.json().catch(() => ({}))), http: r.status }))
  const events = (who, name) => sessions.get(who).socket.events.filter((e) => e.event === name)
  return { call, service, store, events, close: () => (server.close(), service.close()) }
}
const pair = async (call) => {
  assert.equal((await call("alice", "POST", "/request", { to: "Bobby" })).http, 200)
  assert.equal((await call("bobby", "POST", "/accept", {})).http, 200)
}
const mem = (kind, extra = {}) => ({ memory: { kind, venue: "Newport Beach Club", date: "2026-10-09", ...extra } })

test("park memories: a selfie with its photo, date night once a day, the partner hears", async () => {
  const { call, events, close } = serve()
  try {
    // not paired: nothing
    assert.equal((await call("alice", "POST", "/park", mem("datenight"))).http, 403)
    await pair(call)
    const s = await call("alice", "POST", "/park", mem("selfie", { photo: PNG, golden: true }))
    assert.equal(s.http, 200)
    assert.equal(s.moment.title, "Selfie at Newport Beach Club")
    assert.equal(s.moment.text, "Golden hour.")
    assert.equal(s.moment.auto, "park")
    assert.equal(s.moment.parkKind, "selfie")
    assert.equal(s.moment.photos.length, 1)
    assert.ok(events("bobby", "couple:story").length >= 1)
    // the partner sees it in Our Story, with the picture
    const story = await call("bobby", "GET", "/story")
    assert.equal(story.moments.length, 1)
    assert.equal((await call("bobby", "GET", `/photos/${s.moment.photos[0].id}`)).photo.data, PNG)
    // date night: one a day per venue (both browsers may send it)
    const d1 = await call("alice", "POST", "/park", mem("datenight"))
    const d2 = await call("bobby", "POST", "/park", mem("datenight"))
    assert.equal(d2.duplicate, true)
    assert.equal(d2.moment.id, d1.moment.id)
    assert.equal((await call("alice", "POST", "/park", mem("datenight", { date: "2026-10-10" }))).http, 200)
    // the kinds, and the checks
    assert.equal((await call("alice", "POST", "/park", mem("dance"))).http, 400)
    assert.equal((await call("alice", "POST", "/park", mem("sunset", { venue: "" }))).http, 400)
    assert.equal((await call("alice", "POST", "/park", mem("sunset", { date: "yesterday" }))).http, 400)
    assert.equal((await call("alice", "POST", "/park", mem("selfie", { photo: "javascript:alert(1)" }))).http, 400)
    // a park memory stays one when edited in Our Story
    const ed = await call("bobby", "PUT", `/moments/${d1.moment.id}`, { moment: { date: "2026-10-09", title: "Our date night", text: "So fun", location: "Newport Beach Club", mood: "cozy" } })
    assert.equal(ed.moment.auto, "park")
    assert.equal(ed.moment.title, "Our date night")
  } finally {
    close()
  }
})

test("park memories: the couple's best rally only goes up; caps", async () => {
  const { call, close } = serve()
  try {
    await pair(call)
    assert.equal((await call("alice", "GET", "/park")).best, 0)
    const r1 = await call("alice", "POST", "/park", mem("rally", { streak: 12 }))
    assert.equal(r1.record, true)
    assert.equal(r1.moment.title, "New rally record: 12 in a row")
    // the same streak from the other browser: no new record
    const r2 = await call("bobby", "POST", "/park", mem("rally", { streak: 12 }))
    assert.equal(r2.record, false)
    assert.equal(r2.best, 12)
    assert.equal((await call("bobby", "POST", "/park", mem("rally", { streak: 0 }))).http, 400)
    assert.equal((await call("bobby", "POST", "/park", mem("rally", { streak: 3.5 }))).http, 400)
    const r3 = await call("bobby", "POST", "/park", mem("rally", { streak: 23 }))
    assert.equal(r3.record, true)
    assert.equal((await call("alice", "GET", "/park")).best, 23)
    // one record moment in the story (the old one made way)
    const story = await call("alice", "GET", "/story")
    assert.deepEqual(story.moments.filter((m) => m.parkKind === "rally").map((m) => m.title), ["New rally record: 23 in a row"])
    // selfies: a few a day
    for (let i = 0; i < 6; i++) assert.equal((await call("alice", "POST", "/park", mem("selfie", { photo: PNG }))).http, 200)
    assert.match((await call("alice", "POST", "/park", mem("selfie", { photo: PNG }))).error, /a lot of selfies/)
    // at most 60 park memories: the oldest go (with their photos)
    for (let d = 1; d <= 62; d++) {
      const day = `2026-11-${String((d % 28) + 1).padStart(2, "0")}`
      await call("alice", "POST", "/park", mem("sunset", { venue: `Court ${d}`, date: day }))
    }
    const after = await call("alice", "GET", "/story")
    assert.equal(after.moments.filter((m) => m.auto === "park").length, 60)
    assert.equal(after.moments.filter((m) => m.parkKind === "selfie").length, 0)
    const photos = await call("alice", "GET", "/photos")
    assert.equal(photos.photos.length, 0)
  } finally {
    close()
  }
})

test("park memories: only the pair, and Delete My Account takes them", async () => {
  const { call, service, store, close } = serve()
  try {
    await pair(call)
    const s = await call("alice", "POST", "/park", mem("selfie", { photo: PNG }))
    await call("alice", "POST", "/park", mem("rally", { streak: 9 }))
    // a third account sees nothing
    assert.equal((await call("carol", "GET", "/park")).http, 403)
    assert.equal((await call("carol", "POST", "/park", mem("datenight"))).http, 403)
    assert.equal((await call("carol", "GET", `/photos/${s.moment.photos[0].id}`)).http, 403)
    const coupleId = (await call("alice", "GET", "/")).coupleId
    assert.ok((await store.items.list(coupleId, "parkbest")).length === 1)
    await service.eraseAccount({ key: "alice", coupleIds: [], partners: [{ key: "bobby" }] })
    assert.equal((await store.items.list(coupleId, "moment")).length, 0)
    assert.equal((await store.items.list(coupleId, "photo")).length, 0)
    assert.equal((await store.items.list(coupleId, "parkbest")).length, 0)
    // (idempotent)
    await service.eraseAccount({ key: "alice", coupleIds: [], partners: [] })
  } finally {
    close()
  }
})
