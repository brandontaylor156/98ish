// Klondike, the rules and scoring of Windows 98 Solitaire. Pure functions: every move
// returns a new state (or null when it isn't allowed), so undo is a stack of states.
//
// Piles are named "stock", "waste", "f0"-"f3" (foundations) and "t0"-"t6" (tableau).
// options: { draw: 1 | 3, scoring: "standard" | "vegas" | "none" }

import { newDeck, sameColor, shuffle } from "./deck.js"

export const VEGAS_ANTE = 52
export const FOUNDATIONS = ["f0", "f1", "f2", "f3"]
export const TABLEAU = ["t0", "t1", "t2", "t3", "t4", "t5", "t6"]

// Standard scoring, as in the Windows help
export const POINTS = {
  wasteToTableau: 5,
  toFoundation: 10,
  turnOver: 5,
  fromFoundation: -15,
  recycleOne: -100,
  recycleThree: -20,
  timePenalty: -2, // every 10 seconds of a timed game
}
export const VEGAS_PER_CARD = 5

export const deal = (options = {}, random = Math.random) => {
  const draw = options.draw === 3 ? 3 : 1
  const scoring = options.scoring || "standard"
  const deck = shuffle(newDeck(), random)
  const tableau = []
  let next = 0
  for (let col = 0; col < 7; col++) {
    const pile = []
    for (let row = 0; row <= col; row++) pile.push({ ...deck[next++], up: row === col })
    tableau.push(pile)
  }
  return {
    draw,
    scoring,
    stock: deck.slice(next).map((c) => ({ ...c, up: false })),
    waste: [],
    fan: 0, // how many waste cards are fanned out (Draw Three shows the last draw)
    foundations: [[], [], [], []],
    tableau,
    score: scoring === "vegas" ? -VEGAS_ANTE : 0,
    passes: 1, // times through the stock, counting this one
    moves: 0,
  }
}

// ---- reading piles ----

export const pile = (state, id) => {
  if (id === "stock") return state.stock
  if (id === "waste") return state.waste
  if (id[0] === "f") return state.foundations[Number(id.slice(1))]
  return state.tableau[Number(id.slice(1))]
}

const withPile = (state, id, cards) => {
  if (id === "stock") return { ...state, stock: cards }
  if (id === "waste") return { ...state, waste: cards }
  const i = Number(id.slice(1))
  if (id[0] === "f") return { ...state, foundations: state.foundations.map((p, j) => (j === i ? cards : p)) }
  return { ...state, tableau: state.tableau.map((p, j) => (j === i ? cards : p)) }
}

const top = (cards) => cards[cards.length - 1]

const addScore = (state, points) => {
  if (state.scoring === "none") return state
  const score = state.score + points
  return { ...state, score: state.scoring === "standard" ? Math.max(0, score) : score }
}

// ---- the stock ----

// Vegas allows one pass through the deck dealing one, three dealing three
export const passLimit = (state) => (state.scoring === "vegas" ? (state.draw === 3 ? 3 : 1) : Infinity)

export const canRecycle = (state) => state.stock.length === 0 && state.waste.length > 0 && state.passes < passLimit(state)

// Click on the stock: deal one or three to the waste, or turn the waste back over
export const drawStock = (state) => {
  if (state.stock.length) {
    const n = Math.min(state.draw, state.stock.length)
    const drawn = state.stock.slice(-n).reverse().map((c) => ({ ...c, up: true }))
    return { ...state, stock: state.stock.slice(0, -n), waste: [...state.waste, ...drawn], fan: n, moves: state.moves + 1 }
  }
  if (!canRecycle(state)) return null
  let next = {
    ...state,
    stock: state.waste.slice().reverse().map((c) => ({ ...c, up: false })),
    waste: [],
    fan: 0,
    passes: state.passes + 1,
    moves: state.moves + 1,
  }
  if (state.scoring === "standard") {
    if (state.draw === 1) next = addScore(next, POINTS.recycleOne)
    else if (state.passes >= 3) next = addScore(next, POINTS.recycleThree)
  }
  return next
}

// ---- turning tableau cards ----

export const canFlip = (state, id) => {
  if (id[0] !== "t") return false
  const card = top(pile(state, id))
  return !!card && !card.up
}

export const flip = (state, id) => {
  if (!canFlip(state, id)) return null
  const cards = pile(state, id)
  const next = withPile(state, id, [...cards.slice(0, -1), { ...top(cards), up: true }])
  return addScore({ ...next, moves: state.moves + 1 }, state.scoring === "standard" ? POINTS.turnOver : 0)
}

