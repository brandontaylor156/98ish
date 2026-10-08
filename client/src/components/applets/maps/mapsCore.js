// Maps 98: the pure parts (no DOM, no network), tested in maps.test.js.
//
// Services (all free, no key; chosen 2026-10-07, terms in docs/maps.md):
//   search   Photon (photon.komoot.io, by komoot, OpenStreetMap data): fair use, no heavy
//            use; we debounce typing (500 ms, 3+ letters), cache answers and send at most
//            one request a second. Nominatim (nominatim.openstreetmap.org) only as a fallback
//            for an explicit search, at most 1 request a second (its usage policy), never
//            for type-ahead.
//   routes   Valhalla on FOSSGIS's public server (valhalla1.openstreetmap.de, the one
//            openstreetmap.org's own Directions uses): auto, pedestrian and bicycle, with
//            written turn-by-turn instructions; fair use, about 1 request a second.
//   map      OpenFreeMap vector tiles (like Buddy Locator).
// The page's Referer identifies 98ish to them (browsers can't set a User-Agent).

export const PHOTON = "https://photon.komoot.io"
export const NOMINATIM = "https://nominatim.openstreetmap.org"
export const VALHALLA = "https://valhalla1.openstreetmap.de"

export const MODES = [
  { id: "drive", label: "Drive", costing: "auto", apple: "d", google: "driving" },
  { id: "walk", label: "Walk", costing: "pedestrian", apple: "w", google: "walking" },
  { id: "bike", label: "Bike", costing: "bicycle", apple: "", google: "bicycling" }, // (Apple's links have no cycling flag: it opens on its default)
]
export const modeOf = (id) => MODES.find((m) => m.id === id) || MODES[0]

// ---- places ----

const clean = (s, max = 120) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, max)

export const photonSearchUrl = (q, { near, limit = 8, lang = "en" } = {}) => {
  const p = new URLSearchParams({ q: clean(q, 200), limit: String(limit), lang })
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lon)) {
    // (rounded to about 10 km: enough to rank nearby places first, not enough to say where you are)
    p.set("lat", near.lat.toFixed(1))
    p.set("lon", near.lon.toFixed(1))
  }
  return `${PHOTON}/api/?${p}`
}
export const photonReverseUrl = (lat, lon) => `${PHOTON}/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&limit=1&lang=en`
export const nominatimSearchUrl = (q) => `${NOMINATIM}/search?${new URLSearchParams({ q: clean(q, 200), format: "jsonv2", limit: "8", addressdetails: "1" })}`

// a Photon feature -> { id, name, detail, lat, lon }
export const placeFromPhoton = (f) => {
  const p = f?.properties || {}
  const [lon, lat] = f?.geometry?.coordinates || []
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const street = [p.housenumber, p.street].filter(Boolean).join(" ")
  const name = clean(p.name || street || p.city || p.county || p.state || "Dropped pin")
  const detail = [p.name && street, p.city || p.town || p.village, p.state, p.country]
    .filter(Boolean)
    .filter((x, i, a) => a.indexOf(x) === i && x !== name)
    .join(", ")
  return { id: `${p.osm_type || "p"}${p.osm_id || `${lat.toFixed(5)},${lon.toFixed(5)}`}`, name, detail: clean(detail, 160), lat, lon }
}
export const placesFromPhoton = (json) => (json?.features || []).map(placeFromPhoton).filter(Boolean)

