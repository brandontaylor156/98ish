// Pickleball 98: how pros move, as numbers and small rules. Pure JavaScript (no three.js),
// tested in Node (pro.test.js). anim.js, strokes.js and locomotion.js read these; the match
// (physics, rules, AI) never does, so this is presentation only and online play stays in sync.
//
// Where the numbers come from: docs/pickleball-movement.md (coaching material, analyses of the
// two best players in the world, a right-handed all-court player with a one-handed backhand
// and a right-handed player with a two-handed backhand, plus pickleball biomechanics papers).
// In short:
// - Ready at the kitchen line: feet a little wider than the shoulders, weight on the balls of
//   the feet, knees bent about 35-45 degrees, hips pushed back and the chest over the knees
//   (the back about parallel to the shins), the paddle out in front between the waist and the
//   chest, tip up toward the backhand side (11 o'clock for a right-hander), elbows bent and in
//   front of the body. Two-handers hold it a little higher, feet a little wider.
// - Split step: a small two-footed hop (a few cm), landing as the other side hits, a little
//   wider, the hips dropping 5-10 cm on the landing.
// - At the kitchen line: small quick adjustment steps and shuffles (feet never cross); a
//   crossover step (hips open, shoulders kept to the net) for a wide ball; a lunge (front knee
//   bent, back leg long) for a low wide dink, then back to the line.
// - Strokes: dinks from the shoulder with soft knees and a quiet wrist; compact take-backs on
//   drives, speed-ups and punches; hips and shoulders turn together with weight moving onto
//   the front foot; quick resets to the ready position after every shot.
//
// Everything is for a right-handed player in the body frame (x right, y up, z forward);
// anim.js mirrors x for left-handers.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

// ---- the two playing styles (the Locker Room's "Pro style") ----
// allcourt: compact, one-handed backhand, the paddle carried between the waist and the chest
// twohand: aggressive two-handed backhand (drives, dinks, counters), the paddle a little higher,
// feet a little wider, quicker resets in hand battles
export const PRO_STYLES = ["allcourt", "twohand"]
export const styleOf = (look) => (look && look.backhand === "two" ? "twohand" : "allcourt")
export const handOf = (look) => (look && look.plays === "left" ? -1 : 1)

// ---- the ready position ----
// crouch: how far the pelvis drops below standing (m); lean: the trunk's forward bend (rad from
// vertical); back: the hips pushed back behind the feet (m); stance: half the distance between
// the ankles (m); hand: the paddle hand (wrist) for the standard posture (shoulders 1.3 m up and
// 0.1 m ahead of the feet; anim.js moves it with the real one); tip: the paddle's direction
export const READY = {
  net: {
    allcourt: { crouch: 0.068, lean: 0.42, back: 0.07, stance: 0.25, hand: { x: 0.07, y: 1.02, z: 0.38 }, tip: { x: -0.32, y: 0.62, z: 0.72 } },
    twohand: { crouch: 0.075, lean: 0.4, back: 0.07, stance: 0.28, hand: { x: 0.05, y: 1.1, z: 0.38 }, tip: { x: -0.28, y: 0.7, z: 0.66 } },
  },
  base: {
    allcourt: { crouch: 0.05, lean: 0.34, back: 0.05, stance: 0.24, hand: { x: 0.08, y: 1.0, z: 0.37 }, tip: { x: -0.25, y: 0.6, z: 0.76 } },
    twohand: { crouch: 0.055, lean: 0.33, back: 0.05, stance: 0.26, hand: { x: 0.06, y: 1.06, z: 0.37 }, tip: { x: -0.22, y: 0.66, z: 0.72 } },
  },
  between: { crouch: 0.03, lean: 0.06, back: 0, stance: 0.15 },
}
export const readyFor = (style, atNet) => READY[atNet ? "net" : "base"][style === "twohand" ? "twohand" : "allcourt"]

// ---- the split step ----
// lead: the hop leaves the court this long before the other side's contact, so it lands on it;
// dur: the whole move (hop, landing, sinking and coming back up); up: the hop's height; sink:
// how far the hips drop on the landing; wider: how much wider the feet land (each side)
export const SPLIT = { lead: 0.13, dur: 0.36, up: 0.03, sink: 0.06, wider: 0.03, again: 0.55 }
// should a player split now? oppHit: seconds until the other side hits (null if not known);
// since: seconds since this player's last split
export const shouldSplit = (oppHit, since) => oppHit !== null && oppHit !== undefined && oppHit <= SPLIT.lead && oppHit > -0.04 && since > SPLIT.again
// the pelvis's rise and fall through a split step (m) at e seconds after the hop starts
export const splitHeight = (e) => {
  if (e < 0 || e > SPLIT.dur) return 0
  if (e < SPLIT.lead) return Math.sin((e / SPLIT.lead) * Math.PI) * SPLIT.up
  return -Math.sin(((e - SPLIT.lead) / (SPLIT.dur - SPLIT.lead)) * Math.PI) * SPLIT.sink
}

