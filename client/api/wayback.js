// Vercel serverless function for Internet Explorer's time machine. Proxies the two fast
// endpoints behind the Wayback Machine's own calendar page (neither sends CORS headers),
// trims the answers and caches them. Also mounted by vite.config.js during `npm run dev`.
//
//   ?action=sparkline&url=...           captures per month for every year, plus the first
//                                        and last month with any (did the site exist yet?)
//   ?action=captures&url=...&year=YYYY  every good capture that year, as 14-digit timestamps
//
// (The CDX index API can answer the same questions but takes 7-25s for big sites.)

const BASE = "https://web.archive.org/__wb"
const TIMEOUT_MS = 8000
const memory = new Map()
const MEMORY_TTL_MS = 60 * 60_000
const CDN_SECONDS = { sparkline: 12 * 3600, captures: 6 * 3600 }

const fetchJson = async (path, params) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${BASE}/${path}?${new URLSearchParams(params)}`, {
      signal: controller.signal,
      headers: { "User-Agent": "98ish-internet-explorer (+https://98ish.vercel.app)" },
    })
    if (!response.ok) throw Object.assign(new Error(`The Wayback Machine answered ${response.status}`), { status: 502 })
    return await response.json()
  } catch (error) {
    if (error.name === "AbortError") throw Object.assign(new Error("The Wayback Machine took too long to answer."), { status: 504 })
    throw Object.assign(error, { status: error.status || 502 })
  } finally {
    clearTimeout(timer)
  }
}

const cleanUrl = (url) => {
  const value = String(url || "").trim().slice(0, 500)
  if (!value || /\s/.test(value)) return null
  return value.replace(/^https?:\/\//i, "")
}

const actions = {
  async sparkline({ url }) {
    const data = await fetchJson("sparkline", { output: "json", url, collection: "web" })
    const years = {}
    let first = null
    let last = null
    for (const [year, months] of Object.entries(data.years || {}).sort()) {
      if (!Array.isArray(months)) continue
      years[year] = months.map((n) => Number(n) || 0)
      months.forEach((n, i) => {
        if (!n) return
        const ym = `${year}${String(i + 1).padStart(2, "0")}`
        if (!first) first = ym
        last = ym
      })
    }
    // the newest capture (14 digits) and each month's HTTP status class ("2" good, "3"
    // redirect, "4" error...), which Compass uses to open the newest good copy
    const lastTs = /^\d{14}$/.test(String(data.last_ts || "")) ? String(data.last_ts) : null
    const status = {}
    for (const [year, text] of Object.entries(data.status || {})) if (/^\d{4}$/.test(year) && typeof text === "string") status[year] = text.slice(0, 12)
    return { years, first, last, lastTs, status } // first/last: "YYYYMM" or null if never archived
  },

  async captures({ url, year }) {
    const y = Number(year)
    if (!(y >= 1996 && y <= new Date().getFullYear())) throw Object.assign(new Error("Invalid year"), { status: 400 })
    const data = await fetchJson("calendarcaptures/2", { url, date: String(y) })
    // items: [MMDDhhmmss as a number (leading zero dropped), HTTP status, collection index].
    // Only real pages: a redirect capture (yahoo.com -> www9.yahoo.com) just bounces to
    // another capture, so stepping onto one would look like nothing happened. (No status
    // means a duplicate of a good capture.)
    const timestamps = (data.items || [])
      .filter(([, status]) => !status || status === 200)
      .map(([stamp]) => `${y}${String(stamp).padStart(10, "0")}`)
      .filter((ts) => /^\d{14}$/.test(ts))
      .sort()
    return { year: y, timestamps }
  },
}

export default async function handler(req, res) {
  const params = Object.fromEntries(new URL(req.url, "http://localhost").searchParams)
  res.setHeader("Content-Type", "application/json")
  const send = (status, body, seconds = 0) => {
    res.statusCode = status
    res.setHeader("Cache-Control", status === 200 && seconds ? `public, s-maxage=${seconds}, stale-while-revalidate=86400` : "no-store")
    res.end(JSON.stringify(body))
  }

  const action = actions[params.action]
  const url = cleanUrl(params.url)
  if (!action) return send(400, { error: "Unknown action" })
  if (!url) return send(400, { error: "Missing or invalid url" })

  const key = `${params.action}|${url}|${params.year || ""}`
  const hit = memory.get(key)
  if (hit && Date.now() - hit.at < MEMORY_TTL_MS) return send(200, hit.body, CDN_SECONDS[params.action])

  try {
    const body = await action({ ...params, url })
    memory.set(key, { at: Date.now(), body })
    if (memory.size > 1000) memory.delete(memory.keys().next().value)
    send(200, body, CDN_SECONDS[params.action])
  } catch (error) {
    send(error.status || 502, { error: error.message || "Wayback request failed" })
  }
}
