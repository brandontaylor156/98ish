// Roam: the bikes and e-scooters (sim/fleet.js), modelled in code (nothing downloaded): a
// city bike (step-through frame, basket, fenders) and a stand-up e-scooter (deck, stem, bars).
// Parked ones are instanced (one draw a kind); the one you ride is its own mesh with wheels that
// roll and bars that steer, and it leans into turns.

import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"

const DARK = 0x1c1d20
const GREY = 0x8a8d92
const SEAT = 0x2a2420

// a part with one colour (vertex colours, so a whole vehicle is one geometry)
const tint = (g, hex) => {
  const out = g.index ? g.toNonIndexed() : g
  for (const k of Object.keys(out.attributes)) if (!["position", "normal"].includes(k)) out.deleteAttribute(k)
  const c = new THREE.Color(hex)
  const n = out.attributes.position.count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3)
  out.setAttribute("color", new THREE.BufferAttribute(col, 3))
  return out
}
// a tube from a to b ([x, y, z], z forward)
const tube = (a, b, r, hex) => {
  const A = new THREE.Vector3(...a)
  const B = new THREE.Vector3(...b)
  const L = A.distanceTo(B)
  const g = new THREE.CylinderGeometry(r, r, L, 6)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()))
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2)
  return tint(g, hex)
}
const box = (w, h, d, x, y, z, hex) => tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex)
const wheelGeo = (R, w) => {
  const tire = new THREE.TorusGeometry(R - w / 2, w / 2, 6, 18)
  tire.rotateY(Math.PI / 2)
  const hub = new THREE.CylinderGeometry(0.03, 0.03, 0.08, 6)
  hub.rotateZ(Math.PI / 2)
  const spokes = []
  for (let k = 0; k < 3; k++) {
    const s = new THREE.BoxGeometry(0.008, (R - w) * 2, 0.012)
    s.rotateX((k / 3) * Math.PI)
    spokes.push(tint(s, GREY))
  }
  return mergeGeometries([tint(tire, DARK), tint(hub, GREY), ...spokes])
}

// the parts of a kind: { body (frame, no wheels), wheel, wheels: [{ y, z, front }], R, deck (where
// your feet are, m) }
export const twoWheelerParts = (kind, color) => {
  if (kind === "scooter") {
    const R = 0.1
    const body = mergeGeometries([
      box(0.15, 0.05, 0.78, 0, 0.12, -0.02, color), // the deck
      box(0.13, 0.012, 0.6, 0, 0.152, -0.02, DARK), // grip tape
      tube([0, 0.13, 0.36], [0, 1.0, 0.44], 0.022, GREY), // the stem
      tube([-0.24, 1.0, 0.44], [0.24, 1.0, 0.44], 0.016, DARK), // the bars
      box(0.07, 0.07, 0.04, 0, 0.92, 0.47, color), // the light and the brand's plate
      box(0.08, 0.02, 0.2, 0, 0.21, -0.43, color), // the rear fender
      tube([0, 0.13, 0.36], [0, R, 0.41], 0.02, GREY), // the fork
    ])
    return { body, wheel: wheelGeo(R, 0.05), wheels: [{ y: R, z: 0.41, front: true }, { y: R, z: -0.4, front: false }], R, deck: 0.16, len: 1.15 }
  }
  const R = 0.33
  const fz = 0.52
  const rz = -0.52
  const body = mergeGeometries([
    tube([0, R, rz], [0, 0.42, -0.02], 0.022, color), // chain stay to the bottom bracket
    tube([0, 0.42, -0.02], [0, 0.86, -0.18], 0.024, color), // seat tube
    tube([0, 0.42, -0.02], [0, 0.82, 0.36], 0.026, color), // step-through down tube
    tube([0, 0.82, 0.36], [0, R, fz], 0.02, GREY), // the fork
    tube([0, 0.82, 0.36], [0, 1.05, 0.32], 0.02, GREY), // the stem
    tube([-0.27, 1.05, 0.3], [0.27, 1.05, 0.3], 0.015, DARK), // the bars
    tube([0, 0.86, -0.18], [0, R, rz], 0.016, color), // seat stays
    box(0.16, 0.05, 0.26, 0, 0.9, -0.2, SEAT), // the saddle
    box(0.3, 0.18, 0.26, 0, 0.95, 0.56, DARK), // the basket
    box(0.07, 0.015, 0.5, 0, R + 0.05, rz + 0.04, color), // fenders
    box(0.07, 0.015, 0.4, 0, R + 0.05, fz - 0.04, color),
    box(0.18, 0.02, 0.06, 0, 0.42, -0.02, DARK), // pedals
  ])
  return { body, wheel: wheelGeo(R, 0.045), wheels: [{ y: R, z: fz, front: true }, { y: R, z: rz, front: false }], R, deck: 0.42, len: 1.75 }
}

