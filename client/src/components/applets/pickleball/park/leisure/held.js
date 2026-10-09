// My Park leisure: what a player holds to eat or drink (three.js). Made in code from a few
// shapes each (no files): a clear cup with a straw (lemonade, smoothies, iced drinks), a paper
// coffee cup with a sleeve, a can, a bottle, a burger, a carton of fries, two tacos, a wrap in
// foil. It hangs in the paddle's holder in the hand (athlete.js / rig.js: +y along the handle
// from the grip), so the mood that holds it upright (anim.js "carry", "sip") sets the axis up.
//
//   holdFig(fig, itemId | null)   cheap to call every frame; the paddle hides while you hold one

import * as THREE from "three"
import { ITEMS } from "./menu.js"

const mats = new Map()
const mat = (color, opts = {}) => {
  const k = `${color}|${opts.opacity ?? 1}|${opts.emissive ?? ""}`
  if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color, transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1, depthWrite: (opts.opacity ?? 1) >= 1, emissive: opts.emissive || 0x000000 }))
  return mats.get(k)
}
const geos = new Map()
const geo = (k, make) => {
  if (!geos.has(k)) geos.set(k, make())
  return geos.get(k)
}
const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg)
const mesh = (g, m, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(g, m)
  o.position.set(x, y, z)
  return o
}

