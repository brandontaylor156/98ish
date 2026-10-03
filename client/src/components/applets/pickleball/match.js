// Pickleball 98: a match, stepped at a fixed 240 Hz. Players, the ball, the referee and the
// score live here (pure JavaScript, no three.js), so a whole match can run in Node.
//
// Each step: players move (your input, the movement assist, or the AI), the ball flies
// (gravity, drag, spin), hits the net or bounces, armed players hit it when it reaches them,
// and the referee (rules.js) calls faults. engine.js draws this and reads `events`.

import { BALL_R, HALF_L, HALF_W, KITCHEN, STEP, bounceOnCourt, flightStep, len, netContact, v3 } from "./physics.js"
import {
  courtOf,
  createGame,
  createRally,
  inKitchen,
  isLive,
  rallyWon,
  receiver as receiverOf,
  refBounce,
  refDead,
  refFeet,
  refHit,
  rightSign,
  scoreCall,
  serverCourt,
  settle,
  sideOf,
  lineCall,
} from "./rules.js"
import { planShot, playShot } from "./shots.js"
import { LEVELS, NET_LINE, REACH, afterShot, aiServe, aiShot, homeFor, planTeam } from "./ai.js"

const HAND_Y = 0.92 // the server holds the ball here
const SERVE_CONTACT_Y = 0.52 // and strikes it down here, well below the waist
export const WAIST_Y = 1.02
const INTRO_S = 1.2
const DEAD_S = 1.8
const MAX_HIT_Y = 2.3
const HUMAN = { speed: 4.0, reaction: 0.05, judge: 0.15, maxY: 2.15 }

// a small seeded random (mulberry32), so matches can be replayed in tests
export const seeded = (seed) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const makePlayer = (id, team, human, level) => ({
  id,
  team,
  human,
  level: LEVELS[level] || LEVELS.intermediate,
  name: id,
  x: 0,
  z: sideOf(team) * HALF_L,
  vx: 0,
  vz: 0,
  lane: "right",
  armed: null, // ready to hit: { kind, aim, power, until, waitBounce, auto }
  swing: null, // the swing animation: { t, kind, hand, y }
  target: null, // where they're walking
  reactAt: 0,
  serveAt: 0,
  serving: null,
})

export const createMatch = (options = {}) => {
  const o = { doubles: true, scoring: "sideout", target: 11, level: "intermediate", seed: Date.now() & 0xffffffff, assist: true, firstServer: 0, ...options }
  if (o.scoring === "rally" && !options.target) o.target = 11
  const rand = seeded(o.seed)
  const players = o.doubles
    ? [makePlayer("you", 0, true), makePlayer("partner", 0, false, o.level), makePlayer("opp1", 1, false, o.level), makePlayer("opp2", 1, false, o.level)]
    : [makePlayer("you", 0, true), makePlayer("opp1", 1, false, o.level)]
  players.find((p) => p.id === "partner") && (players[1].name = "Partner")
  players[0].name = "You"
  for (const p of players) if (p.team === 1) p.name = o.doubles ? (p.id === "opp1" ? "Opponent 1" : "Opponent 2") : "Opponent"
  const ids = o.doubles ? [["you", "partner"], ["opp1", "opp2"]] : [["you"], ["opp1"]]
  const m = {
    o,
    rand,
    game: createGame({ doubles: o.doubles, scoring: o.scoring, target: o.target, firstServer: o.firstServer, players: ids }),
    rally: null,
    phase: "intro", // intro | serve | rally | dead | over
    phaseT: 0,
    t: 0,
    ball: { p: v3(0, HAND_Y, HALF_L), v: v3(), w: v3(), held: null, rolling: false, rest: false },
    players,
    events: [],
    plans: [null, null],
    version: 0,
    planned: -1,
    teamDepth: ["back", "back"],
    assist: o.assist,
    autoplay: false,
    humanLevel: HUMAN,
    paused: false,
    input: { x: 0, z: 0 },
    result: null,
    lastShot: null,
    stats: { rallies: 0, shots: 0, longest: 0, rallyShots: 0, faults: {} },
  }
  beginPoint(m)
  return m
}

