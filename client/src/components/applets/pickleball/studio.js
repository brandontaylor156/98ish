// Pickleball 98, dev only (loaded by the engine's test hook, never in a build): a still
// lineup of figures in one animation state, from a chosen camera, for look tests. Each
// figure runs anim.js for a scripted moment (a backswing, the instant of contact, a lunge, a
// celebration...) and is drawn once; a ball sits at the contact point so you can see the
// paddle meet it. Returns how far each paddle face is from its contact point and where the
// feet are, for checks.

import * as THREE from "three"
import { createAnim, setMood, splitStep, updateAnim } from "./anim.js"

let lineup = [] // { fig, ball }

export const STATES = ["ready", "split", "run", "shuffle", "walk", "sprint", "backpedal", "stop", "turn", "lunge", "backswing", "drive", "drive-follow", "backhand", "backhand-follow", "dink", "volley", "overhead", "serve", "serve-follow", "celebrate", "celebrate2", "celebrate3", "frustrated", "frustrated2", "frustrated3", "idle", "shuffle-ready", "run-hit", "dink-bh", "volley-bh", "reach-bh", "lob"]

// a moment for a figure at (x, z) facing +z: { T, at(t) -> situation, events, contact }
const script = (state, x, z) => {
  const base = (t, extra = {}) => ({ x, z, vx: 0, vz: 0, facing: 0, ball: { x, y: 1, z: z + 6 }, holding: false, swing: null, prep: null, charging: false, between: false, atNet: false, hand: 1, ...extra })
  const stroke = (kind, c, { follow = 0, atNet = false, hand = "fh" } = {}) => {
    const T0 = 0.7
    return {
      T: T0 + follow + 1e-4,
      contact: c,
      at: (t) => {
        if (t < T0) return base(t, { atNet, prep: { ttc: T0 - t, x: c.x, y: c.y, z: c.z, kind, hand, forward: true }, ball: { ...c } })
        return base(t, { atNet, swing: { t: t - T0, kind, hand, x: c.x, y: c.y, z: c.z }, ball: { ...c } })
      },
    }
  }
  // dx: to the figure's right (facing +z, its right is -x)
  const C = (dx, y, dz) => ({ x: x - dx, y, z: z + dz })
  switch (state) {
    case "split":
      return { T: 1.12, events: [[1.0, (a) => splitStep(a)]], at: (t) => base(t) }
    case "run":
      return { T: 1.1, at: (t) => base(t, { x: x - 4.6 * (1.1 - t), vx: 4.6 }) }
    case "shuffle":
      return { T: 1.0, at: (t) => base(t, { x: x - 1.8 * (1 - t), vx: 1.8 }) }
    case "walk":
      return { T: 1.2, at: (t) => base(t, { x: x - 1.2 * (1.2 - t), vx: 1.2, between: true }) }
    // (filmstrips: ask for the same state at a series of times with opts.T)
    case "sprint":
      // toward the net from the baseline, speeding up to 4.4 m/s
      return { T: 1.4, at: (t) => base(t, { z: z - 4.4 * Math.max(0, 1.4 - t) + 0.9, vz: 4.4 * Math.min(1, t / 0.35) }) }
    case "backpedal":
      return { T: 1.2, at: (t) => base(t, { z: z + 2.2 * (1.2 - t), vz: -2.2 }) }
    case "stop": {
      // a run to the right that plants and stops at t = 0.9
      const v = (t) => (t < 0.9 ? 3.6 : Math.max(0, 3.6 - (t - 0.9) * 12))
      const pos = (t) => (t < 0.9 ? -3.6 * (0.9 - t) : (3.6 * Math.min(t - 0.9, 0.3) - 6 * Math.min(t - 0.9, 0.3) ** 2))
      return { T: 1.3, at: (t) => base(t, { x: x - pos(t), vx: -v(t), goal: { x: x, z } }) }
    }
    case "turn":
      // standing, the ball moves round: small pivot steps
      return { T: 1.6, at: (t) => base(t, { ball: { x: x - 6 * Math.sin(Math.min(1, t) * 1.2), y: 1, z: z + 6 * Math.cos(Math.min(1, t) * 1.2) }, facing: Math.min(1, t) * 0.9 }) }
    case "lunge": {
      const c = C(1.3, 0.32, 0.5)
      return { T: 0.62, contact: c, at: (t) => base(t, { prep: { ttc: Math.max(0.02, 0.64 - t), x: c.x, y: c.y, z: c.z, kind: "drive", hand: "fh", forward: true }, ball: c }) }
    }
    case "backswing": {
      const c = C(0.62, 0.85, 0.4)
      return { T: 1.0, at: (t) => base(t, { charging: true, prep: { ttc: 0.45, x: c.x, y: c.y, z: c.z, kind: "drive", hand: "fh", forward: false }, ball: { x: c.x, y: c.y, z: c.z + 3 } }) }
    }
    case "drive":
      return stroke("drive", C(0.62, 0.85, 0.4))
    case "drive-follow":
      return stroke("drive", C(0.62, 0.85, 0.4), { follow: 0.2 })
    case "backhand":
      return stroke("drive", C(-0.62, 0.85, 0.4), { hand: "bh" })
    case "backhand-follow":
      return stroke("drive", C(-0.62, 0.85, 0.4), { hand: "bh", follow: 0.2 })
    case "dink":
      return stroke("dink", C(0.42, 0.3, 0.5), { atNet: true })
    case "volley":
      return stroke("punch", C(0.45, 1.12, 0.45), { atNet: true })
    case "overhead":
      return stroke("smash", C(0.25, 2.15, 0.3))
    case "serve":
      return stroke("serve", C(0.3, 0.52, 0.45))
    case "serve-follow":
      return stroke("serve", C(0.3, 0.52, 0.45), { follow: 0.22 })
    case "idle":
      // between points, standing about
      return { T: 1.4, at: (t) => base(t, { between: true }) }
    case "shuffle-ready":
      // a side shuffle with a ball coming (paddle up, square to the net)
      return { T: 1.0, at: (t) => base(t, { x: x - 1.8 * (1 - t), vx: 1.8, ball: { x: x + 1, y: 1.1, z: z + 4 } }) }
    case "run-hit": {
      // a run out to the right, straight into a forehand drive (contact at t = 1.0)
      const c = C(0.7, 0.8, 0.45)
      const T0 = 1.0
      const px = (t) => x + 3.4 * Math.max(0, T0 - 0.08 - t) // (arrives just before contact)
      return {
        T: T0 + 1e-4,
        contact: c,
        at: (t) => {
          const v = t < T0 - 0.08 ? -3.4 : 0
          if (t < T0) return base(t, { x: px(t), vx: v, prep: t > T0 - 0.65 ? { ttc: T0 - t, x: c.x, y: c.y, z: c.z, kind: "drive", hand: "fh", forward: true } : null, ball: { ...c } })
          return base(t, { x: px(t), swing: { t: t - T0, kind: "drive", hand: "fh", x: c.x, y: c.y, z: c.z }, ball: { ...c } })
        },
      }
    }
    case "dink-bh":
      return stroke("dink", C(-0.4, 0.3, 0.5), { atNet: true, hand: "bh" })
    case "volley-bh":
      return stroke("block", C(-0.4, 1.05, 0.45), { atNet: true, hand: "bh" })
    case "reach-bh": {
      const c = C(-1.3, 0.45, 0.5)
      return stroke("drive", c, { hand: "bh" })
    }
    case "lob":
      return stroke("lob", C(0.55, 0.6, 0.4))
    case "celebrate":
    case "celebrate2":
    case "celebrate3":
      return { T: 0.55, events: [[0, (a) => setMood(a, "cheer", { celebrate: 0, celebrate2: 1, celebrate3: 2 }[state])]], at: (t) => base(t, { between: true }) }
    case "frustrated":
    case "frustrated2":
    case "frustrated3":
      return { T: 0.9, events: [[0, (a) => setMood(a, "sulk", { frustrated: 0, frustrated2: 1, frustrated3: 2 }[state])]], at: (t) => base(t, { between: true }) }
    default:
      return { T: 1.4, at: (t) => base(t) }
  }
}

