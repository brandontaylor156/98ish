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

test("angled stalls: a row with k leans its stalls k degrees toward b, a car's width apart across the lean", async () => {
  const { lotStalls } = await import("./scenery.js")
  const lot = [[-5, -20], [40, -20], [40, 20], [-5, 20]]
  const square = lotStalls(lot, [{ a: [0, 0], b: [30, 0], d: 5.4 }])
  const angled = lotStalls(lot, [{ a: [0, 0], b: [30, 0], d: 5.4, k: 30 }])
  assert.equal(square.stalls.length, 11)
  assert.ok(angled.stalls.length < square.stalls.length && angled.stalls.length >= 8, `${angled.stalls.length} angled stalls`)
  // stripes: 5.4 m long, turned 30 degrees off square, 2.7 / cos 30 apart along the row
  for (const [x0, z0, x1, z1] of angled.stripes) {
    assert.ok(Math.abs(Math.hypot(x1 - x0, z1 - z0) - 5.4) < 1e-6)
    const off = (Math.abs(Math.atan2(x1 - x0, Math.abs(z1 - z0))) * 180) / Math.PI
    assert.ok(Math.abs(off - 30) < 1e-6, `stripe ${off.toFixed(1)} degrees off square`)
  }
  const xs = angled.stalls.map((s) => s.x).sort((a, b) => a - b)
  for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[i - 1] - 2.7 / Math.cos(Math.PI / 6)) < 1e-6)
  // the cars turn with their stalls (a square row's yaw, turned by k)
  const d = Math.abs(angled.stalls[0].yaw - square.stalls[0].yaw)
  assert.ok(Math.abs(Math.min(d, 2 * Math.PI - d) - Math.PI / 6) < 1e-6)
  // every stall stays between the row's two ends
  for (const s of angled.stalls) assert.ok(s.x > 0 && s.x < 30)
})

test("Paseo's lots: angled stalls where the aerial shows them, and the north-east lot by the clubhouse", async () => {
  const { lotStalls } = await import("./scenery.js")
  const s = spec("paseo")
  const lots = s.areas.filter((a) => a.k === "parking")
  assert.equal(lots.length, 2, "the club's lot and the north-east lot")
  const [club, ne] = lots.sort((a, b) => Math.min(...a.p.map((p) => p[0])) - Math.min(...b.p.map((p) => p[0])))
  // four of the club lot's rows lean (measured off the aerial two ways: edge directions and car blobs)
  const leaning = club.rows.filter((r) => r.k)
  assert.equal(leaning.length, 4)
  for (const r of leaning) assert.ok(Math.abs(r.k) >= 10 && Math.abs(r.k) <= 25, `lean ${r.k}`)
  // the north-east lot: square rows, about the share of the club's lot taken
  assert.ok(ne.rows.length >= 5 && ne.rows.every((r) => !r.k))
  assert.equal(ne.full, 0.6)
  for (const lot of lots) {
    const { stalls, stripes } = lotStalls(lot.p, lot.rows)
    assert.equal(stripes.length, stalls.length * 2)
    for (const st of stalls) assert.ok(inside(st.x, st.z, lot.p), "stalls inside the lot")
    // the leaning rows and the new lot overlap nothing (two of the earlier square rows meet at
    // one end; untouched here)
    const rows = lot.rows.map((r) => ({ r, stalls: lotStalls(lot.p, [r]).stalls }))
    for (const A of rows)
      for (const B of rows)
        if (A !== B && (lot === ne || A.r.k))
          for (const a of A.stalls) for (const b of B.stalls) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 2.6, "no stall on top of another")
    // no stall inside a building
    for (const b of s.buildings) for (const st of stalls) assert.ok(!inside(st.x, st.z, b.p), `a stall inside building ${b.id}`)
  }
  assert.ok(lotStalls(ne.p, ne.rows).stalls.length >= 25, "the north-east lot's stalls")
})

