// No-Limit Texas Hold'em, in the shape the online room system wants (server/arcade/rooms.js):
// create / action / view / isOver / bot / botDelay. The server runs these rules for online
// tables (server/arcade/games/holdem.js) and local.js runs them in the browser for tables
// against the computer, so both play by exactly the same rules.
//
// A game is a freeze-out: everyone starts with the same stack, the blinds go up every few
// hands (settings.blindsUp; 0 = never), players with no chips left are out, and the last one
// with chips wins. Standard rules: the button moves one live seat each hand; heads-up the
// button posts the small blind and acts first before the flop; a short all-in raise doesn't
// reopen the betting for players who already acted; uncalled bets go back; side pots for
// every all-in; split pots share evenly with odd chips to the first winner left of the button.
//
// Actions (seat = the player; null = the server's timers):
//   { type: "fold" } { type: "check" } { type: "call" }
//   { type: "raise", to }   bet or raise TO this total for the street (all-in = bet + stack)
//   server: { type: "timeout", turnId }, { type: "runout", handNo }, { type: "next", handNo }
//
// Hidden information: view(state, seat) shows your own hole cards and nobody else's until a
// showdown (and never the deck).

import { newShoe } from "./cards.js"
import { evaluate } from "./poker.js"
import { decide } from "./holdemBot.js"

export const DEFAULTS = { players: 6, stack: 1000, blind: 10, blindsUp: 10, bots: "normal", timer: 0 }
export const BLINDS = [1, 2, 5, 10, 25, 50, 100]
export const BLINDS_UP = [0, 5, 10, 15, 20]
export const TIMERS = [0, 15, 20, 30, 45, 60]
export const LEVELS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 100, 150, 200]
export const SHOWDOWN_MS = 5200
export const UNCONTESTED_MS = 2400
export const RUNOUT_MS = 1300
const MAX_LOG = 30

const int = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d)

export const validateSettings = (s = {}) => {
  const players = int(s.players, DEFAULTS.players)
  const blind = int(s.blind, DEFAULTS.blind)
  const stack = int(s.stack, DEFAULTS.stack)
  const blindsUp = int(s.blindsUp, DEFAULTS.blindsUp)
  const timer = int(s.timer, DEFAULTS.timer)
  const bots = ["easy", "normal", "hard"].includes(s.bots) ? s.bots : DEFAULTS.bots
  if (players < 2 || players > 8) return { error: "Pick 2 to 8 players." }
  if (!BLINDS.includes(blind)) return { error: "Pick a small blind from the list." }
  if (stack < blind * 20 || stack > 1_000_000) return { error: `Starting chips must be at least ${blind * 20} (10 big blinds).` }
  if (!BLINDS_UP.includes(blindsUp)) return { error: "Pick how often the blinds go up." }
  if (!TIMERS.includes(timer)) return { error: "Pick a turn timer from the list." }
  return { players, stack, blind, blindsUp, bots, timer }
}

export const seats = (s) => validateSettings(s).players || DEFAULTS.players

// the blinds for hand number `handNo` (1, 2, ...)
export const blindsFor = (settings, handNo) => {
  const level = settings.blindsUp > 0 ? Math.min(LEVELS.length - 1, Math.floor((handNo - 1) / settings.blindsUp)) : 0
  const sb = Math.max(1, Math.round(settings.blind * LEVELS[level]))
  return { level, sb, bb: sb * 2 }
}

// ---------- helpers ----------

const clone = (x) => JSON.parse(JSON.stringify(x))
const live = (state) => state.seats.map((s, i) => (s.out ? -1 : i)).filter((i) => i >= 0)
// the next seat after `from` (going left) that passes `ok`
const nextSeat = (n, from, ok) => {
  for (let k = 1; k <= n; k++) {
    const i = (((from + k) % n) + n) % n
    if (ok(i)) return i
  }
  return -1
}
const inHand = (h, i) => !!h.players[i] && !h.players[i].folded
const canAct = (h, i) => inHand(h, i) && !h.players[i].allIn
const potOf = (h) => h.players.reduce((sum, p) => sum + (p ? p.total : 0), 0)
const fmt = (n) => n.toLocaleString("en-US")

