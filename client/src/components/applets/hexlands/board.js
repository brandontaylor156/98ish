// Hexlands' island: the shape of the board (corners, edges, who touches what) and making
// a new map. Plain data and math, no React, so the rules (rules.js) can run in the browser
// and on the server (server/arcade/games/hexlands.js) alike.
//
// Tiles are pointy-topped hexes laid out in rows ("std" 3-4-5-4-3 = 19 land tiles for 2-4
// players, "ext" 3-4-5-6-5-4-3 = 30 for 5-6). A tile's center is in units of the hex's
// radius; its six corners are shared with its neighbors, so corners and edges get ids by
// position: corner ids ("vertices") are where settlements go, edge ids where roads go.

export const SQ3 = Math.sqrt(3)
export const SHAPES = { std: [3, 4, 5, 4, 3], ext: [3, 4, 5, 6, 5, 4, 3] }
export const RES = ["timber", "clay", "wool", "grain", "ore"]
export const TERRAINS = ["forest", "hills", "pasture", "fields", "mountains", "desert"]
export const TERRAIN_RES = { forest: "timber", hills: "clay", pasture: "wool", fields: "grain", mountains: "ore", desert: null }
// how many ways two dice make each number (the dots on a number token)
export const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 }

const MIX = {
  std: {
    terrain: { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1 },
    numbers: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
    harbors: ["any", "any", "any", "any", "timber", "clay", "wool", "grain", "ore"],
  },
  ext: {
    terrain: { forest: 6, pasture: 6, fields: 6, hills: 5, mountains: 5, desert: 2 },
    numbers: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12],
    harbors: ["any", "any", "any", "any", "any", "timber", "clay", "wool", "wool", "grain", "ore"],
  },
}
export const mixFor = (geo) => MIX[geo]

// the six corners of a pointy-topped hex, clockwise from the top
const CORNERS = [
  [0, -1],
  [SQ3 / 2, -0.5],
  [SQ3 / 2, 0.5],
  [0, 1],
  [-SQ3 / 2, 0.5],
  [-SQ3 / 2, -0.5],
]

const cache = {}

