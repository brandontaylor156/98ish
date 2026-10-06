// Boom Frenzy's rules. Run: node --test client/src/components/applets/boomfrenzy/boomfrenzy.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as E from "./engine.js"
import * as S from "./sort.js"

// a game with no bombs coming on their own (so a test places exactly what it wants)
const quiet = (opts = {}) => {
  const s = E.newGame({ seed: 7, ...opts })
  s.nextSpawnAt = Infinity
  return s
}
const types = (s) => s.holes.map((b) => (b ? b.type : "."))

test("15 bombs, 3 weapons, 20 stages; each stage brings in the next bomb", () => {
  assert.equal(E.BOMB_IDS.length, 15)
  assert.equal(new Set(E.UNLOCK).size, 15)
  assert.deepEqual([...E.UNLOCK].sort(), [...E.BOMB_IDS].sort())
  assert.equal(E.WEAPON_IDS.length, 3)
  assert.deepEqual(E.typesFor("stage", 1), ["black"])
  assert.deepEqual(E.typesFor("stage", 4), ["black", "quick", "helmet", "arrow"])
  assert.equal(E.typesFor("stage", 20).length, 15)
  assert.equal(E.typesFor("endless", 1).length, 15)
  assert.equal(E.goalFor(1), 15)
  assert.equal(E.goalFor(20), 60)
  for (let st = 2; st <= 20; st++) assert.ok(E.goalFor(st) >= E.goalFor(st - 1))
})

test("bombs spawn on the clock, only of the stage's kinds, never two in one hole", () => {
  const s = E.newGame({ seed: 3, stage: 3 })
  const seen = new Set()
  for (let i = 0; i < 600 && !s.over; i++) {
    E.step(s, 1 / 60)
    for (const b of s.holes) if (b) seen.add(b.type)
    const ids = s.holes.filter(Boolean).map((b) => b.id)
    assert.equal(new Set(ids).size, ids.length)
    s.holes.forEach((b, h) => b && assert.equal(b.hole, h))
  }
  assert.ok(seen.size >= 2, "several kinds showed up")
  for (const t of seen) assert.ok(["black", "quick", "helmet"].includes(t), t)
})

test("a fuse burning down costs a heart and breaks the combo; three and it's over", () => {
  const s = quiet()
  s.combo = 7
  const b = E.makeBomb(s, "black", 4)
  E.step(s, b.fuse + 0.01)
  assert.equal(s.holes[4], null)
  assert.equal(s.hearts, 2)
  assert.equal(s.combo, 0)
  assert.ok(E.takeEvents(s).some((e) => e.type === "boom" && e.hole === 4))
  E.makeBomb(s, "black", 0)
  E.makeBomb(s, "black", 1)
  E.step(s, 10)
  assert.equal(s.hearts, 0)
  assert.equal(s.over, "lost")
})

