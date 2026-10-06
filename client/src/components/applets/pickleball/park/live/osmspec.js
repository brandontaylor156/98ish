// Any pickleball venue on Earth -> a venue spec My Park can build (the same shape as
// tools/venues/build-venues.mjs writes for the hand-tuned venues, park/venues/<id>.json),
// straight from OpenStreetMap with no hand corrections. Pure: the server runs it on a fresh
// Overpass answer (server/venues), the tests run it on saved data.
// Data © OpenStreetMap contributors, ODbL 1.0.
//
// What it decides on its own (where a hand-tuned venue has overrides):
// - courts: every pitch tagged pickleball or tennis(+pickleball lines) near the venue, at its
//   real size and angle; a pickleball polygon over 18 m long is a tennis court with lines;
// - indoor: courts inside a building outline (or tagged indoor) make that building a hall; a
//   sports centre tagged pickleball with no courts mapped inside gets courts laid out in rows
//   inside its footprint (2 m between them);
// - colors: surface:colour / colour tags when present, else by surface (clay red, grass green,
//   asphalt/acrylic the classic blue court on green), indoors grey-blue courts on a sports floor;
// - lights only when tagged lit (or indoors), buildings with heights from height/levels/kind,
//   parking, paths, trees, water, fences, the town's backdrop.
// Spec coordinates: meters, x east, z south, (0, 0) at the middle of the courts.

const M = 111320
const r1 = (v) => Math.round(v * 10) / 10

export const makeProj = (lat0, lon0) => {
  const k = Math.cos((lat0 * Math.PI) / 180)
  return {
    xz: ([la, lo]) => [(lo - lon0) * M * k, -(la - lat0) * M],
    ll: ([x, z]) => [lat0 - z / M, lon0 + x / (M * k)],
  }
}

// ---------- the Overpass side (the server asks; kept here so the tests use the same query) ----------
const KEEP = new Set(["leisure", "sport", "surface", "lit", "covered", "indoor", "access", "name", "building", "building:levels", "height", "roof:shape", "roof:colour", "building:colour", "amenity", "barrier", "natural", "landuse", "highway", "service", "man_made", "water", "leaf_type", "colour", "surface:colour", "parking", "layer", "area", "width", "operator", "club", "pickleball", "pickleball:courts", "courts"])
export const venueQuery = (lat, lon, radius) => {
  const r = Math.round(Math.max(80, Math.min(320, radius)))
  const a = `around:${r},${lat.toFixed(6)},${lon.toFixed(6)}`
  return `[out:json][timeout:60][maxsize:67108864];(
nwr(${a})[leisure];
way(${a})[building];
way(${a})[barrier~"^(fence|wall|hedge|retaining_wall)$"];
nwr(${a})[natural~"^(tree|tree_row|wood|scrub|water|grassland)$"];
way(${a})[landuse];
way(${a})[amenity~"^(parking|school)$"];
way(${a})[highway];
node(${a})[man_made~"^(lamp_post|flagpole)$"];
node(${a})[highway=street_lamp];
);out tags geom qt;`
}
// Overpass elements -> the compact form fetch-osm.mjs saves (tags we read; [lat, lon] lists)
export const compactElements = (elements = []) =>
  elements.map((el) => {
    const tags = {}
    for (const [k, v] of Object.entries(el.tags || {})) if (KEEP.has(k)) tags[k] = v
    const o = { t: el.type[0], id: el.id, tags }
    const r6 = (x) => Math.round(x * 1e6) / 1e6
    if (el.type === "node") o.p = [r6(el.lat), r6(el.lon)]
    else if (el.type === "way" && el.geometry) o.g = el.geometry.filter(Boolean).map((p) => [r6(p.lat), r6(p.lon)])
    else if (el.type === "relation" && el.members) {
      // a multipolygon's outer ring (the biggest), enough for a building or a park
      const outers = el.members.filter((m) => m.type === "way" && m.geometry && m.role !== "inner")
      const best = outers.sort((a, b) => b.geometry.length - a.geometry.length)[0]
      if (best) o.g = best.geometry.filter(Boolean).map((p) => [r6(p.lat), r6(p.lon)])
    }
    return o
  })

