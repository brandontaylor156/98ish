// Dream House rules tests. Run: node --test client/src/components/applets/dollhouse/
import test from "node:test"
import assert from "node:assert/strict"
import * as M from "./model.js"
import { ITEMS, itemDef } from "./catalogData.js"

const one = (house) => M.live(house)[0]

test("the catalog has 80+ things in every category, each with a size and a mount", () => {
  assert.ok(ITEMS.length >= 80, `only ${ITEMS.length}`)
  const ids = new Set()
  for (const d of ITEMS) {
    assert.ok(!ids.has(d.id), `duplicate ${d.id}`)
    ids.add(d.id)
    assert.ok(d.w > 0 && d.h > 0, d.id)
    assert.ok(["floor", "wall", "ceiling", "free"].includes(d.mount), d.id)
  }
})

test("floor things snap to the floor of the room they're dropped in", () => {
  const h = M.emptyHouse()
  const bed = M.addItem(h, "bed", 200, 300, "a").item // dropped high up in the bedroom
  const room = M.ROOM.bedroom
  assert.equal(M.roomOf(bed).id, "bedroom")
  assert.ok(bed.y >= M.floorTop(room) && bed.y <= room.y + room.h, `bed at ${bed.y}`)
  // never sticks out of the room sideways
  const sofa = M.addItem(h, "sofa", 61, 700, "a").item
  assert.ok(sofa.x - itemDef("sofa").w / 2 >= M.ROOM.living.x)
})

test("wall things stay on the wall, ceiling things hang from the ceiling", () => {
  const h = M.emptyHouse()
  const poster = M.addItem(h, "poster_heart", 200, 480, "a").item // dropped on the floor
  const room = M.ROOM.bedroom
  assert.ok(poster.y <= M.floorTop(room) + 4, "poster went to the floor")
  assert.ok(poster.y - itemDef("poster_heart").h >= room.y, "poster pokes through the ceiling")
  const lamp = M.addItem(h, "pendant", 700, 690, "a").item
  assert.equal(lamp.y - itemDef("pendant").h, M.ROOM.kitchen.y)
})

test("small things land on the tabletop under them, or else the floor", () => {
  const h = M.emptyHouse()
  const stand = M.addItem(h, "nightstand", 300, 480, "a").item
  const lamp = M.addItem(h, "table_lamp", 302, 300, "a").item
  assert.equal(lamp.y, stand.y - itemDef("nightstand").top)
  const cake = M.addItem(h, "cake", 150, 300, "a").item
  assert.ok(cake.y > M.floorTop(M.ROOM.bedroom))
  // moving the lamp off the nightstand drops it to the floor
  const moved = M.moveItem(h, lamp.id, 420, 320, "a").item
  assert.ok(moved.y > M.floorTop(M.ROOM.bedroom))
})

test("rooms are found by point, and things dropped outside go to the nearest room", () => {
  assert.equal(M.roomAt(100, 600).id, "living")
  assert.equal(M.roomAt(1000, 700).id, "garden")
  assert.equal(M.roomAt(10, 10), null)
  const h = M.emptyHouse()
  const t = M.addItem(h, "tree", 1500, 900, "a").item
  assert.equal(M.roomOf(t).id, "garden")
})

test("stacking: new things go on top, rugs go underneath, front/back/forward/backward", () => {
  const h = M.emptyHouse()
  const a = M.addItem(h, "sofa", 200, 700, "a").item
  const b = M.addItem(h, "coffee_table", 210, 710, "a").item
  const rug = M.addItem(h, "rug_round", 210, 716, "a").item
  const order = () => M.sorted(h).map((i) => i.id)
  assert.deepEqual(order(), [rug.id, a.id, b.id])
  M.restack(h, a.id, "front", "a")
  assert.deepEqual(order(), [rug.id, b.id, a.id])
  M.restack(h, a.id, "backward", "a")
  assert.deepEqual(order(), [rug.id, a.id, b.id])
  M.restack(h, b.id, "back", "a")
  assert.equal(order()[0], b.id)
  M.restack(h, b.id, "forward", "a")
  assert.deepEqual(order(), [rug.id, b.id, a.id])
  assert.equal(M.restack(h, a.id, "front", "a"), null, "already at the front")
})

