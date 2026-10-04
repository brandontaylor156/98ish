// Pickleball 98: the athletes' clothes. Pure JavaScript (arrays in, arrays out; athlete.js
// turns them into three.js meshes), tested in Node.
//
// The base characters (Quaternius, CC0) come in underwear, so every garment is grown out of
// the body's own surface: pick the body's triangles in a region (the torso and the tops of
// the arms for a tee, the hips and thighs for shorts, the feet for shoes), smooth that patch
// (so muscles don't show through a shirt), push it out along its normals, and keep the
// body's skin weights so it bends exactly like the body under it. Edges get a "trim" value
// (a collar, sleeve and hem stripe in the kit's trim color). The skirt is its own cone,
// weighted between the hips and the thighs.
//
// The Locker Room's kits (locker.js) are all made this way: tees, polos, tanks, a long-sleeve
// rash guard, a track jacket (with a zip and sleeve stripes), a sports top, a one-piece
// swimsuit; shorts, short shorts, board shorts, swim shorts, track pants (side stripes); no-
// show, ankle, crew and striped knee socks; gloves and wristbands. reshapeBody makes the
// slim and strong builds from the same body (thinner or thicker torso and limbs).

// ---- the body's landmarks (rest pose, meters, y up, facing +z) ----
// joints: name -> {x, y, z} for pelvis, thigh_l, calf_l, foot_l, upperarm_l, neck_01, Head...
export const landmarks = (joints, soleY = 0) => ({
  hipY: (joints.thigh_l.y + joints.thigh_r.y) / 2,
  kneeY: (joints.calf_l.y + joints.calf_r.y) / 2,
  ankleY: (joints.foot_l.y + joints.foot_r.y) / 2,
  soleY,
  shoulderY: (joints.upperarm_l.y + joints.upperarm_r.y) / 2,
  shoulderX: Math.abs(joints.upperarm_l.x - joints.upperarm_r.x) / 2,
  neckY: joints.neck_01.y,
  headY: joints.Head.y,
  cx: joints.pelvis.x,
  cz: joints.pelvis.z,
  // the arms (the rest pose holds them straight out to the sides) and the legs
  handX: joints.hand_l ? Math.abs(joints.hand_l.x - joints.pelvis.x) : 0.7,
  armY: joints.upperarm_l.y,
  armZ: joints.upperarm_l.z,
  legX: Math.abs(joints.thigh_l.x - joints.pelvis.x),
  legZ: joints.thigh_l.z,
})

// ---- which garment a body vertex belongs to ----
const startsAny = (name, list) => list.some((p) => name.startsWith(p))
const ARM = ["upperarm", "lowerarm", "hand", "index", "middle", "ring", "pinky", "thumb"]
const LEG = ["thigh", "calf"]
const FOOT = ["foot", "ball"]
const TORSO = ["spine", "clavicle", "pelvis", "neck"]
const HAND = ["hand", "index", "middle", "ring", "pinky", "thumb"]

