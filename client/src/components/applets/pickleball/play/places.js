// Pickleball 98: where you play. One list for a match, Practice and online rooms: the real
// venues from My Park (the hand-built ones: OpenStreetMap + the aerial + photos), the Venue
// Finder courts you starred or visited, and the five made-up arenas (venue.js). The same
// choice opens My Park, so the venue carries from one to the other. Pure: no React.
//
// A place: { id, kind: "real" | "live" | "arena", name, short, city, lat, lon, lit, indoor,
//   time (arenas: their own fixed light) }

import { VENUE_LIST } from "../park/venues/index.js"
import { VENUE_INFO } from "../looks.js"
import { isLiveId } from "../park/live/liveVenue.js"
import { nightOk, timeAt, timeLabel } from "../park/timeofday.js"

export const ARENA_IDS = Object.keys(VENUE_INFO)
export const isArena = (id) => ARENA_IDS.includes(id)
export const isReal = (id) => VENUE_LIST.some((v) => v.id === id)

const realPlace = (v) => ({ id: v.id, kind: "real", name: v.name, short: v.short || v.name, city: v.city, lat: v.lat, lon: v.lon, lit: !!v.lit, indoor: !!v.indoor, courts: v.courts })
const livePlace = (p) => ({ id: p.id, kind: "live", name: p.title || p.short || "Pickleball courts", short: p.short || p.title || "Pickleball courts", city: p.town || "", lat: p.lat, lon: p.lon, lit: !!p.lit, indoor: !!p.indoor, shard: p.shard, courts: p.courts })
const arenaPlace = (v) => ({ id: v.id, kind: "arena", name: v.name, short: v.name, city: "Made-up arena", time: v.time, lit: true, indoor: false })

// the picker's list: { real, finder, arenas }; favs (My Park's stars) first among the real ones
export const placeLists = (prefs = {}) => {
  const favs = Array.isArray(prefs.parkFavs) ? prefs.parkFavs : []
  const real = VENUE_LIST.map(realPlace).sort((a, b) => (favs.includes(b.id) ? 1 : 0) - (favs.includes(a.id) ? 1 : 0))
  const kept = prefs.parkPlaces || {}
  const finder = Object.values(kept)
    .filter((p) => p && isLiveId(p.id) && Number.isFinite(p.lat))
    .sort((a, b) => (favs.includes(b.id) ? 1 : 0) - (favs.includes(a.id) ? 1 : 0) || (b.at || 0) - (a.at || 0))
    .slice(0, 8)
    .map(livePlace)
  const arenas = Object.values(VENUE_INFO).map(arenaPlace)
  return { real, finder, arenas }
}

// one place by id (null: unknown, e.g. a Venue Finder venue no longer kept)
export const placeById = (id, prefs = {}) => {
  if (!id) return null
  if (isArena(id)) return arenaPlace(VENUE_INFO[id])
  const v = VENUE_LIST.find((x) => x.id === id)
  if (v) return realPlace(v)
  const p = prefs.parkPlaces?.[id]
  return p && Number.isFinite(p.lat) ? livePlace(p) : null
}

// the place you play now: prefs.venue if it still exists, else Riverside Park (the arena)
export const currentPlace = (prefs = {}) => placeById(prefs.venue, prefs) || arenaPlace(VENUE_INFO.park)

// "Newport Beach Club · Golden hour" (an arena's light is its own)
export const placeText = (place, tod) => {
  if (!place) return ""
  if (place.kind === "arena") return `${place.short} · ${place.time}`
  return `${place.short} · ${timeLabel(timeAt(tod, place))}`
}
// a line under a place in the picker
export const placeNote = (place) => {
  if (place.kind === "arena") return `Made-up arena · ${place.time}`
  const bits = [place.city, place.indoor ? "indoor" : "outdoor"]
  if (!nightOk(place)) bits.push("no court lights")
  return bits.filter(Boolean).join(" · ")
}
