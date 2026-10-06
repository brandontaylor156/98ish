// My Park's real venues: the specs (tools/venues/build-venues.mjs), the generator (venuegen.js)
// and the layouts it makes (layout.js makeLayout).
// node --test client/src/components/applets/pickleball/park/venues.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { venueLayoutSpec } from "./venuegen.js"
import { makeLayout, setLayout } from "./layout.js"
import { createFollow, followTarget, stepFollow } from "./followcam.js"
import { VENUE_LIST } from "./venues/index.js"

const spec = (id) => JSON.parse(readFileSync(new URL(`./venues/${id}.json`, import.meta.url), "utf8"))
const IDS = ["loscab", "newport", "wolfbear", "whittier", "paseo", "sinaloa", "smash"]
// what each venue should have (pickleball courts of its own; indoor)
const EXPECT = {
  loscab: { pb: 38, tennis: 13, indoor: false },
  newport: { pb: 44, tennis: 12, indoor: false },
  // (14: the main hall's cards run 5 to 14; courts 1-2 in the second hall, 3 streamed, 4 private)
  wolfbear: { pb: 14, tennis: 0, indoor: true },
  whittier: { pb: 16, tennis: 12, indoor: false },
  paseo: { pb: 11, tennis: 11, indoor: false },
  sinaloa: { pb: 12, tennis: 0, indoor: false },
  smash: { pb: 9, tennis: 0, indoor: true },
}
const built = new Map()
const get = (id) => {
  if (!built.has(id)) {
    const s = spec(id)
    // (as the browser does it: the saved exclusions, no check)
    const g = { layoutSpec: venueLayoutSpec(s) }
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
    // (lazy-loaded, gzip about a quarter: the fidelity data, trees and rooms, makes it bigger)
    assert.ok(kb < 48, `${id} spec ${kb.toFixed(1)} KB`)
    if (e.indoor) assert.ok(s.halls?.length >= 1, `${id} has a hall`)
  }
  // angles straight from the data: Newport's grid is turned (bearing 166 -> 76 deg), Wolf + Bear's runs east-west
  assert.ok(spec("newport").courts.filter((c) => c.s === "p").every((c) => Math.abs(Math.abs(c.a) - 76) < 2), "Newport turned 14 degrees")
  // Wolf + Bear: the main hall's ten (numbered 5-14) run east-west, the second hall's two north-south
  const wb = spec("wolfbear").courts
  assert.equal(wb.filter((c) => c.n >= 5 && Math.abs(c.a) < 1).length, 10, "Wolf + Bear main hall east-west")
  assert.equal(wb.filter((c) => c.n <= 2 && Math.abs(Math.abs(c.a) - 90) < 1).length, 2, "Wolf + Bear second hall north-south")
  assert.deepEqual(wb.map((c) => c.n).sort((a, b) => a - b), Array.from({ length: 14 }, (_, k) => k + 1), "Wolf + Bear numbers 1-14")
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
      // (a sound stage's door to the next hall can be a single door)
      assert.ok(h.doorAt && h.doorAt.w >= 1.0, `${id}: hall door`)
      // just inside the door (straight in from the wall it's on) is open
      const c = h.p.reduce((s, q) => [s[0] + q[0] / h.p.length, s[1] + q[1] / h.p.length], [0, 0])
      const a = h.p[h.doorAt.i]
      const b = h.p[(h.doorAt.i + 1) % h.p.length]
      const el = Math.hypot(b[0] - a[0], b[1] - a[1])
      let nx = -(b[1] - a[1]) / el
      let nz = (b[0] - a[0]) / el
      if (nx * (c[0] - h.doorAt.x) + nz * (c[1] - h.doorAt.z) < 0) [nx, nz] = [-nx, -nz]
      assert.ok(!L.blocked(h.doorAt.x + nx * 1.2, h.doorAt.z + nz * 1.2, 0.3), `${id}: inside the door`)
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

test("venuegen: every number in a venue's layout and scenery is a real number (no NaN)", () => {
  const bad = (o, path, out) => {
    if (typeof o === "number" && !Number.isFinite(o)) out.push(path)
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) bad(v, `${path}.${k}`, out)
    return out
  }
  for (const id of IDS) {
    const { g, L } = get(id)
    const out = bad({ scene: g.layoutSpec.scene, courts: L.COURTS, boxes: L.BOXES, circles: L.CIRCLES, seats: L.ALL_SEATS, nav: L.NAV, lights: L.LIGHTS }, id, [])
    assert.deepEqual(out.slice(0, 5), [], `${id}: not numbers`)
  }
})