const addLog = (state, text, seat = null) => {
  state.logId = (state.logId || 0) + 1
  state.log = [...(state.log || []), { id: state.logId, seat, text }].slice(-MAX_LOG)
}

// put `amount` of a seat's chips in front of them
const putIn = (state, seat, amount) => {
  const p = state.hand.players[seat]
  const s = state.seats[seat]
  const a = Math.min(amount, s.stack)
  s.stack -= a
  p.bet += a
  p.total += a
  if (s.stack === 0) p.allIn = true
  return a
}

const setTurn = (state, seat, ctx) => {
  const h = state.hand
  h.toAct = seat
  h.turnId = (h.turnId || 0) + 1
  const timer = state.settings.timer
  if (seat >= 0 && timer > 0) {
    h.deadline = ctx.now + timer * 1000
    ctx.after(timer * 1000, { type: "timeout", turnId: h.turnId }, "turn")
  } else {
    h.deadline = null
    ctx.cancel?.("turn")
  }
}

// ---------- a hand ----------

const startHand = (state, ctx) => {
  const seatsLive = live(state)
  if (seatsLive.length < 2) {
    state.finished = { winners: seatsLive }
    state.hand = null
    return state
  }
  const n = state.seats.length
  state.handNo += 1
  const { level, sb, bb } = blindsFor(state.settings, state.handNo)
  if (level > (state.level ?? 0)) addLog(state, `Blinds go up to ${fmt(sb)}/${fmt(bb)}.`)
  state.level = level
  const button = state.button < 0 ? seatsLive[Math.floor(ctx.random() * seatsLive.length)] : nextSeat(n, state.button, (i) => !state.seats[i].out)
  state.button = button
  const headsUp = seatsLive.length === 2
  const sbSeat = headsUp ? button : nextSeat(n, button, (i) => !state.seats[i].out)
  const bbSeat = nextSeat(n, sbSeat, (i) => !state.seats[i].out)
  const deck = newShoe(1, ctx.random)
  const players = state.seats.map((s) => (s.out ? null : { cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, actedAt: -1, last: null }))
  // two cards each, one at a time, starting left of the button
  for (let round = 0; round < 2; round++) {
    let i = button
    for (let k = 0; k < seatsLive.length; k++) {
      i = nextSeat(n, i, (j) => !!players[j])
      players[i].cards.push(deck.pop())
    }
  }
  state.hand = { handNo: state.handNo, deck, board: [], street: "preflop", players, button, sbSeat, bbSeat, sb, bb, currentBet: bb, minRaise: bb, fullRaises: 0, toAct: -1, turnId: 0, deadline: null, results: null, runout: false }
  putIn(state, sbSeat, sb)
  putIn(state, bbSeat, bb)
  players[sbSeat].last = players[sbSeat].allIn ? "All-in" : `Small blind ${fmt(players[sbSeat].bet)}`
  players[bbSeat].last = players[bbSeat].allIn ? "All-in" : `Big blind ${fmt(players[bbSeat].bet)}`
  addLog(state, `Hand #${state.handNo}: ${state.seats[button].name} has the button. Blinds ${fmt(sb)}/${fmt(bb)}.`)
  const first = nextSeat(n, bbSeat, (i) => canAct(state.hand, i))
  return continueBetting(state, first, ctx)
}

// has everyone who can still bet matched the bet and had their say?
const roundClosed = (h) => h.players.every((p) => !p || p.folded || p.allIn || (p.acted && p.bet === h.currentBet))

