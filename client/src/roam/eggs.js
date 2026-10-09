// Roam: the hidden finds (Easter eggs) at real places (towns/<town>.eggs.js). Game items only:
// one of Floppy's lost disks glowing over the ground, someone with a line, a secret viewpoint,
// a couple's find that's only there when two of you stand by it, and a hidden car. What you've
// found is kept per person on this device (host.store). Pure helpers first (Node-tested), then
// the drawing.

import * as THREE from "three"

export const REACH = { disk: 2.8, npc: 3.6, view: 4.5, couple: 3.5, car: 0 }
export const HINT_R = 70

// the eggs in town metres -> [{ ...egg, x, z }]
export const eggSpots = (town, frame) => (town.eggs || []).map((e) => ({ ...e, ...frame.toXZ(e.lat, e.lon) }))

// the egg you can take now (close enough, not found yet, there) -> egg | null
export const nearestEgg = (list, found, x, z, { together = () => false } = {}) => {
  let best = null
  let bd = Infinity
  for (const e of list) {
    if (found[e.id] || e.kind === "car") continue
    if (e.kind === "couple" && !together(e)) continue
    const d = Math.hypot(e.x - x, e.z - z)
    if (d <= REACH[e.kind] && d < bd) {
      bd = d
      best = e
    }
  }
  return best
}
export const HINTS = { disk: "Something's glowing nearby...", npc: "Someone around here has something to say.", view: "There's a view worth finding up here.", couple: "This place feels like it's for two." }

const glowTexture = () => {
  const c = document.createElement("canvas")
  c.width = c.height = 64
  const g = c.getContext("2d")
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, "rgba(255,255,255,1)")
  grad.addColorStop(0.25, "rgba(255,250,200,0.75)")
  grad.addColorStop(1, "rgba(255,240,160,0)")
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}
const textSprite = (text) => {
  const c = document.createElement("canvas")
  const g = c.getContext("2d")
  const font = "bold 28px Tahoma, Verdana, sans-serif"
  g.font = font
  const w = Math.ceil(g.measureText(text).width) + 28
  c.width = w
  c.height = 44
  g.font = font
  g.fillStyle = "rgba(255,255,225,0.95)"
  g.strokeStyle = "#000"
  g.lineWidth = 2
  g.fillRect(1, 1, w - 2, 42)
  g.strokeRect(1, 1, w - 2, 42)
  g.fillStyle = "#000"
  g.textBaseline = "middle"
  g.fillText(text, 14, 23)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }))
  s.scale.set((w / 44) * 0.26, 0.26, 1)
  s.renderOrder = 10
  return s
}

// a floppy disk (original: a plain 3.5" shape in 98ish blue)
const diskMesh = () => {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.05), new THREE.MeshLambertMaterial({ color: 0x1f3c88, emissive: 0x0a1640 }))
  const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.058), new THREE.MeshLambertMaterial({ color: 0xc3c8cf, emissive: 0x303236 }))
  shutter.position.set(0.03, 0.2, 0)
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.26, 0.056), new THREE.MeshLambertMaterial({ color: 0xf4f1e4, emissive: 0x3a3830 }))
  label.position.set(0, -0.14, 0)
  g.add(body, shutter, label)
  return g
}
const heartMesh = () => {
  const s = new THREE.Shape()
  s.moveTo(0, -0.5)
  s.bezierCurveTo(-0.6, -0.05, -0.55, 0.45, 0, 0.22)
  s.bezierCurveTo(0.55, 0.45, 0.6, -0.05, 0, -0.5)
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false, curveSegments: 8 })
  geo.translate(0, 0, -0.06)
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xff4f8b, emissive: 0x7a1030 }))
}

