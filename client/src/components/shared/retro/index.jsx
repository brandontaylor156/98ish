import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createBitmap, createPalette, drawLed, drawText, drawTitle, fitPixels, ledWidth, textWidth, titleWidth, wrapText, present, clear } from "../../../utils/retro"
import { reducedMotion } from "../../../utils/settings"
import "./Retro.css"

// The browser side of the retro kit (utils/retro: palettes, bitmaps, pixel fonts, sprites).
//
//   const screen = useRetroScreen({ layout, render })
//     layout(cssW, cssH) -> { minW, minH }  the smallest logical screen the game needs; the
//                          pixels are as big as that allows (whole device pixels each)
//     render(bitmap, fit) draws a frame (called by screen.paint() and after every resize)
//   <RetroStage screen={screen} className>  the box it fills: canvas + hit boxes on top
//     <Hit x y w h as="button" ...>        an element over a box in LOGICAL pixels
//   screen.paint(lut?)   render + present (call it from the game loop)
//   screen.point(e)      a pointer event -> logical { x, y }
//
//   <PixelText text color shadow outline scale wrap title />  text in the pixel font, as a
//       little canvas for DOM overlays (panels, buttons); its size follows the stage's pixels
//   <PixelLed text />          red 7-segment digits
//   <RetroPanel title buttons> a 98 window drawn at the game's pixel size (CSS bevels)
//   <PixelButton label ...>    a real <button> with a pixel-font label (focus, keys, a11y)
//   <RetroPaused onResume onQuit />  the Paused card (data-paused)
//   <RetroBanner draw minW minH paused />  an animated pixel title screen banner (attract mode)

// CSS pixels per logical pixel for DOM pieces drawn to match the game (PixelText etc.)
export const RetroScale = createContext(2)
export const useRetroScale = () => useContext(RetroScale)

const sameFit = (a, b) => a && b && a.k === b.k && a.w === b.w && a.h === b.h && a.css === b.css && a.offsetX === b.offsetX && a.offsetY === b.offsetY

export const useRetroScreen = ({ layout, render, palette, transparent = false, deps = [] }) => {
  // callback refs: the stage may mount after the game (a title screen first) and remount
  const [el, boxRef] = useState(null)
  const [canvas, canvasRef] = useState(null)
  const [fit, setFit] = useState(null)
  const st = useRef({ bitmap: null, ctx: null, img: null, u32: null })
  const renderRef = useRef(render)
  renderRef.current = render
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const palRef = useRef(palette)
  palRef.current = palette

  useLayoutEffect(() => {
    if (!el) {
      setFit(null)
      return
    }
    let mq = null
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      const dpr = window.devicePixelRatio || 1
      const want = typeof layoutRef.current === "function" ? layoutRef.current(r.width, r.height) : layoutRef.current
      const f = fitPixels({ w: r.width, h: r.height, dpr, ...want })
      setFit((prev) => (sameFit(prev, f) ? prev : f))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // zooming (or a window moving to another screen) changes devicePixelRatio
    const watchDpr = () => {
      mq?.removeEventListener?.("change", onDpr)
      mq = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      mq?.addEventListener?.("change", onDpr)
    }
    const onDpr = () => {
      watchDpr()
      measure()
    }
    watchDpr()
    return () => {
      ro.disconnect()
      mq?.removeEventListener?.("change", onDpr)
    }
  }, [el, ...deps])

  const fitRef = useRef(fit)
  fitRef.current = fit
  const paint = (lut) => {
    const s = st.current
    const table = lut || s.lut || palRef.current?.lut
    if (!s.bitmap || !s.ctx || !table || !fitRef.current) return
    renderRef.current?.(s.bitmap, fitRef.current)
    present(s.bitmap, s.u32, table)
    s.ctx.putImageData(s.img, 0, 0)
  }

  // a new size: a new bitmap, then draw at once (even while paused)
  useLayoutEffect(() => {
    if (!fit || !canvas) {
      st.current = { ...st.current, bitmap: null, ctx: null }
      return
    }
    canvas.width = fit.w
    canvas.height = fit.h
    const ctx = canvas.getContext("2d", { alpha: transparent })
    ctx.imageSmoothingEnabled = false
    const img = ctx.createImageData(fit.w, fit.h)
    st.current = { ...st.current, bitmap: createBitmap(fit.w, fit.h), ctx, img, u32: new Uint32Array(img.data.buffer) }
    paint()
  }, [fit, canvas])

  return {
    boxRef,
    canvasRef,
    canvas,
    fit,
    get bitmap() {
      return st.current.bitmap
    },
    // the palette lookup used when paint() gets none
    setLut: (lut) => (st.current.lut = lut),
    paint,
    point: (e) => {
      const c = canvas
      if (!c || !fit) return { x: -1, y: -1 }
      const r = c.getBoundingClientRect()
      return { x: ((e.clientX - r.left) / r.width) * fit.w, y: ((e.clientY - r.top) / r.height) * fit.h }
    },
  }
}

