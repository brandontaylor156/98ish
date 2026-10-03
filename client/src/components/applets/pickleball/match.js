// Pickleball 98: a match, stepped at a fixed 240 Hz. Players, the ball, the referee and the
// score live here (pure JavaScript, no three.js), so a whole match can run in Node.
//
// Each step: players move (people's sticks, the movement assist, or the AI), the ball flies
// (gravity, drag, spin), hits the net or bounces, players who are swinging hit it when it
// reaches them, and the referee (rules.js) calls faults. engine.js draws this and reads
// `events`.
//
// Players are controlled by a person on this computer ("human", with an input slot), the
// computer ("cpu"), a practice ball machine ("feeder"), or a person on another computer
// ("remote": online, their own browser moves them and plays their shots; see netplay.js).
//
// Shots are timed the way a tennis video game times them: press a shot button as the ball
// comes (hold it for more power), let go as it arrives. The swing takes SWING_LEAD seconds
// to reach the ball, so the perfect moment to let go is just before it gets to you.

import { BALL_R, HALF_L, HALF_W, KITCHEN, STEP, bounceOnCourt, flightStep, len, netContact, v3 } from "./physics.js"
import {
  FOOT_R,
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
import { planShot, playShot, shotQuality, serveMeter, SERVE_FILL, SERVE_MAX } from "./shots.js"
import { LEVELS, NET_LINE, REACH, afterShot, aiServe, aiShot, aiTiming, homeFor, levelFor, levelOf, planTeam } from "./ai.js"

const HAND_Y = 0.98 // the server holds the ball here
const SERVE_CONTACT_Y = 0.52 // and strikes it down here, well below the waist
export const WAIST_Y = 1.02
const INTRO_S = 1.3 // the score call
const INTRO_MAX = 4.5 // walking back into place takes no longer than this
const DEAD_S = 1.8
const MAX_HIT_Y = 2.3
export const SWING_LEAD = 0.13 // s from letting go of the button to the paddle meeting the ball
const MIN_SWING = 0.05 // the quickest a swing can get there
const LATE_MAX = 0.22 // still holding this long after the ball got there: swing anyway
const ARM_S = 1.0 // let go early: the swing waits this long for the ball
export const DEFAULT_WINDOW = 0.06 // the perfect timing zone, +- seconds
const HUMAN = { speed: 4.0, reaction: 0.05, judge: 0.15, maxY: 2.15 }
// shot buttons -> serve variants
const SERVE_VARIANT = { topspin: "drive", slice: "slice", soft: "soft", lob: "lob", auto: "drive" }

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

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const makePlayer = ({ id, team, ctrl = "cpu", slot = 0, seat = null, level = "intermediate", style = "allround", name, look = null, character = null, stats = null }) => ({
  id,
  team,
  seat, // online: their seat in the room
  character, // looks.js character id
  ctrl, // human | cpu | remote | feeder
  slot, // a person's input slot (keyboard/gamepad/touch) on this computer
  human: ctrl === "human" || ctrl === "remote",
  level: levelFor(level, style),
  name: name || id,
  look, // what they look like (looks.js); the match doesn't use it
  stats: stats || { speed: 1, power: 1, touch: 1 }, // small differences between characters
  x: 0,
  z: sideOf(team) * HALF_L,
  vx: 0,
  vz: 0,
  lane: "right",
  charge: null, // holding a shot button: { kind, start, risky }
  armed: null, // let go (or a computer player ready to hit): { kind, release, until, ... }
  swing: null, // the last swing: { t, kind, hand, y, n, speed, grade, ... }
  zoneT: null, // when the ball first came within reach on this trip
  target: null, // where they're walking
  spot: null, // where they start the next point
  intercept: null, // where they could meet the ball (people: for the assist and the animation)
  expect: null, // { at, x, y, z, volley }: when and where they expect to hit it
  reactAt: 0,
  serveAt: 0,
  serving: null,
})

// The usual line-ups: you (and a partner) against the computer, or two people on one
// computer (each with a computer partner in doubles)
export const defaultRoster = ({ doubles = true, humans = 1, level = "intermediate" } = {}) => {
  const r = [{ id: "you", team: 0, ctrl: "human", slot: 0, name: "You" }]
  if (doubles) r.push({ id: "partner", team: 0, ctrl: "cpu", level, name: "Partner" })
  r.push({ id: "opp1", team: 1, ctrl: humans >= 2 ? "human" : "cpu", slot: 1, level, name: humans >= 2 ? "Player 2" : doubles ? "Opponent 1" : "Opponent" })
  if (doubles) r.push({ id: "opp2", team: 1, ctrl: "cpu", level, name: "Opponent 2" })
  return r
}

export const createMatch = (options = {}) => {
  const o = { doubles: true, scoring: "sideout", target: 11, level: "intermediate", seed: Date.now() & 0xffffffff, assist: "light", firstServer: 0, window: DEFAULT_WINDOW, ...options }
  if (o.scoring === "rally" && !options.target) o.target = 11
  const rand = seeded(o.seed)
  const roster = o.roster || defaultRoster(o)
  const players = roster.map((r) => makePlayer({ level: o.level, ...r }))
  const ids = [0, 1].map((team) => players.filter((p) => p.team === team).map((p) => p.id))
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
    eventSeq: 0,
    plans: [null, null],
    version: 0,
    planned: -1,
    teamDepth: ["back", "back"],
    assist: o.assist,
    autoplay: false,
    humanLevel: HUMAN,
    window: o.window,
    paused: false,
    inputs: [0, 1, 2, 3].map(() => ({ x: 0, z: 0 })),
    result: null,
    lastShot: null,
    skip: false,
    practice: o.practice || null,
    stats: {
      rallies: 0,
      shots: 0,
      longest: 0,
      rallyShots: 0,
      faults: {},
      teams: [0, 1].map(() => ({ winners: 0, errors: 0, aces: 0, perfect: 0, shots: 0, fastest: 0, power: 0 })),
    },
  }
  beginPoint(m, { snap: true })
  return m
}

