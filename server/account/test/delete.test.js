// Delete My Account: every store that keeps something for an account is emptied for that
// account (alice) and untouched for everyone else (bob), each step can run twice, and over
// real sockets aim:deleteAccount asks for the password again, signs off everywhere, can be
// finished after a half-way failure, and frees the screen name.
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const path = require("node:path")
const { Server } = require("socket.io")
const { createAccountEraser, DELETED_NAME } = require("..")

const ALICE = { key: "alice", screenName: "Alice" }
const BOB = { key: "bob", screenName: "Bob" }
const COUPLE = "c0ffee000000000001" // alice + bob
const OTHER_COUPLE = "c0ffee000000000002" // bob + carol (later), never touched

// runs a step twice: the second time must find nothing left and not fail
const twice = async (fn, ctx) => {
  const first = await fn(ctx)
  await fn(ctx)
  return first
}

test("the eraser runs its steps in order, stops at a failure, and gathers context first", async () => {
  const order = []
  let fail = true
  const eraser = createAccountEraser({ log: {} })
    .addContext(async () => ({ coupleIds: ["x"], partners: [{ key: "bob", name: "Bob" }] }))
    .add("one", async (ctx) => order.push(["one", ctx.coupleIds.join()]))
    .add("two", async () => {
      order.push(["two"])
      if (fail) throw new Error("boom")
    })
    .add("three", async () => order.push(["three"]))
  const ctx = await eraser.context("alice", "Alice", { coupleIds: ["old"] })
  assert.deepEqual(ctx.coupleIds, ["old", "x"])
  assert.deepEqual(ctx.partners, [{ key: "bob", name: "Bob" }])
  const failed = await eraser.run(ctx)
  assert.equal(failed.ok, false)
  assert.equal(failed.failed, "two")
  assert.deepEqual(order, [["one", "old,x"], ["two"]])
  fail = false
  const ok = await eraser.run(ctx)
  assert.equal(ok.ok, true)
  assert.deepEqual(eraser.steps(), ["one", "two", "three"])
})

test("push: devices, settings, held IMs and IMs alice sent go; bob's stay", async () => {
  const { memoryStore } = require("../../push/store")
  const { createPush } = require("../../push")
  const store = memoryStore()
  const sub = (key, n) => ({ key, endpoint: `https://push.example/${key}/${n}`, p256dh: "p".repeat(60), auth: "a".repeat(16), device: "Phone" })
  await store.subs.save(sub("alice", 1))
  await store.subs.save(sub("alice", 2))
  await store.subs.save(sub("bob", 1))
  await store.prefs.set("alice", { tz: "UTC" })
  await store.prefs.set("bob", { tz: "UTC" })
  await store.inbox.add("alice", { from: "Bob", text: "hi alice" })
  await store.inbox.add("bob", { from: "Alice", text: "from alice" })
  await store.inbox.add("bob", { from: "Carol", text: "from carol" })
  const push = createPush({ store, vapid: {} })
  assert.deepEqual(await twice(push.eraseAccount, ALICE), { devices: 2 })
  assert.equal((await store.subs.forKey("alice")).length, 0)
  assert.equal((await store.subs.forKey("bob")).length, 1)
  assert.deepEqual(await store.prefs.get("alice"), {})
  assert.deepEqual(await store.prefs.get("bob"), { tz: "UTC" })
  assert.deepEqual(await store.inbox.take("alice"), [])
  assert.deepEqual((await store.inbox.take("bob")).map((m) => m.text), ["from carol"])
})

