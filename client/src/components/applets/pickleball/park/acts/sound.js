import { createBus } from "../../../../../utils/audio.js"

// My Park activities' sounds, synthesized here (no recordings): a tennis ball off strings and
// off the court, the net; a basketball's bounce, the rim's clang, the backboard, the swish of
// the net; the workout's beat (a kick and a hat), a click on the beat, and two little chimes.
// One bus under the taskbar volume (utils/audio.js createBus), a few nodes per sound.

const bus = createBus({ gain: 0.5, threshold: -18 })
let noise = null
const noiseBuf = (ctx) => {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise
  noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return noise
}
const env = (ctx, t, peak, attack, decay) => {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  return g
}
const tone = (ctx, out, { f, f1 = f, type = "sine", t = ctx.currentTime, peak = 0.3, attack = 0.002, decay = 0.1 }) => {
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(f, t)
  if (f1 !== f) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay)
  const g = env(ctx, t, peak, attack, decay)
  o.connect(g).connect(out)
  o.start(t)
  o.stop(t + attack + decay + 0.02)
}
const hiss = (ctx, out, { t = ctx.currentTime, peak = 0.2, attack = 0.002, decay = 0.08, freq = 2000, q = 0.8, type = "bandpass" }) => {
  const s = ctx.createBufferSource()
  s.buffer = noiseBuf(ctx)
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const g = env(ctx, t, peak, attack, decay)
  s.connect(f).connect(g).connect(out)
  s.start(t, Math.random() * 0.3)
  s.stop(t + attack + decay + 0.03)
}

let enabled = true
export const setActSound = (on) => {
  enabled = !!on
}
const go = (fn) => {
  if (!enabled) return
  const b = bus()
  if (!b) return
  try {
    fn(b.ctx, b.out)
  } catch {
    // (a sound never breaks a game)
  }
}

export const sfx = {
  // tennis: the strings (a hollow pock, brighter when hit harder), the court, the net
  racket(s = 0.5) {
    go((c, o) => {
      tone(c, o, { f: 380 + s * 160, f1: 260, peak: 0.22 + s * 0.25, decay: 0.07 })
      hiss(c, o, { freq: 2600 + s * 1500, q: 1.2, peak: 0.12 + s * 0.15, decay: 0.03 })
    })
  },
  bounce(s = 0.5) {
    go((c, o) => {
      tone(c, o, { f: 210, f1: 120, peak: 0.12 + s * 0.15, decay: 0.06 })
      hiss(c, o, { freq: 900, q: 0.8, peak: 0.05 + s * 0.06, decay: 0.03 })
    })
  },
  net() {
    go((c, o) => hiss(c, o, { freq: 500, q: 0.6, peak: 0.18, decay: 0.16, type: "lowpass" }))
  },
  // basketball: the floor (a deep thump with a ring), the rim (metal, inharmonic), the board,
  // the net (a soft rush)
  dribble(s = 0.6) {
    go((c, o) => {
      tone(c, o, { f: 110, f1: 70, peak: 0.25 + s * 0.2, decay: 0.12 })
      tone(c, o, { f: 340, f1: 300, peak: 0.05 + s * 0.04, decay: 0.09 })
    })
  },
  rim(s = 0.6) {
    go((c, o) => {
      for (const [f, k] of [[680, 1], [1610, 0.6], [2470, 0.4], [3900, 0.2]]) tone(c, o, { f, peak: (0.08 + s * 0.12) * k, decay: 0.35 + 0.2 * k })
      hiss(c, o, { freq: 3000, q: 1, peak: 0.06, decay: 0.02 })
    })
  },
  board(s = 0.6) {
    go((c, o) => {
      tone(c, o, { f: 150, f1: 110, peak: 0.25 + s * 0.15, decay: 0.12 })
      hiss(c, o, { freq: 1200, q: 0.7, peak: 0.12, decay: 0.05 })
    })
  },
  swish() {
    go((c, o) => {
      const t = c.currentTime
      hiss(c, o, { t, freq: 3200, q: 0.5, peak: 0.16, attack: 0.03, decay: 0.28, type: "highpass" })
    })
  },
  // the workout: the beat (accent on the one), a hit, a perfect, a miss
  beat(accent = false) {
    go((c, o) => {
      if (accent) tone(c, o, { f: 120, f1: 50, peak: 0.42, decay: 0.16 })
      else tone(c, o, { f: 95, f1: 45, peak: 0.22, decay: 0.12 })
      hiss(c, o, { freq: 8000, q: 0.7, peak: 0.05, decay: 0.03, type: "highpass" })
    })
  },
  offbeat() {
    go((c, o) => hiss(c, o, { freq: 9000, q: 0.7, peak: 0.04, decay: 0.025, type: "highpass" }))
  },
  good(perfect = false) {
    go((c, o) => {
      const t = c.currentTime
      tone(c, o, { f: perfect ? 988 : 784, t, peak: 0.12, decay: 0.12, type: "triangle" })
      if (perfect) tone(c, o, { f: 1319, t: t + 0.06, peak: 0.1, decay: 0.14, type: "triangle" })
    })
  },
  miss() {
    go((c, o) => tone(c, o, { f: 220, f1: 150, peak: 0.1, decay: 0.16, type: "square" }))
  },
  // a cheer of two notes up (you scored, made it, finished), or down (theirs)
  chime(up = true) {
    go((c, o) => {
      const t = c.currentTime
      const [a, b] = up ? [659, 880] : [523, 392]
      tone(c, o, { f: a, t, peak: 0.12, decay: 0.16, type: "triangle" })
      tone(c, o, { f: b, t: t + 0.12, peak: 0.12, decay: 0.22, type: "triangle" })
    })
  },
}
