// Roam: the sea on screen (a coast town: Newport Beach). The water is the map's own (the
// coastline rebuilt into rings by data/sea.js, carried in each tile); this draws it flat at sea
// level with one cheap shader: a few travelling sine swells and a finer chop make the normal
// (no textures), the sky is reflected by a Fresnel term, the sun leaves a glitter path, the
// deep water is a dark blue-green that turns lighter and foamy along the shore, and it all dims
// at night. One material for every tile; a tile's sea is one mesh (one draw call).
// Triangulating is pure (Node-tested); the material needs three.js only.

import * as THREE from "three"

// the even-odd rings ([{ x, z }]) -> [{ outer, holes }] (a ring inside an odd number of others
// is a hole of the smallest one holding it)
export const nestRings = (rings) => {
  const inside = (r, p) => {
    let c = false
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i].z > p.z !== r[j].z > p.z && p.x < ((r[j].x - r[i].x) * (p.z - r[i].z)) / (r[j].z - r[i].z) + r[i].x) c = !c
    return c
  }
  const area = (r) => {
    let a = 0
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].x + r[i].x) * (r[j].z - r[i].z)
    return Math.abs(a / 2)
  }
  const info = rings.map((r, i) => {
    // (a point a hair inside the ring's first edge, so a shared vertex doesn't count twice)
    const p = probe(r, inside)
    const holders = rings.map((q, j) => (j !== i && inside(q, p) ? j : -1)).filter((j) => j >= 0)
    return { r, holders, area: area(r) }
  })
  const out = []
  const byIdx = new Map()
  info.forEach((it, i) => {
    if (it.holders.length % 2 === 0) {
      const o = { outer: it.r, holes: [] }
      out.push(o)
      byIdx.set(i, o)
    }
  })
  info.forEach((it) => {
    if (it.holders.length % 2 === 0) return
    let best = -1
    for (const j of it.holders) if (byIdx.has(j) && (best < 0 || info[j].area < info[best].area)) best = j
    if (best >= 0) byIdx.get(best).holes.push(it.r)
  })
  return out
}
// a point just inside a ring (beside the middle of its longest edge, on whichever side is in)
const probe = (r, inside) => {
  let k = 0
  let best = -1
  for (let i = 0; i < r.length; i++) {
    const b = r[(i + 1) % r.length]
    const L = Math.hypot(b.x - r[i].x, b.z - r[i].z)
    if (L > best) {
      best = L
      k = i
    }
  }
  const a = r[k]
  const b = r[(k + 1) % r.length]
  const L = best || 1
  const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
  const e = Math.min(0.05, L * 0.01)
  const p = { x: m.x - ((b.z - a.z) / L) * e, z: m.z + ((b.x - a.x) / L) * e }
  return inside(r, p) ? p : { x: m.x + ((b.z - a.z) / L) * e, z: m.z - ((b.x - a.x) / L) * e }
}

// a tile's sea (groups of even-odd rings) -> { position, foam, index } at height y (foam: 1 on the shore line, 0 a few
// metres out), or null
export const seaArrays = (tile, y, { foamWidth = 3.5 } = {}) => {
  if (!tile.sea?.length) return null
  const P = []
  const Fm = []
  const I = []
  for (const { outer, holes } of tile.sea.flatMap((group) => nestRings(group))) {
    const contour = outer.map((p) => new THREE.Vector2(p.x, p.z))
    const hs = holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.z)))
    let tris
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, hs)
    } catch {
      continue
    }
    const base = P.length / 3
    for (const v of [contour, ...hs].flat()) {
      P.push(v.x, y, v.y)
      Fm.push(0)
    }
    for (const t of tris) I.push(base + t[0], base + t[1], base + t[2])
  }
  // the surf: a strip along each shore edge, on both sides (the land side is under the ground)
  for (const [a, b] of tile.shore || []) {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const L = Math.hypot(dx, dz)
    if (L < 0.5) continue
    const nx = (-dz / L) * foamWidth
    const nz = (dx / L) * foamWidth
    const k = P.length / 3
    P.push(a.x + nx, y + 0.02, a.z + nz, b.x + nx, y + 0.02, b.z + nz, a.x, y + 0.03, a.z, b.x, y + 0.03, b.z, a.x - nx, y + 0.02, a.z - nz, b.x - nx, y + 0.02, b.z - nz)
    Fm.push(0, 0, 1, 1, 0, 0)
    I.push(k, k + 2, k + 1, k + 1, k + 2, k + 3, k + 2, k + 4, k + 3, k + 3, k + 4, k + 5)
  }
  if (!I.length) return null
  const n = P.length / 3
  return { position: new Float32Array(P), foam: new Float32Array(Fm), index: n > 65535 ? new Uint32Array(I) : new Uint16Array(I) }
}

