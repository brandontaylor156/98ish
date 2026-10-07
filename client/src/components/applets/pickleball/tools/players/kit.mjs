// Pickleball 98, players v2 (docs/players-v2.md): the pure math behind the modeled kits. No
// dependencies, tested in Node (../../kit.test.js). build-kit.mjs uses it to dress the
// MakeHuman athletes in MakeHuman's own CC0 clothes (fitted .mhclo garments: real tees with
// sleeves, hems and folds, shorts cut from jeans, sneakers and socks), skinned to the same
// skeleton as the body.
//
// - parseDeleteVerts: a .mhclo's delete_verts block (the base-mesh vertices the garment hides)
// - components: a mesh's connected pieces (a suit's top and its bottoms are separate pieces)
// - clipFaces: cut a mesh where a scalar field crosses zero (keep >= 0), new vertices on the
//   cut with their UVs and skin weights interpolated; polygons stay polygons
// - boundaryLoops: the open edges of a mesh, chained into loops (necklines, sleeves, hems)
// - addCollar: a polo's collar standing up from the tee's neckline
// - tankField / shortsField: the cut fields for a tank top (from a tee) and shorts (from jeans)
// - image helpers on raw buffers: box blur, a blur that ignores masked texels (removes logos
//   and prints and keeps the cloth's folds), a normal map from a height map, thick lines in
//   UV space (a binding along a hem)

// ---- files ----
export const parseDeleteVerts = (text) => {
  const out = new Set()
  let on = false
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith("#")) continue
    if (/^[a-z_]/i.test(s)) {
      on = s.startsWith("delete_verts")
      continue
    }
    if (!on) continue
    const p = s.split(/\s+/)
    for (let i = 0; i < p.length; i++) {
      if (p[i + 1] === "-") {
        for (let v = +p[i]; v <= +p[i + 2]; v++) out.add(v)
        i += 2
      } else out.add(+p[i])
    }
  }
  return out
}

// ---- topology ----
// connected pieces: per vertex a piece id (0 = the piece with the most faces, then down)
export const components = (nVerts, faces) => {
  const par = Int32Array.from({ length: nVerts }, (_, i) => i)
  const find = (x) => {
    while (par[x] !== x) x = par[x] = par[par[x]]
    return x
  }
  for (const f of faces) for (let j = 1; j < f.v.length; j++) par[find(f.v[j])] = find(f.v[0])
  const count = new Map()
  for (const f of faces) {
    const r = find(f.v[0])
    count.set(r, (count.get(r) || 0) + 1)
  }
  const order = [...count].sort((a, b) => b[1] - a[1]).map(([r]) => r)
  const rank = new Map(order.map((r, i) => [r, i]))
  const id = new Int32Array(nVerts).fill(-1)
  for (let i = 0; i < nVerts; i++) if (rank.has(find(i))) id[i] = rank.get(find(i))
  return { id, count: order.length, faces: order.map((r) => count.get(r)) }
}

// Cut a mesh by a field. mesh: { pos: [x,y,z per vertex] (any units), vt: [u,v per uv], faces:
// [{ v: [...], t: [...] }], weights: [[[bone, w], ...] per vertex] }; field: a number per vertex
// (keep where >= 0). Returns the same shape plus cut: a Set of vertices made on the cut and
// src: per vertex, [a, b, t] (the old vertices it was made from: a for a kept one, t = 0).
export const clipFaces = (mesh, field) => {
  const pos = Array.from(mesh.pos)
  const vt = Array.from(mesh.vt)
  const weights = mesh.weights.slice()
  const src = Array.from({ length: pos.length / 3 }, (_, i) => [i, i, 0])
  const cut = new Set()
  const vKey = new Map()
  const tKey = new Map()
  const f = Array.from(field)
  const newV = (a, b) => {
    const k = a < b ? a * 4194304 + b : b * 4194304 + a
    if (vKey.has(k)) return vKey.get(k)
    const t = f[a] / (f[a] - f[b])
    const id = pos.length / 3
    for (let c = 0; c < 3; c++) pos.push(pos[a * 3 + c] + (pos[b * 3 + c] - pos[a * 3 + c]) * t)
    const acc = new Map()
    for (const [bone, w] of weights[a] || []) acc.set(bone, (acc.get(bone) || 0) + w * (1 - t))
    for (const [bone, w] of weights[b] || []) acc.set(bone, (acc.get(bone) || 0) + w * t)
    const list = [...acc].sort((x, y) => y[1] - x[1]).slice(0, 4)
    const sum = list.reduce((s, [, w]) => s + w, 0) || 1
    weights.push(list.map(([bone, w]) => [bone, w / sum]))
    src.push([a, b, t])
    f.push(0)
    cut.add(id)
    vKey.set(k, id)
    return id
  }
  const newT = (ta, tb, t) => {
    if (ta < 0 || tb < 0) return -1
    const k = `${Math.min(ta, tb)},${Math.max(ta, tb)},${(ta < tb ? t : 1 - t).toFixed(6)}`
    if (tKey.has(k)) return tKey.get(k)
    const id = vt.length / 2
    vt.push(vt[ta * 2] + (vt[tb * 2] - vt[ta * 2]) * t, vt[ta * 2 + 1] + (vt[tb * 2 + 1] - vt[ta * 2 + 1]) * t)
    tKey.set(k, id)
    return id
  }
  const faces = []
  for (const face of mesh.faces) {
    const n = face.v.length
    const inside = face.v.map((v) => f[v] >= 0)
    if (inside.every(Boolean)) {
      faces.push(face)
      continue
    }
    if (!inside.some(Boolean)) continue
    const ov = []
    const ot = []
    for (let j = 0; j < n; j++) {
      const a = face.v[j]
      const b = face.v[(j + 1) % n]
      const ta = face.t[j]
      const tb = face.t[(j + 1) % n]
      if (inside[j]) {
        ov.push(a)
        ot.push(ta)
      }
      if (inside[j] !== inside[(j + 1) % n]) {
        const t = f[a] / (f[a] - f[b])
        ov.push(newV(a, b))
        ot.push(newT(ta, tb, t))
      }
    }
    if (ov.length >= 3) faces.push({ v: ov, t: ot, group: face.group })
  }
  return { pos, vt, faces, weights, cut, src }
}

