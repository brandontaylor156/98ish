// Venue Finder index build: which boxes of the world are asked, how they line up, and which of
// them a cache already covers. Pure (no I/O), so the Action's split and the resume logic can be
// tested (tiles.test.mjs).
//
// Every named region is a set of cells of ONE global 5 x 10 degree grid (lat a multiple of 5,
// lon a multiple of 10), so regions that overlap (us-west and canada, uk and europe) share the
// same cached answers instead of asking twice. "rest" is everything else, in 20 x 40 boxes; a
// box that touches a named region is halved (10 x 20, then 5 x 10) and the named cells dropped.
// A tile the server turns down is split in four (askTile in build-index.mjs) down to 1.25 x 2.5.

export const GRID = [5, 10]
export const BIG = [20, 40]
export const SMALL_LAT = 1.25

// [south, west, north, east] boxes per region; a region is the grid cells its boxes touch
export const REGION_BOXES = {
  // lower 48 west of -100 (+ Hawaii, southern Alaska)
  "us-west": [[24, -125, 50, -100], [18, -161, 23, -154], [55, -155, 65, -140]],
  "us-east": [[24, -100, 50, -66]],
  canada: [[41, -141, 60, -52]],
  europe: [[35, -10, 71, 40]],
  oceania: [[-48, 112, -10, 179]],
  // smaller handy sets (inside the ones above, same cells)
  us: [[24, -125, 50, -66], [18, -161, 23, -154], [55, -155, 65, -140]],
  uk: [[49, -9, 61, 2]],
  spain: [[35, -10, 44, 5]],
  australia: [[-44, 112, -10, 154]],
  california: [[32, -125, 43, -114]],
}
// the regions the world is split into ("rest" = everything not in one of these)
export const NAMED = ["us-west", "us-east", "canada", "europe", "oceania"]
// the order a full build asks them in (the owner's priority: the US, Canada, the UK, Australia,
// Spain, then everything else)
export const WORLD_ORDER = ["us-west", "us-east", "canada", "uk", "australia", "spain", "europe", "oceania", "rest"]

const key = (t) => t.join(",")
const fl = (v, s) => Math.floor(v / s) * s
// the grid cells a box touches
export const cellsOf = ([s, w, n, e]) => {
  const out = []
  for (let la = fl(s, GRID[0]); la < n; la += GRID[0]) for (let lo = fl(w, GRID[1]); lo < e; lo += GRID[1]) out.push([la, lo, la + GRID[0], lo + GRID[1]])
  return out
}
const regionCells = (name) => {
  const seen = new Map()
  for (const b of REGION_BOXES[name] || []) for (const c of cellsOf(b)) seen.set(key(c), c)
  return [...seen.values()]
}
const namedSet = () => new Set(NAMED.flatMap(regionCells).map(key))
// the rest of the world: big boxes, halved round the named cells
export const restTiles = () => {
  const named = namedSet()
  const out = []
  const visit = (t) => {
    const cells = cellsOf(t)
    const inNamed = cells.filter((c) => named.has(key(c))).length
    if (!inNamed) return out.push(t)
    if (inNamed === cells.length) return
    const [s, w, n, e] = t
    const ml = (s + n) / 2
    const mo = (w + e) / 2
    for (const q of [[s, w, ml, mo], [s, mo, ml, e], [ml, w, n, mo], [ml, mo, n, e]]) visit(q)
  }
  for (let la = -60; la < 80; la += BIG[0]) for (let lo = -180; lo < 180; lo += BIG[1]) visit([la, lo, la + BIG[0], lo + BIG[1]])
  return out
}
// --region a,b,c -> the tiles to ask, in order, without repeats. "world" (or "all") = WORLD_ORDER.
export const planTiles = (regionArg = "world") => {
  const names = String(regionArg)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .flatMap((x) => (x === "world" || x === "all" ? WORLD_ORDER : [x]))
  const seen = new Set()
  const out = []
  for (const name of names) {
    if (name !== "rest" && !REGION_BOXES[name]) throw new Error(`unknown region "${name}" (one of ${Object.keys(REGION_BOXES).join(", ")}, rest, world)`)
    for (const t of name === "rest" ? restTiles() : regionCells(name)) {
      if (seen.has(key(t))) continue
      seen.add(key(t))
      out.push(t)
    }
  }
  return out
}
// the four quarters a turned-down tile is asked as instead
export const quarters = ([a, b, c, e]) => {
  const ml = (a + c) / 2
  const mo = (b + e) / 2
  return [[a, b, ml, mo], [a, mo, ml, e], [ml, b, c, mo], [ml, mo, c, e]]
}
// is a tile answered by the cache (`has(tile)`), itself or through its quarters?
export const isCovered = (t, has) => has(t) || (t[2] - t[0] > SMALL_LAT && quarters(t).every((q) => isCovered(q, has)))
// a padded box (for the towns asked round a tile's courts)
export const pad = ([s, w, n, e], d) => [Math.max(-90, s - d), Math.max(-180, w - d), Math.min(90, n + d), Math.min(180, e + d)]
// the cells (a quarter degree) that hold venues, padded, merged into runs along each row: the
// boxes the towns are asked for (only round the courts: a 5 x 10 tile of Europe holds 100,000
// villages; the nearest town to a court is almost always within the pad, about 15 km)
export const townBoxes = (points, padDeg = 0.15, cell = 0.25) => {
  const cells = new Set(points.map(([la, lo]) => `${Math.floor(la / cell)},${Math.floor(lo / cell)}`))
  const rows = new Map()
  for (const c of cells) {
    const [la, lo] = c.split(",").map(Number)
    if (!rows.has(la)) rows.set(la, [])
    rows.get(la).push(lo)
  }
  const out = []
  for (const [la, los] of rows) {
    los.sort((a, b) => a - b)
    let start = los[0]
    let prev = los[0]
    for (const lo of [...los.slice(1), Infinity]) {
      if (lo - prev <= 2) {
        prev = lo
        continue
      }
      out.push(pad([la * cell, start * cell, (la + 1) * cell, (prev + 1) * cell], padDeg).map((v) => Math.round(v * 100) / 100))
      start = prev = lo
    }
  }
  return out
}
