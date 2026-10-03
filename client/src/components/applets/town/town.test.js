// Sunny Acres rules tests. Run: node --test client/src/components/applets/town/
import test from "node:test"
import assert from "node:assert/strict"
import * as G from "./game.js"
import { BARN_START, CROPS, EXPANSIONS, FACTORIES, GOODS, HOUSES, LEVEL_XP, PENS, TRAIN_LEVEL, levelForXp, orderSlots, xpForLevel } from "./data.js"

const T0 = 1_700_000_000_000
const S = 1000
const fields = (s) => s.objs.filter((o) => o.t === "field")
const find = (s, t) => s.objs.find((o) => o.t === t)

// play the tutorial: plant, harvest, make feed, deliver the first order
const playTutorial = (s, now = T0) => {
  for (const f of fields(s)) assert.ok(G.plant(s, f.i, "wheat", now).ok)
  now += 5 * S
  for (const f of fields(s)) assert.ok(G.harvest(s, f.i, now).ok)
  const mill = find(s, "feedmill")
  assert.ok(G.queueProduct(s, mill.i, "cowfeed", now).ok)
  now += 5 * S
  assert.ok(G.collectFactory(s, mill.i, now).ok)
  assert.ok(G.deliverOrder(s, 0, now).ok)
  return now
}

test("a new town starts with the tutorial order and only orders it can fill", () => {
  const s = G.newGame(T0, 42)
  assert.equal(s.level, 1)
  assert.deepEqual(s.orders[0].need, { cowfeed: 1, wheat: 2 })
  assert.equal(s.orders.length, orderSlots(1))
  for (const o of s.orders) for (const g of Object.keys(o.need)) assert.ok(G.obtainable(s, g), g)
  assert.equal(G.population(s), 12)
  assert.equal(G.popCap(s), 40)
  assert.equal(fields(s).length, 4)
})

test("the tutorial walks from planting to the first delivery and a level up", () => {
  const s = G.newGame(T0, 1)
  assert.equal(s.tut, 0)
  const f = fields(s)[0]
  assert.equal(G.harvest(s, f.i, T0).ok, false)
  G.plant(s, f.i, "wheat", T0)
  assert.equal(s.tut, 1)
  assert.equal(G.fieldStage(f, T0 + 1 * S), 1)
  assert.equal(G.harvest(s, f.i, T0 + 2 * S).ok, false, "not ripe yet")
  for (const o of fields(s).slice(1)) G.plant(s, o.i, "wheat", T0)
  let now = T0 + 5 * S
  assert.equal(G.fieldStage(f, now), 4)
  for (const o of fields(s)) assert.ok(G.harvest(s, o.i, now).ok)
  assert.equal(s.tut, 2)
  assert.equal(s.goods.wheat, 10)
  const mill = find(s, "feedmill")
  G.queueProduct(s, mill.i, "cowfeed", now)
  assert.equal(s.tut, 3)
  assert.equal(s.goods.wheat, 8)
  assert.equal(G.collectFactory(s, mill.i, now + 4 * S).ok, false)
  now += 5 * S
  G.collectFactory(s, mill.i, now)
  assert.equal(s.tut, 4)
  assert.ok(G.canDeliver(s, 0))
  const coins = s.coins
  G.deliverOrder(s, 0, now)
  assert.equal(s.tut, 5)
  assert.equal(s.level, 2, "the first order levels you up")
  assert.ok(s.coins > coins + 40, "order coins plus level-up coins")
  const ev = G.drainEvents(s)
  assert.ok(ev.some((e) => e.type === "level" && e.level === 2))
  assert.deepEqual(G.drainEvents(s), [])
  // after the tutorial, crops take their real time
  G.plant(s, f.i, "wheat", now)
  assert.equal(f.e - now, 20 * S)
})

