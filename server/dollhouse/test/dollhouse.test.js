// Dream House's shared-house server: only the two partners can read or change their house,
// edits merge by version, everything is checked, sizes and rates are capped, and houses of
// couples who unpaired are out of reach at once and deleted 30 days later.
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const express = require("express")
const dollhouse = require("..")

const modelUrl = pathToFileURL(path.join(__dirname, "../../../client/src/components/applets/dollhouse/model.js")).href

const fakeAim = () => {
  const users = { alice: "Alice", bobby: "Bobby", carol: "Carol", dave: "Dave" }
  const socket = () => ({ events: [], emit(event, payload) { this.events.push({ event, payload }) } })
  const sessions = new Map(Object.keys(users).map((key) => [key, { key, user: { screenName: users[key] }, socket: socket() }]))
  const tokens = Object.fromEntries(Object.keys(users).map((key) => [key[0].repeat(48), key]))
  return { sessions, authenticate: (token) => sessions.get(tokens[token]) || null }
}
const TOKEN = { alice: "a".repeat(48), bobby: "b".repeat(48), carol: "c".repeat(48), dave: "d".repeat(48) }

const serve = (options = {}) => {
  const aim = fakeAim()
  // alice + bobby are a couple; carol + dave are another; anyone else is single
  const pairs = { alice: "c1", bobby: "c1", carol: "c2", dave: "c2", ...(options.pairs || {}) }
  const couples = { coupleIdOf: (key) => pairs[key] || null }
  const store = dollhouse.memoryStore()
  const router = dollhouse.dollhouseRouter({ store, aim, coupleIdOf: couples.coupleIdOf, sweepEvery: 0, ...options.router })
  const app = express()
  app.use("/api/dollhouse", router)
  const server = http.createServer(app).listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api/dollhouse`
  const call = (method, p, body, who) =>
    fetch(base + p, {
      method,
      headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${TOKEN[who]}` } : {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
  return { aim, server, call, pairs, store, router }
}

test("signing on and being paired are required", async () => {
  const { server, call, pairs } = serve()
  try {
    assert.equal((await call("GET", "", undefined, null)).status, 401)
    delete pairs.dave
    const single = await call("GET", "", undefined, "dave")
    assert.equal(single.status, 403)
    const empty = await call("GET", "", undefined, "alice")
    assert.equal(empty.status, 200)
    assert.equal(empty.house, null)
  } finally {
    server.close()
  }
})

test("partners share one house, live; another couple never sees it", async () => {
  const M = await import(modelUrl)
  const { server, call, aim } = serve()
  try {
    const mine = M.starterHouse("alice1")
    const put = await call("PUT", "", { house: M.serialize(mine) }, "alice")
    assert.equal(put.status, 200)
    assert.equal(put.rev, 1)
    const got = await call("GET", "", undefined, "bobby")
    assert.equal(got.status, 200)
    assert.deepEqual(got.house, M.serialize(mine))
    // bobby moves the sofa: alice's socket hears about it
    const shared = M.deserialize(got.house)
    const sofa = M.live(shared).find((i) => i.k === "sofa")
    const ops = M.moveItem(shared, sofa.id, 400, 700, "bob1").ops
    const sent = await call("POST", "/ops", { ops }, "bobby")
    assert.equal(sent.status, 200)
    assert.equal(sent.accepted, 1)
    const heard = aim.sessions.get("alice").socket.events.find((e) => e.event === "dollhouse:ops")
    assert.ok(heard, "alice heard the edit")
    assert.deepEqual(heard.payload.ops, ops)
    assert.equal(aim.sessions.get("bobby").socket.events.filter((e) => e.event === "dollhouse:ops").length, 0, "not echoed back")
    // carol (another couple) gets her own, empty house and can't touch theirs
    const carol = await call("GET", "", undefined, "carol")
    assert.equal(carol.house, null)
    const carolOps = await call("POST", "/ops", { ops }, "carol")
    assert.equal(carolOps.status, 404)
    assert.equal(aim.sessions.get("carol").socket.events.length, 0)
    assert.equal(aim.sessions.get("dave").socket.events.length, 0)
  } finally {
    server.close()
  }
})

