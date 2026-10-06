// Come Over (the multiplayer desktop): hangouts (invite, join, cursors, desktops, follow,
// handing files) and the shared-document relay (Yjs updates, catch-up, caps, privacy,
// Delete My Account). Over real sockets, with real Yjs documents on both ends.
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const path = require("node:path")
const Y = require("yjs")
const { Server } = require("socket.io")
const { attachAim } = require("..")
const { createStore } = require("../store")
const { memoryStore } = require("../ydocStore")
const { sanitizeSnapshot } = require("../hangout")

let ioClient = null
try {
  ioClient = require(path.join(__dirname, "../../../client/node_modules/socket.io-client"))
} catch {
  ioClient = null
}
const skip = !ioClient && "socket.io-client not installed"
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const b64 = (u8) => Buffer.from(u8).toString("base64")
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"))

const setup = async (options = {}) => {
  const server = http.createServer()
  const io = new Server(server, { maxHttpBufferSize: 4 * 1024 * 1024 })
  const store = await createStore("")
  const ydocStore = options.ydocStore || memoryStore()
  const ice = { config: async () => ({ iceServers: [], turn: false }) }
  const aim = await attachAim(io, { store, ice, ydocStore, ...options })
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
    return { socket, events, got, next, ask: (event, payload) => ask(socket, event, payload), emit: (event, payload) => socket.emit(event, payload), token: result.token }
  }
  const close = async () => {
    sockets.forEach((s) => s.close())
    aim.together.close()
    aim.hangout.close()
    await aim.ydocs.close()
    io.close()
    server.close()
  }
  return { aim, user, close, ydocStore }
}

// a client-side Yjs document wired to the relay (what client/src/utils/ydoc.js does)
const client = async (who, id) => {
  const doc = new Y.Doc()
  doc.on("update", (u, origin) => {
    if (origin !== "remote") who.emit("yd:up", { id, u: b64(u) })
  })
  who.socket.on("yd:up", (m) => m.id === id && Y.applyUpdate(doc, unb64(m.u), "remote"))
  const res = await who.ask("yd:open", { id, sv: b64(Y.encodeStateVector(doc)) })
  assert.equal(res.ok, true, res.error)
  Y.applyUpdate(doc, unb64(res.update), "remote")
  const missing = Y.encodeStateAsUpdate(doc, unb64(res.sv))
  if (missing.length > 2) who.emit("yd:up", { id, u: b64(missing) })
  return doc
}

test("invite, join, cursors and focus: only the invited get in, private programs stay private", { skip }, async () => {
  const { user, close } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const eve = await user("Eve")

    const invited = theo.next("hg:invite")
    const inv = await rosie.ask("hg:invite", { to: "Theo" })
    assert.equal(inv.ok, true, inv.error)
    assert.equal(inv.state.host, "Rosie")
    const { id, from } = await invited
    assert.equal(from, "Rosie")

    assert.equal((await eve.ask("hg:join", { id })).ok, false, "not invited")
    const joined = await theo.ask("hg:join", { id })
    assert.equal(joined.ok, true, joined.error)
    assert.deepEqual(joined.state.people.map((p) => p.name), ["Rosie", "Theo"])
    assert.notEqual(joined.state.people[0].color, joined.state.people[1].color)

    // a cursor (clamped to the screen) and the focused window
    const p = theo.next("hg:p")
    rosie.emit("hg:p", { x: 0.25, y: 1.7, f: { app: "notepad", title: "plans.txt - Notepad" } })
    const got = await p
    assert.deepEqual({ k: got.k, x: got.x, y: got.y }, { k: "rosie", x: 0.25, y: 1 })
    assert.deepEqual(got.f, { app: "notepad", title: "plans.txt - Notepad" })
    // a private program: never its title
    const p2 = theo.next("hg:p")
    rosie.emit("hg:p", { x: 0.3, y: 0.3, f: { app: "mail", title: "Re: my bank password" } })
    assert.deepEqual((await p2).f, { app: "private", title: "" })
    // Eve (not in it) never hears any of it
    assert.equal(eve.got("hg:p").length, 0)

    // the host leaving ends it for everyone
    const ended = theo.next("hg:end")
    await rosie.ask("hg:leave", {})
    assert.equal((await ended).reason, "host-left")
  } finally {
    await close()
  }
})

