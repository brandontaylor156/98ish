// Pickleball 98 practice: the ball machine, drills, lessons, shot labels and hints.
// Run: node --test client/src/components/applets/pickleball/practice/practice-hub.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { createMatch, step, autopilot, seeded } from "../match.js"
import { STEP, HALF_L, HALF_W, solveShot, predictPath, v3 } from "../physics.js"
import { LEVELS } from "../ai.js"
import { DEFAULT_MACHINE, SHOTS, feedInterval, machineSummary, normalizeMachine, planFeed } from "./machine.js"
import { classifyShot, hintFor, HINTS } from "./classify.js"
import { ZONE_SETS, zoneAt, zonesFor } from "./targets.js"
import { createSession, machineSpec, starsFor, trainMatch } from "./session.js"
import { DRILLS, drillScore, drillStars } from "./drillbook.js"
import { LESSONS, nextLesson, suggestedLesson } from "./lessons.js"

// run a session with the stand-in player (real button timing) until it's done
const run = (spec, { seconds = 200, seed = 3, every } = {}) => {
  const rand = seeded(seed)
  const m = createMatch({ ...trainMatch(spec, { rand }), seed })
  const events = []
  for (let i = 0; i < seconds / STEP && !m.practice.state.done; i++) {
    if (i % 4 === 0) autopilot(m, 0, { rand, jitter: 0.1, level: LEVELS.pro })
    every?.(m, i)
    step(m)
    for (const e of m.events) if (e.type === "drill" || (e.type === "hit" && e.player === "machine")) events.push(e)
    m.events.length = 0
  }
  return { m, st: m.practice.state, snap: m.practice.snap(), events }
}

test("machine settings: defaults, bad saves fixed, the summary line, feed interval", () => {
  assert.deepEqual(normalizeMachine(null), DEFAULT_MACHINE)
  const n = normalizeMachine({ shot: "nope", speed: "warp", rate: 999, balls: -3, spin: "top", place: "bh", targets: "off" })
  assert.equal(n.shot, "dink")
  assert.equal(n.speed, "medium")
  assert.equal(n.rate, 40)
  assert.equal(n.balls, 5)
  assert.equal(n.spin, "top")
  assert.equal(machineSummary(n), "Topspin · Backhand · 40 a minute · 5 balls · No targets")
  assert.equal(feedInterval({ rate: 20 }), 3)
})

test("machine feeds: every shot type lands on your side, over the net, where it was planned", () => {
  const rand = seeded(7)
  for (const shot of SHOTS) {
    for (const speed of ["slow", "medium", "fast"]) {
      for (let i = 0; i < 8; i++) {
        const f = planFeed({ shot: shot.id, speed, spin: ["none", "top", "slice"][i % 3] }, { index: i, rand })
        assert.ok(f.target.z > 0 && f.target.z < HALF_L, `${shot.id} ${f.kind}: on your side`)
        assert.ok(Math.abs(f.target.x) < HALF_W, `${shot.id}: inside the sidelines`)
        assert.ok(f.at.z < 0 && f.you.z > 0, "machine over there, you here")
        const s = solveShot(v3(f.from.x, f.from.y, f.from.z), f.target, { ...f.mode, spin: f.spin, minClear: f.minClear })
        assert.ok(s.clearance > 0, `${shot.id} ${speed} ${f.kind}: clears the net (${s.clearance})`)
        // where it really bounces (fast speed-ups are aimed behind you: they'd land deep)
        const path = predictPath({ p: v3(f.from.x, f.from.y, f.from.z), v: s.v, w: s.w }, { maxT: 4, maxBounces: 1 })
        const b = path.find((p) => p.bounce)
        if (f.kind !== "fast") assert.ok(b && Math.hypot(b.x - f.target.x, b.z - f.target.z) < 0.5, `${shot.id} ${speed} ${f.kind} lands near its target`)
      }
    }
  }
})

