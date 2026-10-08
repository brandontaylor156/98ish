// Pickleball 98: the skinned athletes. Real character models (MakeHuman bodies, CC0, built by
// tools/build-mh-athletes.mjs: realistic proportions, skin texture, eyes, brows and lashes,
// hairstyles fitted to each body; Quaternius' Universal Base Characters, CC0, if those
// don't load; both on the same humanoid skeleton naming) dressed in kits
// grown from the body (outfit.js), holding a modeled paddle, and posed every frame from the
// joints anim.js works out (retarget.js does the math): the pelvis, spine, neck and head
// turn to the pose's frames; arms and legs are solved with two-bone IK on the model's own
// bones, so the feet stay planted and the paddle face lands exactly on the contact point
// physics computed; fingers curl round the grip; small motion-captured clips (Quaternius'
// Universal Animation Library) breathe and bounce on top.
//
// The arms (since 2026-10-04, docs/pickleball-arms.md): arms.js solves each arm on this
// model's own bones with real joint limits (no stretched or locked elbows; the elbow's direction,
// the paddle's roll and the face behind the palm chosen so the humerus, the forearm's twist and
// the wrist stay in range; the paddle exactly on the ball around contact, the arm first
// elsewhere), the shoulder girdle follows the arm (scapulohumeral rhythm, protraction), twist
// bones share the forearm's twist along it (no candy-wrapper skin), and the fingers take
// per-finger shapes (a relaxed cascade, the grip, cupped, a fist, open).
//
// Athletic since 2026-10-04: muscle-topology bodies with a muscle normal map, wrapped (soft,
// warm) skin light and a rim, faces that blink and react (morph targets), tops that drape, a
// pleated skirt and hair that swing on springs, breathing (CREDITS.md, CLAUDE.md).
//
// Players v2 (2026-10-06, docs/players-v2.md): modeled kits (MakeHuman's CC0 garments fitted
// to each body by tools/players/build-kit.mjs: tee, polo, tank, shorts, briefs, shoes, socks;
// kitmap.js picks them per look, kitGeometry/kitMaterial dress the athlete, the skin under
// them isn't drawn), a skin texture per skin-tone family (KTX2 on High), teeth. Kinds the kits
// don't model are still grown by outfit.js. Bodies are now about 0.9 MB (Medium) and 1.6 MB
// (High) each.
// The assets (about 2.2 MB: mh-m/mh-f/mh-hair.glb and moves.json, in public/assets/pickleball/;
// mh-*-hi.glb only on High;
// the older Quaternius files are about 0.8 MB more, only fetched if those fail) load the first time Pickleball
// opens. Until they're in (or if they fail, or on Low quality) rig.js's simple figures
// stand in; createAthlete has the same interface as rig.js's createFigure.

import * as THREE from "three"
import { faceTargets, stepSweat, faceDetail } from "./face.js"
import { loadHDRI } from "./park/environment.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js"
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { BODY } from "./anim.js"
import { SKIN } from "./looks.js"
import { aimDelta, additiveMove, bendAxis, decodeMoves, frameOf, LAYERS, layerTargets, limitQuat, Q, qaxis, qinv, qmul, qrot, qslerp, solveLimb, stepLayers, clipTime, norm } from "./retarget.js"
import { kitPiecesFor, PIECE_PART } from "./kitmap.js"
import { BUILD_SCALE, buildGarment, buildSkirt, landmarks, prepareBody, radiusProfile, reshapeBody, visibleIndex } from "./outfit.js"
import { loadMotion } from "./mm/runtime.js"
import { parseFaceShape } from "./faceshape.js"
import { hash01 } from "./between.js"
import { ARM_PROBE, FINGER_NAMES, RELAXED_ELBOW, TWIST, armMetrics, armReference, armRig, clavicleFor, fingerPose, gripFrame, solveArm, solvePaddleArm, splitTwistWeights, stepFingers, twistOf } from "./arms.js"

const BASE = "/assets/pickleball/"
// the bodies: MakeHuman's (CC0, realistic proportions: tools/build-mh-athletes.mjs), or the
// older Quaternius ones if those don't load
// (athletic MakeHuman bodies, 2026-10-04: muscle topology, a muscle normal map, facial
// expressions as morph targets; mh-*-hi.glb has every triangle, for High, loaded only then)
const SETS = [
  { id: "mh", m: "mh-m.glb", f: "mh-f.glb", hair: "mh-hair.glb", hi: { m: "mh-m-hi.glb", f: "mh-f-hi.glb" }, headScale: 1.02 },
  { id: "q", m: "athlete-m.glb", f: "athlete-f.glb", hair: "hair.glb", headScale: 1.1 }, // (a slightly bigger head: friendlier, and it reads at TV distance)
]
// (dev, the A/B test of the looks: window.__pbStyle = "toon" loads the stylized bodies,
// built with STYLE=toon, never shipped)
const styled = (file) => (typeof window !== "undefined" && window.__pbStyle === "toon" ? file.replace(".glb", "-toon.glb") : file)

// ---- loading (once) ----
let assets = null
let loading = null
let loadingHi = null
let gltfLoader = null
const loaderOf = () => {
  if (!gltfLoader) {
    gltfLoader = new GLTFLoader()
    gltfLoader.setMeshoptDecoder(MeshoptDecoder)
  }
  return gltfLoader
}
export const athletesReady = () => !!assets
export const loadAthletes = () => {
  // (the motion-matching database comes in alongside, on its own: the athletes don't wait
  // for it, and the procedural footwork carries on until it's in, or if it fails)
  loadMotion().catch(() => {})
  loadFaces() // (players v3: the photo faces' list, small)
  if (loading) return loading
  loading = (async () => {
    const loader = loaderOf()
    const movesP = fetch(BASE + "moves.json").then((r) => {
      if (!r.ok) throw new Error("moves " + r.status)
      return r.json()
    })
    let error = null
    // (tests: window.__pbModels = "q" shows the older bodies, to compare)
    const sets = typeof window !== "undefined" && window.__pbModels === "q" ? SETS.slice(1) : SETS
    for (const set of sets) {
      try {
        const file = set.id === "mh" ? styled : (x) => x
        const [m, f, hair, moves] = await Promise.all([loader.loadAsync(BASE + file(set.m)), loader.loadAsync(BASE + file(set.f)), loader.loadAsync(BASE + (set.id === "mh" && typeof window !== "undefined" && window.__pbStyle === "toon" ? "mh-hair-toon.glb" : set.hair)), movesP])
        const hairs = {}
        hair.scene.traverse((o) => {
          if (o.isMesh) hairs[o.name] = o
        })
        assets = { set: set.id, setInfo: set, m: template(m, set), f: template(f, set), hi: null, hairs, moves: decodeMoves(moves), paddles: new Map() }
        return assets
      } catch (e) {
        error = e
      }
    }
    throw error
  })()
  loading.catch(() => {
    loading = null // a later open can try again
  })
  return loading
}
// the High bodies (every triangle, a 2048 skin): fetched the first time an athlete is made on
// High; until they're in (or if they fail) the Medium bodies stand in, and athletes made
// before swap themselves over (createAthlete)
const hiWaiters = new Set()
const loadHi = () => {
  if (loadingHi || !assets?.setInfo?.hi) return loadingHi
  const set = assets.setInfo
  loadingHi = Promise.all([loaderOf().loadAsync(BASE + styled(set.hi.m)), loaderOf().loadAsync(BASE + styled(set.hi.f))])
    .then(([m, f]) => {
      assets.hi = { m: template(m, set), f: template(f, set) }
      for (const fn of hiWaiters) fn()
      hiWaiters.clear()
    })
    .catch(() => {
      hiWaiters.clear()
    })
  return loadingHi
}

// ---- three <-> retarget.js ----
const toQ = (q) => Q(q.x, q.y, q.z, q.w)
const toV = (v) => ({ x: v.x, y: v.y, z: v.z })
const tq = new THREE.Quaternion()
const tq2 = new THREE.Quaternion()
const tv = new THREE.Vector3()

// ---- a body, ready to clone ----
const template = (gltf, set = SETS[0]) => {
  const scene = gltf.scene
  scene.updateMatrixWorld(true)
  const meshes = {}
  scene.traverse((o) => {
    if (o.isSkinnedMesh) meshes[o.name] = o
  })
  const body = meshes.Body
  addTwistBones(body)
  // players v2: the modeled kit pieces (each its own skinned mesh in the file, on the body's
  // skin), taken out of the scene (an athlete wears a merged few of them: kitGeometry), their
  // twist-bone weights shared out like the body's
  let kit = null
  for (const [name, o] of Object.entries(meshes)) {
    if (!name.startsWith("Kit_")) continue
    if (!kit) kit = { pieces: {}, normal: o.material.normalMap || null, normalScale: o.material.normalScale ? o.material.normalScale.clone() : new THREE.Vector2(1, -1), detail: o.material.aoMap || null }
    kit.pieces[name.slice(4)] = o.geometry
    o.removeFromParent()
  }
  if (kit?.normal) kit.normal.anisotropy = 4
  if (kit?.detail) kit.detail.anisotropy = 4
  const bones = Object.fromEntries(body.skeleton.bones.map((b) => [b.name, b]))
  const rest = {}
  for (const b of body.skeleton.bones) rest[b.name] = { wq: toQ(b.getWorldQuaternion(tq)), wp: toV(b.getWorldPosition(tv)), lp: b.position.clone() }
  // body arrays for the clothes
  const g = body.geometry
  const n = g.attributes.position.count
  const position = new Float32Array(n * 3)
  const skinIndex = new Uint16Array(n * 4)
  const skinWeight = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    position[i * 3] = g.attributes.position.getX(i)
    position[i * 3 + 1] = g.attributes.position.getY(i)
    position[i * 3 + 2] = g.attributes.position.getZ(i)
    for (let k = 0; k < 4; k++) {
      skinIndex[i * 4 + k] = g.attributes.skinIndex.getComponent(i, k)
      skinWeight[i * 4 + k] = g.attributes.skinWeight.getComponent(i, k)
    }
  }
  let soleY = Infinity
  for (let i = 0; i < n; i++) soleY = Math.min(soleY, position[i * 3 + 1])
  const prepared = prepareBody({ position, skinIndex, skinWeight, index: g.index.array, bones: body.skeleton.bones.map((b) => b.name) })
  const joints = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.wp]))
  const marks = landmarks(joints, soleY)
  const d = (a, b) => Math.hypot(joints[a].x - joints[b].x, joints[a].y - joints[b].y, joints[a].z - joints[b].z)
  const leg = d("thigh_l", "calf_l") + d("calf_l", "foot_l")
  const ankleH = joints.foot_l.y - soleY
  const scale = (BODY.thigh + BODY.shin + BODY.ankle) / (leg + ankleH)
  // the head's center and size (for hats and glasses), from the vertices on the Head bone
  const headIdx = body.skeleton.bones.indexOf(bones.Head)
  let top = -Infinity
  let front = -Infinity
  let sx = 0
  let sz = 0
  let cnt = 0
  for (let i = 0; i < n; i++) {
    if (skinIndex[i * 4] !== headIdx || skinWeight[i * 4] < 0.9) continue
    const y = position[i * 3 + 1]
    if (y < joints.Head.y + 0.03) continue
    top = Math.max(top, y)
    front = Math.max(front, position[i * 3 + 2])
    sx += position[i * 3]
    sz += position[i * 3 + 2]
    cnt++
  }
  const head = { top, front, center: { x: sx / cnt, y: top - 0.115, z: sz / cnt } }
  // the head's outline where a band or a cap sits (a little under the crown)
  const bandY = top - 0.05
  const band = { y: bandY, rx: 0, zf: -Infinity, zb: Infinity }
  for (let i = 0; i < n; i++) {
    if (skinIndex[i * 4] !== headIdx || skinWeight[i * 4] < 0.9) continue
    if (Math.abs(position[i * 3 + 1] - bandY) > 0.012) continue
    band.rx = Math.max(band.rx, Math.abs(position[i * 3] - head.center.x))
    band.zf = Math.max(band.zf, position[i * 3 + 2])
    band.zb = Math.min(band.zb, position[i * 3 + 2])
  }
  head.band = { y: bandY, rx: band.rx, rz: (band.zf - band.zb) / 2, cz: (band.zf + band.zb) / 2 }
  const eyes = meshes.Eyes.geometry
  eyes.computeBoundingBox()
  head.eyeY = (eyes.boundingBox.min.y + eyes.boundingBox.max.y) / 2
  head.eyeZ = eyes.boundingBox.max.z
  head.eyeX = eyes.boundingBox.max.x * 0.55
  head.eyeR = (eyes.boundingBox.max.y - eyes.boundingBox.min.y) / 2
  // the materials' textures (shared by every instance)
  const ud = body.material.userData || {}
  // (the glTF normal map: three's loader flips its y; keep that, at the strength wanted)
  const maps = { skin: body.material.map, normal: body.material.normalMap || null, normalScale: body.material.normalScale ? body.material.normalScale.clone().multiplyScalar(0.85) : null, brows: meshes.Brows.material.map, eyes: meshes.Eyes.material, ref: srgb(ud.refSkin || "#a87551"), hueMix: ud.hueMix ?? 0.45, gain: ud.skinGain ?? 0.86 }
  maps.skin.anisotropy = 4
  if (maps.normal) maps.normal.anisotropy = 4
  // the eyes: wet and bright (a little light of their own so the whites never go gray), a
  // clear wet layer over them, the upper lid's shadow across the top of the eyeball
  maps.eyes = eyeMaterial(maps.eyes, head.eyeY, (eyes.boundingBox.max.y - eyes.boundingBox.min.y) / 2)
  // the grip: where the paddle sits in each hand, in that hand bone's own space
  const grip = { l: gripFrame(rest, "l"), r: gripFrame(rest, "r") }
  // which way each finger bone curls (in its own space): toward the palm
  const curl = {}
  const spread = {}
  for (const side of ["l", "r"]) {
    const hand = rest["hand_" + side]
    const finger = norm(sub3(rest["middle_01_" + side].wp, hand.wp))
    let palm = norm(cross3(finger, sub3(rest["thumb_01_" + side].wp, hand.wp)))
    if (side === "r") palm = scale3(palm, -1)
    for (const f of ["index", "middle", "ring", "pinky", "thumb"])
      for (const k of [1, 2, 3]) {
        const name = `${f}_0${k}_${side}`
        const next = `${f}_0${k + 1}${k === 3 ? "_leaf" : ""}_${side}`
        if (!rest[name] || !rest[next]) continue
        const dir = norm(sub3(rest[next].wp, rest[name].wp))
        const target = f === "thumb" ? norm(add3(palm, scale3(finger, 0.6))) : palm
        const axisW = norm(cross3(dir, target))
        curl[name] = qrot(qinv(rest[name].wq), axisW)
        // (the knuckle's sideways turn: round the palm's normal, + toward the little finger)
        if (k === 1 && f !== "thumb") {
          const thumbDir = sub3(rest["thumb_01_" + side].wp, hand.wp)
          const sgn = dot3(cross3(palm, dir), thumbDir) > 0 ? -1 : 1
          spread[name] = qrot(qinv(rest[name].wq), scale3(palm, sgn))
        }
      }
  }
  // the eyes and brows only follow the head: drawn as plain meshes on the Head bone (skinning
  // them cost two more skinned draws per athlete); their rest transform in its space
  const toHead = new THREE.Matrix4().copy(bones.Head.matrixWorld).invert()
  const onHead = { Eyes: toHead.clone().multiply(meshes.Eyes.matrixWorld), Brows: toHead.clone().multiply(meshes.Brows.matrixWorld) }
  // (players v2: the teeth, on the head like the eyes, opening with the face's expressions)
  if (meshes.Teeth) onHead.Teeth = toHead.clone().multiply(meshes.Teeth.matrixWorld)
  if (meshes.Teeth) maps.teeth = new THREE.MeshStandardMaterial({ map: meshes.Teeth.material.map, roughness: 0.32, metalness: 0, color: new THREE.Color(0.86, 0.84, 0.8) })
  // the facial expressions (morph targets on the face and the brows/lashes, if the file has them)
  const faces = { body: body.morphTargetDictionary || null, brows: meshes.Brows.morphTargetDictionary || null }
  const armRef = armReference(rest)
  // the body's _KIT attribute: which kit pieces hide each vertex (a bit each)
  const kitBits = g.attributes._kit ? Uint8Array.from({ length: n }, (_, i) => g.attributes._kit.getX(i)) : null
  const t = { set: set.id, armRef, headScale: ud.headScale ?? set.headScale, scene, rest, prepared, marks, scale, ankleH, head, maps, grip, curl, spread, garments: {}, bones, onHead, joints, variants: {}, faces, kit: kit && kitBits ? kit : null, kitBits, lod: ud.lod || "med" }
  return t
}
// Twist bones (arms.js TWIST): two along each forearm and one at the top of each upper arm,
// added to the body's skeleton with the skin weights shared out along the limb, so a
// pronating forearm turns along its length (like the radius round the ulna) and a rotating
// humerus doesn't wring the shoulder: the skin never twists like a candy wrapper at the elbow
// or the wrist. Each twist bone sits at its limb bone's own joint with no rest turn of its own
// (so its bind matrix is that bone's).
const addTwistBones = (body) => {
  const skel = body.skeleton
  if (skel.bones.some((b) => b.name.includes("_twist_"))) return
  body.updateMatrixWorld(true)
  const bones = skel.bones.slice()
  const inverses = skel.boneInverses.map((m) => m.clone())
  const g = body.geometry
  const n = g.attributes.position.count
  const position = new Float32Array(n * 3)
  const skinIndex = new Uint16Array(n * 4)
  const skinWeight = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    position[i * 3] = g.attributes.position.getX(i)
    position[i * 3 + 1] = g.attributes.position.getY(i)
    position[i * 3 + 2] = g.attributes.position.getZ(i)
    for (let k = 0; k < 4; k++) {
      skinIndex[i * 4 + k] = g.attributes.skinIndex.getComponent(i, k)
      skinWeight[i * 4 + k] = g.attributes.skinWeight.getComponent(i, k)
    }
  }
  const at = (name) => {
    const b = bones.find((x) => x.name === name)
    return b ? toV(b.getWorldPosition(new THREE.Vector3())) : null
  }
  const addBone = (parentName, name) => {
    const pi = bones.findIndex((b) => b.name === parentName)
    if (pi < 0) return -1
    const bone = new THREE.Bone()
    bone.name = name
    bones[pi].add(bone)
    bones.push(bone)
    inverses.push(inverses[pi].clone())
    return bones.length - 1
  }
  let any = false
  for (const s of ["l", "r"]) {
    const E = at("lowerarm_" + s)
    const W = at("hand_" + s)
    const S = at("upperarm_" + s)
    if (!E || !W || !S) continue
    const idx = (name) => bones.findIndex((b) => b.name === name)
    const fa = TWIST.forearm.map(([u, name]) => [u, idx(name + "_" + s) >= 0 ? idx(name + "_" + s) : addBone("lowerarm_" + s, name + "_" + s)])
    const ua = TWIST.upperarm.map(([u, name]) => [u, idx(name + "_" + s) >= 0 ? idx(name + "_" + s) : addBone("upperarm_" + s, name + "_" + s)])
    splitTwistWeights(position, skinIndex, skinWeight, idx("lowerarm_" + s), E, W, fa)
    splitTwistWeights(position, skinIndex, skinWeight, idx("upperarm_" + s), S, E, ua)
    any = true
  }
  if (!any) return
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4))
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4))
  body.bind(new THREE.Skeleton(bones, inverses), body.bindMatrix)
}

