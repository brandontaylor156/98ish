// Roam: a town's getting-around data, built offline from OpenStreetMap by
// tools/roam/build-nav.mjs (docs/open-world.md "Getting around"). Pure; Node-tested
// (transport.test.js). Data © OpenStreetMap contributors, ODbL 1.0.
//
// - the road graph: the drivable roads split at every junction, each edge a polyline with its
//   class, one-way and name (the phone's GPS and the ride app drive on it);
// - transit: the map's own bus routes (route=bus relations: their ways in order and their stops)
//   and train lines (route=train relations, railway=station nodes);
// - places: named things to search for (shops, parks, schools, stations, streets).

export const NAV_CLASS = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, residential: 5, unclassified: 5, living_street: 5, link: 6 }
// speeds the ride app and the GPS estimate with (m/s), by NAV_CLASS
export const NAV_SPEED = [29, 24, 19, 17, 14.5, 11, 15]
const clsOf = (h) => (h.endsWith("_link") ? NAV_CLASS.link : NAV_CLASS[h] ?? null)
const onewayOf = (t) => {
  if (t.oneway === "yes" || t.oneway === "1" || t.oneway === "true") return 1
  if (t.oneway === "-1" || t.oneway === "reverse") return -1
  if (t.oneway === "no") return 0
  if (t.junction === "roundabout" || t.junction === "circular" || t.highway === "motorway" || t.highway === "motorway_link") return 1
  return 0
}

// Douglas-Peucker on [{ x, z }]
export const simplifyXZ = (pts, tol) => {
  if (pts.length < 3) return pts.slice()
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()
    const a = pts[i]
    const b = pts[j]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const L = Math.hypot(dx, dz) || 1e-9
    let best = -1
    let bd = tol
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k].x - a.x) * dz - (pts[k].z - a.z) * dx) / L
      if (d > bd) {
        bd = d
        best = k
      }
    }
    if (best >= 0) {
      keep[best] = 1
      stack.push([i, best], [best, j])
    }
  }
  return pts.filter((_, k) => keep[k])
}
const plen = (pts) => {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)
  return L
}

// raw Overpass elements -> { nodes: [{ x, z }], edges: [{ a, b, cls, ow, name, pts, len }] }
export const buildGraph = (elements, frame) => {
  const ways = elements.filter((e) => e.type === "way" && e.tags?.highway && clsOf(e.tags.highway) !== null && Array.isArray(e.nodes) && Array.isArray(e.geometry) && e.nodes.length === e.geometry.length && e.nodes.length >= 2)
  const uses = new Map()
  for (const w of ways)
    w.nodes.forEach((id, i) => {
      const k = uses.get(id) || 0
      // (a way's ends are always junctions)
      uses.set(id, k + (i === 0 || i === w.nodes.length - 1 ? 2 : 1))
    })
  const index = new Map() // osm node id -> graph node
  const nodes = []
  const nodeOf = (id, g) => {
    let n = index.get(id)
    if (n === undefined) {
      const p = frame.toXZ(g.lat, g.lon)
      n = nodes.length
      nodes.push({ x: Math.round(p.x), z: Math.round(p.z) })
      index.set(id, n)
    }
    return n
  }
  const edges = []
  for (const w of ways) {
    const cls = clsOf(w.tags.highway)
    const ow = onewayOf(w.tags)
    const name = w.tags.name || w.tags.ref || ""
    let start = 0
    for (let i = 1; i < w.nodes.length; i++) {
      if (i < w.nodes.length - 1 && (uses.get(w.nodes[i]) || 0) < 2) continue
      const pts = []
      for (let k = start; k <= i; k++) {
        const p = frame.toXZ(w.geometry[k].lat, w.geometry[k].lon)
        pts.push({ x: p.x, z: p.z })
      }
      let a = nodeOf(w.nodes[start], w.geometry[start])
      let b = nodeOf(w.nodes[i], w.geometry[i])
      let sp = simplifyXZ(pts, 2).map((p) => ({ x: Math.round(p.x), z: Math.round(p.z) }))
      let o = ow
      if (o === -1) {
        ;[a, b] = [b, a]
        sp = sp.reverse()
        o = 1
      }
      if (a !== b || sp.length > 2) edges.push({ a, b, cls, ow: o, name, pts: sp, len: plen(sp) })
      start = i
    }
  }
  return { nodes, edges }
}