export const playerById = (m, id) => m.players.find((p) => p.id === id)
const emit = (m, e) => m.events.push({ t: m.t, ...e })

// ---- points ----

const servePositions = (m) => {
  const g = m.game
  const recv = receiverOf(g)
  for (const p of m.players) {
    const side = sideOf(p.team)
    const rs = rightSign(p.team)
    const court = g.doubles ? courtOf(g, p.id) : serverCourt(g)
    p.lane = court
    const x = rs * (court === "right" ? 1 : -1) * (g.doubles ? 1.55 : 1.2)
    let z
    if (p.team === g.serving) z = side * (HALF_L + 0.35)
    else z = side * (p.id === recv ? HALF_L + 0.25 : NET_LINE)
    p.x = x
    p.z = z
    p.vx = 0
    p.vz = 0
    p.armed = null
    p.swing = null
    p.target = null
    p.serving = null
  }
}

export const beginPoint = (m) => {
  m.rally = createRally(m.game)
  m.teamDepth = ["back", "back"]
  m.teamDepth[1 - m.game.serving] = "net"
  servePositions(m)
  const server = playerById(m, m.game.server)
  m.ball.held = server.id
  m.ball.rolling = false
  m.ball.rest = false
  m.ball.v = v3()
  m.ball.w = v3()
  holdBall(m, server)
  m.phase = "intro"
  m.phaseT = 0
  m.result = null
  m.plans = [null, null]
  m.lastShot = null
  m.stats.rallyShots = 0
  server.serveAt = INTRO_S + (server.human && !m.autoplay ? 0 : server.level.serveWait)
  emit(m, { type: "call", call: scoreCall(m.game), server: server.id })
}

// The server's hand: beside them on their paddle side, a little in front
const handPos = (m, p) => v3(p.x + rightSign(p.team) * 0.32, HAND_Y, p.z - sideOf(p.team) * 0.35)
const holdBall = (m, p) => {
  const h = handPos(m, p)
  m.ball.p = h
}

// Start the serve: the ball is dropped from the hand and struck underhand on the way down
export const serve = (m, shot) => {
  if (m.phase !== "serve" && m.phase !== "intro") return false
  const p = playerById(m, m.game.server)
  if (!p || m.ball.held !== p.id) return false
  m.ball.held = null
  m.ball.v = v3(0, 0.2, 0)
  m.ball.w = v3()
  p.serving = shot
  m.phase = "rally"
  m.phaseT = 0
  emit(m, { type: "toss", player: p.id })
  return true
}

const finishPoint = (m) => {
  const res = m.rally.over
  const before = { serving: m.game.serving, server: m.game.server }
  const outcome = rallyWon(m.game, res.winner)
  m.stats.rallies++
  m.stats.longest = Math.max(m.stats.longest, m.stats.rallyShots)
  m.stats.faults[res.reason] = (m.stats.faults[res.reason] || 0) + 1
  emit(m, { type: "point", ...res, outcome, before, call: scoreCall(m.game), score: [...m.game.score] })
  if (m.game.winner !== null) {
    m.phase = "over"
    m.phaseT = 0
    emit(m, { type: "gameover", winner: m.game.winner, score: [...m.game.score] })
    return
  }
  beginPoint(m)
}

// ---- hitting ----

const hitterRight = (p) => rightSign(p.team) // world x of a player's right hand side

// Whether player p can strike the ball right now
const canHit = (m, p) => {
  const ball = m.ball
  const r = m.rally
  if (ball.held || !isLive(r) || r.hits === 0) return false
  if (r.lastTeam === p.team) return false // it hasn't come back yet
  const side = sideOf(p.team)
  if (ball.p.z * side < 0.02) return false // not on our side yet
  const dx = ball.p.x - p.x
  const dz = ball.p.z - p.z
  if (Math.hypot(dx, dz) > REACH) return false
  if (ball.p.y > MAX_HIT_Y || ball.p.y < BALL_R + 0.02) return false
  const a = p.armed
  const volley = r.bounces === 0
  const careful = !p.human || m.assist || m.autoplay // the AI and the assist mind the rules
  if (volley && (a.waitBounce || (careful && (r.hits < 3 || inKitchen(p.x, p.z))))) return false
  // let it come to the body: wait while it's still well in front and coming
  const ahead = (p.z - ball.p.z) * side
  const coming = ball.v.z * side > 1
  if (ahead > 0.4 && coming && Math.hypot(dx, dz) > 0.55) return false
  return true
}

