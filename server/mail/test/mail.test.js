const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const express = require("express")
const mail = require("..")

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

// A fake 98 Messenger: three accounts (Carol is registered but signed off), sockets that
// record what they're sent
const fakeAim = () => {
  const users = {
    alice: { key: "alice", screenName: "Alice", blocked: [] },
    bobby: { key: "bobby", screenName: "Bobby", blocked: [] },
    carol: { key: "carol", screenName: "Carol", blocked: [] },
  }
  const socket = () => ({ events: [], emit(event, payload) { this.events.push({ event, payload }) } })
  const sessions = new Map([
    ["alice", { key: "alice", user: users.alice, socket: socket() }],
    ["bobby", { key: "bobby", user: users.bobby, socket: socket() }],
  ])
  const tokens = { ["a".repeat(48)]: "alice", ["b".repeat(48)]: "bobby" }
  return { users, sessions, authenticate: (token) => sessions.get(tokens[token]) || null, store: { find: async (key) => users[key] || null } }
}
const ALICE = "a".repeat(48)
const BOBBY = "b".repeat(48)

const serve = (options = {}) => {
  const aim = fakeAim()
  const app = express()
  app.use("/api/mail", mail.mailRouter({ store: mail.memoryStore(), aim, botDelayMs: 20, ...options }))
  const server = http.createServer(app).listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api/mail`
  const call = (method, path, body, token) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
  return { aim, server, call }
}

const letter = { to: "Bobby", subject: "Hi there", body: "How are you?\nWrite back!" }

test("validates recipients, sizes and attachments", () => {
  assert.ok(mail.validateMessage(letter).ok)
  assert.deepEqual(mail.validateMessage({ ...letter, to: "Bobby, carol ; bobby" }).message.to, ["Bobby", "carol"])
  assert.equal(mail.validateMessage({ ...letter, to: "" }).ok, false)
  assert.equal(mail.validateMessage({ ...letter, to: "<script>" }).ok, false)
  assert.equal(mail.validateMessage({ ...letter, to: Array(21).fill(0).map((_, i) => `user${i}x`).join(",") }).ok, false)
  assert.equal(mail.validateMessage({ ...letter, subject: "x".repeat(121) }).ok, false)
  assert.equal(mail.validateMessage({ ...letter, body: { html: "<b>" } }).ok, false)
  // HTML stays plain text: stored as typed, shown as text
  assert.equal(mail.validateMessage({ ...letter, body: "<b>hi</b>" }).message.body, "<b>hi</b>")
  const attach = (file) => mail.validateMessage({ ...letter, attachments: [file] })
  assert.ok(attach({ name: "notes.txt", type: "text", content: "hello" }).ok)
  assert.ok(attach({ name: "dot.png", type: "image", content: PNG }).ok)
  assert.ok(attach({ name: "Letter.rtf", type: "richtext", content: "{\\rtf1 hi}" }).ok)
  assert.ok(attach({ name: "Hello.wav", type: "sound", content: "data:audio/wav;base64,UklGRg==" }).ok)
  assert.equal(attach({ name: "x.exe", type: "executable", content: "MZ" }).ok, false)
  assert.equal(attach({ name: "../x", type: "text", content: "hi" }).ok, false)
  assert.equal(attach({ name: "x.png", type: "image", content: "javascript:alert(1)" }).ok, false)
  assert.equal(attach({ name: "x.png", type: "image", content: "data:image/svg+xml;base64,PHN2Zz4=" }).ok, false)
  const big = attach({ name: "big.txt", type: "text", content: "x".repeat(1024 * 1024) })
  assert.equal(big.ok, false)
  assert.match(big.error, /too big/)
})

test("every request needs a signed-on 98 Messenger user", async () => {
  const { server, call } = serve()
  try {
    for (const [method, path, body] of [["GET", "/folders"], ["GET", "/messages?folder=inbox"], ["POST", "/send", letter], ["POST", "/drafts", letter], ["PATCH", "/messages/x", { read: true }], ["DELETE", "/messages/x"], ["POST", "/empty-deleted"]]) {
      assert.equal((await call(method, path, body)).status, 401, `${method} ${path}`)
      assert.equal((await call(method, path, body, "c".repeat(48))).status, 401, `${method} ${path} with a stranger's token`)
    }
  } finally {
    server.close()
  }
})

