// Pickleball 98: the skinned athletes. Real character models (Quaternius' Universal Base
// Characters, CC0: a 65-bone humanoid skeleton, faces, eyes, hairstyles) dressed in kits
// grown from the body (outfit.js), holding a modeled paddle, and posed every frame from the
// joints anim.js works out (retarget.js does the math): the pelvis, spine, neck and head
// turn to the pose's frames; arms and legs are solved with two-bone IK on the model's own
// bones, so the feet stay planted and the paddle face lands exactly on the contact point
// physics computed; fingers curl round the grip; small motion-captured clips (Quaternius'
// Universal Animation Library) breathe and bounce on top.
//
// The assets (about 0.9 MB, in public/assets/pickleball/) load the first time Pickleball
// opens. Until they're in (or if they fail, or on Low quality) rig.js's simple figures
// stand in; createAthlete has the same interface as rig.js's createFigure.

import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { BODY } from "./anim.js"
import { SKIN } from "./looks.js"
import { aimDelta, additiveMove, bendAxis, decodeMoves, frameOf, gripSide, LAYERS, layerTargets, Q, qaxis, qinv, qmul, qrot, qslerp, solveLimb, stepLayers, swingTwist, twistAngle, clipTime, norm } from "./retarget.js"
import { buildGarment, buildSkirt, landmarks, prepareBody, radiusProfile, visibleIndex } from "./outfit.js"

const BASE = "/assets/pickleball/"
const HEAD_SCALE = 1.1 // a slightly bigger head: friendlier, and it reads at TV distance

// ---- loading (once) ----
let assets = null
let loading = null
export const athletesReady = () => !!assets
export const loadAthletes = () => {
  if (loading) return loading
  loading = (async () => {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const [m, f, hair, moves] = await Promise.all([
      loader.loadAsync(BASE + "athlete-m.glb"),
      loader.loadAsync(BASE + "athlete-f.glb"),
      loader.loadAsync(BASE + "hair.glb"),
      fetch(BASE + "moves.json").then((r) => {
        if (!r.ok) throw new Error("moves " + r.status)
        return r.json()
      }),
    ])
    const hairs = {}
    hair.scene.traverse((o) => {
      if (o.isMesh) hairs[o.name] = o
    })
    assets = { m: template(m), f: template(f), hairs, moves: decodeMoves(moves), paddles: new Map() }
    return assets
  })()
  loading.catch(() => {
    loading = null // a later open can try again
  })
  return loading
}

// ---- three <-> retarget.js ----
const toQ = (q) => Q(q.x, q.y, q.z, q.w)
const toV = (v) => ({ x: v.x, y: v.y, z: v.z })
const tq = new THREE.Quaternion()
const tq2 = new THREE.Quaternion()
const tv = new THREE.Vector3()

// ---- a body, ready to clone ----
const template = (gltf) => {
  const scene = gltf.scene
  scene.updateMatrixWorld(true)
  const meshes = {}
  scene.traverse((o) => {
    if (o.isSkinnedMesh) meshes[o.name] = o
  })
  const body = meshes.Body
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
  const maps = { skin: body.material.map, normal: body.material.normalMap, brows: meshes.Brows.material.map, eyes: meshes.Eyes.material }
  maps.skin.anisotropy = 4
  // the grip: where the paddle sits in each hand, in that hand bone's own space
  const grip = {}
  for (const side of ["l", "r"]) {
    const hand = rest["hand_" + side]
    const finger = norm(sub3(rest["middle_01_" + side].wp, hand.wp))
    const thumb0 = sub3(rest["thumb_01_" + side].wp, hand.wp)
    // the palm faces away from the back of the hand; the thumb side is across the palm
    let palm = norm(cross3(finger, thumb0))
    if (side === "r") palm = scale3(palm, -1)
    const across = norm(cross3(palm, finger)) // toward the thumb (checked: thumb side positive)
    const acrossS = dot3(across, thumb0) > 0 ? across : scale3(across, -1)
    // the handle runs across the palm toward the thumb, tipped toward the fingers
    const axis = norm(add3(scale3(acrossS, 0.86), scale3(finger, 0.5)))
    const normal = norm(sub3(palm, scale3(axis, dot3(palm, axis))))
    const center = add3(add3(hand.wp, scale3(finger, 0.072)), scale3(palm, 0.028))
    const handInv = qinv(hand.wq)
    const paddleRest = frameOf(axis, normal) // y = axis, z = normal
    grip[side] = { q: qmul(handInv, paddleRest), p: qrot(handInv, sub3(center, hand.wp)), palmLocal: qrot(handInv, palm) }
  }
  // which way each finger bone curls (in its own space): toward the palm
  const curl = {}
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
      }
  }
  // the eyes and brows only follow the head: drawn as plain meshes on the Head bone (skinning
  // them cost two more skinned draws per athlete); their rest transform in its space
  const toHead = new THREE.Matrix4().copy(bones.Head.matrixWorld).invert()
  const onHead = { Eyes: toHead.clone().multiply(meshes.Eyes.matrixWorld), Brows: toHead.clone().multiply(meshes.Brows.matrixWorld) }
  const t = { scene, rest, prepared, marks, scale, ankleH, head, maps, grip, curl, garments: {}, bones, onHead }
  return t
}
const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const add3 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scale3 = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s })
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross3 = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })

