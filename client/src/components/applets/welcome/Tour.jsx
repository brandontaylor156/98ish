import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { launch } from "../../../utils/programs"
import { TOUR_STEPS, endTour, setTourStep, useTour, welcomeWindow } from "../../../utils/welcome"
import { STEPS, targetsFor } from "./tourSteps"
import { BannerComputer, InfoIcon } from "./art"
import "./Tour.css"

// The guided tour: dims the screen except for the thing it's talking about, and explains
// it in a yellow help balloon (a sheet along the top or bottom on phones). It opens what
// each stop needs (the Start menu, Tetris...) and closes it again afterwards. Enter or
// Space goes on, Esc leaves; the step is saved so the Welcome screen can pick it up again.

const PAD = 6 // around the lit-up area
const GAP = 14 // between it and the balloon

const union = (rects) =>
  rects.length
    ? rects.reduce((r, b) => ({ left: Math.min(r.left, b.left), top: Math.min(r.top, b.top), right: Math.max(r.right, b.right), bottom: Math.max(r.bottom, b.bottom) }))
    : null

// the lit-up areas: one per element (a menu and its submenus), padded and kept on screen
const holesFor = (els, merge) => {
  const rects = els
    .map((el) => el.getBoundingClientRect())
    .filter((b) => b.width && b.height)
    .map((b) => ({
      left: Math.max(0, Math.round(b.left - PAD)),
      top: Math.max(0, Math.round(b.top - PAD)),
      right: Math.min(window.innerWidth, Math.round(b.right + PAD)),
      bottom: Math.min(window.innerHeight, Math.round(b.bottom + PAD)),
    }))
  return merge && rects.length ? [union(rects)] : rects
}

const sameRects = (a, b) =>
  a.length === b.length && a.every((r, i) => r.left === b[i].left && r.top === b[i].top && r.right === b[i].right && r.bottom === b[i].bottom)

// The dimmed screen with holes cut in it, as one SVG path: the screen clockwise, then the
// holes split into cells that don't overlap (overlapping holes would fill each other back
// in), each counterclockwise. Clicks in a hole go through to what's under it.
const dimPath = (rects, vw, vh) => {
  let d = `M0 0H${vw}V${vh}H0Z`
  if (!rects.length) return d
  const xs = [...new Set(rects.flatMap((r) => [r.left, r.right]))].sort((a, b) => a - b)
  const ys = [...new Set(rects.flatMap((r) => [r.top, r.bottom]))].sort((a, b) => a - b)
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2
      const cy = (ys[j] + ys[j + 1]) / 2
      if (rects.some((r) => cx > r.left && cx < r.right && cy > r.top && cy < r.bottom)) d += `M${xs[i]} ${ys[j]}V${ys[j + 1]}H${xs[i + 1]}V${ys[j]}Z`
    }
  }
  return d
}

// Where the balloon goes next to the lit-up area: the step's choice first ("right" for
// windows), then below, above, right or left, whichever fits
const placeBalloon = (hole, size, vw, vh, prefer) => {
  const { w, h } = size
  const clampX = (x) => Math.max(8, Math.min(x, vw - w - 8))
  const clampY = (y) => Math.max(8, Math.min(y, vh - h - 8))
  if (!hole) return { left: (vw - w) / 2, top: Math.max(8, (vh - h) / 2.4), side: null }
  const cx = (hole.left + hole.right) / 2
  const cy = (hole.top + hole.bottom) / 2
  const tryBelow = hole.bottom + GAP + h <= vh - 4
  const tryAbove = hole.top - GAP - h >= 4
  const tryRight = hole.right + GAP + w <= vw - 4
  const tryLeft = hole.left - GAP - w >= 4
  if (prefer === "right" && tryRight) {
    const top = clampY(cy - h / 2)
    return { left: hole.right + GAP, top, side: "left", tail: Math.max(18, Math.min(cy - top, h - 18)) }
  }
  if (tryBelow) {
    const left = clampX(cx - w / 2)
    return { left, top: hole.bottom + GAP, side: "top", tail: Math.max(18, Math.min(cx - left, w - 18)) }
  }
  if (tryAbove) {
    const left = clampX(cx - w / 2)
    return { left, top: hole.top - GAP - h, side: "bottom", tail: Math.max(18, Math.min(cx - left, w - 18)) }
  }
  if (tryRight) {
    const top = clampY(cy - h / 2)
    return { left: hole.right + GAP, top, side: "left", tail: Math.max(18, Math.min(cy - top, h - 18)) }
  }
  if (tryLeft) {
    const top = clampY(cy - h / 2)
    return { left: hole.left - GAP - w, top, side: "right", tail: Math.max(18, Math.min(cy - top, h - 18)) }
  }
  // the lit-up area fills the screen: sit inside it, near the bottom
  return { left: clampX(cx - w / 2), top: clampY(hole.bottom - h - 24), side: null }
}

