// Pickleball 98: the computer players. They read the ball's whole path (the same physics
// the game uses), pick where to meet it (letting balls that are going out go), and choose
// shots the way people do, as a target and a pace (shots.js planIntent), so they live with
// the same consequences: a floated dink gets attacked, a hard ball from below the net sails.
//
// How a point goes at a good level: a deep serve and a deep return (the returner comes to
// the kitchen line, the server's team stays back for the two-bounce rule), a third-shot drop
// (or a drive, then a drop), moving up in stages, then a dink rally until somebody's ball
// comes up: that one gets sped up at the body, and the other side counters or blocks it soft
// (a reset). Levels differ the way real players do:
//   Rookie: bangs, pops dinks up, stays back, speeds up anything;
//   Club: drops and dinks, but gets impatient and speeds up balls that aren't up;
//   Pro: patient, resets hard balls into the kitchen, attacks only balls that are up;
//   Legend: all of that with better hands.
// A style (banger, dinker...) leans a level's habits one way. Both are plain data.
// A Twin Clone (twin/clone/profile.js cloneLevel) is a level object measured from a real
// person's games; it may carry stanceNet/stanceBack (where they stand), crossDink, deepZ and
// serveDepth, read below with the old numbers as defaults (levels without them play as before).

import { HALF_L, HALF_W, KITCHEN, NET_H_CENTER, len, predictPath } from "./physics.js"
import { FOOT_R, inKitchen, rightSign, sideOf } from "./rules.js"
import { FAST_BALL, SOFT_KINDS, planIntent, solveDrive } from "./shots.js"

// Per level:
//   speed m/s on court; reaction s before moving to a new ball; sigma m of aim scatter;
//   face rad of paddle wobble; touch: relative error in how hard the face pushes; offset m
//   off the sweet spot; judge: lets a ball go if it lands this far out; softTouch m: how far
//   a dink's height wanders (up is a pop-up); dropTouch: the same for drops and resets from
//   farther back; drop: chance of a third-shot drop (else a drive); reset: chance of
//   playing soft (a reset or drop) from the transition zone against net players; bang:
//   chance of just hitting hard; patience: dinks before they get itchy; impatience: chance
//   of speeding up a ball that isn't up, once itchy; attack: m above the net a ball must be
//   met before they attack it; hands: s they need to react to a hard ball at the net
//   (less and they're late); counter: chance of countering (vs. blocking) a hard ball
//   met above the net; lob: chance of a surprise lob; advance: chance of moving up after a
//   good soft shot; timing: chance of a perfect / good swing.
const COMMON = { serveWait: 1.1, maxY: 1.95 }
export const LEVELS = {
  beginner: {
    ...COMMON,
    label: "Rookie",
    speed: 3.0,
    reaction: 0.34,
    sigma: 0.45,
    face: 0.022,
    touch: 0.07,
    offset: 0.04,
    judge: 0.9,
    softTouch: 0.34,
    dropTouch: 0.5,
    drop: 0.15,
    reset: 0.2,
    bang: 0.4,
    patience: 1,
    impatience: 0.45,
    attack: -0.2,
    hands: 0.45,
    counter: 0.4,
    lob: 0.04,
    advance: 0.45,
    timing: [0.12, 0.45],
    serveWait: 1.4,
    maxY: 1.7,
  },
  intermediate: {
    ...COMMON,
    label: "Club",
    speed: 3.6,
    reaction: 0.22,
    sigma: 0.38,
    face: 0.018,
    touch: 0.045,
    offset: 0.024,
    judge: 0.4,
    softTouch: 0.2,
    dropTouch: 0.2,
    drop: 0.55,
    reset: 0.5,
    bang: 0.08,
    patience: 3,
    impatience: 0.3,
    attack: 0.02,
    hands: 0.34,
    counter: 0.5,
    lob: 0.04,
    advance: 0.85,
    timing: [0.3, 0.5],
  },
  pro: {
    ...COMMON,
    label: "Pro",
    speed: 4.2,
    reaction: 0.14,
    sigma: 0.24,
    face: 0.01,
    touch: 0.04,
    offset: 0.012,
    judge: 0.15,
    softTouch: 0.22,
    dropTouch: 0.14,
    drop: 0.6,
    reset: 0.85,
    bang: 0,
    patience: 2,
    impatience: 0.26,
    attack: 0.01,
    sense: 1,
    hands: 0.28,
    counter: 0.65,
    lob: 0.03,
    advance: 1,
    timing: [0.5, 0.42],
    serveWait: 0.9,
    maxY: 2.3, // (an overhead jumps for it: pro.js overheadLift)
  },
  legend: {
    ...COMMON,
    label: "Legend",
    speed: 4.5,
    reaction: 0.1,
    sigma: 0.18,
    face: 0.008,
    touch: 0.028,
    offset: 0.008,
    judge: 0.1,
    softTouch: 0.21,
    dropTouch: 0.11,
    drop: 0.6,
    reset: 0.85,
    bang: 0,
    patience: 2,
    impatience: 0.45,
    attack: -0.01,
    sense: 1,
    hands: 0.31,
    counter: 0.75,
    lob: 0.03,
    advance: 1,
    timing: [0.65, 0.32],
    serveWait: 0.8,
    maxY: 2.35,
  },
}
export const LEVEL_KEYS = Object.keys(LEVELS)

