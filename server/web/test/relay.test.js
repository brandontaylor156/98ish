const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const zlib = require("node:zlib")
const express = require("express")
const { createWeb, siteOf, ipKey, parseAllow, onList, relayMode, GUEST_ALLOW, frameVerdict } = require("..")
const { dayOf } = require("../../meter/counters")

const TOKEN = "a".repeat(48)
const fakeAim = () => {
  const session = { key: "alice", user: { screenName: "Alice" } }
  return { authenticate: (t) => (t === TOKEN ? session : null) }
}

// A small web site on 127.0.0.1, reachable only as site.test / other.test (WEB_TEST_HOSTS)
const startSite = () => {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers, method: req.method })
    const url = new URL(req.url, "http://x")
    const send = (status, headers, body) => {
      res.writeHead(status, headers)
      res.end(body)
    }
    switch (url.pathname) {
      case "/":
        return send(200, { "content-type": "text/html", "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'; script-src 'self'", "set-cookie": ["sid=s1; Path=/; HttpOnly", "theme=blue; Path=/"] }, '<html><head><title>Home</title></head><body><a href="/next">next</a><img src="/pic.png"></body></html>')
      case "/forbidden":
        return send(403, { "content-type": "text/html" }, "<title>Just a moment...</title>")
      case "/framable":
        return send(200, { "content-type": "text/html" }, "<title>ok</title>")
      case "/echo":
        return send(200, { "content-type": "application/json" }, JSON.stringify({ cookie: req.headers.cookie || null, auth: req.headers.authorization || null, xff: req.headers["x-forwarded-for"] || null, referer: req.headers.referer || null, origin: req.headers.origin || null }))
      case "/redirect":
        return send(302, { location: "/framable" }, "")
      case "/to-private":
        return send(302, { location: "http://127.0.0.1:1/secret" }, "")
      case "/to-other":
        return send(302, { location: `http://other.test:${String(req.headers.host).split(":")[1]}/framable` }, "")
      case "/to-app":
        return send(302, { location: "itms-apps://apps.apple.com/app/1" }, "")
      case "/latin1": {
        const body = zlib.gzipSync(Buffer.from("<html><head><title>Caf\xe9</title></head><body>Cr\xe8me</body></html>", "latin1"))
        return send(200, { "content-type": "text/html; charset=windows-1252", "content-encoding": "gzip" }, body)
      }
      case "/style.css":
        return send(200, { "content-type": "text/css" }, "body{background:url(bg.png)}")
      case "/video.mp4":
        return send(200, { "content-type": "video/mp4" }, Buffer.alloc(1000))
      case "/file.zip":
        return send(200, { "content-type": "application/zip", "content-disposition": 'attachment; filename="stuff.zip"' }, Buffer.alloc(500))
      case "/big":
        return send(200, { "content-type": "application/octet-stream", "content-length": String(200 * 1024) }, Buffer.alloc(200 * 1024))
      case "/big-chunked":
        return send(200, { "content-type": "application/octet-stream" }, Buffer.alloc(200 * 1024))
      case "/form":
        if (req.method === "POST") {
          let body = ""
          req.on("data", (c) => (body += c))
          req.on("end", () => send(200, { "content-type": "text/plain" }, `got ${body} origin=${req.headers.origin}`))
          return
        }
        return send(200, { "content-type": "text/plain" }, "form")
      default:
        return send(404, { "content-type": "text/plain" }, "nope")
    }
  })
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, seen })))
}

const setup = async ({ limits = {}, allowGuests = false, guestAllow = ["site.test"], mode = "on" } = {}) => {
  const site = await startSite()
  const web = createWeb({ aim: () => fakeAim(), allowGuests, guestAllow, mode, testHosts: { "site.test": "127.0.0.1", "other.test": "127.0.0.1" }, limits: { waitMs: 2000, ...limits }, secret: "s".repeat(64) })
  const app = express()
  app.use("/api/web", web.router)
  const server = http.createServer(app)
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${server.address().port}/api/web`
  const session = async (headers = { authorization: `Bearer ${TOKEN}` }) => {
    const r = await fetch(`${base}/session`, { method: "POST", headers })
    return { status: r.status, ...(await r.json()) }
  }
  const page = (sid, url, { tok, mode = "f", nav = true, headers = {}, ...init } = {}) => {
    const u = new URL(url)
    const t = tok ?? web.tokFor(sid, siteOf(u.hostname))
    return fetch(`${base}/r/${sid}/${t}/${mode}/${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}`, { redirect: "manual", headers: { ...(nav ? { "sec-fetch-dest": "document" } : { "sec-fetch-dest": "empty" }), ...headers }, ...init })
  }
  const raw = (sid, url, { tok, headers = {}, ...init } = {}) => {
    const u = new URL(url)
    const t = tok ?? web.tokFor(sid, siteOf(u.hostname))
    return fetch(`${base}/x/${sid}/${t}/${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}`, { redirect: "manual", headers, ...init })
  }
  const S = `http://site.test:${site.port}`
  const close = () => {
    web.stop()
    server.close()
    site.server.close()
  }
  return { web, base, session, page, raw, site, S, close }
}

