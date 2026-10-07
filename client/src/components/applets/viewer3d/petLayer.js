// A 3D Viewer 98 model in My Park ("Place in My Park"): it stands beside you and trots after
// you as you walk (core.js stepPet). It never moves you or anyone else; it isn't solid and
// it isn't shown to other people (it's yours, on this device). With animations it plays
// them (a walk clip while moving if it has one); otherwise it hops a little as it goes.
import * as THREE from "three"
import { PET_HEIGHT, fitScale, stepPet } from "./core.js"
import { fileAt, getPet, readModel } from "./store.js"

export const createPetLayer = (scene, { quality = "medium" } = {}) => {
  const group = new THREE.Group()
  group.name = "pet"
  scene.add(group)
  let model = null
  let mixer = null
  let walk = null
  let idle = null
  let state = null // { x, z, yaw, speed, moving }
  let t = 0
  let disposed = false

  const load = async () => {
    const path = getPet()
    if (!path || quality === "low") return
    const file = await fileAt(path)
    if (!file || disposed) return
    const bytes = await readModel(file)
    const { loadGltf } = await import("./scene.js")
    const gltf = await loadGltf(bytes)
    if (disposed) return
    model = gltf.scene || gltf.scenes?.[0]
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    model.scale.setScalar(fitScale(size, PET_HEIGHT))
    const box2 = new THREE.Box3().setFromObject(model)
    const c = box2.getCenter(new THREE.Vector3())
    model.position.set(-c.x, -box2.min.y, -c.z)
    model.traverse((o) => {
      if (o.isMesh) o.castShadow = true
    })
    group.add(model)
    if (gltf.animations?.length) {
      mixer = new THREE.AnimationMixer(model)
      const find = (re) => gltf.animations.find((a) => re.test(a.name))
      const w = find(/walk|run|trot/i)
      const i = find(/idle|breath|stand/i) || gltf.animations[0]
      walk = w ? mixer.clipAction(w) : null
      idle = mixer.clipAction(i)
      idle.play()
    }
  }
  load().catch((e) => console.warn("[park] pet", e))

  // every frame, after you've moved: you = { x, z, y, yaw }
  const step = (dt, you) => {
    if (!model || !you) return
    t += dt
    if (!state) state = { x: you.x - 0.8, z: you.z - 0.8, yaw: you.yaw || 0, speed: 0, moving: false }
    state = stepPet(state, you, dt)
    const hop = !mixer && state.moving ? Math.abs(Math.sin(t * 9)) * 0.06 * Math.min(1, state.speed / 1.6) : 0
    group.position.set(state.x, (you.y || 0) + hop, state.z)
    group.rotation.y = state.yaw
    if (mixer) {
      if (walk) {
        const moving = state.moving && state.speed > 0.3
        walk.enabled = true
        if (moving && !walk.isRunning()) walk.reset().fadeIn(0.2).play(), idle?.fadeOut(0.2)
        if (!moving && walk.isRunning()) walk.fadeOut(0.25), idle?.reset().fadeIn(0.25).play()
      }
      mixer.update(dt)
    }
  }

  const api = {
    step,
    get active() {
      return !!model
    },
    // (tests: where it is and whether it's moving)
    get state() {
      return state && { ...state }
    },
    dispose() {
      disposed = true
      if (window.__pet === api) delete window.__pet
      scene.remove(group)
      group.traverse((o) => {
        o.geometry?.dispose?.()
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
        for (const m of mats) {
          m.map?.dispose?.()
          m.dispose?.()
        }
      })
    },
  }
  if (import.meta.env?.DEV) window.__pet = api
  return api
}
