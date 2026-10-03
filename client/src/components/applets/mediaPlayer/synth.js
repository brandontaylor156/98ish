// General-MIDI-ish instruments built from oscillators, noise, filters and envelopes, plus
// the mixer they play into: per-track gain/pan with reverb and echo sends, a compressor,
// the master volume and an analyser for the visualizations. Works on a live AudioContext
// or an OfflineAudioContext.

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// ---- shared buffers ----

const noiseBuffer = (ctx) => {
  const len = Math.floor(ctx.sampleRate * 2)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  let seed = 1234567
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    data[i] = (seed / 0x3fffffff) - 1
  }
  return buf
}

// A hall-ish tail: decaying stereo noise, darker as it fades
const impulse = (ctx, seconds = 2.6, decay = 2.8) => {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    let seed = 99991 + ch * 7919
    let lp = 0
    const predelay = Math.floor(ctx.sampleRate * 0.012)
    for (let i = predelay; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const white = seed / 0x3fffffff - 1
      const t = i / len
      const k = 0.25 + 0.7 * t // the tail gets darker
      lp += (white - lp) * (1 - k)
      data[i] = lp * Math.pow(1 - t, decay)
    }
  }
  return buf
}

// A 25% pulse wave, for the chiptune lead
const pulseWave = (ctx, duty = 0.25) => {
  const n = 32
  const real = new Float32Array(n)
  const imag = new Float32Array(n)
  for (let k = 1; k < n; k++) {
    real[k] = (2 / (k * Math.PI)) * Math.sin(2 * Math.PI * k * duty)
    imag[k] = 0
  }
  return ctx.createPeriodicWave(real, imag)
}

// Organ drawbars 16', 8', 4', 2 2/3' and 2' as harmonics 1, 2, 4, 6 and 8 of the 16'
const drawbarWave = (ctx) => {
  const imag = new Float32Array(9)
  const real = new Float32Array(9)
  imag[1] = 0.5
  imag[2] = 0.8
  imag[4] = 0.55
  imag[6] = 0.3
  imag[8] = 0.2
  return ctx.createPeriodicWave(real, imag)
}

// ---- building blocks ----

const osc = (ctx, type, freq, t, detune = 0) => {
  const o = ctx.createOscillator()
  if (typeof type === "string") o.type = type
  else o.setPeriodicWave(type)
  o.frequency.setValueAtTime(freq, t)
  if (detune) o.detune.setValueAtTime(detune, t)
  return o
}

const gainNode = (ctx, value) => {
  const g = ctx.createGain()
  g.gain.value = value
  return g
}

const filter = (ctx, type, freq, q = 0.7) => {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  return f
}

// attack/decay/sustain/release on an AudioParam. Returns when the sound has died away.
const adsr = (param, t, dur, peak, { a = 0.005, d = 0.2, s = 0.7, r = 0.1 }) => {
  param.setValueAtTime(0, t)
  param.linearRampToValueAtTime(peak, t + a)
  if (s < 1) param.setTargetAtTime(peak * s, t + a, d / 3)
  const end = t + Math.max(dur, a)
  param.setTargetAtTime(0, end, r / 4)
  return end + r * 1.6
}

// A struck sound: fast attack, exponential decay, quick damp on release
const strike = (param, t, dur, peak, { a = 0.004, decay = 1, r = 0.12 }) => {
  param.setValueAtTime(0, t)
  param.linearRampToValueAtTime(peak, t + a)
  param.setTargetAtTime(0, t + a, decay)
  const end = t + Math.max(dur, a)
  param.setTargetAtTime(0, end, r / 4)
  return Math.min(end + r * 1.6, t + a + decay * 7)
}

const vibrato = (ctx, params, t, end, { rate = 5.5, cents = 10, delay = 0.25 } = {}) => {
  const lfo = osc(ctx, "sine", rate, t)
  const depth = ctx.createGain()
  depth.gain.setValueAtTime(0, t)
  depth.gain.linearRampToValueAtTime(0, t + delay)
  depth.gain.linearRampToValueAtTime(cents, t + delay + 0.4)
  lfo.connect(depth)
  for (const p of params) depth.connect(p)
  return lfo
}

