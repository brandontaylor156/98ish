// The touch game in Pickleball 98: one hit control (a target and a pace), what a shot gives
// the other side (attackable or not), resets, the computer players' choices, hand battles,
// and whether whole points play like pickleball (dink rallies, speed-ups).
// Run: node --test client/src/components/applets/pickleball/touch.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { HALF_L, NET_H_CENTER } from "./physics.js"
import { ATTACK_H, FAST_BALL, assessBall, judgeShot, paceBand, paceOf, planIntent, playShot } from "./shots.js"
import { LEVELS, aiShot, levelFor, paceThatFits } from "./ai.js"
import { SWING_LEAD, SWING_LEAD_FAST, autopilot, createMatch, leadFor, playerById, press, release, scenario, seeded, step, strike } from "./match.js"

const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z })
// hit a ball at `from` (coming in at `inc`) with a target and a pace; returns plan, ball, assessment
const shoot = (from, inc, target, pace, extra = {}) => {
  const plan = planIntent({ team: 0, from, incoming: inc, target, pace, ...extra })
  const res = playShot({ p: from, v: inc, w: v3() }, plan)
  const a = assessBall(res.ball, 0)
  return { plan, res, a, speed: Math.hypot(res.ball.v.x, res.ball.v.y, res.ball.v.z), judge: judgeShot(plan.kind, a, { contactY: from.y }) }
}
const DINK_IN = v3(0, -1, 4)
const AT_LINE_LOW = v3(0.5, 0.35, 2.4) // a low ball at your kitchen line

test("pace: a tap is soft, a long hold is hard", () => {
  assert.equal(paceBand(paceOf(0.06)), "soft")
  assert.equal(paceBand(paceOf(0.25)), "firm")
  assert.equal(paceBand(paceOf(0.5)), "hard")
  assert.ok(paceOf(0) === 0 && paceOf(5) === 1)
})

test("shot model: a soft touch at the line is a low dink into their kitchen", () => {
  const s = shoot(AT_LINE_LOW, DINK_IN, { x: -1, z: -1.5 }, 0.1)
  assert.equal(s.plan.kind, "dink")
  assert.ok(s.a.kitchen, "lands in their kitchen")
  assert.ok(Math.abs(s.a.landing.z + 1.5) < 0.25 && Math.abs(s.a.landing.x + 1) < 0.25, "near the target")
  assert.ok(s.a.clearance > 0 && s.a.clearance < 0.25, `just over the tape (${s.a.clearance.toFixed(2)} m)`)
  assert.ok(s.speed > 3 && s.speed < 8, `dink speed ${s.speed.toFixed(1)} m/s`)
  assert.equal(s.a.attackable, false)
  assert.equal(s.judge.text, "Unattackable dink")
})

test("shot model: hard from below the net sails long; hard from above it goes down at them", () => {
  const low = shoot(AT_LINE_LOW, DINK_IN, { x: 0.3, z: -3.4 }, 0.9)
  assert.equal(low.plan.kind, "speedup")
  assert.ok(low.res.solved.long, "it had to rise to clear the net")
  assert.ok(Math.abs(low.a.landing.z) > HALF_L, `lands out (${low.a.landing.z.toFixed(1)})`)
  assert.equal(low.judge.tag, "out")
  // the same swing from a ball up at chest height lands in, fast
  const high = shoot(v3(0.5, 1.2, 2.4), DINK_IN, { x: 0.3, z: -3.4 }, 0.9)
  assert.ok(high.a.in, "in")
  assert.ok(high.speed > 15, `fast (${high.speed.toFixed(1)} m/s)`)
  assert.equal(high.judge.text, "Speed-up!")
  // a firm roll from low can land: topspin, less pace
  const roll = shoot(AT_LINE_LOW, DINK_IN, { x: 0.3, z: -3.4 }, 0.4)
  assert.equal(roll.plan.kind, "roll")
  assert.ok(roll.a.in, "a roll from low lands in")
})

