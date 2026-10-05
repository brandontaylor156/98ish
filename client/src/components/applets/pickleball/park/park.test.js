// My Park's pure parts: the layout and getting round it, the paddle racks, the regulars, the
// cameras, park rep, the network buffers, walking (only by hand), the time of day.
// node --test client/src/components/applets/pickleball/park/park.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import * as L from "./layout.js"
import { MAX_STACK, callNext, gamesUntil, leaveQueue, nextLineup, ordered, positionOf } from "./queue.js"
import { createRegular, moveRegular, think, tickRegular, startChat, goTo } from "./regulars.js"
import { FOLLOW, angleName, createFollow, followTarget, spectatorShot, stepFollow, turnFollow } from "./followcam.js"
import { REP_LEVELS, freshRep, gamePoints, recordGame, repLevel, repLine, validRep } from "./rep.js"
import { ACTS, createClock, createTrack, observeClock, packPos, pushSample, sampleTrack, sendInterval, serverTime, shouldSend, unpackPos } from "./interp.js"
import { SPEEDS, createWalker, keepApart, speedFor, stepWalker } from "./walker.js"
import { dayLook } from "./sky.js"
import { CHAT_LINES, EMOTES, INTRO } from "./lines.js"
import { blocker } from "../camera.js"
import { seeded } from "../match.js"

const require = createRequire(import.meta.url)
const server = require("../../../../../../server/park/index.js")

const inBox = (x, z, pad = 0) => L.BOXES.some((b) => x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad)

// ---------- the layout ----------
test("layout: every spot you or the regulars go to is open ground inside the park", () => {
  for (const it of L.INTERACTABLES) assert.ok(!L.blocked(it.x, it.z, 0.3), `interactable ${it.id}`)
  for (const w of L.WAYPOINTS) assert.ok(!L.blocked(w.x, w.z, 0.3), `waypoint ${w.x},${w.z}`)
  for (const n of L.NAV) assert.ok(!L.blocked(n.x, n.z, 0.3), `nav node ${n.x},${n.z}`)
  for (const s of L.ALL_SEATS) {
    const a = L.seatApproach(s)
    assert.ok(!L.blocked(a.x, a.z, 0.3), `seat ${s.id}`)
  }
  assert.ok(!L.blocked(L.SPAWN.x, L.SPAWN.z, 0.35))
  for (const c of L.COURTS) {
    assert.ok(!L.blocked(c.outside.x, c.outside.z, 0.3), `outside gate ${c.id}`)
    // (inside the gate is inside the pen: players only)
    assert.ok(inBox(c.inside.x, c.inside.z))
  }
  assert.equal(L.COURTS.length, 4)
  assert.equal(new Set(L.ALL_SEATS.map((s) => s.id)).size, L.ALL_SEATS.length)
})

test("layout: resolve keeps people out of the pens and inside the park", () => {
  for (const c of L.COURTS) {
    const p = L.resolve(c.x, c.z, 0.35)
    assert.ok(!inBox(p.x, p.z, 0.3), `pushed out of pen ${c.id}`)
  }
  const out = L.resolve(200, -200, 0.35)
  assert.ok(out.x <= L.BOUNDS.x1 && out.z >= L.BOUNDS.z0)
  const f = L.resolve(L.FOUNTAIN.x + 0.1, L.FOUNTAIN.z, 0.35)
  assert.ok(Math.hypot(f.x - L.FOUNTAIN.x, f.z - L.FOUNTAIN.z) >= L.FOUNTAIN.r + 0.35 - 1e-6)
})

test("layout: routes go round the pens (every leg clear)", () => {
  const rand = seeded(5)
  const open = () => {
    for (;;) {
      const x = L.BOUNDS.x0 + rand() * (L.BOUNDS.x1 - L.BOUNDS.x0)
      const z = L.BOUNDS.z0 + rand() * (L.BOUNDS.z1 - L.BOUNDS.z0)
      if (!L.blocked(x, z, 0.4)) return { x, z }
    }
  }
  for (let i = 0; i < 300; i++) {
    const a = open()
    const b = open()
    const path = L.route(a, b)
    let at = a
    for (const p of path) {
      assert.equal(L.segmentHit(at, p, 0), null, `leg ${JSON.stringify(at)} -> ${JSON.stringify(p)}`)
      at = p
    }
    assert.deepEqual(path[path.length - 1], { x: b.x, z: b.z })
  }
})