test("drive: every synced file, content, device token and the old online copy go; bob's stay", async () => {
  const { memorySyncStore } = require("../../drive/syncStore")
  const { memoryStore: legacyStore } = require("../../drive/store")
  const { syncRouter } = require("../../drive")
  const db = memorySyncStore()
  const legacy = legacyStore()
  for (const key of ["alice", "bob"]) {
    await db.createAccount(key)
    await db.putBlob(key, "abc-1", { enc: "t", mime: "", data: Buffer.from("x"), size: 1, length: 1 })
    await db.putEntry(key, { path: "C:/My Pictures/PHOTO1.JPG", kind: "f", type: "image", hash: "abc-1", size: 1, mtime: 0, rev: await db.bumpSeq(key), deleted: false, device: "iPhone", at: new Date() })
    await db.addDevice({ hash: `h-${key}`, key, name: "iPhone", expiresAt: new Date(Date.now() + 1e9), lastSeen: new Date() })
    await legacy.put(key, { data: "{}", size: 2 }, 0)
  }
  const router = syncRouter({ store: db, legacy })
  await twice(router.eraseAccount, ALICE)
  assert.equal(await db.getAccount("alice"), null)
  assert.equal(await db.countEntries("alice"), 0)
  assert.equal(await db.getBlob("alice", "abc-1"), null)
  assert.equal(await db.findDevice("h-alice"), null)
  assert.equal(await legacy.get("alice"), null)
  assert.equal((await db.getAccount("bob")).usage, 1)
  assert.equal(await db.countEntries("bob"), 1)
  assert.ok(await db.getBlob("bob", "abc-1"))
  assert.ok(await db.findDevice("h-bob"))
  assert.ok(await legacy.get("bob"))
})

test("contacts, homepages, guestbook, puzzles, quiz: alice's go, bob's stay", async () => {
  const { contactsRouter } = require("../../contacts")
  const contactsStore = require("../../contacts/store").memoryStore()
  await contactsStore.put("alice", "[]", 0)
  await contactsStore.put("bob", "[]", 0)
  await twice(contactsRouter({ store: contactsStore }).eraseAccount, ALICE)
  assert.equal((await contactsStore.get("alice")).revision, 0)
  assert.equal((await contactsStore.get("bob")).revision, 1)

  const { homepageRouter, memoryStore: homepageStore } = require("../../net/homepages")
  const pages = homepageStore()
  await pages.put("alice", { screenName: "Alice", title: "Hi", page: {}, size: 2 })
  await pages.put("bob", { screenName: "Bob", title: "Hi", page: {}, size: 2 })
  await twice(homepageRouter({ store: pages }).eraseAccount, ALICE)
  assert.ok(!(await pages.get("alice")))
  assert.ok(await pages.get("bob"))

  const { guestbookRouter, memoryStore: guestbookStore } = require("../../net/guestbook")
  const book = guestbookStore()
  await book.add({ name: "Alice", message: "signed on", mood: "smile", owner: "alice" })
  await book.add({ name: "Alice", message: "as a guest", mood: "smile" })
  await book.add({ name: "Bob", message: "bob's", mood: "smile", owner: "bob" })
  assert.deepEqual(await twice(guestbookRouter({ store: book }).eraseAccount, ALICE), { removed: 1 })
  assert.deepEqual((await book.recent(10)).map((e) => e.message).sort(), ["as a guest", "bob's"])
  assert.equal((await book.recent(10))[0].owner, undefined, "the owner is never shown")

  const { puzzleRouter, memoryStore: puzzleStore } = require("../../puzzles")
  const puzzles = puzzleStore()
  const puzzle = (id, fromKey, toKey) => ({ id, from: fromKey, fromKey, to: toKey, toKey, bucket: `user:${fromKey}`, bytes: 10, time: Date.now() })
  await puzzles.insert(puzzle("p1", "alice", "bob"))
  await puzzles.insert(puzzle("p2", "bob", "alice"))
  await puzzles.insert(puzzle("p3", "bob", "carol"))
  await twice(puzzleRouter({ store: puzzles }).eraseAccount, ALICE)
  assert.deepEqual((await puzzles.listFor("alice")).map((p) => p.id), [])
  assert.deepEqual((await puzzles.listFor("bob")).map((p) => p.id), ["p3"])

  const { quizRouter } = require("../../quiz")
  const quizStore = require("../../quiz/store").memoryStore()
  const challenge = (id, from, to) => ({ id, kind: "trivia", from, to, fromName: from, toName: to, payload: {}, status: "waiting", createdAt: Date.now() })
  await quizStore.insertChallenge(challenge("q1", "alice", "bob"))
  await quizStore.insertChallenge(challenge("q2", "bob", "carol"))
  await quizStore.saveQuiz("alice", { id: "s1", title: "Mine", questions: [], updatedAt: 1 })
  await quizStore.saveQuiz("bob", { id: "s2", title: "His", questions: [], updatedAt: 1 })
  await quizStore.addScore("alice", "bob", { mode: "trivia", percent: 50 })
  await quizStore.addScore("bob", "carol", { mode: "trivia", percent: 90 })
  await twice(quizRouter({ store: quizStore }).eraseAccount, ALICE)
  assert.equal((await quizStore.challengesFor("alice")).length, 0)
  assert.deepEqual((await quizStore.challengesFor("bob")).map((c) => c.id), ["q2"])
  assert.equal(await quizStore.countQuizzes("alice"), 0)
  assert.equal(await quizStore.countQuizzes("bob"), 1)
  assert.equal((await quizStore.scoresFor("alice")).length, 0)
  assert.deepEqual((await quizStore.scoresFor("bob")).map((s) => s.pair), ["bob|carol"])

  const { memoryRanks } = require("../../net/tetrisRanks")
  const ranks = memoryRanks()
  await ranks.record("alice", "Alice", "battle", { stars: 2, win: true })
  await ranks.record("bob", "Bob", "battle", { stars: 1 })
  await ranks.remove("alice")
  await ranks.remove("alice")
  assert.equal(await ranks.get("alice"), null)
  assert.deepEqual((await ranks.top("battle")).map((r) => r.screenName), ["Bob"])
})

