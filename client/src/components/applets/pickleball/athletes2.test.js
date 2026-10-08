// Pickleball 98: the athletes, round 2 (docs/pickleball-log.md "Athletes, round 2"). Doubles
// partners shade with the ball (still moving as the other side hits), a groundstroke from the
// back comes up out of the crouch (the low ball met with a hinge), the procedural (Low
// graphics) feet keep an athletic base on the move, and the footage's way of measuring legs.
// node --test client/src/components/applets/pickleball/athletes2.test.js
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"
import { createAnim, updateAnim } from "./anim.js"
import { studioScript } from "./studio.js"
import { SHADE, homeFor } from "./ai.js"
import { createMatch } from "./match.js"
import { SHUFFLE_GAP, createGait, updateGait } from "./locomotion.js"
import { READY } from "./pro.js"
import { buildLibrary } from "./mm/library.js"
import { setMotionLibrary, setEnabled } from "./mm/runtime.js"

const lib = (() => {
  const dir = fileURLToPath(new URL("../../../../public/assets/pickleball/", import.meta.url))
  if (!fs.existsSync(dir + "motion.bin")) return null
  return buildLibrary(JSON.parse(fs.readFileSync(dir + "motion.json", "utf8")), new Uint8Array(zlib.gunzipSync(fs.readFileSync(dir + "motion.bin"))))
})()
const D3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
// the footage's measures (docs/ppa-reference.md section 2): hips above the lower ankle as a
// share of standing tall, and the hip-to-ankle distance as a share of the leg
const legs = (p) => (D3(p.hipL, p.kneeL) + D3(p.kneeL, p.ankleL) + D3(p.hipR, p.kneeR) + D3(p.kneeR, p.ankleR)) / 2
const hipOf = (p) => ((p.hipL.y + p.hipR.y) / 2 - Math.min(p.ankleL.y, p.ankleR.y)) / (0.99 * legs(p))
const reachOf = (p) => (D3(p.hipL, p.ankleL) + D3(p.hipR, p.ankleR)) / 2 / legs(p)

test("doubles partners shade with the ball (SHADE): the team moves as the ball crosses the court", () => {
  assert.ok(SHADE >= 0.38 && SHADE <= 0.46, `SHADE ${SHADE}`)
  const m = createMatch({ doubles: true, level: "pro", seed: 3 })
  m.rally.hits = 5
  m.teamDepth = ["net", "net"]
  const p = m.players.find((q) => q.team === 0)
  m.ball.p.x = -1
  const a = homeFor(m, p)
  m.ball.p.x = 1
  const b = homeFor(m, p)
  assert.ok(Math.abs(Math.abs(b.x - a.x) - 2 * SHADE) < 1e-9, `shifts ${(b.x - a.x).toFixed(2)} m for 2 m of ball`)
  // (singles: unchanged)
  const s = createMatch({ doubles: false, level: "pro", seed: 3 })
  s.rally.hits = 5
  const q = s.players[0]
  s.ball.p.x = -1
  const c = homeFor(s, q)
  s.ball.p.x = 1
  assert.ok(Math.abs(Math.abs(homeFor(s, q).x - c.x) - 0.9) < 1e-9)
})

