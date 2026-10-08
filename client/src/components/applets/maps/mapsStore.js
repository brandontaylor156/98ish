// Maps 98's network side: search (Photon, Nominatim as a fallback), reverse lookups and
// routes (Valhalla), each cached and spaced out to respect the free services' usage policies
// (mapsCore.js says which and why); recent places in localStorage (per 98ish user).
import * as M from "./mapsCore.js"

const RECENT_KEY = "98ish.maps" // { recents: [place], mode }
const searchCache = M.createCache(80)
const routeCache = M.createCache(30)
const reverseCache = M.createCache(40)

// at most one request a second to each service, in order
const gates = {}
const gate = (name, gapMs = 1000) => {
  const g = (gates[name] ??= { last: 0, chain: Promise.resolve() })
  const run = g.chain.then(async () => {
    const wait = g.last + gapMs - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    g.last = Date.now()
  })
  g.chain = run.catch(() => {})
  return run
}

const getJson = async (url, { timeout = 12000 } = {}) => {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null
  const t = setTimeout(() => ctl?.abort(), timeout)
  try {
    const res = await fetch(url, { signal: ctl?.signal, headers: { Accept: "application/json" } })
    if (res.status === 429) throw Object.assign(new Error("busy"), { busy: true })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

const offline = () => typeof navigator !== "undefined" && navigator.onLine === false

// places matching `q` (near `near` when known) -> { ok, places } | { ok: false, error }
export const searchPlaces = async (q, { near = null, explicit = false } = {}) => {
  const text = String(q || "").trim()
  if (text.length < 3) return { ok: true, places: [] }
  const key = `${text.toLowerCase()}|${near ? `${near.lat.toFixed(1)},${near.lon.toFixed(1)}` : ""}`
  const hit = searchCache.get(key)
  if (hit) return { ok: true, places: hit }
  if (offline()) return { ok: false, error: "You're offline. Maps 98 needs the internet to search." }
  try {
    await gate("photon")
    const places = M.placesFromPhoton(await getJson(M.photonSearchUrl(text, { near })))
    if (places.length || !explicit) {
      searchCache.set(key, places)
      return { ok: true, places }
    }
  } catch {
    if (!explicit) return { ok: false, error: "Search isn't answering right now. Press Search to try again." }
  }
  // an explicit search Photon couldn't answer: Nominatim, politely (1 a second)
  try {
    await gate("nominatim", 1100)
    const places = (await getJson(M.nominatimSearchUrl(text))).map(M.placeFromNominatim).filter(Boolean)
    searchCache.set(key, places)
    return { ok: true, places }
  } catch {
    return { ok: false, error: "Search isn't answering right now. Try again in a minute." }
  }
}

// what's at a point (for "you are here" and dropped pins) -> a place or null
export const placeAt = async (lat, lon) => {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`
  const hit = reverseCache.get(key)
  if (hit !== undefined) return hit
  try {
    await gate("photon")
    const place = M.placesFromPhoton(await getJson(M.photonReverseUrl(lat, lon)))[0] || null
    reverseCache.set(key, place)
    return place
  } catch {
    return null
  }
}

// a route -> { ok, route } | { ok: false, error }
export const findRoute = async (from, to, mode, { metric = false } = {}) => {
  const key = `${from.lat.toFixed(4)},${from.lon.toFixed(4)}>${to.lat.toFixed(5)},${to.lon.toFixed(5)}|${mode}|${metric}`
  const hit = routeCache.get(key)
  if (hit) return { ok: true, route: hit }
  if (offline()) return { ok: false, error: "You're offline. Directions need the internet." }
  try {
    await gate("valhalla")
    const json = await getJson(M.routeUrl(from, to, mode, { metric }), { timeout: 20000 })
    const route = M.shapeRoute(json)
    if (!route) return { ok: false, error: "No route found between those places." }
    routeCache.set(key, route)
    return { ok: true, route }
  } catch (e) {
    if (e?.busy) return { ok: false, error: "The free directions service is busy. Try again in a few seconds." }
    // Valhalla says why in its body (no route over water, too far to walk...)
    return { ok: false, error: `No ${M.modeOf(mode).label.toLowerCase()} route found. Try another way of getting there, or Open in Apple Maps.` }
  }
}

// ---- recents and the last mode (this device, per 98ish user) ----
export const loadPrefs = () => {
  try {
    const p = JSON.parse(localStorage.getItem(RECENT_KEY) || "{}")
    return { recents: Array.isArray(p.recents) ? p.recents.filter((x) => Number.isFinite(x?.lat)) : [], mode: M.modeOf(p.mode).id }
  } catch {
    return { recents: [], mode: "drive" }
  }
}
export const savePrefs = (prefs) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify({ recents: prefs.recents.slice(0, 12), mode: prefs.mode }))
  } catch {
    // storage blocked: this visit only
  }
}
