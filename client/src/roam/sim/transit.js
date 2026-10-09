// Roam: buses and trains on the map's own routes (transit.json, nav/navdata.js buildTransit).
// Pure; Node-tested (transport.test.js). The owner: "take the bus, take the train".
//
// A route runs to a timetable worked out from its own line: a bus leaves the start of its route
// every HEADWAY seconds, drives the route at a steady city pace (easing in and out of each stop),
// waits DWELL seconds at each mapped stop and is gone at the end; trains the same at railway
// pace, both ways along the line, stopping at the stations. Where every bus and train is at a
// moment comes from the clock alone, so it's the same in every browser (the game's own pace:
// a bus every two and a half minutes, not the real timetable). Only the ones near you are drawn.

import { cumOf, projectLine } from "../nav/navdata.js"

export const BUS = { speed: 10.5, dwell: 14, headway: 150, lane: 1.9 }
export const TRAIN = { speed: 24, dwell: 22, headway: 240, cars: 4, carLen: 26 }

const unflat = (a) => {
  const out = []
  for (let i = 0; i + 1 < a.length; i += 2) out.push({ x: a[i], z: a[i + 1] })
  return out
}
// a line's start offset in the timetable, from its id (so routes don't all leave together)
const phase = (id, headway) => (((Number(id) || 7) * 2654435761) % 1e6) / 1e6 * headway

// a route's timetable: stops at s, the time it arrives at and leaves each
const timetable = (len, stops, speed, dwell) => {
  const arr = []
  const dep = []
  let t = 0
  let s = 0
  for (const st of stops) {
    t += Math.max(0, st.s - s) / speed
    arr.push(t)
    t += dwell
    dep.push(t)
    s = st.s
  }
  const end = t + Math.max(0, len - s) / speed
  return { arr, dep, end }
}

// transit.json -> { buses: [line], trains: [line] }; a line: { id, kind, ref, name, to, pts, cum,
// len, stops: [{ name, s, x, z }], tt, headway, speed, dwell }
export const loadTransit = (json) => {
  const line = (r, kind, back = false) => {
    let pts = unflat(r.path || [])
    if (pts.length < 2) return null
    if (back) pts = pts.slice().reverse()
    const cum = cumOf(pts)
    const len = cum[cum.length - 1]
    const P = kind === "bus" ? BUS : TRAIN
    const raw = kind === "bus" ? r.stops : r.stations
    const stops = (raw || []).map(([name, s]) => ({ name, s: back ? len - s : s })).sort((a, b) => a.s - b.s)
    for (const st of stops) {
      const p = at(pts, cum, st.s)
      st.x = p.x
      st.z = p.z
    }
    return { id: `${kind}${r.id}${back ? "b" : ""}`, kind, ref: r.ref || "", name: r.name || "", to: back ? stops[stops.length - 1]?.name || r.name : r.to || stops[stops.length - 1]?.name || "", pts, cum, len, stops, tt: timetable(len, stops, P.speed, P.dwell), headway: P.headway, speed: P.speed, dwell: P.dwell, phase: phase(r.id, P.headway) + (back ? P.headway / 2 : 0) }
  }
  const buses = (json?.buses || []).map((r) => line(r, "bus")).filter((l) => l && l.stops.length >= 2)
  const trains = []
  for (const r of json?.trains || []) {
    const a = line(r, "train")
    const b = line(r, "train", true)
    if (a && a.stops.length) trains.push(a)
    if (b && b.stops.length) trains.push(b)
  }
  return { buses, trains, stations: (json?.stations || []).map(([name, x, z]) => ({ name, x, z })) }
}

// a point s metres along a line, with its heading
export const at = (pts, cum, s) => {
  const t = Math.max(0, Math.min(cum[cum.length - 1], s))
  let i = 0
  while (i < cum.length - 2 && cum[i + 1] < t) i++
  const L = cum[i + 1] - cum[i] || 1e-9
  const k = (t - cum[i]) / L
  const hx = (pts[i + 1].x - pts[i].x) / L
  const hz = (pts[i + 1].z - pts[i].z) / L
  return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, z: pts[i].z + (pts[i + 1].z - pts[i].z) * k, yaw: Math.atan2(hx, hz), hx, hz }
}

