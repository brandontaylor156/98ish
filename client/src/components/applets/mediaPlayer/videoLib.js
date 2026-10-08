// Media Player's library rules, pure (videoLib.test.js): continue-where-you-left-off for
// videos, search across songs and videos, durations, playlists in order.

export const RESUME_MIN = 10 // seconds: a video stopped before this starts over next time
export const RESUME_END = 15 // seconds from the end (or 95%): counts as watched
export const MAX_RESUME = 200 // videos remembered (the oldest are forgotten)

// Where to start a video again -> seconds (0 = from the start)
export const resumePoint = (entry, duration = 0) => {
  const t = Number(entry?.t)
  if (!(t >= RESUME_MIN)) return 0
  const d = Number(duration) || Number(entry?.d) || 0
  if (d && (t >= d - RESUME_END || t >= d * 0.95)) return 0
  return t
}

// The resume list after watching to t of d seconds (a new object; finished or barely started
// videos are dropped, the list is kept to MAX_RESUME by most recent)
export const withResume = (resume, key, t, d, now = Date.now()) => {
  const next = { ...(resume || {}) }
  const entry = { t: Math.round(Number(t) * 10) / 10, d: Math.round(Number(d) || 0), at: now }
  if (!key) return next
  if (!resumePoint(entry, d)) delete next[key]
  else next[key] = entry
  const keys = Object.keys(next)
  if (keys.length > MAX_RESUME) {
    keys.sort((a, b) => (next[b].at || 0) - (next[a].at || 0))
    for (const k of keys.slice(MAX_RESUME)) delete next[k]
  }
  return next
}

// 0..1 of the way through (for the bar under a video), 0 when it would start over
export const progressOf = (entry, duration = 0) => {
  const t = resumePoint(entry, duration)
  const d = Number(duration) || Number(entry?.d) || 0
  return t && d ? Math.min(1, t / d) : 0
}

// 75 -> "1:15", 3725 -> "1:02:05"
export const formatDuration = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

const fold = (text) =>
  String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()

// Songs and videos whose title, artist, album or file name has every word typed
export const searchMedia = (items, query) => {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return items
  return items.filter((item) => {
    const hay = fold([item.title, item.artist, item.album, item.name].filter(Boolean).join(" "))
    return words.every((w) => hay.includes(w))
  })
}

// A playlist's keys -> its items in order, leaving out what isn't in the library (any more)
export const playlistItems = (keys, items, keyOf = (item) => item.key) => {
  const byKey = new Map(items.map((item) => [keyOf(item), item]))
  return (keys || []).map((k) => byKey.get(k)).filter(Boolean)
}

// Videos: newest first, then by title
export const sortVideos = (list) => [...list].sort((a, b) => (b.added || 0) - (a.added || 0) || String(a.title).localeCompare(String(b.title)))

// a poster's size: at most `side` px on the long edge, keeping the shape
export const posterSize = (w, h, side = 320) => {
  if (!(w > 0 && h > 0)) return { w: side, h: Math.round((side * 9) / 16) }
  const scale = Math.min(1, side / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

// where to grab a poster frame: a second in, or a tenth of a short clip
export const posterTime = (duration) => (duration > 0 ? Math.min(1, duration / 10) : 0)
