// Video Poker, Jacks or Better, the full-pay "9/6" machine: deal five cards, hold any of them,
// draw replacements from the rest of the deck, and get paid by the paytable below (each row's
// pays for 1 to 5 coins; the royal flush jumps to 4000 at 5 coins, so max coins is the way to play).

import { newShoe } from "./cards.js"
import { evaluate, value } from "./poker.js"

export const HANDS = [
  { id: "royal", name: "Royal Flush", pays: [250, 500, 750, 1000, 4000] },
  { id: "sflush", name: "Straight Flush", pays: [50, 100, 150, 200, 250] },
  { id: "quads", name: "Four of a Kind", pays: [25, 50, 75, 100, 125] },
  { id: "full", name: "Full House", pays: [9, 18, 27, 36, 45] },
  { id: "flush", name: "Flush", pays: [6, 12, 18, 24, 30] },
  { id: "straight", name: "Straight", pays: [4, 8, 12, 16, 20] },
  { id: "trips", name: "Three of a Kind", pays: [3, 6, 9, 12, 15] },
  { id: "twopair", name: "Two Pair", pays: [2, 4, 6, 8, 10] },
  { id: "jacks", name: "Jacks or Better", pays: [1, 2, 3, 4, 5] },
]

// a five-card hand -> its paytable row id, or null
export const classify = (cards) => {
  const e = evaluate(cards)
  switch (e.cat) {
    case 8:
      return e.ranks[0] === 14 ? "royal" : "sflush"
    case 7:
      return "quads"
    case 6:
      return "full"
    case 5:
      return "flush"
    case 4:
      return "straight"
    case 3:
      return "trips"
    case 2:
      return "twopair"
    case 1:
      return e.ranks[0] >= 11 ? "jacks" : null
    default:
      return null
  }
}

// chips back for this hand at `coins` coins (1-5) of `denom` chips each
export const payFor = (cards, coins, denom = 1) => {
  const id = classify(cards)
  if (!id) return { id: null, name: null, win: 0 }
  const row = HANDS.find((h) => h.id === id)
  return { id, name: row.name, win: row.pays[coins - 1] * denom }
}

export const deal = (random = Math.random) => {
  const deck = newShoe(1, random)
  return { hand: deck.splice(-5), deck }
}

// replace the cards not held (held: 5 booleans)
export const draw = ({ hand, deck }, held) => {
  const rest = deck.slice()
  const next = hand.map((c, i) => (held[i] ? c : rest.pop()))
  return { hand: next, deck: rest }
}

// a quick hint: the classic Jacks or Better strategy, in order
export const hint = (hand) => {
  const keep = (pred) => hand.map((c, i) => pred(c, i))
  const id = classify(hand)
  if (id && ["royal", "sflush", "quads", "full", "flush", "straight"].includes(id)) return keep(() => true)
  const counts = new Map()
  for (const c of hand) counts.set(value(c), (counts.get(value(c)) || 0) + 1)
  const suitCount = [0, 0, 0, 0]
  for (const c of hand) suitCount[c.suit]++
  const flushSuit = suitCount.findIndex((n) => n >= 4)
  // four to a royal
  for (let s = 0; s < 4; s++) {
    const royal = hand.filter((c) => c.suit === s && value(c) >= 10)
    if (royal.length >= 4) return keep((c) => c.suit === s && value(c) >= 10)
  }
  if (id === "trips") return keep((c) => counts.get(value(c)) === 3)
  if (id === "twopair") return keep((c) => counts.get(value(c)) === 2)
  if (id === "jacks") return keep((c) => counts.get(value(c)) === 2)
  if (flushSuit >= 0) return keep((c) => c.suit === flushSuit)
  // a low pair
  if ([...counts.values()].includes(2)) return keep((c) => counts.get(value(c)) === 2)
  // three to a royal
  for (let s = 0; s < 4; s++) {
    const royal = hand.filter((c) => c.suit === s && value(c) >= 10)
    if (royal.length === 3) return keep((c) => c.suit === s && value(c) >= 10)
  }
  // four to an open straight
  const vals = [...new Set(hand.map(value))].sort((a, b) => a - b)
  for (let lo = 2; lo <= 10; lo++) {
    const run = [lo, lo + 1, lo + 2, lo + 3]
    if (run.every((v) => vals.includes(v))) {
      const used = new Set()
      return keep((c) => run.includes(value(c)) && !used.has(value(c)) && used.add(value(c)))
    }
  }
  // high cards (at most two, the lowest ones are kept)
  const high = hand.filter((c) => value(c) >= 11).sort((a, b) => value(a) - value(b)).slice(0, 2)
  return keep((c) => high.includes(c))
}
