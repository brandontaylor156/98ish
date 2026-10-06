// Blackjack's rules, as pure functions of a table state (every move returns a new state).
// The house rules most casinos post: a 6-deck shoe reshuffled at the cut card (75% dealt),
// blackjack pays 3:2, the dealer peeks for blackjack under an ace or a ten, insurance pays
// 2:1, double on any first two cards (and after a split), split pairs of the same value up to
// four hands, split aces get one card each (and 21 there isn't a blackjack), no re-splitting
// aces. Options: the dealer hits soft 17 (h17), late surrender, double after split (das).
//
// Chips: the table counts what's been put on it this round (`staked`) and, once settled,
// what comes back (`returned`, stake included). The window moves those to and from the
// chip bank (bank.js), and asks canDouble / canSplit / canInsure with the bank's balance.
//
// Phases: "betting" -> deal -> "insurance" (dealer shows an ace) -> "player" -> "done".

import { newShoe } from "./cards.js"

export const DEFAULTS = { decks: 6, h17: false, das: true, surrender: false }
const MAX_HANDS = 4
const PENETRATION = 0.75

const clone = (x) => JSON.parse(JSON.stringify(x))
export const cardValue = (c) => (c.rank === 1 ? 1 : Math.min(10, c.rank))

// { total, soft }: soft when an ace counts as 11
export const handValue = (cards) => {
  let sum = 0
  let aces = 0
  for (const c of cards) {
    sum += cardValue(c)
    if (c.rank === 1) aces++
  }
  const soft = aces > 0 && sum + 10 <= 21
  return { total: soft ? sum + 10 : sum, soft }
}
export const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21
export const describe = (cards) => {
  const v = handValue(cards)
  if (isBlackjack(cards)) return "Blackjack"
  if (v.total > 21) return `Bust (${v.total})`
  return v.soft && v.total < 21 ? `${v.total - 10} / ${v.total}` : String(v.total)
}

export const createTable = (settings = {}, random = Math.random) => {
  const s = { ...DEFAULTS, ...settings }
  return { settings: s, shoe: newShoe(s.decks, random), phase: "betting", dealer: [], hands: [], active: -1, insurance: 0, staked: 0, returned: 0, reshuffled: false, round: 0 }
}

export const shoeLow = (state) => state.shoe.length < state.settings.decks * 52 * (1 - PENETRATION)

const draw = (state, random) => {
  if (!state.shoe.length) state.shoe = newShoe(state.settings.decks, random)
  return state.shoe.pop()
}

const newHand = (cards, bet, extra = {}) => ({ cards, bet, doubled: false, done: false, splitAces: false, fromSplit: false, surrendered: false, result: null, payout: 0, ...extra })

export const deal = (state, bet, random = Math.random) => {
  if (state.phase !== "betting" && state.phase !== "done") return { error: "Finish this hand first." }
  if (!(bet > 0) || !Number.isInteger(bet)) return { error: "Place a bet first." }
  const s = clone(state)
  s.reshuffled = false
  if (shoeLow(s)) {
    s.shoe = newShoe(s.settings.decks, random)
    s.reshuffled = true
  }
  s.round += 1
  s.staked = bet
  s.returned = 0
  s.insurance = 0
  s.result = null
  const p = [draw(s, random)]
  const d = [draw(s, random)]
  p.push(draw(s, random))
  d.push(draw(s, random))
  s.dealer = d
  s.hands = [newHand(p, bet)]
  s.active = 0
  s.holeHidden = true
  if (d[0].rank === 1) {
    s.phase = "insurance"
    return s
  }
  return afterPeek(s, random)
}

// the dealer checks for blackjack (a ten or an ace showing)
const afterPeek = (s, random) => {
  const up = cardValue(s.dealer[0])
  const dealerBJ = (up === 10 || up === 1) && isBlackjack(s.dealer)
  if (dealerBJ || isBlackjack(s.hands[0].cards)) return settle(s, random)
  s.phase = "player"
  return s
}

