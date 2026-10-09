// Roam: which way you face when you arrive (docs/open-world.md "Arriving"). The owner's first
// look at Valencia's Town Center faced a flat grey wall filling the screen; now every start spot
// turns you to its best view: the longest open sightline (down the street or across the plaza),
// with the most life in it (shops and places to eat, other buildings, trees). Pure; Node-tested
// (life.test.js: no start's view is blocked within ~25 m).

import { BUILDING_KINDS, isHouse, tileSeaAt } from "../data/tile.js"

export const VIEW_MAX = 150 // how far a sightline is followed (m)
export const VIEW_CLEAR = 25 // a view must be open at least this far across its middle (m)
// the rays that make up the view's middle (radians either side of the heading): about the
// middle of a phone's view behind the walker
export const VIEW_CONE = [-0.32, -0.16, 0, 0.16, 0.32]
const SHOPPY = new Set(["retail", "commercial", "supermarket", "hotel", "office", "civic", "public", "library", "college", "university"])
const LIVELY = /^(restaurant|cafe|fast_food|ice_cream|food_court|bar|pub|cinema|theatre|marketplace|mall|department_store|clothes|shoes|books|gift|bakery|supermarket|convenience|ice_rink|fountain|library|arts_centre|hotel)$/

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

// how open a heading is: segment(ax, az, bx, bz) -> the fraction to the first wall (1 = none)
// -> { center, clear } (m): straight ahead, and the shortest of the view's middle rays
export const sightline = (x, z, yaw, segment, max = VIEW_MAX) => {
  let clear = Infinity
  let center = max
  for (const da of VIEW_CONE) {
    const a = yaw + da
    const t = Math.min(1, Math.max(0, segment(x, z, x + Math.sin(a) * max, z + Math.cos(a) * max)))
    clear = Math.min(clear, t * max)
    if (da === 0) center = t * max
  }
  return { center, clear }
}

// what's worth seeing in a heading's view (the tiles' buildings, places and trees within 160 m
// and about 35 degrees either side) -> a score
export const lifeIn = (x, z, yaw, tiles, reach = 160) => {
  let shops = 0
  let other = 0
  let places = 0
  let trees = 0
  const inView = (px, pz, lo = 6) => {
    const dx = px - x
    const dz = pz - z
    const d = Math.hypot(dx, dz)
    if (d < lo || d > reach) return false
    return Math.abs(wrap(Math.atan2(dx, dz) - yaw)) < 0.62
  }
  for (const t of tiles) {
    for (const b of t.buildings) {
      if (isHouse(b.kind) || b.area < 120 || !b.ring.length) continue
      let cx = 0
      let cz = 0
      for (const p of b.ring) {
        cx += p.x
        cz += p.z
      }
      cx /= b.ring.length
      cz /= b.ring.length
      if (!inView(cx, cz, 12)) continue
      if (SHOPPY.has(BUILDING_KINDS[b.kind])) shops++
      else other++
    }
    for (const p of t.pois || []) if (LIVELY.test(p.kind) && inView(p.x, p.z)) places++
    for (const q of t.vegTrees || []) if (q.r >= 2 && inView(q.x, q.z, 8)) trees++
    for (const q of t.trees || []) if (inView(q.x, q.z, 8)) trees++
    // (at the coast: a pier, and the sea itself, are the view)
    for (const p of t.platforms || []) if (p.ring?.some((q) => inView(q.x, q.z))) places += 2
    if (t.sea?.length && t.rect) {
      const sx = x + Math.sin(yaw) * 80
      const sz = z + Math.cos(yaw) * 80
      if (sx >= t.rect.x0 && sx < t.rect.x1 && sz >= t.rect.z0 && sz < t.rect.z1 && tileSeaAt(t, sx, sz)) places += 2
    }
  }
  return Math.min(10, shops) * 3 + Math.min(10, other) + Math.min(8, places) * 3 + Math.min(40, trees) * 0.35
}

// the best way to face from (x, z) -> { yaw, center, clear, life, score }. The view must be open
// at least VIEW_CLEAR across its middle (any heading that is wins over every one that isn't);
// among those, a long view down a street or a plaza with life along it.
export const bestFacing = (x, z, { segment, tiles = [], rays = 48, prefer = null } = {}) => {
  let best = null
  for (let i = 0; i < rays; i++) {
    const yaw = wrap((i / rays) * Math.PI * 2)
    const { center, clear } = sightline(x, z, yaw, segment)
    const life = lifeIn(x, z, yaw, tiles)
    let score = Math.min(center, VIEW_MAX) * 0.35 + Math.min(clear, 80) * 0.6 + life
    // (a hint from the town's config, if it has one: a small nudge, never past a wall)
    if (prefer !== null) score += 6 * Math.cos(yaw - prefer)
    const open = clear >= VIEW_CLEAR
    const cand = { yaw, center, clear, life, score, open }
    if (!best || (open && !best.open) || (open === best.open && (open ? score > best.score : clear > best.clear))) best = cand
  }
  return best
}