// after a move (or the deal): the next player, the next street, or the showdown
const continueBetting = (state, candidate, ctx) => {
  const h = state.hand
  const n = state.seats.length
  const stillIn = h.players.filter((p) => p && !p.folded).length
  if (stillIn <= 1) return award(state, ctx)
  if (!roundClosed(h)) {
    // the player to act: the candidate, or the next one who still needs to
    const needs = (i) => canAct(h, i) && (!h.players[i].acted || h.players[i].bet !== h.currentBet)
    const seat = candidate >= 0 && needs(candidate) ? candidate : nextSeat(n, candidate >= 0 ? candidate : h.button, needs)
    if (seat >= 0) {
      setTurn(state, seat, ctx)
      return state
    }
  }
  return endStreet(state, ctx)
}

const dealStreet = (h) => {
  h.deck.pop() // burn
  if (h.street === "preflop") {
    h.board.push(h.deck.pop(), h.deck.pop(), h.deck.pop())
    h.street = "flop"
  } else if (h.street === "flop") {
    h.board.push(h.deck.pop())
    h.street = "turn"
  } else if (h.street === "turn") {
    h.board.push(h.deck.pop())
    h.street = "river"
  }
}

const endStreet = (state, ctx) => {
  const h = state.hand
  const n = state.seats.length
  for (const p of h.players) if (p) Object.assign(p, { bet: 0, acted: false, actedAt: -1 })
  h.currentBet = 0
  h.minRaise = h.bb
  h.fullRaises += 1
  if (h.street === "river") return showdown(state, ctx)
  const able = h.players.filter((p, i) => p && canAct(h, i)).length
  if (able <= 1) {
    // nobody left to bet against: turn the rest of the cards over one street at a time
    h.runout = true
    for (const p of h.players) if (p && !p.folded) p.last = p.allIn ? "All-in" : p.last
    setTurn(state, -1, ctx)
    ctx.after(RUNOUT_MS, { type: "runout", handNo: h.handNo }, "runout")
    return state
  }
  dealStreet(h)
  for (const p of h.players) if (p) p.last = p.allIn ? "All-in" : null
  addLog(state, `${h.street[0].toUpperCase()}${h.street.slice(1)}.`)
  const first = nextSeat(n, h.button, (i) => canAct(h, i))
  setTurn(state, first, ctx)
  return state
}

// uncalled chips go back to whoever put them in
const refundUncalled = (state) => {
  const h = state.hand
  let top = -1
  h.players.forEach((p, i) => {
    if (p && (top < 0 || p.total > h.players[top].total)) top = i
  })
  const second = Math.max(0, ...h.players.map((p, i) => (p && i !== top ? p.total : 0)))
  const extra = h.players[top].total - second
  if (extra > 0) {
    h.players[top].total -= extra
    state.seats[top].stack += extra
  }
  return { seat: top, amount: Math.max(0, extra) }
}

// the main pot and side pots: [{ amount, eligible: [seats] }], from everyone's chips in
export const buildPots = (contributions, folded) => {
  const levels = [...new Set(contributions.filter((c, i) => c > 0 && !folded[i]))].sort((a, b) => a - b)
  const pots = []
  let prev = 0
  for (const level of levels) {
    let amount = 0
    contributions.forEach((c) => {
      amount += Math.max(0, Math.min(c, level) - prev)
    })
    const eligible = contributions.map((c, i) => (c >= level && !folded[i] ? i : -1)).filter((i) => i >= 0)
    // the same people as the pot before: one pot
    const last = pots[pots.length - 1]
    if (last && last.eligible.join() === eligible.join()) last.amount += amount
    else if (amount > 0) pots.push({ amount, eligible })
    prev = level
  }
  // chips from folded players above every live player's level (can't happen after refunds)
  const leftover = contributions.reduce((s, c) => s + Math.max(0, c - prev), 0)
  if (leftover && pots.length) pots[pots.length - 1].amount += leftover
  return pots
}

// share pot `amount` among `winners`, odd chips to the first winner left of the button
export const splitPot = (amount, winners, button, n) => {
  const order = [...winners].sort((a, b) => ((a - button - 1 + n) % n) - ((b - button - 1 + n) % n))
  const each = Math.floor(amount / order.length)
  let odd = amount - each * order.length
  return order.map((seat) => ({ seat, amount: each + (odd-- > 0 ? 1 : 0) }))
}

