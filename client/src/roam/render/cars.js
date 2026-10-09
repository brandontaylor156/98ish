// Roam: the cars, original low-poly shapes (no makes or badges): a sedan, a hatchback, an
// SUV, a pickup and the hidden Turbo 98. Each is two merged meshes: the paint (taking each
// car's colour) and the rest (glass, wheels, lights). Parked cars are drawn instanced: two
// draw calls a model for every parked car in town.

import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { MODELS } from "../sim/car.js"

// side profiles: [along (front +), up] from the rear bottom round to the front bottom
const PROFILES = {
  sedan: { body: [[-2.35, 0.34], [-2.35, 0.92], [-1.55, 1.0], [-0.75, 1.42], [0.45, 1.46], [1.2, 1.03], [2.35, 0.9], [2.35, 0.34]], glass: [[-1.5, 1.0], [-0.74, 1.39], [0.44, 1.42], [1.15, 1.02]] },
  hatch: { body: [[-2.05, 0.34], [-2.05, 1.0], [-1.85, 1.43], [0.25, 1.5], [1.0, 1.05], [2.05, 0.9], [2.05, 0.34]], glass: [[-1.95, 1.04], [-1.8, 1.4], [0.24, 1.46], [0.95, 1.06]] },
  suv: { body: [[-2.42, 0.42], [-2.42, 1.15], [-2.3, 1.74], [0.4, 1.78], [1.25, 1.2], [2.42, 1.08], [2.42, 0.42]], glass: [[-2.32, 1.2], [-2.24, 1.7], [0.38, 1.74], [1.2, 1.22]] },
  pickup: { body: [[-2.8, 0.44], [-2.8, 1.12], [-0.6, 1.12], [-0.55, 1.78], [0.65, 1.8], [1.35, 1.2], [2.8, 1.1], [2.8, 0.44]], glass: [[-0.56, 1.18], [-0.53, 1.74], [0.63, 1.76], [1.3, 1.22]] },
  turbo: { body: [[-2.15, 0.3], [-2.15, 0.85], [-1.6, 0.92], [-0.55, 1.22], [0.35, 1.25], [1.15, 0.92], [2.15, 0.72], [2.15, 0.3]], glass: [[-1.55, 0.92], [-0.55, 1.2], [0.34, 1.22], [1.1, 0.93]] },
}

// which body points outline the cabin: rear belt, rear roof, front roof, front belt
const CABIN = { sedan: [2, 3, 4, 5], hatch: [1, 2, 3, 4], suv: [1, 2, 3, 4], pickup: [2, 3, 4, 5], turbo: [2, 3, 4, 5] }

const toCar = (geo, width) => {
  // (the shape is drawn in x = along, y = up and pushed out along z; turn it so along is +z)
  geo.translate(0, 0, -width / 2)
  geo.rotateY(-Math.PI / 2)
  return geo
}
const extrude = (pts, width, bevel = 0.06) => {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1 })
  g.translate(0, 0, bevel)
  return toCar(g, width)
}
const tint = (geo, hex) => {
  const g = geo.index ? geo.toNonIndexed() : geo
  g.deleteAttribute("uv")
  const c = new THREE.Color(hex)
  const n = g.attributes.position.count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3))
  return g
}

const cache = new Map()
// -> { paint: BufferGeometry, rest: BufferGeometry } for a model (made once)
export const carGeometry = (model) => {
  if (cache.has(model)) return cache.get(model)
  const p = PROFILES[model] || PROFILES.sedan
  const m = MODELS[model] || MODELS.sedan
  const W = m.wid
  const body = tint(extrude(p.body, W), 0xffffff)
  // (the glass band: a little wider and inside the roof line, so the windows read on every side)
  // (the glass band: the cabin's own outline from the body, pushed out a few cm so it shows on
  // every side, its top just under the roof so the roof stays painted)
  const cab = CABIN[model] || CABIN.sedan
  const pts = cab.map((i) => p.body[i])
  const cx = pts.reduce((a, q) => a + q[0], 0) / 4
  const cy = pts.reduce((a, q) => a + q[1], 0) / 4
  const ring = pts.map(([x, y], k) => {
    const l = Math.hypot(x - cx, y - cy) || 1
    return [x + ((x - cx) / l) * 0.1, y + ((y - cy) / l) * 0.1 - (k === 1 || k === 2 ? 0.16 : 0)]
  })
  const glass = tint(extrude(ring, W + 0.03, 0.02), 0x1c2329)
  const parts = [glass]
  const half = m.wheelbase / 2
  const wr = model === "suv" || model === "pickup" ? 0.38 : 0.33
  for (const [x, z] of [[-1, half], [1, half], [-1, -half], [1, -half]]) {
    const w = new THREE.CylinderGeometry(wr, wr, 0.24, 10)
    w.rotateZ(Math.PI / 2)
    w.translate(x * (W / 2 - 0.08), wr, z)
    parts.push(tint(w, 0x1b1b1c))
    const hub = new THREE.CylinderGeometry(wr * 0.55, wr * 0.55, 0.26, 8)
    hub.rotateZ(Math.PI / 2)
    hub.translate(x * (W / 2 - 0.07), wr, z)
    parts.push(tint(hub, 0x9a9da1))
  }
  const front = p.body[p.body.length - 1][0]
  const rear = p.body[0][0]
  const lightY = model === "turbo" ? 0.62 : model === "suv" || model === "pickup" ? 0.95 : 0.78
  for (const s of [-1, 1]) {
    const hl = new THREE.BoxGeometry(0.42, 0.14, 0.06)
    hl.translate(s * (W / 2 - 0.32), lightY, front + 0.01)
    parts.push(tint(hl, 0xf4f1df))
    const tl = new THREE.BoxGeometry(0.38, 0.13, 0.06)
    tl.translate(s * (W / 2 - 0.3), lightY + 0.05, rear - 0.01)
    parts.push(tint(tl, 0xa0141b))
  }
  // bumpers (dark trim)
  const fb = new THREE.BoxGeometry(W - 0.1, 0.16, 0.12)
  fb.translate(0, 0.42, front + 0.02)
  const rb = new THREE.BoxGeometry(W - 0.1, 0.16, 0.12)
  rb.translate(0, 0.42, rear - 0.02)
  parts.push(tint(fb, 0x2a2b2d), tint(rb, 0x2a2b2d))
  const out = { paint: body, rest: mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))) }
  out.paint.computeBoundingSphere()
  out.rest.computeBoundingSphere()
  cache.set(model, out)
  return out
}

