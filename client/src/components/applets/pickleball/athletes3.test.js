// Pickleball 98: the athletes, round 3 (docs/pickleball-log.md "Athletes, round 3"). A doubles
// team coming in from the back walks in through the split step instead of sprinting to the
// transition zone and standing there (computer players only: nothing moves your player), and
// the motion-matched feet don't pop: a landing pins the foot where it is on screen, a lunge's
// step starts from there (carrying on the way the foot was going), a one-frame flicker of the
// capture's contact flag doesn't let go, a foot that can't be reached steps instead of being
// dragged, and the root's turn is inertialized through a motion-matching jump.
// node --test client/src/components/applets/pickleball/athletes3.test.js
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"
import { WALK, createMatch, serve, step, walkIn } from "./match.js"
import { STEP } from "./physics.js"
import { createAnim, updateAnim, situation, splitStep } from "./anim.js"
import { LOCK, createFootLock, stepFootLock } from "./mm/footlock.js"
import { ANKLE_Y } from "./mm/skeleton.js"
import { buildLibrary } from "./mm/library.js"
import { setMotionLibrary, setEnabled } from "./mm/runtime.js"

const lib = (() => {
  const dir = fileURLToPath(new URL("../../../../public/assets/pickleball/", import.meta.url))
  if (!fs.existsSync(dir + "motion.bin")) return null
  return buildLibrary(JSON.parse(fs.readFileSync(dir + "motion.json", "utf8")), new Uint8Array(zlib.gunzipSync(fs.readFileSync(dir + "motion.bin"))))
})()
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]

test("walkIn: watch the drop, then a burst that eases down to a walk at the split", () => {
  const m = { t: 10, lastShot: { team: 0, t: 9.9 } }
  const p = { team: 0, z: 6.9 }
  assert.equal(walkIn(m, p, 1.5, 4.1), WALK.creep, "watching their drop")
  m.lastShot.t = 9
  // (the pace falls as the cube of the time left and ends at WALK.split right at WALK.at)
  const D = 6.9 - WALK.at
  const v0 = walkIn(m, p, 2, 9)
  assert.ok(Math.abs(v0 - (WALK.split + (WALK.k + 1) * (D / 2 - WALK.split))) < 1e-9)
  // following that profile, the pace still asked a moment before the contact is the split pace
  let z = 6.9
  let t = 0
  const T = 1.6
  while (T - t > 0.06) {
    const v = walkIn({ t: 20 + t, lastShot: { team: 0, t: 0 } }, { team: 0, z }, T - t, 9)
    z -= v / 240
    t += 1 / 240
  }
  // (a moment before the contact: the split still the last few cm ahead at the split pace)
  assert.ok(Math.abs(z - (WALK.at + WALK.split * (T - t))) < 0.06, `at the split ${z.toFixed(2)} m, ${(T - t).toFixed(2)} s before the contact`)
  assert.ok(Math.abs(walkIn({ t: 20 + t, lastShot: { team: 0, t: 0 } }, { team: 0, z }, T - t, 9) - WALK.split) < 0.35)
  // never faster than the player can run; past the split, a walk
  assert.equal(walkIn(m, p, 0.2, 4.1), 4.1)
  assert.equal(walkIn(m, { team: 0, z: 3.0 }, 1, 4.1), WALK.min)
  // a person is never walked: a team with a person in it can still be in the stage, but the
  // pace is only ever applied to computer players (match.js movePlayer: ai && p.homing)
})

// where the walking-in team is (and how fast it's going) as the other side plays the next ball
const walkers = (games) => {
  const rows = []
  let arrivals = []
  for (let g = 0; g < games; g++) {
    const m = createMatch({ doubles: true, level: "pro", seed: 500 + g, scoring: "rally" })
    m.autoplay = true
    let n = 0
    let tServe = null
    let arrived = true
    while (m.phase !== "over" && n < 240 * 60 * 8) {
      const stage = m.teamStage ? [...m.teamStage] : [null, null]
      const depth = m.teamDepth ? [...m.teamDepth] : []
      step(m, STEP)
      n++
      for (const e of m.events) {
        if (e.type !== "hit") continue
        if (e.kind === "serve") {
          tServe = m.t
          arrived = false
        }
        const w = 1 - e.team
        if (stage[w] && depth[w] === "step") for (const p of m.players) if (p.team === w) rows.push({ z: Math.abs(p.z), v: Math.hypot(p.vx, p.vz) })
      }
      m.events.length = 0
      if (!arrived && m.phase === "rally" && m.rally.hits >= 3) {
        const srv = m.players.filter((p) => p.team === m.rally.serving)
        if (srv.some((p) => Math.abs(p.z) < 2.13 + 0.42 + 0.3)) {
          arrivals.push(m.t - tServe)
          arrived = true
        }
      }
      if (m.phase !== "rally") arrived = true
    }
  }
  return { rows, arrivals }
}