const finishHand = (state, ctx, delay) => {
  const h = state.hand
  setTurn(state, -1, ctx)
  // players with no chips left are out; the ones with more chips at the start place higher
  const busted = state.seats.map((s, i) => (!s.out && s.stack === 0 ? i : -1)).filter((i) => i >= 0)
  const remaining = live(state).length - busted.length
  busted
    .sort((a, b) => h.players[b].total - h.players[a].total)
    .forEach((i, k) => {
      state.seats[i].out = true
      state.seats[i].place = remaining + 1 + k
      addLog(state, `${state.seats[i].name} is out (${ordinal(state.seats[i].place)} place).`, i)
    })
  const left = live(state)
  if (left.length < 2) {
    if (left[0] != null) state.seats[left[0]].place = 1
    state.finished = { winners: left }
    addLog(state, `${state.seats[left[0]]?.name ?? "Nobody"} wins the game!`, left[0] ?? null)
    return state
  }
  ctx.after(delay, { type: "next", handNo: h.handNo }, "next")
  return state
}

export const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`

// everyone else folded
const award = (state, ctx) => {
  const h = state.hand
  refundUncalled(state)
  const winner = h.players.findIndex((p) => p && !p.folded)
  const pot = potOf(h)
  state.seats[winner].stack += pot
  h.results = { uncontested: true, shown: [], pots: [{ amount: pot, winners: [winner], hand: null }], won: { [winner]: pot } }
  h.done = true
  addLog(state, `${state.seats[winner].name} wins ${fmt(pot)}.`, winner)
  return finishHand(state, ctx, UNCONTESTED_MS)
}

const showdown = (state, ctx) => {
  const h = state.hand
  const n = state.seats.length
  refundUncalled(state)
  while (h.board.length < 5) dealStreet(h)
  h.street = "showdown"
  const folded = h.players.map((p) => !p || p.folded)
  const contributions = h.players.map((p) => (p ? p.total : 0))
  const hands = h.players.map((p, i) => (p && !p.folded ? evaluate([...p.cards, ...h.board]) : null))
  const pots = buildPots(contributions, folded)
  const won = {}
  const results = pots.map((pot) => {
    const best = Math.max(...pot.eligible.map((i) => hands[i].score))
    const winners = pot.eligible.filter((i) => hands[i].score === best)
    for (const share of splitPot(pot.amount, winners, h.button, n)) {
      state.seats[share.seat].stack += share.amount
      won[share.seat] = (won[share.seat] || 0) + share.amount
    }
    return { amount: pot.amount, winners, hand: hands[winners[0]].name }
  })
  h.results = {
    uncontested: false,
    shown: h.players.map((p, i) => (p && !p.folded ? i : -1)).filter((i) => i >= 0),
    hands: hands.map((x) => (x ? { name: x.name, best: x.best.map((c) => c.id) } : null)),
    pots: results,
    won,
  }
  h.done = true
  results.forEach((r, k) => {
    const label = results.length > 1 ? (k === 0 ? "the main pot" : `side pot ${k}`) : "the pot"
    const names = r.winners.map((i) => state.seats[i].name).join(" and ")
    addLog(state, `${names} ${r.winners.length > 1 ? "split" : "wins"} ${label} (${fmt(r.amount)}) with ${r.hand}.`, r.winners[0])
  })
  return finishHand(state, ctx, SHOWDOWN_MS)
}

// ---------- the room module ----------

export const create = ({ players, settings, random, now, after }) => {
  const s = validateSettings(settings)
  const clean = s.error ? { ...DEFAULTS, players: players.length } : s
  const state = {
    settings: clean,
    seats: players.map((p) => ({ name: p.name || `Player ${p.id + 1}`, bot: !!p.bot, stack: clean.stack, out: false, place: null })),
    handNo: 0,
    level: 0,
    button: -1,
    hand: null,
    log: [],
    logId: 0,
    finished: null,
  }
  return startHand(state, { random, now, after, cancel: () => {} })
}

export const legalFor = (state, seat) => {
  const h = state.hand
  if (!h || h.done || h.toAct !== seat || seat == null) return null
  const p = h.players[seat]
  const stack = state.seats[seat].stack
  const toCall = Math.max(0, h.currentBet - p.bet)
  const maxTo = p.bet + stack
  // a player who already acted since the last full raise can only call or fold
  const reopened = p.actedAt < h.fullRaises
  const canRaise = reopened && stack > toCall
  const minTo = Math.min(maxTo, h.currentBet + h.minRaise)
  return { canCheck: toCall === 0, toCall: Math.min(toCall, stack), canRaise, minTo, maxTo, currentBet: h.currentBet, bet: p.bet, stack, pot: potOf(h), bb: h.bb }
}

export const action = (state, seat, act, ctx) => {
  if (!act || typeof act !== "object") return { error: "That isn't a move." }
  if (state.finished) return { error: "The game is over." }

  if (seat == null) {
    if (act.type === "timeout") {
      const h = state.hand
      if (!h || h.done || h.turnId !== act.turnId || h.toAct < 0) return state
      const legal = legalFor(state, h.toAct)
      const s = clone(state)
      const who = h.toAct
      s.seats[who].timeouts = (s.seats[who].timeouts || 0) + 1
      return applyMove(s, who, legal.canCheck ? { type: "check" } : { type: "fold" }, ctx, true)
    }
    if (act.type === "runout") {
      const h = state.hand
      if (!h || h.done || !h.runout || h.handNo !== act.handNo) return state
      const s = clone(state)
      const sh = s.hand
      if (sh.street === "river") return showdown(s, ctx)
      dealStreet(sh)
      addLog(s, `${sh.street[0].toUpperCase()}${sh.street.slice(1)}.`)
      ctx.after(RUNOUT_MS, { type: "runout", handNo: sh.handNo }, "runout")
      return s
    }
    if (act.type === "next") {
      if (!state.hand || state.hand.handNo !== act.handNo || !state.hand.done) return state
      return startHand(clone(state), ctx)
    }
    return state
  }

  const h = state.hand
  if (!h || h.done) return { error: "Wait for the next hand." }
  if (h.toAct !== seat) return { error: "It isn't your turn." }
  return applyMove(clone(state), seat, act, ctx, false)
}

const applyMove = (state, seat, act, ctx, timedOut) => {
  const h = state.hand
  const p = h.players[seat]
  const legal = legalFor(state, seat)
  const name = state.seats[seat].name
  switch (act.type) {
    case "fold":
      p.folded = true
      p.last = "Fold"
      addLog(state, `${name} folds${timedOut ? " (out of time)" : ""}.`, seat)
      break
    case "check":
      if (!legal.canCheck) return { error: `It's ${fmt(legal.toCall)} to call.` }
      p.last = "Check"
      addLog(state, `${name} checks${timedOut ? " (out of time)" : ""}.`, seat)
      break
    case "call": {
      if (legal.canCheck) {
        p.last = "Check"
        addLog(state, `${name} checks.`, seat)
        break
      }
      const paid = putIn(state, seat, legal.toCall)
      p.last = p.allIn ? "All-in" : `Call ${fmt(paid)}`
      addLog(state, `${name} calls ${fmt(paid)}${p.allIn ? " and is all-in" : ""}.`, seat)
      break
    }
    case "raise": {
      if (!legal.canRaise) return { error: legal.stack > legal.toCall ? "You can only call or fold: nobody has raised since you acted." : "You can only call (all-in) or fold." }
      let to = int(act.to, NaN)
      if (!Number.isFinite(to)) return { error: "How much?" }
      if (to >= legal.maxTo) to = legal.maxTo
      if (to <= h.currentBet) return { error: `Raise to more than ${fmt(h.currentBet)}.` }
      if (to < legal.minTo) return { error: `The smallest ${h.currentBet ? "raise" : "bet"} is to ${fmt(legal.minTo)}.` }
      const size = to - h.currentBet
      const wasBet = h.currentBet === 0
      putIn(state, seat, to - p.bet)
      if (size >= h.minRaise) {
        h.minRaise = size
        h.fullRaises += 1
      }
      h.currentBet = to
      for (const other of h.players) if (other && other !== p) other.acted = false
      p.last = p.allIn ? "All-in" : wasBet ? `Bet ${fmt(to)}` : `Raise to ${fmt(to)}`
      addLog(state, `${name} ${p.allIn ? `goes all-in for ${fmt(to)}` : wasBet ? `bets ${fmt(to)}` : `raises to ${fmt(to)}`}.`, seat)
      break
    }
    default:
      return { error: "That isn't a move." }
  }
  if (!timedOut) state.seats[seat].timeouts = 0
  p.acted = true
  p.actedAt = h.fullRaises
  const n = state.seats.length
  return continueBetting(state, nextSeat(n, seat, (i) => canAct(h, i)), ctx)
}

