// node --test client/src/components/applets/compass/compass.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_BOOKMARKS, NEW_TAB, OLD_DEFAULT_BOOKMARKS, browserName, displayUrl, fileNameOf, formatBytes, hostOf, isNinetyEightIsh, migrateBookmarks, newestCapture, nowStamp, openInLabel, parseInput, rawUrl, relayUrl, searchHistory, searchTermFor, searchUrl, skipRelay, suggest } from "./urls.js"

test("the omnibox: addresses, bare host names and searches", () => {
  assert.deepEqual(parseInput("https://example.com/a?b=1"), { url: "https://example.com/a?b=1", search: false })
  assert.deepEqual(parseInput("example.com"), { url: "https://example.com/", search: false })
  assert.deepEqual(parseInput("en.wikipedia.org/wiki/Windows_98"), { url: "https://en.wikipedia.org/wiki/Windows_98", search: false })
  assert.equal(parseInput("http://neverssl.com").url, "http://neverssl.com/")
  assert.equal(parseInput("weather in chicago").url, "https://html.duckduckgo.com/html/?q=weather%20in%20chicago")
  assert.equal(parseInput("windows98").search, true) // no dot: a word
  assert.equal(parseInput("?example.com").url, searchUrl("example.com"))
  assert.equal(parseInput("cats", "bing").url, "https://www.bing.com/search?q=cats")
  assert.equal(parseInput("compass://history").url, "compass://history")
  assert.equal(parseInput("about:blank").url, NEW_TAB)
  assert.equal(parseInput("   "), null)
  assert.equal(parseInput("1.2").search, true)
  assert.equal(parseInput("192.168.1.1").url, "https://192.168.1.1/")
})

test("addresses shown in the bar", () => {
  assert.equal(displayUrl("https://www.example.com/"), "example.com")
  assert.equal(displayUrl("https://example.com/a/b?c=1"), "example.com/a/b?c=1")
  assert.equal(displayUrl("http://example.com/"), "http://example.com")
  assert.equal(displayUrl("https://en.wikipedia.org/wiki/%C3%89cole"), "en.wikipedia.org/wiki/École")
  assert.equal(displayUrl(NEW_TAB), "")
  assert.equal(hostOf("https://www.Example.com/x"), "example.com")
})

test("relay addresses", () => {
  assert.equal(relayUrl("https://srv", "abc", "https://example.com:8443/a?b#c"), "https://srv/api/web/r/abc/_/d/https/example.com:8443/a?b#c")
  assert.equal(relayUrl("https://srv", "abc", "http://example.com/", "f"), "https://srv/api/web/r/abc/_/f/http/example.com/")
  assert.equal(rawUrl("https://srv", "abc", "https://example.com/f.zip", "0123456789abcdef"), "https://srv/api/web/x/abc/0123456789abcdef/https/example.com/f.zip")
})

test("sites never relayed (they show straight from the site or as a saved copy)", () => {
  assert.equal(skipRelay("https://accounts.google.com/signin"), true)
  assert.equal(skipRelay("https://m.youtube.com/watch?v=1"), true)
  assert.equal(skipRelay("https://www.google.com/maps/place/x"), true)
  assert.equal(skipRelay("https://www.google.com/search?q=x"), false)
  assert.equal(skipRelay("https://en.wikipedia.org/"), false)
  assert.equal(skipRelay("https://notyoutube.com/"), false)
  assert.equal(skipRelay("not a url"), false)
  assert.equal(isNinetyEightIsh("http://www.98ish.com/guestbook"), true)
  assert.equal(isNinetyEightIsh("https://98ish.vercel.app/"), false)
})

