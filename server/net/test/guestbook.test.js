const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const express = require("express")
const gb = require("../guestbook")

const valid = { name: "Webmaster Dan", homepage: "geocities.com/dan", message: "Cool page!! Sign mine too :)", mood: "cool" }

test("accepts a normal entry and normalizes it", () => {
  const r = gb.validateEntry(valid)
  assert.ok(r.ok, r.error)
  assert.equal(r.entry.homepage, "http://geocities.com/dan")
  assert.equal(r.entry.mood, "cool")
  assert.equal(gb.validateEntry({ ...valid, mood: "<script>" }).entry.mood, "smile")
  assert.equal(gb.validateEntry({ ...valid, homepage: "" }).entry.homepage, "")
})

test("length limits and required fields", () => {
  assert.equal(gb.validateEntry({ ...valid, name: "   " }).ok, false)
  assert.equal(gb.validateEntry({ ...valid, message: "" }).ok, false)
  assert.equal(gb.validateEntry({ ...valid, name: "x".repeat(33) }).ok, false)
  assert.equal(gb.validateEntry({ ...valid, message: "a ".repeat(260) }).ok, false)
  assert.equal(gb.validateEntry({ ...valid, message: "hi\n".repeat(20) }).ok, false)
  assert.ok(gb.validateEntry({ ...valid, message: "y".repeat(10) + " ok" }).ok)
})

test("HTML is kept as plain text (the page renders text, never markup)", () => {
  const r = gb.validateEntry({ ...valid, message: "<b>hi</b> <img src=x onerror=alert(1)>" })
  assert.ok(r.ok)
  assert.equal(r.entry.message, "<b>hi</b> <img src=x onerror=alert(1)>")
  assert.equal(gb.validateEntry({ ...valid, message: "hi\u0000\u0007 there" }).entry.message, "hi there")
})

test("homepages must be http(s) web addresses", () => {
  for (const bad of ["javascript:alert(1)", "ftp://x.com", "http://localhost", "http://user:pw@evil.com", "not a url", "x".repeat(120) + ".com"]) {
    assert.equal(gb.validateEntry({ ...valid, homepage: bad }).ok, false, bad)
  }
})

test("links in the message are spam", () => {
  for (const msg of ["visit http://spam.example", "go to www.cheap.biz", "buy now at pills.ru", "best deals shop.xyz"]) {
    assert.equal(gb.validateEntry({ ...valid, message: msg }).ok, false, msg)
  }
  assert.ok(gb.validateEntry({ ...valid, message: "I love this site. Mr. Smith says hi." }).ok)
})

test("profanity filter sees through disguises without flagging innocent words", () => {
  for (const msg of ["what the fuck", "sh1t page", "F*CK", "you b!tch", "fuuuuck"]) assert.ok(gb.isProfane(msg), msg)
  for (const msg of ["Scunthorpe rules", "class assignment", "Dick Van Dyke", "a cocktail party", "passing the bass", "Hello from Essex"]) {
    assert.equal(gb.isProfane(msg), false, msg)
  }
  assert.equal(gb.validateEntry({ ...valid, name: "shithead" }).ok, false)
})

test("repeated characters and the bot trap are rejected", () => {
  assert.equal(gb.validateEntry({ ...valid, message: "!!!!!!!!!!!!!!!!!!" }).ok, false)
  assert.equal(gb.validateEntry({ ...valid, website: "http://bot.com" }).ok, false)
})

test("memory store pages newest first and counts hits", async () => {
  const store = gb.memoryStore()
  for (let i = 1; i <= 25; i++) await store.add({ name: `n${i}`, homepage: "", message: `m${i}`, mood: "smile" })
  const first = await store.page(1, 10)
  assert.equal(first.total, 25)
  assert.deepEqual(first.entries.map((e) => e.name).slice(0, 2), ["n25", "n24"])
  assert.equal((await store.page(3, 10)).entries.length, 5)
  assert.equal(await store.hit("guestbook", true), 1)
  assert.equal(await store.hit("guestbook", false), 1)
  assert.equal(await store.hit("guestbook", true), 2)
})

test("HTTP routes: sign, page, rate limit, hit counter dedupe", async () => {
  const app = express()
  app.use("/api", gb.guestbookRouter({ store: gb.memoryStore() }))
  const server = http.createServer(app).listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api`
  const post = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  try {
    let r = await post("/guestbook", valid)
    assert.equal(r.status, 200)
    const saved = (await r.json()).entry
    assert.equal(saved.name, "Webmaster Dan")
    r = await post("/guestbook", { ...valid, message: "second one" })
    assert.equal(r.status, 429)
    r = await post("/guestbook", { ...valid, message: "<script>" + "x".repeat(600) })
    assert.equal(r.status, 400)
    const list = await (await fetch(`${base}/guestbook?page=1`)).json()
    assert.equal(list.total, 1)
    assert.equal(list.entries[0].id, saved.id)
    const a = await (await post("/hits/guestbook", {})).json()
    const b = await (await post("/hits/guestbook", {})).json()
    assert.equal(a.count, 1)
    assert.equal(b.count, 1) // same visitor within 10 minutes
    assert.equal((await post("/hits/nope", {})).status, 404)
    r = await fetch(`${base}/guestbook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{bad json" })
    assert.equal(r.status, 400)
  } finally {
    server.close()
  }
})
