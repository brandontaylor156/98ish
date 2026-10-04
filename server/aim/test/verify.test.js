// 98ish lock screen "Forgot PIN?": aim:verify checks a screen name and password without
// signing on, and counts failures like signing on does. Over real sockets.
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

test("aim:verify: right password ok without a session, wrong ones refused and limited", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  const server = http.createServer()
  const io = new Server(server)
  const store = await createStore("")
  const aim = await attachAim(io, { store })
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
  try {
    const a = await connect()
    assert.equal((await ask(a, "aim:signOn", { screenName: "Rosie", password: "hunter22", register: true })).ok, true)
    a.close()
    await new Promise((r) => setTimeout(r, 50))

    const b = await connect()
    const ok = await ask(b, "aim:verify", { screenName: "rosie", password: "hunter22" })
    assert.deepEqual(ok, { ok: true, screenName: "Rosie" })
    assert.ok(![...aim.sessions.values()].some((s) => s.socket === b), "verifying doesn't sign on")

    assert.equal((await ask(b, "aim:verify", { screenName: "rosie", password: "wrong-one" })).ok, false)
    assert.equal((await ask(b, "aim:verify", { screenName: "nobody", password: "hunter22" })).ok, false)
    assert.equal((await ask(b, "aim:verify", { screenName: "SmarterChild", password: "hunter22" })).ok, false)
    assert.equal((await ask(b, "aim:verify", {})).ok, false)

    // 8 failures per screen name in 5 minutes: then even the right password waits
    for (let i = 0; i < 8; i++) await ask(b, "aim:verify", { screenName: "rosie", password: `nope${i}` })
    const limited = await ask(b, "aim:verify", { screenName: "rosie", password: "hunter22" })
    assert.equal(limited.ok, false)
    assert.match(limited.error, /Too many/)
  } finally {
    sockets.forEach((s) => s.close())
    io.close()
    server.close()
  }
})
