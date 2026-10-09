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
import { deckArrays, markingArrays, platformArrays, roadArrays } from "./linework.js"
import { tileSeaAt } from "../data/tile.js"
import { disposeSea, seaArrays, seaMaterial } from "./sea.js"

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

// the ground's wear (a tileable 512 px picture, ~40 m across): R asphalt cracks and sealed
// patches (dark), G the hills' scrub (dark clumps of chaparral and sage on the golden grass),
// B worn, sun-bleached blotches. Painted once in the browser; neutral elsewhere.
export const wearTexture = () => {
  const n = 512
  const make = () => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(n, n) : typeof document !== "undefined" ? Object.assign(document.createElement("canvas"), { width: n, height: n }) : null)
  const cv = make()
  const g = cv?.getContext("2d")
  let data
  if (!g) data = new Uint8Array(n * n * 4).fill(255)
  else {
    let seed = 99
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const layer = (draw) => {
      g.fillStyle = "#fff"
      g.fillRect(0, 0, n, n)
      // (drawn nine times round the middle, so the picture tiles)
      for (const dx of [-n, 0, n])
        for (const dy of [-n, 0, n]) {
          g.save()
          g.translate(dx, dy)
          seed = 99
          draw()
          g.restore()
        }
      return g.getImageData(0, 0, n, n).data
    }
    const cracks = layer(() => {
      // sealed patches (dark rectangles with soft edges), then cracks: wandering lines that branch
      for (let i = 0; i < 7; i++) {
        g.fillStyle = `rgba(0,0,0,${0.1 + rand() * 0.12})`
        g.fillRect(rand() * n, rand() * n, 20 + rand() * 90, 12 + rand() * 50)
      }
      g.lineCap = "round"
      for (let i = 0; i < 26; i++) {
        let x = rand() * n
        let y = rand() * n
        let a = rand() * Math.PI * 2
        const steps = 10 + Math.floor(rand() * 40)
        g.strokeStyle = `rgba(0,0,0,${0.45 + rand() * 0.35})`
        g.lineWidth = 0.8 + rand() * 1.4
        g.beginPath()
        g.moveTo(x, y)
        for (let s = 0; s < steps; s++) {
          a += (rand() - 0.5) * 0.9
          x += Math.cos(a) * 6
          y += Math.sin(a) * 6
          g.lineTo(x, y)
          if (rand() < 0.08) {
            // (a branch: a short spur)
            const b = a + (rand() < 0.5 ? 1 : -1) * (0.6 + rand())
            g.moveTo(x, y)
            g.lineTo(x + Math.cos(b) * 14, y + Math.sin(b) * 14)
            g.moveTo(x, y)
          }
        }
        g.stroke()
      }
    })
    const scrub = layer(() => {
      // clumps: dark rounded bushes in drifts
      for (let i = 0; i < 900; i++) {
        const cx = rand() * n
        const cy = rand() * n
        const r = 2 + rand() * 7
        g.fillStyle = `rgba(0,0,0,${0.35 + rand() * 0.5})`
        g.beginPath()
        g.ellipse(cx, cy, r, r * (0.6 + rand() * 0.4), rand() * 3, 0, Math.PI * 2)
        g.fill()
      }
    })
    const worn = layer(() => {
      g.filter = "blur(8px)"
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(0,0,0,${0.15 + rand() * 0.25})`
        g.beginPath()
        g.ellipse(rand() * n, rand() * n, 10 + rand() * 40, 8 + rand() * 30, rand() * 3, 0, Math.PI * 2)
        g.fill()
      }
      g.filter = "none"
    })
    data = new Uint8Array(n * n * 4)
    for (let i = 0; i < n * n; i++) {
      data[i * 4] = cracks[i * 4]
      data[i * 4 + 1] = scrub[i * 4]
      data[i * 4 + 2] = worn[i * 4]
      data[i * 4 + 3] = 255
    }
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
const groundShader = (detail, wear) => (sh) => {
  sh.uniforms.detailMap = { value: detail }
  sh.uniforms.wearMap = { value: wear }
  sh.uniforms.surfGrass = surf.grass
  sh.uniforms.surfAsphalt = surf.asphalt
  sh.uniforms.surfConcrete = surf.concrete
  sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>${WORLD_VARY}`).replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvRoamW = (modelMatrix * vec4(transformed, 1.0)).xyz;")
  sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>${WORLD_VARY}
uniform sampler2D detailMap;
uniform sampler2D wearMap;
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
    // (each texture's grain about its own mean, so up close a surface is no lighter or darker
    // than far off: the coarsest mip is the mean)
    dg.r *= 0.5 / max(0.05, texture2D(surfGrass, vec2(0.5), 14.0).r);
    da.r *= 0.5 / max(0.05, texture2D(surfAsphalt, vec2(0.5), 14.0).r);
    dc.r *= 0.5 / max(0.05, texture2D(surfConcrete, vec2(0.5), 14.0).r);
    vec4 d = mix(mix(dc, da, dark), dg, green);
    float k = mix(mix(0.45, 0.6, dark), 0.75, green) * far;
    diffuseColor.rgb *= mix(1.0, d.r * 2.0, k) * mix(1.0, d.a, 0.5 * far);
    // big slow variation: lawns greener and drier in patches, worn lots and hillsides
    float big = texture2D(detailMap, xz * 0.013).r * 0.6 + texture2D(detailMap, xz * 0.0031).r * 0.4;
    diffuseColor.rgb *= 0.86 + 0.28 * big;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.0, 0.82), green * smoothstep(0.55, 0.75, big) * 0.6);
    float roamD = texture2D(detailMap, xz * 0.31).r;
    diffuseColor.rgb *= mix(1.0, 0.9 + 0.2 * roamD, 1.0 - far * 0.7);
    // asphalt up close: cracks and sealed patches, sun-bleached worn blotches
    float dist = distance(vRoamW, cameraPosition);
    float nearK = 1.0 - smoothstep(20.0, 80.0, dist);
    vec4 wr = texture2D(wearMap, xz * 0.025);
    diffuseColor.rgb *= mix(1.0, wr.r, dark * nearK * 0.85);
    diffuseColor.rgb *= 1.0 + (1.0 - wr.b) * 0.12 * dark * far;
    // the golden hills (and dry ground, washes): drifts of dark scrub, seen from afar too
    float tanK = smoothstep(0.12, 0.18, paint.r - paint.b) * (1.0 - green) * (1.0 - dark) * (1.0 - smoothstep(0.42, 0.52, lum));
    float sc = (1.0 - texture2D(wearMap, xz * 0.055).g) * 0.75 + (1.0 - texture2D(wearMap, xz * 0.0137 + 0.31).g) * 0.6;
    // (up close the drifts fade: they read as bushes from afar, as flat spots underfoot)
    float scK = smoothstep(25.0, 90.0, dist);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.058, 0.024), clamp(sc, 0.0, 1.0) * tanK * mix(0.12, 0.6, scK));
    // pale paving (plazas, sidewalks, aprons): its joints, a slab every 1.8 m, up close
    float pale = smoothstep(0.2, 0.3, lum) * (1.0 - green) * (1.0 - tanK);
    vec2 jg = abs(fract(xz / 1.8 + 0.5) - 0.5) * 1.8;
    vec2 jw = fwidth(xz) * 0.8 + 0.015;
    float joint = max(1.0 - smoothstep(jw.x, jw.x * 2.0, jg.x), 1.0 - smoothstep(jw.y, jw.y * 2.0, jg.y));
    diffuseColor.rgb *= 1.0 - joint * pale * nearK * 0.18;
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
attribute float wtop;
varying vec4 vWin;
varying float vTop;`)
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWin = win;\nvTop = wtop;")
    .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvRoamW = (modelMatrix * vec4(transformed, 1.0)).xyz;")
  sh.fragmentShader = sh.fragmentShader
    .replace("#include <common>", `#include <common>${WORLD_VARY}