test("shot model: drops, drives, resets and lobs from where you are", () => {
  const baseline = v3(0.5, 0.6, HALF_L - 0.1)
  const drop = shoot(baseline, v3(0, -2, 10), { x: 0, z: -1.3 }, 0.1, { shotNo: 3 })
  assert.equal(drop.plan.kind, "drop")
  assert.ok(drop.a.kitchen && !drop.a.attackable, "a clean drop lands low in the kitchen")
  assert.equal(drop.judge.text, "Great drop")
  const drive = shoot(baseline, v3(0, -2, 10), { x: 0, z: -5.6 }, 0.85, { shotNo: 3 })
  assert.equal(drive.plan.kind, "drive")
  assert.ok(drive.speed > 16 && drive.a.in, `a drive: ${drive.speed.toFixed(1)} m/s, in`)
  // soft against a hard ball is a reset
  const reset = shoot(v3(0.5, 0.4, 4.4), v3(0, -1, 16), { x: 0, z: -1.3 }, 0.08)
  assert.equal(reset.plan.kind, "reset")
  assert.ok(reset.a.kitchen && !reset.a.attackable, "a clean reset dies in the kitchen")
  assert.equal(reset.judge.text, "Great reset")
  // soft and deep from the net goes up: a lob
  const lob = shoot(AT_LINE_LOW, DINK_IN, { x: 0.3, z: -5.8 }, 0.25)
  assert.equal(lob.plan.kind, "lob")
  assert.ok(lob.res.solved.apex > 3, "high")
})

test("attackable: a dink that floats up (high and deep) can be hit down; pop-ups are sitters", () => {
  const clean = shoot(AT_LINE_LOW, DINK_IN, { x: -1, z: -1.9 }, 0.1)
  const floaty = shoot(AT_LINE_LOW, DINK_IN, { x: -1, z: -1.9 }, 0.1, { apexAdd: 0.5 })
  assert.ok(!clean.a.attackable)
  assert.ok(floaty.a.attackH > clean.a.attackH + 0.3, "the float is up where they can reach it")
  assert.ok(floaty.a.attackable, `attackable (${floaty.a.attackH.toFixed(2)} m)`)
  assert.equal(floaty.judge.tag, "popup")
  // a ball sent up high toward their kitchen line is a sitter
  const pop = shoot(AT_LINE_LOW, DINK_IN, { x: 0, z: -2.6 }, 0.1, { apexAdd: 1.0 })
  assert.ok(pop.a.popup && pop.judge.text === "Popped up!")
  assert.ok(ATTACK_H > NET_H_CENTER && ATTACK_H < NET_H_CENTER + 0.2)
})

test("resets: absorbing a hard ball is harder than dinking a soft one, and better players do it cleaner", () => {
  // (played the way match.js strike does: the touch wobble, plus the paddle's face and push
  // errors, which grow with the incoming pace; "bad" = floats up where it can be attacked, or
  // finds the net)
  const popRate = (lv, inSpeed, n = 200) => {
    const rand = seeded(7)
    let pops = 0
    for (let i = 0; i < n; i++) {
      const absorb = inSpeed > FAST_BALL ? 1.45 + (inSpeed - FAST_BALL) / 5 : 1
      const hardness = 1 + inSpeed * 0.02
      const from = v3(0.4, 0.5, 2.4)
      const inc = v3(0, -1, inSpeed)
      const plan = planIntent({ team: 0, from, incoming: inc, target: { x: -0.8, z: -1.6 }, pace: 0.08, apexSigma: lv.softTouch * absorb, rand })
      const res = playShot({ p: from, v: inc, w: v3() }, plan, { faceError: lv.face * hardness, touch: lv.touch * hardness, offset: lv.offset, rand })
      const a = assessBall(res.ball, 0)
      if (a.attackable || (a.clearance !== null && a.clearance < 0)) pops++
    }
    return pops / n
  }
  const pro = LEVELS.pro
  const rookie = LEVELS.beginner
  const proHard = popRate(pro, 16)
  const proSoft = popRate(pro, 5)
  const rookieHard = popRate(rookie, 16)
  assert.ok(proHard > proSoft, `a 16 m/s ball pops up more often than a dink (${proHard} vs ${proSoft})`)
  assert.ok(rookieHard > proHard * 1.5, `rookie ${rookieHard} vs pro ${proHard}`)
  assert.ok(proSoft < 0.2, `a pro's dinks rarely float (${proSoft})`)
})

