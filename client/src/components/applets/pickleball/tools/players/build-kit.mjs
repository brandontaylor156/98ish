// Pickleball 98, players v2 (docs/players-v2.md): the modeled kits, part of the athlete build
// (../build-mh-athletes.mjs calls fitKit for each body before writing it, then kitTextures).
//
// Every piece is one of MakeHuman's CC0 garments (MakeHuman system assets, clothes/), fitted to
// the athlete's own morphed base mesh through its .mhclo (the same machinery as the topology
// proxy), skinned with the base mesh's weights carried over the same references, and turned
// into the rest pose with the body. Pieces:
//   tee        male_casualsuit06's tee (m), female_casualsuit02's (f)
//   polo       the tee with a collar standing up from its neckline (in the trim color)
//   tank       the tee with the sleeves cut off at the armholes, straps, a scoop neck
//   shorts     the suit's jeans cut above the knee (male_casualsuit06 / female_casualsuit01)
//   briefs     under a skirt: the jeans cut high (m), female_casualsuit02's shorts (f)
//   shoes      shoes05 (white trainers), socks: its crew socks, anklesocks: cut at the ankle
// Each body vertex a piece hides (the .mhclo's delete_verts, nearest that piece, inside its
// cut) gets a bit in the body's _KIT attribute: the game drops those triangles under the
// clothes the look wears (no skin poking through, half the overdraw).
//
// The textures: one atlas per body (slots of the source garments' own UV layouts), two maps:
//   normal  the garments' tangent-space normal maps (folds, seams, hems); the shoes' made from
//           their own shading
//   detail  R the cloth's shading (its folds and ambient occlusion, prints and logos removed:
//           0.5 = the kit color as is), G trim mask (the f tee's stripes and binding, a
//           binding drawn round the m tee's neck and sleeves, the shoes' stripes and accents),
//           B the tank's own binding (its armholes and neck). Near-lossless WebP: lossy WebP's
//           4:2:0 color would bleed the masks into each other.
// The kit colors are the look's (vertex-free: uniforms per athlete, athlete.js kitMaterial).


import { addCollar, boundaryLoops, channel, cleanPrint, clipFaces, components, drawSegments, heightField, belowField, heightToNormal, hsv, luminance, maskedBlur, parseDeleteVerts, tankField, boxBlur } from "./kit.mjs"

export const BITS = { tee: 1, tank: 2, shorts: 4, briefs: 8, shoes: 16, socks: 32, anklesocks: 64, polo: 128 }
// part: what colors it takes (0 the top, 1 the bottoms, 2 the shoes, 3 the socks)
export const PART = { tee: 0, tank: 0, shorts: 1, briefs: 1, shoes: 2, socks: 3, anklesocks: 3, polo: 0 }

// which garment each piece comes from, and which of its connected pieces (by height)
const SOURCES = {
  m: [
    { file: "male_casualsuit06", slot: 0, pieces: { tee: "top", polo: "top", tank: "top", shorts: "bottom", briefs: "bottom" } },
    { file: "shoes05", slot: 1, pieces: { shoes: "shoes", socks: "socks", anklesocks: "socks" } },
  ],
  f: [
    { file: "female_casualsuit02", slot: 0, pieces: { tee: "top", polo: "top", tank: "top", briefs: "bottom" } },
    { file: "female_casualsuit01", slot: 1, pieces: { shorts: "bottom" } },
    { file: "shoes05", slot: 2, pieces: { shoes: "shoes", socks: "socks", anklesocks: "socks" } },
  ],
}
export const ATLAS = { m: { cols: 2, rows: 1 }, f: { cols: 3, rows: 1 } }

// the cuts, in the rest pose's meters (m: landmarks from the joints)
const cutOf = (kind, piece, m) => {
  if (piece === "tank") return (p) => tankField(p, m)
  if (piece === "shorts") return (p) => heightField(p, m.kneeY + (kind === "m" ? 0.075 : 0.12))
  if (piece === "briefs" && kind === "m") return (p) => heightField(p, m.hipY - 0.16)
  if (piece === "anklesocks") return (p) => belowField(p, m.ankleY + 0.035)
  return null
}

