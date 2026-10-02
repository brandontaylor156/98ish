// http://www.98ish.com/...: pages that live right here instead of the Wayback Machine.
// They make up the 98ish Web Ring.

export const LOCAL_HOME = "http://www.98ish.com/guestbook"

export const RING = [
  { path: "/guestbook", title: "The 98ish Guestbook", counter: "guestbook", about: "Sign it! Everybody's doing it" },
  { path: "/shrine", title: "The Minesweeper Strategy Shrine", counter: "shrine", about: "Tips from a certified mine expert" },
  { path: "/links", title: "Cool Links of the Web", counter: "links", about: "The best sites on the Information Superhighway" },
  { path: "/rock", title: "Rocky's Home Page", counter: "rock", about: "A pet rock with a web page" },
]

const HOSTS = /^(www\.)?98ish\.com$/i

// "http://www.98ish.com/guestbook" -> "/guestbook"; null for any other site
export const localPath = (url) => {
  try {
    const parsed = new URL(url)
    if (!HOSTS.test(parsed.hostname)) return null
    const path = parsed.pathname.replace(/\/+$/, "").toLowerCase() || "/"
    return path === "/" || path === "/index.html" ? "/guestbook" : path
  } catch {
    return null
  }
}

export const isLocalUrl = (url) => localPath(url) !== null

export const localUrl = (path) => `http://www.98ish.com${path}`

// Pages that aren't in the ring
const OTHER_PAGES = [{ path: "/members", title: "98ish Members" }]

export const pageFor = (url) => [...RING, ...OTHER_PAGES].find((p) => p.path === localPath(url)) || null

// "/~cooldude98" -> "cooldude98": a member's homepage (screen names are case- and
// space-insensitive, like 98 Messenger)
export const memberKey = (path) => /^\/~([a-z][a-z0-9]{2,15})$/.exec(String(path || ""))?.[1] || null
export const memberUrl = (screenName) => localUrl(`/~${String(screenName || "").replace(/\s+/g, "").toLowerCase()}`)

// The ring is the built-in pages plus every published member homepage (`ring`)
export const ringNeighbor = (path, step, ring = RING) => {
  const i = Math.max(0, ring.findIndex((p) => p.path === path))
  return ring[(i + step + ring.length) % ring.length]
}

export const ringRandom = (path, ring = RING) => {
  const others = ring.filter((p) => p.path !== path)
  return others[Math.floor(Math.random() * others.length)]
}

// The chat server (Render) also serves the guestbook and the hit counters
export const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"
