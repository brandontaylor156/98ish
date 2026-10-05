import { useSyncExternalStore } from "react"

// 98ish Weather's settings (small, so the taskbar and desktop can read them without loading
// Weather): the saved places, which one is shown, and whether it's in the taskbar tray and
// on the desktop. Per user (98ish.weather, through the storage seam). Places keep only a
// name and where they are, rounded to about a kilometer (weatherCore.placeOf).
//   { places: [{ id, name, admin, country, lat, lon }], current: id | null,
//     tray: false, widget: false, widgetPos: { x, y } | null }

const KEY = "98ish.weather"
export const WEATHER_DEFAULTS = { places: [], current: null, tray: false, widget: false, widgetPos: null }

const load = () => {
  try {
    const p = JSON.parse(localStorage.getItem(KEY))
    if (!p || typeof p !== "object") return { ...WEATHER_DEFAULTS }
    const places = Array.isArray(p.places) ? p.places.filter((x) => x && typeof x.id === "string" && Number.isFinite(x.lat) && Number.isFinite(x.lon)) : []
    return {
      ...WEATHER_DEFAULTS,
      places,
      current: places.some((x) => x.id === p.current) ? p.current : places[0]?.id || null,
      tray: !!p.tray,
      widget: !!p.widget,
      widgetPos: Number.isFinite(p.widgetPos?.x) && Number.isFinite(p.widgetPos?.y) ? p.widgetPos : null,
    }
  } catch {
    return { ...WEATHER_DEFAULTS }
  }
}

let prefs = load()
const listeners = new Set()

export const getWeatherPrefs = () => prefs
export const subscribeWeatherPrefs = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const useWeatherPrefs = () => useSyncExternalStore(subscribeWeatherPrefs, getWeatherPrefs)

export const setWeatherPrefs = (patch) => {
  prefs = { ...prefs, ...(typeof patch === "function" ? patch(prefs) : patch) }
  if (!prefs.places.some((p) => p.id === prefs.current)) prefs.current = prefs.places[0]?.id || null
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // storage blocked: this visit only
  }
  listeners.forEach((fn) => fn())
}

export const currentPlace = (p = prefs) => p.places.find((x) => x.id === p.current) || p.places[0] || null
