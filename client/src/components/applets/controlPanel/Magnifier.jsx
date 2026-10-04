import React, { useEffect, useRef, useState } from "react"
import { launch } from "../../../utils/programs"
import { setSettings, useSettings } from "../../../utils/settings"
import { Check } from "./Sheet"
import "./ControlPanel.css"

// Magnifier, as in Windows 98: a window showing the screen around the mouse pointer (or the
// keyboard focus) bigger. It shows a copy of the desktop, scaled: the copy lives in a
// closed shadow root (so nothing else finds its elements), is refreshed when the desktop
// changes (at most twice a second, and every second while something draws on a canvas),
// and only its position moves with the pointer. Pages from other sites (Internet Explorer,
// videos) show as gray boxes. Phones get larger tap targets instead (Accessibility Options).

const REFRESH_MS = 450

// copy what cloneNode leaves behind: canvas pixels, typed text, scroll positions; and
// leave out what mustn't run twice (frames, video, sound) and the Magnifier itself
const prepare = (orig, copy, skip, scrolled) => {
  if (orig === skip) {
    copy.replaceChildren()
    copy.style.background = "#808080"
    return
  }
  if (copy.id) copy.removeAttribute("id")
  if (copy.hasAttribute("autofocus")) copy.removeAttribute("autofocus")
  const tag = orig.tagName
  if (tag === "CANVAS") {
    try {
      copy.getContext("2d")?.drawImage(orig, 0, 0)
    } catch {
      // a canvas that can't be read: left blank
    }
  } else if (tag === "IFRAME" || tag === "VIDEO" || tag === "AUDIO" || tag === "OBJECT" || tag === "EMBED") {
    const box = document.createElement("div")
    box.style.cssText = `${orig.getAttribute("style") || ""};background:#808080;`
    box.className = orig.className
    copy.replaceWith(box)
    return
  } else if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    if (orig.type === "checkbox" || orig.type === "radio") copy.checked = orig.checked
    else if (orig.type !== "file") copy.value = orig.value
  }
  if (orig.scrollTop || orig.scrollLeft) scrolled.push([copy, orig.scrollTop, orig.scrollLeft])
  const a = orig.children
  const b = copy.children
  for (let i = 0; i < a.length && i < b.length; i++) prepare(a[i], b[i], skip, scrolled)
}

// the page's styles, copied into the shadow root (new ones arrive as programs load)
const copyStyles = (shadow, count) => {
  const sheets = [...document.querySelectorAll('style, link[rel="stylesheet"]')]
  if (sheets.length === count.n) return
  count.n = sheets.length
  shadow.querySelectorAll("[data-mag-style]").forEach((el) => el.remove())
  const frag = document.createDocumentFragment()
  for (const s of sheets) {
    const c = s.cloneNode(true)
    c.setAttribute("data-mag-style", "")
    frag.appendChild(c)
  }
  shadow.prepend(frag)
}

