// Baked ambient occlusion for a real venue (docs/venue-realism.md, round 3).
//
// Round 2's screen-space pass (GTAO, removed) brightened the whole frame and barely darkened
// anything, so this replaces it with occlusion worked out once when the venue loads, from its
// own geometry: every solid thing (walls, windscreens, stands, benches, cars, trunks, posts) is
// drawn into a top-down height map of the venue, and each ground cell looks out in 8
// directions for how high the horizon rises around it (horizon-based AO on a height field).
// Tree crowns (alpha-cut leaf cards) add a soft canopy shade. The result is a small grey
// texture over the venue that surfaces.js multiplies into the SKY light (indirect) of floors,
// and of walls near their foot: dark where walls meet the ground, under benches, cars and
// trees, in corners and along windscreens, with sunlit open ground untouched (the paint
// calibration holds: open courts stay at 1.0).
//
// Costs nothing per frame (one texture sample on surfaced materials). The bake is
// time-sliced in the browser (a few ms per frame) and synchronous in Node (tests).

import * as THREE from "three"

const DIRS = 8
const STEPS = [0.25, 0.5, 0.8, 1.2, 1.7, 2.4, 3.2, 4.2]
const MAX_H = 6 // taller than this changes nothing for ground AO
const LOW = 0.15 // under this a triangle is the ground or a court's paint
const OVERHEAD = 4.2 // roofs, ceilings, canopies, lights above this aren't ground occluders

// the shared uniforms surfaces.js reads (one venue at a time)
const white = () => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  t.needsUpdate = true
  return t
}
export const aoUniforms = {
  surfAOTex: { value: white() },
  surfAOBox: { value: new THREE.Vector4(0, 0, 0, 0) }, // x0, z0, 1/width, 1/depth (0: none)
  surfAOOn: { value: 0 },
}
export const setBakedAOOn = (on) => (aoUniforms.surfAOOn.value = on ? 1 : 0)
// the last bake's numbers (dev tools)
export const lastAO = { ms: 0, tris: 0, cells: 0 }

// 2D distance from (px, pz) to a triangle (or the segment it collapses to, for walls)
const segDist2 = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax
  const dz = bz - az
  const l = dx * dx + dz * dz
  let t = l > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / l : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const ex = ax + dx * t - px
  const ez = az + dz * t - pz
  return ex * ex + ez * ez
}
const triDist2 = (px, pz, ax, az, bx, bz, cx, cz) => {
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
  if (Math.abs(d) > 1e-6) {
    const u = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d
    const v = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d
    if (u >= 0 && v >= 0 && u + v <= 1) return 0
  }
  return Math.min(segDist2(px, pz, ax, az, bx, bz), segDist2(px, pz, bx, bz, cx, cz), segDist2(px, pz, cx, cz, ax, az))
}

// what kind of occluder a material is: "solid", "canopy" (alpha-cut leaves) or null (skip)
const kindOf = (m, o) => {
  if (!m || o.userData?.noAO) return null
  if (m.alphaTest > 0 && m.map) return "canopy"
  if (m.transparent || m.depthWrite === false || m.isMeshBasicMaterial || m.isShaderMaterial || m.isPointsMaterial) return null
  return "solid"
}

