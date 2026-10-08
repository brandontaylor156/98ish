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

import { HALF_L, HALF_W, KITCHEN, NET_H_CENTER, NET_POST_X, len, predictPath } from "./physics.js"
import { FOOT_R, inKitchen, rightSign, sideOf } from "./rules.js"
import { FAST_BALL, SOFT_KINDS, planIntent, solveDrive } from "./shots.js"

// Per level:
//   speed m/s on court; reaction s before moving to a new ball (a split step's worth at the
//   top: human, not superhuman); sigma m of aim scatter; face rad of paddle-angle wobble;
//   touch: relative error in how hard the face pushes; offset m off the sweet spot; judge:
//   lets a ball go if it lands this far out; softTouch m: how shaky a dink's touch is (played
//   as face angle and push: shots.js wobble; low = into the net, high or long = attackable);
//   dropTouch: the same for drops and resets from farther back; power: how hard their hard
//   balls are (pros drive 45-60 mph, club players ~40, beginners ~30); serve: their serve's
//   pace (0..1) and how deep they aim it; drop: chance of a third-shot drop on a neutral
//   return (a short or high return gets driven: ai.js thirdShot); reset: chance of playing
//   soft from the transition zone against net players; bang: chance of just hitting hard;
//   patience: dinks before they get itchy; impatience: chance of speeding up a ball that
//   isn't up, once itchy; attack: m above the net a ball must be met before they attack it;
//   hands: s they need to react to a hard ball at the net (less and they're late); counter:
//   chance of countering (vs. blocking) a hard ball met above the net; lob: chance of a
//   surprise lob; advance: chance of moving up after a good soft shot; timing: chance of a
//   perfect / good swing; stack: chance a computer team stacks (keeps its forehands in the
//   middle); poach: how keen the net player is to take a floater in the partner's half; erne:
//   chance of going round the kitchen for an Erne when a ball comes down the line.
// Levels differ the way real players do: consistency (face, touch), decisions (patience,
// what they attack, drop or drive) and shot quality (power, depth), not superhuman speed.
const COMMON = { serveWait: 0.85, maxY: 1.95, power: 1, serve: 0.6, stack: 0, poach: 0, erne: 0 }
export const LEVELS = {
  beginner: {
    ...COMMON,
    label: "Rookie",
    speed: 3.2,
    reaction: 0.3,
    sigma: 0.45,
    face: 0.03,
    touch: 0.09,
    offset: 0.04,
    judge: 0.9,
    softTouch: 0.26,
    dropTouch: 0.36,
    drop: 0.15,
    reset: 0.2,
    bang: 0.4,
    patience: 1,
    impatience: 0.45,
    attack: -0.2,
    hands: 0.42,
    counter: 0.4,
    lob: 0.05,
    advance: 0.45,
    timing: [0.12, 0.45],
    serveWait: 1.1,
    maxY: 1.7,
    power: 0.8,
    serve: 0.3,
    attackH: 0.4,
  },
  intermediate: {
    ...COMMON,
    label: "Club",
    speed: 3.7,
    reaction: 0.22,
    sigma: 0.32,
    face: 0.02,
    touch: 0.06,
    offset: 0.024,
    judge: 0.4,
    softTouch: 0.14,
    dropTouch: 0.17,
    drop: 0.55,
    reset: 0.5,
    bang: 0.08,
    patience: 3,
    impatience: 0.3,
    attack: 0.02,
    hands: 0.3,
    counter: 0.5,
    lob: 0.04,
    advance: 0.85,
    timing: [0.3, 0.5],
    power: 0.92,
    serve: 0.5,
    poach: 0.3,
    attackH: 0.55,
  },
  pro: {
    ...COMMON,
    label: "Pro",
    speed: 4.1,
    reaction: 0.2,
    sigma: 0.2,
    face: 0.011,
    touch: 0.04,
    offset: 0.012,
    judge: 0.15,
    softTouch: 0.062,
    dropTouch: 0.1,
    drop: 0.5,
    reset: 0.85,
    bang: 0,
    patience: 2,
    impatience: 0.4,
    attack: 0.01,
    sense: 1,
    hands: 0.22,
    counter: 0.65,
    lob: 0.03,
    advance: 1,
    timing: [0.5, 0.42],
    serveWait: 0.7,
    maxY: 2.3, // (an overhead jumps for it: pro.js overheadLift)
    power: 1,
    serve: 0.72,
    stack: 0.6,
    poach: 0.7,
    erne: 0.25,
    attackH: 0.5,
  },
  legend: {
    ...COMMON,
    label: "Legend",
    speed: 4.25,
    reaction: 0.18,
    sigma: 0.16,
    face: 0.009,
    touch: 0.032,
    offset: 0.008,
    judge: 0.1,
    softTouch: 0.055,
    dropTouch: 0.085,
    drop: 0.5,
    reset: 0.85,
    bang: 0,
    patience: 2,
    impatience: 0.5,
    attack: -0.01,
    sense: 1,
    hands: 0.23, // (0.2 -> 0.23: Legend doubles rallies ran 12.1-12.3 shots over 48 games vs PPA 10.7)
    counter: 0.75,
    lob: 0.03,
    advance: 1,
    timing: [0.65, 0.32],
    serveWait: 0.6,
    maxY: 2.35,
    power: 1.05,
    serve: 0.8,
    stack: 0.7,
    poach: 0.8,
    erne: 0.4,
    attackH: 0.48,
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
// the transition zone where a team coming in from the baseline in stages splits before going on
export const STEP_Z = 3.3
const LINE_Z = KITCHEN + FOOT_R + 0.07 // toes on the line (and not in the kitchen)
const LUNGE = 0.95 // m forward a player at the line reaches for a volley over the kitchen

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const bouncesNow = (m) => m.rally.bounces + (m.held?.length || 0)

// Where a player waits when the ball isn't theirs to hit. Partners move as a unit (one
// depth per team), each covering their half, both drifting toward the ball.
// SHADE: how far a doubles team shifts with the ball across the court (of its x). Pros move
// with the ball as if tied by a rope, so they are still moving as the other side hits (PPA
// footage, the feet tracked the same way: 0.76 m/s at the kitchen line at the far contact;
// 0.3 gave the game 0.51, 0.42 gives 0.66 with rally length and bursts unchanged; 0.45 made
// Pro rallies a shot longer: docs/pickleball-log.md "Athletes, round 2")
export const SHADE = 0.42
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
    depth = m.teamDepth[p.team] === "net" ? lv.stanceNet ?? NET_LINE : m.teamDepth[p.team] === "mid" ? 4.3 : m.teamDepth[p.team] === "step" ? STEP_Z : lv.stanceBack ?? BASE_LINE - 0.1
  }
  // until their side has played its first shot, partners hold where they set up for the serve
  // (a stacked partner waits off the court; nobody wanders across the serve's path)
  const first = servingTeam ? r.hits < 1 : r.hits < 2
  if (first && m.game.doubles && p.spot && p.id !== r.receiver && p.id !== r.server) return { x: p.spot.x, z: p.spot.z }
  const ballX = m.ball.p.x
  let x
  if (m.game.doubles) {
    const lane = p.lane === "right" ? 1 : -1
    x = rs * lane * 1.4 + clamp(ballX, -HALF_W, HALF_W) * SHADE
  } else {
    x = clamp(ballX, -HALF_W, HALF_W) * 0.45
  }
  return { x, z: side * depth }
}