// Context: what "swing" means for you right now (soft = a tap, hard = a hard swing)
export const contextKind = (m, p, power) => {
  const r = m.rally
  const shotNo = r.hits + 1
  const y = m.ball.p.y
  const dist = Math.abs(p.z)
  const hard = power >= 0.55
  if (shotNo === 2) return hard ? "drive" : "return"
  if (y > 1.2 && dist < 5) return hard ? "smash" : "punch"
  if (dist < 3.4) {
    if (y < 0.95) return hard ? "drive" : "dink"
    return hard ? "punch" : "block"
  }
  if (shotNo === 3) return hard ? "drive" : "drop"
  return hard ? "drive" : r.bounces === 0 ? "block" : "drop"
}

const hit = (m, p) => {
  const r = m.rally
  const ball = m.ball
  const serving = r.hits === 0
  let req
  if (serving) req = p.serving
  else if (p.human && !m.autoplay) req = { ...p.armed }
  else req = aiShot(m, p)
  let kind = req.kind
  if (!serving && (kind === "auto" || !kind)) kind = contextKind(m, p, req.power ?? 0.4)
  if (!serving && kind === "serve") kind = "drive"
  const ai = !p.human || m.autoplay
  const lv = ai ? (p.human ? LEVELS.pro : p.level) : null
  // how clean the contact is: the AI by its level; you by your timing and spacing
  let offset
  let sigma
  let face
  let touch
  if (ai) {
    // low balls, fast balls and hitting on the run are harder
    const hard = 1 + Math.max(0, 0.45 - ball.p.y) * 2.5 + Math.hypot(p.vx, p.vz) * 0.12 + len(ball.v) * 0.03
    offset = lv.offset * (0.5 + m.rand())
    sigma = lv.sigma * hard
    face = lv.face * hard
    touch = lv.touch * hard
  } else {
    const d = Math.hypot(ball.p.x - p.x, ball.p.z - p.z)
    const spacing = Math.abs(d - 0.55) / REACH // ideal: an arm's length away
    offset = (m.assist ? 0.012 : 0.008) + spacing * 0.07
    sigma = 0.26 + spacing * 0.5
    face = 0.008 + spacing * 0.02
    touch = 0.05 + spacing * 0.1
  }
  const plan = planShot(kind, {
    team: p.team,
    from: ball.p,
    aim: req.aim ?? 0,
    power: req.power ?? 0.5,
    targetX: req.targetX,
    targetZ: req.targetZ,
    court: r.court,
    sigma,
    rand: m.rand,
  })
  const res = playShot({ p: ball.p, v: ball.v, w: ball.w }, plan, { faceError: face, touch, offset, rand: m.rand })
  const volley = !serving && r.bounces === 0
  const contactY = ball.p.y
  const result = refHit(r, {
    player: p.id,
    team: p.team,
    x: p.x,
    z: p.z,
    volley,
    serve: serving ? { contactY, waistY: WAIST_Y, paddleVy: res.u.y, headBelowWrist: true } : null,
  })
  ball.v = res.ball.v
  ball.w = res.ball.w
  ball.rolling = false
  const local = (ball.p.x - p.x) * hitterRight(p)
  p.swing = { t: 0, kind, hand: local >= -0.05 ? "fh" : "bh", y: contactY, n: res.n, speed: len(res.u) }
  p.armed = null
  p.serving = null
  for (const q of m.players) if (q.team === p.team) q.armed = null
  m.stats.shots++
  m.stats.rallyShots++
  m.lastShot = { kind, by: p.id, team: p.team, speed: len(ball.v), volley, landing: res.solved.landing, t: m.t }
  afterShot(m, p.team, kind, p)
  m.version++
  emit(m, { type: "hit", player: p.id, team: p.team, kind, speed: len(ball.v), volley, x: ball.p.x, y: ball.p.y, z: ball.p.z, paddle: len(res.u) })
  if (result) decided(m, result)
}

