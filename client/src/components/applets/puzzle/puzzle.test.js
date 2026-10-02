// Photo Puzzle rules tests. Run: node --test client/src/components/applets/puzzle/
import test from "node:test"
import assert from "node:assert/strict"
import * as J from "./jigsaw.js"
import * as S from "./slide.js"

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

test("grids keep the cells close to square", () => {
  assert.deepEqual(J.gridFor(12, 400, 300), { cols: 4, rows: 3 })
  assert.deepEqual(J.gridFor(12, 300, 400), { cols: 3, rows: 4 })
  assert.deepEqual(J.gridFor(96, 1280, 960), { cols: 12, rows: 8 })
  assert.deepEqual(J.gridFor(24, 1000, 1000), { cols: 4, rows: 6 })
  for (const n of J.PIECE_COUNTS) {
    const { cols, rows } = J.gridFor(n, 1280, 853)
    assert.equal(cols * rows, n)
  }
})

for (const [count, width, height, seed] of [[12, 400, 300, 1], [24, 640, 480, 7], [48, 900, 1200, 42], [96, 1280, 853, 99]]) {
  test(`${count} pieces tile a ${width}x${height} picture exactly (seed ${seed})`, () => {
    const cut = J.makeJigsaw({ count, width, height, seed })
    assert.equal(cut.pieces.length, count)
    assert.equal(cut.pieces.filter((p) => p.edge).length, 2 * (cut.cols + cut.rows) - 4)
    // every point of the picture is in exactly one piece (sampled on a fine grid, a little
    // way off the cut lines where floating point can't decide)
    const random = J.rng(seed + 1)
    let samples = 0
    for (let i = 0; i < 6000; i++) {
      const x = random() * width
      const y = random() * height
      const owners = cut.pieces.filter((p) => J.insidePolygon(p.outline, x, y))
      // points right on an edge belong to one or two pieces; a tiny nudge decides
      if (owners.length !== 1) {
        const nudged = cut.pieces.filter((p) => J.insidePolygon(p.outline, x + 1e-4, y + 3e-4))
        assert.equal(nudged.length, 1, `point ${x.toFixed(2)},${y.toFixed(2)} is in ${owners.length} pieces`)
      }
      samples++
    }
    assert.equal(samples, 6000)
    // and nothing outside the picture belongs to a piece
    for (const [x, y] of [[-1, -1], [width + 1, height / 2], [width / 2, height + 1], [-0.5, height / 2]]) {
      assert.equal(cut.pieces.filter((p) => J.insidePolygon(p.outline, x, y)).length, 0)
    }
    // the pieces' areas add up to the picture's
    const area = (pts) => Math.abs(pts.reduce((sum, [x1, y1], i) => {
      const [x2, y2] = pts[(i + 1) % pts.length]
      return sum + x1 * y2 - x2 * y1
    }, 0)) / 2
    const total = cut.pieces.reduce((sum, p) => sum + area(p.outline), 0)
    assert.ok(close(total, width * height, 1e-6 * width * height), `areas add to ${total}, not ${width * height}`)
  })
}

