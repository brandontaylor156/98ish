// My Park: a real venue's scenery (three.js), from venuegen.js's scene data: the ground (grass,
// parking, paths, pools painted into one texture), every court (live ones get their own
// group for the matches), the low fences and nets, buildings (walls with windows, flat roofs),
// an indoor hall (floor, padded walls, ceiling, light rows, a door) with its bar, trees (broad
// leaf, palm, conifer), cars in the lots, street lamps, and a backdrop (hills, palms, a
// skyline, mountains). Everything static: build.js merges it.

import * as THREE from "three"
import { addProps, propMaterials } from "./props.js"
import { FINISH, roomRect } from "./propkit.js"
import { surfaced } from "./surfaces.js"
import { buildCars, buildDecals, buildGlow, buildTrees, canvasTex, normalFor, windscreenTex, planDecals, setDetailEnv, skyEnvironment, windowMaps } from "./detail.js"
import { dimEnvironment, loadHDRI, swapEnvironment } from "./environment.js"

const canvasTexture = (w, h, draw) => {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  draw(c.getContext("2d"), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
const yawFor = (ax, az) => Math.atan2(-az, ax)
const seeded = (seed) => {
  let s = seed >>> 0 || 1
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}
const signedArea = (p) => {
  let A = 0
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    A += a[0] * b[1] - b[0] * a[1]
  }
  return A / 2
}
const pointInPoly = (x, z, poly) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
// A parking lot's stalls, as lots are laid out: along the lot's longest side, bays of two
// stall rows back to back (5.4 m deep, 2.7 m wide) then a 7 m driving aisle. Returns the
// stalls { x, z, yaw (a car's long side across the row) } and the stripes between them.
// a room's floor finish (propkit FINISH) -> its surface texture (surfaces.js)
const FLOOR_SURFACE = { wood: "wood", tile: "tile", rubber: "rubber", carpet: "carpet", stone: "concrete", slats: "deck" }
const STALL_W = 2.7
const STALL_D = 5.4
const AISLE = 7
export const lotStalls = (p) => {
  let best = null
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L > 0.1 && (!best || L > best.L)) best = { L, ux: (b[0] - a[0]) / L, uz: (b[1] - a[1]) / L }
  }
  if (!best) return { stalls: [], stripes: [] }
  const { ux, uz } = best
  const us = p.map(([x, z]) => x * ux + z * uz)
  const ws = p.map(([x, z]) => -x * uz + z * ux)
  const [u0, u1, w0, w1] = [Math.min(...us), Math.max(...us), Math.min(...ws), Math.max(...ws)]
  const at = (u, w) => [u * ux - w * uz, u * uz + w * ux]
  const yaw = Math.atan2(-uz, ux)
  const inside = (u, w) => pointInPoly(...at(u, w), p)
  const stalls = []
  const stripes = []
  // the first row backs onto the edge and faces an aisle; then pairs back to back: row,
  // aisle, row, row, aisle, row, row, aisle...
  for (let w = w0 + 0.3, k = 0; w + STALL_D <= w1 + 0.01; k++) {
    for (let u = u0 + 0.6; u + STALL_W <= u1 - 0.3; u += STALL_W) {
      const cu = u + STALL_W / 2
      const cw = w + STALL_D / 2
      // the whole stall inside the lot (its four corners)
      if (!inside(u + 0.2, w + 0.2) || !inside(u + STALL_W - 0.2, w + 0.2) || !inside(u + 0.2, w + STALL_D - 0.2) || !inside(u + STALL_W - 0.2, w + STALL_D - 0.2)) continue
      const [x, z] = at(cu, cw)
      stalls.push({ x, z, yaw })
      stripes.push([...at(u, w), ...at(u, w + STALL_D)], [...at(u + STALL_W, w), ...at(u + STALL_W, w + STALL_D)])
    }
    w += STALL_D + (k % 2 === 0 ? AISLE : 0)
  }
  return { stalls, stripes }
}

// the stretch of the edge a -> b (length L, unit u) within w/2 of a door at (dx, dz): [s, e] or null
const doorCut = (a, u, L, door) => {
  if (!door) return null
  const fx = a.x - door.x
  const fz = a.z - door.z
  const b = fx * u.x + fz * u.z
  const c = fx * fx + fz * fz - (door.w / 2) ** 2
  const disc = b * b - c
  if (disc <= 0) return null
  const s = Math.max(0, -b - Math.sqrt(disc))
  const e = Math.min(L, -b + Math.sqrt(disc))
  return e > s ? [s, e] : null
}
const hex = (v, d) => (typeof v === "string" && v[0] === "#" ? parseInt(v.slice(1), 16) : v ?? d)

const WALLS = { school: 0xd9c7a3, industrial: 0xc9c6bd, warehouse: 0xbfc2c0, commercial: 0xd8d0c2, retail: 0xe0d6c4, house: 0xe8dcc6, residential: 0xe2d7c5, apartments: 0xd7cdbf, hotel: 0xd9d4ca, office: 0xc8ccd0, clubhouse: 0xe6d8bd, roof: 0x9a9184, garage: 0xbdb6aa, hall: 0xd4d2cc, yes: 0xd6cdbd }
const ROOFS = { school: 0x8a8278, industrial: 0x9ea3a6, warehouse: 0xa4a8aa, house: 0x9a5a42, residential: 0x8e6a55, apartments: 0x8b8178, clubhouse: 0x8c3b2f, hall: 0xb8bcc0, yes: 0x8f8a82 }
const AREA_FILL = { lawn: "#6f9a45", urban: "#b9b4a6", school: "#bdb7a6", grass: "#7fae5a", rec: "#86b45f", wood: "#4f7a3c", play: "#d1b07a", paved: "#c4bfb2", concrete: "#d0cabd", channel: "#c9c3b3", asphalt: "#55595e", deck: "#dcd5c6", turf: "#5f8f43", sand: "#e3d3a8", dirt: "#a88a62", planter: "#4f6f38", parking: "#5d6166", pool: "#4fb6e3", water: "#4a90c0" }
const AREA_ORDER = ["urban", "school", "grass", "rec", "wood", "play", "lawn", "turf", "dirt", "sand", "channel", "paved", "concrete", "asphalt", "parking", "deck", "planter", "pool", "water"]
const ROAD = { major: ["#4b4e53", 1], road: ["#55585d", 2], service: ["#5f6267", 3], aisle: ["#5f6267", 3], cycle: ["#9a8f80", 4], foot: ["#d2cbbb", 5] }

