// Roam (the open world): node --test client/src/roam/roam.test.js
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"
import { EXTENT, fromTileUnits, tileBounds, tileOf, tilesAround, toTileUnits, townFrame } from "./geo.js"
import { AREA, F, FOOT, ROAD, ROAD_CLASSES, buildTile, fillMissing, buildingHeight, clipLine, clipPolygon, decodeTile, roadWidth, simplify, tileHeightAt, tileSeaAt } from "./data/tile.js"
import { inRings, joinLines, seaRings, townSea } from "./data/sea.js"
import { nestRings, seaArrays } from "./render/sea.js"
import { compactElement, stitchRings } from "./data/osm.js"
import { decodePng, terrainSampler, terrariumHeight } from "./data/terrain.js"
import { buildingArrays, orientedBox, wallRings } from "./render/buildings.js"
import { groundArrays, treeSpots } from "./render/ground.js"
import { deckAt, deckSurfaces, markingArrays } from "./render/linework.js"
import { createColliders } from "./sim/collide.js"
import { createWalker, stepWalker } from "./sim/walker.js"
import { MODELS, createCar, personAhead, stepCar } from "./sim/car.js"
import { MAX_PER_TILE, parkedCars } from "./sim/parked.js"
import { ACT, LIMIT, MODEL_LIST, cleanCar, cleanPos, createTrack, packPos, pushSample, sampleTrack, shouldSend, unpackPos } from "./sim/sync.js"
import { eggSpots, nearestEgg, REACH } from "./eggs.js"
import { createTileStore } from "./stream.js"
import { CAR_KINDS, CAR_SPECS, carParts } from "./render/carmodel.js"
import { carGeometry, fallbackGeometry } from "./render/cars.js"
import { createChase, stepChase } from "./sim/chase.js"
import { carPose, createTraffic, laneOffset, nextRoad, signalGreen, stopsOn } from "./sim/traffic.js"
import { createPeds, walkLines } from "./sim/peds.js"
import { SURF, materialOf } from "./render/buildings.js"
import { kitKindOf, speciesOf } from "./render/trees.js"
import { STREET } from "./data/tile.js"
import valencia from "./towns/valencia.js"
import { TOWNS, townForVenue } from "./towns/index.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PREBUILT = path.join(HERE, "..", "..", "public", "roam", "valencia")
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

// a tile somewhere in Valencia and a frame round its north-west corner
const T = tileOf(34.4366, -118.5622)
const B = tileBounds(T.z, T.x, T.y)
const frame = townFrame([B.north, B.west])
const ll = (u, v) => {
  const p = fromTileUnits(B, u, v)
  return [p.lat, p.lon]
}
const way = (id, tags, pts) => compactElement({ type: "way", id, tags, geometry: pts.map(([u, v]) => ({ lat: ll(u, v)[0], lon: ll(u, v)[1] })) })

test("tiles: lat/lon round trip, ~500 m tiles, the ones round a point nearest first", () => {
  const p = toTileUnits(B, 34.4366, -118.5622)
  const back = fromTileUnits(B, p[0], p[1])
  assert.ok(near(back.lat, 34.4366, 1e-9) && near(back.lon, -118.5622, 1e-9))
  const r = frame.tileRect(T)
  assert.ok(near(r.x0, 0, 1e-6) && near(r.z0, 0, 1e-6))
  assert.ok(r.x1 > 480 && r.x1 < 530 && r.z1 > 480 && r.z1 < 530, `tile ${r.x1} x ${r.z1}`)
  const list = tilesAround(frame, 250, 250, 600)
  assert.equal(list[0].x, T.x)
  assert.ok(list.every((t, i) => i === 0 || t.d >= list[i - 1].d))
  assert.ok(list.length >= 9 && list.length <= 25)
  const f = townFrame(valencia.origin)
  const q = f.toXZ(valencia.origin[0] - 0.001, valencia.origin[1] + 0.001)
  assert.ok(q.x > 90 && q.x < 93 && q.z > 110 && q.z < 112, "x east, z south")
})

test("tile build: roads keep classes and widths, buildings their heights, areas and bridges", () => {
  const elements = [
    way(1, { highway: "residential", name: "Paseo Way" }, [[-200, 1000], [2000, 1000], [4300, 1000]]),
    way(2, { highway: "primary", lanes: "4", oneway: "no", name: "Valencia Blvd" }, [[100, 2000], [3900, 2000]]),
    way(3, { highway: "footway", bridge: "yes" }, [[1000, 2600], [1000, 3400]]),
    way(4, { building: "house" }, [[500, 500], [600, 500], [600, 600], [500, 600], [500, 500]]),
    way(5, { building: "commercial", "building:levels": "3" }, [[800, 500], [1000, 500], [1000, 700], [800, 700], [800, 500]]),
    way(6, { building: "yes", height: "21 m" }, [[1200, 500], [1300, 500], [1300, 560], [1200, 560], [1200, 500]]),
    way(7, { amenity: "parking" }, [[2000, 2400], [3000, 2400], [3000, 3000], [2000, 3000], [2000, 2400]]),
    way(8, { landuse: "residential" }, [[-500, -500], [5000, -500], [5000, 5000], [-500, 5000], [-500, -500]]),
    compactElement({ type: "node", id: 9, lat: ll(1500, 1500)[0], lon: ll(1500, 1500)[1], tags: { amenity: "library", name: "Valencia Library" } }),
    compactElement({ type: "node", id: 10, lat: ll(1600, 1500)[0], lon: ll(1600, 1500)[1], tags: { natural: "tree" } }),
  ]
  const elevation = (lat) => 300 + (B.north - lat) * 20000 // (rising south)
  const raw = buildTile({ ...T, elements, elevation })
  // (it survives JSON, compact)
  const tile = decodeTile(JSON.parse(JSON.stringify(raw)), frame, 300)
  const res = tile.roads.find((r) => r.name === "Paseo Way")
  assert.equal(res.cls, ROAD.residential)
  assert.equal(res.width, 10)
  assert.ok(res.pts[0].x < 0 && res.pts[0].x > -15, "clipped a little past the edge")
  const blvd = tile.roads.find((r) => r.name === "Valencia Blvd")
  assert.equal(blvd.cls, ROAD.primary)
  assert.ok(near(blvd.width, 4 * 3.4 + 2.5, 0.05), `4 lanes -> ${blvd.width}`)
  const bridge = tile.roads.find((r) => r.flags & F.bridge)
  assert.ok(bridge.deck && bridge.deck.length === bridge.pts.length, "a deck height at every point")
  const mid = bridge.deck[Math.floor(bridge.deck.length / 2)]
  assert.ok(Math.max(...bridge.deck) > Math.max(bridge.deck[0], bridge.deck[bridge.deck.length - 1]), "a footbridge arches")
  void mid
  const [house, shop, tall] = tile.buildings
  assert.equal(house.height, 6.5)
  assert.ok(near(shop.height, 3 * 3.1 + 1.5, 1e-9))
  assert.equal(tall.height, 21)
  assert.equal(tile.areas.filter((a) => a.cls === AREA.parking).length, 1)
  assert.ok(tile.areas.some((a) => a.cls === AREA.res), "a big area clipped to the tile")
  const resArea = tile.areas.find((a) => a.cls === AREA.res)
  assert.ok(resArea.ring.every((p) => p.x > -20 && p.x < frame.tileRect(T).x1 + 20))
  assert.equal(tile.pois[0].name, "Valencia Library")
  assert.equal(tile.trees.length, 1)
  // heights: the lattice, rising south, and the ground between lattice points on its triangles
  assert.equal(tile.grid, 33)
  const north = tileHeightAt(tile, 100, 1)
  const south = tileHeightAt(tile, 100, 490)
  assert.ok(south > north + 5, `${north} -> ${south}`)
  const g = groundArrays(tile)
  for (let k = 0; k < g.index.length; k += 3) {
    const [a, b, c] = [g.index[k], g.index[k + 1], g.index[k + 2]]
    const P = (i) => [g.position[i * 3], g.position[i * 3 + 1], g.position[i * 3 + 2]]
    const pa = P(a)
    const pb = P(b)
    const pc = P(c)
    const ny = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2])
    assert.ok(ny > 0, "ground faces up")
    if (k === 0) {
      const cx = (pa[0] + pb[0] + pc[0]) / 3
      const cz = (pa[2] + pb[2] + pc[2]) / 3
      assert.ok(near(tileHeightAt(tile, cx, cz), (pa[1] + pb[1] + pc[1]) / 3, 1e-3), "physics ground = drawn ground")
    }
  }
})

