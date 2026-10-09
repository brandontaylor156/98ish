// Roam life: what you can buy in the open world and what each thing is FOR (pure; Node-tested in
// life.test.js; the server loads this same file to check the Bag: server/roam/life.js).
//
// The owner: "The ability to purchase stuff at the store and actually use it, like a trip to a
// warehouse club... or the mall, the stores." Everything is an original item with an original
// store name (no real brands, logos or layouts), priced in Casino 98's play chips (the shared chip
// bank: no real money; the house refills you when you're broke).
//
// Stores: "club" = Big Crate 98, the warehouse club (at the map's real wholesale buildings); the
// mall's shops: "threads" (clothes), "court" (sports), "kicks" (sneakers), "sweets" (candy),
// "sparkle" (the jeweler), "food" (the food court), "arcade" (the claw machine's prizes).
//
// use: what the Bag does with it
//   { eat: <leisure item id> }       eat or drink it (My Park's held items, leisure/menu.js ITEMS)
//   { paddle: { paddle, paddleEdge, paddleDesign } }   a paddle for Pickleball 98's Locker Room
//   { balls: "#rrggbb" }             the ball you play with in Pickleball 98's matches
//   { wear: { ...look patch } }      clothes for the Locker Room (locker.js look fields)
//   { place: <kind> }                put it down in town (placed.js: grill, cooler, umbrella...)
//   { ride: "bike" | "scooter" }     your own bike or scooter: ride it from the Bag
//   { keep: true }                   a keepsake (a gift: flowers, a plush, a necklace)
// pack: how many come in one purchase (bulk: a case of 24 sparkling waters is 24 drinks).

export const STORES = {
  club: { name: "Big Crate 98", kind: "warehouse club", icon: "📦" },
  threads: { name: "Threadline 98", kind: "clothes", icon: "👕" },
  court: { name: "Court & Field 98", kind: "sports", icon: "🏓" },
  kicks: { name: "Kick Lab 98", kind: "sneakers", icon: "👟" },
  sweets: { name: "Sweet Tooth 98", kind: "candy", icon: "🍬" },
  sparkle: { name: "Sparkle 98", kind: "jeweler", icon: "💍" },
  food: { name: "Food Court", kind: "food court", icon: "🍔" },
  arcade: { name: "Pixel Arcade 98", kind: "arcade", icon: "🕹️" },
}
// the mall's shops in the order they line its concourse
export const MALL_SHOPS = ["threads", "court", "kicks", "sweets", "sparkle", "food", "arcade"]

// the warehouse club's aisles (each a pallet rack row with its own sign)
export const AISLES = [
  { id: "snacks", name: "Snacks & Drinks" },
  { id: "sports", name: "Sports" },
  { id: "outdoor", name: "Outdoor & Pool" },
  { id: "rides", name: "Bikes & Scooters" },
  { id: "gifts", name: "Gifts & Flowers" },
]

const P = (paddle, paddleEdge, paddleDesign) => ({ paddle: { paddle, paddleEdge, paddleDesign } })