// ctx: { A (asset path), read, baseWeights, buildMesh, parseFitting, parseObj, fitVerts,
// transferWeights }. K: the builder's body (pos, mpos, pw, fit refs, poseVerts, toM, joints).
export const fitKit = (kind, K, ctx) => {
  const J = K.joints
  const m = {
    cx: J.pelvis.head[0],
    cz: J.pelvis.head[2],
    shoulderX: Math.abs(J.upperarm_l.head[0] - J.pelvis.head[0]),
    shoulderY: J.upperarm_l.head[1],
    hipY: J.thigh_l.head[1],
    kneeY: J.calf_l.head[1],
    ankleY: J.foot_l.head[1],
  }
  const pieces = []
  const nProxy = K.mpos.length / 3
  const hide = new Uint8Array(nProxy)
  for (const S of SOURCES[kind]) {
    const fit = ctx.parseFitting(ctx.read(ctx.A(S.file + ".mhclo")))
    const obj = ctx.parseObj(ctx.read(ctx.A(S.file + ".obj")))
    const del = parseDeleteVerts(ctx.read(ctx.A(S.file + ".mhclo")))
    const p = ctx.fitVerts(fit, K.pos)
    if (p.length !== obj.v.length) throw new Error(`${S.file}: ${p.length / 3} refs, ${obj.v.length / 3} verts`)
    const w = ctx.transferWeights(fit, ctx.baseWeights)
    const posed = K.poseVerts(p, w)
    const mp = new Float64Array(posed.length)
    for (let i = 0; i < posed.length; i += 3) mp.set(K.toM([posed[i], posed[i + 1], posed[i + 2]]), i)
    // the connected pieces, named by size and height
    const n = obj.v.length / 3
    const comp = components(n, obj.faces)
    const stats = Array.from({ length: comp.count }, () => ({ n: 0, y: 0 }))
    for (let i = 0; i < n; i++) {
      if (comp.id[i] < 0) continue
      stats[comp.id[i]].n++
      stats[comp.id[i]].y += mp[i * 3 + 1]
    }
    stats.forEach((s, i) => {
      s.y /= Math.max(1, s.n)
      s.id = i
    })
    const big = stats.filter((s) => s.n > 400).sort((a, b) => b.y - a.y)
    const small = stats.filter((s) => s.n <= 400 && s.n > 60)
    const roles = {
      top: new Set(big.length > 1 ? [big[0].id] : []),
      bottom: new Set(big.length > 1 ? [big[big.length - 1].id] : []),
      shoes: new Set(big.map((s) => s.id)),
      socks: new Set(small.map((s) => s.id)),
    }
    // which body (base mesh) vertices each role hides: the deleted ones, by the nearest
    // garment vertex (unposed, decimeters)
    const roleOf = new Map()
    for (const b of del) {
      if (b * 3 >= K.pos.length) continue
      let best = Infinity
      let bi = -1
      for (let i = 0; i < n; i++) {
        if (comp.id[i] < 0) continue
        const dx = p[i * 3] - K.pos[b * 3]
        const dy = p[i * 3 + 1] - K.pos[b * 3 + 1]
        const dz = p[i * 3 + 2] - K.pos[b * 3 + 2]
        const d = dx * dx + dy * dy + dz * dz
        if (d < best) {
          best = d
          bi = i
        }
      }
      if (bi >= 0) roleOf.set(b, comp.id[bi])
    }
    for (const [piece, role] of Object.entries(S.pieces)) {
      const keepComp = roles[role]
      const faces = obj.faces.filter((f) => keepComp.has(comp.id[f.v[0]]))
      const cut = cutOf(kind, piece, m)
      let mesh = { pos: mp, vt: obj.vt, faces, weights: w }
      if (cut) {
        const field = new Float64Array(n)
        for (let i = 0; i < n; i++) field[i] = cut([mp[i * 3], mp[i * 3 + 1], mp[i * 3 + 2]])
        mesh = clipFaces(mesh, field)
      }
      if (piece === "polo") {
        // the tee with a collar standing up from its neckline (the highest open loop)
        const loops = boundaryLoops(mesh.faces)
        const ys = loops.map((l) => l.reduce((s, v) => s + mesh.pos[v * 3 + 1], 0) / l.length)
        mesh = addCollar(mesh, loops[ys.indexOf(Math.max(...ys))], { cx: m.cx, cz: m.cz })
      }
      const built = ctx.buildMesh({ vt: Float64Array.from(mesh.vt), faces: mesh.faces }, Float64Array.from(mesh.pos), mesh.faces)
      // the binding's loops: a top's open edges but the lowest (the hem: neck, sleeves, armholes); the
      // shorts' leg openings (not the waist, the highest)
      const loops = boundaryLoops(mesh.faces)
      const loopY = loops.map((l) => l.reduce((s, v) => s + mesh.pos[v * 3 + 1], 0) / l.length)
      const lowest = loopY.indexOf(Math.min(...loopY))
      const highest = loopY.indexOf(Math.max(...loopY))
      const binding = piece === "tee" || piece === "tank" || piece === "polo" ? loops.filter((_, i) => i !== lowest) : piece === "shorts" ? loops.filter((_, i) => i !== highest) : []
      pieces.push({ name: piece, part: PART[piece], slot: S.slot, mesh: built, weights: mesh.weights, posAll: mesh.pos, faces: mesh.faces, vt: mesh.vt, binding, file: S.file })
      // the body under it
      const bit = BITS[piece]
      let hidden = 0
      for (let i = 0; i < nProxy; i++) {
        const r = K.fit.refs[i]
        const j = r.w[0] >= r.w[1] && r.w[0] >= r.w[2] ? 0 : r.w[1] >= r.w[2] ? 1 : 2
        const c = roleOf.get(r.i[j])
        if (c === undefined || !keepComp.has(c)) continue
        if (cut && cut([K.mpos[i * 3], K.mpos[i * 3 + 1], K.mpos[i * 3 + 2]]) < 0.004) continue
        hide[i] |= bit
        hidden++
      }
      console.log(kind, "kit", piece, built.position.length / 3, "verts", built.index.length / 3, "tris; hides", hidden, "body verts")
    }
  }
  return { pieces, hide, marks: m }
}

