import { useSyncExternalStore } from "react"

// The 98ish clock. A web page can't set the computer's clock, so Date/Time Properties keeps
// its own: the real time, plus an offset the user set, shown in the time zone they chose.
// Saved in localStorage ("98ish.clock") as { zone, offset, autoDst }.
//
// now() returns a Date whose local fields (getHours, getDate, toDateString...) read as the
// 98ish wall clock, so code that shows the time can use it in place of new Date().
// useClock() is the same, as a hook that re-renders every second and when settings change.

const KEY = "98ish.clock"

// Windows 98-style zones: an IANA zone that behaves like each, plus a spot on the map
// (longitude, latitude) for its marker
export const ZONES = [
  { id: "Etc/GMT+12", name: "Eniwetok, Kwajalein", lon: 167, lat: 9 },
  { id: "Pacific/Pago_Pago", name: "Midway Island, Samoa", lon: -171, lat: -14 },
  { id: "Pacific/Honolulu", name: "Hawaii", lon: -158, lat: 21 },
  { id: "America/Anchorage", name: "Alaska", lon: -150, lat: 61 },
  { id: "America/Los_Angeles", name: "Pacific Time (US & Canada); Tijuana", lon: -118, lat: 34 },
  { id: "America/Phoenix", name: "Arizona", lon: -112, lat: 33 },
  { id: "America/Denver", name: "Mountain Time (US & Canada)", lon: -105, lat: 40 },
  { id: "America/Chicago", name: "Central Time (US & Canada)", lon: -88, lat: 42 },
  { id: "America/Mexico_City", name: "Mexico City, Tegucigalpa", lon: -99, lat: 19 },
  { id: "America/Regina", name: "Saskatchewan", lon: -105, lat: 50 },
  { id: "America/New_York", name: "Eastern Time (US & Canada)", lon: -74, lat: 41 },
  { id: "America/Bogota", name: "Bogota, Lima, Quito", lon: -74, lat: 5 },
  { id: "America/Halifax", name: "Atlantic Time (Canada)", lon: -64, lat: 45 },
  { id: "America/La_Paz", name: "Caracas, La Paz", lon: -68, lat: -16 },
  { id: "America/St_Johns", name: "Newfoundland", lon: -53, lat: 48 },
  { id: "America/Sao_Paulo", name: "Brasilia", lon: -47, lat: -16 },
  { id: "America/Argentina/Buenos_Aires", name: "Buenos Aires, Georgetown", lon: -58, lat: -35 },
  { id: "Atlantic/South_Georgia", name: "Mid-Atlantic", lon: -36, lat: -54 },
  { id: "Atlantic/Azores", name: "Azores, Cape Verde Is.", lon: -26, lat: 38 },
  { id: "Europe/London", name: "Greenwich Mean Time; Dublin, Edinburgh, Lisbon, London", lon: 0, lat: 51 },
  { id: "Africa/Monrovia", name: "Casablanca, Monrovia", lon: -10, lat: 6 },
  { id: "Europe/Berlin", name: "Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna", lon: 13, lat: 52 },
  { id: "Europe/Paris", name: "Brussels, Copenhagen, Madrid, Paris", lon: 2, lat: 49 },
  { id: "Europe/Prague", name: "Belgrade, Bratislava, Budapest, Prague", lon: 19, lat: 47 },
  { id: "Europe/Warsaw", name: "Sarajevo, Skopje, Sofija, Warsaw, Zagreb", lon: 21, lat: 52 },
  { id: "Africa/Lagos", name: "West Central Africa", lon: 3, lat: 6 },
  { id: "Europe/Athens", name: "Athens, Istanbul, Minsk", lon: 24, lat: 38 },
  { id: "Europe/Helsinki", name: "Helsinki, Riga, Tallinn", lon: 25, lat: 60 },
  { id: "Africa/Cairo", name: "Cairo", lon: 31, lat: 30 },
  { id: "Africa/Johannesburg", name: "Harare, Pretoria", lon: 28, lat: -26 },
  { id: "Asia/Jerusalem", name: "Israel", lon: 35, lat: 32 },
  { id: "Europe/Moscow", name: "Moscow, St. Petersburg, Volgograd", lon: 38, lat: 56 },
  { id: "Asia/Riyadh", name: "Baghdad, Kuwait, Riyadh", lon: 45, lat: 25 },
  { id: "Africa/Nairobi", name: "Nairobi", lon: 37, lat: -1 },
  { id: "Asia/Tehran", name: "Tehran", lon: 51, lat: 36 },
  { id: "Asia/Dubai", name: "Abu Dhabi, Muscat", lon: 55, lat: 24 },
  { id: "Asia/Baku", name: "Baku, Tbilisi", lon: 50, lat: 40 },
  { id: "Asia/Kabul", name: "Kabul", lon: 69, lat: 35 },
  { id: "Asia/Karachi", name: "Islamabad, Karachi, Tashkent", lon: 67, lat: 25 },
  { id: "Asia/Kolkata", name: "Bombay, Calcutta, Madras, New Delhi", lon: 77, lat: 29 },
  { id: "Asia/Kathmandu", name: "Kathmandu", lon: 85, lat: 28 },
  { id: "Asia/Dhaka", name: "Astana, Almaty, Dhaka", lon: 90, lat: 24 },
  { id: "Asia/Colombo", name: "Colombo", lon: 80, lat: 7 },
  { id: "Asia/Yangon", name: "Rangoon", lon: 96, lat: 17 },
  { id: "Asia/Bangkok", name: "Bangkok, Hanoi, Jakarta", lon: 101, lat: 14 },
  { id: "Asia/Shanghai", name: "Beijing, Chongqing, Hong Kong, Urumqi", lon: 116, lat: 40 },
  { id: "Australia/Perth", name: "Perth", lon: 116, lat: -32 },
  { id: "Asia/Singapore", name: "Singapore", lon: 104, lat: 1 },
  { id: "Asia/Taipei", name: "Taipei", lon: 121, lat: 25 },
  { id: "Asia/Tokyo", name: "Osaka, Sapporo, Tokyo", lon: 140, lat: 36 },
  { id: "Asia/Seoul", name: "Seoul", lon: 127, lat: 38 },
  { id: "Asia/Yakutsk", name: "Yakutsk", lon: 130, lat: 62 },
  { id: "Australia/Adelaide", name: "Adelaide", lon: 139, lat: -35 },
  { id: "Australia/Darwin", name: "Darwin", lon: 131, lat: -12 },
  { id: "Australia/Brisbane", name: "Brisbane", lon: 153, lat: -27 },
  { id: "Australia/Sydney", name: "Canberra, Melbourne, Sydney", lon: 151, lat: -34 },
  { id: "Pacific/Guam", name: "Guam, Port Moresby", lon: 145, lat: 13 },
  { id: "Australia/Hobart", name: "Hobart", lon: 147, lat: -43 },
  { id: "Asia/Vladivostok", name: "Vladivostok", lon: 132, lat: 43 },
  { id: "Pacific/Noumea", name: "Magadan, Solomon Is., New Caledonia", lon: 166, lat: -22 },
  { id: "Pacific/Auckland", name: "Auckland, Wellington", lon: 175, lat: -41 },
  { id: "Pacific/Fiji", name: "Fiji, Kamchatka, Marshall Is.", lon: 178, lat: -18 },
  { id: "Pacific/Tongatapu", name: "Nuku'alofa", lon: -175, lat: -21 },
]

