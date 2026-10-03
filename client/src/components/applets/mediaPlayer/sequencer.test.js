// Tests for the Media Player's sequencer: compile and the lookahead Scheduler, on a fake
// clock and fake timers. Every note is handed to the synth once, on time, through pause,
// resume, seek, a slow (background) timer and the end of the song.
// Run: node --test client/src/components/applets/mediaPlayer/sequencer.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { compile, swingBeat, lowerBound, heldAt, Scheduler, LOOKAHEAD_HIDDEN, START_DELAY, TAIL } from "./sequencer.js"

// a song of quarter notes at 120 bpm (0.5 s apart), 16 beats
const metronome = (extra = {}) => ({
  id: "metronome",
  bpm: 120,
  lengthBeats: 16,
  tracks: [{ name: "click", instrument: "piano", notes: Array.from({ length: 16 }, (_, i) => [i, 60 + (i % 12), 0.5, 0.8]) }],
  ...extra,
})

// a fake audio clock and timer queue the test drives by hand
const rig = (song, { lookahead } = {}) => {
  const clock = { now: 0 }
  const timers = []
  const played = [] // { e, at }
  const { events, duration } = compile(song)
  let ended = 0
  const s = new Scheduler({
    events,
    duration,
    now: () => clock.now,
    playNote: (e, at, dur) => played.push({ e, at, dur }),
    onEnd: () => ended++,
    setTimer: (fn, ms) => {
      const t = { fn, at: clock.now + ms / 1000 }
      timers.push(t)
      return t
    },
    clearTimer: (t) => {
      const i = timers.indexOf(t)
      if (i >= 0) timers.splice(i, 1)
    },
    lookahead,
  })
  // run time forward, firing timers in order (each tick `late` seconds late)
  const advance = (seconds, late = 0) => {
    const end = clock.now + seconds
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const t = timers[0]
      if (!t || t.at + late > end) break
      timers.shift()
      clock.now = Math.max(clock.now, t.at + late)
      t.fn()
    }
    clock.now = end
  }
  // what the engine does on pause/stop/seek (synth.hush): notes handed over but not started
  // yet are cancelled, so they never sound
  const hush = () => {
    for (let i = played.length - 1; i >= 0; i--) if (played[i].at > clock.now) played.splice(i, 1)
  }
  return { s, clock, played, events, duration, advance, hush, ended: () => ended, timers }
}

test("compile: times from beats, sorted, with the tail", () => {
  const { events, duration } = compile(metronome())
  assert.equal(events.length, 16)
  events.forEach((e, i) => assert.ok(Math.abs(e.time - i * 0.5) < 1e-9))
  assert.ok(Math.abs(duration - (8 + TAIL)) < 1e-9)
})

test("swing pushes only the off-beats", () => {
  const swing = { grid: 0.5, amount: 0.2 }
  assert.equal(swingBeat(1, swing), 1)
  assert.ok(Math.abs(swingBeat(1.5, swing) - 1.6) < 1e-9)
  assert.equal(swingBeat(1.25, swing), 1.25)
})

test("every note is played once, on the audio clock", () => {
  const r = rig(metronome())
  r.s.start(0)
  r.advance(12)
  assert.equal(r.played.length, 16)
  const anchor = START_DELAY // started at clock 0
  r.played.forEach(({ e, at }, i) => {
    assert.equal(e, r.events[i])
    assert.ok(Math.abs(at - (anchor + e.time)) < 1e-9, `note ${i} at ${at}`)
  })
  assert.equal(r.ended(), 1)
  assert.equal(r.s.playing, false)
})

test("pause, resume and seek never hand a note over twice", () => {
  const r = rig(metronome())
  r.s.start(0)
  r.advance(1.2)
  r.s.pause()
  r.hush()
  const pausedAt = r.s.position
  r.advance(3) // time passes while paused: nothing plays
  const beforeResume = r.played.length
  r.advance(1)
  assert.equal(r.played.length, beforeResume)
  r.s.start() // resume where it stopped
  r.advance(0.8)
  // the notes after the pause point, each once
  const times = r.played.map((p) => p.e.time)
  assert.equal(new Set(times).size, times.length, "no duplicates")
  assert.ok(times.every((t, i) => i === 0 || t > times[i - 1]))
  // the resumed notes sit on the new anchor
  const anchor = r.s.anchor
  for (const p of r.played.filter((p) => p.e.time > pausedAt + 0.2)) assert.ok(Math.abs(p.at - (anchor + p.e.time)) < 1e-9)
  // seek back: from there on, again each note once
  r.hush()
  const mark = r.played.length
  r.s.seek(0.4)
  r.hush()
  r.s.seek(0.5) // twice in a row, as a dragged seek bar does
  r.advance(10)
  const after = r.played.slice(mark).map((p) => p.e.time)
  assert.equal(new Set(after).size, after.length)
  assert.deepEqual(after, r.events.filter((e) => e.time >= 0.5 - 1e-9).map((e) => e.time))
})

test("hammering play/pause doesn't stack timers", () => {
  const r = rig(metronome())
  for (let i = 0; i < 20; i++) {
    r.s.start()
    r.advance(0.01)
    r.s.pause()
    r.hush()
  }
  r.s.start()
  assert.ok(r.timers.length <= 1, `${r.timers.length} timers`)
  r.advance(12)
  const times = r.played.map((p) => p.e.time)
  // every note sounds exactly once
  assert.deepEqual(times, r.events.map((e) => e.time))
})

test("a late timer (a slow or background tab) skips past notes instead of playing them late", () => {
  const r = rig(metronome())
  r.s.start(0)
  r.advance(0.3)
  // the timer now fires 2 s late
  r.advance(3, 2)
  for (const p of r.played) assert.ok(p.at >= p.e.time + START_DELAY - 1e-9, "never earlier than written")
  for (const p of r.played) assert.ok(p.at - (START_DELAY + p.e.time) < 0.051, "never more than 50 ms late")
})

test("hidden pages schedule further ahead, and coming back doesn't double notes", () => {
  let hidden = true
  const r = rig(metronome(), { lookahead: () => (hidden ? LOOKAHEAD_HIDDEN : 0.2) })
  r.s.start(0)
  r.advance(0.03)
  // a hidden tab gets the next 1.5 s at once
  assert.ok(r.played.length >= 3)
  r.advance(2, 0.9) // throttled timers
  hidden = false
  r.advance(10)
  const times = r.played.map((p) => p.e.time)
  assert.equal(new Set(times).size, times.length)
  assert.equal(times.length, 16)
})

test("sustained notes from before a seek point are restarted, with what's left of them", () => {
  const song = { id: "pad", bpm: 60, lengthBeats: 8, tracks: [{ name: "pad", instrument: "strings", notes: [[0, 60, 8, 0.7]] }] }
  const { events } = compile(song)
  assert.equal(heldAt(events, 3, () => true).length, 1)
  assert.equal(heldAt(events, 7.8, () => true).length, 0, "almost over: not worth restarting")
  assert.equal(lowerBound(events, 0), 0)
})