// v: { x, y, z, bone (the bone with the most weight) }, m: landmarks. Returns true if a
// garment of this kind covers the vertex.
export const covers = (kind, v, m) => {
  const ax = Math.abs(v.x - m.cx)
  const front = v.z - m.cz
  if (kind === "onepiece") return covers("tank", v, m) || covers("briefs", v, m)
  if (kind === "crop") {
    // a sports top: the chest, straps over the shoulders, hem above the waist
    if (!covers("tank", v, m)) return false
    return v.y > m.shoulderY - 0.25
  }
  if (kind === "rash" || kind === "jacket") {
    // long sleeves: a tee's body and the whole arm down to the wrist (not the hand); a
    // crew neck (the jacket's collar stands up from it)
    if (startsAny(v.bone, HAND)) return false
    if (ax < 0.09 && v.y > m.neckY - 0.01 - (front > 0.01 ? 0.025 : 0)) return false
    if (startsAny(v.bone, ARM) || startsAny(v.bone, ["clavicle"]) || (ax > m.shoulderX - 0.03 && v.y > m.shoulderY - 0.12)) return ax < m.handX - (kind === "jacket" ? 0.005 : 0.015) && !(v.y > m.neckY + 0.04)
    return covers("tee", v, m) || (kind === "jacket" && covers("polo", v, m))
  }
  if (kind === "gloves") return startsAny(v.bone, HAND) || (startsAny(v.bone, ["lowerarm"]) && ax > m.handX - 0.02)
  if (kind === "wristbands") return startsAny(v.bone, ["lowerarm"]) && ax > m.handX - 0.085 && ax < m.handX - 0.025
  if (kind === "tank") {
    if (v.y > m.neckY + 0.04 || v.y < m.hipY + 0.01 || startsAny(v.bone, ARM)) return false
    if (!startsAny(v.bone, TORSO) && !startsAny(v.bone, LEG)) return false
    // above the armpits only the straps; a scoop in front
    const armpit = m.shoulderY - 0.11
    const strap = Math.abs(ax - m.shoulderX * 0.52) < 0.03
    if (v.y > armpit) return strap || (front > 0.03 && v.y < m.shoulderY - 0.035 && ax < m.shoulderX * 0.95)
    return true
  }
  if (kind === "tee" || kind === "polo") {
    // the neckline (round, lower in front) round the neck; the shoulders are covered up to
    // their tops
    const neckline = m.neckY - 0.01 - (front > 0.01 ? (kind === "tee" ? 0.045 : 0.02) : 0)
    if (ax < 0.09 && v.y > neckline) return false
    if (v.y > m.neckY + 0.04) return false
    if (v.y < m.hipY + 0.01) return false
    if (startsAny(v.bone, ARM) || startsAny(v.bone, ["clavicle"]) || (ax > m.shoulderX - 0.03 && v.y > m.shoulderY - 0.12)) {
      // a sleeve: down the arm (the rest pose holds the arms out to the sides)
      const along = ax - m.shoulderX
      if (startsAny(v.bone, ["lowerarm", "hand", "index", "middle", "ring", "pinky", "thumb"])) return false
      return along < (kind === "polo" ? 0.13 : 0.12)
    }
    return startsAny(v.bone, TORSO) || startsAny(v.bone, LEG)
  }
  if (kind === "shorts" || kind === "board" || kind === "short" || kind === "swim" || kind === "pants") {
    // how far down the leg: shorts to mid-thigh, board shorts to the knee, track pants to the
    // ankle; short shorts and swim shorts higher up
    const low = { shorts: m.kneeY + 0.14, board: m.kneeY + 0.015, short: m.hipY - 0.15, swim: m.hipY - 0.19, pants: m.ankleY + 0.045 }[kind]
    if (v.y > m.hipY + 0.11 || v.y < low) return false
    const legBones = kind === "pants" ? ["pelvis", "spine_01", "thigh", "calf"] : ["pelvis", "spine_01", "thigh"]
    return startsAny(v.bone, legBones) || (startsAny(v.bone, ["spine"]) && v.y < m.hipY + 0.11)
  }
  if (kind === "briefs") {
    // under a skirt: snug shorts (a skort)
    if (v.y > m.hipY + 0.11 || v.y < m.hipY - 0.17) return false
    return startsAny(v.bone, ["pelvis", "spine_01", "thigh"])
  }
  if (kind === "socks" || kind === "anklesocks" || kind === "kneesocks") {
    const top = { socks: m.ankleY + 0.11, anklesocks: m.ankleY + 0.04, kneesocks: m.kneeY - 0.05 }[kind]
    return (startsAny(v.bone, ["calf"]) || startsAny(v.bone, FOOT)) && v.y < top && v.y > m.soleY + 0.02
  }
  if (kind === "shoes") return startsAny(v.bone, FOOT) || (startsAny(v.bone, ["calf"]) && v.y < m.ankleY + 0.035)
  return false
}

