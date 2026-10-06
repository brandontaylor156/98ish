// Watch & Listen Together: the control relay. Only the people in the conversation (or the
// chat room) can join, everyone gets the same play/pause/seek/queue state with a server
// time anchor, the host hands off when they leave, a dropped connection keeps its place,
// and payloads are checked and capped. Over real sockets.
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const path = require("node:path")
const { Server } = require("socket.io")
const { attachAim } = require("..")
const { createStore } = require("../store")
const { createTogether } = require("../together")

let ioClient = null
try {
  ioClient = require(path.join(__dirname, "../../../client/node_modules/socket.io-client"))
} catch {
  ioClient = null
}
const skip = !ioClient && "socket.io-client not installed"
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const VID = "dQw4w9WgXcQ"
const VID2 = "9bZkp7q19f0"

const setup = async (options = {}) => {
  const server = http.createServer()
  const io = new Server(server)
  const store = await createStore("")
  const ice = { config: async () => ({ iceServers: [], turn: false }) }
  const aim = await attachAim(io, { store, ice, ...options })
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
    return { socket, events, got, next, ask: (event, payload) => ask(socket, event, payload), token: result.token }
  }
  const close = () => {
    sockets.forEach((s) => s.close())
    aim.together.close()
    io.close()
    server.close()
  }
  return { aim, user, close }
}

test("start from an IM: the buddy is invited, joins, and both share one clock", { skip }, async () => {
  const { user, close } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const eve = await user("Eve")

    const invited = theo.next("tg:invite")
    const started = await rosie.ask("tg:start", { with: "theo", video: VID, title: "A song" })
    assert.equal(started.ok, true, started.error)
    assert.match(started.id, /^[0-9a-f]{20}$/)
    assert.equal(started.state.queue[0].v, VID)
    assert.equal(started.state.queue[0].title, "A song")
    assert.equal(started.state.host, "Rosie")
    assert.equal(started.state.playing, false)
    assert.ok(Math.abs(started.now - Date.now()) < 1000)
    const invite = await invited
    assert.deepEqual(invite, { id: started.id, from: "Rosie", title: "A song", with: "Rosie" })
    assert.equal(eve.got("tg:invite").length, 0)

    // someone else can't join; the buddy can
    const nope = await eve.ask("tg:join", { id: started.id })
    assert.equal(nope.ok, false)
    const joined = await theo.ask("tg:join", { id: started.id })
    assert.equal(joined.ok, true)
    assert.deepEqual(joined.state.people.map((p) => p.name).sort(), ["Rosie", "Theo"])

    // play at 12 s: both hear it with a server time anchor
    const both = Promise.all([rosie.next("tg:state"), theo.next("tg:state")])
    const play = await theo.ask("tg:cmd", { id: started.id, op: "play", pos: 12 })
    assert.equal(play.ok, true)
    const [a, b] = await both
    assert.equal(a.playing, true)
    assert.equal(a.pos, 12)
    assert.equal(a.at, b.at)
    assert.equal(a.rev, b.rev)

    // the position moves with time on the server too
    await wait(300)
    const mine = await rosie.ask("tg:mine", {})
    assert.equal(mine.sessions.length, 1)
    assert.equal(mine.sessions[0].joined, true)

    // pause, seek, speed
    const paused = theo.next("tg:state")
    await rosie.ask("tg:cmd", { id: started.id, op: "pause", pos: 13.2 })
    let s = await paused
    assert.equal(s.playing, false)
    assert.equal(s.pos, 13.2)
    await rosie.ask("tg:cmd", { id: started.id, op: "seek", pos: 90 })
    await wait(50)
    assert.equal(theo.got("tg:state").at(-1).pos, 90)
    assert.equal((await rosie.ask("tg:cmd", { id: started.id, op: "rate", rate: 3 })).ok, false)
    assert.equal((await rosie.ask("tg:cmd", { id: started.id, op: "rate", rate: 1.5 })).ok, true)
    assert.equal((await rosie.ask("tg:cmd", { id: started.id, op: "seek", pos: -4 })).ok, false)
    assert.equal((await rosie.ask("tg:cmd", { id: started.id, op: "explode" })).ok, false)

    // starting again in the same conversation joins the same session (and queues the video)
    const again = await theo.ask("tg:start", { with: "Rosie", video: VID2 })
    assert.equal(again.ok, true)
    assert.equal(again.id, started.id)
    assert.equal(again.joined, true)
    assert.equal(again.state.queue.length, 2)
  } finally {
    close()
  }
})

