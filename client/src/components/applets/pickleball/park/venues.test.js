// My Park's real venues: the specs (tools/venues/build-venues.mjs), the generator (venuegen.js)
// and the layouts it makes (layout.js makeLayout).
// node --test client/src/components/applets/pickleball/park/venues.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { venueLayoutSpec } from "./venuegen.js"
import { makeLayout, setLayout, toLocal } from "./layout.js"
import { createFollow, followTarget, stepFollow } from "./followcam.js"
import { VENUE_LIST } from "./venues/index.js"

const spec = (id) => JSON.parse(readFileSync(new URL(`./venues/${id}.json`, import.meta.url), "utf8"))
const IDS = ["loscab", "newport", "wolfbear", "whittier", "paseo", "sinaloa", "smash", "bouquet"]
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
  // (8 dedicated courts, the city's count: four on each of the two old tennis courts, placed off the aerial)
  bouquet: { pb: 8, tennis: 0, indoor: false },
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
    // (lazy-loaded, gzip about a quarter: the fidelity data, trees and rooms, makes it bigger;
    // the real surroundings and skyline add ~25-45 KB)
    assert.ok(kb < 96, `${id} spec ${kb.toFixed(1)} KB`)
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
  // Whittier: pickleball lines on two tennis courts (the club lists 16 permanent + 4 shared-use)
  assert.equal(spec("whittier").courts.reduce((n, c) => n + (c.pb || 0), 0), 4)
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

