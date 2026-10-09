// Roam: fetching the town's tiles round where you are. A town's prebuilt tiles are static
// files (/roam/<town>/16/x/y.json, cached by the CDN and the service worker); anything outside
// them comes from the tile function (/api/town?z&x&y, built live from OpenStreetMap and cached
// by Vercel's CDN for 30 days). Two at a time from the static files, one at a time from the
// function, nearest first, with a growing pause after a failure. Pure apart from fetch;
// Node-tested with a fake fetch (roam.test.js).

import { decodeTile } from "./data/tile.js"
import { tileKey } from "./geo.js"

export const createTileStore = ({ town, frame, fetchFn = (...a) => globalThis.fetch(...a), apiBase = "", keep = 60 } = {}) => {
  let index = null
  let base = town.base ?? 0
  let indexP = null
  let indexDone = !town.prebuilt
  const decoded = new Map() // key -> decoded tile (most recently used last)
  const pending = new Map() // key -> promise
  const failed = new Map() // key -> { until, n }
  let inflight = { static: 0, api: 0 }
  const listeners = new Set()

  const loadIndex = () => {
    if (indexP) return indexP
    indexP = (town.prebuilt ? fetchFn(`${town.prebuilt}/index.json`).then((r) => (r.ok ? r.json() : null)) : Promise.resolve(null))
      .then((ix) => {
        index = ix
        if (ix && Number.isFinite(ix.base)) base = ix.base
        return ix
      })
      .catch(() => (index = null))
      .finally(() => (indexDone = true))
    return indexP
  }
  const prebuilt = (t) => !!index && t.z === index.z && t.x >= index.x0 && t.x <= index.x1 && t.y >= index.y0 && t.y <= index.y1
  const urlOf = (t) => (prebuilt(t) ? `${town.prebuilt}/${t.z}/${t.x}/${t.y}.json` : `${apiBase}/api/town?z=${t.z}&x=${t.x}&y=${t.y}`)

  const fetchTile = async (t) => {
    const key = tileKey(t)
    const kind = prebuilt(t) ? "static" : "api"
    inflight[kind]++
    try {
      const res = await fetchFn(urlOf(t))
      if (!res.ok) throw new Error(`tile ${key}: ${res.status}`)
      const raw = await res.json()
      const tile = decodeTile(raw, frame, base)
      decoded.set(key, tile)
      failed.delete(key)
      while (decoded.size > keep) decoded.delete(decoded.keys().next().value)
      for (const fn of listeners) fn(tile)
      return tile
    } catch (e) {
      const f = failed.get(key) || { n: 0 }
      f.n++
      f.until = Date.now() + Math.min(60000, 2000 * 2 ** (f.n - 1))
      failed.set(key, f)
      return null
    } finally {
      inflight[kind]--
      pending.delete(key)
    }
  }

  // ask for tiles (nearest first); starts what the limits allow -> the ones already here
  const want = (list) => {
    if (!indexDone) loadIndex()
    const have = []
    for (const t of list) {
      const key = tileKey(t)
      const d = decoded.get(key)
      if (d) {
        // (most recently used last)
        decoded.delete(key)
        decoded.set(key, d)
        have.push(d)
        continue
      }
      if (pending.has(key)) continue
      const f = failed.get(key)
      if (f && Date.now() < f.until) continue
      if (!indexDone) continue // (wait for the index: it says where the static tiles are)
      const kind = prebuilt(t) ? "static" : "api"
      if (inflight[kind] >= (kind === "static" ? 3 : 1)) continue
      pending.set(key, fetchTile(t))
    }
    return have
  }

  return {
    ready: () => loadIndex(),
    want,
    get: (key) => decoded.get(key) || null,
    onTile: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    get base() {
      return base
    },
    get index() {
      return index
    },
    get busy() {
      return pending.size
    },
    urlOf,
    whenLoaded: (list) => Promise.all(list.map((t) => pending.get(tileKey(t)) || Promise.resolve(decoded.get(tileKey(t)) || null))),
  }
}
