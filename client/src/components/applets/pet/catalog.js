// What Our Pet knows about: the four kinds of creature, colors, food and the wardrobe.
// (The server's lists in server/pet/logic.js match these ids.)

export const PROGRAM = "Our Pet"

export const SPECIES = [
  { id: "bunnycat", label: "Bunnycat", blurb: "Long ears, a curly tail, a little purr" },
  { id: "dragon", label: "Dragonlet", blurb: "Tiny wings, big heart, warm toes" },
  { id: "sheep", label: "Puffsheep", blurb: "A cloud of wool that loves naps" },
  { id: "mochi", label: "Mochi Sprout", blurb: "A squishy dumpling with a leaf on top" },
]
export const speciesLabel = (id) => SPECIES.find((s) => s.id === id)?.label || "Pet"

// fill, shade (shadows, inner bits) and line (soft outlines)
export const PALETTE = {
  cream: { label: "Cream", fill: "#fff3dc", shade: "#f1d6a8", line: "#8b6a46" },
  peach: { label: "Peach", fill: "#ffd9c4", shade: "#f5b294", line: "#97573a" },
  pink: { label: "Pink", fill: "#ffd3df", shade: "#f4a6bc", line: "#9b4762" },
  lilac: { label: "Lilac", fill: "#e6d8ff", shade: "#c5aef2", line: "#66509a" },
  sky: { label: "Sky", fill: "#d2e9ff", shade: "#a4caf2", line: "#3e6995" },
  mint: { label: "Mint", fill: "#d2f6e3", shade: "#9fdcbc", line: "#3a7a5a" },
  lemon: { label: "Lemon", fill: "#fff4ad", shade: "#efd56a", line: "#8a7221" },
  cocoa: { label: "Cocoa", fill: "#dcbca0", shade: "#b98e6e", line: "#5a3a26" },
}
export const COLORS = Object.keys(PALETTE)

export const DEFAULT_LOOK = {
  bunnycat: { body: "cream", accent: "pink" },
  dragon: { body: "mint", accent: "lemon" },
  sheep: { body: "cream", accent: "cocoa" },
  mochi: { body: "pink", accent: "mint" },
}

export const NAME_IDEAS = ["Mochi", "Bean", "Pudding", "Biscuit", "Peaches", "Sprout", "Nugget", "Boba", "Dumpling", "Clover", "Pickle", "Toast"]

export const FOODS = [
  { id: "strawberry", label: "Strawberry" },
  { id: "carrot", label: "Carrot" },
  { id: "cookie", label: "Heart cookie" },
  { id: "fish", label: "Little fish" },
  { id: "riceball", label: "Rice ball" },
  { id: "milk", label: "Milk" },
]

// slot and the bond level that unlocks it
export const ACCESSORIES = [
  { id: "bow", label: "Bow", slot: "head", level: 0 },
  { id: "scarf", label: "Scarf", slot: "neck", level: 1 },
  { id: "glasses", label: "Glasses", slot: "eyes", level: 2 },
  { id: "beanie", label: "Beanie", slot: "head", level: 3 },
  { id: "flowers", label: "Flower crown", slot: "head", level: 4 },
  { id: "shades", label: "Heart shades", slot: "eyes", level: 5 },
  { id: "tophat", label: "Top hat", slot: "head", level: 7 },
  { id: "crown", label: "Crown", slot: "head", level: 10 },
]

export const STAGE_LABEL = { baby: "Baby", kid: "Kid", grown: "All grown up" }

export const STATS = [
  { id: "fullness", label: "Tummy" },
  { id: "happiness", label: "Happy" },
  { id: "cleanliness", label: "Clean" },
  { id: "energy", label: "Energy" },
]

// ---- this device's choices ----

const PREFS_KEY = "98ish.pet.prefs"
const prefListeners = new Set()

export const getPrefs = (mobile = false) => {
  let saved = {}
  try {
    saved = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}
  } catch {
    saved = {}
  }
  // the little desktop walker: on for computers, off for phones until you turn it on
  return { walker: saved.walker ?? !mobile, reminders: saved.reminders ?? true }
}
export const setPrefs = (patch, mobile = false) => {
  const next = { ...getPrefs(mobile), ...patch }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next))
  } catch {
    // storage blocked: this visit only
  }
  prefListeners.forEach((fn) => fn(next))
  return next
}
export const onPrefs = (fn) => {
  prefListeners.add(fn)
  return () => prefListeners.delete(fn)
}

// local day number (for "once a day" reminders)
export const localDay = (time) => {
  const d = new Date(time)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
