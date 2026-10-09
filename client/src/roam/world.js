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
// - hidden finds at real places (eggs.js).

import * as THREE from "three"
import { TILE_ZOOM, tileKey, tileOf, tilesAround, townFrame } from "./geo.js"
import { DRIVABLE, ROAD, tileHeightAt } from "./data/tile.js"
import { createTileStore } from "./stream.js"
import { buildTileMesh, disposeMaterials } from "./render/tilemesh.js"
import { treeSpots } from "./render/ground.js"
import { deckAt, deckSurfaces } from "./render/linework.js"
import { wallRings } from "./render/buildings.js"
import { createParkedLayer, makeCarMesh } from "./render/cars.js"
import { createColliders } from "./sim/collide.js"
import { createWalker, stepWalker } from "./sim/walker.js"
import { MODELS, createCar, doorSpot, personAhead, stepCar } from "./sim/car.js"
import { parkedCars } from "./sim/parked.js"
import { ACT, createTrack, packPos, pushSample, sampleTrack, shouldSend, unpackPos, DELAY } from "./sim/sync.js"
import { createEggs } from "./eggs.js"
import { createTreeLayer } from "./render/trees.js"

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

export const createRoam = ({ town, host = {}, phone = false, quality = "medium", start = null, labelsEl = null, onHud = () => {}, onEvent = () => {} } = {}) => {
  const frame = townFrame(town.origin)
  const store = createTileStore({ town, frame, fetchFn: host.fetch })
  const scene = new THREE.Scene()
  const low = quality === "low"
  // (how far the town is drawn: near tiles in full, far tiles as blocks; fog hides the edge)
  const NEAR_R = phone ? 380 : 560
  const FAR_R = low ? 700 : phone ? 900 : 1500
  const camera = new THREE.PerspectiveCamera(phone ? 62 : 58, 1, 0.35, FAR_R + 400)
  scene.fog = new THREE.Fog(0xd8ecfb, FAR_R * 0.45, FAR_R * 0.98)
  const hemi = new THREE.HemisphereLight(0xdcefff, 0x6d6a4c, 1.3)
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.4)
  sun.position.set(-0.4, 0.8, 0.3)
  scene.add(hemi, sun, sun.target)
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
    sun.color.setHex(d.sun.color)
    sun.intensity = d.sun.intensity
    sun.position.set(d.sun.dir.x, d.sun.dir.y, d.sun.dir.z)
    hemi.color.setHex(d.hemi[0])
    hemi.groundColor.setHex(d.hemi[1])
    hemi.intensity = d.hemi[2]
    scene.fog.color.setHex(d.fog)
    if (sky) scene.background = scene.fog.color
    exposure = d.exposure ?? 1
  }
  const stepSky = () => {
    if (clock - skyAt < 60) return
    skyAt = clock
    applyLook()
  }

  // ---------- the town's tiles ----------
  const tiles = new Map() // key -> { t (decoded), mesh, near, decks, trees, cars, walls }
  const colliders = createColliders()
  const parkedLayer = createParkedLayer(scene, phone ? 120 : 220)
  const trees = createTreeLayer(scene, { cap: low ? 0 : phone ? 1800 : 4500 })
  const moved = new Map() // parked car id -> { x, z, yaw } (left somewhere else this session) | "gone"
  let tilesDirty = true
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
  const ownGround = (t) => (x, z) => {
    const r = t.rect
    return tileHeightAt(t, Math.max(r.x0, Math.min(r.x1, x)), Math.max(r.z0, Math.min(r.z1, z))) ?? 0
  }

  const parkedList = () => {
    const out = []
    for (const e of tiles.values()) if (e.near && e.cars) for (const c of e.cars) {
      const m = moved.get(c.id)
      if (m === "gone") continue
      out.push(m ? { ...c, ...m } : c)
    }
    // (the hidden car: parked like the rest once its tile is near)
    for (const c of eggCars) {
      const m = moved.get(c.id)
      if (m === "gone") continue
      const p = m ? { ...c, ...m } : c
      const r = tiles.get(tileKey(tileOf(frame.toLatLon(p.x, p.z).lat, frame.toLatLon(p.x, p.z).lon, TILE_ZOOM)))
      if (r?.near) out.push(p)
    }
    return out
  }
  const placeCar = (c) => {
    const y = groundAt(c.x, c.z) ?? 0
    const m = MODELS[c.model] || MODELS.sedan
    const fx = Math.sin(c.yaw)
    const fz = Math.cos(c.yaw)
    const hf = groundAt(c.x + fx * m.wheelbase / 2, c.z + fz * m.wheelbase / 2) ?? y
    const hb = groundAt(c.x - fx * m.wheelbase / 2, c.z - fz * m.wheelbase / 2) ?? y
    return { ...c, y, pitch: Math.atan2(hf - hb, m.wheelbase), roll: 0 }
  }
  const refreshParked = () => parkedLayer.set(parkedList().map(placeCar).filter((c) => !driving || c.id !== car?.id))

  const buildTile = (t, near) => {
    const old = tiles.get(t.key)
    if (old) {
      old.mesh.dispose()
      if (old.near) colliders.removeTile(t.key)
    }
    const g = ownGround(t)
    const mesh = buildTileMesh(t, g, { near, texSize: near ? (phone ? 512 : 1024) : phone ? 128 : 256, anisotropy: host.anisotropy || 1 })
    scene.add(mesh.group)
    const e = { t, mesh, near, decks: deckSurfaces(t.roads), trees: near || !phone ? treeSpots(t, { max: near ? 500 : 150 }).map((p) => ({ ...p, y: g(p.x, p.z) })) : [], cars: near ? parkedCars(t) : null }
    if (near) colliders.addTile(t.key, wallRings(t.buildings, g))
    tiles.set(t.key, e)
    tilesDirty = true
    return e
  }
  const dropTile = (key) => {
    const e = tiles.get(key)
    if (!e) return
    e.mesh.dispose()
    if (e.near) colliders.removeTile(key)
    tiles.delete(key)
    tilesDirty = true
  }
  const center = () => (driving && car ? { x: car.x, z: car.z } : { x: me.walker.x, z: me.walker.z })
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
    if (tilesDirty) {
      tilesDirty = false
      refreshParked()
      trees.set([...tiles.values()].flatMap((e) => e.trees))
    }
  }
  const buildQueue = new Set()

  // ---------- you ----------
  const sp = start || town.spawn || { x: 0, z: 0, yaw: 0 }
  const me = { name: host.me?.name || "You", look: host.me?.look || null, walker: createWalker(sp.x, sp.z, sp.yaw ?? 0), x: sp.x, z: sp.z, y: 0, yaw: sp.yaw ?? 0 }
  let driving = false
  let riding = null // { num } the friend whose car you're in
  let car = null // the car you're driving (sim/car.js)
  let carMesh = null
  const input = { x: 0, y: 0, sprint: false, gas: 0, brake: 0, steer: 0 }
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
  const eggs = createEggs({ town, frame, scene, host, groundAt, onFound: (egg) => onEvent({ type: "found", egg }) })
  eggs.setTogether((e) => togetherAt(e))
  const eggCars = eggs.cars()

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
    if (c && c.seat !== 1 && !r.carMesh) {
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
    if (driving) return Math.abs(car.speed) < 2 ? { kind: "out", label: "Get out" } : null
    const w = me.walker
    // a friend's car to ride along in (the passenger door)
    for (const r of remotes.values()) {
      if (!r.car || r.car.seat === 1) continue
      if (Math.hypot(r.x - w.x, r.z - w.z) < 4.2 && r.speed < 2) return { kind: "ride", label: `Ride along with ${r.name}`, target: r.num }
    }
    const egg = eggs.nearest(w.x, w.z)
    if (egg) return { kind: "egg", label: egg.verb || "Take a look", target: egg.id }
    const c = nearestParked(w.x, w.z, 3.4)
    if (c) return { kind: "car", label: c.model === "turbo" ? "Get in the Turbo 98" : "Get in", target: c }
    const back = town.venues ? Object.entries(town.venues).find(([, v]) => v.back && Math.hypot(w.x - v.back.x, w.z - v.back.z) < v.back.r) : null
    if (back) return { kind: "venue", label: "Back to the courts", target: back[0] }
    return null
  }
  const getIn = (c) => {
    if (driving || riding) return
    driving = true
    car = createCar({ id: c.id, model: c.model, color: c.color, x: c.x, z: c.z, yaw: c.yaw })
    car.y = heightAt(c.x, c.z, me.walker.y, true) ?? me.walker.y
    moved.set(c.id, "gone")
    carMesh = makeCarMesh(c.model, c.color)
    scene.add(carMesh.group)
    dropFig("me")
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
      net?.request?.("roam:car", { car: null })
      lastSent = null
      onEvent({ type: "ride", on: false })
      return
    }
    if (!driving || !car) return
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
    sendHud(true)
  }
  // is a friend here with you (for the couple's find)?
  const togetherAt = (egg) => !!egg && [...remotes.values()].some((r) => Math.hypot(r.x - egg.x, r.z - egg.z) < 25)

  // ---------- the camera ----------
  const tmpA = new THREE.Vector3()
  const portrait = () => size.height > size.width * 1.05
  const updateCamera = (dt) => {
    let tx
    let ty
    let tz
    let yawWant
    let dist
    let height
    if (driving || riding) {
      const c = driving ? car : remotes.get(riding.num)
      if (!c) return
      tx = c.x
      tz = c.z
      ty = (c.y || 0) + 1.3
      // (behind the car, looking the way it goes; backing up, still behind)
      yawWant = c.yaw
      dist = (portrait() ? 8.6 : 7.4) + Math.min(3, Math.abs(c.speed || 0) * 0.08)
      height = 2.6
      cam.yaw = cam.yaw + wrap(yawWant - cam.yaw) * Math.min(1, dt * 3.2)
    } else {
      const w = me.walker
      tx = w.x
      tz = w.z
      ty = (w.y || 0) + 1.45
      dist = cam.dist
      // (a drag up or down tilts the view: lower sees more of the town ahead)
      height = 0.35 + cam.pitch * 2.2
      // (comes round behind you only when you walk away from it)
      if (w.speed > 0.6) {
        const away = Math.cos(wrap(w.yaw - cam.yaw))
        if (away > 0.3) {
          cam.behindT += dt
          if (cam.behindT > 0.35) cam.yaw += wrap(w.yaw - cam.yaw) * Math.min(1, dt * 1.6 * away)
        } else cam.behindT = 0
      } else cam.behindT = 0
    }
    const bx = tx - Math.sin(cam.yaw) * dist
    const bz = tz - Math.cos(cam.yaw) * dist
    // walls between you and the lens pull it in
    const f = colliders.segment(tx, tz, bx, bz, ty)
    const k = f < 1 ? Math.max(0.12, f - 0.06) : 1
    let cx = tx + (bx - tx) * k
    let cz = tz + (bz - tz) * k
    let cy = ty + height * (0.55 + 0.45 * k)
    // (never under the ground)
    const g = groundAt(cx, cz)
    if (g !== null && cy < g + 0.8) cy = g + 0.8
    if (!cam.pos) cam.pos = new THREE.Vector3(cx, cy, cz)
    const lerp = Math.min(1, dt * (driving || riding ? 8 : 10))
    cam.pos.x += (cx - cam.pos.x) * lerp
    cam.pos.y += (cy - cam.pos.y) * lerp
    cam.pos.z += (cz - cam.pos.z) * lerp
    camera.position.copy(cam.pos)
    // (upright phones: you sit a little above the middle, the way ahead above the thumbs)
    // (looking a little past you, the way the camera faces: more town, less ground)
    const ahead = driving || riding ? 4 : 2.5
    tmpA.set(tx + Math.sin(cam.yaw) * ahead, ty + (driving || riding ? 0.2 : 0.45), tz + Math.cos(cam.yaw) * ahead)
    camera.lookAt(tmpA)
    if (portrait()) camera.setViewOffset(size.width, size.height, 0, size.height * (driving || riding ? 0.1 : 0.14), size.width, size.height)
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
    }
    // the others
    for (const r of remotes.values()) {
      const inCar = (r.act & ACT.drive) && r.carMesh
      if (r.carMesh) {
        r.carMesh.group.visible = !!(r.act & ACT.drive)
        const g = heightAt(r.x, r.z, r.y, true)
        r.carMesh.group.position.set(r.x, Number.isFinite(g) ? g : r.y, r.z)
        r.carMesh.group.rotation.set(0, r.yaw, 0)
      }
      const hidden = inCar || (r.act & ACT.ride)
      if (hidden || Math.hypot(r.x - camera.position.x, r.z - camera.position.z) > 120) {
        dropFig(`r${r.num}`)
        continue
      }
      const fig = figFor(`r${r.num}`, r.look)
      if (fig) fig.update({ x: r.x, y: r.y, z: r.z, yaw: r.yaw, vx: Math.sin(r.yaw) * r.speed, vz: Math.cos(r.yaw) * r.speed, speed: r.speed }, dt)
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
    const hud = {
      mode: driving ? "drive" : riding ? "ride" : "walk",
      action: action ? { kind: action.kind, label: action.label } : null,
      speed: driving ? Math.round(Math.abs(car.speed) * 2.237) : riding ? Math.round((remotes.get(riding.num)?.speed || 0) * 2.237) : 0,
      street: frameNo % 4 === 0 || force ? streetAt(pos.x, pos.z) : lastStreet,
      found: eggs.foundCount,
      total: eggs.total,
      hint: eggs.hint(pos.x, pos.z),
      loading: tiles.size === 0,
      online: net ? { people: remotes.size + 1, you: myNum } : null,
      riders: driving ? [...remotes.values()].filter((r) => r.car?.seat === 1 && r.car.driver === myNum).map((r) => r.name) : [],
      sprint: input.sprint,
    }
    lastStreet = hud.street
    const s = JSON.stringify(hud)
    if (!force && s === lastHud) return
    lastHud = s
    onHud(hud)
  }
  let lastStreet = ""
  let frameNo = 0

  // ---------- online: sending ----------
  const myPos = () => {
    if (driving && car) return { x: car.x, z: car.z, y: car.y, yaw: car.yaw, speed: car.speed, act: ACT.drive | (Math.abs(car.speed) > 0.1 ? ACT.move : 0) }
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
    stepSky()
    stepTiles(dt)
    // keys
    const kx = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0)
    const ky = (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0) - (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0)
    const shift = keys.has("ShiftLeft") || keys.has("ShiftRight")
    const people = [...remotes.values()].filter((r) => !(r.act & (ACT.drive | ACT.ride))).map((r) => ({ x: r.x, z: r.z }))
    if (driving && car) {
      const gas = Math.max(input.gas, ky > 0 ? 1 : 0)
      const brake = Math.max(input.brake, ky < 0 ? 1 : 0)
      const steer = Math.max(-1, Math.min(1, input.steer + kx))
      stepCar(car, { gas, brake, steer }, dt, { resolve: (x, z, r) => colliders.resolve(x, z, r), heightAt: (x, z, y) => heightAt(x, z, y, true), blocked: (x, z, yaw, dir, m) => personAhead(people, x, z, yaw, dir, m) })
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
      stepWalker(me.walker, { x: ix, y: iy, sprint: input.sprint || shift }, cam.yaw, dt, { resolve: (x, z, r) => colliders.resolve(x, z, r), heightAt: (x, z, y) => heightAt(x, z, y, false) })
    }
    stepRemotes()
    eggs.step(dt, center(), clock, camera)
    updateCamera(dt)
    // (the sky dome rides with the lens: the town is bigger than the dome)
    if (sky?.mesh) sky.mesh.position.set(camera.position.x, 0, camera.position.z)
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
      return driving ? "drive" : riding ? "ride" : "walk"
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
        keys.add(code)
      } else keys.delete(code)
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
      cam.pitch = Math.max(0.05, Math.min(0.9, cam.pitch + dy * 0.004))
    },
    action: doAction,
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
        car: car ? { id: car.id, model: car.model, x: car.x, y: car.y, z: car.z, yaw: car.yaw, speed: car.speed, steer: car.steer, hitT: car.hitT } : null,
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
    // not inside a building (coming out of a venue somewhere the town draws a wall round):
    // the venue's own way out, else the nearest open ground
    ensureOpen(spot = null) {
      if (driving || riding) return
      const w = me.walker
      const open = (x, z) => !colliders.inside(x, z) && !colliders.resolve(x, z, 0.5).hit
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
    setHour(h) {
      hourOverride = h
      applyLook()
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
