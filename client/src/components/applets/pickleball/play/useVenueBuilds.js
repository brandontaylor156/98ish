// Pickleball 98: the engine's venue for wherever you play. An arena is its id (venue.js); a real
// venue (My Park's, or a Venue Finder court) is the court venue My Park's games use
// (park/courtvenue.js: the venue's own picture round one of its courts) lit for the time of
// day you chose (park/timeofday.js). Layouts are kept (the last three) so flipping between
// venues in the picker only rebuilds the picture.
//
//   const { venueFor, preview } = useVenueBuilds({ getEngine, loadLayout, prefsRef, mobile })
//   await venueFor(id, tod, { court })   -> "stadium" | { key, build, room }
//   preview(id, tod)                     -> the title's demo match moves there (the background)

import { useRef, useState } from "react"
import { isArena, placeById } from "./places.js"
import { timeAt, lookFor } from "../park/timeofday.js"
import { cachedWeather, fetchWeather } from "../park/weather.js"
import { pickCourt } from "./courtpick.js"

const KEEP = 3

export const useVenueBuilds = ({ getEngine, loadLayout, prefsRef, mobile }) => {
  const layouts = useRef(new Map()) // id -> Promise<layout>
  const token = useRef(0)
  const [loading, setLoading] = useState(null)
  const [error, setError] = useState(null)

  const layoutOf = (id) => {
    const cache = layouts.current
    if (cache.has(id)) {
      const p = cache.get(id)
      cache.delete(id)
      cache.set(id, p)
      return p
    }
    const p = loadLayout(id)
    cache.set(id, p)
    p.catch(() => cache.delete(id))
    while (cache.size > KEEP) cache.delete(cache.keys().next().value)
    return p
  }

  // today's weather there for "Now" (a short wait at most; the cached copy if it's fresh)
  const weatherAt = async (place) => {
    const c = cachedWeather(place)
    if (c) return c
    return Promise.race([fetchWeather(place).catch(() => null), new Promise((r) => setTimeout(() => r(null), 1500))])
  }

  const venueFor = async (id, tod = "now", { court = null } = {}) => {
    const prefs = prefsRef.current
    if (!id || isArena(id)) return id || "park"
    const place = placeById(id, prefs)
    if (!place) return "park"
    const [layout, cv] = await Promise.all([layoutOf(id), import("../park/courtvenue.js")])
    const t = timeAt(tod, place)
    const real = prefs.quality !== "low" && prefs.realSky !== false
    const weather = t === "now" && real ? await weatherAt(place) : null
    const look = lookFor(t, place, { weather, real })
    const want = court ?? prefs.parkCourt?.[id]
    const c = pickCourt(layout, want)
    // (the key: a different court or light is a different picture; the same one isn't rebuilt)
    const key = `park:${layout.id}:${c.id}:${t}:${t === "now" ? Math.round(Date.now() / 600_000) : ""}`
    return { key, court: c.id, build: (scene, o) => cv.buildCourtVenue(scene, { layout, courtId: c.id, quality: o.quality, look, phone: !!mobile }), room: layout.spec.indoor ? "hall" : "park" }
  }

  // the title's background: the demo match at that venue and time (the latest pick wins)
  const preview = async (id, tod) => {
    const n = ++token.current
    setError(null)
    setLoading(isArena(id) ? null : id)
    try {
      const v = await venueFor(id, tod)
      if (n !== token.current) return
      getEngine()?.setDemoVenue?.(v)
    } catch (e) {
      console.error(e)
      if (n === token.current) setError("That venue couldn't be loaded right now.")
    } finally {
      if (n === token.current) setLoading(null)
    }
  }

  return { venueFor, preview, loading, error }
}
