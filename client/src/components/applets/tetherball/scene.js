// Tetherball's 3D picture (three.js, loaded with the game). Why 3D rather than a 2.5D canvas:
// the whole game is the rope winding round the pole, which only reads properly with depth
// (the helix climbing down the pole, the ball swinging out toward you and away), and the scene
// is tiny (a pole, a rope, a ball, two simple figures, a ground disc: a few thousand
// triangles), so it costs less than one Pickleball venue. Antialiasing on, the pixel ratio
// capped at 1.5 (with AA that's sharper than 2 without, and cheaper), dynamic resolution
// below that, the frame clock from utils/frameClock.js (the caller passes real dt).
//
//   const view = createScene(canvas, { seat })   seat: which player the camera stands behind
//   view.draw(match-like { ball, players, phase, server }, dt)
//   view.resize(w, h); view.dispose()

import * as THREE from "three"
import { BALL_R, POLE_H, POLE_R, PITCH, azimuth, freeLength, tieHeight } from "./physics.js"
import { createResolution } from "../../../utils/dynamicResolution"
import { releaseGpu } from "../../../utils/webglLoss"
import { REACH, inReach } from "./match.js"

const SHIRTS = [0xd02020, 0x2050d0]

const makeFigure = (color) => {
  const g = new THREE.Group()
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b890 })
  const shirt = new THREE.MeshLambertMaterial({ color })
  const pants = new THREE.MeshLambertMaterial({ color: 0x303848 })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 4, 10), shirt)
  body.position.y = 1.15
  g.add(body)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), skin)
  head.position.y = 1.72
  g.add(head)
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x3a2412 }))
  hair.position.y = 1.74
  g.add(hair)
  const legs = []
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.6, 4, 8), pants)
    leg.position.set(side * 0.1, 0.42, 0)
    g.add(leg)
    legs.push(leg)
  }
  // arms hang from shoulder pivots so a swing turns them
  const arms = []
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.set(side * 0.27, 1.45, 0)
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.5, 4, 8), shirt)
    arm.position.y = -0.3
    pivot.add(arm)
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), skin)
    hand.position.y = -0.62
    pivot.add(hand)
    g.add(pivot)
    arms.push(pivot)
  }
  // the reach ring on the ground: glows when the ball can be hit
  const ring = new THREE.Mesh(new THREE.RingGeometry(REACH - 0.06, REACH, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }))
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.02
  g.add(ring)
  return { g, arms, legs, ring, body }
}

