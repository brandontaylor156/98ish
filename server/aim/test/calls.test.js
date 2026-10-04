// 98 Messenger calls: the signaling relay. Only the two people in a call hear about it,
// busy and blocked buddies can't be rung, unanswered calls time out into a missed-call
// notice, and payloads are checked. Over real sockets.
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const path = require("node:path")
const { Server } = require("socket.io")
const { attachAim } = require("..")
const { createStore } = require("../store")
const { cleanSignal } = require("../calls")
const { createIce } = require("../ice")

let ioClient = null
try {
  ioClient = require(path.join(__dirname, "../../../client/node_modules/socket.io-client"))
} catch {
  ioClient = null
}
const skip = !ioClient && "socket.io-client not installed"

const SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n"
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const setup = async (options = {}) => {
  const server = http.createServer()
  const io = new Server(server)
  const store = await createStore("")
  const ice = { config: async () => ({ iceServers: [{ urls: ["stun:stun.example:3478"] }], turn: false }) }
  const aim = await attachAim(io, { store, ice, ...options })
  await new Promise((r) => server.listen(0, r))
  const url = `http://127.0.0.1:${server.address().port}`
  const sockets = []
  const ask = (socket, event, payload) => new Promise((r) => socket.emit(event, payload, r))
  // a signed-on user whose every incoming event is recorded
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
    io.close()
    server.close()
  }
  return { aim, user, close, url }
}

test("ring, answer, relay only between the two, hang up", { skip }, async () => {
  const { user, close, aim, url } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const eve = await user("Eve")

    const ringing = theo.next("aim:callRing")
    const call = await rosie.ask("aim:call", { to: "theo", video: true })
    assert.equal(call.ok, true)
    assert.match(call.id, /^[0-9a-f]{24}$/)
    const ring = await ringing
    assert.deepEqual(ring, { id: call.id, from: "Rosie", video: true })

    // no relaying before the call is answered, and only the callee can answer
    assert.equal((await rosie.ask("aim:callSignal", { id: call.id, kind: "offer", data: { type: "offer", sdp: SDP } })).ok, false)
    assert.equal((await eve.ask("aim:callAnswer", { id: call.id })).ok, false, "a stranger can't pick up")
    assert.equal((await rosie.ask("aim:callAnswer", { id: call.id })).ok, false, "the caller can't pick up")

    const answered = rosie.next("aim:callAnswered")
    assert.equal((await theo.ask("aim:callAnswer", { id: call.id, video: false })).ok, true)
    assert.deepEqual(await answered, { id: call.id, video: false })

    // offer from the caller only, answer from the callee only, ICE both ways
    assert.equal((await theo.ask("aim:callSignal", { id: call.id, kind: "offer", data: { type: "offer", sdp: SDP } })).ok, false)
    const offer = theo.next("aim:callSignal")
    assert.equal((await rosie.ask("aim:callSignal", { id: call.id, kind: "offer", data: { type: "offer", sdp: SDP, extra: "x" } })).ok, true)
    assert.deepEqual(await offer, { id: call.id, kind: "offer", data: { type: "offer", sdp: SDP } })
    const answer = rosie.next("aim:callSignal")
    assert.equal((await theo.ask("aim:callSignal", { id: call.id, kind: "answer", data: { type: "answer", sdp: SDP } })).ok, true)
    assert.equal((await answer).kind, "answer")
    const candidate = theo.next("aim:callSignal")
    const ice = { candidate: "candidate:1 1 udp 2122260223 192.168.1.2 54321 typ host", sdpMid: "0", sdpMLineIndex: 0 }
    assert.equal((await rosie.ask("aim:callSignal", { id: call.id, kind: "ice", data: ice })).ok, true)
    assert.deepEqual((await candidate).data, ice)

    // mute/camera state goes across as booleans
    const media = theo.next("aim:callMedia")
    await rosie.ask("aim:callMedia", { id: call.id, muted: 1, camera: false, screen: "yes" })
    assert.deepEqual(await media, { id: call.id, muted: true, camera: false, screen: true })

    // a third person can't inject into the call, and heard nothing of it
    assert.equal((await eve.ask("aim:callSignal", { id: call.id, kind: "ice", data: ice })).ok, false)
    assert.equal((await eve.ask("aim:callHangUp", { id: call.id })).ok, false)
    assert.equal((await eve.ask("aim:callMedia", { id: call.id, muted: true })).ok, false)
    assert.equal(eve.events.filter((e) => e.event.startsWith("aim:call")).length, 0)

    // ICE servers come from the server
    const iceConfig = await rosie.ask("aim:callIce", {})
    assert.equal(iceConfig.ok, true)
    assert.equal(iceConfig.turn, false)
    assert.ok(iceConfig.iceServers.length >= 1)

    const ended = theo.next("aim:callEnd")
    assert.equal((await rosie.ask("aim:callHangUp", { id: call.id, reason: "hungup" })).ok, true)
    assert.deepEqual(await ended, { id: call.id, reason: "hungup" })
    assert.equal(aim.calls.calls.size, 0)
    assert.equal(aim.calls.inCall.size, 0)
    assert.equal((await rosie.ask("aim:callSignal", { id: call.id, kind: "ice", data: ice })).ok, false, "nothing relays after hang up")
    assert.equal(rosie.got("aim:callEnd").length, 0, "the one who hung up isn't told")

    // signed-out sockets can't do anything
    const anon = ioClient(url, { transports: ["websocket"], forceNew: true })
    await new Promise((r) => anon.on("connect", r))
    assert.equal((await new Promise((r) => anon.emit("aim:call", { to: "theo" }, r))).ok, false)
    anon.close()
  } finally {
    close()
  }
})

