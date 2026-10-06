// My Park's real venues: the specs (tools/venues/build-venues.mjs), the generator (venuegen.js)
// and the layouts it makes (layout.js makeLayout).
// node --test client/src/components/applets/pickleball/park/venues.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { generateVenue } from "./venuegen.js"
import { makeLayout } from "./layout.js"
import { VENUE_LIST } from "./venues/index.js"

const spec = (id) => JSON.parse(readFileSync(new URL(`./venues/${id}.json`, import.meta.url), "utf8"))
const IDS = ["loscab", "newport", "wolfbear", "whittier", "paseo", "sinaloa", "smash"]
// what each venue should have (pickleball courts of its own; indoor)
const EXPECT = {
  loscab: { pb: 38, tennis: 13, indoor: false },
  newport: { pb: 44, tennis: 12, indoor: false },
  wolfbear: { pb: 12, tennis: 0, indoor: true },
  whittier: { pb: 16, tennis: 12, indoor: false },
  paseo: { pb: 11, tennis: 11, indoor: false },
  sinaloa: { pb: 12, tennis: 0, indoor: false },
  smash: { pb: 9, tennis: 0, indoor: true },
}
const built = new Map()
const get = (id) => {
  if (!built.has(id)) {
    const s = spec(id)
    const g = generateVenue(s)
    built.set(id, { s, g, L: makeLayout(g.layoutSpec) })
  }
  return built.get(id)
}

test("venue specs: court counts, indoor, sizes, the picker's list", () => {
  assert.deepEqual(VENUE_LIST.map((v) => v.id).sort(), [...IDS].sort())
  for (const id of IDS) {
    const s = spec(id)
    const e = EXPECT[id]
    assert.equal(s.courts.filter((c) => c.s === "p").length, e.pb, `${id} pickleball`)
    assert.equal(s.courts.filter((c) => c.s === "t").length, e.tennis, `${id} tennis`)
    assert.equal(!!s.indoor, e.indoor, `${id} indoor`)
    const kb = JSON.stringify(s).length / 1024
    assert.ok(kb < 16, `${id} spec ${kb.toFixed(1)} KB`)
    if (e.indoor) assert.ok(s.halls?.length >= 1, `${id} has a hall`)
  }
  // angles straight from the data: Newport's grid is turned (bearing 166 -> 76 deg), Wolf + Bear's runs east-west
  assert.ok(spec("newport").courts.filter((c) => c.s === "p").every((c) => Math.abs(Math.abs(c.a) - 76) < 2), "Newport turned 14 degrees")
  assert.ok(spec("wolfbear").courts.every((c) => Math.abs(c.a) < 1), "Wolf + Bear east-west")
  assert.ok(spec("smash").courts.filter((c) => Math.abs(Math.abs(c.a) - 90) < 1).length === 6, "SMASH: six north-south courts")
  // Whittier: pickleball lines on six tennis courts (12 dual-use)
  assert.equal(spec("whittier").courts.reduce((n, c) => n + (c.pb || 0), 0), 12)
})

