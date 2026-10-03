// Messenger sounds synthesized with Web Audio: a door creaking open
// when a buddy signs on, a door shutting when one signs off, and a bloop for a new IM.
// They play on the page's shared AudioContext (utils/audio.js wakes it on the first tap or
// key press, as phones require), through the taskbar volume.

import { getAudioContext, masterOutput } from "../../../utils/audio"
import { masterGain } from "../../../utils/settings"

const tone = (ctx, { type = "sine", from, to = from, start = 0, duration, volume = 0.2, filter }) => {
  const t = ctx.currentTime + start
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(from, t)
  osc.frequency.exponentialRampToValueAtTime(to, t + duration)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  let node = osc
  if (filter) {
    const biquad = ctx.createBiquadFilter()
    biquad.type = "lowpass"
    biquad.frequency.value = filter
    osc.connect(biquad)
    node = biquad
  }
  node.connect(gain).connect(masterOutput(ctx))
  osc.start(t)
  osc.stop(t + duration + 0.05)
}

const thud = (ctx, start, volume) => {
  const t = ctx.currentTime + start
  const length = Math.floor(ctx.sampleRate * 0.15)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = "lowpass"
  filter.frequency.value = 400
  const gain = ctx.createGain()
  gain.gain.value = volume
  source.connect(filter).connect(gain).connect(masterOutput(ctx))
  source.start(t)
}

const SOUNDS = {
  // Creaky hinge sliding up, then a little latch click
  doorOpen: (ctx) => {
    tone(ctx, { type: "sawtooth", from: 180, to: 420, duration: 0.45, volume: 0.06, filter: 1400 })
    tone(ctx, { type: "sawtooth", from: 240, to: 520, start: 0.05, duration: 0.35, volume: 0.04, filter: 1800 })
    tone(ctx, { type: "square", from: 1400, to: 1200, start: 0.47, duration: 0.04, volume: 0.05 })
  },
  // Short creak and a slam
  doorClose: (ctx) => {
    tone(ctx, { type: "sawtooth", from: 380, to: 200, duration: 0.2, volume: 0.05, filter: 1200 })
    thud(ctx, 0.18, 0.9)
    tone(ctx, { from: 90, to: 50, start: 0.18, duration: 0.2, volume: 0.35 })
  },
  // Bubbly two-note bloop
  imReceive: (ctx) => {
    tone(ctx, { from: 520, to: 780, duration: 0.09, volume: 0.25 })
    tone(ctx, { from: 780, to: 1040, start: 0.1, duration: 0.12, volume: 0.22 })
  },
  // Soft whoosh-blip on send
  imSend: (ctx) => {
    tone(ctx, { type: "triangle", from: 900, to: 500, duration: 0.12, volume: 0.15 })
  },
}

export const playSound = (name) => {
  if (!SOUNDS[name] || !masterGain()) return
  const ctx = getAudioContext()
  if (!ctx) return
  try {
    if (ctx.state !== "running") ctx.resume().catch(() => {})
    SOUNDS[name](ctx)
  } catch {
    // Audio is a nicety; never let it break messaging
  }
}