test("chamfered pens: Whittier's and the Paseo Club's pen corners are cut at 45 degrees (the aerials); other venues keep square corners", () => {
  for (const [id, c] of [["whittier", 1.8], ["paseo", 2.5]]) {
    const { s, g } = get(id)
    assert.equal(s.fence.chamfer, c)
    const fences = g.layoutSpec.scene.fences.filter((f) => f.k === "chain")
    const diag = fences.filter((f) => {
      const L = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1])
      return Math.abs(L - c * Math.SQRT2) < 0.15
    })
    assert.ok(diag.length >= 8, `${id}: ${diag.length} cut corners`)
    // each cut corner joins the ends of two sides (a closed outline: every end meets another)
    const ends = fences.flatMap((f) => [f.a, f.b])
    for (const f of diag) for (const p of [f.a, f.b]) assert.ok(ends.filter((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.12).length >= 2, `${id}: a cut corner meets its sides`)
  }
  for (const id of ["loscab", "newport", "sinaloa", "bouquet"]) assert.ok(!get(id).s.fence?.chamfer, `${id}: square corners`)
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

// ---------- fidelity round (2026-10-08): fences, partitions and surroundings from the owner's photos ----------
const sceneOf = (id) => venueLayoutSpec(spec(id)).scene
// a court's centre in its row's frame: along (u, its long axis) and across (w)
const segDist = (p, a, b) => {
  const [ax, az] = a
  const [bx, bz] = b
  const L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1
  const t = Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.z - az) * (bz - az)) / L2))
  return Math.hypot(p.x - (ax + (bx - ax) * t), p.z - (az + (bz - az) * t))
}
// does a fence run between two courts (crossing the segment between their centres)?
const between = (f, A, B) => {
  const [ax, az] = f.a
  const [bx, bz] = f.b
  const cross = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px)
  const d1 = cross(ax, az, bx, bz, A.x, A.z)
  const d2 = cross(ax, az, bx, bz, B.x, B.z)
  const d3 = cross(A.x, A.z, B.x, B.z, ax, az)
  const d4 = cross(A.x, A.z, B.x, B.z, bx, bz)
  return d1 * d2 < 0 && d3 * d4 < 0
}

test("partitions court by court: Bouquet's cross, Los Cab's between the pairs (the owner's photos)", () => {
  // Bouquet: courts 1-4 north row west to east, 5-8 south row (spec order after the basketball court)
  const bq = spec("bouquet")
  const S = sceneOf("bouquet")
  const pb = bq.courts.filter((c) => c.s === "p").map((c) => ({ x: c.x, z: c.z }))
  const low = S.fences.filter((f) => f.t === "low")
  assert.equal(low.length, 2, "two low partitions: across the pen and down its middle")
  const parted = (i, j) => low.some((f) => between(f, pb[i], pb[j]))
  // across: every north court from the court behind it
  for (let k = 0; k < 4; k++) assert.ok(parted(k, k + 4), `Bouquet court ${k + 1} | ${k + 5}`)
  // down the middle: between the two old tennis courts only
  assert.ok(parted(1, 2) && parted(5, 6), "Bouquet 2|3 and 6|7")
  for (const [i, j] of [[0, 1], [2, 3], [4, 5], [6, 7]]) assert.ok(!parted(i, j), `Bouquet ${i + 1}|${j + 1}: no partition inside an old tennis court`)
  for (const f of low) assert.equal(f.h, 1.52)

  // Los Cab: in each row of the village, a partition between neighbours more than 2.8 m apart
  // (the pairs), none inside a pair
  const lc = spec("loscab")
  const L = sceneOf("loscab")
  const parts = L.fences.filter((f) => f.t === "pair" && Array.isArray(f.part))
  const village = lc.courts.map((c, i) => ({ ...c, i })).filter((c) => c.s === "p" && c.z < 40 && c.z > -40)
  const rows = new Map()
  for (const c of village) {
    const k = Math.round(c.z / 6)
    if (!rows.has(k)) rows.set(k, [])
    rows.get(k).push(c)
  }
  let checked = 0
  for (const row of rows.values()) {
    if (row.length < 4) continue
    row.sort((a, b) => a.x - b.x)
    for (let k = 0; k + 1 < row.length; k++) {
      const gap = row[k + 1].x - row[k].x - 6.1
      const has = parts.some((f) => between(f, row[k], row[k + 1]))
      if (gap > 2.8 && gap < 8) assert.ok(has, `Los Cab: courts at x ${row[k].x} | ${row[k + 1].x} (gap ${gap.toFixed(1)} m) have a partition`)
      if (gap <= 2.8) assert.ok(!has, `Los Cab: no partition inside the pair at x ${row[k].x} | ${row[k + 1].x}`)
      checked++
    }
  }
  assert.ok(checked >= 20, `${checked} neighbours checked`)
  assert.equal(parts.length, 14, "two in the west block, twelve in the east block")
  // the centre aisle's portable net, one per block
  assert.equal(L.fences.filter((f) => f.t === "aisle").length, 2)
})

