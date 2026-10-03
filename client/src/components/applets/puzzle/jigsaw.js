// Jigsaw puzzles: cutting a picture into interlocking pieces, and the rules for moving them
// (pieces that fit snap together into groups; a group near its spot snaps onto the board).
// Pure: no DOM. Coordinates are the picture's own pixels; the board is (0,0)-(width,height).
//
// Every inside edge is one wavy line with a tab, shared by the two pieces on either side
// (one gets the bump, the other the matching hole), so the pieces tile the picture exactly.

export const PIECE_COUNTS = [12, 24, 48, 96]

// A small seeded random number generator (mulberry32): the same seed cuts the same pieces
export const rng = (seed) => {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// cols x rows for `count` pieces whose cells are as square as possible on this picture
export const gridFor = (count, width, height) => {
  let best = null
  for (let cols = 1; cols <= count; cols++) {
    if (count % cols) continue
    const rows = count / cols
    const cellAspect = width / cols / (height / rows)
    const score = Math.abs(Math.log(cellAspect))
    if (!best || score < best.score) best = { cols, rows, score }
  }
  return { cols: best.cols, rows: best.rows }
}

const cubic = (p0, p1, p2, p3, steps, out) => {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const d = t * t * t
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]])
  }
}

// One tab edge in edge space: x runs 0..1 along the edge, y is sideways (1 = the edge's
// length across the cell). flip (+1/-1) says which side the bump is on.
const TAB = 0.1
export const tabShape = (random, flip, steps = 10) => {
  const j = () => (random() * 2 - 1) * 0.035
  const [a, b, c, d, e] = [j(), j(), j(), j(), j()]
  const t = TAB
  const p = [
    [0, 0],
    [0.2, a],
    [0.5 + b + d, -t + c],
    [0.5 - t + b, t + c],
    [0.5 - 2 * t + b - d, 3 * t + c],
    [0.5 + 2 * t + b - d, 3 * t + c],
    [0.5 + t + b, t + c],
    [0.5 + b + d, -t + c],
    [0.8, e],
    [1, 0],
  ].map(([x, y]) => [x, y * flip])
  const out = [[0, 0]]
  cubic(p[0], p[1], p[2], p[3], steps, out)
  cubic(p[3], p[4], p[5], p[6], steps, out)
  cubic(p[6], p[7], p[8], p[9], steps, out)
  return out
}

// Cut a width x height picture into `count` pieces.
// -> { cols, rows, cellW, cellH, width, height, pieces: [{ id, r, c, x, y, w, h, outline, bounds, edge }] }
// outline: the piece's polygon in picture pixels (clockwise from its top-left corner);
// bounds: its box { x, y, w, h }; edge: true for border pieces.
export const makeJigsaw = ({ count, width, height, seed = 1 }) => {
  const random = rng(seed)
  const { cols, rows } = gridFor(count, width, height)
  const cellW = width / cols
  const cellH = height / rows
  // horizontal edges: between row r-1 and r (r = 1..rows-1), at each column
  const hEdges = []
  for (let r = 1; r < rows; r++) {
    hEdges[r] = []
    for (let c = 0; c < cols; c++) {
      const y0 = r * cellH
      const shape = tabShape(random, random() < 0.5 ? 1 : -1)
      hEdges[r][c] = shape.map(([u, v]) => [c * cellW + u * cellW, y0 + v * cellH])
    }
  }
  // vertical edges: between column c-1 and c (c = 1..cols-1), at each row
  const vEdges = []
  for (let c = 1; c < cols; c++) {
    vEdges[c] = []
    for (let r = 0; r < rows; r++) {
      const x0 = c * cellW
      const shape = tabShape(random, random() < 0.5 ? 1 : -1)
      vEdges[c][r] = shape.map(([u, v]) => [x0 + v * cellW, r * cellH + u * cellH])
    }
  }

  const pieces = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cellW
      const y = r * cellH
      const pts = []
      const add = (list) => {
        for (const p of list) {
          const last = pts[pts.length - 1]
          if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) pts.push(p)
        }
      }
      // top: left to right
      add(r === 0 ? [[x, y], [x + cellW, y]] : hEdges[r][c])
      // right: top to bottom
      add(c === cols - 1 ? [[x + cellW, y], [x + cellW, y + cellH]] : vEdges[c + 1][r])
      // bottom: right to left
      add(r === rows - 1 ? [[x + cellW, y + cellH], [x, y + cellH]] : [...hEdges[r + 1][c]].reverse())
      // left: bottom to top
      add(c === 0 ? [[x, y + cellH], [x, y]] : [...vEdges[c][r]].reverse())
      if (pts.length > 1 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-9 && Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-9) pts.pop()
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const [px, py] of pts) {
        minX = Math.min(minX, px)
        minY = Math.min(minY, py)
        maxX = Math.max(maxX, px)
        maxY = Math.max(maxY, py)
      }
      pieces.push({
        id: r * cols + c,
        r,
        c,
        x,
        y,
        w: cellW,
        h: cellH,
        outline: pts,
        bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        edge: r === 0 || c === 0 || r === rows - 1 || c === cols - 1,
      })
    }
  }
  return { cols, rows, cellW, cellH, width, height, pieces, hEdges, vEdges }
}

