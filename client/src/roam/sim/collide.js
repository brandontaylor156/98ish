// Roam: walls you can't walk or drive through (the mapped buildings' outlines). Pure;
// Node-tested (roam.test.js).
//
// Every building edge goes into a grid of 16 m cells; a circle (you, or one of a car's three
// circles) is pushed out of any edge it overlaps, so you slide along a wall instead of
// stopping dead. Edges are added and taken away a tile at a time as the town streams.

const CELL = 16
const ck = (cx, cz) => cx * 73856093 + cz * 19349663

export const createColliders = () => {
  const cells = new Map() // cell -> [edge]
  const byTile = new Map() // tile key -> [cell] it filled
  const polys = new Map() // tile key -> [{ ring, x0, z0, x1, z1 }]
  let count = 0

  const addEdge = (tile, e, list) => {
    const x0 = Math.floor(Math.min(e.ax, e.bx) / CELL)
    const x1 = Math.floor(Math.max(e.ax, e.bx) / CELL)
    const z0 = Math.floor(Math.min(e.az, e.bz) / CELL)
    const z1 = Math.floor(Math.max(e.az, e.bz) / CELL)
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const k = ck(cx, cz)
        let c = cells.get(k)
        if (!c) cells.set(k, (c = []))
        c.push(e)
        list.push(k)
      }
  }

  // rings: [{ ring: [{ x, z }], top?, solid? }] (solid false: a roof on posts, not a wall)
  const addTile = (key, rings) => {
    if (byTile.has(key)) removeTile(key)
    const list = []
    const ps = []
    for (const r of rings) {
      if (r.solid === false || r.ring.length < 3) continue
      const ring = r.ring
      let x0 = Infinity
      let z0 = Infinity
      let x1 = -Infinity
      let z1 = -Infinity
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        addEdge(key, { ax: a.x, az: a.z, bx: b.x, bz: b.z, top: r.top ?? 10, tile: key }, list)
        count++
        if (a.x < x0) x0 = a.x
        if (a.x > x1) x1 = a.x
        if (a.z < z0) z0 = a.z
        if (a.z > z1) z1 = a.z
      }
      ps.push({ ring, x0, z0, x1, z1, top: r.top ?? 10 })
    }
    byTile.set(key, list)
    polys.set(key, ps)
  }
  const removeTile = (key) => {
    const list = byTile.get(key)
    if (!list) return
    for (const k of list) {
      const c = cells.get(k)
      if (!c) continue
      const kept = c.filter((e) => e.tile !== key)
      if (kept.length) cells.set(k, kept)
      else cells.delete(k)
    }
    count -= (polys.get(key) || []).reduce((n, p) => n + p.ring.length, 0)
    byTile.delete(key)
    polys.delete(key)
  }

  const near = (x0, z0, x1, z1, fn) => {
    const seen = new Set()
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const c = cells.get(ck(cx, cz))
        if (!c) continue
        for (const e of c) {
          if (seen.has(e)) continue
          seen.add(e)
          fn(e)
        }
      }
  }

  // push a circle out of the walls -> { x, z, hit, nx, nz } (n: the summed push direction)
  const resolve = (x, z, r, out = {}) => {
    let px = x
    let pz = z
    let nx = 0
    let nz = 0
    let hit = false
    for (let it = 0; it < 3; it++) {
      let moved = false
      near(px - r, pz - r, px + r, pz + r, (e) => {
        const dx = e.bx - e.ax
        const dz = e.bz - e.az
        const L2 = dx * dx + dz * dz || 1e-9
        let t = ((px - e.ax) * dx + (pz - e.az) * dz) / L2
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const cx = e.ax + dx * t
        const cz = e.az + dz * t
        let ox = px - cx
        let oz = pz - cz
        const d = Math.hypot(ox, oz)
        if (d >= r) return
        if (d < 1e-6) {
          // (right on the line: out along the edge's normal)
          const L = Math.sqrt(L2)
          ox = -dz / L
          oz = dx / L
        } else {
          ox /= d
          oz /= d
        }
        const push = r - d
        px += ox * push
        pz += oz * push
        nx += ox
        nz += oz
        hit = moved = true
      })
      if (!moved) break
    }
    const nl = Math.hypot(nx, nz) || 1
    out.x = px
    out.z = pz
    out.hit = hit
    out.nx = nx / nl
    out.nz = nz / nl
    return out
  }

  // is a point inside a building's outline? -> the building's top height or 0
  const inside = (x, z) => {
    let top = 0
    for (const ps of polys.values())
      for (const p of ps) {
        if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue
        let inPoly = false
        const r = p.ring
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i].z > z !== r[j].z > z && x < ((r[j].x - r[i].x) * (z - r[i].z)) / (r[j].z - r[i].z) + r[i].x) inPoly = !inPoly
        if (inPoly) top = Math.max(top, p.top)
      }
    return top
  }

  // does the segment a -> b (2D) cross a wall taller than y? -> the fraction along it, or 1
  const segment = (ax, az, bx, bz, y = 0) => {
    let best = 1
    near(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), (e) => {
      if (e.top < y) return
      const rx = bx - ax
      const rz = bz - az
      const sx = e.bx - e.ax
      const sz = e.bz - e.az
      const den = rx * sz - rz * sx
      if (Math.abs(den) < 1e-9) return
      const t = ((e.ax - ax) * sz - (e.az - az) * sx) / den
      const u = ((e.ax - ax) * rz - (e.az - az) * rx) / den
      if (t >= 0 && t < best && u >= 0 && u <= 1) best = t
    })
    return best
  }

  return {
    addTile,
    removeTile,
    resolve,
    inside,
    segment,
    get edges() {
      return count
    },
    get tiles() {
      return byTile.size
    },
  }
}
