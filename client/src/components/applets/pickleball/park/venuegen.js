// My Park: a real venue's spec (tools/venues/build-venues.mjs: OpenStreetMap + our corrections)
// -> a layout spec for layout.js makeLayout, plus the scenery build.js draws. Pure (no
// three.js); Node-tested.
//
// What it works out:
// - banks: courts side by side or back to back (same direction, small gaps) share one fenced
//   enclosure; that box is what you walk round (collision), drawn as chain-link with gates;
// - the courts with live games (up to spec.live, 6 by default; the nearest the entrance),
//   each with a gate on an open side of its bank (a sideline at the end of a row, else a
//   baseline), a paddle rack beside it and bleachers where there's room; every pickleball
//   court gets a number ("Court 7"), in reading order;
// - a ball-machine court (the next court along), the pro shop by the entrance, benches,
//   light poles (lit venues), trees, buildings (their walls are solid), an indoor hall with
//   walls, a door and a bar, a walking graph and spots for the regulars to wander to.

import { HALF_L, HALF_W } from "../physics.js"
import { makeLayout } from "./layout.js"
import { ROOM_LOOK, furnishRoom, propSolid } from "./propkit.js"
import { cleanZone, keepTree } from "./clean.js"

const DEG = Math.PI / 180
const SIZES = { p: { L: 2 * HALF_L, W: 2 * HALF_W }, t: { L: 23.77, W: 10.97 }, b: { L: 28, W: 15 } }
// runoff (behind the baselines) and side room at a bank's edge, by sport
const ROOM = { p: { u: 3.0, w: 1.8 }, t: { u: 6.0, w: 3.5 }, b: { u: 2.0, w: 2.0 } }
// two courts are in the same bank when the gaps between them are under these (m)
const JOIN = { p: { u: 7.0, w: 3.8 }, t: { u: 13.5, w: 8.5 }, b: { u: 6, w: 6 } }
const LEVELS = ["beginner", "intermediate", "intermediate", "pro", "intermediate", "legend", "beginner", "pro"]

const dot = (a, b) => a.x * b.x + a.z * b.z
const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z })
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, z: a.z + b.z * k })
const len = (a) => Math.hypot(a.x, a.z)
const round = (v) => Math.round(v * 100) / 100

