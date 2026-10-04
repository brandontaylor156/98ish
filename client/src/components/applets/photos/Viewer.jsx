import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { clampScale, clampView, fitView, moveCrop, resizeCrop, swipeDirection, zoomAt } from "./photoMath.js"

// One picture, zoomable and draggable. Mouse: wheel zooms, drag pans, double-click zooms in
// and back. Touch: pinch zooms, one finger pans a zoomed picture, swiping a fitted picture
// left or right goes to the next or previous one, double-tap zooms. The page itself never
// scrolls or zooms underneath (touch-action: none, and Safari's own pinch is stopped).
// In crop mode the picture stays fitted and a crop box with handles sits on top.
//
// controls.current gets { zoomIn, zoomOut, fit, actual } for the toolbar; onZoom(percent)
// reports the zoom for the status bar.

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]

const Viewer = ({ src, width, height, onSwipe, controls, onZoom, filter, cropMode = false, cropRect, cropAspect, onCrop, alt = "" }) => {
  const stageRef = useRef(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [view, setViewState] = useState({ scale: 1, x: 0, y: 0 })
  const [swipeDx, setSwipeDx] = useState(0)
  const viewRef = useRef(view)
  const fitted = useRef(true) // follow the window's size while showing the whole picture
  const gesture = useRef(null)
  const pointers = useRef(new Map())
  const lastTap = useRef(null)

  const fit = () => fitView(width, height, box.w, box.h)
  const setView = (v, isFit = false) => {
    const next = clampView(v, width, height, box.w, box.h)
    viewRef.current = next
    fitted.current = isFit
    setViewState(next)
  }
  const fitNow = () => setView(fit(), true)

  // the viewing area's size
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])

  // a new picture, a new size, or crop mode: show it whole
  useLayoutEffect(() => {
    if (!box.w || !width) return
    if (fitted.current || cropMode) fitNow()
    else setView(viewRef.current)
  }, [box.w, box.h, width, height, cropMode])
  useLayoutEffect(() => {
    if (box.w && width) fitNow()
  }, [src])

  const fitScaleNow = () => fit().scale
  const zoomTo = (scale, px = box.w / 2, py = box.h / 2) => {
    const s = clampScale(scale, fitScaleNow())
    if (Math.abs(s - fitScaleNow()) < 0.001) return fitNow()
    setView(zoomAt(viewRef.current, s, px, py))
  }

  if (controls)
    controls.current = {
      zoomIn: () => zoomTo(viewRef.current.scale * 1.5),
      zoomOut: () => zoomTo(viewRef.current.scale / 1.5),
      fit: fitNow,
      actual: () => zoomTo(1),
    }

  useEffect(() => {
    onZoom?.(Math.round(view.scale * 100))
  }, [view.scale])

  // Safari's own pinch-zoom and scrolling, and wheel zoom (needs a non-passive listener)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const stop = (e) => e.preventDefault()
    const wheel = (e) => {
      if (cropMode) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomRef.current(viewRef.current.scale * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener("gesturestart", stop)
    el.addEventListener("gesturechange", stop)
    el.addEventListener("touchmove", stop, { passive: false })
    el.addEventListener("wheel", wheel, { passive: false })
    return () => {
      el.removeEventListener("gesturestart", stop)
      el.removeEventListener("gesturechange", stop)
      el.removeEventListener("touchmove", stop)
      el.removeEventListener("wheel", wheel)
    }
  }, [cropMode])
  const zoomRef = useRef(zoomTo)
  zoomRef.current = zoomTo

  // ---- pointers ----

  const local = (e) => {
    const r = stageRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const pinchInfo = () => {
    const [a, b] = [...pointers.current.values()]
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
  }

  const startOne = (p) => {
    const zoomed = viewRef.current.scale > fitScaleNow() * 1.01
    gesture.current = { kind: zoomed ? "pan" : "swipe", start: p, view0: viewRef.current, t0: performance.now(), moved: 0 }
  }

  const onPointerDown = (e) => {
    if (cropMode || e.button > 0) return
    stageRef.current.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, local(e))
    if (pointers.current.size === 1) startOne(local(e))
    else if (pointers.current.size === 2) {
      setSwipeDx(0)
      const { dist, mid } = pinchInfo()
      gesture.current = { kind: "pinch", dist0: dist, mid0: mid, view0: viewRef.current, moved: 99 }
    }
  }

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    const g = gesture.current
    if (!g) return
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const { dist, mid } = pinchInfo()
      const scale = clampScale(g.view0.scale * (dist / g.dist0), fitScaleNow())
      const v = zoomAt(g.view0, scale, g.mid0.x, g.mid0.y)
      setView({ scale, x: v.x + mid.x - g.mid0.x, y: v.y + mid.y - g.mid0.y })
      return
    }
    const dx = p.x - g.start.x
    const dy = p.y - g.start.y
    g.moved = Math.max(g.moved, Math.hypot(dx, dy))
    if (g.kind === "pan") setView({ ...g.view0, x: g.view0.x + dx, y: g.view0.y + dy })
    else if (g.kind === "swipe" && onSwipe) setSwipeDx(Math.abs(dx) > Math.abs(dy) ? dx : 0)
  }

  const onPointerUp = (e) => {
    if (!pointers.current.has(e.pointerId)) return
    const p = local(e)
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (!g) return
    if (g.kind === "pinch") {
      // one finger left: carry on panning from here
      if (pointers.current.size === 1) startOne([...pointers.current.values()][0])
      else gesture.current = null
      if (viewRef.current.scale <= fitScaleNow() * 1.01) fitNow()
      return
    }
    gesture.current = null
    const dx = p.x - g.start.x
    const dy = p.y - g.start.y
    if (g.kind === "swipe") {
      setSwipeDx(0)
      const dir = e.type === "pointerup" ? swipeDirection(dx, dy, { ms: performance.now() - g.t0 }) : 0
      if (dir && onSwipe) return onSwipe(dir)
    }
    // a tap: two quick taps in the same place zoom in (or back out)
    if (g.moved < 10 && e.type === "pointerup") {
      const now = performance.now()
      const prev = lastTap.current
      if (prev && now - prev.t < 320 && Math.hypot(p.x - prev.x, p.y - prev.y) < 30) {
        lastTap.current = null
        if (viewRef.current.scale > fitScaleNow() * 1.01) fitNow()
        else zoomTo(Math.max(fitScaleNow() * 2.5, 1), p.x, p.y)
      } else lastTap.current = { t: now, x: p.x, y: p.y }
    }
  }

  // ---- the crop box ----

  const cropDrag = (handle) => (e) => {
    e.stopPropagation()
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture?.(e.pointerId)
    const start = { x: e.clientX, y: e.clientY, rect: cropRect }
    const scale = viewRef.current.scale
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / scale
      const dy = (ev.clientY - start.y) / scale
      onCrop(handle === "move" ? moveCrop(start.rect, dx, dy, width, height) : resizeCrop(start.rect, handle, dx, dy, width, height, cropAspect, Math.max(16, 24 / scale)))
    }
    const up = () => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      el.removeEventListener("pointercancel", up)
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
    el.addEventListener("pointercancel", up)
  }

  const cropStyle = cropMode && cropRect ? { left: view.x + cropRect.x * view.scale, top: view.y + cropRect.y * view.scale, width: cropRect.w * view.scale, height: cropRect.h * view.scale } : null

  return (
    <div
      ref={stageRef}
      className={`phStage${cropMode ? " is-crop" : ""}${view.scale > fit().scale * 1.01 ? " is-zoomed" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => e.preventDefault()}
    >
      {src && box.w > 0 && (
        <img
          className="phImage"
          src={src}
          alt={alt}
          draggable={false}
          style={{
            width,
            height,
            transform: `translate(${view.x + swipeDx}px, ${view.y}px) scale(${view.scale})`,
            filter: filter || undefined,
            imageRendering: view.scale >= 3 ? "pixelated" : undefined,
          }}
        />
      )}
      {cropStyle && (
        <div className="phCrop" style={cropStyle} onPointerDown={cropDrag("move")} data-testid="crop-box">
          <div className="phCropGrid" />
          {HANDLES.map((h) => (
            <div key={h} className={`phHandle phHandle--${h}`} data-handle={h} onPointerDown={cropDrag(h)} />
          ))}
        </div>
      )}
    </div>
  )
}

export default Viewer
