// Battleship on a 10x10 grid. Pure functions on plain objects, shared by the game server
// (network games, where each player's fleet stays secret) and the browser (games against
// the computer).
//
// Cells are 0..99 (row * 10 + col). A fleet is five ships, each placed as
// { id, row, col, dir } with dir "h" (pointing right) or "v" (pointing down). Ships may
// touch but not overlap. Players take turns firing one shot each.

export const SIZE = 10
export const SHIPS = [
  { id: "carrier", name: "Carrier", length: 5 },
  { id: "battleship", name: "Battleship", length: 4 },
  { id: "cruiser", name: "Cruiser", length: 3 },
  { id: "submarine", name: "Submarine", length: 3 },
  { id: "destroyer", name: "Destroyer", length: 2 },
]
export const shipInfo = (id) => SHIPS.find((s) => s.id === id) || null

export const cellsOf = ({ id, row, col, dir }) => {
  const info = shipInfo(id)
  if (!info) return []
  return Array.from({ length: info.length }, (_, k) => (dir === "v" ? (row + k) * SIZE + col : row * SIZE + col + k))
}

// One ship fits where it is (in bounds, not on any cell in `taken`)
export const fits = (ship, taken = new Set()) => {
  const info = shipInfo(ship.id)
  if (!info || !Number.isInteger(ship.row) || !Number.isInteger(ship.col) || (ship.dir !== "h" && ship.dir !== "v")) return false
  if (ship.row < 0 || ship.col < 0) return false
  if (ship.dir === "h" ? ship.col + info.length > SIZE || ship.row >= SIZE : ship.row + info.length > SIZE || ship.col >= SIZE) return false
  return cellsOf(ship).every((c) => !taken.has(c))
}

// A whole fleet: exactly the five ships, each once, all on the grid, none overlapping.
// Returns { ok, fleet } (cleaned up) or { ok: false, error }.
export const validateFleet = (fleet) => {
  if (!Array.isArray(fleet) || fleet.length !== SHIPS.length) return { ok: false, error: "Place all five ships first." }
  const taken = new Set()
  const seen = new Set()
  const clean = []
  for (const raw of fleet) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "That isn't a ship." }
    const ship = { id: raw.id, row: raw.row, col: raw.col, dir: raw.dir }
    if (!shipInfo(ship.id) || seen.has(ship.id)) return { ok: false, error: "Every ship has to be placed exactly once." }
    seen.add(ship.id)
    if (!fits(ship, new Set())) return { ok: false, error: `The ${shipInfo(ship.id).name} doesn't fit there.` }
    if (!fits(ship, taken)) return { ok: false, error: `The ${shipInfo(ship.id).name} overlaps another ship.` }
    for (const c of cellsOf(ship)) taken.add(c)
    clean.push(ship)
  }
  return { ok: true, fleet: clean }
}

// A random legal fleet
export const randomFleet = (random = Math.random) => {
  for (;;) {
    const taken = new Set()
    const fleet = []
    for (const info of SHIPS) {
      let placed = null
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const ship = { id: info.id, row: Math.floor(random() * SIZE), col: Math.floor(random() * SIZE), dir: random() < 0.5 ? "h" : "v" }
        if (fits(ship, taken)) placed = ship
      }
      if (!placed) break
      fleet.push(placed)
      for (const c of cellsOf(placed)) taken.add(c)
    }
    if (fleet.length === SHIPS.length) return fleet
  }
}

// ---------- a match: two sides, a fleet and the shots fired at it each ----------

export const newGame = () => ({
  phase: "placing", // placing | playing | over
  sides: [
    { fleet: null, shots: [] },
    { fleet: null, shots: [] },
  ], // shots: { cell, hit, sunk } fired AT this side
  turn: 0,
  last: null, // { by, cell, result: "miss" | "hit" | "sunk", ship }
  winner: null,
})

export const place = (game, side, fleet) => {
  if (game.phase !== "placing") return { ok: false, error: "The ships are already placed." }
  if (game.sides[side].fleet) return { ok: false, error: "Your fleet is already in position." }
  const checked = validateFleet(fleet)
  if (!checked.ok) return checked
  const sides = game.sides.map((s, i) => (i === side ? { ...s, fleet: checked.fleet } : s))
  const ready = sides.every((s) => s.fleet)
  return { ok: true, state: { ...game, sides, phase: ready ? "playing" : "placing" } }
}

export const shipAt = (fleet, cell) => (fleet || []).find((s) => cellsOf(s).includes(cell)) || null

export const isSunk = (ship, shots) => {
  const hit = new Set(shots.filter((s) => s.hit).map((s) => s.cell))
  return cellsOf(ship).every((c) => hit.has(c))
}

