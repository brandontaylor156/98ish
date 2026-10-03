// Speed Typist 98's prompt library: every prompt is original text written for this game.
// Each prompt gets a stable id (category + number), a category and a length (short,
// medium or long, from its character count). Plain ES module: the server's rules load it
// too (server/arcade/games/speedtype.js).

import facts from "./facts.js"
import stories from "./stories.js"
import retro from "./retro.js"
import twisters from "./twisters.js"
import pangrams from "./pangrams.js"
import code from "./code.js"
import numbers from "./numbers.js"

export const CATEGORIES = [
  { id: "facts", label: "Fun Facts", list: facts },
  { id: "stories", label: "Tiny Stories", list: stories },
  { id: "retro", label: "Retro Computing", list: retro },
  { id: "twisters", label: "Tongue Twisters", list: twisters },
  { id: "pangrams", label: "Pangrams", list: pangrams },
  { id: "code", label: "Code", list: code },
  { id: "numbers", label: "Numbers & Symbols", list: numbers },
]

export const LENGTHS = [
  { id: "short", label: "Short", text: "under 100 letters" },
  { id: "medium", label: "Medium", text: "100 to 220 letters" },
  { id: "long", label: "Long", text: "over 220 letters" },
]

export const lengthOf = (text) => (text.length <= 100 ? "short" : text.length <= 220 ? "medium" : "long")

export const PROMPTS = CATEGORIES.flatMap(({ id, list }) => list.map((text, i) => ({ id: `${id}-${i + 1}`, category: id, length: lengthOf(text), text })))

export const promptById = (id) => PROMPTS.find((p) => p.id === id) || null
export const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || (id === "custom" ? "Custom Text" : id === "drill" ? "Practice Drill" : "Any")

// the prompts for these settings ("any" matches everything); never empty: a length or
// category with nothing in it falls back to the other filter, then to the whole library
export const poolFor = ({ length = "any", category = "any" } = {}) => {
  const both = PROMPTS.filter((p) => (length === "any" || p.length === length) && (category === "any" || p.category === category))
  if (both.length) return both
  const byCategory = PROMPTS.filter((p) => category === "any" || p.category === category)
  if (byCategory.length) return byCategory
  return PROMPTS
}

// n different prompts (if there are that many) chosen with random()
export const pickPrompts = (settings, n = 1, random = Math.random) => {
  const pool = [...poolFor(settings)]
  const out = []
  while (out.length < n) {
    if (!pool.length) pool.push(...poolFor(settings))
    out.push(pool.splice(Math.floor(random() * pool.length) % pool.length, 1)[0])
  }
  return out
}

// The daily prompt: the same medium-length prompt for everyone on a given day ("2026-10-03")
export const dailyPrompt = (dayKey) => {
  const pool = PROMPTS.filter((p) => p.length === "medium")
  let h = 2166136261
  for (const c of String(dayKey)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  return pool[h % pool.length]
}
