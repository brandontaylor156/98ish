// Roam: buses, trains, bus stop signs and the GPS route line (sim/transit.js, nav/route.js).
// Modelled in code (nothing downloaded), in original liveries: a city bus (white with a blue band,
// dark windows, the route's number on the front), a commuter train (a locomotive and bi-level
// coaches, silver with a violet stripe), a stop sign on a pole at each mapped stop, and the GPS
// route drawn on the road as a blue ribbon of chevrons that flow the way to go.

import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { setBusMaker } from "./cars.js"

const tint = (g, hex) => {
  const out = g.index ? g.toNonIndexed() : g
  for (const k of Object.keys(out.attributes)) if (!["position", "normal"].includes(k)) out.deleteAttribute(k)
  const c = new THREE.Color(hex)
  const n = out.attributes.position.count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3)
  out.setAttribute("color", new THREE.BufferAttribute(col, 3))
  return out
}
const box = (w, h, d, x, y, z, hex) => tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex)
const wheel = (r, x, y, z) => {
  const g = new THREE.CylinderGeometry(r, r, 0.3, 12)
  g.rotateZ(Math.PI / 2)
  g.translate(x, y, z)
  return tint(g, 0x1b1b1d)
}

// a 12 m city bus, facing +z
export const busGeometry = (band = 0x2a5db0) => {
  const L = 12.2
  const W = 2.55
  const parts = [
    box(W, 2.65, L, 0, 0.35 + 1.325, 0, 0xf1f1ee), // the body
    box(W + 0.02, 0.95, L - 1.2, 0, 1.95, -0.3, 0x1e2a33), // side windows
    box(W - 0.2, 1.3, 0.05, 0, 1.75, L / 2 + 0.01, 0x1e2a33), // the windscreen
    box(W + 0.03, 0.28, L, 0, 1.2, 0, band), // the band
    box(W - 0.4, 0.28, 0.06, 0, 2.75, L / 2 + 0.02, 0x101010), // the destination sign
    box(W - 0.3, 0.12, 0.03, 0, 2.75, L / 2 + 0.06, 0xffb030), // its lit letters
    box(W + 0.02, 0.2, L, 0, 3.05, 0, 0xd8d8d4), // the roof pod
    box(0.9, 2.0, 0.06, W / 2 - 0.55, 1.35, L / 2 - 1.4, 0x34404a), // the front door (curb side)
    box(0.25, 0.12, 0.05, -0.9, 0.75, L / 2 + 0.02, 0xfff6c8), // headlights
    box(0.25, 0.12, 0.05, 0.9, 0.75, L / 2 + 0.02, 0xfff6c8),
    box(0.3, 0.14, 0.05, -1.0, 0.8, -L / 2 - 0.02, 0xc81e1e), // tail lights
    box(0.3, 0.14, 0.05, 1.0, 0.8, -L / 2 - 0.02, 0xc81e1e),
    box(W - 0.4, 0.8, 0.05, 0, 2.15, -L / 2 - 0.01, 0x1e2a33), // the rear window
    box(W - 0.6, 0.5, 0.04, 0, 1.25, -L / 2 - 0.02, 0x8f9aa4), // the engine grille
    box(W + 0.02, 0.28, 0.14, 0, 0.5, -L / 2 - 0.04, 0x2a2b2e), // bumpers
    box(W + 0.02, 0.28, 0.14, 0, 0.5, L / 2 + 0.04, 0x2a2b2e),
    box(0.9, 0.25, 0.04, 0.6, 2.75, -L / 2 - 0.02, 0x101010), // the route number at the back
  ]
  for (const z of [3.9, -3.2]) for (const x of [-1.15, 1.15]) parts.push(wheel(0.5, x, 0.5, z))
  // (the doors are on the right: x east, the bus faces +z, its right is -x)
  parts[7] = box(0.06, 2.0, 0.9, -W / 2 - 0.01, 1.35, L / 2 - 1.4, 0x34404a)
  return mergeGeometries(parts)
}
// a coach of the train (or its locomotive), 26 m, facing +z
export const trainGeometry = (loco = false) => {
  const L = 25.5
  const W = 3.0
  const parts = loco
    ? [
        box(W, 3.9, L - 2, 0, 0.9 + 1.95, -1, 0xc9ccd2),
        box(W - 0.2, 2.0, 3, 0, 1.9, L / 2 - 2.0, 0xc9ccd2), // the nose
        box(W - 0.4, 0.9, 0.06, 0, 3.4, L / 2 - 2.2 + 1.0, 0x1e2a33), // the cab windows
        box(W + 0.03, 0.35, L - 1, 0, 2.2, -0.5, 0x6b3fa0),
        box(0.35, 0.2, 0.05, -0.9, 1.4, L / 2 - 0.48, 0xfff6c8),
        box(0.35, 0.2, 0.05, 0.9, 1.4, L / 2 - 0.48, 0xfff6c8),
      ]
    : [
        box(W, 4.6, L, 0, 0.9 + 2.3, 0, 0xd2d5da),
        box(W + 0.02, 0.8, L - 3, 0, 2.2, 0, 0x22303a), // lower deck windows
        box(W + 0.02, 0.8, L - 3, 0, 4.0, 0, 0x22303a), // upper deck windows
        box(W + 0.03, 0.3, L, 0, 3.1, 0, 0x6b3fa0), // the stripe
      ]
  for (const z of [-L / 2 + 3, L / 2 - 3]) for (const x of [-1.1, 1.1]) parts.push(wheel(0.45, x, 0.45, z))
  return mergeGeometries(parts)
}

