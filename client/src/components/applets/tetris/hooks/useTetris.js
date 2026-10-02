import { useCallback, useEffect, useRef, useState } from "react"
import { createGame, hardDrop, hold, move, rotate, tick, togglePause } from "../utils/engine"

// Delayed auto shift: hold left/right and the piece starts sliding after DAS ms, then
// moves every ARR ms (the browser's own key repeat is far too slow for Tetris)
const DAS = 170
const ARR = 50

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
}

export const useTetris = () => {
  const gameRef = useRef(null)
  if (gameRef.current === null) gameRef.current = createGame()
  const [game, setGame] = useState(gameRef.current)

  // Held keys live in a ref; the frame loop reads them
  const input = useRef({ left: false, right: false, direction: 0, dasTimer: 0, arrTimer: 0, softDrop: false })

  const update = useCallback((step) => {
    const next = step(gameRef.current)
    if (next !== gameRef.current) {
      gameRef.current = next
      setGame(next)
    }
  }, [])

  useEffect(() => {
    let frame
    let last = performance.now()

    const loop = (now) => {
      const elapsed = Math.min(now - last, 100)
      last = now
      const held = input.current

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
        return tick(next, elapsed, held.softDrop)
      })

      frame = requestAnimationFrame(loop)
    }

    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [update])

  const startShift = (direction) => {
    Object.assign(input.current, { direction, dasTimer: 0, arrTimer: 0 })
    update((state) => move(state, direction))
  }

  // Actions come from the keyboard or the on-screen touch controls
  const press = (action) => {
    switch (action) {
      case "left":
      case "right":
        input.current[action] = true
        startShift(action === "left" ? -1 : 1)
        break
      case "softDrop":
        input.current.softDrop = true
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
    }
  }

  const release = (action) => {
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

  const pause = () => update((state) => (state.status === "playing" ? togglePause(state) : state))
  const resume = () => update((state) => (state.status === "paused" ? togglePause(state) : state))

  return { game, press, release, onKeyDown, onKeyUp, releaseKeys, pause, resume }
}
