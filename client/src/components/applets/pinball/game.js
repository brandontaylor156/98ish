// Deep Sea Dive's rules: balls, scoring, the D-I-V-E lanes and multiplier, clam targets,
// the treasure chest and multiball, missions and ranks, ball save, extra balls and tilt.
// Pure: update(game, dt, input) moves everything on, and game.sfx collects sound cues
// (and game.flash the lights to blink) for the component to play and draw.

import { BALL_R, STEP, createBall, createWorld, firePlunger, stepWorld } from "./physics.js"
import { BALL_START, CHEST, DRAIN_Y, PLUNGER, buildTable, inShooterLane } from "./table.js"

export const BALLS_PER_GAME = 3
export const LAUNCH_MIN = 700
export const LAUNCH_MAX = 2900
export const PULL_TIME = 0.9 // seconds to pull the plunger all the way back
export const BALL_SAVE_TIME = 8
export const MAX_MULTIPLIER = 5
export const TILT_WARN = 2.2
export const TILT_LIMIT = 3.6
const TILT_DECAY = 0.55 // per second
const CHEST_HOLD = 1.2
const TARGET_RESET = 1.4
const BALL_END_PAUSE = 1.6
const CHEST_LOCKS = 3

export const SCORES = {
  bumper: 500,
  sling: 110,
  post: 50,
  rollover: 1000,
  dive: 10000,
  inlane: 500,
  outlane: 2000,
  target: 1500,
  bank: 15000,
  chest: 5000,
  lock: 10000,
  multiball: 25000,
  jackpot: 50000,
  mission: 25000,
  extraBall: 20000,
}

export const RANKS = ["Snorkeler", "Pearl Diver", "Aquanaut", "Reef Ranger", "Wreck Hunter", "Trench Explorer", "Abyss Captain", "Leviathan"]
export const EXTRA_BALL_RANKS = [2, 5] // reaching these ranks lights an extra ball

// Missions come round in order; each lap round asks for more
export const MISSIONS = [
  { id: "jelly", text: "Bump the jellyfish", goal: 8, event: "bumper" },
  { id: "clams", text: "Knock down the clams", goal: 3, event: "target" },
  { id: "dive", text: "Spell D-I-V-E up top", goal: 1, event: "dive" },
  { id: "chest", text: "Sink the treasure chest", goal: 2, event: "chest" },
  { id: "sling", text: "Ride the slingshots", goal: 8, event: "sling" },
  { id: "lanes", text: "Roll through the inlanes", goal: 3, event: "inlane" },
]

export const missionGoal = (g) => {
  const m = MISSIONS[g.missionsDone % MISSIONS.length]
  return m.goal * (1 + Math.floor(g.missionsDone / MISSIONS.length))
}
export const currentMission = (g) => MISSIONS[g.missionsDone % MISSIONS.length]
export const rankName = (rank) => RANKS[Math.min(rank, RANKS.length - 1)]

export const createGame = () => {
  const table = buildTable()
  const world = createWorld(table)
  const g = {
    world,
    mode: "over", // "play" | "over"
    score: 0,
    ballNumber: 1,
    extraBalls: 0,
    multiplier: 1,
    rank: 0,
    missionsDone: 0,
    missionProgress: 0,
    dive: [false, false, false, false],
    targets: [false, false, false], // down?
    targetResetAt: null,
    chestLocks: 0,
    chestBall: null, // { ball, until }
    multiball: false,
    launchQueue: 0, // balls waiting to be auto-launched (multiball, ball save)
    nextAutoLaunch: 0,
    ballSaveUntil: 0,
    ballSavePending: false, // starts when the ball leaves the shooter lane
    tilt: 0,
    tilted: false,
    bonus: 0, // end-of-ball bonus count
    ballEndAt: null, // the drained ball's bonus is being counted
    pull: 0,
    pulling: false,
    time: 0,
    acc: 0,
    message: null, // { text, until, big }
    sfx: [],
    flash: {}, // light name -> time it was hit
    shake: { x: 0, y: 0, t: -1 },
    left: false,
    right: false,
    stats: { bumper: 0, sling: 0, target: 0, chest: 0, dive: 0, drains: 0 },
  }
  return g
}

const say = (g, text, seconds = 2.5, big = false) => {
  g.message = { text, until: g.time + seconds, big }
}
const sound = (g, name, value) => g.sfx.push(value === undefined ? name : { name, value })
const flash = (g, name) => (g.flash[name] = g.time)

