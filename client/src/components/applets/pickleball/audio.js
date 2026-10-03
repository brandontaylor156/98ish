// Pickleball 98's sounds, synthesized (no audio files): the hollow "pock" of a paddle on a
// plastic ball, the softer tick of a bounce, the net, sneaker squeaks, a crowd (a murmur,
// applause, cheers and an "ooh"), little chimes, and the umpire's voice (the browser's own
// speech synthesis, when it has one). Follows the system sound setting and the taskbar
// volume (utils/settings.js).

import { getSettings, masterGain } from "../../../utils/settings"

export const createAudio = () => {
  let ctx = null
  let out = null
  let noise = null
  let enabled = true
  let voice = true
  let crowdLevel = 0 // how big the crowd is (0 = nobody)
  let murmur = null

  const ready = () => {
    if (!enabled || !getSettings().systemSounds) return null
    const gain = masterGain()
    if (gain <= 0) return null
    if (!ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) return null
      try {
        ctx = new AudioContext()
      } catch {
        return null
      }
      out = ctx.createGain()
      out.connect(ctx.destination)
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate)
      const d = noise.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {})
    out.gain.value = gain
    return ctx
  }

  // a burst of filtered noise plus a falling tone: the hollow plastic "pock"
  const knock = ({ freq, q, tone, toneEnd, decay, level }) => {
    const c = ready()
    if (!c) return
    const t = c.currentTime + 0.002
    const src = c.createBufferSource()
    src.buffer = noise
    const band = c.createBiquadFilter()
    band.type = "bandpass"
    band.frequency.value = freq
    band.Q.value = q
    const ng = c.createGain()
    ng.gain.setValueAtTime(level, t)
    ng.gain.exponentialRampToValueAtTime(0.001, t + decay * 0.6)
    src.connect(band).connect(ng).connect(out)
    src.start(t, Math.random() * 1.2)
    src.stop(t + decay)
    const osc = c.createOscillator()
    osc.type = "sine"
    osc.frequency.setValueAtTime(tone, t)
    osc.frequency.exponentialRampToValueAtTime(toneEnd, t + decay)
    const og = c.createGain()
    og.gain.setValueAtTime(level * 0.55, t)
    og.gain.exponentialRampToValueAtTime(0.001, t + decay)
    osc.connect(og).connect(out)
    osc.start(t)
    osc.stop(t + decay + 0.02)
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
    // a paddle hit; strength 0..1 (a dink is a soft tick, a drive a sharp crack); a perfect
    // hit rings a little brighter
    pock(strength = 0.5, perfect = false) {
      const s = Math.max(0.1, Math.min(1, strength))
      knock({ freq: 1150 + s * 500 + (perfect ? 250 : 0), q: perfect ? 9 : 6, tone: 1250 + s * 300 + (perfect ? 200 : 0), toneEnd: 700, decay: 0.07 + s * 0.03, level: 0.25 + s * 0.45 })
    },
    bounce(strength = 0.5) {
      const s = Math.max(0.05, Math.min(1, strength))
      knock({ freq: 700 + s * 300, q: 4, tone: 520, toneEnd: 300, decay: 0.05, level: 0.1 + s * 0.25 })
    },
    net() {
      noiseBurst({ dur: 0.22, attack: 0.005, freq: 900, type: "lowpass", level: 0.3 })
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
      if (murmur) murmur.g.gain.setTargetAtTime(size * 0.035, c.currentTime, 0.4)
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
      ctx?.close().catch(() => {})
      ctx = null
    },
  }
  return api
}
