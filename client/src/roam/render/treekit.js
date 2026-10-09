// Roam: the town's own trees (docs/open-world.md "Trees"). The owner's look reference for
// Valencia: dense mature trees everywhere, sycamores and London planes turning yellow-orange in
// the fall, tall pines, round dark oaks and ficus, trimmed hedges in curbed islands. Each species
// is modelled in code (nothing downloaded): a trunk with its main limbs and a crown of leaf
// clusters, each cluster a handful of crossed leaf cards whose normals point out of the crown
// (so it lights like a soft volume, not a pile of cards). One geometry a species, drawn
// instanced, the leaf cards and the bark sharing one atlas (one draw a species).
//
// Far off, every tree is a billboard (two triangles) cut from the same species painted from the
// side (`paintImpostor`: the crown's own cards projected and shaded), so a town of thousands of
// trees costs a few draws.
//
// Pure geometry here (Node-tested); the atlas and the impostors need a 2D canvas (the browser).

import { hashStr, rng } from "../sim/parked.js"

// the atlas (pixels; DataTexture rows: row 0 is v 0): broad leaves, pine needles, bark, hedge
export const ATLAS = 512
export const REG = {
  leaves: [0, 0, 256, 256],
  needles: [256, 0, 256, 256],
  bark: [0, 256, 256, 256],
  hedge: [256, 256, 256, 256],
}
const uvOf = (reg, u, v) => {
  const [x, y, w, h] = REG[reg]
  return [(x + u * w) / ATLAS, (y + v * h) / ATLAS]
}

// the species: reference sizes (m) the geometry is built at; an instance is scaled to its own
// crown (the aerial's crown radius r -> height h: speciesSize)
export const SPECIES = {
  // sycamore / London plane: tall, an open upright crown on two or three leaders; deciduous
  plane: { h: 13, r: 4.2, bark: [0.78, 0.74, 0.66], leaf: [0.5, 0.62, 0.32], trunk: 4.2, leaders: 3, clusters: 13, cr: [1.5, 2.2], cards: 9, card: [1.7, 2.3], env: { y: 8.6, rx: 4.2, ry: 4.3 }, open: 0.35 },
  // coast live oak: low and wide, a dense dark dome on a short leaning trunk
  oak: { h: 8.5, r: 5.2, bark: [0.36, 0.31, 0.26], leaf: [0.3, 0.42, 0.22], trunk: 2.2, leaders: 4, clusters: 16, cr: [1.7, 2.4], cards: 10, card: [1.8, 2.4], env: { y: 5.4, rx: 5.2, ry: 3.1 }, open: 0.12 },
  // round evergreens (ficus, ash, Brisbane box, carrotwood): a full rounded crown
  round: { h: 9.5, r: 3.8, bark: [0.5, 0.46, 0.4], leaf: [0.36, 0.5, 0.26], trunk: 3.0, leaders: 3, clusters: 11, cr: [1.4, 2.0], cards: 10, card: [1.6, 2.1], env: { y: 6.1, rx: 3.8, ry: 3.4 }, open: 0.08 },
  // pines (Canary Island, Aleppo, Italian stone): a tall bare trunk, tufts of needles in whorls
  pine: { h: 19, r: 3.6, bark: [0.42, 0.33, 0.27], leaf: [0.27, 0.4, 0.27], trunk: 18.4, pine: true, clusters: 0, cr: [1.0, 1.5], cards: 8, card: [1.5, 2.0] },
  // shrubs (the aerial's small crowns): a low rounded bush
  shrub: { h: 1.5, r: 1, bark: [0.4, 0.35, 0.3], leaf: [0.38, 0.52, 0.27], trunk: 0, leaders: 0, clusters: 4, cr: [0.5, 0.65], cards: 7, card: [0.75, 0.95], env: { y: 0.85, rx: 0.85, ry: 0.6 }, open: 0 },
}
export const SPECIES_LIST = ["plane", "oak", "round", "pine"]