const velGain = (vel) => Math.pow(clamp(vel, 0, 1), 1.4)

// ---- instruments ----
// Each takes (ctx, kit, out, { t, dur, midi, vel }) and returns { sources, vca, end }.

const piano = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const lp = filter(ctx, "lowpass", 1000, 0.6)
  const o1 = osc(ctx, "triangle", f, t)
  const o2 = osc(ctx, "sawtooth", f, t, 3)
  const o3 = osc(ctx, "sine", f * 2, t, -2)
  const g2 = gainNode(ctx, 0.28)
  const g3 = gainNode(ctx, 0.22)
  o1.connect(lp)
  o2.connect(g2).connect(lp)
  o3.connect(g3).connect(lp)
  lp.connect(vca).connect(out)
  const bright = clamp(f * (4 + 9 * vel), 400, 12000)
  lp.frequency.setValueAtTime(bright, t)
  lp.frequency.setTargetAtTime(clamp(f * 2.2, 300, 6000), t + 0.01, 0.35)
  const decay = clamp(1.7 - (midi - 48) * 0.028, 0.35, 2.4)
  const end = strike(vca.gain, t, dur, 0.5 * velGain(vel), { a: 0.003, decay, r: 0.25 })
  return { sources: [o1, o2, o3], vca, end }
}

// FM electric piano: a sine whose brightness fades as the note rings
const epiano = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const car = osc(ctx, "sine", f, t)
  const car2 = osc(ctx, "sine", f, t, 6)
  const mod = osc(ctx, "sine", f, t)
  const tine = osc(ctx, "sine", f * 14, t)
  const modGain = gainNode(ctx, 0)
  const tineGain = gainNode(ctx, 0)
  mod.connect(modGain).connect(car.frequency)
  modGain.connect(car2.frequency)
  tine.connect(tineGain).connect(vca)
  const index = f * (0.6 + 1.8 * vel)
  modGain.gain.setValueAtTime(index, t)
  modGain.gain.setTargetAtTime(f * 0.25, t, 0.35)
  tineGain.gain.setValueAtTime(0.06 * vel, t)
  tineGain.gain.setTargetAtTime(0, t, 0.05)
  const mix = gainNode(ctx, 0.5)
  car.connect(mix)
  car2.connect(mix)
  mix.connect(vca).connect(out)
  const decay = clamp(2.2 - (midi - 48) * 0.03, 0.6, 2.6)
  const end = strike(vca.gain, t, dur, 0.55 * velGain(vel), { a: 0.003, decay, r: 0.2 })
  return { sources: [car, car2, mod, tine], vca, end }
}

const strings = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const lp = filter(ctx, "lowpass", clamp(f * 5 + 900 * vel, 600, 5000), 0.5)
  const os = [-9, 0, 8].map((d) => osc(ctx, "sawtooth", f, t, d))
  for (const o of os) o.connect(lp)
  lp.connect(vca).connect(out)
  const end = adsr(vca.gain, t, dur, 0.21 * velGain(vel), { a: 0.22, d: 0.4, s: 0.85, r: 0.7 })
  const lfo = vibrato(ctx, os.map((o) => o.detune), t, end, { rate: 5, cents: 6, delay: 0.3 })
  return { sources: [...os, lfo], vca, end }
}

// Soft synth pad for the ambient piece: slow swell, a filter that opens and closes
const warmPad = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const lp = filter(ctx, "lowpass", f * 2, 0.9)
  const os = [osc(ctx, "sawtooth", f, t, -12), osc(ctx, "sawtooth", f, t, 11), osc(ctx, "triangle", f / 2, t)]
  for (const o of os) o.connect(lp)
  lp.connect(vca).connect(out)
  lp.frequency.setValueAtTime(f * 1.5, t)
  lp.frequency.linearRampToValueAtTime(clamp(f * 6, 500, 4000), t + Math.min(dur, 3))
  lp.frequency.setTargetAtTime(f * 1.5, t + dur, 0.8)
  const end = adsr(vca.gain, t, dur, 0.21 * velGain(vel), { a: 1.4, d: 1, s: 0.9, r: 2.2 })
  return { sources: os, vca, end }
}

