// Roam: the mapped trees (the map's own trees, tree rows and woods; nothing scattered). Near
// you they're the venues' trees through the host (broad-leaf crowns of crossed leaf cards that
// sway, fan palms with their skirts: park/detail.js treeKit), farther off (and on Low, or with
// no kit) a cheap trunk and a crown blob. Every tree in town is a handful of instanced draws.

import * as THREE from "three"

// which kit kind a spot gets (the same in every browser): kind 1 spots are palms (mostly the
// tall fan palms of Southern California streets), the rest broad-leaf in two shapes
export const kitKindOf = (t) => {
  const h = Math.abs(Math.floor(t.x * 7.31 + t.z * 3.17)) % 10
  // (shrubs and pines aren't in the kit: always the plain shapes)
  if (t.kind === 2 || t.kind === 3) return null
  if (t.kind === 1) return h < 7 ? "fanpalm" : "palm"
  return h % 2 ? "broad1" : "broad0"
}
// flowering shrubs along the streets (bougainvillea magenta, lavender, white, yellow)
const FLOWERS = [0xd6438a, 0x9566c9, 0xefe9dc, 0xe7c447]
// a palm's trunk height from its spot (m)
export const palmHeight = (t, kind) => {
  const f = (((t.x * 13.1 + t.z * 7.7) % 1) + 1) % 1
  return (kind === "fanpalm" ? 13 + f * 6 : 7 + f * 5) * (t.s || 1)
}

// autumn (October, November): the deciduous ones (sycamores, plane trees: about half the broad-leaf
// crowns, by spot) turn yellow-orange; month 0-11 -> how far turned (0..1)
export const autumnOf = (month) => (month === 9 ? 0.75 : month === 10 ? 1 : month === 11 ? 0.45 : 0)
// a broad-leaf crown's colour multiplier (r, g, b) at a spot, given the season
export const crownTint = (t, fall) => {
  const g = (((t.x * 13.1 + t.z * 7.7) % 1) + 1) % 1
  const base = [0.85 + g * 0.25, 0.9 + g * 0.15, 0.8 + g * 0.2]
  const h = (((t.x * 5.3 + t.z * 11.9) % 1) + 1) % 1
  if (!fall || h > 0.5) return base
  // (from green to a sycamore's yellow-orange; a few further along than others)
  const k = fall * (0.55 + h * 0.9)
  const to = [1.45 + g * 0.2, 1.1 + g * 0.15, 0.35]
  return base.map((v, i) => v + (to[i] - v) * Math.min(1, k))
}

export const createTreeLayer = (scene, { cap = 4000, kit = null, nearCap = 0, month = new Date().getMonth() } = {}) => {
  const fall = autumnOf(month)
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
    // (the far, plain trees: thousands of them, so only the kit trees near you cast shadows;
    // the shadow box is 75-120 m round you anyway)
    m.castShadow = false
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
  // shrubs (the aerial's small crowns; some flowering along the streets) and pines
  const shrubGeo = new THREE.IcosahedronGeometry(1, 1)
  shrubGeo.translate(0, 0.55, 0)
  const pineGeo = new THREE.ConeGeometry(1, 1, 8)
  pineGeo.translate(0, 0.5, 0)
  const shrubMat = new THREE.MeshLambertMaterial({ color: 0xffffff })
  const pineMat = new THREE.MeshLambertMaterial({ color: 0x3f5f35 })
  const shrubCap = Math.max(1, Math.round(cap * 0.4))
  const pineCap = Math.max(1, Math.round(cap * 0.2))
  const shrubs = make(shrubGeo, shrubMat, shrubCap)
  shrubs.castShadow = false
  shrubs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(shrubCap * 3), 3)
  const pTrunk2 = make(trunkGeo, bark, pineCap)
  const pines = make(pineGeo, pineMat, pineCap)
  // ---- the near trees (the kit) ----
  const kitMeshes = {} // kind -> [{ mesh, part }]
  if (kit && nearCap > 0)
    for (const [kind, parts] of Object.entries(kit.kinds)) {
      const n = kind.startsWith("broad") ? nearCap : Math.max(8, Math.round(nearCap * 0.4))
      kitMeshes[kind] = parts.map((part) => {
        const mesh = make(part.geo, part.mat, n)
        mesh.userData.kitShared = true
        mesh.castShadow = true
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
  const c2 = new THREE.Color()
  const up = new THREE.Vector3(0, 1, 0)
  return {
    // list: [{ x, y, z, s, kind }] (kind 1: a palm); near(t): drawn with the kit
    set(list, near = () => false) {
      let n = 0
      let p = 0
      let sh = 0
      let pi = 0
      const counts = {}
      for (const t of list) {
        const k = t.s || 1
        const yaw = (t.x * 3.7 + t.z * 5.1) % 6.28
        if (t.kind === 2) {
          // (a shrub: s is its radius in metres)
          if (sh >= shrubCap) continue
          q.setFromAxisAngle(up, yaw)
          if (t.hedge) m4.compose(v.set(t.x, t.y - 0.1, t.z), q, s.set(k * 1.15, Math.min(1.1, k * 0.5), k * 1.15))
          else m4.compose(v.set(t.x, t.y - 0.15, t.z), q, s.set(k, k * 0.72, k * 0.9))
          shrubs.setMatrixAt(sh, m4)
          const g = ((t.x * 13.1 + t.z * 7.7) % 1 + 1) % 1
          if (t.flower) c.setHex(FLOWERS[(t.flower - 1) % FLOWERS.length]).lerp(c2.setRGB(0.3, 0.5, 0.22), 0.3)
          else if (t.hedge) c.setRGB(0.22 + g * 0.06, 0.4 + g * 0.08, 0.17)
          else c.setRGB(0.3 + g * 0.12, 0.48 + g * 0.12, 0.2 + g * 0.06)
          shrubs.instanceColor.setXYZ(sh, c.r, c.g, c.b)
          sh++
          continue
        }
        if (t.kind === 3) {
          // (a pine: a tall dark cone on a short trunk)
          if (pi >= pineCap) continue
          const h = 8 + k * 7
          q.setFromAxisAngle(up, yaw)
          m4.compose(v.set(t.x, t.y - 0.2, t.z), q, s.set(k, 2.2, k))
          pTrunk2.setMatrixAt(pi, m4)
          m4.compose(v.set(t.x, t.y + 1.6, t.z), q, s.set(2.1 * k + 0.5, h, 2.1 * k + 0.5))
          pines.setMatrixAt(pi, m4)
          pi++
          continue
        }
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
                if (t.kind === 1) mesh.instanceColor.setXYZ(i, 0.9 + g * 0.15, 0.92 + g * 0.1, 0.85 + g * 0.12)
                else mesh.instanceColor.setXYZ(i, ...crownTint(t, fall))
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
        crowns.instanceColor.setXYZ(n, ...crownTint(t, fall))
        n++
      }
      trunks.count = crowns.count = n
      pTrunks.count = pCrowns.count = p
      shrubs.count = sh
      pTrunk2.count = pines.count = pi
      shrubs.instanceColor.needsUpdate = true
      for (const m of [trunks, crowns, pTrunks, pCrowns, shrubs, pTrunk2, pines]) m.instanceMatrix.needsUpdate = true
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
      for (const g of [trunkGeo, crownGeo, palmTrunk, palmCrown, shrubGeo, pineGeo]) g.dispose()
      for (const m of [bark, leaf, frond, shrubMat, pineMat]) m.dispose()
    },
  }
}
