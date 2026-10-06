// The casino's table games: Blackjack, Roulette, Slots, Video Poker, Craps, Baccarat, and the
// chip bank. Run: node --test client/src/components/applets/casino/casino.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { parseAll, freshShoe } from "./cards.js"
import * as BJ from "./blackjack.js"
import * as R from "./roulette.js"
import * as S from "./slots.js"
import * as VP from "./videoPoker.js"
import * as C from "./craps.js"
import * as B from "./baccarat.js"
import { createBank, START } from "./bank.js"

const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647

// ---------- Blackjack ----------

// a table whose shoe deals these cards in order (player, dealer up, player, dealer hole, then hits)
const rigged = (order, settings = {}) => {
  const t = BJ.createTable(settings, seeded(1))
  t.shoe = [...freshShoe(6).slice(0, 200), ...parseAll(order).reverse()]
  return t
}
const ok = (s) => {
  assert.ok(!s.error, s.error)
  return s
}

test("hand values: soft and hard totals, blackjack", () => {
  assert.deepEqual(BJ.handValue(parseAll("AS 6D")), { total: 17, soft: true })
  assert.deepEqual(BJ.handValue(parseAll("AS 6D TC")), { total: 17, soft: false })
  assert.deepEqual(BJ.handValue(parseAll("AS AD")), { total: 12, soft: true })
  assert.deepEqual(BJ.handValue(parseAll("AS AD 9C")), { total: 21, soft: true })
  assert.deepEqual(BJ.handValue(parseAll("KS QD 5C")), { total: 25, soft: false })
  assert.equal(BJ.isBlackjack(parseAll("AS KD")), true)
  assert.equal(BJ.isBlackjack(parseAll("7S 7D 7C")), false)
  assert.equal(BJ.describe(parseAll("AS 6D")), "7 / 17")
})

test("blackjack pays 3:2; a dealer blackjack beats 21 but pushes a blackjack", () => {
  let s = ok(BJ.deal(rigged("AS 9D KH 7C"), 10))
  assert.equal(s.phase, "done")
  assert.equal(s.hands[0].result, "blackjack")
  assert.equal(s.returned, 25)
  // dealer shows a ten and has blackjack: the dealer peeks, the round is over
  s = ok(BJ.deal(rigged("9S KD 9H AC"), 10))
  assert.equal(s.phase, "done")
  assert.equal(s.hands[0].result, "lose")
  assert.equal(s.returned, 0)
  // both blackjack (ace up): insurance, then a push
  s = ok(BJ.deal(rigged("AS AD KH KC"), 10))
  assert.equal(s.phase, "insurance")
  s = ok(BJ.insurance(s, false))
  assert.equal(s.hands[0].result, "push")
  assert.equal(s.returned, 10)
})

test("insurance pays 2:1 when the dealer has blackjack, and is lost when not", () => {
  let s = ok(BJ.deal(rigged("9S AD 8H KC"), 10))
  assert.equal(BJ.canInsure(s, 100), true)
  s = ok(BJ.insurance(s, true))
  assert.equal(s.staked, 15)
  assert.equal(s.phase, "done")
  assert.equal(s.returned, 15) // insurance 5 back + 10 win; the hand loses
  assert.equal(s.result.net, 0)
  s = ok(BJ.insurance(ok(BJ.deal(rigged("9S AD 8H 6C TC"), 10)), true))
  assert.equal(s.phase, "player")
  assert.equal(s.staked, 15)
  s = ok(BJ.stand(s))
  // dealer 17 (A+6 soft 17 stands by default) vs 17: push 10, insurance lost
  assert.equal(s.hands[0].result, "push")
  assert.equal(s.returned, 10)
})

test("the dealer stands on soft 17 by default and hits it with h17", () => {
  let s = ok(BJ.stand(ok(BJ.deal(rigged("TS 6D 8H AC 4C"), 10))))
  assert.equal(BJ.handValue(s.dealer).total, 17)
  assert.equal(s.hands[0].result, "win")
  s = ok(BJ.stand(ok(BJ.deal(rigged("TS 6D 8H AC 4C", { h17: true }), 10))))
  // soft 17 -> hits the 4: 21
  assert.equal(BJ.handValue(s.dealer).total, 21)
  assert.equal(s.hands[0].result, "lose")
})