// a crown radius from the aerial (m) -> { h, r } for a species (real proportions: a sycamore
// about 1.5 times as tall as it is wide, an oak wider than tall, a pine 2.5 times)
export const speciesSize = (sp, r) => {
  const R = Math.max(1.2, Math.min(8, r))
  if (sp === "plane") return { r: R, h: Math.min(24, 3 + R * 2.4) }
  if (sp === "oak") return { r: R, h: Math.min(15, 2.5 + R * 1.25) }
  if (sp === "pine") return { r: Math.min(5.5, R), h: Math.min(26, 6 + R * 3.4) }
  if (sp === "shrub") return { r: R, h: Math.max(0.8, Math.min(2.2, R * 0.85)) }
  return { r: R, h: Math.min(18, 2.5 + R * 1.9) }
}

// ---- geometry ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

// a species -> { position, normal, uv, color, leafy, index, cards } (cards: the leaf cards for
// the impostor painter: { p, n, s, rot, ao, needles })
export const speciesArrays = (name, seed = 1) => {
  const S = SPECIES[name]
  const rand = rng(hashStr(`tree:${name}:${seed}`))
  const P = []
  const N = []
  const U = []
  const C = []
  const L = []
  const I = []
  const cards = []
  const limbs = []
  const vert = (p, n, uv, col, leafy) => {
    P.push(...p)
    N.push(...n)
    U.push(...uv)
    C.push(...col)
    L.push(leafy)
    return P.length / 3 - 1
  }
  // a tapered tube from a to b (radii ra, rb), 6 sides, bark UVs
  const tube = (a, b, ra, rb, col, sides = 6) => {
    const d = norm(sub(b, a))
    const ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
    const e1 = norm(cross(d, ref))
    const e2 = cross(d, e1)
    const len = Math.hypot(...sub(b, a))
    const base = P.length / 3
    for (let k = 0; k <= sides; k++) {
      const t = (k / sides) * Math.PI * 2
      const ca = Math.cos(t)
      const sa = Math.sin(t)
      const n = [e1[0] * ca + e2[0] * sa, e1[1] * ca + e2[1] * sa, e1[2] * ca + e2[2] * sa]
      vert([a[0] + n[0] * ra, a[1] + n[1] * ra, a[2] + n[2] * ra], n, uvOf("bark", k / sides, 0.02), col, 0)
      vert([b[0] + n[0] * rb, b[1] + n[1] * rb, b[2] + n[2] * rb], n, uvOf("bark", k / sides, Math.min(0.98, 0.02 + len / 6)), col, 0)
    }
    for (let k = 0; k < sides; k++) {
      const i = base + k * 2
      I.push(i, i + 2, i + 1, i + 1, i + 2, i + 3)
    }
    limbs.push({ a, b, ra, rb })
  }
  // one leaf card at p (size s), turned at random, its normal out of the crown from c
  const card = (p, s, c, reg, ao) => {
    const yaw = rand() * Math.PI
    const tilt = (rand() - 0.5) * 1.3
    const ax = [Math.cos(yaw), 0, Math.sin(yaw)]
    const up = norm([-Math.sin(yaw) * Math.sin(tilt), Math.cos(tilt), Math.cos(yaw) * Math.sin(tilt)])
    // (out of the crown, tipped up a little: the top of a tree catches the sky)
    const out = sub(p, c)
    const n = norm([out[0], out[1] * 0.8 + Math.hypot(out[0], out[2]) * 0.25 + 0.4, out[2]])
    const h = s / 2
    const col = [ao, ao, ao]
    const base = P.length / 3
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]
    for (const [cu, cv] of corners) vert([p[0] + ax[0] * cu * h + up[0] * cv * h, p[1] + ax[1] * cu * h + up[1] * cv * h, p[2] + ax[2] * cu * h + up[2] * cv * h], n, uvOf(reg, (cu + 1) / 2, (cv + 1) / 2), col, 1)
    I.push(base, base + 1, base + 2, base, base + 2, base + 3)
    cards.push({ p, n, s, ao, needles: reg === "needles" })
  }
  const bark = S.bark
  if (S.pine) {
    // a tall straight trunk, whorls of branches with tufts of needles, wider low down
    const top = S.trunk
    const lean = [(rand() - 0.5) * 0.6, 0, (rand() - 0.5) * 0.6]
    tube([0, -0.3, 0], [lean[0], top, lean[2]], 0.34, 0.08, bark, 7)
    const y0 = S.h * 0.36
    const whorls = 9
    for (let w = 0; w < whorls; w++) {
      const f = w / (whorls - 1)
      const y = y0 + (top - y0) * f + (rand() - 0.5) * 0.8
      const R = 0.5 + S.r * Math.pow(1 - f, 0.75) * (0.85 + rand() * 0.3)
      const n = w === whorls - 1 ? 1 : 3 + Math.floor(rand() * 3)
      const a0 = rand() * Math.PI * 2
      const tk = [lean[0] * (y / top), y, lean[2] * (y / top)]
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * Math.PI * 2 + (rand() - 0.5) * 0.6
        const r = w === whorls - 1 ? 0 : R * (0.7 + rand() * 0.35)
        const tip = [tk[0] + Math.cos(a) * r, y + r * 0.25 - 0.2, tk[2] + Math.sin(a) * r]
        if (r > 0.6) tube(tk, tip, 0.1, 0.04, bark, 4)
        // (a tuft: needle cards round the branch's end, darker inside and low)
        const cr = S.cr[0] + rand() * (S.cr[1] - S.cr[0])
        for (let q = 0; q < S.cards; q++) {
          const p = [tip[0] + (rand() - 0.5) * cr * 1.6, tip[1] + (rand() - 0.35) * cr * 0.9, tip[2] + (rand() - 0.5) * cr * 1.6]
          const ao = 0.62 + 0.38 * Math.min(1, (p[1] / S.h) * 0.6 + Math.hypot(p[0], p[2]) / (S.r * 1.6))
          card(p, S.card[0] + rand() * (S.card[1] - S.card[0]), [tk[0], y - 1.5, tk[2]], "needles", ao)
        }
      }
    }
  } else {
    // the trunk and its main limbs, up into the crown
    const { y: cy, rx, ry } = S.env
    const c = [0, cy, 0]
    const tr = S.trunk
    const lean = [(rand() - 0.5) * 0.5, 0, (rand() - 0.5) * 0.5]
    const fork = [lean[0], tr, lean[2]]
    if (tr > 0) {
      tube([0, -0.3, 0], fork, name === "oak" ? 0.42 : 0.3, name === "oak" ? 0.32 : 0.22, bark, 7)
      for (let k = 0; k < S.leaders; k++) {
        const a = (k / S.leaders) * Math.PI * 2 + rand() * 0.8
        const out = rx * (0.35 + rand() * 0.25)
        const end = [fork[0] + Math.cos(a) * out, cy + ry * (0.05 + rand() * 0.35), fork[2] + Math.sin(a) * out]
        tube(fork, end, name === "oak" ? 0.24 : 0.17, 0.06, bark, 5)
      }
    }
    // the leaf clusters: spread through the crown's envelope, most near its skin (the inside of
    // a tree is branches and shade), an open crown (plane) with gaps between its clusters
    const n = S.clusters
    for (let k = 0; k < n; k++) {
      let p
      for (let tries = 0; tries < 12; tries++) {
        const u = rand() * 2 - 1
        const t = rand() * Math.PI * 2
        const sr = Math.sqrt(1 - u * u)
        const depth = 0.55 + 0.45 * Math.sqrt(rand())
        p = [Math.cos(t) * sr * rx * depth, cy + u * ry * depth, Math.sin(t) * sr * rx * depth]
        // (not hanging below the crown's base by much)
        if (p[1] > tr + 0.6 || tr === 0) break
      }
      const cr = S.cr[0] + rand() * (S.cr[1] - S.cr[0])
      // (an open crown: some clusters pulled out into lobes)
      if (S.open && rand() < S.open) {
        const o = sub(p, c)
        p = [p[0] + o[0] * 0.25, p[1] + o[1] * 0.2, p[2] + o[2] * 0.25]
      }
      for (let q = 0; q < S.cards; q++) {
        const u = rand() * 2 - 1
        const t = rand() * Math.PI * 2
        const sr = Math.sqrt(1 - u * u)
        const d = cr * Math.cbrt(rand())
        const cp = [p[0] + Math.cos(t) * sr * d, p[1] + u * d * 0.8, p[2] + Math.sin(t) * sr * d]
        // (shade: darker low in the crown and toward its middle)
        const rel = sub(cp, c)
        const inner = Math.min(1, Math.hypot(rel[0] / rx, rel[1] / ry, rel[2] / rx))
        const ao = Math.max(0.42, Math.min(1, 0.5 + 0.35 * inner + 0.25 * ((cp[1] - (cy - ry)) / (2 * ry))))
        card(cp, S.card[0] + rand() * (S.card[1] - S.card[0]), c, name === "shrub" ? "hedge" : "leaves", ao)
      }
    }
  }
  const count = P.length / 3
  return {
    position: new Float32Array(P),
    normal: new Float32Array(N),
    uv: new Float32Array(U),
    color: new Float32Array(C),
    leafy: new Float32Array(L),
    index: count > 65535 ? new Uint32Array(I) : new Uint16Array(I),
    cards,
    limbs,
    h: S.h,
    r: S.r,
  }
}

