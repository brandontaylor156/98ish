// Compass's address rules (pure, tested in compass.test.js): what the omnibox does with what
// you type, search engines, relay addresses, and the sites that only work in a real browser.

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

// Sites that break when relayed (sign-in systems, banks, video, heavy apps): Compass offers
// the real browser for these instead of trying. Matches the host and its subdomains.
export const REAL_BROWSER_SITES = [
  ["accounts.google.com", "Google sign-in only works in your real browser."],
  ["youtube.com", "YouTube videos play in your real browser."],
  ["youtu.be", "YouTube videos play in your real browser."],
  ["netflix.com", "Video sites play in your real browser."],
  ["twitch.tv", "Video sites play in your real browser."],
  ["vimeo.com", "Video sites play in your real browser."],
  ["tiktok.com", "Video sites play in your real browser."],
  ["paypal.com", "For your money and accounts, use your real browser."],
  ["chase.com", "For your money and accounts, use your real browser."],
  ["bankofamerica.com", "For your money and accounts, use your real browser."],
  ["wellsfargo.com", "For your money and accounts, use your real browser."],
  ["capitalone.com", "For your money and accounts, use your real browser."],
  ["citi.com", "For your money and accounts, use your real browser."],
  ["venmo.com", "For your money and accounts, use your real browser."],
  ["appleid.apple.com", "Apple Account sign-in only works in your real browser."],
  ["icloud.com", "iCloud only works in your real browser."],
  ["login.microsoftonline.com", "Microsoft sign-in only works in your real browser."],
  ["login.live.com", "Microsoft sign-in only works in your real browser."],
  ["facebook.com", "Facebook needs your real browser."],
  ["instagram.com", "Instagram needs your real browser."],
  ["x.com", "X needs your real browser."],
  ["twitter.com", "X needs your real browser."],
  ["docs.google.com", "Google Docs needs your real browser."],
  ["mail.google.com", "Gmail needs your real browser."],
  ["drive.google.com", "Google Drive needs your real browser."],
  ["maps.google.com", "Google Maps needs your real browser."],
  ["spotify.com", "Spotify needs your real browser."],
]

const matchesHost = (host, site) => host === site || host.endsWith("." + site)

// -> the reason a URL should open in the real browser, or null
export const realBrowserReason = (url, alwaysReal = []) => {
  const host = hostOf(url)
  if (!host) return null
  if (alwaysReal.some((site) => matchesHost(host, site))) return "You chose to always open this site in your real browser."
  // google.com/maps
  if (matchesHost(host, "google.com") && /^\/maps\b/.test(safePath(url))) return "Google Maps needs your real browser."
  const hit = REAL_BROWSER_SITES.find(([site]) => matchesHost(host, site))
  return hit ? hit[1] : null
}
const safePath = (url) => {
  try {
    return new URL(url).pathname
  } catch {
    return ""
  }
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
