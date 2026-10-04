// Relayed pages must be isolated from 98ish (opaque origin, no credentials, no service
// workers, no top navigation), and Compass's budgets must survive restarts and fail closed.
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")
const express = require("express")
const { createWeb, siteOf, PAGE_SANDBOX, NEVER_PASS, PASS_BACK } = require("..")
const { refuseOpaqueOrigins, allowSocketRequest, isOpaqueOrigin } = require("../origins")
const { createCounters, memoryUsageStore } = require("../../meter/counters")

const TOKEN = "a".repeat(48)
const fakeAim = () => ({ authenticate: (t) => (t === TOKEN ? { key: "alice", user: { screenName: "Alice" } } : null) })
const quiet = { warn: () => {} }

// A hostile site: every header a page could use against the relay's own origin
const HOSTILE_HEADERS = {
  "set-cookie": "evil=1; Path=/; Domain=127.0.0.1",
  "clear-site-data": '"cookies", "storage"',
  "service-worker-allowed": "/",
  link: "</sw.js>; rel=serviceworker",
  refresh: "0; url=https://evil.example/",
  "access-control-allow-credentials": "true",
  "access-control-allow-origin": "https://98ish.vercel.app",
  "content-security-policy": "script-src *",
  "cross-origin-opener-policy": "unsafe-none",
  "permissions-policy": "camera=*",
  "origin-agent-cluster": "?0",
}
const startSite = () => {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers })
    const send = (status, headers, body) => {
      res.writeHead(status, headers)
      res.end(body)
    }
    if (req.url === "/page") return send(200, { "content-type": "text/html", ...HOSTILE_HEADERS }, "<title>evil</title><script>top.location='https://evil.example'</script>")
    if (req.url === "/sw.js") return send(200, { "content-type": "text/javascript", ...HOSTILE_HEADERS }, "self.onfetch=()=>{}")
    if (req.url === "/pic.svg") return send(200, { "content-type": "image/svg+xml", ...HOSTILE_HEADERS }, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    if (req.url === "/big") return send(200, { "content-type": "application/octet-stream" }, Buffer.alloc(200 * 1024))
    return send(200, { "content-type": "text/plain" }, "ok")
  })
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, seen })))
}

const setup = async ({ counters, limits = {}, allowGuests = true, mode = "on", now } = {}) => {
  const site = await startSite()
  const web = createWeb({ aim: () => fakeAim(), allowGuests, mode, guestAllow: ["site.test"], testHosts: { "site.test": "127.0.0.1" }, limits: { waitMs: 2000, ...limits }, secret: "s".repeat(64), usageSecret: "u".repeat(64), ...(counters ? { counters } : {}), ...(now ? { now } : {}) })
  const app = express()
  app.use("/api/web", web.router)
  app.use(refuseOpaqueOrigins)
  // stand-ins for the rest of the 98ish API
  app.get("/api/calendar/list", (req, res) => res.json({ calendars: [] }))
  app.get("/", (req, res) => res.send("98ish chat server is running"))
  const server = http.createServer(app)
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const origin = `http://127.0.0.1:${server.address().port}`
  const base = `${origin}/api/web`
  const session = async (headers = { authorization: `Bearer ${TOKEN}` }) => {
    const r = await fetch(`${base}/session`, { method: "POST", headers })
    return { status: r.status, ...(await r.json()) }
  }
  const S = `http://site.test:${site.port}`
  const page = (sid, url, { nav = true, headers = {}, raw = false, ...init } = {}) => {
    const u = new URL(url)
    const t = web.tokFor(sid, siteOf(u.hostname))
    const where = raw ? `x/${sid}/${t}` : `r/${sid}/${t}/f`
    return fetch(`${base}/${where}/${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}`, { redirect: "manual", headers: { ...(nav ? { "sec-fetch-dest": "document" } : { "sec-fetch-dest": "empty" }), ...headers }, ...init })
  }
  const close = () => {
    web.stop()
    server.close()
    site.server.close()
  }
  return { web, origin, base, session, page, site, S, close }
}

// ---------- isolation ----------

