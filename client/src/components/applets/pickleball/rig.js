// Pickleball 98: the players' 3D figures. A figure is a set of simple low-poly parts
// (pelvis, torso, head with hair and hat, upper and lower arms and legs, hands, shoes, the
// paddle) placed every frame on the joints anim.js works out. Built from a look (looks.js,
// locker.js): skin, hair, hat, the kit (long sleeves, track pants, board shorts, a one-piece,
// socks, gloves, wristbands, glasses), paddle colors, build. No model files.

import * as THREE from "three"
import { BODY } from "./anim.js"
import { SKIN } from "./looks.js"

const Y = new THREE.Vector3(0, 1, 0)
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpC = new THREE.Vector3()
const tmpD = new THREE.Vector3()
const tmpM = new THREE.Matrix4()

// shared geometry (unit sized; parts are scaled into place)
let shared = null
const geometries = () => {
  if (shared) return shared
  // a limb: from y=0 (radius 1) to y=1 (radius `taper`), placed between two joints
  const limb = (taper, seg = 9) => {
    const g = new THREE.CylinderGeometry(taper, 1, 1, seg, 1, true)
    g.translate(0, 0.5, 0)
    return g
  }
  // the torso: a lathe (waist, chest, shoulders) facing +z, origin at its bottom
  const torsoProfile = [
    [0.0, 0.0],
    [0.8, 0.0],
    [0.86, 0.12],
    [0.82, 0.32],
    [0.92, 0.6],
    [1.0, 0.8],
    [0.92, 0.94],
    [0.55, 1.02],
    [0.0, 1.04],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const torso = new THREE.LatheGeometry(torsoProfile, 12)
  const pelvis = new THREE.SphereGeometry(1, 12, 8)
  const ball = new THREE.SphereGeometry(1, 10, 8)
  const head = new THREE.SphereGeometry(1, 16, 12)
  // hair cap: the top and back of a sphere
  const cap = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)
  const back = new THREE.SphereGeometry(1, 14, 10, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.3, Math.PI * 0.45)
  // shoe: a rounded box, toe toward +z
  const shoe = new THREE.SphereGeometry(1, 12, 8)
  const sole = new THREE.BoxGeometry(1, 1, 1)
  // paddle: handle along +y from the grip, face normal +z
  const shape = new THREE.Shape()
  const W = 0.1
  const H = 0.27
  const R = 0.055
  shape.moveTo(-W + R, 0)
  shape.lineTo(W - R, 0)
  shape.quadraticCurveTo(W, 0, W, R)
  shape.lineTo(W, H - R)
  shape.quadraticCurveTo(W, H, W - R, H)
  shape.lineTo(-W + R, H)
  shape.quadraticCurveTo(-W, H, -W, H - R)
  shape.lineTo(-W, R)
  shape.quadraticCurveTo(-W, 0, -W + R, 0)
  const face = new THREE.ExtrudeGeometry(shape, { depth: 0.013, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.006, bevelSegments: 1, curveSegments: 4 })
  face.translate(0, 0.11, -0.0065)
  const edgeShape = new THREE.Shape()
  edgeShape.absarc(0, 0, 1, 0, Math.PI * 2, false)
  const handle = new THREE.CylinderGeometry(0.016, 0.018, 0.13, 8)
  handle.translate(0, 0.045, 0)
  const brim = new THREE.CylinderGeometry(1, 1, 1, 16, 1, false, -Math.PI * 0.42, Math.PI * 0.84)
  const ring = new THREE.TorusGeometry(1, 0.12, 6, 18)
  const cone = new THREE.ConeGeometry(1, 1, 6)
  const skirt = new THREE.CylinderGeometry(0.8, 1, 1, 14, 1, true)
  skirt.translate(0, -0.5, 0)
  shared = { limb9: limb(0.82), limbArm: limb(0.78), limbShin: limb(0.62), torso, pelvis, ball, head, cap, back, shoe, sole, face, handle, brim, ring, cone, skirt }
  return shared
}

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...opts })

