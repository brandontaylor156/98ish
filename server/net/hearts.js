// Hearts for four players. Pure functions on a plain state object (the table manager in
// games.js adds the timing). Cards are strings: rank + suit, e.g. "QS", "TH", "2C".
//
// Rules: pass three cards left, right, across, then hold (repeat). The 2 of clubs leads
// the first trick. Follow suit if you can. No hearts or queen of spades on the first trick
// unless you have nothing else. Hearts can't be led until a heart has been played (or you
// hold only hearts). Each heart is 1 point, the queen of spades 13. Take all 26 and you
// "shoot the moon": everyone else gets 26 instead. The game ends when someone reaches 100
// at the end of a hand; lowest score wins.

const SUITS = ["C", "D", "S", "H"]
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]
const PASSES = ["left", "right", "across", "none"]
const GAME_TO = 100

const suitOf = (card) => card[1]
const rankOf = (card) => RANKS.indexOf(card[0])
const isCard = (card) => typeof card === "string" && card.length === 2 && RANKS.includes(card[0]) && SUITS.includes(card[1])
const pointsOf = (card) => (suitOf(card) === "H" ? 1 : card === "QS" ? 13 : 0)

const deck = () => SUITS.flatMap((s) => RANKS.map((r) => r + s))

// Clubs, diamonds, spades, hearts; low to high within a suit
const sortHand = (hand) => hand.slice().sort((a, b) => SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) || rankOf(a) - rankOf(b))

const shuffle = (cards, random = Math.random) => {
  const out = cards.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Who receives seat's cards. Seats go clockwise 0 -> 1 -> 2 -> 3 (1 is on 0's left).
const passTarget = (seat, direction) =>
  direction === "left" ? (seat + 1) % 4 : direction === "right" ? (seat + 3) % 4 : direction === "across" ? (seat + 2) % 4 : seat

const newGame = () => ({
  hand: 0, // hands played so far
  scores: [0, 0, 0, 0],
  history: [], // points per hand: [[a, b, c, d], ...]
  phase: "dealing", // passing | playing | trickEnd | handOver | gameOver
})

const deal = (state, random = Math.random) => {
  const cards = shuffle(deck(), random)
  const hands = [0, 1, 2, 3].map((s) => sortHand(cards.slice(s * 13, s * 13 + 13)))
  const direction = PASSES[state.hand % 4]
  const next = {
    ...state,
    hands,
    direction,
    passes: [null, null, null, null],
    received: [[], [], [], []],
    trick: [], // [{ seat, card }]
    leader: null,
    turn: null,
    taken: [[], [], [], []],
    tricks: 0,
    heartsBroken: false,
    lastTrick: null,
    handPoints: null,
    moon: null,
    winners: null,
    phase: "passing",
  }
  return direction === "none" ? startPlay(next) : next
}

const startPlay = (state) => {
  const leader = state.hands.findIndex((h) => h.includes("2C"))
  return { ...state, phase: "playing", leader, turn: leader }
}

// Choose three cards to pass. When all four have chosen, the cards change hands.
const setPass = (state, seat, cards) => {
  if (state.phase !== "passing") return { ok: false, error: "It isn't time to pass." }
  if (!Array.isArray(cards) || cards.length !== 3 || new Set(cards).size !== 3) return { ok: false, error: "Pick three cards to pass." }
  if (!cards.every((c) => isCard(c) && state.hands[seat].includes(c))) return { ok: false, error: "You don't have those cards." }
  if (state.passes[seat]) return { ok: false, error: "You already passed." }
  const passes = state.passes.slice()
  passes[seat] = cards.slice()
  let next = { ...state, passes }
  if (passes.every(Boolean)) {
    const hands = state.hands.map((hand, s) => hand.filter((c) => !passes[s].includes(c)))
    const received = [[], [], [], []]
    passes.forEach((given, s) => {
      const to = passTarget(s, state.direction)
      hands[to].push(...given)
      received[to] = given.slice()
    })
    next = startPlay({ ...next, hands: hands.map(sortHand), received })
  }
  return { ok: true, state: next }
}

