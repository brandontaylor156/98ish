// Compass's "true internet" safeguards: the code default is WEB_RELAY=on (signed-on accounts
// anywhere, guests the allowlist), the caps fall back instead of shutting off, the blocklist,
// "Report This Page", the 7-day log (account, host, bytes, day only) and erasing an account.
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const express = require("express")
const { createWeb, siteOf, relayMode } = require("..")
const { blockedSite, parseHosts } = require("../blocklist")
const { createRecords, memoryRecordsStore, logExpiry } = require("../records")
const { createCounters, memoryUsageStore, dayOf } = require("../../meter/counters")

const TOKENS = { ["a".repeat(48)]: { key: "alice", user: { screenName: "Alice" } }, ["b".repeat(48)]: { key: "bob", user: { screenName: "Bob" } } }
const ALICE = { authorization: `Bearer ${"a".repeat(48)}` }
const BOB = { authorization: `Bearer ${"b".repeat(48)}` }
const fakeAim = () => ({ authenticate: (t) => TOKENS[t] || null })
const quiet = { warn: () => {}, error: () => {} }

const startSite = () => {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, host: req.headers.host })
    const url = new URL(req.url, "http://x")
    const port = String(req.headers.host).split(":")[1]
    if (url.pathname === "/to-blocked") return res.writeHead(302, { location: `http://blocked.test:${port}/` }).end()
    if (url.pathname === "/cf") return res.writeHead(403, { "content-type": "text/html", "cf-mitigated": "challenge" }).end("<html><head><title>Just a moment...</title></head><body>checking</body></html>")
    if (url.pathname === "/walled") return res.writeHead(403, { "content-type": "text/html" }).end("<html><head><title>Access Denied</title></head></html>")
    if (url.pathname === "/missing") return res.writeHead(404, { "content-type": "text/html" }).end("<html><head><title>Not Found</title></head><body>nope</body></html>")
    if (url.pathname === "/big") return res.writeHead(200, { "content-type": "application/octet-stream" }).end(Buffer.alloc(100 * 1024))
    res.writeHead(200, { "content-type": "text/html", "x-frame-options": "DENY" })
    res.end(`<html><head><title>${url.pathname}</title></head><body><a href="/next?secret=1">next</a></body></html>`)
  })
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, seen })))
}

const setup = async ({ mode, limits = {}, now, data = new Map(), records, blockHosts = ["blocked.test"], allowGuests = true } = {}) => {
  const site = await startSite()
  const counters = createCounters({ store: memoryUsageStore(data), log: quiet, ...(now ? { now } : {}) })
  const recs = records || createRecords({ store: memoryRecordsStore(), log: quiet, ...(now ? { now } : {}) })
  const web = createWeb({
    aim: fakeAim,
    allowGuests,
    guestAllow: ["site.test"],
    ...(mode ? { mode } : {}),
    testHosts: { "site.test": "127.0.0.1", "other.test": "127.0.0.1", "blocked.test": "127.0.0.1", "www.pornhub.com": "127.0.0.1" },
    limits: { waitMs: 2000, ...limits },
    secret: "s".repeat(64),
    counters,
    records: recs,
    blockHosts,
    ...(now ? { now } : {}),
  })
  const app = express()
  app.use("/api/web", web.router)
  const server = http.createServer(app)
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${server.address().port}/api/web`
  const session = async (headers = ALICE) => {
    const r = await fetch(`${base}/session`, { method: "POST", headers })
    return { status: r.status, ...(await r.json()) }
  }
  const page = (sid, url, { headers = {}, nav = true } = {}) => {
    const u = new URL(url)
    return fetch(`${base}/r/${sid}/${web.tokFor(sid, siteOf(u.hostname))}/d/${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}`, { redirect: "manual", headers: { "sec-fetch-dest": nav ? "document" : "empty", ...headers } })
  }
  const report = (body, headers = {}) => fetch(`${base}/report`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
  const at = (host) => `http://${host}:${site.port}`
  const close = () => {
    web.stop()
    counters.stop()
    recs.stop()
    server.close()
    site.server.close()
  }
  return { web, base, session, page, report, site, at, counters, records: recs, data, close }
}

test("the code default is WEB_RELAY=on: unset means on, 'allowlist' and '0' still switch", async () => {
  assert.equal(relayMode(undefined), "on")
  assert.equal(relayMode(" "), "on")
  assert.equal(relayMode("allowlist"), "allowlist")
  assert.equal(relayMode("0"), "off")
  assert.equal(relayMode("off"), "off")
  assert.equal(relayMode("tpyo"), "allowlist")
  const saved = process.env.WEB_RELAY
  delete process.env.WEB_RELAY
  const t = await setup() // no mode option: from the (unset) environment
  try {
    assert.equal(t.web.status().mode, "on")
    assert.equal((await t.session()).mode, "on")
  } finally {
    t.close()
    if (saved !== undefined) process.env.WEB_RELAY = saved
  }
})

