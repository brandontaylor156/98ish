const test = require("node:test")
const assert = require("node:assert/strict")
const { createRoam, cleanPos, cleanCar, CAP, MOVED_CAP, RIDERS } = require("..")

const setup = (opts = {}) => {
  let now = 1000
  const timers = []
  const clock = { now: () => now, setInterval: (fn, ms) => (timers.push(fn), timers.length), clearInterval: () => {} }
  const out = []
  const roam = createRoam({ emit: (pid, event, payload) => out.push({ pid, event, payload }), clock, ice: { config: async () => ({ iceServers: [], turn: false }) }, ...opts })
  const who = (pid, name = pid) => ({ pid, name })
  return { roam, out, clock, who, tick: (ms) => (now += ms), sent: (pid, event) => out.filter((m) => m.pid === pid && m.event === event) }
}

test("roam: positions are checked and capped like the browser's", () => {
  assert.deepEqual(cleanPos([1, 2, 3, 4, 5, 6]), [1, 2, 3, 4, 5, 6])
  assert.equal(cleanPos([300001, 0, 0, 0, 0, 0]), null)
  assert.equal(cleanPos([0, 0, 0, 0, 901, 0]), null)
  assert.equal(cleanPos([0, 0, 0, 0, 0, 16]), null)
  assert.equal(cleanPos([0, 0, 0, 0, 0]), null)
  assert.equal(cleanPos([0.5, 0, 0, 0, 0, 0]), null)
  assert.equal(cleanPos("x"), null)
  assert.deepEqual(cleanCar({ id: "16/1/2:3", model: "suv", color: 255, junk: 1 }), { id: "16/1/2:3", model: "suv", color: 255 })
  assert.equal(cleanCar({ id: "a b", model: "suv", color: 1 }), null)
  assert.equal(cleanCar({ id: "a", model: "tank", color: 1 }), null)
  assert.equal(cleanCar({ id: "a".repeat(41), model: "suv", color: 1 }), null)
})

test("roam: joining a town, seeing each other move, leaving; unknown towns refused; full instances", () => {
  const { roam, out, who, sent } = setup()
  assert.equal(roam.join(who("x"), { town: "atlantis" }).ok, false)
  const a = roam.join(who("a", "Ava"), { town: "valencia" })
  const b = roam.join(who("b", "Ben"), { town: "valencia" })
  assert.ok(a.ok && b.ok && a.n === b.n)
  assert.equal(b.people[0].name, "Ava")
  assert.equal(sent("a", "roam:person")[0].payload.name, "Ben")
  assert.ok(roam.pos("a", [100, 200, 5, 10, 14, 1]))
  assert.equal(roam.pos("a", [100, 200, 5, 10, 14, 99]), false)
  roam.flush(a.n)
  const m = sent("b", "roam:m")
  assert.equal(m.length, 1)
  assert.deepEqual(m[0].payload.m[0], [a.you, 100, 200, 5, 10, 14, 1])
  assert.equal(sent("a", "roam:m").length, 0, "nobody hears their own position")
  // 15 a second at most
  let ok = 0
  for (let i = 0; i < 60; i++) ok += roam.pos("b", [0, 0, 0, 0, 0, 0]) ? 1 : 0
  assert.ok(ok <= 30)
  roam.leave("a")
  assert.equal(sent("b", "roam:gone")[0].payload.num, a.you)
  // a full instance: the next person gets a new one
  const s2 = setup()
  const first = s2.roam.join(s2.who("p0"), { town: "valencia" })
  for (let i = 1; i < CAP; i++) s2.roam.join(s2.who(`p${i}`), { town: "valencia" })
  const extra = s2.roam.join(s2.who("late"), { town: "valencia" })
  assert.notEqual(extra.n, first.n)
  void out
})