export const award = (g, points) => {
  if (g.tilted || g.mode !== "play") return
  g.score += points * g.multiplier
}

const serveBall = (g) => {
  const b = createBall(BALL_START.x, BALL_START.y)
  g.world.balls.push(b)
  g.world.plunger.y = PLUNGER.restY
  g.world.plunger.vy = 0
  g.ballSavePending = true
  return b
}

export const startGame = (g) => {
  const fresh = createGame()
  Object.assign(g, fresh, { mode: "play", sfx: ["start"] })
  serveBall(g)
  say(g, `Ball 1: ${currentMission(g).text}!`, 3)
}

const startBall = (g) => {
  g.multiplier = 1
  g.dive = [false, false, false, false]
  g.tilt = 0
  g.tilted = false
  g.bonus = 0
  g.multiball = false
  g.launchQueue = 0
  for (const f of g.world.flippers) f.pressed = false
  serveBall(g)
}

const mission = (g, event) => {
  const m = currentMission(g)
  if (m.event !== event || g.tilted) return
  g.missionProgress++
  if (g.missionProgress < missionGoal(g)) return
  g.missionsDone++
  g.missionProgress = 0
  g.rank++
  award(g, SCORES.mission * g.rank)
  sound(g, "mission")
  flash(g, "mission")
  if (EXTRA_BALL_RANKS.includes(g.rank)) {
    g.extraBalls++
    award(g, SCORES.extraBall)
    sound(g, "extraBall")
    flash(g, "extraBall")
    say(g, `Rank up: ${rankName(g.rank)}! EXTRA BALL!`, 3.5, true)
  } else {
    say(g, `Mission complete! Rank: ${rankName(g.rank)}. Next: ${currentMission(g).text}`, 4)
  }
}

const startMultiball = (g) => {
  g.multiball = true
  g.chestLocks = 0
  g.launchQueue += 2
  g.nextAutoLaunch = g.time + 0.4
  award(g, SCORES.multiball)
  sound(g, "multiball")
  flash(g, "multiball")
  say(g, "MULTIBALL! Sink the chest for the jackpot", 4, true)
  // a fresh ball save so the new balls aren't lost straight away
  g.ballSaveUntil = g.time + 10
}

// What each physics event is worth
export const handleEvent = (g, ev) => {
  const live = !g.tilted
  switch (ev.type) {
    case "bumper":
      if (!live) return
      award(g, SCORES.bumper)
      g.bonus += 1
      g.stats.bumper++
      flash(g, "bumper" + ev.id)
      sound(g, "bumper", ev.id)
      mission(g, "bumper")
      break
    case "sling":
      if (!live) return
      award(g, SCORES.sling)
      g.stats.sling++
      flash(g, "sling" + ev.id)
      sound(g, "sling")
      mission(g, "sling")
      break
    case "post":
      award(g, SCORES.post)
      sound(g, "rubber", ev.speed)
      break
    case "target":
      // only a hit on the face counts, not a ball glancing off an end
      if (g.targets[ev.id] || (ev.nx !== undefined && ev.nx < 0.5)) return
      g.targets[ev.id] = true
      g.world.colliders.find((c) => c.tag === "target" && c.id === ev.id).active = false
      award(g, SCORES.target)
      g.bonus += 2
      g.stats.target++
      flash(g, "target" + ev.id)
      sound(g, "target")
      mission(g, "target")
      if (g.targets.every(Boolean)) {
        award(g, SCORES.bank)
        g.targetResetAt = g.time + TARGET_RESET
        flash(g, "bank")
        sound(g, "bank")
        say(g, "Clams cracked! Pearl bonus", 2.5)
      }
      break
    case "rollover": {
      flash(g, "lane" + ev.id)
      award(g, SCORES.rollover)
      sound(g, "rollover")
      if (!live) return
      g.dive[ev.id] = true
      if (g.dive.every(Boolean)) {
        g.dive = [false, false, false, false]
        g.stats.dive++
        award(g, SCORES.dive)
        flash(g, "dive")
        if (g.multiplier < MAX_MULTIPLIER) {
          g.multiplier++
          say(g, `D-I-V-E! Multiplier ${g.multiplier}x`, 2.5, true)
        } else say(g, "D-I-V-E! Max multiplier", 2.5)
        sound(g, "dive")
        mission(g, "dive")
      }
      break
    }
    case "inlane":
      award(g, SCORES.inlane)
      flash(g, "inlane" + ev.id)
      sound(g, "rollover")
      mission(g, "inlane")
      break
    case "outlane":
      award(g, SCORES.outlane)
      flash(g, "outlane" + ev.id)
      sound(g, "outlane")
      break
    case "chest": {
      const b = ev.ball
      if (g.chestBall || ev.speed > 1400) return // too fast: it skips over the hole
      b.held = true
      b.x = CHEST.x
      b.y = CHEST.y
      b.vx = b.vy = 0
      g.chestBall = { ball: b, until: g.time + CHEST_HOLD }
      g.stats.chest++
      flash(g, "chest")
      sound(g, "chest")
      if (!live) return
      award(g, SCORES.chest)
      g.bonus += 3
      mission(g, "chest")
      if (g.multiball) {
        award(g, SCORES.jackpot)
        sound(g, "jackpot")
        say(g, "JACKPOT!", 2.5, true)
      } else {
        g.chestLocks++
        if (g.chestLocks >= CHEST_LOCKS) startMultiball(g)
        else {
          award(g, SCORES.lock)
          say(g, `Treasure ${g.chestLocks} of ${CHEST_LOCKS} locked`, 2.5)
        }
      }
      break
    }
    case "laneExit":
      if (ev.ball.vy < -300 && g.ballSavePending) {
        g.ballSavePending = false
        g.ballSaveUntil = Math.max(g.ballSaveUntil, g.time + BALL_SAVE_TIME)
      }
      break
    case "flipperHit":
      sound(g, "thud", ev.speed)
      break
    default:
  }
}

