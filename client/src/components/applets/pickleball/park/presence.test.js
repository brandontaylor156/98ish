import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { AREA_R, LEAVE_MARGIN, M, MAX_ACC, areaOf, badgeText, friendsAt, presenceStep, samePresence, spotFor, toLocal, venueRecord } from "./presence.js"

// Los Cab as the server sees it: its spec (origin, courts) and the walkable bounds
const spec = JSON.parse(fs.readFileSync(new URL("./venues/loscab.json", import.meta.url), "utf8"))
const bounds = JSON.parse(fs.readFileSync(new URL("../../../../../../server/park/venues.json", import.meta.url), "utf8")).loscab.bounds
const LOSCAB = venueRecord(spec, bounds)
const VENUES = [LOSCAB]

// a lat/lon at venue metres (x east, z south): the projection's inverse
const at = (v, x, z, acc = 10) => {
  const [lat0, lon0] = v.origin
  const k = Math.cos((lat0 * Math.PI) / 180)
  return { lat: lat0 - z / M, lon: lon0 + x / (M * k), acc }
}

test("toLocal is the venue builder's projection (round trip within a centimetre)", () => {
  const p = at(LOSCAB, -169.5, -33)
  const back = toLocal(LOSCAB.origin, p.lat, p.lon)
  assert.ok(Math.abs(back.x + 169.5) < 0.01 && Math.abs(back.z + 33) < 0.01)
})

test("membership: inside the bounds you're at the venue; the court you're on is your area", () => {
  const c = LOSCAB.courts[0]
  const r = presenceStep(VENUES, null, at(LOSCAB, c.x + 1, c.z - 1))
  assert.deepEqual(r, { id: "loscab", area: "c0" })
  // in the lot, far from any court: "site"
  const lot = presenceStep(VENUES, null, at(LOSCAB, bounds.x1 - 2, bounds.z1 - 2))
  assert.equal(lot.id, "loscab")
  assert.equal(lot.area, areaOf(LOSCAB, bounds.x1 - 2, bounds.z1 - 2))
  // a few streets away: nowhere
  assert.equal(presenceStep(VENUES, null, at(LOSCAB, bounds.x1 + 300, 0)), null)
})

test("hysteresis: just outside the edge you stay; well past it you've left; arriving needs the real edge", () => {
  const edge = at(LOSCAB, bounds.x1 + LEAVE_MARGIN / 2, 0)
  // arriving from outside: not yet
  assert.equal(presenceStep(VENUES, null, edge), null)
  // already there and drifting just past the gate: still there
  const prev = { id: "loscab", area: "site" }
  assert.equal(presenceStep(VENUES, prev, edge)?.id, "loscab")
  // well past the margin: gone
  assert.equal(presenceStep(VENUES, prev, at(LOSCAB, bounds.x1 + LEAVE_MARGIN + 20, 0)), null)
})

test("a vague fix decides nothing", () => {
  const c = LOSCAB.courts[3]
  const vagueIn = at(LOSCAB, c.x, c.z, MAX_ACC + 50)
  assert.equal(presenceStep(VENUES, null, vagueIn), null)
  const prev = { id: "loscab", area: "c3" }
  assert.deepEqual(presenceStep(VENUES, prev, at(LOSCAB, bounds.x1 + 900, 0, MAX_ACC + 50)), prev)
})

test("approximate location is never placed: at most 'nearby'", () => {
  const c = LOSCAB.courts[0]
  const near = { ...at(LOSCAB, c.x, c.z, 1000), coarse: true }
  assert.deepEqual(presenceStep(VENUES, null, near), { id: "loscab", nearby: true })
  const far = { ...at(LOSCAB, 5000, 0, 1000), coarse: true }
  assert.equal(presenceStep(VENUES, null, far), null)
})

test("court-area snapping: the nearest court within AREA_R, never a finer spot", () => {
  const c = LOSCAB.courts[5]
  assert.equal(areaOf(LOSCAB, c.x + 2, c.z + 2), "c5")
  // two people on the same court get the same area: the area hides where on it they are
  assert.equal(areaOf(LOSCAB, c.x - 2, c.z - 1), areaOf(LOSCAB, c.x + 2, c.z + 1))
  const lonely = { ...LOSCAB, courts: [{ x: 0, z: 0, a: 0 }] }
  assert.equal(areaOf(lonely, AREA_R + 5, 0), "site")
})

test("spotFor stands friends beside their court, a step apart; 'site' is the entrance (null)", () => {
  const courts = [{ x: 10, z: 20, a: 0, s: "p" }]
  const a = spotFor(courts, "c0", 0)
  const b = spotFor(courts, "c0", 1)
  // beside the court: off its long axis (a = 0: along x) by about half a court plus a step
  assert.ok(Math.abs(a.z - 20) > 4 && Math.abs(a.z - 20) < 7)
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 1)
  assert.equal(spotFor(courts, "site"), null)
  assert.equal(spotFor(courts, "c9"), null)
})

test("friendsAt / badgeText: who's here, who's nearby, paused people never count", () => {
  const friends = [
    { key: "a", name: "A", pos: {}, venue: { id: "loscab", area: "c1" } },
    { key: "b", name: "B", pos: {}, venue: { id: "loscab", area: "site" } },
    { key: "c", name: "C", pos: {}, venue: { id: "loscab", nearby: true } },
    { key: "d", name: "D", pos: null, paused: true, venue: { id: "loscab", area: "c1" } },
    { key: "e", name: "E", pos: {}, venue: { id: "smash", area: "c0" } },
  ]
  const r = friendsAt(friends, "loscab")
  assert.deepEqual(r.here.map((f) => f.key), ["a", "b"])
  assert.deepEqual(r.nearby.map((f) => f.key), ["c"])
  assert.equal(badgeText(r), "2 friends here now")
  assert.equal(badgeText({ here: [], nearby: r.nearby }), "1 friend nearby")
  assert.equal(badgeText(friendsAt(friends, "paseo")), "")
  assert.ok(samePresence({ id: "x", area: "c1" }, { id: "x", area: "c1" }))
  assert.ok(!samePresence({ id: "x", area: "c1" }, { id: "x", area: "c2" }))
})
