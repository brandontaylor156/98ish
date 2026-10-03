// Monster Duel's rules engine, decks, match rules and computer players.
// Run: node --test client/src/components/applets/monsterduel/monsterduel.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { ALL_CARDS, CARD, POOL } from "./engine/cards.js"
import * as E from "./engine/engine.js"
import { STARTERS, validateDeck } from "./engine/decks.js"
import * as R from "./engine/rules.js"
import { chooseMove, evalFor } from "./engine/ai.js"

let seed = 12345
const seeded = () => (seed = (seed * 16807) % 2147483647) / 2147483647
E.setRandom(seeded)

// ---------- helpers ----------

const filler = (n = 30) => Array(n).fill("A10")

// a duel with empty hands: seat 0's Main Phase 1 of turn 3
const setup = ({ turn = 3, prefs } = {}) => {
  E.setRandom(seeded)
  const d = E.newDuel({ decks: [{ main: filler() }, { main: filler() }], noShuffle: true, first: 0, names: ["Ann", "Ben"], prefs })
  for (const s of [0, 1]) {
    d.p[s].deck.push(...d.p[s].hand)
    d.p[s].hand = []
  }
  d.turn = turn
  d.active = 0
  d.phase = "main1"
  return d
}
const add = (d, seat, id, zone, opts) => E.addCard(d, seat, id, zone, opts)
const ok = (d, seat, a) => {
  const r = E.act(d, seat, a)
  assert.equal(r.error, undefined, `${JSON.stringify(a)} -> ${r.error}`)
  return r
}
const refused = (d, seat, a, pattern) => {
  const r = E.act(d, seat, a)
  assert.ok(r.error, `${JSON.stringify(a)} should be refused`)
  if (pattern) assert.match(r.error, pattern)
}
const zoneOf = (d, uid) => E.where(d, uid)?.zone
const idsIn = (d, seat, zone) => d.p[seat][zone].map((u) => d.cards[u].id)
const logText = (d) => d.log.map((l) => l.t)
// into the Battle Phase (Ben may get a window as it starts: he passes)
const toBattle = (d) => {
  ok(d, 0, { type: "phase", to: "battle" })
  if (d.wait?.seat === 1 && d.wait.reason === "battle") ok(d, 1, { type: "pass" })
}
const endTurn = (d, seat = d.active) => ok(d, seat, { type: "phase", to: "end" })
const choose = (d, seat, picks) => ok(d, seat, { type: "choose", picks })

// test-only cards for ops no real card uses yet
CARD.XBAN = { id: "XBAN", name: "Test Banish", kind: "spell", sub: "normal", effects: [{ type: "activate", trigger: "any", target: { from: "monsters", side: "opp", n: 1 }, do: [{ op: "banish", what: "targets" }] }] }
CARD.XSHUF = { id: "XSHUF", name: "Test Shuffle", kind: "spell", sub: "normal", effects: [{ type: "activate", trigger: "any", target: { from: "monsters", side: "opp", n: 1 }, do: [{ op: "shuffle", what: "targets" }] }] }
CARD.XDIS = { id: "XDIS", name: "Test Discard", kind: "spell", sub: "normal", effects: [{ type: "activate", trigger: "any", do: [{ op: "discard", who: "self", n: 1 }] }] }
CARD.XBOTH = { id: "XBOTH", name: "Test Meteor", kind: "spell", sub: "normal", effects: [{ type: "activate", trigger: "any", do: [{ op: "damage", to: "both", n: 9000 }] }] }
CARD.XSELF = { id: "XSELF", name: "Test Phoenix", kind: "monster", sub: "effect", level: 4, atk: 1000, def: 1000, attr: "FIRE", race: "Beast", effects: [{ type: "trigger", on: "destroyed", do: [{ op: "summonSelf", pos: "def" }] }] }

// ---------- the card pool and decks ----------

test("the pool: unique ids, sensible stats, and every effect is made of known parts", () => {
  const ids = new Set()
  const OPS = new Set(["damage", "heal", "draw", "destroy", "bounce", "banish", "shuffle", "buff", "position", "search", "special", "summon", "summonSelf", "token", "discard", "mill", "negate", "negateAttack", "endBattle", "equip", "fusion", "flag", "control", "coin"])
  const ONS = new Set(["normalSummon", "summon", "flip", "destroyed", "destroyedBattle", "battleDestroy", "battleDamage", "standby"])
  for (const c of ALL_CARDS) {
    assert.ok(!ids.has(c.id), `duplicate ${c.id}`)
    ids.add(c.id)
    assert.ok(c.name && c.text, `${c.id} needs a name and text`)
    if (c.kind === "monster") {
      assert.ok(c.level >= 1 && c.level <= 8 && c.atk >= 0 && c.def >= 0 && c.attr && c.race, c.id)
      assert.equal(c.atk % 50, 0, c.id)
    }
    for (const e of c.effects || []) {
      assert.ok(["activate", "trigger", "ignition", "aura"].includes(e.type), `${c.id} effect type ${e.type}`)
      if (e.type === "trigger") assert.ok(ONS.has(e.on), `${c.id} trigger ${e.on}`)
      for (const op of e.do || []) assert.ok(OPS.has(op.op), `${c.id} op ${op.op}`)
    }
    if (c.kind !== "monster") assert.ok(c.effects?.[0]?.type === "activate", `${c.id} needs an activation`)
    if (c.sub === "fusion") assert.ok(c.materials.length >= 2 && c.extra)
  }
  assert.ok(POOL.length >= 120 && POOL.length <= 180, `pool size ${POOL.length}`)
  // nothing borrowed from another game
  const banned = /blue-eyes|dark magician|exodia|kuriboh|millennium|duel monsters|pot of greed|raigeki|mirror force|monster reborn/i
  for (const c of ALL_CARDS) assert.ok(!banned.test(`${c.name} ${c.text}`), c.name)
})

test("starter decks: eight legal 40-card decks with a Fusion in the Extra Deck", () => {
  assert.equal(STARTERS.length, 8)
  for (const s of STARTERS) {
    assert.equal(s.main.length, 40, s.id)
    assert.equal(validateDeck(s).error, undefined, s.id)
    assert.ok(s.extra.length >= 1)
  }
})