test("hit to bust, double for one card", () => {
  let s = ok(BJ.deal(rigged("TS 9D 5H 8C KC"), 10))
  s = ok(BJ.hit(s))
  assert.equal(s.hands[0].result, "bust")
  assert.equal(s.phase, "done")
  // the dealer doesn't draw against a bust
  assert.equal(s.dealer.length, 2)
  s = ok(BJ.deal(rigged("6S 9D 5H 7C KC TD"), 10))
  assert.equal(BJ.canDouble(s, 10), true)
  assert.equal(BJ.canDouble(s, 9), false)
  s = ok(BJ.double(s, 100))
  assert.equal(s.staked, 20)
  assert.equal(s.hands[0].cards.length, 3)
  assert.equal(s.hands[0].result, "win") // 21; the dealer's 16 draws a ten and busts
})

test("splitting: two hands, split aces get one card each and 21 isn't blackjack", () => {
  // 8 8 vs 6: split, each hand gets a card as it's played
  let s = ok(BJ.deal(rigged("8S 6D 8H TC 3C 2D TD 9H"), 10))
  assert.equal(BJ.canSplit(s, 10), true)
  s = ok(BJ.split(s, 100))
  assert.equal(s.hands.length, 2)
  assert.equal(s.staked, 20)
  assert.deepEqual(s.hands[0].cards.map((c) => c.id), ["8S", "3C"])
  // double after split is allowed by default
  assert.equal(BJ.canDouble(s, 100), true)
  s = ok(BJ.hit(s)) // 8 3 2 = 13
  s = ok(BJ.stand(s))
  assert.equal(s.active, 1)
  assert.deepEqual(s.hands[1].cards.map((c) => c.id), ["8H", "TD"])
  s = ok(BJ.stand(s))
  // dealer 16 draws the 9: bust, both hands win
  assert.equal(s.phase, "done")
  assert.deepEqual(s.hands.map((h) => h.result), ["win", "win"])
  assert.equal(s.returned, 40)

  // aces: one card each, done, and A+K pays even money
  s = ok(BJ.deal(rigged("AS 9D AH 8C KC 5D"), 10))
  s = ok(BJ.split(s, 100))
  assert.equal(s.phase, "done")
  assert.deepEqual(s.hands.map((h) => h.cards.length), [2, 2])
  assert.equal(s.hands[0].result, "win") // A K = 21 vs 17, paid 1:1
  assert.equal(s.hands[0].payout, 20)
  // no re-splitting aces; no double on split aces
  s = ok(BJ.deal(rigged("AS 9D AH 8C AC 5D"), 10))
  assert.equal(BJ.canSplit(s), true)
  const t = ok(BJ.split(s, 100))
  assert.equal(t.hands.length, 2)
  assert.equal(t.phase, "done")
})

test("split up to four hands, and only as many as you can afford", () => {
  let s = ok(BJ.deal(rigged("8S 6D 8H TC 8C 8D 2C 2D 2H 2S"), 10))
  assert.equal(BJ.canSplit(s, 9), false)
  s = ok(BJ.split(s, 100)) // 8S 8C
  s = ok(BJ.split(s, 100)) // 8S 8D
  s = ok(BJ.split(s, 100))
  assert.equal(s.hands.length, 4)
  assert.equal(BJ.canSplit(s, 100), false)
  assert.equal(s.staked, 40)
})

test("late surrender gives back half, when the table allows it", () => {
  let s = ok(BJ.deal(rigged("TS TD 6H 7C"), 10))
  assert.equal(BJ.canSurrender(s), false)
  s = ok(BJ.deal(rigged("TS TD 6H 7C", { surrender: true }), 10))
  s = ok(BJ.surrender(s))
  assert.equal(s.hands[0].result, "surrender")
  assert.equal(s.returned, 5)
})

