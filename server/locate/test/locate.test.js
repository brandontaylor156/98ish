const test = require("node:test")
const assert = require("node:assert/strict")
const express = require("express")
const { createLocate } = require("..")
const { memoryStore } = require("../store")

const TOKENS = { alice: "a".repeat(48), bob: "b".repeat(48), carol: "c".repeat(48), dave: "d".repeat(48) }
const NAMES = { alice: "Alice", bob: "Bob", carol: "Carol", dave: "Dave" }
// Alice has Bob and Carol as buddies; Bob has Alice; Carol has Alice; Dave has nobody
const BUDDIES = { alice: ["Bob", "Carol"], bob: ["Alice"], carol: ["Alice"], dave: [] }

const HOME = { lat: 33.714, lon: -117.924 } // Los Cab-ish
const FAR = { lat: 33.75, lon: -117.9 }

// A server with four signed-on 98 Messenger sessions, sockets that remember what they were
// sent, a push service that remembers its notifications and a clock the test moves
const start = async ({ blocked = {}, limits } = {}) => {
  const emitted = []
  const pushed = []
  let t = Date.parse("2026-10-05T12:00:00Z")
  const clock = () => t
  const sessions = new Map(
    Object.keys(TOKENS).map((key) => [
      key,
      { key, token: TOKENS[key], user: { screenName: NAMES[key], blocked: blocked[key] || [], groups: [{ name: "Buddies", buddies: BUDDIES[key] }] }, socket: { emit: (event, payload) => emitted.push({ to: key, event, payload }) } },
    ])
  )
  const aim = { sessions, store: { find: async (key) => (NAMES[key] ? { screenName: NAMES[key], blocked: blocked[key] || [] } : null) } }
  const push = { notify: async (key, category, message) => (pushed.push({ key, category, message }), { sent: 1 }) }
  const store = memoryStore()
  const locate = createLocate({ aim: () => aim, store, push, now: clock, limits, sweepMs: 0 })
  const app = express()
  app.use("/api/locate", locate.router())
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/locate`
  const call = async (who, path, body) => {
    const response = await fetch(base + path, { method: "POST", headers: { ...(who ? { Authorization: `Bearer ${TOKENS[who]}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
    return { status: response.status, body: await response.json() }
  }
  const sent = (to, event) => emitted.filter((e) => e.to === to && e.event === event)
  return { call, locate, store, emitted, pushed, sessions, sent, tick: (ms) => (t += ms), now: clock, close: () => server.close() }
}

test("nothing is shared until you share; then only the chosen buddy sees you", async (t) => {
  const s = await start()
  t.after(s.close)
  // no token, no entry
  assert.equal((await s.call(null, "/state")).status, 401)
  // Alice sends a position while sharing with nobody: not kept
  let r = await s.call("alice", "/update", HOME)
  assert.equal(r.body.kept, false)
  assert.equal((await s.store.get("alice"))?.pos ?? null, null)
  assert.equal((await s.call("bob", "/state")).body.friends.length, 0)

  // share with Bob for an hour
  r = await s.call("alice", "/share", { to: "Bob", until: s.now() + 3600_000 })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(s.sent("bob", "loc:shared").length, 1)
  assert.equal(s.pushed.filter((p) => p.key === "bob" && p.category === "places").length, 1)
  r = await s.call("alice", "/update", HOME)
  assert.equal(r.body.kept, true)
  const live = s.sent("bob", "loc:pos").at(-1)
  assert.equal(live.payload.key, "alice")
  assert.equal(live.payload.pos.lat, HOME.lat)
  // Bob's state shows Alice; Carol's doesn't
  r = await s.call("bob", "/state")
  assert.deepEqual(r.body.friends.map((f) => [f.key, f.pos.lat]), [["alice", HOME.lat]])
  assert.equal((await s.call("carol", "/state")).body.friends.length, 0)
  assert.equal(s.sent("carol", "loc:pos").length, 0)
})

test("only buddies (or someone who asked); never yourself, SmarterChild, strangers or blocked people", async (t) => {
  const s = await start({ blocked: { carol: ["alice"] } })
  t.after(s.close)
  assert.equal((await s.call("alice", "/share", { to: "Dave" })).status, 403) // not a buddy
  assert.equal((await s.call("alice", "/share", { to: "Alice" })).status, 400)
  assert.equal((await s.call("alice", "/share", { to: "SmarterChild" })).status, 400)
  assert.equal((await s.call("alice", "/share", { to: "Nobody123" })).status, 404)
  assert.equal((await s.call("alice", "/share", { to: "Carol" })).status, 403) // Carol blocks Alice
  assert.equal((await s.call("alice", "/share", { to: "Bob", until: s.now() - 5 })).status, 400) // already over
  assert.equal((await s.call("alice", "/share", { to: "Bob", until: s.now() + 400 * 86400_000 })).status, 400)
  assert.equal((await s.call("alice", "/share", { to: "Bob", until: null })).status, 200) // indefinitely
})

