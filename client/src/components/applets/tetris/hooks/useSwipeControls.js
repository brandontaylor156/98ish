import { useEffect, useRef } from "react"
import { COLUMNS, VISIBLE_ROWS } from "../utils/engine"
import { createGestureTracker } from "../utils/gestures"

// Swipe controls on a Tetris window (rules in utils/gestures.js): any touch that starts on
// the window but not on a button or other control steers the piece. Pointer events, with
// every coalesced sample, so a quick flick is measured from all of its points.
// The window gets touch-action: none (CSS, data-swipe), and a non-passive touchmove stops
// iOS from scrolling or zooming the page anyway; the long-press menu is turned away too.
//
// tetris: a useTetris() instance; prefs: utils/touchPrefs.js; onTouch: called when a touch
// starts (the window takes focus).
const SKIP = "button, a, input, select, textarea, label, .tcPanel, .tcEdit"

const isAndroid = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)
const buzz = () => {
  // a tiny tick on Android only (iPhones have no web vibration, and the codebase keeps it so)
  if (!isAndroid()) return
  try {
    navigator.vibrate?.(8)
  } catch {
    // not allowed here
  }
}

export const useSwipeControls = (ref, { enabled, tetris, prefs, haptics = true, onTouch }) => {
  const latest = useRef({})
  latest.current = { tetris, prefs, haptics, onTouch }

  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return

    // The piece this touch is steering; when it locks (or a new round starts) the touch
    // stops steering, so a drag doesn't carry on into the next piece
    let pieceKey = null
    const keyOf = (game) => `${game.pieces}:${game.kos}:${game.holdUsed}`

    const tracker = createGestureTracker({
      act: (action) => {
        const { tetris: t, haptics: h } = latest.current
        const game = t.gameRef.current
        if (game.status !== "playing" || keyOf(game) !== pieceKey) {
          tracker.finish()
          return false
        }
        const moved = t.step(action)
        if ((action === "hardDrop" || action === "hold") && h) buzz()
        return moved
      },
    })

    const metrics = () => {
      const board = el.querySelector(".tetrisBoard")
      const r = (board || el).getBoundingClientRect()
      const { prefs: p } = latest.current
      return {
        cellWidth: r.width / COLUMNS,
        cellHeight: r.height / VISIBLE_ROWS,
        centerX: r.left + r.width / 2,
        sensitivity: p.sensitivity,
        tapSides: p.tapSides,
      }
    }

    const point = (e) => ({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp })
    const isFinger = (e) => e.pointerType === "touch" || e.pointerType === "pen"

    const onDown = (e) => {
      if (!isFinger(e) || e.target.closest?.(SKIP)) return
      const game = latest.current.tetris.gameRef.current
      if (game.status !== "playing") return
      if (tracker.active) return // one finger plays
      latest.current.onTouch?.()
      tracker.set(metrics())
      pieceKey = keyOf(game)
      tracker.down(point(e))
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // already gone
      }
    }
    const onMove = (e) => {
      if (!tracker.active) return
      const samples = e.getCoalescedEvents?.() || []
      if (samples.length) for (const s of samples) tracker.move({ id: e.pointerId, x: s.clientX, y: s.clientY, t: s.timeStamp || e.timeStamp })
      else tracker.move(point(e))
    }
    const onUp = (e) => {
      if (!tracker.active) return
      tracker.up(point(e))
    }
    const onCancel = (e) => tracker.cancel(e.pointerId)

    // iOS scrolls and zooms unless touchmove is cancelled (touch-action covers most cases);
    // only while a swipe is being read, so the pause menu's buttons still get their clicks
    const onTouchMove = (e) => {
      if (tracker.active && e.cancelable) e.preventDefault()
    }
    const onMenu = (e) => {
      if (!e.target.closest?.("input, textarea")) e.preventDefault()
    }

    el.addEventListener("pointerdown", onDown)
    el.addEventListener("pointermove", onMove)
    el.addEventListener("pointerup", onUp)
    el.addEventListener("pointercancel", onCancel)
    el.addEventListener("lostpointercapture", onCancel)
    el.addEventListener("touchmove", onTouchMove, { passive: false })
    el.addEventListener("contextmenu", onMenu)
    return () => {
      el.removeEventListener("pointerdown", onDown)
      el.removeEventListener("pointermove", onMove)
      el.removeEventListener("pointerup", onUp)
      el.removeEventListener("pointercancel", onCancel)
      el.removeEventListener("lostpointercapture", onCancel)
      el.removeEventListener("touchmove", onTouchMove)
      el.removeEventListener("contextmenu", onMenu)
    }
  }, [enabled])
}
