import { useCallback, useEffect, useRef, useState } from "react"
import { createGame, hardDrop, hold, move, rotate, softDropStep, tick, togglePause } from "../utils/engine"
import { MODES } from "../utils/modes"

// Delayed auto shift: hold left/right and the piece starts sliding after DAS ms, then
// moves every ARR ms (the browser's own key repeat is far too slow for Tetris)
const DAS = 170
const ARR = 50
// Soft drop: a tap moves down one row; only after holding this long does it fall fast
const SOFT_DROP_DELAY = 300 // finger taps last up to ~200ms (slow phones stretch that a bit)

const KEY_ACTIONS = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowDown: "softDrop",
  Space: "hardDrop",
  ArrowUp: "rotateRight",
  KeyX: "rotateRight",
  KeyZ: "rotateLeft",
  ControlLeft: "rotateLeft",
  ControlRight: "rotateLeft",
  ShiftLeft: "hold",
  ShiftRight: "hold",
  KeyC: "hold",
  KeyP: "pause",
  Escape: "pause",
  KeyV: "item",
  KeyE: "item",
}

// One game of a mode (see utils/modes.js). options: { seed, running (false holds the
// clock, e.g. during an online countdown), onAction (actions the engine doesn't handle,
// like "item") }. Mirror (an Arena item) swaps left and right for a while.
export const useTetris = (mode = "marathon", { seed, running = true, onAction } = {}) => {
  const gameRef = useRef(null)
  if (gameRef.current === null) gameRef.current = createGame({ seed, ...MODES[mode].options })
  const [game, setGame] = useState(gameRef.current)
  const runningRef = useRef(running)
  runningRef.current = running
  const mirrorRef = useRef(false)
  const actionRef = useRef(onAction)
  actionRef.current = onAction

  // Held keys live in a ref; the frame loop reads them
  const input = useRef({ left: false, right: false, direction: 0, dasTimer: 0, arrTimer: 0, softDrop: false, softDropTimer: 0 })

  const update = useCallback((step) => {
    const next = step(gameRef.current)
    if (next !== gameRef.current) {
      gameRef.current = next
      setGame(next)
    }
  }, [])

  // A fresh game (online: a new round on a new seed)
  const reset = useCallback((nextSeed) => {
    gameRef.current = createGame({ seed: nextSeed, ...MODES[mode].options })
    setGame(gameRef.current)
  }, [mode])

  useEffect(() => {
    let frame
    let last = performance.now()

    const loop = (now) => {
      const elapsed = Math.min(now - last, 100)
      last = now
      const held = input.current

      if (runningRef.current)
        update((state) => {
          if (state.status !== "playing") return state
          let next = state
          if (held.direction) {
            held.dasTimer += elapsed
            if (held.dasTimer >= DAS) {
              held.arrTimer += elapsed
              while (held.arrTimer >= ARR) {
                held.arrTimer -= ARR
                next = move(next, held.direction)
              }
            }
          }
          if (held.softDrop) held.softDropTimer += elapsed
          return tick(next, elapsed, held.softDrop && held.softDropTimer >= SOFT_DROP_DELAY)
        })

      frame = requestAnimationFrame(loop)
    }

    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [update])

  // dev-only hook for the browser tests (speeding up modes, forcing endings)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__tetris = { get: () => gameRef.current, apply: (fn) => update(fn) }
    return () => {
      if (window.__tetris?.get?.() === gameRef.current) delete window.__tetris
    }
  }, [update])

  const startShift = (direction) => {
    Object.assign(input.current, { direction, dasTimer: 0, arrTimer: 0 })
    update((state) => move(state, direction))
  }

  const swap = (action) => (mirrorRef.current && (action === "left" || action === "right") ? (action === "left" ? "right" : "left") : action)

  // Actions come from the keyboard or the on-screen touch controls
  const press = (pressed) => {
    const action = swap(pressed)
    if (!runningRef.current && action !== "pause") return
    switch (action) {
      case "left":
      case "right":
        input.current[action] = true
        startShift(action === "left" ? -1 : 1)
        break
      case "softDrop":
        Object.assign(input.current, { softDrop: true, softDropTimer: 0 })
        update(softDropStep)
        break
      case "hardDrop":
        update(hardDrop)
        break
      case "rotateRight":
        update((state) => rotate(state, 1))
        break
      case "rotateLeft":
        update((state) => rotate(state, -1))
        break
      case "hold":
        update(hold)
        break
      case "pause":
        update(togglePause)
        break
      default:
        actionRef.current?.(action)
    }
  }

  const release = (released) => {
    const action = swap(released)
    const held = input.current

    if (action === "left" || action === "right") {
      held[action] = false
      // Fall back to the other direction if it's still held
      const direction = held.left ? -1 : held.right ? 1 : 0
      if (direction !== held.direction) {
        if (direction) startShift(direction)
        else held.direction = 0
      }
    } else if (action === "softDrop") {
      held.softDrop = false
    }
  }

  const onKeyDown = (event) => {
    const action = KEY_ACTIONS[event.code]
    if (!action) return
    // Arrows and Space would otherwise scroll the page
    event.preventDefault()
    if (event.repeat) return
    press(action)
  }

  const onKeyUp = (event) => {
    const action = KEY_ACTIONS[event.code]
    if (action) release(action)
  }

  // Forget held keys (e.g. when the window loses focus mid-press)
  const releaseKeys = () => {
    Object.assign(input.current, { left: false, right: false, direction: 0, softDrop: false })
  }

  const setMirror = (on) => {
    releaseKeys()
    mirrorRef.current = on
  }

  const pause = () => update((state) => (state.status === "playing" ? togglePause(state) : state))
  const resume = () => update((state) => (state.status === "paused" ? togglePause(state) : state))

  return { game, gameRef, update, reset, press, release, onKeyDown, onKeyUp, releaseKeys, pause, resume, setMirror }
}
