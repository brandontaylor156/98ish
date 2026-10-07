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
export const surroundBuildingsGeometry = (list) => {
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
    const h = b.h
    const k = (Math.abs(Math.round(p[0][0] * 7 + p[0][1] * 13)) % 9) / 9
    const wall = new THREE.Color().setHSL(0.09 + k * 0.03, 0.12 + k * 0.08, 0.66 + k * 0.12)
    const shade = wall.clone().multiplyScalar(0.82)
    const roof = new THREE.Color().setHSL(0.08, 0.05, 0.6 + k * 0.15)
    for (let i = 0; i < p.length; i++) {
      const [x0, z0] = p[i]
      const [x1, z1] = p[(i + 1) % p.length]
      // walls facing south/west a little darker (a cheap sense of light without normals work)
      c.copy(z1 - z0 > 0 || x1 - x0 < 0 ? shade : wall)
      push(x0, 0, z0, c)
      push(x1, 0, z1, c)
      push(x1, h, z1, c)
      push(x0, 0, z0, c)
      push(x1, h, z1, c)
      push(x0, h, z0, c)
    }
    const tris = THREE.ShapeUtils.triangulateShape(p.map(([x, z]) => new THREE.Vector2(x, z)), [])
    for (const [a, b2, d] of tris) {
      push(p[a][0], h, p[a][1], roof)
      push(p[d][0], h, p[d][1], roof)
      push(p[b2][0], h, p[b2][1], roof)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
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
