// Explore's private places, the Bag and gifts (server/roam/life.js): default private, sharing
// only with buddies, the caps, gifts, the eraser. Places here are made-up numbers in a test
// town's frame: no real address is anywhere in the repo (and a test below checks that).
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const express = require("express")
const { createRoamLife, memoryLifeStore } = require("../life")

const TOKENS = { alice: "a".repeat(48), bob: "b".repeat(48), carol: "c".repeat(48), dave: "d".repeat(48) }
const NAMES = { alice: "Alice", bob: "Bob", carol: "Carol", dave: "Dave" }
const BUDDIES = { alice: ["Bob", "Carol"], bob: ["Alice"], carol: ["Alice"], dave: [] }

const start = async ({ blocked = {}, limits } = {}) => {
  const emitted = []
  const sessions = new Map(
    Object.keys(TOKENS).map((key) => [key, { key, token: TOKENS[key], user: { screenName: NAMES[key], blocked: blocked[key] || [], groups: [{ name: "Buddies", buddies: BUDDIES[key] }] }, socket: { emit: (event, payload) => emitted.push({ to: key, event, payload }) } }])
  )
  const aim = { sessions, store: { find: async (key) => (NAMES[key] ? { screenName: NAMES[key], blocked: blocked[key] || [] } : null) } }
  const store = memoryLifeStore()
  const life = createRoamLife({ aim: () => aim, store, limits })
  const app = express()
  app.use("/api/roamlife", life.router())
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/roamlife`
  const call = async (who, p, body) => {
    const r = await fetch(base + p, { method: "POST", headers: { ...(who ? { Authorization: `Bearer ${TOKENS[who]}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
    return { status: r.status, body: await r.json() }
  }
  return { call, life, store, emitted, sent: (to, ev) => emitted.filter((e) => e.to === to && e.event === ev), close: () => server.close() }
}

// a building somewhere in a test town (numbers only)
const place = (id, kind = "home", extra = {}) => ({ id, kind, town: "valencia", x: 100 + id.length, z: -40, door: { x: 104, z: -30, yaw: 3.1 }, ...extra })

