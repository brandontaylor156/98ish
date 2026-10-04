// The frame clock for games (pure, tested in frameClock.test.js).
//
// A game's frame loop asks it how much real time passed since the last frame. The rules:
// - `last` is kept from frame to frame. Only reset() forgets it: call that when the loop
//   starts again after a stop (start, resume, a resize from zero, a restored WebGL context,
//   the tab coming back), never on every frame (that made every frame count as 16 ms, so a
//   game ran at half speed at 30 fps and double speed at 120 Hz).
// - The first frame after a reset counts as one ordinary frame (`firstMs`), and `first` is
//   true for it (cameras snap instead of easing).
// - A long frame is clamped to `maxMs` (a stall slows the game a moment instead of
//   teleporting it), and time never runs backwards.
export const FRAME_MS = 1000 / 60
export const MAX_FRAME_MS = 100

export const createFrameClock = ({ maxMs = MAX_FRAME_MS, firstMs = FRAME_MS } = {}) => {
  let last = -1
  const clock = {
    first: true,
    // the real time (ms) this frame stands for; now is the rAF timestamp
    tick(now) {
      clock.first = last < 0
      const ms = clock.first ? firstMs : Math.min(maxMs, Math.max(0, now - last))
      last = now
      return ms
    },
    reset() {
      last = -1
    },
    get running() {
      return last >= 0
    },
  }
  return clock
}

// How many equal sub-steps a variable-step simulation needs so none is longer than maxStep
// (seconds). Each sub-step is seconds / n.
export const substeps = (seconds, maxStep) => (seconds > 0 && maxStep > 0 ? Math.max(1, Math.ceil(seconds / maxStep - 1e-9)) : 1)
