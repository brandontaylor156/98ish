// Roam towns: each is configuration only (docs/open-world.md "How to add a town").
import valencia from "./valencia.js"
import simi from "./simi.js"

export const TOWNS = { valencia, simi }
export const townById = (id) => TOWNS[id] || null
// the town a My Park venue opens onto (Explore Valencia from the Paseo Club) -> town | null
export const townForVenue = (venueId) => Object.values(TOWNS).find((t) => t.venues && t.venues[venueId]) || null
