import { createBus } from "../../../utils/audio"

// Calendar and Clock sounds, synthesized on the page's shared audio context (they follow
// the taskbar volume and mute): a reminder chime, a comment blip, and an alarm that rings
// until it's stopped (at most a minute).

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

// the classic digital alarm: four beeps, a pause, again. Returns stop()
export const ringAlarm = ({ maxMs = 60_000 } = {}) => {
  let stopped = false
  const ring = () => {
    if (stopped) return
    const b = bus()
    if (b) for (let i = 0; i < 4; i++) tone(b.ctx, b.out, { freq: 2048, start: i * 0.14, length: 0.09, type: "square", level: 0.07 })
  }
  ring()
  const timer = setInterval(ring, 1000)
  const limit = setTimeout(() => stop(), maxMs)
  const stop = () => {
    stopped = true
    clearInterval(timer)
    clearTimeout(limit)
  }
  return stop
}
