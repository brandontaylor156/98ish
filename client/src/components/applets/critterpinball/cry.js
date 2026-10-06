// A critter's cry, as notes: [[midi, to midi, seconds, wave]...], made from its id (a few
// chirps and slides, lower and longer for bigger critters). Pure: audio.js plays it.

import { BY_ID } from "./critters.js"

export const cryNotes = (id) => {
  const c = BY_ID[id]
  let h = 2166136261
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
  const big = c ? (c.sprite.size ?? 1) : 1
  const base = 84 - big * 24 + rand() * 8
  const n = 2 + Math.floor(rand() * 3)
  const waves = ["square", "triangle", "sawtooth"]
  const wave = waves[Math.floor(rand() * waves.length)]
  const notes = []
  for (let i = 0; i < n; i++) {
    const from = base + (rand() - 0.4) * 10
    notes.push([from, from + (rand() - 0.5) * 14, (0.06 + rand() * 0.1) * (0.7 + big * 0.6), wave])
  }
  return notes
}
