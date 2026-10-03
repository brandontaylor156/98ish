// Hexlands' rules, board and computer players. Run: node --test client/src/components/applets/hexlands/
import test from "node:test"
import assert from "node:assert/strict"
import { geometry, makeBoard, harborSpots, layoutFlaws, PIPS, TERRAIN_RES } from "./board.js"
import * as L from "./logic.js"
import * as R from "./rules.js"
import { chooseAction, personaFor } from "./bot.js"
import { createLocalGame } from "./local.js"

const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647
// a random() that returns these values first (dice: die d is (d - 1) / 6 + 0.01)
const queue = (...vals) => {
  const rest = seeded(5)
  return () => (vals.length ? vals.shift() : rest())
}
const die = (d) => (d - 1) / 6 + 0.01
const NAMES = ["Ann", "Ben", "Cat", "Dan", "Eve", "Fay"]
const people = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: NAMES[i], bot: false }))
const ctxOf = (extra = {}) => {
  const timers = []
  return { now: 1000, random: seeded(9), timers, after: (ms, action, key = "timer") => timers.push({ ms, action, key }), cancel: () => {}, ...extra }
}
const act = (s, seat, a, ctx = ctxOf()) => {
  const next = R.action(s, seat, a, ctx)
  assert.ok(!next.error, `${JSON.stringify(a)} was refused: ${next.error}`)
  return next
}
const refused = (s, seat, a, pattern, ctx = ctxOf()) => {
  const next = R.action(s, seat, a, ctx)
  assert.ok(next.error, `${JSON.stringify(a)} should be refused`)
  if (pattern) assert.match(next.error, pattern)
}
const newGame = (n = 4, settings = {}, seed = 3) => R.create({ players: people(n), settings: { ...settings, players: n }, random: seeded(seed), now: 0 })
// a game past setup: player 0's turn, main phase, an empty board, empty hands
const midGame = (n = 4, settings = {}) => {
  const s = structuredClone(newGame(n, settings))
  s.phase = "main"
  s.turn = 0
  s.turnNo = 3
  s.setupStep = s.order.length
  s.dice = [3, 4]
  return s
}
const give = (s, p, cards) => Object.entries(cards).forEach(([r, n]) => (s.players[p].hand[r] += n))
const settle = (s, v, p, k = "s") => {
  s.verts[v] = { p, k }
  s.players[p].pieces[k === "c" ? "city" : "settlement"]--
}
const pave = (s, e, p) => {
  s.edges[e] = p
  s.players[p].pieces.road--
}
const G = geometry("std")
const CENTER = 9 // the middle tile of the 19

// ---------- the board ----------

test("the 3-4 player island: 19 tiles, 54 corners, 72 edges, the classic mix, 9 harbors", () => {
  assert.equal(G.tiles.length, 19)
  assert.equal(G.vertices.length, 54)
  assert.equal(G.edges.length, 72)
  assert.equal(G.coast.length, 30)
  for (let seed = 1; seed < 30; seed++) {
    const b = makeBoard({ geo: "std", layout: seed % 2 ? "random" : "balanced", random: seeded(seed) })
    const count = (t) => b.tiles.filter((x) => x.t === t).length
    assert.deepEqual([count("forest"), count("pasture"), count("fields"), count("hills"), count("mountains"), count("desert")], [4, 4, 4, 3, 3, 1])
    const numbers = b.tiles.map((t) => t.n).filter(Boolean).sort((a, c) => a - c)
    assert.deepEqual(numbers, [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12])
    assert.equal(b.tiles[b.bandit].t, "desert", "the Bandit starts in the desert")
    assert.equal(b.tiles[b.bandit].n, null)
    assert.equal(b.harbors.length, 9)
    assert.equal(b.harbors.filter((h) => h.r === "any").length, 4)
    assert.deepEqual(b.harbors.filter((h) => h.r !== "any").map((h) => h.r).sort(), ["clay", "grain", "ore", "timber", "wool"])
  }
})

test("harbors sit on the shore, spread out, never sharing a corner", () => {
  for (const geo of ["std", "ext"]) {
    const g = geometry(geo)
    const spots = harborSpots(geo)
    assert.equal(new Set(spots).size, spots.length)
    spots.forEach((e) => assert.equal(g.edges[e].tiles.length, 1, "a harbor is on a shore edge"))
    const corners = spots.flatMap((e) => [g.edges[e].a, g.edges[e].b])
    assert.equal(new Set(corners).size, corners.length)
  }
})

test("balanced maps never put a 6 next to an 8 (or 6-6, 8-8); beginner maps never change", () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (const geo of ["std", "ext"]) {
      const b = makeBoard({ geo, layout: "balanced", random: seeded(seed) })
      const g = geometry(geo)
      g.tiles.forEach((t, i) =>
        t.near.forEach((j) => {
          const red = (n) => n === 6 || n === 8
          assert.ok(!(red(b.tiles[i].n) && red(b.tiles[j].n)), `red numbers touch (seed ${seed}, ${geo})`)
        })
      )
    }
  }
  const a = makeBoard({ layout: "beginner", random: seeded(1) })
  const b = makeBoard({ layout: "beginner", random: seeded(99) })
  assert.deepEqual(a, b)
  assert.deepEqual(layoutFlaws("std", a.tiles), { redPairs: 0, sameNumber: 0, clumps: 0 })
})

