// Roam: the cars' shapes, built at load from measurements (no files to download). Pure
// geometry in plain arrays (Node-tested, roam.test.js): a body lofted through ~40 rounded
// cross-sections (rocker, door bulge, beltline, a narrower glasshouse with tumblehome, a crowned
// roof), real wheel arches cut into the sides, glass set a little proud of the body with the
// pillars left in paint, mirrors, lamps, grille, plates, dark lower trim, and wheels (a rounded
// tire with a five-spoke rim) as their own part so a car you drive steers and rolls them.
//
// Why not downloaded models: the free CC0 kits checked (Kenney Car Kit 3.1, rgsdev's Free Low
// Poly Vehicles, Quaternius) are toy-proportioned and cartoon-coloured, and the owner wants
// realism, not stylized (docs/open-world.md "Cars"). These follow real sizes per class
// (a mid-size sedan, a compact hatch, a mid-size SUV, a full-size pickup) with no makes or
// badges. ~1,700 triangles a car (body ~1,100, wheels 4 x ~110).
//
// Parts and what each is drawn with (render/cars.js):
// - paint: the body and mirrors (vertex colour white = takes the car's colour) and the glass
//   (vertex colour near black: black times any colour stays glass) -> one glossy material;
// - trim: tires, rims, lower plastics, grille, plates, lamps (vertex colours; lamps carry a
//   `glow` value: 1 head, 2 tail, so night and braking can light them);
// - wheels: one wheel at the origin (axle along x), placed by the caller.

// the shapes per model (metres): length, width, wheelbase, wheel radius, rear overhang, ride
// height, beltline, and the top line along the car as [z from the rear, height, zone]
// (zones: deck / glass (a sloped window) / roof / hood / bed)
export const CAR_SPECS = {
  sedan: {
    len: 4.7, wid: 1.84, wb: 2.75, R: 0.33, rear: 0.98, ride: 0.2, belt: 0.92, tw: 0.66,
    top: [[0, 0.84, "deck"], [0.12, 0.97, "deck"], [0.6, 1.0, "deck"], [1.3, 1.36, "glass"], [1.55, 1.43, "roof"], [2.65, 1.44, "roof"], [3.35, 1.0, "glass"], [3.6, 0.95, "hood"], [4.55, 0.82, "hood"], [4.7, 0.62, "hood"]],
  },
  hatch: {
    len: 4.1, wid: 1.78, wb: 2.55, R: 0.32, rear: 0.68, ride: 0.19, belt: 0.95, tw: 0.66,
    top: [[0, 0.86, "deck"], [0.08, 1.0, "glass"], [0.3, 1.42, "glass"], [0.55, 1.48, "roof"], [2.2, 1.49, "roof"], [2.95, 1.02, "glass"], [3.15, 0.97, "hood"], [3.98, 0.84, "hood"], [4.1, 0.64, "hood"]],
  },
  suv: {
    len: 4.85, wid: 1.92, wb: 2.85, R: 0.37, rear: 0.98, ride: 0.26, belt: 1.12, tw: 0.62,
    top: [[0, 1.05, "deck"], [0.06, 1.2, "glass"], [0.22, 1.66, "glass"], [0.45, 1.74, "roof"], [2.9, 1.75, "roof"], [3.6, 1.2, "glass"], [3.8, 1.14, "hood"], [4.7, 1.02, "hood"], [4.85, 0.78, "hood"]],
  },
  pickup: {
    len: 5.6, wid: 2.0, wb: 3.4, R: 0.39, rear: 1.05, ride: 0.3, belt: 1.18, tw: 0.62,
    top: [[0, 1.12, "bed"], [1.95, 1.14, "bed"], [2.0, 1.2, "glass"], [2.06, 1.82, "glass"], [2.2, 1.86, "roof"], [3.3, 1.87, "roof"], [3.95, 1.24, "glass"], [4.15, 1.2, "hood"], [5.45, 1.12, "hood"], [5.6, 0.86, "hood"]],
  },
  turbo: {
    len: 4.3, wid: 1.86, wb: 2.5, R: 0.33, rear: 0.86, ride: 0.13, belt: 0.74, tw: 0.62,
    top: [[0, 0.7, "deck"], [0.1, 0.84, "deck"], [0.55, 0.88, "deck"], [1.35, 1.18, "glass"], [1.6, 1.22, "roof"], [2.3, 1.22, "roof"], [3.0, 0.82, "glass"], [3.2, 0.76, "hood"], [4.18, 0.62, "hood"], [4.3, 0.46, "hood"]],
  },
}
export const CAR_KINDS = Object.keys(CAR_SPECS)

