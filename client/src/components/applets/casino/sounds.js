// The casino's sounds, synthesized with Web Audio (no files): chips clacking, cards flicking,
// dice rattling, the roulette ball, slot reels ticking and stopping, and little jingles for
// wins, big wins and losses. On the page's shared AudioContext (utils/audio.js), so they
// follow the taskbar volume; quiet when "Play system sounds" or the casino's Sound is off.

import { getSettings, masterGain } from "../../../utils/settings"
import { createBus } from "../../../utils/audio"

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12)
const bus = createBus({ gain: 0.5, threshold: -14 })

let enabled = true
export const setSoundOn = (on) => (enabled = on)

let ctx = null
let out = null
let noise = null

const ready = () => {
  if (!enabled || !getSettings().systemSounds || !masterGain()) return false
  const b = bus()
  if (!b) return false
  ;({ ctx, out } = b)
  if (!noise || noise.sampleRate !== ctx.sampleRate) {
    noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return true
}

const tone = (freq, { at = 0, len = 0.12, type = "triangle", vol = 0.2, to, attack = 0.004 } = {}) => {
  const t = ctx.currentTime + at
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + len)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + len)
  o.connect(g).connect(out)
  o.start(t)
  o.stop(t + len + 0.02)
}

const burst = ({ at = 0, len = 0.07, freq = 2600, q = 0.9, vol = 0.35, type = "bandpass" } = {}) => {
  const t = ctx.currentTime + at
  const src = ctx.createBufferSource()
  src.buffer = noise
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.setValueAtTime(freq, t)
  f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.55), t + len)
  f.Q.value = q
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t + len)
  src.connect(f).connect(g).connect(out)
  src.start(t, Math.random() * 0.3)
  src.stop(t + len + 0.02)
}

const play = (fn) => (...args) => {
  try {
    if (ready()) fn(...args)
  } catch {
    // sound is a nicety
  }
}

export const sfx = {
  chip: play(() => (burst({ len: 0.03, freq: 5200, q: 6, vol: 0.22 }), burst({ at: 0.035, len: 0.025, freq: 4300, q: 6, vol: 0.14 }))),
  chips: play(() => {
    for (let i = 0; i < 6; i++) burst({ at: i * 0.04 + Math.random() * 0.02, len: 0.03, freq: 4200 + Math.random() * 1600, q: 6, vol: 0.16 })
  }),
  card: play((at = 0) => (burst({ at, len: 0.08, freq: 3000, vol: 0.3 }), burst({ at: at + 0.05, len: 0.05, freq: 1400, vol: 0.16 }))),
  deal: play((count = 4) => {
    for (let i = 0; i < count; i++) burst({ at: i * 0.12, len: 0.06, freq: 2600, vol: 0.2 })
  }),
  shuffle: play(() => {
    for (let i = 0; i < 16; i++) burst({ at: i * 0.03, len: 0.04, freq: 2200 + Math.random() * 1600, vol: 0.1 })
  }),
  dice: play(() => {
    for (let i = 0; i < 9; i++) burst({ at: i * 0.055 + Math.random() * 0.02, len: 0.035, freq: 1800 + Math.random() * 1500, q: 3, vol: 0.2 })
    burst({ at: 0.55, len: 0.05, freq: 900, q: 2, vol: 0.3 })
  }),
  ball: play((secs = 3) => {
    // the ball running round the rim, slowing, then rattling into a pocket
    const n = Math.round(secs * 9)
    for (let i = 0; i < n; i++) {
      const f = i / n
      burst({ at: secs * (1 - Math.pow(1 - f, 1.7)), len: 0.03, freq: 2400 - f * 900, q: 4, vol: 0.06 + f * 0.06 })
    }
    for (let i = 0; i < 4; i++) burst({ at: secs + i * 0.09, len: 0.04, freq: 1500, q: 3, vol: 0.18 - i * 0.03 })
  }),
  reelTick: play(() => tone(1500, { len: 0.02, type: "square", vol: 0.03 })),
  reelStop: play((i = 0) => (burst({ len: 0.06, freq: 700, q: 1.5, vol: 0.3 }), tone(midi(60 + i * 4), { len: 0.08, type: "square", vol: 0.05 }))),
  click: play(() => tone(midi(84), { len: 0.04, type: "square", vol: 0.04 })),
  hold: play(() => tone(midi(79), { len: 0.06, type: "triangle", vol: 0.1 })),
  win: play(() => [72, 76, 79, 84].forEach((m, i) => tone(midi(m), { at: i * 0.08, len: 0.18, type: "triangle", vol: 0.14 }))),
  bigWin: play(() => {
    ;[72, 76, 79, 84, 79, 84, 88, 91].forEach((m, i) => tone(midi(m), { at: i * 0.09, len: i === 7 ? 0.6 : 0.14, type: "triangle", vol: 0.15 }))
    for (let i = 0; i < 10; i++) burst({ at: 0.2 + i * 0.07, len: 0.03, freq: 5000, q: 6, vol: 0.12 })
  }),
  push: play(() => tone(midi(72), { len: 0.16, type: "sine", vol: 0.1 })),
  lose: play(() => [64, 60, 55].forEach((m, i) => tone(midi(m), { at: i * 0.13, len: 0.2, type: "triangle", vol: 0.09 }))),
  bad: play(() => tone(200, { len: 0.12, type: "sawtooth", vol: 0.06, to: 150 })),
  turn: play(() => (tone(midi(81), { len: 0.1, type: "sine", vol: 0.1 }), tone(midi(88), { at: 0.08, len: 0.16, type: "sine", vol: 0.08 }))),
}
