// Pickleball 98, dev only (loaded by the engine's test hook, never in a build): a still
// lineup of figures in one animation state, from a chosen camera, for look tests. Each
// figure runs anim.js for a scripted moment (a backswing, the instant of contact, a lunge, a
// celebration...) and is drawn once; a ball sits at the contact point so you can see the
// paddle meet it. Returns how far each paddle face is from its contact point and where the
// feet are, for checks.

import * as THREE from "three"
import { createAnim, setMood, splitStep, updateAnim } from "./anim.js"
import { hash01 } from "./between.js"
import { bodyCapsules, paddleDepth, skipFor } from "./paddlebody.js"

// (measure: the drawn paddle against the drawn body, every frame: paddlebody.js)
const caps = []
const paddleBodyFrame = (pb, t, pose) => {
  if (!pb) return null
  bodyCapsules(pb.joints, { kind: pb.kind, scale: pb.scale, out: caps })
  const parts = {}
  const r = paddleDepth(pb.paddle, caps, { skip: skipFor({ two: pb.two, cup: pb.cup }), parts })
  return { t: Math.round(t * 1000) / 1000, depth: r.depth, part: r.part, what: r.what, parts, stroke: pose.info?.stroke, between: pose.info?.between, axis: pb.paddle.axis, normal: pb.paddle.normal, face: pb.paddle.face }
}

let lineup = [] // { fig, ball }
// (tests) the figures on show, to measure them
export const studioLineup = () => lineup

// numbers to compare with the pro spec (docs/pickleball-movement.md): stance width (ankle to
// ankle, m), knee flexion (degrees from straight), pelvis height, the trunk's forward lean
// (degrees), the paddle face's height and how far in front of the chest it is, the elbow in
// front of the torso, the head's height
const ang3 = (a, b, c) => {
  const u = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
  const v = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z }
  const d = (u.x * v.x + u.y * v.y + u.z * v.z) / (Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z) || 1)
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI
}
export const poseMetrics = (pose) => {
  const f = { x: Math.sin(pose.yaw), z: Math.cos(pose.yaw) }
  const fwd = (q) => (q.x - pose.pelvis.x) * f.x + (q.z - pose.pelvis.z) * f.z
  const r2 = (v) => Math.round(v * 100) / 100
  return {
    stance: r2(Math.hypot(pose.ankleL.x - pose.ankleR.x, pose.ankleL.z - pose.ankleR.z)),
    kneeL: Math.round(180 - ang3(pose.hipL, pose.kneeL, pose.ankleL)),
    kneeR: Math.round(180 - ang3(pose.hipR, pose.kneeR, pose.ankleR)),
    pelvisY: r2(pose.pelvis.y),
    trunk: Math.round((Math.acos(Math.max(-1, Math.min(1, pose.spine.y))) * 180) / Math.PI),
    faceY: r2(pose.paddle.face.y),
    faceFwd: r2(fwd(pose.paddle.face) - fwd(pose.neck)),
    elbowFwd: r2(fwd(pose.elbowP) - fwd(pose.paddleShoulder)),
    headY: r2(pose.head.y),
  }
}

export const STATES = ["tap", "net-tap", "twirl", "wipe", "receive", "walkback", "jog", "sprintstop", "kitchen-shuffle", "backpedal2", "lob-turn", "ready", "split", "run", "shuffle", "walk", "sprint", "backpedal", "stop", "turn", "lunge", "backswing", "drive", "drive-follow", "backhand", "backhand-follow", "dink", "volley", "overhead", "serve", "serve-follow", "celebrate", "celebrate2", "celebrate3", "frustrated", "frustrated2", "frustrated3", "idle", "shuffle-ready", "run-hit", "dink-bh", "volley-bh", "reach-bh", "lob", "ready-net", "kitchen-adjust", "crossover", "transition", "backhand-two", "dink-wide", "hands-battle", "ready-kitchen", "ready-mid", "ready-base", "split-move", "overhead-lob", "drive-low"]