// how far out each garment sits, and how much it's smoothed
export const GARMENTS = {
  tee: { inflate: 0.013, smooth: 8, trim: 0.018, loose: 0.012 },
  rash: { inflate: 0.008, smooth: 8, trim: 0.012, loose: 0.006 },
  jacket: { inflate: 0.02, smooth: 10, trim: 0.02, loose: 0.018, collar: true, zip: true, armStripe: true },
  crop: { inflate: 0.009, smooth: 6, trim: 0.012 },
  onepiece: { inflate: 0.007, smooth: 6, trim: 0.012 },
  board: { inflate: 0.012, smooth: 6, trim: 0.014, flare: 0.07, legStripe: true },
  short: { inflate: 0.01, smooth: 5, trim: 0.012, flare: 0.05 },
  swim: { inflate: 0.008, smooth: 4, trim: 0.01 },
  pants: { inflate: 0.013, smooth: 6, trim: 0.014, flare: 0.012, legStripe: true },
  anklesocks: { inflate: 0.004, smooth: 2, trim: 0.008 },
  kneesocks: { inflate: 0.005, smooth: 2, trim: 0.012, bands: true },
  gloves: { inflate: 0.004, smooth: 2, trim: 0.008 },
  wristbands: { inflate: 0.012, smooth: 2, trim: 0 },
  polo: { inflate: 0.013, smooth: 8, trim: 0.016, loose: 0.012, collar: true },
  tank: { inflate: 0.011, smooth: 8, trim: 0.014, loose: 0.01 },
  shorts: { inflate: 0.01, smooth: 6, trim: 0.012, flare: 0.075 },
  briefs: { inflate: 0.007, smooth: 4, trim: 0 },
  socks: { inflate: 0.004, smooth: 2, trim: 0.01 },
  shoes: { inflate: 0.016, smooth: 4, trim: 0, sole: true },
}

// ---- mesh helpers ----
const key = (p, i) => `${Math.round(p[i * 3] * 2e4)},${Math.round(p[i * 3 + 1] * 2e4)},${Math.round(p[i * 3 + 2] * 2e4)}`

// welded vertex ids: vertices at the same spot (split by UV seams) share one id
export const weld = (position) => {
  const n = position.length / 3
  const ids = new Int32Array(n)
  const seen = new Map()
  let count = 0
  for (let i = 0; i < n; i++) {
    const k = key(position, i)
    let id = seen.get(k)
    if (id === undefined) {
      id = count++
      seen.set(k, id)
    }
    ids[i] = id
  }
  return { ids, count }
}

// Taubin smoothing (no shrinking) over a welded patch. pos: Float64Array (count*3), edges:
// neighbor lists, pinned: welded ids that only smooth along the patch's edge
const taubin = (pos, nbrs, boundaryNbrs, iterations) => {
  const n = pos.length / 3
  const tmp = new Float64Array(pos.length)
  const pass = (lambda) => {
    for (let i = 0; i < n; i++) {
      const list = boundaryNbrs[i] && boundaryNbrs[i].length >= 2 ? boundaryNbrs[i] : nbrs[i]
      if (!list || !list.length) {
        tmp[i * 3] = pos[i * 3]
        tmp[i * 3 + 1] = pos[i * 3 + 1]
        tmp[i * 3 + 2] = pos[i * 3 + 2]
        continue
      }
      let x = 0
      let y = 0
      let z = 0
      for (const j of list) {
        x += pos[j * 3]
        y += pos[j * 3 + 1]
        z += pos[j * 3 + 2]
      }
      const k = 1 / list.length
      tmp[i * 3] = pos[i * 3] + lambda * (x * k - pos[i * 3])
      tmp[i * 3 + 1] = pos[i * 3 + 1] + lambda * (y * k - pos[i * 3 + 1])
      tmp[i * 3 + 2] = pos[i * 3 + 2] + lambda * (z * k - pos[i * 3 + 2])
    }
    pos.set(tmp)
  }
  for (let it = 0; it < iterations; it++) {
    pass(0.5)
    pass(-0.53)
  }
}

// area-weighted vertex normals over welded triangles
const normalsOf = (pos, tris) => {
  const nrm = new Float64Array(pos.length)
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]]
    const ux = pos[b * 3] - pos[a * 3]
    const uy = pos[b * 3 + 1] - pos[a * 3 + 1]
    const uz = pos[b * 3 + 2] - pos[a * 3 + 2]
    const vx = pos[c * 3] - pos[a * 3]
    const vy = pos[c * 3 + 1] - pos[a * 3 + 1]
    const vz = pos[c * 3 + 2] - pos[a * 3 + 2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    for (const i of [a, b, c]) {
      nrm[i * 3] += nx
      nrm[i * 3 + 1] += ny
      nrm[i * 3 + 2] += nz
    }
  }
  for (let i = 0; i < nrm.length; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1
    nrm[i] /= l
    nrm[i + 1] /= l
    nrm[i + 2] /= l
  }
  return nrm
}

