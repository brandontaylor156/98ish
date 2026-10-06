// Venue realism, round 2 (docs/venue-realism.md): the detail that makes a venue stop looking
// like painted boxes, on Medium/High (Low keeps the old cheap shapes in scenery.js):
//
// - trees: broad-leaf, eucalyptus, palm and conifer models made of a bark trunk and branches
//   plus alpha-cut leaf cards (crossed quads with leaf-cluster pictures) whose normals point out
//   of the crown, so a canopy shades round; instanced in two or three variants each, swaying in
//   the wind in the vertex shader; they cast real (cut-out) shadows;
// - cars: a bevelled side-profile body with glass that reflects the sky, four wheels with rims
//   (three shapes: sedan, SUV, hatchback), metallic paint;
// - decals: scuffs at the kitchen lines and behind the baselines, ball marks, oil stains in the
//   stalls, cracks in the lots, fallen leaves under trees, a soft shadow under every car;
// - walls: windows with frames, mullions, sills and lintels in relief (normal map) whose glass
//   reflects the sky (a specular mask on the Lambert wall: the wall's own paint is unchanged);
// - a sky environment picture (equirectangular, drawn from the venue's light) for reflections;
// - a glow round every hall light (one Points draw), and better chain-link that throws shadows.
//
// Every picture is drawn here (canvas), so there's nothing to download and nothing to license.

import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"

const hasDoc = () => typeof document !== "undefined"

// a picture drawn on a canvas (Node tests have no canvas: a 1x1 stand-in)
export const canvasTex = (w, h, draw, { srgb = true, repeat = true } = {}) => {
  let t
  if (hasDoc()) {
    const c = document.createElement("canvas")
    c.width = w
    c.height = h
    draw(c.getContext("2d"), w, h, c)
    t = new THREE.CanvasTexture(c)
  } else {
    t = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1)
    t.needsUpdate = true
  }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}

// a normal map from a height picture (canvas luminance: white = up)
const normalFromHeight = (src, strength = 2) => {
  const w = src.width
  const h = src.height
  const sctx = src.getContext("2d")
  const s = sctx.getImageData(0, 0, w, h).data
  const out = document.createElement("canvas")
  out.width = w
  out.height = h
  const octx = out.getContext("2d")
  const img = octx.createImageData(w, h)
  const H = (x, y) => s[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength
      const l = Math.hypot(dx, dy, 1)
      const i = (y * w + x) * 4
      img.data[i] = (-dx / l) * 127 + 128
      img.data[i + 1] = (dy / l) * 127 + 128
      img.data[i + 2] = (1 / l) * 127 + 128
      img.data[i + 3] = 255
    }
  octx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(out)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}

