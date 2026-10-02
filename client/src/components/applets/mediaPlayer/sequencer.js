// Turns a song (beats) into a timeline of note events (seconds) and plays it with the
// classic lookahead pattern: a timer wakes every TICK_MS and hands the synth every note
// due in the next LOOKAHEAD seconds, timed on the AudioContext clock (so a late timer
// never makes a late note). The clock is injected, so the timing is testable in Node.

export const TICK_MS = 25
export const LOOKAHEAD = 0.2 // seconds scheduled ahead while the page is visible
export const LOOKAHEAD_HIDDEN = 1.5 // background tabs wake up far less often
export const START_DELAY = 0.06 // breathing room before the first note after play/seek
export const TAIL = 2.5 // let the last chord and the reverb ring out

export const beatsToSeconds = (beats, bpm) => (beats * 60) / bpm

// Swing: notes on the off-beat of `grid` (0.5 = eighths) land `amount` of a grid later
export const swingBeat = (beat, swing) => {
  if (!swing) return beat
  const { grid = 0.5, amount = 0 } = swing
  const pair = grid * 2
  const pos = beat / pair
  const within = beat - Math.floor(pos + 1e-9) * pair
  return Math.abs(within - grid) < 1e-6 ? beat + amount * grid : beat
}

// A small deterministic random source, so "human" timing is the same every play
const rng = (seed) => () => {
  seed = (seed * 16807) % 2147483647
  return (seed - 1) / 2147483646
}

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 2147483647, 7) || 1

// song -> { events: [{ time, dur, midi, vel, track }] sorted by time, duration }
export const compile = (song) => {
  const spb = 60 / song.bpm
  const rand = rng(hash(song.id || "song"))
  const events = []
  song.tracks.forEach((track, ti) => {
    for (const [beat, midi, beats, vel] of track.notes) {
      const swung = swingBeat(beat, song.swing)
      const jitter = song.humanize ? (rand() - 0.5) * 0.012 : 0
      const time = Math.max(0, swung * spb + (beat > 0 ? jitter : 0))
      const v = song.humanize ? Math.min(1, Math.max(0.05, vel * (0.94 + rand() * 0.1))) : vel
      events.push({ time, dur: Math.max(0.02, beats * spb), midi, vel: v, track: ti })
    }
  })
  events.sort((a, b) => a.time - b.time || a.track - b.track || a.midi - b.midi)
  const lastEnd = events.reduce((m, e) => Math.max(m, e.time + e.dur), 0)
  const duration = Math.max(beatsToSeconds(song.lengthBeats, song.bpm), lastEnd) + TAIL
  return { events, duration }
}

// Index of the first event at or after `time`
export const lowerBound = (events, time) => {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].time < time) lo = mid + 1
    else hi = mid
  }
  return lo
}

// Events from `index` that start before `until` (song seconds). Returns the next index.
export const due = (events, index, until, out) => {
  while (index < events.length && events[index].time < until) out.push(events[index++])
  return index
}

// Notes already sounding at `time` that are worth restarting after a seek (long, sustained ones)
export const heldAt = (events, time, sustains, minLeft = 0.4) =>
  events.filter((e) => e.time < time && e.time + e.dur > time + minLeft && sustains(e.track))

// Plays compiled events through playNote(event, ctxTime, durOverride?).
// now() is the audio clock in seconds; setTimer/clearTimer default to setTimeout.
export class Scheduler {
  constructor({
    events,
    duration,
    now,
    playNote,
    onEnd,
    sustains = () => false,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    lookahead = () => LOOKAHEAD,
  }) {
    Object.assign(this, { events, duration, now, playNote, onEnd, sustains, setTimer, clearTimer, lookahead })
    this.playing = false
    this.offset = 0 // song position while stopped/paused
    this.anchor = 0 // audio clock time of song position 0 while playing
    this.index = 0
    this.timer = null
  }

  get position() {
    if (!this.playing) return this.offset
    return Math.min(this.duration, Math.max(0, this.now() - this.anchor))
  }

  start(position = this.offset) {
    this.halt()
    const pos = Math.min(Math.max(0, position), this.duration)
    this.anchor = this.now() + START_DELAY - pos
    this.index = lowerBound(this.events, pos)
    this.playing = true
    // pads and strings that began before the seek point keep sounding
    if (pos > 0) {
      for (const e of heldAt(this.events, pos, this.sustains)) this.playNote(e, this.anchor + pos, e.time + e.dur - pos)
    }
    this.tick()
  }

  tick() {
    if (!this.playing) return
    const now = this.now()
    const until = now + this.lookahead() - this.anchor
    const batch = []
    this.index = due(this.events, this.index, until, batch)
    for (const e of batch) {
      const at = this.anchor + e.time
      // a note whose moment has already passed (the tab slept) is skipped, not played late
      if (at >= now - 0.05) this.playNote(e, Math.max(at, now))
    }
    if (now - this.anchor >= this.duration) {
      this.playing = false
      this.offset = this.duration
      this.onEnd?.()
      return
    }
    this.timer = this.setTimer(() => this.tick(), TICK_MS)
  }

  halt() {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
  }

  pause() {
    if (!this.playing) return
    this.offset = this.position
    this.playing = false
    this.halt()
  }

  stop() {
    this.playing = false
    this.offset = 0
    this.halt()
  }

  seek(position) {
    const pos = Math.min(Math.max(0, position), this.duration)
    if (this.playing) this.start(pos)
    else this.offset = pos
  }
}
