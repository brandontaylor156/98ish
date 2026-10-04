const test = require("node:test")
const assert = require("node:assert/strict")
const { encodeTarget, decodeTarget, rewriteHtml, rewriteCss, rewriteSrcset, rewriteRefresh } = require("../rewrite")
const { CookieJar } = require("../cookies")

const R = "https://srv/api/web/r/S/T/d/"
const nav = (u) => R + encodeTarget(u) + new URL(u).hash
const asset = (u) => "A:" + u
const ctx = (extra = {}) => ({ pageUrl: "https://example.com/dir/page.html", nav, asset, inject: "<!--I-->", ...extra })

test("relay addresses round-trip", () => {
  assert.equal(encodeTarget("https://example.com/a/b?q=1#frag"), "https/example.com/a/b?q=1")
  assert.equal(encodeTarget("http://example.com:8080/"), "http/example.com:8080/")
  assert.equal(decodeTarget("https/example.com/a/b", "?q=1").href, "https://example.com/a/b?q=1")
  assert.equal(decodeTarget("http/example.com:8080").href, "http://example.com:8080/")
  assert.equal(decodeTarget("https/example.com/%E2%9C%93").pathname, "/%E2%9C%93")
  assert.equal(decodeTarget("ftp/example.com/"), null)
  assert.equal(decodeTarget("nonsense"), null)
})

test("links, forms and frames go through the relay; relative ones resolve against the page", () => {
  const out = rewriteHtml('<a href="other.html">x</a><a href="/root?q=1&amp;r=2">y</a><a href="https://b.com/z#top">z</a><form action="search"><button formaction="/alt">b</button></form><iframe src="//c.com/f"></iframe>', ctx())
  assert.match(out, /<a href="https:\/\/srv\/api\/web\/r\/S\/T\/d\/https\/example\.com\/dir\/other\.html">x<\/a>/)
  assert.match(out, /href="https:\/\/srv\/api\/web\/r\/S\/T\/d\/https\/example\.com\/root\?q=1&amp;r=2"/)
  assert.match(out, /href="https:\/\/srv\/api\/web\/r\/S\/T\/d\/https\/b\.com\/z#top"/)
  assert.match(out, /<form action="https:\/\/srv\/api\/web\/r\/S\/T\/d\/https\/example\.com\/dir\/search">/)
  assert.match(out, /formaction="https:\/\/srv\/api\/web\/r\/S\/T\/d\/https\/example\.com\/alt"/)
  assert.match(out, /<iframe src="https:\/\/srv\/api\/web\/r\/S\/T\/d\/https\/c\.com\/f">/)
})

test("same-page anchors, javascript:, mailto: and data: are left alone", () => {
  const html = '<a href="#top">t</a><a href="javascript:void(0)">j</a><a href="mailto:a@b.c">m</a><img src="data:image/png;base64,AA">'
  const out = rewriteHtml(html, ctx({ inject: "" }))
  assert.equal(out, html)
})

test("assets: src, srcset, background, poster; video and audio sources stay direct", () => {
  const out = rewriteHtml('<img src="a.png" srcset="b.png 1x, /c.png 2x"><script src="app.js"></script><link rel="stylesheet" href="s.css"><body background="bg.gif"><video src="v.mp4" poster="p.jpg"><source src="v.webm"></video><picture><source srcset="w.webp 480w, x.webp 800w"></picture>', ctx())
  assert.match(out, /<img src="A:https:\/\/example\.com\/dir\/a\.png" srcset="A:https:\/\/example\.com\/dir\/b\.png 1x, A:https:\/\/example\.com\/c\.png 2x">/)
  assert.match(out, /<script src="A:https:\/\/example\.com\/dir\/app\.js"><\/script>/)
  assert.match(out, /<link rel="stylesheet" href="A:https:\/\/example\.com\/dir\/s\.css">/)
  assert.match(out, /<body background="A:https:\/\/example\.com\/dir\/bg\.gif">/)
  assert.match(out, /<video src="https:\/\/example\.com\/dir\/v\.mp4" poster="A:https:\/\/example\.com\/dir\/p\.jpg">/)
  assert.match(out, /<source src="https:\/\/example\.com\/dir\/v\.webm">/)
  assert.match(out, /srcset="A:https:\/\/example\.com\/dir\/w\.webp 480w, A:https:\/\/example\.com\/dir\/x\.webp 800w"/)
})

