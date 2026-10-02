import { getSettings } from "./settings"

// Windows' system sounds (ding, chord, minimize...), synthesized with Web Audio: no sound
// files. Turned off with "Play system sounds" in Display Properties > Startup.

let ctx = null
const audio = () => {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)()
    } catch {
      return null
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {})
  return ctx
}

const tone = (c, out, { freq, to, start = 0, length = 0.3, type = "sine", level = 0.5, attack = 0.005 }) => {
  const t = c.currentTime + start
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + length)
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(level, t + attack)
  gain.gain.exponentialRampToValueAtTime(0.0008, t + length)
  osc.connect(gain).connect(out)
  osc.start(t)
  osc.stop(t + length + 0.05)
}

const noise = (c, out, { start = 0, length = 0.3, level = 0.4, filter = 2000, q = 0.8, sweepTo }) => {
  const t = c.currentTime + start
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * length), c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buffer
  const bp = c.createBiquadFilter()
  bp.type = "bandpass"
  bp.frequency.setValueAtTime(filter, t)
  if (sweepTo) bp.frequency.exponentialRampToValueAtTime(sweepTo, t + length)
  bp.Q.value = q
  const gain = c.createGain()
  gain.gain.setValueAtTime(level, t)
  gain.gain.exponentialRampToValueAtTime(0.0008, t + length)
  src.connect(bp).connect(gain).connect(out)
  src.start(t)
}

const SOUNDS = {
  // the everyday "ding": a bright bell
  ding: (c, out) => {
    tone(c, out, { freq: 1318.5, length: 0.9, level: 0.35 })
    tone(c, out, { freq: 2637, length: 0.5, level: 0.12 })
    tone(c, out, { freq: 1975.5, length: 0.4, level: 0.08 })
  },
  // exclamation: a soft three-note chord
  chord: (c, out) => {
    ;[523.25, 659.25, 783.99].forEach((f, i) => tone(c, out, { freq: f, start: i * 0.012, length: 1.1, type: "triangle", level: 0.28 }))
    tone(c, out, { freq: 1046.5, start: 0.03, length: 0.8, level: 0.08 })
  },
  // critical stop: two low thuds
  critical: (c, out) => {
    tone(c, out, { freq: 220, to: 180, length: 0.35, type: "square", level: 0.12 })
    tone(c, out, { freq: 165, to: 130, start: 0.18, length: 0.5, type: "square", level: 0.12 })
  },
  minimize: (c, out) => noise(c, out, { length: 0.22, level: 0.35, filter: 2600, sweepTo: 500, q: 1.5 }),
  maximize: (c, out) => noise(c, out, { length: 0.22, level: 0.35, filter: 500, sweepTo: 2800, q: 1.5 }),
  restore: (c, out) => noise(c, out, { length: 0.16, level: 0.3, filter: 1800, sweepTo: 900, q: 1.5 }),
  // emptying the Recycle Bin: crumpled paper
  recycle: (c, out) => {
    for (let i = 0; i < 9; i++) noise(c, out, { start: i * 0.045 + Math.random() * 0.02, length: 0.08, level: 0.3, filter: 1500 + Math.random() * 3000, q: 2 })
  },
  // shutting down: a falling arpeggio
  exit: (c, out) => {
    ;[783.99, 622.25, 466.16, 311.13].forEach((f, i) => tone(c, out, { freq: f, start: i * 0.16, length: 1.4 - i * 0.2, type: "sine", level: 0.3 }))
    tone(c, out, { freq: 155.56, start: 0.1, length: 1.6, type: "triangle", level: 0.15 })
  },
}

export const playSystemSound = (name) => {
  if (!getSettings().systemSounds || !SOUNDS[name]) return
  const c = audio()
  if (!c) return
  const out = c.createGain()
  out.gain.value = 0.6
  out.connect(c.destination)
  SOUNDS[name](c, out)
}
