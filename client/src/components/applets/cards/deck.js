// Shared card basics for Solitaire and FreeCell. Pure JS, no React: the engines and their
// Node tests import this.
//
// A card is { id, suit, rank, up }: suit 0-3 in Microsoft's order (clubs, diamonds,
// hearts, spades), rank 1 (ace) to 13 (king), up = face up.

export const SUITS = ["clubs", "diamonds", "hearts", "spades"]
export const SUIT_LETTERS = "CDHS"
export const RANK_LETTERS = " A23456789TJQK"
export const RANK_LABELS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]

export const isRed = (card) => card.suit === 1 || card.suit === 2
export const sameColor = (a, b) => isRed(a) === isRed(b)

// "JD", "TC", "AS"...
export const cardName = (card) => RANK_LETTERS[card.rank] + SUIT_LETTERS[card.suit]

export const makeCard = (suit, rank, up = false) => ({ id: RANK_LETTERS[rank] + SUIT_LETTERS[suit], suit, rank, up })

// Parse "JD" back into a card (tests use this)
export const parseCard = (name, up = true) => makeCard(SUIT_LETTERS.indexOf(name[1]), RANK_LETTERS.indexOf(name[0]), up)

// A fresh ordered deck: A-K of clubs, then diamonds, hearts, spades
export const newDeck = () => {
  const deck = []
  for (let suit = 0; suit < 4; suit++) for (let rank = 1; rank <= 13; rank++) deck.push(makeCard(suit, rank))
  return deck
}

// Fisher-Yates with a pluggable random source
export const shuffle = (cards, random = Math.random) => {
  const deck = cards.slice()
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

// Microsoft's C runtime rand(), as FreeCell used it: a 31-bit LCG returning bits 16-30
export const msRandom = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 214013) + 2531011) >>> 0
    state &= 0x7fffffff
    return state >>> 16
  }
}

// The deck for FreeCell game number `seed`, in dealing order (card i goes to column i % 8).
// Card numbers are rank * 4 + suit, so the deck starts as AC AD AH AS 2C ...
export const msDeal = (seed) => {
  const rand = msRandom(seed)
  const order = Array.from({ length: 52 }, (_, i) => 51 - i)
  for (let i = 0; i < 52; i++) {
    const j = 51 - (rand() % (52 - i))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order.map((n) => makeCard(n % 4, Math.floor(n / 4) + 1, true))
}
