// Roam: a tile on screen. Near tiles: the painted ground on the terrain, the buildings with
// roof hints, lane markings and bridge decks; far tiles: the ground (a smaller texture) and
// plain blocks. One mesh each, so a tile costs 2-4 draw calls (docs/open-world.md "Phone
// budget"). Materials are shared; each tile owns its geometry and ground texture.

import * as THREE from "three"
import { buildingArrays } from "./buildings.js"
import { groundArrays, paintGround } from "./ground.js"
import { deckArrays, markingArrays, roadArrays } from "./linework.js"

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
export const materials = () => {
  if (shared) return shared
  const detail = detailTexture()
  const groundProto = (map) => {
    const m = new THREE.MeshLambertMaterial({ map })
    m.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: detail }
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vRoamXZ;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvRoamXZ = (modelMatrix * vec4(transformed, 1.0)).xz;")
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D detailMap;\nvarying vec2 vRoamXZ;")
        .replace("#include <map_fragment>", "#include <map_fragment>\nfloat roamD = texture2D(detailMap, vRoamXZ * 0.31).r * 0.6 + texture2D(detailMap, vRoamXZ * 0.047).r * 0.4;\ndiffuseColor.rgb *= 0.84 + 0.3 * roamD;")
    }
    m.customProgramCacheKey = () => "roam-ground"
    return m
  }
  shared = {
    detail,
    ground: groundProto,
    building: (() => {
      // windows drawn in the shader from each wall's own metres (no textures): rows of them
      // on tall buildings, storefront glass on shops, a few on houses
      const m = new THREE.MeshLambertMaterial({ vertexColors: true })
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>
attribute vec3 win;
varying vec3 vWin;`).replace("#include <begin_vertex>", `#include <begin_vertex>
vWin = win;`)
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
varying vec3 vWin;`).replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          if (vWin.z > 0.5) {
            float s = vWin.z;
            vec2 cell = s < 1.5 ? vec2(4.2, 3.0) : s < 2.5 ? vec2(3.2, 4.2) : vec2(2.3, 3.3);
            vec4 box = s < 1.5 ? vec4(0.32, 0.68, 0.32, 0.72) : s < 2.5 ? vec4(0.06, 0.94, 0.08, 0.72) : vec4(0.14, 0.86, 0.3, 0.84);
            vec2 f = fract(vWin.xy / cell);
            float row = floor(vWin.y / cell.y);
            float inW = step(box.x, f.x) * step(f.x, box.y) * step(box.z, f.y) * step(f.y, box.w) * step(0.0, vWin.y);
            if (s > 1.5 && s < 2.5) inW *= step(row, 0.5); // (shops: glass on the ground floor)
            if (s < 1.5) inW *= step(row, 1.5);
            vec3 glass = mix(vec3(0.16, 0.2, 0.25), vec3(0.42, 0.5, 0.58), fract(sin(dot(floor(vWin.xy / cell), vec2(12.9898, 78.233))) * 43758.5453) * 0.5);
            diffuseColor.rgb = mix(diffuseColor.rgb, glass, inW * 0.9);
          }`
        )
      }
      m.customProgramCacheKey = () => "roam-buildings"
      return m
    })(),
    lines: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    roads: (() => {
      const m = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
      m.onBeforeCompile = (sh) => {
        sh.uniforms.detailMap = { value: detail }
        sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>
varying vec2 vRoamXZ;`).replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
vRoamXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`)
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
uniform sampler2D detailMap;
varying vec2 vRoamXZ;`).replace("#include <color_fragment>", `#include <color_fragment>
diffuseColor.rgb *= 0.9 + 0.2 * texture2D(detailMap, vRoamXZ * 0.5).r;`)
      }
      m.customProgramCacheKey = () => "roam-roads"
      return m
    })(),
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
  if (win) g.setAttribute("win", new THREE.BufferAttribute(win, 3))
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
  group.add(ground)
  owned.push(ground.geometry, groundMat, tex)
  let calls = 1
  // the buildings
  const b = buildingArrays(tile.buildings, groundAt, { far: !near, key: tile.key })
  if (b.position.length) {
    const mesh = new THREE.Mesh(geometryOf(b), mats.building)
    mesh.matrixAutoUpdate = false
    mesh.name = "buildings"
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
      group.add(mesh)
      owned.push(mesh.geometry)
      calls++
    }
    const m = markingArrays(tile.roads, groundAt)
    if (m.position.length) {
      const mesh = new THREE.Mesh(geometryOf(m), mats.lines)
      mesh.matrixAutoUpdate = false
      mesh.name = "markings"
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
