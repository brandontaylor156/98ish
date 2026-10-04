// Pickleball 98 motion matching: a parsed motion-capture take -> canonical poses (skeleton.js)
// at the database's frame rate, with the root ("simulation bone") extracted, the feet put on
// the ground and foot contacts labeled. Pure JavaScript, used by tools/build-motion.mjs and
// tested in Node.

import { qinv, qmul, qnorm, qrot, qslerp, Q, qaxis } from "./quat.js"
import { worldPose, restPose } from "./bvh.js"
import { ANKLE_Y, B, BALL_Y, BONES, canonicalPose, endOf, fk, NB, restAlign } from "./skeleton.js"

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const len = (a) => Math.hypot(a.x, a.y, a.z)
const unit = (a) => {
  const l = len(a) || 1
  return { x: a.x / l, y: a.y / l, z: a.z / l }
}

// which source joints drive the canonical bones: [joint, child joint (or "end")]
export const MAPS = {
  // 100STYLE (and other BVH with these names)
  style100: {
    pelvis: ["Hips", "Chest"],
    spine_01: ["Chest", "Chest2"],
    spine_02: ["Chest2", "Chest3"],
    spine_03: ["Chest4", "Neck"],
    neck_01: ["Neck", "Head"],
    head: ["Head", "end"],
    clavicle_l: ["LeftCollar", "LeftShoulder"],
    upperarm_l: ["LeftShoulder", "LeftElbow"],
    lowerarm_l: ["LeftElbow", "LeftWrist"],
    hand_l: ["LeftWrist", "end"],
    clavicle_r: ["RightCollar", "RightShoulder"],
    upperarm_r: ["RightShoulder", "RightElbow"],
    lowerarm_r: ["RightElbow", "RightWrist"],
    hand_r: ["RightWrist", "end"],
    thigh_l: ["LeftHip", "LeftKnee"],
    calf_l: ["LeftKnee", "LeftAnkle"],
    foot_l: ["LeftAnkle", "LeftToe"],
    ball_l: ["LeftToe", "end"],
    thigh_r: ["RightHip", "RightKnee"],
    calf_r: ["RightKnee", "RightAnkle"],
    foot_r: ["RightAnkle", "RightToe"],
    ball_r: ["RightToe", "end"],
    hips: ["LeftHip", "RightHip"],
  },
  // CMU ASF/AMC (joints are the bones' start points)
  cmu: {
    pelvis: ["root", "lowerback:end"],
    spine_01: ["lowerback", "upperback"],
    spine_02: ["upperback", "thorax"],
    spine_03: ["thorax", "lowerneck"],
    neck_01: ["lowerneck", "head"],
    head: ["head", "end"],
    clavicle_l: ["lclavicle", "lhumerus"],
    upperarm_l: ["lhumerus", "lradius"],
    lowerarm_l: ["lradius", "lwrist"],
    hand_l: ["lhand", "end"],
    clavicle_r: ["rclavicle", "rhumerus"],
    upperarm_r: ["rhumerus", "rradius"],
    lowerarm_r: ["rradius", "rwrist"],
    hand_r: ["rhand", "end"],
    thigh_l: ["lfemur", "ltibia"],
    calf_l: ["ltibia", "lfoot"],
    foot_l: ["lfoot", "ltoes"],
    ball_l: ["ltoes", "end"],
    thigh_r: ["rfemur", "rtibia"],
    calf_r: ["rtibia", "rfoot"],
    foot_r: ["rfoot", "rtoes"],
    ball_r: ["rtoes", "end"],
    hips: ["lfemur", "rfemur"],
  },
}

