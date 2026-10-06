// Critter Catch Pinball's rules: catching critters, evolving them, traveling the map,
// bonus stages with a boss, ball upgrades, Sparkit the outlane saver, ball save, extra
// balls, tilt and the end-of-ball bonus.
//
//   CATCH: light C-A-T-C-H (ramp shots and orbit loops), then sink the Den. A mystery
//     critter from the current area shows on the screen; bumper hits reveal it tile by
//     tile; then it comes out in the middle of the table: hit it enough times before the
//     timer runs out and it's caught (into the Critter Dex).
//   EVOLVE: knock down E-V-O, then sink the Den, pick one of this game's catches with the
//     flippers, collect 3 items at the lit shots, and sink the Den again.
//   MAP: 3 ramp shots light the Cave: sink it to travel to another area (new critters;
//     the far areas, with the rare ones, open after 3 moves).
//   BONUS: every 3 catches or evolutions light the Cave for a bonus stage with a boss.
//
// Pure: update(game, dt, input) moves everything on; game.sfx collects sound cues,
// game.flash the lights to blink, game.popups the score popups, game.dmd what the
// display should show for a moment, game.dexEvents what to save in the Dex.

import { BALL_R, STEP, createBall, createWorld, firePlunger, stepWorld } from "../pinball/physics.js"
import { AREAS, BONUS_STAGES, BY_ID, CATCH_HITS, CATCH_POINTS, MOVES_TO_UNLOCK, NEAR_AREAS, TABLE_BONUS, areaName, cleanDex, pickCritter, rarityOf } from "./critters.js"
import { BALL_START, BOSS, BONUS_DROP, DRAIN_Y, HEIGHT, MOLE_HOLES, OUTLANES, PLUNGER, TABLES, WIDTH, buildBonus, buildTable, inShooterLane } from "./layout.js"

export const BALLS_PER_GAME = 3
export const LAUNCH_MIN = 1200
export const LAUNCH_MAX = 2900
export const PULL_TIME = 0.9
export const BALL_SAVE_TIME = 10
export const TILT_WARN = 2.2
export const TILT_LIMIT = 3.6
const TILT_DECAY = 0.55
const BALL_END_PAUSE = 1.8
const STUCK_TIME = 6
const LOOP_WINDOW = 3
const SKILL_WINDOW = 4
const TARGET_RESET = 1.2
export const HOLE_MAX_SPEED = 1800
export const HOLE_HOLD = 1.3
export const CATCH_TIME = 120
export const EVOLVE_TIME = 90
export const CHOOSE_TIME = 8
export const LETTERS = "CATCH"
export const RAMPS_FOR_MAP = 3
export const EVENTS_FOR_BONUS = 3
export const EXTRA_BALL_AT = [5, 10] // catches + evolutions in a game
export const SAVER_SPINS = 12
export const REVEAL_TILES = 6
export const BALL_LEVELS = [
  { name: "Basic Ball", short: "BASIC", x: 1 },
  { name: "Super Ball", short: "SUPER", x: 2 },
  { name: "Hyper Ball", short: "HYPER", x: 3 },
  { name: "Master Ball", short: "MASTER", x: 5 },
]
export const LEVEL_TIME = 60
// the shots that can hold an evolution item
export const ITEM_SPOTS = ["orbitL", "orbitR", "ramp", "bumpers", "targets", "cave"]
export const ITEM_SPOT_NAMES = { orbitL: "LEFT ORBIT", orbitR: "RIGHT ORBIT", ramp: "RAMP", bumpers: "BUMPERS", targets: "E-V-O", cave: "CAVE" }

export const SCORES = {
  bumper: 300,
  sling: 100,
  post: 50,
  spin: 200,
  rollover: 1000,
  lanes: 15000,
  inlane: 500,
  outlane: 2000,
  target: 2000,
  bank: 20000,
  hole: 5000,
  letter: 5000,
  loop: 10000,
  ramp: 10000,
  skillShot: 30000,
  saver: 5000,
  reveal: 2000,
  critterHit: 5000,
  item: 25000,
  evolve: 200000,
  travel: 50000,
  mole: 10000,
  bossHit: 20000,
  bonusClear: 400000,
  extraBall: 20000,
}

const say = (g, text, seconds = 2.5, big = false) => {
  g.message = { text, until: g.time + seconds, big }
}
const show = (g, big, small = "", seconds = 2, flash = false) => {
  g.dmd = { big, small, until: g.time + seconds, flash, t: g.time }
}
const sound = (g, name, value) => g.sfx.push(value === undefined ? name : { name, value })
const flash = (g, name) => (g.flash[name] = g.time)
const shake = (g, x, y) => (g.shake = { x, y, t: g.time })
const fmt = (n) => n.toLocaleString("en-US")

export const multiplier = (g) => BALL_LEVELS[g.ballLevel].x