// The body as the garment builder needs it.
// body: { position, normal, skinIndex, skinWeight (Float32Array, 4 per vertex), index, bones (names) }
export const prepareBody = (body) => {
  const n = body.position.length / 3
  const dominant = new Array(n)
  for (let i = 0; i < n; i++) {
    let best = 0
    for (let k = 1; k < 4; k++) if (body.skinWeight[i * 4 + k] > body.skinWeight[i * 4 + best]) best = k
    dominant[i] = body.bones[body.skinIndex[i * 4 + best]] || ""
  }
  return { ...body, dominant, welded: weld(body.position) }
}

// Build one garment from a prepared body. Returns arrays for a skinned mesh:
// { position, normal, skinIndex, skinWeight, trim, accent, index } (trim, accent: 0..1 per
// vertex: how much of the trim color, and of the accent color, a shoe's stripe)
export const buildGarment = (kind, body, m) => {
  const spec = GARMENTS[kind]
  const P = body.position
  const n = P.length / 3
  const inside = new Uint8Array(n)
  for (let i = 0; i < n; i++) inside[i] = covers(kind, { x: P[i * 3], y: P[i * 3 + 1], z: P[i * 3 + 2], bone: body.dominant[i] }, m) ? 1 : 0
  // the patch: triangles with every corner covered
  const I = body.index
  const tris = []
  for (let t = 0; t < I.length; t += 3) if (inside[I[t]] && inside[I[t + 1]] && inside[I[t + 2]]) tris.push(I[t], I[t + 1], I[t + 2])
  // its vertices (renumbered) and their welded ids (renumbered too)
  const map = new Int32Array(n).fill(-1)
  const verts = []
  for (const v of tris) if (map[v] < 0) map[v] = verts.push(v) - 1
  const wmap = new Map()
  const wOf = new Int32Array(verts.length)
  verts.forEach((v, i) => {
    const w = body.welded.ids[v]
    if (!wmap.has(w)) wmap.set(w, wmap.size)
    wOf[i] = wmap.get(w)
  })
  const W = wmap.size
  const wpos = new Float64Array(W * 3)
  verts.forEach((v, i) => {
    wpos[wOf[i] * 3] = P[v * 3]
    wpos[wOf[i] * 3 + 1] = P[v * 3 + 1]
    wpos[wOf[i] * 3 + 2] = P[v * 3 + 2]
  })
  const orig = Float64Array.from(wpos)
  const wtris = tris.map((v) => wOf[map[v]])
  // neighbors, and the patch's edge (edges used by one triangle)
  const nbrs = Array.from({ length: W }, () => [])
  const edgeCount = new Map()
  for (let t = 0; t < wtris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = wtris[t + e]
      const b = wtris[t + ((e + 1) % 3)]
      if (a === b) continue
      if (!nbrs[a].includes(b)) nbrs[a].push(b)
      if (!nbrs[b].includes(a)) nbrs[b].push(a)
      const k = a < b ? `${a},${b}` : `${b},${a}`
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1)
    }
  }
  const boundaryNbrs = Array.from({ length: W }, () => null)
  const onEdge = new Uint8Array(W)
  for (const [k, c] of edgeCount) {
    if (c !== 1) continue
    const [a, b] = k.split(",").map(Number)
    onEdge[a] = onEdge[b] = 1
    ;(boundaryNbrs[a] ||= []).push(b)
    ;(boundaryNbrs[b] ||= []).push(a)
  }
  taubin(wpos, nbrs, boundaryNbrs, spec.smooth)
  const wn = normalsOf(wpos, wtris)
  // push out: at least `inflate` from the smoothed surface, and never closer than 5 mm to
  // the body's own vertex there (so the skin can't poke through)
  const out = new Float64Array(W * 3)
  for (let i = 0; i < W; i++) {
    let inflate = spec.inflate
    const y = orig[i * 3 + 1]
    if (spec.flare) inflate += Math.max(0, m.hipY - 0.05 - y) * spec.flare * 2.2
    if (spec.loose) inflate += Math.max(0, Math.min(1, (m.hipY + 0.2 - y) / 0.2)) * spec.loose
    const nx = wn[i * 3]
    let ny = wn[i * 3 + 1]
    const nz = wn[i * 3 + 2]
    const d = (orig[i * 3] - wpos[i * 3]) * nx + (orig[i * 3 + 1] - wpos[i * 3 + 1]) * ny + (orig[i * 3 + 2] - wpos[i * 3 + 2]) * nz
    const push = Math.max(inflate, d + 0.005)
    // shoes: soles stay flat on the court (no pushing down)
    if (spec.sole && ny < 0) ny = 0
    out[i * 3] = wpos[i * 3] + nx * push
    out[i * 3 + 1] = Math.max(spec.sole ? m.soleY : -Infinity, wpos[i * 3 + 1] + ny * push)
    out[i * 3 + 2] = wpos[i * 3 + 2] + nz * push
  }
  // trim: distance (along the patch) from its edge
  const trim = new Float32Array(W)
  if (spec.trim > 0) {
    const dist = new Float64Array(W).fill(Infinity)
    const queue = []
    for (let i = 0; i < W; i++) if (onEdge[i]) {
      dist[i] = 0
      queue.push(i)
    }
    // (a few relaxation sweeps of a breadth-first pass: plenty for a stripe's width)
    for (let sweep = 0; sweep < 3; sweep++) {
      const q = sweep ? [...Array(W).keys()] : queue
      for (let h = 0; h < q.length; h++) {
        const a = q[h]
        if (!isFinite(dist[a])) continue
        for (const b of nbrs[a]) {
          const l = Math.hypot(out[a * 3] - out[b * 3], out[a * 3 + 1] - out[b * 3 + 1], out[a * 3 + 2] - out[b * 3 + 2])
          if (dist[a] + l < dist[b]) {
            dist[b] = dist[a] + l
            if (!sweep) q.push(b)
          }
        }
      }
    }
    for (let i = 0; i < W; i++) trim[i] = dist[i] < spec.trim ? 1 : dist[i] < spec.trim * 1.4 ? 1 - (dist[i] - spec.trim) / (spec.trim * 0.4) : 0
  }
  // accent: a shoe's side stripe and heel tab; a jacket's zip and sleeve stripes; track
  // pants' and board shorts' side stripes; knee socks' bands
  const accent = new Float32Array(W)
  for (let i = 0; i < W; i++) {
    const x = out[i * 3]
    const y = out[i * 3 + 1]
    const z = out[i * 3 + 2]
    const ax = Math.abs(x - m.cx)
    if (spec.zip && Math.abs(x - m.cx) < 0.013 && z > m.cz && y < m.neckY && ax < m.shoulderX - 0.05) accent[i] = 1
    if (spec.armStripe && ax > m.shoulderX + 0.02 && Math.abs(z - m.armZ) < 0.02 && y > m.armY) accent[i] = 1
    if (spec.legStripe && y < m.hipY - 0.03 && Math.abs(z - m.legZ) < 0.022 && ax > m.legX) accent[i] = 1
    if (spec.bands && ((y > m.kneeY - 0.125 && y < m.kneeY - 0.095) || (y > m.kneeY - 0.185 && y < m.kneeY - 0.155))) accent[i] = 1
  }
  if (spec.sole)
    for (let i = 0; i < W; i++) {
      const y = out[i * 3 + 1] - m.soleY
      trim[i] = y < 0.026 ? 1 : 0
      const side = Math.abs(wn[i * 3]) > 0.55 && y > 0.036 && y < 0.058
      const heel = wn[i * 3 + 2] < -0.6 && y > 0.03 && y < 0.085
      accent[i] = side || heel ? 1 : 0
    }
  // the result, one vertex per patch vertex (UV seams don't matter: no texture)
  const res = {
    position: new Float32Array(W * 3),
    normal: new Float32Array(W * 3),
    skinIndex: new Uint16Array(W * 4),
    skinWeight: new Float32Array(W * 4),
    trim,
    accent,
    index: null,
  }
  res.position.set(out)
  verts.forEach((v, i) => {
    const w = wOf[i]
    for (let k = 0; k < 4; k++) {
      res.skinIndex[w * 4 + k] = body.skinIndex[v * 4 + k]
      res.skinWeight[w * 4 + k] = body.skinWeight[v * 4 + k]
    }
  })
  const tri = []
  for (let t = 0; t < wtris.length; t += 3) if (wtris[t] !== wtris[t + 1] && wtris[t + 1] !== wtris[t + 2] && wtris[t] !== wtris[t + 2]) tri.push(wtris[t], wtris[t + 1], wtris[t + 2])
  // a polo's collar: a band standing up from the neckline
  if (spec.collar) {
    const top = new Map()
    const addTop = (a) => {
      if (top.has(a)) return top.get(a)
      const id = W + top.size
      top.set(a, id)
      return id
    }
    const ringY = m.neckY - 0.09
    const quads = []
    for (const [k, c] of edgeCount) {
      if (c !== 1) continue
      const [a, b] = k.split(",").map(Number)
      if (out[a * 3 + 1] < ringY || out[b * 3 + 1] < ringY) continue
      if (Math.abs(out[a * 3] - m.cx) > m.shoulderX * 0.75) continue
      quads.push([a, b, addTop(a), addTop(b)])
    }
    if (top.size) {
      const total = W + top.size
      const grow = (arr, size) => {
        const g = new arr.constructor(total * size)
        g.set(arr)
        return g
      }
      res.position = grow(res.position, 3)
      res.skinIndex = grow(res.skinIndex, 4)
      res.skinWeight = grow(res.skinWeight, 4)
      res.trim = grow(res.trim, 1)
      res.accent = grow(res.accent, 1)
      for (const [a, id] of top) {
        // up the neck and a little out from it
        const dx = out[a * 3] - m.cx
        const dz = out[a * 3 + 2] - m.cz
        const l = Math.hypot(dx, dz) || 1
        res.position[id * 3] = out[a * 3] + (dx / l) * 0.008
        res.position[id * 3 + 1] = out[a * 3 + 1] + 0.028
        res.position[id * 3 + 2] = out[a * 3 + 2] + (dz / l) * 0.008
        for (let k = 0; k < 4; k++) {
          res.skinIndex[id * 4 + k] = res.skinIndex[a * 4 + k]
          res.skinWeight[id * 4 + k] = res.skinWeight[a * 4 + k]
        }
        res.trim[id] = 1
        res.trim[a] = 1
      }
      for (const [a, b, ta, tb] of quads) tri.push(a, b, tb, a, tb, ta)
    }
  }
  res.index = tri.length / 3 > 0 && res.position.length / 3 > 65535 ? new Uint32Array(tri) : new Uint16Array(tri)
  res.normal = Float32Array.from(normalsOf(Float64Array.from(res.position), tri))
  return res
}

