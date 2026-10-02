const test = require("node:test")
const assert = require("node:assert/strict")
const express = require("express")
const { driveRouter } = require("..")
const { memoryStore } = require("../store")
const { validateSnapshot } = require("../validate")

const TOKEN_A = "a".repeat(48)
const TOKEN_B = "b".repeat(48)

const drive = (files = []) => ({
  root: [{ k: "d", n: "C:", t: "drive", m: {}, c: [{ k: "d", n: "Documents", t: "documents", m: {}, c: files }] }],
  bin: [],
})
const snapshot = (files) => ({ drive: drive(files), achievements: { unlocked: { bsod: 1700000000000 }, progress: { "paint-tools": ["pencil"] } } })
const note = (name, text) => ({ k: "f", n: name, t: "text", x: text, m: {} })

// A server with two signed-on 98 Messenger sessions (alice, bob); sessions can sign off
const start = async (options = {}) => {
  const sessions = new Map([
    ["alice", { key: "alice", token: TOKEN_A, user: { screenName: "Alice" } }],
    ["bob", { key: "bob", token: TOKEN_B, user: { screenName: "Bob" } }],
  ])
  const app = express()
  app.use("/api/drive", driveRouter({ aim: Promise.resolve({ sessions }), store: memoryStore(), ...options }))
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/drive`
  const call = async (method, path, { token = TOKEN_A, body, raw } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body || raw ? { "Content-Type": "application/json" } : {}) },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    })
    return { status: response.status, body: await response.json() }
  }
  return { sessions, call, close: () => server.close() }
}

test("validator accepts a drive and rejects damaged ones", () => {
  assert.ok(validateSnapshot(snapshot([note("hi", "there")])).ok)
  const bad = [
    null,
    {},
    { drive: { root: [] } }, // no C:
    { drive: { root: [{ k: "d", n: "D:", t: "drive", c: [] }] } },
    { drive: drive([{ k: "x", n: "a", t: "text", x: "" }]) },
    { drive: drive([{ k: "f", n: "a/b", t: "text", x: "" }]) },
    { drive: drive([{ k: "f", n: " padded", t: "text", x: "" }]) },
    { drive: drive([{ k: "f", n: "a", t: "Text!", x: "" }]) },
    { drive: drive([{ k: "f", n: "a", t: "text", x: 5 }]) },
    { drive: drive([{ k: "d", n: "a", t: "folder", c: "nope" }]) },
    { drive: drive([{ k: "f", n: "a", t: "text", x: "", m: { big: "x".repeat(3000) } }]) },
    { drive: drive(), achievements: { unlocked: { "<script>": 1 } } },
    { drive: drive(), achievements: { unlocked: { bsod: "yesterday" } } },
    { drive: drive(), achievements: { progress: { paint: "pencil" } } },
  ]
  for (const s of bad) assert.equal(validateSnapshot(s).ok, false, JSON.stringify(s)?.slice(0, 80))

  // too deep, too many
  let deep = note("leaf", "")
  for (let i = 0; i < 50; i++) deep = { k: "d", n: `d${i}`, t: "folder", c: [deep] }
  assert.match(validateSnapshot({ drive: drive([deep]) }).error, /nested/)
  const many = Array.from({ length: 20_001 }, (_, i) => note(`f${i}`, ""))
  assert.match(validateSnapshot({ drive: drive(many) }).error, /too many/)

  // unknown top-level fields are dropped
  const kept = validateSnapshot({ ...snapshot(), settings: { evil: true } })
  assert.equal(kept.snapshot.settings, undefined)
})

test("every request needs a signed-on 98 Messenger session", async () => {
  const server = await start()
  try {
    assert.equal((await server.call("GET", "/", { token: null })).status, 401)
    assert.equal((await server.call("GET", "/", { token: "c".repeat(48) })).status, 401)
    assert.equal((await server.call("GET", "/", { token: "not a token" })).status, 401)
    assert.equal((await server.call("PUT", "/", { token: null, body: { baseRevision: 0, snapshot: snapshot() } })).status, 401)
    const ok = await server.call("GET", "/")
    assert.equal(ok.status, 200)
    assert.deepEqual([ok.body.revision, ok.body.snapshot], [0, null])

    // signing off (or being bumped by a sign on elsewhere) ends the token
    server.sessions.delete("alice")
    assert.equal((await server.call("GET", "/info")).status, 401)
  } finally {
    server.close()
  }
})

test("saves, revisions and conflicts", async () => {
  const server = await start()
  try {
    const first = await server.call("PUT", "/", { body: { baseRevision: 0, snapshot: snapshot([note("one", "1")]) } })
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.revision, 1)
    assert.ok(Date.parse(first.body.savedAt))

    const got = await server.call("GET", "/")
    assert.equal(got.body.revision, 1)
    assert.equal(got.body.snapshot.drive.root[0].c[0].c[0].x, "1")
    assert.deepEqual(got.body.snapshot.achievements.unlocked, { bsod: 1700000000000 })
    assert.ok(got.body.size > 100)

    const second = await server.call("PUT", "/", { body: { baseRevision: 1, snapshot: snapshot([note("one", "2")]) } })
    assert.equal(second.body.revision, 2)

    // another device still based on revision 1: refused, told about revision 2
    const stale = await server.call("PUT", "/", { body: { baseRevision: 1, snapshot: snapshot([note("one", "old")]) } })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.conflict, true)
    assert.equal(stale.body.revision, 2)
    // creating when one exists is a conflict too
    assert.equal((await server.call("PUT", "/", { body: { baseRevision: 0, snapshot: snapshot() } })).status, 409)
    assert.equal((await server.call("GET", "/")).body.snapshot.drive.root[0].c[0].c[0].x, "2")

    // accounts are separate
    assert.equal((await server.call("GET", "/info", { token: TOKEN_B })).body.revision, 0)

    // info has no snapshot
    const meta = await server.call("GET", "/info")
    assert.equal(meta.body.revision, 2)
    assert.equal(meta.body.snapshot, undefined)

    // bad requests
    assert.equal((await server.call("PUT", "/", { body: { snapshot: snapshot() } })).status, 400)
    assert.equal((await server.call("PUT", "/", { body: { baseRevision: 2, snapshot: { drive: { root: [] } } } })).status, 400)
    assert.equal((await server.call("PUT", "/", { raw: "{not json" })).status, 400)

    assert.equal((await server.call("DELETE", "/")).status, 200)
    assert.equal((await server.call("GET", "/info")).body.revision, 0)
  } finally {
    server.close()
  }
})

test("size cap per account", async () => {
  const server = await start({ maxBytes: 50_000 })
  try {
    const big = await server.call("PUT", "/", { body: { baseRevision: 0, snapshot: snapshot([note("big", "x".repeat(60_000))]) } })
    assert.equal(big.status, 413)
    assert.match(big.body.error, /MB/)
    // way over: refused by the body parser, still JSON
    const huge = await server.call("PUT", "/", { body: { baseRevision: 0, snapshot: snapshot([note("big", "x".repeat(400_000))]) } })
    assert.equal(huge.status, 413)
    assert.equal(huge.body.ok, false)
    assert.equal((await server.call("PUT", "/", { body: { baseRevision: 0, snapshot: snapshot([note("small", "x".repeat(1000))]) } })).status, 200)
  } finally {
    server.close()
  }
})

test("rate limits writes per account and bad tokens per IP", async () => {
  const server = await start({ limits: { writes: 3, reads: 100, badTokens: 4 } })
  try {
    let revision = 0
    for (let i = 0; i < 3; i++) {
      const r = await server.call("PUT", "/", { body: { baseRevision: revision, snapshot: snapshot() } })
      assert.equal(r.status, 200)
      revision = r.body.revision
    }
    assert.equal((await server.call("PUT", "/", { body: { baseRevision: revision, snapshot: snapshot() } })).status, 429)
    assert.equal((await server.call("GET", "/info")).status, 200) // reads still fine
    assert.equal((await server.call("PUT", "/", { token: TOKEN_B, body: { baseRevision: 0, snapshot: snapshot() } })).status, 200)

    for (let i = 0; i < 4; i++) assert.equal((await server.call("GET", "/", { token: "d".repeat(48) })).status, 401)
    assert.equal((await server.call("GET", "/", { token: "d".repeat(48) })).status, 429)
  } finally {
    server.close()
  }
})

let ioClient = null
try {
  ioClient = require(require("node:path").join(__dirname, "../../../client/node_modules/socket.io-client"))
} catch {
  // the client's packages aren't installed: skip the socket test
}

test("works with 98 Messenger's real session tokens", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  // the same shape attachAim returns: { store, sessions } with session.token from sign on
  const { attachAim } = require("../../aim")
  const http = require("node:http")
  const { Server } = require("socket.io")
  const connect = ioClient.io
  const app = express()
  let aim
  app.use("/api/drive", driveRouter({ aim: () => aim, store: memoryStore() }))
  const server = http.createServer(app)
  const io = new Server(server)
  aim = attachAim(io, { bot: { reply: async () => "", forget: () => {} } })
  await new Promise((resolve) => server.listen(0, resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const socket = connect(url, { transports: ["websocket"] })
  try {
    const welcome = await new Promise((resolve) =>
      socket.emit("aim:signOn", { screenName: `Drive${Date.now() % 100000}`, password: "hunter22", register: true }, resolve)
    )
    assert.ok(welcome.ok, welcome.error)
    const put = await fetch(`${url}/api/drive`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${welcome.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ baseRevision: 0, snapshot: snapshot([note("hello", "world")]) }),
    })
    assert.equal(put.status, 200)
    socket.emit("aim:signOff")
    await new Promise((resolve) => setTimeout(resolve, 100))
    const after = await fetch(`${url}/api/drive/info`, { headers: { Authorization: `Bearer ${welcome.token}` } })
    assert.equal(after.status, 401)
  } finally {
    socket.close()
    io.close()
    server.close()
  }
})