// the work of drawing `root`'s static meshes into the height map H and canopy map C, cut into
// jobs (an instance, or up to 4,000 triangles of a big merged mesh) so the browser can spread it
// over frames. run(job) draws one; tris() counts what was drawn.
export const rasterJobs = (root, grid) => {
  const { x0, z0, cell, nx, nz, H, C } = grid
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const m4 = new THREE.Matrix4()
  const inst = new THREE.Matrix4()
  const half2 = (cell * 0.75) ** 2
  let tris = 0
  const draw = (ax, ay, az, bx, by, bz, cx, cy, cz, kind) => {
    const lo = Math.min(ay, by, cy)
    const hi = Math.max(ay, by, cy)
    if (hi < LOW) return
    if (kind === "solid" && lo > OVERHEAD) return
    // a high, flat-ish triangle (roof, ceiling, awning) isn't a ground occluder
    if (kind === "solid" && hi > OVERHEAD) {
      const ny = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax))
      const len = Math.hypot((by - ay) * (cz - az) - (bz - az) * (cy - ay), (bz - az) * (cx - ax) - (bx - ax) * (cz - az), ny) || 1
      if (ny / len > 0.7) return
    }
    if (kind === "canopy" && hi < 1.6) return
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / cell - 0.75))
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / cell + 0.75))
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / cell - 0.75))
    const j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) - z0) / cell + 0.75))
    if (i1 < i0 || j1 < j0) return
    tris++
    const h = Math.min(MAX_H, hi)
    for (let j = j0; j <= j1; j++) {
      const pz = z0 + (j + 0.5) * cell
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * cell
        if (triDist2(px, pz, ax, az, bx, bz, cx, cz) > half2) continue
        const k = j * nx + i
        if (kind === "canopy") C[k] = Math.min(1, C[k] + 0.35)
        else if (h > H[k]) H[k] = h
      }
    }
  }
  root.updateMatrixWorld(true)
  const jobs = []
  const CHUNK = 4000 * 3
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry?.attributes?.position) return
    const m = Array.isArray(o.material) ? o.material[0] : o.material
    const kind = kindOf(m, o)
    if (!kind) return
    const idx = o.geometry.index
    const n = idx ? idx.count : o.geometry.attributes.position.count
    const count = o.isInstancedMesh ? o.count : 1
    for (let s = 0; s < count; s++) for (let t0 = 0; t0 < n; t0 += CHUNK) jobs.push({ o, kind, s, t0, t1: Math.min(n, t0 + CHUNK) })
  })
  const run = ({ o, kind, s, t0, t1 }) => {
    const pos = o.geometry.attributes.position
    const idx = o.geometry.index
    if (o.isInstancedMesh) {
      o.getMatrixAt(s, inst)
      m4.multiplyMatrices(o.matrixWorld, inst)
    } else m4.copy(o.matrixWorld)
    for (let t = t0; t + 2 < t1; t += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(m4)
      b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(m4)
      c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(m4)
      draw(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, kind)
    }
  }
  return { jobs, run, tris: () => tris }
}

// all of it at once (Node tests)
export const rasterize = (root, grid) => {
  const r = rasterJobs(root, grid)
  for (const j of r.jobs) r.run(j)
  return r.tris()
}

export const makeGrid = (bounds, { maxCells = 1100, minCell = 0.3 } = {}) => {
  const pad = 8
  const x0 = bounds.x0 - pad
  const z0 = bounds.z0 - pad
  const w = bounds.x1 - bounds.x0 + pad * 2
  const d = bounds.z1 - bounds.z0 + pad * 2
  const cell = Math.max(minCell, Math.max(w, d) / maxCells)
  const nx = Math.max(2, Math.ceil(w / cell))
  const nz = Math.max(2, Math.ceil(d / cell))
  return { x0, z0, cell, nx, nz, w: nx * cell, d: nz * cell, H: new Float32Array(nx * nz), C: new Float32Array(nx * nz), A: new Float32Array(nx * nz) }
}

// rows j0..j1 of the AO from the height map (1 open, lower = occluded)
const DX = Array.from({ length: DIRS }, (_, k) => Math.cos((k / DIRS) * Math.PI * 2))
const DZ = Array.from({ length: DIRS }, (_, k) => Math.sin((k / DIRS) * Math.PI * 2))
export const aoRows = (grid, j0, j1) => {
  const { cell, nx, nz, H, A } = grid
  for (let j = j0; j < j1; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      const h0 = H[k]
      // inside something solid (under a car, a bench, a stand): deep contact shade
      if (h0 > 0.35) {
        A[k] = 0.5
        continue
      }
      let occl = 0
      for (let dIdx = 0; dIdx < DIRS; dIdx++) {
        let best = 0
        for (const dist of STEPS) {
          const ii = Math.round(i + (DX[dIdx] * dist) / cell)
          const jj = Math.round(j + (DZ[dIdx] * dist) / cell)
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) break
          const tan = (H[jj * nx + ii] - h0) / dist
          if (tan > best) best = tan
        }
        occl += best / Math.sqrt(1 + best * best) // sin(horizon angle)
      }
      A[k] = 1 - (occl / DIRS) * 0.62
    }
  }
}

