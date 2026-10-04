// A Tetherball match, with no DOM (tested in tetherball.test.js): two players, the ball
// (physics.js), serves, hits, the computer player, games and the match.
//
// Player 0 stands on the near half (z > 0) and winds the rope counter-clockwise (theta +);
// player 1 on the far half (z < 0) winds it clockwise. A player can only hit the ball on their
// own half. Wind the rope all the way round in your direction to win the game; first to
// `target` games wins the match.
//
// Players run to the ball by themselves; the person decides WHEN to swing, how hard (power
// 0..1) and how high (loft). A swing is open for SWING_WIN seconds: if the ball comes within
// reach meanwhile, it's hit. Online, the host's browser runs the match; a guest's swing comes
// with the host time it started, and the host checks it against the ball's recent history
// (HISTORY seconds), hitting the ball where it was then and flying it forward (remoteSwing).

import { rng } from "../../../utils/gameKit.js"
import { BALL_R, STEP, azimuth, copyBall, horizontal, hitBall, newBall, speed, stepBall, angularSpeed, woundBy, wraps, freeLength, tieHeight, MAX_WRAPS } from "./physics.js"

export const SWING_WIN = 0.26
export const COOLDOWN = 0.22
export const REACH = 0.95
export const REACH_LOW = 0.35
export const REACH_HIGH = 2.75
export const RUN_SPEED = 5.2
export const HISTORY = 0.45
export const LEVELS = {
  easy: { delay: 0.2, miss: 0.32, power: [0.35, 0.65], name: "Easy" },
  medium: { delay: 0.12, miss: 0.14, power: [0.5, 0.85], name: "Medium" },
  hard: { delay: 0.06, miss: 0.05, power: [0.7, 1], name: "Hard" },
}
export const SIDES = [1, -1] // the half each player stands on (sign of z)
export const DIRS = [1, -1] // the way each player winds the rope
const EDGE = 0.2 // radians kept clear of the halfway line

const clampAz = (seat, az) => {
  // player 0: (EDGE, PI - EDGE); player 1: (-PI + EDGE, -EDGE)
  if (seat === 0) {
    if (az < 0) az = az > -Math.PI / 2 ? EDGE : Math.PI - EDGE
    return Math.max(EDGE, Math.min(Math.PI - EDGE, az))
  }
  if (az > 0) az = az < Math.PI / 2 ? -EDGE : -Math.PI + EDGE
  return Math.max(-Math.PI + EDGE, Math.min(-EDGE, az))
}

const newPlayer = (seat, kind, level) => ({
  seat,
  kind, // "human" | "cpu" | "remote"
  level,
  az: seat === 0 ? Math.PI / 2 : -Math.PI / 2,
  r: 1.1,
  x: 0,
  z: 0,
  swing: null, // { t, power, loft }
  cooldown: 0,
  lastHit: -9,
  plan: null, // the computer's next swing: { at }
  hits: 0,
})

const place = (p) => {
  p.x = Math.cos(p.az) * p.r
  p.z = Math.sin(p.az) * p.r
}

export const createMatch = ({ players = ["human", "cpu"], level = "medium", target = 2, server = 0, seed = Date.now(), rewind = false } = {}) => {
  const m = {
    random: rng(seed),
    t: 0,
    players: players.map((k, i) => newPlayer(i, k, level)),
    level,
    target,
    games: [0, 0],
    server,
    ball: null,
    phase: "serve", // serve | play | point | over
    phaseT: 0,
    winner: null,
    gameWinner: null,
    still: 0,
    events: [],
    carry: 0,
    hitCount: 0,
    lastHitter: null,
    history: rewind ? [] : null,
    rally: 0,
  }
  m.players.forEach(place)
  setupServe(m)
  return m
}

export const takeEvents = (m) => {
  const e = m.events
  m.events = []
  return e
}

// the ball held by the server, on their side, the rope as wound as it is
const setupServe = (m, keepTheta = false) => {
  const p = m.players[m.server]
  const az = SIDES[m.server] === 1 ? Math.PI / 2 + (m.server ? -0.25 : 0.25) : -Math.PI / 2 + 0.25
  const old = m.ball
  const b = newBall(az)
  if (keepTheta && old) b.theta = old.theta
  // held out toward the server
  const L = freeLength(b)
  const r = Math.min(0.75, L * 0.5)
  b.x = Math.cos(az) * r
  b.z = Math.sin(az) * r
  b.y = tieHeight(b) - Math.sqrt(Math.max(0, L * L - r * r))
  b.lastAz = az
  m.ball = b
  p.az = az
  p.r = r + 0.55
  place(p)
  m.phase = "serve"
  m.phaseT = 0
  m.still = 0
  m.rally = 0
  m.lastHitter = null
  for (const q of m.players) {
    q.swing = null
    q.plan = null
  }
}