const smooth = (t) => t * t * (3 - 2 * t)
// the top line at z (from the rear): its height (smoothed between keys) and zone (a stretch
// takes the zone of the key it ends at: deck -> glass is a rear window, roof -> glass the
// windshield, glass -> hood the cowl)
const topAt = (spec, s) => {
  const k = spec.top
  if (s <= k[0][0]) return { y: k[0][1], zone: k[0][2] }
  for (let i = 0; i + 1 < k.length; i++) {
    const a = k[i]
    const b = k[i + 1]
    if (s <= b[0]) {
      const t = (s - a[0]) / Math.max(1e-6, b[0] - a[0])
      // (straight down the glass, eased elsewhere)
      const f = b[2] === "glass" ? t : smooth(t)
      return { y: a[1] + (b[1] - a[1]) * f, zone: b[2] }
    }
  }
  const l = k[k.length - 1]
  return { y: l[1], zone: l[2] }
}

// the sampling stations along the car (dense at the ends and round the wheel arches)
const stations = (spec) => {
  const L = spec.len
  const set = new Set()
  for (let s = 0; s <= L + 1e-6; s += 0.34) set.add(Math.round(s * 1000) / 1000)
  for (const k of spec.top) set.add(k[0])
  for (const e of [0.06, 0.16, L - 0.16, L - 0.06]) set.add(e)
  const ax = [spec.rear, spec.rear + spec.wb]
  for (const a of ax) for (let i = -4; i <= 4; i++) set.add(Math.round((a + (i / 4) * (spec.R + 0.07)) * 1000) / 1000)
  // (stations closer than 9 cm merge: the arches' ends and the keys)
  const out = []
  for (const s of [...set].filter((s) => s >= 0 && s <= L).sort((a, b) => a - b)) if (!out.length || s - out[out.length - 1] > 0.09 || s === L) out.push(s)
  return out
}

// the body's bottom at z: the ride height, up and over each wheel (the arch)
const bottomAt = (spec, s) => {
  let y = spec.ride + 0.12
  for (const a of [spec.rear, spec.rear + spec.wb]) {
    const d = s - a
    const r = spec.R + 0.07
    if (Math.abs(d) < r) y = Math.max(y, spec.R + Math.sqrt(r * r - d * d))
  }
  return y
}

// how the ends round off in plan: the section's width (and a little of its height) at z
const endScale = (spec, s) => {
  const r = 0.3
  const d = Math.min(s, spec.len - s)
  if (d >= r) return 1
  const t = 1 - d / r
  return 1 - 0.17 * t * t
}

