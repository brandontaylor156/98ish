// Tests for utils/audio.js (the page's sound card) on a fake Web Audio: one shared context,
// the taskbar volume applied live, waking on gestures and on coming back to the page, held
// contexts left alone, closing, and the iOS playback session.
// Run: node --test client/src/utils/audio.test.js
import test from "node:test"
import assert from "node:assert/strict"

// ---- a fake browser ----
const listeners = {}
const on = (type, fn) => (listeners[type] ||= []).push(fn)
const fire = (type) => (listeners[type] || []).forEach((fn) => fn({ type }))

let made = 0
class FakeContext {
  constructor(options) {
    made++
    this.options = options
    this.state = "suspended" // as browsers start them before a gesture
    this.sampleRate = 48000
    this.currentTime = 0
    this.destination = { name: "speakers", inputs: [] }
    this.resumes = 0
    this.silentStarts = 0
    this.blocked = false // a browser that refuses (no gesture yet)
  }
  addEventListener() {}
  resume() {
    this.resumes++
    if (this.state !== "closed" && !this.blocked) this.state = "running"
    return Promise.resolve()
  }
  suspend() {
    this.state = "suspended"
    return Promise.resolve()
  }
  close() {
    this.state = "closed"
    return Promise.resolve()
  }
  node(extra = {}) {
    const n = { inputs: [], connect: (to) => (to.inputs?.push(n), to), disconnect: () => {}, ...extra }
    return n
  }
  param(value) {
    return { value, setTargetAtTime(v) { this.value = v } }
  }
  createGain() {
    return this.node({ kind: "gain", gain: this.param(1) })
  }
  createDynamicsCompressor() {
    return this.node({ kind: "comp", threshold: this.param(-24) })
  }
  createBuffer(ch, length, sampleRate) {
    return { length, sampleRate }
  }
  createBufferSource() {
    return this.node({ kind: "source", start: () => this.silentStarts++ })
  }
}

globalThis.window = { AudioContext: FakeContext, addEventListener: on }
globalThis.document = { visibilityState: "visible", addEventListener: on }
try {
  Object.defineProperty(globalThis.navigator, "audioSession", { value: { type: "auto" }, configurable: true, writable: true })
} catch {
  // no navigator to extend: the session test is skipped
}

const A = await import("./audio.js")
const { setSettings, masterGain } = await import("./settings.js")

test("one shared context for every app's sounds", () => {
  const before = made
  const a = A.createBus({ gain: 0.5, threshold: -10 })
  const b = A.createBus({ gain: 0.4 })
  const x = a()
  const y = b()
  assert.equal(x.ctx, y.ctx)
  assert.equal(A.getAudioContext(), x.ctx)
  assert.equal(made - before, 1)
  // the same bus again: the same nodes
  assert.equal(a().out, x.out)
  assert.equal(x.out.gain.value, 0.5)
})

test("buses go through the master output, which follows the taskbar volume live", () => {
  const ctx = A.getAudioContext()
  const master = A.masterOutput(ctx)
  assert.ok(ctx.destination.inputs.includes(master), "master -> speakers")
  setSettings({ volume: 80, muted: false })
  assert.equal(master.gain.value, masterGain())
  setSettings({ volume: 40 })
  assert.ok(Math.abs(master.gain.value - 0.16) < 1e-9)
  setSettings({ muted: true })
  assert.equal(master.gain.value, 0)
  setSettings({ muted: false, volume: 80 })
  assert.ok(Math.abs(master.gain.value - 0.64) < 1e-9)
  assert.equal(A.masterOutput(ctx), master, "one per context")
})

test("a gesture wakes every context, and primes each once (older iOS)", () => {
  const shared = A.getAudioContext()
  const own = A.createAudioContext({ latencyHint: "playback" })
  assert.equal(own.options.latencyHint, "playback")
  shared.state = "suspended"
  for (const type of ["pointerdown", "pointerup", "touchend", "keydown", "click"]) assert.ok(listeners[type]?.length, `listens for ${type}`)
  fire("touchend")
  assert.equal(shared.state, "running")
  assert.equal(own.state, "running")
  assert.equal(own.silentStarts, 1)
  fire("click")
  assert.equal(own.silentStarts, 1, "primed once")
  A.closeAudioContext(own)
})

test("coming back to the page resumes an interrupted context", () => {
  const ctx = A.getAudioContext()
  ctx.state = "interrupted" // iOS: a call, or the app went to the background
  document.visibilityState = "hidden"
  fire("visibilitychange")
  assert.equal(ctx.state, "interrupted", "not while hidden")
  document.visibilityState = "visible"
  fire("visibilitychange")
  assert.equal(ctx.state, "running")
  ctx.state = "suspended"
  fire("pageshow") // back from the back/forward cache
  assert.equal(ctx.state, "running")
})

test("a context paused on purpose stays paused until released", async () => {
  const game = A.createAudioContext()
  game.state = "running"
  A.holdAudioContext(game)
  await Promise.resolve()
  assert.equal(game.state, "suspended")
  fire("pointerdown")
  fire("visibilitychange")
  assert.equal(game.state, "suspended", "taps and focus leave it alone")
  A.releaseAudioContext(game)
  assert.equal(game.state, "running")
  A.closeAudioContext(game)
})

test("closing a context lets it go", () => {
  const n = A.openContexts()
  const c = A.createAudioContext()
  assert.equal(A.openContexts(), n + 1)
  A.closeAudioContext(c)
  assert.equal(c.state, "closed")
  assert.equal(A.openContexts(), n)
  const resumes = c.resumes
  fire("click")
  assert.equal(c.resumes, resumes, "never woken again")
  // the shared one, if it's ever closed, is made afresh
  const shared = A.getAudioContext()
  A.closeAudioContext(shared)
  assert.notEqual(A.getAudioContext(), shared)
})

test("music players claim the iOS playback session while they're open", (t) => {
  const session = globalThis.navigator?.audioSession
  if (!session) return t.skip("no navigator here")
  const a = A.claimPlaybackSession()
  const b = A.claimPlaybackSession()
  assert.equal(session.type, "playback")
  a()
  a() // twice is harmless
  assert.equal(session.type, "playback", "still one open")
  b()
  assert.equal(session.type, "auto")
})

test("a 98 Messenger call holds the play-and-record session over music players", (t) => {
  const session = globalThis.navigator?.audioSession
  if (!session) return t.skip("no navigator here")
  const music = A.claimPlaybackSession()
  const call = A.claimCallSession()
  assert.equal(session.type, "play-and-record")
  const more = A.claimPlaybackSession()
  assert.equal(session.type, "play-and-record", "a player opening mid-call doesn't take the mic away")
  more()
  call()
  call()
  assert.equal(session.type, "playback", "back to the music player's session")
  music()
  assert.equal(session.type, "auto")
})

test("no Web Audio: nothing breaks", async () => {
  const saved = window.AudioContext
  window.AudioContext = undefined
  try {
    assert.equal(A.audioSupported(), false)
    assert.equal(A.createAudioContext(), null)
  } finally {
    window.AudioContext = saved
  }
})