test("layout: the context action is the nearest thing in reach", () => {
  const c = L.COURTS[1]
  assert.equal(L.nearestAction(c.rack.x, c.rack.z - c.side * 0.6).kind, "rack")
  assert.equal(L.nearestAction(c.bleacher.x, c.bleacher.z - c.side * 1.1).kind, "watch")
  assert.equal(L.nearestAction(L.BOOTH.x + L.BOOTH.hx + 0.8, 0).kind, "locker")
  assert.equal(L.nearestAction(25.1, 0).kind, "machine")
  assert.equal(L.nearestAction(L.FOUNTAIN.x, L.FOUNTAIN.z + 1.6), null)
})

test("layout: a court's frame and the world's; poses turned into the world", () => {
  for (const c of L.COURTS) {
    const w = L.toWorld(c, 1.2, -3.4)
    const back = L.toLocal(c, w.x, w.z)
    assert.ok(Math.abs(back.x - 1.2) < 1e-9 && Math.abs(back.z + 3.4) < 1e-9)
  }
  const c = L.COURTS[0]
  const pose = { yaw: 0, pelvis: { x: 1, y: 1, z: 2 }, spine: { x: 0, y: 1, z: 0 }, chestForward: { x: 0, y: 0, z: 1 }, footL: { x: 1, y: 0, z: 2, yaw: 0, pitch: 0.1, pin: { x: 1.1, z: 2.1, ball: true } }, paddle: { grip: { x: 0, y: 1, z: 0 }, face: { x: 0, y: 1.3, z: 0 }, axis: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }, hand: 1, info: { speed: 2 } }
  const w = L.poseToWorld(pose, c)
  assert.deepEqual([w.pelvis.x, w.pelvis.y, w.pelvis.z], [c.x + 2, 1, c.z - 1])
  assert.deepEqual([w.chestForward.x, w.chestForward.z], [1, -0]) // a direction: turned, not moved
  assert.equal(w.yaw, Math.PI / 2)
  assert.equal(w.footL.yaw, Math.PI / 2)
  assert.deepEqual([w.footL.pin.x, w.footL.pin.z, w.footL.pin.ball], [c.x + 2.1, c.z - 1.1, true])
  assert.deepEqual([w.paddle.axis.x, w.paddle.axis.z], [0, -1])
  assert.equal(w.hand, 1)
  assert.equal(w.info, pose.info)
})

// ---------- the racks ----------
test("queue: people go ahead of the regulars; one entry each; a full rack", () => {
  let q = []
  q = callNext(q, { id: "r1", kind: "ai" }).queue
  q = callNext(q, { id: "r2", kind: "ai" }).queue
  const me = callNext(q, { id: "me", kind: "human" })
  assert.equal(me.position, 0)
  q = me.queue
  assert.deepEqual(ordered(q).map((e) => e.id), ["me", "r1", "r2"])
  assert.equal(callNext(q, { id: "me", kind: "human" }).added, false)
  q = callNext(q, { id: "you2", kind: "human" }).queue
  assert.equal(positionOf(q, "you2"), 1)
  assert.equal(gamesUntil(q, "r2"), 0)
  q = leaveQueue(q, "me")
  assert.equal(positionOf(q, "me"), -1)
  let full = []
  for (let i = 0; i < MAX_STACK + 3; i++) full = callNext(full, { id: `r${i}`, kind: "ai" }).queue
  assert.equal(full.length, MAX_STACK)
})

test("queue: paddle stacking rotation after a game", () => {
  const on = ["a", "b", "c", "d"].map((id) => ({ id, kind: "ai" }))
  const wait = (n) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, kind: "ai" }))
  // 4 waiting: 4 off, 4 on
  let r = nextLineup(on, wait(5), 0)
  assert.deepEqual(r.on.map((e) => e.id), ["w0", "w1", "w2", "w3"])
  assert.equal(r.off.length, 4)
  assert.deepEqual(r.queue.map((e) => e.id), ["w4"])
  // 2 waiting: winners (team 1 here) stay and split up
  r = nextLineup(on, wait(2), 1)
  assert.deepEqual(r.on.map((e) => e.id).sort(), ["c", "d", "w0", "w1"])
  assert.deepEqual(r.off.map((e) => e.id).sort(), ["a", "b"])
  assert.ok(r.on.slice(0, 2).some((e) => e.id.startsWith("w")) && r.on.slice(2).some((e) => e.id.startsWith("w")))
  // 1 waiting: winners stay, the loser who's sat out longest ago... stays; the other sits
  const lost = [
    { id: "a", kind: "ai", sat: 50 },
    { id: "b", kind: "ai", sat: 10 },
  ]
  r = nextLineup([...lost, on[2], on[3]], wait(1), 1)
  assert.deepEqual(r.off.map((e) => e.id), ["a"])
  assert.ok(r.on.some((e) => e.id === "b") && r.on.some((e) => e.id === "w0"))
  // nobody waiting: partners switched, nobody off
  r = nextLineup(on, [], 0)
  assert.equal(r.off.length, 0)
  assert.deepEqual(r.on.map((e) => e.id), ["a", "c", "b", "d"])
  // two people at the front play on opposite sides (the online room seats them that way)
  r = nextLineup(on, [{ id: "p1", kind: "human" }, { id: "p2", kind: "human" }, ...wait(2)], 0)
  assert.ok(r.on.slice(0, 2).some((e) => e.id === "p1") && r.on.slice(2).some((e) => e.id === "p2"))
})

