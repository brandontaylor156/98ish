// Pickleball 98's ball sounds, by physically-informed (modal) synthesis. Pure: no Web Audio
// here, so Node renders the same samples (pbsound.test.js, the WAV comparisons). audio.js
// turns them into AudioBuffers (cached, a few variations each) and plays them.
//
// What a real pickleball sounds like (sources and numbers in DESIGN.md, "The sound"):
// - Paddle hit: a short impulse with a strong tone from the paddle face's first "membrane"
//   mode, ~1250 Hz (980-1477 Hz across paddles; graphite higher and ringing longer, wood
//   lower and more damped). Contact lasts 2-4 ms; onset and decay 1-2 ms with a 10-20 ms
//   ringing tail; energy below 1 kHz from the contact itself (a 200-500 Hz thump); little
//   above 2 kHz. Analysis of a CC0 field recording (Freesound #547092) agrees: hits peak at
//   1289 Hz, fall 10-14 dB by 1.6-2 kHz, and drop 20 dB in about 10 ms (with the court's
//   reflections; the dry voices here fall faster and the venue's room adds the tail).
// - Bounce on a hard court: no paddle mode; a duller, lower "tock" from the ball shell
//   (the recording's low-peaked impacts: ~730 Hz, falling off above 1 kHz, ~9 ms).
// - Net: a soft thud into the mesh plus a little rattle of the cord; the tape: a sharper tick.
// - Fence (chain link): a thud and a metallic clatter that rings a few tenths of a second.
//
// A "voice" is plain data: { level, dur, modes: [{ f, a, tau, att, at }], pulses: [{ a, tc,
// at }], noises: [{ a, f, q, tau, att, at }] }, times in seconds. renderVoice() sums them.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const ms = (v) => v / 1000

// a small seeded random source (mulberry32): the same key renders the same samples
export const rng = (seed = 1) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const hashKey = (s) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
const jitter = (rand, amount) => 1 + (rand() * 2 - 1) * amount

// mix calibration (fitted to the recording's average hit and bounce spectra; pbsound.test.js
// checks the result stays in the measured ranges)
export const CAL = { pulse: 10, crack: 3.5, crackQ: 0.9, crackTau: 4.4, tick: 0.2, mode: 2.1, bPulse: 0.5, bCrack: 1.5, bCrackTau: 3.25, bMode: 0.6, hitGain: 0.086, bounceGain: 0.42 }

// The paddle's core, by Locker Room design (looks only, so each design gets a plausible
// build): the face's first membrane mode (Hz) and how long it rings (amplitude time
// constant, ms). Bacon et al. 2025: 980-1477 Hz; graphite higher with less damping.
export const PADDLE_CORES = {
  stripe: { name: "composite", f: 1250, tau: 4.3 },
  solid: { name: "graphite", f: 1380, tau: 5.4 },
  split: { name: "carbon fiber", f: 1320, tau: 5.0 },
  dots: { name: "fiberglass", f: 1180, tau: 4.0 },
  chevron: { name: "thick polymer core", f: 1080, tau: 3.4 },
  flame: { name: "raw carbon", f: 1440, tau: 5.8 },
}
export const paddleCore = (design) => PADDLE_CORES[design] || PADDLE_CORES.stripe

// the shot families: soft touch, a block/volley, a full swing, the put-away
const SOFT = new Set(["dink", "drop", "reset", "block"])
const VOLLEY_KINDS = new Set(["punch", "block", "counter"])
export const shotFamily = (kind, volley) => {
  if (kind === "smash") return "smash"
  if (kind === "lob") return "lob"
  if (SOFT.has(kind)) return volley || kind === "block" ? "block" : "soft"
  if (volley || VOLLEY_KINDS.has(kind)) return "volley"
  if (kind === "serve") return "serve"
  return "drive"
}

// how hard the ball was struck, 0..1: mostly the paddle's speed (m/s), some the ball's
export const strengthOf = ({ paddle = 7, speed = 10 } = {}) => clamp(0.55 * (paddle / 14) + 0.45 * (speed / 20), 0.04, 1)

// grades: a sweet-spot hit is cleaner, an early/late one off-center (lower, duller, more thud)
export const contactOf = (grade) => (grade === "perfect" ? "sweet" : /^(very )?(early|late)$/.test(grade || "") ? (/very/.test(grade) ? "edge" : "off") : "normal")

