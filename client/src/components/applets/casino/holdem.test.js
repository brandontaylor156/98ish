// The poker hand evaluator and Texas Hold'em's rules.
// Run: node --test client/src/components/applets/casino/holdem.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { parseAll, parse } from "./cards.js"
import { evaluate, compare, equity } from "./poker.js"
import * as H from "./holdem.js"
import { decide } from "./holdemBot.js"
import { createLocalGame } from "./local.js"

const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647
const ev = (text) => evaluate(parseAll(text))

// ---------- the evaluator ----------

test("every category is recognised and named", () => {
  assert.equal(ev("AS KS QS JS TS 2D 3C").name, "Royal Flush")
  assert.equal(ev("9H 8H 7H 6H 5H AH KD").name, "Straight Flush, Nine high")
  assert.equal(ev("7C 7D 7H 7S KD 2C 3C").name, "Four Sevens")
  assert.equal(ev("KC KD KH 4S 4D 2C 9C").name, "Full House, Kings full of Fours")
  assert.equal(ev("2H 9H JH 4H 6H KD KC").cat, 5)
  assert.equal(ev("5C 6D 7H 8S 9D KC KD").name, "Straight, Nine high")
  assert.equal(ev("QC QD QH 4S 9D 2C 7C").name, "Three Queens")
  assert.equal(ev("JC JD 4H 4S AD 2C 7C").name, "Two Pair, Jacks and Fours")
  assert.equal(ev("TC TD 4H 8S AD 2C 7C").name, "Pair of Tens")
  assert.equal(ev("AC JD 4H 8S 9D 2C 7C").name, "Ace High")
})

test("the wheel: A-2-3-4-5 is a five-high straight, below 6-high", () => {
  const wheel = ev("AC 2D 3H 4S 5D KC KD")
  assert.equal(wheel.cat, 4)
  assert.deepEqual(wheel.ranks, [5])
  assert.equal(wheel.name, "Straight, Five high")
  assert.ok(compare(parseAll("2C 3D 4H 5S 6D KC KD"), parseAll("AC 2D 3H 4S 5D KC KD")) > 0)
  // a steel wheel
  assert.equal(ev("AH 2H 3H 4H 5H 9C 9D").name, "Straight Flush, Five high")
  // no wrap-around: Q K A 2 3 is no straight
  assert.notEqual(ev("QC KD AH 2S 3D 8C 9D").cat, 4)
  // the higher straight in seven cards
  assert.deepEqual(ev("AC 2D 3H 4S 5D 6C 7D").ranks, [7])
})

test("kickers decide ties", () => {
  assert.ok(compare(parseAll("AC AD KH 8S 3D 2C 4C"), parseAll("AH AS QH 8D 3C 2D 4D")) > 0)
  // two pair: the kicker
  assert.ok(compare(parseAll("JC JD 4H 4S AD 2C 7C"), parseAll("JH JS 4C 4D KD 2D 7D")) > 0)
  // high card down to the fifth card
  assert.ok(compare(parseAll("AC JD 9H 7S 4D"), parseAll("AD JC 9S 7H 3D")) > 0)
  // only the best five play: the sixth card doesn't break the tie
  assert.equal(compare(parseAll("AC AD KH QS JD 3C 2C"), parseAll("AH AS KC QD JC 4D 3D")), 0)
  // quads: the kicker
  assert.ok(compare(parseAll("9C 9D 9H 9S AD"), parseAll("9C 9D 9H 9S KD")) > 0)
  // flush vs flush: the second card
  assert.ok(compare(parseAll("AH QH 9H 5H 3H"), parseAll("AD JD TD 8D 6D")) > 0)
})

test("full houses: the best trips, then the best pair (a second set of trips counts)", () => {
  const two = ev("KC KD KH 3S 3D 3C QC")
  assert.equal(two.cat, 6)
  assert.deepEqual(two.ranks, [13, 3])
  const trips = ev("KC KD KH 3S 3D QC QD")
  assert.deepEqual(trips.ranks, [13, 12])
  assert.equal(two.best.length, 5)
})

test("a flush beats a straight; the best five cards come back", () => {
  const h = ev("2H 9H JH 4H 6H 7C 8D")
  assert.equal(h.cat, 5)
  assert.equal(h.best.length, 5)
  assert.ok(h.best.every((c) => c.suit === 2))
  assert.ok(compare(parseAll("2H 9H JH 4H 6H"), parseAll("5C 6D 7H 8S 9D")) > 0)
})