export const createEggs = ({ town, frame, scene, host = {}, groundAt = () => 0, onFound = () => {} }) => {
  const list = eggSpots(town, frame)
  const storeKey = `roam.found.${town.id}`
  let found = {}
  try {
    found = host.store?.get(storeKey) || {}
  } catch {
    found = {}
  }
  const save = () => {
    try {
      host.store?.set(storeKey, found)
    } catch {
      // (private mode: the finds last this visit)
    }
  }
  const glowTex = typeof document !== "undefined" ? glowTexture() : null
  const shown = new Map() // id -> { group, parts, npc }
  let together = () => false
  const make = (e) => {
    const group = new THREE.Group()
    const y = groundAt(e.x, e.z) ?? 0
    group.position.set(e.x, y, e.z)
    const item = { group, spin: null, glow: null, npc: null, label: null, y }
    if (e.kind === "disk" || e.kind === "couple") {
      const m = e.kind === "disk" ? diskMesh() : heartMesh()
      m.position.y = 1.1
      group.add(m)
      item.spin = m
    } else if (e.kind === "view") {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.07, 6, 32), new THREE.MeshBasicMaterial({ color: 0x5fe7ff, transparent: true, opacity: 0.8 }))
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.1
      group.add(ring)
      item.spin = ring
    } else if (e.kind === "npc" && host.figure) {
      item.npc = host.figure(host.npcLook ? host.npcLook(e.id) : {})
      if (item.npc) scene.add(item.npc.group)
    }
    if (glowTex && e.kind !== "npc") {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: e.kind === "couple" ? 0xff8fb6 : e.kind === "view" ? 0x8ff3ff : 0xfff1a8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
      sp.scale.set(2.4, 2.4, 1)
      sp.position.y = e.kind === "view" ? 0.6 : 1.1
      group.add(sp)
      item.glow = sp
    }
    if (typeof document !== "undefined" && e.kind === "npc") {
      item.label = textSprite(e.name)
      item.label.position.y = 2.25
      group.add(item.label)
    }
    scene.add(group)
    return item
  }
  const drop = (id) => {
    const it = shown.get(id)
    if (!it) return
    it.group.removeFromParent()
    it.group.traverse((o) => {
      o.geometry?.dispose?.()
      if (o.material) {
        if (o.material.map && o.material.map !== glowTex) o.material.map.dispose()
        o.material.dispose()
      }
    })
    it.npc?.dispose()
    shown.delete(id)
  }
  let t = 0
  return {
    list: () => list.map((e) => ({ id: e.id, name: e.name, kind: e.kind, place: e.place, found: found[e.id] || 0, text: found[e.id] ? e.text : null })),
    get: (id) => list.find((e) => e.id === id) || null,
    get foundCount() {
      return list.filter((e) => found[e.id]).length
    },
    get total() {
      return list.length
    },
    isFound: (id) => !!found[id],
    setTogether(fn) {
      together = fn
    },
    // the hidden cars (parked like any other, found by getting in)
    cars: () => list.filter((e) => e.kind === "car").map((e) => ({ id: `egg:${e.id}`, model: "turbo", color: 0x0f8f8a, x: e.x, z: e.z, yaw: 0, egg: e.id })),
    nearest: (x, z) => nearestEgg(list, found, x, z, { together }),
    hint(x, z) {
      let best = null
      let bd = HINT_R
      for (const e of list) {
        if (found[e.id] || e.kind === "car" || (e.kind === "couple" && !together(e))) continue
        const d = Math.hypot(e.x - x, e.z - z)
        if (d < bd) {
          bd = d
          best = e
        }
      }
      return best ? HINTS[best.kind] : null
    },
    find(id, { together: both = false } = {}) {
      const e = list.find((q) => q.id === id)
      if (!e || found[id]) return false
      if (e.kind === "couple" && !both) return false
      found[id] = Date.now()
      save()
      onFound({ id: e.id, name: e.name, kind: e.kind, text: e.text, place: e.place, count: list.filter((q) => found[q.id]).length, total: list.length })
      return true
    },
    // draw the ones within 160 m; spin, bob and face you
    step(dt, at, clock, camera) {
      t += dt
      for (const e of list) {
        if (e.kind === "car") continue
        const d = Math.hypot(e.x - at.x, e.z - at.z)
        const want = d < 160 && (e.kind !== "couple" || together(e)) && !(found[e.id] && e.kind !== "npc" && e.kind !== "view")
        if (want && !shown.has(e.id)) shown.set(e.id, make(e))
        else if (!want && shown.has(e.id)) drop(e.id)
      }
      for (const [id, it] of shown) {
        const e = list.find((q) => q.id === id)
        if (it.spin) {
          if (e.kind === "view") it.spin.rotation.z = t * 0.6
          else {
            it.spin.rotation.y = t * 1.6
            it.spin.position.y = 1.1 + Math.sin(t * 2.2) * 0.12
          }
        }
        if (it.glow) it.glow.material.opacity = 0.55 + 0.25 * Math.sin(t * 3 + e.x)
        if (it.npc) {
          const yaw = Math.atan2(at.x - e.x, at.z - e.z)
          it.npc.update({ x: e.x, y: it.y, z: e.z, yaw, vx: 0, vz: 0, speed: 0 }, dt)
        }
        if (it.label) it.label.visible = Math.hypot(e.x - at.x, e.z - at.z) < 25
      }
      void clock
      void camera
    },
    dispose() {
      for (const id of [...shown.keys()]) drop(id)
      glowTex?.dispose()
    },
  }
}