export const createGame = ({ table = "ember", dex, random = Math.random } = {}) => {
  const T = TABLES[table] || TABLES.ember
  const world = createWorld(buildTable(T))
  return {
    table: T.id,
    T,
    world,
    mainWorld: world,
    stage: "main", // "main" | "bonus"
    mode: "attract", // "attract" | "play" | "over"
    random,
    score: 0,
    ballNumber: 1,
    extraBalls: 0,
    ballLevel: 0,
    levelUntil: 0,
    lanes: [false, false, false],
    letters: 0, // C-A-T-C-H lit so far
    catchLit: false,
    targets: [false, false, false], // E-V-O down?
    targetResetAt: null,
    evoLit: false,
    ramps: 0, // toward lighting the map
    mapLit: false,
    area: AREAS[T.id][0].id,
    moves: 0,
    bonusProgress: 0,
    bonusLit: false,
    bonusTurn: 0,
    saver: { side: 0, charge: 0 },
    active: null, // the running mode: catch | evolve
    bonus: null, // the bonus stage, while on one
    hole: null, // { ball, tag, until, then }
    caught: [], // critter ids caught (or evolved into) this game
    events: 0, // catches + evolutions this game
    ballCatches: 0,
    ballEvolves: 0,
    ballMoves: 0,
    bonusUnits: 0,
    launchQueue: 0,
    nextAutoLaunch: 0,
    ballSaveUntil: 0,
    ballSavePending: false,
    skillLane: -1,
    skillUntil: 0,
    orbitStart: null,
    tilt: 0,
    tilted: false,
    ballEndAt: null,
    pull: 0,
    pulling: false,
    time: 0,
    acc: 0,
    message: null,
    dmd: null,
    sfx: [],
    flash: {},
    popups: [],
    shake: { x: 0, y: 0, t: -9 },
    dex: cleanDex(dex),
    dexEvents: [], // { kind: "seen" | "caught", id }
    debug: [],
    prevFlip: { left: false, right: false },
    stats: { bumper: 0, sling: 0, target: 0, spin: 0, ramp: 0, loop: 0, den: 0, cave: 0, critter: 0, catchModes: 0, catches: 0, evolves: 0, travels: 0, bonuses: 0, drains: 0, escaped: 0, searches: 0, saves: 0 },
  }
}

export const award = (g, points, where, raw = false) => {
  if (g.tilted || g.mode !== "play") return 0
  const v = raw ? points : points * multiplier(g)
  g.score += v
  if (where && v >= 1000) {
    g.popups.push({ x: where.x, y: where.y, text: v >= 1e6 ? `${Math.round(v / 1e5) / 10}M` : v >= 1e4 ? `${Math.round(v / 1000)}K` : fmt(v), t: g.time })
    if (g.popups.length > 8) g.popups.shift()
  }
  return v
}

const critterCollider = (g) => g.mainWorld.colliders.find((c) => c.tag === "critter")
const setCritterOut = (g, out) => {
  const c = critterCollider(g)
  if (c) c.active = out
}

const seen = (g, id) => {
  if (!g.dex.seen[id]) {
    g.dex.seen[id] = true
    g.dexEvents.push({ kind: "seen", id })
  }
}
const caughtIt = (g, id) => {
  g.dex.seen[id] = true
  g.dex.caught[id] = (g.dex.caught[id] || 0) + 1
  g.dexEvents.push({ kind: "caught", id })
}

const serveBall = (g) => {
  const b = createBall(BALL_START.x, BALL_START.y)
  g.world.balls.push(b)
  g.world.plunger.y = PLUNGER.restY
  g.world.plunger.vy = 0
  g.ballSavePending = true
  g.skillLane = Math.floor(g.random() * 3)
  g.skillUntil = Infinity
  return b
}

export const startGame = (g) => {
  const fresh = createGame({ table: g.table, dex: g.dex, random: g.random })
  Object.assign(g, fresh, { mode: "play", sfx: ["start"] })
  const near = AREAS[g.table].slice(0, NEAR_AREAS)
  g.area = near[Math.floor(g.random() * near.length)].id
  serveBall(g)
  show(g, `${areaName(g.table, g.area).toUpperCase()}`, `BALL 1 - ${g.T.name.toUpperCase()}`, 3)
  say(g, `Ball 1 at ${areaName(g.table, g.area)}: light C-A-T-C-H, then sink the Den`, 4)
}

const playBalls = (g) => g.world.balls.filter((b) => b.kind === "play")

const startBall = (g) => {
  g.lanes = [false, false, false]
  g.tilt = 0
  g.tilted = false
  g.bonusUnits = 0
  g.ballCatches = 0
  g.ballEvolves = 0
  g.ballMoves = 0
  g.launchQueue = 0
  g.orbitStart = null
  for (const f of g.world.flippers) f.pressed = false
  serveBall(g)
}

// ---- lighting things ----
const addLetter = (g, where, n = 1) => {
  if (g.catchLit || g.active?.kind === "catch") return
  const from = g.letters
  g.letters = Math.min(LETTERS.length, g.letters + n)
  award(g, SCORES.letter * (g.letters - from), where)
  for (let i = from; i < g.letters; i++) flash(g, "letter" + i)
  sound(g, "letter", g.letters)
  if (g.letters >= LETTERS.length) {
    g.catchLit = true
    flash(g, "catchLit")
    sound(g, "lit")
    show(g, "CATCH IS LIT", "SINK THE DEN", 2.5, true)
    say(g, "CATCH is lit: sink the Den!", 3)
  } else show(g, LETTERS.slice(0, g.letters).split("").join(" "), `${LETTERS.length - g.letters} MORE FOR CATCH`, 1.2)
}

const countEvent = (g) => {
  g.events++
  g.bonusProgress++
  if (g.bonusProgress >= EVENTS_FOR_BONUS && !g.bonusLit) {
    g.bonusLit = true
    g.bonusProgress = 0
    flash(g, "bonusLit")
    sound(g, "lit")
    say(g, "BONUS STAGE is lit at the Cave!", 3.5)
  }
  if (EXTRA_BALL_AT.includes(g.events)) {
    g.extraBalls++
    award(g, SCORES.extraBall)
    sound(g, "extraBall")
    flash(g, "extraBall")
    show(g, "EXTRA BALL", `${g.events} CRITTERS`, 3, true)
  }
}

// ---- Catch mode ----
export const startCatch = (g) => {
  const pick = pickCritter(g.area, g.ballLevel, g.random)
  g.catchLit = false
  g.letters = 0
  g.active = { kind: "catch", id: pick.id, rarity: pick.rarity, phase: "reveal", tiles: Array(REVEAL_TILES).fill(false), hits: 0, need: CATCH_HITS[pick.rarity], until: g.time + CATCH_TIME, lastHit: -9 }
  seen(g, pick.id)
  g.stats.catchModes++
  sound(g, "catchStart")
  show(g, "CATCH MODE", "HIT BUMPERS TO REVEAL", 3, true)
  say(g, "A wild critter! Hit the bumpers to see what it is", 3.5)
}

