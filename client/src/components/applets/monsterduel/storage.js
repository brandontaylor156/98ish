// Monster Duel's local data (this browser only): options, your card collection, your
// decks, unopened packs, and win/loss records. Nothing here goes to the server; online
// duels check decks against the card pool, not against what you own.

import { CARD, POOL } from "./engine/cards"
import { STARTERS, limitOf } from "./engine/decks"

const KEY = "98ish.monsterduel"
export const START_PACKS = 3

// you start owning every card the starter decks use (as many copies as the most any of
// them has); packs bring more copies and the rest
const startingCollection = () => {
  const out = {}
  for (const s of STARTERS) {
    const counts = {}
    for (const id of [...s.main, ...s.extra]) counts[id] = (counts[id] || 0) + 1
    for (const [id, n] of Object.entries(counts)) out[id] = Math.max(out[id] || 0, n)
  }
  return out
}

const DEFAULT = () => ({
  prefs: { sound: true, respond: "auto", turnTime: 0, pace: "normal", deck: "starter:dragons", opponent: "rookie" },
  collection: startingCollection(),
  decks: [], // [{ id, name, main, extra }]
  packs: START_PACKS,
  stats: { wins: 0, losses: 0, draws: 0, online: 0, beaten: {} },
  tutorialDone: false,
  fresh: [], // card ids pulled but not looked at in the collection yet
})

export const load = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY))
    if (!raw || typeof raw !== "object") return DEFAULT()
    const base = DEFAULT()
    return {
      ...base,
      ...raw,
      prefs: { ...base.prefs, ...raw.prefs },
      collection: { ...base.collection, ...raw.collection },
      stats: { ...base.stats, ...raw.stats, beaten: { ...raw.stats?.beaten } },
      decks: Array.isArray(raw.decks) ? raw.decks.filter((d) => d && Array.isArray(d.main)) : [],
      fresh: Array.isArray(raw.fresh) ? raw.fresh : [],
    }
  } catch {
    return DEFAULT()
  }
}

const save = (data) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // storage full or blocked: remembered for this visit only
  }
  return data
}

export const update = (fn) => save(fn(load()))
export const savePrefs = (patch) => update((d) => ({ ...d, prefs: { ...d.prefs, ...patch } }))

export const saveDeck = (deck) =>
  update((d) => {
    const id = deck.id || `deck${Date.now().toString(36)}`
    const clean = { id, name: String(deck.name || "My Deck").slice(0, 40), main: [...deck.main], extra: [...(deck.extra || [])] }
    const decks = d.decks.some((x) => x.id === id) ? d.decks.map((x) => (x.id === id ? clean : x)) : [...d.decks, clean]
    return { ...d, decks }
  })
export const deleteDeck = (id) => update((d) => ({ ...d, decks: d.decks.filter((x) => x.id !== id) }))

// a deck choice: "starter:<id>" or "deck:<id>" -> { name, main, extra } or null
export const deckFor = (data, key) => {
  if (!key) return null
  if (key.startsWith("starter:")) {
    const s = STARTERS.find((x) => x.id === key.slice(8))
    return s ? { name: s.name, main: s.main, extra: s.extra, starter: s.id } : null
  }
  const d = data.decks.find((x) => `deck:${x.id}` === key)
  return d ? { name: d.name, main: d.main, extra: d.extra } : null
}

// ---------- packs ----------

const RARITY_ODDS = [
  ["UR", 0.08],
  ["SR", 0.27],
  ["R", 0.65],
]
const byRarity = (r) => POOL.filter((c) => c.rarity === r || (r === "SR" && c.sub === "fusion"))

// five cards: three commons, a rare, and one rare-or-better
export const rollPack = (random = Math.random) => {
  const pickFrom = (list) => list[Math.floor(random() * list.length)].id
  const commons = byRarity("C")
  const out = [pickFrom(commons), pickFrom(commons), pickFrom(commons), pickFrom(byRarity("R"))]
  let roll = random()
  let rarity = "R"
  for (const [r, p] of RARITY_ODDS) {
    if (roll < p) {
      rarity = r
      break
    }
    roll -= p
  }
  out.push(pickFrom(byRarity(rarity)))
  return out
}

// open a pack: -> { data, cards: [{ id, isNew }] } or null with none left
export const openPack = (random = Math.random) => {
  const data = load()
  if (data.packs <= 0) return null
  const ids = rollPack(random)
  const collection = { ...data.collection }
  const cards = ids.map((id) => {
    const had = collection[id] || 0
    collection[id] = had + 1
    return { id, isNew: had === 0 }
  })
  const fresh = [...new Set([...data.fresh, ...cards.filter((c) => c.isNew).map((c) => c.id)])]
  return { data: save({ ...data, packs: data.packs - 1, collection, fresh }), cards }
}

export const addPacks = (n) => update((d) => ({ ...d, packs: d.packs + n }))

// a finished duel against the computer (or online) -> { data, packs earned }
export const recordResult = ({ won, draw = false, opponent = null, packs = 0, online = false }) => {
  let earned = 0
  const data = update((d) => {
    const stats = { ...d.stats, beaten: { ...d.stats.beaten } }
    if (draw) stats.draws++
    else if (won) {
      stats.wins++
      if (online) stats.online++
      if (opponent) stats.beaten[opponent] = (stats.beaten[opponent] || 0) + 1
      earned = packs
    } else stats.losses++
    return { ...d, stats, packs: d.packs + earned }
  })
  return { data, earned }
}

// how many copies you own (a card the deck builder may add up to this many of)
export const owned = (data, id) => Math.min(limitOf(id), data.collection[id] || 0)

export const collectionProgress = (data) => {
  const ids = POOL.map((c) => c.id)
  const have = ids.filter((id) => data.collection[id] > 0).length
  return { have, total: ids.length }
}

export const isCard = (id) => !!CARD[id]