// the trimmed hedge (a unit box, its top a little crowned) and its curbed island; UVs on the
// atlas's hedge region
export const hedgeArrays = () => {
  const P = []
  const N = []
  const U = []
  const I = []
  const faces = [
    [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ]
  const steps = 3
  for (const [n, a, b] of faces) {
    const base = P.length / 3
    for (let j = 0; j <= steps; j++)
      for (let i = 0; i <= steps; i++) {
        const u = i / steps - 0.5
        const v = j / steps - 0.5
        let p = [n[0] * 0.5 + a[0] * u + b[0] * v, n[1] * 0.5 + a[1] * u + b[1] * v + 0.5, n[2] * 0.5 + a[2] * u + b[2] * v]
        // (trimmed, but rounded at the edges: pull the corners in a little)
        const e = Math.max(Math.abs(u), Math.abs(v))
        const k = e > 0.4 ? 0.94 : 1
        p = [p[0] * (n[0] ? 1 : k), n[1] ? p[1] : 0.5 + (p[1] - 0.5) * k, p[2] * (n[2] ? 1 : k)]
        // (soft normals: the face's, bent toward the corner it's near, and up)
        const nn = norm([n[0] + a[0] * u * 0.8 + b[0] * v * 0.8, n[1] + a[1] * u * 0.8 + b[1] * v * 0.8 + 0.35, n[2] + a[2] * u * 0.8 + b[2] * v * 0.8])
        P.push(...p)
        N.push(...nn)
        U.push(...uvOf("hedge", (u + 0.5) * 0.98 + 0.01, (v + 0.5) * 0.98 + 0.01))
      }
    // (wound to face out: (b x a) . n > 0 keeps this order)
    const keep = cross(b, a)[0] * n[0] + cross(b, a)[1] * n[1] + cross(b, a)[2] * n[2] > 0
    for (let j = 0; j < steps; j++)
      for (let i = 0; i < steps; i++) {
        const q = base + j * (steps + 1) + i
        if (keep) I.push(q, q + steps + 1, q + 1, q + 1, q + steps + 1, q + steps + 2)
        else I.push(q, q + 1, q + steps + 1, q + 1, q + steps + 2, q + steps + 1)
      }
  }
  return { position: new Float32Array(P), normal: new Float32Array(N), uv: new Float32Array(U), index: new Uint16Array(I) }
}

// ---- the atlas and the impostors (browser) ----
const canvas2d = (w, h) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h)
  if (typeof document !== "undefined") return Object.assign(document.createElement("canvas"), { width: w, height: h })
  return null
}

