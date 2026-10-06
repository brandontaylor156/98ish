// Boom Frenzy's rules, with no DOM (tested in boomfrenzy.test.js). A whack-the-bombs game
// after Bomb Panic (Orangenose Studios, iPhone, 2012; research in docs/games-new.md): bombs
// pop out of nine holes with burning fuses; whack them before they go off. 15 kinds of bomb,
// Panic Time waves, 3 weapons, 20 stages and Endless. It gets hard fast: faster fuses and
// spawns every stage (speedOf), bombs in pairs from stage 4 and threes from stage 12
// (volleyOdds), Panic Time from stage 3 and twice a stage from 10 (panicMarks).
//
// The state is a plain object the UI keeps in a ref; step(state, dt) runs the clock and every
// action (whack, swipe, holdStart/holdEnd, useWeapon) changes it in place and returns what
// happened. Things worth a sound or a picture are pushed onto state.events, which the UI
// empties each frame (takeEvents).

import { rng, weighted } from "../../../utils/gameKit.js"

export const HOLES = 9
export const COLS = 3
export const START_HEARTS = 3
export const MAX_HEARTS = 5
export const STAGES = 20
export const METER_MAX = 40
export const HOLD_TIME = 0.6
export const PANIC_LEN = 8
export const ENDLESS_PANIC_EVERY = 25

// the 15 bombs: points, taps needed, weight (how often it shows up once unlocked)
export const BOMBS = {
  black: { name: "Black Bomb", points: 10, hits: 1, weight: 10, how: "Tap it." },
  quick: { name: "Quick Bomb", points: 15, hits: 1, weight: 5, how: "Tap it fast: its fuse is very short." },
  helmet: { name: "Helmet Bomb", points: 20, hits: 2, weight: 5, how: "Tap it twice: the helmet comes off first." },
  arrow: { name: "Arrow Bomb", points: 25, hits: 1, weight: 5, how: "Swipe the way its arrow points. Taps do nothing." },
  skull: { name: "Skull Bomb", points: 0, hits: 1, weight: 3, how: "DON'T touch it! It sinks by itself. Whacking it costs a heart." },
  jumper: { name: "Jumper", points: 25, hits: 2, weight: 3, how: "Hit it, it hops to another hole: hit it again there." },
  iron: { name: "Iron Bomb", points: 30, hits: 3, weight: 3, how: "Tap it three times." },
  ice: { name: "Ice Bomb", points: 15, hits: 1, weight: 1.2, how: "Tap it to freeze every fuse for 3 seconds." },
  ghost: { name: "Ghost Bomb", points: 25, hits: 1, weight: 3, how: "Fades in and out. Tap it while you can see it." },
  splitter: { name: "Splitter", points: 15, hits: 1, weight: 3, how: "Tap it and it splits into two little bombs. Get those too!" },
  hold: { name: "Hold Bomb", points: 30, hits: 1, weight: 3, how: "Press and hold it until the ring fills." },
  heart: { name: "Heart Bomb", points: 10, hits: 1, weight: 0.8, how: "Tap it for a heart back (up to 5)." },
  clock: { name: "Clock Bomb", points: 15, hits: 1, weight: 1, how: "Tap it: every fuse burns at half speed for 4 seconds." },
  chain: { name: "Chain Bomb", points: 20, hits: 1, weight: 3, how: "Tap it in time: if it goes off, the bombs next to it go too (2 hearts)." },
  gold: { name: "Gold Bomb", points: 100, hits: 1, weight: 1, how: "Worth 100! Tap it before it sinks (about a second)." },
}
export const BOMB_IDS = Object.keys(BOMBS)
// the order the stages bring them in (stage n has the first n + 0 kinds, all from stage 15)
export const UNLOCK = ["black", "quick", "helmet", "arrow", "skull", "jumper", "iron", "ice", "ghost", "splitter", "hold", "heart", "clock", "chain", "gold"]
export const DIRS = ["up", "down", "left", "right"]

export const WEAPONS = {
  mallet: { name: "Big Mallet", cost: 40, how: "Smashes every bomb on the field (except Skulls) and scores them." },
  freeze: { name: "Freeze Ray", cost: 25, how: "Stops every fuse and new bombs for 5 seconds." },
  snip: { name: "Fuse Snipper", cost: 30, how: "For 8 seconds every bomb dies to one tap: Helmets, Iron, Arrows and Hold bombs too." },
}
export const WEAPON_IDS = Object.keys(WEAPONS)

export const goalFor = (stage) => 15 + Math.round(((stage - 1) * 45) / (STAGES - 1))
export const typesFor = (mode, stage) => (mode === "endless" ? UNLOCK : UNLOCK.slice(0, Math.min(UNLOCK.length, Math.max(1, stage))))
export const newIn = (stage) => (stage <= UNLOCK.length ? UNLOCK[stage - 1] : null)