test("asking: a buddy asks, the other says yes (or no)", async (t) => {
  const s = await start()
  t.after(s.close)
  // Dave can't ask Alice (Alice isn't his buddy)
  assert.equal((await s.call("dave", "/ask", { to: "Alice" })).status, 403)
  let r = await s.call("bob", "/ask", { to: "Alice" })
  assert.equal(r.body.asked, true)
  assert.equal(s.sent("alice", "loc:ask").at(-1).payload.from, "bob")
  assert.equal(s.pushed.at(-1).category, "places")
  r = await s.call("alice", "/state")
  assert.deepEqual(r.body.me.asks.map((a) => a.from), ["bob"])
  // asking twice keeps one
  await s.call("bob", "/ask", { to: "Alice" })
  assert.equal((await s.call("alice", "/state")).body.me.asks.length, 1)
  // yes, until the end of the day
  r = await s.call("alice", "/answer", { from: "bob", accept: true, until: s.now() + 5 * 3600_000 })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.me.asks.length, 0)
  assert.equal(r.body.me.shares[0].to, "bob")
  // already shared: asking again just says so
  assert.equal((await s.call("bob", "/ask", { to: "Alice" })).body.already, true)
  // Carol asks; Alice says no
  await s.call("carol", "/ask", { to: "Alice" })
  r = await s.call("alice", "/answer", { from: "carol", accept: false })
  assert.equal(r.body.me.asks.length, 0)
  assert.equal(r.body.me.shares.length, 1)
  assert.equal((await s.call("alice", "/answer", { from: "carol", accept: true })).status, 404)
})

test("a share ends on time: the viewer is told and the position is forgotten", async (t) => {
  const s = await start()
  t.after(s.close)
  await s.call("alice", "/share", { to: "Bob", until: s.now() + 3600_000 })
  await s.call("alice", "/update", HOME)
  s.tick(30 * 60_000)
  assert.equal((await s.call("bob", "/state")).body.friends.length, 1)
  s.tick(31 * 60_000)
  // even before the sweep, the state no longer shows it
  assert.equal((await s.call("bob", "/state")).body.friends.length, 0)
  const r = await s.locate.sweep()
  assert.equal(r.ended, 1)
  assert.equal(s.sent("bob", "loc:gone").at(-1).payload.reason, "ended")
  const doc = await s.store.get("alice")
  assert.equal(doc.pos, null)
  assert.equal(doc.shares.length, 0)
  // an update now isn't kept
  assert.equal((await s.call("alice", "/update", HOME)).body.kept, false)
})

test("pause hides you (and forgets the position); stop sharing with one or everyone", async (t) => {
  const s = await start()
  t.after(s.close)
  await s.call("alice", "/share", { to: "Bob" })
  await s.call("alice", "/share", { to: "Carol" })
  await s.call("alice", "/update", HOME)
  let r = await s.call("alice", "/pause", { paused: true })
  assert.equal(r.body.me.paused, true)
  assert.equal(r.body.me.pos, null)
  assert.equal(s.sent("bob", "loc:gone").at(-1).payload.reason, "paused")
  assert.equal((await s.call("alice", "/update", HOME)).body.kept, false)
  r = await s.call("bob", "/state")
  assert.equal(r.body.friends[0].paused, true)
  assert.equal(r.body.friends[0].pos, null)
  await s.call("alice", "/pause", { paused: false })
  assert.equal((await s.call("alice", "/update", HOME)).body.kept, true)
  // stop with Bob only
  r = await s.call("alice", "/unshare", { to: "Bob" })
  assert.equal(r.body.stopped, 1)
  assert.equal(s.sent("bob", "loc:gone").at(-1).payload.reason, "stopped")
  assert.equal((await s.call("bob", "/state")).body.friends.length, 0)
  assert.equal((await s.call("carol", "/state")).body.friends.length, 1)
  // Stop Sharing everywhere
  r = await s.call("alice", "/unshare", { all: true })
  assert.equal(r.body.stopped, 1)
  assert.equal((await s.store.get("alice")).pos, null)
  assert.equal((await s.call("carol", "/state")).body.friends.length, 0)
})

