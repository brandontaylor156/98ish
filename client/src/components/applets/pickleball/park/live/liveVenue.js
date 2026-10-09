// Venue Finder in the browser: the index (static shards from /venues/idx, cached in memory)
// and live venues (built by the server from OpenStreetMap: server/venues), kept on the device
// in IndexedDB so a venue you've been to opens offline and at once.
//
// The IndexedDB database "98ish-venues" is device-wide public map data (like map tiles), not
// anyone's own: it isn't per user and holds nothing personal (Help: privacy-device). The last
// 60 venues stay; older ones go first.

import { IDX_BASE, cellsNear, nearest, readRow, searchIndex, searchKey, zipOf } from "./finder.js"

const SERVER_URL = import.meta.env?.VITE_SOCKET_URL || "http://localhost:8000"
const DB = "98ish-venues"
const KEEP = 60

// ---------- the index ----------
const shardCache = new Map()
export const loadShard = (gh) => {
  if (!shardCache.has(gh))
    shardCache.set(
      gh,
      fetch(`${IDX_BASE}/${gh}.json`)
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((j) => (j.rows || []).map((row) => readRow(row, gh)))
        .catch(() => (shardCache.delete(gh), []))
    )
  return shardCache.get(gh)
}
// the names a query can match: one small file per first letter (idx/search/<k>.json)
const searchCache = new Map()
export const loadSearch = (q) => {
  const k = searchKey(q)
  if (!k) return Promise.resolve(null)
  if (!searchCache.has(k))
    searchCache.set(
      k,
      fetch(`${IDX_BASE}/search/${k}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => (searchCache.delete(k), null))
    )
  return searchCache.get(k)
}
let metaCache = null
export const loadMeta = () => (metaCache ??= fetch(`${IDX_BASE}/meta.json`).then((r) => (r.ok ? r.json() : null)).catch(() => (metaCache = null)))

// venues near a point (your location never leaves the phone: it only picks which shards to load)
export const venuesNear = async (lat, lon, { km = 80, limit = 40 } = {}) => {
  const lists = await Promise.all(cellsNear(lat, lon, km).map(loadShard))
  return nearest(lists.flat(), lat, lon, limit, km)
}
// a US ZIP code's center (idx/zip/NN.json, by its first two digits), or null
const zipCache = new Map()
export const zipPoint = async (zip) => {
  const k = zip.slice(0, 2)
  if (!zipCache.has(k)) zipCache.set(k, fetch(`${IDX_BASE}/zip/${k}.json`).then((r) => (r.ok ? r.json() : { z: {} })).catch(() => (zipCache.delete(k), { z: {} })))
  const p = (await zipCache.get(k)).z?.[zip]
  return p ? { lat: p[0], lon: p[1] } : null
}
// search by ZIP code, venue name or town: a ZIP lists the courts around it; names come straight
// from the search file for its first letter; towns open their shard
export const searchVenues = async (q, { from = null } = {}) => {
  const zip = zipOf(q)
  if (zip) {
    const at = await zipPoint(zip)
    if (!at) return []
    const near = await venuesNear(at.lat, at.lon, { km: 40, limit: 30 })
    return near.map((v) => ({ ...v, why: "zip", near: zip, score: -v.km }))
  }
  const idx = await loadSearch(q)
  const { towns, named } = searchIndex(idx, q, 8)
  const out = new Map()
  for (const n of named) {
    const rows = await loadShard(n.shard)
    const v = rows[n.i]
    if (v) out.set(v.id, { ...v, why: "name", score: 10 + n.s })
  }
  for (const t of towns.slice(0, 3)) {
    const near = await venuesNear(t.lat, t.lon, { km: 15, limit: 15 })
    for (const v of near) if (!out.has(v.id)) out.set(v.id, { ...v, why: "town", near: t.name, score: t.s + (v.town === t.name ? 2 : 0) - v.km / 20 })
  }
  let list = [...out.values()]
  if (from) list = list.map((v) => ({ ...v, km: v.km ?? null }))
  return list.sort((a, b) => b.score - a.score).slice(0, 30)
}

// ---------- the device's copy of built venues ----------
const openDb = () =>
  new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore("specs", { keyPath: "id" })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
const tx = async (mode, fn) => {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    const t = db.transaction("specs", mode)
    const out = fn(t.objectStore("specs"))
    // (a request's result: a get for a venue never kept is undefined, so null, not the request
    // itself; that once made a first build slower than 8 s fall back to an empty "device copy")
    t.oncomplete = () => resolve(out && typeof out === "object" && "result" in out ? (out.result ?? null) : (out ?? null))
    t.onerror = () => resolve(null)
  })
}
const readCopy = (id) => tx("readonly", (s) => s.get(id))
const saveCopy = async (rec) => {
  await tx("readwrite", (s) => s.put(rec))
  const all = await tx("readonly", (s) => s.getAll())
  if (all && all.length > KEEP) {
    const old = all.sort((a, b) => a.at - b.at).slice(0, all.length - KEEP)
    await tx("readwrite", (s) => old.forEach((r) => s.delete(r.id)))
  }
}

// ---------- building a venue on this device ----------
// The public Overpass servers turn away the chat server's shared address on Render (every build
// there failed in production, 2026-10-08), and overpass-api.de answers 406 to any browser
// User-Agent. So the phone asks our Vercel function (/api/osm: the app's own User-Agent, cached by
// Vercel's CDN for 30 days), and as a last resort the one public mirror that answers browsers.
// The spec is made here with the same code as the server.
export const OVERPASS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
const askOsm = async (v, osm, fetchImpl, signal) => {
  try {
    const res = await fetchImpl(`/api/osm?lat=${v.lat.toFixed(5)}&lon=${v.lon.toFixed(5)}&r=${Math.round(v.r)}`, { signal })
    const body = res.ok ? await res.json() : null
    if (Array.isArray(body?.elements)) return body
  } catch (error) {
    if (error?.name === "AbortError") throw error
  }
  const data = "data=" + encodeURIComponent(osm.venueQuery(v.lat, v.lon, v.r))
  for (const endpoint of OVERPASS) {
    try {
      // (a form post is a simple request: no CORS preflight)
      const res = await fetchImpl(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: data, signal })
      const raw = res.ok ? await res.json() : null
      if (Array.isArray(raw?.elements)) return { osm_base: raw.osm3s?.timestamp_osm_base || null, elements: osm.compactElements(raw.elements) }
    } catch (error) {
      if (error?.name === "AbortError") throw error
    }
  }
  return null
}
export const buildOnDevice = async (id, shard, { fetchImpl = (...a) => fetch(...a), signal, rows = null } = {}) => {
  const v = (rows || (await loadShard(shard))).find((r) => r.id === id)
  if (!v) throw new Error("That venue isn't in the index.")
  const [osm, gen] = await Promise.all([import("./osmspec.js"), import("../venuegen.js")])
  const raw = await askOsm(v, osm, fetchImpl, signal)
  if (!raw) throw new Error("The map servers are busy. Try this venue again in a minute.")
  const spec = osm.specFromOsm({ elements: raw.elements, osm_base: raw.osm_base }, { id, lat: v.lat, lon: v.lon, r: v.r, name: v.name, town: v.town, courts: v.courts, onTennis: v.onTennis, flags: v.flags })
  const out = gen.generateVenue(spec)
  if (out.info?.exclude?.length) spec.genExclude = out.info.exclude
  const b = out.layoutSpec.bounds
  const info = { courts: out.layoutSpec.courts.length, bounds: { x0: Math.floor(b.x0), x1: Math.ceil(b.x1), z0: Math.floor(b.z0), z1: Math.ceil(b.z1) } }
  return { spec, info }
}

// a live venue's spec: the server's (which also tells the server to open parks there); if the
// server can't build it, built here on the device; else the device's copy when offline.
// -> { spec, info, from: "server" | "built" | "device" } | throws
export const fetchLiveSpec = async (id, shard, { timeoutMs = 45000, buildTimeoutMs = 90000 } = {}) => {
  const copy = await readCopy(id).then((c) => (c?.spec ? c : null))
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), copy ? 8000 : timeoutMs) : null
  let serverError = null
  try {
    const res = await fetch(`${SERVER_URL}/api/venues/${encodeURIComponent(id)}?s=${encodeURIComponent(shard || "")}`, ctl ? { signal: ctl.signal } : {})
    const body = await res.json().catch(() => null)
    if (res.ok && body?.ok) {
      saveCopy({ id, spec: body.spec, info: body.info, at: Date.now() }).catch(() => {})
      return { spec: body.spec, info: body.info, from: "server" }
    }
    serverError = new Error(body?.error || "Venue Finder couldn't build that venue right now.")
  } catch (error) {
    serverError = error.name === "AbortError" ? new Error("Venue Finder is taking too long. Try again in a minute.") : error
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (copy) return { spec: copy.spec, info: copy.info, from: "device" }
  // the server couldn't: build it here
  const ctl2 = typeof AbortController !== "undefined" ? new AbortController() : null
  const timer2 = ctl2 ? setTimeout(() => ctl2.abort(), buildTimeoutMs) : null
  try {
    const built = await buildOnDevice(id, shard, ctl2 ? { signal: ctl2.signal } : {})
    saveCopy({ id, spec: built.spec, info: built.info, at: Date.now() }).catch(() => {})
    // (tell the server the court count and bounds, so friends who pick it meet in one park)
    fetch(`${SERVER_URL}/api/venues/${encodeURIComponent(id)}/info?s=${encodeURIComponent(shard || "")}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(built.info) }).catch(() => {})
    return { ...built, from: "built" }
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Venue Finder is taking too long. Try again in a minute.")
    throw error?.message ? error : serverError
  } finally {
    if (timer2) clearTimeout(timer2)
  }
}

// is this a Venue Finder venue (vs Riverside and the hand-tuned ones)?
export const isLiveId = (id) => /^o[nwr]\d+b?$/.test(String(id || ""))
