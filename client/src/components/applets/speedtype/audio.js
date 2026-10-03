// Speed Typist 98's sounds, synthesized with Web Audio (no files): a soft key click, a
// buzz for a wrong key, countdown beeps and a starting horn, a chime when someone else
// finishes, and a little fanfare for your finish. Quiet when "Play system sounds" is off,
// when Options > Sound is off, or when muted; follows the taskbar volume.

import { getSettings, masterGain } from "../../../utils/settings"
import { createBus } from "../../../utils/audio"

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12)

const bus = createBus({ gain: 0.45, threshold: -12 })

export const createSounds = () => {
  let ctx = null
  let out = null
  let on = true
  let lastKey = 0

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
    // (at most one click every 25 ms: fast typists shouldn't sound like a machine gun)
    key: play(() => {
      const now = performance.now()
      if (now - lastKey < 25) return
      lastKey = now
      tone(1700 + Math.random() * 300, { len: 0.02, type: "square", vol: 0.035 })
    }),
    space: play(() => tone(1100, { len: 0.025, type: "square", vol: 0.03 })),
    wrong: play(() => tone(190, { len: 0.11, type: "sawtooth", vol: 0.07, to: 140 })),
    beep: play(() => tone(midi(72), { len: 0.14, type: "square", vol: 0.07 })),
    go: play(() => (tone(midi(79), { len: 0.32, type: "square", vol: 0.08 }), tone(midi(84), { at: 0.02, len: 0.3, type: "triangle", vol: 0.07 }))),
    ping: play(() => (tone(midi(88), { len: 0.12, type: "sine", vol: 0.07 }), tone(midi(95), { at: 0.06, len: 0.18, type: "sine", vol: 0.05 }))),
    finish: play((first = false) =>
      (first ? [72, 76, 79, 84, 88] : [67, 72, 76, 79]).forEach((m, i, a) => tone(midi(m), { at: i * 0.09, len: i === a.length - 1 ? 0.45 : 0.14, type: "triangle", vol: 0.15 }))
    ),
    out: play(() => tone(150, { len: 0.45, type: "triangle", vol: 0.14, to: 60 })),
    best: play(() => [79, 83, 86, 91].forEach((m, i) => tone(midi(m), { at: 0.5 + i * 0.07, len: 0.18, type: "sine", vol: 0.08 }))),
  }
}
