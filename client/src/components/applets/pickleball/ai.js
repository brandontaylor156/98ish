// Pickleball 98: the computer players. They read the ball's whole path (the same physics
// the game uses), pick where to meet it (letting balls that are going out go), and play
// real pickleball: deep serves and returns, a third-shot drop (or drive), moving up to the
// kitchen line, dinking until someone pops one up, attacking high balls, and resetting
// into the kitchen when they're caught in the middle.

import { HALF_L, HALF_W, KITCHEN, NET_H_CENTER, predictPath } from "./physics.js"
import { inKitchen, rightSign, sideOf } from "./rules.js"

export const LEVELS = {
  beginner: {
    label: "Beginner",
    speed: 3.0, // m/s on court
    reaction: 0.36, // s before they start moving to a new ball
    sigma: 0.7, // m of aim scatter
    face: 0.04, // rad of paddle face wobble
    touch: 0.12, // relative error in how hard they hit (soft shots float or net)
    offset: 0.045, // m off the sweet spot
    judge: 0.9, // only lets a ball go if it's this far out
    drop: 0.2, // chance of a third-shot drop (else a drive)
    reset: 0.3, // chance of resetting (vs. driving) when caught back against net players
    lob: 0.05,
    attack: 0.3, // m above the net before they'll attack a ball
    speedup: 0.03, // chance of speeding up a dink that's merely waist high
    advance: 0.45, // chance of moving up to the kitchen line when they should
    serveWait: 1.4,
    maxY: 1.7,
  },
  intermediate: {
    label: "Intermediate",
    speed: 3.6,
    reaction: 0.24,
    sigma: 0.4,
    face: 0.022,
    touch: 0.075,
    offset: 0.025,
    judge: 0.35,
    drop: 0.5,
    reset: 0.6,
    lob: 0.06,
    attack: 0.12,
    speedup: 0.08,
    advance: 0.85,
    serveWait: 1.1,
    maxY: 1.95,
  },
  pro: {
    label: "Pro",
    speed: 4.2,
    reaction: 0.14,
    sigma: 0.2,
    face: 0.011,
    touch: 0.045,
    offset: 0.012,
    judge: 0.12,
    drop: 0.75,
    reset: 0.8,
    lob: 0.05,
    attack: 0.03,
    speedup: 0.15,
    advance: 1,
    serveWait: 0.9,
    maxY: 2.15,
  },
}

export const REACH = 1.05 // m from a player's center to the farthest ball they can hit
const STAND_SIDE = 0.5 // where a player stands relative to the ball they'll hit
const STAND_BACK = 0.22
export const NET_LINE = KITCHEN + 0.42 // "at the kitchen line": toes just behind it
export const BASE_LINE = HALF_L + 0.25

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Where a player waits when the ball isn't theirs to hit
export const homeFor = (m, p) => {
  const side = sideOf(p.team)
  const rs = rightSign(p.team)
  const r = m.rally
  let depth
  const servingTeam = r.serving === p.team
  if (servingTeam && r.hits < 3) depth = BASE_LINE // the two-bounce rule keeps them back
  else if (!servingTeam && r.hits < 2) depth = p.id === r.receiver ? BASE_LINE : NET_LINE
  else depth = m.teamDepth[p.team] === "net" ? NET_LINE : m.teamDepth[p.team] === "mid" ? 4.3 : BASE_LINE - 0.1
  const ballX = m.ball.p.x
  let x
  if (m.game.doubles) {
    const lane = p.lane === "right" ? 1 : -1
    x = rs * lane * 1.4 + clamp(ballX, -HALF_W, HALF_W) * 0.3
  } else {
    x = clamp(ballX, -HALF_W, HALF_W) * 0.45
  }
  return { x, z: side * depth }
}

// Every way a player could meet the ball on its predicted path; returns the one they'd
// pick (or the least-bad one if they can't make any). null if they'd let it go.
export const interceptFor = (m, p, path, { speed, reaction, judge = 0.2, maxY = 2 }) => {
  const side = sideOf(p.team)
  const r = m.rally
  const volleyAllowed = r.hits >= 3
  const already = r.bounces // the path starts now: it may have bounced once already
  // is it going out? (a ball that first lands out on our side is the hitter's fault)
  const first = already === 0 && path.find((s) => s.bounce)
  if (first && Math.sign(first.z) === side) {
    const outBy = Math.max(Math.abs(first.x) - HALF_W, Math.abs(first.z) - HALF_L)
    if (outBy > judge) return { letGo: true }
  }
  const nearNet = Math.abs(p.z) < 4.2
  let best = null
  let fallback = null
  for (const s of path) {
    const bounces = s.bounces + already
    if (s.t < 0.05 || bounces > 1 || (s.bounce && bounces > 1)) continue
    if (s.z * side < 0.15) continue // still on their side of the net
    if (s.y < 0.12 || s.y > maxY) continue
    const volley = bounces === 0
    if (volley && !volleyAllowed) continue
    // stand beside the ball (on whichever side is closer) and a step behind it
    const sx = s.x + (p.x >= s.x ? STAND_SIDE : -STAND_SIDE)
    const sz = s.z + side * STAND_BACK
    if (volley && inKitchen(sx, sz)) continue // a volley from there is a fault
    const dist = Math.hypot(sx - p.x, sz - p.z)
    const need = reaction + Math.max(0, dist - 0.25) / speed
    const slack = s.t - need
    if (!fallback || slack > fallback.slack) fallback = { ...s, stand: { x: sx, z: sz }, volley, slack }
    if (slack < 0) continue
    // what they'd like: at the net, take volleys early; from the back, a groundstroke at
    // a comfortable height after the bounce
    let cost
    if (volley) cost = nearNet ? s.t * 0.5 + (s.y < 0.35 ? 0.6 : 0) : 0.9 + s.t
    else cost = Math.abs(s.y - 0.75) + s.t * 0.25
    if (!best || cost < best.cost) best = { ...s, stand: { x: sx, z: sz }, volley, slack, cost }
  }
  return best || (fallback ? { ...fallback, late: true } : null)
}