// -> the compact form written to nav.json: { names, n: [x, z, ...], e: [[a, b, cls, ow, name, dx, dz, ...]] }
// (each edge's inner points as steps from its first node)
export const encodeGraph = ({ nodes, edges }) => {
  const names = []
  const nameIx = new Map()
  const n = []
  for (const p of nodes) n.push(p.x, p.z)
  const e = edges.map((ed) => {
    let ni = nameIx.get(ed.name)
    if (ni === undefined) {
      ni = names.length
      names.push(ed.name)
      nameIx.set(ed.name, ni)
    }
    const row = [ed.a, ed.b, ed.cls, ed.ow, ni]
    let px = nodes[ed.a].x
    let pz = nodes[ed.a].z
    for (let i = 1; i < ed.pts.length - 1; i++) {
      row.push(ed.pts[i].x - px, ed.pts[i].z - pz)
      px = ed.pts[i].x
      pz = ed.pts[i].z
    }
    return row
  })
  return { names, n, e }
}

// stitch a relation's member ways into one line, in member order ([[lat, lon], ...] each)
export const stitchLine = (ways) => {
  const out = []
  const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-7 && Math.abs(p[1] - q[1]) < 1e-7
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2
  for (let i = 0; i < ways.length; i++) {
    let w = ways[i]
    if (w.length < 2) continue
    if (!out.length) {
      // (the first way: the end that meets the next way goes last)
      const next = ways.slice(i + 1).find((q) => q.length >= 2)
      if (next && Math.min(d2(w[0], next[0]), d2(w[0], next[next.length - 1])) < Math.min(d2(w[w.length - 1], next[0]), d2(w[w.length - 1], next[next.length - 1]))) w = w.slice().reverse()
      out.push(...w)
      continue
    }
    const end = out[out.length - 1]
    if (d2(w[w.length - 1], end) < d2(w[0], end)) w = w.slice().reverse()
    out.push(...(same(w[0], end) ? w.slice(1) : w))
  }
  return out
}

// the nearest point of a polyline [{ x, z }] -> { s, d, x, z }
export const projectLine = (pts, x, z, cum = null) => {
  const c = cum || cumOf(pts)
  let best = { s: 0, d: Infinity, x: pts[0].x, z: pts[0].z }
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const L2 = dx * dx + dz * dz || 1e-9
    const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2))
    const px = a.x + dx * k
    const pz = a.z + dz * k
    const d = Math.hypot(x - px, z - pz)
    if (d < best.d) best = { s: c[i] + Math.sqrt(L2) * k, d, x: px, z: pz }
  }
  return best
}
export const cumOf = (pts) => {
  const c = [0]
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z))
  return c
}

// a line, kept to the part inside the box (plus a margin): the longest run of points inside
const keepInside = (pts, inside) => {
  let best = []
  let run = []
  for (const p of pts) {
    if (inside(p)) run.push(p)
    else {
      if (run.length > best.length) best = run
      run = []
    }
  }
  if (run.length > best.length) best = run
  return best
}