export const playerById = (m, id) => m.players.find((p) => p.id === id)
export const humanBySlot = (m, slot = 0) => m.players.find((p) => p.ctrl === "human" && p.slot === slot)
const emit = (m, e) => m.events.push({ id: ++m.eventSeq, t: m.t, ...e })
// bounces since the last hit, counting any the referee is still holding (online)
export const bouncesOf = (m) => m.rally.bounces + (m.held?.length || 0)
const isAi = (m, p) => p.ctrl === "cpu" || p.ctrl === "feeder" || (m.autoplay && p.ctrl === "human")
// the movement assist: "off", "light" (fine positioning while you swing) or "full" (runs to
// the ball for you). Booleans from older settings mean light/off.
const assistOf = (m) => (m.assist === true ? "light" : m.assist === false ? "off" : m.assist || "off")

// ---- points ----

const servePositions = (m, snap) => {
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
    p.spot = { x, z }
    if (snap) {
      p.x = x
      p.z = z
      p.vx = 0
      p.vz = 0
    }
    p.armed = null
    p.charge = null
    p.target = snap ? null : p.spot
    p.serving = null
    p.zoneT = null
    p.expect = null
    p.intercept = null
  }
}

export const beginPoint = (m, { snap = false } = {}) => {
  m.rally = createRally(m.game)
  m.teamDepth = ["back", "back"]
  m.teamDepth[1 - m.game.serving] = "net"
  servePositions(m, snap)
  m.phase = "intro"
  m.phaseT = 0
  m.result = null
  m.plans = [null, null]
  m.lastShot = null
  m.skip = false
  m.tallied = false
  m.held = []
  m.stats.rallyShots = 0
  m.version++
  if (m.practice?.begin?.(m)) return
  const server = playerById(m, m.game.server)
  m.ball.held = server.id
  m.ball.rolling = false
  m.ball.rest = false
  m.ball.v = v3()
  m.ball.w = v3()
  holdBall(m, server)
  server.serveAt = isAi(m, server) ? server.level.serveWait : 0
  emit(m, { type: "call", call: scoreCall(m.game), server: server.id })
}

// The server's hand: in front, on their paddle side, about waist high
export const handPos = (m, p) => v3(p.x + rightSign(p.team) * 0.18, HAND_Y, p.z - sideOf(p.team) * 0.42)
const holdBall = (m, p) => {
  m.ball.p = handPos(m, p)
}

// everyone in place for the serve (the end of the walk back)
const settleIntro = (m) => {
  for (const p of m.players) {
    if (p.spot) {
      p.x = p.spot.x
      p.z = p.spot.z
    }
    p.vx = 0
    p.vz = 0
    p.target = null
  }
  if (m.ball.held) holdBall(m, playerById(m, m.ball.held))
  m.phase = "serve"
  m.phaseT = 0
  emit(m, { type: "ready", server: m.game.server })
}

// Start the serve: the ball is dropped from the hand and struck underhand on the way down
export const serve = (m, shot) => {
  if (m.phase !== "serve") return false
  const p = playerById(m, m.game.server)
  if (!p || m.ball.held !== p.id) return false
  m.ball.held = null
  m.ball.v = v3(0, 0.2, 0)
  m.ball.w = v3()
  p.serving = shot
  m.phase = "rally"
  m.phaseT = 0
  emit(m, { type: "toss", player: p.id })
  m.onToss?.(p)
  return true
}

const finishPoint = (m) => {
  const res = m.rally.over
  m.stats.rallies++
  m.stats.longest = Math.max(m.stats.longest, m.stats.rallyShots)
  m.stats.faults[res.reason] = (m.stats.faults[res.reason] || 0) + 1
  if (m.practice) {
    m.practice.end?.(m, res)
    beginPoint(m)
    return
  }
  const before = { serving: m.game.serving, server: m.game.server }
  const outcome = rallyWon(m.game, res.winner)
  emit(m, { type: "point", ...res, outcome, before, call: scoreCall(m.game), score: [...m.game.score] })
  if (m.game.winner !== null) {
    m.phase = "over"
    m.phaseT = 0
    emit(m, { type: "gameover", winner: m.game.winner, score: [...m.game.score] })
    return
  }
  beginPoint(m)
}

// How the rally ended, for the stats and the commentary: a winner (they couldn't get to
// it), an ace, or an error (out, the net, a fault)
const tally = (m, result) => {
  const s = m.stats.teams
  const r = m.rally
  const unreturned = result.reason === "Double bounce" || result.reason === "Ball out of play"
  if (unreturned) {
    s[result.winner].winners++
    if (r.hits === 1) s[result.winner].aces++
  } else s[result.fault].errors++
  const last = m.lastShot
  emit(m, {
    type: "rally",
    winner: result.winner,
    reason: result.reason,
    kind: unreturned ? (r.hits === 1 ? "ace" : "winner") : "error",
    shots: m.stats.rallyShots,
    last: last && { kind: last.kind, by: last.by, team: last.team, speed: last.speed, grade: last.grade, risky: last.risky },
  })
}