// the source skeleton's mapping with rest directions measured from its rest pose
export const buildMap = (skel, names) => {
  const idx = Object.fromEntries(skel.joints.map((j, i) => [j.name, i]))
  const rest = restPose(skel)
  const map = {}
  for (const b of BONES) {
    const [jn, cn] = names[b]
    const j = idx[jn]
    if (j === undefined) throw new Error("no joint " + jn)
    let dir
    if (cn === "end") {
      const e = skel.joints[j].end
      dir = e ? unit(e) : { x: 0, y: 1, z: 0 }
    } else if (cn.endsWith(":end")) dir = unit(skel.joints[idx[cn.slice(0, -4)]].end)
    else dir = unit(sub(rest.wp[idx[cn]], rest.wp[j]))
    if (b === "pelvis") dir = { x: 0, y: 1, z: 0 }
    map[b] = { joint: j, dir }
  }
  const hips = names.hips.map((n) => idx[n])
  // leg length: hip to knee to ankle (both legs averaged)
  const leg = (s) => len(sub(rest.wp[idx[names["calf_" + s][0]]], rest.wp[idx[names["thigh_" + s][0]]])) + len(sub(rest.wp[idx[names["foot_" + s][0]]], rest.wp[idx[names["calf_" + s][0]]]))
  return { map, align: restAlign(map), hips, legLen: (leg("l") + leg("r")) / 2, restQ: skel.joints.map((j) => j.restQ || Q()) }
}

// resample a parsed take to fps (slerp between source frames): [{ D, hips }]
export const sampleTake = (skel, m, { from = 0, to = skel.frames.length - 1, fps = 30 } = {}) => {
  const scale = (0.43 + 0.43) / m.legLen
  const out = []
  const n = Math.floor(((to - from) / skel.fps) * fps)
  for (let k = 0; k <= n; k++) {
    const x = from + (k * skel.fps) / fps
    const f0 = Math.min(to, Math.floor(x))
    const f1 = Math.min(to, f0 + 1)
    const u = x - f0
    const a = skel.frames[f0]
    const b = skel.frames[f1]
    const frame = { root: { x: a.root.x + (b.root.x - a.root.x) * u, y: a.root.y + (b.root.y - a.root.y) * u, z: a.root.z + (b.root.z - a.root.z) * u }, rot: a.rot.map((q, i) => qslerp(q, b.rot[i], u)) }
    const w = worldPose(skel, frame)
    const D = canonicalPose(m.map, m.align, w.wq, m.restQ)
    const h0 = w.wp[m.hips[0]]
    const h1 = w.wp[m.hips[1]]
    out.push({ D, hips: { x: ((h0.x + h1.x) / 2) * scale, y: ((h0.y + h1.y) / 2) * scale, z: ((h0.z + h1.z) / 2) * scale } })
  }
  return out
}

const gauss = (arr, sigma, get, set) => {
  const r = Math.ceil(sigma * 2.5)
  const w = []
  for (let k = -r; k <= r; k++) w.push(Math.exp((-k * k) / (2 * sigma * sigma)))
  const vals = arr.map(get)
  arr.forEach((_, i) => {
    let s = 0
    let ws = 0
    for (let k = -r; k <= r; k++) {
      const j = Math.max(0, Math.min(arr.length - 1, i + k))
      s += vals[j] * w[k + r]
      ws += w[k + r]
    }
    set(arr[i], s / ws)
  })
}

// The root: the hips projected on the court, facing where the hips and chest face (both
// smoothed, so the hips' own sway in a stride doesn't swing the trajectory). Every pose goes
// into the root's space. Returns frames { D (character space), hip (pelvis in root space),
// root: { x, z, yaw } }.
export const extractRoot = (frames, { posSigma = 1.5, yawSigma = 5 } = {}) => {
  const fwdOf = (q) => qrot(q, { x: 0, y: 0, z: 1 })
  const recs = frames.map((f) => {
    const a = fwdOf(f.D[B.pelvis])
    const b = fwdOf(f.D[B.spine_03])
    const yaw = Math.atan2(a.x + b.x, a.z + b.z)
    return { x: f.hips.x, z: f.hips.z, yaw }
  })
  // unwrap the yaw
  for (let i = 1; i < recs.length; i++) {
    let d = recs[i].yaw - recs[i - 1].yaw
    d = Math.atan2(Math.sin(d), Math.cos(d))
    recs[i].yaw = recs[i - 1].yaw + d
  }
  gauss(recs, posSigma, (r) => r.x, (r, v) => (r.x = v))
  gauss(recs, posSigma, (r) => r.z, (r, v) => (r.z = v))
  gauss(recs, yawSigma, (r) => r.yaw, (r, v) => (r.yaw = v))
  return frames.map((f, i) => {
    const r = recs[i]
    const inv = qaxis({ x: 0, y: 1, z: 0 }, -r.yaw)
    const D = f.D.map((q) => qnorm(qmul(inv, q)))
    const hip = qrot(inv, { x: f.hips.x - r.x, y: f.hips.y, z: f.hips.z - r.z })
    return { D, hip, root: { x: r.x, z: r.z, yaw: r.yaw } }
  })
}

