// The Tetris engine (shared by the browser and the server's computer players): 7-bag,
// SRS kicks, T-spins, scoring, the attack table, garbage, modes and the bot
import test from "node:test"
import assert from "node:assert/strict"
import * as E from "../../../client/src/components/applets/tetris/utils/engine.js"
import { kicksFor, TYPES } from "../../../client/src/components/applets/tetris/utils/tetrominoes.js"
import { MODES, beats, resultValue } from "../../../client/src/components/applets/tetris/utils/modes.js"
import { botMove, placements } from "../../../client/src/components/applets/tetris/utils/bot.js"

// A board from strings for its bottom rows: "X" a block, "." empty
const boardFrom = (rows) => {
  const board = Array.from({ length: E.ROWS }, () => Array(E.COLUMNS).fill(null))
  rows.forEach((text, i) => {
    const y = E.ROWS - rows.length + i
    ;[...text].forEach((c, x) => (board[y][x] = c === "." ? null : c === "X" ? "J" : c))
  })
  return board
}
const game = (options = {}) => E.createGame({ seed: 42, ...options })
const withPiece = (state, board, active, extra = {}) => ({ ...state, board, active, lastAction: "move", lastKick: 0, lowestY: active.y, ...extra })

// ---------- 7-bag ----------

test("7-bag: every bag of seven holds each piece once", () => {
  const seq = E.sequenceFor(1234, 7 * 100)
  for (let i = 0; i < seq.length; i += 7) assert.deepEqual([...seq.slice(i, i + 7)].sort(), [...TYPES].sort())
})

test("7-bag: a seed always gives the same pieces, and the game deals them in order", () => {
  assert.deepEqual(E.sequenceFor(99, 50), E.sequenceFor(99, 50))
  assert.notDeepEqual(E.sequenceFor(99, 50), E.sequenceFor(100, 50))
  let g = E.createGame({ seed: 99 })
  const dealt = [g.active.type]
  for (let i = 0; i < 20; i++) {
    g = E.hardDrop(g)
    if (g.status !== "playing") break
    dealt.push(g.active.type)
  }
  assert.deepEqual(dealt, E.sequenceFor(99, dealt.length))
  // never more than 12 pieces between two of the same kind
  const seq = E.sequenceFor(7, 700)
  for (const t of TYPES) {
    let last = -1
    seq.forEach((p, i) => {
      if (p !== t) return
      if (last >= 0) assert.ok(i - last <= 13)
      last = i
    })
  }
})

// ---------- SRS ----------

test("SRS kick tables: the published offsets (y up)", () => {
  assert.deepEqual(kicksFor("T", 0, 1), [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]])
  assert.deepEqual(kicksFor("J", 1, 0), [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]])
  assert.deepEqual(kicksFor("L", 3, 2), [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]])
  assert.deepEqual(kicksFor("I", 0, 1), [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]])
  assert.deepEqual(kicksFor("I", 3, 0), [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]])
  // every from/to pair is mirrored by its reverse
  for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0]]) {
    for (const t of ["T", "I"]) {
      const there = kicksFor(t, a, b)
      const back = kicksFor(t, b, a)
      assert.deepEqual(back, there.map(([x, y]) => [-x || 0, -y || 0]))
    }
  }
})

test("SRS: a vertical I against the right wall kicks out when rotated", () => {
  const g0 = game()
  // vertical I (rotation 1 fills column x+2) hugging the right wall
  const g = withPiece(g0, boardFrom([]), { type: "I", rotation: 1, x: 7, y: 5 })
  const r = E.rotate(g, -1) // back to flat: needs a kick to the left
  assert.equal(r.active.rotation, 0)
  assert.ok(r.active.x <= 6, `kicked left, x=${r.active.x}`)
  assert.equal(r.lastKick > 0, true)
  // counter-clockwise and clockwise are inverses in open space
  const open = withPiece(g0, boardFrom([]), { type: "T", rotation: 0, x: 3, y: 5 })
  assert.deepEqual(E.rotate(E.rotate(open, 1), -1).active, open.active)
  // O never rotates
  const o = withPiece(g0, boardFrom([]), { type: "O", rotation: 0, x: 4, y: 5 })
  assert.equal(E.rotate(o, 1), o)
})