test("tile geometry helpers: clipping, rings, simplification, defaults", () => {
  assert.deepEqual(clipLine([[-10, 5], [10, 5]], 0, 4096), [[[0, 5], [10, 5]]])
  assert.equal(clipLine([[-10, -10], [-5, -5]], 0, 4096).length, 0)
  const sq = clipPolygon([[-10, -10], [10, -10], [10, 10], [-10, 10]], 0, 4096)
  assert.equal(sq.length, 4)
  const ring = [[0, 0], [10, 0], [10, 0.1], [10, 10], [0, 10], [0, 0]]
  assert.ok(simplify(ring, 1).length >= 4, "a closed ring keeps its corners")
  const rings = stitchRings([[[0, 0], [0, 1]], [[1, 1], [0, 1]], [[1, 1], [1, 0], [0, 0]]])
  assert.equal(rings.length, 1)
  assert.equal(buildingHeight(0, 0, 0, 40), 3.2)
  assert.equal(buildingHeight(0, 0, 0, 3000), 10)
  assert.equal(roadWidth(ROAD.footway, {}), 2)
  assert.equal(ROAD_CLASSES.length, Object.keys(ROAD).length)
})

test("terrain: a terrarium PNG decodes to metres, sampled between pixels", () => {
  // a 2x2 RGB PNG made here (filters 0 and 1)
  const px = (m) => {
    const v = m + 32768
    return [Math.floor(v / 256), Math.floor(v) % 256, Math.round((v % 1) * 256)]
  }
  const rows = [
    [0, ...px(100), ...px(110)],
    [1, ...px(120), ...px(130).map((c, i) => (c - px(120)[i] + 256) % 256)],
  ]
  const raw = Buffer.from(rows.flat())
  const chunk = (type, body) => {
    const b = Buffer.alloc(12 + body.length)
    b.writeUInt32BE(body.length, 0)
    b.write(type, 4, "ascii")
    body.copy(b, 8)
    return b
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(2, 0)
  ihdr.writeUInt32BE(2, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
  const img = decodePng(png, (b) => new Uint8Array(zlib.inflateSync(b)))
  assert.equal(img.width, 2)
  const h = (i) => terrariumHeight(img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2])
  assert.deepEqual([h(0), h(1), h(2), h(3)], [100, 110, 120, 130])
  const sample = terrainSampler(() => ({ ...img, width: 256, data: (() => {
    const d = new Uint8Array(256 * 256 * 3)
    for (let i = 0; i < 256 * 256; i++) d.set(px(200), i * 3)
    return d
  })() }))
  assert.ok(near(sample(34.43, -118.56), 200, 1e-6))
})

test("buildings: real heights, walls face out, roofs face up, a hipped roof on a house", () => {
  const sq = (x, z, w, d) => [{ x, z }, { x: x + w, z }, { x: x + w, z: z + d }, { x, z: z + d }]
  const blds = [
    { kind: 1, height: 6.5, min: 0, levels: 0, roof: 0, ring: sq(0, 0, 12, 9), area: 108 },
    { kind: 4, height: 12, min: 0, levels: 0, roof: 0, ring: sq(30, 0, 20, 20).reverse(), area: 400 },
  ]
  const a = buildingArrays(blds, () => 5, { key: "t" })
  assert.equal(a.count, 2)
  let top = -Infinity
  for (let i = 1; i < a.position.length; i += 3) top = Math.max(top, a.position[i])
  assert.ok(near(top, 17, 1e-6), "the shop's roof at ground + 12 m")
  // every triangle's normal points away from its building's middle (walls) or up (roofs)
  const mids = [{ x: 6, z: 4.5 }, { x: 40, z: 10 }]
  for (let i = 0; i < a.position.length; i += 9) {
    const p = (k) => [a.position[i + k * 3], a.position[i + k * 3 + 1], a.position[i + k * 3 + 2]]
    const [p0, p1, p2] = [p(0), p(1), p(2)]
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
    const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const cx = (p0[0] + p1[0] + p2[0]) / 3
    const cz = (p0[2] + p1[2] + p2[2]) / 3
    const m = cx < 20 ? mids[0] : mids[1]
    const out = n[0] * (cx - m.x) + n[2] * (cz - m.z)
    assert.ok(n[1] > 1e-9 || out > -1e-9, `triangle ${i / 9} faces in`)
  }
  const box = orientedBox(sq(0, 0, 12, 9))
  assert.ok(near(box.hl, 6) && near(box.hw, 4.5))
  const walls = wallRings(blds, () => 5)
  assert.equal(walls[1].top, 17)
})

test("collisions: you slide along a wall; a car slides too and never goes through", () => {
  const c = createColliders()
  c.addTile("t", [{ ring: [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 20 }, { x: 0, z: 20 }], top: 8 }])
  const p = c.resolve(10, -0.2, 0.35)
  assert.ok(p.hit && near(p.z, -0.35, 1e-9) && near(p.x, 10, 1e-9))
  assert.equal(c.inside(10, 10), 8)
  assert.ok(c.segment(10, -5, 10, 5, 2) < 1 && c.segment(10, -5, 10, 5, 9) === 1, "taller than the lens only")
  // walking diagonally into the wall: along it
  const w = createWalker(5, -3, 0)
  for (let i = 0; i < 60; i++) stepWalker(w, { x: -0.7, y: 0.7 }, 0, 1 / 30, { resolve: (x, z, r) => c.resolve(x, z, r), heightAt: () => 0 })
  assert.ok(w.z < -0.3, "never in the building")
  assert.ok(w.x < 2 || w.x > 5.5, `slid along (x ${w.x.toFixed(2)})`)
  // a car into the wall at an angle keeps going along it
  const car = createCar({ x: 10, z: -6, yaw: 0.5 })
  car.speed = 15
  for (let i = 0; i < 40; i++) stepCar(car, { gas: 1 }, 1 / 30, { resolve: (x, z, r) => c.resolve(x, z, r), heightAt: () => 0 })
  assert.ok(!c.inside(car.x, car.z), "outside the walls")
  assert.ok(car.z < 0, "on its side of the wall")
  assert.ok(Math.abs(car.speed) > 3, `still moving along it (${car.speed.toFixed(1)})`)
  c.removeTile("t")
  assert.equal(c.inside(10, 10), 0)
})

