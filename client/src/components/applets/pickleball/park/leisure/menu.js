// My Park leisure: what you can order and buy, and paying for it (pure; Node-tested).
//
// The owner: "Ordering food at the bar or drinks or at the clubhouse/restaurant". Original items
// (no brands), priced in Casino 98's play chips (the shared chip bank, casino/bank.js: no real
// money; when you're broke the house refills you). A bar serves drinks and food, a cafe coffee,
// smoothies and a bite, a snack window the classics, a drinks machine cold drinks.
//
// Every item is something your player holds and finishes (sips or bites) with an animation;
// `held` is how it's drawn in the hand (leisure/held.js).

export const ITEMS = {
  // drinks
  lemonade: { name: "Fresh lemonade", icon: "🍋", price: 6, kind: "drink", held: "cup", color: "#f4e27a", sips: 6 },
  halfhalf: { name: "Half & half (iced tea and lemonade)", short: "Half & half", icon: "🧊", price: 6, kind: "drink", held: "cup", color: "#c98a3a", sips: 6 },
  mango: { name: "Kitchen Line smoothie (mango, pineapple)", short: "Mango smoothie", icon: "🥭", price: 9, kind: "drink", held: "cup", color: "#ffb43a", sips: 6, lid: true },
  berry: { name: "Third Shot smoothie (mixed berries)", short: "Berry smoothie", icon: "🫐", price: 9, kind: "drink", held: "cup", color: "#b03a6e", sips: 6, lid: true },
  icedcoffee: { name: "Iced coffee", icon: "🧋", price: 6, kind: "drink", held: "cup", color: "#8a5a3a", sips: 6 },
  coffee: { name: "Hot coffee", icon: "☕", price: 4, kind: "drink", held: "mug", color: "#5a3a26", sips: 5 },
  sparkling: { name: "Sparkling water", icon: "🫧", price: 4, kind: "drink", held: "bottle", color: "#bfe4f0", sips: 5 },
  // (the owner, 2026-10-09: the bars serve beer and wine)
  beer: { name: "Draft beer (golden ale)", short: "Draft beer", icon: "🍺", price: 8, kind: "drink", held: "pint", color: "#e3a62b", sips: 6, adult: true },
  wine: { name: "Glass of red wine", short: "Red wine", icon: "🍷", price: 10, kind: "drink", held: "wine", color: "#7a1630", sips: 5, adult: true },
  white: { name: "Glass of white wine", short: "White wine", icon: "🥂", price: 10, kind: "drink", held: "wine", color: "#efe3a0", sips: 5, adult: true },
  // food
  burger: { name: "Club burger", icon: "🍔", price: 14, kind: "food", held: "burger", sips: 5 },
  fries: { name: "Fries", icon: "🍟", price: 6, kind: "food", held: "fries", sips: 5 },
  tacos: { name: "Fish tacos", icon: "🌮", price: 12, kind: "food", held: "taco", sips: 4 },
  wrap: { name: "Chicken wrap", icon: "🌯", price: 11, kind: "food", held: "wrap", sips: 5 },
  // the machine
  fizz: { name: "Fizz (orange soda)", short: "Fizz", icon: "🥤", price: 3, kind: "drink", held: "can", color: "#ff8a1f", sips: 5, machine: true },
  limepop: { name: "Lemon-lime pop", icon: "🥤", price: 3, kind: "drink", held: "can", color: "#7ccf4a", sips: 5, machine: true },
  water: { name: "Ice-cold water", icon: "💧", price: 2, kind: "drink", held: "bottle", color: "#dff3fb", sips: 5, machine: true },
  sports: { name: "Sports drink", icon: "🧃", price: 3, kind: "drink", held: "bottle", color: "#3ac0ff", sips: 5, machine: true },
}
export const ITEM_IDS = Object.keys(ITEMS)
export const itemById = (id) => (typeof id === "string" && Object.prototype.hasOwnProperty.call(ITEMS, id) ? { id, ...ITEMS[id] } : null)
export const itemName = (id) => ITEMS[id]?.short || ITEMS[id]?.name || ""

// what each kind of place serves
export const MENUS = {
  bar: ["beer", "wine", "white", "lemonade", "halfhalf", "sparkling", "burger", "fries", "tacos", "wrap"],
  cafe: ["mango", "berry", "icedcoffee", "coffee", "lemonade", "wrap", "fries"],
  // (a cafe that is also a bar: Paseo's "Cafe and bar")
  cafebar: ["mango", "berry", "icedcoffee", "coffee", "beer", "wine", "white", "lemonade", "wrap", "fries"],
  snack: ["burger", "fries", "tacos", "lemonade", "halfhalf", "sparkling"],
  // (food trucks: street food and cold drinks)
  truck: ["tacos", "burger", "fries", "wrap", "lemonade", "halfhalf", "sparkling"],
  vending: ["fizz", "limepop", "water", "sports"],
}
export const menuFor = (spot) => (MENUS[spot?.kind === "vending" ? "vending" : spot?.menu] || []).map(itemById).filter(Boolean)

// paying: the bank (casino/bank.js shape: { balance, take(n) -> ok, needsRefill(), refill() })
// for = "me" | "pal" | "both" -> { ok, cost, error?, refilled? }
export const costOf = (item, who = "me") => (item ? item.price * (who === "both" ? 2 : 1) : 0)
export const pay = (bank, item, who = "me") => {
  const cost = costOf(item, who)
  if (!item || !(cost > 0)) return { ok: false, cost, error: "That's not on the menu." }
  // (the house's free refill, as at the casino tables: you're never stuck without a drink)
  let refilled = false
  if (bank.balance < cost && bank.needsRefill?.()) refilled = !!bank.refill?.()
  if (!bank.take(cost)) return { ok: false, cost, error: `That's ${cost} chips; you have ${bank.balance}.` }
  return { ok: true, cost, refilled }
}
// a refund when a treat for a friend wasn't taken (they said not now, or left)
export const refund = (bank, item) => {
  const n = costOf(item, "me")
  if (n > 0) bank.give(n)
  return n
}

// holding something: { id, left } (sips or bites left). sip() -> the next state (null: all gone)
export const startHolding = (id) => {
  const it = itemById(id)
  return it ? { id, left: it.sips } : null
}
export const sip = (held) => {
  if (!held) return null
  const left = held.left - 1
  return left > 0 ? { ...held, left } : null
}
export const verbFor = (id) => (ITEMS[id]?.kind === "food" ? "Bite" : "Sip")
