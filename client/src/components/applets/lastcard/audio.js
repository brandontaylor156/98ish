// Last Card's sounds, synthesized with Web Audio (no files): a papery flick for each card
// played, a softer one for each drawn, a riffle for the shuffle, and little jingles for
// skips, reverses, wilds, draw stacks, "Last Card!", getting caught, your turn and winning.
// Quiet when "Play system sounds" is off, when Options > Sound is off, or when muted.

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
      // half a second of white noise for card sounds
      noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate)
      const data = noise.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {})
    out.gain.value = 0.5 * gain
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
    o.stop(t + len + 0.02)
  }

  // a burst of filtered noise: the sound of a card
  const flick = ({ at = 0, len = 0.07, freq = 2600, q = 0.9, vol = 0.35 } = {}) => {
    const t = ctx.currentTime + at
    const src = ctx.createBufferSource()
    src.buffer = noise
    const f = ctx.createBiquadFilter()
    f.type = "bandpass"
    f.frequency.setValueAtTime(freq, t)
    f.frequency.exponentialRampToValueAtTime(freq * 0.55, t + len)
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    src.connect(f).connect(g).connect(out)
    src.start(t, Math.random() * 0.3)
    src.stop(t + len + 0.02)
  }

  const play = (fn) => (...args) => {
    try {
      if (ready()) fn(...args)
    } catch {
      // sound is a nicety
    }
  }

  return {
    setEnabled: (value) => (on = value),
    card: play((at = 0) => (flick({ at, len: 0.08, freq: 3000, vol: 0.32 }), flick({ at: at + 0.05, len: 0.05, freq: 1400, vol: 0.18 }))),
    draw: play((at = 0) => flick({ at, len: 0.06, freq: 1800, vol: 0.16 })),
    shuffle: play(() => {
      for (let i = 0; i < 14; i++) flick({ at: i * 0.035, len: 0.045, freq: 2200 + Math.random() * 1600, vol: 0.12 })
    }),
    deal: play((count = 7) => {
      for (let i = 0; i < count; i++) flick({ at: i * 0.07, len: 0.05, freq: 2400, vol: 0.12 })
    }),
    skip: play(() => (tone(midi(76), { len: 0.1, type: "square", vol: 0.07 }), tone(midi(64), { at: 0.1, len: 0.18, type: "square", vol: 0.07, to: midi(58) }))),
    reverse: play(() => (tone(300, { len: 0.22, type: "sine", vol: 0.14, to: 900 }), tone(900, { at: 0.2, len: 0.22, type: "sine", vol: 0.12, to: 300 }))),
    stack: play((n = 2) => {
      tone(110, { len: 0.25, type: "sine", vol: 0.32, to: 55 })
      for (let i = 0; i < Math.min(6, n); i++) tone(midi(60 + i * 2), { at: 0.06 + i * 0.05, len: 0.08, type: "square", vol: 0.05 })
    }),
    wild: play(() => [72, 76, 79, 83].forEach((m, i) => tone(midi(m), { at: i * 0.06, len: 0.22, type: "triangle", vol: 0.11 }))),
    call: play(() => [84, 88, 91].forEach((m, i) => tone(midi(m), { at: i * 0.08, len: 0.3, type: "sine", vol: 0.13 }))),
    caught: play(() => (tone(160, { len: 0.16, type: "sawtooth", vol: 0.1, to: 120 }), tone(150, { at: 0.14, len: 0.2, type: "sawtooth", vol: 0.09, to: 100 }))),
    swap: play(() => (flick({ len: 0.25, freq: 900, q: 0.5, vol: 0.2 }), tone(500, { len: 0.3, type: "sine", vol: 0.06, to: 1000 }))),
    turn: play(() => (tone(midi(81), { len: 0.1, type: "sine", vol: 0.1 }), tone(midi(88), { at: 0.08, len: 0.16, type: "sine", vol: 0.08 }))),
    tick: play(() => tone(1300, { len: 0.03, type: "square", vol: 0.045 })),
    pop: play(() => tone(midi(86), { len: 0.07, type: "sine", vol: 0.08, to: midi(93) })),
    bad: play(() => tone(200, { len: 0.12, type: "sawtooth", vol: 0.06, to: 150 })),
    win: play((delay = 0) => [72, 76, 79, 84, 79, 84, 88].forEach((m, i) => tone(midi(m), { at: delay + i * 0.1, len: i === 6 ? 0.5 : 0.14, type: "triangle", vol: 0.15 }))),
    lose: play((delay = 0) => [67, 63, 60, 55].forEach((m, i) => tone(midi(m), { at: delay + i * 0.16, len: 0.22, type: "triangle", vol: 0.11 }))),
  }
}
