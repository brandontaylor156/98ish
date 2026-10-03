const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const express = require("express")
const { quizRouter } = require("..")
const { memoryStore } = require("../store")
const { createQuizLive, cleanOptions, LIVE_TIMES } = require("../live")
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
    assert.deepEqual(aim.sessions.get("bobby").socket.events.map((e) => e.event), ["quiz:new", "couple:quiz"])
    assert.equal(aim.sessions.get("bobby").socket.events[1].payload.count, 5)

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
    assert.deepEqual(aim.sessions.get("alice").socket.events.slice(-2).map((e) => e.event), ["quiz:done", "couple:quiz-done"])
    assert.equal(aim.sessions.get("alice").socket.events.at(-1).payload.correct, 4)
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
  // 3 about Alice, 3 about Bobby, a lightning round of 4, and the final 2
  assert.equal(last("p1").total, 12)
  assert.deepEqual(last("p2").order.map((p) => p.name), ["Alice", "Bobby"])

  // a round's title card first, on both screens at once; no answering yet
  assert.equal(last("p1").phase, "round")
  assert.equal(last("p1").roundCard.round, "one")
  assert.equal(last("p1").roundCard.until, last("p2").roundCard.until)
  assert.equal(live.answer("p1", roomId, { step: 0, answer: 0 }).ok, false)
  clock.advance(LIVE_TIMES.roundCard)
  assert.equal(last("p1").phase, "question")
  assert.equal(last("p1").current.subject, "p1")
  assert.equal(last("p1").current.timer, 20)

  // who guesses right: Bobby gets every one about Alice; Alice gets one of three about
  // Bobby; the lightning round goes Bobby, (Alice runs out of time), Bobby, miss; then the
  // final: Bobby bets bold and is right, Alice goes all in and is wrong
  const right = new Set([0, 1, 2, 3, 6, 8, 10])
  for (let step = 0; step < 12; step++) {
    const view = last("p1")
    if (view.phase === "round") {
      if (step === 6) assert.equal(view.roundCard.round, "lightning")
      if (step === 10) assert.equal(view.roundCard.round, "final")
      // a round card can be skipped
      assert.ok(live.next("p2", roomId).ok)
    }
    if (step === 10) {
      assert.equal(last("p1").phase, "bet")
      assert.ok(live.bet("p1", roomId, { bet: "allin" }).ok)
      assert.equal(live.bet("p1", roomId, { bet: "safe" }).ok, false, "one bet each")
      assert.equal(last("p2").bets, null, "bets stay secret until both are in")
      assert.ok(last("p2").players.find((p) => p.id === "p1").answered)
      assert.equal(live.bet("p2", roomId, { bet: "x" }).ok, false)
      assert.ok(live.bet("p2", roomId, { bet: "bold" }).ok)
      assert.deepEqual(last("p1").bets, { p1: "allin", p2: "bold" })
    }
    const cur = last("p1")
    assert.equal(cur.phase, "question", `step ${step}`)
    assert.equal(cur.step, step)
    const subject = cur.current.subject
    const guesser = subject === "p1" ? "p2" : "p1"
    assert.ok(live.answer(subject, roomId, { step, answer: 1 }).ok)
    // the guesser doesn't see the answer, only that it's in
    const other = last(guesser)
    assert.equal(other.phase, "question")
    assert.equal(other.yourAnswer, null)
    assert.ok(other.players.find((p) => p.id === subject).answered)
    assert.equal(JSON.stringify(other).includes('"answers"'), false)
    assert.equal(live.answer(subject, roomId, { step, answer: 2 }).ok, false, "one answer per question")
    assert.equal(live.answer(guesser, roomId, { step, answer: 99 }).ok, false)
    if (step === 7) {
      assert.equal(cur.current.timer, 8, "the lightning round is quick")
      clock.advance(8_100)
    } else live.answer(guesser, roomId, { step, answer: right.has(step) ? 1 : 0 })
    const reveal = last("p2").reveal
    assert.equal(reveal.subject, subject)
    assert.equal(reveal.guesser, guesser)
    assert.equal(reveal.match, right.has(step), `step ${step}`)
    assert.equal(reveal.showAt, last("p1").reveal.showAt, "the reveal opens on both screens at once")
    if (step === 7) assert.equal(reveal.answers.p1, null)
    assert.equal(live.next("p2", roomId).ok, false, "a drum roll, then a moment to enjoy the reveal")
    clock.advance(LIVE_TIMES.drumroll + 900)
    assert.ok(live.next("p2", roomId).ok)
  }
  const done = last("p1")
  assert.equal(done.phase, "done")
  assert.equal(done.result.matches, 7)
  assert.equal(done.result.total, 12)
  assert.equal(done.result.percent, 58)
  assert.equal(done.result.tier, "Sweethearts")
  assert.equal(done.result.headline, "You two matched on 7/12: Sweethearts!")
  // Bobby: 100 + 100 + (200 double + 50 streak) + lightning (50 + 50) x 2 + 250 bet
  assert.equal(done.result.players.p2.points, 900)
  // Alice: 100, then all in (300) on a miss takes it back down to 0
  assert.equal(done.result.players.p1.points, 0)
  assert.equal(done.result.winner, "p2")
  assert.equal(done.result.players.p2.best, 6)
  assert.equal(done.result.players.p2.guessed, 6)
  assert.equal(done.log.length, 12)
  assert.deepEqual(records, [{ a: "p1", b: "p2", mode: "knowme", percent: 58 }])
  assert.equal(live.playersOf(roomId).length, 2)
  // play again
  assert.ok(live.again("p1", roomId).ok)
  assert.equal(last("p2").phase, "lobby")
  assert.equal(last("p2").order, null)
})

