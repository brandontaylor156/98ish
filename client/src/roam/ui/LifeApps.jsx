// Roam life on the in-game phone: Places (your private Home and Work: set them on a building, go
// there, share them with a buddy) and Bag (what you bought, gifts waiting, using things). The
// phone (RoamPhone.jsx) shows them; `life` is the page's handful of actions (Pickleball.jsx):
//   { eat(itemId), put(kind), ride(model, color), equip(id), gift(id), travel(place) }
// and world.host.life is the store (utils/roamLife.js through host98.js).

import React, { useEffect, useMemo, useState } from "react"
import { itemOf, useVerb } from "../life/catalog.js"
import { newPlaceId, placeFor, sharedLabel } from "../life/places.js"

const useLife = (world) => {
  const L = world.host?.life
  const [s, setS] = useState(() => L?.state || {})
  useEffect(() => (L ? L.subscribe(setS) : undefined), [L])
  return [L, s]
}
const townName = (world, id) => world.host?.towns?.().find((t) => t.id === id)?.name || id

// set a place on the building at (x, z) (a tap on the map, or where you stand)
export const setPlaceAt = async (world, kind, x, z, label = "") => {
  const L = world.host?.life
  if (!L) return { ok: false, error: "Places aren't available here." }
  const old = (L.state.places || []).find((p) => p.kind === kind)
  const b = world.buildingAt?.(x, z, 30)
  const id = old?.id || newPlaceId()
  let place
  if (b) place = placeFor({ building: b, toward: world.nearestRoadPoint?.(b.x, b.z) || { x, z }, kind, label: label || old?.label || "", town: world.town.id, id })
  // (a building too far off to be loaded yet: the spot now, the door found when you get close)
  else place = { id, kind, label: label || old?.label || "", town: world.town.id, x, z, door: { x, z, yaw: 0 } }
  const r = await L.savePlace(place)
  return r.ok ? { ok: true, place, rough: !b } : r
}

export function PlacesApp({ world, life, onClose }) {
  const [L, s] = useLife(world)
  const [msg, setMsg] = useState("")
  const [sharing, setSharing] = useState(null) // a place id
  const buddies = useMemo(() => world.host?.messages?.buddies?.() || [], [world])
  if (!L) return <div className="rphPage">Places aren't available here.</div>
  const mine = s.places || []
  const here = async (kind) => {
    const m = world.meNow?.()
    if (!m) return setMsg("Get out of the car first.")
    setMsg("Saving...")
    const r = await setPlaceAt(world, kind, m.x, m.z)
    setMsg(r.ok ? `${kind === "work" ? "Work" : "Home"} set: ${r.rough ? "the building nearest you" : "this building"}. Only you see it.` : r.error)
  }
  const go = (p, how) => {
    if (p.town !== world.town.id) {
      if (how !== "fast") return setMsg(`That's in ${townName(world, p.town)}. Use Go to get there first.`)
      onClose()
      return life?.travel?.(p)
    }
    const dest = { x: p.door.x, z: p.door.z, name: p.ownerName ? sharedLabel(p.ownerName, p) : p.label }
    if (how === "fast") {
      onClose()
      return life?.travel?.(p)
    }
    if (how === "drive")
      return world.setDestination(dest).then((r) => {
        if (!r.ok) return setMsg(r.error)
        onClose()
      })
    if (how === "ride")
      return world.callRide("ryde", dest).then((r) => {
        if (!r.ok) return setMsg(r.error)
        setMsg(`${r.driver} is on the way.`)
      })
  }
  const toggleShare = async (p, name) => {
    // (the server keeps keys; the buddy list has names: share with this one more, or not)
    const key = name.replace(/\s+/g, "").toLowerCase()
    const on = (p.shared || []).includes(key)
    const next = buddies.filter((b) => {
      const k = b.name.replace(/\s+/g, "").toLowerCase()
      return k === key ? !on : (p.shared || []).includes(k)
    })
    setMsg("Saving...")
    const r = await L.sharePlace(
      p.id,
      next.map((b) => b.name)
    )
    setMsg(r.ok ? (on ? `${name} can't see it any more.` : `${name} can see it on their map now.`) : r.error)
  }
  const row = (p, own) => (
    <li key={`${own ? "m" : p.owner}${p.id}`} className="rlfPlace" data-life={`place-${p.kind}`}>
      <b>
        {p.kind === "work" ? "💼" : "🏠"} {own ? p.label : sharedLabel(p.ownerName, p)}
      </b>
      <small>
        {townName(world, p.town)}
        {own ? ` · ${p.shared?.length ? `shared with ${p.shared.length}` : "private"}` : ""}
      </small>
      <span className="rphRow">
        <button type="button" className="rphPrimary" onClick={() => go(p, "fast")} data-life={`go-${p.kind}`}>
          {p.kind === "work" ? "Go to work" : "Go home"}
        </button>
        {p.town === world.town.id && (
          <>
            <button type="button" onClick={() => go(p, "drive")} data-life={`directions-${p.kind}`}>
              Directions
            </button>
            <button type="button" onClick={() => go(p, "ride")}>
              Ryde 98
            </button>
          </>
        )}
      </span>
      {own && (
        <span className="rphRow">
          <button type="button" onClick={() => setSharing(sharing === p.id ? null : p.id)} data-life={`share-${p.kind}`}>
            Share...
          </button>
          <button type="button" onClick={() => L.removePlace(p.id).then((r) => setMsg(r.ok ? "Removed." : r.error))}>
            Remove
          </button>
        </span>
      )}
      {own && sharing === p.id && (
        <span className="rlfShareList">
          {!L.signedOn() ? (
            <small>Sign on to 98 Messenger to share a place.</small>
          ) : buddies.length ? (
            buddies.slice(0, 10).map((b) => {
              const on = (p.shared || []).includes(b.name.replace(/\s+/g, "").toLowerCase())
              return (
                <button key={b.name} type="button" className={on ? "is-on" : ""} onClick={() => toggleShare(p, b.name)} data-life={`share-with-${b.name}`}>
                  {on ? "✓ " : ""}
                  {b.name}
                </button>
              )
            })
          ) : (
            <small>Add a buddy in 98 Messenger first.</small>
          )}
          <small>Only the buddies ticked here see it, as "{sharedLabel(L.me() || "You", p)}".</small>
        </span>
      )}
    </li>
  )
  const has = (k) => mine.some((p) => p.kind === k)
  return (
    <div className="rphPage" data-life="places">
      <ul className="rphList rlfPlaces">
        {mine.map((p) => row(p, true))}
        {(s.shared || []).map((p) => row(p, false))}
      </ul>
      {!mine.length && <p>Set your Home and your Work: tap a building on Maps, or set it here where you stand.</p>}
      <div className="rphRow">
        <button type="button" onClick={() => here("home")} data-life="set-home-here">
          {has("home") ? "Move Home here" : "Set Home here"}
        </button>
        <button type="button" onClick={() => here("work")} data-life="set-work-here">
          {has("work") ? "Move Work here" : "Set Work here"}
        </button>
      </div>
      <small className="rphNote">Private: only you see your places, unless you share one with a buddy. {L.signedOn() ? "Kept on your account." : "Kept on this device (sign on to keep them on your account)."}</small>
      {msg && <div className="rphMsg" data-life="places-msg">{msg}</div>}
    </div>
  )
}

