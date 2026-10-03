// The couple's pet, as plain functions of (pet, time): how its stats drift over real time,
// what each kind of care does, how it grows, and when it goes to Grandma's. No storage and
// no clock of its own, so the tests can walk it through days in a moment.
//
// It never dies. Left alone it gets hungry and sad, and after 5 days without anyone
// looking after it, it goes to stay with Grandma until both of you come to visit.
// (The client's lists in client/src/components/applets/pet/catalog.js match these.)

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const RUNAWAY_MS = 5 * DAY
const MAX_BOND = 1000
const BOND_PER_LEVEL = 100
const DAILY_BOND_CAP = 40 // from each partner's care, per day (the together bonus is extra)
const TOGETHER_BONUS = 15 // both of you looked after it today
const KID_DAYS = 4 // days with any care
const GROWN_DAYS = 12
const LOG_SIZE = 40

const SPECIES = ["bunnycat", "dragon", "sheep", "mochi"]
const COLORS = ["cream", "peach", "pink", "lilac", "sky", "mint", "lemon", "cocoa"]
// food -> [fullness, happiness, words for the log]
const FOODS = {
  strawberry: [18, 8, "a strawberry"],
  carrot: [22, 3, "a crunchy carrot"],
  cookie: [12, 14, "a heart cookie"],
  fish: [30, 6, "a little fish"],
  riceball: [34, 4, "a rice ball"],
  milk: [16, 8, "a bottle of milk"],
}
// accessory -> [slot, bond level needed]
const ACCESSORIES = {
  bow: ["head", 0],
  scarf: ["neck", 1],
  glasses: ["eyes", 2],
  beanie: ["head", 3],
  flowers: ["head", 4],
  shades: ["eyes", 5],
  tophat: ["head", 7],
  crown: ["head", 10],
}
// the change each care makes (fullness, happiness, cleanliness, energy) and its bond
const CARE = {
  feed: { bond: 3 },
  play: { bond: 4 },
  pet: { bond: 3 },
  bathe: { bond: 3 },
  sleep: { bond: 2 },
}
// points per hour: awake / asleep
const AWAKE = { fullness: -3.5, happiness: -2.5, cleanliness: -2, energy: -3 }
const ASLEEP = { fullness: -1.5, happiness: -0.5, cleanliness: -0.5, energy: 15 }

const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n))
const round = (n) => Math.round(n * 10) / 10

// a day number in the couple's time zone (minutes, like Date#getTimezoneOffset)
const dayOf = (time, tz = 0) => Math.floor((time - tz * 60_000) / DAY)

class Nope extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const nope = (status, message) => {
  throw new Nope(status, message)
}

const newPet = ({ species, name, body, accent, tz }, by, byName, now) => ({
  species,
  name,
  body,
  accent,
  tz,
  adoptedAt: now,
  adoptedBy: byName,
  stats: { fullness: 80, happiness: 90, cleanliness: 100, energy: 90 },
  at: now, // when stats were last worked out
  asleep: false,
  bond: 0,
  worn: [],
  lastCareAt: now,
  care: {}, // key -> last care time
  careDay: { day: dayOf(now, tz), by: [], bond: {}, together: false },
  careDays: 0, // days anyone looked after it (it grows with these)
  lastCareDay: null,
  fedDays: [], // recent days it was fed
  togetherDays: 0,
  visits: {}, // key -> time (bringing it home from Grandma's)
  proposal: null, // { by, byName, name }
  lastPlayAt: {},
  log: [{ at: now, by: byName, kind: "adopt", text: `${byName} adopted ${name}! Welcome home ♥` }],
})

// The stats at `now`, worked out from the last time they were set. Asleep, energy fills
// up and it wakes by itself once rested; awake and worn out, it dozes off on its own.
const advance = (pet, now) => {
  const stats = { ...pet.stats }
  let asleep = pet.asleep
  let hours = Math.max(0, now - pet.at) / HOUR
  const step = (rates, h) => {
    for (const k of Object.keys(rates)) stats[k] = clamp(stats[k] + rates[k] * h)
  }
  for (let i = 0; i < 200 && hours > 0; i++) {
    if (asleep) {
      const h = Math.min(hours, Math.max(0, (100 - stats.energy) / ASLEEP.energy))
      step(ASLEEP, h)
      hours -= h
      if (stats.energy >= 100) asleep = false
    } else {
      const h = Math.min(hours, Math.max(0, stats.energy / -AWAKE.energy))
      step(AWAKE, h)
      hours -= h
      if (stats.energy <= 0) asleep = true
    }
  }
  for (const k of Object.keys(stats)) stats[k] = round(stats[k])
  return { ...pet, stats, asleep, at: now }
}

