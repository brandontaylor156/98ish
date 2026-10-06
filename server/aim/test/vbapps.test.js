// Visual Basic 98 "programs in a message": sharing a program in an IM / chat room, opening
// it, Shared values relayed and kept, who may open it, caps, Delete My Account. Over real
// sockets.
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const path = require("node:path")
const { Server } = require("socket.io")
const { attachAim } = require("..")
const { createStore } = require("../store")
const { memoryStore } = require("../vbappStore")

let ioClient = null
try {
  ioClient = require(path.join(__dirname, "../../../client/node_modules/socket.io-client"))
} catch {
  ioClient = null
}
const skip = !ioClient && "socket.io-client not installed"
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// a small valid program (what Visual Basic 98 saves)
const program = (extra = {}) => ({
  v: 1,
  kind: "vb98",
  name: "Poll",
  form: { caption: "Lunch Poll", width: 300, height: 200, backColor: "#c0c0c0" },
  controls: [{ type: "CommandButton", name: "Command1", left: 10, top: 10, width: 90, height: 28, caption: "Pizza" }],
  code: 'Sub Command1_Click()\n  Shared("vote_" & Me.Name) = "Pizza"\nEnd Sub\n',
  blocks: null,
  mode: "code",
  ...extra,
})

const setup = async () => {
  const server = http.createServer()
  const io = new Server(server, { maxHttpBufferSize: 4 * 1024 * 1024 })
  const store = await createStore("")
  const vbappStore = memoryStore()
  const ice = { config: async () => ({ iceServers: [], turn: false }) }
  const aim = await attachAim(io, { store, ice, vbappStore })
  await new Promise((r) => server.listen(0, r))
  const url = `http://127.0.0.1:${server.address().port}`
  const sockets = []
  const ask = (socket, event, payload) => new Promise((r) => socket.emit(event, payload, r))
  const user = async (screenName) => {
    const socket = ioClient(url, { transports: ["websocket"], forceNew: true })
    sockets.push(socket)
    await new Promise((r) => socket.on("connect", r))
    const events = []
    socket.onAny((event, payload) => events.push({ event, payload }))
    const result = await ask(socket, "aim:signOn", { screenName, password: "hunter22", register: true })
    assert.equal(result.ok, true, result.error)
    const got = (event) => events.filter((e) => e.event === event).map((e) => e.payload)
    const next = (event, ms = 2000) =>
      new Promise((resolve, reject) => {
        const seen = got(event).length
        const start = Date.now()
        const tick = () => {
          const list = got(event)
          if (list.length > seen) return resolve(list[seen])
          if (Date.now() - start > ms) return reject(new Error(`${screenName} never got ${event}`))
          setTimeout(tick, 10)
        }
        tick()
      })
    return { socket, got, next, ask: (event, payload) => ask(socket, event, payload) }
  }
  const close = async () => {
    sockets.forEach((s) => s.close())
    await aim.vbapps.close()
    aim.together.close()
    aim.hangout.close()
    await aim.ydocs.close()
    io.close()
    server.close()
  }
  return { aim, user, close, vbappStore }
}

test("share in an IM: the buddy is invited, both open it, Shared values relay and are kept", { skip }, async () => {
  const { user, close, aim, vbappStore } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const invite = theo.next("vb:invite")
    const shared = await rosie.ask("vb:share", { app: program(), with: "Theo" })
    assert.equal(shared.ok, true, shared.error)
    const note = await invite
    assert.equal(note.id, shared.id)
    assert.equal(note.from, "Rosie")
    assert.equal(note.title, "Lunch Poll")
    const a = await rosie.ask("vb:open", { id: shared.id })
    const b = await theo.ask("vb:open", { id: shared.id })
    assert.equal(a.ok && b.ok, true)
    assert.deepEqual(b.people.sort(), ["Rosie", "Theo"])
    assert.equal(JSON.parse(b.app).form.caption, "Lunch Poll")
    // Rosie votes: Theo hears it (Rosie doesn't get her own echo)
    const update = theo.next("vb:update")
    assert.equal((await rosie.ask("vb:set", { id: shared.id, k: "vote_Rosie", v: "Pizza" })).ok, true)
    assert.deepEqual(await update, { id: shared.id, k: "vote_Rosie", v: "Pizza", from: "Rosie" })
    assert.equal(rosie.got("vb:update").length, 0)
    // a number and a boolean too; "" deletes
    assert.equal((await theo.ask("vb:set", { id: shared.id, k: "count", v: 3 })).ok, true)
    assert.equal((await theo.ask("vb:set", { id: shared.id, k: "done", v: true })).ok, true)
    assert.equal((await theo.ask("vb:set", { id: shared.id, k: "done", v: "" })).ok, true)
    await aim.vbapps.flush()
    const kept = await vbappStore.get(shared.id)
    assert.deepEqual(kept.state, { vote_Rosie: "Pizza", count: 3 })
    // opening later (another device) gets the state
    const again = await theo.ask("vb:open", { id: shared.id })
    assert.deepEqual(again.state, { vote_Rosie: "Pizza", count: 3 })
    // both see it under Shared with Me
    const mine = await theo.ask("vb:mine", {})
    assert.equal(mine.list[0].id, shared.id)
    assert.equal(mine.list[0].from, "Rosie")
  } finally {
    await close()
  }
})

