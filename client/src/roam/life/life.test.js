// Roam life (pure parts): places, the catalog and the Bag, the shared cart, the interiors' layouts,
// the wave's turn. node --test client/src/roam/life/life.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { AISLES, BAG, CATALOG, ITEM_IDS, MALL_SHOPS, STORES, addToBag, addUses, applyCart, cartTotal, checkoutSplit, cleanBag, itemOf, itemsFor, payChips, takeFromBag, useVerb } from "./catalog.js"
import { atDoor, cleanPlace, cleanPlaces, doorFor, newPlaceId, placeFor, sharedLabel } from "./places.js"
import { clubLayout, homeLayout, layoutFor, mallLayout, officeLayout, reachable, walkGrid } from "./layouts.js"
import { EMOTES, TOGETHER_HERE, waveYaw } from "./social.js"
import { ITEMS } from "../../components/applets/pickleball/park/leisure/menu.js"
import { DESIGNS, validateLook } from "../../components/applets/pickleball/locker.js"

test("the catalog: original names, real uses, every store stocked", () => {
  for (const id of ITEM_IDS) {
    const it = itemOf(id)
    assert.ok(it.price > 0 && Number.isInteger(it.price), id)
    assert.ok(it.stores.length && it.stores.every((s) => STORES[s]), id)
    if (it.use.eat) assert.ok(ITEMS[it.use.eat], `${id} eats a held item My Park can draw`)
    if (it.use.paddle) assert.ok(DESIGNS.some((d) => d.id === it.use.paddle.paddleDesign), id)
    if (it.use.wear) {
      // (clothes are real Locker Room fields: validateLook keeps them)
      const look = validateLook({ ...it.use.wear })
      for (const [k, v] of Object.entries(it.use.wear)) assert.equal(look[k], v, `${id}.${k}`)
    }
    assert.ok(it.use.keep || useVerb(it), id)
  }
  for (const s of Object.keys(STORES)) assert.ok(itemsFor(s).length > 0, s)
  for (const a of AISLES) assert.ok(itemsFor("club", a.id).length > 0, a.id)
  assert.deepEqual(MALL_SHOPS.filter((s) => !STORES[s]), [])
  // no real store brands
  const words = JSON.stringify({ STORES, CATALOG })
  for (const brand of ["Costco", "Sam's", "Kirkland", "Member's Mark", "Westfield", "Nike", "Adidas", "Selkirk", "JOOLA", "Franklin", "Tiffany", "Hershey"]) assert.ok(!words.includes(brand), brand)
})

test("the Bag: packs, caps, using up, gifts in", () => {
  let r = addToBag({}, { sparkle24: 2, grill: 1 })
  assert.deepEqual(r.bag, { sparkle24: 48, grill: 1 })
  assert.equal(addToBag({}, { nope: 1 }).ok, false)
  assert.equal(addToBag({}, { water40: 25 }).ok, false, `${BAG.each} of one at most`)
  r = takeFromBag(r.bag, "sparkle24", 47)
  assert.equal(r.bag.sparkle24, 1)
  assert.equal(takeFromBag(r.bag, "sparkle24", 1).bag.sparkle24, undefined)
  assert.equal(takeFromBag({}, "grill").ok, false)
  assert.equal(addUses({}, "roses", 1).bag.roses, 1)
  assert.deepEqual(cleanBag({ grill: 2.7, nope: 3, roses: -1 }), { grill: 2 })
})

test("the cart is shared by ops, and checkout pays once and splits what's whose", () => {
  let cart = []
  cart = applyCart(cart, { op: "add", uid: "a1", id: "paddleblue", by: "Ava" })
  cart = applyCart(cart, { op: "add", uid: "b1", id: "grill", by: "Ben" })
  cart = applyCart(cart, { op: "add", uid: "b1", id: "grill", by: "Ben" }) // (the same op twice)
  cart = applyCart(cart, { op: "add", uid: "x", id: "spaceship", by: "Ben" })
  assert.equal(cart.length, 2)
  assert.equal(cartTotal(cart), 120 + 140)
  const split = checkoutSplit(cart, "Ava")
  assert.deepEqual(split.mine, { paddleblue: 1 })
  assert.deepEqual(split.gifts, { Ben: { grill: 1 } })
  assert.equal(applyCart(cart, { op: "remove", uid: "a1" }).length, 1)
  assert.equal(applyCart(cart, { op: "clear" }).length, 0)
  // chips: the bank's shape
  let bal = 300
  const bank = { get balance() { return bal }, take: (n) => (n <= bal ? ((bal -= n), true) : false), needsRefill: () => bal < 5, refill: () => ((bal = 1000), true) }
  assert.ok(payChips(bank, 260).ok)
  assert.equal(bal, 40)
  assert.equal(payChips(bank, 260).ok, false)
})

