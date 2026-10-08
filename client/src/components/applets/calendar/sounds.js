import { createBus } from "../../../utils/audio"

// Calendar and Clock sounds, synthesized on the page's shared audio context (they follow
// the taskbar volume and mute): a reminder chime, a comment blip, and four alarm sounds that
// ring until they're stopped (Stop or Snooze; at most 20 minutes).

const bus = createBus({ gain: 0.7 })

const tone = (ctx, out, { freq, start = 0, length = 0.4, type = "sine", level = 0.3 }) => {
  const t = ctx.currentTime + start
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(level, t + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0008, t + length)
  osc.connect(gain).connect(out)
  osc.start(t)
  osc.stop(t + length + 0.05)
}

export const playReminder = () => {
  const b = bus()
  if (!b) return
  ;[659.25, 880, 659.25, 880].forEach((f, i) => tone(b.ctx, b.out, { freq: f, start: i * 0.18, length: 0.5, type: "triangle", level: 0.22 }))
}

export const playNotice = () => {
  const b = bus()
  if (!b) return
  tone(b.ctx, b.out, { freq: 987.77, length: 0.18, level: 0.14 })
  tone(b.ctx, b.out, { freq: 1318.5, start: 0.09, length: 0.25, level: 0.12 })
}

// ---- alarm sounds ----
// Four original alarm sounds, synthesized here (no recordings). Each `pattern` schedules one
// round of the sound at audio time `t` into `out` and returns how long the round lasts (s);
// ringAlarm() repeats rounds until it's stopped.
const at = (ctx, out, t, freq, { length = 0.3, type = "sine", level = 0.3, attack = 0.008 } = {}) => {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(level, t + attack)
  gain.gain.exponentialRampToValueAtTime(0.0008, t + length)
  osc.connect(gain).connect(out)
  osc.start(t)
  osc.stop(t + length + 0.05)
}

export const ALARM_SOUNDS = [
  {
    id: "beeper",
    name: "Bedside Beeper",
    // the digital clock radio: four quick beeps, a breath, again
    pattern: (ctx, out, t) => {
      for (let i = 0; i < 4; i++) at(ctx, out, t + i * 0.13, 2000, { length: 0.085, type: "square", level: 0.16, attack: 0.003 })
      return 0.75
    },
  },
  {
    id: "chimes",
    name: "Sunrise Chimes",
    // a rising major arpeggio on soft bells
    pattern: (ctx, out, t) => {
      ;[523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) => {
        at(ctx, out, t + i * 0.2, f, { length: 1.1, type: "sine", level: 0.34 })
        at(ctx, out, t + i * 0.2, f * 2.01, { length: 0.5, type: "sine", level: 0.08 })
      })
      return 1.8
    },
  },
  {
    id: "bell",
    name: "Old Brass Bell",
    // a hammer bell: fast strikes with a metallic overtone
    pattern: (ctx, out, t) => {
      for (let i = 0; i < 10; i++) {
        at(ctx, out, t + i * 0.06, 1318.5, { length: 0.25, type: "triangle", level: 0.22, attack: 0.002 })
        at(ctx, out, t + i * 0.06, 3517, { length: 0.08, type: "sine", level: 0.07, attack: 0.002 })
      }
      return 1
    },
  },
  {
    id: "arcade",
    name: "8-Bit Wake Up",
    // a little chiptune fanfare
    pattern: (ctx, out, t) => {
      ;[392, 523.25, 659.25, 783.99, 659.25, 783.99].forEach((f, i) => at(ctx, out, t + i * 0.11, f, { length: 0.1, type: "square", level: 0.11, attack: 0.003 }))
      at(ctx, out, t + 0.7, 1046.5, { length: 0.35, type: "square", level: 0.11, attack: 0.003 })
      return 1.4
    },
  },
]
export const DEFAULT_ALARM_SOUND = "beeper"
export const alarmSound = (id) => ALARM_SOUNDS.find((s) => s.id === id) || ALARM_SOUNDS[0]

// Make the shared audio context exist now, so the next tap unlocks it and an alarm that rings
// later is heard (iOS won't start a context that was first made outside a tap). CalendarBridge
// calls it while any alarm or timer is set; Clock's buttons call it from their taps.
export const primeAlarmAudio = () => !!bus()

const RAMP_S = 20 // starts at 40% loudness and grows to full over 20 s
export const MAX_RING_MS = 20 * 60_000 // a forgotten alarm stops itself after 20 minutes

// Ring until stop() (or `maxMs`): rounds of the chosen sound, scheduled a little ahead so a
// busy page doesn't stutter it. A context that isn't running yet (no tap since the page
// loaded) starts ringing as soon as a tap or the page coming forward wakes it. Returns stop()
export const ringAlarm = ({ sound = DEFAULT_ALARM_SOUND, maxMs = MAX_RING_MS, ramp = true, onTimeout } = {}) => {
  const { pattern } = alarmSound(sound)
  let stopped = false
  let nextAt = 0
  let gain = null
  const pump = () => {
    if (stopped) return
    const b = bus()
    if (!b) return
    const ctx = b.ctx
    if (ctx.state !== "running") return
    if (!gain || gain.context !== ctx) {
      gain = ctx.createGain()
      gain.connect(b.out)
      const t = ctx.currentTime
      gain.gain.setValueAtTime(ramp ? 0.4 : 1, t)
      if (ramp) gain.gain.linearRampToValueAtTime(1, t + RAMP_S)
      nextAt = 0
    }
    if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + 0.05
    while (nextAt < ctx.currentTime + 0.6) nextAt += pattern(ctx, gain, nextAt) + 0.25
  }
  pump()
  const timer = setInterval(pump, 150)
  const limit = setTimeout(() => (stop(), onTimeout?.()), maxMs)
  const stop = () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    clearTimeout(limit)
    if (!gain) return
    const g = gain
    try {
      const t = g.context.currentTime
      g.gain.cancelScheduledValues(t)
      g.gain.setValueAtTime(g.gain.value, t)
      g.gain.linearRampToValueAtTime(0, t + 0.04)
    } catch {
      // closed
    }
    setTimeout(() => {
      try {
        g.disconnect()
      } catch {
        // gone
      }
    }, 120)
  }
  return stop
}

// a few seconds of a sound, for choosing one in Clock; returns stop()
export const previewAlarm = (sound) => ringAlarm({ sound, maxMs: 3200, ramp: false })
