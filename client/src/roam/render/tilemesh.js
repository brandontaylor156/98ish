// Roam: a tile on screen. Near tiles: the painted ground on the terrain, the buildings with
// roof hints, lane markings and bridge decks; far tiles: the ground (a smaller texture) and
// plain blocks. One mesh each, so a tile costs 2-4 draw calls (docs/open-world.md "Phone
// budget"). Materials are shared; each tile owns its geometry and ground texture.
//
// Surfaces (docs/open-world.md "Materials"): the venues' CC0 surface textures (stucco, concrete,
// clay roof tile, grass, asphalt; park/surfaces.js, lent by the host) sampled in world space or
// along each wall, multiplying the paint so a street's hashed colours keep their average; detail
// fades out with distance. Windows are drawn in the building shader from each wall's metres:
// frames, mullions and sills on houses, storefront glass under a fascia band on shops, punched,
// ribbon or curtain-wall rows on tall buildings; the glass reflects the sky at a low angle and
// some windows are lit at night.

import * as THREE from "three"
import { buildingArrays } from "./buildings.js"
import { groundArrays, paintGround } from "./ground.js"
import { deckArrays, markingArrays, roadArrays } from "./linework.js"

// ---------- shared uniforms (set by the world) ----------
// the sky's colour (window reflections), night (0 day .. 1 night: lit windows, lamps)
export const roamLight = { sky: { value: new THREE.Color(0.55, 0.68, 0.82) }, night: { value: 0 }, lamp: { value: new THREE.Color(1.0, 0.78, 0.45) } }
// the surface textures: { value } holders (the host's, or a neutral grey until they load)
const neutral = () => {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)
  t.needsUpdate = true
  return { value: t }
}
const surf = { stucco: neutral(), concrete: neutral(), roof: neutral(), grass: neutral(), asphalt: neutral() }
// world.js: the host's textures (park/surfaces.js uniforms) -> used by every tile from now on
export const setRoamSurfaces = (get) => {
  if (!get) return
  for (const k of Object.keys(surf)) {
    const u = get(k)
    if (u) surf[k] = u
  }
  if (shared) {
    // (materials made before: point their uniforms at the new holders)
    shared.surfVersion++
  }
}

// ---------- shared materials ----------
let shared = null
const detailTexture = () => {
  // a small tileable noise (value noise, two octaves): breaks up the 1 m texels near the lens
  const n = 64
  const data = new Uint8Array(n * n * 4)
  const rnd = (i, j) => {
    const s = Math.sin(((i % n) * 127.1 + (j % n) * 311.7) * 1.0) * 43758.5453
    return s - Math.floor(s)
  }
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const coarse = (rnd(i >> 3, j >> 3) + rnd((i >> 3) + 1, j >> 3) + rnd(i >> 3, (j >> 3) + 1) + rnd((i >> 3) + 1, (j >> 3) + 1)) / 4
      const v = Math.round(255 * (0.55 * rnd(i, j) + 0.45 * coarse))
      const k = (j * n + i) * 4
      data[k] = data[k + 1] = data[k + 2] = v
      data[k + 3] = 255
    }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

const WORLD_VARY = /* glsl */ `
varying vec3 vRoamW;`

// the ground: grass, asphalt or concrete detail picked per pixel from the painted colour (like
// the venues' "ground" surface), a slow second sample against tiling, lawns a little uneven
const groundShader = (detail) => (sh) => {
  sh.uniforms.detailMap = { value: detail }
  sh.uniforms.surfGrass = surf.grass
  sh.uniforms.surfAsphalt = surf.asphalt
  sh.uniforms.surfConcrete = surf.concrete
  sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>${WORLD_VARY}`).replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvRoamW = (modelMatrix * vec4(transformed, 1.0)).xyz;")
  sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>${WORLD_VARY}
uniform sampler2D detailMap;
uniform sampler2D surfGrass;
uniform sampler2D surfAsphalt;
uniform sampler2D surfConcrete;`).replace(
    "#include <map_fragment>",
    `#include <map_fragment>
  {
    vec2 xz = vRoamW.xz;
    vec3 paint = diffuseColor.rgb;
    float green = smoothstep(0.01, 0.08, paint.g - max(paint.r, paint.b));
    float lum = dot(paint, vec3(0.299, 0.587, 0.114));
    float dark = 1.0 - smoothstep(0.08, 0.3, lum);
    float far = 1.0 - smoothstep(35.0, 140.0, distance(vRoamW, cameraPosition));
    vec4 dg = texture2D(surfGrass, xz * 0.55);
    vec4 da = texture2D(surfAsphalt, xz * 0.45);
    vec4 dc = texture2D(surfConcrete, xz * 0.3);
    vec4 d = mix(mix(dc, da, dark), dg, green);
    float k = mix(mix(0.45, 0.6, dark), 0.75, green) * far;
    diffuseColor.rgb *= mix(1.0, d.r * 2.0, k) * mix(1.0, d.a, 0.5 * far);
    // big slow variation: lawns greener and drier in patches, worn lots and hillsides
    float big = texture2D(detailMap, xz * 0.013).r * 0.6 + texture2D(detailMap, xz * 0.0031).r * 0.4;
    diffuseColor.rgb *= 0.86 + 0.28 * big;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.0, 0.82), green * smoothstep(0.55, 0.75, big) * 0.6);
    float roamD = texture2D(detailMap, xz * 0.31).r;
    diffuseColor.rgb *= mix(1.0, 0.9 + 0.2 * roamD, 1.0 - far * 0.7);
  }`
  )
}