varying vec4 vWin;
varying float vTop;
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
    // the walls of shops, offices and works: a darker base at the foot, a parapet's coping at
    // the top with its shadow line, and on blank walls two reveal lines under it (so a big wall
    // isn't a flat grey slab)
    {
      float st0 = floor(vWin.z + 0.001);
      if (vTop > 2.0 && (st0 < 0.5 || st0 > 1.5)) {
        float y = vWin.y;
        float ay = max(fwidth(y), 0.01);
        float base = 1.0 - smoothstep(0.45 - ay, 0.45 + ay, y);
        diffuseColor.rgb *= 1.0 - 0.24 * base;
        float cap = smoothstep(vTop - 0.5 - ay, vTop - 0.5 + ay, y);
        diffuseColor.rgb = mix(diffuseColor.rgb, min(vec3(1.0), diffuseColor.rgb * 1.12 + 0.025), cap);
        float shade = smoothstep(vTop - 0.68 - ay, vTop - 0.68 + ay, y) * (1.0 - smoothstep(vTop - 0.5 - ay, vTop - 0.5 + ay, y));
        diffuseColor.rgb *= 1.0 - 0.38 * shade;
        if (st0 < 0.5 && vTop > 5.0) {
          float r1 = 1.0 - smoothstep(0.03, 0.03 + ay * 1.5, abs(y - (vTop - 1.6)));
          float r2 = 1.0 - smoothstep(0.03, 0.03 + ay * 1.5, abs(y - (vTop - 2.1)));
          diffuseColor.rgb *= 1.0 - 0.3 * max(r1, r2) * far;
        }
      }
    }
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
          // the fascia (a darker band above the glass) and the shops' sign panels on it (blank:
          // no names; a light or a dark panel over most bays)
          float fas = smoothstep(3.1, 3.1 + aa.y, p.y) * (1.0 - smoothstep(4.0, 4.0 + aa.y, p.y));
          diffuseColor.rgb *= 1.0 - 0.28 * fas;
          float bay = floor(p.x / 9.0);
          float bx = p.x - bay * 9.0;
          float sh = roamH(vec2(bay, hv * 13.0));
          float sign = roamBox(vec2(bx, p.y), vec4(1.6, 7.4, 3.25, 3.88), aa) * step(0.3, sh);
          vec3 signC = sh > 0.65 ? vec3(0.16, 0.17, 0.19) : vec3(0.93, 0.92, 0.88);
          diffuseColor.rgb = mix(diffuseColor.rgb, signC, sign * (far * 0.7 + 0.3));
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
  const wear = wearTexture()
  const groundProto = (map) => {
    const m = new THREE.MeshLambertMaterial({ map })
    m.onBeforeCompile = groundShader(detail, wear)
    m.customProgramCacheKey = () => "roam-ground-4"
    return m
  }
  const building = new THREE.MeshLambertMaterial({ vertexColors: true })
  building.onBeforeCompile = buildingShader
  building.customProgramCacheKey = () => "roam-buildings-3"
  const roads = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  roads.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detail }
    sh.uniforms.wearMap = { value: wear }
    sh.uniforms.surfAsphalt = surf.asphalt
    sh.uniforms.surfConcrete = surf.concrete
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>${WORLD_VARY}`).replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvRoamW = (modelMatrix * vec4(transformed, 1.0)).xyz;")
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>${WORLD_VARY}
uniform sampler2D detailMap;
uniform sampler2D wearMap;
uniform sampler2D surfAsphalt;
uniform sampler2D surfConcrete;`).replace(
      "#include <color_fragment>",
      `#include <color_fragment>
  {
    vec2 xz = vRoamW.xz;
    float far = 1.0 - smoothstep(35.0, 140.0, distance(vRoamW, cameraPosition));
    float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    vec4 d = lum < 0.32 ? texture2D(surfAsphalt, xz * 0.45) : texture2D(surfConcrete, xz * 0.3);
    d.r *= 0.5 / max(0.05, lum < 0.32 ? texture2D(surfAsphalt, vec2(0.5), 14.0).r : texture2D(surfConcrete, vec2(0.5), 14.0).r);
    diffuseColor.rgb *= mix(1.0, d.r * 2.0, 0.6 * far) * mix(1.0, d.a, 0.5 * far);
    // worn patches and tyre tracks' polish: a slow variation
    float big = texture2D(detailMap, xz * 0.021).r;
    diffuseColor.rgb *= 0.9 + 0.2 * big;
    diffuseColor.rgb *= mix(1.0, 0.92 + 0.16 * texture2D(detailMap, xz * 0.5).r, 1.0 - far * 0.6);
    // (asphalt: cracks and sealed patches up close)
    float nearK = 1.0 - smoothstep(20.0, 80.0, distance(vRoamW, cameraPosition));
    vec4 wr = texture2D(wearMap, xz * 0.025 + 0.5);
    diffuseColor.rgb *= mix(1.0, wr.r, step(lum, 0.32) * nearK * 0.8);
    // (sidewalks and plazas: the joints between their slabs, every 1.8 m, up close)
    vec2 jg = abs(fract(xz / 1.8 + 0.5) - 0.5) * 1.8;
    vec2 jw = fwidth(xz) * 0.8 + 0.015;
    float joint = max(1.0 - smoothstep(jw.x, jw.x * 2.0, jg.x), 1.0 - smoothstep(jw.y, jw.y * 2.0, jg.y));
    diffuseColor.rgb *= 1.0 - joint * step(0.32, lum) * nearK * 0.2;
  }`
    )
  }
  roads.customProgramCacheKey = () => "roam-roads-4"
  shared = {
    detail,
    wear,
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
  shared.wear.dispose()
  shared.building.dispose()
  shared.lines.dispose()
  shared.roads.dispose()
  shared.deck.dispose()
  disposeSea()
  shared = null
}