const mat = () => new THREE.MeshLambertMaterial({ vertexColors: true })

// one bus (for the ride: yours or a friend's) -> the car mesh interface
export const makeBusMesh = () => {
  const geo = busGeometry()
  const m = mat()
  const group = new THREE.Group()
  const body = new THREE.Group()
  group.add(body)
  const mesh = new THREE.Mesh(geo, m)
  mesh.castShadow = true
  body.add(mesh)
  return {
    group,
    body,
    setColor() {},
    setWheels() {},
    setBrake() {},
    dispose() {
      group.removeFromParent()
      geo.dispose()
      m.dispose()
    },
  }
}
setBusMaker(makeBusMesh)

// the buses and trains near you, and the stop signs: instanced
export const createTransitLayer = (scene, { buses = 8, coaches = 12, signs = 40 } = {}) => {
  const m = mat()
  const make = (geo, n) => {
    const im = new THREE.InstancedMesh(geo, m, n)
    im.count = 0
    im.frustumCulled = false
    im.castShadow = true
    im.receiveShadow = true
    scene.add(im)
    return im
  }
  const bus = make(busGeometry(), buses)
  const loco = make(trainGeometry(true), 4)
  const coach = make(trainGeometry(false), coaches)
  const signGeo = mergeGeometries([
    tint(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6).translate(0, 1.3, 0), 0x8a8d92),
    box(0.5, 0.42, 0.04, 0, 2.45, 0, 0x1f5fb8),
    box(0.4, 0.12, 0.05, 0, 2.5, 0, 0xffffff),
    box(1.6, 0.06, 0.4, 0.9, 0.45, 0.6, 0x6b5a48), // a bench
  ])
  const sign = make(signGeo, signs)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const v = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)
  const up = new THREE.Vector3(0, 1, 0)
  const put = (im, i, x, y, z, yaw, pitch = 0) => {
    q.setFromEuler(new THREE.Euler(-pitch, yaw, 0, "YXZ"))
    m4.compose(v.set(x, y, z), q, one)
    im.setMatrixAt(i, m4)
  }
  void up
  return {
    // list: [{ kind: "bus" | "loco" | "coach", x, y, z, yaw, pitch }]; stops: [{ x, y, z, yaw }]
    set(list, stops = []) {
      const n = { bus: 0, loco: 0, coach: 0 }
      const ims = { bus, loco, coach }
      for (const it of list) {
        const im = ims[it.kind]
        if (!im || n[it.kind] >= im.instanceMatrix.count) continue
        put(im, n[it.kind]++, it.x, it.y, it.z, it.yaw, it.pitch || 0)
      }
      for (const [k, im] of Object.entries(ims)) {
        im.count = n[k]
        im.instanceMatrix.needsUpdate = true
      }
      let s = 0
      for (const st of stops) {
        if (s >= signs) break
        put(sign, s++, st.x, st.y, st.z, st.yaw || 0)
      }
      sign.count = s
      sign.instanceMatrix.needsUpdate = true
    },
    dispose() {
      for (const im of [bus, loco, coach, sign]) {
        im.removeFromParent()
        im.geometry.dispose()
        im.dispose()
      }
      m.dispose()
    },
  }
}