test("fence heights per type: Bouquet 3.66 m windscreened (east side bare), 1.52 m partitions; Los Cab 1.2 m capped and curbed, 3 m tall sides", () => {
  const S = sceneOf("bouquet")
  const T = S.fence.types
  assert.equal(T.tall.h, 3.66)
  assert.ok(T.tall.screen && T.tall.screen.y0 > 0.1 && Math.abs(T.tall.screen.y1 - 3.0) < 0.01, "windscreen 0.15-3.0 m")
  assert.ok(!T.east.screen, "the east side is bare chain-link (the lot shows through)")
  assert.equal(T.low.h, 1.52)
  assert.ok(T.low.rails.some((y) => y > 0.6 && y < 0.9), "a mid rail")
  const per = S.fences.filter((f) => f.k === "chain" && !f.part && f.t)
  assert.equal(per.filter((f) => f.t === "tall").length, 3, "three windscreened sides")
  assert.equal(per.filter((f) => f.t === "east").length, 1, "one bare side")
  for (const f of per) assert.equal(f.h, T[f.t].h)
  // the pen: a standard double tennis enclosure, 36.6 m square
  const bank = S.banks.find((b) => b.s === "p")
  assert.ok(Math.abs(2 * bank.hx - 36.6) < 0.2 && Math.abs(2 * bank.hz - 36.6) < 0.2, `pen ${(2 * bank.hx).toFixed(1)} x ${(2 * bank.hz).toFixed(1)}`)
  // the shade alcove's opening in the west fence
  assert.ok(per.some((f) => f.opens?.length && Math.abs(f.opens[0].w - 6.4) < 0.01))

  const L = sceneOf("loscab")
  const P = L.fence.types.pair
  assert.equal(P.h, 1.2)
  assert.ok(P.cap && P.cap.color && P.curb && Math.abs(P.curb.h - 0.28) < 0.01, "green cap and a 0.28 m curb")
  assert.equal(L.fence.types.tall.h, 3)
  const vill = L.fences.filter((f) => f.k === "chain" && !f.part && f.t)
  assert.equal(vill.filter((f) => f.t === "pair").length, 4, "the north sides and the walkway ends are low")
  assert.ok(vill.filter((f) => f.t === "tall").length >= 4)
  // round 4 (the drone photo's solved pose): the poles stand on the partitions only, two a
  // court along each, mirrored across the centre aisle, the T arm across the partition; 6.9 m
  const lights = venueLayoutSpec(spec("loscab")).lights
  assert.ok(lights.every((l) => l.arm), "T arms")
  const parts = L.fences.filter((f) => Array.isArray(f.part))
  const seg = (p, [ax, az], [bx, bz]) => {
    const dx = bx - ax
    const dz = bz - az
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / (dx * dx + dz * dz)))
    return Math.hypot(p.x - ax - t * dx, p.z - az - t * dz)
  }
  const onPart = lights.map((l) => ({ l, f: parts.find((f) => seg(l, f.a, f.b) < 0.3) })).filter((x) => x.f)
  assert.equal(onPart.length, parts.length * 2, `${onPart.length} poles on ${parts.length} partitions`)
  for (const { l, f } of onPart) {
    const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1])
    assert.ok(Math.abs((l.arm[0] * (f.b[0] - f.a[0]) + l.arm[1] * (f.b[1] - f.a[1])) / len) < 0.1, "the arm crosses the partition")
  }
  assert.ok(lights.length < 86, `${lights.length} poles (round 3 had 86)`)
  assert.equal(L.fence.poleH, 6.9)
  // the partitions' top rail is a round padded tube, not a box
  assert.equal(P.cap.shape, "round")
  assert.ok(P.cap.h <= 0.11 && P.cap.w <= 0.11)
  // other venues keep their untyped fences
  for (const id of ["newport", "whittier", "sinaloa"]) assert.ok(sceneOf(id).fences.every((f) => !f.t), `${id} untyped`)
})