export const CATALOG = {
  // ---- food and drink (bulk at the club; the food court's combo) ----
  hotdogcombo: { name: "Hot dog + soda combo", icon: "🌭", price: 2, stores: ["club", "food"], aisle: "food", use: { eat: "hotdog" }, pack: 1, note: "Same price since forever." },
  sparkle24: { name: "Sparkling water, case of 24", icon: "🫧", price: 9, stores: ["club"], aisle: "snacks", use: { eat: "sparkling" }, pack: 24 },
  fizz24: { name: "Orange fizz, 24 cans", icon: "🥤", price: 10, stores: ["club"], aisle: "snacks", use: { eat: "fizz" }, pack: 24 },
  water40: { name: "Bottled water, 40-pack", icon: "💧", price: 6, stores: ["club"], aisle: "snacks", use: { eat: "water" }, pack: 40 },
  lemon6: { name: "Fresh lemonade, 6 jugs", icon: "🍋", price: 12, stores: ["club"], aisle: "snacks", use: { eat: "lemonade" }, pack: 6 },
  coffee10: { name: "Cold brew, 10 bottles", icon: "☕", price: 14, stores: ["club"], aisle: "snacks", use: { eat: "icedcoffee" }, pack: 10 },
  burgers12: { name: "Burger patties, 12-pack (for the grill)", icon: "🍔", price: 18, stores: ["club"], aisle: "snacks", use: { eat: "burger" }, pack: 12 },
  tacos8: { name: "Street tacos kit, serves 8", icon: "🌮", price: 16, stores: ["club"], aisle: "snacks", use: { eat: "tacos" }, pack: 8 },
  fries: { name: "Fries", icon: "🍟", price: 3, stores: ["food"], aisle: "food", use: { eat: "fries" }, pack: 1 },
  smoothie: { name: "Mango smoothie", icon: "🥭", price: 5, stores: ["food"], aisle: "food", use: { eat: "mango" }, pack: 1 },
  wrap: { name: "Chicken wrap", icon: "🌯", price: 6, stores: ["food"], aisle: "food", use: { eat: "wrap" }, pack: 1 },

  // ---- pickleball (Pickleball 98's Locker Room and matches) ----
  paddleblue: { name: "Graphite pro paddle (cobalt)", icon: "🏓", price: 120, stores: ["club", "court"], aisle: "sports", use: P("#2f6fd6", "#111111", "stripe") },
  paddleneon: { name: "Carbon paddle (black and neon)", icon: "🏓", price: 160, stores: ["court"], aisle: "sports", use: P("#111111", "#c6ff1a", "chevron") },
  paddlesunset: { name: "Fiberglass paddle (sunset)", icon: "🏓", price: 90, stores: ["club", "court"], aisle: "sports", use: P("#ff8c42", "#ef476f", "split") },
  paddleflame: { name: "Flame paddle (red)", icon: "🏓", price: 140, stores: ["court"], aisle: "sports", use: P("#d62828", "#ffd166", "flame") },
  ballsorange: { name: "Outdoor balls, 12-pack (orange)", icon: "🟠", price: 24, stores: ["club", "court"], aisle: "sports", use: { balls: "#ff8a1f" } },
  ballspink: { name: "Outdoor balls, 12-pack (pink)", icon: "🩷", price: 24, stores: ["court"], aisle: "sports", use: { balls: "#ff6fb0" } },
  ballswhite: { name: "Indoor balls, 12-pack (white)", icon: "⚪", price: 24, stores: ["club", "court"], aisle: "sports", use: { balls: "#f4f4ee" } },
  ballsyellow: { name: "Outdoor balls, 12-pack (neon yellow)", icon: "🟡", price: 20, stores: ["club"], aisle: "sports", use: { balls: "#e6f046" } },

  // ---- clothes (the Locker Room) ----
  polonavy: { name: "Club polo (navy)", icon: "👕", price: 35, stores: ["threads", "club"], aisle: "sports", use: { wear: { shirtStyle: "polo", shirt: "#1d3557", trim: "#ffffff" } } },
  teecoral: { name: "Tech tee (coral)", icon: "👕", price: 25, stores: ["threads"], use: { wear: { shirtStyle: "tee", shirt: "#ef476f", trim: "#ffffff" } } },
  tankmint: { name: "Tank top (mint)", icon: "🎽", price: 22, stores: ["threads"], use: { wear: { shirtStyle: "tank", shirt: "#7fe0bf", trim: "#111111" } } },
  jacketblack: { name: "Track jacket (black)", icon: "🧥", price: 55, stores: ["threads"], use: { wear: { shirtStyle: "jacket", shirt: "#111111", trim: "#c6ff1a" } } },
  skortwhite: { name: "Skort (white)", icon: "🩳", price: 30, stores: ["threads"], use: { wear: { bottom: "skirt", bottomColor: "#ffffff" } } },
  boardshorts: { name: "Board shorts (teal)", icon: "🩳", price: 28, stores: ["threads", "club"], aisle: "outdoor", use: { wear: { bottom: "board", bottomColor: "#18a3b5" } } },
  capwhite: { name: "Cap (white)", icon: "🧢", price: 18, stores: ["threads", "court"], use: { wear: { hat: "cap", hatColor: "#ffffff" } } },
  visorpink: { name: "Visor (pink)", icon: "🧢", price: 16, stores: ["court"], use: { wear: { hat: "visor", hatColor: "#ff9ec7" } } },
  shades: { name: "Sport sunglasses", icon: "🕶️", price: 40, stores: ["court", "club"], aisle: "sports", use: { wear: { glasses: "sport" } } },
  shoesblue: { name: "Court shoes (white and blue)", icon: "👟", price: 85, stores: ["kicks"], use: { wear: { shoes: "#ffffff", shoeAccent: "#2f6fd6" } } },
  shoeslime: { name: "Court shoes (black and lime)", icon: "👟", price: 95, stores: ["kicks"], use: { wear: { shoes: "#111111", shoeAccent: "#c6ff1a" } } },
  shoespink: { name: "Runners (pink)", icon: "👟", price: 75, stores: ["kicks"], use: { wear: { shoes: "#ff9ec7", shoeAccent: "#ffffff" } } },

  // ---- outdoors, beach and pool (put them down in town) ----
  grill: { name: "Kettle grill", icon: "🍖", price: 140, stores: ["club"], aisle: "outdoor", use: { place: "grill" } },
  cooler: { name: "Rolling cooler", icon: "🧊", price: 60, stores: ["club"], aisle: "outdoor", use: { place: "cooler" } },
  umbrella: { name: "Beach umbrella", icon: "⛱️", price: 45, stores: ["club"], aisle: "outdoor", use: { place: "umbrella" } },
  chairs: { name: "Beach chairs, 2-pack", icon: "🪑", price: 50, stores: ["club"], aisle: "outdoor", use: { place: "chairs" } },
  floatie: { name: "Pool float (flamingo pink)", icon: "🦩", price: 25, stores: ["club"], aisle: "outdoor", use: { place: "float" } },
  blanket: { name: "Picnic blanket", icon: "🧺", price: 30, stores: ["club"], aisle: "outdoor", use: { place: "blanket" } },

  // ---- bikes and scooters of your own ----
  cruiser: { name: "Cruiser bike (mint)", icon: "🚲", price: 280, stores: ["club"], aisle: "rides", use: { ride: "bike" }, color: 0x7fe0bf },
  escooter: { name: "E-scooter (graphite)", icon: "🛴", price: 320, stores: ["club"], aisle: "rides", use: { ride: "scooter" }, color: 0x3a3f47 },

  // ---- gifts ----
  roses: { name: "Roses, a dozen", icon: "🌹", price: 20, stores: ["club"], aisle: "gifts", use: { keep: true } },
  sunflowers: { name: "Sunflower bouquet", icon: "🌻", price: 15, stores: ["club"], aisle: "gifts", use: { keep: true } },
  chocolates: { name: "Box of chocolates", icon: "🍫", price: 12, stores: ["club", "sweets"], aisle: "gifts", use: { keep: true } },
  teddy: { name: "Giant teddy bear", icon: "🧸", price: 40, stores: ["club"], aisle: "gifts", use: { keep: true } },
  gummies: { name: "Gummy bears, big bag", icon: "🍬", price: 6, stores: ["sweets"], use: { keep: true } },
  lollipop: { name: "Swirl lollipop", icon: "🍭", price: 3, stores: ["sweets"], use: { keep: true } },
  necklace: { name: "Heart necklace (silver)", icon: "💝", price: 250, stores: ["sparkle"], use: { keep: true } },
  ring: { name: "Promise ring", icon: "💍", price: 400, stores: ["sparkle"], use: { keep: true } },
  bracelet: { name: "Charm bracelet", icon: "📿", price: 180, stores: ["sparkle"], use: { keep: true } },
  plushcat: { name: "Plush cat (claw machine prize)", icon: "🐱", price: 5, stores: ["arcade"], use: { keep: true }, note: "One try at the claw: 5 chips." },
}
export const ITEM_IDS = Object.keys(CATALOG)
export const itemOf = (id) => (typeof id === "string" && Object.prototype.hasOwnProperty.call(CATALOG, id) ? { id, ...CATALOG[id] } : null)
export const itemsFor = (store, aisle = null) => ITEM_IDS.map(itemOf).filter((it) => it.stores.includes(store) && (!aisle || it.aisle === aisle))
export const packOf = (id) => CATALOG[id]?.pack || 1
// what using it does, in a word, for the Bag's button
export const useVerb = (it) => {
  const u = it?.use || {}
  if (u.eat) return "Eat or drink"
  if (u.paddle) return "Use in Pickleball 98"
  if (u.balls) return "Play with these"
  if (u.wear) return "Wear it"
  if (u.place) return "Put it down here"
  if (u.ride) return "Ride it"
  return null
}

