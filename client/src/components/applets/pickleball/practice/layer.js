// Pickleball 98 practice: what a practice session adds to the court (three.js): the ball
// machine (a boxy machine with a hopper of balls, in place of the feeder's figure), the
// target zones on their court (lit up with the points when a ball lands in one), the
// split-step cue (a ring at your feet as the machine hits) and your home spot.
// The engine draws it through its setLayer hook (engine.js): update(match, dt, figures)
// every frame; the state comes from the session (session.js, match.practice.state).

import * as THREE from "three"

const ZONE_COLOR = { 3: 0xffd23f, 2: 0x37d0e6, 1: 0xffffff }

const textTexture = (text, color = "#ffd23f") => {
  const c = document.createElement("canvas")
  c.width = 128
  c.height = 64
  const g = c.getContext("2d")
  g.font = "bold 46px Arial, sans-serif"
  g.textAlign = "center"
  g.textBaseline = "middle"
  g.lineWidth = 8
  g.strokeStyle = "#0b1224"
  g.strokeText(text, 64, 34)
  g.fillStyle = color
  g.fillText(text, 64, 34)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const buildMachine = () => {
  const g = new THREE.Group()
  const body = new THREE.MeshLambertMaterial({ color: 0x1f6f4a })
  const dark = new THREE.MeshLambertMaterial({ color: 0x24272e })
  const trim = new THREE.MeshLambertMaterial({ color: 0xe8e8e8 })
  const hop = new THREE.MeshLambertMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.45, depthWrite: false })
  const ballM = new THREE.MeshLambertMaterial({ color: 0xd9f03c })
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.7), body)
  box.position.y = 0.42
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 0.74), trim)
  lid.position.y = 0.69
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.2, 0.34, 14, 1, true), hop)
  hopper.position.y = 0.88
  const chute = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.36, 12), dark)
  chute.rotation.x = Math.PI / 2 - 0.25
  chute.position.set(0, 0.62, 0.42)
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.02), dark)
  panel.position.set(0, 0.5, -0.36)
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0x5bff7a }))
  light.position.set(0.1, 0.52, -0.375)
  g.add(box, lid, hopper, chute, panel, light)
  const ballGeo = new THREE.SphereGeometry(0.037, 10, 8)
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Mesh(ballGeo, ballM)
    const a = i * 2.4
    const r = 0.05 + (i % 3) * 0.06
    b.position.set(Math.cos(a) * r, 0.76 + Math.floor(i / 4) * 0.06, Math.sin(a) * r)
    g.add(b)
  }
  const wheelGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.06, 14)
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(wheelGeo, dark)
    w.rotation.z = Math.PI / 2
    w.position.set(sx * 0.34, 0.1, -0.22)
    g.add(w)
  }
  const legGeo = new THREE.BoxGeometry(0.05, 0.18, 0.05)
  for (const sx of [-1, 1]) {
    const l = new THREE.Mesh(legGeo, dark)
    l.position.set(sx * 0.26, 0.09, 0.28)
    g.add(l)
  }
  g.userData.light = light
  return g
}

