// Regional Settings (Control Panel): the locale, 12- or 24-hour time, the first day of the
// week and the order of dates. No React and no storage (the Calendar's date math, which
// the server shares, reads it too); settings.js hands over the saved choice with
// setRegionPrefs. "auto" means: what the browser's language does.

export const REGION_DEFAULTS = { locale: "auto", time: "auto", firstDay: "auto", dateOrder: "auto", temp: "auto" }

export const LOCALES = [
  { id: "auto", label: "Same as this device" },
  { id: "en-US", label: "English (United States)" },
  { id: "en-GB", label: "English (United Kingdom)" },
  { id: "en-AU", label: "English (Australia)" },
  { id: "en-CA", label: "English (Canada)" },
  { id: "es-ES", label: "Spanish (Spain)" },
  { id: "es-MX", label: "Spanish (Mexico)" },
  { id: "fr-FR", label: "French (France)" },
  { id: "de-DE", label: "German (Germany)" },
  { id: "it-IT", label: "Italian (Italy)" },
  { id: "pt-BR", label: "Portuguese (Brazil)" },
  { id: "nl-NL", label: "Dutch (Netherlands)" },
  { id: "sv-SE", label: "Swedish (Sweden)" },
  { id: "pl-PL", label: "Polish (Poland)" },
  { id: "ja-JP", label: "Japanese (Japan)" },
  { id: "ko-KR", label: "Korean (Korea)" },
  { id: "zh-CN", label: "Chinese (PRC)" },
  { id: "zh-TW", label: "Chinese (Taiwan)" },
  { id: "hi-IN", label: "Hindi (India)" },
]

let prefs = { ...REGION_DEFAULTS }
export const setRegionPrefs = (p) => {
  prefs = { ...REGION_DEFAULTS, ...(p && typeof p === "object" ? p : {}) }
}
export const getRegionPrefs = () => prefs

const pad = (n) => String(n).padStart(2, "0")

export const localeOf = (p = prefs) => {
  if (p.locale && p.locale !== "auto") return p.locale
  return (typeof navigator !== "undefined" && navigator.language) || "en-US"
}

const safeLocale = (locale) => {
  try {
    return Intl.getCanonicalLocales(locale)[0] || "en-US"
  } catch {
    return "en-US"
  }
}

// does this locale write 7 PM as 19:00?
export const localeUses24h = (locale) => {
  try {
    const cycle = new Intl.DateTimeFormat(safeLocale(locale), { hour: "numeric" }).resolvedOptions().hourCycle
    return cycle === "h23" || cycle === "h24"
  } catch {
    return false
  }
}

// Sunday = 0 ... Saturday = 6. Intl knows it in newer browsers; otherwise the countries
// that start on Sunday, else Monday.
const SUNDAY_REGIONS = new Set(["US", "CA", "MX", "BR", "JP", "KR", "TW", "HK", "IL", "PH", "IN", "ZA", "SA", "PE", "CO", "VE", "GT", "PR", "DO", "SV", "HN", "NI", "PA", "BZ", "JM", "TH", "ID", "KE", "ET", "ZW"])
export const localeWeekStart = (locale) => {
  const id = safeLocale(locale)
  try {
    const loc = new Intl.Locale(id)
    const info = loc.getWeekInfo?.() || loc.weekInfo
    if (info?.firstDay) return info.firstDay % 7
  } catch {
    // older browsers: guess from the country
  }
  const region = id.split("-")[1] || (id.startsWith("en") ? "US" : "")
  return SUNDAY_REGIONS.has(region.toUpperCase()) || !region ? 0 : 1
}

export const uses24h = (p = prefs) => (p.time === "24" ? true : p.time === "12" ? false : localeUses24h(localeOf(p)))

export const weekStart = (p = prefs) => {
  const n = Number(p.firstDay)
  return p.firstDay !== "auto" && p.firstDay !== undefined && n >= 0 && n <= 6 ? n : localeWeekStart(localeOf(p))
}

// the weekdays (0-6) in the order the week is shown
export const weekdayOrder = (first = weekStart()) => Array.from({ length: 7 }, (_, i) => (first + i) % 7)

// 19:05 or 7:05 PM
export const formatTime = (h, mi, p = prefs) => (uses24h(p) ? `${pad(h)}:${pad(mi)}` : `${h % 12 || 12}:${pad(mi)} ${h < 12 ? "AM" : "PM"}`)

// the Calendar's chips: 19:00 or 7p, 7:30p
export const formatShortTime = (h, mi, p = prefs) => (uses24h(p) ? `${pad(h)}:${pad(mi)}` : `${h % 12 || 12}${mi ? `:${pad(mi)}` : ""}${h < 12 ? "a" : "p"}`)

// the hour lines in a day view: 19:00 or 7 PM
export const formatHour = (h, p = prefs) => (uses24h(p) ? `${pad(h)}:00` : `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`)

// month/day/year order for the locale ("mdy", "dmy" or "ymd")
export const localeDateOrder = (locale) => {
  try {
    const parts = new Intl.DateTimeFormat(safeLocale(locale), { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(2001, 10, 22))
    const order = parts.filter((x) => ["year", "month", "day"].includes(x.type)).map((x) => x.type[0]).join("")
    return order === "dmy" || order === "ymd" ? order : "mdy"
  } catch {
    return "mdy"
  }
}
export const dateOrder = (p = prefs) => (["mdy", "dmy", "ymd"].includes(p.dateOrder) ? p.dateOrder : localeDateOrder(localeOf(p)))

// a short date: 10/3/2026, 3/10/2026 or 2026-10-03 (m is 1-12)
export const formatShortDate = (y, m, d, p = prefs) => {
  const order = dateOrder(p)
  if (order === "ymd") return `${y}-${pad(m)}-${pad(d)}`
  if (order === "dmy") return `${d}/${m}/${y}`
  return `${m}/${d}/${y}`
}

// 1,234.56 in the chosen locale
export const formatNumber = (n, p = prefs, options) => {
  try {
    return new Intl.NumberFormat(safeLocale(localeOf(p)), options).format(n)
  } catch {
    return String(n)
  }
}

// temperatures in °F or °C ("auto": °F where the region uses it: the US and a few others)
const FAHRENHEIT_REGIONS = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM", "LR", "BS", "BZ", "KY", "PW", "FM", "MH"])
export const localeUsesFahrenheit = (locale) => {
  const id = safeLocale(locale)
  const region = (id.split("-").find((part, i) => i > 0 && /^[A-Z]{2}$/.test(part)) || (id === "en" ? "US" : "")).toUpperCase()
  return FAHRENHEIT_REGIONS.has(region)
}
export const tempUnit = (p = prefs) => (p.temp === "F" || p.temp === "C" ? p.temp : localeUsesFahrenheit(localeOf(p)) ? "F" : "C")
