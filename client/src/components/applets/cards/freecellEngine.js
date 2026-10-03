// FreeCell, the rules of the Windows 98 game. Pure functions like klondike.js.
//
// Piles: "c0"-"c3" free cells (0 or 1 card), "h0"-"h3" home cells (filled in the order
// the aces arrive) and "t0"-"t7" columns.

import { msDeal, sameColor } from "./deck.js"

export const CELLS = ["c0", "c1", "c2", "c3"]
export const HOMES = ["h0", "h1", "h2", "h3"]
export const COLUMNS = ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"]
export const MAX_GAME = 32000

export const dealGame = (game) => {
  const deck = msDeal(game)
  const columns = Array.from({ length: 8 }, () => [])
  deck.forEach((card, i) => columns[i % 8].push(card))
  return { game, cells: [[], [], [], []], homes: [[], [], [], []], columns, moves: 0 }
}

export const randomGame = (random = Math.random) => 1 + Math.floor(random() * MAX_GAME)

// ---- reading piles ----

const group = (id) => (id[0] === "c" ? "cells" : id[0] === "h" ? "homes" : "columns")

export const pile = (state, id) => state[group(id)][Number(id.slice(1))]

const withPile = (state, id, cards) => {
  const key = group(id)
  const i = Number(id.slice(1))
  return { ...state, [key]: state[key].map((p, j) => (j === i ? cards : p)) }
}

const top = (cards) => cards[cards.length - 1]

export const cardsLeft = (state) => 52 - state.homes.reduce((n, h) => n + h.length, 0)
export const isWon = (state) => cardsLeft(state) === 0

// ---- what can move ----

const follows = (lower, upper) => !sameColor(lower, upper) && upper.rank === lower.rank + 1

// How many cards at the bottom of a column form an alternating, descending run
export const runLength = (cards) => {
  if (!cards.length) return 0
  let n = 1
  while (n < cards.length && follows(cards[cards.length - n], cards[cards.length - n - 1])) n++
  return n
}

export const freeCellCount = (state) => state.cells.filter((c) => !c.length).length
export const emptyColumnCount = (state, except = null) => state.columns.filter((c, i) => !c.length && COLUMNS[i] !== except).length

// The most cards a "supermove" can carry, through free cells and empty columns: (cells + 1)
// doubled for each empty column (the destination doesn't count when it is one)
export const maxMovable = (state, to = null) => {
  const empties = emptyColumnCount(state, to && to[0] === "t" && !pile(state, to).length ? to : null)
  return (freeCellCount(state) + 1) * 2 ** empties
}

export const canPickUp = (state, from, index) => {
  const cards = pile(state, from)
  if (index < 0 || index >= cards.length || from[0] === "h") return false
  return cards.length - index <= runLength(cards)
}

export const accepts = (state, to, card, count = 1) => {
  const cards = pile(state, to)
  if (to[0] === "c") return count === 1 && !cards.length
  if (to[0] === "h") {
    if (count !== 1) return false
    const t = top(cards)
    return t ? t.suit === card.suit && t.rank === card.rank - 1 : card.rank === 1
  }
  if (count > maxMovable(state, to)) return false
  const t = top(cards)
  return !t || follows(card, t)
}

export const canMove = (state, from, index, to) => {
  if (from === to || !canPickUp(state, from, index)) return false
  const cards = pile(state, from)
  return accepts(state, to, cards[index], cards.length - index)
}

export const move = (state, from, index, to) => {
  if (!canMove(state, from, index, to)) return null
  const cards = pile(state, from)
  let next = withPile(state, from, cards.slice(0, index))
  next = withPile(next, to, [...pile(next, to), ...cards.slice(index)])
  return { ...next, moves: state.moves + 1 }
}

// Click a card, click a destination: how many cards does that move? For a column with a
// card on it the run must end on the right card; onto an empty column (or a cell or home)
// as many as can go (the caller asks "column or single card?" for empty columns).
export const countFor = (state, from, to) => {
  const cards = pile(state, from)
  if (!cards.length) return 0
  if (from[0] !== "t" || to[0] !== "t") return canMove(state, from, cards.length - 1, to) ? 1 : 0
  const run = runLength(cards)
  const target = top(pile(state, to))
  if (!target) {
    const n = Math.min(run, maxMovable(state, to))
    return n
  }
  for (let n = 1; n <= run; n++) {
    if (follows(cards[cards.length - n], target)) return canMove(state, from, cards.length - n, to) ? n : 0
  }
  return 0
}

// A home cell that takes `card`
export const homeFor = (state, card) => HOMES.find((h) => accepts(state, h, card, 1)) || null
export const freeCell = (state) => CELLS.find((c) => !pile(state, c).length) || null

// ---- automatic moves home ----

// A card is safe to send home once nothing could ever need to go on it: aces and twos
// always, others once both suits of the other color are home up to one rank below
export const isSafeHome = (state, card) => {
  if (card.rank <= 2) return true
  const homeRank = (suit) => {
    const h = state.homes.find((p) => p.length && p[0].suit === suit)
    return h ? h.length : 0
  }
  const opposite = card.suit === 1 || card.suit === 2 ? [0, 3] : [1, 2]
  return opposite.every((s) => homeRank(s) >= card.rank - 1)
}

// The next card the game sends home on its own: { state, from, to } or null
export const autoStep = (state) => {
  for (const from of [...CELLS, ...COLUMNS]) {
    const card = top(pile(state, from))
    if (!card) continue
    const to = homeFor(state, card)
    if (to && isSafeHome(state, card)) return { state: move(state, from, pile(state, from).length - 1, to), from, to }
  }
  return null
}

// Every legal move (counting each source card once per destination): for "no more moves"
export const legalMoves = (state) => {
  const list = []
  for (const from of [...CELLS, ...COLUMNS]) {
    const cards = pile(state, from)
    if (!cards.length) continue
    const run = from[0] === "t" ? runLength(cards) : 1
    for (const to of [...HOMES, ...CELLS, ...COLUMNS]) {
      if (to === from) continue
      // only one free cell or empty column counts (they're all the same move)
      if (to[0] === "c" && to !== freeCell(state)) continue
      if (to[0] === "t" && !pile(state, to).length && to !== COLUMNS.find((c) => c !== from && !pile(state, c).length)) continue
      for (let n = 1; n <= run; n++) {
        if (canMove(state, from, cards.length - n, to)) {
          // pointless shuffles: a whole column to an empty one
          // (a free cell's card to an empty column is a real move)
          if (from[0] === "t" && to[0] === "t" && !pile(state, to).length && n === cards.length) continue
          if (to[0] === "c" && from[0] === "c") continue
          list.push({ from, index: cards.length - n, to })
        }
      }
    }
  }
  return list
}
