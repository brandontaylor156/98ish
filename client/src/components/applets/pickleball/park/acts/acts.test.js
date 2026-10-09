// My Park activities (park/acts/): where they are (only at sourced places), tennis, hoops, the
// workout's scoring, the TV's sources, the stats.
// node --test client/src/components/applets/pickleball/park/acts/acts.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { venueLayoutSpec } from "../venuegen.js"
import { makeLayout, setLayout } from "../layout.js"
import { ACT_SOURCES, activitySpots, nearestSpot, spotSummary } from "./spots.js"
import { BALL, COURT, DT, createTennis, inBox, landing, netCross, netHeight, planShot, pointWords, scorePoint, serveBox, swipeAim } from "./tennis.js"

const IDS = ["loscab", "newport", "wolfbear", "whittier", "paseo", "sinaloa", "smash", "bouquet"]
const spec = (id) => JSON.parse(readFileSync(new URL(`../venues/${id}.json`, import.meta.url), "utf8"))
const built = new Map()
const get = (id) => {
  if (!built.has(id)) {
    const ls = venueLayoutSpec(spec(id))
    built.set(id, { ls, L: makeLayout(ls) })
  }
  return built.get(id)
}

// a flood fill over open ground from the arrival (as venues.test.js does for the ways in)
const reachFrom = (L, start, targets, G = 0.5) => {
  const xs = [start.x, ...targets.map((t) => t.x)]
  const zs = [start.z, ...targets.map((t) => t.z)]
  const x0 = Math.min(...xs) - 12
  const z0 = Math.min(...zs) - 12
  const nx = Math.ceil((Math.max(...xs) + 12 - x0) / G)
  const nz = Math.ceil((Math.max(...zs) + 12 - z0) / G)
  const open = new Uint8Array(nx * nz)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) open[j * nx + i] = (L.heightAt(x0 + i * G, z0 + j * G, 0) ?? 1) === 0 && !L.blocked(x0 + i * G, z0 + j * G, 0.3) ? 1 : 0
  const seen = new Uint8Array(nx * nz)
  const idx = (x, z) => Math.round((z - z0) / G) * nx + Math.round((x - x0) / G)
  const q = [idx(start.x, start.z)]
  seen[q[0]] = 1
  while (q.length) {
    const c = q.pop()
    const i = c % nx
    const j = (c / nx) | 0
    for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue
      const n = b * nx + a
      if (open[n] && !seen[n]) {
        seen[n] = 1
        q.push(n)
      }
    }
  }
  return (t, ring = 1.5) => {
    for (let dz = -ring; dz <= ring; dz += G) for (let dx = -ring; dx <= ring; dx += G) if (seen[idx(t.x + dx, t.z + dz)]) return true
    return false
  }
}

