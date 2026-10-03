// Builds Pickleball 98's athlete assets (client/public/assets/pickleball/) from Quaternius'
// CC0 packs (see ../CREDITS.md). Not part of the app; run by hand when the assets change:
//
//   1. Download "Universal Base Characters" (Standard) and "Universal Animation Library"
//      (Standard) from quaternius.itch.io and unzip them.
//   2. In any scratch folder: npm i @gltf-transform/core @gltf-transform/extensions
//      @gltf-transform/functions meshoptimizer sharp
//   3. TOOLS=<that folder> node build-athletes.mjs <Universal Base Characters[Standard] dir>
//      <UAL1_Standard.glb> <out dir>
//
// Output:
//   athlete-m.glb, athlete-f.glb  the body (skinned, 65 bones), eyes and eyebrows, textures
//                                 shrunk (skin 1024 JPEG, normals 512), meshopt-compressed
//   hair.glb                      every hairstyle and the beard as plain meshes in the Head
//                                 bone's own space (they're rigid on the head), gray textures
//                                 tinted at run time
//   moves.json                    a few animation clips (body bones only) sampled at 30 fps,
//                                 quaternions packed as int16, plus the clips' rest pose

import { createRequire } from "module"
import { pathToFileURL } from "url"
import fs from "fs"
import path from "path"

const req = createRequire(path.join(process.env.TOOLS || ".", "package.json"))
const load = (name) => import(pathToFileURL(req.resolve(name)).href)
const { NodeIO, Document } = await load("@gltf-transform/core")
const { ALL_EXTENSIONS, EXTMeshoptCompression } = await load("@gltf-transform/extensions")
const { prune, dedup, meshopt, reorder, quantize, simplify, weld } = await load("@gltf-transform/functions")
const { MeshoptEncoder, MeshoptSimplifier } = await load("meshoptimizer")
const sharp = (await load("sharp")).default

const [srcDir, ualFile, outDir] = process.argv.slice(2)
if (!srcDir || !ualFile || !outDir) {
  console.log("usage: TOOLS=dir node build-athletes.mjs <UBC dir> <UAL1_Standard.glb> <out dir>")
  process.exit(1)
}
fs.mkdirSync(outDir, { recursive: true })
await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder })

// read a .gltf whose image names don't all match the files next to it
const readLoose = async (file) => {
  const dir = path.dirname(file)
  const json = JSON.parse(fs.readFileSync(file, "utf8"))
  const resources = {}
  for (const im of json.images || []) {
    if (im.uri && !fs.existsSync(path.join(dir, im.uri))) im.uri = im.uri.replace("_png.png", ".png")
    if (fs.existsSync(path.join(dir, im.uri))) resources[im.uri] = fs.readFileSync(path.join(dir, im.uri))
  }
  for (const b of json.buffers) resources[b.uri] = fs.readFileSync(path.join(dir, b.uri))
  return io.readJSON({ json, resources })
}

const jpeg = async (file, size, quality = 85) => sharp(file).resize(size, size).jpeg({ quality, mozjpeg: true }).toBuffer()
const png = async (file, size) => sharp(file).resize(size, size).png({ compressionLevel: 9, palette: false }).toBuffer()

const texDir = path.join(srcDir, "Base Characters", "Textures")
const hairDir = path.join(srcDir, "Hairstyles", "Rigged to Head Bone", "glTF (Godot -Unreal)")
const hairTex = path.join(srcDir, "Hairstyles", "Textures")
const texFile = (dir, name) => {
  const p = path.join(dir, name)
  if (fs.existsSync(p)) return p
  throw new Error("missing texture " + p)
}

// (skinned bodies keep float positions so the run-time clothing math sees real meters)
const compress = async (doc, positions = true) => {
  if (positions) return doc.transform(dedup(), prune(), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: "medium" }))
  await doc.transform(dedup(), prune(), reorder({ encoder: MeshoptEncoder }), quantize({ quantizeNormal: 10, quantizeTexcoord: 12, pattern: /^(NORMAL|TEXCOORD_\d+|JOINTS_0|WEIGHTS_0)$/ }))
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
}

const keepAttributes = (doc, keep) => {
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives())
      for (const s of prim.listSemantics()) if (!keep.includes(s)) prim.setAttribute(s, null)
}

