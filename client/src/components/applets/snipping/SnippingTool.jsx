import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import MenuBar from "../../shared/MenuBar"
import MoreOptions from "../../shared/MoreOptions"
import PrimaryBar from "../../shared/PrimaryBar"
import { summarize } from "../../../utils/disclosure"
import { helpItem } from "../../../utils/help"
import { photosWindow } from "../../../utils/programs"
import { shareOut } from "../../../utils/share"
import { copyImage } from "../../../utils/systemClipboard"
import { canCaptureDisplay, captureDisplay, captureScreen, settle, windowAt } from "./capture"
import { DELAYS, HIGHLIGHT, MIN_SNIP, MODES, PEN_COLORS, clampRect, countdownText, cropStep, fitBox, normRect, pickFormat, snipName, strokeWidth, toImageRect, viewToImage, addPoint } from "./snipMath"
import "./SnippingTool.css"

// Snipping Tool: a picture of part of the 98ish screen (a rectangle, a window, or all of
// it), marked up with a pen, a highlighter or a crop, then saved to My Pictures, copied, or
// sent to the phone. How the picture is made (the page itself, 3D games' frames): capture.js.
// Baseline: New snip + the three kinds; the delay and "another window" (computers) are under
// More options. Ctrl+Shift+S (App.jsx) opens it straight into a rectangle snip.

const PREFS = "98ish.snip"
const readPrefs = () => {
  try {
    return { mode: "rect", delay: 0, color: "red", size: "thin", ...JSON.parse(localStorage.getItem(PREFS) || "{}") }
  } catch {
    return { mode: "rect", delay: 0, color: "red", size: "thin" }
  }
}
const writePrefs = (p) => {
  try {
    localStorage.setItem(PREFS, JSON.stringify(p))
  } catch {
    // only for this visit
  }
}

const cropCanvas = (src, r) => {
  const c = document.createElement("canvas")
  c.width = r.w
  c.height = r.h
  c.getContext("2d").drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  return c
}

const drawStroke = (g, s) => {
  if (!s.points.length) return
  g.save()
  g.lineCap = "round"
  g.lineJoin = "round"
  g.lineWidth = s.width
  if (s.tool === "highlighter") {
    g.globalAlpha = HIGHLIGHT.alpha
    g.globalCompositeOperation = "multiply"
    g.strokeStyle = HIGHLIGHT.color
  } else g.strokeStyle = s.color
  g.beginPath()
  const [x0, y0] = s.points[0]
  g.moveTo(x0, y0)
  if (s.points.length === 1) g.lineTo(x0 + 0.01, y0)
  for (let i = 1; i < s.points.length; i++) g.lineTo(s.points[i][0], s.points[i][1])
  g.stroke()
  g.restore()
}

// the original with every step applied, in order (strokes are in the picture of their time)
const compose = (base, steps) => {
  let cur = document.createElement("canvas")
  cur.width = base.width
  cur.height = base.height
  cur.getContext("2d").drawImage(base, 0, 0)
  for (const step of steps) {
    if (step.type === "stroke") drawStroke(cur.getContext("2d"), step.stroke)
    else if (step.type === "crop") {
      const r = clampRect(step.rect, cur.width, cur.height)
      if (r) cur = cropCanvas(cur, r)
    }
  }
  return cur
}

const canvasBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality))
const blobDataUrl = (blob) =>
  new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })

// ---- the full-screen chooser: drag a rectangle, or pick a window ----
const SelectOverlay = ({ shot, mode, mobile, onMode, onDone, onCancel }) => {
  const host = useRef(null)
  const layer = useRef(null)
  const [drag, setDrag] = useState(null) // { x0, y0, x1, y1 }
  const [hover, setHover] = useState(null) // a window's rect
  const [hint, setHint] = useState("")

  useLayoutEffect(() => {
    const c = shot.canvas
    c.className = "snipShot"
    c.style.width = `${shot.width}px`
    c.style.height = `${shot.height}px`
    host.current?.appendChild(c)
    return () => c.remove()
  }, [shot])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])

  const local = (e) => ({ x: e.clientX - shot.offset.x, y: e.clientY - shot.offset.y })
  const finishRect = (r) => {
    const rect = clampRect(r, shot.width, shot.height)
    if (!rect || rect.w < MIN_SNIP || rect.h < MIN_SNIP) return setHint(mobile ? "Drag a box over what you want: press, slide, let go." : "Drag a box over what you want.")
    onDone(rect)
  }
  const pick = (e) => {
    const win = windowAt(e.clientX, e.clientY, layer.current)
    if (!win) return onDone({ x: 0, y: 0, w: shot.width, h: shot.height }) // the desktop: all of it
    onDone({ x: win.rect.x - shot.offset.x, y: win.rect.y - shot.offset.y, w: win.rect.w, h: win.rect.h })
  }

  const onPointerDown = (e) => {
    if (e.target.closest(".snipBar")) return
    e.preventDefault()
    if (mode === "window") return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = local(e)
    setHint("")
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  const onPointerMove = (e) => {
    if (mode === "window") {
      if (e.pointerType !== "mouse") return
      const win = windowAt(e.clientX, e.clientY, layer.current)
      setHover(win ? { x: win.rect.x - shot.offset.x, y: win.rect.y - shot.offset.y, w: win.rect.w, h: win.rect.h } : null)
      return
    }
    if (!drag) return
    const p = local(e)
    setDrag((d) => d && { ...d, x1: p.x, y1: p.y })
  }
  const onPointerUp = (e) => {
    if (e.target.closest?.(".snipBar")) return
    if (mode === "window") return pick(e)
    if (!drag) return
    const p = local(e)
    setDrag(null)
    finishRect(normRect(drag.x0, drag.y0, p.x, p.y))
  }

  const box = mode === "window" ? hover : drag ? normRect(drag.x0, drag.y0, drag.x1, drag.y1) : null
  return createPortal(
    <div
      ref={layer}
      className={`snipLayer is-${mode}`}
      data-snip-hide
      data-touch-surface
      data-kb-keep
      style={{ left: shot.offset.x, top: shot.offset.y, width: shot.width, height: shot.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onContextMenu={(e) => e.preventDefault()}
      role="dialog"
      aria-label="Choose what to snip"
    >
      <div ref={host} className="snipShotHost" aria-hidden="true" />
      <div className={`snipDim${box ? " has-box" : ""}`} style={box ? { left: box.x, top: box.y, width: box.w, height: box.h } : undefined} />
      <div className="snipBar window" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <div className="snipModes" role="radiogroup" aria-label="Kind of snip">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={mode === m.id ? "is-on" : ""} onClick={() => (m.id === "full" ? onDone({ x: 0, y: 0, w: shot.width, h: shot.height }) : onMode(m.id))}>
              {m.label}
            </button>
          ))}
        </div>
        <span className="snipHint" role="status">
          {hint || (mode === "window" ? (mobile ? "Tap a window." : "Click a window.") : "Drag a box over what you want.")}
        </span>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>,
    document.querySelector(".os-root") || document.body
  )
}