test("flip, duplicate, delete and undo-style restore", () => {
  const h = M.emptyHouse()
  const cat = M.addItem(h, "cat", 200, 480, "a").item
  const before = { ...h.items }
  M.flipItem(h, cat.id, "a")
  assert.equal(h.items[cat.id].f, 1)
  assert.equal(before[cat.id].f, 0, "edits don't change the old copy")
  const dup = M.duplicateItem(h, cat.id, "a").item
  assert.equal(dup.k, "cat")
  assert.notEqual(dup.id, cat.id)
  M.removeItem(h, cat.id, "a")
  assert.equal(M.liveCount(h), 1)
  M.restoreItem(h, cat.id, before[cat.id], "a")
  assert.equal(M.liveCount(h), 2)
  assert.equal(h.items[cat.id].f, 0)
  M.restoreItem(h, dup.id, null, "a")
  assert.equal(M.liveCount(h), 1)
})

test("people keep a checked name and look", () => {
  const h = M.emptyHouse()
  const p = M.addItem(h, "avatar", 200, 700, "a", { name: "  Sweet\u0000 pea that is very long  ", look: { skin: 99, hairStyle: "mohawk", hair: 2 } }).item
  assert.equal(p.name, "Sweet pea that i")
  assert.ok(p.look.skin >= 0 && p.look.skin < 6)
  assert.equal(p.look.hair, 2)
  assert.notEqual(p.look.hairStyle, "mohawk")
  M.setPerson(h, p.id, { name: "Bee", look: { ...p.look, acc: "glasses" } }, "a")
  assert.equal(h.items[p.id].name, "Bee")
  assert.equal(h.items[p.id].look.acc, "glasses")
})

test("rooms: wallpaper and floor, only known patterns", () => {
  const h = M.emptyHouse()
  M.setRoom(h, "kitchen", { wall: "daisy", floor: "mono" }, "a")
  assert.equal(h.rooms.kitchen.wall, "daisy")
  M.setRoom(h, "kitchen", { wall: "<script>" }, "a")
  assert.equal(h.rooms.kitchen.wall, "daisy")
})

test("save and load round-trip in a compact form", () => {
  const h = M.starterHouse("abc")
  M.setRoom(h, "attic", { wall: "dots" }, "abc")
  const victim = one(h)
  M.removeItem(h, victim.id, "abc")
  const data = M.serialize(h)
  const text = JSON.stringify(data)
  assert.ok(text.length < 8000, `${text.length} bytes`)
  const back = M.deserialize(text)
  assert.deepEqual(M.serialize(back), data)
  assert.equal(back.rooms.attic.wall, "dots")
  assert.ok(back.items[victim.id].del)
})

test("loading drops broken bits and migrates the old format", () => {
  const bad = { v: 2, r: { bedroom: ["nope", "oak", 1, ""], attic: ["dots", "oak", 1, ""] }, i: [["x1", "bed", 100, 400, 0, 1, 1, ""], ["x2", "spaceship", 1, 1, 0, 1, 1, ""], ["BAD ID", "bed", 1, 1, 0, 1, 1, ""], "junk"], d: [["x3", 2, "z"], [5]] }
  const h = M.deserialize(bad)
  assert.equal(M.liveCount(h), 1)
  assert.equal(h.rooms.bedroom.wall, M.DEFAULT_ROOMS.bedroom.wall)
  assert.equal(h.rooms.attic.wall, "dots")
  assert.ok(h.items.x3.del)
  assert.equal(M.deserialize("not json"), null)
  assert.equal(M.deserialize({ hello: 1 }), null)

  const old = { version: 1, rooms: { kitchen: { wallpaper: "brick", floor: "stone" } }, items: [{ kind: "sofa", x: 200, y: 700, flip: true }, { kind: "avatar", x: 300, y: 700, name: "Lou", look: { skin: 2 } }] }
  const m = M.deserialize(old)
  assert.equal(M.liveCount(m), 2)
  assert.equal(m.rooms.kitchen.wall, "brick")
  const person = M.live(m).find((i) => i.k === "avatar")
  assert.equal(person.name, "Lou")
  assert.equal(M.live(m).find((i) => i.k === "sofa").f, 1)
})

test("too many things: the house stops at its cap", () => {
  const h = M.emptyHouse()
  for (let i = 0; i < M.MAX_ITEMS; i++) assert.ok(M.addItem(h, "duck", 100 + (i % 300), 700, "a"))
  assert.equal(M.addItem(h, "duck", 100, 700, "a"), null)
  const other = M.emptyHouse()
  const op = M.addItem(other, "cake", 100, 700, "b").ops[0]
  assert.equal(M.applyOp(h, op), false, "a merge can't push it past the cap either")
})

