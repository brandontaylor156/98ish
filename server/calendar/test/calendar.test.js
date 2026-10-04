const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const express = require("express")
const calendar = require("..")
const { memoryStore } = require("../store")
const v = require("../validate")

const token = (c) => c.repeat(48)
const TOKENS = { alice: token("a"), bobby: token("b"), carol: token("c"), dave: token("d") }
const CHI = "America/Chicago"
const at = (iso) => Date.parse(iso)

// A fake 98 Messenger: four accounts, all signed on, sockets that record what they're sent
const fakeAim = () => {
  const users = {
    alice: { key: "alice", screenName: "Alice", blocked: [] },
    bobby: { key: "bobby", screenName: "Bobby", blocked: [] },
    carol: { key: "carol", screenName: "Carol", blocked: [] },
    dave: { key: "dave", screenName: "Dave", blocked: ["carol"] },
  }
  const socket = () => ({ events: [], emit(event, payload) { this.events.push({ event, payload }) } })
  const sessions = new Map(Object.values(users).map((u) => [u.key, { key: u.key, user: u, socket: socket() }]))
  const byToken = Object.fromEntries(Object.entries(TOKENS).map(([k, t]) => [t, k]))
  return { users, sessions, authenticate: (t) => sessions.get(byToken[t]) || null, store: { find: async (key) => users[key] || null } }
}

// A fake couples service: Alice and Bobby are paired until unpair()
const fakeCouples = () => {
  const pair = { id: "c0ffee", a: "alice", b: "bobby", names: { alice: "Alice", bobby: "Bobby" }, status: "paired" }
  return {
    pair,
    pairedWith: (key) => (pair.status === "paired" && (pair.a === key || pair.b === key) ? pair : null),
    isActiveCouple: (id) => id === pair.id && pair.status === "paired",
    unpair: () => (pair.status = "ended"),
    repair: () => (pair.status = "paired"),
  }
}

