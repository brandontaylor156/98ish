// My Park: you can always see yourself (pure; Node-tested in venues.test.js).
//
// The owner (2026-10-09): "Why when you go under things you can no longer see your character
// ... IF YOU GO UNDER SOMETHING LIKE A TENT, ACCOUNT FOR IT." Roofs over the open ground (a
// deck you can walk under, a pergola, a shade roof, a tent, a cabana, an awning, a solar
// canopy, a porch's roof) are "overheads": each is drawn as its own group (scenery.js) and
// faded out while you stand under it or while it's between the camera and you (or, watching,
// between the camera and the court). The follow camera also stays under a low one.
//
// overheadsOf(scene) -> [{ id, kind, polys: [[[x, z]...]], y0, y1, walk }]: walk = people walk
//   on top of it (a deck): never faded for someone standing on it.
// cutSet(overs, cam, targets, me) -> Set of ids that block: me (walker: { x, y, z }) under it,
//   or the line from the camera to any target point ({ x, y, z }) through it.
// ceilingOver(overs, me) -> the lowest overhead's underside over your head, or null.

const inPoly = (x, z, p) => {
  let inside = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i]
    const [xj, zj] = p[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
const rect = (cx, cz, w, d, yaw = 0) => {
  // (yaw: the object's rotation.y in three.js; local x -> world (cos, -sin))
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [cx + u * c + v * s, cz - u * s + v * c])
}
const grow = (p, by) => {
  // (outward from the middle by `by` m: eaves, a tent's slope)
  const cx = p.reduce((a, q) => a + q[0], 0) / p.length
  const cz = p.reduce((a, q) => a + q[1], 0) / p.length
  return p.map(([x, z]) => {
    const d = Math.hypot(x - cx, z - cz) || 1
    return [x + ((x - cx) / d) * by, z + ((z - cz) / d) * by]
  })
}
const rectOfPoly = (p) => {
  // the scenery's rectOf: the long edge's axis, the extent along it and across
  let best = null
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (!best || L > best.L) best = { L, ux: (b[0] - a[0]) / L, uz: (b[1] - a[1]) / L }
  }
  const { ux, uz } = best
  let u0 = Infinity
  let u1 = -Infinity
  let w0 = Infinity
  let w1 = -Infinity
  for (const [x, z] of p) {
    const u = x * ux + z * uz
    const w = -x * uz + z * ux
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u)
    w0 = Math.min(w0, w)
    w1 = Math.max(w1, w)
  }
  return { ux, uz, u0, u1, w0, w1 }
}