// How good a player's shot sense is (0 none, 0.5 some, 1 full): picking a pace that lands,
// rolling low balls at the feet, aiming attacks sharp. It used to be read off the attack
// threshold (attack > 0.03 = full); levels may now set it directly (sense) so a top level
// can attack lower balls without losing its judgment.
export const senseOf = (lv) => lv.sense ?? (lv.attack > 0.03 ? 1 : lv.attack > 0 ? 0.5 : 0)

// Styles scale a level's habits (multipliers; "attack" is added, in meters)
export const STYLES = {
  allround: { label: "All-rounder" },
  banger: { label: "Banger", drop: 0.45, reset: 0.6, bang: 3, impatience: 1.8, patience: 0.5, lob: 0.6, attack: -0.08 },
  dinker: { label: "Dinker", drop: 1.3, reset: 1.15, impatience: 0.5, patience: 1.5, bang: 0.3, lob: 0.7 },
  lobber: { label: "Lobber", lob: 3.5, drop: 0.9, reset: 0.9 },
  counter: { label: "Counter-puncher", reset: 1.1, counter: 1.35, hands: 0.85, impatience: 0.7 },
  wall: { label: "The Wall", reset: 1.25, impatience: 0.5, patience: 1.4, softTouch: 0.85, judge: 0.7 },
}

// A level with a style's habits folded in (chances stay in 0..1)
const CHANCES = new Set(["drop", "reset", "bang", "impatience", "counter", "lob", "advance"])
export const levelFor = (level, style = "allround") => {
  const base = LEVELS[level] || LEVELS.intermediate
  const mods = STYLES[style] || STYLES.allround
  const out = { ...base, style: STYLES[style] ? style : "allround" }
  for (const [k, v] of Object.entries(mods)) {
    if (k === "label" || typeof base[k] !== "number") continue
    if (k === "attack") out[k] = base[k] + v
    else out[k] = CHANCES.has(k) ? Math.min(1, base[k] * v) : base[k] * v
  }
  return out
}

export const REACH = 1.05 // m from a player's center to the farthest ball they can hit
const STAND_SIDE = 0.5 // where a player stands relative to the ball they'll hit
const STAND_BACK = 0.22
export const NET_LINE = KITCHEN + 0.42 // "at the kitchen line": toes just behind it
export const BASE_LINE = HALF_L + 0.25
const LINE_Z = KITCHEN + FOOT_R + 0.07 // toes on the line (and not in the kitchen)
const LUNGE = 0.95 // m forward a player at the line reaches for a volley over the kitchen

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const bouncesNow = (m) => m.rally.bounces + (m.held?.length || 0)