const awaySince = (pet) => pet.lastCareAt + RUNAWAY_MS
const isAway = (pet, now) => now >= awaySince(pet)

const stageOf = (pet) => (pet.careDays >= GROWN_DAYS ? "grown" : pet.careDays >= KID_DAYS ? "kid" : "baby")
const bondLevel = (bond) => Math.min(MAX_BOND / BOND_PER_LEVEL, Math.floor(bond / BOND_PER_LEVEL))
const unlockedAccessories = (bond) => Object.keys(ACCESSORIES).filter((id) => ACCESSORIES[id][1] <= bondLevel(bond))

const moodOf = (pet, now) => {
  if (isAway(pet, now)) return "away"
  const s = pet.stats
  if (pet.asleep) return "sleeping"
  if (s.fullness < 25) return "hungry"
  if (s.happiness < 25) return "sad"
  if (s.cleanliness < 25) return "messy"
  if (s.energy < 20) return "sleepy"
  const low = Math.min(s.fullness, s.happiness, s.cleanliness, s.energy)
  if (low >= 60 && s.happiness >= 75) return "happy"
  return "okay"
}

// consecutive days fed, ending today (or yesterday, if today isn't over yet)
const fedStreak = (pet, now) => {
  const days = new Set(pet.fedDays)
  let day = dayOf(now, pet.tz)
  if (!days.has(day)) day--
  let n = 0
  while (days.has(day)) {
    n++
    day--
  }
  return n
}

// a new day: start counting who looked after it today afresh
const rollDay = (pet, now) => {
  const day = dayOf(now, pet.tz)
  if (pet.careDay?.day === day) return pet
  return { ...pet, careDay: { day, by: [], bond: {}, together: false } }
}

// the diary; the same thing again soon after just counts up ("x3")
const addLog = (pet, entry) => {
  const last = pet.log[pet.log.length - 1]
  if (last && last.text === entry.text && entry.at - last.at < 30 * 60_000) {
    return { ...pet, log: [...pet.log.slice(0, -1), { ...last, at: entry.at, times: (last.times || 1) + 1 }] }
  }
  return { ...pet, log: [...pet.log, entry].slice(-LOG_SIZE) }
}

// Someone looks after it: bond (up to the day's cap), the together bonus when you've
// both been by today, and growing up. -> { pet, together }
const cared = (pet, key, kind, now, extraBond = 0) => {
  pet = rollDay(pet, now)
  const day = pet.careDay.day
  const careDay = { ...pet.careDay, by: [...pet.careDay.by], bond: { ...pet.careDay.bond } }
  const given = careDay.bond[key] || 0
  const gain = Math.max(0, Math.min(CARE[kind].bond + extraBond, DAILY_BOND_CAP - given))
  careDay.bond[key] = given + gain
  if (!careDay.by.includes(key)) careDay.by.push(key)
  let bond = pet.bond + gain
  let together = false
  if (careDay.by.length >= 2 && !careDay.together) {
    careDay.together = true
    together = true
    bond += TOGETHER_BONUS
  }
  const newDay = pet.lastCareDay !== day
  return {
    pet: {
      ...pet,
      careDay,
      bond: Math.min(MAX_BOND, bond),
      lastCareAt: now,
      care: { ...pet.care, [key]: now },
      careDays: pet.careDays + (newDay ? 1 : 0),
      lastCareDay: day,
      togetherDays: pet.togetherDays + (together ? 1 : 0),
    },
    together,
  }
}

const words = (kind, pet, byName, detail) => {
  const n = pet.name
  if (kind === "feed") return `${byName} fed ${n} ${FOODS[detail][2]}`
  if (kind === "play") return `${byName} played catch with ${n} (${detail} treats!)`
  if (kind === "pet") return `${byName} gave ${n} a cuddle`
  if (kind === "bathe") return `${byName} gave ${n} a bubble bath`
  if (kind === "sleep") return `${byName} tucked ${n} in for a nap`
  if (kind === "wake") return `${byName} woke ${n} up`
  if (kind === "dress") return detail.length ? `${byName} dressed ${n} up` : `${byName} took off ${n}'s outfit`
  return `${byName} visited ${n}`
}