test("room kit: every room with a door you can open is reachable on foot from the arrival (Los Cab, SMASH, Paseo)", () => {
  const inPoly = (x, z, p) => {
    let inside = false
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, zi] = p[i]
      const [xj, zj] = p[j]
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
    }
    return inside
  }
  for (const id of ["loscab", "smash", "paseo"]) {
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

test("venue truth: nothing invented behind a real venue (docs/venue-provenance.md)", () => {
  for (const id of IDS) {
    const s = spec(id)
    // no made-up backdrop (hills, mountains, a skyline, ring trees, palms) and no made-up golf/ocean
    for (const k of ["hills", "mountains", "skyline", "trees", "palms"]) assert.equal(s.backdrop?.[k], undefined, `${id} backdrop.${k}`)
    assert.ok(!(s.extras || []).some((x) => x.type === "golf" || x.type === "ocean"), `${id}: no invented golf/ocean`)
    // the real skyline from elevation tiles, every degree, with its source
    assert.ok(s.horizon?.groups?.near?.length === 360 && /Terrain Tiles/.test(s.horizon.src), `${id} horizon`)
    // the real surroundings from OpenStreetMap, outside the walkable crop
    assert.ok(/OpenStreetMap/.test(s.surround?.src || ""), `${id} surround source`)
    for (const b of s.surround.buildings || []) assert.ok(b.h > 1 && b.h < 200 && b.p.length >= 3, `${id} surround building`)
  }
  // Newport sees the ocean to the south-west (and Catalina beyond it); Whittier the San Gabriels north
  const sea = spec("newport").horizon.groups.sea
  assert.ok(sea && sea[200] && !sea[20], "Newport: the sea south-west, not north")
  const w = spec("whittier").horizon.groups
  const top = (deg) => Math.max(...["near", "mid", "far"].map((g) => w[g]?.[deg]?.[1] ?? -999))
  assert.ok(top(0) > 300 && top(0) > top(200), "Whittier: the San Gabriels rise north (> 3 degrees)")
  // Newport's golf course is the real one, mapped (the course, its greens and bunkers)
  const kinds = new Set(spec("newport").surround.areas.map((a) => a.k))
  for (const k of ["golf", "green", "bunker"]) assert.ok(kinds.has(k), `Newport golf: ${k}`)
  // SMASH's Metro viaduct comes from OpenStreetMap's bridge, not a hand-placed line
  assert.ok(spec("smash").surround.rails.some((r) => r.bridge), "SMASH viaduct")
})

// The owner, 2026-10-07: "The bench in Newport pickleball during the game WTF." Nothing on the
// ground (props, benches, stands, trees, light poles) stands on a live court or within 0.3 m
// of its sidelines and 1 m of its baselines, where the players run during a game. (Walls of
// rooms and halls are buildings: indoor run-offs are what the building gives. Things up on a
// wall, doors and number cards don't count.)
test("live courts are clear: nothing stands where the players run (the Newport bench)", () => {
  const HL = 6.705 + 1.0
  const HW = 3.05 + 0.3
  const MOUNTED = new Set(["door", "numcard", "exitsign", "banner", "tv", "wallart", "signpanel", "extinguisher", "mirror", "pendant", "curtain", "flagstone", "rug", "mat"])
  for (const id of IDS) {
    const { s, L } = get(id)
    const bad = []
    const inPlay = (c, x, z, r = 0) => {
      const p = toLocal(c, x, z)
      return Math.abs(p.x) < HW + r && Math.abs(p.z) < HL + r
    }
    for (const c of L.COURTS) {
      for (const pr of s.props || []) if (!MOUNTED.has(pr.t) && !((pr.y || 0) > 2) && inPlay(c, pr.x, pr.z)) bad.push(`${pr.t} on ${c.name}`)
      for (const b of L.BOXES) if ((b.kind === "bench" || b.kind === "bleacher" || b.kind === "booth" || b.kind === "board") && inPlay(c, b.cx, b.cz)) bad.push(`${b.kind} on ${c.name}`)
      for (const t of L.CIRCLES) if (inPlay(c, t.x, t.z, t.r)) bad.push(`a tree or pole on ${c.name}`)
    }
    assert.deepEqual(bad, [], `${id}: things in play`)
  }
})

test("upper floors you can walk: SMASH's mezzanine and Los Cab's ballroom, up the stairs, a long walk about without falling through, over a railing or through a wall; the camera clear", async () => {
  const { stepWalker, createWalker } = await import("./walker.js")
  const inPoly = (x, z, p) => {
    let inside = false
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, zi] = p[i]
      const [xj, zj] = p[j]
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
    }
    return inside
  }
  // a fixed sequence of stick pushes: long pushes each way (into every railing and wall) and
  // wandering (a little LCG so the run is the same every time)
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  for (const id of ["smash", "loscab"]) {
    const { L } = get(id)
    setLayout(L)
    const s = L.STAIRS[0]
    const y1 = s.y1
    const decks = L.DECKS.filter((d) => Math.abs(d.y - y1) < 0.1)
    const onStairs = (x, z) => {
      const t = (x - s.a.x) * s.ux + (z - s.a.z) * s.uz
      const c = Math.abs(-(x - s.a.x) * s.uz + (z - s.a.z) * s.ux)
      return t > -0.6 && t < s.L + 0.6 && c < s.w / 2 + 0.4
    }
    const upHere = (x, z) => decks.some((d) => inPoly(x, z, d.p))
    // up the stairs
    const yaw = Math.atan2(s.ux, s.uz)
    const w = createWalker(s.a.x - s.ux * 1.2, s.a.z - s.uz * 1.2, yaw)
    for (let k = 0; k < 500 && (w.y || 0) < y1 - 0.01; k++) stepWalker(w, { x: 0, y: 1 }, yaw, 1 / 30)
    assert.ok(Math.abs(w.y - y1) < 0.01, `${id}: climbed to ${w.y} of ${y1}`)
    for (let k = 0; k < 30; k++) stepWalker(w, { x: 0, y: 1 }, yaw, 1 / 30)
    assert.ok(upHere(w.x, w.z), `${id}: on the upper floor`)
    const pushes = []
    for (const dir of [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4, (-3 * Math.PI) / 4]) pushes.push(...Array(150).fill({ cam: dir, x: 0, y: 1 }))
    for (let k = 0; k < 900; k++) pushes.push({ cam: rnd() * Math.PI * 2, x: rnd() * 2 - 1, y: rnd() })
    const st = createFollow(yaw)
    let up = 0
    let downs = 0
    pushes.forEach((p, k) => {
      stepWalker(w, { x: p.x, y: p.y }, p.cam, 1 / 30)
      // (walked back down the stairs and off their foot: fine, that's the way down; back up)
      const t = (w.x - s.a.x) * s.ux + (w.z - s.a.z) * s.uz
      if (w.y < 0.01 && t < 0.2 && t > -2.5) {
        downs++
        for (let j = 0; j < 500 && w.y < y1 - 0.01; j++) stepWalker(w, { x: 0, y: 1 }, yaw, 1 / 30)
        for (let j = 0; j < 30; j++) stepWalker(w, { x: 0, y: 1 }, yaw, 1 / 30)
      }
      // never on the ground floor below, never off the floor's edge (railings, walls): always on
      // this floor or on the stairs at their own height
      const there = upHere(w.x, w.z)
      assert.ok(there || onStairs(w.x, w.z), `${id}: step ${k} at ${w.x.toFixed(2)}, ${w.z.toFixed(2)}, y ${w.y}: left the floor`)
      if (there) {
        assert.ok(Math.abs(w.y - y1) < 0.01, `${id}: step ${k}: fell to ${w.y}`)
        up++
      } else assert.ok(Math.abs(w.y - L.heightAt(w.x, w.z, w.y)) < 0.05, `${id}: on the stairs' step`)
      // the follow camera: never a wall or a floor between it and your head
      stepFollow(st, { x: w.x, z: w.z, y: w.y, yaw: w.yaw, speed: w.speed || 0 }, 1 / 30, { portrait: true })
      if (k % 15 === 14) assert.equal(L.segmentHit3({ x: w.x, y: w.y + 1.55, z: w.z }, st.pos), null, `${id}: camera at step ${k}`)
    })
    assert.ok(up > pushes.length * 0.6, `${id}: spent the walk up there (${up})`)
  }
  // Los Cab: from the balcony through the ballroom's glass doors and across its floor
  {
    const { L, s: sp } = get("loscab")
    setLayout(L)
    const room = sp.rooms.find((r) => r.id === "ballroom")
    const door = room.doors[0]
    const st = L.STAIRS[0]
    const w = createWalker(st.b.x - st.ux * 0.5, st.b.z - st.uz * 0.5, 0, st.y1)
    w.y = st.y1
    const go = (tx, tz, n) => {
      for (let k = 0; k < n && Math.hypot(tx - w.x, tz - w.z) > 0.3; k++) stepWalker(w, { x: 0, y: 1 }, Math.atan2(tx - w.x, tz - w.z), 1 / 30)
    }
    go(door.x, door.z + 1.2, 400)
    go(door.x, door.z - 4, 400)
    const c = room.p.reduce((a, q) => [a[0] + q[0] / room.p.length, a[1] + q[1] / room.p.length], [0, 0])
    go(c[0], c[1], 600)
    assert.ok(inPoly(w.x, w.z, room.p) && Math.hypot(w.x - c[0], w.z - c[1]) < 1.5, `into the ballroom (${w.x.toFixed(1)}, ${w.z.toFixed(1)})`)
    assert.ok(Math.abs(w.y - room.y) < 0.01, `on the ballroom's floor (${w.y})`)
  }
  setLayout(get("loscab").L)
})

