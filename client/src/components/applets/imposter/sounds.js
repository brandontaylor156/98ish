// Imposter's little sounds, synthesized (no files): a card flip, your turn, the vote
// reveal, and a jingle for whoever wins. Quiet when system sounds are off or muted.

import { getSettings, masterGain } from "../../../utils/settings"
import { createBus } from "../../../utils/audio"

const bus = createBus({ gain: 0.45, threshold: -14 })

export const createSounds = () => {
  let on = true
  const play = (notes) => {
    if (!on || !getSettings().systemSounds || !masterGain()) return
    const b = bus()
    if (!b) return
    const { ctx, out } = b
    for (const [freq, at, len, type = "square", vol = 0.08] of notes) {
      const t = ctx.currentTime + at
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = type
      o.frequency.setValueAtTime(freq, t)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + len)
      o.connect(g).connect(out)
      o.start(t)
      o.stop(t + len + 0.02)
    }
  }
  return {
    setEnabled: (v) => (on = !!v),
    flip: () => play([[660, 0, 0.06, "triangle", 0.12], [990, 0.05, 0.08, "triangle", 0.1]]),
    turn: () => play([[523, 0, 0.09], [784, 0.09, 0.12]]),
    vote: () => play([[392, 0, 0.12, "triangle", 0.12], [330, 0.13, 0.12, "triangle", 0.12], [262, 0.26, 0.25, "triangle", 0.12]]),
    crew: () => play([[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.1], [1047, 0.3, 0.3]]),
    imposter: () => play([[311, 0, 0.18, "sawtooth", 0.06], [294, 0.18, 0.18, "sawtooth", 0.06], [233, 0.36, 0.4, "sawtooth", 0.06]]),
  }
}
