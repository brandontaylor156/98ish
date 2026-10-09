// My Park's frame budget on phones (docs/pickleball-log.md "My Park at 30 on a phone").
//
// Measured in phone emulation (390x844, 4x CPU): a My Park frame is main-thread bound, and
// most of it is WebGL calls (about 1,300 a frame at Los Cab: a draw, a program switch, its
// uniforms and textures each cost the same few microseconds), so what pays is fewer draws and
// fewer program switches, not fewer pixels or triangles.
import * as THREE from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

// ---- merging by look ----
// venue.js mergeStatic merges the meshes that share one material. Most of a venue's other
// draws are one mesh each with a material of its own that differs from the next only in its
// color (a wall, a roof, a planter, a bench: 109 materials for 144 draws at Los Cab). Here
// those are merged into one mesh per look, each mesh's color baked into vertex colors (in the
// same linear space the material's color uniform is in, so what's drawn is the same).
const TEX = ["map", "normalMap", "specularMap", "envMap", "alphaMap", "aoMap", "lightMap", "emissiveMap", "bumpMap", "roughnessMap", "metalnessMap", "displacementMap"]
const PROPS = ["type", "transparent", "opacity", "alphaTest", "side", "shadowSide", "depthWrite", "depthTest", "depthFunc", "blending", "colorWrite", "polygonOffset", "polygonOffsetFactor", "polygonOffsetUnits", "fog", "flatShading", "wireframe", "toneMapped", "dithering", "premultipliedAlpha", "alphaToCoverage", "visible", "combine", "reflectivity", "refractionRatio", "envMapIntensity", "roughness", "metalness", "emissiveIntensity", "aoMapIntensity", "bumpScale", "lightMapIntensity", "forceSinglePass"]
const MERGEABLE = new Set(["MeshLambertMaterial", "MeshStandardMaterial", "MeshPhongMaterial", "MeshBasicMaterial"])
const ownHook = (m) => m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile || m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey

// the look of a material apart from its color: two materials with the same look draw the same
// once their colors are vertex colors (null: leave it alone)
export const lookKey = (m) => {
  if (!m || Array.isArray(m) || !MERGEABLE.has(m.type) || ownHook(m) || m.userData?.live) return null
  const parts = PROPS.map((k) => String(m[k]))
  for (const k of TEX) parts.push(m[k] ? m[k].uuid : "-")
  if (m.normalScale) parts.push(m.normalScale.x, m.normalScale.y)
  if (m.emissive) parts.push(m.emissive.getHexString())
  if (m.specular) parts.push(m.specular.getHexString(), m.shininess)
  parts.push(m.userData?.surface || "", JSON.stringify(m.defines || {}))
  return parts.join("|")
}

// merge the plain meshes under `group` (not instanced, not skinned, not drawn early, nothing
// marked live) that look the same apart from their color; returns how many draws it saved
export const mergeByLook = (group, keep = (x) => x) => {
  group.updateMatrixWorld(true)
  const buckets = new Map()
  const all = []
  group.traverse((o) => all.push(o))
  const liveUnder = new Set()
  for (const o of all) if (o.userData?.live) o.traverse((x) => liveUnder.add(x))
  for (const o of all) {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.renderOrder < 0 || liveUnder.has(o)) continue
    if (o.morphTargetInfluences || o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) continue
    const look = lookKey(o.material)
    if (!look) continue
    const g = o.geometry
    const attrs = Object.keys(g.attributes).filter((k) => k !== "color").sort().join(",")
    if (!attrs.includes("position") || !attrs.includes("normal")) continue
    const key = `${look}|${attrs}|${o.renderOrder}|${o.castShadow}|${o.receiveShadow}|${o.customDepthMaterial?.uuid || "-"}|${o.frustumCulled}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(o)
  }
  let saved = 0
  const c = new THREE.Color()
  for (const list of buckets.values()) {
    // (only where it saves draws: two or more materials, or one material whose meshes are apart)
    if (list.length < 2) continue
    const indexed = list.every((o) => o.geometry.index)
    const geos = list.map((o) => {
      const src = o.geometry
      const g = (indexed ? src.clone() : src.index ? src.toNonIndexed() : src.clone()).applyMatrix4(o.matrixWorld)
      for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(name)) g.deleteAttribute(name)
      // the material's color (linear, like the uniform) times the mesh's own vertex colors
      const n = g.attributes.position.count
      const out = new Float32Array(n * 3)
      const m = o.material
      c.copy(m.color || c.setRGB(1, 1, 1))
      const own = m.vertexColors && g.attributes.color ? g.attributes.color : null
      for (let i = 0; i < n; i++) {
        out[i * 3] = c.r * (own ? own.getX(i) : 1)
        out[i * 3 + 1] = c.g * (own ? own.getY(i) : 1)
        out[i * 3 + 2] = c.b * (own ? own.getZ(i) : 1)
      }
      g.setAttribute("color", new THREE.BufferAttribute(out, 3))
      return g
    })
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    if (!merged) continue
    const first = list[0]
    const mat = first.material.clone()
    mat.color?.setRGB(1, 1, 1)
    mat.vertexColors = true
    mat.userData = { ...first.material.userData, mergedLook: list.length }
    const mesh = new THREE.Mesh(keep(merged), keep(mat))
    mesh.castShadow = first.castShadow
    mesh.receiveShadow = first.receiveShadow
    mesh.renderOrder = first.renderOrder
    mesh.frustumCulled = first.frustumCulled
    if (first.customDepthMaterial) mesh.customDepthMaterial = first.customDepthMaterial
    for (const o of list) o.parent.remove(o)
    group.add(mesh)
    saved += list.length - 1
  }
  return saved
}

// three.js draws a see-through double-sided material twice (back faces, then front faces),
// and flags the material for a program check before each pass: two draws and two program
// look-ups a frame for every chain-link fence, net, glass pane and weed card. Theirs are flat
// cards that don't write depth, so one pass looks the same.
export const singlePass = (root) => {
  let n = 0
  root.traverse((o) => {
    if (!o.material) return
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m.side !== THREE.DoubleSide || m.forceSinglePass) continue
      m.forceSinglePass = true
      n++
    }
  })
  return n
}

// The opaque list sorted by shader program first (three.js sorts by material, so nearly every
// draw switched programs: 110 switches for 160 draws at Los Cab, each one re-sending the
// lights, camera and fog): draws that share a program go one after another. Render order and
// group order still come first; within a program, by material, then nearest first.
export const programSort = (renderer) => {
  const props = renderer.properties
  const pid = (m) => props.get(m).currentProgram?.id ?? 0
  return (a, b) => {
    if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder
    if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder
    if (a.material !== b.material) {
      const d = pid(a.material) - pid(b.material)
      if (d) return d
      return a.material.id - b.material.id
    }
    // (one material on plain, instanced and skinned meshes: a program each)
    if (a.materialVariant !== b.materialVariant) return (a.materialVariant || 0) - (b.materialVariant || 0)
    if (a.z !== b.z) return a.z - b.z
    return a.id - b.id
  }
}