test("a session needs a signed-on account unless guests are allowed", async () => {
  const t = await setup()
  try {
    assert.equal((await t.session({})).status, 401)
    assert.equal((await t.session({ authorization: `Bearer ${"b".repeat(48)}` })).status, 401)
    const s = await t.session()
    assert.equal(s.status, 200)
    assert.match(s.sid, /^[a-f0-9]{32}$/)
    assert.equal(s.guest, false)
    assert.equal(s.name, "Alice")
    // relaying with no session, or a made-up one
    const r = await t.page("f".repeat(32), `${t.S}/`)
    assert.equal(r.status, 401)
    assert.match(await r.text(), /"kind":"expired"/)
  } finally {
    t.close()
  }
  const g = await setup({ allowGuests: true })
  try {
    const s = await g.session({})
    assert.equal(s.status, 200)
    assert.equal(s.guest, true)
  } finally {
    g.close()
  }
})

test("pages: frame-blocking headers go, the helper goes in, sandboxed, cookies stay on the server", async () => {
  const t = await setup()
  try {
    const { sid } = await t.session()
    const r = await t.page(sid, `${t.S}/`)
    assert.equal(r.status, 200)
    assert.equal(r.headers.get("x-frame-options"), null)
    assert.match(r.headers.get("content-security-policy"), /^sandbox allow-scripts/)
    assert.doesNotMatch(r.headers.get("content-security-policy"), /allow-same-origin|frame-ancestors/)
    assert.equal(r.headers.get("set-cookie"), null)
    assert.equal(r.headers.get("referrer-policy"), "no-referrer")
    const html = await r.text()
    assert.match(html, /<head><meta name="referrer" content="no-referrer"><script>\(function compassPage/)
    assert.match(html, new RegExp(`href="http://127\\.0\\.0\\.1:\\d+/api/web/r/${sid}/[a-f0-9]{16}/f/http/site\\.test:${t.site.port}/next"`))
    // the next request to the site carries the cookies from the jar
    const echo = await (await t.raw(sid, `${t.S}/echo`)).json()
    assert.equal(echo.cookie, "sid=s1; theme=blue")
    // page scripts see only the non-HttpOnly one
    assert.match(html, /"cookies":"theme=blue"/)
  } finally {
    t.close()
  }
})

test("direct-assets mode adds <base> with the real address and leaves https assets alone", async () => {
  const t = await setup()
  try {
    const { sid } = await t.session()
    // the test site is http, so its assets still come through the relay (mixed content)
    const html = await (await t.page(sid, `${t.S}/`, { mode: "d" })).text()
    assert.match(html, /src="http:\/\/127\.0\.0\.1:\d+\/api\/web\/r\/[a-f0-9]+\/[a-f0-9]+\/d\/http\/site\.test:\d+\/pic\.png"/)
  } finally {
    t.close()
  }
})

test("cookies are first-party only: another site's token gets none, and a page with the wrong token is redirected", async () => {
  const t = await setup()
  try {
    const { sid } = await t.session()
    await t.page(sid, `${t.S}/`)
    const otherTok = t.web.tokFor(sid, "other.test")
    // a script on other.test asking for site.test: no cookies
    const echo = await (await t.raw(sid, `${t.S}/echo`, { tok: otherTok })).json()
    assert.equal(echo.cookie, null)
    // a page opened with a wrong token is sent to its own
    const r = await t.page(sid, `${t.S}/framable`, { tok: otherTok })
    assert.equal(r.status, 302)
    assert.match(r.headers.get("location"), new RegExp(`/r/${sid}/${t.web.tokFor(sid, "site.test")}/f/http/site\\.test:${t.site.port}/framable$`))
    // a made-up session can't use a token either
    assert.equal((await t.raw("e".repeat(32), `${t.S}/echo`, { tok: t.web.tokFor(sid, "site.test") })).status, 401)
  } finally {
    t.close()
  }
})

test("the person's 98ish cookies, token and address never reach the site", async () => {
  const t = await setup()
  try {
    // (behind Render's proxy the last X-Forwarded-For entry is the person's address)
    const { sid } = await t.session({ authorization: `Bearer ${TOKEN}`, "x-forwarded-for": "1.2.3.4" })
    const echo = await (await t.raw(sid, `${t.S}/echo`, { headers: { cookie: "x=98ish", authorization: `Bearer ${TOKEN}`, "x-forwarded-for": "1.2.3.4" } })).json()
    assert.equal(echo.cookie, null)
    assert.equal(echo.auth, null)
    assert.equal(echo.xff, null)
    assert.equal(echo.referer, `${t.S}/`)
    // a site's own API token (not a 98ish one) passes
    const own = await (await t.raw(sid, `${t.S}/echo`, { headers: { authorization: "Bearer site-api-key", "x-forwarded-for": "1.2.3.4" } })).json()
    assert.equal(own.auth, "Bearer site-api-key")
    const seen = t.site.seen.at(-1).headers
    for (const h of ["cookie", "x-forwarded-for", "sec-fetch-dest", "x-real-ip", "forwarded"]) assert.equal(seen[h], undefined, h)
  } finally {
    t.close()
  }
})

test("redirects come back as relay addresses; a hop to a private address is refused", async () => {
  const t = await setup()
  try {
    const { sid } = await t.session()
    const r = await t.page(sid, `${t.S}/redirect`)
    assert.equal(r.status, 302)
    assert.match(r.headers.get("location"), new RegExp(`/api/web/r/${sid}/[a-f0-9]+/f/http/site\\.test:${t.site.port}/framable$`))
    const hop = await t.page(sid, `${t.S}/to-private`)
    assert.equal(hop.status, 302)
    const next = await fetch(hop.headers.get("location"), { redirect: "manual", headers: { "sec-fetch-dest": "document" } })
    assert.equal(next.status, 302) // wrong site token first...
    const final = await fetch(new URL(next.headers.get("location")), { redirect: "manual", headers: { "sec-fetch-dest": "document" } })
    assert.equal(final.status, 403) // ...then the guard
    assert.match(await final.text(), /"kind":"blocked"/)
    // an app link is offered to the real browser
    const app = await t.page(sid, `${t.S}/to-app`)
    assert.match(await app.text(), /"kind":"app"/)
  } finally {
    t.close()
  }
})

test("SSRF: private addresses, our own server and odd ports are refused", async () => {
  const t = await setup()
  try {
    const { sid } = await t.session()
    for (const url of ["http://127.0.0.1:" + t.site.port + "/", "http://169.254.169.254/latest/meta-data/", "http://localhost/", "http://[::1]/", "http://10.1.2.3/"]) {
      const r = await t.raw(sid, url)
      assert.equal(r.status, 403, url)
    }
    const own = await t.raw(sid, t.base.replace("/api/web", "/"))
    assert.equal(own.status, 403)
    const port = await t.raw(sid, "http://example.com:22/")
    assert.equal(port.status, 403)
  } finally {
    t.close()
  }
})

test("character sets and compression: a gzipped windows-1252 page arrives as UTF-8", async () => {
  const t = await setup()
  try {
    const { sid } = await t.session()
    const r = await t.page(sid, `${t.S}/latin1`, { headers: { "accept-encoding": "gzip" } })
    assert.equal(r.headers.get("content-type"), "text/html; charset=utf-8")
    const html = await r.text()
    assert.match(html, /<title>Café<\/title>/)
    assert.match(html, /Crème/)
  } finally {
    t.close()
  }
})

test("stylesheets through the relay have their url()s rewritten", async () => {
  const t = await setup()
  try {
    const { sid } = await t.session()
    const css = await (await t.page(sid, `${t.S}/style.css`, { nav: false })).text()
    assert.match(css, new RegExp(`url\\("http://127\\.0\\.0\\.1:\\d+/api/web/r/${sid}/[a-f0-9]+/f/http/site\\.test:${t.site.port}/bg\\.png"\\)`))
  } finally {
    t.close()
  }
})

test("video isn't relayed; downloads and big files become Compass pages", async () => {
  const t = await setup({ limits: { maxBytes: 100 * 1024 } })
  try {
    const { sid } = await t.session()
    assert.equal((await t.raw(sid, `${t.S}/video.mp4`)).status, 415)
    assert.match(await (await t.page(sid, `${t.S}/video.mp4`)).text(), /"kind":"media"/)
    const dl = await (await t.page(sid, `${t.S}/file.zip`)).text()
    assert.match(dl, /"kind":"download"/)
    assert.match(dl, /"name":"stuff.zip"/)
    assert.equal((await t.raw(sid, `${t.S}/big`)).status, 413)
    // with no length up front, the stream is cut off at the cap
    const chunked = await t.raw(sid, `${t.S}/big-chunked`)
    await assert.rejects(chunked.arrayBuffer())
    // the raw route hands files over (Save to drive)
    const zip = await t.raw(sid, `${t.S}/file.zip`)
    assert.equal(zip.status, 200)
    assert.match(zip.headers.get("content-disposition"), /stuff\.zip/)
    assert.equal((await zip.arrayBuffer()).byteLength, 500)
  } finally {
    t.close()
  }
})

test("forms post through with the site's own Origin", async () => {
  const t = await setup()
  try {
    const { sid } = await t.session()
    const r = await t.page(sid, `${t.S}/form`, { method: "POST", body: "q=hello", headers: { "content-type": "application/x-www-form-urlencoded" } })
    assert.equal(await r.text(), `got q=hello origin=${t.S}`)
  } finally {
    t.close()
  }
})

test("rate limit per account", async () => {
  const t = await setup({ limits: { perMinute: 3 } })
  try {
    const { sid } = await t.session()
    for (let i = 0; i < 3; i++) assert.equal((await t.raw(sid, `${t.S}/framable`)).status, 200)
    assert.equal((await t.raw(sid, `${t.S}/framable`)).status, 429)
  } finally {
    t.close()
  }
})

test("daily byte budget per account", async () => {
  const t = await setup({ limits: { userDailyBytes: 300 * 1024 } })
  try {
    const { sid } = await t.session()
    const big = await t.raw(sid, `${t.S}/big`)
    await big.arrayBuffer()
    const usage = await (await fetch(`${t.base}/usage?sid=${sid}`)).json()
    assert.ok(usage.used >= 200 * 1024, String(usage.used))
    await (await t.raw(sid, `${t.S}/big`)).arrayBuffer()
    const over = await t.page(sid, `${t.S}/framable`)
    assert.equal(over.status, 429)
    assert.match(await over.text(), /"kind":"budget"/)
  } finally {
    t.close()
  }
})

test("a session is bound to the address that made it", async () => {
  const t = await setup()
  try {
    const { sid } = await (await fetch(`${t.base}/session`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "cf-connecting-ip": "203.0.113.5" } })).json()
    const ok = await t.raw(sid, `${t.S}/framable`, { headers: { "cf-connecting-ip": "203.0.113.5" } })
    assert.equal(ok.status, 200)
    const stolen = await t.raw(sid, `${t.S}/framable`, { headers: { "cf-connecting-ip": "198.51.100.9" } })
    assert.equal(stolen.status, 401)
  } finally {
    t.close()
  }
  assert.deepEqual(ipKey("2001:db8:1:2:3:4:5:6"), { family: 6, key: "2001:db8:1:2" })
})

