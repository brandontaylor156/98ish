// Pickleball 98: between points (between.js) and the motion-captured gestures (mm/gesture.js).
// node --test client/src/components/applets/pickleball/between.test.js
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "fs"
import zlib from "zlib"
import { fileURLToPath } from "url"
import { betweenActs, hash01, BETWEEN } from "./between.js"
import { buildLibrary, libraryData, libraryFromData } from "./mm/library.js"
import { gestureArms, GESTURES } from "./mm/gesture.js"
import { search } from "./mm/search.js"
import { DIM } from "./mm/features.js"
import { createAnim, updateAnim } from "./anim.js"

const S = (extra = {}) => ({ x: 0, z: 5, vx: 0, vz: 0, between: true, phase: "dead", phaseT: 0.5, point: 3, id: "you", mate: { x: 1.2, z: 5.1, id: "partner" }, ...extra })

test("partners tap paddles once after each point, as they pass within reach", () => {
  const st = {}
  let taps = 0
  let wasTap = false
  let peak = 0
  for (let i = 0; i < 120; i++) {
    const o = betweenActs(st, S({ phaseT: 0.3 + i / 60 }), 0, i / 60, 1 / 60)
    if (o.tap && !wasTap) taps++
    wasTap = !!o.tap
    if (o.tap) {
      peak = Math.max(peak, o.tap.w)
      // the face meets the other paddle halfway, pointed at it
      assert.ok(o.tap.x > 0.4 && o.tap.x < 0.6)
      assert.ok(o.tap.nx > 0.99)
    }
  }
  assert.equal(taps, 1)
  assert.ok(peak > 0.95)
  // too far apart: no tap
  const far = betweenActs({}, S({ mate: { x: 3.5, z: 5 } }), 0, 0, 1 / 60)
  assert.equal(far.tap, null)
  // the next point: another tap
  const o2 = betweenActs(st, S({ point: 4, phaseT: 0.4 }), 0, 3, 1 / 60)
  assert.ok(o2.tap)
  // after the game: at the net, with the player across
  const net = betweenActs({}, S({ phase: "over", phaseT: 1, across: { x: 0.1, z: 3.6 } }), 0, 0, 1 / 60)
  assert.ok(net.tap && net.tap.nz < -0.9)
  void BETWEEN
})

test("fidgets, glances and the returner's crouch; the same in every browser", () => {
  // some point has a twirl and some a wipe, chosen from the player and the point alone
  let twirl = false
  let wipe = false
  for (let n = 0; n < 30; n++)
    for (let k = 0; k < 120; k++) {
      const o = betweenActs({}, S({ phase: "intro", phaseT: k / 60, point: n, mate: null }), 0, k / 60, 1 / 60)
      if (o.twirl) twirl = true
      if (o.wipe !== null) wipe = true
    }
  assert.ok(twirl && wipe)
  assert.equal(hash01("you", 3), hash01("you", 3))
  assert.notEqual(hash01("you", 3), hash01("you", 4))
  // a glance at the partner now and then
  let glances = 0
  for (let k = 0; k < 600; k++) if (betweenActs({ tapped: "p3" }, S({ phase: "intro", phaseT: 5 }), 1, k / 60, 1 / 60).look) glances++
  assert.ok(glances > 60 && glances < 300, `glances ${glances}`)
  // the returner waits low
  const r = betweenActs({}, S({ between: false, phase: "serve", receiving: true }), 0, 1, 1 / 60)
  assert.ok(r.crouch > 0.03)
  // while walking or holding the ball: no fidgets
  const busy = betweenActs({}, S({ phase: "intro", phaseT: 1, holding: true }), 0, 1, 1 / 60)
  assert.equal(busy.twirl, 0)
})

test("a paddle tap in the animation: the paddle goes up toward the partner and comes back", () => {
  const a = createAnim(-0.5, 0, 0)
  let maxUp = -1
  let start = null
  for (let i = 0; i < 70; i++) {
    const pose = updateAnim(a, { x: -0.5, z: 0, vx: 0, vz: 0, facing: 0, ball: { x: 0, y: 1, z: 6 }, holding: false, swing: null, prep: null, charging: false, between: true, atNet: false, hand: 1, twoHand: false, phase: "dead", phaseT: 0.3 + i / 60, point: 1, id: "you", mate: { x: 0.5, z: 0, id: "mate" } }, 1 / 60)
    if (start === null) start = pose.paddle.face
    maxUp = Math.max(maxUp, pose.paddle.face.y)
    if (i === 24) assert.ok(pose.paddle.face.x > start.x + 0.25, "toward the partner")
  }
  assert.ok(maxUp > 1.0)
})

const db = (() => {
  const dir = fileURLToPath(new URL("../../../../public/assets/pickleball/", import.meta.url))
  if (!fs.existsSync(dir + "motion.bin")) return null
  return buildLibrary(JSON.parse(fs.readFileSync(dir + "motion.json", "utf8")), new Uint8Array(zlib.gunzipSync(fs.readFileSync(dir + "motion.bin"))))
})()

test("the shipped database: gestures play from the shoulders; the library survives a worker hand-over", { skip: !db }, () => {
  for (const name of Object.keys(GESTURES)) {
    const g = gestureArms(db, name, 0.3)
    assert.ok(g, name)
    for (const s of ["l", "r"]) {
      const d = Math.hypot(g[s].wrist.x, g[s].wrist.y, g[s].wrist.z)
      assert.ok(d > 0.2 && d < 0.6, `${name} ${s} arm length ${d}`)
    }
  }
  // the big celebration has both hands above the shoulders
  const joy = gestureArms(db, "joy", 0.3)
  assert.ok(joy.l.wrist.y > 0.05 && joy.r.wrist.y > 0.05 && joy.l.wrist.x > 0.3 && joy.r.wrist.x < -0.3, "arms up and out")
  // structured clone (what postMessage does) and back: the same search answers
  const back = libraryFromData(structuredClone(libraryData(db)))
  const q = new Float32Array(DIM).map((_, i) => Math.sin(i * 1.7))
  const a = search(db.idx, q)
  const b = search(back.idx, q)
  assert.equal(a.i, b.i)
  assert.equal(back.clipOfV(db.db.N + 5), db.clipOfV(db.db.N + 5))
})
