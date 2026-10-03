const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const express = require("express")
const couples = require("../../couples")
const { memoryStore } = require("../../couples/store")
const { petRouter } = require("..")
const logic = require("../logic")

const HOUR = logic.HOUR
const DAY = logic.DAY
const token = (c) => c.repeat(48)
const TOKENS = { alice: token("a"), bobby: token("b"), carol: token("c"), dave: token("d") }

// A fake 98 Messenger: four accounts, all signed on, sockets that record what they're sent
const fakeAim = () => {
  const users = {
    alice: { key: "alice", screenName: "Alice", blocked: [] },
    bobby: { key: "bobby", screenName: "Bobby", blocked: [] },
    carol: { key: "carol", screenName: "Carol", blocked: [] },
    dave: { key: "dave", screenName: "Dave", blocked: [] },
  }
  const socket = () => ({ events: [], emit(event, payload) { this.events.push({ event, payload }) } })
  const sessions = new Map(Object.values(users).map((u) => [u.key, { key: u.key, user: u, socket: socket() }]))
  const byToken = Object.fromEntries(Object.entries(TOKENS).map(([k, t]) => [t, k]))
  return { users, sessions, authenticate: (t) => sessions.get(byToken[t]) || null, store: { find: async (key) => users[key] || null } }
}

