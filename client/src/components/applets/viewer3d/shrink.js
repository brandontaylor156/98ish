// Make a model phone-sized: simplify meshes to a triangle budget (three's SimplifyModifier;
// skinned meshes keep their geometry so their bones still fit) and shrink textures, then
// re-export one .glb. Used on imports over MAX_TRIS and before sending in Messenger.
import * as THREE from "three"
import { SimplifyModifier } from "three/examples/jsm/modifiers/SimplifyModifier.js"
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js"
import { countTriangles, loadGltf } from "./scene.js"
import { keepRatio, textureFor } from "./core.js"

const shrinkTexture = (tex, max) => {
  const img = tex?.image
  if (!img || !img.width || Math.max(img.width, img.height) <= max) return
  const k = max / Math.max(img.width, img.height)
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.round(img.width * k))
  c.height = Math.max(1, Math.round(img.height * k))
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height)
  tex.image = c
  tex.needsUpdate = true
}

// bytes -> { bytes, triangles, changed }
export const shrinkModel = async (bytes, { maxTris, maxBytes, texture = 1024, onStatus } = {}) => {
  const gltf = await loadGltf(bytes)
  const root = gltf.scene || gltf.scenes?.[0]
  const before = countTriangles(root)
  const ratio = keepRatio(before, maxTris)
  let tex = texture
  if (maxBytes) tex = Math.min(tex, textureFor(maxBytes, tex))
  if (ratio >= 1 && (!maxBytes || bytes.length <= maxBytes)) return { bytes, triangles: before, changed: false }
  onStatus?.(ratio < 1 ? `Simplifying ${before.toLocaleString()} triangles...` : "Shrinking the textures...")
  if (ratio < 1) {
    const mod = new SimplifyModifier()
    root.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || !o.geometry?.attributes?.position) return
      const g = o.geometry
      const verts = g.attributes.position.count
      const remove = Math.floor(verts * (1 - ratio))
      if (remove > 0) {
        try {
          const simple = mod.modify(g, remove)
          o.geometry.dispose()
          o.geometry = simple
        } catch {}
      }
    })
  }
  root.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    for (const m of mats) for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap"]) shrinkTexture(m[k], tex)
  })
  const out = await new Promise((resolve, reject) =>
    new GLTFExporter().parse(root, (r) => resolve(new Uint8Array(r)), (e) => reject(new Error(`The model couldn't be shrunk (${e?.message || e}).`)), { binary: true, animations: gltf.animations || [] })
  )
  const after = countTriangles(root)
  // still too big to send: one more pass with smaller textures
  if (maxBytes && out.length > maxBytes && tex > 256) return shrinkModel(out, { maxTris: Math.round((maxTris || after) * 0.7), maxBytes, texture: tex / 2, onStatus })
  return { bytes: out, triangles: after, changed: true }
}

