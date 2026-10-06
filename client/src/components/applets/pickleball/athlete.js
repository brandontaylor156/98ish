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
// The assets (about 2.2 MB: mh-m/mh-f/mh-hair.glb and moves.json, in public/assets/pickleball/;
// mh-*-hi.glb only on High;
// the older Quaternius files are about 0.8 MB more, only fetched if those fail) load the first time Pickleball
// opens. Until they're in (or if they fail, or on Low quality) rig.js's simple figures
// stand in; createAthlete has the same interface as rig.js's createFigure.

import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { BODY } from "./anim.js"
import { SKIN } from "./looks.js"
import { aimDelta, additiveMove, bendAxis, decodeMoves, frameOf, LAYERS, layerTargets, limitQuat, Q, qaxis, qinv, qmul, qrot, qslerp, solveLimb, stepLayers, clipTime, norm } from "./retarget.js"
import { BUILD_SCALE, buildGarment, buildSkirt, landmarks, prepareBody, radiusProfile, reshapeBody, visibleIndex } from "./outfit.js"
import { loadMotion } from "./mm/runtime.js"
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
  // the materials' textures (shared by every instance)
  const ud = body.material.userData || {}
  // (the glTF normal map: three's loader flips its y; keep that, at the strength wanted)
  const maps = { skin: body.material.map, normal: body.material.normalMap || null, normalScale: body.material.normalScale ? body.material.normalScale.clone().multiplyScalar(0.85) : null, brows: meshes.Brows.material.map, eyes: meshes.Eyes.material, ref: srgb(ud.refSkin || "#a87551"), hueMix: ud.hueMix ?? 0.45, gain: ud.skinGain ?? 0.86 }
  maps.skin.anisotropy = 4
  if (maps.normal) maps.normal.anisotropy = 4
  // the eyes: wet and bright (a little light of their own so the whites never go gray)
  maps.eyes.roughness = 0.12
  maps.eyes.emissive = new THREE.Color(1, 1, 1)
  maps.eyes.emissiveMap = maps.eyes.map
  maps.eyes.emissiveIntensity = 0.12
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
  // the facial expressions (morph targets on the face and the brows/lashes, if the file has them)
  const faces = { body: body.morphTargetDictionary || null, brows: meshes.Brows.morphTargetDictionary || null }
  const armRef = armReference(rest)
  const t = { set: set.id, armRef, headScale: ud.headScale ?? set.headScale, scene, rest, prepared, marks, scale, ankleH, head, maps, grip, curl, spread, garments: {}, bones, onHead, joints, variants: {}, faces }
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
const variantOf = (tpl, build, full) => {
  const key = BUILD_SCALE[build] ? build : "regular"
  if (tpl.variants[key]) return tpl.variants[key]
  let prepared = tpl.prepared
  let position = full.attributes.position
  if (key !== "regular") {
    const moved = reshapeBody(tpl.prepared, tpl.joints, tpl.marks, BUILD_SCALE[key])
    prepared = { ...tpl.prepared, position: moved }
    position = new THREE.BufferAttribute(moved, 3)
  }
  tpl.variants[key] = { key, prepared, position, garments: key === "regular" ? tpl.garments : {}, bodies: {} }
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
const bodyUnder = (tpl, full, look, v) => {
  const key = garmentKinds(look).join("|")
  if (!v.bodies[key]) {
    const g = new THREE.BufferGeometry()
    for (const [name, attr] of Object.entries(full.attributes)) g.setAttribute(name, name === "position" ? v.position : attr)
    // (the face's expressions: offsets, the same for every build)
    g.morphAttributes = full.morphAttributes
    g.morphTargetsRelative = full.morphTargetsRelative
    g.setIndex(new THREE.BufferAttribute(visibleIndex(garmentKinds(look), v.prepared, tpl.marks), 1))
    v.bodies[key] = g
  }
  return v.bodies[key]
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
    parts.push({ position: g.position, normal: g.normal, color, skinIndex: g.skinIndex, skinWeight: g.skinWeight, index: g.index, sway: g.sway || null })
  }
  // a rigid piece (a three.js geometry in rest world space) on one bone
  const rigid = (geo, bone) => {
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
    parts.push({ position: src.attributes.position.array, normal: src.attributes.normal.array, color: src.attributes.color.array, skinIndex, skinWeight, index })
  }
  const shirt = look.shirt || "#1a9fb0"
  const trim = look.trim || "#ffffff"
  const bottom = look.bottomColor || "#23395d"
  const socks = look.socks || "#ffffff"
  const kinds = garmentKinds(look)
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
  for (const side of ["l", "r"]) rigid(sneakerGeometry(tpl, side, look), "foot_" + side)
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
    rigid(g, "Head")
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
const skinMaterial = (maps, hex) => {
  const ref = maps.ref
  const lum = ref.r * 0.2126 + ref.g * 0.7152 + ref.b * 0.0722
  const m = new THREE.MeshStandardMaterial({ map: maps.skin, normalMap: maps.normal, roughness: 0.55, metalness: 0 })
  if (maps.normal && maps.normalScale) m.normalScale.copy(maps.normalScale)
  m.defines = { PK_WRAP: "vec3(0.5, 0.3, 0.24)" }
  const uniforms = { skinTone: { value: srgb(hex).multiplyScalar(maps.gain) }, refHue: { value: new THREE.Vector3(ref.r / lum, ref.g / lum, ref.b / lum) }, refLum: { value: lum }, hueMix: { value: maps.hueMix }, skinWarm: { value: skinWarmth(hex) } }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    athleteLight(sh, { rim: 0.22 })
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 skinTone;\nuniform vec3 refHue;\nuniform float refLum;\nuniform float hueMix;\nuniform vec3 skinWarm;").replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      {
        float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 hue = diffuseColor.rgb / max(l, 1e-4);
        diffuseColor.rgb = skinTone * (l / refLum) * mix(vec3(1.0), hue / refHue, hueMix);
        // warmth (light under the skin), most for pale skin, which goes gray under cool lights
        diffuseColor.rgb *= skinWarm;
      }`
    )
  }
  m.customProgramCacheKey = () => "pk-skin"
  return m
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
const athleteMaterial = (params, { wrap = "vec3(0.3)", rim = 0.12, key = "pk-cloth", sway = null } = {}) => {
  const m = new THREE.MeshStandardMaterial(params)
  m.defines = { PK_WRAP: wrap }
  m.onBeforeCompile = (sh) => {
    athleteLight(sh, { rim })
    if (!sway) return
    sh.uniforms.pkSway = sway.pkSway
    sh.uniforms.pkFlare = sway.pkFlare
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float pkSwayW;\nuniform vec3 pkSway;\nuniform vec4 pkFlare;")
      .replace("#include <skinning_vertex>", "#include <skinning_vertex>\n\t{\n\t\tvec3 pkOut = vec3( transformed.x - pkFlare.x, 0.0, transformed.z - pkFlare.z );\n\t\ttransformed += ( pkSway + pkOut / max( length( pkOut ), 1e-4 ) * pkFlare.w ) * pkSwayW;\n\t}")
  }
  m.customProgramCacheKey = () => key + (sway ? "-sway" : "")
  if (sway) m.userData.sway = sway
  return m
}
let outfitMaterial = null
const outfitMat = () => (outfitMaterial ||= athleteMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }, { wrap: "vec3(0.32, 0.3, 0.3)", rim: 0.1 }))

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
  const mat = new THREE.MeshStandardMaterial({ map: paddleTexture(a, b, design), vertexColors: true, roughness: 0.5, metalness: 0.05 })
  const out = { geo, mat }
  assets.paddles.set(key, out)
  return out
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
    }
  })
  // caps: the bottom and the top (where the ankle goes in)
  const top = rings.length * N
  pos.push(cx, sole0 + 0.002, mz, cx, sole0 + 0.032 + 0.062, mz - L * 0.12)
  col.push(cSole.r, cSole.g, cSole.b, cUpper.r, cUpper.g, cUpper.b)
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
  const tpl = (detail === "high" && assets.hi?.[kind]) || assets[kind]
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
  body.material = shared(`skin|${kind}|${skinHex}`, () => skinMaterial(tpl.maps, skinHex))
  // (the MakeHuman brows and lashes are cut out of their texture's alpha)
  const cutout = tpl.set === "mh"
  const browMat = shared(`brows|${kind}|${hairHex}|${tpl.set}`, () => new THREE.MeshStandardMaterial({ map: tpl.maps.brows, color: tint(hairHex, REF_HAIR), roughness: 0.9, ...(cutout ? { alphaTest: 0.3, side: THREE.DoubleSide } : {}) }))

  // everything worn but the hair: one more skinned mesh on the same skeleton
  const variant = variantOf(tpl, look.build, body.geometry)
  body.geometry = bodyUnder(tpl, body.geometry, look, variant)
  body.updateMorphTargets()
  const outfitGeo = outfitGeometry(tpl, look, variant)
  // (a skirt swings: this athlete's own material, for its spring's uniforms)
  const skirtSway = outfitGeo.userData.swings ? swayUniforms() : null
  const outfit = new THREE.SkinnedMesh(outfitGeo, skirtSway ? athleteMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }, { wrap: "vec3(0.32, 0.3, 0.3)", rim: 0.1, sway: skirtSway }) : outfitMat())
  outfit.bind(skeleton, body.bindMatrix)
  body.parent.add(outfit)
  const parts = [body, outfit]

  // the head: bigger, with eyes, brows and hair
  const head = B.Head
  head.scale.setScalar(tpl.headScale)
  const attach = []
  for (const [name, mat] of [
    ["Eyes", tpl.maps.eyes],
    ["Brows", browMat],
  ]) {
    meshes[name].removeFromParent()
    const m = new THREE.Mesh(meshes[name].geometry, mat)
    m.matrixAutoUpdate = false
    m.matrix.copy(tpl.onHead[name])
    head.add(m)
    attach.push(m)
  }
  const hairName = hairFor(look, kind)
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
      m = athleteMaterial({ map: src.material.map, color: tint(hairHex, REF_HAIR), roughness: 0.66, side: THREE.DoubleSide, ...(cut ? { alphaTest: 0.42, alphaToCoverage: true } : {}) }, { wrap: "vec3(0.35)", rim: 0.16, key: "pk-hair", sway: hairSway })
    } else m = shared(`hair|${src.material.map.uuid}|${hairHex}`, () => athleteMaterial({ map: src.material.map, color: tint(hairHex, REF_HAIR), roughness: 0.66, side: THREE.DoubleSide, ...(cut ? { alphaTest: 0.42, alphaToCoverage: true } : {}) }, { wrap: "vec3(0.35)", rim: 0.16, key: "pk-hair" }))
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
  const capSrc = hairSrc && tpl.set === "mh" && !hatted && hairName !== "Hair_Buzz" ? hairMesh("Hair_Buzz", kind) : null
  if (capSrc) wearHair(capSrc, false, { cap: true })
  if (hairSrc) wearHair(hairSrc, hatted)
  const beard = look.beard ? hairMesh("Hair_Beard", kind) : null
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
  const faceMeshes = [body, attach.find((m) => m.morphTargetDictionary && m !== body)].filter((m) => m?.morphTargetDictionary)
  const faceW = { blink: 0, smile: 0, effort: 0, shout: 0 }
  let blinkIn = 1.5 + hash01(look.name || skinHex + hairHex) * 3
  let blinkT = -1
  let faceSeed = hash01((look.name || "") + kind) * 1000
  const updateFace = (info, dt) => {
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
    const mood = info.mood
    const cheer = mood?.kind === "cheer"
    const sulk = mood?.kind === "sulk"
    const swingW = info.stroke || 0
    const want = {
      smile: cheer ? (mood.variant === 2 ? 0.35 : 0.85) : info.between && !mood ? 0.12 : 0,
      shout: cheer ? (mood.variant === 2 ? 0.75 : mood.variant === 0 ? 0.45 : 0) : 0,
      effort: sulk ? 0.45 : swingW > 0.2 ? (info.fast ? 0.75 : 0.4) * swingW : info.swinging || (info.ready || 0) > 0.5 ? 0.18 : 0,
    }
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
    if (hairMeshW) hairMeshW.material.dispose()
  }
  return { group: root, apply, setShadows, dispose: () => (dispose(), disposeOwn()), probe, probeUpper, probeLife, probeArms, debug: { paddle: paddleHolder, bones: B, arm: () => armState[paddleSide].last }, blobs: [], vertices, skinned: true, detail: tpl === assets.hi?.[kind] ? "high" : "medium" }
}

// An athlete (rig.js createFigure's interface). On High, the detailed bodies: if they aren't
// in yet the Medium ones stand in and the athlete swaps itself over, in place, when they
// arrive (the same group, posed from the next frame on).
export const createAthlete = (look = {}, opts = {}) => {
  const detail = opts.detail === "high" && assets.setInfo?.hi ? "high" : "medium"
  let inner = buildAthlete(look, opts, detail)
  if (detail !== "high" || inner.detail === "high") return inner
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
    skinned: true,
  }
  hiWaiters.add(() => {
    if (disposed || !assets.hi) return
    const next = buildAthlete(look, { ...opts, shadows: shadowsOn }, "high")
    group.remove(inner.group)
    inner.dispose()
    inner = next
    group.add(inner.group)
    if (lastPose) inner.apply(lastPose, 1 / 60)
  })
  loadHi()
  return fig
}