test("equity: aces are a big favourite heads-up, and ties share", () => {
  const aces = equity(parseAll("AS AH"), [], 1, { trials: 600, random: seeded(3) })
  assert.ok(aces > 0.78 && aces < 0.9, `aces ${aces}`)
  // the board plays for both: always a split
  const split = equity(parseAll("2C 3D"), parseAll("AS KS QS JS TS"), 1, { trials: 100, random: seeded(4) })
  assert.equal(split, 0.5)
})

// ---------- side pots and splits ----------

test("buildPots: main pot and side pots by all-in level", () => {
  // A all-in 100, B all-in 300, C 500, D folded after 50
  const pots = H.buildPots([100, 300, 500, 50], [false, false, false, true])
  assert.deepEqual(pots, [
    { amount: 350, eligible: [0, 1, 2] },
    { amount: 400, eligible: [1, 2] },
    { amount: 200, eligible: [2] },
  ])
  assert.equal(pots.reduce((s, p) => s + p.amount, 0), 950)
  // everyone in for the same: one pot
  assert.deepEqual(H.buildPots([200, 200, 200], [false, false, false]), [{ amount: 600, eligible: [0, 1, 2] }])
})

test("splitPot: odd chips go to the first winner left of the button", () => {
  assert.deepEqual(H.splitPot(101, [1, 3], 2, 4), [
    { seat: 3, amount: 51 },
    { seat: 1, amount: 50 },
  ])
  assert.deepEqual(H.splitPot(100, [0, 2], 3, 4), [
    { seat: 0, amount: 50 },
    { seat: 2, amount: 50 },
  ])
})

// ---------- the rules ----------

const makeCtx = (random = seeded(11)) => {
  const timers = new Map()
  return {
    now: 1_000_000,
    random,
    timers,
    after: (ms, action, key = "timer") => timers.set(key, { ms, action }),
    cancel: (key = "timer") => timers.delete(key),
  }
}
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: `P${i}`, bot: false }))
const newGame = (n, settings = {}, random = seeded(11)) => {
  const ctx = makeCtx(random)
  const state = H.create({ players: players(n), settings: { ...H.DEFAULTS, players: n, ...settings }, random, now: ctx.now, after: ctx.after })
  return { state, ctx }
}
const act = (g, seat, a) => {
  const next = H.action(g.state, seat, a, g.ctx)
  assert.ok(!next.error, `${JSON.stringify(a)} by ${seat}: ${next.error}`)
  g.state = next
  return next
}
const fire = (g, key) => {
  const t = g.ctx.timers.get(key)
  assert.ok(t, `no ${key} timer`)
  g.ctx.timers.delete(key)
  g.state = H.action(g.state, null, t.action, g.ctx)
}
// rig the next deal: hole cards per seat and the board, by rebuilding the deck
const rig = (g, holes, board) => {
  const h = g.state.hand
  h.players.forEach((p, i) => p && holes[i] && (p.cards = parseAll(holes[i])))
  const used = new Set([...Object.values(holes).filter(Boolean).join(" ").split(" "), ...board.split(" ")])
  const rest = h.deck.filter((c) => !used.has(c.id))
  // dealStreet pops: burn, flop x3, burn, turn, burn, river
  const b = parseAll(board)
  h.deck = [...rest.slice(3), b[4], rest[2], b[3], rest[1], b[2], b[1], b[0], rest[0]]
}
const total = (s) => s.seats.reduce((a, x) => a + x.stack, 0) + (s.hand && !s.hand.done ? s.hand.players.reduce((a, p) => a + (p ? p.total : 0), 0) : 0)

test("validateSettings refuses silly tables", () => {
  assert.ok(H.validateSettings({ players: 9 }).error)
  assert.ok(H.validateSettings({ players: 4, blind: 7 }).error)
  assert.ok(H.validateSettings({ players: 4, blind: 10, stack: 100 }).error)
  assert.deepEqual(H.validateSettings({ players: 3 }), { ...H.DEFAULTS, players: 3 })
})

