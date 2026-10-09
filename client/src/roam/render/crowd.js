// Roam: the café tables and the people sitting at them (sim/tables.js says where). Instanced,
// modelled in code (nothing downloaded): a round bistro table, a chair, and a seated person in
// four parts (shirt, trousers, skin, hair) whose colours vary per instance. Six draws for every
// table in sight; drawn within ~110 m (they're small).

import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"

const box = (w, h, d, x, y, z, rx = 0) => {
  const g = new THREE.BoxGeometry(w, h, d)
  if (rx) g.rotateX(rx)
  g.translate(x, y, z)
  return g
}
const cyl = (r0, r1, h, x, y, z, seg = 8, rx = 0) => {
  const g = new THREE.CylinderGeometry(r0, r1, h, seg)
  if (rx) g.rotateX(rx)
  g.translate(x, y, z)
  return g
}
const plain = (g) => {
  // (one attribute set for merging: position, normal, uv)
  const out = g.index ? g.toNonIndexed() : g
  for (const k of Object.keys(out.attributes)) if (!["position", "normal", "uv"].includes(k)) out.deleteAttribute(k)
  return out
}
const merge = (list) => mergeGeometries(list.map(plain))

// the parts, in the chair's frame: facing +z (toward the table), seat 0.46 m up
export const crowdGeometries = () => {
  const table = merge([cyl(0.38, 0.38, 0.03, 0, 0.74, 0, 16), cyl(0.03, 0.03, 0.72, 0, 0.37, 0, 6), cyl(0.22, 0.24, 0.03, 0, 0.015, 0, 10)])
  const chair = merge([box(0.42, 0.04, 0.42, 0, 0.45, 0), box(0.42, 0.42, 0.04, 0, 0.68, -0.2), ...[-0.18, 0.18].flatMap((x) => [cyl(0.015, 0.015, 0.45, x, 0.225, -0.18, 5), cyl(0.015, 0.015, 0.45, x, 0.225, 0.18, 5)])])
  // a seated person: hips on the seat, thighs forward, shins down, torso up, forearms toward the table
  const shirt = merge([
    box(0.36, 0.5, 0.22, 0, 0.78, -0.06), // torso
    box(0.12, 0.28, 0.12, -0.23, 0.86, -0.04), // upper arms
    box(0.12, 0.28, 0.12, 0.23, 0.86, -0.04),
  ])
  const pants = merge([
    box(0.36, 0.14, 0.2, 0, 0.53, -0.07), // hips
    box(0.15, 0.14, 0.42, -0.1, 0.53, 0.17), // thighs
    box(0.15, 0.14, 0.42, 0.1, 0.53, 0.17),
    box(0.12, 0.46, 0.13, -0.1, 0.25, 0.36), // shins
    box(0.12, 0.46, 0.13, 0.1, 0.25, 0.36),
    box(0.12, 0.07, 0.24, -0.1, 0.035, 0.41), // shoes
    box(0.12, 0.07, 0.24, 0.1, 0.035, 0.41),
  ])
  const skinGeo = new THREE.SphereGeometry(0.11, 10, 8)
  skinGeo.scale(0.9, 1.08, 0.98)
  skinGeo.translate(0, 1.18, -0.04)
  const skin = merge([skinGeo, box(0.08, 0.08, 0.08, 0, 1.06, -0.05), box(0.09, 0.09, 0.3, -0.21, 0.73, 0.12), box(0.09, 0.09, 0.3, 0.21, 0.73, 0.12)])
  const hairGeo = new THREE.SphereGeometry(0.118, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55)
  hairGeo.scale(0.92, 1.05, 1)
  hairGeo.translate(0, 1.2, -0.055)
  const hair = merge([hairGeo])
  return { table, chair, shirt, pants, skin, hair }
}

export const createCrowdLayer = (scene, { cap = 60, shadows = true } = {}) => {
  const geos = crowdGeometries()
  const mats = {
    table: new THREE.MeshLambertMaterial({ color: 0x2c2f33 }),
    chair: new THREE.MeshLambertMaterial({ color: 0x3a3d40 }),
    shirt: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    pants: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    skin: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    hair: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  }
  const meshes = {}
  for (const k of Object.keys(geos)) {
    const n = k === "table" ? cap : cap * 4
    const m = new THREE.InstancedMesh(geos[k], mats[k], n)
    m.count = 0
    m.frustumCulled = false
    m.castShadow = shadows && k !== "hair"
    m.receiveShadow = true
    if (["shirt", "pants", "skin", "hair"].includes(k)) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3)
    scene.add(m)
    meshes[k] = m
  }
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const v = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)
  const up = new THREE.Vector3(0, 1, 0)
  const c = new THREE.Color()
  return {
    // tables: [{ x, y, z, yaw, chairs: [{ x, y, z, yaw, person }] }] (already the nearest)
    set(tables) {
      let t = 0
      let ch = 0
      let p = 0
      for (const tb of tables) {
        if (t >= cap) break
        q.setFromAxisAngle(up, tb.yaw)
        m4.compose(v.set(tb.x, tb.y, tb.z), q, one)
        meshes.table.setMatrixAt(t++, m4)
        for (const s of tb.chairs) {
          if (ch >= cap * 4) break
          q.setFromAxisAngle(up, s.yaw)
          m4.compose(v.set(s.x, s.y ?? tb.y, s.z), q, one)
          meshes.chair.setMatrixAt(ch++, m4)
          if (!s.person) continue
          for (const k of ["shirt", "pants", "skin", "hair"]) {
            meshes[k].setMatrixAt(p, m4)
            meshes[k].instanceColor.setXYZ(p, ...c.setHex(s.person[k === "skin" ? "skin" : k]).toArray())
          }
          p++
        }
      }
      meshes.table.count = t
      meshes.chair.count = ch
      for (const k of ["shirt", "pants", "skin", "hair"]) {
        meshes[k].count = p
        meshes[k].instanceColor.needsUpdate = true
      }
      for (const m of Object.values(meshes)) m.instanceMatrix.needsUpdate = true
    },
    get count() {
      return meshes.shirt.count
    },
    dispose() {
      for (const m of Object.values(meshes)) {
        m.removeFromParent()
        m.geometry.dispose()
        m.dispose()
      }
      for (const m of Object.values(mats)) m.dispose()
    },
  }
}