// the buildings: textured walls and roofs (win.w: buildings.js SURF), windows from the wall's
// metres (win.xy) and its style (win.z: 1 house, 2 shop, 3 tall; the fraction varies them)
const buildingShader = (sh) => {
  sh.uniforms.surfStucco = surf.stucco
  sh.uniforms.surfConcrete = surf.concrete
  sh.uniforms.surfRoof = surf.roof
  sh.uniforms.roamSky = roamLight.sky
  sh.uniforms.roamNight = roamLight.night
  sh.uniforms.roamLamp = roamLight.lamp
  sh.vertexShader = sh.vertexShader
    .replace("#include <common>", `#include <common>${WORLD_VARY}
attribute vec4 win;
varying vec4 vWin;`)
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWin = win;")
    .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvRoamW = (modelMatrix * vec4(transformed, 1.0)).xyz;")
  sh.fragmentShader = sh.fragmentShader
    .replace("#include <common>", `#include <common>${WORLD_VARY}
varying vec4 vWin;
uniform sampler2D surfStucco;
uniform sampler2D surfConcrete;
uniform sampler2D surfRoof;
uniform vec3 roamSky;
uniform float roamNight;
uniform vec3 roamLamp;
float roamH(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// a box mask with soft (anti-aliased) edges: f in [lo, hi] on both axes
float roamBox(vec2 f, vec4 b, vec2 aa) {
  vec2 lo = smoothstep(b.xz - aa, b.xz + aa, f);
  vec2 hi = 1.0 - smoothstep(b.yw - aa, b.yw + aa, f);
  return lo.x * lo.y * hi.x * hi.y;
}`)
    .replace(
      "#include <color_fragment>",
      `#include <color_fragment>
  float roamGlass = 0.0;
  float roamLit = 0.0;
  {
    float sk = vWin.w;
    float far = 1.0 - smoothstep(40.0, 160.0, distance(vRoamW, cameraPosition));
    // the surface's grain
    vec4 d;
    if (sk > 1.5 && sk < 3.5) {
      d = texture2D(surfRoof, vWin.xy * vec2(0.6, 0.55));
      if (sk > 2.5) d.r = mix(d.r, 0.5, 0.45); // (shingles: flatter than clay)
    } else if (sk > 3.5) d = texture2D(surfConcrete, vRoamW.xz * 0.25);
    else if (sk > 0.5) d = texture2D(surfConcrete, vWin.xy * 0.3);
    else d = texture2D(surfStucco, vWin.xy * 0.7);
    float k = (sk > 1.5 && sk < 3.5 ? 0.6 : 0.5) * far;
    diffuseColor.rgb *= mix(1.0, d.r * 2.0, k) * mix(1.0, d.a, 0.7 * far);
    // (relief: the grain's own normal lit from above and the side, so stucco and tiles read)
    diffuseColor.rgb *= 1.0 + ((d.g - 0.5) * 0.5 + (d.b - 0.5) * 0.7) * far;
    // tilt-up panels: a joint every 9 m
    if (sk > 0.5 && sk < 1.5) diffuseColor.rgb *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.06, abs(fract(vWin.x / 9.0 + 0.5) - 0.5) * 9.0)) * far;
    float style = floor(vWin.z + 0.001);
    float hv = fract(vWin.z + 0.001);
    if (style > 0.5) {
      vec2 p = vWin.xy;
      vec2 aa = fwidth(p) * 0.75;
      vec3 frameC = vec3(0.9, 0.89, 0.86);
      float frame = 0.0;
      vec2 cell;
      vec2 f;
      vec2 id;
      if (style < 1.5) {
        // a house: wide windows with white frames and a middle mullion, one row a storey
        cell = vec2(3.4 + hv * 1.6, 2.9);
        f = p / cell;
        id = floor(f);
        f = fract(f) * cell;
        float wW = 1.1 + roamH(id + hv) * 0.8;
        float x0 = (cell.x - wW) * 0.5;
        vec4 b = vec4(x0, x0 + wW, 0.95, 2.25);
        float outer = roamBox(f, b + vec4(-0.08, 0.08, -0.08, 0.08), aa);
        float inner = roamBox(f, b, aa);
        float mull = 1.0 - smoothstep(0.03, 0.03 + aa.x * 2.0, abs(f.x - cell.x * 0.5));
        float rows = step(id.y, 1.0) * step(0.0, p.y) * step(0.32, roamH(id.xx + hv * 3.0));
        roamGlass = inner * (1.0 - mull) * rows;
        frame = (outer - inner + inner * mull) * rows;
      } else if (style < 2.5) {
        // a shop: storefront glass on the ground floor (mullions every 1.6 m) under a fascia
        // band; upper floors (if any) punched windows
        if (p.y < 4.2) {
          float m = abs(fract(p.x / 1.6) - 0.5) * 1.6;
          float mull = 1.0 - smoothstep(0.75, 0.75 + aa.x * 2.0, m);
          float glass = smoothstep(0.35, 0.35 + aa.y, p.y) * (1.0 - smoothstep(3.0, 3.0 + aa.y, p.y));
          // (a door now and then: a taller pane)
          roamGlass = glass * (1.0 - mull) * step(0.12, roamH(floor(vec2(p.x / 9.0, hv * 7.0))));
          frame = glass * mull * 0.6 + (1.0 - smoothstep(0.3, 0.36, p.y)) * 0.4;
          // the fascia (a darker band above the glass)
          float fas = smoothstep(3.1, 3.1 + aa.y, p.y) * (1.0 - smoothstep(4.0, 4.0 + aa.y, p.y));
          diffuseColor.rgb *= 1.0 - 0.28 * fas;
          frameC = vec3(0.24, 0.25, 0.26);
        } else {
          cell = vec2(3.0, 3.4);
          f = fract(p / cell) * cell;
          roamGlass = roamBox(f, vec4(0.7, 2.3, 1.0, 2.5), aa);
        }
      } else if (style > 3.5) {
        // a parking structure: open decks (a dark band under each level's parapet), columns
        float lv = fract(p.y / 3.0) * 3.0;
        float open = smoothstep(1.05, 1.05 + aa.y, lv) * (1.0 - smoothstep(2.75, 2.75 + aa.y, lv)) * step(1.0, p.y);
        float col = 1.0 - smoothstep(0.35, 0.35 + aa.x, abs(fract(p.x / 8.0 + 0.5) - 0.5) * 8.0);
        float deck = open * (1.0 - col);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.1, 0.11), deck * (far * 0.8 + 0.2));
        roamLit = deck * 0.5;
      } else {
        // tall: punched windows (apartments, hotels), ribbon bands (offices) or a curtain wall
        float floorH = 3.3 + hv * 0.4;
        float fl = floor(p.y / floorH);
        float fy = fract(p.y / floorH) * floorH;
        if (hv < 0.45) {
          cell = vec2(2.6 + hv * 2.0, floorH);
          f = fract(p / cell) * cell;
          id = floor(p / cell);
          float outer = roamBox(f, vec4(0.42, cell.x - 0.42, 0.85, floorH - 0.55), aa);
          float inner = roamBox(f, vec4(0.5, cell.x - 0.5, 0.93, floorH - 0.63), aa);
          roamGlass = inner;
          frame = (outer - inner) * 0.8;
          // (balconies' shade under every other window on apartments)
          diffuseColor.rgb *= 1.0 - 0.18 * roamBox(f, vec4(0.2, cell.x - 0.2, 0.0, 0.25), aa) * step(0.5, mod(id.x + fl, 2.0));
        } else if (hv < 0.75) {
          float band = smoothstep(0.95, 0.95 + aa.y, fy) * (1.0 - smoothstep(floorH - 0.5, floorH - 0.5 + aa.y, fy));
          float m = abs(fract(p.x / 1.5) - 0.5) * 1.5;
          float mull = 1.0 - smoothstep(0.69, 0.69 + aa.x * 2.0, m);
          roamGlass = band * (1.0 - mull);
          frame = band * mull;
          frameC = vec3(0.3, 0.32, 0.34);
        } else {
          float m = abs(fract(p.x / 1.5) - 0.5) * 1.5;
          float mull = 1.0 - smoothstep(0.71, 0.71 + aa.x * 2.0, m);
          float span = 1.0 - smoothstep(0.0, 0.08 + aa.y, abs(fy - floorH + 0.4) - 0.35);
          roamGlass = (1.0 - mull) * (1.0 - span) * step(0.3, p.y);
          frame = mull + span;
          frameC = vec3(0.32, 0.35, 0.38);
        }
        // (the ground floor: a lobby's glass all along)
        if (p.y < 4.0 && hv < 0.75) {
          float m = abs(fract(p.x / 2.0) - 0.5) * 2.0;
          float lob = smoothstep(0.3, 0.3 + aa.y, p.y) * (1.0 - smoothstep(3.3, 3.3 + aa.y, p.y));
          roamGlass = lob * (1.0 - smoothstep(0.93, 0.95, m));
          frame = lob - roamGlass;
          frameC = vec3(0.3, 0.32, 0.34);
        }
        id = floor(vec2(p.x / 2.6, fl));
      }
      float farW = 1.0 - smoothstep(150.0, 520.0, distance(vRoamW, cameraPosition));
      roamGlass *= farW * 0.8 + 0.2;
      frame = clamp(frame, 0.0, 1.0) * (far * 0.8 + 0.2);
      diffuseColor.rgb = mix(diffuseColor.rgb, frameC, frame);
      // what's behind the glass: dark rooms, curtains here and there
      vec2 wid = floor(vWin.xy / vec2(2.4, 3.1)) + hv * 17.0;
      float r = roamH(wid);
      vec3 room = mix(vec3(0.07, 0.08, 0.09), vec3(0.2, 0.19, 0.17), r * r);
      diffuseColor.rgb = mix(diffuseColor.rgb, room, roamGlass);
      roamLit = max(roamLit, roamGlass * step(0.5, roamH(wid + 3.1)) * (0.6 + 0.4 * r));
    }
  }`
    )
    .replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
  totalEmissiveRadiance += roamLamp * roamLit * roamNight * 0.9;`
    )
    .replace(
      "#include <opaque_fragment>",
      `// glass reflects the sky, more at a low angle (Fresnel)
  if (roamGlass > 0.0) {
    float fres = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 3.0);
    vec3 refl = roamSky * 0.8 * (1.0 - roamNight * 0.85);
    outgoingLight = mix(outgoingLight, refl, roamGlass * (0.12 + 0.55 * fres) * (1.0 - roamLit * roamNight));
  }
  #include <opaque_fragment>`
    )
}

