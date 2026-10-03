// The Quiz Show's sounds, synthesized with Web Audio (no files): button taps, a lock-in
// blip, a drum-roll reveal, a sparkly chime for a match, a soft "aww" for a miss, a
// fanfare at the end, a card flip and a ticking clock. Quiet when "Play system sounds" is
// off, when the game's sound is off, or when muted; follows the taskbar volume.

import { getSettings, masterGain } from "../../../utils/settings"
import { createBus } from "../../../utils/audio"

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12)

// on the page's shared AudioContext, through the taskbar volume
const bus = createBus({ gain: 0.45 })

export const createSounds = () => {
  let ctx = null
  let out = null
  let on = true

  const ready = () => {
    if (!on || !getSettings().systemSounds || !masterGain()) return null
    const b = bus()
    if (!b) return null
    ;({ ctx, out } = b)
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

  // a soft burst of noise (drum roll, card swish)
  const noise = ({ at = 0, len = 0.08, vol = 0.12, freq = 1800 } = {}) => {
    const t = ctx.currentTime + at
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate)
    const d = buffer.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const src = ctx.createBufferSource()
    const filter = ctx.createBiquadFilter()
    const g = ctx.createGain()
    filter.type = "bandpass"
    filter.frequency.value = freq
    g.gain.value = vol
    src.buffer = buffer
    src.connect(filter).connect(g).connect(out)
    src.start(t)
  }

  const play = (fn) => (...args) => ready() && fn(...args)

  return {
    setEnabled: (value) => (on = value),
    tap: play(() => tone(880, { len: 0.05, type: "sine", vol: 0.08 })),
    lock: play(() => (tone(523, { len: 0.08, type: "square", vol: 0.06 }), tone(784, { at: 0.06, len: 0.1, type: "square", vol: 0.06 }))),
    drumroll: play(() => {
      for (let i = 0; i < 10; i++) noise({ at: i * 0.045, len: 0.05, vol: 0.12 + i * 0.016, freq: 900 })
    }),
    match: play(() => [72, 76, 79, 84, 88].forEach((m, i) => tone(midi(m), { at: i * 0.07, len: 0.35, type: "sine", vol: 0.16 }))),
    miss: play(() => (tone(midi(67), { len: 0.22, type: "triangle", vol: 0.14, to: midi(64) }), tone(midi(64), { at: 0.2, len: 0.35, type: "triangle", vol: 0.12, to: midi(60) }))),
    right: play(() => (tone(midi(76), { len: 0.12, type: "square", vol: 0.07 }), tone(midi(83), { at: 0.1, len: 0.22, type: "square", vol: 0.07 }))),
    wrong: play(() => tone(150, { len: 0.28, type: "sawtooth", vol: 0.07, to: 110 })),
    fanfare: play(() => {
      const notes = [[67, 0], [72, 0.12], [76, 0.24], [79, 0.36], [76, 0.5], [79, 0.6], [84, 0.72]]
      notes.forEach(([m, at]) => tone(midi(m), { at, len: m === 84 ? 0.6 : 0.16, type: "square", vol: 0.07 }))
      notes.forEach(([m, at]) => tone(midi(m - 12), { at, len: 0.16, type: "triangle", vol: 0.08 }))
    }),
    flip: play(() => (noise({ len: 0.12, vol: 0.1, freq: 2600 }), tone(660, { at: 0.05, len: 0.08, type: "sine", vol: 0.05, to: 990 }))),
    tick: play(() => tone(1500, { len: 0.03, type: "square", vol: 0.04 })),
    pop: play(() => tone(520, { len: 0.09, type: "sine", vol: 0.12, to: 1040 })),
    // the show: a count-in beep (the last one higher), a long drum roll with a cymbal, the
    // crowd cheering, a playful "wah-wah", a cash register for a winning bet, a whoosh
    beep: play((last) => tone(last ? 1320 : 880, { len: last ? 0.3 : 0.12, type: "square", vol: 0.07 })),
    longroll: play(() => {
      for (let i = 0; i < 26; i++) noise({ at: i * 0.055, len: 0.06, vol: 0.08 + i * 0.008, freq: 700 + (i % 2) * 200 })
      noise({ at: 1.45, len: 0.5, vol: 0.16, freq: 6000 })
    }),
    cheer: play(() => {
      for (let i = 0; i < 14; i++) noise({ at: i * 0.05, len: 0.18, vol: 0.05, freq: 1200 + ((i * 397) % 1800) })
      ;[72, 76, 79, 84].forEach((m, i) => tone(midi(m), { at: 0.1 + i * 0.08, len: 0.3, type: "square", vol: 0.06 }))
    }),
    wahwah: play(() => [67, 66, 65, 64].forEach((m, i) => tone(midi(m), { at: i * 0.28, len: i === 3 ? 0.7 : 0.26, type: "sawtooth", vol: 0.05, to: i === 3 ? midi(62) : undefined }))),
    cash: play(() => (noise({ len: 0.06, vol: 0.12, freq: 3000 }), tone(midi(88), { at: 0.05, len: 0.12, type: "square", vol: 0.06 }), tone(midi(93), { at: 0.15, len: 0.35, type: "sine", vol: 0.1 }))),
    whoosh: play(() => noise({ len: 0.35, vol: 0.09, freq: 1400 })),
    close: () => ctx?.close().catch(() => {}),
  }
}