// a little blur, canopy shade, then 8-bit
export const finishAO = (grid) => {
  const { nx, nz, A, C } = grid
  const out = new Uint8Array(nx * nz * 4)
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      let s = 0
      let cs = 0
      let n = 0
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = i + di
          const jj = j + dj
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue
          const kk = jj * nx + ii
          s += A[kk]
          cs += C[kk]
          n++
        }
      const v = (s / n) * (1 - 0.38 * Math.min(1, cs / n))
      const b = Math.max(0, Math.min(255, Math.round(v * 255)))
      const o = (j * nx + i) * 4
      out[o] = out[o + 1] = out[o + 2] = b
      out[o + 3] = 255
    }
  }
  return out
}

const toTexture = (grid, data) => {
  const t = new THREE.DataTexture(data, grid.nx, grid.nz, THREE.RGBAFormat)
  t.colorSpace = THREE.NoColorSpace
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearFilter
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.needsUpdate = true
  return t
}

// bake and publish (browser: time-sliced; returns a cancel function). onDone(grid) when ready.
export const bakeVenueAO = (root, bounds, { sync = typeof requestAnimationFrame === "undefined", budgetMs = 6, onDone = null } = {}) => {
  let cancelled = false
  const grid = makeGrid(bounds)
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now()
  const raster = rasterJobs(root, grid)
  const publish = () => {
    if (cancelled) return
    const tex = toTexture(grid, finishAO(grid))
    const old = aoUniforms.surfAOTex.value
    aoUniforms.surfAOTex.value = tex
    aoUniforms.surfAOBox.value.set(grid.x0, grid.z0, 1 / grid.w, 1 / grid.d)
    aoUniforms.surfAOOn.value = 1
    if (old && old.image?.width > 1) old.dispose()
    grid.ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0
    Object.assign(lastAO, { ms: Math.round(grid.ms), tris: grid.tris, cells: grid.nx * grid.nz, rasterMs: Math.round(grid.rasterMs) })
    onDone?.(grid)
  }
  const rasterDone = () => {
    grid.tris = raster.tris()
    grid.rasterMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0
  }
  if (sync) {
    for (const job of raster.jobs) raster.run(job)
    rasterDone()
    aoRows(grid, 0, grid.nz)
    publish()
    return () => {}
  }
  let r = 0
  let j = 0
  const step = () => {
    if (cancelled) return
    const until = performance.now() + budgetMs
    // first the height map, then the AO rows, a few ms a frame
    while (r < raster.jobs.length && performance.now() < until) raster.run(raster.jobs[r++])
    if (r === raster.jobs.length && grid.rasterMs === undefined) rasterDone()
    while (r === raster.jobs.length && j < grid.nz && performance.now() < until) {
      const j1 = Math.min(grid.nz, j + 8)
      aoRows(grid, j, j1)
      j = j1
    }
    if (j < grid.nz) requestAnimationFrame(step)
    else publish()
  }
  requestAnimationFrame(step)
  return () => {
    cancelled = true
  }
}

// a venue goes away: no AO until the next one bakes
export const clearBakedAO = () => {
  const old = aoUniforms.surfAOTex.value
  aoUniforms.surfAOTex.value = white()
  aoUniforms.surfAOBox.value.set(0, 0, 0, 0)
  aoUniforms.surfAOOn.value = 0
  if (old && old.image?.width > 1) old.dispose()
}
