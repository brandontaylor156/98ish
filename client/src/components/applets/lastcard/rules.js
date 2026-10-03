// Last Card's rules, in the shape the online room system wants (server/arcade/rooms.js):
// create / action / view / isOver / bot. The server runs them for online games
// (server/arcade/games/lastcard.js) and local.js runs them in the browser for games against
// the computer, so both play by exactly the same rules.
//
// Match the top card's color or its number/symbol, or play a wild. Skip, Reverse (with two
// players it works like a Skip), Draw Two and Wild Draw Four do what they say. Down to one
// card: call "Last Card!" (send call: true with the play, or "call" right after) before
// someone catches you (2 cards). First to empty their hand wins the round and scores the
// points left in everyone else's hands. House rules (cards.js DEFAULTS) switch on stacking,
// 7-0, jump-in, draw until you can play, forced play, challenges and extra cards.
//
// Actions (seat = the player; null = the server's timers):
//   { type: "play", card: id, color?: "r"|"y"|"g"|"b" (wilds), target?: seat (a 7 under 7-0), call?: true }
//   { type: "draw" }        draw (or take the pending Draw Two/Four stack)
//   { type: "pass" }        keep the card you just drew
//   { type: "challenge" }   challenge the Wild Draw Four played on you
//   { type: "call" }        "Last Card!" right after playing down to one
//   { type: "catch" }       catch someone who didn't call in time
//   { type: "emote", id }   a quick reaction (cards.js EMOTES)
//   { type: "ready" }       ready for the next round
//   server: { type: "timeout", turnId }, { type: "vulnEnd", seq }, { type: "nextRound", round }
//
// Hidden information: view(state, seat) shows your hand and only the number of cards in
// everyone else's, never the draw pile, and never whether a Wild Draw Four was a bluff.

import { CATCH_MS, COLORS, DEFAULTS, DRAWS, EMOTES, buildDeck, decksFor, handPoints, isWild, personaFor, shuffle, validateSettings } from "./cards.js"
import { botAction, botDelay } from "./bot.js"

const MAX_EVENTS = 40
export const ROUND_PAUSE = 9000

const clone = (v) => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)))
const mod = (a, n) => ((a % n) + n) % n
const refuse = (error) => ({ error })

export const topOf = (s) => s.discard[s.discard.length - 1]
export const nextSeat = (s, from = s.turn, steps = 1) => mod(from + s.dir * steps, s.n)

// Can this card go on the pile? (a wild always can)
export const canPlayOn = (card, top, color) => isWild(card) || card.c === color || (!isWild(top) && card.v === top.v)

// Under stacking: a Draw Two takes a Draw Two; a Wild Draw Four takes either; a Draw Six anything
export const canStack = (card, stackTop) => {
  if (stackTop === "d2") return card.v === "d2" || card.v === "wd4" || card.v === "wd6"
  if (stackTop === "wd4") return card.v === "wd4" || card.v === "wd6"
  if (stackTop === "wd6") return card.v === "wd6"
  return false
}

// The same card exactly (jump-in): same color and same number or symbol, not a wild
export const identical = (card, top) => !isWild(card) && !isWild(top) && card.c === top.c && card.v === top.v

// The cards this seat may play right now (ids)
export const legalPlays = (s, seat) => {
  if (s.phase !== "play" || seat == null || !s.hands[seat]) return []
  const hand = s.hands[seat]
  const top = topOf(s)
  if (seat === s.turn) {
    if (s.drawn != null) return hand.some((c) => c.id === s.drawn) ? [s.drawn] : []
    if (s.stack > 0) return s.settings.stacking ? hand.filter((c) => canStack(c, s.stackTop)).map((c) => c.id) : []
    return hand.filter((c) => canPlayOn(c, top, s.color)).map((c) => c.id)
  }
  if (!s.settings.jumpIn || s.stack > 0 || s.wd4) return []
  return hand.filter((c) => identical(c, top)).map((c) => c.id)
}

// ---------- bookkeeping ----------