let mats = null
export const carMaterials = () => {
  if (!mats) mats = { paint: new THREE.MeshLambertMaterial({ vertexColors: true }), rest: new THREE.MeshLambertMaterial({ vertexColors: true }) }
  return mats
}

// one car you can see move (yours, a friend's): -> { group, setColor(hex), dispose }
export const makeCarMesh = (model, color) => {
  const g = carGeometry(model)
  const m = carMaterials()
  const paintMat = new THREE.MeshLambertMaterial({ color, vertexColors: true })
  const group = new THREE.Group()
  group.add(new THREE.Mesh(g.paint, paintMat), new THREE.Mesh(g.rest, m.rest))
  if (model === "turbo") {
    // (the Turbo 98's stripe and its underglow)
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 4.2), new THREE.MeshBasicMaterial({ color: 0xff4fa3 }))
    stripe.position.set(0, 1.26, 0)
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.6), new THREE.MeshBasicMaterial({ color: 0x31f2e1, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }))
    glow.rotation.x = -Math.PI / 2
    glow.position.y = 0.06
    group.add(stripe, glow)
  }
  return {
    group,
    setColor: (hex) => paintMat.color.setHex(hex),
    dispose() {
      group.removeFromParent()
      paintMat.dispose()
      for (const c of group.children) if (c.geometry && c.geometry !== g.paint && c.geometry !== g.rest) c.geometry.dispose()
    },
  }
}

// every parked car, instanced per model: set(list) with [{ model, color, x, y, z, yaw, pitch, roll }]
export const createParkedLayer = (scene, cap = 220) => {
  const m = carMaterials()
  const layers = {}
  const mat4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler(0, 0, 0, "YXZ")
  const one = new THREE.Vector3(1, 1, 1)
  const pos = new THREE.Vector3()
  const col = new THREE.Color()
  const layerOf = (model) => {
    if (layers[model]) return layers[model]
    const g = carGeometry(model)
    const paint = new THREE.InstancedMesh(g.paint, m.paint, cap)
    const rest = new THREE.InstancedMesh(g.rest, m.rest, cap)
    paint.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3)
    for (const im of [paint, rest]) {
      im.count = 0
      im.frustumCulled = false
      scene.add(im)
    }
    return (layers[model] = { paint, rest })
  }
  return {
    set(list) {
      const by = {}
      for (const c of list) (by[c.model] ||= []).push(c)
      for (const k of Object.keys(layers)) if (!by[k]) layers[k].paint.count = layers[k].rest.count = 0
      for (const [model, cars] of Object.entries(by)) {
        const L = layerOf(model)
        const n = Math.min(cap, cars.length)
        for (let i = 0; i < n; i++) {
          const c = cars[i]
          e.set(-c.pitch || 0, c.yaw, c.roll || 0)
          q.setFromEuler(e)
          pos.set(c.x, c.y || 0, c.z)
          mat4.compose(pos, q, one)
          L.paint.setMatrixAt(i, mat4)
          L.rest.setMatrixAt(i, mat4)
          L.paint.instanceColor.setXYZ(i, ...col.setHex(c.color).toArray())
        }
        L.paint.count = L.rest.count = n
        L.paint.instanceMatrix.needsUpdate = L.rest.instanceMatrix.needsUpdate = true
        L.paint.instanceColor.needsUpdate = true
      }
    },
    dispose() {
      for (const L of Object.values(layers)) {
        L.paint.removeFromParent()
        L.rest.removeFromParent()
        L.paint.dispose()
        L.rest.dispose()
      }
    },
  }
}
