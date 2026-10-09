// Roam: a tile's ground: the terrain lattice as a mesh (plain arrays) and one painted texture
// with its land use, parks, water, parking, sidewalks, paths and road surfaces. Node-tested
// for the mesh and the trees; the painting needs a 2D canvas (the browser).

import { AREA, BUILDING_KINDS, DRIVABLE, F, ROAD, isHouse } from "../data/tile.js"
import { APRON, AREA_COLORS, BASE, RES_WITH_VEG, ROAD_ORDER, ROAD_PAINT, SEA, SIDEWALK, VEG_PAINT, YARD, areaColor } from "./paint.js"
import { hashStr, rng } from "../sim/parked.js"
import { SHRUB_R } from "../data/veg.js"

// the lattice -> { position, normal, uv, index } (two triangles a cell, split the way
// data/tile.js tileHeightAt assumes)
export const groundArrays = (tile, { skirt = 0 } = {}) => {
  const g = tile.grid || 2
  const { x0, x1, z0, z1 } = tile.rect
  const H = (i, j) => (tile.heights ? tile.heights[j * g + i] : 0)
  const P = new Float32Array(g * g * 3)
  const N = new Float32Array(g * g * 3)
  const U = new Float32Array(g * g * 2)
  const dx = (x1 - x0) / (g - 1)
  const dz = (z1 - z0) / (g - 1)
  for (let j = 0; j < g; j++)
    for (let i = 0; i < g; i++) {
      const k = j * g + i
      P[k * 3] = x0 + dx * i
      P[k * 3 + 1] = H(i, j)
      P[k * 3 + 2] = z0 + dz * j
      // (normals from the neighbours' heights: the same on both sides of a tile edge, nearly)
      const hl = H(Math.max(0, i - 1), j)
      const hr = H(Math.min(g - 1, i + 1), j)
      const hu = H(i, Math.max(0, j - 1))
      const hd = H(i, Math.min(g - 1, j + 1))
      const sx = (hr - hl) / (dx * (Math.min(g - 1, i + 1) - Math.max(0, i - 1)) || 1)
      const sz = (hd - hu) / (dz * (Math.min(g - 1, j + 1) - Math.max(0, j - 1)) || 1)
      const l = Math.hypot(sx, 1, sz)
      N[k * 3] = -sx / l
      N[k * 3 + 1] = 1 / l
      N[k * 3 + 2] = -sz / l
      U[k * 2] = i / (g - 1)
      U[k * 2 + 1] = 1 - j / (g - 1)
    }
  const idx = []
  for (let j = 0; j + 1 < g; j++)
    for (let i = 0; i + 1 < g; i++) {
      const a = j * g + i
      const b = (j + 1) * g + i
      const c = (j + 1) * g + i + 1
      const d = j * g + i + 1
      idx.push(a, b, d, b, c, d)
    }
  void skirt
  return { position: P, normal: N, uv: U, index: g * g > 65535 ? new Uint32Array(idx) : new Uint16Array(idx) }
}

// the surfaces drawn over the aerial's vegetation (a tree over a lot doesn't make the lot green)
const HARD = new Set([AREA.parking, AREA.plaza, AREA.pitch, AREA.track, AREA.playground, AREA.water, AREA.pool, AREA.golfgreen])

// the aerial's vegetation raster (VEG_N x VEG_N) painted soft-edged over the tile: a small
// image of the cells' colours scaled up with smoothing (the cells are ~8 m; the blur reads as
// lawns and planted strips, not squares)
export const vegImage = (veg) => {
  const n = veg.n
  const px = new Uint8ClampedArray(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    const c = VEG_PAINT[veg.raster[i]]
    if (!c) continue
    px.set(c, i * 4)
  }
  return px
}
const paintVeg = (ctx, veg, size) => {
  const n = veg.n
  const make = (w, h) => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }))
  const small = make(n, n)
  const g = small.getContext("2d")
  if (!g) return
  g.putImageData(new ImageData(vegImage(veg), n, n), 0, 0)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(small, 0, 0, size, size)
  ctx.restore()
}

