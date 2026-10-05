// Boom Frenzy's sounds: 8-bit, on the chip voices of utils/gameSynth.js (pulse waves, a
// triangle, shift-register noise, all stepped 60 times a second; the shared AudioContext, the
// taskbar volume and mute). A blip when a bomb pops up, a crunchy whack (higher with the
// combo), a rumbling noise-channel explosion, a siren for Panic Time, a coin for Gold.

import { createSynth } from "../../../utils/gameSynth"

export const createSounds = () => {
  const s = createSynth({ gain: 0.6 })
  return {
    setEnabled: s.setEnabled,
    pop: () => s.play(({ pulse }) => pulse(330, { len: 0.06, to: 880, duty: 0.5, vol: 0.06 })),
    whack: (combo = 0) =>
      s.play(({ pulse, chipNoise }) => {
        chipNoise({ len: 0.07, vol: 0.32, pitch: 0.72, curve: 1.5 })
        pulse(260, { len: 0.08, to: 70, duty: 0.5, vol: 0.14 })
        pulse(523 * Math.pow(2, Math.min(12, Math.floor(combo / 3)) / 12), { at: 0.035, len: 0.1, duty: 0.125, vol: 0.09 })
      }),
    hit: () => s.play(({ pulse, chipNoise }) => (chipNoise({ len: 0.05, vol: 0.22, pitch: 0.95, short: true }), pulse(1046, { len: 0.05, duty: 0.25, vol: 0.06 }))),
    boom: (chained = false) =>
      s.play(({ chipNoise, tri }) => {
        chipNoise({ len: chained ? 0.5 : 0.8, vol: 0.55, pitch: 0.62, toPitch: 0.08, curve: 1.2 })
        tri(98, { len: 0.45, to: 32, vol: 0.4, curve: 0.8 })
      }),
    hurt: () => s.play(({ pulse }) => (pulse(392, { len: 0.12, to: 196, duty: 0.5, vol: 0.1 }), pulse(330, { at: 0.12, len: 0.18, to: 147, duty: 0.5, vol: 0.09 }))),
    miss: () => s.play(({ pulse }) => pulse(165, { len: 0.06, duty: 0.125, vol: 0.07 })),
    nudge: () => s.play(({ pulse }) => (pulse(880, { len: 0.04, duty: 0.25, vol: 0.05 }), pulse(880, { at: 0.08, len: 0.04, duty: 0.25, vol: 0.05 }))),
    jump: () => s.play(({ pulse }) => pulse(262, { len: 0.16, to: 1046, duty: 0.25, vol: 0.09 })),
    split: () => s.play(({ pulse }) => (pulse(988, { len: 0.08, to: 494, duty: 0.25, vol: 0.07 }), pulse(784, { at: 0.07, len: 0.08, to: 392, duty: 0.25, vol: 0.07 }))),
    freeze: () => s.play(({ arp }) => arp([88, 91, 95, 100], { len: 0.45, duty: 0.125, vol: 0.08, step: 2 })),
    heart: () => s.play(({ jingle }) => jingle([[72, 1], [76, 1], [79, 1], [84, 2]], { frames: 4, duty: 0.25, vol: 0.09 })),
    slow: () => s.play(({ pulse }) => pulse(659, { len: 0.5, to: 165, duty: 0.5, vol: 0.08, vib: 0.02 })),
    // the classic two-note coin
    gold: () => s.play(({ jingle }) => jingle([[83, 1], [88, 5]], { frames: 4, duty: 0.5, vol: 0.08, gap: 1 })),
    panic: () =>
      s.play(({ pulse }) => {
        for (let i = 0; i < 3; i++) {
          pulse(587, { at: i * 0.5, len: 0.25, to: 1175, duty: 0.25, vol: 0.07, curve: 0.3 })
          pulse(1175, { at: i * 0.5 + 0.25, len: 0.25, to: 587, duty: 0.25, vol: 0.07, curve: 0.3 })
        }
      }),
    weapon: (w) =>
      s.play(({ pulse, chipNoise, tri, arp }) => {
        if (w === "mallet") {
          chipNoise({ len: 0.5, vol: 0.55, pitch: 0.5, toPitch: 0.05 })
          tri(130, { len: 0.35, to: 33, vol: 0.4 })
        } else if (w === "freeze") arp([84, 88, 91, 96, 100], { len: 0.5, duty: 0.125, vol: 0.08 })
        else (pulse(1319, { len: 0.05, duty: 0.25, vol: 0.07 }), pulse(1568, { at: 0.08, len: 0.05, duty: 0.25, vol: 0.07 }), pulse(2093, { at: 0.16, len: 0.06, duty: 0.25, vol: 0.06 }))
      }),
    sort: (combo = 0) => s.play(({ pulse }) => pulse(392 * Math.pow(2, Math.min(14, combo) / 12), { len: 0.1, duty: 0.25, vol: 0.09 })),
    won: () =>
      s.play(({ jingle }) => {
        jingle([[60, 1], [64, 1], [67, 1], [72, 2], [67, 1], [72, 4]], { frames: 6, duty: 0.5, vol: 0.08 })
        jingle([[48, 3], [55, 3], [48, 4]], { frames: 6, voice: "tri", vol: 0.16 })
      }),
    lost: () => s.play(({ jingle }) => jingle([[67, 2], [63, 2], [60, 2], [55, 6]], { frames: 6, voice: "tri", vol: 0.2, gap: 0.95 })),
  }
}
