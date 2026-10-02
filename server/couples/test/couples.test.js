const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const express = require("express")
const couples = require("..")
const { memoryStore } = require("../store")
const v = require("../validate")

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
// the same PNG claiming to be 2000 pixels wide
const WIDE_PNG = (() => {
  const b = Buffer.from(PNG.split(",")[1], "base64")
  b.writeUInt32BE(2000, 16)
  return `data:image/png;base64,${b.toString("base64")}`
})()
// a JPEG header with a frame of 640x480 (enough for the checks: they read headers only)
const JPEG = (() => {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01])
  return `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(40)]).toString("base64")}`
})()
const big = (kb) => {
  const b = Buffer.alloc(kb * 1024)
  Buffer.from(PNG.split(",")[1], "base64").copy(b)
  return `data:image/png;base64,${b.toString("base64")}`
}

const DAY = 24 * 60 * 60_000
const token = (c) => c.repeat(48)
const TOKENS = { alice: token("a"), bobby: token("b"), carol: token("c"), dave: token("d") }

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

const serve = (options = {}) => {
  const aim = fakeAim()
  let time = Date.UTC(2026, 9, 2, 12)
  const service = couples.createCouples({ store: memoryStore(), aim, now: () => time, limits: { writesPerMinute: 1000, writesPerHour: 10000, pairRequestsPerHour: 1000 }, ...options })
  const app = express()
  app.use("/api/couples", couples.couplesRouter({ service }))
  const server = http.createServer(app).listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api/couples`
  const call = (who, method, path, body) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${TOKENS[who] || who}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ ...(await r.json().catch(() => ({}))), http: r.status }))
  const events = (who, name) => aim.sessions.get(who).socket.events.filter((e) => !name || e.event === name)
  const close = () => {
    server.close()
    service.close()
  }
  return { aim, service, call, events, close, advance: (ms) => (time += ms), now: () => time }
}

const pair = async (call, a = "alice", b = "Bobby", bKey = "bobby") => {
  assert.equal((await call(a, "POST", "/request", { to: b })).http, 200)
  assert.equal((await call(bKey, "POST", "/accept", {})).http, 200)
}

test("validates text, dates and pictures", () => {
  assert.equal(v.text("  hi\u0000 there ", { max: 10 }), "hi there")
  assert.throws(() => v.text("x".repeat(11), { max: 10 }), v.Invalid)
  assert.throws(() => v.text({ html: 1 }, { max: 10 }), v.Invalid)
  assert.equal(v.date("2024-02-29"), "2024-02-29")
  assert.throws(() => v.date("2023-02-29"), v.Invalid)
  assert.throws(() => v.date("02/14/2024"), v.Invalid)
  assert.equal(v.date("", { optional: true }), "")
  assert.ok(v.image(PNG).bytes > 0)
  assert.ok(v.image(JPEG))
  assert.deepEqual(v.sizeOf("jpeg", Buffer.from(JPEG.split(",")[1], "base64")), { width: 640, height: 480 })
  assert.throws(() => v.image(WIDE_PNG), /pixels/)
  assert.throws(() => v.image(big(400)), /too big/)
  assert.throws(() => v.image("data:image/gif;base64,R0lGODlhAQABAAAAACw="), /PNG, JPEG or WebP/)
  assert.throws(() => v.image("data:image/svg+xml;base64,PHN2Zz4="), v.Invalid)
  assert.throws(() => v.image("javascript:alert(1)"), v.Invalid)
  // a PNG label on JPEG bytes
  assert.throws(() => v.image(`data:image/png;base64,${JPEG.split(",")[1]}`), /damaged/)
})

test("every route needs a signed-on 98 Messenger user", async () => {
  const { call, close } = serve()
  try {
    const routes = [
      ["GET", "/"], ["POST", "/request", { to: "Bobby" }], ["POST", "/accept"], ["POST", "/decline"], ["POST", "/cancel"], ["POST", "/unpair"],
      ["GET", "/letters"], ["GET", "/letters/aaaaaaaaaaaaaaaaaa"], ["POST", "/letters", { letter: { text: "hi" } }], ["POST", "/letters/aaaaaaaaaaaaaaaaaa/open"],
      ["POST", "/letters/aaaaaaaaaaaaaaaaaa/favorite", { favorite: true }], ["DELETE", "/letters/aaaaaaaaaaaaaaaaaa"],
      ["GET", "/story"], ["PUT", "/story", {}], ["POST", "/moments", {}], ["PUT", "/moments/aaaaaaaaaaaaaaaaaa", {}], ["DELETE", "/moments/aaaaaaaaaaaaaaaaaa"],
      ["POST", "/photos", { data: PNG }], ["GET", "/photos"], ["GET", "/photos/aaaaaaaaaaaaaaaaaa"], ["PATCH", "/photos/aaaaaaaaaaaaaaaaaa", {}], ["DELETE", "/photos/aaaaaaaaaaaaaaaaaa"],
      ["GET", "/flowers"], ["POST", "/flowers", {}], ["POST", "/flowers/aaaaaaaaaaaaaaaaaa/water", {}], ["DELETE", "/flowers/aaaaaaaaaaaaaaaaaa"],
    ]
    for (const [method, path, body] of routes) {
      assert.equal((await call(null, method, path, body)).http, 401, `${method} ${path}`)
      assert.equal((await call("e".repeat(48), method, path, body)).http, 401, `${method} ${path} with a stranger's token`)
    }
    // the test clock only exists when asked for
    assert.equal((await call("alice", "POST", "/test/clock", { offsetMs: 1 })).http, 404)
  } finally {
    close()
  }
})