// a leaf: an ellipse with a darker midrib, luminance only (the species' colour comes later)
const leaf = (g, x, y, len, wid, rot, lum) => {
  g.save()
  g.translate(x, y)
  g.rotate(rot)
  const v = Math.round(lum * 255)
  g.fillStyle = `rgb(${v},${v},${v})`
  g.beginPath()
  g.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2)
  g.fill()
  const d = Math.round(lum * 200)
  g.strokeStyle = `rgb(${d},${d},${d})`
  g.lineWidth = Math.max(0.6, wid * 0.08)
  g.beginPath()
  g.moveTo(-len / 2, 0)
  g.lineTo(len / 2, 0)
  g.stroke()
  g.restore()
}

// the atlas -> { data: Uint8Array RGBA (ATLAS x ATLAS), w, h } or null (no canvas)
export const paintAtlas = () => {
  const cv = canvas2d(ATLAS, ATLAS)
  const g = cv?.getContext("2d")
  if (!g) return null
  const rand = rng(7)
  g.clearRect(0, 0, ATLAS, ATLAS)
  // broad leaves: a twig's worth in a rounded cloud, denser in the middle (alpha-tested)
  {
    const [x0, y0, w] = REG.leaves
    const cx = x0 + w / 2
    const cy = y0 + w / 2
    for (let i = 0; i < 420; i++) {
      const a = rand() * Math.PI * 2
      const r = w * 0.44 * Math.sqrt(rand())
      const len = 14 + rand() * 16
      leaf(g, cx + Math.cos(a) * r, cy + Math.sin(a) * r, len, len * (0.45 + rand() * 0.2), rand() * Math.PI, 0.55 + rand() * 0.45)
    }
  }
  // needles: bundles of fine strokes from a few centres
  {
    const [x0, y0, w] = REG.needles
    for (let b = 0; b < 26; b++) {
      const a0 = rand() * Math.PI * 2
      const r0 = w * 0.3 * Math.sqrt(rand())
      const bx = x0 + w / 2 + Math.cos(a0) * r0
      const by = y0 + w / 2 + Math.sin(a0) * r0
      for (let i = 0; i < 46; i++) {
        const a = rand() * Math.PI * 2
        const l = 18 + rand() * 30
        const v = Math.round((0.5 + rand() * 0.5) * 255)
        g.strokeStyle = `rgb(${v},${v},${v})`
        g.lineWidth = 1.6 + rand() * 1.2
        g.beginPath()
        g.moveTo(bx, by)
        g.lineTo(Math.max(x0 + 3, Math.min(x0 + w - 3, bx + Math.cos(a) * l)), Math.max(y0 + 3, Math.min(y0 + w - 3, by + Math.sin(a) * l)))
        g.stroke()
      }
    }
  }
  // bark: grey with vertical fissures and pale mottling (the species' colour multiplies it)
  {
    const [x0, y0, w, h] = REG.bark
    g.fillStyle = "rgb(205,205,205)"
    g.fillRect(x0, y0, w, h)
    for (let i = 0; i < 260; i++) {
      const v = Math.round((0.55 + rand() * 0.5) * 255)
      g.fillStyle = `rgb(${v},${v},${v})`
      g.beginPath()
      g.ellipse(x0 + rand() * w, y0 + rand() * h, 4 + rand() * 12, 6 + rand() * 18, 0, 0, Math.PI * 2)
      g.fill()
    }
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `rgba(60,60,60,${0.25 + rand() * 0.3})`
      g.lineWidth = 1 + rand() * 2
      const x = x0 + rand() * w
      g.beginPath()
      g.moveTo(x, y0)
      g.bezierCurveTo(x + (rand() - 0.5) * 20, y0 + h * 0.3, x + (rand() - 0.5) * 20, y0 + h * 0.6, x + (rand() - 0.5) * 16, y0 + h)
      g.stroke()
    }
  }
  // a clipped hedge: small leaves packed edge to edge over a dark ground (opaque)
  {
    const [x0, y0, w, h] = REG.hedge
    g.fillStyle = "rgb(70,70,70)"
    g.fillRect(x0, y0, w, h)
    g.save()
    g.beginPath()
    g.rect(x0, y0, w, h)
    g.clip()
    for (let i = 0; i < 1500; i++) leaf(g, x0 + rand() * w, y0 + rand() * h, 7 + rand() * 7, 4 + rand() * 3, rand() * Math.PI, 0.5 + rand() * 0.5)
    g.restore()
  }
  const img = g.getImageData(0, 0, ATLAS, ATLAS)
  const data = new Uint8Array(img.data.buffer.slice(0))
  bleed(data, ATLAS, ATLAS)
  return { data, w: ATLAS, h: ATLAS }
}

