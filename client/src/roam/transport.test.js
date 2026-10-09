// Roam: getting around (bikes and scooters, flagging down a car, the ride app, buses and trains,
// the phone's GPS). node --test client/src/roam/transport.test.js
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { TOWNS, startSpot } from "./towns/index.js"
import { decodeTile } from "./data/tile.js"
import { tilesAround } from "./geo.js"
import { fleetSpots, fleetClear, MAX_FLEET } from "./sim/fleet.js"
import { MODELS, createCar, isTwo, stepCar, stickToRide } from "./sim/car.js"
import { createColliders } from "./sim/collide.js"
import { createTraffic, carPose, projectOn } from "./sim/traffic.js"
import { F, ROAD } from "./data/tile.js"
import { decodeGraph, nextStep, onRoute, pointAt, route, snap, stepText } from "./nav/route.js"
import { buildGraph, buildTransit, encodeGraph, projectLine, stitchLine } from "./nav/navdata.js"
import { createTrip, skipTrip, stepTrip, tripPoseAt } from "./sim/ride.js"
import { BUS, loadTransit, nextAt, stopsNear, tripAt, tripPose, tripsAt, vehiclesNear } from "./sim/transit.js"
import { ribbonArrays } from "./render/transit.js"
import { townFrame } from "./geo.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUB = path.join(HERE, "..", "..", "public", "roam")
const json = (town, f) => JSON.parse(fs.readFileSync(path.join(PUB, town, f), "utf8"))
const has = (town, f) => fs.existsSync(path.join(PUB, town, f))
// the decoded prebuilt tiles within r of a point
const tilesNear = (town, x, z, r = 300) =>
  tilesAround(townFrame(town.origin), x, z, r)
    .map((t) => path.join(PUB, town.id, "16", String(t.x), `${t.y}.json`))
    .filter((f) => fs.existsSync(f))
    .map((f) => decodeTile(JSON.parse(fs.readFileSync(f, "utf8")), townFrame(town.origin), json(town.id, "index.json").base))

test("bikes and scooters: near the shops and parks, on open ground, the same in every browser", () => {
  const town = TOWNS.valencia
  const s = startSpot(town)
  const tiles = tilesNear(town, s.x, s.z, 400)
  let n = 0
  for (const t of tiles) {
    const a = fleetSpots(t)
    assert.deepEqual(a, fleetSpots(t), "the same every time")
    assert.ok(a.length <= MAX_FLEET)
    for (const f of a) {
      n++
      assert.ok(["bike", "scooter"].includes(f.kind))
      assert.ok(fleetClear(t, f.x, f.z), `${f.id} on open ground`)
      assert.ok(Number.isFinite(f.yaw))
    }
  }
  assert.ok(n >= 3, `${n} round the Town Center`)
})

test("bikes and scooters: one thumb rides; quick, nimble, they stop, they slide along walls", () => {
  assert.deepEqual(stickToRide(0, 0), { steer: 0, gas: 0, brake: 0 })
  const up = stickToRide(0, 1)
  assert.ok(up.gas > 0.95 && up.steer === 0 && up.brake === 0, "up rides on")
  assert.ok(stickToRide(0.7, 0.7).steer > 0.5, "up and right steers right")
  assert.ok(stickToRide(-0.7, 0.7).steer < -0.5)
  assert.ok(stickToRide(0, -1).brake > 0.9 && stickToRide(0, -1).gas === 0, "pulled back brakes")
  for (const kind of ["bike", "scooter"]) {
    assert.ok(isTwo(kind))
    const m = MODELS[kind]
    const c = createCar({ model: kind })
    for (let i = 0; i < 300; i++) stepCar(c, stickToRide(0, 1), 1 / 60)
    assert.ok(c.speed > m.top * 0.85 && c.speed <= m.top + 1e-9, `${kind} gets going: ${c.speed.toFixed(1)} m/s`)
    assert.ok(c.speed > 6 && c.speed < 10, "faster than running, slower than a car")
    // a tight turn at riding speed (a car at that speed turns far wider)
    const yaw0 = c.yaw
    for (let i = 0; i < 60; i++) stepCar(c, stickToRide(1, 0.6), 1 / 60)
    const car = createCar({ model: "sedan" })
    car.speed = c.speed
    for (let i = 0; i < 60; i++) stepCar(car, { gas: 0.3, steer: 1 }, 1 / 60)
    assert.ok(Math.abs(c.yaw - yaw0) > Math.abs(car.yaw) * 1.3, `${kind} turns tighter than a car`)
    // the brake stops it within a few metres
    const x0 = c.x
    const z0 = c.z
    for (let i = 0; i < 240; i++) stepCar(c, stickToRide(0, -1), 1 / 60)
    assert.ok(Math.abs(c.speed) < 1.6, "stopped (or barely backing)")
    assert.ok(Math.hypot(c.x - x0, c.z - z0) < 14)
  }
  // a wall: it slides along, never through
  const col = createColliders()
  col.addTile("w", [{ ring: [{ x: -50, z: 10 }, { x: 50, z: 10 }, { x: 50, z: 11 }, { x: -50, z: 11 }], top: 5 }])
  const b = createCar({ model: "bike", yaw: 0.3 })
  for (let i = 0; i < 400; i++) stepCar(b, { gas: 1 }, 1 / 60, { resolve: (x, z, r) => col.resolve(x, z, r) })
  assert.ok(b.z < 10, `still this side of the wall (${b.z.toFixed(2)})`)
})