test("machine feeds: speed, placement, alternate, left-handers, two-bounce counts", () => {
  const speedOf = (speed) => {
    const f = planFeed({ shot: "drive", speed }, { rand: () => 0.5 })
    return f.mode.speed
  }
  assert.ok(speedOf("slow") < speedOf("medium") && speedOf("medium") < speedOf("fast"))
  const dinkApex = (speed) => planFeed({ shot: "dink", speed }, { rand: () => 0.5 }).mode.apex
  assert.ok(dinkApex("slow") > dinkApex("fast"), "a fast dink is flatter")
  const at = (place, hand = 1, index = 0) => {
    const f = planFeed({ shot: "dink", place }, { rand: () => 0.5, hand, index })
    return f.target.x - f.you.x
  }
  assert.ok(at("fh") > 0.3 && at("bh") < -0.3, "forehand is your right")
  assert.ok(at("fh", -1) < -0.3, "a left-hander's forehand is the other way")
  assert.ok(Math.abs(at("middle")) < 0.2)
  assert.ok(Math.sign(at("alternate", 1, 0)) !== Math.sign(at("alternate", 1, 1)), "alternate switches sides")
  assert.equal(planFeed({ shot: "drop" }).hits, 2, "third-shot feeds are the return: your shot must bounce first")
  assert.equal(planFeed({ shot: "dink" }, { feed: "serve" }).hits, 1)
  const mix = new Set(Array.from({ length: 60 }, (_, i) => planFeed({ shot: "mix" }, { rand: seeded(i), index: i }).kind))
  assert.ok(mix.has("dink") && mix.has("float") && mix.has("fast"), [...mix].join())
  assert.equal(planFeed({ shot: "dink" }, { feed: "transition" }).you.z, 4.4)
})

test("shot labels: one word for each outcome, and a hint only when a mistake repeats", () => {
  const shot = (kind, extra = {}) => ({ kind, tag: kind, attackable: false, speed: 8, ...extra })
  assert.equal(classifyShot({ outcome: "in", shot: shot("drop") }).text, "Drop")
  assert.equal(classifyShot({ outcome: "in", shot: shot("dink") }).text, "Dink")
  assert.equal(classifyShot({ outcome: "in", shot: shot("drive") }).text, "Drive")
  assert.equal(classifyShot({ outcome: "in", shot: shot("dink", { attackable: true }) }).text, "Pop-up")
  assert.equal(classifyShot({ outcome: "in", shot: shot("reset", { tag: "popup" }) }).text, "Pop-up")
  assert.equal(classifyShot({ outcome: "out", shot: shot("drive"), landing: { x: 0, z: -7.5 } }).text, "Out")
  assert.equal(classifyShot({ outcome: "out", shot: shot("drive"), landing: { x: 3.4, z: -3 } }).text, "Wide")
  assert.equal(classifyShot({ outcome: "net", shot: shot("dink") }).text, "Net")
  assert.equal(classifyShot({ outcome: "miss", shot: null }).text, "Missed")
  assert.equal(classifyShot({ outcome: "fault", shot: shot("punch"), fault: "Momentum into the kitchen" }).text, "Kitchen fault")
  const r = (outcome, s) => ({ outcome, shot: s, label: classifyShot({ outcome, shot: s }) })
  assert.equal(hintFor([r("net", shot("dink"))]), null, "one mistake: no hint")
  assert.equal(hintFor([r("net", shot("dink")), r("in", shot("dink")), r("net", shot("dink"))]), HINTS["net-soft"])
  assert.equal(hintFor([r("in", shot("dink", { attackable: true })), r("in", shot("dink", { attackable: true }))]), "Too high: aim lower over the net, a quick soft tap.")
  assert.equal(hintFor([r("in", shot("dink", { grade: "late" })), r("in", shot("dink", { grade: "very late" }))]), HINTS.late)
  assert.equal(hintFor([r("net", shot("dink")), r("in", shot("dink")), r("in", shot("dink"))]), null, "fixed: no hint")
})

test("target zones: landings score their zone's points", () => {
  assert.equal(zoneAt({ x: -2, z: -1 }, ZONE_SETS.kitchen).id, "k-cross")
  assert.equal(zoneAt({ x: 0, z: -1 }, ZONE_SETS.kitchen).pts, 1)
  assert.equal(zoneAt({ x: 0, z: -4 }, ZONE_SETS.kitchen), null)
  assert.equal(zoneAt({ x: -1, z: -6.2 }, ZONE_SETS.serve).id, "sv-deep")
  assert.equal(zoneAt({ x: 1, z: -6.2 }, ZONE_SETS.serve), null, "the wrong box")
  for (const s of SHOTS) assert.ok(zonesFor(s.id).length >= 2, s.id)
  for (const set of Object.values(ZONE_SETS)) for (const z of set) assert.ok(z.z1 <= 0 && z.x0 < z.x1 && z.z0 < z.z1, z.id)
})

