// Roam life: your private Home and Work places (pure; Node-tested; the server loads this same
// file to check a place: server/roam/life.js).
//
// The owner: "go to my work, go to her house", "go to my work... like the office". A place is a
// building YOU pick at runtime in the in-game phone's Maps (or the one you stand by): nothing
// about any real home or workplace is in the code, data or tests. It's kept on your account
// (server/roam/life.js) or, signed off, on this device; it's private until you share it with
// the buddies you pick (they then see "Ava's home" on their map). Delete My Account erases it.
//
// A place: { id, kind: "home" | "work", label, town, x, z, door: { x, z, yaw }, shared: [keys] }
// x, z: the building's middle in the town's frame (metres); door: where "Go inside" is (just
// outside the wall nearest the street, facing the building).

export const PLACE_KINDS = ["home", "work"]
export const PLACE_MAX = 10 // places a person
export const SHARE_MAX = 10 // people one place is shared with
export const LABEL_MAX = 40
const REACH = 30000 // metres from a town's origin (server/roam TOWNS reach)
const TOWN_ID = /^[a-z][a-z0-9]{1,23}$/
const ID = /^[a-z0-9]{4,16}$/

const num = (v, lo, hi) => (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Math.round(Number(v) * 10) / 10 : null)
export const defaultLabel = (kind) => (kind === "work" ? "Work" : "Home")
const cleanText = (s, max) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f<>]/g, "")
    .trim()
    .slice(0, max)

// whatever came in -> a place, or null
export const cleanPlace = (p) => {
  if (!p || typeof p !== "object" || Array.isArray(p)) return null
  const kind = PLACE_KINDS.includes(p.kind) ? p.kind : null
  const id = typeof p.id === "string" && ID.test(p.id) ? p.id : null
  const town = typeof p.town === "string" && TOWN_ID.test(p.town) ? p.town : null
  const x = num(p.x, -REACH, REACH)
  const z = num(p.z, -REACH, REACH)
  const d = p.door && typeof p.door === "object" ? p.door : {}
  const door = { x: num(d.x, -REACH, REACH), z: num(d.z, -REACH, REACH), yaw: num(d.yaw, -7, 7) ?? 0 }
  if (!kind || !id || !town || x === null || z === null || door.x === null || door.z === null) return null
  const shared = Array.isArray(p.shared) ? [...new Set(p.shared.filter((k) => typeof k === "string" && /^[a-z0-9]{1,32}$/.test(k)))].slice(0, SHARE_MAX) : []
  return { id, kind, label: cleanText(p.label, LABEL_MAX) || defaultLabel(kind), town, x, z, door, shared }
}
export const cleanPlaces = (list) => {
  const out = []
  const ids = new Set()
  for (const p of Array.isArray(list) ? list : []) {
    const c = cleanPlace(p)
    if (!c || ids.has(c.id)) continue
    ids.add(c.id)
    out.push(c)
    if (out.length >= PLACE_MAX) break
  }
  return out
}
export const newPlaceId = (rand = Math.random) => Array.from({ length: 10 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rand() * 36)]).join("")

// how a place reads on someone else's map: "Ava's home", "Ben's work" (their own label after)
export const sharedLabel = (ownerName, place) => {
  const who = String(ownerName || "A friend")
  const base = `${who}${/s$/i.test(who) ? "'" : "'s"} ${place.kind === "work" ? "work" : "home"}`
  const own = place.label && place.label !== defaultLabel(place.kind) ? ` (${place.label})` : ""
  return base + own
}

// ---- picking a building ----
const centroid = (ring) => {
  let x = 0
  let z = 0
  for (const p of ring) {
    x += p.x
    z += p.z
  }
  return { x: x / ring.length, z: z / ring.length }
}
export const insideRing = (ring, x, z) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z || 1e-9) + a.x) inside = !inside
  }
  return inside
}
// the nearest point on a ring's edge -> { x, z, d, nx, nz } (n: the outward normal there)
export const nearestEdge = (ring, x, z) => {
  let best = null
  const c = centroid(ring)
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const L2 = dx * dx + dz * dz
    if (L2 < 1e-6) continue
    const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2))
    const px = a.x + dx * k
    const pz = a.z + dz * k
    const d = Math.hypot(x - px, z - pz)
    if (!best || d < best.d) {
      const L = Math.sqrt(L2)
      let nx = dz / L
      let nz = -dx / L
      // (outward: away from the middle)
      if ((px - c.x) * nx + (pz - c.z) * nz < 0) {
        nx = -nx
        nz = -nz
      }
      best = { x: px, z: pz, d, nx, nz }
    }
  }
  return best
}
// where the door is: on the wall nearest the street point given (or the tap), 1.6 m out, facing
// the building. building: { ring: [{ x, z }] }; toward: { x, z } (the nearest road, or the tap)
export const doorFor = (building, toward) => {
  const ring = building?.ring || []
  if (ring.length < 3) return null
  const c = centroid(ring)
  const e = nearestEdge(ring, toward?.x ?? c.x, toward?.z ?? c.z + 1000)
  if (!e) return null
  const x = e.x + e.nx * 1.6
  const z = e.z + e.nz * 1.6
  return { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, yaw: Math.round(Math.atan2(-e.nx, -e.nz) * 100) / 100 }
}
// a place for a picked building -> a clean place (kind, label, town given)
export const placeFor = ({ building, toward, kind, label = "", town, id }) => {
  if (!building?.ring?.length) return null
  const c = centroid(building.ring)
  return cleanPlace({ id, kind, label, town, x: c.x, z: c.z, door: doorFor(building, toward) })
}
// is someone at a place's door (Go inside)?
export const atDoor = (place, x, z, r = 6) => !!place?.door && Math.hypot(place.door.x - x, place.door.z - z) <= r
