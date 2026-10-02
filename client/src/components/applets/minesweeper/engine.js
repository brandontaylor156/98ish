// Minesweeper rules, as in the Windows original: the first click is never a mine, empty
// areas open up on their own, right-click cycles flag -> ? -> blank, and "chording" a
// number whose flags are all placed opens its other neighbors. Pure functions on an
// immutable game object.

export const LEVELS = {
  beginner: { label: "Beginner", rows: 9, cols: 9, mines: 10 },
  intermediate: { label: "Intermediate", rows: 16, cols: 16, mines: 40 },
  expert: { label: "Expert", rows: 16, cols: 30, mines: 99 },
}

// Custom field limits from Windows 98
export const LIMITS = { minRows: 9, maxRows: 24, minCols: 9, maxCols: 30, minMines: 10 }
export const maxMinesFor = (rows, cols) => (rows - 1) * (cols - 1)

export const clampCustom = ({ rows, cols, mines }) => {
  const r = Math.min(LIMITS.maxRows, Math.max(LIMITS.minRows, Math.round(rows) || LIMITS.minRows))
  const c = Math.min(LIMITS.maxCols, Math.max(LIMITS.minCols, Math.round(cols) || LIMITS.minCols))
  const m = Math.min(maxMinesFor(r, c), Math.max(LIMITS.minMines, Math.round(mines) || LIMITS.minMines))
  return { rows: r, cols: c, mines: m }
}

// Cell: { mine, adjacent, state: "hidden" | "flagged" | "question" | "revealed" }
export const createGame = ({ rows, cols, mines }) => ({
  rows,
  cols,
  mines,
  cells: Array.from({ length: rows * cols }, () => ({ mine: false, adjacent: 0, state: "hidden" })),
  status: "ready", // ready | playing | won | lost
  flags: 0,
  revealed: 0,
  startedAt: null,
  endedAt: null,
  exploded: null, // index of the mine that was clicked
})

export const neighbors = (game, index) => {
  const row = Math.floor(index / game.cols)
  const col = index % game.cols
  const out = []
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue
      const r = row + dr
      const c = col + dc
      if (r >= 0 && r < game.rows && c >= 0 && c < game.cols) out.push(r * game.cols + c)
    }
  }
  return out
}

// Lay the mines once the first cell is known, so it's always safe
const layMines = (game, safeIndex, random) => {
  const cells = game.cells.map((cell) => ({ ...cell }))
  const candidates = cells.map((_, i) => i).filter((i) => i !== safeIndex)
  for (let placed = 0; placed < game.mines; placed++) {
    const pick = placed + Math.floor(random() * (candidates.length - placed))
    ;[candidates[placed], candidates[pick]] = [candidates[pick], candidates[placed]]
    cells[candidates[placed]].mine = true
  }
  cells.forEach((cell, i) => {
    cell.adjacent = neighbors(game, i).filter((n) => cells[n].mine).length
  })
  return { ...game, cells, status: "playing", startedAt: Date.now() }
}

const finished = (game) => game.status === "won" || game.status === "lost"

const lose = (game, cells, index) => {
  for (const cell of cells) {
    if (cell.mine && cell.state !== "flagged") cell.state = "revealed"
    else if (!cell.mine && cell.state === "flagged") cell.wrongFlag = true
  }
  return { ...game, cells, status: "lost", exploded: index, endedAt: Date.now() }
}

const winIfDone = (game) => {
  if (game.revealed !== game.cells.length - game.mines) return game
  // Like the original: every mine gets a flag when you win
  const cells = game.cells.map((cell) => (cell.mine ? { ...cell, state: "flagged" } : cell))
  return { ...game, cells, status: "won", flags: game.mines, endedAt: Date.now() }
}

// Open cells (flood-filling from blanks); a mine ends the game
const open = (game, indexes) => {
  const cells = game.cells.map((cell) => ({ ...cell }))
  let revealed = game.revealed
  const stack = [...indexes]
  while (stack.length) {
    const i = stack.pop()
    const cell = cells[i]
    if (cell.state === "revealed" || cell.state === "flagged") continue
    if (cell.mine) {
      cell.state = "revealed"
      return lose({ ...game, revealed }, cells, i)
    }
    cell.state = "revealed"
    revealed++
    if (cell.adjacent === 0) {
      for (const n of neighbors(game, i)) if (cells[n].state !== "revealed") stack.push(n)
    }
  }
  return winIfDone({ ...game, cells, revealed })
}

export const reveal = (game, index, random = Math.random) => {
  if (finished(game)) return game
  const cell = game.cells[index]
  if (cell.state === "flagged" || cell.state === "revealed") return game
  const started = game.status === "ready" ? layMines(game, index, random) : game
  return open(started, [index])
}

// Right click: blank -> flag -> ? (when marks are on) -> blank
export const cycleMark = (game, index, marks = true) => {
  if (finished(game)) return game
  const cell = game.cells[index]
  if (cell.state === "revealed") return game
  const nextState = { hidden: "flagged", flagged: marks ? "question" : "hidden", question: "hidden" }[cell.state]
  const flags = game.flags + (nextState === "flagged" ? 1 : 0) - (cell.state === "flagged" ? 1 : 0)
  const cells = game.cells.slice()
  cells[index] = { ...cell, state: nextState }
  return { ...game, cells, flags }
}

// Chord: on a revealed number with exactly that many flags around it, open the rest
export const chordTargets = (game, index) => {
  const cell = game.cells[index]
  if (cell.state !== "revealed" || cell.adjacent === 0) return []
  const around = neighbors(game, index)
  const flagged = around.filter((n) => game.cells[n].state === "flagged").length
  if (flagged !== cell.adjacent) return []
  return around.filter((n) => game.cells[n].state === "hidden" || game.cells[n].state === "question")
}

export const chord = (game, index) => {
  if (finished(game)) return game
  const targets = chordTargets(game, index)
  return targets.length ? open(game, targets) : game
}

export const minesLeft = (game) => game.mines - game.flags

export const elapsedSeconds = (game, now = Date.now()) => {
  if (!game.startedAt) return 0
  // The original's clock starts at 1 on the first click and stops at 999
  return Math.min(999, Math.floor(((game.endedAt ?? now) - game.startedAt) / 1000) + 1)
}
