// Engine tests for Solitaire and FreeCell. Run: node --test client/src/components/applets/cards/
import test from "node:test"
import assert from "node:assert/strict"
import { cardName, msDeal, newDeck, parseCard } from "./deck.js"
import * as K from "./klondike.js"
import * as F from "./freecellEngine.js"

const rows = (state) => {
  const out = []
  for (let r = 0; r < 7; r++) out.push(state.columns.map((c) => (c[r] ? cardName(c[r]) : "")).filter(Boolean).join(" "))
  return out
}

// A seeded random so Klondike deals repeat
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646

// Build a Klondike position by hand
const kState = (patch) => ({
  draw: 1,
  scoring: "standard",
  stock: [],
  waste: [],
  fan: 0,
  foundations: [[], [], [], []],
  tableau: [[], [], [], [], [], [], []],
  score: 0,
  passes: 1,
  moves: 0,
  ...patch,
})
const cards = (names, up = true) => names.split(" ").filter(Boolean).map((n) => parseCard(n, up))
const fullSuit = (suit) => cards("A2345678" .split("").concat(["9", "T", "J", "Q", "K"]).map((r) => r + suit).join(" "))

// ---------------- deck ----------------

test("a deck has 52 different cards", () => {
  const deck = newDeck()
  assert.equal(deck.length, 52)
  assert.equal(new Set(deck.map((c) => c.id)).size, 52)
})

// ---------------- FreeCell deals ----------------

test("FreeCell game #1 matches Microsoft's layout", () => {
  assert.deepEqual(rows(F.dealGame(1)), [
    "JD 2D 9H JC 5D 7H 7C 5H",
    "KD KC 9S 5S AD QC KH 3H",
    "2S KS 9D QD JS AS AH 3C",
    "4C 5C TS QH 4H AC 4D 7S",
    "3S TD 4S TH 8H 2C JH 7D",
    "6D 8S 8D QS 6C 3D 8C TC",
    "6S 9C 2H 6H",
  ])
})

test("FreeCell game #617 matches Microsoft's layout", () => {
  assert.deepEqual(rows(F.dealGame(617)), [
    "7D AD 5C 3S 5S 8C 2D AH",
    "TD 7S QD AC 6D 8H AS KH",
    "TH QC 3H 9D 6S 8D 3D TC",
    "KD 5H 9S 3C 8S 7H 4D JS",
    "4C QS 9C 9H 7C 6H 2C 2S",
    "4S TS 2H 5D JC 6C JH QH",
    "JD KS KC 4H",
  ])
})

test("every FreeCell deal uses the whole deck", () => {
  for (const n of [2, 100, 11982, 32000]) assert.equal(new Set(msDeal(n).map((c) => c.id)).size, 52)
})

// ---------------- FreeCell moves ----------------

const fState = (columns, patch = {}) => ({
  game: 0,
  cells: [[], [], [], []],
  homes: [[], [], [], []],
  columns: [...columns.map((c) => cards(c)), ...Array(8 - columns.length).fill(0).map(() => [])],
  moves: 0,
  ...patch,
})

test("FreeCell: alternate colors down, anything on an empty column", () => {
  const s = fState(["KS 9H", "TS", "TD", "8C"])
  assert.ok(F.canMove(s, "t0", 1, "t1")) // 9H on TS
  assert.ok(!F.canMove(s, "t0", 1, "t2")) // 9H on TD: same color
  assert.ok(!F.canMove(s, "t3", 0, "t2")) // 8C on TD: wrong rank
  assert.ok(F.canMove(s, "t3", 0, "t5")) // empty column
  assert.ok(F.canMove(s, "t3", 0, "c0"))
  assert.ok(!F.canMove(s, "t3", 0, "h0")) // only aces start a home cell
})

test("FreeCell supermove limit is (free cells + 1) x 2^(empty columns)", () => {
  // 4 free cells, 4 empty columns
  const s = fState(["KS QH JC TD 9S 8H 7C", "8D", "KH", "KC"])
  assert.equal(F.maxMovable(s), 5 * 16)
  assert.equal(F.maxMovable(s, "t5"), 5 * 8) // the empty destination doesn't count
  const full = fState(["KS QH JC TD 9S 8H 7C", "8D", "KH", "KC", "KD", "QD", "QC", "QS"], {
    cells: [cards("2C"), cards("2D"), [], []],
  })
  assert.equal(F.maxMovable(full), 3)
  assert.ok(F.canMove(full, "t0", 4, "t1") === false) // 9S 8H 7C onto... 8D? no: 9S needs a red 10
  // 3 cards 9S 8H 7C onto a red ten: allowed with 2 cells free
  const ten = fState(["KS QH JC TD 9S 8H 7C", "TH", "KH", "KC", "KD", "QD", "QC", "QS"], { cells: [cards("2C"), cards("2D"), [], []] })
  assert.ok(F.canMove(ten, "t0", 4, "t1"))
  // 4 cards (TD 9S 8H 7C) need 4 > 3: refused
  const jack = fState(["KS QH JC TD 9S 8H 7C", "JS", "KH", "KC", "KD", "QD", "QC", "QS"], { cells: [cards("2C"), cards("2D"), [], []] })
  assert.ok(!F.canMove(jack, "t0", 3, "t1"))
  assert.equal(F.countFor(ten, "t0", "t1"), 3)
})