test("blinds are posted, the player left of the big blind acts first, chips are conserved", () => {
  const g = newGame(4)
  const h = g.state.hand
  const n = 4
  assert.equal(h.sbSeat, (h.button + 1) % n)
  assert.equal(h.bbSeat, (h.button + 2) % n)
  assert.equal(h.players[h.sbSeat].bet, 10)
  assert.equal(h.players[h.bbSeat].bet, 20)
  assert.equal(h.toAct, (h.button + 3) % n)
  assert.equal(total(g.state), 4000)
  // hole cards are private
  const v = H.view(g.state, h.toAct)
  assert.equal(v.seats[h.toAct].cards.length, 2)
  assert.ok(v.seats[h.toAct].cards[0].rank)
  const other = (h.toAct + 1) % n
  assert.deepEqual(v.seats[other].cards, [null, null])
  assert.equal(H.view(g.state, null).seats.every((s) => s.cards.every((c) => c === null)), true)
  assert.equal(JSON.stringify(v).includes("deck"), false)
})

test("heads-up: the button posts the small blind and acts first preflop, last after", () => {
  const g = newGame(2)
  const h = g.state.hand
  assert.equal(h.sbSeat, h.button)
  assert.equal(h.toAct, h.button)
  act(g, h.button, { type: "call" })
  // the big blind has the option
  assert.equal(g.state.hand.toAct, h.bbSeat)
  assert.equal(H.legalFor(g.state, h.bbSeat).canCheck, true)
  act(g, h.bbSeat, { type: "check" })
  assert.equal(g.state.hand.street, "flop")
  assert.equal(g.state.hand.board.length, 3)
  assert.equal(g.state.hand.toAct, h.bbSeat)
})

test("raises: minimum raise is the last raise size; all-in is allowed below it", () => {
  const g = newGame(3, { stack: 1000 })
  const h = g.state.hand
  const utg = h.toAct
  assert.ok(H.action(g.state, utg, { type: "raise", to: 30 }).error) // min is 40
  act(g, utg, { type: "raise", to: 60 }) // a raise of 40
  const next = g.state.hand.toAct
  assert.equal(H.legalFor(g.state, next).minTo, 100)
  assert.ok(H.action(g.state, next, { type: "raise", to: 90 }).error)
  act(g, next, { type: "raise", to: 5000 }) // capped at all-in
  assert.equal(g.state.hand.players[next].allIn, true)
  assert.equal(g.state.hand.currentBet, 1000)
  assert.equal(total(g.state), 3000)
})

test("a short all-in raise doesn't reopen the betting for players who already acted", () => {
  const g = newGame(3, { stack: 1000 })
  const h = g.state.hand
  const [a, b, c] = [h.toAct, (h.toAct + 1) % 3, (h.toAct + 2) % 3] // button, sb, bb
  // b (small blind) has only 130 behind
  g.state.seats[b].stack = 120 // 10 is posted: 130 total
  act(g, a, { type: "raise", to: 100 }) // raise of 80
  act(g, b, { type: "raise", to: 130 }) // all-in, a raise of only 30
  assert.equal(g.state.hand.players[b].allIn, true)
  // c hasn't acted since the full raise: may re-raise
  assert.equal(H.legalFor(g.state, c).canRaise, true)
  act(g, c, { type: "call" })
  // a already acted after the last full raise: call or fold only
  const legal = H.legalFor(g.state, a)
  assert.equal(legal.toCall, 30)
  assert.equal(legal.canRaise, false)
  assert.ok(H.action(g.state, a, { type: "raise", to: 400 }).error)
  act(g, a, { type: "call" })
  assert.equal(g.state.hand.street, "flop")
})

test("folding round to the big blind: uncontested, uncalled bets come back, next hand moves the button", () => {
  const g = newGame(3)
  const h = g.state.hand
  const button = h.button
  act(g, h.toAct, { type: "fold" })
  act(g, g.state.hand.toAct, { type: "fold" })
  const s = g.state
  assert.equal(s.hand.done, true)
  assert.equal(s.hand.results.uncontested, true)
  assert.equal(s.seats[h.bbSeat].stack, 1010)
  assert.equal(s.seats[h.sbSeat].stack, 990)
  assert.equal(total(s), 3000)
  fire(g, "next")
  assert.equal(g.state.hand.button, (button + 1) % 3)
  assert.equal(g.state.handNo, 2)
})

