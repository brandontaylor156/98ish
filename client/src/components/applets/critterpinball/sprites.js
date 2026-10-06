// Critter sprites, drawn by code: every critter is a little front-facing pixel monster in
// a 32 x 32 grid, built from a body plan (round, pear, quad, bird, fish, bug, ghost...) plus
// ears, tail and markings, in its color families. Shapes are shaded from the top-left with
// ordered dithering (like the table) and outlined in ink, so they sit in the same 90s
// handheld look. Pure (palette indices only), so Node's tests and the Dex can draw them.
//
// buildSprite(spec) -> { w, h, data } for pixel.js blit(); silhouette(sprite, color) gives
// the shape in one color (the catch screen's mystery critter).

import { C, bayer } from "../pinball/pixel.js"

export const SPRITE_SIZE = 32

// color families: [dark, mid, light]
export const FAMILIES = {
  red: [C.red1, C.red, C.red3],
  fire: [C.red, C.fire, C.amber],
  orange: [C.brn, C.orange, C.amber],
  yellow: [C.yellow1, C.yellow, C.cream],
  green: [C.green1, C.green, C.lime],
  moss: [C.olive, C.moss, C.mint],
  teal: [C.teal2, C.teal4, C.cyan],
  blue: [C.navy, C.blue2, C.blue3],
  sky: [C.sky, C.sky2, C.cyan2],
  ice: [C.sky2, C.cyan2, C.ice],
  purple: [C.pur1, C.pur, C.pur3],
  pink: [C.mag1, C.mag, C.pinkhi],
  salmon: [C.red, C.pink, C.peach],
  brown: [C.brn1, C.brn, C.brn3],
  sand: [C.sand0, C.sand, C.sand3],
  grey: [C.g3, C.g5, C.g7],
  white: [C.g5, C.g7, C.white],
  cream: [C.beige1, C.beige, C.beige3],
  dark: [C.g1, C.g2, C.g4],
  navy: [C.navy0, C.navy1, C.navy],
}

