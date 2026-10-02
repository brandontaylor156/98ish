import { getSettings, masterGain } from "./settings"

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

// "Achievement unlocked" / ta-da: a quick rising fanfare
SOUNDS.tada = (c, out) => {
  ;[523.25, 659.25, 783.99].forEach((f, i) => tone(c, out, { freq: f, start: i * 0.07, length: 0.35, type: "triangle", level: 0.25 }))
  ;[1046.5, 1318.5].forEach((f) => tone(c, out, { freq: f, start: 0.22, length: 0.9, type: "sine", level: 0.2 }))
}

// ---- sound schemes (Desktop Themes): each gives every event its own flavor ----

const each = (list, fn) => list.forEach(fn)

const SCHEME_SOUNDS = {
  // Space: sci-fi blips, sweeps and a warp-out
  space: {
    ding: (c, out) => {
      tone(c, out, { freq: 880, to: 1760, length: 0.25, type: "sine", level: 0.3 })
      tone(c, out, { freq: 1760, start: 0.12, length: 0.6, level: 0.18 })
    },
    chord: (c, out) => each([440, 554.37, 659.25], (f, i) => tone(c, out, { freq: f * 2, to: f, start: i * 0.06, length: 0.7, type: "triangle", level: 0.18 })),
    critical: (c, out) => {
      tone(c, out, { freq: 300, to: 60, length: 0.6, type: "sawtooth", level: 0.1 })
      tone(c, out, { freq: 310, to: 62, length: 0.6, type: "square", level: 0.06 })
    },
    minimize: (c, out) => tone(c, out, { freq: 1600, to: 200, length: 0.22, type: "sine", level: 0.25 }),
    maximize: (c, out) => tone(c, out, { freq: 200, to: 1600, length: 0.22, type: "sine", level: 0.25 }),
    restore: (c, out) => tone(c, out, { freq: 900, to: 500, length: 0.16, type: "sine", level: 0.22 }),
    recycle: (c, out) => {
      noise(c, out, { length: 0.6, level: 0.3, filter: 300, sweepTo: 4000, q: 3 })
      tone(c, out, { freq: 120, to: 40, length: 0.6, type: "triangle", level: 0.2 })
    },
    exit: (c, out) => {
      tone(c, out, { freq: 1200, to: 60, length: 1.6, type: "sawtooth", level: 0.08 })
      tone(c, out, { freq: 600, to: 30, length: 1.8, type: "sine", level: 0.25 })
    },
    tada: (c, out) => each([523.25, 783.99, 1046.5, 1567.98], (f, i) => tone(c, out, { freq: f, to: f * 1.01, start: i * 0.08, length: 0.6, type: "sine", level: 0.2 })),
  },
  // Underwater: bubbles and soft sonar pings
  ocean: {
    ding: (c, out) => {
      tone(c, out, { freq: 1046.5, length: 1.4, level: 0.3 })
      tone(c, out, { freq: 1050, start: 0.35, length: 1.2, level: 0.1 })
    },
    chord: (c, out) => each([0, 1, 2], (i) => tone(c, out, { freq: 300 + i * 120, to: 900 + i * 300, start: i * 0.09, length: 0.12, level: 0.3 })),
    critical: (c, out) => tone(c, out, { freq: 160, to: 90, length: 0.9, type: "sine", level: 0.4 }),
    minimize: (c, out) => tone(c, out, { freq: 700, to: 250, length: 0.18, level: 0.3 }),
    maximize: (c, out) => tone(c, out, { freq: 250, to: 900, length: 0.15, level: 0.3 }),
    restore: (c, out) => tone(c, out, { freq: 500, to: 800, length: 0.1, level: 0.28 }),
    recycle: (c, out) => {
      for (let i = 0; i < 8; i++) tone(c, out, { freq: 300 + Math.random() * 500, to: 900 + Math.random() * 900, start: i * 0.06, length: 0.09, level: 0.22 })
    },
    exit: (c, out) => {
      each([659.25, 523.25, 392, 329.63], (f, i) => tone(c, out, { freq: f, start: i * 0.22, length: 1.2, level: 0.22 }))
      noise(c, out, { length: 1.4, level: 0.12, filter: 400, q: 0.5 })
    },
    tada: (c, out) => each([0, 1, 2, 3, 4], (i) => tone(c, out, { freq: 400 + i * 150, to: 1200 + i * 200, start: i * 0.06, length: 0.12, level: 0.25 })),
  },
  // Sunset Grid: detuned synth chords
  synth: {
    ding: (c, out) => each([0, 7], (d) => tone(c, out, { freq: 987.77 * (1 + d / 1000), length: 0.7, type: "sawtooth", level: 0.07 })),
    chord: (c, out) => each([349.23, 440, 523.25, 659.25], (f) => {
      tone(c, out, { freq: f, length: 1.2, type: "sawtooth", level: 0.05, attack: 0.08 })
      tone(c, out, { freq: f * 1.006, length: 1.2, type: "sawtooth", level: 0.05, attack: 0.08 })
    }),
    critical: (c, out) => each([0, 0.2], (s) => tone(c, out, { freq: 110, to: 98, start: s, length: 0.3, type: "sawtooth", level: 0.1 })),
    minimize: (c, out) => tone(c, out, { freq: 1200, to: 300, length: 0.2, type: "square", level: 0.06 }),
    maximize: (c, out) => tone(c, out, { freq: 300, to: 1200, length: 0.2, type: "square", level: 0.06 }),
    restore: (c, out) => tone(c, out, { freq: 700, to: 500, length: 0.14, type: "square", level: 0.06 }),
    recycle: (c, out) => noise(c, out, { length: 0.5, level: 0.3, filter: 6000, sweepTo: 200, q: 4 }),
    exit: (c, out) => each([523.25, 440, 349.23, 261.63], (f, i) => tone(c, out, { freq: f, start: i * 0.2, length: 1.2, type: "sawtooth", level: 0.06, attack: 0.05 })),
    tada: (c, out) => each([523.25, 659.25, 783.99, 1046.5], (f, i) => tone(c, out, { freq: f, start: i * 0.09, length: 0.5, type: "square", level: 0.06 })),
  },
  // Dinosaurs: stomps and growls
  dino: {
    ding: (c, out) => {
      tone(c, out, { freq: 523.25, to: 494, length: 0.5, type: "triangle", level: 0.3 })
      tone(c, out, { freq: 80, to: 50, length: 0.25, type: "sine", level: 0.4 })
    },
    chord: (c, out) => {
      tone(c, out, { freq: 140, to: 90, length: 0.7, type: "sawtooth", level: 0.12 })
      noise(c, out, { length: 0.7, level: 0.2, filter: 500, q: 2 })
    },
    critical: (c, out) => {
      tone(c, out, { freq: 90, to: 55, length: 1, type: "sawtooth", level: 0.15 })
      noise(c, out, { length: 1, level: 0.25, filter: 300, sweepTo: 150, q: 3 })
    },
    minimize: (c, out) => tone(c, out, { freq: 120, to: 50, length: 0.2, type: "sine", level: 0.5 }),
    maximize: (c, out) => tone(c, out, { freq: 60, to: 140, length: 0.2, type: "sine", level: 0.5 }),
    restore: (c, out) => tone(c, out, { freq: 90, to: 70, length: 0.15, type: "sine", level: 0.45 }),
    recycle: (c, out) => each([0, 0.25, 0.5], (s) => {
      tone(c, out, { freq: 70, to: 40, start: s, length: 0.2, type: "sine", level: 0.5 })
      noise(c, out, { start: s, length: 0.12, level: 0.25, filter: 200, q: 1 })
    }),
    exit: (c, out) => {
      tone(c, out, { freq: 220, to: 70, length: 1.6, type: "sawtooth", level: 0.12 })
      noise(c, out, { length: 1.6, level: 0.18, filter: 700, sweepTo: 150, q: 2 })
    },
    tada: (c, out) => each([261.63, 329.63, 392, 523.25], (f, i) => tone(c, out, { freq: f, start: i * 0.1, length: 0.5, type: "triangle", level: 0.25 })),
  },
}

