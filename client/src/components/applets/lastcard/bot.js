// Last Card's computer players. botAction(state, seat, { now }) is the move a computer
// player makes (or null: nothing to do); botDelay(...) how long it "thinks" first. Both
// are deterministic for a given state (choices that look random roll on the state's event
// number and the seat), so asking twice gives the same answer.
//
// Strategy: hold wilds for when they count, dump high-point cards, keep the color you have
// most of, hit the leader (and anyone close to going out) with Skips and draw cards, swap
// with the smallest hand under 7-0, call Last Card (easy players forget sometimes), catch
// people who don't, jump in, and challenge Draw Fours that smell like bluffs. Characters
// (cards.js PERSONAS) lean one way or another; the level decides how sharp they are.

import { CATCH_MS, DRAWS, isWild, points } from "./cards.js"
import { bestColor, legalPlays, nextSeat } from "./rules.js"

const LEVELS = {
  easy: { forget: 0.35, catch: 0.3, catchMs: 2200, jump: 0.25, noise: 60, mistake: 0.45 },
  normal: { forget: 0.12, catch: 0.7, catchMs: 1500, jump: 0.45, noise: 14, mistake: 0 },
  hard: { forget: 0.03, catch: 0.95, catchMs: 950, jump: 0.75, noise: 4, mistake: 0 },
}

// A number in [0, 1) from a few integers (the same inputs, the same number)
export const roll = (...parts) => {
  let h = 2166136261
  for (const p of parts) {
    h ^= (p | 0) + 0x9e3779b9
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
  }
  return (h >>> 0) / 4294967296
}

const levelOf = (s) => LEVELS[s.settings.bots] || LEVELS.normal

// The opponent closest to winning: fewest cards, then most points
const leaderOf = (s, seat) => {
  let best = -1
  for (let i = 0; i < s.n; i++) {
    if (i === seat) continue
    if (best < 0 || s.hands[i].length < s.hands[best].length || (s.hands[i].length === s.hands[best].length && s.scores[i] > s.scores[best])) best = i
  }
  return best
}

const swapTarget = (s, seat) => leaderOf(s, seat)

// How much this seat wants to play this card now
const worth = (s, seat, card, persona) => {
  const hand = s.hands[seat]
  const rest = hand.filter((c) => c.id !== card.id)
  const next = nextSeat(s, seat)
  const prev = nextSeat(s, seat, -1)
  const leader = leaderOf(s, seat)
  const danger = s.hands[next].length <= 2 || next === leader
  let v = points(card)
  if (isWild(card)) {
    // hold wilds: worth more in the hand than on the pile, unless it gets you out (or
    // someone's about to go out and it would cost 50 points)
    v = persona === "careful" ? -40 : -20
    if (rest.length <= 1) v += 120
    else if (s.hands.some((h, i) => i !== seat && h.length <= 1)) v += 45
    // a bluffed Draw Four (you have the color): only the sly ones try it
    if (card.v === "wd4" && s.settings.challenge && rest.some((c) => c.c === s.color)) v -= persona === "sly" ? 5 : 400
  } else {
    v += 4 * rest.filter((c) => c.c === card.c).length
    if (card.c !== s.color) v += 3 * rest.filter((c) => c.c === card.c).length // a switch to my best color
  }
  const hits = card.v === "skip" || card.v === "skipall" || DRAWS[card.v] || (card.v === "rev" && s.n === 2)
  if (hits && danger) v += persona === "bold" ? 70 : 45
  if (hits && !danger && persona === "careful") v -= 12 // save it for when it matters
  if (card.v === "rev" && s.n > 2) v += s.hands[next].length <= 2 && s.hands[prev].length > s.hands[next].length ? 40 : 0
  if (card.v === "discall") v += 14 * rest.filter((c) => c.c === card.c).length
  if (s.settings.sevenO && card.v === "7" && rest.length) {
    const t = swapTarget(s, seat)
    v += s.hands[t].length < rest.length ? 30 + (rest.length - s.hands[t].length) * 10 : -40
  }
  if (s.settings.sevenO && card.v === "0" && rest.length) {
    // every hand moves one seat along: I get the hand from the seat before me
    const from = nextSeat(s, seat, -1)
    v += s.hands[from].length < rest.length ? 25 + (rest.length - s.hands[from].length) * 8 : -25
  }
  return v
}

