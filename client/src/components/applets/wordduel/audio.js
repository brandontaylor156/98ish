// Word Duel's sounds, synthesized with Web Audio (no files), in the spirit of 98-era
// system sounds: a soft key click, a tick per tile as it flips (higher for greens), a buzz
// for a word that isn't allowed, a little fanfare for a win. Quiet when "Play system
// sounds" is off, when Options > Sound is off, or when muted; follows the taskbar volume.

import { getSettings, masterGain } from "../../../utils/settings"
import { createBus } from "../../../utils/audio"

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12)

// on the page's shared AudioContext, through the taskbar volume
const bus = createBus({ gain: 0.45, threshold: -12 })

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

  const play = (fn) => (...args) => ready() && fn(...args)

  return {
    setEnabled: (value) => (on = value),
    key: play(() => tone(1800 + Math.random() * 200, { len: 0.025, type: "square", vol: 0.05 })),
    erase: play(() => tone(900, { len: 0.03, type: "square", vol: 0.04, to: 600 })),
    // a row turning over: colors -> a tick per tile on the beat of the flip
    flip: play((colors, stepMs = 250) => {
      ;[...colors].forEach((c, i) => {
        const at = (i * stepMs + stepMs * 0.5) / 1000
        if (c === "g") tone(midi(79), { at, len: 0.09, type: "sine", vol: 0.14 })
        else if (c === "y") tone(midi(74), { at, len: 0.08, type: "sine", vol: 0.12 })
        else tone(midi(62), { at, len: 0.05, type: "triangle", vol: 0.08 })
      })
    }),
    bad: play(() => (tone(180, { len: 0.12, type: "sawtooth", vol: 0.08, to: 130 }), tone(170, { at: 0.09, len: 0.12, type: "sawtooth", vol: 0.07, to: 120 }))),
    win: play((delay = 0) => [72, 76, 79, 84, 88].forEach((m, i) => tone(midi(m), { at: delay + i * 0.09, len: i === 4 ? 0.45 : 0.14, type: "triangle", vol: 0.16 }))),
    lose: play((delay = 0) => [67, 63, 60, 55].forEach((m, i) => tone(midi(m), { at: delay + i * 0.16, len: 0.22, type: "triangle", vol: 0.12 }))),
    // someone else finished
    ping: play(() => (tone(midi(88), { len: 0.12, type: "sine", vol: 0.08 }), tone(midi(95), { at: 0.06, len: 0.18, type: "sine", vol: 0.06 }))),
    roundStart: play(() => [67, 72].forEach((m, i) => tone(midi(m), { at: i * 0.1, len: 0.16, type: "square", vol: 0.06 }))),
    out: play(() => tone(140, { len: 0.4, type: "triangle", vol: 0.16, to: 60 })),
    tick: play(() => tone(1200, { len: 0.03, type: "square", vol: 0.05 })),
  }
}