test("car: gas, speed-sensitive steering, brake, reverse, slopes, people", () => {
  const car = createCar({ yaw: 0 })
  for (let i = 0; i < 90; i++) stepCar(car, { gas: 1 }, 1 / 30)
  assert.ok(car.speed > 12 && car.z > 15, `3 s of gas: ${car.speed.toFixed(1)} m/s`)
  assert.ok(Math.abs(car.x) < 1e-6)
  for (let i = 0; i < 300; i++) stepCar(car, { gas: 1 }, 1 / 30)
  assert.ok(car.speed <= MODELS.sedan.top + 1e-9)
  // steering right (facing south, right is west: x goes down)
  const x0 = car.x
  for (let i = 0; i < 30; i++) stepCar(car, { gas: 1, steer: 1 }, 1 / 30)
  assert.ok(car.x < x0 - 1, "turned right")
  // braking from speed stops it, and it doesn't flip into reverse by itself
  for (let i = 0; i < 150; i++) stepCar(car, { brake: 1 }, 1 / 30)
  assert.ok(near(car.speed, 0, 1e-9) || car.speed < 0)
  const r = createCar()
  for (let i = 0; i < 60; i++) stepCar(r, { brake: 1 }, 1 / 30)
  assert.ok(r.speed < -1, "holding brake at a stop backs up")
  // uphill holds you back
  const up = createCar()
  const flat = createCar()
  for (let i = 0; i < 60; i++) {
    stepCar(up, { gas: 1 }, 1 / 30, { heightAt: (x, z) => z * 0.12 })
    stepCar(flat, { gas: 1 }, 1 / 30, { heightAt: () => 0 })
  }
  assert.ok(up.speed < flat.speed - 0.5 && up.pitch > 0.05)
  // someone in front: the car stops
  const p = createCar()
  p.speed = 8
  stepCar(p, { gas: 1 }, 1 / 30, { blocked: (x, z, yaw, dir, m) => personAhead([{ x: 0, z: 3.5 }], x, z, yaw, dir, m) })
  assert.ok(p.speed === 0)
  assert.equal(personAhead([{ x: 0, z: -3 }], 0, 0, 0, 1), false)
})

test("car models: real sizes, wheels on the axles, glass and lamps, a triangle budget", () => {
  for (const kind of CAR_KINDS) {
    const p = carParts(kind)
    const m = MODELS[kind]
    const spec = CAR_SPECS[kind]
    // the body's extent matches the physics' car (length, width) within a few centimetres
    let x0 = Infinity
    let x1 = -Infinity
    let z0 = Infinity
    let z1 = -Infinity
    let y1 = -Infinity
    const P = p.paint.position
    for (let i = 0; i < P.length; i += 3) {
      x0 = Math.min(x0, P[i])
      x1 = Math.max(x1, P[i])
      y1 = Math.max(y1, P[i + 1])
      z0 = Math.min(z0, P[i + 2])
      z1 = Math.max(z1, P[i + 2])
    }
    assert.ok(near(z1 - z0, spec.len, 0.12), `${kind} length ${(z1 - z0).toFixed(2)}`)
    assert.ok(Math.abs(spec.len - m.len) < 0.25 && Math.abs(spec.wid - m.wid) < 0.12, `${kind} matches the physics`)
    assert.ok(x1 - x0 > spec.wid - 0.05 && x1 - x0 < spec.wid + 0.4, `${kind} width (mirrors included) ${(x1 - x0).toFixed(2)}`)
    assert.ok(y1 > 1.1 && y1 < 2.1, `${kind} height ${y1.toFixed(2)}`)
    // centred on the wheelbase: wheels at +-wheelbase/2, on the ground
    assert.equal(p.wheels.length, 4)
    for (const w of p.wheels) {
      assert.ok(near(Math.abs(w.z), spec.wb / 2, 1e-9) && near(w.y, spec.R, 1e-9))
      assert.ok(w.z > z0 && w.z < z1)
    }
    // glass (near-black vertices in the paint) and lamps that glow (1 head, 2 tail)
    const C = p.paint.color
    let glass = 0
    for (let i = 0; i < C.length; i += 3) if (C[i] < 0.1 && C[i + 1] < 0.1) glass++
    assert.ok(glass > 40, `${kind} has windows (${glass})`)
    assert.ok(p.trim.glow.includes(1) && p.trim.glow.includes(2), `${kind} head and tail lamps`)
    assert.ok(p.tris > 900 && p.tris < 3000, `${kind}: ${Math.round(p.tris)} triangles`)
    // every index in range
    const n = p.paint.position.length / 3
    assert.ok(p.paint.index.every((i) => i < n))
  }
})

test("car geometry: the detailed shape, and the plain one if a shape can't be built", () => {
  const g = carGeometry("sedan")
  assert.equal(g.fallback, false)
  assert.ok(g.paint.attributes.normal && g.trimWithWheels.attributes.position.count > g.trim.attributes.position.count, "wheels merged in for parked cars")
  assert.ok(g.wheel && g.wheels.length === 4)
  const broken = carGeometry("brokenModel", {
    build: () => {
      throw new Error("no file")
    },
  })
  assert.equal(broken.fallback, true)
  assert.ok(broken.paint.attributes.position.count > 0 && broken.trimWithWheels.attributes.glow, "a boxy car stands in, lamps attribute and all")
  assert.ok(fallbackGeometry("pickup").paint.attributes.color)
})

test("chase camera: behind and above, looking down the road ahead, wider when fast, out of the ground", () => {
  const ch = createChase()
  const car = { x: 0, z: 0, y: 0, yaw: 0, speed: 0 }
  let v = stepChase(ch, car, 1 / 60, { portrait: true, groundAt: () => 0 })
  assert.ok(v.pos.z < -5 && Math.abs(v.pos.x) < 1e-9 && v.pos.y > 1.8, "behind (the car faces +z) and above")
  assert.ok(v.look.z > 8 && v.look.y < 1.5, "looking at the road ahead, not the roof")
  const slowFov = v.fov
  car.speed = 28
  for (let i = 0; i < 240; i++) {
    car.z += car.speed / 60
    v = stepChase(ch, car, 1 / 60, { portrait: true, groundAt: () => 0 })
  }
  assert.ok(v.fov > slowFov + 6, `wider at speed (${slowFov.toFixed(0)} -> ${v.fov.toFixed(0)})`)
  assert.ok(car.z - v.pos.z > 7, "and further back")
  // the car turns: the camera swings round after it, behind again in a second or two
  car.yaw = Math.PI / 2
  for (let i = 0; i < 120; i++) v = stepChase(ch, car, 1 / 60, { portrait: false, groundAt: () => 0 })
  assert.ok(v.pos.x < car.x - 5 && Math.abs(v.pos.z - car.z) < 1.5)
  // uphill ahead: the look rises with the road; downhill behind: the lens stays out of the hill
  const hill = (x, z) => z * 0.15
  const ch2 = createChase()
  const c2 = { x: 0, z: 0, y: 0, yaw: 0, speed: 10 }
  v = stepChase(ch2, c2, 1 / 60, { groundAt: hill })
  assert.ok(v.look.y > 1.5, "looks up the hill")
  const steep = (x, z) => -z * 0.6
  const ch3 = createChase()
  v = stepChase(ch3, { x: 0, z: 0, y: 0, yaw: 0, speed: 0 }, 1 / 60, { groundAt: steep })
  assert.ok(v.pos.y > steep(v.pos.x, v.pos.z) + 1, "above the ground behind")
  // a wall behind: pulled in
  const ch4 = createChase()
  v = stepChase(ch4, { x: 0, z: 0, y: 0, yaw: 0, speed: 0 }, 1 / 60, { groundAt: () => 0, segment: () => 0.4 })
  assert.ok(v.pos.z > -4, "in front of the wall")
})

