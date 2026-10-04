import React, { useEffect, useRef, useState } from "react"

// A slideshow over the Photos window (or the whole screen, where the browser allows it):
// each picture comes in with a transition and drifts slowly while it shows. Tap or move the
// mouse for the controls; Escape, or Stop, ends it. Arrow keys and swipes step through.

export const TRANSITIONS = [
  { id: "random", label: "Random" },
  { id: "fade", label: "Fade" },
  { id: "slide", label: "Slide" },
  { id: "zoom", label: "Zoom" },
  { id: "wipe", label: "Wipe" },
  { id: "iris", label: "Iris" },
]
export const SPEEDS = [
  { id: 2, label: "Fast (2 s)" },
  { id: 4, label: "Medium (4 s)" },
  { id: 8, label: "Slow (8 s)" },
]
const KINDS = TRANSITIONS.filter((t) => t.id !== "random").map((t) => t.id)

const Slideshow = ({ items, start = 0, prefs, onPrefs, onExit }) => {
  const [index, setIndex] = useState(Math.min(start, items.length - 1))
  const [prev, setPrev] = useState(null)
  const [kind, setKind] = useState(prefs.transition === "random" ? "fade" : prefs.transition)
  const [playing, setPlaying] = useState(true)
  const [controls, setControls] = useState(true)
  const rootRef = useRef(null)
  const hideTimer = useRef(null)
  const touch = useRef(null)

  const count = items.length
  const go = (step) => {
    if (!count) return
    setPrev(index)
    setIndex((i) => (i + step + count) % count)
    setKind(prefs.transition === "random" ? KINDS[Math.floor(Math.random() * KINDS.length)] : prefs.transition)
  }
  const goRef = useRef(go)
  goRef.current = go

  // the next picture after the chosen time
  useEffect(() => {
    if (!playing || count < 2) return
    const id = setTimeout(() => goRef.current(1), prefs.seconds * 1000)
    return () => clearTimeout(id)
  }, [index, playing, prefs.seconds, count])

  const poke = () => {
    setControls(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControls(false), 2600)
  }
  useEffect(() => {
    poke()
    rootRef.current?.focus({ preventScroll: true })
    return () => clearTimeout(hideTimer.current)
  }, [])

  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    onExit(items[index])
  }

  const onKeyDown = (e) => {
    if (e.key === "Escape") return e.stopPropagation(), exit()
    if (e.key === "ArrowRight" || e.key === "PageDown") return go(1)
    if (e.key === "ArrowLeft" || e.key === "PageUp") return go(-1)
    if (e.key === " ") {
      e.preventDefault()
      setPlaying((p) => !p)
    }
    poke()
  }

  const fullScreen = () => {
    const el = rootRef.current
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else el?.requestFullscreen?.().catch(() => {})
  }
  const canFullScreen = typeof document !== "undefined" && !!document.documentElement.requestFullscreen

  const item = items[index]
  if (!item) return null
  return (
    <div
      ref={rootRef}
      className={`phShow${controls ? "" : " is-quiet"}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerMove={(e) => e.pointerType === "mouse" && poke()}
      onPointerDown={(e) => {
        touch.current = { x: e.clientX, y: e.clientY, t: performance.now() }
      }}
      onPointerUp={(e) => {
        const t = touch.current
        touch.current = null
        if (!t || e.target.closest(".phShowBar")) return
        const dx = e.clientX - t.x
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - t.y)) go(dx < 0 ? 1 : -1)
        else if (controls && e.pointerType !== "mouse") setControls(false)
        else poke()
      }}
      role="dialog"
      aria-label="Slideshow"
    >
      {prev !== null && items[prev] && <img key={`p${prev}-${index}`} className="phSlide phSlide--out" src={items[prev].textContent} alt="" draggable={false} />}
      <img key={`c${index}`} className={`phSlide phSlide--in phIn--${kind}`} src={item.textContent} alt={item.name} draggable={false} />
      <div className="phShowBar" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => go(-1)} aria-label="Previous picture">
          ◀︎
        </button>
        <button type="button" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶︎"}
        </button>
        <button type="button" onClick={() => go(1)} aria-label="Next picture">
          ▶︎▶︎
        </button>
        <select aria-label="Transition" value={prefs.transition} onChange={(e) => onPrefs({ transition: e.target.value })}>
          {TRANSITIONS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <select aria-label="Speed" value={prefs.seconds} onChange={(e) => onPrefs({ seconds: Number(e.target.value) })}>
          {SPEEDS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="phShowCount">
          {index + 1} / {count}
        </span>
        {canFullScreen && (
          <button type="button" onClick={fullScreen}>
            Full Screen
          </button>
        )}
        <button type="button" onClick={exit}>
          Stop
        </button>
      </div>
    </div>
  )
}

export default Slideshow