const event = (s, ctx, e) => {
  s.seq++
  s.events.push({ ...e, seq: s.seq, at: ctx.now })
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS)
}

// A fresh turn for s.turn: the clock starts again
const startTurn = (s, ctx) => {
  s.turnId++
  s.drawn = null
  s.mustPlay = false
  const ms = s.settings.timer * 1000
  s.turnEnds = ms ? ctx.now + ms : null
  if (ms) ctx.after(ms, { type: "timeout", turnId: s.turnId }, "turn")
}

const advance = (s, ctx, steps = 1) => {
  s.turn = nextSeat(s, s.turn, steps)
  startTurn(s, ctx)
}

// Cards off the draw pile; when it runs out, the discards (all but the top) are shuffled in
const drawCards = (s, ctx, count) => {
  const got = []
  while (got.length < count) {
    if (!s.deck.length) {
      if (s.discard.length <= 1) break
      const top = s.discard.pop()
      s.deck = shuffle(s.discard, ctx.random)
      s.discard = [top]
      event(s, ctx, { t: "shuffle", n: s.deck.length })
    }
    got.push(s.deck.pop())
  }
  return got
}

// After a hand grows: no longer on one card
const handChanged = (s, ctx, seat) => {
  if (s.hands[seat].length !== 1) s.called[seat] = false
  if (s.vuln && s.vuln.seat === seat && s.hands[seat].length !== 1) {
    s.vuln = null
    ctx.cancel("vuln")
  }
}

const give = (s, ctx, seat, count, e = {}) => {
  const got = drawCards(s, ctx, count)
  s.hands[seat].push(...got)
  handChanged(s, ctx, seat)
  event(s, ctx, { t: "draw", seat, n: got.length, ids: got.map((c) => c.id), ...e })
  return got
}

// A computer player says something now and then (a bot's line, never a person's)
const botSays = (s, ctx, seat, id, chance = 0.35) => {
  if (!ctx.players?.[seat]?.bot && !s.bots[seat]) return
  if (ctx.random() >= chance) return
  if (ctx.now - (s.lastEmote[seat] || 0) < 2500) return
  s.lastEmote[seat] = ctx.now
  event(s, ctx, { t: "emote", seat, id })
}

// The player on turn takes the pending Draw Two/Four stack and loses the turn
const takeStack = (s, ctx) => {
  const seat = s.turn
  const total = s.stack
  s.stack = 0
  s.stackTop = null
  s.wd4 = null
  give(s, ctx, seat, total, { take: true })
  botSays(s, ctx, seat, total >= 6 ? "nooo" : "ouch")
  advance(s, ctx, 1)
}

// ---------- rounds ----------

const startRound = (s, ctx) => {
  s.round++
  s.phase = "play"
  const players = s.n
  const decks = decksFor(players, s.settings.handSize, s.settings.decks)
  const cards = shuffle(buildDeck({ decks, extras: s.settings.extras }), ctx.random)
  const ids = shuffle(cards.map((_, i) => i + 1), ctx.random)
  s.deck = cards.map((c, i) => ({ id: ids[i], ...c }))
  s.discard = []
  s.hands = Array.from({ length: players }, () => [])
  s.dealer = s.round === 1 ? s.dealer : mod(s.dealer + 1, players)
  for (let k = 0; k < s.settings.handSize; k++) for (let i = 1; i <= players; i++) s.hands[mod(s.dealer + i, players)].push(s.deck.pop())
  // the first card up is a number (anything else goes back in)
  for (;;) {
    const card = s.deck.pop()
    if (/^\d$/.test(card.v)) {
      s.discard.push(card)
      break
    }
    s.deck.unshift(card)
  }
  s.color = topOf(s).c
  s.dir = 1
  s.turn = mod(s.dealer + 1, players)
  s.stack = 0
  s.stackTop = null
  s.wd4 = null
  s.called = Array(players).fill(false)
  s.vuln = null
  s.roundResult = null
  s.nextAt = null
  s.ready = []
  event(s, ctx, { t: "deal", round: s.round, dealer: s.dealer, n: s.settings.handSize, top: topOf(s) })
  startTurn(s, ctx)
  return s
}

