// Swipe controls for the playfield, like the official Tetris app on phones (pure: no DOM, no
// React, so Node can unit-test it with made-up finger paths; see gestures.test.js). The app's
// rules (PLAYSTUDIOS help center, "Tetris Controls"; docs/tetris-mobile.md): swipe left/right
// moves, tap the right side to rotate clockwise and the left side counterclockwise, swipe
// down hard drops, hold and drag down soft drops, swipe up holds.
//
//   drag sideways    the piece follows the finger, one column per cell of travel
//                    (times the sensitivity), measured from where the finger went down
//   drag down slowly soft drop: one row per cell of travel
//   flick down       hard drop (needs a fast, mostly downward finger)
//   swipe up         hold
//   tap              right half: rotate clockwise, left half: counterclockwise (as the app;
//                    tapSides: false makes every tap clockwise)
//
// How a touch is read:
// - Until the finger has moved SLOP px it may still be a tap. The first decisive movement
//   locks the drag to an axis: sideways, down or up. A sideways drag never soft drops or
//   hard drops on its own, so ending a slide with a little downward wobble does nothing.
// - The lock can change mid-drag, but only with a clear move on the other axis since the
//   last step (SWITCH cells, and twice as much as on the locked axis): slide over, then drag
//   down, in one motion. Swipe up is only read at the start of a touch.
// - Hard drop is velocity: the finger's speed over the last FLICK_WINDOW ms (from every
//   sample, so pass coalesced pointer events) must reach FLICK_VELOCITY px/ms downward and
//   be at least twice its sideways speed, while the drag is locked downward. A finger that
//   stops before lifting has no speed left, so a slow soft drop never ends in a hard drop.
// - After a hard drop or a hold, the rest of that touch is ignored. A second finger is
//   ignored too (one finger plays). The caller ends a touch early with finish() when the
//   piece it was steering locks.
//
// createGestureTracker({ act, cellWidth, cellHeight, centerX, sensitivity, tapSides })
//   act(action) runs "left" | "right" | "softDrop" | "hardDrop" | "hold" | "rotateRight" |
//   "rotateLeft" and, for moves, returns false when the piece couldn't go (a wall): the drag
//   then re-anchors under the finger, so coming back moves the piece at once instead of
//   first unwinding travel that went nowhere.
// Feed it down/move/up/cancel with { id, x, y, t } (client px, ms).

export const GESTURE = {
  SLOP: 9, // px a finger may wander and still be a tap
  TAP_MS: 500, // longest press that still counts as a tap
  FIRST_STEP: 0.65, // cells of travel for the first step on an axis (later ones: 1 cell)
  BACK_STEP: 0.35, // ...and where a step back happens (0.3 cell of hysteresis, no jitter)
  SWITCH: 1.2, // cells of travel on the other axis to change the lock
  FLICK_VELOCITY: 0.7, // px/ms downward for a hard drop (a slow drag is 0.1-0.4)
  FLICK_WINDOW: 64, // ms of samples the speed is measured over
  FLICK_MIN_DT: 12, // ms: shorter spans read the sample before (one jumpy sample isn't a flick)
  FLICK_TRAVEL: 20, // px down since the drag locked downward, at least
  HOLD_TRAVEL: 1.5, // cells up for a hold (at least HOLD_MIN_PX)
  HOLD_MIN_PX: 28,
}

export const SENSITIVITY_RANGE = [0.5, 2]