test("XP thresholds and multi-level jumps pay every level's gifts", () => {
  assert.equal(levelForXp(0), 1)
  assert.equal(levelForXp(14), 1)
  assert.equal(levelForXp(15), 2)
  assert.equal(levelForXp(39), 2)
  assert.equal(levelForXp(40), 3)
  for (let l = 2; l < LEVEL_XP.length; l++) assert.ok(xpForLevel(l) > xpForLevel(l - 1))
  assert.ok(xpForLevel(30) > xpForLevel(29))
  const s = G.newGame(T0, 3)
  const clovers = s.clovers
  G.addXp(s, xpForLevel(4), T0)
  assert.equal(s.level, 4)
  const lv = G.drainEvents(s).filter((e) => e.type === "level").map((e) => e.level)
  assert.deepEqual(lv, [2, 3, 4])
  assert.equal(s.clovers, clovers + 2 + 3 + 2)
  assert.equal(s.mats.hammer, 2)
  assert.equal(s.orders.length, orderSlots(4))
  const p = G.xpProgress(s)
  assert.equal(p.into, 0)
  assert.equal(p.frac, 0)
})

test("production lines run one job after another and respect their slots", () => {
  const s = G.newGame(T0, 5)
  s.tut = 99
  s.goods.wheat = 20
  const mill = find(s, "feedmill")
  assert.equal(mill.sl, 3)
  for (let k = 0; k < 3; k++) assert.ok(G.queueProduct(s, mill.i, "cowfeed", T0).ok)
  assert.deepEqual(mill.q.map((j) => j.e - T0), [15 * S, 30 * S, 45 * S])
  assert.equal(G.queueProduct(s, mill.i, "cowfeed", T0).ok, false, "slots full")
  assert.equal(s.goods.wheat, 14)
  const jobs = G.factoryJobs(mill, T0 + 20 * S)
  assert.deepEqual(jobs.map((j) => [j.done, j.running]), [[true, false], [false, true], [false, false]])
  const r = G.collectFactory(s, mill.i, T0 + 31 * S)
  assert.deepEqual(r.goods, ["cowfeed", "cowfeed"])
  assert.equal(mill.q.length, 1)
  // a job queued later starts after the last one, not from now
  G.queueProduct(s, mill.i, "cowfeed", T0 + 31 * S)
  assert.equal(mill.q[1].e, T0 + 60 * S)
  // an idle line starts from now
  const later = T0 + 500 * S
  G.collectFactory(s, mill.i, later)
  G.queueProduct(s, mill.i, "cowfeed", later)
  assert.equal(mill.q[0].e, later + 15 * S)
  // locked recipes and missing ingredients
  assert.match(G.queueProduct(s, mill.i, "sheepfeed", later).reason, /level 7/)
  s.goods = {}
  assert.equal(G.queueProduct(s, mill.i, "cowfeed", later).ok, false)
  // extra slots cost coins
  s.coins = 1000
  assert.ok(G.addSlot(s, mill.i).ok)
  assert.equal(mill.sl, 4)
})

test("speeding up a factory finishes the running job and moves the rest up", () => {
  const s = G.newGame(T0, 6)
  s.tut = 99
  s.goods.wheat = 10
  const mill = find(s, "feedmill")
  G.queueProduct(s, mill.i, "cowfeed", T0)
  G.queueProduct(s, mill.i, "cowfeed", T0)
  const now = T0 + 5 * S
  assert.equal(G.speedUpCost(s, { obj: mill.i }, now), 1)
  const c = s.clovers
  assert.ok(G.speedUp(s, { obj: mill.i }, now).ok)
  assert.equal(s.clovers, c - 1)
  assert.deepEqual(mill.q.map((j) => j.e - now), [0, 15 * S])
})

test("the Barn has a capacity and won't take more than it holds", () => {
  const s = G.newGame(T0, 7)
  s.tut = 99
  assert.equal(G.barnCap(s), BARN_START)
  s.goods = { wheat: BARN_START - 1 }
  const f = fields(s)[0]
  G.plant(s, f.i, "wheat", T0)
  const r = G.harvest(s, f.i, T0 + 60 * S)
  assert.equal(r.ok, false)
  assert.match(r.reason, /Barn is full/)
  assert.equal(f.c, "wheat", "the crop stays in the field")
  // a factory hands over only what fits
  s.goods = { wheat: BARN_START - 2 }
  const mill = find(s, "feedmill")
  for (let k = 0; k < 3; k++) G.queueProduct(s, mill.i, "cowfeed", T0)
  assert.equal(G.barnUsed(s), BARN_START - 8)
  s.goods.corn = 7
  const got = G.collectFactory(s, mill.i, T0 + 100 * S)
  assert.equal(got.goods.length, 1)
  assert.equal(G.barnFree(s), 0)
  assert.equal(mill.q.length, 2)
  // materials don't use Barn space; upgrading needs hammers
  s.mats.brick = 5
  assert.equal(G.barnFree(s), 0)
  s.coins = 1000
  assert.match(G.upgradeBarn(s).reason, /hammer/)
  s.mats.hammer = 1
  assert.ok(G.upgradeBarn(s).ok)
  assert.equal(G.barnCap(s), BARN_START + 25)
  // selling
  const coins = s.coins
  assert.ok(G.sellGood(s, "wheat", 2).ok)
  assert.equal(s.coins, coins + 2 * GOODS.wheat.price)
})