test("busy, decline, cancel and missed calls", { skip }, async () => {
  const { user, close } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const eve = await user("Eve")

    const call = await rosie.ask("aim:call", { to: "Theo", video: false })
    assert.equal(call.ok, true)
    // the caller can't start a second call; anyone calling either of them gets busy
    assert.match((await rosie.ask("aim:call", { to: "Eve" })).error, /already on a call/)
    const busy = await eve.ask("aim:call", { to: "Theo", video: true })
    assert.equal(busy.ok, false)
    assert.equal(busy.busy, true)
    assert.match(busy.error, /on another call/)
    const busyNotice = theo.got("aim:callMissed").at(-1) || (await theo.next("aim:callMissed"))
    assert.equal(busyNotice.from, "Eve")
    assert.equal(busyNotice.busy, true)
    assert.equal((await eve.ask("aim:call", { to: "Rosie" })).busy, true, "the caller is busy too")

    // decline
    const declined = rosie.next("aim:callEnd")
    assert.equal((await theo.ask("aim:callDecline", { id: call.id })).ok, true)
    assert.deepEqual(await declined, { id: call.id, reason: "declined" })
    assert.equal((await theo.ask("aim:callAnswer", { id: call.id })).ok, false, "can't answer a declined call")

    // cancel while ringing: the callee is told and gets a missed-call notice
    const again = await rosie.ask("aim:call", { to: "Theo", video: true })
    const cancelled = theo.next("aim:callEnd")
    const missed = theo.next("aim:callMissed")
    await rosie.ask("aim:callHangUp", { id: again.id })
    assert.deepEqual(await cancelled, { id: again.id, reason: "cancelled" })
    const notice = await missed
    assert.equal(notice.from, "Rosie")
    assert.equal(notice.video, true)
    assert.ok(notice.time > 0)

    // the callee hanging up while ringing counts as declining
    const third = await rosie.ask("aim:call", { to: "Theo" })
    const no = rosie.next("aim:callEnd")
    await theo.ask("aim:callHangUp", { id: third.id })
    assert.equal((await no).reason, "declined")

    // bad input
    assert.equal((await rosie.ask("aim:call", { to: "SmarterChild" })).ok, false)
    assert.equal((await rosie.ask("aim:call", { to: "Rosie" })).ok, false)
    assert.equal((await rosie.ask("aim:call", { to: "nobody here" })).ok, false)
    assert.equal((await rosie.ask("aim:call", { to: "!!" })).ok, false)
  } finally {
    close()
  }
})

