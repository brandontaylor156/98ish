// node --test client/src/components/applets/compass/compass.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { NEW_TAB, displayUrl, fileNameOf, formatBytes, hostOf, isNinetyEightIsh, parseInput, rawUrl, realBrowserReason, relayUrl, searchHistory, searchUrl, suggest } from "./urls.js"

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

test("sites for the real browser", () => {
  assert.match(realBrowserReason("https://accounts.google.com/signin"), /Google sign-in/)
  assert.match(realBrowserReason("https://m.youtube.com/watch?v=1"), /YouTube/)
  assert.match(realBrowserReason("https://www.google.com/maps/place/x"), /Maps/)
  assert.equal(realBrowserReason("https://www.google.com/search?q=x"), null)
  assert.equal(realBrowserReason("https://en.wikipedia.org/"), null)
  assert.equal(realBrowserReason("https://notyoutube.com/"), null)
  assert.match(realBrowserReason("https://shop.example.com/", ["example.com"]), /always open/)
  assert.equal(isNinetyEightIsh("http://www.98ish.com/guestbook"), true)
  assert.equal(isNinetyEightIsh("https://98ish.vercel.app/"), false)
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