// The paddle hit. `s` strength 0..1, family (shotFamily), contact (contactOf), design.
export const hitVoice = ({ s = 0.5, family = "drive", contact = "normal", design = "stripe" }, rand = Math.random) => {
  const core = paddleCore(design)
  s = clamp(s, 0, 1)
  // contact time: about 4 ms on a touch shot, 1.5 ms on a put-away (harder = shorter, so
  // more of the higher modes are excited)
  let tc = 4.2 - 2.6 * s
  let tau = core.tau * (0.85 + 0.3 * s)
  let f1 = core.f
  let bright = 0.35 + 0.65 * s
  let thump = 0.75 - 0.25 * s
  // loudness: a dink is ~15 dB under a put-away
  let db = -16 + 16 * Math.pow(s, 0.85)
  if (family === "soft") tau *= 0.85
  if (family === "block" || family === "volley") {
    tau *= 0.82 // a firm, short punch: the face is braced, it rings less
    tc *= 0.85
  }
  if (family === "lob") {
    tc *= 1.2 // an open-faced lift: a longer push, a rounder sound
    bright *= 0.8
  }
  if (family === "smash") {
    db += 1.5
    bright = Math.min(1.2, bright * 1.15)
  }
  if (contact === "sweet") {
    db += 0.8
    bright *= 0.85
    tau *= 1.08
  } else if (contact === "off") {
    f1 *= 0.95
    tau *= 0.8
    thump *= 1.3
    db -= 1
  } else if (contact === "edge") {
    f1 *= 0.9
    tau *= 0.6
    thump *= 1.6
    db -= 2.5
  }
  f1 *= jitter(rand, 0.02)
  tau *= jitter(rand, 0.1)
  tc = Math.max(1.2, tc * jitter(rand, 0.1))
  const att = ms(clamp(tc / 4, 0.25, 1))
  const modes = [
    // the membrane mode: the pickleball "pop"
    { f: f1, a: CAL.mode, tau: ms(tau), att },
    // the face's higher plate modes, weaker and shorter
    { f: f1 * 1.62 * jitter(rand, 0.03), a: CAL.mode * (0.12 + 0.16 * bright) * jitter(rand, 0.15), tau: ms(tau * 0.5), att },
    { f: f1 * 2.58 * jitter(rand, 0.03), a: CAL.mode * (0.04 + 0.1 * bright) * jitter(rand, 0.2), tau: ms(tau * 0.35), att },
    // the body/handle: the low part of the knock
    { f: 380 * jitter(rand, 0.08), a: 0.22 * thump, tau: ms(3), att: ms(0.4) },
  ]
  if (contact === "edge") modes.push({ f: 2850 * jitter(rand, 0.05), a: 0.25, tau: ms(2.2), att })
  return {
    kind: "hit",
    level: CAL.hitGain * Math.pow(10, db / 20),
    dur: 0.075,
    modes,
    // the contact itself (the force pulse's radiated click: a 200-500 Hz thump)
    pulses: [{ a: CAL.pulse * thump * Math.min(1, 2.4 / tc), tc: ms(tc) }],
    noises: [
      // the impact's broadband crack around the mode (real hits are only ~7 dB tonal)
      { a: CAL.crack * (0.6 + 0.4 * bright), f: 1400 * jitter(rand, 0.08), q: CAL.crackQ, tau: ms(CAL.crackTau), att: ms(0.15) },
      // the hollow, holed plastic ball: a bright tick at contact
      { a: CAL.tick * (0.4 + 0.6 * bright), f: 3600 * jitter(rand, 0.1), q: 0.8, tau: ms(0.8), att: ms(0.1) },
    ],
  }
}

// The bounce on a hard court. `s` 0..1 from the impact speed (m/s / 12).
export const bounceVoice = ({ s = 0.5 }, rand = Math.random) => {
  s = clamp(s, 0, 1)
  const f = 730 * jitter(rand, 0.06)
  const tau = 3.8 * jitter(rand, 0.1)
  const tc = 1.6 - 0.5 * s
  return {
    kind: "bounce",
    // ~9 dB under a paddle hit of the same pace
    level: CAL.bounceGain * Math.pow(10, (-24 + 15 * Math.pow(s, 0.8)) / 20),
    dur: 0.05,
    modes: [
      { f, a: CAL.bMode, tau: ms(tau), att: ms(0.35) },
      { f: f * 2.6 * jitter(rand, 0.05), a: CAL.bMode * (0.16 + 0.1 * s), tau: ms(tau * 0.4), att: ms(0.3) },
      { f: 260 * jitter(rand, 0.1), a: 0.35, tau: ms(3.5), att: ms(0.5) },
    ],
    pulses: [{ a: CAL.bPulse, tc: ms(tc) }],
    noises: [
      { a: CAL.bCrack, f: 900 * jitter(rand, 0.08), q: 0.6, tau: ms(CAL.bCrackTau), att: ms(0.15) },
      { a: 0.06 + 0.06 * s, f: 3000, q: 0.8, tau: ms(0.6), att: ms(0.1) },
    ],
  }
}

