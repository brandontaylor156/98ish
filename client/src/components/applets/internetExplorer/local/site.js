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

export const pageFor = (url) => RING.find((p) => p.path === localPath(url)) || null

export const ringNeighbor = (path, step) => {
  const i = Math.max(0, RING.findIndex((p) => p.path === path))
  return RING[(i + step + RING.length) % RING.length]
}

export const ringRandom = (path) => {
  const others = RING.filter((p) => p.path !== path)
  return others[Math.floor(Math.random() * others.length)]
}

// The chat server (Render) also serves the guestbook and the hit counters
export const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"
