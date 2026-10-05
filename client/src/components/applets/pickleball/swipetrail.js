// The swipe trail (pure, tested in swipetrail.test.js): the path your finger just made,
// drawn on the screen over the court. Swipe: a smooth stroke that follows the finger, thin
// at its start and full at the fingertip, fading out over 0.4 s after you lift, in the
// color of the shot it made (soft / firm / hard, a lob). Classic: a small ripple where you
// touch, and another, colored by the pace you held, where you let go.
// (The owner, after pb7's ball-path arc: "I wanted the path of the SWIPE that I just made.")

import { HARD_MIN, SOFT_MAX } from "./shots.js"

export const TRAIL = {
  life: 0.4, // s: the fade after the finger lifts
  minStep: 3, // px: closer points than this are dropped (a still finger adds nothing)
  maxPts: 120,
  width: 12, // px at the fingertip
  taper: 0.18, // the start's share of the width
  step: 5, // px between points of the smoothed path
  rippleLife: 0.45,
  rippleR0: 5,
  rippleR1: 34,
}

// the game's shot colors (the same as the pace meter and the old aim ring)
export const SHOT_COLORS = {
  soft: "#7cf0ff",
  firm: "#ffe066",
  hard: "#ff9a3c",
  lob: "#c9a2ff",
  touch: "#ffffff",
  miss: "#b8c2cc",
}

const SOFT_KINDS = new Set(["dink", "drop", "reset", "block"])
const HARD_KINDS = new Set(["drive", "speedup", "smash"])
// a hit's kind (shots.js KINDS) to a trail color
export const colorForKind = (kind) => (kind === "lob" ? SHOT_COLORS.lob : SOFT_KINDS.has(kind) ? SHOT_COLORS.soft : HARD_KINDS.has(kind) ? SHOT_COLORS.hard : kind ? SHOT_COLORS.firm : SHOT_COLORS.touch)
// a pace 0..1 to its band and color
export const bandOf = (pace) => (pace < SOFT_MAX ? "soft" : pace >= HARD_MIN ? "hard" : "firm")

// what a finished swipe (touchplay.js readSwipe) will play, before the hit says for sure:
// a tap = a soft touch, a slow long swipe up = a lob, otherwise by pace
export const swipeLook = (sw) => {
  if (!sw || sw.tap) return { band: "soft", kind: "dink", color: SHOT_COLORS.soft }
  if (sw.pace < 0.2 && (sw.depth ?? 0) > 0.8) return { band: "soft", kind: "lob", color: SHOT_COLORS.lob }
  const band = bandOf(sw.pace)
  return { band, kind: null, color: SHOT_COLORS[band] }
}

// ---- a trail ----
export const createTrail = (p, color = SHOT_COLORS.touch) => ({ pts: p ? [{ x: p.x, y: p.y, t: p.t }] : [], upAt: null, color, resolved: false })

// add a finger position (px, ms); returns the trail
export const addPoint = (trail, p) => {
  const last = trail.pts[trail.pts.length - 1]
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < TRAIL.minStep) {
    // (a still finger: just move the tip's time)
    last.t = p.t
    return trail
  }
  trail.pts.push({ x: p.x, y: p.y, t: p.t })
  // (a very long swipe: thin the oldest half rather than cut its start off)
  if (trail.pts.length > TRAIL.maxPts) trail.pts = trail.pts.filter((q, i) => i >= TRAIL.maxPts / 2 || i % 2 === 0)
  return trail
}

export const release = (trail, now, color) => {
  trail.upAt = now
  if (color) trail.color = color
  return trail
}

// Catmull-Rom through the points, resampled about every `step` px: the finger's events come
// 8-16 ms apart, so a fast flick is a few far-apart points; this draws the curve between them
export const smoothPath = (pts, step = TRAIL.step) => {
  if (pts.length < 3) return pts.map((p) => ({ x: p.x, y: p.y }))
  const out = [{ x: pts[0].x, y: pts[0].y }]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const n = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step))
    for (let k = 1; k <= n; k++) {
      const u = k / n
      const u2 = u * u
      const u3 = u2 * u
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3)
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) })
    }
  }
  return out
}

// how visible the trail is now (s): full while the finger is down, then easing out over
// TRAIL.life; 0 = gone
export const trailAlpha = (trail, now) => {
  if (trail.upAt === null) return 1
  const u = (now - trail.upAt) / TRAIL.life
  if (u >= 1) return 0
  return (1 - u) * (1 - u)
}

// the stroke to draw: points with a width and an alpha each. Thin and faint at the start,
// full at the fingertip; after the lift it also shrinks a little as it fades.
export const ribbon = (trail, now, { width = TRAIL.width } = {}) => {
  const alpha = trailAlpha(trail, now)
  if (alpha <= 0 || !trail.pts.length) return []
  const path = smoothPath(trail.pts)
  const n = path.length
  const shrink = trail.upAt === null ? 1 : 0.6 + 0.4 * alpha
  return path.map((p, i) => {
    const u = n === 1 ? 1 : i / (n - 1)
    return { x: p.x, y: p.y, w: width * shrink * (TRAIL.taper + (1 - TRAIL.taper) * Math.pow(u, 0.7)), a: alpha * (0.3 + 0.7 * u) }
  })
}

// the ribbon as one closed shape: its left edge out to the fingertip, a round cap, and the
// right edge back (wMul scales the width: the edge and core passes)
export const outline = (pts, wMul = 1) => {
  const n = pts.length
  const left = []
  const right = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    let dx = b.x - a.x
    let dy = b.y - a.y
    const d = Math.hypot(dx, dy) || 1
    dx /= d
    dy /= d
    const h = (pts[i].w * wMul) / 2
    left.push({ x: pts[i].x - dy * h, y: pts[i].y + dx * h })
    right.push({ x: pts[i].x + dy * h, y: pts[i].y - dx * h })
  }
  // the tip's round cap: a half circle ahead of the finger
  const tip = pts[n - 1]
  const prev = pts[Math.max(0, n - 2)]
  const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x)
  const r = (tip.w * wMul) / 2
  const cap = []
  for (let k = 1; k < 8; k++) {
    const t = ang + Math.PI / 2 - (k / 8) * Math.PI
    cap.push({ x: tip.x + Math.cos(t) * r, y: tip.y + Math.sin(t) * r })
  }
  return [...left, ...cap, ...right.reverse()]
}

// ---- a ripple (Classic taps and holds) ----
export const createRipple = (x, y, now, color = SHOT_COLORS.touch, big = false) => ({ x, y, at: now, color, big })
// its look now (s): radius and alpha, or null when it's done
export const rippleAt = (r, now) => {
  const u = (now - r.at) / TRAIL.rippleLife
  if (u < 0 || u >= 1) return null
  const ease = 1 - (1 - u) * (1 - u) * (1 - u)
  const r1 = r.big ? TRAIL.rippleR1 * 1.3 : TRAIL.rippleR1
  return { x: r.x, y: r.y, radius: TRAIL.rippleR0 + (r1 - TRAIL.rippleR0) * ease, alpha: (1 - u) * 0.9, line: r.big ? 3 : 2, color: r.color }
}