test("activities only where the venue has the place: OSM courts, the packs' rooms, the owner's word", () => {
  const want = {
    loscab: { tennis: 13, hoops: 1, workout: 1, tv: 2 },
    newport: { tennis: 12, hoops: 0, workout: 0, tv: 0 },
    wolfbear: { tennis: 0, hoops: 0, workout: 0, tv: 0 },
    whittier: { tennis: 12, hoops: 0, workout: 0, tv: 1 },
    paseo: { tennis: 11, hoops: 0, workout: 2, tv: 3 },
    sinaloa: { tennis: 0, hoops: 8, workout: 0, tv: 0 },
    smash: { tennis: 0, hoops: 0, workout: 0, tv: 4 },
    bouquet: { tennis: 0, hoops: 1, workout: 0, tv: 0 },
  }
  for (const id of IDS) {
    const { ls, L } = get(id)
    setLayout(L)
    const S = ls.scene
    const spots = activitySpots(L)
    assert.deepEqual(spotSummary(spots), want[id], id)
    const src = ACT_SOURCES[id] || {}
    for (const s of spots) {
      // every one says where it comes from
      assert.ok(typeof s.src === "string" && s.src.length > 10, `${id} ${s.id}: a source`)
      if (s.kind === "tennis") assert.ok(S.courts.some((c) => c.s === "t" && Math.abs(c.x - s.frame.x) < 0.01 && Math.abs(c.z - s.frame.z) < 0.01), `${id} ${s.id}: on a tennis court in the data`)
      if (s.kind === "hoops") assert.ok(s.room ? src.hoops?.rooms?.includes(s.room) : S.courts.some((c) => c.s === "b" && Math.abs(c.x - s.frame.x) < 0.01), `${id} ${s.id}: a basketball court in the data or a sourced room`)
      if (s.kind === "workout") assert.ok(src.workout?.rooms?.includes(s.room), `${id} ${s.id}: a sourced gym`)
      if (s.kind === "tv") assert.ok(s.room ? !!src.tv?.rooms?.[s.room] : !!src.tv?.loose, `${id} ${s.id}: a sourced TV`)
      // room to stand where you walk up
      assert.ok(!L.blocked(s.x, s.z, 0.3), `${id} ${s.id}: open ground at the spot`)
    }
    // (Newport's lounge TV isn't in its pack: no Watch there)
    if (id === "newport") assert.ok(!spots.some((s) => s.kind === "tv"))
    // every spot can be walked to from the arrival (ground-floor ones)
    const ground = spots.filter((s) => !s.y)
    if (ground.length) {
      const reach = reachFrom(L, L.SPAWN, ground)
      for (const s of ground) assert.ok(reach(s), `${id} ${s.id} (${s.name}) can't be reached from the arrival`)
    }
    // the context button: the nearest spot in reach
    for (const s of spots) assert.equal(nearestSpot(spots, s.x, s.z, s.y)?.spot.kind, s.kind)
  }
  // Los Cab's indoor gym: a regulation court in the middle of the sourced room, hoops at its ends
  const lc = get("loscab").ls.scene
  const gym = lc.rooms.find((r) => r.id === "bigGym")
  const hoops = gym.props.filter((p) => p.t === "hoop")
  assert.equal(hoops.length, 2)
  assert.ok(Math.abs(Math.hypot(hoops[0].x - hoops[1].x, hoops[0].z - hoops[1].z) - 2 * (14 - 1.575 + 0.85)) < 0.01, "hoops 28 m court apart")
  assert.ok(gym.props.filter((p) => p.t === "courtline").length > 40, "the court's lines")
  // the gyms with TVs in their packs have them; the others don't
  assert.ok(lc.rooms.find((r) => r.id === "fitness").props.some((p) => p.t === "tv"))
  assert.ok(!get("paseo").ls.scene.rooms.find((r) => r.id === "pcPerf").props.some((p) => p.t === "tv"))
})

test("tennis: the ball flies where it's aimed, clears the net, the court's rules", () => {
  // a groundstroke from the baseline lands within a few cm of its target, over the net
  for (const [pace, tz] of [[0.2, -9], [0.5, -6], [0.9, -10.5]]) {
    const from = { x: 0.5, y: 0.9, z: 11.5 }
    const s = planShot(from, { x: -2, z: tz }, { speed: 15 + pace * 17, spin: 70 + pace * 170, clear: 0.15 })
    assert.ok(Math.hypot(s.land.x + 2, s.land.z - tz) < 0.2, `lands where aimed (${pace})`)
    const n = netCross({ p: { ...from }, v: s.v, w: s.w })
    assert.ok(n.y > netHeight(n.x) + 0.1, "over the net")
  }
  // topspin dips: the same launch with spin lands shorter
  const flat = landing({ p: { x: 0, y: 1, z: 11 }, v: { x: 0, y: 3, z: -25 }, w: { x: 0, y: 0, z: 0 } })
  const top = landing({ p: { x: 0, y: 1, z: 11 }, v: { x: 0, y: 3, z: -25 }, w: { x: -200, y: 0, z: 0 } })
  assert.ok(top.z > flat.z + 1, "topspin brings it down sooner")
  // the net: 0.914 m in the middle, 1.07 m at the posts
  assert.equal(netHeight(0), COURT.NET)
  assert.ok(Math.abs(netHeight(COURT.POST_X) - COURT.POST_NET) < 1e-9)
  // the serve goes diagonally into the service box
  const box = serveBox(0, true)
  assert.ok(box.aim.x < 0 && box.aim.z < 0 && inBox(box, box.aim.x, box.aim.z))
  assert.ok(!inBox(box, 1, -3), "the other box is out")
  // a swipe's aim: straight up deep down the middle; to the right is +x for the near player
  assert.ok(Math.abs(swipeAim(0, { u: 0, depth: 1, pace: 0.5 }).x) < 1e-9 && swipeAim(0, { u: 0, depth: 1 }).z < -9)
  assert.ok(swipeAim(0, { u: 1, depth: 0.5 }).x > 3 && swipeAim(1, { u: 1, depth: 0.5 }).x < -3)
  // the score: 15, 30, 40, no-ad (40-40: the next point wins), first to 4 games
  let sc = { points: [0, 0], games: [0, 0], server: 0, faults: 0, game: null, winner: null }
  for (let i = 0; i < 3; i++) sc = scorePoint(sc, 0)
  assert.equal(pointWords(sc.points, 0), "40-0")
  for (let i = 0; i < 3; i++) sc = scorePoint(sc, 1)
  assert.equal(pointWords(sc.points, 0), "Deciding point")
  sc = scorePoint(sc, 1)
  assert.deepEqual(sc.games, [0, 1])
  assert.equal(sc.server, 1, "the serve changes with the game")
  for (let g = 0; g < 3; g++) for (let i = 0; i < 4; i++) sc = scorePoint(sc, 1)
  assert.equal(sc.winner, 1)
})