// a seeded random for the pictures (the same picture every build)
const rng = (seed) => {
  let s = seed >>> 0 || 1
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

// ---------------------------------------------------------------- wind

// one clock for every swaying leaf (set when a tree mesh is drawn)
export const windT = { value: 0 }
// how hard it blows (Real Sky: the venue's wind speed; 1 a light breeze, up to ~3.5 a gale)
export const windAmp = { value: 1 }
export const setWindStrength = (ms = 2) => (windAmp.value = Math.max(0.35, Math.min(3.5, 0.55 + ms / 4.5)))
const swaying = (material) => {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.windT = windT
    shader.uniforms.windAmp = windAmp
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float windT;\nuniform float windAmp;\nattribute float wind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  {
    vec2 wp = vec2(0.0);
    #ifdef USE_INSTANCING
      wp = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
    #endif
    float ph = wp.x * 0.23 + wp.y * 0.17;
    float g = sin(windT * 0.9 + ph * 0.3) * 0.5 + 0.5;
    float sw = wind * windAmp * (sin(windT * 1.6 * (0.7 + 0.3 * windAmp) + ph) * 0.7 + sin(windT * 3.7 + ph * 2.3 + position.y) * 0.3) * (0.5 + g);
    transformed.x += sw * 0.09;
    transformed.z += sw * 0.06;
  }`
      )
  }
  material.customProgramCacheKey = () => "sway"
  return material
}
const tick = (mesh) => {
  mesh.onBeforeRender = () => (windT.value = performance.now() / 1000)
  return mesh
}

// ---------------------------------------------------------------- pictures

// a cluster of leaves on a transparent ground (broad-leaf, eucalyptus)
const leafTex = (kind) =>
  canvasTex(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    const r = rng(kind === "euc" ? 77 : 41)
    // twigs
    ctx.strokeStyle = "rgba(70,52,34,0.9)"
    ctx.lineWidth = 2
    for (let i = 0; i < 6; i++) {
      ctx.beginPath()
      ctx.moveTo(w / 2, h * 0.95)
      ctx.quadraticCurveTo(w * (0.3 + r() * 0.4), h * 0.5, w * (0.1 + r() * 0.8), h * (0.08 + r() * 0.4))
      ctx.stroke()
    }
    const n = kind === "euc" ? 200 : 360
    for (let i = 0; i < n; i++) {
      // denser in the middle, ragged at the edge
      const a = r() * Math.PI * 2
      const d = Math.sqrt(r()) * 0.46
      const x = w / 2 + Math.cos(a) * d * w
      const y = h / 2 + Math.sin(a) * d * h * 0.95
      const len = (kind === "euc" ? 14 : 8) + r() * 5
      const wid = kind === "euc" ? 3 + r() * 1.5 : 4.5 + r() * 2.5
      const hue = kind === "euc" ? 95 + r() * 25 : 85 + r() * 35
      const sat = kind === "euc" ? 18 + r() * 12 : 38 + r() * 22
      const lit = 24 + r() * 20 - d * 14
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(r() * Math.PI * 2)
      ctx.fillStyle = `hsl(${hue},${sat}%,${lit}%)`
      ctx.beginPath()
      ctx.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2)
      ctx.fill()
      // the lit half of the leaf
      ctx.fillStyle = `hsla(${hue - 5},${sat + 5}%,${lit + 12}%,0.55)`
      ctx.beginPath()
      ctx.ellipse(0, -wid * 0.15, len / 2.3, wid / 3.5, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  })

// a palm frond: a midrib down the middle (v), leaflets out to both sides (u)
const frondTex = () =>
  canvasTex(128, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    const r = rng(9)
    for (let y = 8; y < h - 4; y += 5) {
      const t = y / h // 0 at the trunk, 1 at the tip
      const len = (w / 2 - 4) * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)) * (0.85 + r() * 0.15)
      for (const side of [-1, 1]) {
        const hue = 78 + r() * 22
        ctx.strokeStyle = `hsl(${hue},${34 + r() * 18}%,${24 + r() * 16}%)`
        ctx.lineWidth = 2.6
        ctx.beginPath()
        ctx.moveTo(w / 2, y)
        ctx.quadraticCurveTo(w / 2 + side * len * 0.5, y + 6, w / 2 + side * len, y + 18 + r() * 8)
        ctx.stroke()
      }
    }
    ctx.strokeStyle = "#6b6a3a"
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(w / 2, 0)
    ctx.lineTo(w / 2, h)
    ctx.stroke()
  })

// a spray of needles (conifer tiers)
const needleTex = () =>
  canvasTex(256, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    const r = rng(23)
    for (let i = 0; i < 420; i++) {
      // a downward fan: wide at the bottom, the branch along the top
      const u = r()
      const x = w * (0.04 + u * 0.92)
      const y = h * (0.1 + r() * 0.8 * (1 - Math.abs(u - 0.5) * 0.9))
      const a = Math.PI / 2 + (r() - 0.5) * 1.6
      const l = 8 + r() * 10
      ctx.strokeStyle = `hsl(${140 + r() * 20},${28 + r() * 15}%,${16 + r() * 14}%)`
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
      ctx.stroke()
    }
    ctx.strokeStyle = "#3d2f22"
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(4, h * 0.12)
    ctx.lineTo(w - 4, h * 0.12)
    ctx.stroke()
  })

// bark: vertical fissures; palm bark: rings of old frond bases
const barkTex = (palm) =>
  canvasTex(128, 256, (ctx, w, h) => {
    const r = rng(palm ? 5 : 3)
    ctx.fillStyle = palm ? "#8a7a62" : "#6a5844"
    ctx.fillRect(0, 0, w, h)
    if (palm) {
      for (let y = 0; y < h; y += 12) {
        ctx.fillStyle = `rgba(40,30,20,${0.35 + r() * 0.2})`
        ctx.fillRect(0, y, w, 3)
        ctx.fillStyle = `rgba(255,240,210,${0.08 + r() * 0.08})`
        ctx.fillRect(0, y + 4, w, 4)
      }
    } else {
      for (let i = 0; i < 60; i++) {
        ctx.strokeStyle = `rgba(${30 + r() * 30},${22 + r() * 20},${14 + r() * 14},${0.5 + r() * 0.4})`
        ctx.lineWidth = 1 + r() * 3
        const x = r() * w
        ctx.beginPath()
        ctx.moveTo(x, 0)
        for (let y = 0; y <= h; y += 16) ctx.lineTo(x + (r() - 0.5) * 8, y)
        ctx.stroke()
      }
    }
  })

// ---------------------------------------------------------------- geometry helpers

// crossed leaf cards round a crown, normals pointing out of it (round shading), wind weights
const cardCrown = ({ seed, n, cx = 0, cy, cz = 0, rx, ry, rz = rx, size, tex = "leaf", tilt = 1 }) => {
  const r = rng(seed)
  const parts = []
  const c = new THREE.Vector3(cx, cy, cz)
  for (let i = 0; i < n; i++) {
    // a point in the crown's shell (mostly the outer half)
    const u = r() * 2 - 1
    const a = r() * Math.PI * 2
    const sr = Math.sqrt(1 - u * u)
    const d = 0.55 + Math.sqrt(r()) * 0.45
    const p = new THREE.Vector3(cx + Math.cos(a) * sr * rx * d, cy + u * ry * d, cz + Math.sin(a) * sr * rz * d)
    const s = size * (0.75 + r() * 0.5)
    for (let k = 0; k < 2; k++) {
      const g = new THREE.PlaneGeometry(s, s)
      g.rotateY(k * Math.PI * 0.5 + r() * 0.4)
      g.rotateX((r() - 0.5) * tilt)
      g.rotateZ((r() - 0.5) * tilt)
      g.translate(p.x, p.y, p.z)
      parts.push(g)
    }
  }
  const geo = mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  // normals out of the crown (a little up), wind more at the top and the outside
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  const wind = new Float32Array(pos.count)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(c)
    const dist = Math.min(1, v.length() / Math.max(rx, ry))
    v.y += ry * 0.35
    v.normalize()
    nor.setXYZ(i, v.x, v.y, v.z)
    wind[i] = Math.max(0, Math.min(1.2, (pos.getY(i) - (cy - ry)) / (2 * ry))) * 0.6 + dist * 0.6
  }
  geo.setAttribute("wind", new THREE.BufferAttribute(wind, 1))
  return geo
}

const trunkWithBranches = ({ seed, h, r0, r1, branches = 3, branchY = 0.7, branchL = 1.4, lean = 0 }) => {
  const r = rng(seed)
  const parts = []
  const t = new THREE.CylinderGeometry(r1, r0, h, 8, 4)
  t.translate(0, h / 2, 0)
  // a slight bend
  const p = t.attributes.position
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / h
    p.setX(i, p.getX(i) + Math.sin(y * 2.2 + seed) * 0.08 * y + lean * y * y)
  }
  parts.push(t)
  for (let i = 0; i < branches; i++) {
    const b = new THREE.CylinderGeometry(r1 * 0.35, r1 * 0.8, branchL, 6)
    b.translate(0, branchL / 2, 0)
    b.rotateZ(0.55 + r() * 0.5)
    b.rotateY((i / branches) * Math.PI * 2 + r())
    b.translate(lean * branchY * branchY, h * (branchY + r() * 0.2), 0)
    parts.push(b)
  }
  const geo = mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  return geo
}

// a palm crown: drooping fronds (a strip along a curve), a few dead brown ones hanging
const palmCrown = (seed) => {
  const r = rng(seed)
  const parts = []
  const N = 11
  const frond = (yaw, lift, len, dead) => {
    const seg = 5
    const pos = []
    const uv = []
    const col = []
    const idx = []
    for (let i = 0; i <= seg; i++) {
      const t = i / seg
      const out = len * t
      const y = lift * t * len * 0.35 - (dead ? 2.4 : 1.6) * t * t * len * 0.45
      const w = (dead ? 0.35 : 0.95) * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.9))
      // a V across the leaf (the leaflets fold up)
      for (const s of [-1, 0, 1]) {
        pos.push(s * w, y + (s ? 0.12 * w : 0), out)
        uv.push(0.5 + s * 0.5, 1 - t)
        const c = dead ? [0.62, 0.48, 0.3] : [1, 1, 1]
        col.push(...c)
      }
    }
    for (let i = 0; i < seg; i++)
      for (let s = 0; s < 2; s++) {
        const a = i * 3 + s
        const b = a + 1
        const c = a + 3
        const d = a + 4
        idx.push(a, c, b, b, c, d)
      }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    g.rotateY(yaw)
    return g
  }
  for (let i = 0; i < N; i++) parts.push(frond((i / N) * Math.PI * 2 + r() * 0.3, 0.6 + r() * 1.4, 3.0 + r() * 0.9, false))
  for (let i = 0; i < 2; i++) parts.push(frond(r() * Math.PI * 2, -1.5, 2.2 + r() * 0.5, true))
  const geo = mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  const pos = geo.attributes.position
  const wind = new Float32Array(pos.count)
  for (let i = 0; i < pos.count; i++) wind[i] = Math.min(1.4, Math.hypot(pos.getX(i), pos.getZ(i)) / 2.6)
  geo.setAttribute("wind", new THREE.BufferAttribute(wind, 1))
  return geo
}

// conifer tiers: rings of drooping needle cards
const coniferCrown = (seed) => {
  const r = rng(seed)
  const parts = []
  const tiers = 8
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1)
    const y = 1.3 + k * 5.2
    const rad = 2.0 * (1 - k) + 0.35
    const n = Math.max(4, Math.round(10 * (1 - k * 0.6)))
    for (let i = 0; i < n; i++) {
      const g = new THREE.PlaneGeometry(rad * 1.1, Math.max(0.6, rad * 0.55))
      g.translate(rad * 0.55, 0, 0)
      g.rotateX(-Math.PI / 2)
      g.rotateZ(-0.35 - r() * 0.2) // droop
      g.rotateY((i / n) * Math.PI * 2 + r() * 0.4 + t)
      g.translate(0, y, 0)
      parts.push(g)
    }
  }
  const geo = mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  const wind = new Float32Array(pos.count)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), 0.6, pos.getZ(i)).normalize()
    nor.setXYZ(i, v.x, v.y, v.z)
    wind[i] = Math.min(1, pos.getY(i) / 7) * 0.7 + Math.hypot(pos.getX(i), pos.getZ(i)) * 0.15
  }
  geo.setAttribute("wind", new THREE.BufferAttribute(wind, 1))
  return geo
}

// ---------------------------------------------------------------- trees

// byKind: { broadleaf: [{ x, z, s }], eucalyptus, palm, conifer }; the meshes go into group
export const buildTrees = (group, byKind, { keep = (x) => x, rand = Math.random } = {}) => {
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  const cc = new THREE.Color()
  const leafMat = (map, opts = {}) => keep(swaying(new THREE.MeshLambertMaterial({ map: keep(map), alphaTest: 0.45, side: THREE.DoubleSide, ...opts })))
  const barkMat = keep(new THREE.MeshLambertMaterial({ map: keep(barkTex(false)), color: 0xffffff }))
  const palmBarkMat = keep(new THREE.MeshLambertMaterial({ map: keep(barkTex(true)), color: 0xffffff }))
  const add = (geo, mat, list, place, color) => {
    if (!list.length) return
    const mesh = new THREE.InstancedMesh(keep(geo), mat, list.length)
    list.forEach((t, i) => {
      mesh.setMatrixAt(i, place(t, i))
      if (color) mesh.setColorAt(i, color(t, i))
    })
    group.add(tick(mesh))
    return mesh
  }
  const tint = (base, j = 0.08) => () => cc.set(base).offsetHSL((rand() - 0.5) * 0.03, (rand() - 0.5) * 0.1, (rand() - 0.5) * j)
  const at = (t, sy = 1) => m4.compose(v1.set(t.x, 0, t.z), q.setFromEuler(e.set(0, t.yaw ?? (t.x * 7.3 + t.z) % 6.28, 0)), v2.set(t.s, t.s * sy, t.s))

  // broad-leaf: two variants (a rounder and a taller crown)
  const broad = byKind.broadleaf || []
  const variants = [
    { trunk: trunkWithBranches({ seed: 1, h: 3.2, r0: 0.24, r1: 0.13 }), crown: cardCrown({ seed: 11, n: 42, cy: 3.9, rx: 2.1, ry: 1.7, size: 1.6 }) },
    { trunk: trunkWithBranches({ seed: 2, h: 3.6, r0: 0.22, r1: 0.12, branches: 4 }), crown: cardCrown({ seed: 12, n: 46, cy: 4.4, rx: 1.8, ry: 2.1, size: 1.5 }) },
  ]
  const broadLeaf = leafMat(leafTex("broad"))
  variants.forEach((vv, k) => {
    const list = broad.filter((_, i) => i % variants.length === k)
    add(vv.trunk, barkMat, list, (t) => at(t))
    add(vv.crown, broadLeaf, list, (t) => at(t), tint(0xe6f0e0))
  })
  // eucalyptus: tall pale trunks, a high loose crown
  const euc = byKind.eucalyptus || []
  if (euc.length) {
    const trunk = trunkWithBranches({ seed: 4, h: 6.5, r0: 0.3, r1: 0.14, branches: 4, branchY: 0.6, branchL: 2.2, lean: 0.4 })
    const crown = cardCrown({ seed: 14, n: 40, cy: 7.6, rx: 2.3, ry: 2.4, size: 1.9, tilt: 1.4 })
    const eucBark = keep(new THREE.MeshLambertMaterial({ map: barkMat.map, color: 0xd8cfc0 }))
    add(trunk, eucBark, euc, (t) => at(t))
    add(crown, leafMat(leafTex("euc")), euc, (t) => at(t), tint(0xdde6d8))
  }
  // palms: a ringed trunk (scaled to each palm's height), a crown of fronds on top
  const palms = byKind.palm || []
  if (palms.length) {
    const tg = new THREE.CylinderGeometry(0.17, 0.25, 1, 7, 10, true)
    const p = tg.attributes.position
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + 0.5
      const k = 1 + 0.07 * Math.abs(Math.sin(y * Math.PI * 13))
      p.setX(i, p.getX(i) * k)
      p.setZ(i, p.getZ(i) * k)
    }
    tg.translate(0, 0.5, 0)
    tg.computeVertexNormals()
    const heights = palms.map((t) => t.h || (7 + ((t.x * 13.1 + t.z * 7.7) % 1 + 1) % 1 * 6) * t.s)
    add(tg, palmBarkMat, palms, (t, i) => m4.compose(v1.set(t.x, 0, t.z), q.identity(), v2.set(t.s, heights[i], t.s)))
    const crowns = [palmCrown(31), palmCrown(32)]
    const frondMat = leafMat(frondTex(), { vertexColors: true })
    crowns.forEach((geo, k) => {
      const idx = palms.map((_, i) => i).filter((i) => i % 2 === k)
      add(
        geo,
        frondMat,
        idx.map((i) => palms[i]),
        (t, j) => m4.compose(v1.set(t.x, heights[idx[j]] - 0.1, t.z), q.setFromEuler(e.set(0, (t.x + t.z) % 6.28, 0)), v2.set(t.s, t.s, t.s)),
        tint(0xffffff, 0.06)
      )
    })
  }
  // conifers
  const con = byKind.conifer || []
  if (con.length) {
    add(trunkWithBranches({ seed: 6, h: 6.0, r0: 0.2, r1: 0.06, branches: 0 }), barkMat, con, (t) => at(t))
    add(coniferCrown(16), leafMat(needleTex()), con, (t) => at(t), tint(0xe8efe8))
  }
}

// ---------------------------------------------------------------- cars

// side profiles (x along the car, y up): a full-width lower body to the beltline and a
// narrower cabin on it (real cars taper above the doors), the glass just proud of the cabin
const carShapes = {
  sedan: { lower: [[-2.25, 0.32], [-2.25, 0.8], [-2.0, 0.92], [2.05, 0.88], [2.25, 0.64], [2.25, 0.32]], cabin: [[-1.45, 0.9], [-0.95, 1.38], [0.45, 1.4], [1.15, 0.9]], cw: 1.42, wheelZ: 1.38, track: 0.8, front: 2.25, back: -2.25, lightY: 0.74 },
  suv: { lower: [[-2.3, 0.36], [-2.3, 1.06], [2.2, 1.04], [2.3, 0.76], [2.3, 0.36]], cabin: [[-2.22, 1.04], [-2.12, 1.66], [0.55, 1.68], [1.35, 1.04]], cw: 1.52, wheelZ: 1.45, track: 0.84, front: 2.3, back: -2.3, lightY: 0.9 },
  hatch: { lower: [[-1.95, 0.32], [-1.95, 0.94], [1.85, 0.9], [2.0, 0.66], [2.0, 0.32]], cabin: [[-1.92, 0.92], [-1.75, 1.44], [0.35, 1.46], [1.05, 0.92]], cw: 1.44, wheelZ: 1.22, track: 0.78, front: 2.0, back: -1.95, lightY: 0.76 },
}
const extrude = (pts, width, bevel) => {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), bevel ? { depth: width - 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 1, curveSegments: 1 } : { depth: width, bevelEnabled: false })
  g.translate(0, 0, -(bevel ? width - 0.12 : width) / 2)
  g.rotateY(Math.PI / 2)
  return g
}
const carGeos = (kind) => {
  const k = carShapes[kind]
  const W = 1.76
  const lower = extrude(k.lower, W, true)
  const cabin = extrude(k.cabin, k.cw, true)
  const body = mergeGeometries([lower, cabin].map((g) => (g.index ? g.toNonIndexed() : g)), false)
  lower.dispose()
  cabin.dispose()
  body.computeVertexNormals()
  // the glass: the cabin's outline, out a little on the slopes, down a little from the roof
  const [a, b, c, d] = k.cabin.map(([x, y]) => new THREE.Vector2(x, y))
  const out = (p, q, amt) => new THREE.Vector2(q.y - p.y, p.x - q.x).normalize().multiplyScalar(-amt)
  const nb = out(a, b, 0.035)
  const nd = out(c, d, 0.035)
  const g = [a.clone().lerp(b, 0.06).add(nb), a.clone().lerp(b, 0.9).add(nb).add(new THREE.Vector2(0, -0.07)), c.clone().lerp(d, 0.1).add(nd).add(new THREE.Vector2(0, -0.07)), c.clone().lerp(d, 0.94).add(nd)]
  const glass = extrude(g.map((v) => [v.x, v.y]), k.cw + 0.03, false)
  // wheels (an open tire and a rim disc on the outside) and lamps (white front, red back)
  const parts = []
  const paint = (geo, c) => {
    geo.setAttribute("color", new THREE.Float32BufferAttribute(new Array(geo.attributes.position.count).fill(c).flat(), 3))
    if (geo.attributes.uv) geo.deleteAttribute("uv")
    return geo
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      parts.push(paint(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 9, 1, true).rotateZ(Math.PI / 2).translate(sx * k.track, 0.34, sz * k.wheelZ), [0.07, 0.07, 0.08]))
      parts.push(paint(new THREE.CircleGeometry(0.22, 7).rotateY((sx * Math.PI) / 2).translate(sx * (k.track + 0.125), 0.34, sz * k.wheelZ), [0.62, 0.64, 0.67]))
    }
  for (const sx of [-1, 1]) {
    parts.push(paint(new THREE.PlaneGeometry(0.34, 0.12).translate(sx * 0.6, k.lightY, k.front + 0.01), [1.6, 1.6, 1.5]))
    parts.push(paint(new THREE.PlaneGeometry(0.34, 0.12).rotateY(Math.PI).translate(sx * 0.6, k.lightY, k.back - 0.01), [0.9, 0.08, 0.06]))
  }
  const wheel = mergeGeometries(parts.map((x) => (x.index ? x.toNonIndexed() : x)), false)
  parts.forEach((x) => x.dispose())
  return { body, glass, wheel }
}

// a reflective sky for glass and paint (set by setDetailEnv)
let envTex = null
export const setDetailEnv = (t) => (envTex = t)

// cars: [{ x, z, yaw, c (0..1 color pick) }]
export const buildCars = (group, cars, palette, { keep = (x) => x, rand = Math.random } = {}) => {
  const kinds = ["sedan", "suv", "hatch"]
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const v1 = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)
  const cc = new THREE.Color()
  const paint = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.32, envMap: envTex, envMapIntensity: 0.9 }))
  const glass = keep(new THREE.MeshStandardMaterial({ color: 0x141b22, metalness: 0.3, roughness: 0.06, envMap: envTex, envMapIntensity: 1.2 }))
  const tyres = keep(new THREE.MeshLambertMaterial({ vertexColors: true }))
  const byKind = kinds.map(() => [])
  cars.forEach((c) => byKind[Math.floor(rand() * kinds.length)].push(c))
  byKind.forEach((list, k) => {
    if (!list.length) return
    const g = carGeos(kinds[k])
    const meshes = [new THREE.InstancedMesh(keep(g.body), paint, list.length), new THREE.InstancedMesh(keep(g.glass), glass, list.length), new THREE.InstancedMesh(keep(g.wheel), tyres, list.length)]
    // (only the body throws a shadow)
    meshes[1].userData.noCast = meshes[2].userData.noCast = true
    list.forEach((c, i) => {
      m4.compose(v1.set(c.x, 0, c.z), q.setFromEuler(e.set(0, c.yaw, 0)), one)
      for (const m of meshes) m.setMatrixAt(i, m4)
      meshes[0].setColorAt(i, cc.setHex(palette[Math.floor(c.c * palette.length) % palette.length]))
    })
    group.add(...meshes)
  })
}

// ---------------------------------------------------------------- decals

const decalTex = {
  scuff: () =>
    canvasTex(256, 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h)
      const r = rng(51)
      ctx.filter = "blur(2px)"
      for (let i = 0; i < 10; i++) {
        ctx.strokeStyle = `rgba(20,20,22,${0.025 + r() * 0.05})`
        ctx.lineWidth = 6 + r() * 10
        ctx.beginPath()
        const y = h * (0.25 + r() * 0.5)
        ctx.moveTo(w * r() * 0.3, y)
        ctx.quadraticCurveTo(w * 0.5, y + (r() - 0.5) * 30, w * (0.7 + r() * 0.3), y + (r() - 0.5) * 20)
        ctx.stroke()
      }
    }),
  ball: () =>
    canvasTex(64, 64, (ctx, w) => {
      ctx.clearRect(0, 0, w, w)
      const g = ctx.createRadialGradient(w / 2, w / 2, 2, w / 2, w / 2, w / 2)
      g.addColorStop(0, "rgba(30,34,30,0.16)")
      g.addColorStop(0.5, "rgba(30,34,30,0.07)")
      g.addColorStop(1, "rgba(30,34,30,0)")
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, w)
    }),
  oil: () =>
    canvasTex(128, 128, (ctx, w) => {
      ctx.clearRect(0, 0, w, w)
      const r = rng(61)
      for (let i = 0; i < 9; i++) {
        const x = w / 2 + (r() - 0.5) * w * 0.45
        const y = w / 2 + (r() - 0.5) * w * 0.45
        const rad = w * (0.08 + r() * 0.2)
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
        g.addColorStop(0, "rgba(8,8,10,0.45)")
        g.addColorStop(1, "rgba(8,8,10,0)")
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, w)
      }
    }),
  crack: () =>
    canvasTex(256, 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h)
      const r = rng(71)
      let x = 4
      let y = h / 2
      ctx.lineCap = "round"
      while (x < w - 4) {
        const nx = x + 6 + r() * 14
        const ny = Math.max(6, Math.min(h - 6, y + (r() - 0.5) * 14))
        ctx.strokeStyle = "rgba(60,90,40,0.5)"
        ctx.lineWidth = 6
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(nx, ny)
        ctx.stroke()
        ctx.strokeStyle = "rgba(10,10,10,0.75)"
        ctx.lineWidth = 2
        ctx.stroke()
        if (r() < 0.25) {
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.moveTo(nx, ny)
          ctx.lineTo(nx + 10 * r(), ny + (r() - 0.5) * 22)
          ctx.stroke()
        }
        x = nx
        y = ny
      }
    }),
  leaves: () =>
    canvasTex(128, 128, (ctx, w) => {
      ctx.clearRect(0, 0, w, w)
      const r = rng(81)
      for (let i = 0; i < 26; i++) {
        ctx.save()
        ctx.translate(w * (0.1 + r() * 0.8), w * (0.1 + r() * 0.8))
        ctx.rotate(r() * 6.28)
        ctx.fillStyle = `hsla(${25 + r() * 25},${45 + r() * 25}%,${30 + r() * 22}%,0.9)`
        ctx.beginPath()
        ctx.ellipse(0, 0, 5 + r() * 3, 2.5 + r() * 1.5, 0, 0, 6.28)
        ctx.fill()
        ctx.restore()
      }
    }),
  under: () =>
    canvasTex(128, 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h)
      const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2)
      g.addColorStop(0, "rgba(0,0,0,0.55)")
      g.addColorStop(0.55, "rgba(0,0,0,0.35)")
      g.addColorStop(1, "rgba(0,0,0,0)")
      ctx.save()
      ctx.scale(1, h / w)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, w)
      ctx.restore()
    }),
}

// decals: { kind: [{ x, z, y, w, l, yaw }] } drawn as instanced flat quads over the ground
export const buildDecals = (group, decals, { keep = (x) => x } = {}) => {
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  const quad = keep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2))
  let n = 0
  for (const [kind, list] of Object.entries(decals)) {
    if (!list.length || !decalTex[kind]) continue
    const t = keep(decalTex[kind]())
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
    const mat = keep(new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }))
    const mesh = new THREE.InstancedMesh(quad, mat, list.length)
    list.forEach((d, i) => mesh.setMatrixAt(i, m4.compose(v1.set(d.x, d.y ?? 0.02, d.z), q.setFromEuler(e.set(0, d.yaw || 0, 0)), v2.set(d.w, 1, d.l))))
    mesh.renderOrder = 2
    group.add(mesh)
    n += list.length
  }
  return n
}

// where the decals go: wear on every pickleball court (kitchen lines, behind the baselines),
// ball marks, oil in parking stalls, cracks in lots, leaves under broad-leaf trees
export const planDecals = ({ courts = [], stalls = [], lots = [], trees = [], half = { w: 3.05, l: 6.71, kitchen: 2.13 }, rand = Math.random, inPoly = () => true } = {}) => {
  const out = { scuff: [], ball: [], oil: [], crack: [], leaves: [] }
  const world = (c, lx, lz) => ({ x: c.x + lx * Math.cos(c.rot) + lz * Math.sin(c.rot), z: c.z - lx * Math.sin(c.rot) + lz * Math.cos(c.rot) })
  for (const c of courts) {
    if (c.s === "b") continue
    const tennis = c.s === "t"
    const hl = tennis ? (c.L || 23.77) / 2 : half.l
    const hw = tennis ? (c.W || 10.97) / 2 : half.w
    for (const side of [-1, 1]) {
      if (!tennis)
        for (let i = 0; i < 4; i++) {
          const p = world(c, (rand() - 0.5) * hw * 1.6, side * (half.kitchen + 0.3 + rand() * 0.9))
          out.scuff.push({ ...p, y: 0.013, w: 1.0 + rand() * 0.9, l: 0.3 + rand() * 0.2, yaw: c.rot + (rand() - 0.5) * 0.8 + Math.PI / 2 })
        }
      for (let i = 0; i < 3; i++) {
        const p = world(c, (rand() - 0.5) * hw * 1.4, side * (hl + 0.5 + rand() * 1.2))
        out.scuff.push({ ...p, y: 0.013, w: 1.3 + rand() * 1.0, l: 0.35 + rand() * 0.25, yaw: c.rot + (rand() - 0.5) * 0.6 })
      }
    }
    for (let i = 0; i < (tennis ? 6 : 10); i++) {
      const p = world(c, (rand() - 0.5) * hw * 2, (rand() - 0.5) * hl * 2)
      const s = 0.12 + rand() * 0.1
      out.ball.push({ ...p, y: 0.013, w: s, l: s })
    }
  }
  for (const s of stalls) {
    if (rand() > 0.35) continue
    const sz = 0.7 + rand() * 0.7
    out.oil.push({ x: s.x, z: s.z, y: 0.006, w: sz, l: sz * (0.8 + rand() * 0.4), yaw: rand() * 6.28 })
  }
  for (const p of lots) {
    let x0 = Infinity
    let x1 = -Infinity
    let z0 = Infinity
    let z1 = -Infinity
    for (const [x, z] of p) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (z0 = Math.min(z0, z)), (z1 = Math.max(z1, z))
    const n = Math.min(14, Math.round(((x1 - x0) * (z1 - z0)) / 250))
    for (let i = 0; i < n; i++) {
      const x = x0 + rand() * (x1 - x0)
      const z = z0 + rand() * (z1 - z0)
      if (!inPoly(x, z, p)) continue
      out.crack.push({ x, z, y: 0.006, w: 2 + rand() * 3, l: 0.35 + rand() * 0.2, yaw: rand() * 6.28 })
    }
  }
  for (const t of trees) {
    for (let i = 0; i < 2; i++) {
      const a = rand() * 6.28
      const d = rand() * 2.4 * (t.s || 1)
      const s = 0.8 + rand() * 0.9
      out.leaves.push({ x: t.x + Math.cos(a) * d, z: t.z + Math.sin(a) * d, y: 0.01, w: s, l: s, yaw: rand() * 6.28 })
    }
  }
  return out
}

// ---------------------------------------------------------------- walls with real windows

// kind: "windows" (two per 3 m tile), "mission" (one tall arched one); { map, normalMap, specularMap }
const wallCache = new Map()
export const windowMaps = (kind) => {
  if (wallCache.has(kind)) return wallCache.get(kind)
  if (!hasDoc()) return null
  const N = 256
  const s = N / 64 // the old 64 px layout, scaled
  const panes = kind === "mission" ? [[24, 12, 16, 30, true]] : [[10, 16, 18, 24, false], [38, 16, 18, 24, false]]
  const color = document.createElement("canvas")
  const height = document.createElement("canvas")
  const spec = document.createElement("canvas")
  for (const c of [color, height, spec]) (c.width = N), (c.height = N)
  const cx = color.getContext("2d")
  const hx = height.getContext("2d")
  const sx = spec.getContext("2d")
  cx.fillStyle = "#ffffff"
  cx.fillRect(0, 0, N, N)
  hx.fillStyle = "#808080"
  hx.fillRect(0, 0, N, N)
  sx.fillStyle = "#000000"
  sx.fillRect(0, 0, N, N)
  // a floor line at the foot of every tile (a slab edge)
  cx.fillStyle = "rgba(0,0,0,0.07)"
  cx.fillRect(0, N - 5 * s, N, 3 * s)
  hx.fillStyle = "#909090"
  hx.fillRect(0, N - 5 * s, N, 2 * s)
  const pathPane = (ctx, x, y, w, h, arch, inset = 0) => {
    ctx.beginPath()
    if (arch) {
      const r = (w - 2 * inset) / 2
      ctx.moveTo(x + inset, y + h - inset)
      ctx.lineTo(x + inset, y + r + inset)
      ctx.arc(x + w / 2, y + r + inset, r, Math.PI, 0)
      ctx.lineTo(x + w - inset, y + h - inset)
      ctx.closePath()
    } else ctx.rect(x + inset, y + inset, w - 2 * inset, h - 2 * inset)
  }
  for (const [px, py, pw, ph, arch] of panes) {
    const [x, y, w, h] = [px * s, py * s, pw * s, ph * s]
    // lintel shadow above, sill below (light on top, a shadow under it)
    cx.fillStyle = "rgba(0,0,0,0.1)"
    cx.fillRect(x - 2 * s, y - 2.5 * s, w + 4 * s, 2 * s)
    cx.fillStyle = "#f4f2ee"
    cx.fillRect(x - 2.5 * s, y + h, w + 5 * s, 2.2 * s)
    cx.fillStyle = "rgba(0,0,0,0.16)"
    cx.fillRect(x - 2 * s, y + h + 2.2 * s, w + 4 * s, 2.6 * s)
    hx.fillStyle = "#d0d0d0"
    hx.fillRect(x - 2.5 * s, y + h, w + 5 * s, 2.2 * s)
    // the frame (dark), the glass (a sky reflection, darker low), the mullions
    cx.fillStyle = "#2f363b"
    pathPane(cx, x, y, w, h, arch)
    cx.fill()
    const g = cx.createLinearGradient(0, y, 0, y + h)
    g.addColorStop(0, "#9fb6c4")
    g.addColorStop(0.45, "#5f7787")
    g.addColorStop(1, "#2c3a44")
    cx.fillStyle = g
    pathPane(cx, x, y, w, h, arch, 1.6 * s)
    cx.fill()
    cx.fillStyle = "rgba(255,255,255,0.14)"
    cx.beginPath()
    cx.moveTo(x + w * 0.2, y + h)
    cx.lineTo(x + w * 0.65, y)
    cx.lineTo(x + w * 0.85, y)
    cx.lineTo(x + w * 0.4, y + h)
    cx.fill()
    cx.fillStyle = "#2f363b"
    cx.fillRect(x + w / 2 - 0.6 * s, y + 1.6 * s, 1.2 * s, h - 3.2 * s)
    cx.fillRect(x + 1.6 * s, y + h * (arch ? 0.55 : 0.5) - 0.6 * s, w - 3.2 * s, 1.2 * s)
    // height: the frame proud, the glass recessed; the reflection mask on the glass only
    hx.fillStyle = "#b0b0b0"
    pathPane(hx, x, y, w, h, arch)
    hx.fill()
    hx.fillStyle = "#303030"
    pathPane(hx, x, y, w, h, arch, 1.6 * s)
    hx.fill()
    hx.fillStyle = "#909090"
    hx.fillRect(x + w / 2 - 0.6 * s, y + 1.6 * s, 1.2 * s, h - 3.2 * s)
    sx.fillStyle = "#b8b8b8"
    pathPane(sx, x, y, w, h, arch, 1.6 * s)
    sx.fill()
    sx.fillStyle = "#000000"
    sx.fillRect(x + w / 2 - 0.6 * s, y + 1.6 * s, 1.2 * s, h - 3.2 * s)
  }
  const map = new THREE.CanvasTexture(color)
  map.colorSpace = THREE.SRGBColorSpace
  const specularMap = new THREE.CanvasTexture(spec)
  const normalMap = normalFromHeight(height, 3)
  for (const t of [map, specularMap]) (t.wrapS = t.wrapT = THREE.RepeatWrapping), (t.anisotropy = 4)
  const out = { map, normalMap, specularMap }
  wallCache.set(kind, out)
  return out
}

// a normal map for an indoor surface picture (quilt, cinder block, panels, tiles): from its
// own canvas (darker = deeper)
const normalCache = new Map()
export const normalFor = (tex, strength = 2.5) => {
  const src = tex?.image
  if (!hasDoc() || !src || !src.getContext) return null
  const key = `${tex.uuid}|${strength}`
  if (!normalCache.has(key)) {
    const n = normalFromHeight(src, strength)
    n.repeat.copy(tex.repeat)
    n.offset.copy(tex.offset)
    normalCache.set(key, n)
  }
  return normalCache.get(key)
}

// ---------------------------------------------------------------- the sky to reflect

// an equirectangular sky (top half) and ground (bottom half): outdoors a clear SoCal sky with
// the sun's glow; indoors a bright ceiling with light rows over a warm floor
export const skyEnvironment = ({ indoor = false, ground = "#9a958a", sunAz = 0.6 } = {}) => {
  const t = canvasTex(
    512,
    256,
    (ctx, w, h) => {
      if (indoor) {
        const g = ctx.createLinearGradient(0, 0, 0, h)
        g.addColorStop(0, "#f2f0ea")
        g.addColorStop(0.45, "#cfccc4")
        g.addColorStop(0.5, "#8d8a84")
        g.addColorStop(1, ground)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = "rgba(255,255,248,0.9)"
        for (let y = 10; y < h * 0.35; y += 18) for (let x = 0; x < w; x += 40) ctx.fillRect(x, y, 26, 5)
      } else {
        const g = ctx.createLinearGradient(0, 0, 0, h)
        g.addColorStop(0, "#3f78c4")
        g.addColorStop(0.38, "#8fb9e3")
        g.addColorStop(0.5, "#d9e6ee")
        g.addColorStop(0.52, "#8f9a88")
        g.addColorStop(1, ground)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
        // the sun's glow, some soft clouds
        const sx = ((sunAz / (Math.PI * 2)) % 1) * w
        const sg = ctx.createRadialGradient(sx, h * 0.18, 2, sx, h * 0.18, h * 0.35)
        sg.addColorStop(0, "rgba(255,252,240,1)")
        sg.addColorStop(0.15, "rgba(255,246,220,0.6)")
        sg.addColorStop(1, "rgba(255,246,220,0)")
        ctx.fillStyle = sg
        ctx.fillRect(0, 0, w, h * 0.5)
        const r = rng(91)
        for (let i = 0; i < 18; i++) {
          const x = r() * w
          const y = h * (0.22 + r() * 0.22)
          const cg = ctx.createRadialGradient(x, y, 1, x, y, 30 + r() * 40)
          cg.addColorStop(0, "rgba(255,255,255,0.5)")
          cg.addColorStop(1, "rgba(255,255,255,0)")
          ctx.fillStyle = cg
          ctx.fillRect(0, 0, w, h * 0.5)
        }
        // a dark band of trees and buildings on the horizon
        ctx.fillStyle = "rgba(60,72,58,0.55)"
        for (let x = 0; x < w; x += 6) ctx.fillRect(x, h * 0.5 - 3 - r() * 9, 6, 14)
      }
    },
    { repeat: false }
  )
  t.mapping = THREE.EquirectangularReflectionMapping
  return t
}

// ---------------------------------------------------------------- lights' glow

// a soft halo round every light (one draw): positions [{ x, y, z }]
export const buildGlow = (group, lights, { keep = (x) => x, size = 2.2, color = 0xfff4dc } = {}) => {
  if (!lights.length) return null
  const tex = keep(
    canvasTex(
      64,
      64,
      (ctx, w) => {
        const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
        g.addColorStop(0, "rgba(255,250,235,0.85)")
        g.addColorStop(0.25, "rgba(255,244,215,0.35)")
        g.addColorStop(1, "rgba(255,244,215,0)")
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, w)
      },
      { repeat: false }
    )
  )
  const geo = keep(new THREE.BufferGeometry())
  geo.setAttribute("position", new THREE.Float32BufferAttribute(lights.flatMap((l) => [l.x, l.y - 0.15, l.z]), 3))
  const pts = new THREE.Points(geo, keep(new THREE.PointsMaterial({ map: tex, size, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })))
  pts.renderOrder = 3
  group.add(pts)
  return pts
}

// ---------------------------------------------------------------- parking lots (round 3)

// crisp painted stall lines (each a little worn, some more than others), concrete wheel stops
// at the back of each stall, and curbs round the lot: three instanced draws.
//   stripes [[x0, z0, x1, z1]], stops [[x, z, yaw]], edges [[[x, z], [x, z]]]
export const buildLotDetail = (group, { stripes = [], stops = [], edges = [] }, { keep = (x) => x, rand = Math.random } = {}) => {
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const c = new THREE.Color()
  const out = []
  if (stripes.length) {
    const paint = keep(new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }))
    const geo = keep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2))
    const inst = new THREE.InstancedMesh(geo, paint, stripes.length)
    stripes.forEach(([x0, z0, x1, z1], i) => {
      const len = Math.hypot(x1 - x0, z1 - z0)
      q.setFromAxisAngle(up, Math.atan2(-(z1 - z0), x1 - x0))
      inst.setMatrixAt(i, m4.compose(p.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2), q, s.set(len, 1, 0.11)))
      // worn paint: most lines a soft white, a few faded toward the asphalt
      inst.setColorAt(i, c.setScalar(0.62 + rand() * 0.28 - (rand() < 0.15 ? 0.2 : 0)))
    })
    inst.userData.noCast = true
    group.add(inst)
    out.push(inst)
  }
  const concrete = keep(new THREE.MeshLambertMaterial({ color: 0xbdb8ae }))
  concrete.userData.surface = "concrete"
  if (stops.length) {
    const geo = keep(new THREE.BoxGeometry(1.75, 0.12, 0.2).translate(0, 0.06, 0))
    const inst = new THREE.InstancedMesh(geo, concrete, stops.length)
    stops.forEach(([x, z, yaw], i) => inst.setMatrixAt(i, m4.compose(p.set(x, 0, z), q.setFromAxisAngle(up, yaw), s.set(1, 1, 1))))
    group.add(inst)
    out.push(inst)
  }
  const curbs = edges.filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.8)
  if (curbs.length) {
    const geo = keep(new THREE.BoxGeometry(1, 0.15, 0.18).translate(0, 0.075, 0))
    const inst = new THREE.InstancedMesh(geo, concrete, curbs.length)
    curbs.forEach(([a, b], i) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      inst.setMatrixAt(i, m4.compose(p.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2), q.setFromAxisAngle(up, Math.atan2(-(b[1] - a[1]), b[0] - a[0])), s.set(len, 1, 1)))
    })
    group.add(inst)
    out.push(inst)
  }
  return out
}

// ---------------------------------------------------------------- weeds (round 3)

// little tufts of grass and weeds where a slab meets a fence or a curb: crossed alpha-cut
// cards, instanced, a few greens and straw tones. tufts [{ x, z, s (size), r (yaw) }]
export const buildTufts = (group, tufts, { keep = (x) => x } = {}) => {
  if (!tufts.length) return null
  const tex = keep(
    canvasTex(
      64,
      48,
      (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h)
        const r = rng(77)
        for (let i = 0; i < 26; i++) {
          const x = w * (0.15 + r() * 0.7)
          const top = h * (0.05 + r() * 0.55)
          const lean = (r() - 0.5) * w * 0.35
          const g = Math.round(110 + r() * 80)
          ctx.strokeStyle = `rgb(${Math.round(g * 0.62)},${g},${Math.round(g * 0.42)})`
          ctx.lineWidth = 1.5 + r() * 1.5
          ctx.beginPath()
          ctx.moveTo(x, h)
          ctx.quadraticCurveTo(x + lean * 0.3, (h + top) / 2, x + lean, top)
          ctx.stroke()
        }
      },
      { repeat: false }
    )
  )
  const card = new THREE.PlaneGeometry(0.42, 0.28).translate(0, 0.14, 0)
  const geo = keep(mergeGeometries([card.clone(), card.clone().rotateY(Math.PI / 2)]))
  const mat = keep(new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }))
  const inst = new THREE.InstancedMesh(geo, mat, tufts.length)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const c = new THREE.Color()
  const tones = [0x8fae5e, 0x7c9a4e, 0xa8b46a, 0xc2b47c, 0x6f8f45]
  tufts.forEach((t, i) => {
    inst.setMatrixAt(i, m4.compose(p.set(t.x, 0, t.z), q.setFromAxisAngle(up, t.r), s.setScalar(t.s)))
    inst.setColorAt(i, c.setHex(tones[i % tones.length]))
  })
  inst.userData.noCast = true
  inst.userData.noAO = true
  group.add(inst)
  return inst
}

// ---------------------------------------------------------------- windscreens

// a woven windscreen (u in meters, v the screen's height): a fine weave, hems top and bottom
// with grommets, a seam at the end of each 1 m tile
export const windscreenTex = () => {
  const t = canvasTex(256, 128, (ctx, w, h) => {
    const r = rng(101)
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, w, h)
    for (let y = 0; y < h; y += 2)
      for (let x = 0; x < w; x += 2) {
        const k = ((x + y) / 2) % 2 ? 0.9 : 1
        const v = Math.round(235 * k + r() * 14)
        ctx.fillStyle = `rgb(${v},${v},${v})`
        ctx.fillRect(x, y, 2, 2)
      }
    ctx.fillStyle = "rgba(0,0,0,0.28)"
    ctx.fillRect(0, 0, w, 10)
    ctx.fillRect(0, h - 10, w, 10)
    for (const cxp of [w * 0.25, w * 0.75])
      for (const cyp of [5, h - 5]) {
        ctx.fillStyle = "#d8d8d8"
        ctx.beginPath()
        ctx.arc(cxp, cyp, 3.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = "#222"
        ctx.beginPath()
        ctx.arc(cxp, cyp, 1.8, 0, Math.PI * 2)
        ctx.fill()
      }
    ctx.fillStyle = "rgba(0,0,0,0.12)"
    ctx.fillRect(w - 3, 0, 3, h)
  })
  t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

// ---------------------------------------------------------------- chain-link

// a woven wire diamond with a highlight (alpha), and the depth material that lets it throw a
// cut-out shadow
export const chainLink = (fc = null) => {
  const t = canvasTex(
    128,
    128,
    (ctx, w) => {
      ctx.clearRect(0, 0, w, w)
      const col = fc === null ? [62, 72, 70] : [(fc >> 16) & 255, (fc >> 8) & 255, fc & 255]
      const wire = (off, style, lw) => {
        ctx.strokeStyle = style
        ctx.lineWidth = lw
        ctx.beginPath()
        ctx.moveTo(0, w / 2 + off)
        ctx.lineTo(w / 2, 0 + off)
        ctx.lineTo(w, w / 2 + off)
        ctx.lineTo(w / 2, w + off)
        ctx.closePath()
        ctx.stroke()
      }
      wire(0, `rgba(${col[0]},${col[1]},${col[2]},0.95)`, 5)
      wire(-1, `rgba(${Math.min(255, col[0] + 70)},${Math.min(255, col[1] + 70)},${Math.min(255, col[2] + 70)},0.6)`, 1.5)
    },
    { srgb: true }
  )
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t, alphaTest: 0.4, side: THREE.DoubleSide })
  return { tex: t, depth }
}
