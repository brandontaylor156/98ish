// Dream House's little sounds, synthesized with Web Audio (no files): a pop when something
// is placed, a boop when picked up, a whoosh away, a camera click and a sparkle.
// Quiet when system sounds are off or the volume is muted.

import { getSettings, masterGain } from "../../../utils/settings"
import { createBus } from "../../../utils/audio"

// on the page's shared AudioContext, through the taskbar volume
const bus = createBus({ gain: 0.4 })

export const createSounds = () => {
  let ctx = null
  let out = null

  const ready = () => {
    if (!getSettings().systemSounds || !masterGain()) return null
    const b = bus()
    if (!b) return null
    ;({ ctx, out } = b)
    return ctx
  }

  const tone = (freq, { at = 0, len = 0.12, type = "sine", vol = 0.25, to } = {}) => {
    const t = ctx.currentTime + at
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + len)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + len + 0.02)
  }

  const noise = (len, from, to, vol = 0.2) => {
    const t = ctx.currentTime
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const bp = ctx.createBiquadFilter()
    bp.type = "bandpass"
    bp.frequency.setValueAtTime(from, t)
    bp.frequency.exponentialRampToValueAtTime(to, t + len)
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    src.connect(bp).connect(g).connect(out)
    src.start(t)
  }

  const play = (fn) => () => {
    if (ready()) fn()
  }

  return {
    place: play(() => {
      tone(520, { len: 0.09, to: 880, vol: 0.22 })
      tone(1040, { at: 0.05, len: 0.12, vol: 0.08 })
    }),
    pick: play(() => tone(660, { len: 0.08, to: 520, type: "triangle", vol: 0.15 })),
    remove: play(() => noise(0.25, 2400, 400, 0.18)),
    flip: play(() => noise(0.12, 600, 2400, 0.12)),
    shutter: play(() => {
      noise(0.05, 3000, 2000, 0.3)
      noise(0.08, 1200, 600, 0.2)
      tone(1568, { at: 0.12, len: 0.4, vol: 0.08 })
    }),
    sparkle: play(() => [1318.5, 1568, 2093, 2637].forEach((f, i) => tone(f, { at: i * 0.06, len: 0.3, vol: 0.09 }))),
    toggle: play(() => tone(880, { len: 0.06, type: "triangle", vol: 0.12 })),
  }
}