// ---- hitting ----

// Whether player p can strike the ball right now (req: their swing, or a computer's plan)
export const canHit = (m, p, req = p.armed || p.charge, { reach = REACH, wait = true } = {}) => {
  const ball = m.ball
  const r = m.rally
  if (!req || ball.held || !isLive(r) || r.hits === 0) return false
  if (r.lastTeam === p.team) return false // it hasn't come back yet
  const side = sideOf(p.team)
  if (ball.p.z * side < 0.02) return false // not on our side yet
  const dx = ball.p.x - p.x
  const dz = ball.p.z - p.z
  const d = Math.hypot(dx, dz)
  if (d > reach) return false
  if (ball.p.y > MAX_HIT_Y || ball.p.y < BALL_R + 0.02) return false
  const volley = bouncesOf(m) === 0
  // the AI and the assist mind the rules (no volleying the return, no volleys in the kitchen)
  const careful = isAi(m, p) || assistOf(m) !== "off"
  if (volley && (req.waitBounce || (careful && (r.hits < 3 || inKitchen(p.x, p.z))))) return false
  // let it come to the body: wait while it's still well in front and coming
  const ahead = (p.z - ball.p.z) * side
  const coming = ball.v.z * side > 1
  if (wait && ahead > 0.4 && coming && d > 0.55) return false
  return true
}

// What a button means for the ball in front of you: topspin, slice, soft or lob, read
// for where you are and how high the ball is
export const resolveKind = (m, p, button, power = 0.5) => {
  const r = m.rally
  const shotNo = r.hits + 1
  const y = m.ball.p.y
  const dist = Math.abs(p.z)
  const volley = r.bounces === 0
  const high = y > 1.25 && dist < 5
  switch (button) {
    case "topspin":
      if (shotNo === 2) return "return"
      if (high) return "smash"
      if (volley && dist < 4) return "punch"
      return "drive"
    case "slice":
      if (high) return "punch"
      if (volley && dist < 4) return "block"
      return "slice"
    case "soft":
      return dist < 3.6 ? "dink" : "drop"
    case "lob":
      return "lob"
    default:
      return contextKind(m, p, power)
  }
}

// "Auto" (one button, or a tap on a phone): what a sensible player would hit here
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

const GRADE_DELTA = { perfect: 0, good: 1.6, early: -3, late: 3, "very early": -5.5, "very late": 5.5 }

// A person's aim from their stick, read at contact: sideways aims, toward the net goes deep
const stickAim = (m, p) => {
  const inp = m.inputs[p.slot] || { x: 0, z: 0 }
  return { aim: clamp(inp.x * rightSign(p.team), -1, 1), depth: clamp(-inp.z * sideOf(p.team), -1, 1) }
}

// Work out a swing at the ball as it is now: the shot, how well it's timed and the ball it
// sends back. Doesn't change the match (except the random draws): applyStrike does that.
// Used by this computer's players and, online, by each person's own browser (netplay.js).
export const strike = (m, p, { forced = false } = {}) => {
  const r = m.rally
  const ball = m.ball
  const serving = r.hits === 0
  const ai = isAi(m, p)
  const lv = ai ? (p.ctrl === "human" ? LEVELS.pro : p.level) : null
  let req
  if (serving) req = p.serving
  else if (ai) req = m.practice?.shot?.(m, p) || aiShot(m, p)
  else req = { ...(p.armed || p.charge) }
  let kind = req.kind
  if (!serving && !ai) {
    if (req.power == null) req.power = clamp(0.3 + ((m.t - (req.start ?? m.t)) / 0.7) * 0.7, 0.3, 1)
    kind = resolveKind(m, p, req.kind, req.power)
  }
  if (!serving && (kind === "auto" || !kind)) kind = contextKind(m, p, req.power ?? 0.4)
  if (!serving && kind === "serve") kind = "drive"
  // timing
  let delta
  if (serving) delta = (GRADE_DELTA[req.grade] ?? (ai ? aiTiming(lv, m.rand, m.window) / m.window : 0)) * m.window
  else if (ai) delta = aiTiming(lv, m.rand, m.window)
  else {
    const rel = forced || req.release === undefined ? m.t : req.release
    delta = rel - ((p.zoneT ?? m.t) - SWING_LEAD)
  }
  if (serving && req.grade === undefined && !ai) delta = 0
  const risky = !!req.risky
  const q = shotQuality(delta, { window: m.window, risky, kind })
  if (serving && req.grade === "early") q.grade = "soft"
  // how clean the contact is: the AI by its level; people by their spacing; both by timing
  let offset
  let sigma
  let face
  let touch
  if (ai) {
    // low balls, fast balls and hitting on the run are harder
    const hard = 1 + Math.max(0, 0.45 - ball.p.y) * 2.5 + Math.hypot(p.vx, p.vz) * 0.12 + len(ball.v) * 0.03
    // (a level's errors already include its timing: the grade only nudges them)
    const nudge = (k) => 1 + (k - 1) * 0.5
    offset = lv.offset * (0.5 + m.rand())
    sigma = lv.sigma * hard * nudge(q.sigma)
    face = lv.face * hard * nudge(q.face)
    touch = lv.touch * hard * nudge(q.touch)
    if (q.apexAdd) q.apexAdd *= 0.5
  } else {
    const d = Math.hypot(ball.p.x - p.x, ball.p.z - p.z)
    const spacing = Math.abs(d - 0.55) / REACH // ideal: an arm's length away
    const skill = p.stats.touch || 1
    offset = 0.008 + spacing * 0.07
    sigma = ((0.26 + spacing * 0.5) * q.sigma) / skill
    face = ((0.008 + spacing * 0.02) * q.face) / skill
    touch = ((0.05 + spacing * 0.1) * q.touch) / skill
  }
  let aim = req.aim
  let depth = req.depth
  if (!ai && !serving && (aim === undefined || depth === undefined)) {
    const s = stickAim(m, p)
    aim ??= s.aim
    depth ??= s.depth
  }
  if (serving && !ai && aim === undefined) ({ aim, depth } = stickAim(m, p))
  const power = clamp((req.power ?? 0.5) * (ai ? 1 : p.stats.power || 1), 0, 1)
  const plan = planShot(kind, {
    team: p.team,
    from: ball.p,
    aim: clamp((aim ?? 0) + q.aimShift, -1.2, 1.2),
    depth: depth ?? 0,
    power,
    targetX: req.targetX,
    targetZ: req.targetZ,
    court: r.court,
    variant: req.variant,
    risky,
    sigma,
    rand: m.rand,
  })
  if (plan.mode.apex !== undefined && q.apexAdd) plan.mode = { apex: plan.mode.apex + q.apexAdd }
  if (plan.mode.speed !== undefined && q.speedMul !== 1) plan.mode = { speed: plan.mode.speed * q.speedMul }
  const res = playShot({ p: ball.p, v: ball.v, w: ball.w }, plan, { faceError: face, touch, offset, rand: m.rand })
  const local = (ball.p.x - p.x) * rightSign(p.team)
  return {
    player: p.id,
    t: m.t,
    kind,
    grade: q.grade,
    risky,
    serve: serving,
    volley: !serving && bouncesOf(m) === 0,
    contact: { x: ball.p.x, y: ball.p.y, z: ball.p.z },
    feet: { x: p.x, z: p.z },
    hand: serving ? "fh" : local >= -0.05 ? "fh" : "bh",
    ball: { p: { ...ball.p }, v: res.ball.v, w: res.ball.w },
    n: res.n,
    paddle: len(res.u),
    paddleVy: res.u.y,
    landing: res.solved.landing,
  }
}