const endRound = (s, ctx, winner) => {
  const hands = s.hands.map((h) => [...h])
  const gained = hands.reduce((sum, h, i) => (i === winner ? sum : sum + handPoints(h)), 0)
  s.scores[winner] += gained
  s.phase = "roundover"
  s.vuln = null
  s.stack = 0
  s.stackTop = null
  s.wd4 = null
  s.drawn = null
  s.turnEnds = null
  ctx.cancel("turn")
  ctx.cancel("vuln")
  s.roundResult = { winner, points: gained, hands, round: s.round }
  event(s, ctx, { t: "out", seat: winner, points: gained })
  const target = s.settings.target
  if (!target || s.scores[winner] >= target) {
    s.over = { winners: [winner], reason: target ? "points" : "out", scores: [...s.scores] }
    return s
  }
  s.nextAt = ctx.now + ROUND_PAUSE
  s.ready = []
  ctx.after(ROUND_PAUSE, { type: "nextRound", round: s.round }, "round")
  return s
}

// ---------- playing a card ----------

const playCard = (s, ctx, seat, card, action, jump) => {
  const hand = s.hands[seat]
  const before = s.color
  const bluff = card.v === "wd4" && hand.some((c) => c.id !== card.id && c.c === before)
  if (s.settings.sevenO && card.v === "7" && hand.length > 1) {
    const target = Number(action.target)
    if (!Number.isInteger(target) || target === seat || target < 0 || target >= s.n) return refuse("Pick someone to swap hands with.")
  }
  if (isWild(card) && !COLORS.includes(action.color)) return refuse("Pick a color for your wild card.")

  s.hands[seat] = hand.filter((c) => c.id !== card.id)
  s.discard.push(card)
  s.color = isWild(card) ? action.color : card.c
  s.turn = seat
  s.drawn = null
  s.mustPlay = false
  s.wd4 = null
  if (s.vuln && s.vuln.seat === seat) {
    s.vuln = null
    ctx.cancel("vuln")
  }
  event(s, ctx, { t: "play", seat, card, color: s.color, jump: !!jump })

  // Discard All: every other card of that color goes too
  if (card.v === "discall") {
    const same = s.hands[seat].filter((c) => c.c === card.c)
    if (same.length) {
      s.hands[seat] = s.hands[seat].filter((c) => c.c !== card.c)
      s.discard.splice(s.discard.length - 1, 0, ...same)
      event(s, ctx, { t: "discall", seat, cards: same })
    }
  }

  const left = s.hands[seat].length
  // out: the round is over (a draw card still makes the next player draw)
  if (left === 0) {
    if (DRAWS[card.v]) {
      const victim = nextSeat(s, seat)
      give(s, ctx, victim, s.stack + DRAWS[card.v], { take: true })
      s.stack = 0
    }
    return endRound(s, ctx, seat)
  }
  if (left === 1) {
    if (action.call) {
      s.called[seat] = true
      event(s, ctx, { t: "call", seat })
    } else {
      s.called[seat] = false
      s.vuln = { seat, until: ctx.now + CATCH_MS, seq: s.seq }
      ctx.after(CATCH_MS, { type: "vulnEnd", seq: s.seq }, "vuln")
    }
  } else s.called[seat] = false

  // 7-0: swap with someone, or pass every hand along
  if (s.settings.sevenO && (card.v === "7" || card.v === "0")) {
    if (card.v === "7") {
      const target = Number(action.target)
      ;[s.hands[seat], s.hands[target]] = [s.hands[target], s.hands[seat]]
      event(s, ctx, { t: "swap", seat, target })
    } else {
      const hands = s.hands
      s.hands = hands.map((_, i) => hands[nextSeat(s, i, -1)])
      event(s, ctx, { t: "rotate", seat, dir: s.dir })
    }
    // whoever ends up with one card counts as having called
    s.called = s.hands.map((h) => h.length === 1)
    if (s.vuln) {
      s.vuln = null
      ctx.cancel("vuln")
    }
  }

  switch (card.v) {
    case "skip":
      event(s, ctx, { t: "skip", seat: nextSeat(s, seat) })
      advance(s, ctx, 2)
      break
    case "skipall":
      event(s, ctx, { t: "skipall", seat })
      startTurn(s, ctx)
      break
    case "rev":
      s.dir = -s.dir
      event(s, ctx, { t: "rev", seat, dir: s.dir })
      // with two players a Reverse is a Skip: you go again
      if (s.n === 2) {
        event(s, ctx, { t: "skip", seat: nextSeat(s, seat) })
        advance(s, ctx, 2)
      } else advance(s, ctx, 1)
      break
    case "d2":
    case "wd4":
    case "wd6": {
      s.stack += DRAWS[card.v]
      s.stackTop = card.v
      if (card.v === "wd4" && s.settings.challenge && s.stack === 4) s.wd4 = { by: seat, color: before, bluff }
      advance(s, ctx, 1)
      if (!s.settings.stacking && !s.wd4) takeStack(s, ctx)
      else event(s, ctx, { t: "stack", seat: s.turn, total: s.stack })
      if (card.v !== "d2") botSays(s, ctx, seat, "gotcha", 0.25)
      break
    }
    default:
      advance(s, ctx, 1)
  }
  return s
}

