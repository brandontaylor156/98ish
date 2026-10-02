// Rules tests for Block Ten. Run: node --test client/src/components/applets/blockten/
import test from "node:test"
import assert from "node:assert/strict"
import * as E from "./engine.js"

const { SIZE, PIECES, PIECE_IDS, at } = E

// a board from 10 strings: "." empty, anything else filled
const boardOf = (rows) => rows.flatMap((row) => [...row].map((ch) => (ch === "." ? 0 : 1)))
const stateWith = (board, tray, extra = {}) => ({ ...E.newGame({ seed: 1 }), board, tray, ...extra })

test("every piece fits its bounding box exactly, with no repeated cells", () => {
  assert.equal(PIECE_IDS.length, 19)
  for (const id of PIECE_IDS) {
    const p = PIECES[id]
    const keys = new Set(p.cells.map(([r, c]) => `${r},${c}`))
    assert.equal(keys.size, p.cells.length, `${id} repeats a cell`)
    for (const [r, c] of p.cells) assert.ok(r >= 0 && c >= 0 && r < p.h && c < p.w, `${id} has a cell outside its box`)
    // it touches every edge of its box
    assert.ok(p.cells.some(([r]) => r === 0) && p.cells.some(([r]) => r === p.h - 1), `${id} top/bottom`)
    assert.ok(p.cells.some(([, c]) => c === 0) && p.cells.some(([, c]) => c === p.w - 1), `${id} left/right`)
    // and it fits on an empty board exactly where its box fits
    const empty = E.emptyBoard()
    assert.equal(E.spotsFor(empty, id).length, (SIZE - p.h + 1) * (SIZE - p.w + 1), `${id} spots`)
    assert.ok(E.canPlace(empty, id, SIZE - p.h, SIZE - p.w))
    assert.ok(!E.canPlace(empty, id, SIZE - p.h + 1, 0))
    assert.ok(!E.canPlace(empty, id, 0, SIZE - p.w + 1))
    assert.ok(!E.canPlace(empty, id, -1, 0))
  }
})

test("no two pieces are the same shape", () => {
  const shapes = PIECE_IDS.map((id) => PIECES[id].cells.map(([r, c]) => `${r},${c}`).sort().join(" "))
  assert.equal(new Set(shapes).size, shapes.length)
})

test("the seeded random repeats and spreads evenly", () => {
  const a = E.newGame({ seed: 42 })
  const b = E.newGame({ seed: 42 })
  assert.deepEqual(a.tray, b.tray)
  let seed = 7
  const counts = new Array(10).fill(0)
  for (let i = 0; i < 20000; i++) {
    const [r, next] = E.nextRandom(seed)
    assert.ok(r >= 0 && r < 1)
    counts[Math.floor(r * 10)]++
    seed = next
  }
  for (const n of counts) assert.ok(n > 1800 && n < 2200, `bucket ${n}`)
  assert.equal(E.dailySeed("2026-10-02"), E.dailySeed("2026-10-02"))
  assert.notEqual(E.dailySeed("2026-10-02"), E.dailySeed("2026-10-03"))
  assert.equal(E.dailyKey(new Date(2026, 0, 5)), "2026-01-05")
})

test("placing a piece scores a point per cell and refuses overlaps", () => {
  const s = stateWith(E.emptyBoard(), ["sq2", "h3", "dot"])
  const { state, result } = E.place(s, 0, 4, 4)
  assert.equal(result.points, 4)
  assert.equal(state.score, 4)
  assert.deepEqual(state.tray, [null, "h3", "dot"])
  assert.ok(state.board[at(5, 5)])
  assert.equal(E.place(state, 1, 5, 3), null, "overlaps the square")
  assert.equal(E.place(state, 0, 0, 0), null, "slot already used")
  assert.equal(E.place(state, 1, 0, 8), null, "off the right edge")
})