test("pairing: request, decline, accept, one partner each, unpair", async () => {
  const { call, events, service, close } = serve()
  try {
    assert.equal((await call("alice", "GET", "/")).status, "single")
    assert.equal((await call("alice", "POST", "/request", { to: "alice" })).http, 400)
    assert.equal((await call("alice", "POST", "/request", { to: "SmarterChild" })).http, 400)
    assert.equal((await call("alice", "POST", "/request", { to: "Nobody Here" })).http, 404)
    assert.equal((await call("alice", "POST", "/request", { to: "<b>" })).http, 400)
    // Dave has blocked Carol
    assert.equal((await call("carol", "POST", "/request", { to: "Dave" })).http, 409)

    const asked = await call("alice", "POST", "/request", { to: "bobby" })
    assert.equal(asked.status, "pending-out")
    assert.equal(asked.outgoing, "Bobby")
    assert.equal(events("bobby", "couple:request")[0].payload.from, "Alice")
    let bob = await call("bobby", "GET", "/")
    assert.equal(bob.status, "pending-in")
    assert.deepEqual(bob.incoming, ["Alice"])
    // one request out at a time
    assert.equal((await call("alice", "POST", "/request", { to: "Carol" })).http, 409)

    // declined
    assert.equal((await call("bobby", "POST", "/decline", {})).status, "single")
    assert.equal((await call("alice", "GET", "/")).status, "single")
    assert.equal(events("alice", "couple:update").at(-1).payload.declined, "Bobby")
    assert.equal((await call("bobby", "POST", "/accept", {})).http, 404)

    // cancelled
    await call("alice", "POST", "/request", { to: "Bobby" })
    assert.equal((await call("alice", "POST", "/cancel")).status, "single")
    assert.equal((await call("bobby", "GET", "/")).status, "single")

    // Carol and Alice both ask Bobby; he says yes to Alice and Carol's request goes away
    await call("carol", "POST", "/request", { to: "Bobby" })
    await call("alice", "POST", "/request", { to: "Bobby" })
    assert.deepEqual((await call("bobby", "GET", "/")).incoming, ["Carol", "Alice"])
    const yes = await call("bobby", "POST", "/accept", { from: "alice" })
    assert.equal(yes.status, "paired")
    assert.equal(yes.partner, "Alice")
    const alice = await call("alice", "GET", "/")
    assert.equal(alice.status, "paired")
    assert.equal(alice.partner, "Bobby")
    assert.equal(alice.coupleId, yes.coupleId)
    assert.equal((await call("carol", "GET", "/")).status, "single")
    assert.equal(couples.partnerOf("alice"), null, "the shared service is separate from this test's")
    assert.equal(service.partnerOf("alice"), "Bobby")
    assert.equal(service.coupleIdOf("bobby"), yes.coupleId)
    assert.equal(service.coupleIdOf("carol"), null)

    // one partner per account
    assert.equal((await call("carol", "POST", "/request", { to: "Alice" })).http, 409)
    assert.equal((await call("alice", "POST", "/request", { to: "Carol" })).http, 409)

    // unpairing: both see it
    const before = events("bobby", "couple:update").length
    assert.equal((await call("alice", "POST", "/unpair", {})).status, "single")
    assert.equal((await call("bobby", "GET", "/")).status, "single")
    assert.equal(events("bobby", "couple:update").length, before + 1)
    assert.equal(events("bobby", "couple:update").at(-1).payload.unpaired, "Alice")
    assert.equal((await call("alice", "GET", "/letters")).http, 403)
  } finally {
    close()
  }
})

