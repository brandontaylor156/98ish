// Photo Puzzle's sounds, synthesized with Web Audio (no files): a soft click when pieces
// fit, a slide for slide-puzzle tiles, and a little music-box tune for a finished puzzle.
// Quiet when system sounds are off, Options > Sound is off, or the volume is muted.

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

  const tone = (freq, { at = 0, len = 0.12, type = "triangle", vol = 0.25, to } = {}) => {
    const t = ctx.currentTime + at
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + len)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + len + 0.02)
  }

  const play = (fn) => () => ready() && fn()
  return {
    setOn: (value) => (on = value),
    pick: play(() => tone(660, { len: 0.05, vol: 0.08, type: "sine" })),
    snap: play(() => {
      tone(1200, { len: 0.04, vol: 0.18, type: "square", to: 700 })
      tone(320, { len: 0.08, vol: 0.2, type: "triangle", at: 0.005 })
    }),
    place: play(() => {
      tone(midi(76), { len: 0.12, vol: 0.14, type: "sine" })
      tone(midi(83), { len: 0.18, vol: 0.12, type: "sine", at: 0.06 })
    }),
    slide: play(() => tone(260, { len: 0.07, vol: 0.12, type: "triangle", to: 180 })),
    win: play(() => {
      // a little music-box tune
      ;[72, 76, 79, 84, 79, 84, 88].forEach((m, i) => tone(midi(m), { at: i * 0.13, len: 0.5, vol: 0.16, type: "sine" }))
      ;[60, 64, 67].forEach((m, i) => tone(midi(m), { at: 0.52 + i * 0.13, len: 0.9, vol: 0.08, type: "triangle" }))
    }),
  }
}
