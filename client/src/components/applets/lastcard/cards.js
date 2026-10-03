// Last Card's cards and settings: plain data shared by the browser (solo games) and the
// server (server/arcade/games/lastcard.js), so both run the very same rules.
//
// A card is { id, c, v }: c is the color ("r" red, "y" gold, "g" green, "b" blue, "w" a
// wild), v the value ("0".."9", "skip", "rev", "d2", "wild", "wd4", and with Extra Cards on,
// "skipall", "discall" and "wd6"). Ids are shuffled numbers: they say nothing about the card.

export const COLORS = ["r", "y", "g", "b"]
export const COLOR_NAMES = { r: "Red", y: "Gold", g: "Green", b: "Blue", w: "Wild" }
export const NUMBERS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
export const ACTIONS = ["skip", "rev", "d2"]
export const EXTRA_ACTIONS = ["skipall", "discall"]
export const WILDS = ["wild", "wd4", "wd6"]
export const DRAWS = { d2: 2, wd4: 4, wd6: 6 }
export const VALUE_NAMES = {
  skip: "Skip",
  rev: "Reverse",
  d2: "Draw Two",
  wild: "Wild",
  wd4: "Wild Draw Four",
  wd6: "Wild Draw Six",
  skipall: "Skip All",
  discall: "Discard All",
}

export const isWild = (card) => card.c === "w"
export const cardName = (card) => (isWild(card) ? VALUE_NAMES[card.v] : `${COLOR_NAMES[card.c]} ${VALUE_NAMES[card.v] || card.v}`)

// What a card is worth to the winner of the round
export const points = (card) => {
  if (NUMBERS.includes(card.v)) return Number(card.v)
  if (card.v === "wild" || card.v === "wd4") return 50
  if (card.v === "wd6") return 60
  if (card.v === "discall") return 30
  return 20
}
export const handPoints = (hand) => hand.reduce((sum, card) => sum + points(card), 0)

// One deck: per color one 0, two of 1-9, two each of Skip, Reverse, Draw Two (25 x 4 = 100),
// plus four Wilds and four Wild Draw Fours: 108. Extra Cards adds a Skip All and a Discard
// All in each color and two Wild Draw Sixes (118).
export const buildDeck = ({ decks = 1, extras = false } = {}) => {
  const cards = []
  for (let d = 0; d < decks; d++) {
    for (const c of COLORS) {
      cards.push({ c, v: "0" })
      for (const v of [...NUMBERS.slice(1), ...ACTIONS]) cards.push({ c, v }, { c, v })
      if (extras) for (const v of EXTRA_ACTIONS) cards.push({ c, v })
    }
    for (let i = 0; i < 4; i++) cards.push({ c: "w", v: "wild" }, { c: "w", v: "wd4" })
    if (extras) cards.push({ c: "w", v: "wd6" }, { c: "w", v: "wd6" })
  }
  return cards
}

export const shuffle = (list, random = Math.random) => {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---------- settings ----------

export const TARGETS = [0, 250, 500]
export const TIMERS = [0, 15, 30, 60]
export const LEVELS = ["easy", "normal", "hard"]
export const CATCH_MS = 3000 // how long a forgotten "Last Card!" can be caught

export const DEFAULTS = {
  players: 4, // seats, 2-10
  handSize: 7, // 5-10
  target: 500, // points to win; 0 = one round
  timer: 30, // seconds a turn may take (0 = no limit); then you draw automatically
  stacking: false, // a Draw Two on a Draw Two (and Draw Fours on either) passes it on
  sevenO: false, // a 7 swaps hands with someone you pick; a 0 passes every hand along
  jumpIn: false, // play the very same card out of turn
  drawUntil: false, // keep drawing until you get a card you can play
  forcePlay: false, // a drawn card that fits must be played
  challenge: true, // a Wild Draw Four can be challenged (the official bluff rule)
  extras: false, // Skip All, Discard All and Wild Draw Six cards
  decks: 0, // 0 = enough for the table
  bots: "normal", // computer players: easy, normal, hard
}

const BOOLS = ["stacking", "sevenO", "jumpIn", "drawUntil", "forcePlay", "challenge", "extras"]
const int = (v, fallback) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? n : fallback
}

// The decks a table needs: everyone's hand plus plenty to draw from
export const decksFor = (players, handSize, wanted = 0) => {
  const need = Math.max(1, Math.ceil((players * handSize + 40) / 108))
  return Math.min(4, Math.max(need, wanted || 0))
}

// -> cleaned settings, or { error }
export const validateSettings = (raw = {}) => {
  const s = { ...DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) }
  const out = {}
  out.players = int(s.players, DEFAULTS.players)
  if (out.players < 2 || out.players > 10) return { error: "Pick 2 to 10 players." }
  out.handSize = int(s.handSize, DEFAULTS.handSize)
  if (out.handSize < 5 || out.handSize > 10) return { error: "Hands can have 5 to 10 cards." }
  out.target = int(s.target, DEFAULTS.target)
  if (!TARGETS.includes(out.target)) return { error: "Play one round, or to 250 or 500 points." }
  out.timer = int(s.timer, DEFAULTS.timer)
  if (!TIMERS.includes(out.timer)) return { error: "The turn timer can be off, 15, 30 or 60 seconds." }
  for (const k of BOOLS) out[k] = !!s[k]
  out.decks = int(s.decks, 0)
  if (out.decks < 0 || out.decks > 3) return { error: "Use 1 to 3 decks (or Auto)." }
  out.bots = LEVELS.includes(s.bots) ? s.bots : DEFAULTS.bots
  return out
}

// The house rules in a few words, for the lobby and the table
export const describeRules = (s) => {
  const parts = []
  if (s.stacking) parts.push("Stacking")
  if (s.sevenO) parts.push("7-0")
  if (s.jumpIn) parts.push("Jump-in")
  if (s.drawUntil) parts.push("Draw until you can play")
  if (s.forcePlay) parts.push("Forced play")
  if (!s.challenge) parts.push("No challenges")
  if (s.extras) parts.push("Extra cards")
  return parts.length ? parts.join(", ") : "Standard rules"
}

export const EMOTES = {
  nice: "Nice!",
  nooo: "Noooo",
  gotcha: "Gotcha!",
  oops: "Oops",
  again: "Not again...",
  watch: "Watch this",
  gg: "Good game",
  hurry: "Your move!",
  ouch: "Ouch!",
  lucky: "So lucky",
}

// Computer players' characters (picked from the name, so a seat keeps its character)
export const PERSONAS = {
  bold: { label: "Bold", text: "Hits the leader with draw cards and jumps in" },
  careful: { label: "Careful", text: "Holds wilds for when it counts" },
  sly: { label: "Sly", text: "Bluffs Draw Fours and challenges a lot" },
  chill: { label: "Chill", text: "Plays loose and chats" },
}
export const personaFor = (name = "") => {
  let h = 7
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return Object.keys(PERSONAS)[h % 4]
}