// open edges (used by one face), chained into loops: [[v0, v1, ...], ...]
export const boundaryLoops = (faces) => {
  const count = new Map()
  const dir = new Map()
  for (const f of faces)
    for (let j = 0; j < f.v.length; j++) {
      const a = f.v[j]
      const b = f.v[(j + 1) % f.v.length]
      const k = a < b ? `${a},${b}` : `${b},${a}`
      count.set(k, (count.get(k) || 0) + 1)
      dir.set(k, [a, b])
    }
  const next = new Map()
  for (const [k, c] of count) if (c === 1) next.set(dir.get(k)[0], dir.get(k)[1])
  const loops = []
  const seen = new Set()
  for (const start of next.keys()) {
    if (seen.has(start)) continue
    const loop = []
    let v = start
    while (v !== undefined && !seen.has(v)) {
      seen.add(v)
      loop.push(v)
      v = next.get(v)
    }
    if (loop.length > 2) loops.push(loop)
  }
  return loops
}

// A polo's collar: a band standing up from a neckline loop (up and a little out from the
// neck's axis at cx, cz), its top vertices with their base's UVs and weights (so it takes
// whatever the texture has at the neckline: the binding, in the trim color). mesh as for
// clipFaces; returns a new mesh.
export const addCollar = (mesh, loop, { cx, cz, height = 0.03, out = 0.009 }) => {
  const pos = Array.from(mesh.pos)
  const weights = mesh.weights.slice()
  const faces = mesh.faces.slice()
  // each loop vertex's UV (from a face corner that uses it)
  const tOf = new Map()
  for (const f of mesh.faces) f.v.forEach((v, j) => tOf.has(v) || tOf.set(v, f.t[j]))
  const top = loop.map((a) => {
    const id = pos.length / 3
    const dx = pos[a * 3] - cx
    const dz = pos[a * 3 + 2] - cz
    const l = Math.hypot(dx, dz) || 1
    pos.push(pos[a * 3] + (dx / l) * out, pos[a * 3 + 1] + height, pos[a * 3 + 2] + (dz / l) * out)
    weights.push(weights[a])
    return id
  })
  for (let k = 0; k < loop.length; k++) {
    const a = loop[k]
    const b = loop[(k + 1) % loop.length]
    const ta = tOf.get(a) ?? -1
    const tb = tOf.get(b) ?? -1
    faces.push({ v: [a, b, top[(k + 1) % loop.length], top[k]], t: [ta, tb, tb, ta] })
  }
  return { pos, vt: mesh.vt, faces, weights, collar: new Set(top) }
}

// ---- the cuts (meters, the rest pose: arms straight out to the sides, y up from the soles,
// +z forward). m: { cx, cz, shoulderX, shoulderY, hipY, kneeY, ankleY } ----
// a tank top from a tee: the sleeves off at the armholes, straps over the shoulders, a scoop
// neck in front (the same outline as outfit.js covers("tank"), as a smooth field)
export const tankField = (p, m) => {
  const ax = Math.abs(p[0] - m.cx)
  const front = p[2] - m.cz
  const armpit = m.shoulderY - 0.1
  const arm = m.shoulderX * 0.84 - ax
  const strap = 0.034 - Math.abs(ax - m.shoulderX * 0.5)
  const k = Math.min(1, ax / (m.shoulderX * 0.5))
  const scoop = m.shoulderY - 0.035 - 0.06 * (1 - k * k)
  const panel = Math.min(scoop - p[1], front + 0.01, m.shoulderX * 0.6 - ax)
  return Math.min(arm, Math.max(armpit - p[1], strap, panel))
}
// shorts from trousers: everything above a height
export const heightField = (p, y0) => p[1] - y0
export const belowField = (p, y1) => y1 - p[1]

