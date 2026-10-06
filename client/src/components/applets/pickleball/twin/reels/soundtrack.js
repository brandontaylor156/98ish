// Instant Replay Reels: the soundtrack, generated (royalty-free by construction): a
// 96 BPM four-on-the-floor beat with a bass line and a chord pad, plus a paddle "pop" at every
// hit shown, with the music ducking under each pop. Rendered offline in an
// OfflineAudioContext into one AudioBuffer for the encoder.
//   popTimes(timeline) -> reel seconds of the hits on screen (pure)
//   renderSoundtrack(duration, pops) -> Promise<AudioBuffer>

export const BPM = 96

export const popTimes = (timeline) => {
  const out = []
  for (const s of timeline.segments) {
    if (!s.m) continue
    const rate = s.kind === "challenge" ? (s.t1 - s.t0) / s.dur : 1
    for (const h of s.m.rally.hits || []) {
      if (h.t < s.t0 || h.t >= s.t1) continue
      out.push(Math.round((s.start + (h.t - s.t0) / rate) * 1000) / 1000)
    }
  }
  return out.sort((a, b) => a - b)
}

const ROOTS = [45, 41, 48, 43] // A2, F2, C3, G2: vi-IV-I-V in C
const midi = (n) => 440 * 2 ** ((n - 69) / 12)

export const renderSoundtrack = async (duration, pops = [], { rate = 44100 } = {}) => {
  const len = Math.ceil((duration + 0.2) * rate)
  const ctx = new OfflineAudioContext(2, len, rate)
  const music = ctx.createGain()
  music.gain.value = 0.32
  const master = ctx.createGain()
  master.gain.value = 0.9
  music.connect(master)
  master.connect(ctx.destination)
  const beat = 60 / BPM
  const noise = ctx.createBuffer(1, rate * 0.3, rate)
  const nd = noise.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
  // fade the music in and out
  music.gain.setValueAtTime(0, 0)
  music.gain.linearRampToValueAtTime(0.32, 1.2)
  music.gain.setValueAtTime(0.32, Math.max(1.2, duration - 2))
  music.gain.linearRampToValueAtTime(0, duration)
  for (let b = 0, t = 0; t < duration; b++, t = b * beat) {
    // kick
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.setValueAtTime(140, t)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18)
    g.gain.setValueAtTime(0.9, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
    o.connect(g).connect(music)
    o.start(t)
    o.stop(t + 0.26)
    // hi-hat on the off-beat
    const hs = ctx.createBufferSource()
    hs.buffer = noise
    const hf = ctx.createBiquadFilter()
    hf.type = "highpass"
    hf.frequency.value = 7000
    const hg = ctx.createGain()
    hg.gain.setValueAtTime(0.25, t + beat / 2)
    hg.gain.exponentialRampToValueAtTime(0.001, t + beat / 2 + 0.05)
    hs.connect(hf).connect(hg).connect(music)
    hs.start(t + beat / 2)
    hs.stop(t + beat / 2 + 0.06)
    // snare on 2 and 4
    if (b % 2 === 1) {
      const ss = ctx.createBufferSource()
      ss.buffer = noise
      const sf = ctx.createBiquadFilter()
      sf.type = "bandpass"
      sf.frequency.value = 1800
      const sg = ctx.createGain()
      sg.gain.setValueAtTime(0.5, t)
      sg.gain.exponentialRampToValueAtTime(0.001, t + 0.16)
      ss.connect(sf).connect(sg).connect(music)
      ss.start(t)
      ss.stop(t + 0.17)
    }
    // bass on every beat, a pad per bar (4 beats)
    const root = ROOTS[Math.floor(b / 4) % ROOTS.length]
    const bo = ctx.createOscillator()
    bo.type = "triangle"
    bo.frequency.value = midi(root)
    const bg = ctx.createGain()
    bg.gain.setValueAtTime(0.5, t)
    bg.gain.exponentialRampToValueAtTime(0.001, t + beat * 0.9)
    bo.connect(bg).connect(music)
    bo.start(t)
    bo.stop(t + beat)
    if (b % 4 === 0) {
      for (const iv of [12, 15, 19]) {
        const po = ctx.createOscillator()
        po.type = "sawtooth"
        po.frequency.value = midi(root + iv)
        const pf = ctx.createBiquadFilter()
        pf.type = "lowpass"
        pf.frequency.value = 1400
        const pg = ctx.createGain()
        pg.gain.setValueAtTime(0, t)
        pg.gain.linearRampToValueAtTime(0.06, t + 0.3)
        pg.gain.linearRampToValueAtTime(0, t + beat * 4)
        po.connect(pf).connect(pg).connect(music)
        po.start(t)
        po.stop(t + beat * 4)
      }
    }
  }
  // paddle pops, with the music ducking under each
  for (const t of pops) {
    if (t >= duration) continue
    const s = ctx.createBufferSource()
    s.buffer = noise
    const f = ctx.createBiquadFilter()
    f.type = "bandpass"
    f.frequency.value = 1100
    f.Q.value = 1.6
    const g = ctx.createGain()
    g.gain.setValueAtTime(1.2, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07)
    s.connect(f).connect(g).connect(master)
    s.start(t)
    s.stop(t + 0.08)
    music.gain.setTargetAtTime(0.14, Math.max(0, t - 0.01), 0.01)
    music.gain.setTargetAtTime(0.32, t + 0.12, 0.08)
  }
  return ctx.startRendering()
}