test("isolation: relayed pages get an opaque-origin sandbox with no way out", async () => {
  for (const flag of ["allow-same-origin", "allow-top-navigation", "allow-top-navigation-by-user-activation", "allow-popups-to-escape-sandbox", "allow-storage-access-by-user-activation", "allow-downloads"]) assert.doesNotMatch(PAGE_SANDBOX, new RegExp(`\\b${flag}\\b`), flag)
  const t = await setup()
  try {
    const { sid } = await t.session()
    const r = await t.page(sid, `${t.S}/page`)
    assert.equal(r.status, 200)
    assert.equal(r.headers.get("content-security-policy"), PAGE_SANDBOX)
    assert.equal(r.headers.get("x-content-type-options"), "nosniff")
  } finally {
    t.close()
  }
})

test("isolation: everything else from /api/web is sandboxed without scripts (JSON, scripts, SVG, errors, redirects, preflights)", async () => {
  const t = await setup()
  try {
    const s = await t.session()
    const answers = {
      session: await fetch(`${t.base}/session`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }),
      usage: await fetch(`${t.base}/usage?sid=${s.sid}`),
      status: await fetch(`${t.base}/status`),
      script: await t.page(s.sid, `${t.S}/sw.js`, { nav: false }),
      raw: await t.page(s.sid, `${t.S}/sw.js`, { raw: true }),
      svgPage: await t.page(s.sid, `${t.S}/pic.svg`), // a picture opened as a page: no scripts
      expired: await t.page("f".repeat(32), `${t.S}/sw.js`, { nav: false }),
      wrongTok: await fetch(`${t.base}/r/${s.sid}/${"0".repeat(16)}/f/http/site.test:${t.site.port}/page`, { redirect: "manual", headers: { "sec-fetch-dest": "document" } }),
      preflight: await fetch(`${t.base}/x/whatever`, { method: "OPTIONS", headers: { origin: "null", "access-control-request-method": "POST" } }),
    }
    assert.equal(answers.wrongTok.status, 302)
    for (const [name, r] of Object.entries(answers)) {
      assert.equal(r.headers.get("content-security-policy"), "sandbox", name)
      assert.equal(r.headers.get("x-content-type-options"), "nosniff", name)
      // never credentialed CORS
      assert.equal(r.headers.get("access-control-allow-credentials"), null, name)
      assert.equal(r.headers.get("access-control-allow-origin"), "*", name)
    }
  } finally {
    t.close()
  }
})

test("isolation: a site's own Set-Cookie, Clear-Site-Data, Service-Worker-Allowed, Link, Refresh and CORS headers never reach the browser", async () => {
  for (const h of NEVER_PASS) assert.ok(!PASS_BACK.includes(h), h)
  const t = await setup()
  try {
    const { sid } = await t.session()
    for (const r of [await t.page(sid, `${t.S}/page`), await t.page(sid, `${t.S}/sw.js`, { nav: false }), await t.page(sid, `${t.S}/sw.js`, { raw: true }), await t.page(sid, `${t.S}/pic.svg`, { nav: false })]) {
      for (const h of Object.keys(HOSTILE_HEADERS)) {
        if (h === "content-security-policy") assert.match(r.headers.get(h), /^sandbox/)
        else if (h === "access-control-allow-origin") assert.equal(r.headers.get(h), "*")
        else assert.equal(r.headers.get(h), null, `${h} on ${r.url}`)
      }
      await r.arrayBuffer()
    }
  } finally {
    t.close()
  }
})

test("isolation: service-worker scripts are refused through the relay, before anything is fetched", async () => {
  const t = await setup()
  try {
    const { sid } = await t.session()
    const before = t.site.seen.length
    const a = await t.page(sid, `${t.S}/sw.js`, { nav: false, headers: { "service-worker": "script", "sec-fetch-dest": "serviceworker" } })
    assert.equal(a.status, 403)
    const b = await t.page(sid, `${t.S}/sw.js`, { raw: true, headers: { "service-worker": "script" } })
    assert.equal(b.status, 403)
    const c = await t.page(sid, `${t.S}/sw.js`, { nav: false, headers: { "sec-fetch-dest": "sharedworker" } })
    assert.equal(c.status, 403)
    assert.equal(t.site.seen.length, before)
  } finally {
    t.close()
  }
})