// transparent pixels take a neighbour's colour (so mipmaps don't fringe the leaves dark)
const bleed = (d, w, h) => {
  for (let pass = 0; pass < 6; pass++) {
    const src = d.slice()
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (src[i + 3] > 8 || src[i] > 0) continue
        let r = 0
        let gg = 0
        let b = 0
        let n = 0
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const j = (yy * w + xx) * 4
          if (src[j + 3] > 8 || src[j] > 0) {
            r += src[j]
            gg += src[j + 1]
            b += src[j + 2]
            n++
          }
        }
        if (n) {
          d[i] = r / n
          d[i + 1] = gg / n
          d[i + 2] = b / n
        }
      }
  }
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] <= 8 && !d[i]) d[i] = d[i + 1] = d[i + 2] = 140
}

// the impostor cells (each species painted from the side, plus a fan palm): CELL_W x CELL_H
// pixels each, side by side; IMP[name] = { cell, w, h } (the quad's size in metres at the
// species' reference size, its foot at the bottom middle)
export const CELL_W = 128
export const CELL_H = 256
export const IMP_LIST = ["plane", "oak", "round", "pine", "palm"]
export const impostorSize = (name) => {
  if (name === "palm") return { w: 7, h: 14 }
  const S = SPECIES[name]
  const w = S.r * 2 * 1.25
  const h = S.h * 1.06
  // (fit the cell's 1:2 shape)
  return w * 2 > h ? { w, h: w * 2 } : { w: h / 2, h }
}

