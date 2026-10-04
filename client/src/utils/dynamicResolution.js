// Dynamic resolution for the WebGL games (pure, tested in dynamicResolution.test.js).
//
// Feed it every frame's real interval (from frameClock) and the main-thread work that frame
// took; every `windowMs` it decides whether to change the pixel ratio:
// - the target is one display frame: 16.7 ms, or 33.3 ms on a device capped at 30 fps (an
//   iPhone in Low Power Mode): steady ~33 ms frames with little work in them. Dropping
//   resolution can't beat a cap, so it doesn't try.
// - slower than the target by 15% over a window: one step down (never below `min`, 1.0 by
//   default: under one pixel per CSS pixel looks worse than a few dropped frames).
// - on target with spare time for `upAfter` windows in a row: one step back up, and twice as
//   long before retrying the ratio that was just too slow (so it doesn't flip-flop).
export const createResolution = ({ max = 1, min = 1, step = 0.25, windowMs = 2000, upAfter = 3 } = {}) => {
  let ratio = Math.max(min, max)
  let top = ratio
  let sum = 0
  let work = 0
  let n = 0
  let quick = 0
  let good = 0
  let failed = Infinity // the ratio that was last too slow
  let capped = false
  const clear = () => {
    sum = 0
    work = 0
    n = 0
    quick = 0
  }
  const res = {
    get ratio() {
      return ratio
    },
    get target() {
      return capped ? 1000 / 30 : 1000 / 60
    },
    get capped() {
      return capped
    },
    // a frame: its interval and work (ms). Returns true when the ratio changed.
    frame(intervalMs, workMs = 0) {
      if (!(intervalMs > 0)) return false
      sum += intervalMs
      work += workMs
      n++
      if (intervalMs < 25) quick++
      if (sum < windowMs) return false
      const avg = sum / n
      const busy = work / n
      capped = quick / n < 0.1 && avg > 28 && avg < 40 && busy < 14
      const target = res.target
      clear()
      if (avg > target * 1.15) {
        good = 0
        if (ratio <= min) return false
        failed = ratio
        ratio = Math.max(min, ratio - step)
        return true
      }
      if (avg <= target * 1.06 && busy < target * 0.55 && ratio < top) {
        good++
        if (good < (ratio + step >= failed ? upAfter * 2 : upAfter)) return false
        good = 0
        ratio = Math.min(top, ratio + step)
        return true
      }
      good = 0
      return false
    },
    // a new ceiling (a quality change): start from it
    setMax(next) {
      top = Math.max(min, next)
      ratio = top
      failed = Infinity
      good = 0
      clear()
    },
    // forget the window in progress (after a pause or anything else that stalls a frame)
    reset() {
      clear()
    },
  }
  return res
}