const decided = (m, result) => {
  if (m.phase === "rally") {
    m.phase = "dead"
    m.phaseT = 0
  }
  if (!m.result || m.result.reason !== result.reason) {
    m.result = result
    emit(m, { type: "fault", ...result })
  }
}

// ---- your controls ----

// move: { x, z } in world units (-1..1 each), from the keys, joystick or d-pad
export const setMove = (m, x, z) => {
  m.input.x = x
  m.input.z = z
}

// swing: { kind: "auto" | "dink" | "drive" | "lob" | "drop", power 0..1, aim -1..1 }
export const swing = (m, req) => {
  const p = m.players.find((q) => q.human)
  if (!p || m.paused) return false
  // you can serve once the score's been called (a little before the intro ends is fine)
  if (m.ball.held === p.id && (m.phase === "serve" || (m.phase === "intro" && m.phaseT > 0.6))) {
    return serve(m, { kind: "serve", aim: req.aim ?? 0, power: req.power ?? 0.5 })
  }
  if (m.phase !== "rally") return false
  const window = m.assist ? 1.4 : 0.42
  p.armed = { kind: req.kind || "auto", aim: req.aim ?? 0, power: req.power ?? 0.5, until: m.t + window, waitBounce: false, human: true }
  return true
}

// ---- stepping ----

const movePlayer = (m, p, dt) => {
  const side = sideOf(p.team)
  let wantX = 0
  let wantZ = 0
  const lv = p.human && !m.autoplay ? m.humanLevel : p.human ? LEVELS.pro : p.level
  const manual = p.human && !m.autoplay && (Math.abs(m.input.x) > 0.05 || Math.abs(m.input.z) > 0.05)
  if (manual) {
    const l = Math.hypot(m.input.x, m.input.z)
    const s = Math.min(1, l)
    wantX = (m.input.x / l) * s * lv.speed
    wantZ = (m.input.z / l) * s * lv.speed
  } else if (p.target && m.t >= p.reactAt && (!p.human || m.assist || m.autoplay)) {
    const dx = p.target.x - p.x
    const dz = p.target.z - p.z
    const d = Math.hypot(dx, dz)
    if (d > 0.03) {
      const s = Math.min(lv.speed, Math.sqrt(2 * 9 * d)) // ease into the spot
      wantX = (dx / d) * s
      wantZ = (dz / d) * s
    }
  }
  // accelerate toward the wanted velocity (quick feet: about 12 m/s^2)
  const ax = wantX - p.vx
  const az = wantZ - p.vz
  const a = Math.hypot(ax, az)
  const maxDv = 12 * dt
  if (a > maxDv) {
    p.vx += (ax / a) * maxDv
    p.vz += (az / a) * maxDv
  } else {
    p.vx = wantX
    p.vz = wantZ
  }
  p.x += p.vx * dt
  p.z += p.vz * dt
  // the court and its surrounds; nobody touches the net
  p.x = Math.max(-HALF_W - 2.6, Math.min(HALF_W + 2.6, p.x))
  const zs = Math.max(0.3, Math.min(HALF_L + 3.4, p.z * side))
  if (zs !== p.z * side) {
    p.z = zs * side
    p.vz = 0
  }
  // waiting to serve: the server stays behind the baseline, in their half
  if (m.ball.held === p.id) {
    const rs = rightSign(p.team) * (serverCourt(m.game) === "right" ? 1 : -1)
    p.x = rs * Math.max(0.15, Math.min(HALF_W - 0.1, p.x * rs))
    p.z = side * Math.max(HALF_L + 0.2, Math.abs(p.z))
  }
}