// a straight two-way road and a car coming along it
const straightRoad = () => ({ cls: ROAD.secondary, width: 12, flags: 0, name: "Test Road", layer: 0, pts: [{ x: 0, z: -400 }, { x: 0, z: 400 }], _street: [] })
test("flag down a car: one coming your way pulls up level with you and waits; the others drive on", () => {
  const road = straightRoad()
  const tr = createTraffic({ cap: 1, seed: 3 })
  const c = { id: "t1", road, s: 300, dir: 1, speed: 15, model: "sedan", color: 0xffffff, wait: 0, stopped: null }
  Object.assign(c, carPose(c))
  tr.cars.push(c)
  // you on the sidewalk, 100 m up the road
  const me = { x: 9, z: 0 }
  assert.ok(tr.canHail(me.x, me.z))
  assert.equal(tr.canHail(200, 0), false, "nobody coming past a field")
  assert.equal(tr.hail(me.x, me.z), c)
  const world = { roads: [road], street: [], people: [me], time: 0 }
  let t = 0
  while (!c.hail?.stopped && t < 40) {
    tr.step(world, me, 1 / 30)
    t += 1 / 30
  }
  assert.ok(c.hail?.stopped, `stopped for you (${t.toFixed(1)} s)`)
  const along = projectOn(road, me.x, me.z).s - c.s
  assert.ok(Math.abs(along) < 6, `level with you (${along.toFixed(1)} m)`)
  assert.ok(c.speed < 0.5)
  tr.remove(c)
  assert.equal(tr.cars.length, 0)
  // one already past you isn't stopped
  const d = { id: "t2", road, s: 450, dir: 1, speed: 15, model: "sedan", color: 0, wait: 0, stopped: null }
  Object.assign(d, carPose(d))
  tr.cars.push(d)
  assert.equal(tr.hail(me.x, me.z), null)
})

test("the road graph: every road split at its junctions, one-ways kept, packed and unpacked the same", () => {
  // a plus-shaped crossing of two ways and a one-way spur, in degrees round a frame
  const frame = townFrame([34.4, -118.5])
  const ll = (x, z) => frame.toLatLon(x, z)
  const way = (id, tags, ids, pts) => ({ type: "way", id, tags, nodes: ids, geometry: pts.map(([x, z]) => ({ lat: ll(x, z).lat, lon: ll(x, z).lon })) })
  const els = [way(1, { highway: "residential", name: "A St" }, [1, 2, 3], [[-100, 0], [0, 0], [100, 0]]), way(2, { highway: "residential", name: "B St" }, [4, 2, 5], [[0, -100], [0, 0], [0, 100]]), way(3, { highway: "tertiary", name: "C St", oneway: "yes" }, [3, 6], [[100, 0], [100, 100]])]
  const g = buildGraph(els, frame)
  assert.equal(g.nodes.length, 6)
  assert.equal(g.edges.length, 5, "A and B split at the crossing, C whole")
  assert.equal(g.edges.find((e) => e.name === "C St").ow, 1)
  const d = decodeGraph(encodeGraph(g))
  assert.equal(d.edges.length, 5)
  // a route can't go the wrong way up the one-way
  const there = route(d, 100, 90, -100, 0)
  assert.equal(there, null, "no way back up C St")
  const r = route(d, -90, 0, 100, 90)
  assert.ok(r && r.len > 275 && r.len < 290, `along A St and up C St (${r?.len.toFixed(0)} m)`)
  assert.equal(r.steps.at(-1).turn, "arrive")
  assert.ok(r.steps.some((s) => s.name === "C St" && s.turn === "right"), JSON.stringify(r.steps))
  assert.match(stepText(r.steps[0], 250), /^Turn right onto C St in 820 ft$/)
})

