// Roam: the cars on screen. Shapes come from render/carmodel.js (a sedan, a hatchback, an
// SUV, a pickup and the hidden Turbo 98; real proportions, no makes or badges). Each car is
// three parts: the paint (glossy, takes the car's colour; the glass rides in it as near-black
// vertices), the trim (tires, lamps, grille, plates, lower plastics) and four wheels you can
// see steer and roll on a car that moves. Parked and passing cars are instanced: two draw
// calls a model for every one in town, plus one for all their contact shadows.
//
// If a detailed shape can't be built (it never should; the test checks it) the plain boxy
// shape of phase 1 stands in (`fallbackGeometry`), so a car is never missing.

import * as THREE from "three"
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { MODELS } from "../sim/car.js"
import { carParts } from "./carmodel.js"

// ---------- the plain fallback (phase 1's boxes) ----------
const PROFILES = {
  sedan: [[-2.35, 0.34], [-2.35, 0.92], [-1.55, 1.0], [-0.75, 1.42], [0.45, 1.46], [1.2, 1.03], [2.35, 0.9], [2.35, 0.34]],
  hatch: [[-2.05, 0.34], [-2.05, 1.0], [-1.85, 1.43], [0.25, 1.5], [1.0, 1.05], [2.05, 0.9], [2.05, 0.34]],
  suv: [[-2.42, 0.42], [-2.42, 1.15], [-2.3, 1.74], [0.4, 1.78], [1.25, 1.2], [2.42, 1.08], [2.42, 0.42]],
  pickup: [[-2.8, 0.44], [-2.8, 1.12], [-0.6, 1.12], [-0.55, 1.78], [0.65, 1.8], [1.35, 1.2], [2.8, 1.1], [2.8, 0.44]],
  turbo: [[-2.15, 0.3], [-2.15, 0.85], [-1.6, 0.92], [-0.55, 1.22], [0.35, 1.25], [1.15, 0.92], [2.15, 0.72], [2.15, 0.3]],
}
const colored = (geo, hex, glow = 0) => {
  const g = geo.index ? geo.toNonIndexed() : geo
  g.deleteAttribute("uv")
  const c = new THREE.Color(hex)
  const n = g.attributes.position.count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3)
  g.setAttribute("color", new THREE.BufferAttribute(col, 3))
  g.setAttribute("glow", new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1))
  return g
}
export const fallbackGeometry = (model) => {
  const m = MODELS[model] || MODELS.sedan
  const shape = new THREE.Shape((PROFILES[model] || PROFILES.sedan).map(([x, y]) => new THREE.Vector2(x, y)))
  const body = new THREE.ExtrudeGeometry(shape, { depth: m.wid, bevelEnabled: false, curveSegments: 1 })
  body.translate(0, 0, -m.wid / 2)
  body.rotateY(-Math.PI / 2)
  const R = model === "suv" || model === "pickup" ? 0.38 : 0.33
  const w = new THREE.CylinderGeometry(R, R, 0.24, 10)
  w.rotateZ(Math.PI / 2)
  const wheels = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([x, z]) => colored(w.clone().translate(x * (m.wid / 2 - 0.1), R, (z * m.wheelbase) / 2), 0x1b1b1c))
  return { paint: colored(body, 0xffffff), trim: mergeGeometries(wheels), wheel: null, wheels: [], fallback: true }
}

// ---------- the detailed shapes ----------
const toGeometry = (arr, crease = true) => {
  let g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.BufferAttribute(arr.position, 3))
  g.setAttribute("color", new THREE.BufferAttribute(arr.color, 3))
  g.setAttribute("glow", new THREE.BufferAttribute(arr.glow, 1))
  g.setIndex(new THREE.BufferAttribute(arr.index, 1))
  // (smooth over the body's curves, crisp at the creases: 36 degrees)
  g = crease ? toCreasedNormals(g, (36 * Math.PI) / 180) : g.toNonIndexed()
  if (!crease) g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}
const cache = new Map()
// -> { paint, trim, wheel, wheels: [{ x, y, z, front }], trimWithWheels } (made once per model)
export const carGeometry = (model, { build = carParts } = {}) => {
  if (cache.has(model)) return cache.get(model)
  let out
  try {
    const p = build(model)
    if (!p || !p.paint?.position?.length) throw new Error("no shape")
    const wheel = toGeometry(p.wheel, true)
    const trim = toGeometry(p.trim, false)
    // (parked cars: the wheels merged into the trim, one draw)
    const placed = p.wheels.map((w) => {
      const g = wheel.clone()
      if (w.x < 0) g.rotateY(Math.PI) // (the rim's face outward on both sides)
      return g.translate(w.x, w.y, w.z)
    })
    out = { paint: toGeometry(p.paint, true), trim, wheel, wheels: p.wheels, trimWithWheels: mergeGeometries([trim, ...placed]), spec: p.spec, fallback: false }
  } catch {
    const f = fallbackGeometry(model)
    out = { ...f, trimWithWheels: f.trim }
  }
  cache.set(model, out)
  return out
}

