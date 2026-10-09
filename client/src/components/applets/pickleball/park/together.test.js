// My Park "Together" (together.js): who counts as near, walking hand in hand by consent and
// breaking away, stepping into place, the selfie's framing, sitting and the sunset, memories.
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { BEHIND, BREAK_AWAY, EMOTE_POSE, LAPSE_END_EL, SIDE, TOGETHER, TOGETHER_IDS, breaksAway, dateTime, emoteSpots, followTarget, givesSpace, lapseAt, lapseStart, localDate, magFor, memoryFor, nameKey, nearestPal, padToward, pickAlbum, pickSeats, seatPairs, selfieShot, teamCourt, twirlAngle } from "./together.js"
import { createWalker, speedFor, stepWalker } from "./walker.js"

const require = createRequire(import.meta.url)
const server = require("../../../../../../server/park/together.js")

test("the kinds match the server's; the sheet's baseline is four", () => {
  assert.deepEqual([...TOGETHER_IDS].sort(), Object.keys(server.KINDS).sort())
  assert.equal(TOGETHER.filter((t) => t.base).length, 4)
  for (const t of TOGETHER) assert.match(t.ask("Ava"), /Ava/)
  for (const k of ["hug", "highfive", "twirl", "dance"]) assert.equal(EMOTE_POSE[k].length, 2)
})

test("the Together button: only a partner or buddy, only close by", () => {
  const people = [
    { num: 2, name: "Stranger Sam", x: 1, z: 0 },
    { num: 3, name: "Ava Rose", x: 4, z: 0 },
    { num: 4, name: "benny", x: 2, z: 0, hidden: true },
  ]
  const friends = new Set([nameKey("AvaRose"), nameKey("Benny")])
  assert.deepEqual(nearestPal({ x: 0, z: 0 }, people, friends), { num: 3, name: "Ava Rose", d: 4 })
  assert.equal(nearestPal({ x: -5, z: 0 }, people, friends), null) // 9 m away
  assert.equal(nearestPal({ x: 0, z: 0 }, people, new Set()), null)
  assert.equal(nearestPal({ x: 0, z: 0 }, people, null), null)
})

test("hand in hand: you walk beside them by yourself; your own stick lets go", () => {
  // the follower's target: beside the leader (to the leader's right), or behind
  const L = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0 }
  const side = followTarget("hand", L)
  assert.ok(Math.abs(Math.hypot(side.x, side.z) - SIDE) < 1e-9)
  const behind = followTarget("follow", L)
  assert.ok(Math.abs(behind.z + BEHIND) < 1e-9)
  // pushing your own stick past the line lets go; a nudge doesn't; any key does
  assert.equal(breaksAway({ x: 0, y: 0 }), false)
  assert.equal(breaksAway({ x: BREAK_AWAY * 0.8, y: 0 }), false)
  assert.equal(breaksAway({ x: 0, y: 0.5 }), true)
  assert.equal(breaksAway({ x: 0, y: 0, keys: true }), true)
  // the pad's push for a speed: walker.js reads back about that speed
  for (const v of [0.8, 1.2, 1.45]) assert.ok(Math.abs(speedFor(magFor(v)) - v) < 0.12, `${v}`)
  assert.equal(magFor(0.2), 0)
  // walking together along Riverside's main path: the leader walks east, the other one keeps
  // up beside them (as their browser does it, from the leader's position a third of a second old)
  const leader = createWalker(-15, 0, Math.PI / 2)
  const mate = createWalker(-15.5, 1.5, 0)
  const camYaw = Math.PI / 2
  const history = []
  let worst = 0
  for (let i = 0; i < 400; i++) {
    const dt = 1 / 60
    stepWalker(leader, { x: 0, y: 0.5 }, camYaw, dt)
    history.push({ x: leader.x, z: leader.z, yaw: leader.yaw, vx: leader.vx, vz: leader.vz, speed: leader.speed })
    const seen = history[Math.max(0, history.length - 20)] // ~0.32 s old
    const target = followTarget("hand", seen)
    const pad = padToward(mate, target, camYaw, { speed: seen.speed })
    stepWalker(mate, pad, camYaw, dt)
    if (i > 240) worst = Math.max(worst, Math.hypot(mate.x - followTarget("hand", leader, 0).x, mate.z - followTarget("hand", leader, 0).z))
  }
  assert.ok(leader.x > -11, `the leader walked (${leader.x})`)
  assert.ok(worst < 0.5, `beside them within half a metre (${worst.toFixed(2)})`)
  // nobody leading: a push toward where you already are does nothing
  const still = createWalker(0, 0, 0)
  const p = padToward(still, { x: 0.05, z: 0 }, 0)
  assert.equal(p.arrived, true)
  assert.equal(p.x, 0)
  assert.equal(p.y, 0)
})