// The body's triangles that the garments hide (no need to draw skin under a shirt): those
// inside a garment's patch and clear of its edge (a ring of skin is kept along every hem and
// sleeve, so nothing shows through at the openings). Returns the body's index without them.
export const visibleIndex = (kinds, body, m) => {
  const P = body.position
  const n = P.length / 3
  const I = body.index
  const W = body.welded
  const hidden = new Uint8Array(I.length / 3)
  for (const kind of kinds) {
    const inside = new Uint8Array(n)
    for (let i = 0; i < n; i++) inside[i] = covers(kind, { x: P[i * 3], y: P[i * 3 + 1], z: P[i * 3 + 2], bone: body.dominant[i] }, m) ? 1 : 0
    // the patch's edge, in welded ids (UV seams aren't edges)
    const count = new Map()
    for (let t = 0; t < I.length; t += 3) {
      if (!(inside[I[t]] && inside[I[t + 1]] && inside[I[t + 2]])) continue
      for (let e = 0; e < 3; e++) {
        const a = W.ids[I[t + e]]
        const b = W.ids[I[t + ((e + 1) % 3)]]
        const k = a < b ? a * 4194304 + b : b * 4194304 + a
        count.set(k, (count.get(k) || 0) + 1)
      }
    }
    const edge = new Uint8Array(W.count)
    for (const [k, c] of count) {
      if (c !== 1) continue
      edge[Math.floor(k / 4194304)] = 1
      edge[k % 4194304] = 1
    }
    // grow the kept ring by one more step of neighbors
    const near = Uint8Array.from(edge)
    for (let t = 0; t < I.length; t += 3) {
      const ids = [W.ids[I[t]], W.ids[I[t + 1]], W.ids[I[t + 2]]]
      if (ids.some((w) => edge[w])) for (const w of ids) near[w] = 1
    }
    for (let t = 0; t < I.length; t += 3) {
      if (!(inside[I[t]] && inside[I[t + 1]] && inside[I[t + 2]])) continue
      if (near[W.ids[I[t]]] || near[W.ids[I[t + 1]]] || near[W.ids[I[t + 2]]]) continue
      hidden[t / 3] = 1
    }
  }
  const out = []
  for (let t = 0; t < I.length; t += 3) if (!hidden[t / 3]) out.push(I[t], I[t + 1], I[t + 2])
  return n > 65535 ? Uint32Array.from(out) : Uint16Array.from(out)
}