const fingerBass = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const lp = filter(ctx, "lowpass", f * 6, 1.2)
  const o1 = osc(ctx, "sine", f, t)
  const o2 = osc(ctx, "sawtooth", f, t)
  const g2 = gainNode(ctx, 0.45)
  o1.connect(lp)
  o2.connect(g2).connect(lp)
  lp.connect(vca).connect(out)
  lp.frequency.setValueAtTime(clamp(f * (5 + 6 * vel), 200, 3000), t)
  lp.frequency.setTargetAtTime(f * 2.2, t + 0.005, 0.12)
  const end = adsr(vca.gain, t, dur, 0.4 * velGain(vel), { a: 0.006, d: 0.6, s: 0.55, r: 0.08 })
  return { sources: [o1, o2], vca, end }
}

// Brighter, snappier attack for the funk
const slapBass = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const lp = filter(ctx, "lowpass", 4000, 2)
  const o1 = osc(ctx, "sine", f, t)
  const o2 = osc(ctx, "sawtooth", f, t)
  const g2 = gainNode(ctx, 0.6)
  o1.connect(lp)
  o2.connect(g2).connect(lp)
  lp.connect(vca).connect(out)
  lp.frequency.setValueAtTime(clamp(f * 14 * vel, 400, 5000), t)
  lp.frequency.setTargetAtTime(f * 2.5, t + 0.004, 0.07)
  const end = adsr(vca.gain, t, dur, 0.4 * velGain(vel), { a: 0.003, d: 0.35, s: 0.5, r: 0.05 })
  return { sources: [o1, o2], vca, end }
}

const synthBass = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const lp = filter(ctx, "lowpass", 400, 7)
  const o1 = osc(ctx, "sawtooth", f, t)
  const o2 = osc(ctx, "square", f, t, 8)
  const sub = osc(ctx, "sine", f / 2, t)
  const subGain = gainNode(ctx, 0.5)
  o1.connect(lp)
  o2.connect(lp)
  sub.connect(subGain).connect(vca)
  lp.connect(vca).connect(out)
  lp.frequency.setValueAtTime(clamp(500 + 2600 * vel, 300, 4000), t)
  lp.frequency.setTargetAtTime(clamp(f * 2, 120, 800), t + 0.003, 0.07)
  const end = adsr(vca.gain, t, dur, 0.28 * velGain(vel), { a: 0.003, d: 0.2, s: 0.8, r: 0.05 })
  return { sources: [o1, o2, sub], vca, end }
}

const squareLead = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const lp = filter(ctx, "lowpass", clamp(f * 8, 1500, 6000), 0.8)
  const os = [osc(ctx, "square", f, t), osc(ctx, "square", f, t, 7)]
  for (const o of os) o.connect(lp)
  lp.connect(vca).connect(out)
  const end = adsr(vca.gain, t, dur, 0.25 * velGain(vel), { a: 0.008, d: 0.3, s: 0.8, r: 0.12 })
  const lfo = vibrato(ctx, os.map((o) => o.detune), t, end, { rate: 5.6, cents: 14, delay: 0.28 })
  return { sources: [...os, lfo], vca, end }
}