// a doubles point at the net: everyone at the kitchen line, the ball coming to "you"
const atTheNet = (seed = 1) => {
  const m = createMatch({ doubles: true, level: "pro", seed })
  scenario(m, "kitchen")
  for (const p of m.players) p.z = Math.sign(p.z) * 2.55
  m.rally.hits = 8
  return m
}
const intents = (m, p, lv, ball, n = 60, setup = () => {}) => {
  const out = {}
  for (let i = 0; i < n; i++) {
    m.rand = seeded(100 + i)
    setup(m)
    const s = aiShot(m, p, lv, ball)
    out[s.intent] = (out[s.intent] || 0) + 1
  }
  return out
}

test("AI: dinks a low ball, attacks one that's up, resets a hard one", () => {
  const m = atTheNet()
  const p = playerById(m, "you")
  const lv = levelFor("pro")
  const low = intents(m, p, lv, { p: v3(0.5, 0.35, 2.4), v: v3(0, -1, 4) })
  assert.ok((low.dink || 0) >= 50, `low ball: dinks ${JSON.stringify(low)}`)
  const up = intents(m, p, lv, { p: v3(0.5, 1.25, 2.4), v: v3(0, -1, 4) })
  assert.ok((up.speedup || 0) + (up.smash || 0) >= 55, `high ball: attacks ${JSON.stringify(up)}`)
  const fast = intents(m, p, lv, { p: v3(0.5, 0.55, 2.4), v: v3(0, -2, 16) })
  assert.ok((fast.reset || 0) >= 45, `hard ball below the net: resets ${JSON.stringify(fast)}`)
  // a hard ball up at the tape: often countered
  const fastHigh = intents(m, p, lv, { p: v3(0.5, 1.0, 2.4), v: v3(0, -1, 16) })
  assert.ok((fastHigh.counter || 0) >= 20, `hard ball at the tape: counters ${JSON.stringify(fastHigh)}`)
})

test("AI: in the transition zone against net players, a good player plays soft", () => {
  const m = atTheNet(2)
  const p = playerById(m, "you")
  p.z = 4.4
  const pro = intents(m, p, levelFor("pro"), { p: v3(0.4, 0.45, 4.5), v: v3(0, -1, 14) })
  assert.ok((pro.reset || 0) + (pro.drop || 0) >= 45, `pro: ${JSON.stringify(pro)}`)
  const rookie = intents(m, p, levelFor("beginner"), { p: v3(0.4, 0.45, 4.5), v: v3(0, -1, 14) })
  assert.ok((rookie.counter || 0) + (rookie.drive || 0) > (pro.counter || 0) + (pro.drive || 0), `rookies swing more: ${JSON.stringify(rookie)}`)
})

test("AI: patience. Rookies and club players speed up balls that aren't up; pros wait", () => {
  const m = atTheNet(3)
  const p = playerById(m, "you")
  const ball = { p: v3(0.5, 0.4, 2.4), v: v3(0, -1, 4) }
  const attacks = (level) => {
    const r = intents(m, p, levelFor(level), ball, 200, (mm) => (mm.rally.dinks = 6))
    return (r.speedup || 0) + (r.roll || 0) + (r.counter || 0)
  }
  const rookie = attacks("beginner")
  const club = attacks("intermediate")
  const pro = attacks("pro")
  assert.ok(rookie > club && club > pro, `attacks from a low ball: rookie ${rookie}, club ${club}, pro ${pro}`)
  // and when a pro does attack from down there, it's a pace that lands (a roll at the feet)
  assert.equal(paceThatFits(p, ball, { x: 0.3, z: -3.4 }, [0.95]), null, "a full swing from that low doesn't land")
  assert.ok(paceThatFits(p, ball, { x: 0.3, z: -3.4 }, [0.95, 0.74, 0.6, 0.48, 0.4]) !== null)
})

