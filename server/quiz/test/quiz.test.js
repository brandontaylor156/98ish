const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const express = require("express")
const { quizRouter } = require("..")
const { memoryStore } = require("../store")
const { createQuizLive, cleanOptions } = require("../live")
const { quizContent } = require("../content")
const { createGames } = require("../../net/games")

// A fake 98 Messenger: Alice, Bobby and Carol signed on; Dave registered but signed off
const fakeAim = () => {
  const users = {
    alice: { key: "alice", screenName: "Alice", blocked: [] },
    bobby: { key: "bobby", screenName: "Bobby", blocked: [] },
    carol: { key: "carol", screenName: "Carol", blocked: [] },
    dave: { key: "dave", screenName: "Dave", blocked: [] },
  }
  const socket = () => ({ events: [], emit(event, payload) { this.events.push({ event, payload }) } })
  const sessions = new Map(["alice", "bobby", "carol"].map((k) => [k, { key: k, user: users[k], socket: socket() }]))
  const tokens = { ["a".repeat(48)]: "alice", ["b".repeat(48)]: "bobby", ["c".repeat(48)]: "carol" }
  return { users, sessions, authenticate: (token) => sessions.get(tokens[token]) || null, store: { find: async (key) => users[key] || null } }
}
const ALICE = "a".repeat(48)
const BOBBY = "b".repeat(48)
const CAROL = "c".repeat(48)

const serve = (options = {}) => {
  const aim = fakeAim()
  const store = memoryStore()
  const app = express()
  app.use("/api/quiz", quizRouter({ store, aim, ...options }))
  const server = http.createServer(app).listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api/quiz`
  const call = (method, path, body, token) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
  return { aim, store, server, call }
}

let content
test.before(async () => {
  content = (await quizContent()).content
})

const knowme = () => {
  const items = content.aboutMe.slice(0, 5).map((q) => q.id)
  return { kind: "knowme", items, answers: [0, 1, 2, 0, 1] }
}

test("every request needs a signed-on 98 Messenger user", async () => {
  const { server, call } = serve()
  try {
    for (const [method, path, body] of [["GET", "/inbox"], ["POST", "/challenges", knowme()], ["GET", "/challenges/" + "f".repeat(24)], ["POST", `/challenges/${"f".repeat(24)}/attempt`, { answers: [] }], ["DELETE", `/challenges/${"f".repeat(24)}`], ["GET", "/quizzes"], ["POST", "/quizzes", {}], ["GET", "/scores"]]) {
      assert.equal((await call(method, path, body)).status, 401, `${method} ${path}`)
      assert.equal((await call(method, path, body, "d".repeat(48))).status, 401, `${method} ${path} with a stranger's token`)
    }
  } finally {
    server.close()
  }
})

test("async How Well Do You Know Me: send, take, score; answers stay hidden until taken", async () => {
  const { server, call, aim } = serve()
  try {
    const sent = await call("POST", "/challenges", { ...knowme(), to: "bobby" }, ALICE)
    assert.ok(sent.ok, sent.error)
    const id = sent.challenge.id
    assert.equal(sent.challenge.to, "Bobby")
    assert.equal(sent.challenge.status, "waiting")
    assert.equal(aim.sessions.get("bobby").socket.events.at(-1).event, "quiz:new")

    // Bobby's inbox lists it; his view of it has no answers in it yet
    const inbox = await call("GET", "/inbox", undefined, BOBBY)
    assert.equal(inbox.challenges.length, 1)
    assert.equal(inbox.challenges[0].mine, false)
    const before = await call("GET", `/challenges/${id}`, undefined, BOBBY)
    assert.ok(before.ok)
    assert.equal(before.challenge.authorAnswers, undefined)
    assert.equal(JSON.stringify(before).includes("authorAnswers"), false)
    // Alice sees her own answers
    assert.deepEqual((await call("GET", `/challenges/${id}`, undefined, ALICE)).challenge.authorAnswers, [0, 1, 2, 0, 1])

    // only Bobby may take it, and only with well-formed answers
    assert.equal((await call("POST", `/challenges/${id}/attempt`, { answers: [0, 1, 2, 0, 0] }, ALICE)).status, 403)
    assert.equal((await call("POST", `/challenges/${id}/attempt`, { answers: [0, 1] }, BOBBY)).status, 400)
    assert.equal((await call("POST", `/challenges/${id}/attempt`, { answers: [0, 1, 2, 0, 99] }, BOBBY)).status, 400)
    const taken = await call("POST", `/challenges/${id}/attempt`, { answers: [0, 1, 2, 0, 0] }, BOBBY)
    assert.ok(taken.ok, taken.error)
    assert.equal(taken.challenge.result.correct, 4)
    assert.equal(taken.challenge.result.percent, 80)
    assert.deepEqual(taken.challenge.authorAnswers, [0, 1, 2, 0, 1])
    assert.equal(aim.sessions.get("alice").socket.events.at(-1).event, "quiz:done")
    // once only
    assert.equal((await call("POST", `/challenges/${id}/attempt`, { answers: [0, 1, 2, 0, 1] }, BOBBY)).status, 409)

    // the pair's running score
    const scores = await call("GET", "/scores", undefined, ALICE)
    assert.equal(scores.scores.length, 1)
    assert.equal(scores.scores[0].with, "Bobby")
    assert.equal(scores.scores[0].average, 80)
    assert.equal((await call("GET", "/scores", undefined, CAROL)).scores.length, 0)
  } finally {
    server.close()
  }
})