const sawLead = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const lp = filter(ctx, "lowpass", 3000, 2.5)
  const os = [osc(ctx, "sawtooth", f, t, -8), osc(ctx, "sawtooth", f, t, 8)]
  for (const o of os) o.connect(lp)
  lp.connect(vca).connect(out)
  lp.frequency.setValueAtTime(clamp(f * 10, 2000, 9000), t)
  lp.frequency.setTargetAtTime(clamp(f * 5, 1200, 5000), t + 0.01, 0.2)
  const end = adsr(vca.gain, t, dur, 0.25 * velGain(vel), { a: 0.006, d: 0.3, s: 0.75, r: 0.18 })
  const lfo = vibrato(ctx, os.map((o) => o.detune), t, end, { rate: 5.2, cents: 10, delay: 0.35 })
  return { sources: [...os, lfo], vca, end }
}

// A breathy, soft lead (fusion and ambient melodies)
const flute = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const o1 = osc(ctx, "sine", f, t)
  const o2 = osc(ctx, "triangle", f * 2, t)
  const g2 = gainNode(ctx, 0.12)
  const breath = ctx.createBufferSource()
  breath.buffer = kit.noise
  breath.loop = true
  const bp = filter(ctx, "bandpass", f * 2, 2)
  const bg = gainNode(ctx, 0.08)
  breath.connect(bp).connect(bg).connect(vca)
  o1.connect(vca)
  o2.connect(g2).connect(vca)
  vca.connect(out)
  const end = adsr(vca.gain, t, dur, 0.42 * velGain(vel), { a: 0.06, d: 0.3, s: 0.85, r: 0.18 })
  const lfo = vibrato(ctx, [o1.detune, o2.detune], t, end, { rate: 5, cents: 12, delay: 0.3 })
  return { sources: [o1, o2, breath, lfo], vca, end }
}

const bells = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const car = osc(ctx, "sine", f, t)
  const mod = osc(ctx, "sine", f * 3.5, t)
  const modGain = gainNode(ctx, 0)
  mod.connect(modGain).connect(car.frequency)
  modGain.gain.setValueAtTime(f * 2.2 * vel, t)
  modGain.gain.setTargetAtTime(0, t, 0.5)
  const hi = osc(ctx, "sine", f * 4, t)
  const hiGain = gainNode(ctx, 0)
  hiGain.gain.setValueAtTime(0.15, t)
  hiGain.gain.setTargetAtTime(0, t, 0.25)
  hi.connect(hiGain).connect(vca)
  car.connect(vca).connect(out)
  const end = strike(vca.gain, t, Math.max(dur, 1.5), 0.46 * velGain(vel), { a: 0.002, decay: 1.1, r: 0.8 })
  return { sources: [car, mod, hi], vca, end }
}

const musicBox = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const o1 = osc(ctx, "sine", f, t)
  const o2 = osc(ctx, "sine", f * 4.02, t)
  const g2 = gainNode(ctx, 0)
  g2.gain.setValueAtTime(0.25, t)
  g2.gain.setTargetAtTime(0, t, 0.12)
  o1.connect(vca)
  o2.connect(g2).connect(vca)
  vca.connect(out)
  const end = strike(vca.gain, t, Math.max(dur, 0.8), 0.46 * velGain(vel), { a: 0.002, decay: 0.55, r: 0.4 })
  return { sources: [o1, o2], vca, end }
}

// Drawbar organ with a little rotary wobble
const organ = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const mix = gainNode(ctx, 0.9)
  // all the drawbars in one waveform, built on the 16' (an octave below the note)
  const o = osc(ctx, kit.drawbars, f / 2, t)
  o.connect(mix)
  const trem = osc(ctx, "sine", 6.2, t)
  const tremDepth = gainNode(ctx, 0.1)
  trem.connect(tremDepth).connect(mix.gain)
  mix.connect(vca).connect(out)
  const end = adsr(vca.gain, t, dur, 0.24 * velGain(vel), { a: 0.006, d: 0.1, s: 1, r: 0.07 })
  return { sources: [o, trem], vca, end }
}

