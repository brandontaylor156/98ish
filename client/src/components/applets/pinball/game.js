// Blue Screen's rules: balls, scoring, missions and ranks, the M-S-G lanes and bonus
// multiplier, 9-8-I-S-H drop targets, the Blue Screen lock and multiball, the Floppy
// drive, the Hard Drive captive ball, the Hourglass spinner, orbit loops, the ramp,
// skill shot, ball save, the Restore kickback, extra balls and tilt.
// Pure: update(game, dt, input) moves everything on; game.sfx collects sound cues,
// game.flash the lights to blink, game.popups the score popups, game.dmd what the
// dot-matrix display should show for a moment.

import { BALL_R, STEP, createBall, createWorld, firePlunger, stepWorld } from "./physics.js"
import { BALL_START, CAPTIVE, CAPTIVE_HOME, DRAIN_Y, FLOPPY, HEIGHT, PLUNGER, SCOOP, WIDTH, buildTable, inShooterLane } from "./table.js"

export const BALLS_PER_GAME = 3
export const LAUNCH_MIN = 1200
export const LAUNCH_MAX = 2900
export const PULL_TIME = 0.9 // seconds to pull the plunger all the way back
export const BALL_SAVE_TIME = 8
export const MULTIBALL_SAVE_TIME = 12
export const MAX_BONUS_X = 6
export const TILT_WARN = 2.2
export const TILT_LIMIT = 3.6
const TILT_DECAY = 0.55 // per second
const SCOOP_HOLD = 1.1
const FLOPPY_HOLD = 1.4
const TARGET_RESET = 1.6
const BALL_END_PAUSE = 1.8
export const LOCKS_FOR_MULTIBALL = 3
const LOOP_WINDOW = 3 // seconds from one orbit to the other
const SKILL_WINDOW = 4
const STUCK_TIME = 6 // a ball that hasn't moved this long gets a ball search kick
export const SCOOP_MAX_SPEED = 1800
export const FLOPPY_MAX_SPEED = 1700

export const SCORES = {
  bumper: 500,
  sling: 110,
  post: 50,
  spin: 250,
  rollover: 1000,
  lanes: 10000,
  inlane: 500,
  outlane: 2000,
  target: 1500,
  bank: 15000,
  scoop: 5000,
  lock: 20000,
  multiball: 50000,
  jackpot: 100000,
  jackpotGrow: 5000,
  floppy: 5000,
  drive: 7500,
  loop: 10000,
  ramp: 10000,
  skillShot: 25000,
  kickback: 1000,
  mission: 25000,
  extraBall: 20000,
}

export const RANKS = ["Intern", "Help Desk", "Technician", "Power User", "Programmer", "Network Admin", "Webmaster", "Sysadmin"]
export const EXTRA_BALL_RANKS = [3, 6] // reaching these ranks lights an extra ball at the Floppy drive

// The mission ladder, in order; after Sysadmin it goes round again asking for more.
// shot: the arrows that blink to point at it
export const MISSIONS = [
  { id: "dialup", name: "DIAL-UP", text: "Spin the Hourglass", goal: 30, event: "spin", shot: "orbitL" },
  { id: "scan", name: "VIRUS SCAN", text: "Knock down 9-8-I-S-H", goal: 1, event: "bank", shot: "bank" },
  { id: "defrag", name: "DEFRAGMENT", text: "Shoot the My Computer ramp", goal: 3, event: "ramp", shot: "ramp" },
  { id: "im", name: "SEND AN IM", text: "Light M-S-G up top", goal: 1, event: "lanes", shot: "lanes" },
  { id: "save", name: "SAVE TO FLOPPY", text: "Sink the Floppy drive", goal: 2, event: "floppy", shot: "floppy" },
  { id: "surf", name: "SURF THE WEB", text: "Loop the orbits", goal: 2, event: "loop", shot: "orbits" },
  { id: "cleanup", name: "DISK CLEANUP", text: "Bump the Hard Drive to the top", goal: 2, event: "drive", shot: "drive" },
  { id: "update", name: "INSTALL UPDATE", text: "Lock 3 balls in the Blue Screen", goal: 1, event: "multiball", shot: "scoop" },
]