// Make a swing count: the referee, the ball, the swing animation, stats and events
export const applyStrike = (m, p, s) => {
  const r = m.rally
  const ball = m.ball
  let result = null
  if (m.mirror) {
    // an online copy: the host's referee rules on it; keep the rally moving here meanwhile
    r.hits++
    r.lastTeam = p.team
    r.lastPlayer = p.id
    r.bounces = 0
  } else {
    result = refHit(r, {
      player: p.id,
      team: p.team,
      x: s.feet.x,
      z: s.feet.z,
      volley: s.volley,
      serve: s.serve ? { contactY: s.contact.y, waistY: WAIST_Y, paddleVy: s.paddleVy, headBelowWrist: true } : null,
    })
  }
  ball.held = null
  ball.p = { ...s.ball.p }
  ball.v = { ...s.ball.v }
  ball.w = { ...s.ball.w }
  ball.rolling = false
  ball.rest = false
  const speed = len(ball.v)
  p.swing = { t: Math.max(0, m.t - s.t), kind: s.kind, hand: s.hand, y: s.contact.y, x: s.contact.x, z: s.contact.z, n: s.n, speed: s.paddle, grade: s.grade, risky: s.risky, id: (p.swingSeq = (p.swingSeq || 0) + 1) }
  p.armed = null
  p.charge = null
  p.serving = null
  p.zoneT = null
  for (const q of m.players) if (q.team === p.team) q.armed = null
  m.landing = null // where this shot lands (practice judges it)
  m.stats.shots++
  m.stats.rallyShots++
  const ts = m.stats.teams[p.team]
  ts.shots++
  if (s.grade === "perfect") ts.perfect++
  if (s.risky) ts.power++
  ts.fastest = Math.max(ts.fastest, speed)
  m.lastShot = { kind: s.kind, by: p.id, team: p.team, speed, volley: s.volley, landing: s.landing, t: m.t, grade: s.grade, risky: s.risky }
  if (!m.mirror) afterShot(m, p.team, s.kind, p)
  m.version++
  emit(m, { type: "hit", player: p.id, team: p.team, kind: s.kind, speed, volley: s.volley, x: ball.p.x, y: ball.p.y, z: ball.p.z, paddle: s.paddle, grade: s.grade, risky: s.risky, hand: s.hand, human: p.ctrl !== "cpu" && p.ctrl !== "feeder" })
  if (result) decided(m, result)
}

const hit = (m, p, opts) => {
  // bounces still held for a player online happened before this hit
  if (!m.mirror && m.held?.length) flushHeld(m)
  if (!isLive(m.rally)) return
  const s = strike(m, p, opts)
  m.onStrike?.(p, s) // online: tell the host
  applyStrike(m, p, s)
}