// within this player's reach (and on their half)?
export const inReach = (m, p, b = m.ball) => {
  if (Math.sign(b.z) !== SIDES[p.seat] && Math.abs(b.z) > 0.05) return false
  if (b.y < REACH_LOW || b.y > REACH_HIGH) return false
  return Math.hypot(b.x - p.x, b.z - p.z) <= REACH
}

// a person (or the computer) starts a swing
export const swing = (m, seat, power = 0.7, loft = 0.3) => {
  const p = m.players[seat]
  if (!p || m.phase === "over" || m.phase === "point") return false
  if (m.phase === "serve") {
    if (seat !== m.server) return false
    serve(m, power, loft)
    return true
  }
  if (p.swing || p.cooldown > 0) return false
  p.swing = { t: 0, power, loft }
  m.events.push({ type: "swing", seat })
  return true
}

const serve = (m, power, loft) => {
  const p = m.players[m.server]
  hitBall(m.ball, DIRS[m.server], Math.max(0.35, power), Math.max(0.15, loft))
  m.phase = "play"
  m.phaseT = 0
  p.lastHit = m.t
  p.hits++
  m.hitCount++
  m.lastHitter = m.server
  m.events.push({ type: "hit", seat: m.server, serve: true, power })
}

const doHit = (m, p) => {
  const s = p.swing
  // a cleaner contact (the ball near the middle of the reach) hits harder
  const d = Math.hypot(m.ball.x - p.x, m.ball.z - p.z)
  const quality = Math.max(0, 1 - d / REACH)
  const power = s.power * (0.65 + 0.35 * quality)
  hitBall(m.ball, DIRS[p.seat], power, s.loft)
  p.swing = null
  p.cooldown = COOLDOWN
  p.lastHit = m.t
  p.hits++
  m.hitCount++
  m.rally++
  m.lastHitter = p.seat
  m.events.push({ type: "hit", seat: p.seat, power, quality })
}

// where the computer and the people's players run: to meet the ball on their half
const movePlayer = (m, p, dt) => {
  const b = m.ball
  let az = azimuth(b) + angularSpeed(b) * 0.22
  az = clampAz(p.seat, az)
  const r = Math.max(0.55, Math.min(2.4, horizontal(b) + 0.42))
  // run along the arc and in/out, no faster than RUN_SPEED
  let dAz = az - p.az
  while (dAz > Math.PI) dAz -= 2 * Math.PI
  while (dAz < -Math.PI) dAz += 2 * Math.PI
  const arc = dAz * p.r
  const dr = r - p.r
  const dist = Math.hypot(arc, dr)
  const max = RUN_SPEED * dt
  const k = dist > max ? max / dist : 1
  const ox = p.x
  const oz = p.z
  p.az = clampAz(p.seat, p.az + (arc * k) / Math.max(0.3, p.r))
  p.r += dr * k
  place(p)
  p.vx = (p.x - ox) / dt
  p.vz = (p.z - oz) / dt
}

const cpuThink = (m, p) => {
  const L = LEVELS[p.level] || LEVELS.medium
  if (m.phase === "serve") {
    if (m.server === p.seat && m.phaseT > 0.9) swing(m, p.seat, L.power[0] + m.random() * (L.power[1] - L.power[0]), 0.25 + m.random() * 0.2)
    return
  }
  if (m.phase !== "play" || p.swing || p.cooldown > 0) return
  if (inReach(m, p)) {
    if (!p.plan) p.plan = { at: m.t + L.delay * (0.6 + m.random() * 0.8), miss: m.random() < L.miss }
    if (m.t >= p.plan.at) {
      const plan = p.plan
      p.plan = null
      if (plan.miss) {
        // a swing that's too late: the ball has gone by
        p.cooldown = 0.5
        m.events.push({ type: "swing", seat: p.seat })
        m.events.push({ type: "whiff", seat: p.seat })
        return
      }
      swing(m, p.seat, L.power[0] + m.random() * (L.power[1] - L.power[0]), 0.12 + m.random() * 0.45)
    }
  } else p.plan = null
}

const record = (m) => {
  if (!m.history) return
  m.history.push({ t: m.t, ball: copyBall(m.ball), players: m.players.map((p) => ({ x: p.x, z: p.z })) })
  const cut = m.t - HISTORY
  while (m.history.length && m.history[0].t < cut) m.history.shift()
}