// Which player on a team takes the ball, and where (for AI players and the movement assist)
export const planTeam = (m, team) => {
  const ball = m.ball
  const path = predictPath({ p: ball.p, v: ball.v, w: ball.w }, { maxT: 3.2, every: 1 / 60, maxBounces: 2 })
  let pick = null
  for (const p of m.players.filter((q) => q.team === team)) {
    const lv = p.human ? m.humanLevel : p.level
    const plan = interceptFor(m, p, path, lv)
    if (!plan) continue
    if (plan.letGo) return { letGo: true, path }
    // doubles: each player covers their own half; a little bias to the one whose half it is
    let score = plan.late ? 10 - plan.slack : -plan.slack * 0.4 + (plan.cost || 0)
    if (m.game.doubles) {
      const mine = Math.sign(plan.x * rightSign(team)) === (p.lane === "right" ? 1 : -1)
      if (!mine && Math.abs(plan.x) > 0.3) score += 0.8
      if (p.human && !m.assist) score = mine || Math.abs(plan.x) <= 0.3 ? -100 : score + 0.5 // your half is yours
    }
    if (!pick || score < pick.score) pick = { ...plan, player: p.id, score }
  }
  return pick ? { ...pick, path } : { path }
}

// The shot a computer player chooses for the ball in front of it
export const aiShot = (m, p) => {
  const lv = p.level
  const rand = m.rand
  const r = m.rally
  const team = p.team
  const side = sideOf(team)
  const ball = m.ball.p
  const opps = m.players.filter((q) => q.team !== team)
  const oppsAtNet = opps.reduce((s, q) => s + Math.abs(q.z), 0) / opps.length < 3.6
  const myDist = Math.abs(p.z)
  const shotNo = r.hits + 1
  const netTop = NET_H_CENTER
  const pickAim = () => (rand() < 0.5 ? -1 : 1) * (0.25 + rand() * 0.6)
  // the gap between two opponents, or away from a lone one
  const middleX = () => (opps.length > 1 ? (opps[0].x + opps[1].x) / 2 : -Math.sign(opps[0].x || 1) * 1.6)

  if (shotNo === 2) return { kind: "return", aim: pickAim() * 0.7, power: 0.3 + rand() * 0.5 }
  if (shotNo === 3) {
    if (rand() < lv.drop) return { kind: "drop", aim: pickAim() * 0.6, power: 0.4 }
    return { kind: "drive", targetX: middleX() + (rand() - 0.5), power: 0.4 + rand() * 0.4 }
  }
  const high = ball.y > netTop + lv.attack || (ball.y > 0.55 && myDist < 3.3 && rand() < lv.speedup)
  if (high && myDist < 5.5) {
    // a ball up high near the net: put it away at someone's feet or down the middle
    const at = opps[Math.floor(rand() * opps.length)]
    const kind = ball.y > 1.45 && myDist < 4 ? "smash" : "punch"
    return { kind, targetX: rand() < 0.6 ? middleX() : at.x, targetZ: -side * clamp(Math.abs(at.z) - 0.2, 2.6, HALF_L - 1), power: 0.6 + rand() * 0.4 }
  }
  if (myDist < 3.3) {
    // at the kitchen line
    if (ball.y < netTop + 0.08 || !oppsAtNet) {
      if (!oppsAtNet && rand() < 0.5) return { kind: "punch", targetX: middleX(), power: 0.4 }
      // dink: mostly cross-court, sometimes middle
      const cross = rand() < 0.65
      return { kind: "dink", targetX: cross ? -p.x * 0.8 + (rand() - 0.5) * 0.6 : middleX() * 0.5, power: 0.2 }
    }
    return { kind: rand() < 0.5 ? "block" : "punch", targetX: middleX(), power: 0.4 }
  }
  // in the transition zone or at the back
  if (oppsAtNet) {
    if (rand() < lv.lob) return { kind: "lob", aim: pickAim(), power: 0.5 }
    if (rand() < lv.reset) return { kind: myDist > 4.5 ? "drop" : "block", aim: pickAim() * 0.6, power: 0.3 }
    return { kind: "drive", targetX: middleX(), power: 0.5 + rand() * 0.4 }
  }
  if (rand() < lv.drop * 0.6) return { kind: "drop", aim: pickAim() * 0.6, power: 0.4 }
  return { kind: "drive", aim: pickAim(), power: 0.4 + rand() * 0.5 }
}

// What a computer player's team does after a shot: move up to the kitchen line, or not yet
export const afterShot = (m, team, kind, p) => {
  const lv = p.human ? LEVELS.pro : p.level
  const soft = kind === "drop" || kind === "dink" || kind === "block" || kind === "return" || kind === "lob"
  const current = m.teamDepth[team]
  if (kind === "serve") m.teamDepth[team] = "back"
  else if (soft) m.teamDepth[team] = m.rand() < lv.advance ? "net" : current === "net" ? "net" : "mid"
  else if (current !== "net") m.teamDepth[team] = m.rand() < lv.advance * 0.6 ? "mid" : current
}

// The serve: deep, mostly to the middle of the box, a bit of variety
export const aiServe = (m, p) => ({ kind: "serve", aim: (m.rand() - 0.5) * 1.2, power: 0.25 + m.rand() * 0.55 })