// place a limb mesh between two points with a radius
const between = (mesh, a, b, r) => {
  tmpA.set(b.x - a.x, b.y - a.y, b.z - a.z)
  const L = tmpA.length()
  mesh.position.set(a.x, a.y, a.z)
  if (L > 1e-6) mesh.quaternion.setFromUnitVectors(Y, tmpA.multiplyScalar(1 / L))
  mesh.scale.set(r, L, r)
}
// orient from basis vectors: x (model's +x = the figure's left), y up, z forward
const orient = (obj, xv, yv, zv) => {
  tmpM.makeBasis(tmpB.set(xv.x, xv.y, xv.z), tmpC.set(yv.x, yv.y, yv.z), tmpD.set(zv.x, zv.y, zv.z))
  obj.quaternion.setFromRotationMatrix(tmpM)
}
const crossV = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const normV = (a) => {
  const l = Math.hypot(a.x, a.y, a.z) || 1
  return { x: a.x / l, y: a.y / l, z: a.z / l }
}
const lerpP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })

// Build a figure for a look. Returns { group, apply(pose), setShadows(on), dispose() }
export const createFigure = (look = {}, { shadows = false, withPaddle = true } = {}) => {
  const G = geometries()
  const group = new THREE.Group()
  const build = typeof look.build === "number" ? look.build : { slim: 0.94, regular: 1, strong: 1.07 }[look.build] || 1
  const top = look.shirtStyle || "tee"
  const longSleeves = top === "rash" || top === "jacket"
  const bareArms = top === "tank" || top === "crop" || top === "onepiece"
  const bottomKind = top === "onepiece" ? "onepiece" : look.bottom || "shorts"
  const sockStyle = look.sockStyle || "crew"
  const skinColor = typeof look.skin === "number" ? SKIN[look.skin] || SKIN[2] : look.skin || SKIN[2]
  const M = {
    skin: mat(skinColor, { roughness: 0.62 }),
    shirt: mat(look.shirt || "#1a9fb0"),
    trim: mat(look.trim || "#ffffff"),
    bottom: mat(look.bottomColor || "#23395d"),
    hair: mat(look.hairColor || "#2b1b0e", { roughness: 0.9 }),
    hat: mat(look.hatColor || "#ffffff"),
    shoe: mat(look.shoes || "#ffffff", { roughness: 0.55 }),
    accent: mat(look.shoeAccent || "#1a9fb0"),
    sock: mat(look.socks || "#ffffff"),
    glove: mat(look.gloveColor || "#2b2b2b", { roughness: 0.8 }),
    band: mat(look.wristColor || "#ffffff"),
    mirror: mat("#3a5f8a", { roughness: 0.2, metalness: 0.4 }),
    sole: mat("#e9e9e9", { roughness: 0.9 }),
    paddle: mat(look.paddle || "#ffd23f", { roughness: 0.5 }),
    edge: mat(look.paddleEdge || "#15223a", { roughness: 0.5 }),
    grip: mat("#202020", { roughness: 0.9 }),
    dark: mat("#1b1b1f", { roughness: 0.4 }),
    white: mat("#ffffff", { roughness: 0.4 }),
  }
  const add = (geo, m, parent = group) => {
    const mesh = new THREE.Mesh(geo, m)
    mesh.castShadow = shadows
    parent.add(mesh)
    return mesh
  }

  // ---- body parts ----
  const pelvis = new THREE.Group()
  group.add(pelvis)
  const shorts = add(G.pelvis, bottomKind === "onepiece" ? M.shirt : bottomKind === "pants" ? M.bottom : M.bottom, pelvis)
  shorts.scale.set(0.165 * build, 0.12, 0.115 * build)
  shorts.position.y = 0.02
  let skirtMesh = null
  if (look.bottom === "skirt") {
    skirtMesh = add(G.skirt, M.bottom, pelvis)
    skirtMesh.scale.set(0.2 * build, 0.2, 0.16 * build)
    skirtMesh.position.y = 0.09
  }
  const torsoG = new THREE.Group()
  group.add(torsoG)
  const torso = add(G.torso, top === "crop" ? M.skin : M.shirt, torsoG)
  const puff = top === "jacket" ? 1.06 : 1
  torso.scale.set(0.17 * build * puff, BODY.spine + 0.06, 0.115 * build * puff)
  torso.position.y = -0.06
  if (top === "crop") {
    // a sports top: the chest and shoulders in the kit color
    const chest = add(G.torso, M.shirt, torsoG)
    chest.scale.set(0.175 * build, (BODY.spine + 0.06) * 0.42, 0.12 * build)
    chest.position.y = BODY.spine * 0.5
  }
  if (top === "jacket") {
    const zip = add(G.sole, M.trim, torsoG)
    zip.scale.set(0.012, BODY.spine * 0.9, 0.01)
    zip.position.set(0, BODY.spine * 0.48, 0.118 * build)
  }
  // a collar / trim line at the neck and the hem
  const collar = add(G.ring, M.trim, torsoG)
  collar.scale.set(0.068, 0.068, 0.32)
  collar.rotation.x = Math.PI / 2
  collar.position.y = BODY.spine - 0.025
  const hem = add(G.ring, M.trim, torsoG)
  hem.scale.set(0.142 * build, 0.104 * build, 0.25)
  hem.rotation.x = Math.PI / 2
  hem.position.y = -0.04
  if (look.shirtStyle === "polo") {
    const placket = add(G.sole, M.trim, torsoG)
    placket.scale.set(0.03, 0.12, 0.01)
    placket.position.set(0, BODY.spine - 0.1, 0.105 * build)
  } else if (look.shirtStyle === "tee" || !look.shirtStyle) {
    const stripe = add(G.sole, M.trim, torsoG)
    stripe.scale.set(0.012, 0.36, 0.01)
    stripe.position.set(0.155 * build, BODY.spine * 0.45, 0)
    const stripe2 = add(G.sole, M.trim, torsoG)
    stripe2.scale.set(0.012, 0.36, 0.01)
    stripe2.position.set(-0.155 * build, BODY.spine * 0.45, 0)
  }
  const neck = add(G.limb9, M.skin)
  // the head: skin, a face, hair and a hat, oriented by where they're looking
  const headG = new THREE.Group()
  group.add(headG)
  const head = add(G.head, M.skin, headG)
  head.scale.set(0.098, 0.115, 0.104)
  for (const s of [-1, 1]) {
    const eye = add(G.ball, M.dark, headG)
    eye.scale.setScalar(0.013)
    eye.position.set(s * 0.036, 0.018, 0.093)
    const ear = add(G.ball, M.skin, headG)
    ear.scale.set(0.014, 0.026, 0.02)
    ear.position.set(s * 0.097, 0.0, 0.0)
    const brow = add(G.sole, M.hair, headG)
    brow.scale.set(0.03, 0.007, 0.01)
    brow.position.set(s * 0.036, 0.042, 0.096)
  }
  const nose = add(G.cone, M.skin, headG)
  nose.scale.set(0.014, 0.035, 0.014)
  nose.rotation.x = Math.PI / 2
  nose.position.set(0, -0.005, 0.11)
  const mouth = add(G.sole, mat("#8a3b3b"), headG)
  mouth.scale.set(0.03, 0.006, 0.01)
  mouth.position.set(0, -0.045, 0.094)
  // hair
  const hair = { buzz: "spiky", pixie: "short", buns: "bun", own: look.body === "f" ? "long" : "short" }[look.hair] || look.hair || "short"
  if (hair !== "bald") {
    const capMesh = add(hair === "curly" ? new THREE.IcosahedronGeometry(1, 1) : G.cap, M.hair, headG)
    capMesh.scale.set(0.105, hair === "curly" ? 0.1 : 0.118, 0.112)
    capMesh.position.set(0, hair === "curly" ? 0.035 : 0.012, -0.008)
    capMesh.rotation.x = -0.25
    if (hair !== "spiky" && hair !== "curly") {
      const backMesh = add(G.back, M.hair, headG)
      backMesh.scale.set(0.106, 0.118, 0.108)
      backMesh.rotation.y = Math.PI
      backMesh.position.set(0, 0.0, -0.004)
    }
  } else {
    // a fringe of gray at the sides
    for (const s of [-1, 1]) {
      const side = add(G.ball, M.hair, headG)
      side.scale.set(0.02, 0.035, 0.05)
      side.position.set(s * 0.093, -0.005, -0.03)
    }
  }
  let swingy = null // a ponytail or braid that sways
  if (hair === "ponytail" || hair === "braid") {
    swingy = new THREE.Group()
    swingy.position.set(0, 0.03, -0.1)
    headG.add(swingy)
    const n = hair === "braid" ? 4 : 1
    if (hair === "ponytail") {
      const tie = add(G.ball, M.hat, swingy)
      tie.scale.setScalar(0.022)
      const tail = add(G.limbShin, M.hair, swingy)
      tail.scale.set(0.035, 0.2, 0.035)
      tail.rotation.x = Math.PI * 0.92
    } else {
      for (let i = 0; i < n; i++) {
        const b = add(G.ball, M.hair, swingy)
        b.scale.setScalar(0.03 - i * 0.003)
        b.position.set(0, -0.05 * i, -0.012 * i)
      }
    }
  } else if (hair === "bun") {
    const bun = add(G.ball, M.hair, headG)
    bun.scale.setScalar(0.045)
    bun.position.set(0, 0.08, -0.08)
  } else if (hair === "long") {
    const long = add(G.limb9, M.hair, headG)
    long.scale.set(0.085, 0.2, 0.05)
    long.rotation.x = Math.PI
    long.position.set(0, 0.03, -0.065)
  } else if (hair === "spiky") {
    for (let i = 0; i < 7; i++) {
      const sp = add(G.cone, M.hair, headG)
      sp.scale.set(0.025, 0.06, 0.025)
      const a = (i / 7) * Math.PI * 2
      sp.position.set(Math.cos(a) * 0.05, 0.1, Math.sin(a) * 0.05 - 0.01)
      sp.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5)
    }
  }
  if (look.beard) {
    const beard = add(G.back, M.hair, headG)
    beard.scale.set(0.1, 0.1, 0.1)
    beard.rotation.x = Math.PI * 0.62
    beard.position.set(0, -0.025, 0.012)
  }
  if (look.glasses === "sport") {
    const band = add(G.sole, M.mirror, headG)
    band.scale.set(0.2, 0.03, 0.012)
    band.position.set(0, 0.018, 0.1)
  } else if (look.glasses && look.glasses !== "none") {
    for (const s of [-1, 1]) {
      const lens = add(G.sole, M.dark, headG)
      lens.scale.set(0.036, 0.022, 0.006)
      lens.position.set(s * 0.036, 0.016, 0.1)
    }
    const bar = add(G.sole, M.dark, headG)
    bar.scale.set(0.2, 0.008, 0.006)
    bar.position.set(0, 0.022, 0.1)
  }
  // hats
  const hat = look.hat || "none"
  if (hat === "visor" || hat === "headband") {
    const band = add(G.ring, M.hat, headG)
    band.scale.set(0.103, 0.11, 0.2)
    band.rotation.x = Math.PI / 2
    band.position.y = 0.045
    if (hat === "visor") {
      const b = add(G.brim, M.hat, headG)
      b.scale.set(0.15, 0.008, 0.16)
      b.position.set(0, 0.05, 0.03)
      b.rotation.x = 0.12
    }
  } else if (hat === "cap" || hat === "capBack") {
    const dome = add(G.cap, M.hat, headG)
    dome.scale.set(0.11, 0.105, 0.116)
    dome.position.set(0, 0.03, -0.004)
    const b = add(G.brim, M.hat, headG)
    b.scale.set(0.15, 0.008, 0.17)
    b.position.set(0, 0.05, hat === "cap" ? 0.035 : -0.035)
    b.rotation.set(hat === "cap" ? 0.12 : -0.12, hat === "cap" ? 0 : Math.PI, 0)
  } else if (hat === "beanie") {
    const dome = add(G.cap, M.hat, headG)
    dome.scale.set(0.113, 0.118, 0.12)
    dome.position.set(0, 0.0, -0.004)
    const cuff = add(G.ring, M.hat, headG)
    cuff.scale.set(0.108, 0.115, 0.35)
    cuff.rotation.x = Math.PI / 2
    cuff.position.y = 0.012
    const pom = add(G.ball, M.hat, headG)
    pom.scale.setScalar(0.03)
    pom.position.set(0, 0.125, -0.01)
  } else if (hat === "bucket") {
    const crown = add(G.limb9, M.hat, headG)
    crown.scale.set(0.11, 0.09, 0.11)
    crown.position.y = 0.03
    const b = add(new THREE.CylinderGeometry(1, 1, 1, 18), M.hat, headG)
    b.scale.set(0.17, 0.008, 0.17)
    b.position.y = 0.035
    const top = add(G.ball, M.hat, headG)
    top.scale.set(0.1, 0.03, 0.1)
    top.position.y = 0.118
  }

  // limbs: upper arm = sleeve (shirt) + skin, forearm, hands; legs = shorts + skin + socks
  const sleeveR = bareArms || longSleeves ? null : add(G.limbArm, M.shirt)
  const sleeveL = bareArms || longSleeves ? null : add(G.limbArm, M.shirt)
  const upperR = add(G.limbArm, longSleeves ? M.shirt : M.skin)
  const upperL = add(G.limbArm, longSleeves ? M.shirt : M.skin)
  const foreR = add(G.limbArm, longSleeves ? M.shirt : M.skin)
  const foreL = add(G.limbArm, longSleeves ? M.shirt : M.skin)
  const shoulderBallR = add(G.ball, bareArms ? M.skin : M.shirt)
  const shoulderBallL = add(G.ball, bareArms ? M.skin : M.shirt)
  const elbowR = add(G.ball, longSleeves ? M.shirt : M.skin)
  const elbowL = add(G.ball, longSleeves ? M.shirt : M.skin)
  const handR = add(G.ball, look.gloves ? M.glove : M.skin)
  const handL = add(G.ball, look.gloves ? M.glove : M.skin)
  const bandR = look.wristbands && !look.gloves ? add(G.limb9, M.band) : null
  const bandL = look.wristbands && !look.gloves ? add(G.limb9, M.band) : null
  // how far down the thigh the shorts go (and track pants cover the shins too)
  const shortLen = { shorts: 0.48, board: 0.88, short: 0.26, swim: 0.2, pants: 1 }[bottomKind]
  const legs = [0, 1].map(() => ({
    short: look.bottom === "skirt" || !shortLen ? null : add(G.limb9, M.bottom),
    thigh: add(G.limb9, bottomKind === "pants" ? M.bottom : M.skin),
    knee: add(G.ball, bottomKind === "pants" ? M.bottom : M.skin),
    shin: add(G.limbShin, bottomKind === "pants" ? M.bottom : M.skin),
    sock: sockStyle === "none" || bottomKind === "pants" ? null : add(G.limbShin, M.sock),
    shoe: (() => {
      const g = new THREE.Group()
      group.add(g)
      const upper = add(G.shoe, M.shoe, g)
      upper.scale.set(0.052, 0.045, 0.125)
      upper.position.set(0, 0.04, 0.045)
      const sole = add(G.sole, M.sole, g)
      sole.scale.set(0.095, 0.022, 0.27)
      sole.position.set(0, 0.011, 0.045)
      const stripe = add(G.sole, M.accent, g)
      stripe.scale.set(0.106, 0.016, 0.1)
      stripe.position.set(0, 0.045, 0.04)
      return g
    })(),
  }))

  // the paddle
  const paddle = new THREE.Group()
  group.add(paddle)
  add(G.handle, M.grip, paddle)
  const faceMesh = add(G.face, M.paddle, paddle)
  const edgeMesh = add(G.face, M.edge, paddle)
  edgeMesh.scale.set(1.06, 1.03, 0.6)
  edgeMesh.position.y = -0.006
  faceMesh.renderOrder = 1
  paddle.visible = withPaddle

  // contact shadow: a soft blob under each foot and the body
  const blobs = []

  const r = { arm: 0.045 * build, fore: 0.038 * build, thigh: 0.072 * build, shin: 0.052 * build }
  let swayX = 0
  let swayV = 0
  let lastHead = null

  const apply = (pose, dt = 1 / 60) => {
    // pelvis and torso
    const up = normV(pose.spine)
    const pr = pose.pelvisRight
    const pf = normV(crossV(up, pr))
    pelvis.position.set(pose.pelvis.x, pose.pelvis.y, pose.pelvis.z)
    orient(pelvis, { x: -pr.x, y: -pr.y, z: -pr.z }, up, pf)
    torsoG.position.set(pose.pelvis.x, pose.pelvis.y, pose.pelvis.z)
    const sr = pose.chestRight
    orient(torsoG, { x: -sr.x, y: -sr.y, z: -sr.z }, up, pose.chestForward)
    between(neck, pose.neck, pose.head, 0.045)
    // the head looks along pose.look, with the spine's up
    const f = pose.look
    let hx = crossV(up, f)
    hx = normV(hx)
    const hy = normV(crossV(f, hx))
    headG.position.set(pose.head.x, pose.head.y, pose.head.z)
    orient(headG, hx, hy, f)
    // a ponytail swings with the head's movement
    if (swingy) {
      if (lastHead) {
        const dx = (pose.head.x - lastHead.x) * hx.x + (pose.head.z - lastHead.z) * hx.z
        swayV += (-dx / Math.max(dt, 1e-3)) * 0.04 - swayX * 60 * dt - swayV * 6 * dt
        swayX += swayV * dt
        swayX = Math.max(-0.7, Math.min(0.7, swayX))
      }
      swingy.rotation.z = swayX
      lastHead = { ...pose.head }
    }
    // arms: the paddle arm first
    const right = pose.hand > 0
    const [shP, shO] = [pose.paddleShoulder, right ? pose.shoulderL : pose.shoulderR]
    const armSets = [
      [shP, pose.elbowP, pose.wristP, right ? upperR : upperL, right ? foreR : foreL, right ? sleeveR : sleeveL, right ? elbowR : elbowL, right ? handR : handL, right ? shoulderBallR : shoulderBallL],
      [shO, pose.elbowO, pose.wristO, right ? upperL : upperR, right ? foreL : foreR, right ? sleeveL : sleeveR, right ? elbowL : elbowR, right ? handL : handR, right ? shoulderBallL : shoulderBallR],
    ]
    for (const [sh, el, wr, upper, fore, sleeve, elbow, hand, ball] of armSets) {
      between(upper, sh, el, r.arm)
      if (sleeve) between(sleeve, sh, lerpP(sh, el, 0.42), r.arm * 1.35)
      between(fore, el, wr, r.fore)
      elbow.position.set(el.x, el.y, el.z)
      elbow.scale.setScalar(r.fore * 1.02)
      hand.position.set(wr.x, wr.y, wr.z)
      hand.scale.setScalar(0.042)
      ball.position.set(sh.x, sh.y, sh.z)
      ball.scale.setScalar(r.arm * (sleeve ? 1.4 : 1.1))
    }
    if (bandR) between(bandR, lerpP(pose.elbowP, pose.wristP, 0.8), lerpP(pose.elbowP, pose.wristP, 0.95), r.fore * 1.15)
    if (bandL) between(bandL, lerpP(pose.elbowO, pose.wristO, 0.8), lerpP(pose.elbowO, pose.wristO, 0.95), r.fore * 1.15)
    // legs
    const legSets = [
      [pose.hipL, pose.kneeL, pose.ankleL, pose.footL],
      [pose.hipR, pose.kneeR, pose.ankleR, pose.footR],
    ]
    legSets.forEach(([hip, knee, ankle, foot], i) => {
      const L = legs[i]
      between(L.thigh, hip, knee, r.thigh)
      if (L.short) between(L.short, hip, lerpP(hip, knee, Math.min(0.95, shortLen)), r.thigh * (bottomKind === "board" ? 1.36 : 1.28))
      L.knee.position.set(knee.x, knee.y, knee.z)
      L.knee.scale.setScalar(r.shin * 1.12)
      between(L.shin, knee, ankle, r.shin)
      if (L.sock) between(L.sock, lerpP(knee, ankle, sockStyle === "knee" ? 0.12 : sockStyle === "ankle" ? 0.88 : 0.7), ankle, r.shin * (sockStyle === "knee" ? 0.95 : 0.72))
      L.shoe.position.set(foot.x, foot.y, foot.z)
      L.shoe.rotation.set(foot.pitch || 0, foot.yaw, 0, "YXZ")
    })
    // the paddle: grip in the hand, handle along the axis, face along the normal
    const ax = pose.paddle.axis
    const n = pose.paddle.normal
    const px = normV(crossV(ax, n))
    paddle.position.set(pose.paddle.grip.x, pose.paddle.grip.y, pose.paddle.grip.z)
    orient(paddle, px, ax, n)
    skin.update()
  }

  // ---- one mesh, one draw call: every part's triangles in one buffer, moved on the CPU ----
  const nodes = [pelvis, torsoG, neck, headG, swingy, sleeveR, sleeveL, upperR, upperL, foreR, foreL, shoulderBallR, shoulderBallL, elbowR, elbowL, handR, handL, bandR, bandL]
  for (const L of legs) nodes.push(L.short, L.thigh, L.knee, L.shin, L.sock, L.shoe)
  if (withPaddle) nodes.push(paddle)
  const skin = bake(group, nodes.filter(Boolean), shadows)
  const usedGeometries = new Set()
  group.traverse((o) => o.isMesh && usedGeometries.add(o.geometry))

  const setShadows = (on) => {
    skin.mesh.castShadow = on
  }

  const dispose = () => {
    Object.values(M).forEach((m) => m.dispose())
    const shared = new Set(Object.values(G))
    for (const g of usedGeometries) if (!shared.has(g)) g.dispose()
    skin.dispose()
  }

  // (debug.paddle: the paddle's holder, as athlete.js has it: My Park's tennis swaps in a racket)
  return { group: skin.mesh, apply, setShadows, dispose, blobs, vertices: skin.vertices, debug: { paddle } }
}

