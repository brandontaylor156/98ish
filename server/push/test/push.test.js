// Web Push: settings, quiet hours, subscriptions (stored per account, signed-on only),
// category filtering, forgetting expired subscriptions (410), and what sends a push: IMs
// (and IMs kept for someone signed off), calls (ringing someone signed off, missed calls),
// mail, game invitations, couple notices, calendar reminders and Our Pet. web-push itself
// is faked: nothing leaves the machine.
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const path = require("node:path")
const express = require("express")
const { Server } = require("socket.io")
const push = require("..")
const { memoryStore } = require("../store")
const { attachAim } = require("../../aim")
const { createStore } = require("../../aim/store")
const { attachNet } = require("../../net")
const mail = require("../../mail")
const calendar = require("../../calendar")
const calendarStore = require("../../calendar/store")
const { createCouples } = require("../../couples")
const couplesStore = require("../../couples/store")
const petLogic = require("../../pet/logic")

let ioClient = null
try {
  ioClient = require(path.join(__dirname, "../../../client/node_modules/socket.io-client"))
} catch {
  ioClient = null
}
const skip = !ioClient && "socket.io-client not installed"

const VAPID = { publicKey: "BPublicKeyForTests", privateKey: "private-for-tests", subject: "mailto:test@example.com" }
const SUB = (n = 1) => ({ endpoint: `https://push.example.com/send/device-${n}`, keys: { p256dh: "B" + "p".repeat(86), auth: "a".repeat(22) } })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 5000) => { // (2 s timed out on a loaded machine: it returns as soon as fn holds)
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("timed out")
    await wait(10)
  }
}

// a stand-in for the web-push package: records what would be sent; endpoints in `gone`
// answer 410, in `broken` 500
const fakeWebpush = () => {
  const sent = []
  const gone = new Set()
  const broken = new Set()
  return {
    sent,
    gone,
    broken,
    sendNotification: async (sub, payload, options) => {
      if (gone.has(sub.endpoint)) throw Object.assign(new Error("Gone"), { statusCode: 410 })
      if (broken.has(sub.endpoint)) throw Object.assign(new Error("Oops"), { statusCode: 500 })
      sent.push({ endpoint: sub.endpoint, keys: sub.keys, data: JSON.parse(payload), options })
      return { statusCode: 201 }
    },
  }
}

const quietLog = { warn: () => {}, error: () => {} }
const makePush = (options = {}) => {
  const webpush = fakeWebpush()
  let time = Date.parse("2026-10-03T17:00:00Z") // noon in Chicago
  const service = push.createPush({ store: memoryStore(), webpush, vapid: VAPID, now: () => time, log: quietLog, ...options })
  return { service, webpush, advance: (ms) => (time += ms), setTime: (t) => (time = t), now: () => time }
}

// a fake 98 Messenger for the HTTP tests
const fakeAim = () => {
  const token = (c) => c.repeat(48)
  const users = { alice: { key: "alice", screenName: "Alice", blocked: [] }, bobby: { key: "bobby", screenName: "Bobby", blocked: [] } }
  const sessions = new Map(Object.values(users).map((u) => [u.key, { key: u.key, user: u, socket: { emit() {} }, visible: true }]))
  const tokens = { [token("a")]: "alice", [token("b")]: "bobby" }
  return { users, sessions, authenticate: (t) => sessions.get(tokens[t]) || null, ALICE: token("a"), BOBBY: token("b") }
}