// The move to make with this card
const playOf = (s, seat, card, lv) => {
  const hand = s.hands[seat]
  const rest = hand.filter((c) => c.id !== card.id)
  const move = { type: "play", card: card.id }
  if (isWild(card)) move.color = bestColor(rest, () => roll(s.seq, seat, 5))
  if (s.settings.sevenO && card.v === "7" && rest.length) move.target = swapTarget(s, seat)
  if (rest.length === 1 && roll(s.seq, seat, 3) >= lv.forget) move.call = true
  return move
}

export const botAction = (s, seat, { now = Date.now() } = {}) => {
  if (!s || s.over || s.phase !== "play" || !s.hands[seat]) return null
  const lv = levelOf(s)
  const persona = s.personas?.[seat] || "chill"
  const hand = s.hands[seat]

  // forgot to call: remember (a little late)
  if (s.vuln && s.vuln.seat === seat) return { type: "call" }
  // somebody forgot to call: catch them
  if (s.vuln && s.vuln.seat !== seat && now <= s.vuln.until && roll(s.vuln.seq, seat, 1) < lv.catch) return { type: "catch" }

  if (seat !== s.turn) {
    const jumps = legalPlays(s, seat)
    if (!jumps.length) return null
    const chance = lv.jump + (persona === "bold" ? 0.2 : persona === "careful" ? -0.2 : 0)
    if (roll(s.seq, seat, 2) >= chance) return null
    return playOf(s, seat, hand.find((c) => c.id === jumps[0]), lv)
  }

  // a Draw Four on me: challenge it?
  if (s.stack > 0 && s.wd4) {
    const by = s.hands[s.wd4.by]?.length || 0
    let p = 0.12 + Math.min(0.4, by * 0.04)
    if (persona === "sly") p += 0.25
    if (persona === "careful") p -= 0.1
    if (s.settings.bots === "easy") p = 0.15
    if (roll(s.seq, seat, 4) < p) return { type: "challenge" }
  }

  const plays = legalPlays(s, seat)
  if (s.stack > 0) {
    if (!plays.length) return { type: "draw" }
    const stackers = hand.filter((c) => plays.includes(c.id)).sort((a, b) => (DRAWS[a.v] || 0) - (DRAWS[b.v] || 0))
    const keen = persona !== "careful" || hand.length <= 3 || s.stack >= 4
    return keen ? playOf(s, seat, stackers[0], lv) : { type: "draw" }
  }

  if (s.drawn != null) {
    const card = hand.find((c) => c.id === s.drawn)
    if (!card) return { type: "pass" }
    if (s.mustPlay) return playOf(s, seat, card, lv)
    const keep = isWild(card) && persona === "careful" && hand.length > 4
    return keep ? { type: "pass" } : playOf(s, seat, card, lv)
  }

  if (!plays.length) return { type: "draw" }
  const options = hand.filter((c) => plays.includes(c.id))
  // easy players often just play the first card that fits
  if (lv.mistake && roll(s.seq, seat, 6) < lv.mistake) {
    const plain = options.filter((c) => !(c.v === "wd4" && s.settings.challenge && hand.some((h) => h.c === s.color)))
    const pick = plain.length ? plain : options
    return playOf(s, seat, pick[Math.floor(roll(s.seq, seat, 7) * pick.length)], lv)
  }
  let best = null
  options.forEach((card, i) => {
    const v = worth(s, seat, card, persona) + roll(s.seq, seat, 10 + i) * lv.noise
    if (!best || v > best.v) best = { card, v }
  })
  // only a hopeless bluff left: drawing is better
  if (best.v < -200) return { type: "draw" }
  return playOf(s, seat, best.card, lv)
}

// How long a computer player takes over this move (ms). now: the clock, so catches and late
// calls happen a set time after the slip, whatever else goes on meanwhile.
export const botDelay = (s, seat, action, { now = Date.now() } = {}) => {
  const lv = levelOf(s)
  const r = roll(s.seq, seat, 9)
  const quick = s.n > 6 ? 0.75 : 1
  if (action?.type === "catch" && s.vuln) return Math.max(60, s.vuln.until - CATCH_MS + lv.catchMs + r * 300 - now)
  if (action?.type === "call" && s.vuln) return Math.max(60, s.vuln.until - CATCH_MS + 1100 + r * 1300 - now)
  if (action?.type === "play" && seat !== s.turn) return 450 + r * 450
  if (action?.type === "challenge") return 1300 + r * 600
  return Math.round((800 + r * 700) * quick)
}

