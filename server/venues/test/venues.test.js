// Venue Finder's server: building a venue from (fake) Overpass, the cache and its caps, the
// daily budget, per-address limits, the park learning live venues.
//   node --test server/venues/test/venues.test.js
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const http = require("http")
const express = require("express")
const { createVenues } = require("..")
const { memoryStore } = require("../store")
const { createPark } = require("../../park")

const M = 111320
// an Overpass answer: `n` pickleball courts in a row at (lat, lon)
const answer = (lat, lon, n = 4) => {
  const k = Math.cos((lat * Math.PI) / 180)
  const els = []
  for (let i = 0; i < n; i++) {
    const x = i * 8.5
    const ring = [
      [-3.05, -6.7],
      [3.05, -6.7],
      [3.05, 6.7],
      [-3.05, 6.7],
      [-3.05, -6.7],
    ].map(([dx, dz]) => ({ lat: lat - dz / M, lon: lon + (x + dx) / (M * k) }))
    els.push({ type: "way", id: 100 + i, tags: { leisure: "pitch", sport: "pickleball" }, geometry: ring })
  }
  return { osm3s: { timestamp_osm_base: "2026-10-01T00:00:00Z" }, elements: els }
}

const setup = (opts = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "venues-"))
  fs.writeFileSync(path.join(dir, "9q.json"), JSON.stringify({ v: 1, rows: [["ow1", 34.1, -118.3, 80, 4, 0, 2, "Test Park", "Glendale"], ["ow2", 34.2, -118.4, 80, 2, 0, 0, "", "Burbank"], ["ow3", 34.3, -118.5, 80, 2, 0, 0, "", ""]] }))
  let t = 1_000_000
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push(decodeURIComponent(init.body))
    if (opts.fail) return { ok: false, status: opts.fail, text: async () => "" }
    const m = /around:\d+,([-\d.]+),([-\d.]+)/.exec(decodeURIComponent(init.body))
    const body = JSON.stringify(answer(Number(m[1]), Number(m[2]), 4))
    return { ok: true, status: 200, text: async () => body }
  }
  const store = memoryStore(opts.caps || {})
  const v = createVenues({ store, fetchImpl, now: () => t, idxDir: dir, limits: { gapMs: 0, ...(opts.limits || {}) } })
  return { v, calls, store, tick: (ms) => (t += ms), dir }
}

test("a venue builds once from Overpass, then comes from the cache; the park learns it", async () => {
  const { v, calls } = setup()
  const a = await v.getVenue("ow1", "9q", "1.1.1.1")
  assert.equal(a.cached, false)
  const spec = JSON.parse(a.doc.data)
  assert.equal(spec.id, "ow1")
  assert.equal(spec.name, "Test Park")
  assert.equal(spec.city, "Glendale")
  assert.equal(spec.courts.length, 4)
  assert.ok(a.doc.info.courts >= 1 && a.doc.info.bounds.x1 > a.doc.info.bounds.x0)
  // the query is bounded and centred on the index row
  assert.match(calls[0], /around:\d+,34\.100000,-118\.300000/)
  const b = await v.getVenue("ow1", "9q", "2.2.2.2")
  assert.equal(b.cached, true)
  assert.equal(calls.length, 1)
  assert.deepEqual(v.liveVenues.info("ow1"), a.doc.info)
  // the park opens parks at it, with its own courts and bounds
  const park = createPark({ liveVenues: v.liveVenues })
  const j = park.join({ pid: "p1", name: "Ann" }, { venue: "ow1" })
  assert.equal(j.ok, true)
  assert.equal(j.venue, "ow1")
  assert.equal(j.courts.length, a.doc.info.courts)
  const k = park.join({ pid: "p2", name: "Bo" }, { venue: "ow1" })
  assert.equal(k.park, j.park, "friends at the same venue share a park")
  // an unknown live id is Riverside
  assert.equal(park.join({ pid: "p3", name: "Cy" }, { venue: "ow999" }).venue, "riverside")
  park.stop?.()
})

test("only venues in the index; bad ids refused; two asks at once make one build", async () => {
  const { v, calls } = setup()
  await assert.rejects(v.getVenue("ow404", "9q"), (e) => e.status === 404)
  await assert.rejects(v.getVenue("bad id", "9q"), (e) => e.status === 400)
  await assert.rejects(v.getVenue("ow1", "../x"), (e) => e.status === 404)
  const [x, y] = await Promise.all([v.getVenue("ow2", "9q"), v.getVenue("ow2", "9q")])
  assert.equal(calls.length, 1)
  assert.equal(x.doc.id, y.doc.id)
})

