// 98ish Weather: the rules, with no browser or React in them (tested in Node:
// node --test client/src/components/applets/weather/weather.test.js).
//
// Data: Open-Meteo (https://open-meteo.com), free with no key, CC BY 4.0: the forecast API
// and its geocoding API for finding places. It's called straight from the browser, so the
// free per-IP limit is each person's own. Everything comes in metric (°C, km/h) and is
// converted for showing, so a cached forecast works in either unit.

export const ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)"
export const ATTRIBUTION_URL = "https://open-meteo.com/"
export const FORECAST_API = "https://api.open-meteo.com/v1/forecast"
export const GEOCODE_API = "https://geocoding-api.open-meteo.com/v1/search"
export const FRESH_MS = 30 * 60_000 // a forecast this new isn't fetched again
export const MAX_PLACES = 12

const CURRENT = ["temperature_2m", "relative_humidity_2m", "apparent_temperature", "is_day", "precipitation", "weather_code", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "uv_index"]
const HOURLY = ["temperature_2m", "precipitation_probability", "weather_code", "is_day"]
const DAILY = ["weather_code", "temperature_2m_max", "temperature_2m_min", "sunrise", "sunset", "uv_index_max", "precipitation_probability_max", "wind_speed_10m_max"]

const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places

export const forecastUrl = ({ lat, lon }) =>
  `${FORECAST_API}?latitude=${round(lat)}&longitude=${round(lon)}&current=${CURRENT.join(",")}&hourly=${HOURLY.join(",")}&daily=${DAILY.join(",")}&timezone=auto&forecast_days=7`

export const geocodeUrl = (name, language = "en") => `${GEOCODE_API}?name=${encodeURIComponent(String(name).trim().slice(0, 80))}&count=8&language=${encodeURIComponent(language)}&format=json`

// ---- conditions (WMO weather codes) ----

const CODES = {
  0: ["clear", "Sunny", "Clear"],
  1: ["partly", "Mostly sunny", "Mostly clear"],
  2: ["partly", "Partly cloudy"],
  3: ["cloudy", "Cloudy"],
  45: ["fog", "Fog"],
  48: ["fog", "Freezing fog"],
  51: ["drizzle", "Light drizzle"],
  53: ["drizzle", "Drizzle"],
  55: ["drizzle", "Heavy drizzle"],
  56: ["sleet", "Freezing drizzle"],
  57: ["sleet", "Freezing drizzle"],
  61: ["rain", "Light rain"],
  63: ["rain", "Rain"],
  65: ["rain", "Heavy rain"],
  66: ["sleet", "Freezing rain"],
  67: ["sleet", "Freezing rain"],
  71: ["snow", "Light snow"],
  73: ["snow", "Snow"],
  75: ["snow", "Heavy snow"],
  77: ["snow", "Snow grains"],
  80: ["showers", "Light showers"],
  81: ["showers", "Showers"],
  82: ["rain", "Heavy showers"],
  85: ["snow", "Snow showers"],
  86: ["snow", "Heavy snow showers"],
  95: ["storm", "Thunderstorm"],
  96: ["storm", "Thunderstorm with hail"],
  99: ["storm", "Severe thunderstorm with hail"],
}
export const WINDY_KMH = 40

// the icon (ICONS in weatherArt.js) and words for a weather code:
//   { icon: "clear-day" | "clear-night" | "partly-day" | "partly-night" | "cloudy" | "fog" |
//     "drizzle" | "rain" | "showers-day" | "showers-night" | "sleet" | "snow" | "storm" | "wind", label }
export const conditionOf = (code, { isDay = true, windKmh = 0 } = {}) => {
  const [kind, dayLabel, nightLabel] = (code !== null && code !== undefined && code !== "" && CODES[Number(code)]) || ["cloudy", "Unknown"]
  const label = !isDay && nightLabel ? nightLabel : dayLabel
  // a dry, gusty day gets the wind icon
  if (windKmh >= WINDY_KMH && (kind === "clear" || kind === "partly" || kind === "cloudy")) return { icon: "wind", label: `Windy, ${label.toLowerCase()}` }
  const icon = kind === "clear" || kind === "partly" || kind === "showers" ? `${kind}-${isDay ? "day" : "night"}` : kind
  return { icon, label }
}

// ---- units ----

export const cToF = (c) => (c * 9) / 5 + 32
export const kmhToMph = (k) => k / 1.609344
// 21° (rounded, in the chosen unit; "--" when unknown)
export const temp = (c, unit = "F") => (Number.isFinite(c) ? `${Math.round(unit === "F" ? cToF(c) : c)}°` : "--")
export const tempNumber = (c, unit = "F") => (Number.isFinite(c) ? Math.round(unit === "F" ? cToF(c) : c) : null)
// "12 mph" / "19 km/h": miles for °F people, kilometers for °C
export const wind = (kmh, unit = "F") => (Number.isFinite(kmh) ? (unit === "F" ? `${Math.round(kmhToMph(kmh))} mph` : `${Math.round(kmh)} km/h`) : "--")
const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
// where the wind comes from
export const compass = (deg) => (Number.isFinite(deg) ? DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] : "")
export const uvLabel = (uv) => (!Number.isFinite(uv) ? "--" : uv < 3 ? "Low" : uv < 6 ? "Moderate" : uv < 8 ? "High" : uv < 11 ? "Very high" : "Extreme")