// eye / at: [x, y, dz] a camera of your own (dz from the lineup's z), with fov
export const studioShot = (ctx, { looks = [{}], state = "ready", cam = "close", z = -4.6, spacing, eye, at = [0, 1, 0], fov, T, follow = false } = {}) => {
  const { scene, camera, renderer, size, makeFigure, shadows } = ctx
  for (const f of lineup) {
    scene.remove(f.fig.group, f.ball)
    f.fig.dispose()
    f.ball.geometry.dispose()
  }
  lineup = []
  const n = looks.length
  const gap = spacing ?? (cam === "broadcast" ? 1.9 : 1.35)
  const out = []
  looks.forEach((look, i) => {
    const x = (i - (n - 1) / 2) * gap
    const fig = makeFigure(look, { shadows })
    scene.add(fig.group)
    const sc = script(state, x, z)
    if (T !== undefined) sc.T = T
    const s0 = sc.at(0)
    const anim = createAnim(s0.x, s0.z, 0)
    const dt = 1 / 60
    const events = [...(sc.events || [])]
    let pose = null
    for (let t = 0; t <= sc.T; t += dt) {
      while (events.length && events[0][0] <= t) events.shift()[1](anim)
      pose = updateAnim(anim, sc.at(t), dt)
      fig.apply(pose, dt)
    }
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.037 * 1.5, 16, 12), new THREE.MeshStandardMaterial({ color: "#d8f03a", roughness: 0.6 }))
    ball.visible = !!sc.contact
    if (sc.contact) ball.position.set(sc.contact.x, sc.contact.y, sc.contact.z)
    scene.add(ball)
    lineup.push({ fig, ball })
    const probe = fig.probe?.()
    out.push({
      look: look.name || look.hair,
      faceToContact: sc.contact && probe ? Math.hypot(probe.face.x - sc.contact.x, probe.face.y - sc.contact.y, probe.face.z - sc.contact.z) : null,
      poseToContact: sc.contact ? Math.hypot(pose.paddle.face.x - sc.contact.x, pose.paddle.face.y - sc.contact.y, pose.paddle.face.z - sc.contact.z) : null,
      soles: probe?.soles || null,
      planted: [pose.footL.planted, pose.footR.planted],
      pelvis: { x: pose.pelvis.x, z: pose.pelvis.z },
    })
  })
  // the camera
  const wide = (n - 1) * gap
  const aspect = size.width / size.height
  camera.aspect = aspect
  if (cam === "broadcast") {
    camera.position.set(0, 4.6, z - 7.4 - wide * 0.25)
    camera.lookAt(0, 0.7, z + 1.5)
    camera.fov = 46
  } else if (cam === "side") {
    camera.position.set(-(wide / 2 + 3.6), 1.25, z + 0.6)
    camera.lookAt(0, 0.95, z + 0.3)
    camera.fov = 42
  } else if (cam === "face") {
    camera.position.set(0, 1.62, z + 1.0 + wide * 0.4)
    camera.lookAt(0, 1.55, z)
    camera.fov = 40
  } else {
    // close: in front, a little high
    // (just this side of the net, zoomed to fit the lineup)
    const d = 3.6
    camera.position.set(0, 1.25, z + d)
    camera.lookAt(0, 0.95, z)
    camera.fov = Math.max(2 * Math.atan(1.15 / d), 2 * Math.atan((wide / 2 + 0.75) / aspect / d)) * (180 / Math.PI)
  }
  if (eye) {
    // (follow: the camera rides along with the first figure, for filmstrips)
    const o = follow && out[0]?.pelvis ? { x: out[0].pelvis.x, z: out[0].pelvis.z - z } : { x: 0, z: 0 }
    camera.position.set(o.x + eye[0], eye[1], z + o.z + eye[2])
    camera.lookAt(o.x + at[0], at[1], z + o.z + at[2])
    camera.fov = fov || 40
  }
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
  return out
}