// ---- images (raw buffers, ch channels, w x h) ----
// one channel as floats 0..1
export const channel = (data, w, h, ch, c) => {
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = data[i * ch + c] / 255
  return out
}
export const luminance = (data, w, h, ch) => {
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = (0.2126 * data[i * ch] + 0.7152 * data[i * ch + 1] + 0.0722 * data[i * ch + 2]) / 255
  return out
}
// a separable box blur (radius r texels, clamped at the edges)
export const boxBlur = (img, w, h, r) => {
  if (r < 1) return Float32Array.from(img)
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const n = 2 * r + 1
  for (let y = 0; y < h; y++) {
    let s = 0
    for (let k = -r; k <= r; k++) s += img[y * w + Math.min(w - 1, Math.max(0, k))]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / n
      s += img[y * w + Math.min(w - 1, x + r + 1)] - img[y * w + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}
// a blur that ignores masked texels (keep 0): each texel the average of the kept ones near it
export const maskedBlur = (img, keep, w, h, r) => {
  const a = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) a[i] = img[i] * keep[i]
  const num = boxBlur(boxBlur(a, w, h, r), w, h, r)
  const den = boxBlur(boxBlur(Float32Array.from(keep), w, h, r), w, h, r)
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = den[i] > 1e-3 ? num[i] / den[i] : img[i]
  return out
}
// Remove prints from a cloth texture's shading: texels far from their neighborhood (a logo's
// letters, a stripe) are filled with the kept texels around them. Returns the cleaned
// luminance and the mask of what was removed.
export const cleanPrint = (lum, w, h, { r = 10, tol = 0.07, extra = null } = {}) => {
  const ref = boxBlur(boxBlur(lum, w, h, r * 2), w, h, r * 2)
  const keep = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) keep[i] = Math.abs(lum[i] - ref[i]) > tol || (extra && extra[i]) ? 0 : 1
  // (grow the removed areas a little: antialiased edges of the print)
  const grown = boxBlur(keep, w, h, 2)
  for (let i = 0; i < w * h; i++) keep[i] = grown[i] > 0.999 ? 1 : 0
  const fill = maskedBlur(lum, keep, w, h, r)
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = keep[i] ? lum[i] : fill[i]
  return { lum: out, removed: keep.map((k) => 1 - k) }
}
// a tangent-space normal map (RGB bytes) from a height map (0..1), strength in texels
export const heightToNormal = (hgt, w, h, strength = 2) => {
  const out = Buffer.alloc(w * h * 3)
  const at = (x, y) => hgt[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const l = Math.hypot(dx, dy, 1)
      const i = (y * w + x) * 3
      out[i] = Math.round((-dx / l) * 127.5 + 127.5)
      out[i + 1] = Math.round((dy / l) * 127.5 + 127.5)
      out[i + 2] = Math.round((1 / l) * 127.5 + 127.5)
    }
  return out
}
// thick segments into a mask (0..1 floats, w x h): segs [[x0, y0, x1, y1, radius], ...] in
// texels, soft over the last texel
export const drawSegments = (mask, w, h, segs) => {
  for (const [x0, y0, x1, y1, r] of segs) {
    const xa = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1))
    const xb = Math.min(w - 1, Math.ceil(Math.max(x0, x1) + r + 1))
    const ya = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1))
    const yb = Math.min(h - 1, Math.ceil(Math.max(y0, y1) + r + 1))
    const dx = x1 - x0
    const dy = y1 - y0
    const L2 = dx * dx + dy * dy || 1e-9
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2))
        const d = Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t))
        const v = Math.max(0, Math.min(1, r + 0.5 - d))
        if (v > mask[y * w + x]) mask[y * w + x] = v
      }
  }
  return mask
}
// how saturated and which hue a texel is (0..1 each; hue 0 red, 1/6 yellow, 1/3 green ...)
export const hsv = (r, g, b) => {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let hue = 0
  if (d > 1e-6) {
    if (mx === r) hue = ((g - b) / d + 6) % 6
    else if (mx === g) hue = (b - r) / d + 2
    else hue = (r - g) / d + 4
  }
  return { h: hue / 6, s: mx > 0 ? d / mx : 0, v: mx }
}