const revealTile = (g) => {
  const a = g.active
  if (!a || a.kind !== "catch" || a.phase !== "reveal") return
  const hidden = a.tiles.map((t, i) => (t ? -1 : i)).filter((i) => i >= 0)
  if (!hidden.length) return
  a.tiles[hidden[Math.floor(g.random() * hidden.length)]] = true
  award(g, SCORES.reveal)
  sound(g, "reveal")
  if (a.tiles.every(Boolean)) {
    a.phase = "out"
    a.outAt = g.time
    setCritterOut(g, true)
    const c = BY_ID[a.id]
    sound(g, "cry", a.id)
    flash(g, "critterOut")
    show(g, `IT'S ${c.name.toUpperCase()}!`, `HIT IT ${a.need} TIMES`, 3, true)
    say(g, `It's ${c.name}! Hit it ${a.need} times to catch it`, 3.5)
  }
}

const critterHit = (g, b) => {
  const a = g.active
  if (!a || a.kind !== "catch" || a.phase !== "out" || g.time - a.lastHit < 0.25) return
  a.lastHit = g.time
  a.hits += g.ballLevel >= 2 ? 2 : 1 // a Hyper or Master Ball counts double
  g.stats.critter++
  award(g, SCORES.critterHit, b)
  flash(g, "critterHit")
  sound(g, "cry", a.id)
  shake(g, 0, 3)
  if (a.hits < a.need) {
    show(g, BY_ID[a.id].name, `${a.need - a.hits} MORE HIT${a.need - a.hits === 1 ? "" : "S"}`, 1.4)
    return
  }
  // caught!
  const c = BY_ID[a.id]
  const fresh = !g.dex.caught[a.id]
  caughtIt(g, a.id)
  g.caught.push(a.id)
  g.ballCatches++
  g.stats.catches++
  setCritterOut(g, false)
  g.active = null
  const v = award(g, CATCH_POINTS[a.rarity] || CATCH_POINTS.common, b)
  sound(g, "caught")
  flash(g, "caught")
  shake(g, 0, 5)
  show(g, `GOTCHA! ${c.name.toUpperCase()}`, fresh ? "NEW IN THE DEX!" : fmt(v), 3.5, true)
  say(g, `Gotcha! ${c.name} was caught${fresh ? " - new in your Critter Dex!" : ""}`, 4, true)
  countEvent(g)
}

const endCatch = (g, why) => {
  const a = g.active
  if (!a || a.kind !== "catch") return
  setCritterOut(g, false)
  g.active = null
  if (why === "time") {
    sound(g, "ranAway")
    show(g, "IT RAN AWAY", BY_ID[a.id].name.toUpperCase(), 2.5, true)
    say(g, `${BY_ID[a.id].name} ran away...`, 3)
  }
}

// ---- Evolution mode ----
export const evolvable = (g) => [...new Set(g.caught)].filter((id) => BY_ID[id]?.evolvesTo)

export const startEvolve = (g, b) => {
  g.evoLit = false
  const options = evolvable(g)
  if (!options.length) {
    award(g, SCORES.hole, b)
    show(g, "NO ONE TO EVOLVE", "CATCH A CRITTER FIRST", 2.5)
    say(g, "Nobody to evolve yet: catch a critter first", 3)
    return false
  }
  g.active = { kind: "evolve", phase: "choose", options, pick: 0, until: g.time + CHOOSE_TIME, spots: [], got: 0 }
  sound(g, "evoStart")
  show(g, "EVOLUTION", "FLIPPERS PICK - BOTH TO GO", CHOOSE_TIME, true)
  say(g, "Evolution! Flippers choose, both flippers (or wait) to pick", CHOOSE_TIME)
  return true
}

const confirmEvolve = (g) => {
  const a = g.active
  const spots = [...ITEM_SPOTS]
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(g.random() * (i + 1))
    ;[spots[i], spots[j]] = [spots[j], spots[i]]
  }
  a.id = a.options[a.pick]
  a.phase = "collect"
  a.spots = spots.slice(0, 3)
  a.got = 0
  a.until = g.time + EVOLVE_TIME
  sound(g, "cry", a.id)
  show(g, `EVOLVE ${BY_ID[a.id].name.toUpperCase()}`, "COLLECT 3 ITEMS", 3, true)
  say(g, `Collect 3 items at the flashing shots to evolve ${BY_ID[a.id].name}`, 4)
  // let the ball go
  if (g.hole) g.hole.until = g.time + 0.3
}

const itemAt = (g, spot, b) => {
  const a = g.active
  if (!a || a.kind !== "evolve" || a.phase !== "collect") return
  const i = a.spots.indexOf(spot)
  if (i < 0) return
  a.spots.splice(i, 1)
  a.got++
  award(g, SCORES.item, b)
  flash(g, "item")
  sound(g, "item", a.got)
  if (a.got >= 3) {
    a.phase = "ready"
    sound(g, "lit")
    show(g, "EVOLVE IS READY", "SINK THE DEN", 3, true)
    say(g, "All 3 items! Sink the Den to evolve", 3.5)
  } else show(g, "ITEM GET!", `${3 - a.got} TO GO`, 1.5)
}

const finishEvolve = (g, b) => {
  const a = g.active
  const from = BY_ID[a.id]
  const to = BY_ID[from.evolvesTo]
  const fresh = !g.dex.caught[to.id]
  caughtIt(g, to.id)
  const i = g.caught.indexOf(from.id)
  if (i >= 0) g.caught.splice(i, 1, to.id)
  else g.caught.push(to.id)
  g.active = null
  g.ballEvolves++
  g.stats.evolves++
  award(g, SCORES.evolve * (to.stage >= 3 ? 2 : 1), b)
  sound(g, "evolved")
  flash(g, "evolved")
  shake(g, 0, 6)
  show(g, `${from.name.toUpperCase()} EVOLVED`, `INTO ${to.name.toUpperCase()}!`, 4, true)
  say(g, `${from.name} evolved into ${to.name}!${fresh ? " New in the Dex!" : ""}`, 4.5, true)
  countEvent(g)
}

