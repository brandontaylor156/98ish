// Music 98's player, kept outside React so music keeps playing while its window is minimized
// or you're in another program (closing the window stops it, like the real thing).
//
// Two <audio> elements: one playing, one loading the next song a little before the end, so
// the next starts the moment this one ends ("gapless-ish"). The phone's lock screen and
// Control Center show the song through the Media Session API, with play/pause/next/previous.
// Volume follows the taskbar (on iPhone the side buttons set it: Safari ignores page volume).
// Equalizer and visualizer (More options) route the sound through Web Audio.

import { claimPlaybackSession, createAudioContext, masterOutput, closeAudioContext } from "../../../utils/audio"
import { masterGain, subscribeSettings } from "../../../utils/settings"
import { mediaBlob } from "../../../utils/fs"
import { albumOf, artistOf, makeQueue, nextPos, prevPos, reshuffle, insertNext, append, dropKey, titleOf } from "./library"
import { getArt, getPrefs, setPrefs, trackFor } from "./musicStore"

const PRELOAD_S = 20 // start loading the next song this long before the end

const listeners = new Set()
let snap = { queue: { keys: [], order: [], pos: 0 }, key: null, track: null, playing: false, time: 0, duration: 0, loading: false, error: null, art: null }
const set = (patch) => {
  snap = { ...snap, ...patch }
  listeners.forEach((fn) => fn())
}
export const subscribePlayer = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const playerSnapshot = () => snap

// ---- the audio elements ----

let els = null
let active = 0 // which of els plays
const urls = [null, null] // blob URLs held by each element
const keysIn = [null, null] // the song key each element has loaded
let releaseSession = null
let offSettings = null

const elements = () => {
  if (els) return els
  els = [new Audio(), new Audio()]
  for (const [i, el] of els.entries()) {
    el.preload = "auto"
    el.setAttribute("playsinline", "")
    el.addEventListener("timeupdate", () => i === active && onTime())
    el.addEventListener("durationchange", () => i === active && set({ duration: finite(el.duration) }))
    el.addEventListener("ended", () => i === active && onEnded())
    el.addEventListener("play", () => i === active && set({ playing: true }))
    el.addEventListener("pause", () => i === active && !el.ended && set({ playing: false }))
    el.addEventListener("waiting", () => i === active && set({ loading: true }))
    el.addEventListener("playing", () => i === active && set({ loading: false, playing: true }))
    el.addEventListener("error", () => i === active && keysIn[i] && set({ error: "This song can't be played in this browser.", loading: false, playing: false }))
  }
  applyVolume()
  offSettings = subscribeSettings(() => applyVolume())
  return els
}
const finite = (n) => (Number.isFinite(n) ? n : 0)
const cur = () => elements()[active]
const other = () => elements()[1 - active]

const applyVolume = () => {
  if (!els) return
  // routed through Web Audio: the master output does the volume
  const g = graph ? 1 : masterGain()
  for (const el of els) {
    el.volume = Math.max(0, Math.min(1, g))
    el.muted = masterGain() === 0
  }
}

// a song's file -> a blob URL the element can play
const loadInto = async (index, key) => {
  if (keysIn[index] === key && urls[index]) return true
  const track = trackFor(key)
  if (!track) return false
  // a data URL or a big song kept as a Blob on this device (never a copy in memory)
  const blob = await mediaBlob(track.file)
  if (!blob) return false
  if (urls[index]) URL.revokeObjectURL(urls[index])
  urls[index] = URL.createObjectURL(blob)
  keysIn[index] = key
  elements()[index].src = urls[index]
  return true
}

const unload = (index) => {
  const el = elements()[index]
  el.pause()
  el.removeAttribute("src")
  try {
    el.load()
  } catch {
    // fine
  }
  if (urls[index]) URL.revokeObjectURL(urls[index])
  urls[index] = null
  keysIn[index] = null
}

// ---- Media Session (lock screen, Control Center, headphones) ----