// ---- the Bag: { <item id>: count } (counts are uses: a case of 24 is 24) ----
// Caps (also the server's): 80 different things, 999 of one, 2,000 in all; 20 gifts waiting for
// one person; a gift note up to 140 characters; 10 places a person.
export const BAG = { kinds: 80, each: 999, total: 2000, gifts: 20, note: 140 }

export const cleanBag = (raw) => {
  const out = {}
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out
  let total = 0
  for (const id of ITEM_IDS) {
    const n = Math.floor(Number(raw[id]))
    if (!(n > 0)) continue
    if (Object.keys(out).length >= BAG.kinds) break
    const k = Math.min(BAG.each, n, BAG.total - total)
    if (k <= 0) break
    out[id] = k
    total += k
  }
  return out
}
export const bagCount = (bag) => Object.values(bag || {}).reduce((a, b) => a + b, 0)
// add what was bought: { id: purchases } -> { ok, bag, error? } (each purchase brings its pack)
export const addToBag = (bag, buys) => {
  const next = { ...cleanBag(bag) }
  for (const [id, k] of Object.entries(buys || {})) {
    const it = itemOf(id)
    const q = Math.floor(Number(k))
    if (!it || !(q > 0)) return { ok: false, bag: cleanBag(bag), error: "That isn't something the stores sell." }
    next[id] = (next[id] || 0) + q * (it.pack || 1)
  }
  if (Object.keys(next).length > BAG.kinds) return { ok: false, bag: cleanBag(bag), error: "Your Bag is full: use or give away a few things first." }
  for (const id of Object.keys(next)) if (next[id] > BAG.each) return { ok: false, bag: cleanBag(bag), error: `That's more ${itemOf(id).name.toLowerCase()} than your Bag holds.` }
  if (bagCount(next) > BAG.total) return { ok: false, bag: cleanBag(bag), error: "Your Bag is full: use or give away a few things first." }
  return { ok: true, bag: next }
}
// n uses of one straight in (a gift taken) -> { ok, bag, error? }
export const addUses = (bag, id, n = 1) => {
  const b = cleanBag(bag)
  const q = Math.max(1, Math.floor(Number(n) || 1))
  if (!itemOf(id)) return { ok: false, bag: b, error: "That isn't something the stores sell." }
  const next = { ...b, [id]: (b[id] || 0) + q }
  if (Object.keys(next).length > BAG.kinds || next[id] > BAG.each || bagCount(next) > BAG.total) return { ok: false, bag: b, error: "Your Bag is full: use or give away a few things first." }
  return { ok: true, bag: next }
}
// use (or give) n of one -> { ok, bag, error? }
export const takeFromBag = (bag, id, n = 1) => {
  const b = cleanBag(bag)
  const q = Math.max(1, Math.floor(Number(n) || 1))
  if (!itemOf(id) || !(b[id] >= q)) return { ok: false, bag: b, error: "That isn't in your Bag." }
  const next = { ...b, [id]: b[id] - q }
  if (!next[id]) delete next[id]
  return { ok: true, bag: next }
}