const endEvolve = (g, why) => {
  const a = g.active
  if (!a || a.kind !== "evolve") return
  g.active = null
  if (why === "time") {
    sound(g, "ranAway")
    show(g, "EVOLUTION FAILED", "OUT OF TIME", 2.5, true)
    say(g, "Out of time: the evolution failed", 3)
  }
}

// ---- the map ----
export const travel = (g, b) => {
  const all = AREAS[g.table]
  const open = g.moves >= MOVES_TO_UNLOCK ? all : all.slice(0, NEAR_AREAS)
  const choices = open.filter((a) => a.id !== g.area)
  const weighted = choices.flatMap((a) => (all.indexOf(a) >= NEAR_AREAS ? [a, a] : [a]))
  const next = weighted[Math.floor(g.random() * weighted.length)]
  g.area = next.id
  g.moves++
  g.ballMoves++
  g.mapLit = false
  g.ramps = 0
  g.stats.travels++
  award(g, SCORES.travel, b)
  sound(g, "travel")
  flash(g, "travel")
  const unlocked = g.moves === MOVES_TO_UNLOCK
  show(g, "MAP MOVE", next.name.toUpperCase(), 3, true)
  say(g, `Off to ${next.name}!${unlocked ? " The far lands are open now." : ""}`, 3.5)
}

// ---- holes: the Den and the Cave hold the ball, then kick it out ----
const holdBall = (g, b, spot, tag, seconds = HOLE_HOLD) => {
  b.held = true
  b.x = spot.x
  b.y = spot.y
  b.vx = b.vy = 0
  for (const s of g.world.sensors) if (s.tag === tag) b.inside.add(s)
  g.hole = { ball: b, tag, until: g.time + seconds }
}

const enterDen = (g, b) => {
  const live = !g.tilted && g.mode === "play"
  holdBall(g, b, g.T.den, "den")
  g.stats.den++
  flash(g, "den")
  sound(g, "hole")
  if (!live) return
  g.bonusUnits += 2
  const a = g.active
  if (a?.kind === "evolve" && a.phase === "ready") return finishEvolve(g, b)
  if (a) return award(g, SCORES.hole, b)
  if (g.catchLit) return startCatch(g)
  if (g.evoLit) {
    if (startEvolve(g, b)) g.hole.until = Infinity // held while choosing
    return
  }
  award(g, SCORES.hole, b)
  show(g, "THE DEN", g.letters ? `${LETTERS.length - g.letters} LETTERS TO CATCH` : "LIGHT C-A-T-C-H", 1.6)
}

const enterCave = (g, b) => {
  const live = !g.tilted && g.mode === "play"
  holdBall(g, b, g.T.cave, "cave")
  g.stats.cave++
  flash(g, "cave")
  sound(g, "hole")
  if (!live) return
  g.bonusUnits += 2
  itemAt(g, "cave", b)
  if (g.bonusLit && !g.active) {
    g.bonusLit = false
    g.hole.then = "bonus"
    g.hole.until = g.time + 1.6
    sound(g, "bonusStart")
    show(g, "BONUS STAGE", BONUS_STAGES[TABLE_BONUS[g.table][g.bonusTurn % 2]].name.toUpperCase(), 2, true)
    return
  }
  if (g.mapLit && g.active?.kind !== "catch") return travel(g, b)
  award(g, SCORES.hole, b)
  show(g, "THE CAVE", g.mapLit ? "MAP MOVE AFTER CATCH" : `${Math.max(0, RAMPS_FOR_MAP - g.ramps)} RAMPS FOR MAP`, 1.6)
}

const releaseHole = (g) => {
  const { ball, tag, then } = g.hole
  g.hole = null
  if (then === "bonus" && g.mode === "play" && !g.tilted) {
    const i = g.world.balls.indexOf(ball)
    if (i >= 0) g.world.balls.splice(i, 1)
    enterBonus(g)
    return
  }
  ball.held = false
  const spot = tag === "den" ? g.T.den : g.T.cave
  // kick out down and toward the middle of the table
  const toMid = Math.sign(262 - spot.x) || 1
  ball.x = spot.x
  ball.y = spot.y + BALL_R * 0.6
  ball.vx = toMid * (360 + g.random() * 140)
  ball.vy = 520
  sound(g, "kickout")
}

// ---- bonus stages ----
export const enterBonus = (g) => {
  const kind = TABLE_BONUS[g.table][g.bonusTurn % 2]
  g.bonusTurn++
  const stage = BONUS_STAGES[kind]
  const world = createWorld(buildBonus(kind))
  world.balls.push(createBall(BONUS_DROP.x, BONUS_DROP.y, (g.random() - 0.5) * 200, 300))
  for (const f of world.flippers) f.pressed = false
  g.world = world
  g.stage = "bonus"
  g.bonus = { kind, stage, until: g.time + stage.seconds, hits: 0, bossHits: 0, phase: kind === "mole" ? "minions" : "boss", moles: MOLE_HOLES.map(() => 0), nextMole: g.time + 0.8, lastHit: -9, t0: g.time, fade: false }
  g.stats.bonuses++
  g.ballSaveUntil = 0
  seen(g, stage.boss)
  sound(g, "bonusStart")
  show(g, stage.name.toUpperCase(), stage.text.toUpperCase(), 3, true)
  say(g, `${stage.name}: ${stage.text}`, 4, true)
}

const bonusCollider = (g, tag, id = 0) => g.world.colliders.find((c) => c.tag === tag && c.id === id)