const serveRouter = (p) => {
  const aim = fakeAim()
  p.service.useAim(aim)
  const app = express()
  app.use("/api/push", p.service.router({ limits: { perMinute: 1000 } }))
  const server = http.createServer(app).listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api/push`
  const call = (method, route, body, token) =>
    fetch(base + route, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
  return { aim, call, close: () => server.close() }
}

// ---------- pure parts ----------

test("settings: defaults, cleaning, quiet hours across midnight and time zones", () => {
  const d = push.settingsOf({})
  assert.deepEqual(d.categories, { im: true, calls: true, calendar: true, couples: true, mail: true, games: true, notes: true, albums: true, places: true, pickleball: true })
  assert.equal(d.quiet.on, false)
  assert.equal(d.callsInQuiet, true)
  assert.equal(d.tz, "UTC")
  const s = push.settingsOf({ categories: { im: false, bogus: false, mail: "no" }, quiet: { on: true, from: "25:00", to: "07:30" }, tz: "Mars/Olympus", mutedCalendars: ["a", 5] })
  assert.equal(s.categories.im, false)
  assert.equal(s.categories.mail, true)
  assert.equal("bogus" in s.categories, false)
  assert.equal(s.quiet.from, "22:00")
  assert.equal(s.quiet.to, "07:30")
  assert.equal(s.tz, "UTC")
  assert.deepEqual(s.mutedCalendars, ["a"])

  const night = { ...push.settingsOf({ quiet: { on: true, from: "22:00", to: "07:00" }, tz: "America/Chicago" }) }
  // 03:30 UTC = 22:30 in Chicago (CDT)
  assert.equal(push.minutesIn(Date.parse("2026-10-04T03:30:00Z"), "America/Chicago"), 22 * 60 + 30)
  assert.equal(push.inQuietHours(night, Date.parse("2026-10-04T03:30:00Z")), true)
  assert.equal(push.inQuietHours(night, Date.parse("2026-10-04T11:30:00Z")), true) // 06:30
  assert.equal(push.inQuietHours(night, Date.parse("2026-10-04T12:00:00Z")), false) // 07:00
  assert.equal(push.inQuietHours(night, Date.parse("2026-10-03T17:00:00Z")), false) // noon
  const nap = push.settingsOf({ quiet: { on: true, from: "13:00", to: "15:00" }, tz: "UTC" })
  assert.equal(push.inQuietHours(nap, Date.parse("2026-10-03T14:00:00Z")), true)
  assert.equal(push.inQuietHours(nap, Date.parse("2026-10-03T15:00:00Z")), false)
  assert.equal(push.inQuietHours({ ...nap, quiet: { ...nap.quiet, on: false } }, Date.parse("2026-10-03T14:00:00Z")), false)
})

test("subscriptions must look like real ones", () => {
  assert.ok(push.cleanSubscription(SUB()))
  assert.equal(push.cleanSubscription({ ...SUB(), endpoint: "http://evil.example/x" }), null)
  assert.equal(push.cleanSubscription({ ...SUB(), endpoint: "javascript:alert(1)" }), null)
  assert.equal(push.cleanSubscription({ ...SUB(), keys: { p256dh: "short", auth: "a".repeat(22) } }), null)
  assert.equal(push.cleanSubscription({ ...SUB(), keys: { p256dh: "B" + "p".repeat(86), auth: "<script>" } }), null)
  assert.equal(push.cleanSubscription(null), null)
})

test("without VAPID keys push is off: config says so, nothing is sent, nothing breaks", async () => {
  const webpush = fakeWebpush()
  const service = push.createPush({ store: memoryStore(), webpush, vapid: { publicKey: "", privateKey: "", subject: "" }, log: quietLog })
  assert.equal(service.enabled, false)
  const { call, close, aim } = serveRouter({ service })
  try {
    const config = await call("GET", "/config")
    assert.equal(config.enabled, false)
    assert.equal(config.publicKey, null)
    assert.equal((await call("POST", "/subscribe", { subscription: SUB() }, aim.ALICE)).status, 503)
    // settings and read state still work (the Notification Center uses them)
    assert.equal((await call("GET", "/settings", undefined, aim.ALICE)).enabled, false)
    assert.equal((await service.notify("alice", "im", { title: "x" }, { ifAway: false })).skipped, "disabled")
    assert.equal(webpush.sent.length, 0)
  } finally {
    close()
  }
})

// ---------- HTTP ----------

test("subscribe, settings and read state need a signed-on account and stay per account", async () => {
  const p = makePush()
  const { call, close, aim } = serveRouter(p)
  try {
    const config = await call("GET", "/config")
    assert.equal(config.enabled, true)
    assert.equal(config.publicKey, VAPID.publicKey)
    assert.deepEqual(config.categories, push.CATEGORIES)

    for (const [method, route, body] of [["POST", "/subscribe", { subscription: SUB() }], ["GET", "/settings"], ["PUT", "/settings", {}], ["POST", "/test"], ["GET", "/seen"], ["POST", "/unsubscribe", {}]]) {
      assert.equal((await call(method, route, body)).status, 401, `${method} ${route}`)
      assert.equal((await call(method, route, body, "f".repeat(48))).status, 401, `${method} ${route} bad token`)
    }

    assert.equal((await call("POST", "/subscribe", { subscription: { endpoint: "nope" } }, aim.ALICE)).status, 400)
    const sub = await call("POST", "/subscribe", { subscription: SUB(1), device: "Alice's iPhone", tz: "America/Chicago" }, aim.ALICE)
    assert.equal(sub.ok, true)
    assert.equal(sub.settings.tz, "America/Chicago")
    await call("POST", "/subscribe", { subscription: SUB(2), device: "Alice's PC" }, aim.ALICE)
    const store = await p.service.getStore()
    assert.equal((await store.subs.forKey("alice")).length, 2)
    // the same browser signed on as someone else now belongs to them
    await call("POST", "/subscribe", { subscription: SUB(2), device: "Bobby's PC" }, aim.BOBBY)
    assert.deepEqual((await store.subs.forKey("alice")).map((s) => s.device), ["Alice's iPhone"])
    assert.deepEqual((await store.subs.forKey("bobby")).map((s) => s.device), ["Bobby's PC"])

    const settings = await call("GET", "/settings", undefined, aim.ALICE)
    assert.equal(settings.devices.length, 1)
    assert.equal(settings.devices[0].device, "Alice's iPhone")
    assert.equal(JSON.stringify(settings).includes("p".repeat(40)), false) // keys never go back out

    const put = await call("PUT", "/settings", { categories: { mail: false }, quiet: { on: true, from: "21:30" } }, aim.ALICE)
    assert.equal(put.settings.categories.mail, false)
    assert.equal(put.settings.categories.im, true)
    assert.deepEqual(put.settings.quiet, { on: true, from: "21:30", to: "07:00" })
    assert.equal(put.settings.tz, "America/Chicago")
    assert.equal((await call("PUT", "/settings", { quiet: { from: "9pm" } }, aim.ALICE)).status, 400)
    assert.equal((await call("PUT", "/settings", { tz: "Nowhere/Land" }, aim.ALICE)).status, 400)
    // Bobby's settings are his own
    assert.equal((await call("GET", "/settings", undefined, aim.BOBBY)).settings.categories.mail, true)

    // someone else's endpoint can't be removed
    assert.equal((await call("POST", "/unsubscribe", { endpoint: SUB(1).endpoint }, aim.BOBBY)).removed, false)
    assert.equal((await call("POST", "/unsubscribe", { endpoint: SUB(1).endpoint }, aim.ALICE)).removed, true)
    assert.equal((await store.subs.forKey("alice")).length, 0)

    // the Notification Center's read state only moves forward
    assert.equal((await call("GET", "/seen", undefined, aim.ALICE)).seenAt, 0)
    assert.equal((await call("PUT", "/seen", { seenAt: p.now() - 1000 }, aim.ALICE)).seenAt, p.now() - 1000)
    assert.equal((await call("PUT", "/seen", { seenAt: p.now() - 5000 }, aim.ALICE)).seenAt, p.now() - 1000)
    assert.equal((await call("PUT", "/seen", { seenAt: "soon" }, aim.ALICE)).status, 400)
    assert.equal((await call("GET", "/seen", undefined, aim.BOBBY)).seenAt, 0)

    // a test notification reaches only the asker's devices
    await call("POST", "/subscribe", { subscription: SUB(3) }, aim.ALICE)
    const t = await call("POST", "/test", undefined, aim.ALICE)
    assert.equal(t.sent, 1)
    assert.equal(p.webpush.sent[0].endpoint, SUB(3).endpoint)
    assert.equal(p.webpush.sent[0].data.category, "system")
    assert.deepEqual(p.webpush.sent[0].options.vapidDetails, VAPID)
  } finally {
    close()
  }
})

test("an account keeps at most 10 devices (the oldest goes)", async () => {
  const store = memoryStore()
  for (let i = 0; i < 12; i++) {
    await store.subs.save({ key: "alice", endpoint: `https://push.example.com/${i}`, p256dh: "x", auth: "y", device: `d${i}` })
    await wait(2)
  }
  const mine = await store.subs.forKey("alice")
  assert.equal(mine.length, 10)
  assert.equal(mine.some((s) => s.device === "d0" || s.device === "d1"), false)
})