test("traffic: in its lane, on to the next road, stops at stop signs and red lights, never hits you", () => {
  const road = (pts, cls = ROAD.residential, flags = 0, width = 10) => ({ cls, width, flags, name: "", pts: pts.map(([x, z]) => ({ x, z })) })
  const a = road([[0, 0], [0, 200]])
  const b = road([[0, 200], [0, 400]])
  const side = road([[0, 200], [150, 200]])
  // a car on a two-way street keeps right of the middle, clear of cars at the curb
  const off = laneOffset(a)
  assert.ok(off >= 1.6 && off + 0.9 <= a.width / 2 - 1.0 - 0.9 + 0.01, `lane ${off}`)
  const pose = carPose({ road: a, s: 50, dir: 1 })
  assert.ok(pose.x < 0 && near(pose.z, 50), "heading south (+z), its right is west (-x)")
  // at the end of a way it follows on (mostly straight)
  let straight = 0
  for (let i = 0; i < 40; i++) if (nextRoad([a, b, side], a, 1, Math.random)?.road === b) straight++
  assert.ok(straight > 20, `goes straight on more often (${straight}/40)`)
  assert.equal(nextRoad([a], a, 1), null)
  // signals: the cross street's green is the other half of the cycle
  let both = 0
  for (let t = 0; t < 52; t += 0.5) if (signalGreen(t, 0) && signalGreen(t, Math.PI / 2)) both++
  assert.equal(both, 0, "never green both ways")
  // a stop sign 100 m along: the car stops at it, waits, then goes on
  const stopRoad = road([[0, 0], [0, 400]])
  stopRoad._street = [{ kind: STREET.stop, x: 0, z: 100 }]
  assert.equal(stopsOn(stopRoad, stopRoad._street).length, 1)
  const tr = createTraffic({ cap: 1, seed: 3 })
  const c = { id: "t", road: stopRoad, s: 40, dir: 1, speed: 11, model: "sedan", color: 0, wait: 0, stopped: null }
  Object.assign(c, carPose(c))
  tr.cars.push(c)
  const world = { roads: [stopRoad], street: [], people: [], time: 0 }
  let minAtStop = Infinity
  for (let i = 0; i < 60 * 12; i++) {
    tr.step(world, { x: 0, z: 0 }, 1 / 60)
    if (c.s > 85 && c.s < 100) minAtStop = Math.min(minAtStop, c.speed)
  }
  assert.ok(minAtStop < 0.3, "stopped at the sign")
  assert.ok(c.s > 108 && c.speed > 3, `then went on (${c.s.toFixed(0)}, ${c.speed.toFixed(1)} m/s)`)
  // you standing in the lane: the car stops short of you, every time, and waits
  for (const start of [10, 60, 100]) {
    const t2 = createTraffic({ cap: 1 })
    const r = road([[0, 0], [0, 400]], ROAD.primary, 0, 16)
    const car = { id: "u", road: r, s: start, dir: 1, speed: 19, model: "sedan", color: 0, wait: 0, stopped: null }
    Object.assign(car, carPose(car))
    t2.cars.push(car)
    const you = { x: car.x + 0.5, z: 130 }
    let closest = Infinity
    for (let i = 0; i < 60 * 20; i++) {
      t2.step({ roads: [r], people: [you], time: 0 }, { x: 0, z: 0 }, 1 / 60)
      closest = Math.min(closest, Math.hypot(car.x - you.x, car.z - you.z))
    }
    assert.ok(closest > 4, `stopped ${closest.toFixed(1)} m short of you (from ${start})`)
    assert.ok(car.speed < 0.01, "and waits")
  }
  // spawning: away from you, on the roads, never two on top of each other
  const t3 = createTraffic({ cap: 12, seed: 5 })
  const grid = []
  for (let k = -3; k <= 3; k++) grid.push(road([[-400, k * 80], [400, k * 80]], ROAD.secondary), road([[k * 80, -400], [k * 80, 400]], ROAD.tertiary))
  for (let i = 0; i < 60 * 30; i++) t3.step({ roads: grid, people: [{ x: 0, z: 0 }], time: i / 60 }, { x: 0, z: 0 }, 1 / 60)
  assert.ok(t3.cars.length >= 6, `cars about (${t3.cars.length})`)
  for (const x of t3.cars) for (const y of t3.cars) if (x !== y) assert.ok(Math.hypot(x.x - y.x, x.z - y.z) > 3, "never overlapping")
  for (const x of t3.cars) assert.ok(Math.hypot(x.x, x.z) > 4, "never on you")
})

test("people walking: on mapped walks near shops, waiting for you", () => {
  const fw = { cls: ROAD.footway, width: 2, flags: 0, name: "", pts: [{ x: 0, z: 0 }, { x: 0, z: 120 }] }
  const st = { cls: ROAD.residential, width: 10, flags: F.walkL | F.walkR, name: "", pts: [{ x: 50, z: 0 }, { x: 50, z: 120 }] }
  const lines = walkLines([fw, st, { ...st, flags: 0 }])
  assert.equal(lines.length, 3, "the footway and both mapped sidewalks (not an unmapped one)")
  for (const l of lines) l.shop = true
  const peds = createPeds({ cap: 3, seed: 2 })
  const you = { x: 0, z: 60 }
  for (let i = 0; i < 60 * 40; i++) peds.step({ lines, people: [you] }, { x: 0, z: -60 }, 1 / 60)
  assert.ok(peds.peds.length > 0)
  for (const p of peds.peds) assert.ok(Math.hypot(p.x - you.x, p.z - you.z) > 0.9 || p.speed < 0.05, "never walks through you")
})

test("materials: houses stucco under tile or shingle, works in concrete panels, palms where mapped", () => {
  const house = { kind: 1, area: 150 }
  const shop = { kind: 5, area: 900 }
  const box = { kind: 7, area: 9000 }
  const roofs = new Set()
  for (let h = 0; h < 64; h++) {
    const m = materialOf(house, h * 977)
    assert.equal(m.wall, SURF.stucco)
    roofs.add(m.roof)
  }
  assert.ok(roofs.has(SURF.tile) && roofs.has(SURF.shingle), "both roof kinds on houses")
  assert.deepEqual(materialOf(shop, 1), { wall: SURF.stucco, roof: SURF.flat })
  assert.equal(materialOf(box, 1).wall, SURF.panel)
  assert.ok(["palm", "fanpalm"].includes(kitKindOf({ x: 3, z: 9, kind: 1 })))
  assert.equal(kitKindOf({ x: 3, z: 9, kind: 0 }), null, "broad-leaf trees are the town's own species (render/treekit.js)")
  assert.ok(["plane", "oak", "round"].includes(speciesOf({ x: 3, z: 9, kind: 0, sp: "oak" })) && speciesOf({ kind: 3 }) === "pine")
})