test("SRS: a T can be rotated into a T-spin double slot", () => {
  const board = boardFrom(["...X......", "XXX...XXXX", "XXXX.XXXXX"])
  const g0 = game()
  let found = null
  for (const rotation of [1, 3])
    for (let x = 0; x < 9; x++)
      for (let y = 14; y < 20; y++) {
        const g = withPiece(g0, board, { type: "T", rotation, x, y })
        if (!E.fits(board, g.active)) continue
        for (const dir of [1, -1]) {
          const r = E.rotate(g, dir)
          if (r.active.rotation === 2 && r.active.x === 3 && r.active.y === 19) found ||= r
        }
      }
  assert.ok(found, "some rotation lands in the slot")
  const done = E.hardDrop(found)
  assert.deepEqual(done.lastClear.labels.slice(0, 1), ["T-Spin Double"])
  assert.equal(done.stats.tSpins.double, 1)
})

// ---------- T-spins ----------

test("T-spin detection: double, mini single, triple (by the last kick), none without a rotation", () => {
  const g0 = game()
  const tsd = withPiece(g0, boardFrom(["...X......", "XXX...XXXX", "XXXX.XXXXX"]), { type: "T", rotation: 2, x: 3, y: 19 }, { lastAction: "rotate" })
  assert.equal(E.detectTSpin(tsd), "full")
  const after = E.hardDrop(tsd)
  assert.equal(after.lines, 2)
  assert.equal(after.score, 1200) // T-spin double at level 1
  assert.equal(after.attack.lines, 4)

  const mini = withPiece(g0, boardFrom(["X.........", "...XXXXXXX"]), { type: "T", rotation: 0, x: 0, y: 20 }, { lastAction: "rotate" })
  assert.equal(E.detectTSpin(mini), "mini")
  const m = E.hardDrop(mini)
  assert.equal(m.lastClear.labels[0], "T-Spin Mini Single")
  assert.equal(m.attack, null) // a mini single sends nothing

  // three corners with only one on the pointed side: mini, unless the final kick was used
  const tstBoard = boardFrom(["X.........", "XXXX.XXXXX", "XXX..XXXXX", "XXXX.XXXXX"])
  const tst = withPiece(g0, tstBoard, { type: "T", rotation: 3, x: 3, y: 19 }, { lastAction: "rotate", lastKick: 4 })
  assert.equal(E.detectTSpin(tst), "full")
  const t3 = E.hardDrop(tst)
  assert.equal(t3.lastClear.labels[0], "T-Spin Triple")
  assert.equal(t3.lastClear.tSpin, "full3")
  assert.equal(t3.attack.lines, 6)

  assert.equal(E.detectTSpin({ ...tsd, lastAction: "move" }), null)
  assert.equal(E.detectTSpin({ ...tsd, active: { ...tsd.active, type: "J" } }), null)
  // a T-spin with no lines still counts
  const zero = withPiece(g0, boardFrom(["...X......", "XXX...XXX.", "XXXX.XXXX."]), { type: "T", rotation: 2, x: 3, y: 19 }, { lastAction: "rotate" })
  const z = E.hardDrop(zero)
  assert.equal(z.lines, 0)
  assert.equal(z.stats.tSpins.zero, 1)
  assert.equal(z.score, 400)
})

// ---------- scoring ----------

const tetrisBoard = () => boardFrom(["XXXXXXXXX.", "XXXXXXXXX.", "XXXXXXXXX.", "XXXXXXXXX."])
const dropI = (state) => E.hardDrop(withPiece(state, state.board, { type: "I", rotation: 1, x: 7, y: 0 }))