// a garment's geometry for a body (built once, shared)
const garmentArrays = (tpl, kind) => {
  if (tpl.garments[kind]) return tpl.garments[kind]
  let g
  if (kind === "skirt") {
    const names = tpl.prepared.bones
    g = buildSkirt(tpl.marks, radiusProfile(tpl.prepared, tpl.marks), { pelvis: names.indexOf("pelvis"), thigh_l: names.indexOf("thigh_l"), thigh_r: names.indexOf("thigh_r") })
  } else g = buildGarment(kind, tpl.prepared, tpl.marks)
  tpl.garments[kind] = g
  return g
}

// which garments a look wears (outfitGeometry builds them; the skirt is extra)
const garmentKinds = (look) => [look.bottom === "skirt" ? "briefs" : "shorts", look.shirtStyle === "tank" ? "tank" : look.shirtStyle === "polo" ? "polo" : "tee", "socks", "shoes"]
// the body without the skin its clothes hide: the same vertices, a shorter index (shared by
// everyone dressed the same way)
const bodyUnder = (tpl, full, look) => {
  const key = garmentKinds(look).join("|")
  tpl.bodies ||= {}
  if (!tpl.bodies[key]) {
    const g = new THREE.BufferGeometry()
    for (const [name, attr] of Object.entries(full.attributes)) g.setAttribute(name, attr)
    g.setIndex(new THREE.BufferAttribute(visibleIndex(garmentKinds(look), tpl.prepared, tpl.marks), 1))
    tpl.bodies[key] = g
  }
  return tpl.bodies[key]
}

// Everything a look wears but its hair, as ONE skinned mesh (one draw call): the clothes
// (kit colors, trim and accents baked into vertex colors), the sneakers (on the foot bones)
// and any hat or glasses (on the Head bone). All in the rest pose's world space.
const outfitGeometry = (tpl, look) => {
  const bones = tpl.prepared.bones
  const parts = [] // { position, normal, color, skinIndex, skinWeight, index }
  const C = (hex) => srgb(hex)
  const garment = (kind, base, trim, accent = trim) => {
    const g = garmentArrays(tpl, kind)
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
    }
    parts.push({ position: g.position, normal: g.normal, color, skinIndex: g.skinIndex, skinWeight: g.skinWeight, index: g.index })
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
  if (look.bottom === "skirt") {
    garment("briefs", bottom, bottom)
    garment("skirt", bottom, trim)
  } else garment("shorts", bottom, bottom === trim ? shirt : trim)
  garment(look.shirtStyle === "tank" ? "tank" : look.shirtStyle === "polo" ? "polo" : "tee", shirt, trim)
  garment("socks", look.socks || "#ffffff", look.socks || "#ffffff")
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
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni)
  let ov = 0
  let oi = 0
  for (const p of parts) {
    const n = p.position.length / 3
    position.set(p.position, ov * 3)
    normal.set(p.normal, ov * 3)
    color.set(p.color, ov * 3)
    skinIndex.set(p.skinIndex, ov * 4)
    skinWeight.set(p.skinWeight, ov * 4)
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
  geo.setIndex(new THREE.BufferAttribute(index, 1))
  return geo
}

