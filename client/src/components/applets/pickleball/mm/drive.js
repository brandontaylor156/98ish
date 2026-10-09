// Pickleball 98 motion matching: the bridge anim.js uses. Pure JavaScript (Node-tested).
// One call a frame per player (driveMM): the motion-matching controller (controller.js) with
// the game's position, velocity, wanted velocity and goal, the facing anim.js picked and the
// tags for the moment (relaxed between points, athletic in a rally); the pose solved
// (pose.js: foot locking, pelvis, leg IK), with anim.js's own adjustments on top: lower for a
// crouch (never higher than the motion capture stands), the split step's hop. Returns the
// trunk, legs and the motion-captured arms in anim.js's terms.

import { createMM, updateMM } from "./controller.js"
import { createMMPose, solveMMPose } from "./pose.js"
import { B, ANKLE_Y, HIP_Y } from "./skeleton.js"
import { TAG } from "./library.js"
import { qrot } from "./quat.js"

// the captures' standing hip height (Neutral idles, retargeted; measured)
const STAND_HIP = 0.955
// how far the hips may come up above an athletic capture's to stand as tall as the tour's ready
export const RISE = 0.12
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const len = (a) => Math.hypot(a.x, a.y, a.z)
const norm = (a) => {
  const l = len(a) || 1
  return { x: a.x / l, y: a.y / l, z: a.z / l }
}

// the velocity a player wants, when the match didn't say (an online copy): where the
// smoothed velocity is heading, a little ahead
const wantOf = (s, mv) => s.want || { x: mv.x + mv.ax * 0.12, z: mv.z + mv.az * 0.12 }