test("FreeCell: broken runs can't be picked up, home cards stay home", () => {
  const s = fState(["KS 5H 9S 8H"], { homes: [cards("AC"), [], [], []] })
  assert.ok(F.canPickUp(s, "t0", 2))
  assert.ok(!F.canPickUp(s, "t0", 1))
  assert.ok(!F.canPickUp(s, "h0", 0))
})

test("FreeCell auto-move only sends safe cards home", () => {
  const s = fState(["KS AH", "KD 2H", "KC 3H"], { homes: [[], [], [], []] })
  let step = F.autoStep(s)
  assert.equal(step.from, "t0")
  step = F.autoStep(step.state)
  assert.equal(step.from, "t1")
  // 3H isn't safe while black aces aren't home
  assert.equal(F.autoStep(step.state), null)
  const blacks = { ...step.state, homes: [step.state.homes[0], cards("AC 2C"), cards("AS 2S"), []] }
  assert.equal(F.autoStep(blacks).from, "t2")
})

test("FreeCell win detection and no-moves detection", () => {
  const homes = ["C", "D", "H", "S"].map(fullSuit)
  assert.ok(F.isWon(fState([], { homes })))
  // all cells full, nothing fits anywhere
  const stuck = fState(["2D KS", "2C KH", "2H KD", "2S KC", "3D 9D", "3C 9C", "3H 9H", "3S 9S"], {
    cells: [cards("5D"), cards("5C"), cards("6D"), cards("6C")],
  })
  assert.equal(F.legalMoves(stuck).length, 0)
  assert.ok(F.legalMoves(F.dealGame(1)).length > 0)
})

test("FreeCell undo is a state stack: moves never mutate", () => {
  const s = F.dealGame(1)
  const before = JSON.stringify(s)
  const next = F.move(s, "t0", 6, "c0")
  assert.ok(next)
  assert.equal(JSON.stringify(s), before)
  assert.equal(F.cardsLeft(next), 52)
})

// ---------------- Klondike ----------------

test("Klondike deal: 28 in the tableau, the top of each face up, 24 in the stock", () => {
  const s = K.deal({}, seeded(7))
  assert.deepEqual(s.tableau.map((p) => p.length), [1, 2, 3, 4, 5, 6, 7])
  assert.ok(s.tableau.every((p) => p.every((c, i) => c.up === (i === p.length - 1))))
  assert.equal(s.stock.length, 24)
  assert.equal(s.score, 0)
})

test("Klondike legal moves: alternate colors, kings to empty columns, foundations by suit", () => {
  const s = kState({
    tableau: [cards("8S"), cards("7H"), cards("7C"), [], cards("KD"), cards("AD"), cards("2D")],
  })
  assert.ok(K.canMove(s, "t1", 0, "t0"))
  assert.ok(!K.canMove(s, "t2", 0, "t0"))
  assert.ok(!K.canMove(s, "t0", 0, "t3"))
  assert.ok(K.canMove(s, "t4", 0, "t3"))
  assert.ok(K.canMove(s, "t5", 0, "f0"))
  assert.ok(!K.canMove(s, "t6", 0, "f0"))
  const homed = K.move(s, "t5", 0, "f2")
  assert.ok(K.canMove(homed, "t6", 0, "f2"))
  // face-down cards can't move and can't be built on
  const down = kState({ tableau: [[parseCard("8S", false)], cards("7H"), [], [], [], [], []] })
  assert.ok(!K.canMove(down, "t1", 0, "t0"))
  assert.ok(!K.canPickUp(down, "t0", 0))
})

