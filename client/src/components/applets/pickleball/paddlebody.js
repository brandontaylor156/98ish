// Pickleball 98: the paddle against the body. Pure JavaScript (no three.js), tested in Node
// (paddlebody.test.js); used by anim.js (the pose), athlete.js (the drawn athletes) and the
// measuring tools.
//
// - The paddle as it's drawn (athlete.js paddleParts): its face (a rounded 19 x 27 cm outline,
//   as a 12-sided polygon, with the edge guard's 8.5 mm round it and either side) and its
//   handle (a 1.8 cm capsule from the butt cap to the throat). A paddle is placed by its face's
//   center, its axis (from the grip toward the face) and the face's normal.
// - The body as a set of tapered capsules fitted to the skinned MakeHuman athletes (scratchpad
//   pdl/fit.mjs: every posed vertex of the body and kit, by its dominant bone, at each build):
//   the torso as three chains (left, middle, right) whose radius and depth follow the real
//   torso's cross-sections from the hips to the neck (its width, chest and back), the neck, the
//   head, both arms (the paddle hand itself holds the handle, so it isn't one), the other hand,
//   thighs and shins. Built from joints, so the same body fits anim.js's pose (Node, the Low
//   figures) and the drawn bones (athlete.js).
// - paddleDepth: how far the paddle is into the body (meters; exact segment-to-polygon and
//   segment-to-segment distances, not samples), the deepest body part and paddle part, and the
//   way out (the push that would clear it).
// - resolvePaddle: turns the paddle about its grip (and if that isn't enough, moves the grip)
//   so its whole shape clears the body by a margin. A few cheap iterations; nothing to do on a
//   clear frame beyond the broad-phase test.

// ---- the paddle's shape (athlete.js PADDLE: w 0.19, h 0.27, neck 0.075, handle 0.135; the
// grip point 0.216 m below the face's center) ----
export const PADDLE_SHAPE = {
  halfW: 0.095,
  halfH: 0.135,
  rim: 0.0085, // the edge guard's tube radius (also covers the face's half thickness, 8 mm)
  faceFromGrip: 0.2158,
  // the handle: from the butt cap to the throat, below the face's center
  butt: -0.296,
  throat: -0.14,
  handleR: 0.019,
}
// the outline (x across, y along the axis, from the face's center): straight sides, the bottom
// corners eased (0.03 x 0.04), the top corners round (0.06)
const OUT = (() => {
  const { halfW: w, halfH: h } = PADDLE_SHAPE
  const pts = [
    [-w + 0.03, -h],
    [w - 0.03, -h],
    [w, -h + 0.04],
  ]
  const r = 0.06
  for (const a of [0, 30, 60, 90]) {
    const t = (a * Math.PI) / 180
    pts.push([w - r + r * Math.cos(t), h - r + r * Math.sin(t)])
  }
  for (const a of [90, 120, 150, 180]) {
    const t = (a * Math.PI) / 180
    pts.push([-w + r + r * Math.cos(t), h - r + r * Math.sin(t)])
  }
  pts.push([-w, -h + 0.04])
  // (drop a repeated point where two arcs meet)
  return pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-6)
})()
export const PADDLE_OUTLINE = OUT

// ---- small vector helpers (plain numbers inside the hot loops) ----
const V = (x = 0, y = 0, z = 0) => ({ x, y, z })
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z)
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z)
const mul = (a, s) => V(a.x * s, a.y * s, a.z * s)
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
const len = (a) => Math.hypot(a.x, a.y, a.z)
const norm = (a, fb = V(0, 1, 0)) => {
  const l = len(a)
  return l > 1e-9 ? mul(a, 1 / l) : { ...fb }
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const lerp = (a, b, t) => a + (b - a) * t
const lerpV = (a, b, t) => V(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t))
// a vector turned about a unit axis by angle (Rodrigues)
export const rotAbout = (v, k, ang) => {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  const kv = dot(k, v)
  const kx = cross(k, v)
  return V(v.x * c + kx.x * s + k.x * kv * (1 - c), v.y * c + kx.y * s + k.y * kv * (1 - c), v.z * c + kx.z * s + k.z * kv * (1 - c))
}

