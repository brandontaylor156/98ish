// Sunny Acres: everything the game is made of. Crops, animals, factories and their recipes,
// town buildings, decorations, land expansions and what each level unlocks. Times are in
// seconds; early things are quick so the first minutes feel lively, later ones take longer.

// ---- goods (anything that sits in the Barn) ----
// src: where it comes from. Crops grow on fields, animal goods come from pens, the rest
// are made in factories (inputs are { good: count }).
const RAW = [
  // crops: [id, name, level, grow time, seed cost]
  ["wheat", "Wheat", "field", 1, 20, 0],
  ["corn", "Corn", "field", 2, 45, 1],
  ["carrot", "Carrots", "field", 3, 90, 2],
  ["sugarcane", "Sugarcane", "field", 5, 180, 3],
  ["cotton", "Cotton", "field", 6, 300, 4],
  ["strawberry", "Strawberries", "field", 8, 480, 5],
]

export const CROPS = RAW.map(([id, name, , lvl, time, seed]) => ({ id, name, lvl, time, seed }))

// animals: pen type -> what they eat and what they give
export const PENS = {
  cowpen: { name: "Cow Pasture", animal: "cow", animalName: "Cows", feed: "cowfeed", good: "milk", time: 50, lvl: 2, size: 3, cost: 120 },
  coop: { name: "Chicken Coop", animal: "chicken", animalName: "Chickens", feed: "chickenfeed", good: "egg", time: 40, lvl: 4, size: 3, cost: 260 },
  sheeppen: { name: "Sheep Meadow", animal: "sheep", animalName: "Sheep", feed: "sheepfeed", good: "wool", time: 180, lvl: 7, size: 3, cost: 600 },
}
export const ANIMALS_PER_PEN = 3

// factories: what each makes; recipe entries are [good, name, level, time, inputs]
export const FACTORIES = {
  feedmill: {
    name: "Feed Mill", lvl: 1, pop: 0, cost: 0, slots: 3,
    recipes: [
      ["cowfeed", "Cow Feed", 1, 15, { wheat: 2 }],
      ["chickenfeed", "Chicken Feed", 3, 30, { wheat: 1, corn: 2 }],
      ["sheepfeed", "Sheep Feed", 7, 60, { wheat: 2, carrot: 2 }],
    ],
  },
  dairy: {
    name: "Dairy", lvl: 3, pop: 20, cost: 200, slots: 2,
    recipes: [
      ["cream", "Cream", 3, 45, { milk: 1 }],
      ["butter", "Butter", 4, 90, { milk: 2 }],
      ["cheese", "Cheese", 6, 150, { milk: 3 }],
    ],
  },
  bakery: {
    name: "Bakery", lvl: 4, pop: 35, cost: 350, slots: 2,
    recipes: [
      ["bread", "Bread", 4, 60, { wheat: 3 }],
      ["cornbread", "Corn Bread", 5, 120, { corn: 2, egg: 2 }],
      ["cookies", "Cookies", 6, 180, { wheat: 2, egg: 2, sugar: 1 }],
    ],
  },
  sugarmill: {
    name: "Sugar Mill", lvl: 5, pop: 50, cost: 500, slots: 2,
    recipes: [
      ["sugar", "Sugar", 5, 60, { sugarcane: 2 }],
      ["syrup", "Syrup", 6, 120, { sugarcane: 3 }],
    ],
  },
  textile: {
    name: "Textile Mill", lvl: 7, pop: 80, cost: 900, slots: 2,
    recipes: [
      ["fabric", "Fabric", 7, 120, { cotton: 2 }],
      ["yarn", "Yarn", 7, 120, { wool: 2 }],
      ["sweater", "Sweater", 9, 240, { yarn: 2, fabric: 1 }],
    ],
  },
  sweetshop: {
    name: "Sweet Shop", lvl: 9, pop: 120, cost: 1500, slots: 2,
    recipes: [
      ["popcorn", "Popcorn", 9, 90, { corn: 2, butter: 1 }],
      ["carrotcake", "Carrot Cake", 10, 180, { carrot: 2, egg: 1, sugar: 1 }],
      ["jam", "Strawberry Jam", 11, 180, { strawberry: 3, sugar: 1 }],
      ["icecream", "Ice Cream", 12, 240, { cream: 1, strawberry: 1, sugar: 1 }],
    ],
  },
}
export const MAX_SLOTS = 5
export const slotUpgradeCost = (slots) => 60 * slots * slots