test("a third account with the same couple id still can't get in", async () => {
  const M = await import(modelUrl)
  const { server, call, pairs } = serve()
  try {
    await call("PUT", "", { house: M.serialize(M.emptyHouse()) }, "alice")
    await call("GET", "", undefined, "bobby")
    pairs.carol = "c1" // pretend the couples module got confused
    assert.equal((await call("GET", "", undefined, "carol")).status, 403)
    assert.equal((await call("PUT", "", { house: M.serialize(M.emptyHouse()) }, "carol")).status, 403)
    assert.equal((await call("POST", "/ops", { ops: M.addItem(M.emptyHouse(), "cake", 1, 1, "c").ops }, "carol")).status, 403)
    assert.equal((await call("DELETE", "", undefined, "carol")).status, 403)
  } finally {
    server.close()
  }
})

test("concurrent edits: the newer version wins, the loser gets the current one back", async () => {
  const M = await import(modelUrl)
  const { server, call } = serve()
  try {
    const base = M.starterHouse("s")
    await call("PUT", "", { house: M.serialize(base) }, "alice")
    const a = M.deserialize(M.serialize(base))
    const b = M.deserialize(M.serialize(base))
    const lamp = M.live(base).find((i) => i.k === "floor_lamp")
    const aOps = M.moveItem(a, lamp.id, 200, 700, "alice1").ops
    const bOps = M.moveItem(b, lamp.id, 400, 700, "bobby1").ops // same version, higher tag
    const first = await call("POST", "/ops", { ops: bOps }, "bobby")
    assert.equal(first.accepted, 1)
    const second = await call("POST", "/ops", { ops: aOps }, "alice")
    assert.equal(second.accepted, 0)
    assert.equal(second.current.length, 1)
    assert.deepEqual(second.current[0], bOps[0])
    // a later edit by alice (higher version) wins
    M.applyOp(a, second.current[0])
    const third = await call("POST", "/ops", { ops: M.flipItem(a, lamp.id, "alice1").ops }, "alice")
    assert.equal(third.accepted, 1)
    const now = M.deserialize((await call("GET", "", undefined, "bobby")).house)
    assert.equal(now.items[lamp.id].f, 1)
    assert.equal(now.items[lamp.id].x, b.items[lamp.id].x)
  } finally {
    server.close()
  }
})

test("everything is checked: bad houses, bad ops, too many ops, too big", async () => {
  const M = await import(modelUrl)
  const { server, call } = serve({ router: { maxBytes: 3000 } })
  try {
    assert.equal((await call("PUT", "", { house: "nope" }, "alice")).status, 400)
    assert.equal((await call("PUT", "", { house: { hello: 1 } }, "alice")).status, 400)
    assert.equal((await call("PUT", "", "{bad json", "alice")).status, 400)
    assert.equal((await call("POST", "/ops", { ops: [] }, "alice")).status, 400)
    assert.equal((await call("POST", "/ops", { ops: [{ t: "i", e: [] }] }, "alice")).status, 404, "no house yet")
    // a big house is over this server's small cap
    const big = M.emptyHouse()
    for (let i = 0; i < 120; i++) M.addItem(big, "duck", 100 + i, 700, "s")
    assert.equal((await call("PUT", "", { house: M.serialize(big) }, "alice")).status, 413)
    const h = M.emptyHouse()
    assert.equal((await call("PUT", "", { house: M.serialize(h) }, "alice")).status, 200)
    // junk ops are counted and skipped; names are cleaned; nothing becomes HTML
    const person = M.addItem(h, "avatar", 100, 700, "a", { name: "<b>Hi</b>" }).ops
    const r = await call("POST", "/ops", { ops: [{ t: "i", e: ["x1", "rocket", 1, 1, 0, 0, 1, "a"] }, { t: "r", id: "moon", e: ["cream", "oak", 1, "a"] }, ...person] }, "alice")
    assert.equal(r.status, 200)
    assert.equal(r.invalid, 2)
    assert.equal(r.accepted, 1)
    const got = M.deserialize((await call("GET", "", undefined, "bobby")).house)
    assert.equal(M.live(got)[0].name, "<b>Hi</b>".slice(0, 16), "kept as plain text")
    const tooMany = Array.from({ length: dollhouse.MAX_OPS + 1 }, () => person[0])
    assert.equal((await call("POST", "/ops", { ops: tooMany }, "alice")).status, 400)
    // filling the house past the size cap is refused
    let status = 200
    for (let i = 0; i < 20 && status === 200; i++) {
      const ops = []
      for (let k = 0; k < 10; k++) ops.push(...M.addItem(h, "duck", 100 + k, 700, "a").ops)
      status = (await call("POST", "/ops", { ops }, "alice")).status
    }
    assert.equal(status, 413)
  } finally {
    server.close()
  }
})