test("roam: cars, a car left where everyone sees it, riding along (close by, a driver, seats)", () => {
  const { roam, who, sent } = setup()
  const a = roam.join(who("a", "Ava"), { town: "valencia" })
  const b = roam.join(who("b", "Ben"), { town: "valencia" })
  roam.pos("a", [0, 0, 0, 0, 0, 4])
  roam.pos("b", [30, 0, 0, 0, 0, 0])
  assert.equal(roam.car("a", { car: { id: "16/1/2:0", model: "tank", color: 1 } }).ok, false)
  // not driving yet: can't ride
  assert.equal(roam.ride("b", { num: a.you }).ok, false)
  assert.ok(roam.car("a", { car: { id: "16/1/2:0", model: "sedan", color: 0xffffff } }).ok)
  assert.equal(sent("b", "roam:car").at(-1).payload.car.id, "16/1/2:0")
  // too far (3 m is fine, 30 m isn't... 30 dm = 3 m: move Ben 20 m away first)
  roam.pos("b", [200, 0, 0, 0, 0, 0])
  assert.equal(roam.ride("b", { num: a.you }).ok, false)
  roam.pos("b", [30, 0, 0, 0, 0, 0])
  const r = roam.ride("b", { num: b.you === a.you ? 0 : a.you })
  assert.ok(r.ok && r.car.seat === 1 && r.car.driver === a.you)
  assert.equal(sent("a", "roam:ride")[0].payload.num, b.you)
  // the driver gets out: the rider is out too, and the car stays where it was left
  roam.car("a", { car: null, left: { id: "16/1/2:0", x: 500, z: -40, yaw: 64 } })
  const ev = sent("b", "roam:car").at(-1)
  assert.deepEqual(ev.payload.left, { id: "16/1/2:0", x: 500, z: -40, yaw: 64 })
  const late = roam.join(who("c", "Cy"), { town: "valencia" })
  assert.deepEqual(late.moved, [{ id: "16/1/2:0", x: 500, z: -40, yaw: 64 }])
  assert.equal(late.people.find((p) => p.name === "Ben").car, null, "the rider lost the seat")
  // seats: at most RIDERS riders
  roam.car("a", { car: { id: "c2", model: "suv", color: 1 } })
  for (let i = 0; i < RIDERS + 1; i++) {
    roam.join(who(`r${i}`), { town: "valencia" })
    roam.pos(`r${i}`, [10, 0, 0, 0, 0, 0])
  }
  const results = []
  for (let i = 0; i < RIDERS + 1; i++) results.push(roam.ride(`r${i}`, { num: a.you }).ok)
  assert.deepEqual(results, [...Array(RIDERS).fill(true), false])
})

test("roam: the left-cars memory is capped; bad input is dropped; the bytes stay small", () => {
  const { roam, who, tick } = setup()
  const a = roam.join(who("a"), { town: "valencia" })
  for (let i = 0; i < MOVED_CAP + 30; i++) {
    tick(4000) // (under the car rate limit)
    roam.car("a", { car: null, left: { id: `car${i}`, x: i, z: 0, yaw: 0 } })
  }
  assert.equal(roam.instances.get(a.n).moved.size, MOVED_CAP)
  assert.equal(roam.car("a", { car: null, left: { id: "bad id!", x: 0, z: 0, yaw: 0 } }).ok, true)
  assert.ok(!roam.instances.get(a.n).moved.has("bad id!"))
  // bytes: two people driving at 8 sends a second for a minute
  const s = setup()
  const p = s.roam.join(s.who("p"), { town: "valencia" })
  s.roam.join(s.who("q"), { town: "valencia" })
  const before = s.roam.stats().bytes
  for (let i = 0; i < 60 * 6; i++) {
    s.tick(160)
    s.roam.pos("p", [i * 30, 2000, 50, 12, 250, 5])
    s.roam.pos("q", [i * 30, 2100, 50, 12, 250, 5])
    s.roam.flush(p.n)
  }
  const kbPerMin = (s.roam.stats().bytes - before) / 1024 / 2
  assert.ok(kbPerMin < 40, `${kbPerMin.toFixed(1)} KB a minute each`)
})

test("roam: voice is the same relay as My Park's, per town instance", async () => {
  const { roam, who, sent } = setup()
  roam.join(who("a"), { town: "valencia" })
  const b = roam.join(who("b"), { town: "valencia" })
  const on = await roam.voiceOn("a", true)
  assert.ok(on.ok && on.ice)
  await roam.voiceOn("b", true)
  assert.ok(roam.voiceSignal("a", { to: b.you, kind: "offer", data: { sdp: "v=0\r\n" } }).ok)
  assert.ok(sent("b", "roam:sig").length >= 1)
  assert.equal(roam.voiceSignal("a", { to: "x" }).ok, false)
})