test("document.cookie from a page: only its own site, never HttpOnly ones", async () => {
  const t = await setup()
  try {
    const { sid } = await t.session()
    await t.page(sid, `${t.S}/`)
    const tok = t.web.tokFor(sid, "site.test")
    const post = (tk, body) => fetch(`${t.base}/c/${sid}/${tk}`, { method: "POST", body: JSON.stringify(body) })
    assert.equal((await post(tok, { url: `${t.S}/`, cookie: "consent=yes; path=/" })).status, 204)
    await post(tok, { url: `${t.S}/`, cookie: "sid=stolen; path=/" })
    assert.equal((await post(tok, { url: `http://other.test:${t.site.port}/`, cookie: "x=1" })).status, 403)
    const echo = await (await t.raw(sid, `${t.S}/echo`)).json()
    assert.equal(echo.cookie, "sid=s1; theme=blue; consent=yes")
  } finally {
    t.close()
  }
})

test("frame check reads only the headers", async () => {
  const t = await setup()
  try {
    const { sid } = await t.session()
    const check = (path) => fetch(`${t.base}/check?sid=${sid}&url=${encodeURIComponent(t.S + path)}`).then((r) => r.json())
    assert.equal((await check("/")).frameable, false)
    const ok = await check("/redirect")
    assert.equal(ok.frameable, true)
    assert.equal(ok.url, `${t.S}/framable`)
    assert.equal((await fetch(`${t.base}/check?sid=${sid}&url=${encodeURIComponent("http://192.168.0.1/")}`).then((r) => r.json())).ok, false)
  } finally {
    t.close()
  }
})