const leaveBonus = (g, why) => {
  const B = g.bonus
  if (!B) return
  const boss = BY_ID[B.stage.boss]
  if (why === "clear") {
    const fresh = !g.dex.caught[boss.id]
    caughtIt(g, boss.id)
    g.caught.push(boss.id)
    award(g, SCORES.bonusClear)
    sound(g, "caught")
    show(g, "STAGE CLEAR!", `${boss.name.toUpperCase()} CAUGHT`, 3.5, true)
    say(g, `Stage clear! ${boss.name} was caught${fresh ? " - new in your Critter Dex!" : ""}`, 4, true)
    g.stats.catches++
  } else {
    sound(g, "ranAway")
    show(g, why === "time" ? "TIME UP" : "BACK TO THE TABLE", `${boss.name.toUpperCase()} GOT AWAY`, 2.5, true)
    say(g, `${boss.name} got away. Back to the table`, 3)
  }
  g.bonus = null
  g.stage = "main"
  g.world = g.mainWorld
  // the ball comes back to the plunger (not lost), with a ball save
  g.world.balls = g.world.balls.filter((b) => b.kind !== "play")
  serveBall(g)
  g.skillLane = -1
  g.ballSaveUntil = 0
  for (const f of g.world.flippers) f.pressed = false
}

const updateBonus = (g, dt) => {
  const B = g.bonus
  const t = g.time - B.t0
  if (B.kind === "mole") {
    // Mudpups pop up and duck back down
    MOLE_HOLES.forEach((_, i) => {
      const c = bonusCollider(g, "mole", i)
      if (B.moles[i] && g.time > B.moles[i]) B.moles[i] = 0
      c.active = B.phase === "minions" && B.moles[i] > 0
    })
    if (B.phase === "minions" && g.time >= B.nextMole) {
      const down = B.moles.map((m, i) => (m ? -1 : i)).filter((i) => i >= 0)
      if (down.length && B.moles.filter(Boolean).length < 3) {
        B.moles[down[Math.floor(g.random() * down.length)]] = g.time + 2.4
        sound(g, "pop")
      }
      B.nextMole = g.time + 0.75
    }
    bonusCollider(g, "boss").active = B.phase === "boss"
  } else if (B.kind === "ghost") {
    const c = bonusCollider(g, "boss")
    const S = BOSS.ghost
    const x = S.x + Math.sin(t * 0.9) * S.swing
    c.vx = (x - c.cx) / Math.max(dt, 1e-6)
    c.cx = x
    c.cy = S.y + Math.sin(t * 2.1) * 18
    // it fades out for a moment every few seconds (and can't be hit)
    B.fade = t % 4.5 > 3.3
    c.active = !B.fade
  } else if (B.kind === "crab") {
    const S = BOSS.crab
    const speed = 0.8 + B.hits * 0.12
    B.phaseX = (B.phaseX || 0) + dt * speed
    const x = S.x + Math.sin(B.phaseX) * S.swing
    const body = bonusCollider(g, "boss")
    body.vx = (x - body.cx) / Math.max(dt, 1e-6)
    body.cx = x
    for (const id of [0, 1]) {
      const claw = bonusCollider(g, "claw", id)
      claw.cx = x + (id ? 1 : -1) * S.clawDx
      claw.vx = body.vx
    }
  }
  if (g.time >= B.until) leaveBonus(g, "time")
}

const bonusHit = (g, ev) => {
  const B = g.bonus
  if (!B || g.tilted) return
  if (ev.type === "mole") {
    if (!B.moles[ev.id]) return
    B.moles[ev.id] = 0
    B.hits++
    award(g, SCORES.mole, ev.ball)
    sound(g, "bop")
    flash(g, "mole" + ev.id)
    if (B.hits >= B.stage.goal && B.phase === "minions") {
      B.phase = "boss"
      B.moles = B.moles.map(() => 0)
      sound(g, "cry", B.stage.boss)
      show(g, "HERE COMES THE KING", "HIT GRANDMOLE 3 TIMES", 2.5, true)
    } else if (B.phase === "minions") show(g, "BOP!", `${B.stage.goal - B.hits} MORE`, 1)
    return
  }
  if (ev.type === "claw") {
    sound(g, "clank")
    flash(g, "claw" + ev.id)
    return
  }
  if (ev.type !== "boss" || g.time - B.lastHit < 0.3) return
  B.lastHit = g.time
  flash(g, "boss")
  sound(g, "cry", B.stage.boss)
  shake(g, 0, 4)
  award(g, SCORES.bossHit, ev.ball)
  if (B.kind === "mole") {
    B.bossHits++
    if (B.bossHits >= 3) return leaveBonus(g, "clear")
    show(g, "GRANDMOLE", `${3 - B.bossHits} MORE`, 1.2)
  } else {
    B.hits++
    if (B.hits >= B.stage.goal) return leaveBonus(g, "clear")
    show(g, BY_ID[B.stage.boss].name.toUpperCase(), `${B.stage.goal - B.hits} MORE`, 1.2)
  }
}

// The skill shot ends at the first thing the ball touches after the launch
const endSkill = (g) => {
  g.skillLane = -1
}

