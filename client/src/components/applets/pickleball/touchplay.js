// Pickleball 98 on a touch screen (pure, tested in pb7.test.js): the two control schemes and
// where their on-screen controls go.
//
// Both schemes: YOU move your player with the move pad (on the left or the right, your
// choice). Nothing ever moves your player for you (the owner's rule).
//
// - "classic": touch their court to aim (or drag), hold for pace, let go as the ball comes.
// - "swipe": put a finger down anywhere on the hit side (the paddle comes up), then swipe
//   up the screen toward where it should go and let go as the ball comes:
//     direction (left/right of straight up)  -> where across their court
//     how far up you swiped                   -> how deep (a short swipe drops it in the kitchen)
//     how fast you swiped                     -> pace (a slow swipe is soft, a quick flick hard)
//     a tap (no swipe)                        -> a soft touch shot: a dink at the line
//     a slow, long swipe up                   -> soft and deep: a lob
//   Serving: the same swipe (its speed is the serve's power, a tap a soft safe serve).

import { HALF_L, HALF_W, KITCHEN } from "./physics.js"
import { sideOf } from "./rules.js"

export const SCHEMES = ["classic", "swipe"]
export const PAD_SIDES = ["left", "right"]

export const SWIPE = {
  tapPx: 18, // moved less than this: a tap
  tapPace: 0.08,
  slow: 0.7, // screen heights a second: at or under this, the softest
  span: 2.6, // ...and this much faster is the hardest
  fullUp: 0.32, // a swipe this much of the screen's height up goes to the baseline
  maxAngle: (40 * Math.PI) / 180, // this far off straight up aims at the sideline
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// A finished swipe: points [{ x, y, t }] (screen px, ms), the stage size. Returns
// { tap, pace 0..1, u -1..1 (left..right), depth 0..1 (kitchen..baseline), speed (heights/s) }
export const readSwipe = (points, { width, height }) => {
  if (!points?.length) return { tap: true, pace: SWIPE.tapPace, u: null, depth: null, speed: 0 }
  const a = points[0]
  const z = points[points.length - 1]
  const dx = z.x - a.x
  const dy = z.y - a.y
  const dist = Math.hypot(dx, dy)
  if (dist < SWIPE.tapPx) return { tap: true, pace: SWIPE.tapPace, u: null, depth: null, speed: 0 }
  // the swipe's own time: from when the finger started moving (holding still first, paddle
  // up and waiting, isn't slowness)
  const moved = points.find((p) => Math.hypot(p.x - a.x, p.y - a.y) >= SWIPE.tapPx * 0.5) || a
  const dur = Math.max(30, z.t - moved.t)
  const speed = dist / height / (dur / 1000)
  const pace = clamp((speed - SWIPE.slow) / SWIPE.span, 0, 1)
  const up = Math.max(0, -dy)
  const angle = Math.atan2(dx, Math.max(up, height * 0.04))
  const u = clamp(angle / SWIPE.maxAngle, -1, 1)
  const depth = clamp(up / (height * SWIPE.fullUp), 0, 1)
  return { tap: false, pace, u, depth, speed }
}

// where on their court a swipe sends it: team 0 plays from +z (its camera looks toward -z,
// so the screen's right is +x); `flip` when this screen watches from team 1's end
export const swipeTarget = ({ u, depth }, { team, flip = false }) => {
  if (u === null || u === undefined) return null
  const opp = -sideOf(team)
  const near = KITCHEN * 0.55
  const far = HALF_L - 0.5
  return { x: u * (HALF_W - 0.45) * (flip ? -1 : 1), z: opp * (near + clamp(depth ?? 0.5, 0, 1) * (far - near)) }
}

// a serve from a swipe: power from its speed; a tap (or a very slow swipe) is the soft,
// safe serve; a flick past the top is over-hit
export const swipeServe = (s) => {
  if (s.tap) return { power: 0.35, grade: "early" }
  if (s.pace > 0.92) return { power: 1, grade: "late", risky: true }
  return { power: 0.4 + s.pace * 0.55, grade: s.pace < 0.2 ? "early" : s.pace > 0.45 ? "perfect" : "good" }
}

// ---- the on-screen controls ----
// fromPx: shared/controls/layout.js fromPx (passed in, so this stays free of the UI)
const MOVE_W = { portrait: 0.5, landscape: 0.42 }
const MOVE_H = { portrait: 0.4, landscape: 0.62 }

// rects in px anchors (fromPx's form) for the move pad and the hit areas
export const padRects = (side, orientation, s) => {
  const mw = Math.round(s.width * MOVE_W[orientation])
  const mh = Math.round(s.height * MOVE_H[orientation])
  const right = side === "right"
  const move = right ? { right: 0, bottom: 0, width: mw, height: mh } : { left: 0, bottom: 0, width: mw, height: mh }
  // the hit area: everything else (the side next to the pad, then the band above it)
  const hit = right ? { left: 0, bottom: 0, width: s.width - mw, height: orientation === "portrait" ? mh : s.height } : { right: 0, bottom: 0, width: s.width - mw, height: orientation === "portrait" ? mh : s.height }
  const top = orientation === "portrait" ? { left: 0, top: 0, width: s.width, height: s.height - mh } : right ? { right: 0, top: 0, width: mw, height: s.height - mh } : { left: 0, top: 0, width: mw, height: s.height - mh }
  return { move, hit, hitTop: top }
}

// the TouchControls list. The layout key differs per side, so each side keeps its own
// customized layout. (The camera and the gear are in the pause menu now: the screen keeps
// the pad, the hit area and Pause.)
export const touchControlsFor = (side, fromPx, scheme = "classic") => {
  const rect = (id) => ({
    portrait: (s) => fromPx(s, padRects(side, "portrait", s)[id]),
    landscape: (s) => fromPx(s, padRects(side, "landscape", s)[id]),
  })
  const hitLabel = scheme === "swipe" ? "Hit: swipe toward where it goes (tap = soft)" : "Hit: touch where it goes, hold for pace"
  return [
    { id: "move", label: "Move (drag)", kind: "zone", mirror: false, default: rect("move") },
    { id: "hit", action: "hit", label: hitLabel, kind: "zone", mirror: false, default: rect("hit") },
    { id: "hitTop", action: "hit", label: "Hit (aim zone)", kind: "zone", mirror: false, default: rect("hitTop") },
    // Pause stays top right (the score is top left), clear of the menu bar
    { id: "pause", label: "Pause", shape: "round", mirror: false, className: "pkShot pkShot--small", default: (s) => fromPx(s, { right: 8, top: 64, width: 40, height: 40 }) },
  ]
}
export const layoutKey = (side) => (side === "right" ? "pickleball4r" : "pickleball4")

// prefs that older saves may lack or have wrong
export const touchPrefs = (p) => ({
  scheme: SCHEMES.includes(p?.scheme) ? p.scheme : null, // null: not chosen yet (asked on first play)
  padSide: PAD_SIDES.includes(p?.padSide) ? p.padSide : "left",
})
