// Builds Pickleball 98's MakeHuman athletes (client/public/assets/pickleball/mh-*.glb) from
// MakeHuman's CC0 data (see ../CREDITS.md). Not part of the app; run by hand when the assets
// change:
//
//   1. Get the MakeHuman system assets (makehuman_system_assets_cc0.zip, from
//      https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html)
//      and, from the MPFB2 repository (github.com/makehumancommunity/mpfb2, src/mpfb/data):
//      3dobjs/base.obj, rigs/standard/rig.game_engine.json + weights.game_engine.json and the
//      macro targets (targets/macrodetails: <race>-<gender>-young, universal-*-young-*,
//      proportions/*-idealproportions, height/*). Put them in one folder:
//        <src>/base.obj, rig.game_engine.json, weights.game_engine.json
//        <src>/targets/<name>.target.gz (subfolders flattened with "__", e.g.
//          proportions__male-young-averagemuscle-averageweight-idealproportions.target.gz)
//        <src>/assets/ (the zip's files, flattened: male_generic.obj/.proxy,
//          young_lightskinned_male_diffuse.png, low-poly.obj/.mhclo, brown_eye.png,
//          eyebrow001.*, eyelashes01.*, short02.*, long01.* ...)
//   2. In any scratch folder: npm i @gltf-transform/core @gltf-transform/extensions
//      @gltf-transform/functions meshoptimizer sharp
//   3. TOOLS=<that folder> node build-mh-athletes.mjs <src> <out dir>
//
// What it does, per body (an athletic young man and woman: MakeHuman's macro modifiers):
//   - morphs the base mesh with the macro targets, finds the game-engine skeleton's joints on
//     it (the joint cubes), fits the topology proxy (about 13k quads) and carries the skin
//     weights over;
//   - turns the arms straight out to the sides and the legs straight down (the rest pose the
//     game's clothes and retargeting expect: outfit.js grows garments on a T-pose), by skinning;
//   - writes a skinned "Body" (bones named like the Quaternius bodies before them: pelvis,
//     spine_01..03, neck_01, Head, clavicle/upperarm/lowerarm/hand, fingers _01.._03 and
//     _04_leaf, thigh/calf/foot/ball), "Eyes" and "Brows" (eyebrows and eyelashes, one atlas)
//     on the Head bone; skin 1024 JPEG; meshopt-compressed, simplified to about half;
//   - mh-hair.glb: every hairstyle fitted to each body, in that body's Head bone space,
//     textures grayed (tinted at run time) with alpha; a buzz cut and a beard grown from the
//     scalp and jaw.
//
// The builder's math is pure and tested: mh-core.mjs (mhcore.test.js).
//
// Athletic bodies (2026-10-04, after "they look like a tube of toothpaste"): MakeHuman's
// muscle topology proxies (male_muscle_13290, female_muscle_13442: edge loops round the neck,
// shoulders, pecs, biceps and quads) and its local modifiers on top of the macro ones (MPFB2
// src/mpfb/data/targets/<dir>/<name>.target.gz, saved flattened as <dir>__<name>.target.gz:
// the V taper, shoulder width, lats, pecs, waist, glutes, delts, arm and leg muscle, calves,
// a shorter, thicker neck, a leaner face); a tangent-space normal map baked from a more
// muscular, sharpened copy of the same body (muscle definition the triangles can't carry);
// facial expressions as morph targets (MakeHuman's expression units, also CC0: blink, smile,
// effort, shout) on the face and the brows/lashes; a sharper eye texture with a catchlight;
// two levels of detail: <name>.glb (about half the triangles, Medium and phones) and
// <name>-hi.glb (every triangle, High). STYLE=toon builds the stylized variant of the A/B test
// (bigger head, eyes and hands, smoothed skin), never shipped.
//   (also needs: expression/units/caucasian/*.target.gz, flattened the same way)

import { createRequire } from "module"
import { pathToFileURL } from "url"
import fs from "fs"
import path from "path"
import zlib from "zlib"
import { fitKit, kitTextures, toAtlas, BITS, PART, ATLAS } from "./players/build-kit.mjs"
import { applyTarget, boneFrame, dilate, encodeTangentNormal, expressionDelta, fitVerts, highpass, macroTargets, neighbors, parseFitting, parseObj, parseTarget, qFromTo, rasterUV, rotateAbout, transferWeights, triTangents, vertexNormals } from "./mh-core.mjs"

const req = createRequire(path.join(process.env.TOOLS || ".", "package.json"))
const load = (name) => import(pathToFileURL(req.resolve(name)).href)
const { NodeIO, Document } = await load("@gltf-transform/core")
const { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } = await load("@gltf-transform/extensions")
const { prune, dedup, reorder, quantize, simplify, weld } = await load("@gltf-transform/functions")
const { MeshoptEncoder, MeshoptSimplifier } = await load("meshoptimizer")
const sharp = (await load("sharp")).default
// (players v2: the High skins as KTX2, Basis ETC1S: an eighth of the GPU memory of RGBA)
// (ESM only: imported by its file, not through require.resolve)
const { encodeToKTX2 } = await import(pathToFileURL(path.join(process.env.TOOLS || ".", "node_modules/ktx2-encoder/dist/node/index.js")).href)

const [src, outDir] = process.argv.slice(2)
if (!src || !outDir) {
  console.log("usage: TOOLS=dir node build-mh-athletes.mjs <src dir> <out dir>")
  process.exit(1)
}
fs.mkdirSync(outDir, { recursive: true })
await MeshoptEncoder.ready
await MeshoptSimplifier.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder })
const A = (f) => path.join(src, "assets", f)
const read = (f) => fs.readFileSync(f, "utf8")