export const canInsure = (state, bankroll = Infinity) => state.phase === "insurance" && Math.floor(state.hands[0].bet / 2) > 0 && bankroll >= Math.floor(state.hands[0].bet / 2)

export const insurance = (state, take, bankroll = Infinity, random = Math.random) => {
  if (state.phase !== "insurance") return { error: "No insurance now." }
  const s = clone(state)
  if (take) {
    if (!canInsure(state, bankroll)) return { error: "Not enough chips for insurance." }
    s.insurance = Math.floor(s.hands[0].bet / 2)
    s.staked += s.insurance
  }
  return afterPeek(s, random)
}

const current = (s) => s.hands[s.active]

export const canHit = (state) => state.phase === "player" && !current(state).done
export const canDouble = (state, bankroll = Infinity) => {
  if (state.phase !== "player") return false
  const h = current(state)
  if (h.cards.length !== 2 || h.splitAces || h.done) return false
  if (h.fromSplit && !state.settings.das) return false
  return bankroll >= h.bet
}
export const canSplit = (state, bankroll = Infinity) => {
  if (state.phase !== "player") return false
  const h = current(state)
  if (h.cards.length !== 2 || h.done || state.hands.length >= MAX_HANDS) return false
  if (cardValue(h.cards[0]) !== cardValue(h.cards[1])) return false
  if (h.splitAces) return false // no re-splitting aces
  return bankroll >= h.bet
}
export const canSurrender = (state) => state.phase === "player" && state.settings.surrender && state.hands.length === 1 && current(state).cards.length === 2 && !current(state).fromSplit

// on to the next hand that still needs playing, or the dealer
const advance = (s, random) => {
  while (s.active < s.hands.length && s.hands[s.active].done) s.active++
  if (s.active >= s.hands.length) {
    s.active = s.hands.length - 1
    return dealerPlays(s, random)
  }
  // a split hand gets its second card when it's played
  const h = current(s)
  if (h.cards.length === 1) {
    h.cards.push(draw(s, random))
    if (h.splitAces || handValue(h.cards).total === 21) h.done = true
    if (h.done) return advance(s, random)
  }
  return s
}

const finishIfDone = (s, random) => {
  const h = current(s)
  if (handValue(h.cards).total >= 21) h.done = true
  return h.done ? advance(s, random) : s
}

export const hit = (state, random = Math.random) => {
  if (!canHit(state)) return { error: "You can't hit now." }
  const s = clone(state)
  current(s).cards.push(draw(s, random))
  return finishIfDone(s, random)
}

export const stand = (state, random = Math.random) => {
  if (state.phase !== "player") return { error: "You can't stand now." }
  const s = clone(state)
  current(s).done = true
  return advance(s, random)
}

export const double = (state, bankroll = Infinity, random = Math.random) => {
  if (!canDouble(state, bankroll)) return { error: "You can't double now." }
  const s = clone(state)
  const h = current(s)
  s.staked += h.bet
  h.bet *= 2
  h.doubled = true
  h.cards.push(draw(s, random))
  h.done = true
  return advance(s, random)
}

export const split = (state, bankroll = Infinity, random = Math.random) => {
  if (!canSplit(state, bankroll)) return { error: "You can't split now." }
  const s = clone(state)
  const h = current(s)
  const aces = h.cards[0].rank === 1
  const second = newHand([h.cards[1]], h.bet, { fromSplit: true, splitAces: aces })
  h.cards = [h.cards[0]]
  h.fromSplit = true
  h.splitAces = aces
  s.staked += h.bet
  s.hands.splice(s.active + 1, 0, second)
  h.cards.push(draw(s, random))
  if (aces || handValue(h.cards).total === 21) h.done = true
  return h.done ? advance(s, random) : s
}

export const surrender = (state, random = Math.random) => {
  if (!canSurrender(state)) return { error: "You can't surrender now." }
  const s = clone(state)
  const h = current(s)
  h.surrendered = true
  h.done = true
  return advance(s, random)
}