const serve = (limits = {}) => {
  const aim = fakeAim()
  const couples = fakeCouples()
  let time = at("2026-10-03T17:00:00Z")
  const service = calendar.createCalendars({ store: memoryStore(), aim, couples, now: () => time, limits: { writesPerMinute: 10000, writesPerHour: 100000, invitesPerHour: 1000, joinsPerHour: 1000, ...limits } })
  const app = express()
  app.use("/api/calendar", calendar.calendarRouter({ service }))
  const server = http.createServer(app).listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api/calendar`
  const call = (who, method, path, body) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${TOKENS[who] || who}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ ...(await r.json().catch(() => ({}))), http: r.status }))
  const raw = (path) => fetch(base + path).then(async (r) => ({ http: r.status, text: await r.text(), type: r.headers.get("content-type") }))
  const events = (who, name) => aim.sessions.get(who).socket.events.filter((e) => !name || e.event === name)
  const clear = () => aim.sessions.forEach((s) => (s.socket.events = []))
  return { aim, couples, service, call, raw, events, clear, close: () => server.close(), advance: (ms) => (time += ms) }
}

const dinner = (extra = {}) => ({ title: "Dinner", allDay: false, start: at("2026-10-10T00:00:00Z"), end: at("2026-10-10T02:00:00Z"), tz: CHI, location: "Luigi's", reminders: [30, 0], ...extra })

// Alice makes "Family" and Bobby joins it with its code
const family = async (call) => {
  const made = await call("alice", "POST", "/calendars", { name: "Family", color: "green" })
  assert.equal(made.http, 200)
  const joined = await call("bobby", "POST", "/join", { code: made.calendar.code })
  assert.equal(joined.http, 200, joined.error)
  return made.calendar
}

test("checks events", () => {
  const ok = v.event(dinner())
  assert.equal(ok.title, "Dinner")
  assert.deepEqual(ok.reminders, [0, 30])
  assert.throws(() => v.event(dinner({ title: "" })), v.Invalid)
  assert.throws(() => v.event(dinner({ title: "x".repeat(121) })), v.Invalid)
  assert.throws(() => v.event(dinner({ end: at("2026-10-09T00:00:00Z") })), /end after/)
  assert.throws(() => v.event(dinner({ tz: "Mars/Olympus" })), /time zone/)
  assert.throws(() => v.event(dinner({ reminders: [7] })), /reminder/)
  assert.throws(() => v.event(dinner({ start: "<script>" })), v.Invalid)
  assert.throws(() => v.event({ title: "Trip", allDay: true, start: "2026-02-30" }), v.Invalid)
  assert.throws(() => v.event(dinner({ repeat: { freq: "hourly" } })), v.Invalid)
  assert.throws(() => v.event(dinner({ repeat: { freq: "weekly", byDay: [9] } })), v.Invalid)
  const weekly = v.event(dinner({ repeat: { freq: "weekly", interval: 1, byDay: [5, 1, 5], count: 4 }, exceptions: { "2026-10-16": { deleted: true }, "2026-10-23": { title: "Late dinner", sneaky: "x" } } }))
  assert.deepEqual(weekly.repeat, { freq: "weekly", interval: 1, byDay: [1, 5], count: 4 })
  assert.deepEqual(weekly.exceptions, { "2026-10-16": { deleted: true }, "2026-10-23": { title: "Late dinner" } })
  // attendees must be members; text stays text
  assert.deepEqual(v.event(dinner({ attendees: ["alice", "mallory"], notes: "<b>hi</b>" }), { memberKeys: ["alice"] }).attendees, ["alice"])
  assert.equal(v.event(dinner({ notes: "<b>hi</b>" })).notes, "<b>hi</b>")
  const memo = v.event({ kind: "memo", title: "Gift ideas", checklist: [{ text: "Scarf" }, { text: "" }], start: 5 })
  assert.equal(memo.start, null)
  assert.deepEqual(memo.checklist, [{ text: "Scarf", done: false }])
})

test("every route needs a signed-on 98 Messenger user", async () => {
  const { call, close } = serve()
  try {
    const id = "a".repeat(18)
    const routes = [
      ["GET", "/"], ["POST", "/calendars", { name: "x" }], ["PATCH", `/calendars/${id}`, {}], ["DELETE", `/calendars/${id}`], ["PATCH", `/calendars/${id}/me`, {}],
      ["POST", `/calendars/${id}/invite`, { to: "Bobby" }], ["POST", `/calendars/${id}/code`], ["DELETE", `/calendars/${id}/code`], ["POST", "/join", { code: "ABCDEFGH" }],
      ["POST", `/calendars/${id}/accept`], ["POST", `/calendars/${id}/decline`], ["POST", `/calendars/${id}/leave`], ["DELETE", `/calendars/${id}/members/bobby`],
      ["GET", `/calendars/${id}/events`], ["POST", `/calendars/${id}/events`, { event: dinner() }], ["POST", `/calendars/${id}/import`, { events: [] }],
      ["PUT", `/calendars/${id}/events/${id}`, { event: dinner() }], ["PATCH", `/calendars/${id}/events/${id}/occurrence`, { key: "2026-10-10", change: { deleted: true } }],
      ["DELETE", `/calendars/${id}/events/${id}`], ["GET", `/calendars/${id}/events/${id}/comments`], ["POST", `/calendars/${id}/events/${id}/comments`, { text: "hi" }],
      ["DELETE", `/calendars/${id}/events/${id}/comments/${id}`], ["GET", `/calendars/${id}/activity`], ["GET", `/calendars/${id}/feed`], ["POST", `/calendars/${id}/feed`],
    ]
    for (const [method, path, body] of routes) {
      assert.equal((await call(null, method, path, body)).http, 401, `${method} ${path}`)
      assert.equal((await call("e".repeat(48), method, path, body)).http, 401, `${method} ${path} with a stranger's token`)
    }
  } finally {
    close()
  }
})