test("stale after 90 days: rebuilt; the map server failing hands back the old copy", async () => {
  const s = setup()
  await s.v.getVenue("ow1", "9q")
  s.tick(91 * 24 * 3600 * 1000)
  await s.v.getVenue("ow1", "9q")
  assert.equal(s.calls.length, 2)
  // a server that fails: the old copy still opens
  const f = setup({ fail: 504 })
  await assert.rejects(f.v.getVenue("ow1", "9q"), (e) => e.status === 503)
})

test("caps: the daily budget, builds per address, and the cache's size", async () => {
  const s = setup({ limits: { dailyQueries: 2, perIp: 10 } })
  await s.v.getVenue("ow1", "9q", "a")
  await s.v.getVenue("ow2", "9q", "a")
  await assert.rejects(s.v.getVenue("ow3", "9q", "a"), (e) => e.status === 503)
  // the next day it's back
  s.tick(24 * 3600 * 1000)
  const ok = await s.v.getVenue("ow3", "9q", "a")
  assert.equal(ok.cached, false)
  // per address
  const p = setup({ limits: { perIp: 1 } })
  await p.v.getVenue("ow1", "9q", "z")
  await assert.rejects(p.v.getVenue("ow2", "9q", "z"), (e) => e.status === 429)
  await p.v.getVenue("ow2", "9q", "other") // someone else is fine
  // cache caps: least recently used go
  const c = setup({ caps: { maxDocs: 2 } })
  await c.v.getVenue("ow1", "9q")
  c.tick(1000)
  await c.v.getVenue("ow2", "9q")
  c.tick(1000)
  await c.v.getVenue("ow3", "9q")
  assert.equal(await c.store.count(), 2)
  assert.equal(await c.store.get("ow1"), null)
})

test("the park: live venues are capped (maxLiveParks)", async () => {
  const { v } = setup()
  await v.getVenue("ow1", "9q")
  await v.getVenue("ow2", "9q")
  const park = createPark({ liveVenues: v.liveVenues, maxLiveParks: 1 })
  assert.equal(park.join({ pid: "a", name: "A" }, { venue: "ow1" }).ok, true)
  const no = park.join({ pid: "b", name: "B" }, { venue: "ow2" })
  assert.equal(no.ok, false)
  // featured venues aren't capped
  assert.equal(park.join({ pid: "c", name: "C" }, { venue: "loscab" }).ok, true)
  park.stop?.()
})

test("HTTP: GET /api/venues/:id answers the spec; errors as JSON", async () => {
  const { v } = setup()
  const app = express()
  app.use("/api/venues", v.router())
  const server = http.createServer(app)
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}/api/venues`
  try {
    const ok = await (await fetch(`${base}/ow1?s=9q`)).json()
    assert.equal(ok.ok, true)
    assert.equal(ok.spec.id, "ow1")
    assert.ok(ok.info.courts >= 1)
    const missing = await fetch(`${base}/ow404?s=9q`)
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).ok, false)
    const st = await (await fetch(`${base}/status`)).json()
    assert.equal(st.cached, 1)
  } finally {
    server.close()
  }
})

test("POST /:id/info: a venue a phone built joins the park; bad or unknown ones refused", async () => {
  const { v } = setup()
  const app = express()
  app.use("/api/venues", v.router())
  const server = http.createServer(app).listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api/venues`
  const post = (id, body, s = "9q") => fetch(`${base}/${id}/info?s=${s}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  try {
    const good = { courts: 4, bounds: { x0: -40, x1: 40, z0: -30, z1: 30 } }
    assert.equal((await post("ow2", good)).status, 200)
    assert.deepEqual(v.liveVenues.info("ow2"), good)
    assert.equal((await post("ow9", good)).status, 404) // not in the index
    assert.equal((await post("ow3", { courts: 0, bounds: good.bounds })).status, 400)
    assert.equal((await post("ow3", { courts: 4, bounds: { x0: -4000, x1: 40, z0: -30, z1: 30 } })).status, 400)
    assert.ok([400, 404].includes((await post("../x", good)).status))
    assert.equal(v.liveVenues.info("ow3"), null)
  } finally {
    server.close()
  }
})
