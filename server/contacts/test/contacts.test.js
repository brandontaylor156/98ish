const test = require("node:test")
const assert = require("node:assert/strict")
const express = require("express")
const { contactsRouter, mergeContacts } = require("..")
const { memoryStore } = require("../store")
const { cleanContact, cleanContacts } = require("../validate")

const TOKEN_A = "a".repeat(48)
const TOKEN_B = "b".repeat(48)
const PICTURE = "data:image/jpeg;base64," + "A".repeat(400)

const person = (id, patch = {}) => ({ id, updatedAt: 1_700_000_000_000, first: "Jane", last: "Doe", screenName: "jane98", phones: [{ label: "cell", value: "555-0100" }], groups: ["Friends"], ...patch })

// A server with two signed-on 98 Messenger sessions (alice, bob)
const start = async (options = {}) => {
  const sessions = new Map([
    ["alice", { key: "alice", token: TOKEN_A, user: { screenName: "Alice" } }],
    ["bob", { key: "bob", token: TOKEN_B, user: { screenName: "Bob" } }],
  ])
  const store = options.store || memoryStore()
  const app = express()
  app.use("/api/contacts", contactsRouter({ aim: Promise.resolve({ sessions }), store, ...options }))
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/contacts`
  const call = async (method, path, { token = TOKEN_A, body, raw } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body || raw ? { "Content-Type": "application/json" } : {}) },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    })
    return { status: response.status, body: await response.json() }
  }
  return { sessions, store, call, close: () => server.close() }
}

test("validator cleans contacts and refuses damaged ones", () => {
  const ok = cleanContact(person("abcd1234", { first: "  Jane\n", notes: "line 1\nline 2", evil: "<script>", birthday: "19900517", anniversary: "--06-20", groups: ["Family", "Family", ""] }))
  assert.equal(ok.ok, true)
  assert.equal(ok.contact.first, "Jane")
  assert.equal(ok.contact.notes, "line 1\nline 2")
  assert.equal(ok.contact.evil, undefined)
  assert.equal(ok.contact.birthday, "1990-05-17")
  assert.equal(ok.contact.anniversary, "--06-20")
  assert.deepEqual(ok.contact.groups, ["Family"])
  assert.equal(cleanContact(person("abcd1234", { birthday: "1990-13-40" })).contact.birthday, "")
  assert.equal(cleanContact(person("abcd1234", { first: "x".repeat(500) })).contact.first.length, 60)

  for (const bad of [null, [], person("short"), person("ABCDEFGH1"), person("abcd1234", { updatedAt: "now" }), person("abcd1234", { updatedAt: -1 }), person("abcd1234", { picture: "javascript:alert(1)" }), person("abcd1234", { picture: "data:image/jpeg;base64," + "A".repeat(90_000) })]) {
    assert.equal(cleanContact(bad).ok, false, JSON.stringify(bad)?.slice(0, 60))
  }
  // a tombstone keeps only what it needs
  assert.deepEqual(cleanContact({ id: "abcd1234", updatedAt: 5, deleted: true, first: "Gone" }).contact, { id: "abcd1234", updatedAt: 5, deleted: true })
  // clocks in the future are pulled back
  const now = 1_000_000
  assert.equal(cleanContact(person("abcd1234", { updatedAt: now * 1000 }), now).contact.updatedAt, now + 5 * 60_000)
  assert.equal(cleanContacts("nope").ok, false)
  assert.equal(cleanContacts(Array.from({ length: 2001 }, (_, i) => person(`id${String(i).padStart(6, "0")}`))).ok, false)
})

test("merge: the newer change wins, tombstones delete, old tombstones are forgotten", () => {
  const now = 2_000_000_000_000
  const a = { ...person("aaaaaaaa"), updatedAt: 10 }
  const b = { ...person("bbbbbbbb"), updatedAt: 10 }
  const merged = mergeContacts([a, b], [{ ...a, first: "Older", updatedAt: 5 }, { ...b, first: "Newer", updatedAt: 20 }, { id: "cccccccc", updatedAt: now - 1000, deleted: true }], now)
  assert.equal(merged.find((c) => c.id === "aaaaaaaa").first, "Jane")
  assert.equal(merged.find((c) => c.id === "bbbbbbbb").first, "Newer")
  assert.ok(merged.find((c) => c.id === "cccccccc").deleted)
  const later = mergeContacts(merged, [], now + 200 * 86_400_000)
  assert.equal(later.find((c) => c.id === "cccccccc"), undefined, "a tombstone older than 180 days is dropped")
})

test("every request needs a signed-on 98 Messenger session", async () => {
  const server = await start()
  try {
    assert.equal((await server.call("GET", "/", { token: null })).status, 401)
    assert.equal((await server.call("GET", "/", { token: "c".repeat(48) })).status, 401)
    assert.equal((await server.call("POST", "/sync", { token: "nope", body: { contacts: [] } })).status, 401)
    const empty = await server.call("GET", "/")
    assert.equal(empty.status, 200)
    assert.deepEqual(empty.body.contacts, [])
    assert.equal(empty.body.revision, 0)
    assert.equal(typeof empty.body.now, "number")
    // signing off ends the token
    server.sessions.delete("alice")
    assert.equal((await server.call("GET", "/")).status, 401)
  } finally {
    server.close()
  }
})

test("sync merges per contact and keeps accounts apart", async () => {
  const server = await start()
  try {
    const first = await server.call("POST", "/sync", { body: { contacts: [person("aaaaaaaa", { picture: PICTURE }), person("bbbbbbbb", { first: "Bob", updatedAt: 100 })] } })
    assert.equal(first.status, 200)
    assert.equal(first.body.contacts.length, 2)
    assert.equal(first.body.revision, 1)
    assert.equal(first.body.contacts.find((c) => c.id === "aaaaaaaa").picture, PICTURE)

    // another device: an older edit loses, a newer one wins, a delete is a tombstone
    const second = await server.call("POST", "/sync", {
      body: { contacts: [person("aaaaaaaa", { first: "Stale", updatedAt: 1 }), person("bbbbbbbb", { first: "Robert", updatedAt: 200 }), { id: "cccccccc", updatedAt: Date.now(), deleted: true }] },
    })
    const byId = Object.fromEntries(second.body.contacts.map((c) => [c.id, c]))
    assert.equal(byId.aaaaaaaa.first, "Jane")
    assert.equal(byId.bbbbbbbb.first, "Robert")
    assert.equal(byId.cccccccc.deleted, true)
    assert.equal(second.body.revision, 2)

    // nothing to send: just reads (no new revision)
    const read = await server.call("POST", "/sync", { body: { contacts: [] } })
    assert.equal(read.body.revision, 2)

    // Bob's book is his own
    const bob = await server.call("GET", "/", { token: TOKEN_B })
    assert.deepEqual(bob.body.contacts, [])

    // forget it
    assert.equal((await server.call("DELETE", "/")).status, 200)
    assert.deepEqual((await server.call("GET", "/")).body.contacts, [])
  } finally {
    server.close()
  }
})

test("bad requests and size limits", async () => {
  const server = await start({ maxContacts: 3, maxBytes: 20_000 })
  try {
    assert.equal((await server.call("POST", "/sync", { body: { contacts: "all of them" } })).status, 400)
    assert.equal((await server.call("POST", "/sync", { body: { contacts: [person("bad id!")] } })).status, 400)
    assert.equal((await server.call("POST", "/sync", { raw: "{not json" })).status, 400)
    const four = ["aaaaaaaa", "bbbbbbbb", "cccccccc", "dddddddd"].map((id) => person(id))
    const tooMany = await server.call("POST", "/sync", { body: { contacts: four } })
    assert.equal(tooMany.status, 413)
    assert.match(tooMany.body.error, /3 contacts/)
    const big = ["aaaaaaaa", "bbbbbbbb", "cccccccc"].map((id) => person(id, { picture: "data:image/jpeg;base64," + "A".repeat(9_000) }))
    const full = await server.call("POST", "/sync", { body: { contacts: big } })
    assert.equal(full.status, 413)
    // a body over the parser's limit
    const huge = await server.call("POST", "/sync", { raw: JSON.stringify({ contacts: [], pad: "x".repeat(200_000) }) })
    assert.equal(huge.status, 413)
    assert.deepEqual((await server.call("GET", "/")).body.contacts, [], "nothing was saved")
  } finally {
    server.close()
  }
})

test("a save that races another device reads again and merges", async () => {
  const store = memoryStore()
  // the first put fails as if another device saved in between (it adds its own contact)
  let raced = false
  const racing = {
    ...store,
    put: async (key, data, base) => {
      if (!raced) {
        raced = true
        await store.put(key, JSON.stringify([person("zzzzzzzz", { first: "Other device" })]), base)
      }
      return store.put(key, data, base)
    },
  }
  const server = await start({ store: racing })
  try {
    const result = await server.call("POST", "/sync", { body: { contacts: [person("aaaaaaaa")] } })
    assert.equal(result.status, 200)
    assert.deepEqual(result.body.contacts.map((c) => c.id).sort(), ["aaaaaaaa", "zzzzzzzz"])
  } finally {
    server.close()
  }
})

test("rate limits: writes per account and bad tokens per address", async () => {
  const server = await start({ limits: { writes: 2, badTokens: 2 } })
  try {
    assert.equal((await server.call("POST", "/sync", { body: { contacts: [] } })).status, 200)
    assert.equal((await server.call("POST", "/sync", { body: { contacts: [] } })).status, 200)
    assert.equal((await server.call("POST", "/sync", { body: { contacts: [] } })).status, 429)
    assert.equal((await server.call("POST", "/sync", { token: TOKEN_B, body: { contacts: [] } })).status, 200, "another account isn't limited")
    for (let i = 0; i < 2; i++) await server.call("GET", "/", { token: "f".repeat(48) })
    assert.equal((await server.call("GET", "/", { token: TOKEN_B })).status, 429, "too many bad tokens from this address")
  } finally {
    server.close()
  }
})