export const currentMission = (g) => MISSIONS[g.missionsDone % MISSIONS.length]
export const missionGoal = (g) => {
  const m = currentMission(g)
  const lap = Math.floor(g.missionsDone / MISSIONS.length)
  return m.goal === 1 ? 1 + lap : Math.ceil(m.goal * (1 + lap * 0.5))
}
export const rankName = (rank) => RANKS[Math.min(rank, RANKS.length - 1)] + (rank >= RANKS.length ? ` ${"*".repeat(Math.min(5, rank - RANKS.length + 1))}` : "")

const createCaptive = () => createBall(CAPTIVE_HOME.x, CAPTIVE_HOME.y, 0, 0, { kind: "captive" })

export const createGame = () => {
  const world = createWorld(buildTable())
  world.balls.push(createCaptive())
  return {
    world,
    mode: "attract", // "attract" | "play" | "over"
    score: 0,
    ballNumber: 1,
    extraBalls: 0,
    extraLit: false, // an extra ball waits at the Floppy drive
    bonusX: 1,
    bonus: 0, // end-of-ball bonus units
    rank: 0,
    missionsDone: 0,
    missionProgress: 0,
    lanes: [false, false, false], // M-S-G lit
    targets: [false, false, false, false, false], // 9-8-I-S-H down?
    targetResetAt: null,
    lockLit: false,
    locks: 0,
    scoopBall: null, // { ball, until, keep }
    floppyBall: null, // { ball, until }
    multiball: false,
    jackpot: SCORES.jackpot,
    jackpots: 0,
    launchQueue: 0, // balls waiting to be auto-launched (multiball, ball save)
    nextAutoLaunch: 0,
    ballSaveUntil: 0,
    ballSavePending: false, // starts when the ball leaves the shooter lane
    kickback: true, // Restore: the left outlane kicks the ball back once
    skillLane: -1,
    skillUntil: 0,
    orbitStart: null, // { id, t }
    tilt: 0,
    tilted: false,
    ballEndAt: null, // the drained ball's bonus is being counted
    pull: 0,
    pulling: false,
    time: 0,
    acc: 0,
    message: null, // { text, until, big }
    dmd: null, // { lines: [big, small?], until, flash }
    sfx: [],
    flash: {}, // light name -> time it was hit
    popups: [], // { x, y, text, t }
    shake: { x: 0, y: 0, t: -9 },
    debug: [], // ball searches and escapes, for tests
    stats: { bumper: 0, sling: 0, target: 0, scoop: 0, floppy: 0, ramp: 0, loop: 0, spin: 0, drive: 0, drains: 0, escaped: 0, searches: 0, multiballs: 0, locks: 0 },
  }
}

const say = (g, text, seconds = 2.5, big = false) => {
  g.message = { text, until: g.time + seconds, big }
}
// the dot-matrix display shows this for a while (big line, small line)
const show = (g, big, small = "", seconds = 2, flash = false) => {
  g.dmd = { big, small, until: g.time + seconds, flash, t: g.time }
}
const sound = (g, name, value) => g.sfx.push(value === undefined ? name : { name, value })
const flash = (g, name) => (g.flash[name] = g.time)
const shake = (g, x, y) => (g.shake = { x, y, t: g.time })
const fmt = (n) => n.toLocaleString("en-US")

export const award = (g, points, where) => {
  if (g.tilted || g.mode !== "play") return 0
  g.score += points
  if (where && points >= 1000) {
    g.popups.push({ x: where.x, y: where.y, text: points >= 1e6 ? `${Math.round(points / 1e5) / 10}M` : points >= 1e4 ? `${Math.round(points / 1000)}K` : fmt(points), t: g.time })
    if (g.popups.length > 8) g.popups.shift()
  }
  return points
}