test("roam: Go to another town: the driver's rider is told, follows into the same instance and is seated", async () => {
  const { roam, who, sent, tick } = setup()
  assert.equal(roam.hop("a", { town: "atlantis" }).ok, false)
  const a = roam.join(who("a", "Ava"), { town: "valencia" })
  roam.join(who("b", "Ben"), { town: "valencia" })
  roam.join(who("c", "Cy"), { town: "valencia" })
  roam.pos("a", [100, 100, 0, 0, 0, 1])
  roam.pos("b", [110, 100, 0, 0, 0, 1])
  roam.car("a", { car: { id: "16/1/2:3", model: "suv", color: 255 } })
  assert.ok(roam.ride("b", { num: a.you }).ok)
  // people already in Simi Valley, in two instances: the pair must still land together
  for (let i = 0; i < 3; i++) roam.join(who(`s${i}`), { town: "simi" })
  tick(10)
  assert.deepEqual(roam.hop("a", { town: "simi" }), { ok: true, riders: 1 })
  assert.equal(sent("b", "roam:hop")[0].payload.town, "simi")
  assert.equal(sent("b", "roam:hop")[0].payload.driver, "Ava")
  assert.equal(sent("c", "roam:hop").length, 0, "only the riders come along")
  // the rider gets there first; the driver joins the rider's instance
  const b2 = roam.join(who("b", "Ben"), { town: "simi" })
  const a2 = roam.join(who("a", "Ava"), { town: "simi" })
  assert.equal(a2.n, b2.n, "the same instance")
  await new Promise((r) => setImmediate(r))
  assert.equal(sent("b", "roam:seat").length, 0, "no seat before the driver's car is there")
  roam.pos("a", [5, 5, 0, 0, 0, 2])
  roam.car("a", { car: { id: "hop:suv:1", model: "suv", color: 255 } })
  const seat = sent("b", "roam:seat")
  assert.equal(seat.length, 1)
  assert.equal(seat[0].payload.num, a2.you)
  assert.equal(seat[0].payload.car.seat, 1)
  assert.ok(sent("a", "roam:ride").some((m) => m.payload.num === b2.you))
  assert.equal(roam.tickets.size, 0, "the ticket is used up")
  // the driver arriving first, the car already there: seated as the rider joins
  const s = setup()
  const d = s.roam.join(s.who("d", "Dee"), { town: "newport" })
  s.roam.join(s.who("e", "Eve"), { town: "newport" })
  s.roam.pos("d", [0, 0, 0, 0, 0, 1])
  s.roam.pos("e", [10, 0, 0, 0, 0, 1])
  s.roam.car("d", { car: { id: "x", model: "sedan", color: 1 } })
  assert.ok(s.roam.ride("e", { num: d.you }).ok)
  s.roam.hop("d", { town: "northridge" })
  const d2 = s.roam.join(s.who("d", "Dee"), { town: "northridge" })
  s.roam.car("d", { car: { id: "y", model: "sedan", color: 1 } })
  const e2 = s.roam.join(s.who("e", "Eve"), { town: "northridge" })
  assert.equal(e2.n, d2.n)
  await new Promise((r) => setImmediate(r))
  assert.equal(s.sent("e", "roam:seat")[0]?.payload.num, d2.you)
  // a ticket runs out: a late follower just arrives on foot
  const t = setup()
  const f = t.roam.join(t.who("f", "Fay"), { town: "valencia" })
  t.roam.join(t.who("g", "Gus"), { town: "valencia" })
  t.roam.pos("f", [0, 0, 0, 0, 0, 1])
  t.roam.pos("g", [10, 0, 0, 0, 0, 1])
  t.roam.car("f", { car: { id: "x", model: "sedan", color: 1 } })
  assert.ok(t.roam.ride("g", { num: f.you }).ok)
  t.roam.hop("f", { town: "newport" })
  t.tick(31_000)
  t.roam.join(t.who("f", "Fay"), { town: "newport" })
  t.roam.car("f", { car: { id: "y", model: "sedan", color: 1 } })
  t.roam.join(t.who("g", "Gus"), { town: "newport" })
  await new Promise((r) => setImmediate(r))
  assert.equal(t.sent("g", "roam:seat").length, 0)
})
