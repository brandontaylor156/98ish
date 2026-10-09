// Roam: the trees (the map's own trees, tree rows and woods, and the crowns the USGS NAIP aerial
// shows; nothing scattered). Near you: the town's own species modelled in code
// (render/treekit.js: sycamores and planes, oaks, round evergreens, pines, shrubs; one instanced
// draw a species) sized from the aerial's crowns, trimmed hedges in curbed islands, and the
// venues' palms through the host (fan palms with their skirts). Farther off: billboards painted
// from the same species (two triangles a tree). Every tree in town is a handful of draws.

import * as THREE from "three"
import { IMP_LIST, SPECIES, hedgeArrays, impostorSize, paintAtlas, paintImpostors, speciesArrays, speciesSize } from "./treekit.js"

// which kit kind a spot gets (the same in every browser): kind 1 spots are palms (mostly the
// tall fan palms of Southern California streets); the rest are the town's own species (null)
export const kitKindOf = (t) => {
  const h = Math.abs(Math.floor(t.x * 7.31 + t.z * 3.17)) % 10
  if (t.kind === 1) return h < 7 ? "fanpalm" : "palm"
  return null
}
// the species a (non-palm) tree spot is drawn as
export const speciesOf = (t) => (t.kind === 3 ? "pine" : t.kind === 2 ? "shrub" : SPECIES[t.sp] ? t.sp : "round")
// flowering shrubs along the streets (bougainvillea magenta, lavender, white, yellow)
const FLOWERS = [0xd6438a, 0x9566c9, 0xefe9dc, 0xe7c447]
// a palm's trunk height from its spot (m)
export const palmHeight = (t, kind) => {
  const f = (((t.x * 13.1 + t.z * 7.7) % 1) + 1) % 1
  return (kind === "fanpalm" ? 13 + f * 6 : 7 + f * 5) * (t.s || 1)
}

// autumn (October, November): the deciduous ones (the sycamores and plane trees) turn
// yellow-orange; month 0-11 -> how far turned (0..1)
export const autumnOf = (month) => (month === 9 ? 0.4 : month === 10 ? 0.9 : month === 11 ? 0.6 : 0)
// the leaves' colour (sRGB 0..1) of a species, and the plane trees' fall colour
export const LEAF = {
  plane: [0.43, 0.51, 0.25],
  oak: [0.25, 0.33, 0.17],
  round: [0.31, 0.42, 0.2],
  pine: [0.22, 0.31, 0.2],
  shrub: [0.32, 0.43, 0.2],
}
const FALL = [0.62, 0.53, 0.24]
// a tree's leaf colour (sRGB 0..1) at a spot, given the season: each tree a little different,
// the planes turning (some further along than others, a few still green)
export const crownTint = (t, fall, sp = speciesOf(t)) => {
  const g = (((t.x * 13.1 + t.z * 7.7) % 1) + 1) % 1
  const base = LEAF[sp] || LEAF.round
  const v = [0.88 + g * 0.24, 0.9 + g * 0.18, 0.86 + g * 0.2]
  let c = base.map((b, i) => b * v[i])
  if (sp === "plane" && fall) {
    const h = (((t.x * 5.3 + t.z * 11.9) % 1) + 1) % 1
    const k = Math.min(1, fall * (0.35 + h * 0.9))
    const to = [FALL[0] * (0.9 + g * 0.2), FALL[1] * (0.85 + h * 0.3), FALL[2]]
    c = c.map((x, i) => x + (to[i] - x) * k)
  }
  return c
}

const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))