test("unanswered calls time out into a missed call", { skip }, async () => {
  const { user, close, aim } = await setup({ callRingMs: 150 })
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const call = await rosie.ask("aim:call", { to: "theo", video: true })
    const [callerEnd, calleeEnd, missed] = await Promise.all([rosie.next("aim:callEnd"), theo.next("aim:callEnd"), theo.next("aim:callMissed")])
    assert.deepEqual(callerEnd, { id: call.id, reason: "timeout" })
    assert.deepEqual(calleeEnd, { id: call.id, reason: "timeout" })
    assert.equal(missed.from, "Rosie")
    assert.equal(aim.calls.inCall.size, 0, "both are free again")
    assert.equal((await theo.ask("aim:callAnswer", { id: call.id })).ok, false)
    // an answered call doesn't time out
    const live = await rosie.ask("aim:call", { to: "theo" })
    await theo.ask("aim:callAnswer", { id: live.id })
    await wait(300)
    assert.equal(aim.calls.calls.size, 1)
  } finally {
    close()
  }
})

test("blocked buddies can't call, and blocking ends a call", { skip }, async () => {
  const { user, close } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    await theo.ask("aim:block", { screenName: "Rosie", blocked: true })
    const refused = await rosie.ask("aim:call", { to: "Theo", video: true })
    assert.equal(refused.ok, false)
    assert.match(refused.error, /not currently signed on/, "looks offline, like everything else")
    assert.equal((await theo.ask("aim:call", { to: "Rosie" })).ok, false, "nor the other way")
    assert.equal(theo.got("aim:callRing").length + rosie.got("aim:callRing").length, 0)
    await theo.ask("aim:block", { screenName: "Rosie", blocked: false })

    const call = await rosie.ask("aim:call", { to: "Theo" })
    assert.equal(call.ok, true)
    await theo.ask("aim:callAnswer", { id: call.id })
    const endedA = rosie.next("aim:callEnd")
    const endedB = theo.next("aim:callEnd")
    await theo.ask("aim:block", { screenName: "Rosie", blocked: true })
    assert.equal((await endedA).reason, "blocked")
    assert.equal((await endedB).reason, "blocked")
  } finally {
    close()
  }
})

test("signing off or dropping ends calls; missed calls wait for the connection", { skip }, async () => {
  const { user, close, aim } = await setup({ callLostMs: 150 })
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")

    // sign off mid-call
    const call = await rosie.ask("aim:call", { to: "Theo" })
    await theo.ask("aim:callAnswer", { id: call.id })
    const ended = theo.next("aim:callEnd")
    rosie.socket.emit("aim:signOff")
    assert.deepEqual(await ended, { id: call.id, reason: "signedoff" })

    // a dropped connection that doesn't come back ends the call
    const rosie2 = await user("Rosie2")
    const call2 = await rosie2.ask("aim:call", { to: "Theo" })
    await theo.ask("aim:callAnswer", { id: call2.id })
    const lost = rosie2.next("aim:callEnd")
    theo.socket.disconnect()
    assert.deepEqual(await lost, { id: call2.id, reason: "lost" })

    // ...but one that comes back in time keeps it
    theo.socket.connect()
    await new Promise((r) => theo.socket.once("connect", r))
    assert.equal((await theo.ask("aim:resume", { token: theo.token })).ok, true)
    const call3 = await rosie2.ask("aim:call", { to: "Theo" })
    await theo.ask("aim:callAnswer", { id: call3.id })
    const eve = await user("Eve")
    theo.socket.disconnect()
    await wait(50)
    // someone rings while Theo's connection is down: busy, and the notice waits for him
    assert.equal((await eve.ask("aim:call", { to: "Theo" })).busy, true)
    const before = theo.got("aim:callMissed").length
    theo.socket.connect()
    await new Promise((r) => theo.socket.once("connect", r))
    await theo.ask("aim:resume", { token: theo.token })
    await wait(250)
    assert.equal(aim.calls.calls.has(call3.id), true)
    assert.equal(theo.got("aim:callMissed").length, before + 1)
    assert.equal(theo.got("aim:callMissed").at(-1).from, "Eve")
    await rosie2.ask("aim:callHangUp", { id: call3.id })

    // a call cancelled while the callee's connection is down arrives once they're back
    theo.socket.disconnect()
    await wait(50)
    assert.equal((await rosie2.ask("aim:call", { to: "Theo" })).ok, false, "can't ring a dropped connection")
    theo.socket.connect()
    await new Promise((r) => theo.socket.once("connect", r))
    await theo.ask("aim:resume", { token: theo.token })
    // the caller drops mid-ring: the callee gets a cancel and a missed call
    const call4 = await rosie2.ask("aim:call", { to: "Theo", video: true })
    assert.equal(call4.ok, true)
    const cancelled = theo.next("aim:callEnd")
    const missed = theo.next("aim:callMissed")
    rosie2.socket.disconnect()
    assert.equal((await cancelled).reason, "cancelled")
    assert.equal((await missed).from, "Rosie2")
  } finally {
    close()
  }
})