// Into the net (tape: false) or off the cord (tape: true)
export const netVoice = ({ s = 0.5, tape = false }, rand = Math.random) => {
  s = clamp(s, 0, 1)
  const noises = [
    // the mesh giving: a soft low "fwump"
    { a: 0.9, f: 420 * jitter(rand, 0.1), q: 0.8, tau: ms(28), att: ms(3) },
    // the mesh rustle
    { a: 0.18, f: 1600 * jitter(rand, 0.1), q: 0.7, tau: ms(35), att: ms(4) },
  ]
  // the cord and the clips rattling: a few tiny clicks
  const n = 3 + Math.floor(rand() * 4)
  let at = ms(8)
  for (let i = 0; i < n; i++) {
    at += ms(10 + rand() * 30)
    noises.push({ a: 0.35 * Math.pow(0.7, i), f: 2200 + rand() * 1400, q: 3, tau: ms(1.2), att: ms(0.1), at })
  }
  const modes = [{ f: 150 * jitter(rand, 0.1), a: 0.5, tau: ms(14), att: ms(2) }]
  if (tape) modes.unshift({ f: 980 * jitter(rand, 0.06), a: 0.9, tau: ms(4), att: ms(0.3) }, { f: 2350 * jitter(rand, 0.06), a: 0.3, tau: ms(2), att: ms(0.2) })
  return {
    kind: "net",
    level: Math.pow(10, (-15 + 9 * s) / 20),
    dur: 0.24,
    modes,
    pulses: tape ? [{ a: 0.5, tc: ms(1.5) }] : [],
    noises,
  }
}

// Off the chain-link fence: a thud and a ringing metallic clatter
export const fenceVoice = ({ s = 0.5 }, rand = Math.random) => {
  s = clamp(s, 0, 1)
  const modes = [{ f: 180 * jitter(rand, 0.1), a: 0.6, tau: ms(12), att: ms(1) }]
  // the wire's inharmonic ring
  for (let i = 0; i < 7; i++) modes.push({ f: 1200 + rand() * 4200, a: 0.08 + rand() * 0.12, tau: ms(30 + rand() * 70), att: ms(0.5) })
  const noises = [{ a: 0.4, f: 2600, q: 0.8, tau: ms(6), att: ms(0.2) }]
  let at = 0
  for (let i = 0; i < 8; i++) {
    at += ms(12 + rand() * 30)
    noises.push({ a: 0.28 * Math.pow(0.78, i), f: 2400 + rand() * 3000, q: 4, tau: ms(2), att: ms(0.1), at })
  }
  return { kind: "fence", level: Math.pow(10, (-16 + 10 * s) / 20), dur: 0.4, modes, pulses: [{ a: 0.4, tc: ms(2.5) }], noises }
}

// Partners tapping paddles between points: a light, damped click of two faces
export const tapVoice = ({ design = "stripe" }, rand = Math.random) => {
  const core = paddleCore(design)
  const f = core.f * 0.97 * jitter(rand, 0.03)
  return {
    kind: "tap",
    level: Math.pow(10, -24 / 20),
    dur: 0.04,
    modes: [
      { f, a: 1, tau: ms(2.4), att: ms(0.8) },
      { f: f * 1.08, a: 0.6, tau: ms(2), att: ms(0.8) }, // (the other paddle)
      { f: 420, a: 0.3, tau: ms(2.5), att: ms(0.6) },
    ],
    pulses: [{ a: 0.3, tc: ms(4) }],
    noises: [],
  }
}

// where the sound is heard from (the listener: your player, or the camera): farther =
// quieter (gentler than 1/r so the far side still reads: -6.5 dB at 14 m) and a slight high
// cut (air and the angle away from the face); pan from the side of the view
export const distanceMix = ({ dist = 3, side = 0 } = {}) => {
  const d = Math.max(0, dist)
  return {
    gain: clamp(Math.pow(4 / Math.max(4, d), 0.6), 0.25, 1),
    cutoff: Math.round(clamp(15000 / (1 + d / 7), 3500, 15000)),
    pan: clamp(side, -1, 1) * 0.55,
  }
}

// the cache key for a voice: what matters to the ear, quantized (the cache keeps a few
// variations of each)
export const voiceKey = (type, o = {}) => {
  const q = (v, n) => Math.round(clamp(v ?? 0.5, 0, 1) * n)
  switch (type) {
    case "hit":
      return `hit|${o.family || "drive"}|${o.contact || "normal"}|${o.design || "stripe"}|${q(o.s, 10)}`
    case "bounce":
      return `bounce|${q(o.s, 8)}`
    case "net":
      return `net|${o.tape ? 1 : 0}|${q(o.s, 4)}`
    case "fence":
      return `fence|${q(o.s, 4)}`
    default:
      return `${type}|${o.design || "stripe"}`
  }
}
export const VOICES = { hit: hitVoice, bounce: bounceVoice, net: netVoice, fence: fenceVoice, tap: tapVoice }
// the value of the key's quantized strength (so every variation of a key sounds alike)
export const keyStrength = (type, s) => {
  const n = type === "hit" ? 10 : type === "bounce" ? 8 : 4
  return Math.round(clamp(s ?? 0.5, 0, 1) * n) / n
}

