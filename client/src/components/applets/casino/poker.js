// Poker hand ranking for Texas Hold'em and Video Poker: the best five-card hand out of 5 to 7
// cards. evaluate() returns { cat, ranks, score, name, best }:
//   cat    0 high card, 1 pair, 2 two pair, 3 three of a kind, 4 straight, 5 flush,
//          6 full house, 7 four of a kind, 8 straight flush (a royal flush is the ace-high one)
//   ranks  the ranks that decide ties, most important first (aces are 14; a 5-high straight,
//          the "wheel", ranks 5)
//   score  one number: higher beats lower, equal splits the pot
//   best   the five cards that make the hand
// Pure JS (no imports from React): the server runs it for online Hold'em.

export const CATEGORY_NAMES = ["High Card", "One Pair", "Two Pair", "Three of a Kind", "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush"]
const PLURAL = ["", "", "Twos", "Threes", "Fours", "Fives", "Sixes", "Sevens", "Eights", "Nines", "Tens", "Jacks", "Queens", "Kings", "Aces"]
const SINGLE = ["", "", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Jack", "Queen", "King", "Ace"]

export const value = (c) => (c.rank === 1 ? 14 : c.rank)

const scoreOf = (cat, ranks) => {
  let s = cat
  for (let i = 0; i < 5; i++) s = s * 16 + (ranks[i] || 0)
  return s
}

// the highest straight in a set of ranks (a 15-slot presence array): its top rank, or 0
const straightTop = (has) => {
  for (let top = 14; top >= 5; top--) {
    let ok = true
    for (let r = top; r > top - 5; r--) {
      if (!has[r === 1 ? 14 : r]) {
        ok = false
        break
      }
    }
    if (ok) return top
  }
  return 0
}

// the cards of a straight topped by `top`, one per rank
const straightCards = (cards, top) => {
  const out = []
  for (let r = top; r > top - 5; r--) out.push(cards.find((c) => value(c) === (r === 1 ? 14 : r)))
  return out
}

const nameOf = (cat, ranks) => {
  switch (cat) {
    case 8:
      return ranks[0] === 14 ? "Royal Flush" : `Straight Flush, ${SINGLE[ranks[0]]} high`
    case 7:
      return `Four ${PLURAL[ranks[0]]}`
    case 6:
      return `Full House, ${PLURAL[ranks[0]]} full of ${PLURAL[ranks[1]]}`
    case 5:
      return `Flush, ${SINGLE[ranks[0]]} high`
    case 4:
      return `Straight, ${SINGLE[ranks[0]]} high`
    case 3:
      return `Three ${PLURAL[ranks[0]]}`
    case 2:
      return `Two Pair, ${PLURAL[ranks[0]]} and ${PLURAL[ranks[1]]}`
    case 1:
      return `Pair of ${PLURAL[ranks[0]]}`
    default:
      return `${SINGLE[ranks[0]]} High`
  }
}

const result = (cat, ranks, best) => ({ cat, ranks, score: scoreOf(cat, ranks), name: nameOf(cat, ranks), best })

export const evaluate = (cards) => {
  if (!cards || cards.length < 5) throw new Error("evaluate needs at least five cards")
  const sorted = [...cards].sort((a, b) => value(b) - value(a))

  // a flush (and maybe a straight flush) in one suit
  const bySuit = [[], [], [], []]
  for (const c of sorted) bySuit[c.suit].push(c)
  const flush = bySuit.find((s) => s.length >= 5)
  if (flush) {
    const has = new Array(15).fill(false)
    for (const c of flush) has[value(c)] = true
    has[1] = has[14]
    const top = straightTop(has)
    if (top) return result(8, [top], straightCards(flush, top))
  }

  // ranks by how many of each
  const groups = new Map()
  for (const c of sorted) {
    const v = value(c)
    if (!groups.has(v)) groups.set(v, [])
    groups.get(v).push(c)
  }
  // biggest group first, then the higher rank
  const g = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0])
  const kickers = (used, n) => sorted.filter((c) => !used.includes(c)).slice(0, n)

  if (g[0][1].length === 4) {
    const quad = g[0][1]
    const k = kickers(quad, 1)
    return result(7, [g[0][0], value(k[0])], [...quad, ...k])
  }
  if (g[0][1].length === 3) {
    // the highest other rank with two or more (a second set of three plays as the pair)
    const pair = g.slice(1).filter((x) => x[1].length >= 2).sort((a, b) => b[0] - a[0])[0]
    if (pair) return result(6, [g[0][0], pair[0]], [...g[0][1], ...pair[1].slice(0, 2)])
  }
  if (flush) {
    const best = flush.slice(0, 5)
    return result(5, best.map(value), best)
  }
  {
    const has = new Array(15).fill(false)
    for (const c of sorted) has[value(c)] = true
    has[1] = has[14]
    const top = straightTop(has)
    if (top) return result(4, [top], straightCards(sorted, top))
  }
  if (g[0][1].length === 3) {
    const k = kickers(g[0][1], 2)
    return result(3, [g[0][0], ...k.map(value)], [...g[0][1], ...k])
  }
  if (g[0][1].length === 2 && g[1] && g[1][1].length === 2) {
    const pairs = [...g[0][1], ...g[1][1]]
    const k = kickers(pairs, 1)
    return result(2, [g[0][0], g[1][0], value(k[0])], [...pairs, ...k])
  }
  if (g[0][1].length === 2) {
    const k = kickers(g[0][1], 3)
    return result(1, [g[0][0], ...k.map(value)], [...g[0][1], ...k])
  }
  const best = sorted.slice(0, 5)
  return result(0, best.map(value), best)
}

// compare two evaluations (or card lists): > 0 when a wins, 0 a tie
export const compare = (a, b) => {
  const x = Array.isArray(a) ? evaluate(a) : a
  const y = Array.isArray(b) ? evaluate(b) : b
  return x.score - y.score
}

// Monte Carlo equity: the share of the pot `hole` wins on average against `opponents` random
// hands, with the board so far (ties count as shares). Hold'em's computer players use it.
export const equity = (hole, board, opponents, { trials = 200, random = Math.random, deck } = {}) => {
  const known = new Set([...hole, ...board].map((c) => `${c.rank}:${c.suit}`))
  const rest = (deck || fullDeck()).filter((c) => !known.has(`${c.rank}:${c.suit}`))
  const need = 5 - board.length
  let share = 0
  const n = rest.length
  const pool = rest.slice()
  for (let t = 0; t < trials; t++) {
    // a partial shuffle: just the cards this trial draws
    const draw = need + opponents * 2
    for (let i = 0; i < draw; i++) {
      const j = i + Math.floor(random() * (n - i))
      const tmp = pool[i]
      pool[i] = pool[j]
      pool[j] = tmp
    }
    const fullBoard = board.concat(pool.slice(0, need))
    const mine = evaluate(hole.concat(fullBoard)).score
    let best = true
    let ties = 1
    for (let o = 0; o < opponents; o++) {
      const theirs = evaluate([pool[need + o * 2], pool[need + o * 2 + 1], ...fullBoard]).score
      if (theirs > mine) {
        best = false
        break
      }
      if (theirs === mine) ties++
    }
    if (best) share += 1 / ties
  }
  return share / trials
}

const fullDeck = () => {
  const out = []
  for (let suit = 0; suit < 4; suit++) for (let rank = 1; rank <= 13; rank++) out.push({ suit, rank })
  return out
}
