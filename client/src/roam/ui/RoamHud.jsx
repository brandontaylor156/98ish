// Roam's on-screen controls (phone first). Self-contained: it talks to the world only
// (world.setStick / setSprint / setDrive / drag / action) and has its own styles (roam.css),
// so it goes wherever the world goes.
//
// On foot: a drag anywhere in the lower part of the screen (upright) or the left side
// (sideways) walks, the stick appearing under the thumb (pushed all the way out, you run; there's
// no Run button); a drag anywhere else turns the camera. Driving: drag on the left half to steer, hold Gas and Brake on the
// right (Brake held when stopped backs up). One action button (Get in, Get out, Ride along,
// Take a look...) and a menu (finds, voice, back to the courts, leave). A minimap in the top
// corner; in a car, a horn (hold) and the radio.

import React, { useEffect, useRef, useState } from "react"
import "./roam.css"
import "./getaround.css"
import { Minimap } from "./Minimap.jsx"

const STICK_R = 56
// the minimap's size: a little bigger with room for it
const mapSize = () => (typeof window !== "undefined" && Math.min(window.innerWidth, window.innerHeight) > 600 ? 124 : 92)

// a start spot's little sign
export const START_ICON = { mall: "🛍", park: "🌳", beach: "🏖", campus: "🎓", fun: "🎡", venue: "🏓", station: "🚆" }

