// What really stands around a real venue, beyond its walkable crop (the spec's `surround`,
// from OpenStreetMap by tools/venues/surround.mjs; docs/venue-provenance.md). Nothing here is
// invented: mapped buildings (their mapped height, or a modest flagged default by type),
// rail bridges, and the parks, golf, woods, water and big roads painted into the far ground.
// Everything is cheap: one merged geometry for the buildings, one for the bridges, one canvas
// texture for the ground. scenery.js adds them; build.js merges them with the rest.
import * as THREE from "three"

// the far ground's colors by area kind (dry SoCal tones; the crop's own ground covers the middle)
const AREA_FILL = {
  grass: "#86955f",
  golf: "#6f9a4e",
  fairway: "#7fae55",
  green: "#8cbd5f",
  bunker: "#e2d3a6",
  wood: "#4f6b3c",
  scrub: "#8a8a5e",
  sand: "#e0d2a8",
  pitch: "#7aa457",
  water: "#4f86a8",
}

// paint the surround's areas and roads into a canvas for the far ground disc (center cx, cz;
// radius R; N pixels square). Canvas x = east, y = south (the disc's UVs, flipY on).
export const paintSurroundGround = (ctx, N, { cx, cz, R, base, surround }) => {
  const s = N / (2 * R)
  const P = ([x, z]) => [(x - cx + R) * s, (z - cz + R) * s]
  ctx.fillStyle = base
  ctx.fillRect(0, 0, N, N)
  for (const a of surround.areas || []) {
    ctx.fillStyle = AREA_FILL[a.k] || AREA_FILL.grass
    ctx.beginPath()
    a.p.forEach((pt, i) => (i ? ctx.lineTo(...P(pt)) : ctx.moveTo(...P(pt))))
    ctx.closePath()
    ctx.fill()
  }
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  for (const r of surround.roads || []) {
    ctx.strokeStyle = "#5d5f60"
    ctx.lineWidth = Math.max(1, r.w * s)
    ctx.beginPath()
    r.p.forEach((pt, i) => (i ? ctx.lineTo(...P(pt)) : ctx.moveTo(...P(pt))))
    ctx.stroke()
  }
  // building footprints darken the ground under them a touch (contact shade)
  ctx.fillStyle = "rgba(40,40,36,0.35)"
  for (const b of surround.buildings || []) {
    ctx.beginPath()
    b.p.forEach((pt, i) => (i ? ctx.lineTo(...P(pt)) : ctx.moveTo(...P(pt))))
    ctx.closePath()
    ctx.fill()
  }
}

// the ground's height (m) at x, z from the spec's terrain grid (terrain.py: decimetres above the
// courts' middle, every `step` m from -r), flat inside the crop {x0, x1, z0, z1} and blended up
// over `blend` m beyond it, so the walkable venue stays level and the hills rise round it
export const terrainSampler = (T, crop, blend = 25) => {
  if (!T?.h?.length) return () => 0
  const n = T.n
  const at = (i, j) => T.h[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))] / 10
  return (x, z) => {
    const fx = (x + T.r) / T.step
    const fz = (z + T.r) / T.step
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    const tx = fx - i
    const tz = fz - j
    const h = (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - tz) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * tz
    const d = Math.hypot(Math.max(crop.x0 - x, 0, x - crop.x1), Math.max(crop.z0 - z, 0, z - crop.z1))
    const k = Math.min(1, d / blend)
    return h * k * k * (3 - 2 * k)
  }
}

const signedArea = (p) => {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const [x0, z0] = p[i]
    const [x1, z1] = p[(i + 1) % p.length]
    a += x0 * z1 - x1 * z0
  }
  return a / 2
}