// one cross-section's right half, bottom to the roof's middle: [[x, y, part]] (part: 0 trim,
// 1 paint) and which points the glass sits between
const section = (spec, s) => {
  const { y: top, zone } = topAt(spec, s)
  const W = (spec.wid / 2) * endScale(spec, s)
  const bot = bottomAt(spec, s)
  const e = endScale(spec, s)
  const belt = Math.min(spec.belt, top - 0.02)
  const cabin = top - belt > 0.18
  // the glasshouse leans in (tumblehome): narrower at the roof
  const Wt = cabin ? W * (spec.tw + 0.06) : W * 0.9
  const crown = cabin ? 0.04 : 0.02
  const yb = Math.min(bot, belt - 0.12)
  const lowY = yb + (belt - yb) * 0.32
  const pts = [
    [W * 0.82, yb, 0],
    [W * 0.95, yb + 0.05, 0],
    [W * 0.99, lowY, 1],
    [W, yb + (belt - yb) * 0.66, 1],
    [W * 0.975, belt, 1],
    [Wt + (W * 0.95 - Wt) * 0.82, belt + (top - belt) * 0.12, 1],
    [Wt, top - 0.035, 1],
    [Wt * 0.72, top + crown * 0.75, 1],
    [Wt * 0.36, top + crown * 0.97, 1],
    [0, top + crown, 1],
  ]
  // (the ends drop a little: bumpers are lower than the hood's edge)
  if (e < 1) for (const p of pts) p[1] = yb + (p[1] - yb) * (0.75 + 0.25 * e)
  return { pts, zone, cabin, top, belt, W, Wt }
}

// arrays a part is collected into: positions, colours, glow; indexed triangles
const part = () => ({ P: [], C: [], G: [], I: [] })
const vtx = (pt, x, y, z, c, g = 0) => {
  pt.P.push(x, y, z)
  pt.C.push(c[0], c[1], c[2])
  pt.G.push(g)
  return pt.P.length / 3 - 1
}
const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
const WHITE = [1, 1, 1]
const GLASS = rgb(0x0b0e12)
const BLACK = rgb(0x18191b)
const TRIM = rgb(0x262729)
const RUBBER = rgb(0x1a1a1b)
const RIM = rgb(0xa9adb2)
const HUB = rgb(0x55585c)
const HEAD = rgb(0xcfd8df)
const BEZEL = rgb(0x0e0f10)
const HEAD_WRAP = rgb(0x6f7a83) // (the lamp glass round the front corners: tinted, not a white flash)
const TAIL = rgb(0x9a1016)
const PLATE = rgb(0xdedfd8)
const AMBER = rgb(0xd88a22)

// a quad (a, b, c, d counter-clockwise seen from outside) into a part
const quad = (pt, a, b, c, d, col, g = 0) => {
  const i = vtx(pt, ...a, col, g)
  const j = vtx(pt, ...b, col, g)
  const k = vtx(pt, ...c, col, g)
  const l = vtx(pt, ...d, col, g)
  pt.I.push(i, j, k, i, k, l)
}
// an axis-aligned box (centre, size) into a part
const box = (pt, cx, cy, cz, sx, sy, sz, col, g = 0) => {
  const x0 = cx - sx / 2
  const x1 = cx + sx / 2
  const y0 = cy - sy / 2
  const y1 = cy + sy / 2
  const z0 = cz - sz / 2
  const z1 = cz + sz / 2
  quad(pt, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, g) // front (+z)
  quad(pt, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, g) // back
  quad(pt, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col, g) // right (+x)
  quad(pt, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, g) // left
  quad(pt, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], col, g) // top
  quad(pt, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, g) // bottom
}