test("at most 4 people, blocked people can't be invited, and a dropped phone keeps its place", { skip }, async () => {
  const { user, close, aim } = await setup({ hangoutLostMs: 200 })
  try {
    const host = await user("Host")
    const people = [await user("Ann"), await user("Ben"), await user("Cat")]
    const dan = await user("Dan")
    for (const [i, p] of people.entries()) {
      const inv = p.next("hg:invite")
      assert.equal((await host.ask("hg:invite", { to: ["Ann", "Ben", "Cat"][i] })).ok, true)
      const { id } = await inv
      assert.equal((await p.ask("hg:join", { id })).ok, true)
    }
    const full = await host.ask("hg:invite", { to: "Dan" })
    assert.equal(full.ok, false)
    assert.match(full.error, /4 people/)

    // a dropped connection: still listed (away) for a while, then gone
    const ann = people[0]
    const state = host.next("hg:state")
    ann.socket.disconnect()
    assert.equal((await state).people.find((p) => p.name === "Ann").away, true)
    await wait(400)
    const h = [...aim.hangout.live.values()][0]
    assert.equal(h.joined.has("ann"), false)

    // blocking: Dan blocks Host; Host can't invite Dan any more
    await dan.ask("aim:block", { screenName: "Host", blocked: true })
    await host.ask("hg:leave", {})
    const again = await host.ask("hg:invite", { to: "Dan" })
    assert.equal(again.ok, false)
  } finally {
    await close()
  }
})

test("visiting: desktops are sanitized, and touching someone's desktop needs their permission", { skip }, async () => {
  const { user, close } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const inv = theo.next("hg:invite")
    await rosie.ask("hg:invite", { to: "Theo" })
    await theo.ask("hg:join", { id: (await inv).id })

    const desk = theo.next("hg:desk")
    const sent = await rosie.ask("hg:desk", {
      snap: {
        wallpaper: { color: "#008080", image: "javascript:alert(1)" },
        icons: [{ name: "My Computer", icon: "/assets/program_icons/computer.svg", program: "My Computer" }],
        windows: [
          { app: "notepad", title: "list.txt - Notepad", icon: "/assets/program_icons/notepad.svg", x: 0.1, y: 0.1, w: 0.5, h: 0.4, active: true },
          { app: "aim", title: "IM with Theo", x: 0.6, y: 0.1, w: 0.3, h: 0.5 },
        ],
      },
    })
    assert.equal(sent.ok, true)
    const { k, snap } = await desk
    assert.equal(k, "rosie")
    assert.equal(snap.wallpaper.image, "", "no script URLs")
    assert.equal(snap.windows[0].title, "list.txt - Notepad")
    assert.deepEqual([snap.windows[1].app, snap.windows[1].title], ["private", "Private window"])

    // without "touch": refused; with it: relayed to Rosie
    const no = await theo.ask("hg:act", { to: "rosie", act: { type: "open", program: "Paint" } })
    assert.equal(no.ok, false)
    await rosie.ask("hg:perm", { touch: true })
    const act = rosie.next("hg:act")
    assert.equal((await theo.ask("hg:act", { to: "rosie", act: { type: "open", program: "Paint" } })).ok, true)
    assert.deepEqual((await act).act, { type: "open", program: "Paint" })
    assert.equal((await theo.ask("hg:act", { to: "rosie", act: { type: "format-c-drive" } })).ok, false)
  } finally {
    await close()
  }
})

test("follow mode: only followers get the view, and a private program shows as private", { skip }, async () => {
  const { user, close } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const ann = await user("Ann")
    for (const [who, name] of [[theo, "Theo"], [ann, "Ann"]]) {
      const inv = who.next("hg:invite")
      await rosie.ask("hg:invite", { to: name })
      await who.ask("hg:join", { id: (await inv).id })
    }
    assert.equal((await theo.ask("hg:watch", { key: "rosie" })).ok, true)
    const v = theo.next("hg:view")
    rosie.emit("hg:view", { app: "notepad", doc: "abc123", scroll: 0.5, title: "plans.txt" })
    assert.deepEqual(await v, { k: "rosie", app: "notepad", doc: "abc123", title: "plans.txt", scroll: 0.5 })
    const v2 = theo.next("hg:view")
    rosie.emit("hg:view", { app: "passwords", title: "Bank" })
    assert.deepEqual(await v2, { k: "rosie", app: "private" })
    await wait(100)
    assert.equal(ann.got("hg:view").length, 0, "Ann isn't following")
    // stop following
    await theo.ask("hg:watch", { key: null })
    rosie.emit("hg:view", { app: "paint" })
    await wait(100)
    assert.equal(theo.got("hg:view").length, 2)
  } finally {
    await close()
  }
})

