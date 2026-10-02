// Doodle Together rooms: who may draw where, relaying strokes to the others, the checks
// and rate limits on what's drawn, clearing (the other person has to agree), history for
// late joiners and snapshots when it gets big, and invitations through games.js.
const test = require("node:test")
const assert = require("node:assert/strict")
const { createDoodle, LIMITS } = require("../doodle")
const { createGames } = require("../games")

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

const fakeClock = () => {
  let now = 1_000_000
  const timers = new Set()
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const t = { fn, at: now + ms }
      timers.add(t)
      return t
    },
    clearTimeout: (t) => timers.delete(t),
    advance: (ms) => {
      now += ms
      for (const t of [...timers]) if (t.at <= now) timers.delete(t), t.fn()
    },
  }
}

const setup = (limits) => {
  const sent = []
  const clock = fakeClock()
  const doodle = createDoodle({ emit: (pid, event, payload) => sent.push({ pid, event, payload }), clock, limits })
  const events = (pid, event) => sent.filter((s) => s.pid === pid && s.event === event).map((s) => s.payload)
  return { doodle, sent, events, clock }
}

const A = { pid: "aaaaaa", name: "Alice" }
const B = { pid: "bbbbbb", name: "Bobby" }
const C = { pid: "cccccc", name: "Carol" }
const start = { c: "#ff0000", w: 6, t: "brush" }

const pair = (limits) => {
  const s = setup(limits)
  const { roomId } = s.doodle.create(A, { template: "heart" })
  s.doodle.allow(B.pid, roomId)
  assert.ok(s.doodle.join(B, roomId).ok)
  return { ...s, roomId }
}

test("only the maker and invited people can join a room", () => {
  const { doodle } = setup()
  const made = doodle.create(A, { template: "heart" })
  assert.ok(made.ok)
  assert.equal(made.room.template, "heart")
  assert.equal(made.room.members.length, 1)
  assert.equal(doodle.join(C, made.roomId).ok, false, "not invited")
  doodle.allow(B.pid, made.roomId)
  const joined = doodle.join(B, made.roomId)
  assert.ok(joined.ok)
  assert.deepEqual(joined.room.members.map((m) => m.name), ["Alice", "Bobby"])
  assert.notEqual(joined.room.members[0].color, joined.room.members[1].color, "each artist has their own cursor color")
  assert.deepEqual(doodle.playersOf(made.roomId).sort(), [A.pid, B.pid].sort())
  // strangers can't draw, clear or change the background
  assert.equal(doodle.stroke(C.pid, made.roomId, { id: "s1ab", p: [1, 2], start }).ok, false)
  assert.equal(doodle.clear(C.pid, made.roomId).ok, false)
  assert.equal(doodle.setTemplate(C.pid, made.roomId, "lined").ok, false)
  assert.equal(doodle.create(C, { template: "nope" }).room.template, "blank")
  // a drawing started alone comes along as the first snapshot (pictures only)
  assert.equal(doodle.create(B, { image: PNG }).state.snapshot, PNG)
  assert.equal(doodle.create(B, { image: "data:image/svg+xml;base64,PHN2Zz4=" }).ok, false)
  assert.equal(doodle.create(B, { image: `data:image/png;base64,${"A".repeat(LIMITS.snapshotBytes)}` }).ok, false)
})

test("strokes are checked and relayed to everyone else in the room", () => {
  const { doodle, events, roomId } = pair()
  assert.ok(doodle.stroke(A.pid, roomId, { id: "st01", p: [10, 10, 20, 20.26], start }).ok)
  assert.ok(doodle.stroke(A.pid, roomId, { id: "st01", p: [30, 30], end: true }).ok)
  const got = events(B.pid, "doodle:stroke")
  assert.equal(got.length, 2)
  assert.deepEqual(got[0], { by: A.pid, id: "st01", p: [10, 10, 20, 20.3], start: { c: "#ff0000", w: 6, t: "brush" } })
  assert.deepEqual(got[1], { by: A.pid, id: "st01", p: [30, 30], end: true })
  assert.equal(events(A.pid, "doodle:stroke").length, 0, "not echoed back to the artist")
  // finished strokes take no more points; others' strokes can't be extended
  assert.equal(doodle.stroke(A.pid, roomId, { id: "st01", p: [1, 1] }).ok, false)
  assert.ok(doodle.stroke(B.pid, roomId, { id: "bb01", p: [5, 5], start: { c: "#00ff00", w: 2, t: "pencil" } }).ok)
  assert.equal(doodle.stroke(A.pid, roomId, { id: "bb01", p: [6, 6] }).ok, false)

  const bad = [
    { id: "x1x1", p: [1, 2, 3], start }, // odd number of coordinates
    { id: "x2x2", p: [1, "2"], start },
    { id: "x3x3", p: [1, 99999], start }, // off the canvas
    { id: "x4x4", p: [1, NaN], start },
    { id: "x5x5", p: Array(LIMITS.batchNumbers + 2).fill(5), start }, // too big a batch
    { id: "x6x6", p: [1, 2], start: { ...start, c: "red" } },
    { id: "x7x7", p: [1, 2], start: { ...start, c: "#ff0000;background:url(x)" } },
    { id: "x8x8", p: [1, 2], start: { ...start, w: 500 } },
    { id: "x9x9", p: [1, 2], start: { ...start, t: "laser" } },
    { id: "<script>", p: [1, 2], start },
  ]
  for (const message of bad) assert.equal(doodle.stroke(A.pid, roomId, message).ok, false, JSON.stringify(message).slice(0, 60))
  // fills and stickers
  assert.ok(doodle.fill(A.pid, roomId, { id: "fi01", x: 480, y: 480, c: "#FFAACC" }).ok)
  assert.deepEqual(events(B.pid, "doodle:op").at(-1), { k: "f", id: "fi01", by: A.pid, x: 480, y: 480, c: "#ffaacc" })
  assert.equal(doodle.fill(A.pid, roomId, { id: "fi02", x: -5, y: 10, c: "#ffffff" }).ok, false)
  assert.ok(doodle.sticker(B.pid, roomId, { id: "sk01", x: 100, y: 100, n: "heart", s: 80, c: "#e0457b" }).ok)
  assert.equal(doodle.sticker(B.pid, roomId, { id: "sk02", x: 100, y: 100, n: "skull", s: 80, c: "#e0457b" }).ok, false)
  assert.equal(doodle.sticker(B.pid, roomId, { id: "sk03", x: 100, y: 100, n: "star", s: 9000, c: "#e0457b" }).ok, false)
})