export const createLayer = () => {
  const group = new THREE.Group()
  group.name = "practice"
  const machine = buildMachine()
  machine.visible = false
  group.add(machine)
  const zoneGroup = new THREE.Group()
  group.add(zoneGroup)
  let zoneMeshes = []
  let zonesKey = null
  // the points that rise from a zone
  const popups = []
  const textures = new Map()
  const textureFor = (text) => {
    if (!textures.has(text)) textures.set(text, textTexture(text))
    return textures.get(text)
  }
  // the split-step ring and the home mark
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({ color: 0x7cf0ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }))
  ring.rotation.x = -Math.PI / 2
  ring.renderOrder = 4
  ring.visible = false
  group.add(ring)
  const home = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }))
  home.rotation.x = -Math.PI / 2
  home.renderOrder = 3
  home.visible = false
  group.add(home)
  let lastFlash = null
  let lastSplit = null
  let ringT = 1

  const clearZones = () => {
    for (const z of zoneMeshes) {
      zoneGroup.remove(z.fill, z.edge)
      z.fill.geometry.dispose()
      z.fill.material.dispose()
      z.edge.geometry.dispose()
      z.edge.material.dispose()
    }
    zoneMeshes = []
  }
  const buildZones = (zones) => {
    clearZones()
    for (const z of zones || []) {
      const w = z.x1 - z.x0
      const d = z.z1 - z.z0
      const color = ZONE_COLOR[z.pts] || 0xffffff
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.26, depthWrite: false }))
      fill.rotation.x = -Math.PI / 2
      fill.position.set((z.x0 + z.x1) / 2, 0.009, (z.z0 + z.z1) / 2)
      fill.renderOrder = 2
      const pts = [
        [z.x0 + 0.04, z.z0 + 0.04],
        [z.x1 - 0.04, z.z0 + 0.04],
        [z.x1 - 0.04, z.z1 - 0.04],
        [z.x0 + 0.04, z.z1 - 0.04],
      ].map(([x, zz]) => new THREE.Vector3(x, 0.012, zz))
      const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }))
      edge.renderOrder = 2
      zoneGroup.add(fill, edge)
      zoneMeshes.push({ id: z.id, fill, edge, lit: 0 })
    }
  }

  const update = (match, dt, figures = []) => {
    const st = match?.practice?.state
    group.visible = !!st
    if (!st) return
    // the machine, in place of the feeder's figure
    const showMachine = !!st.showMachine && !!st.machineAt
    machine.visible = showMachine
    if (showMachine) {
      const f = match.players.find((p) => p.ctrl === "feeder")
      machine.position.set(f ? f.x : st.machineAt.x, 0, f ? f.z : st.machineAt.z)
      machine.rotation.y = 0
      const since = st.splitAt === null ? 9 : match.t - st.splitAt
      machine.userData.light.material.color.setHex(since < 0.25 ? 0xffe066 : match.ball.held ? 0x5bff7a : 0x2a7a3a)
    }
    for (const fg of figures) {
      if (fg.player.ctrl !== "feeder") continue
      fg.fig.group.visible = !showMachine
      fg.blob.visible = !showMachine
    }
    // the target zones
    const key = st.zones ? st.zones.map((z) => z.id).join(",") : ""
    if (key !== zonesKey) {
      zonesKey = key
      buildZones(st.zones)
    }
    if (st.flash && st.flash !== lastFlash) {
      lastFlash = st.flash
      const z = zoneMeshes.find((x) => x.id === st.flash.id)
      if (z) z.lit = 1
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureFor(`+${st.flash.pts}`), transparent: true, depthWrite: false, depthTest: false }))
      sp.scale.set(0.9, 0.45, 1)
      sp.position.set(st.flash.x, 0.4, st.flash.z)
      sp.renderOrder = 6
      group.add(sp)
      popups.push({ sp, t: 0 })
    }
    for (const z of zoneMeshes) {
      z.lit = Math.max(0, z.lit - dt * 1.2)
      z.fill.material.opacity = 0.26 + z.lit * 0.5
      z.edge.material.opacity = 0.9 + z.lit * 0.1
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i]
      p.t += dt
      p.sp.position.y = 0.4 + p.t * 0.9
      p.sp.material.opacity = Math.max(0, 1 - p.t / 1.2)
      if (p.t > 1.2) {
        group.remove(p.sp)
        p.sp.material.dispose()
        popups.splice(i, 1)
      }
    }
    // the split-step cue and your home spot (drills that ask for them)
    const cue = match.practice.spec?.cue === "split"
    const you = match.players.find((p) => p.ctrl === "human" && p.slot === 0)
    if (cue && st.splitAt !== null && st.splitAt !== lastSplit) {
      lastSplit = st.splitAt
      ringT = 0
    }
    ringT += dt
    ring.visible = cue && !!you && ringT < 0.6
    if (ring.visible) {
      const k = ringT / 0.6
      ring.position.set(you.x, 0.015, you.z)
      ring.scale.setScalar(1 + k * 0.8)
      ring.material.opacity = 0.9 * (1 - k)
    }
    home.visible = cue && !!st.home
    if (home.visible) home.position.set(st.home.x, 0.012, st.home.z)
  }

  const dispose = () => {
    clearZones()
    for (const p of popups) p.sp.material.dispose()
    popups.length = 0
    for (const t of textures.values()) t.dispose()
    textures.clear()
    group.traverse((o) => {
      o.geometry?.dispose()
      if (o.material) [].concat(o.material).forEach((mm) => mm.dispose())
    })
  }

  return { group, update, dispose }
}
