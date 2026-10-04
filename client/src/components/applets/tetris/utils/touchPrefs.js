import { useSyncExternalStore } from "react"
import { SENSITIVITY_RANGE } from "./gestures"

// How Tetris plays on a touch screen (localStorage "98ish.tetris.touch", per user through
// the storage seam). Set in the controls editor ("Customize controls...", or Controls... in
// the pause menu).
//   scheme: "gestures+buttons" (default) | "gestures" | "buttons" (the classic d-pad)
//   sensitivity: columns per cell of finger travel (0.5-2)
//   tapSides: tap the left half to rotate counterclockwise, the right half clockwise

export const TOUCH_PREFS_KEY = "98ish.tetris.touch"
export const SCHEMES = [
  { id: "gestures+buttons", label: "Gestures + buttons" },
  { id: "gestures", label: "Gestures only" },
  { id: "buttons", label: "Buttons only" },
]
export const DEFAULT_TOUCH_PREFS = { scheme: "gestures+buttons", sensitivity: 1, tapSides: false }

export const sanitizeTouchPrefs = (raw) => {
  const p = raw && typeof raw === "object" ? raw : {}
  const s = Number(p.sensitivity)
  return {
    scheme: SCHEMES.some((x) => x.id === p.scheme) ? p.scheme : DEFAULT_TOUCH_PREFS.scheme,
    sensitivity: Number.isFinite(s) ? Math.min(SENSITIVITY_RANGE[1], Math.max(SENSITIVITY_RANGE[0], s)) : DEFAULT_TOUCH_PREFS.sensitivity,
    tapSides: p.tapSides === true,
  }
}

const read = () => {
  try {
    return sanitizeTouchPrefs(JSON.parse(localStorage.getItem(TOUCH_PREFS_KEY)))
  } catch {
    return { ...DEFAULT_TOUCH_PREFS }
  }
}

let prefs = null
const listeners = new Set()
const current = () => (prefs ||= read())

const subscribe = (fn) => {
  listeners.add(fn)
  const onStorage = (e) => {
    if (e.key !== TOUCH_PREFS_KEY) return
    prefs = read()
    fn()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener("storage", onStorage)
  }
}

export const setTouchPrefs = (next) => {
  prefs = sanitizeTouchPrefs({ ...current(), ...next })
  try {
    localStorage.setItem(TOUCH_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // full or blocked: kept for this visit
  }
  listeners.forEach((fn) => fn())
}

// The how-to-swipe card shows once (per user)
const HINT_KEY = "98ish.tetris.swipeHint"
export const hintSeen = () => {
  try {
    return localStorage.getItem(HINT_KEY) === "seen"
  } catch {
    return true
  }
}
export const markHintSeen = () => {
  try {
    localStorage.setItem(HINT_KEY, "seen")
  } catch {
    // blocked: it may show again
  }
}

export const useTetrisTouchPrefs =() => useSyncExternalStore(subscribe, current, current)