// ---------- the regulars ----------
const parkCtx = (rand, regs, courts = L.COURTS.map((c) => ({ id: c.id, level: c.level, queue: 0, open: true }))) => {
  const taken = new Map()
  return {
    rand,
    now: 0,
    courts,
    seatFree: (s) => !taken.has(s.id),
    takeSeat: (s, r) => taken.set(s.id, r.id),
    freeSeat: (s) => taken.delete(s.id),
    partnerFor: (r) => regs.find((o) => o !== r && o.state === "wander" && Math.hypot(o.x - r.x, o.z - r.z) < 9) || null,
    queueSpot: (id, r) => L.resolve(L.COURTS[id].rack.x, L.COURTS[id].rack.z - L.COURTS[id].side * 1.2, 0.3),
    taken,
  }
}

test("regulars: a day at the park: they walk, sit, watch, chat and queue, never through a fence", () => {
  const rand = seeded(11)
  const regs = Array.from({ length: 14 }, (_, i) => createRegular(i, rand, L.resolve(-20 + i * 3, 0.3, 0.3)))
  for (const r of regs) r.idle = 10
  const ctx = parkCtx(rand, regs)
  const seen = new Map(regs.map((r) => [r.id, new Set()]))
  let maxInside = 0
  for (let t = 0; t < 240; t += 0.05) {
    ctx.now = t
    for (const r of regs) {
      const res = tickRegular(r, 0.05, regs, t, rand)
      if (r.state === "queue" && r.t <= 0) {
        r.state = "wander"
        r.idle = 0
      }
      // (the racks fill up: four paddles and nobody else queues there)
      ctx.courts = L.COURTS.map((c) => ({ id: c.id, level: c.level, queue: regs.filter((q) => q.state === "queue" && q.court === c.id).length, open: true }))
      if (res.think) think(r, ctx)
      seen.get(r.id).add(r.state)
      // (sitting on a bleacher seat is allowed: it's on the bleachers' box)
      if (!r.seated && inBox(r.x, r.z, 0.1)) maxInside++
    }
  }
  assert.equal(maxInside, 0, "someone walked into a pen, bleacher or booth")
  const states = new Set([...seen.values()].flatMap((s) => [...s]))
  for (const s of ["wander", "sit", "watch", "queue", "chat"]) assert.ok(states.has(s), `nobody did ${s}: ${[...states]}`)
  // they actually get about
  assert.ok(regs.filter((r) => seen.get(r.id).size >= 2).length >= regs.length - 2, JSON.stringify([...seen].map(([k, v]) => [k, [...v]])))
})

test("regulars: the keen ones go to a rack that's short of paddles, their own level first", () => {
  const rand = seeded(3)
  const r = createRegular(3, rand, { x: -10, z: 0 }) // (level: pro)
  r.idle = 200
  r.keen = 1
  const ctx = parkCtx(rand, [r])
  let pro = 0
  for (let i = 0; i < 40; i++) {
    r.state = "wander"
    const ev = think(r, ctx)
    if (ev?.type === "queue" && L.COURTS[ev.court].level === "pro") pro++
  }
  assert.ok(pro >= 20, `pro court picked ${pro}/40`)
  // no rack open: nobody queues
  const closed = parkCtx(rand, [r], L.COURTS.map((c) => ({ id: c.id, level: c.level, queue: 4, open: true })))
  for (let i = 0; i < 20; i++) assert.notEqual(think(r, closed)?.type, "queue")
})