test("routing: signed on = any public site live; a guest = the allowlist, other sites a sign-on stub", async () => {
  const t = await setup({ mode: "on" })
  try {
    const member = await t.session()
    assert.equal(member.guest, false)
    assert.equal(member.allow, null)
    const live = await t.page(member.sid, `${t.at("other.test")}/news`)
    assert.equal(live.status, 200)
    assert.match(await live.text(), /<title>\/news<\/title>/)

    const guest = await t.session({})
    assert.equal(guest.guest, true)
    assert.deepEqual(guest.allow, ["site.test"])
    assert.equal((await t.page(guest.sid, `${t.at("site.test")}/`)).status, 200)
    const before = t.site.seen.length
    const refused = await t.page(guest.sid, `${t.at("other.test")}/news`)
    assert.equal(refused.status, 401)
    assert.match(await refused.text(), /"kind":"signon"/)
    assert.equal(t.site.seen.length, before, "the other site was never asked")
    // the default per-account day is 25 MB
    assert.equal(member.limit, 25 * 1024 * 1024)
  } finally {
    t.close()
  }
})

test("caps: a used-up day or month never shuts Compass: the session says when live browsing resumes", async () => {
  let clock = Date.parse("2026-10-20T15:00:00Z")
  const now = () => clock
  // an account's day
  const t = await setup({ mode: "on", now, limits: { userDailyBytes: 50 * 1024 } })
  try {
    const s = await t.session()
    assert.equal(s.dayFull, false)
    assert.equal(s.resumes, null)
    await (await t.page(s.sid, `${t.at("other.test")}/big`, { nav: false })).arrayBuffer()
    const r = await t.page(s.sid, `${t.at("other.test")}/`)
    assert.equal(r.status, 429)
    const stub = await r.text()
    assert.match(stub, /"kind":"budget"/)
    assert.match(stub, /Live browsing resumes tomorrow/)
    assert.match(stub, /"reopens":"2026-10-21T00:00:00.000Z"/)
    const usage = await (await fetch(`${t.base}/usage?sid=${s.sid}`)).json()
    assert.equal(usage.dayFull, true)
    assert.equal(usage.resumes, "2026-10-21T00:00:00.000Z")
    // bob's own day is untouched
    const b = await t.session(BOB)
    assert.equal(b.dayFull, false)
    assert.equal((await t.page(b.sid, `${t.at("other.test")}/`)).status, 200)
    // the next day it's live again
    clock += 24 * 3600 * 1000
    const next = await t.session()
    assert.equal(next.dayFull, false)
    assert.equal((await t.page(next.sid, `${t.at("other.test")}/`)).status, 200)
  } finally {
    t.close()
  }
  // the whole relay's day
  const g = await setup({ mode: "on", now, limits: { globalDailyBytes: 50 * 1024 } })
  try {
    const s = await g.session()
    await (await g.page(s.sid, `${g.at("other.test")}/big`, { nav: false })).arrayBuffer()
    const b = await g.session(BOB)
    assert.equal(b.dayFull, true)
    assert.match(await (await g.page(b.sid, `${g.at("other.test")}/`)).text(), /"kind":"budget"/)
  } finally {
    g.close()
  }
  // Compass's month
  const m = await setup({ mode: "on", now, limits: { monthlyBytes: 50 * 1024 } })
  try {
    const s = await m.session()
    await (await m.page(s.sid, `${m.at("other.test")}/big`, { nav: false })).arrayBuffer()
    const again = await m.session(BOB)
    assert.equal(again.closed, "2026-11-01T00:00:00.000Z")
    assert.equal(again.resumes, "2026-11-01T00:00:00.000Z")
    const r = await m.page(again.sid, `${m.at("other.test")}/`)
    assert.equal(r.status, 503)
    assert.match(await r.text(), /"kind":"monthly"/)
  } finally {
    m.close()
  }
})

