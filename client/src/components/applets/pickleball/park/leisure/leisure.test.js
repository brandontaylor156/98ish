// My Park leisure (park/leisure/): only at sourced places, the swim and the hot tub, the menu and
// the chips, what's in your hand, Vince's keys.
// node --test client/src/components/applets/pickleball/park/leisure/leisure.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { venueLayoutSpec } from "../venuegen.js"
import { makeLayout, setLayout } from "../layout.js"
import { furnishRoom } from "../propkit.js"
import { LEISURE_SOURCES, edgeOf, inPoly, leisureAt, leisureSpots, leisureSummary, poolEntry } from "./spots.js"
import { ITEMS, MENUS, costOf, itemById, menuFor, pay, refund, sip, startHolding, verbFor } from "./menu.js"
import { DEPTH, swimPose, tubPose, tuckPose } from "./poses.js"
import { SWIM, alongOf, createSwimRun, lapLengths, laneStart, stepSwimmer } from "./swimRun.js"
import { SEAT_Y, createTubRun, pickTubSeat, tubPair } from "./tubRun.js"
import { LEISURE_ACTS, VINCE, VINCE_LINES, createLeisureSide, vinceHome } from "./parkside.js"
import { ACTS } from "../interp.js"
import { TOGETHER, togetherById } from "../together.js"

const IDS = ["loscab", "newport", "wolfbear", "whittier", "paseo", "sinaloa", "smash", "bouquet"]
const spec = (id) => JSON.parse(readFileSync(new URL(`../venues/${id}.json`, import.meta.url), "utf8"))
const built = new Map()
const get = (id) => {
  if (!built.has(id)) {
    const ls = venueLayoutSpec(spec(id))
    built.set(id, { ls, L: makeLayout(ls) })
  }
  const b = built.get(id)
  setLayout(b.L)
  return b
}