test("tennis: a rally plays out, two bounces and outs end points, nothing moves your player", () => {
  // the computer against the computer: points end, the match ends
  const g = createTennis({ mode: "match", level: "normal", seed: 5, cpu: [true, true] })
  const why = new Set()
  let hits = 0
  for (let i = 0; i < 120 * 60 * 30 && g.state.phase !== "over"; i++) {
    g.step(DT)
    for (const e of g.drain()) {
      if (e.type === "point") why.add(e.why)
      if (e.type === "hit") hits++
    }
  }
  assert.equal(g.state.phase, "over")
  assert.ok(hits > 40)
  assert.ok(why.has("out"))
  // you: with no input your player stays where the point put them, and a swing with no ball whiffs
  const h = createTennis({ mode: "match", seed: 2 })
  const me = h.state.players[0]
  const at = { x: me.x, z: me.z }
  for (let i = 0; i < 120 * 6; i++) h.step(DT)
  assert.ok(Math.hypot(me.x - at.x, me.z - at.z) < 1e-6, "nothing moves you")
  // your swipe serves
  assert.equal(h.state.phase, "serve")
  h.swing(0, { u: 0, pace: 0.4 })
  h.step(DT * 2)
  assert.equal(h.state.phase, "play")
  // the move pad moves you: up is toward the net
  h.input(0, { x: 0, y: 1 })
  for (let i = 0; i < 60; i++) h.step(DT)
  assert.ok(me.z < at.z - 0.5, "toward the net")
  // a ball that bounces twice on your side is their point
  for (let i = 0; i < 120 * 5 && h.state.phase === "play"; i++) h.step(DT)
  const pts = h.drain().filter((e) => e.type === "point")
  assert.ok(pts.length >= 1)
  // the rally challenge counts your shots in a row (a stand-in thumb steers and swipes)
  const r = createTennis({ mode: "rally", seed: 3 })
  let armed = -1
  for (let i = 0; i < 120 * 60; i++) {
    const st = r.state
    const p = st.players[0]
    const b = st.ball
    if (st.phase === "play" && b.live && b.v.z > 0 && st.rally.last !== 0) {
      const tt = (p.z - b.p.z) / b.v.z
      const x = b.p.x + b.v.x * tt
      r.input(0, { x: Math.max(-1, Math.min(1, (x - 0.6 - p.x) * 1.5)), y: 0 })
      if (armed !== st.rally.hits && tt < 0.5 && st.rally.bounces >= 1) {
        armed = st.rally.hits
        r.swing(0, { u: 0, depth: 0.7, pace: 0.3 })
      }
    }
    r.step(DT)
    r.drain()
  }
  assert.ok(r.state.best >= 3, `a rally of ${r.state.best}`)
  // the ball's size and drag are a tennis ball's
  assert.ok(Math.abs(BALL.r - 0.0335) < 1e-9 && BALL.drag > 0.015 && BALL.drag < 0.025)
})

