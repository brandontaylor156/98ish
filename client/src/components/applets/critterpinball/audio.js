// Critter Catch Pinball's sounds, synthesized with Web Audio like Blue Screen's (no sound
// files): pings, clacks and holes, chip jingles for catches and evolutions, a cry for every
// critter (made from its name: a few chirps and slides, lower and longer for bigger
// critters), and looping chiptunes while Catch, Evolve or a bonus stage runs. Everything
// goes through the page's shared context (utils/audio.js), so the taskbar volume and mute
// apply. Silent when "Play system sounds" is off, or Sounds is unchecked in Options.

import { getSettings, masterGain } from "../../../utils/settings"
import { createBus } from "../../../utils/audio"
import { cryNotes } from "./cry.js"

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12)
const bus = createBus({ gain: 0.55, threshold: -12 })

export const createSounds = () => {
  let ctx = null
  let out = null
  let noiseBuf = null
  const last = {}
  const opts = { sound: true, music: true }

  const ready = () => {
    if (!opts.sound || !getSettings().systemSounds || !masterGain()) return null
    const b = bus()
    if (!b) return null
    ;({ ctx, out } = b)
    if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate)
      const d = noiseBuf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    }
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

  const cry = (id) => {
    if (throttle("cry", 160)) return
    let at = 0
    for (const [from, to, len, wave] of cryNotes(id)) {
      tone(midi(from), { at, len, type: wave, vol: 0.12, to: midi(to), filter: 2800 })
      at += len * 0.85
    }
  }

  const SOUNDS = {
    bumper: (id = 0) => {
      const base = [988, 1175, 1397][id % 3]
      tone(base, { len: 0.14, type: "triangle", vol: 0.3, to: base * 0.75 })
      noise({ len: 0.04, vol: 0.16, freq: 3200 })
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
    rollover: () => tone(1760, { len: 0.06, type: "sine", vol: 0.18, to: 2200 }),
    outlane: () => tone(300, { len: 0.35, type: "sawtooth", vol: 0.1, to: 120, filter: 1200 }),
    hole: () => {
      noise({ len: 0.16, vol: 0.32, freq: 260, q: 0.8, type: "lowpass" })
      tone(165, { len: 0.2, type: "triangle", vol: 0.22, to: 82 })
    },
    kickout: () => {
      noise({ len: 0.08, vol: 0.4, freq: 700, q: 1 })
      tone(140, { len: 0.1, type: "square", vol: 0.12, filter: 800 })
    },
    letter: (n = 1) => melody([72 + n * 2, 79 + n * 2], 0.06, "square", 0.12),
    lit: () => melody([72, 76, 79, 84, 0, 84], 0.07, "square", 0.12),
    catchStart: () => melody([67, 0, 67, 71, 74, 0, 79, 78, 79], 0.08, "square", 0.13),
    reveal: () => tone(1320, { len: 0.07, type: "square", vol: 0.08, to: 1760 }),
    cry,
    caught: () => melody([72, 72, 72, 76, 0, 79, 0, 84, 84, 84], 0.085, "square", 0.15),
    ranAway: () => melody([72, 69, 65, 60], 0.12, "triangle", 0.15),
    evoStart: () => melody([60, 64, 67, 72, 67, 72, 76, 79], 0.07, "triangle", 0.15),
    select: () => tone(1046, { len: 0.05, type: "square", vol: 0.1 }),
    item: (n = 1) => melody([79 + n * 2, 84 + n * 2, 91 + n * 2], 0.05, "square", 0.12),
    evolved: () => {
      melody([60, 0, 64, 0, 67, 0, 72, 76, 79, 84, 0, 84, 88, 91], 0.09, "square", 0.14)
      noise({ at: 0.5, len: 0.6, vol: 0.12, freq: 4000, to: 9000, q: 0.5 })
    },
    travel: () => melody([67, 72, 76, 74, 72, 79], 0.09, "triangle", 0.16),
    bonusStart: () => melody([60, 67, 72, 0, 72, 76, 79, 0, 84], 0.07, "square", 0.14),
    pop: () => tone(400, { len: 0.08, type: "triangle", vol: 0.12, to: 900 }),
    bop: () => {
      noise({ len: 0.05, vol: 0.3, freq: 500, q: 1 })
      tone(660, { len: 0.1, type: "square", vol: 0.1, to: 330 })
    },
    clank: () => {
      tone(2200, { len: 0.08, type: "square", vol: 0.08, to: 1800 })
      noise({ len: 0.06, vol: 0.25, freq: 2500, q: 3 })
    },
    saver: () => {
      noise({ len: 0.1, vol: 0.45, freq: 500, q: 0.8 })
      melody([84, 88, 91, 96], 0.05, "square", 0.13)
    },
    charged: () => {
      for (let i = 0; i < 6; i++) tone(1200 + i * 220, { at: i * 0.03, len: 0.05, type: "square", vol: 0.06 })
    },
    upgrade: () => melody([72, 76, 79, 84, 88], 0.06, "square", 0.13),
    extraBall: () => melody([72, 76, 79, 84, 79, 84, 88], 0.07, "square", 0.13),
    save: () => melody([79, 76, 79, 84], 0.07, "triangle", 0.16),
    drain: () => {
      tone(392, { len: 0.7, type: "sawtooth", vol: 0.12, to: 70, filter: 900 })
      tone(196, { at: 0.05, len: 0.7, type: "square", vol: 0.06, to: 40, filter: 500 })
    },
    gameOver: () => melody([67, 0, 64, 0, 60, 0, 55, 0, 0, 48], 0.11, "triangle", 0.18),
    start: () => melody([60, 64, 67, 72, 0, 67, 72, 76, 0, 79, 84], 0.08, "square", 0.12),
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
    spin: () => {
      if (throttle("spin", 35)) return
      noise({ len: 0.02, vol: 0.16, freq: 4200, q: 3 })
      tone(2400, { len: 0.02, type: "square", vol: 0.04 })
    },
    skill: () => melody([76, 79, 83, 88, 0, 88, 91], 0.06, "square", 0.14),
    loop: () => melody([67, 71, 74, 79, 83, 86], 0.05, "triangle", 0.15),
    rampUp: () => noise({ len: 0.35, vol: 0.12, freq: 400, to: 1400, q: 2 }),
    rampDown: () => noise({ len: 0.3, vol: 0.1, freq: 1200, to: 300, q: 2 }),
    ramp: () => melody([60, 64, 67, 72, 76], 0.05, "square", 0.12),
  }

  // looping chiptunes: "catch" (Catch and Evolve) and "bonus" (bonus stages)
  const TUNES = {
    catch: { step: 0.12, bass: [43, 0, 43, 50, 0, 43, 48, 0, 41, 0, 41, 48, 0, 45, 0, 47], lead: [79, 0, 78, 79, 81, 0, 79, 76, 77, 0, 76, 74, 76, 0, 79, 83] },
    bonus: { step: 0.1, bass: [36, 0, 48, 36, 0, 48, 36, 0, 39, 0, 51, 39, 0, 51, 41, 43], lead: [72, 75, 79, 82, 84, 82, 79, 75, 74, 77, 81, 84, 86, 84, 81, 77] },
  }
  let tune = null
  let musicTimer = 0
  let musicStep = 0
  let musicAt = 0
  const schedule = () => {
    if (!tune || !ready() || !opts.music) return
    const T = TUNES[tune]
    if (musicAt < ctx.currentTime) musicAt = ctx.currentTime + 0.05
    while (musicAt < ctx.currentTime + 0.3) {
      const at = musicAt - ctx.currentTime
      const i = musicStep % 16
      if (T.bass[i]) tone(midi(T.bass[i]), { at, len: T.step * 1.4, type: "triangle", vol: 0.09, filter: 900 })
      if (T.lead[i]) tone(midi(T.lead[i]), { at, len: T.step * 0.9, type: "square", vol: 0.035, filter: 2600 })
      if (i % 4 === 0) noise({ at, len: 0.03, vol: 0.1, freq: 6000, q: 1 })
      musicStep++
      musicAt += T.step
    }
  }
  const setMusic = (name) => {
    name = name || null
    if (name === tune) return
    tune = name
    if (tune && !musicTimer) {
      musicStep = 0
      musicAt = 0
      schedule()
      musicTimer = setInterval(schedule, 120)
    } else if (!tune && musicTimer) {
      clearInterval(musicTimer)
      musicTimer = 0
    }
  }

  return {
    setOptions: (o) => Object.assign(opts, o),
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
    unlock: () => ready(),
    setMusic,
    close: () => {
      setMusic(null)
      ctx = null
    },
  }
}
