// Camera's sounds, synthesized (no files): a mechanical shutter (click, then the mirror's
// clack), timer beeps, and blips when a video clip starts and stops. On the page's shared
// AudioContext through the taskbar volume; quiet when system sounds are off, the volume
// is muted, or Options > Shutter Sound is off.

import { getSettings, masterGain } from "../../../utils/settings"
import { createBus } from "../../../utils/audio"

const bus = createBus({ gain: 0.6 })

let enabled = true
export const setCameraSounds = (on) => (enabled = !!on)

const ready = () => {
  if (!enabled || !getSettings().systemSounds || !masterGain()) return null
  return bus()
}

// a short burst of filtered noise
const noise = ({ ctx, out }, at, { len = 0.03, freq = 3000, q = 1, vol = 0.5 } = {}) => {
  const frames = Math.max(1, Math.round(ctx.sampleRate * len))
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 3)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = "bandpass"
  filter.frequency.value = freq
  filter.Q.value = q
  const g = ctx.createGain()
  g.gain.value = vol
  src.connect(filter).connect(g).connect(out)
  src.start(ctx.currentTime + at)
}

const tone = ({ ctx, out }, freq, at, len, vol = 0.18, type = "square") => {
  const t = ctx.currentTime + at
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t + len)
  o.connect(g).connect(out)
  o.start(t)
  o.stop(t + len + 0.02)
}

export const shutter = () => {
  const b = ready()
  if (!b) return
  noise(b, 0, { len: 0.025, freq: 4200, q: 0.8, vol: 0.9 })
  noise(b, 0.005, { len: 0.02, freq: 900, q: 2, vol: 0.5 })
  noise(b, 0.075, { len: 0.045, freq: 2400, q: 0.7, vol: 0.7 })
  noise(b, 0.08, { len: 0.05, freq: 500, q: 1.5, vol: 0.5 })
}

// a countdown tick; the last one is higher
export const beep = (last = false) => {
  const b = ready()
  if (!b) return
  tone(b, last ? 1760 : 1320, 0, last ? 0.16 : 0.08, 0.12)
}

export const recordStart = () => {
  const b = ready()
  if (!b) return
  tone(b, 880, 0, 0.07, 0.12, "sine")
  tone(b, 1320, 0.08, 0.1, 0.12, "sine")
}

export const recordStop = () => {
  const b = ready()
  if (!b) return
  tone(b, 1320, 0, 0.07, 0.12, "sine")
  tone(b, 880, 0.08, 0.1, 0.12, "sine")
}
