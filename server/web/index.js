// Compass's page relay: lets the 98ish web browser show sites that refuse to be framed.
//
// The browser can't put most sites in an <iframe> (X-Frame-Options / CSP frame-ancestors)
// and can't read other origins, so Compass asks this server for the page. The relay fetches
// it, drops the headers that block framing, rewrites the page's addresses to come back through
// here (rewrite.js) and puts a small helper script first in it (inject.js).
//
// Routes (mounted at /api/web, before the global cors()):
//   POST /session                      { sid, guest, limits }   Bearer token of a signed-on 98
//                                       Messenger account, or (if guests are allowed) none
//   GET  /check?sid=&url=              { ok, url, status, frameable, https, type }   can it be framed?
//   GET  /frame?url=                   the same for ANY public site, no session: headers only,
//                                       nothing of the page is relayed (Compass's way to show
//                                       sites it doesn't relay: straight in its frame, or else
//                                       the Internet Archive's saved copy)
//   GET  /usage?sid=                   { used, limit }
//   ANY  /r/<sid>/<tok>/<d|f>/<scheme>/<host>/<path>   a page or anything it loads
//   ANY  /x/<sid>/<tok>/<scheme>/<host>/<path>         a script's own request (fetch, XHR): as-is
//   POST /c/<sid>/<tok>                { url, cookie }          document.cookie = ... from a page
//   POST /clear?sid=                   forget the account's cookies
//
// Env (all optional): WEB_RELAY = allowlist (default: everyone, signed on or not, only the
// allowlist) | on (signed-on accounts browse anywhere, guests the allowlist) | 0/off (no relay:
// Compass shows sites straight in a frame when they allow it, else the Internet Archive's copy).
// WEB_FRAME_CHECK=0 turns off GET /frame (Compass then shows saved copies of every site it
// doesn't relay).
// WEB_GUESTS=0 (people who aren't signed on can't use the relay at all; by default they may
// browse the guest allowlist, by address, with smaller limits). WEB_GUEST_ALLOW (comma list of
// domains replacing GUEST_ALLOW below; "none" for none). WEB_DAILY_MB (60 per account),
// WEB_GUEST_DAILY_MB (10 per guest address), WEB_GUESTS_TOTAL_DAILY_MB (40 for all guests),
// WEB_GLOBAL_DAILY_MB (100 for the whole server: Render's Hobby workspace includes only 5 GB of
// outbound bandwidth a month), WEB_MONTHLY_MB (1000: Compass's relay in a calendar month, UTC),
// WEB_MONTHLY_TOTAL_MB (3000: when the WHOLE server (Messenger, sync, APIs, the relay) has sent
// this much in a month, Compass closes until the 1st; see server/meter), WEB_RATE_PER_MIN (300),
// WEB_GUEST_RATE_PER_MIN (120), WEB_MAX_MB (12 per response), WEB_REWRITE_MB (4),
// WEB_TIMEOUT_MS (20000), WEB_CONCURRENCY (48), WEB_IDLE_MINUTES (240), WEB_BIND_IP=0 (don't
// bind sessions to addresses), WEB_BLOCK_HOSTS (more host names never to fetch),
// WEB_PUBLIC_URL (this server's public address, if the proxy headers are wrong), WEB_SECRET
// (site tokens; random per start otherwise). WEB_TEST_HOSTS ("name=127.0.0.1,...") lets local
// tests reach a test site; it is ignored on Render.
//
// SAFETY (it's a public server):
//  - Guests (no account) may only fetch hosts on the guest allowlist: checked for every relayed
//    request, every redirect and every frame check, on the server, whatever the page asks for.
//  - Only for a session made by a signed-on account (or a guest, see above). Sessions
//    live in memory, end after WEB_IDLE_MINUTES idle, and are bound to the address that made
//    them, so a session id read out of a page's address is no use from elsewhere.
//  - SSRF: guard.js refuses private, loopback, link-local, metadata and other special
//    addresses (IPv4 + IPv6), other schemes and ports, and our own host names; the socket
//    connects to the address that was checked; redirects come back through the relay, so
//    every hop is checked again.
//  - ISOLATION: every relayed page is served with "Content-Security-Policy: sandbox" (without
//    allow-same-origin, allow-top-navigation or allow-popups-to-escape-sandbox), and Compass's
//    <iframe sandbox> says the same: it runs in an opaque origin, never as this server's origin
//    (which is also the API's) nor 98ish's, even if opened directly in a tab, so it can't read
//    98ish's storage, cookies or tokens, can't register a service worker, can't navigate the
//    98ish window, and its popups stay sandboxed. Every other answer from /api/web (scripts,
//    pictures, errors, JSON) carries a script-less "sandbox" CSP and nosniff. CORS here never
//    allows credentials, service-worker script requests are refused, and a site's own
//    Set-Cookie, Clear-Site-Data, Service-Worker-Allowed, Link, Refresh and CORS headers never
//    reach the browser (only PASS_BACK headers do). The rest of the API refuses opaque origins
//    (origins.js, used in server.js), and the Compass window only listens to messages from its
//    own frames, from an opaque origin, and never sends a frame anything but find/zoom/stop.
//  - Cookies live in a server-side jar per account (per session for guests). They are sent
//    only first-party: <tok> is an HMAC of the session and the site (eTLD+1, approximated) a
//    page belongs to, and a request carries the jar's cookies only when its target is that
//    same site. So a page from one site can't make the relay send another site's cookies.
//  - The user's 98ish cookies and Authorization are never forwarded; nor are hop-by-hop,
//    forwarding or fetch-metadata headers.
//  - Limits: requests per minute, simultaneous requests, a daily byte budget per account and
//    for the whole relay, monthly caps (Compass's own and the whole server's traffic), a size
//    cap per response, timeouts. Byte budgets and monthly totals are kept in MongoDB
//    (server/meter/counters.js, collection "webusage"; guest addresses only as keyed hashes),
//    so a restart doesn't reset them; if they can't be read back the relay stays closed (fails
//    closed) while the rest of 98ish carries on. Per-minute rate limits and the new-session
//    limit stay in memory: a restart takes longer than their window, and every byte they let
//    through is still counted against the persisted budgets. Bodies stream; only pages and
//    stylesheets being rewritten are held in memory (capped, and only a few at once).
//  - Video and audio aren't relayed (Compass offers the real browser instead).
//  - GET /frame looks at ANY public site's response headers to say whether it may be framed.
//    It is not a relay: the body is never read (the socket is destroyed after the headers),
//    only { frameable, url, status, https, type } comes back, it goes through the same SSRF
//    guard (own hosts, private addresses, every redirect hop), is rate limited per address and
//    in all, cached for 10 minutes, and its few bytes are counted in the relay's totals.
// Sites see the 98ish server's address, and anything typed into a relayed page (passwords
// too) passes through this server: Compass says so and suggests the real browser for logins.

