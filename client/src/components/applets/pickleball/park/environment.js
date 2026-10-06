// A real sky to reflect (docs/venue-realism.md, round 3): a CC0 Poly Haven HDRI per venue kind
// (outdoor: "Park Parking", a clear midday park with a lot; indoor: "Empty Warehouse 01"),
// loaded once, lazily, in place of round 2's drawn sky on the materials that reflect it (car
// paint and glass, window glass, room floors). The HDRI is normalized when it loads: its mean
// brightness is brought to what the drawn sky had and its peaks (the sun) are capped, so window
// glass and paint pick up a real sky, trees and buildings without blowing out, and the
// photo-matched wall paint (which doesn't reflect) is untouched. The scene's own
// `environment` is NOT set: the athletes and the court paint keep their calibrated light.

import * as THREE from "three"

const BASE = "/assets/venue-tex/hdri/"
export const HDRI = { outdoor: "park_parking_1k.hdr", indoor: "empty_warehouse_01_1k.hdr" }

// scale an RGB(A) float buffer so its mean luminance is `target`, then cap peaks at `peak`;
// returns the scale used
export const normalizeHDR = (data, { channels = 4, target = 0.45, peak = 6 } = {}) => {
  let sum = 0
  let n = 0
  for (let i = 0; i + 2 < data.length; i += channels) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    n++
  }
  const mean = n ? sum / n : 1
  const k = mean > 0 ? target / mean : 1
  for (let i = 0; i + 2 < data.length; i += channels) {
    for (let c = 0; c < 3; c++) data[i + c] = Math.min(peak, data[i + c] * k)
  }
  return k
}

const cache = new Map()
export const loadHDRI = (indoor = false) => {
  const file = indoor ? HDRI.indoor : HDRI.outdoor
  if (cache.has(file)) return cache.get(file)
  const p = import("three/examples/jsm/loaders/HDRLoader.js")
    .then(
      ({ HDRLoader }) =>
        new Promise((resolve, reject) => {
          const loader = new HDRLoader()
          loader.setDataType(THREE.FloatType)
          loader.load(
            BASE + file,
            (tex) => {
              normalizeHDR(tex.image.data, { target: indoor ? 0.5 : 0.45, peak: indoor ? 4 : 6 })
              tex.mapping = THREE.EquirectangularReflectionMapping
              tex.colorSpace = THREE.LinearSRGBColorSpace
              tex.needsUpdate = true
              resolve(tex)
            },
            undefined,
            reject
          )
        })
    )
    .catch(() => null)
  cache.set(file, p)
  return p
}

// put `hdr` in place of `old` on every material under `root` that reflects it; remembers each
// material's own strength so the time of day can dim it. Returns the materials.
export const swapEnvironment = (root, old, hdr) => {
  const mats = new Set()
  root.traverse((o) => {
    const list = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []
    for (const m of list) if (m && m.envMap === old) mats.add(m)
  })
  for (const m of mats) {
    m.envMap = hdr
    if (m.userData.envBase === undefined) m.userData.envBase = m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshBasicMaterial ? m.reflectivity : m.envMapIntensity
    m.needsUpdate = true
  }
  return [...mats]
}

// the sky's reflection follows the light: full at midday, faint at night (indoors: always on)
export const dimEnvironment = (mats, k) => {
  for (const m of mats) {
    const base = m.userData.envBase ?? 1
    if (m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshBasicMaterial) m.reflectivity = base * k
    else m.envMapIntensity = base * k
  }
}
