// 3D Viewer 98's picture: one three.js renderer in a canvas. Loads a .glb/.gltf, frames it,
// orbits (drag / pinch, or tilt the phone after "Tilt to look"), plays its animations, or, for
// a rigged model with none, a gentle procedural idle (breathing, a slow look-around, bones
// swaying a little). A toy mode spins it slowly with no controls.
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

export const countTriangles = (root) => {
  let n = 0
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return
    const g = o.geometry
    n += (g.index ? g.index.count : g.attributes.position?.count || 0) / 3
  })
  return Math.round(n)
}

export const loadGltf = (bytes) =>
  new Promise((resolve, reject) => {
    const loader = new GLTFLoader()
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    loader.parse(buf, "", resolve, (e) => reject(new Error(`That model couldn't be opened (${e?.message || "bad glTF"}).`)))
  })

export const createViewer = (canvas, { toy = false } = {}) => {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "low-power" })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x008080) // the 98 desktop teal
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200)
  camera.position.set(0, 0.6, 2.4)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6))
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.position.set(2, 4, 3)
  scene.add(sun)
  // a 98-style checker floor, so a model reads as standing somewhere
  const floorTex = (() => {
    const c = document.createElement("canvas")
    c.width = c.height = 64
    const x = c.getContext("2d")
    x.fillStyle = "#c0c0c0"
    x.fillRect(0, 0, 64, 64)
    x.fillStyle = "#a8a8a8"
    x.fillRect(0, 0, 32, 32)
    x.fillRect(32, 32, 32, 32)
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(8, 8)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  })()
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshLambertMaterial({ map: floorTex }))
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  const controls = toy ? null : new OrbitControls(camera, canvas)
  let dragging = false
  if (controls) {
    controls.addEventListener("start", () => (dragging = true))
    controls.addEventListener("end", () => (dragging = false))
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.enablePan = false
  }

  let model = null
  let mixer = null
  let bones = []
  let disposed = false
  let raf = 0
  let tilt = null // { alpha0, beta0 } once "Tilt to look" is on
  const clock = new THREE.Clock()
  const info = { triangles: 0, animations: 0, rigged: false, size: new THREE.Vector3() }

  const resize = () => {
    const w = canvas.clientWidth || 300
    const h = canvas.clientHeight || 200
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null
  ro?.observe(canvas)
  resize()

  const clear = () => {
    if (!model) return
    scene.remove(model)
    model.traverse((o) => {
      o.geometry?.dispose?.()
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
      for (const m of mats) {
        for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap"]) m[k]?.dispose?.()
        m.dispose?.()
      }
    })
    model = null
    mixer = null
    bones = []
  }

  const show = async (bytes) => {
    const gltf = await loadGltf(bytes)
    if (disposed) return info
    clear()
    model = gltf.scene || gltf.scenes?.[0]
    // stand it on the floor, centered, about 1 m tall
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const k = 1 / Math.max(size.x, size.y, size.z, 1e-6)
    model.scale.setScalar(k)
    const box2 = new THREE.Box3().setFromObject(model)
    const c = box2.getCenter(new THREE.Vector3())
    model.position.sub(new THREE.Vector3(c.x, box2.min.y, c.z))
    scene.add(model)
    info.triangles = countTriangles(model)
    info.animations = gltf.animations?.length || 0
    info.size.copy(size)
    model.traverse((o) => {
      if (o.isBone) bones.push({ bone: o, rest: o.quaternion.clone(), depth: depthOf(o), phase: Math.random() * Math.PI * 2 })
    })
    info.rigged = bones.length > 0
    if (info.animations) {
      mixer = new THREE.AnimationMixer(model)
      const idle = gltf.animations.find((a) => /idle|breath|stand/i.test(a.name)) || gltf.animations[0]
      mixer.clipAction(idle).play()
    }
    controls?.target.set(0, 0.45, 0)
    camera.position.set(0, 0.7, 2.2)
    controls?.update()
    return info
  }

  const depthOf = (o) => {
    let d = 0
    for (let p = o.parent; p && p.isBone; p = p.parent) d++
    return d
  }

  const tmpQ = new THREE.Quaternion()
  const tmpE = new THREE.Euler()
  const idleBones = (t) => {
    // (a living sway: the deeper a bone, the smaller and later its motion)
    for (const b of bones) {
      const a = 0.05 / (1 + b.depth * 0.6)
      tmpE.set(Math.sin(t * 1.3 + b.phase) * a, Math.sin(t * 0.7 + b.depth) * a * 0.8, Math.sin(t * 1.1 + b.phase * 0.5) * a * 0.6)
      b.bone.quaternion.copy(b.rest).multiply(tmpQ.setFromEuler(tmpE))
    }
  }

  const loop = () => {
    if (disposed) return
    raf = requestAnimationFrame(loop)
    const dt = Math.min(0.05, clock.getDelta())
    const t = clock.elapsedTime
    if (mixer) mixer.update(dt)
    else if (bones.length) idleBones(t)
    if (model && !mixer) {
      // (with no bones and no clips: a slow look-around; the toy spins)
      if (!bones.length) model.rotation.y = toy ? model.rotation.y + dt * 0.6 : Math.sin(t * 0.4) * 0.25
    } else if (model && toy) model.rotation.y += dt * 0.6
    if (tilt && !dragging) {
      // (the phone's tilt turns the view around the model)
      const yaw = THREE.MathUtils.degToRad(tilt.gamma || 0) * 0.9
      const pitch = THREE.MathUtils.clamp(THREE.MathUtils.degToRad((tilt.beta || 45) - 45) * 0.6, -0.6, 0.8)
      const r = camera.position.distanceTo(controls ? controls.target : new THREE.Vector3(0, 0.45, 0))
      camera.position.set(Math.sin(yaw) * Math.cos(pitch) * r, 0.45 + Math.sin(pitch) * r, Math.cos(yaw) * Math.cos(pitch) * r)
      camera.lookAt(0, 0.45, 0)
    } else controls?.update()
    renderer.render(scene, camera)
  }
  loop()

  const onOrient = (e) => {
    if (tilt) Object.assign(tilt, { beta: e.beta, gamma: e.gamma })
  }
  // "Tilt to look" (iOS asks permission from a tap)
  const enableTilt = async () => {
    const DO = window.DeviceOrientationEvent
    if (!DO) return false
    if (typeof DO.requestPermission === "function") {
      const r = await DO.requestPermission().catch(() => "denied")
      if (r !== "granted") return false
    }
    tilt = { beta: 45, gamma: 0 }
    window.addEventListener("deviceorientation", onOrient)
    return true
  }
  const disableTilt = () => {
    tilt = null
    window.removeEventListener("deviceorientation", onOrient)
  }

  // a PNG of the current view (Share a picture)
  const snapshot = () =>
    new Promise((resolve) => {
      renderer.render(scene, camera)
      canvas.toBlob((b) => resolve(b), "image/png")
    })

  return {
    show,
    info: () => info,
    enableTilt,
    disableTilt,
    snapshot,
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      disableTilt()
      ro?.disconnect()
      controls?.dispose()
      clear()
      floorTex.dispose()
      renderer.dispose()
    },
  }
}