const ballsInPlay = (g) => g.world.balls.length + g.launchQueue

const drain = (g, b) => {
  g.world.balls.splice(g.world.balls.indexOf(b), 1)
  g.stats.drains++
  if (g.mode !== "play") return
  if (ballsInPlay(g) > 0) {
    // multiball goes on until one ball is left
    if (g.multiball && ballsInPlay(g) === 1) {
      g.multiball = false
      say(g, "Multiball over", 2)
    }
    if (!g.tilted && g.time < g.ballSaveUntil) {
      g.launchQueue++
      g.nextAutoLaunch = Math.max(g.nextAutoLaunch, g.time + 0.6)
      sound(g, "save")
    }
    return
  }
  if (!g.tilted && g.time < g.ballSaveUntil) {
    sound(g, "save")
    flash(g, "save")
    say(g, "BALL SAVED", 2, true)
    g.launchQueue++
    g.nextAutoLaunch = g.time + 0.8
    return
  }
  // the ball is over: count the bonus, then the next ball (or the end)
  sound(g, "drain")
  const bonus = g.tilted ? 0 : g.bonus * 1000 * g.multiplier
  if (bonus) {
    g.score += bonus
    say(g, `Depth bonus ${bonus.toLocaleString("en-US")}`, BALL_END_PAUSE)
  } else if (!g.tilted) say(g, "Ball lost", BALL_END_PAUSE)
  g.ballEndAt = g.time + BALL_END_PAUSE
}

const nextBall = (g) => {
  g.ballEndAt = null
  if (g.extraBalls > 0) {
    g.extraBalls--
    say(g, "SHOOT AGAIN", 2.5, true)
    sound(g, "extraBall")
    startBall(g)
    return
  }
  if (g.ballNumber >= BALLS_PER_GAME) {
    g.mode = "over"
    g.tilted = false
    for (const f of g.world.flippers) f.pressed = false
    say(g, "GAME OVER", 9999, true)
    sound(g, "gameOver")
    return
  }
  g.ballNumber++
  say(g, `Ball ${g.ballNumber}: ${currentMission(g).text}`, 3)
  startBall(g)
}

// A launched ball for multiball or a ball save, shot from the lane by the game
const autoLaunch = (g) => {
  const laneBusy = g.world.balls.some((b) => inShooterLane(b) && b.y > 820)
  if (laneBusy) return false
  const b = createBall(BALL_START.x, BALL_START.y - 10, 0, -(LAUNCH_MAX - 250))
  g.world.balls.push(b)
  sound(g, "launch", 0.8)
  return true
}