// Body plans in a 32-unit space, feet at y = 30. Each gives the parts to paint (back to
// front) and where the head is, for ears, eyes and markings.
const PLANS = {
  round: () => ({ head: { cx: 16, cy: 18, rx: 11, ry: 10 }, parts: [["e", 16, 18, 11, 10.5, "main"]], feet: [[11, 28.5], [21, 28.5]] }),
  pear: () => ({ head: { cx: 16, cy: 12, rx: 8.5, ry: 7.5 }, parts: [["e", 16, 23, 8.5, 7, "main"], ["e", 16, 12, 8.5, 7.5, "main"]], feet: [[11.5, 29], [20.5, 29]], arms: [[7.5, 21], [24.5, 21]] }),
  quad: () => ({
    head: { cx: 16, cy: 12, rx: 8, ry: 7 },
    parts: [["r", 7, 24, 3, 6, "dark"], ["r", 22, 24, 3, 6, "dark"], ["e", 16, 21, 11, 6.5, "main"], ["r", 10, 25, 3, 5, "main"], ["r", 19, 25, 3, 5, "main"], ["e", 16, 12, 8, 7, "main"]],
  }),
  bird: () => ({
    head: { cx: 16, cy: 12, rx: 7, ry: 6.5 },
    parts: [["p", [[9, 15], [1, 22], [4, 24], [10, 22]], "dark"], ["p", [[23, 15], [31, 22], [28, 24], [22, 22]], "dark"], ["e", 16, 20, 8, 8.5, "main"], ["e", 16, 12, 7, 6.5, "main"], ["p", [[14, 14], [18, 14], [16, 18]], "acc"]],
    feet: [[13, 29.5], [19, 29.5]],
    footColor: "acc",
  }),
  fish: () => ({
    head: { cx: 16, cy: 15, rx: 9, ry: 8 },
    parts: [["p", [[16, 2], [12, 8], [20, 8]], "acc"], ["p", [[7, 16], [1, 12], [2, 22]], "acc"], ["p", [[25, 16], [31, 12], [30, 22]], "acc"], ["p", [[12, 25], [16, 30], [20, 25]], "acc"], ["e", 16, 16, 10, 10, "main"]],
  }),
  serpent: () => ({ head: { cx: 16, cy: 10, rx: 7, ry: 6 }, parts: [["e", 16, 26, 13, 4.5, "main"], ["e", 16, 21, 9, 4, "main"], ["r", 12, 11, 8, 12, "main"], ["e", 16, 10, 7, 6, "main"]] }),
  ghost: () => ({ head: { cx: 16, cy: 14, rx: 10, ry: 10 }, parts: [["g", 16, 14, 10, 10, "main"]], arms: [[5.5, 18], [26.5, 18]] }),
  bug: () => ({ head: { cx: 16, cy: 11, rx: 6, ry: 5.5 }, parts: [["e", 16, 21, 7, 8.5, "main"], ["e", 16, 11, 6, 5.5, "main"]], legs: true }),
  rock: () => ({ head: { cx: 16, cy: 16, rx: 10, ry: 9 }, parts: [["p", [[9, 6], [23, 6], [28, 13], [27, 25], [21, 30], [11, 30], [5, 25], [4, 13]], "main"]], rocky: true }),
  jelly: () => ({ head: { cx: 16, cy: 12, rx: 11, ry: 9 }, parts: [["t", 16, 13, 11, 9.5, "main"]], tentacles: true }),
  crab: () => ({
    head: { cx: 16, cy: 19, rx: 10, ry: 6 },
    parts: [["e", 5, 12, 4.5, 4, "acc"], ["e", 27, 12, 4.5, 4, "acc"], ["r", 6, 15, 3, 5, "acc"], ["r", 23, 15, 3, 5, "acc"], ["e", 16, 20, 11, 6.5, "main"]],
    legs: true,
    stalks: true,
  }),
  turtle: () => ({ head: { cx: 16, cy: 9, rx: 6, ry: 5 }, parts: [["e", 16, 9, 6, 5, "belly"], ["e", 16, 20, 12.5, 8.5, "main"], ["e", 7, 28, 3, 2.5, "belly"], ["e", 25, 28, 3, 2.5, "belly"]], shell: true, headIsBelly: true }),
  plant: () => ({ head: { cx: 16, cy: 13, rx: 8.5, ry: 7.5 }, parts: [["e", 16, 24, 8, 6, "acc"], ["e", 16, 13, 8.5, 7.5, "main"]], feet: [[11, 29], [21, 29]] }),
}

const LIGHT_X = -0.6
const LIGHT_Y = -0.8

