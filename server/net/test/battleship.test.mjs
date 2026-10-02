// Battleship rules (shared with the browser): placement, shots, sinking, what each side sees
import test from "node:test"
import assert from "node:assert/strict"
import * as bs from "../../../client/src/components/applets/network/rules/battleship.js"

// Ships in rows 0, 2, 4, 6, 8, all pointing right from column 0
const rowsFleet = () => bs.SHIPS.map((s, i) => ({ id: s.id, row: i * 2, col: 0, dir: "h" }))

test("placement: all five ships, on the grid, no overlaps", () => {
  assert.ok(bs.validateFleet(rowsFleet()).ok)
  assert.equal(bs.validateFleet(rowsFleet().slice(0, 4)).ok, false) // missing one
  const twice = rowsFleet()
  twice[4] = { ...twice[3], row: 9 }
  assert.match(bs.validateFleet(twice).error, /exactly once/)
  const off = rowsFleet()
  off[0] = { id: "carrier", row: 0, col: 6, dir: "h" } // 6..10 runs off the edge
  assert.match(bs.validateFleet(off).error, /doesn't fit/)
  const down = rowsFleet()
  down[0] = { id: "carrier", row: 6, col: 9, dir: "v" } // rows 6..10
  assert.equal(bs.validateFleet(down).ok, false)
  const overlap = rowsFleet()
  overlap[1] = { id: "battleship", row: 0, col: 3, dir: "v" } // crosses the carrier
  assert.match(bs.validateFleet(overlap).error, /overlaps/)
  const touching = rowsFleet()
  touching[1] = { id: "battleship", row: 1, col: 0, dir: "h" } // right under the carrier: fine
  assert.ok(bs.validateFleet(touching).ok)
  for (const bad of [null, "x", [1, 2, 3, 4, 5], rowsFleet().map((s) => ({ ...s, dir: "d" })), rowsFleet().map((s) => ({ ...s, row: 1.5 })), rowsFleet().map((s) => ({ ...s, id: "yacht" }))]) {
    assert.equal(bs.validateFleet(bad).ok, false)
  }
  // extra fields are dropped
  const cleaned = bs.validateFleet(rowsFleet().map((s) => ({ ...s, secret: "x" }))).fleet
  assert.ok(cleaned.every((s) => !("secret" in s)))
})

test("random fleets are always legal", () => {
  for (let i = 0; i < 200; i++) assert.ok(bs.validateFleet(bs.randomFleet()).ok)
})

test("shots: miss, hit, sunk, turns alternate, no repeats, all sunk wins", () => {
  let g = bs.newGame()
  assert.equal(bs.fire(g, 0, 0).ok, false) // not placed yet
  g = bs.place(g, 0, rowsFleet()).state
  assert.equal(g.phase, "placing")
  assert.equal(bs.place(g, 0, rowsFleet()).ok, false) // only once
  g = bs.place(g, 1, rowsFleet()).state
  assert.equal(g.phase, "playing")
  assert.equal(bs.fire(g, 1, 0).ok, false) // side 0 shoots first
  let r = bs.fire(g, 0, 99)
  assert.equal(r.state.last.result, "miss")
  g = r.state
  assert.equal(g.turn, 1)
  r = bs.fire(g, 1, 9)
  g = r.state
  assert.equal(bs.fire(g, 0, 99).ok, false) // already fired there
  // side 0 sinks the destroyer (row 8, cols 0-1); side 1 keeps missing
  const misses = [19, 29, 39, 49, 59, 69, 79]
  const shoot = (cell) => {
    const res = bs.fire(g, 0, cell)
    assert.ok(res.ok, res.error)
    g = res.state
    if (g.phase === "playing") g = bs.fire(g, 1, misses.shift()).state
    return res.state.last
  }
  assert.equal(shoot(80).result, "hit")
  const sunk = shoot(81)
  assert.equal(sunk.result, "sunk")
  assert.equal(sunk.ship, "destroyer")
  assert.equal(bs.enemyView(g, 0).afloat, 4)
  assert.deepEqual(bs.enemyView(g, 0).sunk, [{ id: "destroyer", cells: [80, 81] }])
  assert.deepEqual(bs.ownView(g, 1).sunk, ["destroyer"])
  // a hit that doesn't sink names no ship
  assert.equal(shoot(0).ship, null)
  // finish everything off
  let all = bs.newGame()
  all = bs.place(all, 0, rowsFleet()).state
  all = bs.place(all, 1, rowsFleet()).state
  const targets = rowsFleet().flatMap((s) => bs.cellsOf(s))
  let spare = 99
  for (const cell of targets) {
    all = bs.fire(all, 0, cell).state
    if (all.phase === "playing") all = bs.fire(all, 1, spare--).state
  }
  assert.equal(all.phase, "over")
  assert.equal(all.winner, 0)
  assert.equal(bs.fire(all, 1, 0).ok, false)
})

test("the enemy view never includes ships that are still afloat", () => {
  let g = bs.newGame()
  g = bs.place(g, 0, rowsFleet()).state
  g = bs.place(g, 1, bs.randomFleet()).state
  const fleet1 = g.sides[1].fleet
  const view = bs.enemyView(g, 0)
  assert.ok(!("fleet" in view))
  assert.deepEqual(view.sunk, [])
  const json = JSON.stringify(view)
  for (const ship of fleet1) assert.ok(!json.includes(`"row":${ship.row},"col":${ship.col}`))
})

test("the computer: hunts, then finishes a ship it has hit", () => {
  // a hit at 44 with nothing sunk: the next shot is next to it
  const next = bs.aiShot({ shots: [{ cell: 44, hit: true }], sunk: [] })
  assert.ok([34, 54, 43, 45].includes(next))
  // two hits in a row: keep going along the line
  const line = bs.aiShot({ shots: [{ cell: 44, hit: true }, { cell: 45, hit: true }, { cell: 34, hit: false }, { cell: 54, hit: false }], sunk: [] })
  assert.ok([43, 46].includes(line))
  // plays whole games in a sensible number of shots
  for (let n = 0; n < 30; n++) {
    let g = bs.newGame()
    g = bs.place(g, 0, bs.randomFleet()).state
    g = bs.place(g, 1, bs.randomFleet()).state
    g = { ...g, turn: 1 }
    let shots = 0
    while (g.phase === "playing") {
      const cell = bs.aiShot(bs.enemyView(g, 1))
      const r = bs.fire(g, 1, cell)
      assert.ok(r.ok, r.error)
      g = { ...r.state, turn: 1 }
      shots++
    }
    assert.ok(shots <= 75, `took ${shots} shots`)
  }
})