// ---- the body (fitted to the MakeHuman athletes; meters, at scale 1 and the regular build) ----
// Torso cross-sections at u (0 = the pelvis joint, 1 = the base of the neck, along the line
// between them): half width w, how far the front and back are from that line. 96th
// percentile of the posed vertices of the body and kit at each height.
export const TORSO = {
  m: [
    { u: -0.25, w: 0.165, f: 0.127, b: 0.06 },
    { u: 0.05, w: 0.172, f: 0.134, b: 0.1 },
    { u: 0.35, w: 0.163, f: 0.13, b: 0.09 },
    { u: 0.65, w: 0.213, f: 0.143, b: 0.1 },
    { u: 0.85, w: 0.205, f: 0.107, b: 0.086 },
    { u: 1.0, w: 0.11, f: 0.069, b: 0.058 },
  ],
  f: [
    { u: -0.25, w: 0.18, f: 0.135, b: 0.06 },
    { u: 0.05, w: 0.193, f: 0.104, b: 0.125 },
    { u: 0.35, w: 0.125, f: 0.112, b: 0.034 },
    { u: 0.65, w: 0.172, f: 0.16, b: 0.066 },
    { u: 0.85, w: 0.178, f: 0.109, b: 0.07 },
    { u: 1.0, w: 0.105, f: 0.071, b: 0.046 },
  ],
}
// limbs: radius near the upper joint, near the lower one (75th percentile of their vertices'
// distance from the bone)
export const LIMBS = {
  m: { upperarm: [0.063, 0.049], forearm: [0.042, 0.026], thigh: [0.109, 0.08], shin: [0.074, 0.046], hand: 0.028, neck: 0.055, head: 0.085 },
  f: { upperarm: [0.057, 0.046], forearm: [0.041, 0.026], thigh: [0.103, 0.076], shin: [0.072, 0.045], hand: 0.026, neck: 0.05, head: 0.085 },
}
// (a body whose kind isn't known: the larger of the two at each place)
TORSO.any = TORSO.m.map((m, i) => {
  const f = TORSO.f[i]
  return { u: m.u, w: Math.max(m.w, f.w), f: Math.max(m.f, f.f), b: Math.max(m.b, f.b) }
})
LIMBS.any = Object.fromEntries(Object.entries(LIMBS.m).map(([k, v]) => [k, Array.isArray(v) ? v.map((x, i) => Math.max(x, LIMBS.f[k][i])) : Math.max(v, LIMBS.f[k])]))

// Part names, for reports
export const PARTS = ["torso", "hips", "neck", "head", "upperarmP", "forearmP", "upperarmO", "forearmO", "handO", "thighL", "thighR", "shinL", "shinR", "mate"]

