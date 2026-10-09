// Roam: the sea from the map's coastline (OpenStreetMap natural=coastline). Pure; Node-tested
// (roam.test.js).
//
// OSM draws the coast as lines with the land on their left and the water on their right; the
// sea itself is never a polygon. Inside a box (a tile, or a whole town) the water is rebuilt
// the usual way: the coastline is joined end to end, clipped to the box, and each piece that
// leaves the box is joined to the next one that comes in by walking clockwise round the box's
// edge (the water side). Islands (closed coastline rings inside the box) are extra rings; the
// rings are read with the even-odd rule (an island inside the sea is land again).
//
// Coordinates here are a plain y-up plane (x east, y north). A box with no coastline in it is
// all sea or all land: `inside` (a point -> bool) decides.

// join lines that meet end to start (the coastline keeps one direction) -> [[ [x, y], ... ]]
export const joinLines = (lines) => {
  const key = (p) => `${p[0]},${p[1]}`
  const open = lines.filter((l) => l.length >= 2).map((l) => l.slice())
  const byStart = new Map()
  open.forEach((l, i) => byStart.set(key(l[0]), i))
  const used = new Uint8Array(open.length)
  const out = []
  // (start from lines nothing runs into, then whatever is left: rings)
  const ends = new Set(open.map((l) => key(l[l.length - 1])))
  const order = open.map((_, i) => i).sort((a, b) => (ends.has(key(open[a][0])) ? 1 : 0) - (ends.has(key(open[b][0])) ? 1 : 0))
  for (const i of order) {
    if (used[i]) continue
    used[i] = 1
    let line = open[i]
    for (;;) {
      const j = byStart.get(key(line[line.length - 1]))
      if (j === undefined || used[j]) break
      used[j] = 1
      line = line.concat(open[j].slice(1))
    }
    out.push(line)
  }
  return out
}

const closedRing = (l) => l.length >= 4 && l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1]

// a line clipped to a box -> pieces (Liang-Barsky per segment)
const clip = (pts, { x0, y0, x1, y1 }) => {
  const out = []
  let cur = null
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[i + 1]
    const dx = bx - ax
    const dy = by - ay
    let t0 = 0
    let t1 = 1
    let ok = true
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
      if (p === 0) {
        if (q < 0) ok = false
      } else {
        const r = q / p
        if (p < 0) t0 = Math.max(t0, r)
        else t1 = Math.min(t1, r)
      }
    }
    if (!ok || t0 > t1) {
      if (cur) out.push(cur)
      cur = null
      continue
    }
    const a = [ax + dx * t0, ay + dy * t0]
    const b = [ax + dx * t1, ay + dy * t1]
    if (!cur) cur = [a]
    else if (t0 > 0) {
      out.push(cur)
      cur = [a]
    }
    cur.push(b)
    if (t1 < 1) {
      out.push(cur)
      cur = null
    }
  }
  if (cur) out.push(cur)
  return out.filter((p) => p.length >= 2)
}

// where a point on the box's edge is, going clockwise from the top-left corner -> 0..perimeter
// (or -1 when it isn't on the edge)
const edgeParam = ([x, y], { x0, y0, x1, y1 }, eps) => {
  const W = x1 - x0
  const H = y1 - y0
  if (Math.abs(y - y1) <= eps) return Math.max(0, Math.min(W, x - x0))
  if (Math.abs(x - x1) <= eps) return W + Math.max(0, Math.min(H, y1 - y))
  if (Math.abs(y - y0) <= eps) return W + H + Math.max(0, Math.min(W, x1 - x))
  if (Math.abs(x - x0) <= eps) return 2 * W + H + Math.max(0, Math.min(H, y - y0))
  return -1
}