test("site keys approximate eTLD+1", () => {
  assert.equal(siteOf("www.bbc.co.uk"), "bbc.co.uk")
  assert.equal(siteOf("a.b.example.com"), "example.com")
  assert.equal(siteOf("example.com"), "example.com")
  assert.equal(siteOf("news.ycombinator.com:443"), "ycombinator.com")
  assert.equal(siteOf("127.0.0.1"), "127.0.0.1")
})

test("frameVerdict: frame-ancestors wins over X-Frame-Options, like browsers", () => {
  const v = (headers, origin) => frameVerdict(headers, origin).frameable
  assert.equal(v({}), true)
  assert.equal(v({ "x-frame-options": "DENY" }), false)
  assert.equal(v({ "x-frame-options": "sameorigin" }), false)
  assert.equal(v({ "x-frame-options": "ALLOW-FROM https://98ish.vercel.app" }), true) // ignored by browsers
  assert.equal(v({ "x-frame-options": "allowall" }), true)
  assert.equal(v({ "x-frame-options": "DENY, SAMEORIGIN" }), false)
  assert.equal(v({ "content-security-policy": "frame-ancestors 'none'" }), false)
  assert.equal(v({ "content-security-policy": "frame-ancestors 'self'" }), false)
  assert.equal(v({ "content-security-policy": "frame-ancestors *" }), true)
  assert.equal(v({ "content-security-policy": "default-src 'self'; frame-ancestors https:" }), true)
  assert.equal(v({ "content-security-policy": "frame-ancestors https:" }, "http://localhost:5366"), false)
  assert.equal(v({ "content-security-policy": "frame-ancestors 'self' https://98ish.vercel.app" }), true)
  assert.equal(v({ "content-security-policy": "frame-ancestors *.vercel.app" }), true)
  assert.equal(v({ "content-security-policy": "frame-ancestors https://*.neal.fun https://neal.fun" }), false)
  assert.equal(v({ "content-security-policy": "frame-ancestors https://98ish.vercel.app:8443" }), false)
  assert.equal(v({ "content-security-policy": "frame-ancestors http://localhost:5366" }, "http://localhost:5366"), true)
  // frame-ancestors present: X-Frame-Options is ignored
  assert.equal(v({ "content-security-policy": "frame-ancestors *", "x-frame-options": "DENY" }), true)
  // every policy must allow it
  assert.equal(v({ "content-security-policy": ["frame-ancestors *", "frame-ancestors 'none'"] }), false)
  assert.equal(v({ "content-security-policy": "script-src 'self'", "x-frame-options": "DENY" }), false)
  // a CSP without frame-ancestors says nothing about frames
  assert.equal(v({ "content-security-policy": "default-src 'self'" }), true)
})

