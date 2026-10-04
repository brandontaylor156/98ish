// Echo Pads' rules. Run: node --test client/src/components/applets/echo/echo.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as R from "./rules.js"

const playRound = (s) => {
  s = R.toInput(s)
  let r
  for (const pad of R.expectedFor(s.seq, s.mode)) {
    r = R.press(s, pad)
    assert.ok(r.ok)
    s = r.state
  }
  assert.ok(r.done)
  return s
}

test("four pads with distinct tones, symbols and keys", () => {
  assert.equal(R.PADS.length, 4)
  for (const k of ["freq", "symbol", "key", "id"]) assert.equal(new Set(R.PADS.map((p) => p[k])).size, 4, k)
})

test("expected presses per mode: classic, reverse, rewind", () => {
  assert.deepEqual(R.expectedFor([0, 1, 2]), [0, 1, 2])
  assert.deepEqual(R.expectedFor([0, 1, 2], "reverse"), [2, 1, 0])
  assert.deepEqual(R.expectedFor([0, 1, 2], "rewind"), [0, 1, 2, 1, 0])
  assert.deepEqual(R.expectedFor([3], "rewind"), [3])
  assert.deepEqual(R.expectedFor([0, 1], "speed"), [0, 1])
})

test("the sequence grows by one each round and keeps its start", () => {
  for (const mode of R.MODES) {
    let s = R.newSolo({ mode, seed: 5 })
    const first = [...s.seq]
    for (let k = 0; k < 12; k++) s = playRound(s)
    assert.equal(s.seq.length, 13)
    assert.deepEqual(s.seq.slice(0, 1), first)
    assert.equal(s.round, 13)
    assert.equal(R.scoreOf(s), 12)
    assert.ok(s.seq.every((p) => p >= 0 && p < 4))
  }
})

test("a wrong press ends the run; presses during the playback are ignored", () => {
  let s = R.newSolo({ seed: 1 })
  assert.equal(R.press(s, 0).ignored, true)
  s = playRound(s)
  s = playRound(s)
  s = R.toInput(s)
  const want = R.expectedFor(s.seq)
  s = R.press(s, want[0]).state
  const r = R.press(s, (want[1] + 1) % 4)
  assert.equal(r.ok, false)
  assert.equal(r.wanted, want[1])
  assert.equal(r.state.over, true)
  assert.equal(R.scoreOf(r.state), 2)
})

test("playback speeds up at 5, 9 and 13 steps; speed mode starts fast", () => {
  const ms = [1, 4, 5, 8, 9, 12, 13, 30].map((n) => R.stepMs(n))
  assert.deepEqual(ms, [580, 580, 470, 470, 380, 380, 300, 300])
  assert.ok(R.stepMs(1, "speed") < R.stepMs(1))
  assert.ok(R.stepMs(20, "speed") >= 200)
})

// ---- online ----
const harness = (n = 3, settings = {}) => {
  let now = 1_000
  const timers = new Map()
  const ctx = () => ({
    now,
    random: () => 0.3,
    after: (ms, action, key = "timer") => timers.set(key, { at: now + ms, action }),
    cancel: (key) => timers.delete(key),
  })
  const players = Array.from({ length: n }, (_, i) => ({ name: `P${i}` }))
  let state = R.create({ players, settings: { ...R.DEFAULTS, ...settings }, random: () => 0, now, after: ctx().after })
  const act = (seat, action) => {
    const next = R.action(state, seat, action, ctx())
    if (next.error) return next
    state = next
    return state
  }
  const advance = (ms) => {
    const end = now + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      now = due[1].at
      act(null, due[1].action)
    }
    now = end
  }
  return { get state() { return state }, act, advance, get now() { return now } }
}

test("Pass the Pads: repeat then add, turns go round; out of turn and while showing is refused", () => {
  const h = harness(3)
  assert.equal(h.state.turn, 0)
  assert.equal(h.state.phase, "add")
  assert.match(h.act(1, { type: "press", pad: 0 }).error, /turn/)
  h.act(0, { type: "press", pad: 2 })
  assert.deepEqual(h.state.seq, [2])
  assert.equal(h.state.turn, 1)
  assert.equal(h.state.phase, "showing")
  assert.match(h.act(1, { type: "press", pad: 2 }).error, /Watch/)
  h.advance(5000)
  assert.equal(h.state.phase, "repeat")
  h.act(1, { type: "press", pad: 2 })
  assert.equal(h.state.phase, "add")
  h.act(1, { type: "press", pad: 3 })
  assert.deepEqual(h.state.seq, [2, 3])
  assert.equal(h.state.turn, 2)
})

test("Pass the Pads: a wrong press or the clock knocks you out; last one standing wins", () => {
  const h = harness(3, { replay: false })
  h.act(0, { type: "press", pad: 1 })
  assert.equal(h.state.phase, "repeat")
  h.act(1, { type: "press", pad: 0 }) // wrong
  assert.equal(h.state.alive[1], false)
  assert.equal(h.state.turn, 2)
  assert.equal(h.state.last.ok, false)
  // player 2 waits too long
  h.advance(R.FIRST_MS + 10)
  assert.equal(h.state.alive[2], false)
  assert.equal(h.state.phase, "over")
  assert.deepEqual(R.isOver(h.state).winners, [0])
  assert.deepEqual(h.state.out.map((o) => o.why), ["wrong", "time"])
})

test("Pass the Pads: the computer repeats correctly early on and leaving knocks you out", () => {
  const h = harness(2, { replay: false })
  h.act(0, { type: "press", pad: 1 })
  const move = R.bot(h.state, 1, { random: () => 0.99 })
  assert.deepEqual(move, { type: "press", pad: 1 })
  assert.equal(R.bot(h.state, 0, { random: () => 0.5 }), null, "not its turn")
  const left = R.onLeave(h.state, 1, { now: h.now, after: () => {}, cancel: () => {} })
  assert.equal(left.phase, "over")
  assert.equal(left.winner, 0)
})