test("the 5-6 player island: 30 tiles, 2 deserts, 28 numbers, 11 harbors, a bigger bank and deck", () => {
  const g = geometry("ext")
  assert.equal(g.tiles.length, 30)
  const b = makeBoard({ geo: "ext", random: seeded(4) })
  assert.equal(b.tiles.filter((t) => t.t === "desert").length, 2)
  assert.equal(b.tiles.filter((t) => t.n).length, 28)
  assert.equal(b.harbors.length, 11)
  const s = newGame(6)
  assert.equal(s.geo, "ext")
  assert.equal(s.bank.ore, 24)
  assert.equal(s.deck.length, 34)
  assert.equal(newGame(4).deck.length, 25)
  assert.equal(newGame(4).bank.grain, 19)
})

test("settings are cleaned: points 8-14, 2-6 players, timers from the list, a custom deck", () => {
  assert.equal(L.validateSettings({ target: 30 }).target, 14)
  assert.equal(L.validateSettings({ target: 3 }).target, 8)
  assert.equal(L.validateSettings({ players: 9 }).players, 6)
  assert.equal(L.validateSettings({ timer: 77 }).timer, 0)
  assert.equal(L.validateSettings({ layout: "weird" }).layout, "balanced")
  assert.equal(L.validateSettings({ deck: L.DECKS.std }).deck, null, "the base deck is the default")
  assert.deepEqual(L.validateSettings({ deck: { ranger: 3, roads: 0, plenty: 0, monopoly: 0, monument: 2 } }).deck, { ranger: 3, roads: 0, plenty: 0, monopoly: 0, monument: 2 })
  assert.ok(L.validateSettings({ deck: { ranger: 0 } }).error)
  const s = newGame(3, { deck: { ranger: 3, roads: 0, plenty: 0, monopoly: 0, monument: 2 } })
  assert.equal(s.deck.length, 5)
})

// ---------- setup ----------

test("setup is a snake: everyone places a settlement and road, then back in reverse order", () => {
  let s = newGame(4)
  const f = s.first
  const turns = []
  while (s.phase === "setup") {
    const p = s.turn
    turns.push(p)
    const v = L.legalSettlements(s, p, true)[0]
    s = act(s, p, { type: "build", what: "settlement", at: v })
    // the road must touch the new settlement
    const elsewhere = G.edges.findIndex((e) => e.a !== v && e.b !== v && s.edges[G.edges.indexOf(e)] == null)
    refused(s, p, { type: "build", what: "road", at: elsewhere }, /touching/)
    s = act(s, p, { type: "build", what: "road", at: L.legalRoads(s, p, v)[0] })
  }
  assert.deepEqual(turns, [f, f + 1, f + 2, f + 3, f + 3, f + 2, f + 1, f, f].slice(0, 8).map((x) => x % 4))
  assert.equal(s.phase, "roll")
  assert.equal(s.turn, f)
  assert.equal(s.verts.filter(Boolean).length, 8)
  assert.equal(s.edges.filter((e) => e != null).length, 8)
})

test("setup: the distance rule, out-of-turn placing, and starting resources from the second settlement", () => {
  let s = newGame(3)
  const p = s.turn
  const v = 20
  s = act(s, p, { type: "build", what: "settlement", at: v })
  assert.equal(L.total(s.players[p].hand), 0, "the first settlement collects nothing")
  refused(s, p, { type: "build", what: "settlement", at: G.vertices[v].adj[0] }, /road/)
  s = act(s, p, { type: "build", what: "road", at: G.vertices[v].edges[0] })
  refused(s, p, { type: "build", what: "settlement", at: 0 }, /turn/)
  const q = s.turn
  refused(s, q, { type: "build", what: "settlement", at: G.vertices[v].adj[1] }, /no building on the corners/)
  // play setup out to the second round
  while (s.setupStep < 3) {
    const t = s.turn
    s = act(s, t, { type: "build", what: "settlement", at: L.legalSettlements(s, t, true)[0] })
    s = act(s, t, { type: "build", what: "road", at: L.legalRoads(s, t, s.setupVertex)[0] })
  }
  const t = s.turn
  const spot = L.legalSettlements(s, t, true).find((x) => G.vertices[x].tiles.length === 3 && G.vertices[x].tiles.every((i) => s.tiles[i].t !== "desert"))
  const before = { ...s.bank }
  s = act(s, t, { type: "build", what: "settlement", at: spot })
  const expected = L.emptyHand()
  G.vertices[spot].tiles.forEach((i) => expected[TERRAIN_RES[s.tiles[i].t]]++)
  assert.deepEqual(s.players[t].hand, expected)
  for (const r of L.RES) assert.equal(s.bank[r], before[r] - expected[r])
  assert.equal(s.log.at(-1).k, "produce", "the gains are logged for the flying-cards animation")
})

// ---------- dice and production ----------