test("isolation: the rest of the API refuses opaque origins (relayed pages); normal callers are fine", async () => {
  assert.ok(isOpaqueOrigin("null") && isOpaqueOrigin(" NULL ") && !isOpaqueOrigin("https://98ish.vercel.app") && !isOpaqueOrigin(undefined))
  const t = await setup()
  try {
    const opaque = await fetch(`${t.origin}/api/calendar/list`, { headers: { origin: "null", authorization: `Bearer ${TOKEN}` } })
    assert.equal(opaque.status, 403)
    assert.equal(opaque.headers.get("access-control-allow-origin"), null)
    assert.equal((await fetch(`${t.origin}/api/calendar/list`, { headers: { origin: "https://98ish.vercel.app" } })).status, 200)
    assert.equal((await fetch(`${t.origin}/api/calendar/list`)).status, 200) // calendar feeds etc. send no Origin
    // the relay itself still answers relayed pages (they are Origin: null)
    const { sid } = await t.session()
    assert.equal((await t.page(sid, `${t.S}/sw.js`, { raw: true, headers: { origin: "null" } })).status, 200)
  } finally {
    t.close()
  }
  // socket.io handshakes
  const ask = (origin) => new Promise((r) => allowSocketRequest({ headers: origin === undefined ? {} : { origin } }, (e, ok) => r(ok)))
  assert.equal(await ask("null"), false)
  assert.equal(await ask("https://98ish.vercel.app"), true)
  assert.equal(await ask(undefined), true)
})

test("isolation: Compass's frames have no allow-same-origin for relayed pages and no escape for any", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../../client/src/components/applets/compass/Compass.jsx"), "utf8")
  const relay = /const RELAY_SANDBOX = "([^"]*)"/.exec(src)[1]
  const direct = /const DIRECT_SANDBOX = "([^"]*)"/.exec(src)[1]
  assert.doesNotMatch(relay, /allow-same-origin/)
  for (const sandbox of [relay, direct]) assert.doesNotMatch(sandbox, /allow-top-navigation|allow-popups-to-escape-sandbox/)
  // messages from relayed frames must come from an opaque origin and from the tab's own frame
  assert.match(src, /tab\.view === "relay" && event\.origin !== "null"/)
  assert.match(src, /el\.contentWindow === event\.source/)
})

// ---------- budgets kept across restarts, failing closed ----------

const KB = 1024
const restartable = () => {
  const data = new Map()
  return { data, counters: () => createCounters({ store: memoryUsageStore(data), log: quiet }) }
}

test("budgets: a member's daily allowance survives a restart", async () => {
  const db = restartable()
  const first = await setup({ counters: db.counters(), limits: { userDailyBytes: 300 * KB } })
  let c1
  try {
    c1 = first.web.counters
    const { sid } = await first.session()
    await (await first.page(sid, `${first.S}/big`, { raw: true })).arrayBuffer()
    await (await first.page(sid, `${first.S}/big`, { raw: true })).arrayBuffer()
    await c1.flush() // what SIGTERM does
  } finally {
    first.close()
  }
  assert.ok(db.data.get(`day|u:alice|${new Date().toISOString().slice(0, 10)}`).n >= 400 * KB)
  const second = await setup({ counters: db.counters(), limits: { userDailyBytes: 300 * KB } })
  try {
    const s = await second.session()
    const over = await second.page(s.sid, `${second.S}/framable`)
    assert.equal(over.status, 429)
    assert.match(await over.text(), /"kind":"budget"/)
  } finally {
    second.close()
  }
})

test("budgets: guests are counted by a keyed hash of their address (never the address), and it survives a restart", async () => {
  const db = restartable()
  const ip = { "cf-connecting-ip": "203.0.113.77" }
  const first = await setup({ counters: db.counters(), limits: { guestDailyBytes: 150 * KB } })
  try {
    const g = await first.session(ip)
    assert.equal(g.guest, true)
    await (await first.page(g.sid, `${first.S}/big`, { raw: true, headers: ip })).arrayBuffer()
    await first.web.counters.flush()
  } finally {
    first.close()
  }
  const keys = [...db.data.keys()]
  assert.ok(keys.some((k) => /^day\|g:[a-f0-9]{32}\|/.test(k)), keys.join(" "))
  assert.ok(!keys.some((k) => k.includes("203.0.113")), "no raw address stored")
  const second = await setup({ counters: db.counters(), limits: { guestDailyBytes: 150 * KB } })
  try {
    const g = await second.session(ip)
    assert.equal((await second.page(g.sid, `${second.S}/framable`, { raw: true, headers: ip })).status, 429)
    const other = { "cf-connecting-ip": "203.0.113.78" }
    const g2 = await second.session(other)
    assert.equal((await second.page(g2.sid, `${second.S}/framable`, { raw: true, headers: other })).status, 200)
  } finally {
    second.close()
  }
})

