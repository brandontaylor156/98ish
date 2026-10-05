// 98ish Weather: weather codes, units, the forecast's shape, places, the cache and the
// icons. Run: node --test client/src/components/applets/weather/weather.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { addPlace, ageMinutes, cToF, compass, conditionOf, forecastUrl, geocodeUrl, isFresh, kmhToMph, parseLocal, placeId, placeLabel, placeOf, pruneCache, removePlace, shapeForecast, shapeSearch, temp, tempNumber, uvLabel, weekdayOf, wind, FRESH_MS, MAX_PLACES } from "./weatherCore.js"
import { ICONS, artFor } from "./weatherArt.js"
import { localeUsesFahrenheit, tempUnit } from "../../../utils/region.js"

// an Open-Meteo answer, trimmed (the real shape: arrays per variable)
const sample = () => ({
  latitude: 41.88,
  longitude: -87.63,
  timezone: "America/Chicago",
  utc_offset_seconds: -18000,
  current: { time: "2026-10-04T14:15", temperature_2m: 21.4, relative_humidity_2m: 55, apparent_temperature: 20.6, is_day: 1, precipitation: 0, weather_code: 2, wind_speed_10m: 14.8, wind_direction_10m: 225, wind_gusts_10m: 30.2, uv_index: 4.1 },
  hourly: {
    time: Array.from({ length: 48 }, (_, i) => `2026-10-0${4 + Math.floor(i / 24)}T${String(i % 24).padStart(2, "0")}:00`),
    temperature_2m: Array.from({ length: 48 }, (_, i) => 10 + (i % 24) / 2),
    precipitation_probability: Array.from({ length: 48 }, (_, i) => (i * 7) % 100),
    weather_code: Array.from({ length: 48 }, (_, i) => (i % 2 ? 61 : 1)),
    is_day: Array.from({ length: 48 }, (_, i) => (i % 24 >= 7 && i % 24 < 19 ? 1 : 0)),
  },
  daily: {
    time: ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"],
    weather_code: [2, 61, 95, 71, 0, 45, 3],
    temperature_2m_max: [22.1, 18, 17, 2, 25, 15, 14],
    temperature_2m_min: [11.2, 9, 8, -3, 14, 7, 6],
    sunrise: Array.from({ length: 7 }, (_, i) => `2026-10-${String(4 + i).padStart(2, "0")}T06:5${i}`),
    sunset: Array.from({ length: 7 }, (_, i) => `2026-10-${String(4 + i).padStart(2, "0")}T18:2${i}`),
    uv_index_max: [4.5, 2, 1, 1, 6, 3, 3],
    precipitation_probability_max: [10, 80, 90, 70, 0, 20, null],
    wind_speed_10m_max: [20, 25, 40, 15, 10, 8, 12],
  },
})

test("weather codes become an icon and words (day, night, wind)", () => {
  assert.deepEqual(conditionOf(0), { icon: "clear-day", label: "Sunny" })
  assert.deepEqual(conditionOf(0, { isDay: false }), { icon: "clear-night", label: "Clear" })
  assert.deepEqual(conditionOf(1, { isDay: false }), { icon: "partly-night", label: "Mostly clear" })
  assert.equal(conditionOf(2).icon, "partly-day")
  assert.equal(conditionOf(3).icon, "cloudy")
  assert.equal(conditionOf(45).icon, "fog")
  assert.equal(conditionOf(53).icon, "drizzle")
  assert.equal(conditionOf(57).label, "Freezing drizzle")
  assert.equal(conditionOf(57).icon, "sleet")
  assert.equal(conditionOf(63).icon, "rain")
  assert.equal(conditionOf(67).icon, "sleet")
  assert.equal(conditionOf(75).icon, "snow")
  assert.equal(conditionOf(80).icon, "showers-day")
  assert.equal(conditionOf(81, { isDay: false }).icon, "showers-night")
  assert.equal(conditionOf(86).icon, "snow")
  assert.equal(conditionOf(95).icon, "storm")
  assert.equal(conditionOf(99).label, "Severe thunderstorm with hail")
  // windy and dry: the wind icon; windy rain stays rain
  assert.deepEqual(conditionOf(1, { windKmh: 45 }), { icon: "wind", label: "Windy, mostly sunny" })
  assert.equal(conditionOf(63, { windKmh: 60 }).icon, "rain")
  // unknown codes don't break
  assert.deepEqual(conditionOf(42), { icon: "cloudy", label: "Unknown" })
  assert.deepEqual(conditionOf(null), { icon: "cloudy", label: "Unknown" })
  // every icon a code can give is drawn
  for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]) {
    for (const isDay of [true, false]) assert.ok(ICONS.includes(conditionOf(code, { isDay }).icon), `${code}`)
  }
})

