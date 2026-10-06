// Twin Replay: paddle "pops" in the video's sound. A pickleball off a paddle is a short,
// bright click (most of its energy 1.5-6 kHz, ~5-15 ms); a bounce on the court is duller,
// footsteps and voices are lower and slower. So: band-pass the mono track, take its energy in
// 5 ms hops, and find sudden rises (log energy jumps) well above the local noise floor, with
// a brightness check (band energy vs everything) and a minimum gap between pops.

// a biquad band-pass (RBJ cookbook), run in place on a Float32Array copy
const bandPass = (x, rate, f0, q) => {
  const w = (2 * Math.PI * f0) / rate
  const alpha = Math.sin(w) / (2 * q)
  const cos = Math.cos(w)
  const a0 = 1 + alpha
  const b0 = alpha / a0
  const b2 = -alpha / a0
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  const y = new Float32Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    const o = b0 * v + b2 * x2 - a1 * y1 - a2 * y2
    y[i] = o
    x2 = x1
    x1 = v
    y2 = y1
    y1 = o
  }
  return y
}

const median = (arr) => {
  const s = Array.from(arr).sort((a, b) => a - b)
  return s.length ? s[s.length >> 1] : 0
}

// samples: Float32Array mono; rate: Hz. Returns [{ t, strength (dB over the floor),
// bright (0..1: share of the energy in the pop band) }]
export const detectOnsets = (samples, rate, { hop = 0.005, minGap = 0.22, minDb = 9, window = 1.2 } = {}) => {
  if (!samples || !samples.length || !rate) return []
  const H = Math.max(1, Math.round(hop * rate))
  const band = bandPass(bandPass(samples, rate, 3000, 0.9), rate, 3000, 0.9)
  const n = Math.floor(samples.length / H)
  const eBand = new Float32Array(n)
  const eAll = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    let a = 0
    for (let k = i * H; k < (i + 1) * H; k++) {
      s += band[k] * band[k]
      a += samples[k] * samples[k]
    }
    eBand[i] = s / H
    eAll[i] = a / H
  }
  const db = Array.from(eBand, (e) => 10 * Math.log10(e + 1e-12))
  // the noise floor: a running median of the band energy over `window` seconds (computed on
  // blocks so a long video stays fast)
  const W = Math.max(5, Math.round(window / hop))
  const block = Math.max(1, Math.round(W / 8))
  const floorAt = new Float32Array(n)
  for (let b = 0; b * block < n; b++) {
    const c = b * block + (block >> 1)
    const lo = Math.max(0, c - (W >> 1))
    const hi = Math.min(n, c + (W >> 1))
    const m = median(db.slice(lo, hi))
    for (let i = b * block; i < Math.min(n, (b + 1) * block); i++) floorAt[i] = m
  }
  const out = []
  let lastT = -9
  for (let i = 2; i < n - 2; i++) {
    const rise = db[i] - Math.min(db[i - 1], db[i - 2])
    const over = db[i] - floorAt[i]
    // a local peak of the band energy (within +-2 hops)
    if (!(db[i] >= db[i - 1] && db[i] >= db[i + 1] && db[i] >= db[i + 2])) continue
    if (over < minDb || rise < 4) continue
    const bright = eBand[i] / (eAll[i] + 1e-12)
    if (bright < 0.08) continue
    const t = i * hop
    if (t - lastT < minGap) {
      // (two in a row too close: keep the stronger)
      if (out.length && over > out[out.length - 1].strength) out[out.length - 1] = { t, strength: over, bright }
      continue
    }
    out.push({ t, strength: over, bright })
    lastT = t
  }
  return out
}

// A synthetic paddle pop (tests and the synthetic video): a 6 ms burst of filtered noise
// at 3 kHz with a fast decay, added into `samples` at time t
export const addPop = (samples, rate, t, gain = 0.6, seed = 1) => {
  let s = seed * 9301 + 49297
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280 - 0.5
  }
  const start = Math.round(t * rate)
  const len = Math.round(0.012 * rate)
  for (let i = 0; i < len && start + i < samples.length; i++) {
    const env = Math.exp(-i / (0.0025 * rate))
    samples[start + i] += gain * env * (Math.sin((2 * Math.PI * 3200 * i) / rate) * 0.7 + rnd() * 0.6)
  }
}
