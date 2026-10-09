// Roam towns: each is configuration only (docs/open-world.md "How to add a town").
import valencia from "./valencia.js"
import simi from "./simi.js"
import northridge from "./northridge.js"
import newport from "./newport.js"

export const TOWNS = { valencia, simi, northridge, newport }
export const townById = (id) => TOWNS[id] || null
// the town a My Park venue opens onto (Explore Valencia from the Paseo Club) -> town | null
export const townForVenue = (venueId) => Object.values(TOWNS).find((t) => t.venues && t.venues[venueId]) || null

// where you arrive (docs/open-world.md "Arriving"): a town's start spots, the liveliest first.
// id: a start's id (the one you picked last time), else the first -> { id, name, kind, x, z, yaw, venue? }
export const startSpots = (town) => (town?.starts?.length ? town.starts : [{ id: "spawn", name: town?.name || "Town", kind: "venue", ...(town?.spawn || { x: 0, z: 0, yaw: 0 }) }])
export const startSpot = (town, id = null) => {
  const list = startSpots(town)
  const s = list.find((p) => p.id === id) || list[0]
  const yaw = s.look ? Math.atan2(s.look.x - s.x, s.look.z - s.z) : s.yaw ?? 0
  return { ...s, yaw }
}
