// Cards for the casino games, on top of Solitaire's card basics (../cards/deck.js): a card is
// { id, suit, rank } with suit 0-3 (clubs, diamonds, hearts, spades) and rank 1 (ace) to
// 13 (king); the art is ../cards/art.js. A shoe is several decks shuffled together, and each
// card's id says which deck it came from ("QH.3") so React keys stay unique. Pure JS: the
// rules modules, the server (online Hold'em) and Node's tests import this.

import { RANK_LETTERS, SUIT_LETTERS, shuffle } from "../cards/deck.js"

export { shuffle }

export const card = (suit, rank, deck = 0) => ({ id: `${RANK_LETTERS[rank]}${SUIT_LETTERS[suit]}${deck ? `.${deck}` : ""}`, suit, rank })

// "AS", "TD", "9c" -> a card (tests and the hand evaluator's examples use these)
export const parse = (name) => {
  const rank = RANK_LETTERS.indexOf(name[0].toUpperCase())
  const suit = SUIT_LETTERS.indexOf(name[1].toUpperCase())
  if (rank < 1 || suit < 0) throw new Error(`not a card: ${name}`)
  return card(suit, rank)
}
export const parseAll = (text) => text.trim().split(/\s+/).filter(Boolean).map(parse)

// `decks` decks in order (suit by suit, ace to king)
export const freshShoe = (decks = 1) => {
  const out = []
  for (let d = 0; d < decks; d++) for (let suit = 0; suit < 4; suit++) for (let rank = 1; rank <= 13; rank++) out.push(card(suit, rank, decks > 1 ? d + 1 : 0))
  return out
}

export const newShoe = (decks = 1, random = Math.random) => shuffle(freshShoe(decks), random)

export const SUIT_SYMBOLS = ["♣", "♦", "♥", "♠"]
export const RANK_NAMES = ["", "Ace", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Jack", "Queen", "King"]
export const shortName = (c) => `${c.rank === 10 ? "10" : RANK_LETTERS[c.rank]}${SUIT_SYMBOLS[c.suit]}`