// every roof over open ground, with the id scenery.js gives its group
export const overheadsOf = (S) => {
  const out = []
  ;(S.extras || []).forEach((x, i) => {
    const id = `extra:${i}`
    const a = ((x.deg || 0) * Math.PI) / 180
    const ry = -a
    if (x.type === "cabana") out.push({ id, kind: x.type, polys: [rect(x.x, x.z, (x.w || 4) + 0.4, (x.d || x.w || 4) + 0.4)], y0: 2.55, y1: 2.75 })
    else if (x.type === "gazebo") {
      const r = Math.max(x.w || 4, x.d || x.w || 4) * 0.75
      out.push({ id, kind: x.type, polys: [rect(x.x, x.z, 2 * r, 2 * r)], y0: 2.6, y1: 4.2 })
    } else if (x.type === "canopy") {
      const r = (x.w || 3) * 0.72
      out.push({ id, kind: x.type, polys: [rect(x.x, x.z, 1.42 * r, 1.42 * r)], y0: 2.4, y1: 3.1 })
    } else if (x.type === "umbrellas") {
      const n = x.n || 4
      const polys = []
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2
        polys.push(rect(x.x + Math.cos(ang) * (x.r || 4) * 0.6, x.z + Math.sin(ang) * (x.r || 4) * 0.6, 2.6, 2.6))
      }
      out.push({ id, kind: x.type, polys, y0: (x.y || 0) + 2.15, y1: (x.y || 0) + 2.65 })
    } else if (x.type === "sail") out.push({ id, kind: x.type, polys: [rect(x.x, x.z, x.w || 10, x.d || 8)], y0: 2.8, y1: 3.6 })
    else if (x.type === "solar") {
      const D = x.d || 20
      out.push({ id, kind: x.type, polys: [rect(x.x, x.z, x.w || 30, D, ry)], y0: (x.h || 3.6) - D * 0.07, y1: (x.h || 3.6) + D * 0.07 })
    } else if (x.type === "pergola" && x.poly?.length >= 3) {
      const h = x.h || 2.9
      out.push({ id, kind: x.type, polys: [x.roof === "tile" ? grow(x.poly, 0.3) : x.poly], y0: h - 0.25, y1: x.roof === "tile" ? h + (x.rise ?? 1.2) : h + 0.2 })
    } else if (x.type === "shade" && x.poly?.length >= 3) {
      const h = x.h || 3.2
      const { ux, uz, u0, u1, w0, w1 } = rectOfPoly(x.poly)
      const um = (u0 + u1) / 2
      const wm = (w0 + w1) / 2
      out.push({ id, kind: x.type, polys: [rect(um * ux - wm * uz, um * uz + wm * ux, u1 - u0 + 0.5, w1 - w0 + 0.5, -Math.atan2(uz, ux))], y0: h - (x.fall || 0) / 2 - 0.05, y1: h + (x.fall || 0) / 2 + 0.15 })
    } else if (x.type === "awnings") out.push({ id, kind: x.type, polys: [rect(x.x, x.z, x.w || 10, 1.4, ry)], y0: 2.6, y1: 3.0 })
  })
  ;(S.decks || []).forEach((d, i) => {
    if (d.drawnBy) return
    // (the floor, its fascia below and its railing above)
    out.push({ id: `deck:${i}`, kind: "deck", polys: [d.p], y0: d.y - 0.45, y1: d.y + 1.1, walk: d.y })
  })
  // stairs: a flight between the lens and you (a lobby's stair up to the ballroom) fades too,
  // never the one you're on
  ;(S.stairs || []).forEach((st, i) => {
    const a = Array.isArray(st.a) ? { x: st.a[0], z: st.a[1] } : st.a
    const b = Array.isArray(st.b) ? { x: st.b[0], z: st.b[1] } : st.b
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1
    const ux = (b.x - a.x) / L
    const uz = (b.z - a.z) / L
    const w = (st.w || 1.6) / 2 + 0.15
    const poly = [[a.x - uz * w, a.z + ux * w], [b.x - uz * w, b.z + ux * w], [b.x + uz * w, b.z - ux * w], [a.x + uz * w, a.z - ux * w]]
    out.push({ id: `stairs:${i}`, kind: "stairs", polys: [poly], y0: st.y0 || 0, y1: st.y1 + 1.0, ramp: { ax: a.x, az: a.z, ux, uz, L, y0: st.y0 || 0, y1: st.y1 } })
  })
  ;(S.roofs || []).forEach((r, i) => {
    if (r.p?.length >= 3) out.push({ id: `roof:${i}`, kind: "roof", polys: [grow(r.p, 0.4)], y0: (r.y0 ?? r.h) - 0.1, y1: r.h + (r.rise || 3) })
  })
  for (const o of out) {
    const xs = o.polys.flat().map((q) => q[0])
    const zs = o.polys.flat().map((q) => q[1])
    o.bb = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }
  }
  return out
}

