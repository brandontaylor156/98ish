// Roam life: an interior's layout (layouts.js) -> a few merged meshes (three.js). Cheap on a
// phone: everything opaque is ONE mesh with vertex colours (the light baked in: corners and the
// foot of every wall and box darker, as ambient occlusion would make them), everything that glows
// (screens, windows, light panels, the coffee machine's light) one unlit mesh, glass one see-through
// mesh, and the signs one mesh on one canvas: 3-4 draw calls a room, no shadows, no textures but
// the signs' canvas.

import * as THREE from "three"

const col = new THREE.Color()
const makeBuf = () => ({ p: [], n: [], c: [] })
// a quad a b c d (counter-clockwise seen from the front), normal n, colours per corner
const quad = (B, a, b, c, d, n, ca, cb = ca, cc = cb, cd = cc) => {
  for (const [v, k] of [[a, ca], [b, cb], [c, cc], [a, ca], [c, cc], [d, cd]]) {
    B.p.push(v[0], v[1], v[2])
    B.n.push(n[0], n[1], n[2])
    B.c.push(k[0], k[1], k[2])
  }
}
const rgb = (hex, k = 1) => {
  col.set(hex)
  return [col.r * k, col.g * k, col.b * k]
}
// a box: x, z its middle, y0 its foot; the light baked in (the foot and the underside darker)
const box = (B, x, y0, z, w, h, d, hex, { ao = true, yaw = 0 } = {}) => {
  const top = rgb(hex, 1.0)
  const side = rgb(hex, 0.92)
  const low = rgb(hex, ao && y0 < 0.05 ? 0.62 : 0.85)
  const under = rgb(hex, 0.55)
  const cs = Math.cos(yaw)
  const sn = Math.sin(yaw)
  const P = (dx, dy, dz) => [x + dx * cs + dz * sn, y0 + dy, z - dx * sn + dz * cs]
  const N = (nx, ny, nz) => [nx * cs + nz * sn, ny, -nx * sn + nz * cs]
  const hw = w / 2
  const hd = d / 2
  quad(B, P(-hw, h, hd), P(hw, h, hd), P(hw, h, -hd), P(-hw, h, -hd), N(0, 1, 0), top)
  quad(B, P(-hw, 0, -hd), P(hw, 0, -hd), P(hw, 0, hd), P(-hw, 0, hd), N(0, -1, 0), under)
  quad(B, P(-hw, 0, hd), P(hw, 0, hd), P(hw, h, hd), P(-hw, h, hd), N(0, 0, 1), low, low, side, side)
  quad(B, P(hw, 0, -hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(hw, h, -hd), N(0, 0, -1), low, low, side, side)
  quad(B, P(hw, 0, hd), P(hw, 0, -hd), P(hw, h, -hd), P(hw, h, hd), N(1, 0, 0), low, low, side, side)
  quad(B, P(-hw, 0, -hd), P(-hw, 0, hd), P(-hw, h, hd), P(-hw, h, -hd), N(-1, 0, 0), low, low, side, side)
}
// a wall from a to b: a slab 0.14 m thick, darker toward the floor and the corners
const wallSlab = (B, a, b, y0, h, hex, t = 0.14) => {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const L = Math.hypot(dx, dz)
  if (L < 0.01) return
  box(B, (a.x + b.x) / 2, y0, (a.z + b.z) / 2, L + t, h, t, hex, { yaw: Math.atan2(dz, dx) * -1 })
}
const toMesh = (B, material) => {
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(B.p, 3))
  g.setAttribute("normal", new THREE.Float32BufferAttribute(B.n, 3))
  g.setAttribute("color", new THREE.Float32BufferAttribute(B.c, 3))
  g.computeBoundingSphere()
  return new THREE.Mesh(g, material)
}