test("mutual requests pair up; pairing again within 30 days brings things back", async () => {
  const { call, close, advance } = serve()
  try {
    await call("alice", "POST", "/request", { to: "Bobby" })
    // asking someone who already asked you is a yes
    const mutual = await call("bobby", "POST", "/request", { to: "Alice" })
    assert.equal(mutual.status, "paired")
    const id = mutual.coupleId
    await call("alice", "POST", "/letters", { letter: { title: "Hi", text: "Remember me" } })
    await call("alice", "POST", "/unpair", {})
    advance(10 * DAY)
    await pair(call)
    const again = await call("alice", "GET", "/")
    assert.equal(again.coupleId, id)
    assert.equal((await call("bobby", "GET", "/letters")).inbox.length, 1)

    // deleting on request
    await call("bobby", "POST", "/unpair", { deleteNow: true })
    await pair(call)
    assert.notEqual((await call("alice", "GET", "/")).coupleId, id)
    assert.equal((await call("bobby", "GET", "/letters")).inbox.length, 0)
  } finally {
    close()
  }
})

test("purges couples unpaired more than 30 days ago", async () => {
  const { call, service, close, advance } = serve()
  try {
    await pair(call)
    const id = (await call("alice", "GET", "/")).coupleId
    await call("alice", "POST", "/letters", { letter: { text: "Keep this" } })
    await call("alice", "POST", "/unpair", {})
    advance(31 * DAY)
    await service.sweep()
    await pair(call)
    assert.notEqual((await call("alice", "GET", "/")).coupleId, id)
    assert.equal((await call("bobby", "GET", "/letters")).inbox.length, 0)
  } finally {
    close()
  }
})

test("a third account can't reach anything of a couple's", async () => {
  const { call, close } = serve()
  try {
    await pair(call)
    const letter = (await call("alice", "POST", "/letters", { letter: { title: "Ours", text: "Only for you", photo: PNG } })).letters[0]
    const photo = (await call("alice", "POST", "/photos", { data: PNG })).photo
    const moment = (await call("alice", "POST", "/moments", { moment: { date: "2024-02-14", title: "First date", photos: [photo.id] } })).moment
    const bouquet = (await call("alice", "POST", "/flowers", { bouquet: { stems: ["rose"], note: "for you" } })).bouquet

    // Carol, unpaired: 403 everywhere
    for (const [method, path, body] of [
      ["GET", "/letters"], ["GET", `/letters/${letter.id}`], ["POST", `/letters/${letter.id}/open`], ["POST", `/letters/${letter.id}/favorite`, { favorite: true }], ["DELETE", `/letters/${letter.id}`],
      ["GET", "/story"], ["PUT", "/story", { title: "x" }], ["PUT", `/moments/${moment.id}`, { moment: { date: "2024-01-01", title: "x" } }], ["DELETE", `/moments/${moment.id}`],
      ["GET", "/photos"], ["GET", `/photos/${photo.id}`], ["PATCH", `/photos/${photo.id}`, { private: true }], ["DELETE", `/photos/${photo.id}`], ["POST", "/photos", { data: PNG }],
      ["GET", "/flowers"], ["POST", `/flowers/${bouquet.id}/water`, {}], ["DELETE", `/flowers/${bouquet.id}`],
    ]) {
      const r = await call("carol", method, path, body)
      assert.equal(r.http, 403, `${method} ${path}`)
      assert.ok(!JSON.stringify(r).includes("Only for you"))
    }

    // Carol pairs with Dave: their own couple can't see Alice and Bobby's things either
    await call("dave", "POST", "/request", { to: "Carol" })
    await call("carol", "POST", "/accept", {})
    for (const [method, path] of [["GET", `/letters/${letter.id}`], ["POST", `/letters/${letter.id}/open`], ["DELETE", `/letters/${letter.id}`], ["GET", `/photos/${photo.id}`], ["DELETE", `/moments/${moment.id}`], ["POST", `/flowers/${bouquet.id}/water`], ["DELETE", `/flowers/${bouquet.id}`]]) {
      assert.equal((await call("carol", method, path)).http, 404, `${method} ${path}`)
    }
    const theirs = await call("carol", "GET", "/letters")
    assert.equal(theirs.inbox.length + theirs.outbox.length, 0)
    assert.equal((await call("carol", "GET", "/story")).moments.length, 0)
    assert.equal((await call("carol", "GET", "/flowers")).received.length, 0)
    // and Bobby still gets his
    assert.equal((await call("bobby", "GET", `/letters/${letter.id}`)).letter.text, "Only for you")
  } finally {
    close()
  }
})

