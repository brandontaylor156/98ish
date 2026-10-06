import React, { useEffect, useRef, useState } from "react"
import MoreOptions from "../../../../shared/MoreOptions"
import { RIVERSIDE_ENTRY } from "../ParkHud"
import { ATTRIBUTION, courtCount } from "./finder.js"
import { loadMeta, searchVenues, venuesNear } from "./liveVenue.js"
import "./finder.css"

// My Park's "where to?": the featured venues (Riverside and the hand-tuned real ones) and your
// starred ones first, then Venue Finder: search any pickleball venue on Earth by name or town,
// or Near me (the phone's location only picks which part of the index to load; it's never
// sent anywhere). Filters live under More options.
//
// onPick(id, place): place is the index row for a Venue Finder venue (null for featured ones),
// kept in prefs so starred venues show without loading the index.

const describe = (v) => {
  const n = v.courts !== undefined && v.title !== undefined ? courtCount(v) : v.courts
  const bits = [v.town || v.city, `${n} court${n === 1 ? "" : "s"}`, v.indoor ? "indoor" : "outdoor"]
  if (v.lit) bits.push("lights")
  if (v.access === "members" || v.members) bits.push("members' club")
  if (v.private) bits.push("private")
  if (typeof v.km === "number") bits.push(v.km < 1 ? `${Math.round(v.km * 1000)} m` : `${v.km.toFixed(v.km < 10 ? 1 : 0)} km`)
  return bits.filter(Boolean).join(" · ")
}

const Row = ({ v, current, fav, loading, onPick, onFav }) => (
  <li className={v.id === current ? "is-current" : ""}>
    <button type="button" className="pkParkVenueGo" onClick={() => onPick(v)} disabled={!!loading} data-venue={v.id}>
      <b>{v.short || v.title || v.name}</b>
      <small>{describe(v)}</small>
      {loading === v.id && <small className="pkParkVenueLoading">{v.title ? "Building it from the map..." : "Loading..."}</small>}
    </button>
    <button type="button" className={`pkParkVenueStar${fav ? " is-on" : ""}`} onClick={() => onFav(v)} aria-label={fav ? `Unstar ${v.short || v.title}` : `Star ${v.short || v.title}`} aria-pressed={fav} data-star={v.id}>
      {fav ? "★" : "☆"}
    </button>
  </li>
)

export const FinderPanel = ({ list = [], places = {}, current = "riverside", favs = [], loading = null, error = null, onPick, onFav, onClose }) => {
  const [q, setQ] = useState("")
  const [results, setResults] = useState(null) // null: nothing asked yet
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")
  const [filters, setFilters] = useState({ indoor: false, lit: false, big: false, open: false })
  const [meta, setMeta] = useState(null)
  const asked = useRef(0)
  const fav = new Set(favs)
  useEffect(() => {
    loadMeta().then(setMeta)
  }, [])

  // featured first (starred on top), then starred Venue Finder venues
  const featured = [RIVERSIDE_ENTRY, ...list]
  const starredLive = favs.filter((id) => places[id] && !featured.some((v) => v.id === id)).map((id) => places[id])
  const top = [...featured.filter((v) => fav.has(v.id)), ...starredLive, ...featured.filter((v) => !fav.has(v.id))]

  const run = async (fn) => {
    const n = ++asked.current
    setBusy(true)
    setNote("")
    try {
      const out = await fn()
      if (n === asked.current) setResults(out)
    } catch (e) {
      if (n === asked.current) setNote(e.message || "Couldn't search right now.")
    } finally {
      if (n === asked.current) setBusy(false)
    }
  }
  const search = (e) => {
    e?.preventDefault?.()
    if (q.trim().length < 2) return
    run(() => searchVenues(q.trim()))
  }
  const nearMe = () => {
    if (!navigator.geolocation) return setNote("This device can't tell where it is.")
    setBusy(true)
    setNote("Finding courts near you...")
    navigator.geolocation.getCurrentPosition(
      (pos) => run(() => venuesNear(pos.coords.latitude, pos.coords.longitude, { km: 80, limit: 40 })),
      () => {
        setBusy(false)
        setNote("Location is off. Search by name or town instead.")
      },
      { maximumAge: 10 * 60 * 1000, timeout: 15000, enableHighAccuracy: false }
    )
  }
  const shown = (results || []).filter((v) => (!filters.indoor || v.indoor) && (!filters.lit || v.lit) && (!filters.big || courtCount(v) >= 8) && (!filters.open || (!v.private && !v.members)))
  const pickRow = (v) => onPick(v.id, v.title !== undefined ? v : null)
  const favRow = (v) => onFav(v.id, v.title !== undefined ? v : null)

  return (
    <div className="pkCenter pkDim" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="pkPanel pkParkVenues window" data-park="venues">
        <div className="pkParkMenuHead">
          <b>My Park: where to?</b>
          <button type="button" className="pkParkVenuesX" onClick={onClose} aria-label="Close" data-park="venues-close">
            ×
          </button>
        </div>
        <form className="pkFinderBar" onSubmit={search} data-finder="bar">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Any court: name, town or ZIP" aria-label="Search pickleball venues" data-finder="q" enterKeyHint="search" />
          <button type="submit" disabled={busy || q.trim().length < 2} data-finder="go">
            Find
          </button>
          <button type="button" onClick={nearMe} disabled={busy} data-finder="near">
            Near me
          </button>
        </form>
        {error && <p className="pkFinderError">{error}</p>}
        {note && <p className="pkFinderNote">{note}</p>}
        {results && (
          <>
            <h4 className="pkFinderH">{busy ? "Looking..." : shown.length ? `${shown.length} venue${shown.length === 1 ? "" : "s"}` : "No venues found"}</h4>
            <ul className="pkParkVenueList" data-finder="results">
              {shown.map((v) => (
                <Row key={v.id} v={v} current={current} fav={fav.has(v.id)} loading={loading} onPick={pickRow} onFav={favRow} />
              ))}
            </ul>
            <MoreOptions id="pickleball.finder" label="Filters" className="pkFinderMore">
              <div className="pkFinderFilters">
                {[
                  ["indoor", "Indoor only"],
                  ["lit", "With lights"],
                  ["big", "8+ courts"],
                  ["open", "Public only"],
                ].map(([k, l]) => (
                  <span key={k} className="pkFinderCheck">
                    <input id={`pk-finder-${k}`} type="checkbox" checked={filters[k]} onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.checked }))} />
                    <label htmlFor={`pk-finder-${k}`}>{l}</label>
                  </span>
                ))}
              </div>
            </MoreOptions>
            <h4 className="pkFinderH">Featured</h4>
          </>
        )}
        <ul className="pkParkVenueList" data-finder="featured">
          {top.map((v) => (
            <Row key={v.id} v={v} current={current} fav={fav.has(v.id)} loading={loading} onPick={pickRow} onFav={favRow} />
          ))}
        </ul>
        <p className="pkParkCredit">
          {ATTRIBUTION}. {meta ? `${meta.venues.toLocaleString()} venues worldwide, ` : ""}built live in 98ish style. Near me uses your location on this device only.
        </p>
      </div>
    </div>
  )
}

export default FinderPanel
