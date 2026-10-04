// Color Match's sounds (utils/gameSynth.js): a bright blip for a right answer (climbing with the
// multiplier), a low buzz for a wrong one, ticks in the last five seconds, a level-up chime.

import { createSynth, midi } from "../../../utils/gameSynth"

export const createSounds = () => {
  const s = createSynth({ gain: 0.5 })
  return {
    setEnabled: s.setEnabled,
    right: (mult = 1) => s.play(({ tone }) => (tone(midi(76 + mult * 2), { len: 0.09, type: "sine", vol: 0.16 }), tone(midi(83 + mult * 2), { at: 0.05, len: 0.08, type: "sine", vol: 0.1 }))),
    wrong: () => s.play(({ tone }) => (tone(140, { len: 0.22, type: "square", vol: 0.1 }), tone(147, { len: 0.22, type: "square", vol: 0.08 }))),
    level: () => s.play(({ tone }) => [72, 76, 79, 84].forEach((m, i) => tone(midi(m), { at: i * 0.05, len: 0.14, type: "triangle", vol: 0.12 }))),
    count: (n) => s.play(({ tone }) => tone(n ? 660 : 990, { len: n ? 0.1 : 0.3, type: "square", vol: 0.08 })),
    tick: () => s.play(({ tone }) => tone(1500, { len: 0.03, type: "sine", vol: 0.06 })),
    over: () => s.play(({ tone }) => [72, 67, 64, 60].forEach((m, i) => tone(midi(m), { at: i * 0.12, len: 0.22, type: "triangle", vol: 0.14 }))),
    best: () => s.play(({ tone }) => [60, 64, 67, 72, 67, 72].forEach((m, i) => tone(midi(m), { at: i * 0.1, len: i === 5 ? 0.5 : 0.14, type: "square", vol: 0.09 }))),
  }
}