test("the shoe reshuffles at the cut card; a full round never runs dry", () => {
  let t = BJ.createTable({}, seeded(3))
  t.shoe = t.shoe.slice(0, 60)
  const s = ok(BJ.deal(t, 10, seeded(4)))
  assert.equal(s.reshuffled, true)
  assert.ok(s.shoe.length > 300)
  // many rounds of basic strategy keep the books straight
  let table = BJ.createTable({}, seeded(9))
  let bank = 100000
  const rnd = seeded(10)
  for (let i = 0; i < 2000; i++) {
    bank -= 10
    table = ok(BJ.deal(table, 10, rnd))
    if (table.phase === "insurance") table = ok(BJ.insurance(table, false, Infinity, rnd))
    while (table.phase === "player") {
      const h = BJ.hint(table)
      const before = table.staked
      if (h === "split") table = ok(BJ.split(table, Infinity, rnd))
      else if (h === "double") table = ok(BJ.double(table, Infinity, rnd))
      else if (h === "stand") table = ok(BJ.stand(table, rnd))
      else table = ok(BJ.hit(table, rnd))
      bank -= table.staked - before
    }
    bank += table.returned
  }
  // basic strategy loses about half a percent: 2000 hands of 10 stay within a few hundred
  assert.ok(Math.abs(bank - 100000) < 2500, `bank ${bank}`)
})

// ---------- Roulette ----------

test("roulette: payouts for every kind of bet", () => {
  const bet = (kind, numbers, amount = 10) => {
    const b = R.makeBet(kind, numbers, amount, numbers.includes(R.DOUBLE_ZERO) ? "american" : "european")
    assert.ok(!b.error, b.error)
    return b
  }
  assert.equal(R.payout(bet("straight", [17]), 17), 360)
  assert.equal(R.payout(bet("straight", [17]), 18), 0)
  assert.equal(R.payout(bet("split", [17, 20]), 20), 180)
  assert.equal(R.payout(bet("street", [16, 17, 18]), 16), 120)
  assert.equal(R.payout(bet("corner", [17, 18, 20, 21]), 21), 90)
  assert.equal(R.payout(bet("line", [16, 17, 18, 19, 20, 21]), 19), 60)
  assert.equal(R.payout(bet("dozen", R.dozen(1)), 24), 30)
  assert.equal(R.payout(bet("column", R.column(0)), 34), 30)
  assert.equal(R.payout(bet("red", R.OUTSIDE.red.numbers), 32), 20)
  assert.equal(R.payout(bet("black", R.OUTSIDE.black.numbers), 32), 0)
  // zero loses the outside bets
  for (const k of ["red", "black", "odd", "even", "low", "high"]) assert.equal(R.payout(bet(k, R.OUTSIDE[k].numbers), 0), 0)
  assert.equal(R.payout(bet("basket", R.BASKET), R.DOUBLE_ZERO), 70)
  assert.ok(R.makeBet("basket", R.BASKET, 10, "european").error)
  assert.equal(R.payout(R.makeBet("first4", R.FIRST4, 10, "european"), 0), 90)
  assert.ok(R.makeBet("straight", [1], 0).error)
})

test("roulette: the layout's splits, streets, corners and lines", () => {
  assert.deepEqual(R.splitOf(17, 20), [17, 20])
  assert.deepEqual(R.splitOf(17, 18), [17, 18])
  assert.equal(R.splitOf(18, 19), null) // 18 is top of its column, 19 bottom of the next
  assert.equal(R.splitOf(17, 21), null)
  assert.deepEqual(R.splitOf(0, 2), [0, 2])
  assert.equal(R.splitOf(0, 5), null)
  assert.deepEqual(R.splitOf(0, R.DOUBLE_ZERO, "american"), [0, R.DOUBLE_ZERO])
  assert.deepEqual(R.splitOf(R.DOUBLE_ZERO, 3, "american"), [3, R.DOUBLE_ZERO])
  assert.deepEqual(R.insideBet("street", 17), [16, 17, 18])
  assert.deepEqual(R.insideBet("corner", 17), [16, 17, 19, 20])
  assert.deepEqual(R.insideBet("corner", 18), [17, 18, 20, 21])
  assert.deepEqual(R.insideBet("corner", 36), [32, 33, 35, 36])
  assert.deepEqual(R.insideBet("corner", 34), [31, 32, 34, 35])
  assert.deepEqual(R.insideBet("line", 35), [31, 32, 33, 34, 35, 36])
  assert.deepEqual(R.insideBet("line", 1), [1, 2, 3, 4, 5, 6])
  // every corner is four numbers that really touch
  for (let n = 1; n <= 36; n++) {
    const c = R.insideBet("corner", n)
    assert.equal(new Set(c).size, 4)
    assert.ok(c.includes(n))
  }
})

