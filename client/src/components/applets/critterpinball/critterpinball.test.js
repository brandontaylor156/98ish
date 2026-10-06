// Critter Catch Pinball: node --test client/src/components/applets/critterpinball/critterpinball.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { createBall, createWorld, stepWorld } from "../pinball/physics.js"
import { PAL32 } from "../pinball/pixel.js"
import { AREAS, BONUS_STAGES, BY_ID, CRITTERS, NEAR_AREAS, TABLE_BONUS, cleanDex, dexCounts, pickCritter, spawnTable } from "./critters.js"
import { buildSprite, coverage, critterSprite } from "./sprites.js"
import { BOSS, TABLES, buildBonus, buildTable } from "./layout.js"
import * as G from "./game.js"
import { createDrawer } from "./render.js"
import { H, W } from "./art.js"
import { lcdContent, statusLine } from "./lcd.js"
import { cryNotes } from "./cry.js"

const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
const tick = (g, seconds = 0.1, input = {}) => {
  for (let t = 0; t < seconds; t += 1 / 60) G.update(g, 1 / 60, input)
}
const play = (table = "ember", seed = 3) => {
  const g = G.createGame({ table, random: seeded(seed) })
  G.startGame(g)
  return g
}
const ball = (g) => g.world.balls.find((b) => b.kind === "play")
const ev = (g, type, extra = {}) => G.handleEvent(g, { type, id: 0, ball: ball(g), speed: 300, ...extra })
// sink a hole by its sensor event, then wait for the kick-out
const sink = (g, tag) => {
  const b = ball(g)
  b.held = false
  G.handleEvent(g, { type: tag, id: 0, ball: b, speed: 200 })
}
const releaseHole = (g) => {
  if (g.hole) g.hole.until = g.time
  tick(g, 0.05)
}

// ---- the critters ----

test("47 critters with unique ids, real sprites, valid evolution lines, and every one can be caught somehow", () => {
  assert.equal(CRITTERS.length, 47)
  assert.equal(new Set(CRITTERS.map((c) => c.id)).size, CRITTERS.length)
  for (const c of CRITTERS) {
    const spr = critterSprite(c)
    assert.equal(spr.w, 32)
    assert.ok(coverage(spr) > 120, `${c.id} covers ${coverage(spr)} px`)
    for (const v of spr.data) assert.ok(v === -1 || (v > 0 && v < PAL32.length), `${c.id} uses a palette color`)
    if (c.evolvesTo) {
      const next = BY_ID[c.evolvesTo]
      assert.ok(next, `${c.id} evolves into a real critter`)
      assert.equal(next.stage, c.stage + 1)
      assert.equal(next.table, c.table)
      assert.equal(next.from, c.id)
    }
    const wild = Object.keys(c.areas).length > 0
    const fromEvolution = c.from && (Object.keys(BY_ID[c.from].areas).length > 0 || BY_ID[BY_ID[c.from].from])
    const boss = Object.values(BONUS_STAGES).some((s) => s.boss === c.id)
    assert.ok(wild || fromEvolution || boss, `${c.id} can be caught`)
    for (const a of Object.keys(c.areas)) assert.ok(AREAS[c.table].some((x) => x.id === a), `${c.id} lives in a real ${c.table} area (${a})`)
  }
  // the sprites are drawn the same way every time
  assert.deepEqual(buildSprite(BY_ID.sprigling.sprite).data, critterSprite(BY_ID.sprigling).data)
})

test("every area has critters to find, nearby areas have common ones, and the far areas hold the rare ones", () => {
  for (const [table, areas] of Object.entries(AREAS)) {
    areas.forEach((a, i) => {
      const spawns = spawnTable(a.id)
      assert.ok(spawns.length >= 2, `${table}/${a.id} has ${spawns.length} critters`)
      assert.ok(spawns.some((s) => s.rarity === "common"), `${table}/${a.id} has a common critter`)
      if (i < NEAR_AREAS) assert.ok(spawns.length >= 3)
    })
    assert.ok(areas.slice(NEAR_AREAS).some((a) => spawnTable(a.id).some((s) => s.rarity === "rare")), `${table}'s far areas have rare critters`)
  }
})

