import { createBus, getAudioContext } from "../../../../utils/audio.js"

// My Park's chill music (park menu > Hang out > Music): an original lo-fi loop made right
// here with Web Audio (no recording, no samples, nothing downloaded: 98ish's own, free to
// play). Soft electric-piano chords on a slow ii-V-I-vi, a round bass note, a brushed beat and
// a little tape hiss, at 72 BPM. Quiet, under the taskbar volume. A handful of oscillators at a
// time and a 100 ms scheduler: costs next to nothing on a phone.
//
//   const m = createChillMusic(); m.start(); m.stop(); m.playing
//   chordAt(bar) -> the four notes (MIDI) of that bar (tests)

const BPM = 72
const BEAT = 60 / BPM
const BAR = BEAT * 4
// Dm9, G13, Cmaj9, Am9 (MIDI): voiced close, around middle C
const CHORDS = [
  [50, 53, 57, 60, 64],
  [43, 53, 57, 59, 64],
  [48, 52, 55, 59, 62],
  [45, 52, 55, 59, 60],
]
export const chordAt = (bar) => CHORDS[((bar % CHORDS.length) + CHORDS.length) % CHORDS.length]
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12)

const bus = createBus({ gain: 0.16, threshold: -24 })

export const createChillMusic = () => {
  let timer = null
  let nextBar = 0
  let barTime = 0
  let noise = null
  let hiss = null
  let out = null

  const noiseBuffer = (ctx) => {
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    return b
  }

  // an electric-piano-ish note: a sine and a quiet octave, soft attack, long decay
  const keys = (ctx, midi, t, len, vel) => {
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vel, t + 0.03)
    g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.6)
    g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    const f = ctx.createBiquadFilter()
    f.type = "lowpass"
    f.frequency.value = 1800
    for (const [mul, type, lvl] of [
      [1, "sine", 1],
      [2, "triangle", 0.12],
    ]) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = hz(midi) * mul
      o.detune.value = (Math.random() - 0.5) * 8
      const og = ctx.createGain()
      og.gain.value = lvl
      o.connect(og).connect(f)
      o.start(t)
      o.stop(t + len + 0.05)
    }
    f.connect(g).connect(out)
  }
  const bass = (ctx, midi, t, len) => {
    const o = ctx.createOscillator()
    o.type = "sine"
    o.frequency.value = hz(midi - 12)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.5, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + len + 0.05)
  }
  const kick = (ctx, t) => {
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(110, t)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.55, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + 0.32)
  }
  const brush = (ctx, t, lvl) => {
    const s = ctx.createBufferSource()
    s.buffer = noise
    const f = ctx.createBiquadFilter()
    f.type = "highpass"
    f.frequency.value = 5000
    const g = ctx.createGain()
    g.gain.setValueAtTime(lvl, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
    s.connect(f).connect(g).connect(out)
    s.start(t, Math.random() * 0.5, 0.12)
  }

  const scheduleBar = (ctx, bar, t) => {
    const ch = chordAt(bar)
    // chords on 1 and the "and" of 3 (a lazy push), a bass note on 1 and 3
    ch.forEach((m, i) => keys(ctx, m + 12, t + i * 0.012, BAR * 0.62, 0.07))
    ch.slice(1).forEach((m, i) => keys(ctx, m + 12, t + BEAT * 2.5 + i * 0.01, BAR * 0.4, 0.045))
    bass(ctx, ch[0], t, BEAT * 1.8)
    bass(ctx, ch[0] + 7, t + BEAT * 2, BEAT * 1.6)
    // the beat: kick on 1 and the "and" of 2, brushes on the off-beats (lazy swing)
    kick(ctx, t)
    kick(ctx, t + BEAT * 1.5)
    for (let i = 0; i < 8; i++) brush(ctx, t + i * (BEAT / 2) + (i % 2 ? BEAT * 0.08 : 0), i % 2 ? 0.05 : 0.025)
  }

  const tick = () => {
    const ctx = getAudioContext()
    if (!ctx || ctx.state !== "running") return
    while (barTime < ctx.currentTime + 0.4) {
      scheduleBar(ctx, nextBar, barTime)
      nextBar++
      barTime += BAR
    }
  }

  return {
    start() {
      if (timer) return
      const b = bus()
      const ctx = b?.ctx
      if (!ctx) return
      out = ctx.createGain()
      out.gain.setValueAtTime(0, ctx.currentTime)
      out.gain.linearRampToValueAtTime(1, ctx.currentTime + 2)
      out.connect(b.out)
      noise = noiseBuffer(ctx)
      // tape hiss, very low
      hiss = ctx.createBufferSource()
      hiss.buffer = noise
      hiss.loop = true
      const hf = ctx.createBiquadFilter()
      hf.type = "bandpass"
      hf.frequency.value = 3000
      const hg = ctx.createGain()
      hg.gain.value = 0.006
      hiss.connect(hf).connect(hg).connect(out)
      hiss.start()
      nextBar = 0
      barTime = ctx.currentTime + 0.1
      tick()
      timer = setInterval(tick, 100)
    },
    stop() {
      clearInterval(timer)
      timer = null
      const o = out
      const h = hiss
      out = null
      hiss = null
      const ctx = getAudioContext()
      if (o && ctx) {
        try {
          o.gain.cancelScheduledValues(ctx.currentTime)
          o.gain.setTargetAtTime(0, ctx.currentTime, 0.3)
        } catch {
          // closed
        }
        setTimeout(() => {
          try {
            h?.stop()
            o.disconnect()
          } catch {
            // gone
          }
        }, 1500)
      }
    },
    get playing() {
      return !!timer
    },
  }
}
