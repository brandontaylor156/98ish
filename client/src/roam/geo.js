// Roam (the open world): map math. Pure; Node-tested (roam.test.js).
//
// Two frames:
// - slippy-map tiles (Web Mercator, z/x/y like every web map; the town's data comes in z16
//   tiles, about 500 m across in Southern California);
// - the town's own metres: x east, z south, y up, from the town's origin (a lat/lon), the same
//   frame My Park's venues use (x east, z south; a heading `yaw` faces (sin yaw, cos yaw)). A
//   town whose origin is a venue's origin puts the venue's park at the same coordinates.
//
// Over a town (10-20 km) an equirectangular projection round the origin is within a few
// centimetres of the truth for what we draw.

export const TILE_ZOOM = 16
export const EXTENT = 4096 // tile-local units across a tile (vector-tile style; ~12 cm at z16)
const M_PER_DEG = 111320

export const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z
export const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}
export const x2lon = (x, z) => (x / 2 ** z) * 360 - 180
export const y2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

// a tile's edges in degrees
export const tileBounds = (z, x, y) => ({ west: x2lon(x, z), east: x2lon(x + 1, z), north: y2lat(y, z), south: y2lat(y + 1, z) })
// the tile a point is in
export const tileOf = (lat, lon, z = TILE_ZOOM) => ({ z, x: Math.floor(lon2x(lon, z)), y: Math.floor(lat2y(lat, z)) })
// every tile a lat/lon box touches -> [{ z, x, y }]
export const tilesInBox = ({ south, west, north, east }, z = TILE_ZOOM) => {
  const x0 = Math.floor(lon2x(west, z))
  const x1 = Math.floor(lon2x(east, z))
  const y0 = Math.floor(lat2y(north, z))
  const y1 = Math.floor(lat2y(south, z))
  const out = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x, y })
  return out
}
export const tileKey = (t) => `${t.z}/${t.x}/${t.y}`

// tile-local units (0..EXTENT across, u east, v south) <-> lat/lon (linear inside a tile:
// the Mercator stretch across 500 m is far below a centimetre)
export const toTileUnits = (b, lat, lon) => [((lon - b.west) / (b.east - b.west)) * EXTENT, ((b.north - lat) / (b.north - b.south)) * EXTENT]
export const fromTileUnits = (b, u, v) => ({ lat: b.north - (v / EXTENT) * (b.north - b.south), lon: b.west + (u / EXTENT) * (b.east - b.west) })

// the town's frame: -> { toXZ(lat, lon), toLatLon(x, z), mx, mz }
export const townFrame = ([lat0, lon0]) => {
  const mz = M_PER_DEG
  const mx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180)
  return {
    lat0,
    lon0,
    mx,
    mz,
    toXZ: (lat, lon) => ({ x: (lon - lon0) * mx, z: (lat0 - lat) * mz }),
    toLatLon: (x, z) => ({ lat: lat0 - z / mz, lon: lon0 + x / mx }),
    // a tile's rectangle in town metres: { x0, z0, x1, z1 } (x0 west, z0 north)
    tileRect: (t) => {
      const b = tileBounds(t.z, t.x, t.y)
      return { x0: (b.west - lon0) * mx, x1: (b.east - lon0) * mx, z0: (lat0 - b.north) * mz, z1: (lat0 - b.south) * mz }
    },
  }
}

// the tiles within r metres of a town point, nearest first -> [{ z, x, y, d }]
export const tilesAround = (frame, x, z, r, zoom = TILE_ZOOM) => {
  const a = frame.toLatLon(x - r, z + r)
  const b = frame.toLatLon(x + r, z - r)
  const list = tilesInBox({ south: a.lat, west: a.lon, north: b.lat, east: b.lon }, zoom)
  for (const t of list) {
    const q = frame.tileRect(t)
    const dx = Math.max(q.x0 - x, 0, x - q.x1)
    const dz = Math.max(q.z0 - z, 0, z - q.z1)
    t.d = Math.hypot(dx, dz)
  }
  return list.filter((t) => t.d <= r).sort((p, q) => p.d - q.d)
}