// a low groundstroke from the baseline (studio "drive-low": contact 0.52 m up)
const groundstroke = (mm) => {
  const sc = studioScript("drive-low", 0, -4.6)
  const a = createAnim(0, -4.6, 0)
  a.useMM = mm
  let ready = null
  let atContact = null
  for (let i = 0; i <= Math.round(sc.T * 60); i++) {
    const t = i / 60
    const s = { ...sc.at(t), depth: 6.9 }
    const pose = updateAnim(a, s, 1 / 60)
    if (t < 0.2) ready = hipOf(pose)
    if (s.swing && s.swing.t >= 0 && s.swing.t < 1 / 60 + 1e-9) atContact = { hip: hipOf(pose), face: D3(pose.paddle.face, sc.contact) }
  }
  return { ready, ...atContact }
}
for (const mm of [false, true]) {
  test(`a low groundstroke from the back comes up out of the crouch, the paddle on the ball (${mm ? "motion matching" : "procedural"})`, { skip: mm && !lib }, () => {
    if (mm) setMotionLibrary(lib)
    setEnabled(mm)
    try {
      const g = groundstroke(mm)
      // (PPA footage: hips at 92% of upright at their own contact at the baseline vs 85%
      // waiting there; before this round the procedural body sank to 79% for a 0.52 m ball)
      assert.ok(g.hip > 0.84, `hips at contact ${g.hip.toFixed(2)} of upright`)
      assert.ok(g.hip > g.ready - 0.03, `not below the ready crouch (${g.hip.toFixed(2)} vs ${g.ready.toFixed(2)})`)
      assert.ok(g.face < 0.06, `the face meets the ball (${(g.face * 100).toFixed(1)} cm)`)
    } finally {
      setEnabled(true)
    }
  })
}

// the procedural feet over 3 s of steady movement (Low graphics: no motion matching)
const walkFeet = (vx, vz, athletic) => {
  const g = createGait(0, 0, 0)
  let x = 0
  let z = 0
  let minLat = 9
  let maxLat = 0
  for (let i = 0; i < 180; i++) {
    x += vx / 60
    z += vz / 60
    updateGait(g, { x, z, vx, vz, yaw: 0, stance: READY.net.allcourt.stance, athletic, reach: null, minHip: 0.8 }, 1 / 60)
    if (i > 40) {
      const lat = Math.abs(g.feet[0].x - g.feet[1].x)
      minLat = Math.min(minLat, lat)
      maxLat = Math.max(maxLat, lat)
    }
  }
  return { minLat, maxLat }
}
test("Low graphics: the procedural feet keep an athletic base while moving in a rally", () => {
  const ath = READY.net.allcourt.stance * 0.95
  const rally = walkFeet(1.2, 0, ath)
  const loose = walkFeet(1.2, 0, 0)
  // (a shuffle's closing foot stops ~0.3 m short of the other: before, it closed to 0.15 m)
  assert.ok(rally.minLat > ath * SHUFFLE_GAP - 0.01, `shuffle: feet never closer than ${rally.minLat.toFixed(2)} m`)
  assert.ok(loose.minLat < 0.2, `between points a shuffle may close up (${loose.minLat.toFixed(2)} m)`)
  // (a slow step forward stays wide; a real run forward narrows to a runner's track)
  assert.ok(walkFeet(0, 1.0, ath).minLat > 0.4, "slow forward steps keep a wide base")
  assert.ok(walkFeet(0, 3.2, ath).maxLat < 0.3, "a run forward is narrow")
})

test("legs measured the footage's way: the ready stances' hip-to-ankle reach and height near the tour's", () => {
  // (docs/pickleball-log.md "Athletes, round 2": MediaPipe's world landmarks read knees ~20
  // degrees straighter than they are and shorten the bones instead, so the footage's knee angle
  // isn't compared; its hip-ankle distance as a share of the player's own upright one is: tour
  // 0.92 at the kitchen (n=189), 0.88 at the baseline (n=248))
  setEnabled(false)
  try {
    for (const [state, tour] of [["ready-kitchen", 0.924], ["ready-base", 0.88]]) {
      const sc = studioScript(state, 0, -4.6, {})
      const s0 = sc.at(0)
      const a = createAnim(s0.x, s0.z, 0)
      a.useMM = false
      const ev = [...(sc.events || [])]
      let pose
      for (let i = 0; i <= Math.round(1.1 * 60); i++) {
        while (ev.length && ev[0][0] <= i / 60) ev.shift()[1](a)
        pose = updateAnim(a, sc.at(i / 60), 1 / 60)
      }
      const r = reachOf(pose)
      assert.ok(Math.abs(r - tour) < 0.06, `${state}: reach ${r.toFixed(3)} (tour ${tour})`)
    }
  } finally {
    setEnabled(true)
  }
})