const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const add3 =(a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scale3 = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s })
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross3 = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })

// A body in one of the builds (slim, regular, strong: outfit.js reshapeBody): its vertex
// positions, and the garments and trimmed bodies made from it (built once, shared)
const variantOf = (tpl, build, full, face = null) => {
  const bkey = BUILD_SCALE[build] ? build : "regular"
  // (players v3: a photo face moves the front of the head: its own variant of the body)
  const shape = face ? faceShapeNow.get(face.id) : null
  const key = shape ? `${bkey}|${face.id}` : bkey
  if (tpl.variants[key]) return tpl.variants[key]
  let prepared = tpl.prepared
  let position = full.attributes.position
  let normal = null
  if (bkey !== "regular") {
    const moved = reshapeBody(tpl.prepared, tpl.joints, tpl.marks, BUILD_SCALE[bkey])
    prepared = { ...tpl.prepared, position: moved }
    position = new THREE.BufferAttribute(moved, 3)
  }
  if (shape) {
    const L = shape.lods[tpl.lod === "hi" ? "hi" : "med"]
    const moved = Float32Array.from(prepared.position)
    const nsrc = full.attributes.normal
    const nrm = new Float32Array(nsrc.count * 3)
    for (let i = 0; i < nsrc.count; i++) (nrm[i * 3] = nsrc.getX(i)), (nrm[i * 3 + 1] = nsrc.getY(i)), (nrm[i * 3 + 2] = nsrc.getZ(i))
    const u = shape.unit
    for (let k = 0; k < L.count; k++) {
      const i = L.idx[k]
      for (let c = 0; c < 3; c++) {
        moved[i * 3 + c] += L.pos[k * 3 + c] * u
        nrm[i * 3 + c] = L.nrm[k * 3 + c] / 127
      }
    }
    prepared = { ...prepared, position: moved }
    position = new THREE.BufferAttribute(moved, 3)
    normal = new THREE.BufferAttribute(nrm, 3)
  }
  // (a face doesn't change what's worn below the neck: the build's garments and kits are shared)
  const base = shape ? variantOf(tpl, build, full) : null
  if (base) base.kits ||= {}
  tpl.variants[key] = { key, prepared, position, normal, garments: base ? base.garments : bkey === "regular" ? tpl.garments : {}, kits: base ? base.kits : undefined, bodies: {} }
  return tpl.variants[key]
}

// a garment's geometry for a body (built once, shared)
const garmentArrays = (tpl, kind, v) => {
  if (v.garments[kind]) return v.garments[kind]
  let g
  if (kind === "skirt") {
    const names = v.prepared.bones
    g = buildSkirt(tpl.marks, radiusProfile(v.prepared, tpl.marks), { pelvis: names.indexOf("pelvis"), thigh_l: names.indexOf("thigh_l"), thigh_r: names.indexOf("thigh_r") })
  } else g = buildGarment(kind, v.prepared, tpl.marks)
  v.garments[kind] = g
  return g
}

// which garments a look wears (outfitGeometry builds them, all but the shoes, which are their
// own rigid sneakers; the skirt is extra, over its briefs). Older looks (tee/polo/tank,
// shorts/skirt) read the same as before.
const TOP_KINDS = ["tee", "polo", "tank", "rash", "jacket", "crop", "onepiece"]
const BOTTOM_KINDS = ["shorts", "short", "board", "swim", "pants"]
const SOCK_KINDS = { none: null, ankle: "anklesocks", crew: "socks", knee: "kneesocks" }
export const garmentKinds = (look) => {
  const top = TOP_KINDS.includes(look.shirtStyle) ? look.shirtStyle : "tee"
  const out = []
  if (top !== "onepiece") out.push(look.bottom === "skirt" ? "briefs" : BOTTOM_KINDS.includes(look.bottom) ? look.bottom : "shorts")
  out.push(top)
  const sock = Object.hasOwn(SOCK_KINDS, look.sockStyle) ? SOCK_KINDS[look.sockStyle] : "socks"
  if (sock) out.push(sock)
  if (look.gloves) out.push("gloves")
  if (look.wristbands && !look.gloves) out.push("wristbands")
  out.push("shoes")
  return out
}
// the body without the skin its clothes hide: the same vertices, a shorter index (shared by
// everyone dressed the same way)
// players v2: what a look wears, split into the modeled kit pieces the body file has
// (kitmap.js) and the garments still grown from the body (outfit.js)
const wornOf = (tpl, look) => {
  const { pieces, replaced } = kitPiecesFor(look, tpl.kit ? Object.keys(tpl.kit.pieces) : [])
  return { pieces, grown: garmentKinds(look).filter((k) => !replaced.has(k)) }
}
const bodyUnder = (tpl, full, look, v) => {
  const { pieces, grown } = wornOf(tpl, look)
  const key = grown.join("|") + "/" + pieces.join("|")
  if (!v.bodies[key]) {
    const g = new THREE.BufferGeometry()
    for (const [name, attr] of Object.entries(full.attributes)) if (name !== "_kit") g.setAttribute(name, name === "position" ? v.position : name === "normal" && v.normal ? v.normal : attr)
    // (the face's expressions: offsets, the same for every build)
    g.morphAttributes = full.morphAttributes
    g.morphTargetsRelative = full.morphTargetsRelative
    let index = visibleIndex(grown, v.prepared, tpl.marks)
    // (and the skin under the modeled pieces: triangles whose corners they all hide)
    if (pieces.length && tpl.kitBits) {
      let mask = 0
      for (const p of pieces) mask |= KIT_BITS[p] || 0
      const K = tpl.kitBits
      const keep = []
      for (let t = 0; t < index.length; t += 3) if (!(K[index[t]] & mask && K[index[t + 1]] & mask && K[index[t + 2]] & mask)) keep.push(index[t], index[t + 1], index[t + 2])
      index = index instanceof Uint32Array ? Uint32Array.from(keep) : Uint16Array.from(keep)
    }
    g.setIndex(new THREE.BufferAttribute(index, 1))
    v.bodies[key] = g
  }
  return v.bodies[key]
}

// The modeled kit a look wears, as ONE skinned geometry (on the body's skeleton): the pieces'
// vertices in this build's shape, their twist-bone weights shared out like the body's, and a
// part per vertex (kitmap.js PIECE_PART: which of the look's colors it takes). Built once per
// build and set of pieces, shared.
const KIT_BITS = { tee: 1, tank: 2, shorts: 4, briefs: 8, shoes: 16, socks: 32, anklesocks: 64, polo: 128 }
const kitGeometry = (tpl, pieces, v) => {
  const key = pieces.join("|")
  v.kits ||= {}
  if (v.kits[key]) return v.kits[key]
  const geos = pieces.map((p) => tpl.kit.pieces[p])
  let nv = 0
  let ni = 0
  for (const g of geos) {
    nv += g.attributes.position.count
    ni += g.index.count
  }
  const position = new Float32Array(nv * 3)
  const normal = new Float32Array(nv * 3)
  const uv = new Float32Array(nv * 2)
  const skinIndex = new Uint16Array(nv * 4)
  const skinWeight = new Float32Array(nv * 4)
  const part = new Float32Array(nv)
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni)
  let ov = 0
  let oi = 0
  geos.forEach((g, gi) => {
    const A = g.attributes
    const n = A.position.count
    for (let i = 0; i < n; i++) {
      const o = ov + i
      position[o * 3] = A.position.getX(i)
      position[o * 3 + 1] = A.position.getY(i)
      position[o * 3 + 2] = A.position.getZ(i)
      normal[o * 3] = A.normal.getX(i)
      normal[o * 3 + 1] = A.normal.getY(i)
      normal[o * 3 + 2] = A.normal.getZ(i)
      uv[o * 2] = A.uv.getX(i)
      uv[o * 2 + 1] = A.uv.getY(i)
      for (let k = 0; k < 4; k++) {
        skinIndex[o * 4 + k] = A.skinIndex.getComponent(i, k)
        skinWeight[o * 4 + k] = A.skinWeight.getComponent(i, k)
      }
      part[o] = PIECE_PART[pieces[gi]]
    }
    for (let i = 0; i < g.index.count; i++) index[oi + i] = g.index.getX(i) + ov
    ov += n
    oi += g.index.count
  })
  // the twist bones (arms.js TWIST): the sleeves turn along the forearm and upper arm with the skin
  const names = tpl.prepared.bones
  const idx = (name) => names.indexOf(name)
  for (const s of ["l", "r"]) {
    const E = tpl.rest["lowerarm_" + s]?.wp
    const W = tpl.rest["hand_" + s]?.wp
    const S = tpl.rest["upperarm_" + s]?.wp
    if (!E || !W || !S) continue
    const fa = TWIST.forearm.map(([u, name]) => [u, idx(name + "_" + s)])
    const ua = TWIST.upperarm.map(([u, name]) => [u, idx(name + "_" + s)])
    if (fa.some(([, i]) => i < 0) || ua.some(([, i]) => i < 0)) continue
    splitTwistWeights(position, skinIndex, skinWeight, idx("lowerarm_" + s), E, W, fa)
    splitTwistWeights(position, skinIndex, skinWeight, idx("upperarm_" + s), S, E, ua)
  }
  // this build's shape (outfit.js reshapeBody, the same moves as the body's)
  let shaped = position
  if (v.key !== "regular") shaped = reshapeBody(prepareBody({ position, skinIndex, skinWeight, index, bones: names }), tpl.joints, tpl.marks, BUILD_SCALE[v.key])
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(shaped, 3))
  geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3))
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4))
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4))
  geo.setAttribute("pkPart", new THREE.BufferAttribute(part, 1))
  geo.setIndex(new THREE.BufferAttribute(index, 1))
  v.kits[key] = geo
  return geo
}

// Everything a look wears but its hair, as ONE skinned mesh (one draw call): the clothes
// (kit colors, trim and accents baked into vertex colors), the sneakers (on the foot bones)
// and any hat or glasses (on the Head bone). All in the rest pose's world space.
const outfitGeometry = (tpl, look, v) => {
  const bones = tpl.prepared.bones
  const parts = [] // { position, normal, color, skinIndex, skinWeight, index }
  const C = (hex) => srgb(hex)
  const garment = (kind, base, trim, accent = trim) => {
    const g = garmentArrays(tpl, kind, v)
    const n = g.position.length / 3
    const color = new Float32Array(n * 3)
    const b = C(base)
    const t = C(trim)
    const a = C(accent)
    for (let i = 0; i < n; i++) {
      const u = Math.min(1, g.trim[i])
      const v = Math.min(1, g.accent[i])
      color[i * 3] = (b.r + (t.r - b.r) * u) * (1 - v) + a.r * v
      color[i * 3 + 1] = (b.g + (t.g - b.g) * u) * (1 - v) + a.g * v
      color[i * 3 + 2] = (b.b + (t.b - b.b) * u) * (1 - v) + a.b * v
      // (the cloth's folds and creases, baked: outfit.js shade)
      if (g.shade) for (let k = 0; k < 3; k++) color[i * 3 + k] *= g.shade[i]
    }
    parts.push({ position: g.position, normal: g.normal, color, skinIndex: g.skinIndex, skinWeight: g.skinWeight, index: g.index, sway: g.sway || null, mat: null })
  }
  // a rigid piece (a three.js geometry in rest world space) on one bone
  const rigid = (geo, bone, kind = 0) => {
    const src = geo.index ? geo : geo
    const n = src.attributes.position.count
    const skinIndex = new Uint16Array(n * 4)
    const skinWeight = new Float32Array(n * 4)
    const bi = bones.indexOf(bone)
    for (let i = 0; i < n; i++) {
      skinIndex[i * 4] = bi
      skinWeight[i * 4] = 1
    }
    const index = src.index ? src.index.array : Uint32Array.from({ length: n }, (_, i) => i)
    const mat = src.attributes.pkMat ? src.attributes.pkMat.array : new Float32Array(n).fill(kind)
    parts.push({ position: src.attributes.position.array, normal: src.attributes.normal.array, color: src.attributes.color.array, skinIndex, skinWeight, index, mat })
  }
  const shirt = look.shirt || "#1a9fb0"
  const trim = look.trim || "#ffffff"
  const bottom = look.bottomColor || "#23395d"
  const socks = look.socks || "#ffffff"
  // (players v2: what the modeled kit pieces don't cover; the skirt over modeled briefs too)
  const { pieces, grown: kinds } = wornOf(tpl, look)
  if (pieces.includes("briefs")) garment("skirt", bottom, trim)
  for (const kind of kinds) {
    if (kind === "shoes") continue
    if (kind === "briefs") {
      garment("briefs", bottom, bottom)
      garment("skirt", bottom, trim)
    } else if (BOTTOM_KINDS.includes(kind)) garment(kind, bottom, bottom === trim ? shirt : trim)
    else if (TOP_KINDS.includes(kind)) garment(kind, shirt, trim)
    // knee socks: the kit's two colors in bands round the top
    else if (kind === "kneesocks") garment(kind, socks, trim === socks ? shirt : trim, trim === socks ? shirt : trim)
    else if (kind === "gloves") garment(kind, look.gloveColor || "#2b2b2b", look.gloveColor || "#2b2b2b")
    else if (kind === "wristbands") garment(kind, look.wristColor || "#ffffff", look.wristColor || "#ffffff")
    else garment(kind, socks, socks)
  }
  if (!pieces.includes("shoes")) for (const side of ["l", "r"]) rigid(sneakerGeometry(tpl, side, look), "foot_" + side)
  // hats and glasses: flatten the pieces, colors from their materials
  const acc = accessories(look, tpl.head)
  acc.updateMatrixWorld(true)
  acc.traverse((o) => {
    if (!o.isMesh) return
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld)
    const n = g.attributes.position.count
    const color = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) color.set([o.material.color.r, o.material.color.g, o.material.color.b], i * 3)
    g.setAttribute("color", new THREE.BufferAttribute(color, 3))
    rigid(g, "Head", 3)
    o.geometry.dispose()
    g.dispose()
  })
  // merge
  let nv = 0
  let ni = 0
  for (const p of parts) {
    nv += p.position.length / 3
    ni += p.index.length
  }
  const position = new Float32Array(nv * 3)
  const normal = new Float32Array(nv * 3)
  const color = new Float32Array(nv * 3)
  const skinIndex = new Uint16Array(nv * 4)
  const skinWeight = new Float32Array(nv * 4)
  const sway = new Float32Array(nv)
  const matKind = new Float32Array(nv)
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni)
  let ov = 0
  let oi = 0
  let swings = false
  for (const p of parts) {
    const n = p.position.length / 3
    position.set(p.position, ov * 3)
    normal.set(p.normal, ov * 3)
    color.set(p.color, ov * 3)
    skinIndex.set(p.skinIndex, ov * 4)
    skinWeight.set(p.skinWeight, ov * 4)
    if (p.sway) {
      sway.set(p.sway, ov)
      swings = true
    }
    if (p.mat) matKind.set(p.mat, ov)
    for (let i = 0; i < p.index.length; i++) index[oi + i] = p.index[i] + ov
    ov += n
    oi += p.index.length
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(position, 3))
  geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3))
  geo.setAttribute("color", new THREE.BufferAttribute(color, 3))
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4))
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4))
  geo.setAttribute("pkSwayW", new THREE.BufferAttribute(sway, 1))
  geo.setAttribute("pkMat", new THREE.BufferAttribute(matKind, 1))
  geo.setIndex(new THREE.BufferAttribute(index, 1))
  geo.userData.swings = swings
  return geo
}