const crypto = require("crypto")
const zlib = require("zlib")
const net = require("net")
const { pipeline, Transform } = require("stream")
const express = require("express")
const { limiter } = require("../net/limiter")
const { sessionFrom } = require("../aim/auth")
const { CookieJar } = require("./cookies")
const { fetchChecked, Refused, REDIRECTS } = require("./fetcher")
const { checkUrlShape, parseTestHosts } = require("./guard")
const { encodeTarget, decodeTarget, rewriteHtml, rewriteCss } = require("./rewrite")
const { injectScript } = require("./inject")
const { createCounters, memoryUsageStore, dayOf, monthOf, nextMonthStart } = require("../meter/counters")

const MB = 1024 * 1024
const num = (name, fallback) => {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

// Sites guests may browse without signing on, with their subdomains (en.wikipedia.org,
// upload.wikimedia.org...). Small, well-behaved, non-profit or reference sites that don't
// relay other people's content: not archive.org (its Wayback Machine would be a way to any
// site, and its files are big). The 98ish servers themselves are never fetched (ownHosts).
const GUEST_ALLOW = ["wikipedia.org", "wikimedia.org", "wiktionary.org", "wikivoyage.org", "wikibooks.org", "wikiquote.org", "openstreetmap.org", "example.com"]
const OWN_SITES = ["98ish.vercel.app", "nine8ish.onrender.com"]

// WEB_GUEST_ALLOW="a.org,b.com" replaces the list; "none" empties it
const parseAllow = (text) => {
  const t = String(text ?? "").trim().toLowerCase()
  if (!t) return GUEST_ALLOW
  if (t === "none" || t === "0") return []
  return t
    .split(",")
    .map((s) => s.trim().replace(/^\*?\./, "").replace(/\.$/, ""))
    .filter(Boolean)
}
const onList = (host, list) => {
  const h = String(host || "").toLowerCase().replace(/\.$/, "")
  return list.some((d) => h === d || h.endsWith("." + d))
}
// WEB_RELAY: "allowlist" (default: anything unknown is the safe choice), "on", or "0"/"off"
const relayMode = (text) => {
  const t = String(text ?? "").trim().toLowerCase()
  if (["0", "off", "false", "no"].includes(t)) return "off"
  if (["on", "1", "all", "members", "open"].includes(t)) return "on"
  return "allowlist"
}

const defaultLimits = () => ({
  userDailyBytes: num("WEB_DAILY_MB", 60) * MB, // per signed-on account
  guestDailyBytes: num("WEB_GUEST_DAILY_MB", 10) * MB, // per guest address
  guestsDailyBytes: num("WEB_GUESTS_TOTAL_DAILY_MB", 40) * MB, // all guests together
  globalDailyBytes: num("WEB_GLOBAL_DAILY_MB", 100) * MB, // the whole relay in a day (Render Hobby: 5 GB/month out for everything)
  monthlyBytes: num("WEB_MONTHLY_MB", 1000) * MB, // Compass's relay in a calendar month (UTC)
  monthlyTotalBytes: num("WEB_MONTHLY_TOTAL_MB", 3000) * MB, // everything the server sent this month (server/meter)
  perMinute: num("WEB_RATE_PER_MIN", 300),
  guestPerMinute: num("WEB_GUEST_RATE_PER_MIN", 120),
  checksPerMinute: 60,
  frameChecksPerMinute: num("WEB_FRAME_CHECKS_PER_MIN", 1200), // GET /frame for everyone together
  maxBytes: num("WEB_MAX_MB", 12) * MB, // one response
  rewriteBytes: num("WEB_REWRITE_MB", 4) * MB, // a page or stylesheet being rewritten
  requestBytes: 5 * MB, // a form post
  timeoutMs: num("WEB_TIMEOUT_MS", 20000),
  perSession: 8, // at once
  global: num("WEB_CONCURRENCY", 48),
  rewrites: 4, // pages being rewritten at once
  waitMs: 20000,
  sessionsPerKey: 6,
  maxSessions: 3000,
  idleMs: num("WEB_IDLE_MINUTES", 240) * 60 * 1000,
  learnMs: 2 * 60 * 1000, // a session may learn its other address family (IPv4/IPv6) this long
})

// ---------- helpers ----------

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "proxy-authenticate", "proxy-authorization", "te", "trailer", "trailers", "transfer-encoding", "upgrade", "host"])
const NEVER_FORWARD = /^(cookie|origin|referer|forwarded|via|x-forwarded-.*|x-real-ip|true-client-ip|cf-.*|cdn-loop|x-request-start|x-request-id|rndr-.*|render-.*|sec-fetch-.*|sec-ch-.*|accept-encoding|content-length|x-web-.*|priority|upgrade-insecure-requests|purpose|sec-purpose|dnt|save-data)$/
const PASS_BACK = ["content-type", "content-language", "cache-control", "etag", "last-modified", "expires", "accept-ranges", "content-range", "retry-after", "age", "x-content-type-options"]
const HTML = /^(text\/html|application\/xhtml\+xml)$/
const MEDIA = /^(video\/|audio\/|application\/(x-mpegurl|vnd\.apple\.mpegurl|dash\+xml|vnd\.ms-sstr\+xml))/
const SHOWABLE = /^(text\/(plain|css|xml|csv|javascript|markdown)|image\/|application\/(json|xml|javascript|rss\+xml|atom\+xml|ld\+json))/
const STYLE_OR_FONT = /\.(css|woff2?|ttf|otf|eot)(?:[?#]|$)/i
const NAV_DESTS = new Set(["document", "iframe", "frame", "embed", "object"])
// Relayed pages: scripts and forms, in an opaque origin (no allow-same-origin), no top
// navigation, and popups that stay sandboxed (no allow-popups-to-escape-sandbox: an unsandboxed
// popup could navigate the 98ish window through window.opener.top)
const PAGE_SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock"
// Response headers a site may never hand to the browser through the relay (PASS_BACK is an
// allowlist anyway; this is what the tests check)
const NEVER_PASS = ["set-cookie", "clear-site-data", "service-worker-allowed", "link", "refresh", "access-control-allow-credentials", "access-control-allow-origin", "content-security-policy", "cross-origin-opener-policy", "permissions-policy", "origin-agent-cluster"]

// The client's address (Render sits behind a proxy that appends the real one)
const clientIp = (request) => {
  const cf = request.headers["cf-connecting-ip"]
  if (cf) return String(cf).trim()
  const fwd = String(request.headers["x-forwarded-for"] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  return (fwd.length ? fwd[fwd.length - 1] : request.socket.remoteAddress || "").replace(/^::ffff:/, "")
}
// IPv6 addresses change within a /64 (privacy addresses), so bind to that
const ipKey = (ip) => {
  if (net.isIPv6(ip)) {
    const parts = ip.split("::")[0].split(":")
    return { family: 6, key: parts.slice(0, 4).join(":") }
  }
  return { family: 4, key: ip }
}

// eTLD+1, approximated without the public suffix list: "a.b.example.co.uk" -> "example.co.uk"
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ne", "or", "go", "gob", "nic", "mil", "sch", "ltd", "plc", "nom", "gen", "lg", "ed", "gr"])
const siteOf = (host) => {
  const h = String(host || "").toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "")
  if (!h || net.isIP(h.replace(/^\[|\]$/g, ""))) return h
  const labels = h.split(".")
  if (labels.length <= 2) return h
  const take = labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2)) ? 3 : 2
  return labels.slice(-take).join(".")
}