test("the serving team walks in through the split: in the transition zone and still moving as the other side hits, and still at the line in time", () => {
  const { rows, arrivals } = walkers(4)
  assert.ok(rows.length > 30, `${rows.length} far contacts while walking in`)
  const z = median(rows.map((r) => r.z))
  const v = median(rows.map((r) => r.v))
  // (PPA footage: 1.73 m/s in the transition zone at the far contact; before this round the
  // game's teams stood there: median ~0.8 m/s, most of them still)
  assert.ok(z > 3.2 && z < 4.2, `in the transition zone (${z.toFixed(2)} m from the net)`)
  assert.ok(v > 1.3 && v < 2.6, `still walking in (${v.toFixed(2)} m/s)`)
  assert.ok(rows.filter((r) => r.v < 0.3).length < rows.length * 0.1, "hardly anyone stopped dead")
  // (and the serving team still reaches the line about when the tour's does: 4.85 s)
  const a = median(arrivals)
  assert.ok(a > 4.0 && a < 5.6, `serving team at the line ${a.toFixed(2)} s after the serve`)
})

test("nothing moves your player: with no input a person stands still through every rally, the walk-in included", () => {
  const m = createMatch({ doubles: true, level: "pro", seed: 7, scoring: "rally", assist: "light" })
  const you = m.players.find((p) => p.ctrl === "human")
  let n = 0
  let moved = 0
  let rallyFrames = 0
  let walkFrames = 0
  let last = null
  while (m.phase !== "over" && n < 240 * 60 * 3) {
    // (your serve: a tap, which never moves you)
    if (m.phase === "serve" && m.game.server === you.id && m.ball.held === you.id) serve(m, { kind: "serve", variant: "drive", aim: 0, power: 0.6, grade: "good" })
    step(m, STEP)
    m.events.length = 0
    n++
    if (m.phase === "rally") {
      rallyFrames++
      if (m.teamDepth[you.team] === "step" && m.teamStage?.[you.team]) walkFrames++
      if (last && Math.hypot(you.x - last.x, you.z - last.z) > 1e-9) moved++
      last = { x: you.x, z: you.z }
    } else last = null
  }
  assert.ok(rallyFrames > 240 * 5, "rallies were played")
  assert.ok(walkFrames > 60, `your team walked in (${walkFrames} frames: your partner did)`)
  assert.equal(moved, 0, "the person's player never moved by itself")
})

// ---- the feet ----
const foot = (x, z, y = ANKLE_Y) => ({ ankle: { x, y, z }, ball: { x, y: 0.022 + (y - ANKLE_Y), z: z + 0.145 }, yaw: 0 })

test("foot lock: a landing pins the foot where it was on screen, even when the animation jumps that frame", () => {
  const st = createFootLock()
  // in the air, moving 1 cm a frame
  let out
  for (let i = 0; i < 10; i++) out = stepFootLock(st, [foot(i * 0.01, 0, ANKLE_Y + 0.03), foot(0.3, 0)], [false, true], 1 / 60, { still: false })
  const before = out[0].ankle.x
  // the frame it lands, the animation's foot leaps 8 cm (a motion-matching jump, a sudden turn)
  out = stepFootLock(st, [foot(0.18, 0), foot(0.3, 0)], [true, true], 1 / 60, { still: false })
  assert.ok(out[0].locked)
  assert.ok(Math.abs(out[0].ankle.x - before) < 0.011, `landed ${((out[0].ankle.x - before) * 100).toFixed(1)} cm on from last frame (the animation leapt 8)`)
})

test("foot lock: a one-frame flicker of the capture's contact flag doesn't let the foot go", () => {
  const st = createFootLock()
  let out
  for (let i = 0; i < 5; i++) out = stepFootLock(st, [foot(0, 0), foot(0.3, 0)], [true, true], 1 / 60, { still: false })
  const pin = out[0].ball.x
  // the animation slides on 3 cm a frame while the flag drops out for two frames
  for (let i = 1; i <= 2; i++) out = stepFootLock(st, [foot(i * 0.03, 0), foot(0.3, 0)], [false, true], 1 / 60, { still: false })
  assert.ok(out[0].locked && Math.abs(out[0].ball.x - pin) < 1e-9, "still pinned")
  // lifted for real: let go
  for (let i = 3; i <= 6; i++) out = stepFootLock(st, [foot(i * 0.03, 0, ANKLE_Y + 0.02 * i), foot(0.3, 0)], [false, true], 1 / 60, { still: false })
  assert.ok(!out[0].locked)
  assert.ok(LOCK.upHold <= 0.07)
})