// Is (x, y) inside a polygon? (even-odd rule)
export const insidePolygon = (pts, x, y) => {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// ---------- moving pieces ----------

// Rotating by quarter turns (clockwise on screen, y down)
export const rotateVec = (x, y, rot) => {
  switch (((rot % 4) + 4) % 4) {
    case 1:
      return [-y, x]
    case 2:
      return [-x, -y]
    case 3:
      return [y, -x]
    default:
      return [x, y]
  }
}

// The state of play: for each piece { x, y } where its cell's top-left would be (its center
// is what matters when rotated), rot (quarter turns), group id, placed (locked on the board).
// tray: pieces not yet on the table (phones keep them in a strip under the board).
export const center = (cut, s, id) => [s.pieces[id].x + cut.cellW / 2, s.pieces[id].y + cut.cellH / 2]
const correctCenter = (cut, id) => [cut.pieces[id].x + cut.cellW / 2, cut.pieces[id].y + cut.cellH / 2]

// The table around a width x height board where loose pieces start (and the view fits)
// (wide pictures get room above and below too)
export const TABLE = (width, height) => {
  const pad = width / height > 1.25 ? 0.42 : 0.06
  return { x: -width * 0.66, y: -height * pad, w: width * 2.32, h: height * (1 + 2 * pad) }
}

export const groupMembers =(s, group) => s.pieces.map((p, id) => (p.group === group ? id : -1)).filter((id) => id >= 0)

// Pieces spread around the board on a table `table` = { x, y, w, h } (picture pixels, can
// be beyond the board), avoiding the board where there's room. rotate: random quarter turns.
export const scatter = (cut, { seed = 1, rotate = false, table = null, inTray = false } = {}) => {
  const random = rng(seed ^ 0x5bd1e995)
  const { width, height, cellW, cellH } = cut
  const t = table || TABLE(width, height)
  const order = cut.pieces.map((p) => p.id)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  // areas left and right of the board (and above and below, if there's room), each a
  // loose grid of spots; bigger areas get more pieces
  const gap = Math.min(width, height) * 0.04
  const areas = [
    { x: t.x, y: t.y, w: -gap - t.x, h: t.h },
    { x: width + gap, y: t.y, w: t.x + t.w - width - gap, h: t.h },
    { x: 0, y: t.y, w: width, h: -gap - t.y },
    { x: 0, y: height + gap, w: width, h: t.y + t.h - height - gap },
  ].filter((a) => a.w > cellW * 0.9 && a.h > cellH * 0.9)
  const total = areas.reduce((sum, a) => sum + a.w * a.h, 0)
  const counts = areas.map((a) => Math.floor((order.length * a.w * a.h) / total))
  for (let i = 0; counts.reduce((x, y) => x + y, 0) < order.length; i++) counts[i % counts.length]++
  const spots = []
  areas.forEach((a, side) => {
    const k = counts[side]
    if (k <= 0) return
    const cols = Math.max(1, Math.round(Math.sqrt((k * a.w) / a.h)))
    const rows = Math.ceil(k / cols)
    for (let i = 0; i < k; i++) {
      const c = i % cols
      const r = Math.floor(i / cols)
      const sw = a.w / cols
      const sh = a.h / rows
      spots.push([a.x + (c + 0.5) * sw + (random() - 0.5) * sw * 0.3, a.y + (r + 0.5) * sh + (random() - 0.5) * sh * 0.3])
    }
  })
  const pieces = cut.pieces.map(() => null)
  order.forEach((id, i) => {
    const [cx, cy] = spots[i]
    pieces[id] = { x: cx - cellW / 2, y: cy - cellH / 2, rot: rotate ? Math.floor(random() * 4) : 0, group: id, placed: false, tray: inTray, z: i }
  })
  return { pieces, rotate, moves: 0 }
}

// Move a whole group by (dx, dy)
export const moveGroup = (s, group, dx, dy) => {
  for (const p of s.pieces) if (p.group === group) (p.x += dx), (p.y += dy)
}

// The part of the table a view shows, in picture pixels. view: { z, tx, ty }; size: the
// table's size on screen { w, h }
export const visibleArea = (view, size) => ({ x: -view.tx / view.z, y: -view.ty / view.z, w: size.w / view.z, h: size.h / view.z })

// The view zoomed in `zoom` times from the fitted view `fit`, centered on `center` (picture
// pixels; null: the middle), never showing anything the fitted view doesn't (so the board
// can't wander off). -> { z, tx, ty, center }
export const zoomedView = (fit, size, zoom = 1, center = null) => {
  const area = visibleArea(fit, size)
  const middle = { x: area.x + area.w / 2, y: area.y + area.h / 2 }
  if (zoom <= 1) return { ...fit, center: middle }
  const z = fit.z * zoom
  const halfW = size.w / z / 2
  const halfH = size.h / z / 2
  const c = center || middle
  const cx = Math.min(area.x + area.w - halfW, Math.max(area.x + halfW, c.x))
  const cy = Math.min(area.y + area.h - halfH, Math.max(area.y + halfH, c.y))
  return { z, tx: size.w / 2 - cx * z, ty: size.h / 2 - cy * z, center: { x: cx, y: cy } }
}

// Keep loose pieces where they can be seen: every loose group is moved (whole) so its
// pieces' centers lie inside `rect` ({ x, y, w, h }, picture pixels), or as close as it can
// for a group bigger than that. Pieces on the board or in the tray stay. -> groups moved
export const keepInside = (cut, s, rect) => {
  const moved = []
  const groups = new Set(s.pieces.filter((p) => !p.placed && !p.tray).map((p) => p.group))
  for (const group of groups) {
    const ids = groupMembers(s, group)
    const xs = ids.map((id) => s.pieces[id].x + cut.cellW / 2)
    const ys = ids.map((id) => s.pieces[id].y + cut.cellH / 2)
    const fit = (lo, hi, min, max) => (hi - lo > max - min ? min - lo : lo < min ? min - lo : hi > max ? max - hi : 0)
    const dx = fit(Math.min(...xs), Math.max(...xs), rect.x, rect.x + rect.w)
    const dy = fit(Math.min(...ys), Math.max(...ys), rect.y, rect.y + rect.h)
    if (dx || dy) {
      moveGroup(s, group, dx, dy)
      moved.push(group)
    }
  }
  return moved
}

// Rotate a group a quarter turn clockwise around one of its pieces
export const rotateGroup = (cut, s, id) => {
  const group = s.pieces[id].group
  if (s.pieces[id].placed) return false
  const [px, py] = center(cut, s, id)
  for (const m of groupMembers(s, group)) {
    const [cx, cy] = center(cut, s, m)
    const [rx, ry] = rotateVec(cx - px, cy - py, 1)
    const p = s.pieces[m]
    p.x = px + rx - cut.cellW / 2
    p.y = py + ry - cut.cellH / 2
    p.rot = (p.rot + 1) % 4
  }
  return true
}

const merge = (s, from, into) => {
  for (const p of s.pieces) if (p.group === from) p.group = into
}

// After a group is dropped: snap it to neighbors that fit and onto the board if it's close
// to its spot. tolerance in picture pixels. -> { joined: n pieces it joined, placed: bool }
export const settle = (cut, s, id, tolerance) => {
  const result = { joined: 0, placed: false }
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance
  let group = s.pieces[id].group
  // neighbors, a few rounds (joining can bring new neighbors close)
  for (let round = 0; round < 4; round++) {
    let joinedThisRound = false
    for (const m of groupMembers(s, group)) {
      const pm = s.pieces[m]
      const { r, c } = cut.pieces[m]
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr
        const nc = c + dc
        if (nr < 0 || nc < 0 || nr >= cut.rows || nc >= cut.cols) continue
        const n = nr * cut.cols + nc
        const pn = s.pieces[n]
        if (pn.group === group || pn.tray || pn.rot !== pm.rot) continue
        const [ox, oy] = rotateVec(dc * cut.cellW, dr * cut.cellH, pm.rot)
        const mc = center(cut, s, m)
        const want = [mc[0] + ox, mc[1] + oy]
        const have = center(cut, s, n)
        if (!near(want, have)) continue
        // the dropped group moves to fit the one it's joining
        moveGroup(s, group, have[0] - want[0], have[1] - want[1])
        const other = pn.group
        const otherPlaced = pn.placed
        merge(s, group, other)
        result.joined += groupMembers(s, other).length
        group = other
        if (otherPlaced) for (const p of s.pieces) if (p.group === group) p.placed = true
        joinedThisRound = true
        break
      }
      if (joinedThisRound) break
    }
    if (!joinedThisRound) break
  }
  // onto the board
  const members = groupMembers(s, group)
  if (!s.pieces[id].placed && s.pieces[id].rot === 0 && near(center(cut, s, id), correctCenter(cut, id))) {
    for (const m of members) {
      const p = s.pieces[m]
      p.x = cut.pieces[m].x
      p.y = cut.pieces[m].y
      p.placed = true
    }
    result.placed = true
  }
  // everything placed is one big group, so it moves (doesn't) together
  if (s.pieces[id].placed) {
    const placedGroup = s.pieces.find((p) => p.placed && p.group !== group)?.group
    if (placedGroup !== undefined) merge(s, group, placedGroup)
  }
  return result
}

export const isSolved = (s) => s.pieces.every((p) => p.placed)
export const placedCount = (s) => s.pieces.filter((p) => p.placed).length

// Dev/test helper: put every piece but `leave` of them in place
export const nearlySolve = (cut, s, leave = 2, pick = null) => {
  const left = new Set(pick || s.pieces.map((_, i) => i).filter((i) => !cut.pieces[i].edge).slice(-leave))
  let group = null
  s.pieces.forEach((p, i) => {
    if (left.has(i)) return
    p.x = cut.pieces[i].x
    p.y = cut.pieces[i].y
    p.rot = 0
    p.placed = true
    p.tray = false
    group ??= p.group
    p.group = group
  })
  for (const i of left) {
    const p = s.pieces[i]
    p.rot = 0
    p.placed = false
    p.group = 1000 + i
  }
  return [...left]
}
