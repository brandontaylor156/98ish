// The client's Minesweeper engine, as used by Minesweeper Race: one seed, one board
import test from "node:test"
import assert from "node:assert/strict"
import { LEVELS, createGame, createSeededGame, reveal, seededRandom } from "../../../client/src/components/applets/minesweeper/engine.js"

const mines = (game) => game.cells.map((c, i) => (c.mine ? i : -1)).filter((i) => i >= 0)

test("the same seed gives identical boards and the same opening", () => {
  for (const level of Object.values(LEVELS)) {
    for (const seed of [1, 42, 123456789, 2 ** 31 - 1]) {
      const a = createSeededGame(level, seed)
      const b = createSeededGame(level, seed)
      assert.deepEqual(mines(a), mines(b))
      assert.deepEqual(a.cells.map((c) => c.state), b.cells.map((c) => c.state))
      assert.equal(mines(a).length, level.mines)
      assert.equal(a.status, "playing")
      assert.ok(a.revealed > 1, "the opening uncovers a blank area")
    }
  }
})

test("different seeds give different boards", () => {
  const boards = new Set([1, 2, 3, 4, 5].map((s) => mines(createSeededGame(LEVELS.intermediate, s)).join()))
  assert.equal(boards.size, 5)
})

test("seeded random is deterministic and in [0, 1)", () => {
  const a = seededRandom(7)
  const b = seededRandom(7)
  for (let i = 0; i < 1000; i++) {
    const x = a()
    assert.equal(x, b())
    assert.ok(x >= 0 && x < 1)
  }
})

test("single player still keeps the first click safe", () => {
  for (let i = 0; i < 50; i++) {
    const g = reveal(createGame(LEVELS.expert), i * 7)
    assert.notEqual(g.status, "lost")
    assert.equal(g.cells[i * 7].mine, false)
  }
})

test("a seeded board can be cleared by revealing every safe cell", () => {
  let g = createSeededGame(LEVELS.beginner, 99)
  g.cells.forEach((c, i) => {
    if (!c.mine && c.state !== "revealed") g = reveal(g, i)
  })
  assert.equal(g.status, "won")
})