// The best color for a hand (most cards, then most points): timeouts and computer players
export const bestColor = (hand, random = Math.random) => {
  const score = { r: 0, y: 0, g: 0, b: 0 }
  for (const c of hand) if (c.c !== "w") score[c.c] += 10 + (/^\d$/.test(c.v) ? Number(c.v) / 10 : 2)
  const best = COLORS.reduce((a, b) => (score[b] > score[a] ? b : a), COLORS[0])
  return score[best] > 0 ? best : COLORS[Math.floor(random() * 4)]
}

// Out of time (or for a player who isn't there): draw, or play the card that must be played
const autoMove = (s, ctx) => {
  const seat = s.turn
  event(s, ctx, { t: "timeout", seat })
  if (s.stack > 0) {
    takeStack(s, ctx)
    return s
  }
  if (s.drawn == null) {
    const drew = drawFor(s, ctx, seat)
    if (drew === "advanced") return s
  }
  const card = s.hands[seat].find((c) => c.id === s.drawn)
  if (card && s.mustPlay) {
    const fewest = s.hands.map((h, i) => [h.length, i]).filter(([, i]) => i !== seat).sort((a, b) => a[0] - b[0])[0][1]
    return playCard(s, ctx, seat, card, { color: bestColor(s.hands[seat].filter((c) => c.id !== card.id), ctx.random), target: fewest }, false)
  }
  advance(s, ctx, 1)
  return s
}

// A normal draw on your turn: one card (or until one fits). A card that fits waits for you
// to play it (or pass); otherwise the turn moves on.
const drawFor = (s, ctx, seat) => {
  const top = topOf(s)
  const got = []
  for (;;) {
    const [card] = drawCards(s, ctx, 1)
    if (!card) break
    got.push(card)
    if (!s.settings.drawUntil || canPlayOn(card, top, s.color)) break
  }
  s.hands[seat].push(...got)
  handChanged(s, ctx, seat)
  event(s, ctx, { t: "draw", seat, n: got.length, ids: got.map((c) => c.id) })
  const last = got[got.length - 1]
  if (last && canPlayOn(last, top, s.color)) {
    s.drawn = last.id
    s.mustPlay = s.settings.forcePlay
    return "kept"
  }
  advance(s, ctx, 1)
  return "advanced"
}

// ---------- the rules module ----------