test("regulars: walking to a spot arrives and stops; a chat turns two to face each other", () => {
  const rand = seeded(9)
  const a = createRegular(0, rand, { x: -20, z: 0.5 })
  goTo(a, { x: -8, z: -0.4 })
  let arrived = false
  for (let i = 0; i < 400 && !arrived; i++) arrived = moveRegular(a, 0.05)
  assert.ok(arrived && Math.hypot(a.x + 8, a.z + 0.4) < 0.3)
  const b = createRegular(1, rand, { x: -6, z: 0.5 })
  const [p, q] = L.chatSpots(a, b)
  startChat(a, b, p, q, rand)
  for (let i = 0; i < 200; i++) {
    tickRegular(a, 0.05, [a, b], i * 0.05, rand)
    tickRegular(b, 0.05, [a, b], i * 0.05, rand)
  }
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 2)
  assert.ok(a.say || b.say, "nobody said anything")
})

// ---------- the cameras ----------
test("spectator cameras: every court and angle, clear of the players and the people sitting nearby", () => {
  const rand = seeded(2)
  for (const c of L.COURTS) {
    for (let angle = 0; angle < 3; angle++) {
      for (const portrait of [false, true]) {
        for (let k = 0; k < 20; k++) {
          // four players on court and a few people sitting on the bleachers
          const bodies = Array.from({ length: 4 }, () => L.toWorld(c, (rand() - 0.5) * 7, (rand() - 0.5) * 15))
          for (const s of L.bleacherSeats(c).filter(() => rand() < 0.4)) bodies.push({ x: s.x, z: s.z, h: s.y + 1 })
          // and someone standing right where the lens wants to be
          const plain = spectatorShot(c, angle, [], { portrait })
          bodies.push({ x: plain.cam.x, z: plain.cam.z })
          const shot = spectatorShot(c, angle, bodies, { portrait })
          assert.equal(blocker(shot.cam, shot.look, bodies), null, `court ${c.id} angle ${angle}`)
          // looking at the court
          assert.ok(Math.hypot(shot.look.x - c.x, shot.look.z - c.z) < 2)
        }
      }
    }
  }
  assert.equal(angleName(0, false), "Sideline")
  assert.equal(angleName(0, true), "Baseline")
})

test("follow camera: behind you, never on the far side of a fence, nobody in front of the lens", () => {
  const rand = seeded(4)
  let n = 0
  for (let i = 0; i < 400; i++) {
    const x = L.BOUNDS.x0 + rand() * (L.BOUNDS.x1 - L.BOUNDS.x0)
    const z = L.BOUNDS.z0 + rand() * (L.BOUNDS.z1 - L.BOUNDS.z0)
    if (L.blocked(x, z, 0.4)) continue
    n++
    const w = { x, z, yaw: rand() * 6.28, speed: 0 }
    const bodies = [{ x: x - Math.sin(w.yaw) * 2, z: z - Math.cos(w.yaw) * 2, r: 0.36 }]
    const t = followTarget(w, w.yaw, { bodies })
    // the camera is on your side of anything tall (pens, the pro shop)
    if (t.cam.y < L.PEN.h) assert.equal(L.segmentHit({ x, z }, t.cam, Math.max(1.5, t.cam.y - 0.1)), null, `through a wall at ${x.toFixed(1)},${z.toFixed(1)}`)
    assert.equal(blocker(t.cam, t.look, bodies, { near: 1.1, ahead: 2.4 }), null)
    const d = Math.hypot(t.cam.x - x, t.cam.z - z)
    assert.ok(d <= FOLLOW.dist + 1e-6)
  }
  assert.ok(n > 100)
  // walking away from the camera: it swings round behind; walking toward it: it doesn't flip
  const st = createFollow(0)
  const w = { x: -10, z: 0.4, yaw: Math.PI / 2, speed: 3 }
  for (let i = 0; i < 120; i++) stepFollow(st, w, 1 / 60)
  assert.ok(Math.abs(st.yaw - Math.PI / 2) < 0.6, `swung to ${st.yaw}`)
  const st2 = createFollow(0)
  const toward = { x: -10, z: 0.4, yaw: Math.PI, speed: 3 }
  for (let i = 0; i < 120; i++) stepFollow(st2, toward, 1 / 60)
  assert.ok(Math.abs(st2.yaw) < 0.05)
  // a drag turns it, and holds the auto-swing off a moment
  turnFollow(st, 1)
  assert.ok(st.drag > 0)
})