const ms = () => (typeof navigator !== "undefined" && navigator.mediaSession ? navigator.mediaSession : null)
const setMetadata = (track, art) => {
  const session = ms()
  if (!session || typeof MediaMetadata === "undefined") return
  try {
    session.metadata = new MediaMetadata({
      title: titleOf(track),
      artist: artistOf(track),
      album: albumOf(track),
      artwork: art ? [{ src: art, sizes: "256x256", type: "image/jpeg" }] : [{ src: "/assets/program_icons/music98.svg", sizes: "any", type: "image/svg+xml" }],
    })
  } catch {
    // older browsers
  }
  // set again with each song: Media Player may have taken the lock screen controls meanwhile
  const on = (action, fn) => {
    try {
      session.setActionHandler(action, fn)
    } catch {
      // not supported
    }
  }
  on("play", () => resume())
  on("pause", () => pause())
  on("previoustrack", () => prev())
  on("nexttrack", () => next())
  on("seekto", (d) => d?.seekTime != null && seek(d.seekTime))
  on("seekbackward", (d) => seek(Math.max(0, cur().currentTime - (d?.seekOffset || 10))))
  on("seekforward", (d) => seek(cur().currentTime + (d?.seekOffset || 10)))
  on("stop", () => stop())
}
let lastPosition = 0
const positionState = (force = false) => {
  const session = ms()
  if (!session?.setPositionState) return
  const now = Date.now()
  if (!force && now - lastPosition < 4000) return
  lastPosition = now
  const el = cur()
  const duration = finite(el.duration)
  if (!duration) return
  try {
    session.setPositionState({ duration, playbackRate: el.playbackRate || 1, position: Math.min(duration, el.currentTime) })
  } catch {
    // bad numbers
  }
}

// ---- playing ----

const start = async (pos, { autoplay = true } = {}) => {
  const q = snap.queue
  const key = q.order[pos]
  if (key == null) return stop()
  const track = trackFor(key)
  if (!track) {
    // gone from the drive: skip it
    const queue = dropKey(q, key)
    set({ queue })
    return queue.order.length ? start(Math.min(pos, queue.order.length - 1), { autoplay }) : stop()
  }
  set({ queue: { ...q, pos }, key, track, loading: true, error: null, time: 0, duration: track.duration || 0 })
  // the next song may already be waiting in the other element
  if (keysIn[1 - active] === key && urls[1 - active]) {
    cur().pause()
    active = 1 - active
  } else if (!(await loadInto(active, key))) {
    return set({ loading: false, error: "That song couldn't be opened." })
  }
  if (snap.key !== key) return // something else was picked meanwhile
  const el = cur()
  other().pause()
  try {
    el.currentTime = 0
  } catch {
    // not seekable yet
  }
  const art = track.art ? await getArt(track.art) : null
  set({ art })
  setMetadata(track, art)
  if (autoplay) await play()
  else set({ loading: false })
}

const play = async () => {
  const el = cur()
  if (!el.src) return
  releaseSession ||= claimPlaybackSession() // iPhone: play through the ringer switch
  if (graph?.ctx.state === "suspended") graph.ctx.resume().catch(() => {})
  try {
    await el.play()
    set({ playing: true, loading: false })
    if (ms()) ms().playbackState = "playing"
  } catch (error) {
    set({ playing: false, loading: false, error: error?.name === "NotAllowedError" ? "Tap Play to start the music." : "This song can't be played in this browser." })
  }
}

const onTime = () => {
  const el = cur()
  set({ time: el.currentTime })
  positionState()
  // load the next song ahead of time
  const duration = finite(el.duration)
  if (duration && duration - el.currentTime < PRELOAD_S) {
    const n = nextPos(snap.queue, getPrefs().repeat, true)
    const key = n === null ? null : snap.queue.order[n]
    if (key != null && key !== snap.key && keysIn[1 - active] !== key) loadInto(1 - active, key).catch(() => {})
  }
}

const onEnded = () => {
  const n = nextPos(snap.queue, getPrefs().repeat, true)
  if (n === null) {
    set({ playing: false, time: 0 })
    if (ms()) ms().playbackState = "paused"
    return
  }
  if (n === snap.queue.pos) {
    // repeat one
    cur().currentTime = 0
    play()
    return
  }
  start(n)
}

// ---- the controls ----