test("a full row clears, and so does a full column", () => {
  const rowBoard = boardOf([
    "#########.",
    "..........", "..........", "..........", "..........",
    "..........", "..........", "..........", "..........", "..........",
  ])
  let { state, result } = E.place(stateWith(rowBoard, ["dot", "dot", "dot"]), 0, 0, 9)
  assert.deepEqual(result.rows, [0])
  assert.deepEqual(result.cols, [])
  assert.equal(result.cleared.length, 10)
  assert.ok(state.board.every((v) => !v))
  // 1 cell + 10 for the line + the empty-board bonus
  assert.equal(result.points, 1 + 10 + E.CLEAR_BOARD_BONUS)

  const colBoard = E.emptyBoard()
  for (let r = 0; r < 7; r++) colBoard[at(r, 3)] = 2
  colBoard[at(0, 0)] = 2
  ;({ state, result } = E.place(stateWith(colBoard, ["v3", "dot", "dot"]), 0, 7, 3))
  assert.deepEqual(result.cols, [3])
  assert.equal(result.points, 3 + 10)
  assert.equal(state.board.filter(Boolean).length, 1)
})

test("several lines at once: a combo scores more, and the crossing cell counts once", () => {
  // row 8 and column 8 are full except the cell they share
  const b = boardOf([
    "........##",
    "........##",
    "........##",
    "........##",
    "........##",
    "........##",
    "........##",
    "........##",
    "########.#",
    "#########.",
  ])
  const s = stateWith(b, ["dot", "dot", "sq3"])
  const first = E.place(s, 0, 8, 8)
  assert.deepEqual(first.result.rows, [8])
  assert.deepEqual(first.result.cols, [8])
  assert.equal(first.result.combo, 2)
  assert.equal(first.result.clearPoints, 30)
  assert.equal(first.result.cleared.length, 19)

  // three lines at once
  const b3 = boardOf([
    ".#########",
    ".#########",
    ".#########",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
  ])
  const r3 = E.place(stateWith(b3, ["v3", "dot", "dot"]), 0, 0, 0).result
  assert.equal(r3.combo, 3)
  assert.equal(r3.clearPoints, 60)
  assert.deepEqual(E.wouldClear(b3, "v3", 0, 0), { rows: [0, 1, 2], cols: [] })
})

test("line points grow with the combo and with the streak", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((n) => E.linePoints(n)), [0, 10, 30, 60, 100, 150])
  assert.equal(E.linePoints(1, 2), 15)
  assert.equal(E.linePoints(2, 3), 60)
  assert.equal(E.linePoints(1, 0), 10)

  // two clearing moves in a row: the second gets the streak bonus; a dry move resets it
  const b = boardOf([
    "#########.",
    "#########.",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "#.........",
  ])
  let s = stateWith(b, ["dot", "dot", "dot"])
  let r = E.place(s, 0, 0, 9)
  assert.equal(r.result.streak, 1)
  assert.equal(r.result.clearPoints, 10)
  r = E.place(r.state, 1, 1, 9)
  assert.equal(r.result.streak, 2)
  assert.equal(r.result.clearPoints, 15)
  r = E.place(r.state, 2, 5, 5)
  assert.equal(r.result.streak, 0)
  assert.equal(r.state.streak, 0)
})