export const view = (state, seat) => {
  const h = state.hand
  const you = seat == null ? null : seat
  const shown = new Set(h?.results?.shown || [])
  const { sb, bb } = h || blindsFor(state.settings, Math.max(1, state.handNo))
  const nextUp = state.settings.blindsUp > 0 ? state.settings.blindsUp - ((state.handNo - 1) % state.settings.blindsUp) : null
  return {
    handNo: state.handNo,
    settings: state.settings,
    blinds: { sb, bb, next: blindsFor(state.settings, state.handNo + (nextUp || 0)), handsLeft: nextUp },
    button: h?.button ?? state.button,
    sbSeat: h?.sbSeat ?? -1,
    bbSeat: h?.bbSeat ?? -1,
    street: h?.street ?? null,
    board: h?.board ?? [],
    pot: h ? potOf(h) : 0,
    toAct: h && !h.done ? h.toAct : -1,
    turnId: h?.turnId ?? 0,
    deadline: h?.deadline ?? null,
    runout: !!h?.runout,
    done: !!h?.done,
    you,
    seats: state.seats.map((s, i) => {
      const p = h?.players[i]
      const visible = p && (i === you || (shown.has(i) && h.done) || (h.runout && !p.folded))
      return {
        name: s.name,
        bot: s.bot,
        stack: s.stack,
        out: s.out,
        place: s.place,
        inHand: !!p && !p.folded,
        folded: !!p?.folded,
        allIn: !!p?.allIn,
        bet: p?.bet ?? 0,
        total: p?.total ?? 0,
        last: p?.last ?? null,
        cards: !p ? [] : visible ? p.cards : p.folded ? [] : [null, null],
      }
    }),
    legal: legalFor(state, you),
    results: h?.results ?? null,
    log: (state.log || []).slice(-12),
    finished: state.finished,
  }
}

export const isOver = (state) => (state.finished ? { winners: state.finished.winners, reason: "chips" } : null)

export const bot = (state, seat, { random = Math.random } = {}) => {
  const legal = legalFor(state, seat)
  if (!legal) return null
  const h = state.hand
  const n = state.seats.length
  const order = []
  for (let k = 1; k <= n; k++) {
    const i = (h.button + k) % n
    if (h.players[i] && !h.players[i].folded) order.push(i)
  }
  return decide({
    hole: h.players[seat].cards,
    board: h.board,
    opponents: h.players.filter((p, i) => p && !p.folded && i !== seat).length,
    legal,
    street: h.street,
    position: order.length > 1 ? order.indexOf(seat) / (order.length - 1) : 1,
    difficulty: state.settings.bots,
    style: seat % 3,
    random,
  })
}

export const botDelay = (state, seat, act) => {
  const t = state.hand?.turnId || 0
  const jitter = (t * 7919 + seat * 104729) % 900
  return (act?.type === "fold" || act?.type === "check" ? 650 : 950) + jitter
}