test("hand battles: a compact swing; let go on time to counter, or the ball beats you", () => {
  // a speed-up at you at the kitchen line
  const setup = () => {
    const m = atTheNet(4)
    const you = playerById(m, "you")
    you.x = 0.5
    const from = v3(0.3, 1.0, -2.3)
    const to = v3(0.85, 1.0, 2.4)
    const T = 0.3
    m.ball.p = from
    m.ball.v = v3((to.x - from.x) / T, (to.y - from.y) / T + 0.5 * 9.81 * T, (to.z - from.z) / T)
    m.ball.w = v3()
    m.lastShot = { t: m.t, team: 1, kind: "speedup" }
    m.version++
    return { m, you }
  }
  {
    const { m, you } = setup()
    step(m)
    assert.equal(leadFor(m, you), SWING_LEAD_FAST)
    assert.ok(SWING_LEAD_FAST < SWING_LEAD)
  }
  // paddle up (held early), let go on the beat: a counter, well timed
  const play = (holdFrom, releaseAt) => {
    const { m, you } = setup()
    let hit = null
    let pressed = false
    for (let i = 0; i < 240 && !hit; i++) {
      const e = you.expect
      const ttc = e ? e.at - m.t : 9
      if (!pressed && ttc <= holdFrom) pressed = press(m, 0)
      if (you.charge && ttc <= releaseAt) release(m, 0)
      step(m)
      hit = m.events.find((x) => x.type === "hit" && x.player === "you")
      m.events.length = 0
    }
    return hit
  }
  const counter = play(9, SWING_LEAD_FAST)
  assert.ok(counter, "made contact")
  assert.equal(counter.kind, "counter")
  assert.match(counter.grade, /perfect|good/)
  // a quick late tap: a soft block (a reset)
  const block = play(SWING_LEAD_FAST + 0.06, SWING_LEAD_FAST)
  assert.ok(block && (block.kind === "reset" || block.kind === "punch"), `blocked: ${block?.kind}`)
  // the computer: a rookie's hands are too slow for a ball this quick far more often than a pro's
  const beaten = (level) => {
    let n = 0
    for (let i = 0; i < 80; i++) {
      const { m, you } = setup()
      you.ctrl = "cpu"
      you.level = levelFor(level)
      m.rand = seeded(500 + i)
      m.ball.p = v3(0.85, 1.0, 2.35)
      m.lastShot.t = m.t - 0.32 // it got here a third of a second after their swing
      const s = strike(m, you)
      if (!s || /late/.test(s.grade)) n++
    }
    return n
  }
  assert.ok(beaten("beginner") > beaten("pro") + 20, `late or beaten: rookie ${beaten("beginner")}, pro ${beaten("pro")}`)
})

test("points play like pickleball: pros dink and speed up, rookies bang", () => {
  const play = (level) => {
    const m = createMatch({ doubles: true, level, seed: 31, target: 7, roster: [["a1", 0], ["a2", 0], ["b1", 1], ["b2", 1]].map(([id, team]) => ({ id, team, ctrl: "cpu", level })) })
    for (let i = 0; i < 240 * 60 * 15 && m.phase !== "over"; i++) {
      step(m)
      m.events.length = 0
    }
    assert.equal(m.phase, "over", `${level} finished`)
    const f = m.stats.feel
    const R = m.stats.rallies
    return { len: m.stats.shots / R, dinks: f.dinks / R, speedups: (f.speedups + f.counters) / R, thirdDrops: f.thirdDrops }
  }
  const pro = play("pro")
  const rookie = play("beginner")
  assert.ok(pro.len > rookie.len * 1.8, `rally length: pro ${pro.len.toFixed(1)}, rookie ${rookie.len.toFixed(1)}`)
  assert.ok(pro.dinks > 3, `pros dink (${pro.dinks.toFixed(1)} a rally)`)
  assert.ok(rookie.dinks < 1, `rookies hardly dink (${rookie.dinks.toFixed(1)})`)
  assert.ok(pro.speedups > 0.4, `pros speed up (${pro.speedups.toFixed(2)} a rally)`)
  assert.ok(pro.thirdDrops > 0)
})

test("a person's stand-in (only the hit control, aim and timing) plays real points against the computer", () => {
  const rand = seeded(9)
  const m = createMatch({ doubles: false, level: "intermediate", seed: 9, target: 7 })
  let dinks = 0
  for (let i = 0; i < 240 * 60 * 15 && m.phase !== "over"; i++) {
    if (i % 2 === 0) autopilot(m, 0, { rand, jitter: 0.04 })
    step(m)
    for (const e of m.events) if (e.type === "hit" && e.player === "you" && e.kind === "dink") dinks++
    m.events.length = 0
  }
  assert.equal(m.phase, "over")
  assert.ok(m.stats.teams[0].shots >= m.stats.rallies, `you hit plenty (${m.stats.teams[0].shots} shots in ${m.stats.rallies} rallies)`)
  assert.ok(m.stats.longest >= 5, `real rallies (longest ${m.stats.longest})`)
  assert.ok(dinks > 0, "and dinked")
})
