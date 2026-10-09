// Roam: an open town to walk and drive round (docs/open-world.md). Any town works by
// configuration (towns/); Valencia is the first. This module is the whole 3D world and knows
// nothing about 98ish: everything from the outside (the figures, the sky, the network, saved
// finds, names) comes in through `host` (host98.js is 98ish's; a standalone app would bring
// its own). It speaks the engine-world interface Pickleball 98's engine draws (scene, camera,
// frame(dt), resize, key, setStick, drag, clearKeys, refigure, dispose), so it can also run in
// any three.js loop.
//
// - the town streams round you in z16 tiles (stream.js): near tiles in full (painted ground,
//   buildings with roof hints, lane markings, bridge decks, trees, parked cars, walls you
//   collide with), far tiles as ground and plain blocks, then fog;
// - you walk (sim/walker.js) with a follow camera you turn by dragging; Sprint runs;
// - parked cars (sim/parked.js) you can get into and drive (sim/car.js) with a chase camera;
//   a car stays where you leave it; a friend can ride along;
// - other people in the same town, walking and driving (sim/sync.js, server/roam);
// - hidden finds at real places (eggs.js);
// - realism (docs/open-world.md): textured buildings with windows, lawns and lots, the venues'
//   trees, sun shadows round you, real-proportioned cars (render/carmodel.js) with a chase
//   camera (sim/chase.js), a little traffic and a few people walking (sim/traffic.js,
//   sim/peds.js), the map's signals, stop signs and lamps and the lights at night
//   (render/street.js), a minimap, a horn and a radio.

import * as THREE from "three"
import { TILE_ZOOM, tileKey, tileOf, tilesAround, townFrame } from "./geo.js"
import { DRIVABLE, ROAD, tileHeightAt, tileSeaAt } from "./data/tile.js"
import { createTileStore } from "./stream.js"
import { buildTileMesh, disposeMaterials, roamLight, setRoamSurfaces } from "./render/tilemesh.js"
import { treeSpots } from "./render/ground.js"
import { deckAt, deckSurfaces } from "./render/linework.js"
import { wallRings } from "./render/buildings.js"
import { createParkedLayer, lampUniforms, makeCarMesh, setCarEnvironment } from "./render/cars.js"
import { createChase, stepChase } from "./sim/chase.js"
import { createColliders } from "./sim/collide.js"
import { createWalker, stepWalker } from "./sim/walker.js"
import { MODELS, createCar, doorSpot, isTwo, personAhead, stepCar, steerLimit, stickToRide } from "./sim/car.js"
import { parkedCars } from "./sim/parked.js"
import { ACT, createTrack, packPos, pushSample, sampleTrack, shouldSend, unpackPos, DELAY } from "./sim/sync.js"
import { createEggs } from "./eggs.js"
import { createTreeLayer } from "./render/trees.js"
import { along, createTraffic, projectOn, roadLength, trafficRoad } from "./sim/traffic.js"
import { createPeds, shopSpots, walkLines } from "./sim/peds.js"
import { createStreetLayer, streetFurniture } from "./render/street.js"
import { seaUniforms } from "./render/sea.js"
import { tableSpots } from "./sim/tables.js"
import { createCrowdLayer } from "./render/crowd.js"
import { fleetSpots, FLEET } from "./sim/fleet.js"
import { createFleetLayer } from "./render/vehicles.js"
import { decodeGraph, nextStep, onRoute, pointAt, route, snap, stepText } from "./nav/route.js"
import { BUS, TRAIN, at, lineLabel, loadTransit, nearestOnLine, nextAt, stopsNear, tripAt, tripPose, vehiclesNear } from "./sim/transit.js"
import { createRouteLine, createTransitLayer } from "./render/transit.js"
import { DRIVERS, RIDE_KINDS, createTrip, skipTrip, stepTrip, tripPoseAt, tripTimeLeft } from "./sim/ride.js"

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

