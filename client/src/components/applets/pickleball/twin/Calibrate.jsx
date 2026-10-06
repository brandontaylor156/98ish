// Twin Replay: "show me the court". The user picks a clear moment of the video and taps the
// court's four corners in order (a little court picture shows which one next); a magnifier
// above the finger makes the tap exact on a phone, and a tapped corner can be dragged. Then
// the court's lines are drawn over the picture to check it fits.

import React, { useEffect, useRef, useState } from "react"
import { calibrate, COURT_POINTS, courtLinesImage } from "./core/homography.js"
import { grabFrame } from "./reader.js"

const CORNERS = COURT_POINTS.slice(0, 4)
const LOUPE = 120
const ZOOM = 3

// a tiny court seen from the near baseline, the next corner lit
const CourtPicture = ({ next }) => (
  <svg className="pkTwinCourtPic" viewBox="0 0 60 90" aria-hidden="true">
    <polygon points="14,8 46,8 56,84 4,84" fill="#2f62ad" stroke="#fff" strokeWidth="1.5" />
    <line x1="10" y1="40" x2="50" y2="40" stroke="#fff" strokeWidth="1" />
    <line x1="8" y1="56" x2="52" y2="56" stroke="#fff" strokeWidth="1" />
    <line x1="7" y1="48" x2="53" y2="48" stroke="#ddd" strokeWidth="2" />
    {[
      [4, 84],
      [56, 84],
      [46, 8],
      [14, 8],
    ].map(([x, y], i) => (
      <circle key={i} cx={x} cy={y} r={i === next ? 5 : 3} fill={i === next ? "#ffd400" : i < next ? "#3c3" : "#fff"} stroke="#000" strokeWidth="0.8" />
    ))}
    <text x="30" y="89" fontSize="6" textAnchor="middle" fill="#000">
      you
    </text>
  </svg>
)