test("scoring: singles, a Tetris, back-to-back, combos and a perfect clear", () => {
  const g0 = game()
  const single = E.hardDrop(withPiece(g0, boardFrom(["X.........", "XXXXXX...."]), { type: "I", rotation: 0, x: 6, y: 18 }))
  assert.equal(single.lines, 1)
  assert.equal(single.score, 100 + 2 * 2) // a single, plus two rows of hard drop

  // a Tetris that also empties the board: a perfect clear
  const t1 = dropI({ ...g0, board: tetrisBoard() })
  assert.equal(t1.lines, 4)
  assert.deepEqual(t1.lastClear.labels, ["Tetris", "Perfect Clear"])
  assert.equal(t1.stats.perfectClears, 1)
  assert.equal(t1.attack.lines, 4 + 10)

  // back to back: 800 * 1.5, plus a 1-combo
  const b = { ...t1, board: boardFrom(["X.........", "XXXXXXXXX.", "XXXXXXXXX.", "XXXXXXXXX.", "XXXXXXXXX."]), score: 0 }
  const t2 = dropI(b)
  assert.ok(t2.lastClear.labels.includes("Back-to-Back"))
  assert.ok(t2.lastClear.labels.includes("1 Combo"))
  assert.equal(t2.score - b.score, 1200 + 50 + 2 * 18)
  assert.equal(t2.attack.lines, 4 + 1 + 0) // tetris, b2b, a 1-combo sends nothing extra
  assert.equal(t2.stats.backToBacks, 1)
})

test("attack table: lines, T-spins, back-to-back, combos, perfect clear", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((lines) => E.attackFor({ lines })), [0, 0, 1, 2, 4])
  assert.deepEqual([1, 2, 3].map((lines) => E.attackFor({ lines, tSpin: "full" })), [2, 4, 6])
  assert.deepEqual([1, 2].map((lines) => E.attackFor({ lines, tSpin: "mini" })), [0, 1])
  assert.equal(E.attackFor({ lines: 4, backToBack: true }), 5)
  assert.equal(E.attackFor({ lines: 1, combo: 2 }), 1)
  assert.equal(E.attackFor({ lines: 2, combo: 5 }), 3)
  assert.equal(E.attackFor({ lines: 1, combo: 50 }), 5)
  assert.equal(E.attackFor({ lines: 0, combo: 5 }), 0)
  assert.equal(E.attackFor({ lines: 4, perfectClear: true }), 14)
})

// ---------- garbage ----------

test("garbage insertion: rows with one hole pushed up from the bottom, overflow detected", () => {
  const empty = boardFrom([])
  const { board, overflow } = E.insertGarbage(empty, 3, 4)
  assert.equal(overflow, false)
  for (let y = E.ROWS - 3; y < E.ROWS; y++) {
    assert.equal(board[y][4], null)
    assert.equal(board[y].filter((c) => c === "g").length, 9)
  }
  assert.equal(board.length, E.ROWS)
  const solid = E.insertGarbage(empty, 2, 0, true).board
  assert.ok(solid[E.ROWS - 1].every((c) => c === "#"))
  const tall = boardFrom(Array(E.ROWS).fill("X........."))
  assert.equal(E.insertGarbage(tall, 1, 0).overflow, true)
})

test("garbage: waits until a piece locks without clearing, at most 8 rows a piece", () => {
  let g = game()
  g = E.receiveGarbage(g, { lines: 2, hole: 5 })
  g = E.receiveGarbage(g, { lines: 9, hole: 1 })
  assert.equal(E.pendingLines(g), 11)
  g = E.hardDrop(withPiece(g, boardFrom([]), { type: "O", rotation: 0, x: 0, y: 5 }))
  assert.equal(E.pendingLines(g), 3)
  assert.equal(g.stats.received, 8)
  assert.equal(g.board[E.ROWS - 1][1], null) // the newest rows (hole 1) are at the bottom
  assert.equal(g.board[E.ROWS - 7][5], null) // the first batch rose first
  assert.equal(g.board[E.ROWS - 9][0], "O") // the O sits on top of it all
})

