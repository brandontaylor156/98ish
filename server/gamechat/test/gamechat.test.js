// Game chat: the text checks, and rooms over real sockets (lobbies, match rooms only for
// their players, history, rate limits, 98 Messenger blocks)
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const path = require("node:path")
const { Server } = require("socket.io")
const { attachNet } = require("../../net")
const { attachGameChat, checkText, QUICK, MAX_TEXT, HISTORY } = require("..")

let ioClient = null
try {
  ioClient = require(path.join(__dirname, "../../../client/node_modules/socket.io-client"))
} catch {
  ioClient = null
}

test("checkText: length, links, slurs, spam, swear words masked", () => {
  assert.deepEqual(checkText("  good   game  "), { ok: true, text: "good game" })
  assert.equal(checkText("").ok, false)
  assert.equal(checkText("   ").ok, false)
  assert.equal(checkText("x".repeat(MAX_TEXT)).ok, false, "a long run of one letter is spam")
  assert.equal(checkText("ab ".repeat(70).slice(0, MAX_TEXT)).ok, true)
  assert.match(checkText("ab".repeat(MAX_TEXT)).error, /at most 200/)
  assert.match(checkText("come see www.spam.com").error, /Links/)
  assert.match(checkText("go to http://x.y").error, /Links/)
  assert.match(checkText("cheap casino").error, /friendly/)
  assert.match(checkText("you n1gg3r").error, /friendly/)
  assert.match(checkText("f.a.g").error, /friendly/)
  assert.equal(checkText("aaaaaaaaaaaaaaaaaaaa").ok, false)
  const swear = checkText("well shit that was close")
  assert.equal(swear.ok, true)
  assert.equal(swear.text, "well shit that was close")
  assert.equal(swear.masked, "well s*** that was close")
  // control characters are dropped, HTML stays as plain text (the browser renders text)
  assert.equal(checkText("<img src=x onerror=alert(1)>").text, "<img src=x onerror=alert(1)>")
  assert.equal(checkText("a\u0000b‮c").text, "a b c")
  assert.equal(checkText("Scunthorpe classic assassin").masked, undefined)
})

const setup = async (chatOptions) => {
  const server = http.createServer()
  const io = new Server(server)
  const net = attachNet(io, { graceMs: 50 })
  const chat = attachGameChat(io, net, chatOptions)
  await new Promise((r) => server.listen(0, r))
  const url = `http://127.0.0.1:${server.address().port}`
  const sockets = []
  const connect = async () => {
    const socket = ioClient(url, { transports: ["websocket"], forceNew: true })
    sockets.push(socket)
    const hello = await new Promise((resolve) => socket.emit("net:hello", {}, resolve))
    const ask = (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve))
    const inbox = []
    socket.on("gchat:msg", (m) => inbox.push(m))
    const counts = []
    socket.on("gchat:count", (c) => counts.push(c))
    return { socket, pid: hello.me.id, name: hello.me.name, ask, inbox, counts }
  }
  const close = () => {
    sockets.forEach((s) => s.close())
    io.close()
    server.close()
  }
  return { net, chat, connect, close }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return true
    await wait(10)
  }
  throw new Error("timed out")
}

test("lobbies: join, counts, messages, quick chat, history", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  const { connect, close } = await setup()
  try {
    const a = await connect()
    const b = await connect()
    // not on the network yet: no chat
    const stranger = ioClient(`http://127.0.0.1:${new URL(a.socket.io.uri).port}`, { transports: ["websocket"], forceNew: true })
    const refused = await new Promise((resolve) => stranger.emit("gchat:join", { room: "lobby:solitaire" }, resolve))
    stranger.close()
    assert.equal(refused.ok, false)

    assert.equal((await a.ask("gchat:join", { room: "lobby:Bad Room!" })).ok, false)
    const joinA = await a.ask("gchat:join", { room: "lobby:solitaire" })
    assert.equal(joinA.ok, true)
    assert.equal(joinA.count, 1)
    assert.equal(joinA.me, a.name)
    const joinB = await b.ask("gchat:join", { room: "lobby:solitaire" })
    assert.equal(joinB.count, 2)
    await until(() => a.counts.some((c) => c.count === 2))
    await until(() => a.inbox.some((m) => m.system && m.text.includes(b.name)))

    const sent = await a.ask("gchat:send", { room: "lobby:solitaire", text: "hello <b>there</b>" })
    assert.equal(sent.ok, true)
    await until(() => b.inbox.some((m) => m.text === "hello <b>there</b>" && m.from === a.name))
    const quick = await b.ask("gchat:send", { room: "lobby:solitaire", quick: "gg" })
    assert.equal(quick.message.text, QUICK.gg)
    assert.equal((await b.ask("gchat:send", { room: "lobby:solitaire", quick: "nope" })).ok, false)
    await until(() => a.inbox.some((m) => m.text === "Good game!"))
    // posting into a room you haven't joined
    assert.equal((await a.ask("gchat:send", { room: "lobby:pinball", text: "hi" })).ok, false)

    // a newcomer sees the history (join/leave lines aren't kept in lobbies)
    const c = await connect()
    const joinC = await c.ask("gchat:join", { room: "lobby:solitaire" })
    assert.deepEqual(joinC.history.map((m) => m.text), ["hello <b>there</b>", "Good game!"])
    assert.equal(joinC.count, 3)

    // leaving updates the count
    await b.ask("gchat:leave", { room: "lobby:solitaire" })
    await until(() => a.counts.at(-1).count === 2)
    c.socket.close()
    await until(() => a.counts.at(-1).count === 1)
  } finally {
    close()
  }
})