test("street nodes: lamps, signals and stop signs kept in the tile", () => {
  const elements = [
    { type: "node", id: 1, lat: 0, lon: 0, tags: { highway: "street_lamp" } },
    { type: "node", id: 2, lat: 0, lon: 0, tags: { highway: "traffic_signals" } },
    { type: "node", id: 3, lat: 0, lon: 0, tags: { highway: "stop" } },
    { type: "node", id: 4, lat: 0, lon: 0, tags: { highway: "crossing" } },
  ]
  const b = tileBounds(T.z, T.x, T.y)
  for (const e of elements) {
    e.lat = (b.north + b.south) / 2
    e.lon = (b.west + b.east) / 2 + e.id * 1e-5
  }
  const tile = buildTile({ ...T, elements })
  assert.equal(tile.s.length, 9)
  const d = decodeTile(tile, frame, 0)
  assert.deepEqual(d.street.map((n) => n.kind), [STREET.lamp, STREET.signals, STREET.stop])
  assert.equal(decodeTile(buildTile({ ...T, elements: [] }), frame, 0).street.length, 0)
})

test("parked cars: the same in every browser, in lots and at curbs, never in a building", () => {
  const elements = [
    way(1, { amenity: "parking" }, [[600, 600], [1600, 600], [1600, 1400], [600, 1400], [600, 600]]),
    way(2, { highway: "residential" }, [[0, 2500], [4096, 2500]]),
    way(3, { building: "retail" }, [[900, 800], [1100, 800], [1100, 1000], [900, 1000], [900, 800]]),
  ]
  const tile = decodeTile(buildTile({ ...T, elements }), frame, 0)
  const a = parkedCars(tile)
  const b = parkedCars(decodeTile(buildTile({ ...T, elements }), frame, 0))
  assert.deepEqual(a, b)
  assert.ok(a.length > 3 && a.length <= MAX_PER_TILE, `${a.length} cars`)
  assert.ok(a.some((c) => c.src === "lot") && a.some((c) => c.src === "curb"))
  const shop = tile.buildings[0].ring
  for (const c of a) {
    const inShop = c.x > shop[0].x - 1 && c.x < shop[2].x + 1 && c.z > shop[0].z - 1 && c.z < shop[2].z + 1
    assert.ok(!inShop, "not in the shop")
  }
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) assert.ok(Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z) >= (a[i].src === "lot" && a[j].src === "lot" ? 2.3 : 4.6))
  assert.ok(new Set(a.map((c) => c.id)).size === a.length)
})

test("lines: markings on arterials, decks you can stand on, trees off the roads", () => {
  const elements = [way(1, { highway: "secondary", lanes: "4" }, [[0, 2000], [4096, 2000]]), way(2, { highway: "residential", bridge: "yes" }, [[1000, 0], [1000, 1000]]), compactElement({ type: "node", id: 3, lat: ll(2000, 2024)[0], lon: ll(2000, 2024)[1], tags: { natural: "tree" } })]
  const tile = decodeTile(buildTile({ ...T, elements, elevation: () => 350 }), frame, 300)
  const m = markingArrays(tile.roads, () => 50)
  assert.ok(m.position.length > 100)
  const decks = deckSurfaces(tile.roads)
  assert.ok(decks.length >= 1)
  const d = decks[0]
  assert.ok(near(deckAt(decks, (d.ax + d.bx) / 2, (d.az + d.bz) / 2, 50), 50, 1e-6))
  assert.equal(deckAt(decks, (d.ax + d.bx) / 2, (d.az + d.bz) / 2, 20), null, "far below: under it")
  assert.equal(treeSpots(tile).length, 0, "the mapped tree on the road's lanes (3 m off its line) isn't drawn")
})

test("online: positions pack small and are checked; cars are named once; tracks glide", () => {
  const p = { x: 1234.56, z: -987.65, y: 12.3, yaw: 1.2, speed: 22.5, act: ACT.drive | ACT.move }
  const a = packPos(p)
  assert.equal(a.length, 6)
  assert.ok(a.every(Number.isInteger))
  assert.ok(JSON.stringify(a).length < 40)
  const b = unpackPos(a)
  assert.ok(near(b.x, 1234.6, 0.051) && near(b.yaw, 1.2, 0.03) && b.act === p.act)
  assert.deepEqual(cleanPos(a), a)
  assert.equal(cleanPos([LIMIT.x + 1, 0, 0, 0, 0, 0]), null)
  assert.equal(cleanPos([0, 0, 0, 256, 0, 0]), null)
  assert.equal(cleanPos([0, 0, 0, 0, 0]), null)
  assert.equal(cleanPos([0.5, 0, 0, 0, 0, 0]), null)
  assert.deepEqual(cleanCar({ id: "16/1/2:3", model: "suv", color: 0xffffff, extra: 1 }), { id: "16/1/2:3", model: "suv", color: 0xffffff })
  assert.equal(cleanCar({ id: "x<script>", model: "suv", color: 1 }), null)
  assert.equal(cleanCar({ id: "a", model: "tank", color: 1 }), null)
  // rates: standing still once every 2 s, walking 6 a second, driving 8
  const last = { t: 0, p: { x: 0, z: 0, yaw: 0, act: 0 } }
  assert.equal(shouldSend(last, { x: 0, z: 0, yaw: 0, act: 0 }, 1, false), false)
  assert.equal(shouldSend(last, { x: 0, z: 0, yaw: 0, act: 0 }, 2.1, false), true)
  assert.equal(shouldSend(last, { x: 1, z: 0, yaw: 0, act: 1 }, 0.1, false), false)
  assert.equal(shouldSend(last, { x: 1, z: 0, yaw: 0, act: 1 }, 0.13, true), true)
  const tr = createTrack()
  pushSample(tr, 1, { x: 0, z: 0, y: 0, yaw: 0, speed: 10, act: ACT.drive })
  pushSample(tr, 1.2, { x: 0, z: 2, y: 0, yaw: 0, speed: 10, act: ACT.drive })
  assert.ok(near(sampleTrack(tr, 1.1).z, 1, 1e-9))
  assert.ok(sampleTrack(tr, 1.4).z > 2, "a car glides on past the last sample")
})

test("Valencia's prebuilt tiles: present, small, and with the town in them", () => {
  const ix = JSON.parse(fs.readFileSync(path.join(PREBUILT, "index.json"), "utf8"))
  assert.equal(ix.town, "valencia")
  assert.ok(ix.bytes < 50 * 1024 * 1024, `${(ix.bytes / 1e6).toFixed(1)} MB`)
  assert.ok(ix.counts.buildings > 20000 && ix.counts.roads > 10000)
  // the Paseo Club's tile: roads, buildings, the ground's height near the town's base
  const f = townFrame(valencia.origin)
  const t = tileOf(valencia.origin[0], valencia.origin[1])
  const tile = decodeTile(JSON.parse(fs.readFileSync(path.join(PREBUILT, "16", String(t.x), `${t.y}.json`), "utf8")), f, ix.base)
  assert.ok(tile.roads.length > 20 && tile.buildings.length > 20)
  assert.ok(Math.abs(tileHeightAt(tile, 0, 0)) < 3, "the origin is the base")
  assert.ok(tile.roads.filter((r) => r.name).length > 3, "named streets")
})

