// Vercel serverless function for Roam (the open world, docs/open-world.md): one z16 map tile
// (about 500 m across) built from OpenStreetMap and the AWS terrain tiles, for any town.
// Overpass is asked with the app's own User-Agent (overpass-api.de answers 406 to browsers and
// turns away Render's shared address; see client/api/osm.js); the terrain PNGs are unpacked
// here with node:zlib. Answers are cached by Vercel's CDN for 30 days (map data, ODbL), so a
// tile is asked of Overpass once a month at most. Valencia's tiles are also prebuilt as static
// files (tools/roam/build-town.mjs); this fills in anywhere else.
// Also mounted by vite.config.js during `npm run dev`.
//
//   ?z=16&x=11282&y=26138   -> the tile (client/src/roam/data/tile.js buildTile form)

import zlib from "node:zlib"
import { townQuery, compactElement } from "../src/roam/data/osm.js"
import { buildTile } from "../src/roam/data/tile.js"
import { TERRAIN_URL, decodePng, terrainSampler, terrainTilesFor } from "../src/roam/data/terrain.js"
import { TILE_ZOOM, tileBounds } from "../src/roam/geo.js"

export const config = { maxDuration: 60 }

const UA = "98ish-roam/1.0 (98ish open world; https://98ish.vercel.app)"
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
const TIMEOUT_MS = 25000
const PAD = 0.0004 // degrees round the tile (~40 m): roads and areas crossing the edge

const timed = async (url, init) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const overpass = async (query) => {
  const seen = []
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await timed(endpoint, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query) })
      if (!response.ok) {
        seen.push(response.status)
        continue
      }
      const json = await response.json()
      if (Array.isArray(json?.elements)) return json.elements.map(compactElement).filter(Boolean)
      seen.push(502)
    } catch (error) {
      seen.push(error.name === "AbortError" ? 504 : 502)
    }
  }
  console.warn("[town] every Overpass server refused:", seen.join(","))
  return null
}

const terrain = async (box) => {
  const list = terrainTilesFor(box)
  const pngs = new Map()
  await Promise.all(
    list.map(async (t) => {
      try {
        const response = await timed(TERRAIN_URL(t.z, t.x, t.y), { headers: { "User-Agent": UA } })
        if (!response.ok) return
        const bytes = new Uint8Array(await response.arrayBuffer())
        pngs.set(`${t.z}/${t.x}/${t.y}`, decodePng(bytes, (b) => new Uint8Array(zlib.inflateSync(b))))
      } catch {
        // (no terrain for that piece: the sampler falls back to its neighbours or flat)
      }
    })
  )
  return pngs.size ? terrainSampler((z, x, y) => pngs.get(`${z}/${x}/${y}`) || null) : null
}

export default async function handler(req, res) {
  // (off by default: building tiles here used up the free plan's 4 hours of function CPU on
  // 2026-10-09; the four towns are prebuilt static files. ROAM_LIVE_TILES=1 turns it back on)
  if (process.env.ROAM_LIVE_TILES !== "1") {
    res.statusCode = 404
    res.setHeader("Cache-Control", "public, s-maxage=86400")
    res.setHeader("Content-Type", "application/json")
    return res.end('{"error":"Live town tiles are off."}')
  }
  const params = Object.fromEntries(new URL(req.url, "http://localhost").searchParams)
  res.setHeader("Content-Type", "application/json")
  const send = (status, body) => {
    res.statusCode = status
    res.setHeader("Cache-Control", status === 200 ? "public, s-maxage=2592000, stale-while-revalidate=2592000" : "no-store")
    res.end(JSON.stringify(body))
  }
  const z = Number(params.z)
  const x = Number(params.x)
  const y = Number(params.y)
  const n = 2 ** TILE_ZOOM
  if (z !== TILE_ZOOM || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) return send(400, { error: "Bad tile" })
  const b = tileBounds(z, x, y)
  // (most of the world's land is far from the poles; past 75 degrees there's nothing to drive)
  if (Math.abs(b.north) > 75) return send(400, { error: "Bad tile" })
  const box = { south: b.south - PAD, west: b.west - PAD, north: b.north + PAD, east: b.east + PAD }
  const [elements, elevation] = await Promise.all([overpass(townQuery(box, 25)), terrain(b)])
  if (!elements) return send(503, { error: "The map servers are busy. Try again in a minute." })
  // (a tile out at sea has no coastline in it to say so: with nothing mapped on it and the
  // ground well under sea level (the terrain's bathymetry), it's the sea; data/sea.js)
  const empty = !elements.some((el) => el.type !== "node")
  const sea = empty && elevation ? (lat, lon) => (elevation(lat, lon) ?? 0) < -5 : null
  send(200, buildTile({ z, x, y, elements, elevation, sea }))
}
