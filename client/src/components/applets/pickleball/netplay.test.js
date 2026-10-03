// Online play tests for Pickleball 98: snapshots round-trip, and whole matches between a
// host and a guest over a simulated network (latency, jitter, dropped snapshots) finish
// with the same score on both screens, with the guest playing real shots.
// Run: node --test client/src/components/applets/pickleball/
import test from "node:test"
import assert from "node:assert/strict"
import { createHost, createGuest, encodeSnap, onlineRoster, packStrike, unpackStrike, projectBall } from "./netplay.js"
import { createMatch, step, advance, autopilot, strike, playerById, scenario } from "./match.js"
import { STEP } from "./physics.js"
import { seeded } from "./match.js"

test("rosters: seats alternate sides, computer players fill doubles", () => {
  const two = onlineRoster([{ seat: 0, name: "A" }, { seat: 1, name: "B" }], { doubles: false })
  assert.equal(two.doubles, false)
  assert.deepEqual(two.roster.map((r) => [r.id, r.team, r.ctrl]), [["p0", 0, "remote"], ["p1", 1, "remote"]])
  const d2 = onlineRoster([{ seat: 0, name: "A" }, { seat: 1, name: "B" }], { doubles: true })
  assert.deepEqual(d2.roster.map((r) => [r.team, r.ctrl]), [[0, "remote"], [0, "cpu"], [1, "remote"], [1, "cpu"]])
  const three = onlineRoster([{ seat: 0 }, { seat: 1 }, { seat: 2 }], { doubles: false })
  assert.equal(three.doubles, true, "three people make it doubles")
  assert.deepEqual(three.roster.map((r) => r.id), ["p0", "p2", "p1", "cpu11"])
})

test("snapshots are small, finite JSON; strikes survive packing and bad ones are refused", () => {
  const m = createMatch({ doubles: true, seed: 2 })
  m.autoplay = true
  for (let i = 0; i < 240 * 6; i++) step(m)
  const snap = encodeSnap(m, m.events.slice(-10))
  const json = JSON.stringify(snap)
  assert.ok(json.length < 4000, `snapshot is ${json.length} bytes`)
  assert.deepEqual(JSON.parse(json), snap)
  scenario(m, "kitchen")
  const you = playerById(m, "you")
  const s = strike(m, you)
  const back = unpackStrike(JSON.parse(JSON.stringify(packStrike(s))))
  assert.ok(Math.abs(back.ball.v.z - s.ball.v.z) < 0.01)
  assert.equal(back.kind, s.kind)
  assert.equal(unpackStrike({ ...packStrike(s), b: [0, 0, 0, 300, 0, 0, 0, 0, 0] }), null, "absurd speed refused")
  assert.equal(unpackStrike({ t: 1 }), null)
})

test("projectBall flies and bounces like the match does", () => {
  const ball = { p: { x: 0, y: 1.5, z: 3 }, v: { x: 0, y: 3, z: -6 }, w: { x: 0, y: 0, z: 0 } }
  projectBall(ball, 1)
  assert.ok(ball.p.z < 0 && ball.p.y > 0 && Number.isFinite(ball.p.x))
})