const serveBall = (g) => {
  const b = createBall(BALL_START.x, BALL_START.y)
  g.world.balls.push(b)
  g.world.plunger.y = PLUNGER.restY
  g.world.plunger.vy = 0
  g.ballSavePending = true
  g.skillLane = Math.floor(Math.random() * 3)
  g.skillUntil = Infinity
  return b
}

export const startGame = (g) => {
  const fresh = createGame()
  Object.assign(g, fresh, { mode: "play", sfx: ["start"] })
  serveBall(g)
  show(g, "PLAYER 1", `BALL 1 - ${currentMission(g).name}`, 3)
  say(g, `Ball 1: ${currentMission(g).text}`, 3)
}

const playBalls = (g) => g.world.balls.filter((b) => b.kind === "play")

const startBall = (g) => {
  g.bonusX = 1
  g.lanes = [false, false, false]
  g.tilt = 0
  g.tilted = false
  g.bonus = 0
  g.multiball = false
  g.launchQueue = 0
  g.kickback = true
  g.orbitStart = null
  for (const f of g.world.flippers) f.pressed = false
  serveBall(g)
}

const mission = (g, event, amount = 1) => {
  const m = currentMission(g)
  if (m.event !== event || g.tilted || g.mode !== "play") return
  g.missionProgress += amount
  const goal = missionGoal(g)
  if (g.missionProgress < goal) {
    if (goal > 1 && (goal <= 5 || g.missionProgress % 5 === 0)) show(g, m.name, `${Math.min(g.missionProgress, goal)} OF ${goal}`, 1.2)
    return
  }
  g.missionsDone++
  g.missionProgress = 0
  g.rank++
  award(g, SCORES.mission * g.rank)
  sound(g, "mission")
  flash(g, "mission")
  const next = currentMission(g)
  if (EXTRA_BALL_RANKS.includes(g.rank)) {
    g.extraLit = true
    flash(g, "extraLit")
    show(g, "EXTRA BALL LIT", `RANK: ${rankName(g.rank).toUpperCase()}`, 3.5, true)
    say(g, `${m.name} complete! You're a ${rankName(g.rank)}. Extra ball lit at the Floppy drive`, 4)
  } else {
    show(g, "MISSION COMPLETE", `RANK: ${rankName(g.rank).toUpperCase()}`, 3, true)
    say(g, `${m.name} complete! You're a ${rankName(g.rank)}. Next: ${next.text}`, 4)
  }
}

const startMultiball = (g) => {
  g.multiball = true
  g.locks = 0
  g.lockLit = false
  g.jackpot = SCORES.jackpot
  g.jackpots = 0
  g.launchQueue += LOCKS_FOR_MULTIBALL - 1
  g.nextAutoLaunch = g.time + 0.6
  g.stats.multiballs++
  award(g, SCORES.multiball)
  sound(g, "multiball")
  flash(g, "multiball")
  shake(g, 0, 6)
  show(g, "MULTIBALL", "UPDATE INSTALLING...", 4, true)
  say(g, "MULTIBALL! Shoot the ramp for the jackpot", 4, true)
  // a fresh ball save so the new balls aren't lost straight away
  g.ballSaveUntil = g.time + MULTIBALL_SAVE_TIME
  mission(g, "multiball")
}

const resetTargets = (g) => {
  g.targetResetAt = null
  g.targets = g.targets.map(() => false)
  for (const c of g.world.colliders) if (c.tag === "target") c.active = true
  sound(g, "reset")
}

// a saucer catches a ball (and counts it as inside the hole, so letting it go doesn't
// catch it again)
const hold = (g, b, x, y, tag) => {
  b.held = true
  b.x = x
  b.y = y
  b.vx = b.vy = 0
  for (const s of g.world.sensors) if (s.tag === tag) b.inside.add(s)
}

const removeBall = (g, b) => {
  const i = g.world.balls.indexOf(b)
  if (i >= 0) g.world.balls.splice(i, 1)
}

// The skill shot ends at the first thing the ball touches after the launch (other than
// the top lanes), or a few seconds after it left the shooter lane
const endSkill = (g) => {
  g.skillLane = -1
}

