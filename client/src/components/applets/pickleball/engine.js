// Pickleball 98's engine: the three.js court, players and ball, the camera, input, sound,
// and the frame loop. The game itself (physics, rules, AI) is match.js; this file only
// draws it and feeds it your controls. three.js is loaded with this file, on first open.

import * as THREE from "three"
import { BALL_R, HALF_L, HALF_W, KITCHEN, LINE_W, NET_POST_X, netHeightAt, predictPath, STEP } from "./physics.js"
import { createMatch, advance, playerById, scoreboard, setMove, step, swing, scenario } from "./match.js"
import { KIND_LABEL } from "./shots.js"
import { rightSign, sideOf } from "./rules.js"
import { createAudio } from "./audio.js"

const BALL_SCALE = 1.6 // drawn a little bigger than life so it reads on a phone
const TEAM_COLORS = [
  { shirt: 0x1a9fb0, shorts: 0x23395d, paddle: 0xffd23f, edge: 0x15223a },
  { shirt: 0xe8604c, shorts: 0x3b2d4f, paddle: 0x54d6a0, edge: 0x1d3a2c },
]
const PARTNER_SHIRT = [0x45c4a8, 0xf0a13c]
const SKIN = [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69]
const HAIR = [0x2b1b0e, 0x5a3825, 0xd9b26a, 0x1b1b1b]
const TRAIL_N = 14

