// Speed Typist 98's practice drills: text made up on the spot for one part of the
// keyboard (home row, top row, bottom row, numbers, symbols) or from the most common words
// in the prompt library. Plain ES module; random() is passed in so tests can seed it.

import { PROMPTS } from "./prompts/index.js"

export const DRILLS = [
  { id: "home", label: "Home Row", text: "A S D F G H J K L ;", keys: "asdfghjkl" },
  { id: "top", label: "Top Row", text: "Q W E R T Y U I O P", keys: "qwertyuiop" },
  { id: "bottom", label: "Bottom Row", text: "Z X C V B N M , .", keys: "zxcvbnm" },
  { id: "numbers", label: "Numbers", text: "Digits, prices, times and dates" },
  { id: "symbols", label: "Symbols", text: "Brackets, math and punctuation" },
  { id: "common", label: "Common Words", text: "The words the prompts use most" },
]

export const drillById = (id) => DRILLS.find((d) => d.id === id) || null

// every word in the library, lowercase, letters only (with how often it shows up)
let vocab = null
export const vocabulary = () => {
  if (vocab) return vocab
  const counts = new Map()
  for (const p of PROMPTS) {
    if (p.category === "code" || p.category === "numbers") continue
    for (const raw of p.text.toLowerCase().split(/\s+/)) {
      const w = raw.replace(/^[^a-z]+|[^a-z]+$/g, "")
      if (/^[a-z]+$/.test(w)) counts.set(w, (counts.get(w) || 0) + 1)
    }
  }
  vocab = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  return vocab
}

const pick = (list, random) => list[Math.floor(random() * list.length) % list.length]

// words only made of these keys (from the library), plus made-up letter groups
const rowText = (keys, random, target) => {
  const words = vocabulary()
    .map(([w]) => w)
    .filter((w) => w.length >= 2 && [...w].every((c) => keys.includes(c)))
  const out = []
  let len = 0
  while (len < target) {
    let w
    if (words.length >= 4 && random() < 0.6) w = pick(words, random)
    else {
      const n = 2 + Math.floor(random() * 4)
      w = Array.from({ length: n }, () => pick(keys, random)).join("")
    }
    out.push(w)
    len += w.length + 1
  }
  return out.join(" ")
}

const numberBits = [
  (r) => String(Math.floor(r() * 900) + 100),
  (r) => `$${Math.floor(r() * 90) + 1}.${String(Math.floor(r() * 100)).padStart(2, "0")}`,
  (r) => `${Math.floor(r() * 12) + 1}:${String(Math.floor(r() * 60)).padStart(2, "0")}`,
  (r) => `${Math.floor(r() * 12) + 1}/${Math.floor(r() * 28) + 1}/${1990 + Math.floor(r() * 40)}`,
  (r) => `${Math.floor(r() * 99) + 1}%`,
  (r) => `${Math.floor(r() * 9) + 1},${String(Math.floor(r() * 1000)).padStart(3, "0")}`,
  (r) => `555-${String(Math.floor(r() * 10000)).padStart(4, "0")}`,
  (r) => String(Math.floor(r() * 10)),
]

const symbolBits = [
  (r, w) => `(${w(r)})`,
  (r, w) => `[${w(r)}]`,
  (r, w) => `{${w(r)}}`,
  (r, w) => `${w(r)} = ${Math.floor(r() * 100)};`,
  (r, w) => `${w(r)}!`,
  (r, w) => `${w(r)}?`,
  (r, w) => `"${w(r)}"`,
  (r, w) => `'${w(r)}'`,
  (r, w) => `#${Math.floor(r() * 100)}`,
  (r, w) => `@${w(r)}`,
  (r, w) => `${w(r)} & ${w(r)}`,
  (r, w) => `a + b * c - d / 2`,
  (r, w) => `${w(r)}_${w(r)}`,
  (r, w) => `<${w(r)}>`,
  (r, w) => `${w(r)}: ${w(r)};`,
  (r, w) => `x >= ${Math.floor(r() * 50)}`,
  (r, w) => `~/${w(r)}/*`,
  (r, w) => `${w(r)}... ${w(r)}`,
]

const fill = (make, random, target) => {
  const out = []
  let len = 0
  while (len < target) {
    const bit = make(random)
    out.push(bit)
    len += bit.length + 1
  }
  return out.join(" ")
}

// -> the drill's text (about `target` characters)
export const makeDrill = (id, random = Math.random, target = 180) => {
  const short = vocabulary()
    .slice(0, 150)
    .map(([w]) => w)
    .filter((w) => w.length >= 2 && w.length <= 6)
  const word = (r) => pick(short, r)
  switch (id) {
    case "home":
    case "top":
    case "bottom":
      return rowText(drillById(id).keys, random, target)
    case "numbers":
      return fill((r) => pick(numberBits, r)(r), random, target)
    case "symbols":
      return fill((r) => pick(symbolBits, r)(r, word), random, target)
    case "common":
    default: {
      const common = vocabulary()
        .slice(0, 120)
        .map(([w]) => w)
      const text = fill((r) => pick(common, r), random, target)
      return text[0].toUpperCase() + text.slice(1) + "."
    }
  }
}
