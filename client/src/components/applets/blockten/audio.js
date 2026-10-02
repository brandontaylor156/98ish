// Block Ten's sounds, synthesized with Web Audio (no files): a pick-up blip, a wooden
// clack when a piece lands, a rising chime for clears (higher for combos and streaks).
// Quiet when "Play system sounds" is off, when Options > Sound is off, or when muted, and
// follows the taskbar volume.

import { getSettings, masterGain } from "../../../utils/settings"

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12)

export const createSounds = () => {
  let ctx = null
  let out = null
  let on = true

  const ready = () => {
    if (!on || !getSettings().systemSounds) return null
    const gain = masterGain()
    if (!gain) return null
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)()
      } catch {
        return null
      }
      out = ctx.createGain()
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -10
      out.connect(comp).connect(ctx.destination)
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {})
    out.gain.value = 0.5 * gain
    return ctx
  }

  const tone = (freq, { at = 0, len = 0.12, type = "triangle", vol = 0.25, to, attack = 0.004 } = {}) => {
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

  const play = (fn) => () => ready() && fn()

  return {
    setEnabled: (value) => (on = value),
    pick: play(() => tone(660, { len: 0.06, to: 880, vol: 0.12, type: "sine" })),
    // a short woody knock, lower for bigger pieces
    place: (cells = 1) =>
      ready() && (tone(220 - cells * 12, { len: 0.09, type: "square", vol: 0.12, to: 90 }), tone(1200, { len: 0.025, type: "sine", vol: 0.08 })),
    bad: play(() => (tone(160, { len: 0.16, type: "sawtooth", vol: 0.1, to: 110 }), tone(150, { at: 0.08, len: 0.14, type: "sawtooth", vol: 0.08, to: 100 }))),
    // a chime per line, climbing with the streak
    clear: (lines = 1, streak = 1) => {
      if (!ready()) return
      const root = 72 + Math.min(7, (streak - 1) * 2)
      const steps = [0, 4, 7, 12, 16, 19, 24]
      for (let i = 0; i < Math.min(steps.length, lines + 2); i++) {
        tone(midi(root + steps[i]), { at: i * 0.055, len: 0.22, type: "triangle", vol: 0.18 })
        tone(midi(root + steps[i] + 12), { at: i * 0.055, len: 0.12, type: "sine", vol: 0.06 })
      }
    },
    deal: play(() => [0, 1, 2].forEach((i) => tone(midi(79 + i * 2), { at: i * 0.04, len: 0.05, type: "sine", vol: 0.07 }))),
    over: play(() => [67, 63, 60, 55].forEach((m, i) => tone(midi(m), { at: i * 0.16, len: 0.28, type: "triangle", vol: 0.18 }))),
    best: play(() => [60, 64, 67, 72, 67, 72].forEach((m, i) => tone(midi(m), { at: i * 0.1, len: i === 5 ? 0.5 : 0.14, type: "square", vol: 0.1 }))),
    tick: play(() => tone(1500, { len: 0.03, type: "sine", vol: 0.06 })),
    close: () => {
      ctx?.close?.().catch(() => {})
      ctx = null
    },
  }
}