// where a trip is tau seconds after it left -> { s, stop (the stop it's waiting at) | -1, next (the next stop's index), moving } | null (not running)
export const tripAt = (l, tau) => {
  const { arr, dep, end } = l.tt
  if (tau < 0 || tau > end) return null
  const n = l.stops.length
  // (waiting at a stop)
  for (let i = 0; i < n; i++) if (tau >= arr[i] && tau < dep[i]) return { s: l.stops[i].s, stop: i, next: i, moving: false }
  // (between stops: easing out of one and into the next)
  let i0 = -1
  for (let i = 0; i < n; i++) if (tau >= dep[i]) i0 = i
  const s0 = i0 < 0 ? 0 : l.stops[i0].s
  const t0 = i0 < 0 ? 0 : dep[i0]
  const s1 = i0 + 1 < n ? l.stops[i0 + 1].s : l.len
  const t1 = i0 + 1 < n ? arr[i0 + 1] : end
  const f = Math.max(0, Math.min(1, (tau - t0) / (t1 - t0 || 1e-9)))
  const e = f - Math.sin(2 * Math.PI * f) / (2 * Math.PI)
  return { s: s0 + (s1 - s0) * e, stop: -1, next: i0 + 1, moving: true, speed: ((s1 - s0) / (t1 - t0 || 1)) * (1 - Math.cos(2 * Math.PI * f)) }
}

// the trips of a line running at time t -> [{ trip, tau }]
export const tripsAt = (l, t) => {
  const out = []
  const k1 = Math.floor((t - l.phase) / l.headway)
  for (let k = k1; k > k1 - Math.ceil(l.tt.end / l.headway) - 1; k--) {
    const tau = t - (l.phase + k * l.headway)
    if (tau >= 0 && tau <= l.tt.end) out.push({ trip: k, tau })
  }
  return out
}
// a trip's pose: on the line, buses in their lane (right of the line) -> { x, z, yaw, s, stop, next, speed }
export const tripPose = (l, tau) => {
  const q = tripAt(l, tau)
  if (!q) return null
  const p = at(l.pts, l.cum, q.s)
  const off = l.kind === "bus" ? BUS.lane : 0
  return { ...q, x: p.x - p.hz * off, z: p.z + p.hx * off, yaw: p.yaw }
}
// every bus or train near (x, z) at time t -> [{ line, trip, tau, x, z, yaw, s, stop, next }]
export const vehiclesNear = (lines, t, x, z, r) => {
  const out = []
  for (const l of lines) {
    // (a quick check: is any of the line near?)
    if (!l._box) {
      let x0 = Infinity
      let x1 = -Infinity
      let z0 = Infinity
      let z1 = -Infinity
      for (const p of l.pts) {
        x0 = Math.min(x0, p.x)
        x1 = Math.max(x1, p.x)
        z0 = Math.min(z0, p.z)
        z1 = Math.max(z1, p.z)
      }
      l._box = { x0, x1, z0, z1 }
    }
    const b = l._box
    if (x < b.x0 - r || x > b.x1 + r || z < b.z0 - r || z > b.z1 + r) continue
    for (const tr of tripsAt(l, t)) {
      const p = tripPose(l, tr.tau)
      if (p && Math.hypot(p.x - x, p.z - z) < r) out.push({ line: l, ...tr, ...p })
    }
  }
  return out
}
// the seconds until a trip of this line next waits at stop i (from time t)
export const nextAt = (l, i, t) => {
  const a = l.tt.arr[i]
  if (a === undefined) return Infinity
  // trips leave at phase + k * headway; one waits at stop i from leave + arr[i] to leave + dep[i]
  const k = Math.ceil((t - l.phase - l.tt.dep[i]) / l.headway)
  const at0 = l.phase + k * l.headway + a
  return Math.max(0, at0 - t)
}
// the stops (of any line) within r of (x, z) -> [{ line, i, stop, d }] nearest first
export const stopsNear = (lines, x, z, r = 18) => {
  const out = []
  for (const l of lines) l.stops.forEach((st, i) => {
    const d = Math.hypot(st.x - x, st.z - z)
    if (d < r && i < l.stops.length - 1) out.push({ line: l, i, stop: st, d })
  })
  return out.sort((a, b) => a.d - b.d)
}
// the nearest point of a line to (x, z)
export const nearestOnLine = (l, x, z) => projectLine(l.pts, x, z, l.cum)
// a line's label: "Bus 4 to Newhall" / "the train to Lancaster"
export const lineLabel = (l) => (l.kind === "bus" ? `Bus ${l.ref || ""}`.trim() + (l.to ? ` to ${l.to}` : "") : `Train${l.to ? ` to ${l.to}` : ""}`)