// two browsers: the host (seat 0) and a guest (seat 1), messages delayed `ms` each way
// frames: each computer's frame times in ms (a slow one skips and stutters)
const playOnline = ({ doubles, ms, jitter, drop, seed, maxMinutes = 45, hostFrame = () => 1000 / 60, guestFrame = () => 1000 / 60 }) => {
  const rand = seeded(seed)
  const people = [{ seat: 0, name: "Host" }, { seat: 1, name: "Guest" }]
  const { roster, doubles: d } = onlineRoster(people, { doubles, level: "intermediate" })
  const hostRoster = roster.map((r) => (r.seat === 0 ? { ...r, ctrl: "human", slot: 0 } : r))
  const settings = { doubles: d, scoring: "sideout", target: 11, assist: "light" }
  const hm = createMatch({ ...settings, roster: hostRoster, seed })
  const queue = []
  let now = 0
  const later = (fn, volatile) => {
    if (volatile && rand() < drop) return
    queue.push({ at: now + ms + rand() * jitter, fn })
  }
  let guest = null
  const wire = (data) => JSON.parse(JSON.stringify(data)) // copied when sent, like a socket
  const host = createHost(hm, { snap: (data) => { const d = wire(data); later(() => guest.onSnap(d, now), true) }, relay: () => {} })
  guest = createGuest({ ...settings, roster, me: "p1", send: { input: (data) => { const d = wire(data); later(() => host.onInput(d, 1), true) }, relay: (data) => { const d = wire(data); later(() => host.onRelay(d, 1), false) } } })
  const gm = guest.m
  let guestHits = 0
  let accepted = 0
  const origRelay = host.onRelay
  host.onRelay = (data, seat) => {
    const ok = origRelay(data, seat)
    if (ok) accepted++
    return ok
  }
  const frame = 1000 / 60
  let hostAt = 0
  let guestAt = 0
  let hostLast = 0
  let guestLast = 0
  while (hm.phase !== "over" && now < maxMinutes * 60000) {
    now += 4
    if (now >= hostAt) {
      // like the engine: a long frame runs at most 0.1 s of play
      autopilot(hm, 0, { rand, jitter: 0.09 })
      advance(hm, (now - hostLast) / 1000)
      host.capture(hm.events)
      hm.events.length = 0
      host.tick(now - hostLast)
      hostLast = now
      hostAt = now + hostFrame(rand)
    }
    queue.sort((a, b) => a.at - b.at)
    while (queue.length && queue[0].at <= now) queue.shift().fn()
    if (now >= guestAt) {
      autopilot(gm, 0, { rand, jitter: 0.09 })
      guest.tick(Math.min(100, now - guestLast), now)
      for (const e of gm.events) if (e.type === "hit" && e.player === "p1") guestHits++
      gm.events.length = 0
      guestLast = now
      guestAt = now + guestFrame(rand)
    }
  }
  const rtt = guest.rtt
  // let the last snapshots arrive
  for (let i = 0; i < 30; i++) {
    now += frame
    host.tick(frame)
    queue.sort((a, b) => a.at - b.at)
    while (queue.length && queue[0].at <= now) queue.shift().fn()
  }
  if (process.env.PK_DEBUG) console.log(JSON.stringify({ score: hm.game.score, guestHits, accepted, faults: hm.stats.faults, shots: hm.stats.shots, rallies: hm.stats.rallies }))
  return { hm, gm, guestHits, accepted, rtt }
}

test("an online singles match over a 70 ms link finishes, the guest really plays, both see the same score", () => {
  const { hm, gm, guestHits, accepted, rtt } = playOnline({ doubles: false, ms: 70, jitter: 25, drop: 0.05, seed: 7 })
  assert.equal(hm.phase, "over", "the match finished")
  const [a, b] = hm.game.score
  assert.ok(Math.max(a, b) >= 11 && Math.abs(a - b) >= 2, `final ${a}-${b}`)
  assert.deepEqual(gm.game.score, hm.game.score, "the guest sees the final score")
  assert.ok(guestHits > 40, `the guest hit the ball ${guestHits} times`)
  assert.ok(accepted / guestHits > 0.9, `the host took ${accepted} of ${guestHits} guest shots`)
  assert.ok(rtt > 0.1 && rtt < 0.3, `round trip measured ${rtt}`)
  // the network didn't decide points: no balls "out of play" and the guest won some rallies
  assert.ok(!hm.stats.faults["Ball out of play"], "no stuck balls")
  assert.ok(hm.stats.shots > hm.stats.rallies * 2.5, `real rallies: ${hm.stats.shots} shots in ${hm.stats.rallies} rallies`)
})

test("online doubles (each person with a computer partner) over a slow 150 ms link", () => {
  const { hm, gm, guestHits, accepted } = playOnline({ doubles: true, ms: 150, jitter: 40, drop: 0.1, seed: 9 })
  assert.equal(hm.phase, "over")
  assert.deepEqual(gm.game.score, hm.game.score)
  assert.ok(guestHits > 20, `guest hits: ${guestHits}`)
  assert.ok(accepted / guestHits > 0.85, `accepted ${accepted}/${guestHits}`)
  assert.ok(!hm.stats.faults["Two-bounce rule"], "the network never turns a groundstroke into a volley")
})

test("slow computers (stuttering frames on both ends) don't cost anyone points", () => {
  const stutter = (lo, hi) => (rand) => (rand() < 0.15 ? hi : lo + rand() * (hi - lo) * 0.3)
  const { hm, gm, guestHits, accepted } = playOnline({ doubles: false, ms: 90, jitter: 30, drop: 0.08, seed: 13, hostFrame: stutter(16, 70), guestFrame: stutter(16, 160) })
  assert.equal(hm.phase, "over")
  assert.deepEqual(gm.game.score, hm.game.score)
  assert.ok(guestHits > 30, `guest hits: ${guestHits}`)
  assert.ok(accepted / guestHits > 0.9, `accepted ${accepted}/${guestHits}`)
  assert.ok(!hm.stats.faults["Two-bounce rule"], `two-bounce faults: ${hm.stats.faults["Two-bounce rule"]}`)
  assert.ok(!hm.stats.faults["Wrong receiver"] && !hm.stats.faults["Served from the wrong court"], JSON.stringify(hm.stats.faults))
})