// ---- materials ----
const srgb = (hex) => new THREE.Color(hex) // (three converts sRGB hex to linear)
const REF_SKIN = srgb("#a87551") // the texture's average skin tone
const REF_HAIR = 0.27 // the gray hair textures' average (linear)
const tint = (hex, ref) => {
  const c = srgb(hex)
  if (typeof ref === "number") return c.multiplyScalar(1 / ref)
  return new THREE.Color(c.r / ref.r, c.g / ref.g, c.b / ref.b)
}
// skin: the texture's shading and detail, recolored to the look's skin tone (a plain tint
// would blow the texture's own warm tones up on pale skin)
const REF_LUM = REF_SKIN.r * 0.2126 + REF_SKIN.g * 0.7152 + REF_SKIN.b * 0.0722
const skinWarmth = (hex) => {
  const pale = Math.max(0, Math.min(1, (srgb(hex).getHSL({}).l - 0.45) / 0.4))
  return new THREE.Vector3(1.03 + 0.11 * pale, 0.99, 0.95 - 0.1 * pale)
}
const skinMaterial = (maps, hex) => {
  const m = new THREE.MeshStandardMaterial({ map: maps.skin, normalMap: maps.normal, roughness: 0.58, metalness: 0 })
  const uniforms = { skinTone: { value: srgb(hex).multiplyScalar(0.86) }, refHue: { value: new THREE.Vector3(REF_SKIN.r / REF_LUM, REF_SKIN.g / REF_LUM, REF_SKIN.b / REF_LUM) }, skinWarm: { value: skinWarmth(hex) } }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 skinTone;\nuniform vec3 refHue;\nuniform vec3 skinWarm;").replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      {
        float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 hue = diffuseColor.rgb / max(l, 1e-4);
        diffuseColor.rgb = skinTone * (l / ${REF_LUM.toFixed(5)}) * mix(vec3(1.0), hue / refHue, 0.45);
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
let outfitMaterial = null
const outfitMat = () => (outfitMaterial ||= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.DoubleSide }))

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
const paddleTexture = (a, b) => {
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
  const key = a + b
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
  const mat = new THREE.MeshStandardMaterial({ map: paddleTexture(a, b), vertexColors: true, roughness: 0.5, metalness: 0.05 })
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

// ---- hats and glasses (in the head's rest frame: y up, z forward, meters) ----
// (the materials only carry colors: outfitGeometry bakes these into vertex colors)
const accessories = (look, head) => {
  const g = new THREE.Group()
  const mats = { hat: { color: srgb(look.hatColor || "#ffffff") }, dark: { color: srgb("#16161a") }, lens: { color: srgb("#24323c") } }
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
  if (look.glasses) {
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
  const heelZ = foot.z - 0.078
  const toeZ = ball.z + 0.092
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
    const half = 0.039 + 0.018 * Math.sin(Math.min(1, u * 1.25) * Math.PI * 0.62)
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
  spiky: { m: "Hair_Buzzed", f: "Hair_BuzzedFemale" },
  bald: { m: null, f: null },
  curly: { m: "Hair_Buzzed", f: "Hair_Buns" },
  bun: { m: "Hair_Buns", f: "Hair_Buns" },
  ponytail: { m: "Hair_Long", f: "Hair_Long" },
  braid: { m: "Hair_Long", f: "Hair_Long" },
  long: { m: "Hair_Long", f: "Hair_Long" },
}
export const bodyOf = (look) => (look.body === "f" ? "f" : "m")
// Under a cap or a bucket hat only close-cropped hair stays inside it (the other styles'
// fringes and buns poke through the crown); long hair still hangs out the back.
const HATS = ["cap", "capBack", "bucket"]
export const hairFor = (look, kind = bodyOf(look)) => {
  const name = (HAIR[look.hair || "short"] || HAIR.short)[kind]
  const hatted = HATS.includes(look.hat)
  if (!name || !hatted || name === "Hair_Long") return name
  // (a bun becomes a tail out of the back of the cap)
  if (kind === "f" && name === "Hair_Buns") return "Hair_Long"
  return kind === "f" ? "Hair_BuzzedFemale" : "Hair_Buzzed"
}

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

// ---- an athlete ----
const DRIVEN_SPINE = ["spine_01", "spine_02", "spine_03"]
export const createAthlete = (look = {}, { shadows = false, withPaddle = true } = {}) => {
  const kind = bodyOf(look)
  const tpl = assets[kind]
  const root = new THREE.Group()
  const holder = cloneSkinned(tpl.scene)
  holder.scale.setScalar(tpl.scale)
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
  const s = tpl.scale

  // materials (shared between athletes who look alike)
  const skinHex = typeof look.skin === "number" ? SKIN[look.skin] || SKIN[2] : look.skin || SKIN[2]
  const hairHex = look.hairColor || "#2b1b0e"
  body.material = shared(`skin|${kind}|${skinHex}`, () => skinMaterial(tpl.maps, skinHex))
  const browMat = shared(`brows|${kind}|${hairHex}`, () => new THREE.MeshStandardMaterial({ map: tpl.maps.brows, color: tint(hairHex, REF_HAIR), roughness: 0.9 }))

  // everything worn but the hair: one more skinned mesh on the same skeleton
  body.geometry = bodyUnder(tpl, body.geometry, look)
  const outfit = new THREE.SkinnedMesh(outfitGeometry(tpl, look), outfitMat())
  outfit.bind(skeleton, body.bindMatrix)
  body.parent.add(outfit)
  const parts = [body, outfit]

  // the head: bigger, with eyes, brows and hair
  const head = B.Head
  head.scale.setScalar(HEAD_SCALE)
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
  const wearHair = (src, crop) => {
    const m = shared(`hair|${src.material.map.uuid}|${hairHex}`, () => new THREE.MeshStandardMaterial({ map: src.material.map, color: tint(hairHex, REF_HAIR), roughness: 0.72, side: THREE.DoubleSide }))
    const h = new THREE.Mesh(crop ? croppedHair(tpl, src, kind) : src.geometry, m)
    // (the file's node transform undoes the mesh compression's quantization)
    h.position.copy(src.position)
    h.quaternion.copy(src.quaternion)
    h.scale.copy(src.scale)
    head.add(h)
    attach.push(h)
  }
  if (hairName && assets.hairs[hairName]) wearHair(assets.hairs[hairName], hatted)
  if (look.beard && assets.hairs.Hair_Beard) wearHair(assets.hairs.Hair_Beard)

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

  // fingers: a fist round the grip, the other hand relaxed
  const setFingers = () => {
    for (const side of ["l", "r"]) {
      const fist = side === paddleSide && withPaddle
      for (const [name, axis] of Object.entries(tpl.curl)) {
        if (!name.endsWith("_" + side)) continue
        const thumb = name.startsWith("thumb")
        const k = +name.split("_")[1]
        const amount = fist ? (thumb ? [0.35, 0.45, 0.35][k - 1] : [1.25, 1.45, 0.9][k - 1]) : thumb ? 0.15 : [0.22, 0.38, 0.25][k - 1]
        const q = qmul(toQ(restLq[name]), qaxis(axis, amount))
        B[name].quaternion.set(q.x, q.y, q.z, q.w)
      }
    }
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
  let side = 1 // which side of the paddle the palm is on
  let lastPos = null
  let speedEst = 0
  const moves = assets.moves

  const layerMoves = (bone) => {
    let d = Q()
    for (const [name, L] of Object.entries(LAYERS)) {
      const w = (layers[name] || 0) * L.gain * (L.bones[bone] || 0)
      if (w <= 1e-3) continue
      const clip = moves.clips[L.clip]
      if (!clip) continue
      const t = clipTime(clip, L.locked ? { phase: layers.phase, locked: true, contact: L.contact || 0 } : { time: clock })
      d = qmul(d, additiveMove(moves, clip, bone, t, w))
    }
    return d
  }

  const solveArm = (sideName, target, poleW, maxStretch) => {
    const L = limbs[sideName].arm
    const ua = B[`upperarm_${sideName}`]
    const la = B[`lowerarm_${sideName}`]
    const hand = B[`hand_${sideName}`]
    const root = worldP(ua)
    const ik = solveLimb(root, target, L.l1, L.l2, poleW, maxStretch)
    const up = norm(sub3(ik.mid, root))
    const lo = norm(sub3(ik.end, ik.mid))
    const n = bendAxis(up, lo, poleW)
    la.position.copy(restLp[`lowerarm_${sideName}`]).multiplyScalar(ik.stretch)
    hand.position.copy(restLp[`hand_${sideName}`]).multiplyScalar(ik.stretch)
    setWorldQ(ua, qmul(aimDelta(L.ua, L.uaN, up, n), rest[`upperarm_${sideName}`].wq))
    setWorldQ(la, qmul(aimDelta(L.la, L.laN, lo, n), rest[`lowerarm_${sideName}`].wq))
    return { la, hand }
  }

  const apply = (pose, dt = 1 / 60) => {
    clock += dt
    root.position.set(pose.pelvis.x, 0, pose.pelvis.z)
    root.updateMatrixWorld(true)
    // how fast the body's going (the pose doesn't say), for the clip layers
    if (lastPos && dt > 0) {
      const v = Math.hypot(pose.pelvis.x - lastPos.x, pose.pelvis.z - lastPos.z) / dt
      speedEst += (Math.min(v, 9) - speedEst) * Math.min(1, dt * 8)
    }
    lastPos = { x: pose.pelvis.x, z: pose.pelvis.z }
    const info = pose.info || {}
    stepLayers(layers, layerTargets({ speed: info.speed ?? speedEst, swinging: info.swinging, mood: info.mood, between: info.between, blend: info.blend || null }), dt)
    layers.phase = info.phase ?? clock * 6

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
    DRIVEN_SPINE.forEach((name, i) => {
      setWorldQ(B[name], qmul(qslerp(Rp, Rc, [0.4, 0.75, 1][i]), rest[name].wq))
      addLocal(B[name], layerMoves(name))
    })
    // the head looks along the pose's look; the neck takes some of it
    // (the head keeps its eyes level, like a real player's, whatever the spine is doing)
    const Rh = aimDelta(FWD, UPV, pose.look, add3(scale3(UPV, 0.75), scale3(pose.spine, 0.25)))
    setWorldQ(B.neck_01, qmul(qslerp(Rc, Rh, 0.35), rest.neck_01.wq))
    addLocal(B.neck_01, layerMoves("neck_01"))
    setWorldQ(head, qmul(Rh, rest.Head.wq))
    addLocal(head, layerMoves("Head"))

    // clavicles: follow the chest, shrugging up when that hand goes high
    const right = (pose.hand ?? 1) > 0
    const handSide = right ? "r" : "l"
    if (handSide !== paddleSide && withPaddle) {
      placePaddle(handSide)
      setFingers()
    }
    const wristTarget = { r: right ? pose.wristP : pose.wristO, l: right ? pose.wristO : pose.wristP }
    const elbowTarget = { r: right ? pose.elbowP : pose.elbowO, l: right ? pose.elbowO : pose.elbowP }
    const shoulderPose = { r: pose.shoulderR, l: pose.shoulderL }
    for (const sd of ["l", "r"]) {
      const c = B["clavicle_" + sd]
      const lift = Math.max(0, Math.min(1, (wristTarget[sd].y - shoulderPose[sd].y) / 0.55)) * 0.32
      const shrug = qaxis(pose.chestForward, sd === "r" ? -lift : lift)
      setWorldQ(c, qmul(qmul(shrug, Rc), rest["clavicle_" + sd].wq))
      addLocal(c, layerMoves("clavicle_" + sd))
    }

    // the paddle arm: the hand goes where the paddle face lands on the pose's face point
    const pSide = paddleSide
    const oSide = pSide === "r" ? "l" : "r"
    if (withPaddle) {
      const g = tpl.grip[pSide]
      const axis = norm(pose.paddle.axis)
      let nrm = sub3(pose.paddle.normal, scale3(axis, dot3(pose.paddle.normal, axis)))
      nrm = norm(nrm, FWD)
      // the palm stays on whichever side of the paddle the forearm finds natural
      const la = B["lowerarm_" + pSide]
      const natural = qrot(qmul(worldQ(la), toQ(restLq["hand_" + pSide])), g.palmLocal)
      side = gripSide(side, dot3(natural, nrm))
      const n2 = scale3(nrm, side)
      const paddleQ = frameOf(axis, n2)
      const handQ = qmul(paddleQ, qinv(g.q))
      // hand position = face point - (face from grip) - (grip from hand)
      const gripW = qrot(handQ, scale3(g.p, s))
      const target = sub3(sub3(pose.paddle.face, scale3(axis, FACE_FROM_GRIP)), gripW)
      const pole = sub3(elbowTarget[pSide], scale3(add3(shoulderPose[pSide], wristTarget[pSide]), 0.5))
      const { la: lower, hand } = solveArm(pSide, target, pole, 1.18)
      // share the hand's roll with the forearm so the wrist doesn't wring
      const lw = worldQ(lower)
      const local = qmul(qinv(lw), handQ)
      const axisL = norm(toV(restLp["hand_" + pSide]))
      const tw = twistAngle(swingTwist(local, axisL).twist, axisL)
      setWorldQ(lower, qmul(lw, qaxis(axisL, tw * 0.55)))
      setWorldQ(hand, handQ)
    } else {
      const pole = sub3(elbowTarget[pSide], scale3(add3(shoulderPose[pSide], wristTarget[pSide]), 0.5))
      const { la: lower, hand } = solveArm(pSide, wristTarget[pSide], pole, 1.12)
      hand.quaternion.copy(restLq["hand_" + pSide])
      void lower
    }
    // the other arm: its hand where the pose puts it, wrist relaxed
    {
      const pole = sub3(elbowTarget[oSide], scale3(add3(shoulderPose[oSide], wristTarget[oSide]), 0.5))
      const { hand } = solveArm(oSide, wristTarget[oSide], pole, 1.12)
      hand.quaternion.copy(restLq["hand_" + oSide])
      hand.updateWorldMatrix(false, false)
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
    return { face, soles }
  }

  let vertices = 0
  for (const p of [...parts, ...attach]) vertices += p.geometry.attributes.position.count
  return { group: root, apply, setShadows, dispose, probe, blobs: [], vertices, skinned: true }
}