test("writes are rate limited", async () => {
  const M = await import(modelUrl)
  const { server, call } = serve({ router: { limits: { writesPerMinute: 3 } } })
  try {
    const h = M.emptyHouse()
    await call("PUT", "", { house: M.serialize(h) }, "alice")
    const statuses = []
    for (let i = 0; i < 4; i++) statuses.push((await call("POST", "/ops", { ops: M.addItem(h, "cake", 100, 700, "a").ops }, "alice")).status)
    assert.deepEqual(statuses, [200, 200, 429, 429])
    assert.equal((await call("POST", "/ops", { ops: M.addItem(h, "cake", 100, 700, "b").ops }, "bobby")).status, 200, "per account")
  } finally {
    server.close()
  }
})

test("deleting: either partner can, and the other one hears", async () => {
  const M = await import(modelUrl)
  const { server, call, aim } = serve()
  try {
    await call("PUT", "", { house: M.serialize(M.emptyHouse()) }, "alice")
    await call("GET", "", undefined, "bobby")
    assert.equal((await call("DELETE", "", undefined, "bobby")).status, 200)
    assert.equal((await call("GET", "", undefined, "alice")).house, null)
    assert.ok(aim.sessions.get("alice").socket.events.some((e) => e.event === "dollhouse:deleted"))
  } finally {
    server.close()
  }
})

test("after unpairing: out of reach at once, deleted after 30 days, kept if they pair again", async () => {
  const M = await import(modelUrl)
  const { server, call, pairs, store, router } = serve()
  try {
    await call("PUT", "", { house: M.serialize(M.emptyHouse()) }, "alice")
    await call("GET", "", undefined, "bobby")
    await call("PUT", "", { house: M.serialize(M.emptyHouse()) }, "carol")
    delete pairs.alice
    delete pairs.bobby
    assert.equal((await call("GET", "", undefined, "alice")).status, 403)
    const t0 = Date.now()
    await router.sweep(t0)
    assert.ok((await store.get("c1")).orphanedAt, "marked")
    assert.equal((await store.get("c2")).orphanedAt, null, "the other couple is fine")
    // they make up within the month: the mark goes away
    pairs.alice = pairs.bobby = "c1"
    await router.sweep(t0 + 1000)
    assert.equal((await store.get("c1")).orphanedAt, null)
    delete pairs.alice
    delete pairs.bobby
    await router.sweep(t0 + 2000)
    assert.equal(await router.sweep(t0 + 2000 + dollhouse.KEEP_UNPAIRED_MS - 10_000), 0)
    assert.equal(await router.sweep(t0 + 3000 + dollhouse.KEEP_UNPAIRED_MS), 1)
    assert.equal(await store.get("c1"), null)
    assert.ok(await store.get("c2"))
  } finally {
    server.close()
  }
})
