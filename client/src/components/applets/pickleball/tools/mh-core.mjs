// Pickleball 98: the pure math behind build-mh-athletes.mjs (MakeHuman bodies). No
// dependencies, tested in Node (mhcore.test.js):
//
// - parseObj: a Wavefront OBJ (positions, UVs, faces by group)
// - parseTarget: a MakeHuman .target (vertex index and offset per line)
// - macroTargets: which macro targets a body mixes, and how much (MakeHuman's macro
//   modifiers: race x gender x age, gender x age x muscle x weight, plus proportions and height)
// - parseFitting / fitVerts: a .proxy or .mhclo file's vertex references (three base vertices,
//   barycentric weights and an offset scaled by the body's own size) and the fitted positions
// - transferWeights: a proxy's skin weights from the base mesh's, through the same references
// - qFromTo / rotateAbout: the turns that put the arms straight out and the legs straight down
// - boneFrame: a bone's rest rotation (y along the bone, x from a hint), as a 3x3 basis

// ---- files ----
export const parseObj = (text) => {
  const v = []
  const vt = []
  const faces = [] // { group, v: [..], t: [..] }
  let group = ""
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("v ")) {
      const p = line.trim().split(/\s+/)
      v.push(+p[1], +p[2], +p[3])
    } else if (line.startsWith("vt ")) {
      const p = line.trim().split(/\s+/)
      vt.push(+p[1], +p[2])
    } else if (line.startsWith("g ")) group = line.slice(2).trim()
    else if (line.startsWith("f ")) {
      const p = line.trim().split(/\s+/).slice(1)
      const fv = []
      const ft = []
      for (const c of p) {
        const [a, b] = c.split("/")
        fv.push(+a - 1)
        ft.push(b ? +b - 1 : -1)
      }
      faces.push({ group, v: fv, t: ft })
    }
  }
  return { v: Float64Array.from(v), vt: Float64Array.from(vt), faces }
}

export const parseTarget = (text) => {
  const idx = []
  const d = []
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith("#")) continue
    const p = s.split(/\s+/)
    if (p.length < 4) continue
    idx.push(+p[0])
    d.push(+p[1], +p[2], +p[3])
  }
  return { idx: Int32Array.from(idx), d: Float64Array.from(d) }
}

// add a target, scaled by w, onto positions (in place)
export const applyTarget = (pos, target, w) => {
  if (!w) return pos
  for (let i = 0; i < target.idx.length; i++) {
    const k = target.idx[i] * 3
    pos[k] += target.d[i * 3] * w
    pos[k + 1] += target.d[i * 3 + 1] * w
    pos[k + 2] += target.d[i * 3 + 2] * w
  }
  return pos
}

// ---- macro modifiers ----
// a value 0..1 split into its two neighbours (e.g. muscle 0.7: averagemuscle 0.6, maxmuscle 0.4)
const split3 = (x, lo, mid, hi) => {
  if (x < 0.5) return [[lo, (0.5 - x) * 2], [mid, 1 - (0.5 - x) * 2]]
  return [[mid, 1 - (x - 0.5) * 2], [hi, (x - 0.5) * 2]]
}
// { gender 0 female .. 1 male, muscle, weight, proportions, height (0..1, 0.5 average),
//   race: { caucasian, african, asian } } -> [{ file, w }] (young adults only)
export const macroTargets = ({ gender = 0.5, muscle = 0.5, weight = 0.5, proportions = 0.5, height = 0.5, race = { caucasian: 1 / 3, african: 1 / 3, asian: 1 / 3 } } = {}) => {
  const out = []
  const genders = [["female", 1 - gender], ["male", gender]].filter(([, w]) => w > 1e-6)
  const muscles = split3(muscle, "minmuscle", "averagemuscle", "maxmuscle").filter(([, w]) => w > 1e-6)
  const weights = split3(weight, "minweight", "averageweight", "maxweight").filter(([, w]) => w > 1e-6)
  for (const [g, gw] of genders) {
    for (const [r, rw] of Object.entries(race)) if (rw > 0) out.push({ file: `${r}-${g}-young`, w: gw * rw })
    for (const [mu, mw] of muscles)
      for (const [wt, ww] of weights) {
        const base = gw * mw * ww
        out.push({ file: `universal-${g}-young-${mu}-${wt}`, w: base })
        if (proportions > 0.5) out.push({ file: `proportions/${g}-young-${mu}-${wt}-idealproportions`, w: base * (proportions - 0.5) * 2 })
        if (height > 0.5) out.push({ file: `height/${g}-young-${mu}-${wt}-maxheight`, w: base * (height - 0.5) * 2 })
        if (height < 0.5) out.push({ file: `height/${g}-young-${mu}-${wt}-minheight`, w: base * (0.5 - height) * 2 })
      }
  }
  return out.filter((t) => t.w > 1e-6)
}