test("a site that answers the server with a robot check: Compass is told to show it another way", async () => {
  const t = await setup({ mode: "on" })
  try {
    const s = await t.session()
    for (const path of ["/cf", "/walled"]) {
      const r = await t.page(s.sid, `${t.at("other.test")}${path}`)
      const body = await r.text()
      assert.match(body, /"kind":"siteblocked"/, path)
      assert.doesNotMatch(body, /checking/)
    }
    // an ordinary error page is still the site's own page
    const missing = await t.page(s.sid, `${t.at("other.test")}/missing`)
    assert.equal(missing.status, 404)
    assert.match(await missing.text(), /<title>Not Found<\/title>/)
  } finally {
    t.close()
  }
})

test("blocklist: categories, the owner's WEB_BLOCK_HOSTS, a small heuristic, and its limits", () => {
  assert.equal(blockedSite("www.pornhub.com").category, "adult")
  assert.equal(blockedSite("cams.example.xxx").category, "adult")
  assert.equal(blockedSite("free-hentai-stuff.net").category, "adult")
  assert.equal(blockedSite("thepiratebay.org").category, "piracy")
  assert.equal(blockedSite("testsafebrowsing.appspot.com").category, "malware")
  assert.equal(blockedSite("www.eicar.org").category, "malware")
  assert.equal(blockedSite("www.croxyproxy.com").category, "proxy")
  assert.equal(blockedSite("abc.onion.ws").category, "proxy")
  assert.equal(blockedSite("forum.example.com", parseHosts("example.com, .bad.org")).category, "owner")
  assert.equal(blockedSite("x.bad.org", parseHosts("example.com, .bad.org")).category, "owner")
  // not blocked: ordinary sites, look-alike suffixes, and "sex" inside place names
  for (const host of ["en.wikipedia.org", "www.sussex.ac.uk", "essexcountyny.gov", "www.middlesex.gov", "github.com", "www.bbc.co.uk", "piratebay-history.example.com", "eicar.org.example.net"])
    assert.equal(blockedSite(host), null, host)
  assert.equal(blockedSite(""), null)
})