export const materials = () => {
  if (shared) return shared
  const detail = detailTexture()
  const groundProto = (map) => {
    const m = new THREE.MeshLambertMaterial({ map })
    m.onBeforeCompile = groundShader(detail)
    m.customProgramCacheKey = () => "roam-ground-2"
    return m
  }
  const building = new THREE.MeshLambertMaterial({ vertexColors: true })
  building.onBeforeCompile = buildingShader
  building.customProgramCacheKey = () => "roam-buildings-2"
  const roads = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  roads.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detail }
    sh.uniforms.surfAsphalt = surf.asphalt
    sh.uniforms.surfConcrete = surf.concrete
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>${WORLD_VARY}`).replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvRoamW = (modelMatrix * vec4(transformed, 1.0)).xyz;")
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>${WORLD_VARY}
uniform sampler2D detailMap;
uniform sampler2D surfAsphalt;
uniform sampler2D surfConcrete;`).replace(
      "#include <color_fragment>",
      `#include <color_fragment>
  {
    vec2 xz = vRoamW.xz;
    float far = 1.0 - smoothstep(35.0, 140.0, distance(vRoamW, cameraPosition));
    float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    vec4 d = lum < 0.32 ? texture2D(surfAsphalt, xz * 0.45) : texture2D(surfConcrete, xz * 0.3);
    diffuseColor.rgb *= mix(1.0, d.r * 2.0, 0.6 * far) * mix(1.0, d.a, 0.5 * far);
    // worn patches and tyre tracks' polish: a slow variation
    float big = texture2D(detailMap, xz * 0.021).r;
    diffuseColor.rgb *= 0.9 + 0.2 * big;
    diffuseColor.rgb *= mix(1.0, 0.92 + 0.16 * texture2D(detailMap, xz * 0.5).r, 1.0 - far * 0.6);
  }`
    )
  }
  roads.customProgramCacheKey = () => "roam-roads-2"
  shared = {
    detail,
    surfVersion: 0,
    ground: groundProto,
    building,
    lines: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    roads,
    deck: new THREE.MeshLambertMaterial({ vertexColors: true }),
  }
  return shared
}
export const disposeMaterials = () => {
  if (!shared) return
  shared.detail.dispose()
  shared.building.dispose()
  shared.lines.dispose()
  shared.roads.dispose()
  shared.deck.dispose()
  shared = null
}

