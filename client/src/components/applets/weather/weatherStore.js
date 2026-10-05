import { useSyncExternalStore } from "react"
import { addPlace, forecastUrl, geocodeUrl, isFresh, placeOf, pruneCache, removePlace, shapeForecast, shapeSearch } from "./weatherCore"
import { currentPlace, getWeatherPrefs, setWeatherPrefs } from "../../../utils/weatherPrefs"

// 98ish Weather's forecasts: fetched from Open-Meteo by the browser (weatherCore.js has the
// URLs), kept in localStorage per user (98ish.weather.cache: { [placeId]: { at, data } }) so
// a forecast newer than 30 minutes isn't fetched again and, offline, the last one still
// shows with its time. The Weather window, the tray and the desktop panel share it.
//
//   useForecast(placeId) -> { entry: { at, data } | null, loading, error }
//   ensureForecast(placeId, { force }) (fetches when stale), searchPlaces(text), locate()
//   savePlace(place), forgetPlace(id), choosePlace(id)

const CACHE_KEY = "98ish.weather.cache"
const TIMEOUT_MS = 12_000

const loadCache = () => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY))
    return c && typeof c === "object" ? c : {}
  } catch {
    return {}
  }
}
let cache = loadCache()
const status = {} // placeId -> { loading, error }
let snapshot = { cache, status: { ...status } }
const listeners = new Set()
const emit = () => {
  snapshot = { cache, status: { ...status } }
  listeners.forEach((fn) => fn())
}
const saveCache = () => {
  cache = pruneCache(cache, getWeatherPrefs().places)
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // storage full: this visit only
  }
}

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const getSnapshot = () => snapshot
export const useWeatherStore = () => useSyncExternalStore(subscribe, getSnapshot)
export const useForecast = (id) => {
  const s = useWeatherStore()
  return { entry: (id && s.cache[id]) || null, loading: !!s.status[id]?.loading, error: s.status[id]?.error || null }
}
export const cachedForecast = (id) => cache[id] || null

const getJson = async (url) => {
  const controller = typeof AbortController === "undefined" ? null : new AbortController()
  const timer = controller && setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller?.signal })
    if (!response.ok) throw Object.assign(new Error("server"), { status: response.status })
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

const offline = () => typeof navigator !== "undefined" && navigator.onLine === false
const errorText = (error) =>
  offline() || error?.name === "TypeError" || error?.name === "AbortError"
    ? "offline"
    : error?.status === 429
      ? "busy"
      : "server"

const inflight = new Map()
// the forecast for a saved place, fetched unless a fresh one is cached (or force)
export const ensureForecast = (id, { force = false } = {}) => {
  const place = getWeatherPrefs().places.find((p) => p.id === id)
  if (!place) return Promise.resolve(null)
  if (!force && isFresh(cache[id])) return Promise.resolve(cache[id])
  if (inflight.has(id)) return inflight.get(id)
  status[id] = { loading: true, error: null }
  emit()
  const job = getJson(forecastUrl(place))
    .then((json) => {
      const data = shapeForecast(json)
      if (!data) throw new Error("server")
      cache = { ...cache, [id]: { at: Date.now(), data } }
      saveCache()
      status[id] = { loading: false, error: null }
      return cache[id]
    })
    .catch((error) => {
      status[id] = { loading: false, error: errorText(error) }
      return cache[id] || null
    })
    .finally(() => {
      inflight.delete(id)
      emit()
    })
  inflight.set(id, job)
  return job
}

// city search -> { ok, places, error }
export const searchPlaces = async (text) => {
  const q = String(text || "").trim()
  if (q.length < 2) return { ok: true, places: [] }
  try {
    const language = (typeof navigator !== "undefined" && navigator.language?.split("-")[0]) || "en"
    return { ok: true, places: shapeSearch(await getJson(geocodeUrl(q, language))) }
  } catch (error) {
    return { ok: false, places: [], error: errorText(error) }
  }
}

// "Use my location" (call it from a tap): only the rounded spot is kept -> { ok, place, error }
export const locate = () =>
  new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve({ ok: false, error: "This browser can't tell where you are. Search for your city instead." })
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ ok: true, place: placeOf({ name: "My location", latitude: pos.coords.latitude, longitude: pos.coords.longitude }) }),
      (error) =>
        resolve({
          ok: false,
          error: error?.code === 1 ? "Location isn't allowed for 98ish. Allow it in your browser's settings, or search for your city instead." : "Couldn't find where you are right now. Search for your city instead.",
        }),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 }
    )
  })

export const savePlace = (place) => {
  if (!place) return
  setWeatherPrefs((p) => ({ places: addPlace(p.places, place), current: place.id }))
  ensureForecast(place.id)
}
export const forgetPlace = (id) => {
  setWeatherPrefs((p) => ({ places: removePlace(p.places, id) }))
  saveCache()
  emit()
}
export const choosePlace = (id) => {
  setWeatherPrefs({ current: id })
  ensureForecast(id)
}
export { currentPlace }