// the sea inside a box -> rings ([[x, y], ...], open: the last point isn't repeated), read
// even-odd; [] when the box is all land. coast: coastline lines (any order, y-up);
// inside(x, y): is a point the sea? (only asked when no coastline crosses the box)
export const seaRings = (coast, box, { inside = () => false } = {}) => {
  const { x0, y0, x1, y1 } = box
  const W = x1 - x0
  const H = y1 - y0
  const per = 2 * (W + H)
  const eps = Math.max(W, H) * 1e-7
  const islands = []
  const pieces = []
  for (const line of joinLines(coast)) {
    if (closedRing(line)) {
      // a ring wholly inside the box is an island; one that crosses the edge is cut like a line
      if (line.every(([x, y]) => x > x0 && x < x1 && y > y0 && y < y1)) {
        islands.push(line.slice(0, -1))
        continue
      }
      // (start the ring on the box's edge or outside it, so its pieces come out whole)
      let k = line.findIndex(([x, y]) => x <= x0 || x >= x1 || y <= y0 || y >= y1)
      if (k > 0) line.splice(0, line.length, ...line.slice(k, -1), ...line.slice(0, k + 1))
    }
    for (const p of clip(line, box)) {
      const tin = edgeParam(p[0], box, eps)
      const tout = edgeParam(p[p.length - 1], box, eps)
      // (a coastline that stops inside the box: broken data; we can't tell water from land)
      if (tin < 0 || tout < 0) return null
      pieces.push({ pts: p, tin, tout })
    }
  }
  const corners = [
    [0, [x0, y1]],
    [W, [x1, y1]],
    [W + H, [x1, y0]],
    [2 * W + H, [x0, y0]],
  ]
  const fwd = (a, b) => {
    const d = b - a
    return d < 0 ? d + per : d
  }
  const rings = []
  if (!pieces.length) {
    if (islands.length || inside(x0 + W / 2, y0 + H / 2)) rings.push(corners.map((c) => c[1]))
  } else {
    const used = new Uint8Array(pieces.length)
    for (let s = 0; s < pieces.length; s++) {
      if (used[s]) continue
      const ring = []
      let cur = s
      for (let guard = 0; guard <= pieces.length; guard++) {
        used[cur] = 1
        const P = pieces[cur]
        ring.push(...P.pts)
        // the next piece coming in, clockwise along the edge from where this one left
        let best = -1
        let bd = Infinity
        for (let j = 0; j < pieces.length; j++) {
          if (used[j] && j !== s) continue
          const d = fwd(P.tout, pieces[j].tin)
          if (d < bd) {
            bd = d
            best = j
          }
        }
        if (best < 0) break
        // the corners passed on the way
        const list = corners.map(([t, p]) => ({ d: fwd(P.tout, t), p })).filter((c) => c.d > 0 && c.d < bd).sort((a, b) => a.d - b.d)
        for (const c of list) ring.push(c.p)
        if (best === s) break
        cur = best
      }
      // (drop repeats)
      const clean = ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1])
      if (clean.length > 2 && clean[0][0] === clean[clean.length - 1][0] && clean[0][1] === clean[clean.length - 1][1]) clean.pop()
      if (clean.length >= 3) rings.push(clean)
    }
  }
  return rings.concat(islands)
}

// even-odd: is (x, y) inside the rings?
export const inRings = (rings, x, y) => {
  let inside = false
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i]
      const [xj, yj] = r[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  return inside
}

// the town-wide sea (build-town.mjs): coastline ways (compact Overpass elements) and the town's
// box -> (lat, lon) -> is it the sea? (null when the box has no coast)
export const townSea = (elements, bbox) => {
  const coast = elements.filter((el) => el && el.type === "way" && el.tags?.natural === "coastline").map((el) => el.geom.map(([lat, lon]) => [lon, lat]))
  if (!coast.length) return null
  const rings = seaRings(coast, { x0: bbox.west, y0: bbox.south, x1: bbox.east, y1: bbox.north })
  if (!rings) return null
  return (lat, lon) => inRings(rings, lon, lat)
}
