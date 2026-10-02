// Sunny Acres sounds, synthesized with Web Audio (no sound files): soft pops for planting,
// swishes for harvesting, coin dings, a level-up jingle, a train whistle and a few animal
// noises. Silent when "Play system sounds" is off in Display Properties, or when Sounds is
// unchecked in the game's menu; follows the system volume.

import { getSettings, masterGain } from "../../../utils/settings"

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12)

export const createSounds = () => {
  let ctx = null
  let out = null
  let noiseBuf = null
  const last = {}
  const opts = { sound: true }

  const ready = () => {
    if (!opts.sound || !getSettings().systemSounds || masterGain() <= 0) return null
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)()
      } catch {
        return null
      }
      out = ctx.createGain()
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      out.connect(comp).connect(ctx.destination)
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate)
      const d = noiseBuf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    }
    out.gain.value = 0.5 * masterGain()
    if (ctx.state === "suspended") ctx.resume().catch(() => {})
    return ctx
  }

  const tone = (freq, { at = 0, len = 0.15, type = "sine", vol = 0.2, to, attack = 0.004, filter } = {}) => {
    const t = ctx.currentTime + at
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + len)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    let node = o
    if (filter) {
      const f = ctx.createBiquadFilter()
      f.type = "lowpass"
      f.frequency.value = filter
      node = o.connect(f)
    }
    node.connect(g).connect(out)
    o.start(t)
    o.stop(t + len + 0.02)
  }

  const noise = ({ at = 0, len = 0.1, vol = 0.2, freq = 1800, q = 1, to, type = "bandpass" } = {}) => {
    const t = ctx.currentTime + at
    const src = ctx.createBufferSource()
    src.buffer = noiseBuf
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.setValueAtTime(freq, t)
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + len)
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    src.connect(f).connect(g).connect(out)
    src.start(t)
    src.stop(t + len + 0.02)
  }

  const melody = (notes, step = 0.09, type = "triangle", vol = 0.14) =>
    notes.forEach((n, i) => n && tone(midi(n), { at: i * step, len: step * 1.8, type, vol, filter: 3000 }))

  // repeated sounds (a swipe across 20 fields) are thinned out and climb in pitch
  const run = { n: 0, at: 0 }
  const climb = () => {
    const now = performance.now()
    run.n = now - run.at < 400 ? Math.min(run.n + 1, 12) : 0
    run.at = now
    return run.n
  }
  const throttle = (name, ms) => {
    const now = performance.now()
    if (last[name] && now - last[name] < ms) return true
    last[name] = now
    return false
  }

  const SOUNDS = {
    plant: () => {
      if (throttle("plant", 45)) return
      const n = climb()
      tone(midi(64 + n), { len: 0.09, type: "sine", vol: 0.18, to: midi(70 + n) })
      noise({ len: 0.04, vol: 0.08, freq: 600 })
    },
    harvest: () => {
      if (throttle("harvest", 45)) return
      const n = climb()
      noise({ len: 0.12, vol: 0.18, freq: 2600, q: 0.8, to: 5000 })
      tone(midi(72 + n), { at: 0.03, len: 0.12, type: "triangle", vol: 0.14 })
    },
    collect: () => {
      if (throttle("collect", 60)) return
      const n = climb()
      tone(midi(76 + n), { len: 0.1, type: "triangle", vol: 0.16 })
      tone(midi(83 + n), { at: 0.06, len: 0.12, type: "triangle", vol: 0.12 })
    },
    feed: () => {
      if (throttle("feed", 60)) return
      noise({ len: 0.18, vol: 0.12, freq: 900, q: 0.7 })
    },
    queue: () => {
      noise({ len: 0.05, vol: 0.15, freq: 1200 })
      tone(523, { len: 0.08, type: "square", vol: 0.06, filter: 1800 })
    },
    coins: () => {
      tone(1568, { len: 0.08, type: "square", vol: 0.07, filter: 4000 })
      tone(2093, { at: 0.07, len: 0.2, type: "square", vol: 0.07, filter: 4000 })
    },
    build: () => {
      for (let k = 0; k < 3; k++) noise({ at: k * 0.12, len: 0.06, vol: 0.3, freq: 400, q: 2 })
      tone(110, { len: 0.12, type: "square", vol: 0.08, filter: 500 })
    },
    built: () => melody([67, 72, 76, 79], 0.08),
    error: () => tone(180, { len: 0.18, type: "square", vol: 0.07, to: 140, filter: 900 }),
    tap: () => tone(880, { len: 0.04, type: "sine", vol: 0.08 }),
    levelUp: () => {
      melody([60, 64, 67, 72, 0, 67, 72, 76, 79, 84], 0.085, "triangle", 0.16)
      melody([48, 0, 0, 55, 0, 0, 60], 0.17, "sine", 0.12)
    },
    delivered: () => {
      SOUNDS.coins()
      melody([72, 76, 79], 0.07, "triangle", 0.1)
    },
    heli: () => {
      for (let k = 0; k < 10; k++) noise({ at: k * 0.11, len: 0.07, vol: 0.12 - k * 0.01, freq: 220, q: 1.5 })
    },
    whistle: () => {
      tone(midi(81), { len: 0.5, type: "sine", vol: 0.1, attack: 0.05 })
      tone(midi(85), { len: 0.5, type: "sine", vol: 0.08, attack: 0.05 })
      noise({ len: 0.5, vol: 0.05, freq: 2200, q: 3 })
      tone(midi(81), { at: 0.6, len: 0.7, type: "sine", vol: 0.1, attack: 0.05 })
      tone(midi(85), { at: 0.6, len: 0.7, type: "sine", vol: 0.08, attack: 0.05 })
    },
    moo: () => {
      if (throttle("moo", 1500)) return
      tone(140, { len: 0.7, type: "sawtooth", vol: 0.1, to: 115, filter: 600, attack: 0.08 })
    },
    cluck: () => {
      if (throttle("cluck", 800)) return
      for (let k = 0; k < 3; k++) tone(900 + k * 60, { at: k * 0.09, len: 0.05, type: "square", vol: 0.05, to: 600, filter: 2500 })
    },
    baa: () => {
      if (throttle("baa", 1500)) return
      const o = { len: 0.5, type: "sawtooth", vol: 0.07, filter: 1400, attack: 0.04 }
      tone(330, { ...o, to: 300 })
      tone(336, { ...o, to: 306 })
    },
  }

  return {
    play: (name, ...args) => {
      if (!ready()) return
      try {
        SOUNDS[name]?.(...args)
      } catch {
        // audio hiccups never stop the game
      }
    },
    setEnabled: (on) => (opts.sound = on),
    enabled: () => opts.sound,
    close: () => {
      try {
        ctx?.close()
      } catch {}
      ctx = null
    },
  }
}
