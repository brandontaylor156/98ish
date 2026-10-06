// Pickleball 98: where the match is played. Three venues: the Park (a sunny public court),
// the Club (golden hour, bleachers and a clubhouse) and the Stadium (night, under the
// lights, a full crowd and a big screen). Everything is built from simple shapes and
// canvas textures; the crowd is two instanced meshes that bounce in a vertex shader.

import * as THREE from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"
import { HALF_L, HALF_W, KITCHEN, LINE_W, NET_POST_X, netHeightAt } from "./physics.js"
import { VENUE_INFO } from "./looks.js"
import { applySurfaces } from "./park/surfaces.js"
import { bakeVenueAO, clearBakedAO } from "./park/occlusion.js"

export { VENUE_INFO as VENUES }
const VENUES = VENUE_INFO

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

// made-up sponsors for the ad boards
const ADS = [
  ["98ISH OPEN", "#ffd23f", "#16213e"],
  ["PICKLE POP", "#ffffff", "#2a9d8f"],
  ["DINKWORKS", "#16213e", "#ffd23f"],
  ["KITCHEN CO.", "#ffffff", "#e63946"],
  ["SOFT HANDS", "#ffffff", "#6a4c93"],
  ["THIRD SHOT", "#16213e", "#8ecae6"],
]
const adTexture = () =>
  canvasTexture(1024, 64, (ctx, w, h) => {
    const n = ADS.length
    const bw = w / n
    ADS.forEach(([text, fg, bg], i) => {
      ctx.fillStyle = bg
      ctx.fillRect(i * bw, 0, bw, h)
      ctx.fillStyle = fg
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      // the biggest type that fits the panel
      let size = 34
      ctx.font = `bold ${size}px Arial, sans-serif`
      while (size > 14 && ctx.measureText(text).width > bw - 14) {
        size -= 2
        ctx.font = `bold ${size}px Arial, sans-serif`
      }
      ctx.fillText(text, i * bw + bw / 2, h / 2 + 2)
    })
  })

