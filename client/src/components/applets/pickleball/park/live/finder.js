// Venue Finder's pure core: every pickleball venue in OpenStreetMap, as a small index the
// phone can search offline. Shared by the index build (tools/venues/world/build-index.mjs),
// the finder UI (park/live/FinderPanel.jsx), the server (server/venues: it reads the same
// shards to know where a venue is) and the tests. No DOM, no Node.
//
// The index (client/public/venues/idx/, built monthly, ODbL like OSM):
//   <gh2>.json   one shard per 2-character geohash cell (about 1,250 x 625 km):
//                { v: 1, rows: [row, ...] }, a row = [id, lat, lon, r, courts, onTennis, flags, name, town]
//   search.json  { v: 1, towns: [[name, gh2, lat, lon, venues]], named: [[name, gh2, i]] }
//   meta.json    { v, built, venues, courts, shards, osm_base, attribution }
// id: "o" + OSM type letter + OSM id of the venue's biggest court ("ow123456"); flags below.

export const FLAG = { indoor: 1, lit: 2, covered: 4, private: 8, members: 16, building: 32 }
export const IDX_BASE = "/venues/idx"
export const ATTRIBUTION = "Venue data © OpenStreetMap contributors (ODbL)"

// ---------- geohash ----------
const B32 = "0123456789bcdefghjkmnpqrstuvwxyz"
export const geohash = (lat, lon, len = 2) => {
  let latR = [-90, 90]
  let lonR = [-180, 180]
  let out = ""
  let bit = 0
  let ch = 0
  let even = true
  while (out.length < len) {
    const r = even ? lonR : latR
    const v = even ? lon : lat
    const mid = (r[0] + r[1]) / 2
    if (v >= mid) {
      ch = (ch << 1) | 1
      r[0] = mid
    } else {
      ch <<= 1
      r[1] = mid
    }
    even = !even
    if (++bit === 5) {
      out += B32[ch]
      bit = 0
      ch = 0
    }
  }
  return out
}
// the cell's box: [lat0, lon0, lat1, lon1]
export const geohashBox = (gh) => {
  let latR = [-90, 90]
  let lonR = [-180, 180]
  let even = true
  for (const c of gh) {
    const n = B32.indexOf(c)
    for (let b = 4; b >= 0; b--) {
      const r = even ? lonR : latR
      const mid = (r[0] + r[1]) / 2
      if ((n >> b) & 1) r[0] = mid
      else r[1] = mid
      even = !even
    }
  }
  return [latR[0], lonR[0], latR[1], lonR[1]]
}
// the cells within `km` of a point (its own first), for "near me"
export const cellsNear = (lat, lon, km = 80, len = 2) => {
  const dLat = km / 111.32
  const dLon = km / (111.32 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))
  const out = [geohash(lat, lon, len)]
  for (const a of [-dLat, 0, dLat]) for (const o of [-dLon, 0, dLon]) {
    const g = geohash(Math.max(-89.9, Math.min(89.9, lat + a)), ((lon + o + 540) % 360) - 180, len)
    if (!out.includes(g)) out.push(g)
  }
  return out
}