const brass = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const lp = filter(ctx, "lowpass", f, 1.5)
  const os = [osc(ctx, "sawtooth", f, t, -5), osc(ctx, "sawtooth", f, t, 6)]
  for (const o of os) o.connect(lp)
  lp.connect(vca).connect(out)
  lp.frequency.setValueAtTime(f * 1.2, t)
  lp.frequency.linearRampToValueAtTime(clamp(f * (3 + 5 * vel), 800, 7000), t + 0.06)
  lp.frequency.setTargetAtTime(clamp(f * 3.5, 600, 5000), t + 0.06, 0.25)
  const end = adsr(vca.gain, t, dur, 0.27 * velGain(vel), { a: 0.035, d: 0.3, s: 0.8, r: 0.14 })
  const lfo = vibrato(ctx, os.map((o) => o.detune), t, end, { rate: 5.5, cents: 8, delay: 0.4 })
  return { sources: [...os, lfo], vca, end }
}

// Plucked guitar-ish: a bright string that darkens quickly
const pluck = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const lp = filter(ctx, "lowpass", 2000, 1)
  const o1 = osc(ctx, "sawtooth", f, t)
  const o2 = osc(ctx, "triangle", f, t, 4)
  o1.connect(lp)
  o2.connect(lp)
  lp.connect(vca).connect(out)
  lp.frequency.setValueAtTime(clamp(f * (6 + 8 * vel), 800, 9000), t)
  lp.frequency.setTargetAtTime(clamp(f * 1.6, 200, 3000), t + 0.003, 0.12)
  const end = strike(vca.gain, t, dur, 0.38 * velGain(vel), { a: 0.002, decay: 0.55, r: 0.1 })
  return { sources: [o1, o2], vca, end }
}

const clav = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const hp = filter(ctx, "highpass", f * 1.5, 0.7)
  const bp = filter(ctx, "peaking", f * 4, 3)
  bp.gain.value = 8
  const o1 = osc(ctx, "square", f, t)
  const o2 = osc(ctx, "sawtooth", f, t, 5)
  o1.connect(hp)
  o2.connect(hp)
  hp.connect(bp).connect(vca).connect(out)
  const end = strike(vca.gain, t, dur, 0.2 * velGain(vel), { a: 0.002, decay: 0.22, r: 0.04 })
  return { sources: [o1, o2], vca, end }
}

const chipPulse = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const o = osc(ctx, kit.pulse, f, t)
  o.connect(vca).connect(out)
  const end = adsr(vca.gain, t, dur, 0.18 * velGain(vel), { a: 0.002, d: 0.15, s: 0.7, r: 0.03 })
  const lfo = vibrato(ctx, [o.detune], t, end, { rate: 6, cents: 18, delay: 0.3 })
  return { sources: [o, lfo], vca, end }
}

const chipSquare = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const o = osc(ctx, "square", f, t)
  o.connect(vca).connect(out)
  const end = adsr(vca.gain, t, dur, 0.12 * velGain(vel), { a: 0.002, d: 0.1, s: 0.6, r: 0.02 })
  return { sources: [o], vca, end }
}

const chipTriangle = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const o = osc(ctx, "triangle", f, t)
  o.connect(vca).connect(out)
  const end = adsr(vca.gain, t, dur, 0.34 * velGain(vel), { a: 0.002, d: 0.1, s: 1, r: 0.02 })
  return { sources: [o], vca, end }
}

const timpani = (ctx, kit, out, { t, dur, midi, vel }) => {
  const f = midiToHz(midi)
  const vca = gainNode(ctx, 0)
  const o = osc(ctx, "sine", f * 1.04, t)
  o.frequency.setTargetAtTime(f, t, 0.05)
  const o2 = osc(ctx, "sine", f * 1.5, t)
  const g2 = gainNode(ctx, 0.25)
  const thump = ctx.createBufferSource()
  thump.buffer = kit.noise
  const lp = filter(ctx, "lowpass", 300, 1)
  const tg = gainNode(ctx, 0)
  tg.gain.setValueAtTime(0.5 * vel, t)
  tg.gain.setTargetAtTime(0, t, 0.03)
  thump.connect(lp).connect(tg).connect(vca)
  o.connect(vca)
  o2.connect(g2).connect(vca)
  vca.connect(out)
  const end = strike(vca.gain, t, Math.max(dur, 1), 0.8 * velGain(vel), { a: 0.004, decay: 0.55, r: 0.4 })
  return { sources: [o, o2, thump], vca, end }
}