test("a personal calendar for everyone, and an Us calendar for a couple while they're paired", async () => {
  const { call, couples, close } = serve()
  try {
    const alice = await call("alice", "GET", "/")
    assert.deepEqual(alice.calendars.map((c) => c.kind), ["personal", "couple"])
    const us = alice.calendars[1]
    assert.equal(us.name, "Us")
    assert.deepEqual(us.members.map((m) => m.name).sort(), ["Alice", "Bobby"])
    assert.notEqual(us.members[0].color, us.members[1].color)
    // the same Us calendar for Bobby; his own personal calendar is separate
    const bobby = await call("bobby", "GET", "/")
    assert.equal(bobby.calendars.find((c) => c.kind === "couple").id, us.id)
    assert.notEqual(bobby.calendars[0].id, alice.calendars[0].id)
    // asking again doesn't make more
    assert.equal((await call("alice", "GET", "/")).calendars.length, 2)
    // Carol isn't paired: just her own
    assert.deepEqual((await call("carol", "GET", "/")).calendars.map((c) => c.kind), ["personal"])
    // nobody else can see either calendar
    assert.equal((await call("carol", "GET", `/calendars/${us.id}/events`)).http, 404)
    assert.equal((await call("carol", "GET", `/calendars/${alice.calendars[0].id}/events`)).http, 404)
    assert.equal((await call("bobby", "POST", `/calendars/${alice.calendars[0].id}/events`, { event: dinner() })).http, 404)
    // the Us calendar is just for two
    assert.equal((await call("alice", "POST", `/calendars/${us.id}/invite`, { to: "Carol" })).http, 403)
    assert.equal((await call("alice", "DELETE", `/calendars/${us.id}`)).http, 403)
    assert.equal((await call("alice", "POST", `/calendars/${us.id}/leave`)).http, 403)
    assert.equal((await call("alice", "POST", `/calendars/${us.id}/events`, { event: dinner() })).http, 200)
    // unpaired: hidden from both (and kept, so pairing again brings it back)
    couples.unpair()
    assert.equal((await call("alice", "GET", `/calendars/${us.id}/events`)).http, 404)
    assert.deepEqual((await call("bobby", "GET", "/")).calendars.map((c) => c.kind), ["personal"])
    couples.repair()
    assert.equal((await call("bobby", "GET", `/calendars/${us.id}/events`)).events.length, 1)
  } finally {
    close()
  }
})