test("GET /frame: any public site, no session, headers only; the SSRF guard still applies; counted", async () => {
  // allowlist mode with other.test off the list (and the same with the relay off)
  for (const mode of ["allowlist", "off"]) {
    const t = await setup({ allowGuests: true, mode })
    try {
      const OTHER = `http://other.test:${t.site.port}`
      const frame = (url, headers = {}) => fetch(`${t.base}/frame?url=${encodeURIComponent(url)}`, { headers }).then(async (r) => ({ status: r.status, headers: r.headers, ...(await r.json()) }))
      const seenBefore = t.site.seen.length
      const ok = await frame(`${OTHER}/framable`)
      assert.equal(ok.ok, true, mode)
      assert.equal(ok.frameable, true)
      assert.equal(ok.url, `${OTHER}/framable`)
      assert.deepEqual(Object.keys(ok).sort(), ["by", "frameable", "headers", "https", "ok", "status", "type", "url"].sort())
      assert.equal(ok.headers.get("content-security-policy"), "sandbox")
      // nothing of the page comes back
      assert.ok(!JSON.stringify(ok).includes("<title>"))
      assert.equal(t.site.seen.length, seenBefore + 1)
      // cached: no second request to the site
      await frame(`${OTHER}/framable`)
      assert.equal(t.site.seen.length, seenBefore + 1)
      assert.equal((await frame(`${OTHER}/`)).frameable, false)
      assert.equal((await frame(`${OTHER}/`)).by, "csp")
      const redirected = await frame(`${OTHER}/redirect`)
      assert.equal(redirected.frameable, true)
      assert.equal(redirected.url, `${OTHER}/framable`)
      // a bot check / forbidden page isn't shown live; a plain 404 is
      assert.equal((await frame(`${OTHER}/forbidden`)).frameable, false)
      assert.equal((await frame(`${OTHER}/forbidden`)).by, "status")
      assert.equal((await frame(`${OTHER}/missing`)).frameable, true)
      // the guard: private addresses, redirects to them, odd ports, our own hosts
      const before = t.site.seen.length
      for (const url of ["http://192.168.0.1/", "http://127.0.0.1:1/", "http://localhost/", "https://98ish.vercel.app/", "https://nine8ish.onrender.com/api/web/session", "file:///etc/passwd", `http://user:pw@other.test:${t.site.port}/`]) {
        const r = await frame(url)
        assert.equal(r.ok, false, url)
        assert.equal(r.frameable, undefined, url)
      }
      assert.equal(t.site.seen.length, before)
      const hop = await frame(`${OTHER}/to-private`)
      assert.equal(hop.ok, false)
      // counted (tiny) in the relay's totals
      const day = dayOf(Date.now())
      await t.web.counters.ensure([["day", "frames", day], ["day", "relay", day]])
      const n = t.web.counters.value("day", "frames", day)
      assert.ok(n > 600 * 4 && n < 600 * 4 + 4000, String(n))
      assert.equal(t.web.counters.value("day", "relay", day), n)
    } finally {
      t.close()
    }
  }
})

