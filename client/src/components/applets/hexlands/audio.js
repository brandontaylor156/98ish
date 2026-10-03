// Hexlands' sounds, synthesized with Web Audio (no files): rattling dice, a wooden knock for
// each piece built, a papery flick for cards coming in, a swish for a steal, a low drum for
// the Bandit, a chime for trades, a bell when it's your turn and a fanfare for the winner.
// Quiet when "Play system sounds" is off, when Options > Sound is off, or when muted.

import { getSettings, masterGain } from "../../../utils/settings"
import { createBus } from "../../../utils/audio"

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12)

// on the page's shared AudioContext, through the taskbar volume
const bus = createBus({ gain: 0.5, threshold: -14 })

export const createSounds = () => {
  let ctx = null
  let out = null
  let noise = null
  let on = true

  const ready = () => {
    if (!on || !getSettings().systemSounds || !masterGain()) return null
    const b = bus()
    if (!b) return null
    ;({ ctx, out } = b)
    if (!noise || noise.sampleRate !== ctx.sampleRate) {
      noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate)
      const data = noise.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    }
    return ctx
  }

  const tone = (freq, { at = 0, len = 0.12, type = "triangle", vol = 0.2, to, attack = 0.004 } = {}) => {
    const t = ctx.currentTime + at
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + len)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + len + 0.05)
  }

  const hiss = ({ at = 0, len = 0.06, vol = 0.25, freq = 2400, q = 1, type = "bandpass" } = {}) => {
    const t = ctx.currentTime + at
    const src = ctx.createBufferSource()
    src.buffer = noise
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    src.connect(f).connect(g).connect(out)
    src.start(t)
    src.stop(t + len + 0.02)
  }

  const play = {
    // dice tumbling in a cup, then landing
    roll: () => {
      for (let i = 0; i < 9; i++) hiss({ at: i * 0.055 + Math.random() * 0.02, len: 0.035, vol: 0.22, freq: 1800 + Math.random() * 1600, q: 3 })
      tone(180, { at: 0.55, len: 0.08, type: "square", vol: 0.08 })
      tone(150, { at: 0.62, len: 0.08, type: "square", vol: 0.07 })
    },
    build: () => {
      tone(220, { len: 0.09, type: "sine", vol: 0.3, to: 120 })
      hiss({ len: 0.05, vol: 0.18, freq: 900, q: 2 })
      tone(330, { at: 0.08, len: 0.08, type: "sine", vol: 0.18, to: 180 })
    },
    city: () => {
      play.build()
      ;[67, 71, 74].forEach((m, i) => tone(midi(m), { at: 0.12 + i * 0.07, len: 0.18, vol: 0.12 }))
    },
    card: () => hiss({ len: 0.07, vol: 0.2, freq: 3200, q: 0.8 }),
    gain: (n = 1) => {
      for (let i = 0; i < Math.min(n, 5); i++) hiss({ at: i * 0.07, len: 0.06, vol: 0.16, freq: 3000 + i * 200, q: 0.9 })
    },
    steal: () => {
      hiss({ len: 0.25, vol: 0.2, freq: 1200, q: 0.6, type: "highpass" })
      tone(midi(64), { at: 0.05, len: 0.12, vol: 0.1, to: midi(57) })
    },
    bandit: () => {
      tone(70, { len: 0.35, type: "sine", vol: 0.35, to: 45 })
      tone(midi(50), { at: 0.1, len: 0.3, type: "sawtooth", vol: 0.05, to: midi(46) })
    },
    trade: () => [72, 76, 79].forEach((m, i) => tone(midi(m), { at: i * 0.06, len: 0.2, vol: 0.12 })),
    offer: () => [76, 72].forEach((m, i) => tone(midi(m), { at: i * 0.09, len: 0.16, vol: 0.1 })),
    dev: () => [79, 84, 88, 91].forEach((m, i) => tone(midi(m), { at: i * 0.05, len: 0.18, vol: 0.08, type: "sine" })),
    turn: () => {
      tone(midi(81), { len: 0.5, type: "sine", vol: 0.14 })
      tone(midi(88), { at: 0.12, len: 0.6, type: "sine", vol: 0.1 })
    },
    tick: () => tone(midi(96), { len: 0.03, type: "square", vol: 0.04 }),
    error: () => tone(160, { len: 0.12, type: "square", vol: 0.06 }),
    award: () => [67, 72, 76, 79].forEach((m, i) => tone(midi(m), { at: i * 0.08, len: 0.22, vol: 0.12 })),
    win: () => {
      ;[60, 64, 67, 72, 67, 72, 76, 79].forEach((m, i) => tone(midi(m), { at: i * 0.11, len: 0.28, vol: 0.13 }))
      tone(midi(84), { at: 0.95, len: 0.9, vol: 0.12, type: "sine" })
    },
    lose: () => [67, 64, 60, 55].forEach((m, i) => tone(midi(m), { at: i * 0.16, len: 0.3, vol: 0.1 })),
  }

  return {
    setEnabled: (v) => (on = !!v),
    play: (name, ...args) => {
      if (!ready() || !play[name]) return
      try {
        play[name](...args)
      } catch {
        // a sound is never worth an error
      }
    },
  }
}