// Where a player waits when the ball isn't theirs to hit. Partners move as a unit (one
// depth per team), each covering their half, both drifting toward the ball.
export const homeFor = (m, p) => {
  const side = sideOf(p.team)
  const rs = rightSign(p.team)
  const r = m.rally
  let depth
  const servingTeam = r.serving === p.team
  if (servingTeam && r.hits < 3) depth = BASE_LINE // the two-bounce rule keeps them back
  else if (!servingTeam && r.hits < 2) depth = p.id === r.receiver ? BASE_LINE : NET_LINE
  else {
    const lv = p.level || {}
    depth = m.teamDepth[p.team] === "net" ? lv.stanceNet ?? NET_LINE : m.teamDepth[p.team] === "mid" ? 4.3 : lv.stanceBack ?? BASE_LINE - 0.1
  }
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
  // the path starts now: it may have bounced once already (online, a bounce the referee
  // hasn't heard about yet still happened)
  const already = bouncesNow(m)
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
    let sz = s.z + side * STAND_BACK
    let lunge = false
    if (volley && inKitchen(sx, sz)) {
      // a volley over the kitchen: toes on the line, reaching forward for it
      if (Math.abs(s.z) < LINE_Z - LUNGE) continue
      sz = side * LINE_Z
      lunge = true
    }
    const dist = Math.hypot(sx - p.x, sz - p.z)
    const need = reaction + Math.max(0, dist - 0.25) / speed
    const slack = s.t - need
    if (!fallback || slack > fallback.slack) fallback = { ...s, stand: { x: sx, z: sz }, volley, slack, lunge }
    if (slack < 0) continue
    // at the net: meet it as high as it gets (a ball up there can be hit down); take high
    // ones out of the air. From the back: a comfortable height after the bounce.
    let cost
    if (volley) cost = nearNet ? s.t * 0.4 + (s.y < 0.45 ? 0.7 : 0) - (s.y > 0.95 ? 0.6 + (s.y - 0.95) : 0) + (lunge ? 0.15 : 0) : 0.9 + s.t
    else cost = nearNet ? Math.max(0, 0.95 - s.y) + s.t * 0.2 : Math.abs(s.y - 0.75) + s.t * 0.25
    if (!best || cost < best.cost) best = { ...s, stand: { x: sx, z: sz }, volley, slack, cost, lunge }
  }
  return best || (fallback ? { ...fallback, late: true } : null)
}

// The level a player plays at (people get the human profile; autoplay plays like a pro)
export const levelOf = (m, p) => (p.ctrl === "cpu" || p.ctrl === "feeder" ? p.level : m.autoplay && p.ctrl === "human" ? LEVELS.pro : m.humanLevel)

// Doubles: is a ball at x (down the middle) on this player's forehand? A right-hander on the
// left of their court and a left-hander on the right have their forehands in the middle.
export const middleForehand = (p, x) => Math.abs(x) <= 0.6 && (p.hand || 1) === (p.lane === "right" ? -1 : 1)

// Which player on a team takes the ball, and where (for computer players, the movement
// assist, and the animation's "here it comes")
export const planTeam = (m, team) => {
  const ball = m.ball
  const path = predictPath({ p: ball.p, v: ball.v, w: ball.w }, { maxT: 3.2, every: 1 / 60, maxBounces: 2 })
  let pick = null
  const each = {}
  for (const p of m.players.filter((q) => q.team === team)) {
    const plan = interceptFor(m, p, path, levelOf(m, p))
    each[p.id] = plan
    if (!plan) continue
    if (plan.letGo) return { letGo: true, path, each }
    // doubles: each player covers their own half; a little bias to the one whose half it is
    let score = plan.late ? 10 - plan.slack : -plan.slack * 0.4 + (plan.cost || 0)
    if (m.game.doubles) {
      const mine = Math.sign(plan.x * rightSign(team)) === (p.lane === "right" ? 1 : -1)
      if (!mine && Math.abs(plan.x) > 0.3) score += 0.8
      // a ball down the middle: the player whose forehand is in the middle takes it
      else if (middleForehand(p, plan.x)) score -= 0.15
      // a person's half is theirs: the computer partner leaves it alone
      if (p.ctrl !== "cpu" && !m.autoplay) score = mine || Math.abs(plan.x) <= 0.3 ? -100 : score + 0.5
    }
    if (!pick || score < pick.score) pick = { ...plan, player: p.id, score }
  }
  return pick ? { ...pick, path, each } : { path, each }
}