// ---- moving cards ----

// Can the cards from `index` up in pile `from` be picked up?
export const canPickUp = (state, from, index) => {
  const cards = pile(state, from)
  if (index < 0 || index >= cards.length || !cards[index].up) return false
  if (from === "stock") return false
  if (from === "waste" || from[0] === "f") return index === cards.length - 1
  return true // face-up tableau cards are always an alternating run
}

// Would `card` (the bottom of the moving run) go on pile `to`?
export const accepts = (state, to, card, count = 1) => {
  if (to[0] === "f") {
    if (count !== 1) return false
    const t = top(pile(state, to))
    return t ? t.suit === card.suit && t.rank === card.rank - 1 : card.rank === 1
  }
  if (to[0] === "t") {
    const t = top(pile(state, to))
    if (!t) return card.rank === 13
    return t.up && !sameColor(t, card) && t.rank === card.rank + 1
  }
  return false
}

export const canMove = (state, from, index, to) => {
  if (from === to || !canPickUp(state, from, index)) return false
  const cards = pile(state, from)
  return accepts(state, to, cards[index], cards.length - index)
}

const moveScore = (state, from, to) => {
  if (state.scoring === "vegas") return to[0] === "f" ? VEGAS_PER_CARD : from[0] === "f" ? -VEGAS_PER_CARD : 0
  if (state.scoring !== "standard") return 0
  if (to[0] === "f") return from[0] === "f" ? 0 : POINTS.toFoundation
  if (from === "waste") return POINTS.wasteToTableau
  if (from[0] === "f") return POINTS.fromFoundation
  return 0
}

export const move = (state, from, index, to) => {
  if (!canMove(state, from, index, to)) return null
  const cards = pile(state, from)
  const moving = cards.slice(index)
  let next = withPile(state, from, cards.slice(0, index))
  next = withPile(next, to, [...pile(next, to), ...moving])
  if (from === "waste") next.fan = Math.max(state.waste.length > 1 ? 1 : 0, state.fan - 1)
  next.moves = state.moves + 1
  return addScore(next, moveScore(state, from, to))
}

// The foundation a card can go to, or null
export const foundationFor = (state, card) => FOUNDATIONS.find((f) => accepts(state, f, card, 1)) || null

// Double-click: the top card of a pile goes home if it can
export const toFoundation = (state, from) => {
  const cards = pile(state, from)
  if (!cards.length || from[0] === "f") return null
  const f = foundationFor(state, top(cards))
  return f ? move(state, from, cards.length - 1, f) : null
}

// Right-click: send everything that can go home, home
export const autoPlay = (state) => {
  let current = state
  for (;;) {
    const step = ["waste", ...TABLEAU].map((id) => toFoundation(current, id)).find(Boolean)
    if (!step) return current === state ? null : current
    current = step
  }
}

// ---- end of game ----

export const isWon = (state) => state.foundations.every((f) => f.length === 13)

// Every card is face up and dealt: the rest plays itself
export const canAutoFinish = (state) =>
  !isWon(state) && state.stock.length === 0 && state.waste.length === 0 && state.tableau.every((p) => p.every((c) => c.up))

// One step of the auto-finish: the lowest card that can go home
export const finishStep = (state) => {
  let best = null
  for (const id of ["waste", ...TABLEAU]) {
    const card = top(pile(state, id))
    if (card && card.up && foundationFor(state, card) && (!best || card.rank < best.card.rank)) best = { id, card }
  }
  return best ? toFoundation(state, best.id) : null
}

// A timed standard game loses 2 points every 10 seconds
export const applyTimePenalty = (state) => (state.scoring === "standard" ? addScore(state, POINTS.timePenalty) : state)

// The bonus for winning a timed standard game: 700,000 / seconds (games under 30 s get none)
export const timeBonus = (state, seconds) => (state.scoring === "standard" && seconds >= 30 ? Math.floor(700000 / seconds) : 0)

// Are any moves left at all? (used only for hints; Windows 98 never told you)
export const hasMoves = (state) => {
  if (state.stock.length || canRecycle(state)) return true
  for (const from of ["waste", ...TABLEAU, ...FOUNDATIONS]) {
    if (canFlip(state, from)) return true
    const cards = pile(state, from)
    for (let i = 0; i < cards.length; i++) {
      if (!canPickUp(state, from, i)) continue
      for (const to of [...FOUNDATIONS, ...TABLEAU]) if (canMove(state, from, i, to)) return true
    }
  }
  return false
}