test("group calendars: invite by screen name, accept or decline, join by code, roles", async () => {
  const { call, events, clear, close } = serve()
  try {
    const made = await call("alice", "POST", "/calendars", { name: "Book Club", color: "purple" })
    const id = made.calendar.id
    assert.equal(made.calendar.role, "owner")
    assert.match(made.calendar.code, /^[A-Z2-9]{8}$/)
    assert.equal((await call("alice", "POST", "/calendars", { name: "" })).http, 400)
    // invitations
    assert.equal((await call("alice", "POST", `/calendars/${id}/invite`, { to: "Nobody Here" })).http, 404)
    assert.equal((await call("alice", "POST", `/calendars/${id}/invite`, { to: "SmarterChild" })).http, 400)
    assert.equal((await call("alice", "POST", `/calendars/${id}/invite`, { to: "Alice" })).http, 400)
    assert.equal((await call("alice", "POST", `/calendars/${id}/invite`, { to: "carol" })).http, 200)
    assert.deepEqual(events("carol", "cal:invite").map((e) => e.payload), [{ calendarId: id, name: "Book Club", by: "Alice" }])
    const carolSees = await call("carol", "GET", "/")
    assert.deepEqual(carolSees.invites, [{ id, name: "Book Club", by: "Alice", members: 1 }])
    // an invitation isn't membership
    assert.equal((await call("carol", "GET", `/calendars/${id}/events`)).http, 404)
    assert.equal((await call("dave", "POST", `/calendars/${id}/accept`)).http, 404)
    assert.equal((await call("carol", "POST", `/calendars/${id}/accept`)).http, 200)
    assert.equal((await call("carol", "GET", `/calendars/${id}/events`)).http, 200)
    assert.deepEqual((await call("carol", "GET", "/")).invites, [])
    // Dave blocked Carol: Carol can't invite him
    assert.equal((await call("carol", "POST", `/calendars/${id}/invite`, { to: "Dave" })).http, 409)
    // declining
    await call("alice", "POST", `/calendars/${id}/invite`, { to: "Bobby" })
    assert.equal((await call("bobby", "POST", `/calendars/${id}/decline`)).http, 200)
    assert.equal((await call("bobby", "GET", `/calendars/${id}/events`)).http, 404)
    // the code: wrong ones fail, the right one (any case, with a dash) works
    assert.equal((await call("bobby", "POST", "/join", { code: "ZZZZZZZZ" })).http, 404)
    clear()
    const code = made.calendar.code
    const joined = await call("bobby", "POST", "/join", { code: `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}` })
    assert.equal(joined.http, 200)
    assert.equal(joined.calendar.role, "member")
    assert.equal(new Set(joined.calendar.members.map((m) => m.color)).size, 3)
    assert.ok(events("alice", "cal:calendar").some((e) => e.payload.joined === "Bobby"))
    // members can't do the owner's things
    assert.equal((await call("bobby", "PATCH", `/calendars/${id}`, { name: "Bobby's Club" })).http, 403)
    assert.equal((await call("bobby", "POST", `/calendars/${id}/code`)).http, 403)
    assert.equal((await call("bobby", "DELETE", `/calendars/${id}/members/carol`)).http, 403)
    assert.equal((await call("bobby", "DELETE", `/calendars/${id}`)).http, 403)
    // ...but can pick their own color and name the labels
    assert.equal((await call("bobby", "PATCH", `/calendars/${id}/me`, { color: "teal" })).calendar.members.find((m) => m.key === "bobby").color, "teal")
    const labeled = await call("bobby", "PATCH", `/calendars/${id}`, { labels: [{ id: "red", name: "Meetings" }] })
    assert.equal(labeled.calendar.labels.find((l) => l.id === "red").name, "Meetings")
    // a new code shuts the old one
    const fresh = await call("alice", "POST", `/calendars/${id}/code`)
    assert.notEqual(fresh.calendar.code, code)
    assert.equal((await call("dave", "POST", "/join", { code })).http, 404)
    // the owner removes Carol; she's told and locked out
    clear()
    assert.equal((await call("alice", "DELETE", `/calendars/${id}/members/carol`)).http, 200)
    assert.ok(events("carol", "cal:calendar").some((e) => e.payload.removed))
    assert.equal((await call("carol", "GET", `/calendars/${id}/events`)).http, 404)
    // the owner leaves: Bobby takes over
    assert.equal((await call("alice", "POST", `/calendars/${id}/leave`)).http, 200)
    const after = await call("bobby", "GET", "/")
    assert.equal(after.calendars.find((c) => c.id === id).role, "owner")
    // the last one out deletes it
    assert.equal((await call("bobby", "POST", `/calendars/${id}/leave`)).http, 200)
    assert.equal((await call("bobby", "GET", `/calendars/${id}/events`)).http, 404)
  } finally {
    close()
  }
})