// ---------- geometry ----------
export const minRect = (pts) => {
  let best = null
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % n]
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.3) continue
    const a = Math.atan2(q[1] - p[1], q[0] - p[0])
    const c = Math.cos(a)
    const s = Math.sin(a)
    let u0 = Infinity
    let u1 = -Infinity
    let v0 = Infinity
    let v1 = -Infinity
    for (const [x, z] of pts) {
      const u = x * c + z * s
      const v = -x * s + z * c
      u0 = Math.min(u0, u)
      u1 = Math.max(u1, u)
      v0 = Math.min(v0, v)
      v1 = Math.max(v1, v)
    }
    const area = (u1 - u0) * (v1 - v0)
    if (!best || area < best.area) {
      const cu = (u0 + u1) / 2
      const cv = (v0 + v1) / 2
      const long = u1 - u0 >= v1 - v0
      best = { area, x: cu * c - cv * s, z: cu * s + cv * c, len: Math.max(u1 - u0, v1 - v0), wid: Math.min(u1 - u0, v1 - v0), a: long ? a : a + Math.PI / 2 }
    }
  }
  return best
}
const normDeg = (deg) => {
  let d = ((deg % 180) + 180) % 180
  if (d > 90) d -= 180
  return r1(d)
}
export const polyArea = (pts) => {
  let A = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    A += p[0] * q[1] - q[0] * p[1]
  }
  return A / 2
}
export const inPoly = ([x, z], pts) => {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i]
    const [xj, zj] = pts[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
const dropClosing = (pts) => (pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts)
const clipPoly = (pts, { x0, x1, z0, z1 }) => {
  const edges = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((x0 - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((x1 - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]],
    [(p) => p[1] >= z0, (a, b) => [a[0] + ((z0 - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), z0]],
    [(p) => p[1] <= z1, (a, b) => [a[0] + ((z1 - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), z1]],
  ]
  let out = pts
  for (const [inside, cut] of edges) {
    const src = out
    out = []
    for (let i = 0; i < src.length; i++) {
      const a = src[i]
      const b = src[(i + 1) % src.length]
      if (inside(b)) {
        if (!inside(a)) out.push(cut(a, b))
        out.push(b)
      } else if (inside(a)) out.push(cut(a, b))
    }
    if (!out.length) break
  }
  return out
}
const clipLine = (pts, box) => {
  const inside = (p) => p[0] >= box.x0 && p[0] <= box.x1 && p[1] >= box.z0 && p[1] <= box.z1
  const runs = []
  let run = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (inside(p)) run.push(p)
    else {
      if (run.length) {
        run.push(p)
        runs.push(run)
        run = []
      } else if (i + 1 < pts.length && inside(pts[i + 1])) run.push(p)
    }
  }
  if (run.length > 1) runs.push(run)
  return runs.filter((r) => r.length > 1)
}
const simplify = (pts, tol = 0.25, closed = false) => {
  if (pts.length < 4) return pts
  const keep = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = keep[keep.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1
    const d = Math.abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / L
    if (d > tol) keep.push(b)
  }
  keep.push(pts[pts.length - 1])
  return closed && keep.length < 3 ? pts : keep
}
const pr = (pts) => pts.map(([x, z]) => [r1(x), r1(z)])

// ---------- colors from tags ----------
const NAMED = { blue: "#2f5fa8", darkblue: "#22407a", navy: "#1f2f5a", lightblue: "#6fa8d8", green: "#3f7a4a", darkgreen: "#2f5a3a", red: "#a8463a", "terra cotta": "#b4583c", purple: "#5a3f8a", grey: "#7f8a90", gray: "#7f8a90", black: "#2a2c30", orange: "#d9772a", tan: "#c8a878", white: "#e8e8e8", teal: "#2f8a86" }
const colorOf = (v) => {
  if (!v) return null
  const s = String(v).trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
  return NAMED[s] || NAMED[s.replace(/[_\s-]/g, "")] || null
}
// a court's paint from its tags (null: the venue's default)
const paintOf = (t, indoor) => {
  const surf = (t.surface || "").toLowerCase()
  const own = colorOf(t["surface:colour"]) || colorOf(t.colour)
  if (own) return { court: own }
  if (/clay/.test(surf)) return { court: "#b4583c", kitchen: "#b4583c", surround: "#a85036", clay: true }
  if (/grass/.test(surf) && !/artificial/.test(surf)) return { court: "#4f8a3f", kitchen: "#5a9447", surround: "#4a8239" }
  if (/^(wood|sport|parquet)/.test(surf) || (indoor && !surf)) return null
  if (/^(concrete|asphalt)$/.test(surf) && !t.lit) return { court: "#5f7f95", kitchen: "#6f8fa5", surround: "#8a8f8c" }
  return null
}

const HEIGHTS = { house: 5, residential: 6, apartments: 10, school: 5, industrial: 7.5, warehouse: 8, commercial: 6.5, retail: 6, roof: 3.5, garage: 3, hotel: 14, office: 10, yes: 5.5, clubhouse: 5.5, hall: 9, sports_hall: 9, sports_centre: 9, garages: 3, shed: 3, kiosk: 3 }
const PB = /pickleball/
const isPbPlace = (t) => PB.test(t.sport || "") || t.pickleball === "yes"

// ---------- the spec ----------
// raw: { elements (compact), osm_base }; venue: { id, lat, lon, name, town, courts, onTennis, flags }
export const specFromOsm = (raw, venue) => {
  const proj = makeProj(venue.lat, venue.lon)
  const els = raw.elements || []
  const polyOf = (e) => (e.g ? dropClosing(e.g.map(proj.xz)) : null)
  const reach = Math.max(70, Math.min(260, (venue.r || 100) + 10))

  // buildings first (indoor courts are courts inside one)
  const bldgs = []
  for (const e of els) {
    if (!e.tags?.building && e.tags?.leisure !== "sports_centre" && e.tags?.leisure !== "sports_hall") continue
    const pts = polyOf(e)
    if (!pts || pts.length < 3 || Math.abs(polyArea(pts)) < 12) continue
    bldgs.push({ e, pts })
  }
  const buildingAt = (p) => bldgs.find((b) => b.e.tags.building && inPoly(p, b.pts))

  // ---------- courts ----------
  let courts = []
  for (const e of els) {
    const t = e.tags || {}
    if (!(t.leisure === "pitch" || t.leisure === "court") || !e.g) continue
    const sports = (t.sport || "").split(/[;,]/).map((s) => s.trim())
    let sport = sports.includes("pickleball") || t.pickleball === "yes" ? "pickleball" : sports.includes("tennis") ? "tennis" : null
    if (!sport) continue
    const pts = polyOf(e)
    const r = minRect(pts)
    if (!r || r.len < 8 || r.len > 45) continue
    if (Math.hypot(r.x, r.z) > reach) continue
    const both = PB.test(t.sport || "") && /tennis/.test(t.sport || "")
    if (sport === "pickleball" && r.len > 18) sport = "tennis"
    // a plain tennis court only counts when the venue has pickleball on tennis, or sits right by
    // the pickleball courts (it's part of the club: drawn as tennis)
    const indoor = t.indoor === "yes" || t.covered === "yes" || !!buildingAt([r.x, r.z])
    courts.push({ id: e.id, x: r.x, z: r.z, a: (r.a * 180) / Math.PI, s: sport, pb: sport === "tennis" && (both || t.pickleball === "yes") ? 2 : 0, lit: t.lit === "yes" || indoor ? 1 : 0, paint: paintOf(t, indoor), indoor, plain: sport === "tennis" && !both && t.pickleball !== "yes" })
  }
  // plain tennis courts: keep the ones within 40 m of a pickleball court (the same club); drop the rest
  const pbCourts = courts.filter((c) => !c.plain)
  courts = courts.filter((c) => !c.plain || pbCourts.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 40))
  if (!pbCourts.length) courts = courts.filter((c) => !c.plain)

  // a hall tagged pickleball with nothing mapped inside: courts laid out in its footprint
  let synthHall = null
  if (!courts.some((c) => !c.plain)) {
    // (a hall tagged pickleball, a sports centre, or the building the venue's pin is inside)
    const cand = bldgs
      .filter((b) => isPbPlace(b.e.tags) || b.e.tags.leisure === "sports_centre" || b.e.tags.leisure === "sports_hall" || ((venue.flags & 1) && inPoly([0, 0], b.pts)))
      .map((b) => ({ ...b, mr: minRect(b.pts), d: Math.hypot(...b.pts.reduce((s, p) => [s[0] + p[0] / b.pts.length, s[1] + p[1] / b.pts.length], [0, 0])) }))
      .filter((b) => b.mr && b.mr.len > 16 && b.mr.wid > 9)
      .sort((a, b) => Number(isPbPlace(b.e.tags)) - Number(isPbPlace(a.e.tags)) || a.d - b.d)
    const hb = cand[0] || null
    const want = Math.max(1, Math.min(24, (venue.courts || 0) + (venue.onTennis || 0) * 2 || 4))
    if (hb) {
      synthHall = hb
      // rows of courts along the building's length: 13.4 + 4.6 m runoff, 6.1 + 2.4 m apart
      const { mr } = hb
      const along = Math.max(1, Math.floor((mr.len - 3) / 18))
      const across = Math.max(1, Math.floor((mr.wid - 3) / 8.5))
      // courts lie across the length when that fits more
      const along2 = Math.max(1, Math.floor((mr.wid - 3) / 18))
      const across2 = Math.max(1, Math.floor((mr.len - 3) / 8.5))
      const turn = along2 * across2 > along * across
      const nA = turn ? along2 : along
      const nB = turn ? across2 : across
      const n = Math.min(want, nA * nB)
      const ux = Math.cos(mr.a)
      const uz = Math.sin(mr.a)
      const cA = turn ? 8.5 : 18
      const cB = turn ? 18 : 8.5
      const lenA = turn ? across2 : along
      const lenB = turn ? along2 : across
      let k = 0
      for (let i = 0; i < lenA && k < n; i++)
        for (let j = 0; j < lenB && k < n; j++, k++) {
          const u = (i - (lenA - 1) / 2) * cA
          const v = (j - (lenB - 1) / 2) * cB
          courts.push({ id: `h${k}`, x: mr.x + ux * u - uz * v, z: mr.z + uz * u + ux * v, a: (mr.a * 180) / Math.PI + (turn ? 90 : 0), s: "pickleball", pb: 0, lit: 1, paint: null, indoor: true })
        }
    }
  }
  // nothing mapped at all (a pin with a court count): an open slab of courts at the pin
  if (!courts.length) {
    const n = Math.max(1, Math.min(12, (venue.courts || 0) + (venue.onTennis || 0) * 2 || 2))
    const cols = Math.min(4, n)
    for (let k = 0; k < n; k++) courts.push({ id: `g${k}`, x: ((k % cols) - (cols - 1) / 2) * 8.5, z: Math.floor(k / cols) * 18, a: 90, s: "pickleball", pb: 0, lit: venue.flags & 2 ? 1 : 0, paint: null, indoor: false })
  }

  // the courts' middle becomes (0, 0)
  const cx0 = courts.reduce((s, c) => s + c.x, 0) / courts.length
  const cz0 = courts.reduce((s, c) => s + c.z, 0) / courts.length
  const sh = ([x, z]) => [x - cx0, z - cz0]
  for (const c of courts) {
    c.x -= cx0
    c.z -= cz0
  }
  const originLL = proj.ll([cx0, cz0])
  const cb = { x0: Math.min(...courts.map((c) => c.x)) - 15, x1: Math.max(...courts.map((c) => c.x)) + 15, z0: Math.min(...courts.map((c) => c.z)) - 15, z1: Math.max(...courts.map((c) => c.z)) + 15 }
  const crop = 70
  const box = { x0: cb.x0 - crop, x1: cb.x1 + crop, z0: cb.z0 - crop, z1: cb.z1 + crop }
  const nearBox = (pts) => pts.some(([x, z]) => x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1)

  // ---------- halls: buildings with courts inside ----------
  const indoorCourts = courts.filter((c) => c.indoor)
  const hallBldgs = new Set()
  for (const c of indoorCourts) {
    const b = bldgs.find((q) => q.e.tags.building && inPoly([c.x + cx0, c.z + cz0], q.pts))
    if (b) hallBldgs.add(b)
  }
  if (synthHall) hallBldgs.add(synthHall)
  const indoor = indoorCourts.length > 0 && indoorCourts.length >= courts.length / 2

  // ---------- buildings, areas, roads, trees, fences ----------
  const buildings = []
  const areas = []
  const roads = []
  const trees = []
  const fences = []
  const lamps = []
  const halls = []
  for (const e of els) {
    const t = e.tags || {}
    if (e.p) {
      const p = sh(proj.xz(e.p))
      if (!nearBox([p])) continue
      if (t.natural === "tree") trees.push([r1(p[0]), r1(p[1]), 1, t.leaf_type === "needleleaved" ? "conifer" : "broadleaf"])
      else if (t.man_made === "lamp_post" || t.highway === "street_lamp") lamps.push([r1(p[0]), r1(p[1])])
      continue
    }
    const pts0 = polyOf(e)
    if (!pts0 || pts0.length < 2) continue
    const pts = pts0.map(sh)
    if (!nearBox(pts)) continue
    const hb = [...hallBldgs].find((q) => q.e === e)
    if (t.building) {
      if (pts.length < 3 || Math.abs(polyArea(pts)) < 12) continue
      const kind = t.building === "yes" ? (t.amenity === "school" ? "school" : "yes") : t.building
      const levels = parseFloat(t["building:levels"])
      let h = parseFloat(t.height) || (levels ? levels * 3.4 + 0.6 : HEIGHTS[kind] || 5.5)
      if (hb) h = Math.max(7.5, Math.min(12, h))
      const roofShape = t["roof:shape"]
      const b = { id: e.id, p: pr(simplify(pts, 0.3, true)), h: r1(Math.min(60, h)), k: kind }
      if (colorOf(t["building:colour"])) b.c = colorOf(t["building:colour"])
      if (colorOf(t["roof:colour"])) b.r = colorOf(t["roof:colour"])
      if (roofShape === "gabled" || roofShape === "hipped") b.rs = roofShape === "gabled" ? "gable" : "hip"
      if (hb) {
        b.hall = 1
        // (a nearly rectangular hall: its rectangle; OSM outlines are a little jagged)
        const mr = minRect(pts)
        const square = mr && Math.abs(polyArea(pts)) / mr.area > 0.85
        const ring = square
          ? [
              [-1, -1],
              [1, -1],
              [1, 1],
              [-1, 1],
            ].map(([i, j]) => [mr.x + Math.cos(mr.a) * i * (mr.len / 2) - Math.sin(mr.a) * j * (mr.wid / 2), mr.z + Math.sin(mr.a) * i * (mr.len / 2) + Math.cos(mr.a) * j * (mr.wid / 2)])
          : simplify(pts, 0.3, true)
        b.p = pr(ring)
        b.h = r1(h)
        const hall = { p: pr(ring), h: r1(h), wall: "#d9d4c8", floor: "#3d4552", pads: "#1d2f5a", ceiling: "#c8ccd2", lights: "#fff8e8", lightsStyle: "strip", beams: true }
        // the door: the middle of the wall nearest the parking or road, else the longest wall
        hall.door = doorFor(ring, els, proj, sh)
        halls.push(hall)
      }
      buildings.push(b)
      continue
    }
    if (t.barrier && e.t === "w") {
      for (const run of clipLine(pts, box)) fences.push({ k: t.barrier, p: pr(simplify(run, 0.2)) })
      continue
    }
    if (t.natural === "tree_row") {
      for (const run of clipLine(pts, box))
        for (let i = 0; i < run.length - 1; i++) {
          const [ax, az] = run[i]
          const [bx, bz] = run[i + 1]
          const L = Math.hypot(bx - ax, bz - az)
          for (let d = 0; d < L; d += 7) trees.push([r1(ax + ((bx - ax) * d) / L), r1(az + ((bz - az) * d) / L), 1, "broadleaf"])
        }
      continue
    }
    if (t.highway) {
      const kind = /^(footway|path|pedestrian|steps)$/.test(t.highway) ? "foot" : t.highway === "cycleway" ? "cycle" : t.highway === "service" ? (t.service === "parking_aisle" ? "aisle" : "service") : /^(primary|secondary|trunk|motorway|primary_link|secondary_link|trunk_link|motorway_link)$/.test(t.highway) ? "major" : "road"
      if (t.area === "yes") {
        const c = clipPoly(pts, box)
        if (c.length > 2) areas.push({ k: "paved", p: pr(simplify(c, 0.3, true)) })
        continue
      }
      const w = parseFloat(t.width) || { foot: 2, cycle: 2.5, aisle: 6, service: 5.5, road: 9, major: 16 }[kind]
      for (const run of clipLine(pts, box)) roads.push({ k: kind, w: r1(w), p: pr(simplify(run, 0.3)) })
      continue
    }
    if (pts.length < 3) continue
    let k = null
    if (t.amenity === "parking") k = "parking"
    else if (t.leisure === "swimming_pool") k = "pool"
    else if (t.natural === "water" || t.water) k = "water"
    else if (t.natural === "wood" || t.natural === "scrub") k = "wood"
    else if (t.landuse === "grass" || t.leisure === "park" || t.leisure === "garden" || t.natural === "grassland" || t.landuse === "recreation_ground" || t.leisure === "golf_course" || t.landuse === "meadow") k = t.landuse === "recreation_ground" ? "rec" : "grass"
    else if (t.leisure === "playground") k = "play"
    else if (t.landuse === "residential" || t.landuse === "commercial" || t.landuse === "industrial" || t.landuse === "retail") k = "urban"
    else if (t.amenity === "school") k = "school"
    if (!k) continue
    const c = clipPoly(pts, box)
    if (c.length > 2 && Math.abs(polyArea(c)) > 15) areas.push({ k, p: pr(simplify(c, 0.4, true)) })
  }
  // a synthesized hall's building, when the footprint came from a sports_centre area (no building tag)
  if (synthHall && !synthHall.e.tags.building) {
    const pts = synthHall.pts.map(sh)
    const ring = pr(simplify(pts, 0.3, true))
    buildings.push({ p: ring, h: 9, k: "hall", hall: 1 })
    halls.push({ p: ring, h: 9, wall: "#d9d4c8", floor: "#3d4552", pads: "#1d2f5a", ceiling: "#c8ccd2", lights: "#fff8e8", lightsStyle: "strip", beams: true, door: doorFor(ring, els, proj, sh) })
  }
  // too few trees in a park: a few along the courts' edges so it doesn't look bare (deterministic)
  if (!indoor && trees.length < 6 && areas.some((a) => a.k === "grass" || a.k === "rec")) {
    let s = 7
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 10; i++) {
      const side = i % 4
      const t = rnd()
      const x = side < 2 ? box.x0 + 20 + t * (box.x1 - box.x0 - 40) : side === 2 ? cb.x0 - 12 : cb.x1 + 12
      const z = side === 0 ? cb.z0 - 12 : side === 1 ? cb.z1 + 12 : box.z0 + 20 + t * (box.z1 - box.z0 - 40)
      if (!buildings.some((b) => inPoly([x, z], b.p))) trees.push([r1(x), r1(z), 0.9 + rnd() * 0.3, "broadleaf"])
    }
  }

  const palettes = []
  const lit = courts.some((c) => c.lit) || !!(venue.flags & 2)
  const spec = {
    id: venue.id,
    name: venue.name || (venue.town ? `Pickleball courts, ${venue.town}` : "Pickleball courts"),
    short: shortName(venue),
    city: venue.town || "",
    indoor,
    access: venue.flags & 8 ? "private" : venue.flags & 16 ? "members" : "public",
    note: "Built live from OpenStreetMap",
    origin: originLL.map((x) => Math.round(x * 1e6) / 1e6),
    osm_base: raw.osm_base || null,
    live: 6,
    lit,
    generated: 1,
    colors: indoor ? { court: "#5d7c96", kitchen: "#6f8ea8", surround: "#3b4f63" } : {},
    fence: {},
    backdrop: {},
    courts: courts.map((c) => {
      const o = { x: r1(c.x), z: r1(c.z), a: normDeg(c.a), s: c.s[0] }
      if (c.pb) o.pb = c.pb
      if (c.lit) o.lit = 1
      if (c.paint) {
        const key = JSON.stringify(c.paint)
        let k = palettes.findIndex((q) => JSON.stringify(q) === key)
        if (k < 0) k = palettes.push(c.paint) - 1
        o.col = k
      }
      return o
    }),
    palettes,
    extras: [],
    buildings,
    areas,
    roads,
    trees,
    fences,
    lamps,
  }
  if (halls.length) spec.halls = halls
  return spec
}

const shortName = (v) => {
  const n = v.name || ""
  if (n && n.length <= 26) return n
  if (n) return n.replace(/\b(Park|Recreation|Center|Centre|Community|Sports|Complex|Facility|Courts?)\b/g, "").replace(/\s+/g, " ").trim().slice(0, 26) || n.slice(0, 26)
  return v.town ? `Courts, ${v.town}`.slice(0, 26) : "Pickleball courts"
}

// a hall's door: the middle of its wall nearest a parking lot or a road (else its longest wall)
const doorFor = (ring, els, proj, sh) => {
  const targets = []
  for (const e of els) {
    const t = e.tags || {}
    if (!e.g || !(t.amenity === "parking" || (t.highway && t.highway !== "footway"))) continue
    for (const q of e.g) targets.push(sh(proj.xz(q)))
  }
  let best = null
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L < 4) continue
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const d = targets.length ? Math.min(...targets.map((p) => Math.hypot(p[0] - m[0], p[1] - m[1]))) : -L
    if (!best || d < best.d) best = { d, m }
  }
  return best ? [r1(best.m[0]), r1(best.m[1])] : [r1(ring[0][0]), r1(ring[0][1])]
}
