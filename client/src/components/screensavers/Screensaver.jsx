import React, { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { saverById } from "./savers"
import "./Screensaver.css"

let running = 0
// true while a full-screen screensaver is up (the idle timer waits meanwhile)
export const isScreensaverActive = () => running > 0

const MOVE_SLOP = 6 // pixels the mouse may drift before it counts
const SETTLE_MS = 300 // mouse moves this soon after opening don't count (the browser sends one as it appears)

// A screensaver over everything, until the mouse moves, a key is pressed, or the screen is
// clicked or touched. That input is swallowed so it doesn't also land on whatever's below.
const Screensaver = ({ id, settings, onExit }) => {
  const saver = saverById(id)
  const exitRef = useRef(onExit)
  useEffect(() => {
    exitRef.current = onExit
  })

  useEffect(() => {
    running++
    const opened = performance.now()
    let origin = null
    let done = false

    const block = (e) => {
      e.preventDefault()
      e.stopPropagation()
    }
    const swallowAfter = ["click", "mouseup", "pointerup", "contextmenu", "dblclick"]
    const stopSwallowing = () => swallowAfter.forEach((t) => window.removeEventListener(t, block, true))
    const exit = (swallow) => {
      if (done) return
      done = true
      // the rest of the click or tap that woke the screen up
      if (swallow) {
        swallowAfter.forEach((t) => window.addEventListener(t, block, true))
        setTimeout(stopSwallowing, 400)
      }
      exitRef.current?.()
    }

    const onMove = (e) => {
      if (done) return
      if (!origin || performance.now() - opened < SETTLE_MS) {
        origin = { x: e.clientX, y: e.clientY }
        return
      }
      if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > MOVE_SLOP) exit(false)
    }
    const onInput = (e) => {
      block(e)
      exit(e.type !== "keydown")
    }
    const onWheel = () => exit(false)

    const opts = { capture: true, passive: false }
    window.addEventListener("mousemove", onMove, true)
    window.addEventListener("pointerdown", onInput, opts)
    window.addEventListener("mousedown", onInput, opts)
    window.addEventListener("touchstart", onInput, opts)
    window.addEventListener("keydown", onInput, opts)
    window.addEventListener("wheel", onWheel, { capture: true, passive: true })

    return () => {
      running--
      window.removeEventListener("mousemove", onMove, true)
      window.removeEventListener("pointerdown", onInput, opts)
      window.removeEventListener("mousedown", onInput, opts)
      window.removeEventListener("touchstart", onInput, opts)
      window.removeEventListener("keydown", onInput, opts)
      window.removeEventListener("wheel", onWheel, { capture: true, passive: true })
      // after an exit the swallowing outlives the overlay for a moment, by design
      if (!done) stopSwallowing()
    }
  }, [])

  return createPortal(
    <div className="ssOverlay" data-screensaver={id} aria-hidden="true">
      {saver && <saver.Component settings={settings || saver.defaults} />}
    </div>,
    document.body
  )
}

// The same screensaver drawn inside its parent box (the Display Properties monitor)
export const ScreensaverPreview = ({ id, settings }) => {
  const saver = saverById(id)
  if (!saver) return null
  return (
    <div className="ssPreview" data-screensaver-preview={id}>
      <saver.Component settings={settings || saver.defaults} preview />
    </div>
  )
}

export default Screensaver
