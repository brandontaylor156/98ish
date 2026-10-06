// A venue's splat backdrop in the 3D scene: Spark (MIT, World Labs) draws Gaussian splats
// inside the regular three.js render, sorted together with the meshes, so the court, the
// players and the fences in front composite naturally. Spark loads only when a backdrop is
// shown (it's a 2.6 MB chunk). Graphics: Low never loads it.
//   createSplatLayer({ scene, renderer, quality, phone }) -> { show, place, hide, dispose, info }
import * as THREE from "three"

const SPARK_TYPE = { ply: "ply", spz: "spz", splat: "splat", ksplat: "ksplat", sog: "pcsogszip" }

// how many splats may be drawn at once (Spark's level of detail keeps to it)
export const splatBudget = ({ quality, phone }) => (quality === "low" ? 0 : phone ? 500000 : quality === "high" ? 2000000 : 1000000)

export const createSplatLayer = ({ scene, renderer, quality = "medium", phone = false } = {}) => {
  const budget = splatBudget({ quality, phone })
  let spark = null
  let mesh = null
  let sparkRenderer = null
  let token = 0
  const info = { shown: false, splats: 0, error: null, budget }

  const ensure = async () => {
    if (!spark) spark = await import("@sparkjsdev/spark")
    if (!sparkRenderer && renderer) {
      sparkRenderer = new spark.SparkRenderer({ renderer, lodSplatCount: budget, enableLod: true })
      sparkRenderer.name = "splatRenderer"
      scene.add(sparkRenderer)
    }
  }

  const placeMesh = (T) => {
    if (!mesh) return
    if (!T) {
      mesh.position.set(0, 0, 0)
      mesh.quaternion.identity()
      mesh.scale.setScalar(1)
    } else {
      mesh.position.set(T.t[0], T.t[1], T.t[2])
      mesh.quaternion.set(T.q[0], T.q[1], T.q[2], T.q[3])
      mesh.scale.setScalar(T.s)
    }
    mesh.updateMatrixWorld(true)
  }

  return {
    info,
    // bytes: Uint8Array of a .ply/.spz/.splat/.ksplat/.sog; transform: { s, q, t } or null (as is)
    async show(bytes, format, transform = null) {
      if (!budget) {
        info.error = "Splat backdrops are off on Graphics: Low."
        return false
      }
      const my = ++token
      try {
        await ensure()
        if (my !== token) return false
        if (mesh) {
          scene.remove(mesh)
          mesh.dispose?.()
          mesh = null
        }
        const m = new spark.SplatMesh({ fileBytes: bytes, fileType: SPARK_TYPE[format] || format, lod: true })
        await m.initialized
        if (my !== token) return m.dispose?.(), false
        mesh = m
        mesh.name = "splatBackdrop"
        placeMesh(transform)
        scene.add(mesh)
        info.shown = true
        info.splats = mesh.packedSplats?.numSplats || 0
        info.error = null
        return true
      } catch (error) {
        console.error(error)
        info.error = error?.message || "That splat couldn't be drawn."
        return false
      }
    },
    place(transform) {
      placeMesh(transform)
    },
    // the splat centers in the file's own frame (for the alignment view): from Spark's decode
    centers(max = 60000) {
      const ps = mesh?.packedSplats
      if (!ps) return null
      const n = ps.numSplats
      const step = Math.max(1, Math.floor(n / max))
      const out = new Float32Array(Math.ceil(n / step) * 3)
      let k = 0
      const v = new THREE.Vector3()
      for (let i = 0; i < n; i += step) {
        const s = ps.getSplat ? ps.getSplat(i) : null
        if (s?.center) v.copy(s.center)
        else continue
        out[k++] = v.x
        out[k++] = v.y
        out[k++] = v.z
      }
      return out.subarray(0, k)
    },
    hide() {
      token++
      if (mesh) {
        scene.remove(mesh)
        mesh.dispose?.()
        mesh = null
      }
      info.shown = false
      info.splats = 0
    },
    dispose() {
      this.hide()
      if (sparkRenderer) {
        scene.remove(sparkRenderer)
        sparkRenderer.dispose?.()
        sparkRenderer = null
      }
    },
  }
}