// Movement tests for the footwork (motion matching vs the procedural gait): a player moved
// by the match's own rule (accelerating at most 12 m/s^2 toward the velocity they want, or
// easing into a goal), segment by segment: { t (s), want: [vx, vz] (the figure's right is -x)
// or goal: [dx, dz] from the start, speed, between, atNet }
export const MOVES = {
  // between points: a relaxed walk back to position, then standing
  walkback: [{ t: 0.4, want: [0, 0], between: true }, { t: 3.2, goal: [-1.4, -3.2], speed: 1.5, between: true }, { t: 1.2, want: [0, 0], between: true }],
  // a jog forward (3 m/s) and a stop
  jog: [{ t: 0.4, want: [0, 0] }, { t: 1.8, want: [0, 3.0] }, { t: 1.2, want: [0, 0] }],
  // a sprint to the side (4.5 m/s) and a hard stop
  sprintstop: [{ t: 0.4, want: [0, 0] }, { t: 1.1, want: [-4.5, 0.6] }, { t: 1.3, want: [0, 0] }],
  // shuffles along the kitchen line, facing the net
  "kitchen-shuffle": [{ t: 0.4, want: [0, 0], atNet: true }, { t: 0.7, want: [-2.2, 0], atNet: true }, { t: 0.4, want: [0, 0], atNet: true }, { t: 0.7, want: [2.2, 0], atNet: true }, { t: 0.6, want: [0, 0], atNet: true }],
  // backpedal from the kitchen (2.6 m/s)
  backpedal2: [{ t: 0.4, want: [0, 0], atNet: true }, { t: 1.2, want: [0, -2.6] }, { t: 0.8, want: [0, 0] }],
  // a lob over the head: turn and run back (4.5 m/s), stop
  "lob-turn": [{ t: 0.4, want: [0, 0], atNet: true }, { t: 1.5, want: [-0.8, -4.5] }, { t: 0.9, want: [0, 0] }],
}
export const MOVE_STATES = Object.keys(MOVES)
const moveScript = (name, x, z, base) => {
  const segs = MOVES[name]
  const dt = 1 / 120
  const frames = []
  const g = { x, z, vx: 0, vz: 0 }
  for (const seg of segs) {
    const n = Math.round(seg.t / dt)
    for (let k = 0; k < n; k++) {
      let wx = 0
      let wz = 0
      if (seg.want) [wx, wz] = seg.want
      if (seg.goal) {
        const dx = x + seg.goal[0] - g.x
        const dz = z + seg.goal[1] - g.z
        const d = Math.hypot(dx, dz)
        if (d > 0.03) {
          const s = Math.min(seg.speed || 4, Math.sqrt(2 * 9 * d))
          wx = (dx / d) * s
          wz = (dz / d) * s
        }
      }
      const ex = wx - g.vx
      const ez = wz - g.vz
      const e = Math.hypot(ex, ez)
      if (e > 12 * dt) {
        g.vx += (ex / e) * 12 * dt
        g.vz += (ez / e) * 12 * dt
      } else {
        g.vx = wx
        g.vz = wz
      }
      g.x += g.vx * dt
      g.z += g.vz * dt
      frames.push({ x: g.x, z: g.z, vx: g.vx, vz: g.vz, want: { x: wx, z: wz }, goal: seg.goal ? { x: x + seg.goal[0], z: z + seg.goal[1] } : null, between: !!seg.between, atNet: !!seg.atNet })
    }
  }
  const T = frames.length * dt
  return {
    T,
    at: (t) => {
      const f = frames[Math.min(frames.length - 1, Math.max(0, Math.round(t / dt) - 1))]
      return base(t, { ...f, ball: { x: f.x, y: 1, z: f.z + 6 } })
    },
  }
}