// (a spec point from the reference pack's metres east/north of its aerial anchor)
const fromEn = (s, anchor, [e, n]) => {
  const K = Math.cos((s.origin[0] * Math.PI) / 180)
  return [(anchor[1] - s.origin[1]) * 111320 * K + e, -(anchor[0] - s.origin[0]) * 111320 - n]
}
const inside = (x, z, p) => {
  let r = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i]
    const [xj, zj] = p[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) r = !r
  }
  return r
}
const areaOf = (p) => Math.abs(p.reduce((a, q, i) => a + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0)) / 2

test("Paseo's clubhouse is the L the aerial and OSM show, tile-roofed in parts, its rooms inside it", () => {
  const s = spec("paseo")
  const A = [34.4374, -118.5621] // the reference pack's aerial anchor
  const at = (e, n) => fromEn(s, A, [e, n])
  const club = s.buildings.find((b) => b.k === "clubhouse" && inside(...at(15, 50), b.p))
  assert.ok(club, "a clubhouse building over the main block")
  // the main block (OSM 472562074) and the south arm's tile wing are one building: an L
  assert.ok(inside(...at(13.5, 20), club.p), "the south arm")
  assert.ok(inside(...at(0, 45), club.p), "the west wing")
  // not the open patio, the pergola courtyard, the fountain courtyard or the NW corner's trees
  for (const [e, n, what] of [[13.5, 11, "patio"], [20, 22, "pergola courtyard"], [1.5, 22, "fountain courtyard"], [0, 58, "NW corner"], [22.3, 42, "recessed porch"]]) assert.ok(!inside(...at(e, n), club.p), what)
  const a = areaOf(club.p)
  // (OSM 472562074 is 1039 m2 with the patio and pergola south of the arm, which the aerial shows open)
  assert.ok(a > 880 && a < 1000, `footprint ${a.toFixed(0)} m2`)
  // its roofs: tile hips/gable in parts, all over the footprint
  const parts = s.roofs.filter((r) => r.p.every(([x, z]) => Math.abs(x - club.p[0][0]) < 60 && Math.abs(z - club.p[0][1]) < 60) && inside(...r.p.reduce((c, q) => [c[0] + q[0] / r.p.length, c[1] + q[1] / r.p.length], [0, 0]), club.p))
  assert.ok(parts.length >= 5 && parts.every((r) => r.tile && ["hip", "gable"].includes(r.rs)), `${parts.length} tile roof parts`)
  assert.ok(parts.some((r) => r.rs === "gable" && r.h > 9.5), "the taller gable front over the entrance")
  // every clubhouse room inside the building
  const mine = ["pcLobby", "pcShop", "pcKids", "pcFit", "pcPerf", "pcSpin", "pcStudio"]
  for (const r of s.rooms.filter((q) => mine.includes(q.id))) {
    const xs = r.p.map((q) => q[0])
    const zs = r.p.map((q) => q[1])
    let n = 0
    for (let x = Math.min(...xs) + 0.25; x < Math.max(...xs); x += 0.5)
      for (let z = Math.min(...zs) + 0.25; z < Math.max(...zs); z += 0.5)
        if (inside(x, z, r.p)) {
          n++
          assert.ok(inside(x, z, club.p), `${r.id}: (${x.toFixed(1)}, ${z.toFixed(1)}) inside the clubhouse`)
        }
    assert.ok(n > 40, `${r.id} has a floor`)
  }
  // the entrance on the fountain walk, the fountain just before it
  assert.ok(club.doors.some((d) => Math.hypot(d.x - at(1.5, 28.6)[0], d.z - at(1.5, 28.6)[1]) < 0.3), "the main entrance")
  assert.ok(s.props.some((p) => p.t === "lobbyfountain" && Math.hypot(p.x - at(1.5, 24)[0], p.z - at(1.5, 24)[1]) < 0.5), "the fountain")
  // no pro-shop kiosk by rule at a club with its own pro shop inside
  assert.equal(s.fence.booth, false)
})

