// My Park activities: where each one can be done at a venue (pure; no three.js).
//
// The owner (2026-10-09): "Add like, other fun activities to do at each venue, like tennis at
// wherever tennis courts are, basketball at the indoor basketball at Los Cab ... work out ...
// watch tv at the lobby/gym". The rule for real venues stays: nothing invented. An activity
// is offered only where the venue really has its place, and every place has a source:
//   tennis   the venue's tennis courts (OpenStreetMap pitches, already in the spec)
//   hoops    basketball courts (OpenStreetMap pitches), or a basketball room listed below
//   workout  a gym room listed below (OSM fitness centre, the reference pack's tour)
//   tv       a TV in a room (or under a roof) listed below (the reference pack says it's there)
// Rooms' positions inside a building are the packs' guesses (docs/venue-provenance.md); the
// owner questions for everything else are in docs/venue-activities.md.
//
//   activitySpots(layout) -> [{ id, kind, x, z, y, r, label, detail, src, ... }]
//   nearestSpot(spots, x, z, y) -> { spot, k } (k: how far into its reach, 0 = right on it) or null

import { roomCourt } from "../propkit.js"

export const KINDS = ["tennis", "hoops", "workout", "tv"]
export const LABEL = { tennis: "Play tennis", hoops: "Shoot hoops", workout: "Work out", tv: "Watch TV" }

// per venue: the rooms and loose TVs that are sourced (by room id), and the source lines
// (tennis and outdoor basketball come from the spec's courts: OSM pitches)
export const ACT_SOURCES = {
  loscab: {
    tennis: "OpenStreetMap: 13 tennis pitches (4 with pickleball lines)",
    hoops: { rooms: ["bigGym"], src: "The owner (2026-10-09: \"the indoor basketball at Los Cab\"); reference pack floorplan: \"Indoor basketball / badminton gym\" (club tour video #12-13, #60). The building is the pack's guess; the court in it is drawn regulation size in its middle" },
    workout: { rooms: ["fitness"], src: "Reference pack floorplan: \"Fitness centre (cardio + weights)\" (club tour video #2, #5, #18-24)" },
    tv: { rooms: { lobby: "Reference pack floorplan, lobby: \"... beige walls, TV\" (tour #72-73)", fitness: "Reference pack floorplan, fitness centre: \"treadmill rows facing TVs\"" } },
  },
  newport: { tennis: "OpenStreetMap: 12 tennis pitches" },
  whittier: {
    tennis: "OpenStreetMap: 12 tennis pitches (the other 4 slabs tagged tennis are the pickleball courts)",
    tv: { loose: "Reference pack: \"steel shade roof along the PB pens, couches and chairs, string lights, TV\"", looseName: "Under the shade roof" },
  },
  paseo: {
    tennis: "OpenStreetMap: 11 lit tennis pitches",
    workout: { rooms: ["pcFit", "pcPerf"], src: "OpenStreetMap: The Paseo Club, leisure=fitness_centre, sport=...fitness...; reference pack: \"Main fitness floor\" and the performance centre" },
    tv: { rooms: { pcLobby: "Reference pack, lobby: \"... brochure racks, TV\"", pcCafe: "Reference pack, cafe and bar: \"bar counter, TVs\"", pcFit: "Reference pack, fitness floor: \"treadmills/ellipticals facing windows, dark floor, TVs\"" } },
  },
  smash: {
    tv: { rooms: { lobby: "Reference pack, lobby: \"white counter ... big video wall\"", bar: "Reference pack, bar: \"many TVs\"" }, loose: "Reference pack: \"large TVs on columns along the spine\"", looseName: "By the courts" },
  },
  sinaloa: { hoops: { src: "OpenStreetMap: 8 basketball pitches" } },
  bouquet: { hoops: { src: "OpenStreetMap: a basketball pitch" } },
}

