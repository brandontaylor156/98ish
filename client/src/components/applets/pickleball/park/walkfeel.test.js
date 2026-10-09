// Walking with a thumb (walkfeel.js) in both worlds: the walkers answer at once, face where you
// push, the body as drawn keeps up, and the camera never turns your path on its own.
// node --test client/src/components/applets/pickleball/park/walkfeel.test.js
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import zlib from "zlib"
import { fileURLToPath } from "url"
import { BOOM, FACE, STICK, createDoubleTap, createOrbit, lookRate, orbitDrag, orbitRecenter, orbitRelease, orbitTurn, steerVelocity, stepBoom, stepOrbit, turnFacing } from "./walkfeel.js"
import { createWalker as parkWalker, stepWalker as parkStep } from "./walker.js"
import { createWalker as roamWalker, stepWalker as roamStep } from "../../../../roam/sim/walker.js"
import { createAnim, updateAnim, ridePose, stepRider, RIDE } from "../anim.js"
import { buildLibrary } from "../mm/library.js"
import { setMotionLibrary } from "../mm/runtime.js"

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

// the walking chain at a frame rate: a stick held one way, then another; ms until the walker
// (and the body as drawn) goes the new way at 0.5 m/s and faces it within 20 degrees
const WORLDS = {
  park: { make: () => parkWalker(-18, 0.5, 0), step: (w, s, cam, dt) => parkStep(w, s, cam, dt) },
  roam: { make: () => roamWalker(0, 0, 0), step: (w, s, cam, dt) => roamStep(w, s, cam, dt) },
}
const measure = (world, fps, from, to, { anim = null } = {}) => {
  const W = WORLDS[world]
  const dt = 1 / fps
  const w = W.make()
  const a = anim ? createAnim(w.x, w.z, w.yaw) : null
  if (a) {
    a.useMM = anim === "mm"
    a.mmEvery = 0.2
  }
  const sit = () => ({ x: w.x, z: w.z, vx: w.vx, vz: w.vz, facing: w.yaw, ball: { x: w.x + Math.sin(w.yaw) * 3, y: 1.1, z: w.z + Math.cos(w.yaw) * 3 }, between: true, hand: 1, want: { ...w.want }, id: "me", phase: "intro", phaseT: 0, point: 0, walking: true })
  const step = (s) => {
    W.step(w, s, 0, dt)
    if (a) updateAnim(a, sit(), dt)
  }
  for (let i = 0; i < fps * 1.5; i++) step(from)
  // (the stick: x right, y up; the camera looking along +z: the world way is (-x, y))
  const tgt = Math.atan2(-to.x, to.y)
  let move = null
  let face = null
  let px = a?.mm?.root?.x ?? w.x
  let pz = a?.mm?.root?.z ?? w.z
  for (let i = 1; i <= fps * 2; i++) {
    step(to)
    const x = a?.mm?.root?.x ?? w.x
    const z = a?.mm?.root?.z ?? w.z
    const along = ((x - px) * Math.sin(tgt) + (z - pz) * Math.cos(tgt)) / dt
    px = x
    pz = z
    const yaw = a ? a.yaw : w.yaw
    if (move === null && along > 0.5) move = i * dt * 1000
    if (face === null && Math.abs(wrap(yaw - tgt)) < 0.35) face = i * dt * 1000
  }
  return { move, face, w }
}

const U = { x: 0, y: 1 }
const R = { x: 1, y: 0 }
const L = { x: -1, y: 0 }
const D = { x: 0, y: -1 }