// ---------- distance ----------
export const kmBetween = (a, b) => {
  const R = 6371
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLon = ((b[1] - a[1]) * Math.PI) / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

// ---------- from OSM features to venues ----------
// one OSM feature (Overpass `out center tags`): { type, id, lat|center, tags }
const latLonOf = (el) => (el.center ? [el.center.lat, el.center.lon] : el.lat !== undefined ? [el.lat, el.lon] : null)
const sportsOf = (t) => (t.sport || "").split(/[;,]/).map((s) => s.trim().toLowerCase())

// what one feature is: a court (pickleball, or tennis with pickleball lines), a hall or a
// place with courts somewhere inside (a sports centre / club tagged pickleball)
export const featureKind = (el) => {
  const t = el.tags || {}
  const sports = sportsOf(t)
  const pb = sports.includes("pickleball") || t.pickleball === "yes" || /pickleball/i.test(t["pickleball:lines"] || "")
  if (!pb) return null
  if (t.leisure === "pitch" || t.leisure === "court") return sports.includes("tennis") ? "tennis" : "court"
  if (t.leisure === "sports_centre" || t.leisure === "sports_hall" || t.building) return "hall"
  return "place"
}

// courts within `gap` m of each other (or inside the same hall) are one venue: single-link
// clustering over a grid. Returns [{ els: [feature], lat, lon, r }]
export const clusterFeatures = (els, gap = 60) => {
  const pts = []
  for (const el of els) {
    const ll = latLonOf(el)
    const kind = featureKind(el)
    if (!ll || !kind) continue
    pts.push({ el, kind, lat: ll[0], lon: ll[1] })
  }
  const cellDeg = gap / 111320
  const key = (la, lo) => `${Math.floor(la / cellDeg)},${Math.floor(lo / cellDeg)}`
  const grid = new Map()
  pts.forEach((p, i) => {
    const k = key(p.lat, p.lon)
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push(i)
  })
  const parent = pts.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  pts.forEach((p, i) => {
    const ci = Math.floor(p.lat / cellDeg)
    const cj = Math.floor(p.lon / cellDeg)
    const kx = Math.cos((p.lat * Math.PI) / 180)
    // (a hall or club pulls in courts a little further away: its point is its middle)
    const reach = p.kind === "hall" || p.kind === "place" ? gap * 2.5 : gap
    const span = Math.ceil(reach / gap)
    for (let a = -span; a <= span; a++)
      for (let b = -span - 1; b <= span + 1; b++) {
        for (const j of grid.get(`${ci + a},${cj + b}`) || []) {
          if (j <= i) continue
          const q = pts[j]
          const d = Math.hypot((q.lat - p.lat) * 111320, (q.lon - p.lon) * 111320 * kx)
          const lim = q.kind === "hall" || q.kind === "place" ? Math.max(reach, gap * 2.5) : reach
          if (d <= lim) parent[find(j)] = find(i)
        }
      }
  })
  const groups = new Map()
  pts.forEach((p, i) => {
    const r = find(i)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(p)
  })
  const out = []
  for (const g of groups.values()) {
    // the middle of the courts (halls and places only when there are no courts)
    const courts = g.filter((p) => p.kind === "court" || p.kind === "tennis")
    const ref = courts.length ? courts : g
    const lat = ref.reduce((s, p) => s + p.lat, 0) / ref.length
    const lon = ref.reduce((s, p) => s + p.lon, 0) / ref.length
    const kx = Math.cos((lat * Math.PI) / 180)
    const r = Math.max(...g.map((p) => Math.hypot((p.lat - lat) * 111320, (p.lon - lon) * 111320 * kx)))
    out.push({ els: g.map((p) => p.el), kinds: g.map((p) => p.kind), lat, lon, r })
  }
  return out
}

// a venue's id: its biggest (first) court's OSM element, stable as long as OSM keeps it
export const venueId = (cluster) => {
  const pick = cluster.els.find((e, i) => cluster.kinds[i] === "court") || cluster.els.find((e, i) => cluster.kinds[i] === "tennis") || cluster.els[0]
  return `o${pick.type[0]}${pick.id}`
}
export const parseVenueId = (id) => {
  const m = /^o([nwr])(\d{1,12})b?$/.exec(String(id || ""))
  return m ? { type: { n: "node", w: "way", r: "relation" }[m[1]], osm: Number(m[2]) } : null
}

// courts at a venue: pickleball courts, plus tennis courts with pickleball lines (2 each), plus
// a hall's tagged count; a sports centre tagged pickleball with nothing mapped inside counts 4
export const countCourts = (cluster) => {
  let courts = 0
  let onTennis = 0
  let hall = 0
  cluster.els.forEach((el, i) => {
    const k = cluster.kinds[i]
    const n = parseInt(el.tags?.["pickleball:courts"] || el.tags?.courts || "", 10)
    if (k === "court") courts += 1
    else if (k === "tennis") onTennis += 1
    else if (k === "hall" || k === "place") hall = Math.max(hall, Number.isFinite(n) && n > 0 && n < 80 ? n : 0)
  })
  if (!courts && !onTennis) courts = hall || 4
  return { courts, onTennis }
}

export const flagsOf = (cluster) => {
  let f = 0
  cluster.els.forEach((el, i) => {
    const t = el.tags || {}
    if (t.indoor === "yes" || cluster.kinds[i] === "hall" || t.leisure === "sports_hall") f |= FLAG.indoor
    if (t.lit === "yes" || t.lit === "24/7" || t.lit === "automatic") f |= FLAG.lit
    if (t.covered === "yes") f |= FLAG.covered
    if (t.access === "private" || t.access === "no") f |= FLAG.private
    if (t.access === "members" || t.access === "customers" || t.club) f |= FLAG.members
    if (t.building || cluster.kinds[i] === "hall") f |= FLAG.building
  })
  // (indoor only when the courts themselves are inside: a club with outdoor courts and a
  // clubhouse tagged pickleball stays outdoor)
  const courtEls = cluster.els.filter((_, i) => cluster.kinds[i] === "court" || cluster.kinds[i] === "tennis")
  if (courtEls.length && courtEls.every((e) => e.tags?.indoor !== "yes" && e.tags?.covered !== "yes") && !courtEls.some((e) => e.tags?.indoor === "yes")) f &= ~FLAG.indoor
  return f
}

// a venue's name: one of its own features' names, else the nearest named park/club/school
// around it (`places`: [{ name, lat, lon, kind }]), else "Pickleball courts" (+ the town)
const GENERIC = /^(pickleball( courts?)?|tennis( courts?)?|courts?|pitch)$/i
export const nameVenue = (cluster, places = []) => {
  const own = cluster.els.map((e) => e.tags?.name).filter((n) => n && !GENERIC.test(n.trim()))
  // (a hall's or club's name beats a court's "Court 3")
  const best = own.find((n) => !/^court\s*\d+$/i.test(n)) || null
  if (best) return best
  const opName = cluster.els.map((e) => e.tags?.operator || e.tags?.club).find((n) => n && n.length > 3 && !/^(yes|sport)$/i.test(n))
  let near = null
  const kx = Math.cos((cluster.lat * Math.PI) / 180)
  for (const p of places) {
    const d = Math.hypot((p.lat - cluster.lat) * 111320, (p.lon - cluster.lon) * 111320 * kx)
    // parks and clubs count from further away than a school's point (a campus is big)
    const lim = (p.kind === "school" ? 220 : 180) + cluster.r
    if (d > lim) continue
    // (the closest; a sports centre or club wins ties within 40 m)
    const score = d - (p.kind === "sports" || p.kind === "club" ? 40 : 0)
    if (!near || score < near.score) near = { name: p.name, score }
  }
  if (near) return near.name
  return opName || null
}

// the nearest town (places: [{ name, lat, lon, pop }]) through a grid built once
export const townIndex = (towns, cellDeg = 0.5) => {
  const grid = new Map()
  for (const t of towns) {
    const k = `${Math.floor(t.lat / cellDeg)},${Math.floor(t.lon / cellDeg)}`
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push(t)
  }
  return (lat, lon, maxKm = 40) => {
    const i = Math.floor(lat / cellDeg)
    const j = Math.floor(lon / cellDeg)
    let best = null
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const t of grid.get(`${i + a},${j + b}`) || []) {
          const d = kmBetween([lat, lon], [t.lat, t.lon])
          // a big city reaches a little further than a suburb next door
          const score = d - Math.min(4, Math.log10(Math.max(10, t.pop || 0)) - 1)
          if (d <= maxKm && (!best || score < best.score)) best = { t, score, d }
        }
    return best?.t || null
  }
}