// the oriented box round some points, in axes u / w
const boxAround = (pts, u) => {
  const w = { x: -u.z, z: u.x }
  let u0 = Infinity
  let u1 = -Infinity
  let w0 = Infinity
  let w1 = -Infinity
  for (const p of pts) {
    const a = dot(p, u)
    const b = dot(p, w)
    u0 = Math.min(u0, a)
    u1 = Math.max(u1, a)
    w0 = Math.min(w0, b)
    w1 = Math.max(w1, b)
  }
  const cu = (u0 + u1) / 2
  const cw = (w0 + w1) / 2
  return { cx: cu * u.x + cw * w.x, cz: cu * u.z + cw * w.z, hx: (u1 - u0) / 2, hz: (w1 - w0) / 2, ux: u.x, uz: u.z }
}
const inBox = (b, p, pad = 0) => {
  const dx = p.x - b.cx
  const dz = p.z - b.cz
  const lx = dx * b.ux + dz * b.uz
  const lz = -dx * b.uz + dz * b.ux
  return Math.abs(lx) < b.hx + pad && Math.abs(lz) < b.hz + pad
}
const corners = (b) => {
  const u = { x: b.ux, z: b.uz }
  const w = { x: -b.uz, z: b.ux }
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, c]) => ({ x: b.cx + u.x * a * b.hx + w.x * c * b.hz, z: b.cz + u.z * a * b.hx + w.z * c * b.hz }))
}
const boxesOverlap = (a, b) => {
  // separating axes (both boxes' axes)
  for (const ax of [
    { x: a.ux, z: a.uz },
    { x: -a.uz, z: a.ux },
    { x: b.ux, z: b.uz },
    { x: -b.uz, z: b.ux },
  ]) {
    const pa = corners(a).map((p) => dot(p, ax))
    const pb = corners(b).map((p) => dot(p, ax))
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false
  }
  return true
}
const pointInPoly = (p, poly) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > p.z !== zj > p.z && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
const centroid = (poly) => ({ x: poly.reduce((s, p) => s + p[0], 0) / poly.length, z: poly.reduce((s, p) => s + p[1], 0) / poly.length })
// nearest point on a polygon's edges to p -> { x, z, i (edge), t }
const nearestOnPoly = (poly, p) => {
  let best = null
  for (let i = 0; i < poly.length; i++) {
    const a = { x: poly[i][0], z: poly[i][1] }
    const b = { x: poly[(i + 1) % poly.length][0], z: poly[(i + 1) % poly.length][1] }
    const ab = sub(b, a)
    const L2 = dot(ab, ab) || 1
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2))
    const q = add(a, ab, t)
    const d = len(sub(p, q))
    if (!best || d < best.d) best = { ...q, d, i, t }
  }
  return best
}
// the stretch of the edge a -> b (length L, unit u) within w/2 of a door at (dx, dz): [s, e] or null
const doorCut = (a, u, L, door) => {
  if (!door) return null
  const fx = a.x - door.x
  const fz = a.z - door.z
  const b = fx * u.x + fz * u.z
  const c = fx * fx + fz * fz - (door.w / 2) ** 2
  const disc = b * b - c
  if (disc <= 0) return null
  const s = Math.max(0, -b - Math.sqrt(disc))
  const e = Math.min(L, -b + Math.sqrt(disc))
  return e > s ? [s, e] : null
}
const seeded = (seed) => {
  let s = seed >>> 0 || 1
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

// (the build works out which courts can't be reached and saves them as spec.genExclude: the
// browser passes those and skips the check)
export const venueLayoutSpec = (spec) => generateVenue(spec, spec.genExclude ? { exclude: spec.genExclude, noCheck: true } : {}).layoutSpec

export const generateVenue = (spec, opts = {}) => {
  const maxLive = opts.maxLive ?? spec.live ?? 6
  const rand = seeded(spec.id.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))
  const indoor = !!spec.indoor
  const colors = { court: "#2f62ad", kitchen: "#3b75c4", surround: "#3c8a5a", lines: "#f4f7fb", ground: "#7a9a5a", tennis: "#2f62ad", tennisSurround: "#3c8a5a", ...(spec.colors || {}) }

  // ---------- courts ----------
  const courts = spec.courts.map((c, i) => {
    const a = c.a * DEG
    const u = { x: Math.cos(a), z: Math.sin(a) }
    const sz = SIZES[c.s] || SIZES.p
    return { i, x: c.x, z: c.z, a, u, w: { x: -u.z, z: u.x }, s: c.s, pb: c.pb || 0, pl: c.pl || null, col: c.col ?? null, lit: !!c.lit, L: sz.L, W: sz.W, rot: Math.atan2(u.x, u.z), n: c.n || null }
  })

  // ---------- banks ----------
  const parent = courts.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const join = { ...JOIN, ...(spec.fence?.join || {}) }
  for (let i = 0; i < courts.length; i++)
    for (let j = i + 1; j < courts.length; j++) {
      const a = courts[i]
      const b = courts[j]
      if (a.s !== b.s && !(spec.fence?.mixed ?? false)) continue
      // (indoors every court is its own: people walk the aisles between them)
      if (indoor || spec.fence?.perCourt) continue
      const da = Math.abs(Math.sin(a.a - b.a))
      if (da > Math.sin(8 * DEG)) continue
      const d = sub(b, a)
      const gu = Math.abs(dot(d, a.u)) - (a.L + b.L) / 2
      const gw = Math.abs(dot(d, a.w)) - (a.W + b.W) / 2
      const J = join[a.s] || JOIN.p
      // (overlapping one way and close the other)
      if ((gu < J.u && gw < -0.5) || (gw < J.w && gu < -0.5) || (gu < J.u && gw < J.w && gu < 0.5)) parent[find(i)] = find(j)
    }
  const groups = new Map()
  courts.forEach((c, i) => {
    const r = find(i)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(c)
  })
  const banks = [...groups.values()].map((list, bi) => {
    const c0 = list[0]
    const room = { ...(indoor ? { u: 0.3, w: 0.25 } : ROOM[c0.s] || ROOM.p), ...(spec.fence?.room?.[c0.s] || {}) }
    const pts = []
    for (const c of list) {
      // (a court turned half round has the same box)
      const su = dot(c.u, c0.u) >= 0 ? 1 : -1
      const u = { x: c0.u.x, z: c0.u.z }
      const w = c0.w
      for (const [a, b] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ])
        pts.push({ x: c.x + u.x * a * (c.L / 2 + room.u) + w.x * b * (c.W / 2 + room.w), z: c.z + u.z * a * (c.L / 2 + room.u) + w.z * b * (c.W / 2 + room.w) })
      c.bank = bi
      c.flip = su
    }
    const box = boxAround(pts, c0.u)
    return { i: bi, s: c0.s, courts: list, box, room, gates: [] }
  })

  // pens that (nearly) touch share their fence: one bank (outdoors; indoor courts stand apart)
  if (!indoor && !spec.fence?.perCourt) {
    const near = (A, B) => {
      if (A.s !== B.s || Math.abs(A.box.ux * B.box.uz - A.box.uz * B.box.ux) > Math.sin(8 * DEG)) return false
      const grow = (b) => ({ ...b, hx: b.hx + 1.25, hz: b.hz + 1.25 })
      if (!boxesOverlap(grow(A.box), grow(B.box))) return false
      // (only when together they still make a rectangle: side by side with the same ends, or
      // end to end with the same sides; an L of courts keeps two fences, or its box would
      // swallow the walk, the lawn, the building in its corner)
      const u = { x: A.box.ux, z: A.box.uz }
      const w = { x: -u.z, z: u.x }
      const ext = (b, ax) => {
        const ps = corners(b).map((p) => dot(p, ax))
        return [Math.min(...ps), Math.max(...ps)]
      }
      const same = (ax) => {
        const [a0, a1] = ext(A.box, ax)
        const [b0, b1] = ext(B.box, ax)
        return Math.abs(a0 - b0) < 3 && Math.abs(a1 - b1) < 3
      }
      return same(u) || same(w)
    }
    for (let merged = true; merged; ) {
      merged = false
      outer: for (let i = 0; i < banks.length; i++)
        for (let j = i + 1; j < banks.length; j++) {
          if (!near(banks[i], banks[j])) continue
          const A = banks[i]
          const B = banks[j]
          A.box = boxAround([...corners(A.box), ...corners(B.box)], { x: A.box.ux, z: A.box.uz })
          A.courts.push(...B.courts)
          banks.splice(j, 1)
          merged = true
          break outer
        }
    }
    banks.forEach((b, i) => {
      b.i = i
      for (const c of b.courts) c.bank = i
    })
  }

  // ---------- the entrance (spawn) ----------
  const allBanksBox = boxAround(banks.flatMap((b) => corners(b.box)), { x: 1, z: 0 })
  const parkingAreas = (spec.areas || []).filter((a) => a.k === "parking")
  // indoor halls (one or more buildings with courts inside); the first is where you arrive
  const hallSpecs = spec.halls || (spec.hall ? [spec.hall] : [])
  const hallPoly = hallSpecs.length ? hallSpecs[0].p : null
  const hallDoor = (h) => {
    const c = centroid(h.p)
    return h.door ? { x: h.door[0], z: h.door[1] } : nearestOnPoly(h.p, parkingAreas.length ? centroid(parkingAreas[0].p) : { x: c.x, z: c.z + 1000 })
  }
  let entry
  if (spec.spawn) entry = { x: spec.spawn.x, z: spec.spawn.z }
  else if (hallPoly) {
    // (well inside the door, so the camera behind you stays inside too)
    const c = centroid(hallPoly)
    const d = hallDoor(hallSpecs[0])
    entry = add(d, sub(c, d), Math.min(7, len(sub(c, d)) * 0.6) / (len(sub(c, d)) || 1))
  } else if (parkingAreas.length) {
    // the parking lot nearest the courts
    const near = parkingAreas.map((a) => centroid(a.p)).sort((p, q) => len(p) - len(q))[0]
    entry = near
  } else entry = { x: 0, z: allBanksBox.cz + allBanksBox.hz + 12 }
  // (from the lot, walk up to the courts: the spot just outside the nearest bank)
  const nearestBank = banks.slice().sort((a, b) => len(sub({ x: a.box.cx, z: a.box.cz }, entry)) - len(sub({ x: b.box.cx, z: b.box.cz }, entry)))[0]

  // ---------- solid things that aren't courts (buildings, the hall's walls) ----------
  const extraBoxes = []
  const wallBoxes = (poly, h, kind, gap = null) => {
    const out = []
    for (let i = 0; i < poly.length; i++) {
      const a = { x: poly[i][0], z: poly[i][1] }
      const b = { x: poly[(i + 1) % poly.length][0], z: poly[(i + 1) % poly.length][1] }
      const ab = sub(b, a)
      const L = len(ab)
      if (L < 0.2) continue
      const u = { x: ab.x / L, z: ab.z / L }
      const cutAt = doorCut(a, u, L, gap)
      const runs = cutAt ? [[0, cutAt[0]], [cutAt[1], L]] : [[0, L]]
      for (const [s, e] of runs) {
        if (e - s < 0.1) continue
        const m = add(a, u, (s + e) / 2)
        out.push({ cx: round(m.x), cz: round(m.z), hx: round((e - s) / 2 + 0.15), hz: 0.18, ux: u.x, uz: u.z, h, kind })
      }
    }
    return out
  }
  // walls with any number of door gaps
  const wallBoxesGaps = (poly, h, kind, gaps) => {
    const out = []
    for (let i = 0; i < poly.length; i++) {
      const a = { x: poly[i][0], z: poly[i][1] }
      const b = { x: poly[(i + 1) % poly.length][0], z: poly[(i + 1) % poly.length][1] }
      const ab = sub(b, a)
      const L = len(ab)
      if (L < 0.2) continue
      const u = { x: ab.x / L, z: ab.z / L }
      let runs = [[0, L]]
      for (const g of gaps) {
        const cut = doorCut(a, u, L, g)
        if (!cut) continue
        runs = runs.flatMap(([s0, e0]) => [[s0, Math.min(e0, cut[0])], [Math.max(s0, cut[1]), e0]]).filter(([s0, e0]) => e0 - s0 > 0.05)
      }
      for (const [s0, e0] of runs) {
        if (e0 - s0 < 0.1) continue
        const m = add(a, u, (s0 + e0) / 2)
        out.push({ cx: round(m.x), cz: round(m.z), hx: round((e0 - s0) / 2 + 0.15), hz: 0.15, ux: u.x, uz: u.z, h, kind })
      }
    }
    return out
  }
  // ---------- the room kit: rooms (propkit.js), buildings you can go into, their doors ----------
  // (a door is a gap in every wall it sits on: a room's, a building's; "closed" doors aren't)
  const roomSpecs = (spec.rooms || []).filter((r) => r.p && r.p.length > 2)
  const openBuildings = (spec.buildings || []).filter((b) => b.doors && b.doors.length)
  // (halls can have more doors than their main one: to the street, to the next hall; each cuts
  // every wall it sits on, both halls' where they share one)
  // (a room upstairs, r.y: its doors are at its floor and cut only walls on that floor)
  const allDoors = [...roomSpecs.flatMap((r) => (r.doors || []).map((d) => (r.y ? { ...d, y: r.y } : d))), ...openBuildings.flatMap((b) => b.doors), ...hallSpecs.flatMap((h) => h.doors || [])].filter((d) => d.kind !== "closed").map((d) => ({ ...d, w: d.w || 1.8, kind: d.kind || "open" }))
  const doorHosts = [...roomSpecs.map((r) => r.p), ...openBuildings.map((b) => b.p), ...hallSpecs.map((h) => h.p)]
  const hostY = new Map(roomSpecs.map((r) => [r.p, r.y || 0]))
  const segDist = (p, a, b) => {
    const ab = sub(b, a)
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)))
    return len(sub(p, add(a, ab, t)))
  }
  const gapsOn = (poly, y = hostY.get(poly) || 0) => allDoors.filter((d) => Math.abs((d.y || 0) - y) < 0.5 && poly.some((q, i) => segDist(d, { x: q[0], z: q[1] }, { x: poly[(i + 1) % poly.length][0], z: poly[(i + 1) % poly.length][1] }) < 0.5))
  const rooms = roomSpecs.map((r) => {
    const look = ROOM_LOOK[r.type] || ROOM_LOOK.hall
    const room = { ...look, ...r, h: r.h || look.h }
    const ry = r.y || 0
    extraBoxes.push(...wallBoxesGaps(r.p, room.h, "room", gapsOn(r.p)).map((b) => (ry ? { ...b, y0: ry, h: ry + b.h } : b)))
    // (furnished round every door on its walls: its own and its neighbours'; upstairs, the
    // furniture stands on the room's floor)
    room.props = furnishRoom({ ...room, doors: [...gapsOn(r.p), ...(r.doors || []).filter((d) => d.kind === "closed")] }).map((pr) => (ry ? { ...pr, y: (pr.y || 0) + ry, floor: true } : pr))
    return room
  })
  // over each doorway: overhead (people walk under, cameras don't pass)
  for (const d of allDoors) {
    const host = doorHosts.find((poly) => gapsOn(poly).includes(d))
    if (!host) continue
    let best = null
    host.forEach((q, i) => {
      const a = { x: q[0], z: q[1] }
      const b = { x: host[(i + 1) % host.length][0], z: host[(i + 1) % host.length][1] }
      const dd = segDist(d, a, b)
      if (!best || dd < best.dd) best = { dd, u: { x: (b.x - a.x) / (len(sub(b, a)) || 1), z: (b.z - a.z) / (len(sub(b, a)) || 1) } }
    })
    // (up to the floor of a door straight above it, if there is one: Los Cab's ballroom door
    // over the lobby's)
    const above = allDoors.filter((o) => (o.y || 0) > (d.y || 0) + 0.5 && Math.hypot(o.x - d.x, o.z - d.z) < (o.w + d.w) / 2 + 0.4).map((o) => o.y)
    if (d.kind !== "open") extraBoxes.push({ cx: d.x, cz: d.z, hx: d.w / 2 + 0.2, hz: 0.2, ux: best.u.x, uz: best.u.z, h: above.length ? Math.min(...above) : (d.y || 0) + 12, y0: (d.y || 0) + 2.4, kind: "lintel" })
  }
  // ---------- floors above the ground: decks (a rooftop terrace, a mezzanine) and stairs ----------
  // (layout.js: a body's height decides what's solid for it; the walker climbs the stairs)
  const stairs = (spec.stairs || []).map((s) => {
    const a = { x: s.a[0], z: s.a[1] }
    const b = { x: s.b[0], z: s.b[1] }
    const L = len(sub(b, a)) || 1
    const u = { x: (b.x - a.x) / L, z: (b.z - a.z) / L }
    const n = { x: -u.z, z: u.x }
    const w = s.w || 1.6
    const y0 = s.y0 || 0
    const y1 = s.y1
    const mid = add(a, u, L / 2)
    // the sides (stringers and rails: you can't step off, nobody walks through them below)
    for (const sg of [-1, 1]) extraBoxes.push({ cx: round(mid.x + n.x * sg * (w / 2 + 0.08)), cz: round(mid.z + n.z * sg * (w / 2 + 0.08)), hx: round(L / 2), hz: 0.08, ux: u.x, uz: u.z, h: y1 + 1.0, kind: "stairs" })
    // under the high end: solid for the people on the ground (low enough for those on the steps)
    const under = add(a, u, L * 0.675)
    extraBoxes.push({ cx: round(under.x), cz: round(under.z), hx: round(L * 0.325), hz: round(w / 2), ux: u.x, uz: u.z, h: round(y0 + (y1 - y0) * 0.35), kind: "stairs" })
    return { a, b, w, y0, y1, color: s.color || null, rail: s.rail || null, ...(s.open ? { open: true } : {}) }
  })
  const decks = (spec.decks || []).map((d) => {
    const p = d.p
    // (an upstairs room's doors onto this deck: Los Cab's ballroom opens onto its balcony; the
    // railing round the balcony had run across both glass doors, so nobody could go in)
    const doorGaps = roomSpecs.filter((r) => Math.abs((r.y || 0) - d.y) < 0.3).flatMap((r) => (r.doors || []).map((o) => [o.x, o.z, (o.w || 1.6) + 0.2]))
    const deckOpenings = [...(d.openings || []), ...doorGaps]
    if (d.rail !== false) {
      // a railing round the edge, open where stairs arrive (and where it says)
      const openings = [...stairs.filter((s) => Math.abs(s.y1 - d.y) < 0.3).map((s) => ({ x: s.b.x, z: s.b.z, w: s.w + 0.5 })), ...deckOpenings.map((o) => ({ x: o[0], z: o[1], w: o[2] || 1.6 }))]
      for (const bx of wallBoxesGaps(p, 1.05, "rail", openings)) extraBoxes.push({ ...bx, hz: 0.06, y0: d.y, h: d.y + 1.05 })
    }
    if (d.slab) {
      // the floor itself, seen from below (a mezzanine over a bar): solid for cameras only
      const xs = p.map((q) => q[0])
      const zs = p.map((q) => q[1])
      extraBoxes.push({ cx: round((Math.min(...xs) + Math.max(...xs)) / 2), cz: round((Math.min(...zs) + Math.max(...zs)) / 2), hx: round((Math.max(...xs) - Math.min(...xs)) / 2), hz: round((Math.max(...zs) - Math.min(...zs)) / 2), ux: 1, uz: 0, y0: round(d.y - 0.3), h: d.y, kind: "deck" })
    }
    return { y: d.y, p, name: d.name || null, rail: d.rail !== false, railColor: d.railColor || null, slab: !!d.slab, color: d.color || null, openings: deckOpenings, ...(d.fascia ? { fascia: d.fascia, railStyle: d.railStyle || null, postColor: d.postColor || null, postEvery: d.postEvery || null } : {}) }
  })
  // props: the rooms' furniture and the venue's own (outdoors), solid ones bumped into
  const venueProps = (spec.props || []).filter((pr) => pr && pr.t)
  const propCircles = []
  for (const pr of [...rooms.flatMap((r) => r.props), ...venueProps]) {
    const sol = propSolid(pr)
    if (!sol) continue
    if (sol.r) propCircles.push(sol)
    else extraBoxes.push(sol)
  }
  // how far the walkable area reaches beyond the courts: the rooms, open buildings, the arrival
  const extent = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }
  const grow = (x, z) => {
    extent.x0 = Math.min(extent.x0, x)
    extent.x1 = Math.max(extent.x1, x)
    extent.z0 = Math.min(extent.z0, z)
    extent.z1 = Math.max(extent.z1, z)
  }
  for (const r of roomSpecs) for (const [x, z] of r.p) grow(x, z)
  for (const b of openBuildings) for (const [x, z] of b.p) grow(x, z)
  for (const s of stairs) for (const q of [s.a, s.b]) grow(q.x, q.z)
  for (const d of decks) for (const [x, z] of d.p) grow(x, z)
  if (spec.spawn) grow(spec.spawn.x, spec.spawn.z)
  for (const pr of venueProps) grow(pr.x, pr.z)
  // the halls: their walls, each with a door
  const halls = hallSpecs.map((h, k) => {
    const door = nearestOnPoly(h.p, h.door ? { x: h.door[0], z: h.door[1] } : k === 0 ? entry : hallDoor(h))
    const out = { ...h, doorAt: { i: door.i, t: door.t, w: h.doorW || 3.2, x: door.x, z: door.z } }
    extraBoxes.push(...wallBoxesGaps(h.p, h.h || 9, "wall", [out.doorAt, ...gapsOn(h.p)]))
    // the wall over the door: overhead (people walk under it; cameras can't pass through it)
    {
      const a = { x: h.p[door.i][0], z: h.p[door.i][1] }
      const b = { x: h.p[(door.i + 1) % h.p.length][0], z: h.p[(door.i + 1) % h.p.length][1] }
      const L = len(sub(b, a)) || 1
      extraBoxes.push({ cx: door.x, cz: door.z, hx: out.doorAt.w / 2 + 0.3, hz: 0.25, ux: (b.x - a.x) / L, uz: (b.z - a.z) / L, h: h.h || 9, y0: 3.0, kind: "lintel" })
    }
    return out
  })
  const hall = halls[0] || null
  // buildings near the courts: solid walls (the hall is done above)
  const reach = { x0: Math.min(allBanksBox.cx - allBanksBox.hx - 40, extent.x0 - 30), x1: Math.max(allBanksBox.cx + allBanksBox.hx + 40, extent.x1 + 30), z0: Math.min(allBanksBox.cz - allBanksBox.hz - 40, extent.z0 - 30), z1: Math.max(allBanksBox.cz + allBanksBox.hz + 40, extent.z1 + 30) }
  for (const b of spec.buildings || []) {
    if (b.hall) continue
    if (!b.p.some(([x, z]) => x > reach.x0 && x < reach.x1 && z > reach.z0 && z < reach.z1)) continue
    // an upstairs room's door in this building's outside wall (Los Cab's ballroom onto its
    // balcony): the wall is open there at that floor only, door-high (scenery.js draws it so);
    // below and above it stays solid. (Before, the wall was solid at every height there: the
    // balcony's doors couldn't be walked through.)
    const edge = (d) => b.p.findIndex((q, k) => segDist(d, { x: q[0], z: q[1] }, { x: b.p[(k + 1) % b.p.length][0], z: b.p[(k + 1) % b.p.length][1] }) < 0.5)
    const ups = b.doors ? allDoors.filter((d) => (d.y || 0) > 0.5 && edge(d) >= 0) : []
    extraBoxes.push(...(b.doors ? wallBoxesGaps(b.p, b.h, "building", [...gapsOn(b.p), ...ups]) : wallBoxes(b.p, b.h, "building")))
    for (const d of ups) {
      const i = edge(d)
      const q0 = b.p[i]
      const q1 = b.p[(i + 1) % b.p.length]
      const L = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) || 1
      const ux = (q1[0] - q0[0]) / L
      const uz = (q1[1] - q0[1]) / L
      const box = { cx: d.x, cz: d.z, hx: (d.w || 1.8) / 2 + 0.05, hz: 0.15, ux, uz, kind: "building" }
      if (b.h > d.y + 2.4) extraBoxes.push({ ...box, y0: d.y + 2.4, h: b.h })
      // below it the wall, except where a ground-floor door is (the lobby's under the ballroom's)
      const at = (p) => (p.x - q0[0]) * ux + (p.z - q0[1]) * uz
      let runs = [[at(d) - box.hx, at(d) + box.hx]]
      for (const g of gapsOn(b.p)) if (edge(g) === i) runs = runs.flatMap(([s0, e0]) => [[s0, Math.min(e0, at(g) - g.w / 2)], [Math.max(s0, at(g) + g.w / 2), e0]]).filter(([s0, e0]) => e0 - s0 > 0.05)
      for (const [s0, e0] of runs) extraBoxes.push({ ...box, cx: q0[0] + ux * (s0 + e0) / 2, cz: q0[1] + uz * (s0 + e0) / 2, hx: (e0 - s0) / 2, h: d.y })
    }
  }
  // solid extras: stands, a tower, a raised lounge, columns (circles)
  const extraCircles = []
  for (const x of spec.extras || []) {
    const a = (x.deg || 0) * DEG
    const u = { x: Math.cos(a), z: Math.sin(a) }
    if (x.type === "stands") extraBoxes.push({ cx: x.x, cz: x.z, hx: (x.w || 10) / 2, hz: ((x.rows || 4) * 0.8) / 2 + 0.2, ux: u.x, uz: u.z, h: (x.rows || 4) * 0.45 + 0.4, kind: "stands" })
    else if (x.type === "tower" && !x.base) extraBoxes.push({ cx: x.x, cz: x.z, hx: (x.w || 5) / 2, hz: (x.w || 5) / 2, ux: 1, uz: 0, h: x.h || 14, kind: "tower" })
    else if (x.type === "spine") extraBoxes.push({ cx: x.x, cz: x.z, hx: (x.w || 20) / 2, hz: (x.d || 5) / 2, ux: u.x, uz: u.z, h: (x.h || 1) + 1.1, kind: "spine" })
    else if (x.type === "gazebo") extraCircles.push({ x: x.x, z: x.z, r: 0.25 })
    else if (x.type === "pergola" && x.poly) {
      // (its posts, as scenery.js stands them: one every 3.5 m at most round the edge)
      x.poly.forEach(([ax, az], i) => {
        const [bx, bz] = x.poly[(i + 1) % x.poly.length]
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3.5))
        for (let k = 0; k < n; k++) extraCircles.push({ x: ax + ((bx - ax) * k) / n, z: az + ((bz - az) * k) / n, r: 0.2 })
      })
    }
  }
  for (const h of hallSpecs) {
    if (!h.columns) continue
    const c = h.columns
    const n = c.n || 4
    for (let k = 0; k < n; k++) {
      const t = n > 1 ? k / (n - 1) : 0.5
      extraCircles.push({ x: c.from[0] + (c.to[0] - c.from[0]) * t, z: c.from[1] + (c.to[1] - c.from[1]) * t, r: 0.25 })
    }
  }
  // a court shouldn't be inside a building (bad data): those buildings are dropped
  const bankBoxes = banks.map((b) => ({ ...b.box, h: indoor ? 1.2 : spec.fence?.height || 3, kind: "pen", bank: b.i }))
  const rawTrees = (spec.trees || []).map(([x, z]) => ({ x, z }))
  const solidAt = (p, pad = 0.4) => bankBoxes.some((b) => inBox(b, p, pad)) || extraBoxes.some((b) => !b.y0 && inBox(b, p, pad)) || propCircles.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < c.r + pad)
  const nearTree = (p, r) => rawTrees.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < r)
  const insideBuilding = (p) => (spec.buildings || []).some((b) => !b.hall && !b.doors && pointInPoly(p, b.p))

  // ---------- numbering every pickleball court, reading order ----------
  const pbCourts = courts.filter((c) => c.s === "p")
  const order = pbCourts.slice().sort((a, b) => a.bank - b.bank || Math.round(a.z / 4) - Math.round(b.z / 4) || a.x - b.x)
  // (a venue's own numbers win: the cards on the real walls)
  order.forEach((c, k) => (c.num = c.n || k + 1))

  // ---------- a court's gate side ----------
  // the open sides of a court in its bank: -> [{ out (unit), dist (center to the fence) }]
  const openSides = (c) => {
    const bank = banks[c.bank]
    const B = bank.box
    const bu = { x: B.ux, z: B.uz }
    const bw = { x: -B.uz, z: B.ux }
    const rel = sub(c, { x: B.cx, z: B.cz })
    const cu = dot(rel, bu)
    const cw = dot(rel, bw)
    const sides = []
    for (const [axis, sign] of [
      ["u", 1],
      ["u", -1],
      ["w", 1],
      ["w", -1],
    ]) {
      const dir = axis === "u" ? bu : bw
      const out = { x: dir.x * sign, z: dir.z * sign }
      const dist = axis === "u" ? B.hx - sign * cu : B.hz - sign * cw
      // anyone else in the bank between this court and that fence?
      const blockedBy = bank.courts.some((o) => {
        if (o === c) return false
        const d = sub(o, c)
        const along = dot(d, out)
        const across = Math.abs(dot(d, axis === "u" ? bw : bu))
        const halfAcross = axis === "u" ? (c.W + o.W) / 2 : (c.L + o.L) / 2
        return along > 0.5 && across < halfAcross - 0.3
      })
      if (!blockedBy) sides.push({ axis, out, dist, sideline: axis === "w" })
    }
    return sides
  }

  // furniture placed so far (racks, bleachers), as boxes, to keep things apart
  const placed = []
  // where people stand at the live courts (gate, rack): later furniture keeps clear of them
  const keepClear = []
  const free = (b) => !placed.some((p) => boxesOverlap(p, b)) && !extraBoxes.some((p) => !p.y0 && boxesOverlap(p, b)) && !bankBoxes.some((p) => boxesOverlap(p, b))
  const bounds0 = { x0: allBanksBox.cx - allBanksBox.hx - 24, x1: allBanksBox.cx + allBanksBox.hx + 24, z0: allBanksBox.cz - allBanksBox.hz - 24, z1: allBanksBox.cz + allBanksBox.hz + 24 }
  for (const h of halls) {
    // (indoors: the halls, plus a strip of parking round them)
    for (const [x, z] of h.p) {
      bounds0.x0 = Math.min(bounds0.x0, x - 18)
      bounds0.x1 = Math.max(bounds0.x1, x + 18)
      bounds0.z0 = Math.min(bounds0.z0, z - 18)
      bounds0.z1 = Math.max(bounds0.z1, z + 18)
    }
  }
  if (extent.x0 < Infinity) {
    bounds0.x0 = Math.min(bounds0.x0, extent.x0 - 8)
    bounds0.x1 = Math.max(bounds0.x1, extent.x1 + 8)
    bounds0.z0 = Math.min(bounds0.z0, extent.z0 - 8)
    bounds0.z1 = Math.max(bounds0.z1, extent.z1 + 8)
  }
  const inBounds = (p, pad = 1) => p.x > bounds0.x0 + pad && p.x < bounds0.x1 - pad && p.z > bounds0.z0 + pad && p.z < bounds0.z1 - pad
  const insideHall = (p) => halls.some((h) => pointInPoly(p, h.p))
  const walkable = (p, pad = 0.45) => inBounds(p) && !solidAt(p, pad) && !insideBuilding(p)

  // a court's live-game setup on the side `side`: gate, rack, bleachers -> a layout court or null
  const setupCourt = (c, side, toward) => {
    const out = side.out
    const tangent = { x: out.z, z: -out.x }
    const fence = add(c, out, side.dist)
    const alongU = side.axis === "u" ? Math.abs(dot(out, c.u)) > 0.7 : Math.abs(dot(out, c.u)) > 0.7
    // which way along the fence is toward the entrance
    const sign = Math.sign(dot(sub(toward, fence), tangent)) || 1
    let g
    let bleacher
    let shift = 0
    if (!alongU) {
      // sideline: like Riverside, the gate near the end toward the entrance, bleachers in the middle
      const halfAlong = c.L / 2 + banks[c.bank].room.u
      g = sign * Math.max(1, halfAlong - 2.4)
      bleacher = Math.min(7, 2 * (halfAlong - 3.3))
    } else {
      // baseline: the gate just off the middle, the rack beside it, a short stand on the other side
      g = sign * 1.0
      bleacher = 3.2
      shift = -sign * 1.95
    }
    const gate = add(fence, tangent, g)
    const outside = add(gate, out, 1.0)
    const rack = add(add(gate, tangent, sign * 1.5), out, 0.55)
    const rackBox = { cx: rack.x, cz: rack.z, hx: 0.85, hz: 0.35, ux: tangent.x, uz: tangent.z }
    // the spots people stand: outside the gate, at the rack, behind the stand
    const spots = indoor ? [outside, add(rack, out, 0.6)] : [outside, add(rack, out, 0.6), add(rack, out, 1.3)]
    if (!spots.every((p) => walkable(p, indoor ? 0.3 : 0.4))) return null
    if (!free(rackBox)) return null
    let bl = 0
    let bBox = null
    // (fence.bleachers: false: none by rule, a venue built only from what is mapped or seen)
    for (const L of spec.fence?.bleachers === false ? [] : indoor ? [bleacher, 2.4] : [bleacher, 5, 3.2]) {
      if (L < 2.2) continue
      const center = add(add(fence, out, 0.95), tangent, shift)
      const box = { cx: center.x, cz: center.z, hx: L / 2 + 0.1, hz: 0.6, ux: tangent.x, uz: tangent.z }
      const behind = [add(center, out, 1.0), add(add(center, out, 1.0), tangent, L / 2 - 0.3), add(add(center, out, 1.0), tangent, -L / 2 + 0.3)]
      if (free(box) && behind.every((p) => walkable(p, 0.35))) {
        bl = L
        bBox = box
        break
      }
    }
    placed.push(rackBox)
    if (bBox) placed.push(bBox)
    keepClear.push(...spots)
    // (the court's half sizes as layout.js wants them: the fence distance on the gate side)
    const hx = alongU ? side.dist : c.L / 2 + banks[c.bank].room.u
    const viewSide = !alongU ? out : (() => {
      // the camera watches from the more open sideline
      const sides = openSides(c).filter((s) => s.sideline)
      return sides.length ? sides[0].out : c.w
    })()
    const hz = !alongU ? side.dist : c.W / 2 + banks[c.bank].room.w
    return { rot: c.rot, hx, hz, out, gate: g, bleacher: bl, bleacherShift: shift, view: viewSide, baseE: 1 }
  }

  // ---------- which courts have live games ----------
  const toward = entry
  const byNear = pbCourts.slice().sort((a, b) => len(sub(a, entry)) - len(sub(b, entry)))
  const wantIds = spec.liveCourts ? new Set(spec.liveCourts) : null
  const live = []
  const tried = new Set()
  const trySetup = (c) => {
    const sides = openSides(c).sort((a, b) => (b.sideline ? 1 : 0) - (a.sideline ? 1 : 0) || len(sub(add(c, a.out, a.dist), toward)) - len(sub(add(c, b.out, b.dist), toward)))
    for (const side of sides) {
      const s = setupCourt(c, side, toward)
      if (s) return s
    }
    return null
  }
  const exclude = new Set(opts.exclude || [])
  for (const c of wantIds ? order.filter((c) => wantIds.has(c.num)) : byNear) {
    if (live.length >= maxLive) break
    if (exclude.has(c.i)) continue
    tried.add(c)
    // (keep live courts' gates apart)
    const s = trySetup(c)
    if (!s) continue
    live.push({ c, s })
  }
  // a ball-machine court: the next one along that works
  let machine = null
  for (const c of byNear) {
    if (live.some((l) => l.c === c) || exclude.has(c.i)) continue
    const s = trySetup(c)
    if (s) {
      machine = { c, s }
      break
    }
  }
  live.sort((a, b) => a.c.num - b.c.num)
  const layoutCourts = live.map(({ c, s }, k) => ({ id: k, name: `Court ${c.num}`, num: c.num, level: LEVELS[k % LEVELS.length], x: c.x, z: c.z, ...s, src: c.i }))
  for (const { c } of live) c.live = true

  // ---------- the pro shop / front desk ----------
  const gate0 = layoutCourts[0] ? add({ x: layoutCourts[0].x, z: layoutCourts[0].z }, layoutCourts[0].out, (Math.abs(dot(layoutCourts[0].out, { x: Math.sin(layoutCourts[0].rot), z: Math.cos(layoutCourts[0].rot) })) > 0.7 ? layoutCourts[0].hx : layoutCourts[0].hz) + 5) : entry
  const spawnAt = hallPoly && !spec.spawn ? (() => {
    let best = entry
    let bestD = Infinity
    for (let dx = -12; dx <= 12; dx += 0.5)
      for (let dz = -12; dz <= 12; dz += 0.5) {
        const p = { x: entry.x + dx, z: entry.z + dz }
        if (!walkable(p, 0.6) || !pointInPoly(p, hallPoly)) continue
        // (not in the doorway: the camera behind you would be outside)
        if (Math.hypot(p.x - halls[0].doorAt.x, p.z - halls[0].doorAt.z) < 4.5) continue
        const d = Math.hypot(dx, dz)
        if (d < bestD) {
          bestD = d
          best = p
        }
      }
    return best
  })() : (() => {
    // (an arrival the spec gives, outdoors at an indoor venue too: as it is, if there's room)
    if (spec.spawn && walkable(entry, 0.5)) return entry
    // walk from the entrance toward the first live court's gate until there's room
    const target = gate0
    const d = sub(target, entry)
    const L = len(d) || 1
    for (let k = 0; k <= 1; k += 0.05) {
      const p = add(entry, d, k)
      if (walkable(p, 1.2) && (!hallPoly || insideHall(p))) return p
    }
    return target
  })()
  const faceCourts = sub(gate0, spawnAt)
  const spawnYaw = spec.spawn?.deg !== null && spec.spawn?.deg !== undefined ? Math.atan2(Math.cos(spec.spawn.deg * DEG), Math.sin(spec.spawn.deg * DEG)) : Math.atan2(faceCourts.x, faceCourts.z)
  let booth = null
  // (fence.booth: false: no pro-shop kiosk by rule, e.g. a city park with none; the Locker
  // Room is still in the menus)
  if (spec.fence?.booth !== false) {
    const fwd = { x: Math.sin(spawnYaw), z: Math.cos(spawnYaw) }
    const right = { x: fwd.z, z: -fwd.x }
    for (const [a, b] of [
      [4.5, 1.5],
      [-4.5, 1.5],
      [5.5, -1],
      [-5.5, -1],
      [3.5, 4],
      [-3.5, 4],
      [7, 3],
      [-7, 3],
    ]) {
      const center = add(add(spawnAt, right, a), fwd, b)
      // (facing the spawn: its counter toward where you arrive)
      const face0 = sub(spawnAt, center)
      const fl = len(face0) || 1
      const face = { x: face0.x / fl, z: face0.z / fl }
      const box = { cx: center.x, cz: center.z, hx: indoor ? 0.6 : 1.6, hz: indoor ? 1.6 : 1.4, ux: face.x, uz: face.z }
      const front = add(center, face, box.hx + 0.9)
      if (free({ ...box, hx: box.hx + 0.3, hz: box.hz + 0.3 }) && corners(box).every((p) => walkable(p, 0.1)) && walkable(front, 0.4)) {
        booth = { x: round(center.x), z: round(center.z), hx: box.hx, hz: box.hz, h: indoor ? 1.1 : 3.0, face, style: indoor ? "desk" : "kiosk" }
        placed.push(box)
        break
      }
    }
  }

  // ---------- benches along the banks ----------
  const benches = []
  // (fence.benches: false: none by rule; a venue built only from what is mapped or seen)
  if (!indoor && spec.fence?.benches !== false) {
    for (const bank of banks) {
      const B = bank.box
      const u = { x: B.ux, z: B.uz }
      const w = { x: -B.uz, z: B.ux }
      for (const [dir, half, alongDir, alongHalf] of [
        [w, B.hz, u, B.hx],
        [{ x: -w.x, z: -w.z }, B.hz, u, B.hx],
        [u, B.hx, w, B.hz],
        [{ x: -u.x, z: -u.z }, B.hx, w, B.hz],
      ]) {
        for (let s = -alongHalf + 6; s <= alongHalf - 6 && benches.length < 14; s += 16) {
          const p = add(add({ x: B.cx, z: B.cz }, dir, half + 1.6), alongDir, s)
          const yaw = Math.atan2(-dir.x, -dir.z)
          const box = { cx: p.x, cz: p.z, hx: 0.9, hz: 0.45, ux: Math.cos(yaw), uz: -Math.sin(yaw) }
          const front = add(p, { x: Math.sin(yaw), z: Math.cos(yaw) }, 0.9)
          if (!free(box) || !walkable(p, 0.6) || !walkable(front, 0.4) || nearTree(p, 1.3) || nearTree(front, 1.0) || rand() < 0.25 || keepClear.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1.6 || Math.hypot(q.x - front.x, q.z - front.z) < 0.9)) continue
          placed.push(box)
          benches.push({ id: `b${benches.length}`, x: round(p.x), z: round(p.z), yaw })
        }
      }
    }
  }

  // ---------- light poles (outdoors, when the courts are lit) ----------
  const lights = []
  const every = spec.fence?.lightEvery || 18
  if (!indoor && spec.lit && (spec.fence?.lightsAt === "gaps" || spec.fence?.lightsAt === "partitions")) {
    // (fidelity round 4, lightsAt "partitions": in the banks with partitions (pairDividers.only)
    // the poles stand only on the partitions, ±lightAlong from each court's middle, the T arm
    // across the partition, a head over each court (the owner's drone photo, measured in its
    // solved pose); none between the two courts of a pair or at the rows' ends)
    const pd = spec.fence?.pairDividers
    const partsOnly = (bank) => spec.fence.lightsAt === "partitions" && pd && (!pd.only || pd.only.some((p) => inBox(bank.box, p)))
    // (Los Cab, the owner's drone photo: a pole in every gap between side-by-side courts and
    // outside each row's end courts, two along each gap, ±lightAlong from the row's middle; the
    // T arm runs along the gap)
    const along = spec.fence?.lightAlong ?? 4.5
    for (const bank of banks) {
      if (bank.s !== "p") continue
      const u = { x: bank.box.ux, z: bank.box.uz }
      const w = { x: -u.z, z: u.x }
      const rows = new Map()
      for (const c of bank.courts) {
        const k = Math.round(dot(c, u) / 3)
        if (!rows.has(k)) rows.set(k, [])
        rows.get(k).push(c)
      }
      for (const row of rows.values()) {
        row.sort((a, b) => dot(a, w) - dot(b, w))
        const cu = row.reduce((s, c) => s + dot(c, u), 0) / row.length
        const lines = []
        const parts = partsOnly(bank)
        row.forEach((c, i) => {
          const cw = dot(c, w)
          if (parts) {
            if (i + 1 < row.length && dot(row[i + 1], w) - cw - c.W > (pd.gap ?? 2.8)) lines.push((cw + dot(row[i + 1], w)) / 2)
            return
          }
          if (i === 0) lines.push(cw - c.W / 2 - Math.min(0.9, bank.room.w / 2))
          if (i + 1 < row.length) lines.push((cw + dot(row[i + 1], w)) / 2)
          else lines.push(cw + c.W / 2 + Math.min(0.9, bank.room.w / 2))
        })
        // (lightAlong [out, in]: offsets from the court's middle away from and toward the bank's
        // middle (Los Cab: by the outer kitchen line and 1.5 m inside the inner baseline, the
        // two rows mirror each other across the centre aisle); a number: ±that)
        const sOut = Math.sign(cu - dot({ x: bank.box.cx, z: bank.box.cz }, u)) || 1
        const offs = Array.isArray(along) ? [sOut * along[0], sOut * along[1]] : [-along, along]
        for (const lw of lines)
          for (const off of offs) {
            const p = { x: u.x * (cu + off) + w.x * lw, z: u.z * (cu + off) + w.z * lw }
            if (lights.length < 160) lights.push({ x: round(p.x), z: round(p.z), arm: parts ? [round(w.x), round(w.z)] : [round(u.x), round(u.z)] })
          }
      }
    }
  } else if (!indoor && spec.lit) {
    for (const bank of banks) {
      const B = bank.box
      const u = { x: B.ux, z: B.uz }
      const w = { x: -B.uz, z: B.ux }
      const nU = Math.max(1, Math.round((2 * B.hx) / every))
      for (const sw of [-1, 1])
        for (let k = 0; k <= nU; k++) {
          const p = add(add({ x: B.cx, z: B.cz }, u, -B.hx + (2 * B.hx * k) / nU), w, sw * (B.hz + 0.35))
          if (placed.some((b) => inBox(b, p, 0.3))) continue
          if (lights.length < 140) lights.push({ x: round(p.x), z: round(p.z) })
        }
    }
  }

  // (fence.lightsOnPartitions { t, every }: poles standing on the hand-placed partitions of type
  // t too, one every `every` m centred along each, the T arm across it: Paseo's photos show the
  // poles rising from the low partitions inside the pen)
  const lop = spec.fence?.lightsOnPartitions
  if (!indoor && spec.lit && lop)
    for (const p of spec.fence?.partitions || []) {
      if (lop.t && p.t !== lop.t) continue
      const dx = p.b[0] - p.a[0]
      const dz = p.b[1] - p.a[1]
      const len = Math.hypot(dx, dz)
      const n = Math.max(1, Math.round(len / (lop.every || 12)))
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n
        const q = { x: p.a[0] + dx * t, z: p.a[1] + dz * t }
        if (lights.some((l) => Math.hypot(l.x - q.x, l.z - q.z) < 3)) continue
        if (lights.length < 160) lights.push({ x: round(q.x), z: round(q.z), arm: [round(-dz / len), round(dx / len)] })
      }
    }

  // (poles placed by hand, from photos: fence.lights)
  if (!indoor) for (const l of spec.fence?.lights || []) lights.push({ x: l.x, z: l.z, ...(l.heads ? { heads: l.heads } : {}) })

  // ---------- trees: solid if they're in the walkable part ----------
  const treeZone = cleanZone({ courts, banks: banks.map((b) => b.box), buildings: spec.buildings || [], halls, rooms, decks, extras: spec.extras || [] })
  const trees = (spec.trees || [])
    .map(([x, z, s, kind]) => ({ x, z, s: s || 1, kind: kind || "broadleaf" }))
    .filter((t) => !bankBoxes.some((b) => inBox(b, t, 0.3)) && !insideBuilding(t) && !insideHall(t))
    // (the courts kept clean, clean.js: no trunk by a court's lines, on a deck, under a shade
    // roof or in a building; no crown over a court)
    .filter((t) => keepTree(treeZone, t))
  const treeCircles = trees.filter((t) => inBounds(t, -2)).map((t) => ({ x: t.x, z: t.z, r: t.kind === "palm" || t.kind === "fanpalm" ? 0.28 : 0.35 }))

  // ---------- the bar (indoors) ----------
  const seats = []
  let bar = null
  const barHall = halls.find((h) => h.bar)
  if (barHall) {
    const b = barHall.bar
    const a = (b.deg || 0) * DEG
    const u = { x: Math.cos(a), z: Math.sin(a) }
    const w = { x: -u.z, z: u.x }
    bar = { ...b, u, w }
    // the counter (solid), stools along its front (seats), tables beyond
    extraBoxes.push({ cx: b.x, cz: b.z, hx: b.len / 2, hz: 0.45, ux: u.x, uz: u.z, h: 1.1, kind: "bar" })
    const nStools = Math.max(2, Math.min(14, b.stools || 8))
    for (let k = 0; k < nStools; k++) {
      const along = -b.len / 2 + 0.6 + (k * (b.len - 1.2)) / Math.max(1, nStools - 1)
      const p = add(add({ x: b.x, z: b.z }, u, along), w, 0.85)
      const ap = add(p, w, 0.75)
      seats.push({ id: `stool${k}`, x: round(p.x), y: 0.75, z: round(p.z), yaw: Math.atan2(-w.x, -w.z), approach: { x: round(ap.x), z: round(ap.z) } })
    }
    bar.tableSpots = []
    const nT = Math.max(0, Math.min(10, b.tables ?? 6))
    for (let k = 0; k < nT; k++) {
      const along = -b.len / 2 + 1 + ((k % 5) * (b.len - 2)) / 4
      const p = add(add({ x: b.x, z: b.z }, u, along), w, 3.0 + Math.floor(k / 5) * 2.4)
      if (!walkable(p, 0.9)) continue
      extraBoxes.push({ cx: p.x, cz: p.z, hx: 0.45, hz: 0.45, ux: u.x, uz: u.z, h: 0.75, kind: "table" })
      bar.tableSpots.push({ x: round(p.x), z: round(p.z) })
      // two chairs a table
      for (const sgn of [-1, 1]) {
        const q = add(p, u, sgn * 0.8)
        const ap = add(q, u, sgn * 0.65)
        seats.push({ id: `t${k}${sgn > 0 ? "a" : "b"}`, x: round(q.x), y: 0.45, z: round(q.z), yaw: Math.atan2(-u.x * sgn, -u.z * sgn), approach: { x: round(ap.x), z: round(ap.z) } })
      }
    }
  }

  // the room kit's stools and chairs (and the venue's own): seats the regulars use
  {
    let k = seats.filter((s) => String(s.id).startsWith("stool")).length
    let n = 0
    for (const pr of [...rooms.flatMap((r) => r.props), ...venueProps]) {
      // (the regulars stay on the ground floor: seats upstairs are only furniture)
      if (n >= 60 || (pr.t !== "stool" && pr.t !== "chair") || (pr.y || 0) > 0.5) continue
      const dir = { x: Math.sin(pr.a || 0), z: Math.cos(pr.a || 0) }
      const ap = add({ x: pr.x, z: pr.z }, dir, -0.75)
      if (!walkable(ap, 0.34) || nearTree(ap, 0.75) || lights.some((l) => Math.hypot(l.x - ap.x, l.z - ap.z) < 0.6) || placed.some((b) => inBox(b, ap, 0.35) || inBox(b, pr, 0.2))) continue
      seats.push({ id: pr.t === "stool" ? `stool${k++}` : `chair${n}`, x: round(pr.x), y: pr.t === "stool" ? 0.75 : 0.47, z: round(pr.z), yaw: Math.atan2(dir.x, dir.z), approach: { x: round(ap.x), z: round(ap.z) } })
      n++
    }
  }

  // ---------- the walkable area and a graph to get round it ----------
  const bounds = { x0: round(bounds0.x0), x1: round(bounds0.x1), z0: round(bounds0.z0), z1: round(bounds0.z1) }
  const allBoxes = [...bankBoxes, ...extraBoxes]
  const lightCircles = lights.map((l) => ({ x: l.x, z: l.z, r: 0.15 }))
  // (a grid of what's solid on the ground, so testing thousands of spots stays quick)
  const SG = 6
  const solidGrid = new Map()
  const sgKey = (i, j) => i * 100003 + j
  const sgAdd = (o, x0, x1, z0, z1) => {
    for (let i = Math.floor(x0 / SG) - 1; i <= Math.floor(x1 / SG) + 1; i++)
      for (let j = Math.floor(z0 / SG) - 1; j <= Math.floor(z1 / SG) + 1; j++) {
        const k = sgKey(i, j)
        if (!solidGrid.has(k)) solidGrid.set(k, [])
        solidGrid.get(k).push(o)
      }
  }
  for (const b of [...allBoxes, ...placed]) {
    if (b.y0) continue
    const r = Math.hypot(b.hx, b.hz)
    sgAdd({ b }, b.cx - r, b.cx + r, b.cz - r, b.cz + r)
  }
  for (const c of [...treeCircles, ...extraCircles, ...lightCircles, ...propCircles]) sgAdd({ c }, c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r)
  const solidFinal = (p, pad) => {
    const list = solidGrid.get(sgKey(Math.floor(p.x / SG), Math.floor(p.z / SG)))
    if (!list) return false
    for (const o of list) {
      if (o.b ? inBox(o.b, p, pad) : Math.hypot(o.c.x - p.x, o.c.z - p.z) < o.c.r + pad) return true
    }
    return false
  }
  const STEP = indoor ? 2 : 5
  const NAV_PAD = indoor ? 0.4 : 0.6
  const nav = []
  for (let x = bounds.x0 + STEP / 2; x < bounds.x1; x += STEP)
    for (let z = bounds.z0 + STEP / 2; z < bounds.z1; z += STEP) {
      const p = { x: round(x), z: round(z) }
      if (solidFinal(p, NAV_PAD) || insideBuilding(p)) continue
      nav.push(p)
    }
  // nodes by the gates and outside them (so every court is reachable)
  for (const lc of layoutCourts) {
    const fenceDist = Math.abs(dot(lc.out, { x: Math.sin(lc.rot), z: Math.cos(lc.rot) })) > 0.7 ? lc.hx : lc.hz
    const tan = { x: lc.out.z, z: -lc.out.x }
    for (const [o, t] of [[1.0, 0], [1.0, 2], [1.0, -2], [2.2, 0]]) {
      const p = add(add({ x: lc.x, z: lc.z }, lc.out, fenceDist + o), tan, lc.gate + t)
      if (!solidFinal(p, 0.3)) nav.push({ x: round(p.x), z: round(p.z) })
    }
  }
  // the aisles the coarse grid misses: nodes along every bank's edges (indoors the courts stand
  // two metres apart; outdoors the walks between pens, past a building's corner, beside a
  // staircase), and along buildings' and stairs' walls
  {
    const edgeNodes = (bk, offs, spacing, pad) => {
      const u = { x: bk.ux, z: bk.uz }
      const w = { x: -bk.uz, z: bk.ux }
      for (const [n, half, t, tHalf] of [
        [u, bk.hx, w, bk.hz],
        [{ x: -u.x, z: -u.z }, bk.hx, w, bk.hz],
        [w, bk.hz, u, bk.hx],
        [{ x: -w.x, z: -w.z }, bk.hz, u, bk.hx],
      ]) {
        for (const off of offs) {
          const steps = Math.max(1, Math.round((2 * (tHalf + off)) / spacing))
          for (let k = 0; k <= steps; k++) {
            const s = -(tHalf + off) + (2 * (tHalf + off) * k) / steps
            const p = add(add({ x: bk.cx, z: bk.cz }, n, half + off), t, s)
            const q = { x: round(p.x), z: round(p.z) }
            if (inBounds(q) && !solidFinal(q, pad) && !insideBuilding(q)) nav.push(q)
          }
        }
      }
    }
    for (const bk of bankBoxes) edgeNodes(bk, indoor ? [0.6, 0.9] : [1.0, 1.8], indoor ? 2 : 3, indoor ? 0.34 : 0.45)
    if (!indoor) for (const bx of extraBoxes) if (!bx.y0 && (bx.kind === "building" || bx.kind === "stairs" || bx.kind === "room" || bx.kind === "wall") && Math.max(bx.hx, bx.hz) > 1.2) edgeNodes(bx, [0.9], 3, 0.45)
  }
  // inside the rooms (a finer grid) and through every doorway, both sides
  for (const r of rooms) {
    // (the walking graph is the ground floor's: the regulars don't go upstairs)
    if ((r.y || 0) > 0.5) continue
    // (small rooms every 1.25 m; big halls coarser, up to 4 m)
    const xs = r.p.map((q) => q[0])
    const zs = r.p.map((q) => q[1])
    const step = Math.max(1.25, Math.min(4, Math.sqrt((Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs))) / 10))
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step)
      for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
        const p = { x: round(x), z: round(z) }
        if (pointInPoly(p, r.p) && !solidFinal(p, 0.4)) nav.push(p)
      }
  }
  for (const d of allDoors) {
    if ((d.y || 0) > 0.5) continue
    const host = doorHosts.find((poly) => gapsOn(poly).includes(d))
    if (!host) continue
    let best = null
    host.forEach((q, i) => {
      const a = { x: q[0], z: q[1] }
      const b = { x: host[(i + 1) % host.length][0], z: host[(i + 1) % host.length][1] }
      const dd = segDist(d, a, b)
      if (!best || dd < best.dd) best = { dd, n: { x: -(b.z - a.z) / (len(sub(b, a)) || 1), z: (b.x - a.x) / (len(sub(b, a)) || 1) } }
    })
    for (const k of [-1.1, 0, 1.1]) {
      const p = { x: round(d.x + best.n.x * k), z: round(d.z + best.n.z * k) }
      if (!solidFinal(p, 0.3)) nav.push(p)
    }
  }
  for (const h of halls) {
    // through each door
    const d = h.doorAt
    const c = centroid(h.p)
    const inward = sub(c, d)
    const L = len(inward) || 1
    for (const k of [-2.5, 2.5]) nav.push({ x: round(d.x + (inward.x / L) * k), z: round(d.z + (inward.z / L) * k) })
  }
  // (one node per 0.8 m: the edge nodes, the grid and the rooms' nodes overlap)
  {
    const seen = new Set()
    const kept = []
    for (const p of nav) {
      const k = `${Math.round(p.x / 0.8)},${Math.round(p.z / 0.8)}`
      if (seen.has(k)) continue
      seen.add(k)
      kept.push(p)
    }
    nav.length = 0
    nav.push(...kept)
  }
  // spots the regulars wander to: spread out, mostly near the live courts and the bar
  const waypoints = []
  const near = nav.filter((p) => layoutCourts.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 32) || (bar && Math.hypot(bar.x - p.x, bar.z - p.z) < 10))
  const pool = near.length > 10 ? near : nav
  for (let k = 0; k < Math.min(24, pool.length); k++) {
    // farthest-point sampling from the ones picked so far
    let best = null
    let bestD = -1
    for (let t = 0; t < 40; t++) {
      const p = pool[Math.floor(rand() * pool.length)]
      const d = waypoints.length ? Math.min(...waypoints.map((q) => Math.hypot(q.x - p.x, q.z - p.z))) : 1
      if (d > bestD) {
        bestD = d
        best = p
      }
    }
    waypoints.push(best)
  }

  // ---------- fences to draw ----------
  // each bank's perimeter (gates left open), dividers between courts; OSM fences that aren't
  // a bank's own (more than 4 m from every bank)
  const fenceH = spec.fence?.height || 3
  const style = indoor ? "none" : spec.fence?.style || "chainlink"
  const gatesOn = new Map() // bank -> [{ x, z }]
  for (const lc of [...layoutCourts, ...(machine ? [{ ...machine.s, x: machine.c.x, z: machine.c.z, bankOf: machine.c.bank }] : [])]) {
    const bank = lc.bankOf ?? courts[lc.src]?.bank
    const fenceDist = Math.abs(dot(lc.out, { x: Math.sin(lc.rot), z: Math.cos(lc.rot) })) > 0.7 ? lc.hx : lc.hz
    const g = add(add({ x: lc.x, z: lc.z }, lc.out, fenceDist), { x: lc.out.z, z: -lc.out.x }, lc.gate)
    if (!gatesOn.has(bank)) gatesOn.set(bank, [])
    gatesOn.get(bank).push(g)
  }
  const fences = []
  // fence types measured at a venue (fence.types: { name: { h, ... } }, drawn by build.js
  // fenceSide): the pens' perimeter (fence.perimeter, or fence.sides: the side nearest a point),
  // partitions placed by hand (fence.partitions) or between the pairs of courts
  // (fence.pairDividers). Venues without types build as before.
  const types = spec.fence?.types || null
  const typeH = (t) => types?.[t]?.h ?? fenceH
  const sideType = (a, b) => {
    for (const s of spec.fence?.sides || []) {
      const ab = sub(b, a)
      const L = len(ab) || 1
      const t = dot(sub(s, a), ab) / (L * L)
      const off = Math.abs((s.x - a.x) * ab.z - (s.z - a.z) * ab.x) / L
      if (t > -0.05 && t < 1.05 && off < 4) return s.t
    }
    return spec.fence?.perimeter || null
  }
  if (style !== "none") {
    // (fence.chamfer: the pens' corners cut at 45 degrees, legs this long, as the aerials show
    // at Whittier Narrows and the Paseo Club; a pen too small for it keeps square corners)
    const chamfer = spec.fence?.chamfer || 0
    banks.forEach((bank) => {
      const cs = corners(bank.box)
      const gs = gatesOn.get(bank.i) || []
      const c = chamfer > 0 && Math.min(bank.box.hx, bank.box.hz) * 2 > chamfer * 4 ? chamfer : 0
      for (let k = 0; k < 4; k++) {
        const a0 = cs[k]
        const b0 = cs[(k + 1) % 4]
        const L0 = len(sub(b0, a0))
        const u = { x: (b0.x - a0.x) / L0, z: (b0.z - a0.z) / L0 }
        const a = add(a0, u, c)
        const b = add(b0, u, -c)
        const ab = sub(b, a)
        const L = len(ab)
        const gates = gs
          .map((g) => {
            const t = dot(sub(g, a), ab) / (L * L)
            const off = Math.abs((g.x - a.x) * ab.z - (g.z - a.z) * ab.x) / L
            return off < 0.2 && t > 0 && t < 1 ? t * L : null
          })
          .filter((t) => t !== null)
        const ft = types && bank.s === "p" ? sideType(a0, b0) : null
        // (fence.openings: a gap in the pen's fence with no gate, e.g. into a shade alcove)
        const opens = (spec.fence?.openings || [])
          .map((o) => {
            const t = dot(sub(o, a), ab) / (L * L)
            const off = Math.abs((o.x - a.x) * ab.z - (o.z - a.z) * ab.x) / L
            return off < 1 && t > 0 && t < 1 ? { at: round(t * L), w: o.w } : null
          })
          .filter(Boolean)
        fences.push({ a: [round(a.x), round(a.z)], b: [round(b.x), round(b.z)], h: ft ? typeH(ft) : fenceH, k: "chain", gates, ...(ft ? { t: ft } : {}), ...(opens.length ? { opens } : {}) })
        if (c) {
          // the cut corner: from this side's end to the next side's start
          const n0 = cs[(k + 2) % 4]
          const L1 = len(sub(n0, b0)) || 1
          const nb = add(b0, { x: (n0.x - b0.x) / L1, z: (n0.z - b0.z) / L1 }, c)
          fences.push({ a: [round(b.x), round(b.z)], b: [round(nb.x), round(nb.z)], h: fenceH, k: "chain", gates: [] })
        }
      }
      // partitions between the pairs of courts (fence.pairDividers: { t, gap, reach }): between
      // side-by-side neighbours whose sidelines are more than `gap` m apart (a pair's two courts
      // stand closer and share no partition), from the pen's fence at a row's outer end to
      // `reach` m past the baseline on the aisle side
      const pd = spec.fence?.pairDividers
      // (pd.only: just the banks holding one of these points, e.g. the village's two blocks)
      if (pd && bank.s === "p" && (!pd.only || pd.only.some((p) => inBox(bank.box, p)))) {
        const u = { x: bank.box.ux, z: bank.box.uz }
        const cu0 = dot({ x: bank.box.cx, z: bank.box.cz }, u)
        const [u0, u1] = [cu0 - bank.box.hx, cu0 + bank.box.hx]
        const list = bank.courts
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) {
            const A = list[i]
            const Bc = list[j]
            const d = sub(Bc, A)
            const across = Math.abs(dot(d, A.w))
            if (Math.abs(dot(d, u)) > 1 || across - A.W > A.W + 2.5) continue
            // (the nearest neighbour across only: no court between them)
            if (list.some((C) => C !== A && C !== Bc && Math.abs(dot(sub(C, A), u)) < 1 && dot(sub(C, A), A.w) * dot(d, A.w) > 0 && Math.abs(dot(sub(C, A), A.w)) < across)) continue
            if (across - A.W <= (pd.gap ?? 2.8)) continue
            const m = add(A, d, 0.5)
            const cu = dot(A, u)
            const reach = pd.reach ?? bank.room.u
            const lo = cu - A.L / 2 - bank.room.u - 0.5 <= u0 ? u0 : cu - A.L / 2 - reach
            const hi = cu + A.L / 2 + bank.room.u + 0.5 >= u1 ? u1 : cu + A.L / 2 + reach
            const mu = dot(m, u)
            const pa = add(m, u, lo - mu)
            const pb = add(m, u, hi - mu)
            fences.push({ a: [round(pa.x), round(pa.z)], b: [round(pb.x), round(pb.z)], h: typeH(pd.t), k: "chain", gates: [], t: pd.t, part: [A.i, Bc.i] })
          }
      }
      // dividers between neighbouring courts (tennis: full fences; pickleball: low windscreens)
      const div = spec.fence?.dividers ?? (bank.s === "t" ? "fence" : "low")
      if (div === "none") return
      const list = bank.courts
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const A = list[i]
          const Bc = list[j]
          const d = sub(Bc, A)
          const along = dot(d, A.u)
          const across = dot(d, A.w)
          // side by side (sharing a sideline gap)
          if (Math.abs(along) < 1 && Math.abs(across) < A.W + bank.room.w * 2 + 3.9) {
            const m = add(A, d, 0.5)
            const half = A.L / 2 + bank.room.u * (div === "fence" ? 1 : 0.4)
            fences.push({ a: [round(m.x - A.u.x * half), round(m.z - A.u.z * half)], b: [round(m.x + A.u.x * half), round(m.z + A.u.z * half)], h: div === "fence" ? fenceH : 0.9, k: div === "fence" ? "chain" : "screen", gates: [] })
          }
        }
    })
  } else if (indoor) {
    // nets between indoor courts (side by side), and a low barrier behind each baseline row
    banks.forEach((bank) => {
      const list = bank.courts
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const A = list[i]
          const Bc = list[j]
          const d = sub(Bc, A)
          if (Math.abs(dot(d, A.u)) < 1 && Math.abs(dot(d, A.w)) < A.W + 5.5) {
            const m = add(A, d, 0.5)
            const half = A.L / 2 + 2.4
            fences.push({ a: [round(m.x - A.u.x * half), round(m.z - A.u.z * half)], b: [round(m.x + A.u.x * half), round(m.z + A.u.z * half)], h: 1.0, k: "net", gates: [] })
          } else if (Math.abs(dot(d, A.w)) < 1 && Math.abs(dot(d, A.u)) < A.L + 7) {
            // end to end: a divider across, between the baselines
            const m = add(A, d, 0.5)
            const half = A.W / 2 + 1.2
            fences.push({ a: [round(m.x - A.w.x * half), round(m.z - A.w.z * half)], b: [round(m.x + A.w.x * half), round(m.z + A.w.z * half)], h: 1.0, k: "net", gates: [] })
          }
        }
    })
  }
  // partitions placed by hand (from the aerial and photos): fence.partitions [{ a, b, t }]
  for (const p of spec.fence?.partitions || []) fences.push({ a: p.a, b: p.b, h: typeH(p.t), k: "chain", gates: [], t: p.t, part: "hand" })
  for (const f of spec.fences || []) {
    const pts = f.p.map(([x, z]) => ({ x, z }))
    const nearBank = pts.some((p) => banks.some((b) => inBox(b.box, p, 4)))
    if (nearBank) continue
    for (let k = 0; k < pts.length - 1; k++) fences.push({ a: [pts[k].x, pts[k].z], b: [pts[k + 1].x, pts[k + 1].z], h: f.h || (f.k === "wall" || f.k === "retaining_wall" ? 1.6 : f.k === "hedge" ? 1.4 : 2), k: f.k === "hedge" ? "hedge" : f.k === "wall" || f.k === "retaining_wall" ? "wall" : "chain", gates: [] })
  }

  // ---------- the layout spec (layout.js makeLayout) and the scenery (build.js) ----------
  const layoutSpec = {
    id: spec.id,
    name: spec.name,
    short: spec.short || spec.name,
    kind: "venue",
    indoor,
    bounds,
    courts: layoutCourts,
    machine: machine ? { x: machine.c.x, z: machine.c.z, ...machine.s } : null,
    booth,
    spawn: { x: round(spawnAt.x), z: round(spawnAt.z), yaw: spawnYaw },
    fountain: null,
    board: null,
    benches,
    trees: trees.filter((t) => inBounds(t, -2)).map((t) => ({ x: t.x, z: t.z, s: t.s, r: t.kind === "palm" || t.kind === "fanpalm" ? 0.28 : 0.35, kind: t.kind })),
    lights,
    seats,
    circles: [...extraCircles, ...propCircles],
    penBoxes: false,
    boxes: allBoxes,
    waypoints,
    nav,
    navLink: STEP * 1.5 + 0.1,
    // floors above the ground (layout.js heightAt): rooftop terraces, mezzanines, their stairs
    decks: decks.map((d) => ({ y: d.y, p: d.p })),
    stairs: stairs.map((s) => ({ a: s.a, b: s.b, w: s.w, y0: s.y0, y1: s.y1 })),
    scene: {
      kind: "venue",
      id: spec.id,
      name: spec.name,
      indoor,
      lit: !!spec.lit,
      colors,
      backdrop: spec.backdrop || {},
      // the real surroundings and skyline (tools/venues/surround.mjs, horizon.py; docs/venue-provenance.md)
      surround: spec.surround || null,
      horizon: spec.horizon || null,
      ...(spec.terrain ? { terrain: spec.terrain } : {}),
      light: spec.light || null,
      groundStyle: spec.groundStyle || null,
      palettes: spec.palettes || [],
      fence: spec.fence || {},
      courts: courts.map((c) => ({ x: c.x, z: c.z, rot: c.rot, s: c.s, pb: c.pb, pl: c.pl, col: c.col, L: c.L, W: c.W, live: layoutCourts.find((lc) => lc.src === c.i)?.id ?? null, machine: machine?.c === c, num: c.num || null, lit: c.lit })),
      banks: banks.map((b) => ({ ...b.box, s: b.s })),
      fences,
      buildings: spec.buildings || [],
      // roof-only parts over a building drawn without its own roof (scenery.js; never solid)
      roofs: spec.roofs || [],
      areas: spec.areas || [],
      roads: spec.roads || [],
      trees,
      lamps: spec.lamps || [],
      halls,
      rooms: rooms.map((r) => ({ ...r, doors: (r.doors || []).map((d) => ({ x: d.x, z: d.z, w: d.w || 1.8, kind: d.kind || "open", ...(r.y ? { y: r.y } : {}) })) })),
      props: venueProps,
      doors: allDoors,
      decks,
      stairs,
      bar,
      extras: spec.extras || null,
    },
  }
  // every live court must be reachable on foot from the entrance (and the ball machine):
  // the ones that aren't are swapped for others
  if (!opts.noCheck) {
    const L = makeLayout(layoutSpec)
    const reach = (to) => {
      let at = L.SPAWN
      for (const p of L.route(L.SPAWN, to)) {
        if (L.segmentHit(at, p, 0) !== null) return false
        at = p
      }
      return true
    }
    const bad = [...L.COURTS.filter((c) => !reach(c.outside)).map((c) => layoutCourts[L.COURTS.indexOf(c)].src), ...(L.MACHINE_COURT && !reach({ x: L.MACHINE_COURT.gate.x + L.MACHINE_COURT.out.x, z: L.MACHINE_COURT.gate.z + L.MACHINE_COURT.out.z }) ? [machine.c.i] : [])]
    if (bad.length && (opts.tries || 0) < 16) return generateVenue(spec, { ...opts, exclude: [...exclude, ...bad], tries: (opts.tries || 0) + 1 })
  }
  return { layoutSpec, info: { banks: banks.length, live: layoutCourts.length, courts: courts.length, pickleball: pbCourts.length, exclude: [...exclude] } }
}
