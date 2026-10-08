// "Meet me at <venue>" cards in 98 Messenger IMs: the server checks every field, keeps the
// card with the saved message, and passes it on live, held for someone signed off, and in a
// second device's catch-up. Nothing else rides along.
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const path = require("node:path")
const { Server } = require("socket.io")
const { attachAim } = require("..")
const { createStore } = require("../store")
const { memoryHistory, toWire } = require("../history")
const { cleanCard, cardPreview, CARD_MAX_BYTES } = require("../cards")

let ioClient = null
try {
  ioClient = require(path.join(__dirname, "../../../client/node_modules/socket.io-client"))
} catch {
  ioClient = null
}

const LOSCAB = { k: "venue", id: "loscab", n: "Los Cab Sports Village", lat: 33.714515, lon: -117.923701, a: "17272 Newhope St, Fountain Valley, CA 92708", c: "Fountain Valley, CA" }

test("cleanCard: a real venue and a Venue Finder court pass; anything else is refused", () => {
  assert.deepEqual(cleanCard(LOSCAB), LOSCAB)
  // a Venue Finder court: an OSM id and its index shard
  assert.deepEqual(cleanCard({ k: "venue", id: "ow123456789", n: "Central Park courts", lat: 34.1, lon: -118.2, sh: "9q5c" }), { k: "venue", id: "ow123456789", n: "Central Park courts", lat: 34.1, lon: -118.2, sh: "9q5c" })
  // tidied: control characters and runs of spaces, long names cut, coordinates rounded, unknown fields dropped
  const tidy = cleanCard({ ...LOSCAB, n: "  Los\u0000Cab\n\n  Village ", lat: 33.71451549999, extra: "x".repeat(50), html: "<b>hi</b>" })
  assert.deepEqual(tidy, { ...LOSCAB, n: "Los Cab Village", lat: 33.714515 })
  assert.equal(cleanCard({ ...LOSCAB, n: "x".repeat(200) }).n.length, 60)
  assert.equal(cleanCard({ ...LOSCAB, a: "y".repeat(500) }).a.length, 120)
  assert.equal(cleanCard({ ...LOSCAB, sh: "../../etc" }).sh, undefined, "a shard that isn't one is dropped")
  for (const bad of [
    null,
    "venue",
    [LOSCAB],
    { ...LOSCAB, k: "program" },
    { ...LOSCAB, id: "Los Cab" },
    { ...LOSCAB, id: "../loscab" },
    { ...LOSCAB, id: "x".repeat(25) },
    { ...LOSCAB, n: "" },
    { ...LOSCAB, n: "   \n " },
    { ...LOSCAB, n: 42 },
    { ...LOSCAB, lat: 91 },
    { ...LOSCAB, lon: -181 },
    { ...LOSCAB, lat: "33.7" },
    { ...LOSCAB, lat: NaN },
    { ...LOSCAB, lon: Infinity },
  ])
    assert.equal(cleanCard(bad), null, JSON.stringify(bad))
  // the whole card stays tiny
  const big = cleanCard({ ...LOSCAB, n: "n".repeat(60), a: "a".repeat(120), c: "c".repeat(40), sh: "s".repeat(12) })
  assert.ok(JSON.stringify(big).length <= CARD_MAX_BYTES)
  assert.equal(cardPreview(LOSCAB), "📍 Meet me at Los Cab Sports Village")
  assert.equal(cardPreview(LOSCAB, "at 6?"), "📍 Meet me at Los Cab Sports Village: at 6?")
  // the saved message carries it to devices
  assert.deepEqual(toWire({ _id: "a".repeat(20), c: "alice|bob", f: "Alice", fk: "alice", to: "Bob", t: "", at: 1, v: LOSCAB }, "bob").card, LOSCAB)
})

const setup = async ({ push = null } = {}) => {
  const server = http.createServer()
  const io = new Server(server)
  const store = await createStore("")
  const history = memoryHistory()
  await attachAim(io, { store, history, push })
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
  return { history, ask, next, signOn, close }
}

test("sockets: a venue card goes to the buddy, is saved with the message, and bad cards never leave", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  const t = await setup()
  try {
    const alice = await t.signOn("Alice")
    const bob = await t.signOn("Bob")
    const got = t.next(bob, "aim:im")
    const sent = await t.ask(alice, "aim:im", { to: "bob", text: "", style: {}, card: { ...LOSCAB, n: "Los Cab\u0007 Sports Village" } })
    assert.equal(sent.ok, true, sent.error)
    const im = await got
    assert.equal(im.id, sent.id)
    assert.deepEqual(im.card, LOSCAB, "the cleaned card")
    assert.equal(im.text, "")

    // with a line of text too
    const got2 = t.next(bob, "aim:im")
    assert.equal((await t.ask(alice, "aim:im", { to: "bob", text: "6 pm?", style: {}, card: LOSCAB })).ok, true)
    assert.equal((await got2).text, "6 pm?")

    // saved: bob's other device catches up with the card
    await new Promise((r) => setTimeout(r, 50))
    const fresh = await t.ask(bob, "aim:history", { since: 0 })
    assert.deepEqual(fresh.messages.find((m) => m.id === sent.id).card, LOSCAB)
    const doc = await t.history.get(sent.id)
    assert.deepEqual(doc.v, LOSCAB)
    assert.ok(JSON.stringify(doc.v).length <= CARD_MAX_BYTES)

    // refused: a card that isn't one, a card with a picture, a card to SmarterChild
    let heard = 0
    bob.on("aim:im", () => heard++)
    for (const card of [{ k: "venue", id: "loscab", n: "Los Cab", lat: 200, lon: 0 }, { k: "file", url: "https://example.com" }, "loscab", { ...LOSCAB, id: "<script>" }]) {
      const r = await t.ask(alice, "aim:im", { to: "bob", text: "hi", style: {}, card })
      assert.equal(r.ok, false, JSON.stringify(card))
      assert.equal(r.error, "That card can't be sent.")
    }
    assert.equal((await t.ask(alice, "aim:im", { to: "bob", text: "", style: {}, card: LOSCAB, media: { id: "f".repeat(20) } })).ok, false)
    assert.equal((await t.ask(alice, "aim:im", { to: "SmarterChild", text: "", style: {}, card: LOSCAB })).ok, false)
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(heard, 0, "nothing refused reached bob")
  } finally {
    t.close()
  }
})