export const createScene = (canvas, { seat = 0 } = {}) => {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" })
  const maxRatio = Math.min(1.5, window.devicePixelRatio || 1)
  const res = createResolution({ max: maxRatio, min: 1 })
  renderer.setPixelRatio(res.ratio)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x9ad4ff)
  scene.fog = new THREE.Fog(0x9ad4ff, 18, 40)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x6a8a4a, 1.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(4, 9, 5)
  scene.add(sun)

  // the ground: grass, an asphalt circle with a line between the halves
  const grass = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshLambertMaterial({ color: 0x5aa040 }))
  grass.rotation.x = -Math.PI / 2
  scene.add(grass)
  const court = new THREE.Mesh(new THREE.CircleGeometry(3.4, 48), new THREE.MeshLambertMaterial({ color: 0x8a8a90 }))
  court.rotation.x = -Math.PI / 2
  court.position.y = 0.005
  scene.add(court)
  const paint = new THREE.MeshBasicMaterial({ color: 0xf4f4f4 })
  const edge = new THREE.Mesh(new THREE.RingGeometry(3.25, 3.35, 64), paint)
  edge.rotation.x = -Math.PI / 2
  edge.position.y = 0.01
  scene.add(edge)
  const line = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 0.08), paint)
  line.rotation.x = -Math.PI / 2
  line.position.y = 0.011
  scene.add(line)
  // a few trees round the playground
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5030 })
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3a8030 })
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.3
    const r = 11 + (k % 3) * 3
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.6, 8), trunkMat)
    trunk.position.set(Math.cos(a) * r, 0.8, Math.sin(a) * r)
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), leafMat)
    leaves.position.set(trunk.position.x, 2.2, trunk.position.z)
    scene.add(trunk, leaves)
  }

  // the pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(POLE_R, POLE_R, POLE_H, 16), new THREE.MeshLambertMaterial({ color: 0xd0d4d8 }))
  pole.position.y = POLE_H / 2
  scene.add(pole)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(POLE_R * 1.3, 12, 8), new THREE.MeshLambertMaterial({ color: 0xb0b4b8 }))
  cap.position.y = POLE_H
  scene.add(cap)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.12, 20), new THREE.MeshLambertMaterial({ color: 0x606060 }))
  base.position.y = 0.06
  scene.add(base)

  // the ball, its shadow, the rope
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), new THREE.MeshLambertMaterial({ color: 0xffd400 }))
  const seam = new THREE.Mesh(new THREE.TorusGeometry(BALL_R * 1.001, 0.006, 6, 32), new THREE.MeshBasicMaterial({ color: 0x8a6a00 }))
  ball.add(seam)
  scene.add(ball)
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.2, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }))
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.015
  scene.add(shadow)
  const ropeMat = new THREE.MeshLambertMaterial({ color: 0xf0ead8 })
  let rope = null

  const figures = [makeFigure(SHIRTS[0]), makeFigure(SHIRTS[1])]
  figures.forEach((f) => scene.add(f.g))

  let width = 1
  let height = 1
  let lost = false
  const onLost = (e) => {
    e.preventDefault()
    lost = true
    releaseGpu(scene)
    rope = null
  }
  const onRestored = () => (lost = false)
  canvas.addEventListener("webglcontextlost", onLost)
  canvas.addEventListener("webglcontextrestored", onRestored)

  // the camera stands behind `seat`'s half, a little higher on a tall screen
  const placeCamera = () => {
    const portrait = height > width
    camera.fov = portrait ? 66 : 48
    camera.aspect = width / height
    const side = seat === 0 ? 1 : -1
    // (an upright phone looks a little down, so the court fills the screen rather than the sky)
    camera.position.set(0.6 * side, portrait ? 3.6 : 2.9, (portrait ? 7.4 : 6.6) * side)
    camera.lookAt(0, portrait ? 0.8 : 1.5, 0)
    camera.updateProjectionMatrix()
  }

  // the rope's path: a helix down the pole for the wrapped part, then straight to the ball
  const ropePoints = (b) => {
    const pts = []
    const W = Math.abs(b.theta)
    const sign = Math.sign(b.theta) || 1
    const az = azimuth(b)
    const r = POLE_R + 0.012
    const n = Math.max(2, Math.ceil(W / 0.3))
    for (let k = 0; k <= n; k++) {
      const s = (k / n) * W
      const a = az - sign * (W - s)
      pts.push(new THREE.Vector3(Math.cos(a) * r, POLE_H - (s / (2 * Math.PI)) * PITCH, Math.sin(a) * r))
    }
    const ty = tieHeight(b)
    const h = Math.hypot(b.x, b.z) || 1
    const ex = (b.x / h) * POLE_R
    const ez = (b.z / h) * POLE_R
    // straight (or sagging when slack) from the pole to the ball
    const d = Math.hypot(b.x - ex, b.y - ty, b.z - ez)
    const slack = Math.max(0, freeLength(b) - d)
    for (let k = 1; k <= 8; k++) {
      const t = k / 8
      pts.push(new THREE.Vector3(ex + (b.x - ex) * t, ty + (b.y - ty) * t - Math.sin(Math.PI * t) * slack * 0.5, ez + (b.z - ez) * t))
    }
    return pts
  }

  const draw = (m, dt = 1 / 60, { workMs = 0, now = performance.now() } = {}) => {
    if (lost || !m?.ball) return
    const b = m.ball
    ball.position.set(b.x, b.y, b.z)
    ball.rotation.y += (dt || 0) * 6
    shadow.position.set(b.x, 0.015, b.z)
    const sc = Math.max(0.5, 1.4 - b.y * 0.25)
    shadow.scale.set(sc, sc, sc)
    if (rope) {
      rope.geometry.dispose()
      scene.remove(rope)
    }
    rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ropePoints(b)), 96, 0.012, 5, false), ropeMat)
    scene.add(rope)

    m.players.forEach((p, i) => {
      const f = figures[i]
      f.g.position.set(p.x, 0, p.z)
      // face the pole
      f.g.rotation.y = Math.atan2(-p.x, -p.z)
      // the swing: the arm on the side the ball goes comes round
      const t = p.swing ? p.swing.t : m.t - p.lastHit
      const swingT = p.swing ? Math.min(1, p.swing.t / 0.12) : t >= 0 && t < 0.35 ? 1 - t / 0.35 : 0
      const hitArm = i === 0 ? 0 : 1
      f.arms[hitArm].rotation.x = -swingT * 2.2
      f.arms[hitArm].rotation.z = (hitArm ? -1 : 1) * swingT * 0.6
      f.arms[1 - hitArm].rotation.x = Math.sin(now / 300 + i) * 0.08
      // a little hop when the ball is high and close
      const close = inReach(m, p)
      f.ring.material.opacity = close ? 0.55 : 0.12
      f.ring.material.color.setHex(close ? 0xffff60 : 0xffffff)
      const run = Math.hypot(p.vx || 0, p.vz || 0)
      f.legs[0].rotation.x = Math.sin(now / 90) * Math.min(0.6, run * 0.15)
      f.legs[1].rotation.x = -f.legs[0].rotation.x
    })

    if (res.frame((dt || 1 / 60) * 1000, workMs)) {
      renderer.setPixelRatio(res.ratio)
      renderer.setSize(width, height, false)
    }
    renderer.render(scene, camera)
  }

  return {
    renderer,
    draw,
    resize: (w, h) => {
      width = Math.max(1, w)
      height = Math.max(1, h)
      renderer.setSize(width, height, false)
      placeCamera()
    },
    setSeat: (s) => {
      seat = s
      placeCamera()
    },
    dispose: () => {
      canvas.removeEventListener("webglcontextlost", onLost)
      canvas.removeEventListener("webglcontextrestored", onRestored)
      releaseGpu(scene)
      renderer.dispose()
    },
  }
}