test("a hug, a high five: two spots facing each other; the twirl goes once round", () => {
  const [a, b] = emoteSpots({ x: 0, z: 0, yaw: 0 }, { x: 3, z: 0, yaw: 0 }, "hug")
  assert.ok(Math.abs(Math.hypot(b.x - a.x, b.z - a.z) - 0.42) < 1e-9)
  assert.ok(Math.abs(a.x - 1.29) < 1e-9 && Math.abs(b.x - 1.71) < 1e-9)
  assert.ok(Math.abs(Math.abs(a.yaw - b.yaw) - Math.PI) < 1e-9)
  assert.ok(Math.abs(a.yaw - Math.PI / 2) < 1e-9) // a faces +x, toward b
  assert.equal(twirlAngle(0), 0)
  assert.ok(Math.abs(twirlAngle(1.6) - Math.PI * 2) < 1e-9)
  assert.ok(twirlAngle(1) > 0 && twirlAngle(1) < Math.PI * 2)
})

test("the selfie: the lens 2.3 m out at eye height, the court behind them, round anything in the way", () => {
  const a = { x: -0.4, z: 0 }
  const b = { x: 0.4, z: 0 }
  const shot = selfieShot(a, b, { x: 0, z: 20 })
  assert.ok(Math.abs(Math.hypot(shot.cam.x, shot.cam.z) - 2.3) < 1e-9)
  assert.ok(shot.cam.z < 0, "the camera opposite the court")
  assert.equal(shot.cam.y, 1.62)
  // they face the camera, side by side 0.6 m apart, each keeping their side
  assert.ok(Math.abs(Math.cos(shot.yaw) + 1) < 1e-9)
  assert.ok(Math.abs(Math.hypot(shot.spots[0].x - shot.spots[1].x, shot.spots[0].z - shot.spots[1].z) - 0.6) < 1e-9)
  assert.ok(shot.spots[0].x < 0 && shot.spots[1].x > 0)
  // a wall where the camera would stand: turned until clear
  const turned = selfieShot(a, b, { x: 0, z: 20 }, (cam) => cam.z > -1)
  assert.ok(turned.cam.z > -1)
  assert.notEqual(turned.bg, shot.bg)
})