// ---------- notify ----------

test("notify: away only, categories, quiet hours (calls can ring through), 410 forgets the device", async () => {
  const p = makePush()
  const aim = fakeAim()
  p.service.useAim(aim)
  const store = await p.service.getStore()
  await store.subs.save({ key: "alice", endpoint: "https://push.example.com/1", p256dh: "k1", auth: "a1", device: "phone" })
  await store.subs.save({ key: "alice", endpoint: "https://push.example.com/2", p256dh: "k2", auth: "a2", device: "old laptop" })
  const msg = { title: "Bobby", body: "hi", tag: "im-bobby" }

  // in front of 98ish: nothing
  assert.equal((await p.service.notify("alice", "im", msg)).skipped, "active")
  // tab in the background
  aim.sessions.get("alice").visible = false
  let r = await p.service.notify("alice", "im", msg)
  assert.equal(r.sent, 2)
  assert.equal(p.webpush.sent[0].data.title, "Bobby")
  assert.equal(p.webpush.sent[0].data.category, "im")
  assert.equal(p.webpush.sent[0].options.urgency, "normal")
  // signed off entirely
  aim.sessions.delete("alice")
  assert.equal((await p.service.notify("alice", "im", msg)).sent, 2)
  // nobody subscribed
  assert.equal((await p.service.notify("bobby", "im", msg, { ifAway: false })).skipped, "none")

  // a category turned off
  await store.prefs.set("alice", { categories: { mail: false } })
  assert.equal((await p.service.notify("alice", "mail", msg)).skipped, "off")
  assert.equal((await p.service.notify("alice", "im", msg)).sent, 2)

  // quiet hours (noon here): calls ring through unless that's turned off too
  await store.prefs.set("alice", { quiet: { on: true, from: "11:00", to: "13:00" }, tz: "America/Chicago" })
  assert.equal((await p.service.notify("alice", "im", msg)).skipped, "quiet")
  assert.equal((await p.service.notify("alice", "calls", msg, { urgency: "high" })).sent, 2)
  assert.equal(p.webpush.sent.at(-1).options.urgency, "high")
  await store.prefs.set("alice", { callsInQuiet: false })
  assert.equal((await p.service.notify("alice", "calls", msg)).skipped, "quiet")
  assert.equal(await p.service.wouldSend("alice", "calls"), false)
  p.advance(2 * 60 * 60_000) // 2 PM
  assert.equal(await p.service.wouldSend("alice", "calls"), true)

  // the old laptop's subscription expired: it's forgotten; a server error isn't
  p.webpush.gone.add("https://push.example.com/2")
  r = await p.service.notify("alice", "im", msg)
  assert.deepEqual(r, { sent: 1, removed: 1 })
  assert.deepEqual((await store.subs.forKey("alice")).map((s) => s.device), ["phone"])
  p.webpush.broken.add("https://push.example.com/1")
  r = await p.service.notify("alice", "im", msg)
  assert.deepEqual(r, { sent: 0, removed: 0 })
  assert.equal((await store.subs.forKey("alice")).length, 1)
})