const onlyFive = (s, tile) => {
  s.tiles = s.tiles.map((t, i) => (i === tile ? { ...t, t: "fields", n: 5 } : { ...t, n: t.n === 5 ? 9 : t.n }))
  s.bandit = s.tiles.findIndex((t, i) => i !== tile && t.t === "desert")
  if (s.bandit < 0) s.bandit = tile === 0 ? 1 : 0
}

test("production: a settlement gets 1, a city 2, and the Bandit blocks the tile", () => {
  let s = midGame()
  s.phase = "roll"
  onlyFive(s, CENTER)
  const [a, , , d] = G.tiles[CENTER].corners
  settle(s, a, 0)
  settle(s, d, 1, "c")
  const ctx = ctxOf({ random: queue(die(2), die(3)) })
  const after = act(s, 0, { type: "roll" }, ctx)
  assert.deepEqual(after.dice, [2, 3])
  assert.equal(after.phase, "main")
  assert.equal(after.players[0].hand.grain, 1)
  assert.equal(after.players[1].hand.grain, 2)
  assert.equal(after.bank.grain, 19 - 3)
  assert.equal(after.rolls[5], 1)
  const produce = after.log.find((e) => e.k === "produce")
  assert.equal(produce.gains.length, 2)
  assert.ok(produce.gains.every((g) => g.tile === CENTER))
  // the Bandit on the tile: nothing
  s.bandit = CENTER
  const blocked = act(s, 0, { type: "roll" }, ctxOf({ random: queue(die(1), die(4)) }))
  assert.equal(blocked.players[0].hand.grain, 0)
  assert.equal(blocked.players[1].hand.grain, 0)
  assert.match(blocked.log.at(-1).text, /Bandit blocks/)
})

test("a bank too short for everyone gives nobody that resource (unless only one player is owed)", () => {
  const s = midGame()
  s.phase = "roll"
  onlyFive(s, CENTER)
  const [a, , , d] = G.tiles[CENTER].corners
  settle(s, a, 0)
  settle(s, d, 1, "c")
  s.bank.grain = 2
  const both = act(s, 0, { type: "roll" }, ctxOf({ random: queue(die(2), die(3)) }))
  assert.equal(both.players[0].hand.grain + both.players[1].hand.grain, 0)
  assert.equal(both.bank.grain, 2)
  const one = structuredClone(s)
  one.verts[a] = { p: 1, k: "s" }
  const solo = act(one, 0, { type: "roll" }, ctxOf({ random: queue(die(2), die(3)) }))
  assert.equal(solo.players[1].hand.grain, 2, "the only player owed gets what's left")
  assert.equal(solo.bank.grain, 0)
})