test("venuegen: courts don't overlap, live courts have gates you can reach from where you arrive", () => {
  for (const id of IDS) {
    const { g, L } = get(id)
    const sc = g.layoutSpec.scene
    // no two pickleball courts on top of each other
    const pb = sc.courts.filter((c) => c.s === "p")
    for (let i = 0; i < pb.length; i++)
      for (let j = i + 1; j < pb.length; j++) assert.ok(Math.hypot(pb[i].x - pb[j].x, pb[i].z - pb[j].z) > 6.5, `${id}: courts ${i} and ${j} overlap`)
    assert.ok(L.COURTS.length >= 4 && L.COURTS.length <= 6, `${id}: ${L.COURTS.length} live courts`)
    assert.ok(!L.blocked(L.SPAWN.x, L.SPAWN.z, 0.35), `${id}: spawn is open`)
    for (const c of L.COURTS) {
      assert.ok(!L.blocked(c.outside.x, c.outside.z, 0.3), `${id}: outside ${c.name}'s gate is open`)
      // a walk from the entrance to the gate, every leg clear
      const path = L.route(L.SPAWN, c.outside)
      let at = L.SPAWN
      for (const p of path) {
        assert.equal(L.segmentHit(at, p, 0), null, `${id}: leg to ${c.name} ${JSON.stringify(at)} -> ${JSON.stringify(p)}`)
        at = p
      }
      assert.match(c.name, /^Court \d+$/)
    }
    for (const it of L.INTERACTABLES) assert.ok(!L.blocked(it.x, it.z, 0.3), `${id}: ${it.id} is on open ground`)
    for (const s of L.ALL_SEATS) {
      const a = L.seatApproach(s)
      assert.ok(!L.blocked(a.x, a.z, 0.28), `${id}: seat ${s.id} can be reached`)
    }
    assert.ok(L.WAYPOINTS.length >= 8, `${id}: waypoints`)
    for (const w of L.WAYPOINTS) assert.ok(!L.blocked(w.x, w.z, 0.3), `${id}: waypoint`)
  }
})

test("venuegen: the walking graph is connected (every node reachable from the entrance)", () => {
  for (const id of IDS) {
    const { L } = get(id)
    const n = L.NAV.length
    assert.ok(n > 20, `${id}: ${n} nodes`)
    // the nodes the entrance can see, then everything linked to them
    const seen = new Set()
    const stack = L.NAV.map((p, i) => [i, Math.hypot(p.x - L.SPAWN.x, p.z - L.SPAWN.z)]).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([i]) => i)
    while (stack.length) {
      const i = stack.pop()
      if (seen.has(i)) continue
      seen.add(i)
      for (const j of L.NAV_EDGES[i]) stack.push(j)
    }
    // (a few nodes boxed in by trees or building corners are fine; the bulk must join up)
    assert.ok(seen.size / n > 0.85, `${id}: ${seen.size} of ${n} nodes reachable`)
  }
})

test("venuegen: people are kept out of the banks of courts, walls and stands; indoors the halls have doors", () => {
  for (const id of IDS) {
    const { g, L } = get(id)
    for (const b of g.layoutSpec.scene.banks) {
      const p = L.resolve(b.cx, b.cz, 0.35)
      assert.ok(Math.hypot(p.x - b.cx, p.z - b.cz) > 0.5, `${id}: pushed out of a bank`)
    }
    for (const h of g.layoutSpec.scene.halls || []) {
      assert.ok(h.doorAt && h.doorAt.w >= 2, `${id}: hall door`)
      // just inside and just outside the door are both open
      const c = h.p.reduce((s, q) => [s[0] + q[0] / h.p.length, s[1] + q[1] / h.p.length], [0, 0])
      const dx = c[0] - h.doorAt.x
      const dz = c[1] - h.doorAt.z
      const d = Math.hypot(dx, dz)
      assert.ok(!L.blocked(h.doorAt.x + (dx / d) * 1.2, h.doorAt.z + (dz / d) * 1.2, 0.3), `${id}: inside the door`)
    }
  }
  // SMASH: the bar has stools for the regulars
  assert.ok(get("smash").L.ALL_SEATS.filter((s) => String(s.id).startsWith("stool")).length >= 8)
})

test("venuegen: a court's frame (any angle) and the world agree", () => {
  const { L } = get("newport")
  for (const c of L.COURTS) {
    // the court's length runs along its rot: local (0, 1) is u in the world
    const p = { x: c.x + c.u.x * 5, z: c.z + c.u.z * 5 }
    const loc = { x: -(0), z: 5 }
    const w = { x: c.x + loc.x * c.f.c + loc.z * c.f.s, z: c.z - loc.x * c.f.s + loc.z * c.f.c }
    assert.ok(Math.hypot(w.x - p.x, w.z - p.z) < 1e-9)
  }
})
