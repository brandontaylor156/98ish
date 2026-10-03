// Monster Duel's decks: the eight starter decks and the deck rules (checked by the deck
// builder and by the game server when a player brings their own deck online).

import { CARD } from "./cards.js"

export const DECK_MIN = 30
export const DECK_MAX = 60
export const EXTRA_MAX = 15
export const MAX_COPIES = 3
export const DECK_SIZE = 40

const list = (pairs) => pairs.flatMap(([id, n = 1]) => Array(n).fill(id))

export const STARTERS = [
  {
    id: "dragons",
    name: "Dragon Lords",
    color: "#d9481c",
    icon: "D08",
    blurb: "Huge monsters and fiery tricks. Tribute for Dawnflare Sovereign and burn your way through.",
    main: list([["D02", 3], ["D12", 2], ["D01", 2], ["D03", 2], ["D04", 2], ["D05"], ["D10", 2], ["D11", 2], ["D14", 2], ["D06"], ["D07"], ["D13"], ["D09"], ["D08"], ["DS1"], ["DS2", 2], ["DS3"], ["G05"], ["G07"], ["G14"], ["G11"], ["G04"], ["T02"], ["T04", 2], ["T05"], ["T08"], ["T09"], ["T06"], ["T15"]]),
    extra: list([["F01", 2]]),
  },
  {
    id: "machines",
    name: "Iron Legion",
    color: "#7a8796",
    icon: "M12",
    blurb: "Tough walls, copies that call their twins, and a Mainframe that grows with every fallen machine.",
    main: list([["M01", 3], ["M04", 3], ["M02", 3], ["M03"], ["M05", 2], ["M06"], ["M07"], ["M08"], ["M09", 2], ["M10"], ["M11", 2], ["M12"], ["M13"], ["M14"], ["MS1"], ["MS2", 2], ["MS3"], ["G14"], ["G05"], ["G09"], ["G03"], ["T02"], ["T04"], ["T07"], ["T08"], ["T11"], ["T16"], ["T03"], ["T15"], ["T12"]]),
    extra: list([["F02", 2]]),
  },
  {
    id: "casters",
    name: "Arcane Circle",
    color: "#7b4fd6",
    icon: "S03",
    blurb: "Draw extra cards, burn Life Points, and shut down your opponent's spells with counters.",
    main: list([["S01", 2], ["S02", 2], ["S03"], ["S04", 2], ["S05", 2], ["S06"], ["S07"], ["S08", 2], ["S09"], ["S10"], ["S11", 2], ["S12"], ["S13", 2], ["S14", 3], ["SS1", 2], ["SS2"], ["G01"], ["G08", 2], ["G14"], ["G05"], ["G12"], ["T03"], ["T14"], ["T04"], ["T08"], ["T15"], ["T09"], ["T05"], ["T10"]]),
    extra: list([["F03", 2]]),
  },
  {
    id: "aquatic",
    name: "Tidal Depths",
    color: "#1f7fc4",
    icon: "A11",
    blurb: "Sneaky direct attacks and waves that wash your opponent's cards back to their hand.",
    main: list([["A01", 3], ["A02", 2], ["A03", 2], ["A04"], ["A05", 2], ["A06", 2], ["A07", 2], ["A08"], ["A09"], ["A10", 2], ["A11"], ["A12", 3], ["A13"], ["A14"], ["AS1"], ["AS2", 2], ["G14"], ["G05"], ["G18"], ["G07"], ["T04", 2], ["T10"], ["T13"], ["T02"], ["T16"], ["T08"], ["T07"], ["T15"]]),
    extra: list([["F04", 2]]),
  },
  {
    id: "insects",
    name: "Hive Swarm",
    color: "#5d9e2a",
    icon: "I13",
    blurb: "Fill the field with bugs, weaken the other side, and let the Locust Queen feast on your graveyard.",
    main: list([["I01", 3], ["I02", 3], ["I03", 2], ["I04", 3], ["I05", 2], ["I06"], ["I07", 2], ["I08"], ["I09"], ["I10"], ["I11", 2], ["I12"], ["I13"], ["I14"], ["IS1", 2], ["IS2"], ["G14"], ["G10"], ["G05"], ["G02"], ["T02"], ["T11", 2], ["T13"], ["T04"], ["T05"], ["T08"], ["T15"], ["T09"]]),
    extra: list([["F05", 2]]),
  },
  {
    id: "warriors",
    name: "Steel Vanguard",
    color: "#c79a2b",
    icon: "W14",
    blurb: "Swords, banners and double attacks. Equip your heroes and charge.",
    main: list([["W01", 3], ["W02", 2], ["W03", 2], ["W04", 2], ["W05"], ["W06"], ["W07", 2], ["W08", 2], ["W09"], ["W10"], ["W11", 2], ["W12"], ["W13", 2], ["W14"], ["WS1", 2], ["WS2", 2], ["G09"], ["G14"], ["G05"], ["G13"], ["T04"], ["T09", 2], ["T05"], ["T06"], ["T08"], ["T15"], ["T02"], ["T16"]]),
    extra: list([["F06", 2]]),
  },
  {
    id: "undead",
    name: "Restless Dead",
    color: "#5b3a73",
    icon: "U13",
    blurb: "What dies comes back. Fill your graveyard and raise it again, stronger.",
    main: list([["U01", 2], ["U02", 3], ["U03"], ["U04", 3], ["U05", 2], ["U06", 2], ["U07", 2], ["U08"], ["U09"], ["U10", 2], ["U11"], ["U12", 2], ["U13"], ["U14"], ["US1"], ["US2", 2], ["G14"], ["G06"], ["G15"], ["G05"], ["T07", 2], ["T04"], ["T17"], ["T02"], ["T08"], ["T11"], ["T15"], ["T12"]]),
    extra: list([["F07", 2]]),
  },
  {
    id: "beasts",
    name: "Wild Pack",
    color: "#8a5a2b",
    icon: "B13",
    blurb: "Hunt in packs: every wolf makes the others stronger. Fast, fierce and hard to stop.",
    main: list([["B01", 3], ["B02", 3], ["B03"], ["B04"], ["B05", 2], ["B06"], ["B07", 3], ["B08"], ["B09", 2], ["B10", 2], ["B11"], ["B12"], ["B13"], ["B14"], ["BS1", 2], ["BS2"], ["G14"], ["G08"], ["G05"], ["G11"], ["G17"], ["T04"], ["T05"], ["T06"], ["T09"], ["T08"], ["T10"], ["T01"], ["T02"], ["T15"]]),
    extra: list([["F08", 2]]),
  },
]