test("relations into lines: ways joined end to end whichever way they were drawn", () => {
  const line = stitchLine([
    [[0, 0], [0, 1]],
    [[0, 2], [0, 1]],
    [[0, 2], [0, 3]],
  ])
  assert.deepEqual(line, [[0, 0], [0, 1], [0, 2], [0, 3]])
})

for (const id of ["valencia", "northridge", "newport"])
  test(`the phone's GPS and the ride app in ${TOWNS[id].name}: a route on the roads, a car that drives it`, { skip: !has(id, "nav.json") }, () => {
    const town = TOWNS[id]
    const g = decodeGraph(json(id, "nav.json"))
    assert.ok(g.edges.length > 3000, `${g.edges.length} road pieces`)
    const places = json(id, "places.json").places
    assert.ok(places.length > 1000)
    const from = startSpot(town)
    // somewhere 1.5-4 km off with a name: a library, a park, a school
    const dest = places.find(([n, k, x, z]) => /^(library|park|school)$/.test(k) && Math.hypot(x - from.x, z - from.z) > 1500 && Math.hypot(x - from.x, z - from.z) < 4000)
    assert.ok(dest, "a place to go")
    const [name, , dx, dz] = dest
    const r = route(g, from.x, from.z, dx, dz)
    assert.ok(r, `a route to ${name}`)
    const straight = Math.hypot(dx - from.x, dz - from.z)
    assert.ok(r.len >= straight * 0.85 && r.len < straight * 2.6, `${r.len.toFixed(0)} m by road, ${straight.toFixed(0)} m as the crow flies`)
    // every point of it on a road
    for (let s = 0; s < r.len; s += 50) {
      const p = pointAt(r.pts, r.cum, s)
      const on = snap(g, p.x, p.z, { maxD: 30 })
      assert.ok(on && on.d < 3, `on a road at ${s} m`)
    }
    assert.ok(r.steps.length >= 2 && r.steps.at(-1).turn === "arrive")
    // the GPS follows you along it
    const mid = pointAt(r.pts, r.cum, r.len / 2)
    const on = onRoute(r, mid.x + 2, mid.z)
    assert.ok(Math.abs(on.s - r.len / 2) < 5 && on.d < 3)
    assert.ok(nextStep(r, on.s).dist > 0)
    // the line on the road: a ribbon 2.6 m wide
    const a = ribbonArrays(r.pts.slice(0, 20), r.pts.slice(0, 20).map(() => 1))
    assert.equal(a.position.length, 20 * 2 * 3)
    assert.ok(Math.abs(Math.hypot(a.position[0] - a.position[3], a.position[2] - a.position[5]) - 2.6) < 1e-2)
    // the ride: a car drives the route, in its lane, slows for the bends and stops at the end
    const trip = createTrip(r)
    let t = 0
    let maxOff = 0
    let top = 0
    while (!trip.done && t < 3600) {
      stepTrip(trip, 0.1)
      t += 0.1
      const p = tripPoseAt(trip)
      const q = projectLine(r.pts, p.x, p.z, r.cum)
      maxOff = Math.max(maxOff, q.d)
      top = Math.max(top, trip.speed)
    }
    assert.ok(trip.done, `there in ${(t / 60).toFixed(1)} min`)
    assert.ok(maxOff < 2.5, `in its lane (${maxOff.toFixed(2)} m off the middle at most)`)
    assert.ok(top > 10 && top <= 14.01, `a city pace (${top.toFixed(1)} m/s)`)
    // someone in front: it stops short
    const t2 = createTrip(r)
    for (let i = 0; i < 100; i++) stepTrip(t2, 0.1, { blocked: () => 5 })
    assert.ok(t2.speed < 0.2, "it waits for them")
    // skip ahead: nearly there at once
    const t3 = createTrip(r)
    skipTrip(t3)
    assert.ok(r.len - t3.s <= 25.01)
  })