test("history keeps the last 50 messages", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  const { connect, close } = await setup({ rate: { count: 1000, windowMs: 1000 } })
  try {
    const a = await connect()
    await a.ask("gchat:join", { room: "lobby:tetris" })
    for (let i = 0; i < HISTORY + 15; i++) await a.ask("gchat:send", { room: "lobby:tetris", text: `message ${i}` })
    const b = await connect()
    const join = await b.ask("gchat:join", { room: "lobby:tetris" })
    assert.equal(join.history.length, HISTORY)
    assert.equal(join.history[0].text, "message 15")
    assert.equal(join.history.at(-1).text, `message ${HISTORY + 14}`)
  } finally {
    close()
  }
})

test("rate limit: 5 messages in 10 seconds", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  const { connect, close } = await setup({ rate: { count: 5, windowMs: 300 } })
  try {
    const a = await connect()
    await a.ask("gchat:join", { room: "lobby:pinball" })
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => a.ask("gchat:send", { room: "lobby:pinball", text: `spam ${i}` })))
    assert.equal(results.filter((r) => r.ok).length, 5)
    assert.match(results.at(-1).error, /too fast/)
    // quick chat counts too
    assert.equal((await a.ask("gchat:send", { room: "lobby:pinball", quick: "gg" })).ok, false)
    await wait(350)
    assert.equal((await a.ask("gchat:send", { room: "lobby:pinball", text: "later" })).ok, true)
  } finally {
    close()
  }
})

test("match rooms: only the match's players; results announced", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  const { net, connect, close } = await setup()
  try {
    const a = await connect()
    const b = await connect()
    const spectator = await connect()
    const inv = net.games.invite({ from: a.pid, fromName: a.name, to: b.pid, toName: b.name, game: "checkers" })
    const { matchId } = net.games.replyInvite(b.pid, inv.inviteId, true)
    const room = `match:${matchId}`

    assert.equal((await a.ask("gchat:join", { room })).ok, true)
    assert.equal((await b.ask("gchat:join", { room })).ok, true)
    const denied = await spectator.ask("gchat:join", { room })
    assert.equal(denied.ok, false)
    assert.match(denied.error, /Only the players/)
    // never joined, so can't post either
    assert.equal((await spectator.ask("gchat:send", { room, text: "hi" })).ok, false)
    assert.equal((await spectator.ask("gchat:join", { room: "match:000000000000" })).ok, false)

    await a.ask("gchat:send", { room, quick: "gl" })
    await until(() => b.inbox.some((m) => m.text === "Good luck!"))
    assert.equal(spectator.inbox.length, 0)

    // a result shows up as a system line, and is kept for the history
    net.games.resign(a.pid, matchId)
    await until(() => b.inbox.some((m) => m.system && m.text === `${b.name} wins!`))
    // the loser leaves the game: they can't post into its chat any more
    net.games.leave(a.pid, matchId)
    const after = await a.ask("gchat:send", { room, text: "wait" })
    assert.equal(after.ok, false)
    const history = (await b.ask("gchat:join", { room })).history.map((m) => m.text)
    assert.ok(history.includes(`${b.name} wins!`))
    assert.ok(!spectator.inbox.length)
  } finally {
    close()
  }
})

test("98 Messenger blocks keep messages apart", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  const { net, connect, close } = await setup()
  try {
    const a = await connect()
    const b = await connect()
    const c = await connect()
    // pretend a has blocked b in 98 Messenger
    net.blockedPids = (x, y) => (x === a.pid && y === b.pid) || (x === b.pid && y === a.pid)
    for (const s of [a, b, c]) await s.ask("gchat:join", { room: "lobby:chess" })
    await b.ask("gchat:send", { room: "lobby:chess", text: "from b" })
    await a.ask("gchat:send", { room: "lobby:chess", text: "from a" })
    await until(() => c.inbox.filter((m) => !m.system).length === 2)
    await wait(50)
    assert.ok(!a.inbox.some((m) => m.text === "from b"))
    assert.ok(!b.inbox.some((m) => m.text === "from a"))
    // nor in the history a newcomer gets
    const join = await a.ask("gchat:join", { room: "lobby:chess" })
    assert.deepEqual(join.history.map((m) => m.text), ["from a"])
  } finally {
    close()
  }
})
