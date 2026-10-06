// Venue Finder in the browser: the index (static shards from /venues/idx, cached in memory)
// and live venues (built by the server from OpenStreetMap: server/venues), kept on the device
// in IndexedDB so a venue you've been to opens offline and at once.
//
// The IndexedDB database "98ish-venues" is device-wide public map data (like map tiles), not
// anyone's own: it isn't per user and holds nothing personal (Help: privacy-device). The last
// 60 venues stay; older ones go first.

import { IDX_BASE, cellsNear, nearest, readRow, searchIndex } from "./finder.js"

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
let searchCache = null
export const loadSearch = () => (searchCache ??= fetch(`${IDX_BASE}/search.json`).then((r) => (r.ok ? r.json() : null)).catch(() => (searchCache = null)))
let metaCache = null
export const loadMeta = () => (metaCache ??= fetch(`${IDX_BASE}/meta.json`).then((r) => (r.ok ? r.json() : null)).catch(() => (metaCache = null)))

// venues near a point (your location never leaves the phone: it only picks which shards to load)
export const venuesNear = async (lat, lon, { km = 80, limit = 40 } = {}) => {
  const lists = await Promise.all(cellsNear(lat, lon, km).map(loadShard))
  return nearest(lists.flat(), lat, lon, limit, km)
}
// search by venue name or town: names straight from search.json, towns open their shard
export const searchVenues = async (q, { from = null } = {}) => {
  const idx = await loadSearch()
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
    t.oncomplete = () => resolve(out?.result ?? out ?? null)
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

// a live venue's spec: the server's (which also tells the server to open parks there), else
// the device's copy when offline. -> { spec, info, from: "server" | "device" } | throws
export const fetchLiveSpec = async (id, shard, { timeoutMs = 45000 } = {}) => {
  const copy = await readCopy(id)
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), copy ? 8000 : timeoutMs) : null
  try {
    const res = await fetch(`${SERVER_URL}/api/venues/${encodeURIComponent(id)}?s=${encodeURIComponent(shard || "")}`, ctl ? { signal: ctl.signal } : {})
    const body = await res.json().catch(() => null)
    if (!res.ok || !body?.ok) {
      if (copy) return { spec: copy.spec, info: copy.info, from: "device" }
      throw new Error(body?.error || "Venue Finder couldn't build that venue right now.")
    }
    saveCopy({ id, spec: body.spec, info: body.info, at: Date.now() }).catch(() => {})
    return { spec: body.spec, info: body.info, from: "server" }
  } catch (error) {
    if (copy) return { spec: copy.spec, info: copy.info, from: "device" }
    throw error.name === "AbortError" ? new Error("Venue Finder is taking too long. Try again in a minute.") : error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// is this a Venue Finder venue (vs Riverside and the hand-tuned ones)?
export const isLiveId = (id) => /^o[nwr]\d+b?$/.test(String(id || ""))