test("sitting together and the sunset: two free seats side by side, facing the sun; the lapse", () => {
  const seats = [
    { id: "b0s0", bench: "b0", x: 0, z: 0, y: 0.45, yaw: 0 },
    { id: "b0s1", bench: "b0", x: 0.9, z: 0, y: 0.45, yaw: 0 },
    { id: "b1s0", bench: "b1", x: 10, z: 0, y: 0.45, yaw: Math.PI },
    { id: "b1s1", bench: "b1", x: 10.9, z: 0, y: 0.45, yaw: Math.PI },
    { id: "b2s0", bench: "b2", x: 3, z: 0, y: 0.45, yaw: 0 },
  ]
  assert.equal(seatPairs(seats, () => true).length, 2)
  assert.deepEqual(pickSeats(seats, () => true, { x: 2, z: 0 }).map((s) => s.id), ["b0s0", "b0s1"])
  // someone on b0: the next pair
  assert.deepEqual(pickSeats(seats, (s) => s.id !== "b0s1", { x: 2, z: 0 }).map((s) => s.id), ["b1s0", "b1s1"])
  // the sun to the -z: the bench that looks that way, though further
  assert.deepEqual(pickSeats(seats, () => true, { x: 2, z: 0 }, { sunDir: { x: 0, z: -1 } }).map((s) => s.id), ["b1s0", "b1s1"])
  assert.equal(pickSeats(seats, () => false, { x: 0, z: 0 }), null)
  // the lapse: a sun going down 1 degree every 4 minutes from 30 degrees at t0
  const t0 = Date.UTC(2026, 9, 9, 22, 0)
  const el = (d) => 30 - (d.getTime() - t0) / 240_000
  const golden = new Date(t0 + 24 * 240_000) // 6 degrees
  // high sun: from golden hour; low already: from now; after dark: golden hour again
  assert.equal(lapseStart(new Date(t0), golden, el).getTime(), golden.getTime() - 8 * 60_000)
  assert.equal(lapseStart(new Date(t0 + 25 * 240_000), golden, el).getTime(), t0 + 25 * 240_000)
  assert.equal(lapseStart(new Date(t0 + 60 * 240_000), golden, el).getTime(), golden.getTime() - 8 * 60_000)
  const s = golden
  assert.equal(lapseAt(s, 60, el).getTime(), s.getTime() + 30 * 60_000) // 30x
  assert.equal(lapseAt(s, 60 * 60, el), null) // past the end: it holds
  assert.ok(el(lapseAt(s, 100, el)) > LAPSE_END_EL)
})

test("date night: lights where there are, the regulars give you space", () => {
  assert.equal(dateTime(true), "night")
  assert.equal(dateTime(false), "golden")
  const me = { x: 0, z: 0 }
  assert.equal(givesSpace({ state: "wander", x: 3, z: 0 }, me), true)
  assert.equal(givesSpace({ state: "playing", x: 1, z: 0 }, me), false)
  assert.equal(givesSpace({ state: "queue", x: 1, z: 0 }, me), false)
  assert.equal(givesSpace({ state: "wander", x: 9, z: 0 }, me), false)
})

test("playing together: the free court with the clearest camera", () => {
  const courts = [
    { id: 0, x: 0, z: 0, busy: true, blockers: 0 },
    { id: 1, x: 5, z: 0, busy: false, blockers: 2 },
    { id: 2, x: 30, z: 0, busy: false, blockers: 0 },
    { id: 3, x: 10, z: 0, busy: false, blockers: 0 },
  ]
  assert.equal(teamCourt(courts, { x: 0, z: 0 }), 3)
  assert.equal(teamCourt(courts.map((c) => ({ ...c, busy: true })), { x: 0, z: 0 }), null)
})

test("memories: what's sent to Our Story; the album you share", () => {
  const d = new Date(2026, 9, 9, 19, 30)
  assert.equal(localDate(d), "2026-10-09")
  assert.deepEqual(memoryFor("rally", { venue: "Los Cab", date: d, streak: 14 }), { kind: "rally", venue: "Los Cab", date: "2026-10-09", streak: 14 })
  assert.deepEqual(memoryFor("selfie", { venue: "Los Cab", date: d, photo: "data:x", golden: true }), { kind: "selfie", venue: "Los Cab", date: "2026-10-09", photo: "data:x", golden: true })
  assert.deepEqual(memoryFor("datenight", { venue: "x".repeat(80), date: d }).venue.length, 60)
  const albums = [
    { id: "big", members: [{ key: "ben" }, { key: "ava" }, { key: "cal" }] },
    { id: "us", members: [{ key: "ava" }, { key: "ben" }] },
    { id: "theirs", members: [{ key: "ava" }, { key: "dee" }] },
  ]
  assert.equal(pickAlbum(albums, "ben", "ava").id, "us")
  assert.equal(pickAlbum(albums.slice(0, 1), "ben", "ava").id, "big")
  assert.equal(pickAlbum(albums, "ben", "zed"), null)
  assert.equal(pickAlbum(albums, "ben", null), null)
})
