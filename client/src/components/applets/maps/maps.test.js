// Maps 98's pure parts. Run: node --test client/src/components/applets/maps/maps.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as M from "./mapsCore.js"

// a Valhalla-style polyline6 encoder, to check the decoder against
const encode = (pts, precision = 6) => {
  const f = 10 ** precision
  let out = ""
  let pl = 0
  let pn = 0
  const enc = (v) => {
    let x = v < 0 ? ~(v << 1) : v << 1
    let s = ""
    while (x >= 0x20) {
      s += String.fromCharCode((0x20 | (x & 0x1f)) + 63)
      x >>= 5
    }
    return s + String.fromCharCode(x + 63)
  }
  for (const [lon, lat] of pts) {
    const la = Math.round(lat * f)
    const lo = Math.round(lon * f)
    out += enc(la - pl) + enc(lo - pn)
    pl = la
    pn = lo
  }
  return out
}

test("polyline6: Valhalla's route shape decodes to [lon, lat] points", () => {
  const pts = [
    [-117.8265, 33.6846],
    [-117.83, 33.68],
    [-117.9298, 33.6189],
  ]
  const back = M.decodePolyline(encode(pts))
  assert.equal(back.length, 3)
  back.forEach((p, i) => {
    assert.ok(Math.abs(p[0] - pts[i][0]) < 1e-6)
    assert.ok(Math.abs(p[1] - pts[i][1]) < 1e-6)
  })
  assert.deepEqual(M.decodePolyline(""), [])
})

test("a route from Valhalla's answer: totals, steps at their points, units", () => {
  const line = [
    [-117.8, 33.7],
    [-117.81, 33.7],
    [-117.81, 33.69],
  ]
  const json = {
    trip: {
      units: "miles",
      summary: { length: 1.4, time: 300 },
      legs: [
        {
          shape: encode(line),
          maneuvers: [
            { type: 1, instruction: "Drive west on Main Street.", length: 0.6, time: 120, begin_shape_index: 0 },
            { type: 15, instruction: "Turn left onto Oak Avenue.", length: 0.8, time: 180, begin_shape_index: 1 },
            { type: 4, instruction: "You have arrived at your destination.", length: 0, time: 0, begin_shape_index: 2 },
          ],
        },
      ],
    },
  }
  const r = M.shapeRoute(json)
  assert.equal(r.units, "mi")
  assert.equal(r.steps.length, 3)
  assert.equal(r.steps[1].text, "Turn left onto Oak Avenue.")
  assert.ok(Math.abs(r.steps[1].at[0] - -117.81) < 1e-6)
  assert.equal(M.durationText(r.time), "5 min")
  assert.equal(M.durationText(5400), "1 hr 30 min")
  assert.equal(M.distanceText(1.4, "mi"), "1.4 mi")
  assert.equal(M.distanceText(0.05, "mi"), "260 ft")
  assert.equal(M.distanceText(0.4, "km"), "400 m")
  assert.equal(M.shapeRoute({}), null)
  // following along: near the second point, the next step is the left turn's successor
  const p = M.progressOn(r, { lat: 33.7, lon: -117.8099 })
  assert.equal(p.index, 1)
  assert.equal(p.step, 2)
  assert.ok(p.off < 20)
})

test("the request: the right costing per mode, and the units", () => {
  const body = M.routeRequest({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, "bike", { metric: true })
  assert.equal(body.costing, "bicycle")
  assert.equal(body.units, "kilometers")
  assert.equal(M.routeRequest({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, "walk").costing, "pedestrian")
  assert.equal(M.routeRequest({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, "nonsense").costing, "auto")
  assert.match(M.routeUrl({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, "drive"), /^https:\/\/valhalla1\.openstreetmap\.de\/route\?json=/)
})

test("places from Photon and Nominatim; search near you is rounded to ~10 km", () => {
  const f = { geometry: { coordinates: [-117.98, 33.71] }, properties: { name: "Los Cab Sports Village", street: "Warner Ave", housenumber: "8501", city: "Fountain Valley", state: "California", country: "United States", osm_type: "W", osm_id: 42 } }
  const p = M.placeFromPhoton(f)
  assert.equal(p.name, "Los Cab Sports Village")
  assert.equal(p.detail, "8501 Warner Ave, Fountain Valley, California, United States")
  assert.equal(p.id, "W42")
  assert.equal(M.placeFromPhoton({ geometry: {} }), null)
  const url = M.photonSearchUrl("tacos", { near: { lat: 33.71234, lon: -117.98765 } })
  assert.match(url, /lat=33\.7&lon=-118\.0/)
  const n = M.placeFromNominatim({ lat: "33.6", lon: "-117.9", display_name: "Irvine Spectrum, Irvine, California, USA", name: "Irvine Spectrum", osm_type: "way", osm_id: 7 })
  assert.equal(n.name, "Irvine Spectrum")
  assert.equal(n.lat, 33.6)
})

test("openMaps' destination is checked; Apple and Google Maps links", () => {
  assert.equal(M.cleanDest({ lat: 91, lon: 0 }), null)
  assert.equal(M.cleanDest({ lat: "x", lon: 0 }), null)
  const d = M.cleanDest({ name: "Court 3", lat: 33.5, lon: -117.5, address: "1 Main" })
  assert.equal(d.name, "Court 3")
  assert.equal(d.detail, "1 Main")
  assert.equal(M.appleMapsUrl(d, { mode: "walk" }), "https://maps.apple.com/?daddr=33.5%2C-117.5&dirflg=w&q=Court+3")
  assert.ok(!M.appleMapsUrl(d, { mode: "bike" }).includes("dirflg"))
  assert.match(M.googleMapsUrl(d, { mode: "bike", from: { lat: 1, lon: 2 } }), /travelmode=bicycling&origin=1%2C2/)
})

test("the cache keeps the newest answers; recent places don't repeat", () => {
  const c = M.createCache(2)
  c.set("a", 1)
  c.set("b", 2)
  c.get("a")
  c.set("c", 3)
  assert.equal(c.get("b"), undefined)
  assert.equal(c.get("a"), 1)
  const a = { id: "1", lat: 1, lon: 1 }
  const list = M.addRecent(M.addRecent([], a), { id: "2", lat: 2, lon: 2 })
  assert.deepEqual(M.addRecent(list, { ...a }).map((p) => p.id), ["1", "2"])
  assert.equal(M.addRecent(Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, lat: i, lon: i })), a).length, 12)
})