test("roulette: the wheels have every pocket once; spins land on them evenly; the edge is right", () => {
  assert.equal(R.WHEELS.european.length, 37)
  assert.equal(R.WHEELS.american.length, 38)
  assert.equal(new Set(R.WHEELS.american).size, 38)
  assert.deepEqual([...R.WHEELS.european].sort((a, b) => a - b), Array.from({ length: 37 }, (_, i) => i))
  // the wheel's colors alternate red/black away from zero
  const eu = R.WHEELS.european.slice(1)
  for (let i = 1; i < eu.length; i++) assert.notEqual(R.colorOf(eu[i]), R.colorOf(eu[i - 1]))
  // expected return of a straight bet: 36/37 and 36/38
  const ev = (wheel) => R.WHEELS[wheel].reduce((s, n) => s + R.payout({ kind: "straight", numbers: [17], amount: 1 }, n), 0) / R.WHEELS[wheel].length
  assert.ok(Math.abs(ev("european") - 36 / 37) < 1e-9)
  assert.ok(Math.abs(ev("american") - 36 / 38) < 1e-9)
  const out = R.settleAll([{ kind: "red", numbers: R.OUTSIDE.red.numbers, amount: 10 }, { kind: "straight", numbers: [3], amount: 5 }], 3)
  assert.equal(out.returned, 20 + 180)
  assert.equal(out.net, 185)
})

// ---------- Slots ----------

test("slots: the paytable, wilds and cherries", () => {
  assert.equal(S.linePay(["wild", "wild", "wild"]), S.PAYS.wild)
  assert.equal(S.linePay(["seven", "seven", "seven"]), S.PAYS.seven)
  assert.equal(S.linePay(["seven", "wild", "seven"]), S.PAYS.seven)
  assert.equal(S.linePay(["wild", "bell", "wild"]), S.PAYS.bell)
  assert.equal(S.linePay(["blank", "blank", "blank"]), 0)
  assert.equal(S.linePay(["wild", "blank", "wild"]), 0)
  assert.equal(S.linePay(["cherry", "cherry", "bell"]), S.CHERRY_TWO)
  assert.equal(S.linePay(["cherry", "bell", "bell"]), S.CHERRY_ONE)
  assert.equal(S.linePay(["bell", "cherry", "cherry"]), 0)
  assert.equal(S.linePay(["cherry", "cherry", "cherry"]), S.PAYS.cherry)
})

test("slots: lines pay on the rows they cover; the return is a fair-ish 92-97%", () => {
  const r = S.rtp()
  assert.ok(r.rtp > 0.92 && r.rtp < 0.97, `rtp ${r.rtp}`)
  assert.ok(r.hitRate > 0.15)
  // find stops showing three sevens across the middle
  const sevenAt = (reel) => S.REELS[reel].indexOf("seven")
  const stops = [sevenAt(0), sevenAt(1), sevenAt(2)]
  const one = S.evaluateSpin(stops, 1, 5)
  assert.equal(one.cost, 5)
  assert.ok(one.wins.some((w) => w.line === 0 && w.pay === S.PAYS.seven * 5))
  const five = S.evaluateSpin(stops, 5, 1)
  assert.equal(five.cost, 5)
  assert.equal(five.shown.length, 3)
  // a long run lands near the computed return
  const rnd = seeded(5)
  let paid = 0
  let cost = 0
  for (let i = 0; i < 60000; i++) {
    const out = S.evaluateSpin(S.spin(rnd), 5, 1)
    paid += out.total
    cost += out.cost
  }
  assert.ok(Math.abs(paid / cost - r.rtp) < 0.06, `simulated ${paid / cost}`)
})

// ---------- Video Poker ----------