export const SOUND_SCHEMES = [
  { id: "classic", label: "98ish Default" },
  { id: "space", label: "Space" },
  { id: "ocean", label: "Underwater" },
  { id: "synth", label: "Synthwave" },
  { id: "dino", label: "Dinosaurs" },
]

// the events, for previews (Desktop Themes)
export const SOUND_EVENTS = [
  { id: "ding", label: "Default sound" },
  { id: "chord", label: "Exclamation" },
  { id: "critical", label: "Critical Stop" },
  { id: "minimize", label: "Minimize" },
  { id: "maximize", label: "Maximize" },
  { id: "recycle", label: "Empty Recycle Bin" },
  { id: "tada", label: "Achievement" },
  { id: "exit", label: "Exit Windows" },
]

const play = (name, scheme) => {
  const sound = SCHEME_SOUNDS[scheme]?.[name] || SOUNDS[name]
  const gain = masterGain()
  if (!sound || !gain) return
  const c = audio()
  if (!c) return
  const out = c.createGain()
  out.gain.value = 0.6 * gain
  out.connect(c.destination)
  sound(c, out)
}

export const playSystemSound = (name) => {
  if (!getSettings().systemSounds) return
  play(name, getSettings().soundScheme)
}

// plays even with system sounds off (Desktop Themes' preview, the volume slider)
export const previewSound = (name, scheme = getSettings().soundScheme) => play(name, scheme)
