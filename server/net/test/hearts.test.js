const test = require("node:test")
const assert = require("node:assert/strict")
const h = require("../hearts")

// Deterministic shuffles for repeatable tests
const rng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

// A hand-built state in the middle of play
const playing = (hands, extra = {}) => ({
  ...h.newGame(),
  hands,
  direction: "none",
  passes: [null, null, null, null],
  received: [[], [], [], []],
  trick: [],
  leader: 0,
  turn: 0,
  taken: [[], [], [], []],
  tricks: 1,
  heartsBroken: false,
  lastTrick: null,
  phase: "playing",
  ...extra,
})

test("deal: 13 cards each, a whole deck, pass direction cycles", () => {
  let g = h.deal(h.newGame(), rng(1))
  assert.equal(g.hands.flat().length, 52)
  assert.equal(new Set(g.hands.flat()).size, 52)
  assert.ok(g.hands.every((hand) => hand.length === 13))
  assert.equal(g.direction, "left")
  assert.equal(g.phase, "passing")
  assert.deepEqual([0, 1, 2, 3].map((n) => h.PASSES[n]), ["left", "right", "across", "none"])
  // hand 4 has no passing: play starts right away
  g = h.deal({ ...h.newGame(), hand: 3 }, rng(2))
  assert.equal(g.direction, "none")
  assert.equal(g.phase, "playing")
  assert.ok(g.hands[g.turn].includes("2C"))
})

test("pass targets", () => {
  assert.deepEqual([0, 1, 2, 3].map((s) => h.passTarget(s, "left")), [1, 2, 3, 0])
  assert.deepEqual([0, 1, 2, 3].map((s) => h.passTarget(s, "right")), [3, 0, 1, 2])
  assert.deepEqual([0, 1, 2, 3].map((s) => h.passTarget(s, "across")), [2, 3, 0, 1])
})

test("passing swaps three cards each way once everyone has chosen", () => {
  let g = h.deal(h.newGame(), rng(3))
  const chosen = g.hands.map((hand) => hand.slice(0, 3))
  assert.equal(h.setPass(g, 0, chosen[0].slice(0, 2)).ok, false)
  assert.equal(h.setPass(g, 0, [chosen[0][0], chosen[0][0], chosen[0][1]]).ok, false)
  assert.equal(h.setPass(g, 0, chosen[1]).ok, false) // not your cards
  for (let s = 0; s < 4; s++) {
    const r = h.setPass(g, s, chosen[s])
    assert.ok(r.ok, r.error)
    g = r.state
    if (s < 3) assert.equal(g.phase, "passing")
  }
  assert.equal(g.phase, "playing")
  for (let s = 0; s < 4; s++) {
    const from = (s + 3) % 4 // passing left: you get the cards of the player on your right
    for (const c of chosen[from]) assert.ok(g.hands[s].includes(c))
    for (const c of chosen[s]) assert.ok(!g.hands[s].includes(c))
    assert.equal(g.hands[s].length, 13)
  }
  assert.ok(g.hands[g.turn].includes("2C"))
})

test("2 of clubs leads; no points on the first trick", () => {
  const hands = [
    ["2C", "3C", "4D", "5D", "6D", "7D", "8D", "9D", "TD", "JD", "QD", "KD", "AD"],
    ["QS", "2H", "3H", "4H", "5H", "6H", "7H", "8H", "9H", "TH", "JH", "QH", "2D"],
    ["4C", "AS", "KS", "JS", "TS", "9S", "8S", "7S", "6S", "5S", "4S", "3S", "2S"],
    ["5C", "6C", "7C", "8C", "9C", "TC", "JC", "QC", "KC", "AC", "KH", "AH", "3D"],
  ]
  let g = playing(hands, { tricks: 0 })
  assert.deepEqual(h.legalPlays(g, 0), ["2C"])
  assert.equal(h.play(g, 0, "3C").ok, false)
  g = h.play(g, 0, "2C").state
  // seat 1 has no clubs: may not dump the queen or hearts while holding a diamond
  assert.deepEqual(h.legalPlays(g, 1), ["2D"])
  assert.equal(h.play(g, 1, "QS").ok, false)
  g = h.play(g, 1, "2D").state
  assert.deepEqual(h.legalPlays(g, 2), ["4C"])
  g = h.play(g, 2, "4C").state
  g = h.play(g, 3, "5C").state
  assert.equal(g.phase, "trickEnd")
  g = h.collectTrick(g)
  assert.equal(g.leader, 3)
  assert.equal(g.turn, 3)
  assert.deepEqual(g.taken[3].sort(), ["2C", "2D", "4C", "5C"].sort())
})

test("first trick: only point cards left means you may play them", () => {
  const g = playing(
    [["2C"], ["QS", "2H"], ["3C"], ["4C"]],
    { tricks: 0, trick: [{ seat: 0, card: "2C" }], turn: 1 }
  )
  assert.deepEqual(h.legalPlays(g, 1), ["2H"])
})