// a moment for a figure at (x, z) facing +z: { T, at(t) -> situation, events, contact }
// hand: +1 right-handed, -1 left-handed (a "forehand" state is on the paddle side either way);
// twoHand: a two-handed backhand
// (tests: a state's length in seconds, for filmstrips)
export const stateLength = (state) => script(state, 0, -4.6).T
// (tests: a state's script, to run its poses in Node)
export const studioScript = (...a) => script(...a)
const script = (state, x, z, { hand = 1, twoHand = false } = {}) => {
  const base = (t, extra = {}) => ({ x, z, vx: 0, vz: 0, facing: 0, ball: { x, y: 1, z: z + 6 }, holding: false, swing: null, prep: null, charging: false, between: false, atNet: false, hand, twoHand, ...extra })
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
  // dx: to the paddle side (facing +z, the figure's right is -x)
  const C = (dx, y, dz) => ({ x: x - dx * hand, y, z: z + dz })
  if (MOVES[state]) return moveScript(state, x, z, base)
  // between points (between.js): a point count whose fidget is the one wanted, and when
  const fidget = (kind) => {
    for (let n = 0; n < 200; n++) {
      const pick = hash01("you", n)
      if ((kind === "twirl" && pick < 0.45) || (kind === "wipe" && pick >= 0.45 && pick < 0.8)) return { point: n, at: 0.4 + hash01("you", n + 99) * 1.2 }
    }
    return { point: 0, at: 0.5 }
  }
  switch (state) {
    case "tap":
      // partners tapping paddles after a point (two figures: each other's partner)
      return { T: 1.0, at: (t) => base(t, { between: true, phase: "dead", phaseT: 0.3 + t, point: 1, id: "you", mate: { x: -x || 0.9, z, id: "mate" } }) }
    case "net-tap":
      // after the game, at the net, with the player across
      return { T: 1.2, at: (t) => base(t, { between: true, phase: "over", phaseT: 0.6 + t, point: 9, id: "you", across: { x, z: z + 1.45, id: "opp" } }) }
    case "twirl":
    case "wipe": {
      const f = fidget(state)
      return { T: f.at + 0.9, at: (t) => base(t, { between: true, phase: "intro", phaseT: t, point: f.point, id: "you", mate: { x: x + 2.5, z } }) }
    }
    case "receive":
      return { T: 1.2, at: (t) => base(t, { phase: "serve", receiving: true, id: "you", ball: { x: x + 1, y: 1, z: z + 12 } }) }
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
    // a low groundstroke from the baseline (a third-shot drive or drop off a low return: the
    // game's groundstrokes from the back are met ~0.5 m up)
    case "drive-low":
      return stroke("drive", C(0.66, 0.52, 0.45))
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
    case "ready-net":
      // at the kitchen line, the ball on the other side
      return { T: 1.4, at: (t) => base(t, { atNet: true, z: z + 0, ball: { x: x + 0.4, y: 0.9, z: z + 4.5 } }) }
    case "kitchen-adjust": {
      // small adjustment steps along the kitchen line: 0.5 m one way, a pause, back
      const px = (t) => x - 0.5 * Math.sin(Math.min(1, t / 0.9) * Math.PI)
      const vx = (t) => -0.5 * Math.cos(Math.min(1, t / 0.9) * Math.PI) * (Math.PI / 0.9) * (t < 0.9 ? 1 : 0)
      return { T: 1.0, at: (t) => base(t, { atNet: true, x: px(t), vx: vx(t), ball: { x: x - 0.8, y: 0.9, z: z + 4 } }) }
    }
    case "crossover": {
      // a wide ball at the kitchen: a crossover step and a run of 2.4 m to the paddle side,
      // then the stop and the hit (contact at t = 0.95)
      const c = C(0.55, 0.55, 0.45)
      const T0 = 0.95
      const dist = 2.4
      const px = (t) => x - hand * dist * Math.min(1, t / (T0 - 0.1)) ** 1.4 + hand * dist
      const vx = (t) => (t < T0 - 0.1 ? -hand * dist * 1.4 * (t / (T0 - 0.1)) ** 0.4 / (T0 - 0.1) : 0)
      return {
        T: T0 + 1e-4,
        contact: c,
        at: (t) => {
          if (t < T0) return base(t, { atNet: true, x: px(t), vx: vx(t), goal: { x, z }, prep: t > 0.3 ? { ttc: T0 - t, x: c.x, y: c.y, z: c.z, kind: "dink", hand: "fh", forward: true, volley: false } : null, ball: { ...c } })
          return base(t, { atNet: true, x, swing: { t: t - T0, kind: "dink", hand: "fh", x: c.x, y: c.y, z: c.z }, ball: { ...c } })
        },
      }
    }
    case "transition": {
      // after a third-shot drop: forward from the baseline (2.4 m/s), a split step as the other
      // side hits (t = 0.75), then a low reset out in front (contact at t = 1.35)
      const c = C(0.35, 0.42, 0.5)
      const zz = (t) => z - 2.4 * Math.max(0, 0.75 - t)
      return {
        T: 1.35 + 1e-4,
        contact: c,
        events: [[0.75, (a) => splitStep(a)]],
        at: (t) => {
          const v = t < 0.75 ? 2.4 : 0
          if (t < 1.35) return base(t, { z: zz(t), vz: v, prep: t > 0.8 ? { ttc: 1.35 - t, x: c.x, y: c.y, z: c.z, kind: "reset", hand: "fh", forward: true } : null, ball: t > 0.75 ? { ...c } : { x, y: 1.2, z: z + 6 } })
          return base(t, { swing: { t: t - 1.35, kind: "reset", hand: "fh", x: c.x, y: c.y, z: c.z }, ball: { ...c } })
        },
      }
    }
    // the ready position by where they stand (pro.js READY, PPA footage): the kitchen line,
    // the transition zone, the baseline; the other side's contact (and the split step) at 1.0
    case "ready-kitchen":
    case "ready-mid":
    case "ready-base": {
      const depth = { "ready-kitchen": 2.55, "ready-mid": 4.3, "ready-base": 6.9 }[state]
      return { T: 1.12, events: [[1.0 - 0.13, (a) => splitStep(a)]], at: (t) => base(t, { depth, atNet: depth < 3.4, ball: { x: x + 0.4, y: 1.0, z: z + 5 } }) }
    }
    case "split-move": {
      // moving up through the transition (1.6 m/s) as the other side hits at t = 0.8: the split
      // step keeps the momentum (the match checks it gently: SPLIT_BRAKE)
      const v = (t) => (t < 0.8 ? 1.6 : Math.max(0, 1.6 - 4 * (t - 0.8)))
      const zz = (t) => z - 1.6 * 0.8 + (t < 0.8 ? 1.6 * t : 1.6 * 0.8 + 1.6 * (t - 0.8) - 2 * (t - 0.8) ** 2)
      return { T: 1.2, events: [[0.8 - 0.13, (a) => splitStep(a)]], at: (t) => base(t, { z: zz(t), vz: v(t), depth: 4.6 - (zz(t) - z), ball: { x, y: 1.0, z: z + 6 } }) }
    }
    case "overhead-lob": {
      // a lob over a player at the kitchen line: read at once, sideways, back 1.1 m (the drop
      // step), the jump and the smash at t = 1.3 (contact 2.3 m up, just behind them), the landing
      const T0 = 1.3
      const c = C(0.22, 2.3, 0.02)
      const back = (t) => -1.1 * Math.min(1, Math.max(0, (t - 0.1) / 1.0)) ** 0.8
      const zz = (t) => z + back(t)
      const cz = c.z - 1.1
      const cc = { x: c.x, y: c.y, z: cz }
      return {
        T: T0 + 0.55,
        contact: cc,
        at: (t) => {
          const vz = t > 0.1 && t < 1.1 ? (zz(t + 0.01) - zz(t)) / 0.01 : 0
          const ball = { x: c.x, y: Math.max(c.y, c.y + 4.9 * (T0 - t) * (T0 - t) * 0.4), z: cz + (T0 - t) * 3 }
          if (t < T0 - 0.65) return base(t, { z: zz(t), vz, depth: 2.55 - back(t), atNet: true, high: { ttc: T0 - t, x: cc.x, y: cc.y, z: cc.z, kind: "smash" }, ball })
          if (t < T0) return base(t, { z: zz(t), vz, depth: 2.55 - back(t), atNet: true, prep: { ttc: T0 - t, x: cc.x, y: cc.y, z: cc.z, kind: "smash", hand: "fh", forward: true }, ball })
          return base(t, { z: zz(t), depth: 3.65, swing: { t: t - T0, kind: "smash", hand: "fh", x: cc.x, y: cc.y, z: cc.z }, ball: { ...cc } })
        },
      }
    }
    case "backhand-two":
      return stroke("drive", C(-0.6, 0.85, 0.4), { hand: "bh" })
    case "dink-wide":
      // a low dink far out on the paddle side: the lunge
      return stroke("dink", C(1.15, 0.22, 0.55), { atNet: true })
    case "hands-battle": {
      // two fast balls at the chest at the net: a forehand punch (t = 0.3), then a backhand
      // counter (t = 0.72)
      const c1 = C(0.32, 1.15, 0.5)
      const c2 = C(-0.22, 1.05, 0.5)
      return {
        T: 0.72 + 1e-4,
        contact: c2,
        at: (t) => {
          const atNet = true
          if (t < 0.3) return base(t, { atNet, prep: { ttc: 0.3 - t, x: c1.x, y: c1.y, z: c1.z, kind: "punch", hand: "fh", forward: true, volley: true, id: 1 }, ball: { ...c1 } })
          if (t < 0.42) return base(t, { atNet, swing: { t: t - 0.3, kind: "punch", hand: "fh", x: c1.x, y: c1.y, z: c1.z, id: 1 }, ball: { ...c1 } })
          if (t < 0.72) return base(t, { atNet, swing: { t: t - 0.3, kind: "punch", hand: "fh", x: c1.x, y: c1.y, z: c1.z, id: 1 }, prep: { ttc: 0.72 - t, x: c2.x, y: c2.y, z: c2.z, kind: "counter", hand: "bh", forward: true, volley: true, id: 2 }, ball: { ...c2 } })
          return base(t, { atNet, swing: { t: t - 0.72, kind: "counter", hand: "bh", x: c2.x, y: c2.y, z: c2.z, id: 2 }, ball: { ...c2 } })
        },
      }
    }
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
export const studioShot = (ctx, { looks = [{}], state = "ready", cam = "close", z = -4.6, spacing, eye, at = [0, 1, 0], fov, T, follow = false, mm = true, noPaddle = false, focus = null, measure = false } = {}) => {
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
    if (noPaddle && fig.debug?.paddle) fig.debug.paddle.visible = false
    const sc = script(state, x, z, { hand: look.plays === "left" ? -1 : 1, twoHand: look.backhand === "two" })
    if (T !== undefined) sc.T = T
    const s0 = sc.at(0)
    const anim = createAnim(s0.x, s0.z, 0)
    anim.useMM = mm && !!fig.skinned // (motion matching; mm: false for the old footwork)
    const dt = 1 / 60
    const events = [...(sc.events || [])]
    let pose = null
    const measured = []
    for (let t = 0; t <= sc.T; t += dt) {
      while (events.length && events[0][0] <= t) events.shift()[1](anim)
      pose = updateAnim(anim, sc.at(t), dt)
      fig.apply(pose, dt)
      if (measure && fig.probePaddleBody) measured.push(paddleBodyFrame(fig.probePaddleBody(), t, pose))
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
      metrics: poseMetrics(pose),
      arms: fig.probeArms ? fig.probeArms() : null,
      paddleBody: measure ? measured : null,
      info: pose.info ? { phase: pose.info.phase, stroke: pose.info.stroke, ready: pose.info.ready, between: pose.info.between, footL: pose.footL, footR: pose.footR, yaw: pose.yaw } : null,
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
  if (eye && focus && out[0]?.arms) {
    // (focus: "hand_l" / "hand_r" / "elbow_l"...: the camera looks at that joint from eye's offset)
    const [what, sd] = focus.split("_")
    const a = out[0].arms[sd]
    const p = what === "elbow" ? a.elbowP : what === "shoulder" ? a.shoulder : a.wrist
    camera.position.set(p.x + eye[0], p.y + eye[1], p.z + eye[2])
    camera.lookAt(p.x, p.y, p.z)
    camera.fov = fov || 30
  } else if (eye) {
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
