const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const express = require("express")
const hp = require("../homepages")
const gb = require("../guestbook")

// A 1x1 PNG, and a fake 98 Messenger with two signed-on users
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
const TOKENS = { a: "a".repeat(48), b: "b".repeat(48) }
const fakeAim = () => {
  const sessions = new Map([
    ["webmasterdan", { key: "webmasterdan", user: { screenName: "Webmaster Dan", blocked: [] } }],
    ["surfergirl", { key: "surfergirl", user: { screenName: "Surfer Girl", blocked: [] } }],
  ])
  const byToken = { [TOKENS.a]: "webmasterdan", [TOKENS.b]: "surfergirl" }
  return { sessions, authenticate: (token) => sessions.get(byToken[token]) || null, store: { find: async () => null } }
}

const page = (blocks, extra = {}) => ({ title: "Dan's Cool Page", bg: "stars", font: "comic", sparkle: true, badge: true, music: "highway", blocks, ...extra })
const good = [
  { type: "heading", text: "Welcome to my page!!", size: "h1", effect: "rainbow" },
  { type: "paragraph", text: "I like *Minesweeper* and _Tetris_.\nThanks for visiting!", bold: true, color: "#FF00FF" },
  { type: "marquee", text: "Under construction forever", speed: "fast" },
  { type: "blink", text: "NEW!" },
  { type: "image", art: "globe" },
  { type: "image", src: PNG, alt: "a dot" },
  { type: "divider", style: "rainbow" },
  { type: "links", title: "Cool links", items: [{ label: "Yahoo!", url: "www.yahoo.com" }, { label: "The guestbook", url: "http://www.98ish.com/guestbook" }] },
  { type: "counter" },
  { type: "guestbook", style: "button" },
  { type: "webring" },
]

test("a page with every kind of block validates and is normalized", () => {
  const r = hp.validatePage(page(good))
  assert.ok(r.ok, r.error)
  assert.equal(r.page.blocks.length, good.length)
  assert.equal(r.page.blocks[1].color, "#ff00ff")
  assert.equal(r.page.blocks[7].items[0].url, "http://www.yahoo.com/")
  assert.equal(r.page.music, "highway")
  assert.equal(r.page.bgColor, "#000033") // defaults filled in
  // unknown fields are dropped
  const extra = hp.validatePage(page([{ type: "blink", text: "hi", onclick: "alert(1)", style: "x" }]))
  assert.deepEqual(Object.keys(extra.page.blocks[0]).sort(), ["align", "color", "text", "type"])
})

test("rejects unknown blocks, bad colors and settings", () => {
  assert.equal(hp.validatePage(page([{ type: "script", text: "alert(1)" }])).ok, false)
  assert.equal(hp.validatePage(page([{ type: "html", html: "<b>x</b>" }])).ok, false)
  assert.equal(hp.validatePage(page([{ type: "heading", text: "hi", color: "red; background:url(x)" }])).ok, false)
  assert.equal(hp.validatePage(page([], { text: "expression(alert(1))" })).ok, false)
  assert.equal(hp.validatePage(page([], { music: "not-a-song" })).ok, false)
  assert.equal(hp.validatePage(page([{ type: "image", art: "evil" }])).ok, false)
  assert.equal(hp.validatePage({ title: "x" }).ok, false)
  assert.equal(hp.validatePage(page([], { title: "" })).ok, false)
  assert.equal(hp.validatePage(page(Array(61).fill({ type: "divider" }))).ok, false)
  // unknown values in a pick list fall back to a default instead
  assert.equal(hp.validatePage(page([], { bg: "javascript" })).page.bg, "stars")
})

test("rejects HTML, links and bad words in text", () => {
  for (const text of ["<script>alert(1)</script>", "hello <img src=x onerror=alert(1)>", "<b>bold</b>", "visit www.spam.com", "go to http://x.ru now", "this is shit"]) {
    assert.equal(hp.validatePage(page([{ type: "paragraph", text }])).ok, false, text)
  }
  assert.equal(hp.validatePage(page([{ type: "heading", text: "<h1>big</h1>" }])).ok, false)
  assert.ok(hp.validatePage(page([{ type: "paragraph", text: "3 < 4 and 5 > 2, cool :->" }])).ok)
  assert.equal(hp.validatePage(page([{ type: "paragraph", text: "x".repeat(2001) }])).ok, false)
})

