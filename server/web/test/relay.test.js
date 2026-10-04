const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const zlib = require("node:zlib")
const express = require("express")
const { createWeb, siteOf, ipKey } = require("..")

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
      case "/framable":
        return send(200, { "content-type": "text/html" }, "<title>ok</title>")
      case "/echo":
        return send(200, { "content-type": "application/json" }, JSON.stringify({ cookie: req.headers.cookie || null, auth: req.headers.authorization || null, xff: req.headers["x-forwarded-for"] || null, referer: req.headers.referer || null, origin: req.headers.origin || null }))
      case "/redirect":
        return send(302, { location: "/framable" }, "")
      case "/to-private":
        return send(302, { location: "http://127.0.0.1:1/secret" }, "")
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

const setup = async ({ limits = {}, allowGuests = false } = {}) => {
  const site = await startSite()
  const web = createWeb({ aim: () => fakeAim(), allowGuests, testHosts: { "site.test": "127.0.0.1", "other.test": "127.0.0.1" }, limits: { waitMs: 2000, ...limits }, secret: "s".repeat(64) })
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

test("CORS: relayed pages (Origin: null) may call the relay with credentials", async () => {
  const t = await setup()
  try {
    const r = await fetch(`${t.base}/x/whatever`, { method: "OPTIONS", headers: { origin: "null", "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-csrf" } })
    assert.equal(r.status, 204)
    assert.equal(r.headers.get("access-control-allow-origin"), "null")
    assert.equal(r.headers.get("access-control-allow-credentials"), "true")
    assert.equal(r.headers.get("access-control-allow-headers"), "content-type,x-csrf")
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
