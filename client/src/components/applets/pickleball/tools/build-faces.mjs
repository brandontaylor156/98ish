// Players v3: builds the photo faces (client/public/assets/pickleball/pl-face-*, faces.json) from
// Microsoft Rocketbox's avatars (MIT; github.com/microsoft/Microsoft-Rocketbox) onto the
// MakeHuman athletes already built by build-mh-athletes.mjs. Not part of the app; run by hand
// when the faces change (docs/players-v3.md):
//
//   1. For each face in FACES below, put the avatar's files in <rb>/<Name>/:
//        <Name>.glb      (Assets/Avatars/<group>/<Name>/Export/<Name>.fbx converted with
//                         FBX2glTF --binary; the npm package fbx2gltf ships the binary)
//        <prefix>_head_color.tga, <prefix>_head_normal.tga, <prefix>_head_specular.tga
//                        (Assets/Avatars/<group>/<Name>/Textures/)
//   2. TOOLS=<folder with @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions
//      meshoptimizer sharp ktx2-encoder> node build-faces.mjs <rb> <mh assets> <out dir> [ids]
//      <mh assets>: the MakeHuman system assets folder (the young_*_diffuse.png skins);
//      <out dir>: usually client/public/assets/pickleball (reads mh-*.glb there, writes the faces).
//
// Per face it writes:
//   pl-face-<id>.jpg       the body's skin atlas with the photographed head baked in (1024, Medium)
//   pl-face-<id>-hi.ktx2   the same at 2048 (High/Ultra; Basis ETC1S)
//   pl-face-<id>-n.jpg     detail: RG the photo's own normal (tangent space, ours), B its specular
//   pl-face-<id>.bin       the face's shape: per level of detail, the moved Body vertices
//                          (position and normal), the eyes' and teeth's shifts, the lashes'
//   and faces.json: the list (body, name, skin tone, files, sizes).
// The math is in players/faces.mjs (faces.test.js).

import { createRequire } from "module"
import { pathToFileURL } from "url"
import fs from "fs"
import path from "path"
import { add, adjacency, classifyTargets, colorStats, dot, faceLandmarks, faceWeight, grow, fitSphere, fitSurface, len, mul, norm, normalsOf, ourLandmarks, photoWeight, sampleImage, similarity, sourceLandmarks, sub, thinPlate, toLin, toSrgb, triangleGrid, weld, weldedMesh } from "./players/faces.mjs"
import { rasterUV, dilate, triTangents } from "./mh-core.mjs"

const req = createRequire(path.join(process.env.TOOLS || ".", "package.json"))
const load = (name) => import(pathToFileURL(req.resolve(name)).href)
const { NodeIO } = await load("@gltf-transform/core")
const { ALL_EXTENSIONS } = await load("@gltf-transform/extensions")
const { dequantize } = await load("@gltf-transform/functions")
const { MeshoptDecoder, MeshoptEncoder } = await load("meshoptimizer")
const sharp = (await load("sharp")).default
const { encodeToKTX2 } = await import(pathToFileURL(path.join(process.env.TOOLS || ".", "node_modules/ktx2-encoder/dist/node/index.js")).href)
await MeshoptDecoder.ready
await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder })

const [rbDir, mhAssets, outDir, onlyArg] = process.argv.slice(2)
if (!rbDir || !mhAssets || !outDir) {
  console.log("usage: TOOLS=dir node build-faces.mjs <rocketbox dir> <makehuman assets> <out dir> [id,id]")
  process.exit(1)
}
const ONLY = onlyArg ? new Set(onlyArg.split(",")) : null

// The faces: id (what a look's `face` names), the body they go on, the Rocketbox avatar and its
// texture prefix, and a short description for the Locker Room
export const FACES = [
  { id: "m01", body: "m", src: "Sports_Male_01", prefix: "m021" },
  { id: "m02", body: "m", src: "Male_Adult_04", prefix: "m006" },
  { id: "m03", body: "m", src: "Male_Adult_10", prefix: "m024" },
  { id: "f01", body: "f", src: "Sports_Female_01", prefix: "f021" },
  { id: "f02", body: "f", src: "Business_Female_01", prefix: "f014" },
  { id: "m04", body: "m", src: "Male_Adult_05", prefix: "m009" },
  { id: "m05", body: "m", src: "Male_Adult_12", prefix: "m007" },
  { id: "m06", body: "m", src: "Male_Adult_03", prefix: "m004" },
  { id: "m07", body: "m", src: "Male_Adult_07", prefix: "m013" },
  { id: "m08", body: "m", src: "Male_Adult_09", prefix: "m017" },
  { id: "f03", body: "f", src: "Medical_Female_01", prefix: "f152" },
  { id: "f04", body: "f", src: "Female_Adult_11", prefix: "f011" },
  { id: "f05", body: "f", src: "Female_Adult_14", prefix: "f017" },
  { id: "f06", body: "f", src: "Sports_Female_02", prefix: "f013" },
  { id: "f07", body: "f", src: "Female_Adult_05", prefix: "f005" },
]