const legalPlays = (state, seat) => {
  if (state.phase !== "playing" || state.turn !== seat) return []
  const hand = state.hands[seat]
  const firstTrick = state.tricks === 0
  if (state.trick.length === 0) {
    if (firstTrick) return hand.includes("2C") ? ["2C"] : []
    if (state.heartsBroken) return hand.slice()
    const nonHearts = hand.filter((c) => suitOf(c) !== "H")
    return nonHearts.length ? nonHearts : hand.slice()
  }
  const led = suitOf(state.trick[0].card)
  const follow = hand.filter((c) => suitOf(c) === led)
  if (follow.length) return follow
  if (firstTrick) {
    const safe = hand.filter((c) => pointsOf(c) === 0)
    if (safe.length) return safe
    // Only point cards: hearts before the queen if possible
    const hearts = hand.filter((c) => suitOf(c) === "H")
    return hearts.length ? hearts : hand.slice()
  }
  return hand.slice()
}

const trickWinner = (trick) => {
  const led = suitOf(trick[0].card)
  let best = trick[0]
  for (const play of trick) if (suitOf(play.card) === led && rankOf(play.card) > rankOf(best.card)) best = play
  return best.seat
}

const play = (state, seat, card) => {
  if (state.phase !== "playing") return { ok: false, error: "It isn't time to play." }
  if (state.turn !== seat) return { ok: false, error: "It isn't your turn." }
  if (!legalPlays(state, seat).includes(card)) return { ok: false, error: "You can't play that card now." }
  const hands = state.hands.slice()
  hands[seat] = hands[seat].filter((c) => c !== card)
  const trick = [...state.trick, { seat, card }]
  const heartsBroken = state.heartsBroken || suitOf(card) === "H"
  if (trick.length < 4) return { ok: true, state: { ...state, hands, trick, heartsBroken, turn: (seat + 1) % 4 } }
  return { ok: true, state: { ...state, hands, trick, heartsBroken, turn: null, phase: "trickEnd", winner: trickWinner(trick) } }
}

// After a full trick has been shown: the winner takes it and leads the next one
const collectTrick = (state) => {
  if (state.phase !== "trickEnd") return state
  const winner = trickWinner(state.trick)
  const taken = state.taken.slice()
  taken[winner] = [...taken[winner], ...state.trick.map((p) => p.card)]
  const tricks = state.tricks + 1
  const next = { ...state, taken, tricks, trick: [], lastTrick: { cards: state.trick, winner }, leader: winner, turn: winner, phase: "playing", winner: undefined }
  return tricks === 13 ? scoreHand(next) : next
}

const scoreHand = (state) => {
  let handPoints = state.taken.map((cards) => cards.reduce((sum, c) => sum + pointsOf(c), 0))
  const shooter = handPoints.indexOf(26)
  const moon = shooter >= 0 ? shooter : null
  if (moon !== null) handPoints = handPoints.map((_, s) => (s === moon ? 0 : 26))
  const scores = state.scores.map((s, i) => s + handPoints[i])
  const over = Math.max(...scores) >= GAME_TO
  const low = Math.min(...scores)
  return {
    ...state,
    scores,
    handPoints,
    moon,
    history: [...state.history, handPoints],
    hand: state.hand + 1,
    turn: null,
    phase: over ? "gameOver" : "handOver",
    winners: over ? scores.map((s, i) => (s === low ? i : -1)).filter((i) => i >= 0) : null,
  }
}

// ---------- computer players ----------

// Pass the queen and high spades (unless well guarded), high hearts, then try to empty a
// short suit of its high cards.
const botPass = (hand) => {
  const spades = hand.filter((c) => suitOf(c) === "S")
  const lowSpades = spades.filter((c) => rankOf(c) < rankOf("QS")).length
  const danger = (card) => {
    const s = suitOf(card)
    const r = rankOf(card)
    if (card === "QS") return lowSpades >= 4 ? 5 : 100
    if (s === "S" && r > rankOf("QS")) return lowSpades >= 4 && !hand.includes("QS") ? 3 : 90 + r
    if (s === "H") return 20 + r * 3
    const suitLen = hand.filter((c) => suitOf(c) === s).length
    return r * 2 + (suitLen <= 3 ? 12 : 0)
  }
  return hand
    .slice()
    .sort((a, b) => danger(b) - danger(a))
    .slice(0, 3)
}