export const createRoam = ({ town, host = {}, phone = false, quality = "medium", start = null, labelsEl = null, onHud = () => {}, onEvent = () => {} } = {}) => {
  const frame = townFrame(town.origin)
  const store = createTileStore({ town, frame, fetchFn: host.fetch })
  const scene = new THREE.Scene()
  const low = quality === "low"
  // (the host's surface textures for walls, roofs and ground: before any tile's material is made)
  if (!low) setRoamSurfaces(host.surface)
  // (how far the town is drawn: near tiles in full, far tiles as blocks; fog hides the edge)
  const NEAR_R = phone ? 380 : 560
  const FAR_R = low ? 700 : phone ? 900 : 1500
  const camera = new THREE.PerspectiveCamera(phone ? 62 : 58, 1, 0.35, FAR_R + 400)
  scene.fog = new THREE.Fog(0xd8ecfb, FAR_R * 0.45, FAR_R * 0.98)
  const hemi = new THREE.HemisphereLight(0xdcefff, 0x6d6a4c, 1.3)
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.4)
  sun.position.set(-0.4, 0.8, 0.3)
  scene.add(hemi, sun, sun.target)
  // sun shadows in a box round you (buildings, trees, parked cars; Medium/High), drawn again
  // only when the box moves or the light changes: the town is static (docs/open-world.md)
  const sunDir = new THREE.Vector3(-0.4, 0.8, 0.3).normalize()
  const SHADOW_R = phone ? 75 : 120
  const shadowAt = { x: Infinity, z: Infinity, dirty: true, frames: 0, t: 0, n: 0 }
  if (!low) {
    sun.castShadow = true
    sun.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048)
    const sc = sun.shadow.camera
    sc.left = sc.bottom = -SHADOW_R
    sc.right = sc.top = SHADOW_R
    sc.near = 1
    sc.far = 900
    sc.updateProjectionMatrix()
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.35
    sun.shadow.autoUpdate = false
  }
  const stepShadow = () => {
    if (low) {
      if (shadowAt.dirty) sun.position.copy(sunDir)
      shadowAt.dirty = false
      return
    }
    const c = center()
    // (a fresh map is drawn on a few frames in a row after a change, and again every couple of
    // seconds: a single redraw was sometimes lost in the browsers tested)
    if (shadowAt.frames > 0) {
      shadowAt.frames--
      sun.shadow.needsUpdate = true
    }
    if (clock - shadowAt.t > 2.5) shadowAt.dirty = true
    if (!shadowAt.dirty && Math.hypot(c.x - shadowAt.x, c.z - shadowAt.z) < 8) return
    // (snapped to the map's texels, so standing still the edges don't crawl)
    const texel = (SHADOW_R * 2) / sun.shadow.mapSize.x
    const x = Math.round(c.x / texel) * texel
    const z = Math.round(c.z / texel) * texel
    const y = heightAt(c.x, c.z, 0) ?? 0
    sun.target.position.set(x, y, z)
    sun.position.set(x + sunDir.x * 400, y + sunDir.y * 400, z + sunDir.z * 400)
    sun.target.updateMatrixWorld()
    sun.updateMatrixWorld()
    sun.shadow.needsUpdate = true
    shadowAt.frames = 2
    shadowAt.x = c.x
    shadowAt.z = c.z
    shadowAt.dirty = false
    shadowAt.n++
    shadowAt.t = clock
  }
  let exposure = 1
  let size = { width: 1, height: 1 }
  let disposed = false
  let suspended = false
  let clock = 0

  // ---------- the sky (Real Sky through the host; a plain colour otherwise) ----------
  const place = { lat: town.origin[0], lon: town.origin[1] }
  const sky = host.sky?.create ? host.sky.create({ radius: FAR_R + 250, quality, phone }) : null
  if (sky?.mesh) scene.add(sky.mesh)
  let skyAt = -1e9
  let look = null
  let hourOverride = null // (tests: a fixed hour)
  const applyLook = () => {
    const d = host.sky?.look ? host.sky.look(place, { hour: hourOverride }) : null
    if (!d) {
      scene.background = new THREE.Color(0x9cc8ef)
      return
    }
    look = d
    sky?.setLook?.(d)
    if (!sky) scene.background = new THREE.Color(d.sky[0])
    // (a warmer Southern California sun in the day: the owner asked for "more vibrant")
    const dayK = d.sunEl !== undefined ? Math.max(0, Math.min(1, (d.sunEl - 2) / 12)) : 1
    sun.color.setHex(d.sun.color).lerp(new THREE.Color(0xffdcae), 0.22 * dayK)
    sun.intensity = d.sun.intensity * (1 + 0.06 * dayK)
    sunDir.set(d.sun.dir.x, Math.max(0.12, d.sun.dir.y), d.sun.dir.z).normalize()
    shadowAt.dirty = true
    hemi.color.setHex(d.hemi[0])
    // (light bounced off a town is pavement and stucco, not a lawn: warmer and greyer than a
    // park's, so walls in shade don't turn green)
    hemi.groundColor.setHex(d.hemi[1]).lerp(new THREE.Color(0x8a7f6e), 0.65)
    hemi.intensity = d.hemi[2]
    scene.fog.color.setHex(d.fog)
    if (sky) scene.background = scene.fog.color
    // (a little under the venues': a town of pale stucco and concrete in full sun reads washed out
    // at a court's exposure)
    exposure = (d.exposure ?? 1) * (low ? 1 : 0.9)
    // night (0 day .. 1 night): lamps on, reflections dim
    night = d.sunEl !== undefined ? Math.max(0, Math.min(1, (4 - d.sunEl) / 10)) : d.lights ? 1 : 0
    lampUniforms.head.value = lampUniforms.tail.value = night
    roamLight.night.value = night
    roamLight.sky.value.setHex(d.sky[1]).lerp(new THREE.Color(d.sky[0]), 0.35)
    // (the sea: the same sky and sun)
    seaUniforms.seaSky.value.copy(roamLight.sky.value)
    seaUniforms.seaSunColor.value.setHex(d.sun.color)
    seaUniforms.seaSunDir.value.copy(sunDir)
    seaUniforms.seaNight.value = night
    setCarEnvironment(envTex, 0.2 + 0.8 * (1 - night))
  }
  // the sky the cars' paint and glass reflect (the host's HDRI; none on Low)
  let envTex = null
  let night = 0
  if (!low && host.environment)
    host
      .environment()
      .then((t) => {
        if (disposed || !t) return
        envTex = t
        setCarEnvironment(envTex, 0.2 + 0.8 * (1 - night))
      })
      .catch(() => {})
  const stepSky = () => {
    if (clock - skyAt < 60) return
    skyAt = clock
    applyLook()
  }

  // ---------- the town's tiles ----------
  const tiles = new Map() // key -> { t (decoded), mesh, near, decks, trees, cars, walls }
  const colliders = createColliders()
  // the shore (a coast town): you walk and drive up to the water's edge, not into the sea;
  // out on a pier's deck you're above it (and its railings keep you on it)
  const shoreCol = createColliders()
  const parkedLayer = createParkedLayer(scene, phone ? 120 : 220)
  const fleetLayer = createFleetLayer(scene, { cap: phone ? 30 : 60 })
  const trees = createTreeLayer(scene, { cap: low ? 0 : phone ? 3200 : 7000, kit: low ? null : host.trees?.() || null, nearCap: phone ? 260 : 700 })
  const TREE_NEAR = phone ? 150 : 240
  let treesAt = null
  const moved = new Map() // parked car id -> { x, z, yaw } (left somewhere else this session) | "gone"
  let tilesDirty = true
  let tilesDirtyForShadow = true
  let wantT = 0
  let lastCenter = null
  let wanted = { near: new Set(), far: new Set(), list: [] }

  // the decoded tile at a point (or null)
  const tileAtCache = { key: "", t: null }
  const tileAt = (x, z) => {
    const ll = frame.toLatLon(x, z)
    const k = tileKey(tileOf(ll.lat, ll.lon, TILE_ZOOM))
    if (tileAtCache.key === k && tileAtCache.t) return tileAtCache.t
    const t = store.get(k)
    tileAtCache.key = k
    tileAtCache.t = t
    return t
  }
  const groundAt = (x, z) => {
    const t = tileAt(x, z)
    if (!t) return null
    return tileHeightAt(t, x, z)
  }
  // the height to stand or drive at near height y (a bridge deck, or the ground)
  const heightAt = (x, z, y = 0, drive = false) => {
    const t = tileAt(x, z)
    if (!t) return null
    const g = tileHeightAt(t, x, z)
    const e = tiles.get(t.key)
    const d = e?.decks?.length ? deckAt(e.decks, x, z, y, drive) : null
    return d !== null && d > (g ?? -1e9) ? d : g
  }
  // a tile's own ground (clamped inside it): for building its meshes
  const ownGround = (t) => {
    // (on a pier's deck: what stands on it stands on the deck, not the sea floor)
    const plats = t.platforms?.length ? deckSurfaces([], t.platforms) : null
    return (x, z) => {
      const r = t.rect
      const g = tileHeightAt(t, Math.max(r.x0, Math.min(r.x1, x)), Math.max(r.z0, Math.min(r.z1, z))) ?? 0
      if (!plats) return g
      let top = g
      for (const p of plats) if (p.h > top && deckAt([p], x, z, p.h, false) !== null) top = p.h
      return top
    }
  }

  const parkedList = () => {
    const out = []
    for (const e of tiles.values()) if (e.near && e.cars) for (const c of e.cars) {
      const m = moved.get(c.id)
      if (m === "gone") continue
      out.push(m ? { ...c, ...m } : c)
    }
    // (the hidden car, and Vince's: parked like the rest once its tile is near)
    for (const c of [...eggCars, ...keyCars]) {
      const m = moved.get(c.id)
      if (m === "gone") continue
      const p = m ? { ...c, ...m } : c
      const r = tiles.get(tileKey(tileOf(frame.toLatLon(p.x, p.z).lat, frame.toLatLon(p.x, p.z).lon, TILE_ZOOM)))
      if (r?.near) out.push(p)
    }
    // (a car someone flagged down for you: its driver left it with the keys in)
    for (const c of handed) {
      const m = moved.get(c.id)
      if (m === "gone") continue
      out.push(m ? { ...c, ...m } : c)
    }
    return out
  }
  const handed = []
  // the dockless bikes and scooters near you (sim/fleet.js), where they were left
  const fleetList = () => {
    const out = []
    for (const e of tiles.values())
      if (e.near && e.fleet)
        for (const f of e.fleet) {
          const m = moved.get(f.id)
          if (m === "gone") continue
          out.push(m ? { ...f, ...m, y: groundAt(m.x, m.z) ?? f.y } : f)
        }
    return out
  }
  const refreshFleet = () => fleetLayer.set(fleetList().filter((f) => !driving || f.id !== car?.id))
  const placeCar = (c) => {
    const y = groundAt(c.x, c.z) ?? 0
    const m = MODELS[c.model] || MODELS.sedan
    const fx = Math.sin(c.yaw)
    const fz = Math.cos(c.yaw)
    const hf = groundAt(c.x + fx * m.wheelbase / 2, c.z + fz * m.wheelbase / 2) ?? y
    const hb = groundAt(c.x - fx * m.wheelbase / 2, c.z - fz * m.wheelbase / 2) ?? y
    return { ...c, y, pitch: Math.atan2(hf - hb, m.wheelbase), roll: 0 }
  }
  // (the nearest ones drawn: a parked car 200 m off is a few pixels; phone 70, desktop 160)
  const PARKED_DRAW = phone ? 70 : 160
  const refreshParked = () => {
    const c = center()
    const list = parkedList().filter((p) => !driving || p.id !== car?.id)
    for (const p of list) p.d2 = (p.x - c.x) ** 2 + (p.z - c.z) ** 2
    list.sort((a, b) => a.d2 - b.d2)
    parkedLayer.set(list.slice(0, PARKED_DRAW).map(placeCar))
    refreshFleet()
  }

  const buildTile = (t, near) => {
    const old = tiles.get(t.key)
    if (old) {
      old.mesh.dispose()
      if (old.near) {
        colliders.removeTile(t.key)
        shoreCol.removeTile(t.key)
      }
    }
    const g = ownGround(t)
    const mesh = buildTileMesh(t, g, { near, texSize: near ? (phone ? 512 : 1024) : phone ? 128 : 256, anisotropy: host.anisotropy || 1 })
    scene.add(mesh.group)
    const e = { t, mesh, near, decks: deckSurfaces(t.roads, t.platforms), trees: near || !phone ? treeSpots(t, { max: near ? 1400 : phone ? 0 : 400 }).map((p) => ({ ...p, y: g(p.x, p.z) })) : [], cars: near ? parkedCars(t) : null, street: near ? streetFurniture(t).map((p) => ({ ...p, y: g(p.x, p.z) })) : [], fleet: near ? fleetSpots(t).map((f) => ({ ...f, y: g(f.x, f.z) })) : [], tables: near && !low ? tableSpots(t).map((tb) => ({ ...tb, y: g(tb.x, tb.z), chairs: tb.chairs.map((c) => ({ ...c, y: g(c.x, c.z) })) })) : [] }
    if (near) colliders.addTile(t.key, wallRings(t.buildings, g))
    if (near && t.shore?.length) shoreCol.addEdges(t.key, t.shore)
    tiles.set(t.key, e)
    tilesDirty = true
    tilesDirtyForShadow = true
    return e
  }
  const dropTile = (key) => {
    const e = tiles.get(key)
    if (!e) return
    e.mesh.dispose()
    if (e.near) {
      colliders.removeTile(key)
      shoreCol.removeTile(key)
    }
    tiles.delete(key)
    tilesDirty = true
  }
  const center = () => {
    if (driving && car) return { x: car.x, z: car.z }
    const tp = onTransit && transitPose()
    return tp ? { x: tp.x, z: tp.z } : { x: me.walker.x, z: me.walker.z }
  }
  const stepTiles = (dt) => {
    wantT -= dt
    const c = center()
    if (wantT <= 0 || !lastCenter || Math.hypot(c.x - lastCenter.x, c.z - lastCenter.z) > 40) {
      wantT = 0.5
      lastCenter = c
      // (looking ahead when driving: the tiles in front come first)
      const ahead = driving && car ? { x: c.x + Math.sin(car.yaw) * Math.min(250, Math.abs(car.speed) * 6), z: c.z + Math.cos(car.yaw) * Math.min(250, Math.abs(car.speed) * 6) } : c
      const near = tilesAround(frame, c.x, c.z, NEAR_R)
      const far = tilesAround(frame, ahead.x, ahead.z, FAR_R)
      wanted = { near: new Set(near.map(tileKey)), far: new Set(far.map(tileKey)), list: [...near, ...far.filter((t) => !near.some((n) => n.x === t.x && n.y === t.y))] }
      store.want(wanted.list)
      // gone too far: drop (with room to spare, so a tile on the edge doesn't flicker)
      const keepR = FAR_R + 250
      for (const [k, e] of tiles) {
        const r = e.t.rect
        const d = Math.hypot(Math.max(r.x0 - c.x, 0, c.x - r.x1), Math.max(r.z0 - c.z, 0, c.z - r.z1))
        if (d > keepR) dropTile(k)
        else if (e.near && d > NEAR_R + 160) buildQueue.add(k) // (rebuild as far)
      }
    }
    // build one tile a frame (two when there's nothing near yet): near ones first, nearest first
    let budget = tiles.size < 3 ? 2 : 1
    for (const t of wanted.list) {
      if (budget <= 0) break
      const k = tileKey(t)
      const d = store.get(k)
      if (!d) continue
      const want = wanted.near.has(k)
      const e = tiles.get(k)
      if (e && e.near === want) continue
      if (e && e.near && !want && !buildQueue.has(k)) continue
      buildTile(d, want)
      buildQueue.delete(k)
      budget--
    }
    const cc = center()
    if (tilesDirty || !treesAt || Math.hypot(cc.x - treesAt.x, cc.z - treesAt.z) > 50) {
      if (tilesDirty) {
        refreshLife()
        streetLayer.set([...tiles.values()].flatMap((e) => e.street || []))
      }
      tilesDirty = false
      refreshParked()
      treesAt = { x: cc.x, z: cc.z }
      // (the venues' trees near you, plain ones farther off)
      const r2 = TREE_NEAR * TREE_NEAR
      const tl = [...tiles.values()].flatMap((e) => e.trees)
      for (const t of tl) t.d2 = (t.x - cc.x) ** 2 + (t.z - cc.z) ** 2
      tl.sort((a, b) => a.d2 - b.d2)
      trees.set(tl, (t) => t.d2 < r2)
      // (café tables near you, nearest first)
      const tb = [...tiles.values()].flatMap((e) => e.tables || []).filter((t) => (t.x - cc.x) ** 2 + (t.z - cc.z) ** 2 < 130 * 130)
      tb.sort((a, b) => (a.x - cc.x) ** 2 + (a.z - cc.z) ** 2 - ((b.x - cc.x) ** 2 + (b.z - cc.z) ** 2))
      crowd.set(tb)
      busyNow(cc)
    }
  }
  const buildQueue = new Set()

  // ---------- life: a little traffic, a few people walking near the shops ----------
  const traffic = createTraffic({ cap: low ? 3 : phone ? 6 : 14, seed: (Date.now() & 0xffff) + 1 })
  const trafficLayer = createParkedLayer(scene, phone ? 10 : 18)
  const peds = createPeds({ cap: low ? 0 : phone ? 3 : 6, seed: (Date.now() & 0xffff) + 7 })
  const pedFigs = new Map() // id -> fig
  // people sitting out at the cafés' tables (sim/tables.js; not on Low)
  const crowd = low ? { set() {}, dispose() {}, count: 0 } : createCrowdLayer(scene, { cap: phone ? 40 : 80, shadows: true })
  // round the shops (a mall, a main street): a few more people about and a little more traffic
  const LIFE = { peds: low ? 0 : phone ? 3 : 6, traffic: low ? 3 : phone ? 6 : 14, busyPeds: low ? 0 : phone ? 5 : 9, busyTraffic: low ? 3 : phone ? 8 : 16 }
  let busy = false
  let devLifeSet = false
  const busyNow = (c) => {
    let n = 0
    for (const e of tiles.values()) {
      if (!e.near) continue
      const rc = e.t.rect
      if (Math.hypot(Math.max(rc.x0 - c.x, 0, c.x - rc.x1), Math.max(rc.z0 - c.z, 0, c.z - rc.z1)) > 250) continue
      e.shops ||= shopSpots(e.t)
      for (const sp of e.shops) if (Math.hypot(sp.x - c.x, sp.z - c.z) < 250) n++
    }
    busy = n >= 12
    if (!devLifeSet) {
      peds.cap = busy ? LIFE.busyPeds : LIFE.peds
      traffic.cap = busy ? LIFE.busyTraffic : LIFE.traffic
    }
  }
  const PED_SEE = phone ? 75 : 120
  let lifeTick = 0
  const life = { roads: [], lines: [], street: [], time: 0 }
  // (the roads, walks and stop/signal nodes of the near tiles: when tiles change)
  const refreshLife = () => {
    const roads = []
    const lines = []
    for (const e of tiles.values()) {
      if (!e.near) continue
      for (const r of e.t.roads) {
        if (!r._street) r._street = e.t.street || []
        if (trafficRoad(r)) roads.push(r)
      }
      const shops = shopSpots(e.t)
      for (const l of walkLines(e.t.roads)) {
        // (near a shop: any point of the walk within 60 m of one)
        l.shop = shops.some((sh) => l.road.pts.some((q) => Math.hypot(q.x - sh.x, q.z - sh.z) < 60 + sh.r))
        lines.push(l)
      }
    }
    life.roads = roads
    life.lines = lines
  }
  // where people are, for the traffic to stop for and the walkers to wait for
  const peopleNow = () => {
    const out = []
    if (driving && car) out.push({ x: car.x, z: car.z, car: true }, { x: car.x + Math.sin(car.yaw) * 1.6, z: car.z + Math.cos(car.yaw) * 1.6, car: true }, { x: car.x - Math.sin(car.yaw) * 1.6, z: car.z - Math.cos(car.yaw) * 1.6, car: true })
    else if (!riding) out.push({ x: me.walker.x, z: me.walker.z })
    for (const r of remotes.values()) out.push({ x: r.x, z: r.z, car: !!(r.act & ACT.drive) })
    return out
  }
  // the sea under a point (a coast town)?
  const seaAt = (x, z) => {
    const t = tileAt(x, z)
    return !!t && tileSeaAt(t, x, z)
  }
  const deckUnder = (x, z, y) => {
    const t = tileAt(x, z)
    const e = t && tiles.get(t.key)
    return !!e?.decks?.length && deckAt(e.decks, x, z, y, false) !== null
  }
  // on foot: the walls and traffic, then the shore
  const resolveFoot = (x, z, r) => {
    const p = resolveWithTraffic(x, z, r)
    if (!town.coast) return p
    const w = me.walker
    if (deckUnder(w.x, w.z, w.y)) {
      // (on a pier: never off its side into the water)
      if (seaAt(p.x, p.z) && !deckUnder(p.x, p.z, w.y)) return { x: w.x, z: w.z, hit: true, nx: 0, nz: 0 }
      return p
    }
    const q = shoreCol.resolve(p.x, p.z, r)
    if (seaAt(q.x, q.z) && !seaAt(w.x, w.z) && !deckUnder(q.x, q.z, w.y)) return { x: w.x, z: w.z, hit: true, nx: 0, nz: 0 }
    return q.hit ? q : p
  }
  // driving: the walls and traffic, then the shore
  const resolveCar = (x, z, r) => {
    const p = resolveWithTraffic(x, z, r)
    if (!town.coast) return p
    const q = shoreCol.resolve(p.x, p.z, r)
    return q.hit ? { x: q.x, z: q.z, hit: true, nx: q.nx, nz: q.nz } : p
  }
  // the traffic as something to bump into (your car and you): colliders plus the cars' circles
  const resolveWithTraffic = (x, z, r) => {
    const p = colliders.resolve(x, z, r)
    let px = p.x
    let pz = p.z
    let hit = p.hit
    let nx = p.nx || 0
    let nz = p.nz || 0
    for (const c of traffic.solids()) {
      const dx = px - c.x
      const dz = pz - c.z
      const d = Math.hypot(dx, dz)
      const min = r + c.r
      if (d < min && d > 1e-6) {
        px = c.x + (dx / d) * min
        pz = c.z + (dz / d) * min
        nx = dx / d
        nz = dz / d
        hit = true
      }
    }
    return { x: px, z: pz, hit, nx, nz }
  }
  // the map's signals, stop signs and lamps; the lights at night
  const streetLayer = createStreetLayer(scene, { cap: phone ? 260 : 500 })
  const drawLights = () => {
    const cars = []
    const glowR2 = (phone ? 160 : 260) ** 2
    const cp = camera.position
    for (const t of traffic.cars) if ((t.x - cp.x) ** 2 + (t.z - cp.z) ** 2 < glowR2) cars.push({ x: t.x, y: heightAt(t.x, t.z, 0, true) ?? 0, z: t.z, yaw: t.yaw, len: (MODELS[t.model] || MODELS.sedan).len, wid: (MODELS[t.model] || MODELS.sedan).wid })
    if (driving && car) cars.push({ x: car.x, y: car.y, z: car.z, yaw: car.yaw, len: (MODELS[car.model] || MODELS.sedan).len, wid: (MODELS[car.model] || MODELS.sedan).wid, beam: true })
    for (const r of remotes.values()) if (r.act & ACT.drive && r.car) cars.push({ x: r.x, y: r.y || 0, z: r.z, yaw: r.yaw, len: (MODELS[r.car.model] || MODELS.sedan).len, wid: (MODELS[r.car.model] || MODELS.sedan).wid })
    streetLayer.update(clock, night, camera, cars)
  }
  const stepLife = (dt) => {
    life.time = clock
    const c = center()
    const people = peopleNow()
    life.people = people
    traffic.step(life, c, dt)
    peds.step({ lines: life.lines, people: [...people, ...traffic.cars.map((t) => ({ x: t.x, z: t.z }))] }, c, dt)
  }
  const drawLife = (dt) => {
    trafficLayer.set(
      traffic.cars.map((t) => {
        const y = heightAt(t.x, t.z, 0, true) ?? 0
        const m = MODELS[t.model] || MODELS.sedan
        const fx = Math.sin(t.yaw) * (m.wheelbase / 2)
        const fz = Math.cos(t.yaw) * (m.wheelbase / 2)
        const hf = groundAt(t.x + fx, t.z + fz) ?? y
        const hb = groundAt(t.x - fx, t.z - fz) ?? y
        return { model: t.model, color: t.color, x: t.x, y, z: t.z, yaw: t.yaw, pitch: Math.atan2(hf - hb, m.wheelbase) }
      })
    )
    const seen = new Set()
    // (people walking by: a figure only within sight, animated every other frame on a phone)
    lifeTick++
    const animNow = !phone || lifeTick % 2 === 0
    const camP = camera.position
    for (const p of peds.peds) {
      if (Math.hypot(p.x - camP.x, p.z - camP.z) > PED_SEE) continue
      seen.add(p.id)
      let fig = pedFigs.get(p.id)
      if (!fig && host.figure) {
        fig = host.figure(host.npcLook ? host.npcLook(p.id + ":" + Math.round(p.s)) : {}, { lite: true })
        if (fig) {
          scene.add(fig.group)
          pedFigs.set(p.id, fig)
        }
      }
      if (!fig) continue
      fig.dtAcc = (fig.dtAcc || 0) + dt
      if (!animNow) continue
      const y = heightAt(p.x, p.z, 0) ?? 0
      fig.update({ x: p.x, y, z: p.z, yaw: p.yaw, vx: Math.sin(p.yaw) * p.speed, vz: Math.cos(p.yaw) * p.speed, speed: p.speed }, fig.dtAcc)
      fig.dtAcc = 0
    }
    for (const [id, fig] of pedFigs)
      if (!seen.has(id)) {
        fig.dispose()
        pedFigs.delete(id)
      }
  }

  // ---------- you ----------
  const sp = start || town.spawn || { x: 0, z: 0, yaw: 0 }
  const me = { name: host.me?.name || "You", look: host.me?.look || null, walker: createWalker(sp.x, sp.z, sp.yaw ?? 0), x: sp.x, z: sp.z, y: 0, yaw: sp.yaw ?? 0 }
  let driving = false
  let radioOn = false
  const audio = host.audio || null
  let riding = null // { num } the friend whose car you're in
  let car = null // the car you're driving (sim/car.js)
  let carMesh = null
  const input = { x: 0, y: 0, sprint: false, gas: 0, brake: 0, steer: 0 }
  // the stick's frame: the camera's heading when the thumb went down. The camera may come round
  // behind you while you walk; the way you push keeps meaning the same way on the ground, so a
  // diagonal push walks a straight line instead of curling round as the camera follows (owner,
  // 2026-10-09: "he doesn't go the direction I'm pointing"). A look drag turns it with the camera.
  let moveRef = null
  const keys = new Set()
  const cam = { yaw: wrap((sp.yaw ?? 0) + 0), pitch: 0.3, dist: phone ? 5.2 : 4.6, pos: null, look: new THREE.Vector3(), behindT: 0 }

  // figures (the host makes them: an athlete in 98ish)
  const figs = new Map() // key -> { fig, look }
  const figFor = (key, look) => {
    const f = figs.get(key)
    if (f && f.look === look) return f.fig
    if (f) {
      f.fig.dispose()
      figs.delete(key)
    }
    if (!host.figure) return null
    const fig = host.figure(look || {})
    if (!fig) return null
    scene.add(fig.group)
    figs.set(key, { fig, look })
    return fig
  }
  const dropFig = (key) => {
    const f = figs.get(key)
    if (!f) return
    f.fig.dispose()
    figs.delete(key)
  }

  // ---------- the hidden finds ----------
  // (what an egg stands on: the ground, or a pier's deck)
  const topAt = (x, z) => {
    const g = groundAt(x, z)
    if (g === null) return null
    const t = tileAt(x, z)
    const e = t && tiles.get(t.key)
    let top = g
    for (const d of e?.decks || []) if (d.ring && d.h > top && deckAt([d], x, z, d.h, false) !== null) top = d.h
    return top
  }
  const eggs = createEggs({ town, frame, scene, host, groundAt: topAt, onFound: (egg) => onEvent({ type: "found", egg }) })
  eggs.setTogether((e) => togetherAt(e))
  const eggCars = eggs.cars()
  // Vince's car (My Park's drinks-machine easter egg, unlocked by his keys through the host): the
  // Sundowner GT in its stall by the venue it belongs to (town.keyCar)
  const keyCars = town.keyCar && host.unlocks?.()?.[town.keyCar.id] ? [{ id: `keys:${town.keyCar.id}`, model: town.keyCar.model, color: town.keyCar.color, x: town.keyCar.x, z: town.keyCar.z, yaw: town.keyCar.yaw, keyCar: true, label: "The Sundowner GT" }] : []

  // ---------- other people (online) ----------
  let net = null
  let myNum = null
  let netInfo = null
  const remotes = new Map() // num -> { num, name, look, track, car, carMesh, seat, x, z, y, yaw, speed, act }
  let lastSent = null
  const netClock = { offset: null }
  const addRemote = (p) => {
    if (!p || p.num === myNum) return
    const r = remotes.get(p.num) || { num: p.num, track: createTrack(), x: 0, z: 0, y: 0, yaw: 0, speed: 0, act: 0, car: null, carMesh: null }
    r.name = String(p.name || "Guest").slice(0, 40)
    r.look = p.look || null
    if (p.pos) {
      const q = unpackPos(p.pos)
      if (q) Object.assign(r, q)
    }
    setRemoteCar(r, p.car || null)
    remotes.set(p.num, r)
  }
  const setRemoteCar = (r, c) => {
    if (r.carMesh && (!c || c.seat === 1 || r.car?.id !== c.id || r.car?.model !== c.model)) {
      r.carMesh.dispose()
      r.carMesh = null
    }
    r.car = c
    if (c && c.seat !== 1 && !r.carMesh && c.model !== "train") {
      r.carMesh = makeCarMesh(c.model, c.color)
      scene.add(r.carMesh.group)
    }
    // (a parked car someone took is no longer parked)
    if (c && c.seat !== 1 && c.id) moved.set(c.id, "gone")
    tilesDirty = true
  }
  const dropRemote = (num) => {
    const r = remotes.get(num)
    if (!r) return
    r.carMesh?.dispose()
    dropFig(`r${num}`)
    remotes.delete(num)
    if (riding?.num === num) getOut()
  }
  const stepRemotes = () => {
    const now = performance.now() / 1000
    const t = netClock.offset === null ? null : now + netClock.offset - DELAY
    for (const r of remotes.values()) {
      const p = t !== null ? sampleTrack(r.track, t) : null
      if (p) Object.assign(r, { x: p.x, z: p.z, y: p.y, yaw: p.yaw, speed: p.speed, act: p.act })
    }
  }

  // ---------- doing things: the one action button ----------
  let action = null // { kind, label, target }
  const nearestParked = (x, z, within) => {
    let best = null
    let bd = within
    for (const c of parkedList()) {
      const d = Math.hypot(c.x - x, c.z - z)
      if (d < bd) {
        bd = d
        best = c
      }
    }
    return best
  }
  const actionFor = () => {
    if (riding) return { kind: "out", label: "Get out" }
    if (onTransit) {
      const q = tripAt(onTransit.line, lineTau(onTransit.line, onTransit.trip))
      return q && q.stop >= 0 ? { kind: "off", label: onTransit.line.kind === "bus" ? "Get off here" : "Get off the train" } : null
    }
    if (driving && car.auto) return car.auto.phase === "done" || Math.abs(car.speed) < 0.5 ? { kind: "out", label: "Get out" } : null
    if (driving) return Math.abs(car.speed) < 2 ? { kind: "out", label: isTwo(car.model) ? "Get off" : "Get out" } : null
    const w = me.walker
    // your ride's here
    if (ride?.phase === "waiting" && Math.hypot(ride.pose.x - w.x, ride.pose.z - w.z) < 10) return { kind: "ride-in", label: `Get in the ${ride.name}` }
    // a bus or a train waiting right here
    const b = boardable()
    if (b) return { kind: "board", label: b.line.kind === "bus" ? `Get on ${lineLabel(b.line).replace(/ to .*/, "")}` : "Get on the train", target: b }
    // a friend's car to ride along in (the passenger door)
    for (const r of remotes.values()) {
      if (!r.car || r.car.seat === 1 || isTwo(r.car.model)) continue
      if (Math.hypot(r.x - w.x, r.z - w.z) < 4.2 && r.speed < 2) return { kind: "ride", label: `Ride along with ${r.name}`, target: r.num }
    }
    const egg = eggs.nearest(w.x, w.z)
    if (egg) return { kind: "egg", label: egg.verb || "Take a look", target: egg.id }
    // (the car someone just pulled up in for you: the keys are in it)
    const given = handed.find((h) => moved.get(h.id) !== "gone" && !moved.get(h.id) && Math.hypot(h.x - w.x, h.z - w.z) < 7)
    if (given) return { kind: "car", label: "Take the keys", target: given }
    const c = nearestParked(w.x, w.z, 3.4)
    if (c) return { kind: "car", label: c.label ? `Get in ${c.label.replace(/^The /, "the ")}` : "Get in", target: c }
    // a bike or a scooter to hop on
    let fb = null
    let fd = 2.4
    for (const f of fleetList()) {
      const d = Math.hypot(f.x - w.x, f.z - w.z)
      if (d < fd) {
        fd = d
        fb = f
      }
    }
    if (fb) return { kind: "car", label: fb.kind === "bike" ? "Ride the bike" : "Ride the scooter", target: { ...fb, model: fb.kind, color: FLEET[fb.kind].color } }
    const back = town.venues ? Object.entries(town.venues).find(([, v]) => v.back && Math.hypot(w.x - v.back.x, w.z - v.back.z) < v.back.r) : null
    if (back) return { kind: "venue", label: "Back to the courts", target: back[0] }
    // a car coming: wave it down (the driver hands you the keys)
    if (!hailing && traffic.canHail(w.x, w.z)) return { kind: "hail", label: "Flag down a car" }
    return null
  }
  // flagging down a car: it pulls up beside you, the driver hops out and hands you the keys
  let hailing = null // the traffic car on its way
  const HAIL_LINES = ["Keys are in it. Bring it back with a full tank!", "Go ahead, I needed the walk anyway.", "Take it! The radio only plays one song.", "She pulls a little left. Have fun!", "Just don't touch my seat settings.", "Sure, I'll grab a coffee. Enjoy!", "It's all yours. Wave if you see me!"]
  const walkers = [] // drivers walking off: { fig, x, z, yaw, t }
  const hail = () => {
    const w = me.walker
    const c = traffic.hail(w.x, w.z)
    if (!c) return onEvent({ type: "toast", text: "Nobody's coming this way. Try a busier street." })
    hailing = c
    onEvent({ type: "toast", text: "You wave. A car slows down..." })
  }
  const stepHail = (dt) => {
    if (hailing) {
      const c = hailing
      if (!traffic.cars.includes(c) || !c.hail) {
        hailing = null
        if (!traffic.cars.includes(c) || !c.hail) onEvent({ type: "toast", text: "It drove on by. Try again?" })
      } else if (c.hail.stopped) {
        hailing = null
        traffic.remove(c)
        const id = `hail:${c.id}:${Math.floor(clock * 10)}`
        handed.push({ id, model: c.model, color: c.color, x: c.x, z: c.z, yaw: c.yaw, label: "the car" })
        if (handed.length > 6) handed.shift()
        tilesDirty = true
        // (the driver gets out on the curb side and strolls off)
        const out = doorSpot(c, "passenger")
        const driverSide = doorSpot(c, "driver")
        const fig = host.figure ? host.figure(host.npcLook ? host.npcLook(`driver:${c.id}`) : {}, { lite: true }) : null
        if (fig) {
          scene.add(fig.group)
          walkers.push({ fig, x: driverSide.x, z: driverSide.z, yaw: Math.atan2(out.x - c.x, out.z - c.z) + 0.4, t: 0 })
        }
        const line = HAIL_LINES[Math.floor((clock * 7.3) % HAIL_LINES.length)]
        onEvent({ type: "toast", text: `"${line}"` })
        sendHud(true)
      }
    }
    for (let i = walkers.length - 1; i >= 0; i--) {
      const wk = walkers[i]
      wk.t += dt
      const sp = wk.t < 0.6 ? 0 : 1.3
      wk.x += Math.sin(wk.yaw) * sp * dt
      wk.z += Math.cos(wk.yaw) * sp * dt
      const y = heightAt(wk.x, wk.z, 0) ?? 0
      wk.fig.update({ x: wk.x, y, z: wk.z, yaw: wk.yaw, vx: Math.sin(wk.yaw) * sp, vz: Math.cos(wk.yaw) * sp, speed: sp }, dt)
      if (wk.t > 9) {
        wk.fig.dispose()
        walkers.splice(i, 1)
      }
    }
  }
  const getIn = (c) => {
    if (driving || riding) return
    driving = true
    car = createCar({ id: c.id, model: c.model, color: c.color, x: c.x, z: c.z, yaw: c.yaw })
    car.y = heightAt(c.x, c.z, me.walker.y, true) ?? me.walker.y
    moved.set(c.id, "gone")
    carMesh = makeCarMesh(c.model, c.color)
    scene.add(carMesh.group)
    if (!isTwo(c.model)) dropFig("me")
    tilesDirty = true
    cam.pos = null
    net?.request?.("roam:car", { car: { id: c.id, model: c.model, color: c.color } })
    lastSent = null
    if (c.egg) eggs.find(c.egg)
    onEvent({ type: "car", on: true, model: c.model })
  }
  const getOut = () => {
    if (riding) {
      const r = remotes.get(riding.num)
      const yaw = r ? r.yaw : me.yaw
      const base = r ? { x: r.x, z: r.z, yaw } : { x: me.x, z: me.z, yaw }
      const spot = doorSpot({ ...base, model: r?.car?.model || "sedan" }, "passenger")
      const p = colliders.resolve(spot.x, spot.z, 0.4)
      me.walker.x = p.x
      me.walker.z = p.z
      me.walker.yaw = yaw
      riding = null
      if (radioOn) {
        radioOn = false
        audio?.radio?.(false)
      }
      net?.request?.("roam:car", { car: null })
      lastSent = null
      onEvent({ type: "ride", on: false })
      return
    }
    if (onTransit) return leaveTransit()
    if (!driving || !car) return
    audio?.horn?.(false)
    if (car.auto) {
      // (out of your ride: it drives off; nothing's left parked)
      const r = car.auto
      const spot = doorSpot(car, "passenger")
      const p = colliders.resolve(spot.x, spot.z, 0.4)
      me.walker.x = p.x
      me.walker.z = p.z
      me.walker.yaw = car.yaw
      me.walker.vx = me.walker.vz = 0
      if (radioOn) {
        radioOn = false
        audio?.radio?.(false)
      }
      net?.request?.("roam:car", { car: null })
      r.mesh?.dispose()
      if (ride === r) ride = null
      carMesh = null
      driving = false
      cam.yaw = car.yaw
      car = null
      lastSent = null
      onEvent({ type: "car", on: false })
      return
    }
    if (radioOn) {
      radioOn = false
      audio?.radio?.(false)
    }
    // the car stays where you left it (this session; friends see it there too)
    moved.set(car.id, { x: car.x, z: car.z, yaw: car.yaw })
    const spot = doorSpot(car, "driver")
    const p = colliders.resolve(spot.x, spot.z, 0.4)
    me.walker.x = p.x
    me.walker.z = p.z
    me.walker.yaw = car.yaw
    me.walker.vx = me.walker.vz = 0
    net?.request?.("roam:car", { car: null, left: { id: car.id, x: Math.round(car.x * 10), z: Math.round(car.z * 10), yaw: Math.round(((car.yaw / (2 * Math.PI)) * 256 + 256) % 256) } })
    carMesh?.dispose()
    carMesh = null
    driving = false
    cam.yaw = car.yaw
    car = null
    tilesDirty = true
    lastSent = null
    onEvent({ type: "car", on: false })
  }
  const rideAlong = (num) => {
    const r = remotes.get(num)
    if (!r?.car || driving) return
    net?.request?.("roam:ride", { num }).then((res) => {
      if (!res?.ok) return onEvent({ type: "toast", text: res?.error || "Couldn't get in." })
      riding = { num }
      dropFig("me")
      cam.pos = null
      lastSent = null
      onEvent({ type: "ride", on: true, name: r.name })
    })
  }
  const doAction = () => {
    const a = actionFor()
    if (!a) return
    if (a.kind === "car") getIn(a.target)
    else if (a.kind === "out") getOut()
    else if (a.kind === "ride") rideAlong(a.target)
    else if (a.kind === "egg") eggs.find(a.target, { together: togetherAt(eggs.get(a.target)) })
    else if (a.kind === "venue") onEvent({ type: "venue", venue: a.target })
    else if (a.kind === "hail") hail()
    else if (a.kind === "ride-in") boardRide()
    else if (a.kind === "board") boardTransit(a.target)
    else if (a.kind === "off") leaveTransit()
    sendHud(true)
  }
  // is a friend here with you (for the couple's find)?
  const togetherAt = (egg) => !!egg && [...remotes.values()].some((r) => Math.hypot(r.x - egg.x, r.z - egg.z) < 25)

  // ---------- getting around: the GPS, the ride app, buses and trains ----------
  // (docs/open-world.md "Getting around"; nav.json, places.json and transit.json are built from the
  // map by tools/roam/build-nav.mjs and sit next to the tiles)
  const nav = { graph: null, places: null, transit: null, loading: null, failed: false }
  const fetchJson = async (p) => {
    const f = host.fetch || globalThis.fetch
    const r = await f(p)
    if (!r?.ok) throw new Error(`HTTP ${r?.status}`)
    return r.json()
  }
  const loadNav = () =>
    (nav.loading ||= Promise.all([fetchJson(`${town.prebuilt}/nav.json`), fetchJson(`${town.prebuilt}/places.json`)])
      .then(([g, p]) => {
        nav.graph = decodeGraph(g)
        nav.places = (p.places || []).map(([name, kind, x, z]) => ({ name, kind, x, z }))
        return nav
      })
      .catch(() => {
        nav.failed = true
        nav.loading = null
        return nav
      }))
  if (town.prebuilt)
    fetchJson(`${town.prebuilt}/transit.json`)
      .then((j) => !disposed && (nav.transit = loadTransit(j)))
      .catch(() => {})
  const transitLayer = createTransitLayer(scene)
  const routeLine = createRouteLine(scene)
  let transitSkip = 0 // (you skipped the wait: your buses and trains run that much ahead)
  const tNow = () => Date.now() / 1000 + transitSkip
  let onTransit = null // { line, trip } the bus or train you're on
  const transitLines = () => (nav.transit ? [...nav.transit.buses, ...nav.transit.trains] : [])
  const lineTau = (l, trip) => tNow() - (l.phase + trip * l.headway)
  const transitPose = () => {
    if (!onTransit) return null
    const p = tripPose(onTransit.line, lineTau(onTransit.line, onTransit.trip))
    if (!p) return null
    const g = heightAt(p.x, p.z, 0, true)
    return { ...p, y: Number.isFinite(g) ? g : me.walker.y, model: onTransit.line.kind === "bus" ? "bus" : "train", speed: p.speed || 0 }
  }
  // the vehicles to draw near you (every other frame)
  let transitDrawT = 0
  const drawTransit = (dt) => {
    transitDrawT -= dt
    if (transitDrawT > 0 || !nav.transit) return
    transitDrawT = phone ? 0.05 : 0
    const c = center()
    const t = tNow()
    const list = []
    for (const v of vehiclesNear(transitLines(), t, c.x, c.z, phone ? 420 : 650)) {
      if (v.line.kind === "bus") list.push({ kind: "bus", x: v.x, y: heightAt(v.x, v.z, 0, true) ?? 0, z: v.z, yaw: v.yaw })
      else
        for (let k = 0; k < TRAIN.cars; k++) {
          const p = at(v.line.pts, v.line.cum, v.s - k * TRAIN.carLen - TRAIN.carLen / 2)
          list.push({ kind: k === 0 ? "loco" : "coach", x: p.x, y: heightAt(p.x, p.z, 0, true) ?? 0, z: p.z, yaw: p.yaw })
        }
    }
    // the stop signs at the bus stops near you (on the curb side, facing the road)
    const signs = []
    for (const l of nav.transit.buses)
      for (const st of l.stops)
        if (Math.abs(st.x - c.x) < 160 && Math.abs(st.z - c.z) < 160 && !signs.some((q) => Math.hypot(q.x - st.x, q.z - st.z) < 12)) {
          const p = at(l.pts, l.cum, st.s)
          const sx = st.x - p.hz * (BUS.lane + 2.6)
          const sz = st.z + p.hx * (BUS.lane + 2.6)
          signs.push({ x: sx, y: heightAt(sx, sz, 0) ?? 0, z: sz, yaw: p.yaw + Math.PI / 2 })
        }
    transitLayer.set(list, signs)
  }
  // a stop or a station near you on foot -> what's coming
  const transitHere = () => {
    if (!nav.transit || driving || riding || onTransit) return null
    const w = me.walker
    const t = tNow()
    const near = stopsNear(nav.transit.buses, w.x, w.z, 22)
    const trains = stopsNear(nav.transit.trains, w.x, w.z, 70)
    const all = [...near, ...trains]
    if (!all.length) return null
    const next = all.map((n) => ({ id: n.line.id, label: lineLabel(n.line), kind: n.line.kind, secs: Math.round(nextAt(n.line, n.i, t)), i: n.i, line: n.line })).sort((a, b) => a.secs - b.secs)
    const seen = new Set()
    const uniq = next.filter((q) => !seen.has(q.label) && seen.add(q.label)).slice(0, 4)
    return { stop: (trains[0] || near[0]).stop.name || "the stop", station: !!trains.length, next: uniq }
  }
  // the bus or train waiting right here that you can get on -> { line, trip } | null
  const boardable = () => {
    if (!nav.transit || driving || riding || onTransit) return null
    const w = me.walker
    for (const v of vehiclesNear(transitLines(), tNow(), w.x, w.z, 60)) {
      if (v.stop < 0) continue
      const reach = v.line.kind === "bus" ? 9 : 60
      // (a train: anywhere along its coaches)
      const d = v.line.kind === "bus" ? Math.hypot(v.x - w.x, v.z - w.z) : Math.abs(nearestOnLine(v.line, w.x, w.z).s - (v.s - (TRAIN.cars * TRAIN.carLen) / 2)) < (TRAIN.cars * TRAIN.carLen) / 2 + 8 && nearestOnLine(v.line, w.x, w.z).d < reach ? 0 : Infinity
      if (d < reach) return { line: v.line, trip: v.trip }
    }
    return null
  }
  const boardTransit = (b) => {
    onTransit = { line: b.line, trip: b.trip }
    dropFig("me")
    cam.pos = null
    chase.yaw = null
    net?.request?.("roam:car", { car: { id: `tr:${b.line.id}:${b.trip}`.slice(0, 40), model: b.line.kind === "bus" ? "bus" : "train", color: 0xffffff } })
    lastSent = null
    onEvent({ type: "toast", text: `On ${lineLabel(b.line)}` })
    sendHud(true)
  }
  const leaveTransit = () => {
    const p = transitPose() || { x: me.walker.x, z: me.walker.z, yaw: me.walker.yaw }
    const l = onTransit.line
    onTransit = null
    // (out of the door: the curb side of a bus, the platform side of a train)
    const side = l.kind === "bus" ? 2.6 : 3.4
    const ox = p.x - Math.cos(p.yaw) * side
    const oz = p.z + Math.sin(p.yaw) * side
    const q = colliders.resolve(ox, oz, 0.4)
    me.walker.x = q.x
    me.walker.z = q.z
    me.walker.yaw = p.yaw
    me.walker.vx = me.walker.vz = 0
    cam.yaw = p.yaw
    cam.pos = null
    net?.request?.("roam:car", { car: null })
    lastSent = null
    sendHud(true)
  }
  // skip the wait at a stop (your buses and trains come sooner) or skip to the next stop
  const skipTransit = () => {
    const t = tNow()
    if (onTransit) {
      const l = onTransit.line
      const tau = lineTau(l, onTransit.trip)
      const q = tripAt(l, tau)
      if (!q) return
      const i = q.stop >= 0 ? q.stop + 1 : q.next
      if (i >= l.stops.length) return
      transitSkip += Math.max(0, l.tt.arr[i] - tau + 0.5)
      return sendHud(true)
    }
    const here = transitHere()
    if (!here?.next.length) return
    transitSkip += Math.max(0, here.next[0].secs - 3)
    sendHud(true)
  }

  // the ride app (Ryde 98) and the yellow cabs: a car comes to you along the roads and takes you
  let ride = null // { kind, phase: coming | waiting | riding | done, trip, mesh, pose, model, color, dest, driver }
  let rideN = 0
  const callRide = async (kind, dest) => {
    if (driving || riding || onTransit) return { ok: false, error: "Get out first." }
    await loadNav()
    if (!nav.graph) return { ok: false, error: "The map didn't load. Try again?" }
    cancelRide(true)
    const w = me.walker
    const K = RIDE_KINDS[kind] || RIDE_KINDS.ryde
    // (it starts a few blocks away and drives to you)
    let r = null
    for (let k = 0; k < 8 && !r; k++) {
      const a = k * 0.785 + (clock % 1)
      const from = snap(nav.graph, w.x + Math.sin(a) * 280, w.z + Math.cos(a) * 280, { through: true })
      if (from) r = routeOn(nav.graph, from.x, from.z, w.x, w.z)
      if (r && r.len < 60) r = null
    }
    if (!r) return { ok: false, error: "No cars around here right now." }
    const n = ++rideN
    const model = K.models[n % K.models.length]
    const color = K.colors[(n * 7) % K.colors.length]
    const trip = createTrip(r)
    const mesh = makeCarMesh(model, color)
    scene.add(mesh.group)
    ride = { id: `ride:${kind}:${n}`, kind, name: K.name, phase: "coming", trip, mesh, model, color, dest, driver: DRIVERS[(n * 5 + Math.floor(clock)) % DRIVERS.length], pose: tripPoseAt(trip), y: me.walker.y }
    sendHud(true)
    return { ok: true, eta: Math.round(tripTimeLeft(trip)), driver: ride.driver }
  }
  const cancelRide = (quiet = false) => {
    if (!ride) return
    if (driving && car?.auto === ride) return
    ride.mesh?.dispose()
    ride = null
    if (!quiet) sendHud(true)
  }
  const boardRide = async () => {
    if (!ride || ride.phase !== "waiting") return
    const dest = ride.dest
    const r = routeOn(nav.graph, ride.pose.x, ride.pose.z, dest.x, dest.z)
    if (!r) return onEvent({ type: "toast", text: "The driver can't find a way there." })
    ride.trip = createTrip(r)
    ride.phase = "riding"
    // (you're in: the car is yours as far as anyone online can see, so a friend can ride along)
    driving = true
    car = createCar({ id: ride.id, model: ride.model, color: ride.color, x: ride.pose.x, z: ride.pose.z, yaw: ride.pose.yaw })
    car.y = ride.y
    car.auto = ride
    carMesh = ride.mesh
    dropFig("me")
    cam.pos = null
    net?.request?.("roam:car", { car: { id: ride.id, model: ride.model, color: ride.color } })
    lastSent = null
    onEvent({ type: "toast", text: `${ride.driver}: "Hi! ${dest.name ? `Off to ${dest.name}.` : "Let's go."}"` })
    sendHud(true)
  }
  const placeRideCar = (c, pose, dt) => {
    const g = heightAt(pose.x, pose.z, c.y ?? 0, true)
    const y = Number.isFinite(g) ? g : c.y ?? 0
    c.y = c.y === undefined ? y : c.y + (y - c.y) * Math.min(1, dt * 10)
    const m = MODELS[c.model] || MODELS.sedan
    const hf = groundAt(pose.x + Math.sin(pose.yaw) * m.wheelbase / 2, pose.z + Math.cos(pose.yaw) * m.wheelbase / 2) ?? y
    const hb = groundAt(pose.x - Math.sin(pose.yaw) * m.wheelbase / 2, pose.z - Math.cos(pose.yaw) * m.wheelbase / 2) ?? y
    return Math.atan2(hf - hb, m.wheelbase)
  }
  const stepRide = (dt) => {
    if (!ride) return
    const blocked = (x, z, yaw) => {
      const fx = Math.sin(yaw)
      const fz = Math.cos(yaw)
      let best = Infinity
      const people = [...(driving ? [] : [{ x: me.walker.x, z: me.walker.z, me: true }]), ...[...remotes.values()].filter((r) => !(r.act & (ACT.drive | ACT.ride))), ...traffic.cars]
      for (const p of people) {
        const dx = p.x - x
        const dz = p.z - z
        const ahead = dx * fx + dz * fz
        // (it pulls up to you, so you don't count when it's coming for you)
        if (p.me && ride.phase === "coming") continue
        if (ahead > 0 && ahead < 26 && Math.abs(dx * fz - dz * fx) < 1.8) best = Math.min(best, ahead)
      }
      return best
    }
    if (ride.phase === "coming" || ride.phase === "riding") {
      stepTrip(ride.trip, dt, { blocked })
      ride.pose = tripPoseAt(ride.trip)
      if (ride.trip.done) {
        if (ride.phase === "coming") {
          ride.phase = "waiting"
          onEvent({ type: "toast", text: `Your ${ride.name} is here: ${ride.driver}` })
        } else {
          ride.phase = "done"
          onEvent({ type: "toast", text: `You've arrived${ride.dest?.name ? ` at ${ride.dest.name}` : ""}. Thanks for riding ${ride.name}!` })
        }
        sendHud(true)
      }
    }
    const pitch = placeRideCar(ride, ride.pose, dt)
    if (driving && car?.auto === ride) {
      car.x = ride.pose.x
      car.z = ride.pose.z
      car.yaw = ride.pose.yaw
      car.y = ride.y
      car.pitch = pitch
      car.speed = ride.trip.speed
      car.steer = 0
    } else {
      ride.mesh.group.position.set(ride.pose.x, ride.y, ride.pose.z)
      ride.mesh.group.rotation.set(-pitch, ride.pose.yaw, 0, "YXZ")
      ride.mesh.setWheels(0, ride.trip.speed * dt)
    }
  }
  // skip ahead (fast travel) in a ride: the tiles at the other end load as it gets there
  const skipRide = () => {
    if (!ride || ride.phase !== "riding") return false
    skipTrip(ride.trip)
    ride.pose = tripPoseAt(ride.trip)
    ride.y = heightAt(ride.pose.x, ride.pose.z, 0, true) ?? ride.y
    lastCenter = null
    cam.pos = null
    chase.pos = null
    return true
  }
  const routeOn = (g, x0, z0, x1, z1) => {
    try {
      return route(g, x0, z0, x1, z1)
    } catch {
      return null
    }
  }

  // the GPS: a destination, the route there on the road, and the next turn
  let gps = null // { dest, route, s, drawnAt, rerouteT }
  const setDestination = async (dest) => {
    await loadNav()
    if (!nav.graph || !dest) return { ok: false, error: "The map didn't load. Try again?" }
    const c = center()
    const r = routeOn(nav.graph, c.x, c.z, dest.x, dest.z)
    if (!r) return { ok: false, error: "No way there by road." }
    gps = { dest, route: r, s: 0, drawnAt: null, rerouteT: 0, tickT: 0 }
    sendHud(true)
    return { ok: true, len: r.len, time: r.time }
  }
  const clearDestination = () => {
    gps = null
    routeLine.set(null)
    sendHud(true)
  }
  const stepGps = (dt) => {
    if (!gps) return
    routeLine.tick(clock)
    gps.tickT -= dt
    if (gps.tickT > 0) return
    gps.tickT = 0.3
    const c = center()
    const on = onRoute(gps.route, c.x, c.z)
    gps.s = on.s
    gps.rerouteT -= 0.3
    // (off the route: a new one from here)
    if (on.d > 30 && gps.rerouteT <= 0 && nav.graph) {
      gps.rerouteT = 4
      const r = routeOn(nav.graph, c.x, c.z, gps.dest.x, gps.dest.z)
      if (r) {
        gps.route = r
        gps.s = 0
        gps.drawnAt = null
      }
    }
    if (gps.route.len - gps.s < 20 && Math.hypot(gps.dest.x - c.x, gps.dest.z - c.z) < 60) {
      onEvent({ type: "toast", text: `You've arrived${gps.dest.name ? ` at ${gps.dest.name}` : ""}.` })
      return clearDestination()
    }
    // the line on the road: from a little behind you to 450 m ahead, redrawn as you go (and as
    // the ground under it loads)
    if (!gps.drawnAt || Math.abs(gps.s - gps.drawnAt.s) > 30 || clock - gps.drawnAt.t > 3) {
      const r = gps.route
      const s0 = Math.max(0, gps.s - 15)
      const s1 = Math.min(r.len, gps.s + 450)
      const pts = []
      const ys = []
      let lastY = me.walker.y
      for (let s = s0; s <= s1 + 0.01; s += 4) {
        const p = pointAt(r.pts, r.cum, Math.min(s, s1))
        const y = heightAt(p.x, p.z, lastY, true)
        lastY = Number.isFinite(y) ? y : lastY
        pts.push({ x: p.x, z: p.z })
        ys.push(lastY)
      }
      routeLine.set(pts, ys, s0)
      gps.drawnAt = { s: gps.s, t: clock }
    }
  }
  const gpsHud = () => {
    if (!gps) return null
    const nx = nextStep(gps.route, gps.s)
    const left = Math.max(0, gps.route.len - gps.s)
    return { to: gps.dest.name || "Pin", turn: nx?.step.turn || "arrive", text: nx ? stepText(nx.step, nx.dist) : "Arriving", left: Math.round(left), mins: Math.max(1, Math.round(left / (driving || onTransit ? 11 : 1.4) / 60)) }
  }

  // ---------- the camera ----------
  const tmpA = new THREE.Vector3()
  const portrait = () => size.height > size.width * 1.05
  const chase = createChase()
  // (closer behind a bike, farther behind a bus)
  const CHASE_SCALE = { bike: 0.55, scooter: 0.5, bus: 1.6, train: 2.3 }
  const baseFov = camera.fov
  let devCam = null // (tests: a fixed lens { pos, look })
  let photoSaved = null // (the lens before a selfie)
  const updateCamera = (dt) => {
    if (devCam) {
      camera.position.set(devCam.pos.x, devCam.pos.y, devCam.pos.z)
      tmpA.set(devCam.look.x, devCam.look.y, devCam.look.z)
      camera.lookAt(tmpA)
      camera.clearViewOffset()
      return
    }
    if (driving || riding || onTransit) {
      const c = driving ? car : onTransit ? transitPose() : remotes.get(riding.num)
      if (!c) return
      const v = stepChase(chase, c, dt, { portrait: portrait(), groundAt, segment: (x0, z0, x1, z1, y) => colliders.segment(x0, z0, x1, z1, y), scale: CHASE_SCALE[c.model || c.car?.model] || 1 })
      camera.position.set(v.pos.x, v.pos.y, v.pos.z)
      tmpA.set(v.look.x, v.look.y, v.look.z)
      camera.lookAt(tmpA)
      if (Math.abs(camera.fov - v.fov) > 0.05) {
        camera.fov = v.fov
        camera.updateProjectionMatrix()
      }
      camera.clearViewOffset()
      cam.yaw = chase.yaw
      cam.pos = null
      return
    }
    chase.yaw = null
    chase.pos = null
    if (camera.fov !== baseFov) {
      camera.fov = baseFov
      camera.updateProjectionMatrix()
    }
    const w = me.walker
    const tx = w.x
    const tz = w.z
    const ty = (w.y || 0) + 1.45
    const dist = cam.dist
    // (a drag up or down tilts the view: lower sees more of the town ahead)
    const height = 0.35 + cam.pitch * 2.2
    // (comes round behind you only when you walk away from it)
    // (and only while the push is mostly straight up the stick: a sideways or diagonal push walks
    // its line with the camera holding still, so what you point at is where you go)
    const pushUp = Math.hypot(input.x, input.y) > 0.12 && Math.abs(Math.atan2(input.x, input.y)) < 0.45
    if (w.speed > 0.6 && (pushUp || moveRef === null)) {
      const away = Math.cos(wrap(w.yaw - cam.yaw))
      if (away > 0.3) {
        cam.behindT += dt
        if (cam.behindT > 0.35) {
          const turn = wrap(w.yaw - cam.yaw) * Math.min(1, dt * 1.6 * away)
          cam.yaw += turn
          // (the stick's frame comes round with it: up the stick stays straight ahead on screen)
          if (moveRef !== null) moveRef += turn
        }
      } else cam.behindT = 0
    } else cam.behindT = 0
    const bx = tx - Math.sin(cam.yaw) * dist
    const bz = tz - Math.cos(cam.yaw) * dist
    // walls between you and the lens pull it in
    const f = colliders.segment(tx, tz, bx, bz, ty)
    const k = f < 1 ? Math.max(0.12, f - 0.06) : 1
    const cx = tx + (bx - tx) * k
    const cz = tz + (bz - tz) * k
    let cy = ty + height * (0.55 + 0.45 * k)
    // (never under the ground)
    const g = groundAt(cx, cz)
    if (g !== null && cy < g + 0.8) cy = g + 0.8
    if (!cam.pos) cam.pos = new THREE.Vector3(cx, cy, cz)
    const lerp = Math.min(1, dt * 10)
    cam.pos.x += (cx - cam.pos.x) * lerp
    cam.pos.y += (cy - cam.pos.y) * lerp
    cam.pos.z += (cz - cam.pos.z) * lerp
    camera.position.copy(cam.pos)
    // (upright phones: you sit a little above the middle, the way ahead above the thumbs;
    // looking a little past you, the way the camera faces: more town, less ground)
    tmpA.set(tx + Math.sin(cam.yaw) * 2.5, ty + 0.45, tz + Math.cos(cam.yaw) * 2.5)
    camera.lookAt(tmpA)
    if (portrait()) camera.setViewOffset(size.width, size.height, 0, size.height * 0.14, size.width, size.height)
    else camera.clearViewOffset()
  }

  // ---------- drawing people ----------
  const drawPeople = (dt) => {
    // you
    if (!driving && !riding) {
      const fig = figFor("me", me.look)
      if (fig) fig.update({ x: me.walker.x, y: me.walker.y, z: me.walker.z, yaw: me.walker.yaw, vx: me.walker.vx, vz: me.walker.vz, speed: me.walker.speed }, dt)
    }
    if (driving && car && carMesh) {
      carMesh.group.position.set(car.x, car.y, car.z)
      carMesh.group.rotation.set(-car.pitch, car.yaw, car.roll, "YXZ")
      // the wheels steer and roll; the body leans out of a turn and dips under the brake
      const steerA = car.steer * steerLimit(car.speed, car.model)
      carMesh.setWheels(steerA, car.speed * dt)
      const yawRate = (car.speed * Math.tan(steerA)) / (MODELS[car.model] || MODELS.sedan).wheelbase
      const accel = dt > 0 ? (car.speed - (car.lastSpeed ?? car.speed)) / dt : 0
      car.lastSpeed = car.speed
      if (isTwo(car.model)) {
        // (a bike leans into the turn; you stand on it)
        car.lean = (car.lean || 0) + (Math.max(-0.4, Math.min(0.4, yawRate * car.speed * 0.1)) - (car.lean || 0)) * Math.min(1, dt * 5)
        carMesh.body.rotation.set(0, 0, car.lean)
        const fig = figFor("me", me.look)
        const deck = carMesh.deck || 0.2
        if (fig) {
          fig.update({ x: car.x - Math.cos(car.yaw) * Math.sin(car.lean) * 0.6, y: car.y + deck, z: car.z + Math.sin(car.yaw) * Math.sin(car.lean) * 0.6, yaw: car.yaw, vx: 0, vz: 0, speed: 0 }, dt)
        }
        me.walker.x = car.x
        me.walker.z = car.z
        me.walker.y = car.y
      } else {
        car.lean = (car.lean || 0) + (Math.max(-0.05, Math.min(0.05, -yawRate * car.speed * 0.006)) - (car.lean || 0)) * Math.min(1, dt * 6)
        car.dive = (car.dive || 0) + (Math.max(-0.03, Math.min(0.03, -accel * 0.003)) - (car.dive || 0)) * Math.min(1, dt * 6)
        carMesh.body.rotation.set(car.dive, 0, car.lean)
      }
      const braking = (input.brake > 0 || keys.has("ArrowDown") || keys.has("KeyS")) && car.speed > 0.3
      carMesh.setBrake(braking)
    }
    // the others
    for (const r of remotes.values()) {
      const inCar = (r.act & ACT.drive) && (r.carMesh || r.car)
      if (r.carMesh) {
        r.carMesh.group.visible = !!(r.act & ACT.drive)
        const g = heightAt(r.x, r.z, r.y, true)
        r.carMesh.group.position.set(r.x, Number.isFinite(g) ? g : r.y, r.z)
        r.carMesh.group.rotation.set(0, r.yaw, 0)
        r.carMesh.setWheels(0, (r.speed || 0) * dt)
      }
      // (on a bike or a scooter a friend stands on it, seen)
      const onTwo = inCar && isTwo(r.car?.model)
      const hidden = (inCar && !onTwo) || (r.act & ACT.ride)
      if (hidden || Math.hypot(r.x - camera.position.x, r.z - camera.position.z) > 120) {
        dropFig(`r${r.num}`)
        continue
      }
      const fig = figFor(`r${r.num}`, r.look)
      if (fig && onTwo) fig.update({ x: r.x, y: r.carMesh.group.position.y + (r.carMesh.deck || 0.2), z: r.z, yaw: r.yaw, vx: 0, vz: 0, speed: 0 }, dt)
      else if (fig) fig.update({ x: r.x, y: r.y, z: r.z, yaw: r.yaw, vx: Math.sin(r.yaw) * r.speed, vz: Math.cos(r.yaw) * r.speed, speed: r.speed }, dt)
    }
  }

  // ---------- labels (names over people) ----------
  const labelPool = []
  const proj = new THREE.Vector3()
  const updateLabels = () => {
    if (!labelsEl) return
    let i = 0
    for (const r of remotes.values()) {
      const d = Math.hypot(r.x - camera.position.x, r.z - camera.position.z)
      if (d > 90) continue
      proj.set(r.x, (r.y || 0) + ((r.act & ACT.drive) || (r.act & ACT.ride) ? 2.2 : 2.15), r.z).project(camera)
      if (proj.z > 1 || Math.abs(proj.x) > 1.1 || Math.abs(proj.y) > 1.1) continue
      let el = labelPool[i]
      if (!el) {
        el = document.createElement("div")
        el.className = "roamLabel"
        labelsEl.appendChild(el)
        labelPool[i] = el
      }
      const text = r.act & ACT.ride ? `${r.name} (riding along)` : r.name
      if (el.textContent !== text) el.textContent = text
      el.style.display = ""
      el.style.transform = `translate(${((proj.x + 1) / 2) * size.width}px, ${((1 - proj.y) / 2) * size.height}px) translate(-50%, -100%)`
      i++
    }
    for (; i < labelPool.length; i++) labelPool[i].style.display = "none"
  }

  // ---------- the HUD ----------
  let hudT = 0
  let lastHud = ""
  const streetAt = (x, z) => {
    const t = tileAt(x, z)
    if (!t) return ""
    let best = ""
    let bd = 14
    for (const r of t.roads) {
      if (!r.name) continue
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const a = r.pts[i]
        const b = r.pts[i + 1]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const L2 = dx * dx + dz * dz || 1e-9
        const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2))
        const d = Math.hypot(x - a.x - dx * k, z - a.z - dz * k) - r.width / 2
        if (d < bd) {
          bd = d
          best = r.name
        }
      }
    }
    return best
  }
  const sendHud = (force) => {
    action = actionFor()
    const pos = center()
    const th = frameNo % 3 === 0 || force ? transitHere() : undefined
    const hud = {
      mode: driving ? (car?.auto ? "ride" : "drive") : riding ? "ride" : onTransit ? "transit" : "walk",
      action: action ? { kind: action.kind, label: action.label } : null,
      speed: driving ? Math.round(Math.abs(car.speed) * 2.237) : riding ? Math.round((remotes.get(riding.num)?.speed || 0) * 2.237) : 0,
      street: frameNo % 4 === 0 || force ? streetAt(pos.x, pos.z) : lastStreet,
      found: eggs.foundCount,
      total: eggs.total,
      hint: eggs.hint(pos.x, pos.z),
      loading: tiles.size === 0,
      online: net ? { people: remotes.size + 1, you: myNum } : null,
      riders: driving ? [...remotes.values()].filter((r) => r.car?.seat === 1 && r.car.driver === myNum).map((r) => r.name) : [],
      vehicle: driving && car ? car.model : null,
      two: driving && car ? isTwo(car.model) : false,
      hailing: !!hailing,
      radio: radioOn,
      // getting around: your ride, the GPS, a stop near you, the bus or train you're on
      ride: ride ? { name: ride.name, kind: ride.kind, phase: ride.phase, driver: ride.driver, to: ride.dest?.name || "", eta: Math.round(tripTimeLeft(ride.trip)) } : null,
      gps: gpsHud(),
      transit: th === undefined ? lastTransit : th && { stop: th.stop, station: th.station, next: th.next.map((n) => ({ label: n.label, secs: Math.ceil(n.secs / 5) * 5, kind: n.kind })), towns: th.station ? trainTowns() : [] },
      onboard: onTransit ? transitHudLine() : null,
    }
    lastTransit = hud.transit
    lastStreet = hud.street
    const s = JSON.stringify(hud)
    if (!force && s === lastHud) return
    lastHud = s
    onHud(hud)
  }
  let lastStreet = ""
  let lastTransit = null
  let frameNo = 0
  // on a bus or a train: where it's going, the next stop, the towns the train goes on to
  const transitHudLine = () => {
    const l = onTransit.line
    const q = tripAt(l, lineTau(l, onTransit.trip))
    if (!q) return null
    const nextStop = l.stops[q.stop >= 0 ? q.stop + 1 : q.next]
    return { label: lineLabel(l), kind: l.kind, at: q.stop >= 0 ? l.stops[q.stop].name : "", next: nextStop?.name || "", towns: l.kind === "train" ? trainTowns() : [] }
  }
  // the other towns with a station (towns/*.js `station`), for the train
  const trainTowns = () => (host.towns ? host.towns().filter((t) => t.id !== town.id && t.station).map((t) => ({ id: t.id, name: t.name })) : [])

  // ---------- online: sending ----------
  const myPos = () => {
    if (driving && car) return { x: car.x, z: car.z, y: car.y, yaw: car.yaw, speed: car.speed, act: ACT.drive | (Math.abs(car.speed) > 0.1 ? ACT.move : 0) }
    if (onTransit) {
      const p = transitPose()
      if (p) return { x: p.x, z: p.z, y: p.y, yaw: p.yaw, speed: p.speed, act: ACT.drive | (p.speed > 0.1 ? ACT.move : 0) }
    }
    if (riding) {
      const r = remotes.get(riding.num)
      return { x: r?.x ?? me.walker.x, z: r?.z ?? me.walker.z, y: r?.y ?? 0, yaw: r?.yaw ?? 0, speed: r?.speed ?? 0, act: ACT.ride }
    }
    const w = me.walker
    return { x: w.x, z: w.z, y: w.y, yaw: w.yaw, speed: w.speed, act: (w.speed > 0.1 ? ACT.move : 0) | (w.speed > 5 ? ACT.sprint : 0) }
  }
  const sendPos = () => {
    if (!net?.volatile) return
    const p = myPos()
    const now = performance.now() / 1000
    if (!shouldSend(lastSent, p, now, driving)) return
    lastSent = { t: now, p }
    net.volatile("roam:pos", packPos(p))
  }

  // ---------- the frame ----------
  const step = (dtIn) => {
    if (disposed || suspended) return
    const dt = Math.min(0.1, dtIn)
    clock += dt
    frameNo++
    seaUniforms.seaTime.value = clock
    stepSky()
    stepTiles(dt)
    if (tilesDirtyForShadow) {
      tilesDirtyForShadow = false
      shadowAt.dirty = true
    }
    stepShadow()
    // keys
    const kx = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0)
    const ky = (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0) - (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0)
    const shift = keys.has("ShiftLeft") || keys.has("ShiftRight")
    const people = [...remotes.values()].filter((r) => !(r.act & (ACT.drive | ACT.ride))).map((r) => ({ x: r.x, z: r.z }))
    if (driving && car?.auto) {
      // (your ride drives itself: stepRide)
    } else if (onTransit) {
      const p = transitPose()
      if (!p) leaveTransit()
      else {
        me.walker.x = p.x
        me.walker.z = p.z
        me.walker.y = p.y
      }
    } else if (driving && car) {
      // (a bike or a scooter rides on one thumb: the stick says where to go; footbridges too)
      const two = isTwo(car.model)
      const st = two ? stickToRide(input.x, input.y) : null
      const gas = Math.max(two ? st.gas : input.gas, ky > 0 ? 1 : 0)
      const brake = Math.max(two ? st.brake : input.brake, ky < 0 ? 1 : 0)
      const steer = Math.max(-1, Math.min(1, (two ? st.steer : input.steer) + kx))
      stepCar(car, { gas, brake, steer }, dt, { resolve: resolveCar, heightAt: (x, z, y) => heightAt(x, z, y, !two), blocked: (x, z, yaw, dir, m) => personAhead(people, x, z, yaw, dir, m) })
    } else if (riding) {
      const r = remotes.get(riding.num)
      if (r) {
        me.walker.x = r.x
        me.walker.z = r.z
        me.walker.y = r.y
      }
    } else if (tileAt(me.walker.x, me.walker.z)) {
      // (only once the ground under you is here: no walking off into nothing)
      const kl = Math.hypot(kx, ky) || 1
      const ix = input.x + (kx / kl) * (kx || ky ? 0.85 : 0)
      const iy = input.y + (ky / kl) * (kx || ky ? 0.85 : 0)
      if (Math.hypot(ix, iy) < 0.12) moveRef = null
      else if (moveRef === null) moveRef = cam.yaw
      stepWalker(me.walker, { x: ix, y: iy, sprint: input.sprint || shift }, moveRef ?? cam.yaw, dt, { resolve: resolveFoot, heightAt: (x, z, y) => heightAt(x, z, y, false) })
    }
    stepRide(dt)
    stepRemotes()
    eggs.step(dt, center(), clock, camera)
    updateCamera(dt)
    // (the sky dome rides with the lens: the town is bigger than the dome)
    // (the dome is centred on the eye, height too: at y 0 its horizon sat above the eye wherever the
    // ground is below the town's base, a dark band over the sea at Newport and in the low parts of
    // a town: the sky-bar fix)
    if (sky?.mesh) sky.mesh.position.copy(camera.position)
    stepLife(dt)
    stepHail(dt)
    stepGps(dt)
    drawTransit(dt)
    drawLife(dt)
    drawLights()
    drawPeople(dt)
    updateLabels()
    sendPos()
    hudT += dt
    if (hudT > 0.15) {
      hudT = 0
      sendHud(false)
    }
  }

  const world = {
    scene,
    camera,
    town,
    frame: step,
    get exposure() {
      return exposure
    },
    toneMapping: THREE.ACESFilmicToneMapping,
    get mode() {
      return driving ? (car?.auto ? "ride" : "drive") : riding ? "ride" : onTransit ? "transit" : "walk"
    },
    resize(width, height) {
      size = { width: Math.max(1, width), height: Math.max(1, height) }
      camera.aspect = size.width / size.height
      camera.updateProjectionMatrix()
    },
    // the walking stick: x right, y up (each -1..1)
    setStick(x, y) {
      input.x = x
      input.y = y
    },
    setSprint(on) {
      input.sprint = !!on
    },
    // driving: steer -1..1 (right +), gas and brake 0..1
    setDrive({ steer, gas, brake } = {}) {
      if (steer !== undefined) input.steer = Math.max(-1, Math.min(1, steer))
      if (gas !== undefined) input.gas = gas
      if (brake !== undefined) input.brake = brake
    },
    key(code, down) {
      if (down) {
        if (code === "Enter" || code === "KeyF" || code === "KeyE") return doAction()
        if (code === "KeyQ") return (cam.yaw += 0.35)
        if (code === "KeyH") {
          world.horn(true)
          return true
        }
        if (code === "KeyR") {
          world.radio(!radioOn)
          return true
        }
        keys.add(code)
      } else {
        keys.delete(code)
        if (code === "KeyH") world.horn(false)
      }
      return ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "Space"].includes(code)
    },
    clearKeys() {
      keys.clear()
      input.x = input.y = input.gas = input.brake = input.steer = 0
      input.sprint = false
    },
    // a drag on the picture turns the camera round you (px)
    drag(dx, dy = 0) {
      if (driving || riding) return
      cam.yaw -= dx * 0.008
      // (looking round while you walk steers you the same way)
      if (moveRef !== null) moveRef -= dx * 0.008
      cam.pitch = Math.max(0.05, Math.min(0.9, cam.pitch + dy * 0.004))
    },
    action: doAction,
    // the car's horn (held) and radio (on/off; it goes off when you get out)
    horn(on) {
      if (!driving && on) return
      audio?.horn?.(!!on)
    },
    radio(on) {
      radioOn = !!on && (driving || !!riding)
      audio?.radio?.(radioOn)
      sendHud(true)
    },
    get radioOn() {
      return radioOn
    },
    get host() {
      return host
    },
    // the phone's camera: a selfie turns the lens round to face you (and back again with null)
    photoLens(selfie) {
      if (selfie === null || selfie === undefined) {
        devCam = photoSaved
        photoSaved = null
        return
      }
      if (!selfie) return
      photoSaved = devCam
      const c = center()
      const y = (driving && car ? car.y : me.walker.y) + 1.55
      const yaw = cam.yaw
      // (held out at arm's length in front of you, a little above, looking back at your face)
      devCam = { pos: { x: c.x + Math.sin(yaw + Math.PI) * -2.1, y: y + 0.25, z: c.z + Math.cos(yaw + Math.PI) * -2.1 }, look: { x: c.x, y: y - 0.05, z: c.z } }
      if (!driving && !riding) me.walker.yaw = yaw
      updateCamera(0)
    },
    // ---- getting around (the phone: ui/RoamPhone.jsx) ----
    // the town's road map and places (loaded the first time the phone needs them) -> bool
    loadNav: () => loadNav().then(() => !!nav.graph),
    // the whole town's roads for the phone's map: [{ cls, pts }] (cached)
    navRoads() {
      if (!nav.graph) return []
      return (nav._roads ||= nav.graph.edges.map((e) => ({ cls: e.cls, pts: e.pts })))
    },
    // places by name, nearest first -> [{ name, kind, x, z, d }]
    searchPlaces(q, n = 12) {
      const c = center()
      const s = String(q || "").trim().toLowerCase()
      if (!nav.places || !s) return []
      const out = []
      for (const p of nav.places) {
        const nm = p.name.toLowerCase()
        const i = nm.indexOf(s)
        if (i < 0) continue
        out.push({ ...p, d: Math.hypot(p.x - c.x, p.z - c.z), rank: i === 0 ? 0 : nm.includes(" " + s) ? 1 : 2 })
      }
      out.sort((a, b) => a.rank - b.rank || a.d - b.d)
      return out.slice(0, n)
    },
    // what the phone's map shows besides the roads
    mapNow() {
      const c = center()
      return {
        x: c.x,
        z: c.z,
        yaw: driving && car ? car.yaw : me.walker.yaw,
        friends: [...remotes.values()].map((r) => ({ name: r.name, x: r.x, z: r.z })),
        route: gps ? gps.route.pts : null,
        dest: gps ? gps.dest : null,
        ride: ride ? { x: ride.pose.x, z: ride.pose.z, phase: ride.phase } : null,
        stops: nav.transit ? nav.transit.buses.flatMap((l) => l.stops).filter((s) => Math.abs(s.x - c.x) < 1500 && Math.abs(s.z - c.z) < 1500) : [],
        stations: nav.transit?.stations || [],
        bbox: town.bbox ? (() => {
          const a = frame.toXZ(town.bbox.north, town.bbox.west)
          const b = frame.toXZ(town.bbox.south, town.bbox.east)
          return { x0: a.x, z0: a.z, x1: b.x, z1: b.z }
        })() : null,
      }
    },
    // the nearest place to a point on the map (for a tapped pin's name)
    placeNear(x, z, r = 80) {
      let best = null
      for (const p of nav.places || []) {
        const d = Math.hypot(p.x - x, p.z - z)
        if (d < r && (!best || d < best.d)) best = { ...p, d }
      }
      return best
    },
    setDestination,
    clearDestination,
    callRide,
    // the bikes and scooters within r, nearest first
    fleetNear(r = 600) {
      const c = center()
      return fleetList()
        .map((f) => ({ ...f, d: Math.hypot(f.x - c.x, f.z - c.z) }))
        .filter((f) => f.d < r)
        .sort((a, b) => a.d - b.d)
    },
    cancelRide: () => cancelRide(),
    // skip ahead: in a ride, to just short of where you're going; on a bus or train, to the next stop
    skipAhead() {
      if (skipRide()) return true
      if (onTransit) {
        skipTransit()
        return true
      }
      return false
    },
    // at a stop: the bus or train comes now (your clock for buses and trains runs ahead)
    skipWait: () => skipTransit(),
    // what runs from the stops round you, and lines through town
    transitInfo() {
      return { here: transitHere(), lines: nav.transit ? nav.transit.buses.length : 0, trains: nav.transit ? nav.transit.trains.length : 0, stations: nav.transit?.stations || [] }
    },
    // the radio on foot too (the phone's Music)
    music(on) {
      radioOn = !!on
      audio?.radio?.(radioOn)
      sendHud(true)
    },
    get rideState() {
      return ride ? { phase: ride.phase, name: ride.name, driver: ride.driver, to: ride.dest?.name, s: ride.trip.s, len: ride.trip.len, x: ride.pose.x, z: ride.pose.z } : null
    },
    get gpsState() {
      return gps ? { to: gps.dest, len: gps.route.len, s: gps.s, steps: gps.route.steps, pts: gps.route.pts.length } : null
    },
    get transitState() {
      return onTransit ? { line: onTransit.line.id, kind: onTransit.line.kind, trip: onTransit.trip, pose: transitPose() } : null
    },
    get navData() {
      return nav
    },
    // the minimap: the drivable roads round you (town metres), you, friends, the way you face
    mapView(radius = 160) {
      const p = center()
      const roads = []
      const r2 = (radius + 60) ** 2
      for (const e of tiles.values()) {
        if (!e.near) continue
        const rc = e.t.rect
        const dx = Math.max(rc.x0 - p.x, 0, p.x - rc.x1)
        const dz = Math.max(rc.z0 - p.z, 0, p.z - rc.z1)
        if (dx * dx + dz * dz > r2) continue
        for (const r of e.t.roads) if (DRIVABLE.has(r.cls) && r.cls !== ROAD.driveway && r.cls !== ROAD.aisle) roads.push({ w: r.width, big: r.cls <= ROAD.tertiary, pts: r.pts })
      }
      return { x: p.x, z: p.z, yaw: driving && car ? car.yaw : riding ? remotes.get(riding.num)?.yaw ?? me.walker.yaw : me.walker.yaw, view: cam.yaw, roads, people: [...remotes.values()].map((r) => ({ x: r.x, z: r.z })), traffic: traffic.cars.map((t) => ({ x: t.x, z: t.z })) }
    },
    refigure() {
      for (const k of [...figs.keys()]) dropFig(k)
    },
    setMe({ name, look } = {}) {
      if (name) me.name = name
      if (look && look !== me.look) {
        me.look = look
        net?.request?.("roam:look", { look })
      }
    },
    suspend() {
      suspended = true
      world.clearKeys()
    },
    resume() {
      suspended = false
      sendHud(true)
    },
    get suspended() {
      return suspended
    },
    // ---- online (the host's connection: server/roam) ----
    setNet(n) {
      net = n
      if (!n) {
        for (const num of [...remotes.keys()]) dropRemote(num)
        myNum = null
        netInfo = null
        if (riding) getOut()
      }
      sendHud(true)
    },
    netJoined(r) {
      myNum = r.you
      netInfo = r
      for (const p of r.people || []) addRemote(p)
      for (const m of r.moved || []) moved.set(m.id, { x: m.x / 10, z: m.z / 10, yaw: (m.yaw / 256) * 2 * Math.PI })
      tilesDirty = true
      lastSent = null
      if (driving && car) net?.request?.("roam:car", { car: { id: car.id, model: car.model, color: car.color } })
      sendHud(true)
    },
    netEvent(type, d) {
      if (type === "roam:m" && d && Array.isArray(d.m)) {
        const now = performance.now() / 1000
        // (the server's clock against ours: the smallest gap seen, eased)
        const off = d.t / 1000 - now
        netClock.offset = netClock.offset === null ? off : Math.max(off, netClock.offset - 0.002)
        for (const row of d.m) {
          if (!Array.isArray(row)) continue
          const r = remotes.get(row[0])
          const p = unpackPos(row.slice(1))
          if (!r || !p) continue
          pushSample(r.track, d.t / 1000, p)
        }
      } else if (type === "roam:person" && d) addRemote(d)
      else if (type === "roam:gone" && d) dropRemote(d.num)
      else if (type === "roam:car" && d) {
        const r = remotes.get(d.num)
        if (r) setRemoteCar(r, d.car || null)
        if (d.left) {
          moved.set(d.left.id, { x: d.left.x / 10, z: d.left.z / 10, yaw: (d.left.yaw / 256) * 2 * Math.PI })
          tilesDirty = true
        }
        // (the driver you ride with got out: you're out too)
        if (riding && !d.car && (d.num === riding.num || d.num === myNum)) getOut()
      } else if (type === "roam:ride" && d) {
        // someone got in beside you
        const r = remotes.get(d.num)
        if (r) r.car = d.car || r.car
        onEvent({ type: "toast", text: `${r?.name || "A friend"} is riding along` })
      } else if (type === "roam:seat" && d && Number.isInteger(d.num)) {
        // (you followed your driver to this town: back in the passenger seat)
        if (driving) return
        riding = { num: d.num }
        dropFig("me")
        cam.pos = null
        lastSent = null
        onEvent({ type: "ride", on: true, name: remotes.get(d.num)?.name || "your friend" })
      } else if (type === "roam:hop" && d && typeof d.town === "string") {
        // (your driver is off to another town: you're coming too)
        if (riding) onEvent({ type: "hop", town: d.town, driver: String(d.driver || "Your friend").slice(0, 40), by: remotes.get(riding.num)?.car?.model || null })
      }
      sendHud(false)
    },
    // spatial voice: where you listen from and where everyone is (by number)
    voicePlace() {
      const people = {}
      const names = {}
      for (const r of remotes.values()) {
        names[r.num] = r.name
        people[r.num] = { x: r.x, z: r.z }
      }
      const p = center()
      return { listener: { x: p.x, z: p.z, yaw: cam.yaw }, people, court: null, me: myNum, names }
    },
    setVoiceTalk() {},
    // the eggs: found list
    get found() {
      return eggs.list()
    },
    // where you are (tests and the page)
    get info() {
      const p = center()
      return {
        me: { x: me.walker.x, y: me.walker.y, z: me.walker.z, yaw: me.walker.yaw, speed: me.walker.speed, mode: world.mode },
        car: car ? { id: car.id, model: car.model, color: car.color, x: car.x, y: car.y, z: car.z, yaw: car.yaw, speed: car.speed, steer: car.steer, hitT: car.hitT } : null,
        riding,
        at: p,
        latlon: frame.toLatLon(p.x, p.z),
        camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: cam.yaw },
        tiles: { built: tiles.size, near: [...tiles.values()].filter((e) => e.near).length, store: store.busy, edges: colliders.edges },
        parked: parkedList().length,
        action,
        remotes: [...remotes.values()].map((r) => ({ num: r.num, name: r.name, x: r.x, z: r.z, act: r.act, car: r.car })),
        net: net ? { you: myNum, info: netInfo ? { town: netInfo.town, n: netInfo.n } : null } : null,
        eggs: { found: eggs.foundCount, total: eggs.total },
        traffic: traffic.cars.map((t) => ({ id: t.id, x: t.x, z: t.z, yaw: t.yaw, speed: t.speed, road: t.road.name })),
        peds: peds.peds.map((p) => ({ id: p.id, x: p.x, z: p.z, speed: p.speed })),
        busy,
        canHail: traffic.canHail(me.walker.x, me.walker.z),
        seated: crowd.count,
        street: lastStreet,
      }
    },
    // (tests) somewhere else, the parked cars near you, the eggs
    teleport(x, z, yaw = me.walker.yaw) {
      if (driving) {
        car.x = x
        car.z = z
        car.yaw = yaw
        car.speed = 0
      } else {
        me.walker.x = x
        me.walker.z = z
        me.walker.yaw = yaw
        me.walker.vx = me.walker.vz = 0
      }
      cam.yaw = yaw
      cam.pos = null
      lastCenter = null
    },
    // the start picker: on foot at a start spot (out of any car first; tiles load round it)
    goToStart(spot) {
      if (!spot) return
      if (driving || riding) getOut()
      world.teleport(spot.x, spot.z, spot.yaw ?? me.walker.yaw)
      cam.yaw = spot.yaw ?? cam.yaw
      world.whenReady().then(() => !disposed && world.ensureOpen(spot))
      sendHud(true)
    },
    // not inside a building (coming out of a venue somewhere the town draws a wall round):
    // the venue's own way out, else the nearest open ground
    ensureOpen(spot = null) {
      if (driving || riding) return
      const w = me.walker
      const open = (x, z) => !colliders.inside(x, z) && !colliders.resolve(x, z, 0.5).hit && !seaAt(x, z)
      if (open(w.x, w.z)) return
      if (spot && open(spot.x, spot.z)) return world.teleport(spot.x, spot.z, spot.yaw ?? w.yaw)
      const x0 = spot ? spot.x : w.x
      const z0 = spot ? spot.z : w.z
      for (let r = 2; r < 120; r += 2)
        for (let a = 0; a < 16; a++) {
          const x = x0 + Math.cos((a / 16) * Math.PI * 2) * r
          const z = z0 + Math.sin((a / 16) * Math.PI * 2) * r
          if (open(x, z)) return world.teleport(x, z, w.yaw)
        }
    },
    // (tests: the scripted thumb) the closest point on a through road -> { x, z } | null
    nearestRoadPoint(x, z) {
      let best = null
      let bd = 60
      for (const e of tiles.values()) {
        if (!e.near) continue
        for (const r of e.t.roads) {
          if (!DRIVABLE.has(r.cls) || r.cls === ROAD.service || r.cls === ROAD.aisle || r.cls === ROAD.driveway) continue
          for (let i = 0; i + 1 < r.pts.length; i++) {
            const a = r.pts[i]
            const b = r.pts[i + 1]
            const dx = b.x - a.x
            const dz = b.z - a.z
            const L2 = dx * dx + dz * dz || 1e-9
            const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2))
            const px = a.x + dx * k
            const pz = a.z + dz * k
            const d = Math.hypot(x - px, z - pz)
            if (d < bd) {
              bd = d
              best = { x: px, z: pz }
            }
          }
        }
      }
      return best
    },
    // (tests) no wall between two points?
    clearPath: (x0, z0, x1, z1) => colliders.segment(x0, z0, x1, z1, -1e9) >= 1,
    // (tests) a point on a named street among the tiles drawn -> { x, z, yaw } | null
    findRoad(re) {
      const rx = new RegExp(re, "i")
      for (const e of tiles.values())
        for (const r of e.t.roads)
          if (rx.test(r.name) && r.pts.length > 1) {
            const a = r.pts[0]
            const b = r.pts[1]
            return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, yaw: Math.atan2(b.x - a.x, b.z - a.z), name: r.name, pts: r.pts.map((p) => ({ x: p.x, z: p.z })) }
          }
      return null
    },
    parkedNear(r = 60) {
      const p = center()
      return parkedList().filter((c) => Math.hypot(c.x - p.x, c.z - p.z) < r)
    },
    eggs,
    frameOf: frame,
    get draws() {
      return [...tiles.values()].reduce((n, e) => n + e.mesh.calls, 0)
    },
    heightAt,
    // (tests) what's drawn: shadows, trees, cars
    renderInfo: () => ({ sunI: +sun.intensity.toFixed(2), hemiI: +hemi.intensity.toFixed(2), sunPos: sun.position.toArray().map(Math.round), tgt: sun.target.position.toArray().map(Math.round), exposure, shadow: !!sun.shadow.map, shadowAt: { x: Math.round(shadowAt.x), z: Math.round(shadowAt.z), n: shadowAt.n, t: shadowAt.t, now: clock, nu: sun.shadow.needsUpdate }, sunDir: sunDir.toArray().map((v) => +v.toFixed(2)), trees: trees.nearCount, night: +night.toFixed(2) }),
    devSun: () => sun,
    devLife({ traffic: t, peds: p } = {}) {
      devLifeSet = true
      if (t !== undefined) traffic.cap = t
      if (p !== undefined) peds.cap = p
    },
    devShadowDirty: () => (shadowAt.dirty = true),
    // (tests) a kerb a passing car will come by: 70 m ahead of one, beside its lane
    devHailSpot() {
      const c = traffic.cars.find((q) => q.speed > 5 && roadLength(q.road) > 120 && (q.dir > 0 ? roadLength(q.road) - q.s : q.s) > 90)
      if (!c) return null
      const p = along(c.road, c.s + c.dir * 70)
      const hx = p.hx * c.dir
      const hz = p.hz * c.dir
      const off = c.road.width / 2 + 2.5
      return { x: p.x - hz * off, z: p.z + hx * off, yaw: Math.atan2(-hx, -hz) }
    },
    // (tests) what flagging down sees: each passing car's road, how far its line is, how far to go
    devHail: () =>
      traffic.cars.map((c) => {
        const at = projectOn(c.road, me.walker.x, me.walker.z)
        return { road: c.road.name, w: c.road.width, d: at.d, togo: (at.s - c.s) * c.dir, speed: c.speed }
      }),
    // (tests) a fixed lens for close-up shots: devCamera({ x, y, z }, { x, y, z }) or null
    devCamera(pos, look) {
      devCam = pos && look ? { pos, look } : null
    },
    setHour(h) {
      hourOverride = h
      applyLook()
    },
    // the train on to another town (the page swaps the world; anyone riding along comes too)
    trainTo(townId) {
      if (!onTransit || onTransit.line.kind !== "train") return false
      onEvent({ type: "train", town: townId })
      return true
    },
    // going to another town (the page swaps the world): your riders are told to come too
    hop(townId) {
      if (!net?.request) return Promise.resolve({ ok: true, riders: 0 })
      return net.request("roam:hop", { town: townId }).catch(() => ({ ok: false }))
    },
    // arriving from another town in your car: on the nearest through road to the town's
    // arrival spot, in its lane, facing along it
    arriveByCar: async ({ model = "sedan", color = 0x8a8f98, at: near = null } = {}) => {
      await world.whenReady()
      if (disposed || driving || riding) return false
      const sp = near || town.spawn || { x: 0, z: 0, yaw: 0 }
      let best = null
      let bd = 450
      for (const t of tilesAround(frame, sp.x, sp.z, 450)) {
        const d = store.get(tileKey(t))
        if (!d) continue
        for (const r of d.roads) {
          if (!DRIVABLE.has(r.cls) || r.cls === ROAD.driveway || r.cls === ROAD.aisle || r.cls === ROAD.link || r.flags & 6) continue
          for (let i = 0; i + 1 < r.pts.length; i++) {
            const a = r.pts[i]
            const b = r.pts[i + 1]
            const dx = b.x - a.x
            const dz = b.z - a.z
            const L2 = dx * dx + dz * dz
            if (L2 < 25) continue
            const k = Math.max(0.2, Math.min(0.8, ((sp.x - a.x) * dx + (sp.z - a.z) * dz) / L2))
            const px = a.x + dx * k
            const pz = a.z + dz * k
            const dd = Math.hypot(sp.x - px, sp.z - pz)
            if (dd < bd) {
              bd = dd
              const yaw = Math.atan2(dx, dz)
              // (a two-way street: the right-hand lane)
              const off = r.flags & 1 ? 0 : Math.min(3, r.width / 4)
              best = { x: px - Math.cos(yaw) * off, z: pz + Math.sin(yaw) * off, yaw }
            }
          }
        }
      }
      const at = best || { x: sp.x, z: sp.z, yaw: sp.yaw ?? 0 }
      me.walker.x = at.x
      me.walker.z = at.z
      getIn({ id: `hop:${model}:${Math.floor(Math.random() * 1e6)}`, model: MODELS[model] ? model : "sedan", color, x: at.x, z: at.z, yaw: at.yaw })
      lastCenter = null
      return true
    },
    whenReady: async () => {
      await store.ready()
      const c = center()
      const list = tilesAround(frame, c.x, c.z, 300)
      store.want(list)
      await store.whenLoaded(list)
      for (let i = 0; i < 4; i++) stepTiles(0)
    },
    dispose() {
      disposed = true
      for (const k of [...tiles.keys()]) dropTile(k)
      for (const k of [...figs.keys()]) dropFig(k)
      for (const r of remotes.values()) r.carMesh?.dispose()
      carMesh?.dispose()
      parkedLayer.dispose()
      trees.dispose()
      trafficLayer.dispose()
      crowd.dispose()
      streetLayer.dispose()
      audio?.horn?.(false)
      audio?.radio?.(false)
      for (const f of pedFigs.values()) f.dispose()
      for (const wk of walkers) wk.fig.dispose()
      fleetLayer.dispose()
      transitLayer.dispose()
      routeLine.dispose()
      if (ride && !(car?.auto === ride)) ride.mesh?.dispose()
      pedFigs.clear()
      eggs.dispose()
      sky?.dispose?.()
      disposeMaterials()
      for (const el of labelPool) el.remove()
    },
  }
  applyLook()
  sendHud(true)
  return world
}