// a flood fill over open ground from the arrival (as the venues' and the activities' tests do)
const reachable = (L, start, targets, G = 0.5) => {
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

test("leisure only where the venue really has it: the packs' pools, tub, counters and fridges, OSM's pool", () => {
  const want = {
    loscab: { swim: ["The 50 m pool", "The lap pool"], tub: ["The hot tub"], order: ["Los Cab Cafe"], vending: ["The cafe's drinks fridge", "The vending machines"] },
    // (the only pool and spa OSM has there are in a house's back garden: none)
    newport: { swim: [], tub: [], order: ["The clubhouse bar", "The social lawn bar"], vending: ["The vending machine"] },
    wolfbear: { swim: [], tub: [], order: [], vending: ["The drinks fridges"] },
    whittier: { swim: [], tub: [], order: ["The snack window"], vending: [] },
    paseo: { swim: ["The pool"], tub: ["The hot tub"], order: ["The cafe and bar"], vending: [] },
    sinaloa: { swim: [], tub: [], order: [], vending: [] },
    smash: { swim: [], tub: [], order: ["The bar and restaurant"], vending: ["The lobby's drinks fridge"] },
    bouquet: { swim: [], tub: [], order: [], vending: [] },
  }
  for (const id of IDS) {
    const { ls, L } = get(id)
    const S = ls.scene
    const spots = leisureSpots(L)
    assert.deepEqual(leisureSummary(spots), want[id], id)
    const src = LEISURE_SOURCES[id] || {}
    for (const s of spots) {
      assert.ok(typeof s.src === "string" && s.src.length > 20, `${id} ${s.id}: a source`)
      if (s.kind === "swim") {
        // a pool area in the spec, the one the source names
        assert.ok(S.areas.some((a) => a.k === "pool" && a.p === s.poly), `${id} ${s.id}: a pool in the data`)
        assert.ok(src.pools.some((p) => Math.hypot(p.at[0] - s.cx, p.at[1] - s.cz) < 8), `${id} ${s.id}: a sourced pool`)
      }
      // (a tub prop, or the small pool the owner named as the hot tub)
      if (s.kind === "tub") assert.ok(src.tub.prop ? S.props.some((p) => p.t === src.tub.prop && p.x === s.x && p.z === s.z) : S.areas.some((a) => a.k === "pool" && Math.hypot(a.p.reduce((t, q) => t + q[0], 0) / a.p.length - s.x, a.p.reduce((t, q) => t + q[1], 0) / a.p.length - s.z) < 4), `${id}: the tub is the spec's own`)
      if (s.kind === "order" || s.kind === "vending") {
        const def = src[s.kind === "order" ? "order" : "vending"]
        const counters = def.flatMap((d) => (d.room ? furnishRoom(S.rooms.find((r) => r.id === d.room)).filter((p) => p.t === (s.kind === "order" ? "counter" : d.t)) : S.props.filter((p) => (s.kind === "order" ? p.t === "counter" : p.t === d.loose))))
        assert.ok(counters.some((c) => Math.hypot(c.x - s.at.x, c.z - s.at.z) < 2.6), `${id} ${s.id}: by a sourced counter or machine`)
      }
    }
    // every one reachable on foot from where you arrive
    const start = L.SPAWN || ls.spawn
    const targets = spots.map((s) => (s.kind === "swim" ? poolEntry(s, s.cx + s.along.x * 3, s.cz + s.along.z * 3) : s.at))
    if (targets.length) {
      const ok = reachable(L, start, targets)
      for (const [i, t] of targets.entries()) assert.ok(ok(t, 2), `${id} ${spots[i].id}: reachable from the arrival`)
    }
  }
  // Riverside (the made-up park) and Venue Finder venues: nothing
  assert.deepEqual(leisureSpots({ id: "riverside", scene: { areas: [{ k: "pool", p: [[0, 0], [10, 0], [10, 10], [0, 10]] }] } }), [])
})

test("where you are: by a pool's edge (or in it), the tub, a counter, a machine", () => {
  const { L } = get("loscab")
  const spots = leisureSpots(L)
  const pool = spots.find((s) => s.id === "swim1")
  const e = poolEntry(pool, pool.cx + 30, pool.cz)
  assert.ok(!inPoly(e.x, e.z, pool.poly) && edgeOf(e.x, e.z, pool.poly).d < 0.6, "the entry is on the deck by the edge")
  assert.ok(inPoly(e.inX, e.inZ, pool.poly), "and the way in is in the water")
  assert.equal(leisureAt(spots, e.x, e.z).spot.id, "swim1")
  assert.equal(leisureAt(spots, pool.cx, pool.cz).spot.id, "swim1")
  assert.equal(leisureAt(spots, pool.cx + pool.along.z * 20, pool.cz - pool.along.x * 20), null, "well away: nothing")
  const tub = spots.find((s) => s.kind === "tub")
  assert.equal(leisureAt(spots, tub.at.x, tub.at.z).spot.id, "tub1")
  const order = spots.find((s) => s.kind === "order")
  assert.equal(leisureAt(spots, order.at.x, order.at.z).spot.kind, "order")
  // (up a floor: not here)
  assert.equal(leisureAt(spots, order.at.x, order.at.z, 4), null)
})

test("the body in the water: head out, body under; on your back; tucked in the air; in the tub", () => {
  for (const style of ["free", "tread", "float"]) {
    for (const t of [0, 0.4, 0.9, 1.7]) {
      const p = swimPose({ x: 3, z: -2, yaw: 0.7, t, style, surface: 0.03, speed: 1 })
      assert.ok(p.head.y > -0.02 && p.head.y < 0.4, `${style}: the head at the surface (${p.head.y.toFixed(2)})`)
      assert.ok(p.pelvis.y < 0.03, `${style}: the hips under the water`)
      for (const k of ["shoulderL", "shoulderR", "hipL", "hipR", "kneeL", "ankleR", "wristP", "wristO", "elbowP"]) assert.ok(Number.isFinite(p[k].x + p[k].y + p[k].z), `${style} ${k}`)
    }
  }
  // freestyle: lying along the way you swim, the arms over the water in turn
  const f = swimPose({ x: 0, z: 0, yaw: 0, t: 0, style: "free" })
  assert.ok(f.head.z - f.pelvis.z > 0.5 && Math.abs(f.head.y - f.pelvis.y) < 0.35, "prone")
  let over = 0
  for (let t = 0; t < 1.6; t += 0.1) if (swimPose({ x: 0, z: 0, yaw: 0, t, style: "free" }).wristP.y > 0.05) over++
  assert.ok(over >= 2 && over <= 12, `the arm comes over the water part of the stroke (${over}/16)`)
  // treading: upright
  const tr = swimPose({ x: 0, z: 0, yaw: 0, t: 0, style: "tread" })
  assert.ok(tr.head.y - tr.pelvis.y > 0.55, "upright")
  assert.ok(DEPTH.tread > DEPTH.free)
  // the cannonball: knees up to the chest
  const c = tuckPose({ x: 0, y: 1.2, z: 0, yaw: 0 })
  assert.ok(c.kneeR.y > c.hipR.y - 0.1 && c.kneeR.z > c.hipR.z, "knees up and in front")
  // the tub: shoulders by the water, hands on the rim
  const tp = tubPose({ x: 0, y: SEAT_Y, z: 0, yaw: 0 }, { x: 0, y: 0.8, z: 1 }, { rim: 0.5 })
  assert.ok(Math.abs(tp.shoulderR.y - 0.55) < 0.12, `shoulders at the water (${tp.shoulderR.y.toFixed(2)})`)
  assert.ok(Math.abs(tp.wristP.y - 0.54) < 0.06 && Math.abs(tp.wristO.y - 0.54) < 0.06, "hands on the rim")
})

test("swimming: the pad swims you, the pool's edge keeps you in, a length or two against the clock", () => {
  const { L } = get("loscab")
  const pool = leisureSpots(L).find((s) => s.id === "swim1")
  const s = { x: pool.cx, z: pool.cz, yaw: 0, speed: 0 }
  // straight up the pad with the camera behind: you turn that way and swim
  for (let i = 0; i < 120; i++) stepSwimmer(s, pool, { sx: 0, sy: 1, camYaw: 1.2 }, 1 / 30)
  assert.ok(Math.abs(Math.atan2(Math.sin(s.yaw - 1.2), Math.cos(s.yaw - 1.2))) < 0.05, "facing where you pushed")
  assert.ok(s.speed > SWIM.speed * 0.9, "up to speed")
  // let go: you slow to treading water
  for (let i = 0; i < 90; i++) stepSwimmer(s, pool, { sx: 0, sy: 0, camYaw: 1.2 }, 1 / 30)
  assert.ok(s.speed < 0.05)
  // swim into the wall for a long while: never out of the water
  for (let i = 0; i < 2000; i++) {
    stepSwimmer(s, pool, { sx: 0.3, sy: 1, camYaw: 2.2 }, 1 / 30)
    assert.ok(inPoly(s.x, s.z, pool.poly) && edgeOf(s.x, s.z, pool.poly).d >= SWIM.margin - 1e-6)
  }
  // lanes: from the nearer wall, in your lane, facing down it
  const st = laneStart(pool, pool.cx + pool.along.x * 10, pool.cz + pool.along.z * 10)
  assert.equal(st.lanes, 9)
  assert.ok(Math.abs(Math.abs(alongOf(pool, st.x, st.z)) - (pool.len / 2 - 0.8)) < 0.01)
  assert.equal(lapLengths(pool), 1)
  const paseo = leisureSpots(get("paseo").L).find((s) => s.kind === "swim")
  assert.equal(lapLengths(paseo), 2)
  // a whole timed swim: two lengths at Paseo, the view turns round at the far wall
  const best = 999_999
  let finished = null
  const run = createSwimRun({ spot: paseo, from: { x: paseo.cx, z: paseo.cz }, mode: "laps", best, onLap: (ms) => (finished = ms) })
  const api = { meBody: {} }
  run.start(api)
  let t = 0
  run.setStick(0, 1)
  while (!finished && t < 120) {
    run.step(1 / 30)
    t += 1 / 30
  }
  assert.ok(finished > 20_000 && finished < 60_000, `two lengths in ${finished} ms`)
  assert.equal(run.state.laps.done, 2)
  assert.equal(run.result().ms, finished)
  assert.equal(run.netAct(), ACTS.swim)
  assert.equal(LEISURE_ACTS.swim, 5)
  assert.equal(LEISURE_ACTS.tub, 6)
  // out on the deck
  const out = run.exit()
  assert.ok(!inPoly(out.x, out.z, paseo.poly))
  run.stop()
  assert.equal(api.meBody.drive, null)
})

test("a cannonball: off the edge, a splash, under, back up treading water", () => {
  const { L } = get("loscab")
  const pool = leisureSpots(L).find((s) => s.id === "swim1")
  let splashed = 0
  const run = createSwimRun({ spot: pool, from: { x: pool.cx + 15, z: pool.cz }, mode: "cannonball", onSplash: () => splashed++ })
  const api = { meBody: {} }
  run.start(api)
  assert.equal(run.state.phase, "jump")
  assert.equal(run.netAct(), ACTS.stand, "on the edge to people online until you hit the water")
  const air = api.meBody.drive().pose
  assert.ok(air.pelvis.y > 0.5)
  for (let i = 0; i < 30; i++) run.step(1 / 30)
  assert.equal(splashed, 1)
  for (let i = 0; i < 30; i++) run.step(1 / 30)
  assert.equal(run.state.phase, "swim")
  assert.equal(run.state.style, "tread")
  assert.ok(run.state.inPool)
  assert.deepEqual(run.result(), { kind: "swim", cannonball: true })
})

test("the hot tub: a free seat, two side by side for a couple, sitting in it", () => {
  const { L } = get("loscab")
  const tub = leisureSpots(L).find((s) => s.kind === "tub")
  assert.equal(tub.seats.length, 6)
  for (const s of tub.seats) assert.ok(Math.hypot(s.x - tub.x, s.z - tub.z) < tub.R - 0.4, "inside the rim")
  const first = pickTubSeat(tub, tub.at)
  const taken = (s) => s.id === first.id
  const second = pickTubSeat(tub, tub.at, taken)
  assert.notEqual(second.id, first.id)
  const pair = tubPair(tub, tub.at, (s) => s.id === "tub3")
  const i = Number(pair[0].slice(3))
  const j = Number(pair[1].slice(3))
  assert.equal((i + 1) % 6, j, "neighbours")
  assert.ok(!pair.includes("tub3"))
  const run = createTubRun({ spot: tub, seat: tub.seats[2] })
  const api = { meBody: {} }
  run.start(api)
  assert.equal(run.netAct(), ACTS.tub)
  assert.equal(run.me().x, tub.seats[2].x)
  const pose = api.meBody.drive().pose
  assert.ok(pose.head.y > tub.water && pose.pelvis.y < tub.water)
  const shot = run.shot(1, { portrait: true })
  assert.ok(Math.hypot(shot.cam.x - tub.x, shot.cam.z - tub.z) > tub.R + 2, "the camera out round the tub")
  const ex = run.exit()
  assert.ok(Math.hypot(ex.x - tub.x, ex.z - tub.z) > tub.R, "out over the rim")
})

test("the menu, the chips, what's in your hand", () => {
  // original items, each with a price and a way to hold it; every menu's items exist
  for (const [k, list] of Object.entries(MENUS)) for (const id of list) assert.ok(ITEMS[id], `${k}: ${id}`)
  for (const [id, it] of Object.entries(ITEMS)) {
    assert.ok(it.price > 0 && it.price <= 20 && it.sips >= 3 && it.held, id)
    assert.ok(/^[a-z]{2,16}$/.test(id), `${id}: the server's item id pattern`)
  }
  assert.deepEqual(menuFor({ kind: "vending" }).map((i) => i.id), MENUS.vending)
  assert.ok(menuFor({ kind: "vending" }).every((i) => i.machine), "the machine's are the machine's")
  assert.equal(menuFor({ kind: "order", menu: "nope" }).length, 0)
  // a bank like Casino 98's
  const bank = (balance) => ({
    balance,
    take(n) {
      if (n > this.balance) return false
      this.balance -= n
      return true
    },
    give(n) {
      this.balance += n
    },
    needsRefill() {
      return this.balance < 5
    },
    refill() {
      this.balance = 1000
      return true
    },
  })
  const b = bank(100)
  const mango = itemById("mango")
  assert.deepEqual(pay(b, mango), { ok: true, cost: 9, refilled: false })
  assert.equal(b.balance, 91)
  assert.equal(costOf(mango, "both"), 18)
  assert.equal(pay(b, itemById("nothing")).ok, false)
  // broke: the house tops you up, as at the casino
  const broke = bank(2)
  const r = pay(broke, itemById("burger"))
  assert.ok(r.ok && r.refilled && broke.balance === 1000 - 14)
  // short but not broke: refused with how much it is
  const short = bank(8)
  const no = pay(short, itemById("burger"))
  assert.ok(!no.ok && /14 chips/.test(no.error) && short.balance === 8)
  assert.equal(refund(short, itemById("fries")), 6)
  // sips to the end
  let h = startHolding("fizz")
  let n = 0
  while (h) {
    h = sip(h)
    n++
  }
  assert.equal(n, ITEMS.fizz.sips)
  assert.equal(verbFor("burger"), "Bite")
  assert.equal(verbFor("lemonade"), "Sip")
  assert.equal(startHolding("nope"), null)
})

test("Together's leisure asks: the kinds and the words", () => {
  for (const k of ["swim", "tub", "treat"]) assert.ok(togetherById(k)?.act, k)
  assert.equal(togetherById("swim").ask("Ava", { mode: "race" }), "Ava wants to race you in the pool")
  assert.equal(togetherById("treat").ask("Ava", { item: "mango" }), "Ava wants to buy you a mango smoothie")
  // (not on the Together sheet itself: asked from the pool's, the tub's and the counter's sheets)
  assert.ok(TOGETHER.filter((t) => ["swim", "tub", "treat"].includes(t.id)).every((t) => !t.base))
})

test("Vince: by the machine, hot; a cold one from it, and he hands over his keys once", () => {
  const { L } = get("smash")
  L.id = L.id || "smash"
  const bodies = []
  const said = []
  const events = []
  let clock = 0
  const me = { walker: { x: 0, z: 0, y: 0 } }
  const meBody = { key: "me" }
  let found = {}
  const side = createLeisureSide({
    layout: L,
    scene: null,
    clock: () => clock,
    me: () => me,
    meBody,
    makeBody: (key, look, name, extra) => {
      const b = { key, look, name, ...extra }
      bodies.push(b)
      return b
    },
    speak: (b, text) => said.push([b.name, text]),
    net: () => null,
    onEvent: (ev) => events.push(ev),
    blocked: (x, z, r) => L.blocked(x, z, r),
    found: () => found,
  })
  const v = side.vince
  assert.ok(v, "Vince is at SMASH (a sourced drinks fridge)")
  assert.equal(v.name, VINCE.name)
  assert.ok(!L.blocked(v.x, v.z, 0.3), "on open ground")
  assert.ok(Math.hypot(v.x - side.machine.machine.x, v.z - side.machine.machine.z) < 4, "by the machine")
  assert.equal(vinceHome(side.machine, () => false).yaw, Math.atan2(Math.sin(side.machine.machine.a), Math.cos(side.machine.machine.a)))
  // walk up empty-handed: he's hot (and says so), no button for him
  me.walker = { x: v.x + 1.5, z: v.z, y: 0 }
  side.step(0.1, null)
  clock = 1
  side.step(0.1, null)
  assert.ok(said.some(([n, t]) => n === VINCE.name && VINCE_LINES.hot.includes(t)))
  assert.notEqual(side.action()?.what, "give")
  // a drink from the bar isn't from the machine; the machine's is
  side.setHeld("lemonade")
  assert.notEqual(side.action()?.what, "give")
  side.setHeld("fizz")
  const a = side.action()
  assert.equal(a.what, "give")
  assert.equal(a.label, "Give Vince your Fizz")
  side.doAction(a)
  assert.equal(side.held, null, "it's his now")
  assert.equal(events.find((e) => e.type === "leisureGive").item, "fizz")
  clock = 4
  side.step(0.1, null)
  const keys = events.find((e) => e.type === "leisureKeys")
  assert.ok(keys, "the keys")
  assert.equal(keys.from, "Vince")
  assert.ok(said.some(([, t]) => t === VINCE_LINES.keys))
  // only once: he's had his drink
  assert.equal(side.give(), false)
  // a new visit with the keys already found: thanks, no second set
  const events2 = []
  found = { keys: { at: 1 } }
  const side2 = createLeisureSide({ layout: L, scene: null, clock: () => clock, me: () => me, meBody: { key: "me2" }, makeBody: (key, look, name) => ({ key, look, name }), speak: () => {}, net: () => null, onEvent: (ev) => events2.push(ev), blocked: (x, z, r) => L.blocked(x, z, r), found: () => found })
  me.walker = { x: side2.vince.x + 1, z: side2.vince.z, y: 0 }
  side2.setHeld("water")
  side2.doAction(side2.action())
  clock = 10
  side2.step(0.1, null)
  assert.ok(events2.some((e) => e.type === "leisureGive" && e.already))
  assert.ok(!events2.some((e) => e.type === "leisureKeys"))
  // no machine, no Vince
  const sin = get("sinaloa").L
  const side3 = createLeisureSide({ layout: sin, scene: null, clock: () => 0, me: () => me, meBody: {}, makeBody: () => ({}), speak: () => {}, net: () => null, onEvent: () => {} })
  assert.equal(side3.vince, null)
})