// The board's shape: { tiles: [{ x, y, row, col, corners: [v x6], edges: [e x6], near: [tile] }],
// vertices: [{ x, y, tiles, adj: [v], edges: [e] }], edges: [{ a, b, tiles, x, y, angle }],
// coast: [edge ids around the shore, clockwise], width, height }
export const geometry = (geo = "std") => {
  if (cache[geo]) return cache[geo]
  const rows = SHAPES[geo]
  if (!rows) throw new Error(`no board shape "${geo}"`)
  const mid = (rows.length - 1) / 2
  const tiles = []
  const vertices = []
  const edges = []
  const vKey = new Map()
  const eKey = new Map()
  const vertexAt = (x, y) => {
    const key = `${Math.round(x * 100)},${Math.round(y * 100)}`
    if (!vKey.has(key)) {
      vKey.set(key, vertices.length)
      vertices.push({ x, y, tiles: [], adj: [], edges: [] })
    }
    return vKey.get(key)
  }
  const edgeAt = (a, b) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`
    if (!eKey.has(key)) {
      eKey.set(key, edges.length)
      const va = vertices[a]
      const vb = vertices[b]
      edges.push({ a: Math.min(a, b), b: Math.max(a, b), tiles: [], x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2, angle: (Math.atan2(vb.y - va.y, vb.x - va.x) * 180) / Math.PI })
      vertices[a].edges.push(edges.length - 1)
      vertices[b].edges.push(edges.length - 1)
      vertices[a].adj.push(b)
      vertices[b].adj.push(a)
    }
    return eKey.get(key)
  }
  rows.forEach((len, row) => {
    for (let col = 0; col < len; col++) {
      const x = (col - (len - 1) / 2) * SQ3
      const y = (row - mid) * 1.5
      const id = tiles.length
      const corners = CORNERS.map(([dx, dy]) => vertexAt(x + dx, y + dy))
      corners.forEach((v) => vertices[v].tiles.push(id))
      tiles.push({ x, y, row, col, corners, edges: [], near: [] })
    }
  })
  tiles.forEach((t, id) => {
    t.edges = t.corners.map((v, i) => edgeAt(v, t.corners[(i + 1) % 6]))
    t.edges.forEach((e) => edges[e].tiles.push(id))
  })
  tiles.forEach((t, id) => {
    const near = new Set()
    t.edges.forEach((e) => edges[e].tiles.forEach((o) => o !== id && near.add(o)))
    t.near = [...near]
  })
  // the shoreline: edges with land on one side only, clockwise from the top left
  const coast = edges
    .map((e, i) => ({ i, e }))
    .filter(({ e }) => e.tiles.length === 1)
    .sort((p, q) => angleOf(p.e) - angleOf(q.e))
    .map(({ i }) => i)
  // which way is the sea, from each shore edge (a unit vector away from its tile)
  coast.forEach((i) => {
    const e = edges[i]
    const t = tiles[e.tiles[0]]
    const dx = e.x - t.x
    const dy = e.y - t.y
    const d = Math.hypot(dx, dy)
    e.out = [dx / d, dy / d]
  })
  const xs = vertices.map((v) => v.x)
  const ys = vertices.map((v) => v.y)
  const g = { geo, tiles, vertices, edges, coast, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
  cache[geo] = g
  return g
}

// clockwise from straight left (-180..180 degrees, so the sort starts at the left)
const angleOf = (e) => {
  const a = Math.atan2(e.y, e.x)
  return a < -Math.PI / 2 ? a + 2 * Math.PI : a
}

export const geoFor = (players) => (players > 4 ? "ext" : "std")

// ---------- making a map ----------

const shuffle = (list, random) => {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const expand = (counts) => Object.entries(counts).flatMap(([k, n]) => Array(n).fill(k))

// A seeded random number generator (the same seed, the same map)
export const seeded = (seed) => {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

// The beginner island: always the same, fair to everyone. Rows top to bottom.
const BEGINNER = {
  terrain: ["forest", "pasture", "fields", "hills", "mountains", "forest", "pasture", "fields", "pasture", "desert", "hills", "forest", "mountains", "fields", "forest", "mountains", "pasture", "hills", "fields"],
  numbers: [11, 5, 9, 4, 8, 3, 10, 6, 10, null, 5, 12, 3, 9, 4, 6, 8, 2, 11],
  harbors: ["any", "wool", "any", "ore", "grain", "any", "clay", "any", "timber"],
}

// how unfair a layout is: red numbers (6, 8) side by side are not allowed at all; matching
// numbers, same-terrain clumps and lopsided resources only count against it
export const layoutFlaws = (geo, tiles) => {
  const g = geometry(geo)
  let redPairs = 0
  let sameNumber = 0
  let clumps = 0
  g.tiles.forEach((t, i) => {
    t.near.forEach((j) => {
      if (j < i) return
      const a = tiles[i]
      const b = tiles[j]
      if (a.n && b.n && PIPS[a.n] === 5 && PIPS[b.n] === 5) redPairs++
      if (a.n && a.n === b.n) sameNumber++
      if (a.t === b.t && a.t !== "desert") clumps++
    })
  })
  return { redPairs, sameNumber, clumps }
}

// tiles: [{ t: terrain, n: number | null }], harbors: [{ e: edge, r: "any" | resource }],
// bandit: the (first) desert. layout: "random" | "balanced" | "beginner"
export const makeBoard = ({ geo = "std", layout = "balanced", random = Math.random } = {}) => {
  const g = geometry(geo)
  const mix = MIX[geo]
  let tiles
  let harborTypes
  if (layout === "beginner" && geo === "std") {
    tiles = BEGINNER.terrain.map((t, i) => ({ t, n: BEGINNER.numbers[i] }))
    harborTypes = BEGINNER.harbors
  } else {
    // the bigger island's beginner map is a balanced one that never changes
    const rnd = layout === "beginner" ? seeded(98) : random
    const balanced = layout !== "random"
    const deal = () => {
      const terrain = shuffle(expand(mix.terrain), rnd)
      const numbers = shuffle(mix.numbers, rnd)
      let k = 0
      return terrain.map((t) => ({ t, n: t === "desert" ? null : numbers[k++] }))
    }
    if (!balanced) tiles = deal()
    else {
      // the fairest of a few hundred deals with no red numbers touching
      let best = null
      let bestScore = Infinity
      for (let tries = 0; tries < 400; tries++) {
        const cand = deal()
        const f = layoutFlaws(geo, cand)
        if (f.redPairs) continue
        const score = f.sameNumber * 3 + f.clumps * 2 + spread(cand) + (deserts(geo, cand) ? 4 : 0)
        if (score < bestScore) [best, bestScore] = [cand, score]
        if (score <= 2) break
      }
      tiles = best || deal()
    }
    harborTypes = shuffle(mix.harbors, rnd)
  }
  const harbors = harborSpots(geo).map((e, i) => ({ e, r: harborTypes[i] }))
  const bandit = tiles.findIndex((t) => t.t === "desert")
  return { geo, tiles, harbors, bandit: bandit < 0 ? 0 : bandit }
}

// how lopsided the resources are: the gap between the richest and poorest resource's dots
// (scaled by how many tiles it has)
const spread = (tiles) => {
  const per = {}
  const count = {}
  tiles.forEach((t) => {
    const r = TERRAIN_RES[t.t]
    if (!r) return
    per[r] = (per[r] || 0) + (PIPS[t.n] || 0)
    count[r] = (count[r] || 0) + 1
  })
  const avg = Object.keys(per).map((r) => per[r] / count[r])
  return Math.max(...avg) - Math.min(...avg)
}

// both deserts of the big island side by side (a dead zone)
const deserts = (geo, tiles) => {
  const g = geometry(geo)
  return tiles.some((t, i) => t.t === "desert" && g.tiles[i].near.some((j) => tiles[j].t === "desert"))
}

// The harbors' shore edges, spread evenly around the island (never two touching)
export const harborSpots = (geo) => {
  const g = geometry(geo)
  const k = MIX[geo].harbors.length
  const n = g.coast.length
  const spots = []
  for (let i = 0; i < k; i++) {
    let idx = Math.round((i * n) / k + 1) % n
    // step off a shore edge whose corners touch only one tile (a lonely point of land) when
    // the next one over is better
    const lonely = (eid) => {
      const e = g.edges[eid]
      return g.vertices[e.a].tiles.length + g.vertices[e.b].tiles.length < 3
    }
    if (lonely(g.coast[idx]) && !lonely(g.coast[(idx + 1) % n])) idx = (idx + 1) % n
    spots.push(g.coast[idx])
  }
  return spots
}