const dealerPlays = (s, random) => {
  // nothing left to beat (every hand bust or surrendered): the dealer just turns the card over
  const live = s.hands.some((h) => !h.surrendered && handValue(h.cards).total <= 21)
  if (live) {
    for (;;) {
      const v = handValue(s.dealer)
      if (v.total < 17 || (v.total === 17 && v.soft && s.settings.h17)) s.dealer.push(draw(s, random))
      else break
    }
  }
  return settle(s, random)
}

// results and payouts. payout = chips back, stake included
export const settle = (s) => {
  s.holeHidden = false
  s.phase = "done"
  const dealerBJ = isBlackjack(s.dealer)
  const dealer = handValue(s.dealer).total
  let returned = 0
  const single = s.hands.length === 1
  for (const h of s.hands) {
    const v = handValue(h.cards).total
    const natural = single && !h.fromSplit && isBlackjack(h.cards)
    if (h.surrendered) {
      h.result = "surrender"
      h.payout = Math.floor(h.bet / 2)
    } else if (natural && !dealerBJ) {
      h.result = "blackjack"
      h.payout = h.bet + Math.floor((h.bet * 3) / 2)
    } else if (dealerBJ) {
      h.result = natural ? "push" : "lose"
      h.payout = natural ? h.bet : 0
    } else if (v > 21) {
      h.result = "bust"
      h.payout = 0
    } else if (dealer > 21 || v > dealer) {
      h.result = "win"
      h.payout = h.bet * 2
    } else if (v === dealer) {
      h.result = "push"
      h.payout = h.bet
    } else {
      h.result = "lose"
      h.payout = 0
    }
    returned += h.payout
  }
  if (s.insurance) returned += dealerBJ ? s.insurance * 3 : 0
  s.returned = returned
  s.result = { returned, net: returned - s.staked, dealerBJ, insuranceWon: !!s.insurance && dealerBJ }
  return s
}

// basic strategy for a hint (6 decks, S17, DAS): "hit" | "stand" | "double" | "split" | "surrender"
export const hint = (state) => {
  if (state.phase === "insurance") return "no insurance"
  if (state.phase !== "player") return null
  const h = current(state)
  const up = cardValue(state.dealer[0])
  const d = up === 1 ? 11 : up
  const v = handValue(h.cards)
  const two = h.cards.length === 2
  if (two && canSplit(state)) {
    const r = cardValue(h.cards[0])
    const pair = { 1: true, 8: true, 9: d !== 7 && d !== 10 && d !== 11, 7: d <= 7, 6: d <= 6, 4: d === 5 || d === 6, 3: d <= 7, 2: d <= 7 }
    if (pair[r]) return "split"
  }
  if (canSurrender(state) && !v.soft && ((v.total === 16 && d >= 9) || (v.total === 15 && d === 10))) return "surrender"
  const dbl = two && canDouble(state)
  if (v.soft) {
    const t = v.total
    if (t >= 20) return "stand"
    if (t === 19) return d === 6 && dbl ? "double" : "stand"
    if (t === 18) return d <= 6 && dbl && d >= 3 ? "double" : d <= 8 ? "stand" : "hit"
    if (t === 17) return d >= 3 && d <= 6 && dbl ? "double" : "hit"
    if (t >= 15) return d >= 4 && d <= 6 && dbl ? "double" : "hit"
    return d >= 5 && d <= 6 && dbl ? "double" : "hit"
  }
  const t = v.total
  if (t >= 17) return "stand"
  if (t >= 13) return d <= 6 ? "stand" : "hit"
  if (t === 12) return d >= 4 && d <= 6 ? "stand" : "hit"
  if (t === 11) return dbl ? "double" : "hit"
  if (t === 10) return d <= 9 && dbl ? "double" : "hit"
  if (t === 9) return d >= 3 && d <= 6 && dbl ? "double" : "hit"
  return "hit"
}
