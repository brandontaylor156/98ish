// Last Card's rules. Run: node --test client/src/components/applets/lastcard/
import test from "node:test"
import assert from "node:assert/strict"
import { CATCH_MS, DEFAULTS, buildDeck, decksFor, handPoints, validateSettings } from "./cards.js"
import * as R from "./rules.js"
import { botAction, botDelay } from "./bot.js"
import { createLocalGame } from "./local.js"

// ---------- helpers ----------

const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647

// "r5", "gskip", "brev", "yd2", "wwild", "wwd4" -> a card
let nextId = 1000
const C = (spec) => ({ id: nextId++, c: spec[0], v: spec.slice(1) })

// A context like the room system's, with timers written down instead of run
const makeCtx = (now = 1_000_000, players = null) => {
  const timers = new Map()
  return {
    now,
    random: seeded(7),
    players: players || [],
    timers,
    after: (ms, action, key = "timer") => timers.set(key, { ms, action }),
    cancel: (key = "timer") => timers.set(key, null),
  }
}

const NAMES = ["Ann", "Ben", "Cat", "Dan", "Eve", "Fay"]

// A game set up just so: hands (specs per seat), the top card, whose turn, the draw pile
// (the last card is drawn first) and settings
const setup = ({ hands, top = "r3", color, turn = 0, dir = 1, deck, settings = {} }) => {
  const players = hands.map((_, i) => ({ id: i, name: NAMES[i], bot: false }))
  const s = R.create({ players, settings: { timer: 0, target: 500, ...settings }, random: seeded(3), now: 1_000_000 })
  s.hands = hands.map((h) => h.map(C))
  const t = C(top)
  s.discard = [C("g8"), t]
  s.color = color || (t.c === "w" ? "r" : t.c)
  s.turn = turn
  s.dir = dir
  s.deck = (deck || Array.from({ length: 30 }, (_, i) => `b${(i % 9) + 1}`)).map(C)
  s.called = hands.map(() => false)
  s.events = []
  return s
}

const act = (s, seat, action, ctx = makeCtx()) => R.action(s, seat, action, ctx)
const ok = (result) => {
  assert.ok(!(result && typeof result.error === "string" && Object.keys(result).length === 1), `refused: ${result?.error}`)
  return result
}
const refused = (result, re) => {
  assert.equal(typeof result.error, "string", "expected a refusal")
  if (re) assert.match(result.error, re)
}
const idOf = (s, seat, spec) => s.hands[seat].find((c) => c.c === spec[0] && c.v === spec.slice(1)).id
const play = (s, seat, spec, extra = {}, ctx) => act(s, seat, { type: "play", card: idOf(s, seat, spec), ...extra }, ctx)

// ---------- the deck and settings ----------

test("a deck has 108 cards: 4 colors of 0-9, Skip, Reverse, Draw Two, plus 4 Wilds and 4 Draw Fours", () => {
  const deck = buildDeck()
  assert.equal(deck.length, 108)
  const count = (pred) => deck.filter(pred).length
  for (const c of ["r", "y", "g", "b"]) {
    assert.equal(count((k) => k.c === c && k.v === "0"), 1)
    for (const v of ["1", "5", "9", "skip", "rev", "d2"]) assert.equal(count((k) => k.c === c && k.v === v), 2)
  }
  assert.equal(count((k) => k.v === "wild"), 4)
  assert.equal(count((k) => k.v === "wd4"), 4)
  assert.equal(buildDeck({ extras: true }).length, 118)
  assert.equal(buildDeck({ decks: 2 }).length, 216)
  // big tables get more decks
  assert.equal(decksFor(4, 7), 1)
  assert.equal(decksFor(10, 7), 2)
  assert.equal(decksFor(10, 10), 2)
  assert.equal(decksFor(2, 7, 3), 3)
})

