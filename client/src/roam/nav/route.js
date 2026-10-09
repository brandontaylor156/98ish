// Roam: routes on the town's roads (nav.json, nav/navdata.js). Pure; Node-tested
// (transport.test.js). The phone's GPS (a route line on the road, turn arrows) and the ride app
// (a car that drives you there along the roads) both use it.
//
// - decodeGraph: nav.json -> nodes, edges, each node's ways out (one-ways only their way);
// - snap: the nearest point on any road (a grid of 100 m cells);
// - route: A* from a point to a point, by driving time (each class's speed), one-ways kept;
//   -> the line to drive (from the first point to the last, on the roads), its length and time,
//   and the turns (left, right, keep, arrive) with the street you turn onto.

import { NAV_SPEED, cumOf, projectLine } from "./navdata.js"

const CELL = 100

export const decodeGraph = (json) => {
  const names = json?.names || []
  const n = json?.n || []
  const nodes = []
  for (let i = 0; i + 1 < n.length; i += 2) nodes.push({ x: n[i], z: n[i + 1], out: [] })
  const edges = []
  for (const row of json?.e || []) {
    const [a, b, cls, ow, ni] = row
    if (!nodes[a] || !nodes[b]) continue
    const pts = [{ x: nodes[a].x, z: nodes[a].z }]
    let px = nodes[a].x
    let pz = nodes[a].z
    for (let i = 5; i + 1 < row.length; i += 2) {
      px += row[i]
      pz += row[i + 1]
      pts.push({ x: px, z: pz })
    }
    pts.push({ x: nodes[b].x, z: nodes[b].z })
    const cum = cumOf(pts)
    const e = { id: edges.length, a, b, cls, ow, name: names[ni] || "", pts, cum, len: cum[cum.length - 1] }
    edges.push(e)
    nodes[a].out.push({ e, to: b, fwd: true })
    if (!ow) nodes[b].out.push({ e, to: a, fwd: false })
  }
  // the grid for snapping
  const grid = new Map()
  for (const e of edges) {
    let x0 = Infinity
    let x1 = -Infinity
    let z0 = Infinity
    let z1 = -Infinity
    for (const p of e.pts) {
      x0 = Math.min(x0, p.x)
      x1 = Math.max(x1, p.x)
      z0 = Math.min(z0, p.z)
      z1 = Math.max(z1, p.z)
    }
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++)
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        const k = `${i},${j}`
        if (!grid.has(k)) grid.set(k, [])
        grid.get(k).push(e)
      }
  }
  return { nodes, edges, grid }
}

// the nearest point on a road -> { e, s (metres along e), d, x, z } | null
export const snap = (g, x, z, { maxD = 400, through = false } = {}) => {
  let best = null
  for (let r = 0; r <= Math.ceil(maxD / CELL); r++) {
    const i0 = Math.floor(x / CELL)
    const j0 = Math.floor(z / CELL)
    for (let i = i0 - r; i <= i0 + r; i++)
      for (let j = j0 - r; j <= j0 + r; j++) {
        if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r) continue
        for (const e of g.grid.get(`${i},${j}`) || []) {
          // (through: not a motorway or a ramp: somewhere a car can stop)
          if (through && (e.cls <= 1 || e.cls === 6)) continue
          const at = projectLine(e.pts, x, z, e.cum)
          if (!best || at.d < best.d) best = { e, s: at.s, d: at.d, x: at.x, z: at.z }
        }
      }
    if (best && best.d < r * CELL) break
  }
  return best && best.d <= maxD ? best : null
}

// a part of an edge's line, from s0 to s1 (either way)
export const edgePart = (e, s0, s1) => {
  const out = []
  const at = (s) => {
    const c = e.cum
    let i = 0
    while (i < c.length - 2 && c[i + 1] < s) i++
    const k = (s - c[i]) / (c[i + 1] - c[i] || 1e-9)
    return { x: e.pts[i].x + (e.pts[i + 1].x - e.pts[i].x) * k, z: e.pts[i].z + (e.pts[i + 1].z - e.pts[i].z) * k }
  }
  out.push(at(s0))
  if (s1 >= s0) {
    for (let i = 0; i < e.pts.length; i++) if (e.cum[i] > s0 && e.cum[i] < s1) out.push(e.pts[i])
  } else for (let i = e.pts.length - 1; i >= 0; i--) if (e.cum[i] < s0 && e.cum[i] > s1) out.push(e.pts[i])
  out.push(at(s1))
  return out
}