test("the asset mapper is told what kind of asset it is (stylesheets and fonts go through the relay)", () => {
  const seen = []
  const spy = (u, info) => (seen.push([u.split("/").pop(), info]), u)
  rewriteHtml('<link rel="Stylesheet" href="a.css"><link rel="preload" as="font" href="f.woff2"><img src="i.png">', ctx({ asset: spy, inject: "" }))
  assert.deepEqual(seen, [
    ["a.css", { tag: "link", rel: "stylesheet", as: "" }],
    ["f.woff2", { tag: "link", rel: "preload", as: "font" }],
    ["i.png", { tag: "img" }],
  ])
  const css = []
  rewriteCss('@import "more.css"; a{background:url(b.png)}', "https://e.com/", (u, info) => (css.push(info?.tag || null), u))
  assert.ok(css.includes("import"), JSON.stringify(css))
})

test("srcset with commas inside URLs and no descriptors", () => {
  assert.equal(rewriteSrcset("a.jpg", "https://e.com/", (u) => "A:" + u), "A:https://e.com/a.jpg")
  assert.equal(rewriteSrcset("https://img.com/x,y.jpg 1x, b.jpg 2x", "https://e.com/", (u) => "A:" + u), "A:https://img.com/x,y.jpg 1x, A:https://e.com/b.jpg 2x")
})

test("integrity and ping are dropped; target=_top becomes _self", () => {
  const out = rewriteHtml('<script src="x.js" integrity="sha384-abc" crossorigin="anonymous"></script><a href="/" ping="/track" target="_top">h</a>', ctx())
  assert.doesNotMatch(out, /integrity|ping=/)
  assert.match(out, /crossorigin="anonymous"/)
  assert.match(out, /target="_self"/)
})

test("<base href> changes how everything resolves, and is rewritten itself", () => {
  const out = rewriteHtml('<head><base href="https://cdn.example.org/root/"></head><body><a href="p">p</a><img src="i.png"></body>', ctx({ base: (u) => "B:" + u }))
  assert.match(out, /<base href="B:https:\/\/cdn\.example\.org\/root\/">/)
  assert.match(out, /href="https:\/\/srv\/api\/web\/r\/S\/T\/d\/https\/cdn\.example\.org\/root\/p"/)
  assert.match(out, /src="A:https:\/\/cdn\.example\.org\/root\/i\.png"/)
})

test("meta refresh, CSP and charset metas", () => {
  const out = rewriteHtml('<head><meta http-equiv="refresh" content="3; URL=\'/next\'"><meta http-equiv="Content-Security-Policy" content="frame-ancestors \'none\'"><meta charset="windows-1252"><meta http-equiv="content-type" content="text/html; charset=iso-8859-1"></head>', ctx())
  assert.match(out, /<meta http-equiv="refresh" content="3; url=https:\/\/srv\/api\/web\/r\/S\/T\/d\/https\/example\.com\/next">/)
  assert.doesNotMatch(out, /Content-Security-Policy/i)
  assert.match(out, /<meta charset="utf-8">/)
  assert.match(out, /content="text\/html; charset=utf-8"/)
  assert.equal(rewriteRefresh("0;url=a.html", "https://e.com/d/", (u) => "N:" + u), "0; url=N:https://e.com/d/a.html")
  assert.equal(rewriteRefresh("30", "https://e.com/", (u) => "N:" + u), "30")
})

test("CSS: url() in every quoting style, @import, and data: left alone", () => {
  const css = `a{background:url(img/a.png)} b{background:url('/b.png')} c{background:url("https://x.com/c.png")} d{background:url(data:image/png;base64,AA)} @import "more.css"; @import url(other.css); @font-face{src:url(f.woff2) format("woff2")}`
  const out = rewriteCss(css, "https://example.com/css/site.css", (u) => "A:" + u)
  assert.match(out, /url\("A:https:\/\/example\.com\/css\/img\/a\.png"\)/)
  assert.match(out, /url\("A:https:\/\/example\.com\/b\.png"\)/)
  assert.match(out, /url\("A:https:\/\/x\.com\/c\.png"\)/)
  assert.match(out, /url\(data:image\/png;base64,AA\)/)
  assert.match(out, /@import "A:https:\/\/example\.com\/css\/more\.css"/)
  assert.match(out, /@import url\("A:https:\/\/example\.com\/css\/other\.css"\)/)
  assert.match(out, /url\("A:https:\/\/example\.com\/css\/f\.woff2"\) format/)
})

test("<style> blocks and style attributes are rewritten; scripts, comments and textareas are not", () => {
  const html = '<style>.a{background:url(a.png)}</style><div style="background-image:url(&quot;b.png&quot;)">x</div><script>var s = "<a href=\'no.html\'>"; if (a < b) {}</script><!-- <a href="c.html"> --><textarea><a href="d.html"></textarea>'
  const out = rewriteHtml(html, ctx({ inject: "" }))
  assert.match(out, /<style>\.a\{background:url\("A:https:\/\/example\.com\/dir\/a\.png"\)\}<\/style>/)
  assert.match(out, /style="background-image:url\(&quot;A:https:\/\/example\.com\/dir\/b\.png&quot;\)"/)
  assert.match(out, /<script>var s = "<a href='no\.html'>"; if \(a < b\) \{\}<\/script>/)
  assert.match(out, /<!-- <a href="c\.html"> -->/)
  assert.match(out, /<textarea><a href="d\.html"><\/textarea>/)
})

