// My Park: the park's picture (three.js), built once from a layout (layout.js: Riverside Park
// or a real venue from venuegen.js). Everything that never moves is merged into a handful of
// meshes (venue.js mergeStatic) or instanced (fence posts, trees, light poles, paddles in the
// racks, the ball machine's balls); the "lighting" under trees and round the courts is
// painted into the ground texture, so the park needs no shadow map. Night (sky.js) turns the
// court lights on: glowing lamps and a pool of light on each court. A real venue's own
// scenery (its other courts, fences, buildings, parking, an indoor hall) is scenery.js.

import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { HALF_L } from "../physics.js"
import { mergeStatic } from "../venue.js"
import { mergeByLook, singlePass } from "./perf.js"
import { LEVEL_NAMES, PATH_W, PEN, RIVERSIDE_LAYOUT, SEAT_ROWS } from "./layout.js"
import { createCourtKit } from "./courtkit.js"
import { buildScenery } from "./scenery.js"
import { applySurfaces, surfaced, surfSky, surfWet } from "./surfaces.js"
import { bakeVenueAO, clearBakedAO, setBakedAOOn } from "./occlusion.js"
import { chainLink, setWindStrength, windscreenTex } from "./detail.js"
import { createPrecip, createRealSky } from "./realsky.js"
import { horizonMeshes, setHorizonLook } from "./horizon.js"