// ---- the two bodies ----
const bodies = [
  { out: "athlete-m.glb", file: "Superhero_Male_FullBody.gltf", skin: "T_Superhero_Male_Ligh.png", normal: "T_Superhero_Male_Normal.png", brows: "T_Hair_1_BaseColor.png" },
  { out: "athlete-f.glb", file: "Superhero_Female_FullBody.gltf", skin: "T_Superhero_Female_Light_BaseColor.png", normal: "T_Superhero_Female_Normal.png", brows: "T_Hair_2_BaseColor.png" },
]
for (const b of bodies) {
  const doc = await readLoose(path.join(srcDir, "Base Characters", "Godot - UE", b.file))
  const root = doc.getRoot()
  for (const a of root.listAnimations()) a.dispose()
  keepAttributes(doc, ["POSITION", "NORMAL", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"])
  for (const node of root.listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const mat = mesh.listPrimitives()[0].getMaterial()
    const name = /eye/i.test(mat.getName()) ? "Eyes" : /hair/i.test(mat.getName()) ? "Brows" : "Body"
    node.setName(name)
    mesh.setName(name)
    mat.setName(name)
    mat.setMetallicRoughnessTexture(null)
    mat.setMetallicFactor(0)
    if (name === "Body") {
      mat.getBaseColorTexture().setImage(await jpeg(texFile(texDir, b.skin), 1024, 86)).setMimeType("image/jpeg").setURI("")
      mat.getNormalTexture().setImage(await jpeg(texFile(texDir, b.normal), 512, 90)).setMimeType("image/jpeg").setURI("")
      mat.setRoughnessFactor(0.62)
    } else if (name === "Eyes") {
      mat.setNormalTexture(null)
      mat.getBaseColorTexture().setImage(await png(texFile(texDir, "T_Eye_Brown.png"), 128)).setMimeType("image/png").setURI("")
    } else {
      mat.setNormalTexture(null)
      mat.getBaseColorTexture().setImage(await jpeg(texFile(texDir, b.brows), 256, 80)).setMimeType("image/jpeg").setURI("")
    }
  }
  for (const t of root.listTextures()) if (!t.getURI()) t.setURI("")
  // about half the body's triangles: plenty at game distance, and four players plus the
  // umpire skin on every frame (UV seams and the face are kept by the error bound)
  await MeshoptSimplifier.ready
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Number(process.env.RATIO || 0.5), error: Number(process.env.ERR || 0.0012), lockBorder: true }))
  await compress(doc, false)
  await io.write(path.join(outDir, b.out), doc)
  console.log(b.out, fs.statSync(path.join(outDir, b.out)).size)
}

// ---- hair: plain meshes in the Head bone's space ----
{
  const out = new Document()
  const buffer = out.createBuffer()
  const scene = out.createScene("hair")
  const mats = {}
  const matFor = async (name, file) => {
    if (mats[name]) return mats[name]
    const tex = out.createTexture(name).setImage(await jpeg(file, 512, 82)).setMimeType("image/jpeg")
    mats[name] = out.createMaterial(name).setBaseColorTexture(tex).setRoughnessFactor(0.7).setMetallicFactor(0)
    return mats[name]
  }
  const files = fs.readdirSync(hairDir).filter((f) => f.endsWith(".gltf") && !/Eyebrows/.test(f))
  for (const f of files) {
    const doc = await readLoose(path.join(hairDir, f))
    const node = doc.getRoot().listNodes().find((n) => n.getMesh() && n.getSkin())
    const skin = node.getSkin()
    const joints = skin.listJoints()
    const head = joints.findIndex((j) => j.getName() === "Head")
    const ibm = skin.getInverseBindMatrices()
    const m = []
    ibm.getElement(head, m)
    const prim = node.getMesh().listPrimitives()[0]
    const P = prim.getAttribute("POSITION")
    const N = prim.getAttribute("NORMAL")
    const T = prim.getAttribute("TEXCOORD_0")
    const pos = new Float32Array(P.getCount() * 3)
    const nrm = new Float32Array(P.getCount() * 3)
    const v = []
    for (let i = 0; i < P.getCount(); i++) {
      P.getElement(i, v)
      pos[i * 3] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]
      pos[i * 3 + 1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]
      pos[i * 3 + 2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]
      N.getElement(i, v)
      const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2]
      const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2]
      const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2]
      const l = Math.hypot(x, y, z) || 1
      nrm[i * 3] = x / l
      nrm[i * 3 + 1] = y / l
      nrm[i * 3 + 2] = z / l
    }
    const texName = prim.getMaterial().getBaseColorTexture()?.getName() || ""
    const which = /Hair_1|_1_/.test(texName) || /Hair_1/.test(prim.getMaterial().getName()) ? "T_Hair_1_BaseColor.png" : "T_Hair_2_BaseColor.png"
    const mat = await matFor(which.replace(".png", ""), path.join(hairTex, which))
    const name = f.replace(".gltf", "")
    const p2 = out
      .createPrimitive()
      .setAttribute("POSITION", out.createAccessor().setType("VEC3").setArray(pos).setBuffer(buffer))
      .setAttribute("NORMAL", out.createAccessor().setType("VEC3").setArray(nrm).setBuffer(buffer))
      .setAttribute("TEXCOORD_0", out.createAccessor().setType("VEC2").setArray(new Float32Array(T.getArray())).setBuffer(buffer))
      .setIndices(out.createAccessor().setType("SCALAR").setArray(new Uint16Array(prim.getIndices().getArray())).setBuffer(buffer))
      .setMaterial(mat)
    scene.addChild(out.createNode(name).setMesh(out.createMesh(name).addPrimitive(p2)))
    console.log("hair", name, P.getCount(), "verts", which)
  }
  await compress(out)
  await io.write(path.join(outDir, "hair.glb"), out)
  console.log("hair.glb", fs.statSync(path.join(outDir, "hair.glb")).size)
}

