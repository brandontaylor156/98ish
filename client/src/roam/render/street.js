// Roam: what stands at the map's street nodes, and the town's lights at night (docs/open-world.md
// "Street furniture and night"). Only where the map has them (highway=traffic_signals, stop,
// street_lamp): a signal pole at the corner with a mast arm over the road and heads that run the
// same cycle the traffic obeys (sim/traffic.js signalGreen), a stop sign at the curb facing the
// traffic coming up to the corner, a lamp post with its light. At night: the lamps glow and light
// a pool of road under them; cars' headlights and tail lights glow, your own headlights light the
// road ahead. Instanced: a handful of draws for every one in town.
//
// streetFurniture (pure, Node-tested): where each piece goes, never on a road's lanes.

import * as THREE from "three"
import { DRIVABLE, F, ROAD, STREET } from "../data/tile.js"
import { signalGreen } from "../sim/traffic.js"

// the nearest drivable roads to a point -> [{ road, d, hx, hz, w }] (nearest first)
const nearRoads = (roads, x, z, within = 14) => {
  const out = []
  for (const r of roads) {
    if (!DRIVABLE.has(r.cls) || r.cls === ROAD.driveway || r.flags & F.tunnel) continue
    let best = Infinity
    let hx = 0
    let hz = 1
    let px = x
    let pz = z
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i]
      const b = r.pts[i + 1]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const L2 = dx * dx + dz * dz || 1e-9
      const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2))
      const d = Math.hypot(x - a.x - dx * k, z - a.z - dz * k)
      if (d < best) {
        best = d
        const L = Math.sqrt(L2)
        hx = dx / L
        hz = dz / L
        px = a.x + dx * k
        pz = a.z + dz * k
      }
    }
    if (best < within) out.push({ road: r, d: best, hx, hz, w: r.width, px, pz })
  }
  return out.sort((a, b) => a.d - b.d)
}
// is a point on any drivable road's lanes (plus a margin)?
export const onRoad = (roads, x, z, margin = 0.3) => {
  for (const r of roads) {
    if (!DRIVABLE.has(r.cls) || r.flags & (F.tunnel | F.bridge)) continue
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i]
      const b = r.pts[i + 1]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const L2 = dx * dx + dz * dz || 1e-9
      const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2))
      if (Math.hypot(x - a.x - dx * k, z - a.z - dz * k) < r.width / 2 + margin) return true
    }
  }
  return false
}

// a tile's street nodes -> [{ kind, x, z, yaw (the way the piece faces), arm (m, signals),
// hx, hz (the road it serves) }]
export const streetFurniture = (tile) => {
  const out = []
  for (const n of tile.street || []) {
    const near = nearRoads(tile.roads, n.x, n.z)
    if (n.kind === STREET.lamp) {
      // (a lamp stands where it's mapped; if that's on the lanes, at the nearest curb)
      let x = n.x
      let z = n.z
      let yaw = 0
      if (near[0]) {
        const { hx, hz, w, d, px, pz } = near[0]
        // (on the lanes: moved out to the nearest curb)
        let ox = n.x - px
        let oz = n.z - pz
        let ol = Math.hypot(ox, oz)
        if (ol < 1e-3) {
          ox = -hz
          oz = hx
          ol = 1
        }
        if (d < w / 2 + 0.4) {
          x = px + (ox / ol) * (w / 2 + 0.8)
          z = pz + (oz / ol) * (w / 2 + 0.8)
        }
        // (the arm reaches back over the road: local +x turned to point at it)
        yaw = Math.atan2(oz / ol, -ox / ol)
      }
      out.push({ kind: n.kind, x, z, yaw })
      continue
    }
    if (!near[0]) continue
    const a = near[0]
    // the cross street (if this is a corner): a near road heading another way
    const cross = near.find((q) => q !== a && Math.abs(q.hx * a.hx + q.hz * a.hz) < 0.8)
    // at the corner: back from the cross street, out past the road's curb (right of travel)
    const back = cross ? cross.w / 2 + 1.6 : 0
    const out1 = a.w / 2 + 1.0
    const rx = -a.hz
    const rz = a.hx
    let best = null
    // (try the four corners; keep the first that's off every road)
    for (const [sb, sr] of [[-1, 1], [1, -1], [-1, -1], [1, 1]]) {
      const x = n.x + a.hx * back * sb + rx * out1 * sr
      const z = n.z + a.hz * back * sb + rz * out1 * sr
      if (!onRoad(tile.roads, x, z)) {
        best = { x, z, sb, sr }
        break
      }
    }
    if (!best) continue
    // (the piece faces the traffic coming up the road to the corner: back along the road)
    const yaw = Math.atan2(a.hx * best.sb, a.hz * best.sb)
    out.push({ kind: n.kind, x: best.x, z: best.z, yaw, arm: n.kind === STREET.signals ? Math.min(7.5, out1 + a.w * 0.25) : 0, hx: a.hx, hz: a.hz, side: best.sr })
  }
  return out
}