// The owner's "dark bar across the sky" on Mesa Court (2026-10-09, rx7/shots/h1.png): a long dark
// band edge to edge above the houses. A band like that is a triangle with a corner far from its
// own thing (a roof's eave or soffit, a bridge deck) or ground lifted off its lattice. Every
// building, deck and ground vertex in Valencia's prebuilt tiles stays by what it belongs to.
test("nothing drawn strays into the sky: buildings, bridge decks and the ground stay by their own things", () => {
  const ix = JSON.parse(fs.readFileSync(path.join(PREBUILT, "index.json"), "utf8"))
  const f = townFrame(valencia.origin)
  let buildings = 0
  let decks = 0
  let worst = 0
  for (const x of fs.readdirSync(path.join(PREBUILT, "16")))
    for (const file of fs.readdirSync(path.join(PREBUILT, "16", x))) {
      const t = decodeTile(JSON.parse(fs.readFileSync(path.join(PREBUILT, "16", x, file), "utf8")), f, ix.base)
      const g = (px, pz) => tileHeightAt(t, Math.max(t.rect.x0, Math.min(t.rect.x1, px)), Math.max(t.rect.z0, Math.min(t.rect.z1, pz))) ?? 0
      // (the ground: every lattice point finite and real: the terrain's no-data, a raw 0, put the
      // box's north row and west column 342 m down before decodeTile filled them)
      for (let k = 0; k < (t.heights?.length || 0); k++) assert.ok(Number.isFinite(t.heights[k]) && t.heights[k] > -250, `${t.key}: a real ground height (${t.heights[k]})`)
      // (far tiles' plain blocks in every fourth tile: the same footprints)
      for (const far of (Number(x) + Number(file.split(".")[0])) % 4 ? [false] : [false, true])
        for (const b of t.buildings) {
          const P = buildingArrays([b], g, { far }).position
          if (!P.length) continue
          buildings++
          let x0 = Infinity
          let x1 = -Infinity
          let z0 = Infinity
          let z1 = -Infinity
          let lo = Infinity
          for (const p of b.ring) {
            x0 = Math.min(x0, p.x)
            x1 = Math.max(x1, p.x)
            z0 = Math.min(z0, p.z)
            z1 = Math.max(z1, p.z)
            lo = Math.min(lo, g(p.x, p.z))
          }
          const top = Math.max(...b.ring.map((p) => g(p.x, p.z))) + Math.max(b.height, 2.4) + 6
          for (let i = 0; i < P.length; i += 3) {
            const out = Math.max(x0 - P[i], P[i] - x1, z0 - P[i + 2], P[i + 2] - z1, 0)
            worst = Math.max(worst, out)
            // (a hipped roof over an L-shaped house's rectangle reaches a few metres past its corner)
            assert.ok(out < 9 && P[i + 1] < top && P[i + 1] > lo - 3, `${t.key}: a building's vertex strays (${out.toFixed(1)} m out, y ${P[i + 1].toFixed(1)})`)
          }
        }
      // (bridge decks: over their own road, never far above the ground at their ends)
      for (const r of t.roads) {
        if (!r.deck) continue
        decks++
        for (let i = 0; i < r.pts.length; i++) {
          assert.ok(Number.isFinite(r.deck[i]), `${t.key}: a finite deck`)
          // (the highest real ones: footbridges over Wiley Canyon Road and the Iron Horse Bridge, 13-17 m)
          const over = r.deck[i] - g(r.pts[i].x, r.pts[i].z)
          assert.ok(over < (FOOT.has(r.cls) ? 20 : 30) && over > -25, `${t.key}: a deck ${over.toFixed(1)} m over the ground`)
        }
      }
    }
  assert.ok(buildings > 40000 && decks > 50, `${buildings} buildings, ${decks} decks checked`)
  // (the filling itself: a no-data sample takes the mean of the nearest real ones)
  const filled = fillMissing(Float32Array.from([10, 10, 10, 10, -342, 12, 10, 14, 10]), 3, new Set([4]))
  assert.ok(Math.abs(filled[4] - 10.75) < 1e-6 && filled[0] === 10)
  assert.ok(worst < 9, `the farthest a roof reaches past its footprint's box: ${worst.toFixed(1)} m`)
})

// a town's prebuilt tiles, decoded (in its own frame)
const townTiles = (town) => {
  const dir = path.join(HERE, "..", "..", "public", "roam", town.id)
  const ix = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"))
  const f = townFrame(town.origin)
  const tiles = []
  for (const x of fs.readdirSync(path.join(dir, "16")))
    for (const file of fs.readdirSync(path.join(dir, "16", x))) tiles.push(decodeTile(JSON.parse(fs.readFileSync(path.join(dir, "16", x, file), "utf8")), f, ix.base))
  return { ix, f, tiles }
}
// every place named in the prebuilt tiles: POIs, areas' and roads' names (for the eggs test)
const mappedPlaces = (tiles) => {
  const out = []
  for (const t of tiles) {
    for (const p of t.pois) out.push({ name: p.name, pts: [p] })
    for (const r of t.roads) if (r.name) out.push({ name: r.name, pts: r.pts })
    for (const b of t.buildings) if (b.name) out.push({ name: b.name, pts: b.ring })
    for (const p of t.platforms) if (p.name) out.push({ name: p.name, pts: p.ring })
  }
  return out
}

for (const town of Object.values(TOWNS))
  test(`eggs (${town.name}): 15-25 hidden finds, each at the real mapped place it names; a car and a couple's find`, () => {
  const eggs = town.eggs
  assert.ok(eggs.length >= 15 && eggs.length <= 25, `${eggs.length} eggs`)
  assert.equal(new Set(eggs.map((e) => e.id)).size, eggs.length)
  assert.ok(eggs.some((e) => e.kind === "couple") && eggs.some((e) => e.kind === "car"))
  for (const e of eggs.filter((q) => q.kind === "car")) assert.ok(MODELS[e.model || "turbo"], `${e.id}: a car we can draw and drive`)
  const { f, tiles } = townTiles(town)
  const out = mappedPlaces(tiles)
  const spots = eggSpots(town, f)
  for (const e of spots) {
    const named = out.filter((p) => p.name === e.place)
    assert.ok(named.length, `${e.id}: "${e.place}" is on the map`)
    const d = Math.min(...named.flatMap((p) => p.pts.map((q) => Math.hypot(q.x - e.x, q.z - e.z))))
    assert.ok(d < 45, `${e.id} is ${d.toFixed(0)} m from ${e.place}`)
  }
  // every one can be walked up to: open ground (not the sea), and a clear way in from at least
  // one side
  const walls = createColliders()
  for (const t of tiles) {
    if (!spots.some((e) => e.x > t.rect.x0 - 60 && e.x < t.rect.x1 + 60 && e.z > t.rect.z0 - 60 && e.z < t.rect.z1 + 60)) continue
    walls.addTile(t.key, wallRings(t.buildings, () => 0))
  }
  for (const e of spots) {
    const t = tiles.find((q) => e.x >= q.rect.x0 && e.x < q.rect.x1 && e.z >= q.rect.z0 && e.z < q.rect.z1)
    assert.ok(t, `${e.id} is inside the prebuilt town`)
    const onDeck = tiles.some((q) => q.platforms.some((p) => deckAt(deckSurfaces([], [p]), e.x, e.z, p.h, false) !== null))
    assert.ok(!tileSeaAt(t, e.x, e.z) || onDeck, `${e.id} is on land (or out on a pier)`)
    assert.equal(walls.inside(e.x, e.z), 0, `${e.id} is outside every building`)
    let open = 0
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2
      if (walls.segment(e.x + Math.cos(a) * 15, e.z + Math.sin(a) * 15, e.x + Math.cos(a) * 1.2, e.z + Math.sin(a) * 1.2, -1e9) >= 1) open++
    }
    assert.ok(open >= 2, `${e.id}: a way in (${open} of 16 directions)`)
  }
  // taking one: close enough, not the car (found by getting in), the couple's only together
  const disk = spots.find((e) => e.kind === "disk")
  assert.equal(nearestEgg(spots, {}, disk.x + 1, disk.z)?.id, disk.id)
  assert.equal(nearestEgg(spots, { [disk.id]: 1 }, disk.x + 1, disk.z), null)
  assert.equal(nearestEgg(spots, {}, disk.x + REACH.disk + 1, disk.z), null)
  const two = spots.find((e) => e.kind === "couple")
  assert.equal(nearestEgg(spots, {}, two.x, two.z), null)
  assert.equal(nearestEgg(spots, {}, two.x, two.z, { together: () => true })?.id, two.id)
})