// ---- the cart (shared by two online: each change is an op every browser applies) ----
// cart: [{ uid, id, by, n }]. ops: { op: "add", uid, id, by } | { op: "remove", uid } | { op: "clear" }
export const CART_MAX = 40
export const applyCart = (cart, op) => {
  const c = Array.isArray(cart) ? cart : []
  if (!op || typeof op !== "object") return c
  if (op.op === "clear") return []
  if (op.op === "remove") return c.filter((x) => x.uid !== op.uid)
  if (op.op === "add") {
    if (!itemOf(op.id) || typeof op.uid !== "string" || op.uid.length > 24 || c.some((x) => x.uid === op.uid) || c.length >= CART_MAX) return c
    return [...c, { uid: op.uid, id: op.id, by: String(op.by || "").slice(0, 40) }]
  }
  return c
}
export const cartTotal = (cart) => (cart || []).reduce((s, x) => s + (CATALOG[x.id]?.price || 0), 0)
// at the register: who gets what. The one paying keeps their own things (and anything nobody
// claimed); a friend's things go to them as gifts. -> { cost, mine: { id: n }, gifts: { name: { id: n } } }
export const checkoutSplit = (cart, payer) => {
  const mine = {}
  const gifts = {}
  for (const x of cart || []) {
    if (!itemOf(x.id)) continue
    if (!x.by || x.by === payer) mine[x.id] = (mine[x.id] || 0) + 1
    else (gifts[x.by] ||= {})[x.id] = (gifts[x.by][x.id] || 0) + 1
  }
  return { cost: cartTotal(cart), mine, gifts }
}
// paying with the chip bank (casino/bank.js shape: { balance, take(n), needsRefill(), refill() })
export const payChips = (bank, cost) => {
  if (!(cost > 0)) return { ok: false, error: "The cart is empty." }
  let refilled = false
  if (bank.balance < cost && bank.needsRefill?.()) refilled = !!bank.refill?.()
  if (!bank.take(cost)) return { ok: false, error: `That's ${cost} chips; you have ${bank.balance}. Put something back?` }
  return { ok: true, cost, refilled }
}
