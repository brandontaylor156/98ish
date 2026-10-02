// The page's one AudioContext for the Media Player, kept apart from the synth so opening
// a song from My Computer can wake audio (inside the click, as iOS requires) without
// loading the whole player.

let shared = null

const AudioContextClass = () => (typeof window === "undefined" ? null : window.AudioContext || window.webkitAudioContext)

export const getContext = () => {
  if (shared && shared.state !== "closed") return shared
  const AC = AudioContextClass()
  if (!AC) return null
  shared = new AC({ latencyHint: "playback" })
  // iOS: play through the ringer switch, like a music app
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback"
  } catch {}
  return shared
}

// Call from inside a tap/click handler: iOS only lets audio start during a user gesture.
// A one-sample silent buffer is the traditional way to wake older iOS versions.
export const unlockAudio = () => {
  const ctx = getContext()
  if (!ctx) return null
  try {
    if (ctx.state !== "running") ctx.resume()
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start(0)
  } catch {}
  return ctx
}

// the last player out turns off the sound card
export const releaseContext = (ctx) => {
  if (shared !== ctx) return
  shared = null
  ctx.close().catch(() => {})
}