// ---- the bodies ----
const STYLE = process.env.STYLE === "toon" ? "toon" : "real"
const both = (name, w) => [["arms/l-" + name, w], ["arms/r-" + name, w]]
const legs = (name, w) => [["legs/l-" + name, w], ["legs/r-" + name, w]]
// the local modifiers (MakeHuman's own sliders, -1..1 as decr/incr targets): an athlete's build
const LOCALS = {
  m: [
    ["torso/torso-vshape-incr", 0.55],
    ["torso/measure-shoulder-dist-incr", 0.3],
    ["torso/torso-muscle-dorsi-incr", 0.4],
    ["torso/torso-muscle-pectoral-incr", 0.35],
    ["torso/measure-waist-circ-decr", 0.35],
    ["stomach/stomach-pregnant-decr", 0.5],
    ["stomach/stomach-tone-incr", 0.6],
    ["buttocks/buttocks-volume-incr", 0.35],
    ["neck/measure-neck-height-decr", 0.45],
    ["neck/measure-neck-circ-incr", 0.45],
    ["head/head-fat-decr", 0.3],
    ["head/head-square", 0.25],
    ...both("upperarm-shoulder-muscle-incr", 0.6),
    ...both("upperarm-muscle-incr", 0.5),
    ...both("lowerarm-muscle-incr", 0.6),
    // (players v2: lighter legs than the first athletic pass, 0.38 / 0.5 / 0.3: thighs and
    // calves read like a pro player's, not a bodybuilder's)
    ...legs("upperleg-muscle-incr", 0.22),
    ...legs("lowerleg-muscle-incr", 0.3),
    ["legs/measure-knee-circ-decr", 0.3],
    ["legs/measure-thigh-circ-decr", 0.12],
    ["legs/measure-calf-circ-incr", 0.1],
  ],
  f: [
    ["torso/torso-vshape-incr", 0.2],
    ["torso/measure-waist-circ-decr", 0.45],
    ["torso/measure-hips-circ-incr", 0.12],
    ["stomach/stomach-pregnant-decr", 0.5],
    ["stomach/stomach-tone-incr", 0.5],
    ["buttocks/buttocks-volume-incr", 0.45],
    ["neck/measure-neck-height-decr", 0.3],
    ["neck/measure-neck-circ-incr", 0.15],
    ["head/head-fat-decr", 0.25],
    ["head/head-oval", 0.2],
    ...both("upperarm-shoulder-muscle-incr", 0.25),
    ...both("upperarm-muscle-incr", 0.25),
    ...both("lowerarm-muscle-incr", 0.3),
    ...legs("upperleg-muscle-incr", 0.2),
    ["legs/measure-thigh-circ-decr", 0.15],
    ["legs/measure-knee-circ-decr", 0.35],
    ...legs("lowerleg-muscle-incr", 0.3),
    ["legs/measure-calf-circ-incr", 0.15],
  ],
}
// the stylized variant (A/B only): a bigger head, bigger eyes and hands, a shorter neck
const TOON = [["head/head-scale-horiz-incr", 0.45], ["head/head-scale-vert-incr", 0.45], ["head/head-scale-depth-incr", 0.4], ["eyes/l-eye-scale-incr", 0.7], ["eyes/r-eye-scale-incr", 0.7], ["hands/l-hand-scale-incr", 0.3], ["hands/r-hand-scale-incr", 0.3], ["neck/measure-neck-height-decr", 0.3], ["head/head-round", 0.3]]
const BODIES = {
  m: { out: "mh-m", gender: 1, muscle: 0.8, weight: 0.42, proportions: 1, height: 0.55, proxy: "male_muscle_13290", skin: "young_lightskinned_male_diffuse.png", brows: "eyebrow002", locals: LOCALS.m },
  f: { out: "mh-f", gender: 0, muscle: 0.7, weight: 0.42, proportions: 1, height: 0.5, proxy: "female_muscle_13442", skin: "young_lightskinned_female_diffuse.png", brows: "eyebrow005", locals: LOCALS.f },
}
if (STYLE === "toon") for (const B of Object.values(BODIES)) B.locals = [...B.locals, ...TOON]
// muscle definition for the normal map: how much more muscular the detail body is
const DETAIL = { m: { muscle: 0.25, weight: -0.12, locals: 1.4, sharpen: 1.1 }, f: { muscle: 0.15, weight: -0.08, locals: 1.2, sharpen: 0.75 } }
// the facial expressions (morph targets, MakeHuman's expression units)
const U = "expression/units/caucasian/"
const EXPRESSIONS = {
  blink: [[U + "eye-left-closure", 1], [U + "eye-right-closure", 1]],
  smile: [[U + "mouth-corner-puller", 0.8], [U + "mouth-upward-retraction", 0.25], [U + "eye-left-slit", 0.3], [U + "eye-right-slit", 0.3]],
  effort: [[U + "mouth-compression", 0.6], [U + "eyebrows-left-down", 0.8], [U + "eyebrows-right-down", 0.8], [U + "eye-left-slit", 0.45], [U + "eye-right-slit", 0.45], [U + "nose-left-elevation", 0.35], [U + "nose-right-elevation", 0.35]],
  shout: [[U + "mouth-open", 0.8], [U + "mouth-corner-puller", 0.25], [U + "eyebrows-left-inner-up", 0.35], [U + "eyebrows-right-inner-up", 0.35], [U + "eye-left-opened-up", 0.3], [U + "eye-right-opened-up", 0.3]],
}
const UNIT = 0.1 // MakeHuman's decimeters -> meters
// players v2 (docs/players-v2.md): modeled kits, teeth and a skin texture per skin-tone family
// in the bodies (KIT=0 builds the bodies as before)
const KIT = process.env.KIT !== "0" && STYLE !== "toon"
// the skin textures: MakeHuman's young skins, one per family of the game's six tones
// (looks.js SKIN: 0-1 light, 2-3 mid, 4-5 dark); the light one is in the body file, the other
// two are their own files (pl-skin-<body>-<family>[-hi].jpg), fetched for a look that needs them
const SKINS = { light: "young_lightskinned_%_diffuse.png", mid: "young_lightskinned_%_diffuse2.png", dark: "young_darkskinned_%_diffuse.png" }
const HAIR_FILE = STYLE === "toon" ? "mh-hair-toon.glb" : "mh-hair.glb"

const base = parseObj(read(path.join(src, "base.obj")))
const groups = new Map()
for (const f of base.faces) {
  if (!groups.has(f.group)) groups.set(f.group, new Set())
  for (const i of f.v) groups.get(f.group).add(i)
}
const rig = JSON.parse(read(path.join(src, "rig.game_engine.json")))
const baseWeights = new Map()
for (const [bone, list] of Object.entries(JSON.parse(read(path.join(src, "weights.game_engine.json"))).weights)) {
  if (bone === "Root") continue
  for (const [v, w] of list) {
    if (!baseWeights.has(v)) baseWeights.set(v, [])
    baseWeights.get(v).push([bone, w])
  }
}
const targetCache = new Map()
const target = (name) => {
  if (!targetCache.has(name)) {
    const f = path.join(src, "targets", name.replace(/\//g, "__") + ".target.gz")
    targetCache.set(name, parseTarget(zlib.gunzipSync(fs.readFileSync(f)).toString("utf8")))
  }
  return targetCache.get(name)
}

const mean = (pos, idx) => {
  const o = [0, 0, 0]
  for (const i of idx) for (let k = 0; k < 3; k++) o[k] += pos[i * 3 + k]
  return o.map((x) => x / idx.length)
}
const jointAt = (pos, spec) => {
  if (spec.strategy === "CUBE") return mean(pos, [...groups.get(spec.cube_name)])
  if (spec.strategy === "MEAN") return mean(pos, spec.vertex_indices)
  if (spec.strategy === "VERTEX") return mean(pos, [spec.vertex_index])
  throw new Error("joint strategy " + spec.strategy)
}

// bone names as the game knows them
const RENAME = { Root: "root", head: "Head" }
const nameOf = (b) => RENAME[b] || b
const FINGERS = ["thumb", "index", "middle", "ring", "pinky"]

// ---- helpers: geometry ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
// a mesh from an OBJ's faces (quads fanned into triangles) with its own UVs: unique
// (position, uv) corners. pos: the fitted positions (Float64Array, per OBJ vertex)
const buildMesh = (obj, pos, faces = obj.faces) => {
  const key = new Map()
  const P = []
  const T = []
  const src = []
  const I = []
  const corner = (v, t) => {
    const k = v * 1e6 + (t < 0 ? 999999 : t)
    let id = key.get(k)
    if (id === undefined) {
      id = P.length / 3
      key.set(k, id)
      P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])
      T.push(t < 0 ? 0 : obj.vt[t * 2], t < 0 ? 0 : 1 - obj.vt[t * 2 + 1])
      src.push(v)
    }
    return id
  }
  for (const f of faces) {
    const ids = f.v.map((v, j) => corner(v, f.t[j]))
    for (let j = 1; j + 1 < ids.length; j++) I.push(ids[0], ids[j], ids[j + 1])
  }
  // smooth normals over positions (UV seams share them)
  const nv = pos.length / 3
  const acc = new Float64Array(nv * 3)
  for (const f of faces)
    for (let j = 1; j + 1 < f.v.length; j++) {
      const [a, b, c] = [f.v[0], f.v[j], f.v[j + 1]]
      const u = sub([pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]])
      const w = sub([pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]], [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]])
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
      for (const v of [a, b, c]) for (let k = 0; k < 3; k++) acc[v * 3 + k] += n[k]
    }
  const N = []
  for (const v of src) {
    const n = [acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]]
    const l = Math.hypot(...n) || 1
    N.push(n[0] / l, n[1] / l, n[2] / l)
  }
  return { position: Float32Array.from(P), normal: Float32Array.from(N), uv: Float32Array.from(T), index: Uint32Array.from(I), src }
}

// ---- helpers: textures ----
const jpeg = (file, size, quality = 85) => sharp(file).resize(size, size).jpeg({ quality, mozjpeg: true }).toBuffer()
// sRGB <-> linear
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
// hair (or brows): gray, scaled so the strands' average is `ref` (linear), alpha kept
const grayAlpha = async (file, size, ref = 0.27, { dark = false } = {}) => {
  const { data, info } = await sharp(file).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let sum = 0
  let cnt = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    sum += 0.2126 * toLin(data[i] / 255) + 0.7152 * toLin(data[i + 1] / 255) + 0.0722 * toLin(data[i + 2] / 255)
    cnt++
  }
  const k = ref / Math.max(1e-4, sum / Math.max(1, cnt))
  for (let i = 0; i < data.length; i += 4) {
    const l = dark ? 0.02 : Math.min(1, k * (0.2126 * toLin(data[i] / 255) + 0.7152 * toLin(data[i + 1] / 255) + 0.0722 * toLin(data[i + 2] / 255)))
    const s = Math.round(toSrgb(l) * 255)
    data[i] = data[i + 1] = data[i + 2] = s
  }
  return { data, info }
}
const webpOf = (data, w, h, quality = 72) => sharp(data, { raw: { width: w, height: h, channels: 4 } }).webp({ quality, alphaQuality: 90, effort: 6 }).toBuffer()