test("queue: add, the first starts by itself, reorder, remove, ended advances once", { skip }, async () => {
  const { user, close } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const { id } = await rosie.ask("tg:start", { with: "Theo" })
    await theo.ask("tg:join", { id })
    assert.equal((await theo.ask("tg:cmd", { id, op: "play" })).ok, false) // nothing to play

    const bad = await theo.ask("tg:queue", { id, op: "add", video: "not a video" })
    assert.equal(bad.ok, false)
    const first = await theo.ask("tg:queue", { id, op: "add", video: VID, title: "x".repeat(400) })
    assert.equal(first.ok, true)
    assert.equal(first.item.title.length, 100)
    await wait(50)
    let s = rosie.got("tg:state").at(-1)
    assert.equal(s.playing, true) // the first video starts
    assert.equal(s.index, 0)
    const second = await rosie.ask("tg:queue", { id, op: "add", video: VID2, title: "Two" })
    const third = await rosie.ask("tg:queue", { id, op: "add", video: VID, title: "Three" })
    await rosie.ask("tg:queue", { id, op: "move", item: third.item.id, to: 0 })
    await wait(50)
    s = theo.got("tg:state").at(-1)
    assert.deepEqual(s.queue.map((q) => q.title), ["Three", "x".repeat(100), "Two"])
    assert.equal(s.index, 1) // still on the one playing

    // two players report the end of the same video: it advances once
    await Promise.all([rosie.ask("tg:cmd", { id, op: "ended", index: 1 }), theo.ask("tg:cmd", { id, op: "ended", index: 1 })])
    await wait(50)
    s = theo.got("tg:state").at(-1)
    assert.equal(s.index, 2)
    assert.equal(s.pos, 0)
    // the last one ending stops
    await theo.ask("tg:cmd", { id, op: "ended", index: 2 })
    await wait(50)
    s = theo.got("tg:state").at(-1)
    assert.equal(s.playing, false)
    assert.equal(s.index, 2)

    // removing what's playing
    await rosie.ask("tg:queue", { id, op: "remove", item: second.item.id })
    await wait(50)
    s = theo.got("tg:state").at(-1)
    assert.equal(s.queue.length, 2)
    assert.equal(s.playing, false)

    // select + prev
    await rosie.ask("tg:cmd", { id, op: "select", index: 1 })
    await rosie.ask("tg:cmd", { id, op: "prev" })
    await wait(50)
    assert.equal(theo.got("tg:state").at(-1).index, 0)
    assert.equal((await rosie.ask("tg:cmd", { id, op: "select", index: 9 })).ok, false)
  } finally {
    close()
  }
})

test("host-only control, reactions, chat, host hand-off, ending", { skip }, async () => {
  const { user, close } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const { id } = await rosie.ask("tg:start", { with: "Theo", video: VID })
    await theo.ask("tg:join", { id })

    assert.equal((await theo.ask("tg:settings", { id, anyone: false })).ok, false) // not the host
    assert.equal((await rosie.ask("tg:settings", { id, anyone: false })).ok, true)
    const denied = await theo.ask("tg:cmd", { id, op: "play" })
    assert.equal(denied.ok, false)
    assert.match(denied.error, /Only Rosie/)
    // adding to Up Next is still fine
    assert.equal((await theo.ask("tg:queue", { id, op: "add", video: VID2 })).ok, true)

    const reacted = rosie.next("tg:react")
    assert.equal((await theo.ask("tg:react", { id, emoji: "🔥" })).ok, true)
    assert.deepEqual(await reacted, { id, from: "Theo", emoji: "🔥" })
    assert.equal((await theo.ask("tg:react", { id, emoji: "<script>" })).ok, false)

    const said = rosie.next("tg:say")
    await theo.ask("tg:say", { id, text: "  this part!!  " })
    const line = await said
    assert.equal(line.line.text, "this part!!")
    assert.equal(line.line.from, "Theo")
    assert.equal((await theo.ask("tg:say", { id, text: "   " })).ok, false)

    // the host leaves: Theo takes over and can control
    await rosie.ask("tg:leave", { id })
    await wait(50)
    const s = theo.got("tg:state").at(-1)
    assert.equal(s.host, "Theo")
    assert.equal(s.people.length, 1)
    assert.equal((await theo.ask("tg:cmd", { id, op: "play" })).ok, true)

    // Rosie comes back (sees the chat so far); only the host ends it for everyone
    const back = await rosie.ask("tg:join", { id })
    assert.equal(back.ok, true)
    assert.equal(back.chat.length, 1)
    assert.equal((await rosie.ask("tg:end", { id })).ok, false)
    const ended = rosie.next("tg:end")
    assert.equal((await theo.ask("tg:end", { id })).ok, true)
    assert.deepEqual(await ended, { id, reason: "ended" })
    assert.equal((await rosie.ask("tg:join", { id })).ended, true)
  } finally {
    close()
  }
})