test("link lists allow only http(s) addresses", () => {
  const links = (url) => hp.validatePage(page([{ type: "links", items: [{ label: "Link", url }] }]))
  for (const url of ["javascript:alert(1)", "data:text/html,<script>", "ftp://example.com/", "http://user:pw@example.com/", "file:///etc/passwd", "http://localhost/", "vbscript:x", "//example.com"]) {
    assert.equal(links(url).ok, false, url)
  }
  assert.ok(links("https://www.example.com/page?q=1").ok)
  assert.ok(links("http://www.98ish.com/~surfergirl").ok)
  assert.equal(hp.validatePage(page([{ type: "links", items: [] }])).ok, false)
})

test("pictures must be real images under the size caps", () => {
  const img = (src) => hp.validatePage(page([{ type: "image", src }]))
  assert.ok(img(PNG).ok)
  assert.equal(img("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=").ok, false)
  assert.equal(img("data:text/html;base64,PHNjcmlwdD4=").ok, false)
  assert.equal(img("javascript:alert(1)").ok, false)
  assert.equal(img("http://example.com/x.png").ok, false)
  // says PNG but isn't one
  assert.equal(img(`data:image/png;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`).ok, false)
  // too big
  const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(hp.MAX_IMAGE_BYTES)])
  assert.equal(img(`data:image/png;base64,${big.toString("base64")}`).ok, false)
  // the whole page has a cap too: 3 pictures of 140 KB (as base64) are over 500 KB
  const pic = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(140 * 1024)]).toString("base64")}`
  const r = hp.validatePage(page(Array(3).fill({ type: "image", src: pic })))
  assert.equal(r.ok, false)
  assert.match(r.error, /too big/)
})

const serve = (router) => {
  const app = express()
  app.use("/api", router)
  app.use("/api", gb.guestbookRouter({ store: gb.memoryStore() }))
  const server = http.createServer(app).listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api`
  const call = (method, path, body, token, headers = {}) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
  return { server, call }
}

test("publishing needs a signed-on user; viewing doesn't", async () => {
  const router = hp.homepageRouter({ store: hp.memoryStore(), aim: fakeAim() })
  const { server, call } = serve(router)
  try {
    assert.equal((await call("PUT", "/homepage", { page: page(good) })).status, 401)
    assert.equal((await call("PUT", "/homepage", { page: page(good) }, "c".repeat(48))).status, 401)
    assert.equal((await call("PUT", "/homepage", { page: page(good) }, "not a token")).status, 401)
    assert.equal((await call("DELETE", "/homepage")).status, 401)
    assert.equal((await call("GET", "/homepage")).status, 401)

    const r = await call("PUT", "/homepage", { page: page(good) }, TOKENS.a)
    assert.equal(r.status, 200, r.error)
    assert.equal(r.url, "http://www.98ish.com/~webmasterdan")
    const bad = await call("PUT", "/homepage", { page: page([{ type: "paragraph", text: "<script>x</script>" }]) }, TOKENS.a)
    assert.equal(bad.status, 400)

    const view = await call("GET", "/homepages/webmasterdan")
    assert.equal(view.status, 200)
    assert.equal(view.screenName, "Webmaster Dan")
    assert.equal(view.page.blocks.length, good.length)
    assert.equal((await call("GET", "/homepages/WebmasterDan")).status, 200)
    assert.equal((await call("GET", "/homepages/nobodyhere")).status, 404)
    assert.equal((await call("GET", "/homepages/..%2f..")).status, 404)

    // each user only ever writes their own page
    assert.equal((await call("GET", "/homepage", undefined, TOKENS.b)).published, null)
    assert.equal((await call("DELETE", "/homepage", undefined, TOKENS.b)).removed, false)
    assert.equal((await call("GET", "/homepages/webmasterdan")).status, 200)
    assert.equal((await call("DELETE", "/homepage", undefined, TOKENS.a)).removed, true)
    assert.equal((await call("GET", "/homepages/webmasterdan")).status, 404)
  } finally {
    server.close()
  }
})