// ---------- triggers over real sockets ----------

const socketSetup = async ({ callRingMs } = {}) => {
  const p = makePush({ now: Date.now })
  const server = http.createServer()
  const io = new Server(server)
  const store = await createStore("")
  const ice = { config: async () => ({ iceServers: [], turn: false }) }
  const aim = await attachAim(io, { store, ice, push: p.service, callRingMs })
  const net = attachNet(io, { aim, graceMs: 200 })
  await new Promise((r) => server.listen(0, r))
  const url = `http://127.0.0.1:${server.address().port}`
  const sockets = []
  const ask = (socket, event, payload) => new Promise((r) => socket.emit(event, payload, r))
  const user = async (screenName, { register = true } = {}) => {
    const socket = ioClient(url, { transports: ["websocket"], forceNew: true })
    sockets.push(socket)
    await new Promise((r) => socket.on("connect", r))
    const events = []
    socket.onAny((event, payload) => events.push({ event, payload }))
    const result = await ask(socket, "aim:signOn", { screenName, password: "hunter22", register })
    assert.equal(result.ok, true, result.error)
    const got = (event) => events.filter((e) => e.event === event).map((e) => e.payload)
    return { socket, events, got, ask: (event, payload) => ask(socket, event, payload), token: result.token, close: () => socket.close() }
  }
  const subscribe = async (key, n) => (await p.service.getStore()).subs.save({ key, endpoint: `https://push.example.com/${key}-${n}`, p256dh: "k", auth: "a", device: key })
  const sent = (category) => p.webpush.sent.filter((s) => !category || s.data.category === category)
  const close = () => {
    sockets.forEach((s) => s.close())
    io.close()
    server.close()
    net.close?.()
  }
  return { p, aim, net, user, subscribe, sent, close, url }
}

test("IMs: a push only while the tab is hidden; kept for someone signed off with push on", { skip }, async () => {
  const { user, subscribe, sent, close, aim } = await socketSetup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    await subscribe("theo", 1)

    assert.equal((await rosie.ask("aim:im", { to: "Theo", text: "hi!" })).ok, true)
    await until(() => theo.got("aim:im").length === 1)
    await wait(30)
    assert.equal(sent("im").length, 0) // Theo has 98ish in front of him

    theo.socket.emit("aim:visibility", { visible: false })
    await until(() => aim.sessions.get("theo").visible === false)
    await rosie.ask("aim:im", { to: "Theo", text: "you there?" })
    await until(() => sent("im").length === 1)
    const n = sent("im")[0].data
    assert.equal(n.title, "Rosie")
    assert.equal(n.body, "you there?")
    assert.equal(n.tag, "im-rosie")
    assert.equal(n.url, "/?open=im&with=Rosie")
    assert.equal(theo.got("aim:im").length, 2) // still delivered in the app too

    theo.socket.emit("aim:visibility", { visible: true })
    await until(() => aim.sessions.get("theo").visible === true)

    // signed off: Rosie's IM waits, and Theo's phone hears about it
    theo.socket.emit("aim:signOff")
    await until(() => !aim.sessions.has("theo"))
    const offline = await rosie.ask("aim:im", { to: "theo", text: "call me later" })
    assert.equal(offline.ok, true)
    assert.equal(offline.offline, true)
    assert.match(offline.notice, /Theo is signed off/)
    await until(() => sent("im").length === 2)

    // someone signed off without push still can't be IMed, and an unknown name neither
    const mira = await user("Mira")
    mira.socket.emit("aim:signOff")
    await until(() => !aim.sessions.has("mira"))
    assert.match((await rosie.ask("aim:im", { to: "Mira", text: "hello?" })).error, /not currently signed on/)
    assert.match((await rosie.ask("aim:im", { to: "Nobody", text: "hello?" })).error, /not currently signed on/)

    // Theo signs on again: the message is waiting for him
    const back = await user("Theo", { register: false })
    await until(() => back.got("aim:im").length === 1)
    const im = back.got("aim:im")[0]
    assert.equal(im.from, "Rosie")
    assert.equal(im.text, "call me later")
    assert.equal(im.offline, true)
  } finally {
    close()
  }
})

test("IMs to someone signed off who blocked you are refused, push or not", { skip }, async () => {
  const { user, subscribe, sent, close, aim } = await socketSetup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    await subscribe("theo", 1)
    assert.equal((await theo.ask("aim:block", { screenName: "Rosie", blocked: true })).ok, true)
    theo.socket.emit("aim:signOff")
    await until(() => !aim.sessions.has("theo"))
    assert.match((await rosie.ask("aim:im", { to: "Theo", text: "please" })).error, /not currently signed on/)
    assert.equal(sent("im").length, 0)
  } finally {
    close()
  }
})