test("garbage cancellation: your attack cancels incoming lines first", () => {
  let g = game()
  g = E.receiveGarbage(g, { lines: 3, hole: 2 })
  g = dropI({ ...g, board: boardFrom(["X.........", ...tetrisBoard().slice(-4).map((r) => r.map((c) => (c ? "X" : ".")).join(""))]) })
  assert.equal(g.attack.lines, 4)
  assert.equal(g.attack.cancelled, 3)
  assert.equal(g.attack.sent, 1)
  assert.equal(E.pendingLines(g), 0)
  assert.equal(g.stats.sent, 1)
  // a smaller attack only cancels part of it
  const c = E.cancelPending([{ lines: 2, hole: 0 }, { lines: 3, hole: 1 }], 3)
  assert.deepEqual(c, { pending: [{ lines: 2, hole: 1, solid: undefined }].map(({ solid, ...g }) => g), cancelled: 3 })
  // a shield blocks the next batch
  const shielded = E.receiveGarbage({ ...game(), shield: true }, { lines: 4, hole: 0 })
  assert.equal(E.pendingLines(shielded), 0)
  assert.equal(shielded.shield, false)
})

test("solid garbage (Battle): never clears, only attacking digs it out", () => {
  let g = game({ solidGarbage: true })
  g = E.receiveGarbage(g, { lines: 2, solid: true })
  g = E.hardDrop(withPiece(g, boardFrom([]), { type: "O", rotation: 0, x: 0, y: 5 }))
  assert.ok(g.board[E.ROWS - 1].every((c) => c === "#"))
  assert.ok(g.board[E.ROWS - 2].every((c) => c === "#"))
  // a Tetris above the solid rows: 4 lines of attack dig out both rows, 2 go out
  const above = [...tetrisBoard().slice(-4).map((r) => r.map((c) => (c ? "X" : ".")).join("")), "##########", "##########"]
  g = E.hardDrop(withPiece(g, boardFrom(above), { type: "I", rotation: 1, x: 7, y: 0 }))
  assert.equal(g.lines, 4)
  assert.equal(g.attack.dug, 2)
  assert.equal(g.attack.sent, 2)
  assert.ok(g.board.every((row) => !row.includes("#")))
})

test("respawn after a KO clears the board and keeps playing", () => {
  let g = game()
  g = { ...g, status: "over", endReason: "topout", board: boardFrom(["XXXXX....."]), pending: [{ lines: 3, hole: 0 }] }
  const r = E.respawn(g)
  assert.equal(r.status, "playing")
  assert.equal(r.kos, 1)
  assert.equal(E.pendingLines(r), 0)
  assert.ok(r.board.every((row) => row.every((c) => !c)))
})

test("sweep (Arena item) clears the bottom rows", () => {
  const g = E.sweepRows({ ...game(), board: boardFrom(["X.........", "gggg.ggggg", "gggg.ggggg", "gggg.ggggg"]) }, 3)
  assert.equal(g.board[E.ROWS - 1][0], "J")
  assert.equal(g.board.flat().filter(Boolean).length, 1)
})

// ---------- modes ----------

test("Sprint ends at 40 lines with the time, splits every 10", () => {
  let g = E.createGame({ seed: 1, ...MODES.sprint.options })
  g = { ...g, lines: 38, time: 61_000, splits: [{ lines: 10, time: 1 }, { lines: 20, time: 2 }, { lines: 30, time: 3 }] }
  g = E.hardDrop(withPiece(g, boardFrom(["XXXXXXXX..", "XXXXXXXX.."]), { type: "O", rotation: 0, x: 8, y: 5 }))
  assert.equal(g.status, "over")
  assert.equal(g.endReason, "goal")
  assert.equal(g.splits.at(-1).lines, 40)
  assert.equal(resultValue("sprint", g), 61_000)
  assert.ok(beats("sprint", 61_000, 70_000))
  assert.ok(!beats("sprint", 71_000, 70_000))
  // a sprint you topped out of doesn't count
  assert.equal(resultValue("sprint", { ...g, endReason: "topout" }), null)
})