// cutaway: a game on one of an indoor venue's courts (courtvenue.js): the halls without their
// outside walls and roofs, so the match camera outside the walls sees in (the inside walls and
// the ceiling face inward only: from outside you look through them)
export const buildScenery = ({ group, keep, lambert, std, kit, layout: L, scene: S, quality = "medium", cutaway = false }) => {
  const rand = seeded(S.id.length * 7919 + 13)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  const e1 = new THREE.Euler()
  const C = S.colors || {}
  const B = L.BOUNDS
  // round 2 realism (detail.js; Medium/High): real trees, cars, decals, windows in relief that
  // reflect a sky, glowing hall lights. Low keeps the cheap shapes below.
  const detail = quality !== "low"
  const env = detail ? keep(skyEnvironment({ indoor: !!S.indoor, ground: S.groundStyle === "lawn" ? "#6f8a55" : "#9a958a" })) : null
  setDetailEnv(env)

  // ---------- the ground ----------
  // (the area to paint: the walkable bounds plus the scenery round them, at most 2048 px)
  let X0 = B.x0 - 30
  let X1 = B.x1 + 30
  let Z0 = B.z0 - 30
  let Z1 = B.z1 + 30
  const grow = (x, z) => {
    X0 = Math.min(X0, x)
    X1 = Math.max(X1, x)
    Z0 = Math.min(Z0, z)
    Z1 = Math.max(Z1, z)
  }
  for (const a of S.areas) for (const [x, z] of a.p) grow(x, z)
  for (const b of S.buildings) for (const [x, z] of b.p) grow(x, z)
  X0 = Math.max(X0, B.x0 - 160)
  X1 = Math.min(X1, B.x1 + 160)
  Z0 = Math.max(Z0, B.z0 - 160)
  Z1 = Math.min(Z1, B.z1 + 160)
  const GW = X1 - X0
  const GD = Z1 - Z0
  const maxPx = quality === "low" ? 1536 : 2048
  const PX = Math.min(8, maxPx / Math.max(GW, GD))
  const groundTex = canvasTexture(Math.max(2, Math.round(GW * PX)), Math.max(2, Math.round(GD * PX)), (ctx, w, h) => {
    const X = (x) => (x - X0) * PX
    const Z = (z) => (z - Z0) * PX
    ctx.fillStyle = C.ground || "#86a466"
    ctx.fillRect(0, 0, w, h)
    // mottle (grass: green blotches; paved ground, a town: grey wear)
    const paved = S.groundStyle === "paved"
    for (let i = 0; i < 6000; i++) {
      const v = rand()
      ctx.fillStyle = paved ? (v < 0.5 ? `rgba(40,40,40,${0.02 + rand() * 0.04})` : `rgba(255,255,250,${0.02 + rand() * 0.04})`) : v < 0.5 ? `rgba(40,70,30,${0.04 + rand() * 0.06})` : `rgba(200,210,150,${0.03 + rand() * 0.05})`
      ctx.beginPath()
      ctx.arc(rand() * w, rand() * h, 1.5 + rand() * 7, 0, Math.PI * 2)
      ctx.fill()
    }
    const poly = (p) => {
      ctx.beginPath()
      p.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))))
      ctx.closePath()
    }
    for (const k of AREA_ORDER)
      for (const a of S.areas) {
        if (a.k !== k) continue
        ctx.fillStyle = a.c || AREA_FILL[k] || "#999"
        poly(a.p)
        ctx.fill()
        if (k === "pool") {
          // lane lines along the pool's long side, then the coping round it
          if (a.lanes) {
            let best = null
            for (let i = 0; i < a.p.length; i++) {
              const p0 = a.p[i]
              const p1 = a.p[(i + 1) % a.p.length]
              const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
              if (!best || L > best.L) best = { L, ux: (p1[0] - p0[0]) / L, uz: (p1[1] - p0[1]) / L }
            }
            const { ux, uz } = best
            const us = a.p.map(([x, z]) => x * ux + z * uz)
            const ws = a.p.map(([x, z]) => -x * uz + z * ux)
            const u0 = Math.min(...us) + 1.6
            const u1 = Math.max(...us) - 1.6
            const w0 = Math.min(...ws)
            const w1 = Math.max(...ws)
            ctx.save()
            poly(a.p)
            ctx.clip()
            ctx.strokeStyle = "rgba(20,60,120,0.75)"
            ctx.lineWidth = Math.max(1, 0.25 * PX)
            for (let k2 = 1; k2 <= a.lanes; k2++) {
              const wv = w0 + ((w1 - w0) * (k2 - 0.5)) / a.lanes
              ctx.beginPath()
              ctx.moveTo(X(u0 * ux - wv * uz), Z(u0 * uz + wv * ux))
              ctx.lineTo(X(u1 * ux - wv * uz), Z(u1 * uz + wv * ux))
              ctx.stroke()
            }
            ctx.restore()
          }
          ctx.strokeStyle = "#ece7dc"
          ctx.lineWidth = Math.max(1, (a.coping || 1.2) * PX)
          poly(a.p)
          ctx.stroke()
        }
        if (k === "parking") {
          // stall stripes, from the same stall plan the cars park in (lotStalls)
          ctx.save()
          poly(a.p)
          ctx.clip()
          ctx.strokeStyle = "rgba(240,240,235,0.75)"
          ctx.lineWidth = Math.max(1, 0.12 * PX)
          for (const [x0, z0, x1, z1] of lotStalls(a.p).stripes) {
            ctx.beginPath()
            ctx.moveTo(X(x0), Z(z0))
            ctx.lineTo(X(x1), Z(z1))
            ctx.stroke()
          }
          ctx.restore()
        }
      }
    // roads and paths, widest first
    const roads = S.roads.slice().sort((a, b) => (ROAD[a.k]?.[1] || 9) - (ROAD[b.k]?.[1] || 9))
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    for (const r of roads) {
      ctx.strokeStyle = ROAD[r.k]?.[0] || "#666"
      ctx.lineWidth = Math.max(1, r.w * PX)
      ctx.beginPath()
      r.p.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))))
      ctx.stroke()
      if (r.k === "major" || r.k === "road") {
        ctx.strokeStyle = r.k === "major" ? "rgba(240,200,60,0.8)" : "rgba(240,240,235,0.5)"
        ctx.lineWidth = Math.max(1, 0.15 * PX)
        ctx.setLineDash([3 * PX, 4 * PX])
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
    // a concrete apron round each bank of courts (outdoors)
    if (!S.indoor) {
      ctx.fillStyle = "#b3b1aa"
      for (const b of S.banks) {
        ctx.save()
        ctx.translate(X(b.cx), Z(b.cz))
        ctx.rotate(Math.atan2(b.uz, b.ux))
        ctx.fillRect(-(b.hx + 1.6) * PX, -(b.hz + 1.6) * PX, 2 * (b.hx + 1.6) * PX, 2 * (b.hz + 1.6) * PX)
        ctx.restore()
      }
    }
    // building footprints a shade darker (they sit on them), and the halls' floors
    ctx.fillStyle = "rgba(60,60,60,0.35)"
    for (const b of S.buildings) {
      poly(b.p)
      ctx.fill()
    }
    // shade under trees
    for (const t of S.trees) {
      const r = (t.kind === "palm" ? 1.6 : 2.6) * t.s
      const g = ctx.createRadialGradient(X(t.x + 0.6), Z(t.z + 0.5), 0, X(t.x + 0.6), Z(t.z + 0.5), r * PX)
      g.addColorStop(0, "rgba(10,30,10,0.32)")
      g.addColorStop(1, "rgba(10,30,10,0)")
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(X(t.x + 0.6), Z(t.z + 0.5), r * PX, 0, Math.PI * 2)
      ctx.fill()
    }
  })
  keep(groundTex)
  groundTex.anisotropy = 4
  const groundMat = surfaced(lambert(0xffffff, { map: groundTex }), "ground")
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(GW, GD)), groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.set((X0 + X1) / 2, 0, (Z0 + Z1) / 2)
  ground.renderOrder = -0.5
  group.add(ground)
  const farR = Math.max(260, Math.max(GW, GD))
  const far = new THREE.Mesh(keep(new THREE.CircleGeometry(farR, 36)), lambert(hex(C.far, 0x8f9a6a)))
  far.rotation.x = -Math.PI / 2
  far.position.set((X0 + X1) / 2, -0.05, (Z0 + Z1) / 2)
  group.add(far)

  // ---------- the banks' surfaces and every court ----------
  const surroundMat = surfaced(std(hex(C.surround, 0x3c8a5a), { roughness: 0.9 }), "acrylic")
  const tennisSurroundMat = surfaced(std(hex(C.tennisSurround ?? C.surround, 0x3c8a5a), { roughness: 0.9 }), "acrylic")
  for (const b of S.banks) {
    const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(2 * b.hx, 2 * b.hz).rotateX(-Math.PI / 2)), b.s === "t" ? tennisSurroundMat : b.s === "b" ? kit.mats.asphalt : surroundMat)
    m.position.set(b.cx, 0.002, b.cz)
    m.rotation.y = yawFor(b.ux, b.uz)
    group.add(m)
  }
  // Courts with their own surround color (feature pods, red clay): in a bank, one patch per
  // color round those courts, reaching the bank's edge wherever they're near it (aerials show
  // a pod painted to its fence); a court outside every bank gets a pad round it.
  const padOf = (c) => ({ w: c.W + (c.s === "t" ? 6.4 : 2.6), l: c.L + (c.s === "t" ? 11 : 4.8) })
  const inBank = (c, b) => {
    const dx = c.x - b.cx
    const dz = c.z - b.cz
    return Math.abs(dx * b.ux + dz * b.uz) <= b.hx && Math.abs(-dx * b.uz + dz * b.ux) <= b.hz
  }
  const patched = new Set()
  for (const b of S.banks) {
    if (b.s === "b") continue
    const byColor = new Map()
    for (const c of S.courts) {
      const paint = c.col !== null && c.col !== undefined ? (S.palettes || [])[c.col] : null
      if (!paint?.surround || patched.has(c) || !inBank(c, b)) continue
      if (!byColor.has(paint.surround)) byColor.set(paint.surround, { paint, courts: [] })
      byColor.get(paint.surround).courts.push(c)
    }
    const SNAP = 4.5
    const rects = []
    for (const { paint, courts } of byColor.values()) {
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
      for (const c of courts) {
        patched.add(c)
        const { w, l } = padOf(c)
        const cs = Math.cos(c.rot)
        const sn = Math.sin(c.rot)
        for (const [X, Z] of [[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2]]) {
          const dx = c.x + X * cs + Z * sn - b.cx
          const dz = c.z - X * sn + Z * cs - b.cz
          const u = dx * b.ux + dz * b.uz
          const v = -dx * b.uz + dz * b.ux
          u0 = Math.min(u0, u), u1 = Math.max(u1, u), v0 = Math.min(v0, v), v1 = Math.max(v1, v)
        }
      }
      if (u0 + b.hx < SNAP) u0 = -b.hx
      if (b.hx - u1 < SNAP) u1 = b.hx
      if (v0 + b.hz < SNAP) v0 = -b.hz
      if (b.hz - v1 < SNAP) v1 = b.hz
      u0 = Math.max(u0, -b.hx), u1 = Math.min(u1, b.hx), v0 = Math.max(v0, -b.hz), v1 = Math.min(v1, b.hz)
      rects.push({ paint, u0, u1, v0, v1 })
    }
    // two patches side by side meet halfway (pods share a pen with a thin divider between)
    for (const A of rects)
      for (const B of rects) {
        if (A === B) continue
        const overlapV = Math.min(A.v1, B.v1) - Math.max(A.v0, B.v0)
        const overlapU = Math.min(A.u1, B.u1) - Math.max(A.u0, B.u0)
        if (overlapV > 0 && B.u0 >= A.u1 && B.u0 - A.u1 < SNAP) A.u1 = B.u0 = (A.u1 + B.u0) / 2
        if (overlapU > 0 && B.v0 >= A.v1 && B.v0 - A.v1 < SNAP) A.v1 = B.v0 = (A.v1 + B.v0) / 2
      }
    for (const { paint, u0, u1, v0, v1 } of rects) {
      const uc = (u0 + u1) / 2
      const vc = (v0 + v1) / 2
      const patch = new THREE.Mesh(keep(new THREE.PlaneGeometry(u1 - u0, v1 - v0).rotateX(-Math.PI / 2)), kit.paintMats(paint).surround)
      patch.position.set(b.cx + uc * b.ux - vc * b.uz, 0.004, b.cz + uc * b.uz + vc * b.ux)
      patch.rotation.y = yawFor(b.ux, b.uz)
      group.add(patch)
    }
  }
  const groups = new Map()
  const palettes = S.palettes || []
  for (const c of S.courts) {
    const paint = c.col !== null && c.col !== undefined ? palettes[c.col] : null
    // (a court with its own surround color outside every bank: a pad round it)
    if (paint?.surround && !patched.has(c)) {
      const pm = kit.paintMats(paint)
      const { w, l } = padOf(c)
      const pad = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2)), pm.surround)
      pad.position.set(c.x, 0.004, c.z)
      pad.rotation.y = c.rot
      group.add(pad)
    }
    const g = c.s === "t" ? kit.tennis(c.x, c.z, c.rot, { pb: c.pb, layout: c.pl, runoff: false, paint }) : c.s === "b" ? kit.basketball(c.x, c.z, c.rot) : kit.pickleball(c.x, c.z, c.rot, { runoff: false, paint })
    g.position.y = 0.008
    g.updateMatrixWorld(true)
    group.add(g)
    groups.set(c, g)
  }

  // ---------- low fences, nets, walls, hedges ----------
  // (the low dividers between paired courts: dark, not the windscreens' color)
  const screenMat = surfaced(lambert(hex(S.fence?.dividerColor, 0x1d2420), { side: THREE.DoubleSide, ...(detail ? { map: keep(windscreenTex()) } : {}) }), "fabric")
  const wallMat = lambert(0xc9c2b4)
  const hedgeMat = lambert(0x3f6b34, { flatShading: true })
  const netTex = keep(
    canvasTexture(32, 32, (ctx, w) => {
      ctx.clearRect(0, 0, w, w)
      ctx.strokeStyle = "rgba(15,18,22,0.8)"
      ctx.lineWidth = 2
      ctx.strokeRect(0, 0, w, w)
    })
  )
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping
  const divNetMat = keep(new THREE.MeshBasicMaterial({ map: netTex, color: hex(S.fence?.netColor, 0xffffff), transparent: true, side: THREE.DoubleSide, depthWrite: false }))
  const ropeMat = lambert(hex(S.fence?.netTop, 0x1c1f24))
  for (const f of S.fences) {
    if (f.k === "chain") continue
    const [x0, z0] = f.a
    const [x1, z1] = f.b
    const len = Math.hypot(x1 - x0, z1 - z0)
    if (len < 0.1) continue
    const ry = -Math.atan2(z1 - z0, x1 - x0)
    const mx = (x0 + x1) / 2
    const mz = (z0 + z1) / 2
    if (f.k === "screen") {
      const s = new THREE.Mesh(keep(new THREE.PlaneGeometry(len, f.h)), screenMat)
      s.position.set(mx, f.h / 2, mz)
      s.rotation.y = ry
      group.add(s)
    } else if (f.k === "net") {
      const geo = keep(new THREE.PlaneGeometry(len, f.h))
      const uv = geo.attributes.uv
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len * 8, uv.getY(i) * f.h * 8)
      const n = new THREE.Mesh(geo, divNetMat)
      n.position.set(mx, f.h / 2, mz)
      n.rotation.y = ry
      n.renderOrder = 1
      group.add(n)
      const rope = new THREE.Mesh(keep(new THREE.BoxGeometry(len, 0.03, 0.03)), ropeMat)
      rope.position.set(mx, f.h, mz)
      rope.rotation.y = ry
      group.add(rope)
    } else {
      const m = new THREE.Mesh(keep(new THREE.BoxGeometry(len, f.h, f.k === "hedge" ? 0.9 : 0.25)), f.k === "hedge" ? hedgeMat : wallMat)
      m.position.set(mx, f.h / 2, mz)
      m.rotation.y = ry
      group.add(m)
    }
  }

  // ---------- buildings ----------
  const windowsTex = keep(
    canvasTexture(64, 64, (ctx, w) => {
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, w, w)
      ctx.fillStyle = "rgba(40,55,70,0.55)"
      ctx.fillRect(10, 18, 18, 22)
      ctx.fillRect(38, 18, 18, 22)
      ctx.fillStyle = "rgba(0,0,0,0.08)"
      ctx.fillRect(0, 58, w, 6)
    })
  )
  windowsTex.wrapS = windowsTex.wrapT = THREE.RepeatWrapping
  const ribsTex = keep(
    canvasTexture(64, 64, (ctx, w) => {
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, w, w)
      for (let x = 0; x < w; x += 8) {
        ctx.fillStyle = "rgba(0,0,0,0.07)"
        ctx.fillRect(x, 0, 3, w)
      }
      ctx.fillStyle = "rgba(0,0,0,0.12)"
      ctx.fillRect(0, 60, w, 4)
    })
  )
  ribsTex.wrapS = ribsTex.wrapT = THREE.RepeatWrapping
  // inside surfaces (white: the wall's color tints them; one tile = 3 x 3 m like wallRing's uv):
  // quilt = sound-stage blankets (hung in 1.5 m panels, quilted in puffy squares), block =
  // painted cinder block (running bond), panel = insulated ceiling/wall panels, tile = 0.6 m tiles
  const surfaceTex = new Map()
  const surfaceTexFor = (kind) => {
    if (!kind) return null
    if (surfaceTex.has(kind)) return surfaceTex.get(kind)
    const t = keep(
      canvasTexture(128, 128, (ctx, w) => {
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, w, w)
        if (kind === "quilt") {
          // two blankets per tile, each 64 px wide: puffy quilted cells, dark seams between
          for (let px = 0; px < w; px += 64)
            for (let cx = 0; cx < 4; cx++)
              for (let cy = 0; cy < 8; cy++) {
                const x = px + cx * 16 + 8
                const y = cy * 16 + 8
                const g = ctx.createRadialGradient(x, y, 1, x, y, 11)
                g.addColorStop(0, "rgba(255,255,255,1)")
                g.addColorStop(1, "rgba(0,0,0,0.38)")
                ctx.fillStyle = g
                ctx.fillRect(x - 8, y - 8, 16, 16)
              }
          ctx.fillStyle = "rgba(0,0,0,0.55)"
          for (let px = 0; px < w; px += 64) ctx.fillRect(px, 0, 2, w)
          // (the blankets sag a little at their hems)
          ctx.fillStyle = "rgba(0,0,0,0.25)"
          ctx.fillRect(0, w - 3, w, 3)
        } else if (kind === "block") {
          // 8 x 16 blocks a tile (37.5 x 18.75 cm), mortar a shade darker, every other row offset
          ctx.fillStyle = "rgba(0,0,0,0.22)"
          for (let r = 0; r < 16; r++) {
            ctx.fillRect(0, r * 8, w, 1)
            for (let c = 0; c < 8; c++) ctx.fillRect(c * 16 + (r % 2 ? 8 : 0), r * 8, 1, 8)
          }
          for (let i = 0; i < 400; i++) {
            ctx.fillStyle = `rgba(0,0,0,${0.03 + ((i * 37) % 7) / 100})`
            ctx.fillRect((i * 53) % w, (i * 29) % w, 2, 2)
          }
        } else if (kind === "panel") {
          // insulated panels: a seam every 1 m, faint ribs between
          ctx.fillStyle = "rgba(0,0,0,0.18)"
          for (let x = 0; x < w; x += Math.round(w / 3)) ctx.fillRect(x, 0, 2, w)
          ctx.fillStyle = "rgba(0,0,0,0.05)"
          for (let x = 0; x < w; x += 8) ctx.fillRect(x, 0, 1, w)
        } else if (kind === "tile") {
          ctx.fillStyle = "rgba(0,0,0,0.16)"
          for (let k = 0; k < w; k += Math.round(w / 5)) {
            ctx.fillRect(k, 0, 1, w)
            ctx.fillRect(0, k, w, 1)
          }
        } else if (kind === "pad") {
          // padded wall panels, 1 m wide (3 a tile): pillowed, stitched near the edges, dark joints
          for (let px = 0; px < w; px += Math.round(w / 3)) {
            const pw = Math.round(w / 3)
            const g = ctx.createLinearGradient(px, 0, px + pw, 0)
            g.addColorStop(0, "rgba(0,0,0,0.30)")
            g.addColorStop(0.18, "rgba(255,255,255,0.0)")
            g.addColorStop(0.5, "rgba(255,255,255,0.10)")
            g.addColorStop(0.82, "rgba(255,255,255,0.0)")
            g.addColorStop(1, "rgba(0,0,0,0.30)")
            ctx.fillStyle = g
            ctx.fillRect(px, 0, pw, w)
            ctx.fillStyle = "rgba(0,0,0,0.6)"
            ctx.fillRect(px, 0, 2, w)
            ctx.fillStyle = "rgba(255,255,255,0.35)"
            for (let y = 4; y < w; y += 6) {
              ctx.fillRect(px + 5, y, 1, 3)
              ctx.fillRect(px + pw - 6, y, 1, 3)
            }
          }
          ctx.fillStyle = "rgba(0,0,0,0.3)"
          ctx.fillRect(0, 0, w, 3)
        } else if (kind === "slats") {
          // vertical wood slats
          for (let x = 0; x < w; x += 6) {
            ctx.fillStyle = x % 12 ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.0)"
            ctx.fillRect(x, 0, 5, w)
            ctx.fillStyle = "rgba(0,0,0,0.35)"
            ctx.fillRect(x + 5, 0, 1, w)
          }
        }
      })
    )
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    surfaceTex.set(kind, t)
    return t
  }
  // floors and ceilings (flat shapes: uv = metres): white textures the room's color tints,
  // repeated at their own size (tile: metres one texture covers)
  const FLOOR_TILE = { wood: 2.4, tile: 1.2, rubber: 1.0, carpet: 1.0, stone: 1.6, slats: 1.2, grid: 1.2, panel: 2.0 }
  const floorTex = new Map()
  const floorTexFor = (kind) => {
    if (!kind || !FLOOR_TILE[kind]) return null
    if (floorTex.has(kind)) return floorTex.get(kind)
    const r = seeded(kind.length * 977 + 3)
    const t = keep(
      canvasTexture(128, 128, (ctx, w) => {
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, w, w)
        if (kind === "wood" || kind === "slats") {
          // planks (wood: 18 cm wide, staggered ends; slats: even boards with gaps)
          const n = kind === "wood" ? 13 : 8
          const pw = w / n
          for (let k = 0; k < n; k++) {
            const shade = 0.84 + r() * 0.16
            ctx.fillStyle = `rgb(${Math.round(255 * shade)},${Math.round(255 * shade * 0.97)},${Math.round(255 * shade * 0.93)})`
            ctx.fillRect(k * pw, 0, pw, w)
            ctx.fillStyle = "rgba(0,0,0,0.28)"
            ctx.fillRect(k * pw, 0, 1, w)
            if (kind === "wood") {
              const cut = r() * w
              ctx.fillRect(k * pw, cut, pw, 1)
              // grain
              ctx.fillStyle = "rgba(90,50,20,0.06)"
              for (let g = 0; g < 4; g++) ctx.fillRect(k * pw + r() * pw, 0, 1, w)
            }
          }
        } else if (kind === "tile" || kind === "grid") {
          // 60 cm squares: tile = porcelain with slight variation, grout; grid = acoustic tiles in a
          // white T-bar grid with pinholes
          const n = 2
          const s = w / n
          for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++) {
              const v = kind === "tile" ? 0.9 + r() * 0.1 : 0.93
              ctx.fillStyle = `rgb(${Math.round(255 * v)},${Math.round(255 * v)},${Math.round(255 * v)})`
              ctx.fillRect(i * s, j * s, s, s)
              if (kind === "grid") {
                ctx.fillStyle = "rgba(0,0,0,0.10)"
                for (let p = 0; p < 60; p++) ctx.fillRect(i * s + r() * s, j * s + r() * s, 1, 1)
              }
            }
          ctx.fillStyle = kind === "tile" ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,1)"
          for (let k = 0; k <= n; k++) {
            ctx.fillRect(k * s - (kind === "grid" ? 2 : 1), 0, kind === "grid" ? 4 : 2, w)
            ctx.fillRect(0, k * s - (kind === "grid" ? 2 : 1), w, kind === "grid" ? 4 : 2)
          }
          if (kind === "grid") {
            ctx.fillStyle = "rgba(0,0,0,0.12)"
            for (let k = 0; k <= n; k++) {
              ctx.fillRect(k * s + 2, 0, 1, w)
              ctx.fillRect(0, k * s + 2, w, 1)
            }
          }
        } else if (kind === "rubber") {
          // gym rubber: dark with flecks, tile seams every 1 m
          ctx.fillStyle = "#d8d8d8"
          ctx.fillRect(0, 0, w, w)
          for (let p = 0; p < 900; p++) {
            ctx.fillStyle = r() < 0.5 ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.3)"
            ctx.fillRect(r() * w, r() * w, 1, 1)
          }
          ctx.fillStyle = "rgba(0,0,0,0.35)"
          ctx.fillRect(0, 0, 1, w)
          ctx.fillRect(0, 0, w, 1)
        } else if (kind === "carpet") {
          for (let p = 0; p < 2400; p++) {
            ctx.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)"
            ctx.fillRect(r() * w, r() * w, 1, 1)
          }
          ctx.strokeStyle = "rgba(0,0,0,0.07)"
          for (let k = 0; k < w; k += 16) {
            ctx.beginPath()
            ctx.moveTo(k, 0)
            ctx.lineTo(k + 16, 16)
            ctx.stroke()
          }
        } else if (kind === "stone") {
          // irregular slabs
          ctx.fillStyle = "rgba(0,0,0,0.25)"
          ctx.fillRect(0, 0, w, w)
          for (let y = 0; y < w; y += 32)
            for (let x = (y / 32) % 2 ? -20 : 0; x < w; x += 44) {
              const v = 0.82 + r() * 0.18
              ctx.fillStyle = `rgb(${Math.round(255 * v)},${Math.round(250 * v)},${Math.round(240 * v)})`
              ctx.fillRect(x + 1, y + 1, 42, 30)
            }
        } else if (kind === "panel") {
          ctx.fillStyle = "rgba(0,0,0,0.14)"
          ctx.fillRect(0, 0, 2, w)
          ctx.fillStyle = "rgba(0,0,0,0.04)"
          for (let x = 0; x < w; x += 10) ctx.fillRect(x, 0, 1, w)
        }
      })
    )
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(1 / FLOOR_TILE[kind], 1 / FLOOR_TILE[kind])
    t.anisotropy = 4
    floorTex.set(kind, t)
    return t
  }
  // stucco with one tall dark-framed window every 3 m (mission style, the clubs' white buildings)
  const missionTex = keep(
    canvasTexture(64, 64, (ctx, w) => {
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, w, w)
      ctx.fillStyle = "#2e3a36"
      ctx.fillRect(24, 14, 16, 28)
      ctx.fillStyle = "rgba(120,150,160,0.9)"
      ctx.fillRect(26, 16, 12, 24)
      ctx.fillStyle = "#2e3a36"
      ctx.fillRect(31, 16, 2, 24)
      ctx.fillRect(26, 27, 12, 2)
      ctx.fillStyle = "rgba(0,0,0,0.06)"
      ctx.fillRect(0, 60, w, 4)
    })
  )
  missionTex.wrapS = missionTex.wrapT = THREE.RepeatWrapping
  const wallMats = new Map()
  const wallMatFor = (color, ribs) => {
    const key = `${color}|${ribs}`
    if (!wallMats.has(key)) {
      // (Medium/High: frames, sills and recessed glass in relief, the glass reflecting the sky)
      const wm = detail && ribs !== true ? windowMaps(ribs === "mission" ? "mission" : "windows") : null
      const ribN = detail && ribs === true ? normalFor(ribsTex, 2) : null
      const o = wm
        ? { map: wm.map, normalMap: wm.normalMap, specularMap: wm.specularMap, envMap: env, combine: THREE.MixOperation, reflectivity: 0.9 }
        : { map: ribs === "mission" ? missionTex : ribs ? ribsTex : windowsTex, ...(ribN ? { normalMap: ribN } : {}) }
      wallMats.set(key, surfaced(lambert(color, { ...o, side: THREE.DoubleSide }), "stucco"))
    }
    return wallMats.get(key)
  }
  const roofMats = new Map()
  const roofMatFor = (color) => {
    if (!roofMats.has(color)) roofMats.set(color, surfaced(lambert(color, { side: THREE.DoubleSide }), "concrete"))
    return roofMats.get(color)
  }
  // a wall ring (quads from y0 to y1) facing outward (or inward), uv in 3 m tiles
  const wallRing = (p, y0, y1, { inward = false, gap = null, gaps = null, offset = 0, edge = null } = {}) => {
    const cuts = gaps || (gap ? [gap] : [])
    const pos = []
    const uvs = []
    const ccw = signedArea(p) > 0 // (x east, z south: positive area runs clockwise seen from above)
    let u = 0
    for (let i = 0; i < p.length; i++) {
      const a = p[i]
      const b = p[(i + 1) % p.length]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len < 0.05 || (edge && !edge(a, b))) {
        u += len
        continue
      }
      // outward normal
      // (positive area in x, z: the edge's right-hand side, (dz, -dx), is outside)
      const nx = ((b[1] - a[1]) / len) * (ccw ? 1 : -1)
      const nz = (-(b[0] - a[0]) / len) * (ccw ? 1 : -1)
      const o = inward ? -offset : offset
      let runs = [[0, len]]
      for (const g of cuts) {
        const cutAt = doorCut({ x: a[0], z: a[1] }, { x: (b[0] - a[0]) / len, z: (b[1] - a[1]) / len }, len, g)
        if (cutAt) runs = runs.flatMap(([s0, e0]) => [[s0, Math.min(e0, cutAt[0])], [Math.max(s0, cutAt[1]), e0]]).filter(([s0, e0]) => e0 - s0 > 0.02)
      }
      for (const [s, e] of runs) {
        if (e - s < 0.05) continue
        const ax = a[0] + ((b[0] - a[0]) * s) / len + nx * o
        const az = a[1] + ((b[1] - a[1]) * s) / len + nz * o
        const bx = a[0] + ((b[0] - a[0]) * e) / len + nx * o
        const bz = a[1] + ((b[1] - a[1]) * e) / len + nz * o
        const u0 = (u + s) / 3
        const u1 = (u + e) / 3
        // two triangles, wound to face outward (or inward): the order a0, b0, a1 faces
        // (-dz, dx); flip it when that isn't the way wanted
        const faceOut = -(bz - az) * nx + (bx - ax) * nz > 0
        const asIs = faceOut !== inward
        const tri = asIs
          ? [ax, y0, az, bx, y0, bz, ax, y1, az, bx, y0, bz, bx, y1, bz, ax, y1, az]
          : [ax, y0, az, ax, y1, az, bx, y0, bz, bx, y0, bz, ax, y1, az, bx, y1, bz]
        const tuv = asIs ? [u0, y0 / 3, u1, y0 / 3, u0, y1 / 3, u1, y0 / 3, u1, y1 / 3, u0, y1 / 3] : [u0, y0 / 3, u0, y1 / 3, u1, y0 / 3, u1, y0 / 3, u0, y1 / 3, u1, y1 / 3]
        pos.push(...tri)
        uvs.push(...tuv)
      }
      u += len
    }
    // (wound for x east / z south; flip if needed so the outside is the front face)
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
    g.computeVertexNormals()
    return keep(g)
  }
  const flat = (p, y) => {
    const shape = new THREE.Shape(p.map(([x, z]) => new THREE.Vector2(x, -z)))
    const g = new THREE.ShapeGeometry(shape)
    g.rotateX(-Math.PI / 2)
    g.translate(0, y, 0)
    return keep(g)
  }
  // the doors (venuegen: every room's and open building's) that sit on a polygon's walls
  // (a door upstairs, d.y, only opens the walls on its floor)
  const doorsOn = (poly, y = 0) =>
    (S.doors || []).filter((d) =>
      Math.abs((d.y || 0) - y) < 0.5 &&
      poly.some((q, i) => {
        const b = poly[(i + 1) % poly.length]
        const L2 = (b[0] - q[0]) ** 2 + (b[1] - q[1]) ** 2 || 1
        const t = Math.max(0, Math.min(1, ((d.x - q[0]) * (b[0] - q[0]) + (d.z - q[1]) * (b[1] - q[1])) / L2))
        return Math.hypot(q[0] + (b[0] - q[0]) * t - d.x, q[1] + (b[1] - q[1]) * t - d.z) < 0.5
      })
    )
  // the same, facing down (a ceiling)
  const flatDown = (p, y) => {
    const shape = new THREE.Shape(p.map(([x, z]) => new THREE.Vector2(x, z)))
    const g = new THREE.ShapeGeometry(shape)
    g.rotateX(Math.PI / 2)
    g.translate(0, y, 0)
    return keep(g)
  }
  // clay tiles (white: the roof's color tints them): rows of barrel tiles with dark grooves
  const tileTex = keep(
    canvasTexture(64, 64, (ctx, w) => {
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, w, w)
      for (let r = 0; r < 4; r++) {
        const y = r * 16
        for (let c = 0; c < 8; c++) {
          const x = c * 8 + (r % 2 ? 4 : 0)
          const g = ctx.createLinearGradient(x, 0, x + 8, 0)
          g.addColorStop(0, "rgba(0,0,0,0.22)")
          g.addColorStop(0.45, "rgba(255,255,255,0.10)")
          g.addColorStop(1, "rgba(0,0,0,0.25)")
          ctx.fillStyle = g
          ctx.fillRect(x, y, 8, 16)
        }
        ctx.fillStyle = "rgba(0,0,0,0.30)"
        ctx.fillRect(0, y + 14, w, 2)
      }
    })
  )
  tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping
  const tileMats = new Map()
  const tileMatFor = (color) => {
    if (!tileMats.has(color)) tileMats.set(color, surfaced(lambert(color, { map: tileTex, side: THREE.DoubleSide }), "roof"))
    return tileMats.get(color)
  }
  // a building's smallest rectangle: { ux, uz (along the long side), u0, u1, w0, w1 }
  const rectOf = (p) => {
    let best = null
    for (let i = 0; i < p.length; i++) {
      const a = p[i]
      const b2 = p[(i + 1) % p.length]
      const L = Math.hypot(b2[0] - a[0], b2[1] - a[1])
      if (L < 0.3) continue
      const ux = (b2[0] - a[0]) / L
      const uz = (b2[1] - a[1]) / L
      let u0 = Infinity
      let u1 = -Infinity
      let w0 = Infinity
      let w1 = -Infinity
      for (const [x, z] of p) {
        const u = x * ux + z * uz
        const w = -x * uz + z * ux
        u0 = Math.min(u0, u)
        u1 = Math.max(u1, u)
        w0 = Math.min(w0, w)
        w1 = Math.max(w1, w)
      }
      const area = (u1 - u0) * (w1 - w0)
      if (!best || area < best.area) best = { area, ux, uz, u0, u1, w0, w1 }
    }
    let { ux, uz, u0, u1, w0, w1 } = best
    if (w1 - w0 > u1 - u0) {
      ;[ux, uz] = [-uz, ux]
      ;[u0, u1, w0, w1] = [w0, w1, -u1, -u0]
    }
    return { ux, uz, u0, u1, w0, w1 }
  }
  // sloped roofs over the rectangle, with tile uvs (u along the eave, v up the slope):
  // gable (ridge along the long side), hip (four slopes), mansard (a sloped band round a flat top)
  const slopedRoof = (p, h, style, { rise: riseO, band = 5, eaves = 0.5 } = {}) => {
    const { ux, uz, u0, u1, w0, w1 } = rectOf(p)
    const P = (u, w, y) => [u * ux - w * uz, y, u * uz + w * ux]
    const pos = []
    const uv = []
    const tri = (A, B, C, e) => {
      pos.push(...A, ...B, ...C)
      for (const Q of [A, B, C]) uv.push((Q[0] * e[0] + Q[2] * e[1]) / 0.5, (Q[1] - h) / 0.17)
    }
    const quad = (A, B, C, D, e) => {
      tri(A, B, C, e)
      tri(A, C, D, e)
    }
    const o = eaves
    const W = w1 - w0
    const rise = riseO ?? Math.min(3.2, W * (style === "mansard" ? 0.22 : 0.27))
    const wm = (w0 + w1) / 2
    const eu = [ux, uz] // eave along u
    const ew = [-uz, ux] // eave along w
    const A = P(u0 - o, w0 - o, h)
    const B = P(u1 + o, w0 - o, h)
    const C2 = P(u1 + o, w1 + o, h)
    const D = P(u0 - o, w1 + o, h)
    let top = null
    if (style === "mansard") {
      const bd = Math.min(band, W / 2 - 0.5, (u1 - u0) / 2 - 0.5)
      const a = P(u0 + bd, w0 + bd, h + rise)
      const b = P(u1 - bd, w0 + bd, h + rise)
      const c = P(u1 - bd, w1 - bd, h + rise)
      const d = P(u0 + bd, w1 - bd, h + rise)
      quad(A, B, b, a, eu)
      quad(B, C2, c, b, ew)
      quad(C2, D, d, c, eu)
      quad(D, A, a, d, ew)
      top = [a, b, c, d]
    } else if (style === "hip") {
      const inset = Math.min(W / 2, (u1 - u0) / 2)
      const E = P(u0 + inset, wm, h + rise)
      const F = P(u1 - inset, wm, h + rise)
      quad(A, B, F, E, eu)
      quad(C2, D, E, F, eu)
      tri(D, A, E, ew)
      tri(B, C2, F, ew)
    } else {
      const E = P(u0 - o, wm, h + rise)
      const F = P(u1 + o, wm, h + rise)
      quad(A, B, F, E, eu)
      quad(C2, D, E, F, eu)
      tri(D, A, E, ew)
      tri(B, C2, F, ew)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
    g.computeVertexNormals()
    return { geo: keep(g), top }
  }
  // A footprint that isn't a rectangle (an L, a T, a long building with jogs: most real
  // clubhouses and shops) can't take a roof over its smallest rectangle: that drew one big
  // hip over everything (Paseo's north building was a red slab across the lot). This roof
  // follows the outline instead, as mission-style buildings are built: a sloped tile band
  // along every wall, rising inward to a flat top. Returns { geo, top } like slopedRoof.
  const rectish = (p) => {
    if (p.length <= 4) return true
    const { u0, u1, w0, w1 } = rectOf(p)
    return Math.abs(signedArea(p)) / ((u1 - u0) * (w1 - w0) || 1) > 0.9
  }
  const outlineRoof = (p, h, { band = 4, rise: riseO } = {}) => {
    const n = p.length
    const A = Math.abs(signedArea(p))
    let per = 0
    for (let i = 0; i < n; i++) per += Math.hypot(p[(i + 1) % n][0] - p[i][0], p[(i + 1) % n][1] - p[i][1])
    // keep the band well inside the building's width (2A/perimeter: a thin building's width)
    const bd = Math.max(0.8, Math.min(band, (0.35 * 2 * A) / (per || 1)))
    const rise = riseO ?? Math.min(2.4, bd * 0.55)
    // each wall's inward normal (tested against the polygon, so either winding works)
    const lines = []
    for (let i = 0; i < n; i++) {
      const a = p[i]
      const b2 = p[(i + 1) % n]
      const L = Math.hypot(b2[0] - a[0], b2[1] - a[1]) || 1
      let nx = -(b2[1] - a[1]) / L
      let nz = (b2[0] - a[0]) / L
      const mx = (a[0] + b2[0]) / 2
      const mz = (a[1] + b2[1]) / 2
      if (!pointInPoly(mx + nx * 0.2, mz + nz * 0.2, p)) (nx = -nx), (nz = -nz)
      lines.push({ a: [a[0] + nx * bd, a[1] + nz * bd], d: [(b2[0] - a[0]) / L, (b2[1] - a[1]) / L], nx, nz })
    }
    // the inner outline: neighbouring offset walls meet (a sharp corner is clamped)
    const q = p.map((v, i) => {
      const l0 = lines[(i - 1 + n) % n]
      const l1 = lines[i]
      const den = l0.d[0] * l1.d[1] - l0.d[1] * l1.d[0]
      let x
      let z
      if (Math.abs(den) < 1e-6) {
        x = v[0] + l1.nx * bd
        z = v[1] + l1.nz * bd
      } else {
        const t = ((l1.a[0] - l0.a[0]) * l1.d[1] - (l1.a[1] - l0.a[1]) * l1.d[0]) / den
        x = l0.a[0] + l0.d[0] * t
        z = l0.a[1] + l0.d[1] * t
      }
      const dx = x - v[0]
      const dz = z - v[1]
      const m = Math.hypot(dx, dz)
      if (m > bd * 2.5) {
        x = v[0] + (dx / m) * bd * 2.5
        z = v[1] + (dz / m) * bd * 2.5
      }
      return [x, z]
    })
    const pos = []
    const uv = []
    const tri = (P1, P2, P3, e) => {
      pos.push(...P1, ...P2, ...P3)
      for (const Q of [P1, P2, P3]) uv.push((Q[0] * e[0] + Q[2] * e[1]) / 0.5, (Q[1] - h) / 0.17)
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const e = lines[i].d
      const o0 = [p[i][0], h, p[i][1]]
      const o1 = [p[j][0], h, p[j][1]]
      const i0 = [q[i][0], h + rise, q[i][1]]
      const i1 = [q[j][0], h + rise, q[j][1]]
      tri(o0, o1, i1, e)
      tri(o0, i1, i0, e)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
    g.computeVertexNormals()
    return { geo: keep(g), top: q.map(([x, z]) => [x, h + rise, z]) }
  }
  const plainMats = new Map()
  const plainMatFor = (color) => {
    if (!plainMats.has(color)) plainMats.set(color, surfaced(lambert(color, { side: THREE.DoubleSide }), "stucco"))
    return plainMats.get(color)
  }
  const hvac = []
  // (round 2: a light coping on parapets; louvered rooftop units)
  const copingMat = surfaced(lambert(0xe9e6df, { side: THREE.DoubleSide }), "concrete")
  const flatRing = (p, y, w) => {
    // a flat band w wide just inside the outline (the coping on top of a parapet)
    const pos = []
    const ccw = signedArea(p) > 0
    for (let i = 0; i < p.length; i++) {
      const a = p[i]
      const b = p[(i + 1) % p.length]
      const L2 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      // inward normal
      let nx = -(b[1] - a[1]) / L2
      let nz = (b[0] - a[0]) / L2
      if (!ccw) (nx = -nx), (nz = -nz)
      const a2 = [a[0] + nx * w, a[1] + nz * w]
      const b2 = [b[0] + nx * w, b[1] + nz * w]
      pos.push(a[0], y, a[1], b[0], y, b[1], b2[0], y, b2[1], a[0], y, a[1], b2[0], y, b2[1], a2[0], y, a2[1])
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.computeVertexNormals()
    // face up whichever way the triangles wind
    const n = g.attributes.normal
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0)
    return keep(g)
  }
  const hvacTex = () =>
    canvasTex(64, 64, (ctx) => {
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, 64, 64)
      ctx.fillStyle = "rgba(0,0,0,0.22)"
      for (let y = 8; y < 52; y += 4) ctx.fillRect(6, y, 52, 2)
      ctx.fillStyle = "rgba(0,0,0,0.12)"
      ctx.fillRect(0, 60, 64, 4)
      ctx.strokeStyle = "rgba(0,0,0,0.3)"
      ctx.strokeRect(2, 2, 60, 60)
    }, { repeat: false })
  // S.roofs: roof-only parts over a building drawn with roofStyle "none" (a clubhouse's wings
  // at their own heights). A part's walls run from y0 (default: its own height, so none) up
  // to h; parts are drawn, never walked into (collision stays with the building)
  const roofParts = (S.roofs || []).map((r) => ({ ...r, y0: r.y0 ?? r.h, roofOnly: true }))
  for (const b of [...S.buildings, ...roofParts]) {
    if (b.p.length < 3) continue
    const kind = b.k || "yes"
    const color = hex(b.c, WALLS[kind] ?? WALLS.yes)
    const ribs = b.windows === "ribs" || (!b.windows && (kind === "industrial" || kind === "warehouse" || kind === "hall" || kind === "garage" || !!b.hall))
    const wallMat = b.windows === "none" ? plainMatFor(color) : wallMatFor(color, b.windows === "mission" ? "mission" : ribs)
    const y0 = b.y0 || 0
    // (a hall's outside walls are drawn with its inside, cut for the door)
    // (doors upstairs, a room on a second floor opening onto a balcony: the wall is cut at
    // that floor only, door-high, solid above; the ground floor's doors cut as before)
    const upDoors = b.doors && !b.roofOnly ? [...new Set((S.doors || []).filter((d) => (d.y || 0) > 0.5).map((d) => d.y))].filter((y) => doorsOn(b.p, y).length) : []
    if (!b.hall && b.h - y0 > 0.05 && !upDoors.length) group.add(new THREE.Mesh(wallRing(b.p, y0, b.h, b.doors && !b.roofOnly ? { gaps: doorsOn(b.p) } : {}), wallMat))
    else if (!b.hall && b.h - y0 > 0.05) {
      const floors = [...upDoors].sort((a, c) => a - c)
      group.add(new THREE.Mesh(wallRing(b.p, y0, floors[0], { gaps: doorsOn(b.p) }), wallMat))
      floors.forEach((fy, k) => {
        const top = Math.min(fy + 2.7, floors[k + 1] ?? b.h, b.h)
        group.add(new THREE.Mesh(wallRing(b.p, fy, top, { gaps: doorsOn(b.p, fy) }), wallMat))
        if ((floors[k + 1] ?? b.h) - top > 0.05) group.add(new THREE.Mesh(wallRing(b.p, top, floors[k + 1] ?? b.h), wallMat))
      })
    }
    const roofColor = hex(b.r, ROOFS[kind] ?? ROOFS.yes)
    const roofMat = roofMatFor(roofColor)
    if (b.hall && cutaway) continue
    const style = b.hall ? "flat" : b.rs || "flat"
    // (roofStyle "none": the walls only; the venue's `roofs` draw this building's roof in parts)
    if (style === "none") continue
    if (style === "gable" || style === "hip" || style === "mansard") {
      const r = rectish(b.p) ? slopedRoof(b.p, b.h, style, { rise: b.rise, band: b.band }) : outlineRoof(b.p, b.h, { band: b.band, rise: b.rise })
      group.add(new THREE.Mesh(r.geo, b.tile === false ? roofMat : tileMatFor(roofColor)))
      if (r.top) {
        const t = r.top.map((q2) => [q2[0], q2[2]])
        group.add(new THREE.Mesh(flat(t, r.top[0][1]), roofMatFor(hex(b.top, 0xe6e3dc))))
        if (b.hvac) {
          const xs = t.map((q2) => q2[0])
          const zs = t.map((q2) => q2[1])
          const n = Math.min(24, Math.round(Math.abs(signedArea(t)) / 120))
          for (let k = 0, tries = 0; k < n && tries < n * 10; tries++) {
            const x = Math.min(...xs) + rand() * (Math.max(...xs) - Math.min(...xs))
            const z = Math.min(...zs) + rand() * (Math.max(...zs) - Math.min(...zs))
            if (!pointInPoly(x, z, t) || !pointInPoly(x + 1.5, z + 1.5, t) || !pointInPoly(x - 1.5, z - 1.5, t)) continue
            hvac.push({ x, z, y: r.top[0][1], sx: 1.2 + rand() * 1.8, sz: 1.0 + rand() * 1.2, sy: 0.6 + rand() * 0.7, ry: 0 })
            k++
          }
        }
      }
    } else {
      group.add(new THREE.Mesh(flat(b.p, b.h), b.hall ? lambert(hex(b.r, ROOFS.hall)) : roofMat))
      // (Medium/High: every flat roof gets a parapet and its coping, and a big one its units)
      const par = b.parapet || (detail && !b.hall ? 0.45 : 0)
      if (par) {
        group.add(new THREE.Mesh(wallRing(b.p, b.h, b.h + par), plainMatFor(color)))
        group.add(new THREE.Mesh(wallRing(b.p, b.h, b.h + par, { inward: true, offset: 0.25 }), plainMatFor(color)))
        if (detail) group.add(new THREE.Mesh(flatRing(b.p, b.h + par + 0.01, 0.3), copingMat))
      }
      const roofArea = Math.abs(signedArea(b.p))
      const hv = b.hvac || (detail && !b.hall && roofArea > 300 ? Math.round(roofArea / 240) : 0)
      // rooftop units (air handlers, fans) scattered on a flat roof
      if (hv) {
        const xs = b.p.map((q2) => q2[0])
        const zs = b.p.map((q2) => q2[1])
        const ar = Math.abs(signedArea(b.p))
        const n = Math.min(60, typeof hv === "number" ? hv : Math.round(ar / 110))
        let tries = 0
        for (let k = 0; k < n && tries < n * 12; tries++) {
          const x = Math.min(...xs) + rand() * (Math.max(...xs) - Math.min(...xs))
          const z = Math.min(...zs) + rand() * (Math.max(...zs) - Math.min(...zs))
          if (!pointInPoly(x, z, b.p) || !pointInPoly(x + 2, z, b.p) || !pointInPoly(x - 2, z, b.p) || !pointInPoly(x, z + 2, b.p) || !pointInPoly(x, z - 2, b.p)) continue
          hvac.push({ x, z, y: b.h, sx: 1.2 + rand() * 2.4, sz: 1.0 + rand() * 1.6, sy: 0.7 + rand() * 0.9, ry: Math.atan2(b.p[1][1] - b.p[0][1], b.p[1][0] - b.p[0][0]) })
          k++
        }
      }
    }
  }
  if (hvac.length) {
    const units = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), lambert(0xd3d5d4, detail ? { map: keep(hvacTex()) } : {}), hvac.length)
    hvac.forEach((u, i) => units.setMatrixAt(i, m4.compose(v1.set(u.x, u.y, u.z), q.setFromEuler(e1.set(0, -u.ry, 0)), v2.set(u.sx, u.sy, u.sz))))
    group.add(units)
  }

  // ---------- the room kit: rooms (lobbies, gyms, locker rooms ...), their doors and props ----------
  // Each room is its own zone (a group merged on its own, drawn only when you're in it or near
  // one of its doors: cull()). Doors are gaps in every wall they sit on.
  const propMats = propMaterials(keep)
  const zones = []
  const signMats = new Map()
  const signMat = (g) => {
    if (!signMats.has(g)) {
      const tex = keep(
        canvasTexture(64, 64, (ctx, w) => {
          ctx.fillStyle = g === "f" ? "#b0306a" : g === "m" ? "#2f5fb0" : "#3a7a4a"
          ctx.fillRect(0, 0, w, w)
          ctx.fillStyle = "#ffffff"
          ctx.beginPath()
          ctx.arc(32, 15, 7, 0, Math.PI * 2)
          ctx.fill()
          if (g === "f") {
            ctx.beginPath()
            ctx.moveTo(32, 23)
            ctx.lineTo(46, 46)
            ctx.lineTo(18, 46)
            ctx.closePath()
            ctx.fill()
          } else ctx.fillRect(24, 24, 16, 22)
          ctx.fillRect(25, 46, 5, 12)
          ctx.fillRect(34, 46, 5, 12)
        })
      )
      signMats.set(g, keep(new THREE.MeshBasicMaterial({ map: tex })))
    }
    return signMats.get(g)
  }
  const frameMat = lambert(0x2e3236)
  const leafMats = new Map()
  const leafMat = (c) => {
    if (!leafMats.has(c)) leafMats.set(c, lambert(hex(c, 0x8a6a4a)))
    return leafMats.get(c)
  }
  const glassMat = keep(new THREE.MeshLambertMaterial({ color: 0xcfe6ef, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }))
  const fixtureMat = keep(new THREE.MeshBasicMaterial({ color: 0xfffbf0 }))
  // the doorway at d on the polygon's nearest edge: its frame, and a leaf by kind
  const drawDoor = (g, d, poly, h, wallColor = null) => {
    let best = null
    poly.forEach((q, i) => {
      const a = q
      const b = poly[(i + 1) % poly.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const t = Math.max(0, Math.min(1, ((d.x - a[0]) * (b[0] - a[0]) + (d.z - a[1]) * (b[1] - a[1])) / (L * L)))
      const px = a[0] + (b[0] - a[0]) * t
      const pz = a[1] + (b[1] - a[1]) * t
      const dd = Math.hypot(px - d.x, pz - d.z)
      if (!best || dd < best.dd) best = { dd, ux: (b[0] - a[0]) / L, uz: (b[1] - a[1]) / L }
    })
    if (!best || best.dd > 0.6) return
    const ry = -Math.atan2(best.uz, best.ux)
    const w = d.w || 1.8
    const top = Math.min(2.4, h - 0.1)
    const at = (s, y, n = 0) => [d.x + best.ux * s - best.uz * n, y, d.z + best.uz * s + best.ux * n]
    const piece = (geo, mat, s, y, n = 0, extraRy = 0) => {
      const m = new THREE.Mesh(keep(geo), mat)
      const [x, yy, z] = at(s, y, n)
      m.position.set(x, yy, z)
      m.rotation.y = ry + extraRy
      g.add(m)
      return m
    }
    // (the wall closes again over a doorway: a header in the wall's color; glass doors get a
    // glass transom instead)
    const header = (from) => {
      if (wallColor === null || h < from + 0.15) return
      piece(new THREE.BoxGeometry(w + 0.04, h - from, 0.3), plainMatFor(hex(wallColor, 0xece6da)), 0, from + (h - from) / 2)
    }
    if (d.kind === "closed") {
      piece(new THREE.BoxGeometry(w, top, 0.06), leafMat(d.color || "#8a6a4a"), 0, top / 2)
      return
    }
    if (d.kind === "open") {
      // an archway: a cased opening with trim, the wall over it
      for (const s of [-1, 1]) piece(new THREE.BoxGeometry(0.06, Math.min(2.9, h - 0.1), 0.32), frameMat, (s * (w + 0.06)) / 2, Math.min(2.9, h - 0.1) / 2)
      header(Math.min(2.9, h - 0.1))
      return
    }
    for (const s of [-1, 1]) piece(new THREE.BoxGeometry(0.1, top, 0.3), frameMat, (s * (w + 0.1)) / 2, top / 2)
    piece(new THREE.BoxGeometry(w + 0.3, 0.12, 0.3), frameMat, 0, top + 0.06)
    if (!(d.kind === "glass" || d.kind === "double" || d.kind === "sauna")) header(top + 0.12)
    if (d.kind === "glass" || d.kind === "double" || d.kind === "sauna") {
      // glass leaves slid / swung aside, a glass transom over the door
      for (const s of d.kind === "sauna" ? [1] : [-1, 1]) piece(new THREE.BoxGeometry(w / 2, top - 0.05, 0.03), glassMat, s * (w * 0.75), top / 2, 0.06)
      if (h > top + 0.4) piece(new THREE.BoxGeometry(w, Math.min(1.2, h - top - 0.2), 0.03), glassMat, 0, top + 0.12 + Math.min(1.2, h - top - 0.2) / 2)
    } else if (d.kind === "rollup") {
      piece(new THREE.BoxGeometry(w, 0.5, 0.35), leafMat("#c9ccd0"), 0, top - 0.25)
    } else {
      // a wooden leaf swung open against the wall, inside
      const leaf = new THREE.Mesh(keep(new THREE.BoxGeometry(Math.min(1.0, w - 0.1), top - 0.05, 0.05).translate(Math.min(1.0, w - 0.1) / 2, 0, 0)), leafMat(d.color || "#8a6a4a"))
      const [x, , z] = at(-w / 2 + 0.05, 0)
      leaf.position.set(x, top / 2, z)
      leaf.rotation.y = ry - Math.PI / 2
      g.add(leaf)
    }
    if (d.kind === "restroom" || d.sign) {
      for (const n of [0.17, -0.17]) piece(new THREE.PlaneGeometry(0.3, 0.3), signMat(d.gender || "u"), 0, 1.6 + (top > 2.3 ? 0 : 0), n, n > 0 ? 0 : Math.PI)
    }
  }
  for (const r of S.rooms || []) {
    const g = new THREE.Group()
    const H = r.h || 3.2
    const gaps = doorsOn(r.p, r.y || 0).map((d) => ({ x: d.x, z: d.z, w: d.w || 1.8 }))
    // the finishes (FINISH by type; "plain" turns one off): wood, tile, rubber, carpet, stone
    const fin = FINISH[r.type] || {}
    const floorKind = r.floorStyle === "plain" ? null : r.floorStyle || fin.floor
    const fmap = floorTexFor(floorKind)
    // (Medium/High: plank and grout joints in relief, a soft sheen that reflects the room)
    const fN = detail && fmap ? normalFor(fmap, 2) : null
    g.add(new THREE.Mesh(flat(r.p, 0.015), surfaced(std(hex(r.floor, 0xc9bda8), { roughness: floorKind === "wood" ? 0.45 : 0.6, ...(fmap ? { map: fmap } : {}), ...(fN ? { normalMap: fN } : {}), ...(detail ? { envMap: env, envMapIntensity: 0.35 } : {}) }), FLOOR_SURFACE[floorKind] || "concrete")))
    const wh = r.wainscot ? 1.1 : 0
    // (indoors the walls get the room's own light: some emissive, so a white wall reads white)
    const lit = (c, map = null) => surfaced(lambert(c, { emissive: new THREE.Color(c).multiplyScalar(0.28), ...(map ? { map, ...(detail ? { normalMap: normalFor(map, 2.5) } : {}) } : {}) }), "stucco")
    const wmap = surfaceTexFor(r.wallTex)
    if (wh) g.add(new THREE.Mesh(wallRing(r.p, 0, wh, { inward: true, gaps, offset: 0.12 }), lit(hex(r.wainscot, 0x8a8a8a), wmap)))
    g.add(new THREE.Mesh(wallRing(r.p, wh, H, { inward: true, gaps, offset: 0.12 }), lit(hex(r.wall, 0xece6da), wmap)))
    // trim: a baseboard round the floor, a chair rail on top of the wainscot (darker than the wall)
    const trimColor = r.trim ? hex(r.trim, 0x5a4a3a) : new THREE.Color(hex(r.wainscot || r.wall, 0xece6da)).multiplyScalar(0.62).getHex()
    g.add(new THREE.Mesh(wallRing(r.p, 0, 0.11, { inward: true, gaps, offset: 0.135 }), lambert(trimColor)))
    if (wh) g.add(new THREE.Mesh(wallRing(r.p, wh - 0.03, wh + 0.04, { inward: true, gaps, offset: 0.14 }), lambert(trimColor)))
    // inside a hall or a building: the partition's other side and a top (seen from the courts),
    // except along the building's own walls
    if (!r.shell) {
      const outer = [...S.buildings.map((b) => b.p), ...(S.halls || []).map((h2) => h2.p)]
      const onOuter = (a, b) => {
        const mx = (a[0] + b[0]) / 2
        const mz = (a[1] + b[1]) / 2
        return outer.some((poly) =>
          poly.some((q, i) => {
            const e = poly[(i + 1) % poly.length]
            const L2 = (e[0] - q[0]) ** 2 + (e[1] - q[1]) ** 2 || 1
            const t = Math.max(0, Math.min(1, ((mx - q[0]) * (e[0] - q[0]) + (mz - q[1]) * (e[1] - q[1])) / L2))
            return Math.hypot(q[0] + (e[0] - q[0]) * t - mx, q[1] + (e[1] - q[1]) * t - mz) < 0.35
          })
        )
      }
      g.add(new THREE.Mesh(wallRing(r.p, 0, H, { gaps, offset: 0.02, edge: (a, b) => !onOuter(a, b) }), plainMatFor(hex(r.partition, 0xe9e6df))))
      // (an `open` room has no top or ceiling: it's open to the hall above, under a mezzanine)
      if (!r.open) g.add(new THREE.Mesh(flat(r.p, H + 0.01), roofMatFor(hex(r.top, 0xcfcac0))))
    }
    // a free-standing room (not inside a building or hall) has its own outside and roof
    if (r.shell) {
      g.add(new THREE.Mesh(wallRing(r.p, 0, H + 0.4, { gaps, offset: 0.02 }), plainMatFor(hex(r.outside, 0xefece5))))
      g.add(new THREE.Mesh(flat(r.p, H + 0.4), roofMatFor(hex(r.roof, 0xd9d6cf))))
    }
    const cc = new THREE.Color(hex(r.ceiling, 0xf2f0ea))
    const ceilKind = r.ceilingStyle === "plain" ? null : r.ceilingStyle || fin.ceiling
    const cmap = floorTexFor(ceilKind)
    if (!r.open) g.add(new THREE.Mesh(flatDown(r.p, H - 0.02), lambert(cc.getHex(), { emissive: cc.clone().multiplyScalar(0.3), ...(cmap ? { map: cmap } : {}) })))
    // ceiling lights every few metres: panels in a grid ceiling, strips in gyms and halls,
    // pendants over a cafe's, bar's or lounge's tables (none in an open room: the hall lights it)
    const R = r.open ? null : roomRect(r.p)
    if (R) {
      const strip = r.type === "gym" || r.type === "hall" || r.type === "corridor" || r.type === "studio"
      const hang = r.type === "cafe" || r.type === "bar" || r.type === "lounge"
      const shadeMat = hang ? lambert(hex(r.accent, 0x1d1f22), { side: THREE.DoubleSide }) : null
      for (let u = R.u0 + 1.6; u < R.u1 - 1; u += strip ? 4 : 2.6)
        for (let w = R.w0 + 1.4; w < R.w1 - 1; w += 2.6) {
          const x = u * R.ux - w * R.uz
          const z = u * R.uz + w * R.ux
          if (!pointInPoly(x, z, r.p)) continue
          if (hang) {
            const cord = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.008, 0.008, 0.7, 4)), frameMat)
            cord.position.set(x, H - 0.35, z)
            const shade = new THREE.Mesh(keep(new THREE.ConeGeometry(0.24, 0.22, 12, 1, true)), shadeMat)
            shade.position.set(x, H - 0.8, z)
            const bulb = new THREE.Mesh(keep(new THREE.SphereGeometry(0.07, 8, 6)), fixtureMat)
            bulb.position.set(x, H - 0.88, z)
            g.add(cord, shade, bulb)
            continue
          }
          const f = new THREE.Mesh(keep(new THREE.BoxGeometry(strip ? 2.4 : 0.6, 0.04, strip ? 0.25 : 0.6)), fixtureMat)
          f.position.set(x, H - 0.05, z)
          f.rotation.y = -Math.atan2(R.uz, R.ux)
          g.add(f)
        }
    }
    for (const d of doorsOn(r.p, r.y || 0)) drawDoor(g, d, r.p, H, r.wall || "#ece6da")
    for (const d of (r.doors || []).filter((d) => d.kind === "closed")) drawDoor(g, d, r.p, H, r.wall || "#ece6da")
    // (a room upstairs: the whole room lifted to its floor; its furniture's heights are the
    // venue's, so they come back down by as much inside the lifted group)
    const ry = r.y || 0
    g.position.y = ry
    addProps(g, ry ? (r.props || []).map((pr) => ({ ...pr, y: (pr.y || 0) - ry })) : r.props || [], propMats, keep)
    zones.push({ group: g, poly: r.p, doors: doorsOn(r.p, ry), h: H, y: ry, id: r.id, type: r.type })
  }
  // ---------- floors above the ground: decks (railings, a slab under a mezzanine) and stairs ----------
  const railMats = new Map()
  const railMatFor = (c) => {
    if (!railMats.has(c)) railMats.set(c, lambert(hex(c, 0xf2f2ee)))
    return railMats.get(c)
  }
  for (const d of S.decks || []) {
    if (d.slab) {
      const slab = new THREE.Mesh(flat(d.p, d.y), surfaced(std(hex(d.color, 0xb78a52), { roughness: 0.6 }), "deck"))
      group.add(slab)
      const under = new THREE.Mesh(flatDown(d.p, d.y - 0.28), lambert(0x2c2a2e))
      group.add(under)
      group.add(new THREE.Mesh(wallRing(d.p, d.y - 0.3, d.y + 0.02, {}), plainMatFor(hex(d.railColor, 0x3a3e44))))
    }
    if (!d.rail) continue
    // posts every 1.6 m and a top rail, open where the stairs arrive
    const mat = railMatFor(d.railColor || "#f2f2ee")
    const openings = [...(S.stairs || []).filter((s) => Math.abs(s.y1 - d.y) < 0.3).map((s) => ({ x: s.b.x, z: s.b.z, w: s.w + 0.5 })), ...(d.openings || []).map((o) => ({ x: o[0], z: o[1], w: o[2] || 1.6 }))]
    for (let i = 0; i < d.p.length; i++) {
      const a = d.p[i]
      const b = d.p[(i + 1) % d.p.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 0.2) continue
      const u = { x: (b[0] - a[0]) / L, z: (b[1] - a[1]) / L }
      let runs = [[0, L]]
      for (const o of openings) {
        const cut = doorCut({ x: a[0], z: a[1] }, u, L, o)
        if (cut) runs = runs.flatMap(([s0, e0]) => [[s0, Math.min(e0, cut[0])], [Math.max(s0, cut[1]), e0]]).filter(([s0, e0]) => e0 - s0 > 0.05)
      }
      for (const [s0, e0] of runs) {
        const m = (s0 + e0) / 2
        const top = new THREE.Mesh(keep(new THREE.BoxGeometry(e0 - s0, 0.06, 0.06)), mat)
        top.position.set(a[0] + u.x * m, d.y + 1.05, a[1] + u.z * m)
        top.rotation.y = -Math.atan2(u.z, u.x)
        group.add(top)
        // glass infill between the posts (a terrace's see-through railing)
        const glass = new THREE.Mesh(keep(new THREE.PlaneGeometry(e0 - s0, 0.9)), glassMat)
        glass.position.set(a[0] + u.x * m, d.y + 0.55, a[1] + u.z * m)
        glass.rotation.y = -Math.atan2(u.z, u.x)
        glass.renderOrder = 1
        group.add(glass)
        for (let s = s0; s <= e0 + 1e-6; s += Math.max(0.4, (e0 - s0) / Math.max(1, Math.round((e0 - s0) / 1.6)))) {
          const post = new THREE.Mesh(keep(new THREE.BoxGeometry(0.06, 1.05, 0.06)), mat)
          post.position.set(a[0] + u.x * s, d.y + 0.525, a[1] + u.z * s)
          group.add(post)
        }
      }
    }
  }
  for (const s of S.stairs || []) {
    // steps (0.18 m risers), a stringer each side, a handrail
    const dx = s.b.x - s.a.x
    const dz = s.b.z - s.a.z
    const L = Math.hypot(dx, dz) || 1
    const ux = dx / L
    const uz = dz / L
    const rise = s.y1 - s.y0
    const n = Math.max(2, Math.round(rise / 0.18))
    const ry = -Math.atan2(uz, ux)
    const stepMat = std(hex(s.color, 0xcfc8b8), { roughness: 0.7 })
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n
      const hTop = s.y0 + (rise * (k + 1)) / n
      const step = new THREE.Mesh(keep(new THREE.BoxGeometry(L / n + 0.02, Math.max(0.08, hTop - (s.y0 + (rise * k) / n) + 0.04), s.w)), stepMat)
      step.position.set(s.a.x + ux * L * t, hTop - (hTop - (s.y0 + (rise * k) / n)) / 2, s.a.z + uz * L * t)
      step.rotation.y = ry
      group.add(step)
    }
    const railMat = railMatFor(s.rail || "#2b2f36")
    for (const sg of [-1, 1]) {
      const nx = -uz * sg * (s.w / 2 + 0.08)
      const nz = ux * sg * (s.w / 2 + 0.08)
      // the stringer: a slanted plate from the bottom to the top
      const len = Math.hypot(L, rise)
      const pitch = Math.atan2(rise, L)
      const str = new THREE.Mesh(keep(new THREE.BoxGeometry(len, 0.3, 0.06)), railMat)
      str.position.set(s.a.x + ux * L * 0.5 + nx, s.y0 + rise * 0.5, s.a.z + uz * L * 0.5 + nz)
      str.rotation.set(0, ry, pitch, "YXZ")
      group.add(str)
      const hand = new THREE.Mesh(keep(new THREE.BoxGeometry(len, 0.05, 0.05)), railMat)
      hand.position.set(s.a.x + ux * L * 0.5 + nx, s.y0 + rise * 0.5 + 0.95, s.a.z + uz * L * 0.5 + nz)
      hand.rotation.set(0, ry, pitch, "YXZ")
      group.add(hand)
      for (const t of [0.02, 0.5, 0.98]) {
        const post = new THREE.Mesh(keep(new THREE.BoxGeometry(0.05, 0.95, 0.05)), railMat)
        post.position.set(s.a.x + ux * L * t + nx, s.y0 + rise * t + 0.475, s.a.z + uz * L * t + nz)
        group.add(post)
      }
    }
  }
  // the venue's own props (outdoors): with everything else
  addProps(group, S.props || [], propMats, keep)
  // the doors of buildings you can walk into (their frames and leaves, outside the rooms)
  const roomDoors = zones.flatMap((z) => z.doors)
  for (const b of S.buildings)
    if (b.doors)
      for (const d of doorsOn(b.p)) {
        const bc = hex(b.c, WALLS[b.k || "yes"] ?? WALLS.yes)
        if (!roomDoors.includes(d)) drawDoor(group, d, b.p, b.h, bc)
        else {
          // (a room's door in the building's outside wall: the room closes it to its ceiling,
          // the building's wall closes it from there up)
          const room = zones.find((z) => z.doors.includes(d))
          const from = room ? room.h : 3.2
          if (b.h > from + 0.1) {
            let best = null
            b.p.forEach((a, i) => {
              const e = b.p[(i + 1) % b.p.length]
              const L = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1
              const t = Math.max(0, Math.min(1, ((d.x - a[0]) * (e[0] - a[0]) + (d.z - a[1]) * (e[1] - a[1])) / (L * L)))
              const dd = Math.hypot(a[0] + (e[0] - a[0]) * t - d.x, a[1] + (e[1] - a[1]) * t - d.z)
              if (!best || dd < best.dd) best = { dd, ux: (e[0] - a[0]) / L, uz: (e[1] - a[1]) / L }
            })
            const head = new THREE.Mesh(keep(new THREE.BoxGeometry((d.w || 1.8) + 0.05, b.h - from, 0.36)), plainMatFor(bc))
            head.position.set(d.x, from + (b.h - from) / 2, d.z)
            head.rotation.y = -Math.atan2(best.uz, best.ux)
            group.add(head)
          }
        }
      }

  // ---------- the halls: inside ----------
  const lightRows = []
  const hallDoorsDrawn = new Set()
  for (const h of S.halls || []) {
    const p = h.p
    const H = h.h || 9
    // the floor
    const floor = new THREE.Mesh(flat(p, 0.002), std(hex(h.floor, 0x3d4552), { roughness: 0.6 }))
    group.add(floor)
    // the inside of the walls: pale above, padding below; the ceiling, facing down
    const gap = h.doorAt ? { x: h.doorAt.x, z: h.doorAt.z, w: h.doorAt.w } : null
    const hallGaps = [...(gap ? [gap] : []), ...doorsOn(p).map((d) => ({ x: d.x, z: d.z, w: d.w || 1.8 }))]
    const padH = h.padH || 2.2
    // (one-sided: from outside, in a cutaway, you see through them; quilted blankets, cinder
    // block, panels: a texture tinted by the color)
    // (Medium/High: a hall without its own finishes gets padded panels below, insulated panels above)
    const padMap = surfaceTexFor(h.padTex || h.wallTex || (detail ? "pad" : null))
    const wallMap = surfaceTexFor(h.wallTex || (detail ? "panel" : null))
    // (Medium/High: the quilting, block joints and panel seams in relief)
    const padN = detail && padMap ? normalFor(padMap, 3) : null
    const wallN = detail && wallMap ? normalFor(wallMap, 2.5) : null
    const hallPadMat = surfaced(lambert(hex(h.pads, 0x1d2f5a), padMap ? { map: padMap, ...(padN ? { normalMap: padN } : {}) } : {}), "fabric")
    const hallWallMat = surfaced(lambert(hex(h.wall, 0xd9d4c8), wallMap ? { map: wallMap, ...(wallN ? { normalMap: wallN } : {}) } : {}), h.wallTex === "block" ? "concrete" : "stucco")
    group.add(new THREE.Mesh(wallRing(p, 0, padH, { inward: true, gaps: cutaway ? null : hallGaps, offset: 0.12 }), hallPadMat))
    group.add(new THREE.Mesh(wallRing(p, padH, H, { inward: true, gaps: cutaway ? null : hallGaps, offset: 0.12 }), hallWallMat))
    // the extra doors (to the street, the next hall): frames and leaves (once for a door two
    // halls share), and on each hall's own side the wall closing again over it, in that hall's
    // finish (so a black hall and a white one each keep their look over a shared door)
    const hc = { x: p.reduce((s, q) => s + q[0], 0) / p.length, z: p.reduce((s, q) => s + q[1], 0) / p.length }
    for (const d of doorsOn(p)) {
      if (roomDoors.includes(d)) continue
      if (!hallDoorsDrawn.has(d)) {
        hallDoorsDrawn.add(d)
        if (!cutaway) drawDoor(group, d, p, Math.min(H, 3.2))
      }
      const top = d.kind === "open" ? 3.0 : 2.4
      if (H <= top + 0.1 || cutaway) continue
      let best = null
      p.forEach((a, i) => {
        const b = p[(i + 1) % p.length]
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
        const t = Math.max(0, Math.min(1, ((d.x - a[0]) * (b[0] - a[0]) + (d.z - a[1]) * (b[1] - a[1])) / (L * L)))
        const dd = Math.hypot(a[0] + (b[0] - a[0]) * t - d.x, a[1] + (b[1] - a[1]) * t - d.z)
        if (!best || dd < best.dd) best = { dd, ux: (b[0] - a[0]) / L, uz: (b[1] - a[1]) / L }
      })
      let nx = -best.uz
      let nz = best.ux
      if (nx * (hc.x - d.x) + nz * (hc.z - d.z) < 0) [nx, nz] = [-nx, -nz]
      const w = (d.w || 1.8) + 0.04
      for (const [y0, y1, mat] of [
        [top, Math.min(padH, H), hallPadMat],
        [Math.max(top, padH), H, hallWallMat],
      ]) {
        if (y1 - y0 < 0.05) continue
        const geo = new THREE.PlaneGeometry(w, y1 - y0)
        // (uv in 3 m tiles like the wall round it)
        const uv = geo.attributes.uv
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 3, (y0 + uv.getY(i) * (y1 - y0)) / 3)
        const head = new THREE.Mesh(keep(geo), mat)
        head.position.set(d.x + nx * 0.121, (y0 + y1) / 2, d.z + nz * 0.121)
        head.rotation.y = Math.atan2(nx, nz)
        group.add(head)
      }
    }
    // outside: over every door in an outside wall (a hall's or a room's), the wall closes again
    if (!cutaway) {
      const outsideMat = wallMatFor(hex(h.outside, WALLS.hall), true)
      const onPoly = (poly, d) =>
        poly.some((q, i) => {
          const b = poly[(i + 1) % poly.length]
          const L2 = (b[0] - q[0]) ** 2 + (b[1] - q[1]) ** 2 || 1
          const t = Math.max(0, Math.min(1, ((d.x - q[0]) * (b[0] - q[0]) + (d.z - q[1]) * (b[1] - q[1])) / L2))
          return Math.hypot(q[0] + (b[0] - q[0]) * t - d.x, q[1] + (b[1] - q[1]) * t - d.z) < 0.5
        })
      for (const d of doorsOn(p)) {
        if ((S.halls || []).some((h2) => h2 !== h && onPoly(h2.p, d))) continue
        let best = null
        p.forEach((a, i) => {
          const b = p[(i + 1) % p.length]
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
          const t = Math.max(0, Math.min(1, ((d.x - a[0]) * (b[0] - a[0]) + (d.z - a[1]) * (b[1] - a[1])) / (L * L)))
          const dd = Math.hypot(a[0] + (b[0] - a[0]) * t - d.x, a[1] + (b[1] - a[1]) * t - d.z)
          if (!best || dd < best.dd) best = { dd, ux: (b[0] - a[0]) / L, uz: (b[1] - a[1]) / L }
        })
        let nx = -best.uz
        let nz = best.ux
        if (nx * (hc.x - d.x) + nz * (hc.z - d.z) > 0) [nx, nz] = [-nx, -nz]
        const top = 2.45
        const w = (d.w || 1.8) + 0.04
        const geo = new THREE.PlaneGeometry(w, H - top)
        const uv = geo.attributes.uv
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 3, (top + uv.getY(i) * (H - top)) / 3)
        const head = new THREE.Mesh(keep(geo), outsideMat)
        head.position.set(d.x + nx * 0.021, top + (H - top) / 2, d.z + nz * 0.021)
        head.rotation.y = Math.atan2(nx, nz)
        group.add(head)
      }
    }
    // (the outside walls: cut for the doors too)
    if (!cutaway) group.add(new THREE.Mesh(wallRing(p, 0, H, { gaps: hallGaps, offset: 0.02 }), lambert(hex(h.outside, WALLS.hall), { map: ribsTex })))
    // (over the door: the wall closes again above 3.2 m; a listed door there closes itself)
    if (gap && !cutaway && !doorsOn(p).some((d) => Math.hypot(d.x - gap.x, d.z - gap.z) < 0.6)) {
      const a = p[h.doorAt.i]
      const b = p[(h.doorAt.i + 1) % p.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      const ux = (b[0] - a[0]) / L
      const uz = (b[1] - a[1]) / L
      const s0 = h.doorAt.t * L - gap.w / 2
      const lintel = [
        [a[0] + ux * s0, a[1] + uz * s0],
        [a[0] + ux * (s0 + gap.w), a[1] + uz * (s0 + gap.w)],
      ]
      const lg = new THREE.Mesh(keep(new THREE.BoxGeometry(gap.w, H - 3.2, 0.3)), wallMatFor(hex(h.outside, WALLS.hall), true))
      lg.position.set((lintel[0][0] + lintel[1][0]) / 2, 3.2 + (H - 3.2) / 2, (lintel[0][1] + lintel[1][1]) / 2)
      lg.rotation.y = -Math.atan2(uz, ux)
      group.add(lg)
    }
    // (facing down it only gets the ground's fill light: a little of its own so its color reads)
    const ceilColor = new THREE.Color(hex(h.ceiling, 0xc8ccd2))
    // (Medium/High: a ceiling grid of insulated panels, seams in relief)
    const ceilMap = detail ? floorTexFor("grid") : null
    const ceil = new THREE.Mesh(flatDown(p, H - 0.05), lambert(ceilColor.getHex(), { emissive: ceilColor.clone().multiplyScalar(0.35), ...(ceilMap ? { map: ceilMap, normalMap: normalFor(ceilMap, 2) } : {}) }))
    group.add(ceil)
    // the door: a frame and a lit sign over it (unless a room's or the hall's own listed door
    // is there and draws its own)
    if (h.doorAt && !cutaway && !doorsOn(p).some((d) => Math.hypot(d.x - h.doorAt.x, d.z - h.doorAt.z) < 0.6)) {
      const a = p[h.doorAt.i]
      const b = p[(h.doorAt.i + 1) % p.length]
      const ry = -Math.atan2(b[1] - a[1], b[0] - a[0])
      const frame = new THREE.Mesh(keep(new THREE.BoxGeometry(h.doorAt.w + 0.3, 0.25, 0.3)), lambert(0x2b2f36))
      frame.position.set(h.doorAt.x, 3.0, h.doorAt.z)
      frame.rotation.y = ry
      group.add(frame)
      for (const d of [-1, 1]) {
        const post = new THREE.Mesh(keep(new THREE.BoxGeometry(0.15, 3.0, 0.3)), lambert(0x2b2f36))
        const ux = (b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1])
        const uz = (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1])
        post.position.set(h.doorAt.x + ux * d * (h.doorAt.w / 2 + 0.1), 1.5, h.doorAt.z + uz * d * (h.doorAt.w / 2 + 0.1))
        post.rotation.y = ry
        group.add(post)
      }
    }
    // rows of high-bay lights and a few roof trusses, along the hall's longest side
    let best = 0
    let axis = { x: 1, z: 0 }
    for (let i = 0; i < p.length; i++) {
      const a = p[i]
      const b = p[(i + 1) % p.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L > best) {
        best = L
        axis = { x: (b[0] - a[0]) / L, z: (b[1] - a[1]) / L }
      }
    }
    const perp = { x: -axis.z, z: axis.x }
    const xs = p.map(([x, z]) => x * axis.x + z * axis.z)
    const zs = p.map(([x, z]) => x * perp.x + z * perp.z)
    const u0 = Math.min(...xs)
    const u1 = Math.max(...xs)
    const w0 = Math.min(...zs)
    const w1 = Math.max(...zs)
    const strip = h.lightsStyle === "strip"
    const roundLamp = h.lightsStyle === "round"
    for (let a = u0 + 4; a < u1 - 2; a += strip ? 9 : 6)
      for (let c = w0 + 4; c < w1 - 2; c += strip ? 5 : roundLamp ? 6 : 7) {
        const x = axis.x * a + perp.x * c
        const z = axis.z * a + perp.z * c
        if (pointInPoly(x, z, p)) lightRows.push({ x, z, y: H - (roundLamp ? 1.4 : 0.6), ry: yawFor(axis.x, axis.z), strip, round: roundLamp })
      }
    // ducts along the hall, under the roof
    if (h.ducts) {
      const ductMat = lambert(hex(h.ducts, 0xb9bcc0))
      for (const c of [w0 + 2.5, w1 - 2.5]) {
        const L = u1 - u0 - 3
        const d = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.35, 0.35, L, 10).rotateZ(Math.PI / 2)), ductMat)
        const cu = (u0 + u1) / 2
        d.position.set(axis.x * cu + perp.x * c, H - 1.2, axis.z * cu + perp.z * c)
        d.rotation.y = yawFor(axis.x, axis.z)
        group.add(d)
      }
    }
    // steel columns
    if (h.columns) {
      const colMat = lambert(0x151515)
      const n = h.columns.n || 4
      for (let k = 0; k < n; k++) {
        const t = n > 1 ? k / (n - 1) : 0.5
        const cxx = h.columns.from[0] + (h.columns.to[0] - h.columns.from[0]) * t
        const czz = h.columns.from[1] + (h.columns.to[1] - h.columns.from[1]) * t
        const col = new THREE.Mesh(keep(new THREE.BoxGeometry(0.28, H, 0.28)), colMat)
        col.position.set(cxx, H / 2, czz)
        group.add(col)
      }
    }
    const trussMat = lambert(hex(h.beams, 0x3a3d42))
    if (h.trusses === "grid") {
      // an open-web truss grid (sound stages): top and bottom chords with a web, every 6 m
      // both ways, and the hangers for the lamps
      const web = []
      const chord = (from, to, at, alongAxis) => {
        const L = to - from
        for (const yy of [H - 0.25, H - 1.15]) web.push({ along: alongAxis, c: at, m: (from + to) / 2, L, y: yy, s: 0.12 })
        for (let k = from + 0.6; k < to; k += 1.2) web.push({ along: alongAxis, c: at, m: k, L: 1.1, y: H - 0.7, s: 0.05, diag: true })
      }
      for (let a = u0 + 3; a < u1 - 1; a += 6) chord(w0 + 0.3, w1 - 0.3, a, false)
      for (let c = w0 + 3; c < w1 - 1; c += 6) chord(u0 + 0.3, u1 - 0.3, c, true)
      const inst = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1, 1, 1)), trussMat, web.length)
      web.forEach((t, i) => {
        // (along the hall's axis: runs along u at w = c; else along w at u = c)
        const cx = t.along ? axis.x * t.m + perp.x * t.c : axis.x * t.c + perp.x * t.m
        const cz = t.along ? axis.z * t.m + perp.z * t.c : axis.z * t.c + perp.z * t.m
        const ry = yawFor(axis.x, axis.z) + (t.along ? 0 : Math.PI / 2)
        inst.setMatrixAt(i, m4.compose(v1.set(cx, t.y, cz), q.setFromEuler(e1.set(t.diag ? 0.9 : 0, ry, 0, "YXZ")), v2.set(t.L, t.s * (t.diag ? 1 : 1.4), t.s)))
      })
      group.add(inst)
    } else {
      for (let a = u0 + 6; a < u1 - 3; a += 12) {
        const L = w1 - w0
        const t = new THREE.Mesh(keep(new THREE.BoxGeometry(0.25, 0.5, L - 0.6)), trussMat)
        const cw = (w0 + w1) / 2
        t.position.set(axis.x * a + perp.x * cw, H - 0.35, axis.z * a + perp.z * cw)
        t.rotation.y = yawFor(axis.x, axis.z)
        group.add(t)
      }
    }
  }
  let hallLampMat = null
  // a soft glow round every hall light (one draw)
  if (detail && lightRows.length) buildGlow(group, lightRows.map((l) => ({ x: l.x, y: l.y, z: l.z })), { keep, size: lightRows[0]?.round ? 1.6 : 2.4 })
  if (lightRows.length) {
    hallLampMat = keep(new THREE.MeshBasicMaterial({ color: 0xfff8e8 }))
    const boxes = lightRows.filter((l) => !l.round)
    const rounds = lightRows.filter((l) => l.round)
    if (boxes.length) {
      const lamps = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1.4, 0.12, 0.5)), hallLampMat, boxes.length)
      boxes.forEach((l, i) => lamps.setMatrixAt(i, m4.compose(v1.set(l.x, l.y, l.z), q.setFromEuler(e1.set(0, l.ry, 0)), v2.set(l.strip ? 4.5 : 1, 1, l.strip ? 0.3 : 1))))
      group.add(lamps)
    }
    if (rounds.length) {
      // round LED high-bays: a dark housing, the lit face underneath, hung on a rod
      const housing = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.28, 0.36, 0.22, 12)), lambert(0x1c1d20), rounds.length)
      const face = new THREE.InstancedMesh(keep(new THREE.CircleGeometry(0.33, 12).rotateX(Math.PI / 2)), hallLampMat, rounds.length)
      const rod = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 4)), lambert(0x1c1d20), rounds.length)
      rounds.forEach((l, i) => {
        housing.setMatrixAt(i, m4.makeTranslation(l.x, l.y + 0.11, l.z))
        face.setMatrixAt(i, m4.makeTranslation(l.x, l.y - 0.005, l.z))
        rod.setMatrixAt(i, m4.makeTranslation(l.x, l.y + 0.8, l.z))
      })
      group.add(housing, face, rod)
    }
  }

  // ---------- the bar (a social club) ----------
  const bar = S.bar
  const tvs = []
  if (bar) {
    const g = new THREE.Group()
    g.position.set(bar.x, 0, bar.z)
    g.rotation.y = yawFor(bar.u.x, bar.u.z)
    const wood = lambert(hex(bar.color, 0x6b4a2b))
    const counter = new THREE.Mesh(keep(new THREE.BoxGeometry(bar.len, 1.05, 0.7)), wood)
    counter.position.set(0, 0.525, 0)
    g.add(counter)
    const top = new THREE.Mesh(keep(new THREE.BoxGeometry(bar.len + 0.2, 0.06, 0.85)), lambert(0x2a2622))
    top.position.set(0, 1.08, 0)
    g.add(top)
    // the back bar: shelves of bottles, a mirror strip
    const back = new THREE.Mesh(keep(new THREE.BoxGeometry(bar.len, 2.2, 0.4)), lambert(0x3b2a1e))
    back.position.set(0, 1.1, -(bar.depth || 3) + 0.4)
    g.add(back)
    const mirror = new THREE.Mesh(keep(new THREE.PlaneGeometry(bar.len - 0.6, 0.8)), lambert(0x9fb7c4, { emissive: 0x1a2a33 }))
    mirror.position.set(0, 1.6, -(bar.depth || 3) + 0.61)
    g.add(mirror)
    const bottles = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.04, 0.045, 0.28, 6)), lambert(0xffffff), 60)
    const bc = new THREE.Color()
    for (let i = 0; i < 60; i++) {
      bottles.setMatrixAt(i, m4.makeTranslation(-bar.len / 2 + 0.4 + (i % 30) * ((bar.len - 0.8) / 29), 1.05 + Math.floor(i / 30) * 0.5, -(bar.depth || 3) + 0.68))
      bottles.setColorAt(i, bc.setHSL(rand(), 0.5, 0.35 + rand() * 0.3))
    }
    g.add(bottles)
    // stools (seats are layout.js seats; these are just the stools)
    const stoolMat = lambert(0x2b2f36)
    const stoolTop = lambert(0xb23a2e)
    const n = Math.max(2, Math.min(14, bar.stools || 8))
    for (let k = 0; k < n; k++) {
      const along = -bar.len / 2 + 0.6 + (k * (bar.len - 1.2)) / Math.max(1, n - 1)
      const leg = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.04, 0.12, 0.7, 6)), stoolMat)
      leg.position.set(along, 0.35, 0.85)
      g.add(leg)
      const seat = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 10)), stoolTop)
      seat.position.set(along, 0.72, 0.85)
      g.add(seat)
    }
    group.add(g)
    // tables (round) with chairs
    const tableMat = lambert(0x3a3330)
    const chairMat = lambert(0x5a6470)
    for (const t of bar.tableSpots || []) {
      const top2 = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 14)), tableMat)
      top2.position.set(t.x, 0.75, t.z)
      group.add(top2)
      const stem = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.06, 0.25, 0.75, 8)), tableMat)
      stem.position.set(t.x, 0.375, t.z)
      group.add(stem)
      for (const s of [-1, 1]) {
        const ch = new THREE.Mesh(keep(new THREE.BoxGeometry(0.42, 0.45, 0.42)), chairMat)
        ch.position.set(t.x + bar.u.x * s * 0.8, 0.225, t.z + bar.u.z * s * 0.8)
        group.add(ch)
      }
    }
    // TVs over the bar (their own canvas: scores and the club's name)
    for (let k = 0; k < Math.min(4, bar.tv || 0); k++) {
      const canvas = document.createElement("canvas")
      canvas.width = 256
      canvas.height = 144
      const ctx = canvas.getContext("2d")
      const grd = ctx.createLinearGradient(0, 0, 0, 144)
      grd.addColorStop(0, "#0e2a5a")
      grd.addColorStop(1, "#071530")
      ctx.fillStyle = grd
      ctx.fillRect(0, 0, 256, 144)
      ctx.fillStyle = "#ffd23f"
      ctx.font = "bold 26px Arial, sans-serif"
      ctx.textAlign = "center"
      ctx.fillText(["PICKLE TV", "TONIGHT: LADDER", "HAPPY HOUR", "DINK RESPONSIBLY"][k % 4], 128, 60)
      ctx.fillStyle = "#ffffff"
      ctx.font = "bold 20px Arial, sans-serif"
      ctx.fillText(["11 - 9", "4.0+ OPEN PLAY", "4 - 6 PM", "98ISH"][k % 4], 128, 100)
      const tex = keep(new THREE.CanvasTexture(canvas))
      tex.colorSpace = THREE.SRGBColorSpace
      const tv = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.6, 0.9)), keep(new THREE.MeshBasicMaterial({ map: tex })))
      const along = -bar.len / 2 + (bar.len * (k + 0.5)) / Math.min(4, bar.tv)
      tv.position.set(bar.x + bar.u.x * along - bar.w.x * ((bar.depth || 3) - 0.75), 2.7, bar.z + bar.u.z * along - bar.w.z * ((bar.depth || 3) - 0.75))
      tv.rotation.y = Math.atan2(bar.w.x, bar.w.z)
      tv.renderOrder = 0.5
      group.add(tv)
      tvs.push(tv)
    }
  }

  // ---------- trees ----------
  const byKind = { broadleaf: [], palm: [], conifer: [], eucalyptus: [] }
  for (const t of S.trees) (byKind[t.kind] || byKind.broadleaf).push(t)
  // backdrop palms / trees beyond the walkable area
  const bd = S.backdrop || {}
  const ring = (n, r0, r1) => {
    const out = []
    const cx = (B.x0 + B.x1) / 2
    const cz = (B.z0 + B.z1) / 2
    const R = Math.hypot(B.x1 - B.x0, B.z1 - B.z0) / 2
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2
      const r = R + r0 + rand() * (r1 - r0)
      out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r })
    }
    return out
  }
  for (const p of ring(bd.palms || 0, 10, 70)) byKind.palm.push({ ...p, s: 0.9 + rand() * 0.5 })
  for (const p of ring(bd.trees ?? (S.indoor ? 6 : 24), 8, 80)) byKind[bd.treeKind || "broadleaf"].push({ ...p, s: 0.8 + rand() * 0.6 })
  const trunkMat = lambert(0x6b4a2b)
  if (detail) buildTrees(group, byKind, { keep, rand })
  if (!detail && (byKind.broadleaf.length || byKind.eucalyptus.length)) {
    const list = [...byKind.broadleaf, ...byKind.eucalyptus]
    const crown = new THREE.InstancedMesh(keep(new THREE.IcosahedronGeometry(1.6, 0)), lambert(0xffffff, { flatShading: true }), list.length)
    const trunk = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.18, 0.25, 2, 5)), trunkMat, list.length)
    const cc = new THREE.Color()
    list.forEach((t, i) => {
      const euc = byKind.eucalyptus.includes(t)
      const s = t.s * (euc ? 1.3 : 1)
      crown.setMatrixAt(i, m4.compose(v1.set(t.x, 2.6 * s + 1 + (euc ? 1.5 : 0), t.z), q.setFromEuler(e1.set(0, t.x, 0)), v2.set(s, s * (euc ? 1.6 : 1.25), s)))
      crown.setColorAt(i, cc.set(euc ? 0x6f8f6a : 0x2f7a3c).offsetHSL(0, 0, (rand() - 0.5) * 0.06))
      trunk.setMatrixAt(i, m4.compose(v1.set(t.x, s * (euc ? 1.6 : 1), t.z), q.identity(), v2.set(s, s * (euc ? 1.6 : 1), s)))
    })
    group.add(crown, trunk)
  }
  if (!detail && byKind.palm.length) {
    // a tall thin trunk and a crown of drooping fronds (instanced: 6 fronds a palm)
    const P = byKind.palm
    const ptrunk = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.16, 0.24, 1, 6).translate(0, 0.5, 0)), lambert(0x8b7355), P.length)
    const frondGeo = keep(new THREE.BoxGeometry(2.4, 0.05, 0.5).translate(1.2, 0, 0))
    const fronds = new THREE.InstancedMesh(frondGeo, lambert(0x3f7f3a, { flatShading: true }), P.length * 6)
    const tip = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.45, 5, 3)), lambert(0x4b6b30), P.length)
    P.forEach((t, i) => {
      const h = (7 + rand() * 6) * t.s
      ptrunk.setMatrixAt(i, m4.compose(v1.set(t.x, 0, t.z), q.identity(), v2.set(t.s, h, t.s)))
      tip.setMatrixAt(i, m4.makeTranslation(t.x, h, t.z))
      for (let k = 0; k < 6; k++) {
        q.setFromEuler(e1.set(0, (k / 6) * Math.PI * 2 + i, -0.45 - rand() * 0.3, "YXZ"))
        fronds.setMatrixAt(i * 6 + k, m4.compose(v1.set(t.x, h, t.z), q, v2.set(t.s, 1, t.s)))
      }
    })
    group.add(ptrunk, fronds, tip)
  }
  if (!detail && byKind.conifer.length) {
    const list = byKind.conifer
    const cone = new THREE.InstancedMesh(keep(new THREE.ConeGeometry(1.5, 4.2, 7)), lambert(0x2e5a45, { flatShading: true }), list.length)
    const trunk = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.16, 0.22, 1.6, 5)), trunkMat, list.length)
    list.forEach((t, i) => {
      cone.setMatrixAt(i, m4.compose(v1.set(t.x, 1.6 * t.s + 2.1 * t.s, t.z), q.identity(), v2.set(t.s, t.s, t.s)))
      trunk.setMatrixAt(i, m4.compose(v1.set(t.x, 0.8 * t.s, t.z), q.identity(), v2.set(t.s, t.s, t.s)))
    })
    group.add(cone, trunk)
  }

  // ---------- cars in the lots ----------
  const cars = []
  // in the stalls (lotStalls), about half full on a weekday (a lot's `full` sets it); the
  // stalls by where you arrive stay free; cars sit a little off-centre in their stall
  for (const a of S.areas) {
    if (a.k !== "parking" || cars.length > 420) continue
    const spawn = L.SPAWN || { x: 1e9, z: 1e9 }
    for (const s of lotStalls(a.p).stalls) {
      if (cars.length > 420) break
      if (Math.hypot(s.x - spawn.x, s.z - spawn.z) < 12 || rand() > (a.full ?? 0.5)) continue
      const j = (rand() - 0.5) * 0.3
      cars.push({ x: s.x + j * Math.cos(s.yaw), z: s.z - j * Math.sin(s.yaw), yaw: s.yaw + (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.06, c: rand() })
    }
  }
  const palette = [0xf2f2f2, 0xf2f2f2, 0xecebe6, 0xf6f6f4, 0x1d1f22, 0x1d1f22, 0x26282c, 0x5f646a, 0x6e7378, 0x8a9096, 0xb8bcc0, 0xc8ccd0, 0xaeb3b8, 0x1e3a6b, 0x2c5aa0, 0x8a1e22, 0xb0302a, 0x3d5a40, 0xc9b38a, 0x5a3a2a]
  if (detail && cars.length) buildCars(group, cars, palette, { keep, rand })
  if (!detail && cars.length) {
    const body = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1.8, 0.75, 4.3).translate(0, 0.55, 0)), lambert(0xffffff), cars.length)
    const cab = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1.6, 0.6, 2.2).translate(0, 1.2, -0.2)), lambert(0x2a3540), cars.length)
    // (white, black, grey, silver most of all; a few blues, reds and others: palette above)
    const cc = new THREE.Color()
    cars.forEach((c, i) => {
      m4.compose(v1.set(c.x, 0, c.z), q.setFromEuler(e1.set(0, c.yaw, 0)), v2.set(1, 1, 1))
      body.setMatrixAt(i, m4)
      cab.setMatrixAt(i, m4)
      body.setColorAt(i, cc.setHex(palette[Math.floor(c.c * palette.length)]))
    })
    group.add(body, cab)
  }

  // ---------- decals (Medium/High): wear on the courts, oil and cracks in the lots, leaves ----------
  if (detail) {
    const lots = S.areas.filter((a) => a.k === "parking").map((a) => a.p)
    const stalls = lots.flatMap((p) => lotStalls(p).stalls)
    const plan = planDecals({ courts: S.courts, stalls, lots, trees: [...byKind.broadleaf, ...byKind.eucalyptus].filter((t) => t.x > B.x0 && t.x < B.x1 && t.z > B.z0 && t.z < B.z1), rand, inPoly: pointInPoly })
    // a soft shadow under every car
    plan.under = cars.map((c) => ({ x: c.x, z: c.z, y: 0.008, w: 2.3, l: 4.9, yaw: c.yaw }))
    buildDecals(group, plan, { keep })
  }

  // ---------- street lamps (OSM) ----------
  if (S.lamps.length) {
    const pole = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.06, 0.08, 4.5, 5).translate(0, 2.25, 0)), lambert(0x3a3f47), S.lamps.length)
    S.lamps.forEach(([x, z], i) => pole.setMatrixAt(i, m4.makeTranslation(x, 0, z)))
    group.add(pole)
  }

  // ---------- the backdrop: hills, a skyline, mountains ----------
  const cx = (B.x0 + B.x1) / 2
  const cz = (B.z0 + B.z1) / 2
  const R = Math.max(farR * 0.7, Math.hypot(B.x1 - B.x0, B.z1 - B.z0) / 2 + 90)
  if (bd.hills) {
    const hillMat = lambert(hex(bd.hills, 0x9a9a6a), { flatShading: true })
    const k = bd.hillsHeight || 1
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand() * 0.4
      const r = 30 + rand() * 30
      const hill = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(r, 1)), hillMat)
      hill.scale.set(1.4, 0.35 * k, 1)
      hill.position.set(cx + Math.cos(a) * (R + 20), -2, cz + Math.sin(a) * (R + 20))
      hill.rotation.y = a
      group.add(hill)
    }
  }
  if (bd.mountains) {
    const mMat = lambert(hex(bd.mountains, 0x8a92a0), { flatShading: true })
    const dir = (bd.mountainsDeg ?? -90) * (Math.PI / 180)
    for (let i = 0; i < 7; i++) {
      const a = dir + (i - 3) * 0.22
      const r = 50 + rand() * 35
      const m = new THREE.Mesh(keep(new THREE.ConeGeometry(r, r * 0.9, 6)), mMat)
      m.position.set(cx + Math.cos(a) * (R + 120), r * 0.35 - 6, cz + Math.sin(a) * (R + 120))
      group.add(m)
    }
  }
  if (bd.skyline) {
    const n = 40
    const sk = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), lambert(0xffffff), n)
    const cc = new THREE.Color()
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2
      const r = R + 30 + rand() * 60
      sk.setMatrixAt(i, m4.compose(v1.set(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r), q.setFromEuler(e1.set(0, a, 0)), v2.set(10 + rand() * 25, 5 + rand() * 14, 10 + rand() * 20)))
      if (bd.skylineTint) sk.setColorAt(i, cc.set(bd.skylineTint).offsetHSL(0, 0, (rand() - 0.5) * 0.12))
      else sk.setColorAt(i, cc.setHSL(0.08, 0.08, 0.62 + rand() * 0.2))
    }
    group.add(sk)
  }

  // ---------- extras (from the venue's corrections): towers, stands, canopies ... ----------
  const art = (style, w, h) =>
    canvasTexture(512, Math.max(64, Math.round((512 * h) / w)), (ctx, W, H2) => {
      if (style === "sunset") {
        const g = ctx.createLinearGradient(0, 0, 0, H2)
        g.addColorStop(0, "#ff7a59")
        g.addColorStop(0.5, "#ffb347")
        g.addColorStop(1, "#ff4fa3")
        ctx.fillStyle = g
        ctx.fillRect(0, 0, W, H2)
        ctx.fillStyle = "#ffe08a"
        ctx.beginPath()
        ctx.arc(W / 2, H2 * 0.62, H2 * 0.28, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = "#2a1838"
        for (const x of [0.12, 0.3, 0.72, 0.9]) {
          ctx.fillRect(W * x - 3, H2 * 0.35, 6, H2 * 0.65)
          for (let k = 0; k < 6; k++) {
            ctx.save()
            ctx.translate(W * x, H2 * 0.36)
            ctx.rotate((k / 6) * Math.PI * 2)
            ctx.fillRect(0, -3, H2 * 0.18, 6)
            ctx.restore()
          }
        }
      } else if (style === "wave") {
        ctx.fillStyle = "#bfe8f5"
        ctx.fillRect(0, 0, W, H2)
        ctx.strokeStyle = "#1f6fb8"
        ctx.lineWidth = H2 * 0.12
        for (let k = 0; k < 3; k++) {
          ctx.beginPath()
          ctx.arc(W * (0.3 + k * 0.25), H2, H2 * (0.8 - k * 0.15), Math.PI, Math.PI * 1.9)
          ctx.stroke()
        }
      } else if (style === "gradient") {
        const g = ctx.createLinearGradient(0, 0, W, 0)
        g.addColorStop(0, "#ff4fa3")
        g.addColorStop(0.5, "#a64fd8")
        g.addColorStop(1, "#3b6fe0")
        ctx.fillStyle = g
        ctx.fillRect(0, H2 * 0.2, W, H2 * 0.6)
      } else if (style === "navy") {
        // a club banner: navy, a white ring with crossed paddles (our own drawing), a stripe
        ctx.fillStyle = "#1f2858"
        ctx.fillRect(0, 0, W, H2)
        ctx.strokeStyle = "#f2f2ef"
        ctx.lineWidth = Math.max(4, H2 * 0.04)
        const r0 = Math.min(W, H2) * 0.3
        ctx.beginPath()
        ctx.arc(W / 2, H2 * 0.45, r0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = "#f2f2ef"
        for (const s of [-1, 1]) {
          ctx.save()
          ctx.translate(W / 2, H2 * 0.45)
          ctx.rotate(s * 0.6)
          ctx.beginPath()
          ctx.ellipse(0, -r0 * 0.25, r0 * 0.28, r0 * 0.38, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillRect(-r0 * 0.06, 0, r0 * 0.12, r0 * 0.55)
          ctx.restore()
        }
        ctx.fillRect(W * 0.2, H2 * 0.86, W * 0.6, H2 * 0.04)
      } else if (style === "emblem") {
        ctx.fillStyle = "#151515"
        ctx.fillRect(0, 0, W, H2)
        ctx.fillStyle = "#f2f2ef"
        ctx.beginPath()
        ctx.arc(W / 2, H2 / 2, W * 0.34, Math.PI / 2, Math.PI * 1.5)
        ctx.fill()
        ctx.strokeStyle = "#f2f2ef"
        ctx.lineWidth = 6
        ctx.beginPath()
        ctx.arc(W / 2, H2 / 2, W * 0.34, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        // graffiti: bright blobs and stripes
        ctx.fillStyle = "#3a3a3a"
        ctx.fillRect(0, 0, W, H2)
        const cols = ["#ff4f6d", "#ffd23f", "#3fc1ff", "#7cff6b", "#c56bff", "#ff9a3c"]
        for (let k = 0; k < 40; k++) {
          ctx.fillStyle = cols[k % cols.length]
          ctx.beginPath()
          ctx.ellipse(rand() * W, rand() * H2, 10 + rand() * 40, 6 + rand() * 18, rand() * 3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    })
  const faceYaw = (f, deg) => (f === "n" ? Math.PI : f === "s" ? 0 : f === "e" ? Math.PI / 2 : f === "w" ? -Math.PI / 2 : -((deg || 0) * Math.PI) / 180)
  for (const x of S.extras || []) {
    const a = ((x.deg || 0) * Math.PI) / 180
    const ry = -a
    if (x.type === "tower") {
      // (base: it rises from a roof, so nothing stands at the ground floor)
      const w = x.w || 5
      const b0 = x.base || 0
      const t = new THREE.Mesh(keep(new THREE.BoxGeometry(w, (x.h || 14) - b0, w)), lambert(hex(x.color, 0xf1ece2)))
      t.position.set(x.x, b0 + ((x.h || 14) - b0) / 2, x.z)
      group.add(t)
      const cap = new THREE.Mesh(keep(new THREE.ConeGeometry(w * 0.78, w * 0.7, 4).rotateY(Math.PI / 4)), lambert(hex(x.roof, 0xb5583a)))
      cap.position.set(x.x, (x.h || 14) + w * 0.35, x.z)
      group.add(cap)
      // arched openings near the top, each side
      for (let k = 0; k < 4; k++) {
        const o = new THREE.Mesh(keep(new THREE.PlaneGeometry(w * 0.45, 1.8)), lambert(0x2a2622, { side: THREE.DoubleSide }))
        const ang = (k * Math.PI) / 2
        o.position.set(x.x + Math.sin(ang) * (w / 2 + 0.02), (x.h || 14) - 2.2, x.z + Math.cos(ang) * (w / 2 + 0.02))
        o.rotation.y = ang
        group.add(o)
      }
    } else if (x.type === "stands") {
      const rows = x.rows || 4
      const mat = lambert(hex(x.color, 0x9aa3ad))
      const out = x.face === "w" ? { x: -1, z: 0 } : x.face === "e" ? { x: 1, z: 0 } : x.face === "n" ? { x: 0, z: -1 } : { x: Math.sin(a + Math.PI / 2), z: -Math.cos(a + Math.PI / 2) }
      for (let k = 0; k < rows; k++) {
        const st = new THREE.Mesh(keep(new THREE.BoxGeometry(x.w || 10, 0.45 * (k + 1), 0.8)), mat)
        const back = (k - (rows - 1) / 2) * 0.8
        st.position.set(x.x - out.x * back, (0.45 * (k + 1)) / 2, x.z - out.z * back)
        st.rotation.y = x.face === "w" || x.face === "e" ? Math.PI / 2 : ry
        group.add(st)
      }
    } else if (x.type === "cabana" || x.type === "gazebo") {
      const w = x.w || 4
      const d = x.d || w
      const postMat = lambert(hex(x.color, 0x8a3f2a))
      for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const post = new THREE.Mesh(keep(new THREE.BoxGeometry(0.15, 2.6, 0.15)), postMat)
        post.position.set(x.x + (i * w) / 2, 1.3, x.z + (j * d) / 2)
        group.add(post)
      }
      const roof = x.type === "gazebo" ? new THREE.Mesh(keep(new THREE.ConeGeometry(Math.max(w, d) * 0.75, 1.6, 8)), postMat) : new THREE.Mesh(keep(new THREE.BoxGeometry(w + 0.4, 0.12, d + 0.4)), postMat)
      roof.position.set(x.x, x.type === "gazebo" ? 3.4 : 2.65, x.z)
      group.add(roof)
      if (x.type === "cabana") {
        const curtain = new THREE.Mesh(keep(new THREE.PlaneGeometry(d, 2.4)), lambert(0xf6f3ea, { side: THREE.DoubleSide }))
        curtain.position.set(x.x - w / 2, 1.3, x.z)
        curtain.rotation.y = Math.PI / 2
        group.add(curtain)
      }
    } else if (x.type === "canopy") {
      const w = x.w || 3
      const mat = lambert(hex(x.color, 0xffffff), { side: THREE.DoubleSide })
      const top = new THREE.Mesh(keep(new THREE.ConeGeometry(w * 0.72, 0.7, 4).rotateY(Math.PI / 4)), mat)
      top.position.set(x.x, 2.75, x.z)
      group.add(top)
      for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const leg = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 4)), lambert(0x9aa0a8))
        leg.position.set(x.x + (i * w) / 2, 1.2, x.z + (j * w) / 2)
        group.add(leg)
      }
    } else if (x.type === "umbrellas") {
      const n = x.n || 4
      const mat = lambert(hex(x.color, 0xf4f2ec), { side: THREE.DoubleSide })
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2
        const px = x.x + Math.cos(ang) * (x.r || 4) * 0.6
        const pz = x.z + Math.sin(ang) * (x.r || 4) * 0.6
        const top = new THREE.Mesh(keep(new THREE.ConeGeometry(1.3, 0.5, 8)), mat)
        top.position.set(px, (x.y || 0) + 2.4, pz)
        group.add(top)
        const pole = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.03, 0.03, 2.3, 4)), lambert(0xdddddd))
        pole.position.set(px, (x.y || 0) + 1.15, pz)
        group.add(pole)
      }
    } else if (x.type === "sail") {
      const sail = new THREE.Mesh(keep(new THREE.PlaneGeometry(x.w || 10, x.d || 8).rotateX(-Math.PI / 2)), lambert(hex(x.color, 0x2f6fb8), { side: THREE.DoubleSide }))
      sail.position.set(x.x, 3.2, x.z)
      sail.rotation.z = 0.08
      group.add(sail)
    } else if (x.type === "terrace") {
      // a railing round a rooftop deck
      const h = x.h || 6
      const w = x.w || 10
      const d = x.d || 8
      const railMat = lambert(0xf4f4f4)
      for (const [len, ox, oz, rr] of [[w, 0, -d / 2, 0], [w, 0, d / 2, 0], [d, -w / 2, 0, Math.PI / 2], [d, w / 2, 0, Math.PI / 2]]) {
        const rail = new THREE.Mesh(keep(new THREE.BoxGeometry(len, 1.0, 0.06)), railMat)
        const c = Math.cos(ry)
        const sn = Math.sin(ry)
        rail.position.set(x.x + ox * c + oz * sn, h + 0.5, x.z - ox * sn + oz * c)
        rail.rotation.y = ry + rr
        group.add(rail)
      }
    } else if (x.type === "mural" || x.type === "banner" || x.type === "living") {
      const w = x.w || 8
      const h = x.h || 3
      const mat = x.type === "living" ? lambert(0x3e7a34) : keep(new THREE.MeshBasicMaterial({ map: keep(art(x.style || "graffiti", w, h)) }))
      const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), mat)
      m.position.set(x.x, x.y ?? h / 2 + 0.5, x.z)
      m.rotation.y = faceYaw(x.face, x.deg)
      m.renderOrder = 0.5
      group.add(m)
    } else if (x.type === "spine") {
      // a raised lounge walkway: a deck, a rail, orange steel portal frames, sofas
      const w = x.w || 20
      const d = x.d || 5
      const h = x.h || 1
      const deck = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), lambert(hex(x.color, 0xc8a273)))
      deck.position.set(x.x, h / 2, x.z)
      deck.rotation.y = ry
      group.add(deck)
      const frameMat = lambert(hex(x.frames, 0xf08a1c))
      const c = Math.cos(ry)
      const sn = Math.sin(ry)
      const at = (u, v) => [x.x + u * c + v * sn, x.z - u * sn + v * c]
      for (let u = -w / 2 + 1; u <= w / 2 - 1; u += 3) {
        for (const v of [-d / 2 + 0.2, d / 2 - 0.2]) {
          const [px, pz] = at(u, v)
          const post = new THREE.Mesh(keep(new THREE.BoxGeometry(0.16, 2.6, 0.16)), frameMat)
          post.position.set(px, h + 1.3, pz)
          group.add(post)
        }
        const [px, pz] = at(u, 0)
        const beam = new THREE.Mesh(keep(new THREE.BoxGeometry(0.16, 0.16, d)), frameMat)
        beam.position.set(px, h + 2.6, pz)
        beam.rotation.y = ry
        group.add(beam)
      }
      for (const v of [-d / 2 + 0.05, d / 2 - 0.05]) {
        const [px, pz] = at(0, v)
        const rail = new THREE.Mesh(keep(new THREE.BoxGeometry(w, 0.06, 0.06)), frameMat)
        rail.position.set(px, h + 1.0, pz)
        rail.rotation.y = ry
        group.add(rail)
      }
      const sofaMat = lambert(0xe8d3ad)
      for (let u = -w / 2 + 3; u < w / 2 - 2; u += 7) {
        const [px, pz] = at(u, 0)
        const sofa = new THREE.Mesh(keep(new THREE.BoxGeometry(2, 0.7, 0.9)), sofaMat)
        sofa.position.set(px, h + 0.35, pz)
        sofa.rotation.y = ry
        group.add(sofa)
      }
    } else if (x.type === "solar") {
      // a solar canopy (h: how high its panels are; a court underneath needs ~6 m)
      // (from above, as aerials show it: a light grey frame with rows of dark panels;
      // x.color sets the frame)
      const sh = x.h || 3.6
      const W = x.w || 30
      const D = x.d || 20
      const panel = new THREE.Mesh(keep(new THREE.BoxGeometry(W, 0.15, D)), lambert(x.color ? new THREE.Color(x.color) : 0x9aa1aa))
      panel.position.set(x.x, sh, x.z)
      panel.rotation.set(0.12, ry, 0, "YXZ")
      group.add(panel)
      const rows = Math.max(2, Math.round(D / 3))
      const rowGeo = keep(new THREE.BoxGeometry(W - 0.6, 0.04, (D / rows) * 0.5))
      const rowMat = lambert(0x4a5a72)
      for (let k = 0; k < rows; k++) {
        const row = new THREE.Mesh(rowGeo, rowMat)
        row.position.set(0, 0.095, -D / 2 + (D / rows) * (k + 0.5))
        panel.add(row)
      }
      const c = Math.cos(ry)
      const sn = Math.sin(ry)
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j += 2) {
          const post = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.12, 0.12, sh - 0.2, 6)), lambert(0x9aa0a8))
          const ox = (i * (x.w || 30)) / 2.2
          const oz = (j * (x.d || 20)) / 2.1
          post.position.set(x.x + ox * c + oz * sn, (sh - 0.2) / 2, x.z - ox * sn + oz * c)
          group.add(post)
        }
    } else if (x.type === "golf") {
      // rolling fairways and a few sand bunkers
      const fair = lambert(0x6fa84a, { flatShading: true })
      for (let k = 0; k < 6; k++) {
        const mound = new THREE.Mesh(keep(new THREE.SphereGeometry(14 + rand() * 10, 10, 6)), fair)
        mound.scale.y = 0.12
        mound.position.set(x.x + (rand() - 0.5) * (x.w || 100), -0.4, x.z + (rand() - 0.5) * (x.d || 80))
        group.add(mound)
      }
      const sand = lambert(0xe6d6a8)
      for (let k = 0; k < 5; k++) {
        const bunker = new THREE.Mesh(keep(new THREE.CircleGeometry(2.5 + rand() * 3, 10).rotateX(-Math.PI / 2)), sand)
        bunker.position.set(x.x + (rand() - 0.5) * (x.w || 100), 0.02, x.z + (rand() - 0.5) * (x.d || 80))
        group.add(bunker)
      }
    } else if (x.type === "ocean") {
      const dist = x.dist || 500
      const ox = (B.x0 + B.x1) / 2 + Math.cos(a) * dist
      const oz = (B.z0 + B.z1) / 2 + Math.sin(a) * dist
      const sea = new THREE.Mesh(keep(new THREE.CircleGeometry(dist * 0.9, 40).rotateX(-Math.PI / 2)), lambert(0x1478a8))
      sea.position.set(ox, -0.6, oz)
      group.add(sea)
    } else if (x.type === "awnings") {
      const aw = new THREE.Mesh(keep(new THREE.BoxGeometry(x.w || 10, 0.06, 1.4)), lambert(hex(x.color, 0x7a1f2a)))
      aw.position.set(x.x, 2.8, x.z)
      aw.rotation.set(0.25, ry, 0)
      group.add(aw)
    }
  }
  // an elevated rail line in the backdrop (concrete deck on columns)
  if (bd.viaduct) {
    const [ax, az] = bd.viaduct.from
    const [bx, bz] = bd.viaduct.to
    const L = Math.hypot(bx - ax, bz - az)
    const h = bd.viaduct.h || 9
    const conc = lambert(0xbdbab2)
    const deck = new THREE.Mesh(keep(new THREE.BoxGeometry(L, 1.4, 8)), conc)
    deck.position.set((ax + bx) / 2, h, (az + bz) / 2)
    deck.rotation.y = -Math.atan2(bz - az, bx - ax)
    group.add(deck)
    for (let d = 0; d <= L; d += 24) {
      const col = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.9, 1.1, h, 8)), conc)
      col.position.set(ax + ((bx - ax) * d) / L, h / 2, az + ((bz - az) * d) / L)
      group.add(col)
    }
  }

  // round 3 (environment.js): the drawn sky gives way to a real HDRI on everything that reflects
  // it, once the file has loaded (the drawn one stands in until then)
  let envMats = []
  let envDay = 1
  let gone = false
  if (detail && env && typeof document !== "undefined") {
    loadHDRI(!!S.indoor).then((hdr) => {
      if (!hdr || gone) return
      envMats = swapEnvironment(group, env, hdr)
      setDetailEnv(hdr)
      dimEnvironment(envMats, envDay)
    })
  }

  return {
    groundMat,
    courtGroup: (c) => groups.get(c) || null,
    // the rooms' zones (build.js merges each and adds them after the venue's own merge)
    zones,
    // draw a room only when you or the camera are in it, or near one of its doors
    cull: (cam, me) => {
      for (const z of zones) {
        const inside = pointInPoly(me.x, me.z, z.poly) || pointInPoly(cam.x, cam.z, z.poly)
        z.group.visible = inside || z.doors.some((d) => Math.hypot(d.x - cam.x, d.z - cam.z) < 9 || Math.hypot(d.x - me.x, d.z - me.z) < 9)
      }
    },
    setDayLook: (d) => {
      if (hallLampMat) hallLampMat.color.setHex(0xfff8e8)
      envDay = S.indoor ? 1 : Math.max(0.12, Math.min(1, (d.sun?.intensity ?? 2.6) / 2.6))
      dimEnvironment(envMats, envDay)
    },
    dispose: () => {
      gone = true
    },
  }
}