// a frame: local x across, z along (layout.js toWorld)
const toWorld = (f, x, z) => {
  const s = Math.sin(f.rot)
  const c = Math.cos(f.rot)
  return { x: f.x + x * c + z * s, z: f.z - x * s + z * c }
}
const inPoly = (x, z, p) => {
  let c = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (p[i][1] > z !== p[j][1] > z && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c
  return c
}

// the tennis court's measures (m): length, singles and doubles width, service line, net
export const TENNIS = { L: 23.77, S: 8.23, D: 10.97, SERVICE: 6.4, NET: 0.914, POST_NET: 1.07 }
// the basketball court as courtkit.js draws it (m): rim centre from the middle, rim height, board
export const HOOPS = { L: 28, W: 15, RIM_Z: 12.4, RIM_Y: 3.05, RIM_R: 0.23, BOARD_Z: 12.8, BOARD_Y: 3.3, BOARD_W: 1.8, BOARD_H: 1.05 }

const free = (L, x, z) => !L || typeof L.blocked !== "function" || !L.blocked(x, z, 0.35)
// (courts that aren't live are fenced banks you walk round, solid to the walkers: the spot is
// the first open ground out from a court's middle along each of its axes, the nearest wins)
const walkUp = (L, frame, ax, az, from, to) => {
  let best = null
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const start = dz ? az + from : ax + from
    const end = dz ? az + to : ax + to
    for (let d = start; d <= end; d += 0.5) {
      const p = toWorld(frame, dx * (dz ? 0 : d), dz * (dz ? d : 0))
      if (!free(L, p.x, p.z)) continue
      const k = d - (dz ? az : ax)
      if (!best || k < best.k) best = { ...p, k, side: dz || 0 }
      break
    }
  }
  return best
}