test("chat rooms: whoever is in the room can join; leaving the room leaves the session", { skip }, async () => {
  const { user, close } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const max = await user("Max")
    await rosie.ask("aim:chatJoin", { room: "Movie Night" })
    await theo.ask("aim:chatJoin", { room: "Movie Night" })
    assert.equal((await max.ask("tg:start", { room: "Movie Night" })).ok, false) // not in it

    const invited = theo.next("tg:invite")
    const started = await rosie.ask("tg:start", { room: "movie night", video: VID })
    assert.equal(started.ok, true)
    assert.equal(started.state.kind, "room")
    assert.equal(started.state.room, "Movie Night")
    assert.equal((await invited).room, "Movie Night")
    assert.equal(max.got("tg:invite").length, 0)

    assert.equal((await max.ask("tg:join", { id: started.id })).ok, false)
    await max.ask("aim:chatJoin", { room: "Movie Night" })
    assert.equal((await max.ask("tg:join", { id: started.id })).ok, true)
    assert.equal((await theo.ask("tg:join", { id: started.id })).ok, true)

    await max.ask("aim:chatLeave", { room: "Movie Night" })
    await wait(50)
    const s = rosie.got("tg:state").at(-1)
    assert.deepEqual(s.people.map((p) => p.name).sort(), ["Rosie", "Theo"])
  } finally {
    close()
  }
})

test("a dropped connection keeps its place; signing off leaves; blocking ends it", { skip }, async () => {
  const { user, close, aim } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const { id } = await rosie.ask("tg:start", { with: "Theo", video: VID })
    await theo.ask("tg:join", { id })

    // Theo's phone blips: marked away, then resumes on a new socket and gets the state
    theo.socket.io.engine.close()
    await wait(150)
    const away = rosie.got("tg:state").at(-1)
    assert.equal(away.people.find((p) => p.name === "Theo")?.away, true)
    await new Promise((r) => (theo.socket.connected ? r() : theo.socket.once("connect", r)))
    const resumed = await theo.ask("aim:resume", { token: theo.token })
    assert.equal(resumed.ok, true)
    await wait(100)
    assert.equal(rosie.got("tg:state").at(-1).people.find((p) => p.name === "Theo")?.away, false)

    // blocking ends a two-person session
    const ended = theo.next("tg:end")
    await rosie.ask("aim:block", { screenName: "Theo", blocked: true })
    assert.equal((await ended).id, id)
    assert.equal(aim.together.live.size, 0)
    // and you can't start one with someone who blocks you
    assert.equal((await theo.ask("tg:start", { with: "Rosie" })).ok, false)
    // nor with SmarterChild or yourself
    assert.equal((await theo.ask("tg:start", { with: "SmarterChild" })).ok, false)
    assert.equal((await theo.ask("tg:start", { with: "Theo" })).ok, false)
  } finally {
    close()
  }
})

test("offline buddies get a notification invite that deep-links to the session", { skip }, async () => {
  const sent = []
  const push = {
    enabled: true,
    notify: async (key, category, message) => sent.push({ key, category, message }),
    wouldSend: async () => true,
    getStore: async () => ({ inbox: { add: async () => {}, take: async () => [] } }),
    useAim: () => {},
  }
  const { user, close } = await setup({ push })
  try {
    const rosie = await user("Rosie")
    await user("Theo")
    const { id } = await rosie.ask("tg:start", { with: "Theo", video: VID, title: "Trailer" })
    const invite = sent.find((s) => s.message.key === `tg:${id}`)
    assert.ok(invite)
    assert.equal(invite.key, "theo")
    assert.equal(invite.category, "im")
    assert.match(invite.message.body, /Trailer/)
    assert.equal(invite.message.url, `/?open=program&name=Watch%20Together&together=${id}`)
  } finally {
    close()
  }
})

test("caps: sessions hosted per person, empty sessions expire, idle sweep", async () => {
  // the module on its own, with a fake clock and no sockets
  let t = 1_000_000
  const emitted = []
  const rosie = { key: "rosie", user: { screenName: "Rosie" }, socket: {} }
  const sessions = new Map([["rosie", rosie]])
  for (const k of ["abby", "bert", "carl", "dave"]) sessions.set(k, { key: k, user: { screenName: k.toUpperCase() }, socket: {} })
  const handlers = {}
  const tg = createTogether({ sessions, hidden: () => false, emitTo: (k, e, p) => emitted.push([k, e, p]), limiter: () => () => false, rooms: new Map(), now: () => t, emptyMs: 30, idleMs: 1000 })
  tg.bind((event, fn) => (handlers[event] = fn))
  const call = (event, payload, who = rosie) => new Promise((r) => handlers[event](who, payload, r))
  const ids = []
  for (const k of ["abby", "bert", "carl"]) ids.push((await call("tg:start", { with: k })).id)
  const fourth = await call("tg:start", { with: "dave" })
  assert.equal(fourth.ok, false)
  assert.match(fourth.error, /Close one/)

  // position math: playing at 1.5x for 2 s from 10 s
  await call("tg:queue", { id: ids[0], op: "add", video: VID })
  await call("tg:cmd", { id: ids[0], op: "seek", pos: 10 })
  await call("tg:cmd", { id: ids[0], op: "rate", rate: 1.5 })
  t += 2000
  assert.equal(tg.position(tg.live.get(ids[0])), 13)

  // everyone leaves: it ends after the wait
  await call("tg:leave", { id: ids[1] })
  await wait(80)
  assert.equal(tg.live.has(ids[1]), false)
  assert.ok(emitted.some(([, e]) => e === "tg:state"))
  tg.close()
})
