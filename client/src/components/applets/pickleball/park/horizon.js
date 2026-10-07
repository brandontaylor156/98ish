// The real skyline behind a real venue (the spec's `horizon`, worked out by
// tools/venues/horizon.py from free elevation tiles: the San Gabriels north of Whittier, the
// hills round Valencia and Simi Valley, the ocean and Catalina from Newport). Each group (near,
// mid, far land and the sea) is a band on a ring round the camera: per compass degree, from the
// angle where it rises above everything nearer to its top, hazier the farther it is.
// Drawn just after the sky (no depth test, no depth writes): everything else covers it. One
// small mesh per group; the ring follows the camera like the sky dome (build.js followSky).
import * as THREE from "three"

const RING = 318 // inside the sky dome (330) and the camera's far plane (400)
const BOTTOM = -6 // degrees: the nearest band reaches down past the far ground's edge
const BASE = { near: 0x6f7052, mid: 0x7a7a60, far: 0x8a8f86, sea: 0x3f6f8c }
const ORDER = ["far", "sea", "mid", "near"]
// visibility (km): how fast distance fades a ridge into the haze (SoCal on a fair day)
const HAZE_KM = 16

export const horizonMeshes = (hz) => {
  const eye = hz.eye ?? 1.7
  const out = []
  ORDER.forEach((name, k) => {
    const cols = hz.groups?.[name]
    if (!cols) return
    const pos = new Float32Array(361 * 2 * 3)
    const haze = new Float32Array(361 * 2)
    for (let i = 0; i <= 360; i++) {
      const c = cols[i % 360]
      const phi = (i * Math.PI) / 180
      const x = Math.sin(phi) * RING
      const z = -Math.cos(phi) * RING
      // a missing column collapses to nothing (bottom = top)
      const top = c ? c[1] / 100 : BOTTOM
      const bot = c ? Math.max(BOTTOM, c[0] / 100) : BOTTOM
      const yTop = eye + RING * Math.tan((top * Math.PI) / 180)
      const yBot = eye + RING * Math.tan((Math.min(bot, top) * Math.PI) / 180)
      pos.set([x, yBot, z, x, yTop, z], i * 6)
      const h = c ? Math.min(0.94, Math.max(0.12, 1 - Math.exp(-c[2] / HAZE_KM))) : 1
      haze[i * 2] = h
      haze[i * 2 + 1] = h
    }
    const idx = []
    for (let i = 0; i < 360; i++) {
      const a = i * 2
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    g.setAttribute("haze", new THREE.BufferAttribute(haze, 1))
    g.setIndex(idx)
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      uniforms: { base: { value: new THREE.Color(BASE[name]) }, hazeColor: { value: new THREE.Color(0xd8ecfb) }, light: { value: 1 } },
      vertexShader: "attribute float haze; varying float vH; void main() { vH = haze; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "uniform vec3 base; uniform vec3 hazeColor; uniform float light; varying float vH; void main() { gl_FragColor = vec4(mix(base * light, hazeColor, vH), 1.0);\n#include <colorspace_fragment>\n}",
    })
    const m = new THREE.Mesh(g, mat)
    m.renderOrder = -0.95 + k * 0.01
    m.frustumCulled = false
    m.userData.noCast = true
    m.userData.horizon = name
    out.push(m)
  })
  return out
}

// follow the time of day: the haze takes the fog's color, the land darkens at night
export const setHorizonLook = (meshes, d) => {
  const light = Math.max(0.08, Math.min(1, (d.sun?.intensity ?? 2.6) / 2.6) * 0.75 + (d.hemi?.[2] ?? 1.4) / 1.4 * 0.25)
  for (const m of meshes) {
    m.material.uniforms.hazeColor.value.setHex(d.fog)
    m.material.uniforms.light.value = light
  }
}