test("handing over a file: only to someone in the hangout, and capped", { skip }, async () => {
  const { user, close } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const eve = await user("Eve")
    const inv = theo.next("hg:invite")
    await rosie.ask("hg:invite", { to: "Theo" })
    await theo.ask("hg:join", { id: (await inv).id })
    const gift = theo.next("hg:gift")
    const ok = await rosie.ask("hg:give", { to: "Theo", file: { name: "hello.txt", type: "text", data: "hi there" } })
    assert.equal(ok.ok, true, ok.error)
    assert.deepEqual((await gift).file, { name: "hello.txt", type: "text", data: "hi there" })
    assert.equal((await rosie.ask("hg:give", { to: "Eve", file: { name: "x.txt", type: "text", data: "x" } })).ok, false)
    const big = await rosie.ask("hg:give", { to: "Theo", file: { name: "big.bin", type: "text", data: "x".repeat(1.6 * 1024 * 1024) } })
    assert.equal(big.ok, false)
    assert.match(big.error, /too big/)
    assert.equal(eve.got("hg:gift").length, 0)
  } finally {
    await close()
  }
})

test("shared documents: everyone's edits converge, late joiners catch up, offline edits merge", { skip }, async () => {
  const { user, close, aim, ydocStore } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const eve = await user("Eve")
    const inv = theo.next("hg:invite")
    await rosie.ask("hg:invite", { to: "Theo" })
    await theo.ask("hg:join", { id: (await inv).id })

    const made = await rosie.ask("yd:create", { kind: "text", title: "Trip plans" })
    assert.equal(made.ok, true, made.error)
    const id = made.id
    // shared with the hangout: Theo becomes a member and hears about it
    const heard = theo.next("hg:doc")
    assert.equal((await rosie.ask("hg:doc", { id })).ok, true)
    assert.equal((await heard).id, id)
    assert.equal((await eve.ask("yd:open", { id })).ok, false, "Eve isn't a member")

    const a = await client(rosie, id)
    const b = await client(theo, id)
    a.getText("t").insert(0, "Hello")
    await wait(150)
    b.getText("t").insert(b.getText("t").length, " world")
    a.getText("t").insert(0, ">> ")
    await wait(300)
    assert.equal(a.getText("t").toString(), b.getText("t").toString())
    assert.equal(a.getText("t").toString(), ">> Hello world")

    // offline: Theo edits while disconnected, then reconnects and syncs both ways
    theo.socket.disconnect()
    await wait(50)
    const offline = new Y.Doc()
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(b))
    offline.getText("t").insert(offline.getText("t").length, "!")
    a.getText("t").insert(0, "[draft] ")
    await wait(150)
    theo.socket.connect()
    await new Promise((r) => theo.socket.once("connect", r))
    assert.equal((await theo.ask("aim:resume", { token: theo.token })).ok, true)
    const res = await theo.ask("yd:open", { id, sv: b64(Y.encodeStateVector(offline)) })
    Y.applyUpdate(offline, unb64(res.update))
    await theo.ask("yd:up", { id, u: b64(Y.encodeStateAsUpdate(offline, unb64(res.sv))) })
    await wait(200)
    assert.equal(offline.getText("t").toString(), "[draft] >> Hello world!")
    assert.equal(a.getText("t").toString(), "[draft] >> Hello world!")

    // saved: after it's unloaded, someone opening it later gets everything
    const entry = aim.ydocs.live.get(id)
    await new Promise((r) => setTimeout(r, 2300))
    const saved = await ydocStore.get(id)
    assert.ok(saved.size > 0)
    const late = new Y.Doc()
    Y.applyUpdate(late, unb64(saved.state))
    assert.equal(late.getText("t").toString(), "[draft] >> Hello world!")
    assert.ok(entry)
  } finally {
    await close()
  }
})