// Online, on the host: a person on another computer hit the ball (s: their strike, at host
// time s.t). Bounces before the hit happened; any after it didn't. Returns whether it counted.
export const applyRemoteStrike = (m, p, s) => {
  const r = m.rally
  if (r.hits === 0) {
    if (p.id !== m.game.server || m.ball.held !== p.id) return false
    if (m.phase === "intro") settleIntro(m)
    if (m.phase !== "serve") return false
    m.phase = "rally"
    m.phaseT = 0
    m.events.push({ id: ++m.eventSeq, t: m.t, type: "toss", player: p.id })
  }
  if (m.phase !== "rally" || !isLive(r)) return false
  if (r.hits > 0 && r.lastTeam === p.team) return false
  const at = clamp(s.t, m.t - 0.5, m.t)
  // Bounces on the hitter's side: their browser saw whether the ball bounced before the
  // hit (s.volley), which beats comparing two computers' clocks. Others go by the clock.
  const side = sideOf(p.team)
  const mine = (b) => Math.sign(b.z) === side
  const held = m.held || []
  const firstMine = held.find(mine)
  m.held = held.filter((b) => !mine(b))
  flushHeld(m, at)
  if (!s.volley && firstMine && r.bounces === 0) refereeBounce(m, firstMine)
  m.held = []
  if (!isLive(r)) return false
  applyStrike(m, p, { ...s, t: at })
  fastForwardBall(m, m.t - at)
  return true
}