// every good: { id, name, lvl, src: "field" | pen type | factory type, time, inputs, price, xp }
export const GOODS = {}
for (const c of CROPS) GOODS[c.id] = { id: c.id, name: c.name, lvl: c.lvl, src: "field", time: c.time, inputs: {}, seed: c.seed }
for (const [type, f] of Object.entries(FACTORIES)) {
  f.recipes = f.recipes.map(([id, name, lvl, time, inputs]) => ({ id, name, lvl, time, inputs }))
  for (const r of f.recipes) GOODS[r.id] = { id: r.id, name: r.name, lvl: r.lvl, src: type, time: r.time, inputs: r.inputs }
}
const ANIMAL_GOOD_NAMES = { milk: "Milk", egg: "Eggs", wool: "Wool" }
for (const [type, p] of Object.entries(PENS)) GOODS[p.good] = { id: p.good, name: ANIMAL_GOOD_NAMES[p.good], lvl: p.lvl, src: type, time: p.time, inputs: { [p.feed]: 1 } }

// prices and XP grow with what goes into a good and how long it takes
const priceOf = (id) => {
  const g = GOODS[id]
  if (g.price) return g.price
  let p = g.src === "field" ? 1 + Math.round(g.time / 60) : Math.ceil(g.time / 40)
  for (const [k, n] of Object.entries(g.inputs)) p += priceOf(k) * n
  g.price = Math.max(1, p)
  return g.price
}
// XP for harvesting or making one: only slow things give any, so filling orders (which
// pay XP by the value of the goods) is the way to level up, not planting wheat all day
for (const id of Object.keys(GOODS)) {
  priceOf(id)
  const g = GOODS[id]
  g.xp = Math.floor(g.time / 120)
}

// building materials and tools (kept on the Barn's tool shelf, which never fills up)
export const MATERIALS = {
  brick: { name: "Bricks" },
  glass: { name: "Glass" },
  slab: { name: "Stone Slabs" },
  hammer: { name: "Hammers" },
  shovel: { name: "Shovels" },
}

export const itemName = (id) => GOODS[id]?.name || MATERIALS[id]?.name || id

// ---- buildings ----
// kind: what the map object is. w x h is its footprint in tiles.
// Houses add people (up to the town's room for them); community buildings add room.
export const HOUSES = {
  cottage: { name: "Cottage", lvl: 1, cost: 60, pop: 6, time: 10, xp: 3 },
  bungalow: { name: "Bungalow", lvl: 2, cost: 150, pop: 10, time: 30, xp: 6 },
  farmhouse: { name: "Farmhouse", lvl: 4, cost: 320, pop: 15, time: 60, xp: 10 },
  townhouse: { name: "Townhouse", lvl: 6, cost: 650, pop: 22, time: 120, xp: 16 },
  villa: { name: "Villa", lvl: 8, cost: 1100, pop: 30, time: 180, xp: 24 },
  apartments: { name: "Apartments", lvl: 10, cost: 1800, pop: 45, time: 300, xp: 36 },
}
// each extra house of a kind costs a bit more than the last
export const houseCost = (type, owned) => Math.round(HOUSES[type].cost * (1 + 0.25 * owned) / 5) * 5

export const COMMUNITY = {
  townhall: { name: "Town Hall", lvl: 99, cost: 0, cap: 40, time: 0, xp: 0, mats: {} },
  postoffice: { name: "Post Office", lvl: 3, cost: 250, cap: 40, time: 45, xp: 15, mats: {} },
  school: { name: "School", lvl: 6, cost: 700, cap: 60, time: 120, xp: 30, mats: { brick: 2, glass: 1, slab: 2 } },
  clinic: { name: "Clinic", lvl: 8, cost: 1200, cap: 80, time: 180, xp: 45, mats: { brick: 3, glass: 3, slab: 2 } },
  firehouse: { name: "Fire Station", lvl: 10, cost: 2000, cap: 100, time: 240, xp: 60, mats: { brick: 4, glass: 3, slab: 4 } },
  library: { name: "Library", lvl: 12, cost: 3000, cap: 120, time: 300, xp: 80, mats: { brick: 5, glass: 5, slab: 5 } },
}

export const DECOR = {
  tree: { name: "Oak Tree", lvl: 1, cost: 15, xp: 1, w: 1 },
  flowers: { name: "Flower Bed", lvl: 1, cost: 20, xp: 1, w: 1 },
  bench: { name: "Park Bench", lvl: 2, cost: 40, xp: 2, w: 1 },
  lamp: { name: "Street Lamp", lvl: 3, cost: 50, xp: 2, w: 1 },
  fountain: { name: "Fountain", lvl: 5, cost: 250, xp: 8, w: 2 },
  pond: { name: "Duck Pond", lvl: 7, cost: 400, xp: 12, w: 2 },
  statue: { name: "Founder Statue", lvl: 9, cost: 600, xp: 18, w: 2 },
}