test("foot lock: a foot coming down far from the animation steps over to it, never slides", () => {
  const st = createFootLock()
  st[0].ox = 0.4 // (still 40 cm out after a reach)
  st[0].vx = 0
  const out = stepFootLock(st, [foot(0, 0), foot(0.3, 0)], [true, true], 1 / 60, { still: false })
  assert.ok(!out[0].locked && st[0].settle > 0, "a settling step (lifted), not a pinned foot let go every frame")
})

test("foot lock: a lunge's step starts where the foot is, carrying on the way it was going", () => {
  // pinned, while the animation's foot slides 5 cm a frame (the body turning on it)
  const st = createFootLock()
  let out
  for (let i = 0; i < 6; i++) out = stepFootLock(st, [foot(i * 0.05, 0), foot(0.3, 0)], [true, true], 1 / 60, { still: false })
  const at = out[0].ankle.x
  out = stepFootLock(st, [foot(0.3, 0), foot(0.3, 0)], [true, true], 1 / 60, { still: false, reach: { foot: 0, x: 0.1, z: 0.5 } })
  const d = Math.hypot(out[0].ankle.x - at, out[0].ankle.z - 0)
  assert.ok(d < 0.03, `the step leaves from the pinned spot (${(d * 100).toFixed(1)} cm, was the frame's whole slide)`)
  // a foot already travelling (a settling step) keeps going into the step: its first frame moves
  const s2 = createFootLock()
  s2[0].shown = { ankle: { x: 0, z: 0 }, ball: { x: 0, z: 0.145 } }
  s2[0].shownV = { x: 0, z: 2.5 }
  out = stepFootLock(s2, [foot(0, 0), foot(0.3, 0)], [true, true], 1 / 60, { still: false, reach: { foot: 0, x: 0, z: 0.5 } })
  assert.ok(out[0].ankle.z > 0.02, `carried on ${(out[0].ankle.z * 100).toFixed(1)} cm`)
})

test("motion matching over a long match: few one-frame foot pops, the body never snaps round", { skip: !lib }, () => {
  setMotionLibrary(lib)
  setEnabled(true)
  const m = createMatch({ doubles: true, level: "pro", seed: 11 })
  m.autoplay = true
  const anims = m.players.map((p) => {
    const a = createAnim(p.x, p.z, p.team === 0 ? Math.PI : 0)
    a.useMM = true
    a.mmEvery = 0.1
    return a
  })
  const prev = m.players.map(() => null)
  let pops = 0
  let snaps = 0
  let frames = 0
  for (let f = 0; f < 60 * 60 && m.phase !== "over"; f++) {
    const hits = []
    for (let k = 0; k < 4; k++) {
      step(m, STEP)
      for (const e of m.events) if (e.type === "hit") hits.push(e)
      m.events.length = 0
    }
    frames++
    m.players.forEach((p, i) => {
      for (const e of hits) if (e.team !== p.team) splitStep(anims[i], { fallback: true })
      const pose = updateAnim(anims[i], situation(m, p), 1 / 60)
      const feet = [pose.ankleL, pose.ankleR].map((q) => ({ x: q.x, z: q.z }))
      const pv = prev[i]
      const d = pv ? feet.map((q, k) => Math.hypot(q.x - pv.feet[k].x, q.z - pv.feet[k].z)) : null
      const body = pv ? Math.hypot(p.x - pv.x, p.z - pv.z) : 0
      // a pop: a foot jumping > 4 cm in one frame between two frames where it hardly moved
      if (pv?.d && body < 0.08) for (let k = 0; k < 2; k++) if (pv.d[k] > 0.04 && pv.dPrev[k] < pv.d[k] / 3 && d[k] < pv.d[k] / 3) pops++
      const yaw = anims[i].mm?.root.yaw
      const w = pv && yaw !== undefined ? Math.atan2(Math.sin(yaw - pv.yaw), Math.cos(yaw - pv.yaw)) : null
      if (m.phase === "rally" && w !== null && pv.w !== null && Math.abs(w - pv.w) > 2 / 57.3) snaps++
      prev[i] = { feet, x: p.x, z: p.z, d, dPrev: pv?.d || [0, 0], yaw, w }
    })
  }
  setEnabled(false)
  // (before this round, on this match's first minute: 8 pops > 4 cm and 112 turning snaps > 2
  // degrees a frame; after: 4 and 13)
  assert.ok(frames > 3000)
  assert.ok(pops <= 5, `${pops} foot pops in four players' minute`)
  assert.ok(snaps <= 40, `${snaps} turning snaps`)
})