test("concurrent edits merge the same way everywhere (last writer by version, then by tag)", () => {
  const base = M.starterHouse("s")
  const sofa = M.live(base).find((i) => i.k === "sofa")
  const lamp = M.live(base).find((i) => i.k === "floor_lamp")
  const alice = M.deserialize(M.serialize(base))
  const bob = M.deserialize(M.serialize(base))
  const aOps = [...M.moveItem(alice, sofa.id, 300, 700, "alice").ops, ...M.flipItem(alice, lamp.id, "alice").ops]
  const bOps = [...M.moveItem(bob, sofa.id, 150, 700, "bob").ops, ...M.removeItem(bob, lamp.id, "bob").ops]
  const bOps2 = M.addItem(bob, "cake", 700, 700, "bob").ops
  const bRoom = M.setRoom(bob, "garden", { floor: "sand" }, "bob").ops
  const aRoom = M.setRoom(alice, "garden", { floor: "meadow" }, "alice").ops
  // each side gets the other's ops (in any order)
  for (const op of [...bOps, ...bOps2, ...bRoom]) M.applyOp(alice, op)
  for (const op of [...aRoom, ...aOps].reverse()) M.applyOp(bob, op)
  assert.deepEqual(M.serialize(alice), M.serialize(bob))
  // same version: "bob" > "alice" wins the sofa and the garden floor
  assert.equal(alice.items[sofa.id].x, M.snap(base, "sofa", 150, 700).x)
  assert.equal(alice.rooms.garden.floor, "sand")
  // the delete (newer than the flip? same version: bob wins) holds on both
  assert.ok(alice.items[lamp.id].del)
  assert.ok(M.live(alice).some((i) => i.k === "cake"))
  // an old op arriving late changes nothing
  assert.equal(M.applyOp(alice, aOps[0]), false)
  // merge() of two whole houses agrees too
  assert.deepEqual(M.serialize(M.merge(base, alice)), M.serialize(alice))
})

test("ops are checked: bad ones are refused", () => {
  const h = M.emptyHouse()
  assert.equal(M.applyOp(h, { t: "i", e: ["ok1", "nope", 1, 1, 0, 0, 1, "a"] }), false)
  assert.equal(M.applyOp(h, { t: "i", e: ["ok1", "bed", "x", 1, 0, 0, 1, "a"] }), false)
  assert.equal(M.applyOp(h, { t: "i", e: ["ok1", "bed", 1, 1, 0, 0.5, 1, "a"] }), false)
  assert.equal(M.applyOp(h, { t: "r", id: "dungeon", e: ["cream", "oak", 5, "a"] }), false)
  assert.equal(M.applyOp(h, { t: "x" }), false)
  assert.equal(M.applyOp(h, null), false)
  assert.equal(M.applyOp(h, { t: "i", e: ["ok1", "bed", 99999, -5, 1, 3, 1, "a"] }), true)
  assert.equal(h.items.ok1.x, M.WORLD.w)
  assert.equal(h.items.ok1.y, 0)
})

test("pets wander but stay inside their room", () => {
  const h = M.emptyHouse()
  const dog = M.addItem(h, "dog", 300, 716, "a").item
  const room = M.ROOM.living
  let movedSome = false
  for (let t = 0; t < 120; t += 0.25) {
    const o = M.petOffset(dog, t)
    const x = dog.x + o.dx
    assert.ok(x - itemDef("dog").w / 2 >= room.x - 0.5 && x + itemDef("dog").w / 2 <= room.x + room.w + 0.5, `dog left the room at t=${t}`)
    if (Math.abs(o.dx) > 5) movedSome = true
  }
  assert.ok(movedSome)
  assert.deepEqual(M.petOffset(M.addItem(h, "sofa", 200, 700, "a").item, 3), { dx: 0, dy: 0, dir: 0, moving: false })
})

test("the starter house puts everything in the room it was meant for", () => {
  const h = M.starterHouse("s")
  const where = (k) => M.live(h).filter((i) => i.k === k).map((i) => M.roomOf(i).id)
  assert.deepEqual(where("tv"), ["living"])
  assert.deepEqual(where("hanging_plant"), ["bathroom"])
  assert.deepEqual(where("pendant"), ["kitchen"])
  assert.deepEqual(where("kettle"), ["kitchen"])
  assert.deepEqual(where("telescope"), ["attic"])
  assert.equal(where("avatar").length, 2)
  // the lamp sits on the nightstand, the kettle on the stove
  const stand = M.live(h).find((i) => i.k === "nightstand")
  const lamp = M.live(h).find((i) => i.k === "table_lamp")
  assert.equal(lamp.y, stand.y - itemDef("nightstand").top)
})