const Tour = ({ windows, dispatch, setStartMenuVisible, mobile }) => {
  const tour = useTour()
  const index = tour?.step ?? 0
  const id = TOUR_STEPS[index]
  const step = STEPS[id]
  const last = index === TOUR_STEPS.length - 1

  const windowsRef = useRef(windows)
  windowsRef.current = windows
  const opened = useRef(new Set()) // programs the tour opened, to close again
  const startShown = useRef(null) // the Start menu path it opened, as a string
  const timers = useRef([])
  const balloonRef = useRef(null)
  const [holes, setHoles] = useState([])
  const [size, setSize] = useState({ w: 320, h: 170 })
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })

  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms))
  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  const findWindow = (name) => windowsRef.current.findLastIndex((w) => !w.closed && w.program === name && !w.netId)
  const ctx = {
    mobile,
    all: (selector) => [...document.querySelectorAll(selector)],
    win: (name) => {
      const i = findWindow(name)
      return i < 0 ? null : document.querySelector(`.window[data-window-index="${i}"]`)
    },
  }

  // ---- opening and closing what each stop needs ----

  const openProgram = (name) => {
    const i = findWindow(name)
    if (i >= 0) {
      if (windowsRef.current[i].minimized || !windowsRef.current[i].active) dispatch({ type: "focus_window", payload: { index: i } })
      return
    }
    opened.current.add(name)
    // on a big screen, leave room beside the window for the balloon
    const extra = mobile ? {} : { initialX: 40, positionY: 40 }
    dispatch({ type: "open_window", payload: launch(name, extra) })
  }

  const closeProgram = (name) => {
    opened.current.delete(name)
    const i = findWindow(name)
    if (i >= 0) dispatch({ type: "close_window", payload: { index: i } })
  }

  // click down a path of Start menu items ("Programs", "Games"), as the menu draws them
  const walkStart = (path, tries = 0) => {
    if (!path.length) return
    const [label, ...rest] = path
    const back = document.querySelector(".startMenu .smBack .smLabel")
    if (back?.textContent === label) return walkStart(rest, tries)
    const item = [...document.querySelectorAll(".startMenu .smItem")].find((li) => li.querySelector(":scope > .smLabel")?.textContent === label)
    if (!item) return tries < 20 && later(() => walkStart(path, tries + 1), 50)
    if (!item.classList.contains("is-open")) item.click()
    later(() => walkStart(rest), 60)
  }

  const showStart = (want) => {
    const key = want ? JSON.stringify(want) : null
    if (key === startShown.current) return
    const had = startShown.current
    startShown.current = key
    if (!want) return had && setStartMenuVisible(false)
    // start again from the top, so a submenu left open from another stop closes
    if (had) setStartMenuVisible(false)
    later(() => {
      setStartMenuVisible(true)
      if (Array.isArray(want)) later(() => walkStart(mobile ? want.slice(0, 1) : want), 40)
    }, had ? 30 : 0)
  }

  // drag the window a little by its title bar, and back
  const nudge = (name) => {
    if (mobile) return
    const i = findWindow(name)
    if (i < 0) return
    const { x, y } = windowsRef.current[i]
    if (typeof x !== "number") return
    const path = [0, 12, 26, 40, 50, 56, 60, 60, 56, 48, 36, 22, 10, 0]
    path.forEach((dx, n) => later(() => dispatch({ type: "move_window", payload: { index: i, x: x + dx, y: y + Math.round(dx / 3) } }), 600 + n * 45))
  }

  const cleanUp = () => {
    clearTimers()
    ;[...opened.current].forEach(closeProgram)
    showStart(null)
  }

  useEffect(() => {
    if (!step) return
    clearTimers()
    for (const name of [...opened.current]) if (name !== step.program) closeProgram(name)
    if (step.program) openProgram(step.program)
    showStart(step.start || null)
    if (step.demo === "drag") later(() => nudge(step.program), 200)
  }, [index])

  // ---- leaving ----

  const finish = (backToWelcome) => {
    cleanUp()
    const from = tour?.fromWelcome
    endTour(last)
    if (backToWelcome ?? from) dispatch({ type: "open_window", payload: welcomeWindow(mobile) })
  }

  const go = (to) => {
    if (to < 0) return
    if (to >= TOUR_STEPS.length) return finish(false)
    setTourStep(to)
  }

  // ---- following what's lit up (windows move, menus open, things load) ----

  useEffect(() => {
    let frame
    const tick = () => {
      const next = step ? holesFor(targetsFor(step, ctx), step.merge) : []
      setHoles((h) => (sameRects(h, next) ? h : next))
      const b = balloonRef.current
      if (b) setSize((s) => (Math.abs(s.w - b.offsetWidth) < 1 && Math.abs(s.h - b.offsetHeight) < 1 ? s : { w: b.offsetWidth, h: b.offsetHeight }))
      setVp((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }))
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [index, mobile])

  // ---- keyboard: Enter / Space / right arrow go on, left arrow back, Esc leaves ----

  useEffect(() => {
    const onKey = (e) => {
      const inBalloon = e.target.closest?.(".tourBalloon")
      if (inBalloon && e.target.tagName === "BUTTON" && (e.key === "Enter" || e.key === " ")) return
      let act = null
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") act = () => go(index + 1)
      else if (e.key === "ArrowLeft") act = () => go(index - 1)
      else if (e.key === "Escape") act = () => finish()
      if (!act) return
      e.preventDefault()
      e.stopImmediatePropagation()
      act()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  })

  // keyboard focus on the balloon (not left in a game that listens for keys)
  useLayoutEffect(() => {
    balloonRef.current?.focus({ preventScroll: true })
  }, [index])

  // logging off / closing the tab mid-tour: put things back
  useEffect(() => () => clearTimers(), [])

  if (!tour || !step) return null

  const vw = vp.w
  const vh = vp.h
  const hole = union(holes)
  const centered = !hole
  // phones: a sheet along whichever edge is farther from what's lit up
  const sheetTop = mobile && hole && (hole.top + hole.bottom) / 2 > vh / 2
  const spot = mobile ? null : placeBalloon(hole, size, vw, vh, step.place)
  const balloonStyle = mobile ? undefined : { left: spot.left, top: spot.top, "--tail": `${spot.tail ?? 0}px` }
  const balloonClass =
    "tourBalloon" +
    (mobile ? (sheetTop ? " tourSheet tourSheet--top" : " tourSheet tourSheet--bottom") : "") +
    (centered ? " tourBalloon--card" : "") +
    (!mobile && spot.side ? ` tourTail--${spot.side}` : "")

  return (
    <div className={mobile ? "tourLayer tourLayer--phone" : "tourLayer"} data-step={id}>
      <svg className="tourDim" width={vw} height={vh} viewBox={`0 0 ${vw} ${vh}`} aria-hidden="true">
        <path d={dimPath(holes, vw, vh)} />
      </svg>
      {holes.map((r, i) => (
        <div key={i} className="tourRing" style={{ left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top }} />
      ))}
      <div
        ref={balloonRef}
        className={balloonClass}
        style={balloonStyle}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        tabIndex={-1}
        key={id}
      >
        <button type="button" className="tourX" aria-label="Leave the tour" title="Leave the tour" onClick={() => finish()}>
          {"×"}
        </button>
        {centered && (
          <div className="tourArt">
            <BannerComputer />
          </div>
        )}
        <div className="tourHead">
          <InfoIcon />
          <b id="tour-title">{step.title}</b>
        </div>
        <p id="tour-text">{step.text(mobile)}</p>
        <div className="tourFoot">
          <span className="tourCount">
            {index + 1} of {TOUR_STEPS.length}
          </span>
          {last ? (
            <>
              <button type="button" onClick={() => finish(true)}>
                Welcome screen
              </button>
              <button type="button" className="tourNext" onClick={() => finish(false)}>
                Done
              </button>
            </>
          ) : (
            <>
              {index > 0 ? (
                <button type="button" onClick={() => go(index - 1)}>
                  {"‹"} Back
                </button>
              ) : (
                <button type="button" onClick={() => finish()}>
                  Not now
                </button>
              )}
              <button type="button" className="tourNext" onClick={() => go(index + 1)}>
                {index === 0 ? "Let's go" : "Next"} {"›"}
              </button>
            </>
          )}
        </div>
        {!last && index > 0 && (
          <button type="button" className="tourSkip" onClick={() => finish()}>
            Skip tour
          </button>
        )}
        {!mobile && !last && <span className="tourKeys">Enter: next {"·"} Esc: leave</span>}
      </div>
    </div>
  )
}

export default Tour
