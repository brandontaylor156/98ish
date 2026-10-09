// Venue Finder on the 98ish server: any pickleball venue on Earth, built from OpenStreetMap.
//
//   GET /api/venues/:id?s=<shard>   -> { ok, spec, cached }   (id and shard from the index:
//                                       client/public/venues/idx/<shard>.json, a row per venue)
//   GET /api/venues/status          -> { ok, cached, bytes, today: { queries, bytes }, budget }
//
// How a venue gets built: the server finds the venue's row in the same index the phones search
// (so it only ever asks about places in the index, never arbitrary ones), asks Overpass once
// for everything within the venue's radius (one query at a time for the whole server, 2 s
// apart, a daily budget well inside the public instance's policy), turns the answer into a
// venue spec (client/.../park/live/osmspec.js, the same code the tests run) and runs the
// generator (park/venuegen.js) to learn how many courts have live games and the walkable
// bounds. The spec is cached (store.js; 90 days, least recently used out first) and the info
// goes to the park (server/park liveVenues) so friends who pick the same court meet there.
// Nothing about the person asking is kept: the cache is public map data (ODbL).
//
// Env (optional): VENUES_DAILY_QUERIES (250), VENUES_DAILY_MB (60), VENUES_MAX_SPECS (2000),
// VENUES_MAX_MB (40), OVERPASS_URL.

const fs = require("fs")
const path = require("path")
const { pathToFileURL } = require("url")
const express = require("express")
const { createVenueStore, memoryStore } = require("./store")

const PARK = path.join(__dirname, "../../client/src/components/applets/pickleball/park")
const IDX = path.join(__dirname, "../../client/public/venues/idx")
const UA = "98ish-venue-finder/1.0 (Pickleball 98; https://98ish.vercel.app)"
const DAY = 24 * 3600 * 1000
const TTL = 90 * DAY
const MAX_SPEC = 160 * 1024

let modules = null
const loadModules = async () =>
  (modules ??= Promise.all([import(pathToFileURL(path.join(PARK, "live/osmspec.js")).href), import(pathToFileURL(path.join(PARK, "live/finder.js")).href), import(pathToFileURL(path.join(PARK, "venuegen.js")).href)]).then(([osm, finder, gen]) => ({ osm, finder, gen })))

class Refused extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// the main Overpass address, then its sister servers (same operator) when it answers 429/504
const ENDPOINTS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : ["https://overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter"]

