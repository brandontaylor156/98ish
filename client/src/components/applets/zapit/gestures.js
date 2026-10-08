// Zap It!'s gesture recognition and rules, with no DOM (tested in zapit.test.js).
//
// classify(trace) turns what fingers (or the mouse) did into a command:
//   trace = { pointers: { [id]: [{ x, y, t }...] } }  (px and ms; every pointer that touched)
// Rules, in order:
//   twist  two pointers whose line turned 30 degrees or more; or one pointer that went about
//          2/3 of the way round a circle (mouse, or one finger circling: a round path, so
//          a straight line, whose angle from its middle flips once, never counts)
// Twist it also comes from the Twist knob on screen (knobTurn) and from turning the phone
// itself like a steering wheel (twistDetector, DeviceMotion's rotationRate).
//   flick  fast and short upward (at least 40 px, under 260 ms, mostly vertical)
//   pull   a downward drag (at least 60 px, mostly vertical)
//   swipe  sideways (at least 50 px, mostly horizontal)
//   tap    short (under 350 ms) and small (under 18 px)
// Anything else is null (not a command). Shake comes from DeviceMotion (shakeDetector).

export const COMMANDS = ["tap", "swipe", "twist", "pull", "flick", "shake"]
export const LABELS = { tap: "Tap it!", swipe: "Swipe it!", twist: "Twist it!", pull: "Pull it!", flick: "Flick it!", shake: "Shake it!" }
export const KEYS = { tap: "Space", swipe: "Left / Right", twist: "T", pull: "Down", flick: "Up", shake: "S" }

const angleOf = (dx, dy) => Math.atan2(dy, dx)
const wrap = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

// how far (radians, signed) the line between two pointers turned, matching their samples by time
export const twoFingerTurn = (a, b) => {
  if (a.length < 2 || b.length < 2) return 0
  const at = (pts, t) => {
    let best = pts[0]
    for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p
    return best
  }
  const start = Math.max(a[0].t, b[0].t)
  const end = Math.min(a[a.length - 1].t, b[b.length - 1].t)
  if (end <= start) return 0
  let total = 0
  let prev = null
  const times = [...a, ...b].map((p) => p.t).filter((t) => t >= start && t <= end).sort((x, y) => x - y)
  for (const t of times) {
    const p = at(a, t)
    const q = at(b, t)
    const ang = angleOf(q.x - p.x, q.y - p.y)
    if (prev !== null) total += wrap(ang - prev)
    prev = ang
  }
  return total
}

// how far (radians, signed) one pointer went round the middle of its own path
export const circleTurn = (pts) => {
  if (pts.length < 6) return 0
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  const r = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length
  if (r < 18) return 0
  // round enough: the points keep roughly the same distance from the middle
  const spread = pts.reduce((s, p) => s + Math.abs(Math.hypot(p.x - cx, p.y - cy) - r), 0) / pts.length / r
  if (spread > 0.45) return 0
  let total = 0
  for (let i = 1; i < pts.length; i++) total += wrap(angleOf(pts[i].x - cx, pts[i].y - cy) - angleOf(pts[i - 1].x - cx, pts[i - 1].y - cy))
  return total
}

export const classify = (trace) => {
  const lists = Object.values(trace?.pointers || {}).filter((l) => l && l.length)
  if (!lists.length) return null
  if (lists.length >= 2) {
    const [a, b] = lists.sort((x, y) => y.length - x.length)
    return Math.abs(twoFingerTurn(a, b)) >= (30 * Math.PI) / 180 ? "twist" : null
  }
  const pts = lists[0]
  const first = pts[0]
  const last = pts[pts.length - 1]
  const dx = last.x - first.x
  const dy = last.y - first.y
  const dist = Math.hypot(dx, dy)
  const ms = last.t - first.t
  let travel = 0
  for (let i = 1; i < pts.length; i++) travel += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  if (Math.abs(circleTurn(pts)) >= Math.PI * 1.25 && travel > 110) return "twist"
  const vertical = Math.abs(dy) > Math.abs(dx) * 1.4
  const horizontal = Math.abs(dx) > Math.abs(dy) * 1.4
  if (vertical && dy < -40 && ms < 260) return "flick"
  if (vertical && dy > 60) return "pull"
  if (horizontal && Math.abs(dx) > 50) return "swipe"
  if (ms < 350 && travel < 18) return "tap"
  // a slow upward drag counts as a flick too (people often drag rather than flick)
  if (vertical && dy < -90) return "flick"
  return null
}