test("follow camera at the venues: never behind a wall, a building or a fence, never above a hall roof", () => {
  // segmentHit3 itself: through a wall, over a fence, under a door's lintel
  const { L: W } = get("wolfbear")
  const wall = W.BOXES.find((b) => b.kind === "wall" && b.hx > 3)
  const n = { x: -wall.uz, z: wall.ux } // across the wall
  const at = (k, y) => ({ x: wall.cx + n.x * k, y, z: wall.cz + n.z * k })
  assert.ok(W.segmentHit3(at(-2, 1.5), at(2, 3)), "through a hall wall")
  assert.equal(W.segmentHit3(at(-2, wall.h + 1), at(2, wall.h + 1)), null, "over its top")
  const lintel = W.BOXES.find((b) => b.kind === "lintel")
  const ln = { x: -lintel.uz, z: lintel.ux }
  const lat = (k, y) => ({ x: lintel.cx + ln.x * k, y, z: lintel.cz + ln.z * k })
  assert.equal(W.segmentHit3(lat(-2, 1.5), lat(2, 2.0)), null, "under a lintel")
  assert.ok(W.segmentHit3(lat(-2, 1.5), lat(2, 4.5)), "into a lintel")
  // every walkable spot x 8 camera yaws at every venue, the indoor ones under their roofs
  for (const id of IDS) {
    const { L } = get(id)
    setLayout(L)
    const halls = L.spec.scene?.halls || []
    const roofY = halls.length ? Math.min(...halls.map((h) => h.h || 9)) - 0.6 : null
    let checked = 0
    for (let i = 0; i < L.NAV.length; i += 3) {
      const p = L.NAV[i]
      for (let a = 0; a < 8; a++) {
        const yaw = (a / 8) * Math.PI * 2
        const st = createFollow(yaw)
        for (let f = 0; f < 6; f++) stepFollow(st, { x: p.x, z: p.z, yaw, speed: 0 }, 1 / 30, { portrait: a % 2 === 0, roofY })
        assert.equal(L.segmentHit3({ x: p.x, y: 1.55, z: p.z }, st.pos), null, `${id}: lens hidden at ${p.x},${p.z} yaw ${yaw.toFixed(2)}`)
        if (roofY != null) assert.ok(st.pos.y <= roofY + 1e-9, `${id}: above the roof`)
        checked++
      }
    }
    assert.ok(checked > 400, `${id}: ${checked}`)
  }
  // a wall right behind you: the lens swings round to the open side instead of into the wall
  setLayout(W)
  const p = W.NAV.map((q) => ({ q, d: Math.abs((q.x - wall.cx) * n.x + (q.z - wall.cz) * n.z), along: Math.abs((q.x - wall.cx) * wall.ux + (q.z - wall.cz) * wall.uz) }))
    .filter((o) => o.along < wall.hx - 4 && o.d > 0.6 && o.d < 1.6)
    .sort((a, b) => a.d - b.d)[0].q
  // (facing straight away from the wall... and straight along it with the wall behind)
  const side = Math.sign((p.x - wall.cx) * n.x + (p.z - wall.cz) * n.z)
  const intoWall = Math.atan2(-n.x * side, -n.z * side) // camera yaw whose "behind" is the wall
  const t = followTarget({ x: p.x, z: p.z }, intoWall + Math.PI, { portrait: true })
  assert.equal(W.segmentHit3({ x: p.x, y: 1.55, z: p.z }, t.cam), null)
  assert.ok(t.open, "found an open spot")
  assert.ok(Math.hypot(t.cam.x - p.x, t.cam.z - p.z) >= 1.3, "not right on top of you")
  setLayout(get("loscab").L)
})

