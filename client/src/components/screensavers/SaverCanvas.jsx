import React, { useEffect, useRef } from "react"

const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

// Runs one screensaver's drawing code on a canvas that fills its parent.
// create(canvas, options, { preview, reduced }) returns { resize(w, h, dpr), frame(dt), dispose() }.
// Frames stop while the page is hidden or the canvas is scrolled out of view, and
// prefers-reduced-motion runs everything at half speed.
const SaverCanvas = ({ create, settings, preview = false }) => {
  const ref = useRef(null)
  const key = JSON.stringify(settings)

  useEffect(() => {
    // a fresh canvas each run: a WebGL canvas can't be reused once its context is released
    const parent = ref.current
    const canvas = document.createElement("canvas")
    canvas.className = "ssCanvas"
    parent.appendChild(canvas)
    const reduced = reducedMotion()
    const pace = reduced ? 0.5 : 1
    let saver
    try {
      saver = create(canvas, JSON.parse(key), { preview, reduced })
    } catch (e) {
      console.warn("Screensaver couldn't start:", e)
      canvas.remove()
      return
    }

    let width = 0
    let height = 0
    const size = () => {
      width = parent.clientWidth
      height = parent.clientHeight
      if (width && height) saver.resize(width, height, Math.min(2, window.devicePixelRatio || 1))
    }

    let raf = 0
    let last = 0
    let onScreen = true
    const loop = (now) => {
      raf = requestAnimationFrame(loop)
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
      last = now
      if (width && height) saver.frame(dt * pace)
    }
    const update = () => {
      const run = onScreen && !document.hidden
      if (run && !raf) {
        last = 0
        raf = requestAnimationFrame(loop)
      } else if (!run && raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    size()
    update()
    const resizer = new ResizeObserver(size)
    resizer.observe(parent)
    window.addEventListener("resize", size)
    const seen = new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1].isIntersecting
      update()
    })
    seen.observe(canvas)
    document.addEventListener("visibilitychange", update)

    return () => {
      cancelAnimationFrame(raf)
      resizer.disconnect()
      seen.disconnect()
      window.removeEventListener("resize", size)
      document.removeEventListener("visibilitychange", update)
      saver.dispose()
      canvas.remove()
    }
  }, [create, key, preview])

  return <div ref={ref} className="ssFill" />
}

export default SaverCanvas