// ---------- park rep ----------
test("park rep: wins, losses, streaks, levels", () => {
  let r = freshRep()
  r = recordGame(r, true, { level: "intermediate" })
  assert.equal(r.earned, 12)
  r = recordGame(r, true, { level: "pro" })
  assert.equal(r.earned, 10 + 2 + 5)
  assert.equal(r.streak, 2)
  r = recordGame(r, false)
  assert.equal(r.streak, 0)
  assert.equal(r.best, 2)
  assert.equal(r.wins, 2)
  assert.equal(r.losses, 1)
  assert.equal(gamePoints(false), 3)
  assert.equal(repLevel(0).name, "Newcomer")
  assert.equal(repLevel(30).name, "Regular")
  assert.equal(repLevel(10_000).name, REP_LEVELS.at(-1).name)
  assert.equal(repLevel(15).toNext, 15)
  assert.match(repLine({ wins: 5, losses: 2, streak: 3, points: 95 }), /Local · 5-2 · 3 in a row/)
  assert.deepEqual(validRep({ wins: -1, points: "x", streak: 4.7 }), { ...freshRep(), streak: 4 })
})

// ---------- the network ----------
test("network: positions packed small and back", () => {
  const p = { x: -12.345, z: 7.89, yaw: -2.5, speed: 3.14, act: ACTS.move }
  const a = packPos(p)
  assert.ok(a.every(Number.isInteger))
  assert.ok(JSON.stringify(a).length <= 22)
  const u = unpackPos(a)
  assert.ok(Math.abs(u.x - p.x) <= 0.025 && Math.abs(u.z - p.z) <= 0.025)
  assert.ok(Math.abs(Math.atan2(Math.sin(u.yaw - p.yaw), Math.cos(u.yaw - p.yaw))) < 0.03)
  assert.ok(Math.abs(u.speed - p.speed) < 0.06)
  assert.equal(unpackPos([1, 2, 3]), null)
  assert.equal(unpackPos([1, 2, 3, 4, 0.5]), null)
  // the server accepts what we send and clamps the rest
  assert.deepEqual(server.cleanPos(a), a)
})

test("network: interpolation between updates, a short glide past the last, then standing", () => {
  const tr = createTrack()
  // walking east at 2 m/s, updates every 160 ms
  for (let i = 0; i <= 10; i++) pushSample(tr, 1000 + i * 160, { x: i * 0.32, z: 0, yaw: Math.PI / 2, speed: 2, act: 1 })
  assert.equal(pushSample(tr, 1000, { x: 99, z: 0, yaw: 0, speed: 0, act: 0 }), false) // late: dropped
  const mid = sampleTrack(tr, 1000 + 5 * 160 + 80 + 320)
  assert.ok(Math.abs(mid.x - (5 * 0.32 + 0.16)) < 1e-6, `mid ${mid.x}`)
  assert.ok(Math.abs(mid.vx - 2) < 0.01)
  // past the newest: carries on a moment (at most EXTRAPOLATE), then stays put
  const last = 1000 + 10 * 160
  const a = sampleTrack(tr, last + 320 + 200)
  assert.ok(a.x > 3.2 && a.x < 3.2 + 2 * 0.36)
  const b = sampleTrack(tr, last + 320 + 2000)
  const c = sampleTrack(tr, last + 320 + 4000)
  assert.equal(b.x, c.x)
  assert.ok(b.stale)
  // a jump across the park is a jump, not a slide
  pushSample(tr, last + 160, { x: 30, z: 5, yaw: 0, speed: 0, act: 0 })
  const j = sampleTrack(tr, last + 160 + 320)
  assert.equal(j.x, 30)
})

test("network: the server clock offset from the quickest message", () => {
  const c = createClock()
  observeClock(c, 1000, 5100) // 100 ms on the way
  observeClock(c, 1200, 5260) // 60 ms: quicker
  observeClock(c, 1400, 5700) // a slow one doesn't move it the wrong way
  assert.ok(c.offset <= 4100 && c.offset >= 4060)
  assert.ok(Math.abs(serverTime(c, 6000) - (6000 - c.offset)) < 1e-9)
})

