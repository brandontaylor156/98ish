// Tests for Shred 98's song scheduling (audio.js) on a fake Web Audio: every lead note is
// started early by the sound's path latency so it's heard right on its chart note, pausing,
// resuming and restarting never queue a note twice, and restarting while playing cancels
// the notes already queued from the old spot.
// Run: node --test client/src/components/applets/shred/audio.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { createAudio, DEFAULT_LATENCY } from "./audio.js"

// ---- a fake (offline-style) AudioContext that records when sources start and stop ----
const PARAMS = new Set(["frequency", "detune", "gain", "Q", "offset", "pan", "delayTime", "threshold", "knee", "ratio", "attack", "release", "playbackRate"])
const fakeParam = () => {
  const p = { value: 0 }
  for (const m of ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "setTargetAtTime", "cancelScheduledValues", "cancelAndHoldAtTime"]) p[m] = () => p
  return p
}
const fakeContext = (seconds = 30) => {
  const ctx = {
    sampleRate: 48000,
    length: 48000 * seconds,
    currentTime: 0,
    state: "suspended",
    destination: {},
    sources: [], // every started source: { node, at, stopAt }
    pending: [], // suspend() waits: { t, resolve }
    suspend(t) {
      return new Promise((resolve) => ctx.pending.push({ t, resolve }))
    },
    resume: () => Promise.resolve(),
    createBuffer: (ch, length, sampleRate) => ({ length, sampleRate, getChannelData: () => new Float32Array(length) }),
    createPeriodicWave: () => ({}),
  }
  const node = (kind) => {
    const n = { kind, connect: (to) => to, disconnect: () => {} }
    if (["osc", "source", "constant"].includes(kind)) {
      n.start = (at = 0) => ctx.sources.push((n.rec = { node: n, at, stopAt: Infinity }))
      n.stop = (at = 0) => n.rec && (n.rec.stopAt = at)
    }
    if (kind === "analyser") n.getFloatTimeDomainData = () => {}
    return new Proxy(n, {
      get(t, k) {
        if (!(k in t) && PARAMS.has(k)) t[k] = fakeParam()
        return t[k]
      },
    })
  }
  const kinds = { Oscillator: "osc", BufferSource: "source", ConstantSource: "constant", Analyser: "analyser" }
  for (const name of ["Gain", "BiquadFilter", "DynamicsCompressor", "WaveShaper", "Convolver", "Delay", "StereoPanner", "Oscillator", "BufferSource", "ConstantSource", "Analyser"]) ctx[`create${name}`] = () => node(kinds[name] || name.toLowerCase())
  // run the render forward to time `t`, letting the scheduler wake at each suspend
  ctx.runTo = async (t) => {
    for (;;) {
      ctx.pending.sort((a, b) => a.t - b.t)
      const next = ctx.pending[0]
      if (!next || next.t > t) break
      ctx.pending.shift()
      ctx.currentTime = next.t
      next.resolve()
      await new Promise((r) => setImmediate(r))
    }
    ctx.currentTime = t
  }
  return ctx
}

// a lead line of eighth notes at 120 bpm (0.25 s apart), nothing else playing
const song = {
  id: "test",
  bpm: 120,
  lengthBeats: 16,
  humanize: false,
  markers: [{ name: "intro", beat: 0 }],
  tracks: [
    { name: "lead", instrument: "shredLead", gain: 0.8, pan: 0, reverb: 0, delay: 0, notes: Array.from({ length: 32 }, (_, i) => [i * 0.5, 57 + (i % 5), 0.4, 0.9]) },
    { name: "drums", instrument: "drums", gain: 0.7, notes: [] },
  ],
}
const lateness = DEFAULT_LATENCY.band + DEFAULT_LATENCY.amp

// the lead's string attacks: each string() starts a sawtooth at the note's time; group by time
const attacks = (ctx) => {
  const times = ctx.sources.filter((s) => s.node.kind === "osc" && s.node.type === "sawtooth" && s.stopAt > s.at).map((s) => s.at)
  return [...new Set(times.map((t) => t.toFixed(6)))].map(Number).sort((a, b) => a - b)
}

test("lead notes are started early by the latency, so they're heard on the chart", async () => {
  const ctx = fakeContext()
  const audio = createAudio({ context: ctx })
  audio.load(song)
  audio.start(0)
  await ctx.runTo(9)
  const heard = attacks(ctx).map((t) => t + lateness - audio.anchor)
  assert.equal(heard.length, 32)
  heard.forEach((t, i) => assert.ok(Math.abs(t - i * 0.25) < 1e-6, `note ${i} heard at ${t.toFixed(4)}`))
})

test("pause and resume queue each note once", async () => {
  const ctx = fakeContext()
  const audio = createAudio({ context: ctx })
  audio.load(song)
  audio.start(0)
  await ctx.runTo(1.03)
  const at = audio.pause()
  // anything queued ahead of the pause point is stopped before it starts
  for (const s of ctx.sources) if (s.node.kind === "osc" && s.at > ctx.currentTime) assert.ok(s.stopAt <= s.at + 1e-9 || s.stopAt <= ctx.currentTime + 0.1 + 1e-9)
  ctx.pending.length = 0 // the old render loop is over
  await ctx.runTo(2)
  audio.start(at)
  await ctx.runTo(12)
  const heard = attacks(ctx).map((t) => t + lateness)
  // before the pause on the first anchor, after it on the second: no note twice
  const songTimes = heard.map((t) => (t < 1.1 ? t - 0.08 : t - audio.anchor))
  const rounded = songTimes.map((t) => Math.round(t / 0.25))
  assert.equal(new Set(rounded).size, rounded.length, `duplicates in ${rounded}`)
  assert.equal(rounded.length, 32)
})

test("restarting while playing cancels the notes queued from the old spot", async () => {
  const ctx = fakeContext()
  const audio = createAudio({ context: ctx })
  audio.load(song)
  audio.start(0)
  await ctx.runTo(2.0)
  const queued = ctx.sources.filter((s) => s.node.kind === "osc" && s.node.type === "sawtooth" && s.at > ctx.currentTime)
  assert.ok(queued.length > 0, "some notes were queued ahead")
  audio.start(4) // a practice loop jumping back/forward
  for (const s of queued) assert.ok(s.stopAt <= ctx.currentTime + 0.1 + 1e-9, "the old queued note is cancelled")
})

test("calibration clicks are heard at the time asked for", () => {
  const ctx = fakeContext()
  ctx.currentTime = 1
  const audio = createAudio({ context: ctx })
  audio.clickAt(2)
  const click = ctx.sources.filter((s) => s.node.kind === "osc").at(-1)
  assert.ok(Math.abs(click.at + DEFAULT_LATENCY.sfx - 2) < 1e-9)
})