// combo multiplier: x2 at 5 in a row, x3 at 10, x4 at 20, x5 at 35
export const multFor = (combo) => (combo >= 35 ? 5 : combo >= 20 ? 4 : combo >= 10 ? 3 : combo >= 5 ? 2 : 1)

export const neighbors = (hole) => {
  const r = Math.floor(hole / COLS)
  const c = hole % COLS
  const out = []
  if (r > 0) out.push(hole - COLS)
  if (r < 2) out.push(hole + COLS)
  if (c > 0) out.push(hole - 1)
  if (c < 2) out.push(hole + 1)
  return out
}

export const newGame = ({ mode = "stage", stage = 1, seed = Date.now() } = {}) => ({
  mode,
  stage: mode === "stage" ? Math.max(1, Math.min(STAGES, stage)) : 0,
  seed,
  random: rng(seed),
  t: 0,
  holes: Array(HOLES).fill(null),
  hearts: START_HEARTS,
  score: 0,
  combo: 0,
  bestCombo: 0,
  whacked: 0,
  goal: mode === "stage" ? goalFor(stage) : 0,
  meter: 0,
  freezeUntil: 0,
  slowUntil: 0,
  snipUntil: 0,
  panicUntil: 0,
  nextPanicAt: mode === "endless" ? ENDLESS_PANIC_EVERY : Infinity,
  panicsDone: 0, // a stage's Panic Times so far (panicMarks)
  nextSpawnAt: 0.6,
  nextId: 1,
  events: [],
  over: null, // null | "won" | "lost"
  stars: 0,
})

export const takeEvents = (s) => {
  const e = s.events
  s.events = []
  return e
}

const progress = (s) => (s.mode === "stage" ? Math.min(1, s.whacked / s.goal) : 0)
// How hard things are right now (1 = stage 1's start). The owner found stage 3 too easy, so
// the ramp is steep and starts early: each stage is 14% faster than the last and a stage
// speeds up another 30% from its first bomb to its last (stage 3 ends at 1.6x, stage 10 at
// 2.6x, stage 20 at 4x). Endless climbs 9% every 10 bombs, up to 4x.
export const speedOf = (s) => {
  if (s.mode === "endless") return Math.min(4, 1 + Math.floor(s.whacked / 10) * 0.09)
  return 1 + (s.stage - 1) * 0.14 + progress(s) * 0.3
}
// how far through a stage its Panic Times come: one halfway from stage 3, two (at a third
// and two thirds) from stage 10
export const panicMarks = (stage) => (stage < 3 ? [] : stage < 10 ? [0.5] : [1 / 3, 2 / 3])
// Bombs that pop up together: from stage 4 (or a 1.3x Endless) a spawn is sometimes a pair,
// from stage 12 (2.2x) sometimes three at once. Returns [chance of 2, chance of 3].
export const volleyOdds = (s) => {
  const v = speedOf(s)
  if (v < 1.4) return [0, 0]
  return [Math.min(0.45, 0.1 + (v - 1.4) * 0.2), v >= 2.5 ? Math.min(0.2, (v - 2.5) * 0.12 + 0.06) : 0]
}
export const isPanic = (s) => s.t < s.panicUntil
export const isFrozen = (s) => s.t < s.freezeUntil
export const isSnip = (s) => s.t < s.snipUntil
const fuseRate = (s) => (isFrozen(s) ? 0 : s.t < s.slowUntil ? 0.5 : 1)
export const baseFuse = (s) => Math.max(1.0, 3.1 / Math.sqrt(speedOf(s))) * (isPanic(s) ? 0.7 : 1)
export const spawnGap = (s) => Math.max(0.22, 1.15 / speedOf(s)) / (isPanic(s) ? 3 : 1)
export const maxBombs = (s) => (isPanic(s) ? HOLES : Math.min(HOLES - 1, 3 + Math.floor(speedOf(s) * 1.6)))

const emptyHoles = (s) => s.holes.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0)
const pickHole = (s, except = -1) => {
  const free = emptyHoles(s).filter((i) => i !== except)
  return free.length ? free[Math.floor(s.random() * free.length)] : -1
}

// a new bomb of `type` in `hole` (tests and the UI's tutorial use this too)
export const makeBomb = (s, type, hole, extra = {}) => {
  const def = BOMBS[type]
  const fuse = baseFuse(s) * (type === "quick" ? 0.5 : type === "iron" || type === "hold" ? 1.25 : type === "helmet" || type === "jumper" ? 1.1 : 1)
  const b = {
    id: s.nextId++,
    type,
    hole,
    age: 0,
    fuse,
    left: fuse,
    hits: def.hits,
    dir: type === "arrow" ? DIRS[Math.floor(s.random() * 4)] : null,
    held: 0,
    holding: false,
    // Skulls and Gold bombs don't explode: they sink after `life` seconds
    life: type === "skull" ? 1.7 : type === "gold" ? 1.05 : Infinity,
    phase: s.random(), // Ghost bombs' fade
    small: false,
    ...extra,
  }
  s.holes[hole] = b
  s.events.push({ type: "pop", hole, bomb: type })
  return b
}