const placedWheels = (p) => p.wheels.map((w) => p.wheel.clone().translate(0, w.y, w.z))

// the parked ones: one instanced mesh a kind -> { set(list: [{ kind, x, y, z, yaw }]), dispose }
export const createFleetLayer = (scene, { cap = 40 } = {}) => {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true })
  const kinds = {}
  for (const [kind, color] of [["bike", 0x16a596], ["scooter", 0xf09a2a]]) {
    const p = twoWheelerParts(kind, color)
    const m = new THREE.InstancedMesh(mergeGeometries([p.body, ...placedWheels(p)]), mat, cap)
    m.count = 0
    m.frustumCulled = false
    m.castShadow = true
    scene.add(m)
    kinds[kind] = m
  }
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const v = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)
  const up = new THREE.Vector3(0, 1, 0)
  // (parked on its kickstand: tipped a little)
  const tip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.12)
  return {
    set(list) {
      const n = { bike: 0, scooter: 0 }
      for (const f of list) {
        const m = kinds[f.kind]
        if (!m || n[f.kind] >= cap) continue
        q.setFromAxisAngle(up, f.yaw).multiply(tip)
        m4.compose(v.set(f.x, f.y, f.z), q, one)
        m.setMatrixAt(n[f.kind]++, m4)
      }
      for (const [k, m] of Object.entries(kinds)) {
        m.count = n[k]
        m.instanceMatrix.needsUpdate = true
      }
    },
    dispose() {
      for (const m of Object.values(kinds)) {
        m.removeFromParent()
        m.geometry.dispose()
        m.dispose()
      }
      mat.dispose()
    },
  }
}

// the one you ride: -> { group, body, deck, setWheels(steer, dist), setLean(a), setBrake, setColor, dispose }
export const makeTwoWheeler = (kind, color) => {
  const p = twoWheelerParts(kind, color)
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true })
  const group = new THREE.Group()
  const body = new THREE.Group() // (leans into turns)
  group.add(body)
  const frame = new THREE.Mesh(p.body, mat)
  frame.castShadow = true
  body.add(frame)
  const wheels = p.wheels.map((w) => {
    const pivot = new THREE.Group()
    pivot.position.set(0, w.y, w.z)
    const spin = new THREE.Mesh(p.wheel.clone().translate(0, 0, 0), mat)
    spin.castShadow = true
    pivot.add(spin)
    body.add(pivot)
    return { pivot, spin, front: w.front }
  })
  let roll = 0
  return {
    group,
    body,
    deck: p.deck,
    setColor() {},
    setWheels(steer, dist) {
      roll = (roll + dist / p.R) % (Math.PI * 2)
      for (const w of wheels) {
        if (w.front) w.pivot.rotation.y = -steer
        w.spin.rotation.x = roll
      }
    },
    setLean(a) {
      body.rotation.z = a
    },
    setBrake() {},
    dispose() {
      group.removeFromParent()
      p.body.dispose()
      p.wheel.dispose()
      for (const w of wheels) w.spin.geometry.dispose()
      mat.dispose()
    },
  }
}
