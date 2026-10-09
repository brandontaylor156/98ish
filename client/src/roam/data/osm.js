// Roam: what we ask OpenStreetMap for, and how a raw Overpass answer is cut down to the few
// tags the town needs. Pure; shared by the tile function (client/api/town.js) and the offline
// town builder (tools/roam/build-town.mjs). Data © OpenStreetMap contributors, ODbL 1.0.

// one Overpass query for a box (degrees): roads and paths, buildings, land use, parks, water,
// parking, trees, and named places
export const townQuery = ({ south, west, north, east }, timeout = 120) => {
  const b = [south, west, north, east].map((v) => v.toFixed(6)).join(",")
  return `[out:json][timeout:${timeout}][maxsize:268435456];(
way["highway"](${b});
way["building"](${b});
relation["building"]["type"="multipolygon"](${b});
way["landuse"](${b});
relation["landuse"]["type"="multipolygon"](${b});
way["leisure"](${b});
relation["leisure"]["type"="multipolygon"](${b});
way["natural"](${b});
relation["natural"]["type"="multipolygon"](${b});
way["waterway"~"^(river|stream|canal|riverbank)$"](${b});
way["amenity"](${b});
relation["amenity"]["type"="multipolygon"](${b});
way["railway"~"^(rail|light_rail)$"](${b});
way["golf"](${b});
way["tourism"](${b});
node["natural"~"^(tree|peak)$"](${b});
node["tourism"](${b});
node["name"](${b});
);out geom qt;`
}

// the tags the town reads (everything else is dropped)
export const KEEP_TAGS = new Set([
  "highway", "name", "ref", "lanes", "width", "oneway", "bridge", "tunnel", "layer", "sidewalk", "sidewalk:both", "sidewalk:left", "sidewalk:right", "footway", "service", "area", "lit", "surface",
  "building", "building:levels", "height", "min_height", "building:min_level", "roof:shape", "roof:levels",
  "landuse", "leisure", "natural", "waterway", "water", "amenity", "parking", "railway", "golf", "tourism", "shop", "historic", "office", "sport", "denotation", "covered", "location",
])

// a raw Overpass element -> a small one ({ type, id, tags, geom | lat/lon | members }), or null
export const compactElement = (el) => {
  if (!el || !el.type) return null
  const tags = {}
  for (const [k, v] of Object.entries(el.tags || {})) if (KEEP_TAGS.has(k)) tags[k] = String(v).slice(0, 80)
  const r6 = (v) => Math.round(v * 1e6) / 1e6
  if (el.type === "node") return Number.isFinite(el.lat) ? { type: "node", id: el.id, lat: r6(el.lat), lon: r6(el.lon), tags } : null
  if (el.type === "way") {
    const geom = (el.geometry || []).filter(Boolean).map((p) => [r6(p.lat), r6(p.lon)])
    return geom.length >= 2 ? { type: "way", id: el.id, tags, geom } : null
  }
  if (el.type === "relation") {
    const members = (el.members || [])
      .filter((m) => m.type === "way" && Array.isArray(m.geometry) && (m.role === "outer" || m.role === "" || m.role === "inner"))
      .map((m) => ({ role: m.role || "outer", geom: m.geometry.filter(Boolean).map((p) => [r6(p.lat), r6(p.lon)]) }))
    return members.length ? { type: "relation", id: el.id, tags, members } : null
  }
  return null
}

// join a multipolygon's member ways into closed rings ([[lat, lon], ...] each)
export const stitchRings = (ways) => {
  const open = ways.map((w) => w.slice()).filter((w) => w.length >= 2)
  const rings = []
  const same = (a, b) => a[0] === b[0] && a[1] === b[1]
  while (open.length) {
    let ring = open.shift()
    let grew = true
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false
      for (let i = 0; i < open.length; i++) {
        const w = open[i]
        const end = ring[ring.length - 1]
        if (same(end, w[0])) ring = ring.concat(w.slice(1))
        else if (same(end, w[w.length - 1])) ring = ring.concat(w.slice(0, -1).reverse())
        else if (same(ring[0], w[w.length - 1])) ring = w.slice(0, -1).concat(ring)
        else if (same(ring[0], w[0])) ring = w.slice(1).reverse().concat(ring)
        else continue
        open.splice(i, 1)
        grew = true
        break
      }
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) rings.push(ring)
  }
  return rings
}