test("moving: the new way builds, the old way goes faster; a stop is quick", () => {
  // a run reversed: forward speed taken away at MOVE.pivot, then the new way builds
  const w = { vx: 0, vz: 6.8 }
  let t = 0
  while (w.vz > -0.5 && t < 1) {
    steerVelocity(w, 0, -6.8, 1 / 60, { accel: 20, decel: 30 })
    t += 1 / 60
  }
  assert.ok(t < 0.11, `reversed in ${t.toFixed(3)} s`)
  // sideways: the old way's speed is gone fast, nothing overshoots
  const s = { vx: 0, vz: 5 }
  for (let i = 0; i < 6; i++) steerVelocity(s, 5, 0, 1 / 60, { accel: 20, decel: 30 })
  assert.ok(s.vz < 0.1 && s.vx > 1.5 && s.vx <= 5, `${s.vx.toFixed(2)}, ${s.vz.toFixed(2)}`)
  // letting go: straight down, never backwards
  const g = { vx: 3, vz: 4 }
  for (let i = 0; i < 20; i++) steerVelocity(g, 0, 0, 1 / 60, { accel: 20, decel: 30 })
  assert.deepEqual([g.vx, g.vz], [0, 0])
})

test("facing: a half turn in about 0.14 s, at 30 and 60 fps, never overshooting", () => {
  for (const fps of [30, 60]) {
    let yaw = 0
    let t = 0
    let over = false
    while (Math.abs(wrap(yaw - Math.PI + 1e-3)) > 0.35 && t < 1) {
      yaw = turnFacing(yaw, Math.PI - 1e-3, 1 / fps)
      if (wrap(yaw - (Math.PI - 1e-3)) > 0.01) over = true
      t += 1 / fps
    }
    assert.ok(t <= 0.2 + 1e-9 && !over, `${fps} fps: ${t.toFixed(3)} s`)
  }
  assert.ok(FACE.max >= 20)
})

test("both walkers: start, turn, reverse and face the new way quickly at 30 fps (under 100 ms to move, 200 ms to face)", () => {
  for (const world of ["park", "roam"]) {
    const start = measure(world, 30, { x: 0, y: 0 }, U)
    assert.ok(start.move <= 50, `${world} start: ${start.move} ms`)
    const turn = measure(world, 30, U, R)
    assert.ok(turn.move <= 50 && turn.face <= 134, `${world} 90: ${JSON.stringify([turn.move, turn.face])}`)
    const rev = measure(world, 30, R, L)
    assert.ok(rev.move <= 100 && rev.face <= 200, `${world} 180: ${JSON.stringify([rev.move, rev.face])}`)
    const back = measure(world, 30, U, D)
    assert.ok(back.move <= 100 && back.face <= 200, `${world} toward the camera: ${JSON.stringify([back.move, back.face])}`)
  }
})

const db = (() => {
  const dir = fileURLToPath(new URL("../../../../../public/assets/pickleball/", import.meta.url))
  if (!fs.existsSync(dir + "motion.bin")) return null
  return buildLibrary(JSON.parse(fs.readFileSync(dir + "motion.json", "utf8")), new Uint8Array(zlib.gunzipSync(fs.readFileSync(dir + "motion.bin"))))
})()

test("the body as drawn keeps up: motion matching and the procedural walk face a reversal within 200 ms at 30 fps", { skip: !db }, () => {
  setMotionLibrary(db)
  for (const anim of ["mm", "proc"])
    for (const world of ["park", "roam"]) {
      const r = measure(world, 30, R, L, { anim })
      assert.ok(r.face !== null && r.face <= 200, `${world} ${anim}: faced in ${r.face} ms`)
      assert.ok(r.move !== null && r.move <= 167, `${world} ${anim}: moved in ${r.move} ms`)
      const t = measure(world, 30, U, R, { anim })
      assert.ok(t.face <= 167, `${world} ${anim} 90: faced in ${t.face} ms`)
    }
})