const canvasTexture = (w, h, draw) => {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  draw(c.getContext("2d"), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// ---------- the world ----------

const quad = (positions, x0, z0, x1, z1, y) => {
  positions.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1)
}

const buildCourt = (scene, tex) => {
  const group = new THREE.Group()
  // grass beyond the fence, the green apron, the blue court, a lighter blue kitchen
  const grass = new THREE.Mesh(new THREE.CircleGeometry(170, 40), new THREE.MeshLambertMaterial({ color: 0x6fae55 }))
  grass.rotation.x = -Math.PI / 2
  grass.position.y = -0.02
  group.add(grass)
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(2 * (HALF_W + 3.6), 2 * (HALF_L + 5.8)), new THREE.MeshLambertMaterial({ color: 0x3c8a5a }))
  apron.rotation.x = -Math.PI / 2
  apron.position.y = -0.005
  group.add(apron)
  const court = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF_W, 2 * HALF_L), new THREE.MeshLambertMaterial({ color: 0x2f62ad }))
  court.rotation.x = -Math.PI / 2
  group.add(court)
  const kitchen = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF_W, 2 * KITCHEN), new THREE.MeshLambertMaterial({ color: 0x3b75c4 }))
  kitchen.rotation.x = -Math.PI / 2
  kitchen.position.y = 0.001
  group.add(kitchen)

  // the lines: 2 in wide, inside the court's outer edges (they're part of the court)
  const L = LINE_W
  const p = []
  const y = 0.003
  quad(p, -HALF_W, -HALF_L, HALF_W, -HALF_L + L, y) // baselines
  quad(p, -HALF_W, HALF_L - L, HALF_W, HALF_L, y)
  quad(p, -HALF_W, -HALF_L, -HALF_W + L, HALF_L, y) // sidelines
  quad(p, HALF_W - L, -HALF_L, HALF_W, HALF_L, y)
  quad(p, -HALF_W, -KITCHEN, HALF_W, -KITCHEN + L, y) // kitchen (NVZ) lines: the line is in the kitchen
  quad(p, -HALF_W, KITCHEN - L, HALF_W, KITCHEN, y)
  quad(p, -L / 2, KITCHEN, L / 2, HALF_L, y) // centerlines, kitchen line to baseline
  quad(p, -L / 2, -HALF_L, L / 2, -KITCHEN, y)
  quad(p, -L / 2, -HALF_L, L / 2, -HALF_L + 0.3, y + 0.0005) // baseline center marks
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3))
  g.computeVertexNormals()
  const lines = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xf4f7fb }))
  group.add(lines)

  // the net: posts, a sagging mesh, the white tape, the center strap
  const postMat = new THREE.MeshLambertMaterial({ color: 0x2b2f36 })
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.98, 10), postMat)
    post.position.set(s * NET_POST_X, 0.49, 0)
    group.add(post)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 12), postMat)
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
  const netGeo = new THREE.BufferGeometry()
  netGeo.setAttribute("position", new THREE.Float32BufferAttribute(netPos, 3))
  netGeo.setAttribute("uv", new THREE.Float32BufferAttribute(netUv, 2))
  netGeo.setIndex(netIdx)
  const net = new THREE.Mesh(netGeo, new THREE.MeshBasicMaterial({ map: tex.net, transparent: true, side: THREE.DoubleSide, depthWrite: false }))
  net.renderOrder = 2
  group.add(net)
  const tapeGeo = new THREE.BufferGeometry()
  tapeGeo.setAttribute("position", new THREE.Float32BufferAttribute(tapePos, 3))
  tapeGeo.setIndex(netIdx)
  const tape = new THREE.Mesh(tapeGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }))
  group.add(tape)
  const strap = new THREE.Mesh(new THREE.PlaneGeometry(0.05, netHeightAt(0) - 0.05), new THREE.MeshBasicMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide }))
  strap.position.set(0, (netHeightAt(0) - 0.05) / 2 + 0.03, 0.002)
  group.add(strap)

  // the fence: chain link on posts, with a dark windscreen along the bottom
  const FX = HALF_W + 3.6
  const FZ = HALF_L + 5.8
  const fenceH = 3
  const sides = [
    { w: 2 * FX, x: 0, z: -FZ, ry: 0 },
    { w: 2 * FX, x: 0, z: FZ, ry: Math.PI },
    { w: 2 * FZ, x: -FX, z: 0, ry: Math.PI / 2 },
    { w: 2 * FZ, x: FX, z: 0, ry: -Math.PI / 2 },
  ]
  const fenceMat = new THREE.MeshBasicMaterial({ map: tex.fence, transparent: true, side: THREE.DoubleSide, depthWrite: false })
  const screenMat = new THREE.MeshLambertMaterial({ color: 0x1f4a37, side: THREE.DoubleSide })
  const railMat = new THREE.MeshLambertMaterial({ color: 0x3d4a45 })
  for (const s of sides) {
    const geo = new THREE.PlaneGeometry(s.w, fenceH)
    const uv = geo.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s.w * 6, uv.getY(i) * fenceH * 6)
    const fence = new THREE.Mesh(geo, fenceMat)
    fence.position.set(s.x, fenceH / 2, s.z)
    fence.rotation.y = s.ry
    fence.renderOrder = 1
    group.add(fence)
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(s.w, 1.2), screenMat)
    screen.position.set(s.x, 0.6, s.z)
    screen.rotation.y = s.ry
    group.add(screen)
    const rail = new THREE.Mesh(new THREE.BoxGeometry(s.w, 0.05, 0.05), railMat)
    rail.position.set(s.x, fenceH, s.z)
    rail.rotation.y = s.ry
    group.add(rail)
  }
  const postGeo = new THREE.CylinderGeometry(0.035, 0.035, fenceH, 6)
  const posts = []
  for (let x = -FX; x <= FX + 0.01; x += (2 * FX) / 4) posts.push([x, -FZ], [x, FZ])
  for (let z = -FZ + (2 * FZ) / 8; z < FZ - 0.01; z += (2 * FZ) / 8) posts.push([-FX, z], [FX, z])
  const postMesh = new THREE.InstancedMesh(postGeo, railMat, posts.length)
  const m4 = new THREE.Matrix4()
  posts.forEach(([x, z], i) => postMesh.setMatrixAt(i, m4.makeTranslation(x, fenceH / 2, z)))
  group.add(postMesh)

  // trees and hills beyond the fence (instanced: two draw calls for the whole forest)
  const trees = []
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2
    const r = 22 + rnd() * 45
    const x = Math.cos(a) * r * 0.8
    const z = Math.sin(a) * r
    if (Math.abs(x) < FX + 4 && Math.abs(z) < FZ + 4) continue
    trees.push({ x, z, s: 0.8 + rnd() * 1.1 })
  }
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, 0), new THREE.MeshLambertMaterial({ color: 0x2f7a3c, flatShading: true }), trees.length)
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 2, 5), new THREE.MeshLambertMaterial({ color: 0x6b4a2b }), trees.length)
  const q = new THREE.Quaternion()
  trees.forEach((t, i) => {
    crown.setMatrixAt(i, m4.compose(new THREE.Vector3(t.x, 2.6 * t.s + 1, t.z), q.setFromEuler(new THREE.Euler(0, t.x, 0)), new THREE.Vector3(t.s, t.s * 1.25, t.s)))
    trunk.setMatrixAt(i, m4.compose(new THREE.Vector3(t.x, t.s, t.z), q.identity(), new THREE.Vector3(t.s, t.s, t.s)))
  })
  group.add(crown, trunk)
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x5d9a4a, flatShading: true })
  for (const [x, z, r] of [[-60, -110, 38], [30, -125, 48], [95, -80, 34], [-110, -40, 30], [110, 20, 36], [-95, 70, 30]]) {
    const hill = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), hillMat)
    hill.scale.y = 0.35
    hill.position.set(x, -2, z)
    group.add(hill)
  }
  // a few puffy clouds
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0x9aa6b8 })
  const puff = new THREE.IcosahedronGeometry(1, 0)
  for (const [x, y, z, s] of [[-40, 30, -110, 7], [35, 36, -120, 9], [80, 28, -70, 6], [-90, 34, -30, 7], [10, 40, -140, 6]]) {
    for (let k = 0; k < 4; k++) {
      const c = new THREE.Mesh(puff, cloudMat)
      c.position.set(x + (k - 1.5) * s * 0.9, y + (k % 2) * s * 0.3, z)
      c.scale.set(s, s * 0.6, s * 0.7)
      group.add(c)
    }
  }
  scene.add(group)
  return group
}

const buildSky = (scene) => {
  const geo = new THREE.SphereGeometry(190, 24, 12)
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(0x3f8fe0) }, horizon: { value: new THREE.Color(0xd8ecfb) } },
    vertexShader: "varying float vY; void main() { vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 horizon; varying float vY; void main() { float t = pow(clamp(vY, 0.0, 1.0), 0.55); gl_FragColor = vec4(mix(horizon, top, t), 1.0); }",
  })
  const sky = new THREE.Mesh(geo, mat)
  sky.renderOrder = -1
  scene.add(sky)
  return sky
}

// ---------- players ----------