test("calls: ringing someone signed off by push, the ring reaches them on sign on, missed calls notify", { skip }, async () => {
  const { user, subscribe, sent, close, aim } = await socketSetup({ callRingMs: 600 })
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    await subscribe("theo", 1)
    theo.socket.emit("aim:signOff")
    await until(() => !aim.sessions.has("theo"))

    const call = await rosie.ask("aim:call", { to: "theo", video: true })
    assert.equal(call.ok, true, call.error)
    assert.equal(call.pushed, true)
    assert.equal(call.to, "Theo")
    await until(() => sent("calls").length === 1)
    const ring = sent("calls")[0]
    assert.equal(ring.data.title, "Rosie is calling")
    assert.equal(ring.data.tag, "call-rosie")
    assert.equal(ring.data.requireInteraction, true)
    assert.equal(ring.options.urgency, "high")
    assert.ok(ring.options.TTL <= 60)

    // Theo opens 98ish from the notification while it's still ringing
    const back = await user("Theo", { register: false })
    await until(() => back.got("aim:callRing").length === 1)
    assert.deepEqual(back.got("aim:callRing")[0], { id: call.id, from: "Rosie", video: true })
    assert.equal((await back.ask("aim:callAnswer", { id: call.id, video: true })).ok, true)
    assert.equal((await rosie.ask("aim:callHangUp", { id: call.id })).ok, true)

    // he signs off again; this time nobody answers: a missed-call notification (same tag,
    // so it replaces the ringing one), and the notice waits for his next sign on
    back.socket.emit("aim:signOff")
    await until(() => !aim.sessions.has("theo"))
    const again = await rosie.ask("aim:call", { to: "theo", video: false })
    assert.equal(again.ok, true)
    await until(() => sent("calls").some((s) => s.data.title === "Missed call"), 3000)
    const missed = sent("calls").find((s) => s.data.title === "Missed call")
    assert.equal(missed.data.tag, "call-rosie")
    assert.equal(missed.data.url, "/?open=im&with=Rosie")
    const third = await user("Theo", { register: false })
    await until(() => third.got("aim:callMissed").length === 1)
    assert.equal(third.got("aim:callMissed")[0].from, "Rosie")

    // without push a signed-off buddy still can't be rung
    const mira = await user("Mira")
    mira.socket.emit("aim:signOff")
    await until(() => !aim.sessions.has("mira"))
    assert.match((await rosie.ask("aim:call", { to: "mira" })).error, /not currently signed on/)
  } finally {
    close()
  }
})

test("calls: quiet hours with calls muted means not reachable; a hidden tab still gets the push", { skip }, async () => {
  const { user, subscribe, sent, close, aim, p } = await socketSetup({ callRingMs: 400 })
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    await subscribe("theo", 1)
    theo.socket.emit("aim:visibility", { visible: false })
    await until(() => aim.sessions.get("theo").visible === false)
    const call = await rosie.ask("aim:call", { to: "theo" })
    assert.equal(call.ok, true)
    assert.equal(call.pushed, undefined) // rung normally, and pushed because he's in another tab
    await until(() => theo.got("aim:callRing").length === 1)
    await until(() => sent("calls").length >= 1)
    await rosie.ask("aim:callHangUp", { id: call.id })

    theo.socket.emit("aim:signOff")
    await until(() => !aim.sessions.has("theo"))
    await (await p.service.getStore()).prefs.set("theo", { quiet: { on: true, from: "00:00", to: "00:00" }, callsInQuiet: false })
    assert.match((await rosie.ask("aim:call", { to: "theo" })).error, /not currently signed on/)
  } finally {
    close()
  }
})

// ---------- Do Not Disturb ----------

test("Do Not Disturb: pushes are held (not sent), favorites' calls and reminders get through, held ones are handed over once", async () => {
  const p = makePush() // noon in Chicago
  const aim = fakeAim()
  p.service.useAim(aim)
  aim.sessions.delete("alice") // away
  const store = await p.service.getStore()
  await store.subs.save({ key: "alice", endpoint: "https://push.example.com/1", p256dh: "k1", auth: "a1", device: "phone" })
  const msg = (title) => ({ title, body: "hi", tag: title })

  // on by hand, until turned off; favorites may call
  await store.prefs.set("alice", { tz: "America/Chicago", dnd: { on: true, until: null, calls: "favorites", favorites: ["Sweet Pea"], reminders: true, updatedAt: p.now() } })
  assert.equal((await p.service.notify("alice", "im", msg("IM"))).skipped, "dnd")
  assert.equal((await p.service.notify("alice", "mail", msg("Mail"))).skipped, "dnd")
  assert.equal((await p.service.notify("alice", "calls", { ...msg("Stranger is calling"), requireInteraction: true }, { from: "stranger" })).skipped, "dnd")
  assert.equal((await p.service.notify("alice", "calls", { ...msg("Sweet Pea is calling"), requireInteraction: true }, { from: "sweetpea" })).sent, 1)
  assert.equal((await p.service.notify("alice", "calendar", msg("Reminder"))).sent, 1)
  // a test notification ("system") always goes
  assert.equal((await p.service.notify("alice", "system", msg("Test"))).sent, 1)
  assert.deepEqual(p.webpush.sent.map((s) => s.data.title), ["Sweet Pea is calling", "Reminder", "Test"])
  assert.equal(await p.service.callAllowed("alice", "sweetpea"), true)
  assert.equal(await p.service.callAllowed("alice", "stranger"), false)
  assert.equal(await p.service.callAllowed("bobby", "stranger"), true) // no DND at all

  // reminders held too when they're not let through; calls from no one
  await store.prefs.set("alice", { dnd: { on: true, calls: "none", favorites: ["sweetpea"], reminders: false, updatedAt: p.now() } })
  assert.equal((await p.service.notify("alice", "calendar", msg("Reminder 2"))).skipped, "dnd")
  assert.equal(await p.service.callAllowed("alice", "sweetpea"), false)

  // the held ones (not the ring): handed over once, through the API
  const r = serveRouter(p)
  try {
    const held = await r.call("POST", "/held", {}, r.aim.ALICE)
    assert.deepEqual(held.held.map((m) => m.title), ["IM", "Mail", "Reminder 2"])
    assert.equal(held.held[0].category, "im")
    assert.deepEqual((await r.call("POST", "/held", {}, r.aim.ALICE)).held, [])
    assert.equal((await r.call("POST", "/held", {})).status, 401)
  } finally {
    r.close()
  }
})