export const RetroStage = ({ screen, className = "", children, ...rest }) => {
  const { fit } = screen
  const style = fit ? { left: fit.offsetX, top: fit.offsetY, width: fit.w * fit.css, height: fit.h * fit.css, "--px": `${fit.css}px` } : { visibility: "hidden" }
  return (
    <div ref={screen.boxRef} className={`rtStage ${className}`} {...rest}>
      <div className="rtView" style={style}>
        <canvas ref={screen.canvasRef} className="rtCanvas" aria-hidden="true" />
        <RetroScale.Provider value={fit ? fit.css : 2}>{children}</RetroScale.Provider>
      </div>
    </div>
  )
}

// an element over a box of the logical screen (a button's hit area, a hole, a pad)
export const Hit = React.forwardRef(({ x, y, w, h, as: Tag = "div", className = "", style, children, ...rest }, ref) => {
  const px = useRetroScale()
  return (
    <Tag ref={ref} className={`rtHit ${className}`} style={{ left: x * px, top: y * px, width: w * px, height: h * px, ...style }} {...(Tag === "button" ? { type: "button" } : {})} {...rest}>
      {children}
    </Tag>
  )
})
Hit.displayName = "Hit"

// ---- pixel text for DOM pieces ----
const textCache = new Map()
const drawToCanvas = (canvas, w, h, draw, colors) => {
  const pal = createPalette(colors)
  const b = createBitmap(w, h)
  clear(b, 0)
  draw(b, pal)
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  const img = ctx.createImageData(w, h)
  present(b, new Uint32Array(img.data.buffer), pal.lut)
  ctx.putImageData(img, 0, 0)
}

const usePixelCanvas = (w, h, key, draw, colors) => {
  const ref = useRef(null)
  useLayoutEffect(() => {
    if (ref.current && w > 0 && h > 0) drawToCanvas(ref.current, w, h, draw, colors)
  }, [key, w, h])
  return ref
}