test("events: add, change, one occurrence, delete, with live updates to the other members", async () => {
  const { call, events, clear, close } = serve()
  try {
    const fam = await family(call)
    clear()
    const added = await call("alice", "POST", `/calendars/${fam.id}/events`, { event: dinner({ attendees: ["bobby", "carol"] }) })
    assert.equal(added.http, 200, added.error)
    const e = added.event
    assert.equal(e.createdByName, "Alice")
    assert.deepEqual(e.attendees, ["bobby"]) // Carol isn't in Family
    // Bobby hears about it at once; Alice (who did it) doesn't
    const live = events("bobby", "cal:event")
    assert.equal(live.length, 1)
    assert.equal(live[0].payload.event.id, e.id)
    assert.equal(live[0].payload.activity.action, "added")
    assert.match(live[0].payload.activity.when, /Fri, Oct 9/)
    assert.equal(events("alice", "cal:event").length, 0)
    assert.equal(events("carol").length, 0)
    // Bobby changes it into a weekly dinner
    clear()
    const weekly = await call("bobby", "PUT", `/calendars/${fam.id}/events/${e.id}`, { event: { ...e, repeat: { freq: "weekly", interval: 1 } } })
    assert.equal(weekly.http, 200, weekly.error)
    assert.equal(weekly.event.createdByName, "Alice")
    assert.equal(weekly.event.updatedByName, "Bobby")
    assert.equal(events("alice", "cal:event")[0].payload.activity.action, "changed")
    // just one week: a different title, then skip another
    const one = await call("alice", "PATCH", `/calendars/${fam.id}/events/${e.id}/occurrence`, { key: "2026-10-16", change: { title: "Dinner at Mom's" } })
    assert.equal(one.http, 200, one.error)
    assert.deepEqual(one.event.exceptions, { "2026-10-16": { title: "Dinner at Mom's" } })
    await call("alice", "PATCH", `/calendars/${fam.id}/events/${e.id}/occurrence`, { key: "2026-10-23", change: { deleted: true } })
    // undo the change to one
    const undone = await call("alice", "PATCH", `/calendars/${fam.id}/events/${e.id}/occurrence`, { key: "2026-10-16", change: null })
    assert.deepEqual(undone.event.exceptions, { "2026-10-23": { deleted: true } })
    assert.equal((await call("alice", "PATCH", `/calendars/${fam.id}/events/${e.id}/occurrence`, { key: "not-a-day", change: { deleted: true } })).http, 400)
    // a to-do ticked off
    const todo = await call("bobby", "POST", `/calendars/${fam.id}/events`, { event: { title: "Buy milk", allDay: true, start: "2026-10-04", todo: true } })
    const ticked = await call("alice", "PUT", `/calendars/${fam.id}/events/${todo.event.id}`, { event: { ...todo.event, done: true } })
    assert.equal(ticked.event.done, true)
    // the event list
    const list = await call("bobby", "GET", `/calendars/${fam.id}/events`)
    assert.equal(list.events.length, 2)
    // an outsider can't touch them
    assert.equal((await call("carol", "PUT", `/calendars/${fam.id}/events/${e.id}`, { event: e })).http, 404)
    assert.equal((await call("carol", "DELETE", `/calendars/${fam.id}/events/${e.id}`)).http, 404)
    // an event id from another calendar isn't found here
    const mine = (await call("alice", "GET", "/")).calendars[0]
    assert.equal((await call("alice", "PUT", `/calendars/${mine.id}/events/${e.id}`, { event: e })).http, 404)
    // deleting
    clear()
    assert.equal((await call("bobby", "DELETE", `/calendars/${fam.id}/events/${e.id}`)).http, 200)
    assert.equal(events("alice", "cal:event")[0].payload.removed, e.id)
    assert.equal((await call("alice", "GET", `/calendars/${fam.id}/events`)).events.length, 1)
    // the activity feed, newest first
    const activity = await call("alice", "GET", `/calendars/${fam.id}/activity`)
    assert.deepEqual(activity.activity.slice(0, 3).map((a) => `${a.byName} ${a.action}`), ["Bobby deleted", "Alice completed", "Bobby added"])
  } finally {
    close()
  }
})

test("comments on an event: members only, live, delete your own", async () => {
  const { call, events, clear, close } = serve()
  try {
    const fam = await family(call)
    const e = (await call("alice", "POST", `/calendars/${fam.id}/events`, { event: dinner() })).event
    clear()
    const said = await call("bobby", "POST", `/calendars/${fam.id}/events/${e.id}/comments`, { text: "  I'll bring dessert!  " })
    assert.equal(said.http, 200)
    assert.equal(said.comment.text, "I'll bring dessert!")
    const live = events("alice", "cal:comment")
    assert.equal(live.length, 1)
    assert.equal(live[0].payload.title, "Dinner")
    assert.equal(live[0].payload.comment.byName, "Bobby")
    assert.equal((await call("bobby", "POST", `/calendars/${fam.id}/events/${e.id}/comments`, { text: "" })).http, 400)
    assert.equal((await call("bobby", "POST", `/calendars/${fam.id}/events/${e.id}/comments`, { text: "x".repeat(1001) })).http, 400)
    assert.equal((await call("carol", "POST", `/calendars/${fam.id}/events/${e.id}/comments`, { text: "hi" })).http, 404)
    assert.equal((await call("carol", "GET", `/calendars/${fam.id}/events/${e.id}/comments`)).http, 404)
    const list = await call("alice", "GET", `/calendars/${fam.id}/events/${e.id}/comments`)
    assert.deepEqual(list.comments.map((c) => c.text), ["I'll bring dessert!"])
    // the event list counts them
    assert.equal((await call("alice", "GET", `/calendars/${fam.id}/events`)).events[0].comments, 1)
    assert.equal((await call("alice", "DELETE", `/calendars/${fam.id}/events/${e.id}/comments/${said.comment.id}`)).http, 403)
    assert.equal((await call("bobby", "DELETE", `/calendars/${fam.id}/events/${e.id}/comments/${said.comment.id}`)).http, 200)
    assert.equal((await call("alice", "GET", `/calendars/${fam.id}/events/${e.id}/comments`)).comments.length, 0)
  } finally {
    close()
  }
})