// the body: lofted sections -> paint (with the glass) and trim parts
const buildBody = (spec, paint, trim) => {
  const st = stations(spec)
  const L = spec.len
  const secs = st.map((s) => ({ s, z: s - spec.rear - spec.wb / 2, ...section(spec, s) }))
  // each section's full ring: right half bottom->top, then the left half top->bottom (mirrored)
  const ringOf = (sec) => {
    const right = sec.pts
    const left = right.slice(0, -1).reverse().map(([x, y, p]) => [-x, y, p])
    return [...right, ...left]
  }
  const rings = secs.map(ringOf)
  const n = rings[0].length
  // the loft: quads between neighbouring sections; a quad is trim if either end is
  for (let i = 0; i + 1 < secs.length; i++) {
    const A = rings[i]
    const B = rings[i + 1]
    const za = secs[i].z
    const zb = secs[i + 1].z
    // (the lamps wrap round the corners: the band just under the beltline near each end)
    const lamp = secs[i].s > L - 0.24 ? 1 : secs[i + 1].s < 0.2 ? 2 : 0
    for (let k = 0; k + 1 < n; k++) {
      const band = lamp && (k === 3 || k === n - 5)
      const isTrim = band || A[k][2] === 0 || A[k + 1][2] === 0
      const pt = isTrim ? trim : paint
      const col = band ? (lamp === 1 ? HEAD_WRAP : TAIL) : isTrim ? TRIM : WHITE
      // (counter-clockwise from outside: rear section a, front section b; the ring runs over
      // the top from right to left)
      quad(pt, [A[k][0], A[k][1], za], [A[k + 1][0], A[k + 1][1], za], [B[k + 1][0], B[k + 1][1], zb], [B[k][0], B[k][1], zb], col, band ? lamp : 0)
    }
    // the underside (dark): the ring's two bottom points
    quad(trim, [A[0][0], A[0][1], za], [B[0][0], B[0][1], zb], [B[n - 1][0], B[n - 1][1], zb], [A[n - 1][0], A[n - 1][1], za], BLACK)
  }
  // end caps (fans to each end section's middle)
  for (const [sec, ring, front] of [[secs[0], rings[0], false], [secs[secs.length - 1], rings[rings.length - 1], true]]) {
    let cy = 0
    for (const p of ring) cy += p[1]
    cy /= ring.length
    const c = [0, cy, sec.z]
    for (let k = 0; k + 1 < n; k++) {
      const a = [ring[k][0], ring[k][1], sec.z]
      const b = [ring[k + 1][0], ring[k + 1][1], sec.z]
      const i0 = vtx(paint, ...c, WHITE)
      const i1 = vtx(paint, ...a, WHITE)
      const i2 = vtx(paint, ...b, WHITE)
      if (front) paint.I.push(i0, i1, i2)
      else paint.I.push(i0, i2, i1)
    }
  }
  // the glass: a skin a little proud of the body over the glasshouse, leaving the pillars
  const glassUp = 0.012
  const cabin = secs.filter((q) => q.cabin)
  if (cabin.length >= 2) {
    const s0 = cabin[0].s
    const s1 = cabin[cabin.length - 1].s
    // the B pillar about 45% along the roof (two doors' worth of window each side)
    const roofKeys = spec.top.filter((k) => k[2] === "roof")
    const r0 = roofKeys.length ? roofKeys[0][0] : (s0 + s1) / 2
    const r1 = roofKeys.length ? roofKeys[roofKeys.length - 1][0] : (s0 + s1) / 2
    const bp = r0 + (r1 - r0) * 0.48
    for (let i = 0; i + 1 < secs.length; i++) {
      const a = secs[i]
      const b = secs[i + 1]
      const both = a.cabin && b.cabin
      const mid = (a.s + b.s) / 2
      // side windows: between the belt and the roof's edge, inset from the pillars
      const inSide = both && mid > s0 + 0.09 && mid < s1 - 0.07 && Math.abs(mid - bp) > 0.07
      if (inSide) {
        for (const side of [1, -1]) {
          const P = (sec, f) => {
            const lo = sec.pts[5]
            const hi = sec.pts[6]
            const t = 0.1 + f * 0.8
            return [(lo[0] + (hi[0] - lo[0]) * t + glassUp) * side, lo[1] + (hi[1] - lo[1]) * t, sec.z]
          }
          if (side > 0) quad(paint, P(a, 0), P(a, 1), P(b, 1), P(b, 0), GLASS)
          else quad(paint, P(b, 0), P(b, 1), P(a, 1), P(a, 0), GLASS)
        }
      }
      // the windshield and the rear window: across the top of the sloped sections
      if (a.zone === "glass" && b.zone === "glass" && a.top - a.belt > 0.04 && b.top - b.belt > 0.04) {
        // (from a little in from the roof's edge, so the pillars stay painted, over the middle;
        // lifted 2 cm off the body)
        const pa = (sec, j, sgn) => {
          const p = j === 6 ? sec.pts[6].map((v, i) => (i < 2 ? v + (sec.pts[7][i] - v) * 0.3 : v)) : sec.pts[j]
          return [p[0] * sgn, p[1] + 0.022, sec.z]
        }
        for (let k = 6; k < 9; k++) {
          quad(paint, pa(a, k, 1), pa(a, k + 1, 1), pa(b, k + 1, 1), pa(b, k, 1), GLASS)
          quad(paint, pa(a, k + 1, -1), pa(a, k, -1), pa(b, k, -1), pa(b, k + 1, -1), GLASS)
        }
      }
    }
  }
  // the pickup's bed: a dark cover over the bed rails, a tailgate line
  if (spec.top.some((k) => k[2] === "bed")) {
    const bedEnd = spec.top.filter((k) => k[2] === "bed").pop()[0]
    const z0 = -spec.rear - spec.wb / 2 + 0.06
    const z1 = bedEnd - spec.rear - spec.wb / 2
    const y = topAt(spec, 1).y + 0.025
    const w = spec.wid / 2 - 0.1
    quad(trim, [-w, y, z0], [w, y, z0], [w, y, z1], [-w, y, z1], rgb(0x202123))
  }
  return { secs, L }
}