// every mapped building as a plain block: walls and a flat roof, vertex-colored (light stucco
// walls, a lighter roof; a little variety by footprint so a street isn't one flat color)
// (ground: the terrain's height at x, z, terrainSampler: a building stands on its lowest corner's
// ground, its walls going down to it. A building's r: "hip" draws a hip roof over its smallest
// rectangle (the aerial shows pitched roofs: surround-roofs.py), rc its roof colour from the
// aerial, rise its height; h stays the ridge's height above the ground, as OSM's height is)
export const surroundBuildingsGeometry = (list, ground = null) => {
  const pos = []
  const col = []
  const c = new THREE.Color()
  const push = (x, y, z, color) => {
    pos.push(x, y, z)
    col.push(color.r, color.g, color.b)
  }
  for (const b of list) {
    let p = b.p
    if (p.length < 3) continue
    if (signedArea(p) < 0) p = [...p].reverse()
    const g0 = ground ? Math.min(...p.map(([x, z]) => ground(x, z))) : 0
    const g1 = ground ? Math.max(...p.map(([x, z]) => ground(x, z))) : 0
    const rise = b.r ? Math.min(b.rise ?? 1.8, b.h * 0.45) : 0
    const h = b.h - rise + (g1 - g0)
    const k = (Math.abs(Math.round(p[0][0] * 7 + p[0][1] * 13)) % 9) / 9
    const wall = new THREE.Color().setHSL(0.09 + k * 0.03, 0.12 + k * 0.08, 0.66 + k * 0.12)
    const shade = wall.clone().multiplyScalar(0.82)
    const roof = b.rc ? new THREE.Color(b.rc) : new THREE.Color().setHSL(0.08, 0.05, 0.6 + k * 0.15)
    for (let i = 0; i < p.length; i++) {
      const [x0, z0] = p[i]
      const [x1, z1] = p[(i + 1) % p.length]
      // walls facing south/west a little darker (a cheap sense of light without normals work)
      c.copy(z1 - z0 > 0 || x1 - x0 < 0 ? shade : wall)
      push(x0, g0, z0, c)
      push(x1, g0, z1, c)
      push(x1, g0 + h, z1, c)
      push(x0, g0, z0, c)
      push(x1, g0 + h, z1, c)
      push(x0, g0 + h, z0, c)
    }
    if (b.r) {
      // a hip roof over the footprint's smallest rectangle (its longest edge's direction)
      let best = null
      for (let i = 0; i < p.length; i++) {
        const [ax, az] = p[i]
        const [bx, bz] = p[(i + 1) % p.length]
        const L = Math.hypot(bx - ax, bz - az)
        if (!best || L > best.L) best = { L, ux: (bx - ax) / L, uz: (bz - az) / L }
      }
      const { ux, uz } = best
      const us = p.map(([x, z]) => x * ux + z * uz)
      const ws = p.map(([x, z]) => -x * uz + z * ux)
      const [u0, u1, w0, w1] = [Math.min(...us), Math.max(...us), Math.min(...ws), Math.max(...ws)]
      const P = (u, w, y) => [u * ux - w * uz, g0 + y, u * uz + w * ux]
      const half = Math.min(u1 - u0, w1 - w0) / 2
      const long = u1 - u0 >= w1 - w0
      const y0 = h
      const y1 = h + rise
      // the ridge along the long side, the hips at the ends
      const r0 = long ? P(u0 + half, (w0 + w1) / 2, y1) : P((u0 + u1) / 2, w0 + half, y1)
      const r1 = long ? P(u1 - half, (w0 + w1) / 2, y1) : P((u0 + u1) / 2, w1 - half, y1)
      const A = P(u0, w0, y0)
      const B = P(u1, w0, y0)
      const C = P(u1, w1, y0)
      const D = P(u0, w1, y0)
      const tri = (q0, q1, q2) => {
        push(...q0, roof)
        push(...q1, roof)
        push(...q2, roof)
      }
      if (long) {
        // the two long slopes, then the hip ends
        tri(A, r1, B), tri(A, r0, r1)
        tri(C, r0, D), tri(C, r1, r0)
        tri(B, r1, C), tri(D, r0, A)
      } else {
        tri(B, r1, C), tri(B, r0, r1)
        tri(D, r0, A), tri(D, r1, r0)
        tri(A, r0, B), tri(C, r1, D)
      }
      continue
    }
    const tris = THREE.ShapeUtils.triangulateShape(p.map(([x, z]) => new THREE.Vector2(x, z)), [])
    for (const [a, b2, d] of tris) {
      push(p[a][0], g0 + h, p[a][1], roof)
      push(p[d][0], g0 + h, p[d][1], roof)
      push(p[b2][0], g0 + h, p[b2][1], roof)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}

// road bridges (OSM highway + bridge=yes, a venue whose override asks: surroundBridges): a deck
// with parapets on square piers. OSM has no clearance: 6.5 m a layer (a flagged default, like the
// rail bridges' 9 m)
export const roadBridgeGeometry = (roads, { keep = 450 } = {}) => {
  const parts = []
  for (const r of roads) {
    if (!r.bridge) continue
    const h = 6.5 * (r.layer || 1)
    for (let i = 0; i + 1 < r.p.length; i++) {
      const [ax, az] = r.p[i]
      const [bx, bz] = r.p[i + 1]
      if (Math.hypot(ax, az) > keep && Math.hypot(bx, bz) > keep) continue
      const L = Math.hypot(bx - ax, bz - az)
      if (L < 0.5) continue
      const yaw = -Math.atan2(bz - az, bx - ax)
      const w = (r.w || 12) + 2
      const deck = new THREE.BoxGeometry(L + 0.4, 1.2, w)
      deck.rotateY(yaw)
      deck.translate((ax + bx) / 2, h, (az + bz) / 2)
      parts.push(deck)
      for (const s of [-1, 1]) {
        const wall = new THREE.BoxGeometry(L + 0.4, 1.0, 0.3).translate(0, 0, (s * (w - 0.3)) / 2)
        wall.rotateY(yaw)
        wall.translate((ax + bx) / 2, h + 1.1, (az + bz) / 2)
        parts.push(wall)
      }
      for (let d = 0; d < L; d += 20) {
        const col = new THREE.BoxGeometry(1.4, h, w * 0.7)
        col.rotateY(yaw)
        col.translate(ax + ((bx - ax) * d) / L, h / 2, az + ((bz - az) * d) / L)
        parts.push(col)
      }
    }
  }
  return parts
}

// power lines (OSM power=line): a steel pole with a cross-arm at every mapped vertex and three
// sagging wires between them (thin boxes, merged)
export const powerLineGeometry = (lines, ground = () => 0, { keep = 450 } = {}) => {
  const poles = []
  const wires = []
  for (const ln of lines) {
    const h = ln.h || 20
    const pts = ln.p.map(([x, z]) => [x, z, ground(x, z)])
    pts.forEach(([x, z, y], i) => {
      if (Math.hypot(x, z) > keep) return
      const pole = new THREE.CylinderGeometry(0.22, 0.42, h, 6).translate(x, y + h / 2, z)
      const next = pts[i + 1] || pts[i - 1]
      const yaw = next ? -Math.atan2(next[1] - z, next[0] - x) + Math.PI / 2 : 0
      const arm = new THREE.BoxGeometry(5, 0.25, 0.25).rotateY(yaw).translate(x, y + h - 0.6, z)
      poles.push(pole, arm)
    })
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az, ay] = pts[i]
      const [bx, bz, by] = pts[i + 1]
      if (Math.hypot(ax, az) > keep && Math.hypot(bx, bz) > keep) continue
      const L = Math.hypot(bx - ax, bz - az)
      if (L < 1) continue
      const nx = -(bz - az) / L
      const nz = (bx - ax) / L
      for (const o of [-2.2, 0, 2.2]) {
        // a catenary in 6 straight pieces, sagging 3% of the span
        const N = 6
        for (let k = 0; k < N; k++) {
          const t0 = k / N
          const t1 = (k + 1) / N
          const y0 = ay + (by - ay) * t0 + h - 0.5 - 4 * 0.03 * L * t0 * (1 - t0)
          const y1 = ay + (by - ay) * t1 + h - 0.5 - 4 * 0.03 * L * t1 * (1 - t1)
          const p0 = new THREE.Vector3(ax + (bx - ax) * t0 + nx * o, y0, az + (bz - az) * t0 + nz * o)
          const p1 = new THREE.Vector3(ax + (bx - ax) * t1 + nx * o, y1, az + (bz - az) * t1 + nz * o)
          const seg = p1.clone().sub(p0)
          const g = new THREE.BoxGeometry(0.05, 0.05, seg.length())
          g.lookAt(seg)
          g.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2)
          wires.push(g)
        }
      }
    }
  }
  return { poles, wires }
}

// rail bridges (OSM bridge=yes): a concrete deck on round columns. Height: a modest 9 m (what
// SMASH's reference pack measured for the Metro viaduct); OSM doesn't map bridge heights.
export const railBridgeGeometry = (rails, { keep = 450, h = 9 } = {}) => {
  const parts = []
  for (const r of rails) {
    if (!r.bridge) continue
    for (let i = 0; i + 1 < r.p.length; i++) {
      const [ax, az] = r.p[i]
      const [bx, bz] = r.p[i + 1]
      if (Math.hypot(ax, az) > keep && Math.hypot(bx, bz) > keep) continue
      const L = Math.hypot(bx - ax, bz - az)
      if (L < 0.5) continue
      const deck = new THREE.BoxGeometry(L + 0.6, 1.4, 5.5)
      deck.rotateY(-Math.atan2(bz - az, bx - ax))
      deck.translate((ax + bx) / 2, h, (az + bz) / 2)
      parts.push(deck)
      for (let d = 0; d < L; d += 24) {
        const col = new THREE.CylinderGeometry(0.8, 1, h, 8)
        col.translate(ax + ((bx - ax) * d) / L, h / 2, az + ((bz - az) * d) / L)
        parts.push(col)
      }
    }
  }
  return parts
}
