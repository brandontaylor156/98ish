// 98 Messenger "Sign me on automatically": a device's remember token signs it on again
// without the password, is stored only as a hash, refreshes on use, and is forgotten when
// the device signs off on purpose. Over real sockets.
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const path = require("node:path")
const { Server } = require("socket.io")
const { attachAim } = require("..")
const { createStore } = require("../store")

let ioClient = null
try {
  ioClient = require(path.join(__dirname, "../../../client/node_modules/socket.io-client"))
} catch {
  ioClient = null
}

const setup = async () => {
  const server = http.createServer()
  const io = new Server(server)
  const store = await createStore("")
  await attachAim(io, { store })
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
  const close = () => {
    sockets.forEach((s) => s.close())
    io.close()
    server.close()
  }
  return { store, connect, ask, close }
}

test("remember me: sign on again with the token, hashed, refreshed, forgotten on sign off", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  const { store, connect, ask, close } = await setup()
  try {
    const a = await connect()
    const first = await ask(a, "aim:signOn", { screenName: "Rosie", password: "hunter22", register: true, remember: true })
    assert.equal(first.ok, true)
    assert.match(first.remember, /^[0-9a-f]{64}$/)
    const stored = (await store.find("rosie")).remember
    assert.equal(stored.length, 1)
    assert.notEqual(stored[0].hash, first.remember, "only a hash is kept")
    assert.ok(!JSON.stringify(first.me).includes(stored[0].hash), "the hash never goes to the client")

    // without remember: no token
    const b = await connect()
    assert.equal((await ask(b, "aim:signOn", { screenName: "Theo", password: "hunter22", register: true })).remember, undefined)

    // a new page (new socket) signs on with the token, and bumps the old one
    const kicked = new Promise((r) => a.on("aim:kicked", r))
    const c = await connect()
    const again = await ask(c, "aim:signOnRemembered", { screenName: "rosie", token: first.remember })
    assert.equal(again.ok, true)
    assert.equal(again.me.screenName, "Rosie")
    assert.equal(again.remember, undefined, "the same token stays in use")
    await kicked
    assert.ok((await store.find("rosie")).remember[0].expiresAt >= stored[0].expiresAt, "refreshed on use")

    // wrong token, wrong name, junk: refused
    const d = await connect()
    assert.equal((await ask(d, "aim:signOnRemembered", { screenName: "rosie", token: "f".repeat(64) })).ok, false)
    assert.equal((await ask(d, "aim:signOnRemembered", { screenName: "theo", token: first.remember })).ok, false)
    assert.equal((await ask(d, "aim:signOnRemembered", { screenName: "rosie", token: "x".repeat(500) })).ok, false)
    assert.equal((await ask(d, "aim:signOnRemembered", {})).ok, false)

    // expired tokens don't work
    await store.update("rosie", { remember: [{ ...(await store.find("rosie")).remember[0], expiresAt: Date.now() - 1 }] })
    assert.equal((await ask(d, "aim:signOnRemembered", { screenName: "rosie", token: first.remember })).ok, false)

    // forgetting: a fresh token, then sign off on purpose
    const e = await connect()
    const fresh = await ask(e, "aim:signOn", { screenName: "Rosie", password: "hunter22", remember: true })
    assert.equal((await store.find("rosie")).remember.length, 1, "expired ones are dropped")
    e.emit("aim:forget", { token: fresh.remember })
    await new Promise((r) => setTimeout(r, 100))
    assert.equal((await store.find("rosie")).remember.length, 0)
    const f = await connect()
    assert.equal((await ask(f, "aim:signOnRemembered", { screenName: "rosie", token: fresh.remember })).ok, false)

    // at most six devices per account
    for (let i = 0; i < 8; i++) {
      const s = await connect()
      await ask(s, "aim:signOn", { screenName: "Theo", password: "hunter22", remember: true })
    }
    assert.equal((await store.find("theo")).remember.length, 6)
  } finally {
    close()
  }
})
