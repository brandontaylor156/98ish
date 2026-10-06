// Real surfaces for the venues (docs/venue-realism.md): every material tagged with
// `material.userData.surface = "<kind>"` gets a CC0 surface texture (public/assets/venue-tex/,
// built by tools/venues/textures/build-textures.py) sampled in WORLD space, so no geometry
// needs UVs and merged meshes work as they are. The texture only MODULATES the material's own
// color (its R channel is luminance detail with a mean of 0.5), so a venue's photo-matched
// paint keeps its average color; G/B bend the lighting normal (grain, tile edges, cracks) and A
// darkens the cavities. Walls also get grime at their foot, and detail fades with distance
// (no shimmer). "ground" is special: the painted ground texture picks grass, asphalt or
// concrete per pixel from its own color.
//
// Off on Low quality (the old flat look, for old phones). Textures load once, lazily: until
// they arrive a neutral 1x1 stands in, so nothing waits on them.

import * as THREE from "three"
import { aoUniforms } from "./occlusion.js"

const BASE = "/assets/venue-tex/"
// kind: tiles per meter (scale), how much the detail changes the paint (strength), how much
// it bends the light (normal), cavity darkening (ao), grime at a wall's foot (grime)
export const SURFACES = {
  asphalt: { scale: 0.45, strength: 0.6, normal: 0.9, ao: 0.6 },
  concrete: { scale: 0.3, strength: 0.45, normal: 0.6, ao: 0.5, grime: 0.22 },
  grass: { scale: 0.55, strength: 0.75, normal: 0.8, ao: 0.7 },
  stucco: { scale: 0.7, strength: 0.4, normal: 0.9, ao: 0.4, grime: 0.28 },
  roof: { scale: 0.6, strength: 0.35, normal: 1.0, ao: 0.8 },
  wood: { scale: 0.5, strength: 0.55, normal: 0.7, ao: 0.5 },
  deck: { scale: 0.5, strength: 0.6, normal: 0.9, ao: 0.6 },
  carpet: { scale: 1.2, strength: 0.45, normal: 0.6, ao: 0.4 },
  rubber: { scale: 0.8, strength: 0.4, normal: 0.6, ao: 0.4 },
  metal: { scale: 0.8, strength: 0.25, normal: 0.4, ao: 0.2 },
  tile: { scale: 0.5, strength: 0.4, normal: 0.9, ao: 0.6 },
  fabric: { scale: 2.0, strength: 0.35, normal: 0.6, ao: 0.4 },
  // (macro: a big, slow second sample of the same texture on floors: sun fade and wear patches)
  acrylic: { scale: 3.0, strength: 0.3, normal: 0.75, ao: 0.3, macro: 0.55, macroScale: 0.03 },
}
const KINDS = Object.keys(SURFACES)

// one switch for all of them (the dev compare tool; a live toggle): 1 on, 0 the flat look
const surfOn = { value: 1 }
export const setSurfacesOn = (on) => (surfOn.value = on ? 1 : 0)

// one shared uniform per kind: every material of that kind sees the texture when it lands
const texUniforms = new Map()
let loading = null
const neutral = () => {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)
  t.needsUpdate = true
  return t
}
const uniformFor = (kind) => {
  if (!texUniforms.has(kind)) texUniforms.set(kind, { value: neutral() })
  return texUniforms.get(kind)
}
export const loadSurfaces = (renderer) => {
  if (loading) return loading
  const loader = new THREE.TextureLoader()
  const aniso = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 4)
  loading = Promise.all(
    KINDS.map(
      (kind) =>
        new Promise((resolve) => {
          loader.load(
            `${BASE}${kind}.webp`,
            (t) => {
              t.wrapS = t.wrapT = THREE.RepeatWrapping
              t.colorSpace = THREE.NoColorSpace // data, not a picture
              t.anisotropy = aniso
              t.generateMipmaps = true
              t.minFilter = THREE.LinearMipmapLinearFilter
              uniformFor(kind).value = t
              resolve(true)
            },
            undefined,
            () => resolve(false)
          )
        })
    )
  )
  return loading
}