// ---------- drawing ----------
const glowTexture = () => {
  const n = 64
  const data = new Uint8Array(n * n * 4)
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(i + 0.5 - n / 2, j + 0.5 - n / 2) / (n / 2)
      const a = Math.max(0, 1 - d) ** 2.2
      data.set([255, 255, 255, Math.round(a * 255)], (j * n + i) * 4)
    }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat)
  t.magFilter = t.minFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}
const stopTexture = () => {
  if (typeof document === "undefined") return null
  const c = document.createElement("canvas")
  c.width = c.height = 128
  const g = c.getContext("2d")
  g.clearRect(0, 0, 128, 128)
  const oct = (r, fill) => {
    g.beginPath()
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k * Math.PI) / 4
      g[k ? "lineTo" : "moveTo"](64 + Math.cos(a) * r, 64 + Math.sin(a) * r)
    }
    g.closePath()
    g.fillStyle = fill
    g.fill()
  }
  oct(62, "#f2f2ee")
  oct(56, "#b5121b")
  g.fillStyle = "#f6f6f2"
  g.font = "bold 34px Arial, sans-serif"
  g.textAlign = "center"
  g.textBaseline = "middle"
  g.fillText("STOP", 64, 66)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export const createStreetLayer = (scene, { cap = 400 } = {}) => {
  const own = []
  const metal = new THREE.MeshLambertMaterial({ color: 0x6d7073 })
  const dark = new THREE.MeshLambertMaterial({ color: 0x232527 })
  const lens = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
  const stopTex = stopTexture()
  const sign = new THREE.MeshLambertMaterial({ map: stopTex, alphaTest: 0.5, color: stopTex ? 0xffffff : 0xb5121b })
  // (the back of a sign: plain grey metal)
  const signBack = new THREE.MeshLambertMaterial({ map: stopTex, alphaTest: 0.5, color: 0x3a3c3e })
  const glowTex = glowTexture()
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd9a0, toneMapped: false })
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x8a6a40, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, toneMapped: false })
  const geo = {
    pole: new THREE.CylinderGeometry(0.09, 0.13, 1, 6).translate(0, 0.5, 0),
    arm: new THREE.BoxGeometry(1, 0.12, 0.12).translate(0.5, 0, 0),
    head: new THREE.BoxGeometry(0.34, 1.0, 0.28),
    lens: new THREE.CircleGeometry(0.1, 8),
    sign: new THREE.PlaneGeometry(0.76, 0.76),
    signBack: new THREE.PlaneGeometry(0.76, 0.76).rotateY(Math.PI).translate(0, 0, -0.01),
    lamp: new THREE.BoxGeometry(0.7, 0.14, 0.3),
    glow: new THREE.PlaneGeometry(1, 1),
    pool: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  }
  const make = (g, m, n, { shadow = false } = {}) => {
    const im = new THREE.InstancedMesh(g, m, n)
    im.count = 0
    im.frustumCulled = false
    im.castShadow = shadow
    scene.add(im)
    own.push(im)
    return im
  }
  const poles = make(geo.pole, metal, cap, { shadow: true })
  const arms = make(geo.arm, metal, cap, { shadow: true })
  const heads = make(geo.head, dark, cap * 2)
  const lenses = make(geo.lens, lens, cap * 6)
  lenses.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 6 * 3), 3)
  const signs = make(geo.sign, sign, cap)
  const backs = make(geo.signBack, signBack, cap)
  const lamps = make(geo.lamp, dark, cap)
  const glows = make(geo.glow, glowMat, cap * 2)
  const pools = make(geo.pool, poolMat, cap)
  glows.renderOrder = pools.renderOrder = 2
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler(0, 0, 0, "YXZ")
  const v = new THREE.Vector3()
  const s = new THREE.Vector3()
  let list = []
  let lensList = [] // [{ i, piece, color: 0 red 1 amber 2 green, dir }]
  const camQ = new THREE.Quaternion()
  return {
    // pieces: streetFurniture output with y (ground) added
    set(pieces) {
      list = pieces.slice(0, cap)
      lensList = []
      let np = 0
      let na = 0
      let nh = 0
      let nl = 0
      let ns = 0
      let nlamp = 0
      for (const p of list) {
        const up = (h) => v.set(p.x, p.y + h, p.z)
        if (p.kind === STREET.signals) {
          const H = 5.6
          m4.compose(up(0), q.identity(), s.set(1.4, H, 1.4))
          poles.setMatrixAt(np++, m4)
          // the arm over the road (from the corner back across the lanes)
          const ax = -p.hz * -p.side
          const az = p.hx * -p.side
          e.set(0, Math.atan2(-az, ax), 0)
          q.setFromEuler(e)
          m4.compose(up(H - 0.3), q, s.set(p.arm, 1, 1))
          arms.setMatrixAt(na++, m4)
          // two heads on the arm facing the oncoming traffic (yaw), lenses red/amber/green
          for (const f of [0.55, 1]) {
            const hx = p.x + ax * p.arm * f
            const hz = p.z + az * p.arm * f
            e.set(0, p.yaw, 0)
            q.setFromEuler(e)
            m4.compose(v.set(hx, p.y + H - 0.85, hz), q, s.set(1, 1, 1))
            heads.setMatrixAt(nh++, m4)
            for (let c = 0; c < 3; c++) {
              const ly = p.y + H - 0.85 + (1 - c) * 0.3
              m4.compose(v.set(hx + Math.sin(p.yaw) * 0.15, ly, hz + Math.cos(p.yaw) * 0.15), q, s.set(1, 1, 1))
              lensList.push({ i: nl, piece: p, color: c })
              lenses.setMatrixAt(nl++, m4)
            }
          }
        } else if (p.kind === STREET.stop) {
          m4.compose(up(0), q.identity(), s.set(0.6, 2.2, 0.6))
          poles.setMatrixAt(np++, m4)
          e.set(0, p.yaw, 0)
          q.setFromEuler(e)
          m4.compose(up(2.3), q, s.set(1, 1, 1))
          backs.setMatrixAt(ns, m4)
          signs.setMatrixAt(ns++, m4)
        } else {
          const H = 8.5
          m4.compose(up(0), q.identity(), s.set(1.1, H, 1.1))
          poles.setMatrixAt(np++, m4)
          e.set(0, p.yaw, 0)
          q.setFromEuler(e)
          m4.compose(up(H - 0.1), q, s.set(1.8, 0.7, 0.7))
          arms.setMatrixAt(na++, m4)
          m4.compose(v.set(p.x + Math.cos(p.yaw) * 1.6, p.y + H - 0.2, p.z - Math.sin(p.yaw) * 1.6), q, s.set(1, 1, 1))
          lamps.setMatrixAt(nlamp++, m4)
          p.light = { x: p.x + Math.cos(p.yaw) * 1.6, y: p.y + H - 0.32, z: p.z - Math.sin(p.yaw) * 1.6, g: p.y }
        }
      }
      poles.count = np
      arms.count = na
      heads.count = nh
      lenses.count = nl
      signs.count = backs.count = ns
      lamps.count = nlamp
      for (const im of own) im.instanceMatrix.needsUpdate = true
    },
    // every frame: the signals' colours (the cycle), the lamps' and cars' glows at night
    // cars: [{ x, y, z, yaw, len, wid, brake }] (moving cars: yours, traffic, friends')
    update(time, night, camera, cars = [], beam = null) {
      const c = new THREE.Color()
      for (const L of lensList) {
        const p = L.piece
        const green = signalGreen(time, p.yaw, Math.round(p.x * 0.01 + p.z * 0.013) * 7)
        // (amber: the last 3 s before the light turns red)
        const amber = !green && signalGreen(time - 3, p.yaw, Math.round(p.x * 0.01 + p.z * 0.013) * 7)
        const on = L.color === 2 ? green : L.color === 1 ? amber : !green && !amber
        const base = L.color === 0 ? [1, 0.12, 0.08] : L.color === 1 ? [1, 0.62, 0.1] : [0.25, 1, 0.55]
        const k = on ? 1 : 0.12
        lenses.instanceColor.setXYZ(L.i, base[0] * k, base[1] * k, base[2] * k)
      }
      lenses.instanceColor.needsUpdate = true
      // glows (camera-facing quads) and road pools
      let ng = 0
      let npool = 0
      camQ.copy(camera.quaternion)
      if (night > 0.05) {
        for (const p of list) {
          if (!p.light) continue
          m4.compose(v.set(p.light.x, p.light.y, p.light.z), camQ, s.setScalar(2.6))
          glows.setMatrixAt(ng++, m4)
          m4.compose(v.set(p.light.x, p.light.g + 0.16, p.light.z), q.identity(), s.set(16, 1, 16))
          pools.setMatrixAt(npool++, m4)
        }
        for (const car of cars) {
          if (ng + 2 > cap * 2) break
          const fx = Math.sin(car.yaw)
          const fz = Math.cos(car.yaw)
          const rx = -fz
          const rz = fx
          for (const sd of [-1, 1]) {
            m4.compose(v.set(car.x + fx * car.len * 0.5 + rx * sd * car.wid * 0.33, car.y + 0.72, car.z + fz * car.len * 0.5 + rz * sd * car.wid * 0.33), camQ, s.setScalar(1.3))
            glows.setMatrixAt(ng++, m4)
          }
          if (npool < cap) {
            // (the road lit ahead of each car)
            m4.compose(v.set(car.x + fx * (car.len * 0.5 + 8), car.y + 0.16, car.z + fz * (car.len * 0.5 + 8)), q.setFromEuler(e.set(0, car.yaw, 0)), s.set(car.beam ? 8 : 6, 1, car.beam ? 19 : 12))
            pools.setMatrixAt(npool++, m4)
          }
        }
      }
      glows.count = ng
      pools.count = npool
      glows.instanceMatrix.needsUpdate = pools.instanceMatrix.needsUpdate = true
      glowMat.opacity = Math.min(1, night * 1.2)
      poolMat.opacity = Math.min(1, night * 1.1)
      void beam
    },
    dispose() {
      for (const im of own) {
        im.removeFromParent()
        im.dispose()
      }
      for (const g of Object.values(geo)) g.dispose()
      for (const m of [metal, dark, lens, sign, signBack, glowMat, poolMat]) m.dispose()
      stopTex?.dispose()
      glowTex.dispose()
    },
  }
}
