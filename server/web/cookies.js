// A small cookie jar for one Compass browsing session, kept on the server (relayed pages
// never see the sites' cookies, and the user's own 98ish cookies are never sent to sites).
// Follows the parts of RFC 6265 a browser needs: Domain / host-only, Path, Expires and
// Max-Age, Secure, HttpOnly (scripts in the page can't read or set those). Bounded: at
// most `max` cookies (the least recently used go first) and 4 KB per cookie.

const MAX_COOKIE_BYTES = 4096

const defaultPath = (pathname) => {
  if (!pathname || !pathname.startsWith("/")) return "/"
  const cut = pathname.lastIndexOf("/")
  return cut <= 0 ? "/" : pathname.slice(0, cut)
}

const domainMatch = (host, domain) => host === domain || (host.endsWith("." + domain) && !/^\d+\.\d+\.\d+\.\d+$/.test(host))

const pathMatch = (path, cookiePath) =>
  path === cookiePath || (path.startsWith(cookiePath) && (cookiePath.endsWith("/") || path[cookiePath.length] === "/"))

// "a=b; Path=/; HttpOnly" -> { name, value, attrs } | null
const parseSetCookie = (text) => {
  const parts = String(text || "").split(";")
  const first = parts.shift()
  const eq = first.indexOf("=")
  const name = (eq < 0 ? "" : first.slice(0, eq)).trim()
  const value = (eq < 0 ? first : first.slice(eq + 1)).trim()
  if (!name && !value) return null
  const attrs = {}
  for (const part of parts) {
    const i = part.indexOf("=")
    const key = (i < 0 ? part : part.slice(0, i)).trim().toLowerCase()
    const val = i < 0 ? "" : part.slice(i + 1).trim()
    if (key) attrs[key] = val
  }
  return { name, value, attrs }
}

class CookieJar {
  constructor({ max = 300, now = () => Date.now() } = {}) {
    this.max = max
    this.now = now
    this.cookies = new Map() // "domain|path|name" -> cookie
  }

  get size() {
    return this.cookies.size
  }

  // A Set-Cookie header (or document.cookie = text when fromScript) for a response from url
  set(text, url, { fromScript = false } = {}) {
    if (String(text || "").length > MAX_COOKIE_BYTES) return false
    let u
    try {
      u = new URL(url)
    } catch {
      return false
    }
    const parsed = parseSetCookie(text)
    if (!parsed) return false
    const host = u.hostname.toLowerCase()
    const { attrs } = parsed
    let domain = host
    let hostOnly = true
    if (attrs.domain) {
      const d = attrs.domain.toLowerCase().replace(/^\./, "").replace(/\.$/, "")
      // must cover this host, and be more than a bare top-level domain
      if (!d.includes(".") || !domainMatch(host, d)) return false
      domain = d
      hostOnly = false
    }
    const path = attrs.path && attrs.path.startsWith("/") ? attrs.path : defaultPath(u.pathname)
    const secure = "secure" in attrs
    if (secure && u.protocol !== "https:") return false
    // __Secure- and __Host- prefixes (as browsers enforce them)
    if (parsed.name.startsWith("__Secure-") && !secure) return false
    if (parsed.name.startsWith("__Host-") && (!secure || !hostOnly || path !== "/")) return false
    let expires = null
    if (attrs["max-age"] !== undefined && /^-?\d+$/.test(attrs["max-age"])) expires = this.now() + Number(attrs["max-age"]) * 1000
    else if (attrs.expires) {
      const t = Date.parse(attrs.expires)
      if (!Number.isNaN(t)) expires = t
    }
    const key = `${domain}|${path}|${parsed.name}`
    const existing = this.cookies.get(key)
    const httpOnly = "httponly" in attrs
    if (fromScript && (httpOnly || existing?.httpOnly)) return false
    if (expires !== null && expires <= this.now()) {
      this.cookies.delete(key)
      return true
    }
    this.cookies.delete(key) // re-insert: most recently used last
    this.cookies.set(key, { name: parsed.name, value: parsed.value, domain, hostOnly, path, secure, httpOnly, expires, created: existing?.created || this.now() })
    while (this.cookies.size > this.max) this.cookies.delete(this.cookies.keys().next().value)
    return true
  }

  // Every Set-Cookie header of a response
  setAll(headers, url) {
    for (const text of [].concat(headers || [])) this.set(text, url)
  }

  // The cookies for a request to url (forScript: what document.cookie shows)
  list(url, { forScript = false } = {}) {
    let u
    try {
      u = new URL(url)
    } catch {
      return []
    }
    const host = u.hostname.toLowerCase()
    const now = this.now()
    const found = []
    for (const [key, c] of this.cookies) {
      if (c.expires !== null && c.expires <= now) {
        this.cookies.delete(key)
        continue
      }
      if (c.hostOnly ? host !== c.domain : !domainMatch(host, c.domain)) continue
      if (!pathMatch(u.pathname || "/", c.path)) continue
      if (c.secure && u.protocol !== "https:") continue
      if (forScript && c.httpOnly) continue
      found.push(c)
    }
    // longer paths first, then older first (RFC 6265 5.4)
    found.sort((a, b) => b.path.length - a.path.length || a.created - b.created)
    return found
  }

  header(url, options) {
    return this.list(url, options)
      .map((c) => (c.name ? `${c.name}=${c.value}` : c.value))
      .join("; ")
  }

  clear() {
    this.cookies.clear()
  }
}

module.exports = { CookieJar, parseSetCookie, domainMatch, pathMatch }