test("units: °F and °C, mph and km/h, compass points, UV words", () => {
  assert.equal(cToF(0), 32)
  assert.equal(cToF(100), 212)
  assert.equal(cToF(-40), -40)
  assert.equal(temp(21.4, "F"), "71°")
  assert.equal(temp(21.4, "C"), "21°")
  assert.equal(temp(-0.4, "C"), "0°")
  assert.equal(temp(null, "F"), "--")
  assert.equal(tempNumber(37, "F"), 99)
  assert.equal(Math.round(kmhToMph(100)), 62)
  assert.equal(wind(16.1, "F"), "10 mph")
  assert.equal(wind(16.1, "C"), "16 km/h")
  assert.equal(wind(undefined, "C"), "--")
  assert.equal(compass(0), "N")
  assert.equal(compass(225), "SW")
  assert.equal(compass(350), "N")
  assert.equal(compass(-90), "W")
  assert.equal(uvLabel(1), "Low")
  assert.equal(uvLabel(4), "Moderate")
  assert.equal(uvLabel(7), "High")
  assert.equal(uvLabel(9), "Very high")
  assert.equal(uvLabel(12), "Extreme")
})

test("°F or °C follows Regional Settings: °F for the US by default", () => {
  assert.equal(localeUsesFahrenheit("en-US"), true)
  assert.equal(localeUsesFahrenheit("es-US"), true)
  assert.equal(localeUsesFahrenheit("en"), true)
  assert.equal(localeUsesFahrenheit("en-GB"), false)
  assert.equal(localeUsesFahrenheit("fr-FR"), false)
  assert.equal(localeUsesFahrenheit("ja-JP"), false)
  assert.equal(tempUnit({ locale: "en-US", temp: "auto" }), "F")
  assert.equal(tempUnit({ locale: "de-DE", temp: "auto" }), "C")
  assert.equal(tempUnit({ locale: "en-US", temp: "C" }), "C")
  assert.equal(tempUnit({ locale: "de-DE", temp: "F" }), "F")
})

test("the request: metric, the place's own time zone, 7 days, rounded position", () => {
  const url = new URL(forecastUrl({ lat: 41.878113, lon: -87.629799 }))
  assert.equal(url.origin + url.pathname, "https://api.open-meteo.com/v1/forecast")
  assert.equal(url.searchParams.get("latitude"), "41.88")
  assert.equal(url.searchParams.get("longitude"), "-87.63")
  assert.equal(url.searchParams.get("timezone"), "auto")
  assert.equal(url.searchParams.get("forecast_days"), "7")
  for (const v of ["temperature_2m", "apparent_temperature", "relative_humidity_2m", "weather_code", "wind_speed_10m", "uv_index", "is_day"]) assert.ok(url.searchParams.get("current").split(",").includes(v), v)
  assert.ok(url.searchParams.get("daily").includes("sunrise"))
  assert.ok(url.searchParams.get("hourly").includes("precipitation_probability"))
  assert.equal(url.searchParams.get("temperature_unit"), null, "always Celsius; converted for showing")
  const g = new URL(geocodeUrl("  San José  ", "es"))
  assert.equal(g.searchParams.get("name"), "San José")
  assert.equal(g.searchParams.get("language"), "es")
  assert.equal(g.searchParams.get("count"), "8")
})

test("the forecast's shape: now, the next 24 hours from this hour, 7 days", () => {
  const f = shapeForecast(sample())
  assert.equal(f.current.tempC, 21.4)
  assert.equal(f.current.feelsC, 20.6)
  assert.equal(f.current.humidity, 55)
  assert.equal(f.current.isDay, true)
  assert.equal(f.current.uv, 4.1)
  assert.equal(f.hourly.length, 24)
  assert.equal(f.hourly[0].time, "2026-10-04T14:00", "starts at the current hour")
  assert.equal(f.hourly[23].time, "2026-10-05T13:00")
  assert.equal(f.hourly[0].isDay, true)
  assert.equal(f.hourly[10].isDay, false) // midnight
  assert.equal(f.daily.length, 7)
  assert.equal(f.daily[0].maxC, 22.1)
  assert.equal(f.daily[6].pop, null)
  assert.equal(f.daily[0].sunrise, "2026-10-04T06:50")
  assert.equal(f.timezone, "America/Chicago")
  // not a forecast
  assert.equal(shapeForecast({}), null)
  assert.equal(shapeForecast({ error: true, reason: "bad" }), null)
  assert.equal(shapeForecast(null), null)
  // JSON round trip (the cache) keeps it the same
  assert.deepEqual(JSON.parse(JSON.stringify(f)), f)
})

