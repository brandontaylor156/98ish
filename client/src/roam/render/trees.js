// Roam: the mapped trees, instanced (a trunk and a crown each; a palm now and then): four
// draw calls for every tree in town.

import * as THREE from "three"

export const createTreeLayer = (scene, { cap = 4000 } = {}) => {
  if (!cap) return { set() {}, dispose() {} }
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6)
  trunkGeo.translate(0, 0.5, 0)
  const crownGeo = new THREE.IcosahedronGeometry(1, 0)
  const palmTrunk = new THREE.CylinderGeometry(0.17, 0.24, 1, 6)
  palmTrunk.translate(0, 0.5, 0)
  const palmCrown = new THREE.ConeGeometry(2.6, 1.6, 7, 1, true)
  palmCrown.rotateX(Math.PI)
  const bark = new THREE.MeshLambertMaterial({ color: 0x6b5541 })
  const leaf = new THREE.MeshLambertMaterial({ color: 0x5d7f3e, flatShading: true })
  const frond = new THREE.MeshLambertMaterial({ color: 0x6f8f45, side: THREE.DoubleSide })
  const make = (geo, mat, n) => {
    const m = new THREE.InstancedMesh(geo, mat, n)
    m.count = 0
    m.frustumCulled = false
    scene.add(m)
    return m
  }
  const palmCap = Math.max(1, Math.round(cap * 0.25))
  const trunks = make(trunkGeo, bark, cap)
  const crowns = make(crownGeo, leaf, cap)
  const pTrunks = make(palmTrunk, bark, palmCap)
  const pCrowns = make(palmCrown, frond, palmCap)
  crowns.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const v = new THREE.Vector3()
  const s = new THREE.Vector3()
  const c = new THREE.Color()
  const up = new THREE.Vector3(0, 1, 0)
  return {
    // list: [{ x, y, z, s, kind }] (kind 1: a palm)
    set(list) {
      let n = 0
      let p = 0
      for (const t of list) {
        const k = t.s || 1
        if (t.kind === 1 && p < palmCap) {
          const h = 7 + k * 4
          q.setFromAxisAngle(up, (t.x * 7.1 + t.z * 3.3) % 6.28)
          m4.compose(v.set(t.x, t.y - 0.2, t.z), q, s.set(k, h, k))
          pTrunks.setMatrixAt(p, m4)
          m4.compose(v.set(t.x, t.y + h - 0.6, t.z), q, s.set(k * 0.9, k * 0.9, k * 0.9))
          pCrowns.setMatrixAt(p, m4)
          p++
          continue
        }
        if (n >= cap) continue
        const h = 2.2 + k * 1.6
        q.setFromAxisAngle(up, (t.x * 3.7 + t.z * 5.1) % 6.28)
        m4.compose(v.set(t.x, t.y - 0.2, t.z), q, s.set(k, h, k))
        trunks.setMatrixAt(n, m4)
        const r = 2.1 * k + 0.6
        m4.compose(v.set(t.x, t.y + h + r * 0.55, t.z), q, s.set(r, r * 0.85, r))
        crowns.setMatrixAt(n, m4)
        const g = ((t.x * 13.1 + t.z * 7.7) % 1 + 1) % 1
        crowns.instanceColor.setXYZ(n, ...c.setRGB(0.85 + g * 0.25, 0.9 + g * 0.15, 0.8 + g * 0.2).toArray())
        n++
      }
      trunks.count = crowns.count = n
      pTrunks.count = pCrowns.count = p
      for (const m of [trunks, crowns, pTrunks, pCrowns]) m.instanceMatrix.needsUpdate = true
      crowns.instanceColor.needsUpdate = true
    },
    dispose() {
      for (const m of [trunks, crowns, pTrunks, pCrowns]) {
        m.removeFromParent()
        m.dispose()
      }
      for (const g of [trunkGeo, crownGeo, palmTrunk, palmCrown]) g.dispose()
      for (const m of [bark, leaf, frond]) m.dispose()
    },
  }
}