test("mail: alice's mailbox goes; mail she sent stays with bob but no longer names her", async () => {
  const { mailRouter, memoryStore } = require("../../mail")
  const store = memoryStore()
  const message = (id, owner, folder, from, to, cc = []) => ({ id, owner, folder, from, to, cc, subject: id, body: "hello", attachments: [], size: 10, read: false, time: Date.now() })
  await store.insert(message("m1", "alice", "inbox", "Bob", ["Alice"]))
  await store.insert(message("m2", "alice", "sent", "Alice", ["Bob"]))
  await store.insert(message("m3", "alice", "drafts", "Alice", []))
  await store.insert(message("m4", "bob", "inbox", "Alice", ["Bob"], ["Carol"]))
  await store.insert(message("m5", "bob", "sent", "Bob", ["Alice", "Carol"]))
  await store.insert(message("m6", "bob", "inbox", "Carol", ["Bob"]))
  const result = await twice(mailRouter({ store }).eraseAccount, ALICE)
  assert.equal(result.removed, 3)
  assert.equal(Object.values(await store.counts("alice")).reduce((n, f) => n + f.total, 0), 0)
  const m4 = await store.get("bob", "m4")
  assert.equal(m4.from, DELETED_NAME)
  assert.equal(m4.body, "hello", "bob keeps what he was sent")
  assert.deepEqual(m4.cc, ["Carol"])
  assert.deepEqual((await store.get("bob", "m5")).to, [DELETED_NAME, "Carol"])
  assert.equal((await store.get("bob", "m6")).from, "Carol")
})