test("a better ball makes rare critters likelier", () => {
  const rareShare = (level) => {
    const r = seeded(9)
    let rare = 0
    for (let i = 0; i < 4000; i++) if (pickCritter("volcano", level, r).rarity === "rare") rare++
    return rare / 4000
  }
  assert.ok(rareShare(3) > rareShare(0) * 1.8, `${rareShare(0)} -> ${rareShare(3)}`)
})

test("the Dex: cleanDex keeps only real critters and sane counts; caught implies seen", () => {
  const dex = cleanDex({ seen: { sprigling: true, nobody: true }, caught: { droplet: 2, emberkit: -1, fake: 3, pebblet: "x" } })
  assert.deepEqual(Object.keys(dex.caught), ["droplet"])
  assert.ok(dex.seen.droplet && dex.seen.sprigling && !dex.seen.nobody)
  assert.deepEqual(dexCounts(dex), { seen: 2, caught: 1, total: 47 })
  assert.deepEqual(cleanDex(null), { seen: {}, caught: {} })
})

// ---- the rules ----

test("C-A-T-C-H: the ramp lights two letters, a loop one; five light Catch at the Den", () => {
  const g = play()
  ev(g, "ramp")
  assert.equal(g.letters, 2)
  // an orbit loop: up one side, down the other
  ball(g).vy = -500
  ev(g, "orbit", { id: 0 })
  ball(g).vy = 500
  ev(g, "orbit", { id: 1 })
  assert.equal(g.letters, 3)
  // the same side twice isn't a loop
  ball(g).vy = -500
  ev(g, "orbit", { id: 0 })
  ball(g).vy = 500
  ev(g, "orbit", { id: 0 })
  assert.equal(g.letters, 3)
  ev(g, "ramp")
  assert.equal(g.letters, 5)
  assert.ok(g.catchLit)
})

test("Catch mode: the Den starts it, bumpers reveal the critter, hits on it catch it into the Dex", () => {
  const g = play("ember", 5)
  g.catchLit = true
  sink(g, "den")
  const a = g.active
  assert.equal(a.kind, "catch")
  assert.equal(a.phase, "reveal")
  assert.ok(g.dex.seen[a.id], "seen as soon as it shows up")
  assert.ok(spawnTable(g.area).some((s) => s.id === a.id), "from the current area")
  releaseHole(g)
  const critter = g.mainWorld.colliders.find((c) => c.tag === "critter")
  assert.equal(critter.active, false)
  for (let i = 0; i < 6; i++) ev(g, "bumper", { id: i % 3 })
  assert.equal(a.phase, "out")
  assert.equal(critter.active, true, "the critter is solid while it's out")
  const before = g.score
  for (let i = 0; i < a.need; i++) {
    tick(g, 0.3)
    ev(g, "critter")
  }
  assert.equal(g.active, null)
  assert.equal(g.dex.caught[a.id], 1)
  assert.ok(g.dexEvents.some((e) => e.kind === "caught" && e.id === a.id))
  assert.ok(g.caught.includes(a.id))
  assert.ok(g.score > before + 40000)
  assert.equal(critter.active, false)
})

test("a hit on the critter only counts once in a quarter second, and a Hyper Ball counts double", () => {
  const g = play()
  g.catchLit = true
  sink(g, "den")
  releaseHole(g)
  g.active.tiles = g.active.tiles.map(() => true)
  g.active.tiles[0] = false
  ev(g, "bumper")
  const need = g.active.need
  ev(g, "critter")
  ev(g, "critter")
  assert.equal(g.active.hits, 1)
  g.ballLevel = 2
  tick(g, 0.3)
  ev(g, "critter")
  assert.equal(need > 3 ? g.active.hits : 3, 3)
})

test("Catch mode times out (it runs away) and ends when the ball drains", () => {
  const g = play()
  g.catchLit = true
  sink(g, "den")
  releaseHole(g)
  const id = g.active.id
  g.active.until = g.time + 0.05
  tick(g, 0.2)
  assert.equal(g.active, null)
  assert.ok(!g.dex.caught[id])
  assert.ok(g.dex.seen[id])
  g.catchLit = true
  sink(g, "den")
  releaseHole(g)
  ball(g).y = 2000
  tick(g, 0.1)
  assert.equal(g.active, null)
})