test("oversized bodies get a friendly error, even with the guestbook mounted after", async () => {
  const router = hp.homepageRouter({ store: hp.memoryStore(), aim: fakeAim() })
  const { server, call } = serve(router)
  try {
    const huge = page([{ type: "paragraph", text: "x".repeat(700 * 1024) }])
    const r = await call("PUT", "/homepage", { page: huge }, TOKENS.a)
    assert.equal(r.status, 413)
    assert.match(r.error, /too big/)
    // a picture-heavy page just under the parser limit but over the page cap
    const pic = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(140 * 1024)]).toString("base64")}`
    const r2 = await call("PUT", "/homepage", { page: page(Array(3).fill({ type: "image", src: pic })) }, TOKENS.a)
    assert.equal(r2.status, 400)
  } finally {
    server.close()
  }
})

test("publishes are rate limited per user", async () => {
  const router = hp.homepageRouter({ store: hp.memoryStore(), aim: fakeAim(), limits: { publishesPerMinute: 3 } })
  const { server, call } = serve(router)
  try {
    for (let i = 0; i < 3; i++) assert.equal((await call("PUT", "/homepage", { page: page(good) }, TOKENS.a)).status, 200)
    const r = await call("PUT", "/homepage", { page: page(good) }, TOKENS.a)
    assert.equal(r.status, 429)
    // someone else isn't affected
    assert.equal((await call("PUT", "/homepage", { page: page(good, { title: "Surf's Up" }) }, TOKENS.b)).status, 200)
  } finally {
    server.close()
  }
})

test("hit counters count each visitor once and skip the owner", async () => {
  const router = hp.homepageRouter({ store: hp.memoryStore(), aim: fakeAim() })
  const { server, call } = serve(router)
  try {
    await call("PUT", "/homepage", { page: page(good) }, TOKENS.a)
    assert.equal((await call("POST", "/homepages/webmasterdan/hit", { visitor: "visitor0001" }, TOKENS.a)).count, 0)
    assert.equal((await call("POST", "/homepages/webmasterdan/hit", { visitor: "visitor0002" })).count, 1)
    assert.equal((await call("POST", "/homepages/webmasterdan/hit", { visitor: "visitor0002" })).count, 1)
    assert.equal((await call("POST", "/homepages/webmasterdan/hit", { visitor: "visitor0003" }, TOKENS.b)).count, 2)
    assert.equal((await call("POST", "/homepages/nobodyhere/hit", {})).status, 404)
    // republishing keeps the count
    await call("PUT", "/homepage", { page: page(good, { title: "Dan's Page v2" }) }, TOKENS.a)
    assert.equal((await call("GET", "/homepages/webmasterdan")).hits, 2)
  } finally {
    server.close()
  }
})

test("the members directory and the web ring list published pages", async () => {
  const router = hp.homepageRouter({ store: hp.memoryStore(), aim: fakeAim() })
  const { server, call } = serve(router)
  try {
    assert.deepEqual((await call("GET", "/ring")).members, [])
    await call("PUT", "/homepage", { page: page(good) }, TOKENS.a)
    await new Promise((r) => setTimeout(r, 5))
    await call("PUT", "/homepage", { page: page(good, { title: "Surf's Up" }) }, TOKENS.b)
    await call("POST", "/homepages/webmasterdan/hit", { visitor: "visitor0009" })

    const newest = await call("GET", "/homepages?sort=newest")
    assert.equal(newest.total, 2)
    assert.deepEqual(newest.members.map((m) => m.key), ["surfergirl", "webmasterdan"])
    assert.equal(newest.members[0].title, "Surf's Up")
    assert.equal(newest.members[0].page, undefined) // the directory doesn't send whole pages
    const popular = await call("GET", "/homepages?sort=popular")
    assert.deepEqual(popular.members.map((m) => m.key), ["webmasterdan", "surfergirl"])
    assert.equal(popular.members[0].hits, 1)

    const ring = await call("GET", "/ring")
    assert.deepEqual(ring.members.map((m) => m.path), ["/~webmasterdan", "/~surfergirl"])
    assert.equal(ring.members[1].title, "Surf's Up")
    await call("DELETE", "/homepage", undefined, TOKENS.a)
    assert.deepEqual((await call("GET", "/ring")).members.map((m) => m.path), ["/~surfergirl"])
  } finally {
    server.close()
  }
})

test("the guestbook still works with the homepage router in front", async () => {
  const router = hp.homepageRouter({ store: hp.memoryStore(), aim: fakeAim() })
  const { server, call } = serve(router)
  try {
    const r = await call("POST", "/hits/guestbook")
    assert.equal(r.status, 200)
    assert.equal(r.count, 1)
    const signed = await call("POST", "/guestbook", { name: "Dan", message: "Nice site!", mood: "cool" })
    assert.equal(signed.status, 200, signed.error)
  } finally {
    server.close()
  }
})