test("calendar: personal and Us calendars go; in a shared one alice leaves, her events, comments and activity go, the owner role moves", async () => {
  const calendar = require("../../calendar")
  const { memoryStore } = require("../../calendar/store")
  const store = memoryStore()
  const service = calendar.createCalendars({ store, couples: { isActiveCouple: () => true } })
  const member = (key, role, joinedAt) => ({ key, name: key, role, color: "blue", joinedAt, feed: null })
  const cal = (id, kind, members, extra = {}) => ({ id, kind, name: id, color: "blue", coupleId: null, code: null, members, invites: [], labels: [], createdAt: 1, updatedAt: 1, ...extra })
  await store.calendars.save(cal("a-personal", "personal", [member("alice", "owner", 1)]))
  await store.calendars.save(cal("b-personal", "personal", [member("bob", "owner", 1)]))
  await store.calendars.save(cal("us", "couple", [member("alice", "member", 1), member("bob", "member", 1)], { coupleId: COUPLE }))
  await store.calendars.save(cal("family", "group", [member("alice", "owner", 1), member("carol", "member", 3), member("bob", "member", 2)], { invites: [{ key: "dave", name: "Dave", by: "alice", byName: "Alice", at: 1 }, { key: "erin", name: "Erin", by: "bob", byName: "Bob", at: 1 }] }))
  await store.calendars.save(cal("solo", "group", [member("alice", "owner", 1)]))
  await store.calendars.save(cal("club", "group", [member("bob", "owner", 1)], { invites: [{ key: "alice", name: "Alice", by: "bob", byName: "Bob", at: 1 }] }))
  const event = (id, calendarId, createdBy, extra = {}) => ({ id, calendarId, kind: "event", title: id, createdBy, createdByName: createdBy, updatedBy: createdBy, updatedByName: createdBy, attendees: [], ...extra })
  await store.events.save(event("e1", "family", "alice"))
  await store.events.save(event("e2", "family", "bob", { attendees: ["alice", "bob"], updatedBy: "alice", updatedByName: "Alice" }))
  await store.events.save(event("e3", "b-personal", "bob"))
  await store.comments.add({ id: "c1", calendarId: "family", eventId: "e2", by: "alice", byName: "Alice", text: "mine", at: 1 })
  await store.comments.add({ id: "c2", calendarId: "family", eventId: "e2", by: "bob", byName: "Bob", text: "his", at: 2 })
  await store.activity.add({ id: "a1", calendarId: "family", by: "alice", byName: "Alice", action: "added", at: 1 })
  await store.activity.add({ id: "a2", calendarId: "family", by: "bob", byName: "Bob", action: "added", at: 2 })

  await twice(service.eraseAccount, { ...ALICE, coupleIds: [COUPLE] })
  assert.equal(await store.calendars.get("a-personal"), null)
  assert.equal(await store.calendars.get("us"), null)
  assert.equal(await store.calendars.get("solo"), null, "a calendar left empty goes")
  assert.equal((await store.calendars.forMember("alice")).length, 0)
  const family = await store.calendars.get("family")
  assert.deepEqual(family.members.map((m) => [m.key, m.role]), [["bob", "owner"], ["carol", "member"]], "the longest-standing member owns it now")
  assert.deepEqual(family.invites.map((i) => i.key), ["erin"])
  assert.deepEqual((await store.events.list("family")).map((e) => e.id), ["e2"])
  const e2 = await store.events.get("family", "e2")
  assert.deepEqual(e2.attendees, ["bob"])
  assert.equal(e2.updatedByName, DELETED_NAME)
  assert.deepEqual((await store.comments.list("e2")).map((c) => c.id), ["c2"])
  assert.deepEqual((await store.activity.list("family")).map((a) => a.id), ["a2"])
  assert.equal((await store.calendars.get("club")).invites.length, 0)
  assert.ok(await store.calendars.get("b-personal"))
  assert.equal((await store.events.list("b-personal")).length, 1)
})