test("call payloads are limited", { skip }, async () => {
  const { user, close } = await setup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const call = await rosie.ask("aim:call", { to: "Theo" })
    await theo.ask("aim:callAnswer", { id: call.id })
    const huge = { type: "offer", sdp: "x".repeat(20_001) }
    assert.equal((await rosie.ask("aim:callSignal", { id: call.id, kind: "offer", data: huge })).ok, false)
    assert.equal((await rosie.ask("aim:callSignal", { id: call.id, kind: "bogus", data: {} })).ok, false)
    assert.equal((await rosie.ask("aim:callSignal", { id: call.id, kind: "ice", data: { candidate: "c".repeat(2000), sdpMid: "0" } })).ok, false)
    assert.equal(theo.got("aim:callSignal").length, 0)
  } finally {
    close()
  }
})

test("cleanSignal keeps only well-formed SDP and candidates", () => {
  assert.deepEqual(cleanSignal("offer", { type: "offer", sdp: SDP, junk: 1 }), { type: "offer", sdp: SDP })
  assert.equal(cleanSignal("offer", { type: "answer", sdp: SDP }), null)
  assert.equal(cleanSignal("answer", { type: "answer", sdp: 5 }), null)
  assert.equal(cleanSignal("answer", null), null)
  assert.deepEqual(cleanSignal("ice", { candidate: null }), { candidate: null })
  assert.deepEqual(cleanSignal("ice", { candidate: "candidate:x", sdpMLineIndex: 1 }), { candidate: "candidate:x", sdpMid: null, sdpMLineIndex: 1 })
  assert.equal(cleanSignal("ice", { candidate: "candidate:x" }), null, "needs a mid or index")
  assert.equal(cleanSignal("ice", { candidate: "candidate:x", sdpMLineIndex: 99 }), null)
})

test("ICE servers: STUN only unless TURN is configured; the Metered key stays server side", async () => {
  assert.deepEqual((await createIce({ env: {} }).config()).turn, false)
  const plain = await createIce({ env: { TURN_URLS: "turn:turn.example:3478, junk", TURN_USERNAME: "u", TURN_CREDENTIAL: "p" } }).config()
  assert.equal(plain.turn, true)
  assert.deepEqual(plain.iceServers.at(-1), { urls: ["turn:turn.example:3478"], username: "u", credential: "p" })

  let fetched = 0
  const fetchImpl = async (url) => {
    fetched++
    assert.match(url, /^https:\/\/myapp\.metered\.live\/api\/v1\/turn\/credentials\?apiKey=k%20ey$/)
    return { ok: true, json: async () => [{ urls: "turn:a.relay.metered.ca:80", username: "x", credential: "y", extra: 1 }] }
  }
  const ice = createIce({ env: { METERED_TURN_APP: "myapp", METERED_TURN_API_KEY: "k ey" }, fetchImpl })
  const first = await ice.config()
  await ice.config()
  assert.equal(fetched, 1, "credentials are cached")
  assert.equal(first.turn, true)
  assert.deepEqual(first.iceServers.at(-1), { urls: "turn:a.relay.metered.ca:80", username: "x", credential: "y" })
  assert.ok(!JSON.stringify(first).includes("k ey"))

  // the provider failing degrades to STUN only
  const error = console.error
  console.error = () => {}
  const down = await createIce({ env: { METERED_TURN_APP: "myapp", METERED_TURN_API_KEY: "k" }, fetchImpl: async () => { throw new Error("down") } }).config()
  console.error = error
  assert.equal(down.turn, false)
  assert.ok(down.iceServers.length > 0)
})