test("neighbors' edges complement: one piece's tab is the next one's hole", () => {
  const cut = J.makeJigsaw({ count: 24, width: 600, height: 400, seed: 5 })
  const at = (r, c) => cut.pieces[r * cut.cols + c]
  // the shared edge appears in both outlines, in opposite directions
  const hasRun = (outline, run) => {
    const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`
    const text = outline.map(key).join(" ")
    // (the last point of a piece's outline is its first, so it isn't repeated)
    return text.includes(run.slice(0, -1).map(key).join(" "))
  }
  let tabsOut = 0
  for (let r = 0; r < cut.rows; r++) {
    for (let c = 0; c < cut.cols; c++) {
      if (c + 1 < cut.cols) {
        const edge = cut.vEdges[c + 1][r]
        assert.ok(hasRun(at(r, c).outline, edge), `right edge of ${r},${c}`)
        assert.ok(hasRun(at(r, c + 1).outline, [...edge].reverse()), `left edge of ${r},${c + 1}`)
        // the bump sticks out of exactly one of the two cells
        const x0 = (c + 1) * cut.cellW
        const out = edge.reduce((m, p) => (Math.abs(p[0] - x0) > Math.abs(m) ? p[0] - x0 : m), 0)
        assert.ok(Math.abs(out) > cut.cellW * 0.2, "a real tab")
        const owner = out > 0 ? at(r, c) : at(r, c + 1)
        assert.ok(owner.bounds.w > cut.cellW * 1.2, "the piece with the tab is wider than its cell")
        tabsOut++
      }
      if (r + 1 < cut.rows) {
        const edge = cut.hEdges[r + 1][c]
        assert.ok(hasRun(at(r, c).outline, [...edge].reverse()), `bottom edge of ${r},${c}`)
        assert.ok(hasRun(at(r + 1, c).outline, edge), `top edge of ${r + 1},${c}`)
      }
    }
  }
  assert.equal(tabsOut, (cut.cols - 1) * cut.rows)
  // the same seed cuts the same pieces; another seed cuts differently
  assert.deepEqual(J.makeJigsaw({ count: 24, width: 600, height: 400, seed: 5 }).pieces[7].outline, at(1, 1).outline)
  assert.notDeepEqual(J.makeJigsaw({ count: 24, width: 600, height: 400, seed: 6 }).pieces[7].outline, at(1, 1).outline)
})

test("pieces snap to fitting neighbors and onto the board", () => {
  const cut = J.makeJigsaw({ count: 12, width: 400, height: 300, seed: 3 })
  const s = J.scatter(cut, { seed: 3 })
  assert.equal(J.placedCount(s), 0)
  // put piece 0 near (not on) its spot: it snaps in
  s.pieces[0].x = 6
  s.pieces[0].y = -5
  assert.equal(J.settle(cut, s, 0, 12).placed, true)
  assert.deepEqual([s.pieces[0].x, s.pieces[0].y], [0, 0])
  // piece 5 and its right-hand neighbor 6, joined away from the board
  s.pieces[5].x = 900
  s.pieces[5].y = 900
  s.pieces[6].x = 900 + cut.cellW + 4
  s.pieces[6].y = 900 - 3
  const joined = J.settle(cut, s, 6, 12)
  assert.equal(joined.placed, false)
  assert.equal(s.pieces[5].group, s.pieces[6].group)
  assert.ok(close(s.pieces[6].x - s.pieces[5].x, cut.cellW) && close(s.pieces[6].y, s.pieces[5].y))
  // dragging the group: both move
  J.moveGroup(s, s.pieces[5].group, -800, -700)
  assert.ok(close(s.pieces[6].x - s.pieces[5].x, cut.cellW))
  // too far away: nothing happens
  s.pieces[1].x = 500
  s.pieces[1].y = 500
  assert.deepEqual(J.settle(cut, s, 1, 12), { joined: 0, placed: false })
  // rotated pieces only fit when turned the same way, and never onto the board
  const r = J.scatter(cut, { seed: 4 })
  r.pieces[0].rot = 1
  r.pieces[0].x = 2
  r.pieces[0].y = 2
  assert.equal(J.settle(cut, r, 0, 12).placed, false)
  for (let i = 0; i < 3; i++) J.rotateGroup(cut, r, 0)
  assert.equal(r.pieces[0].rot, 0)
  assert.equal(J.settle(cut, r, 0, 12).placed, true)
  // a rotated pair fits together rotated: piece 4 below piece 0 means "to the left" after a quarter turn
  const q = J.scatter(cut, { seed: 9 })
  q.pieces[1].rot = 1
  q.pieces[1].x = 1000
  q.pieces[1].y = 1000
  q.pieces[1 + cut.cols].rot = 1
  const [ox, oy] = J.rotateVec(0, cut.cellH, 1)
  q.pieces[1 + cut.cols].x = 1000 + ox + 3
  q.pieces[1 + cut.cols].y = 1000 + oy - 2
  J.settle(cut, q, 1 + cut.cols, 12)
  assert.equal(q.pieces[1].group, q.pieces[1 + cut.cols].group)
  // turning the group a quarter turn keeps the pieces together
  J.rotateGroup(cut, q, 1)
  J.rotateGroup(cut, q, 1)
  J.rotateGroup(cut, q, 1)
  const a = J.center(cut, q, 1)
  const b = J.center(cut, q, 1 + cut.cols)
  assert.ok(close(b[0] - a[0], 0) && close(b[1] - a[1], cut.cellH), "upright again: below")
})

test("solving the whole jigsaw", () => {
  const cut = J.makeJigsaw({ count: 24, width: 600, height: 400, seed: 11 })
  const s = J.scatter(cut, { seed: 11, rotate: true })
  const left = J.nearlySolve(cut, s, 2)
  assert.equal(left.length, 2)
  assert.equal(J.placedCount(s), 22)
  assert.equal(J.isSolved(s), false)
  for (const id of left) {
    s.pieces[id].x = cut.pieces[id].x + 3
    s.pieces[id].y = cut.pieces[id].y - 2
    J.settle(cut, s, id, 10)
  }
  assert.equal(J.isSolved(s), true)
  assert.equal(new Set(s.pieces.map((p) => p.group)).size, 1, "one piece of picture")
})

test("slide puzzle: only solvable shuffles", () => {
  assert.equal(S.isSolvable(S.solvedTiles(3), 3), true)
  assert.equal(S.isSolvable(S.solvedTiles(4), 4), true)
  // the famous unsolvable one: 14 and 15 swapped
  const fifteen = S.solvedTiles(4)
  ;[fifteen[13], fifteen[14]] = [fifteen[14], fifteen[13]]
  assert.equal(S.isSolvable(fifteen, 4), false)
  const eight = S.solvedTiles(3)
  ;[eight[0], eight[1]] = [eight[1], eight[0]]
  assert.equal(S.isSolvable(eight, 3), false)
  // solvability matches what random legal moves can reach
  for (const n of S.SLIDE_SIZES) {
    for (let seed = 1; seed <= 40; seed++) {
      assert.equal(S.isSolvable(S.scramble(n, 50 + seed, seed), n), true)
      const dealt = S.shuffle(n, seed)
      assert.equal(dealt.length, n * n)
      assert.deepEqual([...dealt].sort((a, b) => a - b), [...Array(n * n).keys()])
      assert.equal(S.isSolvable(dealt, n), true, `n=${n} seed=${seed}`)
      assert.equal(S.isSolved(dealt), false)
    }
  }
})

test("3x3 shuffles really can be solved (breadth-first search)", () => {
  const solve = (start) => {
    const goal = S.solvedTiles(3).join(",")
    const seen = new Set([start.join(",")])
    let frontier = [start]
    for (let depth = 0; depth <= 31; depth++) {
      const next = []
      for (const t of frontier) {
        if (t.join(",") === goal) return depth
        for (const i of S.neighbors(3, t.indexOf(0))) {
          const m = S.move(t, 3, i).tiles
          const key = m.join(",")
          if (!seen.has(key)) seen.add(key), next.push(m)
        }
      }
      frontier = next
    }
    return -1
  }
  for (const seed of [1, 2, 3]) assert.ok(solve(S.shuffle(3, seed)) > 0)
})

test("slide moves: a tile next to the gap, or a whole row/column of them", () => {
  const t = S.solvedTiles(3) // 1 2 3 / 4 5 6 / 7 8 _
  assert.equal(S.canMove(t, 3, 0), false)
  assert.equal(S.canMove(t, 3, 7), true)
  const one = S.move(t, 3, 7)
  assert.deepEqual(one, { tiles: [1, 2, 3, 4, 5, 6, 7, 0, 8], moved: 1 })
  const row = S.move(t, 3, 6)
  assert.deepEqual(row, { tiles: [1, 2, 3, 4, 5, 6, 0, 7, 8], moved: 2 })
  const col = S.move(t, 3, 2)
  assert.deepEqual(col, { tiles: [1, 2, 0, 4, 5, 3, 7, 8, 6], moved: 2 })
  assert.deepEqual(S.move(t, 3, 4).moved, 0)
  assert.equal(S.isSolved(S.move(one.tiles, 3, 8).tiles), true)
})
