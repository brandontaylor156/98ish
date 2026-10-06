// Hold'em's computer players. Each decision starts from the hand's equity (poker.js: how
// often these cards win against the players still in, by simulation), then weighs the pot
// odds, the position, the street and a little style:
//   easy    plays loose and passive, misjudges its hands, calls too much, rarely bluffs
//   normal  sound: raises good hands, calls when the price is right, bluffs now and then
//   hard    more simulations, tighter calls, bigger value bets, semi-bluffs, slow-plays
// style 0-2 (by seat) gives each player a lean: 0 steady, 1 aggressive, 2 tight.
// Always returns a legal action for `legal` (holdem.js legalFor).

import { equity } from "./poker.js"

const LEVELS = {
  easy: { trials: 70, noise: 0.14, raiseBar: 2.1, callSlack: 0.82, bluff: 0.03, slowplay: 0, size: 0.5 },
  normal: { trials: 150, noise: 0.05, raiseBar: 1.65, callSlack: 1.0, bluff: 0.08, slowplay: 0.08, size: 0.65 },
  hard: { trials: 320, noise: 0, raiseBar: 1.5, callSlack: 1.06, bluff: 0.12, slowplay: 0.2, size: 0.8 },
}
const STYLES = [
  { aggro: 1, tight: 0 },
  { aggro: 1.35, tight: -0.04 },
  { aggro: 0.85, tight: 0.05 },
]

const clampTo = (legal, to) => Math.max(legal.minTo, Math.min(legal.maxTo, Math.round(to)))

export const decide = ({ hole, board, opponents, legal, street, position = 0.5, difficulty = "normal", style = 0, random = Math.random }) => {
  const L = LEVELS[difficulty] || LEVELS.normal
  const S = STYLES[style] || STYLES[0]
  const opp = Math.max(1, opponents)
  let eq = equity(hole, board, opp, { trials: L.trials, random })
  if (L.noise) eq = Math.min(1, Math.max(0, eq + (random() * 2 - 1) * L.noise))
  // strength against a fair share of the pot (1 = an average hand here)
  let rel = eq * (opp + 1)
  if (difficulty !== "easy") rel += (position - 0.5) * 0.25
  rel -= S.tight * (opp + 1)

  const { toCall, pot, canCheck, canRaise, bb } = legal
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0
  const preflop = street === "preflop"
  const committed = toCall >= legal.stack // calling puts us all-in

  const raiseTo = (fraction) => {
    if (preflop) {
      // 3 big blinds to open, 3x a raise
      const base = legal.currentBet <= bb ? bb * 3 : legal.currentBet * 3
      return clampTo(legal, base + (random() < 0.3 ? bb : 0))
    }
    return clampTo(legal, legal.currentBet + (pot + toCall) * fraction)
  }
  const raise = (fraction) => {
    let to = raiseTo(fraction)
    // most of the stack anyway: all of it
    if (to > legal.bet + legal.stack * 0.6) to = legal.maxTo
    return { type: "raise", to }
  }
  const passive = () => (canCheck ? { type: "check" } : { type: "call" })

  // monsters: raise, unless slow-playing on an early street
  if (rel >= L.raiseBar * 1.55 && canRaise) {
    if (!preflop && street !== "river" && random() < L.slowplay) return passive()
    return raise(L.size * S.aggro + 0.25)
  }
  // strong: raise (sometimes just call a raise)
  if (rel >= L.raiseBar && canRaise) {
    if (toCall > pot * 0.75 && random() < 0.5) return passive()
    if (random() < Math.min(0.95, 0.6 * S.aggro + (difficulty === "easy" ? -0.25 : 0.1))) return raise(L.size * S.aggro)
    return passive()
  }

  if (canCheck) {
    // a free card; bluff now and then from late position into few players
    const bluffChance = L.bluff * S.aggro * (0.4 + position) * (opp <= 2 ? 1 : 0.35)
    // hard players semi-bluff draws on the flop and turn
    const drawy = difficulty === "hard" && (street === "flop" || street === "turn") && eq > 0.3 && opp === 1
    if (canRaise && (random() < bluffChance || (drawy && random() < 0.35))) return raise(0.5)
    return { type: "check" }
  }

  // facing a bet: is the price right?
  const need = potOdds * L.callSlack + (committed ? 0.04 : 0) + (difficulty === "easy" ? -0.04 : 0.01)
  if (eq >= need) return { type: "call" }
  // tiny bets get called by loose players
  if (difficulty === "easy" && toCall <= bb * 2 && random() < 0.5) return { type: "call" }
  return { type: "fold" }
}