// a strand texture for hair grown from the scalp (gray, tinted at run time): streaks along v,
// alpha rising from the hairline (v = 0) over the first fifth; sparse = stubble (a buzz cut)
const strands = async (size, { sparse = false, seed = 1 } = {}) => {
  let r = seed
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647)
  const data = Buffer.alloc(size * size * 4)
  const cols = Array.from({ length: size }, () => ({ g: 0.55 + rnd() * 0.45, ph: rnd() * 6.28, f: 1 + rnd() * 3, on: rnd() }))
  for (let y = 0; y < size; y++) {
    const v = y / (size - 1)
    const ramp = Math.min(1, v / 0.2)
    for (let x = 0; x < size; x++) {
      const c = cols[x]
      let l
      let a = ramp
      if (sparse) {
        // stubble: fine, even speckle; the edge (hairline, beard line) breaks up into dots
        const n = rnd()
        l = 0.27 * (0.75 + 0.5 * n)
        a = ramp > 0.15 + 0.7 * rnd() ? 1 : 0
      } else {
        l = 0.27 * 1.25 * c.g * (0.85 + 0.15 * Math.sin(c.ph + v * c.f * 6.28))
        // (a ragged hairline: each strand starts at its own height)
        a = ramp >= 0.15 + 0.8 * c.on ? 1 : 0
      }
      const i = ((size - 1 - y) * size + x) * 4
      data[i] = data[i + 1] = data[i + 2] = Math.round(toSrgb(Math.min(1, l)) * 255)
      data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255)
    }
  }
  return data
}

// ---- one body ----
const built = {}
for (const [kind, B] of Object.entries(BODIES)) {
  // morph: the macro modifiers, then the athlete's local ones
  const pos = Float64Array.from(base.v)
  for (const t of macroTargets(B)) applyTarget(pos, target(t.file), t.w)
  for (const [name, w] of B.locals) applyTarget(pos, target(name), w)
  // the detail body (normal map only): more muscle, a little leaner, the locals stronger
  const dpos = Float64Array.from(base.v)
  const DT = DETAIL[kind]
  for (const t of macroTargets({ ...B, muscle: Math.min(1, B.muscle + DT.muscle), weight: Math.max(0, B.weight + DT.weight) })) applyTarget(dpos, target(t.file), t.w)
  for (const [name, w] of B.locals) applyTarget(dpos, target(name), w * (/head|neck|eyes|hands/.test(name) ? 1 : DT.locals))
  // joints (MakeHuman space: decimeters)
  const joints = {}
  for (const [b, spec] of Object.entries(rig)) joints[b] = { head: jointAt(pos, spec.head), tail: jointAt(pos, spec.tail), parent: spec.parent }
  // the proxy and its weights
  const fit = parseFitting(read(A(B.proxy + ".proxy")))
  const pobj = parseObj(read(A(B.proxy + ".obj")))
  const ppos = fitVerts(fit, pos)
  if (ppos.length !== pobj.v.length) throw new Error(`proxy ${B.proxy}: ${ppos.length / 3} refs, ${pobj.v.length / 3} verts`)
  const pw = transferWeights(fit, baseWeights)

  // ---- the rest pose: arms straight out, legs straight down (skinned moves) ----
  const moves = {} // bone -> [ { q, p } ... ] applied in order
  const addMove = (bones, q, p) => {
    for (const b of bones) (moves[b] ||= []).push({ q, p })
  }
  const moveOf = (b, v) => {
    let r = v
    for (const m of moves[b] || []) r = rotateAbout(m.q, m.p, r)
    return r
  }
  for (const sd of ["l", "r"]) {
    const s = sd === "l" ? 1 : -1
    const fingers = FINGERS.flatMap((f) => [1, 2, 3].map((k) => `${f}_0${k}_${sd}`))
    const lower = [`lowerarm_${sd}`, `hand_${sd}`, ...fingers]
    const sh = joints[`upperarm_${sd}`].head
    const el = joints[`upperarm_${sd}`].tail
    const q1 = qFromTo(sub(el, sh), [s, 0, 0])
    addMove([`upperarm_${sd}`, ...lower], q1, sh)
    const el1 = moveOf(`upperarm_${sd}`, el)
    const wr1 = moveOf(`upperarm_${sd}`, joints[`lowerarm_${sd}`].tail)
    const q2 = qFromTo(sub(wr1, el1), [s, 0, 0])
    addMove(lower, q2, el1)
    // legs: hip to ankle straight down
    const hip = joints[`thigh_${sd}`].head
    const ankle = joints[`calf_${sd}`].tail
    const q3 = qFromTo(sub(ankle, hip), [0, -1, 0])
    addMove([`thigh_${sd}`, `calf_${sd}`, `foot_${sd}`, `ball_${sd}`], q3, hip)
  }
  // (any fitted vertices with their weights: the proxy's by default, a garment's for the kits)
  const poseVerts = (src, weights = pw) => {
    const out = new Float64Array(src.length)
    for (let i = 0; i < src.length / 3; i++) {
      const v = [src[i * 3], src[i * 3 + 1], src[i * 3 + 2]]
      const o = [0, 0, 0]
      for (const [b, w] of weights[i]) {
        const m = moveOf(b, v)
        for (let k = 0; k < 3; k++) o[k] += m[k] * w
      }
      for (let k = 0; k < 3; k++) out[i * 3 + k] = weights[i].length ? o[k] : v[k]
    }
    return out
  }
  const posed = poseVerts(ppos)
  const dposed = poseVerts(fitVerts(fit, dpos))
  for (const [b, j] of Object.entries(joints)) {
    j.head = moveOf(b, j.head)
    j.tail = moveOf(b, j.tail)
  }
  // meters, soles on the court
  let minY = Infinity
  for (let i = 1; i < posed.length; i += 3) minY = Math.min(minY, posed[i])
  const toM = (v) => [v[0] * UNIT, (v[1] - minY) * UNIT, v[2] * UNIT]
  const mpos = new Float64Array(posed.length)
  const dmpos = new Float64Array(posed.length)
  for (let i = 0; i < posed.length; i += 3) {
    mpos.set(toM([posed[i], posed[i + 1], posed[i + 2]]), i)
    dmpos.set(toM([dposed[i], dposed[i + 1], dposed[i + 2]]), i)
  }
  for (const j of Object.values(joints)) {
    j.head = toM(j.head)
    j.tail = toM(j.tail)
  }
  // the head's own space (unposed: the head never moves), for the eyes, brows and hair
  const fromBase = (p) => toM(p) // (the head, eyes and hair aren't touched by the arm and leg moves)

  // ---- the skeleton ----
  const bones = [] // { name, parent, head, tail }
  const order = []
  const visit = (b) => {
    order.push(b)
    for (const [c, j] of Object.entries(joints)) if (j.parent === b) visit(c)
  }
  visit("Root")
  for (const b of order) bones.push({ name: nameOf(b), parent: joints[b].parent ? nameOf(joints[b].parent) : null, head: joints[b].head, tail: joints[b].tail, src: b })
  // leaves: the fingertips and the toes (no weights: the finger curl code reads their rest spots)
  for (const sd of ["l", "r"]) {
    for (const f of FINGERS) {
      const j = joints[`${f}_03_${sd}`]
      bones.push({ name: `${f}_04_leaf_${sd}`, parent: `${f}_03_${sd}`, head: j.tail, tail: [j.tail[0] + (j.tail[0] - j.head[0]), j.tail[1] + (j.tail[1] - j.head[1]), j.tail[2] + (j.tail[2] - j.head[2])], leaf: true })
    }
    const ball = joints[`ball_${sd}`]
    bones.push({ name: `ball_leaf_${sd}`, parent: `ball_${sd}`, head: ball.tail, tail: [ball.tail[0], ball.tail[1], ball.tail[2] + 0.05], leaf: true })
  }
  const byName = Object.fromEntries(bones.map((b) => [b.name, b]))
  // rest rotations: y along the bone; x like the Quaternius bodies' (the game's clip layers
  // turn bones in their own space): +x for the trunk and legs, down for the left arm and up
  // for the right (palms down), forward-ish for the clavicles
  const hintOf = (b) => {
    const n = b.name
    if (/^clavicle/.test(n)) {
      const d = sub(b.tail, b.head)
      return [d[1] * 0 - d[2] * 1, 0, d[0] * 1] // cross(dir, up)
    }
    if (/^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_.*l$/.test(n)) return [0, -1, 0]
    if (/^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_.*r$/.test(n)) return [0, 1, 0]
    return [1, 0, 0]
  }
  for (const b of bones) {
    const dir = b.name === "root" ? [0, 1, 0] : b.leaf ? sub(byName[b.parent].tail, byName[b.parent].head) : sub(b.tail, b.head)
    b.frame = boneFrame(dir, hintOf(b.leaf ? byName[b.parent] : b))
  }

  // face landmarks (meters): the eyes' and the mouth's centers (from the base mesh's helper
  // eyes and teeth), the skull's middle front to back
  const eye = fromBase(mean(pos, [...groups.get("helper-l-eye"), ...groups.get("helper-r-eye")]))
  const mouth = fromBase(mean(pos, [...groups.get("helper-upper-teeth"), ...groups.get("helper-lower-teeth")]))
  let zMin = Infinity
  let zMax = -Infinity
  for (let i = 0; i < pw.length; i++) {
    if (pw[i][0]?.[0] !== "head" || mpos[i * 3 + 1] < eye[1]) continue
    zMin = Math.min(zMin, mpos[i * 3 + 2])
    zMax = Math.max(zMax, mpos[i * 3 + 2])
  }
  const face = { eye, mouth, center: [0, eye[1], (zMin + zMax) / 2] }
  // the face down to under the chin moves with the skull alone (MakeHuman shares the jaw with
  // the neck bone): so what's worn on the Head bone (a beard, hair) stays on the skin
  let rigid = 0
  for (let i = 0; i < pw.length; i++) {
    if (!pw[i].some(([b]) => b === "head") || mpos[i * 3 + 1] < mouth[1] - 0.07) continue
    pw[i] = [["head", 1]]
    rigid++
  }
  console.log(kind, "face vertices on the head alone:", rigid)
  console.log(kind, "eyes", eye.map((x) => x.toFixed(3)).join(","), "mouth", mouth.map((x) => x.toFixed(3)).join(","), "skull z", zMin.toFixed(3), zMax.toFixed(3))
  // the facial expressions: each one's move of the body's (proxy) vertices, meters (the face
  // is on the Head bone alone and untouched by the rest pose's turns, so the move is as fitted)
  const expr = {}
  for (const [name, list] of Object.entries(EXPRESSIONS)) {
    expr[name] = expressionDelta(fit, pos, list.map(([t, w]) => [target(t), w]), UNIT)
    let moved = 0
    for (let i = 0; i < expr[name].length; i += 3) if (Math.hypot(expr[name][i], expr[name][i + 1], expr[name][i + 2]) > 2e-4) moved++
    console.log(kind, "expression", name, moved, "vertices")
  }
  built[kind] = { kind, B, pos, mpos, dmpos, pobj, pw, bones, byName, joints, fromBase, face, expr, fit, poseVerts, toM }
  // players v2: the modeled kits (players/build-kit.mjs), and which body vertices they hide
  if (KIT) built[kind].kit = fitKit(kind, built[kind], { A, read, baseWeights, buildMesh, parseFitting, parseObj, fitVerts, transferWeights })
  console.log(kind, "proxy", ppos.length / 3, "verts", pobj.faces.length, "faces; height", (Math.max(...Array.from(mpos).filter((_, i) => i % 3 === 1))).toFixed(3), "m")
}