// ---- materials ----
const srgb = (hex) => new THREE.Color(hex) // (three converts sRGB hex to linear)
// (each body's texture has its own average skin tone: maps.ref, read from the file)
const REF_HAIR = 0.27 // the gray hair textures' average (linear)
const tint = (hex, ref) => {
  const c = srgb(hex)
  if (typeof ref === "number") return c.multiplyScalar(1 / ref)
  return new THREE.Color(c.r / ref.r, c.g / ref.g, c.b / ref.b)
}
// skin: the texture's shading and detail, recolored to the look's skin tone (a plain tint
// would blow the texture's own warm tones up on pale skin)
const skinWarmth = (hex) => {
  const pale = Math.max(0, Math.min(1, (srgb(hex).getHSL({}).l - 0.45) / 0.4))
  return new THREE.Vector3(1.03 + 0.11 * pale, 0.99, 0.95 - 0.1 * pale)
}
// The athletes' lighting (skin, clothes, hair): three's standard material with two changes.
// Wrapped diffuse light: the light reaches a little past the terminator, more in red than in
// blue for skin (light scattered under the skin: soft, warm shadow edges instead of a plastic
// cut-off); and a rim: a faint glow of the surface's own color at the silhouette, so a player
// reads against the court from the broadcast camera. Shadows still darken it all (the wrap
// is applied to the shadowed light).
const LIGHTS_CHUNK = THREE.ShaderChunk.lights_physical_pars_fragment.replace("vec3 irradiance = dotNL * directLight.color;", "vec3 irradiance = dotNL * directLight.color;\n\tvec3 irradianceD = irradiance;\n\t#ifdef PK_WRAP\n\t\tirradianceD = saturate( ( vec3( dot( geometryNormal, directLight.direction ) ) + PK_WRAP ) / ( 1.0 + PK_WRAP ) ) * directLight.color;\n\t#endif").replace("reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution )", "reflectedLight.directDiffuse += irradianceD * BRDF_Lambert( material.diffuseContribution )")
const athleteLight = (sh, { rim = 0.2 } = {}) => {
  sh.fragmentShader = sh.fragmentShader
    .replace("#include <lights_physical_pars_fragment>", LIGHTS_CHUNK)
    .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n\t{\n\t\tfloat pkRim = 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) );\n\t\ttotalEmissiveRadiance += diffuseColor.rgb * ( ${rim.toFixed(3)} * pkRim * pkRim * pkRim );\n\t}`)
}
// The sky to reflect in what's shiny on a player (eyes, paddle, shoe uppers; never skin or
// cloth, whose light is calibrated): the venue kit's normalized outdoor HDRI, loaded once.
const gearEnv = (m, intensity) => {
  m.envMapIntensity = intensity
  loadHDRI(false).then((tex) => {
    if (!tex) return
    m.envMap = tex
    m.needsUpdate = true
  })
  return m
}
// Eyes (faces, 2026-10-06): a clear coat (the wet film's sharp highlight over the eye's own
// softer shine), and the upper lid's shadow over the top of the eyeball (a little under the
// lower lid too), from the eye's height in its own space; the sky reflects faintly in them.
const eyeMaterial = (src, eyeY, eyeR) => {
  const m = new THREE.MeshPhysicalMaterial({ map: src.map, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, emissive: new THREE.Color(1, 1, 1), emissiveMap: src.map, emissiveIntensity: 0.12 })
  const u = { pkEyeY: { value: eyeY }, pkEyeR: { value: Math.max(eyeR, 1e-4) } }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vPkEyeH;").replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvPkEyeH = position.y;")
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float pkEyeY;\nuniform float pkEyeR;\nvarying float vPkEyeH;").replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      {
        float pkLid = smoothstep(pkEyeY + pkEyeR * 0.1, pkEyeY + pkEyeR * 0.85, vPkEyeH);
        float pkLow = 1.0 - smoothstep(pkEyeY - pkEyeR * 0.85, pkEyeY - pkEyeR * 0.35, vPkEyeH);
        float pkShade = 1.0 - 0.5 * pkLid - 0.18 * pkLow;
        diffuseColor.rgb *= pkShade;
        totalEmissiveRadiance *= pkShade * pkShade;
      }`
    )
  }
  m.customProgramCacheKey = () => "pk-eyes"
  return gearEnv(m, 0.35)
}
// Skin detail (faces, 2026-10-06): pores as a fine bump from the body's rest-pose position
// (High only; faded out once they're under a pixel), a little sheen on the lips (found by
// the skin texture's own redness), and sweat: the skin goes wetter (glossier, a touch darker)
// as the athlete works (face.js stepSweat; a uniform per athlete).
const PORE_FRAG = `
	{
		vec3 pq = vPkRest * 1500.0;
		float ph = pkNoise(pq);
		float fade = 1.0 - smoothstep(0.3, 1.0, length(fwidth(pq)));
		float pores = smoothstep(0.62, 0.95, ph);
		vec2 dHdxy = vec2(dFdx(pores), dFdy(pores)) * (-0.0007 * fade);
		vec3 vSigmaX = dFdx(-vViewPosition);
		vec3 vSigmaY = dFdy(-vViewPosition);
		vec3 R1 = cross(vSigmaY, normal);
		vec3 R2 = cross(normal, vSigmaX);
		float fDet = dot(vSigmaX, R1) * faceDirection;
		vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
		normal = normalize(abs(fDet) * normal - vGrad);
	}`
const NOISE_GLSL = `
float pkHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float pkNoise(vec3 x) {
	vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(pkHash(i), pkHash(i + vec3(1, 0, 0)), f.x), mix(pkHash(i + vec3(0, 1, 0)), pkHash(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(pkHash(i + vec3(0, 0, 1)), pkHash(i + vec3(1, 0, 1)), f.x), mix(pkHash(i + vec3(0, 1, 1)), pkHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`
