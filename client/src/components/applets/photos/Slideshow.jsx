import React, { useEffect, useMemo, useRef, useState } from "react"
import { fs, readContent } from "../../../utils/fs"
import { reducedMotion } from "../../../utils/settings"
import { TUNES, playMusic } from "./music"

// A slideshow over the Photos window (or the whole screen, where the browser allows it):
// each picture comes in with a transition and moves while it shows (a gentle drift, or a
// Ken Burns pan and zoom), with music if chosen (three original tunes, or your own sound).
// Tap or move the mouse for the controls; Escape, or Stop, ends it. Arrow keys and swipes
// step through. Memories open it with a title card first.
//
// items: drive pictures by default; anything else (a shared album's photos) passes
// getSrc(item) -> URL or null (shows a placeholder until it loads) and prefetch(item) ->
// promise (the slideshow redraws when it resolves).

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
export const MOTIONS = [
  { id: "kenburns", label: "Ken Burns" },
  { id: "drift", label: "Drift" },
  { id: "still", label: "Still" },
]
const KINDS = TRANSITIONS.filter((t) => t.id !== "random").map((t) => t.id)

const driveSrc = (item) => item.textContent || item.thumb || null
const drivePrefetch = (item) => readContent(item)

// a pan and zoom for one picture: where it starts and ends (scale, x %, y %)
const kenBurns = (index) => {
  const r = (n) => {
    const x = Math.sin((index + 1) * 9301 + n * 49297) * 233280
    return x - Math.floor(x)
  }
  const zoomIn = r(1) > 0.4
  const s0 = zoomIn ? 1.04 : 1.22
  const s1 = zoomIn ? 1.22 : 1.04
  const p = () => `${((r(2 + Math.random()) - 0.5) * 7).toFixed(1)}%`
  return { "--kb-s0": s0, "--kb-s1": s1, "--kb-x0": p(), "--kb-y0": p(), "--kb-x1": p(), "--kb-y1": p() }
}

export const soundFiles = () => {
  const out = []
  const walk = (dir) => {
    for (const item of dir.content || []) {
      if (item.isDirectory) walk(item)
      else if (item.type === "sound") out.push(item)
    }
  }
  const drive = fs.resolve("C:")
  if (drive?.isDirectory) walk(drive)
  return out.slice(0, 200)
}

const Slideshow = ({ items, start = 0, prefs, onPrefs, onExit, getSrc = driveSrc, prefetch = drivePrefetch, title = null, subtitle = null }) => {
  const [index, setIndex] = useState(Math.min(start, items.length - 1))
  const [prev, setPrev] = useState(null)
  const [kind, setKind] = useState(prefs.transition === "random" ? "fade" : prefs.transition)
  const [playing, setPlaying] = useState(true)
  const [controls, setControls] = useState(true)
  const [card, setCard] = useState(!!title)
  const [, setLoaded] = useState(0)
  const rootRef = useRef(null)
  const hideTimer = useRef(null)
  const touch = useRef(null)
  const motion = reducedMotion() ? "still" : prefs.motion || "kenburns"
  const music = prefs.music || "none"
  const musicFile = useMemo(() => (music === "file" && prefs.musicFile ? fs.resolve(prefs.musicFile) : null), [music, prefs.musicFile])
  const sounds = useMemo(() => (music === "file" ? soundFiles() : []), [music])

  const count = items.length
  const go = (step) => {
    if (!count) return
    setCard(false)
    setPrev(index)
    setIndex((i) => (i + step + count) % count)
    setKind(prefs.transition === "random" ? KINDS[Math.floor(Math.random() * KINDS.length)] : prefs.transition)
  }
  const goRef = useRef(go)
  goRef.current = go

  // this picture and the next load while it shows
  useEffect(() => {
    let alive = true
    const wake = () => alive && setLoaded((n) => n + 1)
    Promise.resolve(prefetch(items[index]))
      .then(wake)
      .catch(() => {})
    if (count > 1)
      Promise.resolve(prefetch(items[(index + 1) % count]))
        .then(wake)
        .catch(() => {})
    return () => {
      alive = false
    }
  }, [index, count])

  // the title card, then the next picture after the chosen time
  useEffect(() => {
    if (!card) return
    const id = setTimeout(() => setCard(false), 2600)
    return () => clearTimeout(id)
  }, [card])
  useEffect(() => {
    if (!playing || count < 2 || card) return
    const id = setTimeout(() => goRef.current(1), prefs.seconds * 1000)
    return () => clearTimeout(id)
  }, [index, playing, prefs.seconds, count, card])

  // music while it plays
  useEffect(() => {
    if (!playing || music === "none") return
    const player = playMusic(music, { file: musicFile })
    return () => player.stop()
  }, [playing, music, musicFile])

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
  const dur = `${prefs.seconds + 1.5}s`
  const slide = (it, i, cls) => {
    const src = getSrc(it)
    const img = src ? <img className={`phSlideImg ${cls}`} src={src} alt={i === index ? it.name || "Photo" : ""} draggable={false} /> : <div className="phSlideWait">Loading...</div>
    return (
      <div key={`${cls}${i}-${index}`} className={`phSlide phMotion--${motion}${cls === "phSlide--out" ? " phSlide--out" : ""}`} style={motion === "kenburns" ? { ...kenBurns(i), "--kb-dur": dur } : undefined}>
        {img}
      </div>
    )
  }
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
      data-touch-surface
    >
      {prev !== null && items[prev] && slide(items[prev], prev, "phSlide--out")}
      {slide(item, index, `phSlide--in phIn--${kind}`)}
      {card && (
        <div className="phShowCard" aria-live="polite">
          <div className="phShowCardTitle">{title}</div>
          {subtitle && <div className="phShowCardSub">{subtitle}</div>}
        </div>
      )}
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
        <select aria-label="Motion" value={prefs.motion || "kenburns"} onChange={(e) => onPrefs({ motion: e.target.value })}>
          {MOTIONS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
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
        <select aria-label="Music" value={music} onChange={(e) => onPrefs({ music: e.target.value })}>
          {TUNES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {music === "file" && (
          <select aria-label="Your sound" value={prefs.musicFile || ""} onChange={(e) => onPrefs({ musicFile: e.target.value })}>
            <option value="">{sounds.length ? "Pick a sound..." : "No sounds on drive C:"}</option>
            {sounds.map((s) => (
              <option key={fs.displayPath(s)} value={fs.displayPath(s)}>
                {s.name}
              </option>
            ))}
          </select>
        )}
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