test("live show packs: questions come from the chosen pack; unknown packs fall back", async () => {
  const { live, last, me, clock } = await liveSetup()
  const { roomId } = live.create(me("p1", "Alice"), { mode: "knowme", options: { count: 3, pack: "flirty" } })
  assert.equal(last("p1").options.pack, "flirty")
  live.allow("p2", roomId)
  live.join(me("p2", "Bobby"), roomId)
  live.start("p1", roomId)
  clock.advance(LIVE_TIMES.roundCard)
  const id = last("p1").current.item
  assert.equal(content.aboutMe.find((q) => q.id === id).cat, "flirty")
  const other = live.create(me("p3", "Carol"), { mode: "tot", options: { pack: "../../etc", count: 999 } })
  assert.ok(other.ok)
  assert.deepEqual(last("p3").options, { count: 10, pack: "quick", clock: true })
})

test("live games: a timer reveals unanswered questions; leaving ends a two-player game", async () => {
  const { live, last, me, clock } = await liveSetup()
  const { roomId } = live.create(me("p1", "Alice"), { mode: "tot", options: { count: 6 } })
  live.allow("p2", roomId)
  live.join(me("p2", "Bobby"), roomId)
  live.start("p1", roomId)
  clock.advance(LIVE_TIMES.roundCard)
  assert.equal(last("p1").current.round, "warmup")
  live.answer("p1", roomId, { step: 0, answer: 0 })
  clock.advance(20_100)
  const r = last("p1")
  assert.equal(r.phase, "reveal")
  assert.equal(r.reveal.answers.p2, null)
  assert.equal(r.reveal.match, false)
  clock.advance(LIVE_TIMES.drumroll + 1000)
  assert.ok(live.next("p1", roomId).ok)
  // a match scores for both, and both see the same totals
  live.answer("p1", roomId, { step: 1, answer: 1 })
  live.answer("p2", roomId, { step: 1, answer: 1 })
  assert.equal(last("p1").reveal.match, true)
  assert.deepEqual(last("p2").players.map((p) => p.score), [100, 100])
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
  assert.deepEqual(cleanOptions("knowme", { count: 999, timer: 7 }, ["firstdate"]), { count: 5, pack: "firstdate", clock: true })
  assert.deepEqual(cleanOptions("knowme", { count: 7, pack: "quirks", clock: false }, ["firstdate", "quirks"]), { count: 7, pack: "quirks", clock: false })
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
