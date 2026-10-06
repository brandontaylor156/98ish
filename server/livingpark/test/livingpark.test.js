const test = require("node:test")
const assert = require("node:assert/strict")
const express = require("express")
const { createLivingPark } = require("..")
const { memoryStore } = require("../store")

const NAMES = { alice: "Alice", bob: "Bob", carol: "Carol", dave: "Dave" }
const TOKENS = Object.fromEntries(Object.keys(NAMES).map((k, i) => [k, String.fromCharCode(97 + i).repeat(48)]))
// Alice's Buddy List has Bob and Dave; Carol isn't on it
const GROUPS = { alice: [{ name: "Buddies", buddies: ["Bob", "Dave"] }], bob: [{ name: "Buddies", buddies: ["Alice"] }], carol: [], dave: [{ name: "Buddies", buddies: ["Alice"] }] }

const start = async ({ blocked = {}, online = ["bob", "carol", "dave"] } = {}) => {
  const pushed = []
  let t = Date.UTC(2026, 9, 6, 17)
  const sessions = new Map(Object.keys(NAMES).map((key) => [key, { key, token: TOKENS[key], user: { screenName: NAMES[key], blocked: blocked[key] || [] } }]))
  const live = new Set(online)
  // (only the online ones have a session; the server only reads sessions for tokens and presence)
  const aim = {
    sessions: { get: (k) => (live.has(k) ? sessions.get(k) : undefined), values: () => [...sessions.values()] },
    store: { find: async (key) => (NAMES[key] ? { screenName: NAMES[key], blocked: blocked[key] || [], groups: GROUPS[key] } : null) },
  }
  const push = { notify: async (key, category, message, opts) => (pushed.push({ key, category, message, opts }), { sent: 1 }) }
  const store = memoryStore()
  const park = createLivingPark({ aim: () => aim, store, push, now: () => t, limits: { records: 3 } })
  const app = express()
  app.use("/api/livingpark", park.router())
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/livingpark`
  const call = async (who, path, body) => {
    const response = await fetch(base + path, { method: "POST", headers: { ...(who ? { Authorization: `Bearer ${TOKENS[who]}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
    return { status: response.status, body: await response.json() }
  }
  return { call, park, store, pushed, live, close: () => server.close(), advance: (ms) => (t += ms) }
}

const myClone = (origin = "self") => ({ format: "98ish-clone", v: 1, id: "calice1", name: "Alice", base: "intermediate", hand: 1, origin, evidence: { shots: 40, rallies: 10, seconds: 300 }, counts: { net: { k: 8, n: 10 } } })

test("leave: only your own clone, a known venue, the phrasebook cleaned", async (t) => {
  const s = await start()
  t.after(s.close)
  assert.equal((await s.call(null, "/mine")).status, 401)
  assert.equal((await s.call("alice", "/leave", { venue: "loscab", clone: myClone("video") })).status, 403, "a clone of someone else can't be left")
  assert.equal((await s.call("alice", "/leave", { venue: "loscab", clone: myClone("shared") })).status, 403, "nor a friend's")
  assert.equal((await s.call("alice", "/leave", { venue: "mars", clone: myClone() })).status, 400)
  const long = "x".repeat(200)
  const r = await s.call("alice", "/leave", { venue: "loscab", clone: myClone(), look: { body: "f" }, phrases: { greet: ["  Hi   there ", long], win: [] } })
  assert.equal(r.status, 200)
  const rec = r.body.record
  assert.equal(rec.venue, "loscab")
  assert.equal(rec.clone.origin, "self")
  assert.equal(rec.phrases.greet[0], "Hi there")
  assert.equal(rec.phrases.greet[1].length, 60, "lines are capped")
  assert.ok(rec.phrases.win.length > 0, "an empty kind falls back to polite defaults")
  // one record per account: leaving again moves it
  await s.call("alice", "/leave", { venue: "smash", clone: myClone() })
  assert.equal((await s.call("alice", "/mine")).body.record.venue, "smash")
  assert.equal(s.store.docs.size, 1)
})