const think = (m) => {
  // re-plan whenever the ball's path changed (a hit, a bounce, the net)
  if (m.planned !== m.version) {
    m.planned = m.version
    const r = m.rally
    m.plans = [null, null]
    if (m.phase === "rally" && isLive(r) && r.lastTeam !== null && !m.ball.held) {
      const team = 1 - r.lastTeam
      m.plans[team] = planTeam(m, team)
      for (const p of m.players) {
        if (p.team !== team) continue
        const lv = p.human && !m.autoplay ? m.humanLevel : p.human ? LEVELS.pro : p.level
        p.reactAt = m.t + lv.reaction
      }
    }
  }
  for (const p of m.players) {
    if (m.ball.held || m.phase === "intro") {
      p.target = null
      continue
    }
    const plan = m.plans[p.team]
    const mine = plan && plan.player === p.id && !plan.letGo
    if (mine) p.target = plan.stand
    else if (m.phase === "rally" || m.phase === "dead") p.target = homeFor(m, p)
    const ai = !p.human || m.autoplay
    if (ai && m.phase === "rally") {
      if (mine) p.armed = { kind: "ai", waitBounce: !plan.volley }
      else p.armed = null
    }
  }
}

const stepBall = (m, dt) => {
  const ball = m.ball
  if (ball.held) {
    holdBall(m, playerById(m, ball.held))
    return
  }
  if (ball.rest) return
  const r = m.rally
  if (ball.rolling) {
    const s = Math.hypot(ball.v.x, ball.v.z)
    const f = Math.max(0, 1 - (1.2 * dt) / Math.max(s, 1e-6)) // rolling friction
    ball.v.x *= f
    ball.v.z *= f
    ball.p.x += ball.v.x * dt
    ball.p.z += ball.v.z * dt
    if (s < 0.05) ball.rest = true
  } else {
    const prevZ = ball.p.z
    flightStep(ball, dt)
    const net = netContact(prevZ, ball)
    if (net) {
      m.version++
      emit(m, { type: net, x: ball.p.x, y: ball.p.y, speed: len(ball.v) })
    }
    if (ball.p.y <= BALL_R && ball.v.y < 0) {
      const { x, z } = ball.p
      const impactSpeed = len(ball.v)
      bounceOnCourt(ball)
      if (Math.abs(ball.v.y) < 0.25) {
        ball.v.y = 0
        ball.p.y = BALL_R
        ball.rolling = true
      }
      const live = isLive(r)
      const res = refBounce(r, x, z)
      m.version++
      emit(m, { type: "bounce", x, z, speed: impactSpeed, live, call: live && r.bounces === 1 ? lineCall(x, z) : null })
      if (res) decided(m, res)
    }
  }
  // the fence around the court stops everything
  const fx = HALF_W + 3.4
  const fz = HALF_L + 5.4
  if (Math.abs(ball.p.x) > fx || Math.abs(ball.p.z) > fz) {
    if (isLive(r) && r.lastTeam !== null) {
      // it never touched the court: out
      const res = refDead(r, r.lastTeam, "Out")
      if (res) {
        res.call = "Out!"
        decided(m, res)
      }
    }
    if (Math.abs(ball.p.x) > fx) {
      ball.p.x = Math.sign(ball.p.x) * fx
      ball.v.x *= -0.15
    }
    if (Math.abs(ball.p.z) > fz) {
      ball.p.z = Math.sign(ball.p.z) * fz
      ball.v.z *= -0.15
    }
  }
}