test("drawing is rate limited and strokes have a maximum length", () => {
  const { doodle, roomId } = pair({ messagesPerSecond: 20, strokeNumbers: 400 })
  let refused = 0
  for (let i = 0; i < 30; i++) {
    const r = doodle.fill(A.pid, roomId, { id: `ff${String(i).padStart(2, "0")}`, x: 1, y: 1, c: "#000000" })
    if (!r.ok) {
      refused++
      assert.equal(r.code, "rate")
    }
  }
  assert.equal(refused, 10)
  // Bobby has his own allowance
  assert.ok(doodle.stroke(B.pid, roomId, { id: "long", p: Array(200).fill(3), start }).ok)
  assert.ok(doodle.stroke(B.pid, roomId, { id: "long", p: Array(200).fill(3) }).ok)
  assert.match(doodle.stroke(B.pid, roomId, { id: "long", p: [3, 3] }).error, /too long/)
})

test("undo takes back only your own things", () => {
  const { doodle, events, roomId } = pair()
  doodle.stroke(A.pid, roomId, { id: "aa01", p: [1, 1, 2, 2], start, end: true })
  doodle.stroke(B.pid, roomId, { id: "bb01", p: [3, 3], start, end: true })
  assert.equal(doodle.undo(B.pid, roomId, { id: "aa01" }).ok, false, "not Bobby's")
  assert.ok(doodle.undo(A.pid, roomId, { id: "aa01" }).ok)
  assert.deepEqual(events(B.pid, "doodle:undo").at(-1), { by: A.pid, id: "aa01" })
  assert.equal(doodle.undo(A.pid, roomId, { id: "aa01" }).ok, false, "already undone")
  assert.deepEqual(doodle.stateOf(roomId).ops.map((o) => o.id), ["bb01"], "late joiners don't see undone strokes")
})

test("clearing asks the other person", () => {
  const { doodle, events, roomId, clock } = pair()
  doodle.stroke(A.pid, roomId, { id: "aa01", p: [1, 1], start, end: true })
  assert.deepEqual(doodle.clear(A.pid, roomId), { ok: true, asked: true })
  assert.deepEqual(events(B.pid, "doodle:clearAsk"), [{ from: "Alice" }])
  assert.equal(doodle.stateOf(roomId).ops.length, 1, "nothing cleared yet")
  doodle.clearReply(B.pid, roomId, false)
  assert.match(events(A.pid, "doodle:clearResult")[0].text, /Bobby wants to keep/)
  assert.equal(doodle.stateOf(roomId).ops.length, 1)
  // ask again; this time yes
  doodle.clear(A.pid, roomId)
  doodle.clearReply(B.pid, roomId, true)
  assert.equal(doodle.stateOf(roomId).ops.length, 0)
  assert.equal(events(A.pid, "doodle:cleared").length, 1)
  assert.equal(events(B.pid, "doodle:cleared").length, 1)
  // no answer: kept
  doodle.stroke(A.pid, roomId, { id: "aa02", p: [1, 1], start, end: true })
  doodle.clear(B.pid, roomId)
  clock.advance(LIMITS.clearMs + 1)
  assert.equal(doodle.stateOf(roomId).ops.length, 1)
  assert.match(events(B.pid, "doodle:clearResult")[0].text, /Nobody answered/)
  // alone: clears at once
  doodle.leave(B.pid, roomId)
  assert.deepEqual(doodle.clear(A.pid, roomId), { ok: true, cleared: true })
})