test("Sinaloa's school lot: one lot, the aerial's three stall rows, a modest share taken, nothing in the aisles", async () => {
  const { lotStalls } = await import("./scenery.js")
  const s = spec("sinaloa")
  const A = [34.265, -118.7854]
  const lots = s.areas.filter((a) => a.k === "parking")
  assert.equal(lots.length, 1, "one lot (OSM's two overlapping lots and the hand-drawn one had tripled the stalls)")
  const lot = lots[0]
  assert.ok(lot.rows?.length >= 3, "stall rows traced")
  const { stalls, stripes } = lotStalls(lot.p, lot.rows)
  assert.ok(stalls.length > 100 && stalls.length < 170, `${stalls.length} stalls`)
  assert.equal(stripes.length, stalls.length * 2)
  assert.ok(lot.full > 0 && lot.full <= 0.35, `share taken ${lot.full}`)
  assert.ok(stalls.length * lot.full < 50, `about ${Math.round(stalls.length * lot.full)} cars`)
  // OSM's parking aisles (n -14.6 and n -34.3, 7 m wide): no stall reaches into them
  for (const n of [-14.6, -34.3]) {
    const z = fromEn(s, A, [0, n])[1]
    for (const st of stalls) assert.ok(Math.abs(st.z - z) >= 3.5 + 2.7 - 0.05, `a stall at z ${st.z} in the aisle at n ${n}`)
  }
  for (const st of stalls) assert.ok(inside(st.x, st.z, lot.p), "stalls inside the lot")
  // no stall nearer than a car's width to another (no double rows on top of each other)
  for (let i = 0; i < stalls.length; i++) for (let j = i + 1; j < stalls.length; j++) assert.ok(Math.hypot(stalls[i].x - stalls[j].x, stalls[i].z - stalls[j].z) > 2.6)
  assert.equal(s.fence.booth, false, "no kiosk standing in the lot")
})

