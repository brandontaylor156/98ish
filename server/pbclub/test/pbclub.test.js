const test = require("node:test")
const assert = require("node:assert/strict")
const express = require("express")
const { createClub } = require("..")
const { memoryStore } = require("../store")

const NAMES = { alice: "Alice", bob: "Bob", carol: "Carol", dave: "Dave", erin: "Erin" }
const TOKENS = Object.fromEntries(Object.keys(NAMES).map((k, i) => [k, String.fromCharCode(97 + i).repeat(48)]))
const DAY = 86_400_000

// a server with five signed-on 98 Messenger sessions, sockets that remember what they got,
// a push service that remembers its notifications, and a clock the test moves
const start = async ({ blocked = {} } = {}) => {
  const emitted = []
  const pushed = []
  let t = Date.UTC(2026, 9, 6, 17)
  const clock = () => t
  const sessions = new Map(Object.keys(NAMES).map((key) => [key, { key, token: TOKENS[key], user: { screenName: NAMES[key], blocked: blocked[key] || [] }, socket: { emit: (event, payload) => emitted.push({ to: key, event, payload }) } }]))
  const aim = { sessions, store: { find: async (key) => (NAMES[key] ? { screenName: NAMES[key], blocked: blocked[key] || [] } : null) } }
  const push = { notify: async (key, category, message) => (pushed.push({ key, category, message }), { sent: 1 }) }
  const store = memoryStore()
  const club = createClub({ aim: () => aim, store, push, now: clock })
  const app = express()
  app.use("/api/pbclub", club.router())
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/pbclub`
  const call = async (who, path, body) => {
    const response = await fetch(base + path, { method: "POST", headers: { ...(who ? { Authorization: `Bearer ${TOKENS[who]}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
    return { status: response.status, body: await response.json() }
  }
  return { call, club, store, emitted, pushed, close: () => server.close(), now: () => t, advance: (ms) => (t += ms) }
}

const doubles = (s, games, extra = {}) => ({ kind: "doubles", teams: [[{ k: "alice" }, { k: "bob" }], [{ k: "carol" }, { k: "dave" }]], games, at: s.now() - 3_600_000, venue: { id: "loscab" }, ...extra })

test("a logged match waits for an opponent; partners can't confirm; ratings move once confirmed", async (t) => {
  const s = await start()
  t.after(s.close)
  assert.equal((await s.call(null, "/state")).status, 401)
  let r = await s.call("alice", "/match", { match: doubles(s, [[11, 6]]) })
  assert.equal(r.status, 200)
  const m = r.body.match
  assert.equal(m.status, "pending")
  assert.deepEqual(m.names, { alice: "Alice", bob: "Bob", carol: "Carol", dave: "Dave" })
  // the opponents got a live notice and a push asking to confirm; the partner a notice only
  assert.deepEqual(s.pushed.map((p) => p.key).sort(), ["carol", "dave"])
  assert.equal(s.pushed[0].category, "pickleball")
  assert.match(s.pushed[0].message.url, /pbmatch=/)
  assert.ok(s.emitted.some((e) => e.to === "bob" && e.event === "pb:changed"))
  // pending: nobody's rating yet
  r = await s.call("alice", "/state")
  assert.deepEqual(r.body.ladder.doubles, {})
  assert.equal((await s.call("bob", `/match/${m.id}`, { act: "confirm" })).status, 409, "a partner can't confirm")
  assert.equal((await s.call("erin", `/match/${m.id}`, { act: "confirm" })).status, 404, "someone not in it can't see it")
  r = await s.call("carol", `/match/${m.id}`, { act: "confirm" })
  assert.equal(r.body.match.status, "confirmed")
  r = await s.call("alice", "/state")
  assert.ok(r.body.ladder.doubles["k:alice"].r > 1500)
  assert.ok(r.body.ladder.doubles["k:carol"].r < 1500)
  // the logger can't delete a confirmed match: ask to remove it, the other team agrees
  assert.equal((await s.call("alice", `/match/${m.id}`, { act: "delete" })).status, 409)
  r = await s.call("alice", `/match/${m.id}`, { act: "remove" })
  assert.equal(r.body.match.status, "removing")
  assert.equal((await s.call("bob", `/match/${m.id}`, { act: "agree" })).status, 409, "your own team can't agree")
  r = await s.call("dave", `/match/${m.id}`, { act: "agree" })
  assert.equal(r.body.removed, m.id)
  r = await s.call("alice", "/state")
  assert.equal(r.body.matches.length, 0)
  assert.deepEqual(r.body.ladder.doubles, {})
})

