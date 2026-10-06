// Buddy Locator's rules, shared by the app (utils/locate.js, Locator.jsx) and the server
// (server/locate, which loads this file with a dynamic import, like Notes' notesCore.js).
// Pure: no DOM, no storage, every clock passed in.
//
//   sharing:   shareActive(share, now), untilFor(choice, now), untilText(until, now)
//   positions: cleanPos(input), coarsen(pos), distanceM(a, b), shouldSend(last, next, now)
//   places:    cleanPlace(input), fenceStep(inside, pos, place) -> { inside, event }
//   words:     agoText(at, now), directionsUrl(pos, apple)

export const MAX_SHARES = 50 // people one account shares with
export const MAX_PLACES = 20 // named places per account
export const MAX_WATCHES = 40 // "notify me when ..." per account
export const MAX_ASKS = 20 // pending "can I see your location?" per account
export const ASK_DAYS = 7 // an unanswered ask goes away after this
export const MAX_UNTIL_DAYS = 366 // the furthest "until" a share can name (else: indefinitely)

export const SEND_MIN_MS = 30_000 // a new position goes up at most this often...
export const SEND_MIN_MOVE = 50 // ...and only after moving this far (metres)...
export const SEND_KEEP_MS = 120_000 // ...or this long after the last one (so "2 min ago" stays fresh)

export const COARSE_DEG = 0.01 // approximate location: a grid of about 1.1 km
export const COARSE_ACC = 1000 // ...reported as accurate to 1 km
export const FENCE_MAX_ACC = 500 // positions vaguer than this never decide arriving/leaving

const finite = (n) => typeof n === "number" && Number.isFinite(n)
const num = (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v)

// ---- sharing ----

// a share { to, until } is on until `until` (ms) passes; until null = indefinitely
export const shareActive = (share, now) => !!share && (share.until == null || share.until > now)

// the choices in the Share menu -> an end time (ms) or null (indefinitely). "today" ends at
// local midnight where the person sharing is (the device works it out; the server only sees
// the time)
export const untilFor = (choice, now) => {
  if (choice === "hour") return now + 3600_000
  if (choice === "today") {
    const d = new Date(now)
    d.setHours(23, 59, 59, 999)
    return d.getTime()
  }
  return null
}

// what the server accepts as an end time: null (indefinitely) or a time in the future within a year
export const cleanUntil = (until, now) => {
  if (until == null) return { ok: true, until: null }
  const t = num(until)
  if (!finite(t) || t <= now) return { ok: false, error: "That end time has already passed." }
  if (t > now + MAX_UNTIL_DAYS * 86400_000) return { ok: false, error: "Pick an end time within a year, or share indefinitely." }
  return { ok: true, until: Math.round(t) }
}

const clock = (t) => {
  const d = new Date(t)
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, "0")
  const ap = h < 12 ? "AM" : "PM"
  h = h % 12 || 12
  return `${h}:${m} ${ap}`
}

// "Indefinitely", "Until 4:30 PM", "Until tomorrow 9:00 AM", "Until Oct 12"
export const untilText = (until, now) => {
  if (until == null) return "Indefinitely"
  const left = until - now
  if (left <= 0) return "Ended"
  const day = (t) => new Date(t).toDateString()
  if (day(until) === day(now)) return `Until ${clock(until)}`
  if (day(until) === day(now + 86400_000)) return `Until tomorrow ${clock(until)}`
  return `Until ${new Date(until).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
}

// ---- positions ----

// { lat, lon, acc? } from a device or a request -> { ok, pos: { lat, lon, acc } } (acc in metres)
export const cleanPos = (input) => {
  const lat = num(input?.lat)
  const lon = num(input?.lon)
  if (!finite(lat) || !finite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return { ok: false, error: "That isn't a place on Earth." }
  let acc = num(input?.acc)
  acc = finite(acc) && acc >= 0 ? Math.min(Math.round(acc), 100_000) : 50
  return { ok: true, pos: { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, acc } }
}

// approximate location: snap to a grid of about 1.1 km (the longitude step widens toward the
// poles so cells stay about square) and say "within 1 km". The same spot always lands on the
// same cell, so watching it change doesn't narrow it down.
export const coarsen = (pos) => {
  const lat = Math.round(pos.lat / COARSE_DEG) * COARSE_DEG
  const step = COARSE_DEG / Math.max(0.2, Math.cos((lat * Math.PI) / 180))
  let lon = Math.round(pos.lon / step) * step
  if (lon > 180) lon -= 360
  if (lon < -180) lon += 360
  return { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, acc: Math.max(pos.acc || 0, COARSE_ACC), coarse: true }
}

// great-circle distance in metres
export const distanceM = (a, b) => {
  const R = 6371_000
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// should this device send `next` now? last = { lat, lon, at } of the last one sent (or null)
export const shouldSend = (last, next, now, { minMs = SEND_MIN_MS, minMove = SEND_MIN_MOVE, keepMs = SEND_KEEP_MS } = {}) => {
  if (!last) return true
  const since = now - last.at
  if (since >= keepMs) return true
  return since >= minMs && distanceM(last, next) >= minMove
}

// ---- places ----

export const cleanPlace = (input) => {
  const name = String(input?.name ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, 40)
  if (!name) return { ok: false, error: "Give the place a name." }
  const at = cleanPos(input)
  if (!at.ok) return at
  let r = num(input?.r)
  r = finite(r) ? Math.min(2000, Math.max(50, Math.round(r))) : 150
  const id = /^[a-z0-9]{1,16}$/.test(String(input?.id || "")) ? String(input.id) : null
  return { ok: true, place: { id, name, lat: at.pos.lat, lon: at.pos.lon, r } }
}

// Arriving and leaving, with a margin so standing at the edge doesn't flicker: you're "in"
// once within the radius and "out" again only past radius + margin. inside: true | false |
// null (not known yet: the first position only sets it, without an alert).
// -> { inside, event: "arrive" | "leave" | null }
export const fenceStep = (inside, pos, place) => {
  if (!pos || (pos.acc || 0) > FENCE_MAX_ACC) return { inside, event: null }
  const d = distanceM(pos, place)
  const margin = Math.max(30, place.r * 0.25)
  if (inside == null) return { inside: d <= place.r, event: null }
  if (!inside && d <= place.r) return { inside: true, event: "arrive" }
  if (inside && d > place.r + margin) return { inside: false, event: "leave" }
  return { inside, event: null }
}

// does a watch ("arrive" | "leave" | "both") want this event?
export const watchWants = (on, event) => !!event && (on === "both" || on === event)

// ---- words ----

export const agoText = (at, now) => {
  if (!at) return "No location yet"
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return "Just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  return d === 1 ? "Yesterday" : `${d} days ago`
}

export const distanceText = (m) => {
  if (!finite(m)) return ""
  const mi = m / 1609.344
  if (mi < 0.1) return `${Math.round(m * 3.28084)} ft away`
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi away`
}

// directions to a buddy in the phone's own maps app
export const directionsUrl = (pos, apple = false) =>
  apple ? `https://maps.apple.com/?daddr=${pos.lat},${pos.lon}` : `https://www.google.com/maps/dir/?api=1&destination=${pos.lat},${pos.lon}`