test("GET /frame: frame-ancestors are matched against the asking 98ish page; rate limited; can be turned off", async () => {
  const t = await setup({ limits: { checksPerMinute: 3 } })
  try {
    const frame = (path, headers = {}) => fetch(`${t.base}/frame?url=${encodeURIComponent(t.S + path)}`, { headers }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
    for (const p of ["/framable", "/redirect", "/missing"]) assert.equal((await frame(p)).ok, true)
    const limited = await frame("/forbidden")
    assert.equal(limited.status, 429)
  } finally {
    t.close()
  }
  const site = await (async () => {
    const s = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html", "content-security-policy": "frame-ancestors https://98ish.vercel.app" })
      res.end("x")
    })
    await new Promise((r) => s.listen(0, "127.0.0.1", r))
    return s
  })()
  const web = createWeb({ aim: () => fakeAim(), testHosts: { "pick.test": "127.0.0.1" }, secret: "s".repeat(64) })
  const app = express()
  app.use("/api/web", web.router)
  const server = http.createServer(app)
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  try {
    const url = `http://pick.test:${site.address().port}/`
    const ask = (origin) => fetch(`http://127.0.0.1:${server.address().port}/api/web/frame?url=${encodeURIComponent(url)}`, { headers: origin ? { origin } : {} }).then((r) => r.json())
    assert.equal((await ask("https://98ish.vercel.app")).frameable, true)
    assert.equal((await ask("http://localhost:5366")).frameable, false)
    assert.equal((await ask(null)).frameable, true) // no Origin: 98ish itself
  } finally {
    web.stop()
    server.close()
    site.close()
  }
  const off = createWeb({ aim: () => fakeAim(), frameCheck: false, testHosts: { "site.test": "127.0.0.1" }, secret: "s".repeat(64) })
  const app2 = express()
  app2.use("/api/web", off.router)
  const server2 = http.createServer(app2)
  await new Promise((r) => server2.listen(0, "127.0.0.1", r))
  try {
    const r = await fetch(`http://127.0.0.1:${server2.address().port}/api/web/frame?url=${encodeURIComponent("https://example.com/")}`).then((x) => x.json())
    assert.equal(r.ok, false)
  } finally {
    off.stop()
    server2.close()
  }
})

// ---------- guests: the allowlist, by address ----------