test("sealed letters never leave the server before their time", async () => {
  const { call, events, close, advance, now } = serve()
  try {
    await pair(call)
    const later = now() + 3 * DAY
    const sent = await call("alice", "POST", "/letters", { letter: { title: "For our anniversary", text: "SECRET WORDS", photo: PNG, delivery: "date", unlockAt: later, envelope: "lavender" } })
    assert.equal(sent.http, 200)
    const id = sent.letters[0].id
    // the live notice and the inbox have the title and time, not the words or the photo
    const notice = events("bobby", "couple:letter").at(-1).payload
    assert.equal(notice.title, "For our anniversary")
    assert.equal(notice.locked, true)
    assert.equal(notice.unlockAt, later)
    const inbox = await call("bobby", "GET", "/letters")
    for (const blob of [notice, inbox]) {
      assert.ok(!JSON.stringify(blob).includes("SECRET"))
      assert.ok(!JSON.stringify(blob).includes("iVBOR"))
    }
    const sealed = await call("bobby", "GET", `/letters/${id}`)
    assert.equal(sealed.http, 403)
    assert.equal(sealed.locked, true)
    assert.ok(!JSON.stringify(sealed).includes("SECRET"))
    assert.equal((await call("bobby", "POST", `/letters/${id}/open`)).http, 403)
    // can't be thrown away unread either
    assert.equal((await call("bobby", "DELETE", `/letters/${id}`)).http, 403)
    // the writer can read their own
    assert.equal((await call("alice", "GET", `/letters/${id}`)).letter.text, "SECRET WORDS")

    advance(3 * DAY + 1000)
    const open = await call("bobby", "GET", `/letters/${id}`)
    assert.equal(open.letter.text, "SECRET WORDS")
    assert.equal(open.letter.photo, PNG)
    const opened = await call("bobby", "POST", `/letters/${id}/open`)
    assert.ok(opened.letter.openedAt)
    assert.equal(events("alice", "couple:letter-opened").at(-1).payload.id, id)
    assert.ok((await call("alice", "GET", "/letters")).outbox[0].openedAt, "read receipt")

    // favorites are per person
    assert.equal((await call("bobby", "POST", `/letters/${id}/favorite`, { favorite: true })).letter.favorite, true)
    assert.equal((await call("alice", "GET", "/letters")).outbox[0].favorite, false)
    assert.equal((await call("bobby", "GET", "/letters")).inbox[0].favorite, true)
  } finally {
    close()
  }
})