export const activitySpots = (layout) => {
  const S = layout?.spec?.scene || layout?.scene || null
  if (!S) return []
  const venue = layout.id || layout.spec?.id || S.id || ""
  const src = ACT_SOURCES[venue] || {}
  const L = layout.blocked ? layout : null
  const out = []
  const courts = S.courts || []
  // ---- tennis: every tennis court in the spec (OSM) ----
  let tn = 0
  for (const c of courts) {
    if (c.s !== "t") continue
    tn++
    const frame = { x: c.x, z: c.z, rot: c.rot || 0 }
    // where you walk up: the open ground nearest its lines (outside its pen's fence)
    const at = walkUp(L, frame, TENNIS.D / 2, TENNIS.L / 2, 1, 14)
    if (!at) continue
    out.push({ id: `tennis${tn}`, kind: "tennis", x: at.x, z: at.z, y: 0, r: 3.2, label: LABEL.tennis, detail: `Tennis court ${tn} · vs the computer or a friend`, name: `Tennis court ${tn}`, frame, side: at.side, lit: !!c.lit, src: src.tennis || "OpenStreetMap: a tennis pitch" })
  }
  // ---- basketball: OSM courts, and sourced basketball rooms (a court drawn in the middle) ----
  let bn = 0
  for (const c of courts) {
    if (c.s !== "b") continue
    bn++
    const frame = { x: c.x, z: c.z, rot: c.rot || 0 }
    // (the court's middle if it's open ground, else the open ground nearest its lines)
    const mid = toWorld(frame, 0, 0)
    const at = free(L, mid.x, mid.z) ? mid : walkUp(L, frame, HOOPS.W / 2, HOOPS.L / 2, -1, 12)
    if (!at) continue
    out.push({ id: `hoops${bn}`, kind: "hoops", x: at.x, z: at.z, y: 0, r: at === mid ? 7 : 3.5, label: LABEL.hoops, detail: `Basketball court${courts.filter((k) => k.s === "b").length > 1 ? ` ${bn}` : ""} · around the world, H-O-R-S-E`, name: `Basketball court${courts.filter((k) => k.s === "b").length > 1 ? ` ${bn}` : ""}`, frame, indoor: false, src: src.hoops?.src || "OpenStreetMap: a basketball pitch" })
  }
  const rooms = S.rooms || []
  for (const id of src.hoops?.rooms || []) {
    const room = rooms.find((r) => r.id === id)
    const f = room && roomCourt(room)
    if (!f) continue
    bn++
    out.push({ id: `hoops${bn}`, kind: "hoops", x: f.x, z: f.z, y: room.y || 0, r: 9, label: LABEL.hoops, detail: `${room.name || "Indoor gym"} · around the world, H-O-R-S-E`, name: room.name || "Indoor gym", frame: { x: f.x, z: f.z, rot: f.rot }, indoor: true, room: id, roofY: (room.y || 0) + (room.h || 9) - 0.4, src: src.hoops.src })
  }
  // ---- workout: sourced gym rooms ----
  for (const id of src.workout?.rooms || []) {
    const room = rooms.find((r) => r.id === id)
    if (!room?.p) continue
    const props = room.props || []
    const gear = props.filter((p) => ["treadmill", "bike", "elliptical", "powerrack", "weightbench", "dumbbells", "mat"].includes(p.t))
    // (stand on open floor near the middle: the mats first, then the room's middle and round it)
    const mid = room.p.reduce((a, q) => ({ x: a.x + q[0] / room.p.length, z: a.z + q[1] / room.p.length }), { x: 0, z: 0 })
    const mats = gear.filter((p) => p.t === "mat").map((p) => ({ x: p.x, z: p.z }))
    const ring = [mid, ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ x: mid.x + Math.cos(k * 0.785) * 2.5, z: mid.z + Math.sin(k * 0.785) * 2.5 }))]
    const at = [...mats, ...ring].find((p) => inPoly(p.x, p.z, room.p) && free(L, p.x, p.z))
    if (!at) continue
    const tread = gear.filter((p) => p.t === "treadmill").sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0] || null
    out.push({ id: `workout-${id}`, kind: "workout", x: at.x, z: at.z, y: room.y || 0, r: Math.max(3, Math.min(6, Math.sqrt(Math.abs(polyArea(room.p))) / 3)), label: LABEL.workout, detail: `${room.name || "Gym"} · a workout game, alone or together`, name: room.name || "Gym", room: id, treadmill: tread ? { x: tread.x, z: tread.z, a: tread.a || 0 } : null, roomPoly: room.p, roofY: (room.y || 0) + (room.h || 4) - 0.3, src: src.workout.src })
  }
  // ---- TVs: in sourced rooms, and loose ones where the venue's TVs are sourced ----
  const tvSrc = src.tv || {}
  const tvRooms = tvSrc.rooms || {}
  const tvs = []
  for (const room of rooms) {
    if (!tvRooms[room.id]) continue
    // (one place to watch per room: the set nearest the room's middle; a gym's row of TVs is
    // one "Watch TV", not fifteen)
    const mid = room.p.reduce((a, q) => ({ x: a.x + q[0] / room.p.length, z: a.z + q[1] / room.p.length }), { x: 0, z: 0 })
    const sets = (room.props || []).filter((p) => p.t === "tv").sort((a, b) => Math.hypot(a.x - mid.x, a.z - mid.z) - Math.hypot(b.x - mid.x, b.z - mid.z))
    for (const p of sets) tvs.push({ p, room, src: tvRooms[room.id], alt: p !== sets[0] })
  }
  if (tvSrc.loose) for (const p of S.props || []) if (p.t === "tv") tvs.push({ p, room: null, src: tvSrc.loose, name: tvSrc.looseName })
  const seen = []
  const roomsDone = new Set()
  let tvn = 0
  for (const { p, room, src: s, name: tvName } of tvs) {
    if (room && roomsDone.has(room.id)) continue
    // (two TVs on one spot: drawn twice by a preset; one place to watch)
    if (seen.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1.2 && Math.abs((q.y || 0) - (p.y || 0)) < 0.5)) continue
    seen.push(p)
    const a = p.a || 0
    const fx = Math.sin(a)
    const fz = Math.cos(a)
    const sy = (p.s || 1) * (p.h ? p.h / 0.88 : 1)
    const sx = (p.s || 1) * (p.w ? p.w / 1.5 : 1)
    // (where you'd stand to watch: out in front of it, inside its room)
    const floorY = room?.y || 0
    let at = null
    for (const d of [2.6, 2.0, 3.2, 1.6, 4.0, 1.2, 1.0]) {
      const q = { x: p.x + fx * d, z: p.z + fz * d }
      if (room && !inPoly(q.x, q.z, room.p)) continue
      if (free(L, q.x, q.z)) {
        at = q
        break
      }
    }
    if (!at) continue
    tvn++
    if (room) roomsDone.add(room.id)
    out.push({
      id: `tv${tvn}`,
      kind: "tv",
      x: at.x,
      z: at.z,
      y: floorY,
      r: 2.4,
      label: LABEL.tv,
      detail: `${room?.name || tvName || "The TV"} · live courts, your videos, YouTube together`,
      name: room?.name || tvName || "TV",
      room: room?.id || null,
      // (props.js: the set hangs 1.6-2.46 m up its own height, scaled, lifted by its y)
      tv: { x: p.x, y: (p.y || 0) + 2.03 * sy, z: p.z, a, w: 1.4 * sx, h: 0.76 * sy },
      src: s,
    })
  }
  return out
}

const polyArea = (p) => {
  let a = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1])
  return a / 2
}

// the spot to offer where you stand: the nearest one in reach on your floor
export const nearestSpot = (spots, x, z, y = 0) => {
  let best = null
  for (const s of spots || []) {
    if (Math.abs((s.y || 0) - (y || 0)) > 1.2) continue
    const d = Math.hypot(s.x - x, s.z - z)
    if (d > s.r) continue
    const k = d / s.r
    if (!best || k < best.k) best = { spot: s, k }
  }
  return best
}

// what each venue has, one line each (Help, the docs, tests)
export const spotSummary = (spots) => {
  const n = (k) => spots.filter((s) => s.kind === k).length
  return { tennis: n("tennis"), hoops: n("hoops"), workout: n("workout"), tv: n("tv") }
}