// Fewer draw calls: plain meshes that share a material (and the same kind of geometry) are
// merged into one, with their transforms baked in. The venue never moves.
export const mergeStatic = (group, keep) => {
  group.updateMatrixWorld(true)
  const buckets = new Map()
  const all = []
  group.traverse((o) => all.push(o))
  for (const o of all) {
    if (!o.isMesh || o.isInstancedMesh || o.renderOrder < 0) continue
    const g = o.geometry
    const key = `${o.material.uuid}|${Object.keys(g.attributes).sort().join(",")}|${o.renderOrder}|${o.castShadow}|${o.receiveShadow}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(o)
  }
  for (const list of buckets.values()) {
    if (list.length < 2) continue
    const indexed = list.every((o) => o.geometry.index)
    const geos = list.map((o) => {
      const g = (indexed ? o.geometry.clone() : o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld)
      for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(name)) g.deleteAttribute(name)
      return g
    })
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    if (!merged) continue
    const first = list[0]
    const mesh = new THREE.Mesh(keep(merged), first.material)
    mesh.castShadow = first.castShadow
    mesh.receiveShadow = first.receiveShadow
    mesh.renderOrder = first.renderOrder
    if (first.customDepthMaterial) mesh.customDepthMaterial = first.customDepthMaterial // (cut-out shadows: chain-link)
    for (const o of list) o.parent.remove(o)
    group.add(mesh)
  }
}

// The sun's shadow camera fitted around a box (|x| <= hx, |z| <= hz, 0 <= y <= h: the court,
// its run-off where players go, the umpire's chair, everyone's height) as the light sees it,
// so the map's texels all land where shadows can fall
const fitShadow = (light, hx, hz, h) => {
  const cam = light.shadow.camera
  cam.position.copy(light.position)
  cam.lookAt(light.target.position)
  cam.updateMatrixWorld(true)
  const inv = cam.matrixWorld.clone().invert()
  const v = new THREE.Vector3()
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity)
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  for (const x of [-hx, hx]) for (const y of [0, h]) for (const z of [-hz, hz]) {
    v.set(x, y, z).applyMatrix4(inv)
    lo.min(v)
    hi.max(v)
  }
  const pad = 0.3
  cam.left = lo.x - pad
  cam.right = hi.x + pad
  cam.bottom = lo.y - pad
  cam.top = hi.y + pad
  cam.near = Math.max(0.5, -hi.z - 2)
  cam.far = -lo.z + 2
  cam.updateProjectionMatrix()
}

export const buildVenue = (scene,{ venue = "park", quality = "medium" } = {}) => {
  const V = VENUES[venue] || VENUES.park
  const group = new THREE.Group()
  const disposables = []
  const keep = (x) => {
    disposables.push(x)
    return x
  }
  const lambert = (color, o = {}) => keep(new THREE.MeshLambertMaterial({ color, ...o }))
  const std = (color, o = {}) => keep(new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o }))
  const shadows = quality !== "low"

  // ---- sky ----
  const skyMat = keep(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(V.sky[0]) }, horizon: { value: new THREE.Color(V.sky[1]) } },
      vertexShader: "varying float vY; void main() { vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      // (the uniforms are linear colors: colorspace_fragment turns them into the screen's sRGB,
      // as built-in materials do, so the sky shows the colors VENUE_INFO asks for)
      fragmentShader: "uniform vec3 top; uniform vec3 horizon; varying float vY; void main() { float t = pow(clamp(vY, 0.0, 1.0), 0.5); gl_FragColor = vec4(mix(horizon, top, t), 1.0);\n#include <colorspace_fragment>\n}",
    })
  )
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(190, 24, 12)), skyMat)
  sky.renderOrder = -1
  group.add(sky)
  if (V.night) {
    // stars
    const n = 400
    const pos = new Float32Array(n * 3)
    let seed = 3
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2
      const e = 0.15 + rnd() * 1.2
      pos[i * 3] = Math.cos(a) * Math.cos(e) * 180
      pos[i * 3 + 1] = Math.sin(e) * 180
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 180
    }
    const g = keep(new THREE.BufferGeometry())
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    group.add(new THREE.Points(g, keep(new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, sizeAttenuation: false, fog: false }))))
  }

  // ---- lights ----
  const hemi = new THREE.HemisphereLight(V.hemi[0], V.hemi[1], V.hemi[2])
  group.add(hemi)
  const sun = new THREE.DirectionalLight(V.sun.color, V.sun.intensity)
  sun.position.set(...V.sun.pos)
  sun.target.position.set(0, 0, 0)
  group.add(sun, sun.target)
  if (shadows) {
    // Medium and High: a 2048 map over a box fitted to where players can be (Low has no
    // shadow map: the blobs under the players are its shadows)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.radius = 3 // softer PCF edge
    sun.shadow.bias = -0.0006
    sun.shadow.normalBias = 0.02
    // aim the shadow box along the light
    const d = new THREE.Vector3(...V.sun.pos).normalize().multiplyScalar(30)
    sun.position.copy(d)
    fitShadow(sun, HALF_W + 2.2, HALF_L + 3.4, 2.6)
  }
  if (V.night) {
    // a little fill from each end, so faces aren't black
    const fill = new THREE.DirectionalLight(0xcfd8ff, 0.9)
    fill.position.set(0, 12, 25)
    const fill2 = new THREE.DirectionalLight(0xcfd8ff, 0.7)
    fill2.position.set(0, 12, -25)
    group.add(fill, fill2)
  }

  // ---- ground, apron, court ----
  const ground = new THREE.Mesh(keep(new THREE.CircleGeometry(170, 40)), lambert(V.ground))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.03
  group.add(ground)
  // real surfaces on the classic venues too (park/surfaces.js; off on Low): grass where it's
  // grass, a concrete concourse under the stadium; sand and snow keep their own look
  if (venue === "park" || venue === "club") ground.material.userData.surface = "grass"
  else if (venue === "stadium") ground.material.userData.surface = "concrete"
  const AX = HALF_W + 3.6
  const AZ = HALF_L + 5.8
  const apron = new THREE.Mesh(keep(new THREE.PlaneGeometry(2 * AX, 2 * AZ)), std(V.apron, { roughness: 0.9 }))
  apron.rotation.x = -Math.PI / 2
  apron.position.y = -0.005
  apron.receiveShadow = shadows
  apron.material.userData.surface = "acrylic"
  group.add(apron)
  // the court surface: a subtle grain so it reads as a textured hard court
  const grain = canvasTexture(256, 256, (ctx, w, h) => {
    const base = new THREE.Color(V.court)
    ctx.fillStyle = `#${base.getHexString()}`
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 3000; i++) {
      const v = Math.random() * 0.08 - 0.04
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2)
    }
  })
  keep(grain)
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping
  grain.repeat.set(3, 6)
  const court = new THREE.Mesh(keep(new THREE.PlaneGeometry(2 * HALF_W, 2 * HALF_L)), std(0xffffff, { map: grain, roughness: 0.8 }))
  court.rotation.x = -Math.PI / 2
  court.receiveShadow = shadows
  court.material.userData.surface = "acrylic"
  group.add(court)
  const kitchen = new THREE.Mesh(keep(new THREE.PlaneGeometry(2 * HALF_W, 2 * KITCHEN)), std(V.kitchen, { roughness: 0.8 }))
  kitchen.rotation.x = -Math.PI / 2
  kitchen.position.y = 0.001
  kitchen.receiveShadow = shadows
  kitchen.material.userData.surface = "acrylic"
  group.add(kitchen)

  // the lines: 2 in wide, inside the court's outer edges (they're part of the court)
  const L = LINE_W
  const p = []
  const y = 0.003
  quad(p, -HALF_W, -HALF_L, HALF_W, -HALF_L + L, y)
  quad(p, -HALF_W, HALF_L - L, HALF_W, HALF_L, y)
  quad(p, -HALF_W, -HALF_L, -HALF_W + L, HALF_L, y)
  quad(p, HALF_W - L, -HALF_L, HALF_W, HALF_L, y)
  quad(p, -HALF_W, -KITCHEN, HALF_W, -KITCHEN + L, y)
  quad(p, -HALF_W, KITCHEN - L, HALF_W, KITCHEN, y)
  quad(p, -L / 2, KITCHEN, L / 2, HALF_L, y)
  quad(p, -L / 2, -HALF_L, L / 2, -KITCHEN, y)
  const lg = keep(new THREE.BufferGeometry())
  lg.setAttribute("position", new THREE.Float32BufferAttribute(p, 3))
  lg.computeVertexNormals()
  const lines = new THREE.Mesh(lg, std(0xf4f7fb, { roughness: 0.7 }))
  lines.receiveShadow = shadows
  lines.material.userData.surface = "acrylic"
  group.add(lines)

  // ---- the net: posts, a sagging mesh, the tape, the center strap ----
  const netTex = canvasTexture(32, 32, (ctx, w) => {
    ctx.clearRect(0, 0, w, w)
    ctx.strokeStyle = "rgba(20,24,30,0.85)"
    ctx.lineWidth = 3
    ctx.strokeRect(0, 0, w, w)
  })
  keep(netTex)
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping
  const postMat = std(0x2b2f36, { roughness: 0.5, metalness: 0.3 })
  postMat.userData.surface = "metal"
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.04, 0.045, 0.98, 10)), postMat)
    post.position.set(s * NET_POST_X, 0.49, 0)
    post.castShadow = shadows
    group.add(post)
    const base = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 12)), postMat)
    base.position.set(s * NET_POST_X, 0.025, 0)
    group.add(base)
  }
  const SEG = 32
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
  const net = new THREE.Mesh(netGeo, keep(new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false })))
  net.renderOrder = 2
  group.add(net)
  const tapeGeo = keep(new THREE.BufferGeometry())
  tapeGeo.setAttribute("position", new THREE.Float32BufferAttribute(tapePos, 3))
  tapeGeo.setIndex(netIdx)
  tapeGeo.computeVertexNormals()
  group.add(new THREE.Mesh(tapeGeo, keep(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }))))
  const strap = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.05, netHeightAt(0) - 0.05)), keep(new THREE.MeshBasicMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide })))
  strap.position.set(0, (netHeightAt(0) - 0.05) / 2 + 0.03, 0.002)
  group.add(strap)

  // ---- the umpire's chair (beside a net post) ----
  const UX = NET_POST_X + 1.1
  const chairMat = std(0x30343c, { roughness: 0.6, metalness: 0.2 })
  const chair = new THREE.Group()
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
    const leg = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.03, 0.03, 1.55, 6)), chairMat)
    leg.position.set(x, 0.775, z)
    chair.add(leg)
  }
  const seat = new THREE.Mesh(keep(new THREE.BoxGeometry(0.72, 0.06, 0.72)), chairMat)
  seat.position.y = 1.55
  chair.add(seat)
  const backrest = new THREE.Mesh(keep(new THREE.BoxGeometry(0.06, 0.5, 0.7)), chairMat)
  backrest.position.set(0.36, 1.82, 0)
  chair.add(backrest)
  const step = new THREE.Mesh(keep(new THREE.BoxGeometry(0.3, 0.04, 0.6)), chairMat)
  step.position.set(-0.32, 0.8, 0)
  chair.add(step)
  chair.position.set(UX, 0, 0)
  chair.traverse((o) => o.isMesh && (o.castShadow = shadows))
  group.add(chair)
  const umpireSeat = { x: UX - 0.05, y: 1.58, z: 0, yaw: -Math.PI / 2 } // faces the court (-x)

  // ---- the surrounds ----
  const FX = HALF_W + 3.6
  const FZ = HALF_L + 5.8
  let crowd = null
  const adTex = keep(adTexture())
  adTex.wrapS = THREE.RepeatWrapping
  const adBoards = (h, inset = 0) => {
    // ad boards all the way around, facing the court
    const sides = [
      { w: 2 * FX, x: 0, z: -FZ + inset, ry: 0 },
      { w: 2 * FX, x: 0, z: FZ - inset, ry: Math.PI },
      { w: 2 * FZ, x: -FX + inset, z: 0, ry: Math.PI / 2 },
      { w: 2 * FZ, x: FX - inset, z: 0, ry: -Math.PI / 2 },
    ]
    for (const s of sides) {
      const t = adTex.clone()
      t.needsUpdate = true
      t.repeat.set(Math.max(1, Math.round(s.w / 18)), 1)
      keep(t)
      const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(s.w, h)), keep(new THREE.MeshBasicMaterial({ map: t })))
      m.position.set(s.x, h / 2, s.z)
      m.rotation.y = s.ry
      group.add(m)
    }
  }

  // stands: rows of steps facing the court on the given sides, with a crowd on them
  const people = []
  let rs = 11
  const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647)
  const SHIRTS = [0xe63946, 0xf1faee, 0x457b9d, 0x1d3557, 0xffd166, 0x06d6a0, 0xef476f, 0x8338ec, 0xfb8500, 0x2a9d8f, 0xffffff, 0x222222]
  const SKINS = [0xf6d3b3, 0xeab98f, 0xd39a6a, 0xb5784a, 0x8c5734, 0x5f3a22]
  const stands = (side, rows, fill, color) => {
    const standMat = std(color, { roughness: 0.9 })
    const along = side === "n" || side === "s" ? 2 * FX - 1 : 2 * FZ - 1
    for (let r = 0; r < rows; r++) {
      const depth = 0.85
      const rise = 0.42
      const box = new THREE.Mesh(keep(new THREE.BoxGeometry(along, rise * (r + 1), depth)), standMat)
      const off = 1.0 + r * depth
      const ypos = (rise * (r + 1)) / 2
      if (side === "n") box.position.set(0, ypos, -FZ - off)
      if (side === "s") box.position.set(0, ypos, FZ + off)
      if (side === "w") {
        box.rotation.y = Math.PI / 2
        box.position.set(-FX - off, ypos, 0)
      }
      if (side === "e") {
        box.rotation.y = Math.PI / 2
        box.position.set(FX + off, ypos, 0)
      }
      box.receiveShadow = shadows
      group.add(box)
      // people along this row
      const seats = Math.floor(along / 0.55)
      for (let k = 0; k < seats; k++) {
        if (rnd() > fill) continue
        const a = -along / 2 + 0.3 + k * 0.55 + (rnd() - 0.5) * 0.12
        const top = rise * (r + 1)
        let x
        let z
        let yaw
        if (side === "n") [x, z, yaw] = [a, -FZ - off, 0]
        if (side === "s") [x, z, yaw] = [a, FZ + off, Math.PI]
        if (side === "w") [x, z, yaw] = [-FX - off, a, Math.PI / 2]
        if (side === "e") [x, z, yaw] = [FX + off, a, -Math.PI / 2]
        people.push({ x, y: top, z, yaw, shirt: SHIRTS[Math.floor(rnd() * SHIRTS.length)], skin: SKINS[Math.floor(rnd() * SKINS.length)], phase: rnd() * 6.28, scale: 0.9 + rnd() * 0.2 })
      }
    }
  }

  if (venue === "park" || venue === "winter") {
    // chain link fence on posts, a windscreen along the bottom, trees and hills beyond
    const fenceTex = canvasTexture(64, 64, (ctx, w) => {
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
    keep(fenceTex)
    fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping
    const fenceH = 3
    const sides = [
      { w: 2 * FX, x: 0, z: -FZ, ry: 0 },
      { w: 2 * FX, x: 0, z: FZ, ry: Math.PI },
      { w: 2 * FZ, x: -FX, z: 0, ry: Math.PI / 2 },
      { w: 2 * FZ, x: FX, z: 0, ry: -Math.PI / 2 },
    ]
    const fenceMat = keep(new THREE.MeshBasicMaterial({ map: fenceTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }))
    const screenMat = lambert(0x1f4a37, { side: THREE.DoubleSide })
    const railMat = lambert(0x3d4a45)
    for (const s of sides) {
      const geo = keep(new THREE.PlaneGeometry(s.w, fenceH))
      const uv = geo.attributes.uv
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s.w * 6, uv.getY(i) * fenceH * 6)
      const fence = new THREE.Mesh(geo, fenceMat)
      fence.position.set(s.x, fenceH / 2, s.z)
      fence.rotation.y = s.ry
      fence.renderOrder = 1
      group.add(fence)
      const screen = new THREE.Mesh(keep(new THREE.PlaneGeometry(s.w, 1.2)), screenMat)
      screen.position.set(s.x, 0.6, s.z)
      screen.rotation.y = s.ry
      group.add(screen)
      const rail = new THREE.Mesh(keep(new THREE.BoxGeometry(s.w, 0.05, 0.05)), railMat)
      rail.position.set(s.x, fenceH, s.z)
      rail.rotation.y = s.ry
      group.add(rail)
    }
    const postGeo = keep(new THREE.CylinderGeometry(0.035, 0.035, fenceH, 6))
    const posts = []
    for (let x = -FX; x <= FX + 0.01; x += (2 * FX) / 4) posts.push([x, -FZ], [x, FZ])
    for (let z = -FZ + (2 * FZ) / 8; z < FZ - 0.01; z += (2 * FZ) / 8) posts.push([-FX, z], [FX, z])
    const postMesh = new THREE.InstancedMesh(postGeo, railMat, posts.length)
    const m4 = new THREE.Matrix4()
    posts.forEach(([x, z], i) => postMesh.setMatrixAt(i, m4.makeTranslation(x, fenceH / 2, z)))
    group.add(postMesh)
    // a couple of benches and a few spectators on them
    stands("w", 1, 0.25, 0x7a5a3a)
  } else if (venue === "club") {
    adBoards(0.9)
    stands("w", 4, 0.55, 0x8a8f99)
    stands("e", 2, 0.35, 0x8a8f99)
    // the clubhouse behind the far baseline
    const house = new THREE.Mesh(keep(new THREE.BoxGeometry(18, 5, 6)), std(0xe9dcc4))
    house.position.set(0, 2.5, -FZ - 9)
    group.add(house)
    const roof = new THREE.Mesh(keep(new THREE.ConeGeometry(11.5, 3, 4)), std(0x8c3b2f))
    roof.rotation.y = Math.PI / 4
    roof.scale.set(1, 1, 0.42)
    roof.position.set(0, 6.5, -FZ - 9)
    group.add(roof)
    const winMat = keep(new THREE.MeshBasicMaterial({ color: 0xffd9a0 }))
    for (let i = -3; i <= 3; i++) {
      const w = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.2, 1.4)), winMat)
      w.position.set(i * 2.4, 2.6, -FZ - 5.98)
      group.add(w)
    }
    // hedges
    const hedgeMat = lambert(0x2f5a2a, { flatShading: true })
    for (const s of [-1, 1]) {
      const hedge = new THREE.Mesh(keep(new THREE.BoxGeometry(1.2, 1.4, 2 * FZ + 4)), hedgeMat)
      hedge.position.set(s * (FX + (s < 0 ? 5.4 : 3.6)), 0.7, 0)
      group.add(hedge)
    }
  } else if (venue === "beach") {
    // the beach: the sea beyond the far baseline, a rope on posts round the court, a few
    // umbrellas and towels, palm trees (below)
    const sea = new THREE.Mesh(keep(new THREE.PlaneGeometry(400, 160)), lambert(0x2f8fc7))
    sea.rotation.x = -Math.PI / 2
    sea.position.set(0, -0.02, -FZ - 95)
    group.add(sea)
    const surf = new THREE.Mesh(keep(new THREE.PlaneGeometry(400, 3)), lambert(0xeaf6fb))
    surf.rotation.x = -Math.PI / 2
    surf.position.set(0, -0.015, -FZ - 15.5)
    group.add(surf)
    const ropeMat = lambert(0xf2efe6)
    const postMat = lambert(0x8a6a44)
    const posts = []
    for (let x = -FX; x <= FX + 0.01; x += (2 * FX) / 4) posts.push([x, -FZ], [x, FZ])
    for (let z = -FZ + (2 * FZ) / 6; z < FZ - 0.01; z += (2 * FZ) / 6) posts.push([-FX, z], [FX, z])
    const postMesh = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.05, 0.06, 1.0, 6)), postMat, posts.length)
    const m4 = new THREE.Matrix4()
    posts.forEach(([x, z], i) => postMesh.setMatrixAt(i, m4.makeTranslation(x, 0.5, z)))
    group.add(postMesh)
    for (const [w, x, z, ry] of [[2 * FX, 0, -FZ, 0], [2 * FX, 0, FZ, 0], [2 * FZ, -FX, 0, Math.PI / 2], [2 * FZ, FX, 0, Math.PI / 2]]) {
      const rope = new THREE.Mesh(keep(new THREE.BoxGeometry(w, 0.03, 0.03)), ropeMat)
      rope.position.set(x, 0.95, z)
      rope.rotation.y = ry
      group.add(rope)
    }
    // umbrellas and towels along the sides
    const colors = [0xef476f, 0xffd166, 0x06d6a0, 0x118ab2, 0xff8c42]
    let us = 3
    const ur = () => ((us = (us * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1
      const x = side * (FX + 3 + ur() * 5)
      const z = -FZ + 2 + ur() * (2 * FZ - 4)
      const c = colors[i % colors.length]
      const pole = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 5)), lambert(0xeeeeee))
      pole.position.set(x, 1.1, z)
      group.add(pole)
      const top = new THREE.Mesh(keep(new THREE.ConeGeometry(1.3, 0.5, 8)), lambert(c, { flatShading: true }))
      top.position.set(x, 2.25, z)
      group.add(top)
      const towel = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.8, 1.7)), lambert(colors[(i + 2) % colors.length]))
      towel.rotation.x = -Math.PI / 2
      towel.rotation.z = ur() * 0.6 - 0.3
      towel.position.set(x + side * 1.1, 0.0, z + 0.4)
      group.add(towel)
    }
    stands("e", 2, 0.3, 0xd9c7a0)
  } else {
    // the stadium: ad boards, stands all round, light towers and a big screen
    adBoards(1.0)
    stands("w", 9, 0.9, 0x2a2f45)
    stands("e", 9, 0.9, 0x2a2f45)
    stands("n", 6, 0.85, 0x2a2f45)
    stands("s", 4, 0.8, 0x2a2f45)
    const towerMat = std(0x3a3f50, { metalness: 0.4, roughness: 0.5 })
    const lampMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff }))
    const glowTex = canvasTexture(64, 64, (ctx, w) => {
      const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
      g.addColorStop(0, "rgba(255,255,255,1)")
      g.addColorStop(0.25, "rgba(220,230,255,0.55)")
      g.addColorStop(1, "rgba(200,210,255,0)")
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, w)
    })
    keep(glowTex)
    const glowMat = keep(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }))
    for (const [x, z] of [[-FX - 9, -FZ - 4], [FX + 9, -FZ - 4], [-FX - 9, FZ + 4], [FX + 9, FZ + 4]]) {
      const pole = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.25, 0.35, 22, 8)), towerMat)
      pole.position.set(x, 11, z)
      group.add(pole)
      const head = new THREE.Mesh(keep(new THREE.BoxGeometry(3.2, 1.8, 0.4)), towerMat)
      head.position.set(x, 22.5, z)
      head.lookAt(0, 0, 0)
      group.add(head)
      for (let i = 0; i < 6; i++) {
        const lamp = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.85, 0.65)), lampMat)
        lamp.position.set(x, 22.5, z)
        lamp.lookAt(0, 0, 0)
        lamp.translateZ(0.25)
        lamp.translateX((i % 3) * 1 - 1)
        lamp.translateY(Math.floor(i / 3) * 0.75 - 0.37)
        group.add(lamp)
      }
      const glow = new THREE.Sprite(glowMat)
      glow.position.set(x, 22.5, z)
      glow.scale.set(14, 14, 1)
      group.add(glow)
    }
  }

  // the big screen (Club and Stadium): a canvas we redraw with the score
  let screen = null
  let screenCanvas = null
  if (venue === "club" || venue === "stadium") {
    screenCanvas = document.createElement("canvas")
    screenCanvas.width = 512
    screenCanvas.height = 256
    const tex = keep(new THREE.CanvasTexture(screenCanvas))
    tex.colorSpace = THREE.SRGBColorSpace
    const frameMesh = new THREE.Mesh(keep(new THREE.BoxGeometry(10.6, 5.6, 0.4)), std(0x1a1d26))
    const zpos = venue === "stadium" ? -FZ - 8.5 : -FZ - 5.5
    const ypos = venue === "stadium" ? 9 : 9.5
    frameMesh.position.set(0, ypos, zpos - 0.25)
    group.add(frameMesh)
    screen = new THREE.Mesh(keep(new THREE.PlaneGeometry(10, 5)), keep(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })))
    screen.position.set(0, ypos, zpos)
    group.add(screen)
    const legs = new THREE.Mesh(keep(new THREE.BoxGeometry(0.5, ypos - 2.8, 0.5)), std(0x2a2f40))
    legs.position.set(0, (ypos - 2.8) / 2, zpos - 0.3)
    group.add(legs)
  }

  // ---- the crowd ----
  if (people.length) {
    // seated: a torso (wider at the shoulders) with arms, and a head
    const torso = new THREE.CylinderGeometry(0.2, 0.16, 0.5, 7)
    torso.translate(0, 0.25, 0)
    const armL = new THREE.CylinderGeometry(0.05, 0.05, 0.42, 5)
    armL.translate(0.23, 0.2, 0.04)
    const armR = armL.clone()
    armR.translate(-0.46, 0, 0)
    const parts = [torso, armL, armR].map((g) => g.toNonIndexed())
    const bodyGeo = keep(mergeGeometries(parts))
    // arms: marked (aArm = 1) so the shader can raise them when the crowd cheers
    const arm = new Float32Array(bodyGeo.attributes.position.count)
    for (let i = parts[0].attributes.position.count; i < arm.length; i++) arm[i] = 1
    ;[torso, armL, armR, ...parts].forEach((g) => g.dispose())
    bodyGeo.setAttribute("aArm", new THREE.BufferAttribute(arm, 1))
    const headGeo = keep(new THREE.SphereGeometry(0.12, 8, 6))
    headGeo.translate(0, 0.64, 0)
    const phase = new Float32Array(people.length)
    people.forEach((q, i) => (phase[i] = q.phase))
    const uniforms = { uTime: { value: 0 }, uExcite: { value: 0 } }
    const crowdMat = (base) => {
      const m = keep(new THREE.MeshLambertMaterial({ color: base }))
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uniforms.uTime
        shader.uniforms.uExcite = uniforms.uExcite
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nattribute float aPhase;\n#ifdef CROWD_ARMS\nattribute float aArm;\n#endif\nuniform float uTime;\nuniform float uExcite;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nfloat bounce = abs(sin(uTime * (3.0 + fract(aPhase) * 3.0) + aPhase));\ntransformed.y += (0.02 + uExcite * 0.22) * bounce + sin(uTime * 0.7 + aPhase) * 0.01;\n#ifdef CROWD_ARMS\ntransformed.y += aArm * smoothstep(0.25, 0.7, uExcite * (0.6 + 0.4 * fract(aPhase * 7.0))) * 0.42;\n#endif")
      }
      return m
    }
    const bodyMat = crowdMat(0xffffff)
    bodyMat.defines = { CROWD_ARMS: 1 }
    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, people.length)
    const heads = new THREE.InstancedMesh(headGeo, crowdMat(0xffffff), people.length)
    bodyGeo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1))
    headGeo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1))
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const col = new THREE.Color()
    people.forEach((pp, i) => {
      m4.compose(new THREE.Vector3(pp.x, pp.y, pp.z), q.setFromEuler(new THREE.Euler(0, pp.yaw, 0)), new THREE.Vector3(pp.scale, pp.scale, pp.scale))
      bodies.setMatrixAt(i, m4)
      heads.setMatrixAt(i, m4)
      bodies.setColorAt(i, col.setHex(pp.shirt))
      heads.setColorAt(i, col.setHex(pp.skin))
    })
    bodies.frustumCulled = false
    heads.frustumCulled = false
    group.add(bodies, heads)
    let excite = 0
    let target = 0
    crowd = {
      count: people.length,
      // excitement 0..1 (a cheer jumps it up and it settles)
      cheer(level = 1) {
        target = Math.max(target, level)
      },
      update(t, dt) {
        target = Math.max(0, target - dt * 0.45)
        excite += (target - excite) * (1 - Math.exp(-dt * 6))
        uniforms.uTime.value = t
        uniforms.uExcite.value = excite
      },
    }
  }

  // the beach's palms
  if (venue === "beach") {
    let ps = 5
    const pr = () => ((ps = (ps * 16807) % 2147483647) / 2147483647)
    const trunkMat = lambert(0x8b6b45, { flatShading: true })
    const frondMat = lambert(0x3f8f3a, { flatShading: true, side: THREE.DoubleSide })
    const frond = keep(new THREE.ConeGeometry(0.5, 3.2, 4, 1, true))
    frond.translate(0, 1.6, 0)
    for (let i = 0; i < 26; i++) {
      const a = pr() * Math.PI * 2
      const r = 20 + pr() * 30
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r * 0.7 + 4
      if (Math.abs(x) < FX + 6 && Math.abs(z) < FZ + 6) continue
      if (z < -FZ - 13) continue // (not in the sea)
      const h = 6 + pr() * 3
      const lean = (pr() - 0.5) * 0.5
      const trunk = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.18, 0.3, h, 6)), trunkMat)
      trunk.position.set(x, h / 2, z)
      trunk.rotation.z = lean
      group.add(trunk)
      const topX = x - Math.sin(lean) * h * 0.5
      const topY = Math.cos(lean) * h
      for (let k = 0; k < 6; k++) {
        const f = new THREE.Mesh(frond, frondMat)
        f.position.set(topX, topY, z)
        f.rotation.set(0, (k / 6) * Math.PI * 2, 1.9)
        f.scale.set(1, 1, 0.25)
        group.add(f)
      }
    }
  }
  // trees and hills for the outdoor venues (winter: snowy evergreens and white hills)
  if (venue === "park" || venue === "club" || venue === "winter") {
    const trees = []
    let seed = 7
    const r2 = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 70; i++) {
      const a = r2() * Math.PI * 2
      const r = 24 + r2() * 45
      const x = Math.cos(a) * r * 0.8
      const z = Math.sin(a) * r
      if (Math.abs(x) < FX + 9 && Math.abs(z) < FZ + 9) continue
      trees.push({ x, z, s: 0.8 + r2() * 1.1 })
    }
    const leaf = venue === "club" ? 0x4f6b2c : venue === "winter" ? 0x2e5a45 : 0x2f7a3c
    const crown = new THREE.InstancedMesh(keep(venue === "winter" ? new THREE.ConeGeometry(1.5, 3.6, 7) : new THREE.IcosahedronGeometry(1.6, 0)), lambert(leaf, { flatShading: true }), trees.length)
    const trunk = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.18, 0.25, 2, 5)), lambert(0x6b4a2b), trees.length)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    trees.forEach((t, i) => {
      crown.setMatrixAt(i, m4.compose(new THREE.Vector3(t.x, 2.6 * t.s + 1, t.z), q.setFromEuler(new THREE.Euler(0, t.x, 0)), new THREE.Vector3(t.s, t.s * 1.25, t.s)))
      trunk.setMatrixAt(i, m4.compose(new THREE.Vector3(t.x, t.s, t.z), q.identity(), new THREE.Vector3(t.s, t.s, t.s)))
    })
    group.add(crown, trunk)
    if (venue === "winter") {
      // snow on the evergreens' tops
      const caps = new THREE.InstancedMesh(keep(new THREE.ConeGeometry(0.9, 1.4, 7)), lambert(0xf4f8fc, { flatShading: true }), trees.length)
      trees.forEach((t, i) => caps.setMatrixAt(i, m4.compose(new THREE.Vector3(t.x, 2.6 * t.s + 1 + 1.55 * t.s * 1.25, t.z), q.identity(), new THREE.Vector3(t.s, t.s * 1.25, t.s))))
      group.add(caps)
    }
    const hillMat = lambert(venue === "club" ? 0x6a7f3c : venue === "winter" ? 0xe9eef4 : 0x5d9a4a, { flatShading: true })
    for (const [x, z, r] of [[-60, -110, 38], [30, -125, 48], [95, -80, 34], [-110, -40, 30], [110, 20, 36], [-95, 70, 30]]) {
      const hill = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(r, 1)), hillMat)
      hill.scale.y = 0.35
      hill.position.set(x, -2, z)
      group.add(hill)
    }
  }

  // falling snow (winter): points drifting down round the court, wrapped round as they fall
  let snow = null
  if (V.snow) {
    const n = quality === "low" ? 500 : 1400
    const pos = new Float32Array(n * 3)
    let ss = 17
    const sr = () => ((ss = (ss * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < n; i++) pos.set([(sr() - 0.5) * 40, sr() * 14, (sr() - 0.5) * 50], i * 3)
    const g = keep(new THREE.BufferGeometry())
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    const flakeTex = keep(canvasTexture(16, 16, (ctx, w) => {
      const gr = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
      gr.addColorStop(0, "rgba(255,255,255,1)")
      gr.addColorStop(1, "rgba(255,255,255,0)")
      ctx.fillStyle = gr
      ctx.fillRect(0, 0, w, w)
    }))
    snow = new THREE.Points(g, keep(new THREE.PointsMaterial({ size: 0.09, map: flakeTex, transparent: true, depthWrite: false, color: 0xffffff })))
    snow.frustumCulled = false
    scene.add(snow)
    disposables.push({ dispose: () => scene.remove(snow) })
  }
  const update = (t, dt) => {
    if (!snow) return
    const p = snow.geometry.attributes.position
    const a = p.array
    for (let i = 0; i < a.length; i += 3) {
      a[i + 1] -= dt * (0.7 + ((i * 7) % 5) * 0.08)
      a[i] += Math.sin(t * 0.7 + i) * dt * 0.15
      if (a[i + 1] < 0) a[i + 1] += 14
    }
    p.needsUpdate = true
  }

  mergeStatic(group, keep)
  scene.add(group)
  scene.fog = new THREE.Fog(V.fog[0], V.fog[1], V.fog[2])
  // the realism kit (docs/venue-realism.md) on Medium/High: textured surfaces, and contact
  // darkness baked from the venue's own geometry (stands, fences, posts) like the real venues
  applySurfaces(group, { quality })
  const cancelAO = quality !== "low" ? bakeVenueAO(group, { x0: -AX - 6, z0: -AZ - 6, x1: AX + 6, z1: AZ + 6 }) : (clearBakedAO(), null)

  // the big screen's picture: the score (and a message like "REPLAY")
  // the biggest bold type (from `size` down to `min`) that fits `width`; fillText's maxWidth
  // squeezes anything still too long
  const fit = (ctx, text, size, min, width) => {
    while (size > min) {
      ctx.font = `bold ${size}px Arial, sans-serif`
      if (ctx.measureText(text).width <= width) return
      size -= 2
    }
    ctx.font = `bold ${min}px Arial, sans-serif`
  }
  let lastScreen = {}
  // compact: the picture is behind the score panel (a phone held upright), so the screen goes
  // dark instead of showing a second, half-hidden copy of the score through it
  const drawScreen = ({ names = ["", ""], score = [0, 0], call = "", message = "", compact = lastScreen.compact } = {}) => {
    lastScreen = { names, score, call, message, compact }
    if (!screenCanvas) return
    const ctx = screenCanvas.getContext("2d")
    const w = screenCanvas.width
    const h = screenCanvas.height
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, "#0d1530")
    g.addColorStop(1, "#05081a")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = "#ffd23f"
    ctx.fillRect(0, 0, w, 10)
    ctx.textBaseline = "middle"
    if (message && !compact) {
      ctx.fillStyle = "#ffffff"
      ctx.textAlign = "center"
      fit(ctx, message, 80, 30, w - 40)
      ctx.fillText(message, w / 2, h / 2, w - 40)
    } else if (compact) {
      // (no text: anything written here shows through the score panel)
    } else {
      // names on the left, scores right-aligned in a column wide enough for two digits
      const nameW = w - 26 - 30 - 92 - 14
      for (let i = 0; i < 2; i++) {
        const yy = 70 + i * 80
        const name = String(names[i]).slice(0, 32).toUpperCase()
        ctx.textAlign = "left"
        ctx.fillStyle = i ? "#ff8a7a" : "#7fe3ef"
        fit(ctx, name, 40, 22, nameW)
        ctx.fillText(name, 26, yy, nameW)
        ctx.textAlign = "right"
        ctx.fillStyle = "#ffffff"
        ctx.font = "bold 64px Arial, sans-serif"
        ctx.fillText(String(score[i]), w - 30, yy, 92)
      }
      ctx.textAlign = "center"
      ctx.fillStyle = "#ffd23f"
      fit(ctx, call, 30, 18, w - 40)
      ctx.fillText(call, w / 2, h - 28, w - 40)
    }
    screen.material.map.needsUpdate = true
  }
  // (a phone turned: redraw the same picture, compact or not)
  const setScreenCompact = (compact) => {
    if (!!compact === !!lastScreen.compact) return
    drawScreen({ ...lastScreen, compact: !!compact })
  }
  drawScreen()

  return {
    group,
    def: V,
    sun,
    crowd,
    umpireSeat,
    drawScreen,
    setScreenCompact,
    update,
    dispose() {
      cancelAO?.()
      clearBakedAO()
      scene.remove(group)
      disposables.forEach((d) => d.dispose?.())
    },
  }
}