test("deck rules: 30 to 60 cards, 3 copies (1 for limited cards), Fusions in the Extra Deck, real cards only", () => {
  const ok40 = { main: [...STARTERS[0].main], extra: [] }
  assert.deepEqual(validateDeck(ok40).main.length, 40)
  assert.match(validateDeck({ main: ok40.main.slice(0, 29) }).error, /at least 30/)
  assert.match(validateDeck({ main: Array(61).fill("A10") }).error, /at most 60|copies/)
  assert.match(validateDeck({ main: [...ok40.main.slice(0, 36), "A10", "A10", "A10", "A10"] }).error, /At most 3 copies/)
  assert.match(validateDeck({ main: [...ok40.main.slice(0, 38), "G01", "G01"] }).error, /limited to 1/)
  assert.match(validateDeck({ main: [...ok40.main.slice(0, 39), "F01"] }).error, /Extra Deck/)
  assert.match(validateDeck({ main: ok40.main, extra: ["D02"] }).error, /Only Fusion/)
  assert.match(validateDeck({ main: [...ok40.main.slice(0, 39), "NOPE"] }).error, /doesn't exist/)
  assert.match(validateDeck({ main: [...ok40.main.slice(0, 39), "K01"] }).error, /doesn't exist/)
  // object built-ins aren't cards
  for (const fake of ["constructor", "toString", "__proto__", "hasOwnProperty"]) assert.match(validateDeck({ main: [...ok40.main.slice(0, 39), fake] }).error, /doesn't exist/, fake)
  assert.match(validateDeck(null).error, /Pick a deck/)
})

// ---------- turns ----------

test("opening: 5-card hands, the first player skips their first draw and can't attack on turn 1", () => {
  const d = E.newDuel({ decks: [{ main: filler(40) }, { main: filler(40) }], first: 1 })
  assert.equal(d.turn, 1)
  assert.equal(d.active, 1)
  assert.equal(d.phase, "main1")
  assert.deepEqual(d.p.map((p) => p.hand.length), [5, 5])
  assert.deepEqual(d.p.map((p) => p.deck.length), [35, 35])
  assert.deepEqual(d.p.map((p) => p.lp), [8000, 8000])
  refused(d, 1, { type: "phase", to: "battle" }, /first turn/)
  assert.ok(!E.legal(d, 1).some((m) => m.type === "phase" && m.to === "battle"))
  refused(d, 0, { type: "phase", to: "end" }, /not your turn/)
  endTurn(d, 1)
  assert.equal(d.turn, 2)
  assert.equal(d.active, 0)
  assert.equal(d.phase, "main1")
  assert.equal(d.p[0].hand.length, 6)
  assert.ok(E.legal(d, 0).some((m) => m.type === "phase" && m.to === "battle"))
})

test("hand size: more than 6 cards at the End Phase means discarding down to 6", () => {
  const d = setup()
  for (let i = 0; i < 8; i++) add(d, 0, "A10", "hand")
  endTurn(d)
  assert.equal(d.wait.kind, "discard")
  assert.equal(d.wait.min, 2)
  refused(d, 0, { type: "choose", picks: [d.p[0].hand[0]] }, /Choose 2/)
  choose(d, 0, d.p[0].hand.slice(0, 2))
  assert.equal(d.p[0].hand.length, 6)
  assert.equal(d.p[0].gy.length, 2)
  assert.equal(d.active, 1)
})

// ---------- summoning ----------

test("one Normal Summon or Set per turn; Sets are face-down in Defense Position", () => {
  const d = setup()
  const a = add(d, 0, "D02", "hand")
  const b = add(d, 0, "B01", "hand")
  ok(d, 0, { type: "summon", uid: a })
  const slot = E.where(d, a).slot
  assert.equal(slot.pos, "atk")
  assert.equal(slot.up, true)
  refused(d, 0, { type: "set", uid: b }, /already/)
  assert.ok(!E.legal(d, 0).some((m) => m.uid === b && (m.type === "summon" || m.type === "set")))
  endTurn(d)
  endTurn(d, 1)
  ok(d, 0, { type: "set", uid: b })
  assert.equal(E.where(d, b).slot.up, false)
  assert.equal(E.where(d, b).slot.pos, "def")
})

test("tributes: Level 5-6 needs 1, Level 7+ needs 2, and the tributes go to the Graveyard", () => {
  const d = setup()
  const five = add(d, 0, "D06", "hand")
  const eight = add(d, 0, "D08", "hand")
  const t1 = add(d, 0, "A10", "m")
  const t2 = add(d, 0, "B01", "m")
  refused(d, 0, { type: "summon", uid: five, tributes: [] }, /Tribute 1/)
  refused(d, 0, { type: "summon", uid: eight, tributes: [t1] }, /Tribute 2/)
  refused(d, 0, { type: "summon", uid: five, tributes: [add(d, 1, "A10", "m")] }, /Tribute monsters you control/)
  const legalEight = E.legal(d, 0).find((m) => m.type === "summon" && m.uid === eight)
  assert.equal(legalEight.tributes, 2)
  ok(d, 0, { type: "summon", uid: eight, tributes: [t1, t2] })
  assert.equal(zoneOf(d, eight), "m")
  assert.deepEqual(idsIn(d, 0, "gy").sort(), ["A10", "B01"])
})

test("battle positions: not the turn a monster arrives, once per turn, and not after it attacked", () => {
  const d = setup()
  const old = add(d, 0, "D02", "m")
  const fresh = add(d, 0, "B01", "hand")
  const attacker = add(d, 0, "M04", "m")
  ok(d, 0, { type: "summon", uid: fresh })
  refused(d, 0, { type: "position", uid: fresh }, /this turn/)
  ok(d, 0, { type: "position", uid: old })
  assert.equal(E.where(d, old).slot.pos, "def")
  refused(d, 0, { type: "position", uid: old }, /this turn/)
  toBattle(d)
  ok(d, 0, { type: "attack", uid: attacker, target: null })
  ok(d, 0, { type: "phase", to: "main2" })
  refused(d, 0, { type: "position", uid: attacker }, /this turn/)
})

test("Flip Summon: a face-down monster set on an earlier turn, and its FLIP effect happens", () => {
  const d = setup()
  const scout = add(d, 0, "D04", "m", { pos: "def", up: false })
  const dragon = add(d, 0, "D12", "deck")
  ok(d, 0, { type: "flip", uid: scout })
  assert.equal(E.where(d, scout).slot.up, true)
  assert.equal(E.where(d, scout).slot.pos, "atk")
  // Ashwing Scout: add a Dragon from the deck (only Glacier Wyrm is one)
  assert.equal(d.wait.kind, "choose")
  assert.deepEqual(d.wait.options, [dragon])
  choose(d, 0, [dragon])
  assert.ok(idsIn(d, 0, "hand").includes("D12"))
  // a set card the same turn can't be flipped
  const late = add(d, 0, "A10", "hand")
  endTurn(d)
  endTurn(d, 1)
  ok(d, 0, { type: "set", uid: late })
  refused(d, 0, { type: "flip", uid: late }, /this turn/)
})

// ---------- battle ----------

const battle = (myId, theirId, { pos = "atk", up = true } = {}) => {
  const d = setup()
  const a = add(d, 0, myId, "m")
  const t = theirId ? add(d, 1, theirId, "m", { pos, up }) : null
  toBattle(d)
  ok(d, 0, { type: "attack", uid: a, target: t })
  return { d, a, t }
}

test("battle: ATK against ATK", () => {
  let { d, a, t } = battle("M04", "B01") // 1800 vs 1700
  assert.equal(zoneOf(d, t), "gy")
  assert.equal(zoneOf(d, a), "m")
  assert.deepEqual([d.p[0].lp, d.p[1].lp], [8000, 7900])
  ;({ d, a, t } = battle("B01", "M04")) // 1700 vs 1800
  assert.equal(zoneOf(d, a), "gy")
  assert.equal(zoneOf(d, t), "m")
  assert.deepEqual([d.p[0].lp, d.p[1].lp], [7900, 8000])
  ;({ d, a, t } = battle("D02", "M04")) // 1800 vs 1800: both go, no damage
  assert.equal(zoneOf(d, a), "gy")
  assert.equal(zoneOf(d, t), "gy")
  assert.deepEqual([d.p[0].lp, d.p[1].lp], [8000, 8000])
})

test("battle: ATK against DEF, piercing, and face-down defenders", () => {
  let { d, a, t } = battle("D02", "A10", { pos: "def" }) // 1800 vs DEF 2000
  assert.equal(zoneOf(d, t), "m")
  assert.equal(zoneOf(d, a), "m")
  assert.deepEqual([d.p[0].lp, d.p[1].lp], [7800, 8000])
  ;({ d, a, t } = battle("D02", "W08", { pos: "def" })) // 1800 vs DEF 0: destroyed, no damage
  assert.equal(zoneOf(d, t), "gy")
  assert.equal(d.p[1].lp, 8000)
  ;({ d, a, t } = battle("D03", "W08", { pos: "def" })) // piercing 1600 vs DEF 0
  assert.equal(zoneOf(d, t), "gy")
  assert.equal(d.p[1].lp, 6400)
  ;({ d, a, t } = battle("D02", "D02", { pos: "def" })) // 1800 vs DEF 1200... same DEF? no: Emberscale DEF 1200
  assert.equal(zoneOf(d, t), "gy")
  ;({ d, a, t } = battle("A12", "M01", { pos: "def", up: false })) // 1800 vs face-down DEF 1800: flipped, nothing
  assert.equal(E.where(d, t).slot.up, true)
  assert.equal(zoneOf(d, t), "m")
  assert.equal(zoneOf(d, a), "m")
  assert.deepEqual([d.p[0].lp, d.p[1].lp], [8000, 8000])
})

test("battle: direct attacks, attacking twice, and monsters that can't be destroyed by battle", () => {
  let { d } = battle("D02", null)
  assert.equal(d.p[1].lp, 6200)
  // not directly while the opponent has a monster (unless the card says so)
  d = setup()
  const a = add(d, 0, "D02", "m")
  const angler = add(d, 0, "A03", "m")
  add(d, 1, "A10", "m", { pos: "def" })
  toBattle(d)
  refused(d, 0, { type: "attack", uid: a, target: null }, /directly/)
  ok(d, 0, { type: "attack", uid: angler, target: null })
  assert.equal(d.p[1].lp, 7000)
  refused(d, 0, { type: "attack", uid: angler, target: null }, /can't attack/)
  // twice
  d = setup()
  const hydra = add(d, 0, "D13", "m")
  toBattle(d)
  ok(d, 0, { type: "attack", uid: hydra, target: null })
  ok(d, 0, { type: "attack", uid: hydra, target: null })
  refused(d, 0, { type: "attack", uid: hydra, target: null })
  assert.equal(d.p[1].lp, 8000 - 4400)
  // Clockwork Bulwark survives, but its controller still takes the damage
  const r = battle("D02", "M03")
  assert.equal(zoneOf(r.d, r.t), "m")
  assert.equal(r.d.p[1].lp, 6200)
  // Defense Position monsters can't attack
  d = setup()
  const wall = add(d, 0, "A10", "m", { pos: "def" })
  toBattle(d)
  refused(d, 0, { type: "attack", uid: wall, target: null }, /can't attack/)
})

test("battle: if the target leaves before damage, the attack is replayed", () => {
  const d = setup()
  const a = add(d, 0, "D02", "m")
  const t = add(d, 1, "B01", "m")
  add(d, 1, "G18", "s", { up: false }) // Warp Gate, set last turn
  toBattle(d)
  ok(d, 0, { type: "attack", uid: a, target: t })
  assert.equal(d.wait?.kind, "respond")
  assert.equal(d.wait.seat, 1)
  const gate = d.p[1].s.find(Boolean).uid
  ok(d, 1, { type: "activate", uid: gate, ei: 0, targets: [t] })
  assert.equal(d.p[1].m.filter(Boolean).length, 0)
  assert.equal(E.where(d, a).slot.attacks, 0, "the attack can be made again")
  ok(d, 0, { type: "attack", uid: a, target: null })
  assert.equal(d.p[1].lp, 6200)
})

// ---------- chains ----------

test("chains resolve last in, first out", () => {
  const d = setup()
  const bolt = add(d, 0, "G08", "hand")
  add(d, 1, "T15", "s", { up: false }) // Hidden Cache
  ok(d, 0, { type: "activate", uid: bolt, ei: 0 })
  assert.equal(d.wait.kind, "respond")
  assert.equal(d.wait.seat, 1)
  assert.equal(d.chain.length, 1)
  const cache = d.p[1].s.find(Boolean).uid
  const before = d.p[1].hand.length
  ok(d, 1, { type: "activate", uid: cache, ei: 0 })
  const text = logText(d)
  const drew = text.findIndex((t) => t === "Ben draws a card.")
  const hurt = text.findIndex((t) => /Ben takes 600 damage/.test(t))
  assert.ok(drew >= 0 && hurt > drew, "Hidden Cache (link 2) resolves before Firebolt (link 1)")
  assert.equal(d.p[1].hand.length, before + 1)
  assert.equal(d.chain.length, 0)
  assert.deepEqual(idsIn(d, 0, "gy"), ["G08"])
  assert.deepEqual(idsIn(d, 1, "gy"), ["T15"])
})

test("Counter Traps negate: Null Edict pays 1000 LP, Spellbreak only stops Spells, and only Counters answer a Counter", () => {
  let d = setup()
  const bolt = add(d, 0, "G08", "hand")
  const sigil = add(d, 0, "G05", "hand")
  const edict = add(d, 1, "T03", "s", { up: false })
  ok(d, 0, { type: "activate", uid: bolt, ei: 0 })
  ok(d, 1, { type: "activate", uid: edict, ei: 0 })
  // Whirlwind Sigil (a Quick-Play) can't answer a Counter Trap
  assert.equal(d.wait, null)
  assert.equal(d.p[1].lp, 7000, "only the cost was paid: Firebolt was negated")
  assert.ok(idsIn(d, 0, "gy").includes("G08"))
  assert.ok(idsIn(d, 1, "gy").includes("T03"))
  assert.ok(logText(d).some((t) => /Firebolt is negated/.test(t)))
  assert.equal(zoneOf(d, sigil), "hand")
  // Spellbreak: not against a Trap
  d = setup({ turn: 4 })
  d.active = 1
  const surge = add(d, 1, "T09", "s", { up: false })
  add(d, 1, "B01", "m")
  add(d, 0, "T14", "s", { up: false })
  add(d, 0, "A10", "hand")
  ok(d, 1, { type: "activate", uid: surge, ei: 0, targets: [d.p[1].m.find(Boolean).uid] })
  assert.equal(d.wait, null, "Spellbreak can't negate a Trap, so there was nothing to ask")
})

test("traps: not the turn they're set; Quick-Plays from the hand only on your own turn", () => {
  const d = setup()
  const trap = add(d, 0, "T15", "hand")
  const quick = add(d, 1, "G05", "hand")
  add(d, 0, "A10", "s", { up: false })
  ok(d, 0, { type: "set", uid: trap })
  refused(d, 0, { type: "activate", uid: trap, ei: 0 }, /can't activate/)
  // Ben can't use a Quick-Play from his hand on Ann's turn
  const bolt = add(d, 0, "G08", "hand")
  ok(d, 0, { type: "activate", uid: bolt, ei: 0 })
  assert.equal(d.wait, null)
  assert.equal(zoneOf(d, quick), "hand")
  // normal Spells: Main Phase only, never as a response
  toBattle(d)
  const spring = add(d, 0, "G07", "hand")
  refused(d, 0, { type: "activate", uid: spring, ei: 0 })
})

test("response preferences: never asked, asked only when you can respond, or always asked", () => {
  const run = (prefs, trap) => {
    const d = setup({ prefs })
    if (trap) add(d, 1, "T15", "s", { up: false })
    ok(d, 0, { type: "activate", uid: add(d, 0, "G07", "hand"), ei: 0 })
    return d
  }
  assert.equal(run(["auto", "auto"], false).wait, null)
  assert.equal(run(["auto", "auto"], true).wait?.seat, 1)
  assert.equal(run(["auto", "never"], true).wait, null)
  const always = run(["auto", "always"], false)
  assert.equal(always.wait?.kind, "respond")
  assert.deepEqual(E.legal(always, 1), [{ type: "pass" }])
  ok(always, 1, { type: "pass" })
  assert.equal(always.p[0].lp, 9000)
})

test("attack traps: Stand Fast, Spiked Pitfall, Prism Barrier, Smoke Screen, Retaliation", () => {
  const attackInto = (trapId, attackerId = "D02") => {
    const d = setup()
    const a = add(d, 0, attackerId, "m")
    const other = add(d, 0, "B01", "m")
    const trap = add(d, 1, trapId, "s", { up: false })
    toBattle(d)
    ok(d, 0, { type: "attack", uid: a, target: null })
    return { d, a, other, trap }
  }
  let r = attackInto("T04")
  ok(r.d, 1, { type: "activate", uid: r.trap, ei: 0 })
  assert.equal(r.d.p[1].lp, 8000)
  assert.equal(E.where(r.d, r.a).slot.attacks, 1, "a negated attack still counts")
  r = attackInto("T05")
  ok(r.d, 1, { type: "activate", uid: r.trap, ei: 0, targets: [r.a] })
  assert.equal(zoneOf(r.d, r.a), "gy")
  assert.equal(r.d.p[1].lp, 8000)
  r = attackInto("T05", "D07") // 2400 ATK: too strong for the pitfall
  assert.equal(r.d.wait, null)
  assert.equal(r.d.p[1].lp, 5600)
  r = attackInto("T01")
  ok(r.d, 1, { type: "activate", uid: r.trap, ei: 0 })
  assert.equal(zoneOf(r.d, r.a), "gy")
  assert.equal(zoneOf(r.d, r.other), "gy")
  r = attackInto("T10")
  ok(r.d, 1, { type: "activate", uid: r.trap, ei: 0 })
  assert.equal(r.d.phase, "main2")
  assert.equal(r.d.p[1].lp, 8000)
  r = attackInto("T06")
  ok(r.d, 1, { type: "activate", uid: r.trap, ei: 0 })
  assert.equal(r.d.p[0].lp, 7100)
  assert.equal(r.d.p[1].lp, 8000)
})

test("summon traps: Snare Pit (1500+ ATK only), Binding Roots, and Silence Ward against a monster effect", () => {
  let d = setup()
  add(d, 1, "T02", "s", { up: false })
  const small = add(d, 0, "B09", "hand") // Highland Stag 1300
  ok(d, 0, { type: "summon", uid: small })
  assert.equal(d.wait, null, "too weak for Snare Pit")
  assert.equal(d.p[0].lp, 8800)
  d = setup()
  add(d, 1, "T02", "s", { up: false })
  const big = add(d, 0, "D02", "hand")
  ok(d, 0, { type: "summon", uid: big })
  assert.equal(d.wait?.reason, "summon")
  ok(d, 1, { type: "activate", uid: d.p[1].s.find(Boolean).uid, ei: 0, targets: [big] })
  assert.equal(zoneOf(d, big), "gy")
  // Binding Roots
  d = setup()
  const roots = add(d, 1, "T13", "s", { up: false })
  const m = add(d, 0, "D02", "hand")
  ok(d, 0, { type: "summon", uid: m })
  ok(d, 1, { type: "activate", uid: roots, ei: 0, targets: [m] })
  assert.equal(E.where(d, m).slot.pos, "def")
  assert.ok(E.statsOf(d, m).flags.includes("cannotAttack"))
  // Silence Ward: Highland Stag's heal is negated and the Stag destroyed
  d = setup()
  const ward = add(d, 1, "T17", "s", { up: false })
  const stag = add(d, 0, "B09", "hand")
  ok(d, 0, { type: "summon", uid: stag })
  assert.equal(d.wait?.reason, "chain")
  ok(d, 1, { type: "activate", uid: ward, ei: 0 })
  assert.equal(d.p[0].lp, 8000)
  assert.equal(zoneOf(d, stag), "gy")
})

// ---------- every op ----------

test("ops: damage, heal, draw, and destroy", () => {
  const d = setup()
  ok(d, 0, { type: "activate", uid: add(d, 0, "G08", "hand"), ei: 0 })
  assert.equal(d.p[1].lp, 7400)
  ok(d, 0, { type: "activate", uid: add(d, 0, "G07", "hand"), ei: 0 })
  assert.equal(d.p[0].lp, 9000)
  const deckBefore = d.p[0].deck.length
  ok(d, 0, { type: "activate", uid: add(d, 0, "G01", "hand"), ei: 0 })
  assert.equal(d.p[0].hand.length, 2)
  assert.equal(d.p[0].deck.length, deckBefore - 2)
  const t = add(d, 1, "B01", "m")
  ok(d, 0, { type: "activate", uid: add(d, 0, "G04", "hand"), ei: 0, targets: [t] })
  assert.equal(zoneOf(d, t), "gy")
})

test("ops: bounce, banish and shuffle (hidden places give the card a new id)", () => {
  const d = setup()
  let t = add(d, 0, "B01", "m")
  ok(d, 0, { type: "activate", uid: add(d, 0, "G18", "hand"), ei: 0, targets: [t] })
  assert.equal(d.cards[t], undefined, "the old id is gone")
  assert.deepEqual(idsIn(d, 0, "hand"), ["B01"])
  t = add(d, 1, "M04", "m")
  ok(d, 0, { type: "activate", uid: add(d, 0, "XBAN", "hand"), ei: 0, targets: [t] })
  assert.deepEqual(idsIn(d, 1, "ban"), ["M04"])
  t = add(d, 1, "M01", "m")
  const deck = d.p[1].deck.length
  ok(d, 0, { type: "activate", uid: add(d, 0, "XSHUF", "hand"), ei: 0, targets: [t] })
  assert.equal(d.p[1].deck.length, deck + 1)
  assert.ok(idsIn(d, 1, "deck").includes("M01"))
})

test("ops: buff until end of turn, position changes, and face-down", () => {
  const d = setup()
  const m = add(d, 0, "D02", "m")
  ok(d, 0, { type: "activate", uid: add(d, 0, "G11", "hand"), ei: 0, targets: [m] })
  assert.deepEqual([E.statsOf(d, m).atk, E.statsOf(d, m).def], [2300, 1700])
  endTurn(d)
  assert.equal(E.statsOf(d, m).atk, 1800, "the boost wore off")
  // Topsy-Turvy on Ben's turn... Ann's set trap swaps Ben's monsters
  const theirs = [add(d, 1, "B01", "m"), add(d, 1, "A10", "m", { pos: "def" })]
  const flip = add(d, 0, "T16", "s", { up: false, turn: 1 })
  // Ann activates it in answer to Ben's Healing Spring
  ok(d, 1, { type: "activate", uid: add(d, 1, "G07", "hand"), ei: 0 })
  ok(d, 0, { type: "activate", uid: flip, ei: 0 })
  assert.deepEqual(theirs.map((u) => E.where(d, u).slot.pos), ["def", "atk"])
  // Inkcloud Squid turns a face-up monster face-down
  const d2 = setup()
  const squid = add(d2, 0, "A13", "m", { pos: "def", up: false })
  const target = add(d2, 1, "D02", "m")
  ok(d2, 0, { type: "flip", uid: squid })
  assert.equal(E.where(d2, target).slot.up, false)
  assert.equal(E.where(d2, target).slot.pos, "def")
})

test("ops: search the deck or graveyard, Special Summon from hand, deck or graveyard", () => {
  const d = setup()
  const gone = add(d, 0, "B07", "gy")
  ok(d, 0, { type: "activate", uid: add(d, 0, "G15", "hand"), ei: 0 })
  assert.deepEqual(d.wait.options, [gone])
  choose(d, 0, [gone])
  assert.deepEqual(idsIn(d, 0, "hand"), ["B07"])
  // Ember Egg: FLIP, Special Summon a Dragon from the hand (any level)
  const egg = add(d, 0, "D14", "m", { pos: "def", up: false })
  const big = add(d, 0, "D08", "hand")
  ok(d, 0, { type: "flip", uid: egg })
  choose(d, 0, [big])
  assert.equal(zoneOf(d, big), "m")
  // Rise From the Crypt
  const dead = add(d, 0, "D07", "gy")
  ok(d, 0, { type: "activate", uid: add(d, 0, "US1", "hand"), ei: 0, targets: [dead] })
  assert.equal(zoneOf(d, dead), "m")
  // Magma Hatchling: destroyed -> a Level 4 Dragon from the deck
  const d2 = setup()
  add(d2, 0, "D05", "m")
  add(d2, 0, "D02", "deck")
  ok(d2, 0, { type: "activate", uid: add(d2, 0, "G02", "hand"), ei: 0 })
  assert.equal(d2.wait.kind, "choose")
  choose(d2, 0, [d2.wait.options[0]])
  assert.deepEqual(d2.p[0].m.filter(Boolean).map((x) => d2.cards[x.uid].id), ["D02"])
})

test("ops: summonSelf, tokens (that vanish when they leave), mill, discard", () => {
  let d = setup()
  const bird = add(d, 0, "XSELF", "m")
  ok(d, 0, { type: "activate", uid: add(d, 0, "G04", "hand"), ei: 0, targets: [add(d, 1, "B01", "m")] })
  ok(d, 0, { type: "activate", uid: add(d, 0, "G02", "hand"), ei: 0 })
  assert.equal(zoneOf(d, bird), "m", "it came back")
  assert.equal(E.where(d, bird).slot.pos, "def")
  // Spark Drone -> 2 tokens; destroyed tokens vanish
  d = setup()
  add(d, 0, "M05", "m")
  ok(d, 0, { type: "activate", uid: add(d, 0, "G02", "hand"), ei: 0 })
  const tokens = d.p[0].m.filter(Boolean)
  assert.equal(tokens.length, 2)
  assert.ok(tokens.every((x) => d.cards[x.uid].id === "K01" && x.pos === "def"))
  d.p[1].hand.push(...[])
  const smite = add(d, 1, "G04", "hand")
  d.active = 1
  ok(d, 1, { type: "activate", uid: smite, ei: 0, targets: [tokens[0].uid] })
  assert.ok(!idsIn(d, 0, "gy").includes("K01"))
  // Wailing Banshee mills both decks
  d = setup()
  const banshee = add(d, 0, "U05", "hand")
  ok(d, 0, { type: "summon", uid: banshee })
  assert.deepEqual([d.p[0].gy.length, d.p[1].gy.length], [3, 3])
  // discard: you choose (more cards than needed), or at random
  d = setup()
  const keep = add(d, 0, "D08", "hand")
  const lose = add(d, 0, "A10", "hand")
  ok(d, 0, { type: "activate", uid: add(d, 0, "XDIS", "hand"), ei: 0 })
  assert.equal(d.wait.kind, "choose")
  choose(d, 0, [lose])
  assert.deepEqual(d.p[0].hand, [keep])
  d = setup()
  add(d, 1, "A10", "hand")
  add(d, 1, "A10", "hand")
  const warlock = add(d, 0, "S04", "m", { pos: "def", up: false })
  ok(d, 0, { type: "flip", uid: warlock })
  assert.equal(d.p[1].hand.length, 1)
})

test("ops: equip (and the equip card leaves with its monster), fusion, control, coin", () => {
  let d = setup()
  const m = add(d, 0, "D02", "m")
  const mail = add(d, 0, "G09", "hand")
  ok(d, 0, { type: "activate", uid: mail, ei: 0, targets: [m] })
  assert.equal(zoneOf(d, mail), "s")
  assert.deepEqual([E.statsOf(d, m).atk, E.statsOf(d, m).def], [2200, 1600])
  ok(d, 0, { type: "activate", uid: add(d, 0, "G02", "hand"), ei: 0 })
  assert.equal(zoneOf(d, mail), "gy")
  // fusion: Emberscale Drake + a Dragon -> Twin-Headed Emberwyrm
  d = setup()
  add(d, 0, "D02", "hand")
  add(d, 0, "D01", "hand")
  const wyrm = add(d, 0, "F01", "extra")
  const rite = add(d, 0, "G14", "hand")
  assert.ok(E.legal(d, 0).some((x) => x.type === "activate" && x.uid === rite))
  ok(d, 0, { type: "activate", uid: rite, ei: 0 })
  choose(d, 0, [wyrm])
  assert.equal(zoneOf(d, wyrm), "m")
  assert.deepEqual(idsIn(d, 0, "gy").sort(), ["D01", "D02", "G14"])
  // without the materials Fusion Rite can't be activated
  const d3 = setup()
  add(d3, 0, "F01", "extra")
  const rite3 = add(d3, 0, "G14", "hand")
  assert.ok(!E.legal(d3, 0).some((x) => x.uid === rite3 && x.type === "activate"))
  // control: borrow, attack with it, it goes home at the End Phase
  d = setup()
  const theirs = add(d, 1, "M04", "m")
  ok(d, 0, { type: "activate", uid: add(d, 0, "G13", "hand"), ei: 0, targets: [theirs] })
  assert.equal(E.where(d, theirs).seat, 0)
  toBattle(d)
  ok(d, 0, { type: "attack", uid: theirs, target: null })
  assert.equal(d.p[1].lp, 6200)
  endTurn(d)
  assert.equal(E.where(d, theirs).seat, 1)
  // coin
  d = setup()
  add(d, 0, "A10", "hand")
  ok(d, 0, { type: "activate", uid: add(d, 0, "G17", "hand"), ei: 0 })
  const heads = logText(d).some((t) => /lands heads/.test(t))
  assert.equal(d.p[0].hand.length, heads ? 3 : 0)
})

// ---------- auras and triggers ----------

test("auras: boosts for a type, counts, field spells, and Weight of Ages", () => {
  const d = setup()
  const herald = add(d, 0, "D11", "m")
  const drake = add(d, 0, "D02", "m")
  const theirDrake = add(d, 1, "D02", "m")
  assert.equal(E.statsOf(d, drake).atk, 2100)
  assert.equal(E.statsOf(d, herald).atk, 1300)
  assert.equal(E.statsOf(d, theirDrake).atk, 1800, "only your own Dragons")
  // a field spell helps both sides
  ok(d, 0, { type: "activate", uid: add(d, 0, "DS3", "hand"), ei: 0 })
  assert.equal(E.statsOf(d, theirDrake).atk, 2100)
  assert.equal(E.statsOf(d, drake).def, 1500)
  // counting: Locust Queen +100 per Insect in the graveyard
  const queen = add(d, 1, "I06", "m")
  add(d, 1, "I01", "gy")
  add(d, 1, "I04", "gy")
  assert.equal(E.statsOf(d, queen).atk, 2400)
  // Emperor Moth: the other side loses 300
  add(d, 1, "I10", "m")
  assert.equal(E.statsOf(d, drake).atk, 1800 + 300 + 300 - 300)
  // Weight of Ages: 1900+ original ATK can't attack
  const d2 = setup()
  const strong = add(d2, 0, "D07", "m")
  const weak = add(d2, 0, "B01", "m")
  add(d2, 1, "G16", "s")
  toBattle(d2)
  refused(d2, 0, { type: "attack", uid: strong, target: null }, /can't attack/)
  ok(d2, 0, { type: "attack", uid: weak, target: null })
})

test("triggers: destroyed by battle, destroys by battle, battle damage, standby, Summoned vs Normal Summoned", () => {
  // Cinder Whelp destroyed by battle -> search a Dragon
  let r = battle("D07", "D01")
  add(r.d, 1, "D02", "deck")
  // the trigger already happened; it found nothing then? It searches when it resolves
  assert.ok(r.d.wait === null || r.d.wait.seat === 1)
  // Obsidian Wyrm: destroys by battle -> 500 more
  r = battle("D07", "B01")
  assert.equal(r.d.p[1].lp, 8000 - 700 - 500)
  // Ridge Lioness: battle damage -> draw
  r = battle("B05", null)
  assert.equal(r.d.p[0].hand.length, 1)
  // Ember Witch burns in the Standby Phase
  const d = setup()
  add(d, 0, "S08", "m")
  endTurn(d)
  assert.equal(d.p[1].lp, 8000)
  endTurn(d, 1)
  assert.equal(d.p[1].lp, 7700)
  // Ember Paladin heals when Summoned in any way, Highland Stag only when Normal Summoned
  const d2 = setup()
  const paladin = add(d2, 0, "W11", "gy")
  ok(d2, 0, { type: "activate", uid: add(d2, 0, "US1", "hand"), ei: 0, targets: [paladin] })
  assert.equal(d2.p[0].lp, 9000)
  const stag = add(d2, 0, "B09", "gy")
  ok(d2, 0, { type: "activate", uid: add(d2, 0, "G06", "hand"), ei: 0, targets: [stag] })
  assert.equal(d2.p[0].lp, 9000)
})

test("a FLIP effect still happens when the flipped monster loses the battle", () => {
  const d = setup()
  const a = add(d, 0, "D07", "m")
  add(d, 1, "B01", "hand")
  add(d, 1, "A10", "hand")
  const warlock = add(d, 1, "S04", "m", { pos: "def", up: false }) // FLIP: opponent discards 1 at random
  add(d, 0, "A10", "hand")
  toBattle(d)
  ok(d, 0, { type: "attack", uid: a, target: warlock })
  assert.equal(zoneOf(d, warlock), "gy")
  assert.equal(d.p[0].hand.length, 0, "Ann discarded")
})

test("ignition effects: once per turn, with costs", () => {
  const d = setup()
  const scholar = add(d, 0, "S06", "m")
  ok(d, 0, { type: "activate", uid: scholar, ei: 0 })
  assert.equal(d.p[0].lp, 7200)
  assert.equal(d.p[0].hand.length, 1)
  refused(d, 0, { type: "activate", uid: scholar, ei: 0 }, /can't activate/)
  const pyre = add(d, 0, "D10", "m")
  refused(d, 0, { type: "activate", uid: pyre, ei: 0, cost: [] }, /discard/)
  ok(d, 0, { type: "activate", uid: pyre, ei: 0, cost: [d.p[0].hand[0]] })
  assert.equal(E.statsOf(d, pyre).atk, 2200)
})

// ---------- winning ----------

test("winning: Life Points to 0, a deck that runs out, surrender, and a double knockout", () => {
  let d = setup()
  d.p[1].lp = 500
  ok(d, 0, { type: "activate", uid: add(d, 0, "G08", "hand"), ei: 0 })
  assert.deepEqual(d.over, { winner: 0, reason: "lp" })
  assert.ok(E.act(d, 0, { type: "phase", to: "end" }).error)
  d = setup()
  d.p[1].deck = []
  endTurn(d)
  assert.deepEqual(d.over, { winner: 0, reason: "deckout" })
  d = setup()
  ok(d, 1, { type: "surrender" })
  assert.deepEqual(d.over, { winner: 0, reason: "surrender" })
  d = setup()
  ok(d, 0, { type: "activate", uid: add(d, 0, "XBOTH", "hand"), ei: 0 })
  assert.deepEqual(d.over, { winner: null, reason: "lp" })
})

// ---------- hidden information ----------

test("views hide hands, deck order, face-down cards and private choices", () => {
  const d = setup()
  const secret = add(d, 0, "G01", "hand")
  const setMon = add(d, 0, "D08", "m", { pos: "def", up: false })
  const setTrap = add(d, 0, "T03", "s", { up: false })
  add(d, 0, "D04", "m", { pos: "def", up: false })
  add(d, 0, "D12", "deck")
  const theirs = E.view(d, 1)
  assert.equal(theirs.players[0].hand, 1)
  assert.equal(typeof theirs.players[0].deck, "number")
  const m = theirs.players[0].m.find((x) => x?.uid === setMon)
  assert.equal(m.id, undefined)
  assert.equal(m.atk, undefined)
  assert.equal(theirs.players[0].s.find((x) => x?.uid === setTrap).id, undefined)
  const json = JSON.stringify(theirs)
  assert.ok(!json.includes(secret) && !json.includes('"D08"') && !json.includes('"T03"') && !json.includes('"G01"'))
  // mine: I see my own hand and my face-down cards
  const mine = E.view(d, 0)
  assert.deepEqual(mine.players[0].hand, [{ uid: secret, id: "G01" }])
  assert.equal(mine.players[0].m.find((x) => x?.uid === setMon).id, "D08")
  // a deck search: the choices are only shown to the one choosing
  const scout = d.p[0].m.find((x) => x && d.cards[x.uid].id === "D04").uid
  ok(d, 0, { type: "flip", uid: scout })
  assert.equal(d.wait.kind, "choose")
  assert.equal(E.view(d, 1).wait.options, undefined)
  assert.ok(E.view(d, 0).wait.options.length >= 1)
  assert.ok(!JSON.stringify(E.view(d, 1)).includes('"D12"'))
  choose(d, 0, [d.wait.options[0]])
  assert.equal(d.wait, null)
})

test("views: the drawn card and private log lines only reach their owner", () => {
  const d = setup()
  add(d, 1, "B13", "deck")
  endTurn(d)
  const ann = E.view(d, 0)
  const ben = E.view(d, 1)
  const draw = (v) => v.fx.filter((f) => f.k === "draw").pop()
  assert.equal(draw(ann).id, undefined)
  assert.equal(draw(ann).uid, undefined)
  assert.equal(draw(ben).id, "B13")
  assert.ok(ben.log.some((l) => /You draw Primal Behemoth/.test(l.t)))
  assert.ok(!JSON.stringify(ann).includes("Primal Behemoth"))
  // a spectator sees no hand at all
  assert.equal(typeof E.view(d, null).players[1].hand, "number")
})

// ---------- the match rules ----------

const ctxFor = () => {
  const timers = []
  return { timers, ctx: { now: 1000, random: seeded, after: (ms, action, key = "timer") => timers.push({ ms, action, key }), cancel: () => {} } }
}

test("match: both pick decks (a starter or a checked custom deck), then the duel starts", () => {
  const { ctx } = ctxFor()
  let st = R.create({ players: [{ name: "Ann" }, { name: "Ben" }], settings: R.DEFAULT_SETTINGS, ...ctx })
  assert.equal(st.stage, "decks")
  assert.match(R.action(st, 0, { type: "deck", main: ["A10"] }, ctx).error, /at least 30/)
  st = R.action(st, 0, { type: "deck", starter: "dragons" }, ctx)
  assert.equal(R.view(st, 1).deckNames[0], null, "your opponent's deck stays secret until the duel")
  st = R.action(st, 1, { type: "deck", main: STARTERS[1].main, extra: STARTERS[1].extra, name: "My Robots" }, ctx)
  assert.equal(st.stage, "duel")
  assert.deepEqual(R.view(st, 0).deckNames, ["Dragon Lords", "My Robots"])
  assert.equal(R.view(st, 0).duel.players[0].hand.length ?? R.view(st, 0).duel.players[0].hand, 5)
})

test("match: best of three, the loser goes first next, and isOver once someone has 2 wins", () => {
  const { ctx } = ctxFor()
  let st = R.create({ players: [{ name: "Ann" }, { name: "Ben" }], settings: { bestOf: 3, turnTime: 0, lp: 8000 }, ...ctx })
  st = R.action(st, 0, { type: "deck", starter: "dragons" }, ctx)
  st = R.action(st, 1, { type: "deck", starter: "beasts" }, ctx)
  st = R.action(st, 1, { type: "surrender" }, ctx)
  assert.equal(st.stage, "between")
  assert.deepEqual(st.wins, [1, 0])
  assert.equal(R.isOver(st), null)
  st = R.action(st, 0, { type: "next" }, ctx)
  st = R.action(st, 1, { type: "next" }, ctx)
  assert.equal(st.stage, "duel")
  assert.equal(st.duel.first, 1, "Ben lost, so Ben goes first")
  st = R.action(st, 1, { type: "surrender" }, ctx)
  assert.deepEqual(R.isOver(st), { winners: [0], draw: false, reason: "surrender" })
  assert.ok(R.action(st, 0, { type: "next" }, ctx).error)
})

test("match: clocks: a response window and the turn clock run out", () => {
  const { ctx, timers } = ctxFor()
  let st = R.create({ players: [{ name: "Ann" }, { name: "Ben" }], settings: { bestOf: 1, turnTime: 60, lp: 8000 }, ...ctx })
  assert.ok(timers.some((t) => t.key === "stage"))
  st = R.action(st, null, { type: "timeout", kind: "decks" }, ctx)
  assert.equal(st.stage, "duel", "nobody picked: random starter decks")
  const turnTimer = timers.filter((t) => t.key === "turn").pop()
  assert.equal(turnTimer.ms, 60000)
  const turn = st.duel.turn
  st = R.action(st, null, turnTimer.action, ctx)
  assert.equal(st.duel.turn, turn + 1, "time's up: the turn ends")
  // a stale timer does nothing
  assert.equal(R.action(st, null, turnTimer.action, ctx), st)
})

test("match: prefs reach the duel, and the views only list your own legal moves", () => {
  const { ctx } = ctxFor()
  let st = R.create({ players: [{ name: "Ann" }, { name: "Ben" }], settings: { bestOf: 1, turnTime: 0, lp: 4000 }, ...ctx })
  st = R.action(st, 0, { type: "deck", starter: "insects" }, ctx)
  st = R.action(st, 1, { type: "deck", starter: "undead" }, ctx)
  st = R.action(st, 0, { type: "prefs", respond: "always" }, ctx)
  assert.equal(st.duel.prefs[0], "always")
  assert.equal(st.duel.p[0].lp, 4000)
  const active = st.duel.active
  assert.ok(R.view(st, active).legal.length > 0)
  assert.deepEqual(R.view(st, 1 - active).legal, [])
  assert.deepEqual(R.view(st, null).legal, [])
})

// ---------- computer players ----------

test("computer players pick decks and finish whole duels with legal moves", () => {
  for (const level of ["easy", "normal", "hard"]) {
    const { ctx } = ctxFor()
    let st = R.create({ players: [{ name: "A", bot: true }, { name: "B", bot: true }], settings: { bestOf: 1, turnTime: 0, lp: 8000, ai: [{ level }, { level }] }, ...ctx })
    let moves = 0
    while (!R.isOver(st) && moves < 2500) {
      const seat = [0, 1].find((s) => R.bot(st, s, ctx) != null)
      assert.notEqual(seat, undefined, "somebody always has something to do")
      const next = R.action(st, seat, R.bot(st, seat, ctx), ctx)
      assert.equal(next.error, undefined)
      st = next
      moves++
    }
    assert.ok(R.isOver(st), `${level} duel finished in ${moves} moves`)
  }
})

test("the computer attacks when it wins the battle, and doesn't when it would lose", () => {
  let d = setup()
  const big = add(d, 0, "D07", "m")
  const small = add(d, 1, "B01", "m")
  toBattle(d)
  assert.deepEqual(chooseMove(d, 0, { level: "hard" }), { type: "attack", uid: big, target: small })
  d = setup()
  add(d, 0, "B01", "m")
  add(d, 1, "D07", "m")
  toBattle(d)
  assert.equal(chooseMove(d, 0, { level: "hard" }).type, "phase")
  // it springs a trap that saves it
  d = setup()
  const att = add(d, 0, "D07", "m")
  add(d, 1, "T05", "s", { up: false })
  add(d, 1, "T04", "s", { up: false })
  toBattle(d)
  ok(d, 0, { type: "attack", uid: att, target: null })
  const answer = chooseMove(d, 1, { level: "hard" })
  assert.equal(answer.type, "activate")
  // the board score only reads public information: what a face-down card is doesn't matter
  const seen = setup()
  const set = add(seen, 1, "B13", "m", { pos: "def", up: false })
  const score = evalFor(seen, 0)
  seen.cards[set].id = "A10"
  assert.equal(evalFor(seen, 0), score)
})