// ---- the forecast, as the window shows it ----

// "2026-10-04T14:00" -> { date: "2026-10-04", h: 14, mi: 0 } (the place's own clock)
export const parseLocal = (iso) => {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(iso || ""))
  return m ? { date: m[1], h: Number(m[2] || 0), mi: Number(m[3] || 0) } : null
}
// 0 = Sunday, for "2026-10-04"
export const weekdayOf = (date) => {
  const [y, m, d] = String(date).split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null)

// Open-Meteo's answer -> { current, hourly (the next 24 hours), daily (7 days), timezone }
// or null when it isn't one
export const shapeForecast = (json) => {
  const c = json?.current
  const h = json?.hourly
  const d = json?.daily
  if (!c || !h?.time || !d?.time) return null
  const current = {
    time: c.time,
    tempC: num(c.temperature_2m),
    feelsC: num(c.apparent_temperature),
    humidity: num(c.relative_humidity_2m),
    isDay: c.is_day !== 0,
    precip: num(c.precipitation),
    code: num(c.weather_code),
    windKmh: num(c.wind_speed_10m),
    windDeg: num(c.wind_direction_10m),
    gustKmh: num(c.wind_gusts_10m),
    uv: num(c.uv_index),
  }
  // from the current hour on
  const nowHour = String(c.time || "").slice(0, 13)
  let start = h.time.findIndex((t) => String(t).slice(0, 13) >= nowHour)
  if (start < 0) start = 0
  const hourly = []
  for (let i = start; i < Math.min(h.time.length, start + 24); i++) {
    hourly.push({ time: h.time[i], tempC: num(h.temperature_2m?.[i]), pop: num(h.precipitation_probability?.[i]), code: num(h.weather_code?.[i]), isDay: h.is_day?.[i] !== 0 })
  }
  const daily = d.time.map((date, i) => ({
    date,
    code: num(d.weather_code?.[i]),
    maxC: num(d.temperature_2m_max?.[i]),
    minC: num(d.temperature_2m_min?.[i]),
    sunrise: d.sunrise?.[i] || null,
    sunset: d.sunset?.[i] || null,
    uv: num(d.uv_index_max?.[i]),
    pop: num(d.precipitation_probability_max?.[i]),
    windKmh: num(d.wind_speed_10m_max?.[i]),
  }))
  return { current, hourly, daily, timezone: json.timezone || "", utcOffset: num(json.utc_offset_seconds) || 0 }
}

// ---- places ----

// a geocoding result (or a spot from "Use my location") as a saved place: only its name
// and where it is, rounded to about a kilometer
export const placeOf = (r) => {
  const lat = num(r?.latitude ?? r?.lat)
  const lon = num(r?.longitude ?? r?.lon)
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const clean = (s, max = 60) => String(s || "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max)
  const place = { name: clean(r.name) || "My location", admin: clean(r.admin1 ?? r.admin), country: clean(r.country), lat: round(lat), lon: round(lon) }
  return { ...place, id: placeId(place) }
}
export const placeId = (p) => `${round(p.lat).toFixed(2)},${round(p.lon).toFixed(2)}`
// "Chicago, Illinois, United States"
export const placeLabel = (p, { short = false } = {}) => (short ? p.name : [p.name, p.admin, p.country].filter((x, i, all) => x && all.indexOf(x) === i).join(", "))

// the geocoding answer as places (no duplicates)
export const shapeSearch = (json) => {
  const seen = new Set()
  return (Array.isArray(json?.results) ? json.results : [])
    .map(placeOf)
    .filter((p) => p && !seen.has(p.id) && seen.add(p.id))
}

// add a place (moving it to the front if it's there), at most MAX_PLACES
export const addPlace = (places, place) => [place, ...places.filter((p) => p.id !== place.id)].slice(0, MAX_PLACES)
export const removePlace = (places, id) => places.filter((p) => p.id !== id)

// ---- the cache: { [placeId]: { at, data } } ----

export const isFresh = (entry, now = Date.now(), ttl = FRESH_MS) => !!entry?.data && now - entry.at < ttl && now >= entry.at - 60_000
// keep only saved places' forecasts
export const pruneCache = (cache, places) => Object.fromEntries(Object.entries(cache || {}).filter(([id]) => places.some((p) => p.id === id)))

// "Updated 2:14 PM" / "Updated yesterday" helper: minutes since
export const ageMinutes = (entry, now = Date.now()) => (entry?.at ? Math.max(0, Math.round((now - entry.at) / 60_000)) : null)