// ---- footwork choice ----
// How a player moves sideways: shuffle (small side steps facing the net, feet never cross) or
// a crossover (hips open toward the ball, the back foot crossing in front, shoulders kept
// toward the net) when the move is fast and far enough that shuffles can't keep up.
// lat: sideways speed (m/s, + to the right), fwd: forward speed, dist: how far there is still to
// go sideways (m, null if unknown), prev: last frame's choice
export const CROSS = { on: 2.1, off: 1.4, dist: 0.9, hip: 0.75, chest: 0.55 }
export const footworkFor = ({ lat = 0, fwd = 0, dist = null, prev = "shuffle", between = false }) => {
  if (between) return "shuffle"
  const sideways = Math.abs(lat) > Math.abs(fwd) * 1.2
  if (prev === "cross") return Math.abs(lat) > CROSS.off && sideways && (dist === null || dist > 0.35) ? "cross" : "shuffle"
  return Math.abs(lat) > CROSS.on && sideways && (dist === null || dist > CROSS.dist) ? "cross" : "shuffle"
}

// ---- quick feet near the kitchen ----
// cadence multiplier for slow moves at the net: small, quick adjustment steps instead of strides
export const quickSteps = (speed, atNet) => (atNet ? 1 + 0.5 * (1 - smooth(1.0, 2.2, speed)) : 1)

// ---- the lunge ----
// A ball low and wide (or low and far in front): step out with the near foot, bend that knee,
// keep the back leg long, hips toward the front foot, trunk fairly upright.
// lc: the contact in the body frame (x right, z forward), y: its height
// Returns null (no lunge), or { foot (0 left, 1 right), spot {x, z} (body frame), depth 0..1,
// crouch (m), shift (the pelvis toward the front foot, m, body frame x), lean, roll }
export const LUNGE = { side: 0.6, front: 0.75, low: 0.8, maxOut: 0.8, crouch: 0.2 }
export const lungePlan = (lc, y) => {
  const out = Math.abs(lc.x) - LUNGE.side
  const ahead = lc.z - LUNGE.front
  const low = y < LUNGE.low
  if (out <= 0 && !(ahead > 0 && low)) return null
  const depth = clamp(Math.max(out / 0.5, ahead / 0.5, 0) * (low ? 1 : 0.6), 0, 1)
  if (depth <= 0.02) return null
  const sx = Math.abs(lc.x) > 0.25 ? Math.sign(lc.x) : 0
  const foot = sx > 0 ? 1 : sx < 0 ? 0 : 1
  // (a low ball: a long lunge; a ball at the waist or higher: a step out)
  const out1 = low ? LUNGE.maxOut : 0.55
  const spot = { x: clamp(lc.x * (low ? 0.8 : 0.6), -out1, out1), z: clamp(lc.z * 0.55 - 0.05, -0.3, 0.55) }
  return {
    foot,
    spot,
    depth,
    crouch: LUNGE.crouch * depth * (low ? 1 : 0.5),
    shift: spot.x * 0.75 * Math.min(1, depth * 1.6),
    shiftZ: Math.max(0, spot.z) * 0.35 * depth,
    lean: 0.1 * depth,
    roll: Math.sign(lc.x) * Math.min(0.2, depth * 0.25),
  }
}

// ---- stepping into the ball ----
// A drive, lob or serve from a standstill: the front foot steps toward the target as the
// weight goes forward (a forehand steps with the foot on the other side from the paddle, a
// backhand with the paddle-side foot). side: +1 forehand, -1 backhand (right-handed frame)
export const stepIn = (style, side, lc, speed) => {
  if (speed > 0.9) return null
  if (!(style === "drive" || style === "lob" || style === "serve" || style === "slice")) return null
  const foot = side > 0 ? 0 : 1 // right-handed: forehand -> left foot, backhand -> right foot
  const across = side > 0 ? -0.12 : 0.12
  return { foot, spot: { x: clamp(lc.x * 0.25 + across, -0.35, 0.35), z: 0.3 } }
}

// ---- weight transfer ----
// where the hips are (m, forward of their place) through a stroke: back a little on the
// take-back, onto the front foot through contact and the follow-through
export const WEIGHT = { drive: [-0.05, 0.07], lob: [-0.04, 0.05], slice: [-0.04, 0.06], serve: [-0.06, 0.08], punch: [-0.015, 0.035], block: [0, 0.02], dink: [-0.01, 0.03], overhead: [-0.06, 0.07] }
export const weightFor = (style, phase, u = 1) => {
  const w = WEIGHT[style]
  if (!w) return 0
  if (phase === "wind") return w[0] * u
  if (phase === "forward" || phase === "contact") return w[0] + (w[1] - w[0]) * u
  if (phase === "after") return w[1] * u
  return 0
}