test("ball machine session: feeds every ball at its rate, counts every one, stats add up, then stops", () => {
  const spec = machineSpec({ shot: "dink", balls: 12, rate: 20 })
  const { st, snap, events } = run(spec, { seconds: 120 })
  assert.ok(st.done, `done (${st.attempts})`)
  assert.equal(st.attempts, 12)
  assert.equal(st.fedN, 12, "no extra balls")
  const c = snap.counts
  assert.equal(c.in + c.out + c.net + c.miss + c.fault, 12)
  assert.ok(c.in >= 6, `the stand-in got most in (${JSON.stringify(c)})`)
  assert.ok(snap.accuracy > 0 && snap.avgMph > 0)
  const feeds = events.filter((e) => e.type === "hit").map((e) => e.t)
  for (let i = 1; i < feeds.length; i++) assert.ok(feeds[i] - feeds[i - 1] >= 3 - 1e-6, `rate kept (${(feeds[i] - feeds[i - 1]).toFixed(2)} s)`)
  const results = events.filter((e) => e.result)
  assert.equal(results.length, 12)
  assert.ok(results.every((e) => e.result.label && e.result.label.text), "every shot labelled")
  assert.ok(st.points > 0, "target zones scored")
  assert.equal(events.at(-1).done, true)
})

test("ball machine session: each shot type runs; paused means no time passes and nothing is fed", () => {
  for (const shot of SHOTS) {
    const { st } = run(machineSpec({ shot: shot.id, balls: 5, rate: 30, targets: "off" }), { seconds: 90 })
    assert.ok(st.done && st.attempts === 5, `${shot.id}: ${st.attempts}`)
    assert.equal(st.points, 0, "no zones, no points")
  }
  const rand = seeded(2)
  const m = createMatch({ ...trainMatch(machineSpec({ shot: "drive" }), { rand }), seed: 2 })
  for (let i = 0; i < 240; i++) step(m)
  m.paused = true
  const t = m.practice.state.t
  for (let i = 0; i < 2400; i++) step(m)
  assert.equal(m.practice.state.t, t)
  assert.equal(m.practice.state.fedN, 0)
})

test("drills: each one runs to its end, scores and earns stars", () => {
  for (const d of DRILLS) {
    const { st, snap } = run({ id: d.id, ...d.spec }, { seconds: 220 })
    assert.ok(st.done, `${d.id} finished (${st.attempts} tries, ${st.t.toFixed(0)} s)`)
    assert.ok(st.t <= (d.spec.time || 999) + 5, `${d.id} within its time`)
    assert.ok(d.spec.time <= 180 && d.stars.length === 3 && d.stars[0] < d.stars[1] && d.stars[1] < d.stars[2], d.id)
    const stars = drillStars(d, snap)
    assert.ok(stars >= 0 && stars <= 3)
    assert.equal(stars, starsFor(drillScore(d, snap), d.stars))
  }
})

test("drills: the stand-in plays well enough for a star where it can (no move-in or split-step: it doesn't)", () => {
  const got = Object.fromEntries(DRILLS.map((d) => [d.id, drillStars(d, run({ id: d.id, ...d.spec }, { seconds: 220 }).snap)]))
  for (const id of ["serve", "dink", "reset", "hands", "smash"]) assert.ok(got[id] >= 1, `${id}: ${got[id]}`)
  assert.equal(got.return, 0, "it never runs in after a return")
})

test("split-step drill: a cue as the machine hits; being still then counts, moving doesn't", () => {
  const d = DRILLS.find((x) => x.id === "split")
  const { events } = run({ id: d.id, ...d.spec }, { seconds: 60 })
  assert.ok(events.some((e) => e.cue === "split"))
  const r = (split, outcome = "in") => d.spec.judge({ outcome, fed: { split }, shot: { kind: "dink" } })
  assert.equal(r(true).ok, true)
  assert.equal(r(false).ok, false)
  assert.match(r(false).msg, /stop/)
})

