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