// The body's capsules from its joints.
// j: { pelvis, neck, up (the spine's direction, pelvis to neck: optional), pelvisRight,
//      chestRight, chestFwd (optional: up x right), head (the head's center), headUp, headFwd,
//      shoulderP, elbowP, wristP, shoulderO, elbowO, wristO, handTipO (optional),
//      hipL, kneeL, ankleL, hipR, kneeR, ankleR }
// opts: { kind: "m" | "f" | "any", scale (radii), out (an array to reuse) }
// Each capsule: { ax, ay, az, bx, by, bz, ra, rb, part }
export const bodyCapsules = (j, { kind = "any", scale = 1, out = [] } = {}) => {
  out.length = 0
  const T = TORSO[kind] || TORSO.any
  const L = LIMBS[kind] || LIMBS.any
  const cap = (a, b, ra, rb, part) => {
    if (!a || !b) return
    out.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, ra: ra * scale, rb: rb * scale, part })
  }
  const P = j.pelvis
  const N = j.neck
  const spine = sub(N, P)
  const H = len(spine)
  const up = norm(spine)
  const pr = norm(sub(j.pelvisRight, mul(up, dot(j.pelvisRight, up))), V(-1, 0, 0))
  const cr = norm(sub(j.chestRight, mul(up, dot(j.chestRight, up))), pr)
  // (forward = up x right)
  const frameAt = (u) => {
    const k = clamp((u - 0.1) / 0.5, 0, 1)
    const r = norm(lerpV(pr, cr, k), cr)
    return { r, f: cross(up, r) }
  }
  // the three chains: each cross-section's middle, its half depth and how far out its sides are
  // (scale: the build's girth; H: this skeleton's own length, pelvis to neck)
  const nodes = T.map((s) => {
    const { r, f } = frameAt(s.u)
    const d = ((s.f + s.b) / 2) * scale
    const c = ((s.f - s.b) / 2) * scale
    const off = Math.max(0, s.w * scale - d)
    const m = add(add(P, mul(up, s.u * H)), mul(f, c))
    return { x: m.x, y: m.y, z: m.z, rx: r.x * off, ry: r.y * off, rz: r.z * off, d }
  })
  for (const side of [-1, 0, 1]) {
    for (let i = 0; i < T.length - 1; i++) {
      const a = nodes[i]
      const b = nodes[i + 1]
      out.push({ ax: a.x + a.rx * side, ay: a.y + a.ry * side, az: a.z + a.rz * side, bx: b.x + b.rx * side, by: b.y + b.ry * side, bz: b.z + b.rz * side, ra: a.d, rb: b.d, part: T[i + 1].u <= 0.35 ? "hips" : "torso" })
    }
  }
  // the neck and the head
  if (j.head) {
    const hu = j.headUp || up
    const hf = j.headFwd || cross(up, cr)
    cap(N, add(j.head, mul(hu, -0.07)), L.neck, L.neck, "neck")
    cap(add(add(j.head, mul(hu, -0.02)), mul(hf, 0.02)), add(add(j.head, mul(hu, 0.03)), mul(hf, 0.02)), L.head, L.head, "head")
  }
  // the arms (the paddle hand is on the handle: not a part)
  cap(j.shoulderP, j.elbowP, L.upperarm[0], L.upperarm[1], "upperarmP")
  cap(j.elbowP, j.wristP, L.forearm[0], L.forearm[1], "forearmP")
  cap(j.shoulderO, j.elbowO, L.upperarm[0], L.upperarm[1], "upperarmO")
  cap(j.elbowO, j.wristO, L.forearm[0], L.forearm[1], "forearmO")
  if (j.wristO && j.handTipO !== null) {
    const tip = j.handTipO || add(j.wristO, mul(norm(sub(j.wristO, j.elbowO)), 0.13))
    cap(j.wristO, tip, L.hand, L.hand * 0.8, "handO")
  }
  // the legs
  cap(j.hipL, j.kneeL, L.thigh[0], L.thigh[1], "thighL")
  cap(j.kneeL, j.ankleL, L.shin[0], L.shin[1], "shinL")
  cap(j.hipR, j.kneeR, L.thigh[0], L.thigh[1], "thighR")
  cap(j.kneeR, j.ankleR, L.shin[0], L.shin[1], "shinR")
  return out
}

// The body's joints from an anim.js pose (the procedural skeleton). The head's center: the
// drawn head sits ~0.13 m above the base of the neck (the pose's own `head` is a look-at point
// further up).
export const poseJoints = (pose) => {
  const right = (pose.hand ?? 1) > 0
  const up = norm(sub(pose.neck, pose.pelvis))
  const look = pose.look || pose.chestForward
  return {
    pelvis: pose.pelvis,
    neck: pose.neck,
    pelvisRight: pose.pelvisRight,
    chestRight: pose.chestRight,
    head: add(pose.neck, mul(up, 0.13)),
    headUp: up,
    headFwd: norm(sub(look, mul(up, dot(look, up))), pose.chestForward),
    shoulderP: pose.paddleShoulder,
    elbowP: pose.elbowP,
    wristP: pose.wristP,
    shoulderO: right ? pose.shoulderL : pose.shoulderR,
    elbowO: pose.elbowO,
    wristO: pose.wristO,
    hipL: pose.hipL,
    kneeL: pose.kneeL,
    ankleL: pose.ankleL,
    hipR: pose.hipR,
    kneeR: pose.kneeR,
    ankleR: pose.ankleR,
  }
}