const Magnifier = ({ mobile, dispatch }) => {
  const settings = useSettings()
  const viewRef = useRef(null)
  const stageRef = useRef(null)
  const state = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2, shadow: null, styles: { n: -1 }, dirty: true })
  const [status, setStatus] = useState("")
  const zoom = settings.magZoom || 2
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // where to look: the stage moves so (x, y) sits in the middle of the view
  const place = () => {
    const view = viewRef.current
    const stage = stageRef.current
    if (!view || !stage) return
    const { x, y } = state.current
    const w = view.clientWidth
    const h = view.clientHeight
    const W = window.innerWidth
    const H = window.innerHeight
    const left = Math.min(0, Math.max(w - W * zoom, w / 2 - x * zoom))
    const top = Math.min(0, Math.max(h - H * zoom, h / 2 - y * zoom))
    stage.style.width = `${W}px`
    stage.style.height = `${H}px`
    stage.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px) scale(${zoom})`
  }

  const rebuild = () => {
    const s = state.current
    const root = document.querySelector(".os-root")
    const stage = stageRef.current
    if (!root || !stage) return
    if (!s.shadow) s.shadow = stage.attachShadow({ mode: "closed" })
    copyStyles(s.shadow, s.styles)
    const copy = root.cloneNode(true)
    const scrolled = []
    prepare(root, copy, viewRef.current?.closest(".desktopWindow, .mobileWindow") || null, scrolled)
    copy.setAttribute("inert", "")
    copy.setAttribute("aria-hidden", "true")
    copy.style.position = "absolute"
    copy.style.inset = "0"
    s.shadow.querySelector(".os-root")?.remove()
    s.shadow.appendChild(copy)
    for (const [el, top, left] of scrolled) {
      el.scrollTop = top
      el.scrollLeft = left
    }
    s.dirty = false
  }

  useEffect(() => {
    if (mobile) return
    const s = state.current
    const view = viewRef.current
    const mine = (node) => !!(node && view?.closest(".desktopWindow, .mobileWindow")?.contains(node.nodeType === 1 ? node : node.parentNode))
    rebuild()
    place()

    // the desktop changed: copy it again, at most every REFRESH_MS
    const observer = new MutationObserver((records) => {
      if (records.every((r) => mine(r.target))) return
      s.dirty = true
    })
    observer.observe(document.querySelector(".os-root"), { subtree: true, childList: true, attributes: true, characterData: true })
    let tick = 0
    const timer = setInterval(() => {
      tick++
      const drawing = tick % 2 === 0 && document.querySelector(".os-root canvas")
      if (s.dirty || drawing) {
        rebuild()
        place()
      }
    }, REFRESH_MS)

    let frame = 0
    const follow = (x, y) => {
      s.x = x
      s.y = y
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          place()
          setStatus(`${Math.round(s.x)}, ${Math.round(s.y)}`)
        })
    }
    const onMove = (e) => {
      if (!settingsRef.current.magFollowMouse || e.pointerType === "touch") return
      // over the Magnifier itself: hold still
      if (mine(e.target)) return
      follow(e.clientX, e.clientY)
    }
    const onFocus = (e) => {
      if (!settingsRef.current.magFollowFocus || mine(e.target) || !(e.target instanceof Element)) return
      const r = e.target.getBoundingClientRect()
      if (!r.width && !r.height) return
      follow(r.left + Math.min(r.width / 2, 120), r.top + r.height / 2)
    }
    const onResize = () => place()
    window.addEventListener("pointermove", onMove, { passive: true })
    window.addEventListener("focusin", onFocus)
    window.addEventListener("resize", onResize)
    const sizes = new ResizeObserver(() => place())
    sizes.observe(view)
    return () => {
      observer.disconnect()
      sizes.disconnect()
      clearInterval(timer)
      cancelAnimationFrame(frame)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("focusin", onFocus)
      window.removeEventListener("resize", onResize)
    }
  }, [mobile])

  useEffect(() => place(), [zoom])

  if (mobile)
    return (
      <div className="magRoot">
        <div className="magPhone">
          <div className="cplHead">
            <img src="/assets/program_icons/cpl/magnifier.svg" alt="" />
            <p>Magnifier follows a mouse pointer, so it's for computers. On a phone, your phone's own zoom works with 98ish (on iPhone: Settings, Accessibility, Zoom).</p>
          </div>
          <Check label="Larger tap targets (buttons, menus and lists)" checked={settings.tapTargets === "large"} onChange={(on) => setSettings({ tapTargets: on ? "large" : "normal" })} />
          <div className="cplRow">
            <button type="button" onClick={() => dispatch({ type: "open_window", payload: launch("Accessibility Options") })}>
              Accessibility Options...
            </button>
          </div>
        </div>
      </div>
    )

  return (
    <div className="magRoot">
      <div className="magView" ref={viewRef} aria-hidden="true">
        <div className="magStage" ref={stageRef} />
      </div>
      <div className="magBar">
        <label htmlFor="mag-zoom">Magnification:</label>
        <select id="mag-zoom" value={String(zoom)} onChange={(e) => setSettings({ magZoom: Number(e.target.value) })}>
          {[2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}x
            </option>
          ))}
        </select>
        <Check label="Mouse" checked={settings.magFollowMouse} onChange={(magFollowMouse) => setSettings({ magFollowMouse })} />
        <Check label="Keyboard focus" checked={settings.magFollowFocus} onChange={(magFollowFocus) => setSettings({ magFollowFocus })} />
        <span className="cplHint" style={{ marginLeft: "auto" }} data-mag-at>
          {status}
        </span>
      </div>
    </div>
  )
}

export default Magnifier
