// My Park: the park's picture (three.js), built once from layout.js. Everything that never
// moves is merged into a handful of meshes (venue.js mergeStatic) or instanced (fence posts,
// trees, light poles, paddles in the racks, the ball machine's balls); the "lighting" under
// trees and round the courts is painted into the ground texture, so the park needs no shadow
// map. Night (sky.js) turns the court lights on: glowing lamps and a pool of light on each
// court.

import * as THREE from "three"
import { HALF_L, HALF_W, KITCHEN, LINE_W, NET_POST_X, netHeightAt } from "../physics.js"
import { mergeStatic } from "../venue.js"
import { BENCHES, BOARD, BOOTH, BOUNDS, COURTS, FOUNTAIN, LEVEL_NAMES, LIGHTS, MACHINE_COURT, PATH_W, PEN, SEAT_ROWS, TREES } from "./layout.js"

const canvasTexture = (w, h, draw) => {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  draw(c.getContext("2d"), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
const quad = (positions, x0, z0, x1, z1, y) => {
  positions.push(x0, y, z0, x1, y, z1, x1, y, z0, x0, y, z0, x0, y, z1, x1, y, z1)
}
// the biggest bold type (size down to min) that fits width
const fit = (ctx, text, size, min, width) => {
  while (size > min) {
    ctx.font = `bold ${size}px Arial, sans-serif`
    if (ctx.measureText(text).width <= width) return
    size -= 2
  }
  ctx.font = `bold ${min}px Arial, sans-serif`
}

export const buildPark = (scene, { quality = "medium" } = {}) => {
  const group = new THREE.Group()
  const disposables = []
  const keep = (x) => {
    disposables.push(x)
    return x
  }
  const lambert = (color, o = {}) => keep(new THREE.MeshLambertMaterial({ color, ...o }))
  const std = (color, o = {}) => keep(new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o }))
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()

  // ---- sky (its colors follow the time of day) ----
  const skyMat = keep(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(0x3f8fe0) }, horizon: { value: new THREE.Color(0xd8ecfb) } },
      vertexShader: "varying float vY; void main() { vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 horizon; varying float vY; void main() { float t = pow(clamp(vY, 0.0, 1.0), 0.5); gl_FragColor = vec4(mix(horizon, top, t), 1.0);\n#include <colorspace_fragment>\n}",
    })
  )
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(190, 24, 12)), skyMat)
  sky.renderOrder = -1
  sky.frustumCulled = false
  group.add(sky)
  const starPos = new Float32Array(400 * 3)
  let ss = 3
  const srnd = () => ((ss = (ss * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 400; i++) {
    const a = srnd() * Math.PI * 2
    const e = 0.15 + srnd() * 1.2
    starPos.set([Math.cos(a) * Math.cos(e) * 180, Math.sin(e) * 180, Math.sin(a) * Math.cos(e) * 180], i * 3)
  }
  const starGeo = keep(new THREE.BufferGeometry())
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3))
  const stars = new THREE.Points(starGeo, keep(new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, sizeAttenuation: false, fog: false })))
  stars.renderOrder = -1
  stars.visible = false
  group.add(stars)

  // ---- light: sky and ground fill and the sun (no shadow map: blobs under people, and the
  // shade painted into the ground) ----
  const hemi = new THREE.HemisphereLight(0xdcefff, 0x4d7a3c, 1.4)
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.6)
  sun.castShadow = false
  sun.target.position.set(8, 0, 0)
  group.add(hemi, sun, sun.target)

  // ---- the ground: grass, paths and plazas, with shade painted in ----
  const GX0 = BOUNDS.x0 - 14
  const GX1 = BOUNDS.x1 + 14
  const GZ0 = BOUNDS.z0 - 14
  const GZ1 = BOUNDS.z1 + 14
  const GW = GX1 - GX0
  const GD = GZ1 - GZ0
  const PX = 10 // texture pixels per meter
  const groundTex = canvasTexture(Math.round(GW * PX), Math.round(GD * PX), (ctx, w, h) => {
    const X = (x) => (x - GX0) * PX
    const Z = (z) => (z - GZ0) * PX
    ctx.fillStyle = "#6fae55"
    ctx.fillRect(0, 0, w, h)
    let s = 11
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    // grass: mottled
    for (let i = 0; i < 9000; i++) {
      const v = rnd()
      ctx.fillStyle = v < 0.5 ? `rgba(40,90,30,${0.05 + rnd() * 0.08})` : `rgba(170,210,120,${0.04 + rnd() * 0.07})`
      const r = 2 + rnd() * 10
      ctx.beginPath()
      ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2)
      ctx.fill()
    }
    // the paths and plazas (pale concrete)
    ctx.fillStyle = "#cfc8b8"
    ctx.fillRect(X(BOUNDS.x0 + 0.5), Z(-PATH_W / 2), X(MACHINE_COURT.x - PEN.hx) - X(BOUNDS.x0 + 0.5), PATH_W * PX)
    ctx.fillRect(X(-31), Z(-4), X(-22.3) - X(-31), 8 * PX) // the west plaza
    ctx.fillRect(X(-2.1), Z(-15), 4.2 * PX, 30 * PX) // the walk between the pens
    // the strips under the bleachers and racks
    for (const c of COURTS) {
      const z0 = Math.min(c.fenceZ, c.fenceZ - c.side * 1.6)
      ctx.fillRect(X(c.x - PEN.hx - 0.3), Z(z0), (2 * PEN.hx + 0.6) * PX, 1.6 * PX)
    }
    ctx.beginPath()
    ctx.arc(X(FOUNTAIN.x), Z(FOUNTAIN.z), 3.2 * PX, 0, Math.PI * 2)
    ctx.fill()
    // concrete: a little grain
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.04})`
      ctx.fillRect(rnd() * w, rnd() * h, 2, 2)
    }
    // the pens' concrete pads (dark green-grey), each a shade darker at the edges
    for (const c of [...COURTS, MACHINE_COURT]) {
      ctx.fillStyle = "#4a6b5a"
      ctx.fillRect(X(c.x - PEN.hx), Z(c.z - PEN.hz), 2 * PEN.hx * PX, 2 * PEN.hz * PX)
    }
    // shade: under the trees, along the pens' windscreens, under benches and bleachers
    const shade = (x, z, r, a) => {
      const g = ctx.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), r * PX)
      g.addColorStop(0, `rgba(10,30,10,${a})`)
      g.addColorStop(1, "rgba(10,30,10,0)")
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(X(x), Z(z), r * PX, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const t of TREES) shade(t.x + 0.6, t.z + 0.5, 2.6 * t.s, 0.38)
    for (const b of BENCHES) shade(b.x, b.z, 1.1, 0.3)
    for (const c of COURTS) {
      ctx.fillStyle = "rgba(10,25,15,0.18)"
      ctx.fillRect(X(c.bleacher.x - c.bleacher.len / 2), Z(c.bleacher.z - 0.7), c.bleacher.len * PX, 1.4 * PX)
    }
    shade(BOOTH.x + 0.8, BOOTH.z + 0.6, 4, 0.35)
  })
  keep(groundTex)
  groundTex.anisotropy = 4
  const groundMat = lambert(0xffffff, { map: groundTex })
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(GW, GD)), groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.set((GX0 + GX1) / 2, 0, (GZ0 + GZ1) / 2)
  ground.renderOrder = -0.5 // (kept out of mergeStatic: it carries its own big texture)
  group.add(ground)
  // grass beyond, to the horizon
  const far = new THREE.Mesh(keep(new THREE.CircleGeometry(175, 36)), lambert(0x5f9e48))
  far.rotation.x = -Math.PI / 2
  far.position.y = -0.04
  group.add(far)

  // ---- the courts ----
  const grain = keep(
    canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, w, h)
      for (let i = 0; i < 3000; i++) {
        const v = Math.random() * 0.08 - 0.04
        ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`
        ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2)
      }
    })
  )
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping
  grain.repeat.set(3, 6)
  const courtMat = std(0x2f62ad, { map: grain, roughness: 0.8 })
  const kitchenMat = std(0x3b75c4, { map: grain, roughness: 0.8 })
  const runoffMat = std(0x3c8a5a, { roughness: 0.9 })
  const lineMat = std(0xf4f7fb, { roughness: 0.7 })
  const postMat = std(0x2b2f36, { roughness: 0.5, metalness: 0.3 })
  const netTex = keep(
    canvasTexture(32, 32, (ctx, w) => {
      ctx.clearRect(0, 0, w, w)
      ctx.strokeStyle = "rgba(20,24,30,0.85)"
      ctx.lineWidth = 3
      ctx.strokeRect(0, 0, w, w)
    })
  )
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping
  const netMat = keep(new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }))
  const tapeMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }))
  // shared court pieces, in a court's own frame (net along x)
  const courtGeo = keep(new THREE.PlaneGeometry(2 * HALF_W, 2 * HALF_L).rotateX(-Math.PI / 2))
  const kitchenGeo = keep(new THREE.PlaneGeometry(2 * HALF_W, 2 * KITCHEN).rotateX(-Math.PI / 2).translate(0, 0.001, 0))
  const runoffGeo = keep(new THREE.PlaneGeometry(2 * PEN.hz, 2 * PEN.hx).rotateX(-Math.PI / 2).translate(0, -0.002, 0))
  const lp = []
  const L = LINE_W
  const y = 0.003
  quad(lp, -HALF_W, -HALF_L, HALF_W, -HALF_L + L, y)
  quad(lp, -HALF_W, HALF_L - L, HALF_W, HALF_L, y)
  quad(lp, -HALF_W, -HALF_L, -HALF_W + L, HALF_L, y)
  quad(lp, HALF_W - L, -HALF_L, HALF_W, HALF_L, y)
  quad(lp, -HALF_W, -KITCHEN, HALF_W, -KITCHEN + L, y)
  quad(lp, -HALF_W, KITCHEN - L, HALF_W, KITCHEN, y)
  quad(lp, -L / 2, KITCHEN, L / 2, HALF_L, y)
  quad(lp, -L / 2, -HALF_L, L / 2, -KITCHEN, y)
  const linesGeo = keep(new THREE.BufferGeometry())
  linesGeo.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3))
  linesGeo.computeVertexNormals()
  const SEG = 24
  const netPos = []
  const netUv = []
  const tapePos = []
  const netIdx = []
  for (let i = 0; i <= SEG; i++) {
    const x = -NET_POST_X + (2 * NET_POST_X * i) / SEG
    const top = netHeightAt(x)
    netPos.push(x, 0.07, 0, x, top - 0.045, 0)
    netUv.push(x / 0.045, 0.07 / 0.045, x / 0.045, (top - 0.045) / 0.045)
    tapePos.push(x, top - 0.05, 0, x, top + 0.004, 0)
    if (i < SEG) {
      const a = i * 2
      netIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  const netGeo = keep(new THREE.BufferGeometry())
  netGeo.setAttribute("position", new THREE.Float32BufferAttribute(netPos, 3))
  netGeo.setAttribute("uv", new THREE.Float32BufferAttribute(netUv, 2))
  netGeo.setIndex(netIdx)
  const tapeGeo = keep(new THREE.BufferGeometry())
  tapeGeo.setAttribute("position", new THREE.Float32BufferAttribute(tapePos, 3))
  tapeGeo.setIndex(netIdx)
  const postGeo = keep(new THREE.CylinderGeometry(0.04, 0.045, 0.98, 8).translate(0, 0.49, 0))

  // a court group per court (the matches' figures and balls go in these: a court's frame)
  const courtGroups = []
  const addCourt = (c) => {
    const g = new THREE.Group()
    g.position.set(c.x, 0, c.z)
    g.rotation.y = Math.PI / 2
    g.updateMatrixWorld(true)
    const add = (geo, mat, order = 0) => {
      const m = new THREE.Mesh(geo, mat)
      m.renderOrder = order
      g.add(m)
      return m
    }
    add(runoffGeo, runoffMat)
    add(courtGeo, courtMat)
    add(kitchenGeo, kitchenMat)
    add(linesGeo, lineMat)
    add(netGeo, netMat, 2)
    add(tapeGeo, tapeMat)
    for (const s of [-1, 1]) add(postGeo, postMat).position.x = s * NET_POST_X
    group.add(g)
    return g
  }
  for (const c of COURTS) courtGroups[c.id] = addCourt(c)
  const machineGroup = addCourt(MACHINE_COURT)

  // ---- the pens: chain-link on posts, a windscreen, a gate onto the path ----
  const fenceTex = keep(
    canvasTexture(64, 64, (ctx, w) => {
      ctx.clearRect(0, 0, w, w)
      ctx.strokeStyle = "rgba(60,72,70,0.55)"
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(0, w / 2)
      ctx.lineTo(w / 2, 0)
      ctx.lineTo(w, w / 2)
      ctx.lineTo(w / 2, w)
      ctx.closePath()
      ctx.stroke()
    })
  )
  fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping
  const fenceMat = keep(new THREE.MeshBasicMaterial({ map: fenceTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }))
  const screenMat = lambert(0x1f4a37, { side: THREE.DoubleSide })
  const railMat = lambert(0x3d4a45)
  const gateMat = lambert(0x24302c)
  const fencePosts = []
  const fenceSide = (x0, z0, x1, z1, { gate = null } = {}) => {
    // a straight run of fence from (x0, z0) to (x1, z1), with an opening for a gate (the
    // windscreen stops there)
    const len = Math.hypot(x1 - x0, z1 - z0)
    const ry = -Math.atan2(z1 - z0, x1 - x0)
    const geo = keep(new THREE.PlaneGeometry(len, PEN.h))
    const uv = geo.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len * 6, uv.getY(i) * PEN.h * 6)
    const f = new THREE.Mesh(geo, fenceMat)
    f.position.set((x0 + x1) / 2, PEN.h / 2, (z0 + z1) / 2)
    f.rotation.y = ry
    f.renderOrder = 1
    group.add(f)
    const runs = gate ? [[0, gate.at - gate.w / 2], [gate.at + gate.w / 2, len]] : [[0, len]]
    for (const [a, b] of runs) {
      if (b - a < 0.05) continue
      const s = new THREE.Mesh(keep(new THREE.PlaneGeometry(b - a, 1.15)), screenMat)
      const mid = (a + b) / 2 / len
      s.position.set(x0 + (x1 - x0) * mid, 0.575, z0 + (z1 - z0) * mid)
      s.rotation.y = ry
      group.add(s)
    }
    const rail = new THREE.Mesh(keep(new THREE.BoxGeometry(len, 0.05, 0.05)), railMat)
    rail.position.set((x0 + x1) / 2, PEN.h, (z0 + z1) / 2)
    rail.rotation.y = ry
    group.add(rail)
    const n = Math.max(1, Math.round(len / 3.3))
    for (let i = 0; i <= n; i++) fencePosts.push([x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n])
    if (gate) {
      // the gate: a frame and a closed door panel (darker), a little proud of the fence
      for (const d of [-gate.w / 2, gate.w / 2]) {
        const k = (gate.at + d) / len
        const p = new THREE.Mesh(keep(new THREE.BoxGeometry(0.07, PEN.h + 0.05, 0.07)), gateMat)
        p.position.set(x0 + (x1 - x0) * k, (PEN.h + 0.05) / 2, z0 + (z1 - z0) * k)
        group.add(p)
      }
      const k = gate.at / len
      const top = new THREE.Mesh(keep(new THREE.BoxGeometry(gate.w, 0.07, 0.07)), gateMat)
      top.position.set(x0 + (x1 - x0) * k, 2.2, z0 + (z1 - z0) * k)
      top.rotation.y = ry
      group.add(top)
    }
  }
  const pen = (c, gateOn) => {
    const x0 = c.x - PEN.hx
    const x1 = c.x + PEN.hx
    const z0 = c.z - PEN.hz
    const z1 = c.z + PEN.hz
    fenceSide(x0, z0, x1, z0, gateOn === "n" ? { gate: { at: c.gate.x - x0, w: 1.4 } } : {})
    fenceSide(x0, z1, x1, z1, gateOn === "s" ? { gate: { at: c.gate.x - x0, w: 1.4 } } : {})
    fenceSide(x0, z0, x0, z1, gateOn === "w" ? { gate: { at: PEN.hz, w: 1.4 } } : {})
    fenceSide(x1, z0, x1, z1)
  }
  for (const c of COURTS) pen(c, c.side < 0 ? "s" : "n")
  pen(MACHINE_COURT, "w")
  const fencePostMesh = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.035, 0.035, PEN.h, 5)), railMat, fencePosts.length)
  fencePosts.forEach(([x, z], i) => fencePostMesh.setMatrixAt(i, m4.makeTranslation(x, PEN.h / 2, z)))
  group.add(fencePostMesh)

  // ---- bleachers: aluminum planks on dark frames ----
  const plankMat = std(0xb9c0c8, { roughness: 0.45, metalness: 0.5 })
  const frameMat = lambert(0x3a3f47)
  for (const c of COURTS) {
    const b = c.bleacher
    SEAT_ROWS.forEach((row) => {
      const seat = new THREE.Mesh(keep(new THREE.BoxGeometry(b.len, 0.05, 0.36)), plankMat)
      seat.position.set(b.x, row.y - 0.03, b.z + c.side * row.off)
      group.add(seat)
      // a footboard in front of each row
      const foot = new THREE.Mesh(keep(new THREE.BoxGeometry(b.len, 0.04, 0.3)), plankMat)
      foot.position.set(b.x, row.y - 0.42, b.z + c.side * (row.off + 0.33))
      if (row.y - 0.42 > 0.05) group.add(foot)
    })
    for (let i = 0; i < 4; i++) {
      const fr = new THREE.Mesh(keep(new THREE.BoxGeometry(0.06, 0.9, 1.0)), frameMat)
      fr.position.set(b.x - b.len / 2 + 0.2 + (i * (b.len - 0.4)) / 3, 0.43, b.z)
      group.add(fr)
    }
  }
  // ---- benches ----
  const woodMat = lambert(0x8a5a33)
  for (const bn of BENCHES) {
    const g = new THREE.Group()
    const seat = new THREE.Mesh(keep(new THREE.BoxGeometry(1.5, 0.06, 0.42)), woodMat)
    seat.position.y = 0.43
    g.add(seat)
    const back = new THREE.Mesh(keep(new THREE.BoxGeometry(1.5, 0.4, 0.05)), woodMat)
    back.position.set(0, 0.72, -0.2)
    back.rotation.x = -0.15
    g.add(back)
    for (const d of [-0.65, 0.65]) {
      const leg = new THREE.Mesh(keep(new THREE.BoxGeometry(0.06, 0.43, 0.4)), frameMat)
      leg.position.set(d, 0.215, 0)
      g.add(leg)
    }
    g.position.set(bn.x, 0, bn.z)
    g.rotation.y = bn.yaw
    group.add(g)
  }

  // ---- the paddle racks (a paddle per person waiting: setRacks) ----
  const RACK_N = 8
  for (const c of COURTS) {
    const post = new THREE.Mesh(keep(new THREE.BoxGeometry(0.08, 1.2, 0.08)), frameMat)
    post.position.set(c.rack.x, 0.6, c.rack.z)
    group.add(post)
    const board = new THREE.Mesh(keep(new THREE.BoxGeometry(1.5, 0.5, 0.06)), woodMat)
    board.position.set(c.rack.x, 0.95, c.rack.z)
    group.add(board)
  }
  const paddleGeo = keep(new THREE.BoxGeometry(0.19, 0.27, 0.02).translate(0, 0.14, 0))
  const handleGeo = keep(new THREE.CylinderGeometry(0.014, 0.014, 0.13, 5).translate(0, -0.06, 0))
  const rackPaddles = new THREE.InstancedMesh(paddleGeo, lambert(0xffffff), COURTS.length * RACK_N)
  const rackHandles = new THREE.InstancedMesh(handleGeo, lambert(0x222222), COURTS.length * RACK_N)
  rackPaddles.count = 0
  rackHandles.count = 0
  rackPaddles.frustumCulled = false
  rackHandles.frustumCulled = false
  group.add(rackPaddles, rackHandles)
  const tmpColor = new THREE.Color()
  // racks: [[{ color } ...] per court], the next up first
  const setRacks = (racks) => {
    let n = 0
    COURTS.forEach((c, ci) => {
      const list = (racks[ci] || []).slice(0, RACK_N)
      list.forEach((p, i) => {
        const x = c.rack.x - 0.62 + i * 0.18
        q.setFromEuler(new THREE.Euler(-0.12 * c.side, 0, 0.08 * ((i % 2) - 0.5)))
        m4.compose(v1.set(x, 1.12, c.rack.z - c.side * 0.05), q, v2.set(1, 1, 1))
        rackPaddles.setMatrixAt(n, m4)
        rackHandles.setMatrixAt(n, m4)
        rackPaddles.setColorAt(n, tmpColor.set(p.color || "#ffd23f"))
        n++
      })
    })
    rackPaddles.count = n
    rackHandles.count = n
    rackPaddles.instanceMatrix.needsUpdate = true
    rackHandles.instanceMatrix.needsUpdate = true
    if (rackPaddles.instanceColor) rackPaddles.instanceColor.needsUpdate = true
  }

  // ---- each court's scoreboard: by the net post on the bleachers' side ----
  const boards = COURTS.map((c) => {
    const canvas = document.createElement("canvas")
    canvas.width = 256
    canvas.height = 128
    const tex = keep(new THREE.CanvasTexture(canvas))
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = keep(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }))
    const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.6, 0.8)), mat)
    // outside the fence, facing the path, at eye height above the bleachers' back row
    // (at the pen's far end from the gate: seen from the path, out of the sideline view)
    const bx = c.x + Math.sign(c.x) * (PEN.hx - 1.3)
    m.position.set(bx, 2.5, c.fenceZ - c.side * 0.12)
    m.rotation.y = c.side > 0 ? Math.PI : 0
    m.renderOrder = 0.5 // (own texture: not merged)
    group.add(m)
    for (const d of [-0.7, 0.7]) {
      const p = new THREE.Mesh(keep(new THREE.BoxGeometry(0.05, 2.5, 0.05)), frameMat)
      p.position.set(bx + d, 1.25, c.fenceZ - c.side * 0.12)
      group.add(p)
    }
    return { canvas, tex, last: "" }
  })
  // { names: [a, b], score: [a, b], note } -> drawn on court c's board
  const setScore = (id, { names = ["", ""], score = [0, 0], note = "" } = {}) => {
    const b = boards[id]
    const c = COURTS[id]
    if (!b) return
    const key = `${names.join("|")}|${score.join("-")}|${note}`
    if (key === b.last) return
    b.last = key
    const ctx = b.canvas.getContext("2d")
    ctx.fillStyle = "#0d1a14"
    ctx.fillRect(0, 0, 256, 128)
    ctx.fillStyle = "#ffd23f"
    ctx.fillRect(0, 0, 256, 6)
    ctx.textBaseline = "middle"
    ctx.textAlign = "left"
    ctx.fillStyle = "#ffd23f"
    fit(ctx, `${c.name.toUpperCase()} · ${LEVEL_NAMES[c.level].toUpperCase()}`, 20, 12, 236)
    ctx.fillText(`${c.name.toUpperCase()} · ${LEVEL_NAMES[c.level].toUpperCase()}`, 10, 22)
    for (let i = 0; i < 2; i++) {
      const yy = 58 + i * 34
      ctx.textAlign = "left"
      ctx.fillStyle = i ? "#ff8a7a" : "#7fe3ef"
      fit(ctx, String(names[i] || "").toUpperCase(), 22, 12, 180)
      ctx.fillText(String(names[i] || "").toUpperCase(), 10, yy, 180)
      ctx.textAlign = "right"
      ctx.fillStyle = "#ffffff"
      ctx.font = "bold 30px Arial, sans-serif"
      ctx.fillText(String(score[i] ?? 0), 246, yy)
    }
    if (note) {
      ctx.fillStyle = "rgba(13,26,20,0.8)"
      ctx.fillRect(0, 108, 256, 20)
      ctx.textAlign = "center"
      ctx.fillStyle = "#ffd23f"
      fit(ctx, note, 15, 10, 240)
      ctx.fillText(note, 128, 118)
    }
    b.tex.needsUpdate = true
  }

  // ---- the park rep board, by the pro shop ----
  const repCanvas = document.createElement("canvas")
  repCanvas.width = 512
  repCanvas.height = 320
  const repTex = keep(new THREE.CanvasTexture(repCanvas))
  repTex.colorSpace = THREE.SRGBColorSpace
  const repBoard = new THREE.Mesh(keep(new THREE.PlaneGeometry(BOARD.w, BOARD.h)), keep(new THREE.MeshBasicMaterial({ map: repTex })))
  repBoard.position.set(BOARD.x + 0.06, 1.9, BOARD.z)
  repBoard.rotation.y = BOARD.yaw
  repBoard.renderOrder = 0.5
  group.add(repBoard)
  const boardBack = new THREE.Mesh(keep(new THREE.BoxGeometry(0.1, BOARD.h + 0.2, BOARD.w + 0.2)), woodMat)
  boardBack.position.set(BOARD.x, 1.9, BOARD.z)
  group.add(boardBack)
  for (const d of [-1, 1]) {
    const p = new THREE.Mesh(keep(new THREE.BoxGeometry(0.1, 1.0, 0.1)), frameMat)
    p.position.set(BOARD.x, 0.5, BOARD.z + d * (BOARD.w / 2 - 0.2))
    group.add(p)
  }
  // lines: [{ name, text, you }]
  const setBoard = (rows = []) => {
    const ctx = repCanvas.getContext("2d")
    ctx.fillStyle = "#13261c"
    ctx.fillRect(0, 0, 512, 320)
    ctx.strokeStyle = "#c9b36a"
    ctx.lineWidth = 6
    ctx.strokeRect(3, 3, 506, 314)
    ctx.fillStyle = "#ffd23f"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.font = "bold 40px Arial, sans-serif"
    ctx.fillText("PARK REP", 256, 40)
    ctx.textAlign = "left"
    rows.slice(0, 6).forEach((r, i) => {
      const yy = 96 + i * 38
      ctx.fillStyle = r.you ? "#7fe3ef" : "#ffffff"
      fit(ctx, r.name, 28, 16, 230)
      ctx.fillText(r.name, 24, yy, 230)
      ctx.fillStyle = "#c9e7cf"
      fit(ctx, r.text, 24, 14, 236)
      ctx.textAlign = "right"
      ctx.fillText(r.text, 490, yy, 236)
      ctx.textAlign = "left"
    })
    repTex.needsUpdate = true
  }

  // ---- the pro shop (the Locker Room): a booth with a striped awning ----
  const booth = new THREE.Mesh(keep(new THREE.BoxGeometry(BOOTH.hx * 2, 2.6, BOOTH.hz * 2)), lambert(0xe9dcc4))
  booth.position.set(BOOTH.x, 1.3, BOOTH.z)
  group.add(booth)
  const awningTex = keep(
    canvasTexture(128, 16, (ctx, w, h) => {
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? "#ffffff" : "#e63946"
        ctx.fillRect((i * w) / 8, 0, w / 8, h)
      }
    })
  )
  const awning = new THREE.Mesh(keep(new THREE.BoxGeometry(1.2, 0.06, BOOTH.hz * 2 + 0.4)), keep(new THREE.MeshLambertMaterial({ map: awningTex })))
  awning.position.set(BOOTH.x + BOOTH.hx + 0.5, 2.55, BOOTH.z)
  awning.rotation.z = -0.25
  awning.renderOrder = 0.5
  group.add(awning)
  const roof = new THREE.Mesh(keep(new THREE.BoxGeometry(BOOTH.hx * 2 + 0.3, 0.2, BOOTH.hz * 2 + 0.3)), lambert(0x8c3b2f))
  roof.position.set(BOOTH.x, 2.7, BOOTH.z)
  group.add(roof)
  const signTex = keep(
    canvasTexture(512, 128, (ctx, w, h) => {
      ctx.fillStyle = "#1d3557"
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = "#ffd23f"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.font = "bold 54px Arial, sans-serif"
      ctx.fillText("PRO SHOP", w / 2, 46)
      ctx.fillStyle = "#ffffff"
      ctx.font = "bold 34px Arial, sans-serif"
      ctx.fillText("LOCKER ROOM", w / 2, 98)
    })
  )
  const sign = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.6, 0.65)), keep(new THREE.MeshBasicMaterial({ map: signTex })))
  sign.position.set(BOOTH.x + BOOTH.hx + 0.02, 2.05, BOOTH.z)
  sign.rotation.y = Math.PI / 2
  sign.renderOrder = 0.5
  group.add(sign)
  // a counter and a window
  const counter = new THREE.Mesh(keep(new THREE.BoxGeometry(0.4, 1.0, 2.2)), lambert(0x8a5a33))
  counter.position.set(BOOTH.x + BOOTH.hx + 0.2, 0.5, BOOTH.z)
  group.add(counter)

  // ---- the fountain ----
  const stone = lambert(0xbab2a2)
  const basin = new THREE.Mesh(keep(new THREE.CylinderGeometry(FOUNTAIN.r, FOUNTAIN.r + 0.08, 0.5, 18)), stone)
  basin.position.set(FOUNTAIN.x, 0.25, FOUNTAIN.z)
  group.add(basin)
  const water = new THREE.Mesh(keep(new THREE.CircleGeometry(FOUNTAIN.r - 0.08, 18).rotateX(-Math.PI / 2)), keep(new THREE.MeshLambertMaterial({ color: 0x4aa8d8, emissive: 0x0a3a5a })))
  water.position.set(FOUNTAIN.x, 0.48, FOUNTAIN.z)
  group.add(water)
  const column = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.12, 0.16, 0.9, 10)), stone)
  column.position.set(FOUNTAIN.x, 0.9, FOUNTAIN.z)
  group.add(column)
  const bowl = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.42, 0.18, 0.16, 14)), stone)
  bowl.position.set(FOUNTAIN.x, 1.38, FOUNTAIN.z)
  group.add(bowl)

  // ---- the ball machine and its balls ----
  const machine = new THREE.Group()
  const mBody = new THREE.Mesh(keep(new THREE.BoxGeometry(0.6, 0.55, 0.5)), lambert(0x2b2b2b))
  mBody.position.y = 0.45
  machine.add(mBody)
  const hopper = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.32, 0.22, 0.35, 10)), lambert(0x3a6fd6))
  hopper.position.y = 0.9
  machine.add(hopper)
  const tube = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8)), lambert(0x111111))
  tube.rotation.x = Math.PI / 2.5
  tube.position.set(0, 0.6, 0.3)
  machine.add(tube)
  machine.position.set(0, 0, -HALF_L + 0.6)
  machineGroup.add(machine)
  const balls = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.04, 6, 4)), lambert(0xe6f046), 26)
  let bs = 19
  const brnd = () => ((bs = (bs * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 26; i++) balls.setMatrixAt(i, m4.makeTranslation((brnd() - 0.5) * 2 * HALF_W, 0.04, 1 + brnd() * (HALF_L - 1)))
  machineGroup.add(balls)

  // ---- trees, light poles ----
  const crown = new THREE.InstancedMesh(keep(new THREE.IcosahedronGeometry(1.6, 0)), lambert(0x2f7a3c, { flatShading: true }), TREES.length)
  const trunk = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.18, 0.25, 2, 5)), lambert(0x6b4a2b), TREES.length)
  TREES.forEach((t, i) => {
    crown.setMatrixAt(i, m4.compose(v1.set(t.x, 2.6 * t.s + 1, t.z), q.setFromEuler(new THREE.Euler(0, t.x, 0)), v2.set(t.s, t.s * 1.25, t.s)))
    trunk.setMatrixAt(i, m4.compose(v1.set(t.x, t.s, t.z), q.identity(), v2.set(t.s, t.s, t.s)))
  })
  group.add(crown, trunk)
  const hillMat = lambert(0x5d9a4a, { flatShading: true })
  for (const [x, z, r] of [[-60, -110, 38], [30, -125, 48], [95, -80, 34], [-110, -40, 30], [120, 30, 36], [-95, 70, 30], [40, 110, 40]]) {
    const hill = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(r, 1)), hillMat)
    hill.scale.y = 0.35
    hill.position.set(x, -2, z)
    group.add(hill)
  }
  const POLE_H = 7.5
  const poles = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.07, 0.1, POLE_H, 6)), frameMat, LIGHTS.length)
  const lampMat = keep(new THREE.MeshBasicMaterial({ color: 0x9aa0a8 }))
  const lamps = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.5, 0.18, 0.35)), lampMat, LIGHTS.length)
  LIGHTS.forEach((l, i) => {
    poles.setMatrixAt(i, m4.makeTranslation(l.x, POLE_H / 2, l.z))
    lamps.setMatrixAt(i, m4.makeTranslation(l.x, POLE_H, l.z))
  })
  group.add(poles, lamps)
  // at night: a pool of light on each court (additive, a soft gradient)
  const poolTex = keep(
    canvasTexture(128, 128, (ctx, w) => {
      const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
      g.addColorStop(0, "rgba(255,244,214,0.55)")
      g.addColorStop(0.6, "rgba(255,244,214,0.32)")
      g.addColorStop(1, "rgba(255,244,214,0)")
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, w)
    })
  )
  const poolMat = keep(new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  const pools = new THREE.Group()
  for (const c of [...COURTS, MACHINE_COURT]) {
    const p = new THREE.Mesh(keep(new THREE.PlaneGeometry(2 * PEN.hx + 6, 2 * PEN.hz + 6).rotateX(-Math.PI / 2)), poolMat)
    p.position.set(c.x, 0.012, c.z)
    p.renderOrder = 2
    pools.add(p)
  }
  pools.visible = false

  mergeStatic(group, keep)
  // (added after the merge: switched on and off by the time of day)
  group.add(pools)
  // nothing here moves: its matrices are worked out once (what's added later to a court's
  // group, the players and the ball, still updates itself)
  group.traverse((o) => {
    o.updateMatrix()
    o.matrixAutoUpdate = false
  })
  group.updateMatrixWorld(true)
  scene.add(group)
  scene.fog = new THREE.Fog(0xd8ecfb, 60, 170)

  // ---- the time of day (sky.js dayLook) ----
  const setDayLook = (d) => {
    skyMat.uniforms.top.value.setHex(d.sky[0])
    skyMat.uniforms.horizon.value.setHex(d.sky[1])
    stars.visible = !!d.stars
    sun.color.setHex(d.sun.color)
    sun.intensity = d.sun.intensity
    sun.position.set(8 + d.sun.dir.x * 40, d.sun.dir.y * 40, d.sun.dir.z * 40)
    hemi.color.setHex(d.hemi[0])
    hemi.groundColor.setHex(d.hemi[1])
    hemi.intensity = d.hemi[2]
    scene.fog.color.setHex(d.fog)
    groundMat.color.setScalar(d.ground)
    pools.visible = !!d.lights
    lampMat.color.setHex(d.lights ? 0xfff6d8 : 0x9aa0a8)
  }

  return {
    group,
    sun,
    hemi,
    courtGroups,
    machineGroup,
    setScore,
    setRacks,
    setBoard,
    setDayLook,
    dispose() {
      scene.remove(group)
      scene.fog = null
      disposables.forEach((d) => d.dispose?.())
      rackPaddles.dispose?.()
      rackHandles.dispose?.()
    },
  }
}
