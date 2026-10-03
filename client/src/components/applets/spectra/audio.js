// SPECTRA's soundtrack, synthesized live (no audio files). A beat-synced groove whose tempo,
// key and density follow the run, plus sound effects; every shard plays the next note of a
// pentatonic melody, so a good run composes its own tune. Safe to call before the audio is
// unlocked by a tap/click: until then everything is silently skipped.

import { closeAudioContext, createAudioContext, holdAudioContext, masterOutput, releaseAudioContext } from "../../../utils/audio"

const MINOR_PENTATONIC = [0, 3, 5, 7, 10]
const ZONE_ROOTS = [57, 60, 53, 55, 62, 50] // A, C, F, G, D, low D (MIDI)
const LOOKAHEAD_S = 0.12
const TICK_MS = 25

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12)

export const createAudio = () => {
  let ctx = null
  let master = null
  let musicBus = null
  let fxBus = null
  let noise = null
  let timer = null
  let muted = false
  let zone = 0
  let bpm = 100
  let intensity = 0 // 0..1 (multiplier / overdrive): more layers
  let nextStep = 0 // 16th-note step counter
  let nextTime = 0
  let beatTimes = [] // scheduled kick times (some still in the future)
  let melodyIndex = 0
  let running = false

  const scale = (degree, octave = 0) => {
    const root = ZONE_ROOTS[zone % ZONE_ROOTS.length]
    const i = ((degree % 5) + 5) % 5
    return root + MINOR_PENTATONIC[i] + 12 * (octave + Math.floor(degree / 5))
  }

  const init = () => {
    if (ctx) return true
    // its own context, since pausing the game suspends it; out through the taskbar volume
    ctx = createAudioContext()
    if (!ctx) return false
    master = ctx.createGain()
    master.gain.value = muted ? 0 : 0.8
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -14
    compressor.ratio.value = 4
    master.connect(compressor).connect(masterOutput(ctx))
    musicBus = ctx.createGain()
    musicBus.gain.value = 0.55
    musicBus.connect(master)
    fxBus = ctx.createGain()
    fxBus.gain.value = 0.7
    fxBus.connect(master)
    // one second of white noise, reused by hats and impacts
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    return true
  }

  // ---- instruments ----

  const env = (gainNode, t, attack, peak, decay) => {
    gainNode.gain.setValueAtTime(0.0001, t)
    gainNode.gain.exponentialRampToValueAtTime(peak, t + attack)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  }

  const osc = (type, freq, t, dur, peak, dest, { attack = 0.005, to, filter } = {}) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur)
    let node = o
    if (filter) {
      const f = ctx.createBiquadFilter()
      f.type = "lowpass"
      f.frequency.value = filter
      f.Q.value = 6
      o.connect(f)
      node = f
    }
    node.connect(g).connect(dest)
    env(g, t, attack, peak, dur)
    o.start(t)
    o.stop(t + attack + dur + 0.05)
  }

  const noiseHit = (t, dur, peak, dest, { type = "highpass", freq = 7000 } = {}) => {
    const src = ctx.createBufferSource()
    src.buffer = noise
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    const g = ctx.createGain()
    src.connect(f).connect(g).connect(dest)
    env(g, t, 0.002, peak, dur)
    src.start(t, Math.random() * 0.5)
    src.stop(t + dur + 0.05)
  }

  const kick = (t) => osc("sine", 140, t, 0.32, 0.9, musicBus, { to: 42 })
  const hat = (t, open) => noiseHit(t, open ? 0.12 : 0.035, open ? 0.12 : 0.08, musicBus)
  const bass = (t, note) => osc("sawtooth", midiToHz(note), t, 0.22, 0.22, musicBus, { filter: 420 + intensity * 900 })
  const pad = (t, note, dur) => {
    for (const detune of [-7, 7]) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      const f = ctx.createBiquadFilter()
      o.type = "sawtooth"
      o.frequency.value = midiToHz(note)
      o.detune.value = detune
      f.type = "lowpass"
      f.frequency.value = 700 + intensity * 1600
      o.connect(f).connect(g).connect(musicBus)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(0.05, t + 0.4)
      g.gain.linearRampToValueAtTime(0.0001, t + dur)
      o.start(t)
      o.stop(t + dur + 0.05)
    }
  }
  const arp = (t, note) => osc("square", midiToHz(note), t, 0.12, 0.05 + intensity * 0.05, musicBus, { filter: 2400 })

  // ---- the groove: one 16th note at a time ----

  const BASS_LINE = [0, 0, 2, 0, 3, 0, 2, 4]
  const playStep = (stepIndex, t) => {
    const beat16 = stepIndex % 16
    if (beat16 % 4 === 0) {
      kick(t)
      beatTimes.push(t)
      if (beatTimes.length > 8) beatTimes.shift()
    }
    if (beat16 % 2 === 0) hat(t, beat16 % 8 === 6)
    if (beat16 % 4 === 2) bass(t, scale(BASS_LINE[(stepIndex / 4) % 8 | 0], -2))
    if (beat16 === 0 && (stepIndex / 16) % 2 === 0) pad(t, scale(0, -1), (60 / bpm) * 8)
    // arpeggios join in as the multiplier grows
    if (intensity > 0.25 && beat16 % 2 === 1) arp(t, scale((stepIndex * 3) % 7, intensity > 0.6 ? 1 : 0))
    if (intensity > 0.75 && beat16 % 4 === 3) hat(t, true)
  }

  const schedule = () => {
    if (!ctx || ctx.state !== "running") return
    const secondsPer16th = 60 / bpm / 4
    if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05
    while (nextTime < ctx.currentTime + LOOKAHEAD_S) {
      playStep(nextStep, nextTime)
      nextStep++
      nextTime += secondsPer16th
    }
  }

  const startTimer = () => {
    if (!timer) timer = setInterval(schedule, TICK_MS)
  }
  const stopTimer = () => {
    clearInterval(timer)
    timer = null
  }

  // ---- public ----

  const now = () => ctx?.currentTime ?? 0
  const ready = () => ctx && ctx.state === "running"

  return {
    // Call from a user gesture (tap/click/key): browsers only allow audio after one
    unlock() {
      if (!init()) return
      if (ctx.state !== "running") releaseAudioContext(ctx)
    },
    start() {
      if (!ctx) return
      running = true
      melodyIndex = 0
      nextStep = 0
      beatTimes = []
      nextTime = ctx.currentTime + 0.05
      startTimer()
    },
    stop() {
      running = false
      stopTimer()
    },
    pause() {
      stopTimer()
      // held: a tap elsewhere on the page mustn't wake it
      holdAudioContext(ctx)
    },
    resume() {
      if (!ctx) return
      releaseAudioContext(ctx)
      if (running) {
        nextTime = 0
        startTimer()
      }
    },
    setMuted(value) {
      muted = value
      if (master) master.gain.setTargetAtTime(value ? 0 : 0.8, ctx.currentTime, 0.05)
    },
    setDifficulty(d) {
      bpm = 100 + 40 * d
    },
    setIntensity(value) {
      intensity = Math.max(0, Math.min(1, value))
    },
    setZone(value) {
      zone = value
      melodyIndex = 0
      if (ready()) {
        // rising sweep into the new zone
        const t = now()
        osc("sawtooth", 110, t, 1.4, 0.12, fxBus, { to: 1760, filter: 3000, attack: 0.3 })
        noiseHit(t, 1.6, 0.08, fxBus, { type: "bandpass", freq: 2000 })
      }
    },
    // the run's melody: each shard climbs the scale, wrapping every two octaves
    shard(combo) {
      if (!ready()) return
      const t = now()
      const degree = melodyIndex++ % 10
      const note = scale(degree, 1)
      osc("triangle", midiToHz(note), t, 0.28, 0.32, fxBus)
      osc("sine", midiToHz(note + 12), t, 0.18, 0.08 + Math.min(0.12, combo * 0.004), fxBus)
    },
    graze() {
      if (!ready()) return
      osc("sine", 1800, now(), 0.18, 0.18, fxBus, { to: 3600 })
    },
    miss() {
      if (!ready()) return
      osc("triangle", 330, now(), 0.2, 0.12, fxBus, { to: 160 })
    },
    multiplier(up) {
      if (!ready() || !up) return
      const t = now()
      ;[0, 2, 4].forEach((d, i) => osc("square", midiToHz(scale(d, 1)), t + i * 0.06, 0.12, 0.08, fxBus, { filter: 3000 }))
    },
    smash() {
      if (!ready()) return
      const t = now()
      noiseHit(t, 0.35, 0.5, fxBus, { type: "lowpass", freq: 1800 })
      osc("square", 220, t, 0.3, 0.15, fxBus, { to: 55, filter: 1200 })
    },
    overdrive() {
      if (!ready()) return
      const t = now()
      osc("sawtooth", 80, t, 1.1, 0.25, fxBus, { to: 640, filter: 2200, attack: 0.05 })
      noiseHit(t, 0.9, 0.18, fxBus, { type: "bandpass", freq: 1200 })
    },
    crash() {
      if (!ready()) return
      const t = now()
      noiseHit(t, 1.4, 0.8, fxBus, { type: "lowpass", freq: 900 })
      osc("sine", 160, t, 1.2, 0.9, fxBus, { to: 30 })
      osc("sawtooth", 440, t, 0.9, 0.15, fxBus, { to: 55, filter: 1500 })
    },
    // 1 on each kick, fading to 0: drives the visuals' pulse
    beatPulse() {
      if (!ready() || !running) return null
      // the latest kick that has actually sounded (beats are scheduled slightly ahead)
      const t = ctx.currentTime
      let last = -10
      for (const b of beatTimes) if (b <= t && b > last) last = b
      return Math.exp(-(t - last) * 7)
    },
    // "none" before the first tap/click, then the AudioContext's state
    get state() {
      return ctx ? ctx.state : "none"
    },
    dispose() {
      stopTimer()
      running = false
      closeAudioContext(ctx)
      ctx = null
    },
  }
}