test("shared documents are capped, and Delete My Account removes or leaves them", { skip }, async () => {
  const { user, close, aim, ydocStore } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const made = await rosie.ask("yd:create", { kind: "text", title: "Big", with: ["Theo"] })
    assert.equal(made.ok, true, made.error)
    const mine = await rosie.ask("yd:create", { kind: "paint", title: "Just me" })
    const doc = new Y.Doc()
    const opened = await rosie.ask("yd:open", { id: made.id })
    assert.equal(opened.ok, true)
    // a text document holds 512 KB: one 600 KB update is refused
    const before = Y.encodeStateVector(doc)
    doc.getText("t").insert(0, "x".repeat(600 * 1024))
    const huge = await rosie.ask("yd:up", { id: made.id, u: b64(Y.encodeStateAsUpdate(doc, before)) })
    assert.equal(huge.ok, false)
    assert.match(huge.error, /full|too big/)
    // the list shows both to Rosie, one to Theo
    assert.equal((await rosie.ask("yd:list", {})).docs.length, 2)
    assert.deepEqual((await theo.ask("yd:list", {})).docs.map((d) => d.title), ["Big"])

    const result = await aim.ydocs.eraseAccount({ key: "rosie" })
    assert.deepEqual(result, { removed: 1, left: 1 })
    assert.equal(await ydocStore.get(mine.id), null)
    const shared = await ydocStore.get(made.id)
    assert.deepEqual(shared.members, ["theo"])
    assert.equal(shared.owner, "theo")
  } finally {
    await close()
  }
})

test("sanitizeSnapshot keeps only safe pictures and hides private windows", () => {
  const s = sanitizeSnapshot({ wallpaper: { image: "/assets/wallpapers/clouds.png", color: "#123456" }, icons: [{ name: "x".repeat(100), icon: "https://evil.example/x.png" }], windows: [{ app: "Photos", title: "Beach", x: 2, y: -1 }] })
  assert.equal(s.wallpaper.image, "/assets/wallpapers/clouds.png")
  assert.equal(s.icons[0].icon, "")
  assert.equal(s.icons[0].name.length, 40)
  assert.deepEqual([s.windows[0].app, s.windows[0].title, s.windows[0].x, s.windows[0].y], ["private", "Private window", 1, 0])
  // default-deny: no program id (98 Messenger's Buddy List) and IM windows (aim-im) are private
  const m = sanitizeSnapshot({ windows: [{ title: "98 Messenger" }, { app: "aim-im", title: "Theo - Instant Message" }, { app: "notepad", title: "a.txt" }] })
  assert.deepEqual(m.windows.map((w) => w.title), ["Private window", "Private window", "a.txt"])
})

test("voice in a hangout: on/off with ICE, signals only between people in it with voice on", { skip }, async () => {
  const { user, close } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const eve = await user("Eve")
    assert.equal((await rosie.ask("hg:vc", { on: true })).ok, false, "not in a hangout yet")
    const invited = theo.next("hg:invite")
    await rosie.ask("hg:invite", { to: "Theo" })
    const { id } = await invited
    await theo.ask("hg:join", { id })
    const on = await rosie.ask("hg:vc", { on: true })
    assert.equal(on.ok, true, on.error)
    assert.deepEqual(on.ice, { iceServers: [], turn: false })
    const list = rosie.next("hg:vc")
    await theo.ask("hg:vc", { on: true })
    assert.deepEqual((await list).on, ["rosie", "theo"])
    const sig = theo.next("hg:sig")
    assert.equal((await rosie.ask("hg:sig", { to: "theo", kind: "offer", data: { sdp: "v=0\r\n" } })).ok, true)
    const got = await sig
    assert.equal(got.from, "rosie")
    assert.equal(got.kind, "offer")
    // someone outside the hangout can't signal into it or be signalled
    assert.equal((await eve.ask("hg:sig", { to: "rosie", kind: "bye" })).ok, false)
    assert.equal((await rosie.ask("hg:sig", { to: "eve", kind: "bye" })).ok, false)
    // Theo leaves the hangout: his voice goes off
    const after = rosie.next("hg:vc")
    await theo.ask("hg:leave", {})
    const l = await after
    assert.ok(!l.on.includes("theo"))
  } finally {
    await close()
  }
})