// text in the 5x7 pixel font (or a chunky title with title: { ramp: [hex...], outline, shadow })
export const PixelText = ({ text, color = "#000000", shadow, outline, scale = 1, wrap = 0, align = "left", title = null, className = "", px: pxProp, lineGap = 2 }) => {
  const ctxPx = useRetroScale()
  const px = pxProp || ctxPx
  const str = String(text ?? "")
  const lines = wrap ? wrapText(str, wrap, { scale }) : str.split("\n")
  const pad = outline || title ? 1 : 0
  const extra = (shadow ? 1 : 0) * scale + (title ? (title.depth ?? 2) + 1 : 0)
  const lw = (t) => (title ? titleWidth(t, { scale }) : textWidth(t, { scale }))
  const w = Math.max(1, ...lines.map(lw)) + pad * 2 + extra
  const lineH = (title ? 7 : 9) * scale + (title ? 2 : lineGap)
  const h = lines.length * lineH + pad * 2 + extra
  const key = JSON.stringify([str, color, shadow, outline, scale, wrap, align, title])
  const colors = [
    ["ink", color],
    ["shadow", shadow || "#000000"],
    ["outline", outline || "#000000"],
    ...(title ? title.ramp.map((hx, i) => [`r${i}`, hx]) : []),
  ]
  const ref = usePixelCanvas(w, h, key, (b, pal) => {
    lines.forEach((ln, i) => {
      const lx = align === "center" ? (w - extra) / 2 : align === "right" ? w - pad - extra : pad
      const y = pad + i * lineH
      if (title) drawTitle(b, ln, lx, y, { scale, ramp: title.ramp.map((_, k) => pal.idx(`r${k}`)), outline: title.outline ? pal.idx("outline") : -1, shadow: title.shadow ? pal.idx("shadow") : -1, depth: title.depth ?? 2, align })
      else drawText(b, ln, lx, y, pal.idx("ink"), { scale, align, shadow: shadow ? pal.idx("shadow") : -1, outline: outline ? pal.idx("outline") : -1 })
    })
  }, colors)
  return <canvas ref={ref} className={`rtText ${className}`} style={{ width: w * px, height: h * px }} aria-hidden="true" />
}

// a little picture drawn with the kit (a sprite on a card, stars): draw(bitmap) in palette
// indices; redrawn when `k` changes. scale: whole game pixels per bitmap pixel.
export const PixelArt = ({ w, h, palette, draw, k = "", scale = 1, className = "", label, px: pxProp }) => {
  const ctxPx = useRetroScale()
  const px = pxProp || ctxPx
  const ref = useRef(null)
  useLayoutEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = w
    c.height = h
    const ctx = c.getContext("2d")
    const img = ctx.createImageData(w, h)
    const b = createBitmap(w, h)
    draw(b)
    present(b, new Uint32Array(img.data.buffer), palette.lut)
    ctx.putImageData(img, 0, 0)
  }, [k, w, h])
  return <canvas ref={ref} className={`rtText ${className}`} style={{ width: w * px * scale, height: h * px * scale }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}

export const PixelLed = ({ text, on = "#ff2010", off = "#3a0804", bg = "#000000", digitW = 9, digitH = 15, thick = 2, className = "", px: pxProp }) => {
  const ctxPx = useRetroScale()
  const px = pxProp || ctxPx
  const w = ledWidth(String(text), { digitW }) + 6
  const h = digitH + 6
  const ref = usePixelCanvas(w, h, `${text}|${on}|${digitW}`, (b, pal) => {
    b.data.fill(pal.idx("bg"))
    drawLed(b, String(text), 3, 3, { on: pal.idx("on"), off: pal.idx("off"), digitW, digitH, thick })
  }, [["on", on], ["off", off], ["bg", bg]])
  return <canvas ref={ref} className={`rtText rtLed ${className}`} style={{ width: w * px, height: h * px }} aria-hidden="true" />
}

// a visually hidden copy of the words (screen readers, find-in-page, tests)
export const Sr = ({ children, ...rest }) => (
  <span className="rtSr" {...rest}>
    {children}
  </span>
)

// a real button with a pixel label, bevelled at the game's pixel size
export const PixelButton = React.forwardRef(({ label, sub, big = false, icon = null, className = "", color = "#000000", children, ...rest }, ref) => (
  <button ref={ref} type="button" className={`rtBtn${big ? " is-big" : ""} ${className}`} {...rest}>
    <span className="rtBtnFace" aria-hidden="true">
      {icon}
      {label != null && <PixelText text={label} color={color} scale={big ? 2 : 1} />}
      {sub && <PixelText text={sub} color="#404040" />}
    </span>
    <Sr>
      {label}
      {sub ? ` ${sub}` : ""}
    </Sr>
    {children}
  </button>
))
PixelButton.displayName = "PixelButton"