const geometryOf = ({ position, normal, color, uv, index, win, wtop }) => {
  const g = new THREE.BufferGeometry()
  if (win) g.setAttribute("win", new THREE.BufferAttribute(win, 4))
  if (wtop) g.setAttribute("wtop", new THREE.BufferAttribute(wtop, 1))
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
  // the sea (a coast town; render/sea.js), near and far
  const sa = seaArrays(tile, tile.seaY ?? 0)
  if (sa) {
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.BufferAttribute(sa.position, 3))
    g.setAttribute("foam", new THREE.BufferAttribute(sa.foam, 1))
    g.setIndex(new THREE.BufferAttribute(sa.index, 1))
    g.computeBoundingSphere()
    const mesh = new THREE.Mesh(g, seaMaterial())
    mesh.matrixAutoUpdate = false
    mesh.name = "sea"
    group.add(mesh)
    owned.push(g)
    calls++
  }
  // piers mapped as areas: their decks, pilings and railings
  if (tile.platforms?.some((p) => p.own)) {
    const r = tile.rect
    const wet = (x, z) => x < r.x0 - 10 || x > r.x1 + 10 || z < r.z0 - 10 || z > r.z1 + 10 || tileSeaAt(tile, x, z)
    const pa = platformArrays(tile.platforms, tile.seaY ?? 0, wet)
    if (pa.position.length) {
      const mesh = new THREE.Mesh(geometryOf(pa), mats.deck)
      mesh.matrixAutoUpdate = false
      mesh.name = "piers"
      mesh.castShadow = near
      mesh.receiveShadow = true
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