// ---- proxies and clothes (.proxy, .mhclo) ----
export const parseFitting = (text) => {
  const out = { scale: {}, refs: [], meta: {} }
  let inVerts = false
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith("#")) continue
    const p = s.split(/\s+/)
    if (inVerts && /^-?\d/.test(p[0])) {
      if (p.length >= 9) out.refs.push({ i: [+p[0], +p[1], +p[2]], w: [+p[3], +p[4], +p[5]], o: [+p[6], +p[7], +p[8]] })
      else out.refs.push({ i: [+p[0], +p[0], +p[0]], w: [1, 0, 0], o: [0, 0, 0] })
      continue
    }
    // (the vertex lines follow "verts 0", maybe after a few more keyword lines; a keyword after
    // them, like delete_verts, ends them)
    if (out.refs.length) inVerts = false
    if (p[0] === "verts") inVerts = true
    else if (p[0] === "x_scale" || p[0] === "y_scale" || p[0] === "z_scale") out.scale[p[0][0]] = { a: +p[1], b: +p[2], d: +p[3] }
    else out.meta[p[0]] = p.slice(1).join(" ")
  }
  return out
}

// positions (Float64Array) of a fitting's vertices on the base mesh's positions
export const fitVerts = (fit, base) => {
  const sc = { x: 1, y: 1, z: 1 }
  ;["x", "y", "z"].forEach((ax, k) => {
    const s = fit.scale[ax]
    if (s) sc[ax] = Math.abs(base[s.a * 3 + k] - base[s.b * 3 + k]) / s.d
  })
  const out = new Float64Array(fit.refs.length * 3)
  fit.refs.forEach((r, n) => {
    for (let k = 0; k < 3; k++) {
      let x = 0
      for (let j = 0; j < 3; j++) x += r.w[j] * base[r.i[j] * 3 + k]
      out[n * 3 + k] = x + r.o[k] * [sc.x, sc.y, sc.z][k]
    }
  })
  return out
}

// skin weights for fitted vertices: each reference vertex's weights, by its barycentric weight.
// baseWeights: Map(vertex -> [[bone, w], ...]). Returns per vertex the 4 strongest, normalized.
export const transferWeights = (fit, baseWeights, maxInfluences = 4) =>
  fit.refs.map((r) => {
    const acc = new Map()
    for (let j = 0; j < 3; j++) {
      if (!r.w[j]) continue
      for (const [b, w] of baseWeights.get(r.i[j]) || []) acc.set(b, (acc.get(b) || 0) + w * r.w[j])
    }
    const list = [...acc].filter(([, w]) => w > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, maxInfluences)
    const sum = list.reduce((s, [, w]) => s + w, 0) || 1
    return list.map(([b, w]) => [b, w / sum])
  })

// ---- turns ----
const len = (v) => Math.hypot(v[0], v[1], v[2])
const norm = (v) => {
  const l = len(v) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
// the shortest turn taking direction a onto b, as a quaternion [x, y, z, w]
export const qFromTo = (a, b) => {
  const u = norm(a)
  const v = norm(b)
  const d = dot(u, v)
  if (d < -0.999999) {
    let ax = cross([1, 0, 0], u)
    if (len(ax) < 1e-6) ax = cross([0, 1, 0], u)
    ax = norm(ax)
    return [ax[0], ax[1], ax[2], 0]
  }
  const c = cross(u, v)
  const q = [c[0], c[1], c[2], 1 + d]
  const l = Math.hypot(...q)
  return q.map((x) => x / l)
}
export const qRotate = (q, v) => {
  const u = [q[0], q[1], q[2]]
  const t = cross(u, v).map((x) => x * 2)
  const c = cross(u, t)
  return [v[0] + q[3] * t[0] + c[0], v[1] + q[3] * t[1] + c[1], v[2] + q[3] * t[2] + c[2]]
}
export const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]
// a rigid move: turn q about pivot p
export const rotateAbout = (q, p, v) => {
  const r = qRotate(q, [v[0] - p[0], v[1] - p[1], v[2] - p[2]])
  return [r[0] + p[0], r[1] + p[1], r[2] + p[2]]
}

// a bone's rest basis: y along the bone (head to tail), x as close to the hint as it can be
// (made perpendicular), z = x cross y. Returns { x, y, z } (unit vectors).
export const boneFrame = (dir, hint) => {
  const y = norm(dir)
  let x = [hint[0] - y[0] * dot(hint, y), hint[1] - y[1] * dot(hint, y), hint[2] - y[2] * dot(hint, y)]
  if (len(x) < 1e-6) x = Math.abs(y[0]) < 0.9 ? cross([0, 0, 1], y) : cross(y, [0, 0, 1])
  x = norm(x)
  const z = cross(x, y)
  return { x, y, z }
}