// ---- distances ----
// closest points of segments p1-q1 and p2-q2 (Ericson 5.1.9); returns the squared distance
// and writes the parameters into res.s / res.t
const segSeg = (p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z, res) => {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z
  const a = d1x * d1x + d1y * d1y + d1z * d1z
  const e = d2x * d2x + d2y * d2y + d2z * d2z
  const f = d2x * rx + d2y * ry + d2z * rz
  let s, t
  if (a <= 1e-12 && e <= 1e-12) {
    s = t = 0
  } else if (a <= 1e-12) {
    s = 0
    t = clamp(f / e, 0, 1)
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz
    if (e <= 1e-12) {
      t = 0
      s = clamp(-c / a, 0, 1)
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z
      const den = a * e - b * b
      s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = clamp(-c / a, 0, 1)
      } else if (t > 1) {
        t = 1
        s = clamp((b - c) / a, 0, 1)
      }
    }
  }
  res.s = s
  res.t = t
  const x = p1x + d1x * s - (p2x + d2x * t)
  const y = p1y + d1y * s - (p2y + d2y * t)
  const z = p1z + d1z * s - (p2z + d2z * t)
  res.dx = x
  res.dy = y
  res.dz = z
  return x * x + y * y + z * z
}

// inside the outline? (2D, convex)
const inOutline = (x, y) => {
  const n = OUT.length
  for (let i = 0; i < n; i++) {
    const a = OUT[i]
    const b = OUT[(i + 1) % n]
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false
  }
  return true
}

const tmp = { s: 0, t: 0, dx: 0, dy: 0, dz: 0 }
// The paddle's frame: { c (the face's center), u (across the face), v (the axis: grip -> face),
// n (the face's normal) } from { face, axis, normal }
export const paddleFrame = (p) => {
  const v = norm(p.axis)
  const n = norm(sub(p.normal, mul(v, dot(p.normal, v))), V(0, 0, 1))
  return { c: p.face, u: cross(v, n), v, n }
}

// Distance from a capsule's segment (a-b, in the face's own coordinates: x across, y along,
// z out of the face) to the face (a flat convex polygon), with where along the segment (t) and
// the face's nearest point (lx, ly) into res. Exact: the segment crossing the face inside the
// outline, its ends over the face, or the closest approach to an edge.
const fres = { t: 0, d: 0, lx: 0, ly: 0 }
const faceDist = (ax, ay, az, bx, by, bz, res) => {
  // crossing the plane inside the outline
  if ((az <= 0 && bz >= 0) || (az >= 0 && bz <= 0)) {
    const t = Math.abs(az - bz) > 1e-12 ? az / (az - bz) : 0
    const x = ax + (bx - ax) * t
    const y = ay + (by - ay) * t
    if (inOutline(x, y)) {
      res.t = t
      res.d = 0
      res.lx = x
      res.ly = y
      return 0
    }
  }
  let best = Infinity
  // the ends straight over the face
  if (inOutline(ax, ay)) {
    best = Math.abs(az)
    res.t = 0
    res.lx = ax
    res.ly = ay
  }
  if (inOutline(bx, by) && Math.abs(bz) < best) {
    best = Math.abs(bz)
    res.t = 1
    res.lx = bx
    res.ly = by
  }
  // the edges
  const n = OUT.length
  for (let i = 0; i < n; i++) {
    const e0 = OUT[i]
    const e1 = OUT[i + 1 === n ? 0 : i + 1]
    const d2 = segSeg(ax, ay, az, bx, by, bz, e0[0], e0[1], 0, e1[0], e1[1], 0, tmp)
    if (d2 < best * best) {
      best = Math.sqrt(d2)
      res.t = tmp.s
      res.lx = e0[0] + (e1[0] - e0[0]) * tmp.t
      res.ly = e0[1] + (e1[1] - e0[1]) * tmp.t
    }
  }
  res.d = best
  return best
}