// ---- reading ----
const TGA = (file) => {
  const b = fs.readFileSync(file)
  const idLen = b[0]
  const type = b[2]
  const w = b.readUInt16LE(12)
  const h = b.readUInt16LE(14)
  const ch = b[16] / 8
  const desc = b[17]
  let o = 18 + idLen
  const px = Buffer.alloc(w * h * ch)
  if (type === 2 || type === 3) b.copy(px, 0, o, o + px.length)
  else if (type === 10) {
    let i = 0
    while (i < px.length) {
      const c = b[o++]
      const n = (c & 127) + 1
      if (c & 128) {
        for (let k = 0; k < n; k++) b.copy(px, i + k * ch, o, o + ch)
        o += ch
      } else {
        b.copy(px, i, o, o + n * ch)
        o += n * ch
      }
      i += n * ch
    }
  } else throw new Error("TGA type " + type)
  const top = !!(desc & 32)
  const data = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((top ? y : h - 1 - y) * w + x) * ch
      const d = (y * w + x) * 3
      data[d] = px[s + 2]
      data[d + 1] = px[s + 1]
      data[d + 2] = px[s]
    }
  return { width: w, height: h, channels: 3, data }
}
const readImage = async (file, size) => {
  let s = sharp(file).removeAlpha()
  if (size) s = s.resize(size, size)
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, channels: info.channels, data }
}
// a primitive's arrays (dequantized), and the node's world matrix applied to positions/normals
const arrays = (node, prim) => {
  const m = node.getWorldMatrix()
  const pos = Float64Array.from(prim.getAttribute("POSITION").getArray())
  const xf = (a, w) => {
    for (let i = 0; i < a.length; i += 3) {
      const [x, y, z] = [a[i], a[i + 1], a[i + 2]]
      a[i] = m[0] * x + m[4] * y + m[8] * z + w * m[12]
      a[i + 1] = m[1] * x + m[5] * y + m[9] * z + w * m[13]
      a[i + 2] = m[2] * x + m[6] * y + m[10] * z + w * m[14]
    }
  }
  xf(pos, 1)
  const nrmA = prim.getAttribute("NORMAL")?.getArray()
  const nrm = nrmA ? Float64Array.from(nrmA) : null
  if (nrm) xf(nrm, 0)
  return {
    pos,
    nrm,
    uv: Float64Array.from(prim.getAttribute("TEXCOORD_0").getArray()),
    index: Uint32Array.from(prim.getIndices().getArray()),
    joints: prim.getAttribute("JOINTS_0")?.getArray(),
    weights: prim.getAttribute("WEIGHTS_0")?.getArray(),
    targets: prim.listTargets().map((t) => {
      const a = t.getAttribute("POSITION")?.getArray()
      if (!a) return null
      const d = Float64Array.from(a)
      xf(d, 0)
      return d
    }),
  }
}
const readGlb = async (file) => {
  const doc = await io.read(file)
  await doc.transform(dequantize())
  return doc
}
const meshNode = (doc, name) => doc.getRoot().listNodes().find((n) => n.getMesh() && (n.getName() === name || n.getMesh().getName() === name))

// ---- the MakeHuman body (ours), per kind and level of detail ----
const ours = {}
const ourBody = async (kind) => {
  if (ours[kind]) return ours[kind]
  const out = {}
  for (const lod of ["hi", "med"]) {
    const file = path.join(outDir, `mh-${kind}${lod === "hi" ? "-hi" : ""}.glb`)
    const doc = await readGlb(file)
    const body = arrays(meshNode(doc, "Body"), meshNode(doc, "Body").getMesh().listPrimitives()[0])
    const names = meshNode(doc, "Body").getMesh().getExtras()?.targetNames || []
    const eyes = arrays(meshNode(doc, "Eyes"), meshNode(doc, "Eyes").getMesh().listPrimitives()[0])
    const brows = arrays(meshNode(doc, "Brows"), meshNode(doc, "Brows").getMesh().listPrimitives()[0])
    const teeth = arrays(meshNode(doc, "Teeth"), meshNode(doc, "Teeth").getMesh().listPrimitives()[0])
    out[lod] = { body, eyes, brows, teeth, target: Object.fromEntries(names.map((n, i) => [n, body.targets[i]])) }
  }
  return (ours[kind] = out)
}

// ---- a Rocketbox head, in our frame ----
const sourceHead = async (face) => {
  const dir = path.join(rbDir, face.src)
  // (the _facial file has the same mesh plus its facial targets: its smile and jaw find landmarks)
  const facial = path.join(dir, face.src + "_facial.glb")
  const doc = await readGlb(fs.existsSync(facial) ? facial : path.join(dir, face.src + ".glb"))
  const node = doc.getRoot().listNodes().find((n) => n.getMesh())
  const prims = node.getMesh().listPrimitives()
  const headPrim = prims.find((p) => /head/i.test(p.getMaterial()?.getName() || "")) || prims[0]
  const head = arrays(node, headPrim)
  // the bones' rest positions (from the inverse bind matrices), in the same frame as the mesh
  const skin = doc.getRoot().listSkins()[0]
  const ibm = skin.getInverseBindMatrices().getArray()
  const m = node.getWorldMatrix()
  const bones = {}
  skin.listJoints().forEach((j, k) => {
    const a = Array.from(ibm.slice(k * 16, k * 16 + 16))
    // (the bone's world position: the inverse of an affine bind matrix's translation)
    const R = [
      [a[0], a[4], a[8]],
      [a[1], a[5], a[9]],
      [a[2], a[6], a[10]],
    ]
    const t = [a[12], a[13], a[14]]
    const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0])
    const inv = [
      [(R[1][1] * R[2][2] - R[1][2] * R[2][1]) / det, (R[0][2] * R[2][1] - R[0][1] * R[2][2]) / det, (R[0][1] * R[1][2] - R[0][2] * R[1][1]) / det],
      [(R[1][2] * R[2][0] - R[1][0] * R[2][2]) / det, (R[0][0] * R[2][2] - R[0][2] * R[2][0]) / det, (R[0][2] * R[1][0] - R[0][0] * R[1][2]) / det],
      [(R[1][0] * R[2][1] - R[1][1] * R[2][0]) / det, (R[0][1] * R[2][0] - R[0][0] * R[2][1]) / det, (R[0][0] * R[1][1] - R[0][1] * R[1][0]) / det],
    ]
    const p = [-(inv[0][0] * t[0] + inv[0][1] * t[1] + inv[0][2] * t[2]), -(inv[1][0] * t[0] + inv[1][1] * t[1] + inv[1][2] * t[2]), -(inv[2][0] * t[0] + inv[2][1] * t[1] + inv[2][2] * t[2])]
    const w = [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]
    bones[j.getName().replace(/^Bip01 /, "")] = w
  })
  // which triangles are skin (the head's big UV islands), which the eyeballs (the round island
  // bottom left of the atlas), and the rest (teeth, tongue, mouth) neither
  const nt = head.index.length / 3
  const skinTris = []
  const eyeTris = []
  // (UV islands: the triangles joined through shared vertices; a vertex is split at a seam)
  const parent = Int32Array.from({ length: head.pos.length / 3 }, (_, i) => i)
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]]
    return a
  }
  for (let t = 0; t < nt; t++) {
    const a = find(head.index[t * 3])
    parent[find(head.index[t * 3 + 1])] = a
    parent[find(head.index[t * 3 + 2])] = a
  }
  const island = new Map() // root -> { tris, v }
  for (let t = 0; t < nt; t++) {
    const r = find(head.index[t * 3])
    if (!island.has(r)) island.set(r, { tris: [], v: 0 })
    const I = island.get(r)
    I.tris.push(t)
    for (let k = 0; k < 3; k++) I.v += head.uv[head.index[t * 3 + k] * 2 + 1] / 3
  }
  for (let t = 0; t < nt; t++) {
    let u = 0
    let v = 0
    for (let k = 0; k < 3; k++) {
      u += head.uv[head.index[t * 3 + k] * 2] / 3
      v += head.uv[head.index[t * 3 + k] * 2 + 1] / 3
    }
    const I = island.get(find(head.index[t * 3]))
    // the head's skin: islands centered in the upper part of the atlas (the face, the scalp, the
    // neck); below them, the eyeballs, teeth, tongue and any modeled hair (a bun, a ponytail)
    if (u < 0.36 && v > 0.6) {
      if (u > 0.19 && v > 0.84) eyeTris.push(t)
    } else if (I.v / I.tris.length < 0.6 && I.tris.length > 20) skinTris.push(t)
  }
  const color = TGA(path.join(dir, `${face.prefix}_head_color.tga`))
  const nfile = path.join(dir, `${face.prefix}_head_normal.tga`)
  const sfile = path.join(dir, `${face.prefix}_head_specular.tga`)
  // (the textures' islands grown a few texels into the background, so samples at an island's
  // edge never pick up the black around it: no seams on the scalp)
  const normal = fs.existsSync(nfile) ? TGA(nfile) : null
  const spec = fs.existsSync(sfile) ? TGA(sfile) : null
  const tris = []
  for (let t = 0; t < head.index.length / 3; t++) tris.push([head.index[t * 3], head.index[t * 3 + 1], head.index[t * 3 + 2]])
  for (const img of [color, normal, spec]) {
    if (!img) continue
    const mask = new Uint8Array(img.width * img.height)
    rasterUV(img.width, tris, head.uv, (ti, b0, b1, b2, x, y) => (mask[y * img.width + x] = 1))
    grow(img.data, mask, img.width, 3, 6)
  }
  return { head, bones, skinTris, eyeTris, color, normal, spec }
}