// paint the tile's ground into a 2D context of size x size
export const paintGround = (ctx, tile, size) => {
  const { x0, x1, z0, z1 } = tile.rect
  const sx = size / (x1 - x0)
  const sz = size / (z1 - z0)
  const X = (x) => (x - x0) * sx
  const Z = (z) => (z - z0) * sz
  ctx.fillStyle = BASE
  ctx.fillRect(0, 0, size, size)
  const poly = (ring) => {
    ctx.beginPath()
    ring.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Z(p.z)) : ctx.moveTo(X(p.x), Z(p.z))))
    ctx.closePath()
  }
  // land use, parks, water, lots (bottom-up by class: data/tile.js sorts them); with the aerial's
  // vegetation (data/veg.js) the soft ones (land use, parks) first, then what the aerial shows
  // growing (lawns, landscaping, medians, the ground under trees, dry hills), then the hard
  // surfaces (lots, plazas, courts, water) on top
  const veg = tile.veg
  const hard = (cls) => HARD.has(cls)
  const drawArea = (a) => {
    poly(a.ring)
    ctx.fillStyle = veg && a.cls === AREA.res ? RES_WITH_VEG : areaColor(a.cls)
    ctx.fill()
    if (a.cls === AREA.pitch || a.cls === AREA.playground || a.cls === AREA.pool) {
      ctx.lineWidth = Math.max(1, 0.4 * sx)
      ctx.strokeStyle = "rgba(240,240,232,0.55)"
      ctx.stroke()
    }
  }
  for (const a of tile.areas) if (!veg || !hard(a.cls)) drawArea(a)
  if (veg) {
    paintVeg(ctx, veg, size)
    for (const a of tile.areas) if (hard(a.cls)) drawArea(a)
  }
  // the sea (a coast town): the sea floor's colour under the water (render/sea.js draws the
  // water itself; far off and through the shallows this is what shows)
  for (const group of tile.sea || []) {
    ctx.beginPath()
    for (const r of group) {
      r.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Z(p.z)) : ctx.moveTo(X(p.x), Z(p.z))))
      ctx.closePath()
    }
    ctx.fillStyle = SEA
    ctx.fill("evenodd")
  }
  // the ground round each mapped building (a material, not a thing: docs/open-world.md):
  // houses stand in their yards (lawn), everything else on a concrete apron; then the
  // buildings' own footprints in a darker tone (their contact shade from above)
  ctx.lineJoin = "round"
  for (const b of tile.buildings) {
    if (b.ring.length < 3) continue
    const name = BUILDING_KINDS[b.kind]
    const house = isHouse(b.kind) && name !== "garage" && name !== "garages" && name !== "shed"
    if (name === "roof" || name === "carport") continue
    poly(b.ring)
    ctx.lineWidth = (house ? 16 : 5) * sx
    ctx.strokeStyle = house ? YARD : APRON
    ctx.fillStyle = house ? YARD : APRON
    ctx.stroke()
    ctx.fill()
  }
  // (sidewalks over a yard's edge come later with the roads)
  const line = (pts) => {
    ctx.beginPath()
    pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Z(p.z)) : ctx.moveTo(X(p.x), Z(p.z))))
  }
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  // (tunnels go under; bridges are drawn as decks)
  const roads = tile.roads.filter((r) => !(r.flags & F.tunnel) && !(r.flags & F.bridge))
  // sidewalks where the map has them, under everything
  for (const r of roads) {
    if (!(r.flags & (F.walkL | F.walkR)) || !DRIVABLE.has(r.cls)) continue
    line(r.pts)
    ctx.lineWidth = (r.width + 4) * sx
    ctx.strokeStyle = SIDEWALK
    ctx.stroke()
  }
  for (const cls of ROAD_ORDER) {
    const paint = ROAD_PAINT[cls]
    if (!paint) continue
    const list = roads.filter((r) => r.cls === cls)
    if (!list.length) continue
    // curbs first (a slightly wider pale stroke), then the surface
    if (paint[1])
      for (const r of list) {
        line(r.pts)
        ctx.lineWidth = (r.width + 0.7) * sx
        ctx.strokeStyle = paint[1]
        ctx.stroke()
      }
    for (const r of list) {
      line(r.pts)
      ctx.lineWidth = Math.max(1, r.width * sx)
      ctx.strokeStyle = paint[0]
      ctx.stroke()
    }
    if (cls === ROAD.rail)
      for (const r of list) {
        // (two rails)
        ctx.lineWidth = Math.max(1, 1.6 * sx)
        line(r.pts)
        ctx.strokeStyle = "#4b4540"
        ctx.stroke()
      }
  }
  void AREA_COLORS
}

