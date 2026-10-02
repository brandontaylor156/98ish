import { useEffect, useRef } from "react"
import { isScreensaverActive } from "./Screensaver"

// Calls onIdle once after `minutes` with no pointer, keyboard, wheel or touch input
// (0 or less turns it off). The count starts over after any input, and holds while the
// page is hidden, a video plays full screen, or a screensaver is already showing.
// Input inside cross-origin frames (Internet Explorer pages, YouTube) can't be seen, so
// focus moving into a frame counts as input instead.

const INPUT = ["pointerdown", "keydown", "wheel", "touchstart", "focusin"]

const watchingVideo = () => {
  const full = document.fullscreenElement || document.webkitFullscreenElement
  if (!full) return false
  // a full-screen frame is almost always a video player we can't look inside
  if (full.tagName === "IFRAME") return true
  const videos = full.tagName === "VIDEO" ? [full] : full.querySelectorAll("video")
  return [...videos].some((v) => !v.paused && !v.ended)
}

export const useIdle = (minutes, onIdle) => {
  const callback = useRef(onIdle)
  useEffect(() => {
    callback.current = onIdle
  })

  useEffect(() => {
    if (!(minutes > 0)) return
    const wait = minutes * 60000
    let last = Date.now()
    let fired = false
    let mx = null
    let my = null

    const poke = () => {
      last = Date.now()
      fired = false
    }
    // browsers send mousemove when things change under a still mouse; only real moves count
    const onMove = (e) => {
      if (e.clientX === mx && e.clientY === my) return
      mx = e.clientX
      my = e.clientY
      poke()
    }
    const tick = () => {
      if (document.hidden || watchingVideo() || isScreensaverActive()) {
        last = Date.now()
        return
      }
      if (!fired && Date.now() - last >= wait) {
        fired = true
        callback.current?.()
      }
    }

    const timer = setInterval(tick, 1000)
    INPUT.forEach((t) => window.addEventListener(t, poke, { capture: true, passive: true }))
    window.addEventListener("mousemove", onMove, { capture: true, passive: true })
    window.addEventListener("blur", poke)
    document.addEventListener("visibilitychange", poke)
    return () => {
      clearInterval(timer)
      INPUT.forEach((t) => window.removeEventListener(t, poke, { capture: true, passive: true }))
      window.removeEventListener("mousemove", onMove, { capture: true, passive: true })
      window.removeEventListener("blur", poke)
      document.removeEventListener("visibilitychange", poke)
    }
  }, [minutes])
}

export default useIdle