// `side` fires at the other side's grid
export const fire = (game, side, cell) => {
  if (game.phase !== "playing") return { ok: false, error: game.phase === "over" ? "The game is over." : "Wait for both fleets to be placed." }
  if (game.turn !== side) return { ok: false, error: "It isn't your turn." }
  if (!Number.isInteger(cell) || cell < 0 || cell >= SIZE * SIZE) return { ok: false, error: "That isn't on the grid." }
  const target = 1 - side
  const defender = game.sides[target]
  if (defender.shots.some((s) => s.cell === cell)) return { ok: false, error: "You already fired there." }
  const ship = shipAt(defender.fleet, cell)
  const shots = [...defender.shots, { cell, hit: !!ship }]
  const sunk = ship && isSunk(ship, shots)
  if (sunk) shots[shots.length - 1].sunk = ship.id
  const sides = game.sides.map((s, i) => (i === target ? { ...s, shots } : s))
  const allSunk = defender.fleet.every((s) => isSunk(s, shots))
  const last = { by: side, cell, result: sunk ? "sunk" : ship ? "hit" : "miss", ship: sunk ? ship.id : null }
  return {
    ok: true,
    state: { ...game, sides, last, turn: allSunk ? game.turn : target, phase: allSunk ? "over" : "playing", winner: allSunk ? side : null },
  }
}

// What one side may know about the other: where it has fired, what it hit, and the ships
// it has sunk (whose cells it has already hit). Never the rest of the fleet.
export const enemyView = (game, side) => {
  const target = game.sides[1 - side]
  const sunk = (target.fleet || []).filter((s) => isSunk(s, target.shots))
  return {
    shots: target.shots.map(({ cell, hit }) => ({ cell, hit })),
    sunk: sunk.map((s) => ({ id: s.id, cells: cellsOf(s) })),
    afloat: SHIPS.length - sunk.length,
  }
}

export const ownView = (game, side) => {
  const me = game.sides[side]
  return {
    fleet: me.fleet,
    shots: me.shots.map(({ cell, hit }) => ({ cell, hit })),
    sunk: (me.fleet || []).filter((s) => isSunk(s, me.shots)).map((s) => s.id),
  }
}

// ---------- the computer: hunt, then target ----------

// Hunt on a checkerboard (every ship covers one of its squares) weighted toward cells
// where many ships could still fit; once there's a hit, work along it until it sinks.
// `view` is what the computer knows: enemyView(game, side)
export const aiShot = ({ shots, sunk = [] }, random = Math.random) => {
  const fired = new Map(shots.map((s) => [s.cell, s]))
  // hits on ships already sunk are done with
  const sunkCells = new Set(sunk.flatMap((s) => s.cells))
  const sunkIds = sunk.map((s) => s.id)
  const openHits = shots.filter((s) => s.hit && !sunkCells.has(s.cell)).map((s) => s.cell)
  const free = (c) => c >= 0 && c < SIZE * SIZE && !fired.has(c)
  const rc = (c) => [Math.floor(c / SIZE), c % SIZE]

  const remaining = SHIPS.filter((s) => !sunkIds.includes(s.id)).map((s) => s.length)
  // how many placements of the remaining ships cover each cell (hits count double)
  const heat = new Array(SIZE * SIZE).fill(0)
  for (const len of remaining) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        for (const dir of ["h", "v"]) {
          const cells = Array.from({ length: len }, (_, k) => (dir === "v" ? r + k : r) * SIZE + (dir === "v" ? c : c + k))
          if (dir === "h" ? c + len > SIZE : r + len > SIZE) continue
          if (cells.some((x) => fired.has(x) && !(fired.get(x).hit && !sunkCells.has(x)))) continue
          const hits = cells.filter((x) => openHits.includes(x)).length
          for (const x of cells) if (!fired.has(x)) heat[x] += 1 + hits * 20
        }
      }
    }
  }

  let candidates = []
  if (openHits.length) {
    // next to the hits (in line with them when there are two or more)
    const near = new Set()
    for (const h of openHits) {
      const [r, c] = rc(h)
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const rr = r + dr
        const cc = c + dc
        if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && free(rr * SIZE + cc)) near.add(rr * SIZE + cc)
      }
    }
    candidates = [...near]
  }
  if (!candidates.length) {
    candidates = []
    for (let i = 0; i < SIZE * SIZE; i++) if (free(i) && (Math.floor(i / SIZE) + (i % SIZE)) % 2 === 0) candidates.push(i)
    if (!candidates.length) for (let i = 0; i < SIZE * SIZE; i++) if (free(i)) candidates.push(i)
  }
  let best = []
  let bestHeat = -1
  for (const c of candidates) {
    if (heat[c] > bestHeat) {
      bestHeat = heat[c]
      best = [c]
    } else if (heat[c] === bestHeat) best.push(c)
  }
  return best[Math.floor(random() * best.length)]
}