// a small binary heap of [f, item]
const heap = () => {
  const a = []
  return {
    get size() {
      return a.length
    },
    push(f, v) {
      a.push([f, v])
      let i = a.length - 1
      while (i > 0) {
        const p = (i - 1) >> 1
        if (a[p][0] <= a[i][0]) break
        ;[a[p], a[i]] = [a[i], a[p]]
        i = p
      }
    },
    pop() {
      const top = a[0]
      const last = a.pop()
      if (a.length) {
        a[0] = last
        let i = 0
        for (;;) {
          const l = i * 2 + 1
          const r = l + 1
          let m = i
          if (l < a.length && a[l][0] < a[m][0]) m = l
          if (r < a.length && a[r][0] < a[m][0]) m = r
          if (m === i) break
          ;[a[m], a[i]] = [a[i], a[m]]
          i = m
        }
      }
      return top
    },
  }
}

const speedOf = (e) => NAV_SPEED[e.cls] ?? 11
const VMAX = 29

// from (x, z) to (tx, tz) by road -> { pts, len, time, steps, from, to } | null
export const route = (g, x, z, tx, tz) => {
  const A = snap(g, x, z, { through: true }) || snap(g, x, z)
  const B = snap(g, tx, tz, { through: true }) || snap(g, tx, tz)
  if (!A || !B) return null
  // the same road, the right way: straight there
  if (A.e === B.e && (B.s >= A.s || !A.e.ow)) return finish([{ e: A.e, s0: A.s, s1: B.s }], A, B)
  const N = g.nodes.length
  const best = new Float64Array(N).fill(Infinity)
  const prev = new Array(N)
  const open = heap()
  const h = (n) => Math.hypot(g.nodes[n].x - B.x, g.nodes[n].z - B.z) / VMAX
  // leaving the start along its road, either way it allows
  const seed = (to, cost, s1) => {
    if (cost < best[to]) {
      best[to] = cost
      prev[to] = { start: true, e: A.e, s0: A.s, s1 }
      open.push(cost + h(to), to)
    }
  }
  seed(A.e.b, (A.e.len - A.s) / speedOf(A.e), A.e.len)
  if (!A.e.ow) seed(A.e.a, A.s / speedOf(A.e), 0)
  // arriving: from either end of the last road (the way it allows)
  const ends = new Map()
  ends.set(B.e.a, { s0: 0, cost: B.s / speedOf(B.e) })
  if (!B.e.ow) ends.set(B.e.b, { s0: B.e.len, cost: (B.e.len - B.s) / speedOf(B.e) })
  let found = null
  let foundCost = Infinity
  let pops = 0
  while (open.size && pops < 400000) {
    pops++
    const [f, n] = open.pop()
    if (f >= foundCost) break
    const gc = best[n]
    if (f - h(n) > gc + 1e-9) continue
    const end = ends.get(n)
    if (end && gc + end.cost < foundCost) {
      foundCost = gc + end.cost
      found = { n, end }
    }
    for (const o of g.nodes[n].out) {
      const c = gc + o.e.len / speedOf(o.e) + (o.e.cls === 6 ? 2 : 0)
      if (c < best[o.to]) {
        best[o.to] = c
        prev[o.to] = { from: n, e: o.e, fwd: o.fwd }
        open.push(c + h(o.to), o.to)
      }
    }
  }
  if (!found) return null
  const legs = [{ e: B.e, s0: found.end.s0, s1: B.s }]
  let n = found.n
  for (let guard = 0; guard < N; guard++) {
    const p = prev[n]
    if (!p) return null
    if (p.start) {
      legs.unshift({ e: p.e, s0: p.s0, s1: p.s1 })
      break
    }
    legs.unshift({ e: p.e, s0: p.fwd ? 0 : p.e.len, s1: p.fwd ? p.e.len : 0 })
    n = p.from
  }
  return finish(legs, A, B)
}