// What each physics event is worth
export const handleEvent = (g, ev) => {
  const live = !g.tilted && g.mode === "play"
  const b = ev.ball
  if (g.stage === "bonus") {
    if (["mole", "boss", "claw"].includes(ev.type)) return live && bonusHit(g, ev)
    if (ev.type === "bumper" || ev.type === "sling") {
      sound(g, ev.type, ev.id)
      flash(g, ev.type + ev.id)
      if (live) award(g, SCORES[ev.type])
    } else if (ev.type === "flipperHit") sound(g, "thud", ev.speed)
    return
  }
  switch (ev.type) {
    case "bumper":
      if (!live) return
      endSkill(g)
      award(g, SCORES.bumper)
      g.bonusUnits += 1
      g.stats.bumper++
      flash(g, "bumper" + ev.id)
      sound(g, "bumper", ev.id)
      revealTile(g)
      itemAt(g, "bumpers", b)
      break
    case "sling":
      if (!live) return
      endSkill(g)
      award(g, SCORES.sling)
      g.stats.sling++
      flash(g, "sling" + ev.id)
      sound(g, "sling")
      break
    case "post":
      award(g, SCORES.post)
      sound(g, "rubber", ev.speed)
      break
    case "spin":
      g.stats.spin++
      flash(g, "spinner")
      sound(g, "spin")
      if (!live) return
      award(g, SCORES.spin)
      if (g.saver.charge < SAVER_SPINS) {
        g.saver.charge++
        if (g.saver.charge === SAVER_SPINS) {
          sound(g, "charged")
          flash(g, "charged")
          show(g, "SPARKIT CHARGED", "OUTLANE SAVER READY", 2)
        }
      }
      break
    case "target": {
      if (g.targets[ev.id] || (ev.ny !== undefined && ev.ny < 0.5)) return
      endSkill(g)
      g.targets[ev.id] = true
      g.world.colliders.find((c) => c.tag === "target" && c.id === ev.id).active = false
      award(g, SCORES.target, b)
      g.bonusUnits += 2
      g.stats.target++
      flash(g, "target" + ev.id)
      sound(g, "target")
      itemAt(g, "targets", b)
      if (g.targets.every(Boolean)) {
        award(g, SCORES.bank)
        flash(g, "bank")
        sound(g, "lit")
        g.targetResetAt = g.time + TARGET_RESET
        if (!g.evoLit) {
          g.evoLit = true
          show(g, "EVOLVE IS LIT", "SINK THE DEN", 2.5, true)
          say(g, "E-V-O! Evolution is lit at the Den", 3)
        }
      }
      break
    }
    case "rollover": {
      flash(g, "lane" + ev.id)
      sound(g, "rollover")
      if (!live) return
      award(g, SCORES.rollover)
      if (g.skillLane >= 0) {
        if (g.skillLane === ev.id && g.time < g.skillUntil) {
          award(g, SCORES.skillShot, b)
          sound(g, "skill")
          show(g, "SKILL SHOT", fmt(SCORES.skillShot * multiplier(g)), 2, true)
        }
        endSkill(g)
      }
      g.lanes[ev.id] = true
      if (g.lanes.every(Boolean)) {
        g.lanes = [false, false, false]
        award(g, SCORES.lanes)
        flash(g, "lanes")
        if (g.ballLevel < BALL_LEVELS.length - 1) {
          g.ballLevel++
          sound(g, "upgrade")
          show(g, "BALL UPGRADE", `${BALL_LEVELS[g.ballLevel].short} BALL ${BALL_LEVELS[g.ballLevel].x}X`, 2.5, true)
        } else show(g, BALL_LEVELS[g.ballLevel].short + " BALL", "TIMER REFILLED", 1.6)
        g.levelUntil = g.time + LEVEL_TIME
      }
      break
    }
    case "inlane":
      award(g, SCORES.inlane)
      flash(g, "inlane" + ev.id)
      sound(g, "rollover")
      break
    case "outlane":
      flash(g, "outlane" + ev.id)
      if (live && b.vy > 0 && g.saver.charge >= SAVER_SPINS && g.saver.side === ev.id) {
        // Sparkit kicks the ball back up
        g.saver.charge = 0
        b.x = OUTLANES[ev.id].x
        b.vx = 0
        b.vy = -2500
        g.stats.saves++
        award(g, SCORES.saver)
        flash(g, "saver")
        sound(g, "saver")
        shake(g, 0, -4)
        show(g, "SPARKIT SAVE!", "SPIN TO RECHARGE", 1.8)
        return
      }
      award(g, SCORES.outlane)
      sound(g, "outlane")
      break
    case "orbit": {
      if (!live) return
      flash(g, "orbit" + ev.id)
      if (b.vy < 0) {
        g.orbitStart = { id: ev.id, t: g.time }
        itemAt(g, ev.id === 0 ? "orbitL" : "orbitR", b)
        return
      }
      const s = g.orbitStart
      g.orbitStart = null
      if (s && s.id !== ev.id && g.time - s.t < LOOP_WINDOW) {
        award(g, SCORES.loop, b)
        g.stats.loop++
        g.bonusUnits += 3
        flash(g, "loop")
        sound(g, "loop")
        addLetter(g, b)
      }
      break
    }
    case "rampEnter":
      sound(g, "rampUp")
      break
    case "rampFail":
      sound(g, "rampDown")
      break
    case "ramp": {
      if (!live) return
      endSkill(g)
      g.stats.ramp++
      g.bonusUnits += 4
      flash(g, "ramp")
      sound(g, "ramp")
      award(g, SCORES.ramp, b)
      itemAt(g, "ramp", b)
      addLetter(g, b, 2) // the ramp is the harder shot: two letters
      if (!g.mapLit) {
        g.ramps++
        if (g.ramps >= RAMPS_FOR_MAP) {
          g.mapLit = true
          flash(g, "mapLit")
          show(g, "MAP MOVE IS LIT", "SINK THE CAVE", 2.5, true)
        }
      }
      break
    }
    case "den":
      if (g.hole || ev.speed > HOLE_MAX_SPEED || b.held) return
      endSkill(g)
      enterDen(g, b)
      break
    case "cave":
      if (g.hole || ev.speed > HOLE_MAX_SPEED || b.held) return
      endSkill(g)
      enterCave(g, b)
      break
    case "critter":
      if (!live) return
      endSkill(g)
      critterHit(g, b)
      break
    case "laneExit":
      if (b.vy < -300 && g.ballSavePending) {
        g.ballSavePending = false
        g.ballSaveUntil = Math.max(g.ballSaveUntil, g.time + BALL_SAVE_TIME)
        if (g.skillLane >= 0) g.skillUntil = g.time + SKILL_WINDOW
      }
      break
    case "flipperHit":
      endSkill(g)
      sound(g, "thud", ev.speed)
      break
    default:
  }
}

const removeBall = (g, b) => {
  const i = g.world.balls.indexOf(b)
  if (i >= 0) g.world.balls.splice(i, 1)
}