test("Do Not Disturb: its schedule follows the account's time zone, across midnight and weekdays", async () => {
  const p = makePush()
  const aim = fakeAim()
  p.service.useAim(aim)
  aim.sessions.delete("alice")
  const store = await p.service.getStore()
  await store.subs.save({ key: "alice", endpoint: "https://push.example.com/1", p256dh: "k1", auth: "a1", device: "phone" })
  const schedule = { on: true, from: "22:00", to: "07:00", days: [1, 2, 3, 4, 5] }
  await store.prefs.set("alice", { tz: "America/Chicago", dnd: { schedule, updatedAt: 1 } })
  const im = { title: "IM", body: "hi" }
  // Friday 2026-10-02 23:30 in Chicago (04:30 UTC Saturday): Friday night counts
  p.setTime(Date.parse("2026-10-03T04:30:00Z"))
  assert.equal((await p.service.notify("alice", "im", im)).skipped, "dnd")
  // Saturday 06:59 there: still Friday's night
  p.setTime(Date.parse("2026-10-03T11:59:00Z"))
  assert.equal((await p.service.notify("alice", "im", im)).skipped, "dnd")
  // Saturday 07:00: over
  p.setTime(Date.parse("2026-10-03T12:00:00Z"))
  assert.equal((await p.service.notify("alice", "im", im)).sent, 1)
  // Saturday 23:30 (not a weekday night)
  p.setTime(Date.parse("2026-10-04T04:30:00Z"))
  assert.equal((await p.service.notify("alice", "im", im)).sent, 1)
  // Monday 23:30: quiet; turned off by hand, the schedule rests until 07:00
  p.setTime(Date.parse("2026-10-06T04:30:00Z"))
  assert.equal((await p.service.notify("alice", "im", im)).skipped, "dnd")
  await store.prefs.set("alice", { dnd: { schedule, skip: Date.parse("2026-10-06T12:00:00Z"), updatedAt: 2 } })
  assert.equal((await p.service.notify("alice", "im", im)).sent, 1)
})

test("Do Not Disturb: the API keeps the newest change and needs a session", async () => {
  const p = makePush()
  const r = serveRouter(p)
  try {
    assert.equal((await r.call("GET", "/dnd")).status, 401)
    const fresh = await r.call("GET", "/dnd", undefined, r.aim.ALICE)
    assert.equal(fresh.dnd.on, false)
    const put = await r.call("PUT", "/dnd", { dnd: { on: true, calls: "everyone", favorites: ["Sweet Pea"], updatedAt: p.now() }, tz: "Europe/Paris" }, r.aim.ALICE)
    assert.equal(put.ok, true)
    assert.equal(put.dnd.on, true)
    assert.deepEqual(put.dnd.favorites, ["sweetpea"])
    // an older change from another device loses
    const stale = await r.call("PUT", "/dnd", { dnd: { on: false, updatedAt: p.now() - 60_000 } }, r.aim.ALICE)
    assert.equal(stale.dnd.on, true)
    assert.equal((await r.call("GET", "/dnd", undefined, r.aim.ALICE)).dnd.calls, "everyone")
    assert.equal((await p.service.settingsFor("alice")).tz, "Europe/Paris")
    // per account
    assert.equal((await r.call("GET", "/dnd", undefined, r.aim.BOBBY)).dnd.on, false)
    const newer = await r.call("PUT", "/dnd", { dnd: { on: false, updatedAt: p.now() + 1000 } }, r.aim.ALICE)
    assert.equal(newer.dnd.on, false)
  } finally {
    r.close()
  }
})

test("calls: Do Not Disturb lets favorites ring, others land in missed calls with a message", { skip }, async () => {
  const { user, close, p } = await socketSetup({ callRingMs: 2000 })
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    const mira = await user("Mira")
    const store = await p.service.getStore()
    await store.prefs.set("theo", { dnd: { on: true, calls: "favorites", favorites: ["Rosie"], updatedAt: Date.now() } })
    // Mira isn't a favorite: no ring, a missed call (marked dnd) for Theo
    const no = await mira.ask("aim:call", { to: "theo" })
    assert.equal(no.ok, false)
    assert.equal(no.dnd, true)
    assert.match(no.error, /Theo has Do Not Disturb on/)
    await until(() => theo.got("aim:callMissed").length === 1)
    assert.equal(theo.got("aim:callMissed")[0].from, "Mira")
    assert.equal(theo.got("aim:callMissed")[0].dnd, true)
    assert.equal(theo.got("aim:callRing").length, 0)
    // Rosie is: it rings
    const yes = await rosie.ask("aim:call", { to: "theo" })
    assert.equal(yes.ok, true, yes.error)
    await until(() => theo.got("aim:callRing").length === 1)
    await rosie.ask("aim:callHangUp", { id: yes.id })
    // DND off: anyone rings
    await store.prefs.set("theo", { dnd: { on: false, updatedAt: Date.now() } })
    const later = await mira.ask("aim:call", { to: "theo" })
    assert.equal(later.ok, true, later.error)
    await mira.ask("aim:callHangUp", { id: later.id })
  } finally {
    close()
  }
})