test("showdown with side pots: the short stack wins the main pot, the side pot goes to the best of the rest", () => {
  const g = newGame(3, { stack: 1000 }, seeded(5))
  const h = g.state.hand
  const n = 3
  const [utg, sb, bb] = [h.toAct, h.sbSeat, h.bbSeat]
  g.state.seats[utg].stack = 200 // short stack: 200
  rig(
    g,
    { [utg]: "AS AH", [sb]: "KS KH", [bb]: "QS QH" },
    "2C 7D 9H 3S 4D"
  )
  act(g, utg, { type: "raise", to: 200 }) // all-in 200
  act(g, sb, { type: "raise", to: 600 })
  act(g, bb, { type: "call" })
  // sb and bb can still bet: check it down
  for (let i = 0; i < 3; i++) {
    act(g, g.state.hand.toAct, { type: "check" })
    act(g, g.state.hand.toAct, { type: "check" })
  }
  const r = g.state.hand.results
  assert.equal(r.pots.length, 2)
  assert.deepEqual(r.pots[0], { amount: 600, winners: [utg], hand: "Pair of Aces" })
  assert.deepEqual(r.pots[1], { amount: 800, winners: [sb], hand: "Pair of Kings" })
  assert.equal(g.state.seats[utg].stack, 600)
  assert.equal(g.state.seats[sb].stack, 400 + 800)
  assert.equal(g.state.seats[bb].stack, 400)
  // everyone sees the cards at the showdown
  const v = H.view(g.state, bb)
  assert.equal(v.seats[utg].cards[0].rank, 1)
  void n
})

test("an all-in runout deals one street at a time, then splits a tie", () => {
  const g = newGame(2, { stack: 500 }, seeded(8))
  const h = g.state.hand
  const [btn, bb] = [h.button, h.bbSeat]
  rig(g, { [btn]: "2C 3D", [bb]: "2H 3S" }, "AS KS QS JD TD")
  act(g, btn, { type: "raise", to: 500 })
  act(g, bb, { type: "call" })
  assert.equal(g.state.hand.runout, true)
  assert.equal(g.state.hand.board.length, 0)
  // both players' cards face up during the runout
  assert.ok(H.view(g.state, btn).seats[bb].cards[0].rank)
  fire(g, "runout")
  assert.equal(g.state.hand.board.length, 3)
  fire(g, "runout")
  fire(g, "runout")
  assert.equal(g.state.hand.board.length, 5)
  fire(g, "runout")
  const r = g.state.hand.results
  assert.deepEqual(r.pots[0].winners.sort(), [0, 1])
  assert.equal(g.state.seats[0].stack, 500)
  assert.equal(g.state.seats[1].stack, 500)
})

test("a player with no chips is out; the last one standing wins the game", () => {
  const g = newGame(2, { stack: 400 }, seeded(9))
  const h = g.state.hand
  const [btn, bb] = [h.button, h.bbSeat]
  rig(g, { [btn]: "AS AH", [bb]: "7C 2D" }, "AD KC 9H 4S 3C")
  act(g, btn, { type: "raise", to: 400 })
  act(g, bb, { type: "call" })
  while (!g.state.hand.done) fire(g, "runout")
  assert.equal(g.state.seats[bb].out, true)
  assert.equal(g.state.seats[bb].place, 2)
  assert.deepEqual(H.isOver(g.state), { winners: [btn], reason: "chips" })
  assert.ok(H.action(g.state, btn, { type: "check" }).error)
})

test("the turn clock checks or folds for you", () => {
  const g = newGame(3, { timer: 30 })
  const seat = g.state.hand.toAct
  assert.equal(g.state.hand.deadline, 1_000_000 + 30_000)
  fire(g, "turn")
  assert.equal(g.state.hand.players[seat].folded, true)
  // an old timer does nothing
  const stale = H.action(g.state, null, { type: "timeout", turnId: 1 }, g.ctx)
  assert.equal(stale, g.state)
})

test("blinds go up every N hands", () => {
  assert.deepEqual(H.blindsFor({ blind: 10, blindsUp: 5 }, 1), { level: 0, sb: 10, bb: 20 })
  assert.deepEqual(H.blindsFor({ blind: 10, blindsUp: 5 }, 6), { level: 1, sb: 15, bb: 30 })
  assert.deepEqual(H.blindsFor({ blind: 10, blindsUp: 0 }, 99), { level: 0, sb: 10, bb: 20 })
})