test("open-when letters, countdown series and letter checks", async () => {
  const { call, close, advance, now } = serve()
  try {
    await pair(call)
    const when = await call("alice", "POST", "/letters", { letter: { text: "Here's a hug", delivery: "openwhen", label: "you miss me" } })
    assert.equal(when.letters[0].label, "you miss me")
    assert.equal((await call("bobby", "GET", `/letters/${when.letters[0].id}`)).letter.text, "Here's a hug")
    assert.equal((await call("alice", "POST", "/letters", { letter: { text: "x", delivery: "openwhen" } })).http, 400)

    const start = now() + 60_000
    const series = await call("alice", "POST", "/letters", { series: { startAt: start, letters: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ title: `Day ${n}`, text: `Letter number ${n}`, envelope: "mint" })) } })
    assert.equal(series.letters.length, 7)
    assert.deepEqual(series.letters.map((l) => l.unlockAt - start), [0, 1, 2, 3, 4, 5, 6].map((n) => n * DAY))
    assert.ok(series.letters.every((l) => l.seriesTotal === 7 && l.envelope === "mint"))
    advance(DAY + 120_000)
    const inbox = (await call("bobby", "GET", "/letters")).inbox.filter((l) => l.seriesId)
    assert.equal(inbox.filter((l) => !l.locked).length, 2)
    for (const l of inbox.filter((l) => l.locked)) assert.equal((await call("bobby", "GET", `/letters/${l.id}`)).http, 403)

    for (const bad of [
      { letter: { text: "" } },
      { letter: { text: "x".repeat(5001) } },
      { letter: { text: "hi", title: "t".repeat(81) } },
      { letter: { text: "hi", stationery: "lasers" } },
      { letter: { text: "hi", photo: "data:image/svg+xml;base64,PHN2Zz4=" } },
      { letter: { text: "hi", photo: WIDE_PNG } },
      { letter: { text: "hi", delivery: "date", unlockAt: now() + 10 * 366 * DAY } },
      { letter: { text: "hi", delivery: "date", unlockAt: "soon" } },
      { series: { letters: [{ text: "only one" }] } },
      { series: { letters: Array(15).fill({ text: "x" }) } },
    ]) {
      assert.equal((await call("alice", "POST", "/letters", bad)).http, 400, JSON.stringify(bad).slice(0, 80))
    }
    // HTML is kept as plain text
    const html = await call("alice", "POST", "/letters", { letter: { text: "<img src=x onerror=alert(1)>" } })
    assert.equal((await call("bobby", "GET", `/letters/${html.letters[0].id}`)).letter.text, "<img src=x onerror=alert(1)>")
  } finally {
    close()
  }
})