test("orders only ask for goods the town can make", () => {
  const types = [...Object.keys(FACTORIES), ...Object.keys(PENS)]
  for (let seed = 1; seed <= 60; seed++) {
    const s = G.newGame(T0, seed)
    s.tut = 99
    const level = 1 + (seed % 14)
    s.level = level
    s.xp = xpForLevel(level)
    // a random set of buildings, some still under construction
    types.forEach((t, k) => {
      if ((seed >> k) & 1 && !G.count(s, t)) s.objs.push({ i: s.nextId++, t, x: 0, y: 0, q: [], sl: 2, a: [null, null, null], ...(k % 3 === 0 ? { b: T0 + 9e9 } : {}) })
    })
    for (let n = 0; n < 40; n++) {
      const o = G.genOrder(s)
      const need = Object.keys(o.need)
      assert.ok(need.length >= 1 && need.length <= 3)
      for (const g of need) {
        assert.ok(GOODS[g].lvl <= level, `${g} is level ${GOODS[g].lvl}, town is ${level}`)
        assert.ok(G.obtainable(s, g), `${g} isn't obtainable`)
        assert.ok(o.need[g] >= 1)
        // and you can get everything that goes into it
        for (const k of Object.keys(GOODS[g].inputs)) assert.ok(G.obtainable(s, k), `${k} for ${g}`)
      }
      assert.ok(o.coins > 0 && o.xp > 0)
    }
  }
})

test("delivering and skipping orders refills the board after a wait", () => {
  const s = G.newGame(T0, 9)
  let now = playTutorial(s)
  assert.deepEqual(s.orders[0], { wait: now + G.ORDER_WAIT_DONE * S })
  G.tick(s, now + (G.ORDER_WAIT_DONE - 1) * S)
  assert.ok(!s.orders[0].need)
  G.tick(s, now + G.ORDER_WAIT_DONE * S)
  assert.ok(s.orders[0].need)
  now += 20 * S
  assert.ok(G.skipOrder(s, 1, now).ok)
  assert.equal(s.orders[1].wait, now + G.ORDER_WAIT_SKIP * S)
  assert.ok(G.speedUp(s, { order: 1 }, now).ok)
  assert.ok(s.orders[1].need, "hurrying brings a new order")
  assert.equal(G.deliverOrder(s, 2, now).ok, G.canDeliver(s, 2))
})

test("time keeps running while the game is closed", () => {
  const s = G.newGame(T0, 11)
  let now = playTutorial(s)
  s.goods.wheat = 10
  s.coins = 5000
  const f = fields(s)[0]
  G.plant(s, f.i, "wheat", now)
  const mill = find(s, "feedmill")
  G.queueProduct(s, mill.i, "cowfeed", now)
  G.queueProduct(s, mill.i, "cowfeed", now)
  const h = G.build(s, "bungalow", 5, 16, now)
  assert.ok(h.ok, h.reason)
  assert.equal(G.population(s), 12, "not lived in until it's built")
  G.skipOrder(s, 1, now)
  const xp = s.xp
  const saved = G.serialize(s)
  // two hours later
  const later = now + 2 * 3600 * S
  const t = G.deserialize(saved, later)
  assert.equal(G.fieldStage(G.objById(t, f.i), later), 4)
  assert.deepEqual(G.factoryJobs(G.objById(t, mill.i), later).map((j) => j.done), [true, true])
  assert.equal(G.population(t), 22)
  assert.equal(t.xp, xp + HOUSES.bungalow.xp, "the house's XP arrives when it's done")
  assert.ok(t.orders.every((o) => o.need), "every order slot is filled again")
  assert.equal(t.t, later)
  // the clock moving backwards doesn't break anything: timers just look longer
  const u = G.deserialize(saved, now - 3600 * S)
  assert.equal(G.fieldStage(G.objById(u, f.i), now - 3600 * S), 1)
})