// each kind: a group about the grip (the hand holds it round its middle)
const MAKERS = {
  cup: (it) => {
    const g = new THREE.Group()
    // a 16 oz clear cup: 9 cm across the top, 13 cm tall; the drink inside; a straw
    g.add(mesh(geo("cupDrink", () => cyl(0.04, 0.03, 0.11)), mat(it.color), 0, 0.005, 0))
    g.add(mesh(geo("cupShell", () => cyl(0.046, 0.034, 0.13, 14)), mat("#e8f4f8", { opacity: 0.35 }), 0, 0.01, 0))
    if (it.lid) g.add(mesh(geo("cupLid", () => new THREE.SphereGeometry(0.046, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), mat("#f2f7f9", { opacity: 0.5 }), 0, 0.075, 0))
    const straw = mesh(geo("straw", () => cyl(0.004, 0.004, 0.2, 6)), mat(it.lid ? "#2a7fd4" : "#f2f2f2"), 0.012, 0.11, 0)
    straw.rotation.z = -0.12
    g.add(straw)
    if (it.color === "#f4e27a") {
      const lemon = mesh(geo("lemon", () => cyl(0.025, 0.025, 0.006, 12)), mat("#f7e04a"), 0.04, 0.07, 0)
      lemon.rotation.x = Math.PI / 2
      g.add(lemon)
    }
    return g
  },
  mug: () => {
    const g = new THREE.Group()
    g.add(mesh(geo("mug", () => cyl(0.042, 0.032, 0.12)), mat("#f4efe6"), 0, 0.01, 0))
    g.add(mesh(geo("sleeve", () => cyl(0.042, 0.037, 0.05)), mat("#9a6a3e"), 0, 0.005, 0))
    g.add(mesh(geo("mugLid", () => cyl(0.044, 0.044, 0.012)), mat("#2b2b2b"), 0, 0.075, 0))
    return g
  },
  can: (it) => {
    const g = new THREE.Group()
    g.add(mesh(geo("can", () => cyl(0.033, 0.033, 0.122, 14)), mat(it.color), 0, 0.01, 0))
    g.add(mesh(geo("canTop", () => cyl(0.03, 0.033, 0.01, 14)), mat("#c9ccd1"), 0, 0.076, 0))
    g.add(mesh(geo("canBand", () => cyl(0.0335, 0.0335, 0.03, 14)), mat("#ffffff"), 0, 0.02, 0))
    return g
  },
  bottle: (it) => {
    const g = new THREE.Group()
    g.add(mesh(geo("bottle", () => cyl(0.032, 0.032, 0.17, 12)), mat(it.color, { opacity: 0.7 }), 0, 0.03, 0))
    g.add(mesh(geo("neck", () => cyl(0.014, 0.03, 0.05, 10)), mat(it.color, { opacity: 0.7 }), 0, 0.14, 0))
    g.add(mesh(geo("cap", () => cyl(0.015, 0.015, 0.018, 10)), mat("#1f5fbf"), 0, 0.172, 0))
    g.add(mesh(geo("label", () => cyl(0.0325, 0.0325, 0.05, 12)), mat("#ffffff"), 0, 0.02, 0))
    return g
  },
  burger: () => {
    const g = new THREE.Group()
    g.add(mesh(geo("bunB", () => cyl(0.055, 0.052, 0.025, 14)), mat("#c98a43"), 0, 0.0, 0))
    g.add(mesh(geo("patty", () => cyl(0.058, 0.058, 0.02, 14)), mat("#5a3420"), 0, 0.022, 0))
    g.add(mesh(geo("lettuce", () => cyl(0.062, 0.062, 0.008, 14)), mat("#5fae3a"), 0, 0.036, 0))
    g.add(mesh(geo("cheese", () => new THREE.BoxGeometry(0.1, 0.005, 0.1)), mat("#f6c430"), 0, 0.042, 0))
    g.add(mesh(geo("bunT", () => new THREE.SphereGeometry(0.056, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2)), mat("#d39a4f"), 0, 0.045, 0))
    return g
  },
  fries: () => {
    const g = new THREE.Group()
    g.add(mesh(geo("carton", () => cyl(0.05, 0.035, 0.09, 4)), mat("#d4282a"), 0, 0.0, 0))
    const stick = geo("fry", () => new THREE.BoxGeometry(0.008, 0.08, 0.008))
    const m = mat("#f2c64a")
    for (let i = 0; i < 9; i++) {
      const f = mesh(stick, m, ((i % 3) - 1) * 0.018, 0.06 + (i % 2) * 0.01, (Math.floor(i / 3) - 1) * 0.016)
      f.rotation.z = ((i * 37) % 11) / 40 - 0.12
      g.add(f)
    }
    return g
  },
  taco: () => {
    const g = new THREE.Group()
    const shell = geo("shell", () => new THREE.CylinderGeometry(0.06, 0.06, 0.045, 14, 1, true, 0, Math.PI))
    for (const dx of [-0.026, 0.026]) {
      const s = mesh(shell, mat("#e8c46a"), dx, 0.02, 0)
      s.rotation.z = Math.PI / 2
      s.material.side = THREE.DoubleSide
      g.add(s)
      g.add(mesh(geo("filling", () => new THREE.BoxGeometry(0.04, 0.02, 0.09)), mat("#7fbf4a"), dx, 0.05, 0))
    }
    return g
  },
  wrap: () => {
    const g = new THREE.Group()
    g.add(mesh(geo("wrap", () => cyl(0.03, 0.03, 0.16, 12)), mat("#e9d6a6"), 0, 0.02, 0))
    g.add(mesh(geo("foil", () => cyl(0.032, 0.032, 0.09, 12)), mat("#c9ccd1", { emissive: 0x202020 }), 0, -0.02, 0))
    return g
  },
}

export const makeHeld = (id) => {
  const it = ITEMS[id]
  if (!it) return null
  const g = (MAKERS[it.held] || MAKERS.cup)(it)
  g.userData.held = id
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = false
  })
  return g
}

// the hand's item: shown in the paddle's holder (the paddle itself hidden by gearFig "none")
export const holdFig = (fig, id = null) => {
  const holder = fig?.debug?.paddle
  if (!holder) return false
  const want = id || null
  if ((holder.userData.held || null) === want) {
    // (acts/gear.js hides the holder's other children when the gear changes: keep it showing)
    if (want) for (const c of holder.children) if (c.userData.held && !c.visible) c.visible = true
    return true
  }
  holder.userData.held = want
  for (const c of [...holder.children]) if (c.userData.held) holder.remove(c)
  if (want) {
    const g = makeHeld(want)
    if (g) holder.add(g)
  }
  return true
}