// a wheel at the origin, axle along x: a rounded tire and a five-spoke rim -> part
export const wheelPart = (R, width = 0.23, seg = 12) => {
  const pt = part()
  // the tire's profile (x across, r out), turned round the axle
  const prof = [[-width / 2, R * 0.66], [-width / 2 + 0.02, R * 0.94], [-width / 2 + 0.07, R], [width / 2 - 0.07, R], [width / 2 - 0.02, R * 0.94], [width / 2, R * 0.66]]
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2
    const a1 = ((i + 1) / seg) * Math.PI * 2
    for (let k = 0; k + 1 < prof.length; k++) {
      const [x0, r0] = prof[k]
      const [x1, r1] = prof[k + 1]
      const p = (x, r, a) => [x, Math.cos(a) * r, Math.sin(a) * r]
      quad(pt, p(x0, r0, a0), p(x0, r0, a1), p(x1, r1, a1), p(x1, r1, a0), RUBBER)
    }
  }
  // the rim (its outer face, +x; the left wheels are turned round): the lip, five spokes, a hub
  for (const side of [1]) {
    const x = (side * width) / 2 - side * 0.035
    const rr = R * 0.66
    const disc = (r0, r1, a0, a1, col, dx = 0) => {
      const p = (r, a) => [x + dx * side, Math.cos(a) * r, Math.sin(a) * r]
      if (side > 0) quad(pt, p(r0, a0), p(r0, a1), p(r1, a1), p(r1, a0), col)
      else quad(pt, p(r0, a1), p(r0, a0), p(r1, a0), p(r1, a1), col)
    }
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2
      const a1 = ((i + 1) / seg) * Math.PI * 2
      disc(rr * 0.86, rr, a0, a1, RIM)
      disc(rr * 0.22, rr * 0.86, a0, a1, BLACK, -0.04) // (the dark inside of the wheel, behind the spokes)
      disc(0, rr * 0.22, a0, a1, HUB, 0.004)
    }
    for (let s = 0; s < 5; s++) {
      const a = (s / 5) * Math.PI * 2
      const half = 0.13
      disc(rr * 0.2, rr * 0.88, a - half, a + half, RIM, 0.002)
    }
  }
  return pt
}