test("the train comes at its level, takes goods for materials and returns", () => {
  const s = G.newGame(T0, 13)
  s.tut = 99
  assert.equal(s.train.st, "locked")
  G.addXp(s, xpForLevel(TRAIN_LEVEL) - s.xp, T0)
  assert.equal(s.train.st, "here")
  assert.equal(s.train.cars.length, 3)
  for (const c of s.train.cars) assert.ok(G.obtainable(s, c.g), c.g)
  const car = s.train.cars[0]
  assert.equal(G.loadCar(s, 0, T0).ok, false)
  s.goods[car.g] = car.n
  const before = s.mats[car.m] || 0
  assert.ok(G.loadCar(s, 0, T0).ok)
  assert.equal(s.mats[car.m], before + 1)
  assert.equal(G.loadCar(s, 0, T0).ok, false, "already loaded")
  // leaving with empty cars gives no bonus
  assert.equal(G.sendTrain(s, T0).bonus, null)
  assert.equal(s.train.st, "away")
  G.tick(s, s.train.at - 1)
  assert.equal(s.train.st, "away")
  // fill every car and get the bonus
  G.tick(s, s.train.at)
  assert.equal(s.train.st, "here")
  for (const c of s.train.cars) s.goods[c.g] = (s.goods[c.g] || 0) + c.n
  s.train.cars.forEach((_, k) => assert.ok(G.loadCar(s, k, T0).ok))
  const coins = s.coins
  const r = G.sendTrain(s, T0)
  assert.ok(r.bonus)
  assert.equal(s.coins, coins + r.bonus.coins)
})

test("building: placement, population room, construction, moving and selling", () => {
  const s = G.newGame(T0, 15)
  s.tut = 99
  s.coins = 10000
  // on another building, on locked land, off the map
  const barn = find(s, "barn")
  assert.equal(G.canPlace(s, "cottage", barn.x, barn.y), false)
  assert.equal(G.canPlace(s, "cottage", 24, 10), false, "east meadow isn't ours yet")
  assert.equal(G.canPlace(s, "cottage", 29, 29), false)
  assert.equal(G.canPlace(s, "cottage", 5, 16), true)
  assert.equal(G.build(s, "cottage", barn.x, barn.y, T0).ok, false)
  // room for people
  const r = G.build(s, "cottage", 5, 16, T0)
  assert.ok(r.ok)
  assert.equal(r.obj.b, T0 + HOUSES.cottage.time * S)
  for (let k = 0; G.offer(s, "cottage").why === null && k < 20; k++) {
    const spot = [[8, 16], [5, 18], [14, 17], [17, 17], [19, 15], [19, 12]][k]
    assert.ok(G.build(s, "cottage", ...spot, T0).ok)
  }
  assert.match(G.offer(s, "cottage").why, /community building/)
  assert.ok(G.plannedPopulation(s) <= G.popCap(s))
  // level locks and population needs
  assert.match(G.offer(s, "dairy").why, /level 3/)
  G.addXp(s, xpForLevel(3), T0)
  G.tick(s, T0 + 3600 * S)
  assert.equal(G.offer(s, "dairy").why, null)
  // moving
  const cot = r.obj
  assert.ok(G.move(s, cot.i, 14, 19, true).ok)
  assert.equal(cot.f, 1)
  assert.equal(G.move(s, cot.i, barn.x, barn.y).ok, false)
  assert.equal(G.move(s, find(s, "station").i, 6, 18).ok, false)
  // selling a tree pays back half; houses can't be sold
  const tree = find(s, "tree")
  const coins = s.coins
  assert.ok(G.sellObj(s, tree.i).ok)
  assert.equal(s.coins, coins + 7)
  assert.equal(G.sellObj(s, cot.i).ok, false)
})