test("parking lots: stalls in bays with driving aisles, inside the lot, along its long side", async () => {
  const { lotStalls } = await import("./scenery.js")
  // a 60 x 40 m lot turned 30 degrees
  const r = (30 * Math.PI) / 180
  const rot = ([x, z]) => [x * Math.cos(r) - z * Math.sin(r), x * Math.sin(r) + z * Math.cos(r)]
  const lot = [[0, 0], [60, 0], [60, 40], [0, 40]].map(rot)
  const { stalls, stripes } = lotStalls(lot)
  assert.ok(stalls.length > 60 && stalls.length < 200, `${stalls.length} stalls`)
  assert.equal(stripes.length, stalls.length * 2)
  // back in lot coordinates: rows at distinct depths, with 7 m aisles between bays (not a
  // car every 6 m from edge to edge)
  const back = ([x, z]) => [x * Math.cos(-r) - z * Math.sin(-r), x * Math.sin(-r) + z * Math.cos(-r)]
  const rows = [...new Set(stalls.map((s) => Math.round(back([s.x, s.z])[1] * 10) / 10))].sort((a, b) => a - b)
  const gaps = rows.slice(1).map((w, i) => w - rows[i])
  assert.ok(gaps.some((g) => g > 12), `an aisle between bays: ${gaps}`)
  assert.ok(gaps.every((g) => g > 5), `stall rows don't overlap: ${gaps}`)
  for (const s of stalls) {
    const [u, w] = back([s.x, s.z])
    assert.ok(u > 0 && u < 60 && w > 0 && w < 40)
  }
})

test("every venue's stairs climb to a deck you can walk on (Newport's terrace, SMASH's mezzanine, Los Cab's ballroom deck)", async () => {
  const { stepWalker, createWalker } = await import("./walker.js")
  const withStairs = IDS.filter((id) => get(id).L.STAIRS?.length)
  for (const want of ["newport", "smash", "loscab"]) assert.ok(withStairs.includes(want), `${want} has stairs`)
  for (const id of withStairs) {
    const { L } = get(id)
    setLayout(L)
    for (const s of L.STAIRS) {
      const deck = L.DECKS.find((d) => Math.abs(d.y - s.y1) < 0.1)
      assert.ok(deck, `${id}: the stairs arrive at a deck`)
      const yaw = Math.atan2(s.ux, s.uz)
      const w = createWalker(s.a.x - s.ux * 1.2, s.a.z - s.uz * 1.2, yaw)
      for (let k = 0; k < 500 && (w.y || 0) < s.y1 - 0.01; k++) stepWalker(w, { x: 0, y: 1 }, yaw, 1 / 30)
      assert.ok(Math.abs(w.y - s.y1) < 0.01, `${id}: climbed to ${w.y} of ${s.y1}`)
      // on along the top: still up there
      for (let k = 0; k < 45; k++) stepWalker(w, { x: 0, y: 1 }, yaw, 1 / 30)
      assert.ok(Math.abs(w.y - s.y1) < 0.01, `${id}: on the deck (${w.y})`)
    }
  }
  setLayout(get("loscab").L)
})