// a Nominatim result -> the same shape
export const placeFromNominatim = (r) => {
  const lat = Number(r?.lat)
  const lon = Number(r?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const parts = String(r.display_name || "").split(", ")
  return { id: `${r.osm_type || "n"}${r.osm_id || r.place_id}`, name: clean(r.name || parts[0] || "Place"), detail: clean(parts.slice(r.name ? 1 : 1, 4).join(", "), 160), lat, lon }
}

// a place someone hands Maps 98 (openMaps): checked and cleaned, or null
export const cleanDest = (d) => {
  const lat = Number(d?.lat)
  const lon = Number(d?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { id: `dest${lat.toFixed(5)},${lon.toFixed(5)}`, name: clean(d.name || "Destination"), detail: clean(d.detail || d.address || "", 160), lat, lon }
}

// ---- routes ----

export const routeRequest = (from, to, mode, { metric = false } = {}) => ({
  locations: [
    { lat: from.lat, lon: from.lon },
    { lat: to.lat, lon: to.lon },
  ],
  costing: modeOf(mode).costing,
  units: metric ? "kilometers" : "miles",
  directions_options: { language: "en-US" },
})
export const routeUrl = (from, to, mode, opts) => `${VALHALLA}/route?json=${encodeURIComponent(JSON.stringify(routeRequest(from, to, mode, opts)))}`

// Google's encoded polyline at 6 decimals (Valhalla's shape) -> [[lon, lat]...]
export const decodePolyline = (str, precision = 6) => {
  const factor = 10 ** precision
  const out = []
  let lat = 0
  let lon = 0
  let i = 0
  const next = () => {
    let result = 0
    let shift = 0
    let b
    do {
      b = str.charCodeAt(i++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (i < str.length) {
    lat += next()
    lon += next()
    out.push([lon / factor, lat / factor])
  }
  return out
}

// Valhalla's answer -> { distance (in its units), time (s), units, line: [[lon, lat]], steps: [{ text, distance, time, type, at: [lon, lat], index }] }
export const shapeRoute = (json) => {
  const trip = json?.trip
  const leg = trip?.legs?.[0]
  if (!trip || !leg) return null
  const line = decodePolyline(leg.shape || "")
  const steps = (leg.maneuvers || []).map((m, n) => ({
    n,
    text: clean(m.instruction, 200),
    distance: Number(m.length) || 0,
    time: Number(m.time) || 0,
    type: m.type,
    index: m.begin_shape_index ?? 0,
    at: line[m.begin_shape_index ?? 0] || line[0],
  }))
  return { distance: Number(trip.summary?.length) || 0, time: Number(trip.summary?.time) || 0, units: trip.units === "kilometers" ? "km" : "mi", line, steps }
}

// ---- words ----

export const durationText = (s) => {
  const m = Math.max(1, Math.round((s || 0) / 60))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} hr${m % 60 ? ` ${m % 60} min` : ""}`
}
// a distance in route units (mi/km) -> "0.3 mi" / "500 ft" / "800 m"
export const distanceText = (d, units = "mi") => {
  if (units === "km") return d < 1 ? `${Math.max(10, Math.round((d * 1000) / 10) * 10)} m` : `${d < 10 ? d.toFixed(1) : Math.round(d)} km`
  return d < 0.19 ? `${Math.max(10, Math.round((d * 5280) / 10) * 10)} ft` : `${d < 10 ? d.toFixed(1) : Math.round(d)} mi`
}

// metres between two points
export const metersBetween = (a, b) => {
  const R = 6371000
  const toR = Math.PI / 180
  const dLat = (b.lat - a.lat) * toR
  const dLon = (b.lon - a.lon) * toR
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// following along: the route point nearest to you and the step you're on ->
// { index (into line), step (the next maneuver to do), toNext (m), off (m from the route) }
export const progressOn = (route, pos) => {
  if (!route?.line?.length || !pos) return null
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < route.line.length; i++) {
    const [lon, lat] = route.line[i]
    const d = metersBetween(pos, { lat, lon })
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  const next = route.steps.find((s) => s.index > best) || route.steps[route.steps.length - 1]
  const [lon, lat] = next?.at || route.line[route.line.length - 1]
  return { index: best, step: next?.n ?? 0, toNext: Math.round(metersBetween(pos, { lat, lon })), off: Math.round(bestD) }
}

// ---- handing off to a real navigation app ----

export const appleMapsUrl = (dest, { from = null, mode = "drive" } = {}) => {
  const p = new URLSearchParams({ daddr: `${dest.lat},${dest.lon}` })
  if (modeOf(mode).apple) p.set("dirflg", modeOf(mode).apple)
  if (dest.name) p.set("q", dest.name)
  if (from) p.set("saddr", `${from.lat},${from.lon}`)
  return `https://maps.apple.com/?${p}`
}
export const googleMapsUrl = (dest, { from = null, mode = "drive" } = {}) => {
  const p = new URLSearchParams({ api: "1", destination: `${dest.lat},${dest.lon}`, travelmode: modeOf(mode).google })
  if (from) p.set("origin", `${from.lat},${from.lon}`)
  return `https://www.google.com/maps/dir/?${p}`
}

// ---- a small cache (search answers, routes) ----
export const createCache = (max = 60) => {
  const map = new Map()
  return {
    get: (k) => {
      if (!map.has(k)) return undefined
      const v = map.get(k)
      map.delete(k)
      map.set(k, v)
      return v
    },
    set: (k, v) => {
      map.delete(k)
      map.set(k, v)
      while (map.size > max) map.delete(map.keys().next().value)
    },
    size: () => map.size,
  }
}

// recent places (newest first, no repeats, at most `max`)
export const addRecent = (list, place, max = 12) => [place, ...(list || []).filter((p) => p.id !== place.id && !(Math.abs(p.lat - place.lat) < 1e-5 && Math.abs(p.lon - place.lon) < 1e-5))].slice(0, max)
