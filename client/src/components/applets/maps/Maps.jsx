import React, { Suspense, useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import { helpItem } from "../../../utils/help"
import { isIos } from "../../../utils/push"
import { useSettings } from "../../../utils/settings"
import * as M from "./mapsCore.js"
import * as S from "./mapsStore.js"
import "./Maps.css"

// Maps 98: find a place, see where you are, get directions (drive, walk or bike) with every
// turn written out, follow along, or hand off to Apple Maps for real turn-by-turn navigation.
// Baseline: the search box, the map and the "where am I" button; a place's card has
// Directions and Open in Apple Maps; directions show the time, the distance and the steps.
// Other programs open it at a place with utils/maps.js openMaps({ name, lat, lon, directions }).
//   handoff: { id, dest: { name, lat, lon, detail }, directions, mode }

const MapsMap = React.lazy(() => import("./MapsMap.jsx"))
const NONE = []
const VIEW_EVENT = "98ish:couple-view" // a handoff for an open window (utils/couple.js VIEW_EVENT)

const metricRegion = () => {
  try {
    return !/^(en-US|en-LR|my)/i.test(navigator.language || "en-US")
  } catch {
    return false
  }
}

// one fix from the device, from a tap -> { lat, lon, acc } | { error }
const locateOnce = () =>
  new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ error: "This browser can't tell where you are." })
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => resolve({ error: e.code === 1 ? "Location is off for 98ish. Allow it in your browser's settings (on iPhone: Settings > Privacy > Location Services > Safari Websites), or type where you're starting." : "Couldn't find where you are right now. Try again outside, or type where you're starting." }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    )
  })

const TurnIcon = ({ type }) => {
  // Valhalla maneuver types: 1-3 start, 4-6 arrive, 9-11 right, 12-14 left, 8 straight, 26-27 roundabout
  const t = Number(type)
  const glyph = t >= 4 && t <= 6 ? "⚑" : t === 10 || t === 9 || t === 11 || t === 18 || t === 20 || t === 23 ? "↱" : t === 15 || t === 14 || t === 16 || t === 19 || t === 21 || t === 24 ? "↰" : t === 12 || t === 13 ? "↶" : t === 26 || t === 27 ? "⟳" : t >= 1 && t <= 3 ? "●" : "↑"
  return (
    <span className="mpTurn" aria-hidden="true">
      {glyph}
    </span>
  )
}