test("floors above the ground: up Newport's stairs to the rooftop terrace bar, its railing, the people below", async () => {
  const { stepWalker, createWalker } = await import("./walker.js")
  const { liftPose } = await import("./lift.js")
  const { UP_BIT, packPos, unpackPos } = await import("./interp.js")
  const { L } = get("newport")
  setLayout(L)
  assert.ok(L.DECKS.length >= 1 && L.STAIRS.length >= 1, "a deck and stairs")
  const s = L.STAIRS[0]
  const deck = L.DECKS.find((d) => Math.abs(d.y - s.y1) < 0.1)
  assert.ok(deck, "the stairs arrive at a deck")
  // the bottom step is on the ground, the top at the deck
  assert.equal(L.heightAt(s.a.x, s.a.z, 0), s.y0)
  assert.ok(Math.abs(L.heightAt(s.b.x, s.b.z, s.y1) - s.y1) < 1e-9)
  // someone on the ground right under the top of the stairs stays on the ground
  assert.equal(L.heightAt(s.b.x - s.ux * 0.5, s.b.z - s.uz * 0.5, 0), 0)
  // walk up: start a step before the bottom, push forward along the stairs (camera behind)
  const w = createWalker(s.a.x - s.ux * 1.2, s.a.z - s.uz * 1.2, Math.atan2(s.ux, s.uz))
  const camYaw = Math.atan2(s.ux, s.uz)
  for (let k = 0; k < 400 && (w.y || 0) < s.y1 - 0.01; k++) stepWalker(w, { x: 0, y: 1 }, camYaw, 1 / 30)
  assert.ok(Math.abs(w.y - s.y1) < 0.01, `climbed to ${w.y}`)
  // and on along the deck: still up there, not falling through
  for (let k = 0; k < 60; k++) stepWalker(w, { x: 0, y: 1 }, camYaw, 1 / 30)
  assert.ok(Math.abs(w.y - deck.y) < 0.01, "on the terrace")
  // walking at the railing for a while: never over the edge (always on the deck)
  for (let k = 0; k < 300; k++) {
    stepWalker(w, { x: 1, y: 0.2 }, camYaw + (k > 150 ? Math.PI : 0), 1 / 30)
    assert.ok(Math.abs(w.y - deck.y) < 0.01, "still on the terrace")
  }
  // a terrace's railing doesn't block the people on the ground below it; the stairs' sides do
  const rail = L.BOXES.find((b) => b.kind === "rail")
  assert.ok(rail && rail.y0 >= deck.y - 1e-9)
  assert.ok(L.blocked(rail.cx, rail.cz, 0.3, deck.y), "the railing up on the terrace")
  assert.ok(!L.BOXES.filter((b) => b.kind === "rail").some((b) => b.y0 < 1.7), "railings are all up on their deck")
  const side = L.BOXES.find((b) => b.kind === "stairs" && b.hz < 0.1)
  assert.ok(L.blocked(side.cx, side.cz, 0.3, 0), "the stairs' side from the ground")
  // the follow camera up there: over the terrace, the lens clear from your head
  const st = createFollow(camYaw)
  for (let f = 0; f < 8; f++) stepFollow(st, { x: w.x, z: w.z, y: w.y, yaw: camYaw, speed: 0 }, 1 / 30, { portrait: true })
  assert.ok(st.pos.y > deck.y + 1, "the camera is up with you")
  assert.equal(L.segmentHit3({ x: w.x, y: w.y + 1.55, z: w.z }, st.pos), null)
  // online: one bit says "up"; the others find the height from where you are
  const p = unpackPos(packPos({ x: w.x, z: w.z, yaw: 0, speed: 0, act: 1 | UP_BIT }))
  assert.ok(p.act & UP_BIT)
  assert.ok(Math.abs(L.levelAt(p.x, p.z) - deck.y) < 0.3)
  // a pose raised onto the terrace: its points up, its directions untouched
  const pose = { pelvis: { x: 1, y: 0.95, z: 2 }, spine: { x: 0, y: 1, z: 0 }, footL: { x: 1, y: 0, z: 2, yaw: 0 }, paddle: { grip: { x: 0, y: 1, z: 0 }, axis: { x: 0, y: 0, z: 1 } } }
  const up = liftPose(pose, 6.5)
  assert.equal(up.pelvis.y, 7.45)
  assert.equal(up.footL.y, 6.5)
  assert.equal(up.paddle.grip.y, 7.5)
  assert.deepEqual(up.spine, pose.spine)
  assert.deepEqual(up.paddle.axis, pose.paddle.axis)
  assert.equal(up.lift, 6.5)
  setLayout(get("loscab").L)
})

test("room kit: every room with a door you can open is reachable on foot from the arrival (Los Cab, SMASH)", () => {
  const inPoly = (x, z, p) => {
    let inside = false
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, zi] = p[i]
      const [xj, zj] = p[j]
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
    }
    return inside
  }
  for (const id of ["loscab", "smash"]) {
    const { g, L } = get(id)
    setLayout(L)
    const rooms = g.layoutSpec.scene.rooms || []
    assert.ok(rooms.length >= 6, `${id}: rooms`)
    // (not the ones behind a closed door: the office, the kitchen)
    for (const r of rooms.filter((q) => !(q.doors || []).some((d) => d.kind === "closed"))) {
      const spots = g.layoutSpec.nav.filter((n) => inPoly(n.x, n.z, r.p))
      assert.ok(spots.length, `${id}: ${r.id} has room to walk`)
      const c = r.p.reduce((s, q) => [s[0] + q[0] / r.p.length, s[1] + q[1] / r.p.length], [0, 0])
      const to = spots.sort((a, b) => Math.hypot(a.x - c[0], a.z - c[1]) - Math.hypot(b.x - c[0], b.z - c[1]))[0]
      let at = L.SPAWN
      for (const p of L.route(L.SPAWN, to)) {
        assert.equal(L.segmentHit(at, p, 0), null, `${id}: on the way to ${r.id}`)
        at = p
      }
      assert.ok(Math.hypot(at.x - to.x, at.z - to.z) < 2.5, `${id}: reached ${r.id}`)
    }
    assert.ok(rooms.every((r) => Array.isArray(r.props)), `${id}: room props`)
    assert.ok((g.layoutSpec.scene.doors || []).length >= 6, `${id}: doors`)
  }
  setLayout(get("loscab").L)
})