// play a list, starting at `startKey`
export const playList = (keys, startKey = null) => {
  elements()
  const queue = makeQueue(keys, startKey, getPrefs().shuffle)
  set({ queue })
  return start(queue.pos)
}
export const resume = () => (snap.key ? play() : snap.queue.order.length ? start(snap.queue.pos) : null)
export const pause = () => {
  if (!els) return
  cur().pause()
  set({ playing: false })
  if (ms()) ms().playbackState = "paused"
}
export const toggle = () => (snap.playing ? pause() : resume())
export const next = () => {
  const n = nextPos(snap.queue, getPrefs().repeat === "one" ? "all" : getPrefs().repeat)
  if (n !== null) start(n)
}
export const prev = () => {
  const p = prevPos(snap.queue, els ? cur().currentTime : 0, getPrefs().repeat)
  if (p === null) return
  if (p === snap.queue.pos) seek(0)
  else start(p)
}
export const seek = (t) => {
  if (!els) return
  try {
    cur().currentTime = Math.max(0, t)
  } catch {
    // not ready
  }
  set({ time: cur().currentTime })
  positionState(true)
}
export const jumpTo = (pos) => start(pos)
export const playNext = (key) => set({ queue: insertNext(snap.queue, key) })
export const addToQueue = (key) => set({ queue: append(snap.queue, key) })
export const setShuffle = (on) => {
  setPrefs({ shuffle: !!on })
  set({ queue: reshuffle(snap.queue, !!on) })
}
export const cycleRepeat = () => {
  const order = ["off", "all", "one"]
  const r = order[(order.indexOf(getPrefs().repeat) + 1) % 3]
  setPrefs({ repeat: r })
  set({})
  return r
}
// a song was deleted
export const forget = (key) => {
  if (snap.key === key) stop()
  set({ queue: dropKey(snap.queue, key) })
}

export const stop = () => {
  if (els) {
    unload(0)
    unload(1)
  }
  releaseSession?.()
  releaseSession = null
  set({ playing: false, key: null, track: null, time: 0, duration: 0, loading: false, art: null })
  const session = ms()
  if (session) {
    session.playbackState = "none"
    try {
      session.metadata = null
    } catch {
      // fine
    }
  }
}

// the window closed: stop and let go of the sound card
export const shutDown = () => {
  stop()
  set({ queue: { keys: [], order: [], pos: 0 } })
  if (graph) {
    closeAudioContext(graph.ctx)
    graph = null
    // elements wired into a closed context can't play again: make fresh ones next time
    offSettings?.()
    els = null
    active = 0
  }
}

// ---- equalizer + visualizer (Web Audio) ----

let graph = null // { ctx, low, mid, high, analyser }
const ensureGraph = () => {
  if (graph) return graph
  elements()
  const ctx = createAudioContext({ latencyHint: "playback" })
  if (!ctx) return null
  const low = ctx.createBiquadFilter()
  low.type = "lowshelf"
  low.frequency.value = 120
  const mid = ctx.createBiquadFilter()
  mid.type = "peaking"
  mid.frequency.value = 1000
  mid.Q.value = 0.8
  const high = ctx.createBiquadFilter()
  high.type = "highshelf"
  high.frequency.value = 7000
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 128
  analyser.smoothingTimeConstant = 0.75
  low.connect(mid).connect(high).connect(analyser).connect(masterOutput(ctx))
  for (const el of els) {
    try {
      ctx.createMediaElementSource(el).connect(low)
    } catch {
      // already wired
    }
  }
  graph = { ctx, low, mid, high, analyser }
  applyVolume()
  return graph
}

export const applyEq = (eq = getPrefs().eq) => {
  if (!eq.on && !graph) return
  const g = ensureGraph()
  if (!g) return
  const v = (x) => (eq.on ? Math.max(-12, Math.min(12, Number(x) || 0)) : 0)
  g.low.gain.value = v(eq.low)
  g.mid.gain.value = v(eq.mid)
  g.high.gain.value = v(eq.high)
}

// visualizer bars (0..1), or null when it isn't running
const bins = new Uint8Array(64)
export const levels = (count = 24) => {
  if (!graph) return null
  graph.analyser.getByteFrequencyData(bins)
  const out = []
  const usable = Math.floor(bins.length * 0.8)
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i / count) ** 1.6 * usable)
    const to = Math.max(from + 1, Math.floor(((i + 1) / count) ** 1.6 * usable))
    let m = 0
    for (let j = from; j < to; j++) m = Math.max(m, bins[j])
    out.push(m / 255)
  }
  return out
}
export const startVisualizer = () => ensureGraph()

// tests and the dev console
if (typeof window !== "undefined") window.__music = { snapshot: () => snap, playList, pause, resume, next, prev, seek, stop }