// ---- the atlas ----
// sharp: the sharp module; slot: texels per slot side. Returns { normal, detail } (raw RGB
// buffers) and the atlas size.
export const kitTextures = async (kind, pieces, ctx, slot) => {
  const { sharp, A } = ctx
  const G = ATLAS[kind]
  const W = G.cols * slot
  const H = G.rows * slot
  const normal = Buffer.alloc(W * H * 3)
  const detail = Buffer.alloc(W * H * 3)
  for (let i = 0; i < W * H; i++) {
    normal.set([128, 128, 255], i * 3)
    detail.set([128, 0, 0], i * 3)
  }
  const put = (sx, sy, nrm, det) => {
    for (let y = 0; y < slot; y++) {
      nrm.copy(normal, ((sy * slot + y) * W + sx * slot) * 3, y * slot * 3, (y + 1) * slot * 3)
      det.copy(detail, ((sy * slot + y) * W + sx * slot) * 3, y * slot * 3, (y + 1) * slot * 3)
    }
  }
  const raw = async (file, ch) => {
    let s = sharp(A(file)).resize(slot, slot, { fit: "fill" })
    s = ch === 3 ? s.removeAlpha() : s.ensureAlpha()
    return (await s.raw().toBuffer({ resolveWithObject: true })).data
  }
  for (const S of SOURCES[kind]) {
    const sx = S.slot % G.cols
    const sy = Math.floor(S.slot / G.cols)
    const mine = pieces.filter((p) => p.file === S.file)
    const isShoe = S.file.startsWith("shoes")
    const det = Buffer.alloc(slot * slot * 3)
    const diff = await raw(S.file + "_diffuse.png", 4)
    const lum = luminance(diff, slot, slot, 4)
    let nrm
    let ao = new Float32Array(slot * slot).fill(1)
    const fs = await import("fs")
    if (fs.existsSync(A(S.file + "_normal.png"))) nrm = await raw(S.file + "_normal.png", 3)
    if (fs.existsSync(A(S.file + "_ao.png"))) ao = channel(await raw(S.file + "_ao.png", 4), slot, slot, 4, 0)
    const trim = new Float32Array(slot * slot)
    const trimTank = new Float32Array(slot * slot)
    let shade
    if (isShoe) {
      // the shoe's shading (white leather = 0.5), its accents (the colored and the dark
      // stripes) a mask; a relief from its own shading
      const accent = new Float32Array(slot * slot)
      for (let i = 0; i < slot * slot; i++) {
        const c = hsv(diff[i * 4] / 255, diff[i * 4 + 1] / 255, diff[i * 4 + 2] / 255)
        // (the colored accents only: the dark parts keep their own shading, dark in any color)
        accent[i] = c.s > 0.35 && c.v > 0.25 ? 1 : 0
      }
      // (the sole and tread: the top fifth of the layout, and the socks' corner, keep their own shading)
      for (let y = 0; y < slot; y++)
        for (let x = 0; x < slot; x++) {
          const u = x / slot
          const v = y / slot
          if (v < 0.22 || (u > 0.78 && v > 0.84)) accent[y * slot + x] = 0
        }
      const soft = boxBlur(accent, slot, slot, 1)
      const fill = maskedBlur(lum, accent.map((a) => 1 - a), slot, slot, 6)
      shade = new Float32Array(slot * slot)
      // the white parts' brightness is the shoe's color
      let sum = 0
      let cnt = 0
      for (let i = 0; i < slot * slot; i++)
        if (!accent[i] && lum[i] > 0.5) {
          sum += lum[i]
          cnt++
        }
      const white = sum / Math.max(1, cnt)
      for (let i = 0; i < slot * slot; i++) {
        shade[i] = Math.min(1, (accent[i] ? fill[i] : lum[i]) / white) * 0.5
        trim[i] = soft[i]
      }
      // socks: their own corner, brightness about the sock color
      let ss = 0
      let sc = 0
      for (let y = Math.floor(slot * 0.84); y < slot; y++)
        for (let x = Math.floor(slot * 0.78); x < slot; x++) {
          ss += lum[y * slot + x]
          sc++
        }
      const sockMean = ss / Math.max(1, sc)
      for (let y = Math.floor(slot * 0.84); y < slot; y++)
        for (let x = Math.floor(slot * 0.78); x < slot; x++) shade[y * slot + x] = Math.min(1, (lum[y * slot + x] / sockMean) * 0.5)
      nrm = heightToNormal(boxBlur(lum, slot, slot, 1), slot, slot, slot / 256)
    } else {
      // cloth: the print and stripes out of the shading; stripes and binding (the f tee's own
      // design: its saturated orange and the dark blue binding) into the trim mask, the logo not
      const isF = S.file.startsWith("female")
      const removeExtra = new Uint8Array(slot * slot)
      for (let i = 0; i < slot * slot; i++) {
        const c = hsv(diff[i * 4] / 255, diff[i * 4 + 1] / 255, diff[i * 4 + 2] / 255)
        if (c.s > 0.45 && c.h < 0.15) removeExtra[i] = 1 // orange: print, stripes
      }
      const clean = cleanPrint(lum, slot, slot, { r: Math.max(4, Math.round(slot / 100)), tol: 0.08, extra: removeExtra })
      // normalize per piece region: the shading's mean is 0.5
      let sum = 0
      let cnt = 0
      for (let i = 0; i < slot * slot; i++)
        if (diff[i * 4 + 3] > 128 && ao[i] > 0.2) {
          sum += clean.lum[i]
          cnt++
        }
      const mean = sum / Math.max(1, cnt)
      shade = new Float32Array(slot * slot)
      const bottomsFlat = new Uint8Array(slot * slot)
      // the bottoms (denim in the source): no denim fading on athletic shorts, only the folds
      for (const p of mine)
        if (p.part === 1) {
          const tris = []
          for (const f of p.faces) for (let j = 1; j + 1 < f.v.length; j++) tris.push([f.t[0], f.t[j], f.t[j + 1]])
          fillUV(bottomsFlat, slot, tris, p.vt)
        }
      // (a texel's blur: the knit's grain is the normal map's; this keeps the folds, and packs smaller)
      const soft = boxBlur(clean.lum, slot, slot, 1)
      for (let i = 0; i < slot * slot; i++) shade[i] = bottomsFlat[i] ? 0.5 : Math.max(0, Math.min(1, (soft[i] / mean) * 0.5))
      if (isF) {
        // the f tee's stripes (orange) and binding (darker, more saturated blue than the body)
        const lx0 = 0.7
        const lx1 = 0.88
        const ly0 = 0.15
        const ly1 = 0.33
        for (let y = 0; y < slot; y++)
          for (let x = 0; x < slot; x++) {
            const i = y * slot + x
            const u = x / slot
            const v = y / slot
            if (bottomsFlat[i] || v > 0.4) continue
            if (u > lx0 && u < lx1 && v > ly0 && v < ly1) continue // (the logo)
            const c = hsv(diff[i * 4] / 255, diff[i * 4 + 1] / 255, diff[i * 4 + 2] / 255)
            if (c.s > 0.45 && c.h < 0.15) trim[i] = 1
            else if (c.h > 0.55 && c.h < 0.7 && c.s > 0.75 && c.v < 0.62) trim[i] = 1
          }
        // (the sleeves' caps too: the lower right of the layout)
        for (let y = Math.floor(slot * 0.55); y < Math.floor(slot * 0.85); y++)
          for (let x = Math.floor(slot * 0.72); x < slot; x++) {
            const i = y * slot + x
            const c = hsv(diff[i * 4] / 255, diff[i * 4 + 1] / 255, diff[i * 4 + 2] / 255)
            if (c.s > 0.45 && c.h < 0.15) trim[i] = 1
          }
      }
      // bindings drawn along the open edges: the m tee's neck and sleeves, every tank's
      // armholes and neck (about 11 mm wide)
      for (const p of mine) {
        if (!p.binding.length || (p.name === "tee" && isF)) continue
        const target = p.name === "tank" ? trimTank : trim
        const segs = []
        for (const loop of p.binding) {
          // (texels per meter along this loop, as a whole: single edges can be degenerate)
          const edges = []
          let sw = 0
          let su = 0
          for (let k = 0; k < loop.length; k++) {
            const a = loop[k]
            const b = loop[(k + 1) % loop.length]
            const ta = uvOfVertex(p, a)
            const tb = uvOfVertex(p, b)
            if (!ta || !tb) continue
            const wl = Math.hypot(p.posAll[a * 3] - p.posAll[b * 3], p.posAll[a * 3 + 1] - p.posAll[b * 3 + 1], p.posAll[a * 3 + 2] - p.posAll[b * 3 + 2])
            const ul = Math.hypot(ta[0] - tb[0], ta[1] - tb[1]) * slot
            // (an edge across a UV seam jumps across the layout: not drawn)
            if (ul > slot * 0.08 || ul > (wl * slot) / 0.15) continue
            sw += wl
            su += ul
            edges.push([ta, tb])
          }
          if (sw < 1e-6) continue
          const r = Math.max(1, Math.min(slot * 0.012, (0.0055 * su) / sw))
          for (const [ta, tb] of edges) segs.push([ta[0] * slot, ta[1] * slot, tb[0] * slot, tb[1] * slot, r])
        }
        drawSegments(target, slot, slot, segs)
      }
      if (!nrm) nrm = Buffer.alloc(slot * slot * 3, 128)
    }
    for (let i = 0; i < slot * slot; i++) {
      det[i * 3] = Math.round(Math.min(1, shade[i] * (0.25 + 0.75 * Math.max(0, Math.min(1, ao[i])))) * 255)
      det[i * 3 + 1] = Math.round(Math.min(1, trim[i]) * 255)
      det[i * 3 + 2] = Math.round(Math.min(1, trimTank[i]) * 255)
    }
    put(sx, sy, nrm, det)
  }
  return { normal, detail, W, H }
}
// a piece's UV (0..1, v down) at a vertex of its faces (the first corner that uses it)
const uvOfVertex = (p, v) => {
  if (!p._uvAt) {
    p._uvAt = new Map()
    for (const f of p.faces)
      f.v.forEach((vv, j) => {
        if (!p._uvAt.has(vv) && f.t[j] >= 0) p._uvAt.set(vv, [p.vt[f.t[j] * 2], 1 - p.vt[f.t[j] * 2 + 1]])
      })
  }
  return p._uvAt.get(v) || null
}
// mark the texels under some triangles (uv indices into vt, v up as in the OBJ)
const fillUV = (mask, size, tris, vt) => {
  for (const [a, b, c] of tris) {
    if (a < 0 || b < 0 || c < 0) continue
    const P = [a, b, c].map((t) => [vt[t * 2] * size, (1 - vt[t * 2 + 1]) * size])
    const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])) - 2)
    const x1 = Math.min(size - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])) + 2)
    const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])) - 2)
    const y1 = Math.min(size - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])) + 2)
    const den = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1])
    if (Math.abs(den) < 1e-9) continue
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const b0 = ((P[1][1] - P[2][1]) * (px - P[2][0]) + (P[2][0] - P[1][0]) * (py - P[2][1])) / den
        const b1 = ((P[2][1] - P[0][1]) * (px - P[2][0]) + (P[0][0] - P[2][0]) * (py - P[2][1])) / den
        const b2 = 1 - b0 - b1
        // (a couple of texels past the edge: filtering)
        const e = 2.5 / size
        if (b0 < -e * 8 || b1 < -e * 8 || b2 < -e * 8) continue
        mask[y * size + x] = 1
      }
  }
}
// a piece's UVs moved into its atlas slot
export const toAtlas = (uv, kind, slot) => {
  const G = ATLAS[kind]
  const sx = slot % G.cols
  const sy = Math.floor(slot / G.cols)
  const out = new Float32Array(uv.length)
  for (let i = 0; i < uv.length; i += 2) {
    out[i] = (sx + uv[i]) / G.cols
    out[i + 1] = (sy + uv[i + 1]) / G.rows
  }
  return out
}

