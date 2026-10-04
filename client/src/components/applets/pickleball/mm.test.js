// Pickleball 98 motion matching (mm/): the pure parts, in Node.
// node --test client/src/components/applets/pickleball/mm.test.js
import { test } from "node:test"
import assert from "node:assert/strict"
import zlib from "zlib"
import { parseBVH, parseASF, parseAMC, worldPose, restPose } from "./mm/bvh.js"
import { BONES, NB, B, fk, mirrorPose, mirrorQ, REST_OFFSET, REST_DIR, HIP_Y, ANKLE_Y } from "./mm/skeleton.js"
import { MAPS, buildMap, sampleTake, extractRoot, groundTake, labelContacts } from "./mm/retarget-src.js"
import { encodeDB, decodeDB, frameQ, useZlib } from "./mm/db.js"
import { buildFeatures, normalize, normalizeQuery, DIM, mirrorFeature, searchable } from "./mm/features.js"
import { buildIndex, search, searchBrute } from "./mm/search.js"
import { decaySpring, qlogv, qexpv, createInert, transition, decay, applyInert } from "./mm/inertialize.js"
import { createFootLock, stepFootLock, legIK, softReach } from "./mm/footlock.js"
import { buildLibrary } from "./mm/library.js"
import { createMM, updateMM, predictTrajectory } from "./mm/controller.js"
import { Q, qaxis, qmul, qrot, qangle } from "./mm/quat.js"