// an overlay with a 98 window drawn at the game's pixel size; `low` puts it at the bottom
export const RetroPanel = ({ title, children, buttons, className = "", low = false, wide = false, ...rest }) => (
  <div className={`rtOverlay${low ? " is-low" : ""}`} {...rest}>
    <div className={`rtPanel${wide ? " is-wide" : ""} ${className}`} role="dialog" aria-label={typeof title === "string" ? title : undefined}>
      {title != null && (
        <div className="rtPanelTitle">
          <PixelText text={title} color="#ffffff" />
          <Sr>{title}</Sr>
        </div>
      )}
      <div className="rtPanelBody">{children}</div>
      {buttons && <div className="rtPanelButtons">{buttons}</div>}
    </div>
  </div>
)

// a paragraph of pixel text that wraps to the panel (logical width `wrap`) with its words
// kept for screen readers
export const PixelP = ({ text, color = "#000000", wrap = 150, align = "center", scale = 1, className = "" }) => (
  <p className={`rtP ${className}`}>
    <PixelText text={text} color={color} wrap={wrap} align={align} scale={scale} />
    <Sr>{text}</Sr>
  </p>
)

export const RetroPaused = ({ onResume, onQuit, children }) => (
  <RetroPanel
    title="Paused"
    data-paused
    buttons={
      <>
        <PixelButton label="Resume" big onClick={onResume} autoFocus />
        {onQuit && <PixelButton label="Quit to Title" onClick={onQuit} />}
      </>
    }
  >
    {children || <PixelP text="Take a break. The game waits for you." />}
  </RetroPanel>
)

// a small high-score table in the pixel font: rows [{ score, note }], `mark` = row to blink
export const PixelScores = ({ rows = [], mark = -1, unit = "", title = "HIGH SCORES", max = 5 }) => {
  const lines = rows.slice(0, max).map((r, i) => `${String(i + 1).padStart(2, " ")}. ${String(Math.round(r.score)).padStart(6, " ")}${unit}  ${r.note || ""}`.trimEnd())
  return (
    <div className="rtScores">
      <PixelText text={title} color="#000080" />
      {lines.length ? (
        lines.map((ln, i) => (
          <div key={i} className={i === mark ? "rtScoreMark" : ""}>
            <PixelText text={ln} color={i === mark ? "#c00000" : "#000000"} />
          </div>
        ))
      ) : (
        <PixelText text="No games yet." color="#404040" />
      )}
      <Sr>{lines.join("; ")}</Sr>
    </div>
  )
}

// An animated pixel banner for a title screen: draw(bitmap, t seconds, fit). It stops when
// paused, when hidden, and draws one still frame under Reduce Motion.
export const RetroBanner = ({ draw, palette, minW = 200, minH = 72, aspect = 2.6, paused = false, className = "", label }) => {
  const t0 = useRef(performance.now())
  const screen = useRetroScreen({ layout: { minW, minH, maxK: 12 }, palette, render: (b, fit) => draw(b, (performance.now() - t0.current) / 1000, fit) })
  useEffect(() => {
    if (!screen.fit) return
    if (paused || reducedMotion()) {
      screen.paint(palette.lut)
      return
    }
    let id = 0
    let last = 0
    const frame = (now) => {
      // 30 frames a second is plenty for an attract loop (and what a 90s title ran at)
      if (now - last >= 33 && !document.hidden) {
        last = now
        screen.paint(palette.lut)
      }
      id = requestAnimationFrame(frame)
    }
    id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
  }, [screen.fit, paused])
  return (
    <div className={`rtBanner ${className}`} style={{ aspectRatio: aspect }} role="img" aria-label={label}>
      <RetroStage screen={screen} />
    </div>
  )
}

export const usePalette = (make) => useMemo(make, [])