export const nudge = (g, dir) => {
  if (g.mode !== "play" || g.tilted) return
  const kick = { left: [130, -60], right: [-130, -60], up: [0, -170] }[dir] || [0, -170]
  for (const b of g.world.balls) {
    if (b.held || inShooterLane(b)) continue
    b.vx += kick[0] * (0.8 + Math.random() * 0.4)
    b.vy += kick[1] * (0.8 + Math.random() * 0.4)
  }
  g.shake = { x: -kick[0] / 30, y: -kick[1] / 30 - 2, t: g.time }
  sound(g, "nudge")
  g.tilt += 1
  if (g.tilt > TILT_LIMIT) {
    g.tilted = true
    for (const f of g.world.flippers) f.pressed = false
    g.ballSaveUntil = 0
    g.launchQueue = 0
    sound(g, "tilt")
    say(g, "TILT", 9999, true)
  } else if (g.tilt > TILT_WARN) {
    sound(g, "danger")
    say(g, "DANGER", 1.5, true)
  }
}

// The flippers also move the lit D-I-V-E lanes (lane change)
const setFlippers = (g, left, right) => {
  const [lf, rf] = g.world.flippers
  const live = g.mode === "play" && !g.tilted
  left = left && live
  right = right && live
  if (left && !lf.pressed) {
    sound(g, "flipper", "up")
    if (g.dive.some(Boolean)) g.dive = [...g.dive.slice(1), g.dive[0]]
  }
  if (right && !rf.pressed) {
    sound(g, "flipper", "up")
    if (g.dive.some(Boolean)) g.dive = [g.dive[3], ...g.dive.slice(0, 3)]
  }
  if ((!left && lf.pressed) || (!right && rf.pressed)) sound(g, "flipper", "down")
  lf.pressed = left
  rf.pressed = right
}

// input: { left, right, plunger, nudges: ["left" | "right" | "up"] }
export const update = (g, dt, input = {}) => {
  dt = Math.min(dt, 0.1)
  setFlippers(g, !!input.left, !!input.right)
  for (const dir of input.nudges || []) nudge(g, dir)

  // the plunger: pull while held, fire on release
  const p = g.world.plunger
  if (input.plunger && g.mode === "play" && p.vy === 0) {
    if (!g.pulling) sound(g, "pull")
    g.pulling = true
    g.pull = Math.min(1, g.pull + dt / PULL_TIME)
    p.y = PLUNGER.restY + g.pull * PLUNGER.pull
  } else if (g.pulling) {
    g.pulling = false
    firePlunger(p, LAUNCH_MIN + g.pull * (LAUNCH_MAX - LAUNCH_MIN))
    sound(g, "launch", g.pull)
    g.pull = 0
  }

  g.acc += dt
  while (g.acc >= STEP) {
    g.acc -= STEP
    g.time += STEP
    g.world.events.length = 0
    stepWorld(g.world, STEP)
    for (const ev of g.world.events) handleEvent(g, ev)
    for (const b of [...g.world.balls]) {
      if (b.y > DRAIN_Y || !Number.isFinite(b.x + b.y + b.vx + b.vy)) drain(g, b)
    }
  }

  g.tilt = Math.max(0, g.tilt - TILT_DECAY * dt)

  // timers
  if (g.chestBall && g.time >= g.chestBall.until) {
    const b = g.chestBall.ball
    b.held = false
    b.vx = -620 + Math.random() * 120
    b.vy = 260
    b.x -= BALL_R * 0.5
    g.chestBall = null
    sound(g, "kickout")
  }
  if (g.targetResetAt !== null && g.time >= g.targetResetAt) {
    g.targetResetAt = null
    g.targets = [false, false, false]
    for (const c of g.world.colliders) if (c.tag === "target") c.active = true
    sound(g, "reset")
  }
  if (g.launchQueue > 0 && g.time >= g.nextAutoLaunch && g.mode === "play") {
    if (autoLaunch(g)) g.launchQueue--
    g.nextAutoLaunch = g.time + 0.9
  }
  if (g.ballEndAt !== null && g.time >= g.ballEndAt) nextBall(g)
  if (g.message && g.time > g.message.until) g.message = null
  return g
}

// ---- high scores (top 5 with initials) ----

export const HIGH_SCORE_COUNT = 5

export const qualifies = (scores, score) => score > 0 && (scores.length < HIGH_SCORE_COUNT || score > scores[scores.length - 1].score)

export const insertScore = (scores, entry) =>
  [...scores, entry].sort((a, b) => b.score - a.score).slice(0, HIGH_SCORE_COUNT)

export const cleanInitials = (text) =>
  (text || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3) || "???"