// ---- drums ----

const noiseHit = (ctx, kit, vca, t, { type = "highpass", freq = 7000, q = 0.7, level = 1, decay = 0.05, a = 0.001 }) => {
  const src = ctx.createBufferSource()
  src.buffer = kit.noise
  src.loop = true
  // start somewhere different in the noise each time so repeated hits aren't identical
  const offset = (t * 7.31) % 1.5
  const f = filter(ctx, type, freq, q)
  const g = gainNode(ctx, 0)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(level, t + a)
  g.gain.setTargetAtTime(0, t + a, decay)
  src.connect(f).connect(g).connect(vca)
  src.start(t, offset)
  return { src, end: t + a + decay * 7 }
}

const drumVoice = (ctx, kit, out, { t, midi, vel }, chip = false) => {
  const vca = gainNode(ctx, velGain(vel))
  vca.connect(out)
  const sources = []
  let end = t + 0.3
  const add = (r) => {
    sources.push(r.src)
    end = Math.max(end, r.end)
  }
  const tone = (type, from, to, sweep, decay, level) => {
    const o = osc(ctx, type, from, t)
    o.frequency.setTargetAtTime(to, t, sweep)
    const g = gainNode(ctx, 0)
    g.gain.setValueAtTime(level, t)
    g.gain.setTargetAtTime(0, t + 0.002, decay)
    o.connect(g).connect(vca)
    o.start(t)
    sources.push(o)
    end = Math.max(end, t + decay * 7)
  }
  switch (midi) {
    case 36: // kick
      if (chip) tone("square", 220, 50, 0.025, 0.05, 0.35)
      else {
        tone("sine", 165, 46, 0.035, 0.13, 1.1)
        add(noiseHit(ctx, kit, vca, t, { type: "highpass", freq: 2500, level: 0.25, decay: 0.004 }))
      }
      break
    case 37: // rim / side stick
      tone("square", 1750, 1700, 0.05, 0.012, 0.25)
      add(noiseHit(ctx, kit, vca, t, { type: "bandpass", freq: 2500, q: 2, level: 0.4, decay: 0.012 }))
      break
    case 38: // snare
      if (chip) add(noiseHit(ctx, kit, vca, t, { type: "highpass", freq: 1000, level: 0.4, decay: 0.045 }))
      else {
        tone("triangle", 230, 175, 0.03, 0.05, 0.55)
        add(noiseHit(ctx, kit, vca, t, { type: "highpass", freq: 1400, level: 0.55, decay: 0.065 }))
        add(noiseHit(ctx, kit, vca, t, { type: "bandpass", freq: 4500, q: 0.8, level: 0.25, decay: 0.09 }))
      }
      break
    case 39: // clap: a few quick bursts, then the tail
      for (const dt of [0, 0.011, 0.022]) add(noiseHit(ctx, kit, vca, t + dt, { type: "bandpass", freq: 1300, q: 1.1, level: 0.6, decay: 0.006 }))
      add(noiseHit(ctx, kit, vca, t + 0.03, { type: "bandpass", freq: 1200, q: 1, level: 0.55, decay: 0.08 }))
      break
    case 41: // low floor tom
    case 45: // toms
    case 47:
    case 50: {
      const base = { 41: 75, 45: 105, 47: 140, 50: 190 }[midi]
      tone("sine", base * 1.6, base, 0.04, 0.16, 0.8)
      add(noiseHit(ctx, kit, vca, t, { type: "lowpass", freq: 1200, level: 0.15, decay: 0.02 }))
      break
    }
    case 42: // closed hat
      add(noiseHit(ctx, kit, vca, t, chip ? { type: "highpass", freq: 6000, level: 0.2, decay: 0.012 } : { type: "highpass", freq: 7500, level: 0.32, decay: 0.018 }))
      break
    case 46: // open hat
      add(noiseHit(ctx, kit, vca, t, { type: "highpass", freq: 7000, level: 0.28, decay: 0.12 }))
      break
    case 49: // crash
      add(noiseHit(ctx, kit, vca, t, { type: "highpass", freq: 4500, level: 0.38, decay: 0.45 }))
      add(noiseHit(ctx, kit, vca, t, { type: "bandpass", freq: 8000, q: 1, level: 0.2, decay: 0.7 }))
      break
    case 51: // ride
      add(noiseHit(ctx, kit, vca, t, { type: "bandpass", freq: 7800, q: 3, level: 0.3, decay: 0.2 }))
      tone("sine", 3150, 3150, 1, 0.12, 0.04)
      break
    case 56: // cowbell
      tone("square", 562, 562, 1, 0.06, 0.12)
      tone("square", 845, 845, 1, 0.06, 0.12)
      break
    case 70: // shaker
      add(noiseHit(ctx, kit, vca, t, { type: "bandpass", freq: 6500, q: 1.2, level: 0.22, decay: 0.025, a: 0.008 }))
      break
    default:
      add(noiseHit(ctx, kit, vca, t, { type: "highpass", freq: 3000, level: 0.2, decay: 0.03 }))
  }
  return { sources, vca, end, started: true }
}