test("Ultra ends after 2 minutes", () => {
  let g = E.createGame({ seed: 1, ...MODES.ultra.options })
  g = E.tick(g, 1000, false)
  assert.equal(g.status, "playing")
  g = E.tick({ ...g, time: 119_990 }, 16, false)
  assert.equal(g.status, "over")
  assert.equal(g.endReason, "time")
  assert.equal(g.time, 120_000)
})

test("Marathon: variable goals, 15 levels then it's over", () => {
  let g = E.createGame({ seed: 1, ...MODES.marathon.options })
  assert.equal(E.levelGoal(1), 5)
  // a Tetris is worth 8 goal points: level 1 (5) done, 3 into level 2
  g = dropI({ ...g, board: boardFrom(["X.........", ...tetrisBoard().slice(-4).map((r) => r.map((c) => (c ? "X" : ".")).join(""))]) })
  assert.equal(g.level, 2)
  assert.equal(g.goal, 3)
  // finishing level 15 ends the game
  g = { ...g, level: 15, goal: 74 }
  g = E.hardDrop(withPiece(g, boardFrom(["XXXXXX...."]), { type: "I", rotation: 0, x: 6, y: 19 }))
  assert.equal(g.status, "over")
  assert.equal(g.endReason, "goal")
  assert.equal(g.level, 15)
})

test("Survival: speeds up, then the finale, then done", () => {
  let g = E.createGame({ seed: 1, ...MODES.survival.options })
  g = { ...g, lines: 199 }
  g = E.hardDrop(withPiece(g, boardFrom(["XXXXXX...."]), { type: "I", rotation: 0, x: 6, y: 19 }))
  assert.equal(g.finale, true)
  assert.equal(g.level, 21)
  assert.ok(E.visibleCells({ ...g, board: boardFrom(["X........."]) }).flat().some((c) => c.includes("tetromino_faint")))
  g = { ...g, lines: 219, board: boardFrom(["XXXXXX...."]) }
  g = E.hardDrop(withPiece(g, g.board, { type: "I", rotation: 0, x: 6, y: 19 }))
  assert.equal(g.status, "over")
  assert.equal(g.endReason, "goal")
})

test("versus modes can't be paused; levels follow the clock", () => {
  let g = E.createGame({ seed: 1, ...MODES.battle.options })
  assert.equal(E.togglePause(g), g)
  g = E.tick({ ...g, time: 59_990 }, 20, false)
  assert.equal(g.level, 3)
})

// ---------- snapshots and the bot ----------

test("snapshots: 200 characters, back to cell classes", () => {
  const g = withPiece(game(), boardFrom(["gggg.ggggg", "##########"]), { type: "T", rotation: 0, x: 3, y: 5 })
  const snap = E.toSnapshot(g)
  assert.match(snap, E.SNAPSHOT)
  assert.equal(snap.slice(-10), "##########")
  assert.equal(snap.slice(-20, -10), "gggg.ggggg")
  const cells = E.fromSnapshot(snap)
  assert.equal(cells.length, 20)
  assert.equal(cells[19][0], "tetromino__x")
  assert.equal(cells[18][0], "tetromino__g")
  assert.equal(cells[3][4], "tetromino__t") // the falling T (row 5 of 22 = visible row 3)
  assert.equal(E.stackHeight(g.board), 2)
})

test("bot: finds sensible placements and survives a long game", () => {
  const flat = boardFrom(["XXXXXXXXX."])
  const best = placements(flat, "I").sort((a, b) => b.score - a.score)[0]
  assert.equal(best.lines, 1) // the vertical I into the well
  let g = E.createGame({ seed: 5 })
  let rnd = 1
  const random = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 300 && g.status === "playing"; i++) g = botMove(g, "hard", random)
  assert.equal(g.status, "playing")
  assert.ok(g.lines >= 100, `cleared ${g.lines}`)
})