const inOver = (o, x, z) => x >= o.bb.x0 && x <= o.bb.x1 && z >= o.bb.z0 && z <= o.bb.z1 && o.polys.some((p) => inPoly(x, z, p))
// standing on it (a deck you're up on): never in your way
const onTop = (o, me) => (o.walk !== undefined && (me.y || 0) > o.walk - 0.6) || (o.ramp && (me.y || 0) > 0.05 && inOver(o, me.x, me.z))
// does the segment a -> b pass through the overhead's slab (y0..y1 over its footprint)?
const crosses = (o, a, b) => {
  const lo = Math.min(a.y, b.y)
  const hi = Math.max(a.y, b.y)
  if (hi < o.y0 || lo > o.y1) return false
  // (quick reject: both ends off the same side of its box)
  if ((a.x < o.bb.x0 && b.x < o.bb.x0) || (a.x > o.bb.x1 && b.x > o.bb.x1) || (a.z < o.bb.z0 && b.z < o.bb.z0) || (a.z > o.bb.z1 && b.z > o.bb.z1)) return false
  // the part of the segment inside the slab's heights
  let t0 = 0
  let t1 = 1
  const dy = b.y - a.y
  if (Math.abs(dy) > 1e-6) {
    const ta = (o.y0 - a.y) / dy
    const tb = (o.y1 - a.y) / dy
    t0 = Math.max(0, Math.min(ta, tb))
    t1 = Math.min(1, Math.max(ta, tb))
    if (t0 > t1) return false
  }
  const n = Math.max(2, Math.ceil((Math.hypot(b.x - a.x, b.z - a.z) * (t1 - t0)) / 0.5))
  for (let k = 0; k <= n; k++) {
    const t = t0 + ((t1 - t0) * k) / n
    const x = a.x + (b.x - a.x) * t
    const z = a.z + (b.z - a.z) * t
    if (!inOver(o, x, z)) continue
    if (!o.ramp) return true
    // (a flight of stairs: solid from the steps down, its handrail a metre up)
    const r = o.ramp
    const f = Math.max(0, Math.min(1, ((x - r.ax) * r.ux + (z - r.az) * r.uz) / r.L))
    const y = a.y + (b.y - a.y) * t
    if (y <= r.y0 + (r.y1 - r.y0) * f + 1.0) return true
  }
  return false
}

export const cutSet = (overs, cam, targets = [], me = null) => {
  const out = new Set()
  for (const o of overs) {
    if (me && onTop(o, me)) continue
    if (me && o.y0 > (me.y || 0) + 1.2 && inOver(o, me.x, me.z)) {
      out.add(o.id)
      continue
    }
    if (cam.y >= o.y0 && cam.y <= o.y1 && inOver(o, cam.x, cam.z)) {
      out.add(o.id)
      continue
    }
    for (const t of targets)
      if (crosses(o, cam, t)) {
        out.add(o.id)
        break
      }
  }
  return out
}

export const ceilingOver = (overs, me) => {
  let best = null
  for (const o of overs) {
    if (onTop(o, me) || o.y0 <= (me.y || 0) + 1.2 || !inOver(o, me.x, me.z)) continue
    if (best === null || o.y0 < best) best = o.y0
  }
  return best
}

// Windscreens and walls along the fences (the pens' black screens, a wall): solid to the eye
// though the walkers' collision treats a pen as one box. The follow camera keeps on your side
// of them (or over them) and the watch camera finds a spot they don't block.
// -> [{ ax, az, bx, bz, y0, y1, bb }]
export const screensOf = (S) => {
  const out = []
  const types = S.fence?.types || {}
  const defH = S.fence?.screen === false ? 0 : S.fence?.screenH ?? 1.15
  for (const f of S.fences || []) {
    let y0 = 0
    let y1 = 0
    const T = f.t ? types[f.t] : null
    if (f.k === "chain") {
      if (T) {
        if (!T.screen) continue
        y0 = T.screen.y0 ?? 0
        y1 = Math.min(T.h ?? f.h ?? 3, T.screen.y1 ?? T.h ?? 3)
      } else {
        y1 = Math.min(defH, f.h ?? 3)
      }
    } else if (f.k === "screen" || f.k === "wall" || f.k === "retaining_wall") y1 = f.h ?? 1.6
    else continue
    if (y1 - y0 < 0.6) continue
    const [ax, az] = f.a
    const [bx, bz] = f.b
    out.push({ ax, az, bx, bz, y0, y1, bb: { x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz) } })
  }
  return out
}
// the first screen the 3D segment a -> b runs into -> { t, h } (as layout.segmentHit3) or null
export const screenHit = (screens, a, b, pad = 0.12) => {
  let best = null
  const dx = b.x - a.x
  const dz = b.z - a.z
  for (const s of screens) {
    if ((a.x < s.bb.x0 - pad && b.x < s.bb.x0 - pad) || (a.x > s.bb.x1 + pad && b.x > s.bb.x1 + pad) || (a.z < s.bb.z0 - pad && b.z < s.bb.z0 - pad) || (a.z > s.bb.z1 + pad && b.z > s.bb.z1 + pad)) continue
    const ex = s.bx - s.ax
    const ez = s.bz - s.az
    const den = dx * ez - dz * ex
    if (Math.abs(den) < 1e-9) continue
    const t = ((s.ax - a.x) * ez - (s.az - a.z) * ex) / den
    const u = ((s.ax - a.x) * dz - (s.az - a.z) * dx) / den
    const L = Math.hypot(ex, ez) || 1
    if (t < 0 || t > 1 || u < -pad / L || u > 1 + pad / L) continue
    const y = a.y + (b.y - a.y) * t
    if (y < s.y0 || y > s.y1 + pad) continue
    if (!best || t < best.t) best = { t: Math.max(0, t - pad / (Math.hypot(dx, dz) || 1)), h: s.y1 }
  }
  return best
}