export const INSTRUMENTS = {
  piano: { label: "Acoustic Piano", play: piano },
  epiano: { label: "Electric Piano", play: epiano },
  strings: { label: "String Ensemble", play: strings, sustain: true },
  warmPad: { label: "Warm Pad", play: warmPad, sustain: true },
  fingerBass: { label: "Finger Bass", play: fingerBass },
  slapBass: { label: "Slap Bass", play: slapBass },
  synthBass: { label: "Synth Bass", play: synthBass },
  squareLead: { label: "Square Lead", play: squareLead },
  sawLead: { label: "Saw Lead", play: sawLead },
  flute: { label: "Flute", play: flute },
  bells: { label: "Tubular Bells", play: bells },
  musicBox: { label: "Music Box", play: musicBox },
  organ: { label: "Drawbar Organ", play: organ, sustain: true },
  brass: { label: "Brass Section", play: brass },
  pluck: { label: "Nylon Guitar", play: pluck },
  clav: { label: "Clavinet", play: clav },
  chipPulse: { label: "Pulse Lead", play: chipPulse },
  chipSquare: { label: "Square Wave", play: chipSquare },
  chipTriangle: { label: "Triangle Bass", play: chipTriangle },
  timpani: { label: "Timpani", play: timpani },
  drums: { label: "Standard Kit", play: (ctx, kit, out, n) => drumVoice(ctx, kit, out, n), drums: true },
  chipDrums: { label: "8-bit Kit", play: (ctx, kit, out, n) => drumVoice(ctx, kit, out, n, true), drums: true },
}

// ---- the mixer ----