// paint the impostors -> { data (RGBA, rows bottom-up like the atlas), w, h } | null
export const paintImpostors = (atlas) => {
  const W = CELL_W * IMP_LIST.length
  const cv = canvas2d(W, CELL_H)
  const g = cv?.getContext("2d")
  if (!g || !atlas) return null
  // (the atlas regions as images, at a few brightnesses, tinted by the species' leaf colour)
  const src = canvas2d(ATLAS, ATLAS)
  const sg = src.getContext("2d")
  const id = sg.createImageData(ATLAS, ATLAS)
  id.data.set(atlas.data)
  sg.putImageData(id, 0, 0)
  const LEVELS = 6
  const tinted = (reg, col) => {
    const [x, y, w, h] = REG[reg]
    const out = []
    for (let l = 0; l < LEVELS; l++) {
      const c = canvas2d(w, h)
      const cg = c.getContext("2d")
      cg.drawImage(src, x, y, w, h, 0, 0, w, h)
      const k = 0.45 + (0.75 * l) / (LEVELS - 1)
      const im = cg.getImageData(0, 0, w, h)
      for (let i = 0; i < im.data.length; i += 4) {
        im.data[i] = Math.min(255, im.data[i] * col[0] * k * 1.5)
        im.data[i + 1] = Math.min(255, im.data[i + 1] * col[1] * k * 1.5)
        im.data[i + 2] = Math.min(255, im.data[i + 2] * col[2] * k * 1.5)
        im.data[i + 3] = im.data[i + 3] > 127 ? 255 : 0
      }
      cg.putImageData(im, 0, 0)
      out.push(c)
    }
    return out
  }
  const light = norm([0.35, 0.8, 0.55])
  g.clearRect(0, 0, W, CELL_H)
  IMP_LIST.forEach((name, ci) => {
    const { w, h } = impostorSize(name)
    const ppm = CELL_W / w
    const X = (x) => ci * CELL_W + CELL_W / 2 + x * ppm
    const Y = (y) => CELL_H - 2 - y * ppm
    if (name === "palm") {
      // a fan palm: a slim trunk and a ball of fronds
      g.fillStyle = "rgb(120,100,80)"
      g.fillRect(X(-0.18), Y(11.8), 0.36 * ppm, 11.8 * ppm)
      g.fillStyle = "rgb(110,90,62)"
      g.fillRect(X(-0.45), Y(12.2), 0.9 * ppm, 1.4 * ppm)
      for (let k = 0; k < 26; k++) {
        const a = (k / 26) * Math.PI * 2
        const v = 0.7 + 0.3 * Math.sin(a)
        g.strokeStyle = `rgb(${Math.round(95 * v)},${Math.round(130 * v)},${Math.round(70 * v)})`
        g.lineWidth = 0.5 * ppm
        g.beginPath()
        g.moveTo(X(0), Y(12.6))
        g.lineTo(X(Math.cos(a) * 2.6), Y(12.6 + Math.sin(a) * 1.6 - (Math.cos(a) ** 2) * 0.6))
        g.stroke()
      }
      return
    }
    const S = SPECIES[name]
    const arr = speciesArrays(name, 1)
    // the limbs (behind the leaves)
    const bk = S.bark.map((v) => Math.round(v * 150))
    g.strokeStyle = `rgb(${bk[0]},${bk[1]},${bk[2]})`
    g.lineCap = "round"
    for (const l of arr.limbs) {
      g.lineWidth = Math.max(1, (l.ra + l.rb) * ppm)
      g.beginPath()
      g.moveTo(X(l.a[0]), Y(l.a[1]))
      g.lineTo(X(l.b[0]), Y(l.b[1]))
      g.stroke()
    }
    const leaves = tinted("leaves", S.leaf)
    const needles = tinted("needles", S.leaf)
    // the cards back to front (seen from +z)
    const cards = arr.cards.slice().sort((a, b) => a.p[2] - b.p[2])
    for (const c of cards) {
      const ndl = Math.max(0, c.n[0] * light[0] + c.n[1] * light[1] + c.n[2] * light[2])
      const lum = Math.min(1, (0.35 + 0.65 * ndl) * c.ao)
      const lvl = Math.max(0, Math.min(LEVELS - 1, Math.round(((lum - 0.2) / 0.8) * (LEVELS - 1))))
      const img = (c.needles ? needles : leaves)[lvl]
      const s = c.s * ppm * 0.95
      g.drawImage(img, X(c.p[0]) - s / 2, Y(c.p[1]) - s / 2, s, s)
    }
  })
  const im = g.getImageData(0, 0, W, CELL_H)
  // (alpha hard; rows flipped so row 0 is the bottom, like the atlas's v)
  const data = new Uint8Array(W * CELL_H * 4)
  for (let y = 0; y < CELL_H; y++) data.set(im.data.subarray((CELL_H - 1 - y) * W * 4, (CELL_H - y) * W * 4), y * W * 4)
  for (let i = 3; i < data.length; i += 4) data[i] = data[i] > 100 ? 255 : 0
  bleed(data, W, CELL_H)
  return { data, w: W, h: CELL_H }
}