test("blocklist: refused by the relay on every hop and by the frame check, for everyone", async () => {
  const t = await setup({ mode: "on" })
  try {
    const s = await t.session()
    const before = t.site.seen.length
    const r = await t.page(s.sid, `${t.at("blocked.test")}/`)
    assert.equal(r.status, 403)
    const stub = await r.text()
    assert.match(stub, /"kind":"blocked"/)
    assert.match(stub, /"category":"owner"/)
    assert.match(stub, /Compass doesn&#39;t open this site|Compass doesn't open this site/)
    const adult = await t.page(s.sid, `${t.at("www.pornhub.com")}/`)
    assert.match(await adult.text(), /"category":"adult"/)
    assert.equal(t.site.seen.length, before, "nothing was fetched")
    // a redirect from an ordinary site to a blocked one is refused before it goes out
    const hop = await t.page(s.sid, `${t.at("other.test")}/to-blocked`)
    assert.equal(hop.status, 403)
    assert.match(await hop.text(), /"kind":"blocked"/)
    // the frame check (no session): blocked, so Compass shows neither the site nor a saved copy
    const f = await (await fetch(`${t.base}/frame?url=${encodeURIComponent(`${t.at("blocked.test")}/`)}`)).json()
    assert.equal(f.ok, false)
    assert.equal(f.blocked, true)
    assert.equal(f.category, "owner")
    const f2 = await (await fetch(`${t.base}/frame?url=${encodeURIComponent(`${t.at("other.test")}/to-blocked`)}`)).json()
    assert.equal(f2.blocked, true)
    // the Data Saver check too
    const c = await (await fetch(`${t.base}/check?sid=${s.sid}&url=${encodeURIComponent(`${t.at("blocked.test")}/`)}`)).json()
    assert.equal(c.blocked, true)
  } finally {
    t.close()
  }
})

test("Report This Page: stored as { account, guest, host, url, note, time }, 90 days, rate limited, nobody notified", async () => {
  const t = await setup({ mode: "on", limits: { reportsPerHour: 2 } })
  try {
    const s = await t.session()
    assert.equal((await t.report({ sid: "f".repeat(32), url: "https://example.com/" })).status, 401)
    const ok = await t.report({ sid: s.sid, url: "https://Example.com/a/b?c=1", note: "  Looks like a scam\u0007  " })
    assert.equal(ok.status, 200)
    assert.deepEqual(await ok.json(), { ok: true })
    const [row] = t.records.store.reports
    assert.deepEqual(Object.keys(row).sort(), ["account", "expiresAt", "guest", "host", "note", "time", "url"])
    assert.equal(row.account, "alice")
    assert.equal(row.guest, false)
    assert.equal(row.host, "example.com")
    assert.equal(row.url, "https://example.com/a/b?c=1")
    assert.equal(row.note, "Looks like a scam")
    assert.equal(row.expiresAt - row.time, 90 * 24 * 3600 * 1000)
    assert.equal((await t.report({ sid: s.sid, url: "javascript:alert(1)" })).status, 400)
    assert.equal((await t.report({ sid: s.sid, url: "https://example.com/" })).status, 429)
    const guest = await t.session({})
    assert.equal((await t.report({ sid: guest.sid, url: "https://en.wikipedia.org/wiki/X", note: "x".repeat(5000) })).status, 200)
    const g = t.records.store.reports.at(-1)
    assert.equal(g.account, null)
    assert.equal(g.guest, true)
    assert.equal(g.note.length, 1000)
  } finally {
    t.close()
  }
})

test("the 7-day log keeps only account, host, bytes and day; guests aren't logged; rows expire", async () => {
  let clock = Date.parse("2026-10-04T10:00:00Z")
  const now = () => clock
  const t = await setup({ mode: "on", now })
  try {
    const s = await t.session()
    await (await t.page(s.sid, `${t.at("other.test")}/secret/path?q=private`)).text()
    await (await t.page(s.sid, `${t.at("other.test")}/big`, { nav: false })).arrayBuffer()
    const g = await t.session({})
    await (await t.page(g.sid, `${t.at("site.test")}/`)).text()
    await t.records.flush()
    const rows = [...t.records.store.log.values()]
    assert.equal(rows.length, 1)
    const [row] = rows
    assert.deepEqual(Object.keys(row).sort(), ["account", "bytes", "day", "expiresAt", "host"])
    assert.equal(row.account, "alice")
    assert.equal(row.host, "other.test")
    assert.equal(row.day, "2026-10-04")
    assert.ok(row.bytes > 100 * 1024)
    assert.doesNotMatch(JSON.stringify(rows), /secret|private|path/)
    assert.equal(row.expiresAt.toISOString(), "2026-10-12T00:00:00.000Z")
    assert.equal(logExpiry("2026-10-04").toISOString(), "2026-10-12T00:00:00.000Z")
    // the relayed page is counted for /status (numbers only)
    const st = await (await fetch(`${t.base}/status`)).json()
    assert.equal(st.pagesToday, 2)
    assert.equal(st.day, "2026-10-04")
    assert.ok(st.relayTodayMB >= 0.1)
    // the TTL index removes it after 7 days (the memory store acts it out)
    t.records.store.expire(Date.parse("2026-10-11T23:59:00Z"))
    assert.equal(t.records.store.log.size, 1)
    t.records.store.expire(Date.parse("2026-10-12T00:00:00Z"))
    assert.equal(t.records.store.log.size, 0)
  } finally {
    t.close()
  }
})

test("Delete My Account: the account's log rows, reports, usage counters, sessions and cookies go; bob's stay", async () => {
  const t = await setup({ mode: "on" })
  try {
    const a = await t.session()
    const b = await t.session(BOB)
    for (const s of [a, b]) {
      await (await t.page(s.sid, `${t.at("other.test")}/`)).text()
      await t.report({ sid: s.sid, url: "https://example.com/", note: "hm" })
    }
    await t.records.flush()
    await t.counters.flush()
    const day = dayOf(Date.now())
    assert.ok(t.data.has(`day|u:alice|${day}`))
    assert.ok(t.data.has(`day|u:bob|${day}`))
    const first = await t.web.eraseAccount({ key: "alice", screenName: "Alice" })
    assert.deepEqual(first, { sessions: 1, counters: 1, log: 1, reports: 1 })
    // twice is fine (the eraser may run again after a half-way failure)
    assert.deepEqual(await t.web.eraseAccount({ key: "alice" }), { sessions: 0, counters: 0, log: 0, reports: 0 })
    assert.ok(!t.data.has(`day|u:alice|${day}`))
    assert.ok(t.data.has(`day|u:bob|${day}`))
    assert.ok(t.data.has(`day|relay|${day}`), "totals without an account stay")
    assert.deepEqual([...t.records.store.log.values()].map((r) => r.account), ["bob"])
    assert.deepEqual(t.records.store.reports.map((r) => r.account), ["bob"])
    assert.ok(!t.web.jars.has("u:alice"))
    assert.ok(t.web.jars.has("u:bob"))
    // alice's old session is gone
    assert.match(await (await t.page(a.sid, `${t.at("other.test")}/`)).text(), /"kind":"expired"/)
    assert.equal((await t.page(b.sid, `${t.at("other.test")}/`)).status, 200)
  } finally {
    t.close()
  }
})