// A sprite from a spec:
//   { plan, main, acc, belly, ears, tail, eyes, marks: [...], size }
export const buildSprite = (spec) => {
  const N = SPRITE_SIZE
  const role = new Int8Array(N * N).fill(-1) // which color role each pixel has
  const part = new Int16Array(N * N).fill(-1)
  const shade = new Float32Array(N * N)
  const fam = {
    main: FAMILIES[spec.main] || FAMILIES.grey,
    acc: FAMILIES[spec.acc || spec.main] || FAMILIES.grey,
    belly: FAMILIES[spec.belly || "cream"],
  }
  const ROLES = ["main", "acc", "belly", "dark", "ink", "white", "eye"]
  const R = Object.fromEntries(ROLES.map((r, i) => [r, i]))
  const plan = (PLANS[spec.plan] || PLANS.round)()
  const s = spec.size ?? 1
  // shapes are authored at full size and scaled about the feet
  const X = (x) => 16 + (x - 16) * s
  const Y = (y) => 30.5 + (y - 30.5) * s
  let partNo = 0

  const put = (x, y, r, light = 0.5) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return
    const i = y * N + x
    role[i] = R[r] ?? R.main
    part[i] = partNo
    shade[i] = light
  }
  const box = (x0, y0, x1, y1, fn) => {
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(N - 1, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(N - 1, Math.ceil(x1)); x++) fn(x, y, x + 0.5, y + 0.5)
  }
  // an ellipse, shaded like a ball lit from the top-left
  const ell = (cx, cy, rx, ry, r, cut) => {
    cx = X(cx)
    cy = Y(cy)
    rx *= s
    ry *= s
    box(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1, (x, y, px, py) => {
      const nx = (px - cx) / rx
      const ny = (py - cy) / ry
      const d = nx * nx + ny * ny
      if (d > 1) return
      if (cut && !cut(nx, ny, px, py)) return
      const lit = 0.55 - 0.5 * (nx * LIGHT_X + ny * LIGHT_Y)
      put(x, y, r, lit)
    })
    partNo++
  }
  const inPoly = (pts, x, y) => {
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]
      const [xj, yj] = pts[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }
  const poly = (pts, r) => {
    const q = pts.map(([x, y]) => [X(x), Y(y)])
    const xs = q.map((p) => p[0])
    const ys = q.map((p) => p[1])
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    const y0 = Math.min(...ys)
    const y1 = Math.max(...ys)
    box(x0, y0, x1, y1, (x, y, px, py) => {
      if (!inPoly(q, px, py)) return
      const lit = 0.6 - 0.35 * ((px - x0) / Math.max(1, x1 - x0) - 0.5) * 2 * 0.5 - 0.35 * ((py - y0) / Math.max(1, y1 - y0) - 0.3)
      put(x, y, r, lit)
    })
    partNo++
  }
  const rct = (x, y, w, h, r) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], r)

  const draw = (p) => {
    const [kind, ...a] = p
    if (kind === "e") ell(a[0], a[1], a[2], a[3], a[4])
    else if (kind === "p") poly(a[0], a[1])
    else if (kind === "r") rct(a[0], a[1], a[2], a[3], a[4])
    else if (kind === "g") {
      // a ghost: a round top and a wavy hem
      const [cx, cy, rx, ry, r] = a
      ell(cx, cy, rx, ry, r, (nx, ny, px) => ny < 0.15 || Math.sin(px * 1.4) * 0.12 + 0.95 > ny)
      partNo--
      rct(cx - rx, cy, rx * 2, ry * 0.95, r)
      // cut the hem's waves
      for (let x = 0; x < N; x++) {
        const hem = Math.round(Y(cy + ry * 0.95) - (Math.sin(x * 1.3) > 0 ? 0 : 2 * s))
        for (let y = hem; y < N; y++) if (part[y * N + x] === partNo - 1) role[y * N + x] = -1
      }
    } else if (kind === "t") {
      // a dome (jellyfish bell)
      const [cx, cy, rx, ry, r] = a
      ell(cx, cy, rx, ry, r, (nx, ny) => ny < 0.45)
    }
  }

  const h = plan.head
  const head = { cx: X(h.cx), cy: Y(h.cy), rx: h.rx * s, ry: h.ry * s }

  // ---- behind the body: tail and wings ----
  const tail = spec.tail || "none"
  const tc = tail === "flame" ? "acc" : tail === "leaf" ? "acc" : tail === "bolt" ? "acc" : "main"
  if (tail === "flame") {
    poly([[24, 26], [29, 14], [27, 9], [31, 6], [30, 15], [27, 27]], "acc")
    poly([[26, 22], [28, 15], [29, 18]], "white")
  } else if (tail === "leaf") poly([[22, 25], [30, 13], [31, 20], [25, 28]], "acc")
  else if (tail === "bolt") poly([[22, 24], [27, 21], [25, 17], [31, 11], [28, 18], [30, 20], [24, 27]], "acc")
  else if (tail === "fluffy") ell(26, 24, 5, 4.5, "belly")
  else if (tail === "long") poly([[22, 26], [30, 22], [31, 16], [29, 15], [28, 21], [22, 23]], tc)
  else if (tail === "curl") {
    ell(27, 20, 4.5, 4.5, "main")
    ell(27, 20, 2, 2, "dark")
  } else if (tail === "fish") poly([[20, 25], [29, 30], [31, 22]], "acc")

  const marks = new Set(spec.marks || [])
  if (marks.has("wings")) {
    ell(5, 15, 5, 8, "belly")
    ell(27, 15, 5, 8, "belly")
  }

  // ---- ears, horns and crests (behind the head's outline) ----
  const ears = spec.ears || "none"
  const ex = h.rx * 0.62
  const top = h.cy - h.ry
  const earPoly = (pts, r) => {
    poly(pts.map(([x, y]) => [h.cx - x, y]), r)
    poly(pts.map(([x, y]) => [h.cx + x, y]), r)
  }
  if (ears === "pointy") earPoly([[ex - 3, top + 3], [ex + 2, top - 6], [ex + 3.5, top + 4]], "main")
  else if (ears === "long") earPoly([[ex - 2.5, top + 3], [ex - 1, top - 9], [ex + 2.5, top - 9], [ex + 2.5, top + 4]], "main")
  else if (ears === "round") {
    ell(h.cx - ex - 1, top + 1.5, 3.5, 3.5, "main")
    ell(h.cx + ex + 1, top + 1.5, 3.5, 3.5, "main")
  } else if (ears === "horns") earPoly([[ex - 2, top + 2], [ex + 3, top - 7], [ex + 2, top + 3]], "white")
  else if (ears === "antennae") {
    earPoly([[ex - 3, top + 1], [ex + 1, top - 7], [ex + 1.6, top - 6.5], [ex - 2, top + 2]], "dark")
    ell(h.cx - ex - 1.3, top - 7, 1.8, 1.8, "acc")
    ell(h.cx + ex + 1.3, top - 7, 1.8, 1.8, "acc")
  } else if (ears === "leaf") {
    poly([[h.cx - 1, top + 2], [h.cx - 8, top - 6], [h.cx - 2, top - 3]], "acc")
    poly([[h.cx + 1, top + 2], [h.cx + 8, top - 6], [h.cx + 2, top - 3]], "acc")
    poly([[h.cx - 1, top + 1], [h.cx, top - 8], [h.cx + 1, top + 1]], "acc")
  } else if (ears === "flame") {
    poly([[h.cx - 6, top + 3], [h.cx - 4, top - 5], [h.cx - 1, top - 1], [h.cx, top - 9], [h.cx + 2, top - 2], [h.cx + 4, top - 6], [h.cx + 6, top + 3]], "acc")
  } else if (ears === "fins") earPoly([[h.rx - 2, h.cy - 2], [h.rx + 5, h.cy - 6], [h.rx + 3, h.cy + 3]], "acc")
  else if (ears === "crest") poly([[h.cx - 3, top + 2], [h.cx, top - 8], [h.cx + 3, top + 2]], "acc")
  else if (ears === "crown") {
    poly([[h.cx - 6, top + 2], [h.cx - 6, top - 4], [h.cx - 3, top - 1], [h.cx, top - 6], [h.cx + 3, top - 1], [h.cx + 6, top - 4], [h.cx + 6, top + 2]], "acc")
  } else if (ears === "spikes") {
    for (const dx of [-6, -2, 2, 6]) poly([[h.cx + dx - 2.5, top + 3], [h.cx + dx, top - 5], [h.cx + dx + 2.5, top + 3]], "acc")
  }

  // ---- the body ----
  if (plan.legs) {
    for (const sx of [-1, 1]) for (const k of [0, 1, 2]) poly([[16 + sx * 5, 18 + k * 4], [16 + sx * 13, 21 + k * 4], [16 + sx * 13, 22.5 + k * 4], [16 + sx * 5, 20 + k * 4]], "dark")
  }
  if (plan.stalks) {
    rct(11, 9, 1.5, 6, "dark")
    rct(19.5, 9, 1.5, 6, "dark")
    ell(11.7, 8.5, 2.2, 2.2, "white")
    ell(20.3, 8.5, 2.2, 2.2, "white")
  }
  for (const p of plan.parts) draw(p)
  if (plan.tentacles) for (const x of [9, 13, 16, 19, 23]) poly([[x - 1, 16], [x + 1, 16], [x + 0.6 + Math.sin(x) * 1.5, 30], [x - 0.6 + Math.sin(x) * 1.5, 30]], "acc")
  if (plan.feet) for (const [fx, fy] of plan.feet) ell(fx, fy, 3, 1.8, plan.footColor || "dark")
  if (plan.arms && !marks.has("claws")) for (const [ax, ay] of plan.arms) ell(ax, ay, 2.3, 3, "main")
  if (marks.has("claws")) {
    const arms = plan.arms || [[6, 20], [26, 20]]
    for (const [ax, ay] of arms) {
      ell(ax, ay, 3, 3.2, "main")
      poly([[ax - 2, ay + 2], [ax, ay + 5.5], [ax + 2, ay + 2]], "white")
    }
  }

  // ---- markings on the body ----
  const bodyCx = 16
  if (spec.belly && !plan.headIsBelly) {
    if (spec.plan === "round") ell(bodyCx, 23, 6.5, 5, "belly")
    else if (spec.plan === "pear" || spec.plan === "plant") ell(bodyCx, 24, 5.5, 4.5, "belly")
    else if (spec.plan === "bird") ell(bodyCx, 22, 5, 5.5, "belly")
    else if (spec.plan === "quad") ell(bodyCx, 22, 6, 3.5, "belly")
    else if (spec.plan === "fish") ell(bodyCx, 20, 6, 5, "belly")
    else if (spec.plan === "bug") ell(bodyCx, 22, 4, 6, "belly")
    else if (spec.plan === "serpent") ell(bodyCx, 17, 3, 6, "belly")
  }
  if (plan.shell) {
    // shell plates
    for (const [cx, cy] of [[16, 17], [10, 21], [22, 21], [16, 24]]) ell(cx, cy, 3.4, 2.6, "acc")
  }
  if (marks.has("stripes")) for (const y of [h.cy - h.ry * 0.7, h.cy - h.ry * 0.45]) rct(h.cx - 1, y, 2, 1.4, "dark")
  if (marks.has("spots")) for (const [x, y] of [[9, 22], [23, 21], [20, 26], [11, 26]]) ell(x, y, 1.3, 1.2, "acc")
  if (marks.has("gem")) {
    poly([[h.cx, h.cy - h.ry * 0.8], [h.cx - 2, h.cy - h.ry * 0.55], [h.cx, h.cy - h.ry * 0.3], [h.cx + 2, h.cy - h.ry * 0.55]], "acc")
  }
  if (marks.has("spikes")) for (const x of [7, 25]) poly([[x - 2, 22], [x + (x < 16 ? -5 : 5), 20], [x + 0.5, 26]], "white")
  if (plan.rocky) {
    for (const [ax, ay, bx, by] of [[9, 12, 12, 15], [22, 24, 25, 21], [12, 26, 14, 23]]) {
      const steps = 6
      for (let i = 0; i <= steps; i++) put(Math.round(X(ax + ((bx - ax) * i) / steps) - 0.5), Math.round(Y(ay + ((by - ay) * i) / steps) - 0.5), "dark", 0.2)
    }
  }

  // ---- the face ----
  const eyes = spec.eyes || "cute"
  const eyeY = Math.round(head.cy - 0.5 - (spec.plan === "fish" ? 1 : 0))
  const eyeDx = Math.max(2, Math.round(head.rx * 0.42))
  const ecx = Math.round(head.cx - 0.5)
  for (const sx of [-1, 1]) {
    const x = ecx + sx * eyeDx
    if (eyes === "sleepy") {
      put(x - 1, eyeY, "ink")
      put(x, eyeY, "ink")
      put(x + 1, eyeY, "ink")
    } else if (eyes === "fierce") {
      for (let i = -1; i <= 1; i++) put(x + i, eyeY - 1 + (sx * i > 0 ? 0 : -1) + 1, "ink")
      put(x - 1, eyeY + 1, "ink")
      put(x, eyeY + 1, "ink")
      put(x + 1, eyeY + 1, "ink")
      put(x, eyeY, "eye")
    } else if (eyes === "glow") {
      put(x, eyeY, "eye")
      put(x, eyeY + 1, "eye")
      put(x + (sx < 0 ? 1 : -1), eyeY, "eye")
      put(x + (sx < 0 ? 1 : -1), eyeY + 1, "eye")
    } else if (eyes === "round" && s > 0.7) {
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) put(x + i, eyeY + j, "ink")
      put(x - 1, eyeY - 1, "white")
    } else {
      // cute: tall and shiny
      put(x, eyeY - 1, "white")
      put(x, eyeY, "ink")
      put(x, eyeY + 1, "ink")
      put(x + (sx < 0 ? 1 : -1), eyeY, "ink")
      put(x + (sx < 0 ? 1 : -1), eyeY + 1, "ink")
      put(x + (sx < 0 ? 1 : -1), eyeY - 1, "ink")
    }
  }
  const my = eyeY + Math.max(2, Math.round(head.ry * 0.38))
  if (spec.plan !== "bird") {
    if (marks.has("fangs")) {
      put(ecx - 1, my, "ink")
      put(ecx, my, "ink")
      put(ecx + 1, my, "ink")
      put(ecx - 1, my + 1, "white")
      put(ecx + 1, my + 1, "white")
    } else if (marks.has("grin")) {
      for (let i = -2; i <= 2; i++) put(ecx + i, my + (Math.abs(i) === 2 ? -1 : 0), "ink")
    } else {
      put(ecx - 1, my, "ink")
      put(ecx + 1, my, "ink")
      put(ecx, my + 1, "ink")
    }
  }
  if (marks.has("cheeks")) {
    put(ecx - eyeDx - 1, my, "acc", 0.9)
    put(ecx - eyeDx - 2, my, "acc", 0.9)
    put(ecx + eyeDx + 1, my, "acc", 0.9)
    put(ecx + eyeDx + 2, my, "acc", 0.9)
  }
  if (marks.has("mask")) {
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      const x = ecx + sx * (eyeDx + 1 + i)
      const i0 = eyeY * N + x
      if (x >= 0 && x < N && role[i0] >= 0 && role[i0] !== R.ink && role[i0] !== R.white) role[i0] = R.dark
    }
  }

  // ---- colors, outline ----
  const data = new Int16Array(N * N).fill(-1)
  const famOf = (r) => (r === R.acc ? fam.acc : r === R.belly ? fam.belly : fam.main)
  const eyeColor = eyes === "glow" ? (spec.glow === "red" ? C.red3 : C.yellow) : C.ink
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x
      const r = role[i]
      if (r < 0) continue
      let c
      if (r === R.ink) c = C.ink
      else if (r === R.white) c = C.white
      else if (r === R.eye) c = eyeColor
      else if (r === R.dark) c = fam.main[0]
      else {
        // three bands, dithered only in a narrow strip where they meet
        const f = famOf(r)
        const v = Math.max(0, Math.min(1, shade[i])) * 2
        const band = Math.min(1, Math.floor(v))
        const frac = Math.max(0, Math.min(1, (v - band - 0.5) * 2.6 + 0.5))
        c = f[band + (frac > bayer(x, y) ? 1 : 0)]
      }
      // the outline: an edge pixel (next to empty space) is ink; a part over another gets a
      // dark seam where they meet
      const n = [i - N, i + N, x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1]
      let edge = x === 0 || y === 0 || x === N - 1 || y === N - 1
      let seam = false
      for (const j of n) {
        if (j < 0 || j >= N * N) continue
        if (role[j] < 0) edge = true
        else if (part[j] < part[i] && r !== R.ink && r !== R.white && r !== R.eye && role[j] !== r && famOf(role[j]) !== famOf(r)) seam = true
      }
      if (edge && r !== R.eye) c = C.ink
      else if (seam && r !== R.dark) c = famOf(r)[0]
      data[i] = c
    }
  }
  return { w: N, h: N, data }
}

// the shape in one color (the mystery critter on the catch screen, unseen Dex entries)
export const silhouette = (spr, color = C.ink) => ({ w: spr.w, h: spr.h, data: spr.data.map((c) => (c < 0 ? -1 : color)) })

// the sprite in white (a flash when hit)
export const flashed = (spr) => silhouette(spr, C.white)

// a critter's sprite (built once, then kept)
const cache = new WeakMap()
export const critterSprite = (critter) => {
  let spr = cache.get(critter.sprite)
  if (!spr) {
    spr = buildSprite(critter.sprite)
    cache.set(critter.sprite, spr)
  }
  return spr
}

// how many pixels the critter covers (tests: every critter is a real shape)
export const coverage = (spr) => spr.data.reduce((n, c) => n + (c >= 0 ? 1 : 0), 0)