// the signs, drawn onto one canvas (a strip each) -> a mesh of planes
const signMesh = (signs) => {
  if (!signs.length || typeof document === "undefined") return null
  const rowH = 96
  const cv = document.createElement("canvas")
  cv.width = 1024
  cv.height = Math.min(2048, THREE.MathUtils.ceilPowerOfTwo(rowH * signs.length))
  const g = cv.getContext("2d")
  const rows = Math.floor(cv.height / rowH)
  const pos = []
  const uv = []
  signs.slice(0, rows).forEach((s, i) => {
    const y = i * rowH
    const aspect = s.w / s.h
    const pw = Math.min(1024, Math.round(rowH * aspect))
    g.fillStyle = s.bg || "#23395d"
    g.fillRect(0, y, pw, rowH)
    g.fillStyle = s.fg || "#ffffff"
    g.textAlign = "center"
    g.textBaseline = "middle"
    let size = 62
    g.font = `700 ${size}px system-ui, sans-serif`
    while (size > 18 && g.measureText(s.text).width > pw - 24) {
      size -= 4
      g.font = `700 ${size}px system-ui, sans-serif`
    }
    g.fillText(s.text, pw / 2, y + rowH / 2 + 2)
    // the plane, facing yaw (its normal is (sin yaw, cos yaw)); a hair in front of its wall
    const nx = Math.sin(s.yaw)
    const nz = Math.cos(s.yaw)
    const rx = Math.cos(s.yaw)
    const rz = -Math.sin(s.yaw)
    const cx = s.x + nx * 0.02
    const cz = s.z + nz * 0.02
    const hw = s.w / 2
    const hh = s.h / 2
    const P = (u, v) => [cx + rx * u, s.y + v, cz + rz * u]
    const u0 = 0
    const u1 = pw / 1024
    const v0 = 1 - (y + rowH) / cv.height
    const v1 = 1 - y / cv.height
    const corners = [[P(-hw, -hh), [u0, v0]], [P(hw, -hh), [u1, v0]], [P(hw, hh), [u1, v1]], [P(-hw, hh), [u0, v1]]]
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(...corners[k][0])
      uv.push(...corners[k][1])
    }
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }))
}