test("privacy: a third account can't read, take or delete someone else's quiz", async () => {
  const { server, call } = serve()
  try {
    const { challenge } = await call("POST", "/challenges", { ...knowme(), to: "Bobby" }, ALICE)
    const id = challenge.id
    for (const [method, path, body] of [["GET", `/challenges/${id}`], ["POST", `/challenges/${id}/attempt`, { answers: [0, 1, 2, 0, 1] }], ["DELETE", `/challenges/${id}`]]) {
      const r = await call(method, path, body, CAROL)
      assert.equal(r.status, 404, `${method} ${path}`)
      assert.equal(JSON.stringify(r).includes("authorAnswers"), false)
    }
    assert.equal((await call("GET", "/inbox", undefined, CAROL)).challenges.length, 0)
    // still there for its two people, untouched
    assert.equal((await call("GET", `/challenges/${id}`, undefined, BOBBY)).challenge.status, "waiting")
    // bad ids are just "not found"
    assert.equal((await call("GET", "/challenges/..%2F..%2Fetc", undefined, BOBBY)).status, 404)
    // removing: Bobby hides it from his inbox; Alice still has it
    assert.ok((await call("DELETE", `/challenges/${id}`, undefined, BOBBY)).ok)
    assert.equal((await call("GET", "/inbox", undefined, BOBBY)).challenges.length, 0)
    assert.equal((await call("GET", "/inbox", undefined, ALICE)).challenges.length, 1)
    assert.equal((await call("GET", `/challenges/${id}`, undefined, BOBBY)).status, 404)
  } finally {
    server.close()
  }
})

