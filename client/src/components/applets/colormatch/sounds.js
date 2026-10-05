// Color Match's sounds, 8-bit (the chip voices in utils/gameSynth.js): a two-note blip for a
// right answer (climbing with the multiplier), a thin buzz for a wrong one, ticks from the noise
// channel in the last five seconds, an arpeggio for a level-up, jingles at the end.

import { createSynth, midi } from "../../../utils/gameSynth"

export const createSounds = () => {
  const s = createSynth({ gain: 0.55 })
  return {
    setEnabled: s.setEnabled,
    right: (mult = 1) => s.play(({ pulse }) => (pulse(midi(76 + mult * 2), { len: 0.06, duty: 0.5, vol: 0.09 }), pulse(midi(83 + mult * 2), { at: 0.05, len: 0.08, duty: 0.25, vol: 0.08 }))),
    wrong: () => s.play(({ pulse }) => (pulse(117, { len: 0.24, duty: 0.125, vol: 0.12, vib: 0.03 }), pulse(110, { len: 0.24, duty: 0.5, vol: 0.06 }))),
    level: () => s.play(({ arp }) => arp([72, 76, 79, 84], { len: 0.3, duty: 0.25, vol: 0.09, step: 2 })),
    count: (n) => s.play(({ pulse }) => pulse(n ? 659 : 1319, { len: n ? 0.1 : 0.32, duty: 0.5, vol: 0.08, curve: 0.5 })),
    tick: () => s.play(({ chipNoise }) => chipNoise({ len: 0.03, vol: 0.12, pitch: 0.95, short: true })),
    over: () => s.play(({ jingle }) => jingle([[72, 2], [67, 2], [64, 2], [60, 4]], { frames: 6, voice: "tri", vol: 0.18 })),
    best: () =>
      s.play(({ jingle }) => {
        jingle([[60, 1], [64, 1], [67, 1], [72, 2], [67, 1], [72, 4]], { frames: 6, duty: 0.5, vol: 0.08 })
        jingle([[48, 3], [55, 3], [48, 4]], { frames: 6, voice: "tri", vol: 0.15 })
      }),
  }
}
