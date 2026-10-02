import { createSynth, INSTRUMENTS } from "./synth"
import { compile, Scheduler, LOOKAHEAD, LOOKAHEAD_HIDDEN } from "./sequencer"
import { getContext, releaseContext } from "./audio"

export { unlockAudio } from "./audio"

// The Media Player's audio: one AudioContext for the page, shared by every player window
// (players acquire it and the last one to close releases it), a synth and a scheduler.

let users = 0

// Only one player plays at a time: starting one pauses the rest
const players = new Set()

export const createEngine = ({ onEnd, onState } = {}) => {
  const ctx = getContext()
  if (!ctx) return null
  users++
  const synth = createSynth(ctx)
  let song = null
  let compiled = null
  let scheduler = null
  let volume = 1
  let muted = false
  let destroyed = false
  const trackInstruments = []

  const playNote = (e, at, durOverride) => {
    synth.play(trackInstruments[e.track], e.track, at, durOverride ?? e.dur, e.midi, e.vel)
  }

  const engine = {
    ctx,
    analyser: synth.analyser,

    get song() {
      return song
    },
    get duration() {
      return compiled ? compiled.duration : 0
    },
    get position() {
      return scheduler ? scheduler.position : 0
    },
    get playing() {
      return !!scheduler?.playing
    },
    get suspended() {
      return ctx.state !== "running"
    },

    load(next) {
      engine.stop()
      synth.reset()
      song = next
      compiled = compile(next)
      trackInstruments.length = 0
      for (const t of next.tracks) {
        synth.addTrack(t)
        trackInstruments.push(t.instrument)
      }
      synth.setTempo(next.bpm)
      scheduler = new Scheduler({
        events: compiled.events,
        duration: compiled.duration,
        now: () => ctx.currentTime,
        playNote,
        sustains: (track) => !!INSTRUMENTS[trackInstruments[track]]?.sustain,
        lookahead: () => (typeof document !== "undefined" && document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD),
        onEnd: () => {
          synth.hush(true)
          onState?.()
          onEnd?.()
        },
      })
    },

    play() {
      if (!scheduler || destroyed) return
      for (const p of players) if (p !== engine) p.pause()
      if (ctx.state !== "running") ctx.resume().then(() => onState?.()).catch(() => {})
      if (scheduler.position >= compiled.duration - 0.05) scheduler.seek(0)
      synth.open()
      scheduler.start()
      onState?.()
    },

    pause() {
      if (!scheduler?.playing) return
      scheduler.pause()
      synth.hush(true)
      onState?.()
    },

    stop() {
      if (!scheduler) return
      scheduler.stop()
      synth.hush(true)
      onState?.()
    },

    seek(seconds) {
      if (!scheduler) return
      if (scheduler.playing) synth.hush()
      scheduler.seek(seconds)
      onState?.()
    },

    setVolume(v) {
      volume = v
      synth.setVolume(muted ? 0 : v)
    },

    setMuted(m) {
      muted = m
      synth.setVolume(m ? 0 : volume)
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      scheduler?.stop()
      synth.destroy()
      players.delete(engine)
      users--
      if (users <= 0) {
        users = 0
        releaseContext(ctx)
      }
    },
  }
  players.add(engine)
  return engine
}

// Render part of a song offline (for tests): `seconds` from `start`, optionally only one
// track (its index). Resolves to an AudioBuffer.
export const renderOffline = async (song, { start = 0, seconds = 6, solo = null, sampleRate = 44100 } = {}) => {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate)
  const synth = createSynth(ctx, { bpm: song.bpm })
  for (const t of song.tracks) synth.addTrack(t)
  const { events } = compile(song)
  for (const e of events) {
    if (e.time >= start + seconds) break
    if (e.time < start || (solo !== null && e.track !== solo)) continue
    synth.play(song.tracks[e.track].instrument, e.track, e.time - start + 0.01, e.dur, e.midi, e.vel)
  }
  return ctx.startRendering()
}
