// Roam: the ground's real shape from the free AWS Open Data "Terrain Tiles" (terrarium PNGs;
// USGS 3DEP in the US), the same source as the venues' hills (tools/venues/terrain.py).
// Pure; the PNG's zlib stream is unpacked by whoever calls (node:zlib in the tile function and
// the builder), so this file runs anywhere. Node-tested (roam.test.js).

import { lat2y, lon2x } from "../geo.js"

export const TERRAIN_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
export const TERRAIN_ZOOM = 15

// terrarium: metres = (R * 256 + G + B / 256) - 32768
export const terrariumHeight = (r, g, b) => r * 256 + g + b / 256 - 32768

// a minimal PNG reader: 8-bit RGB or RGBA, not interlaced (what terrarium tiles are).
// inflate(Uint8Array) -> Uint8Array. -> { width, height, channels, data }
export const decodePng = (bytes, inflate) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  for (let i = 0; i < 8; i++) if (u8[i] !== sig[i]) throw new Error("not a PNG")
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  let p = 8
  let width = 0
  let height = 0
  let channels = 0
  const idat = []
  while (p + 8 <= u8.length) {
    const len = dv.getUint32(p)
    const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7])
    const body = u8.subarray(p + 8, p + 8 + len)
    if (type === "IHDR") {
      width = dv.getUint32(p + 8)
      height = dv.getUint32(p + 12)
      const depth = u8[p + 16]
      const color = u8[p + 17]
      const interlace = u8[p + 20]
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) throw new Error("unsupported PNG")
      channels = color === 2 ? 3 : 4
    } else if (type === "IDAT") idat.push(body)
    else if (type === "IEND") break
    p += 12 + len
  }
  let total = 0
  for (const c of idat) total += c.length
  const z = new Uint8Array(total)
  let o = 0
  for (const c of idat) {
    z.set(c, o)
    o += c.length
  }
  const raw = inflate(z)
  const stride = width * channels
  const out = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]
      const a = i >= channels ? out[dst + i - channels] : 0
      const b = y > 0 ? out[dst - stride + i] : 0
      const c = y > 0 && i >= channels ? out[dst - stride + i - channels] : 0
      let v
      if (f === 0) v = x
      else if (f === 1) v = x + a
      else if (f === 2) v = x + b
      else if (f === 3) v = x + ((a + b) >> 1)
      else {
        const pp = a + b - c
        const pa = Math.abs(pp - a)
        const pb = Math.abs(pp - b)
        const pc = Math.abs(pp - c)
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      out[dst + i] = v & 255
    }
  }
  return { width, height, channels, data: out }
}

// an elevation sampler over terrarium tiles: getTile(z, x, y) -> decoded PNG | null (cached
// by the caller). -> (lat, lon) => metres (bilinear between pixel centres, across tile edges)
export const terrainSampler = (getTile, z = TERRAIN_ZOOM) => {
  const px = (gx, gy) => {
    const tx = Math.floor(gx / 256)
    const ty = Math.floor(gy / 256)
    const t = getTile(z, tx, ty)
    if (!t) return null
    const i = ((gy - ty * 256) * t.width + (gx - tx * 256)) * t.channels
    return terrariumHeight(t.data[i], t.data[i + 1], t.data[i + 2])
  }
  return (lat, lon) => {
    const gx = lon2x(lon, z) * 256 - 0.5
    const gy = lat2y(lat, z) * 256 - 0.5
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const a = gx - x0
    const b = gy - y0
    const h00 = px(x0, y0)
    const h10 = px(x0 + 1, y0)
    const h01 = px(x0, y0 + 1)
    const h11 = px(x0 + 1, y0 + 1)
    if ([h00, h10, h01, h11].some((v) => v === null)) return h00 ?? null
    return (h00 * (1 - a) + h10 * a) * (1 - b) + (h01 * (1 - a) + h11 * a) * b
  }
}

// which terrarium tiles a box needs -> [{ z, x, y }]
export const terrainTilesFor = ({ south, west, north, east }, z = TERRAIN_ZOOM) => {
  const x0 = Math.floor((lon2x(west, z) * 256 - 1) / 256)
  const x1 = Math.floor((lon2x(east, z) * 256 + 1) / 256)
  const y0 = Math.floor((lat2y(north, z) * 256 - 1) / 256)
  const y1 = Math.floor((lat2y(south, z) * 256 + 1) / 256)
  const out = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x, y })
  return out
}