test("Evolution: E-V-O lights it, the flippers pick a catch, three items, then the Den evolves it", () => {
  const g = play("ember", 4)
  g.caught = ["pebblet", "sprigling"]
  for (let i = 0; i < 3; i++) ev(g, "target", { id: i, ny: 1 })
  assert.ok(g.evoLit)
  sink(g, "den")
  const a = g.active
  assert.equal(a.kind, "evolve")
  assert.equal(a.phase, "choose")
  assert.deepEqual(a.options, ["pebblet", "sprigling"])
  assert.equal(g.hole.until, Infinity, "the Den holds the ball while you choose")
  tick(g, 0.05, { right: true })
  tick(g, 0.05)
  assert.equal(a.pick, 1)
  tick(g, 0.05, { left: true, right: true })
  assert.equal(a.phase, "collect")
  assert.equal(a.id, "sprigling")
  assert.equal(a.spots.length, 3)
  tick(g, 0.5)
  assert.ok(!ball(g).held, "the ball is let go once you've picked")
  const ballOf = ball(g)
  const fire = { orbitL: () => ((ballOf.vy = -400), ev(g, "orbit", { id: 0 })), orbitR: () => ((ballOf.vy = -400), ev(g, "orbit", { id: 1 })), ramp: () => ev(g, "ramp"), bumpers: () => ev(g, "bumper"), targets: () => ev(g, "target", { id: g.targets.indexOf(false), ny: 1 }), cave: () => sink(g, "cave") }
  for (const spot of [...a.spots]) {
    fire[spot]()
    if (g.hole) releaseHole(g)
  }
  assert.equal(a.phase, "ready")
  sink(g, "den")
  assert.equal(g.active, null)
  assert.equal(g.dex.caught.thornback, 1)
  assert.ok(g.caught.includes("thornback") && !g.caught.includes("sprigling"))
})

test("Evolution with nobody to evolve just scores, and the choice is made for you after a while", () => {
  const g = play()
  g.evoLit = true
  sink(g, "den")
  assert.equal(g.active, null)
  assert.equal(g.evoLit, false)
  releaseHole(g)
  g.caught = ["fluffin"]
  g.evoLit = true
  sink(g, "den")
  assert.equal(g.active.phase, "choose")
  tick(g, G.CHOOSE_TIME + 0.2)
  assert.equal(g.active.phase, "collect")
  assert.equal(g.active.id, "fluffin")
})

test("the map: 3 ramps light the Cave; moves stay nearby until 3 moves open the far areas", () => {
  const g = play("tide", 8)
  for (let i = 0; i < 3; i++) ev(g, "ramp")
  assert.ok(g.mapLit)
  const near = AREAS.tide.slice(0, NEAR_AREAS).map((a) => a.id)
  const seen = []
  for (let i = 0; i < 12; i++) {
    g.mapLit = true
    const from = g.area
    sink(g, "cave")
    releaseHole(g)
    assert.notEqual(g.area, from)
    seen.push({ area: g.area, after: g.moves })
  }
  for (const s of seen.filter((s) => s.after <= 3)) assert.ok(near.includes(s.area), `move ${s.after} went to ${s.area}`)
  assert.ok(seen.some((s) => !near.includes(s.area)), "the far areas come up after 3 moves")
})

