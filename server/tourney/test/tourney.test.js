const test = require("node:test")
const assert = require("node:assert/strict")
const express = require("express")
const { createTourneys } = require("..")
const { memoryStore } = require("../store")

const NAMES = { alice: "Alice", bob: "Bob", carol: "Carol", dave: "Dave", erin: "Erin" }
const TOKENS = Object.fromEntries(Object.keys(NAMES).map((k, i) => [k, String.fromCharCode(97 + i).repeat(48)]))
const MIN = 60_000

// Friday 2026-10-09, noon in Los Angeles
const start = async ({ blocked = {} } = {}) => {
  const emitted = []
  const pushed = []
  let t = Date.UTC(2026, 9, 9, 19)
  const sessions = new Map(Object.keys(NAMES).map((key) => [key, { key, token: TOKENS[key], user: { screenName: NAMES[key], blocked: blocked[key] || [] }, socket: { emit: (event, payload) => emitted.push({ to: key, event, payload }) } }]))
  const aim = { sessions, store: { find: async (key) => (NAMES[key] ? { screenName: NAMES[key], blocked: blocked[key] || [] } : null) } }
  const push = { notify: async (key, category, message) => (pushed.push({ key, category, message }), { sent: 1 }) }
  const store = memoryStore()
  const tourneys = createTourneys({ aim: () => aim, store, push, now: () => t })
  const app = express()
  app.use("/api/tourney", tourneys.router())
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/tourney`
  const call = async (who, path, body) => {
    const response = await fetch(base + path, { method: "POST", headers: { ...(who ? { Authorization: `Bearer ${TOKENS[who]}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
    return { status: response.status, body: await response.json() }
  }
  return { call, tourneys, store, emitted, pushed, close: () => server.close(), now: () => t, set: (x) => (t = x), advance: (ms) => (t += ms) }
}

const NARROWS = "narrows-20261011" // Sunday 2 PM in Los Angeles
const NARROWS_START = Date.UTC(2026, 9, 11, 21)
const myMatch = (tourney, key) => {
  for (const b of Object.values(tourney.brackets)) {
    if (!b) continue
    for (const row of b.rounds)
      for (const m of row) {
        if (m.w || !m.a || !m.b) continue
        const side = b.teams[m.a].players.some((p) => p.k === key) ? "a" : b.teams[m.b].players.some((p) => p.k === key) ? "b" : null
        if (side) return { m, side }
      }
  }
  return null
}