test("video poker: Jacks or Better pays the 9/6 table", () => {
  const pay = (text, coins = 1) => VP.payFor(parseAll(text), coins).win
  assert.equal(pay("AS KS QS JS TS", 5), 4000)
  assert.equal(pay("AS KS QS JS TS", 4), 1000)
  assert.equal(pay("9H 8H 7H 6H 5H"), 50)
  assert.equal(pay("7C 7D 7H 7S KD"), 25)
  assert.equal(pay("KC KD KH 4S 4D"), 9)
  assert.equal(pay("2H 9H JH 4H 6H"), 6)
  assert.equal(pay("AC 2D 3H 4S 5D"), 4)
  assert.equal(pay("QC QD QH 4S 9D"), 3)
  assert.equal(pay("3C 3D 4H 4S AD"), 2)
  assert.equal(pay("JC JD 4H 8S AD"), 1)
  assert.equal(pay("TC TD 4H 8S AD"), 0)
  assert.equal(pay("AC JD 4H 8S 9D"), 0)
  assert.equal(VP.payFor(parseAll("JC JD 4H 8S AD"), 3, 5).win, 15)
})

test("video poker: deal, hold and draw from the same deck", () => {
  const d = VP.deal(seeded(2))
  assert.equal(d.hand.length, 5)
  assert.equal(d.deck.length, 47)
  const after = VP.draw(d, [true, false, true, false, false])
  assert.equal(after.hand[0], d.hand[0])
  assert.equal(after.hand[2], d.hand[2])
  const ids = new Set([...after.hand, ...after.deck].map((c) => c.id))
  assert.equal(ids.size, 49) // 3 discarded cards are gone
  assert.ok(after.hand.every((c) => !d.hand.includes(c) || [d.hand[0], d.hand[2]].includes(c)))
  // the hint keeps made hands and high pairs
  assert.deepEqual(VP.hint(parseAll("JC JD 4H 8S AD")), [true, true, false, false, false])
  assert.deepEqual(VP.hint(parseAll("AS KS QS JS 2D")), [true, true, true, true, false])
  assert.deepEqual(VP.hint(parseAll("2H 9H JH 4H 6C")), [true, true, true, true, false])
})

// ---------- Craps ----------

const bet = (s, b) => {
  const out = C.placeBet(s, b)
  assert.ok(!out.error, out.error)
  return out
}

test("craps: the pass line on the come-out roll and with a point", () => {
  let s = bet(C.newTable(), { kind: "pass", amount: 10 })
  let r = C.resolve(s, [3, 4])
  assert.equal(r.returned, 20)
  r = C.resolve(s, [1, 1])
  assert.equal(r.returned, 0)
  r = C.resolve(s, [2, 2]) // point 4
  assert.equal(r.state.point, 4)
  assert.equal(r.returned, 0)
  s = bet(r.state, { kind: "passodds", amount: 30 }) // 3x on a 4
  assert.ok(C.placeBet(s, { kind: "passodds", amount: 1 }).error)
  const hit = C.resolve(s, [1, 3])
  // pass 10 -> 20; odds 30 at 2:1 -> 90
  assert.equal(hit.returned, 110)
  assert.equal(hit.state.point, null)
  const seven = C.resolve(s, [3, 4])
  assert.equal(seven.returned, 0)
  assert.equal(seven.state.bets.length, 0)
})

test("craps: odds pay true odds on every point (pass and don't)", () => {
  for (const [point, dice, odds, back] of [
    [5, [2, 3], 20, 20 + 30],
    [6, [3, 3], 25, 25 + 30],
    [8, [4, 4], 25, 25 + 30],
    [9, [4, 5], 20, 20 + 30],
    [10, [4, 6], 20, 20 + 40],
  ]) {
    let s = bet(C.newTable(), { kind: "pass", amount: 10 })
    s = C.resolve(s, dice).state
    assert.equal(s.point, point)
    s = bet(s, { kind: "passodds", amount: odds })
    assert.equal(C.resolve(s, dice).returned, 20 + back)
  }
  // don't pass with laid odds on a 4: lay 40 to win 20
  let s = bet(C.newTable(), { kind: "dontpass", amount: 10 })
  s = C.resolve(s, [2, 2]).state
  s = bet(s, { kind: "dontodds", amount: 40 })
  assert.equal(C.resolve(s, [3, 4]).returned, 20 + 60)
  assert.equal(C.resolve(s, [1, 3]).returned, 0)
})

