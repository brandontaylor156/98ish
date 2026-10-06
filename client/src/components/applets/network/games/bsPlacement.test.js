// node --test client/src/components/applets/network/games/bsPlacement.test.js
import { test } from "node:test"
import assert from "node:assert/strict"
import { cellsOf, fits } from "../rules/battleship.js"
import { firstSpot, onGridCells, shipAt, shipOn, takenBy, turnShip, allPlaced } from "./bsPlacement.js"

test("shipAt anchors the held part on the square", () => {
  assert.deepEqual(shipAt("cruiser", 34, "h", 1), { id: "cruiser", dir: "h", row: 3, col: 3 })
  assert.deepEqual(shipAt("cruiser", 34, "v", 2), { id: "cruiser", dir: "v", row: 1, col: 4 })
})

test("a ghost off the edge shows only its squares on the grid", () => {
  assert.deepEqual([...onGridCells({ id: "carrier", row: 0, col: 8, dir: "h" })], [8, 9])
})

test("turning keeps the tapped square", () => {
  const fleet = { cruiser: { id: "cruiser", row: 4, col: 3, dir: "h" } } // 43 44 45
  const t = turnShip(fleet, "cruiser", 44)
  assert.equal(t.dir, "v")
  assert.ok(cellsOf(t).includes(44))
  assert.ok(fits(t))
})

test("turning at an edge slides it back onto the grid", () => {
  const fleet = { carrier: { id: "carrier", row: 9, col: 0, dir: "h" } } // bottom row
  const t = turnShip(fleet, "carrier", 90)
  assert.equal(t.dir, "v")
  assert.deepEqual(t, { id: "carrier", dir: "v", row: 5, col: 0 })
})

test("turning around another ship finds the nearest spot, or none", () => {
  const fleet = {
    destroyer: { id: "destroyer", row: 0, col: 0, dir: "h" }, // 0 1
    battleship: { id: "battleship", row: 1, col: 0, dir: "h" }, // 10..13
  }
  const t = turnShip(fleet, "destroyer", 0)
  assert.ok(t && t.dir === "v" && fits(t, takenBy(fleet, "destroyer")))
  // boxed in: a 5-long ship in a 1-wide column with ships either side can't turn
  const boxed = {
    carrier: { id: "carrier", row: 0, col: 0, dir: "v" },
    battleship: { id: "battleship", row: 0, col: 1, dir: "v" },
  }
  const r = turnShip(boxed, "carrier", 0)
  assert.ok(r === null || fits(r, takenBy(boxed, "carrier")))
})

test("firstSpot finds room, and every ship fits one after another", () => {
  const fleet = {}
  for (const id of ["carrier", "battleship", "cruiser", "submarine", "destroyer"]) {
    const s = firstSpot(fleet, id)
    assert.ok(s && fits(s, takenBy(fleet, id)))
    fleet[id] = s
  }
  assert.ok(allPlaced(fleet))
  assert.equal(shipOn(fleet, cellsOf(fleet.carrier)[2]).id, "carrier")
})
