// Tetherball's 3D picture (three.js), in the style of a 1997 console / early Direct3D game:
// rendered at a low resolution (a couple of hundred pixels tall) and blown up by whole pixels,
// no anti-aliasing, flat-shaded low-poly shapes, small pixel-art textures with nearest
// filtering, vertices snapped to the pixel grid (the slight PS1 "wobble"), every colour
// quantized to a 15-bit-style palette with 4x4 Bayer dithering (so the sky's gradient bands and
// dithers), screen-door transparency for shadows, fog, and billboard sprites for the trees and
// the playground. Why 3D at all: the game is the rope winding round the pole, which needs depth.
//
//   const view = createScene(canvas, { seat })   seat: which player the camera stands behind
//   view.resize(lowW, lowH)                      the LOW resolution (utils/retro fitPixels)
//   view.draw(match-like { ball, players, phase, server }, dt)
//   view.dispose()

import * as THREE from "three"
import { BALL_R, POLE_H, POLE_R, PITCH, azimuth, freeLength, tieHeight } from "./physics.js"
import { releaseGpu } from "../../../utils/webglLoss"
import { REACH, inReach } from "./match.js"
import { TEXTURES } from "./pixels.js"

const SHIRTS = [0xd02020, 0x2050d0]
const SKY_TOP = new THREE.Color(0x1c4cb8)
const SKY_HORIZON = new THREE.Color(0xb8dcfc)

