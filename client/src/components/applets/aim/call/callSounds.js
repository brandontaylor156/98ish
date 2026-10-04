// Call sounds, all synthesized (original): the incoming ring (a warbling desk-phone trill),
// the ringback you hear while it rings on their end, a dial-up modem flourish while the call
// connects, and a click when it ends. They play on the page's shared AudioContext through
// the taskbar volume and mute (utils/audio.js).

import { createBus } from "../../../../utils/audio"

const bus = createBus({ gain: 0.9, threshold: -12 })

const voice = (ctx, out, { type = "sine", freq, start, duration, volume, attack = 0.01 }) => {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + attack)
  gain.gain.setValueAtTime(volume, start + duration - 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain).connect(out)
  osc.start(start)
  osc.stop(start + duration + 0.02)
  return osc
}

const noise = (ctx, out, { start, duration, volume, freq = 1800, q = 0.8 }) => {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration))
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = "bandpass"
  filter.frequency.value = freq
  filter.Q.value = q
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.02)
  gain.gain.setValueAtTime(volume, start + duration - 0.03)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  src.connect(filter).connect(gain).connect(out)
  src.start(start)
  return src
}

// one ring cycle: two bursts of a 20 Hz warble between two notes (about 1.4 s of sound)
const ringCycle = (ctx, out, t) => {
  const nodes = []
  for (const burst of [0, 0.75]) {
    for (let i = 0; i < 12; i++) {
      const at = t + burst + i * 0.05
      nodes.push(voice(ctx, out, { type: "triangle", freq: i % 2 ? 784 : 988, start: at, duration: 0.05, volume: 0.22, attack: 0.004 }))
      nodes.push(voice(ctx, out, { freq: i % 2 ? 1568 : 1976, start: at, duration: 0.05, volume: 0.04, attack: 0.004 }))
    }
  }
  return nodes
}

// ringback: a soft two-tone purr, like the line ringing far away
const ringbackCycle = (ctx, out, t) => [
  voice(ctx, out, { freq: 440, start: t, duration: 1.6, volume: 0.05, attack: 0.05 }),
  voice(ctx, out, { freq: 480, start: t, duration: 1.6, volume: 0.05, attack: 0.05 }),
]

// Plays `cycle` every `every` seconds until stopped
const loop = (cycle, every) => {
  const b = bus()
  if (!b) return () => {}
  const { ctx, out } = b
  let nodes = []
  let stopped = false
  const schedule = () => {
    if (stopped) return
    nodes = nodes.filter((n) => n.__end > ctx.currentTime)
    const made = cycle(ctx, out, ctx.currentTime + 0.05)
    made.forEach((n) => (n.__end = ctx.currentTime + every + 1))
    nodes.push(...made)
  }
  schedule()
  const timer = setInterval(schedule, every * 1000)
  return () => {
    stopped = true
    clearInterval(timer)
    for (const n of nodes) {
      try {
        n.stop()
      } catch {
        // already done
      }
    }
    nodes = []
  }
}

export const startRingtone = () => loop(ringCycle, 3)
export const startRingback = () => loop(ringbackCycle, 4)

// The modem: dialing digits, the answer tone, then the screech of the handshake (about 3 s)
export const playModem = () => {
  const b = bus()
  if (!b) return () => {}
  const { ctx, out } = b
  const t = ctx.currentTime + 0.05
  const nodes = []
  // DTMF-ish digits (pairs of original frequencies, not a real number)
  const digits = [[697, 1336], [770, 1209], [852, 1477], [697, 1209], [941, 1336], [770, 1477]]
  digits.forEach(([lo, hi], i) => {
    const at = t + i * 0.12
    nodes.push(voice(ctx, out, { freq: lo, start: at, duration: 0.08, volume: 0.05 }))
    nodes.push(voice(ctx, out, { freq: hi, start: at, duration: 0.08, volume: 0.05 }))
  })
  // answer tone with phase-reversal wobble
  const answer = t + 0.85
  nodes.push(voice(ctx, out, { freq: 2100, start: answer, duration: 0.55, volume: 0.035, attack: 0.03 }))
  // handshake: FSK chirps trading places with hiss bursts
  const hand = answer + 0.6
  for (let i = 0; i < 10; i++) {
    const at = hand + i * 0.13
    nodes.push(voice(ctx, out, { type: "square", freq: i % 2 ? 1200 : 2400, start: at, duration: 0.07, volume: 0.012, attack: 0.005 }))
    nodes.push(voice(ctx, out, { type: "sawtooth", freq: 980 + (i % 3) * 330, start: at + 0.06, duration: 0.06, volume: 0.01, attack: 0.005 }))
  }
  nodes.push(noise(ctx, out, { start: hand + 0.2, duration: 1.1, volume: 0.035, freq: 1900, q: 0.6 }))
  nodes.push(noise(ctx, out, { start: hand + 1.35, duration: 0.35, volume: 0.02, freq: 1100, q: 1.2 }))
  return () => {
    for (const n of nodes) {
      try {
        n.stop()
      } catch {
        // done
      }
    }
  }
}

// a receiver going down: two falling blips
export const playHangUp = () => {
  const b = bus()
  if (!b) return
  const { ctx, out } = b
  const t = ctx.currentTime + 0.02
  voice(ctx, out, { type: "triangle", freq: 660, start: t, duration: 0.09, volume: 0.15 })
  voice(ctx, out, { type: "triangle", freq: 440, start: t + 0.11, duration: 0.14, volume: 0.15 })
}

// connected: a little rising chime
export const playConnected = () => {
  const b = bus()
  if (!b) return
  const { ctx, out } = b
  const t = ctx.currentTime + 0.02
  voice(ctx, out, { freq: 523, start: t, duration: 0.1, volume: 0.12 })
  voice(ctx, out, { freq: 784, start: t + 0.09, duration: 0.16, volume: 0.12 })
}

// Android buzzes along with the ring (iPhones have no web vibration)
export const vibrateRing = () => {
  try {
    if (/Android/i.test(navigator.userAgent)) navigator.vibrate?.([400, 200, 400])
  } catch {
    // no vibration
  }
}
export const stopVibrate = () => {
  try {
    if (/Android/i.test(navigator.userAgent)) navigator.vibrate?.(0)
  } catch {
    // no vibration
  }
}
