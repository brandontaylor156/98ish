// Roam's on-screen controls (phone first). Self-contained: it talks to the world only
// (world.setStick / setSprint / setDrive / drag / action) and has its own styles (roam.css),
// so it goes wherever the world goes.
//
// On foot: a drag anywhere in the lower part of the screen (upright) or the left side
// (sideways) walks, the stick appearing under the thumb; a drag anywhere else turns the camera;
// Run toggles running. Driving: drag on the left half to steer, hold Gas and Brake on the
// right (Brake held when stopped backs up). One action button (Get in, Get out, Ride along,
// Take a look...) and a menu (finds, voice, back to the courts, leave).

import React, { useEffect, useRef, useState } from "react"
import "./roam.css"

const STICK_R = 56

export function RoamHud({ world, hud, voice = null, onMenu, onAction, credit = "© OpenStreetMap contributors" }) {
  const rootRef = useRef(null)
  const touches = useRef(new Map()) // pointerId -> { kind, x0, y0, x, y }
  const [stick, setStick] = useState(null)
  const knobRef = useRef(null)
  const baseRef = useRef(null)
  const [sprint, setSprint] = useState(false)
  const [pedal, setPedal] = useState({ gas: false, brake: false })
  const mode = hud?.mode || "walk"
  const driving = mode === "drive"

  // (leaving a mode lets go of everything)
  useEffect(() => {
    touches.current.clear()
    setStick(null)
    setPedal({ gas: false, brake: false })
    world?.setStick(0, 0)
    world?.setDrive({ steer: 0, gas: 0, brake: 0 })
    setSprint(false)
    world?.setSprint(false)
  }, [mode, world])

  const zoneOf = (e) => {
    const r = rootRef.current.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const upright = r.height > r.width * 1.05
    if (driving) return x < r.width * 0.5 ? "steer" : "look"
    if (upright ? y > r.height * 0.55 : x < r.width * 0.42) return "move"
    return "look"
  }
  const down = (e) => {
    if (e.target !== rootRef.current) return
    const kind = zoneOf(e)
    if (kind === "move" && [...touches.current.values()].some((t) => t.kind === "move")) return
    if (kind === "steer" && [...touches.current.values()].some((t) => t.kind === "steer")) return
    try {
      rootRef.current.setPointerCapture(e.pointerId)
    } catch {
      // (the pointer is gone already)
    }
    const r = rootRef.current.getBoundingClientRect()
    touches.current.set(e.pointerId, { kind, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, left: r.left, top: r.top })
    if (kind === "move") setStick({ x: e.clientX - r.left, y: e.clientY - r.top })
    if (kind === "steer") setStick({ x: e.clientX - r.left, y: e.clientY - r.top, steer: true })
    e.preventDefault()
  }
  const move = (e) => {
    const t = touches.current.get(e.pointerId)
    if (!t) return
    if (t.kind === "look") {
      world?.drag(e.clientX - t.x, e.clientY - t.y)
      t.x = e.clientX
      t.y = e.clientY
      return
    }
    let dx = e.clientX - t.x0
    let dy = e.clientY - t.y0
    if (t.kind === "steer") {
      const k = Math.max(-1, Math.min(1, dx / 70))
      world?.setDrive({ steer: k })
      if (knobRef.current) knobRef.current.style.transform = `translate(${k * STICK_R}px, 0px)`
      return
    }
    const d = Math.hypot(dx, dy)
    if (d > STICK_R) {
      dx = (dx / d) * STICK_R
      dy = (dy / d) * STICK_R
      // (the ring follows the thumb past its edge)
      t.x0 = e.clientX - dx
      t.y0 = e.clientY - dy
      if (baseRef.current) {
        baseRef.current.style.left = `${t.x0 - t.left}px`
        baseRef.current.style.top = `${t.y0 - t.top}px`
      }
    }
    world?.setStick(dx / STICK_R, -dy / STICK_R)
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`
  }
  const up = (e) => {
    const t = touches.current.get(e.pointerId)
    if (!t) return
    touches.current.delete(e.pointerId)
    if (t.kind === "move") {
      world?.setStick(0, 0)
      setStick(null)
      if (sprint) {
        setSprint(false)
        world?.setSprint(false)
      }
    }
    if (t.kind === "steer") {
      world?.setDrive({ steer: 0 })
      setStick(null)
    }
  }
  const hold = (which, on) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    setPedal((p) => ({ ...p, [which]: on }))
    world?.setDrive({ [which]: on ? 1 : 0 })
  }
  const toggleSprint = () => {
    const next = !sprint
    setSprint(next)
    world?.setSprint(next)
  }

  return (
    <div className={`roamHud is-${mode}`} ref={rootRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-touch-surface data-roam="hud">
      <div className="roamTop">
        <div className="roamInfo" data-roam="info">
          {hud?.street ? <b data-roam="street">{hud.street}</b> : null}
          {driving || mode === "ride" ? <span data-roam="speed">{hud?.speed ?? 0} mph</span> : null}
          <span className="roamFinds" data-roam="finds">
            ★ {hud?.found ?? 0}/{hud?.total ?? 0}
          </span>
          {hud?.online ? <span data-roam="people">● {hud.online.people} here</span> : null}
        </div>
        <div className="roamTopRight">
          {voice?.supported && (
            <button type="button" className={`roamBtn roamMic${voice.state.status === "on" ? " is-on" : ""}`} onClick={voice.toggle} data-roam="mic" aria-label="Voice">
              🎙
            </button>
          )}
          <button type="button" className="roamBtn" onClick={onMenu} data-roam="menu" aria-label="Menu">
            ☰
          </button>
        </div>
      </div>
      {hud?.action && (
        <button type="button" className="roamBtn roamAction" onClick={onAction} data-roam="action" data-kind={hud.action.kind}>
          {hud.action.label}
        </button>
      )}
      {hud?.hint && !hud?.action && <div className="roamHint" data-roam="hint">{hud.hint}</div>}
      {hud?.riders?.length ? <div className="roamHint roamRiders">Riding with you: {hud.riders.join(", ")}</div> : null}
      {mode === "walk" && (
        <button type="button" className={`roamBtn roamSprint${sprint ? " is-on" : ""}`} onPointerDown={(e) => e.stopPropagation()} onClick={toggleSprint} data-roam="sprint">
          {sprint ? "Running" : "Run"}
        </button>
      )}
      {driving && (
        <div className="roamPedals">
          <button type="button" className={`roamBtn roamPedal roamBrake${pedal.brake ? " is-on" : ""}`} onPointerDown={hold("brake", true)} onPointerUp={hold("brake", false)} onPointerCancel={hold("brake", false)} onPointerLeave={hold("brake", false)} data-roam="brake">
            Brake
          </button>
          <button type="button" className={`roamBtn roamPedal roamGas${pedal.gas ? " is-on" : ""}`} onPointerDown={hold("gas", true)} onPointerUp={hold("gas", false)} onPointerCancel={hold("gas", false)} onPointerLeave={hold("gas", false)} data-roam="gas">
            Gas
          </button>
        </div>
      )}
      {stick && (
        <div className={`roamStick${stick.steer ? " is-steer" : ""}`} ref={baseRef} style={{ left: stick.x, top: stick.y }} aria-hidden="true">
          <div className="roamKnob" ref={knobRef} />
        </div>
      )}
      {hud?.loading && <div className="roamLoading">Loading the town...</div>}
      <div className="roamCredit">{credit}</div>
    </div>
  )
}

// the menu: your finds, voice, back to the courts, leave
export function RoamMenu({ town, found = [], canGoBack, voice, onBack, onLeave, onClose }) {
  const got = found.filter((f) => f.found)
  return (
    <div className="roamSheet" data-roam="sheet" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="roamPanel">
        <div className="roamPanelHead">
          <b>{town.full || town.name}</b>
          <button type="button" className="roamBtn" onClick={onClose} aria-label="Close" data-roam="close">
            ×
          </button>
        </div>
        <div className="roamPanelBody">
          <h4 data-roam="found-title">
            Found {got.length} of {found.length}
          </h4>
          <ul className="roamFound" data-roam="found">
            {found.map((f) => (
              <li key={f.id} className={f.found ? "is-found" : ""}>
                <span>{f.found ? "★" : "☆"}</span>
                <span>
                  <b>{f.found ? f.name : "???"}</b>
                  <small>{f.found ? f.place : f.kind === "couple" ? "Somewhere for two" : f.kind === "car" ? "Somewhere to park" : "Somewhere in town"}</small>
                </span>
              </li>
            ))}
          </ul>
          {voice?.supported && (
            <button type="button" className="roamBtn roamWide" onClick={voice.toggle} data-roam="voice">
              {voice.state.status === "on" ? "Voice: on (tap to turn off)" : "Talk with people nearby"}
            </button>
          )}
          {canGoBack && (
            <button type="button" className="roamBtn roamWide" onClick={onBack} data-roam="back">
              Back to the courts
            </button>
          )}
          <button type="button" className="roamBtn roamWide" onClick={onLeave} data-roam="leave">
            Leave {town.name}
          </button>
        </div>
      </div>
    </div>
  )
}

// a find: what it was, and the count
export function RoamFound({ egg, onClose }) {
  return (
    <div className="roamSheet" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="roamPanel roamFoundCard" data-roam="found-card">
        <div className="roamPanelHead">
          <b>
            ★ Found {egg.count} of {egg.total}
          </b>
        </div>
        <div className="roamPanelBody">
          <h4>{egg.name}</h4>
          <p>{egg.text}</p>
          <small>{egg.place}</small>
          <button type="button" className="roamBtn roamWide" onClick={onClose} data-roam="found-ok">
            Nice
          </button>
        </div>
      </div>
    </div>
  )
}