// One partner does something for the pet. input: { action, food?, score?, worn? }
// -> { pet, together, entry }
const act = (pet, key, byName, input, now) => {
  if (isAway(pet, now)) nope(409, `${pet.name} is staying at Grandma's. Visit together to bring them home!`)
  pet = advance(pet, now)
  const action = String(input?.action || "")
  const s = { ...pet.stats }
  const n = pet.name
  let detail = null
  let extraBond = 0

  if (pet.asleep && !["pet", "wake", "dress"].includes(action)) nope(409, `Shh... ${n} is sleeping. Wake them up first.`)

  if (action === "feed") {
    const food = String(input.food || "")
    if (!FOODS[food]) nope(400, "That's not on the menu.")
    if (s.fullness >= 96) nope(409, `${n} is full! Maybe a little later.`)
    s.fullness = clamp(s.fullness + FOODS[food][0])
    s.happiness = clamp(s.happiness + FOODS[food][1])
    detail = food
  } else if (action === "play") {
    const score = Number(input.score)
    if (!Number.isInteger(score) || score < 0 || score > 60) nope(400, "That score doesn't look right.")
    if (now - (pet.lastPlayAt?.[key] || 0) < 15_000) nope(429, "Catch your breath first!")
    if (s.energy < 10) nope(409, `${n} is too sleepy to play. Time for a nap?`)
    s.happiness = clamp(s.happiness + 12 + Math.min(score, 30) / 2)
    s.energy = clamp(s.energy - 12)
    s.fullness = clamp(s.fullness - 5)
    s.cleanliness = clamp(s.cleanliness - 6)
    extraBond = Math.min(4, Math.floor(score / 8))
    detail = score
    pet = { ...pet, lastPlayAt: { ...pet.lastPlayAt, [key]: now } }
  } else if (action === "pet") {
    s.happiness = clamp(s.happiness + (pet.asleep ? 4 : 10))
  } else if (action === "bathe") {
    s.cleanliness = 100
    s.happiness = clamp(s.happiness + 4)
  } else if (action === "sleep") {
    if (s.energy >= 90) nope(409, `${n} isn't sleepy yet!`)
  } else if (action === "wake") {
    if (!pet.asleep) nope(409, `${n} is already awake.`)
  } else if (action === "dress") {
    const worn = Array.isArray(input.worn) ? [...new Set(input.worn.map(String))] : nope(400, "Pick what to wear.")
    const open = unlockedAccessories(pet.bond)
    const slots = new Set()
    for (const id of worn) {
      if (!ACCESSORIES[id]) nope(400, "That's not in the wardrobe.")
      if (!open.includes(id)) nope(403, "That one unlocks at a higher bond level.")
      const slot = ACCESSORIES[id][0]
      if (slots.has(slot)) nope(400, "One thing per spot, please.")
      slots.add(slot)
    }
    detail = worn
  } else nope(400, "That isn't something you can do with a pet.")

  pet = { ...pet, stats: s }
  if (action === "sleep") pet.asleep = true
  if (action === "wake") pet.asleep = false
  if (action === "dress") pet.worn = detail

  let together = false
  if (CARE[action]) {
    const result = cared(pet, key, action, now, extraBond)
    pet = result.pet
    together = result.together
  }
  if (action === "feed") {
    const day = dayOf(now, pet.tz)
    pet.fedDays = [...new Set([...pet.fedDays, day])].sort((a, b) => a - b).slice(-30)
  }
  const entry = { at: now, by: byName, kind: action, text: words(action, pet, byName, detail), detail }
  pet = addLog(pet, entry)
  if (together) pet = addLog(pet, { at: now, by: null, kind: "together", text: `${n} saw you both today! Family time ♥` })
  return { pet, together, entry }
}