// How well a computer player times this swing: a delta for shotQuality (seconds early or
// late), drawn from the level's chances of a perfect or good swing
export const aiTiming = (lv, rand, window = 0.06) => {
  const [perfect, good] = lv.timing || [0.3, 0.5]
  const r = rand()
  const sign = rand() < 0.5 ? -1 : 1
  if (r < perfect) return sign * rand() * window * 0.9
  if (r < perfect + good) return sign * window * (1.1 + rand() * 1.0)
  return sign * window * (2.4 + rand() * 2.6)
}

// ---- targets ----
// Where shots go, for a player on `team` hitting from `from` (a ball position). rand: 0..1
// source (people's default aim passes a steady 0.5-ish source, so it doesn't jump around).
export const targetsFor = (m, p, from, rand) => {
  const team = p.team
  const opp = -sideOf(team)
  const opps = m.players.filter((q) => q.team !== team)
  const cx = (x) => clamp(x, -HALF_W + 0.35, HALF_W - 0.35)
  const hitX = from.x
  const middle = () => (opps.length > 1 ? (opps[0].x + opps[1].x) / 2 : -Math.sign(opps[0].x || 1) * 1.4)
  // the opponent this ball should go at: the one in front (straight ahead), or nearest
  const victim = () => opps.reduce((a, b) => (Math.abs(b.x - hitX) < Math.abs(a.x - hitX) ? b : a))
  return {
    // dinks: mostly cross-court (more court, the low middle of the net), sometimes middle
    dink(cross = rand() < (p.level?.crossDink ?? 0.65)) {
      const x = cross ? -Math.sign(hitX || 0.01) * (0.8 + rand() * 1.4) : middle() * 0.4 + (rand() - 0.5) * 0.8
      return { x: cx(x), z: opp * (1.3 + rand() * 0.6) }
    },
    // drops and resets: into the kitchen, toward the middle
    drop() {
      return { x: cx(-hitX * 0.3 + (rand() - 0.5) * 1.6), z: opp * (1.2 + rand() * 0.7) }
    },
    // deep: returns and drives from the back
    deep() {
      // (the across draw comes first, as it always has: seeded matches stay the same)
      const x = cx(middle() + (rand() - 0.5) * 1.6)
      const want = p.level?.deepZ
      const z = want ? clamp(want + (rand() - 0.5) * 1.0, 3.6, HALF_L - 0.3) : HALF_L - 0.9 - rand() * 1.2
      return { x, z: opp * z }
    },
    // a speed-up or put-away: at a player's paddle-side hip (it lands behind them), or at
    // their feet from up high
    attack(y, sharp = true, feet = false) {
      const q = victim()
      const hip = sharp ? rightSign(q.team) * (q.hand || 1) * 0.32 : (rand() - 0.5) * 1.2
      const back = Math.abs(q.z) > 5 ? -0.6 : y > 1.45 || feet ? -0.45 : 0.9
      return { x: cx(q.x + hip), z: opp * clamp(Math.abs(q.z) + back, 1.4, HALF_L - 0.3) }
    },
    // a lob over whoever's closest to the net, on their backhand side (a left-hander's is on
    // their right)
    lob() {
      const q = opps.reduce((a, b) => (Math.abs(b.z) < Math.abs(a.z) ? b : a))
      return { x: cx(q.x - rightSign(q.team) * (q.hand || 1) * 0.8), z: opp * (HALF_L - 0.9 - rand() * 0.6) }
    },
  }
}