const canvasTexture = (w, h, draw) => {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  draw(c.getContext("2d"), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
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
// a box's y rotation that lays its length (local x) along the direction (ax, az)
const yawFor = (ax, az) => Math.atan2(-az, ax)

export const buildPark = (scene, { quality = "medium", layout = RIVERSIDE_LAYOUT, cutaway = false, phone = false } = {}) => {
  const L = layout
  const { BENCHES, BOARD, BOOTH, BOUNDS, COURTS, FOUNTAIN, LIGHTS, MACHINE_COURT, TREES } = L
  const S = L.spec.scene || null // a real venue's scenery (venuegen.js)
  const riverside = !S
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
  // (a big venue: a bigger sky)
  const span = Math.max(BOUNDS.x1 - BOUNDS.x0, BOUNDS.z1 - BOUNDS.z0)
  // (it follows the camera, followSky(), so it stays inside the camera's far plane)
  const skyR = S ? 330 : Math.max(190, span * 0.9 + 120)
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(skyR, 24, 12)), skyMat)
  sky.position.set((BOUNDS.x0 + BOUNDS.x1) / 2, 0, (BOUNDS.z0 + BOUNDS.z1) / 2)
  sky.renderOrder = -1
  sky.frustumCulled = false
  group.add(sky)
  const starPos = new Float32Array(400 * 3)
  let ss = 3
  const srnd = () => ((ss = (ss * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 400; i++) {
    const a = srnd() * Math.PI * 2
    const e = 0.15 + srnd() * 1.2
    starPos.set([Math.cos(a) * Math.cos(e) * skyR * 0.95, Math.sin(e) * skyR * 0.95, Math.sin(a) * Math.cos(e) * skyR * 0.95], i * 3)
  }
  const starGeo = keep(new THREE.BufferGeometry())
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3))
  const stars = new THREE.Points(starGeo, keep(new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, sizeAttenuation: false, fog: false })))
  stars.position.copy(sky.position)
  stars.renderOrder = -1
  stars.visible = false
  group.add(stars)
  // Real Sky (realsky.js; Medium/High): the physical sky, clouds, sun and moon, used when the
  // look is a real one (sky.js realLook); the gradient above otherwise. Rain or snow outdoors.
  const real = quality !== "low" ? createRealSky({ radius: skyR * 0.99, quality, phone }) : null
  if (real) {
    real.mesh.position.copy(sky.position)
    real.mesh.visible = false
    group.add(real.mesh)
  }
  // the real skyline (horizon.js: the terrain round the venue from elevation tiles, the sea)
  const horizon = S?.horizon ? horizonMeshes(S.horizon) : []
  for (const m of horizon) {
    keep(m.geometry)
    keep(m.material)
    m.position.copy(sky.position)
    group.add(m)
  }
  const precip = quality !== "low" && !S?.indoor ? createPrecip({ quality, phone }) : null
  if (precip) group.add(precip.mesh)

  // ---- light: sky and ground fill and the sun (no shadow map: blobs under people, and the
  // shade painted into the ground) ----
  const hemi = new THREE.HemisphereLight(0xdcefff, 0x4d7a3c, 1.4)
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.6)
  sun.castShadow = false
  sun.target.position.set(8, 0, 0)
  group.add(hemi, sun, sun.target)

  // ---- the courts (a group per live court: the matches' figures and balls go in these) ----
  const kit = createCourtKit({ keep, std, colors: S ? hexColors(S.colors) : {} })
  const courtGroups = []
  let machineGroup = null
  let groundMat = null
  let scenery = null

  if (riverside) {
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
      // the pens' concrete pads (dark green-grey)
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
    groundMat = surfaced(lambert(0xffffff, { map: groundTex }), "ground")
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
    for (const c of COURTS) {
      courtGroups[c.id] = kit.pickleball(c.x, c.z, c.rot)
      group.add(courtGroups[c.id])
    }
    machineGroup = kit.pickleball(MACHINE_COURT.x, MACHINE_COURT.z, MACHINE_COURT.rot)
    group.add(machineGroup)
  } else {
    // a real venue: its ground, every court, fences, buildings, parking, the hall (scenery.js)
    scenery = buildScenery({ group, keep, lambert, std, kit, layout: L, scene: S, quality, cutaway })
    groundMat = scenery.groundMat
    for (const c of S.courts) {
      if (c.live !== null && c.live !== undefined) courtGroups[c.live] = scenery.courtGroup(c)
      if (c.machine) machineGroup = scenery.courtGroup(c)
    }
  }

  // ---- the pens (Riverside): chain-link on posts, a windscreen, a gate onto the path ----
  const fenceTex = keep(
    canvasTexture(64, 64, (ctx, w) => {
      ctx.clearRect(0, 0, w, w)
      // (a venue's own fence color: dark green-black coated, or galvanized grey)
      const fc = S?.colors?.fence ? parseInt(S.colors.fence.slice(1), 16) : null
      ctx.strokeStyle = fc === null ? "rgba(60,72,70,0.55)" : `rgba(${(fc >> 16) & 255},${(fc >> 8) & 255},${fc & 255},0.6)`
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
  // (a venue on Medium/High, detail.js: a woven wire with a highlight, lit, and its cut-out shadow)
  const wire = S && quality !== "low" ? chainLink(S?.colors?.fence ? parseInt(S.colors.fence.slice(1), 16) : null) : null
  const fenceMat = wire
    ? keep(new THREE.MeshLambertMaterial({ map: keep(wire.tex), transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.05 }))
    : keep(new THREE.MeshBasicMaterial({ map: fenceTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }))
  // (Medium/High: a woven screen with hems and grommets, detail.js)
  const screenMat = lambert(S?.colors?.windscreen ? new THREE.Color(S.colors.windscreen).getHex() : 0x1f4a37, { side: THREE.DoubleSide, ...(wire ? { map: keep(windscreenTex()) } : {}) })
  const railMat = lambert(S?.colors?.fence ? parseInt(S.colors.fence.slice(1), 16) : 0x3d4a45)
  const gateMat = lambert(0x24302c)
  const fencePosts = []
  // (a venue's windscreens: fence.screen false = none, fence.screenH = their height)
  const SCREEN_H = S?.fence?.screenH ?? 1.15
  const fenceSide = (x0, z0, x1, z1, { gates = [], h = PEN.h, screen = S?.fence?.screen !== false } = {}) => {
    // a straight run of fence from (x0, z0) to (x1, z1), with openings for gates (the
    // windscreen stops there)
    const len = Math.hypot(x1 - x0, z1 - z0)
    if (len < 0.05) return
    const ry = -Math.atan2(z1 - z0, x1 - x0)
    const geo = keep(new THREE.PlaneGeometry(len, h))
    const uv = geo.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len * 6, uv.getY(i) * h * 6)
    const f = new THREE.Mesh(geo, fenceMat)
    f.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2)
    f.rotation.y = ry
    f.renderOrder = 1
    if (wire) (f.customDepthMaterial = wire.depth), (f.userData.shadowCaster = true)
    group.add(f)
    if (screen) {
      const cuts = gates.slice().sort((a, b) => a.at - b.at)
      let from = 0
      const runs = []
      for (const g of cuts) {
        runs.push([from, g.at - g.w / 2])
        from = g.at + g.w / 2
      }
      runs.push([from, len])
      for (const [a, b] of runs) {
        if (b - a < 0.05) continue
        const sg = keep(new THREE.PlaneGeometry(b - a, Math.min(SCREEN_H, h)))
        if (wire) {
          const suv = sg.attributes.uv
          for (let i = 0; i < suv.count; i++) suv.setX(i, suv.getX(i) * (b - a))
        }
        const s = new THREE.Mesh(sg, screenMat)
        const mid = (a + b) / 2 / len
        s.position.set(x0 + (x1 - x0) * mid, Math.min(SCREEN_H, h) / 2, z0 + (z1 - z0) * mid)
        s.rotation.y = ry
        group.add(s)
      }
    }
    const rail = new THREE.Mesh(keep(new THREE.BoxGeometry(len, 0.05, 0.05)), railMat)
    rail.position.set((x0 + x1) / 2, h, (z0 + z1) / 2)
    rail.rotation.y = ry
    group.add(rail)
    const n = Math.max(1, Math.round(len / 3.3))
    for (let i = 0; i <= n; i++) fencePosts.push([x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n, h])
    for (const gate of gates) {
      // the gate: a frame and a closed door panel (darker), a little proud of the fence
      for (const d of [-gate.w / 2, gate.w / 2]) {
        const k = (gate.at + d) / len
        const p = new THREE.Mesh(keep(new THREE.BoxGeometry(0.07, h + 0.05, 0.07)), gateMat)
        p.position.set(x0 + (x1 - x0) * k, (h + 0.05) / 2, z0 + (z1 - z0) * k)
        group.add(p)
      }
      const k = gate.at / len
      const top = new THREE.Mesh(keep(new THREE.BoxGeometry(gate.w, 0.07, 0.07)), gateMat)
      top.position.set(x0 + (x1 - x0) * k, Math.min(2.2, h - 0.1), z0 + (z1 - z0) * k)
      top.rotation.y = ry
      group.add(top)
    }
  }
  // ---- a venue's measured fence types (spec fence.types; docs/venue-provenance.md): height,
  // mesh (colour, from y), posts (diameter, spacing, colour), rails (top + any more), a windscreen
  // band (y0..y1), a capped/padded top rail, a painted curb along the foot ----
  const typedMats = new Map()
  const typedMat = (c) => {
    if (!typedMats.has(c)) typedMats.set(c, lambert(new THREE.Color(c).getHex()))
    return typedMats.get(c)
  }
  // (galvanized steel: a light grey that catches the sun; round 4, the owner's partition photo)
  const galvMats = new Map()
  const frameMatFor = (c, T) => {
    const col = new THREE.Color(c)
    const hsl = {}
    col.getHSL(hsl)
    const metal = T?.post?.metal ?? (hsl.l > 0.55 && hsl.s < 0.12)
    if (!metal || quality === "low") return typedMat(c)
    if (!galvMats.has(c)) galvMats.set(c, std(col.getHex(), { roughness: 0.42, metalness: 0.45 }))
    return galvMats.get(c)
  }
  const meshMats = new Map()
  const meshMatFor = (c) => {
    if (meshMats.has(c)) return meshMats.get(c)
    const col = new THREE.Color(c).getHex()
    const w = S && quality !== "low" ? chainLink(col) : null
    let m
    if (w) m = { mat: keep(new THREE.MeshLambertMaterial({ map: keep(w.tex), transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.05 })), depth: w.depth }
    else {
      const t = keep(
        canvasTexture(64, 64, (ctx, s) => {
          ctx.clearRect(0, 0, s, s)
          ctx.strokeStyle = `rgba(${(col >> 16) & 255},${(col >> 8) & 255},${col & 255},0.6)`
          ctx.lineWidth = 4
          ctx.beginPath()
          ctx.moveTo(0, s / 2)
          ctx.lineTo(s / 2, 0)
          ctx.lineTo(s, s / 2)
          ctx.lineTo(s / 2, s)
          ctx.closePath()
          ctx.stroke()
        })
      )
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      m = { mat: keep(new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false })), depth: null }
    }
    meshMats.set(c, m)
    return m
  }
  const typedScreenMats = new Map()
  const typedScreenMat = (c) => {
    if (!typedScreenMats.has(c)) typedScreenMats.set(c, lambert(new THREE.Color(c).getHex(), { side: THREE.DoubleSide, ...(wire ? { map: keep(windscreenTex()) } : {}) }))
    return typedScreenMats.get(c)
  }
  // posts, bands and caps, instanced per colour: [x, z, h, d, y0]
  const typedPosts = new Map()
  const typedBands = new Map()
  const typedDomes = new Map()
  const push = (m, key, v) => (m.has(key) ? m.get(key) : m.set(key, []).get(key)).push(v)
  const typedSide = (x0, z0, x1, z1, T, gates, hIn, opens = []) => {
    const len = Math.hypot(x1 - x0, z1 - z0)
    if (len < 0.05) return
    const h = hIn ?? T.h ?? 3
    const ry = -Math.atan2(z1 - z0, x1 - x0)
    const at = (s, y) => [x0 + ((x1 - x0) * s) / len, y, z0 + ((z1 - z0) * s) / len]
    const fenceColor = T.mesh || S?.colors?.fence || "#2a302c"
    const frame = T.post?.color || fenceColor
    // runs between the gates
    const cuts = [...gates, ...opens].sort((a, b) => a.at - b.at)
    const runs = []
    let from = 0
    for (const g of cuts) {
      runs.push([from, g.at - g.w / 2])
      from = Math.max(from, g.at + g.w / 2)
    }
    runs.push([from, len])
    const curbH = T.curb?.h || 0
    const meshY0 = Math.max(curbH, T.meshFrom || 0)
    for (const [a, b] of runs) {
      if (b - a < 0.05) continue
      const L = b - a
      const mid = (a + b) / 2
      // the mesh (above the curb)
      if (T.mesh !== "none") {
        const mh = h - meshY0
        const geo = keep(new THREE.PlaneGeometry(L, mh))
        const uv = geo.attributes.uv
        // (diamonds per metre: real 2-2.25 in chain-link is ~18; T.weave)
        const k = T.weave || 14
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L * k, uv.getY(i) * mh * k)
        const mm = meshMatFor(fenceColor)
        const f = new THREE.Mesh(geo, mm.mat)
        f.position.set(...at(mid, meshY0 + mh / 2))
        f.rotation.y = ry
        f.renderOrder = 1
        if (mm.depth) (f.customDepthMaterial = mm.depth), (f.userData.shadowCaster = true)
        group.add(f)
      }
      // the windscreen band
      if (T.screen) {
        const y0 = T.screen.y0 ?? 0
        const y1 = Math.min(h, T.screen.y1 ?? h)
        const sg = keep(new THREE.PlaneGeometry(L, y1 - y0))
        if (wire) {
          const suv = sg.attributes.uv
          for (let i = 0; i < suv.count; i++) suv.setX(i, suv.getX(i) * L)
        }
        const s = new THREE.Mesh(sg, typedScreenMat(T.screen.color || S?.colors?.windscreen || "#1f2420"))
        s.position.set(...at(mid, (y0 + y1) / 2))
        s.rotation.y = ry
        group.add(s)
      }
      // the curb (a painted concrete kick-board along the foot)
      if (T.curb) {
        const cw = T.curb.w || 0.2
        const c = new THREE.Mesh(keep(new THREE.BoxGeometry(L, curbH, cw)), typedMat(T.curb.color || "#7a7a72"))
        c.position.set(...at(mid, curbH / 2))
        c.rotation.y = ry
        group.add(c)
      }
      // rails: the top one (or its cap) and any others (mid, bottom)
      const rd = T.railD || 0.045
      for (const y of [h, ...(T.rails || [])]) {
        if (y >= h - 0.01 && T.cap) continue
        const r = new THREE.Mesh(keep(new THREE.CylinderGeometry(rd / 2, rd / 2, L, 8).rotateZ(Math.PI / 2)), frameMatFor(frame, T))
        r.position.set(...at(mid, y))
        r.rotation.y = ry
        group.add(r)
      }
      if (T.cap) {
        // a thick top rail: padded/capped (Los Cab's green, owner photo 1: a round padded rail
        // about 0.1 m thick riding on the posts, not a box): an oval tube along the top
        const ch = T.cap.h || 0.1
        const cw = T.cap.w || 0.1
        const geo = T.cap.shape === "box" ? new THREE.BoxGeometry(L, ch, cw) : new THREE.CylinderGeometry(cw / 2, cw / 2, L, 14, 1, false).rotateZ(Math.PI / 2).scale(1, ch / cw, 1)
        const c = new THREE.Mesh(keep(geo), typedMat(T.cap.color || frame))
        c.position.set(...at(mid, h - ch / 2 + 0.02))
        c.rotation.y = ry
        group.add(c)
      }
      // posts: at the run's ends (terminal posts, heavier: post.end) and every `every` m between
      // (round 4, the owner's partition photo: ~4 in terminals with a dome cap and tension bands
      // up them, ~2.5-3 in line posts with a loop cap the top rail runs through, a band at each
      // lower rail)
      const d = T.post?.d || 0.06
      const dEnd = T.post?.end || d
      const every = T.post?.every || 3
      const n = Math.max(1, Math.round(L / every))
      const detailOn = quality !== "low"
      const fk = `${frame}|${T.post?.metal ?? ""}`
      for (let i = 0; i <= n; i++) {
        const [px, , pz] = at(a + (L * i) / n, 0)
        const term = i === 0 || i === n
        const pd = term ? dEnd : d
        const ph = h + (T.cap ? 0 : 0.03)
        push(typedPosts, fk, [px, pz, ph, pd])
        if (!detailOn) continue
        if (term) {
          if (!T.cap) push(typedDomes, fk, [px, pz, ph, pd * 1.12])
          for (let y = 0.25 + curbH; y < h - 0.15; y += 0.32) push(typedBands, fk, [px, pz, 0.022, pd + 0.014, y])
        } else if (!T.cap) push(typedBands, fk, [px, pz, 0.07, pd + 0.02, h - 0.035])
        for (const y of T.rails || []) if (y > 0.1) push(typedBands, fk, [px, pz, 0.05, pd + 0.016, y - 0.025])
      }
    }
    for (const gate of gates) {
      for (const dd of [-gate.w / 2, gate.w / 2]) {
        const p = new THREE.Mesh(keep(new THREE.BoxGeometry(0.07, h + 0.05, 0.07)), gateMat)
        p.position.set(...at(gate.at + dd, (h + 0.05) / 2))
        group.add(p)
      }
      const top = new THREE.Mesh(keep(new THREE.BoxGeometry(gate.w, 0.07, 0.07)), gateMat)
      top.position.set(...at(gate.at, Math.min(2.2, h - 0.1)))
      top.rotation.y = ry
      group.add(top)
    }
  }
  if (riverside) {
    const pen = (c, gateOn) => {
      const x0 = c.x - PEN.hx
      const x1 = c.x + PEN.hx
      const z0 = c.z - PEN.hz
      const z1 = c.z + PEN.hz
      fenceSide(x0, z0, x1, z0, gateOn === "n" ? { gates: [{ at: c.gate.x - x0, w: 1.4 }] } : {})
      fenceSide(x0, z1, x1, z1, gateOn === "s" ? { gates: [{ at: c.gate.x - x0, w: 1.4 }] } : {})
      fenceSide(x0, z0, x0, z1, gateOn === "w" ? { gates: [{ at: PEN.hz, w: 1.4 }] } : {})
      fenceSide(x1, z0, x1, z1)
    }
    for (const c of COURTS) pen(c, c.side < 0 ? "s" : "n")
    pen(MACHINE_COURT, "w")
  } else {
    for (const f of S.fences) {
      if (f.k !== "chain") continue
      const T = f.t ? S.fence?.types?.[f.t] : null
      if (T) typedSide(f.a[0], f.a[1], f.b[0], f.b[1], T, (f.gates || []).map((at) => ({ at, w: 1.4 })), f.h, f.opens || [])
      else fenceSide(f.a[0], f.a[1], f.b[0], f.b[1], { gates: (f.gates || []).map((at) => ({ at, w: 1.4 })), h: f.h })
    }
  }
  const fkMat = (fk) => {
    const [color, metal] = fk.split("|")
    return frameMatFor(color, metal === "" ? null : { post: { metal: metal === "true" } })
  }
  for (const [fk, list] of typedPosts) {
    const mesh = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.5, 0.5, 1, 10)), fkMat(fk), list.length)
    list.forEach(([x, z, h, d], i) => mesh.setMatrixAt(i, m4.compose(v1.set(x, h / 2, z), q.identity(), v2.set(d, h, d))))
    group.add(mesh)
  }
  for (const [fk, list] of typedBands) {
    const mesh = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.5, 0.5, 1, 10)), fkMat(fk), list.length)
    list.forEach(([x, z, h, d, y], i) => mesh.setMatrixAt(i, m4.compose(v1.set(x, y + h / 2, z), q.identity(), v2.set(d, h, d))))
    group.add(mesh)
  }
  for (const [fk, list] of typedDomes) {
    const mesh = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.5, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2)), fkMat(fk), list.length)
    list.forEach(([x, z, h, d], i) => mesh.setMatrixAt(i, m4.compose(v1.set(x, h - 0.01, z), q.identity(), v2.set(d, d * 0.8, d))))
    group.add(mesh)
  }
  if (fencePosts.length) {
    const fencePostMesh = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.035, 0.035, 1, 5)), railMat, fencePosts.length)
    fencePosts.forEach(([x, z, h], i) => fencePostMesh.setMatrixAt(i, m4.compose(v1.set(x, h / 2, z), q.identity(), v2.set(1, h, 1))))
    group.add(fencePostMesh)
  }

  // ---- bleachers: aluminum planks on dark frames ----
  const plankMat = std(0xb9c0c8, { roughness: 0.45, metalness: 0.5 })
  const frameMat = lambert(0x3a3f47)
  for (const c of COURTS) {
    const b = c.bleacher
    if (!b) continue
    const ry = yawFor(b.ax, b.az)
    const nIn = { x: -c.out.x, z: -c.out.z }
    SEAT_ROWS.forEach((row) => {
      const seat = new THREE.Mesh(keep(new THREE.BoxGeometry(b.len, 0.05, 0.36)), plankMat)
      seat.position.set(b.x + nIn.x * row.off, row.y - 0.03, b.z + nIn.z * row.off)
      seat.rotation.y = ry
      group.add(seat)
      // a footboard in front of each row
      const foot = new THREE.Mesh(keep(new THREE.BoxGeometry(b.len, 0.04, 0.3)), plankMat)
      foot.position.set(b.x + nIn.x * (row.off + 0.33), row.y - 0.42, b.z + nIn.z * (row.off + 0.33))
      foot.rotation.y = ry
      if (row.y - 0.42 > 0.05) group.add(foot)
    })
    const nFr = b.len > 5 ? 4 : 2
    for (let i = 0; i < nFr; i++) {
      const fr = new THREE.Mesh(keep(new THREE.BoxGeometry(0.06, 0.9, 1.0)), frameMat)
      const a = -b.len / 2 + 0.2 + (i * (b.len - 0.4)) / (nFr - 1)
      fr.position.set(b.x + b.ax * a, 0.43, b.z + b.az * a)
      fr.rotation.y = ry
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
    board.rotation.y = yawFor(c.rackAlong.x, c.rackAlong.z)
    group.add(board)
  }
  const paddleGeo = keep(new THREE.BoxGeometry(0.19, 0.27, 0.02).translate(0, 0.14, 0))
  const handleGeo = keep(new THREE.CylinderGeometry(0.014, 0.014, 0.13, 5).translate(0, -0.06, 0))
  const rackPaddles = new THREE.InstancedMesh(paddleGeo, lambert(0xffffff), Math.max(1, COURTS.length) * RACK_N)
  const rackHandles = new THREE.InstancedMesh(handleGeo, lambert(0x222222), Math.max(1, COURTS.length) * RACK_N)
  rackPaddles.count = 0
  rackHandles.count = 0
  rackPaddles.frustumCulled = false
  rackHandles.frustumCulled = false
  group.add(rackPaddles, rackHandles)
  const tmpColor = new THREE.Color()
  const qYaw = new THREE.Quaternion()
  const qTilt = new THREE.Quaternion()
  const yAxis = new THREE.Vector3(0, 1, 0)
  // racks: [[{ color } ...] per court], the next up first
  const setRacks = (racks) => {
    let n = 0
    COURTS.forEach((c, ci) => {
      const list = (racks[ci] || []).slice(0, RACK_N)
      const ry = yawFor(c.rackAlong.x, c.rackAlong.z)
      qYaw.setFromAxisAngle(yAxis, ry)
      // (leaning back toward the fence: the rack's local z, turned, against the court's out)
      const lz = { x: Math.sin(ry), z: Math.cos(ry) }
      const lean = 0.12 * (c.out.x * lz.x + c.out.z * lz.z)
      list.forEach((p, i) => {
        const a = -0.62 + i * 0.18
        qTilt.setFromEuler(new THREE.Euler(lean, 0, 0.08 * ((i % 2) - 0.5)))
        q.copy(qYaw).multiply(qTilt)
        m4.compose(v1.set(c.rack.x + c.rackAlong.x * a + c.out.x * 0.05, 1.12, c.rack.z + c.rackAlong.z * a + c.out.z * 0.05), q, v2.set(1, 1, 1))
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

  // ---- each court's scoreboard: outside its fence, at the far end from the gate ----
  const boards = COURTS.map((c) => {
    const canvas = document.createElement("canvas")
    canvas.width = 256
    canvas.height = 128
    const tex = keep(new THREE.CanvasTexture(canvas))
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = keep(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }))
    const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.6, 0.8)), mat)
    const tangent = { x: c.out.z, z: -c.out.x }
    const alongOut = Math.abs(c.out.x * c.u.x + c.out.z * c.u.z) > 0.7
    const halfAlong = alongOut ? c.hz : c.hx
    const sg = -(Math.sign(c.gate.x - c.fence.x) * Math.sign(tangent.x) || Math.sign(c.gate.z - c.fence.z) * Math.sign(tangent.z) || 1)
    const off = sg * (alongOut ? Math.min(3, halfAlong - 1.3) : halfAlong - 1.3)
    const bx = c.fence.x + tangent.x * off + c.out.x * 0.12
    const bz = c.fence.z + tangent.z * off + c.out.z * 0.12
    m.position.set(bx, 2.5, bz)
    m.rotation.y = Math.atan2(c.out.x || 0, c.out.z)
    m.renderOrder = 0.5 // (own texture: not merged)
    group.add(m)
    for (const d of [-0.7, 0.7]) {
      const p = new THREE.Mesh(keep(new THREE.BoxGeometry(0.05, 2.5, 0.05)), frameMat)
      p.position.set(bx + tangent.x * d, 1.25, bz + tangent.z * d)
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
  if (BOARD) {
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
  }
  // lines: [{ name, text, you }]
  const setBoard = (rows = []) => {
    if (!BOARD) return
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

  // ---- the pro shop (the Locker Room): a booth with a striped awning (indoors: a front desk) ----
  if (BOOTH) {
    // built facing +x, then turned to face BOOTH.face
    const bg = new THREE.Group()
    const desk = BOOTH.style === "desk"
    if (desk) {
      const counter = new THREE.Mesh(keep(new THREE.BoxGeometry(BOOTH.hx * 2, 1.05, BOOTH.hz * 2)), lambert(0x2b2f36))
      counter.position.set(0, 0.525, 0)
      bg.add(counter)
      const top = new THREE.Mesh(keep(new THREE.BoxGeometry(BOOTH.hx * 2 + 0.1, 0.05, BOOTH.hz * 2 + 0.1)), lambert(0xd9cbb0))
      top.position.set(0, 1.08, 0)
      bg.add(top)
    } else {
      const booth = new THREE.Mesh(keep(new THREE.BoxGeometry(BOOTH.hx * 2, 2.6, BOOTH.hz * 2)), lambert(0xe9dcc4))
      booth.position.set(0, 1.3, 0)
      bg.add(booth)
      const awningTex = keep(
        canvasTexture(128, 16, (ctx, w, h) => {
          for (let i = 0; i < 8; i++) {
            ctx.fillStyle = i % 2 ? "#ffffff" : "#e63946"
            ctx.fillRect((i * w) / 8, 0, w / 8, h)
          }
        })
      )
      const awning = new THREE.Mesh(keep(new THREE.BoxGeometry(1.2, 0.06, BOOTH.hz * 2 + 0.4)), keep(new THREE.MeshLambertMaterial({ map: awningTex })))
      awning.position.set(BOOTH.hx + 0.5, 2.55, 0)
      awning.rotation.z = -0.25
      awning.renderOrder = 0.5
      bg.add(awning)
      const roof = new THREE.Mesh(keep(new THREE.BoxGeometry(BOOTH.hx * 2 + 0.3, 0.2, BOOTH.hz * 2 + 0.3)), lambert(0x8c3b2f))
      roof.position.set(0, 2.7, 0)
      bg.add(roof)
      const counter = new THREE.Mesh(keep(new THREE.BoxGeometry(0.4, 1.0, Math.min(2.2, BOOTH.hz * 2 - 0.2))), lambert(0x8a5a33))
      counter.position.set(BOOTH.hx + 0.2, 0.5, 0)
      bg.add(counter)
    }
    const signTex = keep(
      canvasTexture(512, 128, (ctx, w) => {
        ctx.fillStyle = "#1d3557"
        ctx.fillRect(0, 0, w, 128)
        ctx.fillStyle = "#ffd23f"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.font = "bold 54px Arial, sans-serif"
        ctx.fillText(desk ? "FRONT DESK" : "PRO SHOP", w / 2, 46)
        ctx.fillStyle = "#ffffff"
        ctx.font = "bold 34px Arial, sans-serif"
        ctx.fillText("LOCKER ROOM", w / 2, 98)
      })
    )
    const sign = new THREE.Mesh(keep(new THREE.PlaneGeometry(Math.min(2.6, BOOTH.hz * 2 - 0.2), 0.65)), keep(new THREE.MeshBasicMaterial({ map: signTex })))
    sign.position.set(BOOTH.hx + 0.02, desk ? 1.75 : 2.05, 0)
    sign.rotation.y = Math.PI / 2
    sign.renderOrder = 0.5
    bg.add(sign)
    if (desk) {
      for (const d of [-1, 1]) {
        const p = new THREE.Mesh(keep(new THREE.BoxGeometry(0.05, 0.7, 0.05)), frameMat)
        p.position.set(BOOTH.hx, 1.4, d * (Math.min(2.6, BOOTH.hz * 2 - 0.2) / 2 - 0.05))
        bg.add(p)
      }
    }
    bg.position.set(BOOTH.x, 0, BOOTH.z)
    bg.rotation.y = yawFor(BOOTH.face.x, BOOTH.face.z)
    group.add(bg)
  }

  // ---- the fountain ----
  if (FOUNTAIN) {
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
  }

  // ---- the ball machine and its balls ----
  // (Riverside only: at a real venue the machine and a court strewn with balls would be made up;
  // its Ball Machine spot still works, the court stays as it is: docs/venue-provenance.md)
  if (machineGroup && riverside) {
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
    for (let i = 0; i < 26; i++) balls.setMatrixAt(i, m4.makeTranslation((brnd() - 0.5) * 2 * 3.05, 0.04, 1 + brnd() * (HALF_L - 1)))
    machineGroup.add(balls)
  }

  // ---- trees (Riverside's; a venue's are scenery.js's), light poles ----
  if (riverside) {
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
  }
  const POLE_H = S?.fence?.poleH || 7.5
  const double = !!S?.fence?.doubleHeads
  const lampMat = keep(new THREE.MeshBasicMaterial({ color: 0x9aa0a8 }))
  lampMat.userData.live = true // (its color follows the time of day: never merged by look)
  const hex6 = (c, d) => (c ? new THREE.Color(c).getHex() : d)
  if (LIGHTS.length) {
    const poles = new THREE.InstancedMesh(keep(S?.fence?.poleD ? new THREE.CylinderGeometry(S.fence.poleD * 0.42, S.fence.poleD * 0.5, 7.5, 10) : new THREE.CylinderGeometry(0.07, 0.1, 7.5, 6)), S?.fence?.poleColor ? lambert(hex6(S.fence.poleColor)) : frameMat, LIGHTS.length)
    // (Medium/High: a real fixture: a cross-arm, LED heads tilted down with a bright lens)
    let lampGeo = new THREE.BoxGeometry(double ? 1.2 : 0.5, 0.18, 0.35)
    let lensGeo = null
    const tStyle = S?.fence?.poleStyle === "t"
    if (tStyle) {
      // (Los Cab, the owner's photos: a T arm on top, a flat LED head at each end, facing down)
      const armW = S.fence.armW || 2.2
      const parts = [new THREE.BoxGeometry(armW, 0.09, 0.09).translate(0, -0.05, 0), new THREE.BoxGeometry(0.12, 0.3, 0.12).translate(0, -0.2, 0)]
      const lens = []
      for (const sx of [-armW / 2, armW / 2]) {
        parts.push(new THREE.BoxGeometry(0.62, 0.08, 0.46).translate(sx, -0.12, 0))
        lens.push(new THREE.PlaneGeometry(0.54, 0.38).rotateX(Math.PI / 2).translate(sx, -0.165, 0))
      }
      lampGeo = mergeGeometries(parts.map((g) => (g.deleteAttribute("uv"), g)), false)
      lensGeo = mergeGeometries(lens.map((g) => (g.deleteAttribute("uv"), g)), false)
    } else if (wire) {
      const parts = [new THREE.BoxGeometry(double ? 1.5 : 0.7, 0.07, 0.07).translate(0, -0.05, 0)]
      const lens = []
      for (const sx of double ? [-0.62, 0.62] : [0.25]) {
        parts.push(new THREE.BoxGeometry(0.46, 0.09, 0.62).rotateX(0.35).translate(sx, 0.02, 0.18))
        parts.push(new THREE.BoxGeometry(0.06, 0.25, 0.06).translate(sx, 0.08, 0.0))
        lens.push(new THREE.PlaneGeometry(0.4, 0.55).rotateX(Math.PI / 2 + 0.35).translate(sx, -0.03, 0.18))
      }
      lampGeo = mergeGeometries(parts.map((g) => (g.deleteAttribute("uv"), g)), false)
      lensGeo = mergeGeometries(lens.map((g) => (g.deleteAttribute("uv"), g)), false)
    }
    const lamps = new THREE.InstancedMesh(keep(lampGeo), wire || tStyle ? lambert(hex6(S?.fence?.headColor, 0x2f3338)) : lampMat, LIGHTS.length)
    const lenses = lensGeo ? new THREE.InstancedMesh(keep(lensGeo), keep(new THREE.MeshBasicMaterial({ color: 0xe8ecef, side: THREE.DoubleSide })), LIGHTS.length) : null
    LIGHTS.forEach((l, i) => {
      poles.setMatrixAt(i, m4.compose(v1.set(l.x, POLE_H / 2, l.z), q.identity(), v2.set(1, POLE_H / 7.5, 1)))
      // (the heads face the nearest court centre)
      let best = null
      for (const c of S?.courts || COURTS) {
        const d = (c.x - l.x) ** 2 + (c.z - l.z) ** 2
        if (!best || d < best.d) best = { d, c }
      }
      // (a T arm runs along its gap: l.arm)
      const yaw = l.arm ? Math.atan2(-l.arm[1], l.arm[0]) : best ? Math.atan2(best.c.x - l.x, best.c.z - l.z) : 0
      m4.compose(v1.set(l.x, POLE_H, l.z), q.setFromEuler(new THREE.Euler(0, yaw, 0)), v2.set(1, 1, 1))
      lamps.setMatrixAt(i, m4)
      lenses?.setMatrixAt(i, m4)
    })
    group.add(poles, lamps)
    if (lenses) group.add(lenses)
  }
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
  if (riverside) {
    for (const c of [...COURTS, MACHINE_COURT]) {
      const p = new THREE.Mesh(keep(new THREE.PlaneGeometry(2 * PEN.hx + 6, 2 * PEN.hz + 6).rotateX(-Math.PI / 2)), poolMat)
      p.position.set(c.x, 0.012, c.z)
      p.renderOrder = 2
      pools.add(p)
    }
  } else if (S.lit && !S.indoor) {
    for (const b of S.banks) {
      const p = new THREE.Mesh(keep(new THREE.PlaneGeometry(2 * b.hx + 6, 2 * b.hz + 6).rotateX(-Math.PI / 2)), poolMat)
      p.position.set(b.cx, 0.012, b.cz)
      p.rotation.y = yawFor(b.ux, b.uz)
      p.renderOrder = 2
      pools.add(p)
    }
  }
  pools.visible = false

  // ---- sun shadows (a real venue, Medium/High; docs/venue-realism.md): buildings, fences'
  // frames, nets' posts, stands and trees throw real shadows in a box that follows the camera
  // (followSky). Set before the merge (it keys on the flags). See-through things (chain-link,
  // nets: MeshBasic with alpha) don't cast: they'd throw solid sheets.
  const shadows = !!S && quality !== "low"
  let realism = shadows // setRealism(): shadows + the sun/sky balance for them (surfaces.js has its own switch)
  if (shadows) {
    group.traverse((o) => {
      if (!o.isMesh || o === sky) return
      const m = Array.isArray(o.material) ? o.material[0] : o.material
      const seeThrough = !m || m.transparent || m.isMeshBasicMaterial || m.isShaderMaterial
      o.receiveShadow = !m?.isMeshBasicMaterial && !m?.isShaderMaterial
      o.castShadow = (!seeThrough || !!o.userData.shadowCaster) && !o.userData.noCast && o.renderOrder >= 0
      // indoors the "sun" is the ceiling's light: the roof, ceiling, trusses and fixtures above
      // it mustn't shadow the floor
      if (o.castShadow && S.indoor) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
        o.updateWorldMatrix(true, false)
        const yMin = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).min.y
        if (yMin > 3.5) o.castShadow = false
      }
    })
    sun.castShadow = true
    const size = quality === "high" ? 2048 : 1024
    sun.shadow.mapSize.set(size, size)
    const R = 45
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 260 })
    sun.shadow.camera.updateProjectionMatrix()
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.05
    sun.shadow.radius = 3
    // the venue never moves (people keep their blob shadows): the shadow map is drawn again only
    // when its box moves (followSky) or the light changes (setDayLook), not every frame
    sun.shadow.autoUpdate = false
    sun.shadow.needsUpdate = true
  }
  let shadowAt = null

  // (the ground's color follows the time of day)
  if (groundMat) groundMat.userData.live = true
  mergeStatic(group, keep)
  // (and the meshes that differ only in color: one draw per look, perf.js)
  mergeByLook(group, keep)
  // (added after the merge: switched on and off by the time of day)
  group.add(pools)
  // (the rooms: each merged on its own, shown and hidden by cull())
  for (const z of scenery?.zones || []) {
    mergeStatic(z.group, keep)
    mergeByLook(z.group, keep)
    group.add(z.group)
  }
  // (the roofs over open ground: each merged on its own and faded by cutaway(), cutaway.js;
  // they throw their shade like the rest)
  for (const ov of scenery?.overheads || []) {
    if (shadows)
      ov.group.traverse((o) => {
        if (!o.isMesh) return
        const m = Array.isArray(o.material) ? o.material[0] : o.material
        const seeThrough = !m || m.transparent || m.isMeshBasicMaterial || m.isShaderMaterial
        o.receiveShadow = !m?.isMeshBasicMaterial && !m?.isShaderMaterial
        o.castShadow = !seeThrough && !o.userData.noCast
      })
    mergeStatic(ov.group, keep)
    mergeByLook(ov.group, keep)
    group.add(ov.group)
  }
  // real surfaces (surfaces.js; off on Low): CC0 detail sampled in world space on tagged materials
  applySurfaces(group, { quality })
  // see-through double-sided things (chain-link, nets, glass, weed cards) in one pass, not two
  // (perf.js)
  singlePass(group)
  // nothing here moves: its matrices are worked out once (what's added later to a court's
  // group, the players and the ball, still updates itself)
  group.traverse((o) => {
    o.updateMatrix()
    o.matrixAutoUpdate = false
  })
  group.updateMatrixWorld(true)
  scene.add(group)
  // baked ground occlusion (occlusion.js; a real venue on Medium/High): worked out once from the
  // venue's own solid geometry, a few ms a frame until it's done
  const cancelAO = shadows ? bakeVenueAO(group, BOUNDS) : null
  // (a real venue: thinner haze, so its far courts keep their colors)
  scene.fog = S ? new THREE.Fog(0xd8ecfb, Math.max(110, span * 0.7), Math.max(260, skyR + 60)) : new THREE.Fog(0xd8ecfb, Math.max(60, span * 0.45), Math.max(170, skyR - 10))
  const fogBase = { near: scene.fog.near, far: scene.fog.far }

  // ---- a real venue's light: measured so a flat surface in the midday sun shows its paint
  // (spec hex) on screen, through the Neutral tone curve (tools/venues/compare.mjs truth):
  // flat irradiance ~1.0, walls ~0.55-0.7 (sun from the south), indoors bright neutral LED
  // light from above with a pale bounce off the floor. The sun's direction follows the hour
  // (its matrix is updated here: the group's matrices are frozen after the build).
  // (Riverside keeps its own long-standing look.)
  const toneMapping = S ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping
  const white = new THREE.Color(0xffffff)
  const sunDir = new THREE.Vector3(0, 1, 0) // toward the sun (venueLight); the shadow box follows the camera along it
  const venueLight = (d) => {
    const k = S.light || {}
    const day = Math.min(1, d.sun.intensity / 2.6)
    const amb = Math.min(1, d.hemi[2] / 1.4)
    if (S.indoor) {
      hemi.color.setHex(0xffffff)
      hemi.groundColor.set(k.bounce || "#e2ded6")
      // (realism: a soft overhead key so benches, nets and people sit on contact shadows; the
      // same total on the floor)
      hemi.intensity = realism ? k.skyShadow ?? 1.7 : k.sky ?? 2.5
      sun.color.setHex(0xfffaf2)
      sun.intensity = realism ? k.sunShadow ?? 1.5 : k.sun ?? 0.6
      sun.position.set(sun.target.position.x + 0.05, 40, 0.05)
      sunDir.set(0.05, 1, 0.05).normalize()
    } else {
      hemi.color.setHex(d.hemi[0]).lerp(white, 0.65)
      hemi.groundColor.set(k.bounce || "#c8c2b4")
      // with shadows the sun carries the light and the sky fills the shade (about the same total
      // on a flat surface at midday, so the photo-matched paint holds; shade reads as shade)
      hemi.intensity = (realism ? k.skyShadow ?? 0.9 : k.sky ?? 2.25) * amb
      sun.color.setHex(d.sun.color).lerp(white, 0.4)
      sun.intensity = (realism ? k.sunShadow ?? 2.6 : k.sun ?? 1.0) * day
      const n = Math.hypot(d.sun.dir.x, d.sun.dir.y, d.sun.dir.z) || 1
      sun.position.set(sun.target.position.x + (d.sun.dir.x / n) * 40, (d.sun.dir.y / n) * 40, (d.sun.dir.z / n) * 40)
      sunDir.set(d.sun.dir.x / n, Math.max(0.15, d.sun.dir.y / n), d.sun.dir.z / n).normalize()
    }
    sun.updateMatrix()
    sun.updateMatrixWorld(true)
    surfSky.value.copy(hemi.color).multiplyScalar(hemi.intensity * (S.indoor ? 0.4 : 0.55))
  }

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
    groundMat?.color.setScalar(d.ground)
    pools.visible = !!d.lights
    lampMat.color.setHex(d.lights ? 0xfff6d8 : 0x9aa0a8)
    if (S) venueLight(d)
    // Real Sky: the dome, the weather (indoors only the sky through the doors and windows
    // changes: no rain or wet floor, the hall's own light)
    const wx = d.real ? d.weather || {} : null
    if (real) {
      sky.visible = !d.real
      real.mesh.visible = !!d.real
      if (d.real) real.setLook(d)
    }
    const outside = !S?.indoor
    precip?.setWeather(wx && outside ? wx : {})
    surfWet.value = wx && outside ? Math.min(1, Math.max(wx.rain ?? 0, (wx.snow ?? 0) * 0.5) * 1.2) : 0
    setWindStrength(wx ? wx.wind ?? 2 : 2)
    if (wx) stars.visible = !!d.stars
    // fog from the visibility; softer, fainter shadows under cloud
    const fogK = wx ? Math.min(0.85, (wx.fog ?? 0) * 0.85 + (wx.rain ?? 0) * 0.25) : 0
    scene.fog.near = fogBase.near * (1 - fogK * 0.8)
    scene.fog.far = fogBase.far * (1 - fogK * 0.65)
    if (shadows && outside) {
      const cover = wx ? wx.cover ?? 0 : 0
      sun.shadow.radius = 3 + 7 * cover
      if ("intensity" in sun.shadow) sun.shadow.intensity = 1 - 0.6 * Math.min(1, cover * 1.1)
    }
    if (shadows) {
      sun.shadow.needsUpdate = true
      if (shadowAt) {
        sun.position.copy(sun.target.position).addScaledVector(sunDir, 120)
        sun.updateMatrix()
        sun.updateMatrixWorld(true)
      }
    }
    setHorizonLook(horizon, d)
    scenery?.setDayLook?.(d)
  }

  return {
    group,
    sun,
    hemi,
    toneMapping,
    courtGroups,
    machineGroup,
    setScore,
    setRacks,
    setBoard,
    setDayLook,
    // the realistic look on or off (shadows and their light); the next setDayLook applies the light
    setRealism: (on) => {
      realism = shadows && !!on
      setBakedAOOn(realism)
      sun.castShadow = realism
      sun.shadow.needsUpdate = true
    },
    update: scenery?.update || null,
    cull: scenery?.cull || null,
    // fade what hides you (cutaway.js): (cam, targets, me, dt)
    cutaway: scenery?.cutaway || null,
    overheads: scenery?.overheadList || [],
    // (a real venue: the sky dome centred on the camera)
    followSky: S
      ? (p, cam = null) => {
          if (shadows && (!shadowAt || Math.hypot(p.x - shadowAt.x, p.z - shadowAt.z) > 8)) {
            // the shadow box: re-centred once the camera has gone 8 m, the sun 120 m back along its light
            shadowAt = { x: p.x, z: p.z }
            sun.shadow.needsUpdate = true
            sun.target.position.set(p.x, 0, p.z)
            sun.position.copy(sun.target.position).addScaledVector(sunDir, 120)
            // (the park's matrices are frozen after the build: work these out by hand)
            sun.target.updateMatrix()
            sun.target.updateMatrixWorld(true)
            sun.updateMatrix()
            sun.updateMatrixWorld(true)
          }
          sky.position.set(p.x, 0, p.z)
          stars.position.copy(sky.position)
          sky.updateMatrix()
          stars.updateMatrix()
          sky.updateMatrixWorld(true)
          stars.updateMatrixWorld(true)
          // (the skyline round the eye itself: its angles are worked out for an eye 1.7 m up)
          const eye = cam || p
          for (const m of horizon) {
            m.position.set(eye.x, Math.max(0, (eye.y ?? 1.7) - (S.horizon?.eye ?? 1.7)), eye.z)
            m.updateMatrix()
            m.updateMatrixWorld(true)
          }
          if (real) {
            real.mesh.position.copy(sky.position)
            real.mesh.updateMatrix()
            real.mesh.updateMatrixWorld(true)
          }
        }
      : null,
    dispose() {
      cancelAO?.()
      scenery?.dispose?.()
      if (shadows) clearBakedAO()
      scene.remove(group)
      scene.fog = null
      real?.dispose()
      precip?.dispose()
      surfWet.value = 0
      disposables.forEach((d) => d.dispose?.())
      rackPaddles.dispose?.()
      rackHandles.dispose?.()
    },
  }
}

// "#rrggbb" colors -> numbers (for the court kit)
const hexColors = (c = {}) => {
  const out = {}
  for (const [k, v] of Object.entries(c)) if (typeof v === "string" && v[0] === "#") out[k] = parseInt(v.slice(1), 16)
  return out
}