test("the camera: free never turns on its own; follow comes round only walking away; your path never turns but by your hand", () => {
  const w = { yaw: Math.PI / 2, speed: 4 }
  const free = createOrbit(0)
  let turned = 0
  for (let i = 0; i < 120; i++) turned += stepOrbit(free, 1 / 30, { walker: w, mode: "free" })
  assert.equal(free.yaw, 0)
  assert.equal(turned, 0)
  // follow: walking away-ish (45 degrees off) it comes round, but none of it is "your hand"
  const f = createOrbit(0)
  turned = 0
  for (let i = 0; i < 120; i++) turned += stepOrbit(f, 1 / 30, { walker: { yaw: Math.PI / 4, speed: 4 }, mode: "follow" })
  assert.ok(Math.abs(f.yaw - Math.PI / 4) < 0.2, `came round to ${f.yaw}`)
  assert.equal(turned, 0)
  // sideways and toward it: holds still
  const s = createOrbit(0)
  for (let i = 0; i < 120; i++) stepOrbit(s, 1 / 30, { walker: { yaw: Math.PI / 2, speed: 4 }, mode: "follow" })
  assert.equal(s.yaw, 0)
  // a drag turns it, eased within a few frames, all of it by hand; it holds the follow off
  const d = createOrbit(0)
  orbitDrag(d, -100, 0, { w: 390, h: 844 }, 0)
  turned = stepOrbit(d, 1 / 30, { walker: { yaw: 0, speed: 0 } })
  const want = 100 * lookRate(390, 844)
  assert.ok(Math.abs(turned - want) < 1e-9 && d.yaw > want * 0.6, `turned ${turned}, shows ${d.yaw}`)
  for (let i = 0; i < 6; i++) stepOrbit(d, 1 / 30)
  assert.ok(Math.abs(d.yaw - want) < 0.01)
  // a key turn between frames counts too
  orbitTurn(d, 0.35)
  assert.ok(Math.abs(stepOrbit(d, 1 / 30) - 0.35) < 1e-9)
})

test("the look: sensitivity by screen size, a fling that settles, a double tap round behind you, pitch limits", () => {
  // a phone: 390 px across ~ 165 degrees; an iPad: the same drag turns less
  assert.ok(Math.abs(390 * lookRate(390, 844) - 2.9) < 1e-9)
  assert.ok(lookRate(820, 1180) < lookRate(390, 844) * 0.6)
  const o = createOrbit(0, 0.3)
  let t = 0
  for (let i = 0; i < 5; i++) {
    orbitDrag(o, -12, 0, { w: 390, h: 844 }, t, { lo: 0.05, hi: 0.9 })
    t += 16
  }
  const at = o.goalYaw
  orbitRelease(o, t)
  assert.ok(o.vYaw > 1.5, `flung at ${o.vYaw}`)
  for (let i = 0; i < 60; i++) stepOrbit(o, 1 / 30)
  assert.equal(o.vYaw, 0)
  const extra = o.goalYaw - at
  assert.ok(extra > 0.05 && extra < 1.0, `a fling adds a little: ${extra}`)
  // a slow drag released: no fling
  const s = createOrbit(0)
  orbitDrag(s, -1, 0, { w: 390, h: 844 }, 0)
  orbitDrag(s, -1, 0, { w: 390, h: 844 }, 50)
  orbitRelease(s, 60)
  assert.equal(s.vYaw, 0)
  // pitch limits
  orbitDrag(o, 0, 5000, { w: 390, h: 844 }, t, { lo: 0.05, hi: 0.9 })
  assert.equal(o.goalPitch, 0.9)
  // double tap: two quick taps close together, not two far apart or slow
  const tap = createDoubleTap()
  assert.equal(tap(100, 100, 0), false)
  assert.equal(tap(105, 102, 200), true)
  assert.equal(tap(100, 100, 1000), false)
  assert.equal(tap(300, 100, 1100), false)
  assert.equal(tap(300, 100, 1600), false)
  // recenter: eases round behind in about a third of a second
  const r = createOrbit(0)
  orbitRecenter(r, Math.PI * 0.9)
  for (let i = 0; i < 12; i++) stepOrbit(r, 1 / 30)
  assert.ok(Math.abs(r.yaw - Math.PI * 0.9) < 0.15, `round to ${r.yaw}`)
})

test("the boom: walls pull the lens in fast, it eases back out slowly", () => {
  let d = 5
  for (let i = 0; i < 3; i++) d = stepBoom(d, 1.5, 1 / 30)
  assert.ok(d < 2.0, `in after 0.1 s: ${d}`)
  let e = 1.5
  for (let i = 0; i < 3; i++) e = stepBoom(e, 5, 1 / 30)
  assert.ok(e < 2.6, `out slowly: ${e}`)
  assert.ok(BOOM.in > BOOM.out * 4)
  assert.equal(stepBoom(null, 3, 1 / 30), 3)
})