test("seven: players over the limit discard half (rounded down), then the Bandit moves and steals", () => {
  let s = midGame(3)
  s.phase = "roll"
  give(s, 0, { timber: 4, clay: 4 }) // 8 -> discard 4
  give(s, 1, { ore: 9 }) // 9 -> discard 4
  give(s, 2, { wool: 7 }) // 7: safe
  s = act(s, 0, { type: "roll" }, ctxOf({ random: queue(die(3), die(4)) }))
  assert.equal(s.phase, "discard")
  assert.deepEqual(s.discards, { 0: 4, 1: 4 })
  refused(s, 0, { type: "end" })
  refused(s, 0, { type: "discard", cards: { timber: 3 } }, /exactly 4/)
  refused(s, 0, { type: "discard", cards: { ore: 4 } }, /don't have/)
  refused(s, 2, { type: "discard", cards: { wool: 3 } }, /don't need/)
  s = act(s, 0, { type: "discard", cards: { timber: 2, clay: 2 } })
  assert.equal(s.phase, "discard")
  s = act(s, 1, { type: "discard", cards: { ore: 4 } })
  assert.equal(s.phase, "bandit")
  assert.equal(s.bank.ore, 19 + 4)
  // the Bandit has to move, to a tile, and takes a card from someone there
  const tile = 3
  settle(s, G.tiles[tile].corners[0], 2)
  refused(s, 0, { type: "bandit", tile: s.bandit }, /different tile/)
  refused(s, 1, { type: "bandit", tile }, /turn/)
  const after = act(s, 0, { type: "bandit", tile, victim: 2 }, ctxOf({ random: queue(0.5) }))
  assert.equal(after.bandit, tile)
  assert.equal(after.players[0].hand.wool, 1)
  assert.equal(after.players[2].hand.wool, 6)
  assert.equal(after.phase, "main")
})

test("the discard limit is a setting", () => {
  let s = midGame(2, { discard: 9 })
  s.phase = "roll"
  give(s, 0, { timber: 9 })
  give(s, 1, { timber: 10 })
  s = act(s, 0, { type: "roll" }, ctxOf({ random: queue(die(1), die(6)) }))
  assert.deepEqual(s.discards, { 1: 5 })
})

test("a friendly Bandit leaves players with 2 points or fewer alone", () => {
  const s = midGame(3, { friendly: true })
  s.phase = "bandit"
  s.resume = "main"
  // player 1 has 2 points on tile 3; player 2 has 3 points on tile 15
  settle(s, G.tiles[3].corners[0], 1)
  settle(s, G.tiles[0].corners[0], 1)
  settle(s, G.tiles[15].corners[0], 2, "c")
  settle(s, G.tiles[17].corners[0], 2)
  give(s, 1, { ore: 2 })
  give(s, 2, { ore: 2 })
  assert.ok(!L.banditTiles(s, 0).includes(3))
  assert.ok(L.banditTiles(s, 0).includes(15))
  refused(s, 0, { type: "bandit", tile: 3, victim: 1 }, /can't go there/)
  const after = act(s, 0, { type: "bandit", tile: 15, victim: 2 })
  assert.equal(after.players[0].hand.ore, 1)
})

// ---------- building ----------

test("roads connect to your own pieces; an opponent's building cuts the way through", () => {
  const s = midGame()
  give(s, 0, { timber: 5, clay: 5 })
  const t = G.tiles[CENTER]
  settle(s, t.corners[0], 0)
  refused(s, 0, { type: "build", what: "road", at: t.edges[2] }, /connect/)
  let n = act(s, 0, { type: "build", what: "road", at: t.edges[0] })
  assert.equal(n.players[0].hand.timber, 4)
  assert.equal(n.players[0].pieces.road, 14)
  // an opponent settles on the far end: no road past it
  n = structuredClone(n)
  settle(n, t.corners[1], 1)
  refused(n, 0, { type: "build", what: "road", at: t.edges[1] }, /connect/)
  // but from our own settlement the other way is fine
  act(n, 0, { type: "build", what: "road", at: t.edges[5] })
})

test("settlements need a road of yours and the distance rule; cities replace your settlements", () => {
  const s = midGame()
  give(s, 0, { timber: 3, clay: 3, wool: 2, grain: 4, ore: 3 })
  const t = G.tiles[CENTER]
  settle(s, t.corners[0], 0)
  pave(s, t.edges[0], 0)
  pave(s, t.edges[1], 0)
  refused(s, 0, { type: "build", what: "settlement", at: t.corners[1] }, /corners next to it/)
  refused(s, 0, { type: "build", what: "settlement", at: t.corners[3] }, /road/)
  let n = act(s, 0, { type: "build", what: "settlement", at: t.corners[2] })
  assert.equal(n.players[0].pieces.settlement, 3)
  assert.equal(R.points(n, 0), 2)
  refused(n, 0, { type: "build", what: "city", at: t.corners[4] }, /replace/)
  n = act(n, 0, { type: "build", what: "city", at: t.corners[2] })
  assert.equal(n.verts[t.corners[2]].k, "c")
  assert.equal(n.players[0].pieces.city, 3)
  assert.equal(n.players[0].pieces.settlement, 4, "the settlement goes back to your supply")
  assert.equal(R.points(n, 0), 3)
  assert.equal(n.bank.ore, 19 + 3)
  refused(n, 0, { type: "build", what: "city", at: t.corners[0] }, /need/)
  // out of pieces
  const none = structuredClone(n)
  none.players[0].pieces.road = 0
  refused(none, 0, { type: "build", what: "road", at: t.edges[2] }, /no roads left/)
})

test("you can't build before rolling or on someone else's turn", () => {
  const s = midGame()
  give(s, 1, { timber: 1, clay: 1 })
  settle(s, 0, 1)
  refused(s, 1, { type: "build", what: "road", at: G.vertices[0].edges[0] }, /turn/)
  const r = structuredClone(s)
  r.phase = "roll"
  give(r, 0, { timber: 1, clay: 1 })
  settle(r, 30, 0)
  refused(r, 0, { type: "build", what: "road", at: G.vertices[30].edges[0] }, /Roll/)
})

// ---------- harbors and the bank ----------

test("bank trades are 4:1, 3:1 with any harbor, 2:1 with a resource's own harbor", () => {
  const s = midGame()
  give(s, 0, { wool: 8, ore: 4 })
  refused(s, 0, { type: "bank", give: "wool", get: "wool" }, /different/)
  let n = act(s, 0, { type: "bank", give: "ore", get: "grain" })
  assert.equal(n.players[0].hand.ore, 0)
  assert.equal(n.players[0].hand.grain, 1)
  const wool = s.harbors.find((h) => h.r === "wool")
  const any = s.harbors.find((h) => h.r === "any")
  const h = structuredClone(s)
  settle(h, G.edges[wool.e].a, 0)
  settle(h, G.edges[any.e].b, 0)
  assert.deepEqual(L.ratios(h, 0), { timber: 3, clay: 3, wool: 2, grain: 3, ore: 3 })
  n = act(h, 0, { type: "bank", give: "wool", get: "clay", count: 3 })
  assert.equal(n.players[0].hand.wool, 2)
  assert.equal(n.players[0].hand.clay, 3)
  n = act(h, 0, { type: "bank", give: "ore", get: "clay" })
  assert.equal(n.players[0].hand.ore, 1)
  refused(n, 0, { type: "bank", give: "ore", get: "clay" }, /need 3/)
})

// ---------- development cards ----------

test("development cards: buying, not on the turn you bought it, one per turn", () => {
  let s = midGame()
  s.deck.push("ranger")
  give(s, 0, { wool: 2, grain: 2, ore: 2 })
  s = act(s, 0, { type: "buy" })
  assert.deepEqual(s.players[0].dev, [{ t: "ranger", at: 3 }])
  refused(s, 0, { type: "play", card: "ranger" }, /turn you bought/)
  // next time around it works, once
  s = structuredClone(s)
  s.turnNo = 7
  s.players[0].dev.push({ t: "ranger", at: 2 })
  s = act(s, 0, { type: "play", card: "ranger" })
  assert.equal(s.phase, "bandit")
  assert.equal(s.players[0].rangers, 1)
  s = act(s, 0, { type: "bandit", tile: 0 })
  assert.equal(s.phase, "main")
  refused(s, 0, { type: "play", card: "ranger" }, /already played/)
  refused(s, 0, { type: "play", card: "monument" }, /secret/)
})

test("a Ranger can be played before rolling, then the turn goes on with the roll", () => {
  let s = midGame()
  s.phase = "roll"
  s.players[0].dev.push({ t: "ranger", at: 1 })
  s = act(s, 0, { type: "play", card: "ranger" })
  s = act(s, 0, { type: "bandit", tile: 0 })
  assert.equal(s.phase, "roll")
  s = act(s, 0, { type: "roll" }, ctxOf({ random: queue(die(2), die(2)) }))
  assert.equal(s.phase, "main")
})

test("Trailblazers, Bumper Crop and Market Corner", () => {
  let s = midGame(3)
  const t = G.tiles[CENTER]
  settle(s, t.corners[0], 0)
  s.players[0].dev.push({ t: "roads", at: 1 }, { t: "plenty", at: 1 }, { t: "monopoly", at: 1 })
  s = act(s, 0, { type: "play", card: "roads" })
  assert.equal(s.phase, "roads")
  refused(s, 0, { type: "build", what: "settlement", at: 0 }, /free roads/)
  s = act(s, 0, { type: "build", what: "road", at: t.edges[0] })
  s = act(s, 0, { type: "build", what: "road", at: t.edges[1] })
  assert.equal(s.phase, "main")
  assert.equal(s.players[0].pieces.road, 13)
  assert.equal(L.total(s.players[0].hand), 0, "free")
  // next turn: Bumper Crop
  s = structuredClone(s)
  s.devPlayed = false
  s = act(s, 0, { type: "play", card: "plenty", res: ["ore", "ore"] })
  assert.equal(s.players[0].hand.ore, 2)
  // and Market Corner
  s = structuredClone(s)
  s.devPlayed = false
  give(s, 1, { ore: 3, wool: 1 })
  give(s, 2, { ore: 1 })
  s = act(s, 0, { type: "play", card: "monopoly", res: "ore" })
  assert.equal(s.players[0].hand.ore, 6)
  assert.equal(s.players[1].hand.ore, 0)
  assert.equal(s.players[1].hand.wool, 1)
  assert.equal(s.players[2].hand.ore, 0)
})

test("Largest Patrol: the first to 3 Rangers, taken only by playing more", () => {
  assert.equal(L.armyHolder([2, 1, 0], null), null)
  assert.equal(L.armyHolder([3, 1, 0], null), 0)
  assert.equal(L.armyHolder([3, 3, 0], 0), 0, "a tie doesn't take it")
  assert.equal(L.armyHolder([3, 4, 0], 0), 1)
  let s = midGame()
  s.players[0].rangers = 2
  s.players[0].dev.push({ t: "ranger", at: 1 })
  s = act(s, 0, { type: "play", card: "ranger" })
  assert.equal(s.army, 0)
  assert.equal(R.points(s, 0), 2)
})

// ---------- Longest Road ----------

test("road length: a chain, a loop, a branch, and a break by an opponent's settlement", () => {
  const s = midGame()
  const t = G.tiles[CENTER]
  t.edges.slice(0, 4).forEach((e) => pave(s, e, 0))
  assert.equal(L.roadLength(s, 0), 4)
  pave(s, t.edges[4], 0)
  assert.equal(L.roadLength(s, 0), 5)
  pave(s, t.edges[5], 0)
  assert.equal(L.roadLength(s, 0), 6, "a full loop")
  // a spur off the loop: around the loop and out along it
  const spur = G.vertices[t.corners[0]].edges.find((e) => !t.edges.includes(e))
  pave(s, spur, 0)
  assert.equal(L.roadLength(s, 0), 7)
  // a branch counts only one way
  const b = midGame()
  b.verts.fill(null)
  t.edges.slice(0, 3).forEach((e) => pave(b, e, 0))
  const out1 = G.vertices[t.corners[1]].edges.find((e) => !t.edges.includes(e))
  pave(b, out1, 0)
  assert.equal(L.roadLength(b, 0), 3)
  // broken in the middle by an opponent
  const k = midGame()
  t.edges.slice(0, 5).forEach((e) => pave(k, e, 0))
  assert.equal(L.roadLength(k, 0), 5)
  settle(k, t.corners[3], 1)
  assert.equal(L.roadLength(k, 0), 3)
  // our own settlement doesn't break it
  k.verts[t.corners[3]] = { p: 0, k: "s" }
  assert.equal(L.roadLength(k, 0), 5)
})

test("Longest Road: 5+ roads, the holder keeps ties, a broken lead with a tie goes to nobody", () => {
  assert.equal(L.longestHolder([4, 3, 0], null), null)
  assert.equal(L.longestHolder([5, 3, 0], null), 0)
  assert.equal(L.longestHolder([5, 5, 0], 0), 0, "a tie doesn't take it")
  assert.equal(L.longestHolder([5, 6, 0], 0), 1)
  assert.equal(L.longestHolder([3, 6, 6], 0), null, "broken, and two tie: set aside")
  assert.equal(L.longestHolder([3, 6, 5], 0), 1)
  assert.equal(L.longestHolder([4, 4, 2], 0), null, "nobody has 5")
  assert.equal(L.longestHolder([5, 5, 2], null), null, "a tie with no holder: nobody")
})

test("Longest Road changes hands in play, and a settlement can break it", () => {
  let s = midGame()
  const t = G.tiles[CENTER]
  settle(s, t.corners[0], 0)
  t.edges.slice(0, 4).forEach((e) => pave(s, e, 0))
  give(s, 0, { timber: 1, clay: 1 })
  s = act(s, 0, { type: "build", what: "road", at: t.edges[4] })
  assert.equal(s.longest, 0)
  assert.equal(R.points(s, 0), 3)
  // player 1 builds a settlement in the middle of it on their turn
  s = structuredClone(s)
  s.turn = 1
  const mid = t.corners[3]
  const away = G.vertices[mid].edges.find((e) => !t.edges.includes(e))
  pave(s, away, 1)
  give(s, 1, { timber: 1, clay: 1, wool: 1, grain: 1 })
  s = act(s, 1, { type: "build", what: "settlement", at: mid })
  assert.equal(s.players[0].road, 3)
  assert.equal(s.longest, null)
})

// ---------- trading with players ----------

test("player trades: offer, decline, accept, counter, confirm", () => {
  let s = midGame(3)
  give(s, 0, { wool: 2, timber: 1 })
  give(s, 1, { ore: 1 })
  give(s, 2, { ore: 2, grain: 1 })
  refused(s, 1, { type: "offer", give: { ore: 1 }, get: { wool: 1 } }, /whose turn/)
  refused(s, 0, { type: "offer", give: { ore: 1 }, get: { wool: 1 } }, /don't have/)
  refused(s, 0, { type: "offer", give: { wool: 1 }, get: { wool: 1 } }, /same resource/)
  refused(s, 0, { type: "offer", give: { wool: 1 }, get: {} }, /both sides/)
  const ctx = ctxOf()
  s = act(s, 0, { type: "offer", give: { wool: 1 }, get: { ore: 1 } }, ctx)
  assert.equal(ctx.timers[0].key, "trade", "the offer runs out on a timer")
  const id = s.trade.id
  refused(s, 0, { type: "confirm", id, with: 1 }, /haven't accepted/)
  s = act(s, 1, { type: "reply", id, answer: "decline" })
  s = act(s, 2, { type: "reply", id, answer: "counter", give: { wool: 2 }, get: { ore: 1 } })
  refused(s, 1, { type: "confirm", id, with: 2 }, /Only the player/)
  s = act(s, 0, { type: "confirm", id, with: 2 })
  assert.equal(s.players[0].hand.wool, 0)
  assert.equal(s.players[0].hand.ore, 1)
  assert.equal(s.players[2].hand.wool, 2)
  assert.equal(s.players[2].hand.ore, 1)
  assert.equal(s.trade, null)
  // an accept on the original terms
  give(s, 0, { wool: 1 })
  s = act(s, 0, { type: "offer", give: { timber: 1 }, get: { grain: 1 }, to: [2] })
  refused(s, 1, { type: "reply", id: s.trade.id, answer: "accept" }, /isn't for you/)
  s = act(s, 2, { type: "reply", id: s.trade.id, answer: "accept" })
  s = act(s, 0, { type: "confirm", id: s.trade.id, with: 2 })
  assert.equal(s.players[0].hand.grain, 1)
  assert.equal(s.players[2].hand.timber, 1)
})

test("an offer runs out, and the person asked must have the cards to accept", () => {
  let s = midGame(2)
  give(s, 0, { wool: 1 })
  s = act(s, 0, { type: "offer", give: { wool: 1 }, get: { ore: 1 } })
  refused(s, 1, { type: "reply", id: s.trade.id, answer: "accept" }, /don't have/)
  const gone = act(s, null, { type: "expire", id: s.trade.id })
  assert.equal(gone.trade, null)
  // a stale timer does nothing
  assert.equal(R.action(gone, null, { type: "expire", id: 99 }, ctxOf()), gone)
})

test("trading with computer players can be turned off", () => {
  const s = midGame(3, { botTrade: false })
  s.players[1].bot = true
  give(s, 0, { wool: 1 })
  const n = act(s, 0, { type: "offer", give: { wool: 1 }, get: { ore: 1 } })
  assert.deepEqual(n.trade.to, [2])
  const v = R.view(n, 1)
  assert.equal(chooseAction(v, 1, { random: seeded(1) }), null)
})

// ---------- winning ----------

test("the game ends when the player whose turn it is reaches the target (secret Monuments count)", () => {
  let s = midGame(3, { target: 8 })
  ;[0, 6, 12, 40].forEach((v) => settle(s, v, 0, "c")) // 8 points... built on the board
  s.players[0].pieces.city = 4
  assert.equal(R.points(s, 0), 8)
  // the win is checked on the next move
  give(s, 0, { wool: 1, grain: 1, ore: 1 })
  s.deck.push("ranger")
  s = act(s, 0, { type: "buy" })
  assert.equal(s.phase, "over")
  assert.deepEqual(R.isOver(s).winners, [0])
  refused(s, 0, { type: "end" }, /over/)
  // a Monument puts you over on your own turn
  let m = midGame(3, { target: 8 })
  ;[0, 6, 12].forEach((v) => settle(m, v, 0, "c"))
  settle(m, 40, 0)
  m.players[0].dev.push({ t: "monument", at: 1 })
  assert.equal(L.publicPoints(m, 0), 7)
  assert.equal(R.points(m, 0), 8)
  give(m, 0, { timber: 1, clay: 1 })
  m = act(m, 0, { type: "build", what: "road", at: G.vertices[40].edges[0] })
  assert.equal(m.phase, "over")
  assert.equal(R.view(m, 1).players[0].points, 8, "everyone sees the Monument at the end")
})

test("points reached on someone else's turn win at the start of your own", () => {
  let s = midGame(2, { target: 8 })
  ;[0, 6, 12].forEach((v) => settle(s, v, 1, "c"))
  settle(s, 40, 1)
  s.players[1].dev.push({ t: "monument", at: 1 })
  s = act(s, 0, { type: "end" })
  assert.equal(s.turn, 1)
  assert.equal(s.phase, "over")
  assert.equal(s.winner, 1)
})

// ---------- what players see ----------

test("views hide other hands, development cards, the deck order and a stolen card's type", () => {
  let s = midGame(3)
  give(s, 0, { ore: 2 })
  give(s, 1, { wool: 3 })
  s.players[1].dev.push({ t: "monument", at: 1 }, { t: "ranger", at: 2 })
  settle(s, G.tiles[3].corners[0], 1)
  s.phase = "bandit"
  s.resume = "main"
  s = act(s, 0, { type: "bandit", tile: 3, victim: 1 })
  const mine = R.view(s, 0)
  const theirs = R.view(s, 1)
  const watcher = R.view(s, 2)
  assert.deepEqual(mine.players[0].hand, { timber: 0, clay: 0, wool: 1, grain: 0, ore: 2 })
  assert.equal(mine.players[1].hand, null)
  assert.equal(mine.players[1].cards, 2)
  assert.equal(mine.players[1].dev, null)
  assert.equal(mine.players[1].devCount, 2)
  assert.equal(mine.players[1].points, 1, "the Monument stays secret")
  assert.equal(theirs.players[1].points, 2)
  assert.equal(typeof mine.deck, "number")
  assert.ok(!JSON.stringify(watcher).includes('"deck":['))
  const steal = (v) => v.log.find((e) => e.k === "steal")
  assert.equal(steal(mine).r, "wool")
  assert.equal(steal(theirs).r, "wool")
  assert.equal(steal(watcher).r, undefined)
  assert.match(steal(mine).text, /takes wool/)
  assert.doesNotMatch(steal(watcher).text, /wool/)
  assert.ok(!JSON.stringify(watcher).includes("wool from"))
  // a bought card's type is only in the buyer's log
  s = structuredClone(s)
  give(s, 0, { wool: 1, grain: 1, ore: 1 })
  s.deck.push("plenty")
  s = act(s, 0, { type: "buy" })
  assert.equal(R.view(s, 0).log.at(-1).card, "plenty")
  assert.equal(R.view(s, 1).log.at(-1).card, undefined)
  assert.equal(R.view(s, 0).players[0].dev.at(-1).fresh, true)
})

// ---------- the turn clock ----------

test("the turn clock: rolls for you, ends your turn, and old timers do nothing", () => {
  const players = people(2)
  const ctx = ctxOf()
  let s = R.create({ players, settings: { players: 2, timer: 60 }, random: seeded(2), now: 0, after: ctx.after })
  assert.equal(ctx.timers.at(-1).action.type, "timeout")
  // the clock places for the player in setup
  for (let i = 0; i < 4; i++) {
    s = act(s, null, { type: "timeout", stamp: s.stamp })
    s = act(s, null, { type: "timeout", stamp: s.stamp })
  }
  assert.equal(s.phase, "roll")
  const stamp = s.stamp
  s = act(s, null, { type: "timeout", stamp })
  assert.notEqual(s.phase, "roll")
  assert.equal(R.action(s, null, { type: "timeout", stamp }, ctxOf()), s, "a stale timer")
  while (s.phase === "discard" || s.phase === "bandit") s = act(s, null, { type: "timeout", stamp: s.stamp })
  const turn = s.turn
  s = act(s, null, { type: "timeout", stamp: s.stamp })
  assert.equal(s.turn, 1 - turn)
  assert.ok(s.deadline > 0)
})

test("5-6 players: special building between turns, for those who can afford something", () => {
  let s = midGame(5)
  const X = geometry("ext")
  give(s, 2, { timber: 1, clay: 1 })
  settle(s, 0, 2)
  give(s, 4, { wool: 1, grain: 1, ore: 1 })
  s = act(s, 0, { type: "end" })
  assert.equal(s.phase, "special")
  assert.deepEqual(s.special.queue, [2, 4], "players 1 and 3 can't afford anything: skipped")
  refused(s, 4, { type: "buy" }, /turn/)
  s = act(s, 2, { type: "build", what: "road", at: X.vertices[0].edges[0] })
  refused(s, 2, { type: "bank", give: "ore", get: "wool" }, /can't trade/)
  refused(s, 2, { type: "play", card: "ranger" }, /can't play/)
  s = act(s, 2, { type: "end" })
  s = act(s, 4, { type: "buy" })
  s = act(s, 4, { type: "end" })
  assert.equal(s.phase, "roll")
  assert.equal(s.turn, 1)
  // nobody can build: straight to the next turn
  s = act(act(s, 1, { type: "roll" }, ctxOf({ random: queue(die(2), die(2)) })), 1, { type: "end" })
  assert.equal(s.phase, "roll")
  assert.equal(s.turn, 2)
})

// ---------- computer players ----------

const botGame = (n, seed, settings = {}) => {
  const random = seeded(seed)
  const players = Array.from({ length: n }, (_, i) => ({ id: i, name: NAMES[i], bot: true }))
  let s = R.create({ players, settings: { players: n, ...settings }, random, now: 0 })
  let t = 0
  for (let step = 0; step < 15000 && s.phase !== "over"; step++) {
    let acted = false
    for (let seat = 0; seat < n && !acted; seat++) {
      const a = R.bot(s, seat, { random })
      if (!a) continue
      const next = R.action(s, seat, a, { now: (t += 500), random, after: () => {}, cancel: () => {} })
      assert.ok(!next.error, `the computer's ${JSON.stringify(a)} was refused in ${s.phase}: ${next.error}`)
      s = next
      acted = true
    }
    if (!acted) {
      assert.ok(s.trade, `nobody can move in ${s.phase}`)
      s = R.action(s, null, { type: "expire", id: s.trade.id }, { now: t, random })
    }
  }
  return s
}

test("computer players finish whole games, 2 to 6 players, every level, never making an illegal move", () => {
  for (const [n, seed, level] of [
    [2, 11, "easy"],
    [3, 12, "normal"],
    [4, 13, "hard"],
    [5, 14, "normal"],
    [6, 15, "hard"],
  ]) {
    const s = botGame(n, seed, { level })
    assert.equal(s.phase, "over", `${n} players didn't finish`)
    assert.ok(R.points(s, s.winner) >= 10)
    assert.ok(s.players.some((p) => p.stats.built.settlement + p.stats.built.city > 0))
  }
})

test("computer players settle where the numbers are good, and put the Bandit on someone else", () => {
  const s = newGame(4)
  const v = R.view(s, s.turn)
  const a = chooseAction(v, s.turn, { random: seeded(1), level: "hard" })
  assert.equal(a.what, "settlement")
  const pips = Object.values(L.vertexPips(s, a.at)).reduce((x, y) => x + y, 0)
  const all = L.legalSettlements(s, s.turn, true).map((x) => Object.values(L.vertexPips(s, x)).reduce((p, q) => p + q, 0))
  assert.ok(pips >= Math.max(...all) - 3, `picked ${pips} pips, best was ${Math.max(...all)}`)
  // the Bandit
  const b = midGame(3)
  b.phase = "bandit"
  b.resume = "main"
  settle(b, G.tiles[CENTER].corners[0], 0)
  settle(b, G.tiles[CENTER].corners[3], 1, "c")
  b.tiles[CENTER] = { t: "fields", n: 6 }
  give(b, 1, { ore: 3 })
  b.players[1].pieces.city = 3
  const move = chooseAction(R.view(b, 0), 0, { random: seeded(3), level: "hard" })
  assert.equal(move.type, "bandit")
  const corners = G.tiles[move.tile].corners
  assert.ok(!corners.some((c) => b.verts[c]?.p === 0), "never on its own tile")
})

test("personalities are stable for a name, with or without (computer)", () => {
  assert.equal(personaFor("Ada"), personaFor("Ada (computer)"))
})

test("the local game runs the same rules with computer players taking turns", async () => {
  let changes = 0
  const g = createLocalGame({ settings: { players: 3 }, players: [{ id: 0, name: "You", bot: false }, { id: 1, name: "Ada", bot: true }, { id: 2, name: "Alan", bot: true }], random: seeded(8), speed: 1000, onChange: () => changes++ })
  await new Promise((r) => setTimeout(r, 300))
  // somebody placed something, unless it's our turn first
  assert.ok(changes >= 1)
  const v = g.view(0)
  assert.equal(v.you, 0)
  assert.equal(v.players[1].hand, null)
  g.stop()
})

test("the PIPS table matches two dice", () => {
  for (let n = 2; n <= 12; n++) {
    if (n === 7) continue
    let ways = 0
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b === n) ways++
    assert.equal(PIPS[n], ways)
  }
})