test("settings are cleaned and checked", () => {
  assert.deepEqual(validateSettings({}), DEFAULTS)
  assert.match(validateSettings({ players: 11 }).error, /2 to 10/)
  assert.match(validateSettings({ handSize: 4 }).error, /5 to 10/)
  assert.match(validateSettings({ target: 300 }).error, /250 or 500/)
  assert.match(validateSettings({ timer: 20 }).error, /15, 30 or 60/)
  const s = validateSettings({ stacking: 1, sevenO: "yes", bots: "nasty", extra: "junk" })
  assert.equal(s.stacking, true)
  assert.equal(s.sevenO, true)
  assert.equal(s.bots, "normal")
  assert.equal(s.extra, undefined)
  assert.equal(R.seats({ players: 6 }), 6)
})

test("points: numbers at face value, action cards 20, wilds 50", () => {
  assert.equal(handPoints(["r7", "b0", "gskip", "yrev", "rd2", "wwild", "wwd4"].map(C)), 7 + 0 + 20 + 20 + 20 + 50 + 50)
})

test("a new game deals everyone their hand, turns up a number and starts left of the dealer", () => {
  const players = [0, 1, 2, 3].map((i) => ({ id: i, name: NAMES[i], bot: false }))
  const ctx = makeCtx()
  const s = R.create({ players, settings: { handSize: 6 }, random: seeded(9), now: ctx.now, after: ctx.after })
  assert.deepEqual(s.hands.map((h) => h.length), [6, 6, 6, 6])
  assert.match(R.topOf(s).v, /^\d$/)
  assert.equal(s.color, R.topOf(s).c)
  assert.equal(s.turn, (s.dealer + 1) % 4)
  assert.equal(s.deck.length + s.discard.length + 24, 108)
  // every id is different
  const ids = [...s.deck, ...s.discard, ...s.hands.flat()].map((c) => c.id)
  assert.equal(new Set(ids).size, 108)
  // a 30 second turn clock
  assert.equal(ctx.timers.get("turn").ms, 30_000)
})

// ---------- playing cards ----------