test("the stick: a dead zone under an eighth of the reach; nothing moves you without it", () => {
  assert.ok(STICK.DEAD <= 0.125 && STICK.DEAD >= 0.08)
  for (const world of ["park", "roam"]) {
    const W = WORLDS[world]
    const w = W.make()
    const at = { x: w.x, z: w.z }
    for (let i = 0; i < 60; i++) W.step(w, { x: STICK.DEAD * 0.7, y: 0 }, 0, 1 / 30)
    assert.deepEqual({ x: w.x, z: w.z }, at, world)
  }
})

test("riding: on the scooter's deck and the bike's saddle and pedals, hands on the bars, limbs their own length, leaning with it", () => {
  const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  for (const kind of ["scooter", "bike"]) {
    const st = { crank: 0, kick: null }
    for (let i = 0; i < 40; i++) {
      stepRider(st, { kind, speed: kind === "bike" ? 5 : 1.5, accel: 1 }, 1 / 30)
      const p = ridePose({ x: 10, y: 2, z: -4, yaw: 0.7, lean: 0.2 * Math.sin(i / 6), kind, crank: st.crank, kick: st.kick })
      for (const [h, k, a] of [[p.hipL, p.kneeL, p.ankleL], [p.hipR, p.kneeR, p.ankleR]]) {
        assert.ok(Math.abs(len(h, k) - 0.43) < 1e-6 && Math.abs(len(k, a) - 0.43) < 1e-6, `${kind} leg bones`)
      }
      for (const f of [p.footL, p.footR]) assert.ok(f.y >= 2 - 0.02, `${kind}: a foot under the ground (${f.y})`)
    }
    // the hands at the bars (when the arms reach), the pelvis over the deck / on the saddle
    const p = ridePose({ x: 0, y: 0, z: 0, yaw: 0, lean: 0, kind, crank: 1, kick: null })
    const B = RIDE[kind].bars
    assert.ok(dist(p.wristP, { x: -B.half, y: B.y, z: B.z }) < 0.08, `${kind}: right hand on the bar ${JSON.stringify(p.wristP)}`)
    if (kind === "bike") assert.ok(Math.abs(p.pelvis.y - RIDE.bike.saddle.y) < 1e-6)
    else {
      assert.ok(p.pelvis.y > 0.9 && p.pelvis.y < 1.15, `standing, knees soft: ${p.pelvis.y}`)
      for (const f of [p.footL, p.footR]) assert.ok(Math.abs(f.y - RIDE.scooter.deck) < 0.05, "both feet on the deck")
    }
    // leaning: the head goes the way of the lean (the mesh rolls the same way)
    const l = ridePose({ x: 0, y: 0, z: 0, yaw: 0, lean: 0.3, kind, crank: 1, kick: null })
    assert.ok(l.head.x < p.head.x - 0.2, `${kind} leans: ${l.head.x} vs ${p.head.x}`)
  }
  // the scooter's kick: only speeding up from slow; the back foot reaches the ground
  const st = { kick: null }
  stepRider(st, { kind: "scooter", speed: 6, accel: 1 }, 1 / 30)
  assert.equal(st.kick, null, "no kick at speed")
  stepRider(st, { kind: "scooter", speed: 1, accel: 1 }, 1 / 30)
  assert.equal(st.kick, 0)
  for (let i = 0; i < 6; i++) stepRider(st, { kind: "scooter", speed: 1.2, accel: 1 }, 1 / 30)
  const k = ridePose({ x: 0, y: 0, z: 0, yaw: 0, lean: 0, kind: "scooter", kick: st.kick })
  assert.ok(Math.min(k.footL.y, k.footR.y) < 0.06, `the back foot on the ground: ${k.footR.y}`)
  // the bike's crank turns with the speed
  const b = { crank: 0 }
  for (let i = 0; i < 30; i++) stepRider(b, { kind: "bike", speed: 5.5, accel: 0 }, 1 / 30)
  assert.ok(b.crank > 5 && b.crank < 9, `about a turn a second at 20 km/h: ${b.crank}`)
})