// What a sensible player would do with this ball at this pace (people's default target,
// when they aren't pointing anywhere)
export const autoTarget = (m, p, pace) => {
  const steady = () => 0.5
  const t = targetsFor(m, p, m.ball.p, steady)
  const r = m.rally
  const dist = Math.abs(m.ball.p.z)
  if (r.hits + 1 === 2) return t.deep()
  if (pace < 0.36) return dist < 3.8 ? t.dink(true) : t.drop()
  return dist < 4.2 ? t.attack(m.ball.p.y) : t.deep()
}

// The hardest of these paces that still lands in from here (good players know what a ball
// at this height lets them do); null if none does. (Past the target is fine: a ball at
// someone's hip that they leave still has to land in.)
export const paceThatFits = (p, at, target, paces) => {
  for (const pace of paces) {
    const plan = planIntent({ team: p.team, from: at.p, incoming: at.v, target, pace })
    const s = solveDrive(at.p, plan.target, { ...plan.mode, spin: plan.spin, minClear: plan.minClear })
    if (Math.abs(s.landing.z) < HALF_L - 0.35 && Math.abs(s.landing.x) < HALF_W - 0.1) return pace
  }
  return null
}

// The shot a computer player chooses for the ball in front of it: { pace, target, intent }
// (at: the ball at contact, if not now; the stand-in for a person decides ahead of time)
export const aiShot = (m, p, lv = p.level, at = m.ball, rand = m.rand) => {
  const r = m.rally
  const ball = at
  const y = ball.p.y
  const t = targetsFor(m, p, ball.p, rand)
  const opps = m.players.filter((q) => q.team !== p.team)
  const oppsAtNet = opps.reduce((s, q) => s + Math.abs(q.z), 0) / opps.length < 3.6
  // someone pressed right up on the kitchen line: lob bait
  const crowding = opps.some((q) => Math.abs(q.z) < NET_LINE + 0.05)
  const dist = Math.abs(ball.p.z)
  const shotNo = r.hits + 1
  const above = y - NET_H_CENTER
  const fast = len(ball.v) > FAST_BALL && dist < 4.6
  const soft = (k = 0.18) => rand() * k
  const hard = () => 0.72 + rand() * 0.28
  const dinks = r.dinks || 0
  // good players only go hard when the ball lets them (the pace that still lands in)
  const sense = senseOf(lv)
  const wise = rand() < sense
  const fit = (target, paces) => {
    if (!wise) return paces[0]
    const pace = paceThatFits(p, ball, target, paces)
    if (pace !== null) return pace
    // (or a little deeper: through them rather than at their feet)
    const deeper = { x: target.x, z: Math.sign(target.z) * Math.min(HALF_L - 0.6, Math.abs(target.z) + 1.4) }
    const pace2 = paceThatFits(p, ball, deeper, paces)
    if (pace2 !== null) Object.assign(target, deeper)
    return pace2
  }

  if (shotNo === 2) return { pace: 0.48 + rand() * 0.2, target: t.deep(), intent: "return" }
  if (shotNo === 3) {
    if (rand() < lv.drop) return { pace: soft(0.22), target: t.drop(), intent: "drop" }
    return { pace: 0.7 + rand() * 0.25, target: rand() < 0.5 ? t.attack(y, false) : t.deep(), intent: "drive" }
  }
  // a ball met above the net, near it: attack (at the body, or put it away)
  if (!fast && above > lv.attack && dist < 5.5) {
    const target = t.attack(y, sense > 0)
    const pace = fit(target, [hard(), 0.74, 0.6, 0.48])
    if (pace !== null) return { pace, target, intent: y > 1.45 ? "smash" : "speedup" }
  }
  if (fast) {
    // a hard ball at the net: counter it if it's up around the tape, or block it soft
    if ((above > -0.06 && rand() < lv.counter) || above > 0.45) {
      const target = t.attack(y, sense > 0)
      const pace = fit(target, [hard(), 0.74, 0.6])
      if (pace !== null) return { pace, target, intent: y > 1.45 ? "smash" : "counter" }
    }
    // a hard ball below the net: absorb it into the kitchen (bangers swing anyway)
    if (rand() < lv.bang) return { pace: hard(), target: t.attack(y, false), intent: "counter" }
    return { pace: soft(0.14), target: t.drop(), intent: "reset" }
  }
  if (dist < 3.8) {
    // at the kitchen line with a low ball
    if (!oppsAtNet) return rand() < 0.5 ? { pace: soft(0.2), target: t.dink(false), intent: "dink" } : { pace: 0.45 + rand() * 0.2, target: t.deep(), intent: "drive" }
    if (crowding && rand() < lv.lob * 0.25) return { pace: soft(0.2), target: t.lob(), intent: "lob" }
    // impatience: speed up a ball that isn't up (it'll go long, or come back at you)
    const itch = dinks >= lv.patience ? lv.impatience : lv.impatience * 0.1
    if (rand() < lv.bang * 0.6 || rand() < itch) {
      // from down there: a good player rolls it at the feet (firm, topspin); a banger just
      // hits it hard, and it sails or comes back high
      const roll = rand() < (sense >= 1 ? 0.85 : sense > 0 ? 0.5 : 0.15)
      const target = roll ? t.attack(y, true, true) : t.attack(y, sense > 0)
      const pace = fit(target, roll ? [0.42 + rand() * 0.16, 0.4] : [0.62 + rand() * 0.35, 0.6])
      // (nothing lands from that low: a patient player just dinks again)
      if (pace !== null) return { pace, target, intent: roll ? "roll" : "speedup" }
    }
    return { pace: soft(), target: t.dink(), intent: "dink" }
  }
  // the transition zone or the back
  if (oppsAtNet) {
    if (rand() < lv.lob * (crowding ? 1 : 0.4)) return { pace: soft(0.2), target: t.lob(), intent: "lob" }
    if (rand() < lv.reset) return { pace: soft(), target: t.drop(), intent: "drop" }
    return { pace: hard(), target: rand() < 0.6 ? t.attack(y, false) : t.deep(), intent: "drive" }
  }
  // both sides back: a drop to come in, or a deep drive
  if (rand() < lv.drop * 0.7) return { pace: soft(0.2), target: t.drop(), intent: "drop" }
  return { pace: 0.6 + rand() * 0.35, target: t.deep(), intent: "drive" }
}

