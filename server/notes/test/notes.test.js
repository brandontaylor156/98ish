const test = require("node:test")
const assert = require("node:assert/strict")
const express = require("express")
const { createNotes, loadCore } = require("..")
const { memoryStore } = require("../store")

const TOKENS = { alice: "a".repeat(48), bob: "b".repeat(48), carol: "c".repeat(48) }
const NAMES = { alice: "Alice", bob: "Bob", carol: "Carol" }

// A server with three signed-on 98 Messenger sessions (alice, bob, carol), sockets that
// remember what they were sent, and a push service that remembers its notifications
const start = async ({ blocked = {}, clock } = {}) => {
  const emitted = []
  const pushed = []
  const sessions = new Map(
    Object.keys(TOKENS).map((key) => [key, { key, token: TOKENS[key], user: { screenName: NAMES[key], blocked: blocked[key] || [] }, socket: { emit: (event, payload) => emitted.push({ to: key, event, payload }) } }])
  )
  const aim = { sessions, store: { find: async (key) => (NAMES[key] ? { screenName: NAMES[key], blocked: blocked[key] || [] } : null) } }
  const push = { notify: async (key, category, message) => (pushed.push({ key, category, message }), { sent: 1 }) }
  const store = memoryStore()
  const notes = createNotes({ aim: () => aim, store, push, ...(clock ? { now: clock } : {}) })
  const app = express()
  app.use("/api/notes", notes.router())
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/notes`
  const call = async (who, path, body) => {
    const response = await fetch(base + path, { method: "POST", headers: { ...(who ? { Authorization: `Bearer ${TOKENS[who]}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
    return { status: response.status, body: await response.json() }
  }
  return { call, notes, store, emitted, pushed, sessions, close: () => server.close() }
}

const ID = (c) => c.repeat(16)

test("sync: new notes go up, come back on another device, and merge per item", async (t) => {
  const core = await loadCore()
  const s = await start()
  t.after(s.close)
  const T = Date.now()
  let note = core.newNote({ id: ID("a"), title: "Groceries", items: ["milk", "eggs"], now: T })
  let r = await s.call("alice", "/sync", { since: 0, notes: [note] })
  assert.equal(r.status, 200)
  assert.equal(r.body.notes.length, 1)
  assert.equal(r.body.notes[0].share, null)
  // a second device of Alice's: everything since 0
  r = await s.call("alice", "/sync", { since: 0, notes: [] })
  assert.deepEqual(r.body.notes[0].note, note)
  const since = r.body.now
  // device 1 ticks milk, device 2 adds bread: both survive
  const [milk] = core.liveItems(note)
  const one = core.editItem(note, milk.id, { done: true }, T + 10)
  const two = core.addItem(note, "bread", T + 11).note
  await s.call("alice", "/sync", { since, notes: [one] })
  r = await s.call("alice", "/sync", { since, notes: [two] })
  const merged = r.body.notes.find((n) => n.note.id === ID("a")).note
  assert.deepEqual(core.liveItems(merged).map((i) => [i.text, i.done]), [["milk", true], ["eggs", false], ["bread", false]])
  // nothing changed since: nothing comes back
  r = await s.call("alice", "/sync", { since: r.body.now + 1, notes: [] })
  assert.deepEqual(r.body.notes, [])
  // someone else's note can't be written; a bad note is rejected alone
  r = await s.call("bob", "/sync", { since: 0, notes: [note, { id: "nope" }] })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.rejected.map((x) => x.id), [ID("a"), "nope"])
  assert.deepEqual(r.body.notes, [])
  // no session, no notes
  assert.equal((await s.call(null, "/sync", {})).status, 401)
})

test("sharing: both edit, live notices and push, leave keeps a copy, stop sharing", async (t) => {
  const core = await loadCore()
  const s = await start()
  t.after(s.close)
  const T = Date.now()
  const note = core.newNote({ id: ID("b"), title: "Date ideas", items: ["picnic"], now: T })
  await s.call("alice", "/sync", { since: 0, notes: [note] })
  // sharing checks the name
  assert.equal((await s.call("alice", `/${ID("b")}/share`, { to: "Nobody Here" })).status, 404)
  assert.equal((await s.call("alice", `/${ID("b")}/share`, { to: "alice" })).status, 400)
  let r = await s.call("alice", `/${ID("b")}/share`, { to: "Bob" })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.share.members.map((m) => m.name), ["Alice", "Bob"])
  assert.ok(s.emitted.some((e) => e.to === "bob" && e.event === "notes:changed"))
  assert.equal(s.pushed.at(-1).key, "bob")
  assert.equal(s.pushed.at(-1).category, "notes")
  assert.match(s.pushed.at(-1).message.title, /Alice shared "Date ideas"/)
  // Bob sees it and adds an item; Alice gets told
  r = await s.call("bob", "/sync", { since: 0, notes: [] })
  const bobs = r.body.notes[0]
  assert.equal(bobs.share.ownerName, "Alice")
  s.emitted.length = 0
  await s.call("bob", "/sync", { since: r.body.now, notes: [core.addItem(bobs.note, "bowling", T + 5).note] })
  assert.deepEqual(s.emitted.map((e) => e.to), ["alice"])
  r = await s.call("alice", "/sync", { since: 0, notes: [] })
  assert.deepEqual(core.liveItems(r.body.notes[0].note).map((i) => i.text), ["picnic", "bowling"])
  // Bob deleting the shared note (purged) only takes him out of it
  await s.call("alice", `/${ID("b")}/share`, { to: "Carol" })
  r = await s.call("bob", "/sync", { since: 0, notes: [core.purgeNote(bobs.note, T + 6)] })
  assert.deepEqual(r.body.gone, [ID("b")])
  r = await s.call("alice", "/sync", { since: 0, notes: [] })
  assert.deepEqual(r.body.notes[0].share.members.map((m) => m.key), ["alice", "carol"])
  // Carol leaves with a copy: a new personal note of hers
  r = await s.call("carol", `/${ID("b")}/leave`, { copy: true })
  assert.equal(r.status, 200)
  r = await s.call("carol", "/sync", { since: 0, notes: [] })
  assert.deepEqual(r.body.gone, [ID("b")])
  assert.equal(r.body.notes.length, 1)
  assert.equal(r.body.notes[0].share, null)
  assert.equal(core.noteTitle(r.body.notes[0].note), "Date ideas")
  // Alice shares with Bob again and stops sharing: Bob keeps a copy
  await s.call("alice", `/${ID("b")}/share`, { to: "bob" })
  assert.equal((await s.call("bob", `/${ID("b")}/unshare`, {})).status, 403)
  r = await s.call("alice", `/${ID("b")}/unshare`, {})
  assert.equal(r.body.share, null)
  r = await s.call("bob", "/sync", { since: 0, notes: [] })
  assert.ok(r.body.gone.includes(ID("b")))
  assert.equal(r.body.notes.filter((n) => core.noteTitle(n.note) === "Date ideas").length, 1)
})

