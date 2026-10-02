// Client for /api/youtube (client/api/youtube.js), which keeps the API key on the server

export class YouTubeError extends Error {
  constructor(message, reason) {
    super(message)
    this.reason = reason
  }
}

// Recent answers, so Back/Forward are instant and don't spend API quota (Refresh clears it)
const cache = new Map()
const CACHE_MS = 10 * 60_000
export const clearCache = () => cache.clear()

const request = async (params) => {
  const key = new URLSearchParams(params).toString()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data
  const data = await fetchJson(params)
  cache.set(key, { at: Date.now(), data })
  return data
}

const fetchJson = async (params) => {
  let response
  try {
    response = await fetch(`/api/youtube?${new URLSearchParams(params)}`)
  } catch {
    throw new YouTubeError("Couldn't reach YouTube '98. Check your connection.", "network")
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new YouTubeError(data.error || "YouTube request failed", data.reason)
  return data
}

const withPage = (params, pageToken) => (pageToken ? { ...params, pageToken } : params)

export const getPopular = (pageToken) => request(withPage({ action: "popular" }, pageToken))
export const searchVideos = (q, pageToken) => request(withPage({ action: "search", q }, pageToken))
export const getVideo = (id) => request({ action: "video", id })
export const getComments = (id, pageToken) => request(withPage({ action: "comments", id }, pageToken))

// "https://youtu.be/ID", "youtube.com/watch?v=ID", ".../embed/ID", ".../shorts/ID" -> ID
export const videoIdFrom = (text) => {
  const match = String(text).match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/)
  return match ? match[1] : null
}

export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`
export const embedUrl = (id) => `https://www.youtube.com/embed/${id}`

// ---- formatting ----

export const formatCount = (n) => (n == null ? "" : Number(n).toLocaleString("en-US"))

export const formatDuration = (seconds) => {
  if (!seconds) return ""
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`
}

const UNITS = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
]

export const timeAgo = (iso) => {
  const seconds = Math.max(0, (Date.now() - new Date(iso)) / 1000)
  for (const [unit, size] of UNITS) {
    const n = Math.floor(seconds / size)
    if (n >= 1) return `${n} ${unit}${n === 1 ? "" : "s"} ago`
  }
  return "just now"
}

export const formatDate = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