export const create = ({ players, settings, random = Math.random, now = Date.now(), after = () => {} }) => {
  const clean = validateSettings(settings)
  if (clean.error) throw new Error(clean.error)
  const n = players.length
  const s = {
    v: 1,
    settings: clean,
    n,
    names: players.map((p, i) => p.name || `Player ${i + 1}`),
    bots: players.map((p) => !!p.bot),
    personas: players.map((p) => personaFor(p.name)),
    scores: Array(n).fill(0),
    round: 0,
    dealer: Math.floor(random() * n),
    turn: 0,
    turnId: 0,
    turnEnds: null,
    dir: 1,
    seq: 0,
    events: [],
    lastEmote: Array(n).fill(0),
    over: null,
  }
  const ctx = { now, random, after, cancel: () => {}, players }
  return startRound(s, ctx)
}

export const action = (state, seat, a, ctx) => {
  if (!a || typeof a !== "object") return refuse("That isn't a move.")
  const type = a.type
  const ctxFull = { now: Date.now(), random: Math.random, after: () => {}, cancel: () => {}, players: [], ...ctx }

  // ---- the server's own timers ----
  if (seat == null) {
    if (type === "timeout") {
      if (state.phase !== "play" || state.turnId !== a.turnId) return state
      return autoMove(clone(state), ctxFull)
    }
    if (type === "vulnEnd") {
      if (!state.vuln || state.vuln.seq !== a.seq) return state
      const s = clone(state)
      s.vuln = null
      return s
    }
    if (type === "nextRound") {
      if (state.phase !== "roundover" || state.round !== a.round || state.over) return state
      return startRound(clone(state), ctxFull)
    }
    return state
  }

  if (!Number.isInteger(seat) || seat < 0 || seat >= state.n) return refuse("You aren't playing.")
  if (state.over) return refuse("The game is over.")

  if (type === "emote") {
    if (!Object.hasOwn(EMOTES, a.id)) return refuse("That isn't a reaction.")
    if (ctxFull.now - (state.lastEmote[seat] || 0) < 1200) return state
    const s = clone(state)
    s.lastEmote[seat] = ctxFull.now
    event(s, ctxFull, { t: "emote", seat, id: a.id })
    return s
  }

  if (type === "ready") {
    if (state.phase !== "roundover" || state.ready.includes(seat)) return state
    const s = clone(state)
    s.ready.push(seat)
    const people = s.hands.map((_, i) => i).filter((i) => !(ctxFull.players[i]?.bot ?? s.bots[i]))
    if (people.every((i) => s.ready.includes(i))) {
      ctxFull.cancel("round")
      return startRound(s, ctxFull)
    }
    return s
  }

  if (state.phase !== "play") return refuse("The next round is about to start.")

  if (type === "call") {
    if (state.vuln?.seat !== seat) return state.called[seat] ? state : refuse("Call Last Card when you're down to one card.")
    const s = clone(state)
    s.called[seat] = true
    s.vuln = null
    ctxFull.cancel("vuln")
    event(s, ctxFull, { t: "call", seat, late: true })
    return s
  }

  if (type === "catch") {
    const v = state.vuln
    if (!v || v.seat === seat) return refuse("There's nobody to catch.")
    if (ctxFull.now > v.until) return refuse("Too late!")
    const s = clone(state)
    s.vuln = null
    ctxFull.cancel("vuln")
    event(s, ctxFull, { t: "catch", seat: v.seat, by: seat })
    give(s, ctxFull, v.seat, 2, { penalty: true })
    botSays(s, ctxFull, v.seat, "oops", 0.5)
    return s
  }

  if (type === "play") {
    const card = state.hands[seat].find((c) => c.id === a.card)
    if (!card) return refuse("That card isn't in your hand.")
    const legal = legalPlays(state, seat)
    if (!legal.includes(card.id)) {
      if (seat !== state.turn) return refuse(state.settings.jumpIn ? "Only the very same card can jump in." : "It's not your turn.")
      if (state.drawn != null) return refuse("You can only play the card you just drew.")
      if (state.stack > 0) return refuse(state.settings.stacking ? "Stack a draw card or take the cards." : "Take the cards first.")
      return refuse("That card doesn't match.")
    }
    const jump = seat !== state.turn
    const s = clone(state)
    if (jump) event(s, ctxFull, { t: "jump", seat, from: s.turn })
    return playCard(s, ctxFull, seat, s.hands[seat].find((c) => c.id === card.id), a, jump)
  }

  if (seat !== state.turn) return refuse("It's not your turn.")

  if (type === "draw") {
    if (state.drawn != null) return refuse(state.mustPlay ? "You have to play the card you drew." : "You already drew. Play it or keep it.")
    const s = clone(state)
    if (s.stack > 0) {
      takeStack(s, ctxFull)
      return s
    }
    drawFor(s, ctxFull, seat)
    return s
  }

  if (type === "pass") {
    if (state.drawn == null) return refuse("Draw a card first.")
    if (state.mustPlay) return refuse("You have to play the card you drew.")
    const s = clone(state)
    event(s, ctxFull, { t: "pass", seat })
    advance(s, ctxFull, 1)
    return s
  }

  if (type === "challenge") {
    if (!state.wd4) return refuse("There's nothing to challenge.")
    const s = clone(state)
    const { by, bluff } = s.wd4
    s.wd4 = null
    s.stack = 0
    s.stackTop = null
    event(s, ctxFull, { t: "challenge", seat, by, won: bluff })
    if (bluff) {
      // caught bluffing: the player who played it draws the four; you play on
      give(s, ctxFull, by, 4, { penalty: true })
      botSays(s, ctxFull, by, "oops", 0.5)
      startTurn(s, ctxFull)
    } else {
      give(s, ctxFull, seat, 6, { take: true })
      botSays(s, ctxFull, seat, "nooo", 0.4)
      advance(s, ctxFull, 1)
    }
    return s
  }

  return refuse("That isn't a move.")
}