test("the schedule, signing up with a partner, the draw, playing, walkovers and trophies", async (t) => {
  const s = await start({ blocked: { erin: ["dave"] } })
  t.after(s.close)
  assert.equal((await s.call(null, "/list")).status, 401)
  let r = await s.call("alice", "/list")
  assert.equal(r.status, 200)
  const narrows = r.body.events.find((e) => e.id === NARROWS)
  assert.ok(narrows, "the Narrows Open is on Sunday")
  assert.equal(narrows.start, NARROWS_START)
  assert.equal(narrows.name, "Narrows Open")
  assert.equal(narrows.venue, "whittier")
  assert.deepEqual(narrows.divisions.map((d) => d.id), ["d30", "d40", "s"])
  assert.ok(r.body.events.some((e) => e.id === "riverside-20261009"), "Riverside Nightly tonight")
  assert.ok(r.body.events.every((e, i, a) => i === 0 || a[i - 1].start <= e.start), "soonest first")
  assert.equal((await s.call("alice", "/get", { id: "narrows-20261012" })).status, 404, "not on a Monday")

  // Alice signs up with Bob; Bob is asked
  r = await s.call("alice", "/enter", { id: NARROWS, div: "d30", partner: "Bob" })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.ok(s.emitted.some((e) => e.to === "bob" && e.payload.partner))
  assert.ok(s.pushed.some((p) => p.key === "bob" && p.category === "pickleball" && /Alice wants you as a partner/.test(p.message.title)))
  assert.equal((await s.call("alice", "/enter", { id: NARROWS, div: "s" })).status, 409, "one entry each")
  assert.equal((await s.call("bob", "/enter", { id: NARROWS, div: "d40" })).status, 409, "Bob is Alice's partner")
  assert.equal((await s.call("carol", "/enter", { id: NARROWS, div: "d30", partner: "SmarterChild" })).status, 400)
  assert.equal((await s.call("carol", "/enter", { id: NARROWS, div: "d30", partner: "Nobody Here" })).status, 404)
  assert.equal((await s.call("dave", "/enter", { id: NARROWS, div: "d30", partner: "Erin" })).status, 409, "blocked")
  assert.equal((await s.call("carol", "/enter", { id: NARROWS, div: "mx" })).status, 409, "not a division here")
  assert.equal((await s.call("carol", "/enter", { id: NARROWS, div: "s", partner: "Dave" })).status, 409, "singles is just you")
  r = await s.call("bob", "/partner", { id: NARROWS, act: "accept" })
  assert.equal(r.status, 200)
  assert.equal(r.body.tourney.entries[0].partner.ok, true)
  assert.equal((await s.call("carol", "/enter", { id: NARROWS, div: "s" })).status, 200)
  assert.equal((await s.call("dave", "/enter", { id: NARROWS, div: "d30", partner: "" })).status, 200, "a computer partner")
  assert.equal((await s.call("dave", "/withdraw", { id: NARROWS })).status, 200)
  assert.equal((await s.call("dave", "/enter", { id: NARROWS, div: "d30" })).status, 200)
  r = await s.call("erin", "/list")
  assert.deepEqual(r.body.events.find((e) => e.id === NARROWS).divisions.map((d) => d.count), [2, 0, 1])

  // the start: the sweep draws it and tells everyone their first match
  s.set(NARROWS_START + MIN)
  await s.tourneys.sweep()
  for (const k of ["alice", "bob", "carol", "dave"]) assert.ok(s.pushed.some((p) => p.key === k && /Narrows Open has started/.test(p.message.title)), k)
  r = await s.call("alice", "/get", { id: NARROWS })
  let tour = r.body.tourney
  assert.equal(tour.status, "live")
  assert.equal(tour.brackets.d30.size, 4)
  assert.equal(tour.brackets.d40, null, "nobody in it: not played")
  assert.equal(tour.brackets.s.size, 4)
  assert.equal(Object.values(tour.brackets.d30.teams).filter((x) => x.cpu).length, 2, "computer teams fill the bracket")
  assert.ok(tour.brackets.d30.teams[tour.entries.find((e) => e.keys[0] === "dave").id].players[1].cpu, "Dave's computer partner")
  assert.equal(tour.seed, undefined, "the seed stays on the server")
  assert.equal((await s.call("carol", "/enter", { id: NARROWS, div: "s" })).status, 409, "closed")
  assert.equal((await s.call("alice", "/withdraw", { id: NARROWS })).status, 409)

  // Alice plays her semi (vs computers) and wins; scores are checked
  let mm = myMatch(tour, "alice")
  assert.equal((await s.call("alice", "/report", { id: NARROWS, match: mm.m.id, score: [11, 10] })).status, 409, "win by 2")
  assert.equal((await s.call("erin", "/report", { id: NARROWS, match: mm.m.id, score: [11, 4] })).status, 409, "not her match")
  const score = mm.side === "a" ? [11, 7] : [7, 11]
  r = await s.call("bob", "/report", { id: NARROWS, match: mm.m.id, score })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  // Carol wins her singles semi
  tour = r.body.tourney
  mm = myMatch(tour, "carol")
  assert.equal((await s.call("carol", "/report", { id: NARROWS, match: mm.m.id, score: mm.side === "a" ? [11, 3] : [3, 11] })).status, 200)
  // Dave doesn't play: when the round's 30 minutes run out, the computers go through
  s.advance(31 * MIN)
  r = await s.call("dave", "/get", { id: NARROWS })
  tour = r.body.tourney
  const daveFinal = tour.brackets.d30.rounds[0].find((m) => [m.a, m.b].includes(tour.entries.find((e) => e.keys[0] === "dave").id))
  assert.equal(daveFinal.how, "walkover")
  // the final: Alice and Bob win it; Carol loses hers
  mm = myMatch(tour, "alice")
  assert.equal(mm.m.r, 1)
  assert.equal((await s.call("alice", "/report", { id: NARROWS, match: mm.m.id, score: mm.side === "a" ? [13, 11] : [11, 13] })).status, 200)
  mm = myMatch((await s.call("carol", "/get", { id: NARROWS })).body.tourney, "carol")
  r = await s.call("carol", "/report", { id: NARROWS, match: mm.m.id, score: mm.side === "a" ? [6, 11] : [11, 6] })
  assert.equal(r.body.tourney.status, "done")
  // trophies on the shelves, and a push
  r = await s.call("alice", "/list")
  assert.equal(r.body.trophies.length, 1)
  assert.equal(r.body.trophies[0].place, 1)
  assert.equal(r.body.trophies[0].name, "Narrows Open")
  assert.equal(r.body.trophies[0].partner, "Bob")
  assert.equal((await s.call("bob", "/list")).body.trophies[0].place, 1)
  assert.equal((await s.call("carol", "/list")).body.trophies[0].place, 2)
  assert.equal((await s.call("dave", "/list")).body.trophies.length, 0)
  assert.ok(s.pushed.some((p) => p.key === "alice" && /You won the Narrows Open/.test(p.message.title)))
  // awarded once
  await s.tourneys.sweep()
  assert.equal((await s.call("alice", "/list")).body.trophies.length, 1)
})