test("approximate location: snapped to ~1 km before it's kept or sent", async (t) => {
  const s = await start()
  t.after(s.close)
  await s.call("alice", "/share", { to: "Bob" })
  await s.call("alice", "/settings", { coarse: true })
  const exact = { lat: 33.71437, lon: -117.92391, acc: 8 }
  await s.call("alice", "/update", exact)
  const kept = (await s.store.get("alice")).pos
  assert.equal(kept.coarse, true)
  assert.equal(kept.acc, 1000)
  assert.notEqual(kept.lat, exact.lat)
  assert.ok(Math.abs(kept.lat - exact.lat) < 0.006)
  assert.deepEqual(s.sent("bob", "loc:pos").at(-1).payload.pos, kept)
})

test("places and alerts: arriving and leaving, with a margin, once each", async (t) => {
  const s = await start()
  t.after(s.close)
  await s.call("alice", "/share", { to: "Bob" })
  // Bob names a place and asks to hear when Alice arrives or leaves
  let r = await s.call("bob", "/places", { places: [{ name: "Los Cab", ...HOME, r: 150 }] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const place = r.body.me.places[0]
  assert.match(place.id, /^[a-z0-9]+$/)
  // watching someone who doesn't share with you is refused
  assert.equal((await s.call("bob", "/watch", { who: "carol", place: place.id, on: "both" })).status, 403)
  r = await s.call("bob", "/watch", { who: "alice", place: place.id, on: "both" })
  assert.equal(r.body.me.watches.length, 1)
  const alerts = () => s.sent("bob", "loc:alert").map((e) => e.payload.event)
  await s.call("alice", "/update", { ...FAR, acc: 10 }) // first position: just sets "outside"
  assert.deepEqual(alerts(), [])
  await s.call("alice", "/update", { lat: HOME.lat + 0.0005, lon: HOME.lon, acc: 10 }) // ~55 m in
  assert.deepEqual(alerts(), ["arrive"])
  assert.equal(s.pushed.at(-1).message.title, "Alice arrived at Los Cab")
  await s.call("alice", "/update", { lat: HOME.lat + 0.0005, lon: HOME.lon, acc: 10 }) // still there
  await s.call("alice", "/update", { lat: HOME.lat + 0.0015, lon: HOME.lon, acc: 10 }) // ~167 m: inside the margin
  assert.deepEqual(alerts(), ["arrive"])
  await s.call("alice", "/update", { lat: HOME.lat + 0.003, lon: HOME.lon, acc: 10 }) // ~333 m: left
  assert.deepEqual(alerts(), ["arrive", "leave"])
  // a vague position never decides
  await s.call("alice", "/update", { ...HOME, acc: 900 })
  assert.deepEqual(alerts(), ["arrive", "leave"])
  // arrive-only watch ignores leaving (a new watch starts from "not known yet")
  r = await s.call("bob", "/watch", { who: "alice", place: place.id, on: "arrive" })
  await s.call("alice", "/update", { ...FAR, acc: 10 })
  await s.call("alice", "/update", { ...HOME, acc: 10 })
  await s.call("alice", "/update", { ...FAR, acc: 10 })
  assert.deepEqual(alerts(), ["arrive", "leave", "arrive"])
  // removing the place removes its alerts
  r = await s.call("bob", "/places", { places: [] })
  assert.equal(r.body.me.watches.length, 0)
  // bad places are refused
  assert.equal((await s.call("bob", "/places", { places: [{ name: "", ...HOME }] })).status, 400)
  assert.equal((await s.call("bob", "/places", { places: [{ name: "Moon", lat: 99, lon: 0 }] })).status, 400)
})

test("venue places: Pickleball 98's real venues as places, so 'Alice arrived at Los Cab' just works", async (t) => {
  const meet = await import("../../../client/src/components/applets/pickleball/play/meet.js")
  const { VENUE_LIST } = await import("../../../client/src/components/applets/pickleball/park/venues/index.js")
  // every real venue makes a valid place (the same rules as any other place), one id each
  const core = await import("../../../client/src/components/applets/locator/locateCore.js")
  const all = VENUE_LIST.map((v) => meet.venuePlace(v.id))
  assert.equal(all.length, VENUE_LIST.length)
  assert.equal(new Set(all.map((p) => p.id)).size, all.length)
  for (const p of all) {
    const checked = core.cleanPlace(p)
    assert.equal(checked.ok, true, p.name)
    assert.deepEqual(checked.place, p, "kept exactly as made (id, name, centre, size)")
    assert.ok(p.r >= 100 && p.r <= 300)
  }
  assert.equal(meet.venuePlace("riverside"), null, "the made-up park isn't a place")
  assert.equal(meet.venueOfPlace(meet.venuePlace("smash")).id, "smash")
  // the choices leave out venues you already have
  assert.equal(meet.venuePlaceChoices([meet.venuePlace("loscab")]).some((c) => c.venue === "loscab"), false)
  assert.equal(meet.venuePlaceChoices([]).length, VENUE_LIST.length)

  const s = await start()
  t.after(s.close)
  await s.call("alice", "/share", { to: "Bob" })
  const loscab = meet.venuePlace("loscab")
  // the same venue twice keeps one id (and the server never trusts the client to avoid it)
  let r = await s.call("bob", "/places", { places: [loscab, meet.venuePlace("newport"), loscab] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const ids = r.body.me.places.map((p) => p.id)
  assert.equal(new Set(ids).size, 3)
  assert.equal(ids[0], "pbloscab")
  assert.equal(ids[1], "pbnewport")
  await s.call("bob", "/places", { places: [loscab, meet.venuePlace("newport")] })
  r = await s.call("bob", "/watch", { who: "alice", place: "pbloscab", on: "both" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const v = VENUE_LIST.find((x) => x.id === "loscab")
  await s.call("alice", "/update", { ...FAR, acc: 10 })
  await s.call("alice", "/update", { lat: v.lat + 0.0004, lon: v.lon, acc: 10 }) // ~45 m from the courts' middle
  assert.deepEqual(s.sent("bob", "loc:alert").map((e) => [e.payload.event, e.payload.place]), [["arrive", "Los Cab"]])
  assert.equal(s.pushed.at(-1).message.title, "Alice arrived at Los Cab")
  await s.call("alice", "/update", { ...FAR, acc: 10 })
  assert.deepEqual(s.sent("bob", "loc:alert").map((e) => e.payload.event), ["arrive", "leave"])
  // nothing new kept: the venue places are Bob's places (the 20-place cap, the same record)
  const doc = await s.store.get("bob")
  assert.deepEqual(doc.places.map((p) => Object.keys(p).sort()), [["id", "lat", "lon", "name", "r"], ["id", "lat", "lon", "name", "r"]])
  r = await s.call("bob", "/places", { places: Array.from({ length: 21 }, (_, i) => ({ ...loscab, id: `x${i}` })) })
  assert.equal(r.status, 413)
})

test("blocking hides you even with a share in place", async (t) => {
  const blocked = { bob: [] }
  const s = await start({ blocked })
  t.after(s.close)
  await s.call("alice", "/share", { to: "Bob" })
  await s.call("alice", "/update", HOME)
  assert.equal((await s.call("bob", "/state")).body.friends.length, 1)
  s.sessions.get("bob").user.blocked = ["alice"]
  blocked.bob = ["alice"]
  assert.equal((await s.call("bob", "/state")).body.friends.length, 0)
  const before = s.sent("bob", "loc:pos").length
  await s.call("alice", "/update", FAR)
  assert.equal(s.sent("bob", "loc:pos").length, before)
})

test("caps and rate limits", async (t) => {
  const s = await start({ limits: { updates: 3 } })
  t.after(s.close)
  await s.call("alice", "/share", { to: "Bob" })
  for (let i = 0; i < 3; i++) assert.equal((await s.call("alice", "/update", HOME)).status, 200)
  assert.equal((await s.call("alice", "/update", HOME)).status, 429)
  const many = Array.from({ length: 21 }, (_, i) => ({ name: `P${i}`, ...HOME }))
  assert.equal((await s.call("alice", "/places", { places: many })).status, 413)
  assert.equal((await s.call("alice", "/update", { lat: "x", lon: 2 })).status, 429) // still limited
})

test("Delete My Account: the record goes and the account leaves everyone else's", async (t) => {
  const s = await start()
  t.after(s.close)
  await s.call("alice", "/share", { to: "Bob" })
  await s.call("alice", "/update", HOME)
  await s.call("bob", "/share", { to: "Alice" })
  await s.call("carol", "/ask", { to: "Alice" })
  const r = await s.call("alice", "/places", { places: [{ name: "Home", ...HOME }] })
  await s.call("alice", "/watch", { who: "bob", place: r.body.me.places[0].id, on: "both" })
  // Bob deletes his account
  const result = await s.locate.eraseAccount({ key: "bob" })
  assert.equal(result.removed, 1)
  assert.ok(result.changed >= 1)
  assert.equal(await s.store.get("bob"), null)
  const alice = await s.store.get("alice")
  assert.equal(alice.shares.length, 0) // her share with Bob
  assert.equal(alice.watches.length, 0) // her alert about Bob
  assert.deepEqual(alice.asks.map((a) => a.from), ["carol"])
  assert.equal(s.sent("alice", "loc:gone").at(-1).payload.reason, "deleted")
  // erasing again is fine
  assert.deepEqual(await s.locate.eraseAccount({ key: "bob" }), { removed: 0, changed: 0 })
})