const drain = (g, b) => {
  removeBall(g, b)
  g.stats.drains++
  if (g.mode !== "play") return
  if (g.stage === "bonus") return leaveBonus(g, "drain")
  if (playBalls(g).length + g.launchQueue > 0) return
  if (!g.tilted && g.time < g.ballSaveUntil) {
    sound(g, "save")
    flash(g, "save")
    show(g, "BALL SAVED", "", 2, true)
    say(g, "BALL SAVED", 2, true)
    g.launchQueue++
    g.nextAutoLaunch = g.time + 0.8
    return
  }
  // the ball is over: modes end, the bonus is counted, then the next ball (or the end)
  endCatch(g, "drain")
  endEvolve(g, "drain")
  sound(g, "drain")
  const bonus = g.tilted ? 0 : g.bonusUnits * 1000 + g.ballCatches * 100000 + g.ballEvolves * 150000 + g.ballMoves * 50000
  if (bonus) {
    g.score += bonus
    show(g, "BONUS", fmt(bonus), BALL_END_PAUSE)
    say(g, `Bonus ${fmt(bonus)}`, BALL_END_PAUSE)
  } else if (!g.tilted) {
    show(g, "BALL LOST", "", BALL_END_PAUSE)
    say(g, "Ball lost", BALL_END_PAUSE)
  }
  // a ball upgrade drops a level when the ball is lost
  g.ballLevel = Math.max(0, g.ballLevel - 1)
  g.levelUntil = g.ballLevel ? g.time + LEVEL_TIME : 0
  g.ballEndAt = g.time + BALL_END_PAUSE
}

const nextBall = (g) => {
  g.ballEndAt = null
  if (g.extraBalls > 0) {
    g.extraBalls--
    show(g, "SHOOT AGAIN", "SAME PLAYER", 2.5, true)
    say(g, "SHOOT AGAIN", 2.5, true)
    sound(g, "extraBall")
    startBall(g)
    return
  }
  if (g.ballNumber >= BALLS_PER_GAME) {
    g.mode = "over"
    g.tilted = false
    for (const f of g.world.flippers) f.pressed = false
    show(g, "GAME OVER", fmt(g.score), 5)
    say(g, "GAME OVER", 9999, true)
    sound(g, "gameOver")
    return
  }
  g.ballNumber++
  show(g, `BALL ${g.ballNumber}`, areaName(g.table, g.area).toUpperCase(), 2.5)
  say(g, `Ball ${g.ballNumber}`, 2.5)
  startBall(g)
}

const autoLaunch = (g) => {
  if (g.stage !== "main") return false
  const laneBusy = g.world.balls.some((b) => inShooterLane(b) && b.y > 820)
  if (laneBusy) return false
  g.world.balls.push(createBall(BALL_START.x, BALL_START.y - 10, 0, -(LAUNCH_MAX - 250)))
  sound(g, "launch", 0.8)
  return true
}

export const nudge = (g, dir) => {
  if (g.mode !== "play" || g.tilted) return
  const kick = { left: [130, -60], right: [-130, -60], up: [0, -170] }[dir] || [0, -170]
  for (const b of g.world.balls) {
    if (b.held || inShooterLane(b)) continue
    b.vx += kick[0] * (0.8 + g.random() * 0.4)
    b.vy += kick[1] * (0.8 + g.random() * 0.4)
  }
  shake(g, -kick[0] / 30, -kick[1] / 30 - 2)
  sound(g, "nudge")
  g.tilt += 1
  if (g.tilt > TILT_LIMIT) {
    g.tilted = true
    for (const f of g.world.flippers) f.pressed = false
    g.ballSaveUntil = 0
    g.launchQueue = 0
    sound(g, "tilt")
    show(g, "TILT", "", 9999, true)
    say(g, "TILT", 9999, true)
  } else if (g.tilt > TILT_WARN) {
    sound(g, "danger")
    show(g, "DANGER", "", 1.5, true)
    say(g, "DANGER", 1.5, true)
  }
}

// The flippers: lane change for the lit top lanes and the skill shot, Sparkit's side, and
// choosing a critter to evolve (while the Den holds the ball)
const setFlippers = (g, left, right) => {
  const [lf, rf] = g.world.flippers
  const live = g.mode === "play" && !g.tilted
  left = left && live
  right = right && live
  const a = g.active
  const choosing = a?.kind === "evolve" && a.phase === "choose"
  const leftEdge = left && !g.prevFlip.left
  const rightEdge = right && !g.prevFlip.right
  g.prevFlip = { left, right }
  if (choosing) {
    if (left && right && (leftEdge || rightEdge)) return confirmEvolve(g)
    if (leftEdge) {
      a.pick = (a.pick + a.options.length - 1) % a.options.length
      sound(g, "select")
    }
    if (rightEdge) {
      a.pick = (a.pick + 1) % a.options.length
      sound(g, "select")
    }
  }
  if (leftEdge && !lf.pressed) {
    sound(g, "flipper", "up")
    if (g.stage === "main") {
      if (g.lanes.some(Boolean)) g.lanes = [...g.lanes.slice(1), g.lanes[0]]
      if (g.skillLane >= 0) g.skillLane = (g.skillLane + 2) % 3
      g.saver.side = 0
    }
  }
  if (rightEdge && !rf.pressed) {
    sound(g, "flipper", "up")
    if (g.stage === "main") {
      if (g.lanes.some(Boolean)) g.lanes = [g.lanes[2], ...g.lanes.slice(0, 2)]
      if (g.skillLane >= 0) g.skillLane = (g.skillLane + 1) % 3
      g.saver.side = 1
    }
  }
  if ((!left && lf.pressed) || (!right && rf.pressed)) sound(g, "flipper", "down")
  lf.pressed = left
  rf.pressed = right
}