test("couples: every pairing and everything the couple kept go; bob gets a neutral notice once; other couples untouched", async () => {
  const couples = require("../../couples")
  const { memoryStore } = require("../../couples/store")
  const store = memoryStore()
  const sent = []
  const aim = { sessions: new Map([["bob", { key: "bob", socket: { emit: (event, payload) => sent.push({ event, payload }) } }]]) }
  const pair = (id, a, b, status) => ({ id, a, b, names: { [a]: a, [b]: b }, status, requestedBy: a, createdAt: 1, pairedAt: status === "paired" ? 1 : null, endedAt: null })
  await store.pairs.save(pair(COUPLE, "alice", "bob", "paired"))
  await store.pairs.save(pair("c0ffee000000000003", "alice", "dave", "pending"))
  await store.pairs.save(pair(OTHER_COUPLE, "carol", "erin", "paired"))
  const item = (id, coupleId, kind, by) => ({ id, coupleId, kind, by, data: {}, blob: null, size: 10, createdAt: 1, updatedAt: 1 })
  await store.items.insert(item("l1", COUPLE, "letter", "alice"))
  await store.items.insert(item("l2", COUPLE, "letter", "bob"))
  await store.items.insert(item(`pet-${COUPLE}`, COUPLE, "pet", "bob"))
  await store.items.insert(item("l3", OTHER_COUPLE, "letter", "carol"))
  const service = couples.createCouples({ store, aim })
  try {
    const ctx = { ...ALICE, ...(await service.accountContext("alice")) }
    assert.deepEqual(ctx.coupleIds.sort(), [COUPLE, "c0ffee000000000003"].sort())
    assert.deepEqual(ctx.partners, [{ key: "bob", name: "bob" }])
    await twice(service.eraseAccount, ctx)
    assert.equal(service.partnerOf("bob"), null)
    assert.equal(service.statusFor("alice", "Alice").status, "single")
    assert.equal(service.statusFor("dave", "dave").status, "single")
    assert.equal(await store.items.usage(COUPLE), 0)
    assert.equal(await store.items.usage(OTHER_COUPLE), 10)
    assert.equal(service.partnerOf("carol"), "erin")
    // the notice: live, once, with no name in it
    assert.equal(sent.filter((s) => s.event === "couple:update" && s.payload.closed).length, 1)
    assert.ok(!JSON.stringify(sent).includes("alice"))
    assert.equal(await service.takeNotice("bob"), "closed")
    assert.equal(await service.takeNotice("bob"), null)
    assert.ok(!(await store.pairs.all()).some((p) => p.a === "alice" || p.b === "alice"))
  } finally {
    service.close()
  }
})

