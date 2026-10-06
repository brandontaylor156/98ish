// Placing a Battleship fleet (pure: unit tests in bsPlacement.test.js). A fleet here is
// { id: ship } with ships as in rules/battleship.js: { id, row, col, dir }.
import { SHIPS, SIZE, cellsOf, fits, shipInfo } from "../rules/battleship.js"

// every square taken by the fleet's other ships
export const takenBy = (fleet, exceptId) => new Set(Object.values(fleet).filter((s) => s && s.id !== exceptId).flatMap(cellsOf))

// the ship whose part number `k` (0 = bow) sits on `cell`
export const shipAt = (id, cell, dir, k = 0) => ({
  id,
  dir,
  row: Math.floor(cell / SIZE) - (dir === "v" ? k : 0),
  col: (cell % SIZE) - (dir === "h" ? k : 0),
})

// the squares of a ship that are on the grid (a ghost hanging off the edge shows its part)
export const onGridCells = (ship) => {
  const out = new Set()
  const n = shipInfo(ship.id)?.length || 0
  for (let k = 0; k < n; k++) {
    const r = ship.row + (ship.dir === "v" ? k : 0)
    const c = ship.col + (ship.dir === "h" ? k : 0)
    if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) out.add(r * SIZE + c)
  }
  return out
}

export const shipOn = (fleet, cell) => Object.values(fleet).find((s) => s && cellsOf(s).includes(cell)) || null

// Turn a placed ship a quarter around the square that was tapped. If it can't turn in place
// (an edge or another ship), it slides along its new line to the nearest spot that works;
// null when there's no room at all.
export const turnShip = (fleet, id, pivot) => {
  const ship = fleet[id]
  if (!ship) return null
  const cells = cellsOf(ship)
  const k = Math.max(0, cells.indexOf(pivot))
  const at = cells[k]
  const dir = ship.dir === "h" ? "v" : "h"
  const taken = takenBy(fleet, id)
  const n = shipInfo(id).length
  // shifts 0, -1, +1, -2, +2... keep the turn as close to the finger as possible
  for (let d = 0; d < n * 2; d++) {
    const shift = d % 2 ? -Math.ceil(d / 2) : d / 2
    const kk = k + shift
    if (kk < -SIZE || kk > SIZE) continue
    const next = shipAt(id, at, dir, kk)
    if (fits(next, taken)) return next
  }
  return null
}

// The first open spot for a ship (across first, from the top left): tapping a ship in the
// dock drops it on the grid there, ready to be dragged
export const firstSpot = (fleet, id, prefer = "h") => {
  const taken = takenBy(fleet, id)
  for (const dir of [prefer, prefer === "h" ? "v" : "h"]) {
    for (let cell = 0; cell < SIZE * SIZE; cell++) {
      const ship = shipAt(id, cell, dir, 0)
      if (fits(ship, taken)) return ship
    }
  }
  return null
}

export const allPlaced = (fleet) => SHIPS.every((s) => fleet[s.id])
