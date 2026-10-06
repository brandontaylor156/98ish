// Real Sky: node --test client/src/components/applets/pickleball/park/realsky.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { moonPosition, skyDir, sunPosition } from "./solar.js"
import { renderSky, skyRadiance } from "./atmosphere.js"
import { _clearWeatherCache, cachedWeather, fetchWeather, weatherOf, weatherUrl, WX_TTL } from "./weather.js"
import { overrideDate, realLook } from "./sky.js"

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(3)} vs ${b} (±${tol})`)

test("sun: solar noon height and direction match the textbook (Los Angeles, solstices, equinox)", () => {
  const lat = 34.05
  const lon = -118.24
  // the sun's height at solar noon is 90 - latitude + declination; find noon by scanning
  for (const iso of ["2026-06-21", "2026-12-21", "2026-03-20"]) {
    let best = { elevation: -99 }
    let at = null
    for (let m = 17 * 60; m < 22 * 60; m += 1) {
      const d = new Date(`${iso}T00:00:00Z`)
      d.setUTCMinutes(m)
      const s = sunPosition(d, lat, lon)
      if (s.elevation > best.elevation) (best = s), (at = d)
    }
    near(best.elevation, 90 - lat + best.declination, 0.15, `${iso} noon height`)
    near(best.azimuth, 180, 1.5, `${iso} noon azimuth`)
    // solar noon in Los Angeles is about 19:50-20:00 UTC all year (longitude + equation of time)
    const mins = at.getUTCHours() * 60 + at.getUTCMinutes()
    assert.ok(mins > 19 * 60 + 35 && mins < 20 * 60 + 20, `${iso} solar noon at ${at.toISOString()}`)
  }
  near(sunPosition(new Date("2026-06-21T19:55:00Z"), lat, lon).declination, 23.44, 0.1, "June solstice declination")
  near(sunPosition(new Date("2026-12-21T19:55:00Z"), lat, lon).declination, -23.44, 0.1, "December solstice declination")
})

test("sun: rises in the east and sets in the west on the equinox, below the horizon at midnight", () => {
  const lat = 33.71
  const lon = -117.92
  const morning = sunPosition(new Date("2026-03-20T14:30:00Z"), lat, lon) // 7:30 PDT
  const evening = sunPosition(new Date("2026-03-21T01:30:00Z"), lat, lon) // 18:30 PDT
  const midnight = sunPosition(new Date("2026-03-20T07:00:00Z"), lat, lon)
  assert.ok(morning.azimuth > 85 && morning.azimuth < 110 && morning.elevation > 0 && morning.elevation < 20, JSON.stringify(morning))
  assert.ok(evening.azimuth > 250 && evening.azimuth < 275 && evening.elevation > -5 && evening.elevation < 12, JSON.stringify(evening))
  assert.ok(midnight.elevation < -40)
  // venue frame: x east, z south
  const east = skyDir(90, 0)
  near(east.x, 1, 1e-9, "east is +x")
  const north = skyDir(0, 0)
  near(north.z, -1, 1e-9, "north is -z")
})

test("moon: full and new moons (January 2024) by its lit fraction", () => {
  const full = moonPosition(new Date("2024-01-25T17:54:00Z"), 34, -118)
  const fresh = moonPosition(new Date("2024-01-11T11:57:00Z"), 34, -118)
  assert.ok(full.lit > 0.95, `full moon lit ${full.lit}`)
  assert.ok(fresh.lit < 0.05, `new moon lit ${fresh.lit}`)
  assert.ok(Number.isFinite(full.azimuth) && Number.isFinite(full.elevation))
})

test("atmosphere: a blue midday sky overhead, a reddened horizon toward a setting sun, dark at night", () => {
  const sun = (el) => [0, Math.sin((el * Math.PI) / 180), -Math.cos((el * Math.PI) / 180)]
  const z = skyRadiance([0, 1, 0], sun(60))
  assert.ok(z[2] > z[1] && z[1] > z[0], `zenith ${z}`)
  const lowEl = (2 * Math.PI) / 180
  const towardSunset = skyRadiance([0, Math.sin(lowEl), -Math.cos(lowEl)], sun(1))
  assert.ok(towardSunset[0] > towardSunset[2], `horizon toward the setting sun ${towardSunset}`)
  const night = renderSky(sun(-15), { w: 16, h: 8 })
  assert.ok(night.zenith.every((c) => c < 0.02), `night ${night.zenith}`)
  const day = renderSky(sun(45), { w: 16, h: 8 })
  assert.equal(day.data.length, 16 * 8 * 4)
  assert.ok(day.zenith[2] > day.zenith[0])
})

test("weather: Open-Meteo's current block -> clouds, rain, snow, wind and fog", () => {
  const clear = weatherOf({ cloud_cover: 3, weather_code: 0, wind_speed_10m: 7.2, wind_direction_10m: 270, visibility: 30000, precipitation: 0 })
  assert.equal(clear.kind, "clear")
  near(clear.cover, 0.03, 1e-9, "cover")
  assert.equal(clear.rain, 0)
  near(clear.wind, 2, 0.01, "7.2 km/h -> 2 m/s")
  near(clear.fog, 0, 1e-9, "no fog")
  const rain = weatherOf({ cloud_cover: 60, weather_code: 63, rain: 2.5, wind_speed_10m: 20, visibility: 6000 })
  assert.equal(rain.kind, "rain")
  assert.ok(rain.rain > 0.5 && rain.rain <= 1)
  assert.ok(rain.cover >= 0.8, "rain means a covered sky")
  assert.ok(rain.fog > 0.3)
  const codeOnly = weatherOf({ weather_code: 61 })
  assert.ok(codeOnly.rain > 0, "a rain code without numbers still rains")
  const snow = weatherOf({ weather_code: 73, snowfall: 0.8, cloud_cover: 100 })
  assert.equal(snow.kind, "snow")
  assert.ok(snow.snow > 0.5 && snow.rain === 0)
  const fog = weatherOf({ weather_code: 45, visibility: 300 })
  assert.ok(fog.fog > 0.95 && fog.haze > 4)
  assert.match(weatherUrl({ lat: 33.714515, lon: -117.923701 }), /latitude=33\.71&longitude=-117\.92&current=cloud_cover/)
})

test("weather: fetched once per venue, cached 20 minutes, offline gives null", async () => {
  _clearWeatherCache()
  let calls = 0
  const fetchFn = async () => {
    calls++
    return { ok: true, json: async () => ({ current: { cloud_cover: 80, weather_code: 3 } }) }
  }
  const place = { lat: 34.1813, lon: -118.4582 }
  const t0 = 1_800_000_000_000
  const a = await fetchWeather(place, { fetchFn, now: t0 })
  const b = await fetchWeather(place, { fetchFn, now: t0 + 60_000 })
  assert.equal(calls, 1)
  assert.equal(a.kind, "cloudy")
  assert.deepEqual(a, b)
  assert.deepEqual(cachedWeather(place, t0 + 5 * 60_000), a)
  assert.equal(cachedWeather(place, t0 + WX_TTL + 1), null)
  await fetchWeather(place, { fetchFn, now: t0 + WX_TTL + 1 })
  assert.equal(calls, 2, "stale: fetched again")
  _clearWeatherCache()
  const offline = await fetchWeather({ lat: 1, lon: 2 }, { fetchFn: async () => Promise.reject(new Error("offline")), now: t0 })
  assert.equal(offline, null)
  assert.equal(await fetchWeather(null), null)
})

test("classic venues: each borrows a real place for Real Weather", async () => {
  const { CLASSIC_PLACES, VENUES } = await import("../venue.js")
  for (const id of Object.keys(VENUES)) {
    const p = CLASSIC_PLACES[id]
    assert.ok(p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.label, `${id} has a place`)
  }
})

test("realLook: a lower sun opens the camera up (paint reads true in any season), never past 1.35x", () => {
  const lat = 33.71
  const lon = -117.92
  const june = realLook({ date: new Date("2026-06-21T19:55:00Z"), lat, lon })
  const dec = realLook({ date: new Date("2026-12-21T19:55:00Z"), lat, lon })
  assert.ok(dec.exposure > june.exposure, `${dec.exposure} > ${june.exposure}`)
  assert.ok(dec.exposure / june.exposure <= 1.36)
})

test("realLook: midday clear is bright with the court lights off; overcast dims the sun; night has stars", () => {
  const lat = 33.71
  const lon = -117.92
  const noon = new Date("2026-07-15T19:50:00Z")
  const clear = realLook({ date: noon, lat, lon })
  assert.equal(clear.real, true)
  assert.equal(clear.kind, "day")
  assert.equal(clear.lights, false)
  assert.ok(clear.sunEl > 70)
  const cloudy = realLook({ date: noon, lat, lon, weather: { cover: 0.95, rain: 0 } })
  assert.ok(cloudy.sun.intensity < clear.sun.intensity * 0.4, `overcast sun ${cloudy.sun.intensity} vs ${clear.sun.intensity}`)
  const night = realLook({ date: new Date("2026-07-16T07:00:00Z"), lat, lon })
  assert.equal(night.kind, "night")
  assert.equal(night.stars, true)
  assert.equal(night.lights, true)
  // the sun's light direction comes from the true sun (south-ish, high, at noon in July)
  assert.ok(clear.sun.dir.y > 0.9)
  const sunset = overrideDate("sunset", lat, lon, new Date("2026-07-15T12:00:00"))
  const atSunset = realLook({ date: sunset, lat, lon })
  assert.ok(atSunset.sunEl < 6 && atSunset.sunEl > -1, `sunset elevation ${atSunset.sunEl}`)
})
