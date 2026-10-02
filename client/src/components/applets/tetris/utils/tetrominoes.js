// Tetromino data following the Tetris Guideline: Super Rotation System (SRS) spawn
// orientations, rotation states and wall-kick tables.

export const TYPES = ["I", "J", "L", "O", "S", "T", "Z"]

// Spawn orientation (rotation state 0) as square matrices, y pointing down
const SPAWN_SHAPES = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
}

const rotateClockwise = (matrix) =>
  matrix.map((row, y) => row.map((_, x) => matrix[matrix.length - 1 - x][y]))

// SHAPES[type][rotation] for rotation states 0 (spawn), 1 (R), 2, 3 (L)
export const SHAPES = Object.fromEntries(
  TYPES.map((type) => {
    const states = [SPAWN_SHAPES[type]]
    for (let i = 1; i < 4; i++) states.push(rotateClockwise(states[i - 1]))
    return [type, states]
  })
)

// SRS kick offsets per "from" + "to" rotation state, as [x, y] with y pointing UP
// (as published); the engine flips y. The first test is always no offset.
const JLSTZ_KICKS = {
  "01": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "10": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "12": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "21": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "23": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "32": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "30": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "03": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
}

const I_KICKS = {
  "01": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "10": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "12": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  "21": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "23": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "32": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "30": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "03": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
}

export const kicksFor = (type, from, to) =>
  (type === "I" ? I_KICKS : JLSTZ_KICKS)[`${from}${to}`]

export const cellClass = (type) => `tetromino__${type.toLowerCase()}`

// Spawn shape with empty rows/columns removed, for the Next and Hold boxes
export const previewShape = (type) => {
  const rows = SPAWN_SHAPES[type].filter((row) => row.some(Boolean))
  const usedColumns = rows[0].map((_, x) => rows.some((row) => row[x]))
  return rows.map((row) => row.filter((_, x) => usedColumns[x]))
}
