// Internet Explorer's time machine: pages come from the Internet Archive's Wayback Machine.
// We load https://web.archive.org/web/<timestamp>if_/<url> in a frame ("if_" = no Archive
// toolbar, links stay inside the archive). The Archive redirects to the capture nearest the
// timestamp and posts {event, pageUrl, pageTitle} messages to us as pages load.

export const ARCHIVE_ORIGIN = "https://web.archive.org"
export const MIN_DATE = "1996-01-01"
export const todayIso = () => new Date().toISOString().slice(0, 10)

// "2001-09-11" -> "20010911"
export const dateToStamp = (iso) => iso.replace(/-/g, "")

// "19981212034441" -> Date (UTC)
export const stampToDate = (ts) => {
  const s = String(ts).padEnd(14, "0")
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) || 1, +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)))
}

export const formatStamp = (ts, withTime = false) =>
  stampToDate(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
    ...(withTime && { hour: "numeric", minute: "2-digit" }),
  })

export const formatIso = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })

export const formatYearMonth = (ym) =>
  new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(4, 6) - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })

// How far a capture is from the date you asked for: "13 days before", "2 years after"
export const describeGap = (captureTs, iso) => {
  const days = Math.round((stampToDate(captureTs) - new Date(`${iso}T12:00:00Z`)) / 86400000)
  const abs = Math.abs(days)
  if (abs <= 1) return { days, text: "from your date" }
  const unit = abs >= 730 ? `${Math.round(abs / 365)} years` : abs >= 60 ? `${Math.round(abs / 30)} months` : `${abs} days`
  return { days, text: `${unit} ${days < 0 ? "before" : "after"} your date` }
}

// What someone typed in the address bar -> a URL to look up, or null (then it's a search)
export const normalizeInput = (text) => {
  let value = String(text || "").trim()
  if (!value) return null
  // an archive link pasted in: keep just the original URL
  const archived = value.match(/web\.archive\.org\/web\/\d{1,14}[a-z_]*\/(.+)$/i)
  if (archived) value = archived[1]
  if (/\s/.test(value)) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    if (!/^[^/]+\.[a-z]{2,}(?:[:/?#]|$)/i.test(value) && !/^localhost/i.test(value)) return null
    value = `http://${value}`
  }
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.href
  } catch {
    return null
  }
}

export const archiveUrl = (url, ts) => `${ARCHIVE_ORIGIN}/web/${ts}if_/${url}`
export const archivePageUrl = (url, ts) => `${ARCHIVE_ORIGIN}/web/${ts}/${url}` // with the Archive's toolbar, for a new tab

// A pageUrl from the Archive's messages -> { ts, original }
export const parseArchiveUrl = (pageUrl) => {
  const match = String(pageUrl || "").match(/^https?:\/\/web\.archive\.org\/web\/(\d{1,14})[a-z_]*\/(.+)$/i)
  if (!match) return null
  let original = match[2]
  if (!/^[a-z]+:\/\//i.test(original)) original = `http://${original}`
  original = original.replace(/^(http:\/\/[^/:]+):80(?=\/|$)/i, "$1") // the Archive keeps the default port
  return { ts: match[1].padEnd(14, "0"), original }
}

// "http://www9.yahoo.com:80/" -> "yahoo.com" (what the Archive's calendar is keyed on)
export const siteKey = (url) => {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\d*\./, "")
    return host
  } catch {
    return null
  }
}

// Same page? (ignores http/https, www, port 80 and a trailing slash)
export const samePage = (a, b) => {
  const norm = (u) => {
    try {
      const x = new URL(u)
      return `${x.hostname.replace(/^www\d*\./, "")}${x.port && x.port !== "80" ? ":" + x.port : ""}${x.pathname.replace(/\/$/, "")}${x.search}`
    } catch {
      return u
    }
  }
  return norm(a) === norm(b)
}

// ---- the /api/wayback proxy (cached in memory for this visit) ----

const cache = new Map()
const getJson = async (params) => {
  const key = new URLSearchParams(params).toString()
  if (cache.has(key)) return cache.get(key)
  const promise = fetch(`/api/wayback?${key}`)
    .then(async (response) => {
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "The Wayback Machine didn't answer.")
      return data
    })
    .catch((error) => {
      cache.delete(key) // don't remember failures
      throw error
    })
  cache.set(key, promise)
  return promise
}

export const getSparkline = (site) => getJson({ action: "sparkline", url: site })
export const getCaptures = (site, year) => getJson({ action: "captures", url: site, year: String(year) })
