// Live Venue Presence through Buddy Locator's server: a sharer at a real Pickleball 98 venue
// gets { id, area } next to their position, for exactly the people who may see them.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const express = require("express")
const { createLocate } = require("..")
const { memoryStore } = require("../store")
const { createPresence, loadVenues } = require("../presence")

const TOKENS = { alice: "a".repeat(48), bob: "b".repeat(48), carol: "c".repeat(48) }
const NAMES = { alice: "Alice", bob: "Bob", carol: "Carol" }
const BUDDIES = { alice: ["Bob", "Carol"], bob: ["Alice"], carol: ["Alice"] }

// Los Cab's real origin and first court, from the files the server reads
const SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../client/src/components/applets/pickleball/park/venues/loscab.json"), "utf8"))
const BOUNDS = JSON.parse(fs.readFileSync(path.join(__dirname, "../../park/venues.json"), "utf8")).loscab.bounds
const M = 111320
const at = (x, z, acc = 8) => {
  const [lat0, lon0] = SPEC.origin
  const k = Math.cos((lat0 * Math.PI) / 180)
  return { lat: lat0 - z / M, lon: lon0 + x / (M * k), acc }
}
const C0 = SPEC.courts[0]

const start = async () => {
  const emitted = []
  let t = Date.parse("2026-10-06T16:00:00Z")
  const sessions = new Map(
    Object.keys(TOKENS).map((key) => [key, { key, token: TOKENS[key], user: { screenName: NAMES[key], blocked: [], groups: [{ name: "Buddies", buddies: BUDDIES[key] }] }, socket: { emit: (event, payload) => emitted.push({ to: key, event, payload }) } }])
  )
  const aim = { sessions, store: { find: async (key) => (NAMES[key] ? { screenName: NAMES[key], blocked: [] } : null) } }
  const presence = createPresence()
  const locate = createLocate({ aim: () => aim, store: memoryStore(), now: () => t, sweepMs: 0, presence })
  const app = express()
  app.use("/api/locate", locate.router())
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/locate`
  const call = async (who, p, body) => {
    const response = await fetch(base + p, { method: "POST", headers: { Authorization: `Bearer ${TOKENS[who]}`, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
    return { status: response.status, body: await response.json() }
  }
  const sent = (to, event) => emitted.filter((e) => e.to === to && e.event === event)
  return { call, sent, presence, tick: (ms) => (t += ms), close: () => server.close() }
}

test("the server knows the eight real venues (origin, courts, bounds), never Riverside", async () => {
  const venues = await loadVenues()
  const ids = venues.map((v) => v.id).sort()
  assert.deepEqual(ids, ["bouquet", "loscab", "newport", "paseo", "sinaloa", "smash", "whittier", "wolfbear"])
  for (const v of venues) {
    assert.equal(v.origin.length, 2)
    assert.ok(v.courts.length > 0 && v.bounds.x1 > v.bounds.x0)
  }
})

test("a sharer at Los Cab: only the people they share with get { venue: { id, area } }", async (t) => {
  const s = await start()
  t.after(s.close)
  await s.call("alice", "/share", { to: "Bob", until: null })
  const r = await s.call("alice", "/update", at(C0.x + 1, C0.z))
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(r.body.venue, { id: "loscab", area: "c0" })
  // Bob hears it live and reads it in /state; Carol (not shared with) gets nothing at all
  const live = s.sent("bob", "loc:pos").at(-1).payload
  assert.deepEqual(live.venue, { id: "loscab", area: "c0" })
  assert.equal(s.sent("carol", "loc:pos").length, 0)
  const bob = await s.call("bob", "/state")
  assert.deepEqual(bob.body.friends[0].venue, { id: "loscab", area: "c0" })
  assert.equal((await s.call("carol", "/state")).body.friends.length, 0)
  // Alice's own /state says where she is (for checking in to a session there)
  assert.deepEqual((await s.call("alice", "/state")).body.me.venue, { id: "loscab", area: "c0" })
})

test("the venue is court-level only: two spots on the same court look the same", async (t) => {
  const s = await start()
  t.after(s.close)
  await s.call("alice", "/share", { to: "Bob", until: null })
  await s.call("alice", "/update", at(C0.x - 2, C0.z - 1))
  const a = s.sent("bob", "loc:pos").at(-1).payload.venue
  s.tick(60_000)
  await s.call("alice", "/update", at(C0.x + 2, C0.z + 1))
  const b = s.sent("bob", "loc:pos").at(-1).payload.venue
  assert.deepEqual(a, b)
  assert.deepEqual(Object.keys(a).sort(), ["area", "id"])
})

test("approximate location shows as 'nearby', never placed on a court", async (t) => {
  const s = await start()
  t.after(s.close)
  await s.call("alice", "/share", { to: "Bob", until: null })
  await s.call("alice", "/settings", { coarse: true })
  const r = await s.call("alice", "/update", at(C0.x, C0.z))
  assert.deepEqual(r.body.venue, { id: "loscab", nearby: true })
  assert.equal(s.sent("bob", "loc:pos").at(-1).payload.venue.area, undefined)
})

test("hysteresis at the gate, and leaving", async (t) => {
  const s = await start()
  t.after(s.close)
  await s.call("alice", "/share", { to: "Bob", until: null })
  await s.call("alice", "/update", at(C0.x, C0.z))
  s.tick(60_000)
  // a little past the edge: still at Los Cab
  let r = await s.call("alice", "/update", at(BOUNDS.x1 + 15, 0))
  assert.equal(r.body.venue?.id, "loscab")
  s.tick(60_000)
  // well away: gone
  r = await s.call("alice", "/update", at(BOUNDS.x1 + 400, 0))
  assert.equal(r.body.venue, null)
  assert.equal(s.sent("bob", "loc:pos").at(-1).payload.venue, null)
})

test("stopping or pausing forgets it (nothing kept), and a paused sharer has no venue", async (t) => {
  const s = await start()
  t.after(s.close)
  await s.call("alice", "/share", { to: "Bob", until: null })
  await s.call("alice", "/update", at(C0.x, C0.z))
  assert.equal(s.presence.size, 1)
  await s.call("alice", "/pause", { paused: true })
  assert.equal(s.presence.size, 0)
  assert.equal((await s.call("bob", "/state")).body.friends[0].venue, null)
  await s.call("alice", "/pause", { paused: false })
  await s.call("alice", "/update", at(C0.x, C0.z))
  assert.equal(s.presence.size, 1)
  await s.call("alice", "/unshare", { all: true })
  assert.equal(s.presence.size, 0)
  assert.equal((await s.call("bob", "/state")).body.friends.length, 0)
})
