// Network Neighborhood over real sockets: names, hiding, file limits, WinPopup, reconnecting
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const path = require("node:path")
const { Server } = require("socket.io")
const { attachNet, MAX_FILE_BYTES } = require("..")

// socket.io-client lives with the web client
let ioClient = null
try {
  ioClient = require(path.join(__dirname, "../../../client/node_modules/socket.io-client"))
} catch {
  ioClient = null
}

const setup = async (options) => {
  const server = http.createServer()
  const io = new Server(server)
  const net = attachNet(io, options)
  await new Promise((r) => server.listen(0, r))
  const url = `http://127.0.0.1:${server.address().port}`
  const sockets = []
  const connect = async (hello = {}) => {
    const socket = ioClient(url, { transports: ["websocket"], forceNew: true })
    sockets.push(socket)
    const me = await new Promise((resolve) => socket.emit("net:hello", hello, resolve))
    return { socket, me, ask: (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve)) }
  }
  const close = () => {
    sockets.forEach((s) => s.close())
    io.close()
    server.close()
  }
  return { net, connect, close }
}

const next = (socket, event) => new Promise((resolve) => socket.once(event, resolve))

test("guests, hiding, files, WinPopup and reconnecting", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  const { connect, close } = await setup({ graceMs: 300 })
  try {
    const a = await connect()
    const b = await connect({ device: "phone" })
    assert.match(a.me.me.name, /^GUEST-[0-9A-F]{4}$/)
    assert.equal(b.me.me.device, "phone")
    const list = (await a.ask("net:list")).computers
    assert.equal(list.length, 2)
    const bId = b.me.me.id

    // files: too big, wrong type, bad name, then a good one
    const big = "x".repeat(MAX_FILE_BYTES + 1)
    assert.match((await a.ask("net:sendFile", { to: { id: bId }, name: "big", content: big, type: "text" })).error, /too big/)
    assert.equal((await a.ask("net:sendFile", { to: { id: bId }, name: "x", content: "hi", type: "executable" })).ok, false)
    assert.equal((await a.ask("net:sendFile", { to: { id: bId }, name: "a/b", content: "hi", type: "text" })).ok, false)
    assert.equal((await a.ask("net:sendFile", { to: { id: a.me.me.id }, name: "me", content: "hi", type: "text" })).ok, false)
    const offered = next(b.socket, "net:fileOffer")
    const sent = await a.ask("net:sendFile", { to: { id: bId }, name: "notes", content: "hello\r\nworld", type: "text" })
    assert.ok(sent.ok)
    const offer = await offered
    assert.equal(offer.name, "notes")
    assert.equal(offer.content, undefined) // the text only comes once accepted
    const result = next(a.socket, "net:fileResult")
    const got = await b.ask("net:fileReply", { id: offer.id, accept: true })
    assert.equal(got.file.content, "hello\nworld")
    assert.equal((await result).status, "accepted")
    assert.equal((await b.ask("net:fileReply", { id: offer.id, accept: true })).ok, false) // only once

    // rate limit: 6 files a minute
    let limited = false
    for (let i = 0; i < 8; i++) {
      const r = await a.ask("net:sendFile", { to: { id: bId }, name: `f${i}`, content: "x", type: "text" })
      if (!r.ok && /too fast|too many files/.test(r.error)) limited = true
    }
    assert.ok(limited)

    // WinPopup
    const popped = next(b.socket, "net:popup")
    assert.ok((await a.ask("net:popup", { to: { id: bId }, text: "  yo  " })).ok)
    assert.equal((await popped).text, "yo")
    assert.equal((await a.ask("net:popup", { to: { id: bId }, text: "x".repeat(501) })).ok, false)

    // hidden computers can't be reached or seen
    await b.ask("net:visible", { visible: false })
    assert.equal((await a.ask("net:list")).computers.length, 1)
    assert.equal((await a.ask("net:popup", { to: { id: bId }, text: "hi" })).ok, false)
    await b.ask("net:visible", { visible: true })

    // reconnecting with the token keeps the same computer
    const token = b.me.token
    b.socket.close()
    const b2 = await connect({ token })
    assert.equal(b2.me.me.id, bId)
    assert.equal(b2.me.me.name, b.me.me.name)

    // a duplicated tab with the same token becomes a new computer
    const b3 = await connect({ token })
    assert.notEqual(b3.me.me.id, bId)

    // gone for good after the grace period
    b2.socket.close()
    await new Promise((r) => setTimeout(r, 500))
    const c = await connect({ token })
    assert.notEqual(c.me.me.id, bId)
  } finally {
    close()
  }
})