const monthName = (date) => date.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })

// Promise-based gate: at most `max` at once, the rest wait (up to ms)
const makeGate = (max) => {
  let active = 0
  const waiting = []
  const release = () => {
    active--
    const next = waiting.shift()
    if (next) {
      clearTimeout(next.timer)
      active++
      next.resolve()
    }
  }
  const acquire = (ms) =>
    new Promise((resolve, reject) => {
      if (active < max) {
        active++
        return resolve()
      }
      const entry = { resolve }
      entry.timer = setTimeout(() => {
        const i = waiting.indexOf(entry)
        if (i >= 0) waiting.splice(i, 1)
        reject(new Refused(503, "The 98ish server is busy. Try again in a moment."))
      }, ms)
      waiting.push(entry)
    })
  return { acquire, release, get active() { return active }, get waiting() { return waiting.length } }
}

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

// May a page with these response headers be shown in a frame on `ancestorOrigin` (98ish)?
// Like browsers: a CSP frame-ancestors directive wins (X-Frame-Options is then ignored), and
// every policy must allow it; X-Frame-Options DENY/SAMEORIGIN refuse (98ish is never the site's
// own origin), ALLOW-FROM and unknown values are ignored. -> { frameable, by: "csp"|"xfo"|null }
const sourceMatches = (source, ancestor) => {
  const s = String(source || "").trim().toLowerCase()
  if (!s || !ancestor) return false
  if (s === "*") return true
  if (s === "https:") return ancestor.protocol === "https:"
  if (s === "http:") return ancestor.protocol === "https:" || ancestor.protocol === "http:"
  if (s.startsWith("'")) return false // 'none', 'self' (the site's own origin, never 98ish's)
  const m = /^(?:(https?):\/\/)?(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d+|\*))?(?:\/.*)?$/.exec(s)
  if (!m) return false
  const [, scheme, host, port] = m
  if (scheme && `${scheme}:` !== ancestor.protocol && !(scheme === "http" && ancestor.protocol === "https:")) return false
  const h = ancestor.hostname.toLowerCase()
  if (!(host === "*" || (host.startsWith("*.") ? h.endsWith(host.slice(1)) : h === host))) return false
  if (port === "*") return true
  if (port) return port === (ancestor.port || (ancestor.protocol === "https:" ? "443" : "80"))
  return !ancestor.port
}
const frameVerdict = (headers = {}, ancestorOrigin = "https://98ish.vercel.app") => {
  let ancestor = null
  try {
    ancestor = new URL(ancestorOrigin)
  } catch {
    ancestor = null
  }
  // several CSP headers (Node joins them with ", ") are several policies: each must allow it
  const policies = [].concat(headers["content-security-policy"] || []).join(",").split(",")
  const found = policies.map((p) => /(?:^|;)\s*frame-ancestors\b([^;]*)/i.exec(p)).filter(Boolean)
  if (found.length) return { frameable: found.every((m) => m[1].trim().split(/\s+/).some((src) => sourceMatches(src, ancestor))), by: "csp" }
  const xfo = [].concat(headers["x-frame-options"] || []).join(",").toLowerCase().split(",").map((v) => v.trim())
  if (xfo.some((v) => v === "deny" || v === "sameorigin")) return { frameable: false, by: "xfo" }
  return { frameable: true, by: null }
}