// ---- the retro shader patch, shared by every material ----
const BAYER = "const float BAYER4[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);\nfloat bayer4(vec2 f) { int x = int(mod(f.x, 4.0)); int y = int(mod(f.y, 4.0)); return (BAYER4[x + y * 4] + 0.5) / 16.0; }\n"
export const retroUniforms = () => ({ uSnap: { value: new THREE.Vector2(320, 240) }, uLevels: { value: 24 } })
// door: screen-door transparency at the material's opacity (no blending, like the old consoles)
export const retroize = (mat, U, { door = false, snap = true } = {}) => {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSnap = U.uSnap
    sh.uniforms.uLevels = U.uLevels
    if (snap) {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform vec2 uSnap;").replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n{ vec4 p = gl_Position; if (p.w > 0.0) { vec2 s = uSnap * 0.5; p.xy = floor(p.xy / p.w * s + 0.5) / s * p.w; gl_Position = p; } }",
      )
    }
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\nuniform float uLevels;\n${BAYER}`)
    if (door) sh.fragmentShader = sh.fragmentShader.replace("#include <opaque_fragment>", "#include <opaque_fragment>\nif (gl_FragColor.a < bayer4(gl_FragCoord.xy)) discard;\ngl_FragColor.a = 1.0;")
    // the last thing a fragment does: quantize every channel with an ordered dither
    sh.fragmentShader = sh.fragmentShader.replace(/}\s*$/, "{ float d = bayer4(gl_FragCoord.xy) - 0.5; gl_FragColor.rgb = clamp(floor(gl_FragColor.rgb * uLevels + 0.5 + d) / uLevels, 0.0, 1.0); }\n}")
  }
  mat.customProgramCacheKey = () => `retro${door ? "d" : ""}${snap ? "s" : ""}`
  // (a door material stays "transparent" so three.js keeps its alpha; the shader then either
  // discards a pixel or draws it solid)
  if (door) mat.depthWrite = false
  return mat
}

const pixelTexture = (name, repeat = 1) => {
  const t = TEXTURES[name]
  const tex = new THREE.DataTexture(t.rgba, t.w, t.h, THREE.RGBAFormat)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  if (repeat !== 1) {
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeat, repeat)
  }
  tex.needsUpdate = true
  return tex
}

// ---- a low-poly kid: boxes, a pixel face, arms and legs on pivots ----
const makeFigure = (color, U, tex) => {
  const g = new THREE.Group()
  const lam = (opts) => retroize(new THREE.MeshLambertMaterial({ flatShading: true, ...opts }), U)
  const shirt = lam({ color })
  const pants = lam({ color: 0x303848 })
  const skin = lam({ map: tex.skin })
  const shoes = lam({ color: 0x1c1c20 })
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.56, 0.26), shirt)
  torso.position.y = 1.2
  g.add(torso)
  // the head: the face texture on its front (+z, toward the pole), hair on top and back
  const hair = lam({ map: tex.hair })
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), [skin, skin, hair, skin, lam({ map: tex.face }), hair])
  head.position.y = 1.66
  g.add(head)
  const legs = []
  for (const side of [-1, 1]) {
    const hip = new THREE.Group()
    hip.position.set(side * 0.11, 0.9, 0)
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.78, 0.18), pants)
    leg.position.y = -0.39
    hip.add(leg)
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.26), shoes)
    shoe.position.set(0, -0.84, 0.04)
    hip.add(shoe)
    g.add(hip)
    legs.push(hip)
  }
  const arms = []
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.set(side * 0.29, 1.44, 0)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.52, 0.13), shirt)
    arm.position.y = -0.26
    pivot.add(arm)
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.12), skin)
    hand.position.y = -0.58
    pivot.add(hand)
    g.add(pivot)
    arms.push(pivot)
  }
  // the reach ring on the ground (screen-door): bright when the ball can be hit
  const ringMat = retroize(new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.25, transparent: true }), U, { door: true, snap: false })
  const ring = new THREE.Mesh(new THREE.RingGeometry(REACH - 0.07, REACH, 16), ringMat)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.02
  ring.renderOrder = -1
  g.add(ring)
  return { g, arms, legs, ring, body: torso }
}

const billboard = (tex, w, h, x, y, z) => {
  const mat = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5, fog: true })
  const s = new THREE.Sprite(mat)
  s.scale.set(w, h, 1)
  s.position.set(x, y, z)
  return s
}

export const createScene = (canvas, { seat = 0 } = {}) => {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" })
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const U = retroUniforms()
  const scene = new THREE.Scene()
  scene.background = SKY_HORIZON.clone()
  scene.fog = new THREE.Fog(SKY_HORIZON.getHex(), 16, 46)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 90)
  const tex = { skin: pixelTexture("skin"), hair: pixelTexture("hair"), face: pixelTexture("face") }

  scene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a3a, 1.7))
  const sun = new THREE.DirectionalLight(0xffffff, 1.7)
  sun.position.set(4, 9, 5)
  scene.add(sun)

  // the sky: a dome with a vertex-coloured gradient (dithered into bands by the shader)
  const domeGeo = new THREE.SphereGeometry(70, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)
  const cols = []
  const pos = domeGeo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, pos.getY(i) / 45))
    const c = SKY_HORIZON.clone().lerp(SKY_TOP, Math.pow(t, 0.7))
    cols.push(c.r, c.g, c.b)
  }
  domeGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3))
  const dome = new THREE.Mesh(domeGeo, retroize(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }), U, { snap: false }))
  scene.add(dome)
  // clouds, the school, the playground (pixel-art billboards)
  const cloudTex = pixelTexture("cloud")
  for (const [a, r, y] of [[0.4, 40, 14], [1.9, 44, 17], [3.3, 38, 12], [4.4, 42, 16], [5.6, 40, 13]]) scene.add(billboard(cloudTex, 9, 3.4, Math.cos(a) * r, y, Math.sin(a) * r))
  const school = billboard(pixelTexture("school"), 18, 9, 3, 4.4, -28)
  scene.add(school)
  scene.add(billboard(pixelTexture("school"), 18, 9, -4, 4.4, 30))
  scene.add(billboard(pixelTexture("slide"), 4.2, 3.2, -8, 1.6, 7))
  scene.add(billboard(pixelTexture("swings"), 4.6, 3.4, 9, 1.7, 9))
  scene.add(billboard(pixelTexture("slide"), 4.2, 3.2, 9, 1.6, -8))
  scene.add(billboard(pixelTexture("swings"), 4.6, 3.4, -9, 1.7, -10))
  const treeTex = pixelTexture("tree")
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.3
    const r = 13 + (k % 3) * 4
    scene.add(billboard(treeTex, 3, 4, Math.cos(a) * r, 2, Math.sin(a) * r))
  }

  // the ground: textured grass, an asphalt circle with a painted edge and a line. Flat layers
  // drawn in order without depth (no z-fighting at this precision) and not snapped (big
  // triangles reaching past the camera would tear)
  const lam = (opts) => retroize(new THREE.MeshLambertMaterial({ flatShading: true, ...opts }), U)
  const layer = (mesh, order) => {
    mesh.rotation.x = -Math.PI / 2
    mesh.renderOrder = order
    mesh.material.depthWrite = false
    scene.add(mesh)
    return mesh
  }
  const groundMat = (opts) => retroize(new THREE.MeshLambertMaterial({ flatShading: true, ...opts }), U, { snap: false })
  layer(new THREE.Mesh(new THREE.CircleGeometry(48, 16), groundMat({ map: pixelTexture("grass", 48) })), -4)
  layer(new THREE.Mesh(new THREE.CircleGeometry(3.4, 20), groundMat({ map: pixelTexture("asphalt", 3) })), -3)
  const paint = () => retroize(new THREE.MeshBasicMaterial({ color: 0xf4f4f4 }), U, { snap: false })
  layer(new THREE.Mesh(new THREE.RingGeometry(3.24, 3.38, 20), paint()), -2)
  layer(new THREE.Mesh(new THREE.PlaneGeometry(6.6, 0.09), paint()), -2)

  // the pole: a six-sided post with a knob and a concrete foot
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(POLE_R, POLE_R, POLE_H, 6), lam({ color: 0xc8ccd0 }))
  pole.position.y = POLE_H / 2
  scene.add(pole)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(POLE_R * 1.5, 6, 4), lam({ color: 0xe04020 }))
  cap.position.y = POLE_H
  scene.add(cap)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.14, 8), lam({ color: 0x707070 }))
  base.position.y = 0.07
  scene.add(base)

  // the ball (a low-poly sphere with panels), its screen-door shadow, the rope (a 1-pixel line)
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 8, 6), lam({ map: pixelTexture("ball") }))
  scene.add(ball)
  const shadowMat = retroize(new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0.5, transparent: true }), U, { door: true, snap: false })
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.3, 8), shadowMat)
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.015
  shadow.renderOrder = -1
  scene.add(shadow)
  const MAX_PTS = 160
  const ropeArr = new Float32Array(MAX_PTS * 3)
  const ropeGeo = new THREE.BufferGeometry()
  ropeGeo.setAttribute("position", new THREE.BufferAttribute(ropeArr, 3))
  const rope = new THREE.Line(ropeGeo, retroize(new THREE.LineBasicMaterial({ color: 0xf4ecd4 }), U))
  rope.frustumCulled = false
  scene.add(rope)

  const figures = [makeFigure(SHIRTS[0], U, tex), makeFigure(SHIRTS[1], U, tex)]
  figures.forEach((f) => scene.add(f.g))
  // player shadows (screen-door blobs)
  const blobs = figures.map(() => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.32, 8), shadowMat)
    m.rotation.x = -Math.PI / 2
    m.position.y = 0.014
    m.renderOrder = -1
    scene.add(m)
    return m
  })

  let width = 160
  let height = 240
  let lost = false
  const onLost = (e) => {
    e.preventDefault()
    lost = true
    releaseGpu(scene)
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
    camera.position.set(0.6 * side, portrait ? 3.6 : 2.9, (portrait ? 7.4 : 6.6) * side)
    camera.lookAt(0, portrait ? 0.8 : 1.5, 0)
    camera.updateProjectionMatrix()
  }

  // the rope's path: a helix down the pole for the wrapped part, then straight to the ball
  const ropePoints = (b) => {
    let n = 0
    const put = (x, y, z) => {
      if (n >= MAX_PTS) return
      ropeArr[n * 3] = x
      ropeArr[n * 3 + 1] = y
      ropeArr[n * 3 + 2] = z
      n++
    }
    const W = Math.abs(b.theta)
    const sign = Math.sign(b.theta) || 1
    const az = azimuth(b)
    const r = POLE_R + 0.012
    const steps = Math.min(MAX_PTS - 12, Math.max(2, Math.ceil(W / 0.35)))
    for (let k = 0; k <= steps; k++) {
      const s = (k / steps) * W
      const a = az - sign * (W - s)
      put(Math.cos(a) * r, POLE_H - (s / (2 * Math.PI)) * PITCH, Math.sin(a) * r)
    }
    const ty = tieHeight(b)
    const h = Math.hypot(b.x, b.z) || 1
    const ex = (b.x / h) * POLE_R
    const ez = (b.z / h) * POLE_R
    const d = Math.hypot(b.x - ex, b.y - ty, b.z - ez)
    const slack = Math.max(0, freeLength(b) - d)
    for (let k = 1; k <= 8; k++) {
      const t = k / 8
      put(ex + (b.x - ex) * t, ty + (b.y - ty) * t - Math.sin(Math.PI * t) * slack * 0.5, ez + (b.z - ez) * t)
    }
    ropeGeo.attributes.position.needsUpdate = true
    ropeGeo.setDrawRange(0, n)
  }

  const draw = (m, dt = 1 / 60, { now = performance.now() } = {}) => {
    if (lost || !m?.ball) return
    const b = m.ball
    ball.position.set(b.x, b.y, b.z)
    ball.rotation.y += (dt || 0) * 6
    shadow.position.set(b.x, 0.015, b.z)
    const sc = Math.max(0.5, 1.4 - b.y * 0.25)
    shadow.scale.set(sc, sc, sc)
    ropePoints(b)

    m.players.forEach((p, i) => {
      const f = figures[i]
      f.g.position.set(p.x, 0, p.z)
      blobs[i].position.set(p.x, 0.014, p.z)
      // face the pole
      f.g.rotation.y = Math.atan2(-p.x, -p.z)
      // the swing: the arm on the side the ball goes comes round
      const t = p.swing ? p.swing.t : m.t - p.lastHit
      const swingT = p.swing ? Math.min(1, p.swing.t / 0.12) : t >= 0 && t < 0.35 ? 1 - t / 0.35 : 0
      const hitArm = i === 0 ? 0 : 1
      f.arms[hitArm].rotation.x = -swingT * 2.2
      f.arms[hitArm].rotation.z = (hitArm ? -1 : 1) * swingT * 0.6
      f.arms[1 - hitArm].rotation.x = Math.sin(now / 300 + i) * 0.08
      const close = inReach(m, p)
      f.ring.material.opacity = close ? 0.7 : 0.2
      f.ring.material.color.setHex(close ? 0xffff40 : 0xffffff)
      const run = Math.hypot(p.vx || 0, p.vz || 0)
      f.legs[0].rotation.x = Math.sin(now / 90) * Math.min(0.6, run * 0.15)
      f.legs[1].rotation.x = -f.legs[0].rotation.x
    })
    renderer.render(scene, camera)
  }

  return {
    renderer,
    draw,
    // the low resolution the game draws at (the canvas is blown up by CSS, whole pixels each)
    resize: (w, h) => {
      width = Math.max(1, Math.round(w))
      height = Math.max(1, Math.round(h))
      renderer.setSize(width, height, false)
      U.uSnap.value.set(width, height)
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
