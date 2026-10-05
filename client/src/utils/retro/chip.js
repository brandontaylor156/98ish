// Chip-sound maths (pure, tested in retro.test.js), used by utils/gameSynth.js.
// A sound chip of the late 80s / early 90s had a few fixed voices: pulse waves with a
// duty cycle (12.5%, 25%, 50%), a triangle, and a noise channel clocked from a shift register;
// volume and pitch changed in steps, once per video frame (60 a second). The kit copies that.
export const FRAME = 1 / 60

// Fourier terms of a pulse wave with duty cycle d (for createPeriodicWave)
export const pulseTerms = (duty, n = 32) => {
  const real = new Float32Array(n + 1)
  const imag = new Float32Array(n + 1)
  for (let k = 1; k <= n; k++) {
    real[k] = (2 / (k * Math.PI)) * Math.sin(2 * Math.PI * k * duty)
    imag[k] = (2 / (k * Math.PI)) * (1 - Math.cos(2 * Math.PI * k * duty))
  }
  return { real, imag }
}

// a stepped volume envelope: [{ at (s from start), v }] one per frame, 16 levels (0..15)/15,
// decaying from `vol` to 0 over `len` (curve > 1 drops faster at first), with a sustain hold
export const steppedEnvelope = (len, vol, { curve = 1, hold = 0 } = {}) => {
  const n = Math.max(1, Math.round(len / FRAME))
  const out = []
  for (let k = 0; k <= n; k++) {
    const t = k * FRAME
    const x = t <= hold ? 0 : Math.min(1, (t - hold) / Math.max(FRAME, len - hold))
    const level = Math.round(15 * Math.pow(1 - x, curve)) / 15
    out.push({ at: t, v: vol * level })
  }
  return out
}

// a pitch sweep in frame steps from f0 to f1 (exponential, like a chip's sweep unit)
export const steppedSweep = (len, f0, f1) => {
  const n = Math.max(1, Math.round(len / FRAME))
  return Array.from({ length: n + 1 }, (_, k) => ({ at: k * FRAME, f: f0 * Math.pow(f1 / f0, k / n) }))
}

// a 15-bit linear feedback shift register, like a chip's noise channel: `short` taps bit 6
// (a 93-step metallic loop) instead of bit 1 (white-ish hiss). Returns n samples (+-1) with
// the register clocked `clock` times a second at sample rate `rate`.
export const lfsrNoise = (n, { rate = 44100, clock = 22050, short = false } = {}) => {
  const out = new Float32Array(n)
  let reg = 1
  let acc = 0
  const step = clock / rate
  for (let i = 0; i < n; i++) {
    acc += step
    while (acc >= 1) {
      const bit = (reg ^ (reg >> (short ? 6 : 1))) & 1
      reg = (reg >> 1) | (bit << 14)
      acc -= 1
    }
    out[i] = reg & 1 ? -1 : 1
  }
  return out
}

export const midi = (m) => 440 * Math.pow(2, (m - 69) / 12)