test("tennis online: the host's snapshot puts the guest's game in the same place", () => {
  const host = createTennis({ mode: "match", seed: 11, cpu: [false, false] })
  host.swing(0, { u: 0.2, pace: 0.6 })
  for (let i = 0; i < 40; i++) host.step(DT)
  const snap = host.snapshot()
  assert.ok(JSON.stringify(snap).length < 400, "small")
  const guest = createTennis({ mode: "match", seed: 11, cpu: [false, false] })
  guest.apply(snap)
  assert.equal(guest.state.phase, host.state.phase)
  assert.ok(Math.abs(guest.state.ball.p.z - host.state.ball.p.z) < 0.01)
  assert.deepEqual(guest.state.score.points, host.state.score.points)
})

test("hoops: the ball, the rim, the board; a good swipe goes in, a bad one doesn't", async () => {
  const H = await import("./hoops.js")
  const hoop = H.hoopAt(1, H.HOOP_KINDS.court)
  // a regulation ball dropped from 1.8 m comes back up about 1.2 m
  const b = { p: { x: 0, y: 1.8, z: 0 }, v: { x: 0, y: 0, z: 0 } }
  let down = false
  let top = 0
  for (let t = 0; t < 3; t += H.DT) {
    if (H.stepBall(b, null) === "floor") down = true
    if (down) top = Math.max(top, b.p.y)
    if (down && b.v.y < 0 && top > 0.5) break
  }
  assert.ok(top + H.BALL.r > 1.05 && top + H.BALL.r < 1.45, `bounce ${top}`)
  // the ideal shot goes in from close, the free-throw line, the corner three
  for (const from of [{ x: 0, z: hoop.z - 2.5 }, { x: 0, z: hoop.z - 4.6 }, { x: 6.5, z: hoop.z - 1 }]) assert.ok(H.flyShot(from, H.idealShot(from, hoop).v, hoop).made, `in from ${from.x}, ${from.z}`)
  // a ball dropped onto the rim bounces off it; dropped through the middle, it's a swish
  const rimDrop = H.flyShot({ x: 0.23, z: hoop.z }, { x: 0, y: 4, z: 0 }, hoop)
  assert.ok(rimDrop.rims >= 1)
  const swish = H.flyShot({ x: 0, z: hoop.z }, { x: 0, y: 4, z: 0 }, hoop)
  assert.ok(swish.made && swish.swish)
  // into the backboard: it comes back off it
  const bank = { p: { x: 0, y: 3.4, z: hoop.boardZ - 1.5 }, v: { x: 0, y: 0, z: 6 } }
  let off = false
  for (let t = 0; t < 1; t += H.DT) if (H.stepBall(bank, hoop) === "board") off = true
  assert.ok(off && bank.v.z < 0)
  // a swipe half way up and straight: in most of the time; much too short or long: rarely
  const rate = (from, s, spread = 1) => {
    const rand = H.rng(3)
    let m = 0
    for (let k = 0; k < 120; k++) if (H.flyShot(from, H.swipeShot(from, hoop, s, { rand, spread }).v, hoop).made) m++
    return m / 120
  }
  const ft = { x: 0.6, z: hoop.z - 4.6 }
  assert.ok(rate(ft, { depth: 0.5, u: 0 }) > 0.8, "a good swipe goes in")
  assert.ok(rate(ft, { depth: 0.25, u: 0 }) < 0.15, "short")
  assert.ok(rate(ft, { depth: 0.66, u: 0 }) < 0.5, "a bit long")
  assert.ok(rate(ft, { depth: 0.56, u: 0 }) > 0.8, "a thumb's width off is still just right")
  assert.ok(rate(ft, { depth: 0.5, u: 0.9 }) < 0.2, "wide")
  // the computer: better at higher levels
  assert.ok(rate(ft, { depth: 0.5 }, H.cpuSpread("hard")) > rate(ft, { depth: 0.5 }, H.cpuSpread("easy")))
})