test("game invitations push when the invited tab is in the background", { skip }, async () => {
  const { user, subscribe, sent, close, aim } = await socketSetup()
  try {
    const rosie = await user("Rosie")
    const theo = await user("Theo")
    await subscribe("theo", 1)
    const hello = (u) => u.ask("net:hello", {})
    const a = await hello(rosie)
    const b = await hello(theo)
    assert.equal((await rosie.ask("net:invite", { to: { id: b.me.id }, game: "reversi" })).ok, true)
    await wait(50)
    assert.equal(sent("games").length, 0)
    theo.socket.emit("aim:visibility", { visible: false })
    await until(() => aim.sessions.get("theo").visible === false)
    const inv = await rosie.ask("net:invite", { to: { id: b.me.id }, game: "checkers" })
    assert.equal(inv.ok, true, inv.error)
    await until(() => sent("games").length === 1)
    const n = sent("games")[0].data
    assert.equal(n.title, "Rosie invited you to play")
    assert.match(n.body, /Checkers/)
    assert.equal(n.url, "/?open=invites")
    assert.ok(a.ok)
  } finally {
    close()
  }
})

test("mail: a push for each new message while away, unless mail is turned off", async () => {
  const p = makePush()
  const aim = { ...fakeAim(), push: p.service }
  p.service.useAim(aim)
  aim.store = { find: async (key) => aim.users[key] || null }
  const app = express()
  app.use("/api/mail", mail.mailRouter({ store: mail.memoryStore(), aim, botDelayMs: 20 }))
  const server = http.createServer(app).listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api/mail`
  const send = (body) => fetch(base + "/send", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${aim.ALICE}` }, body: JSON.stringify(body) }).then((r) => r.json())
  try {
    await (await p.service.getStore()).subs.save({ key: "bobby", endpoint: "https://push.example.com/b", p256dh: "k", auth: "a" })
    assert.equal((await send({ to: "Bobby", subject: "Hello", body: "hi" })).ok, true)
    await wait(30)
    assert.equal(p.webpush.sent.length, 0) // Bobby is looking at 98ish
    aim.sessions.get("bobby").visible = false
    await send({ to: "Bobby", subject: "Dinner?", body: "7pm" })
    await until(() => p.webpush.sent.length === 1)
    assert.equal(p.webpush.sent[0].data.title, "New mail from Alice")
    assert.equal(p.webpush.sent[0].data.body, "Dinner?")
    assert.equal(p.webpush.sent[0].data.url, "/?open=mail")
    await (await p.service.getStore()).prefs.set("bobby", { categories: { mail: false } })
    await send({ to: "Bobby", subject: "Again", body: "!" })
    await wait(50)
    assert.equal(p.webpush.sent.length, 1)
  } finally {
    server.close()
  }
})

test("couple notices: letters, flowers and pair requests push; read receipts and story edits don't", async () => {
  const p = makePush()
  const aim = { ...fakeAim(), push: p.service }
  p.service.useAim(aim)
  const couples = createCouples({ store: couplesStore.memoryStore(), aim })
  try {
    await (await p.service.getStore()).subs.save({ key: "bobby", endpoint: "https://push.example.com/b", p256dh: "k", auth: "a" })
    aim.sessions.delete("bobby")
    couples.emitTo("bobby", "couple:letter", { id: "l1", from: "Alice", title: "Hi you", locked: false })
    couples.emitTo("bobby", "couple:flowers", { id: "f1", from: "Alice" })
    couples.emitTo("bobby", "couple:request", { from: "Alice" })
    couples.emitTo("bobby", "couple:letter-opened", { id: "l1", title: "Hi", by: "Alice" })
    couples.emitTo("bobby", "couple:story", { by: "Alice" })
    couples.emitTo("bobby", "couple:letter", { id: "l1", removed: true })
    await until(() => p.webpush.sent.length === 3)
    await wait(30)
    assert.equal(p.webpush.sent.length, 3)
    const [letter, flowers, request] = p.webpush.sent.map((s) => s.data)
    assert.equal(letter.category, "couples")
    assert.match(letter.body, /A new love letter from Alice: "Hi you"/)
    assert.equal(letter.url, "/?open=program&name=Love%20Letters")
    assert.match(flowers.title, /Flowers/)
    assert.match(request.body, /Alice wants to pair up/)
  } finally {
    couples.close?.()
  }
})