const makePlayerMesh = (team, partner, look, tex) => {
  const c = TEAM_COLORS[team]
  const g = new THREE.Group()
  const shirt = new THREE.MeshLambertMaterial({ color: partner ? PARTNER_SHIRT[team] : c.shirt, flatShading: true })
  const shorts = new THREE.MeshLambertMaterial({ color: c.shorts, flatShading: true })
  const skin = new THREE.MeshLambertMaterial({ color: SKIN[look % SKIN.length], flatShading: true })
  const hair = new THREE.MeshLambertMaterial({ color: HAIR[(look + team) % HAIR.length], flatShading: true })
  const shoe = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 })

  const body = new THREE.Group() // turns a little with the swing
  g.add(body)
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.2), shorts)
  hips.position.y = 0.88
  body.add(hips)
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.16, 0.56, 7), shirt)
  torso.position.y = 1.2
  body.add(torso)
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), skin)
  head.position.y = 1.62
  body.add(head)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.125, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), hair)
  cap.position.y = 1.64
  body.add(cap)
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.1), new THREE.MeshLambertMaterial({ color: c.edge }))
  visor.position.set(0, 1.66, 0.12)
  body.add(visor)

  const legs = []
  for (const s of [-1, 1]) {
    const hip = new THREE.Group()
    hip.position.set(s * 0.1, 0.84, 0)
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.05, 0.78, 6), skin)
    leg.position.y = -0.39
    hip.add(leg)
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.24), shoe)
    foot.position.set(0, -0.8, 0.05)
    hip.add(foot)
    g.add(hip)
    legs.push(hip)
  }
  // the left arm just hangs and swings; the right arm holds the paddle. Arms point along
  // -x (out to the right side) at rest: rotation.z lowers them, rotation.y swings them.
  const armL = new THREE.Group()
  armL.position.set(0.22, 1.42, 0)
  const al = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.6, 6), skin)
  al.position.y = -0.3
  armL.add(al)
  body.add(armL)

  const armR = new THREE.Group()
  armR.position.set(-0.22, 1.42, 0)
  const ar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.58, 6), skin)
  ar.rotation.z = Math.PI / 2
  ar.position.x = -0.29
  armR.add(ar)
  const paddle = new THREE.Group()
  paddle.position.x = -0.58
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.13, 6), new THREE.MeshLambertMaterial({ color: 0x222222 }))
  handle.rotation.z = Math.PI / 2
  handle.position.x = -0.06
  paddle.add(handle)
  // an 8 x 16 in paddle with rounded corners
  const shape = new THREE.Shape()
  const W = 0.1
  const H = 0.27
  const R = 0.05
  shape.moveTo(-W + R, 0)
  shape.lineTo(W - R, 0)
  shape.quadraticCurveTo(W, 0, W, R)
  shape.lineTo(W, H - R)
  shape.quadraticCurveTo(W, H, W - R, H)
  shape.lineTo(-W + R, H)
  shape.quadraticCurveTo(-W, H, -W, H - R)
  shape.lineTo(-W, R)
  shape.quadraticCurveTo(-W, 0, -W + R, 0)
  const face = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: false, curveSegments: 3 }), new THREE.MeshLambertMaterial({ color: c.paddle }))
  face.rotation.z = Math.PI / 2 // the face extends along -x from the handle
  face.position.set(-0.12, 0, -0.007)
  paddle.add(face)
  armR.add(paddle)
  body.add(armR)

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: tex.blob, transparent: true, depthWrite: false, opacity: 0.45 }))
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.006
  g.add(shadow)

  return { group: g, body, legs, armL, armR, shadow, stride: 0 }
}

// arm pose: yaw = forward/back sweep (+ is in front), drop = how far below horizontal
const poseFor = (p, ball) => {
  const s = p.swing
  const lowFor = (y) => Math.asin(Math.max(-0.9, Math.min(0.95, (1.42 - y) / 0.92)))
  if (s && !s.whiff) {
    const t = Math.min(1, s.t / 0.32)
    const big = s.kind === "drive" || s.kind === "smash" || s.kind === "serve" || s.kind === "return"
    const reach = big ? 1.9 : s.kind === "dink" || s.kind === "block" ? 0.9 : 1.4
    const drop0 = lowFor(s.y)
    const lift = s.kind === "lob" || s.kind === "serve" || s.kind === "drop" ? -0.9 : s.kind === "smash" ? 0.6 : -0.3
    const ease = 1 - Math.pow(1 - t, 3)
    const yaw = s.hand === "fh" ? 0.35 + ease * reach : Math.PI - 0.35 - ease * reach
    return { yaw, drop: drop0 + lift * ease, turn: (s.hand === "fh" ? 0.25 : -0.25) * (1 - ease) }
  }
  if (s?.whiff) {
    const t = Math.min(1, s.t / 0.3)
    return { yaw: -0.8 + t * 2.3, drop: 0.6, turn: 0 }
  }
  if (p.ballHeld) return { yaw: -0.9, drop: 1.1, turn: 0.15 } // waiting to serve: paddle back and low
  if (p.armed || p.ready) {
    // backswing, on the side the ball is coming
    const local = (ball.p.x - p.x) * rightSign(p.team)
    const fh = local >= -0.05
    const drop = lowFor(Math.max(0.2, Math.min(1.8, ball.p.y)))
    return fh ? { yaw: -0.7, drop, turn: 0.35 } : { yaw: Math.PI + 0.7, drop, turn: -0.35 }
  }
  return { yaw: 1.15, drop: 0.45, turn: 0 } // ready position: paddle up in front
}

// ---------- the engine ----------