// ---- writing glTF ----
// matrices (column-major 4x4) from a frame and a position
const matOf = (f, p) => [f.x[0], f.x[1], f.x[2], 0, f.y[0], f.y[1], f.y[2], 0, f.z[0], f.z[1], f.z[2], 0, p[0], p[1], p[2], 1]
// the inverse of a rigid matrix
const invRigid = (m) => {
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0]
  const t = [m[12], m[13], m[14]]
  return [r[0], r[1], r[2], 0, r[4], r[5], r[6], 0, r[8], r[9], r[10], 0, -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]), -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]), -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]), 1]
}
const mulM = (a, b) => {
  const o = new Array(16).fill(0)
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]
  return o
}
const quatOfMat = (m) => {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]
  const tr = m00 + m11 + m22
  let q
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1)
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]
  }
  const l = Math.hypot(...q)
  return q.map((x) => x / l)
}

// (skinned bodies keep float positions so the run-time clothing math sees real meters; the
// rigid hair is quantized, its node transform undoing it)
const compress = async (doc, positions = false) => {
  await doc.transform(dedup(), prune(), reorder({ encoder: MeshoptEncoder }), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, pattern: positions ? /^(POSITION|NORMAL|TEXCOORD_\d+)$/ : /^(NORMAL|TEXCOORD_\d+|JOINTS_0|WEIGHTS_0)$/ }))
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
}

// ---- the muscle-definition normal map: the detail body's normals (sharpened) in the tangent
// space of the shipped body's, rasterized over the UV layout ----
const bakeNormals = (K, size) => {
  const faces = K.pobj.faces
  const n0 = vertexNormals(K.mpos, faces)
  const nb = neighbors(K.mpos.length / 3, faces)
  const region = (i) => {
    const b = K.pw[i][0]?.[0] || ""
    if (b === "head") return 0.15
    if (/hand|thumb|index|middle|ring|pinky|foot|ball/.test(b)) return 0.35
    return 1
  }
  const detail = highpass(K.dmpos, nb, { k: DETAIL[K.kind].sharpen, iterations: 5, weight: region })
  // (the head keeps its own shape: the detail body only adds muscle below it)
  for (let i = 0; i < detail.length / 3; i++)
    if (region(i) < 0.2) for (let k = 0; k < 3; k++) detail[i * 3 + k] = K.mpos[i * 3 + k]
  const nd = vertexNormals(detail, faces)
  const uv = []
  const cv = []
  const tris = []
  for (const f of faces) {
    const ids = f.v.map((v, j) => {
      cv.push(v)
      const t = f.t[j]
      uv.push(t < 0 ? 0 : K.pobj.vt[t * 2], t < 0 ? 0 : 1 - K.pobj.vt[t * 2 + 1])
      return cv.length - 1
    })
    for (let j = 1; j + 1 < ids.length; j++) tris.push([ids[0], ids[j], ids[j + 1]])
  }
  const P = (v) => [K.mpos[v * 3], K.mpos[v * 3 + 1], K.mpos[v * 3 + 2]]
  const N = (arr, v) => [arr[v * 3], arr[v * 3 + 1], arr[v * 3 + 2]]
  const frames = tris.map((t) => triTangents(P(cv[t[0]]), P(cv[t[1]]), P(cv[t[2]]), [uv[t[0] * 2], uv[t[0] * 2 + 1]], [uv[t[1] * 2], uv[t[1] * 2 + 1]], [uv[t[2] * 2], uv[t[2] * 2 + 1]]))
  const img = Buffer.alloc(size * size * 3)
  const mask = new Uint8Array(size * size)
  rasterUV(size, tris, uv, (ti, b0, b1, b2, x, y) => {
    const fr = frames[ti]
    if (!fr) return
    const t = tris[ti]
    const mix = (arr) => {
      const a = N(arr, cv[t[0]])
      const b = N(arr, cv[t[1]])
      const c = N(arr, cv[t[2]])
      const v = [a[0] * b0 + b[0] * b1 + c[0] * b2, a[1] * b0 + b[1] * b1 + c[1] * b2, a[2] * b0 + b[2] * b1 + c[2] * b2]
      const l = Math.hypot(...v) || 1
      return v.map((q) => q / l)
    }
    const rgb = encodeTangentNormal(mix(nd), mix(n0), fr.T, fr.B)
    img.set(rgb, (y * size + x) * 3)
    mask[y * size + x] = 1
  })
  dilate(img, mask, size, 3, 8)
  for (let i = 0; i < size * size; i++) if (!mask[i]) img.set([128, 128, 255], i * 3)
  return sharp(img, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 90, effort: 6 }).toBuffer()
}