// a: anim state; s: the situation; mv: anim.js's smoothed motion { x, z, ax, az }; o:
// { yaw: the facing wanted, crouch: how low anim.js wants the hips (m below standing),
// hopY: the split step's height, every: s between searches, lib }
export const driveMM = (a, s, mv, dt, o) => {
  if (!a.mm || a.mm.lib !== o.lib) {
    a.mm = createMM(o.lib, { x: s.x, z: s.z, yaw: a.yaw })
    a.mmPose = createMMPose()
    // (players search on different frames, so four searches never land on one frame)
    a.mm.timer = 0.02 + ((Math.abs(Math.sin(s.x * 12.9898 + s.z * 78.233)) * 43758.5453) % 1) * (o.every ?? 0.1)
  }
  const speed = Math.hypot(mv.x, mv.z)
  const want = wantOf(s, mv)
  // relaxed between points; athletic in a rally (fast runs are in both)
  // (standing still: only the captured idles, which sway and shift their weight; the best
  // single standing frame of a run looked frozen)
  const standing = Math.hypot(want.x, want.z) < 0.15 && speed < 0.25 && !s.goal && !s.prep && !s.swing
  const mask = standing ? (s.between ? TAG.restIdle : TAG.readyIdle) : s.between ? TAG.neutral : TAG.ready
  // a fast move is a run, facing the way it goes (nobody backpedals or shuffles at 3+ m/s: they
  // turn and run, like a pro going back for a lob)
  let yaw = o.yaw
  const ws = Math.hypot(want.x, want.z)
  if (!o.walking && ws > 2.9 && speed > 1.2) {
    const travel = Math.atan2(want.x, want.z)
    const off = Math.atan2(Math.sin(travel - yaw), Math.cos(travel - yaw))
    if (Math.abs(off) > 0.9) yaw = travel
  }
  const out = updateMM(a.mm, { x: s.x, z: s.z, vx: mv.x, vz: mv.z, want, goal: s.goal || null, maxSpeed: Math.max(Math.hypot(want.x, want.z), speed, 0.5), yaw, mask, every: o.every ?? 0.1, tight: o.tight || 0, walking: !!o.walking }, dt)
  // lower than the motion capture's own hips if anim.js wants a crouch
  const mocapY = out.hip.y
  // (between points the crouch is measured from how high the captures really stand, not the
  // skeleton's straight-legged rest: their standing hips are about 2 cm higher after the
  // retarget, so a 3 cm crouch was a 5 cm one)
  const wantY = (s.between ? Math.max(HIP_Y, STAND_HIP) : HIP_Y) - (o.crouch ?? 0)
  // (down: a low ball the arm can't reach down to, on top of whatever the capture does)
  // (in a rally the athletic captures (100STYLE BentKnees) sit deeper than PPA pros stand
  // ready: docs/ppa-reference.md measured hips at 85-90% of upright on a wide base. Standing or
  // moving slowly the hips come up toward the wanted height, up to RISE above the capture;
  // the legs straighten to the pinned feet. Running, the capture's own posture.)
  const rise = s.between ? 0 : RISE * Math.max(0, Math.min(1, 1 - (speed - 1.2) / 1.3))
  const drop = Math.max(-rise, mocapY - wantY) + (o.down || 0)
  const hop = o.hopY || 0
  // (in a rally the height is the hips' above the standing ankle, as the footage measured it:
  // a capture up on the balls of the feet would otherwise read ~5 cm lower than asked)
  const hipAbove = s.between ? undefined : wantY - ANKLE_Y
  const p = solveMMPose(a.mmPose, out, dt, { drop, hipAbove, rise, down: o.down || 0, still: speed < 0.6 && !hop, lift: hop > 0 ? [hop, hop] : [0, 0], raise: hop, stance: o.stance, stanceW: Math.max(0, Math.min(1, 1 - (speed - 0.6) / 1.4)), shift: o.shift || null, reach: o.reach || null })
  const P = p.P
  // (the hop: the whole body up, solved in solveMMPose: the pelvis raised by it and the feet
  // lifted by it, once. It used to be added again to every joint afterwards, lifting the feet
  // twice as high as the hips: an overhead's 25 cm jump drew a 50 cm tuck)
  const D = p.D
  const pelvis = P[B.pelvis]
  const neck = P[B.neck_01]
  const right = (q) => qrot(q, { x: -1, y: 0, z: 0 })
  const fwd = (q) => qrot(q, { x: 0, y: 0, z: 1 })
  const foot = (s2) => {
    const ankle = P[B["foot_" + s2]]
    const ball = P[B["ball_" + s2]]
    const d = sub(ball, ankle)
    const fl = p.feet[s2 === "l" ? 0 : 1]
    return { x: ankle.x, y: ankle.y - ANKLE_Y, z: ankle.z, yaw: Math.atan2(d.x, d.z), pitch: Math.atan2(-(d.y - (0.022 - ANKLE_Y)), Math.hypot(d.x, d.z)), planted: fl.locked, pin: fl.locked ? { x: (fl.which === "ankle" ? ankle : ball).x, z: (fl.which === "ankle" ? ankle : ball).z, ball: fl.which !== "ankle" } : null }
  }
  return {
    yaw: out.root.yaw,
    root: out.root,
    pelvis,
    pelvisRight: norm(right(D[B.pelvis])),
    spine: norm(sub(neck, pelvis)),
    neck,
    chestRight: norm(right(D[B.spine_03])),
    chestForward: norm(fwd(D[B.spine_03])),
    shoulderL: P[B.upperarm_l],
    shoulderR: P[B.upperarm_r],
    hipL: P[B.thigh_l],
    hipR: P[B.thigh_r],
    kneeL: P[B.calf_l],
    kneeR: P[B.calf_r],
    ankleL: P[B.foot_l],
    ankleR: P[B.foot_r],
    footL: foot("l"),
    footR: foot("r"),
    // the motion-captured arms (anim.js layers them in when nothing else needs the hands)
    elbowL: P[B.lowerarm_l],
    elbowR: P[B.lowerarm_r],
    wristL: P[B.hand_l],
    wristR: P[B.hand_r],
    handEndL: p.ends.hand_l,
    handEndR: p.ends.hand_r,
    head: p.ends.head,
    headQ: D[B.head],
    D,
    P,
    contacts: out.contacts,
    locked: [p.feet[0].locked, p.feet[1].locked],
    v: out.v,
    stats: a.mm.stats,
  }
}