const searchStuck = (g) => {
  for (const b of g.world.balls) {
    if (b.held || b.kind !== "play" || inShooterLane(b)) {
      b.still = undefined
      continue
    }
    const moved = Math.hypot(b.x - (b.sx ?? b.x), b.y - (b.sy ?? b.y))
    if (moved > 6 || b.still === undefined) {
      b.sx = b.x
      b.sy = b.y
      b.still = g.time
    } else if (g.time - b.still > STUCK_TIME) {
      b.vx += (g.random() - 0.5) * 900
      b.vy -= 500 + g.random() * 400
      b.still = g.time
      g.stats.searches++
      if (g.debug.length < 50) g.debug.push({ kind: "search", x: Math.round(b.x), y: Math.round(b.y), layer: b.layer, stage: g.stage })
    }
  }
}

const onTable = (b) => b.x > -20 && b.x < WIDTH + 20 && b.y > -40 && Number.isFinite(b.x + b.y + b.vx + b.vy)

// input: { left, right, plunger, pull (0..1), nudges: ["left" | "right" | "up"] }
export const update = (g, dt, input = {}) => {
  dt = Math.min(dt, 0.1)
  setFlippers(g, !!input.left, !!input.right)
  for (const dir of input.nudges || []) nudge(g, dir)

  // the plunger
  const p = g.world.plunger
  const dragging = typeof input.pull === "number"
  if (p && (input.plunger || dragging) && g.mode === "play" && p.vy === 0) {
    if (!g.pulling) sound(g, "pull")
    g.pulling = true
    g.pull = dragging ? Math.max(0, Math.min(1, input.pull)) : Math.min(1, g.pull + dt / PULL_TIME)
    p.y = PLUNGER.restY + g.pull * PLUNGER.pull
    for (const b of g.world.balls) {
      if (b.kind === "play" && !b.held && inShooterLane(b) && b.y > PLUNGER.restY - 60 && Math.abs(b.vy) < 400) {
        b.y = p.y - BALL_R - 0.25
        b.vy = 0
      }
    }
  } else if (p && g.pulling) {
    g.pulling = false
    if (g.pull > 0.02) {
      firePlunger(p, LAUNCH_MIN + g.pull * (LAUNCH_MAX - LAUNCH_MIN))
      sound(g, "launch", g.pull)
    } else p.y = PLUNGER.restY
    g.pull = 0
  }
  // the plunger key also picks the critter while choosing one to evolve
  if (input.plunger && g.active?.kind === "evolve" && g.active.phase === "choose") confirmEvolve(g)

  g.acc += dt
  while (g.acc >= STEP) {
    g.acc -= STEP
    g.time += STEP
    if (g.stage === "bonus" && g.mode === "play") updateBonus(g, STEP)
    if (g.stage === "main" || g.bonus) {
      const w = g.world
      w.events.length = 0
      stepWorld(w, STEP)
      for (const ev of w.events) {
        handleEvent(g, ev)
        if (g.world !== w) break // went to (or came back from) a bonus stage
      }
    }
    for (const b of [...g.world.balls]) {
      if (b.y > DRAIN_Y) drain(g, b)
      else if (!onTable(b) || b.y > HEIGHT + 200) {
        g.stats.escaped++
        if (g.debug.length < 50) g.debug.push({ kind: "escape", x: Math.round(b.px), y: Math.round(b.py), vx: Math.round(b.vx), vy: Math.round(b.vy), layer: b.layer, stage: g.stage })
        drain(g, b)
      }
    }
  }

  g.tilt = Math.max(0, g.tilt - TILT_DECAY * dt)

  // timers
  if (g.hole && g.time >= g.hole.until) releaseHole(g)
  const a = g.active
  if (a && g.mode === "play") {
    if (a.kind === "evolve" && a.phase === "choose" && g.time >= a.until) confirmEvolve(g)
    else if (a.kind === "catch" && g.time >= a.until) endCatch(g, "time")
    else if (a.kind === "evolve" && a.phase !== "choose" && g.time >= a.until) endEvolve(g, "time")
  }
  if (g.ballLevel > 0 && g.levelUntil && g.time >= g.levelUntil && g.mode === "play") {
    g.ballLevel--
    g.levelUntil = g.ballLevel ? g.time + LEVEL_TIME : 0
    show(g, "BALL DOWNGRADE", `${BALL_LEVELS[g.ballLevel].short} BALL`, 1.6)
  }
  if (g.targetResetAt !== null && g.time >= g.targetResetAt) {
    g.targetResetAt = null
    g.targets = g.targets.map(() => false)
    for (const c of g.mainWorld.colliders) if (c.tag === "target") c.active = true
    sound(g, "reset")
  }
  if (g.launchQueue > 0 && g.time >= g.nextAutoLaunch && g.mode === "play") {
    if (autoLaunch(g)) g.launchQueue--
    g.nextAutoLaunch = g.time + 0.9
  }
  if (g.ballEndAt !== null && g.time >= g.ballEndAt) nextBall(g)
  if (g.mode === "play") searchStuck(g)
  if (g.message && g.time > g.message.until) g.message = null
  if (g.dmd && g.time > g.dmd.until) g.dmd = null
  while (g.popups.length && g.time - g.popups[0].t > 1) g.popups.shift()
  if (g.mode !== "play") g.world.time = g.time
  return g
}

// ---- high scores (top 10 per table, kept per user by the storage seam) ----
export const HIGH_SCORE_COUNT = 10
export const cleanScores = (raw) =>
  (Array.isArray(raw) ? raw : [])
    .filter((s) => s && Number.isFinite(s.score) && s.score > 0)
    .map((s) => ({ name: cleanInitials(s.name), score: Math.round(s.score), date: Number.isFinite(s.date) ? s.date : 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, HIGH_SCORE_COUNT)
export const qualifies = (scores, score) => score > 0 && (scores.length < HIGH_SCORE_COUNT || score > scores[scores.length - 1].score)
export const insertScore = (scores, entry) => [...scores, entry].sort((a, b) => b.score - a.score).slice(0, HIGH_SCORE_COUNT)
export function cleanInitials(text) {
  return (
    String(text || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 3) || "???"
  )
}

export { rarityOf }