// ---- the skirt: a flared cone from the waist, weighted between the hips and the thighs ----
// bodyRadius(angle, y): how far the body's surface is from the center at that angle/height.
// bones: indices for { pelvis, thigh_l, thigh_r }. Angle 0 is the left side (+x), then front.
export const skirtWeights = (angle, t) => {
  const side = Math.cos(angle) // +1: the left side, -1: the right
  const legs = Math.min(0.85, t * 0.95)
  let l = legs * (side > 0 ? 0.25 + 0.75 * side : 0.25 * (1 + side))
  let r = legs * (side < 0 ? 0.25 - 0.75 * side : 0.25 * (1 - side))
  const p = Math.max(0, 1 - l - r)
  const s = p + l + r
  return { pelvis: p / s, thigh_l: l / s, thigh_r: r / s }
}

export const buildSkirt = (m, bodyRadius, bones, { segments = 28, rings = 6, length = 0.3, flare = 0.11 } = {}) => {
  const topY = m.hipY + 0.085
  const nv = segments * (rings + 1)
  const position = new Float32Array(nv * 3)
  const skinIndex = new Uint16Array(nv * 4)
  const skinWeight = new Float32Array(nv * 4)
  const trim = new Float32Array(nv)
  const r0 = []
  for (let s = 0; s < segments; s++) r0.push(bodyRadius((s / segments) * Math.PI * 2, topY) + 0.012)
  for (let r = 0; r <= rings; r++) {
    const t = r / rings
    const y = topY - length * t
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2
      const i = r * segments + s
      // the body under this ring (hips/thighs), plus the flare
      const under = bodyRadius(a, y) + 0.015
      const rad = Math.max(under, r0[s] + flare * Math.pow(t, 0.8))
      position[i * 3] = m.cx + Math.cos(a) * rad
      position[i * 3 + 1] = y
      position[i * 3 + 2] = m.cz + Math.sin(a) * rad
      const w = skirtWeights(a, t)
      skinIndex.set([bones.pelvis, bones.thigh_l, bones.thigh_r, 0], i * 4)
      skinWeight.set([w.pelvis, w.thigh_l, w.thigh_r, 0], i * 4)
      trim[i] = r === rings ? 1 : r === 0 ? 0.6 : 0
    }
  }
  const tri = []
  for (let r = 0; r < rings; r++)
    for (let s = 0; s < segments; s++) {
      const a = r * segments + s
      const b = r * segments + ((s + 1) % segments)
      const c = a + segments
      const d = b + segments
      tri.push(a, b, c, b, d, c)
    }
  const index = new Uint16Array(tri)
  const normal = Float32Array.from(normalsOf(Float64Array.from(position), index))
  return { position, normal, skinIndex, skinWeight, trim, accent: new Float32Array(nv), index }
}

