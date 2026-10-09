// Roam: a tile's ground: the terrain lattice as a mesh (plain arrays) and one painted texture
// with its land use, parks, water, parking, sidewalks, paths and road surfaces. Node-tested
// for the mesh and the trees; the painting needs a 2D canvas (the browser).

import { AREA, BUILDING_KINDS, DRIVABLE, F, ROAD, isHouse } from "../data/tile.js"
import { APRON, AREA_COLORS, BASE, RES_WITH_VEG, ROAD_ORDER, ROAD_PAINT, SEA, SIDEWALK, TRICKLE, VEG_PAINT, WASH_DAMP, WASH_SAND, YARD, areaColor } from "./paint.js"
import { hashStr, rng } from "../sim/parked.js"
import { SHRUB_R, onLanes } from "../data/veg.js"
import { orientedBox } from "./buildings.js"

// land where trees are a park's or a school's (a mix with oaks and pines)
const GREENS = new Set([AREA.park, AREA.school, AREA.golf, AREA.cemetery, AREA.grass, AREA.pitch])

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
// (paved: a dry cell in a commercial, industrial or school area is paving, pale pavers or a bare
// planting bed, not the golden hills: tile -> (u, v) -> true there)
const PAVED = new Set([AREA.com, AREA.ind, AREA.school, AREA.parking, AREA.plaza])
export const pavedAt = (tile) => {
  const list = (tile?.areas || []).filter((a) => PAVED.has(a.cls))
  if (!list.length) return () => false
  const { x0, x1, z0, z1 } = tile.rect
  return (u, v) => {
    const x = x0 + u * (x1 - x0)
    const z = z0 + v * (z1 - z0)
    return list.some((a) => inRingXZ(a.ring, x, z))
  }
}
export const vegImage = (veg, paved = () => false) => {
  const n = veg.n
  const px = new Uint8ClampedArray(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    const c = VEG_PAINT[veg.raster[i]]
    if (!c) continue
    if (veg.raster[i] === 1 && paved(((i % n) + 0.5) / n, (Math.floor(i / n) + 0.5) / n)) continue
    px.set(c, i * 4)
  }
  return px
}
const paintVeg = (ctx, veg, size, tile = null) => {
  const n = veg.n
  const make = (w, h) => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }))
  const small = make(n, n)
  const g = small.getContext("2d")
  if (!g) return
  g.putImageData(new ImageData(vegImage(veg, pavedAt(tile)), n, n), 0, 0)
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
  // a dry riverbed: braided channels of washed sand along it, damp low lines, gravel (the
  // aerial's scrub then grows over it)
  tile.areas.forEach((a, ai) => {
    if (a.cls !== AREA.wash) return
    const box = orientedBox(a.ring)
    if (!box) return
    const rand = rng(hashStr(`wash:${tile.key}:${ai}`))
    ctx.save()
    poly(a.ring)
    ctx.clip()
    const along = (u, v) => [X(box.cx + box.ux * u - box.uz * v), Z(box.cz + box.uz * u + box.ux * v)]
    const L = box.hl + 20
    const n = Math.max(2, Math.min(9, Math.round(box.hw / 9)))
    for (let k = 0; k < n * 2; k++) {
      const v0 = (rand() * 2 - 1) * box.hw
      const amp = 3 + rand() * 10
      const wl = 60 + rand() * 120
      const ph = rand() * 6.28
      const damp = k >= n
      ctx.beginPath()
      for (let u = -L; u <= L; u += 6) {
        const [px, pz] = along(u, v0 + Math.sin(u / wl + ph) * amp)
        u === -L ? ctx.moveTo(px, pz) : ctx.lineTo(px, pz)
      }
      ctx.lineWidth = (damp ? 1 + rand() * 2 : 3 + rand() * 7) * sx
      ctx.strokeStyle = damp ? WASH_DAMP : WASH_SAND
      ctx.globalAlpha = damp ? 0.55 : 0.7
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    const dots = Math.min(1600, Math.round((box.hl * box.hw * 4) / 30))
    for (let k = 0; k < dots; k++) {
      const [px, pz] = along((rand() * 2 - 1) * box.hl, (rand() * 2 - 1) * box.hw)
      const g = 120 + Math.round(rand() * 90)
      ctx.fillStyle = `rgba(${g},${g - 8},${g - 22},0.7)`
      const r = (0.4 + rand() * 0.9) * sx
      ctx.fillRect(px - r, pz - r, r * 2, r * 2)
    }
    ctx.restore()
  })
  if (veg) {
    paintVeg(ctx, veg, size, tile)
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
    if (cls === ROAD.river)
      for (const r of list) {
        // (a river's line through its dry bed: damp sand and a thin trickle, not a channel of
        // blue; Southern California's rivers run dry most of the year)
        line(r.pts)
        ctx.lineWidth = Math.max(1, 1.4 * sx)
        ctx.strokeStyle = TRICKLE
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

// is a point inside a ring of { x, z }?
const inRingXZ = (r, x, z) => {
  let ins = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i].z > z !== r[j].z > z && x < ((r[j].x - r[i].x) * (z - r[i].z)) / (r[j].z - r[i].z) + r[i].x) ins = !ins
  return ins
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
  const out = tile.trees.map((p) => {
    const s = 0.8 + rand() * 0.5
    const kind = rand() < 0.15 ? 1 : 0
    return { x: p.x, z: p.z, s, r: s * 3.4, kind }
  })
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
        if (inside) {
          const s = 0.7 + rand() * 0.6
          out.push({ x: px, z: pz, s, r: s * 3.4, kind: 0, sp: rand() < 0.7 ? "oak" : "plane" })
        }
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
    const lots = tile.areas.filter((a) => a.cls === AREA.parking).map((a) => ({ ring: a.ring, box: orientedBox(a.ring) }))
    const greens = tile.areas.filter((a) => GREENS.has(a.cls))
    const offices = tile.buildings.filter((b) => !isHouse(b.kind) && b.area > 300)
    const houses = tile.buildings.filter((b) => isHouse(b.kind))
    // the nearest wall of a building within m metres -> its direction (radians) or null
    const wallNear = (list, x, z, m) => {
      let best = null
      let bd = m
      for (const b of list) {
        if (Math.abs(b.ring[0].x - x) > 150 || Math.abs(b.ring[0].z - z) > 150) continue
        for (let i = 0; i < b.ring.length; i++) {
          const p = b.ring[i]
          const n = b.ring[(i + 1) % b.ring.length]
          const dx = n.x - p.x
          const dz = n.z - p.z
          const L2 = dx * dx + dz * dz || 1e-9
          const k = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / L2))
          const d = Math.hypot(x - p.x - dx * k, z - p.z - dz * k)
          if (d < bd) {
            bd = d
            best = Math.atan2(-dz, dx)
          }
        }
      }
      return best
    }
    for (const q of tile.vegTrees) {
      if (out.length >= max) break
      if (mapped.some((m) => Math.abs(m.x - q.x) < 3 && Math.abs(m.z - q.z) < 3)) continue
      const h = hashStr(`${Math.round(q.x * 10)},${Math.round(q.z * 10)}`) % 1000
      const lot = lots.find((a) => inRingXZ(a.ring, q.x, q.z))
      if (q.r < SHRUB_R) {
        const street = nearRoad(drive, q.x, q.z, 6)
        // (in a car park or by an office: a trimmed hedge in its curbed island, along the lot's
        // rows or the building's wall)
        const wall = lot ? null : wallNear(offices, q.x, q.z, 6)
        const hedge = !!lot || wall !== null
        const yaw = lot?.box ? Math.atan2(-lot.box.uz, lot.box.ux) : wall
        out.push({ x: q.x, z: q.z, s: q.r, r: q.r, kind: 2, hedge, yaw: hedge ? yaw : undefined, len: q.r * 2.6, flower: !hedge && street && h < 450 ? 1 + (h % 4) : 0 })
        continue
      }
      const s = Math.max(0.45, Math.min(2.5, q.r / 3.2))
      let kind = 0
      if (q.r <= 3.6 && h < 400 && nearRoad(arterial, q.x, q.z, 3)) kind = 1
      // the species (none is mapped: by where it stands, Southern California's usual planting):
      // lots and streets sycamores and planes, round evergreens, a few oaks; by offices pines
      // too; parks and schools a mix with oaks and pines; yards mostly round evergreens; the
      // hills and washes live oaks with sycamores
      const f = (h % 100) / 100
      const pickOf = (mix) => {
        let a = 0
        for (const [sp, w] of mix) if (f < (a += w)) return sp
        return mix[mix.length - 1][0]
      }
      let sp
      if (lot || nearRoad(drive, q.x, q.z, 7)) sp = pickOf(wallNear(offices, q.x, q.z, 30) !== null ? [["plane", 0.4], ["pine", 0.2], ["round", 0.25], ["oak", 0.15]] : [["plane", 0.5], ["round", 0.33], ["oak", 0.12], ["pine", 0.05]])
      else if (wallNear(offices, q.x, q.z, 30) !== null) sp = pickOf([["pine", 0.3], ["plane", 0.3], ["round", 0.25], ["oak", 0.15]])
      else if (greens.some((a) => inRingXZ(a.ring, q.x, q.z))) sp = pickOf([["oak", 0.3], ["plane", 0.25], ["round", 0.25], ["pine", 0.2]])
      else if (wallNear(houses, q.x, q.z, 22) !== null) sp = pickOf([["round", 0.45], ["plane", 0.22], ["oak", 0.18], ["pine", 0.15]])
      else sp = pickOf([["oak", 0.7], ["plane", 0.18], ["round", 0.08], ["pine", 0.04]])
      if (kind === 0 && sp === "pine") kind = 3
      out.push({ x: q.x, z: q.z, s, r: q.r, kind, sp: kind === 0 ? sp : undefined, island: !!lot })
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
        if (onLanes(r, Math.hypot(t.x - a.x - dx * k, t.z - a.z - dz * k), !!(r.flags & F.oneway), 0.3)) return false
      }
    return true
  })
}
void ROAD