// ---------- materials ----------
// shared light switches: headlights / tail lights glowing (night: 1), set by the world
export const lampUniforms = { head: { value: 0 }, tail: { value: 0 } }
const glowPatch = (m, own = null) => {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.lampHead = lampUniforms.head
    sh.uniforms.lampTail = lampUniforms.tail
    sh.uniforms.lampBrake = own || { value: 0 }
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float glow;\nvarying float vGlow;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow;")
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float lampHead;\nuniform float lampTail;\nuniform float lampBrake;\nvarying float vGlow;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
  float lampK = vGlow > 1.5 ? max(lampTail * 0.7, lampBrake) * 2.2 : vGlow > 0.5 ? lampHead * 2.6 : 0.0;
  totalEmissiveRadiance += vColor.rgb * lampK;`
      )
  }
  m.customProgramCacheKey = () => "roam-car-trim"
  return m
}
let mats = null
const envMats = new Set()
let envTex = null
let envK = 1
export const carMaterials = () => {
  if (mats) return mats
  mats = {
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.0, roughness: 0.3, envMap: envTex, envMapIntensity: envK }),
    trim: glowPatch(new THREE.MeshLambertMaterial({ vertexColors: true })),
    shadow: new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.62, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  }
  envMats.add(mats.paint)
  return mats
}
// the sky the paint and glass reflect (an HDRI from the host) and how bright it is (the day)
export const setCarEnvironment = (tex, k = envK) => {
  envTex = tex
  envK = k
  for (const m of envMats) {
    if (m.envMap !== tex) {
      m.envMap = tex
      m.needsUpdate = true
    }
    m.envMapIntensity = k
  }
}
// a soft dark blob (the car's contact shadow on the road)
let blob = null
const blobTexture = () => {
  if (blob) return blob
  const n = 64
  const data = new Uint8Array(n * n * 4)
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      // (a rounded rectangle, soft at its edges)
      const x = Math.abs((i + 0.5) / n - 0.5) * 2
      const y = Math.abs((j + 0.5) / n - 0.5) * 2
      const d = Math.max(0, Math.hypot(Math.max(0, x - 0.55), Math.max(0, y - 0.7)) / 0.45, Math.max(x - 1, y - 1))
      const a = Math.max(0, Math.min(1, 1 - d)) ** 1.6
      data.set([0, 0, 0, Math.round(a * 255)], (j * n + i) * 4)
    }
  blob = new THREE.DataTexture(data, n, n, THREE.RGBAFormat)
  blob.magFilter = THREE.LinearFilter
  blob.minFilter = THREE.LinearFilter
  blob.needsUpdate = true
  return blob
}
const shadowGeo = (model) => {
  const m = MODELS[model] || MODELS.sedan
  const g = new THREE.PlaneGeometry(m.wid + 0.5, m.len + 0.5)
  g.rotateX(-Math.PI / 2)
  g.translate(0, 0.05, 0)
  return g
}

// one car you can see move (yours, a friend's): -> { group, setColor, setWheels(steer, roll), setBrake, dispose }
export const makeCarMesh = (model, color) => {
  const g = carGeometry(model)
  carMaterials()
  const paintMat = new THREE.MeshStandardMaterial({ color, vertexColors: true, metalness: 0.0, roughness: 0.3, envMap: envTex, envMapIntensity: envK })
  envMats.add(paintMat)
  const brake = { value: 0 }
  const trimMat = glowPatch(new THREE.MeshLambertMaterial({ vertexColors: true }), brake)
  const group = new THREE.Group()
  const body = new THREE.Group() // (leans a little in turns and under braking)
  group.add(body)
  body.add(new THREE.Mesh(g.paint, paintMat), new THREE.Mesh(g.wheel ? g.trim : g.trimWithWheels, trimMat))
  for (const m of body.children) m.receiveShadow = true
  const shadow = new THREE.Mesh(shadowGeo(model), mats.shadow)
  shadow.renderOrder = 1
  group.add(shadow)
  const wheels = []
  if (g.wheel)
    for (const w of g.wheels) {
      const pivot = new THREE.Group()
      pivot.position.set(w.x, w.y, w.z)
      const mesh = new THREE.Mesh(g.wheel, trimMat)
      if (w.x < 0) mesh.rotation.y = Math.PI
      const spin = new THREE.Group()
      spin.add(mesh)
      pivot.add(spin)
      group.add(pivot)
      wheels.push({ pivot, spin, front: w.front, left: w.x < 0 })
    }
  if (model === "turbo") {
    // (the Turbo 98's stripe and its underglow)
    const top = g.spec ? Math.max(...g.spec.top.map((k) => k[1])) : 1.22
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 4.1), new THREE.MeshBasicMaterial({ color: 0xff4fa3 }))
    stripe.position.set(0, top + 0.035, 0)
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.6), new THREE.MeshBasicMaterial({ color: 0x31f2e1, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }))
    glow.rotation.x = -Math.PI / 2
    glow.position.y = 0.06
    body.add(stripe)
    group.add(glow)
  }
  let roll = 0
  return {
    group,
    body,
    setColor: (hex) => paintMat.color.setHex(hex),
    // steer: the front wheels' angle (rad, right +); dist: metres rolled since last time
    setWheels(steer, dist, R = g.spec?.R || 0.33) {
      roll = (roll + dist / R) % (Math.PI * 2)
      for (const w of wheels) {
        w.pivot.rotation.y = w.front ? -steer : 0
        w.spin.rotation.x = roll
      }
    },
    setBrake: (on) => (brake.value = on ? 1 : 0),
    dispose() {
      group.removeFromParent()
      envMats.delete(paintMat)
      paintMat.dispose()
      trimMat.dispose()
      shadow.geometry.dispose()
      for (const c of body.children) if (c.geometry && c.geometry !== g.paint && c.geometry !== g.trim && c.geometry !== g.trimWithWheels) c.geometry.dispose()
    },
  }
}

// every parked (or passing) car, instanced per model: set(list) with
// [{ model, color, x, y, z, yaw, pitch, roll }]
export const createParkedLayer = (scene, cap = 220) => {
  const m = carMaterials()
  const layers = {}
  const mat4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler(0, 0, 0, "YXZ")
  const one = new THREE.Vector3(1, 1, 1)
  const pos = new THREE.Vector3()
  const col = new THREE.Color()
  // (one shadow draw for every car of every model: sized per model in its matrix)
  const shadowBase = shadowGeo("sedan")
  const shadows = new THREE.InstancedMesh(shadowBase, m.shadow, cap * 2)
  shadows.count = 0
  shadows.frustumCulled = false
  shadows.renderOrder = 1
  scene.add(shadows)
  const sScale = new THREE.Vector3()
  const layerOf = (model) => {
    if (layers[model]) return layers[model]
    const g = carGeometry(model)
    const paint = new THREE.InstancedMesh(g.paint, m.paint, cap)
    const trim = new THREE.InstancedMesh(g.trimWithWheels, m.trim, cap)
    paint.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3)
    for (const im of [paint, trim]) {
      im.count = 0
      im.frustumCulled = false
      im.receiveShadow = true
      scene.add(im)
    }
    paint.castShadow = true
    return (layers[model] = { paint, trim })
  }
  return {
    set(list) {
      const by = {}
      for (const c of list) (by[c.model] ||= []).push(c)
      for (const k of Object.keys(layers)) if (!by[k]) layers[k].paint.count = layers[k].trim.count = 0
      let s = 0
      const ref = MODELS.sedan
      for (const [model, cars] of Object.entries(by)) {
        const L = layerOf(model)
        const n = Math.min(cap, cars.length)
        const mm = MODELS[model] || ref
        for (let i = 0; i < n; i++) {
          const c = cars[i]
          e.set(-c.pitch || 0, c.yaw, c.roll || 0)
          q.setFromEuler(e)
          pos.set(c.x, c.y || 0, c.z)
          mat4.compose(pos, q, one)
          L.paint.setMatrixAt(i, mat4)
          L.trim.setMatrixAt(i, mat4)
          L.paint.instanceColor.setXYZ(i, ...col.setHex(c.color).toArray())
          if (s < cap * 2) {
            mat4.compose(pos, q, sScale.set((mm.wid + 0.5) / (ref.wid + 0.5), 1, (mm.len + 0.5) / (ref.len + 0.5)))
            shadows.setMatrixAt(s++, mat4)
          }
        }
        L.paint.count = L.trim.count = n
        L.paint.instanceMatrix.needsUpdate = L.trim.instanceMatrix.needsUpdate = true
        L.paint.instanceColor.needsUpdate = true
      }
      shadows.count = s
      shadows.instanceMatrix.needsUpdate = true
    },
    dispose() {
      for (const L of Object.values(layers)) {
        L.paint.removeFromParent()
        L.trim.removeFromParent()
        L.paint.dispose()
        L.trim.dispose()
      }
      shadows.removeFromParent()
      shadows.dispose()
      shadowBase.dispose()
    },
  }
}