test("surroundings: real heights, roofs read off the aerial, Bouquet's hillside from the terrain, Los Cab's bridges and power lines", () => {
  const bq = spec("bouquet").surround
  assert.ok(bq.buildings.length >= 250, `${bq.buildings.length} buildings round Bouquet`)
  const mapped = bq.buildings.filter((b) => !b.g)
  assert.ok(mapped.length / bq.buildings.length > 0.98, `${mapped.length} with mapped heights`)
  assert.ok(bq.buildings.every((b) => b.h > 2 && b.h < 30))
  const hips = bq.buildings.filter((b) => b.r === "hip")
  assert.ok(hips.length > 100 && hips.every((b) => b.rise > 0 && b.rise <= 3 && /^#[0-9a-f]{6}$/.test(b.rc)), `${hips.length} hip roofs`)
  const lc = spec("loscab").surround
  assert.ok(lc.buildings.length >= 180, `${lc.buildings.length} buildings round Los Cab`)
  assert.ok(lc.buildings.filter((b) => !b.g).length >= 180)
  assert.ok(lc.buildings.filter((b) => !b.r).length > 50, "the industrial blocks stay flat")
  assert.equal(lc.roads.filter((r) => r.bridge).length, 4, "Warner Ave and Harbor Blvd bridges (OSM)")
  assert.ok(lc.power?.length >= 3 && lc.power.every((p) => p.p.length >= 2), "the 66 kV lines along the river (OSM)")
  // the terrain: the hills north of Bouquet rise 20 m+ within 300 m; Los Cab has none
  const T = spec("bouquet").terrain
  assert.ok(T && T.n * T.n === T.h.length)
  const at = (x, z) => T.h[Math.round((z + T.r) / T.step) * T.n + Math.round((x + T.r) / T.step)] / 10
  assert.ok(at(0, -300) > 20, `north hill ${at(0, -300)} m`)
  assert.ok(Math.abs(at(0, 0)) < 1)
  assert.ok(!spec("loscab").terrain)
  // the other venues' surroundings are untouched (no roofs, bridges or power read in)
  for (const id of ["newport", "whittier", "sinaloa", "smash", "wolfbear"]) {
    const su = spec(id).surround
    assert.ok(!su.buildings.some((b) => b.r || b.rc) && !su.power && !(su.roads || []).some((r) => r.bridge), `${id} unchanged`)
  }
  // round 4: Paseo's houses (tan stucco, red tile in the day photo) take their roofs off its aerial
  const ps = spec("paseo").surround
  assert.ok(ps.buildings.filter((b) => b.rc).length > 100 && ps.buildings.filter((b) => b.r === "hip").length > 50, "Paseo's roofs")
})

test("terrain sampler: flat inside the crop, the real height beyond the blend", async () => {
  const { terrainSampler } = await import("./surround.js")
  const T = { r: 30, step: 15, n: 5, h: Array(25).fill(100) }
  const g = terrainSampler(T, { x0: -5, x1: 5, z0: -5, z1: 5 }, 10)
  assert.equal(g(0, 0), 0)
  assert.equal(g(5, 0), 0)
  assert.ok(Math.abs(g(25, 0) - 10) < 1e-9)
  assert.ok(g(10, 0) > 0 && g(10, 0) < 10)
})

// ---------- fidelity round 4 (2026-10-08): trees, the hillside, the deck's stairs ----------
test("round 4: tree species from the owner's photos, the hillside's cover, Los Cab's east stairs", async () => {
  const { coverGrid, decodeRuns } = await import("./surround.js")
  const kinds = (id) => spec(id).trees.reduce((m, t) => ((m[t[3] || "broadleaf"] = (m[t[3] || "broadleaf"] || 0) + 1), m), {})
  // Bouquet: the pines all round the pen; Los Cab: eucalyptus north of the deck, fan palms
  assert.ok(kinds("bouquet").pine > 100, "Bouquet's pines")
  const lk = kinds("loscab")
  assert.ok(lk.eucalyptus >= 10 && lk.fanpalm >= 100 && !lk.palm, `Los Cab ${JSON.stringify(lk)}`)
  // the hillside: run-length rows decode to the full grid, grass, scrub and bush specks on it
  assert.equal(decodeRuns("g3.2s"), "ggg..s")
  const T = spec("bouquet").terrain
  const { rows, dots } = coverGrid(T)
  assert.equal(rows.length, T.cover.n)
  assert.ok(rows.every((r) => r.length === T.cover.n) && dots.every((r) => r.length === T.cover.n))
  const all = rows.join("")
  for (const c of "gsb.") assert.ok(all.includes(c), `cover has ${c}`)
  assert.ok(dots.flat().filter((d) => d > 0).length > 1000, "bushes dotted over the grass")
  // nothing but the venues that ask for it gets a cover
  for (const id of IDS) if (id !== "bouquet") assert.ok(!spec(id).terrain?.cover, `${id} has no cover`)
  // Los Cab: open stairs come down from the deck's east end (photo 1, the aerial's dark patch)
  const deck = spec("loscab").decks.find((d) => d.y > 3 && d.y < 3.2)
  const x1 = Math.max(...deck.p.map((p) => p[0]))
  const east = spec("loscab").stairs.find((s) => Math.abs(Math.min(s.a[0], s.b[0]) - x1) < 0.3 && Math.max(s.a[0], s.b[0]) > x1 + 4)
  assert.ok(east && east.open, "east stairs")
})

test("round 4: Paseo from the owner's photos: one pen, low black partitions, the green court, banners, black poles on the partitions", () => {
  const s = spec("paseo")
  const S = sceneOf("paseo")
  const dark = (hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16) < 150
  // the eight courts west of the tennis rows are one pen with a tall black windscreened fence
  const inBank = (c, b) => Math.abs((c.x - b.cx) * b.ux + (c.z - b.cz) * b.uz) <= b.hx + 0.5 && Math.abs(-(c.x - b.cx) * b.uz + (c.z - b.cz) * b.ux) <= b.hz + 0.5
  const pens = S.banks.filter((b) => b.s === "p" && S.courts.filter((c) => c.s === "p" && inBank(c, b)).length === 8)
  assert.equal(pens.length, 1, "one pen of eight")
  const T = S.fence.types
  assert.ok(T.tall.h > 2.9 && T.tall.h < 3.7 && T.tall.screen, "tall windscreened perimeter")
  assert.ok(T.low.h > 0.8 && T.low.h < 1.1 && dark(T.low.mesh) && dark(T.low.post.color), "low black partitions")
  const parts = S.fences.filter((f) => f.t === "low")
  assert.equal(parts.length, 3, "two across the pen and one between the rows")
  assert.ok(!S.fences.some((f) => f.k === "screen"), "no white dividers between the courts of a pair")
  // the green court (PB8, OSM 1413415729): green inside its lines
  const green = s.courts.filter((c) => c.s === "p" && c.col != null && /^#4f795b$/i.test(s.palettes[c.col].court))
  assert.equal(green.length, 1, "one green court")
  // banners on the windscreens: the club's and the sponsor's, as our own lettering
  const banners = s.extras.filter((x) => x.type === "fencebanner")
  assert.ok(banners.some((b) => b.style === "club") && banners.filter((b) => b.style === "pristine").length >= 2)
  // black T poles, some standing on the partitions
  assert.equal(s.fence.poleStyle, "t")
  assert.ok(dark(s.fence.poleColor))
  const lights = venueLayoutSpec(s).lights
  assert.ok(lights.filter((l) => parts.some((f) => segDist(l, f.a, f.b) < 0.2)).length >= 6, "poles on the partitions")
})
