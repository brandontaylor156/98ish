// My Park leisure: where you can swim, sit in a hot tub, order food and drinks, and buy a drink
// from a machine, at each real venue (pure; no three.js; Node-tested in leisure.test.js).
//
// The owner (2026-10-09): "Swimming wherever there are pools", "Hanging out at the hot tub",
// "Ordering food at the bar or drinks or at the clubhouse/restaurant", and the vending machine
// easter egg. The rule for real venues stays: nothing invented. A place is offered only where
// the venue really has it, and each one names its source (docs/venue-provenance.md "Leisure").
// What isn't sourced is an owner question there, not a guess here.
//
//   leisureSpots(layout) -> [{ id, kind: "swim" | "tub" | "order" | "vending", ... , src }]
//     swim:    { poly, cx, cz, along: { x, z }, len, wid, lanes, laps, entry }  (a pool)
//     tub:     { x, z, r, rim, water, seats: [{ id, x, z, yaw }] }               (a round hot tub)
//     order:   { x, z, y, r, at: { x, z, yaw }, menu: "bar" | "cafe" | "cafebar" | "snack" | "truck", name }
//     vending: { x, z, y, r, at: { x, z, yaw }, name, egg: true }
//   leisureAt(spots, x, z, y) -> { spot, d } the spot you're at (a pool's edge, a counter...) or null

import { furnishRoom } from "../propkit.js"

export const LEISURE_KINDS = ["swim", "tub", "order", "vending"]
export const LEISURE_LABEL = { swim: "Swim", tub: "Hot tub", order: "Order", vending: "Get a drink" }

// per venue: what's sourced, and where it comes from. pools: the spec's pool areas (matched by
// their middle); tub: a spec prop; order: a room's counter (furnished by propkit) or loose
// counters; vending: a machine or a drinks fridge (by room, or loose by type)
export const LEISURE_SOURCES = {
  loscab: {
    pools: [
      { at: [-125.7, 43.3], name: "The 50 m pool", src: "Reference pack layout (the 50 m pool, 9 lanes, south of the clubhouse's bell tower) + the z20 aerial; the club's tour video (bNNCw6NC6DM: pool, clubhouse)" },
      { at: [-26, 80], name: "The lap pool", src: "Reference pack site sketch: \"[lap pool]\" east of the racquetball building; its outline in the pack's layout from the aerial" },
    ],
    tub: { prop: "spa", name: "The hot tub", src: "Aerial: a round white tub at the 50 m pool's south-east corner; reference pack site sketch: \"(jacuzzi)\" beside the 50 m pool" },
    order: [{ room: "cafe", menu: "cafe", name: "Los Cab Cafe", src: "loscab.com, in the reference pack: \"Los Cab Cafe counter; drinks fridge\" (the cafe's place in the clubhouse is the pack's GUESS)" }],
    vending: [
      { room: "cafe", t: "vending", name: "The cafe's drinks fridge", src: "loscab.com, in the reference pack: the cafe's \"drinks fridge\"" },
      { loose: "vending", name: "The vending machines", src: "The owner (2026-10-09): Los Cab's two outdoor vending machines by the fitness building are real" },
    ],
  },
  newport: {
    // (the only pool and spa OpenStreetMap has in Newport's crop, ways 1414460953/4, are in the
    // back garden of a house on Granville Drive (OSM building 1081610426), not the club's: no
    // swimming there)
    order: [
      { room: "chLounge", menu: "bar", name: "The clubhouse bar", src: "Reference pack floorplan: the clubhouse lounge, \"bar counter with black ladder-back stools\", dining tables" },
      { loose: [-30.4, 41.3], menu: "bar", name: "The social lawn bar", src: "Reference pack notes: the social lawn (2025-26), \"wood-clad outdoor bar with shelves\"" },
    ],
    vending: [{ loose: "vending", name: "The vending machine", src: "The owner (2026-10-09): Newport's vending machine by the courts is real" }],
  },
  whittier: {
    order: [{ room: "wnSnack", menu: "snack", name: "The snack window", src: "Reference pack notes: \"snack window with string lights\"; the Friday social video (R7JzprkIfns: clubhouse, snack bar). Where it sits in the clubhouse is an owner question" }],
  },
  paseo: {
    pools: [{ at: [50, -125.5], name: "The pool", src: "OpenStreetMap way 1020677413 (leisure=swimming_pool, outdoor, lit); reference pack: \"junior-Olympic pool with cabanas\"" }],
    // (the owner, 2026-10-09: one of the two small pools beside the main pool is a hot tub; the
    // one at the main pool's north-east corner, about 5 m across)
    tub: { area: [58.5, -111.2], name: "The hot tub", src: "The owner (2026-10-09): one of the small pools beside the main pool is a hot tub; its outline is the aerial's small pool at the main pool's north-east corner" },
    order: [{ room: "pcCafe", menu: "cafebar", name: "The cafe and bar", src: "Reference pack floorplan (the club's Virtual Club Tour): \"Cafe and bar\" (which building it's in is the pack's GUESS)" }],
  },
  smash: {
    order: [{ room: "bar", menu: "bar", name: "The bar and restaurant", src: "Reference pack: the \"Social Club\" bar, \"red stools, long white bar, lit back bar\" (club tour 3JwJzKRyTQs)" }],
    vending: [{ room: "lobby", t: "vending", name: "The lobby's drinks fridge", src: "Reference pack: \"drinks fridge at desk\" in the lobby (club tour)" }],
  },
  wolfbear: {
    vending: [{ loose: "fridge", name: "The drinks fridges", src: "Reference pack: the streamed court's spectator strip, \"drinks fridges with green light\" (the championship stream)" }],
  },
}