// Every place the paddle is into the body (or within `margin` of it): one contact per capsule
// and paddle part (its face, its handle), the deepest point of each. A contact: { depth
// (meters, + = into the body), q (the point on the paddle, world), n (the way out: unit, from
// the body toward the paddle), part, what ("face" | "handle"), at ({ x, y }: q on the paddle,
// x across the face, y along the axis from the face's center) }.
// paddle: { face, axis, normal }; caps: bodyCapsules(); skip(part, what) -> true leaves a pair
// out; parts (optional): each body part's deepest depth is written into it.
export const paddleContacts = (paddle, caps, { skip = null, margin = 0, parts = null, out = [] } = {}) => {
  out.length = 0
  const F = paddleFrame(paddle)
  const S = PADDLE_SHAPE
  const cx0 = F.c.x, cy0 = F.c.y, cz0 = F.c.z
  const ux = F.u.x, uy = F.u.y, uz = F.u.z
  const vx = F.v.x, vy = F.v.y, vz = F.v.z
  const nx = F.n.x, ny = F.n.y, nz = F.n.z
  const hx = cx0 + vx * S.butt, hy = cy0 + vy * S.butt, hz = cz0 + vz * S.butt
  const tx = cx0 + vx * S.throat, ty = cy0 + vy * S.throat, tz = cz0 + vz * S.throat
  for (let i = 0; i < caps.length; i++) {
    const k = caps[i]
    const rmax = k.ra > k.rb ? k.ra : k.rb
    // the face (broad phase: the sphere round it, 17.2 cm from its center to its corners)
    const lim = 0.172 + S.rim + rmax + margin
    if (segSeg(k.ax, k.ay, k.az, k.bx, k.by, k.bz, cx0, cy0, cz0, cx0, cy0, cz0, tmp) <= lim * lim && (!skip || !skip(k.part, "face"))) {
      const ax = k.ax - cx0, ay = k.ay - cy0, az = k.az - cz0
      const ex = k.bx - cx0, ey = k.by - cy0, ez = k.bz - cz0
      faceDist(ax * ux + ay * uy + az * uz, ax * vx + ay * vy + az * vz, ax * nx + ay * ny + az * nz, ex * ux + ey * uy + ez * uz, ex * vx + ey * vy + ez * vz, ex * nx + ey * ny + ez * nz, fres)
      const r = k.ra + (k.rb - k.ra) * fres.t
      const dd = r + S.rim - fres.d
      if (parts && dd > (parts[k.part] ?? -Infinity)) parts[k.part] = dd
      if (dd > -margin) {
        // the way out: from the capsule's nearest point toward the face's nearest point
        const qx = k.ax + (k.bx - k.ax) * fres.t, qy = k.ay + (k.by - k.ay) * fres.t, qz = k.az + (k.bz - k.az) * fres.t
        const px = cx0 + ux * fres.lx + vx * fres.ly, py = cy0 + uy * fres.lx + vy * fres.ly, pz = cz0 + uz * fres.lx + vz * fres.ly
        let dir = V(px - qx, py - qy, pz - qz)
        if (len(dir) < 0.01) {
          // (through the face: out from the capsule's axis toward the face's center, across
          // the capsule)
          const kx = k.bx - k.ax, ky = k.by - k.ay, kz = k.bz - k.az
          const kl = Math.hypot(kx, ky, kz) || 1
          let o = V(cx0 - qx, cy0 - qy, cz0 - qz)
          const along = (o.x * kx + o.y * ky + o.z * kz) / kl
          o = V(o.x - (kx / kl) * along, o.y - (ky / kl) * along, o.z - (kz / kl) * along)
          dir = len(o) > 1e-4 ? o : F.n
        }
        out.push({ depth: dd, q: V(px, py, pz), n: norm(dir, F.n), part: k.part, what: "face", at: { x: fres.lx, y: fres.ly } })
      }
    }
    // the handle
    if (!skip || !skip(k.part, "handle")) {
      const d2 = segSeg(k.ax, k.ay, k.az, k.bx, k.by, k.bz, hx, hy, hz, tx, ty, tz, tmp)
      const r = k.ra + (k.rb - k.ra) * tmp.s
      const dd = r + S.handleR - Math.sqrt(d2)
      if (parts && dd > (parts[k.part] ?? -Infinity)) parts[k.part] = dd
      if (dd > -margin) {
        const ty2 = S.butt + (S.throat - S.butt) * tmp.t
        out.push({ depth: dd, q: V(cx0 + vx * ty2, cy0 + vy * ty2, cz0 + vz * ty2), n: norm(V(-tmp.dx, -tmp.dy, -tmp.dz), F.n), part: k.part, what: "handle", at: { x: 0, y: ty2 } })
      }
    }
  }
  return out
}