test("Klondike standard scoring", () => {
  let s = kState({ waste: cards("AH 6C"), tableau: [cards("7H"), [parseCard("2S", false), parseCard("9C")], [], [], [], [], []], fan: 2 })
  s = K.move(s, "waste", 1, "t0")
  assert.equal(s.score, 5) // waste to tableau
  s = K.toFoundation(s, "waste")
  assert.equal(s.score, 15) // waste to foundation
  s = K.move(s, "t1", 1, "t2")
  assert.equal(s, null) // 9C isn't a king
  s = kState({ score: 15, foundations: [[], [], cards("AH"), []], tableau: [[parseCard("2S", false)], cards("9C"), [], [], [], [], []] })
  s = K.flip(s, "t0")
  assert.equal(s.score, 20) // turn over
  s = K.move(s, "f2", 0, "t3")
  assert.equal(s, null) // only kings to empty
  s = kState({ score: 20, foundations: [[], [], cards("AH 2H 3H"), []], tableau: [cards("4S"), [], [], [], [], [], []] })
  s = K.move(s, "f2", 2, "t0")
  assert.equal(s.score, 5) // from foundation -15
  s = K.applyTimePenalty(s)
  assert.equal(s.score, 3)
  s = K.applyTimePenalty(K.applyTimePenalty(s))
  assert.equal(s.score, 0) // never below zero
})

test("Klondike recycle penalties: -100 dealing one, -20 after three passes dealing three", () => {
  let one = kState({ waste: cards("2C 3C"), score: 150 })
  one = K.drawStock(one)
  assert.equal(one.score, 50)
  assert.equal(one.stock.length, 2)
  assert.equal(one.passes, 2)
  let three = kState({ draw: 3, waste: cards("2C 3C"), score: 150 })
  three = K.drawStock(three) // pass 2
  three = K.drawStock(K.drawStock(three)) // draw both, recycle: pass 3
  assert.equal(three.score, 150)
  three = K.drawStock(K.drawStock(three)) // pass 4 costs 20
  assert.equal(three.score, 130)
})

test("Klondike draw three deals three and fans them", () => {
  const s = K.drawStock(kState({ draw: 3, stock: cards("2C 3C 4C 5C", false) }))
  assert.deepEqual(s.waste.map((c) => c.id), ["5C", "4C", "3C"])
  assert.equal(s.fan, 3)
  assert.ok(s.waste.every((c) => c.up))
})

test("Vegas: -$52 ante, +$5 a card home, one pass dealing one, three dealing three", () => {
  const s = K.deal({ scoring: "vegas" }, seeded(3))
  assert.equal(s.score, -52)
  let v = kState({ scoring: "vegas", score: -52, waste: cards("AC"), tableau: [cards("AD"), [], [], [], [], [], []] })
  v = K.toFoundation(v, "waste")
  v = K.toFoundation(v, "t0")
  assert.equal(v.score, -42)
  const oneDone = kState({ scoring: "vegas", waste: cards("2C") })
  assert.equal(K.drawStock(oneDone), null)
  const threeTwo = kState({ scoring: "vegas", draw: 3, waste: cards("2C"), passes: 2 })
  assert.ok(K.drawStock(threeTwo))
  assert.equal(K.drawStock({ ...threeTwo, passes: 3 }), null)
  // back from the foundation costs $5
  const back = K.move(kState({ scoring: "vegas", score: 10, foundations: [cards("AC 2C 3C"), [], [], []], tableau: [cards("4D"), [], [], [], [], [], []] }), "f0", 2, "t0")
  assert.equal(back.score, 5)
})

test("Klondike runs move together; win and auto-finish", () => {
  const s = kState({ tableau: [cards("KS QH JC"), [], [], [], [], [], []] })
  const moved = K.move(s, "t0", 0, "t1")
  assert.deepEqual(moved.tableau[1].map((c) => c.id), ["KS", "QH", "JC"])
  // nearly won: kings of each suit left in the tableau
  const near = kState({
    foundations: ["C", "D", "H", "S"].map((suit) => fullSuit(suit).slice(0, 12)),
    tableau: [cards("KC"), cards("KD"), cards("KH"), cards("KS"), [], [], []],
  })
  assert.ok(K.canAutoFinish(near))
  let current = near
  while (K.canAutoFinish(current)) current = K.finishStep(current)
  assert.ok(K.isWon(current))
  assert.equal(current.score, 40)
})

test("Klondike right-click plays everything home", () => {
  const s = kState({ waste: cards("2C"), tableau: [cards("AC"), cards("AD"), [], [], [], [], []] })
  const done = K.autoPlay(s)
  assert.equal(done.foundations.flat().length, 3)
  assert.equal(K.autoPlay(done), null)
})

test("Klondike undo: states are never mutated", () => {
  const s = K.deal({}, seeded(11))
  const snapshot = JSON.stringify(s)
  const next = K.drawStock(s)
  assert.notEqual(next, s)
  assert.equal(JSON.stringify(s), snapshot)
  assert.equal(next.waste.length, 1)
  assert.equal(K.timeBonus(next, 100), 7000)
  assert.equal(K.timeBonus(next, 20), 0)
})