// layout -> { group, segs: [[a, b]] (walls and solid boxes, for the colliders), dispose }
export const buildInterior = (L, { origin = { x: 0, z: 0 } } = {}) => {
  const solid = makeBuf()
  const glow = makeBuf()
  const glass = makeBuf()
  const segs = []
  // the floor: tiles in two shades, darker toward the walls (baked)
  const T = L.kind === "office" ? 1 : 2
  for (let x = -L.W / 2; x < L.W / 2 - 1e-6; x += T)
    for (let z = -L.D / 2; z < L.D / 2 - 1e-6; z += T) {
      const alt = (Math.round(x / T) + Math.round(z / T)) % 2 ? L.floorAlt || L.floor : L.floor
      const edge = (px, pz) => Math.min(1, Math.min(L.W / 2 - Math.abs(px), L.D / 2 - Math.abs(pz)) / 1.4)
      const k = (px, pz) => rgb(alt, 0.78 + 0.22 * edge(px, pz))
      const x1 = Math.min(L.W / 2, x + T)
      const z1 = Math.min(L.D / 2, z + T)
      quad(solid, [x, 0, z1], [x1, 0, z1], [x1, 0, z], [x, 0, z], [0, 1, 0], k(x, z1), k(x1, z1), k(x1, z), k(x, z))
    }
  // the ceiling
  quad(solid, [-L.W / 2, L.H, -L.D / 2], [L.W / 2, L.H, -L.D / 2], [L.W / 2, L.H, L.D / 2], [-L.W / 2, L.H, L.D / 2], [0, -1, 0], rgb(L.ceiling || "#ffffff", 0.9))
  for (const lt of L.lights || []) quad(glow, [lt.x - lt.w / 2, L.H - 0.02, lt.z - lt.d / 2], [lt.x + lt.w / 2, L.H - 0.02, lt.z - lt.d / 2], [lt.x + lt.w / 2, L.H - 0.02, lt.z + lt.d / 2], [lt.x - lt.w / 2, L.H - 0.02, lt.z + lt.d / 2], [0, -1, 0], rgb("#fffaf0"))
  // the walls (glass ones see-through with a frame), windows on the outer walls
  for (const w of L.walls) {
    segs.push([w.a, w.b])
    if (w.glass) {
      wallSlab(glass, w.a, w.b, 0.1, w.h - 0.2, w.color, 0.04)
      wallSlab(solid, w.a, w.b, 0, 0.1, "#5a5f66", 0.06)
      wallSlab(solid, w.a, w.b, w.h - 0.1, 0.1, "#5a5f66", 0.06)
      continue
    }
    wallSlab(solid, w.a, w.b, 0, w.h, w.color)
    if (w.windows) {
      const dx = w.b.x - w.a.x
      const dz = w.b.z - w.a.z
      const L2 = Math.hypot(dx, dz)
      const ux = dx / L2
      const uz = dz / L2
      // (the inner face: toward the room's middle)
      let nx = -uz
      let nz = ux
      const mx = (w.a.x + w.b.x) / 2
      const mz = (w.a.z + w.b.z) / 2
      if (mx * nx + mz * nz > 0) {
        nx = -nx
        nz = -nz
      }
      for (let s = 1.6; s < L2 - 1.2; s += 3) {
        const cx = w.a.x + ux * s + nx * 0.08
        const cz = w.a.z + uz * s + nz * 0.08
        const hw = 0.7
        const a = [cx - ux * hw, 0.95, cz - uz * hw]
        const b = [cx + ux * hw, 0.95, cz + uz * hw]
        const top = Math.min(w.h - 0.35, 2.45)
        const sky = rgb("#bfe2f7")
        const lowc = rgb("#e4f2fa")
        quad(glow, nx * uz - nz * ux > 0 ? b : a, nx * uz - nz * ux > 0 ? a : b, [(nx * uz - nz * ux > 0 ? a : b)[0], top, (nx * uz - nz * ux > 0 ? a : b)[2]], [(nx * uz - nz * ux > 0 ? b : a)[0], top, (nx * uz - nz * ux > 0 ? b : a)[2]], [nx, 0, nz], lowc, lowc, sky, sky)
      }
    }
  }
  // the furniture
  for (const b of L.boxes) {
    if (b.round) {
      box(solid, b.x, b.y || 0, b.z, b.w, b.h, b.d * 0.7, b.color, { ao: false })
      box(solid, b.x, (b.y || 0) + b.h * 0.15, b.z, b.w * 0.7, b.h * 0.7, b.d, b.color, { ao: false, yaw: 0.6 })
    } else if (b.glow) box(glow, b.x, b.y || 0, b.z, b.w, b.h, b.d, b.glow, { ao: false })
    else box(solid, b.x, b.y || 0, b.z, b.w, b.h, b.d, b.color)
    if (b.solid) {
      const x0 = b.x - b.w / 2
      const x1 = b.x + b.w / 2
      const z0 = b.z - b.d / 2
      const z1 = b.z + b.d / 2
      segs.push([{ x: x0, z: z0 }, { x: x1, z: z0 }], [{ x: x1, z: z0 }, { x: x1, z: z1 }], [{ x: x1, z: z1 }, { x: x0, z: z1 }], [{ x: x0, z: z1 }, { x: x0, z: z0 }])
    }
  }
  const group = new THREE.Group()
  const mats = []
  const mSolid = new THREE.MeshLambertMaterial({ vertexColors: true })
  const mGlow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide })
  const mGlass = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide })
  mats.push(mSolid, mGlow, mGlass)
  group.add(toMesh(solid, mSolid))
  if (glow.p.length) group.add(toMesh(glow, mGlow))
  if (glass.p.length) group.add(toMesh(glass, mGlass))
  const signs = signMesh(L.signs || [])
  if (signs) {
    group.add(signs)
    mats.push(signs.material)
  }
  group.position.set(origin.x, 0, origin.z)
  group.updateMatrixWorld(true)
  return {
    group,
    // (the colliders work in the town's frame: the room's slot origin added)
    segs: segs.map(([a, b]) => [{ x: a.x + origin.x, z: a.z + origin.z }, { x: b.x + origin.x, z: b.z + origin.z }]),
    draws: group.children.length,
    dispose() {
      group.removeFromParent()
      for (const m of group.children) m.geometry.dispose()
      for (const m of mats) {
        m.map?.dispose()
        m.dispose()
      }
    },
  }
}
