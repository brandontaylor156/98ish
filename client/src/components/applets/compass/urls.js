// Compass's address rules (pure, tested in compass.test.js): what the omnibox does with what
// you type, search engines, relay addresses, saved copies and the starting bookmarks.

export const SEARCH_ENGINES = {
  // DuckDuckGo's no-JavaScript pages are made for simple browsers and relay well
  duckduckgo: { name: "DuckDuckGo", url: "https://html.duckduckgo.com/html/?q=%s", home: "https://html.duckduckgo.com/html/" },
  ddglite: { name: "DuckDuckGo Lite", url: "https://lite.duckduckgo.com/lite/?q=%s", home: "https://lite.duckduckgo.com/lite/" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q=%s", home: "https://www.bing.com/" },
  mojeek: { name: "Mojeek", url: "https://www.mojeek.com/search?q=%s", home: "https://www.mojeek.com/" },
  wikipedia: { name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search=%s", home: "https://en.wikipedia.org/" },
}
export const DEFAULT_ENGINE = "duckduckgo"

export const NEW_TAB = "compass://newtab"
export const INTERNAL = /^compass:\/\/(newtab|history|bookmarks|downloads|about)\/?$/i

export const searchUrl = (query, engine = DEFAULT_ENGINE) => (SEARCH_ENGINES[engine] || SEARCH_ENGINES[DEFAULT_ENGINE]).url.replace("%s", encodeURIComponent(query.trim()))

// A host name worth trying as an address: "example.com", "localhost:8080", "192.168.1.1"
const looksLikeHost = (text) => /^([a-z0-9-]+\.)+[a-z][a-z0-9-]{1,62}(:\d{1,5})?([/?#].*)?$/i.test(text) || /^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?([/?#].*)?$/.test(text)

// What the omnibox opens for some typed text -> { url, search: bool } | null
export const parseInput = (input, engine = DEFAULT_ENGINE) => {
  const text = String(input ?? "").trim()
  if (!text) return null
  if (INTERNAL.test(text)) return { url: text.toLowerCase().replace(/\/$/, ""), search: false }
  if (/^about:(blank|newtab|home)$/i.test(text)) return { url: NEW_TAB, search: false }
  if (/^https?:\/\//i.test(text)) {
    try {
      return { url: new URL(text).href, search: false }
    } catch {
      return { url: searchUrl(text, engine), search: true }
    }
  }
  // "?words" forces a search, as in other browsers
  if (text.startsWith("?")) return { url: searchUrl(text.slice(1), engine), search: true }
  if (!/\s/.test(text) && looksLikeHost(text)) {
    try {
      return { url: new URL(`https://${text}`).href, search: false }
    } catch {
      // fall through to a search
    }
  }
  return { url: searchUrl(text, engine), search: true }
}

export const isInternal = (url) => INTERNAL.test(String(url || ""))
export const isWeb = (url) => /^https?:\/\//i.test(String(url || ""))

export const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return ""
  }
}

// What the omnibox shows when it isn't being typed in: no "https://", no trailing slash
export const displayUrl = (url) => {
  if (!url) return ""
  if (url === NEW_TAB) return ""
  try {
    const u = new URL(url)
    if (u.protocol !== "https:" && u.protocol !== "http:") return url
    const path = u.pathname === "/" && !u.search && !u.hash ? "" : decodeURI(u.pathname) + u.search + u.hash
    return (u.protocol === "http:" ? "http://" : "") + u.host.replace(/^www\./, "") + path
  } catch {
    return url
  }
}

// The relay address of a page: <server>/api/web/r/<sid>/_/<mode>/https/host/path?query#hash
// ("_" lets the server pick the page's site token)
export const relayUrl = (server, sid, url, mode = "d") => {
  const u = new URL(url)
  return `${server}/api/web/r/${sid}/_/${mode}/${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}${u.hash}`
}
// A script-style (as-is) request, used to save files: tok is the page's site token, if known
export const rawUrl = (server, sid, url, tok = "_") => {
  const u = new URL(url)
  return `${server}/api/web/x/${sid}/${tok}/${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}`
}

// Sites that break when relayed (sign-in systems, banks, video, heavy apps): Compass never
// sends these through the relay; like any site it doesn't relay, they show straight from the
// site when they allow frames, else as the Internet Archive's saved copy. Host + subdomains.
export const NO_RELAY_SITES = [
  "accounts.google.com",
  "youtube.com",
  "youtu.be",
  "netflix.com",
  "twitch.tv",
  "vimeo.com",
  "tiktok.com",
  "paypal.com",
  "chase.com",
  "bankofamerica.com",
  "wellsfargo.com",
  "capitalone.com",
  "citi.com",
  "venmo.com",
  "appleid.apple.com",
  "icloud.com",
  "login.microsoftonline.com",
  "login.live.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "docs.google.com",
  "mail.google.com",
  "drive.google.com",
  "maps.google.com",
  "spotify.com",
]

const matchesHost = (host, site) => host === site || host.endsWith("." + site)

// Should Compass keep this site off the relay?
export const skipRelay = (url) => {
  const host = hostOf(url)
  if (!host) return false
  // google.com/maps
  if (matchesHost(host, "google.com") && /^\/maps\b/.test(safePath(url))) return true
  return NO_RELAY_SITES.some((site) => matchesHost(host, site))
}
const safePath = (url) => {
  try {
    return new URL(url).pathname
  } catch {
    return ""
  }
}

// The browser 98ish itself runs in, for "Open in Safari" (a small, secondary way out)
export const browserName = (ua = typeof navigator === "undefined" ? "" : navigator.userAgent) => {
  const s = String(ua || "")
  if (/CriOS\//.test(s)) return "Chrome"
  if (/FxiOS\//.test(s)) return "Firefox"
  if (/EdgiOS\/|Edg\//.test(s)) return "Edge"
  if (/SamsungBrowser\//.test(s)) return "Samsung Internet"
  if (/Firefox\//.test(s)) return "Firefox"
  if (/Chrome\/|Chromium\//.test(s)) return "Chrome"
  if (/(iPhone|iPad|iPod|Macintosh)/.test(s) && /Safari\//.test(s)) return "Safari"
  return "Your Browser"
}
export const openInLabel = (ua) => {
  const name = browserName(ua)
  return name === "Your Browser" ? "Open in Your Browser" : `Open in ${name}`
}

// ---- the Internet Archive's saved copies (for sites that can't be relayed or framed) ----

// The newest good capture from the Wayback Machine's sparkline (/api/wayback?action=sparkline):
// { years: { "2026": [count per month] }, status: { "2026": "2224..." (a status class per
// month: "2" good, "3" redirect, "4"/"5" error) }, lastTs, last } -> a 14-digit timestamp to ask
// the Archive for (it redirects to the nearest capture), or null if the page was never saved.
export const newestCapture = (spark) => {
  if (!spark || !spark.years) return null
  const years = Object.keys(spark.years).filter((y) => /^\d{4}$/.test(y)).sort().reverse()
  const lastTs = /^\d{14}$/.test(String(spark.lastTs || "")) ? String(spark.lastTs) : null
  let newest = null
  for (const y of years) {
    const counts = spark.years[y] || []
    const status = String(spark.status?.[y] || "")
    for (let m = Math.min(11, counts.length - 1); m >= 0; m--) {
      if (!(counts[m] > 0)) continue
      const ym = `${y}${String(m + 1).padStart(2, "0")}`
      newest = newest || ym
      if (status && status[m] && status[m] !== "2") continue
      // the newest month with good captures: its newest capture, or the end of that month
      if (lastTs && lastTs.startsWith(ym)) return lastTs
      const lastDay = new Date(Date.UTC(+y, m + 1, 0)).getUTCDate()
      return `${ym}${String(lastDay).padStart(2, "0")}235959`
    }
  }
  if (lastTs) return lastTs
  return newest ? `${newest}28000000` : null
}

// "20261003175615" now, for asking the Archive for its newest copy without a sparkline
export const nowStamp = (date = new Date()) => date.toISOString().replace(/\D/g, "").slice(0, 14)

// What to search Wikipedia for when a site can't be shown at all: "www.spacejam.com" -> "spacejam"
export const searchTermFor = (url) => {
  const host = hostOf(url)
  if (!host) return ""
  const labels = host.split(".")
  if (labels.length === 1) return labels[0]
  const two = labels.length > 2 && labels.at(-1).length === 2 && /^(co|com|org|net|ac|gov|edu)$/.test(labels.at(-2))
  return labels.at(two ? -3 : -2) || host
}

// ---- bookmarks every new Compass starts with ----
// Ones that work well with no sign-on: the relayed reference sites, a site that allows frames
// (shown straight from the site) and a classic that looks great as the Internet Archive's copy.
export const DEFAULT_BOOKMARKS = [
  { title: "Wikipedia", url: "https://en.wikipedia.org/", bar: true },
  { title: "Featured Article", url: "https://en.wikipedia.org/wiki/Wikipedia:Today%27s_featured_article", bar: true },
  { title: "Wiktionary", url: "https://en.wiktionary.org/", bar: true },
  { title: "Wikivoyage", url: "https://en.wikivoyage.org/", bar: true },
  { title: "OpenStreetMap", url: "https://www.openstreetmap.org/", bar: true },
  { title: "Space Jam (1996)", url: "https://www.spacejam.com/1996/", bar: true },
  { title: "Cameron's World", url: "https://www.cameronsworld.net/", bar: true },
  { title: "The First Website", url: "https://info.cern.ch/hypertext/WWW/TheProject.html", bar: false },
  { title: "Zombo.com", url: "https://zombo.com/", bar: false },
]
// Compass's first bookmarks, which can't load without the relay: dropped from saved bookmarks
// (only while unchanged), and the new ones added, once (prefs.bookmarksVersion)
export const OLD_DEFAULT_BOOKMARKS = [
  { title: "DuckDuckGo", url: "https://html.duckduckgo.com/html/" },
  { title: "Hacker News", url: "https://news.ycombinator.com/" },
  { title: "BBC News", url: "https://www.bbc.com/news" },
  { title: "Weather", url: "https://wttr.in/?format=v2" },
  { title: "Old Reddit", url: "https://old.reddit.com/" },
  { title: "Craigslist", url: "https://www.craigslist.org/" },
]
export const BOOKMARKS_VERSION = 2
export const migrateBookmarks = (list, makeId = () => Math.random().toString(36).slice(2, 10)) => {
  const kept = (Array.isArray(list) ? list : []).filter((b) => !OLD_DEFAULT_BOOKMARKS.some((o) => o.url === b.url && o.title === b.title))
  const added = DEFAULT_BOOKMARKS.filter((d) => !kept.some((b) => b.url === d.url)).map((b, i) => ({ ...b, id: makeId(), at: i }))
  // the new defaults go first (where the old ones were), the person's own after them
  return [...added, ...kept]
}

// 98ish's own pages (the web ring, the guestbook) belong to Internet Explorer
export const isNinetyEightIsh = (url) => /^https?:\/\/(www\.)?98ish\.com(\/|$)/i.test(String(url || ""))

// Sorting omnibox suggestions: history and bookmarks that match what's typed
export const suggest = (text, { history = [], bookmarks = [] } = {}, limit = 6) => {
  const q = String(text || "").trim().toLowerCase()
  if (!q) return []
  const seen = new Set()
  const score = (item) => {
    const url = item.url.toLowerCase()
    const shown = displayUrl(item.url).toLowerCase()
    const title = (item.title || "").toLowerCase()
    if (shown.startsWith(q)) return 3
    if (title.startsWith(q)) return 2
    if (url.includes(q) || title.includes(q)) return 1
    return 0
  }
  const pool = [...bookmarks.map((b) => ({ ...b, kind: "bookmark", boost: 0.5 })), ...history.map((h) => ({ ...h, kind: "history", boost: 0 }))]
  return pool
    .map((item) => ({ item, s: score(item) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s + b.item.boost - (a.s + a.item.boost) || (b.item.at || 0) - (a.item.at || 0))
    .map((x) => x.item)
    .filter((item) => (seen.has(item.url) ? false : seen.add(item.url)))
    .slice(0, limit)
}

// Searching the history page: every word must appear in the title or address
export const searchHistory = (history, query) => {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return history
  return history.filter((h) => {
    const hay = `${h.title || ""} ${h.url}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

// A file name from a download's address
export const fileNameOf = (url, fallback = "download") => {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop()
    return last ? decodeURIComponent(last).slice(0, 80) : fallback
  } catch {
    return fallback
  }
}

export const formatBytes = (n) => {
  if (!Number.isFinite(n) || n <= 0) return ""
  if (n < 1024) return `${n} bytes`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}