const stepOnce = (m, dt) => {
  m.t += dt
  m.phaseT += dt
  for (const p of m.players) {
    if (p.cooldown > 0) p.cooldown = Math.max(0, p.cooldown - dt)
    if (p.kind === "cpu") cpuThink(m, p)
  }
  if (m.phase === "serve") {
    // the server holds the ball
    for (const p of m.players) if (p.seat !== m.server) movePlayer(m, p, dt)
    return
  }
  if (m.phase === "point") {
    if (m.phaseT > 2.2) nextGame(m)
    return
  }
  if (m.phase === "over") return
  const pole = m.ball.hitPole
  const ground = m.ball.hitGround
  stepBall(m.ball, dt)
  if (m.ball.hitPole > pole) m.events.push({ type: "pole" })
  if (m.ball.hitGround > ground) m.events.push({ type: "ground" })
  for (const p of m.players) {
    movePlayer(m, p, dt)
    if (p.swing) {
      p.swing.t += dt
      if (inReach(m, p) && m.t - p.lastHit > 0.3) doHit(m, p)
      else if (p.swing.t > SWING_WIN) {
        p.swing = null
        p.cooldown = COOLDOWN
        m.events.push({ type: "whiff", seat: p.seat })
      }
    }
  }
  record(m)
  // the rope all the way round: the game
  const by = woundBy(m.ball)
  if (by) return winGame(m, by === 1 ? 0 : 1)
  // a dead ball (hanging still): served again by whoever's half it's on
  if (speed(m.ball) < 0.6 && Math.abs(angularSpeed(m.ball)) < 0.35) m.still += dt
  else m.still = 0
  if (m.still > 2.5) {
    m.server = m.ball.z >= 0 ? 0 : 1
    m.events.push({ type: "reserve", seat: m.server })
    setupServe(m, true)
  }
}

const winGame = (m, seat) => {
  m.games[seat]++
  m.gameWinner = seat
  m.events.push({ type: "game", seat, games: [...m.games] })
  if (m.games[seat] >= m.target) {
    m.phase = "over"
    m.winner = seat
    m.events.push({ type: "match", seat })
    return
  }
  m.phase = "point"
  m.phaseT = 0
}

const nextGame = (m) => {
  // the loser of the game serves the next one
  m.server = 1 - m.gameWinner
  m.gameWinner = null
  setupServe(m)
}

// advance the match by dt seconds (fixed steps inside)
export const step = (m, dt) => {
  let t = m.carry + dt
  while (t >= STEP) {
    stepOnce(m, STEP)
    t -= STEP
  }
  m.carry = t
  return m
}

// a guest's swing that started at host time `at`: if the ball came within their reach during
// the swing window (in the recent history), hit it there and fly it forward to now.
// Returns true when it hit.
export const remoteSwing = (m, seat, at, power, loft) => {
  const p = m.players[seat]
  if (m.phase === "serve") return seat === m.server ? swing(m, seat, power, loft) : false
  if (m.phase !== "play" || !m.history || !p) return false
  if (m.t - p.lastHit < 0.3) return false
  const from = Math.max(at, m.t - HISTORY)
  const frame = m.history.find((h) => h.t >= from && h.t <= at + SWING_WIN && inReach(m, { seat, x: h.players[seat].x, z: h.players[seat].z }, h.ball))
  if (!frame) {
    // nothing in reach yet: the swing stays open for what's left of its window
    const left = SWING_WIN - (m.t - at)
    if (left > 0 && !p.swing) {
      p.swing = { t: SWING_WIN - left, power, loft }
      m.events.push({ type: "swing", seat })
    }
    return false
  }
  // rewind to the contact, hit, fly forward
  const ball = copyBall(frame.ball)
  const d = Math.hypot(ball.x - frame.players[seat].x, ball.z - frame.players[seat].z)
  hitBall(ball, DIRS[seat], power * (0.65 + 0.35 * Math.max(0, 1 - d / REACH)), loft)
  let t = m.t - frame.t
  while (t >= STEP) {
    stepBall(ball, STEP)
    t -= STEP
  }
  m.ball = ball
  m.history = m.history.filter((h) => h.t <= frame.t)
  p.swing = null
  p.cooldown = COOLDOWN
  p.lastHit = frame.t
  p.hits++
  m.hitCount++
  m.rally++
  m.lastHitter = seat
  m.events.push({ type: "hit", seat, power, remote: true })
  return true
}

// for the HUD: how far round the rope is, -1..1 (+ = player 1's way)
export const progress = (m) => Math.max(-1, Math.min(1, wraps(m.ball) / MAX_WRAPS))
export { BALL_R }