test("whacking scores points times the combo multiplier; empty holes break the combo", () => {
  const s = quiet()
  for (let i = 0; i < 5; i++) {
    E.makeBomb(s, "black", i)
    assert.equal(E.whack(s, i), "defused")
  }
  // 4 at x1 (40) + the fifth at x2 (20)
  assert.equal(s.score, 60)
  assert.equal(s.combo, 5)
  assert.equal(E.whack(s, 8), "miss")
  assert.equal(s.combo, 0)
  assert.equal(s.bestCombo, 5)
  assert.deepEqual([1, 4, 5, 9, 10, 19, 20, 34, 35, 99].map(E.multFor), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
})

test("helmet takes two taps, iron three; jumper hops to another hole", () => {
  const s = quiet()
  E.makeBomb(s, "helmet", 0)
  assert.equal(E.whack(s, 0), "hit")
  assert.equal(E.whack(s, 0), "defused")
  E.makeBomb(s, "iron", 1)
  assert.equal(E.whack(s, 1), "hit")
  assert.equal(E.whack(s, 1), "hit")
  assert.equal(E.whack(s, 1), "defused")
  const j = E.makeBomb(s, "jumper", 2)
  assert.equal(E.whack(s, 2), "jumped")
  assert.equal(s.holes[2], null)
  assert.notEqual(j.hole, 2)
  assert.equal(s.holes[j.hole], j)
  assert.equal(E.whack(s, j.hole), "defused")
  assert.equal(s.whacked, 3)
})

test("arrow bombs need a swipe the right way; a tap does nothing, a wrong swipe breaks the combo", () => {
  const s = quiet()
  s.combo = 3
  const a = E.makeBomb(s, "arrow", 4)
  a.dir = "left"
  assert.equal(E.whack(s, 4), "needSwipe")
  assert.equal(s.combo, 3)
  assert.equal(E.swipe(s, 4, "up"), "wrongWay")
  assert.equal(s.combo, 0)
  assert.equal(E.swipe(s, 4, "left"), "defused")
  assert.equal(s.holes[4], null)
})

test("skulls: leave them and they sink (no harm); whack one and lose a heart", () => {
  const s = quiet()
  E.makeBomb(s, "skull", 0)
  E.step(s, 2)
  assert.equal(s.holes[0], null)
  assert.equal(s.hearts, 3)
  E.makeBomb(s, "skull", 1)
  assert.equal(E.whack(s, 1), "skull")
  assert.equal(s.hearts, 2)
})

test("ghosts can only be hit while they show", () => {
  const s = quiet()
  const g = E.makeBomb(s, "ghost", 3)
  // find a moment it's invisible, then one it's visible
  g.phase = 0
  let t = 0
  while (E.ghostVisible({ ...g, age: t })) t += 0.01
  g.age = t
  assert.equal(E.whack(s, 3), "ghost")
  assert.ok(s.holes[3])
  while (!E.ghostVisible({ ...g, age: t })) t += 0.01
  g.age = t
  assert.equal(E.whack(s, 3), "defused")
})

test("hold bombs need a press held for the hold time; letting go early starts over", () => {
  const s = quiet()
  E.makeBomb(s, "hold", 5)
  assert.equal(E.whack(s, 5), "needHold")
  assert.equal(E.holdStart(s, 5), "holding")
  E.step(s, E.HOLD_TIME / 2)
  assert.equal(E.holdEnd(s, 5), "released")
  E.step(s, E.HOLD_TIME / 2 + 0.05)
  assert.ok(s.holes[5], "still there")
  E.holdStart(s, 5)
  E.step(s, E.HOLD_TIME + 0.02)
  assert.equal(s.holes[5], null)
  assert.equal(s.whacked, 1)
})

test("splitter makes two small bombs; ice freezes fuses; heart gives a heart back; clock slows fuses", () => {
  const s = quiet()
  E.makeBomb(s, "splitter", 4)
  E.whack(s, 4)
  const small = s.holes.filter(Boolean)
  assert.equal(small.length, 2)
  assert.ok(small.every((b) => b.small && b.type === "black"))
  const before = small.map((b) => b.left)
  E.makeBomb(s, "ice", 0)
  E.whack(s, 0)
  E.step(s, 1)
  assert.deepEqual(small.map((b) => b.left), before, "frozen")
  E.step(s, 2.5) // the freeze ran out half a second ago
  assert.ok(small.every((b, i) => Math.abs(b.left - (before[i] - 0.5)) < 1e-6 || !s.holes.includes(b)))
  s.hearts = 2
  E.makeBomb(s, "heart", 8)
  E.whack(s, 8)
  assert.equal(s.hearts, 3)
  const c = E.makeBomb(s, "clock", 6)
  E.whack(s, 6)
  const x = E.makeBomb(s, "black", 7)
  const l = x.left
  E.step(s, 1)
  assert.ok(Math.abs(l - x.left - 0.5) < 1e-6, "half speed")
  assert.ok(c)
})

test("chain bombs take their neighbors with them and cost two hearts", () => {
  const s = quiet()
  s.hearts = 5
  const ch = E.makeBomb(s, "chain", 4)
  E.makeBomb(s, "iron", 1, { left: 99, fuse: 99 })
  E.makeBomb(s, "black", 0, { left: 99, fuse: 99 }) // a corner: not next to the middle
  E.step(s, ch.fuse + 0.01)
  assert.deepEqual(types(s), ["black", ".", ".", ".", ".", ".", ".", ".", "."])
  assert.equal(s.hearts, 3)
})

test("gold bombs sink quickly; catching one is worth 100 x the multiplier", () => {
  const s = quiet()
  E.makeBomb(s, "gold", 0)
  E.whack(s, 0)
  assert.equal(s.score, 100)
  E.makeBomb(s, "gold", 1)
  E.step(s, 1.2)
  assert.equal(s.holes[1], null)
  assert.equal(s.hearts, 3)
})

test("weapons: charged by whacks; the mallet clears the field, freeze stops fuses, snipper makes one tap enough", () => {
  const s = quiet()
  assert.equal(E.useWeapon(s, "mallet"), false)
  s.meter = E.METER_MAX
  E.makeBomb(s, "iron", 0)
  E.makeBomb(s, "skull", 1)
  E.makeBomb(s, "black", 2)
  assert.equal(E.useWeapon(s, "mallet"), true)
  assert.deepEqual(types(s), Array(9).fill("."))
  assert.equal(s.hearts, 3, "the skull sank without hurting")
  assert.equal(s.whacked, 2)
  assert.equal(s.meter, 0, "weapon kills don't charge the meter")
  s.meter = 25
  const b = E.makeBomb(s, "black", 3)
  E.useWeapon(s, "freeze")
  const l = b.left
  E.step(s, 4)
  assert.equal(b.left, l)
  s.meter = 30
  E.useWeapon(s, "snip")
  const a = E.makeBomb(s, "arrow", 5)
  a.dir = "up"
  assert.equal(E.whack(s, 5), "defused")
  E.makeBomb(s, "iron", 6)
  assert.equal(E.whack(s, 6), "defused")
})

test("a stage is won at its goal; stars from hearts left; Panic Time halfway from stage 3", () => {
  const s = quiet({ stage: 3 })
  s.hearts = 2
  let panics = 0
  for (let i = 0; i < s.goal; i++) {
    const h = s.holes.findIndex((b) => !b)
    E.makeBomb(s, "black", h)
    E.whack(s, h)
    panics += E.takeEvents(s).filter((e) => e.type === "panic").length
  }
  assert.equal(s.over, "won")
  assert.equal(s.stars, 2)
  assert.equal(panics, 1)
  // Panic Time doubles points
  const p = quiet({ mode: "endless" })
  p.panicUntil = 5
  E.makeBomb(p, "black", 0)
  E.whack(p, 0)
  assert.equal(p.score, 20)
})

test("endless: Panic Time 25 seconds after the last one ends, and it keeps getting faster", () => {
  const s = E.newGame({ mode: "endless", seed: 11 })
  s.hearts = 1e9 // never lose
  let panics = 0
  for (let i = 0; i < 70 * 30; i++) {
    E.step(s, 1 / 30)
    panics += E.takeEvents(s).filter((e) => e.type === "panic").length
  }
  assert.equal(panics, 2)
  const slow = E.speedOf({ ...s, whacked: 0 })
  const fast = E.speedOf({ ...s, whacked: 100 })
  assert.ok(fast > slow)
  assert.ok(E.spawnGap({ ...s, whacked: 100, panicUntil: 0 }) < E.spawnGap({ ...s, whacked: 0, panicUntil: 0 }))
})

test("it gets hard fast: stage 3 is well past stage 1, and stage 20 is chaos", () => {
  const at = (stage, whacked = 0) => ({ ...E.newGame({ stage, seed: 1 }), whacked })
  // stage 1 stays gentle for learning
  assert.equal(E.speedOf(at(1)), 1)
  // stage 3 starts 28% faster and ends 58% faster than stage 1
  assert.ok(E.speedOf(at(3)) >= 1.28)
  assert.ok(E.speedOf(at(3, E.goalFor(3))) >= 1.55)
  assert.ok(E.baseFuse(at(3, E.goalFor(3))) < 0.82 * E.baseFuse(at(1)))
  assert.ok(E.spawnGap(at(3, E.goalFor(3))) < 0.65 * E.spawnGap(at(1)))
  assert.ok(E.maxBombs(at(3, E.goalFor(3))) >= 5)
  // late stages: short fuses, bombs every ~0.3 s, up to 8 at once, in pairs and threes
  const late = at(20, 40)
  assert.ok(E.baseFuse(late) <= 1.6)
  assert.ok(E.spawnGap(late) <= 0.32)
  assert.equal(E.maxBombs(late), 8)
  const [two, three] = E.volleyOdds(late)
  assert.ok(two >= 0.3 && three > 0)
  // and every stage is harder than the one before
  for (let st = 2; st <= 20; st++) assert.ok(E.speedOf(at(st)) > E.speedOf(at(st - 1)))
})

test("pairs from stage 4, threes from stage 12; never more than the field allows", () => {
  assert.deepEqual(E.volleyOdds(E.newGame({ stage: 2 })), [0, 0])
  assert.ok(E.volleyOdds(E.newGame({ stage: 4 }))[0] > 0)
  assert.equal(E.volleyOdds(E.newGame({ stage: 11 }))[1], 0)
  assert.ok(E.volleyOdds(E.newGame({ stage: 12 }))[1] > 0)
  const s = E.newGame({ stage: 16, seed: 5 })
  s.hearts = 1e9
  let most = 0
  let pairs = 0
  for (let i = 0; i < 60 * 40; i++) {
    E.step(s, 1 / 60)
    const pops = E.takeEvents(s).filter((e) => e.type === "pop").length
    if (pops >= 2) pairs++
    most = Math.max(most, s.holes.filter(Boolean).length)
    if (!E.isPanic(s)) assert.ok(s.holes.filter(Boolean).length <= E.HOLES - 1)
  }
  assert.ok(pairs > 5, `bombs came in pairs (${pairs})`)
  assert.ok(most >= 6, `the field got crowded (${most})`)
})

test("two Panic Times a stage from stage 10", () => {
  assert.deepEqual(E.panicMarks(2), [])
  assert.deepEqual(E.panicMarks(3), [0.5])
  assert.equal(E.panicMarks(10).length, 2)
  const s = quiet({ stage: 10 })
  s.hearts = 5
  let panics = 0
  for (let i = 0; i < s.goal && !s.over; i++) {
    const h = s.holes.findIndex((b) => !b)
    E.makeBomb(s, "black", h)
    E.whack(s, h)
    panics += E.takeEvents(s).filter((e) => e.type === "panic").length
    // let a Panic Time run out before the next whack
    if (E.isPanic(s)) s.t = s.panicUntil
  }
  assert.equal(panics, 2)
})

test("Sort Rush: right pen scores, wrong pen blows up, a dropped bomb in the yard keeps walking", () => {
  const s = S.newSort({ seed: 5 })
  s.nextSpawnAt = Infinity
  const r = S.spawn(s, "red")
  const b = S.spawn(s, "blue")
  S.grab(s, r.id)
  assert.equal(S.drop(s, r.id, 0.05, 0.5), "right")
  assert.equal(s.score, 10)
  assert.equal(S.drop(s, b.id, 0.5, 0.5), "ground")
  assert.equal(S.drop(s, b.id, 0.05, 0.5), "wrong")
  assert.equal(s.hearts, 2)
  assert.equal(s.combo, 0)
  // green pen only after 40 s
  assert.equal(S.penAt(s, 0.5, 0.05), null)
  s.t = S.GREEN_AT
  assert.equal(S.penAt(s, 0.5, 0.05), "green")
  // a fuse running out in the yard costs a heart
  const g = S.spawn(s, "green")
  S.step(s, g.fuse + 0.01)
  assert.equal(s.hearts, 1)
  // flicks slide on
  const land = S.flickLanding(0.5, 0.5, -2, 0)
  assert.ok(land.x < S.PEN_W)
})

test("Sort Rush: walking bombs stay out of the pens", () => {
  const s = S.newSort({ seed: 9 })
  s.hearts = 1e9
  for (let i = 0; i < 60 * 60; i++) {
    S.step(s, 1 / 60)
    for (const b of s.bombs) {
      assert.ok(b.x >= S.WALK.x0 - 1e-9 && b.x <= S.WALK.x1 + 1e-9)
      assert.ok(b.y >= S.WALK.y0 - 1e-9)
    }
  }
  assert.ok(s.t > 59)
})