export const step = (m, dt = STEP) => {
  if (m.paused || m.phase === "over") return
  m.t += dt
  m.phaseT += dt
  const r = m.rally
  r.t += dt

  if (m.phase === "intro" && m.phaseT >= INTRO_S) {
    m.phase = "serve"
    m.phaseT = 0
    emit(m, { type: "ready", server: m.game.server })
  }
  if ((m.phase === "serve" || m.phase === "intro") && m.ball.held) {
    const server = playerById(m, m.ball.held)
    const ai = !server.human || m.autoplay
    if (ai && m.phase === "serve" && m.phaseT + INTRO_S >= server.serveAt) serve(m, aiServe(m, server))
  }

  think(m)
  for (const p of m.players) {
    movePlayer(m, p, dt)
    if (p.swing) {
      p.swing.t += dt
      if (p.swing.t > 0.5) p.swing = null
    }
    if (p.armed?.until && m.t > p.armed.until) {
      // too early or too late: a swing at nothing
      if (!p.swing) p.swing = { t: 0, kind: p.armed.kind, hand: "fh", y: 0.8, whiff: true }
      p.armed = null
    }
    const res = refFeet(r, p.id, p.team, p.x, p.z, Math.hypot(p.vx, p.vz), dt)
    if (res) decided(m, res)
  }

  stepBall(m, dt)

  // the serve: struck underhand as the dropped ball falls past the server's knee
  if (r.hits === 0 && m.phase === "rally" && !m.ball.held) {
    const p = playerById(m, m.game.server)
    if (p.serving && m.ball.v.y < 0 && m.ball.p.y <= SERVE_CONTACT_Y) hit(m, p)
  } else if (m.phase === "rally") {
    for (const p of m.players) {
      if (p.armed && canHit(m, p)) {
        hit(m, p)
        break
      }
    }
  }

  // a ball stuck somewhere (it shouldn't happen) can't hold up the game
  if (m.watchVersion !== m.version) {
    m.watchVersion = m.version
    m.watchAt = m.t
  } else if (m.phase === "rally" && isLive(r) && r.hits > 0 && m.t - m.watchAt > 6) {
    const res = refDead(r, r.lastTeam, "Ball out of play")
    if (res) decided(m, res)
  }

  if (m.phase === "dead") {
    const over = settle(r)
    if (over && m.result !== over) decided(m, over)
    if (over && m.phaseT >= DEAD_S) finishPoint(m)
  } else if (m.phase === "rally" && !isLive(r)) {
    m.phase = "dead"
    m.phaseT = 0
  }
}

// Run real time through fixed steps (returns how many it took)
export const advance = (m, seconds) => {
  m.acc = (m.acc || 0) + Math.min(seconds, 0.1)
  let n = 0
  while (m.acc >= STEP) {
    step(m, STEP)
    m.acc -= STEP
    n++
  }
  return n
}

// For tests and the dev hook: jump into the middle of a rally with the other team's ball
// on its way to you, chest high, before it bounces. "kitchen": you're standing in the
// kitchen at the 5th shot; "two-bounce": your team served and this is the return (3rd shot
// must bounce first).
export const scenario = (m, kind) => {
  beginPoint(m)
  const r = m.rally
  const you = playerById(m, "you")
  const opp = m.players.find((p) => p.team === 1)
  m.ball.held = null
  m.assist = false // you're on your own: nothing stops you volleying
  m.phase = "rally"
  m.phaseT = 0
  r.hits = kind === "two-bounce" ? 2 : 4
  r.lastTeam = 1
  r.lastPlayer = opp.id
  r.bounces = 0
  m.teamDepth = ["net", "net"]
  for (const p of m.players) {
    const h = homeFor(m, p)
    p.x = h.x
    p.z = h.z
  }
  you.x = 0.6
  you.z = kind === "kitchen" ? 1.5 : 2.7
  opp.x = 0.4
  opp.z = -2.6
  const from = v3(opp.x, 0.9, opp.z + 0.4)
  const to = v3(you.x + 0.45, 1.0, you.z - 0.15)
  const T = 0.6
  m.ball.p = from
  m.ball.v = v3((to.x - from.x) / T, (to.y - from.y) / T + 0.5 * 9.81 * T, (to.z - from.z) / T)
  m.ball.w = v3()
  m.version++
  return m
}

// What you'd see as the score: the call and both teams' points
export const scoreboard = (m) => ({
  call: scoreCall(m.game),
  score: [...m.game.score],
  serving: m.game.serving,
  server: m.game.server,
  serverNumber: m.game.serverNumber,
  winner: m.game.winner,
})

export { KITCHEN }