// What one seat may see (null = a spectator): your own hand, everyone's card counts
export const view = (s, seat) => {
  const me = Number.isInteger(seat) && seat >= 0 && seat < s.n ? seat : null
  const mine = me !== null && s.turn === me && s.phase === "play"
  return {
    n: s.n,
    you: me,
    names: s.names,
    bots: s.bots,
    personas: s.personas,
    settings: s.settings,
    phase: s.over ? "over" : s.phase,
    round: s.round,
    scores: s.scores,
    target: s.settings.target,
    hand: me !== null ? s.hands[me] : null,
    counts: s.hands.map((h) => h.length),
    top: topOf(s),
    pile: s.discard.slice(-4),
    discardCount: s.discard.length,
    deckCount: s.deck.length,
    color: s.color,
    turn: s.turn,
    dir: s.dir,
    dealer: s.dealer,
    stack: s.stack,
    stackTop: s.stackTop,
    wd4By: s.wd4 ? s.wd4.by : null,
    called: s.called,
    vuln: s.vuln ? { seat: s.vuln.seat, until: s.vuln.until } : null,
    turnId: s.turnId,
    turnEnds: s.turnEnds,
    turnMs: s.settings.timer * 1000,
    playable: legalPlays(s, me),
    drawn: mine ? s.drawn : null,
    mustPlay: mine ? s.mustPlay : false,
    canDraw: mine && s.drawn == null,
    canPass: mine && s.drawn != null && !s.mustPlay,
    canChallenge: mine && !!s.wd4,
    ready: s.ready || [],
    nextAt: s.nextAt,
    roundResult: s.roundResult,
    over: s.over,
    seq: s.seq,
    // a drawn card's identity only goes to the person who drew it
    events: s.events.map((e) => (e.t === "draw" && e.seat !== me ? { ...e, ids: undefined } : e)),
  }
}

export const isOver = (s) => s.over || null

export const seats = (settings) => {
  const n = Number(settings?.players)
  return Number.isFinite(n) ? n : DEFAULTS.players
}

export { validateSettings, DEFAULTS, botAction as bot, botDelay }
