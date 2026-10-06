import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"

// The map: MapLibre GL with OpenFreeMap's vector tiles (free, no key, no usage limits; the
// style carries the "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" credit). Both load
// only when Buddy Locator opens, so the rest of 98ish never downloads them.
// Pins are plain HTML (a 98-style square with initials and a name tag); accuracy and place
// circles are GeoJSON layers.
//   people: [{ key, name, pos, color, me? }]   places: [{ id, name, lat, lon, r }]
//   ref: focus(pos, zoom?), fit(), center() -> { lat, lon }

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty"

// a circle of `r` metres around a point, as a GeoJSON polygon
const circle = (lat, lon, r, steps = 48) => {
  const ring = []
  const dLat = r / 111_320
  const dLon = r / (111_320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)))
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)])
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} }
}

export const initials = (name) =>
  String(name || "?")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(/\s+|(?=[A-Z][a-z])/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?"

const pinElement = (person, onSelect) => {
  const el = document.createElement("button")
  el.type = "button"
  el.className = `locPin${person.me ? " is-me" : ""}`
  el.dataset.pin = person.key
  el.setAttribute("aria-label", person.me ? "You" : person.name)
  el.innerHTML = `<span class="locPinFace"></span><span class="locPinName"></span>`
  el.addEventListener("click", (e) => {
    e.stopPropagation()
    onSelect?.(person.key)
  })
  return el
}
const paintPin = (el, person, selected) => {
  el.querySelector(".locPinFace").textContent = person.me ? "" : initials(person.name)
  el.querySelector(".locPinFace").style.background = person.color
  el.querySelector(".locPinName").textContent = person.me ? "You" : person.name
  el.classList.toggle("is-selected", !!selected)
  el.classList.toggle("is-stale", !!person.stale)
}

const LocatorMap = forwardRef(({ people, places, selected, onSelect, onReady }, ref) => {
  const box = useRef(null)
  const mapRef = useRef(null)
  const libRef = useRef(null)
  const markers = useRef(new Map()) // key -> { marker, el }
  const fitted = useRef(false)
  const [error, setError] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const latest = useRef({ people, places, selected, onSelect })
  latest.current = { people, places, selected, onSelect }

  const located = (list) => list.filter((p) => p.pos)

  const fit = () => {
    const map = mapRef.current
    const lib = libRef.current
    const list = located(latest.current.people)
    if (!map || !lib || !list.length) return
    if (list.length === 1) {
      map.jumpTo({ center: [list[0].pos.lon, list[0].pos.lat], zoom: 14 })
      return
    }
    const bounds = new lib.LngLatBounds()
    for (const p of list) bounds.extend([p.pos.lon, p.pos.lat])
    map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 })
  }

  useImperativeHandle(ref, () => ({
    focus: (pos, zoom = 15) => mapRef.current?.flyTo({ center: [pos.lon, pos.lat], zoom: Math.max(zoom, mapRef.current.getZoom()), duration: 700 }),
    fit,
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
        const first = located(latest.current.people)[0]?.pos
        map = new maplibregl.Map({
          container: box.current,
          style: MAP_STYLE,
          center: first ? [first.lon, first.lat] : [-98.5, 39.5],
          zoom: first ? 13 : 3,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          cooperativeGestures: false,
        })
        map.touchZoomRotate.disableRotation()
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")
        mapRef.current = map
        if (typeof window !== "undefined") window.__locatorMap = map
        map.on("error", (e) => {
          // a missing tile is fine; a failed style means no map
          if (String(e?.error?.message || "").includes("style")) setError("The map couldn't load. Check the connection and try again.")
        })
        map.on("load", () => {
          if (dead) return
          map.addSource("acc", { type: "geojson", data: { type: "FeatureCollection", features: [] } })
          map.addLayer({ id: "acc-fill", type: "fill", source: "acc", paint: { "fill-color": "#1a6dff", "fill-opacity": 0.12 } })
          map.addLayer({ id: "acc-line", type: "line", source: "acc", paint: { "line-color": "#1a6dff", "line-width": 1, "line-opacity": 0.5 } })
          map.addSource("places", { type: "geojson", data: { type: "FeatureCollection", features: [] } })
          map.addLayer({ id: "places-fill", type: "fill", source: "places", paint: { "fill-color": "#008080", "fill-opacity": 0.1 } })
          map.addLayer({ id: "places-line", type: "line", source: "places", paint: { "line-color": "#008080", "line-width": 2, "line-dasharray": [2, 2] } })
          map.addLayer({
            id: "places-label",
            type: "symbol",
            source: "places",
            layout: { "text-field": ["get", "name"], "text-size": 12, "text-font": ["Noto Sans Bold"], "text-anchor": "bottom", "text-allow-overlap": true, "text-ignore-placement": true },
            paint: { "text-color": "#005050", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
            filter: ["==", ["get", "label"], true],
          })
          setLoaded(true)
          onReady?.()
        })
      } catch (err) {
        if (!dead) setError(/webgl/i.test(String(err?.message)) ? "This device can't draw the map (it needs WebGL). The list below still shows everyone." : "The map couldn't load. The list below still shows everyone.")
      }
    })()
    return () => {
      dead = true
      for (const { marker } of markers.current.values()) marker.remove()
      markers.current.clear()
      map?.remove()
      mapRef.current = null
      if (typeof window !== "undefined" && window.__locatorMap === map) window.__locatorMap = null
    }
  }, [])

  // pins and accuracy circles follow the people
  useEffect(() => {
    const map = mapRef.current
    const lib = libRef.current
    if (!map || !lib || !loaded) return
    const list = located(people)
    const seen = new Set()
    for (const person of list) {
      seen.add(person.key)
      let entry = markers.current.get(person.key)
      if (!entry) {
        const el = pinElement(person, (key) => latest.current.onSelect?.(key))
        entry = { el, marker: new lib.Marker({ element: el, anchor: "bottom" }).setLngLat([person.pos.lon, person.pos.lat]).addTo(map) }
        markers.current.set(person.key, entry)
      } else {
        const was = entry.marker.getLngLat()
        entry.marker.setLngLat([person.pos.lon, person.pos.lat])
        // the buddy you picked moved: the map follows them
        if (person.key === selected && (Math.abs(was.lat - person.pos.lat) > 1e-6 || Math.abs(was.lng - person.pos.lon) > 1e-6)) map.easeTo({ center: [person.pos.lon, person.pos.lat], duration: 600 })
      }
      paintPin(entry.el, person, person.key === selected)
    }
    for (const [key, entry] of markers.current) {
      if (seen.has(key)) continue
      entry.marker.remove()
      markers.current.delete(key)
    }
    map.getSource("acc")?.setData({ type: "FeatureCollection", features: list.filter((p) => (p.pos.acc || 0) > 15).map((p) => circle(p.pos.lat, p.pos.lon, Math.min(p.pos.acc, 5000))) })
    if (!fitted.current && list.some((p) => !p.me)) {
      fitted.current = true
      fit()
    } else if (!fitted.current && list.length) {
      fit()
    }
  }, [people, selected, loaded])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    const features = []
    for (const p of places || []) {
      features.push({ ...circle(p.lat, p.lon, p.r), properties: { name: p.name, label: false } })
      // the name sits on the circle's top edge, clear of the pins in the middle
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat + p.r / 111_320] }, properties: { name: p.name, label: true } })
    }
    map.getSource("places")?.setData({ type: "FeatureCollection", features })
  }, [places, loaded])

  return (
    <div className="locMapWrap" data-touch-surface>
      <div ref={box} className="locMap" data-map={loaded ? "ready" : "loading"} />
      {!loaded && !error && <div className="locMapNote">Loading the map...</div>}
      {error && <div className="locMapNote is-error">{error}</div>}
    </div>
  )
})

export default LocatorMap
