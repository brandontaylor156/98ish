import test from "node:test"
import assert from "node:assert/strict"
import * as core from "./locateCore.js"

const T = Date.parse("2026-10-05T15:00:00")

test("shares: active until their end time; indefinitely with none", () => {
  assert.equal(core.shareActive({ to: "bob", until: null }, T), true)
  assert.equal(core.shareActive({ to: "bob", until: T + 1 }, T), true)
  assert.equal(core.shareActive({ to: "bob", until: T }, T), false)
  assert.equal(core.shareActive(null, T), false)
  assert.equal(core.untilFor("hour", T), T + 3600_000)
  const today = core.untilFor("today", T)
  assert.equal(new Date(today).getDate(), new Date(T).getDate())
  assert.equal(new Date(today).getHours(), 23)
  assert.equal(core.untilFor("forever", T), null)
  assert.deepEqual(core.cleanUntil(null, T), { ok: true, until: null })
  assert.equal(core.cleanUntil(T - 1, T).ok, false)
  assert.equal(core.cleanUntil(T + 400 * 86400_000, T).ok, false)
  assert.equal(core.cleanUntil(String(T + 5000), T).until, T + 5000)
  assert.equal(core.untilText(null, T), "Indefinitely")
  assert.match(core.untilText(T + 3600_000, T), /^Until \d+:\d\d (AM|PM)$/)
  assert.match(core.untilText(T + 86400_000, T), /^Until tomorrow /)
  assert.equal(core.untilText(T - 1, T), "Ended")
})

test("positions: cleaned, and approximate location snaps to a ~1 km grid", () => {
  assert.equal(core.cleanPos({ lat: 91, lon: 0 }).ok, false)
  assert.equal(core.cleanPos({ lat: "x", lon: 0 }).ok, false)
  assert.deepEqual(core.cleanPos({ lat: "33.7", lon: -117.9 }).pos, { lat: 33.7, lon: -117.9, acc: 50 })
  assert.equal(core.cleanPos({ lat: 1, lon: 1, acc: 1e9 }).pos.acc, 100_000)
  const a = core.coarsen({ lat: 33.71437, lon: -117.92391, acc: 5 })
  assert.equal(a.coarse, true)
  assert.equal(a.acc, 1000)
  assert.ok(core.distanceM(a, { lat: 33.71437, lon: -117.92391 }) < 900)
  // nearby spots land on the same cell, so small moves reveal nothing
  const b = core.coarsen({ lat: 33.71402, lon: -117.92288, acc: 5 })
  assert.deepEqual([a.lat, a.lon], [b.lat, b.lon])
  // cells stay about square away from the equator
  const north = core.coarsen({ lat: 64.1, lon: -21.9, acc: 5 })
  assert.ok(Math.abs(north.lon - -21.9) < 0.02)
  // already vaguer than 1 km stays as vague
  assert.equal(core.coarsen({ lat: 0, lon: 0, acc: 5000 }).acc, 5000)
})

test("distance", () => {
  const d = core.distanceM({ lat: 33.714, lon: -117.924 }, { lat: 33.715, lon: -117.924 })
  assert.ok(Math.abs(d - 111.2) < 1, String(d))
  assert.equal(core.distanceText(20), "66 ft away")
  assert.equal(core.distanceText(5000), "3.1 mi away")
  assert.equal(core.distanceText(50_000), "31 mi away")
})

test("throttle: at most every 30 s and after 50 m, or every 2 minutes regardless", () => {
  const here = { lat: 33.714, lon: -117.924 }
  const near = { lat: 33.7142, lon: -117.924 } // ~22 m
  const far = { lat: 33.7146, lon: -117.924 } // ~67 m
  assert.equal(core.shouldSend(null, here, T), true)
  const last = { ...here, at: T }
  assert.equal(core.shouldSend(last, far, T + 10_000), false) // too soon
  assert.equal(core.shouldSend(last, near, T + 40_000), false) // hasn't moved enough
  assert.equal(core.shouldSend(last, far, T + 40_000), true)
  assert.equal(core.shouldSend(last, here, T + 120_000), true) // keep "2 min ago" fresh
})

test("places: cleaned with a sensible radius", () => {
  assert.equal(core.cleanPlace({ name: " ", lat: 1, lon: 1 }).ok, false)
  assert.equal(core.cleanPlace({ name: "Moon", lat: 100, lon: 1 }).ok, false)
  const p = core.cleanPlace({ name: "  Los Cab  ", lat: 33.714, lon: -117.924, r: 5 }).place
  assert.deepEqual(p, { id: null, name: "Los Cab", lat: 33.714, lon: -117.924, r: 50 })
  assert.equal(core.cleanPlace({ name: "x", lat: 0, lon: 0, r: 1e6 }).place.r, 2000)
  assert.equal(core.cleanPlace({ name: "x", lat: 0, lon: 0 }).place.r, 150)
  assert.equal(core.cleanPlace({ name: "x".repeat(80), lat: 0, lon: 0, id: "abc123" }).place.name.length, 40)
  assert.equal(core.cleanPlace({ name: "x", lat: 0, lon: 0, id: "../evil" }).place.id, null)
})

test("arriving and leaving: hysteresis, unknown start, vague positions ignored", () => {
  const place = { lat: 33.714, lon: -117.924, r: 150 }
  const at = (dLat, acc = 10) => ({ lat: place.lat + dLat, lon: place.lon, acc })
  // the first position only sets the state
  assert.deepEqual(core.fenceStep(null, at(0), place), { inside: true, event: null })
  assert.deepEqual(core.fenceStep(null, at(0.01), place), { inside: false, event: null })
  // arrive at <= r
  assert.deepEqual(core.fenceStep(false, at(0.0013), place), { inside: true, event: "arrive" }) // ~145 m
  assert.deepEqual(core.fenceStep(false, at(0.0015), place), { inside: false, event: null }) // ~167 m
  // leave only past r + margin (150 + 37.5)
  assert.deepEqual(core.fenceStep(true, at(0.0016), place), { inside: true, event: null }) // ~178 m
  assert.deepEqual(core.fenceStep(true, at(0.0018), place), { inside: false, event: "leave" }) // ~200 m
  // a vague fix decides nothing
  assert.deepEqual(core.fenceStep(true, at(0.05, 900), place), { inside: true, event: null })
  assert.deepEqual(core.fenceStep(false, null, place), { inside: false, event: null })
  assert.equal(core.watchWants("both", "leave"), true)
  assert.equal(core.watchWants("arrive", "leave"), false)
  assert.equal(core.watchWants("arrive", null), false)
})

test("words and links", () => {
  assert.equal(core.agoText(null, T), "No location yet")
  assert.equal(core.agoText(T - 20_000, T), "Just now")
  assert.equal(core.agoText(T - 120_000, T), "2 min ago")
  assert.equal(core.agoText(T - 3 * 3600_000, T), "3 hr ago")
  assert.equal(core.agoText(T - 30 * 3600_000, T), "Yesterday")
  assert.equal(core.agoText(T - 5 * 86400_000, T), "5 days ago")
  assert.equal(core.directionsUrl({ lat: 1.5, lon: -2 }, true), "https://maps.apple.com/?daddr=1.5,-2")
  assert.equal(core.directionsUrl({ lat: 1.5, lon: -2 }), "https://www.google.com/maps/dir/?api=1&destination=1.5,-2")
})