export const createEngine = ({ canvas, container, onHud, onEvent, onStatus, settings: initial = {} }) => {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance", stencil: false })
  const maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  let pixelRatio = maxPixelRatio
  renderer.setPixelRatio(pixelRatio)
  renderer.setClearColor(0xd8ecfb)

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0xd8ecfb, 70, 185)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400)
  camera.position.set(0, 6, HALF_L + 8)
  const camTarget = new THREE.Vector3(0, 0.6, -2)
  const camLook = camTarget.clone()

  scene.add(new THREE.HemisphereLight(0xdcefff, 0x4d7a3c, 1.6))
  const sun = new THREE.DirectionalLight(0xfff3dc, 1.9)
  sun.position.set(-8, 20, 10)
  scene.add(sun)

  // textures drawn on canvases (no image files)
  const tex = {
    blob: canvasTexture(64, 64, (ctx, w) => {
      const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
      g.addColorStop(0, "rgba(0,0,0,0.85)")
      g.addColorStop(0.55, "rgba(0,0,0,0.45)")
      g.addColorStop(1, "rgba(0,0,0,0)")
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, w)
    }),
    net: canvasTexture(32, 32, (ctx, w) => {
      ctx.clearRect(0, 0, w, w)
      ctx.strokeStyle = "rgba(20,24,30,0.85)"
      ctx.lineWidth = 3
      ctx.strokeRect(0, 0, w, w)
    }),
    fence: canvasTexture(64, 64, (ctx, w) => {
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
    }),
    ball: canvasTexture(64, 32, (ctx, w, h) => {
      ctx.fillStyle = "#e9f24b"
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = "#b9c22a"
      for (let i = 0; i < 10; i++) {
        ctx.beginPath()
        ctx.arc((i * 13 + 5) % w, i % 2 ? h * 0.3 : h * 0.72, 2.6, 0, Math.PI * 2)
        ctx.fill()
      }
    }),
  }
  for (const k of ["net", "fence"]) {
    tex[k].wrapS = tex[k].wrapT = THREE.RepeatWrapping
    tex[k].anisotropy = 4
  }

  buildSky(scene)
  buildCourt(scene, tex)

  // ball, its shadow (crucial for judging height) and a short trail
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * BALL_SCALE, 16, 12), new THREE.MeshLambertMaterial({ map: tex.ball, emissive: 0x2c3000 }))
  scene.add(ballMesh)
  const ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex.blob, transparent: true, depthWrite: false }))
  ballShadow.rotation.x = -Math.PI / 2
  ballShadow.position.y = 0.008
  ballShadow.renderOrder = 3
  scene.add(ballShadow)
  const trailPos = new Float32Array(TRAIL_N * 3)
  const trailCol = new Float32Array(TRAIL_N * 4)
  const trailGeo = new THREE.BufferGeometry()
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3))
  trailGeo.setAttribute("color", new THREE.BufferAttribute(trailCol, 4))
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }))
  trail.frustumCulled = false
  scene.add(trail)
  const trailHistory = []

  // trajectory aid: the incoming ball's path to its bounce, and where it lands
  const AID_N = 90
  const aidPos = new Float32Array(AID_N * 3)
  const aidGeo = new THREE.BufferGeometry()
  aidGeo.setAttribute("position", new THREE.BufferAttribute(aidPos, 3))
  const aidLine = new THREE.Line(aidGeo, new THREE.LineDashedMaterial({ color: 0xfff6a8, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.85, depthWrite: false }))
  aidLine.frustumCulled = false
  aidLine.visible = false
  scene.add(aidLine)
  const ringGeo = new THREE.RingGeometry(0.16, 0.22, 24)
  ringGeo.rotateX(-Math.PI / 2)
  const landRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xfff6a8, transparent: true, opacity: 0.9, depthWrite: false }))
  landRing.position.y = 0.01
  landRing.visible = false
  scene.add(landRing)
  const aimRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.55, depthWrite: false }))
  aimRing.position.y = 0.012
  aimRing.visible = false
  scene.add(aimRing)
  // in/out marks where close balls landed
  const markMat = { in: new THREE.MeshBasicMaterial({ color: 0x46e07a, transparent: true, depthWrite: false }), out: new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, depthWrite: false }) }
  const mark = new THREE.Mesh(ringGeo, markMat.in)
  mark.visible = false
  mark.position.y = 0.011
  scene.add(mark)
  let markTimer = 0

  // ---------- state ----------
  let settings = { sound: true, camera: "follow", aid: true, assist: true, ...initial }
  const audio = createAudio()
  audio.setEnabled(settings.sound)
  let match = null
  let meshes = []
  let status = "title" // title (a demo match plays behind the menu) | playing | paused | over
  let size = { width: 0, height: 0 }
  let raf = 0
  let last = 0
  let disposed = false
  let hudKey = ""
  let hudTimer = 0
  let aidVersion = -1
  const keys = new Set()
  const aim = { x: 0, mouse: false }
  let charge = null // { start, kind, source }
  let stick = { x: 0, y: 0 }
  const perf = { frames: 0, cpuMs: 0, renderMs: 0, steps: 0 }
  const devLog = import.meta.env.DEV ? [] : null // every match event, for tests

  const setStatus = (s) => {
    status = s
    onStatus?.(s)
  }

  const buildPlayers = () => {
    for (const m of meshes) {
      scene.remove(m.group)
      m.group.traverse((o) => {
        o.geometry?.dispose()
        o.material?.dispose()
      })
    }
    meshes = match.players.map((p, i) => {
      const mesh = makePlayerMesh(p.team, p.id === "partner" || p.id === "opp2", i + (p.team ? 1 : 0), tex)
      scene.add(mesh.group)
      return mesh
    })
  }

  const startMatch = (opts, demo = false) => {
    match = createMatch({ ...opts, assist: settings.assist })
    match.autoplay = demo
    trailHistory.length = 0
    buildPlayers()
    hudKey = ""
    aidVersion = -1
    if (!demo) {
      audio.unlock()
      setStatus("playing")
      container.focus({ preventScroll: true })
    }
    start()
  }

  // ---------- input ----------

  const human = () => match?.players.find((p) => p.human)
  const playing = () => status === "playing" && match && !match.autoplay

  const aimNow = () => {
    // direction keys at the moment of the swing beat the mouse
    const l = keys.has("ArrowLeft") || keys.has("KeyA")
    const r = keys.has("ArrowRight") || keys.has("KeyD")
    if (l !== r) return l ? -0.85 : 0.85
    if (Math.abs(stick.x) > 0.3) return Math.sign(stick.x) * Math.min(1, Math.abs(stick.x))
    return aim.mouse ? aim.x : 0
  }

  const doSwing = (kind, power) => {
    if (!playing()) return false
    audio.unlock()
    return swing(match, { kind, power, aim: aimNow() })
  }

  const updateMove = () => {
    let x = 0
    let z = 0
    if (keys.has("ArrowLeft") || keys.has("KeyA")) x -= 1
    if (keys.has("ArrowRight") || keys.has("KeyD")) x += 1
    if (keys.has("ArrowUp") || keys.has("KeyW")) z -= 1
    if (keys.has("ArrowDown") || keys.has("KeyS")) z += 1
    x += stick.x
    z -= stick.y
    if (match) setMove(match, Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, z)))
  }

  const SHOT_KEYS = { KeyJ: ["dink", 0.3], Digit1: ["dink", 0.3], KeyK: ["drive", 0.85], Digit2: ["drive", 0.85], KeyL: ["lob", 0.5], Digit3: ["lob", 0.5], KeyI: ["drop", 0.4], Digit4: ["drop", 0.4] }
  const MOVE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA", "KeyD", "KeyW", "KeyS"])

  const onKeyDown = (e) => {
    if (e.target !== container && e.target.closest?.("input, textarea, select, button, .dialog")) return
    const code = e.code
    if (code === "KeyP" || (code === "Escape" && status === "playing")) {
      e.preventDefault()
      if (status === "playing") api.pause()
      else if (status === "paused") api.resume()
      return
    }
    if (status === "paused" && (code === "Escape" || code === "Space")) {
      e.preventDefault()
      api.resume()
      return
    }
    if (MOVE_KEYS.has(code)) {
      e.preventDefault()
      keys.add(code)
      updateMove()
      return
    }
    if (code === "Space") {
      e.preventDefault()
      if (!e.repeat && !charge) charge = { start: performance.now(), kind: "auto", hard: e.shiftKey }
      return
    }
    if (SHOT_KEYS[code] && !e.repeat) {
      e.preventDefault()
      const [kind, power] = SHOT_KEYS[code]
      doSwing(kind, e.shiftKey ? Math.max(power, 0.8) : power)
    }
  }
  const onKeyUp = (e) => {
    if (MOVE_KEYS.has(e.code)) {
      keys.delete(e.code)
      updateMove()
    }
    if (e.code === "Space" && charge) {
      // a tap is soft, a held swing is hard
      const held = performance.now() - charge.start
      const power = charge.hard || e.shiftKey ? 0.9 : Math.min(1, held / 380)
      charge = null
      doSwing("auto", power)
    }
  }

  let swipe = null
  const onPointerDown = (e) => {
    if (e.target !== canvas) return
    container.focus({ preventScroll: true })
    audio.unlock()
    if (e.pointerType === "mouse") {
      if (e.button === 2) {
        doSwing("lob", 0.5)
        return
      }
      if (e.button !== 0) return
      charge = { start: performance.now(), kind: "auto", y: e.clientY, t: e.timeStamp, minY: e.clientY }
    } else {
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }
    }
  }
  const onPointerMove = (e) => {
    if (e.pointerType === "mouse") {
      const r = canvas.getBoundingClientRect()
      aim.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2.4))
      aim.mouse = true
      if (charge && charge.minY !== undefined) charge.minY = Math.min(charge.minY, e.clientY)
    }
  }
  const onPointerUp = (e) => {
    if (e.pointerType === "mouse" && e.button === 0 && charge && charge.minY !== undefined) {
      const held = performance.now() - charge.start
      // flicking the mouse upward while holding is a hard swing
      const flick = Math.max(0, charge.y - charge.minY)
      const power = Math.min(1, Math.max(held / 380, flick / 90))
      charge = null
      doSwing("auto", power)
      return
    }
    if (swipe && swipe.id === e.pointerId) {
      const dx = e.clientX - swipe.x
      const dy = swipe.y - e.clientY
      const dt = performance.now() - swipe.t
      swipe = null
      if (dy > 35 && dt < 600) {
        // swipe up to swing: faster is harder, sideways aims
        const speed = Math.hypot(dx, dy) / Math.max(dt, 16)
        const power = Math.min(1, Math.max(0.15, (speed - 0.4) / 1.6))
        const saved = aim.mouse
        aim.mouse = true
        aim.x = Math.max(-1, Math.min(1, dx / 110))
        doSwing("auto", power)
        aim.mouse = saved
      } else if (Math.hypot(dx, dy) < 14 && dt < 350) {
        doSwing("auto", 0.3) // a tap is a soft swing
      }
    }
  }
  const onContextMenu = (e) => e.preventDefault()
  const onBlur = (e) => {
    if (container.contains(e.relatedTarget)) return
    keys.clear()
    charge = null
    updateMove()
    if (status === "playing") api.pause()
  }
  const onVisibility = () => {
    if (document.hidden && status === "playing") api.pause()
  }

  container.addEventListener("keydown", onKeyDown)
  container.addEventListener("keyup", onKeyUp)
  container.addEventListener("pointerdown", onPointerDown)
  container.addEventListener("pointermove", onPointerMove)
  container.addEventListener("pointerup", onPointerUp)
  container.addEventListener("pointercancel", onPointerUp)
  container.addEventListener("contextmenu", onContextMenu)
  container.addEventListener("focusout", onBlur)
  document.addEventListener("visibilitychange", onVisibility)

  // ---------- sizing ----------

  const resize = () => {
    const width = container.clientWidth
    const height = container.clientHeight
    size = { width, height }
    if (!width || !height) {
      if (status === "playing") api.pause() // minimized
      return
    }
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    start()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)

  let frameTimes = []
  let qualityClock = 0
  const adaptQuality = (dtMs) => {
    frameTimes.push(dtMs)
    qualityClock += dtMs
    if (qualityClock < 2500) return
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
    frameTimes = []
    qualityClock = 0
    let next = pixelRatio
    if (avg > 21 && pixelRatio > 0.75) next = Math.max(0.75, pixelRatio - 0.25)
    else if (avg < 15 && pixelRatio < maxPixelRatio) next = Math.min(maxPixelRatio, pixelRatio + 0.25)
    if (next !== pixelRatio) {
      pixelRatio = next
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(size.width, size.height, false)
    }
  }

  // ---------- per-frame drawing ----------

  const tmpV = new THREE.Vector3()
  let orbit = 0.6
  const updateCamera = (dt, snap) => {
    const p = human()
    const portrait = size.height > size.width * 1.05
    const mode = status === "title" ? "high" : settings.camera
    let pos
    let look
    if (status === "title") {
      // the demo match: a slow orbit around the court
      orbit += dt * 0.07
      pos = tmpV.set(Math.sin(orbit) * 6, portrait ? 12 : 7.5, Math.cos(orbit) * 11.5)
      look = camTarget.set(0, portrait ? -2 : -0.5, 0)
    } else if (mode === "high" || !p) {
      pos = tmpV.set(0, portrait ? 13 : 9, HALF_L + (portrait ? 9 : 7.5))
      look = camTarget.set(0, 0, portrait ? -1.5 : -1.2)
    } else {
      const hz = Math.max(2.4, p.z)
      const lift = portrait ? 1.8 : 0
      pos = tmpV.set(p.x * 0.55, 3.4 + lift + (hz - 2.4) * 0.08, hz + 5.4 + lift * 0.9)
      look = camTarget.set(p.x * 0.25 + match.ball.p.x * 0.15, 0.5, -3.2)
    }
    const fov = portrait ? (mode === "high" ? 58 : 66) : 50
    if (camera.fov !== fov) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * 3.2)
    camera.position.lerp(pos, k)
    camLook.lerp(look, k)
    camera.lookAt(camLook)
  }

  const updatePlayers = (dt) => {
    const ball = match.ball
    match.players.forEach((p, i) => {
      const mesh = meshes[i]
      if (!mesh) return
      mesh.group.position.set(p.x, 0, p.z)
      // face the net (team 0 looks toward -z), turned a little toward the ball
      const base = p.team === 0 ? Math.PI : 0
      const toBall = Math.atan2(ball.p.x - p.x, ball.p.z - p.z)
      let rel = toBall - base
      rel = Math.atan2(Math.sin(rel), Math.cos(rel))
      const wantY = base + Math.max(-0.7, Math.min(0.7, rel)) * 0.6
      const cur = mesh.group.rotation.y
      mesh.group.rotation.y = cur + Math.atan2(Math.sin(wantY - cur), Math.cos(wantY - cur)) * (1 - Math.exp(-dt * 6))
      const speed = Math.hypot(p.vx, p.vz)
      mesh.stride += speed * dt * 4.2
      const swingAmp = Math.min(0.75, speed * 0.22)
      mesh.legs[0].rotation.x = Math.sin(mesh.stride) * swingAmp
      mesh.legs[1].rotation.x = -Math.sin(mesh.stride) * swingAmp
      mesh.armL.rotation.x = -Math.sin(mesh.stride) * swingAmp * 0.6
      const coming = match.rally && match.rally.lastTeam !== null && match.rally.lastTeam !== p.team && Math.hypot(ball.p.x - p.x, ball.p.z - p.z) < 3.2
      p.ready = coming
      p.ballHeld = ball.held === p.id
      const pose = poseFor(p, ball)
      const arm = mesh.armR
      // ease toward the pose (fast, so swings snap like real ones)
      const k = p.swing ? 1 : 1 - Math.exp(-dt * 14)
      arm.rotation.y += (pose.yaw - arm.rotation.y) * k
      arm.rotation.z += (pose.drop - arm.rotation.z) * k
      mesh.body.rotation.y += (pose.turn - mesh.body.rotation.y) * (1 - Math.exp(-dt * 10))
      // a little crouch when ready
      mesh.body.position.y += ((p.ready || p.armed ? -0.06 : 0) - mesh.body.position.y) * (1 - Math.exp(-dt * 8))
      mesh.shadow.scale.setScalar(1)
    })
  }

  const updateBall = () => {
    const b = match.ball
    ballMesh.position.set(b.p.x, Math.max(BALL_R * BALL_SCALE, b.p.y), b.p.z)
    ballMesh.rotation.x += b.w.x * 0.004
    ballMesh.rotation.z += b.w.z * 0.004
    // the shadow shrinks and darkens as the ball comes down
    const h = Math.max(0, b.p.y - BALL_R)
    const s = BALL_R * BALL_SCALE * 2.6 * (1 + h * 0.35)
    ballShadow.position.set(b.p.x + h * 0.12, 0.008, b.p.z - h * 0.06)
    ballShadow.scale.set(s, s, s)
    ballShadow.material.opacity = Math.max(0.18, 0.85 - h * 0.18)
    // the trail: the last few positions, fading out (only while it's moving fast)
    trailHistory.unshift(b.p.x, b.p.y, b.p.z)
    if (trailHistory.length > TRAIL_N * 3) trailHistory.length = TRAIL_N * 3
    const fast = Math.hypot(b.v.x, b.v.y, b.v.z) > 4 && !b.held
    for (let i = 0; i < TRAIL_N; i++) {
      const j = Math.min(i, trailHistory.length / 3 - 1)
      trailPos[i * 3] = trailHistory[j * 3]
      trailPos[i * 3 + 1] = trailHistory[j * 3 + 1]
      trailPos[i * 3 + 2] = trailHistory[j * 3 + 2]
      trailCol[i * 4] = 1
      trailCol[i * 4 + 1] = 1
      trailCol[i * 4 + 2] = 0.75
      trailCol[i * 4 + 3] = fast ? 0.55 * (1 - i / TRAIL_N) : 0
    }
    trailGeo.attributes.position.needsUpdate = true
    trailGeo.attributes.color.needsUpdate = true
  }

  const updateAid = () => {
    const r = match.rally
    const you = human()
    const show = settings.aid && status === "playing" && you && r && r.lastTeam !== null && r.lastTeam !== you.team && !r.pending && !match.ball.held
    if (!show) {
      aidLine.visible = false
      landRing.visible = false
    } else if (aidVersion !== match.version) {
      aidVersion = match.version
      const path = predictPath({ p: match.ball.p, v: match.ball.v, w: match.ball.w }, { maxT: 2.5, every: 1 / 40, maxBounces: 1 })
      let n = 0
      let land = null
      for (const s of path) {
        if (n >= AID_N) break
        aidPos[n * 3] = s.x
        aidPos[n * 3 + 1] = s.y
        aidPos[n * 3 + 2] = s.z
        n++
        if (s.bounce) {
          land = s
          break
        }
      }
      aidGeo.setDrawRange(0, n)
      aidGeo.attributes.position.needsUpdate = true
      aidLine.computeLineDistances()
      aidLine.visible = n > 1
      landRing.visible = !!land && r.bounces === 0
      if (land) landRing.position.set(land.x, 0.01, land.z)
    }
    // where you're aiming (desktop mouse aim)
    const showAim = settings.aid && status === "playing" && you && aim.mouse && !(match.o && match.autoplay)
    aimRing.visible = !!showAim
    if (showAim) {
      const side = sideOf(1 - you.team)
      aimRing.position.set(aim.x * rightSign(you.team) * HALF_W * 0.62, 0.012, side * (HALF_L - 1.4))
    }
  }

  const sendHud = (force) => {
    const sb = scoreboard(match)
    const you = human()
    const server = playerById(match, sb.server)
    const yourServe = !!you && match.ball.held === you.id && (match.phase === "serve" || match.phase === "intro")
    const key = `${sb.call}|${sb.score}|${sb.serving}|${sb.server}|${yourServe}|${status}|${match.phase}`
    if (!force && key === hudKey) return
    hudKey = key
    onHud?.({
      call: sb.call,
      score: sb.score,
      serving: sb.serving,
      server: server?.name,
      serverNumber: sb.serverNumber,
      doubles: match.game.doubles,
      scoring: match.game.scoring,
      target: match.game.target,
      yourServe,
      phase: match.phase,
      demo: match.autoplay && status === "title",
    })
  }

  const handleEvents = () => {
    const you = human()
    for (const e of match.events) {
      if (devLog && status !== "title") {
        devLog.push(e)
        if (devLog.length > 2000) devLog.splice(0, 500)
      }
      switch (e.type) {
        case "hit":
          audio.pock(Math.min(1, e.paddle / 14))
          if (match.autoplay && status === "title") break
          onEvent?.({ type: "hit", kind: e.kind, label: KIND_LABEL[e.kind], mine: e.player === you?.id, speed: e.speed, volley: e.volley })
          break
        case "bounce":
          audio.bounce(Math.min(1, e.speed / 12))
          if (e.call && status !== "title") {
            mark.material = e.call === "In" ? markMat.in : markMat.out
            mark.position.set(e.x, 0.011, e.z)
            mark.visible = true
            markTimer = 1.4
            onEvent?.({ type: "line", call: e.call })
          }
          break
        case "net":
        case "tape":
          audio.net()
          break
        case "fault":
          if (status !== "title") onEvent?.({ type: "fault", call: e.call, reason: e.reason, winner: e.winner, yours: e.winner === you?.team })
          break
        case "point":
          if (status !== "title") {
            audio.chime(e.winner === you?.team)
            onEvent?.({ type: "point", ...e, yours: e.winner === you?.team })
          }
          break
        case "call":
          if (status !== "title") onEvent?.({ type: "call", call: e.call, server: playerById(match, e.server)?.name })
          break
        case "gameover":
          if (status === "title") {
            startMatch(demoOptions(), true)
            return
          }
          onEvent?.({ type: "gameover", winner: e.winner, score: e.score, youWon: e.winner === you?.team, stats: { ...match.stats } })
          setStatus("over")
          break
        default:
      }
    }
    match.events.length = 0
  }

  const frame = (now) => {
    raf = 0
    if (disposed) return
    if (!size.width || !size.height) return
    const cpuStart = performance.now()
    const dtMs = last ? Math.min(100, now - last) : 16
    const snap = !last
    last = now
    const dt = dtMs / 1000
    if (status !== "paused" && match) {
      perf.steps += advance(match, dt)
      handleEvents()
    }
    if (match) {
      updatePlayers(status === "paused" ? 0 : dt)
      updateBall()
      updateAid()
      updateCamera(dt, snap)
      if (markTimer > 0) {
        markTimer -= dt
        mark.material.opacity = Math.min(1, markTimer)
        if (markTimer <= 0) mark.visible = false
      }
      hudTimer += dtMs
      if (hudTimer > 100) {
        hudTimer = 0
        sendHud(false)
      }
    }
    const renderStart = performance.now()
    renderer.render(scene, camera)
    perf.frames++
    perf.renderMs += performance.now() - renderStart
    perf.cpuMs += renderStart - cpuStart
    adaptQuality(dtMs)
    if (status !== "paused") start()
  }

  function start() {
    if (!raf && !disposed && size.width && size.height) {
      last = 0
      raf = requestAnimationFrame(frame)
    }
  }

  const onContextLost = (e) => {
    e.preventDefault()
    if (status === "playing") api.pause()
  }
  const onContextRestored = () => start()
  canvas.addEventListener("webglcontextlost", onContextLost)
  canvas.addEventListener("webglcontextrestored", onContextRestored)

  const demoOptions = () => ({ doubles: true, level: "pro", seed: (Math.random() * 1e9) | 0 })

  // ---------- public API ----------

  const api = {
    newMatch(opts) {
      startMatch(opts, false)
    },
    pause() {
      if (status !== "playing") return
      keys.clear()
      charge = null
      updateMove()
      if (match) match.paused = true
      setStatus("paused")
    },
    resume() {
      if (status !== "paused") return
      if (match) match.paused = false
      setStatus("playing")
      container.focus({ preventScroll: true })
      start()
    },
    // the on-screen joystick: x right, y toward the net, each -1..1
    setStick(x, y) {
      stick = { x, y }
      updateMove()
    },
    // on-screen shot buttons
    shot(kind, power) {
      return doSwing(kind, power)
    },
    setSettings(patch) {
      settings = { ...settings, ...patch }
      audio.setEnabled(settings.sound)
      if (match) match.assist = settings.assist
    },
    get status() {
      return status
    },
    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      resizeObserver.disconnect()
      container.removeEventListener("keydown", onKeyDown)
      container.removeEventListener("keyup", onKeyUp)
      container.removeEventListener("pointerdown", onPointerDown)
      container.removeEventListener("pointermove", onPointerMove)
      container.removeEventListener("pointerup", onPointerUp)
      container.removeEventListener("pointercancel", onPointerUp)
      container.removeEventListener("contextmenu", onContextMenu)
      container.removeEventListener("focusout", onBlur)
      document.removeEventListener("visibilitychange", onVisibility)
      canvas.removeEventListener("webglcontextlost", onContextLost)
      canvas.removeEventListener("webglcontextrestored", onContextRestored)
      audio.dispose()
      scene.traverse((o) => {
        o.geometry?.dispose()
        if (o.material) [].concat(o.material).forEach((m) => m.dispose())
      })
      Object.values(markMat).forEach((m) => m.dispose())
      Object.values(tex).forEach((t) => t.dispose())
      renderer.dispose()
      renderer.forceContextLoss() // give the GPU context back now, not whenever GC runs
      if (window.__pickleball?.api === api) delete window.__pickleball
    },
  }

  // the demo match behind the title screen
  startMatch(demoOptions(), true)

  // test hook (dev server only): the match, autoplay for your player, rally setups, stats
  if (import.meta.env.DEV) {
    window.__pickleball = {
      api,
      renderer,
      perf,
      log: devLog,
      get match() {
        return match
      },
      get pixelRatio() {
        return pixelRatio
      },
      autoplay(on) {
        if (match) match.autoplay = on
      },
      scenario(kind) {
        if (!match) return
        match.assist = false
        scenario(match, kind)
        match.events.length = 0
      },
      fast(seconds) {
        // run the simulation ahead without drawing (tests)
        const n = Math.round(seconds / STEP)
        for (let i = 0; i < n && status === "playing"; i++) {
          step(match, STEP)
          if (match.events.length) handleEvents()
        }
      },
    }
  }

  return api
}