test("guest allowlist: defaults, WEB_GUEST_ALLOW parsing, subdomain matching, WEB_RELAY modes", () => {
  assert.ok(GUEST_ALLOW.includes("wikipedia.org") && GUEST_ALLOW.includes("wikimedia.org"))
  assert.ok(!GUEST_ALLOW.some((d) => /archive\.org|98ish/.test(d)))
  assert.deepEqual(parseAllow(undefined), GUEST_ALLOW)
  assert.deepEqual(parseAllow(""), GUEST_ALLOW)
  assert.deepEqual(parseAllow("none"), [])
  assert.deepEqual(parseAllow(" Example.ORG, *.wikipedia.org , .osm.org. "), ["example.org", "wikipedia.org", "osm.org"])
  assert.ok(onList("en.wikipedia.org", GUEST_ALLOW))
  assert.ok(onList("upload.wikimedia.org.", GUEST_ALLOW))
  assert.ok(onList("wikipedia.org", GUEST_ALLOW))
  assert.ok(!onList("notwikipedia.org", GUEST_ALLOW))
  assert.ok(!onList("wikipedia.org.evil.com", GUEST_ALLOW))
  assert.ok(!onList("web.archive.org", GUEST_ALLOW))
  // the code default is "on" (production needs no env var); anything unknown is the allowlist
  assert.equal(relayMode(undefined), "on")
  assert.equal(relayMode(""), "on")
  assert.equal(relayMode("typo"), "allowlist")
  assert.equal(relayMode("on"), "on")
  assert.equal(relayMode("1"), "on")
  assert.equal(relayMode("0"), "off")
  assert.equal(relayMode("OFF"), "off")
  assert.equal(relayMode("allowlist"), "allowlist")
})

test("guests get a session (no sign-on) that lists the sites they may open; WEB_GUESTS=0 refuses them", async () => {
  const t = await setup({ allowGuests: true })
  try {
    const g = await t.session({})
    assert.equal(g.status, 200)
    assert.equal(g.guest, true)
    assert.deepEqual(g.allow, ["site.test"])
    const m = await t.session()
    assert.equal(m.guest, false)
    assert.equal(m.allow, null)
  } finally {
    t.close()
  }
  const n = await setup({ allowGuests: false })
  try {
    const g = await n.session({})
    assert.equal(g.status, 401)
    assert.equal(g.signOn, true)
  } finally {
    n.close()
  }
})

test("guests: an allowlisted host loads; another host is refused with a sign-on prompt, before anything is fetched", async () => {
  const t = await setup({ allowGuests: true })
  try {
    const { sid } = await t.session({})
    const ok = await t.page(sid, `${t.S}/`)
    assert.equal(ok.status, 200)
    assert.match(await ok.text(), /<title>Home<\/title>/)
    const before = t.site.seen.length
    const other = `http://other.test:${t.site.port}/framable`
    // a page: the Compass sign-on stub
    const nav = await t.page(sid, other)
    assert.equal(nav.status, 401)
    const body = await nav.text()
    assert.match(body, /"kind":"signon"/)
    assert.match(body, /Sign on with your 98 Messenger screen name to browse other sites/)
    // a subresource or a script's own request: refused too
    const sub = await t.page(sid, other, { nav: false })
    assert.equal(sub.status, 401)
    assert.equal(sub.headers.get("content-security-policy"), "sandbox")
    assert.equal((await t.raw(sid, other)).status, 401)
    assert.equal((await t.raw(sid, other, { method: "POST", body: "a=1" })).status, 401)
    assert.equal(t.site.seen.length, before, "nothing was fetched from the other host")
    // a signed-on account may open it
    const m = await t.session()
    assert.equal((await t.page(m.sid, other)).status, 200)
  } finally {
    t.close()
  }
})