// ---- moves: a few clips, body bones only, sampled ----
{
  const doc = await io.read(ualFile)
  const root = doc.getRoot()
  const FPS = 30
  const CLIPS = ["Idle_Loop", "Jog_Fwd_Loop", "Sprint_Loop", "Dance_Loop", "Walk_Loop", "Crouch_Idle_Loop"]
  const BONES = ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "Head", "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r", "thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r"]
  const nodes = Object.fromEntries(root.listNodes().map((n) => [n.getName(), n]))
  const rest = Object.fromEntries(BONES.map((b) => [b, nodes[b].getRotation().map((x) => +x.toFixed(5))]))
  const slerp = (a, b, t) => {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
    const s = d < 0 ? -1 : 1
    d *= s
    if (d > 0.9995) {
      const r = a.map((x, i) => x + (s * b[i] - x) * t)
      const l = Math.hypot(...r)
      return r.map((x) => x / l)
    }
    const th = Math.acos(d)
    const k0 = Math.sin((1 - t) * th) / Math.sin(th)
    const k1 = Math.sin(t * th) / Math.sin(th)
    return a.map((x, i) => k0 * x + k1 * s * b[i])
  }
  const out = { fps: FPS, bones: BONES, rest, clips: {} }
  for (const anim of root.listAnimations()) {
    const name = anim.getName()
    if (!CLIPS.includes(name)) continue
    const tracks = {}
    let dur = 0
    for (const ch of anim.listChannels()) {
      if (ch.getTargetPath() !== "rotation") continue
      const bone = ch.getTargetNode().getName()
      if (!BONES.includes(bone)) continue
      const s = ch.getSampler()
      tracks[bone] = { t: s.getInput().getArray(), q: s.getOutput().getArray() }
      dur = Math.max(dur, s.getInput().getMax([])[0])
    }
    const frames = Math.max(1, Math.round(dur * FPS))
    const data = new Int16Array(frames * BONES.length * 4)
    for (let f = 0; f < frames; f++) {
      const time = f / FPS
      BONES.forEach((b, bi) => {
        const tr = tracks[b]
        let q = rest[b]
        if (tr) {
          const { t, q: Q } = tr
          let i = 0
          while (i < t.length - 2 && t[i + 1] < time) i++
          const u = t.length > 1 ? Math.min(1, Math.max(0, (time - t[i]) / (t[i + 1] - t[i] || 1))) : 0
          const a = [Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3]]
          const c = t.length > 1 ? [Q[i * 4 + 4], Q[i * 4 + 5], Q[i * 4 + 6], Q[i * 4 + 7]] : a
          q = slerp(a, c, u)
        }
        for (let k = 0; k < 4; k++) data[(f * BONES.length + bi) * 4 + k] = Math.round(Math.max(-1, Math.min(1, q[k])) * 32767)
      })
    }
    out.clips[name] = { duration: +dur.toFixed(4), frames, data: Buffer.from(data.buffer).toString("base64") }
    console.log("clip", name, dur.toFixed(2), frames)
  }
  fs.writeFileSync(path.join(outDir, "moves.json"), JSON.stringify(out))
  console.log("moves.json", fs.statSync(path.join(outDir, "moves.json")).size)
}
