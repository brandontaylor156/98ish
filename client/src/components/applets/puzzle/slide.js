// Slide puzzles: an n x n picture with one square missing; slide squares into the gap until
// the picture is whole. Tiles are numbered 1..n*n-1 in their solved order, 0 is the gap.
// Only solvable shuffles are dealt (half of all arrangements can never be solved).

import { rng } from "./jigsaw.js"

export const SLIDE_SIZES = [3, 4, 5]

export const solvedTiles = (n) => [...Array(n * n - 1).keys()].map((i) => i + 1).concat(0)

export const isSolved = (tiles) => tiles.every((t, i) => t === (i === tiles.length - 1 ? 0 : i + 1))

const inversions = (tiles) => {
  const list = tiles.filter((t) => t !== 0)
  let count = 0
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (list[i] > list[j]) count++
  return count
}

// The classic rule: odd widths need an even number of inversions; even widths count the
// gap's row from the bottom too
export const isSolvable = (tiles, n) => {
  const inv = inversions(tiles)
  if (n % 2) return inv % 2 === 0
  const rowFromBottom = n - Math.floor(tiles.indexOf(0) / n)
  return (inv + rowFromBottom) % 2 === 1
}

// A random solvable arrangement that isn't already solved (or nearly: at least n*n/2
// tiles out of place)
export const shuffle = (n, seed = Date.now()) => {
  const random = rng(seed)
  for (;;) {
    const tiles = solvedTiles(n)
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[tiles[i], tiles[j]] = [tiles[j], tiles[i]]
    }
    if (!isSolvable(tiles, n)) {
      // swapping two tiles (not the gap) flips solvability
      const a = tiles.findIndex((t) => t !== 0)
      const b = tiles.findIndex((t, i) => t !== 0 && i !== a)
      ;[tiles[a], tiles[b]] = [tiles[b], tiles[a]]
    }
    const misplaced = tiles.filter((t, i) => t !== 0 && t !== i + 1).length
    if (!isSolved(tiles) && misplaced >= Math.floor((n * n) / 2)) return tiles
  }
}

// Shuffle by k random legal moves from solved (always solvable; small k is easy)
export const scramble = (n, k, seed = 1) => {
  const random = rng(seed)
  let tiles = solvedTiles(n)
  let last = -1
  for (let i = 0; i < k; i++) {
    const gap = tiles.indexOf(0)
    const options = neighbors(n, gap).filter((p) => p !== last)
    const pick = options[Math.floor(random() * options.length)]
    last = gap
    tiles = move(tiles, n, pick).tiles
  }
  return tiles
}

export const neighbors = (n, index) => {
  const r = Math.floor(index / n)
  const c = index % n
  const out = []
  if (r > 0) out.push(index - n)
  if (r < n - 1) out.push(index + n)
  if (c > 0) out.push(index - 1)
  if (c < n - 1) out.push(index + 1)
  return out
}

// Can the tile at `index` slide? Anything in the gap's row or column can (pushing the
// tiles between along with it).
export const canMove = (tiles, n, index) => {
  const gap = tiles.indexOf(0)
  if (index === gap) return false
  return Math.floor(index / n) === Math.floor(gap / n) || index % n === gap % n
}

// Slide the tile at `index` toward the gap -> { tiles, moved } (moved = tiles that moved)
export const move = (tiles, n, index) => {
  if (!canMove(tiles, n, index)) return { tiles, moved: 0 }
  const next = [...tiles]
  let gap = next.indexOf(0)
  const step = Math.floor(index / n) === Math.floor(gap / n) ? (index > gap ? 1 : -1) : index > gap ? n : -n
  let moved = 0
  while (gap !== index) {
    next[gap] = next[gap + step]
    next[gap + step] = 0
    gap += step
    moved++
  }
  return { tiles: next, moved }
}