// Sum a voice into samples. Each mode: a sine with an attack (1 - e^-t/att) and an
// exponential decay (e^-t/tau), run as a rotating phasor (cheap). Each pulse: the radiated
// click of a half-sine contact force (its derivative: one cosine half-cycle pair). Each
// noise: white noise through a band-pass (RBJ) with the same envelope.
export const renderVoice = (v, sr = 48000, rand = Math.random) => {
  const n = Math.ceil(v.dur * sr)
  const out = new Float32Array(n)
  for (const m of v.modes) {
    const start = Math.round((m.at || 0) * sr)
    if (m.f >= sr / 2) continue
    const w = (2 * Math.PI * m.f) / sr
    const c = Math.cos(w)
    const s = Math.sin(w)
    const dk = Math.exp(-1 / (m.tau * sr))
    const da = Math.exp(-1 / (Math.max(1e-5, m.att) * sr))
    let re = 1
    let im = 0
    let env = m.a
    let rise = 1
    for (let i = start; i < n; i++) {
      out[i] += env * (1 - rise) * im
      const r2 = re * c - im * s
      im = re * s + im * c
      re = r2
      env *= dk
      rise *= da
      if (env < 1e-5) break
    }
  }
  for (const p of v.pulses || []) {
    const start = Math.round((p.at || 0) * sr)
    const len = Math.max(2, Math.round(p.tc * sr))
    // (the force rises and falls over tc; the sound is its change: one sine cycle)
    for (let i = 0; i < len && start + i < n; i++) out[start + i] += p.a * Math.sin((2 * Math.PI * i) / len)
  }
  for (const z of v.noises || []) {
    const start = Math.round((z.at || 0) * sr)
    const w0 = (2 * Math.PI * Math.min(z.f, sr * 0.45)) / sr
    const alpha = Math.sin(w0) / (2 * z.q)
    const a0 = 1 + alpha
    const b0 = alpha / a0
    const b2 = -alpha / a0
    const a1 = (-2 * Math.cos(w0)) / a0
    const a2 = (1 - alpha) / a0
    let x1 = 0
    let x2 = 0
    let y1 = 0
    let y2 = 0
    const dk = Math.exp(-1 / (z.tau * sr))
    const da = Math.exp(-1 / (Math.max(1e-5, z.att) * sr))
    let env = z.a * 2.5 // (a band-passed noise is quieter than its input)
    let rise = 1
    for (let i = start; i < n; i++) {
      const x = rand() * 2 - 1
      const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = x
      y2 = y1
      y1 = y
      out[i] += env * (1 - rise) * y
      env *= dk
      rise *= da
      if (env < 1e-5) break
    }
  }
  // a DC blocker (the pulses and the low modes), the level, a soft limit, a short fade-out
  let xm = 0
  let ym = 0
  const R = Math.exp((-2 * Math.PI * 40) / sr)
  const fade = Math.min(n, Math.round(sr * 0.004))
  for (let i = 0; i < n; i++) {
    const x = out[i]
    const y = x - xm + R * ym
    xm = x
    ym = y
    let o = y * v.level
    if (Math.abs(o) > 0.8) o = Math.sign(o) * (0.8 + 0.2 * Math.tanh((Math.abs(o) - 0.8) / 0.2))
    if (i >= n - fade) o *= (n - i) / fade
    out[i] = o
  }
  return out
}

// a voice for an event, ready to render: { type, key, voice(rand) }
export const voiceFor = (type, o) => {
  const opts = { ...o, s: keyStrength(type, o.s) }
  return { type, key: voiceKey(type, opts), make: (rand) => VOICES[type](opts, rand) }
}

// the short room around the court (a ConvolverNode's impulse response): how much and how
// long, by venue. Outdoors it's the court and the fence; the stadium's stands ring longer.
export const ROOMS = {
  park: { wet: 0.06, len: 0.25 },
  beach: { wet: 0.035, len: 0.18 },
  winter: { wet: 0.03, len: 0.2 }, // (snow soaks it up)
  club: { wet: 0.08, len: 0.35 },
  stadium: { wet: 0.16, len: 0.8 },
}
export const roomFor = (venue) => ROOMS[venue] || ROOMS.park
