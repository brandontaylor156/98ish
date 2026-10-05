// My Park: far-away people, cheap (three.js). Everyone further than the closest few is drawn
// as a simple instanced figure in their own colors: torso, hips, legs, arms, head, hair and
// a paddle, seven draw calls for the whole crowd. Legs and arms swing with their pace, they
// sit, and a swing lifts the paddle arm. Up close the real athletes (athlete.js) take over.

import * as THREE from "three"

const MAX = 64
const LEG = 0.86
const ARM = 0.6

export const createMannequins = (parent) => {
  const disposables = []
  const keep = (x) => {
    disposables.push(x)
    return x
  }
  const mat = keep(new THREE.MeshLambertMaterial({ color: 0xffffff }))
  const make = (geo, count) => {
    const m = new THREE.InstancedMesh(keep(geo), mat, count)
    m.count = 0
    m.frustumCulled = false
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    m.setColorAt(0, new THREE.Color(1, 1, 1))
    parent.add(m)
    return m
  }
  // parts, each from its joint
  const torso = make(new THREE.CylinderGeometry(0.17, 0.14, 0.55, 7).translate(0, 0.275, 0), MAX)
  const hips = make(new THREE.CylinderGeometry(0.15, 0.15, 0.2, 7).translate(0, -0.05, 0), MAX)
  const leg = make(new THREE.CylinderGeometry(0.075, 0.05, LEG, 5).translate(0, -LEG / 2, 0), MAX * 2)
  const arm = make(new THREE.CylinderGeometry(0.05, 0.04, ARM, 5).translate(0, -ARM / 2, 0), MAX * 2)
  const head = make(new THREE.SphereGeometry(0.11, 8, 6), MAX)
  const hair = make(new THREE.SphereGeometry(0.118, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), MAX)
  const paddle = make(new THREE.BoxGeometry(0.18, 0.26, 0.02).translate(0, -0.13, 0), MAX)
  const parts = [torso, hips, leg, arm, head, hair, paddle]

  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const qa = new THREE.Quaternion()
  const e = new THREE.Euler()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3(1, 1, 1)
  const endV = new THREE.Vector3()
  const colors = new Map() // look -> parsed colors
  const colorsOf = (look) => {
    let c = colors.get(look)
    if (!c) {
      c = { skin: new THREE.Color(look?.skin || "#d39a6a"), shirt: new THREE.Color(look?.shirt || "#2f6fd6"), bottom: new THREE.Color(look?.bottomColor || "#1d3557"), hair: new THREE.Color(look?.hair === "bald" ? look?.skin || "#d39a6a" : look?.hairColor || "#2b1b0e"), paddle: new THREE.Color(look?.paddle || "#ffd23f"), height: look?.height || 1 }
      colors.set(look, c)
    }
    return c
  }

  let n = 0
  // a person this frame: { x, z, yaw, speed, phase (stride clock, radians), seat (y of a
  // seat or null), swing (0..1 the paddle arm up), look }
  const add = (o) => {
    if (n >= MAX) return
    const c = colorsOf(o.look)
    const h = c.height
    const seated = o.seat !== null && o.seat !== undefined
    const hipY = (seated ? o.seat + 0.08 : 0.92) * (seated ? 1 : h)
    const bob = seated ? 0 : Math.abs(Math.sin(o.phase || 0)) * Math.min(0.05, (o.speed || 0) * 0.012)
    q.setFromEuler(e.set(0, o.yaw, 0))
    const fx = Math.sin(o.yaw)
    const fz = Math.cos(o.yaw)
    const rx = -Math.cos(o.yaw)
    const rz = Math.sin(o.yaw)
    const base = (x, y, z) => p.set(o.x + x, y, o.z + z)
    // hips and torso (leaning into a run)
    const lean = seated ? 0 : Math.min(0.25, (o.speed || 0) * 0.05)
    qa.setFromEuler(e.set(lean, o.yaw, 0, "YXZ"))
    m4.compose(base(0, hipY + bob, 0), q, s.set(h, h, h))
    hips.setMatrixAt(n, m4)
    hips.setColorAt(n, c.bottom)
    m4.compose(base(0, hipY + bob, 0), qa, s.set(h, h, h))
    torso.setMatrixAt(n, m4)
    torso.setColorAt(n, c.shirt)
    const top = hipY + bob + 0.55 * h * Math.cos(lean)
    const ahead = 0.55 * h * Math.sin(lean)
    m4.compose(base(fx * ahead, top + 0.15 * h, fz * ahead), q, s.set(h, h, h))
    head.setMatrixAt(n, m4)
    head.setColorAt(n, c.skin)
    hair.setMatrixAt(n, m4)
    hair.setColorAt(n, c.hair)
    // legs: swing from the hips (sitting: forward and down)
    const swing = seated ? 0 : Math.sin(o.phase || 0) * Math.min(0.75, (o.speed || 0) * 0.22)
    for (let k = 0; k < 2; k++) {
      const side = k ? 1 : -1
      const a = seated ? -1.35 : side * swing
      qa.setFromEuler(e.set(a, o.yaw, 0, "YXZ"))
      m4.compose(base(rx * side * 0.09, hipY + bob, rz * side * 0.09), qa, s.set(h, seated ? 0.62 * h : h, h))
      leg.setMatrixAt(n * 2 + k, m4)
      leg.setColorAt(n * 2 + k, k && seated ? c.bottom : c.skin)
    }
    // arms: against the legs; the paddle arm (right) lifts in a swing
    for (let k = 0; k < 2; k++) {
      const side = k ? 1 : -1
      let a = -side * swing * 0.8
      let out = 0.12
      if (k === 1 && o.swing > 0) {
        a = -1.1 * o.swing
        out = 0.4 * o.swing
      }
      if (seated) a = -0.5
      qa.setFromEuler(e.set(a, o.yaw, side * out, "YXZ"))
      m4.compose(base(fx * ahead + rx * side * 0.2 * h, top - 0.02, fz * ahead + rz * side * 0.2 * h), qa, s.set(h, h, h))
      arm.setMatrixAt(n * 2 + k, m4)
      arm.setColorAt(n * 2 + k, c.skin)
      if (k === 1) {
        // the paddle at the end of the arm
        const end = endV.set(0, -ARM * h, 0).applyQuaternion(qa)
        m4.compose(base(fx * ahead + rx * 0.2 * h + end.x, top - 0.02 + end.y, fz * ahead + rz * 0.2 * h + end.z), qa, s.set(1, 1, 1))
        paddle.setMatrixAt(n, m4)
        paddle.setColorAt(n, c.paddle)
      }
    }
    n++
  }
  const begin = () => {
    n = 0
  }
  const end = () => {
    for (const m of parts) {
      m.count = m === leg || m === arm ? n * 2 : n
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
  }
  return {
    begin,
    add,
    end,
    get count() {
      return n
    },
    dispose() {
      for (const m of parts) {
        parent.remove(m)
        m.dispose?.()
      }
      disposables.forEach((d) => d.dispose?.())
    },
  }
}