test("visiting: only the owner's buddies, only while the owner is away, never blocked", async (t) => {
  const s = await start()
  t.after(s.close)
  await s.call("alice", "/leave", { venue: "loscab", clone: myClone() })
  // Alice is signed off (not in "online"), Bob is her buddy
  let r = await s.call("bob", "/venue", { venue: "loscab" })
  assert.equal(r.body.clones.length, 1)
  assert.equal(r.body.clones[0].name, "Alice")
  assert.equal(r.body.clones[0].owner, "alice")
  assert.equal((await s.call("bob", "/venue", { venue: "smash" })).body.clones.length, 0, "only at its venue")
  assert.equal((await s.call("carol", "/venue", { venue: "loscab" })).body.clones.length, 0, "not on her Buddy List: not shown")
  // Alice signs on: her clone stands down
  s.live.add("alice")
  assert.equal((await s.call("bob", "/venue", { venue: "loscab" })).body.clones.length, 0)
  s.live.delete("alice")
  // blocked either way: hidden
  const b = await start({ blocked: { alice: ["dave"] } })
  t.after(b.close)
  await b.call("alice", "/leave", { venue: "loscab", clone: myClone() })
  assert.equal((await b.call("dave", "/venue", { venue: "loscab" })).body.clones.length, 0)
})

test("a challenge result: logged (capped), the owner's push, the away card, seen", async (t) => {
  const s = await start()
  t.after(s.close)
  await s.call("alice", "/leave", { venue: "loscab", clone: myClone() })
  assert.equal((await s.call("bob", "/result", { owner: "alice", cloneWon: true, score: [7, 11] })).status, 400, "score and winner must agree")
  assert.equal((await s.call("bob", "/result", { owner: "alice", cloneWon: false, score: [7, 7] })).status, 400)
  assert.equal((await s.call("carol", "/result", { owner: "alice", cloneWon: false, score: [7, 11] })).status, 404, "a non-buddy can't play it")
  let r = await s.call("bob", "/result", { owner: "alice", cloneWon: false, score: [7, 11] })
  assert.equal(r.status, 200)
  assert.equal(s.pushed.length, 1)
  assert.equal(s.pushed[0].key, "alice")
  assert.equal(s.pushed[0].category, "pickleball")
  assert.equal(s.pushed[0].message.body, "Your clone lost to Bob 7-11 at Los Cab")
  await s.call("dave", "/result", { owner: "alice", cloneWon: true, score: [11, 4] })
  r = await s.call("alice", "/mine")
  assert.equal(r.body.away.games, 2)
  assert.equal(r.body.away.won, 1)
  assert.match(r.body.away.headline, /2 games while you were away: 1 won, 1 lost/)
  assert.equal(r.body.record.log[0].by, "Dave", "newest first")
  await s.call("alice", "/seen")
  assert.equal((await s.call("alice", "/mine")).body.away.games, 0)
  // the log keeps 50; a visitor gets 20 results a day per clone
  for (let i = 0; i < 19; i++) await s.call("bob", "/result", { owner: "alice", cloneWon: true, score: [11, i % 10] })
  assert.equal((await s.call("bob", "/result", { owner: "alice", cloneWon: true, score: [11, 2] })).status, 429)
  s.advance(86_400_000)
  for (let i = 0; i < 20; i++) await s.call("bob", "/result", { owner: "alice", cloneWon: false, score: [3, 11] })
  for (let i = 0; i < 20; i++) await s.call("dave", "/result", { owner: "alice", cloneWon: false, score: [3, 11] })
  assert.equal((await s.call("alice", "/mine")).body.record.log.length, 50)
  assert.equal((await s.call("bob", "/result", { owner: "alice", cloneWon: true, score: [11, 2] })).status, 429)
  // recall: gone (and its log)
  await s.call("alice", "/recall")
  assert.equal((await s.call("alice", "/mine")).body.record, null)
  s.advance(86_400_000)
  assert.equal((await s.call("dave", "/result", { owner: "alice", cloneWon: true, score: [11, 2] })).status, 404)
})

test("caps and Delete My Account", async (t) => {
  const s = await start()
  t.after(s.close)
  for (const who of ["alice", "bob", "carol"]) assert.equal((await s.call(who, "/leave", { venue: "loscab", clone: { ...myClone(), id: `c${who}` } })).status, 200)
  assert.equal((await s.call("dave", "/leave", { venue: "loscab", clone: myClone() })).status, 507, "the park's record cap")
  await s.call("bob", "/result", { owner: "alice", cloneWon: false, score: [5, 11] })
  // Bob deletes his account: his clone goes; in Alice's log he becomes "Deleted player"
  const r = await s.park.eraseAccount({ key: "bob" })
  assert.equal(r.removed, 1)
  assert.equal(r.changed, 1)
  const alice = await s.store.get("alice")
  assert.equal(alice.log[0].by, "Deleted player")
  assert.equal(alice.log[0].byKey, null)
  assert.equal(await s.store.get("bob"), null)
  // records left alone for 60 days are taken back
  s.advance(61 * 86_400_000)
  assert.equal((await s.park.sweep()).removed, 2)
})