useZlib(zlib)
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ""} ${a} vs ${b}`)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

// ---- a tiny 100STYLE-shaped BVH: the hierarchy the MAPS expect, a few frames ----
const J = (name, off, kids = "", end = null) => `JOINT ${name}\n{\nOFFSET ${off.join(" ")}\nCHANNELS 3 Yrotation Xrotation Zrotation\n${kids}${end ? `End Site\n{\nOFFSET ${end.join(" ")}\n}\n` : ""}}\n`
const arm = (s, k) => J(`${s}Collar`, [k * 3, 7, 0], J(`${s}Shoulder`, [k * 16, 0, 0], J(`${s}Elbow`, [k * 31, 0, 0], J(`${s}Wrist`, [k * 25, 0, 0], "", [k * 19, 0, 0]))))
const leg = (s, k) => J(`${s}Hip`, [k * 10, 0, 0], J(`${s}Knee`, [0, -44, 0], J(`${s}Ankle`, [0, -43, 0], J(`${s}Toe`, [0, -9.7, 19], "", [0, -1.3, 5]))))
const hierarchy = () => `HIERARCHY\nROOT Hips\n{\nOFFSET 0 0 0\nCHANNELS 6 Xposition Yposition Zposition Yrotation Xrotation Zrotation\n${J("Chest", [0, 13, 0], J("Chest2", [0, 10, 0], J("Chest3", [0, 9, 0], J("Chest4", [0, 9, 0], J("Neck", [0, 13, 0], J("Head", [0, 9, 0], "", [0, 17, 0])) + arm("Right", -1) + arm("Left", 1)))))}${leg("Right", -1)}${leg("Left", 1)}}\n`
const CH = 6 + 3 * 22 // root + 22 rotating joints
const bvhText = (frames) => `${hierarchy()}MOTION\nFrames: ${frames.length}\nFrame Time: 0.016667\n${frames.map((f) => f.join(" ")).join("\n")}\n`
const still = (x = 0, z = 0, yaw = 0) => {
  const f = new Array(CH).fill(0)
  f[0] = x
  f[1] = 97
  f[2] = z
  f[3] = yaw
  return f
}

test("BVH: hierarchy, channels, Euler order and forward kinematics", () => {
  const frames = [still(), still(10, 20, 90)]
  // frame 1: the left knee bent 90 degrees about X
  const skel0 = parseBVH(bvhText(frames))
  const kneeL = skel0.joints.findIndex((j) => j.name === "LeftKnee")
  frames[1][skel0.joints[kneeL].start + 1] = 90
  const skel = parseBVH(bvhText(frames))
  assert.equal(skel.fps, 60)
  assert.equal(skel.joints.length, 23)
  assert.equal(skel.joints[0].name, "Hips")
  const rest = restPose(skel)
  const head = skel.joints.findIndex((j) => j.name === "Head")
  near(rest.wp[head].y, 13 + 10 + 9 + 9 + 13 + 9, 1e-9, "head height")
  const w = worldPose(skel, skel.frames[1])
  // the root yawed 90 degrees: its left hip (+x at rest) now points to -z
  const hipL = skel.joints.findIndex((j) => j.name === "LeftHip")
  near(w.wp[hipL].x - 10, 0, 1e-6)
  near(w.wp[hipL].z - 20, -10, 1e-6)
  // the bent knee: the ankle swings out from under it (43 units from the knee either way)
  const ank = skel.joints.findIndex((j) => j.name === "LeftAnkle")
  near(dist(w.wp[ank], w.wp[kneeL]), 43, 1e-6)
  near(w.wp[ank].y, w.wp[kneeL].y, 1e-6, "the shin is horizontal")
})

test("ASF/AMC: bones start where their parent ends, axis frames and DOFs", () => {
  const asf = `:units\n length 1\n angle deg\n:root\n order TX TY TZ RX RY RZ\n axis XYZ\n:bonedata\n begin\n name lfemur\n direction 0 -1 0\n length 4\n axis 0 0 0 XYZ\n dof rx ry rz\n end\n begin\n name ltibia\n direction 0 -1 0\n length 4\n axis 0 0 0 XYZ\n dof rx\n end\n:hierarchy\n begin\n root lfemur\n lfemur ltibia\n end\n`
  const a = parseASF(asf)
  assert.deepEqual(a.joints.map((j) => j.name), ["root", "lfemur", "ltibia"])
  const amc = `:FULLY-SPECIFIED\n:DEGREES\n1\nroot 0 10 0 0 0 0\nlfemur 0 0 0\nltibia 90\n`
  const s = parseAMC(a, amc)
  const w = worldPose(s, s.frames[0])
  near(w.wp[2].y, 6, 1e-9, "the tibia starts 4 below the root")
  // the tibia bent 90 degrees about x: its end points along -z or +z, not down
  const end = qrot(w.wq[2], { x: 0, y: -4, z: 0 })
  near(Math.abs(end.z), 4, 1e-6)
})

test("retargeting: the rest pose maps to the canonical rest; motion carries over", () => {
  const frames = [still(), still()]
  const skel0 = parseBVH(bvhText(frames))
  const elbow = skel0.joints.findIndex((j) => j.name === "LeftElbow")
  frames[1][skel0.joints[elbow].start] = 45 // the forearm turned 45 degrees about y
  const skel = parseBVH(bvhText(frames))
  const m = buildMap(skel, MAPS.style100)
  const s = sampleTake(skel, m, { fps: 60 })
  // at the source's rest, every canonical bone points along the source bone (rest alignment)
  BONES.forEach((b, i) => {
    const d = qrot(s[0].D[i], REST_DIR[i])
    const want = m.map[b].dir
    near(d.x * want.x + d.y * want.y + d.z * want.z, 1, 1e-6, b)
  })
  near(qangle(s[1].D[B.lowerarm_l], s[0].D[B.lowerarm_l]), Math.PI / 4, 1e-6, "the forearm turned 45")
  near(qangle(s[1].D[B.upperarm_l], s[0].D[B.upperarm_l]), 0, 1e-6, "the upper arm didn't")
  // hips scaled to the game's legs: 0.86 m of leg for 87 units
  near(s[0].hips.y, (97 * 0.86) / 87, 1e-6)
  // the canonical skeleton's own forward kinematics: a T-pose with the ankles 7.5 cm up
  const P = fk(BONES.map(() => Q()), { x: 0, y: HIP_Y, z: 0 })
  near(P[B.foot_l].y, ANKLE_Y, 1e-9)
  near(P[B.upperarm_l].x - P[B.upperarm_r].x, 0.38, 1e-9, "shoulders 0.19 m either side")
})

test("mirroring: left and right swap, twice is the identity, positions reflect", () => {
  const D = BONES.map((b, i) => qaxis({ x: Math.sin(i), y: 1, z: Math.cos(i * 2) }, 0.1 + i * 0.03))
  const M = mirrorPose(D)
  const MM = mirrorPose(M)
  D.forEach((q, i) => near(qangle(q, MM[i]), 0, 1e-6))
  const P = fk(D, { x: 0.1, y: 0.9, z: 0.2 })
  const Pm = fk(M, { x: -0.1, y: 0.9, z: 0.2 })
  for (let i = 0; i < NB; i++) {
    const j = BONES.indexOf(BONES[i].endsWith("_l") ? BONES[i].slice(0, -2) + "_r" : BONES[i].endsWith("_r") ? BONES[i].slice(0, -2) + "_l" : BONES[i])
    near(P[i].x, -Pm[j].x, 1e-9, BONES[i])
    near(P[i].y, Pm[j].y, 1e-9)
    near(P[i].z, Pm[j].z, 1e-9)
  }
  near(qangle(mirrorQ(mirrorQ(D[3])), D[3]), 0, 1e-12)
})

// a small synthetic database: a walk forward (feet alternating), a walk to the left, standing
const synthDB = () => {
  const clips = []
  const make = (name, n, vx, vz, tags) => {
    const frames = []
    for (let i = 0; i < n; i++) {
      const ph = (i / 30) * Math.PI * 2 * 1.8
      const D = BONES.map(() => Q())
      const sw = Math.sin(ph) * (Math.hypot(vx, vz) > 0 ? 0.4 : 0)
      D[B.thigh_l] = qaxis({ x: 1, y: 0, z: 0 }, -sw)
      D[B.calf_l] = D[B.thigh_l]
      D[B.thigh_r] = qaxis({ x: 1, y: 0, z: 0 }, sw)
      D[B.calf_r] = D[B.thigh_r]
      D[B.foot_l] = D[B.thigh_l]
      D[B.foot_r] = D[B.thigh_r]
      D[B.ball_l] = D[B.thigh_l]
      D[B.ball_r] = D[B.thigh_r]
      frames.push({ D, hip: { x: 0, y: HIP_Y - 0.02, z: 0 }, root: { x: (vx * i) / 30, z: (vz * i) / 30, yaw: 0 } })
    }
    clips.push({ name, tags, frames, contacts: labelContacts(frames, 30) })
  }
  make("fwd", 90, 0, 1.3, ["neutral"])
  make("left", 90, 1.0, 0, ["neutral"])
  make("still", 90, 0, 0, ["neutral", "idle"])
  return clips
}

test("database: encode / decode round trip (gzip, quantized, predicted residuals)", () => {
  const clips = synthDB()
  const { json, bin } = encodeDB(clips, 30)
  const raw = new Uint8Array(zlib.gunzipSync(bin))
  const db = decodeDB(json, raw)
  assert.equal(db.N, 270)
  for (const [ci, c] of clips.entries()) {
    const start = json.clips[ci].start
    for (let i = 0; i < c.frames.length; i += 7) {
      const f = start + i
      near(db.root[f * 3], c.frames[i].root.x - c.frames[0].root.x, 1e-3)
      near(db.hip[f * 3 + 1], c.frames[i].hip.y, 1e-3)
      for (let b = 0; b < NB; b++) near(qangle(frameQ(db, f, b), c.frames[i].D[b]), 0, 2e-3)
    }
  }
})

test("features: the trajectory points the way the clip goes; mirrors flip it", () => {
  const { json, bin } = encodeDB(synthDB(), 30)
  const db = decodeDB(json, new Uint8Array(zlib.gunzipSync(bin)))
  const F = buildFeatures(db)
  const ok = searchable(db)
  const fwd = 10
  assert.ok(ok[fwd])
  near(F[fwd * DIM + 5], 1.3 * 0.7, 0.02, "0.7 s ahead, 0.91 m forward")
  near(F[fwd * DIM + 4], 0, 1e-3)
  const left = 90 + 10
  near(F[left * DIM + 4], 0.7, 0.02, "the left walk goes +x (the character's left)")
  near(F[(db.N + left) * DIM + 4], -0.7, 0.02, "its mirror image goes the other way")
  const back = new Float32Array(DIM)
  mirrorFeature(F, (db.N + left) * DIM, back, 0)
  for (let d = 0; d < DIM; d++) near(back[d], F[left * DIM + d], 1e-6)
})

test("search: the boxes never change the answer; the query finds the right clip", () => {
  const lib = buildLibrary(...(() => {
    const { json, bin } = encodeDB(synthDB(), 30)
    return [json, new Uint8Array(zlib.gunzipSync(bin))]
  })())
  // random queries: indexed search == brute force
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  for (let k = 0; k < 40; k++) {
    const q = new Float32Array(DIM).map(() => rnd() * 2)
    const a = search(lib.idx, q)
    const b = searchBrute(lib.F, lib.ok, lib.tags, q)
    assert.equal(a.i, b.i)
    near(a.cost, b.cost, 1e-6)
  }
  // a query asking to walk forward from standing picks the forward clip
  const q = new Float32Array(DIM)
  for (let d = 12; d < DIM; d++) q[d] = lib.raw[(180 + 20) * DIM + d]
  for (let j = 0; j < 3; j++) {
    q[j * 2 + 1] = 1.3 * [0.2, 0.4, 0.7][j]
    q[6 + j * 2 + 1] = 1
  }
  const r = search(lib.idx, normalizeQuery(q, lib.norm))
  assert.equal(lib.db.clips[lib.db.clipOf[r.i % lib.db.N]].name, "fwd")
})

test("inertialization: the offset cancels the jump, then decays smoothly to nothing", () => {
  const r = decaySpring(1, 0, 0.1, 0.1)
  assert.ok(r.x > 0 && r.x < 1)
  let x = 1
  let v = 0
  let prev = 1
  for (let i = 0; i < 60; i++) {
    const s = decaySpring(x, v, 0.1, 1 / 60)
    assert.ok(s.x <= prev + 1e-12 && s.x >= -1e-3, "monotone, no overshoot")
    prev = s.x
    x = s.x
    v = s.v
  }
  assert.ok(x < 0.01)
  const q = qaxis({ x: 0.3, y: 1, z: 0.2 }, 1.1)
  near(qangle(qexpv(qlogv(q)), q), 0, 1e-9)
  // a jump between two poses: on screen, nothing moves at the moment of the jump
  const st = createInert(NB)
  const prevPose = { D: BONES.map((b, i) => qaxis({ x: 1, y: 0, z: 0 }, i * 0.05)), W: BONES.map(() => ({ x: 0, y: 0, z: 0 })), H: { x: 0, y: 0.9, z: 0 }, HV: { x: 0, y: 0, z: 0 } }
  const src = { D: BONES.map((b, i) => qaxis({ x: 0, y: 1, z: 0 }, i * 0.04)), W: BONES.map(() => ({ x: 0, y: 0, z: 0 })), H: { x: 0.05, y: 0.85, z: 0 }, HV: { x: 0, y: 0, z: 0 } }
  transition(st, prevPose, src)
  const out = applyInert(st, src.D, src.H, new Array(NB), {})
  out.D.forEach((q2, i) => near(qangle(q2, prevPose.D[i]), 0, 1e-6))
  near(out.H.y, 0.9, 1e-9)
  for (let i = 0; i < 40; i++) decay(st, 0.1, 1 / 60)
  const late = applyInert(st, src.D, src.H, new Array(NB), {})
  late.D.forEach((q2, i) => assert.ok(qangle(q2, src.D[i]) < 0.02))
})

test("foot locking: a planted foot never slides while the body moves; IK reaches it", () => {
  const st = createFootLock()
  const foot = (x, z) => ({ ankle: { x, y: ANKLE_Y, z }, ball: { x, y: 0.022, z: z + 0.145 }, yaw: 0 })
  let out
  for (let i = 0; i < 20; i++) out = stepFootLock(st, [foot(i * 0.004, 0), foot(0.2, 0)], [true, true], 1 / 60, { still: false })
  near(out[0].ball.x, 0, 1e-9, "pinned")
  near(out[0].ball.z, 0.145, 1e-9)
  // lift: the offset fades out
  for (let i = 0; i < 30; i++) out = stepFootLock(st, [foot(0.08, 0), foot(0.2, 0)], [false, true], 1 / 60)
  near(out[0].ankle.x, 0.08, 0.005, "back on the animation")
  // a settling step while standing: a foot left 9 cm behind steps over
  const s2 = createFootLock()
  stepFootLock(s2, [foot(0, 0), foot(0.2, 0)], [true, true], 1 / 60)
  out = stepFootLock(s2, [foot(0.09, 0), foot(0.2, 0)], [true, true], 1 / 60, { still: true })
  assert.ok(!out[0].locked && s2[0].settle > 0)
  // two-bone leg IK
  const hip = { x: 0, y: 0.9, z: 0 }
  const target = { x: 0.1, y: 0.25, z: 0.15 }
  const r = legIK(hip, { x: 0, y: 0.5, z: 0.2 }, target, 0.43, 0.43)
  near(dist(r.knee, hip), 0.43, 1e-9)
  near(dist(r.knee, r.ankle), 0.43, 1e-9)
  near(dist(r.ankle, target), 0, 1e-6)
  assert.ok(r.knee.z > 0, "the knee bends forward, toward the animation's")
  assert.ok(softReach(0.86, 0.86) < 0.86 && softReach(0.5, 0.86) === 0.5)
})

test("controller: follows the game's position, never drifts far, and stands still when it stands", () => {
  const { json, bin } = encodeDB(synthDB(), 30)
  const lib = buildLibrary(json, new Uint8Array(zlib.gunzipSync(bin)))
  const st = createMM(lib, { x: 0, z: 0, yaw: 0 })
  const g = { x: 0, z: 0, vx: 0, vz: 0 }
  let maxGap = 0
  for (let i = 0; i < 240; i++) {
    const want = i < 120 ? { x: 0, z: 1.3 } : { x: 0, z: 0 }
    const tr = predictTrajectory({ x: g.x, z: g.z, vx: g.vx, vz: g.vz, wx: want.x, wz: want.z }, [1 / 60])
    void tr
    const dv = Math.hypot(want.x - g.vx, want.z - g.vz)
    const m = Math.min(1, (12 / 60) / (dv || 1))
    g.vx += (want.x - g.vx) * m
    g.vz += (want.z - g.vz) * m
    g.x += g.vx / 60
    g.z += g.vz / 60
    const o = updateMM(st, { x: g.x, z: g.z, vx: g.vx, vz: g.vz, want, yaw: 0 }, 1 / 60)
    maxGap = Math.max(maxGap, Math.hypot(o.root.x - g.x, o.root.z - g.z))
    if (i === 100) assert.equal(lib.db.clips[lib.db.clipOf[o.v % lib.db.N]].name, "fwd")
  }
  assert.ok(maxGap <= 0.2 + 1e-9, "within the allowed gap: " + maxGap)
  // predictTrajectory runs the match's rule: 12 m/s^2 toward 4 m/s from rest
  const p = predictTrajectory({ x: 0, z: 0, vx: 0, vz: 0, wx: 4, wz: 0 }, [1 / 3, 1])
  near(p[0].vx, 4, 1e-9)
  near(p[1].x, 4 * 1 - (4 * 4) / (2 * 12), 0.05)
})

void qmul
void REST_OFFSET
void groundTake
void extractRoot
void normalize