test("our story: both edit moments with photos; private photos; caps", async () => {
  const { call, events, close } = serve({ capBytes: 60 * 1024 })
  try {
    await pair(call)
    assert.equal((await call("bobby", "PUT", "/story", { title: "Us", howWeMet: "At the library", metOn: "2023-05-04", togetherSince: "2023-06-01" })).http, 200)
    assert.equal(events("alice", "couple:story").length, 1)
    assert.equal((await call("alice", "GET", "/story")).story.howWeMet, "At the library")
    assert.equal((await call("alice", "PUT", "/story", { metOn: "2023-02-30" })).http, 400)

    const p1 = (await call("alice", "POST", "/photos", { data: PNG })).photo
    const p2 = (await call("bobby", "POST", "/photos", { data: JPEG, private: true })).photo
    assert.equal(p2.private, true)
    const m = await call("alice", "POST", "/moments", { moment: { date: "2023-06-01", title: "First date", text: "Pizza", location: "Luigi's", mood: "love", photos: [p1.id] } })
    assert.equal(m.http, 200)
    // Bobby edits Alice's moment and adds his photo
    const edited = await call("bobby", "PUT", `/moments/${m.moment.id}`, { moment: { ...m.moment, photos: [p1.id, p2.id] } })
    assert.deepEqual(edited.moment.photos, [{ id: p1.id, private: false }, { id: p2.id, private: true }])
    assert.equal(edited.moment.by, "Alice")
    assert.equal(edited.moment.updatedBy, "Bobby")
    assert.equal((await call("alice", "GET", `/photos/${p2.id}`)).photo.data, JPEG)
    // a photo can't be borrowed by a second moment
    assert.equal((await call("alice", "POST", "/moments", { moment: { date: "2023-07-01", title: "x", photos: [p1.id] } })).http, 400)
    for (const bad of [{ date: "June", title: "x" }, { date: "2023-01-01", title: "" }, { date: "2023-01-01", title: "x", mood: "angry" }, { date: "2023-01-01", title: "x", photos: ["a", "b", "c", "d", "e"] }]) {
      assert.equal((await call("alice", "POST", "/moments", { moment: bad })).http, 400)
    }
    // removing a photo from a moment deletes it
    await call("alice", "PUT", `/moments/${m.moment.id}`, { moment: { ...m.moment, photos: [p2.id] } })
    assert.equal((await call("alice", "GET", `/photos/${p1.id}`)).http, 404)
    assert.equal((await call("bobby", "GET", "/photos")).photos.length, 1)

    // pictures are checked
    assert.equal((await call("alice", "POST", "/photos", { data: WIDE_PNG })).http, 400)
    assert.equal((await call("alice", "POST", "/photos", { data: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" })).http, 400)
    assert.equal((await call("alice", "POST", "/photos", { data: big(400) })).http, 400)
    // the couple's space is capped (60 KB here)
    const r = await call("alice", "POST", "/photos", { data: big(70) })
    assert.equal(r.http, 413)
    assert.match(r.error, /full/)

    // deleting a moment deletes its photos
    await call("bobby", "DELETE", `/moments/${m.moment.id}`)
    assert.equal((await call("alice", "GET", `/photos/${p2.id}`)).http, 404)
    assert.equal((await call("alice", "GET", "/story")).moments.length, 0)
  } finally {
    close()
  }
})

test("flowers: watering once a day, wilting past saving", async () => {
  const { call, events, close, advance } = serve()
  try {
    await pair(call)
    const sent = await call("alice", "POST", "/flowers", { bouquet: { stems: ["rose", "rose", "tulip", "sunflower"], vase: "pink", ribbon: "gold", note: "Just because" } })
    assert.equal(sent.http, 200)
    const id = sent.bouquet.id
    assert.deepEqual(events("bobby", "couple:flowers")[0].payload.stems, ["rose", "rose", "tulip", "sunflower"])
    assert.equal((await call("alice", "POST", "/flowers", { bouquet: { stems: ["cactus"] } })).http, 400)
    assert.equal((await call("alice", "POST", "/flowers", { bouquet: { stems: Array(13).fill("rose") } })).http, 400)
    assert.equal((await call("alice", "POST", `/flowers/${id}/water`, {})).http, 403)

    assert.equal((await call("bobby", "POST", `/flowers/${id}/water`, { tz: 0 })).http, 200)
    assert.equal((await call("bobby", "POST", `/flowers/${id}/water`, { tz: 0 })).http, 409)
    advance(DAY)
    const watered = await call("bobby", "POST", `/flowers/${id}/water`, { tz: 0 })
    assert.equal(watered.bouquet.waterDays.length, 2)
    assert.equal(watered.bouquet.wateredAt, watered.now)
    assert.equal(events("alice", "couple:watered").length, 2)
    // five days without water: too late
    advance(5 * DAY)
    assert.equal((await call("bobby", "POST", `/flowers/${id}/water`, { tz: 0 })).http, 409)
    // dismissing hides it for the receiver
    await call("bobby", "DELETE", `/flowers/${id}`)
    assert.equal((await call("bobby", "GET", "/flowers")).received[0].dismissed, true)
  } finally {
    close()
  }
})

test("writes are rate limited", async () => {
  const { call, close } = serve({ limits: { writesPerMinute: 5, writesPerHour: 100, pairRequestsPerHour: 100 } })
  try {
    await pair(call)
    const results = []
    for (let i = 0; i < 6; i++) results.push((await call("alice", "POST", "/flowers", { bouquet: { stems: ["daisy"] } })).http)
    assert.ok(results.includes(429))
  } finally {
    close()
  }
})

test("the test clock can move time when it's turned on", async () => {
  const { call, close } = serve({ testClock: true })
  try {
    const before = (await call("alice", "GET", "/")).now
    assert.equal((await call("alice", "POST", "/test/clock", { offsetMs: DAY })).http, 200)
    assert.ok((await call("alice", "GET", "/")).now - before >= DAY)
  } finally {
    close()
  }
})