test("bonus stages: 3 catches light the Cave; the stage keeps the ball count; beating the boss catches it", () => {
  const g = play("ember", 2)
  for (const id of ["sprigling", "fluffin", "sparkit"]) {
    g.catchLit = true
    sink(g, "den")
    releaseHole(g)
    g.active.id = id
    g.active.tiles = g.active.tiles.map(() => true)
    g.active.tiles[0] = false
    ev(g, "bumper")
    for (let i = 0; i < 5 && g.active; i++) {
      tick(g, 0.3)
      ev(g, "critter")
    }
  }
  assert.ok(g.bonusLit)
  sink(g, "cave")
  assert.equal(g.hole.then, "bonus")
  releaseHole(g)
  assert.equal(g.stage, "bonus")
  assert.equal(g.bonus.kind, TABLE_BONUS.ember[0])
  assert.equal(g.bonus.kind, "mole")
  // Mudpups pop up; bopping enough of them brings the king
  tick(g, 1)
  for (let i = 0; i < 8; i++) {
    const up = g.bonus.moles.findIndex(Boolean)
    if (up < 0) g.bonus.moles[0] = g.time + 2
    G.handleEvent(g, { type: "mole", id: Math.max(0, up), ball: ball(g), speed: 400 })
  }
  assert.equal(g.bonus.phase, "boss")
  tick(g, 0.05)
  assert.equal(g.world.colliders.find((c) => c.tag === "boss").active, true)
  for (let i = 0; i < 3; i++) {
    tick(g, 0.35)
    G.handleEvent(g, { type: "boss", id: 0, ball: ball(g), speed: 400 })
  }
  assert.equal(g.stage, "main")
  assert.equal(g.dex.caught.grandmole, 1)
  assert.equal(g.ballNumber, 1, "no ball lost")
  assert.ok(ball(g).x > 504, "the ball comes back to the plunger")
})

test("draining in a bonus stage goes back to the table without losing a ball; time up does too", () => {
  const g = play("tide", 6)
  g.bonusTurn = 0
  g.world.balls = []
  G.enterBonus(g)
  assert.equal(g.bonus.kind, "crab")
  ball(g).y = 2000
  tick(g, 0.05)
  assert.equal(g.stage, "main")
  assert.equal(g.ballNumber, 1)
  assert.equal(g.ballEndAt, null)
  assert.ok(ball(g))
  g.world.balls = []
  G.enterBonus(g)
  assert.equal(g.bonus.kind, "ghost")
  g.bonus.until = g.time + 0.05
  tick(g, 0.2)
  assert.equal(g.stage, "main")
  assert.ok(!g.dex.caught.wispurr)
})

test("bonus bosses move: the ghost drifts and fades, the crab's claws follow it", () => {
  const g = play("tide", 6)
  g.world.balls = []
  g.bonusTurn = 1
  G.enterBonus(g)
  const ghost = g.world.colliders.find((c) => c.tag === "boss")
  const xs = new Set()
  let faded = false
  for (let i = 0; i < 60; i++) {
    tick(g, 0.1, { left: true, right: true })
    xs.add(Math.round(ghost.cx))
    if (!ghost.active) faded = true
    if (g.stage !== "bonus") break
  }
  assert.ok(xs.size > 10, "it moves")
  assert.ok(faded, "it fades out for a moment")
  const g2 = play("tide", 6)
  g2.world.balls = []
  G.enterBonus(g2)
  tick(g2, 0.7, { left: true, right: true })
  const body = g2.world.colliders.find((c) => c.tag === "boss")
  const claws = g2.world.colliders.filter((c) => c.tag === "claw")
  assert.ok(Math.abs(body.cx - BOSS.crab.x) > 1)
  assert.ok(Math.abs(claws[0].cx - (body.cx - BOSS.crab.clawDx)) < 1e-6)
  assert.ok(Math.abs(claws[1].cx - (body.cx + BOSS.crab.clawDx)) < 1e-6)
  // a claw blocks: no hit counted
  G.handleEvent(g2, { type: "claw", id: 0, ball: ball(g2), speed: 400 })
  assert.equal(g2.bonus.hits, 0)
})

test("Sparkit: the spinner charges it, it saves a ball from the outlane it stands at, the flippers move it", () => {
  const g = play()
  for (let i = 0; i < G.SAVER_SPINS; i++) ev(g, "spin")
  assert.equal(g.saver.charge, G.SAVER_SPINS)
  tick(g, 0.05, { right: true })
  tick(g, 0.05)
  assert.equal(g.saver.side, 1)
  const b = ball(g)
  b.vy = 600
  ev(g, "outlane", { id: 0 })
  assert.ok(b.vy > 0, "not on that side")
  tick(g, 0.05, { left: true })
  tick(g, 0.05)
  assert.equal(g.saver.side, 0)
  b.vy = 600
  ev(g, "outlane", { id: 0 })
  assert.ok(b.vy < -2000, "kicked back up")
  assert.equal(g.saver.charge, 0)
})