test("local times and weekdays come from the place's own clock", () => {
  assert.deepEqual(parseLocal("2026-10-04T06:52"), { date: "2026-10-04", h: 6, mi: 52 })
  assert.deepEqual(parseLocal("2026-10-04"), { date: "2026-10-04", h: 0, mi: 0 })
  assert.equal(parseLocal("nope"), null)
  assert.equal(weekdayOf("2026-10-04"), 0) // a Sunday
  assert.equal(weekdayOf("2026-10-09"), 5)
})

test("places: only a name and a rounded position, no duplicates, at most 12", () => {
  const p = placeOf({ name: "Chicago", latitude: 41.85003, longitude: -87.65005, admin1: "Illinois", country: "United States", population: 2_700_000, id: 4887398 })
  assert.deepEqual(p, { name: "Chicago", admin: "Illinois", country: "United States", lat: 41.85, lon: -87.65, id: "41.85,-87.65" })
  assert.equal(placeLabel(p), "Chicago, Illinois, United States")
  assert.equal(placeLabel(p, { short: true }), "Chicago")
  assert.equal(placeLabel({ name: "Singapore", admin: "", country: "Singapore" }), "Singapore")
  const me = placeOf({ name: "", latitude: 51.507351, longitude: -0.127758 })
  assert.equal(me.name, "My location")
  assert.equal(me.id, "51.51,-0.13")
  assert.equal(placeOf({ latitude: 95, longitude: 0 }), null)
  assert.equal(placeOf({ name: "x" }), null)
  assert.equal(placeId({ lat: 1, lon: 2 }), "1.00,2.00")

  const found = shapeSearch({ results: [{ name: "Paris", latitude: 48.85341, longitude: 2.3488, country: "France", admin1: "Île-de-France" }, { name: "Paris", latitude: 48.8534, longitude: 2.3488 }, { name: "Paris", latitude: 33.66094, longitude: -95.55551, country: "United States", admin1: "Texas" }] })
  assert.equal(found.length, 2)
  assert.deepEqual(shapeSearch({}), [])

  let places = []
  for (let i = 0; i < 15; i++) places = addPlace(places, placeOf({ name: `Town ${i}`, latitude: i, longitude: i }))
  assert.equal(places.length, MAX_PLACES)
  assert.equal(places[0].name, "Town 14", "the newest first")
  places = addPlace(places, placeOf({ name: "Town 10 again", latitude: 10, longitude: 10 }))
  assert.equal(places.length, MAX_PLACES)
  assert.equal(places[0].name, "Town 10 again")
  assert.equal(places.filter((x) => x.id === "10.00,10.00").length, 1)
  assert.equal(removePlace(places, "10.00,10.00").length, MAX_PLACES - 1)
})

test("the cache: fresh for 30 minutes, kept only for saved places", () => {
  const now = Date.parse("2026-10-04T19:00:00Z")
  const entry = { at: now - 10 * 60_000, data: { x: 1 } }
  assert.equal(isFresh(entry, now), true)
  assert.equal(isFresh({ ...entry, at: now - FRESH_MS }, now), false)
  assert.equal(isFresh({ at: now }, now), false, "no data")
  assert.equal(isFresh(null, now), false)
  // a clock that went backwards doesn't keep an old forecast forever
  assert.equal(isFresh({ at: now + 3 * 3_600_000, data: {} }, now), false)
  assert.equal(ageMinutes(entry, now), 10)
  const cache = { "1.00,1.00": entry, "2.00,2.00": entry }
  assert.deepEqual(Object.keys(pruneCache(cache, [{ id: "2.00,2.00" }])), ["2.00,2.00"])
  assert.deepEqual(pruneCache(null, []), {})
})

test("icons: every one drawn on 32x32, outlined, with a few colors", () => {
  for (const icon of ICONS) {
    const art = artFor(icon)
    assert.equal(art.w, 32)
    assert.equal(art.h, 32)
    const colors = new Set(art.px.filter(Boolean))
    assert.ok(colors.has("#000000") || colors.has("#3a3a3a"), `${icon} has an outline`)
    assert.ok(colors.size >= 3 && colors.size <= 16, `${icon}: ${colors.size} colors`)
    assert.ok(art.px.filter(Boolean).length > 150, `${icon} isn't empty`)
  }
  assert.equal(artFor("no-such-icon"), artFor("cloudy"))
})