// What each physics event is worth
export const handleEvent = (g, ev) => {
  const live = !g.tilted && g.mode === "play"
  const b = ev.ball
  switch (ev.type) {
    case "bumper":
      if (!live) return
      endSkill(g)
      award(g, SCORES.bumper)
      g.bonus += 1
      g.stats.bumper++
      if (g.multiball) g.jackpot += SCORES.jackpotGrow
      flash(g, "bumper" + ev.id)
      sound(g, "bumper", ev.id)
      mission(g, "bumper")
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
      mission(g, "spin")
      break
    case "target": {
      // only a hit on the face counts, not a ball glancing off an end or the back
      if (g.targets[ev.id] || (ev.ny !== undefined && ev.ny < 0.5)) return
      endSkill(g)
      g.targets[ev.id] = true
      g.world.colliders.find((c) => c.tag === "target" && c.id === ev.id).active = false
      award(g, SCORES.target, b)
      g.bonus += 2
      g.stats.target++
      flash(g, "target" + ev.id)
      sound(g, "target")
      if (g.targets.every(Boolean)) {
        award(g, SCORES.bank)
        flash(g, "bank")
        sound(g, "bank")
        mission(g, "bank")
        if (g.multiball) {
          g.targetResetAt = g.time + TARGET_RESET
          show(g, "98ISH!", "JACKPOT +25K", 1.5)
          g.jackpot += 25000
        } else {
          // the way into the Blue Screen stays open until a ball is locked
          g.lockLit = true
          flash(g, "lockLit")
          show(g, "LOCK IS LIT", "SHOOT THE BLUE SCREEN", 2.5, true)
          say(g, "9-8-I-S-H! Lock is lit: shoot the Blue Screen", 3)
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
          flash(g, "skill")
          show(g, "SKILL SHOT", fmt(SCORES.skillShot), 2, true)
        }
        endSkill(g)
      }
      g.lanes[ev.id] = true
      if (g.lanes.every(Boolean)) {
        g.lanes = [false, false, false]
        award(g, SCORES.lanes)
        flash(g, "lanes")
        if (g.bonusX < MAX_BONUS_X) g.bonusX++
        show(g, "NEW MESSAGE!", `BONUS ${g.bonusX}X`, 2)
        sound(g, "lanes")
        mission(g, "lanes")
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
      if (ev.id === 0 && g.kickback && live && b.vy > 0) {
        // Restore: the kickback fires the ball back up the left side
        g.kickback = false
        b.x = 39
        b.vx = 0
        b.vy = -2500
        award(g, SCORES.kickback)
        flash(g, "kickback")
        sound(g, "kickback")
        shake(g, 0, -4)
        show(g, "RESTORED!", "FROM THE RECYCLE BIN", 1.6)
        return
      }
      award(g, SCORES.outlane)
      sound(g, "outlane")
      break
    case "scoop": {
      if (g.scoopBall || ev.speed > SCOOP_MAX_SPEED || b.held) return
      hold(g, b, SCOOP.x, SCOOP.y, "scoop")
      endSkill(g)
      g.stats.scoop++
      flash(g, "scoop")
      sound(g, "scoop")
      g.scoopBall = { ball: b, until: g.time + SCOOP_HOLD, keep: false }
      if (!live) return
      g.bonus += 3
      if (g.multiball) {
        const v = award(g, g.jackpot * 2, b)
        g.jackpots++
        sound(g, "jackpot")
        shake(g, 0, 5)
        show(g, "SUPER JACKPOT", fmt(v), 2.5, true)
        say(g, "SUPER JACKPOT!", 2.5, true)
      } else if (g.lockLit) {
        g.locks++
        g.lockLit = false
        g.stats.locks++
        g.targetResetAt = g.time + 0.4
        award(g, SCORES.lock, b)
        flash(g, "lock")
        shake(g, 0, 4)
        if (g.locks >= LOCKS_FOR_MULTIBALL) startMultiball(g)
        else {
          // the ball stays locked in the Blue Screen; a new one comes to the plunger
          g.scoopBall.keep = true
          sound(g, "lock")
          show(g, `BALL ${g.locks} LOCKED`, "FATAL EXCEPTION 0E", 2.5, true)
          say(g, `Ball ${g.locks} locked. ${LOCKS_FOR_MULTIBALL - g.locks} more for multiball`, 3)
        }
      } else {
        award(g, SCORES.scoop, b)
        show(g, "BLUE SCREEN", "HIT 98ISH TO LIGHT LOCK", 1.6)
      }
      break
    }
    case "floppy": {
      if (g.floppyBall || ev.speed > FLOPPY_MAX_SPEED || b.held) return
      hold(g, b, FLOPPY.x, FLOPPY.y, "floppy")
      endSkill(g)
      g.stats.floppy++
      flash(g, "floppy")
      sound(g, "floppy")
      g.floppyBall = { ball: b, until: g.time + FLOPPY_HOLD }
      if (!live) return
      award(g, SCORES.floppy, b)
      g.bonus += 2
      g.kickback = true
      if (g.extraLit) {
        g.extraLit = false
        g.extraBalls++
        award(g, SCORES.extraBall)
        sound(g, "extraBall")
        flash(g, "extraBall")
        show(g, "EXTRA BALL", "SAVED TO DISK", 3, true)
        say(g, "EXTRA BALL!", 3, true)
      } else show(g, "SAVING...", "RESTORE IS LIT", 1.4)
      mission(g, "floppy")
      break
    }
    case "drive":
      if (!live) return
      award(g, SCORES.drive, b)
      g.stats.drive++
      g.bonus += 2
      flash(g, "drive")
      sound(g, "drive")
      mission(g, "drive")
      break
    case "orbit": {
      if (!live) return
      flash(g, "orbit" + ev.id)
      if (b.vy < 0) {
        g.orbitStart = { id: ev.id, t: g.time }
        return
      }
      const s = g.orbitStart
      g.orbitStart = null
      if (s && s.id !== ev.id && g.time - s.t < LOOP_WINDOW) {
        award(g, SCORES.loop * (1 + Math.min(4, g.stats.loop % 5)), b)
        g.stats.loop++
        g.bonus += 3
        flash(g, "loop")
        sound(g, "loop")
        show(g, "ORBIT!", "SURFING THE WEB", 1.4)
        mission(g, "loop")
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
      g.bonus += 5
      flash(g, "ramp")
      sound(g, "ramp")
      if (g.multiball) {
        const v = award(g, g.jackpot, b)
        g.jackpots++
        g.jackpot += 25000
        sound(g, "jackpot")
        flash(g, "jackpot")
        shake(g, 0, 4)
        show(g, "JACKPOT", fmt(v), 2.2, true)
      } else {
        award(g, SCORES.ramp, b)
        show(g, "MY COMPUTER", `RAMPS ${g.stats.ramp}`, 1.2)
      }
      mission(g, "ramp")
      break
    }
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

const ballsInPlay = (g) => playBalls(g).length + g.launchQueue

const drain = (g, b) => {
  removeBall(g, b)
  g.stats.drains++
  if (g.mode !== "play") return
  if (ballsInPlay(g) > 0) {
    // multiball goes on until one ball is left
    if (g.multiball && ballsInPlay(g) === 1 && g.time >= g.ballSaveUntil) {
      g.multiball = false
      show(g, "MULTIBALL OVER", `${g.jackpots} JACKPOTS`, 2)
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
    show(g, "BALL SAVED", "", 2, true)
    say(g, "BALL SAVED", 2, true)
    g.launchQueue++
    g.nextAutoLaunch = g.time + 0.8
    return
  }
  // the ball is over: count the bonus, then the next ball (or the end)
  g.multiball = false
  sound(g, "drain")
  const bonus = g.tilted ? 0 : g.bonus * 1000 * g.bonusX
  if (bonus) {
    g.score += bonus
    show(g, "BONUS", `${fmt(g.bonus * 1000)} X ${g.bonusX}`, BALL_END_PAUSE)
    say(g, `Bonus ${fmt(bonus)}`, BALL_END_PAUSE)
  } else if (!g.tilted) {
    show(g, "BALL LOST", "", BALL_END_PAUSE)
    say(g, "Ball lost", BALL_END_PAUSE)
  }
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
  show(g, `BALL ${g.ballNumber}`, currentMission(g).name, 2.5)
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
    const k = b.kind === "captive" ? 0.3 : 1
    b.vx += kick[0] * (0.8 + Math.random() * 0.4) * k
    b.vy += kick[1] * (0.8 + Math.random() * 0.4) * k
  }
  shake(g, -kick[0] / 30, -kick[1] / 30 - 2)
  sound(g, "nudge")
  g.tilt += 1
  if (g.tilt > TILT_LIMIT) {
    g.tilted = true
    for (const f of g.world.flippers) f.pressed = false
    g.ballSaveUntil = 0
    g.launchQueue = 0
    g.kickback = false
    sound(g, "tilt")
    show(g, "TILT", "", 9999, true)
    say(g, "TILT", 9999, true)
  } else if (g.tilt > TILT_WARN) {
    sound(g, "danger")
    show(g, "DANGER", "", 1.5, true)
    say(g, "DANGER", 1.5, true)
  }
}

// The flippers also move the lit M-S-G lanes (lane change), and the skill shot lane
const setFlippers = (g, left, right) => {
  const [lf, rf, uf] = g.world.flippers
  const live = g.mode === "play" && !g.tilted
  left = left && live
  right = right && live
  if (left && !lf.pressed) {
    sound(g, "flipper", "up")
    if (g.lanes.some(Boolean)) g.lanes = [...g.lanes.slice(1), g.lanes[0]]
    if (g.skillLane >= 0) g.skillLane = (g.skillLane + 2) % 3
  }
  if (right && !rf.pressed) {
    sound(g, "flipper", "up")
    if (g.lanes.some(Boolean)) g.lanes = [g.lanes[2], ...g.lanes.slice(0, 2)]
    if (g.skillLane >= 0) g.skillLane = (g.skillLane + 1) % 3
  }
  if ((!left && lf.pressed) || (!right && rf.pressed)) sound(g, "flipper", "down")
  lf.pressed = left
  rf.pressed = right
  if (uf) uf.pressed = left
}

// Ball search: a ball that hasn't moved for a while (wedged somewhere) gets a kick
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
      b.vx += (Math.random() - 0.5) * 900
      b.vy -= 500 + Math.random() * 400
      b.still = g.time
      g.stats.searches++
      if (g.debug.length < 50) g.debug.push({ kind: "search", x: Math.round(b.x), y: Math.round(b.y), layer: b.layer })
    }
  }
}

const onTable = (b) => b.x > -20 && b.x < WIDTH + 20 && b.y > -40 && Number.isFinite(b.x + b.y + b.vx + b.vy)

// input: { left, right, plunger, pull (0..1, a touch plunger's drag), nudges: ["left" | "right" | "up"] }
export const update = (g, dt, input = {}) => {
  dt = Math.min(dt, 0.1)
  setFlippers(g, !!input.left, !!input.right)
  for (const dir of input.nudges || []) nudge(g, dir)

  // the plunger: pull while held (or dragged), fire on release
  const p = g.world.plunger
  const dragging = typeof input.pull === "number"
  if ((input.plunger || dragging) && g.mode === "play" && p.vy === 0) {
    if (!g.pulling) sound(g, "pull")
    g.pulling = true
    g.pull = dragging ? Math.max(0, Math.min(1, input.pull)) : Math.min(1, g.pull + dt / PULL_TIME)
    p.y = PLUNGER.restY + g.pull * PLUNGER.pull
    // the ball sits on the plunger's tip and goes back with it
    for (const b of g.world.balls) {
      if (b.kind === "play" && !b.held && inShooterLane(b) && b.y > PLUNGER.restY - 60 && Math.abs(b.vy) < 400) {
        b.y = p.y - BALL_R - 0.25
        b.vy = 0
      }
    }
  } else if (g.pulling) {
    g.pulling = false
    if (g.pull > 0.02) {
      firePlunger(p, LAUNCH_MIN + g.pull * (LAUNCH_MAX - LAUNCH_MIN))
      sound(g, "launch", g.pull)
    } else p.y = PLUNGER.restY
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
      if (b.kind === "captive") {
        // the Hard Drive never leaves its channel (if it ever did, it goes home)
        if (b.x < CAPTIVE.x0 - 4 || b.x > CAPTIVE.x1 + 4 || b.y < CAPTIVE.top - 4 || b.y > CAPTIVE.mouth + 8 || !onTable(b)) {
          Object.assign(b, { x: CAPTIVE_HOME.x, y: CAPTIVE_HOME.y, vx: 0, vy: 0 })
        }
        continue
      }
      if (b.y > DRAIN_Y) drain(g, b)
      else if (!onTable(b) || b.y > HEIGHT + 200) {
        g.stats.escaped++
        if (g.debug.length < 50) g.debug.push({ kind: "escape", x: Math.round(b.px), y: Math.round(b.py), vx: Math.round(b.vx), vy: Math.round(b.vy), layer: b.layer })
        drain(g, b)
      }
    }
  }

  g.tilt = Math.max(0, g.tilt - TILT_DECAY * dt)

  // timers
  if (g.scoopBall && g.time >= g.scoopBall.until) {
    const { ball, keep } = g.scoopBall
    g.scoopBall = null
    if (keep && g.mode === "play" && !g.tilted) {
      removeBall(g, ball)
      serveBall(g)
      g.skillLane = -1
    } else {
      ball.held = false
      ball.x = SCOOP.x
      ball.y = SCOOP.y + BALL_R * 0.6
      ball.vx = (Math.random() - 0.5) * 200
      ball.vy = 650
      sound(g, "kickout")
    }
  }
  if (g.floppyBall && g.time >= g.floppyBall.until) {
    const b = g.floppyBall.ball
    g.floppyBall = null
    b.held = false
    b.vx = 520 + Math.random() * 120
    b.vy = 380
    sound(g, "kickout")
  }
  if (g.targetResetAt !== null && g.time >= g.targetResetAt) resetTargets(g)
  if (g.launchQueue > 0 && g.time >= g.nextAutoLaunch && g.mode === "play") {
    if (autoLaunch(g)) g.launchQueue--
    g.nextAutoLaunch = g.time + 0.9
  }
  if (g.multiball && playBalls(g).length + g.launchQueue <= 1 && !g.scoopBall && g.time >= g.ballSaveUntil) {
    g.multiball = false
    show(g, "MULTIBALL OVER", `${g.jackpots} JACKPOTS`, 2)
  }
  if (g.ballEndAt !== null && g.time >= g.ballEndAt) nextBall(g)
  if (g.mode === "play") searchStuck(g)
  if (g.message && g.time > g.message.until) g.message = null
  if (g.dmd && g.time > g.dmd.until) g.dmd = null
  while (g.popups.length && g.time - g.popups[0].t > 1) g.popups.shift()
  if (g.mode !== "play") g.world.time = g.time
  return g
}

// ---- high scores (top 10 with initials, kept per user by the storage seam) ----

export const HIGH_SCORE_COUNT = 10

// scores saved by Deep Sea Dive (top 5, same shape) carry over; anything odd is dropped
export const migrateScores = (raw) =>
  (Array.isArray(raw) ? raw : [])
    .filter((s) => s && Number.isFinite(s.score) && s.score > 0)
    .map((s) => ({ name: cleanInitials(s.name), score: Math.round(s.score), date: Number.isFinite(s.date) ? s.date : 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, HIGH_SCORE_COUNT)

export const qualifies = (scores, score) => score > 0 && (scores.length < HIGH_SCORE_COUNT || score > scores[scores.length - 1].score)

export const insertScore = (scores, entry) =>
  [...scores, entry].sort((a, b) => b.score - a.score).slice(0, HIGH_SCORE_COUNT)

export function cleanInitials(text) {
  return (
    String(text || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 3) || "???"
  )
}