test("the helper goes first in <head>, or before the first tag when there's no head", () => {
  assert.equal(rewriteHtml("<!doctype html><html><head><title>t</title></head></html>", ctx()), "<!doctype html><html><head><!--I--><title>t</title></head></html>")
  assert.equal(rewriteHtml('<html lang="en"><body>hi</body></html>', ctx()), '<html lang="en"><!--I--><body>hi</body></html>')
  assert.equal(rewriteHtml("<p>bare</p>", ctx()), "<!--I--><p>bare</p>")
  assert.equal(rewriteHtml("just text", ctx()), "<!--I-->just text")
  assert.equal(rewriteHtml("<HEAD><TITLE>x</TITLE></HEAD>", ctx()), "<HEAD><!--I--><TITLE>x</TITLE></HEAD>")
})

test("odd markup survives: unquoted values, > inside quotes, uppercase, self-closing, broken tags", () => {
  const out = rewriteHtml('<A HREF=page2.html TITLE="a > b">x</A><img src=pic.gif /><a href="x.html"', ctx({ inject: "" }))
  assert.match(out, /<A HREF="https:\/\/srv\/api\/web\/r\/S\/T\/d\/https\/example\.com\/dir\/page2\.html" TITLE="a &gt; b">x<\/A>/)
  assert.match(out, /<img src="A:https:\/\/example\.com\/dir\/pic\.gif" \/>/)
  assert.match(out, /<a href="x\.html"$/) // an unfinished tag at the end is left as it was
})

test("untouched tags are copied byte for byte", () => {
  const html = `<div   class='a'  data-x = "1"><p>Hello &amp; welcome</p><input type=checkbox checked></div>`
  assert.equal(rewriteHtml(html, ctx({ inject: "" })), html)
})

test("cookie jar: domains, paths, expiry, secure, HttpOnly and scripts", () => {
  let t = 1_000_000
  const jar = new CookieJar({ now: () => t })
  jar.set("sid=1; Path=/; HttpOnly", "https://shop.example.com/login")
  jar.set("pref=dark; Domain=example.com; Path=/", "https://shop.example.com/")
  jar.set("deep=1; Path=/account", "https://shop.example.com/")
  jar.set("short=1; Max-Age=10", "https://shop.example.com/")
  jar.set("sec=1; Secure", "http://shop.example.com/") // refused: Secure over http
  jar.set("evil=1; Domain=other.com", "https://shop.example.com/") // refused: not this site
  jar.set("tld=1; Domain=com", "https://shop.example.com/") // refused: a bare TLD
  assert.equal(jar.header("https://shop.example.com/"), "sid=1; pref=dark; short=1")
  assert.equal(jar.header("https://shop.example.com/account/orders"), "deep=1; sid=1; pref=dark; short=1")
  assert.equal(jar.header("https://www.example.com/"), "pref=dark")
  assert.equal(jar.header("https://other.com/"), "")
  assert.equal(jar.header("https://shop.example.com/", { forScript: true }), "pref=dark; short=1")
  assert.equal(jar.set("sid=hacked", "https://shop.example.com/", { fromScript: true }), false)
  t += 11_000
  assert.equal(jar.header("https://shop.example.com/"), "sid=1; pref=dark")
  jar.set("pref=gone; Domain=example.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT", "https://shop.example.com/")
  assert.equal(jar.header("https://shop.example.com/"), "sid=1")
  jar.set("__Host-x=1; Secure; Path=/", "https://shop.example.com/")
  jar.set("__Host-y=1; Secure; Path=/; Domain=example.com", "https://shop.example.com/") // refused
  assert.match(jar.header("https://shop.example.com/"), /__Host-x=1/)
  assert.doesNotMatch(jar.header("https://shop.example.com/"), /__Host-y/)
})

test("cookie jar is bounded", () => {
  const jar = new CookieJar({ max: 5 })
  for (let i = 0; i < 20; i++) jar.set(`c${i}=1`, "https://a.com/")
  assert.equal(jar.size, 5)
  assert.equal(jar.header("https://a.com/"), "c15=1; c16=1; c17=1; c18=1; c19=1")
  assert.equal(jar.set(`big=${"x".repeat(5000)}`, "https://a.com/"), false)
})
