// Monster Duel's sounds, synthesized with Web Audio (no files): whooshes for summons, a
// thud for set cards, a magic chime for activations, swishes and impacts for battle, glass
// for destruction, a ticking counter for Life Points, and fanfares. Quiet when "Play system
// sounds" is off, when Options > Sound is off, or when muted; follows the taskbar volume.

import { getSettings, masterGain } from "../../../utils/settings"

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12)

export const createSounds = () => {
  let ctx = null
  let out = null
  let noise = null
  let on = true

  const ready = () => {
    if (!on || !getSettings().systemSounds) return null
    const gain = masterGain()
    if (!gain) return null
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)()
      } catch {
        return null
      }
      out = ctx.createGain()
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      out.connect(comp).connect(ctx.destination)
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const data = noise.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {})
    out.gain.value = 0.42 * gain
    return ctx
  }

  const tone = (freq, { at = 0, len = 0.12, type = "triangle", vol = 0.2, to, attack = 0.005 } = {}) => {
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
    o.stop(t + len + 0.02)
  }

  // filtered noise: swishes, impacts, shattering glass
  const hiss = ({ at = 0, len = 0.25, vol = 0.2, type = "bandpass", freq = 1200, to, q = 1 } = {}) => {
    const t = ctx.currentTime + at
    const src = ctx.createBufferSource()
    src.buffer = noise
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.setValueAtTime(freq, t)
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + len)
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    src.connect(f).connect(g).connect(out)
    src.start(t, Math.random() * 0.5)
    src.stop(t + len + 0.05)
  }

  const play = (fn) => (...args) => ready() && fn(...args)

  return {
    setEnabled: (value) => (on = value),
    unlock: () => ready(),
    click: play(() => tone(1500, { len: 0.03, type: "square", vol: 0.04 })),
    draw: play(() => hiss({ len: 0.09, vol: 0.12, type: "highpass", freq: 3000 })),
    set: play(() => (tone(110, { len: 0.12, type: "sine", vol: 0.3, to: 60 }), hiss({ len: 0.06, vol: 0.08, type: "lowpass", freq: 900 }))),
    summon: play(() => {
      hiss({ len: 0.35, vol: 0.14, freq: 400, to: 3000, q: 2 })
      ;[60, 67, 72].forEach((m, i) => tone(midi(m), { at: 0.12 + i * 0.05, len: 0.3, type: "triangle", vol: 0.1 }))
    }),
    tribute: play(() => tone(220, { len: 0.4, type: "sawtooth", vol: 0.05, to: 80 })),
    activate: play((kind) => {
      const base = kind === "trap" ? 63 : kind === "monster" ? 67 : 72
      ;[0, 4, 7, 12, 16].forEach((d, i) => tone(midi(base + d), { at: i * 0.045, len: 0.35, type: "sine", vol: 0.09 }))
      hiss({ len: 0.4, vol: 0.05, type: "highpass", freq: 5000 })
    }),
    flip: play(() => (hiss({ len: 0.12, vol: 0.1, freq: 2000, to: 600 }), tone(midi(76), { at: 0.08, len: 0.18, vol: 0.08 }))),
    position: play(() => hiss({ len: 0.1, vol: 0.08, freq: 1500, to: 900 })),
    attack: play(() => hiss({ len: 0.3, vol: 0.22, freq: 600, to: 4000, q: 3 })),
    hit: play((big) => {
      tone(big ? 70 : 90, { len: 0.35, type: "sine", vol: 0.45, to: 35 })
      hiss({ len: 0.22, vol: 0.28, type: "lowpass", freq: 1800, to: 200 })
    }),
    destroy: play(() => {
      hiss({ len: 0.5, vol: 0.22, type: "highpass", freq: 2500 })
      for (let i = 0; i < 6; i++) tone(midi(88 + Math.floor(Math.random() * 12)), { at: 0.03 + i * 0.04, len: 0.12, type: "sine", vol: 0.05 })
    }),
    damage: play((amount) => {
      const ticks = Math.min(14, 4 + Math.floor(amount / 300))
      for (let i = 0; i < ticks; i++) tone(1400 - i * 30, { at: i * 0.04, len: 0.025, type: "square", vol: 0.04 })
    }),
    heal: play(() => [72, 76, 79, 84].forEach((m, i) => tone(midi(m), { at: i * 0.06, len: 0.25, type: "sine", vol: 0.08 }))),
    phase: play(() => tone(midi(84), { len: 0.06, type: "square", vol: 0.04 })),
    turn: play((mine) => (mine ? [67, 74, 79] : [62, 58]).forEach((m, i) => tone(midi(m), { at: i * 0.1, len: 0.2, type: "triangle", vol: 0.1 }))),
    negate: play(() => (tone(160, { len: 0.25, type: "sawtooth", vol: 0.1, to: 90 }), tone(150, { at: 0.12, len: 0.25, type: "sawtooth", vol: 0.08, to: 80 }))),
    coin: play(() => [88, 95].forEach((m, i) => tone(midi(m), { at: i * 0.08, len: 0.3, type: "sine", vol: 0.08 }))),
    bad: play(() => tone(180, { len: 0.12, type: "sawtooth", vol: 0.06, to: 130 })),
    win: play(() => [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => tone(midi(m), { at: i * 0.09, len: i === 6 ? 0.7 : 0.16, type: "triangle", vol: 0.14 }))),
    lose: play(() => [67, 63, 60, 55, 51].forEach((m, i) => tone(midi(m), { at: i * 0.18, len: 0.3, type: "triangle", vol: 0.11 }))),
    rip: play(() => hiss({ len: 0.45, vol: 0.25, freq: 900, to: 5000, q: 0.8 })),
    reveal: play((rarity) => {
      const steps = rarity === "UR" ? [72, 76, 79, 84, 88, 91] : rarity === "SR" ? [72, 76, 79, 84] : rarity === "R" ? [72, 79] : [72]
      steps.forEach((m, i) => tone(midi(m), { at: i * 0.06, len: 0.3, type: "sine", vol: 0.09 }))
      if (rarity === "UR") hiss({ at: 0.1, len: 0.8, vol: 0.06, type: "highpass", freq: 6000 })
    }),
    ping: play(() => tone(midi(88), { len: 0.12, type: "sine", vol: 0.07 })),
  }
}