test("guests: a redirect from an allowlisted host to another host is refused (relay and frame check)", async () => {
  const t = await setup({ allowGuests: true })
  try {
    const { sid } = await t.session({})
    const before = t.site.seen.filter((s) => s.url === "/framable").length
    const nav = await t.page(sid, `${t.S}/to-other`)
    assert.equal(nav.status, 401)
    const body = await nav.text()
    assert.match(body, /"kind":"signon"/)
    assert.match(body, /other\.test/) // the stub names where the redirect wanted to go
    const sub = await t.raw(sid, `${t.S}/to-other`)
    assert.equal(sub.status, 401)
    // the frame check follows redirects itself: each hop is checked against the allowlist
    const check = await (await fetch(`${t.base}/check?sid=${sid}&url=${encodeURIComponent(`${t.S}/to-other`)}`)).json()
    assert.equal(check.ok, false)
    assert.equal(check.notAllowed, true)
    const direct = await (await fetch(`${t.base}/check?sid=${sid}&url=${encodeURIComponent(`http://other.test:${t.site.port}/framable`)}`)).json()
    assert.equal(direct.ok, false)
    assert.equal(direct.signOn, true)
    assert.equal(t.site.seen.filter((s) => s.url === "/framable").length, before, "other.test was never fetched")
    // a member follows the same redirect
    const m = await t.session()
    const ok = await t.page(m.sid, `${t.S}/to-other`)
    assert.equal(ok.status, 302)
    assert.match(ok.headers.get("location"), /\/http\/other\.test:\d+\/framable$/)
  } finally {
    t.close()
  }
})

test("guests are rate limited by address, across their sessions", async () => {
  const t = await setup({ allowGuests: true, limits: { guestPerMinute: 3 } })
  try {
    const a = { "cf-connecting-ip": "203.0.113.7" }
    const s1 = await t.session(a)
    const s2 = await t.session(a)
    assert.notEqual(s1.sid, s2.sid)
    assert.equal((await t.raw(s1.sid, `${t.S}/framable`, { headers: a })).status, 200)
    assert.equal((await t.raw(s2.sid, `${t.S}/framable`, { headers: a })).status, 200)
    assert.equal((await t.raw(s1.sid, `${t.S}/framable`, { headers: a })).status, 200)
    // a new session from the same address doesn't reset it
    const s3 = await t.session(a)
    assert.equal((await t.raw(s3.sid, `${t.S}/framable`, { headers: a })).status, 429)
    // another address has its own allowance
    const b = { "cf-connecting-ip": "198.51.100.20" }
    const other = await t.session(b)
    assert.equal((await t.raw(other.sid, `${t.S}/framable`, { headers: b })).status, 200)
  } finally {
    t.close()
  }
})

test("guests: a daily byte budget per address and for all guests together", async () => {
  const t = await setup({ allowGuests: true, limits: { guestDailyBytes: 150 * 1024, guestsDailyBytes: 300 * 1024 } })
  try {
    const a = { "cf-connecting-ip": "203.0.113.8" }
    const s = await t.session(a)
    await (await t.raw(s.sid, `${t.S}/big`, { headers: a })).arrayBuffer()
    assert.equal((await t.raw(s.sid, `${t.S}/framable`, { headers: a })).status, 429)
    const b = { "cf-connecting-ip": "203.0.113.9" }
    const s2 = await t.session(b)
    await (await t.raw(s2.sid, `${t.S}/big`, { headers: b })).arrayBuffer()
    // 400 KB used by guests: a third guest address is over the all-guests budget
    const c = { "cf-connecting-ip": "203.0.113.10" }
    const s3 = await t.session(c)
    assert.equal((await t.raw(s3.sid, `${t.S}/framable`, { headers: c })).status, 429)
    // members aren't affected
    const m = await t.session()
    assert.equal((await t.raw(m.sid, `${t.S}/framable`)).status, 200)
  } finally {
    t.close()
  }
})

test("WEB_RELAY=allowlist limits members too; WEB_RELAY=0 turns the relay off", async () => {
  const t = await setup({ allowGuests: true, mode: "allowlist" })
  try {
    const m = await t.session()
    assert.deepEqual(m.allow, ["site.test"])
    assert.equal((await t.page(m.sid, `${t.S}/`)).status, 200)
    const r = await t.page(m.sid, `http://other.test:${t.site.port}/framable`)
    assert.equal(r.status, 403)
    assert.match(await r.text(), /"kind":"notallowed"/)
  } finally {
    t.close()
  }
  const off = await setup({ allowGuests: true, mode: "off" })
  try {
    const s = await off.session()
    assert.equal(s.status, 503)
    assert.equal(s.off, true)
    const r = await off.page("f".repeat(32), `${off.S}/`)
    assert.equal(r.status, 503)
  } finally {
    off.close()
  }
})

test("anything shaped like a 98ish token is never forwarded, valid or not", async () => {
  const t = await setup()
  try {
    const { sid } = await t.session()
    const echo = await (await t.raw(sid, `${t.S}/echo`, { headers: { authorization: `Bearer ${"c".repeat(48)}` } })).json()
    assert.equal(echo.auth, null)
  } finally {
    t.close()
  }
})

test("the 98ish sites themselves are never fetched", async () => {
  const t = await setup()
  try {
    const { sid } = await t.session()
    for (const url of ["https://98ish.vercel.app/", "https://nine8ish.onrender.com/api/web/session"]) assert.equal((await t.raw(sid, url)).status, 403, url)
  } finally {
    t.close()
  }
})