const Maps = ({ mobile, handoff, onClose }) => {
  useSettings()
  const [prefs, setPrefsState] = useState(S.loadPrefs)
  const [q, setQ] = useState("")
  const [results, setResults] = useState(null) // null | []
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)
  const [place, setPlace] = useState(null)
  const [me, setMe] = useState(null)
  const [locating, setLocating] = useState(false)
  const [dirs, setDirs] = useState(null) // { from: place | "me", route, busy, error }
  const [fromQ, setFromQ] = useState("")
  const [fromResults, setFromResults] = useState(null)
  const [following, setFollowing] = useState(false)
  const [showSteps, setShowSteps] = useState(!mobile)
  const mapRef = useRef(null)
  const watchId = useRef(null)
  const metric = useMemo(metricRegion, [])
  const mode = prefs.mode
  const setPrefs = (patch) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch }
      S.savePrefs(next)
      return next
    })

  // ---- you ----
  const findMe = async ({ fly = true } = {}) => {
    setLocating(true)
    const fix = await locateOnce()
    setLocating(false)
    if (fix.error) {
      setError(fix.error)
      return null
    }
    setMe(fix)
    if (fly) mapRef.current?.fly(fix, 15)
    return fix
  }
  // already allowed: show where you are without asking
  useEffect(() => {
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((p) => p.state === "granted" && findMe({ fly: !handoff?.dest && !place }))
      .catch(() => {})
    return () => watchId.current != null && navigator.geolocation?.clearWatch(watchId.current)
  }, [])

  // ---- search: as you type (3+ letters, 0.5 s after you stop), or on Search ----
  useEffect(() => {
    const text = q.trim()
    if (text.length < 3 || place?.name === text) return setResults(text ? results : null)
    const t = setTimeout(async () => {
      setSearching(true)
      const r = await S.searchPlaces(text, { near: me || mapRef.current?.center() })
      setSearching(false)
      if (r.ok) setResults(r.places)
    }, 500)
    return () => clearTimeout(t)
  }, [q])
  const searchNow = async () => {
    const text = q.trim()
    if (!text) return
    setSearching(true)
    setError(null)
    const r = await S.searchPlaces(text, { near: me || mapRef.current?.center(), explicit: true })
    setSearching(false)
    if (!r.ok) return setError(r.error)
    setResults(r.places)
    if (!r.places.length) setError(`Nothing found for "${text}". Try adding the city.`)
  }

  const choose = (p) => {
    setPlace(p)
    setResults(null)
    setQ(p.name)
    setDirs(null)
    setFollowing(false)
    setError(null)
    setPrefs({ recents: M.addRecent(prefs.recents, p) })
    mapRef.current?.fly(p, 15)
  }
  const dropPin = async (pt) => {
    const near = await S.placeAt(pt.lat, pt.lon)
    choose({ id: `pin${pt.lat.toFixed(5)},${pt.lon.toFixed(5)}`, name: near?.name ? `Near ${near.name}` : "Dropped pin", detail: near?.detail || `${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}`, lat: pt.lat, lon: pt.lon })
  }

  // ---- directions ----
  const route = dirs?.route || null
  const getDirections = async (to = place, { from = dirs?.from, travel = mode } = {}) => {
    if (!to) return
    let start = from && from !== "me" ? from : null
    if (!start) {
      const fix = me || (await findMe({ fly: false }))
      if (!fix) return setDirs({ from: null, route: null, busy: false, error: null, needFrom: true })
      start = fix
    }
    setDirs({ from: from || "me", route: null, busy: true, error: null })
    const r = await S.findRoute(start, to, travel, { metric })
    setDirs({ from: from || "me", route: r.ok ? r.route : null, busy: false, error: r.ok ? null : r.error })
    if (r.ok) mapRef.current?.fitRoute(r.route.line, mobile ? 40 : 60)
  }
  const pickFrom = (p) => {
    setFromResults(null)
    setFromQ(p.name)
    getDirections(place, { from: p })
  }
  useEffect(() => {
    const text = fromQ.trim()
    if (!dirs?.needFrom || text.length < 3) return
    const t = setTimeout(async () => {
      const r = await S.searchPlaces(text, { near: place })
      if (r.ok) setFromResults(r.places)
    }, 500)
    return () => clearTimeout(t)
  }, [fromQ])

  // following along: your dot moves, the next turn is shown, the map keeps you in view
  const follow = () => {
    if (!navigator.geolocation || !route) return
    setFollowing(true)
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const fix = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }
        setMe(fix)
        mapRef.current?.fly(fix, 16)
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    )
  }
  const stopFollowing = () => {
    setFollowing(false)
    if (watchId.current != null) navigator.geolocation?.clearWatch(watchId.current)
    watchId.current = null
  }
  const progress = following && route && me ? M.progressOn(route, me) : null

  // ---- what other programs ask for (openMaps) ----
  const takeHandoff = (h) => {
    const dest = M.cleanDest(h?.dest)
    if (!dest) return
    // (directions asked for by another program drive unless it says otherwise)
    const travel = M.modeOf(h.mode || (h.directions ? "drive" : mode)).id
    if (travel !== mode) setPrefs({ mode: travel })
    choose(dest)
    if (h.directions) getDirections(dest, { from: "me", travel })
  }
  useEffect(() => {
    if (handoff?.dest) takeHandoff(handoff)
  }, [handoff?.id])
  useEffect(() => {
    const onView = (e) => e.detail?.program === "Maps 98" && e.detail.handoff && takeHandoff(e.detail.handoff)
    window.addEventListener(VIEW_EVENT, onView)
    return () => window.removeEventListener(VIEW_EVENT, onView)
  })

  const apple = place ? M.appleMapsUrl(place, { from: dirs?.from && dirs.from !== "me" ? dirs.from : null, mode }) : null
  const google = place ? M.googleMapsUrl(place, { from: dirs?.from && dirs.from !== "me" ? dirs.from : null, mode }) : null
  const handoffUrl = isIos() || /Macintosh/.test(navigator.userAgent || "") ? apple : google
  const handoffLabel = isIos() || /Macintosh/.test(navigator.userAgent || "") ? "Open in Apple Maps" : "Open in Google Maps"

  const menus = [
    {
      label: "File",
      items: [
        { label: "Where Am I?", onClick: () => findMe() },
        { label: "Clear", onClick: () => (setPlace(null), setDirs(null), setQ(""), setResults(null), stopFollowing()) },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Directions",
      items: [
        ...M.MODES.map((m) => ({ label: m.label, checked: mode === m.id, onClick: () => (setPrefs({ mode: m.id }), place && dirs && getDirections(place, { travel: m.id })) })),
        "-",
        { label: "Directions to Here", disabled: !place, onClick: () => getDirections() },
        { label: handoffLabel, disabled: !place, onClick: () => handoffUrl && window.open(handoffUrl, "_blank", "noopener") },
      ],
    },
    { label: "Help", items: [helpItem({ program: "Maps 98" }), "-", { label: "About Maps 98", onClick: () => setError("Maps 98: search by Photon (komoot) and Nominatim, directions by Valhalla on FOSSGIS's servers, map by OpenFreeMap. Map data © OpenStreetMap contributors.") }] },
  ]

  return (
    <div className={`mpRoot${mobile ? " is-mobile" : ""}${route ? " has-route" : ""}`} data-maps>
      <MenuBar menus={menus} />
      <form
        className="mpSearch"
        onSubmit={(e) => {
          e.preventDefault()
          searchNow()
        }}
      >
        <input type="search" enterKeyHint="search" aria-label="Search for a place" placeholder="Search for a place or address" value={q} onChange={(e) => setQ(e.target.value)} data-maps-search />
        <button type="submit" disabled={!q.trim() || searching}>
          {searching ? "..." : "Search"}
        </button>
        <button type="button" className="mpMeBtn" onClick={() => findMe()} disabled={locating} aria-label="Where am I?" title="Where am I?">
          {locating ? "…" : "◎"}
        </button>
      </form>

      <div className="mpBody">
        <div className="mpMapArea">
          <Suspense fallback={<div className="mpLoading">Loading the map...</div>}>
            <MapsMap ref={mapRef} place={place} me={me} route={route} results={results || NONE} onPick={choose} onDrop={dropPin} />
          </Suspense>
          {results && q.trim().length >= 3 && (results.length > 0 || !searching) && (
            <ul className="mpResults window" role="listbox" aria-label="Places found">
              {results.length ? (
                results.map((r, i) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => choose(r)} data-maps-result={i}>
                      <span className="mpNum">{i + 1}</span>
                      <span>
                        <b>{r.name}</b>
                        {r.detail && <small>{r.detail}</small>}
                      </span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="mpNone">Nothing found yet. Press Search, or add the city.</li>
              )}
            </ul>
          )}
          {!place && !results && prefs.recents.length > 0 && !q && (
            <div className="mpRecents window">
              <div className="mpRecentsTitle">Recent places</div>
              {prefs.recents.slice(0, 4).map((r) => (
                <button key={r.id} type="button" onClick={() => choose(r)}>
                  <b>{r.name}</b>
                  {r.detail && <small>{r.detail}</small>}
                </button>
              ))}
            </div>
          )}
        </div>

        {place && (
          <div className="mpCard window" data-maps-card>
            <div className="mpCardHead">
              <span className="mpCardPin" aria-hidden="true" />
              <div className="mpCardName">
                <b>{place.name}</b>
                {place.detail && <small>{place.detail}</small>}
              </div>
              <button type="button" className="mpX" aria-label="Close" onClick={() => (setPlace(null), setDirs(null), stopFollowing())}>
                ✕
              </button>
            </div>

            {!dirs && (
              <div className="mpCardButtons">
                <button type="button" className="mpPrimary" onClick={() => getDirections()} data-maps-directions>
                  Directions
                </button>
                <a className="mpHandoff" href={handoffUrl} target="_blank" rel="noopener noreferrer" data-maps-apple>
                  {handoffLabel}
                </a>
              </div>
            )}

            {dirs && (
              <div className="mpDirs">
                <div className="mpModes" role="radiogroup" aria-label="Travel by">
                  {M.MODES.map((m) => (
                    <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={mode === m.id ? "is-on" : ""} onClick={() => (setPrefs({ mode: m.id }), getDirections(place, { travel: m.id }))}>
                      {m.id === "drive" ? "🚗" : m.id === "walk" ? "🚶" : "🚲"} {m.label}
                    </button>
                  ))}
                </div>
                <div className="mpFrom">From: {dirs.from && dirs.from !== "me" ? dirs.from.name : me ? "Your location" : "..."}</div>
                {dirs.needFrom && (
                  <div className="mpFromAsk">
                    <input type="search" aria-label="Starting point" placeholder="Where are you starting? (an address or place)" value={fromQ} onChange={(e) => setFromQ(e.target.value)} />
                    {fromResults?.length > 0 && (
                      <ul className="mpFromList">
                        {fromResults.slice(0, 5).map((r) => (
                          <li key={r.id}>
                            <button type="button" onClick={() => pickFrom(r)}>
                              <b>{r.name}</b> <small>{r.detail}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {dirs.busy && <div className="mpHint">Finding the way...</div>}
                {dirs.error && <div className="mpError">{dirs.error}</div>}
                {route && (
                  <>
                    <div className="mpSummary" data-maps-summary>
                      <b>{M.durationText(route.time)}</b> · {M.distanceText(route.distance, route.units)}
                    </div>
                    {progress && route.steps[progress.step] && (
                      <div className="mpNext" data-maps-next>
                        <TurnIcon type={route.steps[progress.step].type} />
                        <div>
                          <b>{route.steps[progress.step].text}</b>
                          <small>in {metric ? `${progress.toNext} m` : progress.toNext > 300 ? `${(progress.toNext / 1609).toFixed(1)} mi` : `${Math.round(progress.toNext * 3.28)} ft`}</small>
                        </div>
                      </div>
                    )}
                    <div className="mpCardButtons">
                      {following ? (
                        <button type="button" onClick={stopFollowing}>
                          Stop
                        </button>
                      ) : (
                        <button type="button" className="mpPrimary" onClick={follow} data-maps-follow>
                          Start
                        </button>
                      )}
                      <a className="mpHandoff" href={handoffUrl} target="_blank" rel="noopener noreferrer">
                        {handoffLabel}
                      </a>
                    </div>
                    <button type="button" className="mpStepsToggle" aria-expanded={showSteps} onClick={() => setShowSteps(!showSteps)}>
                      {showSteps ? "▾" : "▸"} {route.steps.length} steps
                    </button>
                    {showSteps && (
                      <ol className="mpSteps" data-maps-steps data-selectable>
                        {route.steps.map((s) => (
                          <li key={s.n} className={progress?.step === s.n ? "is-next" : ""}>
                            <TurnIcon type={s.type} />
                            <span>
                              {s.text}
                              {s.distance > 0 && <small> {M.distanceText(s.distance, route.units)}</small>}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                    <div className="mpHint">Maps 98 shows the way while it's open on screen. For spoken turn-by-turn with the screen off, use {handoffLabel.replace("Open in ", "")}.</div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mpStatus" role="status" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      <div className="mpCredit">Search: Photon / Nominatim · Directions: Valhalla (FOSSGIS) · Map: OpenFreeMap · © OpenStreetMap</div>
    </div>
  )
}

export default Maps