// snap (Live Broadcast): () => Promise<{ canvas, duration, vw, vh }>, a picture from the live
// camera instead of a video's moment (no slider; "New picture" takes another); doneLabel
export const Calibrate = ({ blob, snap = null, initial, players: initialPlayers = 4, onDone, onCancel, doneLabel = "Read the game" }) => {
  const [frame, setFrame] = useState(null) // { canvas, duration }
  const [t, setT] = useState(2)
  const [taps, setTaps] = useState(initial || [])
  const [players, setPlayers] = useState(initialPlayers)
  const [loupe, setLoupe] = useState(null) // { x, y (css px in the box), u, v }
  const [error, setError] = useState(null)
  const boxRef = useRef(null)
  const viewRef = useRef(null)
  const loupeRef = useRef(null)
  const drag = useRef(null)

  const [shot, setShot] = useState(0)
  useEffect(() => {
    let live = true
    ;(snap ? snap() : grabFrame(blob, t))
      .then((f) => live && setFrame(f))
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [blob, t, shot])

  const done = taps.filter((p) => CORNERS.some((c) => c.id === p.id)).length
  const W = frame?.canvas.width || 640
  const H = frame?.canvas.height || 360
  const cal = done >= 4 ? calibrate(taps.map((p) => ({ id: p.id, x: p.u * W, y: p.v * H }))) : null

  // draw the frame, the taps and (when calibrated) the court's lines
  useEffect(() => {
    const c = viewRef.current
    if (!c || !frame) return
    c.width = W
    c.height = H
    const g = c.getContext("2d")
    g.drawImage(frame.canvas, 0, 0)
    if (cal?.ok) {
      g.strokeStyle = "rgba(255,230,0,0.95)"
      g.lineWidth = 2
      for (const [a, b] of courtLinesImage(cal.Hinv)) {
        g.beginPath()
        g.moveTo(a[0], a[1])
        g.lineTo(b[0], b[1])
        g.stroke()
      }
    }
    taps.forEach((p, i) => {
      g.fillStyle = "#ffd400"
      g.strokeStyle = "#000"
      g.lineWidth = 2
      g.beginPath()
      g.arc(p.u * W, p.v * H, 6, 0, Math.PI * 2)
      g.fill()
      g.stroke()
      g.fillStyle = "#000"
      g.font = "bold 10px sans-serif"
      g.textAlign = "center"
      g.fillText(String(i + 1), p.u * W, p.v * H + 3.5)
    })
  }, [frame, taps, cal?.ok, W, H])

  // the magnifier: the frame around the finger, 3x, with a crosshair
  useEffect(() => {
    const c = loupeRef.current
    if (!c || !loupe || !frame) return
    c.width = LOUPE
    c.height = LOUPE
    const g = c.getContext("2d")
    const sw = LOUPE / ZOOM
    g.imageSmoothingEnabled = false
    g.drawImage(frame.canvas, loupe.u * W - sw / 2, loupe.v * H - sw / 2, sw, sw, 0, 0, LOUPE, LOUPE)
    g.strokeStyle = "#ff2"
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(LOUPE / 2, 0)
    g.lineTo(LOUPE / 2, LOUPE)
    g.moveTo(0, LOUPE / 2)
    g.lineTo(LOUPE, LOUPE / 2)
    g.stroke()
  }, [loupe, frame, W, H])

  const at = (e) => {
    const r = viewRef.current.getBoundingClientRect()
    const u = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const v = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
    const box = boxRef.current.getBoundingClientRect()
    return { u, v, x: e.clientX - box.left, y: e.clientY - box.top, r }
  }
  const onDown = (e) => {
    if (!frame) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = at(e)
    // (near an existing corner: move it)
    const near = taps.findIndex((q) => Math.hypot((q.u - p.u) * p.r.width, (q.v - p.v) * p.r.height) < 22)
    drag.current = { index: near >= 0 ? near : -1 }
    setLoupe(p)
  }
  const onMove = (e) => {
    if (!drag.current) return
    const p = at(e)
    setLoupe(p)
    if (drag.current.index >= 0) setTaps((ts) => ts.map((q, i) => (i === drag.current.index ? { ...q, u: p.u, v: p.v } : q)))
  }
  const onUp = (e) => {
    if (!drag.current) return
    const p = at(e)
    if (drag.current.index < 0 && done < 4) setTaps((ts) => [...ts, { id: CORNERS[ts.length].id, u: p.u, v: p.v }])
    drag.current = null
    setLoupe(null)
  }

  return (
    <div className="pkTwinCal">
      <div className="pkTwinCalHead">
        <CourtPicture next={done} />
        <div>
          <b>{done < 4 ? `Tap the ${CORNERS[done].label.toLowerCase()}` : cal?.ok ? "Do the yellow lines sit on the court's lines?" : cal?.reason || "Try again"}</b>
          <p className="pkMuted">{done < 4 ? "The outside corner of the lines. Hold and slide for the magnifier; drag a dot to fix it." : cal?.ok ? "If they're off, drag a corner dot until they match." : ""}</p>
        </div>
      </div>
      <div className="pkTwinCalBox" ref={boxRef}>
        {error && <p className="pkMuted">{error}</p>}
        <canvas ref={viewRef} className="pkTwinCalView" data-touch-surface onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => ((drag.current = null), setLoupe(null))} aria-label="The video frame: tap the court's corners" />
        {loupe && <canvas ref={loupeRef} className="pkTwinLoupe" style={{ left: Math.max(0, loupe.x - LOUPE / 2), top: Math.max(0, loupe.y - LOUPE - 36) }} aria-hidden="true" />}
      </div>
      {frame && !snap && (
        <label className="pkTwinRow">
          <span>Moment</span>
          <input type="range" min="0" max={Math.max(0.5, frame.duration - 0.2)} step="0.5" value={t} onChange={(e) => setT(Number(e.target.value))} aria-label="Pick a moment where the corners show" />
        </label>
      )}
      {snap && (
        <div className="pkTwinRow">
          <span>Camera</span>
          <button type="button" onClick={() => setShot((n) => n + 1)} data-action="new-picture">
            New picture
          </button>
        </div>
      )}
      <div className="pkTwinRow">
        <span>Game</span>
        <button type="button" className={players === 4 ? "is-on" : ""} onClick={() => setPlayers(4)}>
          Doubles
        </button>
        <button type="button" className={players === 2 ? "is-on" : ""} onClick={() => setPlayers(2)}>
          Singles
        </button>
      </div>
      <div className="pkTwinButtons">
        <button type="button" onClick={onCancel}>
          Back
        </button>
        <button type="button" disabled={!taps.length} onClick={() => setTaps((ts) => ts.slice(0, -1))}>
          Undo
        </button>
        <button type="button" className="pkPrimary" disabled={!cal?.ok} onClick={() => onDone({ taps, players, vw: frame?.vw, vh: frame?.vh })}>
          {doneLabel}
        </button>
      </div>
    </div>
  )
}