// how far the body's surface is from its center line, by angle (0 = +x, then +z) and height
export const radiusProfile = (body, m, bins = 36) => {
  const P = body.position
  const n = P.length / 3
  return (angle, y) => {
    let best = 0.08
    const b = Math.round(((angle / (Math.PI * 2)) % 1) * bins + bins) % bins
    for (let i = 0; i < n; i++) {
      const vy = P[i * 3 + 1]
      if (Math.abs(vy - y) > 0.025) continue
      if (!startsAny(body.dominant[i], ["pelvis", "thigh", "spine"])) continue
      const dx = P[i * 3] - m.cx
      const dz = P[i * 3 + 2] - m.cz
      const a = Math.atan2(dz, dx)
      const vb = Math.round(((a / (Math.PI * 2)) % 1) * bins + bins) % bins
      if (vb !== b && (vb + 1) % bins !== b && (b + 1) % bins !== vb) continue
      best = Math.max(best, Math.hypot(dx, dz))
    }
    return best
  }
}

// ---- builds: a slimmer or stronger body from the same one ----
// Each vertex moves by its bones' weights: the torso widens or narrows round the body's
// center line (most at the chest and shoulders), arms and legs round their own bones (a
// thicker or thinner limb); the head, hands and feet stay as they are (so hats, gloves and
// shoes fit every build). Vertices at the same spot (UV seams) move together, so the skin
// never opens up. k: 1 regular, under 1 slimmer, over 1 stronger.
// body: prepareBody's result; joints: rest positions by bone name. Returns new positions.
const LIMB_SEGMENTS = { upperarm: "lowerarm", lowerarm: "hand", thigh: "calf", calf: "foot" }
export const reshapeBody = (body, joints, m, k) => {
  const P = body.position
  const n = P.length / 3
  const out = Float32Array.from(P)
  if (Math.abs(k - 1) < 1e-6) return out
  const W = body.welded
  const done = new Int32Array(W.count).fill(-1)
  // each bone's move of a point
  const move = (name, x, y, z) => {
    if (startsAny(name, ["spine_02", "spine_03", "clavicle", "neck"])) {
      const t = name.startsWith("neck") ? 0.4 : 1
      const s = 1 + (k - 1) * t
      return [m.cx + (x - m.cx) * s, y, m.cz + (z - m.cz) * s]
    }
    if (startsAny(name, ["pelvis", "spine_01"])) {
      const s = 1 + (k - 1) * 0.6
      return [m.cx + (x - m.cx) * s, y, m.cz + (z - m.cz) * s]
    }
    const base = Object.keys(LIMB_SEGMENTS).find((b) => name.startsWith(b + "_"))
    if (base) {
      const side = name.slice(base.length)
      const a = joints[name]
      const b = joints[LIMB_SEGMENTS[base] + side]
      if (!a || !b) return [x, y, z]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dz = b.z - a.z
      const L2 = dx * dx + dy * dy + dz * dz || 1
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy + (z - a.z) * dz) / L2))
      const cx = a.x + dx * t
      const cy = a.y + dy * t
      const cz = a.z + dz * t
      // (upper arms and thighs most; forearms and calves a little less)
      const s = 1 + (k - 1) * (base === "upperarm" || base === "thigh" ? 1.1 : 0.8)
      return [cx + (x - cx) * s, cy + (y - cy) * s, cz + (z - cz) * s]
    }
    return [x, y, z]
  }
  for (let i = 0; i < n; i++) {
    const w = W.ids[i]
    if (done[w] >= 0) {
      const j = done[w]
      out[i * 3] = out[j * 3]
      out[i * 3 + 1] = out[j * 3 + 1]
      out[i * 3 + 2] = out[j * 3 + 2]
      continue
    }
    done[w] = i
    const x = P[i * 3]
    const y = P[i * 3 + 1]
    const z = P[i * 3 + 2]
    let nx = 0
    let ny = 0
    let nz = 0
    let total = 0
    for (let c = 0; c < 4; c++) {
      const wt = body.skinWeight[i * 4 + c]
      if (wt <= 0) continue
      const [mx, my, mz] = move(body.bones[body.skinIndex[i * 4 + c]] || "", x, y, z)
      nx += mx * wt
      ny += my * wt
      nz += mz * wt
      total += wt
    }
    if (total > 0) {
      out[i * 3] = nx / total
      out[i * 3 + 1] = ny / total
      out[i * 3 + 2] = nz / total
    }
  }
  return out
}
export const BUILD_SCALE = { slim: 0.93, regular: 1, strong: 1.075 }