test("places are private until shared, and then only with the buddies picked", async (t) => {
  const s = await start()
  t.after(s.close)
  assert.equal((await s.call(null, "/state")).status, 401)
  let r = await s.call("alice", "/places/save", { place: place("home0001") })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.places[0].label, "Home")
  assert.deepEqual(r.body.places[0].shared, [])
  // nobody sees it
  for (const who of ["bob", "carol", "dave"]) assert.equal((await s.call(who, "/state")).body.shared.length, 0)
  // a non-buddy can't be picked; a buddy can
  assert.equal((await s.call("alice", "/places/share", { id: "home0001", with: ["Dave"] })).status, 403)
  r = await s.call("alice", "/places/share", { id: "home0001", with: ["Bob"] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(s.sent("bob", "roamlife:shared").length, 1)
  const bob = (await s.call("bob", "/state")).body.shared
  assert.equal(bob.length, 1)
  assert.equal(bob[0].ownerName, "Alice")
  assert.equal(bob[0].kind, "home")
  assert.equal(bob[0].shared, undefined, "viewers don't see who else it's shared with")
  assert.equal((await s.call("carol", "/state")).body.shared.length, 0)
  // saving the place again (moved) keeps the sharing; un-sharing hides it again
  r = await s.call("alice", "/places/save", { place: place("home0001", "home", { x: 220 }) })
  assert.deepEqual(r.body.places[0].shared, ["bob"])
  await s.call("alice", "/places/share", { id: "home0001", with: [] })
  assert.equal((await s.call("bob", "/state")).body.shared.length, 0)
})

test("blocking hides a shared place; bad places and the 10-place cap are refused", async (t) => {
  const s = await start({ blocked: { bob: ["alice"] } })
  t.after(s.close)
  assert.equal((await s.call("alice", "/places/save", { place: { id: "x", kind: "castle" } })).status, 400)
  assert.equal((await s.call("alice", "/places/save", { place: place("work0001", "work", { x: 1e9 }) })).status, 400)
  for (let i = 0; i < 10; i++) assert.equal((await s.call("alice", "/places/save", { place: place(`place${i}a`, i % 2 ? "work" : "home") })).status, 200)
  assert.equal((await s.call("alice", "/places/save", { place: place("place10a") })).status, 413)
  // Bob blocked Alice: she can't share with him
  assert.equal((await s.call("alice", "/places/share", { id: "place0a", with: ["Bob"] })).status, 403)
  // and a label is cleaned
  const r = await s.call("alice", "/places/save", { place: place("place0a", "home", { label: "<b>My spot</b>" }) })
  assert.equal(r.body.places.find((p) => p.id === "place0a").label, "bMy spot/b")
})

test("the Bag: buying adds packs, using takes them, the caps hold", async (t) => {
  const s = await start()
  t.after(s.close)
  let r = await s.call("alice", "/bag/add", { items: { sparkle24: 1, paddleblue: 1, grill: 1 } })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(r.body.bag, { sparkle24: 24, paddleblue: 1, grill: 1 })
  assert.equal((await s.call("alice", "/bag/add", { items: { costcoTV: 1 } })).status, 400)
  r = await s.call("alice", "/bag/use", { id: "sparkle24", n: 2 })
  assert.equal(r.body.bag.sparkle24, 22)
  assert.equal((await s.call("alice", "/bag/use", { id: "teddy" })).status, 400)
  // 999 of one at most
  assert.equal((await s.call("alice", "/bag/add", { items: { water40: 30 } })).status, 400)
  r = await s.call("alice", "/work", { secs: 600 })
  assert.deepEqual(r.body.work, { secs: 600, shifts: 1 })
})

test("gifts: to a buddy only, out of your Bag, taken or given back", async (t) => {
  const s = await start()
  t.after(s.close)
  await s.call("alice", "/bag/add", { items: { roses: 1, teddy: 1 } })
  assert.equal((await s.call("alice", "/bag/gift", { to: "Dave", id: "roses" })).status, 403)
  assert.equal((await s.call("alice", "/bag/gift", { to: "Bob", id: "necklace" })).status, 400, "not in her Bag")
  let r = await s.call("alice", "/bag/gift", { to: "Bob", id: "roses", note: "For you ♥" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.bag.roses, undefined)
  assert.equal(s.sent("bob", "roamlife:gift")[0].payload.item, "roses")
  const bob = (await s.call("bob", "/state")).body
  assert.equal(bob.gifts.length, 1)
  assert.equal(bob.gifts[0].note, "For you ♥")
  r = await s.call("bob", "/gifts/accept", { id: bob.gifts[0].id })
  assert.equal(r.body.bag.roses, 1)
  assert.equal(r.body.gifts.length, 0)
  // declined: back in the giver's Bag
  await s.call("alice", "/bag/gift", { to: "Bob", id: "teddy" })
  const g = (await s.call("bob", "/state")).body.gifts[0]
  await s.call("bob", "/gifts/decline", { id: g.id })
  assert.equal((await s.call("alice", "/state")).body.bag.teddy, 1)
})

test("Delete My Account erases the record, my name on others' places and my waiting gifts", async (t) => {
  const s = await start()
  t.after(s.close)
  await s.call("bob", "/places/save", { place: place("bobhome1") })
  await s.call("bob", "/places/share", { id: "bobhome1", with: ["Alice"] })
  await s.call("alice", "/places/save", { place: place("alhome01") })
  await s.call("alice", "/bag/add", { items: { roses: 1 } })
  await s.call("alice", "/bag/gift", { to: "Bob", id: "roses" })
  assert.equal((await s.store.get("bob")).gifts.length, 1)
  const r = await s.life.eraseAccount({ key: "alice" })
  assert.equal(r.removed, 1)
  assert.equal(await s.store.get("alice"), null)
  const bob = await s.store.get("bob")
  assert.deepEqual(bob.places[0].shared, [])
  assert.equal(bob.gifts.length, 0)
  // idempotent
  assert.deepEqual(await s.life.eraseAccount({ key: "alice" }), { removed: 0, changed: 0 })
})

test("no real address or workplace is in the code: places only exist in user data", () => {
  const root = path.join(__dirname, "../../../client/src/roam")
  const files = []
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(path.join(d, f.name))
      else if (/\.(js|jsx)$/.test(f.name)) files.push(path.join(d, f.name))
    }
  }
  walk(root)
  files.push(path.join(__dirname, "../life.js"))
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8")
    // no street address (a number and a street word), no home/work coordinates written into the code
    assert.ok(!/\b\d{2,6}\s+[A-Z][a-z]+\s+(Street|St\.|Avenue|Ave\.|Road|Rd\.|Drive|Dr\.|Lane|Ln\.|Way|Court|Ct\.|Place|Blvd|Boulevard|Parkway)\b/.test(text), `an address in ${f}`)
    assert.ok(!/\b(home|work)\s*:\s*\{\s*x\s*:\s*-?\d/i.test(text), `a home/work spot in ${f}`)
  }
  // and the towns don't name anyone's home or work
  for (const f of fs.readdirSync(path.join(root, "towns"))) assert.ok(!/\b(home|work|office)s?\s*:/i.test(fs.readFileSync(path.join(root, "towns", f), "utf8")), f)
})