test("lessons: each judges shots the way a coach would", () => {
  const L = Object.fromEntries(LESSONS.map((l) => [l.id, l]))
  const shot = (kind, extra = {}) => ({ kind, tag: kind, attackable: false, speed: 6, ...extra })
  const j = (id, r) => L[id].spec.judge(r)
  assert.equal(j("basics", { outcome: "in", shot: shot("drive") }).ok, true)
  assert.match(j("basics", { outcome: "net", shot: shot("drive") }).msg, /net/i)
  assert.equal(j("two-bounce", { outcome: "in", shot: shot("return"), volley: false }).ok, true)
  assert.match(j("two-bounce", { outcome: "fault", shot: shot("return"), volley: true }).msg, /bounce/)
  assert.equal(j("serve", { outcome: "in", zone: "sv-deep", shot: shot("serve") }).ok, true)
  assert.match(j("serve", { outcome: "in", zone: "sv-box", shot: shot("serve") }).msg, /short/i)
  const deep = { x: -1, z: -6 }
  assert.equal(j("return", { outcome: "in", shot: shot("return"), landing: deep, moveIn: 3 }).ok, true)
  assert.match(j("return", { outcome: "in", shot: shot("return"), landing: deep, moveIn: 0.5 }).msg, /run up/)
  assert.equal(j("drop", { outcome: "in", shot: shot("drop"), landing: { x: 0, z: -1.5 } }).ok, true)
  assert.equal(j("drop", { outcome: "in", shot: shot("drop", { attackable: true }), landing: { x: 0, z: -1.5 } }).msg, "Too high: aim lower over the net.")
  assert.match(j("drop", { outcome: "in", shot: shot("drive", { speed: 16 }), landing: { x: 0, z: -5 } }).msg, /soft/)
  assert.equal(j("kitchen", { outcome: "in", shot: shot("punch"), volley: true }).ok, true)
  assert.match(j("kitchen", { outcome: "fault", shot: shot("punch"), volley: true, fault: "Momentum into the kitchen" }).msg, /stop before the line/)
  assert.equal(j("dink", { outcome: "in", shot: shot("dink"), landing: { x: -1, z: -1 } }).ok, true)
  assert.equal(j("speedup", { outcome: "in", fed: { float: true }, shot: shot("speedup") }).ok, true)
  assert.match(j("speedup", { outcome: "in", fed: { float: false }, shot: shot("speedup") }).msg, /low/)
  assert.match(j("speedup", { outcome: "in", fed: { float: true }, shot: shot("dink") }).msg, /high/)
  assert.equal(j("reset", { outcome: "in", shot: shot("reset"), landing: { x: 0, z: -2 } }).ok, true)
  assert.equal(L.doubles.spec.pointJudge({ level: 0.8 }).ok, true)
  assert.equal(L.doubles.spec.pointJudge({ level: 0.3 }).ok, false)
})

test("lessons: tips are short, every one has a picture and a task; the first ones can be done on court", () => {
  for (const l of LESSONS) {
    const sentences = l.tip.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length
    assert.ok(sentences >= 2 && sentences <= 3, `${l.id}: ${sentences} sentences`)
    assert.ok(l.task.length < 50 && l.diagram && (l.diagram.dots || []).length, l.id)
    assert.ok(l.spec.need >= 1)
  }
  for (const id of ["basics", "two-bounce", "serve", "drop", "kitchen", "dink", "speedup", "reset"]) {
    const l = LESSONS.find((x) => x.id === id)
    const { st } = run({ id, ...l.spec }, { seconds: 240 })
    assert.ok(st.done && st.made >= l.spec.need, `${id}: ${st.made}/${l.spec.need}`)
  }
  assert.equal(nextLesson("basics").id, "two-bounce")
  assert.equal(nextLesson("doubles"), null)
  assert.equal(suggestedLesson({ basics: true }).id, "two-bounce")
})

test("doubles lesson: real points with a partner; each point is judged on moving together", () => {
  const l = LESSONS.find((x) => x.id === "doubles")
  const { m, events } = run({ id: "doubles", ...l.spec }, { seconds: 60 })
  assert.equal(m.players.length, 4)
  assert.equal(m.game.serving, 1, "they serve: you return and come in")
  const pts = events.filter((e) => e.result)
  assert.ok(pts.length >= 2, `${pts.length} points`)
  assert.ok(pts.every((e) => typeof e.result.level === "number"))
})