test("places: a building you pick, a door on its street side, private labels", () => {
  const building = { ring: [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 12 }, { x: 0, z: 12 }] }
  // the street is south of it: the door is on the south wall, 1.6 m out, facing north (in)
  const door = doorFor(building, { x: 10, z: -15 })
  assert.ok(Math.abs(door.z + 1.6) < 1e-6 && Math.abs(door.x - 10) < 1e-6, JSON.stringify(door))
  assert.ok(Math.abs(Math.abs(door.yaw)) < 0.01)
  const p = placeFor({ building, toward: { x: 10, z: -15 }, kind: "work", town: "valencia", id: newPlaceId(() => 0.5) })
  assert.equal(p.label, "Work")
  assert.equal(p.x, 10)
  assert.ok(atDoor(p, 10, -3))
  assert.ok(!atDoor(p, 10, 20))
  assert.equal(cleanPlace({ ...p, kind: "castle" }), null)
  assert.equal(cleanPlace({ ...p, x: 1e9 }), null)
  assert.equal(cleanPlaces([p, p, { ...p, id: "other1" }]).length, 2)
  assert.equal(sharedLabel("Ava", { kind: "home", label: "Home" }), "Ava's home")
  assert.equal(sharedLabel("Chris", { kind: "work", label: "The studio" }), "Chris' work (The studio)")
})

test("interiors: every seat, spot and person can be walked to from the way in; nothing blocks the door", () => {
  const aisles = AISLES
  const shops = MALL_SHOPS.filter((s) => s !== "food").map((id) => ({ id, name: STORES[id].name }))
  for (const L of [officeLayout(1), officeLayout(99), homeLayout(1), homeLayout(7), clubLayout(3, aisles), mallLayout(5, shops)]) {
    const can = reachable(L)
    assert.ok(walkGrid(L).at(L.spawn.x, L.spawn.z), `${L.kind}: the spawn is open`)
    for (const s of L.spots) assert.ok(can(s.x, s.z, Math.max(0.6, s.r * 0.6)), `${L.kind}: spot ${s.id}`)
    for (const s of L.seats) assert.ok(can(s.x, s.z, 1.1), `${L.kind}: seat ${s.id}`)
    for (const n of L.npcs) assert.ok(can(n.x, n.z, 2.0), `${L.kind}: ${n.name}`)
    assert.ok(can(L.exit.x, L.exit.z, L.exit.r), `${L.kind}: the way out`)
    // under 100 m across (a room's slot is 120 m: server/roam/inside.js STRIDE)
    assert.ok(L.W < 100 && L.D < 100)
  }
  // the office has what the owner asked for
  const o = officeLayout(1)
  for (const k of ["desk", "coffee", "fridge", "tv", "clock"]) assert.ok(o.spots.some((s) => s.kind === k), k)
  assert.ok(o.npcs.length >= 5)
  assert.ok(o.seats.some((s) => s.id.startsWith("conf")))
  const h = homeLayout(1)
  assert.equal(h.seats.filter((s) => s.id.startsWith("couch")).length, 3)
  assert.ok(h.spots.some((s) => s.kind === "tv"))
  const c = clubLayout(1, aisles)
  for (const k of ["aisle", "sample", "cart", "checkout", "foodcourt"]) assert.ok(c.spots.some((s) => s.kind === k), k)
  assert.equal(layoutFor("castle"), null)
})

test("emotes: wave first; a wave turns to the person you face, else the nearest close by", () => {
  assert.equal(EMOTES[0].id, "wave")
  assert.equal(TOGETHER_HERE[0], "hug")
  const me = { x: 0, z: 0, yaw: 0 }
  // someone ahead (north) and someone closer behind: the one ahead
  const yaw = waveYaw(me, [{ x: 0.5, z: 10 }, { x: 0, z: -3 }])
  assert.ok(Math.abs(yaw - Math.atan2(0.5, 10)) < 1e-9)
  // nobody ahead: the nearest within 8 m
  assert.ok(Math.abs(waveYaw(me, [{ x: 0, z: -3 }]) - Math.PI) < 1e-9)
  assert.equal(waveYaw(me, [{ x: 0, z: -30 }]), null)
})