// ---------- the material (shared) ----------
export const seaUniforms = {
  seaTime: { value: 0 },
  seaSunDir: { value: new THREE.Vector3(-0.4, 0.8, 0.3).normalize() },
  seaSunColor: { value: new THREE.Color(1, 0.95, 0.86) },
  seaSky: { value: new THREE.Color(0.55, 0.68, 0.82) },
  seaNight: { value: 0 },
}
let material = null
export const seaMaterial = () => {
  if (material) return material
  material = new THREE.ShaderMaterial({
    fog: true,
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: `
attribute float foam;
varying vec3 vSeaW;
varying float vFoam;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vSeaW = w.xyz;
  vFoam = foam;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `
uniform float seaTime;
uniform vec3 seaSunDir;
uniform vec3 seaSunColor;
uniform vec3 seaSky;
uniform float seaNight;
varying vec3 vSeaW;
varying float vFoam;
#include <fog_pars_fragment>
// a travelling wave's slope: direction, wavelength (m), speed (m/s), height (m)
vec2 swell(vec2 p, vec2 d, float L, float c, float a) {
  float k = 6.2831853 / L;
  float ph = k * (dot(d, p) - c * seaTime);
  return d * (a * k * cos(ph));
}
void main() {
  vec2 p = vSeaW.xz;
  float dist = distance(vSeaW, cameraPosition);
  // swells from the south-west (the Pacific's), a cross sea, and a fine chop that fades with distance
  vec2 g = swell(p, normalize(vec2(0.45, -0.89)), 38.0, 7.7, 0.32)
         + swell(p, normalize(vec2(0.8, -0.6)), 17.0, 5.1, 0.12)
         + swell(p, normalize(vec2(-0.3, -0.95)), 9.0, 3.7, 0.06);
  float near = 1.0 - smoothstep(60.0, 260.0, dist);
  g += near * (swell(p, normalize(vec2(0.95, 0.31)), 3.1, 2.2, 0.025) + swell(p, normalize(vec2(-0.7, 0.71)), 2.3, 1.9, 0.018) + swell(p, normalize(vec2(0.2, 0.98)), 1.4, 1.5, 0.008));
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(cameraPosition - vSeaW);
  float cosv = max(dot(n, v), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
  vec3 r = reflect(-v, n);
  float day = 1.0 - seaNight;
  // the sky it reflects: paler at the horizon
  vec3 sky = mix(seaSky * 1.15 + vec3(0.06), seaSky * 0.8, clamp(r.y * 1.6, 0.0, 1.0)) * (0.12 + 0.88 * day);
  // the water's own colour: deep blue-green, lit by the sky from above
  vec3 deep = vec3(0.015, 0.075, 0.105) * (0.25 + 0.75 * day);
  vec3 col = mix(deep, sky, fres);
  // the sun's glitter
  float s = pow(max(dot(r, normalize(seaSunDir)), 0.0), 220.0);
  col += seaSunColor * s * 6.0 * day;
  // the surf: foam along the shore, breaking and running back
  float run = 0.5 + 0.5 * sin(seaTime * 0.9 + p.x * 0.035 + p.y * 0.05);
  float foam = smoothstep(0.15 + 0.35 * run, 1.0, vFoam) * (0.55 + 0.45 * run);
  col = mix(col, vec3(0.85, 0.88, 0.86) * (0.2 + 0.8 * day), foam * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  })
  Object.assign(material.uniforms, seaUniforms)
  return material
}
export const disposeSea = () => {
  material?.dispose()
  material = null
}
