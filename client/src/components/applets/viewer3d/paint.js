// A plain (white) shape from a shape-only Space (Hunyuan3D, TripoSG) gets its colors from the
// photo: the photo is projected onto the model's front (and straight through to the back),
// each vertex taking the color of the photo pixel in front of it, inside the subject's box.
// Not a real texture, but it reads as "my mug" instead of a white blob. Then one .glb again.
import * as THREE from "three"
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js"
import { loadGltf } from "./scene.js"
import { photoPixel, subjectBox } from "./core.js"

const readPhoto = async (photo, max = 512) => {
  const bmp = await createImageBitmap(photo)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * k))
  const h = Math.max(1, Math.round(bmp.height * k))
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const ctx = c.getContext("2d", { willReadFrequently: true })
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  return { data: ctx.getImageData(0, 0, w, h).data, w, h }
}

// bytes (.glb) + photo (Blob) -> colored .glb bytes (or the same bytes if anything goes wrong)
export const paintFromPhoto = async (bytes, photo) => {
  try {
    const gltf = await loadGltf(bytes)
    const root = gltf.scene || gltf.scenes?.[0]
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    const box3 = { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y }
    const img = await readPhoto(photo)
    const box2 = subjectBox(img.data, img.w, img.h)
    const p = new THREE.Vector3()
    const toLinear = (c) => Math.pow(c / 255, 2.2)
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return
      const pos = o.geometry.attributes.position
      const colors = new Float32Array(pos.count * 3)
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)
        const [x, y] = photoPixel(p.x, p.y, box3, box2)
        const j = (Math.min(img.h - 1, y) * img.w + Math.min(img.w - 1, x)) * 4
        colors[i * 3] = toLinear(img.data[j])
        colors[i * 3 + 1] = toLinear(img.data[j + 1])
        colors[i * 3 + 2] = toLinear(img.data[j + 2])
      }
      o.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals()
      o.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 })
    })
    return await new Promise((resolve, reject) => new GLTFExporter().parse(root, (r) => resolve(new Uint8Array(r)), reject, { binary: true }))
  } catch {
    return bytes
  }
}