const highest = (cards) => cards.reduce((a, b) => (rankOf(b) > rankOf(a) ? b : a))
const lowest = (cards) => cards.reduce((a, b) => (rankOf(b) < rankOf(a) ? b : a))

const botPlay = (state, seat) => {
  const legal = legalPlays(state, seat)
  if (legal.length <= 1) return legal[0]
  const hand = state.hands[seat]
  const played = new Set([...state.taken.flat(), ...state.trick.map((p) => p.card)])
  const queenOut = played.has("QS")

  // Leading: lowest card, preferring suits that keep us safe. Flush out the queen with
  // low spades when we don't hold her or anything above her.
  if (state.trick.length === 0) {
    const holdsHighSpade = hand.some((c) => suitOf(c) === "S" && rankOf(c) >= rankOf("QS"))
    if (!queenOut && !holdsHighSpade) {
      const lowSpade = legal.filter((c) => suitOf(c) === "S")
      if (lowSpade.length) return lowest(lowSpade)
    }
    const safe = legal.filter((c) => suitOf(c) !== "H" && !(suitOf(c) === "S" && rankOf(c) >= rankOf("QS") && !queenOut))
    return lowest(safe.length ? safe : legal)
  }

  const led = suitOf(state.trick[0].card)
  const following = suitOf(legal[0]) === led && legal.every((c) => suitOf(c) === led)
  const winning = state.trick.filter((p) => suitOf(p.card) === led).reduce((a, b) => (rankOf(b.card) > rankOf(a.card) ? b : a)).card
  const trickPoints = state.trick.reduce((sum, p) => sum + pointsOf(p.card), 0)
  const lastToPlay = state.trick.length === 3

  if (following) {
    // Dump the queen on someone else's higher spade
    if (led === "S" && legal.includes("QS") && rankOf(winning) > rankOf("QS")) return "QS"
    const under = legal.filter((c) => rankOf(c) < rankOf(winning) && c !== "QS")
    if (under.length) return highest(under)
    // We'll win it anyway: last to play with no points, take it with the biggest card
    const notQueen = legal.filter((c) => c !== "QS")
    const pool = notQueen.length ? notQueen : legal
    if (lastToPlay && trickPoints === 0) return highest(pool)
    // Spades with the queen still out: don't go over her with the ace or king
    if (led === "S" && !queenOut) {
      const belowQueen = pool.filter((c) => rankOf(c) < rankOf("QS"))
      if (belowQueen.length) return highest(belowQueen)
    }
    return lastToPlay ? highest(pool) : lowest(pool)
  }

  // Can't follow: get rid of trouble
  if (legal.includes("QS")) return "QS"
  if (!queenOut) {
    const bigSpades = legal.filter((c) => c === "AS" || c === "KS")
    if (bigSpades.length) return highest(bigSpades)
  }
  const hearts = legal.filter((c) => suitOf(c) === "H")
  if (hearts.length) return highest(hearts)
  // The highest card of our shortest suit
  const bySuit = (c) => legal.filter((x) => suitOf(x) === suitOf(c)).length
  return legal.slice().sort((a, b) => bySuit(a) - bySuit(b) || rankOf(b) - rankOf(a))[0]
}

module.exports = {
  SUITS,
  RANKS,
  PASSES,
  GAME_TO,
  deck,
  sortHand,
  shuffle,
  passTarget,
  pointsOf,
  suitOf,
  rankOf,
  isCard,
  newGame,
  deal,
  setPass,
  legalPlays,
  play,
  collectTrick,
  scoreHand,
  trickWinner,
  botPass,
  botPlay,
}