test("blocked people can't be shared with; push waits 15 minutes per note", async (t) => {
  const core = await loadCore()
  let now = Date.now()
  const s = await start({ blocked: { bob: ["alice"] }, clock: () => now })
  t.after(s.close)
  const note = core.newNote({ id: ID("c"), title: "Plans", now })
  await s.call("alice", "/sync", { since: 0, notes: [note] })
  assert.equal((await s.call("alice", `/${ID("c")}/share`, { to: "bob" })).status, 409)
  await s.call("alice", `/${ID("c")}/share`, { to: "carol" })
  const before = s.pushed.length
  let n = note
  for (let i = 0; i < 3; i++) {
    n = core.setField(n, "body", `v${i}`, now + i + 1)
    await s.call("alice", "/sync", { since: 0, notes: [n] })
  }
  assert.equal(s.pushed.length - before, 0) // just told about the share
  now += 16 * 60_000
  for (let i = 0; i < 2; i++) {
    n = core.setField(n, "body", `later ${i}`, now + i)
    await s.call("alice", "/sync", { since: 0, notes: [n] })
  }
  assert.equal(s.pushed.length - before, 1) // "Alice changed" once
  assert.match(s.pushed.at(-1).message.title, /Alice changed "Plans"/)
})

test("caps: notes per account, bytes per note, members per note", async (t) => {
  const core = await loadCore()
  const s = await start()
  t.after(s.close)
  const T = Date.now()
  const max = core.LIMITS.notes
  core.LIMITS.notes = 3
  t.after(() => (core.LIMITS.notes = max))
  const list = ["1", "2", "3", "4"].map((c) => core.newNote({ id: ID(c), title: c, now: T }))
  const r = await s.call("alice", "/sync", { since: 0, notes: list })
  assert.equal(r.body.notes.length, 3)
  assert.match(r.body.rejected[0].error, /at most 3 notes/)
  const big = core.setField(core.newNote({ id: ID("5"), now: T }), "body", "x".repeat(15_000), T)
  let n = big
  for (let i = 0; i < 30; i++) n = core.addItem(n, "y".repeat(400), T).note
  assert.equal((await s.call("bob", "/sync", { since: 0, notes: [n] })).body.rejected.length, 1)
  assert.equal((await s.call("bob", "/sync", { since: 0, notes: new Array(201).fill(big) })).status, 413)
})

test("Delete My Account: personal notes go, shared ones stay with the others", async (t) => {
  const core = await loadCore()
  const s = await start()
  t.after(s.close)
  const T = Date.now()
  await s.call("alice", "/sync", { since: 0, notes: [core.newNote({ id: ID("d"), title: "Mine", now: T }), core.newNote({ id: ID("e"), title: "Ours", now: T })] })
  await s.call("alice", `/${ID("e")}/share`, { to: "bob" })
  await s.call("bob", "/sync", { since: 0, notes: [core.newNote({ id: ID("f"), title: "Bob's", now: T })] })
  const result = await s.notes.eraseAccount({ key: "alice" })
  assert.deepEqual(result, { removed: 1, left: 1 })
  assert.equal(await s.store.get(ID("d")), null)
  const ours = await s.store.get(ID("e"))
  assert.deepEqual(ours.members, ["bob"])
  assert.equal(ours.owner, "bob")
  assert.equal(ours.names.alice, undefined)
  assert.equal((await s.store.forKey("alice")).length, 0)
  const r = await s.call("bob", "/sync", { since: 0, notes: [] })
  assert.deepEqual(r.body.notes.map((n) => n.note.title.v).sort(), ["Bob's", "Ours"])
  assert.equal(r.body.notes.find((n) => n.note.id === ID("e")).share, null)
  // again: nothing left to do
  assert.deepEqual(await s.notes.eraseAccount({ key: "alice" }), { removed: 0, left: 0 })
})
