// Timing for Shred 98: hit windows, the song clock and lag calibration. Pure (no DOM, no
// audio), so the numbers can be tested in Node.
//
// Everything is timed off the audio clock. The song plays on AudioContext.currentTime;
// `createClock` turns a performance.now() moment (a key press, a frame) into "song time as
// heard", using the output timestamps the audio system reports. Then two calibrated lags
// shift it: `audio` (how late you hear and react: applied to judging) and `video` (how late
// the screen shows things: notes are drawn that much ahead).

// Hit windows: seconds either side of the note, per difficulty
export const WINDOWS = {
  easy: { perfect: 0.045, great: 0.09, good: 0.14 },
  medium: { perfect: 0.04, great: 0.08, good: 0.13 },
  hard: { perfect: 0.035, great: 0.07, good: 0.115 },
  expert: { perfect: 0.03, great: 0.06, good: 0.1 },
}

export const JUDGEMENTS = ["perfect", "great", "good"]

// "perfect" | "great" | "good" for a hit `delta` seconds off, or null (outside the window)
export const judge = (delta, w) => {
  const d = Math.abs(delta)
  if (d <= w.perfect) return "perfect"
  if (d <= w.great) return "great"
  if (d <= w.good) return "good"
  return null
}

// ---------- the clock ----------

// Maps performance.now() (ms) to AudioContext time (s) as heard at the speakers. Feed it
// samples of { contextTime, performanceTime } (AudioContext.getOutputTimestamp), or, where
// that's missing, currentTime minus the output latency at the moment `now`. The offset is
// smoothed so frame-to-frame jitter doesn't shake the notes, and snaps on a real jump
// (the context was suspended, a tab woke up).
export const createClock = ({ smoothing = 0.06, snap = 0.04 } = {}) => ({ offset: null, smoothing, snap })

export const clockSample = (clock, heardContextTime, atPerfMs) => {
  const sample = heardContextTime - atPerfMs / 1000
  if (clock.offset === null || Math.abs(sample - clock.offset) > clock.snap) clock.offset = sample
  else clock.offset += (sample - clock.offset) * clock.smoothing
  return clock.offset
}

// Context time heard at a performance.now() moment
export const heardAt = (clock, perfMs) => (clock.offset === null ? null : perfMs / 1000 + clock.offset)

// ---------- calibration ----------

export const CAL_DEFAULT = { audio: 0, video: 0 } // milliseconds
export const CAL_RANGE = [-150, 400]

// Seconds to add to "song time as heard" to get the time you meant to play at
export const inputShift = (cal) => -(cal?.audio || 0) / 1000
// Seconds to add to "song time as heard" for drawing (notes drawn ahead by the screen lag)
export const drawShift = (cal) => ((cal?.video || 0) - (cal?.audio || 0)) / 1000

// From taps (ms) and the beats they were aiming at (ms): pairs each tap with its nearest
// beat, drops wild ones, and returns the median offset (positive: you tap late). Needs at
// least `min` good taps; null otherwise.
export const calibrate = (taps, beats, { min = 5, maxOff = 300 } = {}) => {
  if (!beats.length) return null
  const offs = []
  for (const t of taps) {
    let best = null
    for (const b of beats) if (best === null || Math.abs(t - b) < Math.abs(t - best)) best = b
    const d = t - best
    if (Math.abs(d) <= maxOff) offs.push(d)
  }
  if (offs.length < min) return null
  offs.sort((a, b) => a - b)
  const mid = offs.length >> 1
  const median = offs.length % 2 ? offs[mid] : (offs[mid - 1] + offs[mid]) / 2
  const spread = offs.map((d) => Math.abs(d - median)).sort((a, b) => a - b)[mid]
  const clamp = (v) => Math.min(CAL_RANGE[1], Math.max(CAL_RANGE[0], v))
  return { offset: clamp(Math.round(median)), spread: Math.round(spread), taps: offs.length }
}
