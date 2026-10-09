// Roam: the mapped trees (the map's own trees, tree rows and woods; nothing scattered). Near
// you they're the venues' trees through the host (broad-leaf crowns of crossed leaf cards that
// sway, fan palms with their skirts: park/detail.js treeKit), farther off (and on Low, or with
// no kit) a cheap trunk and a crown blob. Every tree in town is a handful of instanced draws.

import * as THREE from "three"

// which kit kind a spot gets (the same in every browser): kind 1 spots are palms (mostly the
// tall fan palms of Southern California streets), the rest broad-leaf in two shapes
export const kitKindOf = (t) => {
  const h = Math.abs(Math.floor(t.x * 7.31 + t.z * 3.17)) % 10
  if (t.kind === 1) return h < 7 ? "fanpalm" : "palm"
  return h % 2 ? "broad1" : "broad0"
}
// a palm's trunk height from its spot (m)
export const palmHeight = (t, kind) => {
  const f = (((t.x * 13.1 + t.z * 7.7) % 1) + 1) % 1
  return (kind === "fanpalm" ? 13 + f * 6 : 7 + f * 5) * (t.s || 1)
}

export const createTreeLayer = (scene, { cap = 4000, kit = null, nearCap = 0 } = {}) => {
  if (!cap) return { set() {}, dispose() {} }
  // ---- the far (or plain) trees ----
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6)
  trunkGeo.translate(0, 0.5, 0)
  const crownGeo = new THREE.IcosahedronGeometry(1, 0)
  const palmTrunk = new THREE.CylinderGeometry(0.17, 0.24, 1, 6)
  palmTrunk.translate(0, 0.5, 0)
  const palmCrown = new THREE.ConeGeometry(2.6, 1.6, 7, 1, true)
  palmCrown.rotateX(Math.PI)
  const bark = new THREE.MeshLambertMaterial({ color: 0x6b5541 })
  const leaf = new THREE.MeshLambertMaterial({ color: 0x55743a })
  const frond = new THREE.MeshLambertMaterial({ color: 0x6f8f45, side: THREE.DoubleSide })
  const own = []
  const make = (geo, mat, n) => {
    const m = new THREE.InstancedMesh(geo, mat, n)
    m.count = 0
    m.frustumCulled = false
    m.castShadow = true
    m.receiveShadow = true
    scene.add(m)
    own.push(m)
    return m
  }
  const palmCap = Math.max(1, Math.round(cap * 0.25))
  const trunks = make(trunkGeo, bark, cap)
  const crowns = make(crownGeo, leaf, cap)
  const pTrunks = make(palmTrunk, bark, palmCap)
  const pCrowns = make(palmCrown, frond, palmCap)
  crowns.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3)
  // ---- the near trees (the kit) ----
  const kitMeshes = {} // kind -> [{ mesh, part }]
  if (kit && nearCap > 0)
    for (const [kind, parts] of Object.entries(kit.kinds)) {
      const n = kind.startsWith("broad") ? nearCap : Math.max(8, Math.round(nearCap * 0.4))
      kitMeshes[kind] = parts.map((part) => {
        const mesh = make(part.geo, part.mat, n)
        mesh.userData.kitShared = true
        if (part.crown) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3)
        kit.tick?.(mesh)
        return { mesh, part, cap: n }
      })
    }
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const v = new THREE.Vector3()
  const s = new THREE.Vector3()
  const c = new THREE.Color()
  const up = new THREE.Vector3(0, 1, 0)
  return {
    // list: [{ x, y, z, s, kind }] (kind 1: a palm); near(t): drawn with the kit
    set(list, near = () => false) {
      let n = 0
      let p = 0
      const counts = {}
      for (const t of list) {
        const k = t.s || 1
        const yaw = (t.x * 3.7 + t.z * 5.1) % 6.28
        if (kit && near(t)) {
          const kind = kitKindOf(t)
          const parts = kitMeshes[kind]
          const i = counts[kind] || 0
          if (parts && i < parts[0].cap) {
            counts[kind] = i + 1
            const h = palmHeight(t, kind)
            q.setFromAxisAngle(up, yaw)
            for (const { mesh, part } of parts) {
              if (part.place === "trunk") m4.compose(v.set(t.x, t.y - 0.1, t.z), q, s.set(k, h, k))
              else if (part.place === "head") m4.compose(v.set(t.x, t.y + h + (part.dy || 0), t.z), q, s.setScalar(Math.max(0.8, k) * (part.k || 1)))
              else m4.compose(v.set(t.x, t.y - 0.1, t.z), q, s.setScalar(k * 1.15))
              mesh.setMatrixAt(i, m4)
              if (part.crown) {
                const g = ((t.x * 13.1 + t.z * 7.7) % 1 + 1) % 1
                mesh.instanceColor.setXYZ(i, 0.9 + g * 0.15, 0.92 + g * 0.1, 0.85 + g * 0.12)
              }
            }
            continue
          }
        }
        if (t.kind === 1 && p < palmCap) {
          const h = palmHeight(t, "fanpalm")
          q.setFromAxisAngle(up, yaw)
          m4.compose(v.set(t.x, t.y - 0.2, t.z), q, s.set(k, h, k))
          pTrunks.setMatrixAt(p, m4)
          m4.compose(v.set(t.x, t.y + h - 0.6, t.z), q, s.set(k * 0.8, k * 0.8, k * 0.8))
          pCrowns.setMatrixAt(p, m4)
          p++
          continue
        }
        if (n >= cap) continue
        const h = 2.4 + k * 1.6
        q.setFromAxisAngle(up, yaw)
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
      for (const [kind, parts] of Object.entries(kitMeshes))
        for (const { mesh, part } of parts) {
          mesh.count = counts[kind] || 0
          mesh.instanceMatrix.needsUpdate = true
          if (part.crown) mesh.instanceColor.needsUpdate = true
        }
    },
    get nearCount() {
      return Object.values(kitMeshes).reduce((a, parts) => a + (parts[0]?.mesh.count || 0), 0)
    },
    dispose() {
      for (const m of own) {
        m.removeFromParent()
        // (the kit's geometries and materials are shared and kept)
        if (!m.userData.kitShared) m.dispose()
        else m.dispose?.()
      }
      for (const g of [trunkGeo, crownGeo, palmTrunk, palmCrown]) g.dispose()
      for (const m of [bark, leaf, frond]) m.dispose()
    },
  }
}
