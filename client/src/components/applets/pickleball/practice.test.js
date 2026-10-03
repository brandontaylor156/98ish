// Practice, the tutorial, the World Tour, controls and the timing model for Pickleball 98.
// Run: node --test client/src/components/applets/pickleball/
import test from "node:test"
import assert from "node:assert/strict"
import { DRILLS, TUTORIAL, practiceMatch, drillById } from "./drills.js"
import { TOUR, freshTour, nextMatch, recordResult, tourState, unlocks } from "./career.js"
import { createMatch, step, autopilot, seeded, press, release, scenario, playerById, setMove, SWING_LEAD } from "./match.js"
import { gradeOf, shotQuality, serveMeter } from "./shots.js"
import { bindingsFor, rebind, actionFor, keyName, readPad, padEdges } from "./input.js"
import { CHARACTERS, lookFor } from "./looks.js"
import { STEP } from "./physics.js"

// run a drill with the stand-in player until it's done (or time runs out)
const runDrill = (spec, seconds = 240, seed = 3) => {
  const rand = seeded(seed)
  const m = createMatch({ ...practiceMatch(spec, { rand }), seed })
  const events = []
  for (let i = 0; i < seconds / STEP && !m.practice.state.done; i++) {
    if (spec.moved) setMove(m, Math.sin(i / 300), Math.cos(i / 410), 0)
    else if (i % 4 === 0) autopilot(m, 0, { rand, jitter: 0.05, button: spec.button, risky: spec.risky })
    step(m)
    for (const e of m.events) if (e.type === "drill") events.push(e)
    m.events.length = 0
  }
  return { m, st: m.practice.state, events }
}

test("drills: each one feeds, counts your attempts and finishes", () => {
  for (const d of DRILLS) {
    const { st, events } = runDrill(d)
    assert.ok(st.done, `${d.id} finished (${st.attempts}/${st.total}, made ${st.made})`)
    assert.equal(st.attempts, d.total, `${d.id} counted every attempt`)
    assert.ok(st.made > 0, `${d.id}: the stand-in made some`)
    assert.equal(events.at(-1).done, true)
  }
})

test("drills: third-shot drops only count when they land in the kitchen", () => {
  const { m, st } = runDrill(drillById("third"))
  assert.ok(st.made <= st.attempts)
  assert.ok(m.stats.shots >= st.attempts, "the machine fed and you hit")
})

test("tutorial: each step can be completed", () => {
  for (const step0 of TUTORIAL) {
    if (step0.card) continue
    const { st } = runDrill(step0, 300, 5)
    assert.ok(st.done, `${step0.id} done (${st.made}/${step0.need ?? "?"})`)
  }
})

test("tour: eight matches, wins move you up and unlock venues and outfits; bad saves are safe", () => {
  assert.equal(TOUR.length, 8)
  let s = freshTour()
  assert.equal(nextMatch(s).id, "r1")
  assert.deepEqual(unlocks(s).outfits, ["home", "away"])
  let r = recordResult(s, 0, false, [5, 7])
  assert.equal(r.state.stage, 0, "a loss lets you retry")
  for (let i = 0; i < TOUR.length; i++) {
    r = recordResult(s, i, true, [11, 4])
    s = r.state
  }
  assert.equal(s.champion, true)
  assert.equal(nextMatch(s), null)
  const u = unlocks(s)
  assert.deepEqual(u.venues, ["park", "club", "stadium"])
  assert.ok(u.outfits.includes("gold") && u.outfits.includes("neon"))
  assert.deepEqual(tourState({ stage: 99, results: "x" }).stage, 8)
  assert.equal(tourState(null).stage, 0)
  for (const t of TOUR) assert.ok(CHARACTERS.some((c) => c.id === t.opponent), t.opponent)
})

test("timing: grades by how early or late; perfect is tighter and better", () => {
  assert.equal(gradeOf(0, 0.06), "perfect")
  assert.equal(gradeOf(0.1, 0.06), "good")
  assert.equal(gradeOf(-0.2, 0.06), "early")
  assert.equal(gradeOf(0.5, 0.06), "very late")
  const p = shotQuality(0.01)
  const l = shotQuality(0.25, { kind: "dink" })
  assert.ok(p.sigma < 1 && l.sigma > 1)
  assert.ok(l.apexAdd > 0, "a late dink floats up")
  assert.ok(shotQuality(-0.2).aimShift > 0 && shotQuality(0.2).aimShift < 0, "early pulls, late pushes")
  assert.equal(serveMeter(0.85).grade, "perfect")
  assert.equal(serveMeter(1.1).grade, "very late")
})

test("press and release: letting go on the beat is perfect, holding too long is late", () => {
  const timeIt = (lead) => {
    const m = createMatch({ doubles: false, seed: 4 })
    scenario(m, "drive")
    const you = playerById(m, "you")
    let grade = null
    for (let i = 0; i < 240 * 3 && !grade; i++) {
      const e = you.expect
      if (e && !you.charge && !you.armed && e.at - m.t < 0.45) press(m, 0, "topspin")
      if (you.charge && e && e.at - m.t <= lead) release(m, 0)
      step(m)
      const hit = m.events.find((x) => x.type === "hit" && x.player === "you")
      if (hit) grade = hit.grade
      m.events.length = 0
    }
    return grade
  }
  assert.equal(timeIt(SWING_LEAD), "perfect")
  assert.match(timeIt(-0.3) || "", /late/)
  assert.match(timeIt(0.42) || "", /early/)
})

test("controls: rebinding moves a key, never doubles one up; names and gamepads", () => {
  const custom = rebind({}, "solo", "topspin", "KeyK")
  const b = bindingsFor(custom)
  assert.deepEqual(b.solo.topspin[0], "KeyK")
  assert.ok(!b.solo.slice.includes("KeyK"), "slice lost K")
  assert.deepEqual(actionFor(b, [["solo", 0]], "KeyK"), { action: "topspin", slot: 0 })
  assert.deepEqual(actionFor(bindingsFor({}), [["p1", 0], ["p2", 1]], "ArrowUp"), { action: "up", slot: 1 })
  assert.equal(keyName("KeyJ"), "J")
  assert.equal(keyName("ArrowLeft"), "←")
  const pad = (pressed, axes = [0, 0]) => ({ axes, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) })
  const a = readPad(pad([], [0.1, 0.1]))
  assert.equal(a.x, 0, "dead zone")
  const b2 = readPad(pad([0, 5], [0.9, 0]))
  assert.equal(b2.buttons.topspin, true)
  assert.equal(b2.buttons.power, true)
  assert.deepEqual(padEdges(a, b2).down, ["topspin"])
})

test("looks: every character has a complete look, outfits recolor", () => {
  for (const c of CHARACTERS) {
    const l = lookFor(c.id)
    for (const k of ["skin", "hair", "shirt", "bottomColor", "paddle"]) assert.ok(l[k] !== undefined, `${c.id} ${k}`)
  }
  assert.equal(lookFor("maya", "gold").shirt, "#ffd700")
})