const serve = ({ limits = {} } = {}) => {
  const aim = fakeAim()
  let time = Date.UTC(2026, 9, 2, 12)
  const service = couples.createCouples({ store: memoryStore(), aim, now: () => time, limits: { writesPerMinute: 1000, writesPerHour: 10000, pairRequestsPerHour: 1000 } })
  const app = express()
  app.use("/api/couples/pet", petRouter({ service, limits: { writesPerMinute: 1000, writesPerHour: 10000, readsPerMinute: 1000, ...limits } }))
  app.use("/api/couples", couples.couplesRouter({ service }))
  const server = http.createServer(app).listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api/couples`
  const call = (who, method, path, body) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${TOKENS[who] || who}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ ...(await r.json().catch(() => ({}))), http: r.status }))
  const pet = (who, method, path, body) => call(who, method, `/pet${path}`, body)
  const events = (who, name) => aim.sessions.get(who).socket.events.filter((e) => !name || e.event === name)
  const close = () => {
    server.close()
    service.close()
  }
  return { aim, service, call, pet, events, close, advance: (ms) => (time += ms), now: () => time }
}

const pair = async (call, a = "alice", b = "Bobby", bKey = "bobby") => {
  assert.equal((await call(a, "POST", "/request", { to: b })).http, 200)
  assert.equal((await call(bKey, "POST", "/accept", {})).http, 200)
}

const adopt = (pet, who = "alice", extra = {}) => pet(who, "POST", "/adopt", { species: "mochi", name: "Mochi", body: "pink", accent: "mint", tz: 0, ...extra })

test("only the two of them: 401 signed off, 403 not paired, a third couple sees only their own", async (t) => {
  const s = serve()
  t.after(s.close)
  assert.equal((await s.pet(null, "GET", "/")).http, 401)
  assert.equal((await s.pet("alice", "GET", "/")).http, 403)
  await pair(s.call)
  assert.equal((await adopt(s.pet)).http, 200)
  const bob = await s.pet("bobby", "GET", "/")
  assert.equal(bob.pet.name, "Mochi")
  // Carol on her own: 403 for everything
  assert.equal((await s.pet("carol", "GET", "/")).http, 403)
  assert.equal((await s.pet("carol", "POST", "/act", { action: "feed", food: "cookie" })).http, 403)
  assert.equal((await s.pet("carol", "POST", "/touch", { kind: "cuddle", x: 0.5, y: 0.5 })).http, 403)
  // Carol and Dave pair up: no pet of theirs, and acting finds nothing
  await pair(s.call, "carol", "Dave", "dave")
  assert.equal((await s.pet("carol", "GET", "/")).pet, null)
  assert.equal((await s.pet("carol", "POST", "/act", { action: "feed", food: "cookie" })).http, 404)
  assert.equal((await s.pet("alice", "GET", "/")).pet.log.length, 1, "nothing of Carol's touched Alice's pet")
  // nothing about Mochi ever reached Carol or Dave
  assert.ok(!JSON.stringify(s.events("carol")).includes("Mochi"))
  assert.ok(!JSON.stringify(s.events("dave")).includes("Mochi"))
  // unpairing hides it; pairing again brings it back
  assert.equal((await s.call("alice", "POST", "/unpair", {})).http, 200)
  assert.equal((await s.pet("alice", "GET", "/")).http, 403)
  assert.equal((await s.pet("bobby", "GET", "/")).http, 403)
  await pair(s.call)
  assert.equal((await s.pet("bobby", "GET", "/")).pet.name, "Mochi")
  // unpairing with "delete now" deletes it
  assert.equal((await s.call("bobby", "POST", "/unpair", { deleteNow: true })).http, 200)
  await pair(s.call)
  assert.equal((await s.pet("alice", "GET", "/")).pet, null)
})

test("validates adoption, names and actions", async (t) => {
  const s = serve()
  t.after(s.close)
  await pair(s.call)
  assert.equal((await adopt(s.pet, "alice", { species: "pikachu" })).http, 400)
  assert.equal((await adopt(s.pet, "alice", { name: "" })).http, 400)
  assert.equal((await adopt(s.pet, "alice", { name: "x".repeat(17) })).http, 400)
  assert.equal((await adopt(s.pet, "alice", { name: "<b>hi</b>" })).http, 400)
  assert.equal((await adopt(s.pet, "alice", { body: "#ff0000" })).http, 400)
  assert.equal((await adopt(s.pet, "alice", { name: { evil: 1 } })).http, 400)
  assert.equal((await s.pet("alice", "POST", "/act", { action: "feed", food: "cookie" })).http, 404, "no pet yet")
  const ok = await adopt(s.pet, "alice", { name: "  Miss  Biscuit " })
  assert.equal(ok.http, 200)
  assert.equal(ok.pet.name, "Miss Biscuit")
  assert.equal((await adopt(s.pet, "bobby")).http, 409, "one pet per couple")
  assert.equal((await s.pet("alice", "POST", "/act", { action: "feed", food: "pizza" })).http, 400)
  assert.equal((await s.pet("alice", "POST", "/act", { action: "explode" })).http, 400)
  assert.equal((await s.pet("alice", "POST", "/act", { action: "play", score: 999 })).http, 400)
  assert.equal((await s.pet("alice", "POST", "/act", { action: "play", score: 2.5 })).http, 400)
  assert.equal((await s.pet("alice", "POST", "/act", { action: "dress", worn: ["crown"] })).http, 403, "locked")
  assert.equal((await s.pet("alice", "POST", "/act", { action: "dress", worn: ["nope"] })).http, 400)
  assert.equal((await s.pet("alice", "POST", "/act", { action: "dress", worn: "bow" })).http, 400)
  assert.equal((await s.pet("alice", "POST", "/act", { action: "dress", worn: ["bow"] })).http, 200)
  assert.equal((await s.pet("alice", "POST", "/act", { action: "touch", kind: "cuddle" })).http, 400)
  const big = await s.pet("alice", "POST", "/name", { name: "y".repeat(10_000) })
  assert.ok(big.http === 400 || big.http === 413)
  // feeding a full pet, playing twice in a row
  for (let i = 0; i < 4; i++) await s.pet("alice", "POST", "/act", { action: "feed", food: "riceball" })
  assert.equal((await s.pet("alice", "POST", "/act", { action: "feed", food: "riceball" })).http, 409)
  assert.equal((await s.pet("alice", "POST", "/act", { action: "play", score: 12 })).http, 200)
  assert.equal((await s.pet("alice", "POST", "/act", { action: "play", score: 12 })).http, 429)
})

test("naming together: one suggests, the other says yes", async (t) => {
  const s = serve()
  t.after(s.close)
  await pair(s.call)
  await adopt(s.pet)
  const p = await s.pet("alice", "POST", "/name", { name: "Dumpling" })
  assert.equal(p.pet.proposal.name, "Dumpling")
  assert.equal(p.pet.name, "Mochi")
  assert.ok(s.events("bobby", "couple:pet").some((e) => e.payload.text.includes("Dumpling")))
  assert.equal((await s.pet("alice", "POST", "/name/answer", { yes: true })).http, 403, "can't approve your own")
  assert.equal((await s.pet("bobby", "POST", "/name", { name: "Bean" })).http, 409, "one at a time")
  const yes = await s.pet("bobby", "POST", "/name/answer", { yes: true })
  assert.equal(yes.pet.name, "Dumpling")
  assert.equal(yes.pet.proposal, null)
  await s.pet("bobby", "POST", "/name", { name: "Bean" })
  const no = await s.pet("alice", "POST", "/name/answer", { yes: false })
  assert.equal(no.pet.name, "Dumpling")
})

test("decay over real time, sleeping, and moods", () => {
  const t0 = Date.UTC(2026, 0, 1, 12)
  const pet = logic.newPet({ species: "sheep", name: "Puff", body: "cream", accent: "pink", tz: 0 }, "alice", "Alice", t0)
  const later = logic.advance(pet, t0 + 10 * HOUR)
  assert.equal(later.stats.fullness, 80 - 35)
  assert.equal(later.stats.happiness, 90 - 25)
  assert.equal(later.stats.cleanliness, 100 - 20)
  assert.equal(later.stats.energy, 90 - 30)
  // a day alone: hungry, but fine
  const day = logic.view(pet, "alice", "bobby", "Bobby", t0 + DAY)
  assert.equal(day.stats.fullness, 0)
  assert.equal(day.mood, "hungry")
  assert.equal(day.away, null)
  // never below zero, never above 100
  const week = logic.advance(pet, t0 + 4 * DAY)
  assert.ok(Object.values(week.stats).every((n) => n >= 0 && n <= 100))
  // asleep: energy fills at 15/h, then it wakes up on its own
  const tired = { ...pet, stats: { ...pet.stats, energy: 40 }, asleep: true }
  const twoHours = logic.advance(tired, t0 + 2 * HOUR)
  assert.equal(twoHours.stats.energy, 70)
  assert.equal(twoHours.asleep, true)
  assert.equal(logic.moodOf(twoHours, t0 + 2 * HOUR), "sleeping")
  const rested = logic.advance(tired, t0 + 6 * HOUR) // full after 4h, then 2h awake
  assert.equal(rested.asleep, false)
  assert.equal(rested.stats.energy, 94)
  // worn out, it naps by itself, then wakes up rested
  const worn = logic.advance(pet, t0 + 30 * HOUR)
  assert.equal(worn.stats.energy, 0)
  assert.equal(worn.asleep, true)
  const napped = logic.advance(pet, t0 + 30 * HOUR + 4 * HOUR)
  assert.equal(napped.stats.energy, 60)
  const up = logic.advance(pet, t0 + 30 * HOUR + 8 * HOUR)
  assert.equal(up.asleep, false)
  assert.ok(up.stats.energy > 90)
  // happy when everything's good
  assert.equal(logic.moodOf({ ...pet, stats: { fullness: 90, happiness: 90, cleanliness: 90, energy: 90 } }, t0), "happy")
})

test("decay through the server's test clock", async (t) => {
  const s = serve()
  t.after(s.close)
  await pair(s.call)
  await adopt(s.pet)
  const before = (await s.pet("alice", "GET", "/")).pet
  s.service.setOffset(12 * HOUR)
  const after = (await s.pet("alice", "GET", "/")).pet
  assert.equal(after.stats.fullness, before.stats.fullness - 42)
  assert.equal(after.stats.energy, before.stats.energy - 36)
  s.service.setOffset(2 * DAY) // (it napped on its own at 30 hours, and woke up again)
  const sad = (await s.pet("bobby", "GET", "/")).pet
  assert.equal(sad.mood, "hungry")
  assert.equal(sad.missing, "Alice")
  assert.equal(sad.stats.fullness, 0)
})

test("it never dies: Grandma's after 5 days alone, home when you both visit", async (t) => {
  const s = serve()
  t.after(s.close)
  await pair(s.call)
  await adopt(s.pet)
  s.service.setOffset(5 * DAY - HOUR)
  assert.equal((await s.pet("alice", "GET", "/")).pet.away, null)
  s.service.setOffset(30 * DAY)
  const gone = (await s.pet("alice", "GET", "/")).pet
  assert.equal(gone.mood, "away")
  assert.deepEqual(gone.away.visited, [])
  assert.equal((await s.pet("alice", "POST", "/act", { action: "feed", food: "cookie" })).http, 409)
  // one visit isn't enough
  const one = await s.pet("alice", "POST", "/visit", {})
  assert.equal(one.home, false)
  assert.deepEqual(one.pet.away.visited, ["me"])
  assert.deepEqual((await s.pet("bobby", "GET", "/")).pet.away.visited, ["partner"])
  // the second brings it home, happy
  const two = await s.pet("bobby", "POST", "/visit", {})
  assert.equal(two.home, true)
  assert.equal(two.pet.away, null)
  assert.equal(two.pet.mood, "happy")
  assert.equal(two.together, true, "a family moment")
  assert.equal(two.pet.missing, null, "both visited today")
  assert.ok(two.pet.log.some((e) => e.text.includes("came home")))
  assert.ok(s.events("alice", "couple:pet").some((e) => e.payload.kind === "home"))
  assert.equal((await s.pet("alice", "POST", "/visit", {})).http, 409, "it's home")
  // visits from a long-ago trip don't count for the next one
  s.service.setOffset(40 * DAY)
  assert.equal((await s.pet("alice", "POST", "/visit", {})).home, false)
})

test("the together bonus, the daily bond cap, growing up and the well-fed streak", async (t) => {
  const s = serve()
  t.after(s.close)
  await pair(s.call)
  await adopt(s.pet)
  const a = await s.pet("alice", "POST", "/act", { action: "pet" })
  assert.equal(a.together, false)
  assert.equal(a.pet.bond, 3)
  assert.equal(a.pet.missing, "Bobby")
  const b = await s.pet("bobby", "POST", "/act", { action: "feed", food: "strawberry" })
  assert.equal(b.together, true)
  assert.equal(b.pet.bond, 3 + 3 + logic.TOGETHER_BONUS)
  assert.equal(b.pet.missing, null)
  assert.ok(s.events("alice", "couple:pet").some((e) => e.payload.together && e.payload.by === "Bobby"))
  // only once a day
  const again = await s.pet("alice", "POST", "/act", { action: "pet" })
  assert.equal(again.together, false)
  // the diary counts repeats instead of filling up
  const diary = (await s.pet("alice", "GET", "/")).pet.log
  assert.equal(diary[0].text, "Alice gave Mochi a cuddle")
  // the daily cap per partner
  let last
  for (let i = 0; i < 20; i++) last = await s.pet("alice", "POST", "/act", { action: "pet" })
  assert.equal(last.pet.bond, logic.DAILY_BOND_CAP + 3 + logic.TOGETHER_BONUS)
  assert.equal(last.pet.log[0].times, 21)
  // days go by: feed every day, grow up
  let pet
  for (let d = 1; d <= 13; d++) {
    s.service.setOffset(d * DAY)
    await s.pet("alice", "POST", "/act", { action: "wake" }) // if it dozed off
    assert.equal((await s.pet("alice", "POST", "/act", { action: "feed", food: "cookie" })).http, 200)
    pet = (await s.pet("bobby", "POST", "/act", { action: "pet" })).pet
    if (d === 3) assert.equal(pet.stage, "kid")
  }
  assert.equal(pet.stage, "grown")
  assert.equal(pet.fedStreak, 14)
  assert.equal(pet.togetherDays, 14)
  assert.ok(pet.unlocked.includes("scarf"))
  // skip a day: the streak starts over
  s.service.setOffset(15 * DAY)
  await s.pet("alice", "POST", "/act", { action: "wake" })
  pet = (await s.pet("alice", "POST", "/act", { action: "feed", food: "cookie" })).pet
  assert.equal(pet.fedStreak, 1)
})

test("max bond unlocks the crown", () => {
  const t0 = Date.UTC(2026, 0, 1, 12)
  let pet = logic.newPet({ species: "dragon", name: "Ember", body: "mint", accent: "lemon", tz: 0 }, "alice", "Alice", t0)
  for (let d = 0; d < 40; d++) {
    for (let i = 0; i < 15; i++) {
      pet = logic.act(pet, "alice", "Alice", { action: "pet" }, t0 + d * DAY + i * 60_000).pet
      pet = logic.act(pet, "bobby", "Bobby", { action: "pet" }, t0 + d * DAY + i * 60_000 + 1).pet
    }
  }
  assert.equal(pet.bond, logic.MAX_BOND)
  assert.equal(logic.bondLevel(pet.bond), 10)
  assert.ok(logic.unlockedAccessories(pet.bond).includes("crown"))
  pet = logic.act(pet, "alice", "Alice", { action: "dress", worn: ["crown", "shades", "scarf"] }, t0 + 41 * DAY).pet
  assert.deepEqual(pet.worn, ["crown", "shades", "scarf"])
  assert.throws(() => logic.act(pet, "alice", "Alice", { action: "dress", worn: ["crown", "bow"] }, t0 + 41 * DAY), logic.Nope)
})

test("sleeping: only cuddles and waking up", async (t) => {
  const s = serve()
  t.after(s.close)
  await pair(s.call)
  await adopt(s.pet)
  assert.equal((await s.pet("alice", "POST", "/act", { action: "sleep" })).http, 409, "not sleepy yet")
  s.service.setOffset(8 * HOUR)
  const asleep = await s.pet("alice", "POST", "/act", { action: "sleep" })
  assert.equal(asleep.pet.asleep, true)
  assert.equal((await s.pet("bobby", "POST", "/act", { action: "feed", food: "milk" })).http, 409)
  assert.equal((await s.pet("bobby", "POST", "/act", { action: "pet" })).http, 200)
  const awake = await s.pet("bobby", "POST", "/act", { action: "wake" })
  assert.equal(awake.pet.asleep, false)
  assert.ok(awake.pet.log[0].text.includes("woke"))
})

test("live: actions, touches and who's here reach only the partner", async (t) => {
  const s = serve()
  t.after(s.close)
  await pair(s.call)
  await adopt(s.pet)
  await s.pet("alice", "POST", "/act", { action: "feed", food: "strawberry" })
  const fed = s.events("bobby", "couple:pet").find((e) => e.payload.kind === "feed")
  assert.equal(fed.payload.text, "Alice fed Mochi a strawberry")
  assert.ok(!s.events("alice", "couple:pet").some((e) => e.payload.kind === "feed"), "not echoed back")
  assert.equal((await s.pet("alice", "POST", "/here", { open: true })).http, 200)
  assert.equal(s.events("bobby", "couple:pet-here").length, 1)
  assert.equal((await s.pet("bobby", "GET", "/")).partnerHere, true)
  await s.pet("alice", "POST", "/here", { open: true }) // a ping, not news
  assert.equal(s.events("bobby", "couple:pet-here").length, 1)
  await s.pet("alice", "POST", "/touch", { kind: "scrub", x: 3, y: 0.25 })
  const touch = s.events("bobby", "couple:pet-touch")[0].payload
  assert.deepEqual(touch, { by: "Alice", kind: "scrub", x: 1, y: 0.25 })
  await s.pet("alice", "POST", "/touch", { kind: "<script>", x: 0, y: 0 })
  assert.equal(s.events("bobby", "couple:pet-touch").length, 1)
  await s.pet("alice", "POST", "/here", { open: false })
  assert.equal((await s.pet("bobby", "GET", "/")).partnerHere, false)
  assert.equal(s.events("carol").length, 0)
})

test("rate limits", async (t) => {
  const s = serve({ limits: { writesPerMinute: 5, touchesPerMinute: 3 } })
  t.after(s.close)
  await pair(s.call)
  await adopt(s.pet)
  const codes = []
  for (let i = 0; i < 6; i++) codes.push((await s.pet("alice", "POST", "/act", { action: "pet" })).http)
  assert.ok(codes.includes(429))
  assert.equal(codes.filter((c) => c === 200).length, 4) // adopting was the first write
  assert.equal((await s.pet("bobby", "POST", "/act", { action: "pet" })).http, 200, "each partner has their own")
  const touches = []
  for (let i = 0; i < 5; i++) touches.push((await s.pet("alice", "POST", "/touch", { kind: "cuddle", x: 0.5, y: 0.5 })).http)
  assert.deepEqual(touches, [200, 200, 200, 429, 429])
})
