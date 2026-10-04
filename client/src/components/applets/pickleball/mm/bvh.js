// Pickleball 98 motion matching: motion-capture file parsers (BVH, and the CMU database's
// ASF/AMC). Pure JavaScript, used by the offline tools (tools/build-motion.mjs) and tested in
// Node (mm.test.js). Both give the same shape:
//
//   { joints: [{ name, parent, offset: {x,y,z}, channels: [...], restQ }], fps, frames }
//   frames[f] = { root: {x,y,z}, rot: [Q per joint] }  (local rotations, quaternions {x,y,z,w})
//
// and worldPose(skel, frame) gives every joint's world rotation and position. Units are the
// file's own (100STYLE: centimeters; CMU: ASF "length" units, see scale).

import { Q, qmul, qnorm, qrot, qaxis } from "./quat.js"

const DEG = Math.PI / 180
const AXES = { X: { x: 1, y: 0, z: 0 }, Y: { x: 0, y: 1, z: 0 }, Z: { x: 0, y: 0, z: 1 } }

// rotations applied in the order the channels are listed (BVH: intrinsic, so R = R1 * R2 * R3)
const eulerQ = (order, angles) => {
  let q = Q()
  for (let i = 0; i < order.length; i++) q = qmul(q, qaxis(AXES[order[i]], angles[i] * DEG))
  return qnorm(q)
}

// ---- BVH ----
export const parseBVH = (text) => {
  const tok = text.split(/\s+/).filter(Boolean)
  let i = 0
  const next = () => tok[i++]
  const joints = []
  const stack = []
  let channelCount = 0
  const readJoint = (name, parent) => {
    const j = { name, parent, offset: { x: 0, y: 0, z: 0 }, channels: [], start: 0, end: null }
    const idx = joints.length
    joints.push(j)
    if (next() !== "{") throw new Error("bvh: expected { after " + name)
    for (;;) {
      const t = next()
      if (t === "OFFSET") j.offset = { x: +next(), y: +next(), z: +next() }
      else if (t === "CHANNELS") {
        const n = +next()
        j.start = channelCount
        for (let k = 0; k < n; k++) j.channels.push(next())
        channelCount += n
      } else if (t === "JOINT") readJoint(next(), idx)
      else if (t === "End") {
        next() // Site
        next() // {
        next() // OFFSET
        j.end = { x: +next(), y: +next(), z: +next() }
        next() // }
      } else if (t === "}") return idx
      else throw new Error("bvh: unexpected " + t)
    }
  }
  void stack
  if (next() !== "HIERARCHY") throw new Error("bvh: no HIERARCHY")
  if (next() !== "ROOT") throw new Error("bvh: no ROOT")
  readJoint(next(), -1)
  if (next() !== "MOTION") throw new Error("bvh: no MOTION")
  next() // Frames:
  const n = +next()
  next() // Frame
  next() // Time:
  const ft = +next()
  const frames = []
  for (let f = 0; f < n; f++) {
    const vals = new Float64Array(channelCount)
    for (let k = 0; k < channelCount; k++) vals[k] = +tok[i++]
    frames.push(vals)
  }
  // channels -> local rotations
  const out = []
  for (const vals of frames) {
    const rot = []
    let root = { x: 0, y: 0, z: 0 }
    for (const j of joints) {
      const order = []
      const ang = []
      j.channels.forEach((c, k) => {
        const v = vals[j.start + k]
        if (c.endsWith("position")) root = { ...root, [c[0].toLowerCase()]: v }
        else {
          order.push(c[0])
          ang.push(v)
        }
      })
      rot.push(order.length ? eulerQ(order, ang) : Q())
    }
    out.push({ root, rot })
  }
  for (const j of joints) j.restQ = Q()
  return { joints, fps: Math.round(1 / ft), frames: out }
}

