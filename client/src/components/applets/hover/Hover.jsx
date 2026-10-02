import { useEffect, useRef } from "react"
import { SQUARES, STRIDE, computeSquares, easeInOut } from "./spirograph"
import { create2DRenderer, createGLRenderer } from "./renderers"
import "./Hover.css"

/*
 * Neon "spirograph" that explodes on hover. Formerly 26 CSS elements with big blurred
 * box-shadows, an animated filter and a box-shadow transition (very expensive paint);
 * now a single canvas: WebGL2 instanced quads with an analytic glow, or a sprite-based
 * Canvas 2D fallback. Geometry and timing match the original (see spirograph.js).
 */

const TRANSITION = 2000 // ms to expand / contract
const FIT = 570 // loader units that should fit the window's shorter side
const MIN_SCALE = 0.35
const MAX_SCALE = 1.5 // keep squares from getting chunky on big screens
const HOT_RADIUS = 230 // hover hit area around the centre, in loader units

const fitScale = (w, h) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(w, h) / FIT))

const Hover = () => {
  const bodyRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    const body = bodyRef.current
    const canvas = canvasRef.current
    let renderer = null
    try {
      renderer = createGLRenderer(canvas)
    } catch (err) {
      console.warn(err)
    }
    // (returns null if this canvas already handed out a webgl context)
    if (!renderer) renderer = create2DRenderer(canvas)
    if (!renderer) return
    body.dataset.renderer = renderer.kind

    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const squares = new Float32Array(SQUARES * STRIDE)
    let width = 0
    let height = 0
    let dpr = 1
    let raf = 0
    let last = 0
    let clock = 0 // animation time in ms; only advances while running
    let progress = 0 // linear 0..1 toward the exploded state
    let hovered = false
    let lost = false
    let disposed = false

    const draw = () => {
      const scale = fitScale(width, height) * dpr
      computeSquares(squares, clock, easeInOut(progress), canvas.width / 2, canvas.height / 2, scale)
      renderer.draw(squares, scale)
    }

    const canRun = () => !disposed && !lost && !document.hidden && width > 0 && height > 0

    const frame = (now) => {
      raf = 0
      if (!canRun()) return
      const dt = last ? Math.min(now - last, 100) : 0
      last = now
      if (reduceMq.matches) {
        // reduced motion: a still spirograph that snaps between states, no loop
        progress = hovered ? 1 : 0
        draw()
        return
      }
      clock += dt
      const step = dt / TRANSITION
      progress = hovered ? Math.min(1, progress + step) : Math.max(0, progress - step)
      draw()
      raf = requestAnimationFrame(frame)
    }
    const start = () => {
      if (raf || !canRun()) return
      last = 0
      raf = requestAnimationFrame(frame)
    }
    const stop = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }

    const resize = () => {
      const r = body.getBoundingClientRect()
      width = Math.round(r.width)
      height = Math.round(r.height)
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(width * dpr))
      const h = Math.max(1, Math.round(height * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      if (canRun()) {
        draw() // repaint now so a resize never shows a blank canvas
        start()
      } else {
        stop() // e.g. minimized (display: none)
      }
    }

    const setHovered = (v) => {
      if (v === hovered) return
      hovered = v
      body.classList.toggle("hv-active", v)
      start()
    }
    const hit = (ev) => {
      const r = body.getBoundingClientRect()
      const dx = ev.clientX - r.left - r.width / 2
      const dy = ev.clientY - r.top - r.height / 2
      return Math.hypot(dx, dy) <= HOT_RADIUS * fitScale(r.width, r.height)
    }
    const isMouse = (ev) => ev.pointerType === "mouse" || ev.pointerType === "pen"
    const onMove = (ev) => {
      if (isMouse(ev)) setHovered(hit(ev))
    }
    const onDown = (ev) => {
      if (!isMouse(ev) && hit(ev)) setHovered(!hovered) // touch: tap to toggle
    }
    const onLeave = (ev) => {
      if (isMouse(ev)) setHovered(false)
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    const onMotionPref = () => start()
    const onLost = (ev) => {
      ev.preventDefault() // allow the context to be restored
      lost = true
      stop()
    }
    const onRestored = () => {
      lost = false
      renderer.restore()
      start()
    }

    const ro = new ResizeObserver(resize)
    ro.observe(body)
    resize()
    body.addEventListener("pointermove", onMove)
    body.addEventListener("pointerdown", onDown)
    body.addEventListener("pointerleave", onLeave)
    canvas.addEventListener("webglcontextlost", onLost)
    canvas.addEventListener("webglcontextrestored", onRestored)
    document.addEventListener("visibilitychange", onVisibility)
    reduceMq.addEventListener("change", onMotionPref)

    return () => {
      disposed = true
      stop()
      ro.disconnect()
      body.removeEventListener("pointermove", onMove)
      body.removeEventListener("pointerdown", onDown)
      body.removeEventListener("pointerleave", onLeave)
      canvas.removeEventListener("webglcontextlost", onLost)
      canvas.removeEventListener("webglcontextrestored", onRestored)
      document.removeEventListener("visibilitychange", onVisibility)
      reduceMq.removeEventListener("change", onMotionPref)
    }
  }, [])

  return (
    <div className="hv-body" ref={bodyRef}>
      <canvas className="hv-canvas" ref={canvasRef} role="img" aria-label="Neon spirograph that bursts outward when you hover over it" />
      <p className="hv-label" aria-hidden="true">Hover here</p>
    </div>
  )
}

export default Hover
