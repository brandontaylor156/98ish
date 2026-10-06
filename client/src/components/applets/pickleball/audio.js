// Pickleball 98's sounds, synthesized (no audio files). The ball: a paddle hit, a bounce,
// the net, the fence and paddle taps are modal syntheses fitted to real pickleball (pbsound.js
// has the research and the numbers), rendered into AudioBuffers (a few variations each,
// cached) and played with the distance's level and high cut, a pan and a little room. Then
// sneaker squeaks, a crowd (a murmur, applause, cheers and an "ooh"), little chimes, and the
// umpire's voice (the browser's own speech synthesis, when it has one). Follows the system
// sound setting and the taskbar volume (utils/settings.js).

import { getSettings, masterGain } from "../../../utils/settings"
import { getAudioContext, masterOutput } from "../../../utils/audio"
import { contactOf, distanceMix, hashKey, renderVoice, rng, roomFor, shotFamily, strengthOf, voiceFor } from "./pbsound.js"

const VARIANTS = 4 // renders kept per sound (each a little different)
const BANK_MAX = 160 // sounds kept (the oldest go first)

export const createAudio = () => {
  let ctx = null
  let out = null
  let noise = null
  let enabled = true
  let voice = true
  let crowdLevel = 0 // how big the crowd is (0 = nobody)
  let murmur = null
  let crowdTension = 0 // a long rally's swell (setTension)
  let room = null // { conv, wet }
  let roomVenue = "park"
  const bank = new Map() // voice key -> [AudioBuffer]
  const recent = [] // the last ball sounds played (tests and the dev hook)

  // on the page's shared AudioContext; this game's own gain (so closing it can cut its
  // crowd) into the taskbar volume
  const ready = () => {
    if (!enabled || !getSettings().systemSounds || masterGain() <= 0) return null
    if (!ctx) {
      ctx = getAudioContext()
      if (!ctx) return null
      out = ctx.createGain()
      out.connect(masterOutput(ctx))
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate)
      const d = noise.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
      makeRoom()
    }
    if (ctx.state !== "running") ctx.resume().catch(() => {})
    return ctx
  }

  // the court's surroundings: a short stereo impulse response (early reflections off the
  // court and the fence, then a quick tail; the stadium's stands ring longer)
  const makeRoom = () => {
    if (!ctx) return
    try {
      room?.conv.disconnect()
      room?.wet.disconnect()
    } catch {
      // never connected
    }
    const def = roomFor(roomVenue)
    const sr = ctx.sampleRate
    const n = Math.max(1, Math.round(sr * def.len))
    const ir = ctx.createBuffer(2, n, sr)
    const r = rng(hashKey(roomVenue))
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch)
      for (let k = 0; k < 6; k++) {
        const at = Math.round(sr * (0.004 + r() * 0.03 + k * 0.006))
        if (at < n) d[at] += (r() < 0.5 ? -1 : 1) * (0.5 - k * 0.06)
      }
      for (let i = 0; i < n; i++) d[i] += (r() * 2 - 1) * 0.25 * Math.exp((-6.9 * i) / n)
    }
    const conv = ctx.createConvolver()
    conv.normalize = true
    conv.buffer = ir
    const wet = ctx.createGain()
    wet.gain.value = def.wet
    conv.connect(wet).connect(out)
    room = { conv, wet }
  }

  // a cached render of a sound (`variant` picks one of a few)
  const bufferFor = (v, variant) => {
    let list = bank.get(v.key)
    if (!list) {
      list = []
      bank.set(v.key, list)
      if (bank.size > BANK_MAX) bank.delete(bank.keys().next().value)
    }
    if (!list[variant]) {
      const r = rng(hashKey(v.key) + variant * 7919)
      const samples = renderVoice(v.make(r), ctx.sampleRate, r)
      const b = ctx.createBuffer(1, samples.length, ctx.sampleRate)
      b.getChannelData(0).set(samples)
      list[variant] = b
    }
    return list[variant]
  }

  // play a ball sound now. where: { dist (m from the listener), side (-1 left .. 1 right) }
  const playVoice = (type, opts, where = {}) => {
    const c = ready()
    if (!c) return null
    const v = voiceFor(type, opts)
    const buf = bufferFor(v, Math.floor(Math.random() * VARIANTS))
    const mix = distanceMix(where)
    const src = c.createBufferSource()
    src.buffer = buf
    // (each one a hair different in pitch, as real ones are)
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.024
    const g = c.createGain()
    g.gain.value = mix.gain * (0.94 + Math.random() * 0.12)
    let node = src
    if (mix.cutoff < 14000) {
      const lp = c.createBiquadFilter()
      lp.type = "lowpass"
      lp.frequency.value = mix.cutoff
      lp.Q.value = 0.5
      node = node.connect(lp)
    }
    node = node.connect(g)
    if (c.createStereoPanner && mix.pan) {
      const p = c.createStereoPanner()
      p.pan.value = mix.pan
      node = node.connect(p)
    }
    node.connect(out)
    if (room) node.connect(room.conv)
    src.start(c.currentTime)
    recent.push({ type, key: v.key, t: c.currentTime, gain: +g.gain.value.toFixed(3), cutoff: mix.cutoff, pan: +mix.pan.toFixed(2) })
    if (recent.length > 40) recent.shift()
    return v.key
  }

  // shaped noise: a cheer, applause, the murmur
  const noiseBurst = ({ at = 0, dur, attack = 0.05, freq = 1200, q = 0.7, type = "bandpass", level = 0.2, claps = 0 }) => {
    const c = ready()
    if (!c) return
    const t = c.currentTime + at
    const src = c.createBufferSource()
    src.buffer = noise
    src.loop = true
    const f = c.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(level, t + attack)
    g.gain.setValueAtTime(level, t + Math.max(attack, dur * 0.4))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(out)
    src.start(t, Math.random())
    src.stop(t + dur + 0.05)
    // applause: lots of little claps on top
    for (let i = 0; i < claps; i++) {
      const ct = t + Math.random() * dur * 0.85
      const cs = c.createBufferSource()
      cs.buffer = noise
      const cf = c.createBiquadFilter()
      cf.type = "bandpass"
      cf.frequency.value = 1400 + Math.random() * 1800
      cf.Q.value = 1.5
      const cg = c.createGain()
      const fade = 1 - (ct - t) / dur
      cg.gain.setValueAtTime(level * 0.9 * fade, ct)
      cg.gain.exponentialRampToValueAtTime(0.0001, ct + 0.03)
      cs.connect(cf).connect(cg).connect(out)
      cs.start(ct, Math.random())
      cs.stop(ct + 0.04)
    }
  }

  const speak = (text, { rate = 1.05, pitch = 0.9 } = {}) => {
    if (!voice || !enabled || !getSettings().systemSounds || masterGain() <= 0) return
    const synth = typeof window !== "undefined" && window.speechSynthesis
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return
    try {
      synth.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.rate = rate
      u.pitch = pitch
      u.volume = Math.min(1, masterGain() * 0.9)
      const en = synth.getVoices().find((v) => /^en/i.test(v.lang))
      if (en) u.voice = en
      synth.speak(u)
    } catch {
      // no voice here: the call is on screen anyway
    }
  }

  const api = {
    unlock() {
      ready()
    },
    setEnabled(on) {
      enabled = on
      if (!on) api.setCrowd(0)
    },
    setVoice(on) {
      voice = on
    },
    // the court's surroundings (a venue id): how much room the ball sounds get
    setRoom(venue) {
      if (venue === roomVenue) return
      roomVenue = venue
      if (ctx) makeRoom()
    },
    // a paddle hit: the "hit" event ({ kind, paddle, speed, volley, grade }) and where it was
    // heard ({ dist, side, design: the hitter's paddle, from the Locker Room })
    hit(e = {}, where = {}) {
      return playVoice("hit", { s: strengthOf(e), family: shotFamily(e.kind, e.volley), contact: contactOf(e.grade), design: where.design }, where)
    },
    // (older callers: strength 0..1, a perfect hit)
    pock(strength = 0.5, perfect = false) {
      return playVoice("hit", { s: strength, family: "drive", contact: perfect ? "sweet" : "normal" })
    },
    bounce(strength = 0.5, where = {}) {
      return playVoice("bounce", { s: strength }, where)
    },
    // into the net, or off the tape (the cord)
    net(tape = false, where = {}, strength = 0.5) {
      return playVoice("net", { s: strength, tape: !!tape }, where)
    },
    // off the chain-link fence
    fence(strength = 0.5, where = {}) {
      return playVoice("fence", { s: strength }, where)
    },
    // partners' paddles touching between points
    paddleTap(where = {}) {
      return playVoice("tap", { design: where.design }, where)
    },
    // (tests) the last ball sounds, and how many renders are cached
    get recent() {
      return recent.slice()
    },
    get banked() {
      let n = 0
      for (const l of bank.values()) n += l.filter(Boolean).length
      return n
    },
    // a sneaker on a hard court
    squeak(strength = 0.5) {
      const c = ready()
      if (!c) return
      const t = c.currentTime
      const o = c.createOscillator()
      o.type = "sawtooth"
      const f0 = 1800 + Math.random() * 900
      o.frequency.setValueAtTime(f0, t)
      o.frequency.linearRampToValueAtTime(f0 * (1.15 + Math.random() * 0.2), t + 0.07)
      const bp = c.createBiquadFilter()
      bp.type = "bandpass"
      bp.frequency.value = f0
      bp.Q.value = 8
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.05 + strength * 0.06, t + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
      o.connect(bp).connect(g).connect(out)
      o.start(t)
      o.stop(t + 0.1)
    },
    // two soft notes: up for your point, down for theirs
    chime(good) {
      const c = ready()
      if (!c) return
      const t = c.currentTime + 0.01
      const notes = good ? [659.25, 987.77] : [523.25, 392]
      notes.forEach((f, i) => {
        const o = c.createOscillator()
        o.type = "triangle"
        o.frequency.value = f
        const g = c.createGain()
        const at = t + i * 0.11
        g.gain.setValueAtTime(0.0001, at)
        g.gain.exponentialRampToValueAtTime(0.14, at + 0.015)
        g.gain.exponentialRampToValueAtTime(0.001, at + 0.3)
        o.connect(g).connect(out)
        o.start(at)
        o.stop(at + 0.32)
      })
    },
    // the crowd: size 0..1 sets the murmur; cheer(level) after a point; ooh() for a near thing
    setCrowd(size) {
      crowdLevel = size
      const c = size > 0 ? ready() : ctx
      if (!c) return
      if (size > 0 && !murmur) {
        const src = c.createBufferSource()
        src.buffer = noise
        src.loop = true
        const f = c.createBiquadFilter()
        f.type = "bandpass"
        f.frequency.value = 480
        f.Q.value = 0.6
        const g = c.createGain()
        g.gain.value = 0
        src.connect(f).connect(g).connect(out)
        src.start()
        murmur = { src, g }
      }
      if (murmur) murmur.g.gain.setTargetAtTime(size * 0.035 * (1 + crowdTension * 1.6), c.currentTime, 0.4)
    },
    // a long rally: the murmur swells and lifts in pitch as it goes on (0..1; 0 when it ends)
    setTension(t) {
      crowdTension = Math.max(0, Math.min(1, t))
      if (!murmur || !ctx) return
      murmur.g.gain.setTargetAtTime(crowdLevel * 0.035 * (1 + crowdTension * 1.6), ctx.currentTime, crowdTension > 0 ? 0.6 : 0.25)
    },
    cheer(level = 0.6) {
      if (crowdLevel <= 0) return
      const l = level * crowdLevel
      noiseBurst({ dur: 1.4 + l * 1.4, attack: 0.08, freq: 900, q: 0.5, level: 0.06 + l * 0.14 })
      noiseBurst({ dur: 1.6 + l * 1.6, attack: 0.15, freq: 2200, q: 0.8, level: 0.03 + l * 0.07, claps: Math.round(20 + l * 60) })
    },
    applause(level = 0.4) {
      if (crowdLevel <= 0) return
      noiseBurst({ dur: 1.5, attack: 0.1, freq: 2500, q: 0.7, level: 0.02 * crowdLevel, claps: Math.round(25 * level * crowdLevel + 10) })
    },
    ooh() {
      const c = crowdLevel > 0 ? ready() : null
      if (!c) return
      // many voices sliding down: a few detuned saws through a vowel-ish filter
      const t = c.currentTime
      const f = c.createBiquadFilter()
      f.type = "bandpass"
      f.frequency.value = 520
      f.Q.value = 3
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.05 * crowdLevel, t + 0.12)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1)
      f.connect(g).connect(out)
      for (let i = 0; i < 6; i++) {
        const o = c.createOscillator()
        o.type = "sawtooth"
        const f0 = 190 + Math.random() * 120
        o.frequency.setValueAtTime(f0 * 1.25, t)
        o.frequency.exponentialRampToValueAtTime(f0, t + 0.9)
        o.connect(f)
        o.start(t)
        o.stop(t + 1.15)
      }
    },
    // the umpire: "4-2-1" is read as "four, two, one"
    call(text) {
      const spoken = String(text)
        .replace(/^(\d+)-(\d+)-(\d+)$/, "$1, $2, $3")
        .replace(/^(\d+)-(\d+)$/, "$1, $2")
        .replace(/!/g, "")
      speak(spoken)
    },
    get state() {
      return ctx?.state || "none"
    },
    dispose() {
      try {
        murmur?.src.stop()
      } catch {
        // already stopped
      }
      murmur = null
      try {
        window.speechSynthesis?.cancel()
      } catch {
        // no speech here
      }
      // the shared context stays open; this game's sounds stop here
      try {
        out?.disconnect()
      } catch {
        // never connected
      }
      ctx = null
      out = null
      room = null
      bank.clear()
    },
  }
  return api
}