test("the top lanes upgrade the ball (more points), and the upgrade wears off after a minute", () => {
  const g = play()
  g.skillLane = -1
  for (let i = 0; i < 3; i++) ev(g, "rollover", { id: i })
  assert.equal(g.ballLevel, 1)
  assert.equal(G.multiplier(g), 2)
  const s = g.score
  ev(g, "bumper")
  assert.equal(g.score - s, G.SCORES.bumper * 2)
  g.levelUntil = g.time + 0.05
  tick(g, 0.1)
  assert.equal(g.ballLevel, 0)
})

test("five catches in a game give an extra ball", () => {
  const g = play()
  for (let i = 0; i < 5; i++) {
    g.catchLit = true
    sink(g, "den")
    releaseHole(g)
    g.active.tiles = g.active.tiles.map(() => true)
    g.active.tiles[0] = false
    ev(g, "bumper")
    for (let k = 0; k < 6 && g.active; k++) {
      tick(g, 0.3)
      ev(g, "critter")
    }
  }
  assert.equal(g.extraBalls, 1)
})

test("drains: ball save, then three lost balls end the game", () => {
  const g = play()
  g.ballSaveUntil = g.time + 5
  ball(g).y = 2000
  tick(g, 0.1)
  assert.equal(g.ballNumber, 1)
  tick(g, 2)
  assert.ok(ball(g), "saved and relaunched")
  for (let n = 0; n < 3; n++) {
    g.ballSaveUntil = 0
    const b = ball(g)
    if (b) b.y = 2000
    tick(g, 2.2)
  }
  assert.equal(g.mode, "over")
})

// ---- the tables ----

const tableWorld = (id) => {
  const w = createWorld(buildTable(TABLES[id]))
  w.kickers = true
  return w
}

test("shots reach the critter, the Den, the Cave and the ramp on both tables", () => {
  for (const id of ["ember", "tide"]) {
    const T = TABLES[id]
    const tryShots = (target, active, want) => {
      for (const fromX of [200, 230, 300, 330]) {
        for (let speed = 1500; speed <= 3200; speed += 100) {
          for (const dx of [-30, 0, 30]) {
            const w = tableWorld(id)
            if (active) w.colliders.find((c) => c.tag === "critter").active = true
            const dirX = target.x + dx - fromX
            const dirY = target.y - 820
            const d = Math.hypot(dirX, dirY)
            w.balls.push(createBall(fromX, 820, (dirX / d) * speed, (dirY / d) * speed))
            for (let i = 0; i < 240 * 2; i++) {
              w.events.length = 0
              stepWorld(w)
              if (w.events.some((e) => e.type === want && (want !== "den" && want !== "cave" ? true : e.speed < G.HOLE_MAX_SPEED))) return true
            }
          }
        }
      }
      return false
    }
    assert.ok(tryShots(T.critter, true, "critter"), `${id}: the critter can be hit`)
    assert.ok(tryShots(T.den, false, "den"), `${id}: the Den can be sunk`)
    assert.ok(tryShots(T.cave, false, "cave"), `${id}: the Cave can be sunk`)
    assert.ok(tryShots(T.ramp.mouth, false, "ramp"), `${id}: the ramp can be made (up, round the U and out)`)
  }
})

