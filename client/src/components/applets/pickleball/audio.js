// Pickleball 98's sounds, synthesized (no audio files): the hollow "pock" of a paddle on a
// plastic ball, the softer tick of a bounce, the net, and a little chime for points.
// Follows the system sound setting and the taskbar volume (utils/settings.js).

import { getSettings, masterGain } from "../../../utils/settings"

export const createAudio = () => {
  let ctx = null
  let out = null
  let noise = null
  let enabled = true

  const ready = () => {
    if (!enabled || !getSettings().systemSounds) return null
    const gain = masterGain()
    if (gain <= 0) return null
    if (!ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) return null
      try {
        ctx = new AudioContext()
      } catch {
        return null
      }
      out = ctx.createGain()
      out.connect(ctx.destination)
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate)
      const d = noise.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {})
    out.gain.value = gain
    return ctx
  }

  // a burst of filtered noise plus a falling tone: the hollow plastic "pock"
  const knock = ({ freq, q, tone, toneEnd, decay, level }) => {
    const c = ready()
    if (!c) return
    const t = c.currentTime + 0.002
    const src = c.createBufferSource()
    src.buffer = noise
    const band = c.createBiquadFilter()
    band.type = "bandpass"
    band.frequency.value = freq
    band.Q.value = q
    const ng = c.createGain()
    ng.gain.setValueAtTime(level, t)
    ng.gain.exponentialRampToValueAtTime(0.001, t + decay * 0.6)
    src.connect(band).connect(ng).connect(out)
    src.start(t)
    src.stop(t + decay)
    const osc = c.createOscillator()
    osc.type = "sine"
    osc.frequency.setValueAtTime(tone, t)
    osc.frequency.exponentialRampToValueAtTime(toneEnd, t + decay)
    const og = c.createGain()
    og.gain.setValueAtTime(level * 0.55, t)
    og.gain.exponentialRampToValueAtTime(0.001, t + decay)
    osc.connect(og).connect(out)
    osc.start(t)
    osc.stop(t + decay + 0.02)
  }

  return {
    unlock() {
      ready()
    },
    setEnabled(on) {
      enabled = on
    },
    // a paddle hit; strength 0..1 (a dink is a soft tick, a drive a sharp crack)
    pock(strength = 0.5) {
      const s = Math.max(0.1, Math.min(1, strength))
      knock({ freq: 1150 + s * 500, q: 6, tone: 1250 + s * 300, toneEnd: 700, decay: 0.07 + s * 0.03, level: 0.25 + s * 0.45 })
    },
    bounce(strength = 0.5) {
      const s = Math.max(0.05, Math.min(1, strength))
      knock({ freq: 700 + s * 300, q: 4, tone: 520, toneEnd: 300, decay: 0.05, level: 0.1 + s * 0.25 })
    },
    net() {
      const c = ready()
      if (!c) return
      const t = c.currentTime
      const src = c.createBufferSource()
      src.buffer = noise
      const lp = c.createBiquadFilter()
      lp.type = "lowpass"
      lp.frequency.value = 900
      const g = c.createGain()
      g.gain.setValueAtTime(0.35, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
      src.connect(lp).connect(g).connect(out)
      src.start(t)
      src.stop(t + 0.22)
    },
    // two soft notes: up for your point, down for theirs
    chime(good) {
      const c = ready()
      if (!c) return
      const t = c.currentTime + 0.01
      const notes = good ? [659.25, 987.77] : [523.25, 392]
      notes.forEach((f, i) => {
        const o = c.createOscillator()
        o.type = "triangle"
        o.frequency.value = f
        const g = c.createGain()
        const at = t + i * 0.11
        g.gain.setValueAtTime(0.0001, at)
        g.gain.exponentialRampToValueAtTime(0.18, at + 0.015)
        g.gain.exponentialRampToValueAtTime(0.001, at + 0.3)
        o.connect(g).connect(out)
        o.start(at)
        o.stop(at + 0.32)
      })
    },
    get state() {
      return ctx?.state || "none"
    },
    dispose() {
      ctx?.close().catch(() => {})
      ctx = null
    },
  }
}