test("towns: each opens from its venue, shares the venue's frame, and its prebuilt tiles stay small", () => {
  assert.equal(townForVenue("paseo")?.id, "valencia")
  assert.equal(townForVenue("riverside"), null)
  for (const town of Object.values(TOWNS)) {
    assert.equal(TOWNS[town.id], town)
    const [venueId, v] = Object.entries(town.venues)[0]
    assert.equal(townForVenue(venueId)?.id, town.id, `${venueId} opens onto ${town.id}`)
    const venue = JSON.parse(fs.readFileSync(path.join(HERE, "..", "components", "applets", "pickleball", "park", "venues", `${venueId}.json`), "utf8"))
    assert.deepEqual(town.origin, venue.origin, `${town.id}: the venue's own origin`)
    const { lat, lon } = townFrame(town.origin).toLatLon(v.x, v.z)
    assert.ok(lat > town.bbox.south && lat < town.bbox.north && lon > town.bbox.west && lon < town.bbox.east, `${town.id}: the venue is in the box`)
    assert.ok(v.back && v.back.r > 0)
    const ix = JSON.parse(fs.readFileSync(path.join(HERE, "..", "..", "public", "roam", town.id, "index.json"), "utf8"))
    assert.equal(ix.town, town.id)
    // (under ~10 MB of map, plus the aerial's vegetation: at most 30% more, docs/open-world.md)
    assert.ok(ix.bytes < 11.5 * 1024 * 1024, `${town.id}: ${(ix.bytes / 1e6).toFixed(1)} MB`)
    assert.ok(ix.counts.buildings > 5000 && ix.counts.roads > 5000, `${town.id}: a whole town`)
    assert.equal(town.prebuilt, `/roam/${town.id}`, "a relative path the deployed site serves")
  }
})