// the leaf material: the atlas, alpha-tested, both sides lit alike (the cards' normals point out
// of the crown, so a back face mustn't flip them), the instance's tint on the leaves only, a
// little sway in the wind
const leafMaterial = (map, time) => {
  const m = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true })
  m.onBeforeCompile = (sh) => {
    sh.uniforms.roamWind = time
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float leafy;\nuniform float roamWind;")
      .replace("#include <color_vertex>", THREE.ShaderChunk.color_vertex.replace("vColor.rgb *= instanceColor.rgb;", "vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, leafy);"))
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  {
    vec2 wp = vec2(0.0);
    #ifdef USE_INSTANCING
      wp = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
    #endif
    float sw = leafy * max(0.0, position.y - 2.0) * 0.012;
    transformed.x += sin(roamWind * 1.3 + wp.x * 0.21 + position.y * 0.35) * sw;
    transformed.z += sin(roamWind * 1.1 + wp.y * 0.17 + position.x * 0.5) * sw * 0.7;
  }`
      )
    sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_begin>", THREE.ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", ""))
  }
  m.customProgramCacheKey = () => "roam-leaves-1"
  return m
}

// the billboards: a quad facing you round the vertical, its picture the species' impostor cell
const billboardMaterial = (map) => {
  const m = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5 })
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float impCell;\nconst float IMP_N = ${IMP_LIST.length}.0;`)
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.x = (impCell + vMapUv.x) / IMP_N;\n#endif")
      .replace(
        "#include <project_vertex>",
        `vec3 bbDir = vec3(0.0, 0.0, 1.0);
  vec4 mvPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  {
    vec3 ip = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
    float sx = length(instanceMatrix[0].xyz);
    float sy = length(instanceMatrix[1].xyz);
    vec3 toCamF = normalize(cameraPosition - ip + vec3(1e-4, 0.0, 0.0));
    vec3 toCam = cameraPosition - ip;
    toCam.y = 0.0;
    bbDir = normalize(toCam + vec3(1e-4, 0.0, 0.0));
    vec3 right = vec3(bbDir.z, 0.0, -bbDir.x);
    // (upright from the street; seen from above (a hill, a bridge) it leans back to face you, so
    // the crowns don't vanish edge-on)
    vec3 upv = normalize(cross(toCamF, right));
    upv = normalize(mix(vec3(0.0, 1.0, 0.0), upv, smoothstep(0.25, 0.9, toCamF.y)));
    vec3 wp = ip + right * position.x * sx + upv * position.y * sy;
    mvPosition = viewMatrix * vec4(wp, 1.0);
  }
  #endif
  gl_Position = projectionMatrix * mvPosition;`
      )
      .replace("#include <fog_vertex>", "#include <fog_vertex>\nvNormal = normalize((viewMatrix * vec4(normalize(bbDir * 0.55 + vec3(0.0, 0.85, 0.0)), 0.0)).xyz);")
  }
  m.customProgramCacheKey = () => "roam-billboards-1"
  return m
}

const geometryOf = (a) => {
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.BufferAttribute(a.position, 3))
  g.setAttribute("normal", new THREE.BufferAttribute(a.normal, 3))
  g.setAttribute("uv", new THREE.BufferAttribute(a.uv, 2))
  if (a.color) g.setAttribute("color", new THREE.BufferAttribute(a.color, 3))
  if (a.leafy) g.setAttribute("leafy", new THREE.BufferAttribute(a.leafy, 1))
  g.setIndex(new THREE.BufferAttribute(a.index, 1))
  g.computeBoundingSphere()
  return g
}

