// Echo Pads' sounds, 8-bit: each pad sings on its own pulse width over a triangle bass (the
// chip voices in utils/gameSynth.js), a low buzzing raspberry for a slip, a little arpeggio when
// a round is done.

import { createSynth } from "../../../utils/gameSynth"
import * as R from "./rules"

// green and blue thin, red and yellow round: each pad sounds a little different
const DUTY = [0.125, 0.25, 0.5, 0.25]

export const createSounds = () => {
  const s = createSynth({ gain: 0.5 })
  let stop = null
  return {
    setEnabled: s.setEnabled,
    padOn: (i) => {
      stop?.()
      stop = s.hold(R.PADS[i].freq, { duty: DUTY[i], vol: 0.13 })
    },
    padOff: () => {
      stop?.()
      stop = null
    },
    blip: (i, ms) =>
      s.play(({ pulse, tri }) => {
        const len = ms / 1000
        pulse(R.PADS[i].freq, { len, duty: DUTY[i], vol: 0.12, hold: len * 0.75, curve: 0.5 })
        tri(R.PADS[i].freq / 2, { len, vol: 0.14, hold: len * 0.75 })
      }),
    wrong: () => s.play(({ pulse, chipNoise }) => (pulse(73, { len: 0.8, duty: 0.5, vol: 0.12, vib: 0.04, hold: 0.5 }), chipNoise({ len: 0.4, vol: 0.12, pitch: 0.2 }))),
    round: () => s.play(({ arp }) => arp([72, 76, 79, 84], { len: 0.22, duty: 0.25, vol: 0.06 })),
  }
}