const geometryOf = ({ position, normal, color, uv, index, win }) => {
  const g = new THREE.BufferGeometry()
  if (win) g.setAttribute("win", new THREE.BufferAttribute(win, 4))
  g.setAttribute("position", new THREE.BufferAttribute(position, 3))
  if (normal) g.setAttribute("normal", new THREE.BufferAttribute(normal, 3))
  if (color) g.setAttribute("color", new THREE.BufferAttribute(color, 3))
  if (uv) g.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
  if (index) g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeBoundingSphere()
  return g
}

const makeCanvas = (size) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(size, size)
  const c = document.createElement("canvas")
  c.width = c.height = size
  return c
}

// tile: decoded; groundAt(x, z); opts: { near, texSize, anisotropy } -> { group, dispose, calls }
export const buildTileMesh = (tile, groundAt, { near = true, texSize = 512, anisotropy = 1 } = {}) => {
  const mats = materials()
  const group = new THREE.Group()
  group.matrixAutoUpdate = false
  const owned = []
  // the ground
  const canvas = makeCanvas(texSize)
  const ctx = canvas.getContext("2d")
  paintGround(ctx, tile, texSize)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = anisotropy
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  const groundMat = mats.ground(tex)
  const ground = new THREE.Mesh(geometryOf(groundArrays(tile)), groundMat)
  ground.matrixAutoUpdate = false
  ground.name = "ground"
  ground.receiveShadow = true
  group.add(ground)
  owned.push(ground.geometry, groundMat, tex)
  let calls = 1
  // the buildings
  const b = buildingArrays(tile.buildings, groundAt, { far: !near, key: tile.key })
  if (b.position.length) {
    const mesh = new THREE.Mesh(geometryOf(b), mats.building)
    mesh.matrixAutoUpdate = false
    mesh.name = "buildings"
    mesh.castShadow = near
    mesh.receiveShadow = true
    group.add(mesh)
    owned.push(mesh.geometry)
    calls++
  }
  if (near) {
    const rd = roadArrays(tile.roads, groundAt)
    if (rd.position.length) {
      const mesh = new THREE.Mesh(geometryOf(rd), mats.roads)
      mesh.matrixAutoUpdate = false
      mesh.name = "roads"
      mesh.receiveShadow = true
      group.add(mesh)
      owned.push(mesh.geometry)
      calls++
    }
    const m = markingArrays(tile.roads, groundAt, tile.areas, tile.buildings)
    if (m.position.length) {
      const mesh = new THREE.Mesh(geometryOf(m), mats.lines)
      mesh.matrixAutoUpdate = false
      mesh.name = "markings"
      mesh.receiveShadow = true
      mesh.renderOrder = 1
      group.add(mesh)
      owned.push(mesh.geometry)
      calls++
    }
  }
  const d = deckArrays(tile.roads)
  if (d.position.length) {
    const mesh = new THREE.Mesh(geometryOf(d), mats.deck)
    mesh.matrixAutoUpdate = false
    mesh.name = "decks"
    mesh.castShadow = near
    mesh.receiveShadow = true
    group.add(mesh)
    owned.push(mesh.geometry)
    calls++
  }
  return {
    group,
    calls,
    near,
    dispose() {
      group.removeFromParent()
      for (const o of owned) o.dispose()
    },
  }
}