// ---------- the GPS route on the road ----------
let chevronTex = null
const chevrons = () => {
  if (chevronTex) return chevronTex
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(64, 128) : Object.assign(document.createElement("canvas"), { width: 64, height: 128 })
  const g = c.getContext("2d")
  g.fillStyle = "rgba(40,120,255,0.78)"
  g.fillRect(0, 0, 64, 128)
  g.strokeStyle = "rgba(255,255,255,0.95)"
  g.lineWidth = 10
  g.lineCap = "round"
  g.lineJoin = "round"
  g.beginPath()
  g.moveTo(14, 84)
  g.lineTo(32, 52)
  g.lineTo(50, 84)
  g.stroke()
  chevronTex = new THREE.CanvasTexture(c)
  chevronTex.wrapS = chevronTex.wrapT = THREE.RepeatWrapping
  return chevronTex
}
// the ribbon's arrays for a stretch of route: pts [{ x, z }] with ys (the ground under each),
// width w -> { position, uv, index }
export const ribbonArrays = (pts, ys, w = 2.6, s0 = 0) => {
  const P = []
  const U = []
  const I = []
  let s = s0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l = Math.hypot(dx, dz) || 1
    const rx = -dz / l
    const rz = dx / l
    if (i > 0) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)
    const y = (ys[i] ?? 0) + 0.12
    P.push(pts[i].x - (rx * w) / 2, y, pts[i].z - (rz * w) / 2, pts[i].x + (rx * w) / 2, y, pts[i].z + (rz * w) / 2)
    // (one chevron every 3.2 m, pointing along the way)
    U.push(0, s / 3.2, 1, s / 3.2)
    if (i > 0) {
      const k = (i - 1) * 2
      I.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
  }
  return { position: new Float32Array(P), uv: new Float32Array(U), index: I }
}
export const createRouteLine = (scene) => {
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
  let mesh = null
  return {
    // pts along the stretch to draw, ys the ground under them, s0 how far along the route it starts
    set(pts, ys, s0 = 0) {
      // (the chevrons' texture is drawn the first time: a canvas, so only in a browser)
      if (!material.map && pts?.length && (typeof OffscreenCanvas !== "undefined" || typeof document !== "undefined")) {
        material.map = chevrons()
        material.needsUpdate = true
      }
      if (mesh) {
        mesh.removeFromParent()
        mesh.geometry.dispose()
        mesh = null
      }
      if (!pts || pts.length < 2) return
      const a = ribbonArrays(pts, ys, 2.6, s0)
      const g = new THREE.BufferGeometry()
      g.setAttribute("position", new THREE.BufferAttribute(a.position, 3))
      g.setAttribute("uv", new THREE.BufferAttribute(a.uv, 2))
      g.setIndex(a.index)
      mesh = new THREE.Mesh(g, material)
      mesh.renderOrder = 2
      mesh.frustumCulled = false
      scene.add(mesh)
    },
    // (the chevrons flow toward where you're going)
    tick(t) {
      if (material.map) material.map.offset.y = -(t * 0.6) % 1
    },
    dispose() {
      mesh?.removeFromParent()
      mesh?.geometry.dispose()
      material.dispose()
    },
  }
}