export const ghostVisible = (b) => b.type !== "ghost" || Math.sin((b.age / 1.3 + b.phase) * Math.PI * 2) > -0.25

const pickType = (s) => {
  const types = typesFor(s.mode, s.stage).filter((t) => !(t === "heart" && s.hearts >= MAX_HEARTS))
  return weighted(s.random, types.map((t) => [t, BOMBS[t].weight]))
}

const spawn = (s) => {
  const [two, three] = volleyOdds(s)
  const r = s.random()
  const count = r < three ? 3 : r < three + two ? 2 : 1
  for (let k = 0; k < count; k++) {
    if (s.holes.filter(Boolean).length >= maxBombs(s)) return
    const hole = pickHole(s)
    if (hole < 0) return
    makeBomb(s, pickType(s), hole)
  }
}

const loseHeart = (s, n, hole) => {
  s.hearts = Math.max(0, s.hearts - n)
  s.combo = 0
  s.events.push({ type: "hurt", hole, hearts: s.hearts })
  if (s.hearts <= 0) end(s, "lost")
}

const end = (s, how) => {
  if (s.over) return
  s.over = how
  s.stars = how === "won" ? (s.hearts >= 3 ? 3 : s.hearts === 2 ? 2 : 1) : 0
  s.events.push({ type: how })
}

const explode = (s, b) => {
  s.holes[b.hole] = null
  s.events.push({ type: "boom", hole: b.hole, bomb: b.type })
  if (b.type === "chain") {
    let took = 0
    for (const n of neighbors(b.hole)) {
      const o = s.holes[n]
      if (o && o.type !== "skull") {
        s.holes[n] = null
        took++
        s.events.push({ type: "boom", hole: n, bomb: o.type, chained: true })
      }
    }
    return loseHeart(s, took ? 2 : 1, b.hole)
  }
  loseHeart(s, 1, b.hole)
}

// a bomb defused: points, combo, meter, and its special power
const defuse = (s, b, { weapon = false } = {}) => {
  s.holes[b.hole] = null
  s.combo++
  s.bestCombo = Math.max(s.bestCombo, s.combo)
  s.whacked++
  const pts = BOMBS[b.type].points * (b.small ? 0.5 : 1) * multFor(s.combo) * (isPanic(s) ? 2 : 1)
  s.score += pts
  if (!weapon) s.meter = Math.min(METER_MAX, s.meter + 1)
  s.events.push({ type: "whack", hole: b.hole, bomb: b.type, points: pts, combo: s.combo, mult: multFor(s.combo) })
  if (b.type === "ice") {
    s.freezeUntil = Math.max(s.freezeUntil, s.t + 3)
    s.events.push({ type: "freeze", hole: b.hole })
  } else if (b.type === "heart") {
    s.hearts = Math.min(MAX_HEARTS, s.hearts + 1)
    s.events.push({ type: "heart", hole: b.hole, hearts: s.hearts })
  } else if (b.type === "clock") {
    s.slowUntil = Math.max(s.slowUntil, s.t + 4)
    s.events.push({ type: "slow", hole: b.hole })
  } else if (b.type === "splitter" && !weapon) {
    for (let k = 0; k < 2; k++) {
      const h = pickHole(s, b.hole)
      if (h >= 0) makeBomb(s, "black", h, { small: true, fuse: baseFuse(s) * 0.8, left: baseFuse(s) * 0.8 })
    }
    s.events.push({ type: "split", hole: b.hole })
  }
  checkGoal(s)
}

const checkGoal = (s) => {
  if (s.mode === "stage" && s.whacked >= s.goal) end(s, "won")
  // a stage's Panic Times (panicMarks: halfway from stage 3, twice from stage 10)
  const marks = s.mode === "stage" ? panicMarks(s.stage) : []
  if (s.panicsDone < marks.length && s.whacked >= s.goal * marks[s.panicsDone] && !s.over && !isPanic(s)) {
    s.panicsDone++
    startPanic(s)
  }
}

const startPanic = (s) => {
  s.panicUntil = s.t + PANIC_LEN
  s.nextSpawnAt = s.t + 0.15
  s.events.push({ type: "panic" })
}

const miss = (s, hole, why) => {
  if (s.combo) s.events.push({ type: "comboLost", combo: s.combo })
  s.combo = 0
  s.events.push({ type: "miss", hole, why })
}

// ---- the player's actions ----