const skinMaterial = (maps, hex, { pores = false, sweat = null, photo = null } = {}) => {
  const ref = maps.ref
  const lum = ref.r * 0.2126 + ref.g * 0.7152 + ref.b * 0.0722
  const m = new THREE.MeshStandardMaterial({ map: photo?.map || maps.skin, normalMap: maps.normal, roughness: 0.55, metalness: 0 })
  if (maps.normal && maps.normalScale) m.normalScale.copy(maps.normalScale)
  m.defines = { PK_WRAP: "vec3(0.5, 0.3, 0.24)" }
  const uniforms = { skinTone: { value: srgb(hex).multiplyScalar(maps.gain) }, refHue: { value: new THREE.Vector3(ref.r / lum, ref.g / lum, ref.b / lum) }, refLum: { value: lum }, hueMix: { value: maps.hueMix }, skinWarm: { value: skinWarmth(hex) }, pkSweat: sweat || { value: 0 }, pkTint: { value: new THREE.Vector3(1, 1, 1) }, pkFaceDetail: { value: photo?.detail || null }, pkHairMask: { value: photo?.hair || null }, pkHairTone: { value: new THREE.Vector3(1, 1, 1) }, pkHairTarget: { value: new THREE.Vector3(1, 1, 1) }, pkBald: { value: 0 }, pkShave: { value: 0 }, pkSkinFill: { value: new THREE.Vector3(1, 1, 1) } }
  if (pores) m.defines.PK_PORES = ""
  // players v3: a photo face's own atlas, drawn as photographed (no recoloring), only tinted
  // gently toward the look's skin tone if that differs from the photo's; its detail map: the
  // photo's normal relief (RG, added to the body's) and its specular (B: oily nose and forehead
  // glossier, matte cheeks)
  if (photo) {
    m.defines.PK_PHOTO = ""
    const t = srgb(photo.tone)
    const s = srgb(hex)
    const lt = t.r * 0.2126 + t.g * 0.7152 + t.b * 0.0722
    const ls = s.r * 0.2126 + s.g * 0.7152 + s.b * 0.0722
    // (the tone's lightness all the way, its hue only halfway: the photo's own variation stays)
    const k = Math.max(0.55, Math.min(1.8, ls / lt))
    uniforms.pkTint.value.set(k * (0.5 + (0.5 * (s.r / ls)) / (t.r / lt)), k * (0.5 + (0.5 * (s.g / ls)) / (t.g / lt)), k * (0.5 + (0.5 * (s.b / ls)) / (t.b / lt)))
    uniforms.refHue.value.set(t.r / lt, t.g / lt, t.b / lt)
    if (photo.detail) m.defines.PK_FACE_DETAIL = ""
    // the photo's painted hair: recolored to the look's hair color (its own shading kept), or
    // under skin for a bald head; facial hair shaved off when the look has no beard
    if (photo.hair && photo.hairTone) {
      m.defines.PK_HAIRMASK = ""
      const ht = srgb(photo.hairTone)
      uniforms.pkHairTone.value.set(ht.r, ht.g, ht.b)
      const want = srgb(photo.hairColor || photo.hairTone)
      uniforms.pkHairTarget.value.set(want.r, want.g, want.b)
      uniforms.pkBald.value = photo.bald ? 1 : 0
      uniforms.pkShave.value = photo.shave ? 1 : 0
      uniforms.pkSkinFill.value.set(t.r, t.g, t.b)
    }
  }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    athleteLight(sh, { rim: 0.22 })
    if (pores) sh.vertexShader = sh.vertexShader.replace("#include <common>", KNIT_VERT[0]).replace("#include <begin_vertex>", KNIT_VERT[1])
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 skinTone;\nuniform vec3 refHue;\nuniform float refLum;\nuniform float hueMix;\nuniform vec3 skinWarm;\nuniform float pkSweat;\nuniform vec3 pkTint;\nuniform sampler2D pkFaceDetail;\nuniform sampler2D pkHairMask;\nuniform vec3 pkHairTone;\nuniform vec3 pkHairTarget;\nuniform float pkBald;\nuniform float pkShave;\nuniform vec3 pkSkinFill;" + (pores ? "\nvarying vec3 vPkRest;" + NOISE_GLSL : ""))
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
      float pkLipK = 0.0;
      {
        float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 hue = diffuseColor.rgb / max(l, 1e-4);
        // the lips: where the texture is redder than the skin around it
        pkLipK = smoothstep(0.05, 0.16, hue.r / refHue.r - hue.g / refHue.g);
        #ifdef PK_PHOTO
        #ifdef PK_HAIRMASK
        {
          vec2 hm = texture2D( pkHairMask, vMapUv ).rg;
          float hl = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          float tl = dot( pkHairTone, vec3( 0.2126, 0.7152, 0.0722 ) );
          // (the strands' own light and dark, in the new color)
          vec3 recol = pkHairTarget * clamp( hl / max( tl, 1e-4 ), 0.2, 3.0 ) / max( pkTint, vec3( 0.05 ) );
          float hAny = max( hm.r, hm.g );
          diffuseColor.rgb = mix( diffuseColor.rgb, recol, smoothstep( 0.15, 0.7, hAny ) );
          // (bald / shaved: skin where the hair was; a little darker where it was thick, as on a scalp)
          float cover = max( pkBald * smoothstep( 0.1, 0.6, hm.r ), pkShave * smoothstep( 0.1, 0.6, hm.g ) * 0.92 );
          diffuseColor.rgb = mix( diffuseColor.rgb, pkSkinFill * ( 0.92 + 0.08 * hl / max( tl, 1e-4 ) ), cover );
        }
        #endif
        diffuseColor.rgb *= pkTint;
        #else
        diffuseColor.rgb = skinTone * (l / refLum) * mix(vec3(1.0), hue / refHue, hueMix);
        // warmth (light under the skin), most for pale skin, which goes gray under cool lights
        diffuseColor.rgb *= skinWarm;
        #endif
        // wet skin reads a touch darker
        diffuseColor.rgb *= 1.0 - 0.07 * pkSweat;
      }`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
	#ifdef PK_FACE_DETAIL
	{
		float pkSpec = texture2D( pkFaceDetail, vNormalMapUv ).b;
		roughnessFactor = mix( 0.68, 0.47, smoothstep( 0.15, 0.6, pkSpec ) );
	}
	#endif
	roughnessFactor = mix(roughnessFactor, 0.34, pkLipK * 0.7);
	roughnessFactor = mix(roughnessFactor, 0.24, pkSweat * 0.85);`
      )
      .replace(
        "mapN.xy *= normalScale;",
        `#ifdef PK_FACE_DETAIL
		mapN.xy += texture2D( pkFaceDetail, vNormalMapUv ).xy * 2.0 - 1.0;
	#endif
	mapN.xy *= normalScale;`
      )
    if (pores) sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>" + PORE_FRAG)
  }
  m.customProgramCacheKey = () => "pk-skin" + (pores ? "-pores" : "") + (photo ? (photo.detail ? "-photo-d" : "-photo") + (photo.hair && photo.hairTone ? "-h" : "") : "")
  // (players v3: the face's High atlas swapped in when it arrives)
  m.userData.setPhoto = (t) => {
    if (!photo || !t?.map) return
    m.map = t.map
    if (t.detail) uniforms.pkFaceDetail.value = t.detail
    m.needsUpdate = true
  }
  // (players v2: the skin family's own texture swapped in when it arrives, with its own average
  // tone, so the recoloring starts from a skin like the look's: darker skin keeps its texture's
  // detail instead of a pale skin's darkened)
  m.userData.setSkin = (map, refHex) => {
    const r = srgb(refHex)
    const l = r.r * 0.2126 + r.g * 0.7152 + r.b * 0.0722
    uniforms.refHue.value.set(r.r / l, r.g / l, r.b / l)
    uniforms.refLum.value = l
    m.map = map
    m.needsUpdate = true
  }
  return m
}
// players v2: the skin tones' families (looks.js SKIN 0-1 light, 2-3 mid, 4-5 dark) and their
// textures (public/assets/pickleball/players.json; the light one is in the body file)
export const skinFamily = (skin) => {
  const i = typeof skin === "number" ? skin : SKIN.indexOf(skin)
  if (i < 0) {
    // (a custom color: by its lightness)
    const l = srgb(typeof skin === "string" ? skin : SKIN[2]).getHSL({}).l
    return l > 0.62 ? "light" : l > 0.4 ? "mid" : "dark"
  }
  return i <= 1 ? "light" : i <= 3 ? "mid" : "dark"
}
let manifestP = null
const playersManifest = () =>
  (manifestP ||= fetch(BASE + "players.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null))
const skinTex = new Map()
// (High: KTX2, Basis ETC1S, transcoded to what this GPU reads: a 2048 skin in about 2.8 MB of
// memory instead of 22; Medium, or if that fails: a 1024 JPEG)
let ktx2 = null
let athleteRenderer = null
export const setAthleteRenderer = (r) => {
  athleteRenderer = r
}
const ktx2Loader = () => {
  if (!ktx2 && athleteRenderer) {
    ktx2 = new KTX2Loader().setTranscoderPath(BASE + "basis/")
    ktx2.detectSupport(athleteRenderer)
  }
  return ktx2
}
const skinTexture = (kind, fam, lod) => {
  const key = `${kind}|${fam}|${lod}`
  if (!skinTex.has(key))
    skinTex.set(
      key,
      playersManifest().then(async (mf) => {
        const S = mf?.bodies?.[kind]?.skins?.[fam]
        if (!S) return null
        const jpeg = (file) =>
          new THREE.TextureLoader().loadAsync(BASE + file).then((map) => {
            map.flipY = false // (glTF's UV convention, like the body's own)
            map.colorSpace = THREE.SRGBColorSpace
            map.anisotropy = 4
            return map
          })
        let map = null
        if (lod === "hi" && S.hi && ktx2Loader()) {
          try {
            map = await ktx2Loader().loadAsync(BASE + S.hi)
            map.colorSpace = THREE.SRGBColorSpace
            map.anisotropy = 4
          } catch {
            map = null
          }
        }
        if (!map && S.med) map = await jpeg(S.med).catch(() => null)
        return map ? { map, ref: S.ref } : null
      })
    )
  return skinTex.get(key)
}
// ---- players v3: photo faces (docs/players-v3.md; tools/build-faces.mjs) ----
// A look's `face` names one of the photographed faces in faces.json (Microsoft Rocketbox's
// avatars, MIT, carried onto our own head topology at build time): the face's shape (the front
// of the head; per level of detail, the moved Body vertices and their normals, the eyes', teeth's
// and lashes' shifts), its skin atlas (the photo baked in: a 1024 JPEG, a 2048 KTX2 on High), a
// detail map (the photo's normal relief and specular) and its own eye. The shape is small and
// comes first (an athlete is built again once it's in, like the High swap); the textures swap
// into the material when they arrive.
let facesInfo = null
let facesP = null
export const loadFaces = () =>
  (facesP ||= fetch(BASE + "faces.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((j) => (facesInfo = j)))
// (the faces for a body, for the Locker Room: [{ id, tone, family }])
export const facesFor = (kind) => Object.entries(facesInfo?.faces || {}).filter(([, f]) => f.body === kind).map(([id, f]) => ({ id, tone: f.tone, family: f.family, name: f.name || id }))
export const faceOf = (look) => {
  const f = look?.face && facesInfo?.faces?.[look.face]
  return f && f.body === bodyOf(look) ? { id: look.face, ...f } : null
}
const faceShapes = new Map() // id -> Promise
const faceShapeNow = new Map() // id -> the parsed shape (once in)
const loadFaceShape = (id) => {
  if (!faceShapes.has(id))
    faceShapes.set(
      id,
      loadFaces().then(async (mf) => {
        const f = mf?.faces?.[id]
        if (!f?.shape) return null
        const r = await fetch(BASE + f.shape)
        if (!r.ok) return null
        const s = parseFaceShape(await r.arrayBuffer())
        faceShapeNow.set(id, s)
        return s
      }).catch(() => null)
    )
  return faceShapes.get(id)
}
const faceTex = new Map()
const faceTexNow = new Map() // "id|lod" -> the textures (once in)
const faceTexture = (id, lod) => {
  const key = `${id}|${lod}`
  if (!faceTex.has(key))
    faceTex.set(
      key,
      loadFaces().then(async (mf) => {
        const f = mf?.faces?.[id]
        if (!f) return null
        const jpeg = (file, color = true) =>
          new THREE.TextureLoader().loadAsync(BASE + file).then((map) => {
            map.flipY = false
            map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
            map.anisotropy = 4
            return map
          })
        let map = null
        if (lod === "hi" && f.hi && ktx2Loader()) {
          try {
            map = await ktx2Loader().loadAsync(BASE + f.hi)
            map.colorSpace = THREE.SRGBColorSpace
            map.anisotropy = 4
          } catch {
            map = null
          }
        }
        const [med, detail, eye, hair] = await Promise.all([map ? null : jpeg(f.med).catch(() => null), f.detail ? jpeg(f.detail, false).catch(() => null) : null, f.eye ? jpeg(f.eye).catch(() => null) : null, f.hair ? jpeg(f.hair, false).catch(() => null) : null])
        const t = map || med ? { map: map || med, detail, eye, hair, tone: f.tone } : null
        if (t) faceTexNow.set(key, t)
        return t
      })
    )
  return faceTex.get(key)
}
// the face's parts for a template (cached per face and level of detail): the eyes, lashes
// (the brows' cards dropped: the photo has its own brows) and teeth moved with the face
const faceParts = (tpl, face, meshes) => {
  tpl.faceParts ||= {}
  if (tpl.faceParts[face.id]) return tpl.faceParts[face.id]
  const shape = faceShapeNow.get(face.id)
  const L = shape.lods[tpl.lod === "hi" ? "hi" : "med"]
  const shifted = (geo, fn) => {
    const g = geo.clone()
    const p = g.attributes.position
    const out = new Float32Array(p.count * 3)
    for (let i = 0; i < p.count; i++) {
      const d = fn(i, p.getX(i))
      out[i * 3] = p.getX(i) + d[0]
      out[i * 3 + 1] = p.getY(i) + d[1]
      out[i * 3 + 2] = p.getZ(i) + d[2]
    }
    g.setAttribute("position", new THREE.BufferAttribute(out, 3))
    g.morphAttributes = geo.morphAttributes
    g.morphTargetsRelative = geo.morphTargetsRelative
    g.computeBoundingSphere()
    return g
  }
  const eyes = shifted(meshes.Eyes.geometry, (i, x) => (x > 0 ? shape.eyes.l : shape.eyes.r))
  const u = shape.unit
  const brows = shifted(meshes.Brows.geometry, (i) => (L.lash && i < L.brows ? [L.lash[i * 3] * u, L.lash[i * 3 + 1] * u, L.lash[i * 3 + 2] * u] : [0, 0, 0]))
  // (the lashes only: the cards on the right half of the brows' atlas)
  const uv = brows.attributes.uv
  const idx = brows.index.array
  const keep = []
  for (let t = 0; t < idx.length; t += 3) if (uv.getX(idx[t]) + uv.getX(idx[t + 1]) + uv.getX(idx[t + 2]) > 1.5) keep.push(idx[t], idx[t + 1], idx[t + 2])
  brows.setIndex(keep)
  const teeth = meshes.Teeth ? shifted(meshes.Teeth.geometry, (i) => (L.tooth && i < L.teeth ? [L.tooth[i * 3] * u, L.tooth[i * 3 + 1] * u, L.tooth[i * 3 + 2] * u] : shape.teeth)) : null
  return (tpl.faceParts[face.id] = { eyes, brows, teeth, eyeMat: null })
}

// a sole that shows against the shoe: off-white under white shoes, white under the rest
const soleFor = (hex) => (srgb(hex).getHSL({}).l > 0.85 ? "#d8d2c4" : "#f4f4f2")

// the outfit (clothes, sneakers, hats): colors are per vertex, so one material for everyone
// materials made once per look detail and shared
const sharedMats = new Map()
const shared = (key, make) => {
  if (!sharedMats.has(key)) sharedMats.set(key, make())
  return sharedMats.get(key)
}
// Clothes and hair: the athletes' lighting (softly wrapped, a rim), and, for what swings (a
// skirt's hem, a ponytail, long hair), a sway: the vertex moves by the athlete's own spring
// offset (uniform pkSway, in the mesh's space) times its weight (attribute pkSwayW: 0 at the
// waistband or the scalp, 1 at the hem or the tips), plus a flare out from a center (pkFlare:
// xyz the center, w how far). Materials with a sway are one per athlete (their own uniforms);
// they share the shader program.
const swayUniforms = () => ({ pkSway: { value: new THREE.Vector3() }, pkFlare: { value: new THREE.Vector4(0, 0, 0, 0) } }) // (w 0: a Vector4 starts with w = 1)
// Fabric you can see (2026-10-06): clothes get a knit's relief, worked out in the shader from
// the garment's own rest-pose position (so the weave rides with the body instead of swimming
// over it), bent into the lighting normal with screen-space derivatives (three's bump-map
// math, inlined), fading out as the stitches get smaller than a pixel (no shimmer at the
// broadcast camera). A soft sheen at grazing angles reads as cloth rather than plastic.
const KNIT_VERT = ["#include <common>\nvarying vec3 vPkRest;", "#include <begin_vertex>\n\tvPkRest = position;"]
const KNIT_FRAG = `
	{
		// a jersey knit: rows of little V's (about 2.5 mm), with a slower thread-to-thread wobble
		vec3 q = vPkRest * vec3(260.0, 400.0, 260.0);
		float across = q.x + q.z;
		float v = abs(fract(q.y + abs(fract(across) - 0.5)) - 0.5);
		float h = v * 2.0 + 0.25 * sin(across * 0.37 + q.y * 0.21);
		if (vPkMat > 2.5) { h = 0.0; v = 0.5; }
		else if (vPkMat > 1.5) {
			// a sole: tread grooves round it (every 4 mm), a smooth rubber
			float g = fract(vPkRest.y * 250.0);
			h = smoothstep(0.0, 0.2, g) * (1.0 - smoothstep(0.55, 0.75, g)) * 1.6;
			v = 0.5;
		} else if (vPkMat > 0.5) {
			// an engineered mesh upper: rows of little holes (about 3 mm)
			vec2 m2 = vec2(across * 0.85, q.y * 0.55);
			vec2 cell = fract(m2 + vec2(0.5 * step(0.5, fract(m2.y * 0.5)), 0.0)) - 0.5;
			h = smoothstep(0.18, 0.3, length(cell)) * 1.4;
			v = 0.25 + 0.25 * h;
		}
		// (players v2: gone well before a stitch shrinks to a pixel: at 0.35-1.2 the weave beat
		// against the pixel grid, a moire over every grown garment)
		float fade = 1.0 - smoothstep(0.1, 0.4, length(fwidth(q.xy)));
		// soft folds and wrinkles (a few cm across, more across the body than down it): what
		// reads as cloth from the broadcast camera, where the knit itself is under a pixel
		vec3 w = vPkRest * vec3(21.0, 13.0, 21.0);
		float folds = sin(w.x * 1.7 + sin(w.y * 1.3) * 1.9) * sin(w.y * 2.3 + w.z * 1.1) + 0.5 * sin(w.z * 3.1 - w.y * 0.7 + sin(w.x * 2.2));
		vec2 dHdxy = vec2(dFdx(h), dFdy(h)) * (0.0016 * fade) + vec2(dFdx(folds), dFdy(folds)) * 0.009; // (players v2: half: on a white skirt the old strength read as blotches)
		vec3 vSigmaX = dFdx(-vViewPosition);
		vec3 vSigmaY = dFdy(-vViewPosition);
		vec3 R1 = cross(vSigmaY, normal);
		vec3 R2 = cross(normal, vSigmaX);
		float fDet = dot(vSigmaX, R1) * faceDirection;
		vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
		normal = normalize(abs(fDet) * normal - vGrad);
		// the weave's own shading in its grooves (tiny, so a garment keeps its color)
		diffuseColor.rgb *= 1.0 - 0.06 * fade * (1.0 - v * 2.0);
	}`
const SHEEN_FRAG = `#include <emissivemap_fragment>
	{
		float pkGraze = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
		totalEmissiveRadiance += diffuseColor.rgb * (0.06 * pkGraze * pkGraze);
	}`
// Hair's highlight (faces, 2026-10-06): Kajiya-Kay, two lobes along the strands (which hang
// down the head: the tangent is "down" across the surface): a sharp white one and a softer one
// in the hair's own color, shifted apart and jittered per card so it breaks up like real hair.
const HAIR_SPEC_FRAG = `#include <lights_fragment_end>
	#if NUM_DIR_LIGHTS > 0
	{
		vec3 pkUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
		// (on the crown, facing up, "down the strands" is undefined: the highlight fades there)
		float pkSide = 1.0 - smoothstep(0.3, 0.65, abs(dot(normal, pkUp)));
		vec3 pkT = normalize(pkUp - normal * dot(normal, pkUp) + vec3(1e-4));
		vec3 pkV = normalize(vViewPosition);
		#ifdef USE_MAP
			float pkJit = fract(sin(dot(floor(vMapUv * 140.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
		#else
			float pkJit = 0.0;
		#endif
		vec3 pkT1 = normalize(pkT + normal * (0.1 + pkJit * 0.12));
		vec3 pkT2 = normalize(pkT - normal * 0.18);
		for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
			vec3 L = directionalLights[i].direction;
			vec3 H = normalize(L + pkV);
			float d1 = dot(pkT1, H);
			float d2 = dot(pkT2, H);
			float s1 = pow(sqrt(max(0.0, 1.0 - d1 * d1)), 260.0);
			float s2 = pow(sqrt(max(0.0, 1.0 - d2 * d2)), 60.0);
			float ndl = saturate(dot(normal, L) * 0.6 + 0.4);
			reflectedLight.directSpecular += directionalLights[i].color * (ndl * pkSide) * (0.025 * s1 * mix(vec3(1.0), diffuseColor.rgb * 3.0, 0.5) + 0.14 * s2 * diffuseColor.rgb);
		}
	}
	#endif`
// Shoes and hard pieces in the outfit mesh (gear, 2026-10-06): the merged mesh carries a
// per-vertex kind (pkMat: 0 cloth, 1 a shoe's mesh upper, 2 its rubber sole, 3 a hard piece:
// a hat's brim, glasses): the upper gets an engineered mesh of little holes instead of the knit,
// the sole tread grooves and a matte rubber, hard pieces a smooth plastic.
const GEAR_VERT = ["attribute float pkMat;\nvarying float vPkMat;", "\tvPkMat = pkMat;"]
const athleteMaterial = (params, { wrap = "vec3(0.3)", rim = 0.12, key = "pk-cloth", sway = null, knit = false, hairSpec = false } = {}) => {
  const m = new THREE.MeshStandardMaterial(params)
  m.defines = { PK_WRAP: wrap }
  m.onBeforeCompile = (sh) => {
    athleteLight(sh, { rim })
    if (knit) {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", KNIT_VERT[0] + "\n" + GEAR_VERT[0]).replace("#include <begin_vertex>", KNIT_VERT[1] + "\n" + GEAR_VERT[1])
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vPkRest;\nvarying float vPkMat;")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>" + KNIT_FRAG)
        .replace("#include <emissivemap_fragment>", SHEEN_FRAG)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n\tif (vPkMat > 2.5) roughnessFactor = 0.42;\n\telse if (vPkMat > 1.5) roughnessFactor = 0.93;\n\telse if (vPkMat > 0.5) roughnessFactor = 0.62;")
    }
    if (hairSpec) sh.fragmentShader = sh.fragmentShader.replace("#include <lights_fragment_end>", HAIR_SPEC_FRAG)
    if (!sway) return
    sh.uniforms.pkSway = sway.pkSway
    sh.uniforms.pkFlare = sway.pkFlare
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float pkSwayW;\nuniform vec3 pkSway;\nuniform vec4 pkFlare;")
      .replace("#include <skinning_vertex>", "#include <skinning_vertex>\n\t{\n\t\tvec3 pkOut = vec3( transformed.x - pkFlare.x, 0.0, transformed.z - pkFlare.z );\n\t\ttransformed += ( pkSway + pkOut / max( length( pkOut ), 1e-4 ) * pkFlare.w ) * pkSwayW;\n\t}")
  }
  m.customProgramCacheKey = () => key + (sway ? "-sway" : "") + (knit ? "-knit" : "") + (hairSpec ? "-spec" : "")
  if (sway) m.userData.sway = sway
  return m
}
let outfitMaterial = null
const outfitMat = () => (outfitMaterial ||= athleteMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }, { wrap: "vec3(0.32, 0.3, 0.3)", rim: 0.1, knit: true }))

// The modeled kit's material (players v2, docs/players-v2.md): the garments' own normal maps
// (folds, seams, hems: real cloth instead of the procedural knit, which shimmered), and the
// detail atlas (tools/players/build-kit.mjs): R the cloth's shading and occlusion (0.5 = the
// color as is), G the trim (the tee's binding and stripes, the shoes' accents), B a tank's own
// binding. The look's colors are uniforms (one material per athlete, one shader program for
// all): which ones a vertex takes is its part (kitmap.js PIECE_PART). Lit like the rest of the
// athlete (wrapped light, a rim, a soft sheen on the cloth at grazing angles).
const kitMaterial = (kit, look) => {
  const m = new THREE.MeshStandardMaterial({ normalMap: kit.normal, normalScale: kit.normalScale.clone().multiplyScalar(1.6), roughness: 0.84, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })
  m.defines = { PK_WRAP: "vec3(0.32, 0.3, 0.3)" }
  const C = (hex, fb) => srgb(hex || fb)
  const shirt = look.shirt || "#1a9fb0"
  const trim = look.trim || "#ffffff"
  const bottom = look.bottomColor || "#23395d"
  const u = {
    pkDetail: { value: kit.detail },
    pkTop: { value: C(shirt) },
    pkTrim: { value: C(trim) },
    pkBottom: { value: C(bottom) },
    pkBottomTrim: { value: C(bottom === trim ? shirt : trim) },
    pkShoe: { value: C(look.shoes, "#ffffff") },
    pkShoeAccent: { value: C(look.shoeAccent || look.trim, "#1a9fb0") },
    pkSocks: { value: C(look.socks, "#ffffff") },
  }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u)
    athleteLight(sh, { rim: 0.1 })
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float pkPart;\nvarying float vPkPart;").replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvPkPart = pkPart;")
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vPkPart;\nuniform sampler2D pkDetail;\nuniform vec3 pkTop;\nuniform vec3 pkTrim;\nuniform vec3 pkBottom;\nuniform vec3 pkBottomTrim;\nuniform vec3 pkShoe;\nuniform vec3 pkShoeAccent;\nuniform vec3 pkSocks;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
      vec3 pkDet = texture2D(pkDetail, vNormalMapUv).rgb;
      {
        vec3 base = pkTop;
        vec3 tr = pkTrim;
        float mask = pkDet.g;
        if (vPkPart > 3.5) mask = pkDet.b;
        else if (vPkPart > 2.5) { base = pkSocks; tr = pkSocks; }
        else if (vPkPart > 1.5) { base = pkShoe; tr = pkShoeAccent; }
        else if (vPkPart > 0.5) { base = pkBottom; tr = pkBottomTrim; }
        mask = smoothstep(0.3, 0.7, mask);
        diffuseColor.rgb *= mix(base, tr, mask) * (pkDet.r * 2.0);
      }`
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n\tif (vPkPart > 1.5 && vPkPart < 2.5) roughnessFactor = 0.55;")
      .replace("#include <emissivemap_fragment>", SHEEN_FRAG)
  }
  m.customProgramCacheKey = () => "pk-kit"
  return m
}

// ---- the paddle: a rounded face with an edge guard and a printed design, a wrapped grip ----
const PADDLE = { w: 0.19, h: 0.27, neck: 0.075, handle: 0.135 }
const paddleParts = () => {
  if (paddleParts.cache) return paddleParts.cache
  const { w, h } = PADDLE
  const r = 0.06
  const hw = w / 2
  const shape = new THREE.Shape()
  shape.moveTo(-hw + 0.03, 0)
  shape.lineTo(hw - 0.03, 0)
  shape.quadraticCurveTo(hw, 0, hw, 0.04)
  shape.lineTo(hw, h - r)
  shape.quadraticCurveTo(hw, h, hw - r, h)
  shape.lineTo(-hw + r, h)
  shape.quadraticCurveTo(-hw, h, -hw, h - r)
  shape.lineTo(-hw, 0.04)
  shape.quadraticCurveTo(-hw, 0, -hw + 0.03, 0)
  const face = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 6 })
  face.translate(0, PADDLE.neck, -0.006)
  // UVs over the face: 0..1 across its width and height
  const P = face.attributes.position
  const uv = new Float32Array(P.count * 2)
  for (let i = 0; i < P.count; i++) {
    uv[i * 2] = (P.getX(i) + hw) / w
    uv[i * 2 + 1] = (P.getY(i) - PADDLE.neck) / h
  }
  face.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
  // the edge guard: a tube round the rim
  const pts = shape.getSpacedPoints(48).map((p) => new THREE.Vector3(p.x, p.y + PADDLE.neck, 0))
  const guard = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 64, 0.0085, 6, true)
  // the throat, handle (octagonal, wrapped) and butt cap
  const throat = new THREE.CylinderGeometry(0.014, 0.017, 0.03, 8)
  throat.translate(0, PADDLE.neck - 0.006, 0)
  const handle = new THREE.CylinderGeometry(0.0165, 0.0175, PADDLE.handle, 8, 6)
  handle.translate(0, PADDLE.neck - 0.02 - PADDLE.handle / 2, 0)
  const cap = new THREE.CylinderGeometry(0.021, 0.019, 0.014, 10)
  cap.translate(0, PADDLE.neck - 0.02 - PADDLE.handle, 0)
  paddleParts.cache = { face, guard, throat, handle, cap }
  return paddleParts.cache
}
// the face's print (the top of the texture) and a white strip at the bottom that the other
// parts sample, colored by their vertex colors: the whole paddle is one mesh, one material
const PRINT = 192
const paddleTexture = (a, b, design = "stripe") => {
  const c = document.createElement("canvas")
  c.width = 128
  c.height = PRINT + 8
  const x = c.getContext("2d")
  x.fillStyle = a
  x.fillRect(0, 0, 128, PRINT)
  // a soft sheen, a bold diagonal band and a small mark
  const g = x.createLinearGradient(0, 0, 128, PRINT)
  g.addColorStop(0, "rgba(255,255,255,0.18)")
  g.addColorStop(0.5, "rgba(255,255,255,0)")
  g.addColorStop(1, "rgba(0,0,0,0.18)")
  x.fillStyle = g
  x.fillRect(0, 0, 128, PRINT)
  x.fillStyle = b
  if (design === "stripe") {
    x.beginPath()
    x.moveTo(0, 120)
    x.lineTo(128, 70)
    x.lineTo(128, 96)
    x.lineTo(0, 146)
    x.fill()
    x.globalAlpha = 0.5
    x.beginPath()
    x.moveTo(0, 152)
    x.lineTo(128, 102)
    x.lineTo(128, 108)
    x.lineTo(0, 158)
    x.fill()
    x.globalAlpha = 1
  } else if (design === "split") {
    x.fillRect(0, 96, 128, PRINT - 96)
  } else if (design === "dots") {
    for (let r = 0; r < 6; r++) for (let k = 0; k < 4; k++) {
      x.beginPath()
      x.arc(16 + k * 32 + (r % 2) * 16, 70 + r * 22, 6, 0, Math.PI * 2)
      x.fill()
    }
  } else if (design === "chevron") {
    x.lineWidth = 9
    x.strokeStyle = b
    for (const y0 of [88, 118, 148]) {
      x.beginPath()
      x.moveTo(6, y0)
      x.lineTo(64, y0 - 26)
      x.lineTo(122, y0)
      x.stroke()
    }
  } else if (design === "flame") {
    x.beginPath()
    x.moveTo(0, PRINT)
    for (let k = 0; k <= 8; k++) {
      const px = (k / 8) * 128
      x.quadraticCurveTo(px - 8, PRINT - 70 - (k % 2) * 34, px, PRINT - 30 - ((k + 1) % 2) * 26)
    }
    x.lineTo(128, PRINT)
    x.fill()
  }
  x.fillStyle = b
  x.font = "bold 22px Arial"
  x.textAlign = "center"
  x.fillText("98", 64, 44)
  x.fillStyle = "#ffffff"
  x.fillRect(0, PRINT, 128, 8)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}
const paddleFor = (look) => {
  const a = look.paddle || "#ffd23f"
  const b = look.paddleEdge || "#15223a"
  const design = look.paddleDesign || "stripe"
  const key = a + b + design
  if (assets.paddles.has(key)) return assets.paddles.get(key)
  const P = paddleParts()
  const strip = 4 / (PRINT + 8) // v of the white strip's middle
  const piece = (geo, hex, face = false) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    const n = g.attributes.position.count
    const col = new Float32Array(n * 3).fill(1)
    const uv = g.attributes.uv.array.slice()
    const c = srgb(hex)
    for (let i = 0; i < n; i++) {
      if (face) uv[i * 2 + 1] = strip * 2 + uv[i * 2 + 1] * (1 - strip * 2)
      else {
        uv[i * 2] = 0.5
        uv[i * 2 + 1] = strip
        col.set([c.r, c.g, c.b], i * 3)
      }
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
    g.setAttribute("color", new THREE.BufferAttribute(col, 3))
    return g
  }
  const geo = mergeGeometries([piece(P.face, "#ffffff", true), piece(P.guard, b), piece(P.throat, b), piece(P.handle, "#1d1d22"), piece(P.cap, b)])
  const mat = paddleMaterial(paddleTexture(a, b, design), strip * 2)
  const out = { geo, mat }
  assets.paddles.set(key, out)
  return out
}
// The paddle's face (gear, 2026-10-06): a clear coat over a carbon twill that shows only in
// the highlights (it varies the roughness, never the print's colors); the edge guard and grip
// stay satin. The sky reflects in the coat.
const paddleMaterial = (map, faceFromV) => {
  const m = new THREE.MeshPhysicalMaterial({ map, vertexColors: true, roughness: 0.5, metalness: 0.05, clearcoat: 0.55, clearcoatRoughness: 0.22 })
  m.onBeforeCompile = (sh) => {
    sh.uniforms.pkFaceV = { value: faceFromV }
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float pkFaceV;").replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
      #ifdef USE_MAP
      if (vMapUv.y > pkFaceV) {
        // a 2x2 twill: tows over two, under two, shifted a step each row
        vec2 tw = vMapUv * vec2(90.0, 120.0);
        float row = floor(tw.y);
        float over = step(0.5, fract((floor(tw.x) + row) * 0.25 + 0.01));
        float along = mix(fract(tw.x), fract(tw.y), over);
        float tow = 0.5 + 0.5 * cos(along * 6.2832);
        roughnessFactor = 0.3 + 0.22 * over + 0.1 * tow;
      }
      #endif`
    )
  }
  m.customProgramCacheKey = () => "pk-paddle"
  return gearEnv(m, 0.45)
}
const buildPaddle = (look, shadows) => {
  const { geo, mat } = paddleFor(look)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = shadows
  return mesh
}
// the paddle's own frame: grip point at the origin, handle along +y, face normal +z; the
// face's center from the grip point (along the handle)
const GRIP_AT = PADDLE.neck - 0.02 - PADDLE.handle * 0.45 // where the hand closes on the handle
const FACE_FROM_GRIP = PADDLE.neck + PADDLE.h / 2 - GRIP_AT
// a two-handed shot: the top hand closes on the handle this far above the bottom one
const TOP_HAND = 0.075

