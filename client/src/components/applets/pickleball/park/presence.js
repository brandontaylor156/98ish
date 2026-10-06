// Live Venue Presence: a friend who shares their location with you (Buddy Locator) and is
// physically at one of Pickleball 98's real venues shows up there in My Park, "here for real".
// Pure rules, shared by the app and the server (server/locate loads this very file).
//
// Privacy: the server decides it (it already has the sharer's latest position) and sends only
// { id, area } to the people who may see them: never a spot finer than a court. Approximate
// location (about 1 km) is never placed: it can only say "nearby". Nothing is stored: the
// server keeps the answer in memory next to the position it came from (for the hysteresis).
//
//   venueRecord(spec, bounds)          a venue as the rules need it: { id, short, origin, bounds, courts }
//   toLocal(origin, lat, lon)          a position in a venue's metres (x east, z south)
//   presenceStep(venues, prev, pos)    -> { id, area } | { id, nearby: true } | null
//   areaOf(venue, x, z)                -> "c<i>" (the nearest court, within AREA_R) | "site"
//   spotFor(courts, area, slot)        -> { x, z } beside that court (or null: the entrance)
//   friendsAt(friends, venueId)        -> { here: [friend], nearby: [friend] }

export const M = 111320 // metres in a degree of latitude (the venue builder's projection)
export const LEAVE_MARGIN = 40 // metres past the venue's edge before someone counts as gone
export const MAX_ACC = 150 // fixes vaguer than this never move anyone in or out
export const NEARBY_M = 1500 // approximate location this close to a venue: "nearby"
export const AREA_R = 30 // the nearest court within this many metres is "their" court

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

export const toLocal = (origin, lat, lon) => {
  const [lat0, lon0] = origin
  const k = Math.cos((lat0 * Math.PI) / 180)
  return { x: (lon - lon0) * M * k, z: -(lat - lat0) * M }
}

export const venueRecord = (spec, bounds) => ({
  id: spec.id,
  short: spec.short || spec.name || spec.id,
  origin: spec.origin,
  bounds: bounds || null,
  courts: (spec.courts || []).filter((c) => num(c.x) !== null && num(c.z) !== null).map((c) => ({ x: c.x, z: c.z, a: c.a || 0, s: c.s || "p" })),
})

const inBounds = (b, p, margin) => !!b && p.x >= b.x0 - margin && p.x <= b.x1 + margin && p.z >= b.z0 - margin && p.z <= b.z1 + margin

export const areaOf = (venue, x, z) => {
  let best = -1
  let bestD = AREA_R
  venue.courts.forEach((c, i) => {
    const d = Math.hypot(c.x - x, c.z - z)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best >= 0 ? `c${best}` : "site"
}

export const presenceStep = (venues, prev, pos) => {
  if (!pos || num(pos.lat) === null || num(pos.lon) === null) return null
  const list = (venues || []).filter((v) => Array.isArray(v.origin) && v.bounds)
  // approximate location: never placed, at most "nearby" (to the nearest venue's middle)
  if (pos.coarse) {
    let best = null
    let bestD = NEARBY_M
    for (const v of list) {
      const p = toLocal(v.origin, pos.lat, pos.lon)
      const d = Math.hypot(p.x, p.z)
      if (d < bestD) {
        bestD = d
        best = v
      }
    }
    return best ? { id: best.id, nearby: true } : null
  }
  // a vague fix decides nothing: stay as you were
  if (num(pos.acc) !== null && pos.acc > MAX_ACC) return prev && !prev.nearby ? prev : null
  // already there: you stay until you're well past the edge (no flicker at the gate)
  if (prev && !prev.nearby) {
    const v = list.find((x) => x.id === prev.id)
    if (v) {
      const p = toLocal(v.origin, pos.lat, pos.lon)
      if (inBounds(v.bounds, p, LEAVE_MARGIN)) return { id: v.id, area: areaOf(v, p.x, p.z) }
    }
  }
  for (const v of list) {
    const p = toLocal(v.origin, pos.lat, pos.lon)
    if (inBounds(v.bounds, p, 0)) return { id: v.id, area: areaOf(v, p.x, p.z) }
  }
  return null
}

export const samePresence = (a, b) => (!a && !b) || (!!a && !!b && a.id === b.id && (a.area || null) === (b.area || null) && !!a.nearby === !!b.nearby)

// where to stand them in My Park: beside "their" court, on the long side, a step apart from
// the next friend there (slot); "site" (somewhere else at the venue): null = the entrance
export const spotFor = (courts, area, slot = 0) => {
  const m = /^c(\d+)$/.exec(area || "")
  const c = m ? courts?.[Number(m[1])] : null
  if (!c) return null
  const a = ((c.a || 0) * Math.PI) / 180
  // the court's length runs along angle a; its side is across it
  const half = c.s === "t" ? 9.5 : 5.2
  const along = (slot % 4) * 1.4 - 2.1
  const side = slot >= 4 ? -1 : 1
  return { x: c.x + Math.cos(a) * along - Math.sin(a) * half * side, z: c.z + Math.sin(a) * along + Math.cos(a) * half * side }
}

export const friendsAt = (friends, venueId) => {
  const here = []
  const nearby = []
  for (const f of friends || []) {
    const v = f.venue
    if (!v || v.id !== venueId || f.paused || !f.pos) continue
    ;(v.nearby ? nearby : here).push(f)
  }
  return { here, nearby }
}

// "2 friends here now" / "1 friend nearby" (or "")
export const badgeText = ({ here = [], nearby = [] } = {}) => {
  if (here.length) return `${here.length} friend${here.length === 1 ? "" : "s"} here now`
  if (nearby.length) return `${nearby.length} friend${nearby.length === 1 ? "" : "s"} nearby`
  return ""
}