// Builds the output chain on ctx and returns a synth that can play song notes into it.
export const createSynth = (ctx, { bpm = 120 } = {}) => {
  const kit = { noise: noiseBuffer(ctx), pulse: pulseWave(ctx), drawbars: drawbarWave(ctx) }
  const bus = gainNode(ctx, 0.62)
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -16
  comp.knee.value = 10
  comp.ratio.value = 4
  comp.attack.value = 0.004
  comp.release.value = 0.2
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -2
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.001
  limiter.release.value = 0.08
  const trim = gainNode(ctx, 0.85)
  const volume = gainNode(ctx, 1)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.72
  analyser.minDecibels = -88
  analyser.maxDecibels = -16
  // keeps DC out of the mix: the 1:1 FM electric piano and Shred 98's overdriven amps put
  // a little offset on their notes, which eats headroom and thumps when a note is cut
  const dcBlock = filter(ctx, "highpass", 15, 0.7)
  bus.connect(dcBlock).connect(comp).connect(trim).connect(limiter).connect(volume).connect(analyser).connect(ctx.destination)

  const reverb = ctx.createConvolver()
  reverb.buffer = impulse(ctx)
  const reverbReturn = gainNode(ctx, 0.75)
  reverb.connect(reverbReturn).connect(bus)

  // tempo-synced dotted-eighth echo
  const delay = ctx.createDelay(2)
  delay.delayTime.value = Math.min(1.5, (60 / bpm) * 0.75)
  const feedback = gainNode(ctx, 0.32)
  const delayTone = filter(ctx, "lowpass", 2800, 0.5)
  const delayReturn = gainNode(ctx, 0.5)
  delay.connect(delayTone).connect(feedback).connect(delay)
  delayTone.connect(delayReturn).connect(bus)
  delayReturn.connect(reverb)

  const tracks = []
  const voices = new Set()

  const addTrack = ({ gain = 0.7, pan = 0, reverb: rv = 0.2, delay: dl = 0 }) => {
    const input = gainNode(ctx, gain)
    let last = input
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner()
      p.pan.value = pan
      input.connect(p)
      last = p
    }
    last.connect(bus)
    if (rv > 0) last.connect(gainNode(ctx, rv)).connect(reverb)
    if (dl > 0) last.connect(gainNode(ctx, dl)).connect(delay)
    tracks.push({ input })
    return tracks.length - 1
  }

  // Play a note: instrument name, track index, time (ctx seconds), duration (s), midi, velocity
  const play = (instrument, track, t, dur, midi, vel) => {
    const inst = INSTRUMENTS[instrument]
    if (!inst) return null
    const voice = inst.play(ctx, kit, tracks[track].input, { t, dur, midi, vel })
    if (!voice.started) for (const s of voice.sources) s.start(t)
    for (const s of voice.sources) s.stop(voice.end + 0.05)
    voice.t = t
    voices.add(voice)
    const last = voice.sources[0]
    if (last) last.onended = () => {
      voices.delete(voice)
      try {
        voice.vca.disconnect()
      } catch {}
    }
    return voice
  }

  // Pause and stop also cut the reverb and echo tails; playing again opens them back up
  let tailsCut = false
  const tails = [reverbReturn.gain, delayReturn.gain, feedback.gain]
  const tailLevels = tails.map((p) => p.value)
  const open = () => {
    if (!tailsCut) return
    tailsCut = false
    tails.forEach((p, i) => p.setTargetAtTime(tailLevels[i], ctx.currentTime, 0.01))
  }

  // Silence everything now (pause, stop, seek): a quick fade so nothing clicks
  const hush = (cutTails = false) => {
    const now = ctx.currentTime
    if (cutTails) {
      tailsCut = true
      for (const p of tails) {
        p.cancelScheduledValues(now)
        p.setTargetAtTime(0, now, 0.03)
      }
    }
    for (const v of voices) {
      const g = v.vca.gain
      try {
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now)
        else g.cancelScheduledValues(now)
        g.setTargetAtTime(0, now, 0.012)
        for (const s of v.sources) s.stop(now + 0.08)
      } catch {}
    }
    voices.clear()
  }

  const setVolume = (v) => {
    volume.gain.setTargetAtTime(v, ctx.currentTime, 0.02)
  }

  const setTempo = (newBpm) => {
    delay.delayTime.setValueAtTime(Math.min(1.5, (60 / newBpm) * 0.75), ctx.currentTime)
  }

  const reset = () => {
    hush()
    for (const t of tracks) t.input.disconnect()
    tracks.length = 0
  }

  const destroy = () => {
    reset()
    try {
      analyser.disconnect()
      bus.disconnect()
    } catch {}
  }

  // a track's input node, for instruments that live outside this file (Shred 98's guitars)
  const trackInput = (i) => tracks[i]?.input || null

  return { ctx, analyser, addTrack, play, hush, open, setVolume, setTempo, reset, destroy, trackInput, activeVoices: () => voices.size }
}