test("craps: don't pass bars 12; field and place bets", () => {
  const s = bet(C.newTable(), { kind: "dontpass", amount: 10 })
  const twelve = C.resolve(s, [6, 6])
  assert.equal(twelve.returned, 0)
  assert.equal(twelve.state.bets.length, 1) // a push: still there
  assert.equal(C.resolve(s, [1, 2]).returned, 20)
  assert.equal(C.resolve(s, [5, 6]).returned, 0)
  // field
  const f = bet(C.newTable(), { kind: "field", amount: 10 })
  assert.equal(C.resolve(f, [1, 1]).returned, 30)
  assert.equal(C.resolve(f, [6, 6]).returned, 40)
  assert.equal(C.resolve(f, [4, 5]).returned, 20)
  assert.equal(C.resolve(f, [3, 4]).returned, 0)
  assert.equal(C.resolve(f, [3, 4]).state.bets.length, 0)
  // place 6 for 12 pays 14 and stays up; off on the come-out
  let p = bet(bet(C.newTable(), { kind: "pass", amount: 5 }), { kind: "place", number: 6, amount: 12 })
  const comeOut = C.resolve(p, [3, 3]) // sets the point at 6, place is off
  assert.equal(comeOut.returned, 0)
  p = comeOut.state
  const p2 = bet(p, { kind: "place", number: 9, amount: 10 })
  const nine = C.resolve(p2, [4, 5])
  assert.equal(nine.returned, 14)
  assert.ok(nine.state.bets.some((b) => b.kind === "place" && b.number === 9))
  assert.equal(C.resolve(p2, [3, 4]).state.bets.length, 0)
})

test("craps: come bets travel to their number and take odds", () => {
  let s = bet(C.newTable(), { kind: "pass", amount: 10 })
  assert.ok(C.placeBet(s, { kind: "come", amount: 10 }).error) // no point yet
  s = C.resolve(s, [4, 4]).state // point 8
  s = bet(s, { kind: "come", amount: 10 })
  const moved = C.resolve(s, [2, 3]) // the come bet goes to 5
  assert.ok(moved.results.some((r) => r.outcome === "move"))
  s = moved.state
  assert.ok(s.bets.some((b) => b.kind === "come" && b.number === 5))
  s = bet(s, { kind: "comeodds", number: 5, amount: 40 })
  assert.ok(C.placeBet(s, { kind: "comeodds", number: 5, amount: 1 }).error)
  const five = C.resolve(s, [1, 4])
  assert.equal(five.returned, 20 + 40 + 60)
  // a contract bet can't come down; a don't bet can
  assert.equal(C.canRemove(s, s.bets.find((b) => b.kind === "pass")), false)
})

test("craps: a long session keeps chips straight", () => {
  const rnd = seeded(12)
  let s = C.newTable()
  let bank = 10000
  for (let i = 0; i < 3000; i++) {
    if (!s.point && !s.bets.some((b) => b.kind === "pass")) {
      s = bet(s, { kind: "pass", amount: 10 })
      bank -= 10
    }
    if (s.point && !s.bets.some((b) => b.kind === "passodds")) {
      const max = C.maxOdds(s, "passodds")
      if (max) {
        s = bet(s, { kind: "passodds", amount: max })
        bank -= max
      }
    }
    const r = C.resolve(s, C.rollDice(rnd))
    bank += r.returned
    s = r.state
  }
  bank += C.onTable(s)
  // the pass line with full odds is about 0.4% to the house
  assert.ok(Math.abs(bank - 10000) < 2500, `bank ${bank}`)
})

// ---------- Baccarat ----------