// ---- hats and glasses (in the head's rest frame: y up, z forward, meters) ----
// (the materials only carry colors: outfitGeometry bakes these into vertex colors)
const accessories = (look, head) => {
  const g = new THREE.Group()
  const mats = { hat: { color: srgb(look.hatColor || "#ffffff") }, cuff: { color: srgb(look.hatColor || "#ffffff").multiplyScalar(0.8) }, dark: { color: srgb("#16161a") }, lens: { color: srgb("#24323c") }, mirror: { color: srgb("#3a5f8a") } }
  const add = (geo, m, setup) => {
    const mesh = new THREE.Mesh(geo)
    mesh.material = m
    setup(mesh)
    g.add(mesh)
    return mesh
  }
  const c = head.center
  const top = head.top
  const hat = look.hat || "none"
  // fitted to the head's outline at band height, over the hair
  const b = head.band
  const rx = b.rx + 0.014
  const rz = b.rz + 0.014
  const ring = (y, h, k0 = 1, k1 = 1) =>
    add(new THREE.CylinderGeometry(k1, k0, h, 28, 1, true), mats.hat, (m) => {
      m.position.set(c.x, y, b.cz)
      m.scale.set(rx, 1, rz)
    })
  // a brim: a crescent out from the band toward the front (or the back), drooping a little
  const brim = (y, ext, spread, drop, back = false) => {
    const K = 18
    const pos = []
    const idx = []
    for (let k = 0; k <= K; k++) {
      const a = (k / K - 0.5) * spread
      const e = ext * Math.pow(Math.max(0, Math.cos((a / spread) * Math.PI)), 0.55)
      const s = back ? -1 : 1
      pos.push(c.x + rx * 0.98 * Math.sin(a), y, b.cz + s * rz * 0.98 * Math.cos(a))
      pos.push(c.x + (rx + e * 0.35) * Math.sin(a), y - drop * (e / ext), b.cz + s * (rz + e) * Math.cos(a))
      if (k < K) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 2, k * 2 + 1, k * 2 + 3)
    }
    const g2 = new THREE.BufferGeometry()
    g2.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g2.setIndex(idx)
    g2.computeVertexNormals()
    return add(g2, mats.hat, () => {})
  }
  if (hat === "cap" || hat === "capBack") {
    const back = hat === "capBack"
    const h = top - b.y + 0.032
    add(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), mats.hat, (m) => {
      m.position.set(c.x, b.y - 0.012, b.cz)
      m.scale.set(rx, h, rz)
    })
    ring(b.y - 0.02, 0.018)
    brim(b.y - 0.022, 0.085, Math.PI * 0.95, 0.018, back)
    add(new THREE.SphereGeometry(0.011, 8, 6), mats.hat, (m) => m.position.set(c.x, b.y - 0.012 + h, b.cz))
  } else if (hat === "visor" || hat === "headband") {
    ring(b.y - 0.012, hat === "visor" ? 0.032 : 0.038, 1.0, 0.97)
    if (hat === "visor") brim(b.y - 0.026, 0.075, Math.PI * 0.9, 0.012)
  } else if (hat === "beanie") {
    // a knit beanie: a snug dome down over the ears, a folded cuff, a pom-pom
    // (the cuff's lower edge stays above the eyebrows)
    const cuffY = Math.max(b.y - 0.022, head.eyeY + 0.068)
    const h = top - cuffY + 0.03
    add(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), mats.hat, (m) => {
      m.position.set(c.x, cuffY, b.cz)
      m.scale.set(rx * 1.05, h, rz * 1.05)
    })
    add(new THREE.CylinderGeometry(1.08, 1.1, 0.04, 28, 1, true), mats.cuff, (m) => {
      m.position.set(c.x, cuffY, b.cz)
      m.scale.set(rx, 1, rz)
    })
    add(new THREE.SphereGeometry(0.028, 10, 8), mats.hat, (m) => m.position.set(c.x, cuffY + h + 0.008, b.cz))
  } else if (hat === "bucket") {
    ring(b.y + 0.012, 0.09, 1.08, 0.94)
    add(new THREE.CircleGeometry(1, 28), mats.hat, (m) => {
      m.rotation.x = -Math.PI / 2
      m.position.set(c.x, b.y + 0.057, b.cz)
      m.scale.set(rx * 0.94, rz * 0.94, 1)
    })
    add(new THREE.CylinderGeometry(1.08, 1.75, 0.03, 28, 1, true), mats.hat, (m) => {
      m.position.set(c.x, b.y - 0.047, b.cz)
      m.scale.set(rx, 1, rz)
    })
  }
  if (look.glasses === "sport") {
    // wraparound sport shades: a curved mirrored band across the eyes
    const r = Math.max(rx, rz) * 1.02
    add(new THREE.CylinderGeometry(1, 1, 0.038, 24, 1, true, -Math.PI * 0.42, Math.PI * 0.84), mats.mirror, (m) => {
      m.position.set(c.x, head.eyeY + 0.004, b.cz)
      m.scale.set(rx * 1.05, 1, Math.max(rz * 1.04, head.eyeZ + 0.014 - b.cz))
    })
    add(new THREE.CylinderGeometry(1, 1, 0.006, 24, 1, true, -Math.PI * 0.42, Math.PI * 0.84), mats.dark, (m) => {
      m.position.set(c.x, head.eyeY + 0.025, b.cz)
      m.scale.set(rx * 1.055, 1, Math.max(rz * 1.045, head.eyeZ + 0.016 - b.cz))
    })
    void r
  } else if (look.glasses && look.glasses !== "none") {
    const z = head.eyeZ + 0.012
    for (const s of [-1, 1]) {
      add(new THREE.TorusGeometry(0.021, 0.0035, 5, 16), mats.dark, (m) => m.position.set(c.x + s * head.eyeX, head.eyeY, z))
      add(new THREE.CircleGeometry(0.02, 14), mats.lens, (m) => m.position.set(c.x + s * head.eyeX, head.eyeY, z - 0.001))
      add(new THREE.BoxGeometry(0.004, 0.004, 0.11), mats.dark, (m) => m.position.set(c.x + s * (head.eyeX + 0.024), head.eyeY + 0.004, z - 0.055))
    }
    add(new THREE.BoxGeometry(head.eyeX * 2 - 0.04, 0.004, 0.004), mats.dark, (m) => m.position.set(c.x, head.eyeY + 0.006, z))
  }
  return g
}

// ---- sneakers: a lofted shoe round the foot (rest pose, world space), colored per vertex:
// sole, upper, an accent stripe and heel tab, laces ----
const sneakerCache = new Map()
const sneakerGeometry = (tpl, side, look) => {
  const shoes = look.shoes || "#ffffff"
  const accent = look.shoeAccent || "#1a9fb0"
  const key = `${tpl.scale}|${side}|${shoes}|${accent}`
  if (sneakerCache.has(key)) return sneakerCache.get(key)
  const foot = tpl.rest["foot_" + side].wp
  const ball = tpl.rest["ball_" + side].wp
  const cx = foot.x
  const heelZ = foot.z - 0.072
  const toeZ = ball.z + 0.082
  const L = toeZ - heelZ
  const mz = (heelZ + toeZ) / 2
  const sole0 = tpl.marks.soleY
  const N = 36
  // the footprint: wider at the ball of the foot, round at both ends
  const outline = []
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    const z = mz + (Math.cos(a) * L) / 2
    const u = (z - heelZ) / L // 0 heel .. 1 toe
    const half = (0.039 + 0.018 * Math.sin(Math.min(1, u * 1.25) * Math.PI * 0.62)) * 0.9 // (trimmer: the old width read clownish next to the athletic ankles)
    const sx = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.8)
    outline.push({ x: cx + sx * half * (side === "l" ? 1 : 1), z, u })
  }
  // rings: the sole (bottom edge, top edge), then the upper narrowing to the top
  const rings = [
    { y: 0.0, s: 0.97, part: "sole" },
    { y: 0.012, s: 1.03, part: "sole" },
    { y: 0.03, s: 1.02, part: "sole" },
    { y: 0.034, s: 1.0, part: "upper" },
    { y: 0.055, s: 0.97, part: "upper" },
    { y: 0.075, s: 0.86, part: "upper" },
    { y: 0.088, s: 0.62, part: "upper" },
  ]
  const heightAt = (u) => (u > 0.55 ? 1 - (u - 0.55) * 1.05 : 1) // lower over the toes
  const pos = []
  const col = []
  const kinds = [] // (pkMat: 1 the mesh upper, 2 the rubber sole)
  const C = (hex) => new THREE.Color(hex)
  const cSole = C(soleFor(shoes))
  const cUpper = C(shoes)
  const cAccent = C(accent)
  const cLace = C(srgb(shoes).getHSL({}).l > 0.85 ? "#f6f6f6" : "#f2f2f2")
  rings.forEach((r, j) => {
    for (const p of outline) {
      const k = r.part === "sole" ? 1 : heightAt(p.u)
      const y = sole0 + 0.002 + (r.part === "sole" ? r.y : 0.03 + (r.y - 0.03) * k)
      const x = cx + (p.x - cx) * r.s
      const z = mz + (p.z - mz) * (r.part === "sole" ? r.s : 0.98 + (r.s - 1) * 0.25)
      pos.push(x, y, z)
      const sideFace = Math.abs(p.x - cx) > 0.03
      let c = r.part === "sole" ? cSole : cUpper
      if (r.part === "upper" && j >= 4 && j <= 4 && sideFace && p.u > 0.15 && p.u < 0.75) c = cAccent // the stripe
      if (r.part === "upper" && j >= 3 && p.u < 0.08) c = cAccent // the heel tab
      if (j === rings.length - 1 && p.u > 0.45 && p.u < 0.78) c = cLace
      col.push(c.r, c.g, c.b)
      kinds.push(r.part === "sole" ? 2 : 1)
    }
  })
  // caps: the bottom and the top (where the ankle goes in)
  const top = rings.length * N
  pos.push(cx, sole0 + 0.002, mz, cx, sole0 + 0.032 + 0.062, mz - L * 0.12)
  col.push(cSole.r, cSole.g, cSole.b, cUpper.r, cUpper.g, cUpper.b)
  kinds.push(2, 1)
  const idx = []
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < N; i++) {
      const a = j * N + i
      const b = j * N + ((i + 1) % N)
      idx.push(a, a + N, b, b, a + N, b + N)
    }
  for (let i = 0; i < N; i++) {
    idx.push(top, (i + 1) % N, i)
    const a = (rings.length - 1) * N + i
    const b = (rings.length - 1) * N + ((i + 1) % N)
    idx.push(top + 1, a, b)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute("pkMat", new THREE.Float32BufferAttribute(kinds, 1))
  g.setIndex(idx)
  g.computeVertexNormals()
  // which way round the triangles face depends on the outline's direction: make them face out
  const n = g.attributes.normal
  const p = g.attributes.position
  let out = 0
  for (let i = 0; i < N; i++) out += (p.getX(3 * N + i) - cx) * n.getX(3 * N + i) + (p.getZ(3 * N + i) - mz) * n.getZ(3 * N + i)
  if (out < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]
    g.setIndex(idx)
    g.computeVertexNormals()
  }
  sneakerCache.set(key, g)
  return g
}