test("sending delivers a copy, notifies, and keeps a Sent copy", async () => {
  const { aim, server, call } = serve()
  try {
    const sent = await call("POST", "/send", { ...letter, to: "bobby", cc: "Carol", attachments: [{ name: "dot.png", type: "image", content: PNG }] }, ALICE)
    assert.equal(sent.status, 200, sent.error)
    assert.deepEqual(sent.message.to, ["Bobby"]) // the owner's spelling
    assert.deepEqual(sent.message.cc, ["Carol"])

    const inbox = await call("GET", "/messages?folder=inbox", undefined, BOBBY)
    assert.equal(inbox.messages.length, 1)
    const [head] = inbox.messages
    assert.equal(head.from, "Alice")
    assert.equal(head.read, false)
    assert.equal(head.body, undefined) // headers only
    assert.deepEqual(head.attachments.map((a) => a.name), ["dot.png"])
    const pushed = aim.sessions.get("bobby").socket.events.find((e) => e.event === "mail:new")
    assert.equal(pushed.payload.from, "Alice")
    assert.equal(pushed.payload.unread, 1)

    const full = await call("GET", `/messages/${head.id}`, undefined, BOBBY)
    assert.equal(full.message.body, letter.body)
    assert.equal(full.message.attachments[0].content, PNG)
    // nobody else can read it
    assert.equal((await call("GET", `/messages/${head.id}`, undefined, ALICE)).status, 404)

    assert.equal((await call("GET", "/messages?folder=sent", undefined, ALICE)).messages.length, 1)
    const folders = await call("GET", "/folders", undefined, BOBBY)
    assert.deepEqual(folders.folders.inbox, { total: 1, unread: 1 })
    assert.ok(folders.usage > 0)

    // a screen name that doesn't exist stops the whole message
    const bad = await call("POST", "/send", { ...letter, to: "Bobby, nosuchuser" }, ALICE)
    assert.equal(bad.status, 400)
    assert.match(bad.error, /nosuchuser/)
  } finally {
    server.close()
  }
})

test("read flags, delete to Deleted Items, restore, delete for good", async () => {
  const { server, call } = serve()
  try {
    await call("POST", "/send", letter, ALICE)
    const [m] = (await call("GET", "/messages?folder=inbox", undefined, BOBBY)).messages
    assert.equal((await call("PATCH", `/messages/${m.id}`, { read: true }, BOBBY)).message.read, true)
    assert.equal((await call("GET", "/folders", undefined, BOBBY)).folders.inbox.unread, 0)
    assert.equal((await call("PATCH", `/messages/${m.id}`, { read: false }, BOBBY)).message.read, false)
    // Alice can't touch Bobby's copy
    assert.equal((await call("DELETE", `/messages/${m.id}`, undefined, ALICE)).status, 404)

    assert.equal((await call("DELETE", `/messages/${m.id}`, undefined, BOBBY)).message.folder, "deleted")
    assert.equal((await call("GET", "/messages?folder=deleted", undefined, BOBBY)).messages.length, 1)
    assert.equal((await call("PATCH", `/messages/${m.id}`, { action: "restore" }, BOBBY)).message.folder, "inbox")
    await call("PATCH", `/messages/${m.id}`, { action: "delete" }, BOBBY)
    assert.equal((await call("DELETE", `/messages/${m.id}`, undefined, BOBBY)).removed, true)
    assert.equal((await call("GET", `/messages/${m.id}`, undefined, BOBBY)).status, 404)

    await call("POST", "/send", letter, ALICE)
    const [n] = (await call("GET", "/messages?folder=inbox", undefined, BOBBY)).messages
    await call("DELETE", `/messages/${n.id}`, undefined, BOBBY)
    assert.equal((await call("POST", "/empty-deleted", undefined, BOBBY)).removed, 1)
  } finally {
    server.close()
  }
})

test("drafts save, update and disappear when sent", async () => {
  const { server, call } = serve()
  try {
    const d = await call("POST", "/drafts", { to: "bobby, not even a name!!", subject: "Draft", body: "half done" }, ALICE)
    assert.equal(d.status, 200, d.error)
    assert.equal(d.message.draftTo, "bobby, not even a name!!")
    const d2 = await call("POST", "/drafts", { id: d.message.id, to: "bobby", subject: "Draft 2", body: "done" }, ALICE)
    assert.equal(d2.message.id, d.message.id)
    assert.equal((await call("GET", "/messages?folder=drafts", undefined, ALICE)).messages.length, 1)
    await call("POST", "/send", { to: "bobby", subject: "Draft 2", body: "done", draftId: d.message.id }, ALICE)
    assert.equal((await call("GET", "/messages?folder=drafts", undefined, ALICE)).messages.length, 0)
  } finally {
    server.close()
  }
})

