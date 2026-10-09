// Roam life in the town: the doors you can go in by (your private Home and Work, the warehouse
// club at the map's real wholesale buildings, the mall), the places on your phone's map, and the
// things you put down (a grill, a cooler, a beach umbrella...). One plug-in for the town's world
// (world.use).
//
// - Your places come from host.life (your account, or this device): a door you walk up to says
//   "Go inside" (home or work); a place a friend shares with you shows on your map ("Ava's home")
//   and at its door says who it belongs to (she invites you in: her own place is hers).
// - Stores: the map's places of kind "wholesale" (OSM shop=wholesale) are Big Crate 98 (an
//   original name on an original sign over the door; the real building's footprint from the map);
//   a "mall" place is the mall. The door is on the wall nearest the street.
// - Put down: the Bag's grill, cooler, umbrella, chairs, pool float, picnic blanket, in front of
//   you on open ground; everyone in the town instance sees them (roam:place); sit by them.
//
//   const life = createTownLife({ world, host, social, onEvent })
//   world.use(life.plugin); life.put(kind) -> { ok, error }

import * as THREE from "three"
import { atDoor, doorFor, sharedLabel } from "./places.js"
import { STORES } from "./catalog.js"

const PLACE_LABEL = { grill: "the grill", cooler: "the cooler", umbrella: "the umbrella", chairs: "the beach chairs", float: "the pool float", blanket: "the picnic blanket" }

// ---- things put down: made in code from a few shapes each ----
const mats = new Map()
const mat = (c) => {
  if (!mats.has(c)) mats.set(c, new THREE.MeshLambertMaterial({ color: c }))
  return mats.get(c)
}
const part = (g, geo, color, x, y, z, rx = 0, rz = 0) => {
  const m = new THREE.Mesh(geo, mat(color))
  m.position.set(x, y, z)
  m.rotation.set(rx, 0, rz)
  m.castShadow = true
  g.add(m)
  return m
}
export const makeThing = (kind) => {
  const g = new THREE.Group()
  if (kind === "grill") {
    part(g, new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0x1e1e1e, 0, 0.82, 0)
    part(g, new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), 0x262626, 0, 0.84, 0)
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      part(g, new THREE.CylinderGeometry(0.015, 0.015, 0.75, 6), 0x444444, Math.sin(a) * 0.18, 0.38, Math.cos(a) * 0.18, Math.cos(a) * 0.25, -Math.sin(a) * 0.25)
    }
    part(g, new THREE.SphereGeometry(0.09, 8, 6), 0xff6a1f, 0, 0.9, 0) // (the coals' glow)
  } else if (kind === "cooler") {
    part(g, new THREE.BoxGeometry(0.62, 0.4, 0.4), 0x2f6fd6, 0, 0.24, 0)
    part(g, new THREE.BoxGeometry(0.64, 0.07, 0.42), 0xffffff, 0, 0.47, 0)
    for (const x of [-0.24, 0.24]) part(g, new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10), 0x222222, x, 0.05, -0.2, 0, Math.PI / 2)
  } else if (kind === "umbrella") {
    part(g, new THREE.CylinderGeometry(0.02, 0.02, 2.2, 6), 0xdddddd, 0, 1.1, 0)
    const top = part(g, new THREE.ConeGeometry(1.25, 0.45, 12, 1, true), 0xef476f, 0, 2.15, 0)
    top.material.side = THREE.DoubleSide
  } else if (kind === "chairs") {
    for (const x of [-0.45, 0.45]) {
      part(g, new THREE.BoxGeometry(0.55, 0.05, 0.6), 0x18a3b5, x, 0.35, 0)
      part(g, new THREE.BoxGeometry(0.55, 0.62, 0.05), 0x18a3b5, x, 0.62, -0.32, -0.3)
      for (const [dx, dz] of [[-0.25, 0.27], [0.25, 0.27], [-0.25, -0.27], [0.25, -0.27]]) part(g, new THREE.CylinderGeometry(0.015, 0.015, 0.35, 5), 0xcccccc, x + dx, 0.17, dz)
    }
  } else if (kind === "float") {
    part(g, new THREE.TorusGeometry(0.42, 0.16, 8, 18), 0xff6fb0, 0, 0.16, 0, Math.PI / 2)
    part(g, new THREE.CylinderGeometry(0.07, 0.09, 0.5, 8), 0xff6fb0, 0, 0.42, 0.4, -0.3)
  } else if (kind === "blanket") {
    part(g, new THREE.BoxGeometry(1.6, 0.02, 1.3), 0xd62828, 0, 0.012, 0)
    for (let i = -2; i <= 2; i++) part(g, new THREE.BoxGeometry(0.08, 0.022, 1.3), 0xffffff, i * 0.32, 0.013, 0)
    part(g, new THREE.BoxGeometry(0.45, 0.28, 0.3), 0xa0703c, 0.4, 0.15, 0.3)
  }
  g.userData.kind = kind
  return g
}