// ---- the eyes' texture: MakeHuman's brown eye, the iris deepened with a dark limbal ring and
// a bigger pupil, the whites cleaned up, and a catchlight (eyes that read alive at a distance) ----
const eyeTexture = async (size) => {
  const { data, info } = await sharp(A("brown_eye.png")).resize(size, size).flatten({ background: "#ffffff" }).raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  // the two irises: the saturated reddish pixels, one on each side of the diagonal
  const groups = [{ x: 0, y: 0, n: 0 }, { x: 0, y: 0, n: 0 }]
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * ch
      const [r, g, b] = [data[o], data[o + 1], data[o + 2]]
      if (!(r > g * 1.35 && r > b * 1.5 && r < 200)) continue
      const G = groups[x > y ? 0 : 1]
      G.x += x
      G.y += y
      G.n++
    }
  const irises = groups.filter((G) => G.n).map((G) => ({ x: G.x / G.n, y: G.y / G.n, r: Math.sqrt(G.n / Math.PI) }))
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * ch
      let [r, g, b] = [data[o], data[o + 1], data[o + 2]]
      const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255
      let hit = null
      for (const I of irises) {
        const d = Math.hypot(x - I.x, y - I.y) / I.r
        if (d < 1.12) hit = { d, I, dx: (x - I.x) / I.r, dy: (y - I.y) / I.r }
      }
      if (!hit) {
        // the white of the eye: less red, a touch brighter
        r = r * 0.6 + 236 * 0.4
        g = g * 0.6 + 232 * 0.4
        b = b * 0.6 + 228 * 0.4
      } else {
        const { d } = hit
        // the iris: deep brown fibers with a warmer ring round the pupil
        const fiber = 0.55 + 0.9 * lum
        const warm = Math.max(0, 1 - Math.abs(d - 0.5) / 0.25)
        let c = [70 * fiber + 40 * warm, 42 * fiber + 22 * warm, 24 * fiber + 6 * warm]
        // the limbal ring, then blended into the white beyond the iris
        if (d > 0.82) {
          const k = Math.min(1, (d - 0.82) / 0.18)
          c = c.map((q) => q * (1 - 0.65 * k))
        }
        if (d > 1.0) {
          const k = Math.min(1, (d - 1.0) / 0.12)
          c = c.map((q, i) => q * (1 - k) + [236, 232, 228][i] * k)
        }
        // the pupil
        if (d < 0.42) {
          const k = Math.min(1, (0.42 - d) / 0.05)
          c = c.map((q) => q * (1 - k) + 10 * k)
        }
        // the catchlight: a soft highlight up and to one side
        const cl = Math.hypot(hit.dx + 0.32, hit.dy + 0.32)
        if (cl < 0.2) {
          const k = Math.min(1, (0.2 - cl) / 0.07)
          c = c.map((q) => q * (1 - k) + 250 * k)
        }
        ;[r, g, b] = c
      }
      data[o] = Math.max(0, Math.min(255, Math.round(r)))
      data[o + 1] = Math.max(0, Math.min(255, Math.round(g)))
      data[o + 2] = Math.max(0, Math.min(255, Math.round(b)))
    }
  return sharp(data, { raw: { width: size, height: size, channels: ch } }).removeAlpha().jpeg({ quality: 90 }).toBuffer()
}

// ---- simplify (Medium): about half the triangles; the face's moving parts (expressions) and
// the UV seams kept exactly ----
const simplifyMesh = (mesh, ratio, error, locked, flags = ["LockBorder"]) => {
  const n = mesh.position.length / 3
  const lock = new Uint8Array(n)
  for (let i = 0; i < n; i++) lock[i] = locked(i) ? 1 : 0
  const [out] = MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(mesh.index), Float32Array.from(mesh.position), 3, Float32Array.from(mesh.normal), 3, [0.5, 0.5, 0.5], lock, Math.floor((mesh.index.length * ratio) / 3) * 3, error, flags)
  const map = new Int32Array(n).fill(-1)
  const keep = []
  for (const v of out) if (map[v] < 0) map[v] = keep.push(v) - 1
  const pick = (arr, k) => {
    const o = new arr.constructor(keep.length * k)
    keep.forEach((v, i) => {
      for (let c = 0; c < k; c++) o[i * k + c] = arr[v * k + c]
    })
    return o
  }
  return { position: pick(mesh.position, 3), normal: pick(mesh.normal, 3), uv: pick(mesh.uv, 2), index: Uint32Array.from(out, (v) => map[v]), src: keep.map((v) => mesh.src[v]) }
}

