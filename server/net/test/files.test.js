// Sending pictures and sounds over Network Neighborhood: data URL checks, size limits,
// thumbnails, and moves for the new board games over real sockets
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const path = require("node:path")
const { Server } = require("socket.io")
const { attachNet, MAX_DATA_BYTES } = require("..")
const { ready } = require("../rules")

let ioClient = null
try {
  ioClient = require(path.join(__dirname, "../../../client/node_modules/socket.io-client"))
} catch {
  ioClient = null
}

const setup = async () => {
  const server = http.createServer()
  const io = new Server(server, { maxHttpBufferSize: 2 * 1024 * 1024 })
  attachNet(io, { graceMs: 200 })
  await new Promise((r) => server.listen(0, r))
  const url = `http://127.0.0.1:${server.address().port}`
  const sockets = []
  const connect = async () => {
    const socket = ioClient(url, { transports: ["websocket"], forceNew: true })
    sockets.push(socket)
    const me = await new Promise((resolve) => socket.emit("net:hello", {}, resolve))
    return { socket, me, ask: (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve)) }
  }
  return {
    connect,
    close: () => {
      sockets.forEach((s) => s.close())
      io.close()
      server.close()
    },
  }
}

const next = (socket, event) => new Promise((resolve) => socket.once(event, resolve))
// a 1x1 PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

test("pictures and sounds: checked, limited, previewed, delivered", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  await ready
  const { connect, close } = await setup()
  try {
    const a = await connect()
    const b = await connect()
    const to = { id: b.me.me.id }
    const send = (extra) => a.ask("net:sendFile", { to, name: "pic", type: "image", content: PNG, ...extra })

    // not a picture, a picture of the wrong kind, broken base64, too big
    assert.match((await send({ content: "hello" })).error, /damaged/)
    assert.match((await send({ content: "data:text/html;base64,PGI+" })).error, /damaged/)
    assert.match((await send({ content: "data:image/svg+xml;base64,PHN2Zz4=" })).error, /damaged/)
    assert.match((await send({ content: "data:image/png;base64,<script>" })).error, /damaged/)
    const huge = "data:image/png;base64," + "A".repeat(MAX_DATA_BYTES)
    assert.match((await send({ content: huge })).error, /too big.*1\.5 MB/)
    assert.match((await send({ type: "program" })).error, /can't be sent/)
    assert.match((await send({ type: "__proto__" })).error, /can't be sent/)

    // a good picture, with a thumbnail that arrives in the offer
    const offered = next(b.socket, "net:fileOffer")
    assert.ok((await send({ preview: PNG })).ok)
    const offer = await offered
    assert.equal(offer.type, "image")
    assert.equal(offer.preview, PNG)
    assert.equal(offer.content, undefined)
    const got = await b.ask("net:fileReply", { id: offer.id, accept: true })
    assert.equal(got.file.content, PNG)
    assert.equal(got.file.type, "image")

    // a bad thumbnail is dropped, the picture still goes
    const offered2 = next(b.socket, "net:fileOffer")
    assert.ok((await send({ name: "pic2", preview: "javascript:alert(1)" })).ok)
    assert.equal((await offered2).preview, null)

    // a 1 MB picture fits (bigger than the 200 KB document limit)
    const big = "data:image/png;base64," + "A".repeat(1024 * 1024)
    const offered3 = next(b.socket, "net:fileOffer")
    assert.ok((await send({ name: "big", content: big })).ok)
    assert.ok((await offered3).size > 1000000)

    // a sound
    const wav = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
    const offered4 = next(b.socket, "net:fileOffer")
    assert.ok((await a.ask("net:sendFile", { to, name: "ding", type: "sound", content: wav })).ok)
    const soundOffer = await offered4
    assert.equal(soundOffer.preview, null)
    assert.equal((await b.ask("net:fileReply", { id: soundOffer.id, accept: true })).file.content, wav)
  } finally {
    close()
  }
})

test("board game moves over sockets", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  await ready
  const { connect, close } = await setup()
  try {
    const a = await connect()
    const b = await connect()
    const invited = next(b.socket, "net:invited")
    const inv = await a.ask("net:invite", { to: { id: b.me.me.id }, game: "reversi" })
    assert.ok(inv.ok, inv.error)
    const invite = await invited
    const matchA = next(a.socket, "net:match")
    assert.ok((await b.ask("net:inviteReply", { id: invite.id, accept: true })).ok)
    const view = await matchA
    const mover = view.legal.length ? a : b
    const legal = view.legal.length ? view.legal : [19, 26, 37, 44]
    assert.ok((await mover.ask("net:gameMove", { matchId: view.id, move: { square: legal[0] } })).ok)
    assert.equal((await mover.ask("net:gameMove", { matchId: view.id, move: null })).ok, false)
    assert.equal((await mover.ask("net:gameMove", { matchId: "nope", move: { square: 1 } })).ok, false)
  } finally {
    close()
  }
})