// What a team does after a shot (a: what the shot gives the other side, shots.js
// assessBall): move up behind a good soft shot, follow a drive in a step, stay at the net
export const afterShot = (m, team, kind, p, a = null) => {
  const lv = p.ctrl === "cpu" ? p.level : LEVELS.pro
  const current = m.teamDepth[team]
  const roll = m.rand()
  if (kind === "serve") m.teamDepth[team] = "back"
  else if (kind === "return") m.teamDepth[team] = roll < lv.advance ? "net" : "mid"
  else if (current === "net") return
  else if (SOFT_KINDS.has(kind)) {
    const good = !a || (!a.attackable && a.in)
    if (good) m.teamDepth[team] = roll < lv.advance ? "net" : "mid"
    else if (current === "back" && roll < lv.advance * 0.5) m.teamDepth[team] = "mid"
  } else if (current === "back" && roll < lv.advance * 0.5) m.teamDepth[team] = "mid"
}

// The serve: deep, mostly to the middle of the box, a bit of variety
export const aiServe = (m, p) => {
  const lv = p.level
  const v = m.rand()
  const variant = v < 0.1 ? "slice" : v > 0.95 ? "soft" : "drive"
  // a clone serves as deep as they really do (where their serves were returned from)
  if (lv.serveDepth) {
    const deep = clamp((lv.serveDepth - 4.5) / 2.6, 0, 1)
    return { kind: "serve", variant, aim: (m.rand() - 0.5) * 1.2, power: clamp(0.18 + deep * 0.62 + (m.rand() - 0.5) * 0.2, 0.15, 0.95) }
  }
  return { kind: "serve", variant, aim: (m.rand() - 0.5) * 1.2, power: 0.25 + m.rand() * 0.55 * (lv.bang > 0.2 ? 1.2 : 1) }
}
