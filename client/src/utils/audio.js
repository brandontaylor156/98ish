import { masterGain, subscribeSettings } from "./settings.js"

// The page's sound card. Browsers only start audio after a user gesture (iOS Safari only
// inside the tap itself), suspend or "interrupt" it when the page is in the background,
// and every AudioContext holds an audio device and a thread of its own. So every sound on
// the page goes through here:
// - getAudioContext(): the one shared context for short sounds (system sounds, games)
// - createAudioContext(options) / closeAudioContext(ctx): for the players that need their
//   own (the Media Player's playback latency, Shred 98's low latency, SPECTRA's pause)
// - masterOutput(ctx): where sounds go instead of ctx.destination; follows the taskbar
//   volume and mute, live
// - unlockAudio(): wakes every context. It runs on every tap, click and key press by
//   itself, and when the page comes back to the foreground.

const contexts = new Set()
const held = new WeakSet() // suspended on purpose (a paused game): left alone
const primed = new WeakSet()
const outputs = new WeakMap()
let shared = null
let installed = false

const AudioContextClass = () => (typeof window === "undefined" ? null : window.AudioContext || window.webkitAudioContext || null)

export const audioSupported = () => !!AudioContextClass()

export const createAudioContext = (options) => {
  const AC = AudioContextClass()
  if (!AC) return null
  let ctx = null
  try {
    ctx = options ? new AC(options) : new AC()
  } catch {
    try {
      ctx = new AC()
    } catch {
      return null
    }
  }
  contexts.add(ctx)
  install()
  return ctx
}

export const closeAudioContext = (ctx) => {
  if (!ctx) return
  contexts.delete(ctx)
  if (ctx === shared) shared = null
  outputs.get(ctx)?.off()
  outputs.delete(ctx)
  if (ctx.state !== "closed") ctx.close().catch(() => {})
}

export const getAudioContext = () => {
  if (shared && shared.state !== "closed") return shared
  shared = createAudioContext()
  return shared
}

// A gain on `ctx` that follows the taskbar volume and mute; connect sounds here instead of
// to ctx.destination
export const masterOutput = (ctx = getAudioContext()) => {
  if (!ctx) return null
  let entry = outputs.get(ctx)
  if (!entry) {
    const node = ctx.createGain()
    node.gain.value = masterGain()
    node.connect(ctx.destination)
    const off = subscribeSettings((s) => {
      try {
        node.gain.setTargetAtTime(masterGain(s), ctx.currentTime, 0.015)
      } catch {
        // closed
      }
    })
    entry = { node, off }
    outputs.set(ctx, entry)
  }
  return entry.node
}

// A little mixer for one app's sounds on the shared context: a gain (and a compressor, if
// `threshold` is given) into the master output. Make one per module; calling it returns
// { ctx, out } (built on first use, the context woken), or null without Web Audio.
export const createBus = ({ gain = 1, threshold = null } = {}) => {
  let bus = null
  return () => {
    const ctx = getAudioContext()
    if (!ctx) return null
    if (!bus || bus.ctx !== ctx) {
      const out = ctx.createGain()
      out.gain.value = gain
      let last = out
      if (threshold !== null) {
        const comp = ctx.createDynamicsCompressor()
        comp.threshold.value = threshold
        last = out.connect(comp)
      }
      last.connect(masterOutput(ctx))
      bus = { ctx, out }
    }
    wake(ctx)
    return bus
  }
}

// iOS: while a music player is open, play through the ringer switch like a music app
// (otherwise the switch silences web audio). Returns the release.
let musicPlayers = 0
const setSession = (type) => {
  try {
    if (typeof navigator !== "undefined" && navigator.audioSession) navigator.audioSession.type = type
  } catch {
    // not supported
  }
}
export const claimPlaybackSession = () => {
  musicPlayers++
  setSession("playback")
  let released = false
  return () => {
    if (released) return
    released = true
    musicPlayers = Math.max(0, musicPlayers - 1)
    if (!musicPlayers) setSession("auto")
  }
}

// Pause a context on purpose (and let it be): unlockAudio won't wake it
export const holdAudioContext = (ctx) => {
  if (!ctx || ctx.state === "closed") return
  held.add(ctx)
  if (ctx.state === "running") ctx.suspend().catch(() => {})
}

export const releaseAudioContext = (ctx) => {
  if (!ctx) return
  held.delete(ctx)
  wake(ctx)
}

const wake = (ctx) => {
  if (ctx.state === "closed") {
    contexts.delete(ctx)
    return
  }
  if (ctx.state !== "running" && !held.has(ctx)) ctx.resume().catch(() => {})
}

// Wake every context. Inside a gesture this is what unlocks audio; older iOS also wants
// a sound started during the gesture, so each context plays one silent sample once.
export const unlockAudio = () => {
  for (const ctx of [...contexts]) {
    wake(ctx)
    if (primed.has(ctx) || ctx.state === "closed") continue
    try {
      const src = ctx.createBufferSource()
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
      src.connect(ctx.destination)
      src.start(0)
      primed.add(ctx)
    } catch {
      // try again on the next gesture
    }
  }
}

const install = () => {
  if (installed || typeof window === "undefined") return
  installed = true
  const opts = { capture: true, passive: true }
  // the events browsers count as a user gesture (touchend for iOS)
  for (const type of ["pointerdown", "pointerup", "touchend", "mousedown", "keydown", "click"]) window.addEventListener(type, unlockAudio, opts)
  // back from the background (iOS marks contexts "interrupted" or suspends them)
  const back = () => {
    if (document.visibilityState === "visible") for (const ctx of [...contexts]) wake(ctx)
  }
  document.addEventListener("visibilitychange", back)
  window.addEventListener("pageshow", back)
  window.addEventListener("focus", back)
}

// for tests: how many contexts are open
export const openContexts = () => [...contexts].filter((c) => c.state !== "closed").length