// Shake: the acceleration (without gravity when the device gives it) going over a threshold
// a few times within a short window. feed(sample) -> true when a shake is recognized.
export const shakeDetector = ({ threshold = 14, peaks = 3, windowMs = 900 } = {}) => {
  let hits = []
  let lastSign = 0
  return {
    feed: ({ x = 0, y = 0, z = 0, t, gravity = false }) => {
      const m = Math.hypot(x, y, z) - (gravity ? 9.81 : 0)
      const main = Math.abs(x) >= Math.abs(y) ? x : y
      const sign = Math.sign(main)
      if (Math.abs(m) >= threshold && sign && sign !== lastSign) {
        hits.push(t)
        lastSign = sign
      }
      hits = hits.filter((h) => t - h <= windowMs)
      if (hits.length >= peaks) {
        hits = []
        lastSign = 0
        return true
      }
      return false
    },
    reset: () => {
      hits = []
      lastSign = 0
    },
  }
}

// How far (degrees, signed) a finger dragged round a knob centered at (cx, cy) has turned it
export const knobTurn = (pts, cx, cy) => {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += wrap(angleOf(pts[i].x - cx, pts[i].y - cy) - angleOf(pts[i - 1].x - cx, pts[i - 1].y - cy))
  return (total * 180) / Math.PI
}
export const KNOB_DEGREES = 70 // turning the on-screen knob this far is a twist

// Twist the phone: turning it like a steering wheel or a jar lid (rotation about the axis
// through the screen: DeviceMotion's rotationRate.alpha, degrees a second). feed({ rate, t })
// -> true once it has turned `degrees` within `windowMs` (either way)
export const twistDetector = ({ degrees = 45, windowMs = 700 } = {}) => {
  let samples = []
  let lastT = null
  return {
    feed: ({ rate = 0, t }) => {
      const dt = lastT === null ? 0 : Math.min(0.1, Math.max(0, (t - lastT) / 1000))
      lastT = t
      samples.push({ t, d: (rate || 0) * dt })
      samples = samples.filter((s) => t - s.t <= windowMs)
      const turned = samples.reduce((sum, s) => sum + s.d, 0)
      if (Math.abs(turned) >= degrees) {
        samples = []
        return true
      }
      return false
    },
    reset: () => {
      samples = []
      lastT = null
    },
  }
}

// ---- the game: commands on a beat ----
// beat (ms between commands): 1700 to start, 7% quicker every 5 right, never under 650
export const beatFor = (score) => Math.max(650, Math.round(1700 * Math.pow(0.93, Math.floor(score / 5))))

export const newRound = ({ random = Math.random, shake = false, first = "tap" } = {}) => ({ score: 0, command: first, last: null, over: false, random, shake, streak: 0, reason: null })

// the next command: never the same three times running; Shake only when motion works
export const nextCommand = (state) => {
  const pool = COMMANDS.filter((c) => c !== "shake" || state.shake)
  const i = Math.floor(state.random() * pool.length) % pool.length
  const c = pool[i]
  return c === state.command && c === state.last ? pool[(i + 1) % pool.length] : c
}

// the player did something (a command, from classify, a key or a shake)
export const act = (state, did) => {
  if (state.over) return { state, right: false }
  if (did === state.command) {
    const score = state.score + 1
    return { state: { ...state, score, last: state.command, command: nextCommand(state) }, right: true }
  }
  return { state: { ...state, over: true, reason: `wrong:${did}` }, right: false }
}
// the beat ran out before the command was done
export const timeout = (state) => (state.over ? state : { ...state, over: true, reason: "late" })
