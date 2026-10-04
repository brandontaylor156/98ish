// Boom Frenzy's sounds, synthesized (utils/gameSynth.js: the shared AudioContext, the taskbar
// volume and mute): a pop when a bomb comes up, a wooden thunk per whack (higher with the
// combo), a noisy boom, a siren for Panic Time.

import { createSynth, midi } from "../../../utils/gameSynth"

export const createSounds = () => {
  const s = createSynth({ gain: 0.55 })
  return {
    setEnabled: s.setEnabled,
    pop: () => s.play(({ tone }) => tone(520, { len: 0.07, to: 780, type: "sine", vol: 0.08 })),
    whack: (combo = 0) =>
      s.play(({ tone, noise }) => {
        noise({ len: 0.06, vol: 0.35, freq: 900, type: "bandpass", q: 1.2 })
        tone(170, { len: 0.1, type: "square", vol: 0.12, to: 80 })
        tone(midi(72 + Math.min(12, Math.floor(combo / 3))), { at: 0.03, len: 0.12, type: "triangle", vol: 0.13 })
      }),
    hit: () => s.play(({ tone, noise }) => (noise({ len: 0.05, vol: 0.3, freq: 2500, type: "highpass" }), tone(900, { len: 0.05, type: "square", vol: 0.06 }))),
    boom: () =>
      s.play(({ noise, tone }) => {
        noise({ len: 0.7, vol: 0.7, freq: 1800, to: 80 })
        tone(90, { len: 0.5, type: "sine", vol: 0.4, to: 35 })
      }),
    hurt: () => s.play(({ tone }) => (tone(330, { len: 0.18, type: "sawtooth", vol: 0.1, to: 160 }), tone(250, { at: 0.12, len: 0.2, type: "sawtooth", vol: 0.08, to: 120 }))),
    miss: () => s.play(({ tone }) => tone(200, { len: 0.06, type: "triangle", vol: 0.08 })),
    nudge: () => s.play(({ tone }) => (tone(700, { len: 0.05, type: "square", vol: 0.05 }), tone(700, { at: 0.08, len: 0.05, type: "square", vol: 0.05 }))),
    jump: () => s.play(({ tone }) => tone(300, { len: 0.18, type: "sine", vol: 0.15, to: 900 })),
    split: () => s.play(({ tone }) => (tone(600, { len: 0.1, type: "square", vol: 0.07 }), tone(400, { at: 0.06, len: 0.1, type: "square", vol: 0.07 }))),
    freeze: () => s.play(({ tone }) => [0, 1, 2, 3].forEach((i) => tone(midi(88 + i * 3), { at: i * 0.05, len: 0.2, type: "sine", vol: 0.07 }))),
    heart: () => s.play(({ tone }) => [72, 76, 79].forEach((m, i) => tone(midi(m), { at: i * 0.07, len: 0.2, type: "triangle", vol: 0.12 }))),
    slow: () => s.play(({ tone }) => tone(600, { len: 0.5, type: "sine", vol: 0.1, to: 200 })),
    gold: () => s.play(({ tone }) => [84, 88, 91, 96].forEach((m, i) => tone(midi(m), { at: i * 0.05, len: 0.18, type: "square", vol: 0.06 }))),
    panic: () =>
      s.play(({ tone }) => {
        for (let i = 0; i < 3; i++) {
          tone(600, { at: i * 0.5, len: 0.25, type: "sawtooth", vol: 0.08, to: 1100 })
          tone(1100, { at: i * 0.5 + 0.25, len: 0.25, type: "sawtooth", vol: 0.08, to: 600 })
        }
      }),
    weapon: (w) =>
      s.play(({ tone, noise }) => {
        if (w === "mallet") (noise({ len: 0.4, vol: 0.6, freq: 600, to: 60 }), tone(120, { len: 0.3, type: "square", vol: 0.2, to: 40 }))
        else if (w === "freeze") [0, 1, 2, 3, 4].forEach((i) => tone(midi(84 + i * 4), { at: i * 0.04, len: 0.3, type: "sine", vol: 0.07 }))
        else (tone(1200, { len: 0.06, type: "square", vol: 0.07 }), tone(1500, { at: 0.08, len: 0.06, type: "square", vol: 0.07 }))
      }),
    sort: (combo = 0) => s.play(({ tone }) => tone(midi(67 + Math.min(14, combo)), { len: 0.12, type: "triangle", vol: 0.14 })),
    won: () => s.play(({ tone }) => [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => tone(midi(m), { at: i * 0.08, len: i === 6 ? 0.5 : 0.12, type: "square", vol: 0.08 }))),
    lost: () => s.play(({ tone }) => [67, 63, 60, 55].forEach((m, i) => tone(midi(m), { at: i * 0.18, len: 0.3, type: "triangle", vol: 0.16 }))),
  }
}