const centroid = (p) => p.reduce((a, q) => ({ x: a.x + q[0] / p.length, z: a.z + q[1] / p.length }), { x: 0, z: 0 })
export const inPoly = (x, z, p) => {
  let c = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (p[i][1] > z !== p[j][1] > z && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c
  return c
}
// the distance from a point to a polygon's outline, and the nearest point on it
export const edgeOf = (x, z, p) => {
  let best = { d: Infinity, x: 0, z: 0, nx: 0, nz: 0 }
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const ax = p[j][0]
    const az = p[j][1]
    const dx = p[i][0] - ax
    const dz = p[i][1] - az
    const L2 = dx * dx + dz * dz || 1e-9
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2))
    const qx = ax + dx * t
    const qz = az + dz * t
    const d = Math.hypot(x - qx, z - qz)
    if (d < best.d) best = { d, x: qx, z: qz, ex: dx, ez: dz }
  }
  return best
}
const area = (p) => {
  let a = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1])
  return Math.abs(a / 2)
}
// a pool's long axis (from its longest edge) and its size along/across
const poolFrame = (p) => {
  let L = 0
  let ux = 1
  let uz = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const dx = p[i][0] - p[j][0]
    const dz = p[i][1] - p[j][1]
    const l = Math.hypot(dx, dz)
    if (l > L) {
      L = l
      ux = dx / l
      uz = dz / l
    }
  }
  const c = centroid(p)
  let a0 = Infinity
  let a1 = -Infinity
  let b0 = Infinity
  let b1 = -Infinity
  for (const [x, z] of p) {
    const a = (x - c.x) * ux + (z - c.z) * uz
    const b = -(x - c.x) * uz + (z - c.z) * ux
    a0 = Math.min(a0, a)
    a1 = Math.max(a1, a)
    b0 = Math.min(b0, b)
    b1 = Math.max(b1, b)
  }
  return { cx: c.x + ux * (a0 + a1) / 2 - uz * (b0 + b1) / 2, cz: c.z + uz * (a0 + a1) / 2 + ux * (b0 + b1) / 2, along: { x: ux, z: uz }, len: a1 - a0, wid: b1 - b0 }
}

const free = (L, x, z, r = 0.3) => !L || typeof L.blocked !== "function" || !L.blocked(x, z, r)
const yawFrom = (dx, dz) => Math.atan2(dx, dz)

