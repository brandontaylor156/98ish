// Zap It!'s sounds, 8-bit (the chip voices in utils/gameSynth.js): a triangle kick on every
// beat, a sound per call (a clunk for tap, a noise whoosh for swipe, a ratchet for twist, a
// falling zip for pull, a rising boing for flick, a rattle for shake), a rising blip per zap.

import { createSynth, midi } from "../../../utils/gameSynth"

export const createSounds = () => {
  const s = createSynth({ gain: 0.65 })
  return {
    setEnabled: s.setEnabled,
    beat: (accent) => s.play(({ tri, chipNoise }) => (tri(accent ? 131 : 98, { len: 0.1, to: 41, vol: accent ? 0.4 : 0.28 }), chipNoise({ len: 0.03, vol: 0.08, pitch: 0.95, short: true }))),
    call: (cmd) =>
      s.play(({ pulse, chipNoise, tri }) => {
        if (cmd === "tap") (pulse(220, { len: 0.1, to: 82, duty: 0.5, vol: 0.12 }), chipNoise({ len: 0.05, vol: 0.25, pitch: 0.75 }))
        else if (cmd === "swipe") chipNoise({ len: 0.32, vol: 0.3, pitch: 0.25, toPitch: 0.95, curve: 0.6 })
        else if (cmd === "twist") for (let i = 0; i < 6; i++) chipNoise({ at: i * 0.05, len: 0.03, vol: 0.3, pitch: 0.85, short: true })
        else if (cmd === "pull") pulse(1397, { len: 0.42, to: 262, duty: 0.125, vol: 0.1, curve: 0.5 })
        else if (cmd === "flick") (pulse(294, { len: 0.22, to: 1568, duty: 0.25, vol: 0.1 }), tri(147, { len: 0.12, to: 392, vol: 0.15 }))
        else if (cmd === "shake") for (let i = 0; i < 4; i++) chipNoise({ at: i * 0.07, len: 0.05, vol: 0.28, pitch: 0.98 })
      }),
    right: (n) => s.play(({ pulse }) => pulse(midi(72 + (n % 12)), { len: 0.08, duty: 0.25, vol: 0.08 })),
    wrong: () => s.play(({ pulse, chipNoise }) => (pulse(175, { len: 0.5, to: 55, duty: 0.5, vol: 0.13 }), chipNoise({ len: 0.35, vol: 0.18, pitch: 0.35, toPitch: 0.05 }))),
    best: () =>
      s.play(({ jingle }) => {
        jingle([[60, 1], [64, 1], [67, 1], [72, 2], [67, 1], [72, 4]], { frames: 6, duty: 0.5, vol: 0.08 })
        jingle([[48, 3], [55, 3], [48, 4]], { frames: 6, voice: "tri", vol: 0.15 })
      }),
  }
}
