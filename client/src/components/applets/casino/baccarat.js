// Baccarat (punto banco): bet on the Player, the Banker or a Tie; the cards are dealt by fixed
// rules, nobody decides anything. Hands count their last digit (tens and faces are 0, aces 1).
// A natural (8 or 9 on two cards) stands for both. Otherwise the Player draws on 0-5; then the
// Banker draws by the third-card table below (or on 0-5 if the Player stood).
// Player pays 1:1, Banker 1:1 less 5% commission (rounded down), Tie 8:1 (Player and Banker
// bets push on a tie). An 8-deck shoe, reshuffled when it runs low.

import { newShoe } from "./cards.js"

export const DECKS = 8
export const PAYS = { player: 1, banker: 0.95, tie: 8 }

export const points = (c) => (c.rank >= 10 ? 0 : c.rank)
export const total = (cards) => cards.reduce((s, c) => s + points(c), 0) % 10

// the banker's rule once the Player has drawn: draw on banker totals up to...
// key: banker total -> the Player third-card values that make the banker draw
export const BANKER_DRAWS = {
  0: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  1: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  2: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  3: [0, 1, 2, 3, 4, 5, 6, 7, 9], // not on an 8
  4: [2, 3, 4, 5, 6, 7],
  5: [4, 5, 6, 7],
  6: [6, 7],
  7: [],
}

export const bankerDraws = (bankerTotal, playerThird) => {
  if (playerThird == null) return bankerTotal <= 5
  return (BANKER_DRAWS[bankerTotal] || []).includes(points(playerThird))
}

export const newShoeFor = (random = Math.random) => newShoe(DECKS, random)
export const shoeLow = (shoe) => shoe.length < 14

// deal a coup from the shoe (pops from the end): -> { player, banker, winner, natural, shoe }
export const coup = (shoeIn) => {
  const shoe = shoeIn.slice()
  const player = [shoe.pop()]
  const banker = [shoe.pop()]
  player.push(shoe.pop())
  banker.push(shoe.pop())
  const pt = total(player)
  const bt = total(banker)
  const natural = pt >= 8 || bt >= 8
  if (!natural) {
    let third = null
    if (pt <= 5) {
      third = shoe.pop()
      player.push(third)
    }
    if (bankerDraws(bt, third)) banker.push(shoe.pop())
  }
  const p = total(player)
  const b = total(banker)
  return { player, banker, playerTotal: p, bankerTotal: b, winner: p > b ? "player" : b > p ? "banker" : "tie", natural, shoe }
}

// chips back for each bet (stake included)
export const settle = (bets, winner) => {
  const back = {}
  let returned = 0
  for (const [side, amount] of Object.entries(bets)) {
    if (!amount) continue
    let r = 0
    if (side === winner) r = amount + Math.floor(amount * PAYS[side])
    else if (winner === "tie" && side !== "tie") r = amount // push
    back[side] = r
    returned += r
  }
  const staked = Object.values(bets).reduce((s, a) => s + (a || 0), 0)
  return { back, returned, staked, net: returned - staked }
}