// which hairstyle model a look wears
const HAIR = {
  short: { m: "Hair_SimpleParted", f: "Hair_SimpleParted" },
  buzz: { m: "Hair_Buzzed", f: "Hair_Buzzed" },
  pixie: { m: "Hair_BuzzedFemale", f: "Hair_BuzzedFemale" },
  buns: { m: "Hair_Buns", f: "Hair_Buns" },
  spiky: { m: "Hair_Buzzed", f: "Hair_BuzzedFemale" },
  bald: { m: null, f: null },
  curly: { m: "Hair_Buzzed", f: "Hair_Buns" },
  bun: { m: "Hair_Buns", f: "Hair_Buns" },
  ponytail: { m: "Hair_Long", f: "Hair_Long" },
  braid: { m: "Hair_Long", f: "Hair_Long" },
  long: { m: "Hair_Long", f: "Hair_Long" },
}
// the MakeHuman bodies' hairstyles (mh-hair.glb: each fitted to both bodies, "<name>@m/f")
const HAIR_MH = {
  short: { m: "Hair_Short", f: "Hair_Bob" },
  buzz: { m: "Hair_Buzz", f: "Hair_Buzz" },
  pixie: { m: "Hair_Swept", f: "Hair_Pixie" },
  buns: { m: "Hair_Bun", f: "Hair_Bun" },
  spiky: { m: "Hair_Spiky", f: "Hair_Spiky" },
  bald: { m: null, f: null },
  curly: { m: "Hair_Afro", f: "Hair_Afro" },
  bun: { m: "Hair_Bun", f: "Hair_Bun" },
  ponytail: { m: "Hair_Ponytail", f: "Hair_Ponytail" },
  braid: { m: "Hair_Braid", f: "Hair_Braid" },
  long: { m: "Hair_Long", f: "Hair_Long" },
}
// styles that hang out of the back of a hat (cropped at the crown); the rest become a buzz cut
// players v3: with a photo face these styles are the photo's own hair (cards would only cover it)
const PHOTO_OWN_HAIR = ["short", "buzz", "pixie", "spiky", "bald"]
const UNDER_HAT_MH = ["Hair_Long", "Hair_Ponytail", "Hair_Braid", "Hair_Bun"]
export const bodyOf = (look) => (look.body === "f" ? "f" : "m")
// Under a cap or a bucket hat only close-cropped hair stays inside it (the other styles'
// fringes and buns poke through the crown); long hair still hangs out the back.
const HATS = ["cap", "capBack", "bucket", "beanie"]
export const hairFor = (look, kind = bodyOf(look), set = assets?.set || "mh") => {
  const hatted = HATS.includes(look.hat)
  if (set === "mh") {
    const name = (HAIR_MH[look.hair || "short"] || HAIR_MH.short)[kind]
    if (!name || !hatted) return name
    // (a bun becomes a tail out of the back of the cap)
    if (name === "Hair_Bun") return "Hair_Ponytail"
    return UNDER_HAT_MH.includes(name) ? name : "Hair_Buzz"
  }
  const name = (HAIR[look.hair || "short"] || HAIR.short)[kind]
  if (!name || !hatted || name === "Hair_Long") return name
  // (a bun becomes a tail out of the back of the cap)
  if (kind === "f" && name === "Hair_Buns") return "Hair_Long"
  return kind === "f" ? "Hair_BuzzedFemale" : "Hair_Buzzed"
}
// a hairstyle's mesh for a body (the MakeHuman set fits each style to each body)
const hairMesh = (name, kind) => (name ? assets.hairs[`${name}@${kind}`] || assets.hairs[name] || null : null)

// Hair under a hat: the hairstyle without the triangles the hat's crown covers (they'd poke
// through it). The hair's vertices are in the Head bone's space; the hat's band height is in
// the body's rest space, so go through the Head bone's rest transform. Made once per style.
const croppedHair = (tpl, src, kind) => {
  const key = `${kind}|${src.name}`
  tpl.cropped ||= {}
  if (tpl.cropped[key]) return tpl.cropped[key]
  const g = src.geometry
  src.updateMatrix()
  const M = new THREE.Matrix4().multiplyMatrices(tpl.bones.Head.matrixWorld, src.matrix)
  const P = g.attributes.position
  const cut = tpl.head.band.y - 0.02
  const above = new Uint8Array(P.count)
  for (let i = 0; i < P.count; i++) above[i] = tv.fromBufferAttribute(P, i).applyMatrix4(M).y > cut ? 1 : 0
  const I = g.index.array
  const keep = []
  for (let t = 0; t < I.length; t += 3) if (above[I[t]] + above[I[t + 1]] + above[I[t + 2]] < 2) keep.push(I[t], I[t + 1], I[t + 2])
  const out = g.clone()
  out.setIndex(keep)
  tpl.cropped[key] = out
  return out
}

// How much each hair vertex swings (attribute pkSwayW, made once per geometry): nothing on the
// scalp; more the lower it hangs below the eyes and the further it sticks out behind the skull
// (a ponytail, a braid, long hair). Returns whether the style swings at all.
const hairSwayWeights = (tpl, src, geo) => {
  if (geo.userData.swings !== undefined) return geo.userData.swings
  src.updateMatrix()
  const M = new THREE.Matrix4().multiplyMatrices(tpl.bones.Head.matrixWorld, src.matrix)
  const P = geo.attributes.position
  const w = new Float32Array(P.count)
  const below = tpl.head.eyeY - 0.03
  const behind = tpl.head.band.cz - tpl.head.band.rz * 0.75
  let most = 0
  for (let i = 0; i < P.count; i++) {
    tv.fromBufferAttribute(P, i).applyMatrix4(M)
    const d = Math.max(0, below - tv.y) + Math.max(0, behind - tv.z) * 0.8
    w[i] = Math.pow(Math.min(1, d / 0.24), 1.3)
    most = Math.max(most, w[i])
  }
  geo.setAttribute("pkSwayW", new THREE.BufferAttribute(w, 1))
  geo.userData.swings = most > 0.25
  return geo.userData.swings
}