test("hearts can't be led until broken (unless that's all you have)", () => {
  let g = playing([["2H", "3D"], ["4D"], ["5D"], ["6D"]])
  assert.deepEqual(h.legalPlays(g, 0), ["3D"])
  g = playing([["2H", "3H"], ["4D"], ["5D"], ["6D"]])
  assert.deepEqual(h.legalPlays(g, 0), ["2H", "3H"])
  g = playing([["2H", "3D"], ["4D"], ["5D"], ["6D"]], { heartsBroken: true })
  assert.deepEqual(h.legalPlays(g, 0).sort(), ["2H", "3D"])
  // a heart played on a trick breaks hearts
  g = playing([["3D", "9C"], ["2H", "KC"], ["5D"], ["6D"]])
  g = h.play(g, 0, "3D").state
  g = h.play(g, 1, "2H").state
  assert.ok(g.heartsBroken)
})

test("must follow suit; highest card of the led suit wins", () => {
  let g = playing([["3D", "AS"], ["KD", "2S"], ["AC", "QD"], ["AD", "4S"]])
  g = h.play(g, 0, "3D").state
  assert.deepEqual(h.legalPlays(g, 1), ["KD"])
  g = h.play(g, 1, "KD").state
  assert.deepEqual(h.legalPlays(g, 2), ["QD"])
  g = h.play(g, 2, "QD").state
  g = h.play(g, 3, "AD").state
  assert.equal(h.trickWinner(g.trick), 3)
  assert.equal(h.play(g, 0, "AS").ok, false) // trick is over
})

test("scoring: hearts 1, queen of spades 13, game over at 100", () => {
  const taken = [["QS", "2H", "3H"], ["4H"], [], ["2C", "5H", "6H", "7H", "8H", "9H", "TH", "JH", "QH", "KH", "AH"]]
  const g = h.scoreHand({ ...playing([[], [], [], []]), taken, tricks: 13, scores: [10, 20, 30, 40] })
  assert.deepEqual(g.handPoints, [15, 1, 0, 10])
  assert.deepEqual(g.scores, [25, 21, 30, 50])
  assert.equal(g.phase, "handOver")
  assert.equal(g.moon, null)

  const over = h.scoreHand({ ...playing([[], [], [], []]), taken, tricks: 13, scores: [90, 20, 21, 60] })
  assert.equal(over.phase, "gameOver")
  assert.deepEqual(over.winners, [1, 2]) // a tie for lowest
})

test("shooting the moon gives everyone else 26", () => {
  const all = ["QS", ...h.deck().filter((c) => c[1] === "H")]
  const g = h.scoreHand({ ...playing([[], [], [], []]), taken: [[], all, [], ["2C"]], tricks: 13, scores: [0, 0, 0, 0] })
  assert.equal(g.moon, 1)
  assert.deepEqual(g.handPoints, [26, 0, 26, 26])
})

test("bots play whole games legally to 100", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const random = rng(seed)
    let g = h.deal(h.newGame(), random)
    let guard = 0
    while (g.phase !== "gameOver" && guard++ < 5000) {
      if (g.phase === "passing") {
        for (let s = 0; s < 4; s++) {
          const pick = h.botPass(g.hands[s])
          assert.equal(new Set(pick).size, 3)
          const r = h.setPass(g, s, pick)
          assert.ok(r.ok, r.error)
          g = r.state
        }
      } else if (g.phase === "playing") {
        const card = h.botPlay(g, g.turn)
        assert.ok(h.legalPlays(g, g.turn).includes(card), `illegal bot play ${card}`)
        g = h.play(g, g.turn, card).state
      } else if (g.phase === "trickEnd") {
        g = h.collectTrick(g)
      } else if (g.phase === "handOver") {
        const last = g.history.at(-1)
        const sum = last.reduce((a, b) => a + b, 0)
        assert.ok(sum === 26 || sum === 78, `hand points ${last}`)
        g = h.deal(g, random)
      }
    }
    assert.equal(g.phase, "gameOver")
    assert.ok(Math.max(...g.scores) >= 100)
    assert.ok(g.winners.every((w) => g.scores[w] === Math.min(...g.scores)))
  }
})

test("bot passing gets rid of the queen and high spades when short", () => {
  const pass = h.botPass(["QS", "AS", "KS", "2C", "3C", "4C", "5D", "6D", "7D", "8D", "9H", "TH", "2H"])
  assert.deepEqual(pass.sort(), ["AS", "KS", "QS"])
})

test("bots duck under the winning card and dump the queen when void", () => {
  let g = playing([["9D", "2S"], ["TD", "QS", "3D"], ["2C"], ["2D"]], { trick: [{ seat: 0, card: "9D" }], turn: 1 })
  assert.equal(h.botPlay(g, 1), "3D")
  g = playing([["9D"], ["QS", "AS", "2C"], ["2D"], ["3D"]], { trick: [{ seat: 0, card: "9D" }], turn: 1 })
  assert.equal(h.botPlay(g, 1), "QS")
})
