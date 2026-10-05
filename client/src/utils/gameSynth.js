// A tiny synthesizer for the quick games' sounds (no sound files): tones, noise bursts and
// sweeps on the page's shared AudioContext (utils/audio.js), through the taskbar volume and
// mute. Quiet when the game's own Sound option is off, when "Play system sounds" is off,
// or when muted.
//   const synth = createSynth({ gain: 0.5 })
//   synth.setEnabled(prefs.sound)
//   synth.play(({ tone, noise }) => tone(440, { len: 0.1 }))
// Chip voices for the retro look (utils/retro/chip.js has the pure parts): pulse(freq, { duty })
// 12.5/25/50% pulse waves, tri(), chipNoise({ pitch, short }) from a 15-bit shift register,
// jingle([[midi, beats]...]) and arp([midi...]); volume and pitch change once a frame (60 Hz).

import { getSettings, masterGain } from "./settings"
import { createBus } from "./audio"
import { FRAME, lfsrNoise, midi, pulseTerms, steppedEnvelope, steppedSweep } from "./retro/chip.js"

export { midi }

export const createSynth = ({ gain = 0.5, threshold = -10 } = {}) => {
  const bus = createBus({ gain, threshold })
  let on = true
  let noiseBuf = null
  const waves = new Map() // duty -> PeriodicWave, per context
  const lfsr = new Map() // short? -> AudioBuffer
  const pulseWave = (ctx, duty) => {
    const key = `${duty}`
    let w = waves.get(key)
    if (!w || w.ctx !== ctx) {
      const { real, imag } = pulseTerms(duty)
      w = { ctx, wave: ctx.createPeriodicWave(real, imag) }
      waves.set(key, w)
    }
    return w.wave
  }
  const lfsrBuffer = (ctx, short) => {
    const key = short ? "s" : "l"
    let e = lfsr.get(key)
    if (!e || e.ctx !== ctx) {
      const n = ctx.sampleRate
      const buf = ctx.createBuffer(1, n, ctx.sampleRate)
      buf.getChannelData(0).set(lfsrNoise(n, { rate: ctx.sampleRate, clock: 22050, short }))
      e = { ctx, buf }
      lfsr.set(key, e)
    }
    return e.buf
  }

  const ready = () => {
    if (!on || !getSettings().systemSounds || !masterGain()) return null
    return bus()
  }

  const kit = (ctx, out) => {
    const tone = (freq, { at = 0, len = 0.12, type = "triangle", vol = 0.25, to, attack = 0.004, pan = 0 } = {}) => {
      const t = ctx.currentTime + at
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = type
      o.frequency.setValueAtTime(freq, t)
      if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + len)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(vol, t + attack)
      g.gain.exponentialRampToValueAtTime(0.0001, t + len)
      let last = o.connect(g)
      if (pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner()
        p.pan.value = pan
        last = last.connect(p)
      }
      last.connect(out)
      o.start(t)
      o.stop(t + len + 0.03)
    }
    const noise = ({ at = 0, len = 0.2, vol = 0.3, freq = 1200, to, q = 0.8, type = "lowpass" } = {}) => {
      if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
        const d = noiseBuf.getChannelData(0)
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
      }
      const t = ctx.currentTime + at
      const src = ctx.createBufferSource()
      src.buffer = noiseBuf
      const f = ctx.createBiquadFilter()
      f.type = type
      f.Q.value = q
      f.frequency.setValueAtTime(freq, t)
      if (to) f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + len)
      const g = ctx.createGain()
      g.gain.setValueAtTime(vol, t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + len)
      src.connect(f).connect(g).connect(out)
      src.start(t)
      src.stop(t + len + 0.03)
    }
    // ---- chip voices: stepped once a frame ----
    const applyEnv = (param, t, len, vol, opts) => {
      param.setValueAtTime(0, t)
      for (const { at, v } of steppedEnvelope(len, vol, opts)) param.setValueAtTime(Math.max(0, v), t + at)
      param.setValueAtTime(0, t + len + FRAME)
    }
    const voice = (osc, t, len, vol, { to, freq, curve, hold, pan = 0, vib = 0 }) => {
      if (to) for (const { at, f } of steppedSweep(len, freq, to)) osc.frequency.setValueAtTime(f, t + at)
      else osc.frequency.setValueAtTime(freq, t)
      if (vib) {
        // a frame-stepped vibrato
        for (let k = 0; k * FRAME < len; k++) osc.frequency.setValueAtTime(freq * (1 + vib * (k % 4 < 2 ? 1 : -1)), t + k * FRAME)
      }
      const g = ctx.createGain()
      applyEnv(g.gain, t, len, vol, { curve, hold })
      let last = osc.connect(g)
      if (pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner()
        p.pan.value = pan
        last = last.connect(p)
      }
      last.connect(out)
      osc.start(t)
      osc.stop(t + len + 0.05)
    }
    // a pulse wave: duty 0.125 (thin), 0.25 (classic), 0.5 (square)
    const pulse = (freq, { at = 0, len = 0.12, duty = 0.25, vol = 0.15, to, curve = 1, hold = 0, pan = 0, vib = 0 } = {}) => {
      const t = ctx.currentTime + at
      const o = ctx.createOscillator()
      o.setPeriodicWave(pulseWave(ctx, duty))
      voice(o, t, len, vol, { to, freq, curve, hold, pan, vib })
    }
    const tri = (freq, { at = 0, len = 0.15, vol = 0.22, to, curve = 0.6, hold = 0, pan = 0 } = {}) => {
      const t = ctx.currentTime + at
      const o = ctx.createOscillator()
      o.type = "triangle"
      voice(o, t, len, vol, { to, freq, curve, hold, pan })
    }
    // the noise channel: `pitch` 0 (low rumble) .. 1 (hiss), sweeping to `toPitch`
    const chipNoise = ({ at = 0, len = 0.2, vol = 0.25, pitch = 0.6, toPitch, short = false, curve = 1, hold = 0 } = {}) => {
      const t = ctx.currentTime + at
      const src = ctx.createBufferSource()
      src.buffer = lfsrBuffer(ctx, short)
      src.loop = true
      const rate = (p) => Math.max(0.02, Math.pow(2, (p - 1) * 6))
      if (toPitch != null) {
        const n = Math.max(1, Math.round(len / FRAME))
        for (let k = 0; k <= n; k++) src.playbackRate.setValueAtTime(rate(pitch + ((toPitch - pitch) * k) / n), t + k * FRAME)
      } else src.playbackRate.setValueAtTime(rate(pitch), t)
      const g = ctx.createGain()
      applyEnv(g.gain, t, len, vol, { curve, hold })
      src.connect(g).connect(out)
      src.start(t)
      src.stop(t + len + 0.05)
    }
    // notes as [midi (0 = rest), beats] at `tempo` frames per beat: a jingle on one voice
    const jingle = (notes, { at = 0, frames = 6, voice: v = "pulse", duty = 0.25, vol = 0.12, gap = 0.85, transpose = 0 } = {}) => {
      let t = at
      for (const [m, beats = 1] of notes) {
        const len = beats * frames * FRAME
        if (m) {
          const f = midi(m + transpose)
          if (v === "tri") tri(f, { at: t, len: len * gap, vol, curve: 0.4 })
          else pulse(f, { at: t, len: len * gap, duty, vol, curve: 0.5 })
        }
        t += len
      }
      return t - at
    }
    // a fast arpeggio (one frame per note): the chip way to play a chord
    const arp = (notes, { at = 0, len = 0.3, duty = 0.125, vol = 0.1, step = 1 } = {}) => {
      const n = Math.max(1, Math.round(len / FRAME))
      const t = ctx.currentTime + at
      const o = ctx.createOscillator()
      o.setPeriodicWave(pulseWave(ctx, duty))
      for (let k = 0; k < n; k++) o.frequency.setValueAtTime(midi(notes[Math.floor(k / step) % notes.length]), t + k * FRAME)
      const g = ctx.createGain()
      applyEnv(g.gain, t, len, vol, { curve: 0.7 })
      o.connect(g).connect(out)
      o.start(t)
      o.stop(t + len + 0.05)
    }
    return { ctx, tone, noise, pulse, tri, chipNoise, jingle, arp }
  }

  return {
    setEnabled: (v) => (on = !!v),
    get enabled() {
      return on
    },
    // fn({ ctx, tone, noise }) runs only when sound can play
    play: (fn) => {
      const b = ready()
      if (!b) return false
      fn(kit(b.ctx, b.out))
      return true
    },
    // a held tone (Echo Pads while a pad is pressed): returns stop()
    // duty: a chip pulse wave (0.125 / 0.25 / 0.5) instead of `type`, with a triangle an
    // octave down underneath (the chip's bass voice)
    hold: (freq, { type = "triangle", vol = 0.22, duty = 0 } = {}) => {
      const b = ready()
      if (!b) return () => {}
      const { ctx, out } = b
      const t = ctx.currentTime
      const o = ctx.createOscillator()
      const o2 = ctx.createOscillator()
      const g = ctx.createGain()
      if (duty) {
        o.setPeriodicWave(pulseWave(ctx, duty))
        o2.type = "triangle"
      } else {
        o.type = type
        o2.type = "sine"
      }
      o.frequency.value = freq
      o2.frequency.value = duty ? freq / 2 : freq * 2
      const g2 = ctx.createGain()
      g2.gain.value = duty ? 0.6 : 0.25
      // a chip voice switches on at once (a frame), not with a smooth fade
      g.gain.setValueAtTime(duty ? vol : 0.0001, t)
      if (!duty) g.gain.exponentialRampToValueAtTime(vol, t + 0.012)
      o.connect(g)
      o2.connect(g2).connect(g)
      g.connect(out)
      o.start(t)
      o2.start(t)
      let stopped = false
      return () => {
        if (stopped) return
        stopped = true
        const e = ctx.currentTime
        g.gain.cancelScheduledValues(e)
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), e)
        g.gain.exponentialRampToValueAtTime(0.0001, e + 0.08)
        o.stop(e + 0.1)
        o2.stop(e + 0.1)
      }
    },
  }
}