// How far the paddle is into the body: the deepest contact ({ depth, part, what, n, q, at };
// depth -1 and part null when nothing is within margin). parts: as paddleContacts.
const scratch = []
export const paddleDepth = (paddle, caps, opts = {}) => {
  const cs = paddleContacts(paddle, caps, { ...opts, out: scratch })
  let best = null
  for (const c of cs) if (!best || c.depth > best.depth) best = c
  return best ? { ...best, push: mul(best.n, Math.max(0, best.depth)) } : { depth: -1, part: null, what: null, push: V(), at: null }
}

// The skip rule for a figure: the paddle's handle is in the paddle hand (and the butt at the
// wrist), so not against that forearm; the other hand holds the handle for a two-hander or
// cups the throat in the ready position.
export const skipFor = ({ two = false, cup = false } = {}) => (part, what) => {
  if (part === "forearmP" && what === "handle") return true
  if ((two || cup) && (part === "handO" || part === "forearmO")) return true
  return false
}

// ---- the resolve ----
// Moves the paddle as little as it can so its whole shape clears the body by `margin`: a turn
// about `pivot` (the wrist) and, costing more, a shift. Each step solves for the one small
// rigid move (a 6x6 least squares: every contact asks its point to move `depth + margin`
// along its way out; turning is cheap, shifting dear) and applies it; a few steps. The turn
// is capped at maxTurn radians, the shift at maxShift meters.
// Returns { paddle, depth (after), before, turn (the quaternion), turned (radians), shift,
// part, what (the deepest contact before) }.
const qa = (k, ang) => {
  const s = Math.sin(ang / 2)
  return { x: k.x * s, y: k.y * s, z: k.z * s, w: Math.cos(ang / 2) }
}
const qm = (a, b) => ({ x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z })
// A x = b for a small dense system (Gaussian elimination, partial pivoting); A is n x n flat
const solveN = (A, b, n) => {
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[piv * n + c])) piv = r
    if (Math.abs(A[piv * n + c]) < 1e-14) return null
    if (piv !== c) {
      for (let k = 0; k < n; k++) {
        const t = A[c * n + k]
        A[c * n + k] = A[piv * n + k]
        A[piv * n + k] = t
      }
      const t = b[c]
      b[c] = b[piv]
      b[piv] = t
    }
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / A[c * n + c]
      if (!f) continue
      for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k]
      b[r] -= f * b[c]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]
    for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k]
    x[r] = s / A[r * n + r]
  }
  return x
}
const contactsBuf = []
const Abuf = new Array(36)
const bbuf = new Array(6)
export const RESOLVE = { turnCost: 0.002, shiftCost: 0.15 }
export const resolvePaddle = (paddle, caps, { pivot = null, margin = 0.015, skip = null, maxTurn = 1.0, maxShift = 0.1, iters = 4, turnCost = RESOLVE.turnCost, shiftCost = RESOLVE.shiftCost } = {}) => {
  let p = { face: paddle.face, axis: norm(paddle.axis), normal: paddle.normal }
  let g = pivot || sub(p.face, mul(p.axis, PADDLE_SHAPE.faceFromGrip))
  let cs = paddleContacts(p, caps, { skip, margin, out: contactsBuf })
  let first = null
  for (const c of cs) if (!first || c.depth > first.depth) first = c
  let turn = { x: 0, y: 0, z: 0, w: 1 }
  let shift = V()
  let turned = 0
  if (!first || first.depth <= -margin) return { paddle: p, depth: first ? first.depth : -1, before: first ? first.depth : -1, turn, turned, shift, part: null, what: null }
  const before = first.depth
  const part = first.part
  const what = first.what
  let depth = before
  for (let it = 0; it < iters; it++) {
    const A = Abuf.fill(0)
    const b = bbuf.fill(0)
    let any = false
    for (const c of cs) {
      const need = c.depth + margin
      if (need <= 0) continue
      any = true
      // (the deeper a contact, the more it counts)
      const w = 1 + need / 0.02
      const r = sub(c.q, g)
      const rn = cross(r, c.n)
      const J = [rn.x, rn.y, rn.z, c.n.x, c.n.y, c.n.z]
      for (let i = 0; i < 6; i++) {
        b[i] += w * J[i] * need
        for (let k = 0; k < 6; k++) A[i * 6 + k] += w * J[i] * J[k]
      }
    }
    if (!any) break
    for (let i = 0; i < 3; i++) A[i * 6 + i] += turnCost
    for (let i = 3; i < 6; i++) A[i * 6 + i] += shiftCost
    const x = solveN(A, b, 6)
    if (!x) break
    let w = V(x[0], x[1], x[2])
    let t = V(x[3], x[4], x[5])
    // (within what's left of the budgets)
    let ang = len(w)
    const angMax = Math.min(0.6, Math.max(0, maxTurn - turned))
    if (ang > angMax) {
      w = mul(w, angMax / ang)
      ang = angMax
    }
    const tl = len(t)
    const tMax = Math.max(0, maxShift - len(shift))
    if (tl > tMax) t = mul(t, tMax / tl)
    if (ang < 1e-5 && len(t) < 1e-5) break
    if (ang > 1e-6) {
      const k = mul(w, 1 / ang)
      p = { face: add(g, rotAbout(sub(p.face, g), k, ang)), axis: norm(rotAbout(p.axis, k, ang)), normal: norm(rotAbout(p.normal, k, ang)) }
      turn = qm(qa(k, ang), turn)
      turned += ang
    }
    p = { face: add(p.face, t), axis: p.axis, normal: p.normal }
    g = add(g, t)
    shift = add(shift, t)
    cs = paddleContacts(p, caps, { skip, margin, out: contactsBuf })
    depth = -1
    for (const c of cs) if (c.depth > depth) depth = c.depth
    if (depth <= -margin * 0.5) break
  }
  return { paddle: p, depth, before, turn, turned, shift, part, what }
}


