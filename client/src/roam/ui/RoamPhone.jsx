// Roam: your phone in the town (the owner: "Should be able to use a phone"). An original modern
// phone (rounded glass, big tiles), drawn over the 3D world and kept apart from the 98ish
// desktop look. Self-contained like the HUD: it talks to the world (world.searchPlaces,
// setDestination, callRide, transitInfo, ...) and to the host the world was given (messages
// through 98 Messenger, the camera into My Pictures). Swipe down on its top bar (or the bar at
// the bottom) to put it away.
//
// Apps: Map (the town's roads, you and your friends, search, a pin, the GPS route), Rides (Ryde 98
// or a yellow cab to anywhere), Transit (what's coming to the stops round you, the trains),
// Messages (a quick note to a buddy), Camera (a photo or a selfie), Music (the radio), Finds.

import React, { useEffect, useMemo, useRef, useState } from "react"
import "./phone.css"
import { BagApp, PlacesApp, setPlaceAt } from "./LifeApps.jsx"

const APPS = [
  { id: "map", name: "Maps", icon: "🗺️", bg: "#2f8f5b" },
  { id: "places", name: "Places", icon: "🏠", bg: "#d9822b" },
  { id: "bag", name: "Bag", icon: "🛍️", bg: "#b5446e" },
  { id: "rides", name: "Rides", icon: "🚕", bg: "#f2b632" },
  { id: "transit", name: "Transit", icon: "🚌", bg: "#2f6fd1" },
  { id: "messages", name: "Messages", icon: "💬", bg: "#35c25b" },
  { id: "camera", name: "Camera", icon: "📷", bg: "#55585e" },
  { id: "music", name: "Music", icon: "🎵", bg: "#e5486d" },
  { id: "finds", name: "Finds", icon: "⭐", bg: "#8a5ae0" },
  { id: "bikes", name: "Bikes", icon: "🛴", bg: "#16a596" },
]
const fmtD = (m) => (m >= 160 ? `${(m / 1609.34).toFixed(1)} mi` : `${Math.round(m / 3.048) * 10} ft`)
const fmtT = (s) => (s < 60 ? "<1 min" : `${Math.round(s / 60)} min`)
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`
const KIND_ICON = { mall: "🛍️", restaurant: "🍽️", cafe: "☕", fast_food: "🍔", park: "🌳", school: "🏫", library: "📚", station: "🚆", street: "🛣️", building: "🏢", cinema: "🎬", supermarket: "🛒", university: "🎓", college: "🎓", pier: "🌊", beach: "🏖️" }

export function RoamPhone({ world, onClose, found = [], life = null, start = null }) {
  const [app, setApp] = useState(start)
  const [drag, setDrag] = useState(0)
  const dragRef = useRef(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(id)
  }, [])
  // (swipe down to put it away)
  const swipe = {
    onPointerDown: (e) => {
      dragRef.current = { y: e.clientY, id: e.pointerId }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // (gone already)
      }
    },
    onPointerMove: (e) => {
      if (dragRef.current?.id === e.pointerId) setDrag(Math.max(0, e.clientY - dragRef.current.y))
    },
    onPointerUp: (e) => {
      if (dragRef.current?.id !== e.pointerId) return
      const d = e.clientY - dragRef.current.y
      dragRef.current = null
      setDrag(0)
      if (d > 70) onClose()
    },
    onPointerCancel: () => {
      dragRef.current = null
      setDrag(0)
    },
  }
  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  const title = app ? APPS.find((a) => a.id === app)?.name : ""
  return (
    <div className="rphSheet" data-roam="phone-sheet" onPointerDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()}>
      <div className="rphPhone" style={{ transform: `translateY(${drag}px)` }} data-roam="phone-ui">
        <div className="rphStatus" {...swipe} data-roam="phone-swipe">
          <span>{time}</span>
          <span className="rphNotch" />
          <span>▂▄▆ 5G ▮</span>
        </div>
        {app ? (
          <div className="rphTitle">
            <button type="button" className="rphBack" onClick={() => setApp(null)} data-roam="phone-back">
              ‹ Home
            </button>
            <b>{title}</b>
            <span />
          </div>
        ) : null}
        <div className="rphBody">
          {!app && (
            <div className="rphHome">
              <div className="rphWidget">
                <b>{world.town.name}</b>
                <span>{world.info?.street || " "}</span>
              </div>
              <div className="rphGrid">
                {APPS.map((a) => (
                  <button key={a.id} type="button" className="rphApp" onClick={() => setApp(a.id)} data-roam={`app-${a.id}`}>
                    <span className="rphIcon" style={{ background: a.bg }}>
                      {a.icon}
                    </span>
                    <span>{a.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {app === "map" && <MapApp world={world} onRide={() => setApp("rides")} onClose={onClose} />}
          {app === "rides" && <RidesApp world={world} onClose={onClose} />}
          {app === "transit" && <TransitApp world={world} onClose={onClose} />}
          {app === "messages" && <MessagesApp world={world} />}
          {app === "camera" && <CameraApp world={world} />}
          {app === "music" && <MusicApp world={world} />}
          {app === "finds" && <FindsApp found={found} />}
          {app === "bikes" && <BikesApp world={world} onClose={onClose} />}
          {app === "places" && <PlacesApp world={world} life={life} onClose={onClose} />}
          {app === "bag" && <BagApp world={world} life={life} />}
        </div>
        <div className="rphHomeBar" {...swipe} onClick={() => (app ? setApp(null) : onClose())} data-roam="phone-home">
          <span />
        </div>
      </div>
    </div>
  )
}

// ---------- search (Maps and Rides) ----------
function PlaceSearch({ world, onPick, placeholder = "Search places" }) {
  const [q, setQ] = useState("")
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let live = true
    world.loadNav?.().then((ok) => live && setReady(ok))
    return () => {
      live = false
    }
  }, [world])
  const results = useMemo(() => (ready && q.trim().length >= 2 ? world.searchPlaces(q, 10) : []), [q, ready, world])
  return (
    <div className="rphSearch">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ready ? placeholder : "Loading the map..."} disabled={!ready} enterKeyHint="search" data-roam="phone-search" />
      {results.length > 0 && (
        <ul className="rphResults" data-roam="phone-results">
          {results.map((p, i) => (
            <li key={`${p.name}${i}`}>
              <button type="button" onClick={() => (onPick(p), setQ(""))}>
                <span>{KIND_ICON[p.kind] || "📍"}</span>
                <span>
                  <b>{p.name}</b>
                  <small>
                    {String(p.kind).replace(/_/g, " ")} · {fmtD(p.d)}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Maps ----------
function MapApp({ world, onRide, onClose }) {
  const ref = useRef(null)
  const view = useRef({ cx: null, cz: null, scale: 0.35, follow: true })
  const [pin, setPin] = useState(null)
  const [msg, setMsg] = useState("")
  const [ready, setReady] = useState(false)
  const touches = useRef(new Map())
  useEffect(() => {
    let live = true
    world.loadNav?.().then((ok) => live && setReady(ok))
    return () => {
      live = false
    }
  }, [world])
  // draw the town's roads (once into a path per class), you, friends, the route, the pin
  useEffect(() => {
    if (!ready) return undefined
    const roads = world.navRoads()
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const cv = ref.current
      if (!cv) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const W = cv.clientWidth
      const H = cv.clientHeight
      if (cv.width !== Math.round(W * dpr)) cv.width = Math.round(W * dpr)
      if (cv.height !== Math.round(H * dpr)) cv.height = Math.round(H * dpr)
      const g = cv.getContext("2d")
      const m = world.mapNow()
      const v = view.current
      if (v.follow || v.cx === null) {
        v.cx = m.x
        v.cz = m.z
      }
      const k = v.scale * dpr
      const X = (x) => (x - v.cx) * k + cv.width / 2
      const Z = (z) => (z - v.cz) * k + cv.height / 2
      g.fillStyle = "#eef0e6"
      g.fillRect(0, 0, cv.width, cv.height)
      const span = (cv.width / k) * 0.75
      const order = [[6, 5], [5, 4], [4, 3], [3, 2], [2, 1], [1, 0], [0, -1]]
      void order
      for (const [cls, w, col] of [[5, 2.2, "#ffffff"], [6, 3, "#f7d58a"], [4, 3.2, "#fff2c2"], [3, 4, "#ffe48a"], [2, 4.6, "#ffd36b"], [1, 5, "#f6a947"], [0, 5.5, "#f39a3d"]]) {
        g.beginPath()
        for (const r of roads) {
          if (r.cls !== cls) continue
          const p0 = r.pts[0]
          if (Math.abs(p0.x - v.cx) > span + 800 || Math.abs(p0.z - v.cz) > span + 800) continue
          r.pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))))
        }
        g.strokeStyle = "#c9c6bb"
        g.lineWidth = (w + 1.5) * dpr * Math.max(0.6, v.scale * 2)
        g.lineCap = "round"
        g.lineJoin = "round"
        g.stroke()
        g.strokeStyle = col
        g.lineWidth = w * dpr * Math.max(0.6, v.scale * 2)
        g.stroke()
      }
      // the route
      if (m.route) {
        g.beginPath()
        m.route.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))))
        g.strokeStyle = "rgba(40,120,255,0.9)"
        g.lineWidth = 6 * dpr
        g.stroke()
      }
      const dot = (x, z, r, fill, stroke = "#fff") => {
        g.beginPath()
        g.arc(X(x), Z(z), r * dpr, 0, Math.PI * 2)
        g.fillStyle = fill
        g.fill()
        g.lineWidth = 2 * dpr
        g.strokeStyle = stroke
        g.stroke()
      }
      for (const s of m.stations) dot(s.x ?? s[1], s.z ?? s[2], 7, "#6b3fa0")
      if (v.scale > 0.5) for (const s of m.stops) dot(s.x, s.z, 3.5, "#1f5fb8")
      if (m.dest) dot(m.dest.x, m.dest.z, 8, "#e0392b")
      // your Home/Work, places friends share with you, the stores (roam/life/town.js)
      for (const p of m.pins || []) {
        dot(p.x, p.z, 9, p.mine ? (p.kind === "work" ? "#6b3fa0" : "#d9822b") : p.kind === "club" || p.kind === "mall" ? "#c8102e" : "#2f6fd1")
        g.fillStyle = "#fff"
        g.font = `${11 * dpr}px system-ui, sans-serif`
        g.fillText(p.kind === "work" ? "💼" : p.kind === "home" ? "🏠" : "🛒", X(p.x) - 7 * dpr, Z(p.z) + 4 * dpr)
        if (v.scale > 0.25) {
          g.fillStyle = "#123"
          g.fillText(p.name, X(p.x) + 11 * dpr, Z(p.z) + 4 * dpr)
        }
      }
      if (pin) dot(pin.x, pin.z, 8, "#e0392b")
      if (m.ride) dot(m.ride.x, m.ride.z, 7, "#f2b632", "#222")
      g.font = `${12 * dpr}px system-ui, sans-serif`
      for (const f of m.friends) {
        dot(f.x, f.z, 7, "#2f6fd1")
        g.fillStyle = "#123"
        g.fillText(f.name, X(f.x) + 10 * dpr, Z(f.z) + 4 * dpr)
      }
      // you: an arrow the way you face
      g.save()
      g.translate(X(m.x), Z(m.z))
      g.rotate(-m.yaw + Math.PI)
      g.beginPath()
      g.moveTo(0, -11 * dpr)
      g.lineTo(8 * dpr, 9 * dpr)
      g.lineTo(0, 4 * dpr)
      g.lineTo(-8 * dpr, 9 * dpr)
      g.closePath()
      g.fillStyle = "#2f6fd1"
      g.fill()
      g.strokeStyle = "#fff"
      g.lineWidth = 2 * dpr
      g.stroke()
      g.restore()
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [ready, world, pin])
  // pan with a finger, pinch to zoom, tap to drop a pin
  const down = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now() })
  }
  const move = (e) => {
    const t = touches.current.get(e.pointerId)
    if (!t) return
    const v = view.current
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()]
      const before = Math.hypot(a.x - b.x, a.y - b.y)
      t.x = e.clientX
      t.y = e.clientY
      const after = Math.hypot(a.x - b.x, a.y - b.y)
      if (before > 10) v.scale = Math.max(0.03, Math.min(3, v.scale * (after / before)))
      return
    }
    v.follow = false
    v.cx -= (e.clientX - t.x) / v.scale
    v.cz -= (e.clientY - t.y) / v.scale
    t.x = e.clientX
    t.y = e.clientY
  }
  const up = (e) => {
    const t = touches.current.get(e.pointerId)
    touches.current.delete(e.pointerId)
    if (!t) return
    if (Math.hypot(e.clientX - t.x0, e.clientY - t.y0) < 8 && performance.now() - t.t < 500) {
      const cv = ref.current
      const r = cv.getBoundingClientRect()
      const v = view.current
      const x = v.cx + (e.clientX - r.left - r.width / 2) / v.scale
      const z = v.cz + (e.clientY - r.top - r.height / 2) / v.scale
      const near = world.placeNear(x, z, 60 / Math.max(0.2, v.scale))
      setPin({ x, z, name: near?.name || "Dropped pin" })
    }
  }
  // the tapped building becomes your Home or your Work (private: only on your own map)
  const setHere = async (kind) => {
    if (!pin) return
    setMsg("Saving...")
    const r = await setPlaceAt(world, kind, pin.x, pin.z)
    setMsg(r.ok ? `${kind === "work" ? "Work" : "Home"} set. Only you see it (Places to share it).` : r.error)
  }
  const go = async (dest) => {
    setMsg("Finding a route...")
    const r = await world.setDestination(dest)
    if (!r.ok) return setMsg(r.error)
    setMsg("")
    onClose()
  }
  return (
    <div className="rphMap">
      <PlaceSearch world={world} onPick={(p) => (setPin({ x: p.x, z: p.z, name: p.name }), Object.assign(view.current, { cx: p.x, cz: p.z, follow: false, scale: Math.max(view.current.scale, 0.6) }))} />
      <div className="rphMapWrap">
        <canvas ref={ref} className="rphCanvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-roam="phone-map" />
        <div className="rphZoom">
          <button type="button" onClick={() => (view.current.scale = Math.min(3, view.current.scale * 1.6))} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={() => (view.current.scale = Math.max(0.03, view.current.scale / 1.6))} aria-label="Zoom out">
            −
          </button>
          <button type="button" onClick={() => (view.current.follow = true)} aria-label="Where am I" data-roam="phone-locate">
            ◎
          </button>
        </div>
      </div>
      {pin ? (
        <div className="rphCard" data-roam="phone-pin">
          <b>{pin.name}</b>
          <div className="rphRow">
            <button type="button" className="rphPrimary" onClick={() => go(pin)} data-roam="phone-directions">
              Directions
            </button>
            <button type="button" onClick={() => (world.__rideDest = pin, onRide())} data-roam="phone-ride-here">
              Ride there
            </button>
          </div>
          {world.host?.life && (
            <div className="rphRow">
              <button type="button" onClick={() => setHere("home")} data-life="map-set-home">
                🏠 Set as Home
              </button>
              <button type="button" onClick={() => setHere("work")} data-life="map-set-work">
                💼 Set as Work
              </button>
            </div>
          )}
        </div>
      ) : world.gpsState ? (
        <div className="rphCard">
          <b>Going to {world.gpsState.to.name}</b>
          <button type="button" onClick={() => world.clearDestination()} data-roam="phone-end-route">
            End route
          </button>
        </div>
      ) : (
        <div className="rphHint">Search, or tap the map to drop a pin.</div>
      )}
      {msg && <div className="rphMsg">{msg}</div>}
    </div>
  )
}

// ---------- Rides ----------
function RidesApp({ world, onClose }) {
  const [dest, setDest] = useState(() => world.__rideDest || (world.gpsState ? world.gpsState.to : null))
  const [msg, setMsg] = useState("")
  const [state, setState] = useState(world.rideState)
  useEffect(() => {
    world.__rideDest = null
    const id = setInterval(() => setState(world.rideState), 500)
    return () => clearInterval(id)
  }, [world])
  const call = async (kind) => {
    if (!dest) return setMsg("Where to? Search for a place first.")
    setMsg("Finding a driver...")
    const r = await world.callRide(kind, dest)
    if (!r.ok) return setMsg(r.error)
    setMsg(`${r.driver} is on the way: about ${fmtT(r.eta)}.`)
    setState(world.rideState)
  }
  if (state) {
    const left = Math.max(0, state.len - state.s)
    return (
      <div className="rphPage" data-roam="phone-ride-status">
        <div className="rphBig">{state.phase === "coming" ? "🚗 On the way" : state.phase === "waiting" ? "🚗 Your ride is here" : state.phase === "riding" ? "🚗 Riding" : "🏁 You're there"}</div>
        <p>
          <b>{state.driver}</b> · {state.name}
        </p>
        <p>{state.phase === "coming" ? `About ${fmtT(left / 11)} away (${fmtD(left)})` : state.phase === "waiting" ? "Walk up to the car and tap Get in." : state.phase === "riding" ? `To ${state.to || "your pin"} · ${fmtT(left / 11)}` : ""}</p>
        {state.phase === "riding" && (
          <button type="button" className="rphPrimary" onClick={() => (world.skipAhead(), onClose())} data-roam="phone-skip">
            ⏩ Skip ahead
          </button>
        )}
        {(state.phase === "coming" || state.phase === "waiting") && (
          <button type="button" onClick={() => world.cancelRide()} data-roam="phone-cancel">
            Cancel ride
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="rphPage">
      <PlaceSearch world={world} onPick={(p) => setDest(p)} placeholder="Where to?" />
      {dest ? (
        <div className="rphCard">
          <small>To</small>
          <b data-roam="phone-ride-dest">{dest.name}</b>
        </div>
      ) : (
        <div className="rphHint">Search for a place, or pick one on Maps.</div>
      )}
      <div className="rphChoices">
        <button type="button" className="rphChoice" onClick={() => call("ryde")} data-roam="phone-ryde">
          <span className="rphIcon" style={{ background: "#222" }}>
            🚗
          </span>
          <span>
            <b>Ryde 98</b>
            <small>A car and a friendly driver</small>
          </span>
        </button>
        <button type="button" className="rphChoice" onClick={() => call("taxi")} data-roam="phone-taxi">
          <span className="rphIcon" style={{ background: "#f2c12e" }}>
            🚕
          </span>
          <span>
            <b>Yellow Cab</b>
            <small>A classic taxi</small>
          </span>
        </button>
      </div>
      <small className="rphNote">Your friend can ride with you: they tap Ride along by the car.</small>
      {msg && <div className="rphMsg" data-roam="phone-ride-msg">{msg}</div>}
    </div>
  )
}

// ---------- Transit ----------
function TransitApp({ world, onClose }) {
  const [info, setInfo] = useState(() => world.transitInfo())
  const [msg, setMsg] = useState("")
  useEffect(() => {
    const id = setInterval(() => setInfo(world.transitInfo()), 1000)
    return () => clearInterval(id)
  }, [world])
  const nearestStop = () => {
    const m = world.mapNow()
    let best = null
    for (const s of m.stops) {
      const d = Math.hypot(s.x - m.x, s.z - m.z)
      if (!best || d < best.d) best = { ...s, d }
    }
    return best
  }
  const walkTo = async (p, name) => {
    const r = await world.setDestination({ x: p.x, z: p.z, name })
    if (!r.ok) return setMsg(r.error)
    onClose()
  }
  const stop = info.here ? null : nearestStop()
  return (
    <div className="rphPage" data-roam="phone-transit">
      {info.here ? (
        <>
          <div className="rphBig">
            {info.here.station ? "🚆" : "🚏"} {info.here.stop}
          </div>
          <ul className="rphList">
            {info.here.next.map((n) => (
              <li key={n.label}>
                <b>{n.label}</b>
                <span>{n.secs <= 0 ? "Here now" : clock(n.secs)}</span>
              </li>
            ))}
          </ul>
          {info.here.next[0]?.secs > 6 && (
            <button type="button" className="rphPrimary" onClick={() => world.skipWait()} data-roam="phone-skip-wait">
              ⏩ Skip the wait
            </button>
          )}
          <small className="rphNote">When it pulls in, tap Get on. On board you can skip to the next stop.</small>
        </>
      ) : (
        <>
          <p>No stop right here.</p>
          {stop ? (
            <button type="button" className="rphPrimary" onClick={() => walkTo(stop, stop.name || "Bus stop")} data-roam="phone-walk-stop">
              Walk to {stop.name || "the nearest stop"} ({fmtD(stop.d)})
            </button>
          ) : (
            <p>{info.lines ? "The nearest bus stop is a way off: try Maps." : "No buses are mapped in this town."}</p>
          )}
        </>
      )}
      {info.stations.length > 0 && (
        <>
          <h4>Trains</h4>
          <ul className="rphList">
            {info.stations.map((s) => (
              <li key={s.name}>
                <b>🚆 {s.name}</b>
                <button type="button" onClick={() => walkTo(s, `${s.name} station`)} data-roam={`phone-station-${s.name}`}>
                  Go
                </button>
              </li>
            ))}
          </ul>
          <small className="rphNote">Ride the train between towns: get on at the station, then pick where to.</small>
        </>
      )}
      {msg && <div className="rphMsg">{msg}</div>}
    </div>
  )
}

// ---------- Messages (98 Messenger) ----------
const QUICK = ["Where are you?", "On my way!", "Come ride with me", "Meet me here", "Look at this view!", "Race you there 😄"]
function MessagesApp({ world }) {
  const msgs = world.host?.messages
  const buddies = useMemo(() => msgs?.buddies?.() || [], [msgs])
  const [to, setTo] = useState(() => buddies.find((b) => b.online)?.name || buddies[0]?.name || "")
  const [text, setText] = useState("")
  const [status, setStatus] = useState("")
  if (!msgs) return <div className="rphPage">Sign on to 98 Messenger to send messages.</div>
  if (!buddies.length) return <div className="rphPage">Add a buddy in 98 Messenger first.</div>
  const where = () => {
    const i = world.info
    return i?.street ? ` I'm on ${i.street} in ${world.town.name}.` : ` I'm in ${world.town.name}.`
  }
  const send = async (t) => {
    const body = t === "Meet me here" ? `Meet me here!${where()}` : t
    setStatus("Sending...")
    const r = await msgs.send(to, `${body} (Pickleball 98 > Explore ${world.town.name})`)
    setStatus(r.ok ? `Sent to ${to}` : r.error || "Not sent")
    if (r.ok) setText("")
  }
  return (
    <div className="rphPage" data-roam="phone-messages">
      <div className="rphTo" data-roam="phone-to">
        {buddies.slice(0, 8).map((b) => (
          <button key={b.name} type="button" className={b.name === to ? "is-on" : ""} onClick={() => setTo(b.name)}>
            <span className={b.online ? "rphOnline" : "rphOffline"}>●</span> {b.name}
          </button>
        ))}
      </div>
      <div className="rphQuick">
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => send(q)} data-roam="phone-quick">
            {q}
          </button>
        ))}
      </div>
      <div className="rphCompose">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" data-roam="phone-text" />
        <button type="button" className="rphPrimary" disabled={!text.trim()} onClick={() => send(text.trim())} data-roam="phone-send">
          Send
        </button>
      </div>
      {status && <div className="rphMsg" data-roam="phone-sent">{status}</div>}
    </div>
  )
}

// ---------- Camera ----------
function CameraApp({ world }) {
  const cam = world.host?.camera
  const [shot, setShot] = useState(null)
  const [busy, setBusy] = useState(false)
  if (!cam) return <div className="rphPage">The camera isn't available here.</div>
  const take = async (selfie) => {
    setBusy(true)
    const r = await cam.shoot(world, { selfie, place: world.info?.street || world.town.name })
    setBusy(false)
    setShot(r)
  }
  return (
    <div className="rphPage" data-roam="phone-camera">
      {shot?.ok ? <img className="rphShot" src={shot.url} alt="Your photo" /> : <div className="rphViewfinder">📷</div>}
      <div className="rphRow">
        <button type="button" className="rphPrimary" disabled={busy} onClick={() => take(false)} data-roam="phone-photo">
          Take photo
        </button>
        <button type="button" disabled={busy} onClick={() => take(true)} data-roam="phone-selfie">
          Selfie
        </button>
      </div>
      {shot && <div className="rphMsg" data-roam="phone-saved">{shot.ok ? `Saved to My Pictures: ${shot.name}` : shot.error}</div>}
    </div>
  )
}

// ---------- Music ----------
function MusicApp({ world }) {
  const [on, setOn] = useState(!!world.radioOn)
  return (
    <div className="rphPage">
      <div className="rphBig">🎵 98 FM</div>
      <p>Lo-fi for the drive (or the walk).</p>
      <button type="button" className="rphPrimary" onClick={() => (world.music(!on), setOn(!on))} data-roam="phone-music">
        {on ? "⏸ Pause" : "▶ Play"}
      </button>
    </div>
  )
}

// ---------- Finds ----------
function FindsApp({ found }) {
  const got = found.filter((f) => f.found)
  return (
    <div className="rphPage">
      <div className="rphBig">
        ⭐ {got.length} of {found.length}
      </div>
      <ul className="rphList">
        {found.map((f) => (
          <li key={f.id}>
            <b>{f.found ? f.name : "???"}</b>
            <span>{f.found ? f.place : f.kind === "couple" ? "Somewhere for two" : f.kind === "car" ? "Somewhere to park" : "Somewhere in town"}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- Bikes (the dockless ones near you) ----------
function BikesApp({ world, onClose }) {
  const list = useMemo(() => world.fleetNear?.(600) || [], [world])
  const [msg, setMsg] = useState("")
  const go = async (f) => {
    const r = await world.setDestination({ x: f.x, z: f.z, name: f.kind === "bike" ? "A Pedal 98 bike" : "A Zoom 98 scooter" })
    if (!r.ok) return setMsg(r.error)
    onClose()
  }
  return (
    <div className="rphPage" data-roam="phone-bikes">
      <p>Bikes and scooters near you. Walk up and tap Ride.</p>
      {list.length ? (
        <ul className="rphList">
          {list.slice(0, 8).map((f) => (
            <li key={f.id}>
              <b>{f.kind === "bike" ? "🚲 Pedal 98 bike" : "🛴 Zoom 98 scooter"}</b>
              <span>{fmtD(f.d)}</span>
              <button type="button" onClick={() => go(f)}>
                Go
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>None close by. They park near shops and parks.</p>
      )}
      {msg && <div className="rphMsg">{msg}</div>}
    </div>
  )
}