// footprints, by object type
export const sizeOf = (type) => {
  if (type === "field") return 1
  if (HOUSES[type]) return 2
  if (DECOR[type]) return DECOR[type].w
  return 3 // factories, pens, community buildings, barn, helipad, station
}
export const kindOf = (type) =>
  type === "field" ? "field"
  : HOUSES[type] ? "house"
  : COMMUNITY[type] ? "community"
  : FACTORIES[type] ? "factory"
  : PENS[type] ? "pen"
  : DECOR[type] ? "decor"
  : "special" // barn, helipad, station
export const typeName = (type) =>
  type === "field" ? "Field"
  : type === "barn" ? "Barn"
  : type === "helipad" ? "Helipad"
  : type === "station" ? "Train Station"
  : (HOUSES[type] || COMMUNITY[type] || FACTORIES[type] || PENS[type] || DECOR[type])?.name || type

// fields: how many a level allows, and what the next one costs
export const maxFields = (level) => Math.min(30, 6 + 2 * (level - 1))
export const fieldCost = (owned) => 5 * Math.max(1, owned - 2)

// pens: how many of each kind
export const maxPens = (level) => (level >= 10 ? 3 : 2)

// ---- the Barn ----
export const BARN_START = 50
export const BARN_STEP = 25
export const BARN_MAX_UPGRADES = 8
export const barnUpgradeCost = (k) => ({ coins: 150 * k, hammer: k }) // k = the upgrade's number (1, 2...)

// ---- the map ----
// A 30 x 30 grid. The railway runs along row 1; the starting land is a block in the middle,
// and three expansions open up more.
export const MAP_W = 30
export const MAP_H = 30
export const RAIL_ROW = 1
export const START_AREA = { x: 4, y: 2, w: 18, h: 20 }
export const EXPANSIONS = [
  { name: "East Meadow", x: 22, y: 2, w: 8, h: 20, lvl: 3, coins: 300, shovel: 1 },
  { name: "South Fields", x: 4, y: 22, w: 26, h: 8, lvl: 6, coins: 900, shovel: 3 },
  { name: "West Woods", x: 0, y: 2, w: 4, h: 28, lvl: 9, coins: 2000, shovel: 5 },
]

// ---- levels ----
// total XP needed to reach each level (index = level)
export const LEVEL_XP = [0, 0, 15, 40, 80, 140, 230, 360, 540, 780, 1080, 1450, 1900, 2450, 3100, 3850, 4700, 5650]
export const xpForLevel = (level) =>
  level < LEVEL_XP.length ? LEVEL_XP[level] : LEVEL_XP[LEVEL_XP.length - 1] + (level - LEVEL_XP.length + 1) * 1000
export const levelForXp = (xp) => {
  let l = 1
  while (xpForLevel(l + 1) <= xp) l++
  return l
}

// gifts for reaching a level (besides coins and clovers)
export const LEVEL_GIFTS = {
  2: { shovel: 1 },
  3: { hammer: 1, brick: 1 },
  4: { glass: 1, slab: 1, hammer: 1 },
  5: { shovel: 1 },
  6: { brick: 1, slab: 1, shovel: 1 },
  8: { hammer: 2, glass: 1 },
  10: { shovel: 2 },
}
export const levelCoins = (level) => 25 * level
export const levelClovers = (level) => (level % 3 === 0 ? 3 : 2)

// helicopter order slots, and when the train starts coming
export const orderSlots = (level) => Math.min(9, 3 + Math.floor(Math.max(0, level - 2) / 2))
export const TRAIN_LEVEL = 5
export const trainCars = (level) => (level >= 11 ? 5 : level >= 8 ? 4 : 3)
export const trainTrip = (level) => (level >= 9 ? 360 : 240) // seconds away

// what a level brings, for the "Level up!" card
export const unlocksAt = (level) => {
  const out = []
  for (const c of CROPS) if (c.lvl === level) out.push({ id: c.id, name: c.name })
  for (const [type, p] of Object.entries(PENS)) if (p.lvl === level) out.push({ id: type, name: p.name })
  for (const [type, f] of Object.entries(FACTORIES)) {
    if (f.lvl === level) out.push({ id: type, name: f.name })
    for (const r of f.recipes) if (r.lvl === level && f.lvl !== level) out.push({ id: r.id, name: r.name })
  }
  for (const [type, h] of Object.entries(HOUSES)) if (h.lvl === level) out.push({ id: type, name: h.name })
  for (const [type, c] of Object.entries(COMMUNITY)) if (c.lvl === level) out.push({ id: type, name: c.name })
  for (const [type, d] of Object.entries(DECOR)) if (d.lvl === level && level > 1) out.push({ id: type, name: d.name })
  if (level === TRAIN_LEVEL) out.push({ id: "station", name: "The Train" })
  EXPANSIONS.forEach((e) => e.lvl === level && out.push({ id: "expand", name: e.name }))
  return out
}