// Right at contact the face must stay where the ball is: only the paddle's roll about the face's
// normal (through the face's center) is free, which swings the handle and the hand round.
// The smallest roll (up to maxTurn radians either way, searched in steps, then refined) that
// clears the body by margin, or the clearest one. Returns { paddle, depth, before, angle }.
const depthOf = (p, caps, skip, margin) => {
  let d = -1
  for (const c of paddleContacts(p, caps, { skip, margin, out: contactsBuf })) if (c.depth > d) d = c.depth
  return d
}
export const rollPaddle = (paddle, caps, { margin = 0.015, skip = null, maxTurn = 1.0, steps = 6 } = {}) => {
  const p0 = { face: paddle.face, axis: norm(paddle.axis), normal: paddle.normal }
  const N = paddleFrame(p0).n
  const before = depthOf(p0, caps, skip, margin)
  if (before <= -margin) return { paddle: p0, depth: before, before, angle: 0 }
  const at = (a) => ({ face: p0.face, axis: norm(rotAbout(p0.axis, N, a)), normal: p0.normal })
  let best = { a: 0, d: before }
  // outward from no roll, both ways: the first that clears wins
  for (let k = 1; k <= steps; k++) {
    let done = false
    for (const s of [1, -1]) {
      const a = (s * maxTurn * k) / steps
      const d = depthOf(at(a), caps, skip, margin)
      if ((best.d > -margin && d <= -margin) || (best.d > -margin && d < best.d - 1e-4)) best = { a, d }
      if (d <= -margin) done = true
    }
    if (done) break
  }
  // (refined toward no roll while it stays clear)
  if (best.d <= -margin && best.a !== 0) {
    let lo = 0
    let hi = best.a
    for (let i = 0; i < 4; i++) {
      const mid = (lo + hi) / 2
      const d = depthOf(at(mid), caps, skip, margin)
      if (d <= -margin) {
        hi = mid
        best = { a: mid, d }
      } else lo = mid
    }
  }
  return { paddle: at(best.a), depth: best.d, before, angle: best.a }
}