// a trunk or a pole (layout CIRCLES: x, z, r) in the way of the 3D segment a -> b (both ends
// below `top`) -> { t, h } or null; the follow camera won't sit with a tree trunk filling the lens
export const poleHit = (circles, a, b, pad = 0.15, top = 6) => {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const L2 = dx * dx + dz * dz
  if (L2 < 1e-9) return null
  let best = null
  for (const c of circles) {
    const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.z - a.z) * dz) / L2))
    if (Math.hypot(a.x + dx * t - c.x, a.z + dz * t - c.z) >= c.r + pad) continue
    if (a.y + (b.y - a.y) * t > top) continue
    if (!best || t < best.t) best = { t: Math.max(0, t - (c.r + pad) / Math.sqrt(L2)), h: top + 10 }
  }
  return best
}

// does the 3D segment a -> b pass through a solid box (layout BOXES) other than a pen (a pen's
// box is its chain-link outline: see-through)?
export const solidHit = (boxes, a, b) => {
  for (const B of boxes) {
    if (B.kind === "pen") continue
    const ua = (a.x - B.cx) * B.ux + (a.z - B.cz) * B.uz
    const wa = -(a.x - B.cx) * B.uz + (a.z - B.cz) * B.ux
    const ub = (b.x - B.cx) * B.ux + (b.z - B.cz) * B.uz
    const wb = -(b.x - B.cx) * B.uz + (b.z - B.cz) * B.ux
    let t0 = 0
    let t1 = 1
    let out = false
    for (const [p0, p1, lo, hi] of [[ua, ub, -B.hx, B.hx], [wa, wb, -B.hz, B.hz], [a.y, b.y, B.y0 || 0, B.h]]) {
      const d = p1 - p0
      if (Math.abs(d) < 1e-9) {
        if (p0 < lo || p0 > hi) out = true
      } else {
        let ta = (lo - p0) / d
        let tb = (hi - p0) / d
        if (ta > tb) [ta, tb] = [tb, ta]
        t0 = Math.max(t0, ta)
        t1 = Math.min(t1, tb)
      }
      if (out || t0 > t1) break
    }
    if (!out && t0 <= t1) return true
  }
  return false
}

// the points on a walker the camera should see (feet, middle, head)
export const bodyPoints = (me) => {
  const y = me.y || 0
  return [
    { x: me.x, y: y + 0.15, z: me.z },
    { x: me.x, y: y + 1.0, z: me.z },
    { x: me.x, y: y + 1.65, z: me.z },
  ]
}

// fading: one number a group, 1 shown .. 0 gone, eased (about a fifth of a second)
export const stepFades = (fades, blocking, ids, dt) => {
  const k = 1 - Math.exp(-dt * 10)
  for (const id of ids) {
    const want = blocking.has(id) ? 0 : 1
    const a = fades.get(id) ?? 1
    const next = Math.abs(want - a) < 0.02 ? want : a + (want - a) * k
    fades.set(id, next)
  }
  return fades
}