test("only the people it was sent to can open or change it; chat-room members can", { skip }, async () => {
  const { user, close } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const eve = await user("Eve")
    const im = await rosie.ask("vb:share", { app: program(), with: "Theo" })
    assert.equal((await eve.ask("vb:open", { id: im.id })).ok, false)
    assert.equal((await eve.ask("vb:set", { id: im.id, k: "x", v: 1 })).ok, false)
    assert.equal((await rosie.ask("vb:share", { app: program(), with: "Nobody Here" })).ok, false)
    assert.equal((await rosie.ask("vb:share", { app: program(), with: "Rosie" })).ok, false)
    assert.equal((await rosie.ask("vb:share", { app: program() })).ok, false)
    // a chat room: whoever is in it, and anyone who joins later
    await rosie.ask("aim:chatJoin", { room: "Pickle Crew" })
    await theo.ask("aim:chatJoin", { room: "Pickle Crew" })
    const invite = theo.next("vb:invite")
    const room = await rosie.ask("vb:share", { app: program(), room: "Pickle Crew" })
    assert.equal(room.ok, true, room.error)
    assert.equal((await invite).room, "Pickle Crew")
    assert.equal((await eve.ask("vb:open", { id: room.id })).ok, false)
    await eve.ask("aim:chatJoin", { room: "Pickle Crew" })
    const late = await eve.ask("vb:open", { id: room.id })
    assert.equal(late.ok, true, late.error)
    assert.ok(late.people.includes("Eve"))
    // not in the room: can't share there
    const out = await user("Max")
    assert.equal((await out.ask("vb:share", { app: program(), room: "Pickle Crew" })).ok, false)
  } finally {
    await close()
  }
})

test("bad programs, keys and values are refused; state, daily changes and sharing are capped", { skip }, async () => {
  const { user, close } = await setup()
  try {
    const rosie = await user("Rosie")
    await user("Theo")
    assert.equal((await rosie.ask("vb:share", { app: { kind: "nope" }, with: "Theo" })).ok, false)
    assert.equal((await rosie.ask("vb:share", { app: program({ controls: [{ type: "Rocket", name: "R1" }] }), with: "Theo" })).ok, false)
    assert.equal((await rosie.ask("vb:share", { app: "x".repeat(400 * 1024), with: "Theo" })).ok, false)
    const s = await rosie.ask("vb:share", { app: program(), with: "Theo" })
    await rosie.ask("vb:open", { id: s.id })
    assert.equal((await rosie.ask("vb:set", { id: s.id, k: "bad<key>", v: 1 })).ok, false)
    assert.equal((await rosie.ask("vb:set", { id: s.id, k: "obj", v: { a: 1 } })).ok, false)
    assert.equal((await rosie.ask("vb:set", { id: s.id, k: "long", v: "x".repeat(9000) })).ok, false)
    // 64 KB of Shared values at most
    let full = null
    for (let i = 0; i < 12 && !full; i++) {
      const r = await rosie.ask("vb:set", { id: s.id, k: `big${i}`, v: "y".repeat(7900) })
      if (!r.ok) full = r
      if (i % 3 === 2) await wait(1100) // stay under the per-10s rate
    }
    assert.match(full.error, /full/)
  } finally {
    await close()
  }
})

test("Delete My Account: they leave shared programs; one only they were in is deleted", { skip }, async () => {
  const { user, close, aim, vbappStore } = await setup()
  try {
    const rosie = await user("Rosie")
    await user("Theo")
    const both = await rosie.ask("vb:share", { app: program(), with: "Theo" })
    await rosie.ask("vb:open", { id: both.id })
    await rosie.ask("vb:set", { id: both.id, k: "vote_Rosie", v: "Tacos" })
    await aim.vbapps.flush()
    const result = await aim.vbapps.eraseAccount({ key: "rosie" })
    assert.deepEqual(result, { deleted: 0, left: 1 })
    const rec = await vbappStore.get(both.id)
    assert.deepEqual(rec.members, ["theo"])
    assert.equal(rec.owner, "theo")
    assert.equal(rec.state.vote_Rosie, "Tacos", "values they set stay for the others")
    const theoResult = await aim.vbapps.eraseAccount({ key: "theo" })
    assert.deepEqual(theoResult, { deleted: 1, left: 0 })
    assert.equal(await vbappStore.get(both.id), null)
  } finally {
    await close()
  }
})