test("budgets: with the database unreachable after a restart, the relay stays closed (fails closed); sessions, status and other routes still answer", async () => {
  const counters = createCounters({ store: memoryUsageStore(new Map(), { fail: () => true }), log: quiet })
  const t = await setup({ counters })
  try {
    const s = await t.session()
    assert.equal(s.status, 200)
    const before = t.site.seen.length
    const r = await t.page(s.sid, `${t.S}/page`)
    assert.equal(r.status, 503)
    const body = await r.text()
    assert.match(body, /"kind":"unavailable"/)
    assert.match(body, /can't check its data allowance/)
    assert.equal(t.site.seen.length, before, "nothing fetched while uncapped")
    const st = await (await fetch(`${t.base}/status`)).json()
    assert.equal(st.open, false)
    assert.equal(st.totalMB, null)
    // the rest of 98ish carries on
    assert.equal((await fetch(`${t.origin}/api/calendar/list`)).status, 200)
  } finally {
    t.close()
  }
})

test("monthly cap: when the whole server has sent WEB_MONTHLY_TOTAL_MB, Compass closes until the 1st; other routes keep working", async () => {
  const now = () => Date.parse("2026-10-20T12:00:00Z")
  const data = new Map([["month|server|2026-10", { n: 3000 * 1024 * 1024 }]])
  const counters = createCounters({ store: memoryUsageStore(data), log: quiet, now })
  const t = await setup({ counters, now, limits: { monthlyTotalBytes: 3000 * 1024 * 1024 } })
  try {
    const s = await t.session()
    assert.equal(s.status, 200)
    // the session says so (Compass shows its page without asking the relay)
    await counters.ensure([["month", "server", "2026-10"], ["month", "compass", "2026-10"]])
    const again = await t.session()
    assert.equal(again.closed, "2026-11-01T00:00:00.000Z")
    const before = t.site.seen.length
    const r = await t.page(s.sid, `${t.S}/page`)
    assert.equal(r.status, 503)
    const body = await r.text()
    assert.match(body, /"kind":"monthly"/)
    assert.match(body, /Compass has used this month's data allowance; it's back on November 1/)
    assert.match(body, /"reopens":"2026-11-01T00:00:00.000Z"/)
    assert.equal(t.site.seen.length, before)
    // scripts' requests too
    assert.equal((await t.page(s.sid, `${t.S}/sw.js`, { raw: true })).status, 503)
    const st = await (await fetch(`${t.base}/status`)).json()
    assert.deepEqual(Object.keys(st).sort(), ["capMB", "compassCapMB", "compassMB", "mode", "month", "open", "reopens", "totalMB"])
    assert.equal(st.open, false)
    assert.equal(st.month, "2026-10")
    assert.equal(st.totalMB, 3000)
    assert.equal(st.capMB, 3000)
    assert.equal(st.reopens, "2026-11-01T00:00:00.000Z")
    assert.equal((await fetch(`${t.origin}/api/calendar/list`)).status, 200)
    assert.equal((await fetch(`${t.origin}/`)).status, 200)
  } finally {
    t.close()
  }
})

test("monthly cap: Compass's own WEB_MONTHLY_MB counts what it relayed, across restarts, and a new month opens again", async () => {
  let t0 = Date.parse("2026-10-30T12:00:00Z")
  const now = () => t0
  const db = new Map()
  const make = () => createCounters({ store: memoryUsageStore(db), log: quiet, now })
  const limits = { monthlyBytes: 300 * KB, userDailyBytes: 100 * 1024 * KB }
  const first = await setup({ counters: make(), now, limits })
  try {
    const { sid } = await first.session()
    assert.equal((await first.page(sid, `${first.S}/framable`, { raw: true })).status, 200)
    await (await first.page(sid, `${first.S}/big`, { raw: true })).arrayBuffer()
    await (await first.page(sid, `${first.S}/big`, { raw: true })).arrayBuffer()
    await first.web.counters.flush()
  } finally {
    first.close()
  }
  const second = await setup({ counters: make(), now, limits })
  try {
    const { sid } = await second.session()
    const r = await second.page(sid, `${second.S}/framable`)
    assert.equal(r.status, 503)
    assert.match(await r.text(), /"kind":"monthly"/)
    // November: open again
    t0 = Date.parse("2026-11-01T00:00:01Z")
    const s2 = await second.session()
    assert.equal((await second.page(s2.sid, `${second.S}/framable`)).status, 200)
  } finally {
    second.close()
  }
})