test("disputes, guests (unrated), sent-twice matches, expiry, logging others' games", async (t) => {
  const s = await start()
  t.after(s.close)
  let r = await s.call("alice", "/match", { match: doubles(s, [[11, 9]]) })
  const m = r.body.match
  r = await s.call("dave", `/match/${m.id}`, { act: "dispute" })
  assert.equal(r.body.match.status, "disputed")
  assert.ok(s.pushed.some((p) => p.key === "alice" && /isn't right/.test(p.message.title)))
  assert.equal((await s.call("alice", `/match/${m.id}`, { act: "delete" })).body.removed, m.id)
  // a guest opponent: in the record, not the ratings; nobody needs to confirm
  r = await s.call("alice", "/match", { match: { ...doubles(s, [[11, 2]]), teams: [[{ k: "alice" }, { k: "bob" }], [{ k: "carol" }, { g: "Uncle Ray" }]] } })
  assert.equal(r.body.match.status, "unrated")
  // the offline queue sending the same match twice keeps one
  const id = "0123456789abcdef"
  await s.call("alice", "/match", { match: doubles(s, [[11, 4]], { id }) })
  r = await s.call("alice", "/match", { match: doubles(s, [[11, 4]], { id }) })
  assert.equal(r.body.duplicate, true)
  r = await s.call("alice", "/state")
  assert.equal(r.body.matches.filter((x) => x.id === id).length, 1)
  // nobody confirms within 7 days: expired, and can't be confirmed
  s.advance(8 * DAY)
  r = await s.call("carol", "/state")
  assert.equal(r.body.matches.find((x) => x.id === id).status, "expired")
  assert.equal((await s.call("carol", `/match/${id}`, { act: "confirm" })).status, 409)
  // a game you didn't play can't be logged, except at a session you're both in
  assert.equal((await s.call("erin", "/match", { match: doubles(s, [[11, 5]]) })).status, 403)
  // unknown and blocking accounts are refused
  assert.equal((await s.call("alice", "/match", { match: { ...doubles(s, [[11, 5]]), teams: [[{ k: "alice" }, { k: "bob" }], [{ k: "carol" }, { k: "zed" }]] } })).status, 404)
})

test("blocked players can't be added", async (t) => {
  const s = await start({ blocked: { carol: ["alice"] } })
  t.after(s.close)
  assert.equal((await s.call("alice", "/match", { match: doubles(s, [[11, 5]]) })).status, 409)
  assert.equal((await s.call("alice", "/session", { session: { venue: { id: "smash" }, start: s.now() + DAY }, invite: ["Carol"] })).status, 409)
})

test("sessions: invite, RSVP, waitlist moves up with a push, late, chat, rotation, cancel", async (t) => {
  const s = await start()
  t.after(s.close)
  let r = await s.call("alice", "/session", { session: { venue: { id: "wolfbear" }, start: s.now() + DAY, max: 2, courts: 1 }, invite: ["Bob", "Carol", "bob"] })
  assert.equal(r.status, 200)
  const id = r.body.session.id
  assert.deepEqual(r.body.session.invited, ["bob", "carol"])
  assert.equal(r.body.session.rsvps.alice.s, "in", "the host is in")
  assert.equal(r.body.session.title, "Open play at Wolf + Bear")
  assert.deepEqual(s.pushed.map((p) => p.key), ["bob", "carol"])
  assert.match(s.pushed[0].message.title, /invited you/)
  // not invited: can't see it
  assert.equal((await s.call("erin", `/session/${id}/rsvp`, { s: "in" })).status, 404)
  r = await s.call("erin", "/state")
  assert.equal(r.body.sessions.length, 0)
  // max 2: bob is in, carol waits
  await s.call("bob", `/session/${id}/rsvp`, { s: "in" })
  s.advance(1000)
  r = await s.call("carol", `/session/${id}/rsvp`, { s: "in" })
  r = await s.call("carol", "/state")
  const sess = r.body.sessions[0]
  assert.equal(sess.max, 2)
  s.pushed.length = 0
  // bob drops out: carol moves up and is told
  await s.call("bob", `/session/${id}/rsvp`, { s: "out" })
  assert.ok(s.pushed.some((p) => p.key === "carol" && p.message.title === "You're in!"))
  // running late reaches the host
  r = await s.call("carol", `/session/${id}/rsvp`, { late: 10 })
  assert.equal(r.body.session.rsvps.carol.late, 10)
  assert.ok(s.pushed.some((p) => p.key === "alice" && /10 min late/.test(p.message.title)))
  assert.equal((await s.call("carol", `/session/${id}/rsvp`, { late: 7 })).status, 400)
  // chat and rotation (only people who are in run the courts)
  r = await s.call("carol", `/session/${id}/say`, { text: "  bringing balls  " })
  assert.deepEqual(r.body.session.chat.map((c) => [c.k, c.t]), [["carol", "bringing balls"]])
  assert.equal((await s.call("bob", `/session/${id}/rotation`, { rotation: { rounds: [] } })).status, 403)
  r = await s.call("carol", `/session/${id}/rotation`, { rotation: { mode: "mix", rounds: [{ courts: [], sitting: [] }] } })
  assert.equal(r.body.session.rotation.by, "carol")
  // invited people may invite more (open); the host can turn that off
  r = await s.call("carol", `/session/${id}/invite`, { to: ["Dave"] })
  assert.deepEqual(r.body.added, ["Dave"])
  r = await s.call("alice", "/session", { id, session: { ...sess, open: false } })
  assert.equal((await s.call("carol", `/session/${id}/invite`, { to: ["Erin"] })).status, 403)
  assert.equal((await s.call("carol", "/session", { id, session: sess })).status, 403, "only the host edits")
  // moving it tells everyone who isn't out
  s.pushed.length = 0
  await s.call("alice", "/session", { id, session: { ...sess, start: sess.start + 3_600_000 } })
  assert.deepEqual(s.pushed.map((p) => p.key).sort(), ["carol", "dave"])
  // cancel
  s.pushed.length = 0
  r = await s.call("alice", `/session/${id}/cancel`)
  assert.equal(r.body.session.cancelled, true)
  assert.ok(s.pushed.some((p) => p.key === "carol" && /cancelled/.test(p.message.title)))
  assert.equal((await s.call("carol", `/session/${id}/rsvp`, { s: "in" })).status, 409)
  // a match at the session can be logged by someone in it who didn't play
  const m = await s.call("carol", "/match", { match: { ...doubles(s, [[11, 3]]), teams: [[{ k: "alice" }, { k: "bob" }], [{ k: "dave" }, { k: "erin" }]], session: id } })
  assert.equal(m.status, 403, "erin isn't part of the session")
  const ok = await s.call("carol", "/match", { match: { kind: "singles", teams: [[{ k: "alice" }], [{ k: "dave" }]], games: [[11, 3]], at: s.now(), session: id } })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.match.status, "pending")
  assert.equal((await s.call("alice", `/match/${ok.body.match.id}`, { act: "confirm" })).body.match.status, "confirmed", "logged by a non-player: either side confirms")
})

test("caps: sessions hosted, matches a day", async (t) => {
  const s = await start()
  t.after(s.close)
  for (let i = 0; i < 30; i++) assert.equal((await s.call("alice", "/session", { session: { venue: { id: "smash" }, start: s.now() + DAY + i } })).status, 200)
  assert.equal((await s.call("alice", "/session", { session: { venue: { id: "smash" }, start: s.now() + 2 * DAY } })).status, 413)
  for (let i = 0; i < 60; i++) await s.call("bob", "/match", { match: { kind: "singles", teams: [[{ k: "bob" }], [{ g: "Wall" }]], games: [[11, i % 10]], at: s.now() } })
  assert.equal((await s.call("bob", "/match", { match: { kind: "singles", teams: [[{ k: "bob" }], [{ g: "Wall" }]], games: [[11, 1]], at: s.now() } })).status, 429)
  // old sessions are swept 30 days after they start
  s.advance(40 * DAY)
  await s.club.sweep()
  assert.equal((await s.store.sessions.forKey("alice")).length, 0)
})

test("Delete My Account: hosted sessions go, others keep their records as 'Deleted player'", async (t) => {
  const s = await start()
  t.after(s.close)
  const mine = (await s.call("bob", "/session", { session: { venue: { id: "paseo" }, start: s.now() + DAY }, invite: ["Alice"] })).body.session.id
  const theirs = (await s.call("alice", "/session", { session: { venue: { id: "paseo" }, start: s.now() + DAY }, invite: ["Bob"] })).body.session.id
  await s.call("bob", `/session/${theirs}/rsvp`, { s: "in" })
  await s.call("bob", `/session/${theirs}/say`, { text: "hi" })
  const m = (await s.call("alice", "/match", { match: doubles(s, [[11, 6]]) })).body.match
  await s.call("carol", `/match/${m.id}`, { act: "confirm" })
  const pending = (await s.call("bob", "/match", { match: { kind: "singles", teams: [[{ k: "bob" }], [{ k: "erin" }]], games: [[11, 1]], at: s.now() } })).body.match
  const before = (await s.call("alice", "/state")).body.ladder.doubles["k:alice"].r
  const result = await s.club.eraseAccount({ key: "bob" })
  assert.deepEqual(result, { sessionsRemoved: 1, sessionsLeft: 1, matchesAnon: 1, matchesRemoved: 1 })
  assert.equal(await s.store.sessions.get(mine), null)
  const sess = await s.store.sessions.get(theirs)
  assert.ok(!JSON.stringify(sess).includes("bob"), "no trace in the session")
  const left = await s.store.matches.get(m.id)
  assert.ok(!JSON.stringify(left).includes("bob"))
  assert.ok(Object.values(left.names).includes("Deleted player"))
  assert.equal(await s.store.matches.get(pending.id), null)
  // alice's rating didn't change
  assert.equal((await s.call("alice", "/state")).body.ladder.doubles["k:alice"].r, before)
  // a second run finds nothing
  assert.deepEqual(await s.club.eraseAccount({ key: "bob" }), { sessionsRemoved: 0, sessionsLeft: 0, matchesAnon: 0, matchesRemoved: 0 })
})
