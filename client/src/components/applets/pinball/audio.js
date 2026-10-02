// Pinball's sound effects, synthesized with Web Audio (no sound files): bumper pings,
// flipper clacks, the plunger, drains and little jingles. Silent when "Play system sounds"
// is off in Display Properties, or when Sounds is unchecked in the game's Options menu.

import { getSettings } from "../../../utils/settings"

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12)

export const createSounds = () => {
  let ctx = null
  let out = null
  let noiseBuf = null
  const last = {} // throttles repeated sounds
  const opts = { sound: true, music: true }

  const ready = () => {
    if (!opts.sound || !getSettings().systemSounds) return null
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)()
      } catch {
        return null
      }
      out = ctx.createGain()
      out.gain.value = 0.55
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -12
      out.connect(comp).connect(ctx.destination)
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate)
      const d = noiseBuf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {})
    return ctx
  }

  const tone = (freq, { at = 0, len = 0.15, type = "square", vol = 0.2, to, attack = 0.003, filter } = {}) => {
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

  const noise = ({ at = 0, len = 0.08, vol = 0.3, freq = 1800, q = 1, to, type = "bandpass" } = {}) => {
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

  const melody = (notes, step = 0.09, type = "square", vol = 0.12) => {
    if (!opts.music) return
    notes.forEach((n, i) => n && tone(midi(n), { at: i * step, len: step * 1.6, type, vol, filter: 3200 }))
  }

  const throttle = (name, ms) => {
    const now = performance.now()
    if (last[name] && now - last[name] < ms) return true
    last[name] = now
    return false
  }

  const SOUNDS = {
    bumper: (id = 0) => {
      const base = [1046, 1318, 1568][id % 3]
      tone(base, { len: 0.16, type: "triangle", vol: 0.32, to: base * 0.7 })
      tone(base * 2.01, { len: 0.08, type: "sine", vol: 0.12 })
      noise({ len: 0.04, vol: 0.18, freq: 3000 })
    },
    sling: () => {
      noise({ len: 0.06, vol: 0.35, freq: 900, q: 2 })
      tone(220, { len: 0.08, type: "square", vol: 0.12, to: 140, filter: 1500 })
    },
    rubber: (speed = 300) => {
      if (speed < 250 || throttle("rubber", 60)) return
      tone(330, { len: 0.06, type: "triangle", vol: Math.min(0.2, speed / 4000) })
    },
    thud: (speed = 300) => {
      if (speed < 300 || throttle("thud", 70)) return
      noise({ len: 0.05, vol: Math.min(0.25, speed / 6000), freq: 500, q: 1.5 })
    },
    flipper: (dir) => {
      if (throttle("flip" + dir, 25)) return
      if (dir === "up") {
        noise({ len: 0.05, vol: 0.4, freq: 1400, q: 1.2 })
        tone(95, { len: 0.06, type: "square", vol: 0.15, filter: 600 })
      } else noise({ len: 0.035, vol: 0.18, freq: 900, q: 1.5 })
    },
    target: () => {
      noise({ len: 0.07, vol: 0.35, freq: 600, q: 1 })
      tone(880, { len: 0.12, type: "square", vol: 0.1, to: 1320, filter: 2500 })
    },
    bank: () => melody([72, 76, 79, 84], 0.07, "square", 0.1),
    rollover: () => tone(1760, { len: 0.06, type: "sine", vol: 0.18, to: 2200 }),
    dive: () => melody([67, 71, 74, 79, 83], 0.06, "triangle", 0.16),
    outlane: () => tone(300, { len: 0.35, type: "sawtooth", vol: 0.1, to: 120, filter: 1200 }),
    chest: () => {
      noise({ len: 0.18, vol: 0.3, freq: 300, q: 0.8, type: "lowpass" })
      tone(196, { len: 0.25, type: "triangle", vol: 0.25, to: 98 })
    },
    kickout: () => {
      noise({ len: 0.08, vol: 0.4, freq: 700, q: 1 })
      tone(140, { len: 0.1, type: "square", vol: 0.12, filter: 800 })
    },
    jackpot: () => melody([72, 79, 84, 88, 91, 96], 0.07, "square", 0.14),
    multiball: () => melody([60, 64, 67, 72, 0, 67, 72, 76, 79, 84], 0.075, "square", 0.14),
    mission: () => melody([67, 72, 76, 79, 0, 76, 79, 84], 0.08, "triangle", 0.18),
    extraBall: () => melody([72, 76, 79, 84, 79, 84, 88], 0.07, "square", 0.13),
    save: () => melody([79, 76, 79, 84], 0.07, "triangle", 0.16),
    drain: () => {
      tone(392, { len: 0.7, type: "sawtooth", vol: 0.12, to: 70, filter: 900 })
      tone(196, { at: 0.05, len: 0.7, type: "square", vol: 0.06, to: 40, filter: 500 })
    },
    gameOver: () => melody([67, 0, 64, 0, 60, 0, 55, 0, 0, 48], 0.11, "triangle", 0.18),
    start: () => melody([60, 64, 67, 72, 67, 72, 76], 0.07, "square", 0.12),
    pull: () => noise({ len: 0.3, vol: 0.08, freq: 300, to: 120, q: 3 }),
    launch: (strength = 1) => {
      noise({ len: 0.12, vol: 0.2 + 0.3 * strength, freq: 500 + 900 * strength, q: 0.8 })
      tone(120 + 200 * strength, { len: 0.12, type: "square", vol: 0.1, to: 60, filter: 900 })
    },
    nudge: () => noise({ len: 0.12, vol: 0.4, freq: 160, q: 0.8, type: "lowpass" }),
    danger: () => {
      tone(880, { len: 0.1, type: "square", vol: 0.12 })
      tone(880, { at: 0.16, len: 0.1, type: "square", vol: 0.12 })
    },
    tilt: () => tone(110, { len: 1.1, type: "sawtooth", vol: 0.18, filter: 700 }),
    reset: () => tone(660, { len: 0.1, type: "triangle", vol: 0.12, to: 990 }),
  }

  return {
    setOptions: (o) => Object.assign(opts, o),
    // a cue from game.sfx: "name" or { name, value }
    play: (cue) => {
      const name = typeof cue === "string" ? cue : cue.name
      const value = typeof cue === "string" ? undefined : cue.value
      if (!SOUNDS[name] || !ready()) return
      try {
        SOUNDS[name](value)
      } catch {
        // an audio hiccup shouldn't stop the game
      }
    },
    // the first tap or key unlocks audio on phones
    unlock: () => ready(),
    close: () => {
      ctx?.close().catch(() => {})
      ctx = null
    },
  }
}