// Every way a player could meet the ball on its predicted path; returns the one they'd
// pick (or the least-bad one if they can't make any). null if they'd let it go.
export const interceptFor = (m, p, path, { speed, reaction, judge = 0.2, maxY = 2, erne = 0 }) => {
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
    // (but a ball going out that would hit you on the way still loses you the point: one
    // coming at the body gets played)
    const atBody = path.some((s) => s.bounces === 0 && s.t > 0.05 && s.y < 1.6 && Math.hypot(s.x - p.x, s.z - p.z) < 0.6)
    // (and a fast ball is harder to read: the faster it comes, the surer they must be)
    const speed = Math.hypot(m.ball.v.x, m.ball.v.y, m.ball.v.z)
    if (outBy > judge + Math.max(0, speed - 8) * 0.03 && !atBody) return { letGo: true }
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
    let sx = s.x + (p.x >= s.x ? STAND_SIDE : -STAND_SIDE)
    let sz = s.z + side * STAND_BACK
    let lunge = false
    let ernie = false
    if (volley && inKitchen(sx, sz)) {
      // an Erne: a ball coming down the line over the kitchen, taken out of the air from just
      // outside the sideline, level with the kitchen (legal: the feet are off the court, not
      // in the non-volley zone, which only runs sideline to sideline)
      if (erne > 0 && Math.abs(s.x) > HALF_W - 0.55 && Math.abs(s.z) < KITCHEN && s.y > 0.3 && s.y < 1.4) {
        sx = Math.sign(s.x) * (HALF_W + FOOT_R + 0.22)
        sz = s.z + side * 0.05
        ernie = true
      } else {
        // a volley over the kitchen: toes on the line, reaching forward for it
        if (Math.abs(s.z) < LINE_Z - LUNGE) continue
        sz = side * LINE_Z
        lunge = true
      }
    }
    const dist = Math.hypot(sx - p.x, sz - p.z)
    const need = reaction + Math.max(0, dist - 0.25) / speed
    const slack = s.t - need
    if (!fallback || slack > fallback.slack) fallback = { ...s, stand: { x: sx, z: sz }, volley, slack, lunge }
    if (slack < 0) continue
    // at the net: meet it as high as it gets (a ball up there can be hit down); take high
    // ones out of the air. From the back: a comfortable height after the bounce.
    let cost
    if (volley) cost = nearNet ? s.t * 0.4 + (s.y < 0.45 ? 0.7 : 0) - (s.y > 0.95 ? 0.6 + (s.y - 0.95) : 0) + (lunge ? 0.15 : 0) + (ernie ? 0.9 - erne : 0) : 0.9 + s.t
    else cost = nearNet ? Math.max(0, 0.95 - s.y) + s.t * 0.2 : Math.abs(s.y - 0.75) + s.t * 0.25
    if (!best || cost < best.cost) best = { ...s, stand: { x: sx, z: sz }, volley, slack, cost, lunge, erne: ernie }
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
  const path = predictPath({ p: ball.p, v: ball.v, w: ball.w, kind: ball.kind }, { maxT: 3.2, every: 1 / 60, maxBounces: 2 })
  let pick = null
  let letGo = false
  const each = {}
  for (const p of m.players.filter((q) => q.team === team)) {
    const lv = levelOf(m, p)
    const plan = interceptFor(m, p, path, lv)
    each[p.id] = plan
    if (!plan) continue
    // (going out: let it go, unless it's coming at someone's body: that player plays it)
    if (plan.letGo) {
      letGo = true
      continue
    }
    // doubles: each player covers their own half; a little bias to the one whose half it is
    let score = plan.late ? 10 - plan.slack : -plan.slack * 0.4 + (plan.cost || 0)
    let poach = false
    if (m.game.doubles) {
      const mine = Math.sign(plan.x * rightSign(team)) === (p.lane === "right" ? 1 : -1)
      if (!mine && Math.abs(plan.x) > 0.3) {
        score += 0.8
        // a poach: the net player crosses to put away a floater in the partner's half
        if (plan.volley && plan.y > NET_H_CENTER - 0.05 && Math.abs(p.z) < 3.4 && (lv.poach || 0) > 0) {
          score -= 1.2 * lv.poach
          poach = true
        }
      }
      // a ball down the middle: the player whose forehand is in the middle takes it
      else if (middleForehand(p, plan.x)) score -= 0.15
      // a person's half is theirs: the computer partner leaves it alone
      if (p.ctrl !== "cpu" && !m.autoplay) score = mine || Math.abs(plan.x) <= 0.3 ? -100 : score + 0.5
    }
    if (!pick || score < pick.score) pick = { ...plan, player: p.id, score, poach }
  }
  if (letGo && !pick) return { letGo: true, path, each }
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
      return { x: cx(-hitX * 0.3 + (rand() - 0.5) * 1.6), z: opp * (1.5 + rand() * 0.55) }
    },
    // deep: returns and drives from the back
    deep() {
      // (the across draw comes first, as it always has: seeded matches stay the same)
      const x = cx(middle() + (rand() - 0.5) * 1.6)
      const want = p.level?.deepZ
      // (players without full shot sense leave themselves more room behind the baseline)
      const margin = (1 - senseOf(p.level || {})) * 0.6
      const z = want ? clamp(want + (rand() - 0.5) * 1.0, 3.6, HALF_L - 0.3) : HALF_L - 0.9 - margin - rand() * 1.2
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
    // a put-away through the gap between them (doubles), or into the open court
    gap() {
      if (opps.length < 2) {
        const q = opps[0]
        return { x: cx(-Math.sign(q.x || 0.01) * (HALF_W - 0.6)), z: opp * clamp(Math.abs(q.z) + 0.6, 2.4, HALF_L - 0.6) }
      }
      const z = (Math.abs(opps[0].z) + Math.abs(opps[1].z)) / 2
      return { x: cx(middle() + (rand() - 0.5) * 0.4), z: opp * clamp(z + 0.4, 2.4, HALF_L - 0.6) }
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
export const paceThatFits = (p, at, target, paces, { shotNo = 4, volley = false, power = 1, bodies = null } = {}) => {
  for (const pace of paces) {
    // (the shot it would really be: a volley at the net is played differently from a ball
    // off the bounce, and their own power counts)
    const plan = planIntent({ team: p.team, from: at.p, incoming: at.v, target, pace, shotNo, volley })
    const mode = plan.mode.speed !== undefined ? { speed: plan.mode.speed * power } : plan.mode
    const s = solveDrive(at.p, plan.target, { ...mode, spin: plan.spin, minClear: plan.minClear, kind: at.kind })
    if (Math.abs(s.landing.z) < HALF_L - 0.35 && Math.abs(s.landing.x) < HALF_W - 0.1) return pace
    // (a ball at someone's body doesn't have to land in: they have to play it or wear it;
    // that's how pros speed up from below the tape)
    if (bodies && s.clearance !== null && s.clearance > 0.03 && atABody(at, s, bodies)) return pace
  }
  return null
}

// does this launch pass through one of these players' bodies (hip to shoulder) before it lands?
const atABody = (at, s, bodies) => {
  const path = predictPath({ p: at.p, v: s.v, w: s.w, kind: at.kind }, { maxT: 1.2, every: 1 / 120, maxBounces: 1 })
  for (const q of path) {
    if (q.bounces > 0) return false
    if (q.y < 0.5 || q.y > 1.5) continue
    for (const b of bodies) if (Math.hypot(q.x - b.x, q.z - b.z) < 0.3) return true
  }
  return false
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
  const ctx = { shotNo, volley: shotNo > 2 && r.bounces + (m.held?.length || 0) === 0, power: lv.power ?? 1, bodies: sense >= 1 ? opps.filter((q) => Math.abs(q.z) < 4.5).map((q) => ({ x: q.x, z: q.z })) : null }
  const fit = (target, paces) => {
    if (!wise) return paces[0]
    const pace = paceThatFits(p, ball, target, paces, ctx)
    if (pace !== null) return pace
    // (or a little deeper: through them rather than at their feet)
    const deeper = { x: target.x, z: Math.sign(target.z) * Math.min(HALF_L - 0.6, Math.abs(target.z) + 1.4) }
    const pace2 = paceThatFits(p, ball, deeper, paces, ctx)
    if (pace2 !== null) Object.assign(target, deeper)
    return pace2
  }

  // ---- the return (shot 2): deep, unhurried, with a little topspin, so the returner has
  // time to get to the kitchen line (deep returns win ~70% of rallies at 3.5+; Gandhi 2024)
  if (shotNo === 2) return { pace: 0.45 + rand() * 0.18, target: t.deep(), intent: "return" }
  // ---- the third shot: drop or drive by situation. Pros drop a little over half the time
  // on a neutral, deep return (PPA stats wraps: 42-80% drops by match, ~34% drives overall)
  // and drive a short or sitting return, or one the returner hasn't followed in on.
  if (shotNo === 3) {
    const shortReturn = dist < HALF_L - 2.2
    const sitting = y > 0.85
    const notIn = !oppsAtNet
    let drive = 1 - lv.drop
    if (sitting) drive += 0.25
    if (shortReturn) drive += 0.2
    if (notIn) drive += 0.2
    if (y < 0.45) drive -= 0.2
    if (rand() >= drive) return { pace: soft(0.22), target: t.drop(), intent: "drop" }
    const target = rand() < 0.55 ? t.attack(y, sense > 0) : t.deep()
    const pace = fit(target, [0.7 + rand() * 0.25, 0.68]) ?? 0.66
    return { pace, target, intent: "drive" }
  }
  // ---- the fifth shot after a third-shot drive: the drive drew a block or a volley; now
  // drop it in and follow (pros: 66% drops, 31% firm volleys; PPA "Third shot drives: what
  // happens next", 2024) unless it sits up
  if (shotNo === 5 && r.third === "drive" && dist > 3.4 && !fast) {
    if (above > 0.15 && rand() < 0.6) {
      const target = t.attack(y, sense > 0)
      const pace = fit(target, [0.7 + rand() * 0.2, 0.6])
      if (pace !== null) return { pace, target, intent: "drive" }
    }
    if (rand() < 0.68 + (sense - 0.5) * 0.2) return { pace: soft(0.18), target: t.drop(), intent: "drop" }
  }
  // around the post (ATP): a ball pulled out wide past the net post, met low near the net,
  // can go round the outside of the post at any height (rule 13.C), down their sideline
  if (Math.abs(ball.p.x) > NET_POST_X + 0.1 && dist < 3.6 && !fast && rand() < (lv.erne || 0) * 1.5) {
    const sx = Math.sign(ball.p.x)
    const target = { x: sx * (HALF_W - 0.35 - rand() * 0.4), z: -sideOf(p.team) * (KITCHEN + 0.6 + rand() * 1.4) }
    return { pace: 0.45 + rand() * 0.25, target, intent: "atp" }
  }
  // a ball met above the net, near it: attack (at the body, or put it away)
  if (!fast && above > lv.attack && dist < 5.5) {
    // high enough to hit down: put it away at the feet or through the middle; otherwise at the
    // paddle-side hip (pros' favorite speed-up target)
    const high = y > 1.05
    const target = high ? (rand() < 0.5 ? t.gap() : t.attack(y, sense > 0, true)) : t.attack(y, sense > 0)
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
    // (against a ball machine it's a drill: keep dinking unless the ball is really up)
    const drilling = opps.every((q) => q.ctrl === "feeder")
    if (crowding && !drilling && rand() < lv.lob * 0.25) return { pace: soft(0.2), target: t.lob(), intent: "lob" }
    // The dink battle: wait for a ball you can attack. Pros start attacking a dink they meet
    // at about thigh height (a roll volley or a flick at the hip from below the tape, a
    // speed-up from above it), a little lower once they're itchy (patience, impatience);
    // beginners attack anything, badly. A dink at the ankles just gets dinked again.
    const itchy = dinks >= lv.patience
    const thr = (lv.attackH ?? 0.7) - (itchy ? lv.impatience * 0.25 : 0)
    const want = drilling ? 0 : clamp((y - thr) / 0.15, 0, 1) * (itchy ? 1 : 0.6)
    if (rand() < lv.bang * 0.6 || rand() < want) {
      const roll = y < NET_H_CENTER - 0.04 && rand() < (sense >= 1 ? 0.45 : sense > 0 ? 0.5 : 0.15)
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
    // stuck in the middle against net players: reset it into the kitchen (pros mostly do)
    // unless the ball sits up, then drive it at them
    if (above > 0.2 && rand() < 0.5) {
      const target = t.attack(y, sense > 0)
      const pace = fit(target, [hard(), 0.7])
      if (pace !== null) return { pace, target, intent: "drive" }
    }
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
  const stage = m.teamStage || (m.teamStage = [null, null])
  // a team moving up in stages takes its next step as the other side plays a soft ball (a
  // split step in the transition zone, then on to the line); a hard one holds them there
  const other = 1 - team
  if (stage[other]) {
    if (SOFT_KINDS.has(kind)) m.teamDepth[other] = stage[other]
    stage[other] = null
  }
  const current = m.teamDepth[team]
  const roll = m.rand()
  if (kind === "serve") m.teamDepth[team] = "back"
  else if (kind === "return") m.teamDepth[team] = roll < lv.advance ? "net" : "mid"
  else if (current === "net") return
  else if (SOFT_KINDS.has(kind)) {
    const good = !a || (!a.attackable && a.in)
    if (good) {
      const to = roll < lv.advance ? "net" : "mid"
      // from the baseline pros come in in stages: up to the transition zone behind their
      // drop, a split step as the other side plays it, then on to the line (PPA footage: the
      // serving team reaches the kitchen line ~4.9 s after the serve, the returners 1.6 s
      // after the return; docs/ppa-reference.md)
      if (m.game?.doubles && current === "back" && to === "net") {
        m.teamDepth[team] = "step"
        stage[team] = "net"
      } else m.teamDepth[team] = to
    } else if (current === "back" && roll < lv.advance * 0.5) m.teamDepth[team] = "mid"
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
  // deep and firm at the top (serve), softer and safer lower down; a banger goes for it
  const base = (lv.serve ?? 0.5) + (lv.bang > 0.2 ? 0.15 : 0)
  return { kind: "serve", variant, aim: (m.rand() - 0.5) * 1.2, power: clamp(base + (m.rand() - 0.5) * 0.3, 0.12, 1) }
}
