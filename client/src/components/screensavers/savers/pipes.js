import * as THREE from "three"
import { num, rand } from "./util"

// 3D Pipes: a couple of pipes at a time snake through a 3D grid of cells, one cell per
// step, turning at random and stopping when they're boxed in. When enough of the grid is
// full the screen clears and it starts again from a new angle.
//
// Every piece is an instance of one of three shapes (straight tube, ball, quarter-torus
// elbow), so the whole scene is three draw calls. A tube between two cells stops BEND
// short of each cell center; the joint drawn at the cell fills that gap.

const DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
].map((d) => new THREE.Vector3(...d))
const COLORS = [0xd23c3c, 0x3cb44b, 0x3c64e6, 0xe6c83c, 0xc850c8, 0x32c8c8, 0xe68232, 0xdcdcdc]
const PIPE_R = 0.2
const BALL_R = 0.31
const BEND = 0.34
const UP = new THREE.Vector3(0, 1, 0)

export default function createPipes(canvas, opts, env) {
  const mixed = opts.joints === "mixed"
  const stepsPerSecond = 3 + num(opts.speed, 5, 1, 10) * 3
  const [NX, NY, NZ] = env.preview ? [8, 6, 8] : [13, 10, 13]
  const CELLS = NX * NY * NZ
  const LIVE = env.preview ? 1 : 2 // pipes growing at once

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "default" })
  renderer.setClearColor(0x000000, 1)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 200)
  scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const key = new THREE.DirectionalLight(0xffffff, 2.4)
  key.position.set(4, 7, 9)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0xffffff, 0.7)
  rim.position.set(-6, -2, -4)
  scene.add(rim)

  const world = new THREE.Group()
  scene.add(world)

  const tubeGeo = new THREE.CylinderGeometry(PIPE_R, PIPE_R, 1, 18, 1, true)
  tubeGeo.translate(0, 0.5, 0) // grows from its base
  const ballGeo = new THREE.SphereGeometry(BALL_R, 22, 16)
  const elbowGeo = new THREE.TorusGeometry(BEND, PIPE_R, 14, 12, Math.PI / 2)
  const material = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0x777777, shininess: 70 })

  const instanced = (geo, max) => {
    const mesh = new THREE.InstancedMesh(geo, material, max)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.setColorAt(0, new THREE.Color()) // makes the color buffer
    world.add(mesh)
    return mesh
  }
  const tubes = instanced(tubeGeo, CELLS * 3 + 8)
  const balls = instanced(ballGeo, CELLS + 8)
  const elbows = instanced(elbowGeo, CELLS + 8)

  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  const v3 = new THREE.Vector3()

  const touch = (mesh, i) => {
    mesh.instanceMatrix.addUpdateRange(i * 16, 16)
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.addUpdateRange(i * 3, 3)
    mesh.instanceColor.needsUpdate = true
  }
  const add = (mesh, matrix, color) => {
    if (mesh.count >= mesh.instanceMatrix.count) return -1
    const i = mesh.count++
    mesh.setMatrixAt(i, matrix)
    mesh.setColorAt(i, color)
    touch(mesh, i)
    return i
  }
  const tubeMatrix = (from, dir, length) => {
    q.setFromUnitVectors(UP, dir)
    return m4.compose(from, q, scale.set(1, Math.max(0.0001, length), 1))
  }
  const addTube = (from, dir, length, color) => add(tubes, tubeMatrix(from, dir, length), color)
  const addBall = (at, color, r = 1) => add(balls, m4.compose(at, q.identity(), scale.setScalar(r)), color)
  // quarter torus from (at - d1 * BEND) heading d1 to (at + d2 * BEND) heading d2
  const addElbow = (at, d1, d2, color) => {
    v1.copy(d2).negate()
    v3.crossVectors(d1, d2)
    m4.makeBasis(v1, d1, v3)
    m4.setPosition(v2.copy(at).addScaledVector(d1, -BEND).addScaledVector(d2, BEND))
    return add(elbows, m4, color)
  }

  // ---- the grid ----
  const filled = new Uint8Array(CELLS)
  const index = (x, y, z) => x + NX * (y + NY * z)
  const free = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < NX && y < NY && z < NZ && !filled[index(x, y, z)]
  const center = (c, out) => out.set(c[0] - (NX - 1) / 2, c[1] - (NY - 1) / 2, c[2] - (NZ - 1) / 2)
  let used = 0
  const take = (c) => {
    filled[index(c[0], c[1], c[2])] = 1
    used++
  }

  let pipes = []
  let palette = []
  let hold = 0 // seconds to show a full screen before clearing
  let spin = 0
  let aspect = 1
  const view = new THREE.Vector3() // direction from the grid to the camera

  // farther back on narrow screens so the grid mostly fits across
  const placeCamera = () => {
    const dist = Math.max(NX, NZ) * 1.45 * Math.max(1, (1.2 / aspect) ** 0.7)
    camera.position.copy(view).multiplyScalar(dist)
    camera.lookAt(0, 0, 0)
  }

  const reset = () => {
    filled.fill(0)
    used = 0
    tubes.count = balls.count = elbows.count = 0
    pipes = []
    palette = [...COLORS].sort(() => Math.random() - 0.5)
    // a new view each time
    const yaw = rand(-0.6, 0.6)
    const pitch = rand(0.15, 0.45)
    view.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
    placeCamera()
    world.rotation.set(0, 0, 0)
    spin = rand(-0.05, 0.05)
  }

  const startPipe = () => {
    for (let tries = 0; tries < 40; tries++) {
      const c = [Math.floor(rand(0, NX)), Math.floor(rand(0, NY)), Math.floor(rand(0, NZ))]
      if (!free(...c)) continue
      take(c)
      const color = new THREE.Color(palette[pipes.length % palette.length])
      const pipe = { cell: c, dir: -1, color, grow: -1, progress: 0, from: new THREE.Vector3(), done: false }
      if (!advance(pipe)) pipe.done = true
      pipes.push(pipe)
      return true
    }
    return false
  }

  // picks the next cell, draws the joint at the current one, and starts the next tube
  const advance = (pipe) => {
    const [x, y, z] = pipe.cell
    const options = []
    for (let d = 0; d < 6; d++) {
      const D = DIRS[d]
      if (free(x + D.x, y + D.y, z + D.z)) options.push(d)
    }
    const at = center(pipe.cell, new THREE.Vector3())
    const prev = pipe.dir
    if (!options.length) {
      // boxed in: finish the last stub with a ball
      if (prev >= 0) addTube(v1.copy(at).addScaledVector(DIRS[prev], -BEND), DIRS[prev], BEND, pipe.color)
      addBall(at, pipe.color, prev >= 0 ? 0.85 : 1)
      return false
    }
    const keepStraight = prev >= 0 && options.includes(prev) && Math.random() < 0.6
    const next = keepStraight ? prev : options[Math.floor(Math.random() * options.length)]
    const d2 = DIRS[next]
    if (prev < 0) {
      addBall(at, pipe.color)
      addTube(at, d2, BEND, pipe.color)
    } else if (prev === next) {
      addTube(v1.copy(at).addScaledVector(d2, -BEND), d2, BEND * 2, pipe.color)
    } else if (mixed && Math.random() < 0.6) {
      addElbow(at, DIRS[prev], d2, pipe.color)
    } else {
      const d1 = DIRS[prev]
      addTube(v1.copy(at).addScaledVector(d1, -BEND), d1, BEND, pipe.color)
      addBall(at, pipe.color)
      addTube(at, d2, BEND, pipe.color)
    }
    pipe.dir = next
    pipe.cell = [x + d2.x, y + d2.y, z + d2.z]
    take(pipe.cell)
    pipe.from.copy(at).addScaledVector(d2, BEND)
    pipe.progress = 0
    pipe.grow = addTube(pipe.from, d2, 0, pipe.color)
    return true
  }

  const setGrowth = (pipe) => {
    if (pipe.grow < 0) return
    tubes.setMatrixAt(pipe.grow, tubeMatrix(pipe.from, DIRS[pipe.dir], (1 - BEND * 2) * Math.min(1, pipe.progress)))
    touch(tubes, pipe.grow)
  }

  reset()

  const update = (dt) => {
    world.rotation.y += spin * dt
    if (hold > 0) {
      hold -= dt
      if (hold <= 0) reset()
      return
    }
    let live = pipes.filter((p) => !p.done).length
    while (live < LIVE && used < CELLS * 0.5) {
      if (!startPipe()) break
      live++
    }
    if (!live || used >= CELLS * 0.5) {
      // let the last pipes finish their tubes, then pause on the full screen
      pipes.forEach((p) => {
        if (!p.done) {
          p.progress = 1
          setGrowth(p)
          p.done = true
        }
      })
      hold = 2.5
      return
    }
    for (const pipe of pipes) {
      if (pipe.done) continue
      pipe.progress += dt * stepsPerSecond
      while (!pipe.done && pipe.progress >= 1) {
        const extra = pipe.progress - 1
        pipe.progress = 1
        setGrowth(pipe)
        if (advance(pipe)) pipe.progress = extra
        else pipe.done = true
      }
      if (!pipe.done) setGrowth(pipe)
    }
  }

  return {
    resize(w, h, dpr) {
      renderer.setPixelRatio(Math.min(dpr, 1.5))
      renderer.setSize(w, h, false)
      aspect = w / h
      camera.aspect = aspect
      camera.updateProjectionMatrix()
      placeCamera()
    },
    frame(dt) {
      update(dt)
      renderer.render(scene, camera)
    },
    dispose() {
      world.traverse((o) => o.dispose?.())
      tubeGeo.dispose()
      ballGeo.dispose()
      elbowGeo.dispose()
      material.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