test("expansions open new land for coins and shovels", () => {
  const s = G.newGame(T0, 17)
  s.tut = 99
  s.coins = 10000
  assert.match(G.expand(s, 0, T0).reason, /level 3/)
  G.addXp(s, xpForLevel(3), T0)
  assert.equal(s.mats.shovel, 1)
  assert.ok(G.expand(s, 0, T0).ok)
  assert.equal(s.mats.shovel, undefined)
  assert.equal(G.canPlace(s, "cottage", 24, 10), true)
  assert.equal(G.expand(s, 0, T0).ok, false)
  assert.equal(EXPANSIONS.length, 3)
})

test("animal pens eat feed and give goods", () => {
  const s = G.newGame(T0, 19)
  s.tut = 99
  s.coins = 1000
  G.addXp(s, xpForLevel(2), T0)
  const r = G.build(s, "cowpen", 5, 15, T0)
  assert.ok(r.ok, r.reason)
  const pen = r.obj
  assert.equal(G.feedPen(s, pen.i, T0).ok, false, "still being built")
  G.tick(s, T0 + 30 * S)
  assert.match(G.feedPen(s, pen.i, T0 + 30 * S).reason, /Cow Feed/)
  s.goods.cowfeed = 2
  assert.equal(G.feedPen(s, pen.i, T0 + 30 * S).fed, 2)
  assert.deepEqual(G.penState(pen, T0 + 30 * S), { hungry: 1, ready: 0, busy: 2 })
  assert.equal(G.collectPen(s, pen.i, T0 + 31 * S).ok, false)
  const later = T0 + 30 * S + PENS.cowpen.time * S
  assert.equal(G.collectPen(s, pen.i, later).n, 2)
  assert.equal(s.goods.milk, 2)
  assert.deepEqual(G.penState(pen, later), { hungry: 3, ready: 0, busy: 0 })
})

test("a save round-trips exactly and stays small", () => {
  const s = G.newGame(T0, 21)
  const now = playTutorial(s)
  G.tick(s, now)
  G.drainEvents(s)
  const text = G.serialize(s)
  assert.ok(text.length < 4000, `save is ${text.length} bytes`)
  const t = G.deserialize(text, now)
  assert.equal(G.serialize(t), text)
  assert.equal(G.deserialize("not json", now), null)
  assert.equal(G.deserialize("{\"objs\":5}", now), null)
})

test("older saves are brought up to date", () => {
  const s = G.newGame(T0, 23)
  const old = JSON.parse(G.serialize(s))
  old.v = 1
  old.exp = 1 // version 1 counted expansions
  delete old.train
  delete old.stats
  old.objs.push({ i: 999, t: "dairy", x: 0, y: 0 }) // a factory saved without its line
  const t = G.deserialize(JSON.stringify(old), T0)
  assert.equal(t.v, G.SAVE_VERSION)
  assert.deepEqual(t.exp, [1, 0, 0])
  assert.equal(t.train.st, "locked")
  assert.equal(t.stats.orders, 0)
  assert.deepEqual(G.objById(t, 999).q, [])
  assert.equal(t.nextId, 1000)
})

test("every recipe input exists and every crop has a sensible timer", () => {
  for (const g of Object.values(GOODS)) for (const k of Object.keys(g.inputs)) assert.ok(GOODS[k], `${g.id} needs ${k}`)
  for (const c of CROPS) assert.ok(c.time >= 20 && c.time <= 600)
  assert.ok(Object.keys(GOODS).length >= 25)
})

// ---- playing together ----
test("a signed-in town gets a mailbox; a couple's gets a welcome sign and the Couple's Cottage", () => {
  const s = G.newGame(T0, 31)
  assert.equal(G.offer(s, "lovecottage").why, "Pair up with your partner in Us to unlock it.")
  assert.ok(G.ensureMailbox(s))
  assert.equal(G.ensureMailbox(s), false, "only one")
  const box = find(s, "mailbox")
  const barn = find(s, "barn")
  assert.ok(Math.abs(box.x - barn.x) + Math.abs(box.y - barn.y) < 8, "near the Barn")
  assert.ok(G.setPartner(s, "Bobby"))
  assert.equal(s.paired, "Bobby")
  assert.ok(find(s, "welcome"))
  assert.equal(G.offer(s, "lovecottage").why, null)
  assert.equal(G.offer(s, "lovecottage").coins, 0)
  assert.ok(G.build(s, "lovecottage", 5, 16, T0).ok)
  assert.match(G.offer(s, "lovecottage").why, /already/)
  G.setPartner(s, null)
  assert.equal(s.paired, undefined)
  // specials and couples' things survive a save
  const t = G.deserialize(G.serialize(s), T0)
  assert.ok(find(t, "mailbox") && find(t, "welcome") && find(t, "lovecottage"))
  assert.equal(G.offer(t, "hearttree").why, "Only your partner can give you this one.")
})

