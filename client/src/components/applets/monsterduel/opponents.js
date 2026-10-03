// Monster Duel's computer opponents: a name, a deck, how well they play (level) and how
// (style), and how many packs beating them is worth.

export const OPPONENTS = [
  { id: "rookie", name: "Rowan the Rookie", level: "easy", style: "aggro", deck: "beasts", packs: 1, color: "#8a5a2b", glyph: "R", quote: "I just got these cards yesterday. Go easy on me!" },
  { id: "marisol", name: "Marisol", level: "easy", style: "defensive", deck: "aquatic", packs: 1, color: "#1f7fc4", glyph: "M", quote: "The tide always comes back in." },
  { id: "rivet", name: "Captain Rivet", level: "normal", style: "defensive", deck: "machines", packs: 2, color: "#7a8796", glyph: "C", quote: "My walls have never fallen. Not once." },
  { id: "thistle", name: "Old Thistle", level: "normal", style: "balanced", deck: "insects", packs: 2, color: "#5d9e2a", glyph: "T", quote: "Bugs are patient. So am I." },
  { id: "vesper", name: "Lady Vesper", level: "normal", style: "trickster", deck: "undead", packs: 2, color: "#5b3a73", glyph: "V", quote: "Nothing I lose stays lost for long." },
  { id: "aldric", name: "Sir Aldric", level: "hard", style: "aggro", deck: "warriors", packs: 3, color: "#c79a2b", glyph: "A", quote: "Draw your cards, and your courage." },
  { id: "ilsa", name: "Archmage Ilsa", level: "hard", style: "trickster", deck: "casters", packs: 3, color: "#7b4fd6", glyph: "I", quote: "Every spell you cast, I have already countered." },
  { id: "ember", name: "The Ember King", level: "hard", style: "aggro", deck: "dragons", packs: 3, color: "#d9481c", glyph: "E", quote: "Kneel, or burn. Those are the choices." },
]

export const opponentById = (id) => OPPONENTS.find((o) => o.id === id) || OPPONENTS[0]
export const LEVEL_NAMES = { easy: "Easy", normal: "Normal", hard: "Hard" }