test("baccarat: points, naturals and the banker's third-card table", () => {
  assert.equal(B.total(parseAll("KS 9D")), 9)
  assert.equal(B.total(parseAll("7S 8D")), 5)
  assert.equal(B.total(parseAll("AS TD QC")), 1)
  // the table, row by row
  const draws = (bt, p3) => B.bankerDraws(bt, p3 == null ? null : { rank: p3 === 0 ? 10 : p3, suit: 0 })
  for (let p3 = 0; p3 <= 9; p3++) {
    assert.equal(draws(2, p3), true)
    assert.equal(draws(3, p3), p3 !== 8)
    assert.equal(draws(4, p3), p3 >= 2 && p3 <= 7)
    assert.equal(draws(5, p3), p3 >= 4 && p3 <= 7)
    assert.equal(draws(6, p3), p3 === 6 || p3 === 7)
    assert.equal(draws(7, p3), false)
  }
  // the player stood: the banker draws on 0-5
  assert.equal(draws(5, null), true)
  assert.equal(draws(6, null), false)
})

test("baccarat: coups follow the rules", () => {
  // shoe pops from the end: P1 B1 P2 B2 then thirds
  const shoe = (text) => parseAll(text).reverse()
  // natural 9 for the player: nobody draws
  let c = B.coup(shoe("4S 3D 5H 4C 9D 9C"))
  assert.equal(c.natural, true)
  assert.equal(c.player.length, 2)
  assert.equal(c.winner, "player")
  // player 5 draws a 4 (9); banker 4 draws on a 4: KD -> 4
  c = B.coup(shoe("2S 2D 3H 2C 4D KC"))
  assert.equal(c.player.length, 3)
  assert.equal(c.banker.length, 3)
  assert.equal(c.playerTotal, 9)
  assert.equal(c.bankerTotal, 4)
  // player stands on 7; banker 5 draws
  c = B.coup(shoe("3S 2D 4H 3C 2D"))
  assert.equal(c.player.length, 2)
  assert.equal(c.banker.length, 3)
  assert.equal(c.bankerTotal, 7)
  assert.equal(c.winner, "tie")
  // banker 3 doesn't draw on the player's 8
  c = B.coup(shoe("AS 2D 4H AC 8D 5C"))
  assert.equal(c.player.length, 3)
  assert.equal(c.banker.length, 2)
})

test("baccarat: banker pays 19:20, tie 8:1 and pushes the others", () => {
  assert.equal(B.settle({ banker: 20 }, "banker").returned, 39)
  assert.equal(B.settle({ banker: 100 }, "banker").returned, 195)
  assert.equal(B.settle({ player: 20 }, "player").returned, 40)
  assert.equal(B.settle({ tie: 10 }, "tie").returned, 90)
  assert.equal(B.settle({ player: 10, banker: 10 }, "tie").returned, 20)
  assert.equal(B.settle({ player: 10, tie: 5 }, "banker").returned, 0)
  const rnd = seeded(7)
  let shoe = B.newShoeFor(rnd)
  const wins = { player: 0, banker: 0, tie: 0 }
  const N = 60000
  for (let i = 0; i < N; i++) {
    if (B.shoeLow(shoe)) shoe = B.newShoeFor(rnd)
    const c = B.coup(shoe)
    shoe = c.shoe
    wins[c.winner]++
  }
  // the banker wins about 45.9%, the player 44.6%, ties 9.5%
  assert.ok(Math.abs(wins.banker / N - 0.4586) < 0.012, `banker ${wins.banker / N}`)
  assert.ok(Math.abs(wins.player / N - 0.4462) < 0.012, `player ${wins.player / N}`)
  assert.ok(Math.abs(wins.tie / N - 0.0952) < 0.01, `tie ${wins.tie / N}`)
})

// ---------- the chip bank ----------

const memory = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

test("the chip bank: take, give, refill, and it's saved", () => {
  const store = memory()
  const bank = createBank(store)
  assert.equal(bank.balance, START)
  assert.equal(bank.take(300), true)
  assert.equal(bank.take(800), false)
  assert.equal(bank.balance, 700)
  bank.give(600, 300)
  assert.equal(bank.balance, 1300)
  assert.equal(bank.data.biggestWin, 300)
  assert.equal(createBank(store).balance, 1300)
  assert.equal(bank.refill(), false) // not broke
  bank.take(1298)
  assert.equal(bank.needsRefill(), true)
  assert.equal(bank.refill(), true)
  assert.equal(bank.balance, START)
  assert.equal(bank.data.refills, 1)
  let heard = 0
  bank.subscribe(() => heard++)
  bank.take(1)
  assert.equal(heard, 1)
})