// A small page Compass replaces with its own (download, video, error...), readable on its own too
const stubHtml = (info) => {
  const msg = JSON.stringify({ __compass: 1, type: "stub", ...info }).replace(/</g, "\\u003c")
  const link = info.url && /^https?:/i.test(info.url) ? `<p><a href="${escapeHtml(info.url)}" target="_blank" rel="noopener noreferrer">Open ${escapeHtml(info.url)} in your real browser</a></p>` : ""
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(info.title || "Compass")}</title>
<style>body{font:14px Tahoma,Arial,sans-serif;background:#fff;color:#000;margin:24px}h1{font-size:18px}</style>
<script>try{if(window.parent!==window)window.parent.postMessage(${msg},"*")}catch(e){}</script></head>
<body><h1>${escapeHtml(info.title || "Compass")}</h1><p>${escapeHtml(info.text || "")}</p>${link}</body></html>`
}

// ---------- the service ----------

const createWeb = ({ aim = () => null, limits: overrides = {}, now = () => Date.now(), resolve, allowGuests = process.env.WEB_GUESTS !== "0", mode: relayModeOption = relayMode(process.env.WEB_RELAY), enabled = true, guestAllow = parseAllow(process.env.WEB_GUEST_ALLOW), bindIp = process.env.WEB_BIND_IP !== "0", blockedHosts = [], testHosts = process.env.RENDER ? null : parseTestHosts(process.env.WEB_TEST_HOSTS), secret = process.env.WEB_SECRET || crypto.randomBytes(32).toString("hex"), counters = null, usageSecret = defaultUsageSecret(), frameCheck = process.env.WEB_FRAME_CHECK !== "0" } = {}) => {
  const limits = { ...defaultLimits(), ...overrides }
  // byte budgets and monthly totals (persisted by server.js's shared counters; memory in tests)
  const ownCounters = !counters
  if (!counters) {
    counters = createCounters({ store: memoryUsageStore(), now })
    counters.start()
  }
  const mode = enabled === false ? "off" : relayModeOption
  const on = mode !== "off"
  // guests, and everyone in "allowlist" mode, may only fetch allowlisted hosts
  const limited = (session) => session.guest || mode === "allowlist"
  const allowedFor = (session, host) => !limited(session) || onList(host, guestAllow)
  // in "on" mode signing on opens other sites; in "allowlist" mode nothing does
  const notAllowed = (session, url) => {
    const signOn = session.guest && mode === "on"
    return new Refused(signOn ? 401 : 403, signOn ? "Sign on with your 98 Messenger screen name to browse other sites." : "Compass opens only a few sites through the 98ish server (Wikipedia and friends); it shows other sites straight from the site or as a saved copy.", { notAllowed: true, signOn, url: url?.href })
  }
  const sessions = new Map() // sid -> session
  const jars = new Map() // "u:<account>" -> { jar, at }
  const rate = { user: limiter(limits.perMinute, 60000), guest: limiter(limits.guestPerMinute, 60000), check: limiter(limits.checksPerMinute, 60000), session: limiter(30, 60 * 60000), frame: limiter(limits.checksPerMinute, 60000), frameAll: limiter(limits.frameChecksPerMinute, 60000) }
  const gates = new Map() // sid -> gate
  const globalGate = makeGate(limits.global)
  const rewriteGate = makeGate(limits.rewrites)
  const checks = new Map() // url -> { at, result }
  const extraBlocked = String(process.env.WEB_BLOCK_HOSTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const ownHosts = (request) => [request?.headers?.host, process.env.RENDER_EXTERNAL_HOSTNAME, ...OWN_SITES, ...extraBlocked, ...blockedHosts].filter(Boolean)
  // the guard checks every hop again, the allowlist too
  const guardFor = (request, session) => ({ blockedHosts: ownHosts(request), testHosts, ...(resolve ? { resolve } : {}), ...(session && limited(session) ? { allowHost: (host) => onList(host, guestAllow) } : {}) })

  const tokFor = (sid, site) => crypto.createHmac("sha256", secret).update(`${sid}|${site}`).digest("hex").slice(0, 16)
  const sameSite = (sid, tok, url) => {
    const want = tokFor(sid, siteOf(url.hostname))
    return typeof tok === "string" && tok.length === want.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(want))
  }

  // ---- usage (counters kept across restarts: server/meter/counters.js) ----
  // A guest's counter is keyed by a keyed hash of the address, never the address itself
  const usageIdOf = (account, ipk) => (account ? `u:${account.key}` : `g:${crypto.createHmac("sha256", usageSecret).update(ipk).digest("hex").slice(0, 32)}`)
  const budgetOf = (session) => (session.guest ? limits.guestDailyBytes : limits.userDailyBytes)
  const used = (id) => counters.value("day", id, dayOf(now())) || 0
  const charge = (session, n) => {
    if (!(n > 0)) return
    const day = dayOf(now())
    counters.add("day", session.usageId, day, n)
    counters.add("day", "relay", day, n)
    if (session.guest) counters.add("day", "guests", day, n)
    counters.add("month", "compass", monthOf(now()), n)
  }
  // this month: is Compass open? (unknown totals count as closed: fail closed)
  const monthly = () => {
    const t = now()
    const month = monthOf(t)
    const total = counters.value("month", "server", month)
    const compass = counters.value("month", "compass", month)
    const known = total !== null && compass !== null
    const open = known && total < limits.monthlyTotalBytes && compass < limits.monthlyBytes
    return { month, total, compass, known, open, reopens: nextMonthStart(t) }
  }
  const unavailable = () => new Refused(503, "Compass can't check its data allowance right now (the 98ish server's database isn't answering). Try again in a few minutes.", { budget: true, unavailable: true })
  const closedForMonth = (m) => new Refused(503, `Compass has used this month's data allowance; it's back on ${monthName(m.reopens)}. Until then, Compass shows sites straight from the site or as saved copies.`, { budget: true, monthly: true, reopens: m.reopens.toISOString() })
  // every allowance this request needs, read back from the store first; a Refused or null
  const budgetCheck = async (session) => {
    const day = dayOf(now())
    const month = monthOf(now())
    const keys = [["day", session.usageId, day], ["day", "relay", day], ["month", "compass", month], ["month", "server", month]]
    if (session.guest) keys.push(["day", "guests", day])
    try {
      await counters.ensure(keys)
    } catch {
      return unavailable()
    }
    const m = monthly()
    if (!m.known) return unavailable()
    if (!m.open) return closedForMonth(m)
    const over = used(session.usageId) >= budgetOf(session) || used("relay") >= limits.globalDailyBytes || (session.guest && used("guests") >= limits.guestsDailyBytes)
    if (over) return new Refused(429, "Today's Compass allowance on the 98ish server is used up. It starts again tomorrow (UTC); until then, Compass shows sites straight from the site or as saved copies.", { budget: true })
    return null
  }

  // ---- sessions ----
  const sweep = () => {
    const t = now()
    for (const [sid, s] of sessions) if (t - s.last > limits.idleMs) sessions.delete(sid)
    for (const [key, j] of jars) if (t - j.at > 24 * 3600 * 1000) jars.delete(key)
    for (const [url, c] of checks) if (t - c.at > 10 * 60 * 1000) checks.delete(url)
  }
  const sweeper = setInterval(sweep, 5 * 60 * 1000)
  sweeper.unref?.()

  const jarFor = (key) => {
    let j = jars.get(key)
    if (!j) jars.set(key, (j = { jar: new CookieJar({ max: 400, now }), at: now() }))
    j.at = now()
    return j.jar
  }

  const createSession = (request) => {
    if (!on) throw new Refused(503, "The web relay is turned off on this server.", { off: true })
    const account = sessionFrom(aim(), request)
    const ip = clientIp(request)
    if (!account && !allowGuests) throw new Refused(401, "Sign on with your 98 Messenger screen name to browse with Compass.", { signOn: true })
    const key = account ? `u:${account.key}` : `g:${ipKey(ip).key}`
    if (rate.session(key)) throw new Refused(429, "Too many new browsing sessions. Try again later.")
    sweep()
    // a few per key (tabs share one; devices and reloads make more): the oldest goes
    const mine = [...sessions.values()].filter((s) => s.key === key).sort((a, b) => a.last - b.last)
    while (mine.length >= limits.sessionsPerKey) sessions.delete(mine.shift().sid)
    if (sessions.size >= limits.maxSessions) {
      const oldest = [...sessions.values()].sort((a, b) => a.last - b.last)[0]
      if (oldest) sessions.delete(oldest.sid)
    }
    const sid = crypto.randomBytes(16).toString("hex")
    const { family, key: ipk } = ipKey(ip)
    const session = {
      sid,
      key,
      usageId: usageIdOf(account, ipk),
      guest: !account,
      name: account?.user?.screenName || null,
      created: now(),
      last: now(),
      ips: { [family]: ipk },
      // guests get a jar of their own that ends with the session
      jar: account ? jarFor(key) : new CookieJar({ max: 200, now }),
    }
    sessions.set(sid, session)
    return session
  }

  // the session behind a request, or a Refused
  const sessionFor = (sid, request) => {
    const s = sessions.get(String(sid || ""))
    if (!s) throw new Refused(401, "This browsing session has ended.", { expired: true })
    if (now() - s.last > limits.idleMs) {
      sessions.delete(s.sid)
      throw new Refused(401, "This browsing session has ended.", { expired: true })
    }
    if (bindIp) {
      const { family, key } = ipKey(clientIp(request))
      if (s.ips[family] === undefined && now() - s.created < limits.learnMs) s.ips[family] = key
      if (s.ips[family] !== key) throw new Refused(401, "This browsing session belongs to another connection.", { expired: true })
    }
    s.last = now()
    if (!s.guest) jars.get(s.key) && (jars.get(s.key).at = now())
    return s
  }

  const describe = (s) => {
    const m = monthly()
    return {
      sid: s.sid,
      guest: s.guest,
      name: s.name,
      used: used(s.usageId),
      limit: budgetOf(s),
      maxBytes: limits.maxBytes,
      mode,
      // the only sites this session may open (null: any public site)
      allow: limited(s) ? guestAllow : null,
      // closed for the rest of the month (the allowance is used up): until when
      closed: m.known && !m.open ? m.reopens.toISOString() : null,
    }
  }

  // ---- public status (numbers only): GET /api/web/status ----
  const status = () => {
    const m = monthly()
    const mb = (n) => (n === null ? null : Math.round((n / MB) * 10) / 10)
    return {
      mode,
      month: m.month,
      totalMB: mb(m.total),
      compassMB: mb(m.compass),
      capMB: Math.round(limits.monthlyTotalBytes / MB),
      compassCapMB: Math.round(limits.monthlyBytes / MB),
      open: on && m.open,
      reopens: m.known && !m.open ? m.reopens.toISOString() : null,
    }
  }

  // ---- is a page frameable? (headers only; the body isn't read) ----
  const check = async (s, input, request) => {
    const shape = checkUrlShape(input, { blockedHosts: ownHosts(request), testHosts })
    if (!shape.ok) return { ok: false, reason: shape.reason }
    if (!allowedFor(s, shape.url.hostname)) throw notAllowed(s, shape.url)
    const href = shape.url.href
    const cached = checks.get(href)
    if (cached && now() - cached.at < 10 * 60 * 1000) return cached.result
    if ((s.guest ? rate.guest : rate.check)(s.key)) throw new Refused(429, "Slow down a little.")
    const { res, url } = await fetchChecked(shape.url, {
      method: "GET",
      follow: 8,
      timeoutMs: limits.timeoutMs,
      guard: guardFor(request, s),
      headersFor: () => ({ accept: "text/html,*/*;q=0.8", "user-agent": String(request.headers["user-agent"] || "Mozilla/5.0").slice(0, 400), "accept-language": "en-US,en;q=0.8" }),
    })
    res.destroy()
    const result = {
      ok: true,
      url: url.href,
      status: res.statusCode,
      https: url.protocol === "https:",
      type: String(res.headers["content-type"] || "").split(";")[0].trim().toLowerCase(),
      frameable: frameVerdict(res.headers).frameable,
    }
    checks.set(href, { at: now(), result })
    if (checks.size > 500) checks.delete(checks.keys().next().value)
    return result
  }

  // ---- may ANY public page be framed? (GET /frame: no session, headers only) ----
  // Compass asks this for sites it doesn't relay: framable ones load straight from the site in
  // its frame, the rest as the Internet Archive's copy. The page itself is never read or sent.
  const FRAME_CHECK_BYTES = 600 // our request and the JSON answer, roughly (the site's headers are added)
  const frame = async (input, request) => {
    if (!frameCheck) return { ok: false, reason: "Frame checks are turned off on this server." }
    const shape = checkUrlShape(input, { blockedHosts: ownHosts(request), testHosts })
    if (!shape.ok) return { ok: false, reason: shape.reason }
    // where the frame will be: the 98ish page that asks (its Origin), else 98ish itself
    let ancestor = "https://98ish.vercel.app"
    try {
      const o = new URL(String(request.headers.origin || ""))
      if (o.protocol === "https:" || o.protocol === "http:") ancestor = o.origin
    } catch {
      // no Origin: the default
    }
    const key = `frame ${ancestor} ${shape.url.href}`
    const cached = checks.get(key)
    if (cached && now() - cached.at < 10 * 60 * 1000) return cached.result
    if (rate.frame(`f:${ipKey(clientIp(request)).key}`) || rate.frameAll("all")) throw new Refused(429, "Slow down a little.")
    let headerBytes = 0
    const { res, url } = await fetchChecked(shape.url, {
      method: "GET",
      follow: 8,
      timeoutMs: Math.min(limits.timeoutMs, 10000),
      guard: guardFor(request, null),
      headersFor: () => ({ accept: "text/html,*/*;q=0.8", "user-agent": String(request.headers["user-agent"] || "Mozilla/5.0").slice(0, 400), "accept-language": "en-US,en;q=0.8" }),
      onResponse: (r) => (headerBytes += (r.rawHeaders || []).reduce((n, h) => n + String(h).length + 2, 0)),
    })
    res.destroy() // headers only: the body is never read
    const verdict = frameVerdict(res.headers, ancestor)
    const status = res.statusCode
    // an error page (a bot check, "forbidden", the site down) isn't worth showing live
    const okStatus = status < 400 || status === 404 || status === 410
    const result = {
      ok: true,
      url: url.href,
      status,
      https: url.protocol === "https:",
      type: String(res.headers["content-type"] || "").split(";")[0].trim().toLowerCase(),
      frameable: verdict.frameable && okStatus,
      by: verdict.frameable ? (okStatus ? null : "status") : verdict.by,
    }
    const n = FRAME_CHECK_BYTES + headerBytes
    counters.add("day", "frames", dayOf(now()), n)
    counters.add("day", "relay", dayOf(now()), n)
    counters.add("month", "compass", monthOf(now()), n)
    checks.set(key, { at: now(), result })
    if (checks.size > 500) checks.delete(checks.keys().next().value)
    return result
  }

  // ---- the relay ----

  // this server's public address (Render terminates TLS in front of us)
  const origin = (request) => {
    if (process.env.WEB_PUBLIC_URL) return process.env.WEB_PUBLIC_URL.replace(/\/$/, "")
    const proto = String(request.headers["x-forwarded-proto"] || request.protocol || "http").split(",")[0].trim()
    return `${proto === "https" ? "https" : "http"}://${request.get("host")}`
  }
  const relayBase = (request) => `${origin(request)}${request.baseUrl}`

  const relay = async (request, response, { raw, sid, tok, mode, rest, search }) => {
    const isNav = !raw && (NAV_DESTS.has(String(request.headers["sec-fetch-dest"] || "")) || (!request.headers["sec-fetch-dest"] && /^text\/html/.test(String(request.headers.accept || "")) && request.method === "GET"))
    const target = decodeTarget(rest, search)
    let session
    let release = null
    const fail = (error) => {
      if (response.headersSent || response.destroyed || request.destroyed) return response.destroy()
      const status = error.status || 502
      const message = error.status ? error.message : "Something went wrong relaying that page."
      if (!error.status) console.error("[web] relay error", error.message)
      if (isNav) {
        const kind = error.expired ? "expired" : error.monthly ? "monthly" : error.unavailable ? "unavailable" : error.budget ? "budget" : error.blocked ? "blocked" : error.notAllowed ? (error.signOn ? "signon" : "notallowed") : error.off ? "off" : "error"
        const title = kind === "expired" ? "Session ended" : kind === "signon" ? "Sign on to browse other sites" : kind === "monthly" ? "Compass is resting until next month" : "Compass can't show this page"
        sendStub(response, status, { kind, url: error.url || target?.href || "", title, text: message, ...(error.reopens ? { reopens: error.reopens } : {}) })
      } else response.status(status).set("content-security-policy", "sandbox").type("text/plain").send(message)
    }
    try {
      if (!on) throw new Refused(503, "The web relay is turned off on this server.", { off: true })
      session = sessionFor(sid, request)
      if (!target) throw new Refused(400, "That isn't a relay address.")
      // guests: allowlisted sites only, for pages and everything they load
      if (!allowedFor(session, target.hostname)) throw notAllowed(session, target)
      const site = siteOf(target.hostname)
      const firstParty = sameSite(sid, tok, target)
      // a page opened with the wrong site token: send it to the right one (no cookies leak:
      // the token only decides whether cookies are sent)
      if (isNav && !firstParty) {
        const right = `${relayBase(request)}/r/${sid}/${tokFor(sid, site)}/${mode}/${encodeTarget(target)}`
        return response.status(request.method === "GET" || request.method === "HEAD" ? 302 : 307).set("location", right).set("cache-control", "no-store").end()
      }
      // a page's service worker can't be registered here: refuse its script outright
      if (request.headers["service-worker"] || /^(serviceworker|sharedworker)$/.test(String(request.headers["sec-fetch-dest"] || ""))) throw new Refused(403, "Relayed pages can't install service workers.")
      const over = await budgetCheck(session)
      if (over) throw over
      if ((session.guest ? rate.guest : rate.user)(session.key)) throw new Refused(429, "Too many requests. Wait a minute and try again.")
      // at most a few at once per session and for the server: the rest wait their turn
      let gate = gates.get(sid)
      if (!gate) gates.set(sid, (gate = makeGate(limits.perSession)))
      await gate.acquire(limits.waitMs)
      try {
        await globalGate.acquire(limits.waitMs)
      } catch (error) {
        gate.release()
        throw error
      }
      let released = false
      release = () => {
        if (released) return
        released = true
        gate.release()
        globalGate.release()
        if (!gate.active && !gate.waiting) gates.delete(sid)
      }
      response.on("close", release)

      // the request body (forms, a script's POST), capped
      let body = null
      if (!["GET", "HEAD"].includes(request.method)) {
        body = await readBody(request, limits.requestBytes)
      }

      const clientAccepts = String(request.headers["accept-encoding"] || "")
      const encodings = ["gzip", "deflate", "br"].filter((e) => clientAccepts.includes(e))
      const headersFor = (url, method) => {
        const h = {}
        for (const [name, value] of Object.entries(request.headers)) {
          const n = name.toLowerCase()
          if (HOP_BY_HOP.has(n) || NEVER_FORWARD.test(n)) continue
          // never hand the person's 98ish session to a site (anything shaped like one)
          if (n === "authorization" && /^\s*Bearer\s+[a-f0-9]{48}\s*$/i.test(String(value))) continue
          h[n] = value
        }
        h["accept-encoding"] = encodings.length ? encodings.join(", ") : "identity"
        // as if the request came from the site itself (forms check these)
        h.referer = `${url.origin}/`
        if (method !== "GET" && method !== "HEAD") h.origin = url.origin
        if (firstParty) {
          const cookie = session.jar.header(url.href)
          if (cookie) h.cookie = cookie
        }
        if (body) h["content-length"] = String(body.length)
        return h
      }
      const { res: upstream, url } = await fetchChecked(target, {
        method: request.method,
        body,
        headersFor,
        timeoutMs: limits.timeoutMs,
        guard: guardFor(request, session),
      })
      upstream.on("error", () => {})
      if (firstParty) session.jar.setAll(upstream.headers["set-cookie"], url.href)

      const status = upstream.statusCode
      const type = String(upstream.headers["content-type"] || "").split(";")[0].trim().toLowerCase()
      const length = Number(upstream.headers["content-length"]) || 0
      const disposition = String(upstream.headers["content-disposition"] || "")
      const prefix = raw ? `${relayBase(request)}/x/${sid}/${tok}/` : `${relayBase(request)}/r/${sid}/${tok}/${mode}/`

      // redirects come back through the relay (so the next hop is checked again)
      if (REDIRECTS.has(status) && upstream.headers.location) {
        upstream.resume()
        let next
        try {
          next = new URL(upstream.headers.location, url)
        } catch {
          throw new Refused(502, "The site sent a broken redirect.")
        }
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          if (isNav) return sendStub(response, 200, { kind: "app", url: next.href, title: "This link opens an app", text: `The site wants to open ${next.protocol.replace(":", "")}: links, which only your real browser can do.` })
          throw new Refused(502, "The site redirected somewhere Compass can't go.")
        }
        // a guest's redirect off the allowlist stops here (the next hop would be refused anyway)
        if (!allowedFor(session, next.hostname)) throw notAllowed(session, next)
        response.status(status).set("location", prefix + encodeTarget(next) + next.hash).set("cache-control", "no-store").set("referrer-policy", "no-referrer").end()
        return
      }

      if (MEDIA.test(type)) {
        upstream.destroy()
        if (isNav) return sendStub(response, 200, { kind: "media", url: url.href, title: "Videos and sounds play in your real browser", text: "Compass doesn't relay video or audio through the 98ish server." })
        throw new Refused(415, "Compass doesn't relay video or audio.")
      }
      if (length > limits.maxBytes) {
        upstream.destroy()
        if (isNav) return sendStub(response, 200, { kind: "download", url: url.href, name: fileName(url, disposition), size: length, contentType: type, tooBig: true, title: "This file is too big for Compass", text: "Open it in your real browser to download it." })
        throw new Refused(413, "That's too big for the relay.")
      }
      // a page link to a file: Compass shows its own download page
      if (isNav && status < 400 && (/^\s*attachment/i.test(disposition) || (type && !HTML.test(type) && !SHOWABLE.test(type)))) {
        upstream.destroy()
        return sendStub(response, 200, { kind: "download", url: url.href, name: fileName(url, disposition), size: length || null, contentType: type, tok, title: "Download", text: `${fileName(url, disposition)} is a file to download.` })
      }

      const direct = mode === "d" && url.protocol === "https:"
      const navUrl = (u) => `${relayBase(request)}/r/${sid}/${tok}/${mode}/${encodeTarget(u)}${new URL(u).hash}`
      // Direct mode: pictures and scripts load straight from the site (no relay data), but
      // stylesheets and fonts come through the relay: fonts need CORS, which an opaque-origin
      // page only gets from us, and stylesheets are where the fonts are named
      const viaRelay = (u, info) => STYLE_OR_FONT.test(u) || info?.tag === "import" || (info?.tag === "link" && (/\bstylesheet\b/.test(info.rel) || info.as === "font" || info.as === "style"))
      const assetUrl = (u, info) => (direct && u.startsWith("https:") && !viaRelay(u, info) ? u : navUrl(u))
      const headers = {
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "cross-origin",
        "access-control-expose-headers": "*",
      }
      for (const name of PASS_BACK) if (upstream.headers[name] !== undefined) headers[name] = upstream.headers[name]

      const rewriteHtmlPage = isNav && HTML.test(type) && request.method !== "HEAD"
      const rewriteSheet = !raw && type === "text/css" && request.method !== "HEAD"
      if (rewriteHtmlPage || rewriteSheet) {
        await rewriteGate.acquire(limits.waitMs)
        let text
        try {
          const buffer = await collect(decompress(upstream), limits.rewriteBytes)
          text = decodeText(buffer, upstream.headers["content-type"])
          if (rewriteHtmlPage) {
            const cfg = {
              url: url.href,
              prefix,
              raw: `${relayBase(request)}/x/${sid}/${tok}/`,
              server: origin(request),
              cookieUrl: `${relayBase(request)}/c/${sid}/${tok}`,
              cookies: session.jar.header(url.href, { forScript: true }),
              tok,
              zoom: 1,
            }
            const inject = `<meta name="referrer" content="no-referrer">${direct ? `<base href="${escapeHtml(url.href)}">` : ""}${injectScript(cfg)}`
            text = rewriteHtml(text, { pageUrl: url.href, nav: navUrl, asset: assetUrl, base: (u) => (direct ? u : navUrl(u)), inject })
            headers["content-type"] = "text/html; charset=utf-8"
            headers["content-security-policy"] = PAGE_SANDBOX
            headers["cache-control"] = "no-store"
          } else {
            text = rewriteCss(text, url.href, assetUrl)
            headers["content-type"] = "text/css; charset=utf-8"
            headers["content-security-policy"] = "sandbox"
          }
        } catch (error) {
          if (error.tooBig) {
            if (isNav) return sendStub(response, 200, { kind: "toobig", url: url.href, title: "This page is too big for Compass", text: "Open it in your real browser." })
            throw new Refused(413, "That's too big for the relay.")
          }
          throw error
        } finally {
          rewriteGate.release()
        }
        let out = Buffer.from(text, "utf8")
        if (/\bgzip\b/.test(clientAccepts) && out.length > 1024) {
          out = await new Promise((ok, no) => zlib.gzip(out, { level: 6 }, (e, b) => (e ? no(e) : ok(b))))
          headers["content-encoding"] = "gzip"
          headers.vary = "Accept-Encoding"
        }
        headers["content-length"] = String(out.length)
        charge(session, out.length)
        response.status(status).set(headers).end(out)
        return
      }

      // everything else streams through as it came (compressed if it was)
      if (upstream.headers["content-encoding"]) headers["content-encoding"] = upstream.headers["content-encoding"]
      if (upstream.headers["content-length"]) headers["content-length"] = upstream.headers["content-length"]
      if (raw && disposition) headers["content-disposition"] = disposition
      // relayed pages (a nested frame that isn't HTML, a script's request) never run as this server
      headers["content-security-policy"] = "sandbox"
      response.status(status).set(headers)
      if (request.method === "HEAD") {
        upstream.resume()
        return response.end()
      }
      let sent = 0
      const meter = new Transform({
        transform(chunk, encoding, done) {
          sent += chunk.length
          charge(session, chunk.length)
          if (sent > limits.maxBytes) return done(new Refused(413, "That's too big for the relay."))
          done(null, chunk)
        },
      })
      pipeline(upstream, meter, response, () => {})
    } catch (error) {
      fail(error)
    }
  }

  const sendStub = (response, status, info) => {
    response
      .status(status)
      .set({ "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_SANDBOX, "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" })
      .send(stubHtml(info))
  }

  // ---- the router ----
  const router = express.Router()

  // Every answer from here: nothing runs as this server's origin (pages override this with
  // PAGE_SANDBOX, which still has no allow-same-origin), no MIME sniffing.
  // CORS: relayed pages are opaque origins (Origin: null), so "*" is the only origin that fits,
  // and credentials are NEVER allowed (no Access-Control-Allow-Credentials): nothing on this
  // server authenticates by cookie, and inject.js asks pages' requests to leave credentials out.
  router.use((request, response, next) => {
    response.set({ "content-security-policy": "sandbox", "x-content-type-options": "nosniff", "access-control-allow-origin": "*" })
    if (request.method === "OPTIONS") {
      response.set({
        "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
        "access-control-allow-headers": String(request.headers["access-control-request-headers"] || "*").slice(0, 2000),
        "access-control-max-age": "600",
      })
      return response.status(204).end()
    }
    next()
  })

  const send = (response, error) => {
    const status = error.status || 500
    if (!error.status) console.error("[web]", error)
    response.status(status).json({ error: error.status ? error.message : "Something went wrong.", expired: !!error.expired, signOn: !!error.signOn, off: !!error.off })
  }

  router.post("/session", async (request, response) => {
    try {
      const s = createSession(request)
      // read this month's totals back first, so the session can say whether Compass is open
      const month = monthOf(now())
      await counters.ensure([["month", "server", month], ["month", "compass", month], ["day", s.usageId, dayOf(now())]]).catch(() => {})
      response.json(describe(s))
    } catch (error) {
      send(response, error)
    }
  })

  // how much the server has sent this month and whether Compass is open (numbers only)
  router.get("/status", async (request, response) => {
    const month = monthOf(now())
    await counters.ensure([["month", "server", month], ["month", "compass", month]]).catch(() => {})
    response.set("cache-control", "no-store").json(status())
  })

  router.get("/usage", (request, response) => {
    try {
      response.json(describe(sessionFor(request.query.sid, request)))
    } catch (error) {
      send(response, error)
    }
  })

  router.get("/check", async (request, response) => {
    try {
      const s = sessionFor(request.query.sid, request)
      response.json(await check(s, String(request.query.url || ""), request))
    } catch (error) {
      if (error.status && !error.expired && error.status !== 429) return response.json({ ok: false, reason: error.message, notAllowed: !!error.notAllowed, signOn: !!error.signOn })
      send(response, error)
    }
  })

  // can this page (any public site) go straight into Compass's frame? Headers only, no session
  router.get("/frame", async (request, response) => {
    response.set("cache-control", "no-store")
    try {
      response.json(await frame(String(request.query.url || ""), request))
    } catch (error) {
      if (error.status === 429) return send(response, error)
      if (!error.status) console.error("[web] frame check", error.message)
      response.json({ ok: false, reason: error.status ? error.message : "The site couldn't be checked." })
    }
  })

  // forget this account's cookies (Compass > Clear Cookies)
  router.post("/clear", (request, response) => {
    try {
      const s = sessionFor(request.query.sid, request)
      s.jar.clear()
      response.json({ ok: true })
    } catch (error) {
      send(response, error)
    }
  })

  router.post("/c/:sid/:tok", async (request, response) => {
    try {
      const s = sessionFor(request.params.sid, request)
      const body = JSON.parse((await readBody(request, 16 * 1024)).toString("utf8") || "{}")
      const url = new URL(String(body.url || ""))
      if (!sameSite(s.sid, request.params.tok, url)) throw new Refused(403, "Not this page's cookie.")
      s.jar.set(String(body.cookie || ""), url.href, { fromScript: true })
      response.status(204).end()
    } catch (error) {
      send(response, error.status ? error : new Refused(400, "That cookie couldn't be read."))
    }
  })

  // /r/<sid>/<tok>/<mode>/<scheme>/<host>/<path> and /x/<sid>/<tok>/<scheme>/<host>/<path>
  router.use((request, response, next) => {
    const q = request.url.indexOf("?")
    const path = q < 0 ? request.url : request.url.slice(0, q)
    const search = q < 0 ? "" : request.url.slice(q)
    let m = /^\/r\/([a-f0-9]{32})\/([a-z0-9_]{1,32})\/([df])\/(.*)$/.exec(path)
    if (m) return relay(request, response, { raw: false, sid: m[1], tok: m[2], mode: m[3], rest: m[4], search })
    m = /^\/x\/([a-f0-9]{32})\/([a-z0-9_]{1,32})\/(.*)$/.exec(path)
    if (m) return relay(request, response, { raw: true, sid: m[1], tok: m[2], mode: "f", rest: m[3], search })
    next()
  })

  return {
    router,
    // for tests
    sessions,
    counters,
    limits,
    tokFor,
    createSession,
    status,
    stop: () => {
      clearInterval(sweeper)
      if (ownCounters) counters.stop()
    },
  }
}

// The key for hashing guest addresses in the usage store: stable across restarts (so a guest's
// daily allowance survives one) without being stored next to the hashes: WEB_SECRET, or else
// derived from the MongoDB address (a secret the database itself doesn't hold)
const defaultUsageSecret = () => {
  if (process.env.WEB_SECRET) return process.env.WEB_SECRET
  if (process.env.MONGODB_URI) return crypto.createHash("sha256").update(`98ish-usage|${process.env.MONGODB_URI}`).digest("hex")
  return crypto.randomBytes(32).toString("hex")
}

// ---------- body helpers ----------

const readBody = (request, cap) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on("data", (chunk) => {
      size += chunk.length
      if (size > cap) {
        request.pause()
        reject(new Refused(413, "That's too much to send."))
      } else chunks.push(chunk)
    })
    request.on("end", () => resolve(Buffer.concat(chunks)))
    request.on("error", reject)
  })