// ---- ASF/AMC (CMU) ----
// The ASF says each bone's direction and length and its own axis frame (axis: Euler angles
// in degrees, order given); the AMC gives each bone's rotation in that axis frame. A bone's
// local rotation: C * M * C^-1 (C: its axis frame, M: the AMC's rotation), applied after its
// parent's. Joints here are the bones' START points (like BVH): a bone's offset from its
// parent's start is the parent's direction * length.
export const parseASF = (text) => {
  const lines = text.split(/\r?\n/)
  let section = ""
  const bones = { root: { name: "root", dir: { x: 0, y: 0, z: 0 }, length: 0, axis: Q(), dof: [] } }
  let order = ["TX", "TY", "TZ", "RX", "RY", "RZ"]
  let rootAxisOrder = "XYZ"
  let rootOrientation = [0, 0, 0]
  let units = { length: 1, angle: "deg" }
  let cur = null
  const hierarchy = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    if (line.startsWith(":")) {
      const [key, ...rest] = line.slice(1).split(/\s+/)
      section = key
      if (key === "units") units = { ...units }
      void rest
      continue
    }
    const parts = line.split(/\s+/)
    if (section === "units") {
      if (parts[0] === "length") units.length = +parts[1]
      if (parts[0] === "angle") units.angle = parts[1]
    } else if (section === "root") {
      if (parts[0] === "order") order = parts.slice(1)
      if (parts[0] === "axis") rootAxisOrder = parts[1]
      if (parts[0] === "orientation") rootOrientation = parts.slice(1).map(Number)
    } else if (section === "bonedata") {
      if (parts[0] === "begin") cur = { dof: [], axis: Q(), dir: { x: 0, y: 0, z: 0 }, length: 0 }
      else if (parts[0] === "end") {
        bones[cur.name] = cur
        cur = null
      } else if (parts[0] === "name") cur.name = parts[1]
      else if (parts[0] === "direction") cur.dir = { x: +parts[1], y: +parts[2], z: +parts[3] }
      else if (parts[0] === "length") cur.length = +parts[1]
      else if (parts[0] === "axis") cur.axis = axisQ(parts)
      else if (parts[0] === "dof") cur.dof = parts.slice(1)
    } else if (section === "hierarchy") {
      if (parts[0] === "begin" || parts[0] === "end") continue
      hierarchy.push(parts)
    }
  }
  // joints in hierarchy order (parents first)
  const parentOf = {}
  for (const [p, ...kids] of hierarchy) for (const k of kids) parentOf[k] = p
  const joints = []
  const index = {}
  const add = (name) => {
    if (index[name] !== undefined) return
    const p = parentOf[name]
    if (p !== undefined && index[p] === undefined) add(p)
    index[name] = joints.length
    const b = bones[name]
    const pb = p !== undefined ? bones[p] : null
    const offset = pb ? { x: pb.dir.x * pb.length, y: pb.dir.y * pb.length, z: pb.dir.z * pb.length } : { x: 0, y: 0, z: 0 }
    joints.push({ name, parent: p !== undefined ? index[p] : -1, offset, axis: b.axis, dof: b.dof, end: { x: b.dir.x * b.length, y: b.dir.y * b.length, z: b.dir.z * b.length }, restQ: Q() })
  }
  add("root")
  for (const name of Object.keys(bones)) add(name)
  return { joints, index, order, rootAxis: rootAxisOrder, rootOrientation, units }
}
// fixed-axis Euler (ASF/AMC): rotations applied in `order`, each about the world axis
// (R = R_last * ... * R_first)
const fixedQ = (order, ang) => {
  let q = Q()
  for (let i = 0; i < order.length; i++) q = qmul(qaxis(AXES[order[i]], ang[i] * DEG), q)
  return qnorm(q)
}
// an ASF "axis" line: axis ax ay az ORDER (degrees)
const axisQ = (parts) => {
  const ang = { X: +parts[1], Y: +parts[2], Z: +parts[3] }
  const order = parts[4] || "XYZ"
  return fixedQ(order, order.split("").map((c) => ang[c]))
}

export const parseAMC = (asf, text, fps = 120) => {
  const frames = []
  let cur = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#") || line.startsWith(":")) continue
    const parts = line.split(/\s+/)
    if (/^\d+$/.test(parts[0]) && parts.length === 1) {
      cur = {}
      frames.push(cur)
      continue
    }
    if (cur) cur[parts[0]] = parts.slice(1).map(Number)
  }
  const C = asf.joints.map((j) => j.axis)
  const out = frames.map((fr) => {
    const rot = []
    let root = { x: 0, y: 0, z: 0 }
    asf.joints.forEach((j, k) => {
      const vals = fr[j.name] || []
      if (j.name === "root") {
        const ang = { X: 0, Y: 0, Z: 0 }
        let rorder = ""
        asf.order.forEach((c, n) => {
          const v = vals[n] ?? 0
          if (c[0] === "T") root = { ...root, [c[1].toLowerCase()]: v }
          else {
            ang[c[1]] = v
            rorder += c[1]
          }
        })
        rot.push(fixedQ(rorder, rorder.split("").map((c) => ang[c])))
        return
      }
      const ang = { X: 0, Y: 0, Z: 0 }
      let o = ""
      j.dof.forEach((d, n) => {
        if (d[0] !== "r") return
        ang[d[1].toUpperCase()] = vals[n] ?? 0
        o += d[1].toUpperCase()
      })
      // the AMC's rotation is in the bone's axis frame, applied X then Y then Z (fixed axes)
      const M = fixedQ("XYZ", [ang.X, ang.Y, ang.Z])
      rot.push(qnorm(qmul(qmul(C[k], M), { x: -C[k].x, y: -C[k].y, z: -C[k].z, w: C[k].w })))
    })
    return { root, rot }
  })
  return { joints: asf.joints, fps, frames: out }
}

// world rotations and positions of every joint for one frame (joints in parent-first order)
export const worldPose = (skel, frame) => {
  const n = skel.joints.length
  const wq = new Array(n)
  const wp = new Array(n)
  for (let k = 0; k < n; k++) {
    const j = skel.joints[k]
    const local = frame.rot[k]
    if (j.parent < 0) {
      wq[k] = local
      wp[k] = { x: frame.root.x + j.offset.x, y: frame.root.y + j.offset.y, z: frame.root.z + j.offset.z }
    } else {
      const pq = wq[j.parent]
      wq[k] = qnorm(qmul(pq, local))
      const o = qrot(pq, j.offset)
      const pp = wp[j.parent]
      wp[k] = { x: pp.x + o.x, y: pp.y + o.y, z: pp.z + o.z }
    }
  }
  return { wq, wp }
}
// where each joint is in the rest pose (no rotations, root at the origin)
export const restPose = (skel) => worldPose(skel, { root: { x: 0, y: 0, z: 0 }, rot: skel.joints.map(() => Q()) })
