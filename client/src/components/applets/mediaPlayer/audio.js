// The page's one AudioContext for the Media Player, kept apart from the synth so opening
// a song from My Computer can wake audio (inside the click, as iOS requires) without
// loading the whole player. It's made by utils/audio.js, which wakes it on every tap and
// when the page comes back from the background, like every other sound on the page.

import { claimPlaybackSession, closeAudioContext, createAudioContext, unlockAudio as unlockAll } from "../../../utils/audio"

let shared = null
let releaseSession = null

export const getContext = () => {
  if (shared && shared.state !== "closed") return shared
  shared = createAudioContext({ latencyHint: "playback" })
  if (!shared) return null
  // iOS: play through the ringer switch, like a music app
  releaseSession?.()
  releaseSession = claimPlaybackSession()
  return shared
}

// Call from inside a tap/click handler: iOS only lets audio start during a user gesture
export const unlockAudio = () => {
  const ctx = getContext()
  unlockAll()
  return ctx
}

// the last player out turns off the sound card
export const releaseContext = (ctx) => {
  if (shared !== ctx) return
  shared = null
  closeAudioContext(ctx)
  releaseSession?.()
  releaseSession = null
}
