import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { MAP_STYLE } from "../locator/LocatorMap"

// Maps 98's map: MapLibre GL + OpenFreeMap (the same as Buddy Locator, loaded only when Maps 98
// opens). A red 98-style pin for the place, a blue dot for you, the route as a navy line with a
// white casing, results as little numbered squares. Touching and holding the map (or right-clicking) drops a pin.
//   ref: fly(place, zoom?), fitRoute(line), center() -> { lat, lon }

const ROUTE = "maps-route"

const el = (cls, html = "") => {
  const e = document.createElement("div")
  e.className = cls
  e.innerHTML = html
  return e
}

const MapsMap = forwardRef(({ place, me, route, results, onPick, onDrop, onReady }, ref) => {
  const box = useRef(null)
  const mapRef = useRef(null)
  const libRef = useRef(null)
  const marks = useRef({ place: null, me: null, results: [] })
  const [error, setError] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const latest = useRef({ onPick, onDrop })
  latest.current = { onPick, onDrop }

  useImperativeHandle(ref, () => ({
    fly: (p, zoom = 15) => mapRef.current?.flyTo({ center: [p.lon, p.lat], zoom: Math.max(zoom, Math.min(15, mapRef.current.getZoom())), duration: 700 }),
    fitRoute: (line, padding = 50) => {
      const map = mapRef.current
      const lib = libRef.current
      if (!map || !lib || !line?.length) return
      const b = new lib.LngLatBounds()
      for (const pt of line) b.extend(pt)
      map.fitBounds(b, { padding, maxZoom: 16, duration: 600 })
    },
    center: () => {
      const c = mapRef.current?.getCenter()
      return c ? { lat: c.lat, lon: c.lng } : null
    },
  }))

  useEffect(() => {
    let dead = false
    let map = null
    ;(async () => {
      try {
        const [{ default: maplibregl }] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")])
        if (dead || !box.current) return
        libRef.current = maplibregl
        const start = place || me
        map = new maplibregl.Map({
          container: box.current,
          style: MAP_STYLE,
          center: start ? [start.lon, start.lat] : [-98.5, 39.5],
          zoom: start ? 14 : 3,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        })
        map.touchZoomRotate.disableRotation()
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")
        mapRef.current = map
        if (import.meta.env?.DEV) window.__mapsMap = map
        map.on("error", (e) => {
          if (String(e?.error?.message || "").includes("style")) setError("The map couldn't load. Check the connection and try again.")
        })
        map.on("load", () => {
          if (dead) return
          map.addSource(ROUTE, { type: "geojson", data: { type: "FeatureCollection", features: [] } })
          map.addLayer({ id: `${ROUTE}-casing`, type: "line", source: ROUTE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 9 } })
          map.addLayer({ id: ROUTE, type: "line", source: ROUTE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000080", "line-width": 5 } })
          setLoaded(true)
          onReady?.()
        })
        // touch and hold (or right-click) the map to drop a pin there
        const drop = (e) => latest.current.onDrop?.({ lat: e.lngLat.lat, lon: e.lngLat.lng })
        map.on("contextmenu", drop)
        let hold = null
        map.on("touchstart", (e) => {
          clearTimeout(hold)
          if (e.originalEvent?.touches?.length !== 1) return
          hold = setTimeout(() => drop(e), 600)
        })
        for (const ev of ["touchend", "touchcancel", "touchmove", "movestart", "zoomstart"]) map.on(ev, () => clearTimeout(hold))
      } catch {
        if (!dead) setError("This browser can't draw the map (it needs WebGL). Search and directions still work as a list.")
      }
    })()
    return () => {
      dead = true
      map?.remove()
      mapRef.current = null
    }
  }, [])

  // the place's pin
  useEffect(() => {
    const map = mapRef.current
    const lib = libRef.current
    if (!map || !lib) return
    marks.current.place?.remove()
    marks.current.place = null
    if (!place) return
    const pin = el("mpPin", `<span class="mpPinHead"></span><span class="mpPinTail"></span>`)
    pin.setAttribute("aria-label", place.name)
    marks.current.place = new lib.Marker({ element: pin, anchor: "bottom" }).setLngLat([place.lon, place.lat]).addTo(map)
  }, [place?.lat, place?.lon, loaded])

  // you
  useEffect(() => {
    const map = mapRef.current
    const lib = libRef.current
    if (!map || !lib) return
    if (!me) {
      marks.current.me?.remove()
      marks.current.me = null
      return
    }
    if (!marks.current.me) {
      const dot = el("mpMe", `<span></span>`)
      dot.setAttribute("aria-label", "You are here")
      marks.current.me = new lib.Marker({ element: dot }).setLngLat([me.lon, me.lat]).addTo(map)
    } else marks.current.me.setLngLat([me.lon, me.lat])
  }, [me?.lat, me?.lon, loaded])

  // search results
  useEffect(() => {
    const map = mapRef.current
    const lib = libRef.current
    if (!map || !lib) return
    for (const m of marks.current.results) m.remove()
    marks.current.results = (results || []).slice(0, 9).map((r, i) => {
      const b = document.createElement("button")
      b.type = "button"
      b.className = "mpResult"
      b.textContent = String(i + 1)
      b.setAttribute("aria-label", r.name)
      b.addEventListener("click", (e) => {
        e.stopPropagation()
        latest.current.onPick?.(r)
      })
      return new lib.Marker({ element: b }).setLngLat([r.lon, r.lat]).addTo(map)
    })
    if (results?.length > 1) {
      const bounds = new lib.LngLatBounds()
      for (const r of results.slice(0, 9)) bounds.extend([r.lon, r.lat])
      map.fitBounds(bounds, { padding: 50, maxZoom: 15, duration: 500 })
    }
  }, [results, loaded])

  // the route line
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    map.getSource(ROUTE)?.setData(route?.line?.length ? { type: "Feature", geometry: { type: "LineString", coordinates: route.line }, properties: {} } : { type: "FeatureCollection", features: [] })
  }, [route, loaded])

  return (
    <div className="mpMapWrap">
      <div ref={box} className="mpMap" data-touch-surface />
      {error && <div className="mpMapError">{error}</div>}
    </div>
  )
})

export default MapsMap