test("hoops: around the world and H-O-R-S-E's rules", async () => {
  const H = await import("./hoops.js")
  const hoop = H.hoopAt(-1)
  // around the world: seven spots round the key on the hoop's side; a make moves you on
  const w = H.createHoopsGame({ mode: "world", hoop })
  assert.equal(w.spots.length, 7)
  for (const p of w.spots) assert.ok(Math.abs(Math.hypot(p.x, p.z - hoop.z) - 4.6) < 0.7 && p.z > hoop.z, "round the key")
  assert.equal(w.canShoot(0, { x: 0, z: 0 }), "spot")
  assert.equal(w.canShoot(0, w.spots[0]), null)
  w.shot(0, w.spots[0], { made: false })
  assert.equal(w.state.world, 0)
  for (let i = 0; i < 7; i++) w.shot(0, w.spots[i], { made: true })
  assert.ok(w.state.over && w.state.worldShots === 8)
  // H-O-R-S-E: a make sets the shot; a miss matching it is a letter; the setter keeps going;
  // a miss setting passes the turn; five letters and you're out
  const g = H.createHoopsGame({ mode: "horse", players: [{ name: "You" }, { name: "Wes", cpu: true }], hoop })
  const at = { x: 1, z: hoop.z + 4 }
  assert.equal(g.canShoot(1, at), "turn")
  g.shot(0, at, { made: true })
  assert.deepEqual(g.state.toMatch, at)
  assert.equal(g.state.turn, 1)
  assert.equal(g.canShoot(1, { x: -3, z: hoop.z + 3 }), "match")
  g.shot(1, at, { made: false })
  assert.equal(g.state.letters[1], "H")
  assert.equal(g.state.turn, 0, "the setter shoots again")
  g.shot(0, at, { made: false })
  assert.equal(g.state.turn, 1, "a missed set passes the turn")
  assert.equal(g.state.toMatch, null)
  for (let k = 0; k < 5; k++) {
    g.shot(1, at, { made: true })
    g.shot(0, at, { made: false })
  }
  assert.equal(g.state.letters[0], "HORSE")
  assert.equal(g.state.over.winner, 1)
  // a swish counts as a make and a swish
  const f = H.createHoopsGame({ mode: "free", hoop })
  f.shot(0, at, { made: true, swish: true })
  f.shot(0, at, { made: true })
  f.shot(0, at, { made: false })
  assert.deepEqual([f.state.made, f.state.shots, f.state.swishes, f.state.best, f.state.streak], [2, 3, 1, 2, 0])
})

test("workout: today's plan, taps on the beat, the streak, real reps from the camera", async () => {
  const W = await import("./workout.js")
  // today's workout: five moves, the same all day (and for both of you), a different one tomorrow
  const a = W.todaysPlan(new Date(2026, 9, 9, 8))
  const b = W.todaysPlan(new Date(2026, 9, 9, 21))
  const c = W.todaysPlan(new Date(2026, 9, 10, 8))
  assert.equal(a.sets.length, 5)
  assert.deepEqual(a.sets.map((s) => `${s.move}${s.bpm}`), b.sets.map((s) => `${s.move}${s.bpm}`))
  assert.notDeepEqual(a.sets.map((s) => `${s.move}${s.bpm}`), c.sets.map((s) => `${s.move}${s.bpm}`))
  assert.ok(!W.todaysPlan(new Date(2026, 9, 9), { treadmill: false }).sets.some((s) => s.move === "sprint"), "no treadmill, no sprints")
  for (const s of a.sets) {
    const M = W.MOVES[s.move]
    assert.ok(s.bpm >= M.bpm[0] && s.bpm <= M.bpm[1])
    assert.ok(Math.abs(s.notes[1] - s.notes[0] - (60 / s.bpm) * M.every) < 1e-3, "a rep every so many beats")
  }
  // on the beat: perfect within 70 ms, good within 150 ms, misses after; the streak's multiplier
  const plan = W.quickPlan("squat", 90)
  const w = W.createWorkout({ plan })
  const n = w.notes
  assert.equal(w.tap(n[0].t + 0.03).kind, "perfect")
  assert.equal(w.tap(n[1].t - 0.12).kind, "good")
  assert.equal(w.tap(n[2].t - 0.5), null, "a tap between notes: nothing")
  const misses = w.step(n[2].t + 0.2)
  assert.equal(misses.filter((e) => e.kind === "miss").length, 1)
  assert.equal(w.state.streak, 0)
  for (let i = 3; i < n.length; i++) w.tap(n[i].t)
  assert.equal(w.state.best, n.length - 3)
  assert.equal(W.multOf(0), 1)
  assert.equal(W.multOf(10), 1.5)
  assert.equal(W.multOf(40), 3)
  assert.ok(w.state.score > (n.length - 1) * 100, "the streak multiplies")
  // the body's rep: its phase is at the bottom of the squat (0.5) on each note
  assert.ok(Math.abs(w.at(n[5].t).p - 0.5) < 0.01)
  // to the end: done once, and the result
  const done = w.step(plan.length + 1).filter((e) => e.type === "done")
  assert.equal(done.length, 1)
  const r = w.result()
  assert.equal(r.reps, n.length - 1)
  assert.equal(r.perfect, n.length - 2)
  // real reps (the camera): a squat's hips going down to the knees and back up is one rep
  const body = (hipY, wristY = 0.6) => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, v: 1 }))
    lm[11] = lm[12] = { x: 0.5, y: 0.3, v: 1 }
    lm[23] = lm[24] = { x: 0.5, y: hipY, v: 1 }
    lm[25] = lm[26] = { x: 0.5, y: 0.75, v: 1 }
    lm[15] = lm[16] = { x: 0.5, y: wristY, v: 1 }
    lm[13] = lm[14] = { x: 0.5, y: 0.45, v: 1 }
    return lm
  }
  const sq = W.repCounter("squat")
  let reps = 0
  for (let k = 0; k < 3; k++) {
    for (const y of [0.55, 0.6, 0.66, 0.72, 0.74, 0.72, 0.62, 0.55]) if (sq.push(body(y))) reps++
  }
  assert.equal(reps, 3)
  assert.equal(W.repSignal("squat", null), null, "no body seen: nothing")
  const press = W.repCounter("press")
  let pr = 0
  for (let k = 0; k < 2; k++) for (const wy of [0.32, 0.2, 0.05, 0.02, 0.1, 0.3, 0.34]) if (press.push(body(0.55, wy))) pr++
  assert.equal(pr, 2)
  // a camera rep counts with more room on the timing than a tap
  const w2 = W.createWorkout({ plan })
  assert.equal(w2.real(w2.notes[0].t + 0.4).kind, "good")
  assert.equal(w2.state.real, 1)
})

