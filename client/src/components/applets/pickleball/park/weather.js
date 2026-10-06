// Real Sky: today's weather at a venue (Open-Meteo, the Weather app's free source: no key, CC
// BY 4.0, called straight from the browser so Render carries nothing). The venue's own
// coordinates only: never the player's location. Cached for 20 minutes per venue (memory +
// localStorage through the storage seam), so walking between courts or a park game doesn't
// fetch again.
//
// weatherOf(current) is pure (Node-tested): Open-Meteo's "current" block -> what the sky shows:
//   { kind, cover 0..1, rain 0..1, snow 0..1, wind m/s, windDir (degrees the wind comes FROM),
//     visKm, haze (the sky's aerosol factor), fog 0..1, storm }

export const SKY_FORECAST_API = "https://api.open-meteo.com/v1/forecast"
export const WX_TTL = 20 * 60_000
const KEY = "98ish.pickleball.weather"
const MAX_ENTRIES = 40

const CURRENT = ["cloud_cover", "precipitation", "rain", "showers", "snowfall", "weather_code", "wind_speed_10m", "wind_direction_10m", "visibility", "is_day"]

const round2 = (n) => Math.round(n * 100) / 100
export const weatherUrl = ({ lat, lon }) => `${SKY_FORECAST_API}?latitude=${round2(lat)}&longitude=${round2(lon)}&current=${CURRENT.join(",")}&timezone=auto`
export const placeKey = ({ lat, lon }) => `${round2(lat).toFixed(2)},${round2(lon).toFixed(2)}`

const clamp01 = (x) => Math.max(0, Math.min(1, x))
const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d)

// WMO codes -> a kind and how much the code itself says (cover/rain) when the numbers are missing
const kindOf = (code) => {
  if (code >= 95) return "storm"
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow"
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return code <= 57 ? "drizzle" : "rain"
  if (code === 45 || code === 48) return "fog"
  if (code === 3) return "cloudy"
  if (code === 1 || code === 2) return "partly"
  return "clear"
}

export const weatherOf = (cur = {}) => {
  const code = num(cur.weather_code, 0)
  const kind = kindOf(code)
  let cover = clamp01(num(cur.cloud_cover, kind === "clear" ? 5 : kind === "partly" ? 40 : 85) / 100)
  // precipitation in mm/h: 0.1 is a sprinkle, 2 steady rain, 8+ a downpour
  const mm = num(cur.rain, 0) + num(cur.showers, 0) || num(cur.precipitation, 0)
  let rain = clamp01(mm <= 0 ? 0 : 0.25 + Math.log10(1 + mm) * 0.75)
  const snowCm = num(cur.snowfall, 0)
  let snow = clamp01(snowCm <= 0 ? 0 : 0.3 + snowCm * 0.6)
  // the code fills in when the numbers say nothing (rain codes with 0 mm: a light rain)
  if (!rain && !snow && (kind === "rain" || kind === "storm")) rain = kind === "storm" ? 0.8 : 0.45
  if (!rain && !snow && kind === "drizzle") rain = 0.25
  if (!snow && kind === "snow") snow = 0.5
  if (snow && !rain) rain = 0
  if (rain || snow) cover = Math.max(cover, 0.8)
  const visKm = cur.visibility == null ? (kind === "fog" ? 0.6 : 24) : num(cur.visibility, 24000) / 1000
  const fog = clamp01(1 - (visKm - 0.4) / 9.6) // 10 km+ clear, under 1 km thick
  const windKmh = num(cur.wind_speed_10m, 0)
  return {
    kind,
    code,
    cover: round2(cover),
    rain: round2(rain),
    snow: round2(snow),
    wind: round2(windKmh / 3.6),
    windDir: num(cur.wind_direction_10m, 270),
    visKm: round2(visKm),
    fog: round2(fog),
    haze: round2(1 + cover * 1.5 + fog * 4),
    storm: kind === "storm",
    isDay: cur.is_day == null ? null : !!cur.is_day,
  }
}

// the fun overrides (Options > Sky): fixed weather and/or a fixed hour
export const OVERRIDES = {
  clear: { weather: { kind: "clear", cover: 0.04, rain: 0, snow: 0, wind: 2, windDir: 270, visKm: 30, fog: 0, haze: 1, storm: false } },
  cloudy: { weather: { kind: "cloudy", cover: 0.95, rain: 0, snow: 0, wind: 4, windDir: 250, visKm: 18, fog: 0.05, haze: 2.6, storm: false } },
  rain: { weather: { kind: "rain", cover: 1, rain: 0.75, snow: 0, wind: 6, windDir: 220, visKm: 6, fog: 0.4, haze: 4.1, storm: false } },
  sunset: { hourOffset: "sunset", weather: { kind: "partly", cover: 0.3, rain: 0, snow: 0, wind: 2, windDir: 270, visKm: 25, fog: 0, haze: 1.5, storm: false } },
  night: { hourOffset: "night", weather: { kind: "clear", cover: 0.1, rain: 0, snow: 0, wind: 1, windDir: 270, visKm: 30, fog: 0, haze: 1, storm: false } },
}
export const CLEAR = OVERRIDES.clear.weather

// ---- the cache ----
const memory = new Map()
const readStore = () => {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(KEY) || "{}") || {}
  } catch {
    return {}
  }
}
const writeStore = (all) => {
  try {
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, MAX_ENTRIES)
    globalThis.localStorage?.setItem(KEY, JSON.stringify(Object.fromEntries(keys.map((k) => [k, all[k]]))))
  } catch {
    // storage blocked or full: the memory copy still works for this visit
  }
}
export const cachedWeather = (place, now = Date.now()) => {
  const k = placeKey(place)
  const e = memory.get(k) || readStore()[k]
  return e && now - e.at < WX_TTL && now >= e.at - 60_000 ? e.weather : null
}
const inflight = new Map()

// the weather at a venue (resolves to null when offline or refused: the sky stays clear)
export const fetchWeather = async (place, { fetchFn = globalThis.fetch, now = Date.now() } = {}) => {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return null
  const hit = cachedWeather(place, now)
  if (hit) return hit
  const k = placeKey(place)
  if (inflight.has(k)) return inflight.get(k)
  const p = (async () => {
    try {
      const res = await fetchFn(weatherUrl(place))
      if (!res?.ok) return null
      const json = await res.json()
      const weather = weatherOf(json?.current || {})
      const entry = { at: now, weather }
      memory.set(k, entry)
      writeStore({ ...readStore(), [k]: entry })
      return weather
    } catch {
      return null
    } finally {
      inflight.delete(k)
    }
  })()
  inflight.set(k, p)
  return p
}
// (tests)
export const _clearWeatherCache = () => {
  memory.clear()
  inflight.clear()
}