test("a bot plays both tables for minutes: nothing escapes, balls rarely get stuck, and every feature gets hit", () => {
  for (const [id, seed] of [
    ["ember", 7],
    ["tide", 11],
  ]) {
    const random = seeded(seed)
    const g = G.createGame({ table: id, random })
    G.startGame(g)
    const hold = { left: -1, right: -1 }
    let pullT = 0
    let aim = 0.7
    const total = {}
    const add = () => Object.entries(g.stats).forEach(([k, v]) => (total[k] = (total[k] || 0) + v))
    for (let t = 0; t < 240; t += 1 / 60) {
      const input = { left: false, right: false, plunger: false }
      for (const b of g.world.balls) {
        if (b.kind !== "play" || b.held) continue
        if (b.x > 504 && b.y > 800) {
          pullT += 1 / 60
          input.plunger = pullT < aim
          if (!input.plunger) {
            pullT = 0
            aim = 0.3 + random() * 0.6
          }
        } else if (b.y > 790 && b.y < 900 && b.vy > -200) {
          const side = b.x < 262 ? "left" : "right"
          if (hold[side] < -0.25) hold[side] = 0.12 + random() * 0.15
        }
      }
      hold.left -= 1 / 60
      hold.right -= 1 / 60
      input.left = hold.left > 0
      input.right = hold.right > 0
      G.update(g, 1 / 60, input)
      g.sfx.length = 0
      if (g.mode === "over") {
        add()
        G.startGame(g)
      }
    }
    add()
    assert.equal(total.escaped, 0, `${id}: ${JSON.stringify(g.debug)}`)
    assert.ok(total.searches <= 6, `${id}: ${total.searches} ball searches`)
    for (const k of ["bumper", "sling", "target", "spin", "ramp", "loop", "den", "cave"]) assert.ok(total[k] > 0, `${id}: ${k} was hit (${JSON.stringify(total)})`)
  }
})

test("bonus stage worlds keep the ball in: a ball dropped in bounces round and only leaves by the drain", () => {
  for (const kind of ["mole", "ghost", "crab"]) {
    const w = createWorld(buildBonus(kind))
    const random = seeded(4)
    for (let n = 0; n < 20; n++) {
      w.balls = [createBall(100 + random() * 320, 150 + random() * 400, (random() - 0.5) * 3000, (random() - 0.5) * 3000)]
      for (let i = 0; i < 240 * 3 && w.balls[0].y < 1040; i++) stepWorld(w)
      const b = w.balls[0]
      if (b.y >= 1040) continue // drained: that's the way out
      assert.ok(b.x > 18 && b.x < 506, `${kind}: x ${b.x}`)
      assert.ok(b.y > 30, `${kind}: y ${b.y}`)
    }
  }
})

// ---- what's on screen ----

test("the renderer draws every state using only the palette", () => {
  const drawer = createDrawer()
  const fb = { w: W, h: H, buf: new Uint32Array(W * H) }
  const legal = new Set(PAL32)
  const check = (g, label) => {
    drawer.draw(fb, g, 1.3)
    for (let i = 0; i < fb.buf.length; i += 7) assert.ok(legal.has(fb.buf[i]), `${label}: pixel ${i} is ${fb.buf[i].toString(16)}`)
  }
  for (const id of ["ember", "tide"]) {
    const g = G.createGame({ table: id })
    check(g, `${id} attract`)
    G.startGame(g)
    check(g, `${id} play`)
    g.catchLit = true
    sink(g, "den")
    check(g, `${id} reveal`)
    g.active.tiles = g.active.tiles.map(() => true)
    g.active.tiles[0] = false
    ev(g, "bumper")
    check(g, `${id} out`)
    g.active = null
    g.world.balls = []
    G.enterBonus(g)
    check(g, `${id} bonus`)
  }
})

test("the display shows the score and what to do; status lines follow the modes", () => {
  const g = play()
  assert.ok(lcdContent(g, 1, { rows: 32 }).length > 0, "the opening message")
  g.dmd = null
  const lines = lcdContent(g, 10, { rows: 32 })
  assert.ok(lines.some((l) => l.t === "0"), "the score")
  assert.match(statusLine(g), /MEADOW|FOREST|CANYON/i)
  g.catchLit = true
  assert.equal(statusLine(g), "CATCH: SINK THE DEN")
  sink(g, "den")
  assert.match(statusLine(g), /^REVEAL 0\/6/)
  const attract = G.createGame({ table: "tide" })
  assert.ok(lcdContent(attract, 0, { rows: 16, caught: 3, total: 47 }).length > 0)
})

test("each critter has its own cry, the same every time", () => {
  assert.deepEqual(cryNotes("sparkit"), cryNotes("sparkit"))
  assert.notDeepEqual(cryNotes("sparkit"), cryNotes("magmaw"))
  for (const c of CRITTERS) {
    const notes = cryNotes(c.id)
    assert.ok(notes.length >= 2 && notes.length <= 4)
    for (const [from, to, len] of notes) assert.ok(Number.isFinite(from + to + len) && len > 0)
  }
})
