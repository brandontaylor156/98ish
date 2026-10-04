// Pickleball 98: what players do between points and after the game (presentation only; pure
// JavaScript, Node-tested in between.test.js). anim.js asks every frame and layers the answer
// on the upper body; the legs keep walking (motion matching) wherever the match takes them.
// From pro doubles (docs/pickleball-movement.md, "between points"):
//
// - Paddle taps: partners tap paddles after every point, won or lost, as they pass each other
//   on the way back to their spots; after the last point everyone walks up to the net and
//   taps paddles with the player across (match.js walkToNet).
// - A glance at the partner every few seconds (a nod, a plan for the next point).
// - Fidgets while waiting: a paddle twirl in the fingers, the other hand wiping on the shorts.
// - The returner waits low on the baseline, weight forward, a little side to side.
//
// Everything here is decided from the situation alone (positions, the phase, the point
// count, a per-player hash), so every browser in an online match shows the same thing.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const smooth = (t) => {
  const u = clamp(t, 0, 1)
  return u * u * (3 - 2 * u)
}
// a stable number in 0..1 from a string and a count (which fidget, when)
export const hash01 = (str, n = 0) => {
  let h = 2166136261 ^ n
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 13
  h = Math.imul(h, 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export const BETWEEN = {
  tap: { reach: 2.1, dur: 0.8, y: 1.1, after: 0.25 }, // start when the other paddle is within reach (m), how long, height
  netTap: { reach: 2.0, dur: 0.9, y: 1.05 },
  glance: { every: 3.6, dur: 0.9 },
  twirl: { dur: 0.55 },
  wipe: { dur: 0.9 },
}

// st: state kept by anim.js (a.bt); s: the situation (between, phase, phaseT, id, point,
// mate, across, x, z, holding, receiving); speed: m/s; t: anim clock. Returns
// { tap: { x, y, z (the paddle face's target, world), nx, nz (face normal), w } | null,
//   look: { x, y, z } | null, twirl: radians (round the handle) or 0, wipe: 0..1 phase or
//   null, crouch: m extra, sway: m }
export const betweenActs = (st, s, speed, t, dt) => {
  const out = { tap: null, look: null, twirl: 0, wipe: null, crouch: 0, sway: 0 }
  const id = s.id || "p"
  // ---- paddle taps ----
  const over = s.phase === "over"
  const other = over ? s.across : s.mate
  const tapCfg = over ? BETWEEN.netTap : BETWEEN.tap
  const key = over ? "over" : `p${s.point ?? 0}`
  if (st.tap && st.tap.key !== key && st.tap.t > tapCfg.dur) st.tap = null
  if (!st.tap && other && (s.between || over) && st.tapped !== key) {
    const d = Math.hypot(other.x - s.x, other.z - s.z)
    const early = over ? s.phaseT > 0.6 : s.phase === "dead" ? s.phaseT > BETWEEN.tap.after : s.phase === "intro" && s.phaseT < 2.5
    if (early && d < tapCfg.reach && d > 0.45) {
      st.tap = { key, t: 0 }
      st.tapped = key
    }
  }
  if (st.tap) {
    st.tap.t += dt
    const u = st.tap.t / tapCfg.dur
    if (u >= 1 || !other) st.tap = u >= 1 ? { ...st.tap, done: true } : null
    if (st.tap && !st.tap.done) {
      // up and in toward the middle, a touch, back down
      const w = Math.sin(Math.PI * clamp(u, 0, 1)) ** 0.7
      const dx = other.x - s.x
      const dz = other.z - s.z
      const d = Math.hypot(dx, dz) || 1
      // the paddle faces meet halfway (each player's face stops just short of it)
      const reach = Math.min(d / 2 - 0.04, 0.62)
      out.tap = { x: s.x + (dx / d) * reach, y: tapCfg.y, z: s.z + (dz / d) * reach, nx: dx / d, nz: dz / d, w }
      out.look = { x: other.x, y: 1.45, z: other.z }
    }
  }
  if (!s.between && !over) {
    // ---- the returner: low and ready on the baseline ----
    if (s.receiving) {
      out.crouch = 0.05
      out.sway = Math.sin(t * 2.4) * 0.025
    }
    return out
  }
  // ---- a glance at the partner ----
  if (s.mate && !out.look) {
    const per = BETWEEN.glance.every
    const ph = (t + hash01(id, 1) * per) % per
    if (ph < BETWEEN.glance.dur) out.look = { x: s.mate.x, y: 1.5, z: s.mate.z }
  }
  // ---- fidgets while waiting (standing about, nothing in the hands) ----
  if (speed < 0.3 && !s.holding && !out.tap && s.phase === "intro") {
    // which fidget this point, and when: a twirl or a wipe on the shorts (or neither)
    const pick = hash01(id, s.point ?? 0)
    const at = 0.4 + hash01(id, (s.point ?? 0) + 99) * 1.2
    if (pick < 0.45) {
      const u = (s.phaseT - at) / BETWEEN.twirl.dur
      if (u > 0 && u < 1) out.twirl = Math.PI * 2 * smooth(u)
    } else if (pick < 0.8) {
      const u = (s.phaseT - at) / BETWEEN.wipe.dur
      if (u > 0 && u < 1) out.wipe = u
    }
  }
  return out
}