const TURN_ICON = { left: "⬅", right: "➡", keep: "⬆", arrive: "📍" }
const miles = (m) => (m >= 160 ? `${(m / 1609.34).toFixed(1)} mi` : `${Math.round(m / 3.048) * 10} ft`)
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`
const etaWords = (s) => (s < 60 ? "under a minute" : `${Math.round(s / 60)} min`)

export function RoamHud({ world, hud, voice = null, onMenu, onAction, onPhone = null, arrival = null, onStarts = null, credit = "© OpenStreetMap contributors · aerial vegetation: USGS NAIP" }) {
  // (where you arrived, for a few seconds: tap to pick another start spot)
  const [showArrival, setShowArrival] = useState(!!arrival)
  useEffect(() => {
    if (!arrival) return undefined
    setShowArrival(true)
    const id = setTimeout(() => setShowArrival(false), 9000)
    return () => clearTimeout(id)
  }, [arrival?.id])
  const rootRef = useRef(null)
  const touches = useRef(new Map()) // pointerId -> { kind, x0, y0, x, y }
  const [stick, setStick] = useState(null)
  const knobRef = useRef(null)
  const baseRef = useRef(null)
  const [pedal, setPedal] = useState({ gas: false, brake: false })
  const mode = hud?.mode || "walk"
  // (a bike or a scooter rides on the walking stick; a car steers on the left with pedals on the right)
  const driving = mode === "drive" && !hud?.two

  // (leaving a mode lets go of everything)
  useEffect(() => {
    touches.current.clear()
    setStick(null)
    setPedal({ gas: false, brake: false })
    world?.setStick(0, 0)
    world?.setDrive({ steer: 0, gas: 0, brake: 0 })
  }, [mode, world, hud?.two])

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
    // (any touch on the picture moves or looks; only the buttons and panels keep their own)
    if (e.target !== rootRef.current && e.target.closest?.("button, a, input, select, textarea, [role=button], .roamSheet, .roamTripBar, .roamGps, .roamTop > *")) return
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
  const horn = (on) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    world?.horn?.(on)
  }

  return (
    <div className={`roamHud is-${mode}${hud?.gps ? " has-gps" : ""}`} ref={rootRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-touch-surface data-roam="hud">
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
          {onPhone && (
            <button type="button" className="roamBtn roamPhoneBtn" onClick={onPhone} data-roam="phone" aria-label="Phone">
              📱
            </button>
          )}
          <button type="button" className="roamBtn" onClick={onMenu} data-roam="menu" aria-label="Menu">
            ☰
          </button>
        </div>
      </div>
      <Minimap world={world} size={mapSize()} />
      {hud?.gps && (
        <div className="roamGps" data-roam="gps" onPointerDown={(e) => e.stopPropagation()}>
          <span className="roamGpsArrow" aria-hidden="true">{TURN_ICON[hud.gps.turn] || "⬆"}</span>
          <span className="roamGpsText">
            <b data-roam="gps-text">{hud.gps.text}</b>
            <small>
              {hud.gps.to} · {miles(hud.gps.left)} · {hud.gps.mins} min
            </small>
          </span>
          <button type="button" className="roamGpsEnd" onClick={() => world?.clearDestination?.()} aria-label="End route" data-roam="gps-end">
            ✕
          </button>
        </div>
      )}
      {hud?.ride && (
        <div className="roamTripBar" data-roam="ride" data-phase={hud.ride.phase} onPointerDown={(e) => e.stopPropagation()}>
          <span>
            {hud.ride.kind === "taxi" ? "🚕" : "🚗"} <b>{hud.ride.name}</b>{" "}
            {hud.ride.phase === "coming" ? `· ${hud.ride.driver} is ${etaWords(hud.ride.eta)} away` : hud.ride.phase === "waiting" ? `· ${hud.ride.driver} is here` : hud.ride.phase === "riding" ? `· to ${hud.ride.to || "your pin"} · ${etaWords(hud.ride.eta)}` : "· here!"}
          </span>
          {hud.ride.phase === "riding" ? (
            <button type="button" className="roamBtn" onClick={() => world?.skipAhead?.()} data-roam="skip">
              ⏩ Skip ahead
            </button>
          ) : hud.ride.phase === "coming" || hud.ride.phase === "waiting" ? (
            <button type="button" className="roamBtn" onClick={() => world?.cancelRide?.()} data-roam="ride-cancel">
              Cancel
            </button>
          ) : null}
        </div>
      )}
      {hud?.transit && mode === "walk" && !hud?.ride && (
        <div className="roamTripBar roamTransit" data-roam="transit" onPointerDown={(e) => e.stopPropagation()}>
          <span>
            {hud.transit.station ? "🚆" : "🚏"} <b>{hud.transit.stop}</b>
            {hud.transit.next.slice(0, 2).map((n) => (
              <small key={n.label}>
                {n.label} · {n.secs <= 0 ? "here now" : clock(n.secs)}
              </small>
            ))}
          </span>
          {hud.transit.next[0]?.secs > 6 && (
            <button type="button" className="roamBtn" onClick={() => world?.skipWait?.()} data-roam="skip-wait">
              ⏩ Skip the wait
            </button>
          )}
        </div>
      )}
      {hud?.onboard && (
        <div className="roamTripBar roamOnboard" data-roam="onboard" onPointerDown={(e) => e.stopPropagation()}>
          <span>
            {hud.onboard.kind === "bus" ? "🚌" : "🚆"} <b>{hud.onboard.label}</b>
            <small>{hud.onboard.at ? `At ${hud.onboard.at}` : hud.onboard.next ? `Next: ${hud.onboard.next}` : ""}</small>
          </span>
          {hud.onboard.next && !hud.onboard.at && (
            <button type="button" className="roamBtn" onClick={() => world?.skipAhead?.()} data-roam="skip-stop">
              ⏩ Next stop
            </button>
          )}
          {hud.onboard.towns?.length ? (
            <span className="roamTownBtns">
              {hud.onboard.towns.map((t) => (
                <button key={t.id} type="button" className="roamBtn" onClick={() => world?.trainTo?.(t.id)} data-roam={`train-${t.id}`}>
                  Ride on to {t.name}
                </button>
              ))}
            </span>
          ) : null}
        </div>
      )}
      {(driving || mode === "ride") && (
        <div className="roamCarBtns">
          <button type="button" className={`roamBtn roamRadio${hud?.radio ? " is-on" : ""}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => world?.radio?.(!hud?.radio)} data-roam="radio" aria-label="Radio">
            {hud?.radio ? "♪ On" : "♪ Radio"}
          </button>
          {driving && (
            <button type="button" className="roamBtn roamHorn" onPointerDown={horn(true)} onPointerUp={horn(false)} onPointerCancel={horn(false)} onPointerLeave={horn(false)} data-roam="horn">
              Horn
            </button>
          )}
        </div>
      )}
      {hud?.action && (
        <button type="button" className="roamBtn roamAction" onClick={onAction} data-roam="action" data-kind={hud.action.kind}>
          {hud.action.label}
        </button>
      )}
      {arrival && showArrival && onStarts && mode === "walk" && (
        <button type="button" className="roamBtn roamArrival" onPointerDown={(e) => e.stopPropagation()} onClick={onStarts} data-roam="arrival">
          {START_ICON[arrival.kind] || "📍"} {arrival.name} <u>Change</u>
        </button>
      )}
      {hud?.hint && !hud?.action && <div className="roamHint" data-roam="hint">{hud.hint}</div>}
      {hud?.riders?.length ? <div className="roamHint roamRiders">Riding with you: {hud.riders.join(", ")}</div> : null}
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
export function RoamMenu({ town, found = [], canGoBack, voice, onBack, onLeave, onClose, towns = [], onGo = null, driving = false, onStarts = null }) {
  const got = found.filter((f) => f.found)
  const [goOpen, setGoOpen] = useState(false)
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
          {onStarts && (
            <button type="button" className="roamBtn roamWide" onClick={onStarts} data-roam="menu-starts">
              Start spot...
            </button>
          )}
          {onGo && towns.length > 0 && (
            <button type="button" className="roamBtn roamWide" onClick={() => setGoOpen((o) => !o)} aria-expanded={goOpen} data-roam="goto">
              Go to... {goOpen ? "▴" : "▾"}
            </button>
          )}
          {onGo && goOpen && (
            <div className="roamGoList" data-roam="goto-list">
              <small>{driving ? "You drive there; anyone riding along comes with you." : "You'll arrive on foot. Get in a car first to bring a friend riding along."}</small>
              {towns.map((t) => (
                <button key={t.id} type="button" className="roamBtn roamWide" onClick={() => onGo(t.id)} data-roam={`goto-${t.id}`}>
                  {t.name}
                </button>
              ))}
            </div>
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

// where to start in a town (the picker; your pick is remembered for next time)
export function RoamStarts({ town, starts = [], current = null, onPick, onClose }) {
  return (
    <div className="roamSheet" data-roam="starts" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="roamPanel">
        <div className="roamPanelHead">
          <b>Start in {town.name} at...</b>
          <button type="button" className="roamBtn" onClick={onClose} aria-label="Close" data-roam="starts-close">
            ×
          </button>
        </div>
        <div className="roamPanelBody">
          {starts.map((s) => (
            <button key={s.id} type="button" className={`roamBtn roamWide roamStartBtn${s.id === current ? " is-on" : ""}`} onClick={() => onPick(s.id)} data-roam={`start-${s.id}`}>
              <span aria-hidden="true">{START_ICON[s.kind] || "📍"}</span> {s.name}
              {s.id === current ? <small> (now)</small> : null}
            </button>
          ))}
          <small>Next time you explore {town.name}, you'll start here.</small>
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