// apply a similarity transform to a flat position array (in place) and to normals
const transformAll = (T, pos, nrm, targets = []) => {
  for (const d of targets)
    if (d)
      for (let i = 0; i < d.length; i += 3) {
        const R = T.R
        const v = [d[i], d[i + 1], d[i + 2]]
        for (let k = 0; k < 3; k++) d[i + k] = T.s * (R[k][0] * v[0] + R[k][1] * v[1] + R[k][2] * v[2])
      }
  for (let i = 0; i < pos.length; i += 3) {
    const q = T.apply([pos[i], pos[i + 1], pos[i + 2]])
    pos[i] = q[0]
    pos[i + 1] = q[1]
    pos[i + 2] = q[2]
  }
  if (nrm)
    for (let i = 0; i < nrm.length; i += 3) {
      const R = T.R
      const n = [nrm[i], nrm[i + 1], nrm[i + 2]]
      const q = norm([R[0][0] * n[0] + R[0][1] * n[1] + R[0][2] * n[2], R[1][0] * n[0] + R[1][1] * n[1] + R[1][2] * n[2], R[2][0] * n[0] + R[2][1] * n[1] + R[2][2] * n[2]])
      nrm[i] = q[0]
      nrm[i + 1] = q[1]
      nrm[i + 2] = q[2]
    }
}

const LM_WEIGHT = { eyeL: 3, eyeR: 3, mouthL: 2, mouthR: 2, lipUp: 1.5, lipLo: 1.5, nose: 1.5, chin: 1, under: 0.5, browL: 1, browR: 1, browM: 0.7 }

const manifest = fs.existsSync(path.join(outDir, "faces.json")) ? JSON.parse(fs.readFileSync(path.join(outDir, "faces.json"), "utf8")) : { version: 1, faces: {} }