const decompress = (res) => {
  const enc = String(res.headers["content-encoding"] || "").trim().toLowerCase()
  const d = enc === "gzip" || enc === "x-gzip" ? zlib.createGunzip() : enc === "br" ? zlib.createBrotliDecompress() : enc === "deflate" ? zlib.createUnzip() : null
  if (!d) return res
  pipeline(res, d, () => {})
  return d
}

const collect = (stream, cap) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    stream.on("data", (chunk) => {
      size += chunk.length
      if (size > cap) {
        stream.destroy()
        reject(Object.assign(new Error("too big"), { tooBig: true }))
      } else chunks.push(chunk)
    })
    stream.on("end", () => resolve(Buffer.concat(chunks)))
    stream.on("error", (error) => reject(new Refused(502, `The page stopped arriving (${error.code || error.message}).`)))
  })

// the page's text, in whatever character set it says (or its BOM or <meta> says)
const charsetOf = (contentType, buffer) => {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return "utf-8"
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return "utf-16le"
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return "utf-16be"
  const header = /charset\s*=\s*["']?([\w.:-]+)/i.exec(String(contentType || ""))
  if (header) return header[1]
  const head = buffer.subarray(0, 4096).toString("latin1")
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)
  return meta ? meta[1] : "utf-8"
}
const decodeText = (buffer, contentType) => {
  const label = charsetOf(contentType, buffer)
  try {
    return new TextDecoder(label).decode(buffer)
  } catch {
    return new TextDecoder("utf-8").decode(buffer)
  }
}

const fileName = (url, disposition) => {
  const star = /filename\*\s*=\s*(?:utf-8|UTF-8)''([^;]+)/.exec(disposition)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""))
    } catch {}
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)
  if (plain) return plain[1].trim()
  let last = url.pathname.split("/").filter(Boolean).pop() || ""
  try {
    last = decodeURIComponent(last)
  } catch {}
  return (last || url.hostname).slice(0, 120)
}

const webRouter = (options) => createWeb(options)

module.exports = { createWeb, webRouter, PAGE_SANDBOX, NEVER_PASS, PASS_BACK, GUEST_ALLOW, parseAllow, onList, relayMode, siteOf, clientIp, ipKey, charsetOf, decodeText, stubHtml, makeGate, frameVerdict }