// a store's sign over its door: the original name on a lit board
const signFor = (text, bg, fg) => {
  const cv = document.createElement("canvas")
  cv.width = 512
  cv.height = 96
  const c = cv.getContext("2d")
  c.fillStyle = bg
  c.fillRect(0, 0, 512, 96)
  c.fillStyle = fg
  c.font = "800 56px system-ui, sans-serif"
  c.textAlign = "center"
  c.textBaseline = "middle"
  c.fillText(text, 256, 50)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.5), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }))
  return m
}

export const createTownLife = ({ world, host, social = null, onEvent = () => {} }) => {
  const town = world.town
  const life = host.life
  const group = new THREE.Group()
  world.scene.add(group)
  const things = new Map() // id -> { item, mesh }
  const stores = [] // { kind: "club" | "mall", name, key, x, z, door?, sign? }
  let navAsked = false
  const fixed = new Set()

  // the map's warehouse clubs and malls (places.json), their doors found once you're near
  const findStores = async () => {
    navAsked = true
    if (!(await world.loadNav?.())) return
    const list = world.navData?.places || []
    for (const p of list) {
      const kind = p.kind === "wholesale" ? "club" : p.kind === "mall" ? "mall" : null
      if (!kind) continue
      if (stores.some((s) => s.kind === kind && Math.hypot(s.x - p.x, s.z - p.z) < 120)) continue
      stores.push({ kind, place: p.name, name: kind === "club" ? STORES.club.name : "the mall", key: `${kind}:${Math.round(p.x)}:${Math.round(p.z)}`, x: p.x, z: p.z, door: null, sign: null, tries: 0 })
    }
  }
  const placeDoor = (s) => {
    // the building the map names (its footprint), the door on the side nearest the street
    const b = world.buildingAt(s.x, s.z, 40)
    if (!b) return
    const road = world.nearestRoadPoint?.(b.x, b.z)
    s.door = doorFor(b, road || { x: s.x, z: s.z - 100 })
    if (!s.door) return
    if (s.kind === "club" && typeof document !== "undefined") {
      s.sign = signFor(STORES.club.name.toUpperCase(), "#c8102e", "#ffffff")
      const y = world.heightAt?.(s.door.x, s.door.z, 0) ?? 0
      // (on the wall over the door: 1.7 m back in from the door spot, 6 m up, facing out)
      s.sign.position.set(s.door.x + Math.sin(s.door.yaw) * 1.66, y + 6, s.door.z + Math.cos(s.door.yaw) * 1.66)
      s.sign.rotation.y = s.door.yaw + Math.PI
      group.add(s.sign)
    }
  }

  // ---- your places ----
  const placesHere = () => (life?.state?.places || []).filter((p) => p.town === town.id)
  const sharedHere = () => (life?.state?.shared || []).filter((p) => p.town === town.id)

  // ---- put down / pick up ----
  const addThing = (item) => {
    if (things.has(item.id)) return
    const mesh = makeThing(item.kind)
    const y = world.heightAt?.(item.x, item.z, 0) ?? 0
    mesh.position.set(item.x, y, item.z)
    mesh.rotation.y = item.yaw
    group.add(mesh)
    things.set(item.id, { item, mesh, mine: item.by === world.myNum || item.local })
  }
  const dropThing = (id) => {
    const t = things.get(id)
    if (!t) return
    t.mesh.removeFromParent()
    t.mesh.traverse((o) => o.geometry?.dispose())
    things.delete(id)
  }
  let localN = 0
  const put = async (kind) => {
    const me = world.meNow()
    if (!me) return { ok: false, error: "Get out of the car first." }
    const x = me.x + Math.sin(me.yaw) * 1.6
    const z = me.z + Math.cos(me.yaw) * 1.6
    if (!world.isOpen?.(x, z)) return { ok: false, error: "There's no room right there. Try open ground." }
    const yaw = me.yaw + Math.PI
    const net = world.net
    if (net?.request) {
      const r = await net.request("roam:place", { kind, x, z, yaw }).catch(() => null)
      if (r?.ok) {
        addThing(r.item)
        return { ok: true }
      }
      if (r && !r.ok) return r
    }
    addThing({ id: `local${++localN}`, kind, x, z, yaw, local: true })
    return { ok: true }
  }
  const pickUp = async (t) => {
    if (!t.item.local) await world.net?.request?.("roam:unplace", { id: t.item.id }).catch(() => null)
    dropThing(t.item.id)
    onEvent({ type: "pickedUp", kind: t.item.kind })
  }

  const plugin = {
    action(w) {
      // a door: yours, a friend's, a store's
      for (const p of placesHere()) if (atDoor(p, w.x, w.z, 4)) return { label: p.kind === "work" ? `Go inside: ${p.label}` : `Go inside: ${p.label}`, run: () => onEvent({ type: "enter", kind: p.kind === "work" ? "office" : "home", place: p }) }
      for (const p of sharedHere()) if (atDoor(p, w.x, w.z, 4)) return { label: `${sharedLabel(p.ownerName, p)}: knock`, run: () => onEvent({ type: "knock", place: p }) }
      for (const s of stores) if (s.door && Math.hypot(s.door.x - w.x, s.door.z - w.z) < 5) return { label: s.kind === "club" ? `Go into ${s.name}` : "Go into the mall", run: () => onEvent({ type: "enter", kind: s.kind, store: s }) }
      // things put down: sit by them; yours can be picked up
      let best = null
      for (const t of things.values()) {
        const d = Math.hypot(t.item.x - w.x, t.item.z - w.z)
        if (d < 2.6 && (!best || d < best.d)) best = { t, d }
      }
      if (best) {
        const { t } = best
        const seated = social?.state?.sitting
        if (!seated)
          return {
            label: t.item.kind === "chairs" ? "Sit in a beach chair" : `Sit by ${PLACE_LABEL[t.item.kind]}`,
            run: () => {
              const me = world.meNow()
              if (!me) return
              const yaw = Math.atan2(t.item.x - me.x, t.item.z - me.z)
              if (t.item.kind === "chairs") {
                // (in the chair: on its seat, looking out the way it faces)
                const cx = t.item.x - Math.cos(t.item.yaw) * 0.45
                const cz = t.item.z + Math.sin(t.item.yaw) * 0.45
                world.teleport?.(cx, cz, t.item.yaw + Math.PI)
                social?.sitAt({ x: cx, y: me.y, z: cz, yaw: t.item.yaw + Math.PI, h: 0.36 })
              } else social?.sitAt({ x: me.x, y: me.y, z: me.z, yaw })
            },
          }
        if (t.mine && !seated) return { label: `Pick up ${PLACE_LABEL[t.item.kind]}`, run: () => pickUp(t) }
      }
      return null
    },
    step() {
      if (!navAsked) findStores()
      const me = world.meNow()
      if (!me) return
      for (const s of stores) if (!s.door && s.tries < 40 && Math.hypot(s.x - me.x, s.z - me.z) < 320) {
        s.tries++
        placeDoor(s)
      }
      // a place set from far off on the map (its door still the tapped spot): its building's
      // real door once the building is loaded near you
      for (const p of placesHere()) {
        if (p.door.x !== p.x || p.door.z !== p.z || fixed.has(p.id) || Math.hypot(p.x - me.x, p.z - me.z) > 300) continue
        const b = world.buildingAt(p.x, p.z, 30)
        if (!b) continue
        fixed.add(p.id)
        const road = world.nearestRoadPoint?.(b.x, b.z)
        const door = doorFor(b, road || { x: p.x, z: p.z - 100 })
        if (door) life?.savePlace({ ...p, x: Math.round(b.x * 10) / 10, z: Math.round(b.z * 10) / 10, door })
      }
    },
    netEvent(type, d) {
      if (type === "joined") for (const it of d?.placed || []) addThing(it)
      else if (type === "roam:placed" && d?.item) addThing(d.item)
      else if (type === "roam:unplaced" && d?.id) dropThing(d.id)
    },
    // the phone's map: your Home/Work, places shared with you, the stores
    pins() {
      const out = []
      for (const p of placesHere()) out.push({ x: p.door.x, z: p.door.z, kind: p.kind, name: p.label, mine: true })
      for (const p of sharedHere()) out.push({ x: p.door.x, z: p.door.z, kind: p.kind, name: sharedLabel(p.ownerName, p), mine: false })
      for (const s of stores) out.push({ x: s.door?.x ?? s.x, z: s.door?.z ?? s.z, kind: s.kind, name: s.kind === "club" ? `${s.name} (${s.place})` : s.place, mine: false })
      return out
    },
  }
  const off = world.use(plugin)
  return {
    plugin,
    put,
    stores,
    things,
    placesHere,
    dispose() {
      off()
      for (const id of [...things.keys()]) dropThing(id)
      for (const s of stores) {
        s.sign?.material.map?.dispose()
        s.sign?.material.dispose()
        s.sign?.geometry.dispose()
      }
      group.removeFromParent()
    },
  }
}