test("stats: what each activity adds, fitness levels, your player's gains", async () => {
  const S = await import("./stats.js")
  let st = {}
  st = S.addStats(st, { kind: "tennis", mode: "match", won: true })
  st = S.addStats(st, { kind: "tennis", mode: "rally", best: 9 })
  st = S.addStats(st, { kind: "tennis", mode: "rally", best: 4 })
  assert.deepEqual(st.tennis, { wins: 1, best: 9 })
  st = S.addStats(st, { kind: "hoops", made: 7, shots: 10, swishes: 2, streak: 4, world: 12 })
  st = S.addStats(st, { kind: "hoops", made: 1, shots: 5, streak: 1, world: 9, won: false })
  assert.equal(st.hoops.made, 8)
  assert.equal(st.hoops.world, 9, "the fewest shots round the world")
  assert.equal(st.hoops.horseLosses, 1)
  // a workout: a peek isn't one; eight reps is
  const now = new Date(2026, 9, 9, 18).getTime()
  st = S.addStats(st, { kind: "workout", reps: 3, score: 300 }, now)
  assert.equal(st.workout, undefined)
  for (let d = 0; d < 5; d++) st = S.addStats(st, { kind: "workout", reps: 40, perfect: 30, score: 3000 + d, streak: 12, daily: true }, now - d * S.DAY_MS)
  const f = S.fitnessOf(st, now)
  assert.equal(f.workouts, 5)
  assert.equal(f.name, "Regular")
  assert.equal(f.streakDays, 5)
  assert.ok(f.today && f.pumped)
  // your player: one build up while pumped; for good from "Fit"; never with gains off
  const look = { build: "regular", shirt: "#fff" }
  assert.equal(S.gainsLook(look, st, { now }).build, "strong")
  assert.equal(S.gainsLook(look, st, { now: now + 2 * 3600_000 }).build, "regular", "the pump wears off")
  assert.equal(S.gainsLook(look, st, { gains: false, now }).build, "regular")
  for (let d = 5; d < 10; d++) st = S.addStats(st, { kind: "workout", reps: 40, score: 1 }, now - d * S.DAY_MS)
  assert.equal(S.fitnessOf(st, now + 9 * 3600_000).name, "Fit")
  assert.equal(S.gainsLook({ build: "slim" }, st, { now: now + 9 * 3600_000 }).build, "regular", "fit: for good")
})