export const starterById = (id) => STARTERS.find((s) => s.id === id) || null

export const limitOf = (id) => CARD[id]?.limit ?? MAX_COPIES

// Check a deck -> { main, extra } (cleaned) or { error } with a sentence to show
export const validateDeck = (deck) => {
  if (!deck || typeof deck !== "object") return { error: "Pick a deck." }
  const main = Array.isArray(deck.main) ? deck.main : null
  const extra = Array.isArray(deck.extra) ? deck.extra : []
  if (!main) return { error: "That deck has no cards." }
  if (main.length > 200 || extra.length > 50) return { error: "That deck is too big." }
  for (const id of [...main, ...extra]) {
    const c = typeof id === "string" ? CARD[id] : null
    if (!c || c.token) return { error: "That deck has a card that doesn't exist." }
  }
  if (main.some((id) => CARD[id].extra)) return { error: "Fusion Monsters go in the Extra Deck." }
  if (extra.some((id) => !CARD[id].extra)) return { error: "Only Fusion Monsters can go in the Extra Deck." }
  if (main.length < DECK_MIN) return { error: `A deck needs at least ${DECK_MIN} cards (this one has ${main.length}).` }
  if (main.length > DECK_MAX) return { error: `A deck can have at most ${DECK_MAX} cards (this one has ${main.length}).` }
  if (extra.length > EXTRA_MAX) return { error: `The Extra Deck can have at most ${EXTRA_MAX} cards.` }
  const counts = {}
  for (const id of [...main, ...extra]) counts[id] = (counts[id] || 0) + 1
  for (const [id, n] of Object.entries(counts)) {
    const max = limitOf(id)
    if (n > max) return { error: max === 1 ? `"${CARD[id].name}" is limited to 1 copy.` : `At most ${max} copies of "${CARD[id].name}".` }
  }
  return { main: [...main], extra: [...extra] }
}

// counts of each card in a list of ids
export const countIds = (ids) => {
  const out = {}
  for (const id of ids) out[id] = (out[id] || 0) + 1
  return out
}