test("sea: the coastline becomes water (islands land again), the ground dips under it, the shore stops you", () => {
  // a box with the coast across it, land to the north (the coast runs west to east)
  const box = { x0: 0, y0: 0, x1: 100, y1: 100 }
  const across = seaRings([[[-10, 50], [40, 55]], [[40, 55], [110, 45]]], box)
  assert.ok(inRings(across, 50, 10) && !inRings(across, 50, 90))
  // the ways joined end to start
  assert.equal(joinLines([[[0, 0], [1, 1]], [[1, 1], [2, 0]], [[5, 5], [6, 6]]]).length, 2)
  // an island in the sea (a closed ring wound counter-clockwise) is land
  const isl = seaRings([[[-10, 80], [110, 80]], [[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]], box)
  assert.ok(inRings(isl, 50, 50) && !inRings(isl, 25, 25) && !inRings(isl, 50, 90))
  // a coast that goes in and out the same side: a peninsula
  const pen = seaRings([[[60, -5], [60, 80], [40, 80], [40, -5]]], box)
  assert.ok(!inRings(pen, 50, 50) && inRings(pen, 80, 50) && inRings(pen, 50, 90))
  // no coast: all sea or all land, as told; broken data (a coast stopping mid-box): unknown
  assert.equal(seaRings([], box, { inside: () => true }).length, 1)
  assert.equal(seaRings([], box).length, 0)
  assert.equal(seaRings([[[-10, 50], [50, 50]]], box), null)
  // the town-wide sea from coastline ways
  const ts = townSea([{ type: "way", id: 1, tags: { natural: "coastline" }, geom: [[33.6, -118.1], [33.6, -117.9]] }], { south: 33.5, west: -118, north: 33.7, east: -117.95 })
  assert.equal(ts(33.55, -117.97), true)
  assert.equal(ts(33.65, -117.97), false)

  // a tile: the coast across its middle, a pier out over the sea
  const coastV = 2600
  const els = [
    way(1, { natural: "coastline" }, [[-300, coastV + 50], [4400, coastV - 50]]),
    way(2, { man_made: "pier", name: "Test Pier" }, [[2000, coastV - 300], [2000, coastV + 900]]),
    way(3, { highway: "residential", name: "Shore Drive" }, [[-100, 1500], [4200, 1500]]),
  ]
  const elevation = (lat) => (lat - B.south) * 30000 - 8 // (sloping down to the south, under 0 at the bottom)
  const raw = buildTile({ z: T.z, x: T.x, y: T.y, elements: els, elevation })
  assert.ok(raw.w?.length >= 1, "the sea is in the tile")
  const t = decodeTile(raw, frame, 0)
  assert.equal(t.seaY, 0)
  const at = (u, v) => ({ x: t.rect.x0 + (u / EXTENT) * (t.rect.x1 - t.rect.x0), z: t.rect.z0 + (v / EXTENT) * (t.rect.z1 - t.rect.z0) })
  const sea = at(1000, 3800)
  const land = at(1000, 1000)
  assert.equal(tileSeaAt(t, sea.x, sea.z), true)
  assert.equal(tileSeaAt(t, land.x, land.z), false)
  assert.ok(tileHeightAt(t, sea.x, sea.z) <= -1.5 + 1e-6, "the sea floor is under the water")
  assert.ok(tileHeightAt(t, land.x, land.z) >= 0.4 - 1e-6, "the land is above it")
  // the shore's edges are the coast only (none along the tile's clip box), and stop a walker
  assert.ok(t.shore.length >= 1)
  for (const [a, b] of t.shore) assert.ok(Math.abs(a.z - b.z) < 30, "shore edges run along the coast")
  const shore = createColliders()
  shore.addEdges(t.key, t.shore)
  const c = at(1000, coastV)
  const w = createWalker(c.x, c.z - 3, Math.PI) // (yaw pi: walking south, toward the sea)
  for (let i = 0; i < 120; i++) stepWalker(w, { x: 0, y: 1 }, 0, 1 / 30, { resolve: (x, z, r) => shore.resolve(x, z, r) })
  assert.equal(tileSeaAt(t, w.x, w.z), false, "stopped at the water's edge")
  assert.ok(shore.edges > 0)
  shore.removeTile(t.key)
  assert.equal(shore.edges, 0)
  // the pier: a deck level with the shore, out over the water
  const pier = t.roads.find((r) => r.name === "Test Pier")
  assert.ok(pier && pier.flags & F.bridge && pier.deck, "a deck")
  assert.ok(Math.max(...pier.deck) - Math.min(...pier.deck) < 0.01, "level")
  assert.ok(pier.width >= 5)
  const end = at(2000, coastV + 800)
  assert.ok(deckAt(deckSurfaces(t.roads), end.x, end.z, pier.deck[0], false) !== null, "you can stand at its far end")
  // the water mesh: triangles over the rings and a surf strip along the shore
  const m = seaArrays(t, t.seaY)
  assert.ok(m.index.length >= 6 && m.foam.some((f) => f === 1))
  for (let i = 1; i < m.position.length; i += 3) assert.ok(Math.abs(m.position[i]) < 0.1, "at sea level")
  // nesting: a hole inside an outer
  const sq = (x0, z0, s) => [{ x: x0, z: z0 }, { x: x0 + s, z: z0 }, { x: x0 + s, z: z0 + s }, { x: x0, z: z0 + s }]
  const nest = nestRings([sq(0, 0, 100), sq(20, 20, 10)])
  assert.equal(nest.length, 1)
  assert.equal(nest[0].holes.length, 1)
  // a tile out at sea (no coastline in it): all water when the town's coast says so
  const open = decodeTile(buildTile({ z: T.z, x: T.x, y: T.y, elements: [], elevation: () => -20, sea: () => true }), frame, 0)
  assert.equal(open.sea.length, 1)
  assert.equal(open.shore.length, 0, "the clip box is no shore")
  const mid = at(2048, 2048)
  assert.equal(tileSeaAt(open, mid.x, mid.z), true)
  // inland: no sea at all (Valencia's tiles are unchanged)
  const dry = buildTile({ z: T.z, x: T.x, y: T.y, elements: [els[2]], elevation })
  assert.equal(dry.w, undefined)
})

test("Newport Beach: the ocean and the harbour from the coastline, the beach, the club on land, a pier", { skip: !TOWNS.newport }, () => {
  const town = TOWNS.newport
  const { f, tiles } = townTiles(town)
  const tileAtP = (x, z) => tiles.find((q) => x >= q.rect.x0 && x < q.rect.x1 && z >= q.rect.z0 && z < q.rect.z1)
  const seaAtLL = (lat, lon) => {
    const p = f.toXZ(lat, lon)
    return tileSeaAt(tileAtP(p.x, p.z), p.x, p.z)
  }
  assert.ok(tiles.filter((t) => t.sea.length).length > 40, "plenty of ocean")
  assert.equal(seaAtLL(33.59, -117.94), true, "the ocean off the peninsula")
  assert.equal(seaAtLL(33.603, -117.895), true, "the harbour")
  assert.equal(seaAtLL(town.origin[0], town.origin[1]), false, "the club")
  assert.equal(seaAtLL(33.6115, -117.9255), false, "the peninsula")
  assert.ok(tiles.some((t) => t.areas.some((a) => a.cls === AREA.sand)), "sand beaches")
  // the Newport Pier: a level deck out over the ocean, named on the map
  const pierAt = tiles.flatMap((t) => t.pois).find((p) => p.name === "Newport Pier" && p.kind === "pier")
  assert.ok(pierAt, "the Newport Pier is on the map")
  const plat = tiles.flatMap((t) => t.platforms).find((p) => p.own && deckAt(deckSurfaces([], [p]), pierAt.x, pierAt.z, p.h, false) !== null)
  assert.ok(plat, "you can stand on it")
  assert.ok(plat.h + 34.3 > 2 && plat.h + 34.3 < 12, `the deck ${(plat.h + 34.3).toFixed(1)} m above the sea`)
  assert.equal(seaAtLL(f.toLatLon(pierAt.x, pierAt.z).lat, f.toLatLon(pierAt.x, pierAt.z).lon), true, "over the water")
  assert.ok(tiles.some((t) => t.roads.some((r) => r.deck && r.width <= 3)), "boat docks in the harbour")
})

test("tile store: static tiles for the town, the function elsewhere, a pause after a failure", async () => {
  const asked = []
  const index = { z: 16, x0: 10, x1: 11, y0: 20, y1: 21, base: 100 }
  const fetchFn = async (url) => {
    asked.push(url)
    if (url.endsWith("index.json")) return { ok: true, json: async () => index }
    if (url.includes("/api/town")) return { ok: false, status: 503 }
    const [, , , z, x, y] = url.match(/^(\/roam\/t)\/(\d+)\/(\d+)\/(\d+)\.json$/) ? [0, 0, 0, ...url.match(/(\d+)\/(\d+)\/(\d+)\.json$/).slice(1)] : []
    return { ok: true, json: async () => ({ v: 1, z: +z, x: +x, y: +y, n: [], h: null, r: [], k: [], b: [], a: [], t: [], p: [] }) }
  }
  const store = createTileStore({ town: { id: "t", prebuilt: "/roam/t" }, frame: townFrame([0, 0]), fetchFn })
  await store.ready()
  assert.equal(store.base, 100)
  store.want([{ z: 16, x: 10, y: 20 }, { z: 16, x: 99, y: 99 }])
  await new Promise((r) => setTimeout(r, 10))
  assert.ok(asked.includes("/roam/t/16/10/20.json"))
  assert.ok(asked.includes("/api/town?z=16&x=99&y=99"))
  assert.ok(store.get("16/10/20"))
  const n = asked.length
  store.want([{ z: 16, x: 99, y: 99 }])
  assert.equal(asked.length, n, "a failed tile waits before it's asked again")
})

// Vince's car (My Park's drinks-machine easter egg): a real model everywhere, in its stall
test("the Sundowner GT: a model of its own, parked in a stall by the Paseo Club, clear of buildings and lanes", () => {
  const k = valencia.keyCar
  assert.ok(k && k.model === "sundowner")
  assert.ok(CAR_SPECS.sundowner && MODELS.sundowner && MODEL_LIST.includes("sundowner"))
  assert.ok(MODELS.sundowner.top > MODELS.sedan.top, "quicker than the town's cars")
  const parts = carParts("sundowner")
  assert.ok(parts.paint.position.length > 1000)
  // in its stall: no building, no road's lanes, near where you come out of the Paseo Club
  const ix = JSON.parse(fs.readFileSync(path.join(PREBUILT, "index.json"), "utf8"))
  const f = townFrame(valencia.origin)
  const exit = valencia.venues.paseo
  assert.ok(Math.hypot(k.x - exit.x, k.z - exit.z) < 30, "by the way out")
  for (const t of tilesAround(f, k.x, k.z, 60)) {
    const file = path.join(PREBUILT, "16", String(t.x), `${t.y}.json`)
    if (!fs.existsSync(file)) continue
    const d = decodeTile(JSON.parse(fs.readFileSync(file, "utf8")), f, ix.base)
    for (const b of d.buildings) {
      let inside = false
      for (let i = 0, j = b.ring.length - 1; i < b.ring.length; j = i++) if (b.ring[i].z > k.z !== b.ring[j].z > k.z && k.x < ((b.ring[j].x - b.ring[i].x) * (k.z - b.ring[i].z)) / (b.ring[j].z - b.ring[i].z) + b.ring[i].x) inside = !inside
      assert.ok(!inside, "not in a building")
    }
    for (const r of d.roads) {
      if (r.cls !== ROAD.residential && r.cls !== ROAD.primary && r.cls !== ROAD.secondary && r.cls !== ROAD.tertiary) continue
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const a = r.pts[i]
        const b = r.pts[i + 1]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const q = Math.max(0, Math.min(1, ((k.x - a.x) * dx + (k.z - a.z) * dz) / (dx * dx + dz * dz || 1)))
        assert.ok(Math.hypot(k.x - a.x - dx * q, k.z - a.z - dz * q) > r.width / 2 + 1, "off the street's lanes")
      }
    }
  }
})