const skinHex = {}
const bodyCache = {}
// players v2: what was built (public/assets/pickleball/players.json; the asset tests read it)
const manifest = { version: 2, bodies: {}, files: {}, bits: BITS, part: PART }
const writeBody = async (kind, K, lod) => {
  const { B, pos, mpos, pobj, pw, bones, fromBase, expr } = K
  const hi = lod === "hi"
  const file = `${B.out}${hi ? "-hi" : ""}${STYLE === "toon" ? "-toon" : ""}.glb`
  const doc = new Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene("athlete")
  const armature = doc.createNode("Armature")
  scene.addChild(armature)
  // bone nodes
  const world = {}
  const nodes = {}
  for (const b of bones) {
    world[b.name] = matOf(b.frame, b.head)
    const local = b.parent ? mulM(invRigid(world[b.parent]), world[b.name]) : world[b.name]
    const n = doc.createNode(b.name).setTranslation([local[12], local[13], local[14]]).setRotation(quatOfMat(local))
    nodes[b.name] = n
    if (b.parent) nodes[b.parent].addChild(n)
    else armature.addChild(n)
  }
  const jointList = bones.map((b) => b.name)
  const jIndex = Object.fromEntries(jointList.map((n, i) => [n, i]))
  const ibm = new Float32Array(jointList.length * 16)
  jointList.forEach((n, i) => ibm.set(invRigid(world[n]), i * 16))
  const skin = doc.createSkin("skin").setSkeleton(nodes.root).setInverseBindMatrices(doc.createAccessor().setType("MAT4").setArray(ibm).setBuffer(buffer))
  for (const n of jointList) skin.addJoint(nodes[n])

  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  // a skinned mesh; morphs: { name: Float32Array (3 per vertex) } become morph targets
  const skinned = (name, mesh, weightsOf, mat, morphs = null, extra = null) => {
    const n = mesh.position.length / 3
    const J = new Uint16Array(n * 4)
    const W = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      const ws = weightsOf(i)
      ws.forEach(([b, w], k) => {
        J[i * 4 + k] = jIndex[nameOf(b)]
        W[i * 4 + k] = w
      })
    }
    const prim = doc
      .createPrimitive()
      .setAttribute("POSITION", acc("VEC3", mesh.position))
      .setAttribute("NORMAL", acc("VEC3", mesh.normal))
      .setAttribute("TEXCOORD_0", acc("VEC2", mesh.uv))
      .setAttribute("JOINTS_0", acc("VEC4", J))
      .setAttribute("WEIGHTS_0", acc("VEC4", W))
      .setIndices(acc("SCALAR", mesh.position.length / 3 > 65535 ? mesh.index : Uint16Array.from(mesh.index)))
      .setMaterial(mat)
    for (const [k, v] of Object.entries(extra || {})) prim.setAttribute(k, acc(v.type, v.array))
    const m = doc.createMesh(name).addPrimitive(prim)
    if (morphs) {
      const names = Object.keys(morphs)
      for (const t of names) prim.addTarget(doc.createPrimitiveTarget(t).setAttribute("POSITION", acc("VEC3", morphs[t])))
      m.setWeights(names.map(() => 0)).setExtras({ targetNames: names })
    }
    const node = doc.createNode(name).setMesh(m).setSkin(skin)
    scene.addChild(node)
    return node
  }
  // a morph per expression for a mesh whose vertices came from fitted vertices (src)
  const morphsFor = (mesh, deltas) => {
    const out = {}
    for (const [name, d] of Object.entries(deltas)) {
      const a = new Float32Array(mesh.position.length)
      mesh.src.forEach((v, i) => {
        a[i * 3] = d[v * 3]
        a[i * 3 + 1] = d[v * 3 + 1]
        a[i * 3 + 2] = d[v * 3 + 2]
      })
      out[name] = a
    }
    return out
  }

  // the body
  let body = buildMesh(pobj, mpos)
  if (!hi) {
    const moving = (v) => Object.values(expr).some((d) => Math.hypot(d[v * 3], d[v * 3 + 1], d[v * 3 + 2]) > 3e-4)
    body = simplifyMesh(body, Number(process.env.RATIO || 0.5), Number(process.env.ERR || 0.0012), (i) => moving(body.src[i]))
  }
  const cache = (bodyCache[kind] ||= {})
  // (players v2: High's 2048 skins are KTX2 files beside the body, pl-skin-*-hi.ktx2; the file
  // carries a 1024 one, drawn until they're in or if a device can't read them)
  const texSize = hi && !KIT ? 2048 : 1024
  cache["skin" + texSize] ||= await (async () => {
    let s = sharp(A(B.skin)).resize(texSize, texSize)
    if (STYLE === "toon") s = s.median(5).blur(1.2)
    return s.jpeg({ quality: hi ? 84 : 86, mozjpeg: true }).toBuffer()
  })()
  const skinJpg = cache["skin" + texSize]
  cache.normal ||= await bakeNormals(K, 1024)
  cache.eye ||= await eyeTexture(256)
  if (!skinHex[kind]) {
    // the skin's average where the body actually samples it (the texture's empty space is a
    // darker, redder fill), in linear light like the shader sees it
    const { data, info } = await sharp(skinJpg).raw().toBuffer({ resolveWithObject: true })
    const sum = [0, 0, 0]
    for (let j = 0; j < body.uv.length / 2; j++) {
      const x = Math.min(info.width - 1, Math.max(0, Math.floor(body.uv[j * 2] * info.width)))
      const y = Math.min(info.height - 1, Math.max(0, Math.floor(body.uv[j * 2 + 1] * info.height)))
      const o = (y * info.width + x) * info.channels
      for (let k = 0; k < 3; k++) sum[k] += toLin(data[o + k] / 255)
    }
    const [r, g, b] = sum.map((x) => Math.round(toSrgb(x / (body.uv.length / 2)) * 255))
    skinHex[kind] = "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")
  }
  const bodyMat = doc
    .createMaterial("Body")
    .setBaseColorTexture(doc.createTexture("skin").setImage(skinJpg).setMimeType("image/jpeg"))
    .setNormalTexture(doc.createTexture("muscle").setImage(cache.normal).setMimeType("image/webp"))
    .setRoughnessFactor(0.6)
    .setMetallicFactor(0)
    .setExtras({ refSkin: skinHex[kind], hueMix: 0.45, skinGain: 0.86, headScale: STYLE === "toon" ? 1.08 : 1.02, style: STYLE, lod })
  // (players v2: which kit pieces hide each vertex, a bit per piece, build-kit.mjs BITS; VEC4
  // bytes, the first one used: meshopt wants 4-byte vertex strides)
  let kitAttr = null
  if (K.kit) {
    const a = new Uint8Array((body.position.length / 3) * 4)
    body.src.forEach((v, i) => (a[i * 4] = K.kit.hide[v]))
    kitAttr = { _KIT: { type: "VEC4", array: a } }
  }
  skinned("Body", body, (i) => pw[body.src[i]], bodyMat, morphsFor(body, expr), kitAttr)

  // the eyes (two low-poly spheres) and the brows + lashes (one atlas), all on the Head bone
  const head = () => [["head", 1]]
  {
    const fit = parseFitting(read(A("low-poly.mhclo")))
    const obj = parseObj(read(A("low-poly.obj")))
    const p = fitVerts(fit, pos)
    const m = new Float64Array(p.length)
    for (let i = 0; i < p.length; i += 3) m.set(fromBase([p[i], p[i + 1], p[i + 2]]), i)
    const mesh = buildMesh(obj, m)
    skinned("Eyes", mesh, head, doc.createMaterial("Eyes").setBaseColorTexture(doc.createTexture("eye").setImage(cache.eye).setMimeType("image/jpeg")).setRoughnessFactor(0.15).setMetallicFactor(0))
  }
  {
    const parts = []
    const deltas = []
    for (const [name, u0] of [[B.brows, 0], ["eyelashes01", 0.5]]) {
      const fit = parseFitting(read(A(name + ".mhclo")))
      const obj = parseObj(read(A(name + ".obj")))
      const p = fitVerts(fit, pos)
      const m = new Float64Array(p.length)
      for (let i = 0; i < p.length; i += 3) m.set(fromBase([p[i], p[i + 1], p[i + 2]]), i)
      const mesh = buildMesh(obj, m)
      for (let i = 0; i < mesh.uv.length; i += 2) mesh.uv[i] = u0 + mesh.uv[i] * 0.5
      parts.push(mesh)
      const d = {}
      for (const [e, list] of Object.entries(EXPRESSIONS)) d[e] = expressionDelta(fit, pos, list.map(([t, w]) => [target(t), w]), UNIT)
      deltas.push(morphsFor(mesh, d))
    }
    const merged = mergeMeshes(parts)
    const morphs = {}
    for (const e of Object.keys(EXPRESSIONS)) {
      const a = new Float32Array(merged.position.length)
      a.set(deltas[0][e], 0)
      a.set(deltas[1][e], deltas[0][e].length)
      morphs[e] = a
    }
    // the atlas: brows gray (tinted with the hair color at run time), lashes near black
    const S = 256
    const brow = await grayAlpha(A(B.brows + ".png"), S, 0.27)
    const lash = await grayAlpha(A("eyelashes01.png"), S, 0.27, { dark: true })
    const atlas = Buffer.alloc(S * 2 * S * 4)
    for (let y = 0; y < S; y++) {
      brow.data.copy(atlas, y * S * 2 * 4, y * S * 4, (y + 1) * S * 4)
      lash.data.copy(atlas, y * S * 2 * 4 + S * 4, y * S * 4, (y + 1) * S * 4)
    }
    const img = await sharp(atlas, { raw: { width: S * 2, height: S, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer()
    skinned("Brows", merged, head, doc.createMaterial("Brows").setBaseColorTexture(doc.createTexture("brows").setImage(img).setMimeType("image/png")).setAlphaMode("MASK").setAlphaCutoff(0.35).setDoubleSided(true).setRoughnessFactor(0.9).setMetallicFactor(0), morphs)
  }

  // ---- players v2: the kit pieces (one atlas material), the teeth ----
  if (K.kit) {
    const slot = hi ? 1024 : 512
    cache["kit" + slot] ||= await (async () => {
      const t = await kitTextures(kind, K.kit.pieces, { sharp, A }, slot)
      return {
        normal: await sharp(t.normal, { raw: { width: t.W, height: t.H, channels: 3 } }).webp({ quality: 88, effort: 6 }).toBuffer(),
        detail: await sharp(t.detail, { raw: { width: t.W, height: t.H, channels: 3 } }).webp({ nearLossless: true, quality: 60, effort: 6 }).toBuffer(),
      }
    })()
    const tex = cache["kit" + slot]
    if (process.env.KIT_DEBUG) {
      fs.writeFileSync(path.join(outDir, `kit-${kind}-${slot}-normal.webp`), tex.normal)
      fs.writeFileSync(path.join(outDir, `kit-${kind}-${slot}-detail.webp`), tex.detail)
    }
    // (glTF has no slot for the detail map: it rides as the occlusion texture, whose red holds
    // the occlusion anyway, times the cloth's shading; athlete.js reads all three channels)
    const kitMat = doc
      .createMaterial("Kit")
      .setNormalTexture(doc.createTexture("kitNormal").setImage(tex.normal).setMimeType("image/webp"))
      .setOcclusionTexture(doc.createTexture("kitDetail").setImage(tex.detail).setMimeType("image/webp"))
      .setRoughnessFactor(0.85)
      .setMetallicFactor(0)
      .setDoubleSided(true)
      .setExtras({ atlas: ATLAS[kind], bits: BITS, part: PART })
    for (const pc of K.kit.pieces) {
      let mesh = { ...pc.mesh }
      if (!hi) mesh = simplifyMesh(mesh, pc.part >= 2 ? 0.5 : 0.6, 0.0015, () => false)
      mesh.uv = toAtlas(mesh.uv, kind, pc.slot)
      const node = skinned("Kit_" + pc.name, mesh, (i) => pc.weights[mesh.src[i]], kitMat)
      node.setExtras({ part: pc.part, bit: BITS[pc.name] })
    }
    // the teeth (MakeHuman's teeth_base, on the Head bone, opening with the face's expressions)
    {
      const fit = parseFitting(read(A("teeth_base.mhclo")))
      const obj = parseObj(read(A("teeth_base.obj")))
      const p = fitVerts(fit, pos)
      const m = new Float64Array(p.length)
      for (let i = 0; i < p.length; i += 3) m.set(fromBase([p[i], p[i + 1], p[i + 2]]), i)
      let mesh = buildMesh(obj, m)
      const d = {}
      for (const [e, list] of Object.entries(EXPRESSIONS)) d[e] = expressionDelta(fit, pos, list.map(([t, w]) => [target(t), w]), UNIT)
      // (many small pieces, each tooth its own: borders free, or nothing simplifies)
      mesh = simplifyMesh(mesh, hi ? 0.3 : 0.15, 0.08, () => false, [])
      cache.teeth ||= await sharp(A("teeth.png")).resize(256, 256).flatten({ background: "#d8c8b8" }).jpeg({ quality: 86 }).toBuffer()
      skinned("Teeth", mesh, head, doc.createMaterial("Teeth").setBaseColorTexture(doc.createTexture("teeth").setImage(cache.teeth).setMimeType("image/jpeg")).setRoughnessFactor(0.3).setMetallicFactor(0), morphsFor(mesh, d))
    }
    // the other skin families' textures, beside the body (and their average tones)
    for (const [fam, pattern] of Object.entries(SKINS)) {
      const name = pattern.replace("%", kind === "m" ? "male" : "female")
      const out = hi ? `pl-skin-${kind}-${fam}-hi.ktx2` : `pl-skin-${kind}-${fam}.jpg`
      const jpg = fam === "light" ? skinJpg : await sharp(A(name)).resize(1024, 1024).jpeg({ quality: 86, mozjpeg: true }).toBuffer()
      if (hi) {
        const png = await sharp(A(name)).resize(2048, 2048).png().toBuffer()
        const ktx = await encodeToKTX2(new Uint8Array(png), {
          isUASTC: false,
          qualityLevel: 160,
          compressionLevel: 3,
          generateMipmap: true,
          isPerceptual: true,
          imageDecoder: async (b) => {
            const { data, info } = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
            return { data: new Uint8Array(data), width: info.width, height: info.height }
          },
        })
        fs.writeFileSync(path.join(outDir, out), ktx)
      } else if (fam !== "light") fs.writeFileSync(path.join(outDir, out), jpg)
      const { data, info } = await sharp(jpg).raw().toBuffer({ resolveWithObject: true })
      const sum = [0, 0, 0]
      for (let j = 0; j < body.uv.length / 2; j++) {
        const x = Math.min(info.width - 1, Math.max(0, Math.floor(body.uv[j * 2] * info.width)))
        const y = Math.min(info.height - 1, Math.max(0, Math.floor(body.uv[j * 2 + 1] * info.height)))
        const o = (y * info.width + x) * info.channels
        for (let k = 0; k < 3; k++) sum[k] += toLin(data[o + k] / 255)
      }
      const hex = "#" + sum.map((x) => Math.round(toSrgb(x / (body.uv.length / 2)) * 255).toString(16).padStart(2, "0")).join("")
      const M = (manifest.bodies[kind] ||= { skins: {} })
      M.skins[fam] = { ...(M.skins[fam] || {}), ref: hex, [hi ? "hi" : "med"]: fam === "light" && !hi ? null : out }
      if (fam !== "light" || hi) manifest.files[out] = fs.statSync(path.join(outDir, out)).size
    }
  }

  doc.createExtension(EXTTextureWebP).setRequired(true)
  await compress(doc)
  await io.write(path.join(outDir, file), doc)
  if (K.kit) {
    manifest.files[file] = fs.statSync(path.join(outDir, file)).size
    const M = manifest.bodies[kind]
    M[hi ? "hi" : "med"] = { file, meshes: Object.fromEntries(doc.getRoot().listMeshes().map((m) => [m.getName(), m.listPrimitives()[0].getIndices().getCount() / 3])), bones: bones.map((b) => b.name), textures: Object.fromEntries(doc.getRoot().listTextures().map((t) => [t.getName(), t.getImage().byteLength])) }
  }
  const tris = doc
    .getRoot()
    .listMeshes()
    .map((m) => `${m.getName()} ${m.listPrimitives()[0].getIndices().getCount() / 3}t`)
  console.log(file, fs.statSync(path.join(outDir, file)).size, "bytes", tris.join(", "), "skin", skinHex[kind])
}
for (const [kind, K] of Object.entries(built)) for (const lod of process.env.LODS ? process.env.LODS.split(",") : ["med", "hi"]) await writeBody(kind, K, lod)
if (KIT) {
  fs.writeFileSync(path.join(outDir, "players.json"), JSON.stringify(manifest, null, 1))
  console.log("players.json written")
}

// ---- hair: every style fitted to each body, in that body's Head bone space ----
function mergeMeshes(parts) {
  let nv = 0
  let ni = 0
  for (const p of parts) {
    nv += p.position.length / 3
    ni += p.index.length
  }
  const out = { position: new Float32Array(nv * 3), normal: new Float32Array(nv * 3), uv: new Float32Array(nv * 2), index: new Uint32Array(ni), src: [] }
  let ov = 0
  let oi = 0
  for (const p of parts) {
    out.position.set(p.position, ov * 3)
    out.normal.set(p.normal, ov * 3)
    out.uv.set(p.uv, ov * 2)
    for (let i = 0; i < p.index.length; i++) out.index[oi + i] = p.index[i] + ov
    ov += p.position.length / 3
    oi += p.index.length
  }
  return out
}

// style name in the game -> the MakeHuman hair it's made from
const HAIRS = {
  Hair_Short: "short02",
  Hair_Spiky: "short01",
  Hair_Swept: "short04",
  Hair_Pixie: "short03",
  Hair_Bob: "bob02",
  Hair_Ponytail: "ponytail01",
  Hair_Long: "long01",
  Hair_Braid: "braid01",
  Hair_Afro: "afro01",
}
if (process.env.HAIR !== "0") {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene("hair")
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  const mats = {}
  const matFor = async (style, file) => {
    if (mats[style]) return mats[style]
    const size = /short0[134]/.test(style) ? 256 : 512
    const { data, info } = await grayAlpha(A(file), size, 0.27)
    const tex = doc.createTexture(style).setImage(await webpOf(data, info.width, info.height)).setMimeType("image/webp")
    mats[style] = doc.createMaterial(style).setBaseColorTexture(tex).setAlphaMode("MASK").setAlphaCutoff(0.5).setDoubleSided(true).setRoughnessFactor(0.7).setMetallicFactor(0)
    return mats[style]
  }
  for (const [kind, K] of Object.entries(built)) {
    const H = K.byName.Head
    const toHead = (p) => {
      const d = sub(p, H.head)
      return [d[0] * H.frame.x[0] + d[1] * H.frame.x[1] + d[2] * H.frame.x[2], d[0] * H.frame.y[0] + d[1] * H.frame.y[1] + d[2] * H.frame.y[2], d[0] * H.frame.z[0] + d[1] * H.frame.z[1] + d[2] * H.frame.z[2]]
    }
    const toHeadN = (n) => [n[0] * H.frame.x[0] + n[1] * H.frame.x[1] + n[2] * H.frame.x[2], n[0] * H.frame.y[0] + n[1] * H.frame.y[1] + n[2] * H.frame.y[2], n[0] * H.frame.z[0] + n[1] * H.frame.z[1] + n[2] * H.frame.z[2]]
    const addMesh = (name, mesh, mat) => {
      const P = new Float32Array(mesh.position.length)
      const N = new Float32Array(mesh.normal.length)
      for (let i = 0; i < P.length; i += 3) {
        P.set(toHead([mesh.position[i], mesh.position[i + 1], mesh.position[i + 2]]), i)
        N.set(toHeadN([mesh.normal[i], mesh.normal[i + 1], mesh.normal[i + 2]]), i)
      }
      const prim = doc
        .createPrimitive()
        .setAttribute("POSITION", acc("VEC3", P))
        .setAttribute("NORMAL", acc("VEC3", N))
        .setAttribute("TEXCOORD_0", acc("VEC2", mesh.uv))
        .setIndices(acc("SCALAR", P.length / 3 > 65535 ? mesh.index : Uint16Array.from(mesh.index)))
        .setMaterial(mat)
      scene.addChild(doc.createNode(`${name}@${kind}`).setMesh(doc.createMesh(`${name}@${kind}`).addPrimitive(prim)))
      console.log("hair", `${name}@${kind}`, P.length / 3, "verts", mesh.index.length / 3, "tris")
    }
    for (const [name, style] of Object.entries(HAIRS)) {
      const fit = parseFitting(read(A(style + ".mhclo")))
      const obj = parseObj(read(A(style + ".obj")))
      const p = fitVerts(fit, K.pos)
      const m = new Float64Array(p.length)
      for (let i = 0; i < p.length; i += 3) m.set(K.fromBase([p[i], p[i + 1], p[i + 2]]), i)
      const mat = await matFor(style, fs.readdirSync(path.join(src, "assets")).find((f) => f.startsWith(style.replace("afro01", "afro")) && f.endsWith("_diffuse.png")))
      if (p.length !== obj.v.length) throw new Error(`${style}: ${p.length / 3} refs, ${obj.v.length / 3} verts`)
      addMesh(name, buildMesh(obj, m), mat)
    }
    // ---- grown from the body: a buzz cut, slicked-back hair with a bun, a beard ----
    const F = K.face
    const c = F.center
    // where on the head a body vertex is: around the vertical axis (0 = the face, pi = the back)
    // and its height relative to the eyes
    const polar = (i) => {
      const x = K.mpos[i * 3] - c[0]
      const z = K.mpos[i * 3 + 2] - c[2]
      return { th: Math.abs(Math.atan2(x, z)), y: K.mpos[i * 3 + 1] - F.eye[1], x, z, yAbs: K.mpos[i * 3 + 1] }
    }
    const lerpTable = (t, table) => {
      for (let k = 1; k < table.length; k++)
        if (t <= table[k][0]) {
          const [a0, b0] = table[k - 1]
          const [a1, b1] = table[k]
          return b0 + ((b1 - b0) * (t - a0)) / (a1 - a0)
        }
      return table[table.length - 1][1]
    }
    const D = Math.PI / 180
    // the hairline's height above the eyes, by the angle round the head
    const HAIRLINE = [[0, 0.07], [35 * D, 0.062], [60 * D, 0.045], [80 * D, 0.032], [100 * D, 0.03], [118 * D, -0.01], [140 * D, -0.055], [180 * D, -0.075]]
    const dominant = (i) => K.pw[i][0]?.[0]
    const onHead = (i) => dominant(i) === "head"
    // a shell over the body's faces whose corners all pass pick(i): pushed out along the normals,
    // UVs from uvOf(i)
    const shell = (pick, push, uvOf) => {
      const faces = K.pobj.faces.filter((f) => f.v.every(pick))
      const mesh = buildMesh(K.pobj, K.mpos, faces)
      for (let j = 0; j < mesh.src.length; j++) {
        for (let k = 0; k < 3; k++) mesh.position[j * 3 + k] += mesh.normal[j * 3 + k] * push
        const [u, v] = uvOf(mesh.src[j])
        mesh.uv[j * 2] = u
        mesh.uv[j * 2 + 1] = 1 - Math.min(0.94, v) // (never the texture's edge: it wraps to the transparent hairline row)
      }
      return mesh
    }
    const scalp = (i) => onHead(i) && polar(i).y > lerpTable(polar(i).th, HAIRLINE) - 0.012
    const scalpUV = (i) => {
      const q = polar(i)
      return [q.x * 14 + q.z * 5, Math.min(1, Math.max(0, (q.y - lerpTable(q.th, HAIRLINE) + 0.012) / 0.06))]
    }
    mats.buzz ||= doc.createMaterial("buzz").setBaseColorTexture(doc.createTexture("buzz").setImage(await webpOf(await strands(128, { sparse: true, seed: 7 }), 128, 128)).setMimeType("image/webp")).setAlphaMode("MASK").setAlphaCutoff(0.5).setDoubleSided(true).setRoughnessFactor(0.8).setMetallicFactor(0)
    mats.slick ||= doc.createMaterial("slick").setBaseColorTexture(doc.createTexture("slick").setImage(await webpOf(await strands(256, { seed: 3 }), 256, 256)).setMimeType("image/webp")).setAlphaMode("MASK").setAlphaCutoff(0.5).setDoubleSided(true).setRoughnessFactor(0.6).setMetallicFactor(0)
    addMesh("Hair_Buzz", shell(scalp, 0.0025, scalpUV), mats.buzz)
    // slicked back with a bun at the crown
    {
      const cap = shell(scalp, 0.004, scalpUV)
      const R = 0.045
      const ctr = [c[0], F.eye[1] + 0.085, c[2] - 0.075]
      const P = []
      const N = []
      const T = []
      const I = []
      const SEG = 16
      const RING = 10
      for (let a = 0; a <= RING; a++)
        for (let b = 0; b <= SEG; b++) {
          const phi = (a / RING) * Math.PI
          const th = (b / SEG) * Math.PI * 2
          const n = [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)]
          // (squashed toward the head, a little flat on top)
          P.push(ctr[0] + n[0] * R, ctr[1] + n[1] * R * 0.85, ctr[2] + n[2] * R * 0.8 - 0.012)
          N.push(...n)
          T.push((b / SEG) * 4 + (a % 2) * 0.03, 0.02 + 0.03 * (a / RING))
        }
      for (let a = 0; a < RING; a++)
        for (let b = 0; b < SEG; b++) {
          const i0 = a * (SEG + 1) + b
          I.push(i0, i0 + SEG + 1, i0 + 1, i0 + 1, i0 + SEG + 1, i0 + SEG + 2)
        }
      // (the bun uses the opaque rows of the strand texture: v near 1 after the flip below)
      const bun = { position: Float32Array.from(P), normal: Float32Array.from(N), uv: Float32Array.from(T.map((x, j) => (j % 2 ? 1 - (0.6 + x) : x))), index: Uint32Array.from(I), src: [] }
      addMesh("Hair_Bun", mergeMeshes([cap, bun]), mats.slick)
    }
    // a beard: the jaw, chin, cheeks below the cheekbones and a moustache, not the lips
    {
      const mouthY = F.mouth[1] - F.eye[1]
      const CHEEK = [[0, -0.045], [14 * D, -0.048], [30 * D, -0.052], [55 * D, -0.045], [80 * D, -0.02], [95 * D, 0.004], [105 * D, 0.004]]
      const beard = (i) => {
        const d = dominant(i)
        if (d !== "head" && d !== "neck_01") return false
        const q = polar(i)
        if (q.th > 103 * D) return false
        if (q.y > lerpTable(q.th, CHEEK)) return false
        // under the chin and down the jaw, not far down the neck
        if (q.y < mouthY - (q.th < 40 * D ? 0.066 : q.th < 75 * D ? 0.06 : 0.04)) return false
        // the lips
        const lx = Math.abs(K.mpos[i * 3] - F.mouth[0])
        if (q.th < 35 * D && Math.abs(q.y - mouthY) < 0.009 + 0.004 * Math.max(0, 1 - lx / 0.026) && lx < 0.029) return false
        return true
      }
      const beardUV = (i) => {
        const q = polar(i)
        return [q.x * 14 + q.z * 5, Math.min(1, Math.max(0.25, (lerpTable(q.th, CHEEK) - q.y) / 0.025))]
      }
      mats.beard ||= doc.createMaterial("beard").setBaseColorTexture(doc.createTexture("beard").setImage(await webpOf(await strands(128, { sparse: true, seed: 11 }), 128, 128)).setMimeType("image/webp")).setAlphaMode("MASK").setAlphaCutoff(0.5).setDoubleSided(true).setRoughnessFactor(0.85).setMetallicFactor(0)
      addMesh("Hair_Beard", shell(beard, 0.003, beardUV), mats.beard)
    }
  }
  doc.createExtension(EXTTextureWebP).setRequired(true)
  await compress(doc, true)
  await io.write(path.join(outDir, HAIR_FILE), doc)
  console.log(HAIR_FILE, fs.statSync(path.join(outDir, HAIR_FILE)).size)
}