// Bake a figure's parts into one mesh. nodes: the moving parts (each a group of meshes, or a
// mesh); their meshes' triangles are stored in the node's own space with the meshes' colors,
// and update() moves each node's slice of the buffer by the node's current transform.
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 })
const bake = (root, nodes, shadows) => {
  const isNode = new Set(nodes)
  const parts = [] // { node, pos, nrm }: rest positions/normals in the node's space
  const positions = []
  const normals = []
  const colors = []
  const index = []
  let count = 0
  const m4 = new THREE.Matrix4()
  const n3 = new THREE.Matrix3()
  const v = new THREE.Vector3()
  for (const node of nodes) {
    const start = count
    const meshes = []
    const walk = (o, rel) => {
      if (o.isMesh && o.visible !== false) meshes.push({ mesh: o, rel })
      for (const c of o.children) {
        if (isNode.has(c)) continue
        c.updateMatrix()
        walk(c, rel.clone().multiply(c.matrix))
      }
    }
    // a mesh node keeps its own geometry space; a group node holds its children's
    if (node.isMesh) walk(node, new THREE.Matrix4())
    else
      for (const c of node.children) {
        if (isNode.has(c)) continue
        c.updateMatrix()
        walk(c, c.matrix.clone())
      }
    for (const { mesh, rel } of meshes) {
      const g = mesh.geometry
      const P = g.attributes.position
      const N = g.attributes.normal
      const color = mesh.material.color
      n3.getNormalMatrix(rel)
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(rel)
        positions.push(v.x, v.y, v.z)
        v.fromBufferAttribute(N, i).applyMatrix3(n3).normalize()
        normals.push(v.x, v.y, v.z)
        colors.push(color.r, color.g, color.b)
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) index.push(count + g.index.getX(i))
      else for (let i = 0; i < P.count; i++) index.push(count + i)
      count += P.count
    }
    parts.push({ node, start, end: count })
  }
  const rest = { p: new Float32Array(positions), n: new Float32Array(normals) }
  const geo = new THREE.BufferGeometry()
  const pos = new THREE.BufferAttribute(new Float32Array(positions), 3)
  const nrm = new THREE.BufferAttribute(new Float32Array(normals), 3)
  pos.setUsage(THREE.DynamicDrawUsage)
  nrm.setUsage(THREE.DynamicDrawUsage)
  geo.setAttribute("position", pos)
  geo.setAttribute("normal", nrm)
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3))
  geo.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1))
  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = shadows
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  const update = () => {
    root.updateMatrixWorld(true)
    const P = pos.array
    const N = nrm.array
    const RP = rest.p
    const RN = rest.n
    for (const part of parts) {
      const e = part.node.matrixWorld.elements
      n3.getNormalMatrix(part.node.matrixWorld)
      const q = n3.elements
      for (let i = part.start * 3, end = part.end * 3; i < end; i += 3) {
        const x = RP[i]
        const y = RP[i + 1]
        const z = RP[i + 2]
        P[i] = e[0] * x + e[4] * y + e[8] * z + e[12]
        P[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
        P[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
        const a = RN[i]
        const b = RN[i + 1]
        const c = RN[i + 2]
        const nx = q[0] * a + q[3] * b + q[6] * c
        const ny = q[1] * a + q[4] * b + q[7] * c
        const nz = q[2] * a + q[5] * b + q[8] * c
        const l = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1)
        N[i] = nx * l
        N[i + 1] = ny * l
        N[i + 2] = nz * l
      }
    }
    pos.needsUpdate = true
    nrm.needsUpdate = true
  }
  return { mesh, update, vertices: count, dispose: () => geo.dispose() }
}