export const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

// ---- zone math ----

const formatters = {}
const formatterFor = (zone) =>
  (formatters[zone] ||= new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }))

// how far (ms) a zone's clocks are ahead of UTC at real time t
export const zoneOffset = (zone, t = Date.now()) => {
  try {
    const parts = Object.fromEntries(formatterFor(zone).formatToParts(new Date(t)).map((p) => [p.type, p.value]))
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second)
    return asUtc - (t - (((t % 1000) + 1000) % 1000))
  } catch {
    return -new Date(t).getTimezoneOffset() * 60000
  }
}

const seasons = (t) => {
  const year = new Date(t).getUTCFullYear()
  return [Date.UTC(year, 0, 15), Date.UTC(year, 6, 15)]
}

// the zone's offset without daylight saving (the smaller of winter's and summer's)
export const standardOffset = (zone, t = Date.now()) => Math.min(...seasons(t).map((s) => zoneOffset(zone, s)))

export const observesDst = (zone, t = Date.now()) => {
  const [a, b] = seasons(t).map((s) => zoneOffset(zone, s))
  return a !== b
}

// "(GMT-08:00)", "(GMT+05:30)", "(GMT)"
export const gmtLabel = (offsetMs) => {
  if (!offsetMs) return "(GMT)"
  const minutes = Math.round(Math.abs(offsetMs) / 60000)
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0")
  const mm = String(minutes % 60).padStart(2, "0")
  return `(GMT${offsetMs < 0 ? "-" : "+"}${hh}:${mm})`
}

// "Pacific Daylight Time", or the standard name when daylight saving is off
export const zoneName = (zone, t = Date.now(), autoDst = true) => {
  try {
    let at = t
    if (!autoDst) at = seasons(t).find((s) => zoneOffset(zone, s) === standardOffset(zone, t))
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "long" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")
    return part?.value || zone
  } catch {
    return zone
  }
}

// ---- settings ----

const DEFAULTS = { zone: null, offset: 0, autoDst: true }

const load = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY))
    return { ...DEFAULTS, ...saved, offset: Number(saved?.offset) || 0 }
  } catch {
    return { ...DEFAULTS }
  }
}

let settings = load()
const listeners = new Set()

export const getClockSettings = () => settings
export const currentZone = (s = settings) => s.zone || localZone()

export const setClockSettings = (patch) => {
  settings = { ...settings, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // storage unavailable: the change lasts until the page reloads
  }
  refresh()
}

// The wall clock for some settings at real time `real`, as a Date whose local fields read
// as that wall time
export const wallClock = (s = settings, real = Date.now()) => {
  const t = real + (s.offset || 0)
  const zone = currentZone(s)
  const offset = s.autoDst === false ? standardOffset(zone, t) : zoneOffset(zone, t)
  const w = new Date(t + offset)
  return new Date(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds(), w.getUTCMilliseconds())
}

export const now = () => wallClock()

// ---- the ticking hook ----

let snapshot = now()
let timer = null

const refresh = () => {
  snapshot = now()
  listeners.forEach((fn) => fn())
}

// tick on the second, so every clock on screen changes together
const schedule = () => {
  timer = setTimeout(() => {
    refresh()
    schedule()
  }, 1000 - (Date.now() % 1000) + 5)
}

const onStorage = (e) => {
  if (e.key !== KEY) return
  settings = load()
  refresh()
}

const subscribe = (fn) => {
  listeners.add(fn)
  if (listeners.size === 1) {
    snapshot = now()
    schedule()
    window.addEventListener("storage", onStorage)
  }
  return () => {
    listeners.delete(fn)
    if (!listeners.size) {
      clearTimeout(timer)
      window.removeEventListener("storage", onStorage)
    }
  }
}

export const useClock = () => useSyncExternalStore(subscribe, () => snapshot)
