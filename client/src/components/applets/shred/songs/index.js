import garage from "./garage.js"
import lastlight from "./lastlight.js"
import riot from "./riot.js"
import neon from "./neon.js"
import lantern from "./lantern.js"
import voltage from "./voltage.js"

// The set list: every song is an original composition, synthesized in the browser. Each
// tier ("venue") unlocks once you've earned enough stars (your best on each song counts).
export const TIERS = [
  { id: "garage", name: "The Garage", stars: 0, songs: [garage, lastlight] },
  { id: "club", name: "The Club Circuit", stars: 5, songs: [neon, lantern] },
  { id: "arena", name: "The Arena", stars: 12, songs: [riot, voltage] },
]

export const SONGS = TIERS.flatMap((t) => t.songs.map((s) => ({ ...s, tier: t.id })))

export const songById = (id) => SONGS.find((s) => s.id === id) || null
export const tierOf = (id) => TIERS.find((t) => t.songs.some((s) => s.id === id)) || null