export const createGestureTracker = (options) => {
  let opts = { cellWidth: 24, cellHeight: 24, centerX: 0, sensitivity: 1, tapSides: true, ...options }
  const C = { ...GESTURE, ...options.thresholds }
  let g = null // the touch being read

  const stepX = () => Math.max(4, opts.cellWidth / opts.sensitivity)
  const stepY = () => Math.max(4, opts.cellHeight / opts.sensitivity)

  const run = (action) => opts.act?.(action)

  const lockH = (from, p) => {
    g.mode = "h"
    g.hx = from.x // the horizontal anchor
    g.pos = 0 // steps taken from it
    g.seg = { x: p.x, y: p.y }
  }
  const lockV = (from, p) => {
    g.mode = "v"
    g.vy = from.y
    g.level = -(1 - C.FIRST_STEP)
    g.vStart = from.y
    g.seg = { x: p.x, y: p.y }
  }

  const followH = (p) => {
    const f = (p.x - g.hx) / stepX()
    for (let guard = 0; guard < 40; guard++) {
      const dir = f >= g.pos + C.FIRST_STEP ? 1 : f <= g.pos - C.FIRST_STEP ? -1 : 0
      if (!dir) break
      g.seg = { x: p.x, y: p.y }
      if (run(dir > 0 ? "right" : "left") === false) {
        // a wall: put the anchor under the finger
        g.hx = p.x - g.pos * stepX()
        break
      }
      g.pos += dir
      if (g.mode !== "h") break // the piece changed (finish() was called)
    }
  }

  const followV = (p) => {
    const f = (p.y - g.vy) / stepY()
    g.level = Math.min(g.level, f) // after going back up, the next row is a cell further down
    for (let guard = 0; guard < 40 && f >= g.level + 1; guard++) {
      g.level += 1
      g.seg = { x: p.x, y: p.y }
      run("softDrop")
      if (g.mode !== "v") break
    }
  }

  // Speed over the last FLICK_WINDOW ms, in px/ms
  const velocity = () => {
    const s = g.samples
    const last = s[s.length - 1]
    let i = s.length - 1
    while (i > 0 && last.t - s[i - 1].t <= C.FLICK_WINDOW) i--
    if (i > 0 && last.t - s[i].t < C.FLICK_MIN_DT) i--
    const ref = s[i]
    const dt = last.t - ref.t
    if (dt <= 0) return { vx: 0, vy: 0 }
    return { vx: (last.x - ref.x) / dt, vy: (last.y - ref.y) / dt }
  }

  const checkFlick = (p) => {
    if (g.mode !== "v") return false
    const { vx, vy } = velocity()
    if (vy >= C.FLICK_VELOCITY && vy >= 2 * Math.abs(vx) && p.y - g.vStart >= C.FLICK_TRAVEL) {
      g.mode = "done"
      run("hardDrop")
      return true
    }
    return false
  }

  const addSample = (p) => {
    g.samples.push({ x: p.x, y: p.y, t: p.t })
    // keep a little more than the window
    while (g.samples.length > 2 && p.t - g.samples[1].t > C.FLICK_WINDOW * 2) g.samples.shift()
  }

  const step = (p) => {
    addSample(p)
    if (g.mode === "done") return
    if (g.mode === "pending") {
      const dx = p.x - g.start.x
      const dy = p.y - g.start.y
      if (Math.hypot(dx, dy) < C.SLOP) return
      if (Math.abs(dx) >= Math.abs(dy)) lockH(g.start, g.start)
      else if (dy > 0) lockV(g.start, g.start)
      else g.mode = "up"
    }
    if (g.mode === "up") {
      const up = g.start.y - p.y
      const side = Math.abs(p.x - g.start.x)
      if (up >= Math.max(C.HOLD_MIN_PX, C.HOLD_TRAVEL * opts.cellHeight) && up > side) {
        g.mode = "done"
        run("hold")
        return
      }
      if (side >= C.SWITCH * stepX() && side > 2 * Math.abs(p.y - g.start.y)) lockH(g.start, p)
      else return
    }
    if (g.mode === "h") {
      const down = p.y - g.seg.y
      if (down >= C.SWITCH * stepY() && down > 2 * Math.abs(p.x - g.seg.x)) lockV(g.seg, p)
    } else if (g.mode === "v") {
      const side = Math.abs(p.x - g.seg.x)
      if (side >= C.SWITCH * stepX() && side > 2 * Math.abs(p.y - g.seg.y)) lockH(g.seg, p)
    }
    if (g.mode === "h") followH(p)
    else if (g.mode === "v") {
      followV(p)
      checkFlick(p)
    }
  }

  return {
    get active() {
      return !!g
    },
    get mode() {
      return g?.mode ?? null
    },
    // cellWidth, cellHeight, centerX, sensitivity, tapSides, act
    set(next) {
      opts = { ...opts, ...next }
    },
    down(p) {
      if (g) return false // one finger plays; others are ignored
      g = { id: p.id, start: { x: p.x, y: p.y, t: p.t }, mode: "pending", samples: [{ x: p.x, y: p.y, t: p.t }] }
      return true
    },
    move(p) {
      if (!g || p.id !== g.id) return
      step(p)
    },
    up(p) {
      if (!g || p.id !== g.id) return
      const last = g.samples[g.samples.length - 1]
      if (p.x !== last.x || p.y !== last.y || p.t !== last.t) step(p)
      if (g.mode === "pending" && p.t - g.start.t <= C.TAP_MS) {
        run(opts.tapSides && g.start.x < opts.centerX ? "rotateLeft" : "rotateRight")
      }
      g = null
    },
    cancel(id) {
      if (g && (id === undefined || id === g.id)) g = null
    },
    // Stop steering for the rest of this touch (the piece locked or changed)
    finish() {
      if (g) g.mode = "done"
    },
  }
}