// the lamps, grille, plates and mirrors (on the flat end faces: proud of them by a centimetre)
const buildDetails = (spec, body, paint, trim) => {
  const zf = spec.len - spec.rear - spec.wb / 2
  const zr = -spec.rear - spec.wb / 2
  const W = spec.wid / 2
  const first = body.secs[0]
  const last = body.secs[body.secs.length - 1]
  // the end faces' outlines at the lamp band (ring points 3 and 4)
  const fLo = last.pts[3][1]
  const fHi = last.pts[4][1]
  const rLo = first.pts[3][1]
  const rHi = first.pts[4][1]
  const fw = last.W
  const rw = first.W
  for (const s of [1, -1]) {
    // headlights (glow 1): the outer part of the front face at the band
    box(trim, s * fw * 0.66, (fLo + fHi) / 2 + 0.01, zf - 0.025, fw * 0.5 + 0.05, (fHi - fLo) * 0.8 + 0.04, 0.05, BEZEL)
    box(trim, s * fw * 0.66, (fLo + fHi) / 2 + 0.01, zf - 0.02, fw * 0.5, (fHi - fLo) * 0.8, 0.06, HEAD, 1)
    // (the projector: a bright round-ish block in each lamp)
    box(trim, s * fw * 0.74, (fLo + fHi) / 2 + 0.01, zf - 0.015, 0.09, (fHi - fLo) * 0.5, 0.06, rgb(0xf4f7f9), 1)
    // tail lights (glow 2)
    box(trim, s * rw * 0.62, (rLo + rHi) / 2 + 0.02, zr + 0.02, rw * 0.6, (rHi - rLo) * 0.85, 0.06, TAIL, 2)
    // amber side markers just behind the front corners
    box(trim, s * (W * 0.985), fLo + 0.02, zf - 0.36, 0.03, 0.045, 0.1, AMBER)
  }
  // the grille between the headlights, the lower intake, the plates
  box(trim, 0, (fLo + fHi) / 2, zf - 0.02, fw * 0.62, (fHi - fLo) * 0.75, 0.06, BLACK)
  box(trim, 0, spec.ride + 0.22, zf - 0.02, fw * 1.05, 0.11, 0.06, BLACK)
  box(trim, 0, spec.ride + 0.36, zf - 0.01, 0.32, 0.15, 0.04, PLATE)
  box(trim, 0, rLo - 0.12, zr + 0.01, 0.32, 0.15, 0.04, PLATE)
  // the bumpers' lower dark lip front and rear
  box(trim, 0, spec.ride + 0.12, zf - 0.12, W * 1.6, 0.08, 0.26, TRIM)
  box(trim, 0, spec.ride + 0.12, zr + 0.12, W * 1.6, 0.08, 0.26, TRIM)
  // mirrors at the foot of the windshield
  const k = spec.top.findIndex((q, i) => q[2] === "glass" && spec.top[i + 1]?.[2] === "hood")
  const mz = (k >= 0 ? spec.top[k][0] : spec.len * 0.6) - spec.rear - spec.wb / 2 - 0.1
  for (const s of [1, -1]) {
    box(paint, s * (W + 0.07), spec.belt + 0.09, mz, 0.17, 0.12, 0.09, WHITE)
    box(trim, s * (W - 0.01), spec.belt + 0.05, mz + 0.02, 0.07, 0.04, 0.12, BLACK)
  }
}

// a part's arrays -> { position, color, glow, index } typed
const finish = (pt) => ({ position: new Float32Array(pt.P), color: new Float32Array(pt.C), glow: new Float32Array(pt.G), index: pt.P.length / 3 > 65535 ? new Uint32Array(pt.I) : new Uint16Array(pt.I) })

// a whole car (model id) -> { paint, trim, wheel, wheels: [{ x, y, z, front }], spec, tris }
export const carParts = (model) => {
  const spec = CAR_SPECS[model] || CAR_SPECS.sedan
  const paint = part()
  const trim = part()
  const body = buildBody(spec, paint, trim)
  buildDetails(spec, body, paint, trim)
  const half = spec.wb / 2
  const tx = spec.wid / 2 - 0.16
  const wheels = [
    { x: tx, y: spec.R, z: half, front: true },
    { x: -tx, y: spec.R, z: half, front: true },
    { x: tx, y: spec.R, z: -half, front: false },
    { x: -tx, y: spec.R, z: -half, front: false },
  ]
  const wheel = wheelPart(spec.R)
  const out = { spec, paint: finish(paint), trim: finish(trim), wheel: finish(wheel), wheels }
  out.tris = (out.paint.index.length + out.trim.index.length + out.wheel.index.length * 4) / 3
  return out
}