test("validation: recipients, kinds, sizes and blocks", async () => {
  const { server, call, aim } = serve()
  try {
    const send = (body, token = ALICE) => call("POST", "/challenges", body, token)
    assert.match((await send({ ...knowme(), to: "" })).error, /screen name/)
    assert.match((await send({ ...knowme(), to: "<script>" })).error, /screen name/)
    assert.match((await send({ ...knowme(), to: "Alice" })).error, /yourself/)
    assert.match((await send({ ...knowme(), to: "Nobody Here" })).error, /isn't a 98 Messenger/)
    assert.equal((await send({ kind: "nope", to: "Bobby" })).ok, false)
    assert.equal((await send({ ...knowme(), answers: [9, 9, 9, 9, 9], to: "Bobby" })).ok, false)
    assert.equal((await send({ kind: "custom", to: "Bobby", title: "T", questions: [{ type: "choice", text: "Q", options: ["a"], answer: 0 }] })).ok, false)
    const huge = await send({ kind: "custom", to: "Bobby", title: "T", questions: Array(2000).fill({ type: "text", text: "x".repeat(200), answer: "y" }) })
    assert.equal(huge.status, 413)
    assert.equal((await send("{not json")).status, 400)
    // a quiz to someone signed off still waits in their inbox
    assert.ok((await send({ ...knowme(), to: "Dave" })).ok)

    // blocked by the recipient: looks sent, never arrives
    aim.users.bobby.blocked = ["alice"]
    assert.ok((await send({ ...knowme(), to: "Bobby" })).ok)
    assert.equal((await call("GET", "/inbox", undefined, BOBBY)).challenges.length, 0)
    aim.users.bobby.blocked = []
    // you blocked them
    aim.users.alice.blocked = ["carol"]
    assert.match((await send({ ...knowme(), to: "Carol" })).error, /blocked/)
  } finally {
    server.close()
  }
})

test("rate limits: sending, and requests per minute", async () => {
  const { server, call } = serve({ limits: { sendsPerHour: 3, requestsPerMinute: 1000 } })
  try {
    for (let i = 0; i < 3; i++) assert.ok((await call("POST", "/challenges", { ...knowme(), to: "Bobby" }, ALICE)).ok)
    const r = await call("POST", "/challenges", { ...knowme(), to: "Bobby" }, ALICE)
    assert.equal(r.status, 429)
    // other people aren't affected
    assert.ok((await call("POST", "/challenges", { ...knowme(), to: "Alice" }, BOBBY)).ok)
  } finally {
    server.close()
  }
  const slow = serve({ limits: { requestsPerMinute: 5 } })
  try {
    for (let i = 0; i < 5; i++) assert.equal((await slow.call("GET", "/inbox", undefined, ALICE)).status, 200)
    assert.equal((await slow.call("GET", "/inbox", undefined, ALICE)).status, 429)
  } finally {
    slow.server.close()
  }
})

test("custom quizzes: save, list, send, take with fuzzy text; compatibility combined result", async () => {
  const { server, call } = serve()
  try {
    const quiz = {
      title: "Our story",
      questions: [
        { type: "text", text: "Where did we first meet?", answer: "Coffee shop / cafe" },
        { type: "truefalse", text: "I've been to Paris.", answer: true },
        { type: "who", text: "Which of us is more likely to cry at a movie?", answer: "taker" },
        { type: "choice", text: "My favorite fruit?", options: ["Mango", "Kiwi", "Plum"], answer: 0 },
      ],
    }
    const saved = await call("POST", "/quizzes", quiz, ALICE)
    assert.ok(saved.ok, saved.error)
    assert.equal((await call("GET", "/quizzes", undefined, ALICE)).quizzes.length, 1)
    assert.equal((await call("GET", "/quizzes", undefined, BOBBY)).quizzes.length, 0)
    // update in place
    assert.equal((await call("POST", "/quizzes", { ...quiz, id: saved.quiz.id, title: "Our story 2" }, ALICE)).quiz.id, saved.quiz.id)
    assert.equal((await call("GET", "/quizzes", undefined, ALICE)).quizzes[0].title, "Our story 2")
    // Bobby can't delete Alice's
    await call("DELETE", `/quizzes/${saved.quiz.id}`, undefined, BOBBY)
    assert.equal((await call("GET", "/quizzes", undefined, ALICE)).quizzes.length, 1)

    const sent = await call("POST", "/challenges", { kind: "custom", to: "Bobby", ...quiz }, ALICE)
    assert.ok(sent.ok)
    const view = await call("GET", `/challenges/${sent.challenge.id}`, undefined, BOBBY)
    assert.equal(view.challenge.payload.questions[0].answer, undefined, "no answers inside the questions")
    assert.equal(JSON.stringify(view).includes("Coffee"), false)
    const taken = await call("POST", `/challenges/${sent.challenge.id}/attempt`, { answers: ["the coffe shop", true, "author", 0] }, BOBBY)
    assert.ok(taken.ok, taken.error)
    assert.deepEqual(taken.challenge.result.per, [true, true, false, true])

    const love = content.compat[0]
    const compat = await call("POST", "/challenges", { kind: "compat", quizId: love.id, answers: love.questions.map(() => 0), to: "Bobby" }, ALICE)
    assert.ok(compat.ok, compat.error)
    const done = await call("POST", `/challenges/${compat.challenge.id}/attempt`, { answers: love.questions.map(() => 0) }, BOBBY)
    assert.equal(done.challenge.result.percent, 100)
    assert.ok(done.challenge.result.couple.same)
    assert.ok(done.challenge.result.author.top)
  } finally {
    server.close()
  }
})

// ---------- live games ----------

const fakeClock = () => {
  let now = 1_000_000
  const timers = new Map()
  let seq = 0
  return {
    now: () => now,
    setTimeout: (fn, ms) => (timers.set(++seq, { at: now + ms, fn }), seq),
    clearTimeout: (h) => timers.delete(h),
    advance: (ms) => {
      now += ms
      for (const [h, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now && timers.has(h)) {
          timers.delete(h)
          t.fn()
        }
      }
    },
  }
}

const liveSetup = async (options = {}) => {
  const sent = []
  const records = []
  const clock = fakeClock()
  const live = createQuizLive({ emit: (pid, event, payload) => sent.push({ pid, event, payload }), clock, random: () => 0.3, record: (r) => records.push(r), ...options })
  await live.ready
  const last = (pid, event = "quiz:room") => sent.filter((s) => s.pid === pid && s.event === event).at(-1)?.payload
  const me = (pid, name, key = pid) => ({ pid, name, key })
  return { live, sent, records, clock, last, me }
}

test("live How Well Do You Know Me: invite, answers hidden until the reveal, score recorded", async () => {
  const { live, last, me, records, clock } = await liveSetup()
  const sent = []
  const games = createGames({ emit: (pid, event, payload) => sent.push({ pid, event, payload }), quiz: live })
  const { roomId } = live.create(me("p1", "Alice"), { mode: "knowme", options: { count: 3 } })
  // invite Bobby through games.js
  const inv = games.invite({ from: "p1", fromName: "Alice", to: "p2", toName: "Bobby", game: "quiz", matchId: roomId })
  assert.ok(inv.ok, inv.error)
  assert.deepEqual(last("p1").invited, ["Bobby"])
  // Carol can't just walk in
  assert.equal(live.join(me("p3", "Carol"), roomId).ok, false)
  const reply = games.replyInvite("p2", inv.inviteId, true)
  assert.equal(reply.quizRoom, roomId)
  assert.ok(live.join(me("p2", "Bobby"), roomId).ok)
  assert.deepEqual(last("p1").invited, [])
  assert.equal(live.start("p2", roomId).ok, false, "only the host starts")
  assert.ok(live.start("p1", roomId).ok)
  assert.ok(live.busy("p1"))
  assert.equal(last("p1").total, 6)
  assert.equal(last("p1").current.subject, "p1")

  for (let step = 0; step < 6; step++) {
    const subject = last("p1").current.subject
    assert.ok(live.answer("p1", roomId, { step, answer: 1 }).ok)
    // Bobby doesn't see Alice's answer, only that she's answered
    const bob = last("p2")
    assert.equal(bob.phase, "question")
    assert.equal(bob.yourAnswer, null)
    assert.ok(bob.players.find((p) => p.id === "p1").answered)
    assert.equal(JSON.stringify(bob).includes('"answers"'), false)
    assert.equal(live.answer("p1", roomId, { step, answer: 2 }).ok, false, "one answer per question")
    assert.equal(live.answer("p2", roomId, { step, answer: 99 }).ok, false)
    live.answer("p2", roomId, { step, answer: step < 4 ? 1 : 0 })
    const reveal = last("p2").reveal
    assert.equal(reveal.subject, subject)
    assert.equal(reveal.match, step < 4)
    assert.equal(live.next("p2", roomId).ok, false, "a moment to enjoy the reveal")
    clock.advance(1000)
    assert.ok(live.next("p2", roomId).ok)
  }
  const done = last("p1")
  assert.equal(done.phase, "done")
  assert.equal(done.result.percent, 67)
  assert.equal(done.result.players.p2.guessed, 3)
  assert.equal(done.log.length, 6)
  assert.deepEqual(records, [{ a: "p1", b: "p2", mode: "knowme", percent: 67 }])
  assert.equal(live.playersOf(roomId).length, 2)
  // play again
  assert.ok(live.again("p1", roomId).ok)
  assert.equal(last("p2").phase, "lobby")
})

test("live games: a timer reveals unanswered questions; leaving ends a two-player game", async () => {
  const { live, last, me, clock } = await liveSetup()
  const { roomId } = live.create(me("p1", "Alice"), { mode: "tot", options: { count: 5, timer: 10 } })
  live.allow("p2", roomId)
  live.join(me("p2", "Bobby"), roomId)
  live.start("p1", roomId)
  live.answer("p1", roomId, { step: 0, answer: 0 })
  clock.advance(10_100)
  const r = last("p1")
  assert.equal(r.phase, "reveal")
  assert.equal(r.reveal.answers.p2, null)
  assert.equal(r.reveal.match, false)
  clock.advance(1000)
  live.next("p1", roomId)
  live.leave("p2", roomId)
  assert.equal(last("p1").phase, "done")
  assert.match(last("p1").note, /Bobby left/)
  // the last one out closes the room
  live.leave("p1", roomId)
  assert.equal(live.rooms.has(roomId), false)
})

test("live party trivia: three players, speed points, standings", async () => {
  const { live, last, me, clock } = await liveSetup()
  const { roomId } = live.create(me("p1", "Alice"), { mode: "trivia", options: { count: 5, pack: "geo", timer: 20 } })
  assert.equal(last("p1").options.pack, "geo")
  for (const [pid, name] of [["p2", "Bobby"], ["p3", "Carol"]]) {
    live.allow(pid, roomId)
    assert.ok(live.join(me(pid, name), roomId).ok)
  }
  assert.equal(live.canInvite("p1", roomId).ok, true)
  live.start("p1", roomId)
  for (let step = 0; step < 5; step++) {
    const id = last("p1").current.item
    const q = content.trivia.find((t) => t.id === id)
    assert.ok(id.startsWith("tv-geo-"))
    live.answer("p1", roomId, { step, answer: q.answer })
    clock.advance(5000)
    live.answer("p2", roomId, { step, answer: q.answer })
    live.answer("p3", roomId, { step, answer: (q.answer + 1) % 4 })
    const reveal = last("p3").reveal
    assert.equal(reveal.correct, q.answer)
    assert.ok(reveal.points.p1 > reveal.points.p2, "faster right answers score more")
    assert.equal(reveal.points.p3, 0)
    clock.advance(1000)
    live.next("p3", roomId)
  }
  const result = last("p2").result
  assert.deepEqual(result.standings.map((s) => s.name), ["Alice", "Bobby", "Carol"])
  assert.deepEqual(result.winners, ["p1"])
  assert.equal(result.standings[0].correct, 5)
})

test("live deep talk: everyone sees the same card; levels; no repeats until the deck runs out", async () => {
  const { live, last, me } = await liveSetup()
  const { roomId } = live.create(me("p1", "Alice"), { mode: "deep", options: { level: 2 } })
  live.allow("p2", roomId)
  live.join(me("p2", "Bobby"), roomId)
  live.start("p1", roomId)
  assert.equal(last("p1").card.id, last("p2").card.id)
  assert.equal(last("p1").card.level, 2)
  const seen = new Set([last("p1").card.id])
  for (let i = 0; i < 29; i++) {
    live.next(i % 2 ? "p1" : "p2", roomId)
    seen.add(last("p1").card.id)
  }
  assert.equal(seen.size, 30)
  live.setLevel("p2", roomId, 3)
  assert.equal(last("p1").card.level, 3)
  assert.ok(last("p1").card.drawn >= 31)
})

test("live rooms: options are cleaned, reactions are rate limited, players are capped", async () => {
  assert.deepEqual(cleanOptions("knowme", { count: 999, timer: 7 }), { count: 10, timer: 0 })
  assert.deepEqual(cleanOptions("trivia", { pack: "../etc" }, ["geo"]), { count: 10, timer: 20, pack: "mix" })
  const { live, sent, me } = await liveSetup()
  assert.equal(live.create(me("p1", "Alice"), { mode: "hack" }).ok, false)
  const { roomId } = live.create(me("p1", "Alice"), { mode: "knowme" })
  live.allow("p2", roomId)
  live.join(me("p2", "Bobby"), roomId)
  assert.equal(live.canInvite("p1", roomId).ok, false, "How Well Do You Know Me is for two")
  live.allow("p3", roomId)
  assert.equal(live.join(me("p3", "Carol"), roomId).ok, false)
  assert.equal(live.react("p1", roomId, "<script>").ok, false)
  let ok = 0
  for (let i = 0; i < 20; i++) ok += live.react("p1", roomId, "heart").ok ? 1 : 0
  assert.equal(ok, 12)
  assert.ok(sent.some((s) => s.pid === "p2" && s.event === "quiz:reaction" && s.payload.from === "Alice"))
  assert.equal(live.react("p3", roomId, "heart").ok, false, "only players react")
})