const common = /* glsl */ `
varying vec3 vSurfW;
varying vec3 vSurfN;
vec4 surfTri(sampler2D t, vec3 p, vec3 n, float s) {
  vec3 w = pow(abs(n), vec3(6.0));
  w /= (w.x + w.y + w.z);
  if (w.y > 0.97) return texture2D(t, p.xz * s);
  return texture2D(t, p.zy * s) * w.x + texture2D(t, p.xz * s) * w.y + texture2D(t, p.xy * s) * w.z;
}
// the detail's normal (G, B) as a world-space bend for the axis it was sampled on
vec3 surfBend(vec4 d, vec3 n) {
  vec2 b = d.gb * 2.0 - 1.0;
  vec3 w = pow(abs(n), vec3(6.0));
  w /= (w.x + w.y + w.z);
  return vec3(0.0, b.y, b.x) * w.x * sign(n.x) + vec3(b.x, 0.0, -b.y) * w.y + vec3(b.x, b.y, 0.0) * w.z * sign(n.z);
}
`

const patch = (material, kind) => {
  const k = SURFACES[kind] || {}
  const ground = kind === "ground"
  const uniforms = ground
    ? { surfA: uniformFor("grass"), surfB: uniformFor("asphalt"), surfC: uniformFor("concrete") }
    : { surfTex: uniformFor(kind) }
  const prev = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms, { surfOn }, aoUniforms)
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSurfW;\nvarying vec3 vSurfN;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  vec4 surfP = vec4(transformed, 1.0);
  vec3 surfNo = normal; // (the attribute: unlit materials have no objectNormal)
  #ifdef USE_INSTANCING
    surfP = instanceMatrix * surfP;
    surfNo = mat3(instanceMatrix) * surfNo;
  #endif
  vSurfW = (modelMatrix * surfP).xyz;
  vSurfN = normalize(mat3(modelMatrix) * surfNo);`
      )
    const decl = ground ? "uniform sampler2D surfA;\nuniform sampler2D surfB;\nuniform sampler2D surfC;" : "uniform sampler2D surfTex;"
    // the detail at this pixel: one texture, or (ground) the right one for the paint here
    const sample = ground
      ? `
  vec3 surfPaint = diffuseColor.rgb;
  float surfGreen = smoothstep(0.015, 0.09, surfPaint.g - max(surfPaint.r, surfPaint.b));
  float surfLum = dot(surfPaint, vec3(0.299, 0.587, 0.114));
  float surfDark = 1.0 - smoothstep(0.18, 0.42, surfLum);
  vec4 sa = texture2D(surfA, vSurfW.xz * ${SURFACES.grass.scale.toFixed(3)});
  vec4 sb = texture2D(surfB, vSurfW.xz * ${SURFACES.asphalt.scale.toFixed(3)});
  vec4 sc = texture2D(surfC, vSurfW.xz * ${SURFACES.concrete.scale.toFixed(3)});
  vec4 surfD = mix(mix(sc, sb, surfDark), sa, surfGreen);
  // a second, far bigger sample breaks the tiling on big lawns and lots
  surfD.r = mix(surfD.r, texture2D(surfA, vSurfW.xz * 0.061).r * surfGreen + texture2D(surfB, vSurfW.xz * 0.053).r * (1.0 - surfGreen), 0.35);
  float surfK = mix(mix(${(SURFACES.concrete.strength).toFixed(2)}, ${(SURFACES.asphalt.strength).toFixed(2)}, surfDark), ${(SURFACES.grass.strength).toFixed(2)}, surfGreen);
  float surfNK = 0.8;
  float surfAOK = 0.6;
  float surfGrime = 0.0;`
      : `
  vec4 surfD = surfTri(surfTex, vSurfW, vSurfN, ${(k.scale || 1).toFixed(3)});
  if (abs(vSurfN.y) > 0.9) surfD.r = mix(surfD.r, texture2D(surfTex, vSurfW.xz * ${(k.macroScale ?? k.scale * 0.17).toFixed(4)}).r, ${(k.macro ?? 0.3).toFixed(2)});
  float surfK = ${(k.strength ?? 0.4).toFixed(2)};
  float surfNK = ${(k.normal ?? 0.6).toFixed(2)};
  float surfAOK = ${(k.ao ?? 0.4).toFixed(2)};
  float surfGrime = ${(k.grime ?? 0).toFixed(2)};`
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${decl}\nuniform float surfOn;\nuniform sampler2D surfAOTex;\nuniform vec4 surfAOBox;\nuniform float surfAOOn;\n${common}`)
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
  ${sample}
  // detail fades out with distance: far surfaces stay calm instead of shimmering
  float surfFar = (1.0 - smoothstep(30.0, 110.0, distance(vSurfW, cameraPosition))) * surfOn;
  surfGrime *= surfOn;
  surfK *= surfFar; surfNK *= surfFar;
  diffuseColor.rgb *= mix(1.0, surfD.r * 2.0, surfK) * mix(1.0, surfD.a, surfAOK * surfFar);
  // grime where a wall meets the ground
  if (surfGrime > 0.0 && abs(vSurfN.y) < 0.5) diffuseColor.rgb *= 1.0 - surfGrime * (1.0 - smoothstep(0.0, 0.8, vSurfW.y));
  // baked ground occlusion (occlusion.js): floors near the ground, and walls near their foot
  // (sampled a little out from the wall, where the corner's shade is)
  float surfAO = 1.0;
  if (surfAOOn > 0.5 && surfAOBox.z > 0.0 && vSurfW.y < 2.0) {
    bool surfUp = vSurfN.y > 0.6;
    vec2 surfAP = vSurfW.xz + (surfUp ? vec2(0.0) : normalize(vSurfN.xz + 1e-5) * 0.35);
    vec2 surfAUV = (surfAP - surfAOBox.xy) * surfAOBox.zw;
    if (surfAUV.x > 0.0 && surfAUV.y > 0.0 && surfAUV.x < 1.0 && surfAUV.y < 1.0) {
      float surfAW = surfUp ? 1.0 - smoothstep(0.5, 1.4, vSurfW.y) : (1.0 - smoothstep(0.0, 1.8, vSurfW.y)) * step(abs(vSurfN.y), 0.6);
      surfAO = mix(1.0, texture2D(surfAOTex, surfAUV).r, surfAW * surfOn);
    }
  }`
      )
      .replace(
        "#include <aomap_fragment>",
        `#include <aomap_fragment>
  // (the sky's light is what a corner, a car or a bench blocks; the sun has its shadow map)
  reflectedLight.indirectDiffuse *= surfAO;
  reflectedLight.directDiffuse *= mix(1.0, surfAO, 0.15);`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
  {
    vec3 surfWN = normalize(vSurfN + surfBend(surfD, vSurfN) * surfNK);
    vec3 surfVN = normalize((viewMatrix * vec4(surfWN, 0.0)).xyz);
    normal = normalize(mix(normal, surfVN, ${material.normalMap ? 0.3 : 0.85} * surfOn)); // (a material's own relief, round 2's windows and quilting, stays)
  }`
      )
  }
  const prevKey = material.customProgramCacheKey?.bind(material)
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : ""}|surf:${kind}${material.normalMap ? ":n" : ""}`
  material.needsUpdate = true
}

// tag a material with a surface kind (used by scenery.js, courtkit.js, build.js)
export const surfaced = (material, kind) => {
  if (material) material.userData.surface = kind
  return material
}

// give every tagged material under `root` its surface (once per material)
export const applySurfaces = (root, { renderer = null, quality = "medium" } = {}) => {
  if (quality === "low") return 0
  if (typeof document !== "undefined") loadSurfaces(renderer)
  const done = new Set()
  root.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []
    for (const m of mats) {
      const kind = m.userData?.surface
      if (!kind || done.has(m) || m.userData.surfaced) continue
      done.add(m)
      m.userData.surfaced = true
      patch(m, kind)
    }
  })
  return done.size
}
