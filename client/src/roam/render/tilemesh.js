// Roam: a tile on screen. Near tiles: the painted ground on the terrain, the buildings with
// roof hints, lane markings and bridge decks; far tiles: the ground (a smaller texture) and
// plain blocks. One mesh each, so a tile costs 2-4 draw calls (docs/open-world.md "Phone
// budget"). Materials are shared; each tile owns its geometry and ground texture.

import * as THREE from "three"
import { buildingArrays } from "./buildings.js"
import { groundArrays, paintGround } from "./ground.js"
import { deckArrays, markingArrays } from "./linework.js"

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
    building: new THREE.MeshLambertMaterial({ vertexColors: true }),
    lines: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    deck: new THREE.MeshLambertMaterial({ vertexColors: true }),
  }
  return shared
}
export const disposeMaterials = () => {
  if (!shared) return
  shared.detail.dispose()
  shared.building.dispose()
  shared.lines.dispose()
  shared.deck.dispose()
  shared = null
}

const geometryOf = ({ position, normal, color, uv, index }) => {
  const g = new THREE.BufferGeometry()
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
