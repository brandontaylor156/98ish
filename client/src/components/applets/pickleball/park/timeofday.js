// Pickleball 98: what time of day you play (the owner: "You should have the option of what time
// of day you play"). One choice for a match, Practice and My Park, so the same light carries
// from one to the other. Pure (Node-tested in timeofday.test.js).
//
//   now      Real Sky: the true sun, moon and today's weather at that venue right now
//   morning  today when the sun has climbed to 20 degrees (clear)
//   midday   today's solar noon, the sun at its highest (clear)
//   golden   this afternoon as the sun drops through 6 degrees (clear)
//   night    this evening once it's properly dark (clear); only where the courts really have
//            lights (a lit or indoor venue); elsewhere it isn't offered
//
// The moments are worked out from the sun (solar.js) for the venue's own latitude and
// longitude, around that place's own solar noon (so the device's time zone doesn't matter),
// and "golden hour" at Newport in December comes earlier than in June, as it really does.

import { sunPosition } from "./solar.js"
import { CLEAR } from "./weather.js"
import { dayLook, realLook } from "./sky.js"

export const TIMES = [
  { id: "now", label: "Now", hint: "The real sky and weather there" },
  { id: "morning", label: "Morning" },
  { id: "midday", label: "Midday" },
  { id: "golden", label: "Golden hour" },
  { id: "night", label: "Night", hint: "Under the lights" },
]
export const TIME_IDS = TIMES.map((t) => t.id)
export const timeLabel = (id) => TIMES.find((t) => t.id === id)?.label || "Now"
export const validTime = (id) => (TIME_IDS.includes(id) ? id : "now")

// a venue that can be played at night: its courts are lit (OSM lit=yes or seen) or it's indoors
export const nightOk = (v) => !!v && (!!v.lit || !!v.indoor)
// the time actually used at a venue (night where there are no lights falls back to now)
export const timeAt = (id, v) => {
  const t = validTime(id)
  return t === "night" && v && !nightOk(v) ? "now" : t
}

const STEP = 5 * 60_000
const HOUR = 3_600_000
const elAt = (t, lat, lon) => sunPosition(new Date(t), lat, lon).elevation
// the day's solar noon at that place (ms)
const solarNoon = (now, lat, lon) => {
  const d = new Date(now)
  const guess = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12) - (lon / 15) * HOUR
  let best = guess
  let bestEl = -99
  for (let t = guess - 2 * HOUR; t <= guess + 2 * HOUR; t += STEP) {
    const el = elAt(t, lat, lon)
    if (el > bestEl) {
      bestEl = el
      best = t
    }
  }
  return best
}
// the first moment in [t0, t1] where test(elevation, previous) holds
const scan = (t0, t1, lat, lon, test) => {
  let prev = null
  for (let t = t0; t <= t1; t += STEP) {
    const el = elAt(t, lat, lon)
    if (test(el, prev)) return new Date(t)
    prev = el
  }
  return null
}

// the moment a choice stands for, today at that place (a Date)
export const timeDate = (id, lat, lon, now = new Date()) => {
  const t = validTime(id)
  if (t === "now") return new Date(now)
  const noon = solarNoon(now, lat, lon)
  if (t === "morning") return scan(noon - 9 * HOUR, noon, lat, lon, (el) => el >= 20) || new Date(noon - 3.5 * HOUR)
  if (t === "midday") return new Date(noon)
  if (t === "golden") return scan(noon, noon + 9 * HOUR, lat, lon, (el, prev) => prev !== null && prev >= 6 && el < 6) || new Date(noon + 5.5 * HOUR)
  // night: once it's properly dark (the sun 14 degrees down)
  return scan(noon + 4 * HOUR, noon + 12 * HOUR, lat, lon, (el, prev) => prev !== null && prev >= -14 && el < -14) || new Date(noon + 8.5 * HOUR)
}

// the look (sky.js's shape) for a choice at a place: Real Sky with today's weather for "now",
// clear for a chosen time; Low graphics (no Real Sky): the classic hour-based look
export const lookFor = (id, { lat, lon }, { weather = null, real = true, now = new Date() } = {}) => {
  const date = timeDate(id, lat, lon, now)
  if (!real) return dayLook(date.getHours() + date.getMinutes() / 60)
  return realLook({ date, lat, lon, weather: validTime(id) === "now" ? weather || CLEAR : CLEAR })
}
