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
// People play every shot with ONE hit control: where it goes is a target on the other court
// (the pointer, a stick or a finger: m.inputs[slot].aim, or a sensible default), how hard is
// how long the control is held (a quick touch is a dink, drop or reset; a long hold a drive,
// speed-up or counter), and the swing comes when it's let go. The swing takes SWING_LEAD
// seconds to reach the ball (less for a compact block at the net), so the moment to let go
// is just before the ball gets there. What kind of shot it was follows from all that and
// from where it was hit (shots.js planIntent), and so does whether it can be attacked.

import { BALL_R, HALF_L, HALF_W, KITCHEN, NET_H_CENTER, STEP, bounceOnCourt, flightStep, len, netContact, v3 } from "./physics.js"
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
import { FAST_BALL, PACE_RAMP, assessBall, gauss, judgeShot, paceBand, paceOf, planIntent, planShot, playShot, shotQuality, serveMeter, SERVE_FILL, SERVE_MAX } from "./shots.js"
import { LEVELS, NET_LINE, REACH, afterShot, aiServe, aiShot, aiTiming, autoTarget, homeFor, levelFor, levelOf, planTeam } from "./ai.js"

const HAND_Y = 0.98 // the server holds the ball here
const SERVE_CONTACT_Y = 0.52 // and strikes it down here, well below the waist
export const WAIST_Y = 1.02
const INTRO_S = 1.3 // the score call
const INTRO_MAX = 5.5 // walking back into place takes no longer than this
const WALK_BACK = 1.7 // m/s: between points players walk back into place (a brisk walk, not a jog)
const DEAD_S = 1.8
const MAX_HIT_Y = 2.3
export const SWING_LEAD = 0.13 // s from letting go of the button to the paddle meeting the ball
export const SWING_LEAD_FAST = 0.07 // a compact block or counter at the net gets there quicker
const MIN_SWING = 0.05 // the quickest a swing can get there
const LATE_MAX = 0.22 // still holding this long after the ball got there: swing anyway
const ARM_S = 1.0 // let go early: the swing waits this long for the ball
export const DEFAULT_WINDOW = 0.06 // the perfect timing zone, +- seconds
const HUMAN = { speed: 4.0, reaction: 0.05, judge: 0.15, maxY: 2.15 }
const NET_ZONE = 4.6 // m from the net: inside this, a fast ball at you is a hand battle

// a hard ball coming at a player near the net (a speed-up or a drive): a hand battle
export const handBattle = (m, p) => len(m.ball.v) > FAST_BALL && Math.abs(p.z) < NET_ZONE
export const leadFor = (m, p) => (handBattle(m, p) ? SWING_LEAD_FAST : SWING_LEAD)

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