const createVenues = ({ store = null, fetchImpl = globalThis.fetch, now = Date.now, idxDir = IDX, endpoints = ENDPOINTS, limits = {} } = {}) => {
  const L = {
    dailyQueries: Number(process.env.VENUES_DAILY_QUERIES) || 250,
    dailyBytes: (Number(process.env.VENUES_DAILY_MB) || 60) * 1024 * 1024,
    gapMs: 2000,
    perIp: 12, // builds per 10 minutes per address
    perIpWindow: 10 * 60 * 1000,
    hot: 200, // specs kept in memory
    ...limits,
  }
  const storeReady = Promise.resolve(store || createVenueStore(process.env.MONGODB_URI, { maxDocs: Number(process.env.VENUES_MAX_SPECS) || 2000, maxBytes: (Number(process.env.VENUES_MAX_MB) || 40) * 1024 * 1024 }))
  storeReady.catch((error) => console.error("[venues] store failed", error))

  // the park asks: courts and bounds of every venue served lately
  const infos = new Map()
  const remember = (id, info) => {
    infos.delete(id)
    infos.set(id, info)
    while (infos.size > 3000) infos.delete(infos.keys().next().value)
  }
  const hot = new Map()
  const keepHot = (id, doc) => {
    hot.delete(id)
    hot.set(id, doc)
    while (hot.size > L.hot) hot.delete(hot.keys().next().value)
  }

  // ---- the index, read from the same files the phones load ----
  const shards = new Map()
  const rowFor = async (id, shard) => {
    if (!/^[0-9a-z]{2}$/.test(shard)) return null
    let rows = shards.get(shard)
    if (!rows) {
      try {
        rows = JSON.parse(await fs.promises.readFile(path.join(idxDir, `${shard}.json`), "utf8")).rows
      } catch {
        return null
      }
      shards.set(shard, rows)
      while (shards.size > 40) shards.delete(shards.keys().next().value)
    }
    const row = rows.find((r) => r[0] === id)
    return row || null
  }

  // ---- Overpass, politely: one at a time, a gap, a daily budget ----
  const today = { day: "", queries: 0, bytes: 0 }
  const roll = () => {
    const d = new Date(now()).toISOString().slice(0, 10)
    if (today.day !== d) Object.assign(today, { day: d, queries: 0, bytes: 0 })
  }
  let chain = Promise.resolve()
  let lastAt = 0
  const overpass = (query) => {
    const run = async () => {
      roll()
      if (today.queries >= L.dailyQueries || today.bytes >= L.dailyBytes) throw new Refused(503, "Venue Finder has built its share of new venues for today. Venues already built still open; try a new one tomorrow.")
      const wait = L.gapMs - (now() - lastAt)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      lastAt = now()
      today.queries++
      let res = null
      for (const endpoint of endpoints) {
        try {
          res = await fetchImpl(endpoint, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query) })
        } catch {
          res = null
          continue
        }
        if (res.status !== 429 && res.status !== 504 && res.status !== 502) break
      }
      if (!res || res.status === 429 || res.status === 504 || res.status === 502) {
        console.warn("[venues] overpass refused:", res ? res.status : "no answer")
        throw new Refused(503, "The map server is busy. Try this venue again in a minute.")
      }
      if (!res.ok) throw new Refused(502, "The map server didn't answer. Try again in a minute.")
      const text = await res.text()
      today.bytes += text.length
      return JSON.parse(text)
    }
    const p = chain.then(run, run)
    chain = p.catch(() => {})
    return p
  }

  const ipHits = new Map()
  const tooMany = (ip) => {
    const t = now()
    const list = (ipHits.get(ip) || []).filter((x) => t - x < L.perIpWindow)
    if (list.length >= L.perIp) return true
    list.push(t)
    ipHits.set(ip, list)
    if (ipHits.size > 5000) ipHits.delete(ipHits.keys().next().value)
    return false
  }

  const building = new Map() // id -> promise (two people asking for one venue: one build)
  const build = async (id, row) => {
    const { osm, finder, gen } = await loadModules()
    const v = finder.readRow(row)
    const raw = await overpass(osm.venueQuery(v.lat, v.lon, v.r))
    const spec = osm.specFromOsm({ elements: osm.compactElements(raw.elements), osm_base: raw.osm3s?.timestamp_osm_base || null }, { id, lat: v.lat, lon: v.lon, r: v.r, name: v.name, town: v.town, courts: v.courts, onTennis: v.onTennis, flags: v.flags })
    const out = gen.generateVenue(spec)
    if (out.info?.exclude?.length) spec.genExclude = out.info.exclude
    // (very busy surroundings: trees and far areas go first to fit the cap)
    let data = JSON.stringify(spec)
    if (data.length > MAX_SPEC) {
      spec.trees = spec.trees.slice(0, 150)
      spec.areas = spec.areas.slice(0, 80)
      spec.roads = spec.roads.slice(0, 80)
      data = JSON.stringify(spec)
    }
    if (data.length > MAX_SPEC) throw new Refused(413, "This venue is too big to build here.")
    const b = out.layoutSpec.bounds
    const info = { courts: out.layoutSpec.courts.length, bounds: { x0: Math.floor(b.x0), x1: Math.ceil(b.x1), z0: Math.floor(b.z0), z1: Math.ceil(b.z1) } }
    const doc = { id, data, size: data.length, info, builtAt: now(), usedAt: now() }
    await (await storeReady).put(doc)
    return doc
  }

  // -> { spec (JSON text), info, cached }
  const getVenue = async (id, shard, ip = "?") => {
    const { finder } = await loadModules()
    if (!finder.parseVenueId(id)) throw new Refused(400, "That isn't a venue.")
    const s = await storeReady
    let doc = hot.get(id) || (await s.get(id))
    const fresh = doc && now() - doc.builtAt < TTL
    if (fresh) {
      keepHot(id, doc)
      remember(id, doc.info)
      if (now() - doc.usedAt > DAY) s.touch(id, now()).catch(() => {})
      return { doc, cached: true }
    }
    const row = await rowFor(id, shard)
    if (!row) {
      if (doc) return { doc, cached: true } // (stale, but the index moved on: still better than nothing)
      throw new Refused(404, "That venue isn't in the index.")
    }
    if (tooMany(ip)) {
      if (doc) return { doc, cached: true }
      throw new Refused(429, "That's a lot of new venues at once. Try again in a few minutes.")
    }
    let p = building.get(id)
    if (!p) {
      p = build(id, row).finally(() => building.delete(id))
      building.set(id, p)
    }
    try {
      doc = await p
    } catch (error) {
      // the map server failed: an old copy still opens
      if (doc) return { doc, cached: true }
      throw error
    }
    keepHot(id, doc)
    remember(id, doc.info)
    return { doc, cached: false }
  }

  const router = () => {
    const r = express.Router()
    r.get("/status", async (_req, response) => {
      roll()
      const s = await storeReady
      response.json({ ok: true, cached: await s.count(), bytes: await s.bytes(), today: { queries: today.queries, bytes: today.bytes }, budget: { queries: L.dailyQueries, bytes: L.dailyBytes } })
    })
    // a venue a phone built itself (the public map servers turned this server away): just its
    // court count and bounds, so friends who pick it meet in one park. Checked against the index.
    r.post("/:id/info", express.json({ limit: "1kb" }), async (request, response) => {
      const id = String(request.params.id)
      const { courts, bounds: b } = request.body || {}
      const n = (x) => Number.isInteger(x) && Math.abs(x) <= 600
      const { finder } = await loadModules()
      if (!finder.parseVenueId(id) || !Number.isInteger(courts) || courts < 1 || courts > 200 || !b || ![b.x0, b.x1, b.z0, b.z1].every(n) || b.x0 >= b.x1 || b.z0 >= b.z1) return response.status(400).json({ ok: false })
      if (!(await rowFor(id, String(request.query.s || "")))) return response.status(404).json({ ok: false })
      if (tooMany(request.ip)) return response.status(429).json({ ok: false })
      if (!infos.has(id)) remember(id, { courts, bounds: { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 } })
      response.json({ ok: true })
    })
    r.get("/:id", async (request, response) => {
      try {
        const { doc, cached } = await getVenue(String(request.params.id), String(request.query.s || ""), request.ip)
        response.set("Cache-Control", "public, max-age=86400")
        response.type("json").send(`{"ok":true,"cached":${cached},"info":${JSON.stringify(doc.info)},"spec":${doc.data}}`)
      } catch (error) {
        if (error instanceof Refused) return response.status(error.status).json({ ok: false, error: error.message })
        console.error("[venues] build failed", error)
        response.status(500).json({ ok: false, error: "Venue Finder couldn't build that venue right now. Try again later." })
      }
    })
    return r
  }

  return { router, getVenue, liveVenues: { info: (id) => infos.get(id) || null }, getStore: () => storeReady, today: () => ({ ...today }) }
}

const venuesService = () => createVenues({ store: process.env.MONGODB_URI ? undefined : memoryStore() })

module.exports = { createVenues, venuesService, Refused }