// raw Overpass elements -> { buses: [{ ref, name, to, path: [x, z, ...], stops: [[name, s], ...] }],
// trains: [{ name, path, stations: [[name, s], ...] }], stations: [[name, x, z]] }
export const buildTransit = (elements, frame, bbox, { maxBus = 40 } = {}) => {
  const tagsOf = new Map()
  for (const e of elements) if (e.type === "node" && e.tags) tagsOf.set(e.id, e.tags)
  const m = 0.004 // (~400 m past the box)
  const inside = (p) => p.lat > bbox.south - m && p.lat < bbox.north + m && p.lon > bbox.west - m && p.lon < bbox.east + m
  const toXZ = (q) => {
    const p = frame.toXZ(q.lat, q.lon)
    return { x: p.x, z: p.z }
  }
  const line = (rel) => {
    const ways = (rel.members || []).filter((mm) => mm.type === "way" && Array.isArray(mm.geometry) && !/platform/.test(mm.role || "")).map((mm) => mm.geometry.filter(Boolean).map((g) => [g.lat, g.lon]))
    const ll = stitchLine(ways).map(([lat, lon]) => ({ lat, lon }))
    return simplifyXZ(keepInside(ll, inside).map(toXZ), 3).map((p) => ({ x: Math.round(p.x), z: Math.round(p.z) }))
  }
  const stopsOf = (rel, path, maxD) => {
    const cum = cumOf(path)
    const out = []
    for (const mm of rel.members || []) {
      // (a stop is a node with a stop or platform role, or, the older way of mapping, no role at all)
      if (mm.type !== "node" || !(/stop|platform/.test(mm.role || "") || !mm.role) || !Number.isFinite(mm.lat)) continue
      if (!inside(mm)) continue
      const t = tagsOf.get(mm.ref) || {}
      const p = toXZ(mm)
      const at = projectLine(path, p.x, p.z, cum)
      if (at.d > maxD) continue
      const name = t.name || t.ref || ""
      if (out.some((o) => Math.abs(o.s - at.s) < 30 || (name && o.name === name))) continue
      out.push({ name, s: at.s, x: Math.round(p.x), z: Math.round(p.z) })
    }
    out.sort((a, b) => a.s - b.s)
    return out
  }
  const flat = (path) => path.flatMap((p) => [p.x, p.z])
  const buses = []
  const rels = elements.filter((e) => e.type === "relation" && e.tags)
  for (const r of rels) {
    if (r.tags.route !== "bus") continue
    const path = line(r)
    if (path.length < 2 || plen(path) < 800) continue
    const stops = stopsOf(r, path, 45)
    if (stops.length < 3) continue
    buses.push({ id: r.id, ref: String(r.tags.ref || "").slice(0, 12), name: String(r.tags.name || "").slice(0, 80), to: String(r.tags.to || stops[stops.length - 1].name || "").slice(0, 60), path: flat(path), stops: stops.map((s) => [s.name.slice(0, 60), Math.round(s.s)]) })
  }
  // (the routes with the most stops in town first)
  buses.sort((a, b) => b.stops.length - a.stops.length)
  // stations: the map's railway=station|halt nodes
  const stations = []
  for (const e of elements) {
    if (e.type !== "node" || !e.tags?.name || !Number.isFinite(e.lat)) continue
    if (!(e.tags.railway === "station" || e.tags.railway === "halt" || (e.tags.public_transport === "station" && e.tags.train === "yes"))) continue
    if (e.tags.station === "subway" || e.tags.station === "light_rail") continue
    if (e.lat < bbox.south || e.lat > bbox.north || e.lon < bbox.west || e.lon > bbox.east) continue
    const p = toXZ(e)
    if (stations.some((s) => s[0] === e.tags.name && Math.hypot(s[1] - p.x, s[2] - p.z) < 500)) continue
    stations.push([e.tags.name.slice(0, 60), Math.round(p.x), Math.round(p.z)])
  }
  // train lines: route=train relations through the box, with the stations along them
  const trains = []
  for (const r of rels) {
    if (r.tags.route !== "train") continue
    const path = line(r)
    if (path.length < 2 || plen(path) < 1500) continue
    const cum = cumOf(path)
    const st = []
    for (const s of stations) {
      const at = projectLine(path, s[1], s[2], cum)
      if (at.d < 250 && !st.some((q) => q[0] === s[0])) st.push([s[0], Math.round(at.s)])
    }
    // (one of each line through town: the two directions share the track)
    const name = String(r.tags.name || r.tags.ref || "Train").slice(0, 80)
    if (trains.some((t) => t.key === (r.tags.ref || r.tags.name))) continue
    st.sort((a, b) => a[1] - b[1])
    trains.push({ id: r.id, key: r.tags.ref || r.tags.name, name, path: flat(path), stations: st })
  }
  return { buses: buses.slice(0, maxBus), trains: trains.map(({ key, ...t }) => t), stations }
}

// named places from a town's decoded tiles -> [[name, kind, x, z]]
export const buildPlaces = (tiles, transit = null, { max = 6000 } = {}) => {
  const out = []
  const seen = new Map()
  const add = (name, kind, x, z) => {
    if (!name || name.length > 70) return
    const key = name.toLowerCase()
    const list = seen.get(key) || []
    if (list.some((p) => Math.hypot(p[2] - x, p[3] - z) < (kind === "street" ? 900 : 150))) return
    const row = [name, kind, Math.round(x), Math.round(z)]
    list.push(row)
    seen.set(key, list)
    out.push(row)
  }
  const mid = (ring) => ring.reduce((a, p) => ({ x: a.x + p.x / ring.length, z: a.z + p.z / ring.length }), { x: 0, z: 0 })
  for (const t of tiles) {
    for (const p of t.pois) if (p.name) add(p.name, p.kind, p.x, p.z)
    for (const b of t.buildings) if (b.name) {
      const c = mid(b.ring)
      add(b.name, "building", c.x, c.z)
    }
  }
  for (const s of transit?.stations || []) add(s[0], "station", s[1], s[2])
  for (const t of tiles)
    for (const r of t.roads)
      if (r.name && r.cls <= 6 && r.pts.length > 1) {
        const p = r.pts[Math.floor(r.pts.length / 2)]
        add(r.name, "street", p.x, p.z)
      }
  return out.slice(0, max)
}