test("match the color or the number; anything else is refused, and only on your turn", () => {
  const s = setup({ hands: [["r5", "g3", "b9"], ["y1", "y2"], ["g1", "g2"]] })
  refused(play(s, 0, "b9"), /doesn't match/)
  refused(play(s, 1, "y1"), /not your turn/)
  const a = ok(play(s, 0, "r5"))
  assert.equal(a.turn, 1)
  assert.equal(R.topOf(a).v, "5")
  const b = ok(play(setup({ hands: [["g3", "b9"], ["y1"], ["g1"]] }), 0, "g3"))
  assert.equal(b.color, "g")
  // the original state is never changed
  assert.equal(s.hands[0].length, 3)
})

test("Skip skips the next player", () => {
  const s = ok(play(setup({ hands: [["rskip", "b1"], ["y1"], ["g1"]] }), 0, "rskip"))
  assert.equal(s.turn, 2)
  assert.ok(s.events.some((e) => e.t === "skip" && e.seat === 1))
})

test("Reverse turns play around; with two players it works like a Skip", () => {
  const s = ok(play(setup({ hands: [["rrev", "b1"], ["y1"], ["g1"]] }), 0, "rrev"))
  assert.equal(s.dir, -1)
  assert.equal(s.turn, 2)
  const two = ok(play(setup({ hands: [["rrev", "b1"], ["y1", "y2"]] }), 0, "rrev"))
  assert.equal(two.turn, 0)
  assert.equal(two.dir, -1)
})

test("Draw Two: the next player draws two and loses their turn", () => {
  const s = ok(play(setup({ hands: [["rd2", "b1"], ["y1"], ["g1"]] }), 0, "rd2"))
  assert.equal(s.hands[1].length, 3)
  assert.equal(s.turn, 2)
  assert.equal(s.stack, 0)
})

test("Wild: pick a color (and you must pick one)", () => {
  const s = setup({ hands: [["wwild", "b1"], ["y1"]] })
  refused(play(s, 0, "wwild"), /color/)
  refused(play(s, 0, "wwild", { color: "purple" }), /color/)
  const a = ok(play(s, 0, "wwild", { color: "b" }))
  assert.equal(a.color, "b")
  assert.equal(a.turn, 1)
})

test("Wild Draw Four without challenges: the next player draws four and is skipped", () => {
  const s = ok(play(setup({ hands: [["wwd4", "b1"], ["y1"], ["g1"]], settings: { challenge: false } }), 0, "wwd4", { color: "g" }))
  assert.equal(s.hands[1].length, 5)
  assert.equal(s.turn, 2)
  assert.equal(s.color, "g")
})

test("challenging a Wild Draw Four: an honest one costs the challenger six, a bluff costs the bluffer four", () => {
  // honest: player 0 had no red
  const honest = ok(play(setup({ hands: [["wwd4", "b1"], ["y1"], ["g1"]] }), 0, "wwd4", { color: "g" }))
  assert.equal(honest.turn, 1)
  assert.equal(honest.stack, 4)
  const v1 = R.view(honest, 1)
  assert.equal(v1.canChallenge, true)
  assert.equal(JSON.stringify(v1).includes("bluff"), false, "the view never says whether it was a bluff")
  const lost = ok(act(honest, 1, { type: "challenge" }))
  assert.equal(lost.hands[1].length, 7)
  assert.equal(lost.turn, 2)
  // a bluff: player 0 had a red card (the color in play)
  const bluffed = ok(play(setup({ hands: [["wwd4", "r1", "b1"], ["y1"], ["g1"]] }), 0, "wwd4", { color: "g" }))
  const won = ok(act(bluffed, 1, { type: "challenge" }))
  assert.equal(won.hands[0].length, 2 + 4)
  assert.equal(won.hands[1].length, 1)
  assert.equal(won.turn, 1, "the challenger plays on")
  assert.equal(won.stack, 0)
  // not challenging: take four, lose the turn
  const took = ok(act(bluffed, 1, { type: "draw" }))
  assert.equal(took.hands[1].length, 5)
  assert.equal(took.turn, 2)
  // nothing to challenge
  refused(act(took, 2, { type: "challenge" }), /nothing/)
})

test("stacking: a Draw Two passes the stack on, a Draw Four tops either, but a Draw Two can't go on a Four", () => {
  const settings = { stacking: true, challenge: false }
  let s = ok(play(setup({ hands: [["rd2", "b1"], ["yd2", "y5"], ["g1", "wwd4"]], settings }), 0, "rd2"))
  assert.equal(s.stack, 2)
  assert.equal(s.turn, 1)
  assert.deepEqual(R.view(s, 1).playable, [idOf(s, 1, "yd2")], "only a stacking card is playable")
  refused(play(s, 1, "y5"))
  s = ok(play(s, 1, "yd2"))
  assert.equal(s.stack, 4)
  s = ok(play(s, 2, "wwd4", { color: "b" }))
  assert.equal(s.stack, 8)
  assert.equal(s.turn, 0)
  s = ok(act(s, 0, { type: "draw" }))
  assert.equal(s.hands[0].length, 1 + 8)
  assert.equal(s.stack, 0)
  assert.equal(s.turn, 1)
  // a Draw Two on a Draw Four: no
  const four = ok(play(setup({ hands: [["wwd4", "b1"], ["yd2", "y5"]], settings }), 0, "wwd4", { color: "y" }))
  refused(play(four, 1, "yd2"))
  // without stacking the Draw Two is taken right away
  const plain = ok(play(setup({ hands: [["rd2", "b1"], ["yd2", "y5"], ["g1"]] }), 0, "rd2"))
  assert.equal(plain.hands[1].length, 4)
})

test("7-0: a 7 swaps hands with the player you pick; a 0 passes every hand along", () => {
  const settings = { sevenO: true }
  const s = setup({ hands: [["r7", "b1", "b2"], ["y1"], ["g1", "g2", "g3", "g4"]], settings })
  refused(play(s, 0, "r7"), /swap/)
  refused(play(s, 0, "r7", { target: 0 }), /swap/)
  const swapped = ok(play(s, 0, "r7", { target: 1 }))
  assert.deepEqual(swapped.hands[0].map((c) => c.v), ["1"])
  assert.deepEqual(swapped.hands[1].map((c) => c.c + c.v), ["b1", "b2"])
  assert.equal(swapped.called[0], true, "landing on one card by a swap counts as called")
  const rotated = ok(play(setup({ hands: [["r0", "b1"], ["y1", "y2", "y3"], ["g1", "g2"]], settings }), 0, "r0"))
  // hands move in the direction of play: 0 -> 1 -> 2 -> 0
  assert.deepEqual(rotated.hands.map((h) => h.length), [2, 1, 3])
  assert.deepEqual(rotated.hands[1].map((c) => c.c + c.v), ["b1"])
  // without the rule a 7 is just a 7
  const plain = ok(play(setup({ hands: [["r7", "b1"], ["y1"]] }), 0, "r7"))
  assert.equal(plain.hands[0].length, 1)
})

test("jump-in: the very same card can be played out of turn, and play carries on from there", () => {
  const settings = { jumpIn: true }
  const s = setup({ hands: [["b1", "b2"], ["y4", "y5"], ["r3", "g1"], ["y9", "y8"]], top: "r3", turn: 0, settings })
  assert.deepEqual(R.view(s, 2).playable, [idOf(s, 2, "r3")])
  const j = ok(play(s, 2, "r3"))
  assert.equal(j.turn, 3, "the player after the jumper is up")
  assert.ok(j.events.some((e) => e.t === "jump" && e.seat === 2 && e.from === 0))
  refused(play(setup({ hands: [["b1"], ["r5", "y5"]], top: "r3", settings }), 1, "r5"), /very same/)
  refused(play(setup({ hands: [["b1"], ["r3", "y5"]], top: "r3" }), 1, "r3"), /not your turn/)
})

// ---------- drawing ----------

test("drawing: a card that doesn't fit ends the turn; one that fits can be played or kept", () => {
  const miss = ok(act(setup({ hands: [["b1"], ["y1"]], deck: ["g5"] }), 0, { type: "draw" }))
  assert.equal(miss.hands[0].length, 2)
  assert.equal(miss.turn, 1)
  const hit = ok(act(setup({ hands: [["b1"], ["y1"]], deck: ["r5"] }), 0, { type: "draw" }))
  assert.equal(hit.turn, 0)
  assert.equal(R.view(hit, 0).canPass, true)
  assert.deepEqual(R.view(hit, 0).playable, [hit.drawn], "only the drawn card")
  refused(act(hit, 0, { type: "draw" }), /already drew/)
  const kept = ok(act(hit, 0, { type: "pass" }))
  assert.equal(kept.turn, 1)
  const played = ok(act(hit, 0, { type: "play", card: hit.drawn }))
  assert.equal(R.topOf(played).v, "5")
  refused(act(setup({ hands: [["b1"], ["y1"]] }), 0, { type: "pass" }), /Draw a card first/)
})

test("forced play: a drawn card that fits must be played", () => {
  const s = ok(act(setup({ hands: [["b1"], ["y1"]], deck: ["r5"], settings: { forcePlay: true } }), 0, { type: "draw" }))
  assert.equal(R.view(s, 0).mustPlay, true)
  refused(act(s, 0, { type: "pass" }), /have to play/)
  ok(act(s, 0, { type: "play", card: s.drawn }))
})

test("draw until you can play: keep drawing until a card fits", () => {
  // drawn from the end: g5, b7, then r9 fits
  const s = ok(act(setup({ hands: [["b1"], ["y1"]], deck: ["y2", "r9", "b7", "g5"], settings: { drawUntil: true } }), 0, { type: "draw" }))
  assert.equal(s.hands[0].length, 4)
  assert.equal(s.hands[0].find((c) => c.id === s.drawn).v, "9")
  assert.equal(s.turn, 0)
})

test("the discards are shuffled back in when the draw pile runs out", () => {
  const s = setup({ hands: [["b1"], ["y1"]], deck: ["g5"] })
  s.discard = ["y2", "y3", "y4", "g9", "r3"].map(C)
  const a = ok(act(s, 0, { type: "draw" }))
  assert.equal(a.deck.length, 0)
  const b = ok(act(a, 1, { type: "draw" }))
  assert.equal(b.hands[1].length, 2)
  assert.equal(b.discard.length, 1, "only the top card stays")
  assert.equal(R.topOf(b).v, "3")
  assert.equal(b.deck.length, 3)
  assert.ok(b.events.some((e) => e.t === "shuffle"))
})

// ---------- Last Card! ----------

test("calling Last Card keeps you safe; forgetting gives everyone a few seconds to catch you", () => {
  const called = ok(play(setup({ hands: [["r5", "b1"], ["y1", "y2"], ["g1"]] }), 0, "r5", { call: true }))
  assert.equal(called.called[0], true)
  assert.equal(called.vuln, null)
  refused(act(called, 1, { type: "catch" }), /nobody/)

  const ctx = makeCtx(5_000)
  const forgot = ok(play(setup({ hands: [["r5", "b1"], ["y1", "y2"], ["g1"]] }), 0, "r5", {}, ctx))
  assert.equal(forgot.vuln.seat, 0)
  assert.equal(forgot.vuln.until, 5_000 + CATCH_MS)
  assert.equal(ctx.timers.get("vuln").ms, CATCH_MS)
  refused(act(forgot, 0, { type: "catch" }), /nobody/)
  // caught: two cards
  const caught = ok(act(forgot, 2, { type: "catch" }, makeCtx(6_000)))
  assert.equal(caught.hands[0].length, 3)
  assert.equal(caught.vuln, null)
  // too late
  refused(act(forgot, 2, { type: "catch" }, makeCtx(5_000 + CATCH_MS + 1)), /Too late/)
  // a late call still counts, before anyone catches you
  const late = ok(act(forgot, 0, { type: "call" }, makeCtx(6_000)))
  assert.equal(late.called[0], true)
  refused(act(late, 2, { type: "catch" }), /nobody/)
  // the window closes by itself
  const closed = ok(act(forgot, null, { type: "vulnEnd", seq: forgot.vuln.seq }))
  assert.equal(closed.vuln, null)
  // the first catch wins; a second is refused
  refused(act(caught, 1, { type: "catch" }), /nobody/)
})

// ---------- rounds and scoring ----------

test("going out wins the round and scores everyone else's cards", () => {
  const ctx = makeCtx()
  const s = setup({ hands: [["r5"], ["y1", "wwild"], ["gskip", "b9"]] })
  s.called[0] = true
  const won = ok(play(s, 0, "r5", {}, ctx))
  assert.equal(won.phase, "roundover")
  assert.equal(won.roundResult.winner, 0)
  assert.equal(won.roundResult.points, 1 + 50 + 20 + 9)
  assert.equal(won.scores[0], 80)
  assert.equal(won.over, null)
  assert.equal(ctx.timers.get("round").ms, R.ROUND_PAUSE)
  refused(play(won, 1, "y1"), /next round/)
  // the next round: everything dealt again
  const next = ok(act(won, null, { type: "nextRound", round: won.round }))
  assert.equal(next.phase, "play")
  assert.equal(next.round, won.round + 1)
  assert.deepEqual(next.hands.map((h) => h.length), [7, 7, 7])
  assert.equal(next.scores[0], 80)
  // everyone ready: no waiting
  const players = [0, 1, 2].map((i) => ({ id: i, name: NAMES[i], bot: i === 2 }))
  let r = ok(act(won, 0, { type: "ready" }, makeCtx(1_000_000, players)))
  assert.equal(r.phase, "roundover")
  r = ok(act(r, 1, { type: "ready" }, makeCtx(1_000_000, players)))
  assert.equal(r.phase, "play")
})

test("reaching the target (or a one-round game) ends the game", () => {
  const s = setup({ hands: [["r5"], ["wwd4", "wwd4"]], settings: { target: 250 } })
  s.scores = [200, 0]
  const won = ok(play(s, 0, "r5"))
  assert.deepEqual(R.isOver(won).winners, [0])
  assert.equal(R.isOver(won).reason, "points")
  const single = ok(play(setup({ hands: [["r5"], ["y1"]], settings: { target: 0 } }), 0, "r5"))
  assert.deepEqual(R.isOver(single), { winners: [0], reason: "out", scores: [1, 0] })
  refused(act(single, 1, { type: "draw" }), /over/)
})

test("going out on a Draw Two still makes the next player draw (and counts those cards)", () => {
  const s = ok(play(setup({ hands: [["rd2"], ["y1"], ["g1"]] }), 0, "rd2"))
  assert.equal(s.hands[1].length, 3)
  assert.equal(s.phase, "roundover")
})

test("Extra Cards: Skip All gives you another turn; Discard All takes your other cards of that color", () => {
  const settings = { extras: true }
  const again = ok(play(setup({ hands: [["rskipall", "b1"], ["y1"], ["g1"]], settings }), 0, "rskipall"))
  assert.equal(again.turn, 0)
  const dumped = ok(play(setup({ hands: [["rdiscall", "r1", "r9", "b1"], ["y1"]], settings }), 0, "rdiscall"))
  assert.deepEqual(dumped.hands[0].map((c) => c.c + c.v), ["b1"])
  assert.equal(R.topOf(dumped).v, "discall")
  const six = ok(play(setup({ hands: [["wwd6", "b1"], ["y1"], ["g1"]], settings }), 0, "wwd6", { color: "y" }))
  assert.equal(six.hands[1].length, 7)
})

// ---------- the clock ----------

test("out of time: the player draws (or takes the stack) and the turn moves on", () => {
  const s = setup({ hands: [["b1"], ["y1"]], deck: ["g5"] })
  const t = ok(act(s, null, { type: "timeout", turnId: s.turnId }))
  assert.equal(t.hands[0].length, 2)
  assert.equal(t.turn, 1)
  // an old timer does nothing
  assert.equal(act(t, null, { type: "timeout", turnId: s.turnId }), t)
  // a drawn card that must be played is played
  const forced = setup({ hands: [["b1", "b2"], ["y1"]], deck: ["wwild"], settings: { forcePlay: true } })
  const f = ok(act(forced, null, { type: "timeout", turnId: forced.turnId }))
  assert.equal(R.topOf(f).v, "wild")
  assert.equal(f.color, "b")
  // a pending Draw Two is taken
  const stacked = ok(play(setup({ hands: [["rd2", "b1"], ["y1"], ["g1"]], settings: { stacking: true } }), 0, "rd2"))
  const took = ok(act(stacked, null, { type: "timeout", turnId: stacked.turnId }))
  assert.equal(took.hands[1].length, 3)
  assert.equal(took.turn, 2)
})

// ---------- hidden information ----------

test("views show your own hand and only counts for everyone else; never the draw pile", () => {
  const players = [0, 1, 2].map((i) => ({ id: i, name: NAMES[i], bot: false }))
  const s = R.create({ players, settings: {}, random: seeded(4) })
  const mine = new Set(s.hands[0].map((c) => c.id))
  const v = R.view(s, 1)
  assert.equal(v.hand.length, 7)
  assert.deepEqual(v.counts, [7, 7, 7])
  assert.ok(v.hand.every((c) => !mine.has(c.id)))
  assert.equal(v.deck, undefined)
  assert.equal(v.hands, undefined)
  const text = JSON.stringify(v)
  for (const c of [...s.hands[0], ...s.hands[2], ...s.deck]) assert.ok(!text.includes(`"id":${c.id},`), "someone else's card leaked")
  // a spectator sees no hand at all
  const spec = R.view(s, null)
  assert.equal(spec.hand, null)
  assert.deepEqual(spec.playable, [])
  // what you draw is yours alone
  const turn = s.turn
  const drew = ok(act(s, turn, { type: "draw" }))
  const e = (seat) => R.view(drew, seat).events.filter((x) => x.t === "draw").at(-1)
  assert.equal(e(turn).ids.length, 1)
  assert.equal(e((turn + 1) % 3).ids, undefined)
  assert.equal(e((turn + 1) % 3).n, 1)
})

// ---------- computer players ----------

test("computer players: hold wilds, call Last Card, and hit a player about to go out", () => {
  const settings = { bots: "hard" }
  // a matching card instead of the wild
  const a = setup({ hands: [["wwild", "r5", "b2", "g4"], ["y1", "y2", "y3"]], settings })
  assert.equal(botAction(a, 0).card, idOf(a, 0, "r5"))
  // one card left after this play: call it
  const b = setup({ hands: [["r5", "b2"], ["y1", "y2", "y3"]], settings })
  assert.equal(botAction(b, 0).call, true)
  // next player on one card: Draw Two over a plain number
  const c = setup({ hands: [["r5", "rd2", "b2", "b3"], ["y1"], ["g1", "g2", "g3"]], settings })
  assert.equal(botAction(c, 0).card, idOf(c, 0, "rd2"))
  // a wild gets the color it has most of
  const d = setup({ hands: [["wwild", "g1", "g2", "b3"], ["y1", "y2"]], settings, top: "y7" })
  assert.deepEqual(botAction(d, 0), { type: "play", card: idOf(d, 0, "wwild"), color: "g" })
  // nothing fits: draw
  assert.deepEqual(botAction(setup({ hands: [["b1", "g2"], ["y1"]] }), 0), { type: "draw" })
  // catching someone who forgot (hard players always do) after a moment
  const e = ok(play(setup({ hands: [["r5", "b1"], ["y1", "y2"], ["g1", "g2"]], settings }), 0, "r5", {}, makeCtx(10_000)))
  assert.deepEqual(botAction(e, 2, { now: 10_100 }), { type: "catch" })
  const wait = botDelay(e, 2, { type: "catch" }, { now: 10_100 })
  assert.ok(wait > 500 && wait < CATCH_MS, `catch delay ${wait}`)
  assert.equal(botAction(e, 2, { now: 10_000 + CATCH_MS + 5 })?.type, e.turn === 2 ? "play" : undefined)
})

// whole games of computer players, on a fake clock: every move accepted, every game ends
const fakeTime = () => {
  let t = 1_000_000
  let ids = 0
  const timers = new Map()
  return {
    now: () => t,
    setTimeout: (fn, ms) => {
      const h = ++ids
      timers.set(h, { at: t + ms, fn })
      return h
    },
    clearTimeout: (h) => timers.delete(h),
    run(limit) {
      let steps = 0
      while (timers.size && steps++ < limit) {
        const [h, x] = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
        timers.delete(h)
        t = x.at
        x.fn()
      }
      return steps
    },
  }
}

test("computer players finish whole games under every house rule without a refused move", () => {
  const warn = console.warn
  const warnings = []
  console.warn = (...args) => warnings.push(args.join(" "))
  try {
    const variants = [
      {},
      { stacking: true, challenge: true },
      { sevenO: true, jumpIn: true },
      { drawUntil: true, forcePlay: true },
      { extras: true, stacking: true, challenge: false, bots: "hard" },
      { bots: "easy", handSize: 10, players: 10 },
      { sevenO: true, stacking: true, jumpIn: true, drawUntil: true, extras: true, players: 6 },
    ]
    variants.forEach((v, k) => {
      const count = v.players || 4
      const players = Array.from({ length: count }, (_, i) => ({ id: i, name: `Bot${i}${k}`, bot: true }))
      const time = fakeTime()
      const game = createLocalGame({ settings: { timer: 0, target: 250, ...v }, players, random: seeded(100 + k), time })
      time.run(60_000)
      assert.ok(game.result, `variant ${k} finished`)
      assert.equal(game.result.reason, "points")
      assert.ok(game.state.scores[game.result.winners[0]] >= 250)
      game.stop()
    })
  } finally {
    console.warn = warn
  }
  assert.deepEqual(warnings, [])
})