export const createTreeLayer = (scene, { cap = 4000, kit = null, nearCap = 0, month = new Date().getMonth(), anisotropy = 1 } = {}) => {
  const fall = autumnOf(month)
  if (!cap) return { set() {}, dispose() {}, nearCount: 0 }
  const atlas = paintAtlas()
  const imp = atlas ? paintImpostors(atlas) : null
  if (!atlas || !imp) return { set() {}, dispose() {}, nearCount: 0 }
  const tex = (a) => {
    const t = new THREE.DataTexture(a.data, a.w, a.h, THREE.RGBAFormat)
    t.colorSpace = THREE.SRGBColorSpace
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.generateMipmaps = true
    t.anisotropy = anisotropy
    t.needsUpdate = true
    return t
  }
  const atlasTex = tex(atlas)
  const impTex = tex(imp)
  const time = { value: 0 }
  const leafMat = leafMaterial(atlasTex, time)
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlasTex, alphaTest: 0.5, side: THREE.DoubleSide })
  const hedgeMat = new THREE.MeshLambertMaterial({ map: atlasTex, color: 0xffffff })
  const curbMat = new THREE.MeshLambertMaterial({ vertexColors: true })
  const bbMat = billboardMaterial(impTex)
  const own = []
  const geos = []
  const make = (geo, mat, n, { shadow = false, color = false } = {}) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n))
    m.count = 0
    m.frustumCulled = false
    m.castShadow = shadow
    m.receiveShadow = true
    if (shadow) m.customDepthMaterial = depthMat
    if (color) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3).fill(1), 3)
    scene.add(m)
    own.push(m)
    return m
  }
  // ---- the near trees: one mesh a species ----
  const near = {}
  const nearN = Math.max(1, nearCap)
  for (const sp of ["plane", "oak", "round", "pine"]) {
    const g = geometryOf(speciesArrays(sp, 1))
    geos.push(g)
    near[sp] = make(g, leafMat, sp === "pine" ? Math.round(nearN * 0.4) : nearN, { shadow: true, color: true })
    near[sp].name = `trees-near-${sp}`
  }
  near.plane.onBeforeRender = () => (time.value = performance.now() / 1000)
  const shrubCap = Math.round(nearN * 1.6)
  const shrubGeo = geometryOf(speciesArrays("shrub", 1))
  geos.push(shrubGeo)
  const shrubs = make(shrubGeo, leafMat, shrubCap, { color: true })
  // hedges and their curbed islands (mulch on top, concrete sides)
  const hedgeGeo = geometryOf(hedgeArrays())
  const curbGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed()
  {
    const n = curbGeo.attributes.position.count
    const col = new Float32Array(n * 3)
    const nrm = curbGeo.attributes.normal
    for (let i = 0; i < n; i++) {
      const top = nrm.getY(i) > 0.5
      col.set(top ? [0.2, 0.13, 0.08] : [0.62, 0.6, 0.56], i * 3)
    }
    curbGeo.setAttribute("color", new THREE.BufferAttribute(col, 3))
  }
  geos.push(hedgeGeo, curbGeo)
  const hedgeCap = Math.round(nearN * 1.2)
  const hedges = make(hedgeGeo, hedgeMat, hedgeCap, { color: true })
  const curbCap = hedgeCap + nearN
  const curbs = make(curbGeo, curbMat, curbCap)
  // ---- the venues' palms near you (the host's kit) ----
  const kitMeshes = {} // kind -> [{ mesh, part }]
  if (kit && nearCap > 0)
    for (const [kind, parts] of Object.entries(kit.kinds)) {
      if (kind.startsWith("broad")) continue
      const n = Math.max(8, Math.round(nearCap * 0.4))
      kitMeshes[kind] = parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geo, part.mat, n)
        mesh.count = 0
        mesh.frustumCulled = false
        mesh.userData.kitShared = true
        mesh.castShadow = true
        mesh.receiveShadow = true
        if (part.crown) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3)
        kit.tick?.(mesh)
        scene.add(mesh)
        own.push(mesh)
        return { mesh, part, cap: n }
      })
    }
  // ---- the far trees: billboards ----
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0)
  geos.push(quad)
  const bb = new THREE.InstancedMesh(quad, bbMat, cap)
  const cells = new Float32Array(cap)
  quad.setAttribute("impCell", new THREE.InstancedBufferAttribute(cells, 1))
  bb.count = 0
  bb.name = "trees-far"
  bb.frustumCulled = false
  bb.castShadow = false
  bb.receiveShadow = false
  bb.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3)
  scene.add(bb)
  own.push(bb)
  const IMP = Object.fromEntries(IMP_LIST.map((n, i) => [n, { cell: i, ...impostorSize(n) }]))

  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const v = new THREE.Vector3()
  const s = new THREE.Vector3()
  const c = new THREE.Color()
  const up = new THREE.Vector3(0, 1, 0)
  // (a near species' tint: sRGB leaf colour -> linear, over the atlas's mean leaf grey)
  const nearTint = (rgb) => rgb.map((x) => lin(x) / 0.42)
  const farTint = (rgb, sp) => rgb.map((x, i) => Math.pow(x / ((LEAF[sp] || LEAF.round)[i] || 1), 2.2))
  return {
    // list: [{ x, y, z, s, r, kind, sp, hedge, flower, yaw, len }] nearest first; near(t): drawn
    // in full
    set(list, isNear = () => false) {
      const counts = { plane: 0, oak: 0, round: 0, pine: 0 }
      const kitCounts = {}
      let sh = 0
      let hd = 0
      let nb = 0
      let cb = 0
      for (const t of list) {
        const yaw = (t.x * 3.7 + t.z * 5.1) % 6.28
        const close = isNear(t)
        if (t.kind === 2) {
          if (!close) continue
          if (t.hedge) {
            // (a trimmed hedge in its curbed island, along the lot's rows)
            if (hd >= hedgeCap) continue
            const L = Math.max(1.6, (t.len || t.r * 2.6) + 0.6)
            const W = Math.min(2.2, Math.max(1.1, t.r * 0.9))
            q.setFromAxisAngle(up, t.yaw ?? yaw)
            m4.compose(v.set(t.x, t.y + 0.12, t.z), q, s.set(L, 0.95 + (t.r % 0.3), W))
            hedges.setMatrixAt(hd, m4)
            const g = ((t.x * 13.1 + t.z * 7.7) % 1 + 1) % 1
            c.setRGB(lin(0.27 + g * 0.05) / 0.36, lin(0.38 + g * 0.06) / 0.36, lin(0.19) / 0.36)
            hedges.setColorAt(hd, c)
            m4.compose(v.set(t.x, t.y - 0.05, t.z), q, s.set(L + 0.5, 0.2, W + 0.5))
            curbs.setMatrixAt(cb++, m4)
            hd++
            continue
          }
          if (sh >= shrubCap) continue
          const { r, h } = speciesSize("shrub", t.r ?? t.s ?? 1)
          q.setFromAxisAngle(up, yaw)
          m4.compose(v.set(t.x, t.y - 0.1, t.z), q, s.set(r / SPECIES.shrub.r, h / SPECIES.shrub.h, r / SPECIES.shrub.r))
          shrubs.setMatrixAt(sh, m4)
          let rgb = crownTint(t, 0, "shrub")
          if (t.flower) {
            c.setHex(FLOWERS[(t.flower - 1) % FLOWERS.length])
            c.convertLinearToSRGB()
            rgb = rgb.map((x, i) => x * 0.35 + [c.r, c.g, c.b][i] * 0.65)
          }
          const nt = nearTint(rgb)
          shrubs.instanceColor.setXYZ(sh, nt[0], nt[1], nt[2])
          sh++
          continue
        }
        if (t.kind === 1) {
          const kk = kitKindOf(t)
          const parts = close ? kitMeshes[kk] : null
          const i = kitCounts[kk] || 0
          if (parts && i < parts[0].cap) {
            kitCounts[kk] = i + 1
            const h = palmHeight(t, kk)
            const k = t.s || 1
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
          if (nb >= cap) continue
          const h = palmHeight(t, "fanpalm") + 1
          m4.compose(v.set(t.x, t.y - 0.2, t.z), q.identity(), s.set((IMP.palm.w * h) / IMP.palm.h, h * 1.08, 1))
          bb.setMatrixAt(nb, m4)
          cells[nb] = IMP.palm.cell
          bb.instanceColor.setXYZ(nb, 1, 1, 1)
          nb++
          continue
        }
        const sp = speciesOf(t)
        const S = SPECIES[sp]
        const { r, h } = speciesSize(sp, t.r ?? (t.s || 1) * 3.2)
        const rgb = crownTint(t, fall, sp)
        if (close && counts[sp] < near[sp].instanceMatrix.count) {
          const i = counts[sp]++
          q.setFromAxisAngle(up, yaw)
          m4.compose(v.set(t.x, t.y - 0.15, t.z), q, s.set(r / S.r, h / S.h, r / S.r))
          near[sp].setMatrixAt(i, m4)
          if (t.island && cb < curbCap) {
            // (a lot's tree stands in its curbed planter island)
            m4.compose(v.set(t.x, t.y - 0.05, t.z), q, s.set(2.0, 0.22, 2.0))
            curbs.setMatrixAt(cb++, m4)
          }
          const nt = nearTint(rgb)
          near[sp].instanceColor.setXYZ(i, nt[0], nt[1], nt[2])
          continue
        }
        if (nb >= cap) continue
        const I = IMP[sp]
        m4.compose(v.set(t.x, t.y - 0.2, t.z), q.identity(), s.set((I.w * r) / S.r, (I.h * h) / S.h, 1))
        bb.setMatrixAt(nb, m4)
        cells[nb] = I.cell
        const ft = farTint(rgb, sp)
        bb.instanceColor.setXYZ(nb, ft[0], ft[1], ft[2])
        nb++
      }
      for (const sp of Object.keys(counts)) {
        near[sp].count = counts[sp]
        near[sp].instanceMatrix.needsUpdate = true
        near[sp].instanceColor.needsUpdate = true
      }
      shrubs.count = sh
      shrubs.instanceMatrix.needsUpdate = true
      shrubs.instanceColor.needsUpdate = true
      hedges.count = hd
      curbs.count = cb
      hedges.instanceMatrix.needsUpdate = curbs.instanceMatrix.needsUpdate = true
      if (hedges.instanceColor) hedges.instanceColor.needsUpdate = true
      bb.count = nb
      bb.instanceMatrix.needsUpdate = true
      bb.instanceColor.needsUpdate = true
      quad.attributes.impCell.needsUpdate = true
      for (const [kind, parts] of Object.entries(kitMeshes))
        for (const { mesh, part } of parts) {
          mesh.count = kitCounts[kind] || 0
          mesh.instanceMatrix.needsUpdate = true
          if (part.crown) mesh.instanceColor.needsUpdate = true
        }
    },
    get nearCount() {
      return Object.values(near).reduce((a, m) => a + m.count, 0) + Object.values(kitMeshes).reduce((a, parts) => a + (parts[0]?.mesh.count || 0), 0)
    },
    get farCount() {
      return bb.count
    },
    dispose() {
      for (const m of own) {
        m.removeFromParent()
        // (the kit's geometries and materials are shared and kept)
        m.dispose?.()
      }
      for (const g of geos) g.dispose()
      for (const m of [leafMat, depthMat, hedgeMat, curbMat, bbMat]) m.dispose()
      atlasTex.dispose()
      impTex.dispose()
    },
  }
}