// a tap (or click, or key) on a hole. Returns what it did: "defused" | "hit" | "jumped" |
// "skull" | "miss" | "needSwipe" | "needHold" | "ghost"
export const whack = (s, hole) => {
  if (s.over) return "over"
  const b = s.holes[hole]
  if (!b) {
    miss(s, hole, "empty")
    return "miss"
  }
  if (b.type === "skull") {
    s.holes[hole] = null
    s.events.push({ type: "skull", hole })
    loseHeart(s, 1, hole)
    return "skull"
  }
  if (b.type === "ghost" && !ghostVisible(b)) {
    miss(s, hole, "ghost")
    return "ghost"
  }
  if (isSnip(s)) {
    defuse(s, b)
    return "defused"
  }
  if (b.type === "arrow") {
    s.events.push({ type: "nudge", hole, why: "swipe" })
    return "needSwipe"
  }
  if (b.type === "hold") {
    s.events.push({ type: "nudge", hole, why: "hold" })
    return "needHold"
  }
  b.hits--
  if (b.hits > 0) {
    if (b.type === "jumper") {
      const to = pickHole(s, hole)
      if (to >= 0) {
        s.holes[hole] = null
        b.hole = to
        b.left = Math.max(b.left, 1.3)
        b.age = 0
        s.holes[to] = b
        s.events.push({ type: "jump", hole, to })
        return "jumped"
      }
    }
    s.events.push({ type: "hit", hole, bomb: b.type, left: b.hits })
    return "hit"
  }
  defuse(s, b)
  return "defused"
}

// a swipe that started on a hole. dir: up | down | left | right
export const swipe = (s, hole, dir) => {
  if (s.over) return "over"
  const b = s.holes[hole]
  if (!b) return whack(s, hole)
  if (b.type !== "arrow") return whack(s, hole) // a swipe on anything else is a whack
  if (isSnip(s) || b.dir === dir) {
    defuse(s, b)
    return "defused"
  }
  miss(s, hole, "wrongWay")
  return "wrongWay"
}

// press and hold (Hold bombs); anything else is whacked on the press
export const holdStart = (s, hole) => {
  if (s.over) return "over"
  const b = s.holes[hole]
  if (b && b.type === "hold" && !isSnip(s)) {
    b.holding = true
    s.events.push({ type: "holdStart", hole })
    return "holding"
  }
  return whack(s, hole)
}
export const holdEnd = (s, hole) => {
  const b = s.holes[hole]
  if (b && b.type === "hold" && b.holding) {
    b.holding = false
    b.held = 0
    s.events.push({ type: "holdLost", hole })
    return "released"
  }
  return null
}

export const canUse = (s, w) => !s.over && s.meter >= WEAPONS[w].cost
export const useWeapon = (s, w) => {
  if (!canUse(s, w)) return false
  s.meter -= WEAPONS[w].cost
  s.events.push({ type: "weapon", weapon: w })
  if (w === "mallet") {
    for (const b of s.holes.filter(Boolean)) {
      if (b.type === "skull") {
        s.holes[b.hole] = null
        s.events.push({ type: "sink", hole: b.hole })
      } else defuse(s, b, { weapon: true })
      if (s.over) break
    }
  } else if (w === "freeze") {
    s.freezeUntil = Math.max(s.freezeUntil, s.t + 5)
    s.nextSpawnAt = Math.max(s.nextSpawnAt, s.t + 5)
  } else if (w === "snip") {
    s.snipUntil = s.t + 8
  }
  return true
}

// ---- the clock ----
export const step = (s, dt) => {
  if (s.over || dt <= 0) return s
  s.t += dt
  // Endless: Panic Time every 30 seconds
  if (s.mode === "endless" && s.t >= s.nextPanicAt) {
    s.nextPanicAt = s.t + ENDLESS_PANIC_EVERY + PANIC_LEN
    startPanic(s)
  }
  const rate = fuseRate(s)
  for (const b of s.holes) {
    if (!b) continue
    b.age += dt
    if (b.holding) {
      b.held += dt
      if (b.held >= HOLD_TIME) {
        defuse(s, b)
        if (s.over) return s
        continue
      }
    }
    if (b.life !== Infinity) {
      if (!isFrozen(s)) b.life -= dt
      if (b.life <= 0) {
        s.holes[b.hole] = null
        s.events.push({ type: "sink", hole: b.hole, bomb: b.type })
        if (b.type === "gold") miss(s, b.hole, "gold")
      }
      continue
    }
    b.left -= dt * rate
    if (b.left <= 0) {
      explode(s, b)
      if (s.over) return s
    }
  }
  if (!isFrozen(s) && s.t >= s.nextSpawnAt) {
    spawn(s)
    s.nextSpawnAt = s.t + spawnGap(s) * (0.75 + s.random() * 0.5)
  }
  return s
}