for (const id of ["valencia", "northridge", "newport", "simi"])
  test(`buses and trains in ${TOWNS[id].name}: on the map's own routes, stopping at its stops`, { skip: !has(id, "transit.json") }, () => {
    const raw = json(id, "transit.json")
    const tr = loadTransit(raw)
    if (id !== "simi") assert.ok(tr.buses.length > 0, "buses")
    for (const l of [...tr.buses, ...tr.trains].slice(0, 8)) {
      assert.ok(l.stops.length >= (l.kind === "bus" ? 2 : 1))
      // the stops in order along the route, each on it
      for (let i = 1; i < l.stops.length; i++) assert.ok(l.stops[i].s >= l.stops[i - 1].s)
      // a vehicle through a whole trip: always on the line (a bus in its lane), waiting at each stop
      let waited = 0
      for (let tau = 0; tau <= l.tt.end; tau += 2) {
        const p = tripPose(l, tau)
        assert.ok(p, `running at ${tau}`)
        const q = projectLine(l.pts, p.x, p.z, l.cum)
        assert.ok(q.d < (l.kind === "bus" ? BUS.lane + 0.6 : 0.5), `${l.id} on its route (${q.d.toFixed(2)} m)`)
        if (p.stop >= 0) waited++
      }
      assert.ok(waited >= l.stops.length * 3, `${l.id} waits at its stops`)
      assert.equal(tripPose(l, l.tt.end + 5), null, "and is gone at the end")
      // the countdown at a stop is right: when it says, the bus is there
      const T = 1_000_000 + Math.random() * 1000
      const i = Math.min(1, l.stops.length - 1)
      const w = nextAt(l, i, T)
      assert.ok(w >= 0 && w <= l.headway + l.dwell)
      const when = w > 0 ? T + w + 0.5 : T
      const there = tripsAt(l, when).map((x) => tripAt(l, x.tau)).filter((q) => q && q.stop === i)
      assert.ok(there.length >= 1, `${l.id} at stop ${i} when the countdown ends`)
      // and it's found from the stop
      const st = l.stops[i]
      if (i < l.stops.length - 1) assert.ok(stopsNear([l], st.x, st.z, 5).length >= 1)
      assert.ok(vehiclesNear([l], when, st.x, st.z, 30).some((v) => v.stop === i))
    }
  })

test("trains between towns: each town with a station knows it, on its line", () => {
  for (const id of ["valencia", "simi", "northridge"]) {
    const town = TOWNS[id]
    assert.ok(town.station, `${id} has a station`)
    if (!has(id, "transit.json")) continue
    const tr = loadTransit(json(id, "transit.json"))
    assert.ok(tr.trains.length >= 1, `${id}: a train line`)
    const near = stopsNear(tr.trains, town.station.x, town.station.z, 70)
    assert.ok(near.length >= 1 || tr.trains.some((l) => projectLine(l.pts, town.station.x, town.station.z, l.cum).d < 60), `${id}: the station is on the line`)
  }
  assert.equal(TOWNS.newport.station, undefined, "no train in Newport")
})

test("the phone and the HUD: a phone button, a GPS banner, the ride and the stops; no Run button", () => {
  const hud = fs.readFileSync(path.join(HERE, "ui", "RoamHud.jsx"), "utf8")
  for (const k of ['data-roam="phone"', 'data-roam="gps"', 'data-roam="ride"', 'data-roam="transit"', 'data-roam="onboard"', 'data-roam="skip-wait"']) assert.ok(hud.includes(k), k)
  const phone = fs.readFileSync(path.join(HERE, "ui", "RoamPhone.jsx"), "utf8")
  for (const k of ["map", "rides", "transit", "messages", "camera", "music", "finds"]) assert.ok(phone.includes(`{ id: "${k}"`), k)
  assert.ok(phone.includes("phone-swipe"))
  assert.ok(!/Uber|Lyft/.test(phone), "original names only")
})

void F
void buildTransit