export const leisureSpots = (layout) => {
  const S = layout?.spec?.scene || layout?.scene || null
  if (!S) return []
  const venue = layout.id || layout.spec?.id || S.id || ""
  const src = LEISURE_SOURCES[venue]
  if (!src) return []
  const L = layout.blocked ? layout : null
  const out = []
  // ---- pools: the sourced ones among the spec's pool areas (the same pool is sometimes drawn
  // twice, OSM's outline and the aerial's: the one nearest the source's middle wins) ----
  const areas = (S.areas || []).filter((a) => a.k === "pool" && a.p?.length >= 3)
  ;(src.pools || []).forEach((def, i) => {
    let best = null
    for (const a of areas) {
      const c = centroid(a.p)
      const d = Math.hypot(c.x - def.at[0], c.z - def.at[1])
      if (d < 6 && (!best || d < best.d || (Math.abs(d - best.d) < 1 && a.lanes && !best.a.lanes))) best = { a, d }
    }
    if (!best) return
    const poly = best.a.p
    const f = poolFrame(poly)
    // (where you get in: the deck beside the pool nearest its middle along each side, the first
    // open ground out from the edge; you can walk up anywhere along it)
    out.push({
      id: `swim${i + 1}`,
      kind: "swim",
      name: def.name,
      label: "Swim",
      detail: `${def.name} · swim, laps, a cannonball`,
      poly,
      ...f,
      area: area(poly),
      lanes: best.a.lanes || 0,
      // (laps where the pool is a real lap pool: lanes, or 20 m and more)
      laps: !!best.a.lanes || f.len >= 20,
      y: 0,
      r: 2.2,
      src: def.src,
    })
  })
  // ---- the hot tub: a spec prop (round) ----
  if (src.tub) {
    // (a round tub prop, or a small pool area the owner named as the hot tub)
    let p = src.tub.prop ? (S.props || []).find((q) => q.t === src.tub.prop) : null
    if (!p && src.tub.area) {
      const a = areas.find((q) => {
        const c = centroid(q.p)
        return Math.hypot(c.x - src.tub.area[0], c.z - src.tub.area[1]) < 4
      })
      if (a) {
        const f = poolFrame(a.p)
        p = { x: f.cx, z: f.cz, s: Math.max(0.8, Math.min(1.6, Math.min(f.len, f.wid) / 2 / 1.6)) }
      }
    }
    if (p) {
      const R = 1.6 * (p.s || 1)
      const seats = []
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3
        const x = p.x + Math.sin(a) * (R - 0.62)
        const z = p.z + Math.cos(a) * (R - 0.62)
        seats.push({ id: `tub${k}`, x, z, yaw: yawFrom(p.x - x, p.z - z) })
      }
      // (where you step in: the open deck round the rim)
      let at = null
      for (let k = 0; k < 16 && !at; k++) {
        const a = (k / 16) * Math.PI * 2
        const x = p.x + Math.sin(a) * (R + 0.7)
        const z = p.z + Math.cos(a) * (R + 0.7)
        if (free(L, x, z, 0.3)) at = { x, z, yaw: yawFrom(p.x - x, p.z - z) }
      }
      if (at) out.push({ id: "tub1", kind: "tub", name: src.tub.name, label: "Hot tub", detail: `${src.tub.name} · sit and soak`, x: p.x, z: p.z, y: 0, r: R + 1.6, R, rim: 0.5 * (p.s || 1), water: 0.51 * (p.s || 1), seats, at, src: src.tub.src })
    }
  }
  // ---- food and drinks: a room's counter (propkit's own furniture, so the spot is where the
  // counter is drawn), or a loose counter by its middle ----
  const rooms = S.rooms || []
  const counterSpot = (c, y = 0) => {
    const fx = Math.sin(c.a || 0)
    const fz = Math.cos(c.a || 0)
    for (const d of [1.1, 1.5, 0.85, 1.9]) {
      const x = c.x + fx * d
      const z = c.z + fz * d
      if (free(L, x, z, 0.25)) return { x, z, yaw: yawFrom(-fx, -fz), y }
    }
    return null
  }
  ;(src.order || []).forEach((def, i) => {
    let counters = []
    let y = 0
    if (def.room) {
      const room = rooms.find((r) => r.id === def.room)
      if (!room) return
      y = room.y || 0
      counters = furnishRoom(room).filter((q) => q.t === "counter")
    } else if (def.loose) counters = (S.props || []).filter((q) => q.t === "counter" && !q.y && Math.hypot(q.x - def.loose[0], q.z - def.loose[1]) < 4)
    // (the counter nearest the room's middle of the ones you can walk up to)
    const ats = counters.map((c) => counterSpot(c, y)).filter(Boolean)
    if (!ats.length) return
    const mid = ats.reduce((a, q) => ({ x: a.x + q.x / ats.length, z: a.z + q.z / ats.length }), { x: 0, z: 0 })
    const at = ats.sort((a, b) => Math.hypot(a.x - mid.x, a.z - mid.z) - Math.hypot(b.x - mid.x, b.z - mid.z))[0]
    out.push({ id: `order${i + 1}`, kind: "order", name: def.name, label: "Order", detail: `${def.name} · food and drinks`, menu: def.menu, x: at.x, z: at.z, y, r: 1.8, at, room: def.room || null, src: def.src })
  })
  // ---- drinks machines and fridges ----
  ;(src.vending || []).forEach((def, i) => {
    let list = []
    let y = 0
    if (def.room) {
      const room = rooms.find((r) => r.id === def.room)
      if (!room) return
      y = room.y || 0
      list = furnishRoom(room).filter((q) => q.t === def.t)
    } else list = (S.props || []).filter((q) => q.t === def.loose)
    if (!list.length) return
    // (a pair of fridges side by side is one place to buy)
    const m = list.reduce((a, q) => ({ x: a.x + q.x / list.length, z: a.z + q.z / list.length, a: q.a || 0 }), { x: 0, z: 0, a: 0 })
    const at = counterSpot({ x: m.x, z: m.z, a: m.a }, y)
    if (!at) return
    out.push({ id: `vending${i + 1}`, kind: "vending", name: def.name, label: "Get a drink", detail: `${def.name} · a cold one`, x: at.x, z: at.z, y, r: 1.6, at, machine: { x: m.x, z: m.z, a: m.a }, egg: true, src: def.src })
  })
  return out
}

