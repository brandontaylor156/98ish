// Venue Finder on the device: building a venue when the chat server can't (the public Overpass
// servers turn its shared address away): our /api/osm first, then the browser-friendly mirror.
//   node --test client/src/components/applets/pickleball/park/live/liveVenue.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { buildOnDevice, OVERPASS } from "./liveVenue.js"
import { compactElements } from "./osmspec.js"

const M = 111320
// an Overpass answer: `n` pickleball courts in a row at (lat, lon)
const answer = (lat, lon, n = 3) => {
  const k = Math.cos((lat * Math.PI) / 180)
  const elements = []
  for (let i = 0; i < n; i++) {
    const x = i * 8.5
    const ring = [[-3.05, -6.7], [3.05, -6.7], [3.05, 6.7], [-3.05, 6.7], [-3.05, -6.7]].map(([dx, dz]) => ({ lat: lat - dz / M, lon: lon + (x + dx) / (M * k) }))
    elements.push({ type: "way", id: 100 + i, tags: { leisure: "pitch", sport: "pickleball" }, geometry: ring })
  }
  return { osm3s: { timestamp_osm_base: "2026-10-01T00:00:00Z" }, elements }
}
const rows = [{ id: "ow1", shard: "9q", lat: 34.43, lon: -118.53, r: 120, courts: 3, onTennis: 0, flags: 2, name: "Test Park", town: "Santa Clarita" }]
const json = (body, status = 200) => ({ ok: status === 200, status, json: async () => body })

test("built from our /api/osm when it answers", async () => {
  const asked = []
  const fetchImpl = async (url) => {
    asked.push(url)
    const a = answer(34.43, -118.53)
    return json({ osm_base: a.osm3s.timestamp_osm_base, elements: compactElements(a.elements) })
  }
  const { spec, info } = await buildOnDevice("ow1", "9q", { rows, fetchImpl })
  assert.equal(asked.length, 1)
  assert.match(asked[0], /^\/api\/osm\?lat=34\.43000&lon=-118\.53000&r=120$/)
  assert.equal(spec.id, "ow1")
  assert.equal(spec.name, "Test Park")
  assert.equal(spec.courts.length, 3)
  assert.ok(info.courts >= 1 && info.bounds.x1 > info.bounds.x0 && info.bounds.z1 > info.bounds.z0)
})

test("our function busy: the browser-friendly mirror; everything busy: a clear error", async () => {
  const asked = []
  const mirror = async (url, init) => {
    asked.push(url)
    if (url.startsWith("/api/osm")) return json({ error: "busy" }, 503)
    assert.equal(init.method, "POST")
    assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded")
    return json(answer(34.43, -118.53, 2))
  }
  const { spec } = await buildOnDevice("ow1", "9q", { rows, fetchImpl: mirror })
  assert.deepEqual(asked, ["/api/osm?lat=34.43000&lon=-118.53000&r=120", ...OVERPASS])
  assert.equal(spec.courts.length, 2)

  await assert.rejects(buildOnDevice("ow1", "9q", { rows, fetchImpl: async () => json({}, 503) }), /map servers are busy/)
  await assert.rejects(buildOnDevice("nope", "9q", { rows, fetchImpl: async () => json({}) }), /isn't in the index/)
})
