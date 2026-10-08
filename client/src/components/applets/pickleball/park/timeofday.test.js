// node --test client/src/components/applets/pickleball/park/timeofday.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { TIMES, lookFor, nightOk, timeAt, timeDate, validTime } from "./timeofday.js"
import { sunPosition } from "./solar.js"
import { VENUE_LIST } from "./venues/index.js"

const NEWPORT = { lat: 33.611, lon: -117.8795 }
const day = (m, d) => new Date(2026, m, d, 10, 0, 0)

test("time of day: each choice is the right moment for that place and season", () => {
  for (const when of [day(5, 21), day(11, 21)]) {
    const el = (id) => sunPosition(timeDate(id, NEWPORT.lat, NEWPORT.lon, when), NEWPORT.lat, NEWPORT.lon).elevation
    assert.ok(Math.abs(el("morning") - 20) < 2, `morning ${el("morning")}`)
    assert.ok(el("midday") > el("morning") + 10, "midday is higher")
    assert.ok(Math.abs(el("golden") - 6) < 1.5, `golden ${el("golden")}`)
    assert.ok(el("night") < -12, `night ${el("night")}`)
    // (one day: morning, midday, golden hour, then night)
    const t = (id) => timeDate(id, NEWPORT.lat, NEWPORT.lon, when).getTime()
    assert.ok(t("morning") < t("midday") && t("midday") < t("golden") && t("golden") < t("night") && t("night") - t("morning") < 16 * 3_600_000)
  }
  // golden hour comes sooner after noon in December than in June
  const g = (d) => (timeDate("golden", NEWPORT.lat, NEWPORT.lon, d) - timeDate("midday", NEWPORT.lat, NEWPORT.lon, d)) / 3_600_000
  assert.ok(g(day(11, 21)) < g(day(5, 21)) - 1.5)
  assert.equal(validTime("bogus"), "now")
  assert.deepEqual(TIMES.map((t) => t.id), ["now", "morning", "midday", "golden", "night"])
})

test("time of day: night only where the courts really have lights", () => {
  const byId = Object.fromEntries(VENUE_LIST.map((v) => [v.id, v]))
  // lit outdoor courts and indoor halls play at night; Sinaloa (no lights) and Bouquet Canyon (none seen) don't
  for (const id of ["loscab", "newport", "whittier", "paseo", "wolfbear", "smash"]) assert.ok(nightOk(byId[id]), id)
  for (const id of ["sinaloa", "bouquet"]) {
    assert.ok(!nightOk(byId[id]), id)
    assert.equal(timeAt("night", byId[id]), "now")
  }
  assert.equal(timeAt("night", byId.newport), "night")
  // every venue in the list knows where it is (for the sun) and whether it's lit
  for (const v of VENUE_LIST) assert.ok(Number.isFinite(v.lat) && Number.isFinite(v.lon) && typeof v.lit === "boolean", v.id)
})

test("time of day: looks (Real Sky clear for a chosen time, the classic look without Real Sky)", () => {
  const when = day(8, 1)
  const night = lookFor("night", NEWPORT, { now: when })
  assert.ok(night.real && night.lights && night.sunEl < -12)
  const noon = lookFor("midday", NEWPORT, { now: when, weather: { cover: 1, rain: 1 } })
  assert.ok(noon.sunEl > 50 && noon.weather.rain === 0, "a chosen time is clear")
  const rainy = lookFor("now", NEWPORT, { now: new Date(2026, 8, 1, 12), weather: { cover: 1, rain: 0.8 } })
  assert.equal(rainy.weather.rain, 0.8, "now keeps the real weather")
  const low = lookFor("golden", NEWPORT, { now: when, real: false })
  assert.ok(!low.real && Number.isFinite(low.hour))
})