test("people against people: the room code, checking in, and the clock deciding", async (t) => {
  const s = await start()
  t.after(s.close)
  const id = "riverside-20261009" // tonight 8 PM
  const at = Date.UTC(2026, 9, 10, 3)
  for (const k of ["alice", "carol"]) assert.equal((await s.call(k, "/enter", { id, div: "s" })).status, 200)
  s.set(at + MIN)
  let tour = (await s.call("alice", "/get", { id })).body.tourney
  // seeds 1 and 2 only meet in the final: both win their semis
  for (const k of ["alice", "carol"]) {
    const mm = myMatch(tour, k)
    assert.equal(mm.m.r, 0)
    tour = (await s.call(k, "/report", { id, match: mm.m.id, score: mm.side === "a" ? [11, 5] : [5, 11] })).body.tourney
  }
  const fin = myMatch(tour, "alice")
  assert.equal(fin.m.r, 1)
  assert.equal(myMatch(tour, "carol").m.id, fin.m.id, "the final is Alice v Carol")
  assert.equal((await s.call("carol", "/room", { id, match: fin.m.id, code: "no!" })).status, 400)
  const r = await s.call("carol", "/room", { id, match: fin.m.id, code: "k7qx" })
  assert.equal(r.status, 200)
  assert.ok(s.emitted.some((e) => e.to === "alice" && e.event === "pb:changed" && e.payload.kind === "tourney"))
  const m = r.body.tourney.brackets.s.rounds[1][0]
  assert.equal(m.room, "K7QX")
  // Alice never shows up: when the final's time runs out, Carol (checked in) wins it
  s.set(at + 61 * MIN)
  tour = (await s.call("alice", "/get", { id })).body.tourney
  assert.equal(tour.status, "done")
  const final = tour.brackets.s.rounds[1][0]
  assert.equal(final.how, "walkover")
  assert.equal(tour.brackets.s.teams[tour.brackets.s.champion].players[0].k, "carol")
  assert.equal((await s.call("alice", "/report", { id, match: final.id, score: [11, 0] })).status, 409, "too late")
})

test("caps: six upcoming sign-ups each; Delete My Account takes them out and keeps others' results", async (t) => {
  const s = await start()
  t.after(s.close)
  const events = (await s.call("erin", "/list")).body.events.filter((e) => e.status === "open")
  let ok = 0
  for (const e of events.slice(0, 7)) if ((await s.call("erin", "/enter", { id: e.id, div: e.divisions[0].id })).status === 200) ok++
  assert.equal(ok, 6)
  assert.equal((await s.call("erin", "/enter", { id: events[6].id, div: events[6].divisions[0].id })).status, 429)

  // an open one: Dave invited Erin; a played one: Alice won with Bob
  const id = NARROWS
  assert.equal((await s.call("alice", "/enter", { id, div: "d30", partner: "Bob" })).status, 200)
  await s.call("bob", "/partner", { id, act: "accept" })
  s.set(NARROWS_START + MIN)
  let tour = (await s.call("alice", "/get", { id })).body.tourney
  let mm = myMatch(tour, "alice")
  tour = (await s.call("alice", "/report", { id, match: mm.m.id, score: mm.side === "a" ? [11, 2] : [2, 11] })).body.tourney
  mm = myMatch(tour, "alice")
  await s.call("alice", "/report", { id, match: mm.m.id, score: mm.side === "a" ? [11, 2] : [2, 11] })
  assert.equal((await s.call("bob", "/list")).body.trophies.length, 1)

  const before = (await s.store.tourneys.forKey("erin")).length
  assert.ok(before >= 6)
  const out = await s.tourneys.eraseAccount({ key: "alice" })
  assert.ok(out.tourneysChanged >= 1)
  assert.equal((await s.store.trophies.get("alice")).length, 0, "her shelf is gone")
  assert.equal((await s.store.trophies.get("bob")).length, 1, "Bob keeps his")
  tour = (await s.call("bob", "/get", { id })).body.tourney
  const team = Object.values(tour.brackets.d30.teams).find((x) => x.players.some((p) => p.k === "bob"))
  assert.equal(team.players.find((p) => p.k !== "bob").name, "Deleted player")
  assert.ok(!JSON.stringify(tour).includes('"alice"'))
  assert.ok(!JSON.stringify(tour).includes("Alice"))
  // before the start: Erin's sign-ups simply go
  await s.tourneys.eraseAccount({ key: "erin" })
  const left = (await s.store.tourneys.forKey("erin")).filter((d) => d.status === "open")
  assert.equal(left.length, 0)
})