test("someone who blocked you never gets your mail", async () => {
  const { aim, server, call } = serve()
  try {
    aim.users.bobby.blocked = ["alice"]
    const r = await call("POST", "/send", letter, ALICE)
    assert.equal(r.status, 200) // the sender isn't told
    assert.equal((await call("GET", "/messages?folder=inbox", undefined, BOBBY)).messages.length, 0)
    assert.equal(aim.sessions.get("bobby").socket.events.length, 0)
    // the other way round still works
    assert.equal((await call("POST", "/send", { ...letter, to: "alice" }, BOBBY)).status, 200)
    assert.equal((await call("GET", "/messages?folder=inbox", undefined, ALICE)).messages.length, 1)
  } finally {
    server.close()
  }
})

test("sending is rate limited", async () => {
  const { server, call } = serve({ limits: { sendsPerHour: 3 } })
  try {
    for (let i = 0; i < 3; i++) assert.equal((await call("POST", "/send", letter, ALICE)).status, 200)
    assert.equal((await call("POST", "/send", letter, ALICE)).status, 429)
    assert.equal((await call("POST", "/send", { ...letter, to: "alice" }, BOBBY)).status, 200)
  } finally {
    server.close()
  }
})

test("full mailboxes purge the oldest Deleted Items first, then refuse", async () => {
  const { server, call } = serve({ mailboxBytes: 35 * 1024, limits: { sendsPerHour: 100 } })
  const chunk = { ...letter, body: "x".repeat(10 * 1024) }
  // Alice tidies her Sent Items into Deleted Items, which make room for her automatically
  const send = async (subject) => {
    const r = await call("POST", "/send", { ...chunk, subject }, ALICE)
    for (const m of (await call("GET", "/messages?folder=sent", undefined, ALICE)).messages) await call("DELETE", `/messages/${m.id}`, undefined, ALICE)
    return r
  }
  try {
    for (const subject of ["n0", "n1", "n2"]) assert.deepEqual((await send(subject)).failed, [])
    const inbox = (await call("GET", "/messages?folder=inbox", undefined, BOBBY)).messages
    assert.deepEqual(inbox.map((m) => m.subject), ["n2", "n1", "n0"])
    for (const m of inbox.slice(1)) await call("DELETE", `/messages/${m.id}`, undefined, BOBBY)

    // no room for n3 until the oldest deleted message (n0) goes
    assert.deepEqual((await send("n3")).failed, [])
    assert.deepEqual((await call("GET", "/messages?folder=deleted", undefined, BOBBY)).messages.map((m) => m.subject), ["n1"])
    assert.deepEqual((await send("n4")).failed, [])
    assert.deepEqual((await call("GET", "/messages?folder=deleted", undefined, BOBBY)).messages, [])
    assert.ok((await call("GET", "/folders", undefined, BOBBY)).usage <= 35 * 1024)

    // nothing left to purge: n5 bounces, and Alice is told
    const r = await send("n5")
    assert.equal(r.status, 200)
    assert.deepEqual(r.failed, [{ to: "Bobby", error: "Bobby's mailbox is full." }])
    assert.deepEqual((await call("GET", "/messages?folder=inbox", undefined, BOBBY)).messages.map((m) => m.subject), ["n4", "n3", "n2"])
  } finally {
    server.close()
  }
})

test("a sender with a full mailbox can't send", async () => {
  const { server, call } = serve({ mailboxBytes: 25 * 1024, limits: { sendsPerHour: 100 } })
  const chunk = { ...letter, to: "carol", body: "x".repeat(10 * 1024) }
  try {
    assert.equal((await call("POST", "/send", chunk, ALICE)).status, 200)
    assert.equal((await call("POST", "/send", chunk, ALICE)).status, 200)
    const r = await call("POST", "/send", chunk, ALICE)
    assert.equal(r.status, 400)
    assert.match(r.error, /Your mailbox is full/)
  } finally {
    server.close()
  }
})

test("SmarterChild answers its mail", async () => {
  const { aim, server, call } = serve()
  try {
    const r = await call("POST", "/send", { to: "SmarterChild", subject: "tell me a joke", body: "please" }, ALICE)
    assert.equal(r.status, 200, r.error)
    await new Promise((resolve) => setTimeout(resolve, 80))
    const inbox = (await call("GET", "/messages?folder=inbox", undefined, ALICE)).messages
    assert.equal(inbox.length, 1)
    assert.equal(inbox[0].from, "SmarterChild")
    assert.equal(inbox[0].subject, "Re: tell me a joke")
    const body = (await call("GET", `/messages/${inbox[0].id}`, undefined, ALICE)).message.body
    assert.match(body, /joke/)
    assert.ok(aim.sessions.get("alice").socket.events.some((e) => e.event === "mail:new" && e.payload.from === "SmarterChild"))
  } finally {
    server.close()
  }
})