// the feet's lowest point over the court (sole: the ankle joint ANKLE_Y up when flat, the
// ball of the foot BALL_Y, the toe tip 0) for one character-space pose
export const footClearance = (D, hip) => {
  const P = fk(D, hip)
  const out = []
  for (const s of ["l", "r"]) {
    const a = P[B["foot_" + s]]
    const b = P[B["ball_" + s]]
    const t = endOf(D, P, B["ball_" + s])
    out.push(Math.min(a.y - ANKLE_Y, b.y - BALL_Y, t.y))
  }
  return out
}

// Put a take's feet on the court: the hips go down (or up) by the low percentile of the feet's
// clearance (a take's floor is wherever its markers put it)
// (a running low percentile over about two seconds: some capture floors aren't level)
export const groundTake = (frames, fps = 30) => {
  const lows = frames.map((f) => Math.min(...footClearance(f.D, f.hip)))
  const r = fps
  const floors = lows.map((_, i) => {
    const win = lows.slice(Math.max(0, i - r), Math.min(lows.length, i + r + 1)).sort((a, b) => a - b)
    return win[Math.floor(win.length * 0.1)]
  })
  // (smoothed, so the hips never jump)
  const sm = floors.map((_, i) => {
    let s = 0
    let n = 0
    for (let k = -10; k <= 10; k++) {
      const j = Math.max(0, Math.min(floors.length - 1, i + k))
      s += floors[j]
      n++
    }
    return s / n
  })
  frames.forEach((f, i) => (f.hip = { ...f.hip, y: f.hip.y - sm[i] }))
  return sm.reduce((a, b) => a + b, 0) / sm.length
}

// Foot contacts: a foot is down when it's near the court and barely moving (world speed of
// its lowest point). Returns per frame [left, right] booleans, cleaned of one-frame blips.
export const labelContacts = (frames, fps = 30, { height = 0.045, speed = 0.7 } = {}) => {
  const world = (f, p) => {
    const q = qaxis({ x: 0, y: 1, z: 0 }, f.root.yaw)
    const w = qrot(q, p)
    return { x: w.x + f.root.x, y: w.y, z: w.z + f.root.z }
  }
  const lowPts = frames.map((f) => {
    const P = fk(f.D, f.hip)
    return ["l", "r"].map((s) => {
      const a = P[B["foot_" + s]]
      const b = P[B["ball_" + s]]
      const pt = a.y - ANKLE_Y < b.y - BALL_Y ? { p: a, h: a.y - ANKLE_Y } : { p: b, h: b.y - BALL_Y }
      return { w: world(f, pt.p), h: pt.h }
    })
  })
  const c = lowPts.map((pts, i) =>
    pts.map((pt, s) => {
      const a = lowPts[Math.max(0, i - 1)][s].w
      const b = lowPts[Math.min(lowPts.length - 1, i + 1)][s].w
      const v = (Math.hypot(b.x - a.x, b.z - a.z) / (Math.min(lowPts.length - 1, i + 1) - Math.max(0, i - 1) || 1)) * fps
      return pt.h < height && v < speed
    }),
  )
  // remove blips shorter than 3 frames (both on and off)
  for (let s = 0; s < 2; s++)
    for (const val of [true, false]) {
      let i = 0
      while (i < c.length) {
        let j = i
        while (j < c.length && c[j][s] === c[i][s]) j++
        if (c[i][s] === val && j - i < 3 && i > 0 && j < c.length) for (let k = i; k < j; k++) c[k][s] = !val
        i = j
      }
    }
  return c
}

void NB
void qinv