test("network: how often you send (moving, still, traffic meter running high)", () => {
  assert.ok(sendInterval(true) < 200 && sendInterval(false) >= 1500)
  assert.ok(sendInterval(true, "low") > sendInterval(true) && sendInterval(true, "min") >= 900)
  const p = { x: 0, z: 0, yaw: 0, speed: 2, act: 1 }
  assert.equal(shouldSend(null, 0, p), true)
  const last = { t: 0, p }
  assert.equal(shouldSend(last, 100, { ...p, x: 0.2 }), false)
  assert.equal(shouldSend(last, 170, { ...p, x: 0.34 }), true)
  // just stopped: sent at once (not after the still heartbeat)
  assert.equal(shouldSend(last, 170, { ...p, speed: 0 }), true)
  const still = { t: 0, p: { ...p, speed: 0 } }
  assert.equal(shouldSend(still, 500, { ...p, speed: 0 }), false)
  assert.equal(shouldSend(still, 2100, { ...p, speed: 0 }), true)
  // sitting down: at once
  assert.equal(shouldSend(still, 200, { ...p, speed: 0, act: ACTS.sitLow }), true)
})

test("network: the canned lines and emotes match the server's", () => {
  assert.equal(CHAT_LINES.length, server.LINE_COUNT)
  for (const e of EMOTES) assert.ok(server.EMOTES.includes(e.id), e.id)
  assert.equal(INTRO.length, 3)
  assert.deepEqual(server.BOUNDS, L.BOUNDS)
})

// ---------- walking: your hand only ----------
test("walking: nothing moves you without your hand (owner's rule)", () => {
  const w = createWalker(-15, 0.5, 0)
  for (let i = 0; i < 600; i++) stepWalker(w, { x: 0, y: 0 }, 1.2, 1 / 60)
  assert.equal(w.x, -15)
  assert.equal(w.z, 0.5)
  assert.equal(w.speed, 0)
  // even standing at an action spot or a rack nothing pulls you
  const c = L.COURTS[0]
  const r = createWalker(c.rack.x, c.rack.z - c.side * 0.6, 0)
  const at = { x: r.x, z: r.z }
  for (let i = 0; i < 300; i++) stepWalker(r, null, 0, 1 / 60)
  assert.deepEqual({ x: r.x, z: r.z }, at)
})

test("walking: a little push walks, more jogs, all the way (held) sprints; you stop when you let go", () => {
  assert.equal(speedFor(0.05), 0)
  assert.ok(speedFor(0.3) > 0.6 && speedFor(0.3) <= SPEEDS.walk)
  assert.equal(speedFor(0.7), SPEEDS.jog)
  assert.equal(speedFor(1, { full: 0 }), SPEEDS.run)
  assert.equal(speedFor(1, { full: 2 }), SPEEDS.sprint)
  const w = createWalker(-18, 0.5, Math.PI / 2)
  // camera looking east: up the pad goes east
  for (let i = 0; i < 120; i++) stepWalker(w, { x: 0, y: 1 }, Math.PI / 2, 1 / 60)
  assert.ok(w.x > -18 + 3 && Math.abs(w.z - 0.5) < 0.01)
  assert.equal(w.gait, "sprint")
  for (let i = 0; i < 90; i++) stepWalker(w, { x: 0, y: 0 }, Math.PI / 2, 1 / 60)
  assert.equal(w.speed, 0)
  // pad right with the camera looking east: south (+z), into the bleachers' edge, not through it
  const s = createWalker(-12, 0.5, 0)
  for (let i = 0; i < 300; i++) stepWalker(s, { x: 1, y: 0 }, Math.PI / 2, 1 / 60)
  assert.ok(s.z > 0.5 && !inBox(s.x, s.z, 0.3))
  // nobody walks through anybody
  const a = createWalker(0, 2, 0)
  keepApart(a, [{ x: 0.1, z: 2 }])
  assert.ok(Math.hypot(a.x - 0.1, a.z - 2) >= 0.55 - 1e-6)
})

// ---------- the time of day ----------
test("time of day: night with the lights on, day without; no jumps through the day", () => {
  assert.equal(dayLook(13).kind, "day")
  assert.equal(dayLook(13).lights, false)
  assert.equal(dayLook(23).kind, "night")
  assert.equal(dayLook(23).lights, true)
  assert.equal(dayLook(2).stars, true)
  assert.ok(["golden", "dusk"].includes(dayLook(18.9).kind))
  let prev = dayLook(0)
  for (let h = 0.1; h < 24; h += 0.1) {
    const d = dayLook(h)
    assert.ok(Math.abs(d.sun.intensity - prev.sun.intensity) < 0.2, `sun jumps at ${h}`)
    assert.ok(Math.abs(d.exposure - prev.exposure) < 0.05)
    prev = d
  }
})
