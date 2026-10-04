// A tiny synthesizer for the quick games' sounds (no sound files): tones, noise bursts and
// sweeps on the page's shared AudioContext (utils/audio.js), through the taskbar volume and
// mute. Quiet when the game's own Sound option is off, when "Play system sounds" is off,
// or when muted.
//   const synth = createSynth({ gain: 0.5 })
//   synth.setEnabled(prefs.sound)
//   synth.play(({ tone, noise }) => tone(440, { len: 0.1 }))

import { getSettings, masterGain } from "./settings"
import { createBus } from "./audio"

export const midi = (m) => 440 * Math.pow(2, (m - 69) / 12)

export const createSynth = ({ gain = 0.5, threshold = -10 } = {}) => {
  const bus = createBus({ gain, threshold })
  let on = true
  let noiseBuf = null

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
    return { ctx, tone, noise }
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
    hold: (freq, { type = "triangle", vol = 0.22 } = {}) => {
      const b = ready()
      if (!b) return () => {}
      const { ctx, out } = b
      const t = ctx.currentTime
      const o = ctx.createOscillator()
      const o2 = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = type
      o2.type = "sine"
      o.frequency.value = freq
      o2.frequency.value = freq * 2
      const g2 = ctx.createGain()
      g2.gain.value = 0.25
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012)
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