test("uploading this device's calendar, all or nothing", async () => {
  const { call, close } = serve()
  try {
    const mine = (await call("carol", "GET", "/")).calendars[0]
    const good = [dinner(), { title: "Trip", allDay: true, start: "2026-11-01", end: "2026-11-03" }]
    assert.equal((await call("carol", "POST", `/calendars/${mine.id}/import`, { events: [...good, { title: "" }] })).http, 400)
    assert.equal((await call("carol", "GET", `/calendars/${mine.id}/events`)).events.length, 0)
    const done = await call("carol", "POST", `/calendars/${mine.id}/import`, { events: good })
    assert.equal(done.events.length, 2)
    assert.equal((await call("carol", "POST", `/calendars/${mine.id}/import`, { events: Array.from({ length: 501 }, () => dinner()) })).http, 400)
  } finally {
    close()
  }
})

test("a secret subscription feed per member, as iCalendar", async () => {
  const { call, raw, close } = serve()
  try {
    const fam = await family(call)
    await call("alice", "POST", `/calendars/${fam.id}/events`, { event: dinner({ repeat: { freq: "weekly", interval: 1 }, exceptions: { "2026-10-16": { deleted: true } } }) })
    await call("alice", "POST", `/calendars/${fam.id}/events`, { event: { title: "Ana's birthday", allDay: true, start: "2026-03-15", repeat: { freq: "yearly", interval: 1 }, reminders: [0, 1440] } })
    const { token } = await call("bobby", "GET", `/calendars/${fam.id}/feed`)
    assert.match(token, /^[a-f0-9]{36}$/)
    assert.equal((await call("bobby", "GET", `/calendars/${fam.id}/feed`)).token, token)
    const feed = await raw(`/feed/${token}.ics`)
    assert.equal(feed.http, 200)
    assert.match(feed.type, /text\/calendar/)
    const ics = feed.text
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/)
    assert.match(ics, /X-WR-CALNAME:Family \(98ish\)/)
    assert.match(ics, /DTSTART;TZID=America\/Chicago:20261009T190000/)
    assert.match(ics, /RRULE:FREQ=WEEKLY/)
    assert.match(ics, /EXDATE;TZID=America\/Chicago:20261016T190000/)
    assert.match(ics, /LOCATION:Luigi's/)
    assert.match(ics, /TRIGGER:-PT30M/)
    assert.match(ics, /DTSTART;VALUE=DATE:20260315/)
    assert.match(ics, /RRULE:FREQ=YEARLY/)
    assert.match(ics, /TRIGGER:PT540M/) // 9:00 on the day
    assert.match(ics, /TRIGGER:-PT900M/) // 9:00 the day before
    assert.ok(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75))
    assert.equal((await raw(`/feed/${"0".repeat(36)}.ics`)).http, 404)
    assert.equal((await raw("/feed/nonsense")).http, 404)
    // a new link retires the old one
    const fresh = await call("bobby", "POST", `/calendars/${fam.id}/feed`)
    assert.notEqual(fresh.token, token)
    assert.equal((await raw(`/feed/${token}.ics`)).http, 404)
    // leaving the calendar ends the feed
    await call("bobby", "POST", `/calendars/${fam.id}/leave`)
    assert.equal((await raw(`/feed/${fresh.token}.ics`)).http, 404)
  } finally {
    close()
  }
})

test("writes are rate limited", async () => {
  const { call, close } = serve({ writesPerMinute: 5 })
  try {
    const mine = (await call("alice", "GET", "/")).calendars[0]
    const codes = []
    for (let i = 0; i < 7; i++) codes.push((await call("alice", "POST", `/calendars/${mine.id}/events`, { event: dinner() })).http)
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429])
  } finally {
    close()
  }
})