// ---- an athlete ----
const DRIVEN_SPINE = ["spine_01", "spine_02", "spine_03"]
const buildAthlete = (look = {}, { shadows = false, withPaddle = true } = {}, detail = "medium") => {
  const kind = bodyOf(look)
  const tpl = (isHi(detail) && assets.hi?.[kind]) || assets[kind]
  // (players v3: Ultra lights the skin and the kit with the venue's sky as well)
  const ultra = detail === "ultra"
  const root = new THREE.Group()
  const holder = cloneSkinned(tpl.scene)
  // taller or shorter (a few percent: the legs still reach the court through the IK)
  const height = Math.max(0.94, Math.min(1.06, Number(look.height) || 1))
  holder.scale.setScalar(tpl.scale * height)
  root.add(holder)
  const meshes = {}
  holder.traverse((o) => {
    if (o.isSkinnedMesh) meshes[o.name] = o
  })
  const body = meshes.Body
  const skeleton = body.skeleton
  const B = Object.fromEntries(skeleton.bones.map((b) => [b.name, b]))
  const restLp = Object.fromEntries(skeleton.bones.map((b) => [b.name, b.position.clone()]))
  const restLq = Object.fromEntries(skeleton.bones.map((b) => [b.name, b.quaternion.clone()]))
  const rest = tpl.rest
  const s = tpl.scale * height

  // materials (shared between athletes who look alike)
  const skinHex = typeof look.skin === "number" ? SKIN[look.skin] || SKIN[2] : look.skin || SKIN[2]
  const hairHex = look.hairColor || "#2b1b0e"
  // (the skin is this athlete's own material: its sweat is its own; the program is shared)
  const fd = faceDetail(detail)
  const sweatU = { value: 0 }
  // players v3: the photo face, if its shape and a texture are in (createAthlete waits for them)
  const lodKey = tpl.lod === "hi" ? "hi" : "med"
  const faceInfo = tpl.set === "mh" && faceShapeNow.has(look.face) ? faceOf(look) : null
  const faceT = faceInfo && (faceTexNow.get(`${faceInfo.id}|${lodKey}`) || faceTexNow.get(`${faceInfo.id}|med`))
  const face = faceT?.map ? faceInfo : null
  // (the photo's own hair: recolored to the look's; under skin when bald; facial hair shaved
  // when the look has no beard)
  const photoHair = face ? { hair: faceT.hair, hairTone: face.hairTone, hairColor: look.hairColor, bald: look.hair === "bald", shave: look.beard === false && (face.beard || 0) > 0.12 } : null
  body.material = skinMaterial(tpl.maps, skinHex, { pores: fd.pores, sweat: sweatU, photo: face ? { tone: face.tone, map: faceT.map, detail: faceT.detail, ...photoHair } : null })
  if (ultra) gearEnv(body.material, 0.3)
  if (face && !faceTexNow.get(`${face.id}|${lodKey}`)) faceTexture(face.id, lodKey).then((t) => body.material?.userData?.setPhoto?.(t))
  // (the MakeHuman brows and lashes are cut out of their texture's alpha)
  const cutout = tpl.set === "mh"
  const browMat = shared(`brows|${kind}|${hairHex}|${tpl.set}`, () => new THREE.MeshStandardMaterial({ map: tpl.maps.brows, color: tint(hairHex, REF_HAIR), roughness: 0.9, ...(cutout ? { alphaTest: 0.3, side: THREE.DoubleSide } : {}) }))

  // everything worn but the hair: one more skinned mesh on the same skeleton
  const variant = variantOf(tpl, look.build, body.geometry, face)
  body.geometry = bodyUnder(tpl, body.geometry, look, variant)
  body.updateMorphTargets()
  const outfitGeo = outfitGeometry(tpl, look, variant)
  // (a skirt swings: this athlete's own material, for its spring's uniforms)
  const skirtSway = outfitGeo.userData.swings ? swayUniforms() : null
  const outfit = new THREE.SkinnedMesh(outfitGeo, skirtSway ? athleteMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }, { wrap: "vec3(0.32, 0.3, 0.3)", rim: 0.1, sway: skirtSway, knit: true }) : outfitMat())
  outfit.bind(skeleton, body.bindMatrix)
  const parts = [body]
  // (everything may be modeled kit now: an empty outfit isn't drawn)
  if (outfitGeo.attributes.position.count) {
    body.parent.add(outfit)
    parts.push(outfit)
  }
  // players v2: the modeled kit (one more skinned draw, its own material for the look's colors)
  const worn = wornOf(tpl, look)
  let kitMesh = null
  if (worn.pieces.length) {
    kitMesh = new THREE.SkinnedMesh(kitGeometry(tpl, worn.pieces, variant), kitMaterial(tpl.kit, look))
    if (ultra) gearEnv(kitMesh.material, 0.25)
    kitMesh.name = "Kit"
    kitMesh.bind(skeleton, body.bindMatrix)
    body.parent.add(kitMesh)
    parts.push(kitMesh)
  }
  // the skin family's own texture (players.json: light, mid, dark), when it's in; the light
  // one, recolored, until then
  const fam = skinFamily(look.skin)
  if (!face && (fam !== "light" || tpl.lod === "hi") && tpl.set === "mh")
    skinTexture(kind, fam, tpl.lod).then((t) => {
      if (t && body.material?.userData?.setSkin) body.material.userData.setSkin(t.map, t.ref)
    })

  // the head: bigger, with eyes, brows and hair
  const head = B.Head
  head.scale.setScalar(tpl.headScale)
  const attach = []
  // (a photo face: its own eye; the eyes, lashes and teeth moved with its shape; no brow cards)
  const fparts = face ? faceParts(tpl, face, meshes) : null
  if (fparts && faceT.eye && !fparts.eyeMat) fparts.eyeMat = eyeMaterial({ map: faceT.eye }, tpl.head.eyeY + faceShapeNow.get(face.id).eyes.l[1], tpl.head.eyeR)
  for (const [name, mat] of [
    ["Eyes", fparts?.eyeMat || tpl.maps.eyes],
    ["Brows", browMat],
    ...(meshes.Teeth && tpl.onHead.Teeth && !(typeof window !== "undefined" && window.__pbNoTeeth) ? [["Teeth", tpl.maps.teeth]] : []),
  ]) {
    meshes[name].removeFromParent()
    const geo = (fparts && { Eyes: fparts.eyes, Brows: fparts.brows, Teeth: fparts.teeth }[name]) || meshes[name].geometry
    const m = new THREE.Mesh(geo, mat)
    m.matrixAutoUpdate = false
    m.matrix.copy(tpl.onHead[name])
    head.add(m)
    attach.push(m)
  }
  // (a photo face's short styles are its own photographed hair: no cards over it)
  const hairName = face && PHOTO_OWN_HAIR.includes(look.hair) ? null : hairFor(look, kind)
  const hatted = HATS.includes(look.hat)
  let hairSway = null // (the uniforms of a hairstyle that swings: a ponytail, a braid, long hair)
  let hairMeshW = null
  const wearHair = (src, crop, { cap = false } = {}) => {
    // (cards cut out of their texture's alpha: smoothed by the antialiasing where there is any)
    const cut = src.material.alphaTest > 0 || src.material.transparent
    const geo = crop ? croppedHair(tpl, src, kind) : src.geometry
    const swings = !cap && hairSwayWeights(tpl, src, geo)
    let m
    if (cap) {
      // under the hair: the scalp in the hair's color, so the strands read thick, not see-through
      m = shared(`haircap|${hairHex}`, () => athleteMaterial({ color: tint(hairHex, REF_HAIR).multiplyScalar(0.2), roughness: 0.9, metalness: 0 }, { wrap: "vec3(0.2)", rim: 0.05, key: "pk-hair" }))
    } else if (swings) {
      hairSway = swayUniforms()
      m = athleteMaterial({ map: src.material.map, color: tint(hairHex, REF_HAIR), roughness: 0.66, side: THREE.DoubleSide, ...(cut ? { alphaTest: 0.42, alphaToCoverage: true } : {}) }, { wrap: "vec3(0.35)", rim: 0.16, key: "pk-hair", sway: hairSway, hairSpec: fd.hairSpec })
    } else m = shared(`hair|${src.material.map.uuid}|${hairHex}|${fd.hairSpec ? 1 : 0}`, () => athleteMaterial({ map: src.material.map, color: tint(hairHex, REF_HAIR), roughness: 0.66, side: THREE.DoubleSide, ...(cut ? { alphaTest: 0.42, alphaToCoverage: true } : {}) }, { wrap: "vec3(0.35)", rim: 0.16, key: "pk-hair", hairSpec: fd.hairSpec }))
    const h = new THREE.Mesh(geo, m)
    // (the file's node transform undoes the mesh compression's quantization)
    h.position.copy(src.position)
    h.quaternion.copy(src.quaternion)
    h.scale.copy(src.scale)
    head.add(h)
    attach.push(h)
    if (swings) hairMeshW = h
  }
  const hairSrc = hairMesh(hairName, kind)
  // (the cap under any hairstyle but the buzz cut itself; not under a hat)
  const capSrc = hairSrc && tpl.set === "mh" && !hatted && hairName !== "Hair_Buzz" && !face ? hairMesh("Hair_Buzz", kind) : null
  if (capSrc) wearHair(capSrc, false, { cap: true })
  if (hairSrc) wearHair(hairSrc, hatted)
  // (a photo face with its own beard keeps it, recolored; the cards only where it has none)
  const beard = look.beard && !(face && (face.beard || 0) > 0.12) ? hairMesh("Hair_Beard", kind) : null
  if (beard) wearHair(beard)

  // the paddle in the playing hand
  let paddleSide = "r"
  const paddleHolder = new THREE.Group()
  let paddle = null
  if (withPaddle) {
    paddle = buildPaddle(look, shadows)
    paddle.position.y = -GRIP_AT
    paddleHolder.add(paddle)
    paddleHolder.scale.setScalar(1 / s) // true size, whatever the body scale
  }
  const placePaddle = (side) => {
    paddleSide = side
    const g = tpl.grip[side]
    paddleHolder.position.set(g.p.x, g.p.y, g.p.z)
    paddleHolder.quaternion.set(g.q.x, g.q.y, g.q.z, g.q.w)
    B["hand_" + side].add(paddleHolder)
  }
  placePaddle("r")

  // fingers (arms.js FINGERS): each finger curled at its three joints and spread a little,
  // per finger (a relaxed hand is a cascade, index least, little finger most; the grip wraps
  // round the handle; cupped on the paddle's throat; a fist; open), moving to a new shape over
  // a few frames, never in a snap
  const handShape = { l: null, r: null }
  const handNow = { l: null, r: null }
  const handWant = { l: "relaxed", r: "relaxed" }
  const poseFingers = (side, curls) => {
    for (const f of FINGER_NAMES)
      for (let k = 1; k <= 3; k++) {
        const name = `${f}_0${k}_${side}`
        const axis = tpl.curl[name]
        if (!axis || !B[name]) continue
        let q = qmul(toQ(restLq[name]), qaxis(axis, curls[f][k - 1]))
        const sp = k === 1 && f !== "thumb" ? tpl.spread[name] : null
        if (sp && curls.spread[f]) q = qmul(qmul(toQ(restLq[name]), qaxis(sp, curls.spread[f])), qaxis(axis, curls[f][k - 1]))
        B[name].quaternion.set(q.x, q.y, q.z, q.w)
      }
  }
  const setHand = (side, shape, dt = 0) => {
    handWant[side] = shape
    const target = fingerPose(shape)
    // (dt 0: at once)
    // (a hand already in its shape isn't posed again)
    if (dt > 0 && handShape[side] === shape && handNow[side]?.settled) return
    const next = dt > 0 ? stepFingers(handNow[side], target, dt, shape === "grip" || shape === "fist" ? 14 : 8) : target
    next.settled = FINGER_NAMES.every((f) => next[f].every((v, i) => Math.abs(v - target[f][i]) < 1e-4))
    handNow[side] = next
    handShape[side] = shape
    poseFingers(side, next)
  }
  const setFingers = () => {
    for (const side of ["l", "r"]) setHand(side, side === paddleSide && withPaddle ? "grip" : "relaxed")
  }
  setFingers()

  // shadows and culling: the bones move, not the meshes, so give them a sphere that holds
  // any pose around the root (which follows the player)
  const sphere = new THREE.Sphere(new THREE.Vector3(0, 0.9 / s, 0), 1.6 / s)
  for (const p of parts) {
    p.castShadow = shadows // (not the hair, eyes or brows)
    p.receiveShadow = false
    p.boundingSphere = sphere
  }
  // ---- posing ----
  const worldQ = (bone) => toQ(bone.getWorldQuaternion(tq))
  const worldP = (bone) => toV(bone.getWorldPosition(tv))
  const setWorldQ = (bone, q) => {
    bone.parent.getWorldQuaternion(tq2)
    const local = qmul(qinv(toQ(tq2)), q)
    bone.quaternion.set(local.x, local.y, local.z, local.w)
    bone.updateWorldMatrix(false, false)
  }
  // (the arms: their parents' world transforms are already current, set top-down this frame,
  // so read them straight from the matrices instead of walking up the hierarchy each time)
  const _dp = new THREE.Vector3()
  const _ds = new THREE.Vector3()
  const _dq = new THREE.Quaternion()
  const setWorldQF = (bone, q) => {
    bone.parent.matrixWorld.decompose(_dp, _dq, _ds)
    const local = qmul(qinv(toQ(_dq)), q)
    bone.quaternion.set(local.x, local.y, local.z, local.w)
    bone.updateWorldMatrix(false, false)
  }
  const matP = (bone) => toV(tv.setFromMatrixPosition(bone.matrixWorld))
  const childP = (parent, child) => toV(tv.copy(child.position).applyMatrix4(parent.matrixWorld))
  const addLocal = (bone, d) => {
    if (d.w > 0.99999) return
    tq.set(d.x, d.y, d.z, d.w)
    bone.quaternion.multiply(tq)
    bone.updateWorldMatrix(false, false)
  }
  const restDir = (a, b) => norm(sub3(rest[b].wp, rest[a].wp))
  const FWD = { x: 0, y: 0, z: 1 }
  const UPV = { x: 0, y: 1, z: 0 }
  const len = (a, b) => Math.hypot(rest[b].wp.x - rest[a].wp.x, rest[b].wp.y - rest[a].wp.y, rest[b].wp.z - rest[a].wp.z) * s
  const limbs = {}
  for (const side of ["l", "r"]) {
    const ua = restDir(`upperarm_${side}`, `lowerarm_${side}`)
    const la = restDir(`lowerarm_${side}`, `hand_${side}`)
    const th = restDir(`thigh_${side}`, `calf_${side}`)
    const ca = restDir(`calf_${side}`, `foot_${side}`)
    limbs[side] = {
      arm: { ua, uaN: norm(cross3(ua, FWD)), la, laN: norm(cross3(la, FWD)), l1: len(`upperarm_${side}`, `lowerarm_${side}`), l2: len(`lowerarm_${side}`, `hand_${side}`) },
      leg: { th, thN: norm(cross3(th, scale3(FWD, -1))), ca, caN: norm(cross3(ca, scale3(FWD, -1))), l1: len(`thigh_${side}`, `calf_${side}`), l2: len(`calf_${side}`, `foot_${side}`) },
    }
  }
  const hipMid0 = scale3(add3(rest.thigh_l.wp, rest.thigh_r.wp), 0.5)
  const pelvisOff = scale3(sub3(rest.pelvis.wp, hipMid0), s)
  const layers = {}
  let clock = 0
  let lastPos = null
  let speedEst = 0
  const moves = assets.moves
  const prevQ = {} // (the pop limiter's last rotations)

  // the bone mask: the run's clips don't move the paddle side's shoulder while that arm holds
  // the ready position or swings (the arm's pose is anim.js's; a clip on top is double motion)
  const mask = { clavicle_l: 1, clavicle_r: 1 }
  const layerMoves = (bone) => {
    let d = Q()
    for (const [name, L] of Object.entries(LAYERS)) {
      const w = (layers[name] || 0) * L.gain * (L.bones[bone] || 0) * (L.locked ? (mask[bone] ?? 1) : 1)
      if (w <= 1e-3) continue
      const clip = moves.clips[L.clip]
      if (!clip) continue
      const t = clipTime(clip, L.locked ? { phase: layers.phase, locked: true, contact: L.contact || 0 } : { time: clock })
      d = qmul(d, additiveMove(moves, clip, bone, t, w))
    }
    return d
  }

  // the arms (arms.js): each side's rig, the solver's state, the shoulder girdle's smoothed
  // angles; the limb bones' own axes (for the twist bones)
  const rigs = { l: armRig(rest, "l", s, tpl.grip.l), r: armRig(rest, "r", s, tpl.grip.r) }
  const armState = { l: {}, r: {} }
  const armHold = { key: null, skips: 0, side: null, two: false }
  let frameNo = Math.round(hash01(look.name || "") * 10) // (athletes take their light frames in turn)
  const girdle = { l: { elev: 0, prot: 0 }, r: { elev: 0, prot: 0 } }
  const axisU = { l: norm(toV(restLp.lowerarm_l)), r: norm(toV(restLp.lowerarm_r)) }
  const axisF = { l: norm(toV(restLp.hand_l)), r: norm(toV(restLp.hand_r)) }
  // a solved arm onto the bones: the upper arm (its twist bone taking back part of its roll
  // near the shoulder), the forearm (its twist shared out along the twist bones), the hand
  const placeArm = (sd, res) => {
    const ua = B["upperarm_" + sd]
    const la = B["lowerarm_" + sd]
    const hand = B["hand_" + sd]
    la.position.copy(restLp["lowerarm_" + sd]).multiplyScalar(res.stretch || 1)
    hand.position.copy(restLp["hand_" + sd]).multiplyScalar(res.stretch || 1)
    setWorldQF(ua, res.upper)
    const tu = B["upperarm_twist_01_" + sd]
    if (tu) {
      const roll = twistOf(qmul(qinv(toQ(restLq["upperarm_" + sd])), toQ(ua.quaternion)), axisU[sd])
      const q = qaxis(axisU[sd], -TWIST.upperarmCounter * roll)
      tu.quaternion.set(q.x, q.y, q.z, q.w)
      tu.updateWorldMatrix(false, false)
    }
    setWorldQF(la, res.lower)
    for (const [name, share] of Object.entries(TWIST.forearmShare)) {
      const b = B[name + "_" + sd]
      if (!b) continue
      const q = qaxis(axisF[sd], res.twist * share)
      b.quaternion.set(q.x, q.y, q.z, q.w)
      b.updateWorldMatrix(false, false)
    }
    setWorldQF(hand, res.hand)
  }
  // a hand that isn't holding anything: the wrist a little flexed and toward the little finger,
  // the forearm turned the way a resting one is (palm toward the thigh, a touch back, when the
  // arm hangs; more pronated with the hand up in front)
  const relaxFor = (sd) => {
    const st = armState[sd].last
    const up = st ? Math.max(0, Math.min(1, (st.a.ua.y + 0.6) / 0.9)) : 0
    return { pron: 12 + 28 * up, flex: 12 - 4 * up, dev: -7 }
  }

  const apply = (pose, dt = 1 / 60) => {
    clock += dt
    // (pose.lift: up on a stair or a rooftop terrace, park/lift.js; its points are raised too)
    root.position.set(pose.pelvis.x, pose.lift || 0, pose.pelvis.z)
    root.updateMatrixWorld(true)
    // how fast the body's going (the pose doesn't say), for the clip layers
    if (lastPos && dt > 0) {
      const v = Math.hypot(pose.pelvis.x - lastPos.x, pose.pelvis.z - lastPos.z) / dt
      speedEst += (Math.min(v, 9) - speedEst) * Math.min(1, dt * 8)
    }
    lastPos = { x: pose.pelvis.x, z: pose.pelvis.z }
    const info = pose.info || {}
    stepLayers(layers, layerTargets({ speed: info.speed ?? speedEst, swinging: info.swinging, mood: info.mood, between: info.between, blend: info.blend || null, mm: !!info.mm }), dt)
    layers.phase = info.phase ?? clock * 6
    const ready = info.ready ?? 0
    mask["clavicle_" + paddleSide] = 1 - 0.85 * ready
    mask["clavicle_" + (paddleSide === "r" ? "l" : "r")] = 1 - 0.6 * (info.stroke || 0)
    // the pop limiter: the spine, neck, head and shoulders turn at most this much a frame
    // (a stroke's quick unwinding allowed); the arms are placed exactly by the IK below
    const maxTurn = (info.fast ? 30 : 14) * Math.max(dt, 1 / 240)
    const settle = (bone) => {
      const q = limitQuat(prevQ[bone.name], toQ(bone.quaternion), maxTurn)
      bone.quaternion.set(q.x, q.y, q.z, q.w)
      bone.updateWorldMatrix(false, false)
      prevQ[bone.name] = q
    }

    // the pelvis: placed so the hip joints are where the pose's are
    const up = norm(add3(scale3(UPV, 0.65), scale3(pose.spine, 0.35)))
    const pr = pose.pelvisRight
    const pf = norm(cross3(up, pr))
    const Rp = aimDelta(UPV, FWD, up, pf)
    const hipMid = scale3(add3(pose.hipL, pose.hipR), 0.5)
    const pw = add3(hipMid, qrot(Rp, pelvisOff))
    const pel = B.pelvis
    tv.set(pw.x, pw.y, pw.z)
    pel.parent.worldToLocal(tv)
    pel.position.copy(tv)
    setWorldQ(pel, qmul(Rp, rest.pelvis.wq))
    addLocal(pel, layerMoves("pelvis"))
    // the spine turns from the hips' frame to the chest's
    const Rc = aimDelta(UPV, FWD, pose.spine, pose.chestForward)
    // breathing (idle.js): the chest opens and lifts a little on each breath, more after a run
    const breath = (info.breath ?? Math.sin(clock * 1.6)) * (info.breathDepth ?? 0.45)
    const Rb = qaxis(pose.chestRight || { x: 1, y: 0, z: 0 }, -0.022 * breath)
    DRIVEN_SPINE.forEach((name, i) => {
      setWorldQ(B[name], qmul(i ? qmul(Rb, qslerp(Rp, Rc, [0.4, 0.75, 1][i])) : qslerp(Rp, Rc, [0.4, 0.75, 1][i]), rest[name].wq))
      addLocal(B[name], layerMoves(name))
      settle(B[name])
    })
    // the head looks along the pose's look; the neck takes some of it
    // (the head keeps its eyes level, like a real player's, whatever the spine is doing)
    const Rh = aimDelta(FWD, UPV, pose.look, add3(scale3(UPV, 0.75), scale3(pose.spine, 0.25)))
    setWorldQ(B.neck_01, qmul(qslerp(Rc, Rh, 0.35), rest.neck_01.wq))
    addLocal(B.neck_01, layerMoves("neck_01"))
    settle(B.neck_01)
    setWorldQ(head, qmul(Rh, rest.Head.wq))
    addLocal(head, layerMoves("Head"))
    settle(head)

    // ---- the arms (arms.js): the shoulder girdle first, then each arm solved on this model's
    // own bones with real joint limits: no locked or stretched elbows, the elbow's direction and
    // the paddle's roll chosen so the humerus, the forearm's twist and the wrist stay in range,
    // the twist shared along the forearm ----
    const right = (pose.hand ?? 1) > 0
    const handSide = right ? "r" : "l"
    if (handSide !== paddleSide && withPaddle) {
      placePaddle(handSide)
      setFingers()
      armState.l = {}
      armState.r = {}
    }
    const pSide = paddleSide
    const oSide = pSide === "r" ? "l" : "r"
    const wristTarget = { r: right ? pose.wristP : pose.wristO, l: right ? pose.wristO : pose.wristP }
    const elbowTarget = { r: right ? pose.elbowP : pose.elbowO, l: right ? pose.elbowO : pose.elbowP }
    const shoulderPose = { r: pose.shoulderR, l: pose.shoulderL }
    // where each elbow points: the pose's own bend (anim.js turns it smoothly, even with the arm
    // straight), or from the pose's elbow; the solver weighs it against the anatomy
    const bends = { r: right ? pose.bendP : pose.bendO, l: right ? pose.bendO : pose.bendP }
    const bendOf = (sd) => bends[sd] || sub3(elbowTarget[sd], scale3(add3(shoulderPose[sd], wristTarget[sd]), 0.5))
    // the chest's frame: the figure's right, up, forward
    const cr = norm(pose.chestRight || { x: -1, y: 0, z: 0 })
    const cf = norm(pose.chestForward)
    const cu = norm(cross3(cr, cf))
    const chest = { right: cr, up: cu, fwd: cf }
    const toChest = (v) => ({ x: dot3(v, cr), y: dot3(v, cu), z: dot3(v, cf) })
    const torso = { a: matP(B.pelvis), b: matP(B.neck_01), r: 0.115 }
    // where each hand is going (the paddle hand: about where its wrist will be)
    const handGoal = { [oSide]: wristTarget[oSide], [pSide]: withPaddle ? sub3(pose.paddle.face, scale3(norm(pose.paddle.axis), FACE_FROM_GRIP + 0.07)) : wristTarget[pSide] }
    // the shoulder girdle: up as the arm rises past about 40 degrees, forward on reaches in
    // front and across, back on a backswing, out after a long reach (smoothed); a breath lifts it
    const kG = Math.min(1, dt * (info.fast ? 22 : 10))
    for (const sd of ["l", "r"]) {
      const c = B["clavicle_" + sd]
      setWorldQF(c, qmul(Rc, rest["clavicle_" + sd].wq))
      const S0 = childP(c, B["upperarm_" + sd])
      const to = sub3(handGoal[sd], S0)
      const dist = Math.hypot(to.x, to.y, to.z)
      const want = clavicleFor(toChest(norm(to, { x: 0, y: -1, z: 0 })), dist / (rigs[sd].l1 + rigs[sd].l2), sd === "l" ? 1 : -1)
      const g = girdle[sd]
      g.elev += (want.elev - g.elev) * kG
      g.prot += (want.prot - g.prot) * kG
      const elev = g.elev + 0.03 * breath
      const R = qmul(qaxis(cf, sd === "r" ? -elev : elev), qaxis(cu, sd === "l" ? -g.prot : g.prot))
      setWorldQF(c, qmul(qmul(R, Rc), rest["clavicle_" + sd].wq))
      addLocal(c, layerMoves("clavicle_" + sd))
      settle(c)
    }
    // the other hand: a fist to celebrate, cupped on the paddle's throat in the ready
    // position, gripping the handle for a two-hander, relaxed otherwise
    if (withPaddle) {
      const near = Math.hypot(pose.wristO.x - pose.wristP.x, pose.wristO.y - pose.wristP.y, pose.wristO.z - pose.wristP.z) < 0.2
      setHand(oSide, info.fist ? "fist" : info.two ? "grip" : info.offGrip && near ? "cup" : info.open ? "open" : "relaxed", dt)
      setHand(pSide, "grip", dt)
    }

    // the paddle arm: the face's center and its normal exactly where the pose has them; the
    // paddle's roll about its normal, the face the palm is behind and the elbow's direction
    // chosen for the most natural arm
    let paddleNow = null
    // (how exactly the face must be as the pose has it: fully around contact, where the ball
    // is; elsewhere the arm comes first and the paddle follows the hand)
    const tRel = info.tRel
    const exact = tRel === null || tRel === undefined || (info.stroke || 0) < 0.3 ? 0 : Math.max(0, Math.min(1, 1 - (Math.abs(tRel) - 0.05) / 0.12))
    const h = Math.max(dt, 1 / 240)
    // (every other frame a light one: last frame's choices kept, the arm solved to the new targets)
    frameNo++
    // Arms whose targets haven't moved against the chest (standing ready, between points) keep
    // last frame's pose for a frame or two: they ride along on the shoulders, the solver rests
    const loc = (p) => toChest(sub3(p, torso.b))
    const holdKey = [loc(pose.paddle.face), loc(add3(pose.paddle.face, scale3(norm(pose.paddle.axis), 0.15))), loc(wristTarget.l), loc(wristTarget.r)]
    let moved = Infinity
    if (armHold.key) {
      moved = 0
      for (let i = 0; i < 4; i++) moved = Math.max(moved, Math.hypot(holdKey[i].x - armHold.key[i].x, holdKey[i].y - armHold.key[i].y, holdKey[i].z - armHold.key[i].z))
    }
    // (and on a slow device, every other frame away from a stroke: the athletes take turns)
    const calm = exact === 0 && !info.fast && armHold.side === pSide && armHold.two === !!info.two
    const holdArms = calm && ((moved < 0.008 && armHold.skips < 2 && (info.stroke || 0) < 0.05) || (dt > 1 / 40 && armHold.skips < 1 && (info.stroke || 0) < 0.3))
    if (holdArms) armHold.skips++
    else {
      armHold.key = holdKey
      armHold.skips = 0
      armHold.side = pSide
      armHold.two = !!info.two
    }
    if (holdArms) {
      // (nothing to do)
    } else if (withPaddle) {
      const st = armState[pSide]
      const S = childP(B["clavicle_" + pSide], B["upperarm_" + pSide])
      const res = solvePaddleArm(rigs[pSide], S, pose.paddle, chest, { faceFromGrip: FACE_FROM_GRIP, pole: bendOf(pSide), poleW: 0.35, prev: st.prev || null, maxTurn: (info.fast ? 40 : 14) * h, handRate: (info.fast ? 40 : 14) * h, handTurn: (info.fast ? 30 : 11) * h, exact, sideWant: (info.stroke || 0) > 0.05 && info.side ? info.side : 0, wrist: add3(wristTarget[pSide], scale3(sub3(S, shoulderPose[pSide]), 0.7)), stroke: info.stroke || 0, carry: Math.max(Math.max(0, Math.min(1, (1 - (info.ready ?? 1)) * 1.4 - 0.2)), info.swinging ? 0 : Math.max(0, Math.min(1, ((info.speed || 0) - 1.4) / 1.2))) * (1 - Math.min(1, (info.stroke || 0) * 3)) * (info.tap ? 0 : 1), dt, lite: frameNo % 2 === 1 && !info.fast, torso })
      st.prev = res
      st.last = res
      placeArm(pSide, res)
      paddleNow = res
    } else {
      const st = armState[pSide]
      const res = solveArm(rigs[pSide], childP(B["clavicle_" + pSide], B["upperarm_" + pSide]), wristTarget[pSide], chest, { pole: bendOf(pSide), poleW: 0.5, prev: st.bend || null, maxTurn: 12 * Math.max(dt, 1 / 240), torso, relax: relaxFor(pSide) })
      st.bend = res.bend
      st.last = res
      placeArm(pSide, res)
    }
    // the other arm: its hand where the pose puts it (on the handle above the first for a
    // two-handed shot), the wrist relaxed and the forearm turned the way a resting one is
    if (!holdArms) {
      const st = armState[oSide]
      const S = childP(B["clavicle_" + oSide], B["upperarm_" + oSide])
      // (the pose's hand kept where it is against its own shoulder, mostly: this body's shoulders
      // are broader than the pose's skeleton; less so for a hand by the paddle's throat)
      const nearP = Math.hypot(pose.wristO.x - pose.wristP.x, pose.wristO.y - pose.wristP.y, pose.wristO.z - pose.wristP.z) < 0.2
      let target = add3(wristTarget[oSide], scale3(sub3(S, shoulderPose[oSide]), nearP ? 0.2 : 0.7))
      let H = null
      if (paddleNow && info.two) {
        const gO = tpl.grip[oSide]
        H = qmul(frameOf(paddleNow.axis, scale3(paddleNow.normal, -1)), qinv(gO.q))
        const gripPt = sub3(pose.paddle.face, scale3(paddleNow.axis, FACE_FROM_GRIP - TOP_HAND))
        target = sub3(gripPt, qrot(H, scale3(gO.p, s)))
      }
      const res = solveArm(rigs[oSide], S, target, chest, { pole: bendOf(oSide), poleW: 0.45, prev: st.bend || null, maxTurn: (info.fast ? 30 : 12) * Math.max(dt, 1 / 240), H, torso, relax: relaxFor(oSide), lite: frameNo % 2 === 1, elbow: H || info.fist ? null : RELAXED_ELBOW })
      st.bend = res.bend
      st.last = res
      placeArm(oSide, res)
    }

    // legs: ankles over the pose's feet, at the model's own ankle height
    const ankleH = tpl.ankleH * s
    const feet = { l: pose.footL, r: pose.footR }
    const knees = { l: pose.kneeL, r: pose.kneeR }
    const hips = { l: pose.hipL, r: pose.hipR }
    for (const sd of ["l", "r"]) {
      const L = limbs[sd].leg
      const f = feet[sd]
      const th = B["thigh_" + sd]
      const ca = B["calf_" + sd]
      const ft = B["foot_" + sd]
      const rootP = worldP(th)
      const target = { x: f.x, y: f.y + ankleH, z: f.z }
      // (a foot pinned on the ball of the foot, motion matching: this model's own ball of the
      // foot goes exactly there, whatever its foot's length; the heel turns round it)
      if (f.pin?.ball) {
        const p0 = f.pitch || 0
        const fw = { x: Math.sin(f.yaw) * Math.cos(p0), y: -Math.sin(p0), z: Math.cos(f.yaw) * Math.cos(p0) }
        const fu = { x: Math.sin(f.yaw) * Math.sin(p0), y: Math.cos(p0), z: Math.cos(f.yaw) * Math.sin(p0) }
        const off = qrot(aimDelta(FWD, UPV, fw, fu), scale3(sub3(rest["ball_" + sd].wp, rest["foot_" + sd].wp), s))
        target.x = f.pin.x - off.x
        target.z = f.pin.z - off.z
      }
      const ankleP = { x: f.x, y: f.y + BODY.ankle, z: f.z }
      const pole = sub3(knees[sd], scale3(add3(hips[sd], ankleP), 0.5))
      const ik = solveLimb(rootP, target, L.l1, L.l2, pole, 1.06)
      const upd = norm(sub3(ik.mid, rootP))
      const lod = norm(sub3(ik.end, ik.mid))
      const n = bendAxis(upd, lod, pole)
      ca.position.copy(restLp["calf_" + sd]).multiplyScalar(ik.stretch)
      ft.position.copy(restLp["foot_" + sd]).multiplyScalar(ik.stretch)
      setWorldQ(th, qmul(aimDelta(L.th, L.thN, upd, n), rest["thigh_" + sd].wq))
      setWorldQ(ca, qmul(aimDelta(L.ca, L.caN, lod, n), rest["calf_" + sd].wq))
      // the foot: flat on the court (or as the step tips it), pointing along its yaw
      const p = f.pitch || 0
      const fwd = { x: Math.sin(f.yaw) * Math.cos(p), y: -Math.sin(p), z: Math.cos(f.yaw) * Math.cos(p) }
      const fup = { x: Math.sin(f.yaw) * Math.sin(p), y: Math.cos(p), z: Math.cos(f.yaw) * Math.sin(p) }
      setWorldQ(ft, qmul(aimDelta(FWD, UPV, fwd, fup), rest["foot_" + sd].wq))
    }
    root.updateMatrixWorld(true)
    updateFace(info, dt)
    updateSway(dt)
  }

  // ---- the face: blinks, focus, effort, a smile, a shout (morph targets) ----
  const faceMeshes = [body, ...attach.filter((m) => m.morphTargetDictionary && m !== body)].filter((m) => m?.morphTargetDictionary)
  const faceW = { blink: 0, smile: 0, effort: 0, shout: 0 }
  let blinkIn = 1.5 + hash01(look.name || skinHex + hairHex) * 3
  let blinkT = -1
  let faceSeed = hash01((look.name || "") + kind) * 1000
  let sweat = 0
  const updateFace = (info, dt) => {
    // sweat builds through long rallies (face.js), on this athlete's own skin
    if (fd.sweat) {
      sweat = stepSweat(sweat, { speed: info.speed, stroke: info.stroke, between: info.between }, dt)
      sweatU.value = sweat
    }
    if (!faceMeshes.length) return
    // a blink every 2 to 6 seconds (sometimes two), quick to close, a little slower to open
    blinkIn -= dt
    if (blinkIn <= 0 && blinkT < 0) {
      blinkT = 0
      faceSeed = (faceSeed * 9301 + 49297) % 233280
      const r = faceSeed / 233280
      blinkIn = r < 0.15 ? 0.32 : 2 + r * 4
    }
    let blink = 0
    if (blinkT >= 0) {
      blinkT += dt
      blink = blinkT < 0.06 ? blinkT / 0.06 : blinkT < 0.1 ? 1 : Math.max(0, 1 - (blinkT - 0.1) / 0.1)
      if (blinkT > 0.2) blinkT = -1
    }
    // what the face is doing: celebrating (a smile; a shout with both arms up), sulking (a
    // frown), working (effort through a hard swing; focus while the ball comes)
    // (face.js: a smile after a point, a grimace after an error, determination before a serve)
    const want = faceTargets(info)
    for (const k of ["smile", "shout", "effort"]) faceW[k] += (want[k] - faceW[k]) * Math.min(1, dt * (k === "effort" && want[k] > faceW[k] ? 14 : 6))
    // (relaxed upper lids rest a little over the iris: wide-open eyes stare)
    faceW.blink = Math.max(blink, 0.16 + faceW.effort * 0.15)
    for (const m of faceMeshes) {
      const dict = m.morphTargetDictionary
      for (const k of Object.keys(faceW)) if (dict[k] !== undefined) m.morphTargetInfluences[dict[k]] = faceW[k]
    }
  }

  // ---- what swings: the skirt's hem, a ponytail or long hair (critically damped springs
  // driven by how their anchor accelerates: the hips, a point behind the head) ----
  const springs = []
  const addSpring = (u, anchor, mesh, { hz, damp, max, flare = null, gain = 1 }) => springs.push({ u, anchor, mesh, hz, damp, max, flare, gain, p: null, v: null, x: new THREE.Vector3(), xv: new THREE.Vector3() })
  const tmpA = new THREE.Vector3()
  const tmpB = new THREE.Vector3()
  const tmpM = new THREE.Matrix4()
  const tmpM3 = new THREE.Matrix3()
  if (skirtSway) addSpring(skirtSway, () => B.pelvis.localToWorld(tmpA.set(0, -0.18 / s, 0)), outfit, { hz: 2.6, damp: 0.45, max: 0.06, flare: () => B.pelvis.getWorldPosition(tmpA), gain: 0.55 })
  if (hairSway && hairMeshW) addSpring(hairSway, () => head.localToWorld(tmpA.set(0, -0.02 / s, -0.1 / s)), hairMeshW, { hz: 1.7, damp: 0.3, max: 0.1, gain: 0.8 })
  const updateSway = (dt) => {
    if (!springs.length || dt <= 0 || (typeof window !== "undefined" && window.__pbNoSway)) return
    const h = Math.min(dt, 1 / 30)
    for (const sp of springs) {
      const a = sp.anchor().clone()
      if (!sp.p || dt > 0.2 || a.distanceTo(sp.p) > 1) {
        // (a new start, or a teleport between points: no swing)
        sp.p = a.clone()
        sp.v = new THREE.Vector3()
        sp.x.set(0, 0, 0)
        sp.xv.set(0, 0, 0)
      }
      const v = a.clone().sub(sp.p).divideScalar(dt)
      const acc = v.clone().sub(sp.v).divideScalar(dt).clampLength(0, 60)
      sp.p.copy(a)
      sp.v.copy(v)
      // x'' = -w^2 x - 2 zeta w x' - acc (the tips lag behind what the anchor does)
      const w = 2 * Math.PI * sp.hz
      const f = sp.x.clone().multiplyScalar(-w * w).addScaledVector(sp.xv, -2 * sp.damp * w).addScaledVector(acc, -sp.gain)
      sp.xv.addScaledVector(f, h)
      sp.x.addScaledVector(sp.xv, h)
      sp.x.y = Math.min(sp.x.y, 0.02) // (never up through the head or the waist)
      if (sp.x.length() > sp.max) {
        sp.x.setLength(sp.max)
        sp.xv.multiplyScalar(0.5)
      }
      // into the mesh's own space (a direction: its world matrix's rotation and scale undone)
      tmpM.copy(sp.mesh.matrixWorld).invert()
      tmpM3.setFromMatrix4(tmpM)
      sp.u.pkSway.value.copy(sp.x).applyMatrix3(tmpM3)
      if (sp.flare) {
        // (a skirt flares out with speed, a twirl or a jump)
        const c = sp.mesh.worldToLocal(tmpB.copy(sp.flare()))
        const sideways = Math.hypot(v.x, v.z)
        sp.u.pkFlare.value.set(c.x, c.y, c.z, Math.min(0.035, sideways * 0.006 + Math.abs(v.y) * 0.02) / s)
      }
    }
  }

  const setShadows = (on) => {
    body.castShadow = on
    outfit.castShadow = on
    if (paddle) paddle.castShadow = on
  }

  // (materials and the hair, paddle and garment geometry are shared and stay loaded)
  const dispose = () => {
    outfit.geometry.dispose()
    skeleton.dispose()
  }

  // (tests) where the paddle face's center and the soles are
  const probe = () => {
    const face = withPaddle ? toV(paddleHolder.localToWorld(tv.set(0, FACE_FROM_GRIP, 0))) : null
    const soles = ["l", "r"].map((sd) => worldP(B["foot_" + sd]).y - tpl.ankleH * s)
    // (the balls of the feet: what stays put on the court while a foot is planted)
    const balls = ["l", "r"].map((sd) => worldP(B["ball_" + sd]))
    return { face, soles, balls }
  }
  // (tests) the upper body's bones (world rotations), and where the paddle's handle sits
  // against the palm (it should never move: the paddle is held, not floating)
  const UPPER = ["spine_01", "spine_02", "spine_03", "neck_01", "Head", "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r"]
  const probeUpper = () => {
    const quats = Object.fromEntries(UPPER.map((n) => [n, worldQ(B[n])]))
    let grip = null
    if (withPaddle) {
      const g = tpl.grip[paddleSide]
      const want = toV(B["hand_" + paddleSide].localToWorld(tv.set(g.p.x, g.p.y, g.p.z)))
      const got = toV(paddleHolder.getWorldPosition(tv))
      grip = Math.hypot(want.x - got.x, want.y - got.y, want.z - got.z)
    }
    return { quats, grip, hand: worldP(B["hand_" + paddleSide]) }
  }

  // (tests) the arms, measured on the drawn bones (armMetrics: degrees and meters)
  const probeArms = () => {
    const get = (n) => ({ p: worldP(B[n]), q: worldQ(B[n]) })
    const bones = {}
    for (const n of ARM_PROBE) if (B[n]) bones[n] = get(n)
    return armMetrics(bones, tpl.armRef, { paddleSide: withPaddle ? paddleSide : null, stretch: { l: B.lowerarm_l.position.length() / restLp.lowerarm_l.length(), r: B.lowerarm_r.position.length() / restLp.lowerarm_r.length() } })
  }

  let vertices = 0
  for (const p of [...parts, ...attach]) vertices += p.geometry.attributes.position.count
  // (tests) the face's expression weights and the springs' offsets
  const probeLife = () => ({ face: { ...faceW }, sway: springs.map((sp) => sp.x.length()) })
  const disposeOwn = () => {
    // (the materials made for this athlete alone: a swinging skirt's, swinging hair's)
    if (skirtSway) outfit.material.dispose()
    if (kitMesh) kitMesh.material.dispose()
    body.material.dispose()
    if (hairMeshW) hairMeshW.material.dispose()
  }
  return { group: root, apply, setShadows, dispose: () => (dispose(), disposeOwn()), probe, probeUpper, probeLife, probeArms, debug: { paddle: paddleHolder, bones: B, arm: () => armState[paddleSide].last }, blobs: [], vertices, skinned: true, detail: tpl === assets.hi?.[kind] ? "high" : "medium", face: face?.id || null }
}