// is a point within m metres of a road's edge?
const nearRoad = (roads, x, z, m) => {
  for (const r of roads)
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i]
      const b = r.pts[i + 1]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const L2 = dx * dx + dz * dz || 1e-9
      const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2))
      if (Math.hypot(x - a.x - dx * k, z - a.z - dz * k) < r.width / 2 + m) return true
    }
  return false
}

// the trees a tile draws: the map's own trees and tree rows, and the inside of its mapped
// woods (a tree every ~70 m², the same in every browser) -> [{ x, z, s, kind }]
export const treeSpots = (tile, { max = 500 } = {}) => {
  const rand = rng(hashStr(`trees:${tile.key}`))
  const out = tile.trees.map((p) => ({ x: p.x, z: p.z, s: 0.8 + rand() * 0.5, kind: rand() < 0.15 ? 1 : 0 }))
  for (const a of tile.areas) {
    if (a.cls !== AREA.wood || out.length >= max) continue
    let x0 = Infinity
    let x1 = -Infinity
    let z0 = Infinity
    let z1 = -Infinity
    for (const p of a.ring) {
      x0 = Math.min(x0, p.x)
      x1 = Math.max(x1, p.x)
      z0 = Math.min(z0, p.z)
      z1 = Math.max(z1, p.z)
    }
    const step = 8.5
    for (let x = x0 + step / 2; x < x1 && out.length < max; x += step)
      for (let z = z0 + step / 2; z < z1 && out.length < max; z += step) {
        const px = x + (rand() - 0.5) * step * 0.8
        const pz = z + (rand() - 0.5) * step * 0.8
        let inside = false
        const r = a.ring
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i].z > pz !== r[j].z > pz && px < ((r[j].x - r[i].x) * (pz - r[i].z)) / (r[j].z - r[i].z) + r[i].x) inside = !inside
        if (inside) out.push({ x: px, z: pz, s: 0.7 + rand() * 0.6, kind: 0 })
      }
  }
  // the crowns the aerial shows (data/veg.js), sized by their crowns; not where the map already
  // has a tree. Kinds (no species is mapped): palms along the arterials (small crowns within a
  // few metres of a primary/secondary/tertiary road, about half of them), a pine now and then,
  // the rest broad-leaf (sycamore, oak); crowns under SHRUB_R are shrubs, flowering along the
  // streets now and then
  const drive = tile.roads.filter((r) => DRIVABLE.has(r.cls) && !(r.flags & (F.tunnel | F.bridge)))
  if (tile.vegTrees?.length) {
    const mapped = out.slice()
    const arterial = drive.filter((r) => r.cls >= ROAD.trunk && r.cls <= ROAD.tertiary)
    for (const q of tile.vegTrees) {
      if (out.length >= max) break
      if (mapped.some((m) => Math.abs(m.x - q.x) < 3 && Math.abs(m.z - q.z) < 3)) continue
      const h = hashStr(`${Math.round(q.x * 10)},${Math.round(q.z * 10)}`) % 1000
      if (q.r < SHRUB_R) {
        const street = nearRoad(drive, q.x, q.z, 6)
        out.push({ x: q.x, z: q.z, s: q.r, kind: 2, flower: street && h < 450 ? 1 + (h % 4) : 0 })
        continue
      }
      const s = Math.max(0.45, Math.min(2.5, q.r / 3.2))
      let kind = 0
      if (q.r <= 3.6 && h < 520 && nearRoad(arterial, q.x, q.z, 3)) kind = 1
      else if (q.r >= 2.4 && h % 9 === 0) kind = 3
      out.push({ x: q.x, z: q.z, s, kind })
    }
  }
  // (none standing in a road)
  return out.filter((t) => {
    for (const r of drive)
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const a = r.pts[i]
        const b = r.pts[i + 1]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const L2 = dx * dx + dz * dz || 1e-9
        const k = Math.max(0, Math.min(1, ((t.x - a.x) * dx + (t.z - a.z) * dz) / L2))
        if (Math.hypot(t.x - a.x - dx * k, t.z - a.z - dz * k) < r.width / 2 + 0.3) return false
      }
    return true
  })
}
void ROAD
