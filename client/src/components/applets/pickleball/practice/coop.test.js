// Drilling with a friend online (practice/coop.js): node --test client/src/components/applets/pickleball/practice/coop.test.js
// Two people on one match (as the host runs it; stand-ins play both with real timing).
import test from "node:test"
import assert from "node:assert/strict"
import { COOP_DRILLS, createCoop, judgeShot } from "./coop.js"
import { createMatch, step, autopilot, seeded } from "../match.js"
import { KITCHEN, STEP } from "../physics.js"

const twoPeople = (drill, seed = 5) => {
  const practice = createCoop(drill, { rand: seeded(seed) })
  const m = createMatch({
    doubles: false,
    seed,
    practice,
    roster: [
      { id: "p0", team: 0, ctrl: "human", slot: 0, name: "Ana", character: "maya" },
      { id: "p1", team: 1, ctrl: "human", slot: 1, name: "Ben", character: "dex" },
    ],
  })
  return { m, st: practice.state }
}
const run = (m, seconds, seed = 9) => {
  const rand = seeded(seed)
  const events = []
  for (let i = 0; i < seconds / STEP; i++) {
    if (i % 4 === 0) {
      autopilot(m, 0, { rand, jitter: 0.03 })
      autopilot(m, 1, { rand, jitter: 0.03 })
    }
    step(m)
    for (const e of m.events) events.push(e)
    m.events.length = 0
  }
  return events
}

test("co-op drill: everyone walks to the drill's spots, then the feeder's hand puts the ball in play", () => {
  const { m, st } = twoPeople("dinks")
  assert.equal(m.phase, "intro")
  const events = run(m, 3.5)
  const feed = events.find((e) => e.type === "hit")
  assert.ok(feed, "a feed")
  assert.equal(m.phase === "rally" || m.phase === "dead" || m.phase === "intro", true)
  // both at the kitchen line for dinks (one on each side)
  for (const p of m.players) assert.ok(Math.abs(Math.abs(p.spot.z) - KITCHEN) < 1.2, `${p.id} at the line ${p.spot.z}`)
  assert.equal(st.rallies, 0)
})

test("co-op drill: rallies count a streak of good shots, the best is kept, the feeder takes turns", () => {
  for (const d of COOP_DRILLS) {
    const { m, st } = twoPeople(d.id)
    const events = run(m, 70)
    const snaps = events.filter((e) => e.type === "drill" && e.coop).map((e) => e.snap)
    assert.ok(st.rallies >= 2, `${d.id}: ${st.rallies} rallies`)
    assert.ok(st.best >= 1, `${d.id}: best ${st.best}`)
    assert.ok(snaps.length >= st.rallies, `${d.id}: reports`)
    assert.ok(snaps.every((s) => s.streak <= s.best), `${d.id}: streak never above best`)
    assert.equal(m.game.score.join("-"), "0-0", `${d.id}: no score kept`)
    assert.ok(st.feeder >= 2, `${d.id}: feeders took turns`)
  }
})

test("co-op drill: what counts", () => {
  const k = KITCHEN - 0.5
  assert.equal(judgeShot("dinks", { landing: { x: 0, z: -k } }), true)
  assert.equal(judgeShot("dinks", { landing: { x: 0, z: -5 } }), false)
  assert.equal(judgeShot("dinks", { landing: { x: 0, z: -9 } }), null, "out: the referee ends it")
  assert.equal(judgeShot("drops", { role: "base", landing: { x: 1, z: k } }), true)
  assert.equal(judgeShot("drops", { role: "base", landing: { x: 1, z: 5 } }), false)
  assert.equal(judgeShot("drops", { role: "net", landing: { x: 1, z: 5 } }), true)
  assert.equal(judgeShot("volleys", { volley: true, landing: { x: 0, z: 4 } }), true)
  assert.equal(judgeShot("volleys", { volley: false, landing: { x: 0, z: 4 } }), false)
  assert.equal(judgeShot("rally", { landing: null }), true)
})