// the legs -> one line, its length and time, and the turns
const finish = (legs, A, B) => {
  const pts = []
  let time = 0
  const marks = [] // where each leg starts along the line
  for (const leg of legs) {
    const part = edgePart(leg.e, leg.s0, leg.s1)
    marks.push({ at: pts.length ? cumOf(pts).at(-1) : 0, e: leg.e })
    for (const p of part) if (!pts.length || Math.hypot(p.x - pts[pts.length - 1].x, p.z - pts[pts.length - 1].z) > 0.3) pts.push({ x: p.x, z: p.z })
    time += Math.abs(leg.s1 - leg.s0) / speedOf(leg.e)
  }
  if (pts.length < 2) pts.push({ x: B.x + 0.01, z: B.z })
  const cum = cumOf(pts)
  const len = cum[cum.length - 1]
  // turns: where the street's name changes, or the line bends more than 35 degrees at a junction
  const steps = []
  const dirAt = (s, back) => {
    const k = Math.max(0, Math.min(len, s))
    const p0 = pointAt(pts, cum, back ? k - 12 : k)
    const p1 = pointAt(pts, cum, back ? k : k + 12)
    return Math.atan2(p1.x - p0.x, p1.z - p0.z)
  }
  for (let i = 1; i < marks.length; i++) {
    const m = marks[i]
    const before = dirAt(m.at, true)
    const after = dirAt(m.at, false)
    const turn = Math.atan2(Math.sin(after - before), Math.cos(after - before))
    const renamed = m.e.name && m.e.name !== marks[i - 1].e.name
    if (Math.abs(turn) < 0.6 && !renamed) continue
    if (Math.abs(turn) < 0.6 && steps.length && steps[steps.length - 1].name === m.e.name) continue
    // (x east, z south: a heading going down is a turn to the right)
    const kind = Math.abs(turn) < 0.6 ? "keep" : turn < 0 ? "right" : "left"
    const p = pointAt(pts, cum, m.at)
    steps.push({ at: m.at, x: p.x, z: p.z, turn: kind, name: m.e.name })
  }
  steps.push({ at: len, x: pts[pts.length - 1].x, z: pts[pts.length - 1].z, turn: "arrive", name: "" })
  return { pts, cum, len, time, steps, from: { x: A.x, z: A.z, name: A.e.name }, to: { x: B.x, z: B.z, name: B.e.name } }
}

// a point s metres along a line
export const pointAt = (pts, cum, s) => {
  const t = Math.max(0, Math.min(cum[cum.length - 1], s))
  let i = 0
  while (i < cum.length - 2 && cum[i + 1] < t) i++
  const k = (t - cum[i]) / (cum[i + 1] - cum[i] || 1e-9)
  return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, z: pts[i].z + (pts[i + 1].z - pts[i].z) * k, hx: (pts[i + 1].x - pts[i].x) / (cum[i + 1] - cum[i] || 1e-9), hz: (pts[i + 1].z - pts[i].z) / (cum[i + 1] - cum[i] || 1e-9) }
}

// the next turn ahead of s -> { step, dist } | null
export const nextStep = (r, s) => {
  for (const st of r.steps) if (st.at > s + 2) return { step: st, dist: st.at - s }
  return null
}
// how far off the route (x, z) is, and where along it -> { s, d }
export const onRoute = (r, x, z) => {
  const at = projectLine(r.pts, x, z, r.cum)
  return { s: at.s, d: at.d }
}
// a turn in words: "Turn left onto McBean Parkway in 200 m"
export const stepText = (st, dist) => {
  const d = dist >= 1000 ? `${(dist / 1609.34).toFixed(1)} mi` : `${Math.max(10, Math.round(dist / 3.048) * 10)} ft`
  if (st.turn === "arrive") return `Arrive in ${d}`
  const onto = st.name ? ` onto ${st.name}` : ""
  return st.turn === "keep" ? `Continue${onto} in ${d}` : `Turn ${st.turn}${onto} in ${d}`
}