const SnippingTool = ({ mobile, dispatch, windowIndex, minimized, handoff, onClose }) => {
  const [prefs, setPrefsState] = useState(readPrefs)
  const setPrefs = (patch) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch }
      writePrefs(next)
      return next
    })
  const [phase, setPhase] = useState("home") // home | countdown | capturing | select | edit
  const [count, setCount] = useState(0)
  const [shot, setShot] = useState(null)
  const [selMode, setSelMode] = useState("rect")
  const [base, setBase] = useState(null) // the snip as taken (a canvas)
  const [steps, setSteps] = useState([])
  const [tool, setTool] = useState("pen") // pen | highlighter | crop
  const [status, setStatus] = useState("")
  const [saved, setSaved] = useState(null) // the file in My Pictures
  const [out, setOut] = useState(null) // { canvas, blob, dataUrl, name, mime }
  const rootRef = useRef(null)
  const stageRef = useRef(null)
  const viewRef = useRef(null)
  const liveRef = useRef(null)
  const [stage, setStage] = useState({ w: 300, h: 300 })
  const live = useRef(null) // the stroke or crop being drawn
  const [cropBox, setCropBox] = useState(null)
  const busy = useRef(false)

  const myWindow = () => rootRef.current?.closest(".window[data-window-index]") || null
  const hideSelf = () => !minimized && dispatch?.({ type: "toggle_minimize", payload: { index: windowIndex } })
  const showSelf = () => dispatch?.({ type: "focus_window", payload: { index: windowIndex } })

  // ---- taking the picture ----
  const start = async (mode = prefs.mode, { delay = prefs.delay, display = false } = {}) => {
    if (busy.current) return
    busy.current = true
    setStatus("")
    setSelMode(mode)
    try {
      if (display) {
        setPhase("capturing")
        const pic = await captureDisplay()
        return takeSnip(pic.canvas)
      }
      hideSelf()
      if (delay > 0) {
        setPhase("countdown")
        for (let left = delay; left > 0; left--) {
          setCount(left)
          await new Promise((r) => setTimeout(r, 1000))
        }
        setCount(0)
      }
      setPhase("capturing")
      await settle(160) // the window is out of the way and everything has drawn
      const pic = await captureScreen({ exclude: [myWindow()] })
      if (mode === "full") return takeSnip(pic.canvas)
      setShot(pic)
      setPhase("select")
    } catch (error) {
      console.warn("[snip]", error)
      showSelf()
      setPhase(base ? "edit" : "home")
      setStatus(
        display
          ? error?.name === "NotAllowedError"
            ? "Nothing was shared, so nothing was snipped."
            : "That window couldn't be captured."
          : /fetch|import|module|network/i.test(String(error?.message || error))
            ? "Snipping needs the internet the first time (it downloads its screen copier). Try again when you're online."
            : "The screen couldn't be captured. Try again."
      )
    } finally {
      busy.current = false
    }
  }

  const takeSnip = (canvas) => {
    setBase(canvas)
    setSteps([])
    setSaved(null)
    setShot(null)
    setPhase("edit")
    setTool("pen")
    showSelf()
  }

  const chosen = (rect) => {
    const r = toImageRect(rect, shot.scale, shot.canvas.width, shot.canvas.height)
    takeSnip(r ? cropCanvas(shot.canvas, r) : shot.canvas)
  }
  const cancelSelect = () => {
    setShot(null)
    setPhase(base ? "edit" : "home")
    showSelf()
  }

  // Ctrl+Shift+S, Run "snippingtool /rect" and the like
  useEffect(() => {
    if (!handoff?.start) return
    const mode = MODES.some((m) => m.id === handoff.start) ? handoff.start : "rect"
    start(mode, { delay: 0 })
  }, [handoff?.id])

  // ---- the picture with its markup, and what Save/Copy/Send use ----
  const picture = useMemo(() => (base ? compose(base, steps) : null), [base, steps])
  useEffect(() => {
    if (!picture) return setOut(null)
    let live = true
    setOut(null)
    ;(async () => {
      let blob = await canvasBlob(picture, "image/png")
      let ext = "png"
      if (blob && pickFormat(blob.size * 1.37) === "jpg") {
        blob = (await canvasBlob(picture, "image/jpeg", 0.92)) || blob
        ext = blob.type === "image/jpeg" ? "jpg" : "png"
      }
      if (!blob || !live) return
      const dataUrl = await blobDataUrl(blob)
      if (!live || !dataUrl) return
      setOut({ canvas: picture, blob, dataUrl, mime: blob.type, name: snipName(new Date(), ext) })
    })()
    return () => {
      live = false
    }
  }, [picture])

  // draw it on screen
  useLayoutEffect(() => {
    const c = viewRef.current
    if (!c || !picture) return
    c.width = picture.width
    c.height = picture.height
    c.getContext("2d").drawImage(picture, 0, 0)
    const l = liveRef.current
    l.width = picture.width
    l.height = picture.height
  }, [picture, phase])

  // the room for it
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight })
    measure()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [phase])

  // (a snip is taken at up to 2x for sharp text: shown at most at its real size on screen)
  const fit = picture ? fitBox(picture.width, picture.height, stage.w - 8, stage.h - 8, 1 / Math.max(1, Math.min(2, window.devicePixelRatio || 1))) : null

  // ---- markup ----
  const toPic = (e) => {
    const r = viewRef.current.getBoundingClientRect()
    const f = { scale: r.width / picture.width, x: 0, y: 0 }
    return viewToImage(e.clientX - r.left, e.clientY - r.top, f, picture.width, picture.height)
  }
  const viewScale = () => (viewRef.current ? viewRef.current.getBoundingClientRect().width / picture.width : 1)
  const drawLive = () => {
    const l = liveRef.current
    const g = l.getContext("2d")
    g.clearRect(0, 0, l.width, l.height)
    if (live.current?.type === "stroke") drawStroke(g, live.current.stroke)
  }
  const onDown = (e) => {
    if (!picture || (e.pointerType === "mouse" && e.button !== 0)) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = toPic(e)
    if (tool === "crop") {
      live.current = { type: "crop", x0: p.x, y0: p.y }
      setCropBox({ x: p.x, y: p.y, w: 0, h: 0 })
      return
    }
    const color = PEN_COLORS.find((c) => c.id === prefs.color)?.value || PEN_COLORS[0].value
    live.current = { type: "stroke", stroke: { tool, color, width: strokeWidth(tool, viewScale(), prefs.size), points: [[p.x, p.y]] } }
    drawLive()
  }
  const onMove = (e) => {
    const cur = live.current
    if (!cur) return
    const p = toPic(e)
    if (cur.type === "crop") return setCropBox(normRect(cur.x0, cur.y0, p.x, p.y))
    const points = addPoint(cur.stroke.points, p.x, p.y)
    if (points === cur.stroke.points) return
    cur.stroke = { ...cur.stroke, points }
    drawLive()
  }
  const onUp = () => {
    const cur = live.current
    live.current = null
    if (!cur) return
    if (cur.type === "crop") {
      const step = cropStep(cropBox, picture.width, picture.height)
      setCropBox(null)
      if (step) setSteps((s) => [...s, step])
      return
    }
    drawLive()
    setSteps((s) => [...s, { type: "stroke", stroke: cur.stroke }])
    setSaved(null)
  }
  useEffect(() => {
    // the live layer is cleared once the stroke is part of the picture
    const l = liveRef.current
    if (l && !live.current) l.getContext("2d").clearRect(0, 0, l.width, l.height)
  }, [picture])

  const undo = () => (setSteps((s) => s.slice(0, -1)), setSaved(null))

  // ---- Save / Copy / Send ----
  const save = async () => {
    if (!out) return
    setStatus("Saving...")
    const lib = await import("../photos/library")
    const result = await lib.savePicture(lib.picturesFolder(), out.name, out.dataUrl)
    if (!result.ok) return setStatus(result.error)
    setSaved(result.file)
    setStatus(`Saved as ${result.file.name} in My Pictures.`)
  }
  const copy = () => {
    if (!out) return
    copyImage(out.dataUrl).then((ok) => setStatus(ok ? "Copied. Paste it in Paint, Messenger or another app." : "Copied to the clipboard history (Ctrl+Shift+V). This browser didn't allow the device clipboard."))
  }
  const send = () => out && shareOut({ title: out.name, files: [{ name: out.name, data: out.blob, mime: out.mime }] }, "phone", { title: "Snipping Tool" })
  const openSaved = () => saved && dispatch?.({ type: "open_window", payload: photosWindow(saved) })

  // Ctrl+Z, Ctrl+S, Ctrl+C in the window
  const onKeyDown = (e) => {
    const ctrl = e.ctrlKey || e.metaKey
    if (!ctrl || e.shiftKey || phase !== "edit") return
    const k = e.key.toLowerCase()
    if (k === "z") (e.preventDefault(), undo())
    else if (k === "s") (e.preventDefault(), save())
    else if (k === "c" && !String(window.getSelection?.() || "")) (e.preventDefault(), copy())
  }

  const menus = [
    {
      label: "File",
      items: [
        { label: "New Snip", items: MODES.map((m) => ({ label: m.label, onClick: () => (setPrefs({ mode: m.id }), start(m.id)) })) },
        "-",
        { label: "Save to My Pictures", onClick: save, disabled: !out },
        { label: "Send To", disabled: !out, items: [{ label: "My Phone", onClick: send, disabled: !out }] },
        "-",
        { label: "Close", onClick: () => onClose?.() },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", onClick: undo, disabled: !steps.length },
        { label: "Copy", onClick: copy, disabled: !out },
      ],
    },
    { label: "Help", items: [helpItem({ program: "Snipping Tool" })] },
  ]

  const delaySummary = summarize(prefs.delay ? `Wait ${prefs.delay} seconds` : "No delay", !mobile && "Ctrl+Shift+S snips")
  const homeControls = (
    <div className="snipHome">
      <button type="button" className="snipNew" onClick={() => start()} disabled={phase === "capturing" || phase === "countdown"}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M2 2h5v1H3v4H2zM9 2h5v5h-1V3H9zM2 9h1v4h4v1H2zM13 9h1v5H9v-1h4z" fill="currentColor" />
        </svg>
        New snip
      </button>
      <div className="snipKinds" role="radiogroup" aria-label="Kind of snip">
        {MODES.map((m) => (
          <div key={m.id} className="field-row snipKind">
            <input id={`snip-mode-${windowIndex}-${m.id}`} type="radio" name={`snip-mode-${windowIndex}`} checked={prefs.mode === m.id} onChange={() => setPrefs({ mode: m.id })} />
            <label htmlFor={`snip-mode-${windowIndex}-${m.id}`}>{m.label}</label>
          </div>
        ))}
      </div>
      <MoreOptions id="snip.more" summary={delaySummary}>
        <div className="field-row snipDelay">
          <label htmlFor={`snip-delay-${windowIndex}`}>Delay:</label>
          <select id={`snip-delay-${windowIndex}`} value={prefs.delay} onChange={(e) => setPrefs({ delay: Number(e.target.value) })}>
            {DELAYS.map((d) => (
              <option key={d} value={d}>
                {d ? `${d} seconds` : "None"}
              </option>
            ))}
          </select>
        </div>
        <p className="snipSmall">With a delay, Snipping Tool steps aside so you can open a menu or switch windows first.</p>
        {canCaptureDisplay() && (
          <button type="button" onClick={() => start(prefs.mode, { display: true })}>
            Capture another window or screen...
          </button>
        )}
        {!mobile && <p className="snipSmall">Shortcut: Ctrl+Shift+S (Command+Shift+S on a Mac) snips a rectangle from anywhere in 98ish.</p>}
      </MoreOptions>
    </div>
  )

  const stageStyle = fit ? { width: fit.w, height: fit.h } : undefined
  const cropStyle =
    cropBox && picture && fit
      ? { left: cropBox.x * fit.scale, top: cropBox.y * fit.scale, width: cropBox.w * fit.scale, height: cropBox.h * fit.scale }
      : null

  return (
    <div ref={rootRef} className={`snipRoot${mobile ? " is-phone" : ""}`} data-phase={phase} onKeyDown={onKeyDown} tabIndex={-1}>
      <MenuBar menus={menus} />
      {phase !== "edit" ? (
        <div className="snipStart">
          {homeControls}
          {(phase === "capturing" || phase === "countdown") && <p className="snipSmall">Taking the picture...</p>}
          {status && (
            <p className="snipStatus" role="status">
              {status}
            </p>
          )}
          <p className="snipSmall snipAbout">Snips show what's in 98ish. Web pages from other sites inside a window show as a striped box.</p>
        </div>
      ) : (
        <>
          <div className="snipTools" role="toolbar" aria-label="Markup">
            <button type="button" className="snipToolNew" onClick={() => start()} title="New snip (the same kind as last time)">
              New
            </button>
            {[
              ["pen", "Pen"],
              ["highlighter", "Highlighter"],
              ["crop", "Crop"],
            ].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={tool === id} className={tool === id ? "is-on" : ""} onClick={() => setTool(id)}>
                <ToolIcon id={id} color={PEN_COLORS.find((c) => c.id === prefs.color)?.value} />
                {label}
              </button>
            ))}
            <button type="button" onClick={undo} disabled={!steps.length}>
              Undo
            </button>
          </div>
          <MoreOptions id="snip.pen" inline className="snipPenOpts" label="Pen" lessLabel="Pen" summary={summarize(PEN_COLORS.find((c) => c.id === prefs.color)?.label, prefs.size === "thick" ? "Thick" : "Thin")}>
            <div className="snipColors" role="radiogroup" aria-label="Pen color">
              {PEN_COLORS.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={prefs.color === c.id} aria-label={c.label} title={c.label} className={`snipSwatch${prefs.color === c.id ? " is-on" : ""}`} style={{ background: c.value }} onClick={() => (setPrefs({ color: c.id }), setTool("pen"))} />
              ))}
            </div>
            <button type="button" aria-pressed={prefs.size === "thick"} onClick={() => setPrefs({ size: prefs.size === "thick" ? "thin" : "thick" })}>
              {prefs.size === "thick" ? "Thick" : "Thin"}
            </button>
          </MoreOptions>
          <div className="snipStage" ref={stageRef}>
            <div className={`snipPaper tool-${tool}`} style={stageStyle} data-touch-surface onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onContextMenu={(e) => e.preventDefault()}>
              <canvas ref={viewRef} className="snipView" aria-label="Your snip" />
              <canvas ref={liveRef} className="snipLive" aria-hidden="true" />
              {cropStyle && <div className="snipCropBox" style={cropStyle} />}
            </div>
          </div>
          {status && (
            <p className="snipStatus" role="status">
              {status}
              {saved && (
                <button type="button" className="snipLink" onClick={openSaved}>
                  Open
                </button>
              )}
            </p>
          )}
          <PrimaryBar align="stretch" className="snipActions">
            <button type="button" onClick={save} disabled={!out}>
              Save
            </button>
            <button type="button" onClick={copy} disabled={!out}>
              Copy
            </button>
            <button type="button" onClick={send} disabled={!out}>
              Send to My Phone
            </button>
          </PrimaryBar>
        </>
      )}
      {phase === "countdown" &&
        createPortal(
          <div className="snipCountdown window" data-snip-hide role="status">
            {countdownText(count)}
          </div>,
          document.querySelector(".os-root") || document.body
        )}
      {phase === "capturing" &&
        createPortal(
          <div className="snipBusy" data-snip-hide aria-hidden="true" />,
          document.querySelector(".os-root") || document.body
        )}
      {phase === "select" && shot && <SelectOverlay shot={shot} mode={selMode} mobile={mobile} onMode={setSelMode} onDone={chosen} onCancel={cancelSelect} />}
    </div>
  )
}

const ToolIcon = ({ id, color = "#e00000" }) => {
  if (id === "pen")
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M11 2l3 3-8 8-4 1 1-4z" fill="#ffffff" stroke="#000" />
        <path d="M3 10l3 3" stroke={color} strokeWidth="2" />
      </svg>
    )
  if (id === "highlighter")
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M2 11h12v3H2z" fill={HIGHLIGHT.color} />
        <path d="M6 9l5-7 3 2-5 7z" fill="#ffffa0" stroke="#000" />
      </svg>
    )
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 1v11h11M1 4h11v11" fill="none" stroke="#000" strokeWidth="1.5" />
    </svg>
  )
}

export default SnippingTool