test("effects from friends: help fills the order once; gifts land in the Barn and the gift shelf", () => {
  const s = G.newGame(T0, 32)
  const order = s.orders[0]
  const coins = s.coins
  const help = { id: "e1", kind: "help", req: { kind: "order", slot: 0, need: { ...order.need } }, by: "Bobby" }
  const r = G.applyEffect(s, help, T0)
  assert.ok(r.ok && r.filled)
  assert.ok(s.coins >= coins + order.coins)
  assert.equal(s.orders[0].need, undefined)
  assert.equal(G.applyEffect(s, help, T0).ok, false, "once")
  // a request for an order that's gone sends the goods to the Barn instead
  const wheat = s.goods.wheat || 0
  const late = G.applyEffect(s, { id: "e2", kind: "help", req: { kind: "order", slot: 0, need: { wheat: 3 } }, by: "Bobby" }, T0)
  assert.equal(late.filled, false)
  assert.equal(s.goods.wheat, wheat + 3)
  // helping someone: goods leave, coins and XP arrive
  s.goods.cowfeed = 2
  const xp = s.xp
  G.applyEffect(s, { id: "e3", kind: "helped", goods: { cowfeed: 2 }, coins: 30, xp: 5, owner: "Bobby" }, T0)
  assert.equal(s.goods.cowfeed, undefined)
  assert.equal(s.xp, xp + 5)
  assert.equal(s.stats.helped, 1)
  // gifts
  G.applyEffect(s, { id: "e4", kind: "gift", goods: { milk: 2 }, decor: "hearttree", from: "Bobby" }, T0)
  assert.equal(s.goods.milk, 2)
  assert.equal(s.inv.hearttree, 1)
  assert.ok(G.build(s, "hearttree", 5, 16, T0).ok)
  assert.equal(s.inv.hearttree, undefined)
  assert.equal(G.applyEffect(s, { id: "e5", kind: "nonsense" }, T0).ok, false)
  // the list of used effects stays short
  for (let k = 0; k < 250; k++) G.applyEffect(s, { id: `x${k}`, kind: "goal", coins: 0, xp: 0, clovers: 0 }, T0)
  assert.equal(s.claimed.length, G.MAX_CLAIMED)
})

test("help requests read what the town needs; rewards grow with what the goods are worth", () => {
  const s = G.newGame(T0, 33)
  assert.deepEqual(G.requestNeed(s, "order", 0), s.orders[0].need)
  assert.equal(G.requestNeed(s, "order", 9), null)
  assert.equal(G.requestNeed(s, "car", 0), null, "no train yet")
  assert.ok(G.sameNeed({ a: 1, b: 2 }, { b: 2, a: 1 }))
  assert.equal(G.sameNeed({ a: 1 }, { a: 2 }), false)
  assert.equal(G.sameNeed({ a: 1 }, { a: 1, b: 1 }), false)
  const small = G.helpReward({ wheat: 1 })
  const big = G.helpReward({ cheese: 3 })
  assert.ok(big.coins > small.coins && big.xp > small.xp)
})

test("co-op intents: object built-ins aren't item names", async () => {
  const { checkIntent } = await import("./coopRules.js")
  assert.equal(checkIntent({ a: "sellGood", g: "constructor", n: 1 }), null)
  assert.equal(checkIntent({ a: "plant", ids: [1], crop: "constructor" }), null)
  assert.equal(checkIntent({ a: "build", type: "constructor", x: 1, y: 1 }), null)
  assert.deepEqual(checkIntent({ a: "sellGood", g: "wheat", n: 2 }), { a: "sellGood", g: "wheat", n: 2 })
})
