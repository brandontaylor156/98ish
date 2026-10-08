// "Meet me at <venue>": Pickleball 98's real venues (and the Venue Finder courts you kept) as
// small cards for 98 Messenger, and as places for Buddy Locator's arrive/leave alerts. Pure:
// no React. The venue list itself is My Park's (park/venues/index.js VENUE_LIST); street
// addresses are Real Games' (pbclub/clubCore.js VENUES).
//
// A card (checked again by the server, server/aim/cards.js):
//   { k: "venue", id, n (name), lat, lon, a? (street address), c? (town), sh? (index shard) }

import { VENUE_LIST } from "../park/venues/index.js"
import { VENUES as CLUB_VENUES } from "../../pbclub/clubCore.js"

const LIVE_ID = /^o[nwr]\d+b?$/
const SHARD = /^[a-z0-9]{1,12}$/
const finite = (v) => typeof v === "number" && Number.isFinite(v)

export const isRealVenue = (id) => VENUE_LIST.some((v) => v.id === id)

// a real venue's card
export const realCard = (id) => {
  const v = VENUE_LIST.find((x) => x.id === id)
  if (!v) return null
  const address = CLUB_VENUES.find((x) => x.id === id)?.address
  return { k: "venue", id: v.id, n: v.name, lat: v.lat, lon: v.lon, ...(address ? { a: address } : {}), ...(v.city ? { c: v.city } : {}) }
}

// a Venue Finder court you kept (Pickleball 98 prefs.parkPlaces[id]) -> its card
export const finderCard = (p) => {
  if (!p || !LIVE_ID.test(String(p.id || "")) || !finite(p.lat) || !finite(p.lon)) return null
  const n = String(p.title || p.short || "Pickleball courts").slice(0, 60)
  return { k: "venue", id: p.id, n, lat: p.lat, lon: p.lon, ...(p.town ? { c: String(p.town).slice(0, 40) } : {}), ...(SHARD.test(String(p.shard || "")) ? { sh: p.shard } : {}) }
}

// what Messenger's "Meet me at..." list offers: the real venues (your My Park stars first),
// then up to 8 Venue Finder courts you kept, newest first
export const meetChoices = (prefs = {}) => {
  const favs = Array.isArray(prefs.parkFavs) ? prefs.parkFavs : []
  const real = VENUE_LIST.map((v) => ({ id: v.id, short: v.short || v.name, note: v.city, card: realCard(v.id) })).sort((a, b) => (favs.includes(b.id) ? 1 : 0) - (favs.includes(a.id) ? 1 : 0))
  const finder = Object.values(prefs.parkPlaces || {})
    .filter((p) => p && LIVE_ID.test(String(p.id || "")))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, 8)
    .map((p) => ({ id: p.id, short: p.short || p.title || "Pickleball courts", note: p.town || "From Venue Finder", card: finderCard(p) }))
    .filter((x) => x.card)
  return { real, finder }
}

// a card as received: the shape checked again on this side (the server already cleaned it)
export const venueCardOk = (c) =>
  !!c && c.k === "venue" && typeof c.id === "string" && /^[a-z0-9]{1,24}$/.test(c.id) && typeof c.n === "string" && !!c.n && finite(c.lat) && finite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180

// a card -> what Pickleball 98's handoff needs to open My Park there: a real venue by id; a
// Venue Finder court also with what My Park keeps of it (prefs.parkPlaces)
export const parkHandoff = (c) => {
  if (!venueCardOk(c)) return null
  if (isRealVenue(c.id)) return { venue: c.id }
  if (!LIVE_ID.test(c.id)) return null
  return { venue: c.id, place: { title: c.n, lat: c.lat, lon: c.lon, ...(c.c ? { town: c.c } : {}), ...(c.sh ? { shard: c.sh } : {}) } }
}

// the card's directions (Maps 98: utils/maps.js openMaps)
export const directionsFor = (c) => (venueCardOk(c) ? { name: c.n, lat: c.lat, lon: c.lon, address: c.a || c.c || "", directions: true } : null)

// a place in the where & when sheet (places.js: real | live | arena) -> openMaps' options, or
// null (an arena is made up: nowhere to drive to)
export const placeDirections = (place) => {
  if (!place || place.kind === "arena") return null
  if (place.kind === "real") return directionsFor(realCard(place.id))
  return finite(place.lat) && finite(place.lon) ? { name: place.name, lat: place.lat, lon: place.lon, address: place.city || "", directions: true } : null
}

// ---- Buddy Locator: the real venues as places (arrive/leave alerts) ----

// ids "pb<venue>" (Locator's place ids are [a-z0-9]{1,16}); a circle round the venue's courts,
// sized by the venue (the big outdoor clubs reach further than an indoor hall)
export const VENUE_PLACE_PREFIX = "pb"
export const venuePlaceId = (id) => `${VENUE_PLACE_PREFIX}${id}`.slice(0, 16)
export const venuePlace = (id) => {
  const v = VENUE_LIST.find((x) => x.id === id)
  if (!v) return null
  const r = v.indoor ? 100 : v.courts >= 30 ? 300 : 150
  return { id: venuePlaceId(v.id), name: v.short || v.name, lat: v.lat, lon: v.lon, r }
}
export const venueOfPlace = (place) => VENUE_LIST.find((v) => venuePlaceId(v.id) === place?.id) || null
// the venues that aren't among your places yet (for "Notify Me...": pick one and it becomes a place)
export const venuePlaceChoices = (places = []) => VENUE_LIST.filter((v) => !places.some((p) => p.id === venuePlaceId(v.id))).map((v) => ({ id: venuePlaceId(v.id), venue: v.id, name: v.short || v.name, note: v.city }))