test("calendar reminders: sent once from the server calendars, in the account's zone, muted and done ones skipped", async () => {
  const p = makePush()
  const aim = fakeAim()
  p.service.useAim(aim)
  aim.sessions.delete("alice") // 98ish closed
  const cal = calendar.createCalendars({ store: calendarStore.memoryStore(), aim, now: p.now })
  const mine = await cal.ensure({ key: "alice", user: aim.users.alice })
  const personal = mine[0]
  const cstore = await cal.getStore()
  const base = { kind: "event", location: "", notes: "", label: null, checklist: [], todo: false, done: false, attendees: [], allDay: false, tz: "America/Chicago", repeat: null, exceptions: {} }
  const start = Date.parse("2026-10-03T18:00:00Z") // 1 PM Chicago, an hour from "now"
  await cstore.events.save({ ...base, id: "e1", calendarId: personal.id, title: "Dentist", start, end: start + 3600_000, reminders: [30], location: "Main St" })
  await cstore.events.save({ ...base, id: "e2", calendarId: personal.id, title: "Done already", start, end: start, reminders: [30], done: true })
  const store = await p.service.getStore()
  await store.subs.save({ key: "alice", endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" })
  await store.prefs.set("alice", { tz: "America/Chicago" })

  assert.equal(await p.service.checkReminders({ calendars: cal }), 0) // first look: nothing due yet
  p.advance(29 * 60_000)
  assert.equal(await p.service.checkReminders({ calendars: cal }), 0)
  p.advance(2 * 60_000) // 12:31: the 30-minute reminder came due
  assert.equal(await p.service.checkReminders({ calendars: cal }), 1)
  const n = p.webpush.sent[0].data
  assert.equal(n.title, "Reminder: Dentist")
  assert.match(n.body, /1:00/)
  assert.match(n.body, /Main St/)
  assert.equal(n.category, "calendar")
  assert.match(n.tag, /^cal-rem-e1\|/) // the same tag the in-app reminder notification uses
  assert.equal(n.url, `/?open=calendar&cal=${personal.id}&event=e1`)
  // never twice
  p.advance(60_000)
  assert.equal(await p.service.checkReminders({ calendars: cal }), 0)

  // a muted calendar stays quiet
  await cstore.events.save({ ...base, id: "e3", calendarId: personal.id, title: "Muted", start: p.now() + 10 * 60_000, end: p.now() + 20 * 60_000, reminders: [5] })
  await store.prefs.set("alice", { mutedCalendars: [personal.id] })
  p.advance(6 * 60_000)
  assert.equal(await p.service.checkReminders({ calendars: cal }), 0)
})

test("calendar reminders: a server that slept catches up for 30 minutes, not more", async () => {
  const p = makePush()
  const aim = fakeAim()
  p.service.useAim(aim)
  aim.sessions.delete("alice")
  const cal = calendar.createCalendars({ store: calendarStore.memoryStore(), aim, now: p.now })
  const personal = (await cal.ensure({ key: "alice", user: aim.users.alice }))[0]
  const cstore = await cal.getStore()
  const base = { kind: "event", location: "", notes: "", label: null, checklist: [], todo: false, done: false, attendees: [], allDay: false, tz: "UTC", repeat: null, exceptions: {} }
  const store = await p.service.getStore()
  await store.subs.save({ key: "alice", endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" })
  await store.prefs.set("alice", { calCheckedAt: p.now() })
  await cstore.events.save({ ...base, id: "old", calendarId: personal.id, title: "Long ago", start: p.now() + 60 * 60_000, end: p.now() + 61 * 60_000, reminders: [0] })
  await cstore.events.save({ ...base, id: "recent", calendarId: personal.id, title: "Just now", start: p.now() + 100 * 60_000, end: p.now() + 101 * 60_000, reminders: [0] })
  p.advance(110 * 60_000) // asleep for almost two hours
  assert.equal(await p.service.checkReminders({ calendars: cal }), 1)
  assert.equal(p.webpush.sent[0].data.title, "Reminder: Just now")
})

test("Our Pet asks for care at most every 8 hours, only when it needs something", async () => {
  const p = makePush()
  const aim = fakeAim()
  p.service.useAim(aim)
  aim.sessions.delete("alice")
  const items = new Map()
  const pair = { id: "c0ffee", a: "alice", b: "bobby", names: { alice: "Alice", bobby: "Bobby" }, status: "paired" }
  const couples = {
    pairedWith: (key) => (key === "alice" || key === "bobby" ? pair : null),
    getStore: async () => ({ items: { get: async (coupleId, id) => items.get(id) || null } }),
  }
  const pet = petLogic.newPet({ species: "dragon", name: "Mochi", body: "cream", accent: "pink", tz: 0 }, "alice", "Alice", p.now())
  items.set("pet-c0ffee", { kind: "pet", data: pet })
  const store = await p.service.getStore()
  await store.subs.save({ key: "alice", endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" })

  assert.equal(await p.service.checkPets({ couples }), 0) // a new pet is fine
  p.advance(20 * 60 * 60_000) // a day of nobody looking after it
  assert.equal(await p.service.checkPets({ couples }), 1)
  const n = p.webpush.sent[0].data
  assert.match(n.title, /^Mochi /)
  assert.equal(n.category, "couples")
  assert.equal(n.url, "/?open=program&name=Our%20Pet")
  p.advance(60 * 60_000)
  assert.equal(await p.service.checkPets({ couples }), 0) // not again so soon
  p.advance(8 * 60 * 60_000)
  assert.equal(await p.service.checkPets({ couples }), 1)
})
