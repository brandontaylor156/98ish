// Photo Puzzle's server: checks on what's sent, privacy (only the sender and recipient can
// read a puzzle, and the hidden message only after it's solved), sizes and storage caps.
const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const express = require("express")
const puzzles = require("..")

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

const fakeAim = () => {
  const users = {
    alice: { key: "alice", screenName: "Alice", blocked: [] },
    bobby: { key: "bobby", screenName: "Bobby", blocked: [] },
    carol: { key: "carol", screenName: "Carol", blocked: ["alice"] },
  }
  const socket = () => ({ events: [], emit(event, payload) { this.events.push({ event, payload }) } })
  const sessions = new Map(Object.keys(users).map((key) => [key, { key, user: users[key], socket: socket() }]))
  const tokens = { ["a".repeat(48)]: "alice", ["b".repeat(48)]: "bobby", ["c".repeat(48)]: "carol" }
  return { users, sessions, authenticate: (token) => sessions.get(tokens[token]) || null, store: { find: async (key) => users[key] || null } }
}
const ALICE = "a".repeat(48)
const BOBBY = "b".repeat(48)
const CAROL = "c".repeat(48)

const serve = (options = {}) => {
  const aim = fakeAim()
  const app = express()
  app.use("/api/puzzles", puzzles.puzzleRouter({ store: puzzles.memoryStore(), aim, coupleIdOf: null, ...options }))
  const server = http.createServer(app).listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api/puzzles`
  const call = (method, path, body, token) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
  return { aim, server, call }
}

const gift = { to: "Bobby", title: "Our trip", mode: "jigsaw", pieces: 24, image: PNG, message: "I love you! Dinner Friday?" }

test("validates who, what, and how big", () => {
  assert.ok(puzzles.validatePuzzle(gift).ok)
  const v = (patch) => puzzles.validatePuzzle({ ...gift, ...patch })
  assert.equal(v({ to: "" }).ok, false)
  assert.equal(v({ to: "<b>x</b>" }).ok, false)
  assert.equal(v({ mode: "sudoku" }).ok, false)
  assert.equal(v({ pieces: 25 }).ok, false)
  assert.ok(v({ mode: "slide", size: 4 }).ok)
  assert.equal(v({ mode: "slide", size: 9 }).ok, false)
  assert.equal(v({ message: "x".repeat(501) }).ok, false)
  assert.equal(v({ message: { html: "<b>" } }).ok, false)
  assert.equal(v({ title: "t".repeat(61) }).ok, false)
  assert.equal(v({ image: "data:image/svg+xml;base64,PHN2Zz4=" }).ok, false)
  assert.equal(v({ image: "data:image/gif;base64,R0lGOD==" }).ok, false)
  assert.equal(v({ image: "javascript:alert(1)" }).ok, false)
  assert.equal(v({ image: "data:image/png;base64,AAAA<script>" }).ok, false)
  assert.ok(v({ image: "data:image/webp;base64,UklGRg==" }).ok)
  assert.ok(v({ image: "data:image/jpeg;base64,/9j/4AAQ" }).ok)
  const big = v({ image: `data:image/png;base64,${"A".repeat(puzzles.MAX_IMAGE_CHARS)}` })
  assert.equal(big.ok, false)
  assert.match(big.error, /too big/)
  // text stays text; control characters go
  assert.equal(v({ message: "<i>hi</i>\u0000" }).puzzle.message, "<i>hi</i>")
  assert.equal(v({ title: "" }).puzzle.title, "A puzzle for you")
  assert.equal(v({ rotate: true }).puzzle.rotate, true)
})

test("only the sender and the recipient can read a puzzle; the message waits for the solve", async () => {
  const { aim, server, call } = serve()
  try {
    for (const [method, path] of [["GET", "/"], ["GET", "/x"], ["POST", "/"], ["POST", "/x/solved"], ["DELETE", "/x"]]) {
      assert.equal((await call(method, path, method === "POST" ? gift : undefined)).status, 401, `${method} ${path} signed off`)
      assert.equal((await call(method, path, method === "POST" ? gift : undefined, "f".repeat(48))).status, 401, `${method} ${path} bad token`)
    }
    const sent = await call("POST", "/", gift, ALICE)
    assert.equal(sent.status, 200)
    const id = sent.puzzle.id
    assert.equal(sent.puzzle.to, "Bobby")
    assert.deepEqual(aim.sessions.get("bobby").socket.events.map((e) => e.event), ["puzzle:new"])
    assert.equal(aim.sessions.get("bobby").socket.events[0].payload.from, "Alice")

    // lists: headers only, no picture or message
    const bobList = await call("GET", "/", undefined, BOBBY)
    assert.equal(bobList.inbox.length, 1)
    assert.equal(bobList.sent.length, 0)
    assert.equal(bobList.inbox[0].image, undefined)
    assert.equal(bobList.inbox[0].message, undefined)
    assert.equal(bobList.inbox[0].hasMessage, true)
    assert.equal((await call("GET", "/", undefined, ALICE)).sent.length, 1)
    assert.equal((await call("GET", "/", undefined, CAROL)).inbox.length, 0)

    // a stranger can't read, solve or delete it (it looks like it doesn't exist)
    assert.equal((await call("GET", `/${id}`, undefined, CAROL)).status, 404)
    assert.equal((await call("POST", `/${id}/solved`, { ms: 5000 }, CAROL)).status, 404)
    assert.equal((await call("DELETE", `/${id}`, undefined, CAROL)).status, 404)

    // the recipient gets the picture but not the message yet; the sender sees both
    const bobView = await call("GET", `/${id}`, undefined, BOBBY)
    assert.equal(bobView.puzzle.image, PNG)
    assert.equal(bobView.puzzle.message, undefined)
    assert.equal((await call("GET", `/${id}`, undefined, ALICE)).puzzle.message, gift.message)

    // only the recipient solves it, with a believable time
    assert.equal((await call("POST", `/${id}/solved`, { ms: 5000 }, ALICE)).status, 403)
    assert.equal((await call("POST", `/${id}/solved`, { ms: 5 }, BOBBY)).status, 400)
    assert.equal((await call("POST", `/${id}/solved`, { ms: "soon" }, BOBBY)).status, 400)
    const solved = await call("POST", `/${id}/solved`, { ms: 252_000, moves: 0 }, BOBBY)
    assert.equal(solved.message, gift.message)
    assert.equal(solved.puzzle.solveMs, 252_000)
    const notice = aim.sessions.get("alice").socket.events.find((e) => e.event === "puzzle:solved")
    assert.deepEqual(notice.payload, { id, by: "Bobby", title: "Our trip", ms: 252_000 })
    // the first solve's time stands
    await call("POST", `/${id}/solved`, { ms: 99_000 }, BOBBY)
    assert.equal((await call("GET", "/", undefined, ALICE)).sent[0].solveMs, 252_000)
    assert.equal((await call("GET", `/${id}`, undefined, BOBBY)).puzzle.message, gift.message)

    // either of them can delete it
    assert.equal((await call("DELETE", `/${id}`, undefined, BOBBY)).status, 200)
    assert.equal((await call("GET", `/${id}`, undefined, ALICE)).status, 404)
  } finally {
    server.close()
  }
})

test("bad requests, unknown and blocking recipients, yourself", async () => {
  const { aim, server, call } = serve()
  try {
    assert.equal((await call("POST", "/", { ...gift, to: "Nobody Here" }, ALICE)).status, 400)
    assert.equal((await call("POST", "/", { ...gift, to: "alice" }, ALICE)).status, 400)
    assert.equal((await call("POST", "/", { ...gift, image: "data:image/svg+xml;base64,PHN2Zz4=" }, ALICE)).status, 400)
    // Carol blocks Alice: it looks sent but never arrives
    const blocked = await call("POST", "/", { ...gift, to: "Carol" }, ALICE)
    assert.equal(blocked.status, 200)
    assert.equal((await call("GET", "/", undefined, CAROL)).inbox.length, 0)
    assert.equal(aim.sessions.get("carol").socket.events.length, 0)
    // a body far too big is refused before it's read
    const huge = await call("POST", "/", { ...gift, image: `data:image/png;base64,${"A".repeat(600_000)}` }, ALICE)
    assert.equal(huge.status, 413)
  } finally {
    server.close()
  }
})

test("storage caps (per couple when paired) and send limits", async () => {
  const image = `data:image/png;base64,${"A".repeat(300_000)}`
  // Alice and Bobby are a couple: they share one cap
  const coupleIdOf = (key) => (key === "alice" || key === "bobby" ? "ab" : null)
  const { server, call } = serve({ storageBytes: 700_000, coupleIdOf })
  try {
    assert.equal((await call("POST", "/", { ...gift, image }, ALICE)).status, 200)
    assert.equal((await call("POST", "/", { ...gift, to: "Alice", image }, BOBBY)).status, 200)
    const full = await call("POST", "/", { ...gift, image }, ALICE)
    assert.equal(full.status, 400)
    assert.match(full.error, /full/)
    // Carol has her own
    assert.equal((await call("POST", "/", { ...gift, image }, CAROL)).status, 200)
    const list = await call("GET", "/", undefined, ALICE)
    assert.ok(list.usage > 600_000 && list.cap === 700_000)
  } finally {
    server.close()
  }
  const limited = serve({ limits: { sendsPerHour: 2 } })
  try {
    assert.equal((await limited.call("POST", "/", gift, ALICE)).status, 200)
    assert.equal((await limited.call("POST", "/", gift, ALICE)).status, 200)
    assert.equal((await limited.call("POST", "/", gift, ALICE)).status, 429)
  } finally {
    limited.server.close()
  }
})