for (const face of FACES) {
  if (ONLY && !ONLY.has(face.id)) continue
  const t0 = Date.now()
  const B = await ourBody(face.body)
  const hi = B.hi
  const src = await sourceHead(face)
  // ---- landmarks and the rigid fit ----
  const ourLm = ourLandmarks({ pos: hi.body.pos, eyes: hi.eyes.pos, smile: hi.target.smile, shout: hi.target.shout })
  const srcSurf0 = triangleGrid(src.head.pos, src.head.index, src.skinTris)
  const srcLm0 = sourceLandmarks(src.bones, srcSurf0)
  const names = Object.keys(LM_WEIGHT).filter((k) => ourLm.pts[k] && srcLm0.pts[k])
  const T = similarity(
    names.map((k) => srcLm0.pts[k]),
    names.map((k) => ourLm.pts[k]),
    names.map((k) => LM_WEIGHT[k])
  )
  transformAll(T, src.head.pos, src.head.nrm, src.head.targets)
  for (const k of Object.keys(src.bones)) src.bones[k] = T.apply(src.bones[k])
  const surf = triangleGrid(src.head.pos, src.head.index, src.skinTris)
  const srcLm1 = sourceLandmarks(src.bones, surf)
  // the same landmarks on the source as on ours (its eyeballs' centers, its own smile and jaw)
  const nS = src.head.pos.length / 3
  const isSkin = new Uint8Array(nS)
  for (const t of src.skinTris) for (let k = 0; k < 3; k++) isSkin[src.head.index[t * 3 + k]] = 1
  const masked = Float64Array.from(src.head.pos)
  for (let i = 0; i < nS; i++) if (!isSkin[i]) masked[i * 3] = 99
  const eyeCenter = (sgn) => {
    let f = -1
    for (const t of src.eyeTris)
      for (let k = 0; k < 3; k++) {
        const v = src.head.index[t * 3 + k]
        if (sgn * src.head.pos[v * 3] > 0 && (f < 0 || src.head.pos[v * 3 + 2] > src.head.pos[f * 3 + 2])) f = v
      }
    // (an average eyeball: its center 11.5 mm behind the cornea's front)
    return f < 0 ? src.bones[sgn > 0 ? "LEye" : "REye"] : [src.head.pos[f * 3], src.head.pos[f * 3 + 1], src.head.pos[f * 3 + 2] - 0.0115]
  }
  const sEyeL = eyeCenter(1)
  const sEyeR = eyeCenter(-1)
  const tg = classifyTargets(masked, src.head.targets, mul(add(sEyeL, sEyeR), 0.5))
  const srcLm = tg.smile >= 0 && tg.jaw >= 0 ? faceLandmarks({ pos: masked, eyeL: sEyeL, eyeR: sEyeR, smile: src.head.targets[tg.smile], jaw: src.head.targets[tg.jaw] }) : srcLm1
  console.log(face.id, "source targets: smile", tg.smile, "jaw", tg.jaw, "missing", Object.keys(LM_WEIGHT).filter((k) => !srcLm.pts[k]).join(",") || "none", "ours missing", Object.keys(LM_WEIGHT).filter((k) => !ourLm.pts[k]).join(",") || "none")
  const lmNames = Object.keys(LM_WEIGHT).filter((k) => ourLm.pts[k] && srcLm.pts[k])
  const residual = lmNames.map((k) => [k, +(len(sub(srcLm.pts[k], ourLm.pts[k])) * 1000).toFixed(1)])
  console.log(face.id, "scale", T.s.toFixed(3), "landmark gaps (mm)", residual.map((r) => r.join(" ")).join(", "))
  // the source's triangle normals (for the facing test)
  const tn = []
  for (let t = 0; t < src.head.index.length / 3; t++) {
    const a = src.head.index[t * 3]
    const b = src.head.index[t * 3 + 1]
    const c = src.head.index[t * 3 + 2]
    const P = (i) => [src.head.pos[i * 3], src.head.pos[i * 3 + 1], src.head.pos[i * 3 + 2]]
    tn[t] = norm(require3cross(sub(P(b), P(a)), sub(P(c), P(a))))
  }
  // ---- the face's shape: bend ours onto theirs (front of the face only) ----
  const W = weldedMesh(hi.body.pos, hi.body.index)
  const move = new Float64Array(W.count)
  for (let i = 0; i < W.count; i++) move[i] = faceWeight([W.pos[i * 3], W.pos[i * 3 + 1], W.pos[i * 3 + 2]], ourLm.mid)
  const tps = thinPlate(
    lmNames.map((k) => ourLm.pts[k]),
    lmNames.map((k) => srcLm.pts[k]),
    1e-4
  )
  const start = Float64Array.from(W.pos)
  for (let i = 0; i < W.count; i++) {
    if (move[i] <= 0) continue
    const p = [W.pos[i * 3], W.pos[i * 3 + 1], W.pos[i * 3 + 2]]
    const q = tps(p)
    for (let k = 0; k < 3; k++) start[i * 3 + k] = p[k] + (q[k] - p[k]) * move[i]
  }
  const pins = Object.entries(ourLm.vtx)
    .filter(([k, v]) => v >= 0 && srcLm.pts[k])
    .map(([k, v]) => [W.canon[v], srcLm.pts[k]])
  // (the mouth's inside and the lips' seam aren't pulled onto the photo's surface: they ride
  // along with the lips, so the mouth stays closed as it was)
  const cornerX0 = Math.abs(hi.body.pos[ourLm.vtx.mouthL * 3])
  const lipFront0 = Math.min(hi.body.pos[ourLm.vtx.lipUp * 3 + 2], hi.body.pos[ourLm.vtx.lipLo * 3 + 2])
  const skip = new Uint8Array(W.count)
  for (let i = 0; i < W.count; i++) {
    const q = [W.pos[i * 3], W.pos[i * 3 + 1], W.pos[i * 3 + 2]]
    const dy = Math.abs(q[1] - ourLm.seam)
    if (Math.abs(q[0]) < cornerX0 * 1.05 && ((dy < 0.0045 && q[2] < lipFront0 - 0.001) || (dy < 0.013 && q[2] < lipFront0 - 0.0035))) skip[i] = 1
  }
  const fitted = fitSurface({ pos: start, index: W.index, count: W.count }, move, surf, { pins, rounds: 14, maxR: 0.025, smooth: 10, stiff: [6, 1.5], normalsT: (t) => tn[t], skip })
  // the moved vertices, per original vertex of the hi body
  const nrmW = normalsOf(fitted, W.index, W.count)
  const nV = hi.body.pos.length / 3
  const newPos = new Float64Array(nV * 3)
  const newNrm = new Float64Array(nV * 3)
  for (let i = 0; i < nV; i++) {
    const c = W.canon[i]
    for (let k = 0; k < 3; k++) {
      newPos[i * 3 + k] = fitted[c * 3 + k]
      newNrm[i * 3 + k] = move[c] > 0 ? nrmW[c * 3 + k] : hi.body.nrm[i * 3 + k]
    }
  }
  let maxMove = 0
  for (let i = 0; i < nV; i++) maxMove = Math.max(maxMove, Math.hypot(newPos[i * 3] - hi.body.pos[i * 3], newPos[i * 3 + 1] - hi.body.pos[i * 3 + 1], newPos[i * 3 + 2] - hi.body.pos[i * 3 + 2]))
  console.log(face.id, "face moved up to", (maxMove * 1000).toFixed(1), "mm")
  if (process.env.FACE_DEBUG) {
    // (the heads for the debug renders: ours before and after, the source aligned)
    const head = (pos) => Array.from(pos, (x) => +x.toFixed(5))
    const skinIdx = src.skinTris.flatMap((t) => [src.head.index[t * 3], src.head.index[t * 3 + 1], src.head.index[t * 3 + 2]])
    fs.writeFileSync(
      path.join(process.env.FACE_DEBUG, `${face.id}-debug.json`),
      JSON.stringify({ mid: ourLm.mid, ours: { pos: head(hi.body.pos), fitted: head(newPos), index: Array.from(hi.body.index), uv: head(hi.body.uv) }, src: { pos: head(src.head.pos), index: skinIdx, uv: head(src.head.uv) }, lm: { ours: ourLm.pts, src: srcLm.pts } })
    )
  }
  if (process.env.FACE_BAKE === "0") continue

  // ---- the other parts that sit on the face: eyes, teeth, lashes ----
  const eyeShift = { l: sub(srcLm.pts.eyeL, ourLm.pts.eyeL), r: sub(srcLm.pts.eyeR, ourLm.pts.eyeR) }
  const shiftAt = (vs) => {
    const d = [0, 0, 0]
    for (const v of vs) for (let k = 0; k < 3; k++) d[k] += (newPos[v * 3 + k] - hi.body.pos[v * 3 + k]) / vs.length
    return d
  }
  const teethShift = shiftAt([ourLm.vtx.lipUp, ourLm.vtx.lipLo, ourLm.vtx.mouthL, ourLm.vtx.mouthR])
  // a point near the face moves like the closest few face vertices (inverse distance)
  const faceVerts = []
  for (let i = 0; i < nV; i++) if (move[W.canon[i]] > 0) faceVerts.push(i)
  const followFace = (p, k = 4) => {
    const near = []
    for (const i of faceVerts) {
      const d = Math.hypot(hi.body.pos[i * 3] - p[0], hi.body.pos[i * 3 + 1] - p[1], hi.body.pos[i * 3 + 2] - p[2])
      if (near.length < k || d < near[near.length - 1][0]) {
        near.push([d, i])
        near.sort((a, b) => a[0] - b[0])
        if (near.length > k) near.pop()
      }
    }
    const out = [0, 0, 0]
    let sw = 0
    for (const [d, i] of near) {
      const w = 1 / Math.max(d, 1e-4)
      for (let c = 0; c < 3; c++) out[c] += w * (newPos[i * 3 + c] - hi.body.pos[i * 3 + c])
      sw += w
    }
    return mul(out, 1 / (sw || 1))
  }
  // ---- the shape file: per level of detail, the moved Body vertices and the parts' shifts ----
  const lodShape = (L, isHi) => {
    const n = L.body.pos.length / 3
    let map = null
    if (!isHi) {
      // (Medium's vertices are a subset of High's: matched by position)
      const grid = new Map()
      const q = (x) => Math.round(x * 500)
      for (let i = 0; i < nV; i++) {
        const k = q(hi.body.pos[i * 3]) + "," + q(hi.body.pos[i * 3 + 1]) + "," + q(hi.body.pos[i * 3 + 2])
        if (!grid.has(k)) grid.set(k, [])
        grid.get(k).push(i)
      }
      map = new Int32Array(n).fill(-1)
      for (let i = 0; i < n; i++) {
        const p = [L.body.pos[i * 3], L.body.pos[i * 3 + 1], L.body.pos[i * 3 + 2]]
        let best = -1
        let bd = 0.0015
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++) {
              const l = grid.get(q(p[0]) + dx + "," + (q(p[1]) + dy) + "," + (q(p[2]) + dz))
              if (!l) continue
              for (const j of l) {
                const d = Math.hypot(hi.body.pos[j * 3] - p[0], hi.body.pos[j * 3 + 1] - p[1], hi.body.pos[j * 3 + 2] - p[2])
                if (d < bd) (bd = d), (best = j)
              }
            }
        map[i] = best
      }
    }
    const idx = []
    const dpos = []
    const dnrm = []
    for (let i = 0; i < n; i++) {
      const j = isHi ? i : map[i]
      if (j < 0) continue
      const d = [newPos[j * 3] - hi.body.pos[j * 3], newPos[j * 3 + 1] - hi.body.pos[j * 3 + 1], newPos[j * 3 + 2] - hi.body.pos[j * 3 + 2]]
      if (len(d) < 2e-5) continue
      idx.push(i)
      for (let k = 0; k < 3; k++) {
        dpos.push(Math.round(Math.max(-32767, Math.min(32767, d[k] * 1e5))))
        dnrm.push(Math.round(newNrm[j * 3 + k] * 127))
      }
    }
    const lash = []
    for (let i = 0; i < L.brows.pos.length / 3; i++) {
      const d = followFace([L.brows.pos[i * 3], L.brows.pos[i * 3 + 1], L.brows.pos[i * 3 + 2]])
      for (let k = 0; k < 3; k++) lash.push(Math.round(d[k] * 1e5))
    }
    // (the teeth: each vertex like the lips and mouth around it, a few more neighbors: smooth)
    // (the teeth: rigid, with the mouth: across and up like the mouth's corners and lips, in
    // depth like the lips alone, so they stay as far behind the lips as they were)
    const lipZ = (newPos[ourLm.vtx.lipUp * 3 + 2] - hi.body.pos[ourLm.vtx.lipUp * 3 + 2] + newPos[ourLm.vtx.lipLo * 3 + 2] - hi.body.pos[ourLm.vtx.lipLo * 3 + 2]) / 2
    const tShift = [teethShift[0], teethShift[1], Math.min(teethShift[2], lipZ)]
    const tooth = []
    for (let i = 0; i < L.teeth.pos.length / 3; i++) for (let k = 0; k < 3; k++) tooth.push(Math.round(tShift[k] * 1e5))
    return { idx, dpos, dnrm, lash, brows: L.brows.pos.length / 3, tooth, teeth: L.teeth.pos.length / 3 }
  }
  const shapes = { hi: lodShape(hi, true), med: lodShape(B.med, false) }
  // file: u32 header length, a JSON header, then the arrays (each 4-byte aligned)
  const blobs = []
  const header = { v: 1, unit: 1e-5, eyes: { l: eyeShift.l, r: eyeShift.r }, teeth: teethShift, lods: {} }
  let off = 0
  const put = (arr, Type) => {
    const a = Type.from(arr)
    const pad = (4 - (a.byteLength % 4)) % 4
    blobs.push(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.alloc(pad))
    const at = off
    off += a.byteLength + pad
    return at
  }
  for (const [lod, sh] of Object.entries(shapes)) header.lods[lod] = { count: sh.idx.length, brows: sh.brows, teeth: sh.teeth, idx: put(sh.idx, Uint16Array), pos: put(sh.dpos, Int16Array), nrm: put(sh.dnrm, Int8Array), lash: put(sh.lash, Int16Array), tooth: put(sh.tooth, Int16Array) }
  const hj = Buffer.from(JSON.stringify(header))
  const hpad = Buffer.alloc((4 - ((hj.length + 4) % 4)) % 4, 32)
  const hlen = Buffer.alloc(4)
  hlen.writeUInt32LE(hj.length + hpad.length)
  const name = `pl-face-${face.id}`
  fs.writeFileSync(path.join(outDir, `${name}.bin`), Buffer.concat([hlen, hj, hpad, ...blobs]))
  console.log(face.id, "shape: hi", shapes.hi.idx.length, "med", shapes.med.idx.length, "vertices; eyes", (len(eyeShift.l) * 1000).toFixed(1), "mm; teeth", (len(teethShift) * 1000).toFixed(1), "mm")

  // ---- bake: our atlas, the photographed head where it is ----
  const famFile = (fam) => path.join(mhAssets, { light: "young_lightskinned_%_diffuse.png", mid: "young_lightskinned_%_diffuse2.png", dark: "young_darkskinned_%_diffuse.png" }[fam].replace("%", face.body === "m" ? "male" : "female"))
  const N = 2048
  // the photo's skin tone: sampled at our cheeks and neck front, through the fitted surface
  const probe = []
  for (let i = 0; i < nV; i++) {
    const y = newPos[i * 3 + 1] - ourLm.mid[1]
    const x = Math.abs(newPos[i * 3])
    const z = newPos[i * 3 + 2] - ourLm.mid[2]
    const cheek = y > -0.07 && y < -0.035 && x > 0.03 && x < 0.05 && z > -0.03
    const neck = y > -0.2 && y < -0.15 && x < 0.03 && z > -0.04
    if (cheek || neck) probe.push(i)
  }
  const sampleSrc = (p, img = src.color) => {
    const h = surf.query(p, 0.04)
    if (!h) return null
    const a = src.head.index[h.t * 3]
    const b = src.head.index[h.t * 3 + 1]
    const c = src.head.index[h.t * 3 + 2]
    const u = src.head.uv[a * 2] * h.w[0] + src.head.uv[b * 2] * h.w[1] + src.head.uv[c * 2] * h.w[2]
    const v = src.head.uv[a * 2 + 1] * h.w[0] + src.head.uv[b * 2 + 1] * h.w[1] + src.head.uv[c * 2 + 1] * h.w[2]
    return { rgb: sampleImage(img, u, v), u, v, h }
  }
  const photoMean = [0, 0, 0]
  let pn = 0
  for (const i of probe) {
    const s = sampleSrc([newPos[i * 3], newPos[i * 3 + 1], newPos[i * 3 + 2]])
    if (!s) continue
    for (let k = 0; k < 3; k++) photoMean[k] += toLin(s.rgb[k])
    pn++
  }
  for (let k = 0; k < 3; k++) photoMean[k] /= pn || 1
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  // the closest skin family by lightness, and that texture's own tone at the same places
  let best = null
  for (const fam of ["light", "mid", "dark"]) {
    const img = await readImage(famFile(fam), N)
    const m = [0, 0, 0]
    for (const i of probe) {
      const s = sampleImage(img, hi.body.uv[i * 2], hi.body.uv[i * 2 + 1])
      for (let k = 0; k < 3; k++) m[k] += toLin(s[k]) / probe.length
    }
    const d = Math.abs(Math.log(lum(m) / lum(photoMean)))
    if (!best || d < best.d) best = { fam, img, mean: m, d }
  }
  const gain = [0, 1, 2].map((k) => photoMean[k] / best.mean[k])
  console.log(face.id, "photo skin", photoMean.map((x) => toSrgb(x)).join(","), "family", best.fam, "gain", gain.map((x) => x.toFixed(2)).join(","))
  // the atlas: the family's skin, tone-matched, then the head; the detail map: the photo's normal
  // (RG, in our tangent space) and specular (B) where the photo is, flat and a mid specular elsewhere
  const out = Buffer.alloc(N * N * 3)
  for (let i = 0; i < N * N; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = toSrgb(toLin(best.img.data[i * 3 + k]) * gain[k])
  const det = Buffer.alloc(N * N * 3)
  // the hair painted on the photo's scalp (R) and face (G): where it differs from the skin in
  // lightness or hue, inside the regions hair grows; the game recolors it to the look's hair
  // color, or (bald, shaved) covers it with skin
  const hairM = new Uint8Array(N * N * 3)
  const skinLum = 0.2126 * photoMean[0] + 0.7152 * photoMean[1] + 0.0722 * photoMean[2]
  const skinChroma = photoMean.map((x) => x / skinLum)
  const hairSum = [0, 0, 0, 0]
  let beardArea = 0
  let faceArea = 0
  for (let i = 0; i < N * N; i++) (det[i * 3] = 128), (det[i * 3 + 1] = 128), (det[i * 3 + 2] = 70)
  const tris = []
  for (let t = 0; t < hi.body.index.length; t += 3) tris.push([hi.body.index[t], hi.body.index[t + 1], hi.body.index[t + 2]])
  const uvN = hi.body.uv
  // tangent frames per triangle: ours (fitted positions, our UVs) and the source's
  const P3o = (i) => [newPos[i * 3], newPos[i * 3 + 1], newPos[i * 3 + 2]]
  const T2o = (i) => [uvN[i * 2], uvN[i * 2 + 1]]
  const ourTB = tris.map(([a, b, c]) => triTangents(P3o(a), P3o(b), P3o(c), T2o(a), T2o(b), T2o(c)))
  const srcTB = []
  const P3s = (i) => [src.head.pos[i * 3], src.head.pos[i * 3 + 1], src.head.pos[i * 3 + 2]]
  const T2s = (i) => [src.head.uv[i * 2], src.head.uv[i * 2 + 1]]
  for (let t = 0; t < src.head.index.length / 3; t++) {
    const [a, b, c] = [src.head.index[t * 3], src.head.index[t * 3 + 1], src.head.index[t * 3 + 2]]
    srcTB[t] = triTangents(P3s(a), P3s(b), P3s(c), T2s(a), T2s(b), T2s(c))
  }
  const frame = (N0, tb) => {
    const Nn = norm(N0)
    const T = norm(sub(tb.T, mul(Nn, dot(tb.T, Nn))))
    const c = require3cross(Nn, T)
    const B = mul(norm(c), Math.sign(dot(c, tb.B)) || 1)
    return { N: Nn, T, B }
  }
  const ourMid = ourLm.mid
  // inside the mouth (behind the lips' front, between the corners): keeps our own texture (the
  // photo has no mouth inside; its closest points there would be teeth or lip edges)
  const cornerX = Math.abs(hi.body.pos[ourLm.vtx.mouthL * 3])
  const lipFront = Math.min(hi.body.pos[ourLm.vtx.lipUp * 3 + 2], hi.body.pos[ourLm.vtx.lipLo * 3 + 2])
  const inMouth = new Uint8Array(nV)
  for (let i = 0; i < nV; i++) {
    const q = [hi.body.pos[i * 3], hi.body.pos[i * 3 + 1], hi.body.pos[i * 3 + 2]]
    inMouth[i] = Math.abs(q[0]) < cornerX * 0.92 && Math.abs(q[1] - ourLm.seam) < 0.013 && q[2] < lipFront - 0.0035 ? 1 : 0
  }
  let baked = 0
  rasterUV(N, tris, uvN, (ti, b0, b1, b2, x, y) => {
    const [a, b, c] = tris[ti]
    if (inMouth[a] && inMouth[b] && inMouth[c]) return
    const p = [0, 1, 2].map((k) => newPos[a * 3 + k] * b0 + newPos[b * 3 + k] * b1 + newPos[c * 3 + k] * b2)
    const w = photoWeight(p, ourMid)
    if (w <= 0) return
    // (the photo's relief is kept on the face, a third of it on the scalp: there it's the
    // painted hair's, and its islands' edges show as lines)
    const wd = w * (1 - 0.65 * Math.max(0, Math.min(1, (p[1] - ourMid[1] - 0.05) / 0.03)))
    const s = sampleSrc(p)
    if (!s) return
    const o = (y * N + x) * 3
    for (let k = 0; k < 3; k++) out[o + k] = toSrgb(toLin(s.rgb[k]) * w + toLin(out[o + k]) * (1 - w))
    {
      const c = s.rgb.map(toLin)
      const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] + 1e-5
      const dl = Math.abs(Math.log(l / skinLum))
      const dc = Math.hypot(c[0] / l - skinChroma[0], c[1] / l - skinChroma[1], c[2] / l - skinChroma[2])
      const hairness = Math.max(Math.min(1, Math.max(0, (dl - 0.3) / 0.4)), Math.min(1, Math.max(0, (dc - 0.12) / 0.18)))
      const y = p[1] - ourMid[1]
      const z = p[2] - ourMid[2]
      // (the scalp: above the forehead, or behind the face above the ears' bottoms)
      const scalp = Math.max(Math.min(1, Math.max(0, (y - 0.045) / 0.02)), z < -0.065 && y > -0.04 ? 1 : 0)
      // (a beard: below the nose, in front, above the neck's middle)
      const face = y < -0.035 && y > -0.17 && z > -0.075 ? 1 : 0
      const r = hairness * scalp * w
      const g = hairness * face * (1 - scalp) * w
      hairM[o] = Math.round(255 * r)
      hairM[o + 1] = Math.round(255 * g)
      if (r > 0.6) for (let k = 0; k < 3; k++) (hairSum[k] += c[k]), k === 2 && hairSum[3]++
      if (face) (faceArea++, (beardArea += g))
    }
    // the photo's normal: its tangent-space value -> the source's object space -> our tangent space
    const tbS = srcTB[s.h.t]
    const tbO = ourTB[ti]
    if (src.normal && src.head.nrm && tbS && tbO) {
      const I = [src.head.index[s.h.t * 3], src.head.index[s.h.t * 3 + 1], src.head.index[s.h.t * 3 + 2]]
      const nS = [0, 1, 2].map((k) => src.head.nrm[I[0] * 3 + k] * s.h.w[0] + src.head.nrm[I[1] * 3 + k] * s.h.w[1] + src.head.nrm[I[2] * 3 + k] * s.h.w[2])
      const fS = frame(nS, tbS)
      const tn = sampleImage(src.normal, s.u, s.v).map((x) => x / 127.5 - 1)
      // (FLIP_G: a normal map authored with green up in v; glTF's v runs down)
      const g = process.env.FLIP_G === "0" ? tn[1] : -tn[1]
      const nObj = norm(add(add(mul(fS.T, tn[0]), mul(fS.B, g)), mul(fS.N, tn[2])))
      const nO = [0, 1, 2].map((k) => newNrm[a * 3 + k] * b0 + newNrm[b * 3 + k] * b1 + newNrm[c * 3 + k] * b2)
      const fO = frame(nO, tbO)
      det[o] = Math.round(Math.max(0, Math.min(255, 128 + 127 * dot(nObj, fO.T) * wd)))
      // (glTF convention: green is +Y "up", against v)
      det[o + 1] = Math.round(Math.max(0, Math.min(255, 128 - 127 * dot(nObj, fO.B) * wd)))
    }
    if (src.spec) det[o + 2] = Math.round(sampleImage(src.spec, s.u, s.v)[0] * w + 70 * (1 - w))
    baked++
  })
  console.log(face.id, "baked texels", baked)
  // (every island grown a few texels past its edge: filtering at a UV seam never reaches the
  // background, a skin-colored line across the scalp or under the chin)
  {
    const covered = new Uint8Array(N * N)
    rasterUV(N, tris, uvN, (ti, b0, b1, b2, x, y) => (covered[y * N + x] = 1))
    grow(out, Uint8Array.from(covered), N, 3, 8)
    grow(det, covered, N, 3, 8)
  }

  // ---- the eye: the photo's iris on our eyeball (by direction from each eye's center) ----
  const eyeImg = await (async () => {
    const E = hi.eyes
    const tex = 256
    const img = Buffer.alloc(tex * tex * 3)
    const etris = []
    for (let t = 0; t < E.index.length; t += 3) if (E.pos[E.index[t] * 3] > 0) etris.push([E.index[t], E.index[t + 1], E.index[t + 2]])
    const cO = ourLm.pts.eyeL
    // (by angle: a point's angle off the eye's forward axis and its direction round it; the
    // source's eye UVs fitted as a linear map of those, so the iris keeps its real size whatever
    // each mesh's eyeball radius)
    const eyeVerts = new Set()
    for (const t of src.eyeTris) for (let k = 0; k < 3; k++) if (src.head.pos[src.head.index[t * 3 + k] * 3] > 0) eyeVerts.add(src.head.index[t * 3 + k])
    const polar = (d) => {
      const n = norm(d)
      const th = Math.acos(Math.max(-1, Math.min(1, n[2])))
      const ph = Math.atan2(n[1], n[0])
      return [th * Math.cos(ph), th * Math.sin(ph)]
    }
    // (the source eyeball's own center: a sphere through its vertices)
    const sph = fitSphere([...eyeVerts].map((v) => P3s(v)))
    // the pupil: the front-most eye vertex's UV
    let front = -1
    for (const v of eyeVerts) if (front < 0 || src.head.pos[v * 3 + 2] > src.head.pos[front * 3 + 2]) front = v
    // (a shallow cap fits no sphere well: then an average eyeball, 12 mm behind the pupil)
    const sane = sph.radius > 0.009 && sph.radius < 0.016
    const cS = sane ? sph.center : sub(P3s(front), [0, 0, 0.012])
    let zmin = Infinity
    for (const v of eyeVerts) zmin = Math.min(zmin, src.head.pos[v * 3 + 2])
    console.log(face.id, "eye verts", eyeVerts.size, "depth", ((src.head.pos[front * 3 + 2] - zmin) * 1000).toFixed(1), "mm, sphere", (sph.radius * 1000).toFixed(1), sane ? "used" : "not used")
    const c0 = [src.head.uv[front * 2], src.head.uv[front * 2 + 1]]
    // least squares: uv - c0 = A [px, py]
    let sxx = 0, sxy = 0, syy = 0, sux = 0, suy = 0, svx = 0, svy = 0
    for (const v of eyeVerts) {
      const [px, py] = polar(sub(P3s(v), cS))
      if (Math.hypot(px, py) > 0.9) continue
      const du = src.head.uv[v * 2] - c0[0]
      const dv = src.head.uv[v * 2 + 1] - c0[1]
      sxx += px * px; sxy += px * py; syy += py * py
      sux += du * px; suy += du * py; svx += dv * px; svy += dv * py
    }
    const detA = sxx * syy - sxy * sxy
    const A = [[(sux * syy - suy * sxy) / detA, (suy * sxx - sux * sxy) / detA], [(svx * syy - svy * sxy) / detA, (svy * sxx - svx * sxy) / detA]]
    const mask = new Uint8Array(tex * tex)
    rasterUV(tex, etris, E.uv, (ti, b0, b1, b2, x, y) => {
      const [a, b, c] = etris[ti]
      const p = [0, 1, 2].map((k) => E.pos[a * 3 + k] * b0 + E.pos[b * 3 + k] * b1 + E.pos[c * 3 + k] * b2)
      const [px, py] = polar(sub(p, cO))
      const rgb = sampleImage(src.color, c0[0] + A[0][0] * px + A[0][1] * py, c0[1] + A[1][0] * px + A[1][1] * py)
      for (let k = 0; k < 3; k++) img[(y * tex + x) * 3 + k] = Math.round(rgb[k])
      mask[y * tex + x] = 1
    })
    grow(img, mask, tex, 3, 8)
    console.log(face.id, "eye sphere r", (sph.radius * 1000).toFixed(1), "mm, map", A.flat().map((x) => x.toFixed(3)).join(","), "texels", mask.reduce((a, b) => a + b, 0))
    return { img, tex }
  })()

  const debug = process.env.FACE_DEBUG
  if (debug) {
    await sharp(out, { raw: { width: N, height: N, channels: 3 } }).jpeg({ quality: 92 }).toFile(path.join(debug, `${name}-hi.jpg`))
    await sharp(det, { raw: { width: N, height: N, channels: 3 } }).png().toFile(path.join(debug, `${name}-det.png`))
  }
  const files = {}
  const write = (f, buf) => {
    fs.writeFileSync(path.join(outDir, f), buf)
    files[f] = buf.length
    return f
  }
  const raw = (b, n = N) => sharp(b, { raw: { width: n, height: n, channels: 3 } })
  write(`${name}.jpg`, await raw(out).resize(1024, 1024).jpeg({ quality: 88, mozjpeg: true }).toBuffer())
  write(`${name}-n.jpg`, await raw(det).resize(1024, 1024).jpeg({ quality: 92, mozjpeg: true }).toBuffer())
  write(`${name}-eye.jpg`, await raw(eyeImg.img, eyeImg.tex).jpeg({ quality: 90 }).toBuffer())
  // (the hair mask, soft: 512 is plenty for where hair is)
  write(`${name}-hair.jpg`, await raw(Buffer.from(hairM)).resize(512, 512).blur(1.2).jpeg({ quality: 88 }).toBuffer())
  const hairTone = hairSum[3] ? "#" + [0, 1, 2].map((k) => toSrgb(hairSum[k] / hairSum[3]).toString(16).padStart(2, "0")).join("") : null
  console.log(face.id, "hair tone", hairTone, "beard", (beardArea / (faceArea || 1)).toFixed(2))
  if (process.env.FACE_KTX !== "0") {
    const png = await raw(out).png().toBuffer()
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
    write(`${name}-hi.ktx2`, Buffer.from(ktx))
  }
  files[`${name}.bin`] = fs.statSync(path.join(outDir, `${name}.bin`)).size
  console.log(face.id, "done in", ((Date.now() - t0) / 1000).toFixed(1), "s", JSON.stringify(files))
  manifest.faces[face.id] = { body: face.body, src: face.src, tone: "#" + photoMean.map((x) => toSrgb(x).toString(16).padStart(2, "0")).join(""), family: best.fam, med: `${name}.jpg`, hi: files[`${name}-hi.ktx2`] ? `${name}-hi.ktx2` : null, detail: `${name}-n.jpg`, eye: `${name}-eye.jpg`, hair: `${name}-hair.jpg`, hairTone, beard: +(beardArea / (faceArea || 1)).toFixed(3), shape: `${name}.bin`, files }
}
fs.writeFileSync(path.join(outDir, "faces.json"), JSON.stringify(manifest, null, 1))
// the Locker Room's list (the app's own code, beside this folder): ids, bodies, natural tones
{
  const order = FACES.map((f) => f.id).filter((id) => manifest.faces[id])
  const list = order.map((id) => {
    const f = manifest.faces[id]
    return `  { id: ${JSON.stringify(id)}, body: ${JSON.stringify(f.body)}, tone: ${JSON.stringify(f.tone)}, hairTone: ${JSON.stringify(f.hairTone || null)}, beard: ${f.beard || 0} },`
  })
  const file = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "faceList.js")
  fs.writeFileSync(file, `// Players v3: the photographed faces (written by tools/build-faces.mjs from faces.json; don't edit\n// by hand). tone: the photo's skin, hairTone: its painted hair, beard: how much of the lower face\n// is facial hair (0-1). Sources and license: CREDITS.md (Microsoft Rocketbox, MIT).\nexport const FACE_LIST = [\n${list.join("\n")}\n]\n`)
  console.log("faceList.js:", order.length, "faces")
}

function require3cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