const makePlayer = ({ id, team, ctrl = "cpu", slot = 0, seat = null, level = "intermediate", style = "allround", name, look = null, character = null, stats = null, hand = null }) => ({
  id,
  team,
  seat, // online: their seat in the room
  character, // looks.js character id
  ctrl, // human | cpu | remote | feeder
  slot, // a person's input slot (keyboard/gamepad/touch) on this computer
  human: ctrl === "human" || ctrl === "remote",
  level: levelFor(level, style),
  name: name || id,
  look, // what they look like (looks.js, locker.js)
  // which hand holds the paddle (+1 right, -1 left: the look's "plays"), and a two-handed
  // backhand (the look's pro style). Forehand and backhand sides, where the server holds the
  // ball and where the computer aims at them follow the hand.
  hand: hand === -1 || hand === 1 ? hand : look?.plays === "left" ? -1 : 1,
  twoHand: look?.backhand === "two",
  stats: stats || { speed: 1, power: 1, touch: 1 }, // small differences between characters
  x: 0,
  z: sideOf(team) * HALF_L,
  vx: 0,
  vz: 0,
  lane: "right",
  charge: null, // holding the hit control: { kind: "hit" | "serve", start }
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
    // per input slot: the move stick (x, z), where they're aiming (a point on the other
    // court, or null for the default) and a nudge of the default ({ u, v }: across, deeper)
    inputs: [0, 1, 2, 3].map(() => ({ x: 0, z: 0, aim: null, nudge: null })),
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
      teams: [0, 1].map(() => ({ winners: 0, errors: 0, aces: 0, perfect: 0, shots: 0, fastest: 0, power: 0, dinks: 0, goodDinks: 0, popups: 0, speedups: 0, resets: 0, counters: 0 })),
      // how the points played out (what makes it pickleball): counted by the shot labels
      feel: { dinks: 0, goodDinks: 0, popups: 0, speedups: 0, highSpeedups: 0, counters: 0, resets: 0, drops: 0, thirdDrops: 0, thirdDrives: 0, lobs: 0, smashes: 0, handBattles: 0, nets: 0, outs: 0, ernes: 0, atps: 0 },
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
export const handPos = (m, p) => v3(p.x + rightSign(p.team) * (p.hand || 1) * 0.18, HAND_Y, p.z - sideOf(p.team) * 0.42)
const holdBall = (m, p) => {
  m.ball.p = handPos(m, p)
}

// After the last point everyone walks up to the net (presentation only: anim.js taps paddles
// with the other side there). The match's own rule: accelerating toward a walk.
const walkToNet = (m, dt) => {
  m.t += dt
  m.phaseT += dt
  for (const p of m.players) {
    if (p.swing) p.swing.t += dt
    let wx = 0
    let wz = 0
    if (p.target) {
      const dx = p.target.x - p.x
      const dz = p.target.z - p.z
      const d = Math.hypot(dx, dz)
      if (d > 0.03) {
        const s = Math.min(WALK_BACK, Math.sqrt(2 * 9 * d))
        wx = (dx / d) * s
        wz = (dz / d) * s
      }
    }
    p.want = { x: wx, z: wz }
    const ex = wx - p.vx
    const ez = wz - p.vz
    const e = Math.hypot(ex, ez)
    const k = e > 12 * dt ? (12 * dt) / e : 1
    p.vx += ex * k
    p.vz += ez * k
    p.x += p.vx * dt
    p.z += p.vz * dt
  }
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
    // (everyone walks up to the net to tap paddles with the other side: presentation only,
    // the score is final; walkToNet)
    for (const p of m.players) {
      p.target = { x: Math.max(-1.7, Math.min(1.7, p.x)), z: sideOf(p.team) * 0.75 }
      p.charge = null
      p.armed = null
    }
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
  // (a player reaching over the kitchen for a volley takes it at arm's length)
  if (wait && !req.lunge && ahead > 0.4 && coming && d > 0.55) return false
  return true
}

// Where a person is aiming: the pointer/stick/finger target if there is one, else what a
// sensible player would do at this pace, nudged by the stick (keyboard) or a touch drag
export const aimFor = (m, p, pace) => {
  const inp = m.inputs[p.slot] || {}
  const opp = -sideOf(p.team)
  if (inp.aim && Math.sign(inp.aim.z) === opp) return { x: clamp(inp.aim.x, -HALF_W - 0.4, HALF_W + 0.4), z: opp * clamp(Math.abs(inp.aim.z), 0.4, HALF_L + 0.4) }
  const t = autoTarget(m, p, pace)
  // the nudge: across (from the hitter's view) and deeper/shorter
  const n = inp.nudge || (p.charge || p.armed ? { u: clamp(inp.x * rightSign(p.team), -1, 1), v: clamp(-inp.z * sideOf(p.team), -1, 1) } : null)
  if (!n) return t
  const deep = Math.abs(t.z) + n.v * (Math.abs(t.z) < 3 ? 0.9 : 2)
  return { x: clamp(t.x + n.u * rightSign(p.team) * 1.8, -HALF_W + 0.2, HALF_W - 0.2), z: opp * clamp(deep, 0.5, HALF_L - 0.25) }
}

// A serve's target: the aim, kept inside the right service box (or null: the default)
const serveTarget = (m, p) => {
  const aim = m.inputs[p.slot]?.aim
  if (!aim) return null
  const opp = -sideOf(p.team)
  const want = (m.rally.court === "left" ? -1 : 1) * rightSign(1 - p.team)
  return { x: want * clamp(aim.x * want, 0.3, HALF_W - 0.3), z: opp * clamp(Math.abs(aim.z), KITCHEN + 0.5, HALF_L - 0.3) }
}

// The shot a person would play if they swung now at this pace (the aiming aid): its kind,
// target and where it would really land (a hard ball from down low carries long)
export const previewShot = (m, p, pace) => {
  const e = p.expect
  if (!e) return null
  const target = aimFor(m, p, pace)
  const from = { x: e.x, y: e.y, z: e.z }
  const plan = planIntent({ team: p.team, from, incoming: m.ball.v, target, pace, shotNo: m.rally.hits + 1, volley: !!e.volley })
  const res = playShot({ p: from, v: m.ball.v, w: m.ball.w }, plan)
  return { kind: plan.kind, band: plan.band, target: plan.target, landing: res.solved.landing, long: !!res.solved.long }
}

const GRADE_DELTA = { perfect: 0, good: 1.6, early: -3, late: 3, "very early": -5.5, "very late": 5.5 }

// Work out a swing at the ball as it is now: the shot, how well it's timed and the ball it
// sends back. Doesn't change the match (except the random draws): applyStrike does that.
// Used by this computer's players and, online, by each person's own browser (netplay.js).
// Returns null when a computer player is beaten by a hard ball (too quick for their hands).
export const strike = (m, p, { forced = false } = {}) => {
  const r = m.rally
  const ball = m.ball
  const serving = r.hits === 0
  const ai = isAi(m, p)
  const lv = ai ? (p.ctrl === "human" ? LEVELS.pro : p.level) : null
  const shotNo = r.hits + 1
  const volley = !serving && bouncesOf(m) === 0
  const inSpeed = len(ball.v)
  const fast = !serving && handBattle(m, p)
  const local = (ball.p.x - p.x) * rightSign(p.team) * (p.hand || 1) // (+: the forehand side)
  const window = m.window * (fast ? 1.2 : 1)
  let plan
  let q
  let offset
  let face
  let touch
  let pace = null
  let intent = null
  if (serving) {
    // ---- the serve (its own meter) ----
    const req = p.serving
    let delta = (GRADE_DELTA[req.grade] ?? (ai ? aiTiming(lv, m.rand, m.window) / m.window : 0)) * m.window
    if (req.grade === undefined && !ai) delta = 0
    q = shotQuality(delta, { window: m.window, risky: !!req.risky, kind: "serve" })
    if (req.grade === "early") q.grade = "soft"
    const st = !ai ? serveTarget(m, p) : null
    let aim = req.aim
    let depth = req.depth
    if (!ai && aim === undefined) {
      const inp = m.inputs[p.slot] || { x: 0, z: 0 }
      aim = clamp(inp.x * rightSign(p.team), -1, 1)
      depth = clamp(-inp.z * sideOf(p.team), -1, 1)
    }
    const skill = ai ? 1 : p.stats.touch || 1
    const sigma = ai ? lv.sigma * 0.35 * (1 + (q.sigma - 1) * 0.5) : (0.26 * q.sigma) / skill
    plan = planShot("serve", { team: p.team, from: ball.p, aim: clamp((aim ?? 0) + q.aimShift, -1.2, 1.2), depth: depth ?? 0, power: clamp((req.power ?? 0.5) * (ai ? 1 : p.stats.power || 1), 0, 1), targetX: st?.x, targetZ: st?.z, court: r.court, variant: req.variant, risky: !!req.risky, sigma, rand: m.rand })
    if (plan.mode.speed !== undefined && q.speedMul !== 1) plan.mode = { speed: plan.mode.speed * q.speedMul }
    offset = ai ? lv.offset : 0.01
    // (a serve is a rehearsed, unhurried swing: steadier than a rally shot)
    face = ai ? lv.face * 0.6 : 0.008 * q.face
    touch = ai ? lv.touch * 0.4 : 0.03 * q.touch
  } else if (ai) {
    // ---- a computer player ----
    const req = m.practice?.shot?.(m, p) || aiShot(m, p, lv)
    intent = req.intent || null
    // a hard ball at the net: did they get their hands there in time?
    const avail = m.lastShot ? m.t - m.lastShot.t : 1
    let delta = aiTiming(lv, m.rand, window)
    if (fast && avail < lv.hands) {
      if (avail < lv.hands * 0.7 && m.rand() < 0.5) return null // beaten
      delta = window * (2.4 + ((lv.hands - avail) / lv.hands) * 4) // late
    }
    pace = clamp(req.pace + gauss(m.rand) * 0.04, 0, 1)
    q = shotQuality(delta, { window, kind: pace < 0.36 ? "dink" : "drive" })
    // low balls, fast balls and hitting on the run are harder (a level's errors already
    // include its timing: the grade only nudges them)
    const hardness = 1 + Math.max(0, 0.45 - ball.p.y) * 2.5 + Math.hypot(p.vx, p.vz) * 0.12 + inSpeed * 0.02
    const nudge = (k) => 1 + (k - 1) * 0.5
    const far = Math.abs(ball.p.z) >= 3.8
    const absorb = fast ? 1.3 + Math.max(0, inSpeed - FAST_BALL) / 8 : 1 // softening a hard ball is hard
    offset = lv.offset * (0.5 + m.rand())
    face = lv.face * hardness * nudge(q.face)
    touch = lv.touch * hardness * nudge(q.touch)
    const target = { ...req.target }
    target.x += q.aimShift * rightSign(p.team) * 1.2
    plan = planIntent({ team: p.team, from: ball.p, incoming: ball.v, target, pace, shotNo, volley, sigma: lv.sigma * hardness * nudge(q.sigma), apexSigma: (far ? lv.dropTouch : lv.softTouch) * absorb * (1 + Math.max(0, 0.45 - ball.p.y) * 1.5) * nudge(q.touch), apexAdd: q.apexAdd * 0.5, rand: m.rand })
    if (plan.mode.speed !== undefined && q.speedMul !== 1) plan.mode = { speed: plan.mode.speed * q.speedMul }
  } else {
    // ---- a person: their hold (pace), their aim, their timing ----
    const req = { ...(p.armed || p.charge) }
    const rel = forced || req.release === undefined ? m.t : req.release
    pace = req.pace ?? paceOf(rel - (req.start ?? rel))
    let delta = rel - ((p.zoneT ?? m.t) - leadFor(m, p))
    if (req.auto) delta = Math.max(delta, window * 3.2) // the assist's reflex block: late
    q = shotQuality(delta, { window, kind: pace < 0.36 ? "dink" : "drive" })
    const d = Math.hypot(ball.p.x - p.x, ball.p.z - p.z)
    const spacing = Math.abs(d - 0.55) / REACH // ideal: an arm's length away
    const skill = p.stats.touch || 1
    offset = 0.008 + spacing * 0.07
    face = ((0.006 + spacing * 0.02) * q.face) / skill
    touch = ((0.03 + spacing * 0.08) * q.touch) / skill
    const absorb = fast ? 1.3 + Math.max(0, inSpeed - FAST_BALL) / 8 : 1
    const low = 1 + Math.max(0, 0.45 - ball.p.y) * 1.5
    const target = req.target || aimFor(m, p, pace)
    target.x += q.aimShift * rightSign(p.team) * 1.2
    plan = planIntent({ team: p.team, from: ball.p, incoming: ball.v, target, pace, shotNo, volley, sigma: ((0.2 + spacing * 0.5) * q.sigma) / skill, apexSigma: (((0.05 + spacing * 0.2) * q.touch) / skill) * absorb * low, apexAdd: q.apexAdd, rand: m.rand })
    if (plan.mode.speed !== undefined && q.speedMul !== 1) plan.mode = { speed: plan.mode.speed * q.speedMul * (p.stats.power || 1) }
  }
  const res = playShot({ p: ball.p, v: ball.v, w: ball.w }, plan, { faceError: face, touch, offset, rand: m.rand })
  const kind = serving ? "serve" : plan.kind
  return {
    player: p.id,
    t: m.t,
    kind,
    pace,
    intent,
    grade: q.grade,
    risky: serving && !!p.serving?.risky,
    serve: serving,
    volley,
    fast,
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

// count a shot in the rally stats by its label
const countShot = (m, p, s, j, shotNo) => {
  const f = m.stats.feel
  const t = m.stats.teams[p.team]
  const k = s.kind
  if (k === "dink") {
    f.dinks++
    t.dinks++
  }
  if (j.tag === "dink") {
    f.goodDinks++
    t.goodDinks++
  }
  if (j.tag === "popup") {
    f.popups++
    t.popups++
  }
  if (k === "speedup") {
    f.speedups++
    t.speedups++
    if (j.tone === "great") f.highSpeedups++
  }
  if (k === "counter") {
    f.counters++
    t.counters++
  }
  if (j.tag === "reset") {
    f.resets++
    t.resets++
  }
  if (k === "drop") f.drops++
  if (shotNo === 3) {
    if (k === "drop") f.thirdDrops++
    else if (k === "drive") f.thirdDrives++
  }
  if (k === "lob") f.lobs++
  if (k === "smash") f.smashes++
  if (s.fast && (k === "counter" || k === "reset" || k === "punch" || k === "speedup")) f.handBattles++
  if (j.tag === "net") f.nets++
  if (j.tag === "out") f.outs++
  if (j.tag === "erne") f.ernes++
  if (j.tag === "atp") f.atps++
}

// Make a swing count: the referee, the ball, the swing animation, stats and events
export const applyStrike = (m, p, s) => {
  const r = m.rally
  const ball = m.ball
  let result = null
  const shotNo = r.hits + 1
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
  p.swing = { t: Math.max(0, m.t - s.t), kind: s.kind, hand: s.hand, y: s.contact.y, x: s.contact.x, z: s.contact.z, n: s.n, speed: s.paddle, grade: s.grade, risky: s.risky, fast: !!s.fast, id: (p.swingSeq = (p.swingSeq || 0) + 1) }
  p.armed = null
  p.charge = null
  p.serving = null
  p.zoneT = null
  for (const q of m.players) if (q.team === p.team) q.armed = null
  m.landing = null // where this shot lands (practice judges it)
  // what this ball gives the other side, and what to call the shot
  const a = assessBall(ball, p.team)
  const opps = m.players.filter((q) => q.team !== p.team)
  const oppsBack = opps.every((q) => Math.abs(q.z) > 4.4)
  const erne = s.volley && Math.abs(s.feet.x) > HALF_W + 0.05 && Math.abs(s.feet.z) < KITCHEN + 0.7
  const j = judgeShot(s.kind, a, { contactY: s.contact.y, oppsBack, erne })
  r.dinks = s.kind === "dink" ? (r.dinks || 0) + 1 : 0
  m.stats.shots++
  m.stats.rallyShots++
  const ts = m.stats.teams[p.team]
  ts.shots++
  if (s.grade === "perfect") ts.perfect++
  ts.fastest = Math.max(ts.fastest, speed)
  countShot(m, p, s, j, shotNo)
  m.lastShot = { kind: s.kind, by: p.id, team: p.team, speed, volley: s.volley, landing: s.landing, t: m.t, grade: s.grade, risky: s.risky, label: j.text, tone: j.tone, tag: j.tag, attackable: a.attackable, pace: s.pace }
  if (!m.mirror) afterShot(m, p.team, s.kind, p, a)
  m.version++
  emit(m, { type: "hit", player: p.id, team: p.team, kind: s.kind, speed, volley: s.volley, x: ball.p.x, y: ball.p.y, z: ball.p.z, paddle: s.paddle, grade: s.grade, risky: s.risky, hand: s.hand, human: p.ctrl !== "cpu" && p.ctrl !== "feeder", label: j.text, tone: j.tone, tag: j.tag, fast: !!s.fast, attackH: a.attackH })
  if (result) decided(m, result)
}

const hit = (m, p, opts) => {
  // bounces still held for a player online happened before this hit
  if (!m.mirror && m.held?.length) flushHeld(m)
  if (!isLive(m.rally)) return
  const s = strike(m, p, opts)
  if (!s) {
    // beaten by a hard ball: the paddle never got there
    p.armed = null
    p.noSwing = m.version
    p.swing = { t: 0, kind: "block", hand: "bh", y: m.ball.p.y, whiff: true }
    emit(m, { type: "whiff", player: p.id, beaten: true })
    return
  }
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
  const inp = m.inputs[slot] || (m.inputs[slot] = { x: 0, z: 0, aim: null, nudge: null })
  inp.x = x
  inp.z = z
}

// where this person is aiming: a point on the other court (world x, z), or null for the
// default; nudge ({ u across, v deeper }, each -1..1) shifts the default instead
export const setAim = (m, aim, slot = 0, nudge = null) => {
  const inp = m.inputs[slot] || (m.inputs[slot] = { x: 0, z: 0, aim: null, nudge: null })
  inp.aim = aim ? { x: aim.x, z: aim.z } : null
  inp.nudge = nudge ? { u: clamp(nudge.u, -1, 1), v: clamp(nudge.v, -1, 1) } : null
}

// The hit control goes down: start the swing (hold it for pace). Holding it early is having
// the paddle up and ready: let go as the ball comes. Between points it hurries things along.
export const press = (m, slot) => {
  const p = humanBySlot(m, slot)
  if (!p || m.paused) return false
  if (m.phase === "dead" || m.phase === "intro") {
    m.skip = true
    return true
  }
  if (m.ball.held === p.id && m.phase === "serve") {
    p.charge = { kind: "serve", variant: "drive", start: m.t }
    return true
  }
  if (m.phase !== "rally") return false
  if (p.swing && p.swing.t < 0.2) return false // still finishing the last one
  p.charge = { kind: "hit", start: m.t }
  p.armed = null
  return true
}

// The hit control comes up: swing. opts: pace (0..1, instead of the hold), target {x, z}
// (instead of the live aim), aim/depth (the serve's steer)
export const release = (m, slot, opts = {}) => {
  const p = humanBySlot(m, slot)
  if (!p) return false
  const c = p.charge
  if (!c) return false
  p.charge = null
  if (c.kind === "serve") {
    if (m.ball.held !== p.id || m.phase !== "serve") return false
    const meter = serveMeter(m.t - c.start)
    return serve(m, { kind: "serve", variant: meter.grade === "early" ? "soft" : "drive", power: meter.power, grade: meter.grade, risky: meter.fill > 1, aim: opts.aim, depth: opts.depth })
  }
  if (m.phase !== "rally") return false
  const pace = opts.pace ?? paceOf(m.t - c.start)
  p.armed = { kind: "hit", pace, start: c.start, release: m.t, until: m.t + ARM_S, target: opts.target || null }
  return true
}

// A whole swing at once (a tap): { pace 0..1, target {x, z} } (a serve: { power, aim, depth })
export const swing = (m, req = {}, slot = 0) => {
  const p = humanBySlot(m, slot)
  if (!p || m.paused) return false
  if (m.ball.held === p.id && m.phase === "intro") settleIntro(m)
  if (m.ball.held === p.id && m.phase === "serve") {
    return serve(m, { kind: "serve", variant: "drive", aim: req.aim ?? 0, depth: req.depth ?? 0, power: req.power ?? 0.5, grade: req.grade ?? "good" })
  }
  if (!press(m, slot)) return false
  if (m.phase !== "rally") return true
  return release(m, slot, { pace: req.pace ?? 0.3, target: req.target })
}

// What the meter shows for a person: how soon the ball gets to them (from their predicted
// contact), the pace they're holding, how high they'll meet it (above the net: attack it;
// low: keep it soft), whether it's a hand battle, and the serve meter
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
  const pace = p.charge ? paceOf(m.t - p.charge.start) : p.armed?.pace ?? null
  return {
    mode: "rally",
    ttc,
    lead: leadFor(m, p),
    window: m.window,
    charging: !!p.charge,
    pace,
    band: pace === null ? null : paceBand(pace),
    height: e.y > NET_H_CENTER + 0.09 ? "high" : e.y < 0.55 ? "low" : "mid",
    fast: handBattle(m, p),
    released: p.armed?.release ?? null,
    t: m.t,
  }
}

// A stand-in for a person (tests and the dev hook): runs to the ball, decides a shot the way
// a decent player would (ai.js, at the contact it expects), aims there, presses the hit
// control early enough to hold for that pace and lets go on the beat, with a little human
// scatter in the timing. Uses only what a person has: the stick, the aim and the button.
export const autopilot = (m, slot = 0, { jitter = 0.03, rand = Math.random, level = LEVELS.pro } = {}) => {
  const p = humanBySlot(m, slot)
  if (!p || m.paused) return
  if (m.phase === "serve" && m.ball.held === p.id) {
    if (!p.charge) press(m, slot)
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
  if (!p.charge && !p.armed && ttc < 0.9 && ttc > 0.02) {
    if (p.standIn?.v !== m.version) {
      const shot = aiShot(m, p, level, { p: { x: e.x, y: e.y, z: e.z }, v: m.ball.v }, rand)
      p.standIn = { v: m.version, pace: shot.pace, target: shot.target, lead: leadFor(m, p) + (rand() * 2 - 1) * jitter }
    }
    const hold = 0.05 + p.standIn.pace * PACE_RAMP
    if (ttc <= p.standIn.lead + hold && press(m, slot) && p.charge) {
      p.charge.aimAt = p.standIn.lead
      setAim(m, p.standIn.target, slot)
    }
  } else if (p.charge && ttc <= (p.charge.aimAt ?? SWING_LEAD)) release(m, slot)
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
      const s = Math.min(between ? Math.min(lv.speed * 0.7, WALK_BACK) : speed, Math.sqrt(2 * 9 * d)) // ease into the spot
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
  // (presentation: where the player is heading, for the footwork's trajectory prediction)
  p.want = { x: wantX, z: wantZ }
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
      if (mine && !deferring && !machine && p.noSwing !== m.version) p.armed = { kind: "ai", waitBounce: !plan.volley, lunge: !!plan.lunge }
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
      if (!req) {
        if (autoBlock(m, p)) hit(m, p, { forced: true })
        continue
      }
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

// The movement assist's reflex: a hard ball at a person at the net who didn't swing gets a
// late, soft block (it usually floats up: better to time your own)
const autoBlock = (m, p) => {
  if (p.ctrl !== "human" || isAi(m, p) || assistOf(m) === "off" || !handBattle(m, p)) return false
  if (!canHit(m, p, { kind: "hit", auto: true })) return false
  if (p.zoneT === null) {
    p.zoneT = m.t
    return false
  }
  if (m.t - p.zoneT < 0.05) return false
  p.charge = { kind: "hit", start: m.t, auto: true }
  return true
}

export const step = (m, dt = STEP) => {
  if (m.phase === "over" && !m.paused && !m.mirror) return walkToNet(m, dt)
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
      if (!req) {
        if (autoBlock(m, p)) {
          hit(m, p, { forced: true })
          break
        }
        continue
      }
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