test("the browser 98ish runs in, for the small 'Open in Safari' link", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
  assert.equal(browserName(iphone), "Safari")
  assert.equal(openInLabel(iphone), "Open in Safari")
  assert.equal(browserName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"), "Safari")
  assert.equal(browserName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1"), "Chrome")
  assert.equal(browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"), "Chrome")
  assert.equal(browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0"), "Edge")
  assert.equal(browserName("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"), "Firefox")
  assert.equal(openInLabel("curl/8"), "Open in Your Browser")
})

test("saved copies: the newest good capture from the Archive's sparkline", () => {
  // the Archive's answer for www.spacejam.com/1996/ (trimmed): the newest month is good
  const spark = { years: { 2025: [21, 8, 18, 9, 13, 12, 8, 8, 12, 9, 9, 19], 2026: [12, 7, 6, 9, 8, 13, 18, 12, 9, 3, 0, 0] }, status: { 2025: "222222222222", 2026: "222222222244" }, lastTs: "20261003175615" }
  assert.equal(newestCapture(spark), "20261003175615")
  // the newest month only has errors: the month before, at its end
  assert.equal(newestCapture({ ...spark, status: { ...spark.status, 2026: "222222222444" } }), "20260930235959")
  assert.equal(newestCapture({ years: { 2024: [0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, status: { 2024: "424444444444" } }), "20240229235959")
  // only bad captures: still the newest one (better than nothing)
  assert.equal(newestCapture({ years: { 2020: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, status: { 2020: "444444444444" }, lastTs: "20200315000000" }), "20200315000000")
  // never saved
  assert.equal(newestCapture({ years: {}, status: {}, lastTs: null }), null)
  assert.equal(newestCapture(null), null)
  // no status (an older proxy): the newest month with captures
  assert.equal(newestCapture({ years: { 2019: [0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0] } }), "20190531235959")
  assert.equal(nowStamp(new Date("2026-10-04T05:06:07Z")), "20261004050607")
  assert.equal(searchTermFor("https://www.spacejam.com/1996/"), "spacejam")
  assert.equal(searchTermFor("https://shop.example.co.uk/x"), "example")
  assert.equal(searchTermFor("http://localhost/"), "localhost")
})

test("starting bookmarks: ones that load without sign-on; old ones swapped once", () => {
  assert.ok(DEFAULT_BOOKMARKS.some((b) => b.url === "https://en.wikipedia.org/" && b.bar))
  assert.ok(!DEFAULT_BOOKMARKS.some((b) => /duckduckgo|ycombinator|bbc\.com|wttr\.in/.test(b.url)))
  assert.ok(DEFAULT_BOOKMARKS.some((b) => b.url === "https://www.spacejam.com/1996/"))
  let n = 0
  const id = () => `id${++n}`
  const saved = [
    { id: "a", title: "Wikipedia", url: "https://en.wikipedia.org/", bar: true },
    { id: "b", title: "DuckDuckGo", url: "https://html.duckduckgo.com/html/", bar: true },
    { id: "c", title: "My HN", url: "https://news.ycombinator.com/", bar: true }, // renamed: the person's own now
    { id: "d", title: "Hacker News", url: "https://news.ycombinator.com/", bar: true },
    { id: "e", title: "Cats", url: "https://cats.example/", bar: false },
  ]
  const out = migrateBookmarks(saved, id)
  assert.ok(!out.some((b) => b.id === "b" || b.id === "d"))
  assert.ok(out.some((b) => b.id === "c") && out.some((b) => b.id === "e") && out.some((b) => b.id === "a"))
  assert.equal(out.filter((b) => b.url === "https://en.wikipedia.org/").length, 1)
  for (const d of DEFAULT_BOOKMARKS) assert.ok(out.some((b) => b.url === d.url), d.url)
  assert.ok(out.every((b) => b.id))
  assert.equal(OLD_DEFAULT_BOOKMARKS.length, 6)
  assert.equal(migrateBookmarks(null, id).length, DEFAULT_BOOKMARKS.length)
})

test("suggestions and history search", () => {
  const history = [
    { url: "https://en.wikipedia.org/wiki/Windows_98", title: "Windows 98 - Wikipedia", at: 3 },
    { url: "https://news.ycombinator.com/", title: "Hacker News", at: 2 },
    { url: "https://example.com/", title: "Example Domain", at: 1 },
  ]
  const bookmarks = [{ url: "https://news.ycombinator.com/", title: "HN" }]
  const s = suggest("news", { history, bookmarks })
  assert.equal(s[0].url, "https://news.ycombinator.com/")
  assert.equal(s.length, 1) // the bookmark and the visit are one suggestion
  assert.equal(suggest("", { history }).length, 0)
  assert.deepEqual(
    searchHistory(history, "windows wiki").map((h) => h.at),
    [3]
  )
  assert.equal(searchHistory(history, "").length, 3)
})

test("file names and sizes", () => {
  assert.equal(fileNameOf("https://e.com/files/My%20Report.pdf?x=1"), "My Report.pdf")
  assert.equal(fileNameOf("https://e.com/"), "download")
  assert.equal(formatBytes(512), "512 bytes")
  assert.equal(formatBytes(2048), "2 KB")
  assert.equal(formatBytes(3.5 * 1024 * 1024), "3.5 MB")
})