// where you are: within a pool or 1.6 m of its edge (and on the ground); by a tub, a counter, a
// machine within its reach. -> { spot, d } (the nearest; a pool's d is to its edge) or null
export const leisureAt = (spots, x, z, y = 0) => {
  let best = null
  for (const s of spots || []) {
    if (Math.abs((s.y || 0) - (y || 0)) > 1.2) continue
    let d
    if (s.kind === "swim") {
      const e = edgeOf(x, z, s.poly)
      d = inPoly(x, z, s.poly) ? 0 : e.d
      if (d > 1.6) continue
    } else {
      d = Math.hypot(s.x - x, s.z - z)
      if (d > s.r) continue
    }
    if (!best || d < best.d) best = { spot: s, d }
  }
  return best
}

// where to stand on the deck to get in nearest you (or where you are, if you're in it), and
// which way the water is: -> { x, z, yaw, inX, inZ } (in: 1.2 m into the water from the edge)
export const poolEntry = (spot, x, z) => {
  const e = edgeOf(x, z, spot.poly)
  // (the edge's normal pointing into the pool)
  let nx = -e.ez
  let nz = e.ex
  const n = Math.hypot(nx, nz) || 1
  nx /= n
  nz /= n
  if (!inPoly(e.x + nx * 0.5, e.z + nz * 0.5, spot.poly)) {
    nx = -nx
    nz = -nz
  }
  return { x: e.x - nx * 0.45, z: e.z - nz * 0.45, yaw: Math.atan2(nx, nz), inX: e.x + nx * 1.4, inZ: e.z + nz * 1.4, edgeX: e.x, edgeZ: e.z }
}

// what each venue has (Help, the docs, tests)
export const leisureSummary = (spots) => Object.fromEntries(LEISURE_KINDS.map((k) => [k, spots.filter((s) => s.kind === k).map((s) => s.name)]))