// fly the ball ahead (the referee watching), e.g. to catch up with a hit from the past
export const fastForwardBall = (m, seconds) => {
  let n = Math.round(clamp(seconds, 0, 0.6) / STEP)
  while (n-- > 0) stepBall(m, STEP)
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

// ---- people's controls ----

// move: x across the court (+ is the screen's right with the camera behind team 0), z along
// it (+ toward team 0's baseline), each -1..1, from the keys, a stick or the touch pad
export const setMove = (m, x, z, slot = 0) => {
  const inp = m.inputs[slot] || (m.inputs[slot] = { x: 0, z: 0 })
  inp.x = x
  inp.z = z
}

// A shot button goes down: start the swing (hold for power). Between points it hurries
// things along. kind: topspin | slice | soft | lob | auto. risky: a power shot.
export const press = (m, slot, kind = "auto", { risky = false } = {}) => {
  const p = humanBySlot(m, slot)
  if (!p || m.paused) return false
  if (m.phase === "dead" || m.phase === "intro") {
    m.skip = true
    return true
  }
  if (m.ball.held === p.id && m.phase === "serve") {
    p.charge = { kind: "serve", variant: SERVE_VARIANT[kind] || "drive", start: m.t, risky }
    return true
  }
  if (m.phase !== "rally") return false
  if (p.swing && p.swing.t < 0.25) return false // still finishing the last one
  p.charge = { kind, start: m.t, risky }
  p.armed = null
  return true
}

// The button comes up: swing. aim/depth (optional) override the stick (a phone swipe).
export const release = (m, slot, opts = {}) => {
  const p = humanBySlot(m, slot)
  if (!p) return false
  const c = p.charge
  if (!c) return false
  p.charge = null
  if (c.kind === "serve") {
    if (m.ball.held !== p.id || m.phase !== "serve") return false
    const meter = serveMeter(m.t - c.start)
    return serve(m, { kind: "serve", variant: c.variant, power: meter.power, grade: meter.grade, risky: c.risky || meter.fill > 1, aim: opts.aim, depth: opts.depth })
  }
  if (m.phase !== "rally") return false
  const held = m.t - c.start
  const power = opts.power ?? clamp(0.3 + (held / 0.7) * 0.7, 0.3, 1)
  p.armed = { kind: c.kind, power, risky: opts.risky ?? c.risky, release: m.t, until: m.t + ARM_S, aim: opts.aim, depth: opts.depth }
  return true
}

// A whole swing at once (a tap): { kind, power 0..1, aim -1..1, depth, risky }
export const swing = (m, req, slot = 0) => {
  const p = humanBySlot(m, slot)
  if (!p || m.paused) return false
  if (m.ball.held === p.id && m.phase === "intro") settleIntro(m)
  if (m.ball.held === p.id && m.phase === "serve") {
    return serve(m, { kind: "serve", variant: SERVE_VARIANT[req.kind] || "drive", aim: req.aim ?? 0, depth: req.depth ?? 0, power: req.power ?? 0.5, grade: req.grade ?? "good" })
  }
  if (!press(m, slot, req.kind || "auto", { risky: req.risky })) return false
  if (m.phase !== "rally") return true
  return release(m, slot, { aim: req.aim ?? 0, depth: req.depth ?? 0, power: req.power ?? 0.5, risky: req.risky })
}

// What the timing meter shows for a person: how soon the ball gets to them (from their
// predicted intercept), whether they're holding or have let go, and the serve meter
export const meterFor = (m, p) => {
  if (!p) return null
  if (p.charge?.kind === "serve") {
    const s = serveMeter(m.t - p.charge.start)
    return { mode: "serve", fill: s.fill, grade: s.grade }
  }
  if (m.phase !== "rally") return null
  const e = p.expect
  const r = m.rally
  if (!e || r.lastTeam === p.team || !isLive(r)) return null
  const ttc = e.at - m.t
  return { mode: "rally", ttc, lead: SWING_LEAD, window: m.window, charging: !!p.charge, power: p.charge ? clamp(0.3 + ((m.t - p.charge.start) / 0.7) * 0.7, 0.3, 1) : null, released: p.armed?.release ?? null, t: m.t }
}

// A stand-in for a person (tests and the dev hook): runs to the ball, presses a shot button
// as it comes and lets go on the beat, with a little human scatter in the timing. Uses only
// what a person has: the stick and the buttons.
export const autopilot = (m, slot = 0, { jitter = 0.03, rand = Math.random, button = null, risky = false, power = 0 } = {}) => {
  const p = humanBySlot(m, slot)
  if (!p || m.paused) return
  if (m.phase === "serve" && m.ball.held === p.id) {
    if (!p.charge) press(m, slot, rand() < 0.8 ? "topspin" : "soft")
    else if (m.t - p.charge.start >= SERVE_FILL * (0.82 + rand() * 0.12)) release(m, slot)
    return
  }
  const st = p.intercept?.stand
  if (m.phase === "rally" && st && !p.intercept.letGo) {
    const dx = st.x - p.x
    const dz = st.z - p.z
    const d = Math.hypot(dx, dz)
    setMove(m, d > 0.08 ? dx / Math.max(d, 0.4) : 0, d > 0.08 ? dz / Math.max(d, 0.4) : 0, slot)
  } else setMove(m, 0, 0, slot)
  const e = p.expect
  if (m.phase !== "rally" || !e) return
  // doubles: leave balls well into the partner's half to them
  if (m.game.doubles) {
    const lane = p.lane === "right" ? 1 : -1
    if (e.x * rightSign(p.team) * lane < -0.4) return
  }
  const ttc = e.at - m.t
  if (!p.charge && !p.armed && ttc < 0.5 && ttc > 0.05) {
    const near = Math.abs(p.z) < 3.6
    const kind = e.y > 1.3 && near ? "topspin" : near ? (rand() < 0.75 ? "soft" : "topspin") : m.rally.hits === 2 && rand() < 0.6 ? "soft" : rand() < 0.2 ? "slice" : "topspin"
    if (press(m, slot, button || kind, { risky: risky || rand() < power }) && p.charge) p.charge.aimAt = SWING_LEAD + (rand() * 2 - 1) * jitter
  } else if (p.charge && ttc <= (p.charge.aimAt ?? SWING_LEAD)) release(m, slot, { aim: (rand() - 0.5) * 1.2, depth: rand() * 0.6 - 0.2 })
}

// ---- stepping ----

const movePlayer = (m, p, dt) => {
  const side = sideOf(p.team)
  if (p.ctrl === "remote") {
    // a person on another computer: their browser sends where they are; keep them gliding
    // a moment between updates, but never guess them into the kitchen (that's a fault)
    if (m.t - (p.netAt ?? -1) < 0.12) {
      p.x += p.vx * dt
      p.z += p.vz * dt
    }
    if (p.netZ !== undefined && !inKitchen(p.x, p.netZ) && inKitchen(p.x, p.z)) p.z = Math.sign(p.netZ) * (KITCHEN + FOOT_R + 0.006)
    return
  }
  let wantX = 0
  let wantZ = 0
  const lv = levelOf(m, p)
  const between = m.phase === "intro" || m.phase === "dead"
  const ai = isAi(m, p)
  const assist = assistOf(m)
  const inp = m.inputs[p.slot] || { x: 0, z: 0 }
  const manual = !ai && !between && (Math.abs(inp.x) > 0.05 || Math.abs(inp.z) > 0.05)
  const speed = lv.speed * (ai ? 1 : p.stats.speed || 1) * (p.charge && !between ? 0.62 : 1)
  if (manual) {
    const l = Math.hypot(inp.x, inp.z)
    const s = Math.min(1, l)
    wantX = (inp.x / l) * s * speed
    wantZ = (inp.z / l) * s * speed
  }
  let target = null
  if (between || ai) target = p.target
  else if (!manual && assist === "full" && p.intercept && !p.intercept.letGo && m.phase === "rally") target = p.intercept.stand
  if (target && (m.t >= p.reactAt || between)) {
    const dx = target.x - p.x
    const dz = target.z - p.z
    const d = Math.hypot(dx, dz)
    if (d > 0.03) {
      const s = Math.min(between ? lv.speed * 0.7 : speed, Math.sqrt(2 * 9 * d)) // ease into the spot
      wantX = (dx / d) * s
      wantZ = (dz / d) * s
    }
  }
  // the light assist: while you swing, small steps put you the right distance from the ball
  if (!ai && !between && assist !== "off" && (p.charge || p.armed) && p.intercept?.stand && !p.intercept.letGo) {
    const dx = p.intercept.stand.x - p.x
    const dz = p.intercept.stand.z - p.z
    const d = Math.hypot(dx, dz)
    if (d > 0.04 && d < 1.7) {
      const pull = Math.min(2.4, d * 5)
      wantX += (dx / d) * pull
      wantZ += (dz / d) * pull
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
  clampPlayer(m, p)
}

// The court and its surrounds; nobody touches the net. The server waits behind the
// baseline, in their half.
export const clampPlayer = (m, p) => {
  const side = sideOf(p.team)
  p.x = Math.max(-HALF_W - 2.6, Math.min(HALF_W + 2.6, p.x))
  const zs = Math.max(0.3, Math.min(HALF_L + 3.4, p.z * side))
  if (zs !== p.z * side) {
    p.z = zs * side
    p.vz = 0
  }
  if (m.ball.held === p.id && m.phase === "serve") {
    const rs = rightSign(p.team) * ((m.rally?.court || serverCourt(m.game)) === "right" ? 1 : -1)
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
    for (const p of m.players) {
      p.intercept = null
      p.expect = null
      p.zoneT = null
    }
    if (m.phase === "rally" && isLive(r) && r.lastTeam !== null && !m.ball.held) {
      const team = 1 - r.lastTeam
      const plan = planTeam(m, team)
      m.plans[team] = plan
      for (const p of m.players) {
        if (p.team !== team) continue
        p.reactAt = m.t + levelOf(m, p).reaction
        // the return of serve is the receiver's alone
        const mine = r.hits === 1 && m.game.doubles && p.id !== r.receiver ? null : plan.each?.[p.id]
        if (p.ctrl === "human" || p.ctrl === "remote") p.intercept = mine || null
        const exp = isAi(m, p) ? (plan.player === p.id && !plan.letGo ? plan : null) : mine && !mine.letGo ? mine : null
        if (exp && exp.t !== undefined) p.expect = { at: m.t + exp.t, x: exp.x, y: exp.y, z: exp.z, volley: !!exp.volley }
      }
    }
  }
  for (const p of m.players) {
    if (m.phase === "intro") {
      p.target = p.spot
      continue
    }
    if (m.ball.held) {
      p.target = null
      continue
    }
    const plan = m.plans[p.team]
    const mine = plan && plan.player === p.id && !plan.letGo
    if (mine && isAi(m, p)) p.target = plan.stand
    else if (m.phase === "rally" || m.phase === "dead") p.target = homeFor(m, p)
    if (isAi(m, p) && m.phase === "rally") {
      // a computer partner leaves the ball to a person who is already swinging at it
      const deferring = m.players.some((q) => q.team === p.team && q !== p && (q.ctrl === "human" || q.ctrl === "remote") && (q.charge || q.armed) && Math.hypot(m.ball.p.x - q.x, m.ball.p.z - q.z) < 2.5)
      const machine = p.ctrl === "feeder" && !m.practice?.returns // a ball machine only feeds
      if (mine && !deferring && !machine) p.armed = { kind: "ai", waitBounce: !plan.volley }
      else p.armed = null
    }
  }
}

// Bounces near a person on another computer wait a moment before the referee hears about
// them: their shot may be on its way over the network (netplay.js). The ball itself flies on.
const graceFor = (m) => m.grace?.(m) || false

const refereeBounce = (m, b) => {
  const r = m.rally
  const live = isLive(r)
  const res = refBounce(r, b.x, b.z)
  if (live && r.bounces === 1) {
    const call = lineCall(b.x, b.z)
    if (call) emit(m, { type: "line", x: b.x, z: b.z, call })
  }
  if (res) decided(m, res)
}

const stepBall = (m, dt) => {
  const ball = m.ball
  if (ball.held) {
    holdBall(m, playerById(m, ball.held))
    return
  }
  if (ball.rest) return
  const r = m.rally
  // an online copy, someone else's serve: the dropped ball waits at the contact height for
  // the host's word on the serve (it doesn't fall to the court)
  if (m.mirror && r.hits === 0 && !ball.rolling && ball.v.y < 0 && ball.p.y <= SERVE_CONTACT_Y && playerById(m, m.game.server)?.ctrl !== "human") {
    ball.v = v3()
    return
  }
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
      m.version++
      emit(m, { type: "bounce", x, z, speed: impactSpeed, live: isLive(r) })
      if (!m.landing) m.landing = { x, z, by: r.lastPlayer }
      const b = { x, z, t: m.t }
      if (m.mirror) r.bounces++
      else if (m.held?.length || (isLive(r) && graceFor(m))) (m.held ||= []).push(b)
      else refereeBounce(m, b)
    }
  }
  // the fence around the court stops everything
  const fx = HALF_W + 3.4
  const fz = HALF_L + 5.4
  if (Math.abs(ball.p.x) > fx || Math.abs(ball.p.z) > fz) {
    if (!m.mirror && isLive(r) && r.lastTeam !== null && !m.held?.length && !graceFor(m)) {
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

// Held bounces: tell the referee about those older than `before` (or all of them)
export const flushHeld = (m, before = Infinity) => {
  if (!m.held?.length) return
  while (m.held.length && m.held[0].t <= before) refereeBounce(m, m.held.shift())
}

// An online copy of the match (a guest's browser): the host runs the referee, the score and
// everyone else; here we move our own player, fly the ball between updates, and play our
// own shots (m.onStrike sends them to the host).
const mirrorStep = (m, dt) => {
  m.t += dt
  m.phaseT += dt
  think(m)
  for (const p of m.players) {
    movePlayer(m, p, dt)
    if (p.swing) p.swing.t += dt
    if (p.ctrl !== "human") continue
    if (p.armed?.until && m.t > p.armed.until) {
      if (!p.swing || p.swing.t > 0.4) p.swing = { t: 0, kind: p.armed.kind, hand: "fh", y: 0.8, whiff: true }
      p.armed = null
    }
    if (p.charge?.kind === "serve" && m.t - p.charge.start > SERVE_FILL * SERVE_MAX) release(m, p.slot)
  }
  stepBall(m, dt)
  const r = m.rally
  if (r.hits === 0 && m.phase === "rally" && !m.ball.held) {
    const p = m.players.find((q) => q.ctrl === "human" && q.serving)
    if (p && m.ball.v.y < 0 && m.ball.p.y <= SERVE_CONTACT_Y) hit(m, p)
  } else if (m.phase === "rally") {
    for (const p of m.players) {
      if (p.ctrl !== "human") continue
      const req = p.armed || p.charge
      if (!req) continue
      const ok = canHit(m, p, req)
      if (ok && p.zoneT === null) p.zoneT = m.t
      if (p.armed && ok && (p.armed.release === undefined || m.t >= p.armed.release + MIN_SWING)) hit(m, p)
      else if (p.charge && p.zoneT !== null && (m.t - p.zoneT >= LATE_MAX || !ok)) {
        if (ok || canHit(m, p, p.charge, { reach: REACH * 1.35, wait: false })) hit(m, p, { forced: true })
        else p.zoneT = null
      }
    }
  }
}

export const step = (m, dt = STEP) => {
  if (m.paused || m.phase === "over") return
  if (m.mirror) return mirrorStep(m, dt)
  m.t += dt
  m.phaseT += dt
  const r = m.rally
  r.t += dt

  if (m.phase === "intro") {
    const placed = m.players.every((p) => !p.spot || Math.hypot(p.x - p.spot.x, p.z - p.spot.z) < 0.25)
    if ((m.phaseT >= INTRO_S && placed) || m.phaseT >= INTRO_MAX || (m.skip && m.phaseT > 0.3)) settleIntro(m)
  }
  if (m.phase === "serve" && m.ball.held) {
    const server = playerById(m, m.ball.held)
    if (isAi(m, server) && m.phaseT >= server.serveAt) {
      const s = aiServe(m, server)
      s.grade = ["perfect", "good", "good", "late", "early"][Math.min(4, Math.floor(Math.abs(aiTiming(server.level, m.rand, 1)) / 1.2))]
      serve(m, s)
    }
  }
  m.practice?.tick?.(m, dt)

  think(m)
  for (const p of m.players) {
    movePlayer(m, p, dt)
    if (p.swing) p.swing.t += dt
    if (p.armed?.until && m.t > p.armed.until) {
      // too early: a swing at nothing
      if (!p.swing || p.swing.t > 0.4) p.swing = { t: 0, kind: p.armed.kind, hand: "fh", y: 0.8, whiff: true }
      emit(m, { type: "whiff", player: p.id })
      p.armed = null
    }
    // holding the serve too long: it goes by itself (over-hit)
    if (p.charge?.kind === "serve" && m.t - p.charge.start > SERVE_FILL * SERVE_MAX) release(m, p.slot)
    const res = refFeet(r, p.id, p.team, p.x, p.z, Math.hypot(p.vx, p.vz), dt)
    if (res) decided(m, res)
  }

  stepBall(m, dt)
  if (m.held?.length && (!graceFor(m) || m.t - m.held[0].t > 0.35)) flushHeld(m)

  // the serve: struck underhand as the dropped ball falls past the server's knee
  if (r.hits === 0 && m.phase === "rally" && !m.ball.held) {
    const p = playerById(m, m.game.server)
    if (p.serving && p.ctrl !== "remote" && m.ball.v.y < 0 && m.ball.p.y <= SERVE_CONTACT_Y) hit(m, p)
  } else if (m.phase === "rally") {
    for (const p of m.players) {
      if (p.ctrl === "remote") continue
      const req = p.armed || p.charge
      if (!req) continue
      const ok = canHit(m, p, req)
      if (ok && p.zoneT === null) p.zoneT = m.t
      if (p.armed && ok && (p.armed.release === undefined || m.t >= p.armed.release + MIN_SWING)) {
        hit(m, p)
        break
      }
      if (p.charge && p.zoneT !== null && (m.t - p.zoneT >= LATE_MAX || !ok)) {
        // still holding as the ball goes by: swing now, late
        if (ok || canHit(m, p, p.charge, { reach: REACH * 1.35, wait: false })) {
          hit(m, p, { forced: true })
          break
        }
        p.zoneT = null
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
    if (over && !m.tallied) {
      m.tallied = true
      tally(m, over)
    }
    if (over && (m.phaseT >= (m.practice ? 0.9 : DEAD_S) || (m.skip && m.phaseT > 0.5)) && !m.hold) {
      m.tallied = false
      finishPoint(m)
    }
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
// must bounce first); "drive": a ball at the baseline that bounces first (timing tests).
export const scenario = (m, kind) => {
  beginPoint(m, { snap: true })
  m.events.length = 0
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
    p.target = null
  }
  opp.x = 0.4
  opp.z = -2.6
  if (kind === "drive") {
    you.x = 0.6
    you.z = HALF_L - 0.2
    const shot = planShot("drive", { team: 1, from: v3(0.3, 0.9, -HALF_L + 0.5), targetX: you.x + 0.5, targetZ: HALF_L - 2.6, power: 0.3 })
    const from = v3(0.3, 0.9, -HALF_L + 0.5)
    m.ball.p = from
    const res = playShot({ p: from, v: v3(0, 0, 0), w: v3() }, shot)
    m.ball.v = res.ball.v
    m.ball.w = res.ball.w
  } else {
    you.x = 0.6
    you.z = kind === "kitchen" ? 1.5 : 2.7
    const from = v3(opp.x, 0.9, opp.z + 0.4)
    const to = v3(you.x + 0.45, 1.0, you.z - 0.15)
    const T = 0.6
    m.ball.p = from
    m.ball.v = v3((to.x - from.x) / T, (to.y - from.y) / T + 0.5 * 9.81 * T, (to.z - from.z) / T)
    m.ball.w = v3()
  }
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

export { KITCHEN, HAND_Y, SERVE_CONTACT_Y }