// An athlete (rig.js createFigure's interface). On High, the detailed bodies: if they aren't
// in yet the Medium ones stand in and the athlete swaps itself over, in place, when they
// arrive (the same group, posed from the next frame on).
// (players v3: a photo face's shape and first texture; resolves true once both are in)
const faceReady = (look, lod) => {
  if (!look?.face || assets?.set !== "mh") return Promise.resolve(false)
  return loadFaces().then((mf) => {
    const f = mf?.faces?.[look.face]
    if (!f || f.body !== bodyOf(look)) return false
    return Promise.all([loadFaceShape(look.face), faceTexture(look.face, "med"), lod === "hi" ? faceTexture(look.face, "hi") : null]).then(([s, t]) => !!(s && t))
  })
}
const isHi = (d) => d === "high" || d === "ultra"
export const createAthlete = (look = {}, opts = {}) => {
  const detail = isHi(opts.detail) && assets.setInfo?.hi ? opts.detail : "medium"
  let inner = buildAthlete(look, opts, detail)
  const wantFace = !!look.face && assets.set === "mh" && (!facesInfo || !!faceOf(look))
  const faceDone = () => !wantFace || inner.face === look.face
  if ((!isHi(detail) || inner.detail === "high") && faceDone()) return inner
  const group = new THREE.Group()
  group.add(inner.group)
  let disposed = false
  let shadowsOn = !!opts.shadows
  let lastPose = null // (posed again on the new body: a seated umpire is posed only once)
  const fig = {
    group,
    apply: (pose, dt) => {
      lastPose = pose
      inner.apply(pose, dt)
    },
    setShadows: (on) => {
      shadowsOn = on
      inner.setShadows(on)
    },
    dispose: () => {
      disposed = true
      inner.dispose()
    },
    probe: () => inner.probe(),
    probeUpper: () => inner.probeUpper(),
    probeLife: () => inner.probeLife(),
    probeArms: () => inner.probeArms(),
    get debug() {
      return inner.debug
    },
    blobs: [],
    get vertices() {
      return inner.vertices
    },
    get detail() {
      return inner.detail
    },
    get face() {
      return inner.face
    },
    skinned: true,
  }
  // built again (posed as it was) when something better arrives: the High body, a photo face
  const upgrade = () => {
    if (disposed) return
    const next = buildAthlete(look, { ...opts, shadows: shadowsOn }, detail)
    if (next.detail === inner.detail && next.face === inner.face) return next.dispose()
    group.remove(inner.group)
    inner.dispose()
    inner = next
    group.add(inner.group)
    if (lastPose) inner.apply(lastPose, 1 / 60)
  }
  if (isHi(detail) && inner.detail !== "high") {
    hiWaiters.add(() => {
      if (!assets.hi) return
      upgrade()
    })
    loadHi()
  }
  if (!faceDone()) faceReady(look, isHi(detail) ? "hi" : "med").then((ok) => ok && upgrade())
  return fig
}
// (tests and the Locker Room: preload a face, so an athlete made after has it at once)
export const preloadFace = (look, detail = "medium") => faceReady(look, isHi(detail) ? "hi" : "med")