test("late joiners get the history; big histories become a snapshot", () => {
  const { doodle, events, roomId } = pair({ snapshotAt: 600, hardCap: 1200 })
  for (let i = 0; i < 4; i++) doodle.stroke(A.pid, roomId, { id: `aa0${i}`, p: Array(120).fill(i + 1), start, end: true })
  // 4 strokes of 120 numbers + 20 each = 560: not yet
  assert.equal(events(A.pid, "doodle:needSnapshot").length, 0)
  doodle.stroke(B.pid, roomId, { id: "bb01", p: Array(60).fill(7), start }) // still being drawn
  const asks = events(A.pid, "doodle:needSnapshot")
  assert.equal(asks.length, 1, "the longest-there member is asked")
  assert.equal(asks[0].upTo, 4, "only finished strokes go into the picture")
  assert.deepEqual([asks[0].lastId, asks[0].lastBy], ["aa03", A.pid])
  // a newcomer before the snapshot arrives gets every op
  doodle.allow(C.pid, roomId)
  const early = doodle.join(C, roomId)
  assert.equal(early.state.ops.length, 5)
  assert.equal(early.state.snapshot, null)
  assert.equal(early.state.template, "heart")
  // checks on the picture: only the member asked, with the right token, a real image
  assert.equal(doodle.snapshot(B.pid, roomId, { token: asks[0].token, image: PNG }).ok, false)
  assert.equal(doodle.snapshot(A.pid, roomId, { token: "nope", image: PNG }).ok, false)
  // a bad picture uses up the request; the next drawing asks again
  assert.equal(doodle.snapshot(A.pid, roomId, { token: asks[0].token, image: "data:image/svg+xml;base64,PHN2Zz4=" }).ok, false)
  doodle.stroke(B.pid, roomId, { id: "bb01", p: [8, 8], end: true })
  doodle.fill(C.pid, roomId, { id: "cc01", x: 5, y: 5, c: "#123456" })
  const again = events(A.pid, "doodle:needSnapshot").at(-1)
  assert.notEqual(again.token, asks[0].token)
  assert.equal(again.upTo, 5, "asked again as soon as Bobby's stroke ended")
  assert.ok(doodle.snapshot(A.pid, roomId, { token: again.token, image: PNG }).ok)
  const state = doodle.stateOf(roomId)
  assert.equal(state.snapshot, PNG)
  assert.deepEqual(state.ops.map((o) => o.id), ["cc01"], "what came after the request stays as ops")
  // flattened strokes can't be undone
  assert.equal(doodle.undo(A.pid, roomId, { id: "aa01" }).ok, false)
  // a later joiner gets the snapshot plus what came after
  doodle.stroke(B.pid, roomId, { id: "bb02", p: [1, 1], start, end: true })
  doodle.leave(C.pid, roomId)
  doodle.allow(C.pid, roomId)
  const late = doodle.join(C, roomId)
  assert.equal(late.state.snapshot, PNG)
  assert.deepEqual(late.state.ops.map((o) => o.id), ["cc01", "bb02"])
})

test("past the hard cap, drawing waits for the snapshot", () => {
  const { doodle, roomId } = pair({ snapshotAt: 300, hardCap: 500, messagesPerSecond: 1000 })
  let refused = null
  for (let i = 0; i < 20 && !refused; i++) {
    const r = doodle.stroke(A.pid, roomId, { id: `aa${String(i).padStart(2, "0")}`, p: Array(100).fill(1), start, end: true })
    if (!r.ok) refused = r
  }
  assert.equal(refused?.code, "full")
})

test("invitations through games.js let people into the room", () => {
  const sent = []
  const emit = (pid, event, payload) => sent.push({ pid, event, payload })
  const doodle = createDoodle({ emit })
  const games = createGames({ emit, doodle })
  const { roomId } = doodle.create(A)
  assert.equal(games.invite({ from: B.pid, fromName: "Bobby", to: A.pid, toName: "Alice", game: "doodle", matchId: roomId }).ok, false, "Bobby isn't in the room")
  const inv = games.invite({ from: A.pid, fromName: "Alice", to: B.pid, toName: "Bobby", game: "doodle", matchId: roomId })
  assert.ok(inv.ok)
  const invited = sent.find((s) => s.pid === B.pid && s.event === "net:invited").payload
  assert.equal(invited.gameName, "Doodle Together")
  assert.deepEqual(doodle.hello(A.pid).room.invited, ["Bobby"])
  assert.equal(doodle.join(B, roomId).ok, false, "not before accepting")
  const reply = games.replyInvite(B.pid, inv.inviteId, true)
  assert.deepEqual(reply, { ok: true, doodleRoom: roomId })
  assert.equal(doodle.hello(B.pid).invited, roomId)
  assert.ok(doodle.join(B, roomId).ok)
  assert.deepEqual(doodle.hello(A.pid).room.invited, [])
  // disconnecting and leaving
  doodle.setAway(B.pid, true)
  assert.equal(doodle.hello(A.pid).room.members.find((m) => m.name === "Bobby").away, true)
  doodle.drop(B.pid)
  assert.deepEqual(doodle.playersOf(roomId), [A.pid])
  doodle.drop(A.pid)
  assert.equal(doodle.playersOf(roomId), null, "an empty room closes")
})