test("game over: nothing left fits", () => {
  // a checkerboard: only single dots fit
  const checker = Array.from({ length: SIZE * SIZE }, (_, i) => ((Math.floor(i / SIZE) + (i % SIZE)) % 2 ? 1 : 0))
  assert.ok(!E.anyMove(stateWith(checker, ["h2", "v2", "sq2"])))
  assert.ok(E.anyMove(stateWith(checker, ["h2", "dot", null])))
  assert.ok(!E.anyMove(stateWith(checker, [null, null, "l2a"])))

  // one 3x3 hole in the corner fits a big square, nothing larger
  const hole = new Array(SIZE * SIZE).fill(1)
  for (let r = 7; r < 10; r++) for (let c = 7; c < 10; c++) hole[at(r, c)] = 0
  assert.ok(E.anyMove(stateWith(hole, ["sq3", null, null])))
  assert.ok(!E.anyMove(stateWith(hole, ["h4", "v5", "h5"])))
  for (const id of ["l3a", "l3b", "l3c", "l3d", "l2a", "l2b", "l2c", "l2d", "h3", "v3", "sq2"]) assert.ok(E.fitsAnywhere(hole, id), id)

  // the last placement leaves the remaining pieces nowhere to go: over
  const slot = checker.slice()
  slot[at(0, 1)] = 0 // the only two empty cells side by side
  const r = E.place(stateWith(slot, ["h2", "h2", null]), 0, 0, 0)
  assert.equal(r.result.combo, 0)
  assert.equal(r.state.over, "stuck")
  assert.equal(r.result.over, "stuck")
  assert.equal(E.place(stateWith(slot, ["h2", "dot", null]), 0, 0, 0).state.over, null, "a dot still fits")
  assert.equal(E.place(r.state, 1, 0, 0), null, "no moves once over")
})

test("a new tray comes when all three are placed", () => {
  let s = stateWith(E.emptyBoard(), ["dot", "dot", "dot"])
  s = E.place(s, 0, 0, 0).state
  s = E.place(s, 1, 0, 2).state
  assert.deepEqual(s.tray, [null, null, "dot"])
  const r = E.place(s, 2, 0, 4)
  assert.ok(r.result.dealt)
  assert.ok(r.state.tray.every((id) => PIECES[id]))
})

test("one undo per game, which brings back the same piece and the same next tray", () => {
  let s = E.newGame({ seed: 99 })
  const first = s.tray[0]
  const a = E.place(s, 0, 0, 0).state
  assert.ok(E.canUndo(a))
  const back = E.undo(a)
  assert.equal(back.tray[0], first)
  assert.equal(back.score, 0)
  assert.equal(back.undos, 0)
  assert.ok(!E.canUndo(back))
  const again = E.place(back, 0, 0, 0).state
  assert.ok(!E.canUndo(again), "used up")
  assert.equal(E.undo(again), again)
})

test("blast mode runs out of time", () => {
  let s = E.newGame({ mode: "blast", seed: 3 })
  assert.equal(s.timeLeft, E.BLAST_SECONDS)
  s = E.tick(s, 100)
  assert.equal(s.over, null)
  s = E.tick(s, 100)
  assert.equal(s.timeLeft, 0)
  assert.equal(s.over, "time")
  assert.equal(E.tick(E.newGame(), 500).over, null, "classic has no clock")
})

test("saved games are checked before they're trusted", () => {
  assert.ok(E.isValidState(E.newGame()))
  assert.ok(!E.isValidState({ mode: "classic", board: [], tray: [] }))
  assert.ok(!E.isValidState({ ...E.newGame(), tray: ["nope", null, null] }))
  assert.ok(!E.isValidState(null))
})

test("random games always end correctly (fuzz)", () => {
  for (let g = 0; g < 40; g++) {
    let s = E.newGame({ seed: g * 7919 + 1 })
    let n = 0
    while (!s.over && n < 2000) {
      // greedy-ish: the first piece and spot that fits
      let moved = false
      for (let slot = 0; slot < 3 && !moved; slot++) {
        const id = s.tray[slot]
        if (!id) continue
        const spots = E.spotsFor(s.board, id)
        if (!spots.length) continue
        const [r, c] = spots[(g + n) % spots.length]
        s = E.place(s, slot, r, c).state
        moved = true
      }
      assert.ok(moved, "anyMove said yes but nothing moved")
      n++
      assert.ok(E.fullLines(s.board).rows.length === 0 && E.fullLines(s.board).cols.length === 0, "a full line was left")
    }
    assert.ok(s.over === "stuck")
    assert.ok(!E.anyMove(s))
  }
})