export function BagApp({ world, life }) {
  const [L, s] = useLife(world)
  const [msg, setMsg] = useState("")
  const [chips, setChips] = useState(() => L?.bank?.balance ?? 0)
  useEffect(() => {
    const id = setInterval(() => setChips(L?.bank?.balance ?? 0), 1000)
    return () => clearInterval(id)
  }, [L])
  if (!L) return <div className="rphPage">Your Bag isn't available here.</div>
  const bag = Object.entries(s.bag || {})
  const use = async (id) => {
    const it = itemOf(id)
    const u = it?.use || {}
    let r = { ok: false, error: "Nothing to do with that." }
    if (u.eat) r = await life.eat(id)
    else if (u.place) r = await life.put(id)
    else if (u.ride) r = await life.ride(id)
    else if (u.paddle || u.balls || u.wear) r = await life.equip(id)
    setMsg(r.ok ? r.text || "Done." : r.error)
  }
  const w = s.work || { secs: 0, shifts: 0 }
  return (
    <div className="rphPage" data-life="bag">
      <div className="rphBig">🛍️ {chips} chips</div>
      {(s.gifts || []).length > 0 && (
        <>
          <h4>Gifts for you</h4>
          <ul className="rphList">
            {s.gifts.map((g) => {
              const it = itemOf(g.item)
              return (
                <li key={g.id} data-life="gift-in">
                  <b>
                    {it?.icon} {it?.name}
                  </b>
                  <span>
                    From {g.fromName}
                    {g.note ? `: "${g.note}"` : ""}
                  </span>
                  <span className="rphRow">
                    <button type="button" className="rphPrimary" onClick={() => L.accept(g.id).then((r) => setMsg(r.ok ? "In your Bag ♥" : r.error))} data-life="gift-take">
                      Take it
                    </button>
                    <button type="button" onClick={() => L.decline(g.id).then((r) => setMsg(r.ok ? "Sent back." : r.error))}>
                      No thanks
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {bag.length ? (
        <ul className="rphList rlfBag">
          {bag.map(([id, n]) => {
            const it = itemOf(id)
            if (!it) return null
            const verb = useVerb(it)
            return (
              <li key={id} data-life={`bag-${id}`}>
                <b>
                  {it.icon} {it.name}
                </b>
                <span>×{n}</span>
                <span className="rphRow">
                  {verb && (
                    <button type="button" className="rphPrimary" onClick={() => use(id)} data-life={`use-${id}`}>
                      {verb}
                    </button>
                  )}
                  <button type="button" onClick={() => life.gift(id)} data-life={`give-${id}`}>
                    Give
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p>Your Bag is empty. Big Crate 98 (the warehouse club) and the mall sell all sorts.</p>
      )}
      {w.shifts > 0 && (
        <small className="rphNote">
          Time worked: {Math.floor(w.secs / 3600)} h {Math.floor((w.secs % 3600) / 60)} min ({w.shifts} shift{w.shifts === 1 ? "" : "s"})
        </small>
      )}
      {msg && <div className="rphMsg" data-life="bag-msg">{msg}</div>}
    </div>
  )
}