// Visiting Grandma's: once you've both come by (since it left), it comes home happy, and
// that counts as both of you looking after it today. -> { pet, home, together }
const visit = (pet, key, byName, otherKey, now) => {
  if (!isAway(pet, now)) nope(409, `${pet.name} is home!`)
  const since = awaySince(pet)
  const visits = { ...pet.visits, [key]: now }
  const home = (visits[otherKey] || 0) >= since
  if (!home) {
    pet = addLog({ ...pet, visits }, { at: now, by: byName, kind: "visit", text: `${byName} visited ${pet.name} at Grandma's` })
    return { pet, home: false, together: false }
  }
  pet = {
    ...pet,
    visits: {},
    stats: { fullness: 75, happiness: 95, cleanliness: 100, energy: 85 },
    asleep: false,
    at: now,
    lastCareAt: now,
  }
  pet = cared(pet, otherKey, "pet", now).pet
  const both = cared(pet, key, "pet", now)
  pet = addLog(both.pet, { at: now, by: byName, kind: "home", text: `${pet.name} came home from Grandma's! Grandma sent cookies ♥` })
  if (both.together) pet = addLog(pet, { at: now, by: null, kind: "together", text: `${pet.name} saw you both today! Family time ♥` })
  return { pet, home: true, together: both.together }
}

// Name changes need both of you: one suggests, the other says yes (or no)
const propose = (pet, key, byName, name, now) => {
  if (pet.proposal) nope(409, `There's already a name waiting: "${pet.proposal.name}".`)
  if (name === pet.name) nope(400, `${pet.name} is already called that!`)
  return addLog({ ...pet, proposal: { by: key, byName, name, at: now } }, { at: now, by: byName, kind: "name", text: `${byName} suggested a new name: ${name}` })
}
const answer = (pet, key, byName, yes, now) => {
  const p = pet.proposal
  if (!p) nope(404, "No name is waiting.")
  // the one who suggested it can take it back; only the other one can say yes
  if (p.by === key && yes) nope(403, "Your partner gets to say yes to this one.")
  const old = pet.name
  pet = { ...pet, proposal: null, name: yes ? p.name : pet.name }
  const text = yes ? `${byName} said yes: ${old} is now called ${p.name}!` : p.by === key ? `${byName} took back "${p.name}"` : `${byName} liked ${old} better`
  return addLog(pet, { at: now, by: byName, kind: "name", text })
}

// What one of the two sees
const view = (stored, me, partner, partnerName, now) => {
  const away = isAway(stored, now)
  // away: show it as it was when it left (worked out at that moment)
  const pet = advance(stored, away ? Math.max(stored.at, awaySince(stored)) : now)
  const today = dayOf(now, pet.tz)
  const by = pet.careDay?.day === today ? pet.careDay.by : []
  return {
    species: pet.species,
    name: pet.name,
    body: pet.body,
    accent: pet.accent,
    adoptedAt: pet.adoptedAt,
    adoptedBy: pet.adoptedBy,
    ageDays: Math.max(0, today - dayOf(pet.adoptedAt, pet.tz)),
    stage: stageOf(pet),
    careDays: pet.careDays,
    stats: pet.stats,
    asleep: away ? false : pet.asleep,
    mood: away ? "away" : moodOf(pet, now),
    bond: pet.bond,
    bondLevel: bondLevel(pet.bond),
    maxBond: MAX_BOND,
    unlocked: unlockedAccessories(pet.bond),
    worn: pet.worn,
    caredToday: { me: by.includes(me), partner: by.includes(partner) },
    together: !!(pet.careDay?.day === today && pet.careDay.together),
    togetherDays: pet.togetherDays,
    missing: by.includes(partner) ? null : partnerName,
    fedStreak: fedStreak(pet, now),
    away: away ? { since: awaySince(pet), visited: Object.entries(pet.visits || {}).filter(([, t]) => t >= awaySince(pet)).map(([k]) => (k === me ? "me" : "partner")) } : null,
    proposal: pet.proposal ? { name: pet.proposal.name, byName: pet.proposal.byName, mine: pet.proposal.by === me } : null,
    lastPlayAt: pet.lastPlayAt?.[me] || 0,
    log: pet.log.slice(-25).reverse(),
  }
}

module.exports = {
  HOUR,
  DAY,
  RUNAWAY_MS,
  MAX_BOND,
  DAILY_BOND_CAP,
  TOGETHER_BONUS,
  KID_DAYS,
  GROWN_DAYS,
  SPECIES,
  COLORS,
  FOODS,
  ACCESSORIES,
  AWAKE,
  ASLEEP,
  Nope,
  dayOf,
  newPet,
  advance,
  isAway,
  awaySince,
  moodOf,
  stageOf,
  bondLevel,
  unlockedAccessories,
  fedStreak,
  act,
  visit,
  propose,
  answer,
  view,
}