test("dollhouse, town and co-op towns: the couple's things go, alice's marks in bob's town go or are anonymized", async () => {
  const { dollhouseRouter, memoryStore: houseStore } = require("../../dollhouse")
  const houses = houseStore()
  await houses.put(COUPLE, { data: "{}", rev: 1, members: ["alice", "bob"], updatedAt: new Date() })
  await houses.put(OTHER_COUPLE, { data: "{}", rev: 1, members: ["bob", "carol"], updatedAt: new Date() })
  await twice(dollhouseRouter({ store: houses, coupleIdOf: () => null, sweepEvery: 0 }).eraseAccount, { ...ALICE, coupleIds: [COUPLE] })
  assert.equal(await houses.get(COUPLE), null)
  assert.ok(await houses.get(OTHER_COUPLE))

  const { createTown, memoryStore: townStore } = require("../../town")
  const { createCoop, coupleTownId } = require("../../town/coop")
  const store = townStore()
  const town = createTown({ store, couples: null })
  await store.put({ _id: "u:alice", key: "alice", name: "Alice", snap: {}, notes: [], hearts: {}, mailbox: [], effects: [], requests: [], updatedAt: 1 })
  await store.put({
    _id: "u:bob",
    key: "bob",
    name: "Bob",
    snap: {},
    hearts: { 3: ["alice", "carol"] },
    notes: [{ id: "n1", by: "alice", byName: "Alice", text: "hi" }, { id: "n2", by: "carol", byName: "Carol", text: "yo" }],
    mailbox: [{ id: "g1", from: "alice", fromName: "Alice", goods: { wheat: 2 }, note: "for you", at: 1 }],
    requests: [{ id: "r1", status: "filled", byName: "Alice" }],
    effects: [{ id: "f1", kind: "help", by: "Alice" }, { id: "f2", kind: "gift", from: "Alice" }, { id: "f3", kind: "help", by: "Carol" }],
    updatedAt: 1,
  })
  await store.put({ _id: `g:${COUPLE}:1`, progress: { alice: 3, bob: 2 }, updatedAt: 1 })
  await store.put({ _id: `g:${OTHER_COUPLE}:1`, progress: { bob: 2 }, updatedAt: 1 })
  await twice(town.eraseAccount, { ...ALICE, coupleIds: [COUPLE] })
  assert.equal(await store.get("u:alice"), null)
  assert.equal(await store.get(`g:${COUPLE}:1`), null)
  assert.ok(await store.get(`g:${OTHER_COUPLE}:1`))
  const bob = await store.get("u:bob")
  assert.deepEqual(bob.hearts, { 3: ["carol"] })
  assert.deepEqual(bob.notes.map((n) => n.id), ["n2"])
  assert.deepEqual(bob.mailbox[0], { id: "g1", from: null, fromName: DELETED_NAME, goods: { wheat: 2 }, note: "", at: 1 })
  assert.equal(bob.requests[0].byName, DELETED_NAME)
  assert.deepEqual(bob.effects.map((e) => e.by || e.from), [DELETED_NAME, DELETED_NAME, "Carol"])
  assert.ok(!JSON.stringify(bob).includes("Alice"))

  const coop = createCoop({ service: town, tickMs: 0, saveMs: 5 })
  try {
    const coupleTown = coupleTownId(COUPLE)
    const doc = (id, kind, members, extra = {}) => ({ _id: `coop:${id}`, id, name: id, kind, coupleId: null, owner: members[0], members: members.map((key) => ({ key, name: key === "alice" ? "Alice" : key, at: 1 })), stats: Object.fromEntries(members.map((k) => [k, { name: k }])), feed: [{ text: "Alice harvested wheat." }, { text: "bob planted corn." }], state: "{}", ...extra })
    await store.put(doc(coupleTown, "couple", ["alice", "bob"], { coupleId: COUPLE }))
    await store.put(doc("aaaaaaaaaaaa", "group", ["alice", "bob"]))
    await store.put(doc("bbbbbbbbbbbb", "group", ["alice"]))
    await store.put(doc("cccccccccccc", "group", ["bob"]))
    await store.put({ _id: "coopu:alice", ids: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"] })
    await store.put({ _id: "coopc:all", towns: { [coupleTown]: { coupleId: COUPLE, endedAt: null } } })
    assert.deepEqual(await coop.eraseAccount({ ...ALICE, coupleIds: [COUPLE] }), { left: 1, removed: 2 })
    await coop.eraseAccount({ ...ALICE, coupleIds: [COUPLE] })
    assert.equal(await store.get(`coop:${coupleTown}`), null)
    assert.equal(await store.get("coop:bbbbbbbbbbbb"), null, "a group town nobody's left in goes")
    const group = await store.get("coop:aaaaaaaaaaaa")
    assert.deepEqual(group.members.map((m) => m.key), ["bob"])
    assert.deepEqual(Object.keys(group.stats), ["bob"])
    assert.deepEqual(group.feed.map((f) => f.text), ["bob planted corn."])
    assert.ok(await store.get("coop:cccccccccccc"))
    assert.equal(await store.get("coopu:alice"), null)
    assert.deepEqual((await store.get("coopc:all")).towns, {})
  } finally {
    coop.close()
  }
})

test("game chat: alice's lines leave the history; others' stay", async () => {
  const { attachGameChat } = require("../../gamechat")
  const chat = attachGameChat({ on: () => {} }, { games: {} })
  chat.rooms.set("lobby:tetris", { name: "lobby:tetris", kind: "lobby", id: "tetris", members: new Map(), history: [{ from: "Alice", text: "gg" }, { from: "Bob", text: "gg!" }, { system: true, text: "Alice left the chat." }] })
  assert.deepEqual(await chat.eraseAccount(ALICE), { removed: 1 })
  assert.deepEqual(chat.rooms.get("lobby:tetris").history.map((m) => m.from || "system"), ["Bob", "system"])
})

test("compass: alice's 7-day relay log, reports and usage counters go; bob's and the totals stay", async () => {
  const { createWeb } = require("../../web")
  const { createRecords, memoryRecordsStore } = require("../../web/records")
  const { createCounters, memoryUsageStore } = require("../../meter/counters")
  const data = new Map()
  const counters = createCounters({ store: memoryUsageStore(data), log: {} })
  const records = createRecords({ store: memoryRecordsStore(), log: {} })
  const web = createWeb({ counters, records, mode: "on", secret: "s".repeat(64) })
  try {
    for (const who of ["alice", "bob"]) {
      counters.add("day", `u:${who}`, "2026-10-04", 1000)
      records.logBytes(who, "example.com", 1000)
      await records.addReport({ account: who, url: "https://example.com/", note: "" })
    }
    counters.add("day", "relay", "2026-10-04", 2000)
    await counters.flush()
    await records.flush()
    const first = await web.eraseAccount(ALICE)
    assert.deepEqual(first, { sessions: 0, counters: 1, log: 1, reports: 1 })
    assert.deepEqual(await web.eraseAccount(ALICE), { sessions: 0, counters: 0, log: 0, reports: 0 })
    assert.deepEqual([...data.keys()].sort(), ["day|relay|2026-10-04", "day|u:bob|2026-10-04"])
    assert.deepEqual([...records.store.log.values()].map((r) => r.account), ["bob"])
    assert.deepEqual(records.store.reports.map((r) => r.account), ["bob"])
  } finally {
    web.stop()
  }
})

// ---------- over real sockets ----------

let ioClient = null
try {
  ioClient = require(path.join(__dirname, "../../../client/node_modules/socket.io-client"))
} catch {
  ioClient = null
}

test("aim:deleteAccount: password again, signed off everywhere, finished after a failure, the name freed", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  const { attachAim } = require("../../aim")
  const { createStore } = require("../../aim/store")
  const server = http.createServer()
  const io = new Server(server)
  const store = await createStore("")
  let failOnce = true
  const ran = []
  const eraser = createAccountEraser({ log: {} })
    .addContext(async () => ({ coupleIds: ["c1"] }))
    .add("mail", async (ctx) => ran.push(`mail:${ctx.key}:${ctx.coupleIds.join()}`))
    .add("flaky", async () => {
      ran.push("flaky")
      if (failOnce) {
        failOnce = false
        throw new Error("database hiccup")
      }
    })
  const aim = await attachAim(io, { store, eraser })
  await new Promise((r) => server.listen(0, r))
  const url = `http://127.0.0.1:${server.address().port}`
  const sockets = []
  const connect = async () => {
    const socket = ioClient(url, { transports: ["websocket"], forceNew: true })
    sockets.push(socket)
    await new Promise((r) => socket.on("connect", r))
    return socket
  }
  const ask = (socket, event, payload) => new Promise((r) => socket.emit(event, payload, r))
  const events = (socket, name) => {
    const list = []
    socket.on(name, (p) => list.push(p))
    return list
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  try {
    const phone = await connect()
    const signedOn = await ask(phone, "aim:signOn", { screenName: "Alice", password: "hunter22", register: true, remember: true })
    assert.equal(signedOn.ok, true)
    const bob = await connect()
    assert.equal((await ask(bob, "aim:signOn", { screenName: "Bob", password: "bobpass1", register: true })).ok, true)
    assert.equal((await ask(bob, "aim:saveGroups", { groups: [{ name: "Buddies", buddies: ["SmarterChild", "Alice"] }] })).ok, true)
    assert.equal((await ask(bob, "aim:block", { screenName: "Alice", blocked: true })).ok, true)
    const bobGone = events(bob, "aim:accountGone")

    // not signed on as alice: refused even with the right password
    assert.match((await ask(bob, "aim:deleteAccount", { screenName: "Alice", password: "hunter22" })).error, /Sign on as Alice/)
    // wrong password
    assert.equal((await ask(phone, "aim:deleteAccount", { screenName: "Alice", password: "nope1234" })).ok, false)
    assert.equal(ran.length, 0)

    // a second window of alice's is told; the first try stops half way
    const laptop = await connect()
    const kicked = events(phone, "aim:kicked")
    assert.equal((await ask(laptop, "aim:signOn", { screenName: "alice", password: "hunter22" })).ok, true)
    await wait(50)
    assert.equal(kicked.length, 1, "signing on elsewhere bumps the phone (as always)")
    const laptopKicked = events(laptop, "aim:kicked")
    const failed = await ask(laptop, "aim:deleteAccount", { screenName: "Alice", password: "hunter22" })
    assert.equal(failed.ok, false)
    assert.equal(failed.retry, true)
    assert.equal(failed.failed, "flaky")
    assert.equal(aim.sessions.has("alice"), false, "signed off everywhere")
    assert.equal(laptopKicked.length, 0, "the window that asked hears the answer, not a kick")
    const marked = await store.find("alice")
    assert.ok(marked.deleting)
    assert.deepEqual(marked.deleting.coupleIds, ["c1"])
    assert.deepEqual(marked.remember, [], "remembered devices forgotten")
    // nobody can sign on now, not even with a remembered token
    const again = await ask(phone, "aim:signOn", { screenName: "Alice", password: "hunter22" })
    assert.equal(again.ok, false)
    assert.equal(again.deleting, true)
    assert.equal((await ask(phone, "aim:signOnRemembered", { screenName: "Alice", token: signedOn.remember })).ok, false)

    // finishing it: signed off is fine now (the account is marked), the password is still asked
    assert.equal((await ask(phone, "aim:deleteAccount", { screenName: "Alice", password: "wrong999" })).ok, false)
    const done = await ask(phone, "aim:deleteAccount", { screenName: "Alice", password: "hunter22" })
    assert.equal(done.ok, true, JSON.stringify(done))
    assert.equal(done.screenName, "Alice")
    assert.deepEqual(ran, ["mail:alice:c1", "flaky", "mail:alice:c1", "flaky"])
    assert.ok(!(await store.find("alice")))
    // off bob's Buddy List (stored and live), and bob was told
    await wait(50)
    assert.deepEqual((await store.find("bob")).groups[0].buddies, ["SmarterChild"])
    assert.deepEqual(aim.sessions.get("bob").user.groups[0].buddies, ["SmarterChild"])
    assert.deepEqual((await store.find("bob")).blocked, [])
    assert.deepEqual(aim.sessions.get("bob").user.blocked, [])
    assert.equal(bobGone.length, 1)
    assert.equal(bobGone[0].screenName, "Alice")
    // gone for good: can't sign on, can't delete twice; the name is free for someone new
    assert.equal((await ask(phone, "aim:signOn", { screenName: "Alice", password: "hunter22" })).ok, false)
    assert.equal((await ask(phone, "aim:deleteAccount", { screenName: "Alice", password: "hunter22" })).ok, false)
    assert.equal((await ask(phone, "aim:signOn", { screenName: "ALICE", password: "newperson1", register: true })).ok, true)
    assert.equal((await store.find("alice")).deleting, null)
    assert.ok(await store.find("bob"), "bob is untouched")
  } finally {
    sockets.forEach((s) => s.close())
    io.close()
    server.close()
  }
})
