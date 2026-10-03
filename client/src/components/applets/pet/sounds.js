import { getSettings, masterGain } from "../../../utils/settings"

// Our Pet's little noises, made on the spot with Web Audio (no sound files). Quiet when
// system sounds are off or the speaker is muted.

let ctx = null
const out = (level) => {
  const settings = getSettings()
  const volume = masterGain(settings)
  if (!settings.systemSounds || !volume) return null
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === "suspended") ctx.resume().catch(() => {})
    const gain = ctx.createGain()
    gain.gain.value = level * volume
    gain.connect(ctx.destination)
    return gain
  } catch {
    return null
  }
}

// one soft note: frequency (or [from, to] for a slide), start, length, wave
const note = (dest, freq, at, length, type = "sine", peak = 0.5) => {
  const t = ctx.currentTime + at
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  const [from, to] = Array.isArray(freq) ? freq : [freq, freq]
  osc.frequency.setValueAtTime(from, t)
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + length)
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(peak, t + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0008, t + length)
  osc.connect(gain).connect(dest)
  osc.start(t)
  osc.stop(t + length + 0.05)
}

const SOUNDS = {
  // a happy little "chirrup"
  chirp: (d) => {
    note(d, [620, 1180], 0, 0.14, "sine")
    note(d, [880, 1560], 0.13, 0.16, "sine")
  },
  // nom nom nom
  chomp: (d) => {
    for (let i = 0; i < 3; i++) {
      note(d, [260, 150], i * 0.16, 0.09, "triangle", 0.7)
      note(d, [900, 500], i * 0.16, 0.05, "square", 0.05)
    }
  },
  // a squeaky toy for cuddles
  squeak: (d) => {
    note(d, [900, 1500], 0, 0.1, "sine", 0.45)
    note(d, [1500, 1100], 0.1, 0.12, "sine", 0.35)
  },
  bubble: (d) => {
    const f = 700 + Math.random() * 600
    note(d, [f, f * 1.9], 0, 0.08, "sine", 0.4)
  },
  sparkle: (d) => [1318.5, 1568, 2093, 2637].forEach((f, i) => note(d, f, i * 0.07, 0.4, "sine", 0.22)),
  catch: (d) => note(d, [700 + Math.random() * 200, 1400], 0, 0.09, "square", 0.08),
  heart: (d) => [784, 1046.5, 1318.5].forEach((f, i) => note(d, f, i * 0.06, 0.25, "triangle", 0.3)),
  // a lullaby for lights out
  lullaby: (d) => [[659.25, 0], [523.25, 0.32], [587.33, 0.64], [392, 0.96], [523.25, 1.4]].forEach(([f, t]) => note(d, f, t, 0.55, "sine", 0.3)),
  // the family fanfare
  family: (d) => [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.4], [987.77, 0.62], [1046.5, 0.76]].forEach(([f, t]) => note(d, f, t, 0.5, "triangle", 0.3)),
  pop: (d) => note(d, [500, 160], 0, 0.12, "sine", 0.5),
  whistle: (d) => note(d, [500, 1200], 0, 0.5, "sine", 0.25),
}

export const playPetSound = (name) => {
  const levels = { chomp: 0.5, bubble: 0.35, catch: 0.5 }
  const dest = out(levels[name] ?? 0.4)
  if (!dest) return
  try {
    SOUNDS[name]?.(dest)
  } catch {
    // no sound card: the hearts will have to do
  }
}