test("moves out of turn and junk are refused; state is never mutated", () => {
  const g = newGame(3)
  const before = JSON.stringify(g.state)
  const wrong = (g.state.hand.toAct + 1) % 3
  assert.ok(H.action(g.state, wrong, { type: "call" }).error)
  assert.ok(H.action(g.state, g.state.hand.toAct, { type: "dance" }).error)
  assert.ok(H.action(g.state, g.state.hand.toAct, { type: "check" }).error) // 20 to call
  H.action(g.state, g.state.hand.toAct, { type: "raise", to: 100 }, g.ctx)
  assert.equal(JSON.stringify(g.state), before)
})

test("the computer players always make legal moves", () => {
  const random = seeded(77)
  for (const difficulty of ["easy", "normal", "hard"]) {
    for (let k = 0; k < 40; k++) {
      const hole = parseAll(["AS KD", "7C 2H", "QH QD", "9S 8S", "5D 5C"][k % 5])
      const legal = { canCheck: k % 2 === 0, toCall: k % 2 ? 40 : 0, canRaise: k % 3 !== 0, minTo: 80, maxTo: 500, currentBet: k % 2 ? 40 : 0, bet: 0, stack: 500, pot: 120, bb: 20 }
      const a = decide({ hole, board: k % 4 ? parseAll("2D 9C JH") : [], opponents: 1 + (k % 4), legal, street: k % 4 ? "flop" : "preflop", difficulty, random })
      assert.ok(["fold", "check", "call", "raise"].includes(a.type))
      if (a.type === "check") assert.ok(legal.canCheck)
      if (a.type === "raise") {
        assert.ok(legal.canRaise)
        assert.ok(a.to >= legal.minTo && a.to <= legal.maxTo)
      }
    }
  }
})

test("a whole table of computer players plays to a winner with chips conserved", () => {
  for (const [n, seed] of [[2, 1], [5, 2], [8, 3]]) {
    const random = seeded(seed)
    const g = newGame(n, { stack: 300, blind: 10, blindsUp: 5, bots: ["easy", "normal", "hard"][seed % 3] }, random)
    let steps = 0
    while (!H.isOver(g.state) && steps < 20000) {
      steps++
      const h = g.state.hand
      if (h.done) fire(g, "next")
      else if (h.runout) fire(g, "runout")
      else {
        const a = H.bot(g.state, h.toAct, { random })
        act(g, h.toAct, a)
      }
      if (!H.isOver(g.state)) assert.equal(total(g.state), n * 300)
    }
    const over = H.isOver(g.state)
    assert.ok(over, `no winner after ${steps} steps`)
    assert.equal(g.state.seats[over.winners[0]].stack, n * 300)
    const places = g.state.seats.map((s) => s.place).sort((a, b) => a - b)
    assert.deepEqual(places, Array.from({ length: n }, (_, i) => i + 1))
  }
})

test("the local runner plays a table against the computer", async () => {
  let fake = 0
  const queue = []
  const time = {
    now: () => fake,
    setTimeout: (fn, ms) => (queue.push({ at: fake + ms, fn }), queue.length),
    clearTimeout: (h) => h && (queue[h - 1] = null),
  }
  const ps = [{ id: 0, name: "You", bot: false }, ...[1, 2, 3].map((i) => ({ id: i, name: `Bot${i}`, bot: true }))]
  let changes = 0
  const game = createLocalGame({ rules: H, settings: { ...H.DEFAULTS, players: 4 }, players: ps, random: seeded(4), time, onChange: () => changes++ })
  const run = (limit) => {
    for (let i = 0; i < limit; i++) {
      const v = game.view(0)
      if (game.result) return
      if (v.legal) {
        game.act(v.legal.canCheck ? { type: "check" } : { type: "fold" })
        continue
      }
      const next = queue.map((q, k) => (q ? { ...q, k } : null)).filter(Boolean).sort((a, b) => a.at - b.at)[0]
      if (!next) return
      queue[next.k] = null
      fake = next.at
      next.fn()
    }
  }
  run(400)
  assert.ok(game.state.handNo >= 3, `hands ${game.state.handNo}`)
  assert.ok(changes > 10)
  game.stop()
  void parse
})