// ---------- rows ----------
const r5 = (v) => Math.round(v * 1e5) / 1e5
export const makeRow = ({ id, lat, lon, r, courts, onTennis, flags, name, town }) => [id, r5(lat), r5(lon), Math.min(400, Math.round(r) + 60), courts, onTennis, flags, name || "", town || ""]
export const readRow = (row, shard = "") => {
  const [id, lat, lon, r, courts, onTennis, flags, name, town] = row
  return { id, shard, lat, lon, r, courts, onTennis, flags, indoor: !!(flags & FLAG.indoor), lit: !!(flags & FLAG.lit), private: !!(flags & FLAG.private), members: !!(flags & FLAG.members), name: name || "", town: town || "", title: name || (town ? `Pickleball courts, ${town}` : "Pickleball courts") }
}
// courts a row stands for (pickleball courts + 2 on each tennis court with lines)
export const courtCount = (v) => (v.courts || 0) + (v.onTennis || 0) * 2

// ---------- search (offline, over search.json + shards) ----------
const fold = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
// match quality of `q` against a name: 3 whole name, 2 every word starts a word, 1 contains, 0 none
export const matchScore = (q, name) => {
  const a = fold(q)
  const b = fold(name)
  if (!a || !b) return 0
  if (a === b) return 3
  const words = b.split(" ")
  if (a.split(" ").every((w) => words.some((x) => x.startsWith(w)))) return 2
  return b.includes(a) ? 1 : 0
}
// search.json -> the best towns and named venues for a query
export const searchIndex = (idx, q, limit = 12) => {
  if (!idx || fold(q).length < 2) return { towns: [], named: [] }
  const towns = []
  for (const t of idx.towns || []) {
    const s = matchScore(q, t[0])
    if (s) towns.push({ s, name: t[0], shard: t[1], lat: t[2], lon: t[3], venues: t[4] })
  }
  towns.sort((x, y) => y.s - x.s || y.venues - x.venues)
  const named = []
  for (const n of idx.named || []) {
    const s = matchScore(q, n[0])
    if (s) named.push({ s, name: n[0], shard: n[1], i: n[2] })
  }
  named.sort((x, y) => y.s - x.s)
  return { towns: towns.slice(0, limit), named: named.slice(0, limit) }
}
// rows (read) sorted by distance from a point, with km
export const nearest = (rows, lat, lon, limit = 30, maxKm = 200) =>
  rows
    .map((v) => ({ ...v, km: kmBetween([lat, lon], [v.lat, v.lon]) }))
    .filter((v) => v.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit)
