// Sunny Acres game rules: pure functions over a plain state object (no DOM, no timers).
// Every timer is an absolute time in ms, so a town left alone keeps growing: on load,
// tick(state, now) catches up whatever finished while the window was closed.
// Actions change the state in place and return { ok, reason }.

import {
  ANIMALS_PER_PEN, BARN_MAX_UPGRADES, BARN_START, BARN_STEP, COMMUNITY, CROPS, DECOR, EXPANSIONS, FACTORIES, GOODS, HOUSES,
  LEVEL_GIFTS, MAP_H, MAP_W, MATERIALS, MAX_SLOTS, PENS, START_AREA, TRAIN_LEVEL, barnUpgradeCost, fieldCost, houseCost, itemName,
  kindOf, levelClovers, levelCoins, levelForXp, maxFields, maxPens, orderSlots, sizeOf, slotUpgradeCost, trainCars, trainTrip, xpForLevel,
} from "./data.js"

export const SAVE_VERSION = 2
const SEC = 1000

// ---- random numbers (seeded, kept in the state so orders repeat in tests) ----
const rand = (s) => {
  let t = (s.seed = (s.seed + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const randInt = (s, a, b) => a + Math.floor(rand(s) * (b - a + 1))
const pick = (s, list) => list[Math.floor(rand(s) * list.length)]

const ok = (extra = {}) => ({ ok: true, ...extra })
const no = (reason) => ({ ok: false, reason })
const emit = (s, e) => (s.ev ||= []).push(e)

// ---- a new town ----
export const TUTORIAL_ORDER = { need: { cowfeed: 1, wheat: 2 }, coins: 40, xp: 15 }

export const newGame = (now = Date.now(), seed = (now ^ 0x5eed) | 0) => {
  const s = {
    v: SAVE_VERSION,
    t: now,
    seed,
    coins: 150,
    clovers: 8,
    xp: 0,
    level: 1,
    goods: { wheat: 2 },
    mats: {},
    barnUps: 0,
    exp: EXPANSIONS.map(() => 0),
    objs: [],
    nextId: 1,
    orders: [],
    train: { st: "locked", at: 0, cars: [] },
    tut: 0,
    stats: { orders: 0, harvests: 0, made: 0, trains: 0 },
  }
  const put = (type, x, y, extra = {}) => s.objs.push({ i: s.nextId++, t: type, x, y, ...initial(type), ...extra })
  put("station", 12, 2)
  put("barn", 6, 6)
  put("townhall", 11, 9)
  put("helipad", 16, 5)
  put("feedmill", 6, 11)
  for (const [x, y] of [[11, 14], [12, 14], [11, 15], [12, 15]]) put("field", x, y)
  put("cottage", 16, 10)
  put("cottage", 16, 13)
  for (const [x, y] of [[5, 3], [20, 3], [5, 20], [20, 19], [9, 19]]) put("tree", x, y)
  s.orders = [{ ...TUTORIAL_ORDER, need: { ...TUTORIAL_ORDER.need } }]
  fillOrders(s, now)
  return s
}

// a building's starting state
const initial = (type) => {
  const kind = kindOf(type)
  if (kind === "field") return { c: null, e: 0 }
  if (kind === "pen") return { a: Array(ANIMALS_PER_PEN).fill(null) }
  if (kind === "factory") return { q: [], sl: FACTORIES[type].slots }
  return {}
}

// ---- lookups ----
export const objById = (s, id) => s.objs.find((o) => o.i === id) || null
export const isBuilt = (o) => !o.b
export const count = (s, type, builtOnly = false) => s.objs.filter((o) => o.t === type && (!builtOnly || isBuilt(o))).length
export const have = (s, id) => (GOODS[id] ? s.goods[id] || 0 : s.mats[id] || 0)

export const population = (s) => s.objs.reduce((n, o) => n + (HOUSES[o.t] && isBuilt(o) ? HOUSES[o.t].pop : 0), 0)
export const plannedPopulation = (s) => s.objs.reduce((n, o) => n + (HOUSES[o.t] ? HOUSES[o.t].pop : 0), 0)
export const popCap = (s) => s.objs.reduce((n, o) => n + (COMMUNITY[o.t] && isBuilt(o) ? COMMUNITY[o.t].cap : 0), 0)

export const barnCap = (s) => BARN_START + BARN_STEP * s.barnUps
export const barnUsed = (s) => Object.values(s.goods).reduce((a, b) => a + b, 0)
export const barnFree = (s) => barnCap(s) - barnUsed(s)

const addGood = (s, id, n) => {
  s.goods[id] = (s.goods[id] || 0) + n
  if (s.goods[id] <= 0) delete s.goods[id]
}
const addMat = (s, id, n) => {
  s.mats[id] = (s.mats[id] || 0) + n
  if (s.mats[id] <= 0) delete s.mats[id]
}
export const give = (s, id, n) => (GOODS[id] ? addGood(s, id, n) : MATERIALS[id] ? addMat(s, id, n) : id === "coins" ? (s.coins += n) : id === "clovers" ? (s.clovers += n) : null)

const hasAll = (s, need) => Object.entries(need).every(([k, n]) => have(s, k) >= n)
const takeAll = (s, need) => Object.entries(need).forEach(([k, n]) => give(s, k, -n))

// ---- XP and levels ----
export const xpProgress = (s) => {
  const a = xpForLevel(s.level)
  const b = xpForLevel(s.level + 1)
  return { into: s.xp - a, span: b - a, frac: Math.max(0, Math.min(1, (s.xp - a) / (b - a))) }
}

export const addXp = (s, n, now = Date.now()) => {
  s.xp += n
  const target = levelForXp(s.xp)
  while (s.level < target) {
    s.level++
    const gifts = { coins: levelCoins(s.level), clovers: levelClovers(s.level), ...(LEVEL_GIFTS[s.level] || {}) }
    for (const [k, v] of Object.entries(gifts)) give(s, k, v)
    emit(s, { type: "level", level: s.level, gifts })
  }
  if (target >= TRAIN_LEVEL && s.train.st === "locked") trainArrives(s, now)
  fillOrders(s, now)
}

// ---- what the player can make right now ----
// A good is obtainable when its crop is unlocked, or the player owns a finished pen or
// factory for it (at a high enough level) and can get everything that goes into it.
export const obtainable = (s, id, seen = new Set()) => {
  const g = GOODS[id]
  if (!g || g.lvl > s.level) return false
  if (g.src === "field") return true
  if (!s.objs.some((o) => o.t === g.src && isBuilt(o))) return false
  if (seen.has(id)) return false
  seen.add(id)
  return Object.keys(g.inputs).every((k) => obtainable(s, k, seen))
}
export const obtainableGoods = (s) => Object.keys(GOODS).filter((id) => obtainable(s, id))

// ---- orders (the helicopter) ----
export const ORDER_WAIT_DONE = 8 // seconds until a new order after delivering one
export const ORDER_WAIT_SKIP = 45 // ...and after throwing one away

export const genOrder = (s) => {
  const pool = obtainableGoods(s)
  const kinds = Math.min(pool.length, s.level < 3 ? randInt(s, 1, 2) : s.level < 7 ? randInt(s, 1, 3) : randInt(s, 2, 3))
  const need = {}
  const left = [...pool]
  for (let k = 0; k < kinds; k++) {
    const id = left.splice(Math.floor(rand(s) * left.length), 1)[0]
    const g = GOODS[id]
    const most = Math.max(1, Math.round(5 - g.time / 60)) + (s.level >= 6 ? 1 : 0)
    need[id] = randInt(s, 1, Math.min(6, most))
  }
  let value = 0
  let xp = 0 // slow goods are worth a little extra
  for (const [id, n] of Object.entries(need)) {
    value += GOODS[id].price * n
    xp += GOODS[id].xp * n
  }
  const order = { need, coins: Math.round(value * 1.6) + 4, xp: Math.round(value / 3 + xp) + 3 }
  if (rand(s) < 0.08) order.bonus = { clovers: 1 }
  else if (s.level >= 3 && rand(s) < 0.12) order.bonus = { [pick(s, ["brick", "glass", "slab", "hammer", "shovel"])]: 1 }
  return order
}

// fill empty slots whose wait is over, and add slots the level allows
export const fillOrders = (s, now) => {
  const slots = orderSlots(s.level)
  while (s.orders.length < slots) s.orders.push({ wait: 0 })
  s.orders.forEach((o, i) => {
    if (o.wait !== undefined && o.wait <= now) s.orders[i] = genOrder(s)
  })
}

export const canDeliver = (s, i) => {
  const o = s.orders[i]
  return !!o?.need && hasAll(s, o.need)
}

export const deliverOrder = (s, i, now = Date.now()) => {
  const o = s.orders[i]
  if (!o?.need) return no("There's no order here yet.")
  if (!hasAll(s, o.need)) return no("You don't have everything for this order yet.")
  takeAll(s, o.need)
  s.coins += o.coins
  for (const [k, n] of Object.entries(o.bonus || {})) give(s, k, n)
  s.orders[i] = { wait: now + ORDER_WAIT_DONE * SEC }
  s.stats.orders++
  if (s.tut === 4) s.tut = 5
  emit(s, { type: "delivered", order: o })
  addXp(s, o.xp, now)
  return ok({ order: o })
}

export const skipOrder = (s, i, now = Date.now()) => {
  const o = s.orders[i]
  if (!o?.need) return no("There's no order here yet.")
  if (s.tut < 5 && i === 0) return no("Let's deliver this first one together!")
  s.orders[i] = { wait: now + ORDER_WAIT_SKIP * SEC }
  return ok()
}

// ---- fields ----
const growTime = (s, crop) => (s.tut < 2 ? 5 : crop.time) // the first wheat grows fast

export const fieldStage = (o, now) => {
  // 0 empty, 1 sprout, 2 growing, 3 almost, 4 ripe
  if (!o.c) return 0
  if (o.e <= now) return 4
  const crop = CROPS.find((c) => c.id === o.c)
  const total = (o.d || crop.time) * SEC
  const f = 1 - (o.e - now) / total
  return f < 0.33 ? 1 : f < 0.7 ? 2 : 3
}

export const plant = (s, id, cropId, now = Date.now()) => {
  const o = objById(s, id)
  const crop = CROPS.find((c) => c.id === cropId)
  if (!o || o.t !== "field") return no("That's not a field.")
  if (!crop || crop.lvl > s.level) return no("You can't plant that yet.")
  if (o.c) return no("Something is already growing here.")
  if (s.coins < crop.seed) return no("Not enough coins for seeds.")
  s.coins -= crop.seed
  const d = growTime(s, crop)
  o.c = crop.id
  o.e = now + d * SEC
  o.d = d
  if (s.tut === 0 && crop.id === "wheat") s.tut = 1
  return ok()
}

export const HARVEST_YIELD = 2
export const harvest = (s, id, now = Date.now()) => {
  const o = objById(s, id)
  if (!o || o.t !== "field" || !o.c) return no("Nothing to harvest.")
  if (o.e > now) return no("Not ripe yet.")
  if (barnFree(s) < HARVEST_YIELD) return no("Your Barn is full! Upgrade it or sell some goods.")
  const crop = o.c
  addGood(s, crop, HARVEST_YIELD)
  o.c = null
  o.e = 0
  delete o.d
  s.stats.harvests++
  if (s.tut === 1) s.tut = 2
  if (GOODS[crop].xp) addXp(s, GOODS[crop].xp, now)
  return ok({ good: crop, n: HARVEST_YIELD })
}

// ---- animal pens ----
// each animal is null (hungry) or the time its milk/egg/wool is ready
export const penState = (o, now) => {
  const hungry = o.a.filter((t) => t === null).length
  const ready = o.a.filter((t) => t !== null && t <= now).length
  return { hungry, ready, busy: o.a.length - hungry - ready }
}

export const feedPen = (s, id, now = Date.now()) => {
  const o = objById(s, id)
  if (!o || kindOf(o.t) !== "pen") return no("That's not a pen.")
  if (!isBuilt(o)) return no("Still being built.")
  const p = PENS[o.t]
  let fed = 0
  o.a = o.a.map((t) => {
    if (t !== null || !have(s, p.feed)) return t
    addGood(s, p.feed, -1)
    fed++
    return now + p.time * SEC
  })
  if (!fed) return no(o.a.some((t) => t === null) ? `You need ${itemName(p.feed)}. Make it at the Feed Mill.` : "They're all fed.")
  return ok({ fed })
}

export const collectPen = (s, id, now = Date.now()) => {
  const o = objById(s, id)
  if (!o || kindOf(o.t) !== "pen") return no("That's not a pen.")
  const p = PENS[o.t]
  let got = 0
  let full = false
  o.a = o.a.map((t) => {
    if (t === null || t > now) return t
    if (barnFree(s) < 1) {
      full = true
      return t
    }
    addGood(s, p.good, 1)
    got++
    return null
  })
  if (!got) return no(full ? "Your Barn is full! Upgrade it or sell some goods." : "Nothing ready yet.")
  if (GOODS[p.good].xp) addXp(s, GOODS[p.good].xp * got, now)
  return ok({ good: p.good, n: got })
}

// ---- factories ----
// q is the production line: each job has the good and the time it finishes. Jobs run one
// after another; finished ones wait in the factory until collected (they still use a slot).
export const factoryJobs = (o, now) => o.q.map((j, k) => ({ ...j, done: j.e <= now, running: j.e > now && (k === 0 || o.q[k - 1].e <= now) }))

export const canMake = (s, o, goodId) => {
  const f = FACTORIES[o.t]
  const r = f?.recipes.find((x) => x.id === goodId)
  if (!r) return no("This factory can't make that.")
  if (r.lvl > s.level) return no(`Unlocks at level ${r.lvl}.`)
  if (!isBuilt(o)) return no("Still being built.")
  if (o.q.length >= o.sl) return no("All slots are busy. Collect goods or add a slot.")
  if (!hasAll(s, r.inputs)) return no("You don't have the ingredients.")
  return ok({ recipe: r })
}

export const queueProduct = (s, id, goodId, now = Date.now()) => {
  const o = objById(s, id)
  if (!o || kindOf(o.t) !== "factory") return no("That's not a factory.")
  const can = canMake(s, o, goodId)
  if (!can.ok) return can
  takeAll(s, can.recipe.inputs)
  const start = Math.max(now, o.q.length ? o.q[o.q.length - 1].e : now)
  const d = s.tut < 4 && goodId === "cowfeed" ? 5 : can.recipe.time
  o.q.push({ g: goodId, e: start + d * SEC })
  if (s.tut === 2 && goodId === "cowfeed") s.tut = 3
  return ok()
}

export const collectFactory = (s, id, now = Date.now()) => {
  const o = objById(s, id)
  if (!o || kindOf(o.t) !== "factory") return no("That's not a factory.")
  const got = []
  while (o.q.length && o.q[0].e <= now && barnFree(s) >= 1) {
    const j = o.q.shift()
    addGood(s, j.g, 1)
    got.push(j.g)
    s.stats.made++
  }
  if (!got.length) return no(o.q.length && o.q[0].e <= now ? "Your Barn is full! Upgrade it or sell some goods." : "Nothing ready yet.")
  if (s.tut === 3 && got.includes("cowfeed")) s.tut = 4
  const xp = got.reduce((n, g) => n + GOODS[g].xp, 0)
  if (xp) addXp(s, xp, now)
  return ok({ goods: got })
}

export const addSlot = (s, id) => {
  const o = objById(s, id)
  if (!o || kindOf(o.t) !== "factory") return no("That's not a factory.")
  if (o.sl >= MAX_SLOTS) return no("This factory has every slot already.")
  const cost = slotUpgradeCost(o.sl)
  if (s.coins < cost) return no(`You need ${cost} coins.`)
  s.coins -= cost
  o.sl++
  return ok()
}

// ---- the Barn ----
export const upgradeBarn = (s) => {
  if (s.barnUps >= BARN_MAX_UPGRADES) return no("The Barn is as big as it gets!")
  const cost = barnUpgradeCost(s.barnUps + 1)
  if (s.coins < cost.coins) return no(`You need ${cost.coins} coins.`)
  if (have(s, "hammer") < cost.hammer) return no(`You need ${cost.hammer} ${cost.hammer > 1 ? "hammers" : "hammer"}. The train brings them.`)
  s.coins -= cost.coins
  addMat(s, "hammer", -cost.hammer)
  s.barnUps++
  return ok()
}

export const sellGood = (s, id, n = 1) => {
  if (!GOODS[id] || have(s, id) < n) return no("You don't have that many.")
  addGood(s, id, -n)
  s.coins += GOODS[id].price * n
  return ok({ coins: GOODS[id].price * n })
}

// ---- the train ----
const TRAIN_REWARDS = ["brick", "brick", "glass", "glass", "slab", "slab", "hammer", "shovel"]

const trainArrives = (s, now) => {
  const pool = obtainableGoods(s).filter((id) => GOODS[id].time <= 180)
  const cars = []
  for (let k = 0; k < trainCars(s.level); k++) {
    const g = pick(s, pool)
    cars.push({ g, n: randInt(s, 2, Math.max(2, Math.round(6 - GOODS[g].time / 45))), m: pick(s, TRAIN_REWARDS), d: 0 })
  }
  s.train = { st: "here", at: now, cars }
  emit(s, { type: "train" })
}

export const loadCar = (s, k, now = Date.now()) => {
  const car = s.train.cars[k]
  if (s.train.st !== "here" || !car) return no("The train isn't here.")
  if (car.d) return no("This car is already loaded.")
  if (have(s, car.g) < car.n) return no(`You need ${car.n} ${itemName(car.g)}.`)
  addGood(s, car.g, -car.n)
  addMat(s, car.m, 1)
  car.d = 1
  addXp(s, Math.round((GOODS[car.g].price * car.n) / 5) + 1, now)
  return ok({ mat: car.m })
}

export const trainBonus = (s) => ({ coins: 20 + 10 * s.level, xp: 10 + 3 * s.level, clovers: 1 })

export const sendTrain = (s, now = Date.now()) => {
  if (s.train.st !== "here") return no("The train isn't here.")
  const full = s.train.cars.every((c) => c.d)
  const bonus = full ? trainBonus(s) : null
  s.train = { st: "away", at: now + trainTrip(s.level) * SEC, cars: [] }
  s.stats.trains++
  if (bonus) {
    s.coins += bonus.coins
    s.clovers += bonus.clovers
    addXp(s, bonus.xp, now)
  }
  return ok({ bonus })
}

// ---- building ----
export const isLand = (s, x, y) => {
  const inRect = (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
  return inRect(START_AREA) || EXPANSIONS.some((e, k) => s.exp[k] && inRect(e))
}

export const occupant = (s, x, y, ignore) => s.objs.find((o) => o.i !== ignore && x >= o.x && x < o.x + sizeOf(o.t) && y >= o.y && y < o.y + sizeOf(o.t)) || null

export const canPlace = (s, type, x, y, ignore) => {
  const n = sizeOf(type)
  if (x < 0 || y < 0 || x + n > MAP_W || y + n > MAP_H) return false
  for (let yy = y; yy < y + n; yy++) for (let xx = x; xx < x + n; xx++) if (!isLand(s, xx, yy) || occupant(s, xx, yy, ignore)) return false
  return true
}

const buildTime = (type) => {
  if (HOUSES[type]) return HOUSES[type].time
  if (COMMUNITY[type]) return COMMUNITY[type].time
  if (FACTORIES[type]) return 15 * FACTORIES[type].lvl
  if (PENS[type]) return 20
  return 0
}

// the price and requirements of buying one more of something
export const offer = (s, type) => {
  const kind = kindOf(type)
  // a decoration someone gave you is free to place
  if (kind === "decor" && s.inv?.[type] > 0) return { type, lvl: 1, coins: 0, mats: {}, xp: 0, pop: 0, time: 0, why: null, gift: s.inv[type] }
  let lvl = 1
  let coins = 0
  let mats = {}
  let xp = 0
  let pop = 0
  let limit = null
  if (kind === "field") {
    coins = fieldCost(count(s, "field"))
    limit = count(s, "field") >= maxFields(s.level) ? `Level ${s.level} allows ${maxFields(s.level)} fields.` : null
    xp = 1
  } else if (kind === "house") {
    const h = HOUSES[type]
    lvl = h.lvl
    coins = houseCost(type, count(s, type))
    xp = h.xp
    if (plannedPopulation(s) + h.pop > popCap(s)) limit = "No room for more people. Build a community building first."
  } else if (kind === "community") {
    const c = COMMUNITY[type]
    lvl = c.lvl
    coins = c.cost
    mats = c.mats
    xp = c.xp
    if (count(s, type)) limit = "You already have one."
  } else if (kind === "factory") {
    const f = FACTORIES[type]
    lvl = f.lvl
    coins = f.cost
    pop = f.pop
    xp = 5 * f.lvl
    if (count(s, type)) limit = "You already have one."
  } else if (kind === "pen") {
    const p = PENS[type]
    lvl = p.lvl
    coins = p.cost * (1 + count(s, type))
    xp = 5 + p.lvl
    if (count(s, type) >= maxPens(s.level)) limit = `You have room for ${maxPens(s.level)} of these for now.`
  } else if (kind === "decor") {
    const d = DECOR[type]
    lvl = d.lvl
    coins = d.cost
    xp = d.xp
    if (d.giftOnly) limit = "Only your partner can give you this one."
    else if (d.couple && !s.paired) limit = "Pair up with your partner in Us to unlock it."
    else if (d.couple && count(s, type)) limit = "You already have one."
  } else {
    return { type, lvl: 999, coins: 0, mats: {}, xp: 0, pop: 0, why: "Not for sale." }
  }
  let why = null
  if (s.level < lvl) why = `Unlocks at level ${lvl}.`
  else if (population(s) < pop) why = `Needs ${pop} people in town.`
  else if (limit) why = limit
  else if (s.coins < coins) why = `You need ${coins} coins.`
  else {
    const short = Object.entries(mats).find(([k, n]) => have(s, k) < n)
    if (short) why = `You need ${short[1]} ${itemName(short[0])}. The train brings them.`
  }
  return { type, lvl, coins, mats, xp, pop, time: buildTime(type), why }
}

export const build = (s, type, x, y, now = Date.now()) => {
  const o = offer(s, type)
  if (o.why) return no(o.why)
  if (!canPlace(s, type, x, y)) return no("It doesn't fit there.")
  s.coins -= o.coins
  takeAll(s, o.mats)
  if (o.gift) {
    s.inv[type]--
    if (!s.inv[type]) delete s.inv[type]
  }
  const obj = { i: s.nextId++, t: type, x, y, ...initial(type) }
  const t = buildTime(type)
  if (t) {
    obj.b = now + t * SEC
    obj.bt = t // for the progress bar
    obj.bx = o.xp // XP is paid when it's finished
  }
  s.objs.push(obj)
  if (!t) addXp(s, o.xp, now)
  return ok({ obj })
}

export const MOVABLE = (o) => o.t !== "station"
export const move = (s, id, x, y, flip) => {
  const o = objById(s, id)
  if (!o || !MOVABLE(o)) return no("That can't be moved.")
  if (!canPlace(s, o.t, x, y, id)) return no("It doesn't fit there.")
  o.x = x
  o.y = y
  if (flip !== undefined) o.f = flip ? 1 : 0
  if (!o.f) delete o.f
  return ok()
}

// decorations and empty fields can be sold back for half their price
export const sellValue = (s, o) => {
  if (DECOR[o.t]) return Math.floor(DECOR[o.t].cost / 2)
  if (o.t === "field") return count(s, "field") > 4 ? 1 : null
  return null
}
export const sellObj = (s, id) => {
  const o = objById(s, id)
  const v = o && sellValue(s, o)
  if (v === null || v === undefined || !o) return no("You can't sell that.")
  if (o.t === "field" && o.c) return no("Harvest the field first.")
  s.objs = s.objs.filter((x) => x !== o)
  s.coins += v
  return ok({ coins: v })
}

// ---- land ----
export const expansionOffer = (s, k) => {
  const e = EXPANSIONS[k]
  if (!e || s.exp[k]) return { why: "Already yours." }
  let why = null
  if (s.level < e.lvl) why = `Unlocks at level ${e.lvl}.`
  else if (s.coins < e.coins) why = `You need ${e.coins} coins.`
  else if (have(s, "shovel") < e.shovel) why = `You need ${e.shovel} ${e.shovel > 1 ? "shovels" : "shovel"}.`
  return { ...e, why }
}

export const expand = (s, k, now = Date.now()) => {
  const e = expansionOffer(s, k)
  if (e.why) return no(e.why)
  s.coins -= e.coins
  addMat(s, "shovel", -e.shovel)
  s.exp[k] = 1
  addXp(s, 20 * (k + 1), now)
  return ok()
}

// ---- speeding things up with clovers ----
export const cloverCost = (ms) => Math.max(1, Math.ceil(ms / SEC / 120))

// what's left on a timer: target = { obj: id } | { order: index } | { train: true }
const remaining = (s, target, now) => {
  if (target.train) return s.train.st === "away" ? s.train.at - now : 0
  if (target.order !== undefined) {
    const o = s.orders[target.order]
    return o && o.wait !== undefined ? o.wait - now : 0
  }
  const o = objById(s, target.obj)
  if (!o) return 0
  if (o.b) return o.b - now
  if (o.t === "field") return o.c ? o.e - now : 0
  if (o.q) {
    const j = o.q.find((x) => x.e > now)
    return j ? j.e - now : 0
  }
  if (o.a) return Math.max(0, ...o.a.map((t) => (t === null ? 0 : t - now)))
  return 0
}
export const speedUpCost = (s, target, now = Date.now()) => {
  const ms = remaining(s, target, now)
  return ms > 0 ? cloverCost(ms) : 0
}

export const speedUp = (s, target, now = Date.now()) => {
  const ms = remaining(s, target, now)
  if (ms <= 0) return no("Nothing to hurry.")
  const cost = cloverCost(ms)
  if (s.clovers < cost) return no(`You need ${cost} clovers.`)
  s.clovers -= cost
  if (target.train) s.train.at = now
  else if (target.order !== undefined) s.orders[target.order].wait = now
  else {
    const o = objById(s, target.obj)
    if (o.b) o.b = now
    else if (o.t === "field") o.e = now
    else if (o.q) {
      // finish the running job; the ones behind it move up
      const k = o.q.findIndex((x) => x.e > now)
      const shift = o.q[k].e - now
      for (let j = k; j < o.q.length; j++) o.q[j].e -= shift
    } else if (o.a) o.a = o.a.map((t) => (t === null ? null : Math.min(t, now)))
  }
  tick(s, now)
  return ok({ cost })
}

// ---- time passing ----
// Finishes buildings, brings the train back and refills orders. Safe to call often.
export const tick = (s, now = Date.now()) => {
  for (const o of s.objs) {
    if (o.b && o.b <= now) {
      delete o.b
      const xp = o.bx || 0
      delete o.bx
      delete o.bt
      emit(s, { type: "built", id: o.i })
      if (xp) addXp(s, xp, now)
    }
  }
  if (s.train.st === "away" && s.train.at <= now) trainArrives(s, now)
  if (s.train.st === "locked" && s.level >= TRAIN_LEVEL) trainArrives(s, now)
  fillOrders(s, now)
  s.t = now
}

// ---- playing together ----
// Signed in, a town is saved to the cloud and friends can visit. What other players do for
// you (fill a help request, send a gift) and the couple's weekly goal arrive from the server
// as "effects", each with an id; applyEffect() uses each one once (s.claimed remembers them).

export const MAX_CLAIMED = 200
export const MAX_GIFT_ITEMS = 10
export const GOAL_TARGET = 500
export const GOAL_REWARD = { coins: 300, xp: 60, clovers: 3 }

// what a helper earns for filling a request, by what the goods are worth
export const needValue = (need) => Object.entries(need || {}).reduce((v, [id, n]) => v + (GOODS[id]?.price || 1) * n, 0)
export const helpReward = (need) => {
  const value = needValue(need)
  return { coins: Math.round(value * 1.2) + 5, xp: Math.round(value / 4) + 3 }
}

// what a help request asks for: helicopter order `slot` or train car `slot`; null if there's
// nothing there to fill
export const requestNeed = (s, kind, slot) => {
  if (kind === "order") {
    const o = s.orders?.[slot]
    return o?.need ? { ...o.need } : null
  }
  if (kind === "car") {
    const c = s.train?.st === "here" ? s.train.cars?.[slot] : null
    return c && !c.d ? { [c.g]: c.n } : null
  }
  return null
}
export const sameNeed = (a, b) => {
  if (!a || !b) return false
  const ka = Object.keys(a).filter((k) => a[k] > 0)
  return ka.length === Object.keys(b).filter((k) => b[k] > 0).length && ka.every((k) => a[k] === b[k])
}

// a free spot for something near tile (cx, cy), or null
export const freeSpotNear = (s, type, cx, cy) => {
  const n = sizeOf(type)
  for (let r = 0; r < 30; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const x = cx + dx - Math.floor(n / 2)
        const y = cy + dy - Math.floor(n / 2)
        if (canPlace(s, type, x, y)) return [x, y]
      }
  return null
}
const placeSpecial = (s, type, near) => {
  if (s.objs.some((o) => o.t === type)) return false
  const at = near && freeSpotNear(s, type, near.x + 1, near.y + sizeOf(near.t))
  const spot = at || freeSpotNear(s, type, 12, 12)
  if (!spot) return false
  s.objs.push({ i: s.nextId++, t: type, x: spot[0], y: spot[1] })
  return true
}
// signed in: a mailbox by the Barn
export const ensureMailbox = (s) => placeSpecial(s, "mailbox", s.objs.find((o) => o.t === "barn"))
// paired (or not any more): the partner's name for the welcome sign by the station
export const setPartner = (s, name) => {
  s.paired = name || null
  if (!s.paired) delete s.paired
  return name ? placeSpecial(s, "welcome", s.objs.find((o) => o.t === "station")) : false
}

const fillOrder = (s, slot, now) => {
  const o = s.orders[slot]
  s.coins += o.coins
  for (const [k, n] of Object.entries(o.bonus || {})) give(s, k, n)
  s.orders[slot] = { wait: now + ORDER_WAIT_DONE * SEC }
  s.stats.orders++
  if (s.tut === 4) s.tut = 5
  emit(s, { type: "delivered", order: o })
  addXp(s, o.xp, now)
  return o
}

export const applyEffect = (s, e, now = Date.now()) => {
  if (!e || typeof e.id !== "string") return no("That isn't something we know.")
  s.claimed ||= []
  if (s.claimed.includes(e.id)) return no("Already done.")
  s.claimed.push(e.id)
  if (s.claimed.length > MAX_CLAIMED) s.claimed.splice(0, s.claimed.length - MAX_CLAIMED)
  const goods = (sign) => {
    for (const [g, n] of Object.entries(e.goods || {})) {
      if (!GOODS[g] || !(n > 0)) continue
      addGood(s, g, sign > 0 ? n : -Math.min(n, have(s, g)))
    }
  }
  const result = { kind: e.kind }
  if (e.kind === "helped") {
    // you filled a friend's request: the goods left your Barn, and they thank you
    goods(-1)
    s.coins += e.coins || 0
    s.stats.helped = (s.stats.helped || 0) + 1
    addXp(s, e.xp || 0, now)
  } else if (e.kind === "help") {
    // a friend filled your request
    const req = e.req || {}
    if (req.kind === "order" && sameNeed(requestNeed(s, "order", req.slot), req.need)) {
      result.order = fillOrder(s, req.slot, now)
      result.filled = true
    } else if (req.kind === "car" && sameNeed(requestNeed(s, "car", req.slot), req.need)) {
      const car = s.train.cars[req.slot]
      addMat(s, car.m, 1)
      car.d = 1
      addXp(s, Math.round((GOODS[car.g].price * car.n) / 5) + 1, now)
      result.mat = car.m
      result.filled = true
    } else {
      // that order or car is gone: the goods go to the Barn instead
      for (const [g, n] of Object.entries(req.need || {})) if (GOODS[g] && n > 0) addGood(s, g, n)
      result.filled = false
    }
    s.stats.helpedBy = (s.stats.helpedBy || 0) + 1
  } else if (e.kind === "gave") {
    goods(-1)
    s.coins = Math.max(0, s.coins - (e.coins || 0))
    s.stats.gifts = (s.stats.gifts || 0) + 1
  } else if (e.kind === "gift") {
    goods(1)
    if (e.decor && DECOR[e.decor]) {
      s.inv ||= {}
      s.inv[e.decor] = (s.inv[e.decor] || 0) + 1
    }
  } else if (e.kind === "goal") {
    s.coins += e.coins || 0
    s.clovers += e.clovers || 0
    addXp(s, e.xp || 0, now)
  } else return no("That isn't something we know.")
  return ok(result)
}

// ---- saving ----
export const serialize = (s) => {
  const { ev, ...rest } = s
  return JSON.stringify(rest)
}

// bring an older (or damaged) save up to date; null if it can't be used
export const migrate = (data) => {
  if (!data || typeof data !== "object" || !Array.isArray(data.objs)) return null
  const base = newGame(data.t || 0, data.seed || 1)
  const s = { ...base, ...data }
  // version 1 kept expansions as a count rather than flags
  if (typeof s.exp === "number") s.exp = EXPANSIONS.map((_, k) => (k < data.exp ? 1 : 0))
  if (!Array.isArray(s.exp)) s.exp = base.exp
  while (s.exp.length < EXPANSIONS.length) s.exp.push(0)
  s.goods = { ...(data.goods || {}) }
  s.mats = { ...(data.mats || {}) }
  if (data.inv) s.inv = { ...data.inv }
  if (data.claimed) s.claimed = Array.isArray(data.claimed) ? data.claimed.slice(-MAX_CLAIMED) : []
  s.stats = { ...base.stats, ...(data.stats || {}) }
  s.train = data.train && data.train.st ? data.train : base.train
  s.orders = Array.isArray(data.orders) ? data.orders : []
  s.objs = data.objs.filter((o) => o && typeof o.t === "string" && Number.isFinite(o.x) && Number.isFinite(o.y)).map((o) => {
      // fill in anything missing, keeping the saved key order
      const out = { ...o }
      for (const [k, v] of Object.entries(initial(o.t))) if (!(k in out)) out[k] = v
      return out
    })
  s.nextId = Math.max(s.nextId || 1, ...s.objs.map((o) => o.i + 1))
  s.level = Math.max(1, levelForXp(s.xp || 0))
  s.v = SAVE_VERSION
  delete s.ev
  return s
}

export const deserialize = (text, now = Date.now()) => {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const s = migrate(data)
  if (s) tick(s, now)
  return s
}

// events (level ups, finished buildings, the train) since the last call
export const drainEvents = (s) => {
  const ev = s.ev || []
  s.ev = []
  return ev
}
